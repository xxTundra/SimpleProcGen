'use strict';
/*
 * ttrpg-server-contract-test.js — deterministic Node test harness for the
 * TTRPG Tools local dev server (server/server.js + api.js + static.js).
 * Zero npm dependencies.
 *
 * Technique: the harness requires port 8923 to be FREE (exit 2 otherwise),
 * spawns its own server child (`node server\server.js`, cwd = project root),
 * polls /api/health until ready (AbortSignal timeouts on every request),
 * runs the full contract battery, then in a finally block removes its temp
 * files, kills the child, and verifies the port is free again and no stray
 * node server process remains.
 *
 * Contract covered (mirrors the server code, which is the port of
 * start-server.ps1): endpoints + status codes, CORS on every response,
 * case-insensitive API routing, OPTIONS 204 preflight, /api/raw path
 * validation (400 battery), raw file lifecycle (GET/PUT/POST/DELETE, 409,
 * 0-byte bodies, BOM strip, 413 with body drain, keep-alive health),
 * static serving (content types, HEAD, dotfile/escape 404s, JSON 404/405
 * bodies), SHA-256 of app.js + served bytes, and data/ integrity (exactly
 * the 4 seed files at start, with start/end digest equality).
 *
 * Determinism: no randomness anywhere; all assertions are on exact statuses,
 * exact JSON bodies, exact bytes, or structural facts (ISO date shape).
 *
 * Run:  node ttrpg-server-contract-test.js
 * Output: one line per failed check, then "N checks / N passed".
 * Exit:  0 all pass, 1 any failure, 2 fatal (port busy / server never ready).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8923;
const BASE = 'http://127.0.0.1:' + PORT;
const REQ_TIMEOUT_MS = 15000;
const READY_TIMEOUT_MS = 20000;

// app.js is app code and stays pinned (re-pin whenever app.js changes).
const APP_SHA = 'A08F58FD5E47EFE47E2B2B695F3C928E98A51757177FA29057D855F1E6C48C7C';

// data/ is restored from tests/fixtures/ at the start of the run, so the
// suite always starts from exactly these 4 seed files. Digests are recorded
// at 'pre' from the canonical fixtures; the end-of-run passes
// ('post-cleanup', 'post') prove data/ still matches them byte-for-byte.
const SEED_FILES = [
  'dice-macros/starter-macros.json',
  'tables/starter-tables.json',
  'generators/starter-generators.json',
  'logic-ops/starter-logic-ops.json',
];
const seedHashes = Object.create(null); // rel path -> sha256 recorded at 'pre'

// ------------------------------------------------------------------ check kit
let checks = 0;
let passed = 0;

function check(name, cond) {
  checks++;
  if (cond) passed++;
  else console.log('FAIL: ' + name);
}

function checkEq(name, actual, expected) {
  checks++;
  if (actual === expected) passed++;
  else console.log('FAIL: ' + name + ' \u2014 expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEq(a[k], b[k])) return false;
  }
  return true;
}

function checkDeep(name, actual, expected) {
  checks++;
  if (deepEq(actual, expected)) passed++;
  else console.log('FAIL: ' + name + ' \u2014 expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').toUpperCase();
}

function readRoot(rel) {
  return fs.readFileSync(path.join(ROOT, rel.split('/').join(path.sep)));
}

function restoreSeeds() {
  for (const rel of SEED_FILES) {
    const dest = path.join(ROOT, 'data', ...rel.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', ...rel.split('/')), dest);
  }
}

// ------------------------------------------------------------------ data walk
function listDataFiles() {
  const out = [];
  const dataDir = path.join(ROOT, 'data');
  (function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push(full.slice(dataDir.length + 1).split(path.sep).join('/'));
    }
  })(dataDir);
  return out;
}

function verifySeeds(label) {
  const files = listDataFiles();
  checkEq(label + ': data/ has exactly 4 files', files.length, 4);
  checkDeep(label + ': data/ file set', files.slice().sort(), SEED_FILES.slice().sort());
  const snapshot = label === 'pre' && Object.keys(seedHashes).length === 0;
  for (const rel of SEED_FILES) {
    let h = null;
    try { h = sha256hex(readRoot((label === 'pre' ? 'tests/fixtures/' : 'data/') + rel)); } catch (_) {}
    if (snapshot) {
      // Record, don't compare: h !== null proves the seed is readable, and only
      // a readable digest is stored, so the snapshot can never hold a null that
      // a later comparison could match.
      check(label + ': sha256 ' + rel + ' readable', h !== null);
      if (h !== null) seedHashes[rel] = h;
    } else {
      checkEq(label + ': sha256 ' + rel + ' unchanged', h, seedHashes[rel]);
    }
  }
}

// ------------------------------------------------------------------- port probe
// Resolve true when SOMETHING answers on the port (occupied), false on
// ECONNREFUSED (free). A hung probe counts as occupied (safe direction).
function probePort(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.get(
      { host: '127.0.0.1', port: PORT, path: '/api/health', signal: AbortSignal.timeout(timeoutMs) },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => finish(true));
      }
    );
    req.on('error', (e) => finish(e && e.code === 'ECONNREFUSED' ? false : true));
    req.on('timeout', () => { try { req.destroy(); } catch {} finish(true); });
  });
}

// ------------------------------------------------------------- request helper
async function req(method, urlPath, body) {
  try {
    const res = await fetch(BASE + urlPath, {
      method,
      body: body === undefined ? undefined : body,
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    });
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, status: res.status, headers: res.headers, body: buf, text: buf.toString('utf8') };
  } catch (e) {
    return { ok: false, status: -1, headers: null, body: null, text: '', error: String(e && e.message || e) };
  }
}

function checkCorners(name, r) {
  checkEq(name + ' status', r.status, 204);
  checkEq(name + ' empty body', r.text.length, 0);
}

// Windows-proof kill. On win32 a killed child fires the `exit` event with
// signal='SIGTERM' while child.exitCode stays null, so death is tracked via
// the exit event (exitedP) / signalCode, never via exitCode alone.
// taskkill /F /T is the fallback if the kill did not take.
async function killChild(child, exitedP) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill(); } catch (_) {}
  await Promise.race([exitedP, sleep(5000)]);
  if (child.exitCode === null && child.signalCode === null && child.pid) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { timeout: 15000 });
    } catch (_) {}
    await Promise.race([exitedP, sleep(3000)]);
  }
}

function checkCors(name, r) {
  if (!r.ok || !r.headers) {
    check(name + ' CORS reachable', false);
    return;
  }
  checkEq(name + ' CORS allow-origin', r.headers.get('access-control-allow-origin'), '*');
  checkEq(name + ' CORS allow-methods', r.headers.get('access-control-allow-methods'), 'GET, PUT, POST, DELETE, OPTIONS');
  checkEq(name + ' CORS allow-headers', r.headers.get('access-control-allow-headers'), 'Content-Type');
}

function checkJson(name, r, expected) {
  check(name + ' reachable', r.ok);
  checkEq(name + ' status', r.status, 200);
  let obj = null;
  try { obj = JSON.parse(r.text); } catch (_) {}
  checkDeep(name + ' body', obj, expected);
}

// ---------------------------------------------------------------------- main
async function main() {
  // ------------------------------------------------------------- pre-flight
  restoreSeeds();
  verifySeeds('pre');
  checkEq('pre: app.js sha256', sha256hex(readRoot('js/app.js')), APP_SHA);
  const genDir = path.join(ROOT, 'data', 'generators');

  checkEq('pre: port 8923 free', await probePort(), false);
  if (await probePort()) {
    console.log('ABORT: port ' + PORT + ' is already in use. Free it and re-run.');
    process.exit(2);
  }

  // ------------------------------------------------------------------ spawn
  let serverLog = '';
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const cap = (d) => { serverLog = (serverLog + d).slice(0, 200000); };
  child.stdout.on('data', cap);
  child.stderr.on('data', cap);
  const exitedP = new Promise((res) => {
    child.once('exit', res);
    child.once('error', () => res());
  });

  // ------------------------------------------------- readiness (AbortSignal)
  let ready = false;
  const start = Date.now();
  while (Date.now() - start < READY_TIMEOUT_MS) {
    const r = await req('GET', '/api/health');
    if (r.ok && r.status === 200) { ready = true; break; }
    await sleep(250);
  }
  check('server: became ready within ' + READY_TIMEOUT_MS + 'ms', ready);
  if (!ready) {
    console.log('FATAL: server never became ready. Server output:\n' + serverLog);
    await killChild(child, exitedP);
    process.exit(2);
  }

  const tmpFiles = []; // generators/ files this harness creates; all removed after
  const tmp = (n) => { const p = 'generators/' + n; tmpFiles.push(p); return p; };

  try {
    // ====================================================== health endpoint
    {
      const r = await req('GET', '/api/health');
      check('health: reachable', r.ok);
      checkEq('health: status', r.status, 200);
      checkEq('health: content-type', r.headers && r.headers.get('content-type'), 'application/json');
      checkCors('health', r);
      let obj = null;
      try { obj = JSON.parse(r.text); } catch (_) {}
      checkEq('health: ok true', obj && obj.ok, true);
      checkEq('health: root is absolute data dir', obj && obj.root, path.resolve(path.join(ROOT, 'data')));

      const r2 = await req('GET', '/api/HEALTH'); // case-insensitive routing
      checkEq('health: /api/HEALTH routed (case-insensitive)', r2.status, 200);

      const r3 = await req('POST', '/api/health');
      checkEq('health: POST 405', r3.status, 405);
      let b3 = null; try { b3 = JSON.parse(r3.text); } catch (_) {}
      checkDeep('health: POST 405 body', b3, { error: 'method not allowed' });
      checkCors('health POST 405', r3);

      const r4 = await req('DELETE', '/api/health');
      checkEq('health: DELETE 405', r4.status, 405);
    }

    // ======================================================== files endpoint
    {
      const r = await req('GET', '/api/files');
      check('files: reachable', r.ok);
      checkEq('files: status', r.status, 200);
      checkEq('files: content-type', r.headers && r.headers.get('content-type'), 'application/json');
      checkCors('files', r);
      let obj = null;
      try { obj = JSON.parse(r.text); } catch (_) {}
      check('files: files is array', Array.isArray(obj && obj.files));
      checkDeep('files: exactly the 4 seed paths, sorted',
        (obj && Array.isArray(obj.files) ? obj.files.map((f) => f.path) : null),
        SEED_FILES.slice().sort());
      if (obj && Array.isArray(obj.files)) {
        for (const f of obj.files) {
          const rel = 'data/' + f.path;
          let size = null;
          try { size = fs.statSync(path.join(ROOT, 'data', f.path.split('/').join(path.sep))).size; } catch (_) {}
          checkEq('files: size ' + f.path, typeof f.size === 'number' ? f.size : null, size);
          check('files: mtime ISO ' + f.path, typeof f.mtime === 'string' &&
            /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(f.mtime));
        }
      }

      const r2 = await req('PUT', '/api/files', '{}');
      checkEq('files: PUT 405', r2.status, 405);
    }

    // ================================================ unknown /api + preflight
    {
      const r = await req('GET', '/api/nope');
      checkEq('unknown api: status 404', r.status, 404);
      let b = null; try { b = JSON.parse(r.text); } catch (_) {}
      checkDeep('unknown api: 404 body', b, { error: 'not found' });
      checkCors('unknown api', r);
    }
    {
      const r = await req('OPTIONS', '/api/health');
      check('preflight: reachable', r.ok);
      checkCorners('preflight', r);
      checkCors('preflight', r);
      checkEq('preflight: no content-type', r.headers && r.headers.get('content-type'), null);
      const r2 = await req('OPTIONS', '/');
      checkEq('preflight: OPTIONS / (any path) 204', r2.status, 204);
      const r3 = await req('OPTIONS', '/nope.js');
      checkEq('preflight: OPTIONS unknown static 204', r3.status, 204);
      const r4 = await req('OPTIONS', '/api/files');
      checkEq('preflight: OPTIONS /api/files 204', r4.status, 204);
      const r5 = await req('OPTIONS', '/api/raw?path=' + encodeURIComponent('generators/x.json'));
      checkEq('preflight: OPTIONS /api/raw?path 204', r5.status, 204);
      const r6 = await req('OPTIONS', '/api/whatever');
      checkEq('preflight: OPTIONS unknown api 204', r6.status, 204);
    }

    // ============================================ /api/raw path validation (400)
    {
      const bad = [
        null,                              // no query param at all
        ' ',                               // whitespace only
        'tables/../x.json',                // '..' segment
        'tables/./x.json',                 // '.' segment
        'tables/x.json/',                  // trailing slash -> empty segment
        'C:\\Windows\\x.json',             // drive/absolute ':'
        '..\\x.json',                      // leading '..'
        'x.json',                          // no allowed top dir
        'mystery/x.json',                  // unknown top dir
        'tables/starter-tables.json/../x.json', // '..' mid-path
        'tables/x.txt',                    // not .json
        'tables/"x".json',                 // "
        'tables/<x>.json',                 // <
        'tables/x>.json',                  // >
        'tables/x|y.json',                 // |
        'tables/x?y.json',                 // ?
        'tables/x*y.json',                 // *
        'tables/x\u0000y.json',            // NUL
        '%C3',                             // (raw, unencoded) undecodable percent
      ];
      for (const p of bad) {
        const url = p === null ? '/api/raw' : '/api/raw?path=' + (p === '%C3' ? p : encodeURIComponent(p));
        const r = await req('GET', url);
        const label = 'bad path: ' + (p === null ? '<missing>' : JSON.stringify(p));
        checkEq(label + ' -> 400', r.status, 400);
        let b = null; try { b = JSON.parse(r.text); } catch (_) {}
        checkDeep(label + ' -> body', b, { error: 'bad path' });
      }
      // CORS on an error class: one representative 400 from the battery above
      // (x.json has no allowed top dir — a true 400, not a 404 missing file).
      const r400 = await req('GET', '/api/raw?path=' + encodeURIComponent('x.json'));
      checkEq('cors-400: representative bad path 400', r400.status, 400);
      checkCors('cors-400', r400);
      // Positive normalization cases (prove the rules transform, not reject).
      const r1 = await req('GET', '/api/raw?path=' + encodeURIComponent('tables//x.json'));
      checkEq('normalize: duplicate separators collapse (404, not 400)', r1.status, 404);

      const r2 = await req('GET', '/api/raw?path=' + encodeURIComponent('/tables/starter-tables.json'));
      checkEq('normalize: leading slash stripped (200)', r2.status, 200);
      checkEq('normalize: leading-slash body matches disk', r2.body.equals(readRoot('tests/fixtures/tables/starter-tables.json')), true);

      const r3 = await req('GET', '/api/raw?path=' + encodeURIComponent('dice-macros\\starter-macros.json'));
      checkEq('normalize: backslash separator accepted (200)', r3.status, 200);
      checkEq('normalize: backslash body matches disk', r3.body.equals(readRoot('tests/fixtures/dice-macros/starter-macros.json')), true);

      const r4 = await req('GET', '/api/raw?path=' + encodeURIComponent('tables/x.JSON'));
      checkEq('normalize: .JSON extension case-insensitive (404, not 400)', r4.status, 404);

      const r5 = await req('GET', '/api/raw?PATH=' + encodeURIComponent('tables/starter-tables.json'));
      checkEq('query: case-insensitive param name PATH (200)', r5.status, 200);
    }

    // ============================================= /api/raw lifecycle (generators)
    {
      const A = tmp('tt-harness-a.json');
      const B = tmp('tt-harness-b.json');
      const C = tmp('tt-harness-c.json');
      const D = tmp('tt-harness-d.json');
      const E = tmp('tt-harness-e.json');
      const F = tmp('tt-harness-f.json');
      const q = (p) => '/api/raw?path=' + encodeURIComponent(p);

      const r0 = await req('GET', q(A));
      checkEq('lifecycle: GET before create 404', r0.status, 404);

      let r = await req('PUT', q(A), '{"a":1}\n');
      check('lifecycle: PUT reachable', r.ok);
      checkEq('lifecycle: PUT new 200', r.status, 200);
      let b = null; try { b = JSON.parse(r.text); } catch (_) {}
      checkDeep('lifecycle: PUT ok body', b, { ok: true });

      r = await req('GET', q(A));
      checkEq('lifecycle: GET after PUT 200', r.status, 200);
      checkEq('lifecycle: GET returns exact bytes', r.body.toString('utf8'), '{"a":1}\n');

      r = await req('POST', q(A), '{"a":1}\n');
      checkEq('lifecycle: POST existing 409', r.status, 409);
      b = null; try { b = JSON.parse(r.text); } catch (_) {}
      checkDeep('lifecycle: 409 body', b, { error: 'conflict' });
      checkCors('lifecycle 409', r);
      const rU = await req('GET', q(A));
      checkEq('lifecycle: 409 left file untouched', rU.body.toString('utf8'), '{"a":1}\n');

      r = await req('PUT', q(A), 'overwritten');
      checkEq('lifecycle: PUT overwrite 200', r.status, 200);
      const rV = await req('GET', q(A));
      checkEq('lifecycle: overwritten bytes', rV.body.toString('utf8'), 'overwritten');

      r = await req('DELETE', q(A));
      checkEq('lifecycle: DELETE existing 200', r.status, 200);
      const rW = await req('GET', q(A));
      checkEq('lifecycle: GET after DELETE 404', rW.status, 404);
      const rX = await req('DELETE', q(A));
      checkEq('lifecycle: DELETE missing 404', rX.status, 404);

      r = await req('POST', q(B), 'post-created');
      checkEq('lifecycle: POST new 200', r.status, 200);
      const rY = await req('GET', q(B));
      checkEq('lifecycle: POST-created bytes', rY.body.toString('utf8'), 'post-created');
      const rZ = await req('DELETE', q(B));
      checkEq('lifecycle: DELETE POST-created 200', rZ.status, 200);

      // 0-byte body is a valid empty body (not a 413).
      r = await req('PUT', q(C), Buffer.alloc(0));
      checkEq('lifecycle: PUT 0-byte body 200', r.status, 200);
      const r0b = await req('GET', q(C));
      checkEq('lifecycle: GET empty file 200', r0b.status, 200);
      checkEq('lifecycle: GET empty file empty body', r0b.text.length, 0);
      checkEq('lifecycle: empty file has no Content-Length header', r0b.headers.get('content-length'), null);
      const r0c = await req('DELETE', q(C));
      checkEq('lifecycle: DELETE empty file 200', r0c.status, 200);

      // BOM is stripped on GET responses only.
      r = await req('PUT', q(D), '\uFEFF{"b":2}');
      checkEq('lifecycle: PUT BOM body 200', r.status, 200);
      const rB = await req('GET', q(D));
      checkEq('lifecycle: GET strips leading BOM', rB.body.toString('utf8'), '{"b":2}');
      const rC = await req('DELETE', q(D));
      checkEq('lifecycle: DELETE BOM file 200', rC.status, 200);

      // Literal '+' in the name survives query handling (not a space).
      const Ename = 'tt-harness+p.json';
      const Ep = 'generators/' + Ename;
      tmpFiles.push(Ep);
      r = await req('PUT', q(Ep), 'plus');
      checkEq('lifecycle: PUT plus-name 200', r.status, 200);
      const rE = await req('GET', q(Ep));
      checkEq('lifecycle: GET plus-name 200', rE.status, 200);
      checkEq('lifecycle: plus-name bytes', rE.body.toString('utf8'), 'plus');
      const rF = await req('DELETE', q(Ep));
      checkEq('lifecycle: DELETE plus-name 200', rF.status, 200);

      // 413: body over 5 MiB cap (drained, never written).
      const big = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
      r = await req('PUT', q(F), big);
      check('lifecycle: 413 PUT reachable', r.ok);
      checkEq('lifecycle: PUT >5MiB 413', r.status, 413);
      b = null; try { b = JSON.parse(r.text); } catch (_) {}
      checkDeep('lifecycle: 413 body', b, { error: 'payload too large' });
      checkCors('lifecycle 413', r);
      const rG = await req('GET', q(F));
      checkEq('lifecycle: 413 PUT wrote nothing (404)', rG.status, 404);
      r = await req('POST', q(F), big);
      checkEq('lifecycle: POST >5MiB 413 (drained pre-conflict)', r.status, 413);
      // Connection survived the drained overflow: server still healthy.
      const rH = await req('GET', '/api/health');
      checkEq('lifecycle: server healthy after 413 drain', rH.status, 200);

      // Raw-socket keep-alive drain: an oversized body on a keep-alive
      // connection must be fully drained (readBody always runs to EOF,
      // server/api.js), so the SAME socket can carry a second request
      // that gets a 200.
      const KA_LEN = 5 * 1024 * 1024 + 1;
      const ka = await new Promise((resolve) => {
        const out = { first: null, second: null, err: null };
        let raw = Buffer.alloc(0);
        let phase = 1;
        let finished = false;
        const done = (v) => { if (!finished) { finished = true; resolve(v); } };
        const parse = (buf) => {
          const idx = buf.indexOf('\r\n\r\n');
          if (idx === -1) return null;
          const lines = buf.slice(0, idx).toString('utf8').split('\r\n');
          const cl = lines.find((l) => l.toLowerCase().startsWith('content-length:'));
          const blen = cl ? parseInt(cl.slice(15), 10) : 0;
          if (buf.length < idx + 4 + blen) return null;
          return {
            status: parseInt(lines[0].split(' ')[1], 10),
            body: buf.slice(idx + 4, idx + 4 + blen).toString('utf8'),
          };
        };
        const sock = net.connect({ host: '127.0.0.1', port: PORT }, () => {
          let sent = 0;
          const chunk = Buffer.alloc(1024 * 1024, 0x41);
          const pump = () => {
            while (sent < KA_LEN) {
              const n = Math.min(chunk.length, KA_LEN - sent);
              // A write that returns false is still QUEUED (backpressure hint
              // only) — always advance `sent`, pause only to let it drain.
              // Re-sending an already-queued chunk duplicates bytes on the
              // wire and the server's parser rejects the request.
              const ok = sock.write(chunk.slice(0, n));
              sent += n;
              if (!ok) { sock.once('drain', pump); return; }
            }
          };
          sock.write(
            'PUT ' + q(F) + ' HTTP/1.1\r\n' +
            'Host: 127.0.0.1:' + PORT + '\r\n' +
            'Connection: keep-alive\r\n' +
            'Content-Type: application/json\r\n' +
            'Content-Length: ' + KA_LEN + '\r\n\r\n'
          );
          pump();
        });
        sock.setTimeout(20000, () => { out.err = 'timeout'; sock.destroy(); done(out); });
        sock.on('data', (d) => {
          raw = Buffer.concat([raw, d]);
          const p = parse(raw);
          if (!p) return;
          if (phase === 1) {
            out.first = p;
            phase = 2;
            raw = Buffer.alloc(0);
            sock.write('GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:' + PORT + '\r\nConnection: close\r\n\r\n');
          } else {
            out.second = p;
            sock.end();
            done(out);
          }
        });
        sock.on('error', (e) => { out.err = String((e && e.message) || e); done(out); });
        sock.on('close', () => done(out));
      });
      if (ka.err) console.log('keep-alive socket error: ' + ka.err);
      check('keep-alive: 413 response read', ka.first != null);
      checkEq('keep-alive: oversized PUT on keep-alive socket 413', ka.first ? ka.first.status : null, 413);
      let kb = null; try { kb = JSON.parse(ka.first ? ka.first.body : ''); } catch (_) {}
      checkDeep('keep-alive: 413 body', kb, { error: 'payload too large' });
      check('keep-alive: second request read on same socket', ka.second != null);
      checkEq('keep-alive: second request 200', ka.second ? ka.second.status : null, 200);
      let kh = null; try { kh = JSON.parse(ka.second ? ka.second.body : ''); } catch (_) {}
      check('keep-alive: health json on reused socket', kh && kh.ok === true);

      const rI = await req('PATCH', q('generators/tt-harness-a.json'));
      checkEq('lifecycle: PATCH raw 405', rI.status, 405);
      let bi = null; try { bi = JSON.parse(rI.text); } catch (_) {}
      checkDeep('lifecycle: PATCH 405 body', bi, { error: 'method not allowed' });
    }

    // ============================================================ static serving
    {
      const r = await req('GET', '/');
      check('static /: reachable', r.ok);
      checkEq('static /: status 200', r.status, 200);
      checkEq('static /: content-type text/html', r.headers && r.headers.get('content-type'), 'text/html');
      checkEq('static /: body equals index.html on disk', r.body.equals(readRoot('index.html')), true);
      checkCors('static /', r);

      const r2 = await req('GET', '/index.html');
      checkEq('static: /index.html 200', r2.status, 200);
      checkEq('static: /index.html body equals disk', r2.body.equals(readRoot('index.html')), true);

      const r3 = await req('GET', '/js/app.js');
      checkEq('static: /js/app.js 200', r3.status, 200);
      checkEq('static: /js/app.js content-type', r3.headers && r3.headers.get('content-type'), 'application/javascript');
      checkEq('static: /js/app.js body equals disk', r3.body.equals(readRoot('js/app.js')), true);
      checkEq('static: served /js/app.js sha256 is canonical', sha256hex(r3.body), APP_SHA);
      checkCors('static /js/app.js', r3);

      const r4 = await req('GET', '/js/generator-engine.js');
      checkEq('static: /js/generator-engine.js 200', r4.status, 200);
      checkEq('static: /js/generator-engine.js body equals disk', r4.body.equals(readRoot('js/generator-engine.js')), true);

      const r5 = await req('GET', '/css/style.css');
      checkEq('static: /css/style.css 200', r5.status, 200);
      checkEq('static: /css/style.css content-type', r5.headers && r5.headers.get('content-type'), 'text/css');
      checkEq('static: /css/style.css body equals disk', r5.body.equals(readRoot('css/style.css')), true);

      const r6 = await req('GET', '/start-server.bat');
      checkEq('static: unknown extension 200', r6.status, 200);
      checkEq('static: unknown extension -> application/octet-stream', r6.headers && r6.headers.get('content-type'), 'application/octet-stream');
      checkEq('static: /start-server.bat body equals disk', r6.body.equals(readRoot('start-server.bat')), true);

      const r7 = await req('HEAD', '/js/app.js');
      check('static HEAD: reachable', r7.ok);
      checkEq('static HEAD: status 200', r7.status, 200);
      checkEq('static HEAD: no body', r7.text.length, 0);
      checkEq('static HEAD: content-length matches disk size',
        r7.headers && r7.headers.get('content-length'), String(readRoot('js/app.js').length));
      checkEq('static HEAD: content-type', r7.headers && r7.headers.get('content-type'), 'application/javascript');
      checkCors('static HEAD', r7);

      const r8 = await req('GET', '/nope.js');
      checkEq('static: unknown file 404', r8.status, 404);
      let b8 = null; try { b8 = JSON.parse(r8.text); } catch (_) {}
      checkDeep('static: 404 JSON body', b8, { error: 'not found' });
      checkEq('static: 404 content-type json', r8.headers && r8.headers.get('content-type'), 'application/json');

      const r9 = await req('GET', '/.gitignore');
      checkEq('static: dotfile 404', r9.status, 404);

      const r10 = await req('GET', '/server');
      checkEq('static: directory 404', r10.status, 404);

      // %2F keeps the traversal bytes past client-side URL normalization.
      const r11 = await req('GET', '/..%2F..%2Fserver%2Fapi.js');
      checkEq('static: encoded traversal 404', r11.status, 404);
      let b11 = null; try { b11 = JSON.parse(r11.text); } catch (_) {}
      checkDeep('static: encoded traversal 404 body', b11, { error: 'not found' });

      const r12 = await req('POST', '/index.html', '{}');
      checkEq('static: POST non-API 405', r12.status, 405);
      let b12 = null; try { b12 = JSON.parse(r12.text); } catch (_) {}
      checkDeep('static: 405 JSON body', b12, { error: 'method not allowed' });
    }

    // =================================================== files endpoint re-check
    {
      // Temp files still exist at this point -> exactly 4 seeds + 6 temp.
      // The lifecycle section deleted every temp file it created, so the
      // listing must be back to exactly the 4 seeds.
      const r = await req('GET', '/api/files');
      let obj = null;
      try { obj = JSON.parse(r.text); } catch (_) {}
      const paths = obj && Array.isArray(obj.files) ? obj.files.map((f) => f.path) : null;
      check('files: re-check reachable', r.ok && Array.isArray(paths));
      checkDeep('files: re-check back to exactly the 4 seeds, sorted', paths, SEED_FILES.slice().sort());
    }

    // ============================================================== cleanup
    for (const p of tmpFiles) {
      const full = path.join(ROOT, 'data', p.split('/').join(path.sep));
      try { fs.unlinkSync(full); } catch (_) {}
    }
    for (const p of tmpFiles) {
      const full = path.join(ROOT, 'data', p.split('/').join(path.sep));
      check('cleanup: removed ' + p, !fs.existsSync(full));
    }
    let rem = null;
    try { rem = fs.readdirSync(genDir).sort(); } catch (_) {}
    checkDeep('cleanup: generators dir holds only the seed file', rem, ['starter-generators.json']);

    verifySeeds('post-cleanup');
  } finally {
    await killChild(child, exitedP);
  }

  // ------------------------------------------------------- post-teardown state
  // On win32 a killed child has exitCode null and signalCode 'SIGTERM'.
  check('teardown: server child exited', child.exitCode !== null || child.signalCode !== null);
  checkEq('teardown: port 8923 free after kill', await probePort(), false);
  check('teardown: no stray node server process', noStrayNodeProcess([process.pid, child.pid]));

  verifySeeds('post');
  checkEq('post: app.js sha256 unchanged', sha256hex(readRoot('js/app.js')), APP_SHA);

  // ------------------------------------------------------------------ summary
  console.log(checks + ' checks / ' + passed + ' passed');
  process.exit(passed === checks ? 0 : 1);
}

// No node.exe process whose command line contains our server entry.
// $pat is defined inside the PS script itself (built from fragments in JS
// so this probe's own command line can never match it), and the harness's
// own PID plus the (already dead) child PID are excluded. Retried a few
// times to absorb process-table update lag after the kill.
function noStrayNodeProcess(excludePids) {
  const ps1 = path.join(os.tmpdir(), 'ttrpg-harness-stray.ps1');
  const exList = excludePids.map((p) => Number(p)).filter((p) => p > 0).join(',');
  const script = [
    "$pat = 'server' + '.js'",
    "$ex = @(" + exList + ")",
    '$found = $false',
    'for ($i = 0; $i -lt 3 -and -not $found; $i++) {',
    "  $procs = Get-CimInstance Win32_Process -Filter 'Name = \"node.exe\"' | Where-Object { $_.ProcessId -notin $ex -and $_.CommandLine -like ('*' + $pat + '*') }",
    '  if ($procs) { $found = $true } elseif ($i -lt 2) { Start-Sleep -Milliseconds 1000 }',
    '}',
    'exit $(if ($found) { 1 } else { 0 })',
  ].join('\n');
  fs.writeFileSync(ps1, script, 'utf8');
  try {
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], { timeout: 30000 });
    return true;
  } catch (e) {
    return e.status === 0;
  } finally {
    try { fs.unlinkSync(ps1); } catch (_) {}
  }
}

main().catch((e) => {
  console.log('FATAL: ' + (e && e.stack ? e.stack : String(e)));
  process.exit(2);
});

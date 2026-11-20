'use strict';
/*
 * Headless UI harness: drives the app's real UI handlers (index.html + js/ modules)
 * inside jsdom against a live dev server on 127.0.0.1:8923.
 *
 * Usage:
 *   node tests/headless-ui-harness.js                      # run all scenarios
 *   node tests/headless-ui-harness.js <scenario> [...]     # run named scenarios
 *   node tests/headless-ui-harness.js --list               # list scenario names
 *   node tests/headless-ui-harness.js --out <dir> ...      # also write results.json to <dir>
 *   node tests/headless-ui-harness.js --server-pid <pid> ...  # kill an externally started server on exit
 *
 * Server lifecycle:
 *   - Talks to a live server on 127.0.0.1:8923. If none is running, the harness
 *     starts one (node server/server.js, cwd = repo root) and kills it on exit,
 *     verifying the port is free afterwards.
 *   - An externally started server is used as-is. To leave no server running,
 *     pass --server-pid <pid> and the harness kills it on exit and verifies the
 *     port is free. Without it, the no-server gate FAILs and tells the caller
 *     to stop the server themselves.
 *
 * Gates: PASS/FAIL is reported per check and per scenario. Before exiting the
 * harness verifies that data/ contains exactly the 4 seed files.
 *
 * Adding a scenario:
 *   scenario('my-scenario', async (h) => { ... });
 *   Create any files you need through the UI, and clean them up through the UI
 *   (confirm() is shimmed to true) so the data/ gate stays green. Use h.check()
 *   for assertions; the scenario passes iff every check passes and no page
 *   logged console errors / uncaught exceptions.
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:8923/';
const SEEDS = [
  'data/dice-macros/starter-macros.json',
  'data/tables/starter-tables.json',
  'data/generators/starter-generators.json',
  'data/logic-ops/starter-logic-ops.json',
];

function restoreSeeds() {
  let n = 0;
  for (const rel of SEEDS) {
    const sub = rel.slice('data/'.length);
    const dest = path.join(ROOT, 'data', ...sub.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'tests', 'fixtures', ...sub.split('/')), dest);
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// jsdom resolution: repo node_modules first, then env override, then the known
// scratch install from earlier QA runs.
// ---------------------------------------------------------------------------
function loadJSDOM() {
  const candidates = [];
  if (process.env.JSDOM_PATH) candidates.push(process.env.JSDOM_PATH);
  candidates.push('jsdom');
  candidates.push(path.join(os.tmpdir(), 'opencode', 'qa', 'jsdom', 'node_modules', 'jsdom'));
  for (const c of candidates) {
    try { return require(c); } catch (_) { /* try next */ }
  }
  throw new Error('jsdom not found. Run: npm install --no-save jsdom  (or set JSDOM_PATH)');
}

// ---------------------------------------------------------------------------
// Global state shared by every page/scenario
// ---------------------------------------------------------------------------
const requestLog = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (a) => (typeof a === 'string' ? a : a instanceof Error ? (a.stack || a.message) : JSON.stringify(a));

function pruneEmptyDirs(dir) {
  let removed = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const fp = path.join(dir, e.name);
    removed += pruneEmptyDirs(fp);
    if (fs.readdirSync(fp).length === 0) { try { fs.rmdirSync(fp); removed++; } catch (_) {} }
  }
  return removed;
}

function dataFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else out.push(fp.slice(ROOT.length + 1).replace(/\\/g, '/'));
    }
  };
  walk(path.join(ROOT, 'data'));
  return out.sort();
}

// ---------------------------------------------------------------------------
// Server management
// ---------------------------------------------------------------------------
async function probeServer() {
  try {
    const r = await fetch(BASE + 'api/health', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch (_) { return false; }
}

async function startServer() {
  const child = spawn(process.execPath, ['server/server.js'], { cwd: ROOT, stdio: 'ignore' });
  const t0 = Date.now();
  while (!(await probeServer())) {
    if (Date.now() - t0 > 15000) { try { child.kill(); } catch (_) {} throw new Error('server did not become ready on ' + BASE); }
    await sleep(200);
  }
  return child;
}

async function killPid(pid) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    else process.kill(pid, 'SIGKILL');
  } catch (_) {}
  const t0 = Date.now();
  while (await probeServer()) {
    if (Date.now() - t0 > 8000) break;
    await sleep(250);
  }
}

async function stopServer(child) {
  if (!child) return;
  try { child.kill(); } catch (_) {}
  await killPid(child.pid);
}

// ---------------------------------------------------------------------------
// jsdom page: loads index.html verbatim, wires the app scripts, and wraps
// fetch/clipboard/prompts so every UI request is logged.
// ---------------------------------------------------------------------------
function makePage(JSDOM, VirtualConsole, tag) {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const log = { log: [], info: [], warn: [], error: [], jsdomError: [] };
  const vc = new VirtualConsole();
  for (const ev of ['log', 'info', 'warn', 'error']) vc.on(ev, (...args) => log[ev].push(args.map(fmt).join(' ')));
  vc.on('jsdomError', (e) => { log.jsdomError.push(String(e && e.message) + ((e && e.detail && e.detail.stack) ? '\n' + e.detail.stack : '')); });

  const dom = new JSDOM(html, {
    url: BASE,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      const nodeFetch = fetch;
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? new URL(input, BASE).href : String((input && input.url) || input);
        const method = (init && init.method) || 'GET';
        const body = init ? init.body : undefined;
        const rec = { page: tag, method, url, status: 0, ok: false, body: typeof body === 'string' ? body : (body != null ? String(body) : null), response: '' };
        requestLog.push(rec);
        const opts = { method, redirect: 'follow' };
        if (init && init.headers) opts.headers = init.headers;
        if (typeof body === 'string') opts.body = body;
        // The app's AbortSignal lives in the jsdom realm; undici rejects it
        // (instanceof check). Bridge it into a node-realm signal so the app's
        // timed aborts (e.g. the 1500 ms boot health probe) behave as in a browser.
        if (init && init.signal) {
          const ac = new AbortController();
          const onAbort = () => ac.abort();
          if (init.signal.aborted) ac.abort();
          else init.signal.addEventListener('abort', onAbort, { once: true });
          opts.signal = ac.signal;
        }
        return nodeFetch(url, opts).then((res) => {
          rec.status = res.status;
          rec.ok = res.ok;
          return res.clone().text().then((t) => { rec.response = t.slice(0, 800); return res; }).catch(() => res);
        }).catch((e) => { rec.error = e.message; throw e; });
      };
      window.URL.createObjectURL = () => 'blob:fake';
      window.URL.revokeObjectURL = () => {};
      try {
        Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => Promise.resolve(), readText: () => Promise.resolve('') } });
      } catch (_) {}
      window.prompt = (msg, def) => { (window.__qaPrompts = window.__qaPrompts || []).push(msg); return def == null ? '' : def; };
      window.confirm = (msg) => { (window.__qaConfirms = window.__qaConfirms || []).push(msg); return true; };
      window.alert = (msg) => { (window.__qaAlerts = window.__qaAlerts || []).push(msg); };
    },
  });

  const w = dom.window;
  const doc = w.document;
  const boot = new Promise((resolve, reject) => {
    if (doc.readyState === 'complete') return resolve();
    w.addEventListener('load', () => resolve());
    setTimeout(() => reject(new Error('window load timeout (' + tag + ')')), 30000);
  });
  const bridge = (code) => { const s = doc.createElement('script'); s.textContent = code; doc.body.appendChild(s); };
  const statePoll = async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      if (w.__QState && w.__QState.mode === 'server' && w.__QState.files.size > 0) return w.__QState;
      await sleep(100);
    }
    return w.__QState || null;
  };
  return { tag, w, doc, dom, boot, log, bridge, statePoll };
}

async function bootPage(JSDOM, VirtualConsole, tag, check) {
  const p = makePage(JSDOM, VirtualConsole, tag);
  await p.boot;
  p.bridge('window.__QState = state;');
  const st = await p.statePoll();
  check(tag + ': booted in server mode with files', !!st && st.mode === 'server' && st.files.size > 0, st ? 'mode=' + st.mode + ' files=' + st.files.size : 'no state');
  if (!st || st.mode !== 'server') throw new Error('not in server mode (' + tag + ')');
  return p;
}

// ---------------------------------------------------------------------------
// DOM helpers (the same event primitives a real browser dispatches)
// ---------------------------------------------------------------------------
function domHelpers(p) {
  const doc = p.doc;
  const w = p.w;
  const $ = (sel, root) => (root || doc).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || doc).querySelectorAll(sel));
  const click = (n) => n && n.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
  const setInput = (n, v) => { n.value = v; n.dispatchEvent(new w.Event('input', { bubbles: true })); };
  const change = (n) => n && n.dispatchEvent(new w.Event('change', { bubbles: true }));
  const blurThenChange = (n) => { n.dispatchEvent(new w.Event('blur', { bubbles: true })); n.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const btnByText = (text, root) => $$('button', root || doc).find((b) => b.textContent.trim() === text);
  return { doc, w, $, $$, click, setInput, change, blurThenChange, btnByText };
}

function settledPuts(tag, sub) {
  return requestLog.filter((r) => r.page === tag && (r.method === 'PUT' || r.method === 'POST') && decodeURIComponent(r.url).indexOf(sub) !== -1 && r.status !== 0);
}

async function waitSettled(tag, sub, since, min, timeout) {
  const t0 = Date.now();
  const tmo = timeout || 20000;
  for (;;) {
    const settled = settledPuts(tag, sub);
    if (settled.length >= since + min) return settled.slice(since);
    if (Date.now() - t0 > tmo) return settled.slice(since);
    await sleep(50);
  }
}

async function poll(fn, timeout) {
  const t0 = Date.now();
  const tmo = timeout || 8000;
  for (;;) {
    if (fn()) return true;
    if (Date.now() - t0 > tmo) return false;
    await sleep(100);
  }
}

// ---------------------------------------------------------------------------
// Scenario registry + per-scenario context
// ---------------------------------------------------------------------------
const scenarios = [];
function scenario(name, fn) { scenarios.push({ name, fn }); }

function makeContext(name, JSDOM, VirtualConsole) {
  const results = [];
  const consoleLogs = {};
  const check = (id, ok, detail) => {
    results.push({ id, ok: !!ok, detail: String(detail).slice(0, 600) });
    console.log((ok ? 'PASS  ' : 'FAIL  ') + id + '  ::  ' + String(detail).slice(0, 280));
  };
  return {
    name,
    results,
    consoleLogs,
    check,
    sleep,
    poll,
    requestLog,
    settledPuts,
    waitSettled,
    dom: domHelpers,
    async page(suffix) {
      const tag = name + (suffix ? '-' + suffix : '');
      const p = await bootPage(JSDOM, VirtualConsole, tag, check);
      consoleLogs[p.tag] = p.log;
      return p;
    },
  };
}

function auditScenario(h) {
  for (const tag of Object.keys(h.consoleLogs)) {
    const log = h.consoleLogs[tag];
    h.check(tag + ': audit - zero page console errors', log.error.length === 0, log.error.length ? log.error.slice(0, 3).join(' || ').slice(0, 400) : 'none');
    const jsErr = log.jsdomError.filter((m) => !/Not implemented/.test(m));
    h.check(tag + ': audit - zero uncaught page exceptions', jsErr.length === 0, jsErr.length ? jsErr.slice(0, 3).join(' || ').slice(0, 400) : 'none');
  }
}

// ---------------------------------------------------------------------------
// Scenario: expose-validation
//
// Op code:   IMPORT %attack%
//            EXPOSE %test1%
// Output template: %attack%   (test input: attack = 5)
// Expected: the validation panel flags %test1% as an error
// (expose-undefined-variable); %attack% is NOT flagged (imported vars are
// guaranteed); running the test fails with the EXPOSE no-value error.
// ---------------------------------------------------------------------------
scenario('expose-validation', async (h) => {
  const FILE = 'qa-expose-validation';
  const FPATH = 'logic-ops/' + FILE + '.json';
  const p = await h.page('expose');
  const d = h.dom(p);

  // ---- create the logic file through the UI ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-logic')));
  await h.sleep(200);
  const dlg = d.$('#ask-text-panel input.field');
  h.check('askText modal for logic file', !!dlg, 'modal input: ' + !!dlg);
  d.setInput(dlg, FILE);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const created = await h.waitSettled(p.tag, FPATH, 0, 1);
  const crec = created[created.length - 1];
  h.check('logic file created (2xx)', !!crec && crec.ok, crec ? crec.method + ' ' + crec.url + ' -> ' + crec.status : 'no request');
  await h.sleep(300);

  // ---- open the file and add the operation ----
  const pathSpan = d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH);
  h.check('logic file section rendered', !!pathSpan, 'sections: ' + d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).join(', '));
  d.click(pathSpan);
  await h.sleep(300);
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor opened with name input', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;

  const b0 = h.settledPuts(p.tag, FPATH).length;
  d.setInput(nameInp, 'ExposeCheck');
  d.change(nameInp); // rename -> cascade persist
  await h.waitSettled(p.tag, FPATH, b0, 1);
  await h.sleep(200);

  // ---- script + template (change -> immediate PUT) ----
  const script = d.$('#tab-logic .script-source');
  d.setInput(script, 'IMPORT %attack%\nEXPOSE %test1%');
  d.change(script);
  const b1 = h.settledPuts(p.tag, FPATH).length;
  await h.waitSettled(p.tag, FPATH, b1, 1);
  const tpl = d.$('#tab-logic .script-template-source');
  d.setInput(tpl, '%attack%');
  d.change(tpl);
  const b2 = h.settledPuts(p.tag, FPATH).length;
  const tplReqs = await h.waitSettled(p.tag, FPATH, b2, 1);
  const lastBody = tplReqs.length ? tplReqs[tplReqs.length - 1].body : '';
  h.check('script + template persisted (script and %attack% in last PUT)', lastBody.indexOf('IMPORT %attack%') !== -1 && lastBody.indexOf('EXPOSE %test1%') !== -1 && lastBody.indexOf('%attack%') !== -1, 'lastBodyHasScript=' + (lastBody.indexOf('EXPOSE %test1%') !== -1));
  await h.sleep(200);

  // ---- validation panel (220 ms debounce after keystrokes) ----
  const rowsNow = () => d.$$('.logic-validation .script-issue');
  const flagged = await h.poll(() => rowsNow().some((r) => (r.querySelector('.var-hl') || { textContent: '' }).textContent.trim() === '%test1%'));
  h.check('validation panel flags %test1%', flagged, JSON.stringify(rowsNow().map((r) => r.textContent.replace(/\s+/g, ' ').trim())));
  const errRow = rowsNow().find((r) => (r.querySelector('.var-hl') || { textContent: '' }).textContent.trim() === '%test1%');
  const errText = errRow ? errRow.textContent.replace(/\s+/g, ' ').trim() : '';
  h.check('flag as error "expose-undefined-variable" (never SET or IMPORTed)', !!errRow && errRow.classList.contains('error') && errText.indexOf('expose-undefined-variable') !== -1 && errText.indexOf('never SET or IMPORTed') !== -1, errText.slice(0, 200) || 'no row');
  h.check('%attack% NOT flagged (imported vars are guaranteed)', !rowsNow().some((r) => r.textContent.indexOf('attack') !== -1), 'rows=' + rowsNow().length);
  const okLine = d.$('.logic-validation .validation-ok');
  h.check('panel shows only the single flag (no "No problems found")', okLine === null, 'ok line: ' + !!okLine);

  // ---- run the test with attack = 5 ----
  const tin = d.$('#tab-logic .test-input');
  h.check('test input for attack present', !!tin && tin.getAttribute('aria-label') === 'Test value for attack', 'aria=' + (tin && tin.getAttribute('aria-label')));
  d.setInput(tin, '5');
  d.click(d.btnByText('run test', d.$('#tab-logic .logic-test-panel')));
  const ran = await h.poll(() => d.$('#tab-logic .logic-test-result .test-error') !== null);
  const errEl = d.$('#tab-logic .logic-test-result .test-error');
  const errTxt = errEl ? errEl.textContent.trim() : '';
  h.check('run test fails: EXPOSE %test1% has no value', ran && d.$('#tab-logic .logic-test-result .test-fail') !== null && errTxt.indexOf('%test1%') !== -1 && errTxt.indexOf('has no value') !== -1, errTxt.slice(0, 200) || 'no error shown');

  // ---- close editor (flushes save) and clean up through the UI ----
  d.click(d.btnByText('close editor', d.$('#tab-logic .logic-editor')));
  await h.sleep(400);
  const section = d.$$('#tab-logic .file-section').find((s) => s.textContent.indexOf(FPATH) !== -1);
  h.check('file section present for cleanup', !!section, 'section: ' + !!section);
  const confBefore = (p.w.__qaConfirms || []).length;
  d.click(d.btnByText('delete', section));
  await h.sleep(500);
  const delReqs = requestLog.filter((r) => r.page === p.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(FPATH) !== -1 && r.status !== 0);
  h.check('logic file deleted (confirm + DELETE 2xx)', (p.w.__qaConfirms || []).length > confBefore && delReqs.length === 1 && delReqs[0].status === 200, 'confirms=' + (p.w.__qaConfirms || []).length + ' delete=' + (delReqs[0] ? delReqs[0].status : 'none'));
  await h.sleep(300);
  h.check('logic tab shows only the seed file', JSON.stringify(d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
});

// ---------------------------------------------------------------------------
// Scenario: boot-seeds
//
// The app boots in server mode and loads exactly the 4 seed files
// (dice-macros/starter-macros.json, tables/starter-tables.json,
// generators/starter-generators.json, logic-ops/starter-logic-ops.json),
// each parsing to { items: [...] }.
// ---------------------------------------------------------------------------
scenario('boot-seeds', async (h) => {
  const SEED_PATHS = ['dice-macros/starter-macros.json', 'generators/starter-generators.json', 'logic-ops/starter-logic-ops.json', 'tables/starter-tables.json'];
  const p = await h.page('seeds');
  const st = p.w.__QState;
  const keys = [...st.files.keys()].sort();
  h.check('server mode loaded exactly the 4 seed files', JSON.stringify(keys) === JSON.stringify(SEED_PATHS), 'keys=' + JSON.stringify(keys));
  const badSeeds = SEED_PATHS.filter((s) => { const e = st.files.get(s); return !(e && e.parsed && Array.isArray(e.parsed.items)); });
  h.check('each seed file parses to { items: [...] }', badSeeds.length === 0, 'bad=' + JSON.stringify(badSeeds));
  const listRes = await p.w.fetch(BASE + 'api/files');
  const listed = listRes.ok ? (await listRes.json()).files.map((f) => f.path).sort() : [];
  h.check('GET /api/files lists exactly the 4 seed files', JSON.stringify(listed) === JSON.stringify(SEED_PATHS), 'listed=' + JSON.stringify(listed));
});

// ---------------------------------------------------------------------------
// Scenario: import-malformed
//
// Malformed bundles dropped through the UI (handleDroppedFiles, the same
// entry point as drag & drop and the "import..." file picker) must produce a
// clear error toast and never a partial import:
//   (a) unknown kind tag        -> generic "rejected" error toast
//   (b) v1-style logic-ops bundle carrying a version field
//                           -> 'Import rejected: unknown field "version".' error toast
// After both, data/ must still hold exactly the 4 seeds.
// ---------------------------------------------------------------------------
scenario('import-malformed', async (h) => {
  const SEED_PATHS = ['dice-macros/starter-macros.json', 'generators/starter-generators.json', 'logic-ops/starter-logic-ops.json', 'tables/starter-tables.json'];
  const p = await h.page('bad');
  const d = h.dom(p);
  const st = p.w.__QState;
  const keysNow = () => JSON.stringify([...st.files.keys()].sort());
  const drop = (name, obj) => p.w.handleDroppedFiles([{ name, text: async () => JSON.stringify(obj) }]);
  const toastNow = () => {
    const t = d.$('#toast');
    return t ? { hidden: t.hidden, cls: t.className, text: t.textContent } : null;
  };
  const writes = () => requestLog.filter((r) => r.page === p.tag && (r.method === 'POST' || r.method === 'PUT') && decodeURIComponent(r.url).indexOf('/api/raw') !== -1 && r.status !== 0);

  // (a) unknown kind tag: not a known bundle tag, no sniffable items
  await drop('qa-bogus-kind.json', { kind: 'ttrpg-bogus-kind' });
  await h.sleep(300);
  const ta = toastNow();
  h.check('unknown kind -> visible error toast naming the rejection', !!ta && !ta.hidden && ta.cls.indexOf('error') !== -1 && /rejected/i.test(ta.text), JSON.stringify(ta));
  h.check('no partial import (still exactly the 4 seeds)', keysNow() === JSON.stringify(SEED_PATHS), 'keys=' + keysNow());
  h.check('no file written (no settled POST/PUT to /api/raw)', writes().length === 0, 'writes=' + writes().length);

  // (b) v1-style bundle: strict ttrpg-logic-ops shape plus a version field
  await drop('qa-v1-bundle.json', {
    kind: 'ttrpg-logic-ops',
    version: 1,
    operations: [
      { id: 'op_1a2b3c4d', name: 'V1 Op', purpose: '', script: 'IMPORT %x%', outputTemplate: '%x%', imports: ['x'], exposed: [], bindings: {}, occurrences: [{ instanceId: 'occ_1a2b3c4d', token: 'x', refId: null, offset: 1 }] },
    ],
  });
  await h.sleep(300);
  const tb = toastNow();
  h.check('v1 bundle (version field) -> clear error toast naming the unknown field', !!tb && !tb.hidden && tb.cls.indexOf('error') !== -1 && tb.text.indexOf('Import rejected') !== -1 && tb.text.indexOf('version') !== -1, JSON.stringify(tb));
  h.check('no partial import (still exactly the 4 seeds)', keysNow() === JSON.stringify(SEED_PATHS), 'keys=' + keysNow());
  h.check('no file written (no settled POST/PUT to /api/raw)', writes().length === 0, 'writes=' + writes().length);
});

// ---------------------------------------------------------------------------
// Scenario: import-valid
//
// A strict, valid ttrpg-logic-ops bundle dropped through the UI must create a
// new file at the nextLogicOpsPath name (logic-ops/<stem>.json) and never
// overwrite: importing the same stem a second time must land at
// logic-ops/<stem>-2.json while the original file stays byte-identical.
// Both files are cleaned up through the Files tab.
// ---------------------------------------------------------------------------
scenario('import-valid', async (h) => {
  const STEM = 'qa-import-smoke';
  const FPATH = 'logic-ops/' + STEM + '.json';
  const FPATH2 = 'logic-ops/' + STEM + '-2.json';
  const BUNDLE = {
    kind: 'ttrpg-logic-ops',
    operations: [
      { id: 'op_2b3c4d5e', name: 'QA Smoke Op', purpose: '', script: 'IMPORT %x%', outputTemplate: '%x%', imports: ['x'], exposed: [], bindings: {}, occurrences: [{ instanceId: 'occ_2b3c4d5e', token: 'x', refId: null, offset: 1 }] },
    ],
  };
  const p = await h.page('valid');
  const d = h.dom(p);
  const st = p.w.__QState;
  const drop = (name) => p.w.handleDroppedFiles([{ name, text: async () => JSON.stringify(BUNDLE) }]);

  // First import: lands at logic-ops/<stem>.json
  await drop(STEM + '.json');
  const created = await h.waitSettled(p.tag, FPATH, 0, 1);
  const crec = created[created.length - 1];
  h.check('first import creates ' + FPATH + ' (POST 2xx)', !!crec && crec.ok, crec ? crec.method + ' ' + crec.url + ' -> ' + crec.status : 'no request');
  const firstEntry = st.files.get(FPATH);
  h.check('stored file is { items: [op] } carrying the imported op', !!firstEntry && firstEntry.parsed && Array.isArray(firstEntry.parsed.items) && firstEntry.parsed.items.length === 1 && firstEntry.parsed.items[0].name === 'QA Smoke Op', 'items=' + (firstEntry && firstEntry.parsed ? firstEntry.parsed.items.length : 'no parse'));
  const firstText = firstEntry ? firstEntry.text : null;

  // Second import, same stem: nextLogicOpsPath must yield <stem>-2, never overwrite
  await drop(STEM + '.json');
  const created2 = await h.waitSettled(p.tag, FPATH2, 0, 1);
  const crec2 = created2[created2.length - 1];
  h.check('second import lands at ' + FPATH2 + ' (nextLogicOpsPath, POST 2xx)', !!crec2 && crec2.ok, crec2 ? crec2.method + ' ' + crec2.url + ' -> ' + crec2.status : 'no request');
  const secondEntry = st.files.get(FPATH2);
  h.check('second file present in state with one op (clash-renamed on import)', !!secondEntry && secondEntry.parsed && Array.isArray(secondEntry.parsed.items) && secondEntry.parsed.items.length === 1, 'items=' + (secondEntry && secondEntry.parsed ? secondEntry.parsed.items.length : 'no parse'));
  const putOverOriginal = requestLog.filter((r) => r.page === p.tag && r.method === 'PUT' && decodeURIComponent(r.url).indexOf(FPATH) !== -1 && r.status !== 0);
  h.check('original file never overwritten (no PUT to ' + FPATH + ', text unchanged)', putOverOriginal.length === 0 && st.files.get(FPATH) && st.files.get(FPATH).text === firstText, 'puts=' + putOverOriginal.length + ' textChanged=' + (st.files.get(FPATH) ? st.files.get(FPATH).text !== firstText : 'gone'));

  // Clean up both files through the Files tab
  d.click(d.$('.tab[data-tab="files"]'));
  await h.sleep(200);
  for (const fp of [FPATH2, FPATH]) {
    const row = d.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(fp) !== -1);
    h.check('file row present for cleanup (' + fp + ')', !!row, 'rows=' + d.$$('#tab-files .file-table tbody tr').length);
    if (!row) continue;
    const confBefore = (p.w.__qaConfirms || []).length;
    d.click(d.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(fp) !== -1 && r.status !== 0);
    h.check(fp + ' deleted (confirm + DELETE 200)', (p.w.__qaConfirms || []).length > confBefore && del.length === 1 && del[0].status === 200, 'confirms=' + (p.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
    await h.sleep(200);
  }
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  h.check('logic tab shows only the seed file after cleanup', JSON.stringify(d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
});

// ---------------------------------------------------------------------------
// Scenario: gen-mode-advanced
//
// Toggling a generator's mode to advanced commits to the file (PUT with
// mode=advanced) and reveals the advanced-only bindings + preview panels;
// after a full page reload the mode still reads advanced and the panels stay
// visible. The file is created and deleted through the UI.
// ---------------------------------------------------------------------------
scenario('gen-mode-advanced', async (h) => {
  const STEM = 'qa-mode-smoke';
  const FPATH = 'generators/' + STEM + '.json';
  const p = await h.page('mode');
  const d = h.dom(p);

  // Create the generator file and item through the UI
  d.click(d.$('.tab[data-tab="generators"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new generator file', d.$('#tab-generators')));
  await h.sleep(200);
  const dlg = d.$('#ask-text-panel input.field');
  h.check('askText modal for generator file name', !!dlg, 'modal input: ' + !!dlg);
  d.setInput(dlg, STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const created = await h.waitSettled(p.tag, FPATH, 0, 1);
  const crec = created[created.length - 1];
  h.check('generator file created (2xx)', !!crec && crec.ok, crec ? crec.method + ' ' + crec.url + ' -> ' + crec.status : 'no request');
  await h.sleep(300);

  const section = d.$$('#tab-generators .file-section.gen-file-section').find((s) => s.textContent.indexOf(FPATH) !== -1);
  h.check('generator file section rendered', !!section, 'sections: ' + d.$$('#tab-generators .file-section.gen-file-section').map((s) => (s.querySelector('.file-path') || { textContent: '' }).textContent.trim()).join(', '));
  if (!section) return;
  d.click(d.btnByText('+ add generator', section));
  await h.sleep(300);
  const nameInp = d.$('#tab-generators .gen-name-input');
  h.check('generator editor opened (name input present)', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;

  // Name the item: the first named commit persists it (mode still basic)
  const b0 = h.settledPuts(p.tag, FPATH).length;
  d.setInput(nameInp, 'QA Mode Gen');
  d.change(nameInp);
  await h.waitSettled(p.tag, FPATH, b0, 1);
  await h.sleep(200);

  // Toggle mode to advanced: change -> commit -> PUT; advanced panels appear
  const modeSel = d.$('#tab-generators .gen-mode-select');
  h.check('mode select present and starts at basic', !!modeSel && modeSel.value === 'basic', 'value=' + (modeSel && modeSel.value));
  const b1 = h.settledPuts(p.tag, FPATH).length;
  d.setInput(modeSel, 'advanced');
  d.change(modeSel);
  const putReqs = await h.waitSettled(p.tag, FPATH, b1, 1);
  const lastPut = putReqs[putReqs.length - 1];
  h.check('mode change committed via PUT carrying mode=advanced', !!lastPut && lastPut.status === 200 && String(lastPut.body).indexOf('"mode": "advanced"') !== -1, lastPut ? lastPut.status + ' modeAdvancedInBody=' + (String(lastPut.body).indexOf('"mode": "advanced"') !== -1) : 'no PUT');
  await h.sleep(300);

  const bp = d.$('#tab-generators .gen-bindings-panel');
  const pp = d.$('#tab-generators .gen-preview-panel');
  h.check('advanced-only panels visible in advanced mode', !!bp && bp.hidden === false && !!pp && pp.hidden === false, 'bindings.hidden=' + (bp && bp.hidden) + ' preview.hidden=' + (pp && pp.hidden));
  const item = p.w.__QState.files.get(FPATH) && p.w.__QState.files.get(FPATH).parsed && p.w.__QState.files.get(FPATH).parsed.items[0];
  h.check('in-memory item mode is advanced', !!item && item.mode === 'advanced', 'mode=' + (item && item.mode));

  // Full reload: mode persists and the advanced panels stay visible
  const p2 = await h.page('reload');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="generators"]'));
  await h.sleep(300);
  const card = d2.$$('#tab-generators .gen-card').find((c) => c.textContent.indexOf('QA Mode Gen') !== -1);
  h.check('generator card survives reload', !!card, 'cards=' + d2.$$('#tab-generators .gen-card').length);
  if (!card) return;
  d2.click(d2.btnByText('Edit', card));
  await h.sleep(300);
  const modeSel2 = d2.$('#tab-generators .gen-mode-select');
  h.check('mode select reads advanced after reload', !!modeSel2 && modeSel2.value === 'advanced', 'value=' + (modeSel2 && modeSel2.value));
  const bp2 = d2.$('#tab-generators .gen-bindings-panel');
  const pp2 = d2.$('#tab-generators .gen-preview-panel');
  h.check('advanced-only panels visible after reload', !!bp2 && bp2.hidden === false && !!pp2 && pp2.hidden === false, 'bindings.hidden=' + (bp2 && bp2.hidden) + ' preview.hidden=' + (pp2 && pp2.hidden));
  const rawRes = await p2.w.fetch(BASE + 'api/raw?path=' + encodeURIComponent(FPATH));
  let rawJson = null;
  try { rawJson = rawRes.ok ? await rawRes.json() : null; } catch (_) { /* handled below */ }
  h.check('file on disk carries mode=advanced', !!rawJson && Array.isArray(rawJson.items) && rawJson.items.length === 1 && rawJson.items[0].mode === 'advanced', rawJson ? 'mode=' + rawJson.items[0].mode : 'no json');

  // Clean up through the Files tab
  d2.click(d2.$('.tab[data-tab="files"]'));
  await h.sleep(200);
  const row = d2.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(FPATH) !== -1);
  h.check('file row present for cleanup', !!row, 'rows=' + d2.$$('#tab-files .file-table tbody tr').length);
  if (!row) return;
  const confBefore = (p2.w.__qaConfirms || []).length;
  d2.click(d2.btnByText('delete', row));
  await h.sleep(500);
  const del = requestLog.filter((r) => r.page === p2.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(FPATH) !== -1 && r.status !== 0);
  h.check('generator file deleted (confirm + DELETE 200)', (p2.w.__qaConfirms || []).length > confBefore && del.length === 1 && del[0].status === 200, 'confirms=' + (p2.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
});

// ---------------------------------------------------------------------------
// Scenario: logic-op-shotgun
//
// Example A driven through the real UI: the exact documented script
// and output template in a logic op, tested against the seeded Chest table
// with a temporary Shotgun entry appended (removed afterwards, so
// tables/starter-tables.json ends byte-identical).
// rng: call 1 0.9999 * 101 total weight -> last bucket -> Shotgun;
//      call 2 drawIndex(21): floor(0.77 * 21) = 16 -> 30 + 16 = 46.
// Expected: 'Legendary Shotgun (46 Base damage)'; damage stays 46.
// ---------------------------------------------------------------------------
scenario('logic-op-shotgun', async (h) => {
  const FILE = 'qa-op-shotgun';
  const FPATH = 'logic-ops/' + FILE + '.json';
  const LOOT = 'tables/starter-tables.json';
  const p = await h.page('op-shotgun');
  const d = h.dom(p);

  // Capture raw starter-tables.json: must be byte-identical after the scenario.
  const rawRes = await p.w.fetch(BASE + 'api/raw?path=' + encodeURIComponent(LOOT));
  const rawBefore = rawRes.ok ? await rawRes.text() : null;
  h.check('captured raw tables/starter-tables.json', typeof rawBefore === 'string' && rawBefore.length > 0, rawBefore ? 'len=' + rawBefore.length : 'no text');

  // ---- create the logic file through the UI ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-logic')));
  await h.sleep(200);
  const dlg = d.$('#ask-text-panel input.field');
  h.check('askText modal for logic file', !!dlg, 'modal input: ' + !!dlg);
  d.setInput(dlg, FILE);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const created = await h.waitSettled(p.tag, FPATH, 0, 1);
  const crec = created[created.length - 1];
  h.check('logic file created (2xx)', !!crec && crec.ok, crec ? crec.method + ' ' + crec.url + ' -> ' + crec.status : 'no request');
  await h.sleep(300);

  // ---- open the file and add the Example A operation ----
  d.click(d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH));
  await h.sleep(300);
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor opened with name input', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;
  const b0 = h.settledPuts(p.tag, FPATH).length;
  d.setInput(nameInp, 'Loot');
  d.change(nameInp);
  await h.waitSettled(p.tag, FPATH, b0, 1);
  const script = 'SET weapon = ROLL [chest]\nSET base_damage = ROLL ((30-50))\n\nIF weapon == "Shotgun" AND base_damage > 45 THEN:\n    SET rarity = "Legendary"\nELSE:\n    SET rarity = "Common"';
  const src = d.$('#tab-logic .script-source');
  d.setInput(src, script);
  d.change(src);
  const b1 = h.settledPuts(p.tag, FPATH).length;
  await h.waitSettled(p.tag, FPATH, b1, 1);
  const tpl = d.$('#tab-logic .script-template-source');
  d.setInput(tpl, '%rarity% %weapon% (%base_damage% Base damage)');
  d.change(tpl);
  const b2 = h.settledPuts(p.tag, FPATH).length;
  const tplReqs = await h.waitSettled(p.tag, FPATH, b2, 1);
  const lastBody = tplReqs.length ? String(tplReqs[tplReqs.length - 1].body) : '';
  h.check('script + template persisted', lastBody.indexOf('ROLL [chest]') !== -1 && lastBody.indexOf('ROLL ((30-50))') !== -1 && lastBody.indexOf('%rarity% %weapon% (%base_damage% Base damage)') !== -1, 'body=' + lastBody.slice(0, 160));
  await h.sleep(200);

  // ---- append a temporary Shotgun entry to the seeded Chest table ----
  d.click(d.$('.tab[data-tab="tables"]'));
  await h.sleep(300);
  const chestItem = d.$$('#tab-tables .table-item').find((r) => r.textContent.indexOf('Chest') !== -1);
  h.check('Chest container listed in tables tab', !!chestItem, 'items=' + d.$$('#tab-tables .table-item').map((r) => r.textContent.trim()).join(', '));
  if (!chestItem) return;
  d.click(chestItem);
  await h.sleep(300);
  const detail = d.$('#tab-tables .table-detail');
  const detailName = detail ? detail.querySelector('.table-name-input') : null;
  h.check('Chest detail panel open (name input = Chest)', !!detail && !!detailName && detailName.value === 'Chest', detailName ? 'name=' + detailName.value : 'no name input');
  if (!detail) return;
  d.click(d.btnByText('+ add entry', detail));
  await h.sleep(300);
  const rows = d.$$('#tab-tables .table-detail .entry-row');
  h.check('Shotgun entry row appended (7 rows)', rows.length === 7, 'rows=' + rows.length);
  if (rows.length !== 7) return;
  const shotLabel = rows[rows.length - 1].querySelectorAll('input')[0];
  d.setInput(shotLabel, 'Shotgun');
  d.change(shotLabel);
  const b3 = h.settledPuts(p.tag, LOOT).length;
  const lootReqs = await h.waitSettled(p.tag, LOOT, b3, 1);
  const lootBody = lootReqs.length ? String(lootReqs[lootReqs.length - 1].body) : '';
  h.check('Shotgun entry committed via PUT to starter-tables.json', lootBody.indexOf('Shotgun') !== -1, lootBody.slice(0, 160));

  // ---- run the test panel with a deterministic Math.random ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  // Tolerant reopen: the op editor may already be open, or the tab may be
  // showing the op list or the file list.
  let panel = d.$('#tab-logic .logic-test-panel');
  if (!panel) {
    let opRow = d.$('#tab-logic .logic-op-row');
    if (!opRow) {
      const pathSpan = d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH);
      if (pathSpan) { d.click(pathSpan); await h.sleep(300); opRow = d.$('#tab-logic .logic-op-row'); }
    }
    if (opRow) { d.click(opRow); await h.sleep(300); panel = d.$('#tab-logic .logic-test-panel'); }
  }
  h.check('test panel in DOM', !!panel, 'panel: ' + !!panel + ' opRows=' + d.$$('#tab-logic .logic-op-row').length + ' sections=' + d.$$('#tab-logic .file-section').length);
  if (!panel) return;
  h.check('no test inputs needed (no imports)', panel.textContent.indexOf('No imported variables') !== -1, panel.textContent.slice(0, 200));
  p.bridge('window.__qaRng = [0.9999, 0.77]; window.__qaRngI = 0; window.__qaRngReal = window.Math.random; window.Math.random = function () { var v = window.__qaRng[window.__qaRngI % window.__qaRng.length]; window.__qaRngI += 1; return v; };');
  d.click(d.btnByText('run test', panel));
  const ran = await h.poll(() => d.$('#tab-logic .logic-test-result .test-ok') !== null || d.$('#tab-logic .logic-test-result .test-fail') !== null);
  p.bridge('window.Math.random = window.__qaRngReal;');
  h.check('test run finished', ran, 'no result rendered');
  const res = d.$('#tab-logic .logic-test-result');
  const outEl = res ? res.querySelector('.test-output') : null;
  h.check('exact Example A output', !!res && res.querySelector('.test-ok') !== null && !!outEl && outEl.textContent.trim() === 'Output Template: Legendary Shotgun (46 Base damage)', outEl ? outEl.textContent.trim() : (res ? 'no .test-output: ' + res.textContent.slice(0, 200) : 'no result'));
  const varRows = res ? Array.from(res.querySelectorAll('.test-var-row')).filter((r) => !r.classList.contains('test-var-head')) : [];
  const vars = {};
  varRows.forEach((r) => { const sp = r.querySelectorAll('span'); vars[sp[0].textContent.trim()] = { type: sp[1].textContent.trim(), value: sp[2].textContent.trim() }; });
  h.check('base_damage stayed 46 (number)', !!vars.base_damage && vars.base_damage.type === 'number' && vars.base_damage.value === '46', JSON.stringify(vars.base_damage));
  h.check('weapon is "Shotgun" (string)', !!vars.weapon && vars.weapon.type === 'string' && vars.weapon.value === '"Shotgun"', JSON.stringify(vars.weapon));
  h.check('rarity is "Legendary" (string)', !!vars.rarity && vars.rarity.type === 'string' && vars.rarity.value === '"Legendary"', JSON.stringify(vars.rarity));

  // ---- remove the temporary Shotgun entry (byte-restore) ----
  d.click(d.$('.tab[data-tab="tables"]'));
  await h.sleep(300);
  const chestItem2 = d.$$('#tab-tables .table-item').find((r) => r.textContent.indexOf('Chest') !== -1);
  h.check('Chest row still listed for entry removal', !!chestItem2, 'items=' + d.$$('#tab-tables .table-item').length);
  if (chestItem2) {
    d.click(chestItem2);
    await h.sleep(300);
    const rows2 = d.$$('#tab-tables .table-detail .entry-row');
    const shotRow2 = rows2.find((r) => { const inp = r.querySelectorAll('input')[0]; return inp && inp.value === 'Shotgun'; });
    h.check('Shotgun row present for deletion', !!shotRow2, 'rows=' + rows2.length);
    if (shotRow2) {
      const b4 = h.settledPuts(p.tag, LOOT).length;
      d.click(shotRow2.querySelector('button[aria-label="Delete this entry"]'));
      const delReqs = await h.waitSettled(p.tag, LOOT, b4, 1);
      const delBody = delReqs.length ? String(delReqs[delReqs.length - 1].body) : '';
      h.check('Shotgun entry deleted via PUT (no Shotgun left)', !!delReqs.length && delBody.indexOf('Shotgun') === -1, delBody.slice(0, 160));
    }
  }

  // ---- clean up through the Files tab on a fresh page (editor still open on p) ----
  const p2 = await h.page('op-shotgun2');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="files"]'));
  await h.sleep(300);
  const row = d2.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(FPATH) !== -1);
  h.check('file row present for cleanup', !!row, 'rows=' + d2.$$('#tab-files .file-table tbody tr').length);
  if (row) {
    const confBefore = (p2.w.__qaConfirms || []).length;
    d2.click(d2.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p2.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(FPATH) !== -1 && r.status !== 0);
    h.check('logic file deleted (confirm + DELETE 200)', (p2.w.__qaConfirms || []).length > confBefore && del.length === 1 && del[0].status === 200, 'confirms=' + (p2.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
  }
  await h.sleep(300);

  // ---- gates: starter-tables.json byte-identical, tabs clean (checked on the fresh page) ----
  const rawAfterRes = await p2.w.fetch(BASE + 'api/raw?path=' + encodeURIComponent(LOOT));
  const rawAfter = rawAfterRes.ok ? await rawAfterRes.text() : null;
  h.check('tables/starter-tables.json byte-identical after Shotgun removal', rawAfter === rawBefore, rawAfter === null ? 'no text' : 'len before=' + rawBefore.length + ' after=' + rawAfter.length);
  d2.click(d2.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  h.check('logic tab shows only the seed file', JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
  d2.click(d2.$('.tab[data-tab="tables"]'));
  await h.sleep(300);
  const tablePaths = d2.$$('#tab-tables .file-section .file-path').map((s) => s.textContent.trim()).sort();
  h.check('tables tab shows exactly the 1 seed file', JSON.stringify(tablePaths) === JSON.stringify(['tables/starter-tables.json']), 'paths=' + JSON.stringify(tablePaths));
});

// ---------------------------------------------------------------------------
// Scenario: op-imports-bound-ref
//
// Example B driven through the real UI: a generator whose [weapon]
// reference is bound to `weapon` and whose {Determine Rarity} op IMPORTs it —
// the op must reuse the generator's already-rolled result, never reroll.
// rng: one weightedPick call over Longsword w1 / Shotgun w1:
//      0.77 * 2 -> second bucket -> Shotgun.
// Expected: 'You found a Shotgun with Heavy Weapon.'
// ---------------------------------------------------------------------------
scenario('op-imports-bound-ref', async (h) => {
  const STEM = 'qa-op-imports-bound';
  const LPATH = 'logic-ops/' + STEM + '.json';
  const TPATH = 'tables/' + STEM + '.json';
  const GPATH = 'generators/' + STEM + '.json';
  const p = await h.page('op-imports-bound');
  const d = h.dom(p);

  // ---- logic op: Determine Rarity (IMPORT %weapon%, no EXPOSE) ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-logic')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const lcreated = await h.waitSettled(p.tag, LPATH, 0, 1);
  const lrec = lcreated[lcreated.length - 1];
  h.check('logic file created (2xx)', !!lrec && lrec.ok, lrec ? lrec.method + ' ' + lrec.url + ' -> ' + lrec.status : 'no request');
  await h.sleep(300);
  d.click(d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === LPATH));
  await h.sleep(300);
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor opened with name input', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;
  const lb0 = h.settledPuts(p.tag, LPATH).length;
  d.setInput(nameInp, 'Determine Rarity');
  d.change(nameInp);
  await h.waitSettled(p.tag, LPATH, lb0, 1);
  const lsrc = d.$('#tab-logic .script-source');
  d.setInput(lsrc, 'IMPORT %weapon%\nIF weapon == "Shotgun" THEN:\n    SET rarity = "Heavy Weapon"\nELSE:\n    SET rarity = "Other Weapon"');
  d.change(lsrc);
  const lb1 = h.settledPuts(p.tag, LPATH).length;
  await h.waitSettled(p.tag, LPATH, lb1, 1);
  const ltpl = d.$('#tab-logic .script-template-source');
  d.setInput(ltpl, '%rarity%');
  d.change(ltpl);
  const lb2 = h.settledPuts(p.tag, LPATH).length;
  await h.waitSettled(p.tag, LPATH, lb2, 1);

  // ---- table file with a `weapon` container (Longsword w1, Shotgun w1) ----
  d.click(d.$('.tab[data-tab="tables"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-tables')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const tcreated = await h.waitSettled(p.tag, TPATH, 0, 1);
  const trec = tcreated[tcreated.length - 1];
  h.check('table file created (2xx)', !!trec && trec.ok, trec ? trec.method + ' ' + trec.url + ' -> ' + trec.status : 'no request');
  await h.sleep(300);
  const tsec = d.$$('#tab-tables .file-section').find((s) => s.textContent.indexOf(TPATH) !== -1);
  h.check('table file section rendered', !!tsec, 'sections=' + d.$$('#tab-tables .file-section').length);
  if (!tsec) return;
  d.click(d.btnByText('+ new container', tsec));
  await h.sleep(300);
  const tdetail = d.$('#tab-tables .table-detail');
  const nameInput = tdetail && tdetail.querySelector('.table-name-input');
  h.check('new container selected with name input', !!nameInput, 'detail: ' + !!tdetail);
  if (!nameInput) return;
  const tb0 = h.settledPuts(p.tag, TPATH).length;
  d.setInput(nameInput, 'weapon');
  d.change(nameInput);
  await h.waitSettled(p.tag, TPATH, tb0, 1);
  d.click(d.btnByText('+ add entry', d.$('#tab-tables .table-detail')));
  await h.sleep(300);
  let trows = d.$$('#tab-tables .table-detail .entry-row');
  const lwLabel = trows[trows.length - 1].querySelectorAll('input')[0];
  d.setInput(lwLabel, 'Longsword');
  d.change(lwLabel);
  const tb1 = h.settledPuts(p.tag, TPATH).length;
  await h.waitSettled(p.tag, TPATH, tb1, 1);
  d.click(d.btnByText('+ add entry', d.$('#tab-tables .table-detail')));
  await h.sleep(300);
  trows = d.$$('#tab-tables .table-detail .entry-row');
  const sgLabel = trows[trows.length - 1].querySelectorAll('input')[0];
  d.setInput(sgLabel, 'Shotgun');
  d.change(sgLabel);
  const tb2 = h.settledPuts(p.tag, TPATH).length;
  const tReqs = await h.waitSettled(p.tag, TPATH, tb2, 1);
  const tBody = tReqs.length ? String(tReqs[tReqs.length - 1].body) : '';
  h.check('weapon container committed (Longsword + Shotgun in last PUT)', tBody.indexOf('Longsword') !== -1 && tBody.indexOf('Shotgun') !== -1, tBody.slice(0, 160));

  // ---- generator file, advanced mode, template, binding ----
  d.click(d.$('.tab[data-tab="generators"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new generator file', d.$('#tab-generators')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const gcreated = await h.waitSettled(p.tag, GPATH, 0, 1);
  const grec = gcreated[gcreated.length - 1];
  h.check('generator file created (2xx)', !!grec && grec.ok, grec ? grec.method + ' ' + grec.url + ' -> ' + grec.status : 'no request');
  await h.sleep(300);
  const gsec = d.$$('#tab-generators .file-section.gen-file-section').find((s) => s.textContent.indexOf(GPATH) !== -1);
  h.check('generator file section rendered', !!gsec, 'sections=' + d.$$('#tab-generators .file-section.gen-file-section').length);
  if (!gsec) return;
  d.click(d.btnByText('+ add generator', gsec));
  await h.sleep(300);
  const gname = d.$('#tab-generators .gen-name-input');
  h.check('generator editor opened (name input present)', !!gname, 'name input: ' + !!gname);
  if (!gname) return;
  const gb0 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gname, 'OpImportsBound');
  d.change(gname);
  await h.waitSettled(p.tag, GPATH, gb0, 1);
  const modeSel = d.$('#tab-generators .gen-mode-select');
  const gb1 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(modeSel, 'advanced');
  d.change(modeSel);
  await h.waitSettled(p.tag, GPATH, gb1, 1);
  await h.sleep(200);
  const gtpl = d.$('#tab-generators .gen-template');
  const gb2 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gtpl, 'You found a [weapon] with {Determine Rarity}.');
  d.change(gtpl);
  await h.waitSettled(p.tag, GPATH, gb2, 1);
  await h.sleep(200);
  const gbp = d.$('#tab-generators .gen-bindings-panel');
  h.check('bindings panel visible', !!gbp && gbp.hidden === false, 'panel: ' + !!gbp);
  h.check('op row shows no-exposed hint', !!gbp && gbp.textContent.indexOf('no exposed variables') !== -1, gbp ? gbp.textContent.slice(0, 200) : 'no panel');
  const bindInputs = gbp ? d.$$('.gen-binding-input', gbp) : [];
  h.check('one binding input (container row only)', bindInputs.length === 1, 'inputs=' + bindInputs.length);
  if (bindInputs.length !== 1) return;
  const gb3 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(bindInputs[0], 'weapon');
  d.change(bindInputs[0]);
  await h.waitSettled(p.tag, GPATH, gb3, 1);
  const itemB = p.w.__QState.files.get(GPATH) && p.w.__QState.files.get(GPATH).parsed && p.w.__QState.files.get(GPATH).parsed.items[0];
  h.check('in-memory item carries one binding to weapon', !!itemB && itemB.bindings && Object.keys(itemB.bindings).length === 1 && Object.values(itemB.bindings)[0] === 'weapon', itemB ? JSON.stringify(itemB.bindings) : 'no item');

  // ---- run with deterministic rng (one weightedPick call) ----
  p.bridge('window.__qaRng = [0.77]; window.__qaRngI = 0; window.__qaRngReal = window.Math.random; window.Math.random = function () { var v = window.__qaRng[window.__qaRngI % window.__qaRng.length]; window.__qaRngI += 1; return v; };');
  d.click(d.btnByText('Run', d.$('#tab-generators .gen-editor-form')));
  const gRan = await h.poll(() => d.$('#tab-generators .gen-run-area .gen-output') !== null || d.$('#tab-generators .gen-run-area .error') !== null);
  p.bridge('window.Math.random = window.__qaRngReal;');
  h.check('generator run finished', gRan, 'no result rendered');
  const outB = d.$('#tab-generators .gen-run-area .gen-output');
  h.check('exact Example B output in DOM', !!outB && outB.textContent.trim() === 'You found a Shotgun with Heavy Weapon.', outB ? outB.textContent.trim() : 'no .gen-output');
  p.bridge('window.__qaRun = (function(){ var r = state.genLastRun; if (!r) return null; return { ok: r.ok, output: r.output, rolls: (r.rolls || []).map(function(x){ return x && x.entry ? x.entry.label : null; }), exposed: r.exposed, trace: (r.trace || []).map(function(t){ return { n: t.operationName, kids: (t.children || []).map(function(c){ return { kind: c.kind, name: c.name, value: c.value, source: c.source }; }) }; }) }; })();');
  const runB = p.w.__qaRun;
  h.check('run ok', !!runB && runB.ok === true, JSON.stringify(runB && { ok: runB.ok }));
  h.check('no reroll: exactly one roll, Shotgun', !!runB && runB.rolls.length === 1 && runB.rolls[0] === 'Shotgun', JSON.stringify(runB && runB.rolls));
  h.check('binding still exposed: weapon = Shotgun', !!runB && runB.exposed && runB.exposed.weapon === 'Shotgun', JSON.stringify(runB && runB.exposed));
  const opNode = runB ? runB.trace.find((t) => t.n === 'Determine Rarity') : null;
  h.check('op trace records the generator-channel import', !!opNode && opNode.kids.length === 3 && opNode.kids[0].kind === 'import' && opNode.kids[0].name === 'weapon' && opNode.kids[0].value === 'Shotgun' && opNode.kids[0].source === 'generator', JSON.stringify(opNode && opNode.kids[0]));

  // ---- clean up all three files through the Files tab (fresh page: editors still open on p) ----
  const p2 = await h.page('op-imports-bound2');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="files"]'));
  await h.sleep(300);
  for (const f of [GPATH, TPATH, LPATH]) {
    const row = d2.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(f) !== -1);
    h.check('file row present for cleanup: ' + f, !!row, 'rows=' + d2.$$('#tab-files .file-table tbody tr').length);
    if (!row) continue;
    const confBefore = (p2.w.__qaConfirms || []).length;
    d2.click(d2.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p2.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(f) !== -1 && r.status !== 0);
    h.check(f + ' deleted (confirm + DELETE 200)', (p2.w.__qaConfirms || []).length > confBefore && del.length === 1 && del[0].status === 200, 'confirms=' + (p2.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
    await h.sleep(300);
  }
  d2.click(d2.$('.tab[data-tab="generators"]'));
  await h.sleep(300);
  h.check('generators tab shows only the seed file', JSON.stringify(d2.$$('#tab-generators .file-section.gen-file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['generators/starter-generators.json']), 'paths=' + JSON.stringify(d2.$$('#tab-generators .file-section.gen-file-section .file-path').map((s) => s.textContent.trim())));
  d2.click(d2.$('.tab[data-tab="tables"]'));
  await h.sleep(300);
  const tablePaths = d2.$$('#tab-tables .file-section .file-path').map((s) => s.textContent.trim()).sort();
  h.check('tables tab shows exactly the 1 seed file', JSON.stringify(tablePaths) === JSON.stringify(['tables/starter-tables.json']), 'paths=' + JSON.stringify(tablePaths));
  d2.click(d2.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  h.check('logic tab shows only the seed file', JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
});

// ---------------------------------------------------------------------------
// Scenario: binding-reorder-survivor
//
// Example C driven through the real UI: two [weapon] references
// bound independently (weapon / companion_weapon). Reordering the template
// must never silently redirect a binding: the surviving occurrence keeps its
// instance id and its binding, the orphaned one becomes unresolved
// (occurrence-ambiguous), and the rerun keeps the surviving binding on its
// own reference.
// rng per run: [0.5, 0.77] over Sword w2 / Axe w1 (total 3) -> Sword, Axe.
// ---------------------------------------------------------------------------
scenario('binding-reorder-survivor', async (h) => {
  const STEM = 'qa-binding-reorder';
  const TPATH = 'tables/' + STEM + '.json';
  const GPATH = 'generators/' + STEM + '.json';
  const p = await h.page('binding-reorder');
  const d = h.dom(p);

  // ---- table file with `weapon` container: Sword w2, Axe w1 ----
  d.click(d.$('.tab[data-tab="tables"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-tables')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const tcreated = await h.waitSettled(p.tag, TPATH, 0, 1);
  const trec = tcreated[tcreated.length - 1];
  h.check('table file created (2xx)', !!trec && trec.ok, trec ? trec.method + ' ' + trec.url + ' -> ' + trec.status : 'no request');
  await h.sleep(300);
  const tsec = d.$$('#tab-tables .file-section').find((s) => s.textContent.indexOf(TPATH) !== -1);
  h.check('table file section rendered', !!tsec, 'sections=' + d.$$('#tab-tables .file-section').length);
  if (!tsec) return;
  d.click(d.btnByText('+ new container', tsec));
  await h.sleep(300);
  const tdetail = d.$('#tab-tables .table-detail');
  const nameInput = tdetail && tdetail.querySelector('.table-name-input');
  h.check('new container selected with name input', !!nameInput, 'detail: ' + !!tdetail);
  if (!nameInput) return;
  const tb0 = h.settledPuts(p.tag, TPATH).length;
  d.setInput(nameInput, 'weapon');
  d.change(nameInput);
  await h.waitSettled(p.tag, TPATH, tb0, 1);
  d.click(d.btnByText('+ add entry', d.$('#tab-tables .table-detail')));
  await h.sleep(300);
  let trows = d.$$('#tab-tables .table-detail .entry-row');
  const swordLabel = trows[trows.length - 1].querySelectorAll('input')[0];
  d.setInput(swordLabel, 'Sword');
  d.change(swordLabel);
  const tb1 = h.settledPuts(p.tag, TPATH).length;
  await h.waitSettled(p.tag, TPATH, tb1, 1);
  d.click(d.btnByText('+ add entry', d.$('#tab-tables .table-detail')));
  await h.sleep(300);
  trows = d.$$('#tab-tables .table-detail .entry-row');
  const axeLabel = trows[trows.length - 1].querySelectorAll('input')[0];
  d.setInput(axeLabel, 'Axe');
  d.change(axeLabel);
  const tb2 = h.settledPuts(p.tag, TPATH).length;
  await h.waitSettled(p.tag, TPATH, tb2, 1);
  // Sword carries weight 2
  const swordRow = trows.find((r) => { const i = r.querySelectorAll('input')[0]; return i && i.value === 'Sword'; });
  const wInp = swordRow && swordRow.querySelectorAll('input')[1];
  h.check('Sword entry row present for weight edit', !!wInp, 'rows=' + trows.length);
  if (!wInp) return;
  const tb3 = h.settledPuts(p.tag, TPATH).length;
  d.setInput(wInp, '2');
  d.change(wInp);
  const tReqs = await h.waitSettled(p.tag, TPATH, tb3, 1);
  const tBody = tReqs.length ? String(tReqs[tReqs.length - 1].body) : '';
  h.check('weapon container committed (Sword w2 + Axe w1)', tBody.indexOf('Sword') !== -1 && tBody.indexOf('Axe') !== -1 && tBody.indexOf('"weight": 2') !== -1, tBody.slice(0, 160));

  // ---- generator: advanced, two same-token refs, independent bindings ----
  d.click(d.$('.tab[data-tab="generators"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new generator file', d.$('#tab-generators')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const gcreated = await h.waitSettled(p.tag, GPATH, 0, 1);
  const grec = gcreated[gcreated.length - 1];
  h.check('generator file created (2xx)', !!grec && grec.ok, grec ? grec.method + ' ' + grec.url + ' -> ' + grec.status : 'no request');
  await h.sleep(300);
  const gsec = d.$$('#tab-generators .file-section.gen-file-section').find((s) => s.textContent.indexOf(GPATH) !== -1);
  h.check('generator file section rendered', !!gsec, 'sections=' + d.$$('#tab-generators .file-section.gen-file-section').length);
  if (!gsec) return;
  d.click(d.btnByText('+ add generator', gsec));
  await h.sleep(300);
  const gname = d.$('#tab-generators .gen-name-input');
  h.check('generator editor opened (name input present)', !!gname, 'name input: ' + !!gname);
  if (!gname) return;
  const gb0 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gname, 'BindingReorder');
  d.change(gname);
  await h.waitSettled(p.tag, GPATH, gb0, 1);
  const modeSel = d.$('#tab-generators .gen-mode-select');
  const gb1 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(modeSel, 'advanced');
  d.change(modeSel);
  await h.waitSettled(p.tag, GPATH, gb1, 1);
  await h.sleep(200);
  const gtpl = d.$('#tab-generators .gen-template');
  const gb2 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gtpl, 'You found a [weapon], and your companion found a [weapon].');
  d.change(gtpl);
  await h.waitSettled(p.tag, GPATH, gb2, 1);
  await h.sleep(200);
  const gbp = d.$('#tab-generators .gen-bindings-panel');
  const bindInputs = gbp ? d.$$('.gen-binding-input', gbp) : [];
  h.check('two binding inputs, one per occurrence', bindInputs.length === 2, 'inputs=' + bindInputs.length);
  if (bindInputs.length !== 2) return;
  const gb3 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(bindInputs[0], 'weapon');
  d.change(bindInputs[0]);
  await h.waitSettled(p.tag, GPATH, gb3, 1);
  const gb4 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(bindInputs[1], 'companion_weapon');
  d.change(bindInputs[1]);
  const gReqs = await h.waitSettled(p.tag, GPATH, gb4, 1);
  const gBody = gReqs.length ? String(gReqs[gReqs.length - 1].body) : '';
  h.check('both bindings committed (weapon + companion_weapon)', gBody.indexOf('"weapon"') !== -1 && gBody.indexOf('"companion_weapon"') !== -1, gBody.slice(0, 200));

  // capture occurrence ids before the reorder
  p.bridge('window.__qaOccBefore = (function(){ var f = "generators/qa-binding-reorder.json"; var it = state.files.get(f) && state.files.get(f).parsed && state.files.get(f).parsed.items[0]; return it ? it.occurrences.map(function(o){ return o.instanceId; }) : null; })();');
  const occBefore = p.w.__qaOccBefore;
  h.check('two distinct occurrence ids before reorder', Array.isArray(occBefore) && occBefore.length === 2 && occBefore[0] !== occBefore[1], JSON.stringify(occBefore));

  // ---- run 1: both refs roll independently ----
  p.bridge('window.__qaRng = [0.5, 0.77]; window.__qaRngI = 0; window.__qaRngReal = window.Math.random; window.Math.random = function () { var v = window.__qaRng[window.__qaRngI % window.__qaRng.length]; window.__qaRngI += 1; return v; };');
  d.click(d.btnByText('Run', d.$('#tab-generators .gen-editor-form')));
  const cRan1 = await h.poll(() => d.$('#tab-generators .gen-run-area .gen-output') !== null || d.$('#tab-generators .gen-run-area .error') !== null);
  p.bridge('window.Math.random = window.__qaRngReal;');
  h.check('run 1 finished', cRan1, 'no result rendered');
  const outC1 = d.$('#tab-generators .gen-run-area .gen-output');
  h.check('run 1 output: Sword then Axe', !!outC1 && outC1.textContent.trim() === 'You found a Sword, and your companion found a Axe.', outC1 ? outC1.textContent.trim() : 'no .gen-output');
  p.bridge('window.__qaRun = (function(){ var r = state.genLastRun; if (!r) return null; return { ok: r.ok, output: r.output, rolls: (r.rolls || []).map(function(x){ return x && x.entry ? x.entry.label : null; }), exposed: r.exposed }; })();');
  const runC1 = p.w.__qaRun;
  h.check('run 1 rolls independently (Sword, Axe)', !!runC1 && runC1.ok === true && JSON.stringify(runC1.rolls) === JSON.stringify(['Sword', 'Axe']), JSON.stringify(runC1 && runC1.rolls));
  h.check('run 1 exposes both bindings separately', !!runC1 && runC1.exposed && runC1.exposed.weapon === 'Sword' && runC1.exposed.companion_weapon === 'Axe' && Object.keys(runC1.exposed).length === 2, JSON.stringify(runC1 && runC1.exposed));

  // ---- reorder the template ----
  const gtpl2 = d.$('#tab-generators .gen-template');
  const gb5 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gtpl2, 'Your companion found a [weapon], and you found a [weapon].');
  d.change(gtpl2);
  await h.waitSettled(p.tag, GPATH, gb5, 1);
  await h.sleep(300);

  // item state: survivor keeps id + binding; orphaned binding unresolved
  p.bridge('window.__qaC = (function(){ var f = "generators/qa-binding-reorder.json"; var it = state.files.get(f) && state.files.get(f).parsed && state.files.get(f).parsed.items[0]; if (!it) return null; return { occ: it.occurrences.map(function(o){ return o.instanceId; }), bindings: it.bindings, unresolved: it.unresolvedBindings }; })();');
  const cState = p.w.__qaC;
  h.check('reorder keeps the surviving occurrence id on its ref', !!cState && Array.isArray(cState.occ) && cState.occ.length === 2 && cState.occ[1] === occBefore[1] && cState.occ[0] !== occBefore[0], JSON.stringify({ before: occBefore, occ: cState && cState.occ }));
  h.check('bindings reduced to exactly one key (companion_weapon)', !!cState && cState.bindings && Object.keys(cState.bindings).length === 1 && cState.bindings[cState.occ[1]] === 'companion_weapon', JSON.stringify(cState && cState.bindings));
  h.check('orphaned weapon binding is unresolved (occurrence-ambiguous)', !!cState && cState.unresolved && cState.unresolved.length === 1 && cState.unresolved[0].varName === 'weapon' && cState.unresolved[0].reason === 'occurrence-ambiguous', JSON.stringify(cState && cState.unresolved));
  const gbp2 = d.$('#tab-generators .gen-bindings-panel');
  const bindInputs2 = gbp2 ? d.$$('.gen-binding-input', gbp2) : [];
  h.check('binding inputs reordered: unbound first, companion_weapon second', bindInputs2.length === 2 && bindInputs2[0].value === '' && bindInputs2[1].value === 'companion_weapon', JSON.stringify(bindInputs2.map((i) => i.value)));
  h.check('unresolved binding row shown in the panel', !!gbp2 && gbp2.querySelector('.gen-unresolved') !== null && gbp2.textContent.indexOf('ambiguous') !== -1, gbp2 ? gbp2.textContent.slice(0, 200) : 'no panel');

  // ---- run 2: surviving binding stays on its own ref ----
  p.bridge('window.__qaRng = [0.5, 0.77]; window.__qaRngI = 0; window.__qaRngReal = window.Math.random; window.Math.random = function () { var v = window.__qaRng[window.__qaRngI % window.__qaRng.length]; window.__qaRngI += 1; return v; };');
  d.click(d.btnByText('Run', d.$('#tab-generators .gen-editor-form')));
  const cRan2 = await h.poll(() => d.$('#tab-generators .gen-run-area .gen-output') !== null || d.$('#tab-generators .gen-run-area .error') !== null);
  p.bridge('window.Math.random = window.__qaRngReal;');
  h.check('run 2 finished', cRan2, 'no result rendered');
  const outC2 = d.$('#tab-generators .gen-run-area .gen-output');
  h.check('run 2 output: companion Sword, you Axe', !!outC2 && outC2.textContent.trim() === 'Your companion found a Sword, and you found a Axe.', outC2 ? outC2.textContent.trim() : 'no .gen-output');
  p.bridge('window.__qaRun = (function(){ var r = state.genLastRun; if (!r) return null; return { ok: r.ok, output: r.output, rolls: (r.rolls || []).map(function(x){ return x && x.entry ? x.entry.label : null; }), exposed: r.exposed }; })();');
  const runC2 = p.w.__qaRun;
  h.check('run 2 rolls at both positions (Sword, Axe)', !!runC2 && runC2.ok === true && JSON.stringify(runC2.rolls) === JSON.stringify(['Sword', 'Axe']), JSON.stringify(runC2 && runC2.rolls));
  h.check('run 2 exposes only companion_weapon = Axe', !!runC2 && runC2.exposed && runC2.exposed.companion_weapon === 'Axe' && Object.keys(runC2.exposed).length === 1, JSON.stringify(runC2 && runC2.exposed));

  // ---- clean up both files through the Files tab (fresh page: editor still open on p) ----
  const p2 = await h.page('binding-reorder2');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="files"]'));
  await h.sleep(300);
  for (const f of [GPATH, TPATH]) {
    const row = d2.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(f) !== -1);
    h.check('file row present for cleanup: ' + f, !!row, 'rows=' + d2.$$('#tab-files .file-table tbody tr').length);
    if (!row) continue;
    const confBefore = (p2.w.__qaConfirms || []).length;
    d2.click(d2.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p2.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(f) !== -1 && r.status !== 0);
    h.check(f + ' deleted (confirm + DELETE 200)', (p2.w.__qaConfirms || []).length > confBefore && del.length === 1 && del[0].status === 200, 'confirms=' + (p2.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
    await h.sleep(300);
  }
  d2.click(d2.$('.tab[data-tab="generators"]'));
  await h.sleep(300);
  h.check('generators tab shows only the seed file', JSON.stringify(d2.$$('#tab-generators .file-section.gen-file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['generators/starter-generators.json']), 'paths=' + JSON.stringify(d2.$$('#tab-generators .file-section.gen-file-section .file-path').map((s) => s.textContent.trim())));
  d2.click(d2.$('.tab[data-tab="tables"]'));
  await h.sleep(300);
  const tablePaths = d2.$$('#tab-tables .file-section .file-path').map((s) => s.textContent.trim()).sort();
  h.check('tables tab shows exactly the 1 seed file', JSON.stringify(tablePaths) === JSON.stringify(['tables/starter-tables.json']), 'paths=' + JSON.stringify(tablePaths));
});

// ---------------------------------------------------------------------------
// Scenario: op-chain-forward-dependency
//
// Example D driven through the real UI: a generator chaining two
// logic ops in template order, {Logic1} then {Logic2}. Success phase:
// Logic1 produces rarity, Logic2 IMPORTs it. Forward-dependency phase
// (both scripts flipped): Logic1 imports a value nothing earlier bound or
// exposed, so it must fail with a missing-import error, its token stays
// literal, Logic2 still runs, and the engine never silently reorders the
// ops. No containers -> no rng calls.
// ---------------------------------------------------------------------------
scenario('op-chain-forward-dependency', async (h) => {
  const STEM = 'qa-op-chain-fwd';
  const LPATH = 'logic-ops/' + STEM + '.json';
  const GPATH = 'generators/' + STEM + '.json';
  const p = await h.page('op-chain-fwd');
  const d = h.dom(p);

  // ---- logic file with Logic1 (producer) and Logic2 (importer) ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-logic')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const lcreated = await h.waitSettled(p.tag, LPATH, 0, 1);
  const lrec = lcreated[lcreated.length - 1];
  h.check('logic file created (2xx)', !!lrec && lrec.ok, lrec ? lrec.method + ' ' + lrec.url + ' -> ' + lrec.status : 'no request');
  await h.sleep(300);
  d.click(d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === LPATH));
  await h.sleep(300);
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor opened (Logic1 name input)', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;
  const lb0 = h.settledPuts(p.tag, LPATH).length;
  d.setInput(nameInp, 'Logic1');
  d.change(nameInp);
  await h.waitSettled(p.tag, LPATH, lb0, 1);
  const lsrc1 = d.$('#tab-logic .script-source');
  d.setInput(lsrc1, 'SET rarity = "Legendary"\nEXPOSE rarity');
  d.change(lsrc1);
  const lb1 = h.settledPuts(p.tag, LPATH).length;
  await h.waitSettled(p.tag, LPATH, lb1, 1);
  const ltpl1 = d.$('#tab-logic .script-template-source');
  d.setInput(ltpl1, '%rarity%');
  d.change(ltpl1);
  const lb2 = h.settledPuts(p.tag, LPATH).length;
  await h.waitSettled(p.tag, LPATH, lb2, 1);

  // second op while the first editor stays open (rows + add button stay in DOM)
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp2 = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor switched to the new op (Logic2 name input)', !!nameInp2, 'name input: ' + !!nameInp2);
  if (!nameInp2) return;
  const lb3 = h.settledPuts(p.tag, LPATH).length;
  d.setInput(nameInp2, 'Logic2');
  d.change(nameInp2);
  await h.waitSettled(p.tag, LPATH, lb3, 1);
  const lsrc2 = d.$('#tab-logic .script-source');
  d.setInput(lsrc2, 'IMPORT %rarity%\nEXPOSE rarity');
  d.change(lsrc2);
  const lb4 = h.settledPuts(p.tag, LPATH).length;
  await h.waitSettled(p.tag, LPATH, lb4, 1);
  const ltpl2 = d.$('#tab-logic .script-template-source');
  d.setInput(ltpl2, '%rarity%');
  d.change(ltpl2);
  const lb5 = h.settledPuts(p.tag, LPATH).length;
  const lReqs = await h.waitSettled(p.tag, LPATH, lb5, 1);
  const lBody = lReqs.length ? String(lReqs[lReqs.length - 1].body) : '';
  h.check('both ops persisted (Logic1 producer, Logic2 importer)', lBody.indexOf('Logic1') !== -1 && lBody.indexOf('Logic2') !== -1 && lBody.indexOf('SET rarity') !== -1 && lBody.indexOf('IMPORT %rarity%') !== -1 && lBody.indexOf('EXPOSE rarity') !== -1, lBody.slice(0, 240));

  // ---- generator (basic mode): template references both ops in order ----
  d.click(d.$('.tab[data-tab="generators"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new generator file', d.$('#tab-generators')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const gcreated = await h.waitSettled(p.tag, GPATH, 0, 1);
  const grec = gcreated[gcreated.length - 1];
  h.check('generator file created (2xx)', !!grec && grec.ok, grec ? grec.method + ' ' + grec.url + ' -> ' + grec.status : 'no request');
  await h.sleep(300);
  const gsec = d.$$('#tab-generators .file-section.gen-file-section').find((s) => s.textContent.indexOf(GPATH) !== -1);
  h.check('generator file section rendered', !!gsec, 'sections=' + d.$$('#tab-generators .file-section.gen-file-section').length);
  if (!gsec) return;
  d.click(d.btnByText('+ add generator', gsec));
  await h.sleep(300);
  const gname = d.$('#tab-generators .gen-name-input');
  h.check('generator editor opened (name input present)', !!gname, 'name input: ' + !!gname);
  if (!gname) return;
  const gb0 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gname, 'OpChainFwd');
  d.change(gname);
  await h.waitSettled(p.tag, GPATH, gb0, 1);
  const gtpl = d.$('#tab-generators .gen-template');
  const gb1 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gtpl, 'Example generator {Logic1} template {Logic2}');
  d.change(gtpl);
  await h.waitSettled(p.tag, GPATH, gb1, 1);

  // ---- run 1 (success): Logic2 imports what Logic1 exposed ----
  d.click(d.btnByText('Run', d.$('#tab-generators .gen-editor-form')));
  const dRan1 = await h.poll(() => d.$('#tab-generators .gen-run-area .gen-output') !== null || d.$('#tab-generators .gen-run-area .error') !== null);
  h.check('run 1 finished', dRan1, 'no result rendered');
  const outD1 = d.$('#tab-generators .gen-run-area .gen-output');
  h.check('exact Example D success output', !!outD1 && outD1.textContent.trim() === 'Example generator Legendary template Legendary', outD1 ? outD1.textContent.trim() : 'no .gen-output');
  p.bridge('window.__qaRun = (function(){ var r = state.genLastRun; if (!r) return null; return { ok: r.ok, output: r.output, rolls: (r.rolls || []).length, exposed: r.exposed, trace: (r.trace || []).map(function(t){ return { n: t.operationName, kids: (t.children || []).map(function(c){ return { kind: c.kind, name: c.name, value: c.value, source: c.source }; }) }; }) }; })();');
  const runD1 = p.w.__qaRun;
  h.check('run 1 ok, no rolls (no containers)', !!runD1 && runD1.ok === true && runD1.rolls === 0, JSON.stringify(runD1 && { ok: runD1.ok, rolls: runD1.rolls }));
  const traceNames1 = runD1 ? runD1.trace.map((t) => t.n) : [];
  h.check('trace runs Logic1 then Logic2 (template order)', JSON.stringify(traceNames1) === JSON.stringify(['Logic1', 'Logic2']), JSON.stringify(traceNames1));
  const node2 = runD1 ? runD1.trace.find((t) => t.n === 'Logic2') : null;
  h.check('Logic2 trace records the import of the exposed rarity', !!node2 && node2.kids.length >= 1 && node2.kids[0].kind === 'import' && node2.kids[0].name === 'rarity' && node2.kids[0].value === 'Legendary' && node2.kids[0].source === 'generator', JSON.stringify(node2 && node2.kids[0]));
  // genLastRun.exposed carries bound container values only; ops EXPOSE into
  // the run namespace (consumed by later ops), not the generator level.
  h.check('no generator-level exposed values (no containers bound)', !!runD1 && runD1.exposed && Object.keys(runD1.exposed).length === 0, JSON.stringify(runD1 && runD1.exposed));

  // ---- flip both ops: Logic1 becomes the importer, Logic2 the producer ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  let flipRows = d.$$('#tab-logic .logic-op-row');
  if (flipRows.length === 0) {
    const pathSpan = d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === LPATH);
    if (pathSpan) { d.click(pathSpan); await h.sleep(300); flipRows = d.$$('#tab-logic .logic-op-row'); }
  }
  h.check('both op rows listed for the flip', flipRows.length === 2, 'rows=' + flipRows.length);
  if (flipRows.length !== 2) return;
  const rowOf = (n) => flipRows.find((r) => { const s = r.querySelector('.logic-op-name'); return s && s.textContent.trim() === n; });
  const r1 = rowOf('Logic1');
  h.check('Logic1 row present', !!r1, 'rows=' + flipRows.map((r) => { const s = r.querySelector('.logic-op-name'); return s ? s.textContent.trim() : '?'; }).join(', '));
  if (!r1) return;
  d.click(r1);
  await h.sleep(300);
  const fsrc1 = d.$('#tab-logic .logic-editor .script-source');
  h.check('Logic1 editor open', !!fsrc1, 'editor: ' + !!d.$('#tab-logic .logic-editor'));
  if (!fsrc1) return;
  const fb0 = h.settledPuts(p.tag, LPATH).length;
  d.setInput(fsrc1, 'IMPORT %rarity%');
  d.change(fsrc1);
  await h.waitSettled(p.tag, LPATH, fb0, 1);
  // op rows remain in the DOM while an editor is open; switch to Logic2
  const flipRows2 = d.$$('#tab-logic .logic-op-row');
  const r2 = flipRows2.find((r) => { const s = r.querySelector('.logic-op-name'); return s && s.textContent.trim() === 'Logic2'; });
  h.check('Logic2 row still listed while editor open', !!r2, 'rows=' + flipRows2.length);
  if (!r2) return;
  d.click(r2);
  await h.sleep(300);
  const fsrc2 = d.$('#tab-logic .logic-editor .script-source');
  if (!fsrc2) return;
  const fb1 = h.settledPuts(p.tag, LPATH).length;
  d.setInput(fsrc2, 'SET rarity = "Legendary"\nEXPOSE rarity');
  d.change(fsrc2);
  const fReqs = await h.waitSettled(p.tag, LPATH, fb1, 1);
  const fBody = fReqs.length ? String(fReqs[fReqs.length - 1].body) : '';
  h.check('flipped scripts persisted (Logic1 imports, Logic2 produces)', fBody.indexOf('IMPORT %rarity%') !== -1 && fBody.indexOf('SET rarity') !== -1 && fBody.indexOf('EXPOSE rarity') !== -1, fBody.slice(0, 240));

  // ---- back to the generator editor and run again (forward dependency) ----
  d.click(d.$('.tab[data-tab="generators"]'));
  await h.sleep(300);
  let gform = d.$('#tab-generators .gen-editor-form');
  if (!gform) {
    const editBtns = d.$$('#tab-generators button').filter((b) => b.textContent.trim() === 'Edit');
    for (const b of editBtns) {
      let host = b.parentElement;
      while (host && host.id !== 'tab-generators' && host.textContent.indexOf('OpChainFwd') === -1) host = host.parentElement;
      if (host) { d.click(b); break; }
    }
    await h.sleep(300);
    gform = d.$('#tab-generators .gen-editor-form');
  }
  h.check('generator editor available for the failure run', !!gform, 'form: ' + !!gform);
  if (!gform) return;
  d.click(d.btnByText('Run', gform));
  // poll on .error only: the stale .gen-output from run 1 is still in the DOM
  const dRan2 = await h.poll(() => d.$('#tab-generators .gen-run-area .error') !== null);
  h.check('failure run rendered', dRan2, 'no result rendered');
  const area = d.$('#tab-generators .gen-run-area');
  const errEl = area ? area.querySelector('.error') : null;
  h.check('failure run shows an error and the stale success label', !!errEl && !!area && area.textContent.indexOf('Last successful output') !== -1, errEl ? errEl.textContent.slice(0, 200) : 'no .error');
  h.check('error names the missing import', !!errEl && errEl.textContent.indexOf('rarity') !== -1 && errEl.textContent.indexOf('no earlier part of the run supplied it') !== -1, errEl ? errEl.textContent.slice(0, 300) : 'no .error');
  p.bridge('window.__qaRunF = (function(){ var r = state.genLastRun; if (!r) return null; return { ok: r.ok, output: r.output, traceLen: (r.trace || []).length, rolls: (r.rolls || []).length, exposed: r.exposed, errors: (r.errors || []).map(function(e){ return { kind: e.kind, token: e.token, operationName: e.operationName, varName: e.varName }; }) }; })();');
  const runF = p.w.__qaRunF;
  h.check('genLastRun ok=false with ok-gated empties', !!runF && runF.ok === false && runF.output === '' && runF.traceLen === 0 && runF.rolls === 0, JSON.stringify(runF && { ok: runF.ok, output: runF.output, traceLen: runF.traceLen }));
  h.check('exposed is empty on failure', !!runF && runF.exposed && Object.keys(runF.exposed).length === 0, JSON.stringify(runF && runF.exposed));
  h.check('single missing-import error for {Logic1}/rarity', !!runF && runF.errors.length === 1 && runF.errors[0].kind === 'missing-import' && runF.errors[0].token === '{Logic1}' && runF.errors[0].operationName === 'Logic1' && runF.errors[0].varName === 'rarity', JSON.stringify(runF && runF.errors));

  // ---- raw re-run in the page realm: partial output, Logic2-only trace ----
  p.bridge('window.__qaPart = (function(){ var f = "generators/qa-op-chain-fwd.json"; var it = state.files.get(f) && state.files.get(f).parsed && state.files.get(f).parsed.items[0]; if (!it) return null; var r = GeneratorEngine.runGenerator(it, engineContainers(), genRollEntry, entryEmbedContext(f)); return { output: r.output, trace: (r.trace || []).map(function(t){ return t.operationName; }), errors: (r.errors || []).map(function(e){ return e.kind + "|" + e.token + "|" + e.operationName; }) }; })();');
  const part = p.w.__qaPart;
  h.check('raw run keeps {Logic1} literal but still runs Logic2', !!part && part.output === 'Example generator {Logic1} template Legendary' && JSON.stringify(part.trace) === JSON.stringify(['Logic2']) && JSON.stringify(part.errors) === JSON.stringify(['missing-import|{Logic1}|Logic1']), JSON.stringify(part));

  // ---- clean up both files through the Files tab (fresh page: editors still open on p) ----
  const p2 = await h.page('op-chain-fwd2');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="files"]'));
  await h.sleep(300);
  for (const f of [GPATH, LPATH]) {
    const row = d2.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(f) !== -1);
    h.check('file row present for cleanup: ' + f, !!row, 'rows=' + d2.$$('#tab-files .file-table tbody tr').length);
    if (!row) continue;
    const confBefore = (p2.w.__qaConfirms || []).length;
    d2.click(d2.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p2.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(f) !== -1 && r.status !== 0);
    h.check(f + ' deleted (confirm + DELETE 200)', (p2.w.__qaConfirms || []).length > confBefore && del.length === 1 && del[0].status === 200, 'confirms=' + (p2.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
    await h.sleep(300);
  }
  d2.click(d2.$('.tab[data-tab="generators"]'));
  await h.sleep(300);
  h.check('generators tab shows only the seed file', JSON.stringify(d2.$$('#tab-generators .file-section.gen-file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['generators/starter-generators.json']), 'paths=' + JSON.stringify(d2.$$('#tab-generators .file-section.gen-file-section .file-path').map((s) => s.textContent.trim())));
  d2.click(d2.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  h.check('logic tab shows only the seed file', JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
});

// ---------------------------------------------------------------------------
// Scenario: output-template-literal-parens
//
// Example E driven through the real UI: the exact documented
// Output Template in a logic op,
//   %rarity% %weapon% (%base_damage% Base damage)
// Parentheses must remain literal punctuation, and no syntax other than
// %variable% may be interpreted in the Output Template field (every
// character that is not a %name% span is literal). No containers -> no rng.
// ---------------------------------------------------------------------------
scenario('output-template-literal-parens', async (h) => {
  const FILE = 'qa-output-template-parens';
  const FPATH = 'logic-ops/' + FILE + '.json';
  const p = await h.page('output-template-parens');
  const d = h.dom(p);

  // ---- create the logic file through the UI ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-logic')));
  await h.sleep(200);
  const dlg = d.$('#ask-text-panel input.field');
  h.check('askText modal for logic file', !!dlg, 'modal input: ' + !!dlg);
  d.setInput(dlg, FILE);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const created = await h.waitSettled(p.tag, FPATH, 0, 1);
  const crec = created[created.length - 1];
  h.check('logic file created (2xx)', !!crec && crec.ok, crec ? crec.method + ' ' + crec.url + ' -> ' + crec.status : 'no request');
  await h.sleep(300);

  // ---- open the file and add the Example E operation ----
  const pathSpan = d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH);
  h.check('logic file section rendered', !!pathSpan, 'sections: ' + d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).join(', '));
  d.click(pathSpan);
  await h.sleep(300);
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor opened with name input', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;
  const b0 = h.settledPuts(p.tag, FPATH).length;
  d.setInput(nameInp, 'E Punct');
  d.change(nameInp);
  await h.waitSettled(p.tag, FPATH, b0, 1);
  const src = d.$('#tab-logic .script-source');
  d.setInput(src, 'SET rarity = "Legendary"\nSET weapon = "Shotgun"\nSET base_damage = 46');
  d.change(src);
  const b1 = h.settledPuts(p.tag, FPATH).length;
  await h.waitSettled(p.tag, FPATH, b1, 1);

  // ---- the exact Example E template: parentheses are literal punctuation ----
  const tpl = d.$('#tab-logic .script-template-source');
  d.setInput(tpl, '%rarity% %weapon% (%base_damage% Base damage)');
  d.change(tpl);
  const b2 = h.settledPuts(p.tag, FPATH).length;
  const tplReqs = await h.waitSettled(p.tag, FPATH, b2, 1);
  let putItem = null;
  try { putItem = tplReqs.length ? JSON.parse(String(tplReqs[tplReqs.length - 1].body)) : null; } catch (_) { /* handled below */ }
  h.check('template persisted byte-identical (parentheses intact in the PUT)', !!putItem && Array.isArray(putItem.items) && putItem.items[0].outputTemplate === '%rarity% %weapon% (%base_damage% Base damage)', putItem ? 'tpl=' + JSON.stringify(putItem.items[0].outputTemplate) : 'no JSON body');
  await h.sleep(200);

  // ---- run the test: variables resolve, parentheses survive ----
  const panel = d.$('#tab-logic .logic-test-panel');
  h.check('test panel in DOM', !!panel, 'panel: ' + !!panel);
  if (!panel) return;
  h.check('no test inputs needed (no imports)', panel.textContent.indexOf('No imported variables') !== -1, panel.textContent.slice(0, 200));
  d.click(d.btnByText('run test', panel));
  const ran = await h.poll(() => d.$$('#tab-logic .logic-test-result .test-output').some((o) => o.textContent.indexOf('Legendary Shotgun') !== -1));
  h.check('test run finished', ran, 'no result rendered');
  const out1 = d.$$('#tab-logic .logic-test-result .test-output').find((o) => o.textContent.trim() === 'Output Template: Legendary Shotgun (46 Base damage)') || null;
  h.check('exact Example E output with literal parentheses', !!out1, d.$('#tab-logic .logic-test-result .test-output') ? d.$('#tab-logic .logic-test-result .test-output').textContent.trim() : 'no .test-output');
  const res1 = d.$('#tab-logic .logic-test-result');
  h.check('run ok (no error shown)', !!res1 && res1.querySelector('.test-error') === null && res1.querySelector('.test-ok') !== null, res1 ? res1.textContent.slice(0, 200) : 'no result');

  // ---- no syntax other than %variable% is interpreted: container refs,
  //      op refs and operators must all render as literal text ----
  const tpl2 = d.$('#tab-logic .script-template-source');
  d.setInput(tpl2, '%rarity% [chest] {Logic1} && %weapon%');
  d.change(tpl2);
  const b3 = h.settledPuts(p.tag, FPATH).length;
  const tpl2Reqs = await h.waitSettled(p.tag, FPATH, b3, 1);
  putItem = null;
  try { putItem = tpl2Reqs.length ? JSON.parse(String(tpl2Reqs[tpl2Reqs.length - 1].body)) : null; } catch (_) { /* handled below */ }
  h.check('second template persisted byte-identical', !!putItem && Array.isArray(putItem.items) && putItem.items[0].outputTemplate === '%rarity% [chest] {Logic1} && %weapon%', putItem ? 'tpl=' + JSON.stringify(putItem.items[0].outputTemplate) : 'no JSON body');
  d.click(d.btnByText('run test', d.$('#tab-logic .logic-test-panel')));
  const ran2 = await h.poll(() => d.$$('#tab-logic .logic-test-result .test-output').some((o) => o.textContent.indexOf('[chest]') !== -1));
  h.check('second run finished', ran2, 'no result rendered');
  const out2 = d.$$('#tab-logic .logic-test-result .test-output').find((o) => o.textContent.trim() === 'Output Template: Legendary [chest] {Logic1} && Shotgun') || null;
  h.check('no other syntax interpreted: [chest], {Logic1} and && stay literal', !!out2, d.$('#tab-logic .logic-test-result .test-output') ? d.$('#tab-logic .logic-test-result .test-output').textContent.trim() : 'no .test-output');

  // ---- clean up through the Files tab (fresh page: editor still open on p) ----
  const p2 = await h.page('output-template-parens2');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="files"]'));
  await h.sleep(300);
  const row = d2.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(FPATH) !== -1);
  h.check('file row present for cleanup', !!row, 'rows=' + d2.$$('#tab-files .file-table tbody tr').length);
  if (row) {
    const confBefore = (p2.w.__qaConfirms || []).length;
    d2.click(d2.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p2.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(FPATH) !== -1 && r.status !== 0);
    h.check('logic file deleted (confirm + DELETE 200)', (p2.w.__qaConfirms || []).length > confBefore && del.length === 1 && del[0].status === 200, 'confirms=' + (p2.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
  }
  await h.sleep(300);
  d2.click(d2.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  h.check('logic tab shows only the seed file', JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
});

// ---------------------------------------------------------------------------
// Scenario: comments-round-trip
//
// Example F driven through the real UI: a script containing
// comments, blank lines and conditional blocks must execute correctly and
// preserve its comments and formatting through save/load and import/export
// (byte-identical at every step). Importing the exported bundle while an
// op with the same name exists must rename the imported op (collision
// guard) without touching its script.
// ---------------------------------------------------------------------------
scenario('comments-round-trip', async (h) => {
  const FILE = 'qa-comments-round-trip';
  const FPATH = 'logic-ops/' + FILE + '.json';
  const FPATH2 = 'logic-ops/' + FILE + '-2.json';
  const SCRIPT = '# pick the rarity from the damage\n\nSET base_damage = 46\n\nIF base_damage > 45 THEN:\n    SET rarity = "Legendary"\nELSE:\n    SET rarity = "Common"\n\n# expose the result\nEXPOSE rarity';
  const p = await h.page('comments-round-trip');
  const d = h.dom(p);

  // ---- create the logic file through the UI ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-logic')));
  await h.sleep(200);
  const dlg = d.$('#ask-text-panel input.field');
  h.check('askText modal for logic file', !!dlg, 'modal input: ' + !!dlg);
  d.setInput(dlg, FILE);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const created = await h.waitSettled(p.tag, FPATH, 0, 1);
  const crec = created[created.length - 1];
  h.check('logic file created (2xx)', !!crec && crec.ok, crec ? crec.method + ' ' + crec.url + ' -> ' + crec.status : 'no request');
  await h.sleep(300);

  // ---- open the file and add the Example F operation ----
  const pathSpan = d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH);
  h.check('logic file section rendered', !!pathSpan, 'sections: ' + d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).join(', '));
  d.click(pathSpan);
  await h.sleep(300);
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor opened with name input', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;
  const b0 = h.settledPuts(p.tag, FPATH).length;
  d.setInput(nameInp, 'F Persist');
  d.change(nameInp);
  await h.waitSettled(p.tag, FPATH, b0, 1);
  const src = d.$('#tab-logic .script-source');
  d.setInput(src, SCRIPT);
  d.change(src);
  const b1 = h.settledPuts(p.tag, FPATH).length;
  const scriptReqs = await h.waitSettled(p.tag, FPATH, b1, 1);
  let putItem = null;
  try { putItem = scriptReqs.length ? JSON.parse(String(scriptReqs[scriptReqs.length - 1].body)) : null; } catch (_) { /* handled below */ }
  h.check('script with comments + blank lines + IF block persisted byte-identical (save)', !!putItem && Array.isArray(putItem.items) && putItem.items[0].script === SCRIPT, putItem ? 'script=' + JSON.stringify(putItem.items[0].script).slice(0, 200) : 'no JSON body');
  const tpl = d.$('#tab-logic .script-template-source');
  d.setInput(tpl, '%rarity%');
  d.change(tpl);
  const b2 = h.settledPuts(p.tag, FPATH).length;
  await h.waitSettled(p.tag, FPATH, b2, 1);
  await h.sleep(200);

  // ---- execute: the commented script must still run correctly ----
  const panel = d.$('#tab-logic .logic-test-panel');
  h.check('test panel in DOM', !!panel, 'panel: ' + !!panel);
  if (!panel) return;
  h.check('no test inputs needed (no imports)', panel.textContent.indexOf('No imported variables') !== -1, panel.textContent.slice(0, 200));
  d.click(d.btnByText('run test', panel));
  const ran = await h.poll(() => d.$$('#tab-logic .logic-test-result .test-output').some((o) => o.textContent.indexOf('Legendary') !== -1));
  h.check('commented script executes correctly (output "Legendary")', ran && d.$$('#tab-logic .logic-test-result .test-output').some((o) => o.textContent.trim() === 'Output Template: Legendary'), 'no result rendered');
  const res = d.$('#tab-logic .logic-test-result');
  h.check('run ok (no error shown)', !!res && res.querySelector('.test-error') === null && res.querySelector('.test-ok') !== null, res ? res.textContent.slice(0, 200) : 'no result');

  // ---- on-disk copy byte-identical (comments + blank lines survive save) ----
  const rawRes = await p.w.fetch(BASE + 'api/raw?path=' + encodeURIComponent(FPATH));
  let rawItem = null;
  try { rawItem = rawRes.ok ? (JSON.parse(await rawRes.text())).items[0] : null; } catch (_) { /* handled below */ }
  h.check('script on disk byte-identical after save', !!rawItem && rawItem.script === SCRIPT, rawItem ? 'script=' + JSON.stringify(rawItem.script).slice(0, 200) : 'no raw json');

  // ---- save/load: close the editor, reopen the op on a fresh page ----
  d.click(d.btnByText('close editor', d.$('#tab-logic .logic-editor')));
  await h.sleep(400);
  const p2 = await h.page('comments-round-trip2');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  const path2 = d2.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH);
  h.check('logic file listed after reload', !!path2, 'sections: ' + d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).join(', '));
  if (path2) {
    d2.click(path2);
    await h.sleep(300);
    const opRow = d2.$('#tab-logic .logic-op-row');
    h.check('op row listed after reload', !!opRow, 'rows=' + d2.$$('#tab-logic .logic-op-row').length);
    if (opRow) {
      d2.click(opRow);
      await h.sleep(300);
      const src2 = d2.$('#tab-logic .script-source');
      h.check('script reloaded byte-identical (load preserves comments + blank lines)', !!src2 && src2.value === SCRIPT, src2 ? 'value=' + JSON.stringify(src2.value).slice(0, 200) : 'no script source');
    }
  }

  // ---- export: the bundle payload carries the exact script ----
  p2.bridge('window.__qaBundle = (function(){ var f = "logic-ops/qa-comments-round-trip.json"; var it = state.files.get(f) && state.files.get(f).parsed && state.files.get(f).parsed.items[0]; if (!it) return null; return JSON.stringify(buildLogicOpsBundle([it])); })();');
  const payload = p2.w.__qaBundle;
  let bundle = null;
  try { bundle = typeof payload === 'string' ? JSON.parse(payload) : null; } catch (_) { /* handled below */ }
  h.check('export payload built (kind ttrpg-logic-ops + one operation)', !!bundle && bundle.kind === 'ttrpg-logic-ops' && Array.isArray(bundle.operations) && bundle.operations.length === 1, bundle ? 'kind=' + bundle.kind + ' ops=' + (Array.isArray(bundle.operations) ? bundle.operations.length : 'n/a') : 'no payload');
  h.check('exported script byte-identical', !!bundle && bundle.operations[0].script === SCRIPT, bundle && bundle.operations[0] ? 'script=' + JSON.stringify(bundle.operations[0].script).slice(0, 200) : 'no op');

  // ---- import: dropping the exported bundle must land at <stem>-2 with the
  //      script byte-identical (the op is renamed on the name clash) ----
  const confBefore = (p2.w.__qaConfirms || []).length;
  await p2.w.handleDroppedFiles([{ name: FILE + '.json', text: async () => payload }]);
  const imported = await h.waitSettled(p2.tag, FPATH2, 0, 1);
  const crec2 = imported[imported.length - 1];
  h.check('import creates ' + FPATH2 + ' (POST 2xx)', !!crec2 && crec2.ok, crec2 ? crec2.method + ' ' + crec2.url + ' -> ' + crec2.status : 'no request');
  h.check('name-clash confirm shown and accepted (shimmed true)', (p2.w.__qaConfirms || []).length > confBefore && (p2.w.__qaConfirms || []).some((m) => m.indexOf('Name clash') !== -1 && m.indexOf('F Persist') !== -1), JSON.stringify((p2.w.__qaConfirms || []).slice(confBefore)).slice(0, 200));
  await h.sleep(300);
  const toastEl = d2.$('#toast');
  const toastTxt = toastEl ? toastEl.textContent : '';
  h.check('import toast reports the rename into ' + FPATH2, !!toastEl && toastEl.hidden === false && toastTxt.indexOf('Imported') !== -1 && toastTxt.indexOf(FPATH2) !== -1 && toastTxt.indexOf('renamed') !== -1, toastTxt.slice(0, 200) || 'no toast');
  const impEntry = p2.w.__QState.files.get(FPATH2);
  h.check('imported script byte-identical (import/export round trip)', !!impEntry && impEntry.parsed && Array.isArray(impEntry.parsed.items) && impEntry.parsed.items[0].script === SCRIPT, impEntry && impEntry.parsed ? 'script=' + JSON.stringify(impEntry.parsed.items[0].script).slice(0, 200) : 'no entry');
  h.check('imported op renamed on clash, template byte-identical', !!impEntry && impEntry.parsed.items[0].name === 'F Persist (imported)' && impEntry.parsed.items[0].outputTemplate === '%rarity%', impEntry && impEntry.parsed ? JSON.stringify({ name: impEntry.parsed.items[0].name, tpl: impEntry.parsed.items[0].outputTemplate }) : 'no entry');

  // ---- clean up both files through the Files tab (fresh page: editor still open on p2) ----
  const p3 = await h.page('comments-round-trip3');
  const d3 = h.dom(p3);
  d3.click(d3.$('.tab[data-tab="files"]'));
  await h.sleep(300);
  for (const f of [FPATH2, FPATH]) {
    const row = d3.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(f) !== -1);
    h.check('file row present for cleanup: ' + f, !!row, 'rows=' + d3.$$('#tab-files .file-table tbody tr').length);
    if (!row) continue;
    const confBefore3 = (p3.w.__qaConfirms || []).length;
    d3.click(d3.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p3.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(f) !== -1 && r.status !== 0);
    h.check(f + ' deleted (confirm + DELETE 200)', (p3.w.__qaConfirms || []).length > confBefore3 && del.length === 1 && del[0].status === 200, 'confirms=' + (p3.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
    await h.sleep(300);
  }
  d3.click(d3.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  h.check('logic tab shows only the seed file', JSON.stringify(d3.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d3.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
});

// ---------------------------------------------------------------------------
// Scenario: basic-generator-roll
//
// Example G driven through the real UI: an existing basic generator
// works end to end with no variable assignments, no Logic operations and no
// scripting knowledge — a basic-mode generator whose template references a
// container rolls it and renders the entry.
// rng: one weightedPick over Sword w1 / Axe w1 (total 2): floor(0.25 * 2) = 0 -> Sword.
// ---------------------------------------------------------------------------
scenario('basic-generator-roll', async (h) => {
  const STEM = 'qa-basic-generator-roll';
  const TPATH = 'tables/' + STEM + '.json';
  const GPATH = 'generators/' + STEM + '.json';
  const p = await h.page('basic-generator-roll');
  const d = h.dom(p);

  // ---- table file with a `weapon` container: Sword w1, Axe w1 ----
  d.click(d.$('.tab[data-tab="tables"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-tables')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const tcreated = await h.waitSettled(p.tag, TPATH, 0, 1);
  const trec = tcreated[tcreated.length - 1];
  h.check('table file created (2xx)', !!trec && trec.ok, trec ? trec.method + ' ' + trec.url + ' -> ' + trec.status : 'no request');
  await h.sleep(300);
  const tsec = d.$$('#tab-tables .file-section').find((s) => s.textContent.indexOf(TPATH) !== -1);
  h.check('table file section rendered', !!tsec, 'sections=' + d.$$('#tab-tables .file-section').length);
  if (!tsec) return;
  d.click(d.btnByText('+ new container', tsec));
  await h.sleep(300);
  const nameInput = d.$('#tab-tables .table-detail .table-name-input');
  h.check('new container selected with name input', !!nameInput, 'detail: ' + !!d.$('#tab-tables .table-detail'));
  if (!nameInput) return;
  const tb0 = h.settledPuts(p.tag, TPATH).length;
  d.setInput(nameInput, 'weapon');
  d.change(nameInput);
  await h.waitSettled(p.tag, TPATH, tb0, 1);
  d.click(d.btnByText('+ add entry', d.$('#tab-tables .table-detail')));
  await h.sleep(300);
  let trows = d.$$('#tab-tables .table-detail .entry-row');
  const swordLabel = trows[trows.length - 1].querySelectorAll('input')[0];
  d.setInput(swordLabel, 'Sword');
  d.change(swordLabel);
  const tb1 = h.settledPuts(p.tag, TPATH).length;
  await h.waitSettled(p.tag, TPATH, tb1, 1);
  d.click(d.btnByText('+ add entry', d.$('#tab-tables .table-detail')));
  await h.sleep(300);
  trows = d.$$('#tab-tables .table-detail .entry-row');
  const axeLabel = trows[trows.length - 1].querySelectorAll('input')[0];
  d.setInput(axeLabel, 'Axe');
  d.change(axeLabel);
  const tb2 = h.settledPuts(p.tag, TPATH).length;
  const tReqs = await h.waitSettled(p.tag, TPATH, tb2, 1);
  const tBody = tReqs.length ? String(tReqs[tReqs.length - 1].body) : '';
  h.check('weapon container committed (Sword + Axe)', tBody.indexOf('Sword') !== -1 && tBody.indexOf('Axe') !== -1, tBody.slice(0, 160));

  // ---- basic-mode generator (never touched: no advanced mode, no bindings) ----
  d.click(d.$('.tab[data-tab="generators"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new generator file', d.$('#tab-generators')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const gcreated = await h.waitSettled(p.tag, GPATH, 0, 1);
  const grec = gcreated[gcreated.length - 1];
  h.check('generator file created (2xx)', !!grec && grec.ok, grec ? grec.method + ' ' + grec.url + ' -> ' + grec.status : 'no request');
  await h.sleep(300);
  const gsec = d.$$('#tab-generators .file-section.gen-file-section').find((s) => s.textContent.indexOf(GPATH) !== -1);
  h.check('generator file section rendered', !!gsec, 'sections=' + d.$$('#tab-generators .file-section.gen-file-section').length);
  if (!gsec) return;
  d.click(d.btnByText('+ add generator', gsec));
  await h.sleep(300);
  const gname = d.$('#tab-generators .gen-name-input');
  h.check('generator editor opened (name input present)', !!gname, 'name input: ' + !!gname);
  if (!gname) return;
  const modeSel = d.$('#tab-generators .gen-mode-select');
  h.check('mode select present and reads basic (never toggled)', !!modeSel && modeSel.value === 'basic', 'value=' + (modeSel && modeSel.value));
  const gb0 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gname, 'Basic Gen');
  d.change(gname);
  await h.waitSettled(p.tag, GPATH, gb0, 1);
  const gtpl = d.$('#tab-generators .gen-template');
  const gb1 = h.settledPuts(p.tag, GPATH).length;
  d.setInput(gtpl, 'You found a [weapon].');
  d.change(gtpl);
  const gReqs = await h.waitSettled(p.tag, GPATH, gb1, 1);
  const gBody = gReqs.length ? String(gReqs[gReqs.length - 1].body) : '';
  h.check('basic generator committed (template + mode basic in the PUT)', gBody.indexOf('You found a [weapon].') !== -1 && gBody.indexOf('"mode": "basic"') !== -1, gBody.slice(0, 200));
  const bp = d.$('#tab-generators .gen-bindings-panel');
  const pp = d.$('#tab-generators .gen-preview-panel');
  h.check('advanced-only panels hidden in basic mode', (!bp || bp.hidden === true) && (!pp || pp.hidden === true), 'bindings=' + (bp ? (bp.hidden ? 'hidden' : 'visible') : 'absent') + ' preview=' + (pp ? (pp.hidden ? 'hidden' : 'visible') : 'absent'));

  // ---- run with deterministic rng (one weightedPick call) ----
  p.bridge('window.__qaRng = [0.25]; window.__qaRngI = 0; window.__qaRngReal = window.Math.random; window.Math.random = function () { var v = window.__qaRng[window.__qaRngI % window.__qaRng.length]; window.__qaRngI += 1; return v; };');
  d.click(d.btnByText('Run', d.$('#tab-generators .gen-editor-form')));
  const gRan = await h.poll(() => d.$('#tab-generators .gen-run-area .gen-output') !== null || d.$('#tab-generators .gen-run-area .error') !== null);
  p.bridge('window.Math.random = window.__qaRngReal;');
  h.check('generator run finished', gRan, 'no result rendered');
  const out = d.$('#tab-generators .gen-run-area .gen-output');
  h.check('basic generator output (container rolled, no scripting)', !!out && out.textContent.trim() === 'You found a Sword.', out ? out.textContent.trim() : 'no .gen-output');
  p.bridge('window.__qaRun = (function(){ var r = state.genLastRun; if (!r) return null; return { ok: r.ok, output: r.output, rolls: (r.rolls || []).map(function(x){ return x && x.entry ? x.entry.label : null; }) }; })();');
  const run = p.w.__qaRun;
  h.check('run ok with exactly one roll (Sword)', !!run && run.ok === true && JSON.stringify(run.rolls) === JSON.stringify(['Sword']), JSON.stringify(run && run.rolls));

  // ---- file on disk is still basic; no Logic ops or variable assignments involved ----
  const rawRes = await p.w.fetch(BASE + 'api/raw?path=' + encodeURIComponent(GPATH));
  let rawJson = null;
  try { rawJson = rawRes.ok ? await rawRes.json() : null; } catch (_) { /* handled below */ }
  h.check('file on disk carries mode=basic', !!rawJson && Array.isArray(rawJson.items) && rawJson.items.length === 1 && rawJson.items[0].mode === 'basic', rawJson ? 'mode=' + rawJson.items[0].mode : 'no json');
  const item = p.w.__QState.files.get(GPATH) && p.w.__QState.files.get(GPATH).parsed && p.w.__QState.files.get(GPATH).parsed.items[0];
  h.check('no bindings / variable assignments in the basic item', !!item && (!item.bindings || Object.keys(item.bindings).length === 0), item ? 'bindings=' + JSON.stringify(item.bindings || {}) : 'no item');
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  h.check('no Logic operations needed (logic tab shows only the seed file)', JSON.stringify(d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));

  // ---- clean up both files through the Files tab (fresh page: editor still open on p) ----
  const p2 = await h.page('basic-generator-roll2');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="files"]'));
  await h.sleep(300);
  for (const f of [GPATH, TPATH]) {
    const row = d2.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(f) !== -1);
    h.check('file row present for cleanup: ' + f, !!row, 'rows=' + d2.$$('#tab-files .file-table tbody tr').length);
    if (!row) continue;
    const confBefore2 = (p2.w.__qaConfirms || []).length;
    d2.click(d2.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p2.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(f) !== -1 && r.status !== 0);
    h.check(f + ' deleted (confirm + DELETE 200)', (p2.w.__qaConfirms || []).length > confBefore2 && del.length === 1 && del[0].status === 200, 'confirms=' + (p2.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
    await h.sleep(300);
  }
  d2.click(d2.$('.tab[data-tab="generators"]'));
  await h.sleep(300);
  h.check('generators tab shows only the seed file', JSON.stringify(d2.$$('#tab-generators .file-section.gen-file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['generators/starter-generators.json']), 'paths=' + JSON.stringify(d2.$$('#tab-generators .file-section.gen-file-section .file-path').map((s) => s.textContent.trim())));
  d2.click(d2.$('.tab[data-tab="tables"]'));
  await h.sleep(300);
  const tablePaths = d2.$$('#tab-tables .file-section .file-path').map((s) => s.textContent.trim()).sort();
  h.check('tables tab shows exactly the 1 seed file', JSON.stringify(tablePaths) === JSON.stringify(['tables/starter-tables.json']), 'paths=' + JSON.stringify(tablePaths));
});

// ---------------------------------------------------------------------------
// Scenario: multidraw-set
//
// Multi-draw SET extensions. One Logic
// op whose script exercises every new form against the seed `Oracle` table:
//   SET a, b = ROLL [Oracle]       broadcast: one shared roll, identical copies
//   SET c, d = EACH ROLL [Oracle]  independent: one roll per variable, dupes ok
//   SET e, f = UNIQUE [Oracle]     distinct: pairwise-distinct draws per run
//   SET g, h = 1, "x"              zip: values paired by position
// Six test runs are read from the test panel's variable table; then the file
// is saved, reloaded on a fresh page, and the script must roundtrip
// byte-identically. The file is deleted through the Files tab.
// ---------------------------------------------------------------------------
scenario('multidraw-set', async (h) => {
  const STEM = 'qa-multidraw-set';
  const FPATH = 'logic-ops/' + STEM + '.json';
  const SCRIPT =
    'SET a, b = ROLL [Oracle]\n' +
    'SET c, d = EACH ROLL [Oracle]\n' +
    'SET e, f = UNIQUE [Oracle]\n' +
    'SET g, h = 1, "x"';
  const TEMPLATE = 'A:%a% B:%b% C:%c% D:%d% E:%e% F:%f% G:%g% H:%h%';
  const p = await h.page('multidraw');
  const d = h.dom(p);

  // ---- legal draw results = the Oracle seed table's entry labels ----
  const st = p.w.__QState;
  const oracleParsed = st.files.get('tables/starter-tables.json') && st.files.get('tables/starter-tables.json').parsed;
  const labels = [];
  if (oracleParsed && Array.isArray(oracleParsed.items)) {
    for (const it of oracleParsed.items) {
      for (const e of (it.entries || [])) labels.push(e.label);
    }
  }
  h.check('Oracle seed table loaded with entries', labels.length > 0, 'labels=' + JSON.stringify(labels).slice(0, 200));
  if (labels.length === 0) return;
  const strip = (v) => { v = String(v).trim(); return (v.length > 1 && v[0] === '"' && v[v.length - 1] === '"') ? v.slice(1, -1) : v; };

  // ---- create the logic file + op through the UI ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-logic')));
  await h.sleep(200);
  d.setInput(d.$('#ask-text-panel input.field'), STEM);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const created = await h.waitSettled(p.tag, FPATH, 0, 1);
  const crec = created[created.length - 1];
  h.check('logic file created (2xx)', !!crec && crec.ok, crec ? crec.method + ' ' + crec.url + ' -> ' + crec.status : 'no request');
  await h.sleep(300);
  const pathSpan = d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH);
  h.check('logic file section rendered', !!pathSpan, 'sections: ' + d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).join(', '));
  if (!pathSpan) return;
  d.click(pathSpan);
  await h.sleep(300);
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor opened with name input', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;
  const b0 = h.settledPuts(p.tag, FPATH).length;
  d.setInput(nameInp, 'MultiDraw');
  d.change(nameInp);
  await h.waitSettled(p.tag, FPATH, b0, 1);

  // ---- script + template (change -> immediate PUT) ----
  const script = d.$('#tab-logic .script-source');
  d.setInput(script, SCRIPT);
  d.change(script);
  const b1 = h.settledPuts(p.tag, FPATH).length;
  const sReqs = await h.waitSettled(p.tag, FPATH, b1, 1);
  const sBody = sReqs.length ? String(sReqs[sReqs.length - 1].body) : '';
  h.check('script persisted (all four new SET forms in the PUT)', sBody.indexOf('SET a, b') !== -1 && sBody.indexOf('EACH ROLL [Oracle]') !== -1 && sBody.indexOf('UNIQUE [Oracle]') !== -1 && sBody.indexOf('SET g, h') !== -1, sBody.slice(0, 200));
  const tpl = d.$('#tab-logic .script-template-source');
  d.setInput(tpl, TEMPLATE);
  d.change(tpl);
  const b2 = h.settledPuts(p.tag, FPATH).length;
  await h.waitSettled(p.tag, FPATH, b2, 1);

  // ---- validation: the new forms parse clean ----
  const okLine = await h.poll(() => d.$('.logic-validation .validation-ok'));
  h.check('validation panel clean for the new SET forms', !!okLine, 'issues=' + d.$$('.logic-validation .script-issue').length);

  // ---- run six times; read the variable table after each run ----
  const panel = d.$('#tab-logic .logic-test-panel');
  h.check('test panel in DOM (no imports -> no test inputs)', !!panel && panel.textContent.indexOf('No imported variables') !== -1, panel ? panel.textContent.slice(0, 120) : 'no panel');
  if (!panel) return;
  const readVars = () => {
    const rows = d.$$('#tab-logic .logic-test-result .test-var-row').filter((r) => !r.classList.contains('test-var-head'));
    const vars = {};
    rows.forEach((r) => { const sp = r.querySelectorAll('span'); if (sp.length >= 3) vars[sp[0].textContent.trim()] = { type: sp[1].textContent.trim(), value: sp[2].textContent.trim() }; });
    return vars;
  };
  const runs = [];
  let allOk = true;
  for (let i = 0; i < 6; i++) {
    d.click(d.btnByText('run test', panel));
    const done = await h.poll(() => d.$('#tab-logic .logic-test-result .test-ok') !== null || d.$('#tab-logic .logic-test-result .test-fail') !== null);
    const ok = d.$('#tab-logic .logic-test-result .test-ok') !== null;
    if (!done || !ok) { allOk = false; break; }
    runs.push(readVars());
  }
  h.check('six test runs completed successfully', allOk && runs.length === 6, 'runs=' + runs.length + ' lastVars=' + JSON.stringify(runs[runs.length - 1] || {}));
  if (runs.length === 0) return;

  // broadcast: one shared roll, identical copies in every run
  let bcOk = true;
  const bcSeen = [];
  for (const v of runs) {
    if (!v.a || !v.b || v.a.value !== v.b.value) { bcOk = false; break; }
    bcSeen.push(v.a.value);
  }
  h.check('broadcast: a === b in every run (identical copies of one roll)', bcOk, JSON.stringify(bcSeen));

  // EACH: both values legal Oracle draws in every run (duplicates allowed),
  // and at least one run drew two different rows -> independent per-var rolls
  let eachLegal = true;
  let anyDiff = false;
  const pairs = [];
  for (const v of runs) {
    const c = v.c && strip(v.c.value);
    const dd = v.d && strip(v.d.value);
    if (!c || !dd || labels.indexOf(c) === -1 || labels.indexOf(dd) === -1) { eachLegal = false; break; }
    if (c !== dd) anyDiff = true;
    pairs.push(c + ' | ' + dd);
  }
  h.check('EACH: c and d are both legal Oracle draws in every run (duplicates allowed)', eachLegal, JSON.stringify(pairs));
  h.check('EACH: independent per-var rolls (at least one run drew c !== d)', eachLegal && anyDiff, JSON.stringify(pairs));

  // UNIQUE: pairwise distinct legal draws in every run (per-run pool)
  let uOk = true;
  const upairs = [];
  for (const v of runs) {
    const e = v.e && strip(v.e.value);
    const f = v.f && strip(v.f.value);
    if (!e || !f || e === f || labels.indexOf(e) === -1 || labels.indexOf(f) === -1) { uOk = false; break; }
    upairs.push(e + ' | ' + f);
  }
  h.check('UNIQUE: e and f pairwise distinct legal draws in every run', uOk, JSON.stringify(upairs));

  // zip: positional pairing, exact values and types
  const v0 = runs[0];
  h.check('zip: g === 1 (number) and h === "x" (string) paired by position', !!v0.g && v0.g.type === 'number' && v0.g.value === '1' && !!v0.h && v0.h.type === 'string' && v0.h.value === '"x"', JSON.stringify({ g: v0.g, h: v0.h }));

  // ---- save/reload: the script roundtrips byte-identically ----
  const rawRes = await p.w.fetch(BASE + 'api/raw?path=' + encodeURIComponent(FPATH));
  let rawItem = null;
  try { rawItem = rawRes.ok ? (JSON.parse(await rawRes.text())).items[0] : null; } catch (_) { /* handled below */ }
  h.check('script on disk byte-identical after save', !!rawItem && rawItem.script === SCRIPT, rawItem ? 'script=' + JSON.stringify(rawItem.script).slice(0, 160) : 'no raw json');

  d.click(d.btnByText('close editor', d.$('#tab-logic .logic-editor')));
  await h.sleep(400);
  const p2 = await h.page('multidraw2');
  const d2 = h.dom(p2);
  d2.click(d2.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  const path2 = d2.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH);
  h.check('logic file listed after reload', !!path2, 'sections: ' + d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).join(', '));
  if (path2) {
    d2.click(path2);
    await h.sleep(300);
    const opRow = d2.$('#tab-logic .logic-op-row');
    h.check('op row listed after reload', !!opRow, 'rows=' + d2.$$('#tab-logic .logic-op-row').length);
    if (opRow) {
      d2.click(opRow);
      await h.sleep(300);
      const src2 = d2.$('#tab-logic .script-source');
      h.check('script reloaded byte-identical', !!src2 && src2.value === SCRIPT, src2 ? 'value=' + JSON.stringify(src2.value).slice(0, 160) : 'no script source');
    }
  }

  // ---- clean up through the Files tab ----
  d2.click(d2.$('.tab[data-tab="files"]'));
  await h.sleep(300);
  const row = d2.$$('#tab-files .file-table tbody tr').find((tr) => tr.textContent.indexOf(FPATH) !== -1);
  h.check('file row present for cleanup: ' + FPATH, !!row, 'rows=' + d2.$$('#tab-files .file-table tbody tr').length);
  if (row) {
    const confBefore = (p2.w.__qaConfirms || []).length;
    d2.click(d2.btnByText('delete', row));
    await h.sleep(500);
    const del = requestLog.filter((r) => r.page === p2.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(FPATH) !== -1 && r.status !== 0);
    h.check(FPATH + ' deleted (confirm + DELETE 200)', (p2.w.__qaConfirms || []).length > confBefore && del.length === 1 && del[0].status === 200, 'confirms=' + (p2.w.__qaConfirms || []).length + ' delete=' + (del[0] ? del[0].status : 'none'));
  }
  d2.click(d2.$('.tab[data-tab="logic"]'));
  await h.sleep(300);
  h.check('logic tab shows only the seed file', JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d2.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
});

// ---------------------------------------------------------------------------
// Scenario: expose-run-error-text
//
// Distributable message audit: the EXPOSE no-value run error that
// the real UI displays must carry the self-contained wording
// (logicRunErrorMessage(): EXPOSE variable missing at run time),
// with no internal doc references.
// Op code:   IMPORT %attack%
//            EXPOSE %miss%
// Output template: %attack%   (test input: attack = 5)
// Expected: the test run fails and the displayed error reads exactly
// "EXPOSE: variable %miss% has no value (never assigned, or not on the
// executed path)".
// ---------------------------------------------------------------------------
scenario('expose-run-error-text', async (h) => {
  const FILE = 'qa-expose-run-error';
  const FPATH = 'logic-ops/' + FILE + '.json';
  const p = await h.page('expose-run-error');
  const d = h.dom(p);

  // ---- create the logic file through the UI ----
  d.click(d.$('.tab[data-tab="logic"]'));
  await h.sleep(200);
  d.click(d.btnByText('+ new file', d.$('#tab-logic')));
  await h.sleep(200);
  const dlg = d.$('#ask-text-panel input.field');
  h.check('askText modal for logic file', !!dlg, 'modal input: ' + !!dlg);
  d.setInput(dlg, FILE);
  d.click(d.btnByText('OK', d.$('#ask-text-panel')));
  const created = await h.waitSettled(p.tag, FPATH, 0, 1);
  const crec = created[created.length - 1];
  h.check('logic file created (2xx)', !!crec && crec.ok, crec ? crec.method + ' ' + crec.url + ' -> ' + crec.status : 'no request');
  await h.sleep(300);

  // ---- open the file and add the operation ----
  const pathSpan = d.$$('#tab-logic .file-section .file-path').find((s) => s.textContent.trim() === FPATH);
  h.check('logic file section rendered', !!pathSpan, 'sections: ' + d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).join(', '));
  d.click(pathSpan);
  await h.sleep(300);
  d.click(d.btnByText('+ add operation', d.$('#tab-logic')));
  await h.sleep(300);
  const nameInp = d.$('#tab-logic .logic-editor input[aria-label="Operation name"]');
  h.check('op editor opened with name input', !!nameInp, 'name input: ' + !!nameInp);
  if (!nameInp) return;

  const b0 = h.settledPuts(p.tag, FPATH).length;
  d.setInput(nameInp, 'ExposeErrOp');
  d.change(nameInp); // rename -> cascade persist
  await h.waitSettled(p.tag, FPATH, b0, 1);
  await h.sleep(200);

  // ---- script + template (change -> immediate PUT) ----
  const script = d.$('#tab-logic .script-source');
  d.setInput(script, 'IMPORT %attack%\nEXPOSE %miss%');
  d.change(script);
  const b1 = h.settledPuts(p.tag, FPATH).length;
  await h.waitSettled(p.tag, FPATH, b1, 1);
  const tpl = d.$('#tab-logic .script-template-source');
  d.setInput(tpl, '%attack%');
  d.change(tpl);
  const b2 = h.settledPuts(p.tag, FPATH).length;
  await h.waitSettled(p.tag, FPATH, b2, 1);
  await h.sleep(200);

  // ---- run the test with attack = 5: the displayed error must be the
  // the vocabulary's exact self-contained text ----
  const tin = d.$('#tab-logic .test-input');
  h.check('test input for attack present', !!tin && tin.getAttribute('aria-label') === 'Test value for attack', 'aria=' + (tin && tin.getAttribute('aria-label')));
  d.setInput(tin, '5');
  d.click(d.btnByText('run test', d.$('#tab-logic .logic-test-panel')));
  const ran = await h.poll(() => d.$('#tab-logic .logic-test-result .test-error') !== null);
  const errEl = d.$('#tab-logic .logic-test-result .test-error');
  const errTxt = errEl ? errEl.textContent.trim() : '';
  const EXPECTED = 'EXPOSE: variable %miss% has no value (never assigned, or not on the executed path)';
  h.check('run test fails with the test-fail badge', ran && d.$('#tab-logic .logic-test-result .test-fail') !== null, errTxt.slice(0, 200) || 'no result shown');
  h.check('displayed EXPOSE error equals the vocabulary self-contained text', ran && errTxt === EXPECTED, 'got: ' + (errTxt.slice(0, 200) || 'no error shown'));
  h.check('displayed EXPOSE error carries no internal doc ref', ran && !(/D\d+/.test(errTxt) || /\u00a7\d+/.test(errTxt) || /Logic-System|Feature-Plans/i.test(errTxt)), errTxt.slice(0, 200) || 'no error shown');

  // ---- close editor (flushes save) and clean up through the UI ----
  d.click(d.btnByText('close editor', d.$('#tab-logic .logic-editor')));
  await h.sleep(400);
  const section = d.$$('#tab-logic .file-section').find((s) => s.textContent.indexOf(FPATH) !== -1);
  h.check('file section present for cleanup', !!section, 'section: ' + !!section);
  const confBefore = (p.w.__qaConfirms || []).length;
  d.click(d.btnByText('delete', section));
  await h.sleep(500);
  const delReqs = requestLog.filter((r) => r.page === p.tag && r.method === 'DELETE' && decodeURIComponent(r.url).indexOf(FPATH) !== -1 && r.status !== 0);
  h.check('logic file deleted (confirm + DELETE 2xx)', (p.w.__qaConfirms || []).length > confBefore && delReqs.length === 1 && delReqs[0].status === 200, 'confirms=' + (p.w.__qaConfirms || []).length + ' delete=' + (delReqs[0] ? delReqs[0].status : 'none'));
  await h.sleep(300);
  h.check('logic tab shows only the seed file', JSON.stringify(d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim()).sort()) === JSON.stringify(['logic-ops/starter-logic-ops.json']), 'paths=' + JSON.stringify(d.$$('#tab-logic .file-section .file-path').map((s) => s.textContent.trim())));
});

scenario('help-buttons', async (h) => {
  const p = await h.page('help-buttons');
  const d = h.dom(p);
  const opens = [];
  p.w.open = (url, target) => { opens.push({ url, target }); return null; };

  const rollHelp = d.$('#examples-btn');
  h.check('roll panel button is labeled Help', !!rollHelp && rollHelp.textContent.trim() === 'Help', 'label: ' + (rollHelp ? JSON.stringify(rollHelp.textContent.trim()) : 'missing'));
  d.click(rollHelp);
  h.check('roll Help opens help/dice.html in a new tab', opens.some((o) => o.url === 'help/dice.html' && o.target === '_blank'), JSON.stringify(opens));

  await h.poll(() => d.$('#tab-macros .tab-actions'));
  h.check('macros tab has no Help button', !d.btnByText('Help', d.$('#tab-macros')), 'found: ' + !!d.btnByText('Help', d.$('#tab-macros')));

  const TABS = [['tables', 'tables.html'], ['generators', 'generator.html'], ['logic', 'logic.html']];
  for (const [tab, page] of TABS) {
    d.click(d.$('.tab[data-tab="' + tab + '"]'));
    await h.sleep(200);
    const help = d.btnByText('Help', d.$('#tab-' + tab));
    h.check(tab + ' tab-actions row has a Help button', !!help, 'row buttons: ' + d.$$('#tab-' + tab + ' .tab-actions button').map((b) => b.textContent.trim()).join(' | '));
    if (!help) continue;
    d.click(help);
    h.check(tab + ' Help opens help/' + page + ' in a new tab', opens.some((o) => o.url === 'help/' + page && o.target === '_blank'), JSON.stringify(opens));
  }

  d.click(d.$('.tab[data-tab="files"]'));
  await h.poll(() => d.$('#tab-files .file-table'));
  h.check('files tab has no Help button', !d.btnByText('Help', d.$('#tab-files')), 'found: ' + !!d.btnByText('Help', d.$('#tab-files')));

  const PAGES = [['help.html', 'intro'], ['dice.html', 'dice'], ['macros.html', 'macros'], ['tables.html', 'tables'], ['generator.html', 'generator'], ['logic.html', 'logic']];
  const { JSDOM, VirtualConsole } = loadJSDOM();
  for (const [page, id] of PAGES) {
    const res = await fetch(BASE + 'help/' + page);
    const html = await res.text();
    h.check('help/' + page + ' is served (200)', res.status === 200, 'status=' + res.status);
    h.check('help/' + page + ' has section #' + id, html.indexOf('<section id="' + id + '"') !== -1, 'sections: ' + (html.match(/<section id="[^"]*"/g) || []).join(', '));
    const helpDom = new JSDOM(html, { url: BASE + 'help/' + page, runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
    await new Promise((resolve, reject) => {
      if (helpDom.window.document.readyState === 'complete') return resolve();
      helpDom.window.addEventListener('load', resolve);
      setTimeout(() => reject(new Error('help page load timeout (' + id + ')')), 15000);
    });
    const active = [...helpDom.window.document.querySelectorAll('.help-nav a.current')];
    h.check('help/' + page + ' marks its sidebar item active', active.length === 1 && active[0].getAttribute('href') === page && active[0].getAttribute('aria-current') === 'page', 'active=' + active.length + (active.length ? ' href=' + active[0].getAttribute('href') : ' none'));
    helpDom.window.close();
  }
});

scenario('help-sidebar', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/help.html');
  const html = await res.text();
  const waitLoaded = (doc) => new Promise((resolve, reject) => {
    if (doc.window.document.readyState === 'complete') return resolve();
    doc.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help sidebar page load timeout')), 15000);
  });
  const EXPECTED = [['help.html', 'Intro'], ['dice.html', 'Dice'], ['macros.html', 'Macros'], ['tables.html', 'Tables'], ['generator.html', 'Generators'], ['logic.html', 'Logic']];
  const doc0 = new JSDOM(html, { url: BASE + 'help/help.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await waitLoaded(doc0);
  const d0 = doc0.window.document;
  const items = [...d0.querySelectorAll('.help-sidebar .help-nav a')];
  h.check('sidebar has exactly 6 items', !!d0.querySelector('.help-sidebar') && items.length === 6, 'items=' + items.length);
  for (let i = 0; i < EXPECTED.length; i++) {
    const a = items[i];
    h.check('sidebar item ' + (i + 1) + ' is "' + EXPECTED[i][1] + '" linking to ' + EXPECTED[i][0], !!a && a.getAttribute('href') === EXPECTED[i][0] && a.textContent.trim() === EXPECTED[i][1], a ? 'href=' + a.getAttribute('href') + ' label="' + a.textContent.trim() + '"' : 'missing');
  }
  const activeOnPlain = [...d0.querySelectorAll('.help-sidebar .help-nav a.current')];
  h.check('intro page marks exactly one sidebar item active', activeOnPlain.length === 1, 'active=' + activeOnPlain.length);
  h.check('active sidebar item is Intro linking to help.html', activeOnPlain.length === 1 && activeOnPlain[0].getAttribute('href') === 'help.html' && activeOnPlain[0].textContent.trim() === 'Intro', activeOnPlain.length ? 'href=' + activeOnPlain[0].getAttribute('href') + ' label="' + activeOnPlain[0].textContent.trim() + '"' : 'none');
  const nextOnIntro = d0.querySelector('.help-pager .pager-next');
  h.check('intro page has no prev link', !d0.querySelector('.help-pager .pager-prev'), 'prev link present');
  h.check('intro page next link goes to dice.html', !!nextOnIntro && nextOnIntro.getAttribute('href') === 'dice.html', nextOnIntro ? 'href=' + nextOnIntro.getAttribute('href') : 'missing');
  doc0.window.close();
  const res1 = await fetch(BASE + 'help/tables.html');
  const html1 = await res1.text();
  const doc1 = new JSDOM(html1, { url: BASE + 'help/tables.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await waitLoaded(doc1);
  const d1 = doc1.window.document;
  const active = [...d1.querySelectorAll('.help-sidebar .help-nav a.current')];
  h.check('tables page marks exactly one sidebar item active', active.length === 1, 'active=' + active.length);
  h.check('active sidebar item is Tables linking to tables.html', active.length === 1 && active[0].getAttribute('href') === 'tables.html' && active[0].textContent.trim() === 'Tables', active.length ? 'href=' + active[0].getAttribute('href') + ' label="' + active[0].textContent.trim() + '"' : 'none');
  doc1.window.close();
});

scenario('help-dice-content', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/dice.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/dice.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (dice)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#dice.help-section');
  const text = section ? section.textContent : '';
  const codes = section ? Array.prototype.map.call(section.querySelectorAll('pre.code-sample code'), (c) => c.textContent) : [];
  const codeText = codes.join('\n');
  h.check('dice section exists', !!section, 'missing #dice section');
  const active = [...doc.querySelectorAll('.help-nav a.current')];
  h.check('dice page marks its sidebar item active', active.length === 1 && active[0].getAttribute('href') === 'dice.html' && active[0].getAttribute('aria-current') === 'page', active.length ? 'href=' + active[0].getAttribute('href') + ' aria=' + active[0].getAttribute('aria-current') : 'none');
  const TOKENS = ['2d6', 'd20', '1d20+5', '(1d10+1)*2', '2d6r', '1d20x', '2d6kh1', '2d6cs5'];
  for (const t of TOKENS) {
    h.check('dice section documents ' + t, codeText.indexOf(t) !== -1 || text.indexOf(t) !== -1, 'code: ' + codeText.replace(/\n/g, ' | '));
  }
  const prevOnDice = doc.querySelector('.help-pager .pager-prev');
  const nextOnDice = doc.querySelector('.help-pager .pager-next');
  h.check('dice page prev link goes to help.html', !!prevOnDice && prevOnDice.getAttribute('href') === 'help.html', prevOnDice ? 'href=' + prevOnDice.getAttribute('href') : 'missing');
  h.check('dice page next link goes to macros.html', !!nextOnDice && nextOnDice.getAttribute('href') === 'macros.html', nextOnDice ? 'href=' + nextOnDice.getAttribute('href') : 'missing');
  dom.window.close();
});

scenario('help-tables-content', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/tables.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/tables.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (tables)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#tables.help-section');
  const text = section ? section.textContent : '';
  const codes = section ? Array.prototype.map.call(section.querySelectorAll('pre.code-sample code'), (c) => c.textContent) : [];
  const codeText = codes.join('\n');
  const has = (t) => codeText.indexOf(t) !== -1 || text.indexOf(t) !== -1;
  h.check('tables section exists', !!section, 'missing #tables section');
  const active = [...doc.querySelectorAll('.help-nav a.current')];
  h.check('tables page marks its sidebar item active', active.length === 1 && active[0].getAttribute('href') === 'tables.html' && active[0].getAttribute('aria-current') === 'page', active.length ? 'href=' + active[0].getAttribute('href') + ' aria=' + active[0].getAttribute('aria-current') : 'none');
  h.check('tables section documents dice/macro embed |2d6+3|', has('|2d6+3|'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('tables section documents macro embed |sword|', has('|sword|'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('tables section documents inline range ((2-5))', has('((2-5))'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('tables section documents weighted choice list', has('Healing | Fire Resistance | Paralyze') && has('Rare:1'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('tables section documents container reference [Backpack]', has('[Backpack]'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('tables section documents operation reference form', has('{name}'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('tables section documents the entry embed error prefix', text.indexOf('embedded-value prefix') !== -1, 'section text missing the message prefix');
  h.check('tables section documents weight-based picking', text.indexOf('give at least one entry a positive weight') !== -1 && text.indexOf('skipped') !== -1, 'section text missing the picking rules');
  const prevOnTables = doc.querySelector('.help-pager .pager-prev');
  const nextOnTables = doc.querySelector('.help-pager .pager-next');
  h.check('tables page prev link goes to macros.html', !!prevOnTables && prevOnTables.getAttribute('href') === 'macros.html', prevOnTables ? 'href=' + prevOnTables.getAttribute('href') : 'missing');
  h.check('tables page next link goes to generator.html', !!nextOnTables && nextOnTables.getAttribute('href') === 'generator.html', nextOnTables ? 'href=' + nextOnTables.getAttribute('href') : 'missing');
  dom.window.close();
});

scenario('help-generator-content', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/generator.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/generator.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (generator)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#generator.help-section');
  const text = section ? section.textContent : '';
  const codes = section ? Array.prototype.map.call(section.querySelectorAll('pre.code-sample code'), (c) => c.textContent) : [];
  const codeText = codes.join('\n');
  const has = (t) => codeText.indexOf(t) !== -1 || text.indexOf(t) !== -1;
  h.check('generator section exists', !!section, 'missing #generator section');
  const active = [...doc.querySelectorAll('.help-nav a.current')];
  h.check('generator page marks its sidebar item active', active.length === 1 && active[0].getAttribute('href') === 'generator.html' && active[0].getAttribute('aria-current') === 'page', active.length ? 'href=' + active[0].getAttribute('href') + ' aria=' + active[0].getAttribute('aria-current') : 'none');
  h.check('generator section documents container reference [Weapon]', has('[Weapon]'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('generator section documents dice/macro embed |2d6+3|', has('|2d6+3|'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('generator section documents inline range ((2-5))', has('((2-5))'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('generator section documents operation span {Hero}', has('{Hero}'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('generator section documents EACH ROLL form', has('EACH ROLL'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('generator section documents UNIQUE form', has('UNIQUE [Chest]'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('generator section documents advanced mode', text.indexOf('advanced') !== -1, 'section text missing the mode description');
  h.check('generator section documents the generator error prefix', text.indexOf('the template could not be run') !== -1, 'section text missing the message prefix');
  const prevOnGenerator = doc.querySelector('.help-pager .pager-prev');
  const nextOnGenerator = doc.querySelector('.help-pager .pager-next');
  h.check('generator page prev link goes to tables.html', !!prevOnGenerator && prevOnGenerator.getAttribute('href') === 'tables.html', prevOnGenerator ? 'href=' + prevOnGenerator.getAttribute('href') : 'missing');
  h.check('generator page next link goes to logic.html', !!nextOnGenerator && nextOnGenerator.getAttribute('href') === 'logic.html', nextOnGenerator ? 'href=' + nextOnGenerator.getAttribute('href') : 'missing');
  dom.window.close();
});

scenario('help-macros-content', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/macros.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/macros.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (macros)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#macros.help-section');
  const text = section ? section.textContent : '';
  const codes = section ? Array.prototype.map.call(section.querySelectorAll('pre.code-sample code'), (c) => c.textContent) : [];
  const codeText = codes.join('\n');
  const has = (t) => codeText.indexOf(t) !== -1 || text.indexOf(t) !== -1;
  h.check('macros section exists', !!section, 'missing #macros section');
  const active = [...doc.querySelectorAll('.help-nav a.current')];
  h.check('macros page marks its sidebar item active', active.length === 1 && active[0].getAttribute('href') === 'macros.html' && active[0].getAttribute('aria-current') === 'page', active.length ? 'href=' + active[0].getAttribute('href') + ' aria=' + active[0].getAttribute('aria-current') : 'none');
  h.check('macros section documents the dice-macros/ folder', text.indexOf('dice-macros/') !== -1, 'section text missing the folder');
  h.check('macros section documents the macro JSON shape', has('"formula"') && has('1d20+5'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('macros section documents the tab buttons', has('+ new file') && has('export all') && has('import…') && has('+ add macro'), 'code: ' + codeText.replace(/\n/g, ' | '));
  h.check('macros section documents the row field placeholders', text.indexOf('name (used for lookup)') !== -1 && text.indexOf('label (display, optional)') !== -1 && text.indexOf('formula, e.g. 1d20+5') !== -1, 'section text missing the placeholders');
  h.check('macros section documents the duplicate-name warning', text.indexOf('loses to the earlier match in file order') !== -1, 'section text missing the warning');
  h.check('macros section documents roll bar matching', text.indexOf('longest name wins') !== -1 && text.indexOf('fireball') !== -1, 'section text missing the matching rules');
  h.check('macros section documents the combined expression', text.indexOf('(1d20+5) + 1d6') !== -1 && text.indexOf('(1d20+5) - 1') !== -1, 'section text missing the remainder examples');
  h.check('macros section documents span exact-name matching', text.indexOf('exact case-insensitive name') !== -1 && text.indexOf('no prefix matching and no remainder') !== -1, 'section text missing the span rule');
  h.check('macros section documents the span failure messages', text.indexOf('neither a macro name nor a valid dice expression fails') !== -1 && text.indexOf('An empty span fails') !== -1 && text.indexOf('own formula is invalid fails') !== -1, 'section text missing the messages');
  const prevOnMacros = doc.querySelector('.help-pager .pager-prev');
  const nextOnMacros = doc.querySelector('.help-pager .pager-next');
  h.check('macros page prev link goes to dice.html', !!prevOnMacros && prevOnMacros.getAttribute('href') === 'dice.html', prevOnMacros ? 'href=' + prevOnMacros.getAttribute('href') : 'missing');
  h.check('macros page next link goes to tables.html', !!nextOnMacros && nextOnMacros.getAttribute('href') === 'tables.html', nextOnMacros ? 'href=' + nextOnMacros.getAttribute('href') : 'missing');
  dom.window.close();
});

scenario('help-logic-content', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/logic.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/logic.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (logic)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#logic.help-section');
  const text = section ? section.textContent : '';
  const codes = section ? Array.prototype.map.call(section.querySelectorAll('pre.code-sample code'), (c) => c.textContent) : [];
  const codeText = codes.join('\n');
  const has = (t) => codeText.indexOf(t) !== -1 || text.indexOf(t) !== -1;
  h.check('logic section exists', !!section, 'missing #logic section');
  const active = [...doc.querySelectorAll('.help-nav a.current')];
  h.check('logic page marks its sidebar item active', active.length === 1 && active[0].getAttribute('href') === 'logic.html' && active[0].getAttribute('aria-current') === 'page', active.length ? 'href=' + active[0].getAttribute('href') + ' aria=' + active[0].getAttribute('aria-current') : 'none');
  const TOKENS = ['SET', 'ROLL', 'SWITCH', 'UNIQUE [Chest]', 'EACH ROLL', 'ELSE IF', 'CASE', 'DEFAULT', 'IMPORT', 'EXPOSE'];
  for (const t of TOKENS) {
    h.check('logic section documents ' + t, has(t), 'code: ' + codeText.replace(/\n/g, ' | '));
  }
  h.check('logic section documents the SET message', text.indexOf('a lowercase Set is refused') !== -1, 'section text missing the message');
  h.check('logic section documents the nesting cap', text.indexOf('the evaluator stops execution at 8') !== -1 && text.indexOf('then fails the run') !== -1, 'section text missing the message');
  h.check('logic section documents the comparison condition rule', text.indexOf('a condition must compare two operands') !== -1, 'section text missing the message');
  const prevOnLogic = doc.querySelector('.help-pager .pager-prev');
  h.check('logic page has no next link', !doc.querySelector('.help-pager .pager-next'), 'next link present');
  h.check('logic page prev link goes to generator.html', !!prevOnLogic && prevOnLogic.getAttribute('href') === 'generator.html', prevOnLogic ? 'href=' + prevOnLogic.getAttribute('href') : 'missing');
  const introRes = await fetch(BASE + 'help/help.html');
  const introHtml = await introRes.text();
  const introStart = introHtml.indexOf('<section id="intro"');
  const introEnd = introHtml.indexOf('</section>', introStart);
  const introText = introStart !== -1 && introEnd !== -1 ? introHtml.slice(introStart, introEnd).toLowerCase() : '';
  h.check('intro no longer contains placeholder text', introText.indexOf('placeholder') === -1, 'intro section still contains placeholder text');
  dom.window.close();
});

scenario('help-dice-subsections', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/dice.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/dice.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (dice subsections)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#dice.help-section');
  const heads = section ? Array.prototype.map.call(section.querySelectorAll('h3'), (x) => x.textContent) : [];
  const headText = heads.join('\n');
  h.check('dice section has h3 subsection headings', heads.length > 0, 'h3 count: ' + heads.length);
  const TOKENS = ['NdM', 'Bare dN', 'Multiple dice', '+ - * /', 'Parentheses', 'Literals', 'reroll ones', 'explosions', 'keep highest', 'keep lowest', 'count successes', 'Combining modifiers', 'Advantage and disadvantage', 'Parse failures'];
  for (const t of TOKENS) {
    h.check('dice section has an h3 for ' + t, headText.indexOf(t) !== -1, 'headings: ' + headText.replace(/\n/g, ' | '));
  }
  dom.window.close();
});

scenario('help-tables-subsections', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/tables.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/tables.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (tables subsections)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#tables.help-section');
  const heads = section ? Array.prototype.map.call(section.querySelectorAll('h3'), (x) => x.textContent) : [];
  const headText = heads.join('\n');
  h.check('tables section has h3 subsection headings', heads.length > 0, 'h3 count: ' + heads.length);
  const TOKENS = ['The Tables tab', 'Editing a container', 'How a roll picks an entry', 'embedded value resolver', 'Scanner rules', '|...|', 'inline range', 'weighted choice', 'single option', '[Name]', 'logic operation', 'span failures', 'reference failures'];
  for (const t of TOKENS) {
    h.check('tables section has an h3 for ' + t, headText.indexOf(t) !== -1, 'headings: ' + headText.replace(/\n/g, ' | '));
  }
  dom.window.close();
});

scenario('help-macros-subsections', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/macros.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/macros.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (macros subsections)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#macros.help-section');
  const heads = section ? Array.prototype.map.call(section.querySelectorAll('h3'), (x) => x.textContent) : [];
  const headText = heads.join('\n');
  h.check('macros section has h3 subsection headings', heads.length > 0, 'h3 count: ' + heads.length);
  const TOKENS = ['What a macro is', 'The Macros tab', 'Macro rows', 'Storage and lookup order', 'Macro names in the roll bar', '|macro| spans', 'Failure messages'];
  for (const t of TOKENS) {
    h.check('macros section has an h3 for ' + t, headText.indexOf(t) !== -1, 'headings: ' + headText.replace(/\n/g, ' | '));
  }
  dom.window.close();
});

scenario('help-generator-subsections', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/generator.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/generator.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (generator subsections)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#generator.help-section');
  const heads = section ? Array.prototype.map.call(section.querySelectorAll('h3'), (x) => x.textContent) : [];
  const headText = heads.join('\n');
  h.check('generator section has h3 subsection headings', heads.length > 0, 'h3 count: ' + heads.length);
  const TOKENS = ['Basic mode', 'Advanced mode', '[name]', '|...|', '((...))', '{name}', 'Nesting rules', 'Resolution chain', 'SET forms'];
  for (const t of TOKENS) {
    h.check('generator section has an h3 for ' + t, headText.indexOf(t) !== -1, 'headings: ' + headText.replace(/\n/g, ' | '));
  }
  dom.window.close();
});

scenario('help-logic-subsections', async (h) => {
  const { JSDOM, VirtualConsole } = loadJSDOM();
  const res = await fetch(BASE + 'help/logic.html');
  const html = await res.text();
  const dom = new JSDOM(html, { url: BASE + 'help/logic.html', runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
  await new Promise((resolve, reject) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
    setTimeout(() => reject(new Error('help page load timeout (logic subsections)')), 15000);
  });
  const doc = dom.window.document;
  const section = doc.querySelector('#logic.help-section');
  const heads = section ? Array.prototype.map.call(section.querySelectorAll('h3'), (x) => x.textContent) : [];
  const headText = heads.join('\n');
  h.check('logic section has h3 subsection headings', heads.length > 0, 'h3 count: ' + heads.length);
  const TOKENS = ['SET', 'ROLL', 'EACH ROLL', 'UNIQUE', 'IF', 'THEN', 'ELSE', 'SWITCH', 'CASE', 'DEFAULT', 'IMPORT', 'EXPOSE', 'AND', 'OR', 'true'];
  for (const t of TOKENS) {
    h.check('logic section has an h3 for ' + t, headText.indexOf(t) !== -1, 'headings: ' + headText.replace(/\n/g, ' | '));
  }
  dom.window.close();
});

scenario('history-long-text', async (h) => {
  const p = await h.page('hist');
  const d = h.dom(p);
  const longSrc = ['Grimjaw', 'Ferrok', 'Thundervast', 'Oblivionkeeper', 'Stormcaller', 'Runebound', 'Ironhide', 'Shadowweaver', 'Voidmender', 'Flameborn', 'Galestrider', 'Mistwalker'].join(' ') + ' ' + 'x'.repeat(200);
  const longOut = Array(300).fill('The quick brown fox jumps over the lazy dog').join(' ') + ' ' + 'z'.repeat(300);
  p.w.addHistory({ time: '12:00:00', display: longSrc, value: longOut, kind: 'generation' });
  await h.sleep(100);
  const row = d.$('.history-row');
  h.check('long-text history row renders', !!row, row ? 'row present' : 'no .history-row');
  const expr = d.$('.h-expr', row);
  const value = d.$('.h-value', row);
  h.check('source name intact in row', !!expr && expr.textContent === longSrc, expr ? 'len=' + expr.textContent.length : 'no .h-expr');
  h.check('long output intact in row', !!value && value.textContent === longOut, value ? 'len=' + value.textContent.length : 'no .h-value');
  const css = await (await fetch(BASE + 'css/style.css')).text();
  const hexprRule = css.match(/\.h-expr\s*\{[^}]*\}/);
  h.check('.h-expr wraps on word boundaries', !!hexprRule && /overflow-wrap:\s*break-word/.test(hexprRule[0]), hexprRule ? hexprRule[0] : 'rule not found');
  const hrowRule = css.match(/\.history-row\s*\{[^}]*grid-template-columns:[^;]*;/);
  h.check('source track has a sane min-width', !!hrowRule && /minmax\(\s*90px\s*,\s*1fr\s*\)/.test(hrowRule[0]), hrowRule ? hrowRule[0] : 'rule not found');
  const hvalRule = css.match(/\.h-value\s*\{[^}]*\}/);
  h.check('output track shrinks and wraps in its own area', !!hrowRule && !!hvalRule && /minmax\(\s*0\s*,\s*2fr\s*\)/.test(hrowRule[0]) && /overflow-wrap:\s*break-word/.test(hvalRule[0]), hrowRule ? hrowRule[0] : 'rule not found');
  d.click(d.$('#clear-history'));
  await h.sleep(100);
  h.check('history cleared again (no stray state)', d.$$('.history-row').length === 0, 'rows=' + d.$$('.history-row').length);
});

scenario('theme-select', async (h) => {
  const p = await h.page('theme');
  const d = h.dom(p);
  const sel = d.$('#theme-select');
  h.check('theme dropdown exists in header', !!sel, sel ? 'select present' : 'no #theme-select');
  const opts = sel ? Array.from(sel.options).map((o) => o.value) : [];
  h.check('dropdown lists all 4 themes', JSON.stringify(opts) === JSON.stringify(['midnight', 'paper', 'ember', 'mono']), 'opts=' + JSON.stringify(opts));
  const docTheme = () => p.doc.documentElement.getAttribute('data-theme');
  h.check('current theme on load is midnight (nothing saved)', docTheme() === 'midnight', 'data-theme=' + docTheme());
  h.check('select shows the current theme on load', sel.value === docTheme(), 'select=' + sel.value + ' data-theme=' + docTheme());
  sel.value = 'ember';
  d.change(sel);
  await h.sleep(100);
  h.check('picking ember applies the theme', docTheme() === 'ember', 'data-theme=' + docTheme());
  h.check('ember persisted under ttrpg-theme', p.w.localStorage.getItem('ttrpg-theme') === 'ember', 'stored=' + p.w.localStorage.getItem('ttrpg-theme'));
  h.check('select stays on the applied theme', sel.value === 'ember', 'select=' + sel.value);
  sel.value = 'mono';
  d.change(sel);
  await h.sleep(100);
  h.check('picking mono applies and persists', docTheme() === 'mono' && p.w.localStorage.getItem('ttrpg-theme') === 'mono', 'data-theme=' + docTheme() + ' stored=' + p.w.localStorage.getItem('ttrpg-theme'));
  p.w.applyTheme('paper');
  await h.sleep(50);
  h.check('select follows a theme changed by another path', sel.value === 'paper' && docTheme() === 'paper', 'select=' + sel.value + ' data-theme=' + docTheme());
});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const argv = process.argv.slice(2);
  const outIdx = argv.indexOf('--out');
  const outDir = (outIdx !== -1 && argv[outIdx + 1] && String(argv[outIdx + 1]).indexOf('--') !== 0) || null;
  const stopPidIdx = argv.indexOf('--server-pid');
  const stopPid = (stopPidIdx !== -1 && /^\d+$/.test(argv[stopPidIdx + 1] || '')) ? Number(argv[stopPidIdx + 1]) : null;
  if (argv.indexOf('--list') !== -1) {
    scenarios.forEach((s) => console.log(s.name));
    return;
  }
  const wanted = argv.filter((a, i) => {
    if (a === '--out' || a === '--server-pid') return false;
    if (outIdx !== -1 && i === outIdx + 1) return false;
    if (stopPidIdx !== -1 && i === stopPidIdx + 1) return false;
    return true;
  });
  const selected = wanted.length
    ? scenarios.filter((s) => wanted.indexOf(s.name) !== -1)
    : scenarios.slice();
  if (!selected.length) {
    console.error('No scenarios selected. Available: ' + scenarios.map((s) => s.name).join(', ') || '(none)');
    process.exit(2);
  }

  const { JSDOM, VirtualConsole } = loadJSDOM();
  console.log('=== headless-ui-harness: ' + selected.map((s) => s.name).join(', ') + ' ===');

  const external = await probeServer();
  let child = null;
  if (external) {
    console.log('server: reusing live server on ' + BASE);
  } else {
    console.log('server: none on ' + BASE + ' - starting one...');
    child = await startServer();
    console.log('server: started (pid ' + child.pid + ')');
  }

  const restored = restoreSeeds();
  console.log('restored ' + restored + ' starter files from tests/fixtures/ into data/');

  let passedScenarios = 0;
  const allResults = [];
  for (const s of selected) {
    console.log('--- scenario: ' + s.name + ' ---');
    const h = makeContext(s.name, JSDOM, VirtualConsole);
    try {
      await s.fn(h);
    } catch (e) {
      h.check(s.name + ': scenario completed without crash', false, e && (e.stack || e.message));
    }
    auditScenario(h);
    const failed = h.results.filter((r) => !r.ok);
    const ok = failed.length === 0;
    if (ok) passedScenarios++;
    console.log('--- [' + s.name + '] ' + (ok ? 'PASS' : 'FAIL') + ' (' + (h.results.length - failed.length) + '/' + h.results.length + ' checks) ---');
    allResults.push({ scenario: s.name, ok, checks: h.results });
  }

  // ---- global audits ----
  const badReqs = requestLog.filter((r) => (r.status !== 0 && r.status < 200) || r.error !== undefined);
  const s5xx = requestLog.filter((r) => r.status >= 500);
  console.log((badReqs.length === 0 && s5xx.length === 0 ? 'PASS  ' : 'FAIL  ') + 'audit: zero failed / non-2xx / 5xx page requests' + (badReqs.length || s5xx.length ? '  ::  ' + badReqs.map((r) => (r.error ? 'net-err ' : r.status + ' ') + r.method + ' ' + r.url.replace(BASE, '')).slice(0, 5).join(', ') : '  ::  none'));
  const counts = {};
  for (const r of requestLog) counts[r.method] = (counts[r.method] || 0) + 1;
  console.log('TOTAL requests logged: ' + requestLog.length + '  ' + Object.keys(counts).map((k) => k + '=' + counts[k]).join(' '));

  // ---- data/ gate: exactly the 4 seed files (empty dirs pruned first) ----
  const pruned = pruneEmptyDirs(path.join(ROOT, 'data'));
  if (pruned) console.log('note: pruned ' + pruned + ' empty dir(s) under data/');
  const seedsNow = dataFiles();
  const dataOk = JSON.stringify(seedsNow) === JSON.stringify(SEEDS.sort());
  console.log((dataOk ? 'PASS  ' : 'FAIL  ') + 'gate: data/ is exactly the 4 seed files  ::  ' + seedsNow.join(', '));

  // ---- server gate: leave no server running ----
  let serverOk = true;
  if (child) {
    await stopServer(child);
    serverOk = !(await probeServer());
    console.log((serverOk ? 'PASS  ' : 'FAIL  ') + 'gate: no server left running (harness killed pid ' + child.pid + ')');
  } else if (stopPid) {
    await killPid(stopPid);
    serverOk = !(await probeServer());
    console.log((serverOk ? 'PASS  ' : 'FAIL  ') + 'gate: no server left running (stopped external server pid ' + stopPid + ')');
  } else {
    serverOk = false;
    console.log('FAIL  gate: no server left running  ::  external server on ' + BASE + ' still listening - stop it yourself, or pass --server-pid <pid> (or let the harness start the server)');
  }

  if (outDir) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ scenarios: allResults }, null, 2));
      console.log('results written to ' + path.join(outDir, 'results.json'));
    } catch (e) { console.error('could not write results: ' + e.message); }
  }

  const allOk = passedScenarios === selected.length && dataOk && serverOk && s5xx.length === 0 && badReqs.length === 0;
  console.log('TOTAL ' + passedScenarios + '/' + selected.length + ' scenarios passed; ' + (allOk ? 'PASS' : 'FAIL'));
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error('HARNESS ERROR: ' + (e && (e.stack || e.message) || e));
  process.exit(1);
});

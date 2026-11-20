'use strict';


const fs = require('fs');
const path = require('path');

const MAX_BODY = 5 * 1024 * 1024;

const SUBDIRS = ['tables', 'dice-macros', 'generators', 'logic-ops'];


function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };
  if (body.length > 0) headers['Content-Length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}


function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        overflow = true;
      } else {
        chunks.push(chunk);
      }
    });
    req.on('end', () => {
      if (overflow) resolve(null);
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}


function normalizeDataPath(p) {
  if (p === null || p === undefined || p.trim() === '') return null;
  let s = p.split('/').join('\\');
  s = s.replace(/\\{2,}/g, '\\');
  s = s.replace(/^\\+/, '');
  if (s === '') return null;
  if (s.includes(':')) return null;
  if (s.includes('"') || s.includes('<') || s.includes('>') ||
      s.includes('|') || s.includes('?') || s.includes('*') ||
      s.includes('\0')) return null;
  if (!s.toLowerCase().endsWith('.json')) return null;
  const lower = s.toLowerCase();
  if (!lower.startsWith('tables\\') && !lower.startsWith('dice-macros\\') &&
      !lower.startsWith('generators\\') && !lower.startsWith('logic-ops\\')) return null;
  for (const segment of s.split('\\')) {
    if (segment === '' || segment === '.' || segment === '..') return null;
  }
  return s;
}

function resolveDataPath(normalized, dataDir) {
  const root = path.resolve(dataDir);
  const full = path.resolve(root, normalized);
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

function isDataFile(full) {
  try {
    return fs.statSync(full).isFile();
  } catch {
    return false;
  }
}

function getQueryParam(search, name) {
  let q = search;
  if (q.startsWith('?')) q = q.slice(1);
  if (q === '') return null;
  for (const pair of q.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    const key = eq < 0 ? pair : pair.slice(0, eq);
    const val = eq < 0 ? '' : pair.slice(eq + 1);
    if (key.toLowerCase() === name) {
      try { return decodeURIComponent(val); } catch { return null; }
    }
  }
  return null;
}

function ensureDataParent(fullPath) {
  const dir = path.dirname(fullPath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}


function listFiles(dataDir) {
  const entries = [];
  for (const sub of SUBDIRS) {
    const dir = path.join(dataDir, sub);
    let dirents;
    try {
      dirents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const f of dirents) {
      if (!f.isFile()) continue;
      if (f.name.startsWith('.')) continue;
      if (!f.name.toLowerCase().endsWith('.json')) continue;
      const st = fs.statSync(path.join(dir, f.name));
      entries.push({
        path: sub + '/' + f.name,
        size: st.size,
        mtime: st.mtime.toISOString(),
      });
    }
  }
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return entries;
}

async function handleApi(req, res, url, dataDir) {
  const method = (req.method || '').toUpperCase();
  const pathname = url.pathname.toLowerCase();

  if (pathname === '/api/health') {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    sendJson(res, 200, { ok: true, root: path.resolve(dataDir) });
    return;
  }

  if (pathname === '/api/files') {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    sendJson(res, 200, { files: listFiles(dataDir) });
    return;
  }

  if (pathname === '/api/raw') {
    const decoded = getQueryParam(url.search, 'path');
    const normalized = normalizeDataPath(decoded);
    const full = normalized === null ? null : resolveDataPath(normalized, dataDir);
    if (full === null) {
      sendJson(res, 400, { error: 'bad path' });
      return;
    }

    if (method === 'GET') {
      if (!isDataFile(full)) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      const bytes = fs.readFileSync(full);
      const text = new TextDecoder('utf-8').decode(bytes);
      const stripped = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
      const out = Buffer.from(stripped, 'utf8');
      const headers = { ...corsHeaders(), 'Content-Type': 'application/json' };
      if (out.length > 0) headers['Content-Length'] = out.length;
      res.writeHead(200, headers);
      res.end(out);
      return;
    }

    if (method === 'PUT') {
      const body = await readBody(req, MAX_BODY);
      if (body === null) {
        sendJson(res, 413, { error: 'payload too large' });
        return;
      }
      ensureDataParent(full);
      fs.writeFileSync(full, body);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'POST') {
      const body = await readBody(req, MAX_BODY);
      if (body === null) {
        sendJson(res, 413, { error: 'payload too large' });
        return;
      }
      if (isDataFile(full)) {
        sendJson(res, 409, { error: 'conflict' });
        return;
      }
      ensureDataParent(full);
      fs.writeFileSync(full, body);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (method === 'DELETE') {
      if (!isDataFile(full)) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      fs.unlinkSync(full);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
}

module.exports = {
  MAX_BODY,
  SUBDIRS,
  corsHeaders,
  sendJson,
  readBody,
  normalizeDataPath,
  resolveDataPath,
  getQueryParam,
  listFiles,
  handleApi,
};

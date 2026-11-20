'use strict';


const fs = require('fs');
const path = require('path');

const { corsHeaders, sendJson } = require('./api.js');

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.icon': 'image/x-icon',
};

function contentTypeFor(fullPath) {
  const ct = CONTENT_TYPES[path.extname(fullPath).toLowerCase()];
  return ct || 'application/octet-stream';
}

function resolveStaticPath(urlPath, appRoot) {
  let p;
  try { p = decodeURIComponent(urlPath); } catch { return null; }
  if (p.includes(':')) return null;
  if (p.includes('\\')) return null;
  p = p.replace(/^\/+/, '');
  if (p === '') p = 'index.html';
  for (const segment of p.split('/')) {
    if (segment === '' || segment.startsWith('.')) return null;
  }
  const root = path.resolve(appRoot);
  const full = path.resolve(root, p);
  if (!full.startsWith(root + path.sep)) return null;
  try {
    if (!fs.statSync(full).isFile()) return null;
  } catch {
    return null;
  }
  return full;
}

function handleStatic(req, res, pathname, appRoot) {
  const method = (req.method || '').toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }

  const full = resolveStaticPath(pathname, appRoot);
  if (full === null) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  const bytes = fs.readFileSync(full);
  const headers = { ...corsHeaders(), 'Content-Type': contentTypeFor(full) };
  if (bytes.length > 0) headers['Content-Length'] = bytes.length;
  res.writeHead(200, headers);
  if (method === 'HEAD') {
    res.end();
  } else {
    res.end(bytes);
  }
}

module.exports = {
  CONTENT_TYPES,
  contentTypeFor,
  resolveStaticPath,
  handleStatic,
};

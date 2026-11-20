'use strict';


const http = require('http');
const path = require('path');
const { URL } = require('url');

const api = require('./api.js');
const staticServe = require('./static.js');

const PORT = 8923;
const HOST = '127.0.0.1';
const BASE_URL = 'http://127.0.0.1:' + PORT;

const AppRoot = path.resolve(__dirname, '..');
const DataDir = path.join(AppRoot, 'data');

function log(msg) {
  process.stdout.write(msg + '\n');
}

log('');
log('  =================================================');
log('   TTRPG Tools - local dev server');
log('   URL:  ' + BASE_URL + '/');
log('   App:  ' + AppRoot);
log('   Data: ' + DataDir);
log('  =================================================');
log('  Press Ctrl+C to stop.');
log('');


const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    log('  [error] ' + (err && err.message ? err.message : String(err)));
    try {
      if (!res.headersSent) {
        api.sendJson(res, 500, { error: 'internal server error' });
      } else {
        res.end();
      }
    } catch {
    }
  });
});

async function handleRequest(req, res) {
  const method = (req.method || '').toUpperCase();

  if (method === 'OPTIONS') {
    res.writeHead(204, api.corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, BASE_URL);

  const rawTarget = (req.url || '').split('?')[0].split('#')[0].toLowerCase();
  if (rawTarget.split('/').some((segment) => segment === '.' || segment === '..' || segment.includes('%2e'))) {
    api.sendJson(res, 404, { error: 'not found' });
    return;
  }

  const route = url.pathname.toLowerCase();
  if (route === '/api/health' || route === '/api/files' || route === '/api/raw') {
    await api.handleApi(req, res, url, DataDir);
    return;
  }

  if (method === 'GET' || method === 'HEAD') {
    staticServe.handleStatic(req, res, url.pathname, AppRoot);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    api.sendJson(res, 404, { error: 'not found' });
  } else {
    api.sendJson(res, 405, { error: 'method not allowed' });
  }
}


server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    log('');
    log('ERROR: port ' + PORT + ' is already in use.');
    log('Another program is bound to ' + BASE_URL + '/ - close it and try again.');
  } else {
    log('');
    log('ERROR: could not start the HTTP listener on ' + BASE_URL + '/');
    log('Details: ' + (err && err.message ? err.message : String(err)));
  }
  process.exit(1);
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('');
  server.close(() => {
    log('Server stopped.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST);

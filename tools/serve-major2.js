'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../public/major2');
const port = Number(process.env.MAJOR2_PORT || 8126);
const host = process.env.MAJOR2_HOST || '127.0.0.1';
const backend = new URL(process.env.MAJOR2_BACKEND || 'http://127.0.0.1:8124');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Keep the app's established /major2 URLs working while allowing a shorter
  // /major mount point for local deployments.
  if (url.pathname === '/major' || url.pathname.startsWith('/major/')) {
    url.pathname = '/major2' + url.pathname.slice('/major'.length);
  }
  if (url.pathname === '/' || url.pathname === '/major2') { res.writeHead(302, { Location: '/major2/' }); res.end(); return; }
  if (url.pathname.startsWith('/major2/api/')) {
    const upstream = http.request({ hostname: backend.hostname, port: backend.port || 80, path: url.pathname.slice('/major2'.length) + url.search, method: req.method, headers: { ...req.headers, host: backend.host } }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'The drawing server is unavailable. Start the C++ backend and retry.' })); });
    req.pipe(upstream); return;
  }
  let relative;
  try { relative = decodeURIComponent(url.pathname.slice('/major2/'.length)); } catch (_) { res.writeHead(400); res.end(); return; }
  if (!url.pathname.startsWith('/major2/') || relative.includes('\0')) { res.writeHead(404); res.end(); return; }
  const file = path.resolve(root, relative || 'index.html');
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, host, () => console.log('Major 2: http://' + host + ':' + port + '/major/ (backend ' + backend.origin + ')'));

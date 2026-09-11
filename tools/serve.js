'use strict';
// EduCAD Phase 7 static server: 127.0.0.1:8124 over mirror/, zero deps.
// Core modules only (http, fs, path). Serves files with content types,
// renders a small listing for directories, blocks path escapes.
var http = require('http');
var fs = require('fs');
var path = require('path');

var HOST = '127.0.0.1';
var PORT = 8124;
var ROOT = path.join(__dirname, '..', 'mirror');

var CONTENT_TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
};

function contentTypeFor(filePath) {
  var ext = path.extname(String(filePath)).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Map a raw URL to an absolute path under root. Returns {abs} or {err}.
function resolvePath(root, rawUrl) {
  var p = String(rawUrl || '/').split('?')[0].split('#')[0];
  try {
    p = decodeURIComponent(p);
  } catch (e) {
    return { err: 400 };
  }
  if (p.indexOf('\0') !== -1) return { err: 400 };
  var norm = path.posix.normalize('/' + p);
  var rel = norm.replace(/^\/+/, '');
  var abs = path.join(root, rel);
  if (abs !== root && abs.slice(0, root.length + 1) !== root + path.sep) {
    return { err: 400 };
  }
  return { abs: abs, rel: rel };
}

function listDir(root, abs, rel, res) {
  var entries;
  try {
    entries = fs.readdirSync(abs);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  entries.sort();
  var base = '/' + rel.replace(/\/+$/, '');
  if (base === '/') base = '';
  var html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<title>EduCAD mirror</title></head><body><h1>EduCAD mirror</h1><ul>';
  if (rel !== '') html += '<li><a href="' + escHtml(base + '/..') + '">..</a></li>';
  entries.forEach(function (name) {
    var href = (base + '/' + name).replace(/\/+/g, '/');
    html += '<li><a href="' + escHtml(href) + '">' + escHtml(name) + '</a></li>';
  });
  html += '</ul></body></html>';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

function requestHandler(root, req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('method not allowed');
    return;
  }
  var r = resolvePath(root, req.url);
  if (r.err) {
    res.writeHead(r.err, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(r.err === 400 ? 'bad request' : 'not found');
    return;
  }
  var st;
  try {
    st = fs.statSync(r.abs);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  if (st.isDirectory()) {
    listDir(root, r.abs, r.rel, res);
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  var body;
  try {
    body = fs.readFileSync(r.abs);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': contentTypeFor(r.abs),
    'Content-Length': body.length
  });
  if (req.method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
}

function createServer(root) {
  var dir = root || ROOT;
  return http.createServer(function (req, res) {
    requestHandler(dir, req, res);
  });
}

function start(port, host, root, cb) {
  var srv = createServer(root);
  srv.listen(port === undefined ? PORT : port, host === undefined ? HOST : host, cb);
  return srv;
}

if (require.main === module) {
  var port = process.argv[2] === undefined ? PORT : parseInt(process.argv[2], 10);
  var srv = start(port, HOST, ROOT, function () {
    console.log('educad serve http://' + HOST + ':' + srv.address().port + '/ -> ' + ROOT);
  });
  srv.on('error', function (err) {
    console.error('educad serve error: ' + err.message);
    process.exit(1);
  });
}

module.exports = {
  HOST: HOST, PORT: PORT, ROOT: ROOT,
  CONTENT_TYPES: CONTENT_TYPES,
  contentTypeFor: contentTypeFor,
  resolvePath: resolvePath,
  createServer: createServer,
  start: start
};

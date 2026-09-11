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
  if (p === '/geometry' || p === '/geometry/') p = '/index.html';
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
    var indexPath = path.join(r.abs, 'index.html');
    if (fs.existsSync(indexPath)) {
      r.abs = indexPath;
      try {
        st = fs.statSync(r.abs);
      } catch (e) {
        listDir(root, r.abs, r.rel, res);
        return;
      }
    } else {
      listDir(root, r.abs, r.rel, res);
      return;
    }
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

function parsePort(v) {
  if (v === undefined || v === null || v === '') return null;
  var n = (typeof v === 'number') ? v : parseInt(String(v), 10);
  if (!isFinite(n) || Math.floor(n) !== n || n < 1 || n > 65535) return null;
  return n;
}

// Port precedence: CLI arg, then $PORT, then the 8124 default.
function resolvePort(argvPort) {
  var a = parsePort(argvPort);
  if (a !== null) return a;
  var e = parsePort(process.env.PORT);
  if (e !== null) return e;
  return PORT;
}

// Listen on port, retrying upward on EADDRINUSE (bounded by maxAttempts).
// cb(err, srv, actualPort). Other errors fail fast with no retry.
function startNextAvailable(port, host, root, maxAttempts, cb) {
  var attempts = (maxAttempts === undefined || !(maxAttempts >= 1)) ? 10 : Math.floor(maxAttempts);
  var p = port;
  var tried = 0;
  function attempt() {
    var srv = createServer(root);
    srv.once('error', function (err) {
      if (err && err.code === 'EADDRINUSE' && tried + 1 < attempts && p < 65535) {
        tried++;
        p++;
        try { srv.close(); } catch (e) { /* never listening: nothing to close */ }
        attempt();
      } else if (typeof cb === 'function') {
        cb(err, srv, p);
      }
    });
    srv.listen(p, host, function () {
      if (typeof cb === 'function') cb(null, srv, p);
    });
  }
  attempt();
}

if (require.main === module) {
  var port = resolvePort(process.argv[2]);
  startNextAvailable(port, HOST, ROOT, 10, function (err, srv, actual) {
    if (err) {
      console.error('educad serve error: ' + err.message);
      process.exit(1);
      return;
    }
    if (actual !== port) {
      console.error('educad serve: port ' + port + ' busy, using ' + actual);
    }
    console.log('educad serve http://' + HOST + ':' + srv.address().port + '/ -> ' + ROOT);
  });
}

module.exports = {
  HOST: HOST, PORT: PORT, ROOT: ROOT,
  CONTENT_TYPES: CONTENT_TYPES,
  contentTypeFor: contentTypeFor,
  resolvePath: resolvePath,
  createServer: createServer,
  start: start,
  resolvePort: resolvePort,
  startNextAvailable: startNextAvailable
};

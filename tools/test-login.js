'use strict';
// Login: demo auth for 3 roles + guest, live against educad-server.
// Seeds a throwaway database, then checks POST /api/login per role,
// rejections, guards, and the login page ships. Standalone:
// `npm run test:login` (builds the backend first; not in `npm test`).
var assert = require('assert');
var child = require('child_process');
var fs = require('fs');
var http = require('http');
var net = require('net');
var os = require('os');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var SERVER = path.join(ROOT, 'backend', 'build', 'educad-server');
var SEED = path.join(ROOT, 'backend', 'build', 'educad-seed');
var USERS = path.join(__dirname, 'users.json');
var MIRROR = path.join(ROOT, 'public');

var TOTAL = 15;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }

function freePort() {
  return new Promise(function (resolve, reject) {
    var s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', function () {
      var p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

function post(port, urlPath, payload, raw) {
  return new Promise(function (resolve, reject) {
    var body = raw !== undefined ? raw : JSON.stringify(payload);
    var req = http.request({
      host: '127.0.0.1', port: port, path: urlPath, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body, 'utf8')
      }
    }, function (res) {
      var chunks = '';
      res.on('data', function (c) { chunks += c; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(chunks); } catch (e) { /* keep null */ }
        resolve({ status: res.statusCode, headers: res.headers, json: json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function get(port, urlPath) {
  return new Promise(function (resolve, reject) {
    var req = http.get({ host: '127.0.0.1', port: port, path: urlPath }, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body: body });
      });
    });
    req.on('error', reject);
  });
}

function put(port, urlPath) {
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: '127.0.0.1', port: port, path: urlPath, method: 'PUT' },
      function (res) {
        res.resume();
        res.on('end', function () { resolve({ status: res.statusCode }); });
      });
    req.on('error', reject);
    req.end();
  });
}

function waitReady(port, srv, timeoutMs) {
  var start = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      get(port, '/login.html').then(function (r) {
        if (r.status === 200) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('server not ready'));
        setTimeout(poll, 100);
      }, function () {
        if (srv.exitCode !== null) return reject(new Error('server exited early'));
        if (Date.now() - start > timeoutMs) return reject(new Error('server not ready'));
        setTimeout(poll, 100);
      });
    })();
  });
}

async function main() {
  // 1 fixtures: binaries built, users.json carries the 3 roles outside root
  ok(fs.existsSync(SERVER), 'educad-server built');
  ok(fs.existsSync(SEED), 'educad-seed built');
  var users = JSON.parse(fs.readFileSync(USERS, 'utf8'));
  assert.deepStrictEqual(Object.keys(users).sort(),
    ['academics', 'student', 'teacher']);
  Object.keys(users).forEach(function (role) {
    ok(users[role].length > 0, role + ' has users');
    ok(users[role][0].username && users[role][0].password, role + ' pair');
  });
  ok(USERS.indexOf(MIRROR + path.sep) !== 0, 'users outside served root');
  pass('login fixtures ready');

  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'educad-login-'));
  var db = path.join(tmp, 'educad.db');
  var seed = child.spawnSync(SEED, [USERS, db], { encoding: 'utf8' });
  eq(seed.status, 0, 'seed exit 0: ' + (seed.stderr || ''));

  var port = await freePort();
  var srv = child.spawn(SERVER, [String(port)], {
    env: Object.assign({}, process.env, { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR }),
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    await waitReady(port, srv, 10000);

    // 2-4 one valid login per role
    var a = await post(port, '/api/login',
      { role: 'academics', username: 'academics', password: 'admin123' });
    eq(a.status, 200);
    eq(a.json.ok, true);
    eq(a.json.role, 'academics');
    eq(a.json.name, 'Academic Office');
    ok(typeof a.json.token === 'string' && a.json.token.length > 8, 'token');
    ok(String(a.headers['content-type']).indexOf('application/json') !== -1, 'json type');
    pass('login academics ok');
    var t = await post(port, '/api/login',
      { role: 'teacher', username: 'teacher', password: 'teach123' });
    eq(t.status, 200);
    eq(t.json.ok, true);
    eq(t.json.name, 'Demo Teacher');
    ok(typeof t.json.token === 'string' && t.json.token.length > 8, 'token');
    pass('login teacher ok');
    var s = await post(port, '/api/login',
      { role: 'student', username: 'student', password: 'learn123' });
    eq(s.status, 200);
    eq(s.json.username, 'student');
    ok(s.json.token !== t.json.token, 'tokens unique');
    pass('login student ok');

    // 5 wrong password -> 401, no token
    var r5 = await post(port, '/api/login',
      { role: 'teacher', username: 'teacher', password: 'wrong' });
    eq(r5.status, 401);
    eq(r5.json.ok, false);
    eq(r5.json.token, undefined);
    pass('login wrong password 401');

    // 6 unknown user + cross-role -> 401
    var r6a = await post(port, '/api/login',
      { role: 'teacher', username: 'nobody', password: 'teach123' });
    eq(r6a.status, 401);
    var r6b = await post(port, '/api/login',
      { role: 'student', username: 'teacher', password: 'teach123' });
    eq(r6b.status, 401);
    pass('login unknown and cross-role 401');

    // 7 blank credentials -> 401
    var r7a = await post(port, '/api/login',
      { role: 'student', username: '', password: '' });
    eq(r7a.status, 401);
    var r7b = await post(port, '/api/login',
      { role: 'student', username: '  ', password: 'x' });
    eq(r7b.status, 401);
    pass('login blank 401');

    // 8 unknown role / malformed json -> 400
    var r8a = await post(port, '/api/login',
      { role: 'guest', username: 'guest', password: 'guest' });
    eq(r8a.status, 400);
    eq(r8a.json.ok, false);
    var r8b = await post(port, '/api/login',
      { role: 'bogus', username: 'student', password: 'learn123' });
    eq(r8b.status, 400);
    var r8c = await post(port, '/api/login', null, '{oops');
    eq(r8c.status, 400);
    pass('login bad role and json 400');

    // 9 GET on the endpoint -> 405 json
    var r9 = await get(port, '/api/login');
    eq(r9.status, 405);
    pass('login GET 405');

    // 10 static guard preserved: PUT / still 405, users.json not served
    var r10a = await put(port, '/');
    eq(r10a.status, 405);
    var r10b = await get(port, '/..%2Ftools%2Fusers.json');
    eq(r10b.status === 404 || r10b.status === 400, true);
    ok(r10b.body.indexOf('admin123') === -1, 'no credential leak');
    pass('login static guards kept');

    // 11 login page ships guest link + menu
    var r11 = await get(port, '/login.html');
    eq(r11.status, 200);
    ok(r11.body.indexOf('Continue as guest') !== -1, 'guest link');
    ok(r11.body.indexOf('api/login') !== -1, 'api wired');
    ok(r11.body.indexOf('class="menu-list"') !== -1, 'cf menu');
    ok(r11.body.indexOf('class="current"') !== -1, 'active item');
    ok(r11.body.indexOf('menu-lava.js') !== -1, 'lava wired');
    pass('login page ships');

    // 12 login css rules ship
    var r12 = await get(port, '/login.css');
    eq(r12.status, 200);
    ok(r12.body.indexOf('backLava') !== -1, 'blob rule');
    ok(r12.body.indexOf('leftLava') !== -1, 'slice rule');
    ok(r12.body.indexOf('#3B5998') !== -1, 'active underline');
    pass('login css ships');

    // 13 lava assets serve with types
    var r13js = await get(port, '/menu-lava.js');
    eq(r13js.status, 200);
    ok(r13js.body.indexOf('backLava') !== -1, 'lava blob');
    ok(r13js.body.indexOf('1.70158') !== -1, 'cf easeOutBack constant');
    ok(r13js.body.indexOf('requestAnimationFrame') !== -1, 'frame loop');
    var r13a = await get(port, '/images/menu/lava-left.png');
    eq(r13a.status, 200);
    ok(String(r13a.headers['content-type']).indexOf('image/png') !== -1, 'slice type');
    var r13b = await get(port, '/images/menu/lava-right.png');
    eq(r13b.status, 200);
    pass('login lava assets ship');

    // 14 font serves with type
    var r14 = await get(port, '/fonts/cuprum-latin.woff2');
    eq(r14.status, 200);
    ok(String(r14.headers['content-type']).indexOf('font/woff2') !== -1, 'font type');
    pass('login font ships');

    // 15 sheet gate + logout ship
    var r15 = await get(port, '/index.html');
    eq(r15.status, 200);
    ok(r15.body.indexOf("localStorage.getItem('educad_session')") !== -1, 'gate');
    ok(r15.body.indexOf('id="btn-logout"') !== -1, 'logout');
    pass('login sheet gate ships');
  } finally {
    srv.kill('SIGTERM');
    await new Promise(function (resolve) { srv.on('exit', resolve); });
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' login tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

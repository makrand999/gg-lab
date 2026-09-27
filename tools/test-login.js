'use strict';
// Login: minimal plain-text demo auth (3 roles + guest link).
// Unit-checks checkLogin, then live-checks POST /api/login on an
// ephemeral port. Standalone: `npm run test:login` (not in `npm test`,
// whose 725 grand total is pinned by the phase15/16/17/18 suites).
var assert = require('assert');
var fs = require('fs');
var http = require('http');
var path = require('path');

var Serve = require('./serve.js');

var TOTAL = 15;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }

function onceListening(srv) {
  return new Promise(function (resolve, reject) {
    srv.once('listening', resolve);
    srv.once('error', reject);
  });
}

function closeServer(srv) {
  return new Promise(function (resolve) { srv.close(function () { resolve(); }); });
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

async function main() {
  // 1 exports + roles
  eq(typeof Serve.checkLogin, 'function');
  assert.deepStrictEqual(Serve.LOGIN_ROLES, ['academics', 'teacher', 'student']);
  pass('login exports roles');

  // 2-4 one valid login per role
  var a = Serve.checkLogin('academics', 'academics', 'admin123');
  eq(a && a.name, 'Academic Office');
  eq(a.role, 'academics');
  pass('login academics ok');
  var t = Serve.checkLogin('teacher', 'teacher', 'teach123');
  eq(t && t.name, 'Demo Teacher');
  pass('login teacher ok');
  var s = Serve.checkLogin('student', 'student', 'learn123');
  eq(s && s.username, 'student');
  pass('login student ok');

  // 5-8 rejections: wrong password, unknown user, cross-role, blank
  eq(Serve.checkLogin('teacher', 'teacher', 'wrong'), null);
  pass('login wrong password rejected');
  eq(Serve.checkLogin('teacher', 'nobody', 'teach123'), null);
  pass('login unknown user rejected');
  eq(Serve.checkLogin('student', 'teacher', 'teach123'), null);
  pass('login cross-role rejected');
  eq(Serve.checkLogin('student', '', ''), null);
  eq(Serve.checkLogin('student', '  ', 'x'), null);
  eq(Serve.checkLogin('bogus', 'student', 'learn123'), null);
  pass('login blank and bad role rejected');

  // 9 users.json stays outside the served root
  var usersAbs = path.join(__dirname, 'users.json');
  ok(usersAbs.indexOf(Serve.ROOT) !== 0, 'users outside root');
  ok(fs.existsSync(usersAbs), 'users file exists');
  pass('login users file unserved');

  var srv = Serve.start(0, '127.0.0.1');
  await onceListening(srv);
  try {
    var port = srv.address().port;

    // 10 valid POST returns session payload with token
    var r10 = await post(port, '/api/login',
      { role: 'teacher', username: 'teacher', password: 'teach123' });
    eq(r10.status, 200);
    eq(r10.json.ok, true);
    eq(r10.json.role, 'teacher');
    eq(r10.json.name, 'Demo Teacher');
    ok(typeof r10.json.token === 'string' && r10.json.token.length > 8, 'token');
    ok(String(r10.headers['content-type']).indexOf('application/json') !== -1, 'json type');
    pass('login POST valid 200');

    // 11 wrong password -> 401, no token
    var r11 = await post(port, '/api/login',
      { role: 'teacher', username: 'teacher', password: 'nope' });
    eq(r11.status, 401);
    eq(r11.json.ok, false);
    eq(r11.json.token, undefined);
    pass('login POST invalid 401');

    // 12 unknown role / malformed json -> 400
    var r12a = await post(port, '/api/login',
      { role: 'guest', username: 'guest', password: 'guest' });
    eq(r12a.status, 400);
    eq(r12a.json.ok, false);
    var r12b = await post(port, '/api/login', null, '{oops');
    eq(r12b.status, 400);
    pass('login POST bad role and json 400');

    // 13 GET on the endpoint -> 405 json
    var r13 = await get(port, '/api/login');
    eq(r13.status, 405);
    pass('login GET 405');

    // 14 static guard preserved: PUT / still 405, users.json not served
    var r14a = await put(port, '/');
    eq(r14a.status, 405);
    var r14b = await get(port, '/..%2Ftools%2Fusers.json');
    eq(r14b.status === 404 || r14b.status === 400, true);
    ok(r14b.body.indexOf('admin123') === -1, 'no credential leak');
    pass('login static guards kept');

    // 15 login page + gate + CF menu ship
    var r15 = await get(port, '/login.html');
    eq(r15.status, 200);
    ok(r15.body.indexOf('Continue as guest') !== -1, 'guest link');
    ok(r15.body.indexOf('/api/login') !== -1, 'api wired');
    ok(r15.body.indexOf('class="menu-list"') !== -1, 'cf menu');
    ok(r15.body.indexOf('class="current"') !== -1, 'active item');
    ok(r15.body.indexOf('menu-lava.js') !== -1, 'lava wired');
    var r15css = await get(port, '/login.css');
    eq(r15css.status, 200);
    ok(r15css.body.indexOf('backLava') !== -1, 'blob rule');
    ok(r15css.body.indexOf('leftLava') !== -1, 'slice rule');
    ok(r15css.body.indexOf('#3B5998') !== -1, 'active underline');
    var r15lava = await get(port, '/images/menu/lava-left.png');
    eq(r15lava.status, 200);
    ok(String(r15lava.headers['content-type']).indexOf('image/png') !== -1, 'slice type');
    var r15cap = await get(port, '/images/menu/lava-right.png');
    eq(r15cap.status, 200);
    var r15js = await get(port, '/menu-lava.js');
    eq(r15js.status, 200);
    ok(r15js.body.indexOf('backLava') !== -1, 'lava blob');
    ok(r15js.body.indexOf('1.70158') !== -1, 'cf easeOutBack constant');
    ok(r15js.body.indexOf('requestAnimationFrame') !== -1, 'frame loop');
    var r15font = await get(port, '/fonts/cuprum-latin.woff2');
    eq(r15font.status, 200);
    ok(String(r15font.headers['content-type']).indexOf('font/woff2') !== -1, 'font type');
    var index = await get(port, '/index.html');
    ok(index.body.indexOf("localStorage.getItem('educad_session')") !== -1, 'gate');
    ok(index.body.indexOf('id="btn-logout"') !== -1, 'logout');
    pass('login page gate menu ship');
  } finally {
    await closeServer(srv);
  }

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' login tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

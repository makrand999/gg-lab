'use strict';
// C++ backend black-box test: static parity with tools/serve.js plus the
// auth API (Track A). Spawns backend/build/educad-server on a free port
// with a throwaway seeded database. Run: `npm run test:cpp`
// (Track B extends this file with drawings/progress checks.)
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
var MIRROR = path.join(ROOT, 'mirror');

var TOTAL = 26;
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

function req(port, method, urlPath, payload, raw, headers) {
  return new Promise(function (resolve, reject) {
    var body = raw !== undefined ? raw : (payload === undefined ? '' : JSON.stringify(payload));
    var h = { 'Content-Length': Buffer.byteLength(body, 'utf8') };
    if (body) h['Content-Type'] = 'application/json';
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    var r = http.request({ host: '127.0.0.1', port: port, path: urlPath, method: method, headers: h },
      function (res) {
        var chunks = '';
        res.on('data', function (c) { chunks += c; });
        res.on('end', function () {
          var json = null;
          try { json = JSON.parse(chunks); } catch (e) { /* keep null */ }
          resolve({ status: res.statusCode, headers: res.headers, body: chunks, json: json });
        });
      });
    r.on('error', reject);
    r.end(body);
  });
}

function waitReady(port, srv, timeoutMs) {
  var start = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      req(port, 'GET', '/login.html').then(function (r) {
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
  // 1 binaries exist (npm run build:cpp)
  ok(fs.existsSync(SERVER), 'educad-server built');
  ok(fs.existsSync(SEED), 'educad-seed built');
  pass('cpp binaries built');

  // 2 seed throwaway db; plain-text passwords must not land in db files
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'educad-cpp-'));
  var db = path.join(tmp, 'educad.db');
  var seed = child.spawnSync(SEED, [USERS, db], { encoding: 'utf8' });
  eq(seed.status, 0, 'seed exit 0: ' + (seed.stderr || ''));
  ok(/3 users/.test(seed.stdout), 'seed count');
  ['educad.db', 'educad.db-wal', 'educad.db-journal'].forEach(function (f) {
    var p = path.join(tmp, f);
    if (!fs.existsSync(p)) return;
    var buf = fs.readFileSync(p);
    ['admin123', 'teach123', 'learn123'].forEach(function (pw) {
      ok(buf.indexOf(pw) === -1, 'no plain-text ' + pw + ' in ' + f);
    });
  });
  pass('cpp seed hashes passwords');

  var port = await freePort();
  var errLog = '';
  var srv = child.spawn(SERVER, [String(port)], {
    env: Object.assign({}, process.env, { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  srv.stderr.on('data', function (c) { errLog += c; });
  try {
    await waitReady(port, srv, 10000);

    // 3-5 one valid login per role
    var a = await req(port, 'POST', '/api/login',
      { role: 'academics', username: 'academics', password: 'admin123' });
    eq(a.status, 200);
    eq(a.json.ok, true);
    eq(a.json.role, 'academics');
    eq(a.json.name, 'Academic Office');
    ok(typeof a.json.token === 'string' && a.json.token.length > 8, 'token');
    ok(String(a.headers['content-type']).indexOf('application/json') !== -1, 'json type');
    pass('cpp login academics ok');
    var t = await req(port, 'POST', '/api/login',
      { role: 'teacher', username: 'teacher', password: 'teach123' });
    eq(t.status, 200);
    eq(t.json.name, 'Demo Teacher');
    pass('cpp login teacher ok');
    var s = await req(port, 'POST', '/api/login',
      { role: 'student', username: 'student', password: 'learn123' });
    eq(s.status, 200);
    eq(s.json.username, 'student');
    ok(s.json.token !== t.json.token, 'tokens unique');
    pass('cpp login student ok');

    // 6-8 rejections: wrong password, unknown user, cross-role, blank
    var r6 = await req(port, 'POST', '/api/login',
      { role: 'teacher', username: 'teacher', password: 'wrong' });
    eq(r6.status, 401);
    eq(r6.json.ok, false);
    eq(r6.json.token, undefined);
    pass('cpp login wrong password 401');
    var r7 = await req(port, 'POST', '/api/login',
      { role: 'teacher', username: 'nobody', password: 'teach123' });
    eq(r7.status, 401);
    var r7b = await req(port, 'POST', '/api/login',
      { role: 'student', username: 'teacher', password: 'teach123' });
    eq(r7b.status, 401);
    pass('cpp login unknown and cross-role 401');
    var r8a = await req(port, 'POST', '/api/login',
      { role: 'student', username: '', password: '' });
    eq(r8a.status, 401);
    var r8b = await req(port, 'POST', '/api/login',
      { role: 'student', username: '  ', password: 'x' });
    eq(r8b.status, 401);
    pass('cpp login blank 401');

    // 9 unknown role / malformed json -> 400; oversize -> 413
    var r9a = await req(port, 'POST', '/api/login',
      { role: 'guest', username: 'guest', password: 'guest' });
    eq(r9a.status, 400);
    eq(r9a.json.ok, false);
    var r9b = await req(port, 'POST', '/api/login', null, '{oops');
    eq(r9b.status, 400);
    var big = await req(port, 'POST', '/api/login', null, '{"x":"' + 'y'.repeat(5000) + '"}');
    eq(big.status, 413);
    pass('cpp login bad role json size');

    // 10 GET on the endpoint -> 405 json
    var r10 = await req(port, 'GET', '/api/login');
    eq(r10.status, 405);
    eq(r10.json.ok, false);
    pass('cpp login GET 405');

    // 11 static guard: PUT / 405, traversal blocked, no credential leak
    var r11a = await req(port, 'PUT', '/');
    eq(r11a.status, 405);
    var r11b = await req(port, 'GET', '/..%2Ftools%2Fusers.json');
    eq(r11b.status === 404 || r11b.status === 400, true);
    ok(r11b.body.indexOf('admin123') === -1, 'no credential leak');
    var r11c = await req(port, 'GET', '/%2e%2e/%2e%2e/etc/passwd');
    eq(r11c.status === 404 || r11c.status === 400, true);
    pass('cpp static guards kept');

    // 12 login page + static content types ship
    var r12 = await req(port, 'GET', '/login.html');
    eq(r12.status, 200);
    ok(r12.body.indexOf('Continue as guest') !== -1, 'guest link');
    ok(r12.body.indexOf('api/login') !== -1, 'api wired');
    var r12js = await req(port, 'GET', '/menu-lava.js');
    eq(r12js.status, 200);
    ok(String(r12js.headers['content-type']).indexOf('text/javascript') !== -1, 'js type');
    var r12css = await req(port, 'GET', '/login.css');
    eq(r12css.status, 200);
    ok(String(r12css.headers['content-type']).indexOf('text/css') !== -1, 'css type');
    var r12png = await req(port, 'GET', '/images/menu/lava-left.png');
    eq(r12png.status, 200);
    ok(String(r12png.headers['content-type']).indexOf('image/png') !== -1, 'png type');
    var r12font = await req(port, 'GET', '/fonts/cuprum-latin.woff2');
    eq(r12font.status, 200);
    ok(String(r12font.headers['content-type']).indexOf('font/woff2') !== -1, 'font type');
    pass('cpp login page static types');

    // 13 /geometry alias + directory index + listing + HEAD
    var r13a = await req(port, 'GET', '/geometry');
    eq(r13a.status, 200);
    ok(r13a.body.indexOf('educad_session') !== -1, 'geometry is app');
    var r13b = await req(port, 'GET', '/');
    eq(r13b.status, 200);
    var r13c = await req(port, 'GET', '/fonts/');
    eq(r13c.status, 200);
    ok(r13c.body.indexOf('EduCAD mirror') !== -1, 'listing');
    var r13d = await req(port, 'HEAD', '/login.html');
    eq(r13d.status, 200);
    eq(r13d.body, '');
    ok(Number(r13d.headers['content-length']) > 0, 'head length');
    pass('cpp geometry index listing head');

    // 14 /api/me honors bearer tokens
    var me = await req(port, 'GET', '/api/me', undefined, undefined,
      { Authorization: 'Bearer ' + t.json.token });
    eq(me.status, 200);
    eq(me.json.username, 'teacher');
    eq(me.json.role, 'teacher');
    var meBad = await req(port, 'GET', '/api/me', undefined, undefined,
      { Authorization: 'Bearer junk' });
    eq(meBad.status, 401);
    var meNone = await req(port, 'GET', '/api/me');
    eq(meNone.status, 401);
    pass('cpp me token gate');

    // 15 logout invalidates the token
    var out = await req(port, 'POST', '/api/logout', {}, undefined,
      { Authorization: 'Bearer ' + t.json.token });
    eq(out.status, 200);
    eq(out.json.ok, true);
    var meAfter = await req(port, 'GET', '/api/me', undefined, undefined,
      { Authorization: 'Bearer ' + t.json.token });
    eq(meAfter.status, 401);
    pass('cpp logout kills session');

    // 16 unknown /api/* -> 404 json
    var r16 = await req(port, 'GET', '/api/nope');
    eq(r16.status, 404);
    eq(r16.json.ok, false);
    var r16b = await req(port, 'POST', '/api/me');
    eq(r16b.status, 405);
    pass('cpp unknown api 404');

    // 17 missing file -> 404 text, db file not served
    var r17 = await req(port, 'GET', '/does-not-exist.html');
    eq(r17.status, 404);
    eq(r17.json, null);
    pass('cpp missing file 404');

    // 18 busy port retries upward (serve.js startNextAvailable parity)
    var port2 = await freePort();
    var srv2 = child.spawn(SERVER, [String(port2)], {
      env: Object.assign({}, process.env, { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR }),
      stdio: ['ignore', 'ignore', 'pipe']
    });
    var err2 = '';
    srv2.stderr.on('data', function (c) { err2 += c; });
    try {
      await waitReady(port2, srv2, 10000);
      var srv3 = child.spawn(SERVER, [String(port2)], {
        env: Object.assign({}, process.env, { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR }),
        stdio: ['ignore', 'ignore', 'pipe']
      });
      var err3 = '';
      srv3.stderr.on('data', function (c) { err3 += c; });
      try {
        await waitReady(port2 + 1, srv3, 10000);
        ok(/busy, using/.test(err3), 'busy notice: ' + err3);
        var r18 = await req(port2 + 1, 'GET', '/login.html');
        eq(r18.status, 200);
      } finally {
        srv3.kill('SIGTERM');
        await new Promise(function (res) { srv3.on('exit', res); });
      }
    } finally {
      srv2.kill('SIGTERM');
      await new Promise(function (res) { srv2.on('exit', res); });
    }
    pass('cpp busy port retry');

    // 19 saves require auth (fresh tokens; check 15 logged the teacher out)
    var teacher = (await req(port, 'POST', '/api/login',
      { role: 'teacher', username: 'teacher', password: 'teach123' })).json.token;
    var student = (await req(port, 'POST', '/api/login',
      { role: 'student', username: 'student', password: 'learn123' })).json.token;
    function auth(token) { return { Authorization: 'Bearer ' + token }; }
    eq((await req(port, 'GET', '/api/drawings')).status, 401);
    eq((await req(port, 'POST', '/api/drawings', { data: {} })).status, 401);
    eq((await req(port, 'GET', '/api/drawings/1', undefined, undefined, auth('junk'))).status, 401);
    eq((await req(port, 'GET', '/api/progress')).status, 401);
    eq((await req(port, 'PUT', '/api/progress/l1', { state: {} })).status, 401);
    pass('cpp saves require auth');

    // 20 drawing create + list + get round-trip
    var c1 = await req(port, 'POST', '/api/drawings',
      { title: 'Hex prism', data: { strokes: [{ x: 1, y: 2 }], sheet: 'A3' } },
      undefined, auth(teacher));
    eq(c1.status, 201);
    ok(c1.json.id > 0, 'drawing id');
    var c2 = await req(port, 'POST', '/api/drawings',
      { data: [1, 2] }, undefined, auth(teacher));
    eq(c2.status, 201);
    var list = await req(port, 'GET', '/api/drawings', undefined, undefined, auth(teacher));
    eq(list.status, 200);
    eq(list.json.drawings.length, 2);
    ok(list.json.drawings.every(function (d) { return d.data === undefined; }), 'list omits blobs');
    var got = await req(port, 'GET', '/api/drawings/' + c1.json.id,
      undefined, undefined, auth(teacher));
    eq(got.status, 200);
    eq(got.json.title, 'Hex prism');
    assert.deepStrictEqual(got.json.data, { strokes: [{ x: 1, y: 2 }], sheet: 'A3' });
    var got2 = await req(port, 'GET', '/api/drawings/' + c2.json.id,
      undefined, undefined, auth(teacher));
    eq(got2.json.title, 'Untitled');
    pass('cpp drawing round-trip');

    // 21 update + ownership isolation + delete
    var up = await req(port, 'PUT', '/api/drawings/' + c1.json.id,
      { title: 'Hex prism v2', data: { strokes: [] } }, undefined, auth(teacher));
    eq(up.status, 200);
    ok(up.json.updated_at > 0, 'updated stamp');
    var upTitle = await req(port, 'PUT', '/api/drawings/' + c1.json.id,
      { title: 'v3' }, undefined, auth(teacher));
    eq(upTitle.status, 200);
    var got3 = await req(port, 'GET', '/api/drawings/' + c1.json.id,
      undefined, undefined, auth(teacher));
    eq(got3.json.title, 'v3');
    assert.deepStrictEqual(got3.json.data, { strokes: [] });
    var upEmpty = await req(port, 'PUT', '/api/drawings/' + c1.json.id,
      {}, undefined, auth(teacher));
    eq(upEmpty.status, 400);
    // student cannot see/touch teacher drawings (404, no leak either way)
    var sc = await req(port, 'POST', '/api/drawings',
      { title: 'Mine', data: {} }, undefined, auth(student));
    eq(sc.status, 201);
    eq((await req(port, 'GET', '/api/drawings/' + c1.json.id,
      undefined, undefined, auth(student))).status, 404);
    eq((await req(port, 'PUT', '/api/drawings/' + c1.json.id,
      { title: 'hijack' }, undefined, auth(student))).status, 404);
    eq((await req(port, 'DELETE', '/api/drawings/' + c1.json.id,
      undefined, undefined, auth(student))).status, 404);
    eq((await req(port, 'GET', '/api/drawings/' + sc.json.id,
      undefined, undefined, auth(teacher))).status, 404);
    var del = await req(port, 'DELETE', '/api/drawings/' + c1.json.id,
      undefined, undefined, auth(teacher));
    eq(del.status, 200);
    eq(del.json.ok, true);
    eq((await req(port, 'GET', '/api/drawings/' + c1.json.id,
      undefined, undefined, auth(teacher))).status, 404);
    eq((await req(port, 'DELETE', '/api/drawings/' + c1.json.id,
      undefined, undefined, auth(teacher))).status, 404);
    pass('cpp drawing update isolate delete');

    // 22 progress round-trip + validation + isolation
    var p1 = await req(port, 'PUT', '/api/progress/quad-1',
      { state: { step: 3, done: false } }, undefined, auth(teacher));
    eq(p1.status, 200);
    eq(p1.json.lesson, 'quad-1');
    var p2 = await req(port, 'PUT', '/api/progress/lamina-2',
      { state: [1] }, undefined, auth(teacher));
    eq(p2.status, 200);
    var sp = await req(port, 'PUT', '/api/progress/quad-1',
      { state: { step: 1 } }, undefined, auth(student));
    eq(sp.status, 200);
    var pl = await req(port, 'GET', '/api/progress', undefined, undefined, auth(teacher));
    eq(pl.status, 200);
    eq(pl.json.progress.length, 2);
    eq(pl.json.progress[0].lesson, 'lamina-2');
    assert.deepStrictEqual(pl.json.progress[1].state, { step: 3, done: false });
    var pls = await req(port, 'GET', '/api/progress', undefined, undefined, auth(student));
    eq(pls.json.progress.length, 1);
    var pBad = await req(port, 'PUT', '/api/progress/quad-1', {}, undefined, auth(teacher));
    eq(pBad.status, 400);
    var pBadJson = await req(port, 'PUT', '/api/progress/quad-1', null, '{oops',
      auth(teacher));
    eq(pBadJson.status, 400);
    var pBadLesson = await req(port, 'PUT', '/api/progress/a!b',
      { state: {} }, undefined, auth(teacher));
    eq(pBadLesson.status, 400);
    pass('cpp progress round-trip');

    // 23 method mismatches + bad ids on save routes
    eq((await req(port, 'POST', '/api/drawings/1', {})).status, 405);
    eq((await req(port, 'PUT', '/api/drawings', {})).status, 405);
    eq((await req(port, 'DELETE', '/api/drawings')).status, 405);
    eq((await req(port, 'GET', '/api/progress/x')).status, 405);
    eq((await req(port, 'POST', '/api/progress', {})).status, 405);
    eq((await req(port, 'GET', '/api/drawings/abc', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'GET', '/api/drawings/999999', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'POST', '/api/drawings', { title: 'no data' },
      undefined, auth(teacher))).status, 400);
    pass('cpp saves methods and ids');

    // 24 oversize drawing rejected
    var huge = await req(port, 'POST', '/api/drawings', null,
      '{"data":"' + 'z'.repeat(2 * 1024 * 1024) + '"}', auth(teacher));
    eq(huge.status, 413);
    pass('cpp drawing oversize 413');

    // 25 logout kills saves access
    var out2 = await req(port, 'POST', '/api/logout', {}, undefined, auth(teacher));
    eq(out2.status, 200);
    eq((await req(port, 'GET', '/api/drawings', undefined, undefined,
      auth(teacher))).status, 401);
    pass('cpp logout kills saves');

    // 26 sessions + saves survive a server restart (same db file)
    srv.kill('SIGTERM');
    await new Promise(function (resolve) { srv.on('exit', resolve); });
    srv = child.spawn(SERVER, [String(port)], {
      env: Object.assign({}, process.env, { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR }),
      stdio: ['ignore', 'ignore', 'pipe']
    });
    srv.stderr.on('data', function (c) { errLog += c; });
    await waitReady(port, srv, 10000);
    var meAfter = await req(port, 'GET', '/api/me', undefined, undefined, auth(student));
    eq(meAfter.status, 200);
    var listAfter = await req(port, 'GET', '/api/drawings', undefined, undefined,
      auth(student));
    eq(listAfter.status, 200);
    eq(listAfter.json.drawings.length, 1);
    eq(listAfter.json.drawings[0].title, 'Mine');
    var plAfter = await req(port, 'GET', '/api/progress', undefined, undefined,
      auth(student));
    eq(plAfter.json.progress.length, 1);
    assert.deepStrictEqual(plAfter.json.progress[0].state, { step: 1 });
    pass('cpp restart persistence');
  } finally {
    srv.kill('SIGTERM');
    await new Promise(function (resolve) { srv.on('exit', resolve); });
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' cpp backend tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

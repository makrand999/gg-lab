'use strict';
// C++ backend black-box test: static file serving plus the full JSON API
// (auth, drawings, progress, sets, classes). Spawns
// backend/build/educad-server on free ports with a throwaway seeded
// database. Run: `npm run test:cpp`
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

var TOTAL = 43;
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
    var r12boot = await req(port, 'GET', '/lib/educad-boot.js');
    eq(r12boot.status, 200);
    ok(String(r12boot.headers['content-type']).indexOf('text/javascript') !== -1,
      'boot js type');
    ok(r12boot.body.indexOf('EduCADBoot') !== -1, 'boot body');
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

    // 18 busy port retries upward
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

    // 27 teacher posts a question set (fresh teacher token; 25 logged it out)
    teacher = (await req(port, 'POST', '/api/login',
      { role: 'teacher', username: 'teacher', password: 'teach123' })).json.token;
    var academics = (await req(port, 'POST', '/api/login',
      { role: 'academics', username: 'academics', password: 'admin123' })).json.token;
    var set1 = await req(port, 'POST', '/api/sets', {
      code: 'geo-101', title: 'Projections 1',
      questions: [
        { prompt: '  Draw the front view of a 40mm cube.  ', hint: 'Start with a square.' },
        { prompt: 'Add the top view below the XY line.', starter: { entities: [] } }
      ]
    }, undefined, auth(teacher));
    eq(set1.status, 201);
    ok(set1.json.id > 0, 'set id');
    eq(set1.json.code, 'geo-101');
    var gotSet = await req(port, 'GET', '/api/sets/geo-101', undefined, undefined,
      auth(teacher));
    eq(gotSet.status, 200);
    eq(gotSet.json.title, 'Projections 1');
    eq(gotSet.json.questions.length, 2);
    eq(gotSet.json.questions[0].prompt, 'Draw the front view of a 40mm cube.');
    eq(gotSet.json.questions[0].hint, 'Start with a square.');
    assert.deepStrictEqual(gotSet.json.questions[1].starter, { entities: [] });
    eq(gotSet.json.owner, 'Demo Teacher');
    pass('cpp set create fetch');

    // 28 set validation: codes, questions, duplicates, roles
    async function badSet(payload, token) {
      return (await req(port, 'POST', '/api/sets', payload, undefined, auth(token))).status;
    }
    var goodQ = [{ prompt: 'Q?' }];
    eq(await badSet({ code: 'ab', title: 't', questions: goodQ }, teacher), 400);
    eq(await badSet({ code: 'has space!', title: 't', questions: goodQ }, teacher), 400);
    eq(await badSet({ code: 'a/b', title: 't', questions: goodQ }, teacher), 400);
    eq(await badSet({ title: 't', questions: goodQ }, teacher), 400);
    eq(await badSet({ code: 'geo-x', title: 't' }, teacher), 400);
    eq(await badSet({ code: 'geo-x', title: 't', questions: [] }, teacher), 400);
    eq(await badSet({ code: 'geo-x', title: 't', questions: 'nope' }, teacher), 400);
    var many = [];
    for (var mi = 0; mi < 51; mi++) many.push({ prompt: 'q' + mi });
    eq(await badSet({ code: 'geo-x', title: 't', questions: many }, teacher), 400);
    eq(await badSet({ code: 'geo-x', title: 't', questions: [{}] }, teacher), 400);
    eq(await badSet({ code: 'geo-x', title: 't', questions: [{ prompt: '  ' }] }, teacher), 400);
    eq(await badSet({ code: 'geo-x', title: 't', questions: [{ prompt: 7 }] }, teacher), 400);
    eq(await badSet({ code: 'geo-x', title: 't', questions: [{ prompt: 'q', hint: 7 }] },
      teacher), 400);
    eq(await badSet({ code: 'geo-x', title: 't', questions: [{ prompt: 'q', starter: [] }] },
      teacher), 400);
    eq(await badSet({ code: 'geo-101', title: 'dup', questions: goodQ }, teacher), 409);
    eq(await badSet({ code: 'geo-102', title: 't', questions: goodQ }, student), 403);
    eq((await req(port, 'POST', '/api/sets',
      { code: 'geo-102', title: 't', questions: goodQ })).status, 401);
    var acadSet = await req(port, 'POST', '/api/sets',
      { code: 'geo-102', title: 'Office set', questions: goodQ }, undefined, auth(academics));
    eq(acadSet.status, 201);
    pass('cpp set validation roles');

    // 29 set fetch + list scoping
    var stuGet = await req(port, 'GET', '/api/sets/geo-101', undefined, undefined,
      auth(student));
    eq(stuGet.status, 200);
    eq(stuGet.json.questions.length, 2);
    eq((await req(port, 'GET', '/api/sets/nope-999', undefined, undefined,
      auth(student))).status, 404);
    eq((await req(port, 'GET', '/api/sets/ab', undefined, undefined,
      auth(student))).status, 404);
    eq((await req(port, 'GET', '/api/sets/geo-101')).status, 401);
    var teachList = await req(port, 'GET', '/api/sets', undefined, undefined, auth(teacher));
    eq(teachList.status, 200);
    eq(teachList.json.sets.length, 1);
    eq(teachList.json.sets[0].code, 'geo-101');
    eq(teachList.json.sets[0].nquestions, 2);
    var stuList = await req(port, 'GET', '/api/sets', undefined, undefined, auth(student));
    eq(stuList.status, 200);
    eq(stuList.json.sets.length, 2);
    ok(stuList.json.sets.every(function (e) { return e.class_code === ''; }),
      'open sets carry empty class');
    var acadList = await req(port, 'GET', '/api/sets', undefined, undefined, auth(academics));
    eq(acadList.json.sets.length, 2);
    pass('cpp set fetch list scope');

    // 30 student submits solutions
    var sub1 = await req(port, 'POST', '/api/sets/geo-101/submissions',
      { question_index: 1, data: { version: 1, entities: [{ id: 'E1' }] }, note: 'my try' },
      undefined, auth(student));
    eq(sub1.status, 201);
    ok(sub1.json.id > 0, 'submission id');
    var sub2 = await req(port, 'POST', '/api/sets/geo-101/submissions',
      { data: { version: 1, entities: [] } }, undefined, auth(student));
    eq(sub2.status, 201);
    async function badSub(payload) {
      return (await req(port, 'POST', '/api/sets/geo-101/submissions', payload,
        undefined, auth(student))).status;
    }
    eq(await badSub({ question_index: 5, data: {} }), 400);
    eq(await badSub({ question_index: -1, data: {} }), 400);
    eq(await badSub({ question_index: 1.5, data: {} }), 400);
    eq(await badSub({ question_index: 'x', data: {} }), 400);
    eq(await badSub({ question_index: 99999999999999999999, data: {} }), 400);
    eq(await badSub({}), 400);
    eq(await badSub({ data: [1] }), 400);
    eq(await badSub({ data: {}, note: 7 }), 400);
    eq((await req(port, 'POST', '/api/sets/nope-999/submissions', { data: {} },
      undefined, auth(student))).status, 404);
    eq((await req(port, 'POST', '/api/sets/geo-101/submissions', { data: {} })).status, 401);
    // huge index must not have crashed the worker: server still answers
    eq((await req(port, 'GET', '/api/sets/geo-101', undefined, undefined,
      auth(student))).status, 200);
    pass('cpp submit validation');

    // 31 teacher lists submissions (no blobs); students cannot
    var subs = await req(port, 'GET', '/api/sets/geo-101/submissions', undefined, undefined,
      auth(teacher));
    eq(subs.status, 200);
    eq(subs.json.submissions.length, 2);
    eq(subs.json.submissions[0].username, 'student');
    eq(subs.json.submissions[0].name, 'Demo Student');
    eq(subs.json.submissions[0].question_index, 1);
    eq(subs.json.submissions[0].note, 'my try');
    ok(subs.json.submissions[0].data === undefined, 'list omits blobs');
    eq(subs.json.submissions[1].question_index, 0);
    var subsAcad = await req(port, 'GET', '/api/sets/geo-101/submissions', undefined,
      undefined, auth(academics));
    eq(subsAcad.status, 200);
    eq((await req(port, 'GET', '/api/sets/geo-101/submissions', undefined, undefined,
      auth(student))).status, 403);
    eq((await req(port, 'GET', '/api/sets/nope-999/submissions', undefined, undefined,
      auth(teacher))).status, 404);
    pass('cpp submissions list gate');

    // 32 single submission: owner, submitter, admin see it; strangers 404
    var one = await req(port, 'GET', '/api/submissions/' + sub1.json.id, undefined,
      undefined, auth(teacher));
    eq(one.status, 200);
    eq(one.json.set_code, 'geo-101');
    eq(one.json.question_index, 1);
    assert.deepStrictEqual(one.json.data, { version: 1, entities: [{ id: 'E1' }] });
    var own = await req(port, 'GET', '/api/submissions/' + sub1.json.id, undefined,
      undefined, auth(student));
    eq(own.status, 200);
    var adm = await req(port, 'GET', '/api/submissions/' + sub1.json.id, undefined,
      undefined, auth(academics));
    eq(adm.status, 200);
    // academics owns geo-102; student submits there; teacher is a stranger
    var subX = await req(port, 'POST', '/api/sets/geo-102/submissions',
      { data: {} }, undefined, auth(student));
    eq(subX.status, 201);
    eq((await req(port, 'GET', '/api/submissions/' + subX.json.id, undefined,
      undefined, auth(teacher))).status, 404);
    eq((await req(port, 'GET', '/api/submissions/999999', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'GET', '/api/submissions/abc', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'GET', '/api/submissions/' + sub1.json.id)).status, 401);
    pass('cpp submission fetch gate');

    // 33 mine list + delete cascades
    var mine = await req(port, 'GET', '/api/submissions/mine', undefined, undefined,
      auth(student));
    eq(mine.status, 200);
    eq(mine.json.submissions.length, 3);
    ok(mine.json.submissions.every(function (e) { return e.set_code !== undefined; }),
      'mine carries set codes');
    var mineT = await req(port, 'GET', '/api/submissions/mine', undefined, undefined,
      auth(teacher));
    eq(mineT.json.submissions.length, 0);
    eq((await req(port, 'DELETE', '/api/sets/geo-101', undefined, undefined,
      auth(student))).status, 403);
    eq((await req(port, 'DELETE', '/api/sets/nope-999', undefined, undefined,
      auth(teacher))).status, 404);
    var del = await req(port, 'DELETE', '/api/sets/geo-101', undefined, undefined,
      auth(teacher));
    eq(del.status, 200);
    eq((await req(port, 'GET', '/api/sets/geo-101', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'GET', '/api/submissions/' + sub1.json.id, undefined,
      undefined, auth(teacher))).status, 404);
    var mineAfter = await req(port, 'GET', '/api/submissions/mine', undefined, undefined,
      auth(student));
    eq(mineAfter.json.submissions.length, 1);
    eq(mineAfter.json.submissions[0].set_code, 'geo-102');
    pass('cpp set delete cascades');

    // 34 method mismatches on sets routes
    var setM = await req(port, 'POST', '/api/sets',
      { code: 'geo-m', title: 'm', questions: goodQ }, undefined, auth(teacher));
    eq(setM.status, 201);
    eq((await req(port, 'PUT', '/api/sets', {})).status, 405);
    eq((await req(port, 'DELETE', '/api/sets')).status, 405);
    eq((await req(port, 'POST', '/api/sets/geo-m', {})).status, 404);
    eq((await req(port, 'PUT', '/api/sets/geo-m/submissions', {})).status, 405);
    eq((await req(port, 'DELETE', '/api/sets/geo-m/submissions')).status, 404);
    eq((await req(port, 'GET', '/api/sets/geo-m/unknown', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'POST', '/api/submissions/mine', {})).status, 405);
    eq((await req(port, 'PUT', '/api/submissions/1', {})).status, 405);
    pass('cpp sets methods');

    // 35 teacher creates a class; validation + roles
    var cls1 = await req(port, 'POST', '/api/classes',
      { code: 'be-101', title: 'BE-A Graphics' }, undefined, auth(teacher));
    eq(cls1.status, 201);
    ok(cls1.json.id > 0, 'class id');
    eq(cls1.json.code, 'be-101');
    async function badClass(payload, token, raw) {
      return (await req(port, 'POST', '/api/classes', payload, raw,
        token === null ? undefined : auth(token))).status;
    }
    eq(await badClass({ code: 'be-101', title: 'dup' }, teacher), 409);
    eq(await badClass({ code: 'ab', title: 't' }, teacher), 400);
    eq(await badClass({ code: 'has space!', title: 't' }, teacher), 400);
    eq(await badClass({ title: 't' }, teacher), 400);
    eq(await badClass({ code: 'be-102', title: 7 }, teacher), 400);
    eq(await badClass({ code: 'be-102', title: 't' }, student), 403);
    eq(await badClass({ code: 'be-102', title: 't' }, null), 401);
    var clsA = await req(port, 'POST', '/api/classes',
      { code: 'ac-100', title: 'Office class' }, undefined, auth(academics));
    eq(clsA.status, 201);
    pass('cpp class create validation roles');

    // 36 class list scoping per role
    var teachCls = await req(port, 'GET', '/api/classes', undefined, undefined,
      auth(teacher));
    eq(teachCls.status, 200);
    eq(teachCls.json.classes.length, 1);
    eq(teachCls.json.classes[0].code, 'be-101');
    eq(teachCls.json.classes[0].owner, 'Demo Teacher');
    eq(teachCls.json.classes[0].nmembers, 0);
    eq(teachCls.json.classes[0].nsets, 0);
    var stuCls = await req(port, 'GET', '/api/classes', undefined, undefined,
      auth(student));
    eq(stuCls.json.classes.length, 0);
    var acadCls = await req(port, 'GET', '/api/classes', undefined, undefined,
      auth(academics));
    eq(acadCls.json.classes.length, 2);
    eq((await req(port, 'GET', '/api/classes')).status, 401);
    pass('cpp class list scope');

    // 37 join/leave round-trip + member list privacy
    eq((await req(port, 'GET', '/api/classes/be-101', undefined, undefined,
      auth(student))).status, 403);
    var join1 = await req(port, 'POST', '/api/classes/be-101/join', {},
      undefined, auth(student));
    eq(join1.status, 200);
    eq(join1.json.joined, true);
    var join2 = await req(port, 'POST', '/api/classes/be-101/join', {},
      undefined, auth(student));
    eq(join2.json.joined, false);
    eq((await req(port, 'POST', '/api/classes/be-101/join', {}, undefined,
      auth(teacher))).status, 400);
    eq((await req(port, 'POST', '/api/classes/nope-999/join', {}, undefined,
      auth(student))).status, 404);
    var gotCls = await req(port, 'GET', '/api/classes/be-101', undefined, undefined,
      auth(student));
    eq(gotCls.status, 200);
    eq(gotCls.json.title, 'BE-A Graphics');
    eq(gotCls.json.nmembers, 1);
    var mem = await req(port, 'GET', '/api/classes/be-101/members', undefined,
      undefined, auth(teacher));
    eq(mem.status, 200);
    eq(mem.json.members.length, 1);
    eq(mem.json.members[0].username, 'student');
    eq(mem.json.members[0].name, 'Demo Student');
    eq((await req(port, 'GET', '/api/classes/be-101/members', undefined,
      undefined, auth(student))).status, 403);
    var leave1 = await req(port, 'POST', '/api/classes/be-101/leave', {},
      undefined, auth(student));
    eq(leave1.status, 200);
    eq(leave1.json.left, true);
    var leave2 = await req(port, 'POST', '/api/classes/be-101/leave', {},
      undefined, auth(student));
    eq(leave2.json.left, false);
    eq((await req(port, 'GET', '/api/classes/be-101', undefined, undefined,
      auth(student))).status, 403);
    eq((await req(port, 'POST', '/api/classes/be-101/join', {}, undefined,
      auth(student))).json.joined, true);
    pass('cpp class join leave members');

    // 38 sets posted to a class; student feed merges class + open sets
    var cset = await req(port, 'POST', '/api/sets',
      { code: 'geo-201', title: 'Class set', class_code: 'be-101',
        questions: goodQ }, undefined, auth(teacher));
    eq(cset.status, 201);
    var gotCSet = await req(port, 'GET', '/api/sets/geo-201', undefined, undefined,
      auth(teacher));
    eq(gotCSet.json.class_code, 'be-101');
    eq(gotCSet.json.class_title, 'BE-A Graphics');
    eq(await badSet({ code: 'geo-x1', title: 't', questions: goodQ,
      class_code: 'nope-999' }, teacher), 404);
    eq(await badSet({ code: 'geo-x2', title: 't', questions: goodQ,
      class_code: 7 }, teacher), 400);
    eq(await badSet({ code: 'geo-x3', title: 't', questions: goodQ,
      class_code: 'ac-100' }, teacher), 403);
    var csetA = await req(port, 'POST', '/api/sets',
      { code: 'geo-202', title: 'Office in class', class_code: 'be-101',
        questions: goodQ }, undefined, auth(academics));
    eq(csetA.status, 201);
    var feed = await req(port, 'GET', '/api/sets', undefined, undefined,
      auth(student));
    var feedCodes = feed.json.sets.map(function (e) { return e.code; }).sort();
    assert.deepStrictEqual(feedCodes, ['geo-102', 'geo-201', 'geo-202', 'geo-m']);
    var csets = await req(port, 'GET', '/api/classes/be-101/sets', undefined,
      undefined, auth(student));
    eq(csets.status, 200);
    eq(csets.json.sets.length, 2);
    eq(csets.json.sets[0].nquestions, 1);
    var csetsT = await req(port, 'GET', '/api/classes/be-101/sets', undefined,
      undefined, auth(teacher));
    eq(csetsT.json.sets.length, 2);
    pass('cpp class sets feed');

    // 39 class content gates for outsiders
    eq((await req(port, 'GET', '/api/classes/ac-100/sets', undefined, undefined,
      auth(student))).status, 403);
    eq((await req(port, 'GET', '/api/classes/ac-100', undefined, undefined,
      auth(student))).status, 403);
    eq((await req(port, 'GET', '/api/classes/ac-100/sets', undefined, undefined,
      auth(teacher))).status, 403);
    eq((await req(port, 'GET', '/api/classes/nope-999/sets', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'GET', '/api/classes/ab', undefined, undefined,
      auth(teacher))).status, 404);
    pass('cpp class gates');

    // 40 student submits into a class set; teacher reviews
    var csub = await req(port, 'POST', '/api/sets/geo-201/submissions',
      { data: { version: 1, entities: [{ id: 'E9' }] }, note: 'class try' },
      undefined, auth(student));
    eq(csub.status, 201);
    var csubs = await req(port, 'GET', '/api/sets/geo-201/submissions', undefined,
      undefined, auth(teacher));
    eq(csubs.json.submissions.length, 1);
    eq(csubs.json.submissions[0].note, 'class try');
    var cone = await req(port, 'GET', '/api/submissions/' + csub.json.id, undefined,
      undefined, auth(teacher));
    eq(cone.status, 200);
    eq(cone.json.set_code, 'geo-201');
    assert.deepStrictEqual(cone.json.data, { version: 1, entities: [{ id: 'E9' }] });
    pass('cpp class submission review');

    // 41 deleting a class unlinks its sets (open) and drops memberships
    eq((await req(port, 'DELETE', '/api/classes/be-101', undefined, undefined,
      auth(student))).status, 403);
    eq((await req(port, 'DELETE', '/api/classes/nope-999', undefined, undefined,
      auth(teacher))).status, 404);
    var delC = await req(port, 'DELETE', '/api/classes/be-101', undefined,
      undefined, auth(teacher));
    eq(delC.status, 200);
    eq((await req(port, 'GET', '/api/classes/be-101', undefined, undefined,
      auth(teacher))).status, 404);
    var unlinked = await req(port, 'GET', '/api/sets/geo-201', undefined, undefined,
      auth(teacher));
    eq(unlinked.status, 200);
    eq(unlinked.json.class_code, '');
    var feedAfter = await req(port, 'GET', '/api/sets', undefined, undefined,
      auth(student));
    ok(feedAfter.json.sets.some(function (e) { return e.code === 'geo-201'; }),
      'unlinked set stays solvable');
    var delA = await req(port, 'DELETE', '/api/classes/ac-100', undefined,
      undefined, auth(academics));
    eq(delA.status, 200);
    pass('cpp class delete unlinks');

    // 42 method mismatches on class routes
    var clsM = await req(port, 'POST', '/api/classes',
      { code: 'mm-100', title: 'm' }, undefined, auth(teacher));
    eq(clsM.status, 201);
    eq((await req(port, 'PUT', '/api/classes', {})).status, 405);
    eq((await req(port, 'DELETE', '/api/classes')).status, 405);
    eq((await req(port, 'POST', '/api/classes/mm-100', {}, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'GET', '/api/classes/mm-100/join', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'PUT', '/api/classes/mm-100/members', {})).status, 405);
    eq((await req(port, 'GET', '/api/classes/mm-100/unknown', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'DELETE', '/api/classes/mm-100/join', undefined, undefined,
      auth(teacher))).status, 404);
    eq((await req(port, 'POST', '/api/classes/mm-100/members', {}, undefined,
      auth(teacher))).status, 404);
    pass('cpp class methods');

    // 43 port precedence: argv beats $PORT, bogus values fall back to 8124
    var src43 = fs.readFileSync(path.join(ROOT, 'backend', 'src', 'main.cpp'), 'utf8');
    ok(/const int kDefaultPort = 8124;/.test(src43), 'default 8124');
    ok(/const char \*kHost = "127\.0\.0\.1";/.test(src43), 'localhost host');
    var pA = await freePort();
    var holder = net.createServer();
    await new Promise(function (resolve, reject) {
      holder.once('error', reject);
      holder.listen(pA, '127.0.0.1', resolve);
    });
    var pB = await freePort();
    ok(pB !== pA, 'distinct ports ' + pA + '/' + pB);
    var srv43a = child.spawn(SERVER, [String(pB)], {
      env: Object.assign({}, process.env,
        { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR, PORT: String(pA) }),
      stdio: ['ignore', 'ignore', 'pipe']
    });
    var err43a = '';
    srv43a.stderr.on('data', function (c) { err43a += c; });
    try {
      await waitReady(pB, srv43a, 10000);
      ok(err43a.indexOf('busy') === -1, 'no busy detour: ' + err43a);
    } finally {
      srv43a.kill('SIGTERM');
      await new Promise(function (res) { srv43a.on('exit', res); });
    }
    await new Promise(function (resolve) { holder.close(resolve); });
    var pC = await freePort();
    var srv43b = child.spawn(SERVER, [], {
      env: Object.assign({}, process.env,
        { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR, PORT: String(pC) }),
      stdio: ['ignore', 'ignore', 'ignore']
    });
    try {
      await waitReady(pC, srv43b, 10000);
    } finally {
      srv43b.kill('SIGTERM');
      await new Promise(function (res) { srv43b.on('exit', res); });
    }
    var pD = await freePort();
    var srv43c = child.spawn(SERVER, [String(pD)], {
      env: Object.assign({}, process.env,
        { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR, PORT: 'bogus' }),
      stdio: ['ignore', 'ignore', 'ignore']
    });
    try {
      await waitReady(pD, srv43c, 10000);
    } finally {
      srv43c.kill('SIGTERM');
      await new Promise(function (res) { srv43c.on('exit', res); });
    }
    var env43d = Object.assign({}, process.env,
      { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR });
    delete env43d.PORT;
    var srv43d = child.spawn(SERVER, [], {
      env: env43d, stdio: ['ignore', 'pipe', 'pipe']
    });
    var out43d = '';
    var err43d = '';
    srv43d.stdout.on('data', function (c) { out43d += c; });
    srv43d.stderr.on('data', function (c) { err43d += c; });
    var actual43d = 0;
    try {
      var t43 = Date.now();
      await new Promise(function (resolve, reject) {
        (function poll() {
          var m = /educad serve http:\/\/127\.0\.0\.1:(\d+)\//.exec(out43d);
          if (m) { actual43d = parseInt(m[1], 10); return resolve(); }
          if (srv43d.exitCode !== null) return reject(new Error('server exited early'));
          if (Date.now() - t43 > 10000) return reject(new Error('no serve line'));
          setTimeout(poll, 100);
        })();
      });
      if (actual43d === 8124) {
        ok(err43d.indexOf('busy') === -1, 'clean 8124 bind');
      } else {
        ok(/busy, using/.test(err43d), 'busy notice for ' + actual43d);
      }
      var r43d = await req(actual43d, 'GET', '/login.html');
      eq(r43d.status, 200);
    } finally {
      srv43d.kill('SIGTERM');
      await new Promise(function (res) { srv43d.on('exit', res); });
    }
    pass('cpp port precedence');
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

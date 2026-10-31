'use strict';
// Reference-3D preview black-box test: teachers attach a 3D preview derived
// from the model answer; students see that preview while solving (to draw
// the 2D views from) but never the 2D model ink. A per-question show_3d
// toggle controls visibility; when on, the preview is served, when off it
// is withheld like the model. Run: `npm run test:phase47`
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
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 13;
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

// One VP dot + one HP dot + the projector joining them: reconstructs to a
// single 3D corner. Entities use the same row shape as sheet snapshots.
function dotPairModel() {
  return {
    version: 1,
    entities: [
      { id: 'A', type: 'POINT', x: 0, y: 10, viewRole: 'BOTH' },
      { id: 'a', type: 'POINT', x: 0, y: -5, viewRole: 'BOTH' },
      { id: 'P1', type: 'SEGMENT', x: 0, y: -5, x2: 0, y2: 10, viewRole: 'BOTH' }
    ]
  };
}

// The exact preview buildPreview must derive from dotPairModel above.
var DOT_PREVIEW = {
  status: 'ok',
  geometry: {
    name: 'wireframe',
    vertices: [{ x: 0, y: 10, z: 5 }],
    edges: [],
    faces: []
  }
};

function boxModel() {
  function pt(id, x, y, cap) {
    return { id: id, type: 'POINT', x: x, y: y, viewRole: 'BOTH', caption: cap };
  }
  function seg(id, x, y, x2, y2) {
    return { id: id, type: 'SEGMENT', x: x, y: y, x2: x2, y2: y2, viewRole: 'BOTH' };
  }
  return {
    version: 1,
    entities: [
      pt('A1', -10, 5, "a'"), pt('B1', 10, 5, "b'"),
      pt('C1', 10, 15, "c'"), pt('D1', -10, 15, "d'"),
      pt('a1', -10, -5, 'a'), pt('b1', 10, -5, 'b'),
      pt('c1', 10, -15, 'c'), pt('d1', -10, -15, 'd'),
      seg('E1', -10, 5, 10, 5), seg('E2', 10, 5, 10, 15),
      seg('E3', 10, 15, -10, 15), seg('E4', -10, 15, -10, 5),
      seg('P1', -10, -5, 10, -5), seg('P2', 10, -5, 10, -15),
      seg('P3', 10, -15, -10, -15), seg('P4', -10, -15, -10, -5),
      seg('X1', -10, -15, -10, 15), seg('X2', 10, -15, 10, 15)
    ]
  };
}

async function main() {
  ok(fs.existsSync(SERVER), 'educad-server built');
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'educad-p47-'));
  var db = path.join(tmp, 'educad.db');
  var seed = child.spawnSync(SEED, [USERS, db], { encoding: 'utf8' });
  eq(seed.status, 0, 'seed exit 0');
  pass('p47 seed ok');

  var port = await freePort();
  var srv = child.spawn(SERVER, [String(port)], {
    env: Object.assign({}, process.env, { EDUCAD_STUDENT_AUTH: 'demo', EDUCAD_DB: db, EDUCAD_ROOT: MIRROR }),
    stdio: ['ignore', 'ignore', 'pipe']
  });
  try {
    await waitReady(port, srv, 10000);
    function auth(token) { return { Authorization: 'Bearer ' + token }; }
    var teacher = (await req(port, 'POST', '/api/login',
      { role: 'teacher', username: 'teacher', password: 'teach123' })).json.token;
    var student = (await req(port, 'POST', '/api/login',
      { role: 'student', username: 'student', password: 'learn123' })).json.token;
    ok(teacher && student, 'two tokens');
    pass('p47 logins ok');

    // 3 preview on: owner sees model + preview; student sees the preview
    // only — the 2D ink stays withheld.
    var mk = await req(port, 'POST', '/api/sets', {
      code: 'r3d-001', title: 'Ref3D',
      questions: [{
        prompt: 'Draw the views of the corner.',
        model: dotPairModel(), model3d: DOT_PREVIEW, show_3d: true
      }]
    }, undefined, auth(teacher));
    eq(mk.status, 201);
    var own = await req(port, 'GET', '/api/sets/r3d-001', undefined, undefined,
      auth(teacher));
    eq(own.status, 200);
    assert.deepStrictEqual(own.json.questions[0].model, dotPairModel());
    assert.deepStrictEqual(own.json.questions[0].model3d, DOT_PREVIEW);
    eq(own.json.questions[0].has_3d, true);
    eq(own.json.questions[0].show_3d, true);
    var stu = await req(port, 'GET', '/api/sets/r3d-001', undefined, undefined,
      auth(student));
    eq(stu.status, 200);
    eq(stu.json.questions[0].model, undefined);
    assert.deepStrictEqual(stu.json.questions[0].model3d, DOT_PREVIEW);
    eq(stu.json.questions[0].has_3d, true);
    eq(stu.json.questions[0].show_3d, true);
    ok(stu.body.indexOf('"x2":0') === -1, 'no 2D segment coords leak');
    ok(stu.body.indexOf('"z":5') !== -1, '3D corner served');
    pass('p47 preview served, 2D withheld');

    // 4 preview off: the preview is withheld like the model.
    var mkOff = await req(port, 'POST', '/api/sets', {
      code: 'r3d-002', title: 'Ref3D off',
      questions: [{
        prompt: 'Draw it blind.',
        model: dotPairModel(), model3d: DOT_PREVIEW, show_3d: false
      }]
    }, undefined, auth(teacher));
    eq(mkOff.status, 201);
    var stuOff = await req(port, 'GET', '/api/sets/r3d-002', undefined, undefined,
      auth(student));
    eq(stuOff.status, 200);
    eq(stuOff.json.questions[0].model, undefined);
    eq(stuOff.json.questions[0].model3d, undefined);
    eq(stuOff.json.questions[0].has_3d, true);
    eq(stuOff.json.questions[0].show_3d, false);
    ok(stuOff.body.indexOf('"z":5') === -1, 'no 3D coords leak');
    pass('p47 preview off withholds');

    // 5 an attached preview is visible by default (the toggle turns it
    // off); legacy questions without one show nothing either way.
    var mkDef = await req(port, 'POST', '/api/sets', {
      code: 'r3d-003', title: 'Ref3D default',
      questions: [
        { prompt: 'Default on.', model: dotPairModel(), model3d: DOT_PREVIEW },
        { prompt: 'Legacy: no preview.', model: dotPairModel() }
      ]
    }, undefined, auth(teacher));
    eq(mkDef.status, 201);
    var ownDef = await req(port, 'GET', '/api/sets/r3d-003', undefined, undefined,
      auth(teacher));
    eq(ownDef.json.questions[0].show_3d, true);
    eq(ownDef.json.questions[1].has_3d, false);
    var stuDef = await req(port, 'GET', '/api/sets/r3d-003', undefined, undefined,
      auth(student));
    assert.deepStrictEqual(stuDef.json.questions[0].model3d, DOT_PREVIEW);
    eq(stuDef.json.questions[1].model3d, undefined);
    pass('p47 preview visible by default');

    // 6 bad inline preview shapes rejected.
    async function badQ(q) {
      return (await req(port, 'POST', '/api/sets',
        { code: 'r3d-bad', title: 't', questions: [q] }, undefined,
        auth(teacher))).status;
    }
    eq(await badQ({ prompt: 'q', model3d: [1] }), 400);
    eq(await badQ({ prompt: 'q', model3d: DOT_PREVIEW, show_3d: 'yes' }), 400);
    pass('p47 inline preview validation');

    // 7 PUT model carries a fresh preview; replacing without one erases
    // the stale preview, and clearing the model erases it too.
    var put = await req(port, 'PUT', '/api/sets/r3d-002/questions/0/model',
      { data: dotPairModel(), model3d: DOT_PREVIEW }, undefined, auth(teacher));
    eq(put.status, 200);
    var ownPut = await req(port, 'GET', '/api/sets/r3d-002', undefined, undefined,
      auth(teacher));
    assert.deepStrictEqual(ownPut.json.questions[0].model3d, DOT_PREVIEW);
    var putStale = await req(port, 'PUT', '/api/sets/r3d-002/questions/0/model',
      { data: dotPairModel() }, undefined, auth(teacher));
    eq(putStale.status, 200);
    var ownStale = await req(port, 'GET', '/api/sets/r3d-002', undefined, undefined,
      auth(teacher));
    eq(ownStale.json.questions[0].model3d, undefined);
    eq(ownStale.json.questions[0].has_3d, false);
    var clr = await req(port, 'DELETE', '/api/sets/r3d-001/questions/0/model',
      undefined, undefined, auth(teacher));
    eq(clr.status, 200);
    var ownClr = await req(port, 'GET', '/api/sets/r3d-001', undefined, undefined,
      auth(teacher));
    eq(ownClr.json.questions[0].model3d, undefined);
    eq(ownClr.json.questions[0].has_3d, false);
    eq(ownClr.json.questions[0].show_3d, false);
    pass('p47 preview follows the model');

    // 8 the show3d toggle is owner-gated and needs a preview to enable.
    eq((await req(port, 'PUT', '/api/sets/r3d-003/questions/0/show3d',
      { enabled: false }, undefined, auth(student))).status, 403);
    eq((await req(port, 'PUT', '/api/sets/r3d-003/questions/1/show3d',
      { enabled: true }, undefined, auth(teacher))).status, 400);
    eq((await req(port, 'PUT', '/api/sets/r3d-003/questions/0/show3d',
      {}, undefined, auth(teacher))).status, 400);
    eq((await req(port, 'PUT', '/api/sets/r3d-003/questions/9/show3d',
      { enabled: true }, undefined, auth(teacher))).status, 404);
    var tOff = await req(port, 'PUT', '/api/sets/r3d-003/questions/0/show3d',
      { enabled: false }, undefined, auth(teacher));
    eq(tOff.status, 200);
    eq(tOff.json.show_3d, false);
    var stuT = await req(port, 'GET', '/api/sets/r3d-003', undefined, undefined,
      auth(student));
    eq(stuT.json.questions[0].model3d, undefined);
    var tOn = await req(port, 'PUT', '/api/sets/r3d-003/questions/0/show3d',
      { enabled: true }, undefined, auth(teacher));
    eq(tOn.json.show_3d, true);
    var stuT2 = await req(port, 'GET', '/api/sets/r3d-003', undefined, undefined,
      auth(student));
    assert.deepStrictEqual(stuT2.json.questions[0].model3d, DOT_PREVIEW);
    pass('p47 show3d toggle gates');

    // 9 method guards on the new route.
    eq((await req(port, 'GET', '/api/sets/r3d-003/questions/0/show3d', undefined,
      undefined, auth(teacher))).status, 405);
    eq((await req(port, 'DELETE', '/api/sets/r3d-003/questions/0/show3d', undefined,
      undefined, auth(teacher))).status, 405);
    pass('p47 new route methods');

    // 10 the preview builder derives honest geometry from model ink.
    var Ref = require(path.join(ROOT, 'public', 'lib', 'educad-ref3d.js'));
    var R = require(path.join(ROOT, 'public', 'lib', 'educad-reconstruct.js'));
    assert.deepStrictEqual(
      Ref.buildPreview(dotPairModel().entities, R), DOT_PREVIEW);
    var box = Ref.buildPreview(boxModel().entities, R);
    eq(box.status, 'ok');
    eq(box.geometry.vertices.length, 4);
    eq(box.geometry.edges.length, 4);
    ok(Array.isArray(box.geometry.faces), 'faces array');
    var lone = Ref.buildPreview(
      [{ id: 'A', type: 'POINT', x: 0, y: 10, viewRole: 'BOTH' }], R);
    eq(lone.status, 'unavailable');
    eq(lone.reason, 'empty-sketch');
    eq(Ref.buildPreview(dotPairModel().entities, null), null);
    eq(Ref.buildPreview(null, R), null);
    pass('p47 preview builder');

    // 11 the preview validator accepts served shapes and rejects junk.
    ok(Ref.validPreview(DOT_PREVIEW), 'ok preview valid');
    ok(Ref.validPreview({ status: 'unavailable', reason: 'empty-sketch',
      label: 'nothing with both views drawn yet' }), 'unavailable valid');
    ok(!Ref.validPreview(null), 'null rejected');
    ok(!Ref.validPreview({}), 'empty rejected');
    ok(!Ref.validPreview({ status: 'ok' }), 'geometry-less rejected');
    ok(!Ref.validPreview({ status: 'ok',
      geometry: { vertices: [{ x: 0, y: 0 }], edges: [], faces: [] } }),
      'bad vertex rejected');
    pass('p47 preview validator');

    // 12 studio + sheet wire the toggle and the reference card.
    var teacherJs = fs.readFileSync(
      path.join(MIRROR, 'teacher.js'), 'utf8');
    var teacherHtml = fs.readFileSync(
      path.join(MIRROR, 'teacher.html'), 'utf8');
    var sheet = fs.readFileSync(path.join(MIRROR, 'index.html'), 'utf8');
    var savesJs = fs.readFileSync(
      path.join(MIRROR, 'lib', 'educad-saves.js'), 'utf8');
    ok(teacherHtml.indexOf('lib/educad-reconstruct.js') !== -1,
      'studio loads reconstruct');
    ok(teacherHtml.indexOf('lib/educad-ref3d.js') !== -1, 'studio loads ref3d');
    ok(teacherJs.indexOf('setQuestionShow3d') !== -1, 'studio toggles 3D');
    ok(teacherJs.indexOf('Show 3D preview') !== -1, 'studio labels 3D');
    ok(savesJs.indexOf('setQuestionShow3d') !== -1, 'saves sends 3D toggle');
    ok(sheet.indexOf('lib/educad-ref3d.js') !== -1, 'sheet loads ref3d');
    ok(sheet.indexOf('Reference 3D') !== -1, 'sheet shows reference card');
    ok(sheet.indexOf('educadRef3d') !== -1, 'reference card API');
    pass('p47 studio + sheet wiring');

    // 13 readme + package wiring.
    var readme = fs.readFileSync(README_PATH, 'utf8');
    ok(readme.indexOf('`npm run test:phase47`') !== -1, 'phase47 row');
    ok(readme.indexOf('Reference 3D: model previews students can draw from') !== -1,
      'phase47 label');
    ok(readme.indexOf('baseline + phases 1–47 (1060 checks)') !== -1,
      'grand total 1060');
    var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
    eq(pkg.scripts['test:phase47'],
      'npm run build:cpp && node tools/test-phase47-ref3d.js',
      'test:phase47 script');
    ok(pkg.scripts.test.indexOf('node tools/test-phase47-ref3d.js') !== -1,
      'chained in test');
    pass('p47 package wiring');
  } finally {
    srv.kill('SIGTERM');
    await new Promise(function (resolve) { srv.on('exit', resolve); });
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' phase47 ref3d tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

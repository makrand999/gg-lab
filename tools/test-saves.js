'use strict';
// Saves module: snapshot/restore round-trips plus the API client against a
// stub fetch (no server needed; the live API is covered by test:cpp).
// Standalone like test:login: `npm run test:saves` (not in `npm test`).
var assert = require('assert');
var E = require('../public/lib/educad-entities.js');
var S = require('../public/lib/educad-saves.js');

var TOTAL = 20;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

function memStorage(saved) {
  var data = saved === undefined ? null : saved;
  return {
    getItem: function () { return data; },
    setItem: function (k, v) { data = String(v); }
  };
}
function session(role, token) {
  return { role: role, username: role, name: role, token: token };
}
// Stub fetch capturing calls; routes on 'METHOD path'.
function stubFetch(routes) {
  var calls = [];
  function f(path, init) {
    calls.push({ path: path, init: init });
    var r = routes[init.method + ' ' + path] || { status: 404, body: { ok: false, error: 'not found' } };
    return Promise.resolve({
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: function () { return Promise.resolve(r.body); }
    });
  }
  f.calls = calls;
  return f;
}

async function main() {
  // 1 exports
  eq(S.SAVE_VERSION, 1);
  eq(S.SESSION_KEY, 'educad_session');
  ['currentSession', 'isGuest', 'snapshotTable', 'restoreTable', 'apiRequest',
   'listDrawings', 'createDrawing', 'getDrawing', 'updateDrawing',
   'deleteDrawing', 'listSets', 'createSet', 'getSet', 'deleteSet',
   'submitSolution', 'listSubmissions', 'getSubmission', 'listMySubmissions',
   'listProgress', 'putProgress',
   'recordProgress', 'fetchProgress'].forEach(function (k) {
    eq(typeof S[k], 'function', k);
  });
  pass('saves exports');

  // 2 session + guest classification
  var store = memStorage(JSON.stringify(session('student', 'tok123')));
  deep(S.currentSession(store), session('student', 'tok123'));
  eq(S.currentSession(memStorage(null)), null);
  eq(S.currentSession(memStorage('{oops')), null);
  eq(S.isGuest(null), true);
  eq(S.isGuest(session('guest', 'guest')), true);
  eq(S.isGuest(session('student', '')), true);
  eq(S.isGuest(session('student', 'tok123')), false);
  pass('saves session guest gate');

  // 3 snapshot shape + detachment from live table
  E.resetIdCounter();
  var t = E.createTable();
  t.create('POINT', { x: 1, y: 2 });
  t.create('SEGMENT', { x: 0, y: 0, x2: 10, y2: 0, bisCode: 'A' });
  var snap = S.snapshotTable(t);
  eq(snap.version, 1);
  eq(typeof snap.savedAt, 'number');
  eq(snap.entities.length, 2);
  eq(snap.entities[1].bisCode, 'A');
  t.get(snap.entities[0].id).x = 999;
  eq(snap.entities[0].x, 1);
  pass('saves snapshot detaches');

  // 4 restore round-trip preserves every field
  var t2 = E.createTable();
  eq(S.restoreTable(E, t2, snap), 2);
  deep(t2.list(), t.list().map(function (e) {
    var c = JSON.parse(JSON.stringify(e));
    if (c.id === snap.entities[0].id) c.x = 1;
    return c;
  }));
  pass('saves restore round-trip');

  // 5 restore rejects malformed payloads
  [['null', null], ['array', []], ['no entities', {}],
   ['bad entry', { entities: [null] }], ['bad type', { entities: [{ type: 'NOPE' }] }],
   ['bad numbers', { entities: [{ type: 'POINT', x: 'a', y: 0 }] }],
   ['coincident', { entities: [{ type: 'SEGMENT', x: 1, y: 1, x2: 1, y2: 1 }] }]
  ].forEach(function (pair) {
    assert.throws(function () { S.restoreTable(E, E.createTable(), pair[1]); }, Error, pair[0]);
  });
  assert.throws(function () {
    S.restoreTable(E, E.createTable(), { entities: [
      { type: 'POINT', id: 'D1', x: 0, y: 0 }, { type: 'POINT', id: 'D1', x: 1, y: 1 }
    ] });
  }, /duplicate/, 'dup ids');
  pass('saves restore rejects malformed');

  // 6 failed restore leaves the live table untouched (atomicity)
  var t3 = E.createTable();
  t3.create('POINT', { x: 5, y: 6 });
  assert.throws(function () {
    S.restoreTable(E, t3, { entities: [
      { type: 'POINT', x: 0, y: 0 }, { type: 'BOGUS' }
    ] });
  }, Error);
  eq(t3.count(), 1);
  eq(t3.list()[0].x, 5);
  pass('saves restore atomic');

  // 7 apiRequest attaches auth + parses ok
  var f7 = stubFetch({ 'GET api/me': { status: 200, body: { ok: true, username: 's' } } });
  var me = await S.apiRequest(f7, 'GET', 'api/me', session('student', 'tok123'));
  eq(me.username, 's');
  eq(f7.calls.length, 1);
  eq(f7.calls[0].init.headers.Authorization, 'Bearer tok123');
  pass('saves api auth header');

  // 8 guest never reaches fetch
  var f8 = stubFetch({});
  await S.apiRequest(f8, 'GET', 'api/me', session('guest', 'guest')).then(function () {
    throw new Error('guest must reject');
  }, function (err) {
    ok(/guest/.test(err.message), 'guest error');
  });
  eq(f8.calls.length, 0);
  pass('saves guest blocked');

  // 9 api errors carry status + server message
  var f9 = stubFetch({ 'GET api/me': { status: 401, body: { ok: false, error: 'unauthorized' } } });
  await S.apiRequest(f9, 'GET', 'api/me', session('student', 'bad')).then(function () {
    throw new Error('401 must reject');
  }, function (err) {
    eq(err.status, 401);
    eq(err.message, 'unauthorized');
  });
  pass('saves api error shape');

  // 10 drawing CRUD wrappers hit method + path
  var f10 = stubFetch({
    'POST api/drawings': { status: 201, body: { ok: true, id: 7 } },
    'GET api/drawings': { status: 200, body: { ok: true, drawings: [] } },
    'GET api/drawings/7': { status: 200, body: { ok: true, id: 7 } },
    'PUT api/drawings/7': { status: 200, body: { ok: true, id: 7 } },
    'DELETE api/drawings/7': { status: 200, body: { ok: true } }
  });
  var s10 = session('teacher', 't');
  eq((await S.createDrawing(f10, s10, 'T', { a: 1 })).id, 7);
  deep(JSON.parse(f10.calls[0].init.body), { title: 'T', data: { a: 1 } });
  await S.listDrawings(f10, s10);
  await S.getDrawing(f10, s10, 7);
  await S.updateDrawing(f10, s10, 7, { title: 'T2' });
  await S.deleteDrawing(f10, s10, 7);
  deep(f10.calls.map(function (c) { return c.init.method + ' ' + c.path; }), [
    'POST api/drawings', 'GET api/drawings', 'GET api/drawings/7',
    'PUT api/drawings/7', 'DELETE api/drawings/7'
  ]);
  pass('saves drawing wrappers');

  // 11 progress wrappers hit method + path
  var f11 = stubFetch({
    'PUT api/progress/square': { status: 200, body: { ok: true, lesson: 'square' } },
    'GET api/progress': { status: 200, body: { ok: true, progress: [] } }
  });
  var s11 = session('student', 't');
  eq((await S.putProgress(f11, s11, 'square', { done: true })).lesson, 'square');
  deep(JSON.parse(f11.calls[0].init.body), { state: { done: true } });
  await S.listProgress(f11, s11);
  deep(f11.calls.map(function (c) { return c.init.method + ' ' + c.path; }), [
    'PUT api/progress/square', 'GET api/progress'
  ]);
  pass('saves progress wrappers');

  // 12 recordProgress skips guests, posts for users
  var g12 = await S.recordProgress('square', { done: true },
    { storage: memStorage(JSON.stringify(session('guest', 'guest'))), fetch: stubFetch({}) });
  eq(g12.skipped, true);
  var f12 = stubFetch({
    'PUT api/progress/square': { status: 200, body: { ok: true, lesson: 'square' } }
  });
  var u12 = await S.recordProgress('square', { done: true },
    { storage: memStorage(JSON.stringify(session('student', 't'))), fetch: f12 });
  eq(u12.skipped, false);
  eq(f12.calls.length, 1);
  pass('saves recordProgress gate');

  // 13 fetchProgress skips guests, lists for users
  var g13 = await S.fetchProgress(
    { storage: memStorage(null), fetch: stubFetch({}) });
  eq(g13.skipped, true);
  deep(g13.progress, []);
  var f13 = stubFetch({
    'GET api/progress': { status: 200, body: { ok: true, progress: [{ lesson: 'square' }] } }
  });
  var u13 = await S.fetchProgress(
    { storage: memStorage(JSON.stringify(session('student', 't'))), fetch: f13 });
  eq(u13.skipped, false);
  eq(u13.progress.length, 1);
  pass('saves fetchProgress gate');

  // 14 snapshot of empty table restores to empty
  var te = E.createTable();
  var se = S.snapshotTable(te);
  deep(se.entities, []);
  var te2 = E.createTable();
  te2.create('POINT', { x: 1, y: 1 });
  eq(S.restoreTable(E, te2, se), 0);
  eq(te2.count(), 0);
  pass('saves empty round-trip');

  // 15 ids survive the round-trip (stable references)
  E.resetIdCounter();
  var t15 = E.createTable();
  var p15 = t15.create('POINT', { x: 2, y: 3 });
  var t15b = E.createTable();
  S.restoreTable(E, t15b, S.snapshotTable(t15));
  ok(t15b.get(p15.id) !== null, 'id stable');
  eq(t15b.get(p15.id).x, 2);
  pass('saves ids stable');

  // 16 module file ships (browser global path loads it)
  var fs = require('fs');
  var path = require('path');
  var src = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'lib', 'educad-saves.js'), 'utf8');
  ok(src.indexOf('EduCADSaves') !== -1, 'global export');
  var html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ok(html.indexOf('educad-saves.js') !== -1, 'index includes module');
  ok(html.indexOf('id="btn-save"') !== -1, 'save button ships');
  ok(html.indexOf('id="btn-drawings"') !== -1, 'drawings button ships');
  pass('saves ui ships');

  // 17 sets wrappers hit method + path with the create body shape
  var f17 = stubFetch({
    'POST api/sets': { status: 201, body: { ok: true, id: 3, code: 'geo-1' } },
    'GET api/sets': { status: 200, body: { ok: true, sets: [] } },
    'GET api/sets/geo-1': { status: 200, body: { ok: true, code: 'geo-1' } },
    'DELETE api/sets/geo-1': { status: 200, body: { ok: true } }
  });
  var s17 = session('teacher', 't');
  var qs = [{ prompt: 'Draw a cube.' }];
  eq((await S.createSet(f17, s17, 'geo-1', 'Cubes', qs)).id, 3);
  deep(JSON.parse(f17.calls[0].init.body),
    { code: 'geo-1', title: 'Cubes', questions: qs });
  await S.listSets(f17, s17);
  await S.getSet(f17, s17, 'geo-1');
  await S.deleteSet(f17, s17, 'geo-1');
  deep(f17.calls.map(function (c) { return c.init.method + ' ' + c.path; }), [
    'POST api/sets', 'GET api/sets', 'GET api/sets/geo-1', 'DELETE api/sets/geo-1'
  ]);
  pass('saves sets wrappers');

  // 18 submissions wrappers hit method + path with the submit body shape
  var f18 = stubFetch({
    'POST api/sets/geo-1/submissions': { status: 201, body: { ok: true, id: 9 } },
    'GET api/sets/geo-1/submissions': { status: 200, body: { ok: true, submissions: [] } },
    'GET api/submissions/9': { status: 200, body: { ok: true, id: 9 } },
    'GET api/submissions/mine': { status: 200, body: { ok: true, submissions: [] } }
  });
  var s18 = session('student', 't');
  var snap18 = { version: 1, entities: [] };
  eq((await S.submitSolution(f18, s18, 'geo-1', 0, snap18, 'done')).id, 9);
  deep(JSON.parse(f18.calls[0].init.body),
    { question_index: 0, data: snap18, note: 'done' });
  await S.listSubmissions(f18, s18, 'geo-1');
  await S.getSubmission(f18, s18, 9);
  await S.listMySubmissions(f18, s18);
  deep(f18.calls.map(function (c) { return c.init.method + ' ' + c.path; }), [
    'POST api/sets/geo-1/submissions', 'GET api/sets/geo-1/submissions',
    'GET api/submissions/9', 'GET api/submissions/mine'
  ]);
  pass('saves submissions wrappers');

  // 19 guests never reach the sets endpoints
  var f19 = stubFetch({});
  await S.createSet(f19, session('guest', 'guest'), 'g', 't', []).then(function () {
    throw new Error('guest must reject');
  }, function (err) {
    ok(/guest/.test(err.message), 'guest error');
  });
  await S.listMySubmissions(f19, null).then(function () {
    throw new Error('null session must reject');
  }, function () { /* expected */ });
  eq(f19.calls.length, 0);
  pass('saves sets guest blocked');

  // 20 sets UI ships: session-bar button + panel + role views
  var html2 = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  ok(html2.indexOf('id="btn-sets"') !== -1, 'sets button ships');
  ok(html2.indexOf('id="sets-panel"') !== -1, 'sets panel ships');
  ok(html2.indexOf('class="cf-panel"') !== -1, 'panels share login theme');
  ok(html2.indexOf('.cf-panel .demo-btn') !== -1, 'cf button theme ships');
  ok(html2.indexOf('Verdana, Geneva, Tahoma') !== -1, 'cf font ships');
  ok(html2.indexOf('teacherSetDetail') !== -1, 'teacher view ships');
  ok(html2.indexOf('studentSetDetail') !== -1, 'student view ships');
  ok(html2.indexOf("addEventListener(t, function (e) { e.stopPropagation(); })") !== -1,
    'key isolation ships');
  pass('saves sets ui ships');

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' saves tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

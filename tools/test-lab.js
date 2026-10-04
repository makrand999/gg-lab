'use strict';
// Lab: teacher studio + student workspace shipping checks. Static file
// assertions plus live static serving on an ephemeral C++ server.
// Standalone: `npm run test:lab` (builds the backend first; not in
// `npm test`, like test:login).
var assert = require('assert');
var child = require('child_process');
var fs = require('fs');
var http = require('http');
var net = require('net');
var os = require('os');
var path = require('path');

var Saves = require('../mirror/files/www.geogebra.org/educad-saves.js');

var ROOT = path.join(__dirname, '..');
var SERVER = path.join(ROOT, 'backend', 'build', 'educad-server');
var SEED = path.join(ROOT, 'backend', 'build', 'educad-seed');
var USERS = path.join(__dirname, 'users.json');
var MIRROR = path.join(ROOT, 'mirror');

var TOTAL = 18;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }

function readMirror(f) {
  return fs.readFileSync(path.join(__dirname, '..', 'mirror', f), 'utf8');
}

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

function waitReady(port, srv, timeoutMs) {
  var start = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      get(port, '/teacher.html').then(function (r) {
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

async function main() {
  // 1 studio page ships with CF chrome + gates
  var th = readMirror('teacher.html');
  ok(th.indexOf('class="menu-list"') !== -1, 'cf menu');
  ok(th.indexOf('menu-lava.js') !== -1, 'lava wired');
  ok(th.indexOf('lab.css') !== -1, 'lab css');
  ok(th.indexOf('teacher.js') !== -1, 'studio script');
  ok(th.indexOf('educad-saves.js') !== -1, 'saves client');
  ok(th.indexOf('id="lab-root"') !== -1, 'root');
  ok(th.indexOf('index.html?draw=1') !== -1, 'sheet deep link');
  pass('lab teacher page ships');

  // 2 workspace page ships with CF chrome + gates
  var sh = readMirror('student.html');
  ok(sh.indexOf('class="menu-list"') !== -1, 'cf menu');
  ok(sh.indexOf('student.js') !== -1, 'workspace script');
  ok(sh.indexOf('educad-saves.js') !== -1, 'saves client');
  ok(sh.indexOf('id="lab-root"') !== -1, 'root');
  pass('lab student page ships');

  // 3 lab css: link actions, no boxed buttons
  var css = readMirror('lab.css');
  ok(css.indexOf('.lab-act') !== -1, 'link actions');
  ok(css.indexOf('.lab-row') !== -1, 'rows');
  eq(css.indexOf('.cf-btn'), -1, 'no boxed buttons');
  eq(css.indexOf('.demo-btn'), -1, 'no demo buttons');
  pass('lab css clean');

  // 4 studio script: gate + class/set/submission flows, text-only
  var tj = readMirror('teacher.js');
  ok(tj.indexOf("window.location.replace('login.html')") !== -1, 'login gate');
  ok(tj.indexOf("window.location.replace('student.html')") !== -1, 'student bounce');
  ok(tj.indexOf('createClass') !== -1, 'create class');
  ok(tj.indexOf('listMembers') !== -1, 'members');
  ok(tj.indexOf('createSet') !== -1, 'post set');
  ok(tj.indexOf('listSubmissions') !== -1, 'submissions');
  ok(tj.indexOf('index.html?submission=') !== -1, 'view sheet link');
  ok(tj.indexOf('textContent') !== -1, 'text-only rendering');
  eq(tj.indexOf('innerHTML'), -1, 'no html injection');
  eq(tj.indexOf('cf-btn'), -1, 'no boxed buttons');
  pass('lab teacher script');

  // 5 workspace script: join/solve/drawings/submissions/progress
  var sj = readMirror('student.js');
  ok(sj.indexOf("window.location.replace('login.html')") !== -1, 'login gate');
  ok(sj.indexOf("window.location.replace('teacher.html')") !== -1, 'teacher bounce');
  ok(sj.indexOf('joinClass') !== -1, 'join');
  ok(sj.indexOf('leaveClass') !== -1, 'leave');
  ok(sj.indexOf('index.html?solve=') !== -1, 'solve link');
  ok(sj.indexOf('index.html?drawing=') !== -1, 'drawing link');
  ok(sj.indexOf('listMySubmissions') !== -1, 'my submissions');
  ok(sj.indexOf('fetchProgress') !== -1, 'progress');
  eq(sj.indexOf('innerHTML'), -1, 'no html injection');
  pass('lab student script');

  // 6 login routes each role home
  var lj = readMirror('login.js');
  ok(lj.indexOf('teacher.html') !== -1, 'studio home');
  ok(lj.indexOf('student.html') !== -1, 'workspace home');
  ok(lj.indexOf("goApp(existing.role)") !== -1, 'existing session routes');
  ok(lj.indexOf("goApp(out.data.role)") !== -1, 'fresh login routes');
  ok(lj.indexOf("goApp('guest')") !== -1, 'guest routes');
  pass('lab login role routing');

  // 7 sheet gate sends teachers to the studio, keeps deep links
  var ix = readMirror('index.html');
  ok(ix.indexOf("localStorage.getItem('educad_session')") !== -1, 'gate');
  ok(ix.indexOf("window.location.replace('teacher.html')") !== -1, 'studio bounce');
  ok(ix.indexOf('submission|solve|drawing|draw') !== -1, 'deep-link allowlist');
  ok(ix.indexOf('id="btn-home"') !== -1, 'home link ships');
  pass('lab sheet gate');

  // 8 sheet deep links: submission view mode + solve + drawing
  ok(ix.indexOf('window.educadSetSheetMode') !== -1, 'mode bridge');
  ok(ix.indexOf('window.educadNoteDrawing') !== -1, 'drawing bridge');
  ok(ix.indexOf("setMode('view')") !== -1, 'review in view mode');
  ok(ix.indexOf('p.submission') !== -1, 'submission param');
  ok(ix.indexOf('p.solve') !== -1, 'solve param');
  ok(ix.indexOf('p.drawing') !== -1, 'drawing param');
  ok(ix.indexOf('(view only)') !== -1, 'view-only status');
  pass('lab sheet deep links');

  // 9 saves client exports the class wrappers
  ['listClasses', 'createClass', 'getClass', 'deleteClass', 'joinClass',
   'leaveClass', 'listMembers', 'listClassSets'].forEach(function (k) {
    eq(typeof Saves[k], 'function', k);
  });
  pass('lab saves class exports');

  // 10 createSet stays open by default, scopes when asked
  var seen = [];
  function f16(pathArg, init) {
    seen.push({ path: pathArg, init: init });
    return Promise.resolve({ ok: true, json: function () {
      return Promise.resolve({ ok: true, id: 1, code: 'x' });
    } });
  }
  var sess = { role: 'teacher', username: 't', token: 'tok' };
  await Saves.createSet(f16, sess, 'g', 'T', [{ prompt: 'q' }]);
  assert.deepStrictEqual(JSON.parse(seen[0].init.body),
    { code: 'g', title: 'T', questions: [{ prompt: 'q' }] });
  await Saves.createSet(f16, sess, 'g', 'T', [{ prompt: 'q' }], 'be-101');
  assert.deepStrictEqual(JSON.parse(seen[1].init.body),
    { code: 'g', title: 'T', questions: [{ prompt: 'q' }], class_code: 'be-101' });
  pass('lab saves set scope body');

  // 11 class wrappers hit method + path; guests blocked
  seen = [];
  await Saves.createClass(f16, sess, 'c1', 'Cls');
  await Saves.listClasses(f16, sess);
  await Saves.getClass(f16, sess, 'c1');
  await Saves.joinClass(f16, sess, 'c1');
  await Saves.leaveClass(f16, sess, 'c1');
  await Saves.listMembers(f16, sess, 'c1');
  await Saves.listClassSets(f16, sess, 'c1');
  await Saves.deleteClass(f16, sess, 'c1');
  assert.deepStrictEqual(seen.map(function (c) {
    return c.init.method + ' ' + c.path;
  }), [
    'POST api/classes', 'GET api/classes', 'GET api/classes/c1',
    'POST api/classes/c1/join', 'POST api/classes/c1/leave',
    'GET api/classes/c1/members', 'GET api/classes/c1/sets',
    'DELETE api/classes/c1'
  ]);
  eq(JSON.parse(seen[0].init.body).code, 'c1');
  var guest = { role: 'guest', username: 'guest', token: 'guest' };
  await Saves.listClasses(f16, guest).then(function () {
    assert.fail('guest must be blocked');
  }, function (err) {
    ok(/guest/.test(err.message), 'guest blocked');
  });
  pass('lab saves class wrappers');

  ok(fs.existsSync(SERVER), 'educad-server built');
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'educad-lab-'));
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

    // 12 studio + workspace pages serve with html type
    var r12a = await get(port, '/teacher.html');
    eq(r12a.status, 200);
    ok(String(r12a.headers['content-type']).indexOf('text/html') !== -1, 'html type');
    ok(r12a.body.indexOf('Teacher studio') !== -1, 'studio title');
    var r12b = await get(port, '/student.html');
    eq(r12b.status, 200);
    ok(r12b.body.indexOf('Student workspace') !== -1, 'workspace title');
    pass('lab pages serve');

    // 13 lab css + scripts serve with content types
    var r13a = await get(port, '/lab.css');
    eq(r13a.status, 200);
    ok(String(r13a.headers['content-type']).indexOf('text/css') !== -1, 'css type');
    var r13b = await get(port, '/teacher.js');
    eq(r13b.status, 200);
    ok(String(r13b.headers['content-type']).indexOf('javascript') !== -1, 'js type');
    var r13c = await get(port, '/student.js');
    eq(r13c.status, 200);
    var r13d = await get(port, '/lab-manual.js');
    eq(r13d.status, 200);
    ok(String(r13d.headers['content-type']).indexOf('javascript') !== -1,
      'manual lib type');
    pass('lab assets serve');

    // 14 sheet still gates + keeps its buttons
    var r14 = await get(port, '/index.html');
    eq(r14.status, 200);
    ok(r14.body.indexOf('id="btn-save"') !== -1, 'save kept');
    ok(r14.body.indexOf('id="btn-drawings"') !== -1, 'drawings kept');
    ok(r14.body.indexOf('id="btn-sets"') !== -1, 'sets kept');
    ok(r14.body.indexOf('id="btn-home"') !== -1, 'home ships');
    pass('lab sheet buttons kept');
  } finally {
    srv.kill('SIGTERM');
    await new Promise(function (resolve) { srv.on('exit', resolve); });
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 15 success flashes survive the follow-up rerender: every render*
  // entry clears the flash, so an 'ok' flash must come after the
  // render call, never immediately before it (else the confirmation
  // is wiped before the user can read it).
  var wiped = /flash\((?:[^;]|\n)*?'ok'\)\s*;\s*render(Home|Set|Class)\(\)/;
  ok(!wiped.test(tj), 'teacher keeps success flash: ' +
    ((tj.match(wiped) || [''])[0].slice(0, 80)));
  ok(!wiped.test(sj), 'student keeps success flash: ' +
    ((sj.match(wiped) || [''])[0].slice(0, 80)));
  pass('lab success flash survives rerender');

  // 16 studio Manual opens inline with the teacher slice
  ok(th.indexOf('lab-manual.js') !== -1, 'manual script wired');
  ok(th.indexOf('id="nav-manual"') !== -1, 'nav manual hook');
  ok(th.indexOf('href="manual.html"') !== -1, 'full-manual fallback kept');
  ok(tj.indexOf("h === 'manual'") !== -1, 'manual route');
  ok(tj.indexOf('renderManual()') !== -1, 'manual render called');
  ok(tj.indexOf('EduCADLabManual') !== -1, 'manual lib used');
  var tmStart = tj.indexOf('function renderManual()');
  ok(tmStart !== -1, 'renderManual defined');
  ok(tj.slice(tmStart, tmStart + 500).indexOf("'teacher'") !== -1,
    'teacher role passed');
  pass('lab teacher inline manual');

  // 17 workspace Manual opens inline with the student slice
  ok(sh.indexOf('lab-manual.js') !== -1, 'manual script wired');
  ok(sh.indexOf('id="nav-manual"') !== -1, 'nav manual hook');
  ok(sh.indexOf('href="manual.html"') !== -1, 'full-manual fallback kept');
  ok(sj.indexOf("h === 'manual'") !== -1, 'manual route');
  ok(sj.indexOf('renderManual()') !== -1, 'manual render called');
  ok(sj.indexOf('EduCADLabManual') !== -1, 'manual lib used');
  var smStart = sj.indexOf('function renderManual()');
  ok(smStart !== -1, 'renderManual defined');
  ok(sj.slice(smStart, smStart + 500).indexOf("'student'") !== -1,
    'student role passed');
  pass('lab student inline manual');

  // 18 manual lib: role section maps, parsed (never injected) html
  var lm = readMirror('lab-manual.js');
  ok(lm.indexOf('EduCADLabManual') !== -1, 'global ships');
  ok(lm.indexOf('DOMParser') !== -1, 'parses manual');
  ok(lm.indexOf('manual.html') !== -1, 'fetches manual');
  eq(lm.indexOf('innerHTML'), -1, 'no html injection');
  function roleSlice(name) {
    var s = lm.indexOf(name + ': [');
    ok(s !== -1, name + ' map');
    return lm.slice(s, lm.indexOf(']', s));
  }
  var tArr = roleSlice('teacher');
  var sArr = roleSlice('student');
  ok(tArr.indexOf('93-teaching-scripts-follow-verbatim') !== -1,
    'teacher scripts');
  eq(tArr.indexOf('2-quick-start-your-first-drawing-in-5-minutes'), -1,
    'teacher trims quick start');
  ok(sArr.indexOf('2-quick-start-your-first-drawing-in-5-minutes') !== -1,
    'student quick start');
  ok(sArr.indexOf('94-tutorial-square-scripted-user') !== -1,
    'student tutorials');
  eq(sArr.indexOf('93-teaching-scripts-follow-verbatim'), -1,
    'student trims scripts');
  ok(tArr.indexOf('310-classes-and-question-sets-teachers-post-students-submit') !== -1,
    'teacher sets flow');
  eq(tArr.indexOf('3-interface-tour'), -1, 'teacher trims tour');
  ok(sArr.indexOf('3-interface-tour') !== -1,
    'student tour covers sets flow');
  ok(tArr.indexOf('11-troubleshooting') !== -1 &&
    sArr.indexOf('11-troubleshooting') !== -1, 'both troubleshoot');
  pass('lab manual role sections');

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' lab tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

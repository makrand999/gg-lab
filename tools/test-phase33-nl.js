'use strict';
// EduCAD phase 33: words to drawing. Students type natural language after
// '/ ' and the sheet interprets it into slash commands (or replies why it
// cannot); teachers auto-draw question models via /auto or the studio's
// Auto-draw button. POST /api/interpret proxies one prompt to the local
// model gateway; the key never leaves server environment.
// Run: `npm run test:phase33`
var assert = require('assert');
var child = require('child_process');
var fs = require('fs');
var http = require('http');
var net = require('net');
var os = require('os');
var path = require('path');
var C = require('../public/lib/educad-command.js');
var S = require('../public/lib/educad-saves.js');

var ROOT = path.join(__dirname, '..');
var SERVER = path.join(ROOT, 'backend', 'build', 'educad-server');
var SEED = path.join(ROOT, 'backend', 'build', 'educad-seed');
var USERS = path.join(__dirname, 'users.json');
var MIRROR = path.join(ROOT, 'mirror');
var INDEX_PATH = path.join(LIB, 'index.html');
var TEACHER_PATH = path.join(LIB, 'teacher.js');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(LIB, 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');
var MAIN_PATH = path.join(ROOT, 'backend', 'src', 'main.cpp');

var TOTAL = 16;
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

function req(port, method, urlPath, payload, headers) {
  return new Promise(function (resolve, reject) {
    var body = payload === undefined ? '' : JSON.stringify(payload);
    var h = { 'Content-Length': Buffer.byteLength(body, 'utf8') };
    if (body) h['Content-Type'] = 'application/json';
    Object.keys(headers || {}).forEach(function (k) { h[k] = headers[k]; });
    var r = http.request({ host: '127.0.0.1', port: port, path: urlPath,
      method: method, headers: h }, function (res) {
      var chunks = '';
      res.on('data', function (c) { chunks += c; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(chunks); } catch (e) { /* keep null */ }
        resolve({ status: res.statusCode, json: json, body: chunks });
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

function auth(token) { return { 'Authorization': 'Bearer ' + token }; }

async function main() {
  // 1 slash-space means words: detection is purely lexical
  eq(typeof C.isNaturalRequest, 'function', 'exported');
  ok(C.isNaturalRequest('/ draw a circle'), 'words');
  ok(C.isNaturalRequest('/ '), 'open request');
  ok(C.isNaturalRequest('  / hello'), 'leading space');
  ok(!C.isNaturalRequest('/help'), 'command, no space');
  ok(!C.isNaturalRequest('/'), 'bare slash');
  ok(!C.isNaturalRequest('draw a circle'), 'no slash');
  ok(!C.isNaturalRequest(''), 'empty');
  ok(!C.isNaturalRequest(null), 'null safe');
  ok(!C.isNaturalRequest(42), 'non-string safe');
  pass('phase33 natural request detection');

  // 2 /help advertises the word paths without touching the registry
  eq(C.COMMAND_NAMES.indexOf('auto'), -1, 'auto stays out of registry');
  var help = C.helpText('');
  ok(help.indexOf("'/ <words>'") !== -1, 'nl line');
  ok(help.indexOf("'/auto <words>'") !== -1, 'auto line');
  eq(C.helpText('auto'), 'Unknown command "/auto" — try /help.', 'no fake detail');
  pass('phase33 help advertises words');

  // 3 saves client posts text, points, and mode; guests stay local
  var seen = null;
  function fakeFetch(urlPath, init) {
    seen = { path: urlPath, init: init };
    return Promise.resolve({
      ok: true,
      json: function () {
        return Promise.resolve({ ok: true, commands: ['/point a 0 0'], reply: 'hi' });
      }
    });
  }
  var logged = { role: 'student', token: 'tok' };
  var out = await S.interpretWords(fakeFetch, logged, 'a dot', ['a'], 'draw');
  eq(seen.path, 'api/interpret', 'relative path');
  eq(seen.init.method, 'POST');
  eq(seen.init.headers.Authorization, 'Bearer tok', 'bearer');
  var sent = JSON.parse(seen.init.body);
  eq(sent.text, 'a dot');
  eq(sent.mode, 'draw');
  eq(JSON.stringify(sent.points), '["a"]');
  eq(JSON.stringify(out.commands), '["/point a 0 0"]', 'passes through');
  var guestErr = null;
  try {
    await S.interpretWords(fakeFetch, { role: 'guest', token: 'guest' }, 'x', [], 'draw');
  } catch (err) { guestErr = err; }
  ok(guestErr && /guest has no server access/.test(guestErr.message), 'guest refused');
  function failFetch() {
    return Promise.resolve({ ok: false, status: 503,
      json: function () { return Promise.resolve({ ok: false, error: 'interpret_unavailable' }); } });
  }
  var srvErr = null;
  try {
    await S.interpretWords(failFetch, logged, 'x', [], 'draw');
  } catch (err) { srvErr = err; }
  eq(srvErr && srvErr.message, 'interpret_unavailable', 'server error surfaces');
  eq(srvErr && srvErr.status, 503, 'status rides along');
  pass('phase33 saves interpret client');

  // Servers: one keyed server behind a stub gateway, one keyless server.
  ok(fs.existsSync(SERVER), 'educad-server built');
  var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'educad-nl-'));
  var db = path.join(tmp, 'educad.db');
  var dbBare = path.join(tmp, 'educad-bare.db');
  var seed = child.spawnSync(SEED, [USERS, db], { encoding: 'utf8' });
  eq(seed.status, 0, 'seed exit 0');
  var seedBare = child.spawnSync(SEED, [USERS, dbBare], { encoding: 'utf8' });
  eq(seedBare.status, 0, 'bare seed exit 0');
  var stubMode = 'ok';
  var lastChat = null;
  var lastAuth = null;
  var stub = http.createServer(function (q, s) {
    var chunks = '';
    q.on('data', function (c) { chunks += c; });
    q.on('end', function () {
      if (q.url !== '/v1/chat/completions') {
        s.writeHead(404, { 'Content-Type': 'application/json' });
        s.end('{}');
        return;
      }
      lastAuth = q.headers.authorization || null;
      try { lastChat = JSON.parse(chunks); } catch (e) { lastChat = null; }
      if (stubMode === 'error') {
        s.writeHead(500, { 'Content-Type': 'application/json' });
        s.end('{"error":"boom"}');
        return;
      }
      var content = stubMode === 'garbage' ? 'definitely not json {{{' :
        JSON.stringify({ commands: ['/point a 0 0', 'draw stuff',
          '/line a b', 'x'.repeat(400)], reply: 'stub drew it' });
      s.writeHead(200, { 'Content-Type': 'application/json' });
      s.end(JSON.stringify({ choices: [{ message: { content: content } }] }));
    });
  });
  var stubPort = await freePort();
  await new Promise(function (resolve) { stub.listen(stubPort, '127.0.0.1', resolve); });
  var port = await freePort();
  var srv = child.spawn(SERVER, [String(port)], {
    env: Object.assign({}, process.env, { EDUCAD_DB: db, EDUCAD_ROOT: MIRROR,
      OPENAI_API_KEY: 'dummy-key', ANTIGRAVITY_URL: 'http://127.0.0.1:' + stubPort }),
    stdio: ['ignore', 'ignore', 'ignore']
  });
  var portBare = await freePort();
  var srvBare = child.spawn(SERVER, [String(portBare)], {
    env: Object.assign({}, process.env, { EDUCAD_DB: dbBare, EDUCAD_ROOT: MIRROR,
      HOME: path.join(tmp, 'nohome'),
      OPENAI_API_KEY: '', ANTIGRAVITY_URL: 'http://127.0.0.1:' + stubPort }),
    stdio: ['ignore', 'ignore', 'ignore']
  });
  // Third server: no env key, but a manager-style key file under its HOME.
  var fakeHome = path.join(tmp, 'fakehome');
  fs.mkdirSync(path.join(fakeHome, '.hermes'), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, '.hermes', '.env'),
    '# manager credentials\nOTHER_KEY=x\nOPENAI_API_KEY="dummy-file-key"\n');
  var dbFile = path.join(tmp, 'educad-file.db');
  var seedFile = child.spawnSync(SEED, [USERS, dbFile], { encoding: 'utf8' });
  eq(seedFile.status, 0, 'file seed exit 0');
  var portFile = await freePort();
  var srvFile = child.spawn(SERVER, [String(portFile)], {
    env: Object.assign({}, process.env, { EDUCAD_DB: dbFile, EDUCAD_ROOT: MIRROR,
      HOME: fakeHome,
      OPENAI_API_KEY: '', ANTIGRAVITY_URL: 'http://127.0.0.1:' + stubPort }),
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    await waitReady(port, srv, 10000);
    await waitReady(portBare, srvBare, 10000);
    await waitReady(portFile, srvFile, 10000);
    var login = await req(port, 'POST', '/api/login',
      { role: 'student', username: 'student', password: 'learn123' });
    eq(login.status, 200, 'student logs in');
    var H = auth(login.json.token);

    // 4 auth and method gates hold
    var noAuth = await req(port, 'POST', '/api/interpret', { text: 'hi' });
    eq(noAuth.status, 401, 'no token refused');
    var badTok = await req(port, 'POST', '/api/interpret', { text: 'hi' },
      auth('nope'));
    eq(badTok.status, 401, 'bad token refused');
    var get = await req(port, 'GET', '/api/interpret', undefined, H);
    eq(get.status, 405, 'get rejected');
    pass('phase33 route gates');

    // 5 malformed bodies explain themselves
    var cases = [
      [{}, 'bad text'],
      [{ text: '' }, 'bad text'],
      [{ text: 'x'.repeat(2001) }, 'bad text'],
      [{ text: 'hi', mode: 'party' }, 'bad mode'],
      [{ text: 'hi', points: 'ab' }, 'bad points'],
      [{ text: 'hi', points: [7] }, 'bad points']
    ];
    for (var i = 0; i < cases.length; i++) {
      var r = await req(port, 'POST', '/api/interpret', cases[i][0], H);
      eq(r.status, 400, 'case ' + i + ' status');
      eq(r.json.error, cases[i][1], 'case ' + i + ' error');
    }
    pass('phase33 body validation');

    // 6 no key on the server means an honest 503, never a leak
    var loginBare = await req(portBare, 'POST', '/api/login',
      { role: 'student', username: 'student', password: 'learn123' });
    eq(loginBare.status, 200, 'bare login works');
    var bare = await req(portBare, 'POST', '/api/interpret', { text: 'hi' },
      auth(loginBare.json.token));
    eq(bare.status, 503, 'unavailable status');
    eq(bare.json.error, 'interpret_unavailable', 'unavailable error');
    var loginFile = await req(portFile, 'POST', '/api/login',
      { role: 'student', username: 'student', password: 'learn123' });
    var via = await req(portFile, 'POST', '/api/interpret', { text: 'hi' },
      auth(loginFile.json.token));
    eq(via.status, 200, 'key file works');
    eq(JSON.stringify(via.json.commands), '["/point a 0 0","/line a b"]',
      'key file draws');
    eq(lastAuth, 'Bearer dummy-file-key', 'file key sent, quotes stripped');
    pass('phase33 missing key honest');

    // 7 stub success: commands filtered to slash lines, reply passes through
    stubMode = 'ok';
    var good = await req(port, 'POST', '/api/interpret',
      { text: 'a dot and a span', points: ['a'], mode: 'draw' }, H);
    eq(good.status, 200);
    eq(good.json.ok, true);
    eq(JSON.stringify(good.json.commands), '["/point a 0 0","/line a b"]',
      'only slash lines survive');
    eq(good.json.reply, 'stub drew it', 'reply passes');
    ok(lastChat && lastChat.model === 'gemini-3.8-flash-medium', 'default model');
    ok(lastChat.messages.length === 2, 'system plus user');
    ok(lastChat.messages[1].content === 'a dot and a span', 'user text raw');
    pass('phase33 stub success filtered');

    // 8 model garbage becomes an empty plan with a human reason
    stubMode = 'garbage';
    var garbled = await req(port, 'POST', '/api/interpret', { text: 'hi' }, H);
    eq(garbled.status, 200);
    eq(garbled.json.ok, true);
    eq(JSON.stringify(garbled.json.commands), '[]', 'no phantom steps');
    ok(garbled.json.reply.indexOf('unusable answer') !== -1, 'honest reason');
    pass('phase33 garbage honest');

    // 9 a dead gateway becomes 502, and error statuses too
    stubMode = 'error';
    var errUp = await req(port, 'POST', '/api/interpret', { text: 'hi' }, H);
    eq(errUp.status, 502, 'upstream error status');
    eq(errUp.json.error, 'interpret_failed', 'upstream error name');
    await new Promise(function (resolve) {
      stub.close(resolve);
      stub.closeAllConnections();
    });
    var down = await req(port, 'POST', '/api/interpret', { text: 'hi' }, H);
    eq(down.status, 502, 'dead gateway status');
    eq(down.json.error, 'interpret_failed', 'dead gateway name');
    pass('phase33 gateway failure honest');

    // 10 auto mode and sheet points reach the model prompt
    await new Promise(function (resolve) { stub.listen(stubPort, '127.0.0.1', resolve); });
    stubMode = 'ok';
    var auto = await req(port, 'POST', '/api/interpret',
      { text: 'square lamina', points: ['a', 'b'], mode: 'auto' }, H);
    eq(auto.status, 200);
    ok(lastChat.messages[0].content.indexOf('model answer') !== -1,
      'auto goal in system');
    ok(lastChat.messages[0].content.indexOf('a, b') !== -1, 'points in system');
    ok(lastChat.messages[0].content.indexOf('/polygon <p1>') !== -1,
      'command catalog in system');
    pass('phase33 auto prompt shaped');
  } finally {
    srv.kill('SIGTERM');
    srvBare.kill('SIGTERM');
    srvFile.kill('SIGTERM');
    await new Promise(function (resolve) {
      var left = 3;
      function one() { if (--left === 0) resolve(); }
      function done(p) { return p.exitCode !== null || p.signalCode !== null; }
      if (done(srv)) one(); else srv.on('exit', one);
      if (done(srvBare)) one(); else srvBare.on('exit', one);
      if (done(srvFile)) one(); else srvFile.on('exit', one);
    });
    try { stub.close(); } catch (e) { /* already closed */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // 11 the bar intercepts words and /auto around the sync registry
  var index = fs.readFileSync(INDEX_PATH, 'utf8');
  ['isNaturalRequest(line)', 'isAutoLine(line)', 'runInterpret(words',
    'runInterpret(desc', 'window.educadAutoDraw', 'pushHistory(line)',
    "'/auto '", 'Draw from words (teachers)',
    'Describe the drawing in words — Enter interprets it.',
    'Describe the model — Enter draws it (teachers).',
    "'Drew ' + drawn", 'these failed:'].forEach(function (s) {
    ok(index.indexOf(s) !== -1, 'bar ships ' + s);
  });
  pass('phase33 bar intercepts words');

  // 12 /auto is teacher-gated with honest refusals for the rest
  ['currentRole()', "'Auto-draw is a teacher tool",
    'Usage: /auto <words>', 'interpret_unavailable',
    'Word drawing is off on this server',
    'Log in to use plain words (guests stay local).'].forEach(function (s) {
    ok(index.indexOf(s) !== -1, 'gate ships ' + s);
  });
  pass('phase33 auto gate honest');

  // 13 studio Auto-draw button deep-links the model sheet into autodraw
  var teacher = fs.readFileSync(TEACHER_PATH, 'utf8');
  ok(teacher.indexOf('Auto-draw model') !== -1, 'button label');
  ok(teacher.indexOf('Auto-draw replacement') !== -1, 'replace label');
  ok(teacher.indexOf('&autodraw=1') !== -1, 'deep link flag');
  ok(index.indexOf('p.autodraw') !== -1, 'branch reads flag');
  ok(index.indexOf('window.educadAutoDraw(words)') !== -1, 'branch draws');
  ok(index.indexOf('Model drafted for') !== -1, 'branch reports');
  ok(index.indexOf('re-attach via the Sets panel') !== -1, 're-attach hint');
  pass('phase33 teacher autodraw flow');

  // 14 the manual documents words, auto-draw, and the key requirement
  var md = fs.readFileSync(MD_PATH, 'utf8');
  var html = fs.readFileSync(HTML_PATH, 'utf8');
  ['/ draw a triangle', '/auto <words>', 'Auto-draw model', 'interpret',
    'OPENAI_API_KEY', 'guests stay local'].forEach(function (s) {
    ok(md.indexOf(s) !== -1, 'manual has ' + s);
  });
  ok(html.indexOf('Auto-draw model') !== -1, 'html rebuilt');
  pass('phase33 manual documents words');

  // 15 the backend prompt teaches the live command list, not a stale copy
  var main = fs.readFileSync(MAIN_PATH, 'utf8');
  C.COMMAND_NAMES.forEach(function (nm) {
    if (nm === 'help') return;
    ok(main.indexOf('/' + nm) !== -1, 'prompt teaches /' + nm);
  });
  ok(main.indexOf('Monge projection') !== -1, 'prompt teaches monge');
  ok(main.indexOf('\\"commands\\": [], \\"reply') !== -1, 'prompt teaches refusal');
  pass('phase33 prompt matches registry');

  // 16 README lists phase33 with the new grand total; package chains it
  var readme = fs.readFileSync(README_PATH, 'utf8');
  ok(readme.indexOf('`npm run test:phase33`') !== -1, 'phase33 row');
  ok(readme.indexOf('Words to drawing: student `/ words` NL, teacher auto-draw via local gateway') !== -1,
    'phase33 label');
  ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
    'grand total 960');
  var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  eq(pkg.scripts['test:phase33'], 'npm run build:cpp && node tools/test-phase33-nl.js',
    'test:phase33 script');
  ok(pkg.scripts.test.indexOf('node tools/test-phase33-nl.js') !== -1,
    'chained in test');
  pass('phase33 package wiring');

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' phase33 tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

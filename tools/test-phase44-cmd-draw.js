'use strict';
// EduCAD phase 44: draw the problem bank with cmds only. The command
// palette grows to twenty-three (/polyline /ellipse /hatch /style
// /undo), zero-sweep arcs are refused instead of banked invisible, and
// the sheet renderer is fixed (arc radians, visible rays/dimensions,
// viewport-spanning construction lines). Run: `npm run test:phase44`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var C = require('../mirror/files/www.geogebra.org/educad-command.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');
var D = require('./edc.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'mirror', 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 18;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

function freshEnv(extra) {
  E.resetIdCounter();
  var env = { table: E.createTable() };
  if (extra) {
    Object.keys(extra).forEach(function (k) { env[k] = extra[k]; });
  }
  return env;
}
function run(env, line) { return C.execute(line, env); }
function mustRun(env, line) {
  var r = run(env, line);
  eq(r.ok, true, line + ' draws: ' + r.message);
  return r;
}

// 1 five new commands join the registry with usage + hint
eq(C.COMMANDS.length, 23, 'twenty-three commands');
['polyline', 'ellipse', 'hatch', 'style', 'undo'].forEach(function (nm) {
  ok(C.COMMAND_NAMES.indexOf(nm) !== -1, 'registry has /' + nm);
});
C.COMMANDS.forEach(function (spec) {
  ok(spec.usage.indexOf('/' + spec.name) === 0, spec.name + ' usage');
  ok(spec.hint.length > 5, spec.name + ' hint');
});
eq(C.ELLIPSE_SEGS_DEFAULT, 48, 'ellipse default chords');
eq(C.ELLIPSE_SEGS_MIN, 8, 'ellipse min');
eq(C.ELLIPSE_SEGS_MAX, 180, 'ellipse max');
eq(C.HATCH_ANGLE_DEFAULT, 45, 'hatch default angle');
eq(C.HATCH_LINES_MAX, 200, 'hatch line cap');
var help = C.execute('/help', freshEnv());
['/polyline', '/ellipse', '/hatch', '/style', '/undo'].forEach(function (nm) {
  ok(help.message.indexOf(nm) !== -1, 'help lists ' + nm);
});
ok(C.execute('/help ellipse', freshEnv()).message.indexOf('/ellipse <center>') === 0,
  'ellipse usage first');
pass('phase44 registry additions');

// 2 entityMap: every entity by letter, engine id fallback, guards
var demoLike = [
  { id: 'E1', name: 'E1', type: 'POINT', x: 1, y: 2, caption: 'a' },
  { id: 'E2', name: 'E2', type: 'SEGMENT', x: 0, y: 0, x2: 1, y2: 1, caption: '' },
  { id: 'E3', name: 'E3', type: 'DIMENSION', x: 0, y: 0, x2: 5, y2: 0, caption: '5' },
  { id: 'E4', name: 'E4', type: 'POINT', x: 9, y: 9, caption: 'a' }
];
var emap = C.entityMap(demoLike);
deep(emap, { a: 'E1', E2: 'E2', 5: 'E3' }, 'letters first, id fallback');
throws(function () { C.entityMap({}); }, 'entityMap guards');
pass('phase44 entity map');

// 3 zero-sweep arcs are refused in preview and execute, wraps pass
eq(C.arcSweepDeg(90, 90), 0, 'equal angles');
eq(C.arcSweepDeg(0, 360), 0, 'full turn');
eq(C.arcSweepDeg(350, 10), 20, 'wrap sweeps');
eq(C.arcSweepDeg(0, 180), 180, 'half sweeps');
var arcEnv = freshEnv();
mustRun(arcEnv, '/point c 0 10');
['/arc c 5 90 90', '/arc c 5 0 360', '/arc 0 10 5 30 390'].forEach(function (l) {
  var r = run(arcEnv, l);
  eq(r.ok, false, l + ' refused');
  ok(r.message.indexOf('/circle') !== -1, l + ' suggests /circle');
});
ok(C.preview('/arc c 5 90 90', { points: { c: { x: 0, y: 10 } } }).indexOf('0° arc') !== -1,
  'preview refuses too');
eq(run(arcEnv, '/arc c 5 350 10').ok, true, 'wrap still draws');
eq(run(arcEnv, '/arc c 5 0 180').ok, true, 'half still draws');
eq(arcEnv.table.count(), 3, 'nothing banked for refusals');
pass('phase44 zero-sweep refusal');

// 4 polyline draws an open connected chain with cascade refs
var plEnv = freshEnv();
['/point a 0 0', '/point b 10 0', '/point d 10 10'].forEach(function (l) {
  mustRun(plEnv, l);
});
var plo = mustRun(plEnv, '/polyline a b d');
eq(plo.ids.length, 2, 'two edges, open');
var e0 = plEnv.table.get(plo.ids[0]), e1 = plEnv.table.get(plo.ids[1]);
eq(e0.type, 'SEGMENT', 'edges are segments');
ok(e0.x2 === e1.x && e0.y2 === e1.y, 'chain connects');
deep(e0.meta.vertices, ['a', 'b', 'd'], 'vertices ride along');
['/polyline a', '/polyline a z', '/polyline a a'].forEach(function (l) {
  eq(run(plEnv, l).ok, false, l + ' refused');
});
var before = plEnv.table.count();
eq(run(plEnv, '/polyline a').ok, false, 'refusal draws nothing');
eq(plEnv.table.count(), before, 'count holds');
var del = mustRun(plEnv, '/delete b');
ok(del.ids.length > 2, 'middle point cascades off both edges');
pass('phase44 polyline chains');

// 5 ellipse draws a closed chord ring, named or raw, styled
var elEnv = freshEnv();
mustRun(elEnv, '/point c 0 10');
var el = mustRun(elEnv, '/ellipse c 30 20');
eq(el.ids.length, 48, 'default 48 chords');
var ring = el.ids.map(function (id) { return elEnv.table.get(id); });
ring.forEach(function (s, i) {
  eq(s.type, 'SEGMENT', 'chord ' + i);
  eq(s.bisCode, 'A', 'visible outline');
  eq(s.viewRole, 'ELEVATION', 'height role');
  var nx = ring[(i + 1) % ring.length];
  ok(Math.abs(s.x2 - nx.x) < 1e-9 && Math.abs(s.y2 - nx.y) < 1e-9,
    'ring connects at ' + i);
});
var raw = mustRun(elEnv, '/ellipse 0 -20 30 20 24 E plan');
eq(raw.ids.length, 24, 'custom count');
eq(elEnv.table.get(raw.ids[0]).bisCode, 'E', 'tail style');
eq(elEnv.table.get(raw.ids[0]).viewRole, 'PLAN', 'tail role');
['/ellipse c', '/ellipse c 30', '/ellipse z 30 20', '/ellipse c 0 20',
  '/ellipse c 30 -2', '/ellipse c 30 20 7', '/ellipse c 30 20 181',
  '/ellipse c 30 20 12.5', '/ellipse c 30 20 Q',
  '/ellipse 0 0 30 20 24 E plan extra'].forEach(function (l) {
  eq(run(elEnv, l).ok, false, l + ' refused');
});
eq(C.preview('/ellipse c 30 20', { points: { c: { x: 0, y: 10 } } }),
  'Draw ellipse at "c" 30 × 20 mm (48 segments).');
ok(C.preview('/ellipse c 30 20 7', { points: { c: { x: 0, y: 10 } } }).indexOf('whole number') !== -1,
  'preview bounds the count');
pass('phase44 ellipse rings');

// 6 hatch clips parallel chords to the rect with angle and cap
eq(C.hatchLines(-60, 0, 0, 20, 3, 45).length, 18, 'pinned 45-degree count');
eq(C.hatchLines(10, 11, 11, 12, 5, 45).length, 0, 'empty area');
ok(C.hatchLines(0, 0, 200, 200, 1, 45).length > 200, 'dense area floods');
C.hatchLines(-60, 0, 0, 20, 3, 45).forEach(function (q, i) {
  ok(q[0] >= -60 && q[0] <= 0 && q[2] >= -60 && q[2] <= 0, 'chord ' + i + ' clips x');
  ok(q[1] >= 0 && q[1] <= 20 && q[3] >= 0 && q[3] <= 20, 'chord ' + i + ' clips y');
});
var hEnv = freshEnv();
var h1 = mustRun(hEnv, '/hatch -60 0 0 20 3');
eq(h1.ids.length, 18, 'draws the pinned count');
eq(hEnv.table.get(h1.ids[0]).bisCode, 'B', 'hatch thin default');
var h2 = mustRun(hEnv, '/hatch 0 0 40 20 4 135 B plan');
ok(h2.ids.length > 0, '135-degree hatch draws');
eq(hEnv.table.get(h2.ids[0]).viewRole, 'PLAN', 'tail role');
['/hatch 0 0 10', '/hatch 0 0 0 10 2', '/hatch 0 0 10 0 2',
  '/hatch 0 0 10 10 0', '/hatch 0 0 10 10 -2',
  '/hatch 10 11 11 12 5', '/hatch 0 0 200 200 1',
  '/hatch 0 0 10 10 2 Q'].forEach(function (l) {
  eq(run(hEnv, l).ok, false, l + ' refused');
});
eq(C.preview('/hatch -60 0 0 20 3', {}),
  'Hatch (-60, 0)–(0, 20) with 18 lines at 45°.');
ok(C.preview('/hatch 0 0 200 200 1', {}).indexOf('over 200') !== -1, 'preview caps');
pass('phase44 hatch areas');

// 7 style restyles any entity by letter or engine id
var stEnv = freshEnv();
['/point a 0 0', '/point b 10 0', '/line a b'].forEach(function (l) {
  mustRun(stEnv, l);
});
var segId = stEnv.table.list().filter(function (e) { return e.type === 'SEGMENT'; })[0].id;
var s1 = mustRun(stEnv, '/style ' + segId + ' E plan');
eq(stEnv.table.get(s1.ids[0]).bisCode, 'E', 'id restyle sticks');
eq(stEnv.table.get(s1.ids[0]).viewRole, 'PLAN', 'role restyle sticks');
mustRun(stEnv, '/style a G');
eq(stEnv.table.list().filter(function (e) { return e.name === 'a'; })[0].bisCode, 'G',
  'letter restyle sticks');
['/style', '/style a', '/style zz E', '/style a Q', '/style a E sideways',
  '/style a E plan extra'].forEach(function (l) {
  eq(run(stEnv, l).ok, false, l + ' refused');
});
eq(C.preview('/style a E plan', { points: { a: { x: 0, y: 0 } } }),
  'Restyle "a" as type E, PLAN view.');
eq(C.preview('/style zz E', { points: {} }), 'Unknown entity "zz".');
pass('phase44 style restyle');

// 8 undo runs the page hook; read-only and missing hooks refuse
var uEnv = freshEnv();
eq(run(uEnv, '/undo').ok, false, 'missing hook refuses');
ok(run(uEnv, '/undo').message.indexOf('unavailable') !== -1, 'says unavailable');
var dead = freshEnv({ undo: function () { return false; } });
eq(run(dead, '/undo').ok, false, 'empty stack refuses');
eq(run(dead, '/undo').message, 'Nothing to undo.');
var calls = 0;
var live = freshEnv({ undo: function () { calls++; return true; } });
var uo = mustRun(live, '/undo');
eq(calls, 1, 'hook fires once');
eq(uo.message, 'Undid the last sheet change.');
var ro = freshEnv({ readOnly: true, undo: function () { return true; } });
['/polyline a b', '/ellipse 0 0 5 5', '/hatch 0 0 5 5 1', '/style a E',
  '/undo'].forEach(function (l) {
  var r = run(ro, l);
  eq(r.ok, false, l + ' blocked in view');
  ok(r.message.indexOf('/mode edit') !== -1, l + ' nudges to edit');
});
eq(C.preview('/undo', {}), 'Undo the last sheet change.');
pass('phase44 undo hook and gates');

// 9 completions cover the new seats: tails, counts, entities
var ctx = { points: { c: { x: 0, y: 10 } } };
var etail = C.suggest('/ellipse c 30 20 ', ctx).map(function (s) { return s.display; });
eq(etail.length, 10, 'ellipse tail offers style and view');
var ecount = C.suggest('/ellipse c 30 20 24 ', ctx).map(function (s) { return s.display; });
eq(ecount.length, 10, 'tail follows the count');
deep(C.suggest('/ellipse 0 0 30 20 24 E ', ctx).map(function (s) { return s.display; }),
  ['plan', 'elevation', 'both', 'profile'], 'role seat after count and style');
deep(C.suggest('/hatch 0 0 10 10 ', {}), [], 'numbers stay freeform');
eq(C.suggest('/hatch 0 0 10 10 2 ', {}).length, 10, 'hatch tail offers both lists');
eq(C.suggest('/hatch 0 0 10 10 2 135 ', {}).length, 10, 'tail follows the angle');
deep(C.suggest('/hatch 0 0 10 10 2 E ', {}).map(function (s) { return s.display; }),
  ['plan', 'elevation', 'both', 'profile'], 'hatch role seat');
var sctx = { points: { a: { x: 0, y: 0 } }, entities: { a: 'E1', E7: 'E7' } };
var ssug = C.suggest('/style ', sctx);
deep(ssug.map(function (s) { return s.display; }), ['a', 'E7'], 'letters plus ids, deduped');
ssug.forEach(function (entry) {
  eq(entry.kind, 'entity-name', entry.display + ' tagged as entity');
});
deep(C.suggest('/polyline a ', { points: ['a', 'b'] }).map(function (s) { return s.text; }),
  ['/polyline a a ', '/polyline a b '], 'variadic chains complete');
pass('phase44 suggest completions');

// 10 previews narrate the new lines and match execute on ids
var pctx = { points: { a: { x: 0, y: 0 }, b: { x: 3, y: 4 } } };
eq(C.preview('/polyline a', pctx), 'Usage: /polyline <p1> <p2> [p3 ...]');
eq(C.preview('/polyline a b', pctx), 'Draw open chain (a, b).');
eq(C.preview('/polyline a z', pctx),
  'Unknown point "z" — place it first with /point.');
var ectx = { points: {}, entities: { E7: 'E7' } };
eq(C.preview('/delete E7', ectx), 'Delete "E7" and its lines.');
eq(C.preview('/rename E7 E8', ectx), 'Rename "E7" to "E8".');
eq(C.preview('/rename E8 E7', ectx), 'Unknown point "E8".');
var pvEnv = freshEnv();
['/point a 0 0', '/point b 4 0', '/line a b'].forEach(function (l) {
  mustRun(pvEnv, l);
});
var pvSeg = pvEnv.table.list().filter(function (e) { return e.type === 'SEGMENT'; })[0];
eq(pvSeg.caption, '', 'segments carry no caption');
eq(run(pvEnv, '/delete ' + pvSeg.id).ok, true, 'execute deletes by id');
pass('phase44 preview narration');

// 11 problem-bank sheets draw end to end with cmds only
var cu = freshEnv();
mustRun(cu, '/datum -120 120');
mustRun(cu, '/point o 0 60');
mustRun(cu, '/circle o 25');
var inames = [];
for (var i = 0; i <= 12; i++) {
  var t = 2 * Math.PI * i / 12, r = 25;
  var ix = Math.round(r * (Math.cos(t) + t * Math.sin(t)) * 100) / 100;
  var iy = Math.round((85 + r * (Math.sin(t) - t * Math.cos(t))) * 100) / 100;
  inames.push('i' + i);
  mustRun(cu, '/point i' + i + ' ' + ix + ' ' + iy);
}
var invol = mustRun(cu, '/polyline ' + inames.join(' '));
eq(invol.ids.length, 12, 'CU-5 involute draws 12 chords');
var ln = freshEnv();
["/datum -60 120", "/point a' 0 12", '/point a 0 -10',
  "/point ap0 -50 12", "/point ap1 110 12", '/xline ap0 ap1 G elevation',
  "/arc a' 75 0 60", "/point b' 45 49.5", '/point b 45 -58.03',
  "/line a' b'", '/line a b', "/xline b' b G",
  '/dimension a b'].forEach(function (l) { mustRun(ln, l); });
var lnp = ln.table.list().filter(function (e) { return e.name === 'b'; })[0];
var lnq = ln.table.list().filter(function (e) { return e.name === "b'"; })[0];
eq(lnp.x, lnq.x, 'LN-1 projector x aligns');
var or2 = freshEnv();
['/datum -90 90',
  '/point p1 -60 0', '/point p2 60 0', '/point p3 60 20', '/point p4 -60 20',
  '/polygon p1 p2 p3 p4',
  '/point h1 -30 10', '/circle h1 10', '/point h2 30 10', '/circle h2 10',
  '/point c1 -70 10', '/point c2 70 10', '/xline c1 c2 G elevation',
  '/point k1 -60 -5', '/point k2 60 -5', '/line k1 k2 H elevation',
  '/hatch -60 0 0 20 3', '/dimension p1 p2'].forEach(function (l) { mustRun(or2, l); });
var have = {};
or2.table.list().forEach(function (e) { have[e.type] = (have[e.type] || 0) + 1; });
ok(have.POINT > 0 && have.SEGMENT > 18 && have.CIRCLE === 2 &&
  have.LINE === 1 && have.DIMENSION === 1, 'OR-2 mixes every stroke');
pass('phase44 problem-bank sheets');

// 12 the page renders rays, dimensions, radian arcs, and undo
var index = fs.readFileSync(INDEX_PATH, 'utf8');
["ent.type === 'RAY'", "ent.type === 'DIMENSION'",
  '-ent.endAngle * Math.PI / 180', '-ent.startAngle * Math.PI / 180',
  'ent.type === \'LINE\'', 'undo: function () { return userUndo(); }',
  'function cmdEntities()', 'entities: cmdEntities()'].forEach(function (s) {
  ok(index.indexOf(s) !== -1, 'ships ' + s);
});
pass('phase44 page wiring');

// 13 the manual documents the five commands and the arc refusal
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
['/polyline', '/ellipse', '/hatch', '/style', '/undo', 'twenty-three',
  'chord', 'zero-', 'full ring instead'].forEach(function (s) {
  ok(md.indexOf(s) !== -1, 'manual has ' + s);
});
ok(html.indexOf('Undo the last sheet change') !== -1, 'html rebuilt');
pass('phase44 manual documents commands');

// 14 README lists phase44 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase44`') !== -1, 'phase44 row');
ok(readme.indexOf('Cmd-only problem-bank drawing: /polyline /ellipse /hatch /style /undo, render fixes') !== -1,
  'phase44 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 1039');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase44'], 'node tools/test-phase44-cmd-draw.js',
  'test:phase44 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase44-cmd-draw.js') !== -1,
  'chained in test');
pass('phase44 package wiring');

// 15 the script runner validates the shipped sample sheets
var ln1 = D.runScript(fs.readFileSync(path.join(ROOT, 'tools', 'scripts', 'ln1.edc'), 'utf8'));
eq(ln1.ok, true, 'ln1.edc clean');
eq(ln1.steps.length, 18, 'ln1 steps');
eq(ln1.summary.count, 18, 'ln1 entities');
deep(ln1.projectors.aligned.sort(), ['a', 'b'], 'ln1 projectors align');
eq(ln1.summary.hasDatum, true, 'ln1 datum present');
var or2 = D.runScript(fs.readFileSync(path.join(ROOT, 'tools', 'scripts', 'or2.edc'), 'utf8'));
eq(or2.ok, true, 'or2.edc clean');
eq(or2.steps.length, 24, 'or2 steps');
eq(or2.summary.byType.CIRCLE, 2, 'or2 holes');
eq(or2.summary.byType.SEGMENT, 27, 'or2 segments plus hatch');
pass('phase44 script samples validate');

// 16 the runner reports bad lines and projector breaks with numbers
var bad = D.runScript('# comment\n\n/point a 0 0\n/line a z\n/nope x\n');
eq(bad.ok, false, 'bad script fails');
eq(bad.steps.length, 3, 'comments and blanks skipped');
deep(bad.errors.map(function (e) { return e.n; }), [4, 5], 'line numbers kept');
ok(bad.errors[0].message.indexOf('Unknown point "z"') !== -1, 'names the problem');
var mis = D.runScript("/point a 0 12\n/point a' 5 -10\n");
eq(mis.ok, false, 'misaligned projector fails');
deep(mis.projectors.misaligned, ['a'], 'breaker named');
var refused = D.runScript('/demo prism\n');
eq(refused.ok, false, 'page-only commands refused headless');
ok(refused.errors[0].message.indexOf('unavailable') !== -1, 'says unavailable');
pass('phase44 script errors reported');

// 17 the manual documents EduCAD Script; package ships the runner
var md17 = fs.readFileSync(MD_PATH, 'utf8');
['EduCAD Script', 'tools/scripts/', 'node tools/edc.js', 'ln1.edc'].forEach(function (s) {
  ok(md17.indexOf(s) !== -1, 'manual has ' + s);
});
ok(fs.readFileSync(HTML_PATH, 'utf8').indexOf('EduCAD Script') !== -1, 'html rebuilt');
eq(JSON.parse(fs.readFileSync(PKG_PATH, 'utf8')).scripts.edc, 'node tools/edc.js',
  'edc script');
pass('phase44 script docs and wiring');

// 18 scripts represent the 3D model via headless reconstruction
var q3 = D.runScript(fs.readFileSync(path.join(ROOT, 'tools', 'scripts', 'quad3d.edc'), 'utf8'));
eq(q3.ok, true, 'quad3d.edc clean');
eq(q3.solid.status, 'ok', 'quad lifts');
eq(q3.solid.geometry.vertices.length, 4, 'four corners');
eq(q3.solid.geometry.edges.length, 4, 'four edges');
deep(q3.solid.geometry.vertices[0], { x: -20, y: 30, z: 30 }, 'mm-true vertex');
var ln1s = D.runScript(fs.readFileSync(path.join(ROOT, 'tools', 'scripts', 'ln1.edc'), 'utf8'));
eq(ln1s.solid.status, 'ok', 'construction lifts its paired corner');
var or2s = D.runScript(fs.readFileSync(path.join(ROOT, 'tools', 'scripts', 'or2.edc'), 'utf8'));
eq(or2s.solid.status, 'unavailable', 'curves-only sheet honest');
ok(D.report('x.edc', q3).indexOf('solid: ok — 4V 4E 0F') !== -1, 'report prints solid');
pass('phase44 script solid representation');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase44 tests passed');

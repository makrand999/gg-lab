'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');
var Cv = require('../mirror/files/www.geogebra.org/educad-canvas.js');
var G = require('../mirror/files/www.geogebra.org/educad-shim.js');
var V = require('../mirror/files/www.geogebra.org/educad-viewport.js');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'mirror', 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 12;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

function captureWarn(fn) {
  var msgs = [];
  var orig = console.warn;
  console.warn = function (m) { msgs.push(String(m)); };
  var result;
  try { result = fn(); } finally { console.warn = orig; }
  return { result: result, msgs: msgs };
}

// 1 core: line-likes cannot be created without two distinct points.
deep(E.TWO_POINT_TYPES.slice().sort(),
  ['DATUM_AXIS', 'DIMENSION', 'LINE', 'RAY', 'SEGMENT'].sort());
['SEGMENT', 'LINE', 'RAY', 'DIMENSION', 'DATUM_AXIS'].forEach(function (t) {
  throws(function () { E.createEntity(t, {}); }, t + ' defaults rejected');
  throws(function () { E.createEntity(t, { x: 5, y: 5, x2: 5, y2: 5 }); },
    t + ' coincident rejected');
  eq(E.createEntity(t, { x: 0, y: 0, x2: 10, y2: 0 }).type, t,
    t + ' distinct ok');
});
eq(E.createEntity('POINT', { x: 5, y: 5, x2: 5, y2: 5 }).type, 'POINT');
pass('phase18 create needs two distinct points');

// 2 tolerance: within 1e-6 mm is one point; beyond is a line.
throws(function () { E.createEntity('SEGMENT', { x: 0, y: 0, x2: 1e-7, y2: 0 }); });
eq(E.createEntity('SEGMENT', { x: 0, y: 0, x2: 0.002, y2: 0 }).x2, 0.002);
throws(function () { E.assertTwoPoints('LINE', 1, 1, 1, 1); });
E.assertTwoPoints('LINE', 1, 1, 2, 1);
E.assertTwoPoints('POINT', 1, 1, 1, 1);
pass('phase18 coincident tolerance 1e-6');

// 3 the table cannot hold or be edited into a one-point line.
var t3 = E.createTable();
throws(function () {
  t3.add({ id: 'raw', type: 'SEGMENT', x: 1, y: 1, x2: 1, y2: 1 });
}, 'add degenerate throws');
var s3 = t3.create('SEGMENT', { id: 'S', x: 0, y: 0, x2: 10, y2: 0 });
throws(function () { t3.update('S', { x2: 0, y2: 0 }); }, 'update collapse throws');
eq(t3.get('S').x2, 10, 'failed update leaves entity unchanged');
t3.update('S', { x2: 20 });
eq(t3.get('S').x2, 20, 'valid update works');
t3.move('S', 1, 1);
eq(t3.get('S').x, 1, 'move preserves the line');
pass('phase18 table add update move guard');

// 4 the line tool only ever holds two distinct points.
eq(Cv.LINE_COINCIDENT_TOL_MM, 1e-6);
var lt4 = Cv.createLineToolState();
Cv.anchorLineTool(lt4, 'p1', 0, 0);
eq(Cv.lockLineTarget(lt4, 'p2', 0, 0), false, 'same-spot P2 refused');
eq(Cv.lockLineTarget(lt4, 'p2', 1e-7, 0), false, 'near-spot P2 refused');
eq(lt4.phase, 'anchored', 'anchor survives refusal');
eq(Cv.lockLineTarget(lt4, 'p2', 10, 5), true);
eq(Cv.retargetLineTool(lt4, 'p3', 0, 0), false, 'retarget on P1 refused');
eq(lt4.p2Id, 'p2', 'P2 kept after refusal');
var bad4 = Cv.createLineToolState();
bad4.phase = 'animating';
bad4.p1Id = 'a'; bad4.p1Mm = { x: 0, y: 0 };
bad4.p2Id = 'b'; bad4.p2Mm = { x: 0, y: 0 };
bad4.bisCode = 'B';
eq(Cv.finishLineStroke(bad4), null, 'coincident never commits');
eq(bad4.phase, 'idle', 'commit refusal resets to idle');
pass('phase18 tool refuses coincident pair');

// 5 shim builders fail clean (null + offset warn), table untouched.
function freshApplet(deps) { return G.createApplet(deps); }
var a5 = freshApplet({ entities: E, viewport: V });
a5.evalCommand('A=Point(0,0)');
a5.evalCommand('B=Point(10,0)');
var before5 = a5.getAllObjectNames().slice();
[['S=Segment(A,A)', 'Segment'], ['Segment(1,2,1,2)', 'Segment'],
  ['L=Line(B,B)', 'Line'], ['D=Distance(A,A)', 'Distance'],
  ['Dimension(0,0,0,0)', 'Dimension']].forEach(function (pair) {
  var cw = captureWarn(function () { return a5.evalCommand(pair[0]); });
  eq(cw.result, null, pair[0] + ' null');
  ok(cw.msgs.length >= 1, pair[0] + ' warns');
  ok(/offset \d+/.test(cw.msgs.join(' ')), pair[0] + ' offset');
  ok(cw.msgs.join(' ').indexOf(pair[1] + ' needs two distinct points') !== -1,
    pair[0] + ' names the property');
});
deep(a5.getAllObjectNames(), before5, 'failed builds store nothing');
eq(a5.evalCommand('S1=Segment(A,B)'), 'S1', 'distinct refs build');
var f5 = freshApplet();
var cw5 = captureWarn(function () { return f5.evalCommand('Segment(0,0,0,0)'); });
eq(cw5.result, null, 'fallback rejects too');
pass('phase18 shim builders need distinct points');

// 6 shim mutations cannot collapse a live line; degenerate polygons fail.
var a6 = freshApplet({ entities: E, viewport: V });
a6.evalCommand('A=Point(0,0)');
a6.evalCommand('B=Point(10,0)');
a6.evalCommand('S1=Segment(A,B)');
var cw6 = captureWarn(function () { return a6.setCoords('S1', 10, 0); });
eq(cw6.result, false, 'collapsing setCoords refused');
eq(a6.getXcoord('S1'), 0, 'segment base point kept');
eq(a6.setCoords('A', 1, 1), true, 'point move still works');
eq(a6.getXcoord('A'), 1);
var cw6b = captureWarn(function () { return a6.evalCommand('H=Polygon(A,A,A)'); });
eq(cw6b.result, null, 'degenerate polygon fails');
eq(a6.exists('H'), false, 'no polygon head left behind');
pass('phase18 shim collapse refused polygon honest');

// 7 curriculum extremes emit points, never zero-length traces.
[0, 90].forEach(function (tilt) {
  var bundle = C.planeSurface({ xMm: 0, sizeMm: 40, tiltDeg: tilt });
  var lines = bundle.entities.filter(function (e) {
    return E.TWO_POINT_TYPES.indexOf(e.type) !== -1;
  });
  lines.forEach(function (e) {
    var dx = e.x2 - e.x, dy = e.y2 - e.y;
    ok(Math.sqrt(dx * dx + dy * dy) > E.COINCIDENT_TOL_MM,
      'tilt ' + tilt + ' ' + e.type + ' has two points');
  });
  var tab = E.createTable();
  bundle.entities.forEach(function (e) { tab.create(e.type, e); });
  ok(tab.count() === bundle.entities.length, 'tilt ' + tilt + ' loads');
});
var p30 = C.planeSurface({ xMm: 0, sizeMm: 40, tiltDeg: 30 });
eq(p30.entities.length, 7, 'tilt 30 bundle unchanged');
eq(p30.entities.filter(function (e) { return e.type === 'POINT'; }).length, 0,
  'tilt 30 has no collapsed traces');
eq(C.planeSurface({ tiltDeg: 0 }).entities.filter(function (e) {
  return e.type === 'POINT';
}).length, 1, 'tilt 0 collapses proj-VT to a point');
eq(C.planeSurface({ tiltDeg: 90 }).entities.filter(function (e) {
  return e.type === 'POINT';
}).length, 1, 'tilt 90 collapses plan VT to a point');
pass('phase18 curriculum extremes are points');

// 8 every shipped demo loads through the guarded table.
var demos = [
  C.straightLine({ TL: 80, thetaDeg: 30, phiDeg: 45,
    axMm: -30, yaPlan: -20, yaElev: 25 }).entities,
  C.quadrantPoint({ quadrant: 1, xMm: -50, distHP: 35, distVP: 25,
    label: 'a' }).entities,
  C.quadrantPoint({ quadrant: 3, xMm: 50, distHP: 30, distVP: 35,
    label: 'b' }).entities,
  C.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 }).entities,
  C.threeViewSheet({ solid: 'PRISM', sizeMm: 35, heightMm: 70,
    xMm: 0 }).entities
];
demos.forEach(function (ents, i) {
  ok(ents.length > 0, 'demo ' + i + ' non-empty');
  var tab = E.createTable();
  ents.forEach(function (e) { tab.create(e.type, e); });
  eq(tab.count(), ents.length, 'demo ' + i + ' loads intact');
});
pass('phase18 shipped demos satisfy the property');

// 9 the page already handles the tool's null commit (no throw path).
var index = fs.readFileSync(INDEX_PATH, 'utf8');
var finIdx = index.indexOf('EduCADCanvas.finishLineStroke(handle.line)');
ok(finIdx !== -1, 'commit site found');
ok(index.slice(finIdx, finIdx + 400).indexOf('if (spec)') !== -1,
  'null commit guarded');
pass('phase18 ui null-commit safe');

// 10 manual states the property in section 4.3; HTML rebuilt.
var md = fs.readFileSync(MD_PATH, 'utf8');
ok(md.indexOf('two *distinct* points') !== -1, 'distinct-points rule');
ok(md.indexOf('can never be drawn, stored,') !== -1, 'property stated');
var html = fs.readFileSync(HTML_PATH, 'utf8');
ok(html.indexOf('can never be drawn, stored,') !== -1, 'html rebuilt');
pass('phase18 manual states the property');

// 11 README lists the phase18 suite with the new grand total.
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase18`') !== -1, 'phase18 row');
ok(readme.indexOf('baseline + phases 1–29 (862 checks)') !== -1,
  'grand total 789');
pass('phase18 readme suite row');

// 12 package.json chains the phase18 file in the test script.
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase18'], 'node tools/test-phase18-two-point-line.js',
  'test:phase18 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase18-two-point-line.js') !== -1,
  'chained in test');
pass('phase18 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase18 tests passed');

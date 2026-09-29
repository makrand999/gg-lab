'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Cv = require('../mirror/files/www.geogebra.org/educad-canvas.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'mirror', 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 13;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

function bodyOf(src, fnName) {
  var start = src.indexOf('function ' + fnName + '(');
  ok(start !== -1, fnName + ' found');
  var end = src.indexOf('\n      function ', start + 1);
  return src.slice(start, end === -1 ? src.length : end);
}

// 1 ground candidate: the foot is the cursor's x on the fold and the
// distance is |y|, exact on both sides of the VP/HP line.
deep(Cv.plotGroundCandidate({ x: 33, y: -25.5 }), {
  footMm: { x: 33, y: 0 }, pointMm: { x: 33, y: -25.5 }, distMm: 25.5
}, 'plan side');
deep(Cv.plotGroundCandidate({ x: -12, y: 70 }), {
  footMm: { x: -12, y: 0 }, pointMm: { x: -12, y: 70 }, distMm: 70
}, 'elevation side');
deep(Cv.plotGroundCandidate({ x: 5, y: 0 }), {
  footMm: { x: 5, y: 0 }, pointMm: { x: 5, y: 0 }, distMm: 0
}, 'on the fold');
throws(function () { Cv.plotGroundCandidate({ x: NaN, y: 0 }); }, 'nan guard');
pass('phase26 ground candidate exact');

// 2 ground typed: (x, +/-dist) by cursor side, null on the fold.
deep(Cv.plotGroundTyped({ x: 33, y: -25.5 }, 10), { xMm: 33, yMm: -10 });
deep(Cv.plotGroundTyped({ x: 33, y: 25.5 }, 10), { xMm: 33, yMm: 10 });
eq(Cv.plotGroundTyped({ x: 33, y: 0 }, 10), null, 'no side on fold');
throws(function () { Cv.plotGroundTyped({ x: 0, y: 1 }, NaN); }, 'nan guard');
pass('phase26 ground typed points');

// 3 lifecycle: ground focus commits off the fold and resets clean;
// re-arming as a segment focus clears the ground flag.
var ps3 = Cv.createPlotToolState();
eq(ps3.ground, false, 'fresh state not ground');
Cv.beginGroundPlot(ps3);
eq(ps3.phase, 'plotting');
eq(ps3.ground, true);
eq(ps3.aMm, null); eq(ps3.bMm, null);
deep(Cv.commitPlotPoint(ps3, { x: 33, y: -25.5 }),
  { xMm: 33, yMm: -25.5, distMm: 25.5 }, 'ground click commits');
eq(ps3.phase, 'idle'); eq(ps3.ground, false, 'commit resets ground');
Cv.beginGroundPlot(ps3);
Cv.beginPlotTool(ps3, 0, 0, 10, 0);
eq(ps3.ground, false, 'segment re-arm clears ground');
Cv.beginGroundPlot(ps3);
Cv.abortPlotTool(ps3);
eq(ps3.ground, false, 'abort clears ground');
throws(function () { Cv.beginGroundPlot(null); }, 'null state throws');
pass('phase26 ground lifecycle');

// 4 typed click-parity: typing the live distance reproduces the
// click candidate, so perpendicular and vertical coincide exactly.
var c4 = Cv.plotGroundCandidate({ x: 33, y: -25.5 });
deep(Cv.plotGroundTyped({ x: 33, y: -25.5 }, c4.distMm), {
  xMm: c4.pointMm.x, yMm: c4.pointMm.y
}, 'typed live-dist equals click');
pass('phase26 ground click parity');

// 5 Alt+click rule: segments win first, then the ground-grab helper
// (14 px corridor capped at 20 mm) focuses the fold; plain clicks
// still place.
var index = fs.readFileSync(INDEX_PATH, 'utf8');
var segArm = index.indexOf('beginPlotTool(handle.plot');
var gndArm = index.indexOf('beginGroundPlot(handle.plot)');
ok(segArm !== -1 && gndArm !== -1, 'both arms wired');
ok(segArm < gndArm, 'segment hit wins over fold');
var altRule = index.slice(index.indexOf('if (e.altKey) {', segArm), gndArm + 40);
ok(altRule.indexOf('EduCADViewport.inverse') !== -1, 'cursor to world');
ok(altRule.indexOf('groundFoldGrabbed(walt.y, handle.view.s)') !== -1,
  'grab helper decides');
pass('phase26 alt-click focuses fold');

// 6 the typed gate reports a ground focus distinctly from a segment.
var gate = bodyOf(index, 'typedPlotAB');
ok(gate.indexOf('handle.plot.ground') !== -1, 'ground checked');
ok(gate.indexOf('ground: true') !== -1, 'marker returned');
pass('phase26 gate marks ground');

// 7 the typed commit stakes off the fold when grounded.
var commit = bodyOf(index, 'commitPlotTypedAt');
ok(commit.indexOf('plotGroundTyped(wpt, parsed.value)') !== -1,
  'ground geometry');
ok(commit.indexOf('plotTypedPoint(dab.aMm, dab.bMm, wpt, parsed.value)') !== -1,
  'segment geometry kept');
pass('phase26 commit branches on ground');

// 8 layer 2 renders ground candidates and typed previews off the
// fold with the same badge and guideline shapes.
ok(index.indexOf('plotGroundCandidate(pw)') !== -1, 'live candidate');
ok(index.indexOf('plotGroundTyped(pw, pparsed.value)') !== -1,
  'typed preview');
pass('phase26 render branches on ground');

// 9 focusing the fold starts from an empty buffer like every other
// gesture pivot.
ok(index.slice(gndArm - 400, gndArm).indexOf(
  'clearTypedDist(handle.typedDist)') !== -1, 'focus clears buffer');
var clears = index.split('clearTypedDist(handle.typedDist)').length - 1;
ok(clears >= 14, 'at least 14 buffer clears wired, got ' + clears);
pass('phase26 focus clears buffer');

// 10 manual documents the ground focus in §4.6 plus the mouse and
// tool tables, with the HTML rebuilt.
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
ok(md.indexOf('**Alt+click** within 14 px') !== -1, 'gesture in §4.6');
ok(md.indexOf('of the fold') !== -1, 'fold named');
ok(html.indexOf('Alt+click') !== -1, 'html rebuilt');
ok(md.indexOf('Focus the ground line for plotting') !== -1, 'mouse row');
ok(md.indexOf('| Ground-line plotting | Alt+click the fold') !== -1,
  'tool row');
pass('phase26 manual documents ground');

// 11 README lists the phase26 suite with the new grand total.
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase26`') !== -1, 'phase26 row');
ok(readme.indexOf('Ground-line plotting: Alt+click fold, type mm, Enter stakes') !== -1,
  'phase26 label');
ok(readme.indexOf('baseline + phases 1–30 (880 checks)') !== -1,
  'grand total 825');
pass('phase26 readme suite row');

// 12 package.json chains the phase26 file in the test script.
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase26'], 'node tools/test-phase26-ground-plot.js',
  'test:phase26 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase26-ground-plot.js') !== -1,
  'chained in test');
pass('phase26 package wiring');

// 13 fold-grab zoom ceiling: the 14 px corridor never reaches past
// 20 mm, so full zoom-out cannot grab the fold from ~280 mm away.
// Default scale behaves exactly as before; only far zoom-out binds.
eq(Cv.GROUND_FOLD_MAX_MM, 20, 'ceiling constant');
eq(Cv.groundFoldGrabbed(7, 2.0), true, 'default scale grabs');
eq(Cv.groundFoldGrabbed(-7, 2.0), true, 'symmetric below fold');
eq(Cv.groundFoldGrabbed(8, 2.0), false, 'default px bound kept');
eq(Cv.groundFoldGrabbed(200, 0.05), false, 'min zoom mm bound');
eq(Cv.groundFoldGrabbed(20, 0.05), true, 'ceiling boundary grabs');
eq(Cv.groundFoldGrabbed(0.2, 50), true, 'max zoom px feel kept');
throws(function () { Cv.groundFoldGrabbed(NaN, 2.0); }, 'nan guard');
throws(function () { Cv.groundFoldGrabbed(7, NaN); }, 'nan guard');
ok(md.indexOf('never exceeds 20 mm') !== -1, 'ceiling in §4.6');
ok(html.indexOf('never exceeds 20 mm') !== -1, 'html rebuilt');
pass('phase26 fold grab ceiling');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase26 tests passed');

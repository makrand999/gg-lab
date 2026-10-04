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

var TOTAL = 12;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }
function near(a, b, msg) {
  ok(Math.abs(a - b) < 1e-9, msg + ' got ' + a + ' want ' + b);
}

function bodyOf(src, fnName) {
  var start = src.indexOf('function ' + fnName + '(');
  ok(start !== -1, fnName + ' found');
  var end = src.indexOf('\n      function ', start + 1);
  return src.slice(start, end === -1 ? src.length : end);
}

// 1 perpendicular stake-out: horizontal, vertical, and tilted datums
// all walk the true normal, on the cursor's side.
var H1 = { x: 0, y: 0 }, H2 = { x: 40, y: 0 };
deep(Cv.plotTypedPoint(H1, H2, { x: 10, y: 30 }, 10), { xMm: 10, yMm: 10 });
deep(Cv.plotTypedPoint(H1, H2, { x: 10, y: -30 }, 10), { xMm: 10, yMm: -10 });
var V1 = { x: 5, y: 0 }, V2 = { x: 5, y: 40 };
deep(Cv.plotTypedPoint(V1, V2, { x: 20, y: 10 }, 7), { xMm: 12, yMm: 10 });
deep(Cv.plotTypedPoint(V1, V2, { x: -9, y: 10 }, 7), { xMm: -2, yMm: 10 });
var t1 = Cv.plotTypedPoint({ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 }, 10);
near(t1.xMm, 20 - 10 / Math.SQRT2, 'tilt x');
near(t1.yMm, 20 + 10 / Math.SQRT2, 'tilt y');
pass('phase25 perpendicular stake-out');

// 2 no side, no point: on-datum cursors return null, degenerate AB
// pins the foot at A, NaN guards throw.
eq(Cv.plotTypedPoint(H1, H2, { x: 20, y: 0 }, 10), null, 'mid-datum');
eq(Cv.plotTypedPoint(H1, H2, { x: 0, y: 0 }, 10), null, 'endpoint');
eq(Cv.PLOT_ON_LINE_TOL_MM, 1e-6);
deep(Cv.plotTypedPoint({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 }, 5),
  { xMm: 5, yMm: 0 }, 'degenerate pins at A');
throws(function () {
  Cv.plotTypedPoint(H1, H2, { x: NaN, y: 0 }, 10);
}, 'nan guard');
pass('phase25 on-line null degenerate');

// 3 the typed target agrees with the click candidate: same clamped
// foot, and typing the live distance reproduces the click point.
var c3 = Cv.plotCandidateFor(H1, H2, { x: 10, y: 30 });
deep(Cv.plotTypedPoint(H1, H2, { x: 10, y: 30 }, c3.distMm), {
  xMm: c3.pointMm.x, yMm: c3.pointMm.y
}, 'typed live-dist equals click');
deep(Cv.plotTypedPoint(H1, H2, { x: 60, y: 10 }, 5), { xMm: 40, yMm: 5 },
  'foot sticks at the segment end');
var c3b = Cv.plotCandidateFor({ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 });
var t3b = Cv.plotTypedPoint({ x: 0, y: 0 }, { x: 40, y: 40 }, { x: 0, y: 40 },
  c3b.distMm);
near(t3b.xMm, c3b.pointMm.x, 'tilt click parity x');
near(t3b.yMm, c3b.pointMm.y, 'tilt click parity y');
pass('phase25 click-candidate parity');

// 4 arming: plotting plus no rename edit returns the datum ends.
var index = fs.readFileSync(INDEX_PATH, 'utf8');
var gate = bodyOf(index, 'typedPlotAB');
ok(gate.indexOf('handle.sel.editing') !== -1, 'rename gate');
ok(gate.indexOf('isPlotToolActive') !== -1, 'plotting gate');
ok(gate.indexOf('handle.plot.aMm') !== -1, 'datum A');
ok(gate.indexOf('handle.plot.bMm') !== -1, 'datum B');
pass('phase25 plot arming gate');

// 5 keydown order: rename first, then the plotting branch, then the
// point-axis branch — the line owns the keyboard while focused.
var kdIdx = index.indexOf("window.addEventListener('keydown'");
ok(kdIdx !== -1, 'keydown found');
var kdEnd = index.indexOf('// Zoom Buttons Click Handlers', kdIdx);
var kd = index.slice(kdIdx, kdEnd);
var iRename = kd.indexOf('handleRenameKey');
var iPlot = kd.indexOf('commitPlotTypedAt(lastCursor)');
var iPoint = kd.indexOf('commitTypedDistAt(lastCursor)');
ok(iRename !== -1 && iPlot !== -1 && iPoint !== -1, 'all three wired');
ok(iRename < iPlot && iPlot < iPoint, 'rename < plot < point');
ok(kd.indexOf('typedPlotAB() !== null') !== -1, 'plot gate in keys');
eq(kd.split('handleTypedDistKey').length - 1, 4, 'router in both branches');
pass('phase25 keydown line wins');

// 6 commit: one plot abort before the place, three named warns, and
// every failure returns with the buffer kept for a retry.
var commit = bodyOf(index, 'commitPlotTypedAt');
ok(commit.indexOf('parseTypedDist') !== -1, 'strict parse');
ok(commit.indexOf('plotTypedPoint') !== -1, 'typed geometry');
eq(commit.split('abortPlotTask()').length - 1, 1, 'single abort');
ok(commit.indexOf('abortPlotTask()') < commit.indexOf('userPlacePoint'),
  'abort precedes place');
eq(commit.split('EduCAD plot: ').length - 1, 3, 'three warns');
['move the cursor off the datum', 'parsed.message',
  'move off the datum to choose a side'
].forEach(function (needle) {
  ok(commit.indexOf(needle) !== -1, 'warns ' + needle);
});
pass('phase25 commit one-shot warns');

// 7 layer-2 plot badge switches to the typed text with the guideline
// stretched to the staked target plus a sky preview ring.
ok(index.indexOf("'⊥ ' + pbuf + ' mm (Enter)'") !== -1, 'typing badge');
ok(index.indexOf('lineTo(pend.x, pend.y)') !== -1, 'guideline to target');
ok(index.indexOf('drawSelectionRing(ctx2, pend.x, pend.y') !== -1,
  'preview ring');
ok(index.indexOf('plotTypedPoint(pt.aMm, pt.bMm, pw') !== -1, 'live preview');
ok(index.indexOf("'⊥ Dist: ' + cand.distMm.toFixed(2) + ' mm'") !== -1,
  'live badge kept');
pass('phase25 badge preview render');

// 8 every plot transition drops the shared buffer: begin, click
// commit, and the abort funnel that all cancels share.
var abort = bodyOf(index, 'abortPlotTask');
ok(abort.indexOf('clearTypedDist(handle.typedDist)') !== -1,
  'abort funnel clears');
var clickCommit = bodyOf(index, 'commitPlotAt');
ok(clickCommit.indexOf('clearTypedDist(handle.typedDist)') !== -1,
  'click commit clears');
var clears = index.split('clearTypedDist(handle.typedDist)').length - 1;
ok(clears >= 14, 'at least 14 buffer clears wired, got ' + clears);
pass('phase25 plot transitions clear');

// 9 first Escape clears only the typed number while plotting: no
// abort, no deselect — the datum stays focused for a retry.
var esc = kd.indexOf("if (e.key === 'Escape')");
var full = kd.indexOf('if (handle.sel.editing !== null', esc);
ok(esc !== -1 && full !== -1, 'escape stages found');
var first = kd.slice(esc, full);
ok(first.indexOf('clearTypedDist') !== -1, 'first clears buffer');
ok(first.indexOf('abortPlotTask') === -1, 'first keeps plotting');
ok(first.indexOf('deselect') === -1, 'first keeps selection');
pass('phase25 escape unwinds one layer');

// 10 manual documents typed plotting in §4.6 plus the keyboard and
// tool tables, with the HTML rebuilt.
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
ok(md.indexOf('`⊥ 10 mm (Enter)`') !== -1, 'gesture in §4.6');
ok(html.indexOf('10 mm (Enter)') !== -1, 'html rebuilt');
ok(md.indexOf('the line owns the keyboard') !== -1, 'precedence noted');
ok(md.indexOf('Click segment, click candidate (or type mm + Enter)') !== -1,
  'tool row');
pass('phase25 manual documents gesture');

// 11 README lists the phase25 suite with the new grand total.
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase25`') !== -1, 'phase25 row');
ok(readme.indexOf('Typed plot offset: focus line, type mm, Enter stakes') !== -1,
  'phase25 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 813');
pass('phase25 readme suite row');

// 12 package.json chains the phase25 file in the test script.
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase25'], 'node tools/test-phase25-plot-typed.js',
  'test:phase25 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase25-plot-typed.js') !== -1,
  'chained in test');
pass('phase25 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase25 tests passed');

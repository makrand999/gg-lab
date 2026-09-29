'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var M = require('../mirror/files/www.geogebra.org/educad-measure.js');

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
function near(a, b, msg) { ok(Math.abs(a - b) < 1e-9, msg + ' (' + a + ' vs ' + b + ')'); }

var index = fs.readFileSync(INDEX_PATH, 'utf8');
var view = { s: 2, tx: 100, ty: 200 };
function fixedW(t) { return String(t).length * 7; }

function bodyOf(fnName) {
  var start = index.indexOf('function ' + fnName + '(');
  ok(start !== -1, fnName + ' found');
  var end = index.indexOf('\n      function ', start + 1);
  return index.slice(start, end === -1 ? index.length : end);
}

// 1 the pick carries its side: only +1/-1 stick, and mode switches
// plus explicit clears drop the side with the pick.
var s1 = M.createViewState();
eq(s1.inspectSide, null);
M.setInspect(s1, 'e7', 1);
eq(s1.inspectSide, 1);
M.setInspect(s1, 'e7', -1);
eq(s1.inspectSide, -1);
M.setInspect(s1, 'e7', 0);
eq(s1.inspectSide, null, 'non-side stores null');
M.setInspect(s1, 'e7', 1);
M.setMode(s1, 'view');
eq(s1.inspectSide, null, 'mode switch clears side');
M.setInspect(s1, 'e7', -1);
M.clearInspect(s1);
eq(s1.inspectSide, null, 'clear drops side');
eq(s1.inspectId, null);
pass('phase29 pick carries its side');

// 2 the dimension side follows the cursor: below a horizontal span
// reads +1, above reads -1; right of a vertical span reads +1, left
// reads -1; anything unmeasurable answers +1.
var hseg = { type: 'SEGMENT', x: 0, y: 0, x2: 40, y2: 0 };
eq(M.dimSideFor(hseg, view, { x: 180, y: 250 }), 1, 'below horizontal');
eq(M.dimSideFor(hseg, view, { x: 180, y: 150 }), -1, 'above horizontal');
var vseg = { type: 'SEGMENT', x: 0, y: 0, x2: 0, y2: 40 };
eq(M.dimSideFor(vseg, view, { x: 150, y: 160 }), 1, 'right of vertical');
eq(M.dimSideFor(vseg, view, { x: 50, y: 160 }), -1, 'left of vertical');
eq(M.dimSideFor({ type: 'TEXT', x: 0, y: 0 }, view, { x: 0, y: 0 }), 1, 'text unused');
eq(M.dimSideFor(hseg, view, null), 1, 'null cursor');
eq(M.dimSideFor(hseg, null, { x: 0, y: 0 }), 1, 'null view');
pass('phase29 side follows the cursor');

// 3 a 40 mm horizontal span dimensions exactly: parallel line 20 px
// off, extension lines gapped and overshot, bare value centered
// between the arrows, secondary slot one row further out.
var L3 = M.linearDimLayout(hseg, view, { side: 1, measure: fixedW });
eq(L3.text, '40.00');
eq(L3.textWpx, 35);
eq(L3.fitsInside, true);
eq(L3.leader, null);
eq(L3.lenMm, 40);
assert.deepStrictEqual(L3.d1, { x: 100, y: 220 });
assert.deepStrictEqual(L3.d2, { x: 180, y: 220 });
assert.deepStrictEqual(L3.ext[0], [{ x: 100, y: 203 }, { x: 100, y: 225 }]);
assert.deepStrictEqual(L3.ext[1], [{ x: 180, y: 203 }, { x: 180, y: 225 }]);
assert.deepStrictEqual(L3.dir, { x: 1, y: 0 });
assert.deepStrictEqual(L3.normal, { x: 0, y: 1 });
assert.deepStrictEqual(L3.textPos, { x: 122.5, y: 236 });
assert.deepStrictEqual(L3.secondaryPos, { x: 122.5, y: 251 });
var L3n = M.linearDimLayout(hseg, view, { side: -1, measure: fixedW });
assert.deepStrictEqual(L3n.d1, { x: 100, y: 180 }, 'flipped side');
eq(M.DIM_OFFSET_MM, 10);
eq(M.DIM_ARROW_PX, 10);
pass('phase29 linear dimension exact');

// 4 a short span with a wide value parks the text past the far end
// with a leader back to it instead of crushing the arrows.
var short = M.linearDimLayout(
  { type: 'SEGMENT', x: 0, y: 0, x2: 2, y2: 0 }, view,
  { side: 1, measure: function () { return 60; } });
eq(short.fitsInside, false);
assert.deepStrictEqual(short.d2, { x: 104, y: 220 });
assert.deepStrictEqual(short.leader.from, { x: 104, y: 220 });
ok(short.textPos.x > short.d2.x, 'value past the far end');
assert.deepStrictEqual(short.textPos, { x: 120, y: 236 });
pass('phase29 short span parks value outside');

// 5 degenerate spans refuse the layout: zero length, wrong type,
// NaN, and dead views all read null (the badge fallback owns them).
eq(M.linearDimLayout({ type: 'SEGMENT', x: 1, y: 1, x2: 1, y2: 1 }, view, {}), null, 'zero length');
eq(M.linearDimLayout({ type: 'POINT', x: 0, y: 0 }, view, {}), null, 'point');
eq(M.linearDimLayout({ type: 'SEGMENT', x: NaN, y: 0, x2: 1, y2: 0 }, view, {}), null, 'NaN');
eq(M.linearDimLayout(hseg, { s: 0, tx: 0, ty: 0 }, {}), null, 'dead scale');
eq(M.linearDimLayout(hseg, null, {}), null, 'null view');
eq(M.linearDimLayout(null, view, {}), null, 'null entity');
pass('phase29 degenerate spans refuse layout');

// 6 the radius leader leaves the rim toward the cursor (NE by
// default), breaks to a horizontal shelf, and marks the center.
var R6 = M.radiusLeaderLayout(
  { type: 'CIRCLE', x: 0, y: 0, radius: 10 }, view, { measure: fixedW });
eq(R6.text, 'R 10.00');
near(R6.angleRad, -Math.PI / 4, 'default NE');
near(R6.rim.x, 100 + 20 * Math.SQRT1_2, 'rim x');
near(R6.rim.y, 200 - 20 * Math.SQRT1_2, 'rim y');
eq(R6.shelfEnd.y, R6.elbow.y, 'shelf horizontal');
ok(R6.shelfEnd.x > R6.elbow.x, 'shelf runs +x');
assert.deepStrictEqual(R6.centerMark,
  [[{ x: 95, y: 200 }, { x: 105, y: 200 }],
    [{ x: 100, y: 195 }, { x: 100, y: 205 }]]);
var R6s = M.radiusLeaderLayout(
  { type: 'CIRCLE', x: 0, y: 0, radius: 10 }, view,
  { cursorPx: { x: 100, y: 300 }, measure: fixedW });
near(R6s.dir.x, 0, 'cursor aims leader x');
near(R6s.dir.y, 1, 'cursor aims leader y');
var R6c = M.radiusLeaderLayout(
  { type: 'CIRCLE', x: 0, y: 0, radius: 10 }, view,
  { cursorPx: { x: 100, y: 200 }, measure: fixedW });
near(R6c.angleRad, -Math.PI / 4, 'cursor on center keeps default');
eq(M.radiusLeaderLayout({ type: 'CIRCLE', x: 0, y: 0, radius: 0 }, view, {}), null, 'zero radius');
eq(M.radiusLeaderLayout({ type: 'POINT', x: 0, y: 0 }, view, {}), null, 'point');
pass('phase29 radius leader aims and shelves');

// 7 the point witness runs straight to the XY fold at the same x,
// labeled with the |Y| height; the fold itself and stubs refuse it.
var W7 = M.pointWitnessLayout({ type: 'POINT', x: 5, y: -8 }, view, {});
assert.deepStrictEqual(W7.pt, { x: 110, y: 216 });
assert.deepStrictEqual(W7.foot, { x: 110, y: 200 });
eq(W7.distMm, 8);
eq(W7.text, '8.00');
assert.deepStrictEqual(W7.textPos, { x: 115, y: 208 });
eq(M.pointWitnessLayout({ type: 'POINT', x: 5, y: 0 }, view, {}), null, 'on fold');
eq(M.pointWitnessLayout({ type: 'POINT', x: 5, y: 1 }, view, {}), null, 'stub refused');
ok(M.pointWitnessLayout({ type: 'POINT', x: 5, y: 1 }, view, { minPx: 1 }) !== null,
  'minPx override');
eq(M.pointWitnessLayout({ type: 'SEGMENT', x: 0, y: 0, x2: 1, y2: 1 }, view, {}), null, 'span');
pass('phase29 point witness hits the fold');

// 8 the overlay dispatches by kind: spans to the linear dimension,
// rounds to the radius leader, points to the witness; clicks store
// the cursor side with the pick.
var ov = bodyOf('drawInspectOverlay');
ok(ov.indexOf('linearDimLayout') !== -1, 'spans dimensioned');
ok(ov.indexOf('radiusLeaderLayout') !== -1, 'rounds leaded');
ok(ov.indexOf('pointWitnessLayout') !== -1, 'points witnessed');
ok(ov.indexOf('drawLinearDim(') !== -1, 'linear drawn');
ok(ov.indexOf('drawRadiusLeader(') !== -1, 'leader drawn');
ok(ov.indexOf('drawWitnessDim(') !== -1, 'witness drawn');
var ld = bodyOf('drawLinearDim');
ok(ld.indexOf('strokeDimSegs(lay.ext)') !== -1, 'extensions stroked');
ok(ld.indexOf('drawArrowhead') !== -1, 'arrow tips');
ok(ld.indexOf('secondary') !== -1, 'secondary stacked');
var rl = bodyOf('drawRadiusLeader');
ok(rl.indexOf('drawArrowhead') !== -1, 'rim arrow');
ok(rl.indexOf("'Ø '") !== -1, 'diameter noted');
var cli = bodyOf('viewClickInspect');
ok(cli.indexOf('dimSideFor') !== -1, 'side computed');
ok(cli.indexOf('setInspect(handle.measure, id, side)') !== -1, 'side stored');
pass('phase29 overlay dispatches by kind');

// 9 every overlay painter stays read-only: no creates, updates, or
// deletes anywhere on the dimension path.
['drawInspectOverlay', 'viewClickInspect', 'drawLinearDim',
  'drawRadiusLeader', 'drawWitnessDim', 'strokeDimSegs'].forEach(function (fn) {
  var b = bodyOf(fn);
  eq(b.indexOf('table.create('), -1, fn + ' never creates');
  eq(b.indexOf('table.update('), -1, fn + ' never updates');
  eq(b.indexOf('table.remove'), -1, fn + ' never deletes');
});
pass('phase29 dimension path read-only');

// 10 manual documents the dimension visuals: drafting style,
// cursor side, leaders, and the fold witness.
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
ok(md.indexOf('extension lines') !== -1, 'extensions documented');
ok(md.indexOf('dimension opens toward the click') !== -1, 'side documented');
ok(md.indexOf('radius leader') !== -1, 'leader documented');
ok(md.indexOf('witness to the XY fold') !== -1, 'witness documented');
ok(html.indexOf('dimension opens toward the click') !== -1, 'html rebuilt');
pass('phase29 manual documents dimensions');

// 11 README lists the phase29 suite with the new grand total.
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase29`') !== -1, 'phase29 row');
ok(readme.indexOf('View dimensions: drafting-style overlay (extension lines, leaders)') !== -1,
  'phase29 label');
ok(readme.indexOf('baseline + phases 1–30 (874 checks)') !== -1,
  'grand total 880');
pass('phase29 readme suite row');

// 12 package.json chains the phase29 file in the test script.
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase29'], 'node tools/test-phase29-view-dims.js',
  'test:phase29 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase29-view-dims.js') !== -1,
  'chained in test');
pass('phase29 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase29 tests passed');

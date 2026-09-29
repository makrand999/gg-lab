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

var index = fs.readFileSync(INDEX_PATH, 'utf8');

function bodyOf(fnName) {
  var start = index.indexOf('function ' + fnName + '(');
  ok(start !== -1, fnName + ' found');
  var end = index.indexOf('\n      function ', start + 1);
  return index.slice(start, end === -1 ? index.length : end);
}

// 1 mode state: Edit by default, View on request, unknown modes
// ignored, and every switch drops the inspected pick.
var s1 = M.createViewState();
eq(s1.mode, 'edit');
eq(s1.inspectId, null);
ok(M.isEdit(s1) && !M.isView(s1), 'edit predicates');
eq(M.setMode(s1, 'view'), 'view');
ok(M.isView(s1) && !M.isEdit(s1), 'view predicates');
M.setInspect(s1, 'e7');
eq(s1.inspectId, 'e7');
eq(M.setMode(s1, 'edit'), 'edit');
eq(s1.inspectId, null, 'switch clears the pick');
eq(M.setMode(s1, 'measure'), 'edit', 'unknown mode ignored');
M.setInspect(s1, null);
eq(s1.inspectId, null);
ok(M.isEdit(null) && !M.isView(null), 'missing state reads as edit');
pass('phase28 mode state switches clean');

// 2 points read back coordinates plus the Elevation/Plan tag; the
// ground line gets its own tag. Hidden and broken dots read null.
var p1 = M.inspectEntity({ id: 'a', type: 'POINT', x: 12, y: 25, caption: 'a', visible: true });
eq(p1.kind, 'point');
eq(p1.title, 'a');
assert.deepStrictEqual(p1.rows, ['X 12.00, Y 25.00 mm', 'Elevation (VP)']);
var p2 = M.inspectEntity({ id: 'b', type: 'POINT', x: -3.5, y: -8, name: 'b', visible: true });
assert.deepStrictEqual(p2.rows, ['X -3.50, Y -8.00 mm', 'Plan (HP)']);
var p3 = M.inspectEntity({ id: 'c', type: 'POINT', x: 0, y: 0, visible: true });
eq(p3.title, 'Point');
eq(p3.rows[1], 'On ground line XY');
eq(M.inspectEntity({ id: 'h', type: 'POINT', x: 1, y: 1, visible: false }), null, 'hidden');
eq(M.inspectEntity({ id: 'n', type: 'POINT', x: NaN, y: 1, visible: true }), null, 'NaN');
eq(M.inspectEntity(null), null, 'null entity');
eq(M.inspectEntity({ id: 't', type: 'TEXT', x: 1, y: 1, visible: true }), null, 'text unmeasurable');
pass('phase28 point readout tags views');

// 3 two-point spans read length, deltas, and the undirected angle:
// a 30-40-50 triangle at 53.1 degrees, and a reversed span reads
// the same orientation.
var s3 = M.inspectEntity({ id: 's', type: 'SEGMENT', x: 0, y: 0, x2: 30, y2: 40, visible: true });
eq(s3.kind, 'line');
eq(s3.title, 'Segment');
assert.deepStrictEqual(s3.rows,
  ['L 50.00 mm', 'ΔX 30.00, ΔY 40.00 mm', '∠ 53.1° from +X']);
var rev = M.inspectEntity({ id: 'r', type: 'LINE', x: 30, y: 40, x2: 0, y2: 0, visible: true });
eq(rev.rows[2], '∠ 53.1° from +X', 'reversed span, same angle');
eq(M.lineAngleDeg(1, 0), 0);
ok(M.lineAngleDeg(-1, -0.001) < 180 && M.lineAngleDeg(-1, -0.001) >= 0, 'angle in [0,180)');
eq(M.lineAngleDeg(0, -5), 90, 'straight down reads 90');
var dt = M.inspectEntity({ id: 'd', type: 'DATUM_AXIS', x: -30, y: 0, x2: 30, y2: 0, visible: true });
eq(dt.title, 'Datum axis');
eq(dt.rows[0], 'L 60.00 mm');
pass('phase28 span readout length angle');

// 4 rounds read center, radius, and diameter; arcs add arc length
// and the degree sweep. Dead radii read null, never throw.
var c4 = M.inspectEntity({ id: 'c', type: 'CIRCLE', x: 1, y: 2, radius: 10, visible: true });
eq(c4.kind, 'round');
eq(c4.title, 'Circle');
assert.deepStrictEqual(c4.rows,
  ['C (1.00, 2.00) mm', 'r 10.00 mm, Dia 20.00 mm']);
var a4 = M.inspectEntity({
  id: 'a', type: 'CIRCULAR_ARC', x: 0, y: 0, radius: 10,
  startAngle: 0, endAngle: Math.PI / 2, visible: true
});
eq(a4.title, 'Arc');
eq(a4.rows[1], 'r 10.00 mm, Dia 20.00 mm');
eq(a4.rows[2], 'arc 15.71 mm, 0.0° to 90.0°');
eq(M.inspectEntity({ id: 'z', type: 'CIRCLE', x: 0, y: 0, radius: 0, visible: true }), null, 'zero radius');
eq(M.inspectEntity({ id: 'q', type: 'CIRCLE', x: 0, y: 0, radius: -2, visible: true }), null, 'negative radius');
pass('phase28 round readout radius sweep');

// 5 hit testing prefers points over spans over rims, skips hidden
// and unmeasurable entities, and defaults to the 14 px tolerance.
var view = { s: 2, tx: 100, ty: 200 };
eq(M.MEASURE_TOL_PX, 14);
var ents = [
  { id: 'seg', type: 'SEGMENT', x: -50, y: 0, x2: 50, y2: 0, visible: true },
  { id: 'pt', type: 'POINT', x: 0, y: 0, visible: true },
  { id: 'txt', type: 'TEXT', x: 0, y: 0, visible: true },
  { id: 'hid', type: 'POINT', x: 40, y: 0, visible: false }
];
// Cursor on the shared origin: the point wins over the span.
eq(M.hitTestAll(ents, { x: 100, y: 200 }, view), 'pt', 'point beats span');
// 20 mm right along the span: past the point, on the line.
eq(M.hitTestAll(ents, { x: 140, y: 200 }, view), 'seg', 'span hit');
// On the hidden dot: nothing (40 mm right of origin).
eq(M.hitTestAll(ents, { x: 180, y: 200 }, view), 'seg', 'hidden skipped, span still hit');
eq(M.hitTestAll(ents, { x: 400, y: 400 }, view), null, 'empty sheet');
eq(M.hitTestAll([], { x: 100, y: 200 }, view), null, 'no entities');
eq(M.hitTestAll(ents, { x: 100, y: 200 }, view, 0), 'pt', 'zero tolerance still hits exact');
var rim = [{ id: 'cc', type: 'CIRCLE', x: 0, y: 0, radius: 10, visible: true }];
eq(M.hitTestAll(rim, { x: 100 + 20, y: 200 }, view), 'cc', 'rim hit');
eq(M.hitTestAll(rim, { x: 100, y: 200 }, view), 'cc', 'tiny-circle center grab');
eq(M.hitTestAll(rim, { x: 300, y: 200 }, view), null, 'far from rim');
eq(M.hitTestAll(null, { x: 0, y: 0 }, view), null, 'never throws on bad input');
pass('phase28 hit test prefers point span rim');

// 6 anchors land on the point, the span midpoint, and the round
// center in px; unmeasurable types anchor null.
assert.deepStrictEqual(
  M.inspectAnchor({ type: 'POINT', x: 3, y: -4 }, view), { x: 106, y: 208 });
assert.deepStrictEqual(
  M.inspectAnchor({ type: 'SEGMENT', x: 0, y: 0, x2: 10, y2: 0 }, view),
  { x: 110, y: 200 }, 'midpoint');
assert.deepStrictEqual(
  M.inspectAnchor({ type: 'CIRCLE', x: 1, y: 1, radius: 5 }, view),
  { x: 102, y: 198 }, 'center');
eq(M.inspectAnchor({ type: 'TEXT', x: 0, y: 0 }, view), null, 'text anchors null');
eq(M.inspectAnchor({ type: 'POINT', x: NaN, y: 0 }, view), null, 'NaN anchors null');
pass('phase28 anchors land on geometry');

// 7 the page loads the module and carries the mode pair ahead of
// the Manual link (still last), with Edit active on boot.
ok(index.indexOf('<script src="files/www.geogebra.org/educad-measure.js"></script>') !== -1,
  'module loaded');
var bar = /<div class="demo-bar">([\s\S]*?)<\/div>/.exec(index);
ok(bar !== null, 'demo bar found');
ok(bar[1].indexOf('id="btn-mode-edit"') !== -1, 'edit button');
ok(bar[1].indexOf('id="btn-mode-view"') !== -1, 'view button');
ok(bar[1].indexOf('class="mode-btn active" id="btn-mode-edit"') !== -1,
  'edit active on boot');
ok(bar[1].indexOf('id="btn-mode-view"') < bar[1].indexOf('id="btn-manual"'),
  'pair ahead of manual');
ok(/<a class="demo-btn"[^>]*>Manual<\/a>\s*$/.test(bar[1]), 'manual still last');
ok(index.indexOf('.mode-btn.active') !== -1, 'mode css');
pass('phase28 page carries mode pair');

// 8 the View click branch sits before banking: a View click (even
// with Ctrl) inspects and returns, and inspects through the one
// read-only helper.
var clickIdx = index.indexOf("c2.addEventListener('click', function (e) {");
ok(clickIdx !== -1, 'click handler found');
var viewBranch = index.indexOf('if (EduCADMeasure.isView(handle.measure)) {', clickIdx);
var bankBranch = index.indexOf('if (e.ctrlKey || e.metaKey) {', clickIdx);
ok(viewBranch !== -1 && bankBranch !== -1 && viewBranch < bankBranch,
  'view owns the click before banking');
var viewSlice = index.slice(viewBranch, bankBranch);
ok(viewSlice.indexOf('viewClickInspect(cursor);') !== -1, 'inspects');
ok(viewSlice.indexOf('return;') !== -1, 'returns');
var insp = bodyOf('viewClickInspect');
ok(insp.indexOf('hitTestAll') !== -1, 'hit tests');
ok(insp.indexOf('setInspect') !== -1, 'stores the pick');
eq(insp.indexOf("table.create("), -1, 'never creates');
eq(insp.indexOf('table.update('), -1, 'never updates');
eq(insp.indexOf('table.remove'), -1, 'never deletes');
pass('phase28 view click inspects read-only');

// 9 View is deaf everywhere else: no rename on double-click, no
// typing or staking on keys (Escape only clears), both right-click
// paths clear the readout instead of menus, and the overlay draws
// only in View with a pick.
var dblIdx = index.indexOf("c2.addEventListener('dblclick', function (e) {");
ok(dblIdx !== -1, 'dblclick found');
var dblSlice = index.slice(dblIdx, index.indexOf('beginEdit(', dblIdx));
ok(dblSlice.indexOf('if (EduCADMeasure.isView(handle.measure)) return;') !== -1,
  'no rename in view');
var keyIdx = index.indexOf("window.addEventListener('keydown', function (e) {");
ok(keyIdx !== -1, 'keydown found');
var keySlice = index.slice(keyIdx, keyIdx + 700);
ok(keySlice.indexOf('if (EduCADMeasure.isView(handle.measure)) {') !== -1,
  'keyboard owned');
ok(keySlice.indexOf('clearInspect') !== -1, 'escape clears');
var ctxCount = 0;
var at = 0;
while (true) {
  var next = index.indexOf("addEventListener('contextmenu'", at);
  if (next === -1) break;
  ctxCount++;
  ok(index.slice(next, next + 1200).indexOf('clearInspect(handle.measure)') !== -1,
    'right-click clears readout');
  at = next + 1;
}
eq(ctxCount, 2, 'both right-click paths');
var ov = bodyOf('drawInspectOverlay');
ok(ov.indexOf('if (!EduCADMeasure.isView(handle.measure)) return;') !== -1,
  'overlay gated on view');
ok(ov.indexOf('inspectId === null') !== -1, 'overlay needs a pick');
ok(ov.indexOf('drawSelectionRing') !== -1, 'anchor ring');
ok(ov.indexOf('drawKnockoutLabel') !== -1, 'badge lines');
pass('phase28 view deaf everywhere else');

// 10 entering View parks the whole authoring bench and lights the
// mode buttons; demos clear the readout; tutorials force Edit.
var sm = bodyOf('setSheetMode');
ok(sm.indexOf('EduCADMeasure.setMode(handle.measure, mode)') !== -1, 'mode stored');
ok(sm.indexOf("getElementById('btn-mode-edit')") !== -1, 'edit lit');
ok(sm.indexOf("getElementById('btn-mode-view')") !== -1, 'view lit');
ok(sm.indexOf('abortLineTask();') !== -1, 'line parked');
ok(sm.indexOf('abortPolarTask();') !== -1, 'polar parked');
ok(sm.indexOf('abortPlotTask();') !== -1, 'plot parked');
ok(sm.indexOf('clearBank();') !== -1, 'bank emptied');
ok(sm.indexOf('deselect(handle.sel);') !== -1, 'selection dropped');
ok(sm.indexOf('clearTypedDist(handle.typedDist);') !== -1, 'buffer cleared');
var demo = bodyOf('loadDemo');
ok(demo.indexOf('clearInspect(handle.measure);') !== -1, 'demos clear readout');
var tut = bodyOf('startTutorial');
ok(tut.indexOf("setSheetMode('edit');") !== -1, 'tutorials force edit');
pass('phase28 entering view parks authoring');

// 11 manual documents the mode pair, the readouts, and the clears.
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
ok(md.indexOf('### 3.9 Edit and View modes') !== -1, 'mode section');
ok(md.indexOf('View measures, never edits') !== -1, 'read-only promise');
ok(md.indexOf('click the entity to inspect') !== -1, 'select and measure');
ok(md.indexOf('Escape clears the readout') !== -1, 'clears documented');
ok(md.indexOf('| `View` | Read-only measure mode') !== -1, 'demo-bar row');
ok(html.indexOf('Edit and View modes') !== -1, 'html rebuilt');
pass('phase28 manual documents modes');

// 12 README lists the phase28 suite with the new grand total, and
// package.json chains the file in the test script.
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase28`') !== -1, 'phase28 row');
ok(readme.indexOf('View mode: Edit/View toggle, select-and-measure inspect') !== -1,
  'phase28 label');
ok(readme.indexOf('baseline + phases 1–30 (874 checks)') !== -1,
  'grand total 850');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase28'], 'node tools/test-phase28-view-measure.js',
  'test:phase28 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase28-view-measure.js') !== -1,
  'chained in test');
pass('phase28 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase28 tests passed');

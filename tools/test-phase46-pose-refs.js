'use strict';
// EduCAD phase 46: pose reference ink. Centre axes and loci are drawing
// furniture, so pose mode pins them instead of riding the follow maps (a
// spanning elevation axis ridden endpoint-wise tilts into a sheet-wide
// diagonal); datum X/Y fall back above the line when the plan crowds the
// underside; crowded stack parts seat on a wider ring instead of firing
// 25 mm leaders. Run: `npm run test:phase46`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Pose = require('../public/lib/educad-pose.js');
var Curr = require('../public/lib/educad-curriculum.js');
var Rec = require('../public/lib/educad-reconstruct.js');
var Lab = require('../public/lib/educad-labels.js');
var Ver = require('../public/lib/educad-verify.js');

var ROOT = path.join(__dirname, '..');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');
var INDEX_PATH = path.join(ROOT, 'public', 'index.html');

var TOTAL = 8;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, msg + ' (' + a + ' vs ' + b + ')');
}

var ENT = Curr.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
ENT.forEach(function (e, i) { e.id = 'E' + (i + 1); });
function byCaption(cap) {
  return ENT.filter(function (e) { return e.caption === cap; })[0];
}
var G = Rec.reconstructLive(ENT).geometry;
var C = Pose.bboxCenter(G.vertices);
var REST2D = Pose.reproject(G.vertices, G.edges);
// The reported tilt: Rz -64.74 deg with a Y lift off the datum wall.
var TILT = { t: [0, 46.56, 0],
  rm: Pose.axisAngleMatrix(0, 0, 1, -64.74 * Math.PI / 180), s: 1 };
var ZSIMS = Pose.simsForPose(G.vertices, G.edges, TILT, C, REST2D);
var ZIDX = Pose.exactIndex(REST2D, ZSIMS.now, G.edges);
var REST_PTS = ENT.filter(function (e) { return e.type === 'POINT'; });

// App-faithful draw list: stored loci never draw, pinned reference ink
// passes through unposed, everything else rides poseCopies with stack
// captions split per frame, exactly like the page.
function drawListFor(sims, idx) {
  var out = [];
  ENT.forEach(function (ent) {
    if (ent.meta && ent.meta.kind === 'locus') return;
    if (Pose.isPosePinned(ent)) { out.push(ent); return; }
    Pose.routeCopies(ent).forEach(function (force) {
      var copies = Pose.poseCopies(ent, sims.elev, sims.plan, force, idx);
      Pose.splitStackCaption(ent, copies, force, { index: idx,
        restPoints: REST_PTS, splitCaption: Lab.splitCaption,
        bareName: Lab.bareName, cornerOf: Ver.cornerOf });
      copies.forEach(function (cp) { out.push(cp); });
    });
  });
  return out;
}
function lineAngle(e) {
  return Math.atan2(e.y2 - e.y, e.x2 - e.x) * 180 / Math.PI;
}

// 1 the pin predicate: datum, axes, and loci hold fixed; live
// correspondence (projectors, hidden edges, solid ink) keeps riding
deep(Pose.POSE_PINNED_KINDS, ['axis', 'locus'], 'pinned kinds ship');
eq(typeof Pose.isPosePinned, 'function', 'ships isPosePinned');
var datum = ENT.filter(function (e) { return e.type === 'DATUM_AXIS'; })[0];
ok(Pose.isPosePinned(datum), 'datum pinned');
var axes = ENT.filter(function (e) { return e.caption === 'axis'; });
eq(axes.length, 2, 'two demo axes');
axes.forEach(function (a, k) { ok(Pose.isPosePinned(a), 'axis ' + k + ' pinned'); });
ok(Pose.isPosePinned(byCaption('locus-base')), 'stored locus pinned');
ok(Pose.isPosePinned(byCaption('locus-top')), 'stored locus pinned');
ok(Pose.isPosePinned({ id: 'pin', type: 'LINE', x: -30, y: 20, x2: 30,
  y2: 20, caption: 'locus-a', meta: { kind: 'locus' } }), 'pinned locus pinned');
['proj-L', 'proj-R', 'proj-inner-L', 'proj-inner-R'].forEach(function (cap) {
  ok(!Pose.isPosePinned(byCaption(cap)), cap + ' still rides');
});
ok(!Pose.isPosePinned(byCaption('h1h2')), 'solid edge still rides');
ok(!Pose.isPosePinned(byCaption('g,a')), 'stack point still rides');
var pyr = Curr.regularSolid({ solid: 'PYRAMID', sizeMm: 35, heightMm: 70, xMm: 0 });
var hid = pyr.entities.filter(function (e) {
  return e.meta && e.meta.kind === 'hidden';
})[0];
ok(!!hid && !Pose.isPosePinned(hid), 'hidden edge still rides');
[null, undefined, {}, { type: 'POINT' }].forEach(function (j, k) {
  eq(Pose.isPosePinned(j), false, 'junk ' + k + ' not pinned');
});
pass('phase46 pin predicate');

// 2 the fitted diagonal it prevents: under the reported tilt the
// elevation axis and loci WOULD tilt steeply (the observed anomaly),
// so the page must draw the pinned rest instead
var elevAxis = axes.filter(function (e) { return e.y * e.y2 < 0; })[0];
ok(!!elevAxis, 'spanning elevation axis exists');
var fitAxis = Pose.poseEntity(elevAxis, ZSIMS.elev, ZSIMS.plan, undefined);
near(lineAngle(fitAxis), 70.6, 0.5, 'fitted axis would diagonalize');
ok(Math.abs(fitAxis.x2 - elevAxis.x2) > 1, 'fitted axis leaves rest');
var fitLocus = Pose.poseEntity(byCaption('locus-top'),
  ZSIMS.elev, ZSIMS.plan, undefined);
near(lineAngle(fitLocus), -64.7, 0.5, 'fitted locus would diagonalize');
ok(Pose.isPosePinned(elevAxis) && Pose.isPosePinned(byCaption('locus-top')),
  'both pinned, so the page draws rest');
eq(Pose.poseCopies(byCaption('proj-L'), ZSIMS.elev, ZSIMS.plan,
  undefined, ZIDX).length, 2, 'projector split stands');
eq(Pose.poseCopies(byCaption('h1h2'), ZSIMS.elev, ZSIMS.plan,
  undefined, ZIDX).length, 2, 'solid edge split stands');
pass('phase46 no fitted diagonal');

// 3 the page pins in both places: draw copies pass pinned ink through
// unposed, and the datum clamp skips it so ghosts never limit gestures
var index = fs.readFileSync(INDEX_PATH, 'utf8');
ok(index.indexOf('EduCADPose.isPosePinned(ent)') !== -1,
  'poseDrawCopies pins');
ok(index.indexOf('EduCADPose.isPosePinned(list[i])') !== -1,
  'posePairsFor skips pinned');
pass('phase46 page wiring');

// 4 datum X/Y step above the line when the plan crowds the underside:
// fixed blockers seal every below sector, so both ends must seat via
// the fallback sectors with no leader
var VIEW = { s: 4, tx: 400, ty: 300, w: 800, h: 600 };
var measure = function (t) { return Lab.estimateTextSize(t, 13); };
var synthDatum = { id: 'D1', type: 'DATUM_AXIS', x: -32.5, y: 0,
  x2: 32.5, y2: 0, bisCode: 'G', viewRole: 'BOTH', visible: true,
  caption: 'XY', showLabel: true, meta: { kind: 'XY' } };
function blockersFor(axMm, sectors) {
  var out = [];
  var size = measure('X');
  var ap = Lab.forward(VIEW, axMm, 0);
  sectors.forEach(function (deg, k) {
    var box = Lab.candidateBox(ap.x, ap.y, deg, size.w, size.h, Lab.RADIUS_PX);
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    var bs = measure('BLK');
    var anchor = Lab.inverse(VIEW, cx - 4, cy + bs.h - 4);
    out.push({ id: 'blk-' + axMm + '-' + k, type: 'TEXT',
      x: anchor.x, y: anchor.y, caption: 'BLK', visible: true,
      meta: {} });
  });
  return out;
}
var crowded = [synthDatum]
  .concat(blockersFor(-32.5, [225, 270, 180]))
  .concat(blockersFor(32.5, [315, 270, 0]));
var rc = Lab.resolve(crowded, VIEW, { measure: measure });
var xc = rc.placements.filter(function (p) { return p.text === 'X'; })[0];
var yc = rc.placements.filter(function (p) { return p.text === 'Y'; })[0];
ok(!xc.leader, 'crowded X needs no leader');
ok([135, 90].indexOf(xc.sectorDeg) !== -1, 'X falls back above');
ok(Lab.boxWorldBounds(xc.box, VIEW).minY >= 0, 'X box above the line');
ok(!yc.leader, 'crowded Y needs no leader');
ok([45, 90].indexOf(yc.sectorDeg) !== -1, 'Y falls back above');
ok(Lab.boxWorldBounds(yc.box, VIEW).minY >= 0, 'Y box above the line');
pass('phase46 datum steps above');

// 5 below-first is preserved: with a free underside both ends seat on
// the legacy below sectors, exactly as before
var rf = Lab.resolve([synthDatum], VIEW, { measure: measure });
var xf = rf.placements.filter(function (p) { return p.text === 'X'; })[0];
var yf = rf.placements.filter(function (p) { return p.text === 'Y'; })[0];
ok(!xf.leader && !yf.leader, 'free datum needs no leaders');
ok([225, 270, 180].indexOf(xf.sectorDeg) !== -1, 'X stays below');
ok([315, 270, 0].indexOf(yf.sectorDeg) !== -1, 'Y stays below');
pass('phase46 datum below first');

// 6 the reported tilt seats every label: no leaders anywhere, the old
// ejectees (h', b', c') stay adjacent, datum ends ride the fallback
var PVIEW = { s: 4.6, tx: 827, ty: 630, w: 1841, h: 914 };
var tilted = Lab.resolve(drawListFor(ZSIMS, ZIDX), PVIEW, {});
eq(tilted.stats.leaders, 0, 'tilted prism needs no leaders');
['h\'', 'b\'', 'c\'', 'X', 'Y'].forEach(function (t) {
  var ps = tilted.placements.filter(function (p) { return p.text === t; });
  eq(ps.length, 1, t + ' drawn once');
  ok(!ps[0].leader, t + ' stays adjacent');
});
var tdx = tilted.placements.filter(function (p) { return p.text === 'X'; })[0];
ok([135, 90].indexOf(tdx.sectorDeg) !== -1, 'tilted X above the line');
pass('phase46 tilt seats every label');

// 7 rest is untouched: the same sheet at identity poses zero leaders,
// with datum ends on the legacy below sectors
var IDSIMS = Pose.simsForPose(G.vertices, G.edges,
  Pose.createPose(), C, REST2D);
var IDIDX = Pose.exactIndex(REST2D, IDSIMS.now, G.edges);
var rested = Lab.resolve(drawListFor(IDSIMS, IDIDX), PVIEW, {});
eq(rested.stats.leaders, 0, 'rest needs no leaders');
var rdx = rested.placements.filter(function (p) { return p.text === 'X'; })[0];
ok([225, 270, 180].indexOf(rdx.sectorDeg) !== -1, 'rest X stays below');
pass('phase46 rest untouched');

// 8 README lists phase46 with the new grand total; package chains it
(function () {
  var readme = fs.readFileSync(README_PATH, 'utf8');
  ok(readme.indexOf('`npm run test:phase46`') !== -1, 'phase46 row');
  ok(readme.indexOf('Pose reference ink: pinned axes, datum seats, stack parts seat') !== -1,
    'phase46 label');
  ok(readme.indexOf('baseline + phases 1–46 (1047 checks)') !== -1,
    'grand total 1047');
  var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  eq(pkg.scripts['test:phase46'], 'node tools/test-phase46-pose-refs.js',
    'test:phase46 script');
  ok(pkg.scripts.test.indexOf('node tools/test-phase46-pose-refs.js') !== -1,
    'chained in test');
})();
pass('phase46 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase46 tests passed');

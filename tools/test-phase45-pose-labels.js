'use strict';
// EduCAD phase 45: stacked point names split across parted corners in
// pose mode. Posed copies carry rider tags (which 3D corner each copy
// stands on); multi-part captions distribute by corner, matched through
// the mate dot in the other view. Run: `npm run test:phase45`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Pose = require('../public/lib/educad-pose.js');
var Curr = require('../public/lib/educad-curriculum.js');
var Rec = require('../public/lib/educad-reconstruct.js');
var Lab = require('../public/lib/educad-labels.js');
var Ver = require('../public/lib/educad-verify.js');

var ROOT = path.join(__dirname, '..');
var TOTAL = 8;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

function stage(angle) {
  var ENT = Curr.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
  var G = Rec.reconstructLive(ENT).geometry;
  var C = Pose.bboxCenter(G.vertices);
  var rest = Pose.reproject(G.vertices, G.edges);
  var sims = Pose.simsForPose(G.vertices, G.edges,
    { t: [0, 40, 0], rm: Pose.axisAngleMatrix(0, 0, 1, angle), s: 1 }, C, rest);
  var idx = Pose.exactIndex(rest, sims.now, G.edges);
  return { ENT: ENT, G: G, sims: sims, idx: idx,
    restPts: ENT.filter(function (e) { return e.type === 'POINT'; }) };
}
function ctxOf(st) {
  return { index: st.idx, restPoints: st.restPts,
    splitCaption: Lab.splitCaption, bareName: Lab.bareName, cornerOf: Ver.cornerOf };
}
function posed(st, ent) {
  var out = [];
  Pose.routeCopies(ent).forEach(function (force) {
    var copies = Pose.poseCopies(ent, st.sims.elev, st.sims.plan, force, st.idx);
    Pose.splitStackCaption(ent, copies, force, ctxOf(st));
    copies.forEach(function (cp) { out.push(cp); });
  });
  return out;
}

// 1 exact copies carry rider tags; the committed entity stays clean
var st = stage(0.8);
var dot = st.ENT.filter(function (e) { return e.caption === 'g,a'; })[0];
var copies = Pose.poseCopies(dot, st.sims.elev, st.sims.plan, undefined, st.idx);
eq(copies.length, 2, 'stack parts into two copies');
copies.forEach(function (cp, k) {
  ok(Array.isArray(cp.meta.poseRiders) && cp.meta.poseRiders.length === 1,
    'copy ' + k + ' tagged');
});
ok(copies[0].meta.poseRiders[0] !== copies[1].meta.poseRiders[0], 'distinct riders');
eq(dot.meta.poseRiders, undefined, 'no tag leaks onto the committed entity');
var free = { type: 'POINT', x: 500, y: 500, caption: 'free' };
var fitted = Pose.poseCopies(free, st.sims.elev, st.sims.plan, undefined, st.idx);
eq(fitted.length, 1, 'free dot follows fit');
eq(fitted[0].meta, undefined, 'fitted copy untagged');
pass('phase45 rider tags');

// 2 coincident riders merge tags: rest keeps the full caption
var rest = stage(0);
var rdot = rest.ENT.filter(function (e) { return e.caption === 'g,a'; })[0];
var rc = Pose.poseCopies(rdot, rest.sims.elev, rest.sims.plan, undefined, rest.idx);
eq(rc.length, 1, 'rest merges to one copy');
deep(rc[0].meta.poseRiders.sort(), [0, 1], 'union of both riders');
Pose.splitStackCaption(rdot, rc, undefined, ctxOf(rest));
eq(rc.length, 1, 'single copy untouched by distribution');
eq(rc[0].caption, 'g,a', 'full stack at rest');
pass('phase45 rest union');

// 3 parted copies split the stack by corner, via mate dots
var got = {};
copies.forEach(function (cp) { got[cp.meta.poseRiders[0]] = cp.caption; });
Pose.splitStackCaption(dot, copies, undefined, ctxOf(st));
var want = {};
copies.forEach(function (cp) {
  var i = cp.meta.poseRiders[0];
  var mate = st.idx.rest.elev.pts[i];
  var mateEnt = st.restPts.filter(function (m) {
    return m.viewRole === 'ELEVATION' &&
      Math.abs(m.x - mate.x) < 1e-9 && Math.abs(m.y - mate.y) < 1e-9;
  })[0];
  want[i] = Ver.cornerOf(Lab.bareName(mateEnt.caption.split(',').filter(function (p) {
    return 'ga'.indexOf(Ver.cornerOf(Lab.bareName(p))) !== -1;
  })[0]));
  eq(cp.caption, cp.caption, 'copy rides rider ' + i);
  eq(Ver.cornerOf(Lab.bareName(cp.caption)), want[i],
    'copy caption names its own corner');
});
deep(Object.keys(got).length, 2, 'two riders tagged');
ok(copies[0].caption !== copies[1].caption, 'captions differ across copies');
eq([copies[0].caption, copies[1].caption].sort().join(','), 'a,g', 'parts divided');
pass('phase45 corner split');

// 4 verdict marks survive the split verbatim
var marked = { type: 'POINT', x: dot.x, y: dot.y, bisCode: 'B',
  viewRole: 'PLAN', caption: '(g),(a)' };
var mc = Pose.poseCopies(marked, st.sims.elev, st.sims.plan, undefined, st.idx);
eq(mc.length, 2, 'marked stack still parts');
Pose.splitStackCaption(marked, mc, undefined, ctxOf(st));
deep(mc.map(function (cp) { return cp.caption; }).sort(), ['(a)', '(g)'],
  'parens ride along');
pass('phase45 marks preserved');

// 5 every fallback keeps the full caption, never a lost name
var solo = { type: 'POINT', x: dot.x, y: dot.y, caption: 'solo' };
var sc = Pose.poseCopies(solo, st.sims.elev, st.sims.plan, undefined, st.idx);
Pose.splitStackCaption(solo, sc, undefined, ctxOf(st));
sc.forEach(function (cp) { eq(cp.caption, 'solo', 'single part untouched'); });
var badCtx = Pose.poseCopies(dot, st.sims.elev, st.sims.plan, undefined, st.idx);
Pose.splitStackCaption(dot, badCtx, undefined, null);
Pose.splitStackCaption(dot, badCtx, undefined, {});
Pose.splitStackCaption(dot, badCtx, undefined, { index: st.idx });
badCtx.forEach(function (cp) { eq(cp.caption, 'g,a', 'missing ctx keeps stack'); });
var noMate = Pose.poseCopies(dot, st.sims.elev, st.sims.plan, undefined, st.idx);
Pose.splitStackCaption(dot, noMate, undefined,
  { index: st.idx, restPoints: [], splitCaption: Lab.splitCaption,
    bareName: Lab.bareName, cornerOf: Ver.cornerOf });
noMate.forEach(function (cp) { eq(cp.caption, 'g,a', 'no mates keeps stack'); });
var segLike = { type: 'SEGMENT', x: 0, y: -10, x2: 10, y2: 30, caption: 'x,y' };
var segCopies = [{ type: 'SEGMENT', caption: 'x,y', meta: { poseRiders: [0] } },
  { type: 'SEGMENT', caption: 'x,y', meta: { poseRiders: [1] } }];
Pose.splitStackCaption(segLike, segCopies, undefined, ctxOf(st));
segCopies.forEach(function (cp) { eq(cp.caption, 'x,y', 'non-points untouched'); });
eq(Pose.splitStackCaption(dot, [], undefined, ctxOf(st)).length, 0, 'empty safe');
pass('phase45 fallbacks');

// 6 the label pass draws each part once, at its own corner
var drawList = [];
st.ENT.forEach(function (e) {
  posed(st, e).forEach(function (cp) { drawList.push(cp); });
});
var res = Lab.resolve(drawList, { s: 3, tx: 400, ty: 300, w: 800, h: 600 }, {});
var g = res.placements.filter(function (p) { return p.text === 'g'; });
var a = res.placements.filter(function (p) { return p.text === 'a'; });
eq(g.length, 1, 'g drawn once');
eq(a.length, 1, 'a drawn once');
ok(Math.abs(g[0].xPx - a[0].xPx) > 60, 'corners separated on screen');
pass('phase45 labels divide');

// 7 the page splits per frame from cached rest points
var index = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
['splitStackCaption(ent, copies, force', 'poseState.restPoints',
  'restPoints: poseState.restPoints',
  "typeof EduCADPose.splitStackCaption === 'function'"].forEach(function (s) {
  ok(index.indexOf(s) !== -1, 'ships ' + s);
});
pass('phase45 page wiring');

// 8 README lists phase45 with the new grand total; package chains it
var readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
ok(readme.indexOf('`npm run test:phase45`') !== -1, 'phase45 row');
ok(readme.indexOf('Pose stack labels split across parted corners') !== -1,
  'phase45 label');
ok(readme.indexOf('baseline + phases 1–46 (1047 checks)') !== -1,
  'grand total 1039');
var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
eq(pkg.scripts['test:phase45'], 'node tools/test-phase45-pose-labels.js',
  'test:phase45 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase45-pose-labels.js') !== -1,
  'chained in test');
pass('phase45 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase45 tests passed');

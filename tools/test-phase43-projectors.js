'use strict';
// EduCAD phase 43: true projector corners. A spanning line is cross-view
// correspondence: every solid corner the rest line touches gets its own
// projector (bottom corners included, each corner exactly once), instead
// of mixed-corner diagonals doubled onto one end. Run: `npm run test:phase43`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Pose = require('../public/lib/educad-pose.js');
var Curr = require('../public/lib/educad-curriculum.js');
var Rec = require('../public/lib/educad-reconstruct.js');

var ROOT = path.join(__dirname, '..');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 5;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

var TWO = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION', 'DATUM_AXIS'];
var I9 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
var EPS = 1e-9;

var ENT = Curr.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
var G = Rec.reconstructLive(ENT).geometry;
var C = Pose.bboxCenter(G.vertices);
var REST2D = Pose.reproject(G.vertices, G.edges);
var ZPOSE = { t: [0, 40, 0], rm: Pose.axisAngleMatrix(0, 0, 1, 0.8), s: 1 };
var ZSIMS = Pose.simsForPose(G.vertices, G.edges, ZPOSE, C, REST2D);
var ZIDX = Pose.exactIndex(REST2D, ZSIMS.now, G.edges);
var IDSIMS = Pose.simsForPose(G.vertices, G.edges, Pose.createPose(), C, REST2D);
var IDIDX = Pose.exactIndex(REST2D, IDSIMS.now, G.edges);
var YSIMS = Pose.simsForPose(G.vertices, G.edges,
  { t: [0, 40, 0], rm: I9.slice(), s: 1 }, C, REST2D);
var YIDX = Pose.exactIndex(REST2D, YSIMS.now, G.edges);

function byCaption(cap) {
  var found = ENT.filter(function (e) { return e.caption === cap; });
  ok(found.length > 0, 'demo ships ' + cap);
  return found[0];
}

function isTwo(e) {
  return TWO.indexOf(e.type) !== -1 &&
    typeof e.x2 === 'number' && typeof e.y2 === 'number';
}

function isSpanning(e) {
  if (!isTwo(e) || e.type === 'DATUM_AXIS') return false;
  return Pose.routeSide(e.y, e, e.y2, undefined) !==
    Pose.routeSide(e.y2, e, e.y, undefined);
}

// Which solid corner an exact copy end sits on (-1 when none).
function cornerOf(view, x, y) {
  var pts = view === 'elev' ? ZSIMS.now.elev.pts : ZSIMS.now.plan.pts;
  for (var i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i].x - x) <= EPS && Math.abs(pts[i].y - y) <= EPS) return i;
  }
  return -1;
}

function copyCorners(e, copies) {
  var sa = Pose.routeSide(e.y, e, e.y2, undefined);
  var sb = Pose.routeSide(e.y2, e, e.y, undefined);
  return copies.map(function (cp) {
    return { a: cornerOf(sa, cp.x, cp.y), b: cornerOf(sb, cp.x2, cp.y2) };
  });
}

function distToSeg(px, py, ax, ay, bx, by) {
  var dx = bx - ax, dy = by - ay;
  var len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return Math.hypot(px - ax, py - ay);
  var t = ((px - ax) * dx + (py - ay) * dy) / len2;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// True projector ends of corner v in the copy's end views.
function cornerEnds(e, v) {
  var sa = Pose.routeSide(e.y, e, e.y2, undefined);
  var sb = Pose.routeSide(e.y2, e, e.y, undefined);
  var pa = sa === 'elev' ? ZSIMS.now.elev.pts[v] : ZSIMS.now.plan.pts[v];
  var pb = sb === 'elev' ? ZSIMS.now.elev.pts[v] : ZSIMS.now.plan.pts[v];
  return [pa, pb];
}

// A corner is carried when its whole true projector lies on some copy
// (a merged station line carries every corner sharing the station).
function carriedBy(copies, e, v) {
  var ends = cornerEnds(e, v);
  for (var i = 0; i < copies.length; i++) {
    var cp = copies[i];
    if (distToSeg(ends[0].x, ends[0].y, cp.x, cp.y, cp.x2, cp.y2) <= EPS &&
        distToSeg(ends[1].x, ends[1].y, cp.x, cp.y, cp.x2, cp.y2) <= EPS) {
      return true;
    }
  }
  return false;
}

function touchedSet(e) {
  var out = [];
  for (var i = 0; i < G.vertices.length; i++) {
    var ev = REST2D.elev.pts[i], pv = REST2D.plan.pts[i];
    if (distToSeg(ev.x, ev.y, e.x, e.y, e.x2, e.y2) <= 1e-6 ||
        distToSeg(pv.x, pv.y, e.x, e.y, e.x2, e.y2) <= 1e-6) {
      out.push(i);
    }
  }
  return out;
}

// 1 outer stations read per-corner: bottom corner headed, top corner
// single, no mixed diagonal doubling one end
[['proj-L', [2, 3]], ['proj-R', [0, 1]]].forEach(function (tc) {
  var e = byCaption(tc[0]);
  ok(isSpanning(e), tc[0] + ' spans views');
  var copies = Pose.poseCopies(e, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
  eq(copies.length, 2, tc[0] + ' two corner projectors');
  var corners = copyCorners(e, copies).map(function (pr) {
    eq(pr.a, pr.b, tc[0] + ' copy same-vertex');
    ok(pr.a !== -1, tc[0] + ' copy exact');
    return pr.a;
  }).sort();
  deep(corners, tc[1], tc[0] + ' bottom and top corners, once each');
  var ys = corners.map(function (i) { return G.vertices[i].y; }).sort();
  deep(ys, [0, 70], tc[0] + ' bottom covered, top single');
  ok(Math.abs(copies[0].x2 - copies[1].x2) > 1 ||
    Math.abs(copies[0].y2 - copies[1].y2) > 1,
    tc[0] + ' heads distinct');
});
pass('phase43 outer stations per corner');

// 2 generality: every spanning copy is same-vertex, every touched corner
// is carried by some copy, inner stations merge front/back pairs into
// one vertical station line each
var spanning = ENT.filter(isSpanning);
ok(spanning.length >= 4, 'demo spans (' + spanning.length + ')');
spanning.forEach(function (e) {
  var copies = Pose.poseCopies(e, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
  var touched = touchedSet(e);
  if (touched.length === 0) {
    eq(copies.length, 1, (e.caption || e.type) + ' untouched stays single');
    deep(copies[0], Pose.poseEntity(e, ZSIMS.elev, ZSIMS.plan, undefined),
      (e.caption || e.type) + ' untouched stays fitted');
    return;
  }
  var seen = {};
  copyCorners(e, copies).forEach(function (pr, i) {
    eq(pr.a, pr.b, (e.caption || e.type) + ' copy ' + i + ' same-vertex');
    ok(pr.a !== -1, (e.caption || e.type) + ' copy ' + i + ' exact');
    ok(!seen[pr.a], (e.caption || e.type) + ' corner ' + pr.a + ' once');
    seen[pr.a] = true;
  });
  touched.forEach(function (v) {
    ok(carriedBy(copies, e, v),
      (e.caption || e.type) + ' carries corner v' + v);
  });
});
[['proj-inner-L', 2], ['proj-inner-R', 2]].forEach(function (tc) {
  var e = byCaption(tc[0]);
  var copies = Pose.poseCopies(e, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
  eq(copies.length, tc[1], tc[0] + ' bottom and top station lines');
  copies.forEach(function (cp, i) {
    ok(Math.abs(cp.x - cp.x2) <= EPS, tc[0] + ' copy ' + i + ' vertical');
  });
  var headYs = copies.map(function (cp) { return cp.y2; }).sort(function (a, b) {
    return a - b;
  });
  ok(headYs[1] - headYs[0] > 1, tc[0] + ' bottom and top heads distinct');
});
pass('phase43 spanning generality');

// 3 bottom corners head projectors, and rest/Y poses render whole lines
var bottomVs = [];
G.vertices.forEach(function (v, i) { if (v.y === 0) bottomVs.push(i); });
eq(bottomVs.length, 6, 'six bottom corners');
bottomVs.forEach(function (i) {
  var carried = spanning.some(function (e) {
    return carriedBy(
      Pose.poseCopies(e, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX), e, i);
  });
  ok(carried, 'bottom corner v' + i + ' heads a projector');
});
['proj-L', 'proj-R', 'proj-inner-L', 'proj-inner-R'].forEach(function (cap) {
  var e = byCaption(cap);
  var rest = Pose.poseCopies(e, IDSIMS.elev, IDSIMS.plan, undefined, IDIDX);
  eq(rest.length, 1, cap + ' rest draws once');
  ok(Math.abs(rest[0].x - e.x) <= 1e-9 && Math.abs(rest[0].y - e.y) <= 1e-9 &&
    Math.abs(rest[0].x2 - e.x2) <= 1e-9 && Math.abs(rest[0].y2 - e.y2) <= 1e-9,
    cap + ' rest union is the whole line');
  var lift = Pose.poseCopies(e, YSIMS.elev, YSIMS.plan, undefined, YIDX);
  eq(lift.length, 1, cap + ' Y-only draws once');
});
pass('phase43 bottom covered rest whole');

// 4 helpers and the fitted path are preserved: untouched spanning ink
// stretches as before, null index means fitted, same-view rules stand
var axis = ENT.filter(function (e) {
  return e.caption === 'axis' && isSpanning(e);
})[0];
ok(!!axis, 'spanning axis helper exists');
deep(Pose.poseCopies(axis, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX),
  [Pose.poseEntity(axis, ZSIMS.elev, ZSIMS.plan, undefined)],
  'untouched spanning helper stays fitted');
var proj = byCaption('proj-L');
deep(Pose.poseCopies(proj, ZSIMS.elev, ZSIMS.plan, undefined, null),
  [Pose.poseEntity(proj, ZSIMS.elev, ZSIMS.plan, undefined)],
  'null index means fitted');
var hexEdge = byCaption('h1h2');
eq(Pose.poseCopies(hexEdge, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX).length,
  2, 'same-view edge split stands');
var datum = ENT.filter(function (e) { return e.type === 'DATUM_AXIS'; })[0];
ok(Pose.poseCopies(datum, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX)[0] === datum,
  'datum passes through');
pass('phase43 fitted path preserved');

// 5 README lists phase43 with the new grand total; package chains it
(function () {
  var readme = fs.readFileSync(README_PATH, 'utf8');
  ok(readme.indexOf('`npm run test:phase43`') !== -1, 'phase43 row');
  ok(readme.indexOf('True projector corners: spanning lines head every touched corner once') !== -1,
    'phase43 label');
  ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
    'grand total 1039');
  var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  eq(pkg.scripts['test:phase43'], 'node tools/test-phase43-projectors.js',
    'test:phase43 script');
  ok(pkg.scripts.test.indexOf('node tools/test-phase43-projectors.js') !== -1,
    'chained in test');
})();
pass('phase43 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase43 tests passed');

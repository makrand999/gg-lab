'use strict';
// EduCAD phase 42: exact-riding ink. Dots, labels, and projector feet
// sitting on solid vertices ride those vertices exactly (splitting
// across coincident vertices when the pose separates them) instead of
// the fitted similarity, so HP/VP ink stays glued to the exact overlay
// through Y moves and Z spins. Run: `npm run test:phase42`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Pose = require('../mirror/files/www.geogebra.org/educad-pose.js');
var Proj = require('../mirror/files/www.geogebra.org/educad-project.js');
var Curr = require('../mirror/files/www.geogebra.org/educad-curriculum.js');
var Rec = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 7;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }
function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, msg + ' (' + a + ' vs ' + b + ')');
}

var TWO = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION', 'DATUM_AXIS'];
var I9 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
var EPS = 1e-9;

var ENT = Curr.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
var G = Rec.reconstructLive(ENT).geometry;
var C = Pose.bboxCenter(G.vertices);
var REST2D = Pose.reproject(G.vertices, G.edges);
var ZPOSE = { t: [0, 40, 0], rm: Pose.axisAngleMatrix(0, 0, 1, 0.8), s: 1 };
var ZSIMS = Pose.simsForPose(G.vertices, G.edges, ZPOSE, C, REST2D);
var ZV = Pose.applyPose(G.vertices, ZPOSE, C);
var OVF = Proj.projectSolid(ZV, G.edges, G.faces, 'front');
var OVT = Proj.projectSolid(ZV, G.edges, G.faces, 'top');
var ZIDX = Pose.exactIndex(REST2D, ZSIMS.now, G.edges);
var IDSIMS = Pose.simsForPose(G.vertices, G.edges, Pose.createPose(), C, REST2D);
var IDIDX = Pose.exactIndex(REST2D, IDSIMS.now, G.edges);

function byCaption(cap) {
  var found = ENT.filter(function (e) { return e.caption === cap; });
  ok(found.length > 0, 'demo ships ' + cap);
  return found[0];
}

function ovVerts(segs) {
  var o = [];
  segs.forEach(function (s) { o.push([s.ax, s.ay]); o.push([s.bx, s.by]); });
  return o;
}
var VF = ovVerts(OVF), VT = ovVerts(OVT);

function nearest(x, y, verts) {
  var m = Infinity;
  for (var i = 0; i < verts.length; i++) {
    var d = Math.hypot(x - verts[i][0], y - verts[i][1]);
    if (d < m) m = d;
  }
  return m;
}

function hasRider(view, x, y) {
  var pts = view === 'elev' ? REST2D.elev.pts : REST2D.plan.pts;
  for (var i = 0; i < pts.length; i++) {
    if (Math.abs(pts[i].x - x) <= 1e-6 && Math.abs(pts[i].y - y) <= 1e-6) {
      return true;
    }
  }
  return false;
}

function segMatchesOverlay(cp, segs) {
  for (var i = 0; i < segs.length; i++) {
    var s = segs[i];
    var direct = Math.abs(cp.x - s.ax) <= EPS && Math.abs(cp.y - s.ay) <= EPS &&
      Math.abs(cp.x2 - s.bx) <= EPS && Math.abs(cp.y2 - s.by) <= EPS;
    var flip = Math.abs(cp.x - s.bx) <= EPS && Math.abs(cp.y - s.by) <= EPS &&
      Math.abs(cp.x2 - s.ax) <= EPS && Math.abs(cp.y2 - s.ay) <= EPS;
    if (direct || flip) return true;
  }
  return false;
}

// 1 points ride their vertices: plan dots split across the parted rings,
// single-vertex dots stay single, free ink keeps the fitted copy, rest
// poses dedupe back to one
var planDot = byCaption('g,a');
var zDots = Pose.poseCopies(planDot, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zDots.length, 2, 'plan dot splits in two');
zDots.forEach(function (cp, i) {
  near(nearest(cp.x, cp.y, VT), 0, EPS, 'plan copy ' + i + ' on a ring vertex');
});
ok(Math.abs(zDots[0].x - zDots[1].x) > 1, 'split copies separate');
var elevOuter = byCaption("a'");
var zOuter = Pose.poseCopies(elevOuter, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zOuter.length, 1, 'single-vertex dot stays single');
near(nearest(zOuter[0].x, zOuter[0].y, VF), 0, EPS, 'outer dot on overlay vertex');
var elevInner = byCaption("f',b'");
var zInner = Pose.poseCopies(elevInner, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zInner.length, 1, 'front/back pair dedupes (always coincident in VP)');
near(nearest(zInner[0].x, zInner[0].y, VF), 0, EPS, 'inner dot on overlay vertex');
var free = { id: 'F1', type: 'POINT', viewRole: 'PLAN', x: 100, y: -100 };
var zFree = Pose.poseCopies(free, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zFree.length, 1, 'free point keeps one copy');
deep(zFree[0], Pose.poseEntity(free, ZSIMS.elev, ZSIMS.plan, undefined),
  'free point keeps the fitted copy');
var restDots = Pose.poseCopies(planDot, IDSIMS.elev, IDSIMS.plan, undefined, IDIDX);
eq(restDots.length, 1, 'rest pose dedupes to one');
near(restDots[0].x, planDot.x, EPS, 'rest copy sits on the ink x');
near(restDots[0].y, planDot.y, EPS, 'rest copy sits on the ink y');
deep(planDot.x, 17.5, 'input untouched');
pass('phase42 exact riding points');

// 2 segments read edge-wise: hexagon edges split across both rings,
// solid verticals ride single, non-edge outlines and the datum keep the
// old path, spanning projectors read corner-wise
var hexEdge = byCaption('h1h2');
var zHex = Pose.poseCopies(hexEdge, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zHex.length, 2, 'hexagon edge splits across rings');
zHex.forEach(function (cp, i) {
  ok(segMatchesOverlay(cp, OVT), 'ring copy ' + i + ' matches an overlay edge');
});
var outerV = byCaption('e-R');
var zVert = Pose.poseCopies(outerV, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zVert.length, 1, 'solid vertical rides single');
ok(segMatchesOverlay(zVert[0], OVF), 'vertical matches an overlay edge');
var base = byCaption("b1'b2'");
var zBase = Pose.poseCopies(base, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zBase.length, 1, 'non-edge outline keeps one copy');
deep(zBase[0], Pose.poseEntity(base, ZSIMS.elev, ZSIMS.plan, undefined),
  'non-edge outline keeps the fitted copy');
var proj = byCaption('proj-L');
var zProj = Pose.poseCopies(proj, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zProj.length, 2, 'spanning projector reads corner-wise');
var restProj = Pose.poseCopies(proj, IDSIMS.elev, IDSIMS.plan, undefined, IDIDX);
eq(restProj.length, 1, 'rest projector dedupes to one');
var datum = ENT.filter(function (e) { return e.type === 'DATUM_AXIS'; })[0];
ok(Pose.poseCopies(datum, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX)[0] === datum,
  'datum passes through');
var frozen = { id: 'S9', type: 'SEGMENT', viewRole: 'PLAN',
  x: 17.5, y: -25.5, x2: 8.75, y2: -10.344555433772324 };
Pose.poseCopies(frozen, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
deep([frozen.x, frozen.y, frozen.x2, frozen.y2],
  [17.5, -25.5, 8.75, -10.344555433772324], 'input untouched');
pass('phase42 exact riding segments');

// 3 the HP/VP consistency lock: every vertex-riding endpoint lands on an
// overlay vertex, and every overlay vertex has riding ink on it
['elev', 'plan'].forEach(function (view) {
  var ov = view === 'elev' ? VF : VT;
  var ridingEnds = [];
  ENT.forEach(function (e) {
    if (e.type === 'DATUM_AXIS') return;
    var two = TWO.indexOf(e.type) !== -1 &&
      typeof e.x2 === 'number' && typeof e.y2 === 'number';
    Pose.routeCopies(e).forEach(function (force) {
      var sa = Pose.routeSide(e.y, e, two ? e.y2 : undefined, force);
      var ends = [{ x: e.x, y: e.y, side: sa }];
      if (two) {
        ends.push({ x: e.x2, y: e.y2,
          side: Pose.routeSide(e.y2, e, e.y, force) });
      }
      var copies = Pose.poseCopies(e, ZSIMS.elev, ZSIMS.plan, force, ZIDX);
      ends.forEach(function (ed, k) {
        if (ed.side !== view || !hasRider(view, ed.x, ed.y)) return;
        var best = Infinity;
        copies.forEach(function (cp) {
          var px = k === 0 ? cp.x : cp.x2;
          var py = k === 0 ? cp.y : cp.y2;
          var d = nearest(px, py, ov);
          if (d < best) best = d;
        });
        ridingEnds.push(best);
        near(best, 0, EPS, view + ' riding end on overlay vertex');
      });
    });
  });
  ok(ridingEnds.length > 0, view + ' has riding ink');
  ov.forEach(function (v, i) {
    var best = Infinity;
    ENT.forEach(function (e) {
      if (e.type === 'DATUM_AXIS') return;
      var two = TWO.indexOf(e.type) !== -1 &&
        typeof e.x2 === 'number' && typeof e.y2 === 'number';
      Pose.routeCopies(e).forEach(function (force) {
        Pose.poseCopies(e, ZSIMS.elev, ZSIMS.plan, force, ZIDX).forEach(function (cp) {
          var sa = Pose.routeSide(e.y, e, two ? e.y2 : undefined, force);
          if (sa === view) {
            var d = Math.hypot(cp.x - v[0], cp.y - v[1]);
            if (d < best) best = d;
          }
          if (two && Pose.routeSide(e.y2, e, e.y, force) === view) {
            var d2 = Math.hypot(cp.x2 - v[0], cp.y2 - v[1]);
            if (d2 < best) best = d2;
          }
        });
      });
    });
    near(best, 0, EPS, view + ' overlay vertex ' + i + ' has riding ink');
  });
});
pass('phase42 HP VP consistency lock');

// 4 the fitted path is preserved: null index means fitted always,
// riderless helpers stay fitted with the index, and snapped rounds keep
// the area radius plus remapped angles
var segFree = { id: 'S1', type: 'SEGMENT', viewRole: 'BOTH',
  x: 0, y: 10, x2: 0, y2: -10 };
deep(Pose.poseCopies(segFree, ZSIMS.elev, ZSIMS.plan, undefined, null),
  [Pose.poseEntity(segFree, ZSIMS.elev, ZSIMS.plan, undefined)],
  'null index means fitted');
deep(Pose.poseCopies(planDot, ZSIMS.elev, ZSIMS.plan, undefined, null),
  [Pose.poseEntity(planDot, ZSIMS.elev, ZSIMS.plan, undefined)],
  'null index skips snapping even on vertices');
var axis = byCaption('axis');
deep(Pose.poseCopies(axis, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX),
  [Pose.poseEntity(axis, ZSIMS.elev, ZSIMS.plan, undefined)],
  'riderless helper stays fitted');
var locus = byCaption('locus-top');
deep(Pose.poseCopies(locus, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX),
  [Pose.poseEntity(locus, ZSIMS.elev, ZSIMS.plan, undefined)],
  'riderless locus stays fitted');
var snapCircle = { id: 'C9', type: 'CIRCLE', viewRole: 'PLAN',
  x: 17.5, y: -25.5, radius: 4 };
var zCir = Pose.poseCopies(snapCircle, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX);
eq(zCir.length, 2, 'snapped circle splits like its center');
near(nearest(zCir[0].x, zCir[0].y, VT), 0, EPS, 'snapped center on ring 0');
near(nearest(zCir[1].x, zCir[1].y, VT), 0, EPS, 'snapped center on ring 1');
var fitCir = Pose.poseEntity(snapCircle, ZSIMS.elev, ZSIMS.plan, undefined);
eq(zCir[0].radius, fitCir.radius, 'snapped radius keeps the fitted area rule');
var arc = { id: 'A9', type: 'CIRCULAR_ARC', viewRole: 'PLAN',
  x: 100, y: -100, radius: 4, startAngle: 0, endAngle: 1 };
deep(Pose.poseCopies(arc, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX)[0],
  Pose.poseEntity(arc, ZSIMS.elev, ZSIMS.plan, undefined),
  'free arc keeps fitted angles');
pass('phase42 fitted path preserved');

// 5 snapping is deterministic and bounded: repeats agree bit for bit,
// near-misses stay fitted, bad index shapes throw
deep(Pose.poseCopies(planDot, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX),
  Pose.poseCopies(planDot, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX),
  'repeats agree');
var nearMiss = { id: 'M1', type: 'POINT', viewRole: 'PLAN',
  x: 17.5 + 2e-6, y: -25.5 };
deep(Pose.poseCopies(nearMiss, ZSIMS.elev, ZSIMS.plan, undefined, ZIDX),
  [Pose.poseEntity(nearMiss, ZSIMS.elev, ZSIMS.plan, undefined)],
  '2e-6 miss stays fitted');
eq(Pose.POSE_SNAP_EPS, 1e-6, 'snap epsilon');
eq(typeof Pose.exactIndex, 'function', 'ships exactIndex');
eq(typeof Pose.poseCopies, 'function', 'ships poseCopies');
throws(function () { Pose.exactIndex(null, ZSIMS.now, G.edges); }, 'rest needed');
throws(function () { Pose.exactIndex(REST2D, null, G.edges); }, 'posed needed');
throws(function () {
  Pose.exactIndex(REST2D, { elev: { pts: [] }, plan: ZSIMS.now.plan }, G.edges);
}, 'vertex counts match');
throws(function () { Pose.exactIndex(REST2D, ZSIMS.now, [[0, 99]]); },
  'edge range checked');
throws(function () { Pose.poseCopies(null, ZSIMS.elev, ZSIMS.plan); }, 'entity needed');
throws(function () {
  Pose.poseCopies(planDot, ZSIMS.elev, ZSIMS.plan, 'sideways', ZIDX);
}, 'force checked');
pass('phase42 snapping bounds');

// 6 the page rides exact ink through the live index, with the fitted
// path as fallback
(function () {
  var index = fs.readFileSync(INDEX_PATH, 'utf8');
  ['poseState.exactIndex', 'EduCADPose.exactIndex(poseState.rest2D',
    'poseState.sims.now', 'EduCADPose.poseCopies(ent, sims.elev, sims.plan, force',
    '[EduCADPose.poseEntity(ent, sims.elev, sims.plan, force)]'].forEach(function (str) {
    ok(index.indexOf(str) !== -1, 'ships ' + str);
  });
})();
pass('phase42 page wiring');

// 7 README lists phase42 with the new grand total; package chains it
(function () {
  var readme = fs.readFileSync(README_PATH, 'utf8');
  ok(readme.indexOf('`npm run test:phase42`') !== -1, 'phase42 row');
  ok(readme.indexOf('Pose ink rides exact: vertex dots, labels, projector feet track split views') !== -1,
    'phase42 label');
  ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
    'grand total 1039');
  var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  eq(pkg.scripts['test:phase42'], 'node tools/test-phase42-exact-ink.js',
    'test:phase42 script');
  ok(pkg.scripts.test.indexOf('node tools/test-phase42-exact-ink.js') !== -1,
    'chained in test');
})();
pass('phase42 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase42 tests passed');

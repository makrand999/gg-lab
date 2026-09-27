'use strict';
var assert = require('assert');
var fs = require('fs');
var R = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');
var S = require('../mirror/files/www.geogebra.org/educad-solid.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');
var Cv = require('../mirror/files/www.geogebra.org/educad-canvas.js');

var TOTAL = 30;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }

function seg(x1, y1, x2, y2, role, bis, extra) {
  var e = {
    type: 'SEGMENT', x: x1, y: y1, x2: x2, y2: y2,
    bisCode: bis || 'B', viewRole: role || 'BOTH'
  };
  if (extra) for (var k in extra) e[k] = extra[k];
  return e;
}
function pt(x, y, role, bis) {
  return { type: 'POINT', x: x, y: y, bisCode: bis || 'B', viewRole: role || 'BOTH' };
}
function circ(x, y, r, role, bis) {
  return { type: 'CIRCLE', x: x, y: y, x2: 0, y2: 0, radius: r, bisCode: bis || 'A', viewRole: role || 'PLAN' };
}

// 1 2-view cylinder bundle reconstructs, class D, exact counts and proportions
var cylEnts = C.regularSolid({ solid: 'CYLINDER', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
var r1 = R.reconstruct(cylEnts);
eq(r1.status, 'ok');
eq(r1.class, 'D');
eq(r1.geometry.vertices.length, 48);
eq(r1.geometry.edges.length, 72);
eq(r1.geometry.faces.length, 26);
eq(r1.coverage.plan, 1);
eq(r1.coverage.elev, 1);
var cx1 = r1.geometry.vertices.map(function (v) { return v.x; });
var cy1 = r1.geometry.vertices.map(function (v) { return v.y; });
near(Math.max.apply(null, cx1) - Math.min.apply(null, cx1), 35, 1e-9, 'diameter');
near(Math.max.apply(null, cy1) - Math.min.apply(null, cy1), 70, 1e-9, 'height');
pass('phase13 cylinder ok 48v 72e 26f');

// 2 determinism under reorder and rerun
var a2 = R.reconstruct(cylEnts);
var b2 = R.reconstruct(cylEnts.slice().reverse());
assert.deepStrictEqual(a2.geometry, b2.geometry);
assert.deepStrictEqual(R.reconstruct(cylEnts), R.reconstruct(cylEnts));
pass('phase13 cylinder deterministic');

// 3 wrong radius fails named, never a wrong solid
var wrong3 = [
  circ(0, -25.5, 17.5, 'PLAN', 'A'),
  pt(0, -25.5, 'PLAN', 'B'),
  seg(-12, 0, 12, 0, 'ELEVATION', 'A'),
  seg(12, 0, 12, 70, 'ELEVATION', 'A'),
  seg(12, 70, -12, 70, 'ELEVATION', 'A'),
  seg(-12, 70, -12, 0, 'ELEVATION', 'A')
];
var r3 = R.reconstruct(wrong3);
eq(r3.status, 'unavailable');
eq(r3.reason, 'x-mismatch');
pass('phase13 wrong radius x-mismatch');

// 4 two plan circles compete, never a guess
var twin4 = cylEnts.concat([circ(60, -25.5, 10, 'PLAN', 'A')]);
var r4 = R.reconstruct(twin4);
eq(r4.status, 'unavailable');
eq(r4.reason, 'ambiguous-pairing');
pass('phase13 twin circles ambiguous');

// 5 arc-only sheet stays deferred
var r5 = R.reconstruct([{ type: 'CIRCULAR_ARC', x: 0, y: -25, x2: 5, y2: -20, radius: 17.5, startAngle: 0, endAngle: 1, bisCode: 'A', viewRole: 'PLAN' }]);
eq(r5.status, 'unavailable');
eq(r5.reason, 'unsupported-curves');
pass('phase13 arc-only deferred');

// 6 valid cylinder plus an extra arc ignores the arc, never unmatched
var withArc6 = cylEnts.concat([{ type: 'CIRCULAR_ARC', x: 0, y: 20, x2: 5, y2: 25, radius: 5, startAngle: 0, endAngle: 1, bisCode: 'A', viewRole: 'ELEVATION' }]);
var r6 = R.reconstruct(withArc6);
eq(r6.status, 'ok');
eq(r6.class, 'D');
ok(r6.warnings.map(function (w) { return w.code; }).indexOf('curves-ignored') !== -1, 'arc warned');
pass('phase13 cylinder plus arc ok ignored');

// 7 center point tolerated at center, optional, off-center fails
var noCenter7 = cylEnts.filter(function (e) { return !(e.type === 'POINT' && e.viewRole === 'PLAN'); });
var r7a = R.reconstruct(noCenter7);
eq(r7a.status, 'ok');
eq(r7a.class, 'D');
var offCenter7 = noCenter7.concat([pt(5, -25.5, 'PLAN', 'B')]);
var r7b = R.reconstruct(offCenter7);
eq(r7b.status, 'unavailable');
eq(r7b.reason, 'unmatched-point');
pass('phase13 center tolerated optional');

// 8 2-view cone bundle reconstructs, class D, apex placed
var coneEnts = C.regularSolid({ solid: 'CONE', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
var r8 = R.reconstruct(coneEnts);
eq(r8.status, 'ok');
eq(r8.class, 'D');
eq(r8.geometry.vertices.length, 25);
eq(r8.geometry.edges.length, 48);
eq(r8.geometry.faces.length, 25);
eq(r8.coverage.plan, 1);
eq(r8.coverage.elev, 1);
var apex8 = r8.geometry.vertices[r8.geometry.vertices.length - 1];
near(apex8.x, 0, 1e-9, 'apex x');
near(apex8.y, 70, 1e-9, 'apex h');
near(apex8.z, 25.5, 1e-9, 'apex d');
pass('phase13 cone ok 25v 48e 25f');

// 9 cone missing apex point fails named, never guessed
var noApex9 = coneEnts.filter(function (e) { return !(e.type === 'POINT' && e.viewRole === 'ELEVATION'); });
var r9 = R.reconstruct(noApex9);
eq(r9.status, 'unavailable');
eq(r9.reason, 'unmatched-point');
pass('phase13 cone missing apex unmatched');

// 10 cone drifted apex: loose band x-mismatch, far unmatched
var base10 = coneEnts.filter(function (e) { return !(e.type === 'POINT' && e.viewRole === 'ELEVATION'); });
var drift10a = base10.concat([pt(1.0, 70, 'ELEVATION', 'B')]);
var r10a = R.reconstruct(drift10a);
eq(r10a.status, 'unavailable');
eq(r10a.reason, 'x-mismatch');
var drift10b = base10.concat([pt(5, 70, 'ELEVATION', 'B')]);
var r10b = R.reconstruct(drift10b);
eq(r10b.status, 'unavailable');
eq(r10b.reason, 'unmatched-point');
pass('phase13 cone drifted apex named');

// 11 3-view cylinder both sides ok, triple coverage
[1, -1].forEach(function (side) {
  var sheet = C.threeViewSheet({ solid: 'CYLINDER', sizeMm: 35, heightMm: 70, xMm: 0, side: side });
  eq(C.validateBundle(sheet).ok, true);
  var rr = R.reconstruct(sheet.entities);
  eq(rr.status, 'ok');
  eq(rr.class, 'D');
  eq(rr.geometry.vertices.length, 48);
  eq(rr.coverage.plan, 1);
  eq(rr.coverage.elev, 1);
  eq(rr.coverage.profile, 1);
});
pass('phase13 3-view cylinder both sides');

// 12 3-view cone both sides ok, triple coverage
[1, -1].forEach(function (side) {
  var sheet = C.threeViewSheet({ solid: 'CONE', sizeMm: 35, heightMm: 70, xMm: 0, side: side });
  eq(C.validateBundle(sheet).ok, true);
  var rr = R.reconstruct(sheet.entities);
  eq(rr.status, 'ok');
  eq(rr.class, 'D');
  eq(rr.geometry.vertices.length, 25);
  eq(rr.coverage.plan, 1);
  eq(rr.coverage.elev, 1);
  eq(rr.coverage.profile, 1);
});
pass('phase13 3-view cone both sides');

// 13 wrong-depth profile fails x-mismatch, never a wrong solid
var cylSheet13 = C.threeViewSheet({ solid: 'CYLINDER', sizeMm: 35, heightMm: 70, xMm: 0, side: 1 });
var narrow13 = cylSheet13.entities.filter(function (e) { return e.viewRole !== 'PROFILE'; })
  .concat([
    seg(100, 0, 120, 0, 'PROFILE', 'A'),
    seg(120, 0, 120, 70, 'PROFILE', 'A'),
    seg(120, 70, 100, 70, 'PROFILE', 'A'),
    seg(100, 70, 100, 0, 'PROFILE', 'A')
  ]);
var r13 = R.reconstruct(narrow13);
eq(r13.status, 'unavailable');
eq(r13.reason, 'x-mismatch');
pass('phase13 wrong depth x-mismatch');

// 14 wrong-height profile fails named (apex off the top line)
var coneSheet14 = C.threeViewSheet({ solid: 'CONE', sizeMm: 35, heightMm: 70, xMm: 0, side: 1 });
var tall14 = coneSheet14.entities.filter(function (e) { return e.viewRole !== 'PROFILE'; })
  .concat([
    seg(100, 0, 135, 0, 'PROFILE', 'A'),
    seg(100, 0, 117.5, 80, 'PROFILE', 'A'),
    seg(135, 0, 117.5, 80, 'PROFILE', 'A'),
    pt(117.5, 80, 'PROFILE', 'B')
  ]);
var r14 = R.reconstruct(tall14);
eq(r14.status, 'unavailable');
eq(r14.reason, 'unmatched-point');
pass('phase13 wrong height unmatched-point');

// 15 tessellation goldens: K=24, rim vertex 0 at +X, CCW from +Y
eq(R.RIM_K, 24);
var g15c = R.reconstruct(cylEnts).geometry;
assert.deepStrictEqual(g15c.vertices[0], { x: 17.5, y: 0, z: 25.5 });
assert.deepStrictEqual(g15c.vertices[24], { x: 17.5, y: 70, z: 25.5 });
near(g15c.vertices[1].x, 17.5 * Math.cos(Math.PI / 12), 1e-9, 'v1 x');
near(g15c.vertices[1].z, 25.5 + 17.5 * Math.sin(Math.PI / 12), 1e-9, 'v1 z');
near(g15c.vertices[6].x, 0, 1e-9, 'v6 x');
near(g15c.vertices[6].z, 43, 1e-9, 'v6 z');
var g15k = R.reconstruct(coneEnts).geometry;
assert.deepStrictEqual(g15k.vertices[0], { x: 17.5, y: 0, z: 25.5 });
assert.deepStrictEqual(g15k.vertices[24], { x: 0, y: 70, z: 25.5 });
pass('phase13 tessellation goldens rim v0');

// 16 tessellated output passes createGeometry guards (loops >=3, finite)
[g15c, g15k].forEach(function (g) {
  g.faces.forEach(function (f) { ok(f.length >= 3, 'loop len'); });
  g.vertices.forEach(function (v) {
    ok(Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z), 'finite');
  });
  var built = S.createGeometry(g);
  eq(built.vertices.length, g.vertices.length);
  eq(built.edges.length, g.edges.length);
  eq(built.faces.length, g.faces.length);
});
pass('phase13 tessellation guards pass');

// 17 rendered cylinder totals and non-empty hidden set at rest
function MockCtx() {
  return {
    beginPath: function () {}, save: function () {}, restore: function () {},
    moveTo: function () {}, lineTo: function () {}, stroke: function () {},
    arc: function () {}, fill: function () {}, setLineDash: function () {}
  };
}
var st17 = S.createSolidState({});
S.setGeometry(st17, g15c);
var c17 = S.render(MockCtx(), st17);
eq(c17.vertices, 48);
eq(c17.front + c17.hidden, 72);
ok(c17.hidden > 0, 'some hidden');
pass('phase13 cylinder renders hidden');

// 18 rendered cone totals and non-empty hidden set at rest
var st18 = S.createSolidState({});
S.setGeometry(st18, g15k);
var c18 = S.render(MockCtx(), st18);
eq(c18.vertices, 25);
eq(c18.front + c18.hidden, 48);
ok(c18.hidden > 0, 'some hidden');
pass('phase13 cone renders hidden');

// 19 box plus arc stays ok, arc ignored never unmatched
function planRect(x0, y0, x1, y1) {
  return [
    seg(x0, y0, x1, y0), seg(x1, y0, x1, y1),
    seg(x1, y1, x0, y1), seg(x0, y1, x0, y0)
  ];
}
var box19 = planRect(0, -40, 30, -10).concat(planRect(0, 5, 30, 50))
  .concat([{ type: 'CIRCULAR_ARC', x: 15, y: -25, x2: 20, y2: -20, radius: 5, startAngle: 0, endAngle: 1, bisCode: 'A', viewRole: 'PLAN' }]);
var r19 = R.reconstruct(box19);
eq(r19.status, 'ok');
eq(r19.class, 'A');
ok(r19.warnings.map(function (w) { return w.code; }).indexOf('curves-ignored') !== -1, 'arc warned');
pass('phase13 box plus arc ignored');

// 20 failure hygiene: reason set pins the pair-by-name amendment (+name-mismatch)
// and the M5 Class E amendment (+hint-conflict, +hint-loose-foot,
// +duplicate-corners, +corners-not-coplanar, +non-convex-corners); old labels untouched
assert.deepStrictEqual(Object.keys(R.REASON_LABELS).sort(), ['ambiguous-pairing', 'corners-not-coplanar', 'coverage-failed', 'duplicate-corners', 'hint-conflict', 'hint-loose-foot', 'missing-view', 'name-mismatch', 'no-closed-profile', 'non-convex-corners', 'non-convex-profile', 'non-manifold', 'unmatched-edge', 'unmatched-point', 'unsupported-curves', 'x-mismatch']);
eq(R.REASON_LABELS['unsupported-curves'], 'curves not supported yet');
var allowed20 = { 'x-mismatch': 1, 'name-mismatch': 1, 'unmatched-edge': 1, 'unmatched-point': 1, 'ambiguous-pairing': 1, 'coverage-failed': 1, 'non-manifold': 1, 'unsupported-curves': 1, 'missing-view': 1 };
[r3, r4, r5, r7b, r9, r10a, r10b, r13, r14].forEach(function (r) {
  ok(allowed20[r.reason], 'known reason ' + r.reason);
});
pass('phase13 failure hygiene no new reasons');

// 21 determinism: cone and 3-view reorder plus rerun identical
var a21 = R.reconstruct(coneEnts);
var b21 = R.reconstruct(coneEnts.slice().reverse());
assert.deepStrictEqual(a21.geometry, b21.geometry);
var sheet21 = C.threeViewSheet({ solid: 'CYLINDER', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
assert.deepStrictEqual(R.reconstruct(sheet21).geometry, R.reconstruct(sheet21.slice().reverse()).geometry);
assert.deepStrictEqual(R.reconstruct(sheet21), R.reconstruct(sheet21));
pass('phase13 cone 3-view deterministic');

// 22 round-trip: D projections cover drawn silhouettes
function distPtSegT(px, py, a, b) {
  var dx = b.x - a.x, dy = b.y - a.y;
  var l2 = dx * dx + dy * dy;
  var t = l2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  var cx = a.x + t * dx - px, cy = a.y + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}
function nearAnySeg(px, py, segs, tol) {
  for (var i = 0; i < segs.length; i++) {
    if (distPtSegT(px, py, segs[i].a, segs[i].b) <= tol) return true;
  }
  return false;
}
[cylEnts, coneEnts].forEach(function (ents, idx) {
  var res = R.reconstruct(ents);
  eq(res.status, 'ok');
  var proj = R.projectToViews(res.geometry);
  var kept = R.filterEntities(ents).kept;
  var cls = R.classifyViews(kept);
  var tol = 0.6;
  cls.elev.forEach(function (e) {
    if (e.type === 'POINT') {
      var found = proj.elevPts.some(function (p) {
        return Math.abs(p.x - e.x) <= tol && Math.abs(p.y - e.y) <= tol;
      }) || nearAnySeg(e.x, e.y, proj.elevSegs, tol);
      ok(found, 'elev point covered ' + idx);
      return;
    }
    for (var k = 0; k < 9; k++) {
      var t = k / 8;
      var px = e.x + (e.x2 - e.x) * t, py = e.y + (e.y2 - e.y) * t;
      if (e.bisCode === 'E') {
        var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        proj.elevSegs.forEach(function (s) {
          [s.a, s.b].forEach(function (p) {
            if (p.x < x0) x0 = p.x;
            if (p.x > x1) x1 = p.x;
            if (p.y < y0) y0 = p.y;
            if (p.y > y1) y1 = p.y;
          });
        });
        ok(px >= x0 - tol && px <= x1 + tol && py >= y0 - tol && py <= y1 + tol, 'hidden inside');
      } else {
        ok(nearAnySeg(px, py, proj.elevSegs, tol), 'elev outline covered ' + idx);
      }
    }
  });
});
pass('phase13 D round-trip holds');

// 23 circumcircle exact on axis points
var c23 = Cv.circleFromThreePoints({ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 });
eq(c23.ok, true);
eq(c23.kind, 'circumcircle');
near(c23.x, 0, 1e-9, 'cx');
near(c23.y, 0, 1e-9, 'cy');
near(c23.r, 1, 1e-9, 'r');
pass('phase13 circumcircle exact axes');

// 24 stable on rotated triples (same circle, permuted order)
function rotPt(px, py, deg) {
  var a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { x: px * c - py * s, y: px * s + py * c };
}
var base24 = [{ x: 10, y: 0 }, { x: -5, y: 8.660254037844387 }, { x: -5, y: -8.660254037844387 }];
var c24a = Cv.circleFromThreePoints(base24[0], base24[1], base24[2]);
eq(c24a.ok, true);
near(c24a.x, 0, 1e-9, 'rot cx');
near(c24a.y, 0, 1e-9, 'rot cy');
near(c24a.r, 10, 1e-9, 'rot r');
var rot24 = base24.map(function (p) { return rotPt(p.x, p.y, 30); });
var c24b = Cv.circleFromThreePoints(rot24[2], rot24[0], rot24[1]);
eq(c24b.ok, true);
near(c24b.x, 0, 1e-9, 'rot2 cx');
near(c24b.y, 0, 1e-9, 'rot2 cy');
near(c24b.r, 10, 1e-9, 'rot2 r');
pass('phase13 circumcircle stable rotated');

// 25 collinear policy: centered fallback, skewed rejected, NaN guarded
var c25a = Cv.circleFromThreePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 });
eq(c25a.ok, true);
eq(c25a.kind, 'centered');
near(c25a.x, 5, 1e-9, 'mid x');
near(c25a.r, 5, 1e-9, 'half span');
var c25b = Cv.circleFromThreePoints({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 8, y: 0 });
eq(c25b.ok, false);
eq(c25b.reason, 'collinear');
var c25c = Cv.circleFromThreePoints({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 });
eq(c25c.ok, false);
assert.throws(function () {
  Cv.circleFromThreePoints({ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 });
}, Error);
pass('phase13 collinear centered rejected');

// 26 pick list toggles in order and clears
var pk26 = Cv.createCirclePickState();
eq(pk26.picks.length, 0);
Cv.toggleCirclePick(pk26, 'a', 0, 0);
Cv.toggleCirclePick(pk26, 'b', 10, 0);
Cv.toggleCirclePick(pk26, 'c', 5, 8);
eq(pk26.picks.length, 3);
eq(pk26.picks.map(function (p) { return p.id; }).join(','), 'a,b,c');
Cv.toggleCirclePick(pk26, 'b', 10, 0);
eq(pk26.picks.map(function (p) { return p.id; }).join(','), 'a,c');
Cv.toggleCirclePick(pk26, 'd', 1, 1);
eq(pk26.picks.map(function (p) { return p.id; }).join(','), 'a,c,d');
Cv.clearCirclePicks(pk26);
eq(pk26.picks.length, 0);
eq(Cv.CIRCLE_PICK_MAX, 3);
pass('phase13 pick list toggles clears');

// 27 auto-commit simulation emits CIRCLE with role BIS radius
E.resetIdCounter();
var t27 = E.createTable();
var a27 = t27.create('POINT', { x: 17.5, y: -25.5 });
var b27 = t27.create('POINT', { x: 0, y: -8 });
var c27 = t27.create('POINT', { x: -17.5, y: -25.5 });
var pk27 = Cv.createCirclePickState();
Cv.toggleCirclePick(pk27, a27.id, a27.x, a27.y);
Cv.toggleCirclePick(pk27, b27.id, b27.x, b27.y);
Cv.toggleCirclePick(pk27, c27.id, c27.x, c27.y);
eq(pk27.picks.length, 3);
var g27 = Cv.circleFromThreePoints(pk27.picks[0], pk27.picks[1], pk27.picks[2]);
eq(g27.ok, true);
near(g27.x, 0, 1e-9, 'gest cx');
near(g27.y, -25.5, 1e-9, 'gest cy');
near(g27.r, 17.5, 1e-9, 'gest r');
var rMin27 = E.RADIUS_MIN_MM;
var rr27 = g27.r < rMin27 ? rMin27 : g27.r;
var circ27 = t27.create('CIRCLE', {
  x: g27.x, y: g27.y, radius: rr27, bisCode: 'A',
  viewRole: g27.y >= 0 ? 'ELEVATION' : 'PLAN'
});
eq(circ27.bisCode, 'A');
eq(circ27.viewRole, 'PLAN');
ok(circ27.radius >= rMin27, 'clamped');
Cv.clearCirclePicks(pk27);
eq(pk27.picks.length, 0);
var up27 = Cv.circleFromThreePoints({ x: 1, y: 20 }, { x: 0, y: 21 }, { x: -1, y: 20 });
eq(up27.ok, true);
eq(up27.y >= 0 ? 'ELEVATION' : 'PLAN', 'ELEVATION');
pass('phase13 commit emits circle role bis');

// 28 armed-tool precedence preserved (legacy anchor wins, picks idle-only)
var lt28 = Cv.createLineToolState();
eq(Cv.isLineToolActive(lt28), false);
Cv.anchorLineTool(lt28, 'p1', 0, 0);
eq(Cv.isLineToolActive(lt28), true);
var src28 = fs.readFileSync('mirror/index.html', 'utf8');
ok(src28.indexOf('isLineToolActive(handle.line)') !== -1, 'line guard wired');
ok(src28.indexOf('isPolarToolActive(handle.polar)') !== -1, 'polar guard wired');
ok(src28.indexOf('toggleCirclePick(handle.circlePicks') !== -1, 'picks wired idle');
pass('phase13 precedence armed wins');

// 29 clears wired: bank drops through one cursor-safe helper
var src29 = fs.readFileSync('mirror/index.html', 'utf8');
ok(src29.split('clearBank();').length - 1 >= 5, 'clears wired');
ok(src29.indexOf('drawKnockoutLabel(ctx2, String(cpi + 1)') !== -1, 'numerals wired');
pass('phase13 clears numerals wired');

// 30 gesture-drawn plan circle plus hand silhouette reconstructs Class D
var gest30 = Cv.circleFromThreePoints({ x: 17.5, y: -25.5 }, { x: 0, y: -8 }, { x: -17.5, y: -25.5 });
eq(gest30.ok, true);
var ents30 = [
  { type: 'CIRCLE', x: gest30.x, y: gest30.y, x2: 0, y2: 0, radius: gest30.r, bisCode: 'A', viewRole: 'PLAN' },
  pt(0, -25.5, 'PLAN', 'B'),
  seg(-17.5, 0, 17.5, 0, 'ELEVATION', 'A'),
  seg(17.5, 0, 17.5, 70, 'ELEVATION', 'A'),
  seg(17.5, 70, -17.5, 70, 'ELEVATION', 'A'),
  seg(-17.5, 70, -17.5, 0, 'ELEVATION', 'A')
];
var r30 = R.reconstruct(ents30);
eq(r30.status, 'ok');
eq(r30.class, 'D');
eq(r30.geometry.vertices.length, 48);
pass('phase13 gesture ties to Class D');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase13-curves tests passed');

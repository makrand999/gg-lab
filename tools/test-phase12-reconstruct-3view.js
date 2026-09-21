'use strict';
var assert = require('assert');
var R = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');

var TOTAL = 30;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

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
function rect(x0, y0, x1, y1, role) {
  return [
    seg(x0, y0, x1, y0, role), seg(x1, y0, x1, y1, role),
    seg(x1, y1, x0, y1, role), seg(x0, y1, x0, y0, role)
  ];
}
function box3() {
  return rect(0, -40, 30, -10).concat(rect(0, 5, 30, 50), rect(100, 5, 130, 50));
}

// 1 PROFILE role is valid in entities + curriculum; invalid still throws
ok(E.VIEW_ROLES.indexOf('PROFILE') !== -1, 'entities roles');
ok(C.VIEW_ROLES.indexOf('PROFILE') !== -1, 'curriculum roles');
eq(E.createEntity('POINT', { x: 1, y: 2, viewRole: 'PROFILE' }).viewRole, 'PROFILE');
throws(function () { E.createEntity('POINT', { x: 1, y: 2, viewRole: 'NOPE' }); });
var badBundle = {
  entities: [{
    type: 'POINT', x: 1, y: 2, x2: 0, y2: 0, radius: 0,
    startAngle: 0, endAngle: 0, bisCode: 'B', viewRole: 'NOPE'
  }],
  steps: ['s'], loci: ['l']
};
eq(C.validateBundle(badBundle).ok, false);
pass('phase12 PROFILE role additive');
// 2 tagged PROFILE buckets directly, above or below XY
var c2 = R.classifyViews([
  seg(0, -10, 5, -10, 'PLAN'), seg(0, 10, 5, 10, 'ELEVATION'),
  seg(100, 5, 130, 5, 'PROFILE'), seg(100, -30, 130, -30, 'PROFILE')
]);
eq(c2.plan.length, 1);
eq(c2.elev.length, 1);
eq(c2.profile.length, 2);
eq(c2.onDatum.length, 0);
eq(c2.droppedHelpers.length, 0);
pass('phase12 tagged PROFILE direct bucket');
// 3 untagged 3-view box splits 4/4/4 by plan-x overlap
var c3 = R.classifyViews(box3());
eq(c3.plan.length, 4);
eq(c3.elev.length, 4);
eq(c3.profile.length, 4);
eq(c3.onDatum.length, 0);
eq(c3.droppedHelpers.length, 0);
pass('phase12 untagged box splits 4/4/4');
// 4 single upper cluster reads exactly as legacy two-view
var two = rect(0, -40, 30, -10).concat(rect(0, 5, 30, 50));
var c4 = R.classifyViews(two);
eq(c4.plan.length, 4);
eq(c4.elev.length, 4);
eq(c4.profile.length, 0);
eq(c4.droppedHelpers.length, 0);
c4.plan.forEach(function (e) { ok(e.y < 0 && e.y2 < 0, 'plan below XY'); });
c4.elev.forEach(function (e) { ok(e.y > 0 && e.y2 > 0, 'elev above XY'); });
pass('phase12 one upper cluster stays two-view');
// 5 untagged horizontal projectors drop; tagged axis already filtered
var f5 = R.filterEntities(box3().concat([
  seg(30, 5, 100, 5), seg(30, 50, 100, 50),
  seg(100, 0, 100, 50, 'BOTH', 'G', { meta: { kind: 'axis' } }),
  { type: 'DATUM_AXIS', x: -50, y: 0, x2: 160, y2: 0, bisCode: 'G', viewRole: 'BOTH' }
]));
eq(f5.dropped.meta, 1);
eq(f5.dropped.type, 1);
var c5 = R.classifyViews(f5.kept);
eq(c5.plan.length, 4);
eq(c5.elev.length, 4);
eq(c5.profile.length, 4);
eq(c5.droppedHelpers.length, 2);
pass('phase12 span projectors dropped');
// 6 untagged 45-degree miter drops without widening the plan anchor
var c6 = R.classifyViews(box3().concat([seg(100, 0, 135, -35)]));
eq(c6.plan.length, 4);
eq(c6.elev.length, 4);
eq(c6.profile.length, 4);
eq(c6.droppedHelpers.length, 1);
eq(c6.droppedHelpers[0].x, 100);
pass('phase12 miter dropped anchor intact');
// 7 solid 45-degree plan slants are kept while a real miter drops
var pyrPlan = rect(0, -40, 30, -10).concat([
  seg(0, -40, 15, -25), seg(30, -40, 15, -25),
  seg(30, -10, 15, -25), seg(0, -10, 15, -25)
]);
var c7 = R.classifyViews(pyrPlan.concat(rect(0, 5, 30, 50), rect(100, 5, 130, 50),
  [seg(100, 0, 135, -35)]));
eq(c7.plan.length, 8);
eq(c7.elev.length, 4);
eq(c7.profile.length, 4);
eq(c7.droppedHelpers.length, 1);
pass('phase12 plan slants kept miter dropped');
// 8 point-only untagged cluster falls back to the legacy reading
var c8 = R.classifyViews([pt(10, -15), pt(10, 20), pt(200, 20)]);
eq(c8.plan.length, 1);
eq(c8.elev.length, 2);
eq(c8.profile.length, 0);
eq(c8.droppedHelpers.length, 0);
pass('phase12 point-only cluster needs tags');
// 9 tagged PROFILE point buckets even without any segment
var c9 = R.classifyViews([pt(10, -15, 'PLAN'), pt(10, 20, 'ELEVATION'), pt(200, 20, 'PROFILE')]);
eq(c9.plan.length, 1);
eq(c9.elev.length, 1);
eq(c9.profile.length, 1);
pass('phase12 tagged profile point buckets');
// 10 shifted elevation keeps the legacy x-mismatch path (buckets + verdict)
function shiftedBox(dx) {
  return rect(0, -40, 30, -10).concat(rect(dx, 5, 30 + dx, 50));
}
var c10 = R.classifyViews(shiftedBox(1.2));
eq(c10.plan.length, 4);
eq(c10.elev.length, 4);
eq(c10.profile.length, 0);
var r10 = R.reconstruct(shiftedBox(1.2));
eq(r10.status, 'unavailable');
eq(r10.reason, 'x-mismatch');
pass('phase12 shifted elev still x-mismatch');
// 11 a stray elevation diagonal is kept as solid, never a helper
var c11 = R.classifyViews(box3().concat([seg(0, 5, 30, 50)]));
eq(c11.elev.length, 5);
eq(c11.profile.length, 4);
eq(c11.droppedHelpers.length, 0);
pass('phase12 stray diagonal kept solid');
// 12 weld tolerance accepts an optional profile extent
var cls12 = R.classifyViews(box3());
var t2 = R.weldTolerance(cls12.plan, cls12.elev);
var t3 = R.weldTolerance(cls12.plan, cls12.elev, cls12.profile);
ok(Number.isFinite(t3), 'finite');
ok(t3 > t2, 'profile widens the span');
eq(R.weldTolerance(cls12.plan, cls12.elev, undefined), t2);
pass('phase12 weld tolerance takes profile');

// 13 tagged 3-view box with helpers resolves, class A, triple coverage
function box3Tagged() {
  return rect(0, -40, 30, -10, 'PLAN')
    .concat(rect(0, 5, 30, 50, 'ELEVATION'))
    .concat(rect(100, 5, 130, 50, 'PROFILE'))
    .concat([
      seg(30, 5, 100, 5), seg(30, 50, 100, 50),
      seg(100, 0, 135, -35),
      seg(100, 0, 100, 50, 'BOTH', 'G', { meta: { kind: 'axis' } }),
      { type: 'DATUM_AXIS', x: -50, y: 0, x2: 160, y2: 0, bisCode: 'G', viewRole: 'BOTH' }
    ]);
}
var r13 = R.reconstruct(box3Tagged());
eq(r13.status, 'ok');
eq(r13.class, 'A');
eq(r13.geometry.vertices.length, 8);
eq(r13.geometry.edges.length, 12);
eq(r13.geometry.faces.length, 6);
eq(r13.coverage.plan, 1);
eq(r13.coverage.elev, 1);
eq(r13.coverage.profile, 1);
pass('phase12 tagged box ok triple cover');
// 14 same box untagged resolves identically
var r14 = R.reconstruct(box3().concat([
  seg(30, 5, 100, 5), seg(30, 50, 100, 50), seg(100, 0, 135, -35)
]));
eq(r14.status, 'ok');
eq(r14.class, 'A');
eq(r14.geometry.vertices.length, 8);
eq(r14.geometry.edges.length, 12);
eq(r14.coverage.profile, 1);
assert.deepStrictEqual(r14.geometry, r13.geometry);
pass('phase12 untagged box identical solid');
// 15 curriculum hex prism sheet: 12v/18e at drawn proportions
var hex3 = C.threeViewSheet({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
eq(C.validateBundle(hex3).ok, true);
var r15 = R.reconstruct(hex3.entities);
eq(r15.status, 'ok');
eq(r15.class, 'A');
eq(r15.geometry.vertices.length, 12);
eq(r15.geometry.edges.length, 18);
eq(r15.geometry.faces.length, 8);
eq(r15.coverage.profile, 1);
var hx15 = r15.geometry.vertices.map(function (v) { return v.x; });
var hy15 = r15.geometry.vertices.map(function (v) { return v.y; });
ok(Math.abs(Math.max.apply(null, hx15) - Math.min.apply(null, hx15) - 35) < 1e-9, 'across corners');
ok(Math.abs(Math.max.apply(null, hy15) - Math.min.apply(null, hy15) - 70) < 1e-9, 'height');
pass('phase12 hex prism sheet 12v 18e');
// 16 curriculum pyramid sheet resolves with apex
var pyr3 = C.threeViewSheet({ solid: 'PYRAMID', sizeMm: 35, heightMm: 70, xMm: 0 });
eq(C.validateBundle(pyr3).ok, true);
var r16 = R.reconstruct(pyr3.entities);
eq(r16.status, 'ok');
eq(r16.class, 'B');
eq(r16.geometry.vertices.length, 5);
eq(r16.geometry.edges.length, 8);
eq(r16.geometry.faces.length, 5);
eq(r16.coverage.profile, 1);
var apex16 = r16.geometry.vertices[r16.geometry.vertices.length - 1];
ok(Math.abs(apex16.x - 0) < 1e-9, 'apex x');
ok(Math.abs(apex16.y - 70) < 1e-9, 'apex h');
ok(Math.abs(apex16.z - 25.5) < 1e-9, 'apex d');
pass('phase12 pyramid sheet apex');
// 17 asymmetric apex picks direct vs mirrored deterministically
function asymPyramid(profApexX) {
  return rect(0, -40, 30, -10, 'PLAN')
    .concat([
      pt(15, -15, 'PLAN'),
      seg(0, -40, 15, -15, 'PLAN'), seg(30, -40, 15, -15, 'PLAN')
    ])
    .concat([
      seg(0, 5, 30, 5, 'ELEVATION'),
      seg(0, 5, 15, 50, 'ELEVATION'), seg(30, 5, 15, 50, 'ELEVATION'),
      pt(15, 50, 'ELEVATION')
    ])
    .concat([
      seg(100, 5, 130, 5, 'PROFILE'),
      seg(100, 5, profApexX, 50, 'PROFILE'),
      seg(130, 5, profApexX, 50, 'PROFILE'),
      pt(profApexX, 50, 'PROFILE')
    ]);
}
var r17a = R.reconstruct(asymPyramid(105));
eq(r17a.status, 'ok');
eq(r17a.class, 'B');
eq(r17a.stats.profileMap.s, 1);
var r17b = R.reconstruct(asymPyramid(125));
eq(r17b.status, 'ok');
eq(r17b.class, 'B');
eq(r17b.stats.profileMap.s, -1);
assert.deepStrictEqual(R.reconstruct(asymPyramid(125)).geometry, r17b.geometry);
pass('phase12 orientation picked deterministically');
// 18 wrong-depth profile fails named, never a wrong solid
var r18 = R.reconstruct(
  rect(0, -40, 30, -10, 'PLAN')
    .concat(rect(0, 5, 30, 50, 'ELEVATION'))
    .concat(rect(100, 5, 120, 50, 'PROFILE'))
);
eq(r18.status, 'unavailable');
eq(r18.reason, 'x-mismatch');
pass('phase12 wrong depth x-mismatch');
// 19 wrong-height profile fails named
var r19 = R.reconstruct(
  rect(0, -40, 30, -10, 'PLAN')
    .concat(rect(0, 5, 30, 50, 'ELEVATION'))
    .concat(rect(100, 5, 130, 60, 'PROFILE'))
);
eq(r19.status, 'unavailable');
eq(r19.reason, 'unmatched-edge');
pass('phase12 wrong height unmatched-edge');
// 20 projectToViews maps the profile; one-arg shape unchanged
var p20a = R.projectToViews(r13.geometry);
assert.deepStrictEqual(Object.keys(p20a).sort(),
  ['elevPts', 'elevSegs', 'planPts', 'planSegs']);
var p20b = R.projectToViews(r13.geometry, { xRef: 100, s: 1, dRef: 10 });
eq(p20b.profilePts.length, 8);
eq(p20b.profileSegs.length, 12);
function hasPt(pts, x, y) {
  return pts.some(function (p) { return p.x === x && p.y === y; });
}
ok(hasPt(p20b.profilePts, 100, 5), 'near-bottom maps to xRef');
ok(hasPt(p20b.profilePts, 130, 50), 'far-top maps outboard');
throws(function () {
  R.projectToViews(r13.geometry, { xRef: NaN, s: 1, dRef: 10 });
});
pass('phase12 projectToViews profile map');
// 21 coverage shape: profile key only with a profile view
eq(r13.coverage.profile, 1);
var r21 = R.reconstruct(rect(0, -40, 30, -10).concat(rect(0, 5, 30, 50)));
eq(r21.coverage.plan, 1);
eq(r21.coverage.elev, 1);
eq(r21.coverage.profile, undefined);
pass('phase12 coverage shape compatible');
// 22 helpers-ignored warns only when helpers drop
ok(r13.warnings.map(function (w) { return w.code; }).indexOf('helpers-ignored') !== -1,
  'helpers warned');
assert.deepStrictEqual(r21.warnings, []);
pass('phase12 helpers warning gated');
// 23 threeViewSheet guards its domain (M3: cylinders/cones join prisms/pyramids)
throws(function () { C.threeViewSheet({ solid: 'NOPE' }); });
throws(function () { C.threeViewSheet({ solid: 'PRISM', side: 0 }); });
eq(C.threeViewSheet({ solid: 'CYLINDER' }).solid, 'CYLINDER');
eq(C.threeViewSheet({ solid: 'CONE' }).solid, 'CONE');
var mir23 = C.threeViewSheet({ solid: 'PRISM', side: -1 });
eq(mir23.side, -1);
eq(R.reconstruct(mir23.entities).status, 'ok');
pass('phase12 threeViewSheet guards mirror');

// 24 3-view straight line resolves, class C, true length kept
function lineProfile(mirror) {
  var DROP = { projector: 1, locus: 1, axis: 1 };
  var bundle = C.straightLine({ TL: 80, thetaDeg: 30, phiDeg: 45 });
  function solidSeg(role) {
    return bundle.entities.filter(function (e) {
      return e.viewRole === role && e.type === 'SEGMENT' && e.bisCode === 'A' &&
        !(e.meta && DROP[e.meta.kind]);
    })[0];
  }
  var plan = solidSeg('PLAN'), elev = solidSeg('ELEVATION');
  var d0 = Math.min(-plan.y, -plan.y2), d1 = Math.max(-plan.y, -plan.y2);
  var p0 = 100, p1 = 100 + (d1 - d0);
  function X(d) { return mirror ? p1 - (d - d0) : p0 + (d - d0); }
  function H(x) { return Math.abs(x - plan.x) < 1e-9 ? elev.y : elev.y2; }
  var ax = X(-plan.y), ay = H(plan.x), bx = X(-plan.y2), by = H(plan.x2);
  return bundle.entities.concat([
    { type: 'SEGMENT', x: ax, y: ay, x2: bx, y2: by, bisCode: 'A', viewRole: 'PROFILE' },
    { type: 'POINT', x: ax, y: ay, bisCode: 'B', viewRole: 'PROFILE' },
    { type: 'POINT', x: bx, y: by, bisCode: 'B', viewRole: 'PROFILE' }
  ]);
}
function trueLen(verts) {
  var a = verts[0], b = verts[1];
  return Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) +
    (b.z - a.z) * (b.z - a.z));
}
var r24 = R.reconstruct(lineProfile(false));
eq(r24.status, 'ok');
eq(r24.class, 'C');
eq(r24.geometry.vertices.length, 2);
eq(r24.geometry.edges.length, 1);
eq(r24.coverage.profile, 1);
ok(Math.abs(trueLen(r24.geometry.vertices) - 80) < 1e-6, 'true length');
eq(r24.stats.profileMap.s, 1);
pass('phase12 wireframe line ok TL kept');
// 25 3-view quadrant point resolves on a single profile point
var qp25 = C.quadrantPoint({ quadrant: 1 });
var r25 = R.reconstruct(qp25.entities.concat([pt(100, 20, 'PROFILE')]));
eq(r25.status, 'ok');
eq(r25.class, 'C');
assert.deepStrictEqual(r25.geometry.vertices, [{ x: 10, y: 20, z: 15 }]);
eq(r25.coverage.profile, 1);
pass('phase12 wireframe point ok');
// 26 mirrored line profile resolves with s = -1, same solid
var r26 = R.reconstruct(lineProfile(true));
eq(r26.status, 'ok');
eq(r26.class, 'C');
eq(r26.stats.profileMap.s, -1);
ok(Math.abs(trueLen(r26.geometry.vertices) - 80) < 1e-6, 'true length');
assert.deepStrictEqual(r26.geometry, r24.geometry);
pass('phase12 mirrored wireframe same solid');
// 27 twin profile points (both orientations drawn) fail named
var twin27 = lineProfile(false);
var plan27y = twin27.filter(function (e) {
  return e.viewRole === 'PLAN' && e.type === 'SEGMENT' && e.bisCode === 'A';
})[0];
var d0_27 = Math.min(-plan27y.y, -plan27y.y2);
var d1_27 = Math.max(-plan27y.y, -plan27y.y2);
var p1_27 = 100 + (d1_27 - d0_27);
twin27 = twin27.concat([
  pt(p1_27 - (10 - d0_27), 20, 'PROFILE'),
  pt(p1_27 - (d1_27 - d0_27), 60, 'PROFILE')
]);
var r27 = R.reconstruct(twin27);
eq(r27.status, 'unavailable');
eq(r27.reason, 'unmatched-point');
pass('phase12 twin profile points unmatched');
// 28 twin plan/elev pairings stay ambiguous with a profile present
var r28 = R.reconstruct([
  pt(10, -20, 'PLAN'), pt(10, -25, 'PLAN'),
  pt(10, 20, 'ELEVATION'), pt(10, 30, 'ELEVATION'),
  pt(100, 20, 'PROFILE'), pt(100, 30, 'PROFILE')
]);
eq(r28.status, 'unavailable');
eq(r28.reason, 'ambiguous-pairing');
pass('phase12 twin pairing ambiguous');
// 29 stray profile edge is unmatched, never absorbed
var stray29 = lineProfile(false).concat([
  seg(100, 60, 156.5685424949238, 20, 'PROFILE', 'A')
]);
var r29 = R.reconstruct(stray29);
eq(r29.status, 'unavailable');
eq(r29.reason, 'unmatched-edge');
pass('phase12 stray profile edge unmatched');
// 30 curves stay deferred on a 3-view sheet
var r30 = R.reconstruct(box3Tagged().concat([
  { type: 'CIRCLE', x: 15, y: -25, x2: 0, y2: 0, radius: 5, bisCode: 'A', viewRole: 'PLAN' }
]));
eq(r30.status, 'ok');
eq(r30.class, 'A');
ok(r30.warnings.map(function (w) { return w.code; }).indexOf('curves-ignored') !== -1,
  'curves warned');
pass('phase12 curves deferred in 3-view');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase12-3view tests passed');

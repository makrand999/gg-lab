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
function cpt(x, y, role, caption) {
  return { type: 'POINT', x: x, y: y, bisCode: 'B', viewRole: role, caption: caption };
}
function proj(x, y1, y2) {
  return { type: 'SEGMENT', x: x, y: y1, x2: x, y2: y2,
    bisCode: 'G', viewRole: 'BOTH' };
}
function hasVert(verts, x, y, z) {
  return verts.some(function (v) { return v.x === x && v.y === y && v.z === z; });
}
function canonGeom(g) {
  function vk(v) { return v.x.toFixed(6) + ',' + v.y.toFixed(6) + ',' + v.z.toFixed(6); }
  var vs = g.vertices.map(vk).sort();
  var es = g.edges.map(function (e) {
    var k1 = vk(g.vertices[e[0]]), k2 = vk(g.vertices[e[1]]);
    return k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
  }).sort();
  return JSON.stringify({ v: vs, e: es, f: g.faces.length });
}
// Resting dotted box: 16 corner dots (datum twins included) + 8 sides.
// tagRoles pins strict-side dots to PLAN/ELEVATION, leaving datum twins
// BOTH so the datum wildcard still serves them.
function restingBoxDots(tagRoles) {
  return [
    [0, 0, "A'"], [0, 0, 'A'], [35, 0, "B'"], [35, 0, 'B'],
    [0, 60, "C'"], [0, 0, 'C'], [35, 60, "D'"], [35, 0, 'D'],
    [0, 0, "E'"], [0, -35, 'E'], [35, 0, "F'"], [35, -35, 'F'],
    [0, 60, "G'"], [0, -35, 'G'], [35, 60, "H'"], [35, -35, 'H']
  ].map(function (d) {
    var role = 'BOTH';
    if (tagRoles) role = d[1] > 0 ? 'ELEVATION' : (d[1] < 0 ? 'PLAN' : 'BOTH');
    return cpt(d[0], d[1], role, d[2]);
  });
}
function restingBoxSides() {
  return [
    seg(0, 0, 35, 0), seg(35, 0, 35, 60), seg(35, 60, 0, 60), seg(0, 60, 0, 0),
    seg(0, 0, 35, 0), seg(35, 0, 35, -35), seg(35, -35, 0, -35), seg(0, -35, 0, 0)
  ];
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
// 10 shifted elevation buckets plan/elev; dotless it reads quiet
function shiftedBox(dx) {
  return rect(0, -40, 30, -10).concat(rect(dx, 5, 30 + dx, 50));
}
var c10 = R.classifyViews(shiftedBox(1.2));
eq(c10.plan.length, 4);
eq(c10.elev.length, 4);
eq(c10.profile.length, 0);
var r10 = R.reconstructLive(shiftedBox(1.2));
eq(r10.status, 'unavailable');
eq(r10.reason, 'empty-sketch');
pass('phase12 shifted elev dotless quiet');
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

// 13 tagged resting box lifts 8 corners + 12 edges, unclassified
var r13 = R.reconstructLive(restingBoxDots(true).concat(restingBoxSides(),
  [proj(0, -35, 60), proj(35, -35, 60)]));
eq(r13.status, 'ok');
eq(r13.class, null);
eq(r13.geometry.vertices.length, 8);
eq(r13.geometry.edges.length, 12);
eq(r13.geometry.faces.length, 6); // phase38: closed box infers faces
ok(hasVert(r13.geometry.vertices, 0, 0, 0), 'corner A');
ok(hasVert(r13.geometry.vertices, 0, 60, 35), 'corner G');
pass('phase12 tagged box lifts wire');
// 14 profile ink and helpers never perturb the wire: identical solid
var r14 = R.reconstructLive(restingBoxDots(true).concat(restingBoxSides(), [
  proj(0, -35, 60), proj(35, -35, 60),
  seg(100, 5, 130, 5, 'PROFILE'), seg(130, 5, 130, 60, 'PROFILE'),
  seg(130, 60, 100, 60, 'PROFILE'), seg(100, 60, 100, 5, 'PROFILE'),
  seg(35, 5, 100, 5), seg(100, 0, 100, 60),
  { type: 'DATUM_AXIS', x: -50, y: 0, x2: 160, y2: 0, bisCode: 'G', viewRole: 'BOTH' }
]));
eq(r14.status, 'ok');
assert.deepStrictEqual(r14.geometry, r13.geometry);
pass('phase12 profile helpers ignored');
// 15 two-view and three-view prism sheets lift the identical wire:
// same 12v/18e at drawn proportions, profile adding nothing
var hex2 = C.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
var hex3 = C.threeViewSheet({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
eq(C.validateBundle(hex3).ok, true);
var r15 = R.reconstructLive(hex3.entities);
eq(r15.status, 'ok');
eq(r15.class, null);
eq(r15.geometry.vertices.length, 12);
eq(r15.geometry.edges.length, 18);
eq(r15.geometry.faces.length, 8); // phase38: closed prism infers faces
var r15b = R.reconstructLive(hex2.entities);
assert.deepStrictEqual(r15b.geometry, r15.geometry);
var hx15 = r15.geometry.vertices.map(function (v) { return v.x; });
var hy15 = r15.geometry.vertices.map(function (v) { return v.y; });
ok(Math.abs(Math.max.apply(null, hx15) - Math.min.apply(null, hx15) - 35) < 1e-9, 'across corners');
ok(Math.abs(Math.max.apply(null, hy15) - Math.min.apply(null, hy15) - 70) < 1e-9, 'height');
pass('phase12 hex prism sheet 12v 18e');
// 16 curriculum pyramid sheet resolves with apex (live wireframe:
// same 5 corners + 8 edges, 5 inferred faces since phase38)
var pyr3 = C.threeViewSheet({ solid: 'PYRAMID', sizeMm: 35, heightMm: 70, xMm: 0 });
eq(C.validateBundle(pyr3).ok, true);
var r16 = R.reconstructLive(pyr3.entities);
eq(r16.status, 'ok');
eq(r16.geometry.vertices.length, 5);
eq(r16.geometry.edges.length, 8);
eq(r16.geometry.faces.length, 5); // phase38: closed pyramid infers faces
var apex16 = r16.geometry.vertices[r16.geometry.vertices.length - 1];
ok(Math.abs(apex16.x - 0) < 1e-9, 'apex x');
ok(Math.abs(apex16.y - 70) < 1e-9, 'apex h');
ok(Math.abs(apex16.z - 25.5) < 1e-9, 'apex d');
pass('phase12 pyramid sheet apex');
// 17 the profile apex station never moves the wire: both variants lift
// the same apex from plan + elevation alone
function asymPyramid(profApexX) {
  return rect(0, -40, 30, -10, 'PLAN')
    .concat([
      pt(15, -15, 'PLAN'),
      seg(0, -40, 15, -15, 'PLAN'), seg(30, -40, 15, -15, 'PLAN')
    ])
    .concat([
      seg(0, 5, 30, 5, 'ELEVATION'),
      seg(0, 5, 15, 50, 'ELEVATION'), seg(30, 5, 15, 50, 'ELEVATION'),
      pt(15, 50, 'ELEVATION'), proj(15, -15, 50)
    ])
    .concat([
      seg(100, 5, 130, 5, 'PROFILE'),
      seg(100, 5, profApexX, 50, 'PROFILE'),
      seg(130, 5, profApexX, 50, 'PROFILE'),
      pt(profApexX, 50, 'PROFILE')
    ]);
}
var r17a = R.reconstructLive(asymPyramid(105));
eq(r17a.status, 'ok');
eq(r17a.geometry.vertices.length, 1);
var r17b = R.reconstructLive(asymPyramid(125));
eq(r17b.status, 'ok');
assert.deepStrictEqual(r17b.geometry, r17a.geometry);
assert.deepStrictEqual(r17a.geometry.vertices, [{ x: 15, y: 50, z: 15 }]);
pass('phase12 profile never moves wire');
// 18 a wrong-depth profile never vetoes the wire
var r18 = R.reconstructLive(
  rect(0, -40, 30, -10, 'PLAN')
    .concat(rect(0, 5, 30, 50, 'ELEVATION'))
    .concat([pt(15, -15, 'PLAN'), pt(15, 50, 'ELEVATION'), proj(15, -15, 50)])
    .concat(rect(100, 5, 120, 50, 'PROFILE'))
);
eq(r18.status, 'ok');
assert.deepStrictEqual(r18.geometry.vertices, [{ x: 15, y: 50, z: 15 }]);
pass('phase12 wrong depth never vetoes');
// 19 a wrong-height profile never vetoes the wire
var r19 = R.reconstructLive(
  rect(0, -40, 30, -10, 'PLAN')
    .concat(rect(0, 5, 30, 50, 'ELEVATION'))
    .concat([pt(15, -15, 'PLAN'), pt(15, 50, 'ELEVATION'), proj(15, -15, 50)])
    .concat(rect(100, 5, 130, 60, 'PROFILE'))
);
eq(r19.status, 'ok');
assert.deepStrictEqual(r19.geometry.vertices, [{ x: 15, y: 50, z: 15 }]);
pass('phase12 wrong height never vetoes');
// 20 projectToViews maps the profile; one-arg shape unchanged
var box20 = {
  vertices: [{ x: 0, y: 5, z: 10 }, { x: 30, y: 50, z: 40 }],
  edges: [[0, 1]], faces: []
};
var p20a = R.projectToViews(box20);
assert.deepStrictEqual(Object.keys(p20a).sort(),
  ['elevPts', 'elevSegs', 'planPts', 'planSegs']);
var p20b = R.projectToViews(box20, { xRef: 100, s: 1, dRef: 10 });
eq(p20b.profilePts.length, 2);
eq(p20b.profileSegs.length, 1);
function hasPt(pts, x, y) {
  return pts.some(function (p) { return p.x === x && p.y === y; });
}
ok(hasPt(p20b.profilePts, 100, 5), 'near-bottom maps to xRef');
ok(hasPt(p20b.profilePts, 130, 50), 'far-top maps outboard');
throws(function () {
  R.projectToViews(box20, { xRef: NaN, s: 1, dRef: 10 });
});
pass('phase12 projectToViews profile map');
// 21 result shapes: wire is lean, readers carry coverage + warnings
assert.deepStrictEqual(Object.keys(r13).sort(),
  ['class', 'geometry', 'label', 'reason', 'stats', 'status']);
eq(r13.class, null);
eq(r13.coverage, undefined);
eq(r13.warnings, undefined);
var r21 = R.reconstructLive(
  C.regularSolid({ solid: 'CYLINDER', sizeMm: 35, heightMm: 70, xMm: 0 }).entities);
eq(r21.status, 'ok');
eq(r21.class, null);
eq(r21.coverage.plan, 1);
eq(r21.coverage.elev, 1);
assert.deepStrictEqual(r21.warnings, []);
pass('phase12 result shapes compatible');
// 22 a 3-view reader warns helpers-ignored; 2-view warns nothing
var r22cyl = R.reconstructLive(
  C.threeViewSheet({ solid: 'CYLINDER', sizeMm: 35, heightMm: 70, xMm: 0 }).entities);
ok(r22cyl.warnings.map(function (w) { return w.code; }).indexOf('helpers-ignored') !== -1,
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
eq(R.reconstructLive(mir23.entities).status, 'ok');
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
var r24 = R.reconstructLive(lineProfile(false));
eq(r24.status, 'ok');
eq(r24.class, null);
eq(r24.geometry.vertices.length, 2);
eq(r24.geometry.edges.length, 1);
ok(Math.abs(trueLen(r24.geometry.vertices) - 80) < 1e-6, 'true length');
pass('phase12 wireframe line ok TL kept');
// 25 3-view quadrant point resolves, the profile dot ignored
var qp25 = C.quadrantPoint({ quadrant: 1 });
var r25 = R.reconstructLive(qp25.entities.concat([pt(100, 20, 'PROFILE')]));
eq(r25.status, 'ok');
eq(r25.class, null);
assert.deepStrictEqual(r25.geometry.vertices, [{ x: 10, y: 20, z: 15 }]);
pass('phase12 wireframe point ok');
// 26 mirrored line profile lifts the identical wire
var r26 = R.reconstructLive(lineProfile(true));
eq(r26.status, 'ok');
eq(r26.class, null);
ok(Math.abs(trueLen(r26.geometry.vertices) - 80) < 1e-6, 'true length');
assert.deepStrictEqual(r26.geometry, r24.geometry);
pass('phase12 mirrored wireframe same solid');
// 27 twin profile points are ignored, never evidence
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
var r27 = R.reconstructLive(twin27);
eq(r27.status, 'ok');
assert.deepStrictEqual(r27.geometry, r24.geometry);
pass('phase12 twin profile points ignored');
// 28 twin plan/elev pairings stay 2D-only with a profile present
var r28 = R.reconstructLive([
  pt(10, -20, 'PLAN'), pt(10, -25, 'PLAN'),
  pt(10, 20, 'ELEVATION'), pt(10, 30, 'ELEVATION'),
  pt(100, 20, 'PROFILE'), pt(100, 30, 'PROFILE')
]);
eq(r28.status, 'unavailable');
eq(r28.reason, 'empty-sketch');
pass('phase12 twin pairing quiet');
// 29 stray profile edge is ignored, never absorbed
var stray29 = lineProfile(false).concat([
  seg(100, 60, 156.5685424949238, 20, 'PROFILE', 'A')
]);
var r29 = R.reconstructLive(stray29);
eq(r29.status, 'ok');
assert.deepStrictEqual(r29.geometry, r24.geometry);
pass('phase12 stray profile edge ignored');
// 30 a stray circle beside a prism reads as prism wire, circle skipped
var r30 = R.reconstructLive(hex2.entities.concat([
  { type: 'CIRCLE', x: 15, y: -25, x2: 0, y2: 0, radius: 5, bisCode: 'A', viewRole: 'PLAN' }
]));
eq(r30.status, 'ok');
eq(r30.class, null);
eq(r30.geometry.vertices.length, 12);
eq(r30.geometry.edges.length, 18);
eq(r30.warnings, undefined);
pass('phase12 stray circle skipped');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase12-3view tests passed');

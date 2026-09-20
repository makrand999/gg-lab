'use strict';
var assert = require('assert');
var fs = require('fs');
var R = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');
var S = require('../mirror/files/www.geogebra.org/educad-solid.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');

var TOTAL = 44;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
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
function planRect(x0, y0, x1, y1) {
  return [
    seg(x0, y0, x1, y0), seg(x1, y0, x1, y1),
    seg(x1, y1, x0, y1), seg(x0, y1, x0, y0)
  ];
}
function elevRect(x0, y0, x1, y1) {
  return planRect(x0, y0, x1, y1);
}
function boxBoth() {
  return planRect(0, -40, 30, -10).concat(elevRect(0, 5, 30, 50));
}

// 1 loads, mm units, version 10.x
eq(R.WORLD_UNITS, 'mm');
ok(/^10\./.test(R.VERSION), 'version ' + R.VERSION);
pass('phase10 loads mm v10');
// 2 zero deps + dual-env markers
var src = fs.readFileSync('mirror/files/www.geogebra.org/educad-reconstruct.js', 'utf8');
eq(src.indexOf('require('), -1);
ok(src.indexOf('EduCADReconstruct') !== -1, 'window.EduCADReconstruct marker');
ok(src.indexOf('module.exports') !== -1, 'module.exports marker');
pass('phase10 zero deps dual-env');
// 3 exports present
['filterEntities', 'classifyViews', 'weldTolerance', 'buildViewGraph',
  'convexLoop', 'pointInLoop', 'tryPrism', 'tryPyramid', 'tryWireframe',
  'projectToViews', 'reconstruct', 'REASON_LABELS'].forEach(function (k) {
  ok(R[k] !== undefined, 'export ' + k);
});
eq(R.MATCH_EPS_MM, 0.5);
eq(R.COVERAGE_GATE, 0.999);
pass('phase10 exports constants');
// 4 filter keeps geometry, drops annotation types
var f4 = R.filterEntities([
  seg(0, -10, 5, -10), pt(0, 10),
  { type: 'DIMENSION', x: 0, y: 60, x2: 30, y2: 60, bisCode: 'B', viewRole: 'BOTH' },
  { type: 'TEXT', x: 0, y: 70, x2: 0, y2: 70, bisCode: 'B', viewRole: 'BOTH' },
  { type: 'DATUM_AXIS', x: -50, y: 0, x2: 80, y2: 0, bisCode: 'G', viewRole: 'BOTH' }
]);
eq(f4.kept.length, 2);
eq(f4.dropped.type, 3);
pass('phase10 filter drops dims text datum');
// 5 filter drops projector/locus/axis meta
var f5 = R.filterEntities([
  seg(10, -40, 10, 50, 'BOTH', 'G', { meta: { kind: 'projector' } }),
  seg(-60, 20, 60, 20, 'ELEVATION', 'K', { meta: { kind: 'locus' } }),
  { type: 'LINE', x: 0, y: -50, x2: 0, y2: 60, bisCode: 'G', viewRole: 'BOTH', meta: { kind: 'axis' } },
  seg(0, -10, 5, -10)
]);
eq(f5.kept.length, 1);
eq(f5.dropped.meta, 3);
pass('phase10 filter drops helper meta');
// 6 filter drops XY-crossing sheet-verticals even without meta
var f6 = R.filterEntities([
  seg(20, -40, 20, 50, 'BOTH', 'G', {}),
  seg(21, 5, 21, 50),
  seg(0, -10, 30, -10)
]);
eq(f6.dropped.crossing, 1);
eq(f6.kept.length, 2);
pass('phase10 filter drops crossing verticals');
// 7 invisible skipped, curves set aside
var f7 = R.filterEntities([
  seg(0, -10, 5, -10),
  { type: 'SEGMENT', x: 0, y: 5, x2: 5, y2: 5, bisCode: 'B', viewRole: 'BOTH', visible: false },
  { type: 'CIRCLE', x: 0, y: -25, x2: 0, y2: -25, radius: 17.5, bisCode: 'A', viewRole: 'PLAN' }
]);
eq(f7.kept.length, 1);
eq(f7.dropped.invisible, 1);
eq(f7.curves.length, 1);
pass('phase10 filter invisible curves');
// 8 viewRole wins over position
var c8 = R.classifyViews([
  seg(0, -10, 5, -10, 'ELEVATION'),
  seg(0, 10, 5, 10, 'PLAN')
]);
eq(c8.plan.length, 1);
eq(c8.elev.length, 1);
eq(c8.plan[0].y, 10);
eq(c8.elev[0].y, -10);
pass('phase10 viewRole wins');
// 9 BOTH falls back to y-sign
var c9 = R.classifyViews([seg(0, -10, 5, -10), seg(0, 10, 5, 10)]);
eq(c9.plan.length, 1);
eq(c9.elev.length, 1);
eq(c9.onDatum.length, 0);
pass('phase10 BOTH y-sign fallback');
// 10 on-datum base reads as elevation via variant
var r10 = R.reconstruct(planRect(0, -40, 30, -10).concat([
  seg(0, 0, 30, 0), seg(30, 0, 30, 50), seg(30, 50, 0, 50), seg(0, 50, 0, 0)
]));
eq(r10.status, 'ok');
eq(r10.class, 'A');
eq(r10.stats.variant, 'datum-in-elev');
deep(r10.warnings.map(function (w) { return w.code; }), ['on-datum-placed']);
pass('phase10 on-datum variant placed');
// 11 mapping: Q1 point lifts exactly
var r11 = R.reconstruct([pt(10, -15, 'PLAN'), pt(10, 20, 'ELEVATION')]);
eq(r11.status, 'ok');
deep(r11.geometry.vertices, [{ x: 10, y: 20, z: 15 }]);
pass('phase10 mapping lifts xdh');
// 12 mapping: Q3 negatives never clamped
var r12 = R.reconstruct([pt(10, 15, 'PLAN'), pt(10, -30, 'ELEVATION')]);
eq(r12.status, 'ok');
deep(r12.geometry.vertices, [{ x: 10, y: -30, z: -15 }]);
pass('phase10 mapping keeps negatives');
// 13 hand box (BOTH rects) resolves to a prism
var r13 = R.reconstruct(boxBoth());
eq(r13.status, 'ok');
eq(r13.class, 'A');
eq(r13.geometry.vertices.length, 8);
eq(r13.geometry.edges.length, 12);
eq(r13.geometry.faces.length, 6);
eq(r13.coverage.plan, 1);
eq(r13.coverage.elev, 1);
pass('phase10 hand box prism');
// 14 hex prism demo: 12v/18e at drawn proportions
var hexEnts = C.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
var r14 = R.reconstruct(hexEnts);
eq(r14.status, 'ok');
eq(r14.class, 'A');
eq(r14.geometry.vertices.length, 12);
eq(r14.geometry.edges.length, 18);
eq(r14.geometry.faces.length, 8);
var hx = r14.geometry.vertices.map(function (v) { return v.x; });
var hy = r14.geometry.vertices.map(function (v) { return v.y; });
near(Math.max.apply(null, hx) - Math.min.apply(null, hx), 35, 1e-9, 'across corners');
near(Math.max.apply(null, hy) - Math.min.apply(null, hy), 70, 1e-9, 'height');
pass('phase10 hex prism 12v 18e');
// 15 eps boundary: 0.2 mm shift ok, 1.2 mm shift fails
function shiftedBox(dx) {
  return planRect(0, -40, 30, -10).concat(elevRect(dx, 5, 30 + dx, 50));
}
eq(R.reconstruct(shiftedBox(0.2)).status, 'ok');
var r15 = R.reconstruct(shiftedBox(1.2));
eq(r15.status, 'unavailable');
eq(r15.reason, 'x-mismatch');
pass('phase10 eps boundary x-mismatch');
// 16 L profile reports non-convex, never guessed
var r16 = R.reconstruct([
  seg(0, -40, 30, -40), seg(30, -40, 30, -25), seg(30, -25, 15, -25),
  seg(15, -25, 15, -10), seg(15, -10, 0, -10), seg(0, -10, 0, -40)
].concat(elevRect(0, 5, 30, 50)));
eq(r16.status, 'unavailable');
eq(r16.reason, 'non-convex-profile');
pass('phase10 L profile non-convex');
// 17 stray elevation diagonal is unmatched, not absorbed
var r17 = R.reconstruct(boxBoth().concat([seg(0, 5, 30, 50)]));
eq(r17.status, 'unavailable');
eq(r17.reason, 'unmatched-edge');
pass('phase10 stray edge unmatched');
// 18 stray point is unmatched, not absorbed
var r18 = R.reconstruct(boxBoth().concat([pt(15, 25)]));
eq(r18.status, 'unavailable');
eq(r18.reason, 'unmatched-point');
pass('phase10 stray point unmatched');
// 19 pyramid demo resolves with apex
var pyrEnts = C.regularSolid({ solid: 'PYRAMID', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
var r19 = R.reconstruct(pyrEnts);
eq(r19.status, 'ok');
eq(r19.class, 'B');
eq(r19.geometry.vertices.length, 5);
eq(r19.geometry.edges.length, 8);
eq(r19.geometry.faces.length, 5);
var apex = r19.geometry.vertices[r19.geometry.vertices.length - 1];
near(apex.x, 0, 1e-9, 'apex x');
near(apex.y, 70, 1e-9, 'apex h');
near(apex.z, 25.5, 1e-9, 'apex d');
pass('phase10 pyramid apex');
// 20 pyramid missing a slant is incomplete
var cut20 = pyrEnts.filter(function (e) { return e.caption !== "b1's'"; });
var r20 = R.reconstruct(cut20);
eq(r20.status, 'unavailable');
eq(r20.reason, 'unmatched-edge');
pass('phase10 pyramid missing slant');
// 21 two interior plan points compete for the apex (unit)
var cls21 = R.classifyViews(R.filterEntities(pyrEnts).kept);
var tol21 = R.weldTolerance(cls21.plan, cls21.elev);
var plan21 = R.buildViewGraph(cls21.plan.concat([pt(5, -20, 'PLAN')]), tol21);
var elev21 = R.buildViewGraph(cls21.elev, tol21);
var loop21 = R.convexLoop(plan21, tol21);
var rb21 = R.tryPyramid(plan21, elev21, loop21, R.MATCH_EPS_MM, tol21);
eq(rb21.pass, false);
eq(rb21.reason, 'ambiguous-pairing');
pass('phase10 pyramid twin apex ambiguous');
// 22 quadrant lesson resolves to a 3D point
var r22 = R.reconstruct(C.quadrantPoint({ quadrant: 1 }).entities);
eq(r22.status, 'ok');
eq(r22.class, 'C');
eq(r22.geometry.vertices.length, 1);
eq(r22.geometry.edges.length, 0);
pass('phase10 quadrant point wireframe');
// 23 straight line keeps true length TL in 3D
var r23 = R.reconstruct(C.straightLine({ TL: 80, thetaDeg: 30, phiDeg: 45 }).entities);
eq(r23.status, 'ok');
eq(r23.class, 'C');
eq(r23.geometry.vertices.length, 2);
eq(r23.geometry.edges.length, 1);
var va = r23.geometry.vertices[0], vb = r23.geometry.vertices[1];
var len3 = Math.sqrt((vb.x - va.x) * (vb.x - va.x) + (vb.y - va.y) * (vb.y - va.y) + (vb.z - va.z) * (vb.z - va.z));
near(len3, 80, 1e-6, 'true length');
pass('phase10 line keeps TL');
// 24 collapsed plan pins a vertical edge
var r24 = R.reconstruct(C.straightLine({ TL: 50, thetaDeg: 90, phiDeg: 0 }).entities);
eq(r24.status, 'ok');
eq(r24.geometry.vertices.length, 2);
eq(r24.geometry.edges.length, 1);
var pa = r24.geometry.vertices[0], pb = r24.geometry.vertices[1];
near(pa.x, pb.x, 1e-9, 'pin x');
near(pa.z, pb.z, 1e-9, 'pin d');
ok(Math.abs(pa.y - pb.y) > 1, 'pin spans height');
pass('phase10 degenerate pins vertical');
// 25 two points sharing x are ambiguous
var r25 = R.reconstruct([
  pt(10, -20, 'PLAN'), pt(10, -25, 'PLAN'),
  pt(10, 20, 'ELEVATION'), pt(10, 30, 'ELEVATION')
]);
eq(r25.status, 'unavailable');
eq(r25.reason, 'ambiguous-pairing');
pass('phase10 shared-x ambiguous');
// 26 single-view edge has no mate
var r26 = R.reconstruct([seg(0, -20, 30, -25, 'PLAN'), pt(0, 20, 'ELEVATION')]);
eq(r26.status, 'unavailable');
eq(r26.reason, 'unmatched-edge');
pass('phase10 single-view edge unmatched');
// 27 empty and partial sheets name the missing view
var r27a = R.reconstruct([]);
eq(r27a.status, 'unavailable');
eq(r27a.reason, 'missing-view');
eq(r27a.label, 'empty sheet');
eq(R.reconstruct(planRect(0, -40, 30, -10)).reason, 'missing-view');
pass('phase10 missing-view named');
// 28 cylinder and cone defer curves
eq(R.reconstruct(C.regularSolid({ solid: 'CYLINDER' }).entities).reason, 'unsupported-curves');
eq(R.reconstruct(C.regularSolid({ solid: 'CONE' }).entities).reason, 'unsupported-curves');
pass('phase10 curves deferred');
// 29 deterministic under reorder and rerun
var ents29 = boxBoth();
var a29 = R.reconstruct(ents29);
var b29 = R.reconstruct(ents29.slice().reverse());
deep(a29.geometry, b29.geometry);
deep(R.reconstruct(hexEnts), R.reconstruct(hexEnts));
pass('phase10 deterministic order-free');
// 30 round-trip: projections cover the drawn views (independent check)
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
function nearAnyPt(px, py, pts, tol) {
  for (var i = 0; i < pts.length; i++) {
    var dx = px - pts[i].x, dy = py - pts[i].y;
    if (dx * dx + dy * dy <= tol * tol) return true;
  }
  return false;
}
function checkRoundTrip(ents, tag) {
  var res = R.reconstruct(ents);
  eq(res.status, 'ok', tag + ' resolves');
  var proj = R.projectToViews(res.geometry);
  var kept = R.filterEntities(ents).kept;
  var cls = R.classifyViews(kept);
  var tol = 0.6;
  function check(items, segs, pts, vtag) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    segs.forEach(function (s) {
      [s.a, s.b].forEach(function (p) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      });
    });
    pts.forEach(function (p) {
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    });
    items.forEach(function (e) {
      if (e.type === 'POINT') {
        ok(nearAnySeg(e.x, e.y, segs, tol) || nearAnyPt(e.x, e.y, pts, tol),
          tag + vtag + ' point covered');
        return;
      }
      for (var k = 0; k < 9; k++) {
        var t = k / 8;
        var px = e.x + (e.x2 - e.x) * t, py = e.y + (e.y2 - e.y) * t;
        if (e.bisCode === 'E') {
          ok(px >= x0 - tol && px <= x1 + tol && py >= y0 - tol && py <= y1 + tol,
            tag + vtag + ' hidden inside silhouette');
        } else {
          ok(nearAnySeg(px, py, segs, tol) || nearAnyPt(px, py, pts, tol),
            tag + vtag + ' outline covered');
        }
      }
    });
  }
  check(cls.plan, proj.planSegs, proj.planPts, ':plan');
  check(cls.elev, proj.elevSegs, proj.elevPts, ':elev');
}
checkRoundTrip(hexEnts, 'hex');
checkRoundTrip(pyrEnts, 'pyr');
checkRoundTrip(C.straightLine({ TL: 80, thetaDeg: 30, phiDeg: 45 }).entities, 'line');
checkRoundTrip(boxBoth(), 'box');
pass('phase10 round-trip holds');
// 31 guards: bad eps throws, non-array reads as empty
throws(function () { R.reconstruct(boxBoth(), { eps: 0 }); });
throws(function () { R.reconstruct(boxBoth(), { eps: -1 }); });
eq(R.reconstruct('nope').reason, 'missing-view');
pass('phase10 reconstruct guards');
// 32 default geometry derives the cube constants
var dg = S.defaultGeometry();
deep(dg.faceNormals, S.FACE_NORMALS);
deep(dg.edgeFaces, S.EDGE_FACES);
eq(dg.name, 'cube');
pass('phase10 default geometry is cube');
// 33 createGeometry validates its inputs
throws(function () { S.createGeometry({ vertices: [] }); });
throws(function () { S.createGeometry({ vertices: [{ x: 0, y: 0, z: 0 }], edges: [[0, 1]] }); });
throws(function () { S.createGeometry({ vertices: [{ x: 0, y: 0, z: 0 }], edges: [[0, 0]] }); });
throws(function () { S.createGeometry({ vertices: [{ x: NaN, y: 0, z: 0 }] }); });
throws(function () {
  S.createGeometry({ vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], faces: [[0, 1]] });
});
pass('phase10 createGeometry guards');
// 34 normalization centers, scales, keeps aspect
var nz = S.normalizeGeometry(r14.geometry);
var zx = nz.geometry.vertices.map(function (v) { return v.x; });
var zy = nz.geometry.vertices.map(function (v) { return v.y; });
var zz = nz.geometry.vertices.map(function (v) { return v.z; });
function range(a) { return Math.max.apply(null, a) - Math.min.apply(null, a); }
near(range(zx) > 0 ? (range(zy) / range(zx)) : 0, 2, 1e-9, 'aspect 70/35');
near(Math.max(range(zx), range(zy), range(zz)), 2, 1e-9, 'unit span');
near((Math.max.apply(null, zx) + Math.min.apply(null, zx)) / 2, 0, 1e-9, 'centered x');
var one = S.normalizeGeometry(S.createGeometry({
  vertices: [{ x: 5, y: -3, z: 9 }], edges: [], faces: []
}));
deep(one.geometry.vertices, [{ x: 0, y: 0, z: 0 }]);
eq(one.transform.scale, 1);
pass('phase10 normalize centers scales');
// 35 setGeometry swaps the rendered solid
var st35 = S.createSolidState({});
S.setGeometry(st35, r14.geometry);
eq(st35.geometry.vertices.length, 12);
eq(st35.geometry.name, 'prism');
function MockCtx() {
  return {
    beginPath: function () {}, save: function () {}, restore: function () {},
    moveTo: function () {}, lineTo: function () {}, stroke: function () {},
    arc: function () {}, fill: function () {}, setLineDash: function () {}
  };
}
var c35 = S.render(MockCtx(), st35);
eq(c35.vertices, 12);
eq(c35.front + c35.hidden, 18);
ok(c35.hidden > 0, 'some hidden');
pass('phase10 setGeometry renders hex');
// 36 hex hidden set golden at rest, stable under orbit
var st36 = S.createSolidState({});
S.setGeometry(st36, r14.geometry);
var hid36 = S.classifyEdges(st36).map(function (e, i) { return e.hidden ? i : -1; })
  .filter(function (i) { return i >= 0; });
deep(hid36, [6, 9, 11, 12, 14]);
var mn = 99, mx = 0;
for (var yaw = -3; yaw <= 3.01; yaw += 0.37) {
  for (var pitch = -1.4; pitch <= 1.41; pitch += 0.31) {
    st36.yaw = yaw;
    st36.pitch = pitch;
    var cl = S.classifyEdges(st36);
    eq(cl.length, 18);
    var h = cl.filter(function (e) { return e.hidden; }).length;
    if (h < mn) mn = h;
    if (h > mx) mx = h;
  }
}
eq(mn, 5);
eq(mx, 5);
pass('phase10 hex hidden golden stable');
// 37 unavailable state draws its reason, then recovers
var st37 = S.createSolidState({});
S.setUnavailable(st37, 'missing-view', 'empty sheet');
eq(S.statusOf(st37).available, false);
var texts = [];
var m37 = MockCtx();
m37.fillText = function (t) { texts.push(t); };
var c37 = S.render(m37, st37);
deep(c37, { front: 0, hidden: 0, vertices: 0, unavailable: 'missing-view' });
ok(texts.join(' ').indexOf('3D unavailable') !== -1, 'title drawn');
ok(texts.join(' ').indexOf('empty sheet') !== -1, 'reason drawn');
S.setGeometry(st37, null);
deep(S.render(MockCtx(), st37), { front: 9, hidden: 3, vertices: 8 });
pass('phase10 unavailable draws recovers');
// 38 null geometry restores the cube
var st38 = S.createSolidState({});
S.setGeometry(st38, r14.geometry);
S.setGeometry(st38, null);
eq(st38.geometry, S.defaultGeometry());
pass('phase10 null restores cube');
// 39 state accepts an initial geometry
var st39 = S.createSolidState({ geometry: r14.geometry });
eq(st39.geometry.vertices.length, 12);
pass('phase10 state takes geometry');
// 40 subscription fires every mutation with revision
E.resetIdCounter();
var t40 = E.createTable();
var calls = [];
t40.subscribe(function (op, ent) { calls.push(op + ':' + (ent ? ent.id : '-')); });
eq(t40.revision(), 0);
var a40 = t40.create('POINT', { x: 1, y: 2 });
t40.update(a40.id, { x: 3 });
t40.move(a40.id, 1, 1);
t40.remove(a40.id);
eq(t40.remove('nope'), false);
t40.clear();
deep(calls, ['add:' + a40.id, 'update:' + a40.id, 'move:' + a40.id,
  'remove:' + a40.id, 'clear:-']);
eq(t40.revision(), 5);
pass('phase10 subscribe ops revision');
// 41 unsubscribe stops; non-function rejected
var t41 = E.createTable();
var n41 = 0;
var un41 = t41.subscribe(function () { n41++; });
t41.create('POINT', {});
un41();
t41.create('POINT', {});
eq(n41, 1);
throws(function () { t41.subscribe('x'); });
pass('phase10 unsubscribe guard');
// 42 headless live flow: demo -> clear -> edit rebuilds
E.resetIdCounter();
var t42 = E.createTable();
hexEnts.forEach(function (s) { t42.create(s.type, s); });
var st42 = S.createSolidState({});
function rebuild42() {
  var res = R.reconstruct(t42.visibleEntities());
  if (res.status === 'ok') S.setGeometry(st42, res.geometry);
  else S.setUnavailable(st42, res.reason, res.label);
  return res;
}
var live1 = rebuild42();
eq(live1.status, 'ok');
eq(S.render(MockCtx(), st42).vertices, 12);
t42.clear();
var live2 = rebuild42();
eq(live2.reason, 'missing-view');
eq(S.render(MockCtx(), st42).unavailable, 'missing-view');
boxBoth().forEach(function (s) { t42.create(s.type, s); });
var boxRes = rebuild42();
eq(boxRes.status, 'ok');
var preX = boxRes.geometry.vertices.map(function (v) { return v.x; });
t42.findByType('SEGMENT').filter(function (e) { return e.y < 0 && e.y2 < 0; })
  .forEach(function (e) { t42.move(e.id, 0.2, 0); });
var live3 = rebuild42();
eq(live3.status, 'ok');
eq(live3.class, 'A');
var postX = live3.geometry.vertices.map(function (v) { return v.x; });
ok(postX.some(function (x, i) { return Math.abs(x - preX[i]) > 1e-9; }), 'move reshapes 3D');
t42.update(t42.findByType('SEGMENT')[0].id, { caption: 'shifted' });
eq(rebuild42().status, 'ok');
var elevTop = t42.findByType('SEGMENT').filter(function (e) { return e.y === 50 && e.y2 === 50; })[0];
t42.remove(elevTop.id);
var live4 = rebuild42();
eq(live4.status, 'unavailable');
eq(live4.reason, 'unmatched-edge');
pass('phase10 headless live flow');
// 43 app wires the live bridge
var html = fs.readFileSync('mirror/index.html', 'utf8');
['educad-reconstruct.js', 'handle.rebuildSolid',
  'requestAnimationFrame(rebuildSolid)', 'table.subscribe',
  'visibleEntities()', 'setUnavailable'].forEach(function (s) {
  ok(html.indexOf(s) !== -1, 'bridge ' + s);
});
pass('phase10 bridge wired in app');
// 44 reconstruction never stores 3D on entities
E.resetIdCounter();
var t44 = E.createTable();
hexEnts.forEach(function (s) { t44.create(s.type, s); });
var before = t44.list().map(function (e) { return Object.keys(e).sort().join(','); });
R.reconstruct(t44.visibleEntities());
var after = t44.list().map(function (e) { return Object.keys(e).sort().join(','); });
deep(after, before);
after.forEach(function (k) {
  ok(k.indexOf('vertices') === -1 && k.indexOf('geometry') === -1, 'no 3D keys');
});
pass('phase10 entities stay 2D');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase10 tests passed');

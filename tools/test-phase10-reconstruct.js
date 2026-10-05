'use strict';
var assert = require('assert');
var fs = require('fs');
var R = require('../public/lib/educad-reconstruct.js');
var S = require('../public/lib/educad-solid.js');
var E = require('../public/lib/educad-entities.js');
var C = require('../public/lib/educad-curriculum.js');

var TOTAL = 54;
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
function cpt(x, y, role, caption) {
  return { type: 'POINT', x: x, y: y, bisCode: 'B', viewRole: role || 'BOTH', caption: caption };
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
var src = fs.readFileSync('public/lib/educad-reconstruct.js', 'utf8');
eq(src.indexOf('require('), -1);
ok(src.indexOf('EduCADReconstruct') !== -1, 'window.EduCADReconstruct marker');
ok(src.indexOf('module.exports') !== -1, 'module.exports marker');
pass('phase10 zero deps dual-env');
// 3 exports present
['filterEntities', 'classifyViews', 'weldTolerance', 'buildViewGraph',
  'convexLoop', 'pointInLoop', 'tryCylinder', 'tryCone', 'tryRevolved',
  'projectToViews', 'baseNameOf', 'captionBases', 'reconstructLive',
  'REASON_LABELS'].forEach(function (k) {
  ok(R[k] !== undefined, 'export ' + k);
});
eq(R.reconstruct, undefined, 'class entry deleted');
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
// 10 datum dots pair by their mate: an elevation dot plus a datum dot
// lifts at z = 0, unclassified, with no warnings key
var r10 = R.reconstructLive([
  cpt(10, 0, 'BOTH', 'a'), cpt(10, 35, 'ELEVATION', "a'"),
  proj(10, -5, 35)
]);
eq(r10.status, 'ok');
eq(r10.class, null);
deep(r10.geometry.vertices, [{ x: 10, y: 35, z: 0 }]);
eq(r10.warnings, undefined);
pass('phase10 datum pairs by mate');
// 11 mapping: Q1 point lifts exactly
var r11 = R.reconstructLive(
  [pt(10, -15, 'PLAN'), pt(10, 20, 'ELEVATION'), proj(10, -15, 20)]);
eq(r11.status, 'ok');
eq(r11.class, null);
deep(r11.geometry.vertices, [{ x: 10, y: 20, z: 15 }]);
pass('phase10 mapping lifts xdh');
// 12 mapping: Q3 negatives never clamped
var r12 = R.reconstructLive(
  [pt(10, 15, 'PLAN'), pt(10, -30, 'ELEVATION'), proj(10, -30, 15)]);
eq(r12.status, 'ok');
eq(r12.class, null);
deep(r12.geometry.vertices, [{ x: 10, y: -30, z: -15 }]);
pass('phase10 mapping keeps negatives');
// 13 resting hand box (dotted BOTH rects) lifts its 8 corners + 12 edges
function restingBox() {
  var dots = [
    [0, 0, "A'"], [0, 0, 'A'], [35, 0, "B'"], [35, 0, 'B'],
    [0, 60, "C'"], [0, 0, 'C'], [35, 60, "D'"], [35, 0, 'D'],
    [0, 0, "E'"], [0, -35, 'E'], [35, 0, "F'"], [35, -35, 'F'],
    [0, 60, "G'"], [0, -35, 'G'], [35, 60, "H'"], [35, -35, 'H']
  ].map(function (d) { return cpt(d[0], d[1], 'BOTH', d[2]); });
  return dots.concat([
    proj(0, -35, 60), proj(35, -35, 60),
    seg(0, 0, 35, 0), seg(35, 0, 35, 60), seg(35, 60, 0, 60), seg(0, 60, 0, 0),
    seg(0, 0, 35, 0), seg(35, 0, 35, -35), seg(35, -35, 0, -35), seg(0, -35, 0, 0)
  ]);
}
var r13 = R.reconstructLive(restingBox());
eq(r13.status, 'ok');
eq(r13.class, null);
eq(r13.geometry.vertices.length, 8);
eq(r13.geometry.edges.length, 12);
eq(r13.geometry.faces.length, 6); // phase38: closed box infers faces
ok(hasVert(r13.geometry.vertices, 0, 0, 0), 'corner A');
ok(hasVert(r13.geometry.vertices, 0, 60, 35), 'corner G');
pass('phase10 hand box wire');
// 14 hex prism demo: 12v/18e at drawn proportions
var hexEnts = C.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
var r14 = R.reconstructLive(hexEnts);
eq(r14.status, 'ok');
eq(r14.class, null);
eq(r14.geometry.vertices.length, 12);
eq(r14.geometry.edges.length, 18);
eq(r14.geometry.faces.length, 8); // phase38: closed prism infers faces
var hx = r14.geometry.vertices.map(function (v) { return v.x; });
var hy = r14.geometry.vertices.map(function (v) { return v.y; });
near(Math.max.apply(null, hx) - Math.min.apply(null, hx), 35, 1e-9, 'across corners');
near(Math.max.apply(null, hy) - Math.min.apply(null, hy), 70, 1e-9, 'height');
pass('phase10 hex prism 12v 18e');
// 15 eps boundary: 0.2 mm shift pairs, 1.2 mm shift stays 2D-only
function shiftedPair(dx) {
  return [cpt(10, -15, 'PLAN', 'a'), cpt(10 + dx, 20, 'ELEVATION', "a'"),
    proj(10, -15, 20)];
}
eq(R.reconstructLive(shiftedPair(0.2)).status, 'ok');
var r15 = R.reconstructLive(shiftedPair(1.2));
eq(r15.status, 'unavailable');
eq(r15.reason, 'empty-sketch');
pass('phase10 eps boundary pairs');
// 16 L corners lift as wire: no convexity gate
var LPLAN = [[0, -40, 'a'], [30, -40, 'b'], [30, -25, 'c'],
  [15, -25, 'd'], [15, -10, 'e'], [0, -10, 'f']];
var LELEV = [[0, 5, "a'"], [30, 5, "b'"], [30, 20, "c'"],
  [15, 20, "d'"], [15, 50, "e'"], [0, 50, "f'"]];
var lEnts = [];
for (var li = 0; li < 6; li++) {
  var lp0 = LPLAN[li], lp1 = LPLAN[(li + 1) % 6];
  lEnts.push(seg(lp0[0], lp0[1], lp1[0], lp1[1]));
  var lq0 = LELEV[li], lq1 = LELEV[(li + 1) % 6];
  lEnts.push(seg(lq0[0], lq0[1], lq1[0], lq1[1]));
}
LPLAN.forEach(function (p) { lEnts.push(cpt(p[0], p[1], 'PLAN', p[2])); });
LELEV.forEach(function (p) { lEnts.push(cpt(p[0], p[1], 'ELEVATION', p[2])); });
lEnts.push(proj(0, -40, 50), proj(30, -40, 20), proj(15, -25, 50));
var r16 = R.reconstructLive(lEnts);
eq(r16.status, 'ok');
eq(r16.geometry.vertices.length, 6);
eq(r16.geometry.edges.length, 6);
eq(r16.geometry.faces.length, 0);
pass('phase10 L lifts as wire');
// 17 stray ink never vetoes: a stray segment beside a pair is ignored
var r17 = R.reconstructLive([
  cpt(10, -15, 'PLAN', 'a'), cpt(10, 20, 'ELEVATION', "a'"),
  proj(10, -15, 20), seg(50, 30, 80, 40)
]);
eq(r17.status, 'ok');
eq(r17.geometry.vertices.length, 1);
eq(r17.geometry.edges.length, 0);
pass('phase10 stray edge ignored');
// 18 a lone single-view dot beside a pair is ignored
var r18 = R.reconstructLive([
  cpt(10, -15, 'PLAN', 'a'), cpt(10, 20, 'ELEVATION', "a'"),
  proj(10, -15, 20), pt(60, 33)
]);
eq(r18.status, 'ok');
eq(r18.geometry.vertices.length, 1);
eq(r18.geometry.edges.length, 0);
pass('phase10 stray point ignored');
// 19 pyramid demo resolves with apex
var pyrEnts = C.regularSolid({ solid: 'PYRAMID', sizeMm: 35, heightMm: 70, xMm: 0 }).entities;
var r19 = R.reconstructLive(pyrEnts);
eq(r19.status, 'ok');
eq(r19.class, null);
eq(r19.geometry.vertices.length, 5);
eq(r19.geometry.edges.length, 8);
eq(r19.geometry.faces.length, 5); // phase38: closed pyramid infers faces
var apex = r19.geometry.vertices[r19.geometry.vertices.length - 1];
near(apex.x, 0, 1e-9, 'apex x');
near(apex.y, 70, 1e-9, 'apex h');
near(apex.z, 25.5, 1e-9, 'apex d');
pass('phase10 pyramid apex');
// 20 missing ink drops the edge, never the vertices: one solid side
// still evidences the line edge, zero sides leave bare corners
var lineEnts20 = C.straightLine({ TL: 80, thetaDeg: 30, phiDeg: 45 }).entities;
var r20a = R.reconstructLive(lineEnts20.filter(function (e) {
  return !(e.type === 'SEGMENT' && e.viewRole === 'PLAN' && e.bisCode === 'A');
}));
eq(r20a.status, 'ok');
eq(r20a.geometry.vertices.length, 2);
eq(r20a.geometry.edges.length, 1);
var r20 = R.reconstructLive(lineEnts20.filter(function (e) {
  return !(e.type === 'SEGMENT' && e.bisCode === 'A');
}));
eq(r20.status, 'ok');
eq(r20.geometry.vertices.length, 2);
eq(r20.geometry.edges.length, 0);
pass('phase10 missing ink drops edge');
// 21 an extra interior dot stays 2D-only; the pyramid is intact
var r21 = R.reconstructLive(pyrEnts.concat([pt(5, -20, 'PLAN')]));
eq(r21.status, 'ok');
eq(r21.geometry.vertices.length, 5);
eq(r21.geometry.edges.length, 8);
eq(r21.stats.paired, 5);
pass('phase10 extra dot ignored');
// 22 quadrant lesson resolves to a 3D point
var r22 = R.reconstructLive(C.quadrantPoint({ quadrant: 1 }).entities);
eq(r22.status, 'ok');
eq(r22.class, null);
eq(r22.geometry.vertices.length, 1);
eq(r22.geometry.edges.length, 0);
pass('phase10 quadrant point wireframe');
// 23 straight line keeps true length TL in 3D
var r23 = R.reconstructLive(C.straightLine({ TL: 80, thetaDeg: 30, phiDeg: 45 }).entities);
eq(r23.status, 'ok');
eq(r23.class, null);
eq(r23.geometry.vertices.length, 2);
eq(r23.geometry.edges.length, 1);
var va = r23.geometry.vertices[0], vb = r23.geometry.vertices[1];
var len3 = Math.sqrt((vb.x - va.x) * (vb.x - va.x) + (vb.y - va.y) * (vb.y - va.y) + (vb.z - va.z) * (vb.z - va.z));
near(len3, 80, 1e-6, 'true length');
pass('phase10 line keeps TL');
// 24 collapsed plan pins a vertical edge
var r24 = R.reconstructLive(C.straightLine({ TL: 50, thetaDeg: 90, phiDeg: 0 }).entities);
eq(r24.status, 'ok');
eq(r24.geometry.vertices.length, 2);
eq(r24.geometry.edges.length, 1);
var pa = r24.geometry.vertices[0], pb = r24.geometry.vertices[1];
near(pa.x, pb.x, 1e-9, 'pin x');
near(pa.z, pb.z, 1e-9, 'pin d');
ok(Math.abs(pa.y - pb.y) > 1, 'pin spans height');
pass('phase10 degenerate pins vertical');
// 25 two unnamed pairs sharing x stay 2D-only (crowded station)
var r25 = R.reconstructLive([
  pt(10, -20, 'PLAN'), pt(10, -25, 'PLAN'),
  pt(10, 20, 'ELEVATION'), pt(10, 30, 'ELEVATION'),
  proj(10, -25, 30)
]);
eq(r25.status, 'unavailable');
eq(r25.reason, 'empty-sketch');
pass('phase10 shared-x unnamed quiet');
// 26 single-view ink has no mate: quiet, not an error
var r26 = R.reconstructLive([seg(0, -20, 30, -25, 'PLAN'), pt(0, 20, 'ELEVATION')]);
eq(r26.status, 'unavailable');
eq(r26.reason, 'empty-sketch');
pass('phase10 single-view quiet');
// 27 empty and partial sheets share the one quiet state
var r27a = R.reconstructLive([]);
eq(r27a.status, 'unavailable');
eq(r27a.reason, 'empty-sketch');
eq(r27a.label, 'nothing with both views drawn yet');
eq(R.reconstructLive(planRect(0, -40, 30, -10)).reason, 'empty-sketch');
pass('phase10 quiet state shared');
// 28 revolved reader: cylinder/cone lift unclassified; arcs stay deferred
var r28c = R.reconstructLive(C.regularSolid({ solid: 'CYLINDER' }).entities);
eq(r28c.status, 'ok');
eq(r28c.class, null);
eq(r28c.geometry.vertices.length, 48);
eq(r28c.geometry.edges.length, 72);
eq(r28c.geometry.faces.length, 26);
var r28k = R.reconstructLive(C.regularSolid({ solid: 'CONE' }).entities);
eq(r28k.status, 'ok');
eq(r28k.class, null);
eq(r28k.geometry.vertices.length, 25);
eq(r28k.geometry.edges.length, 48);
eq(r28k.geometry.faces.length, 25);
eq(R.reconstructLive([{ type: 'CIRCULAR_ARC', x: 0, y: -25, x2: 5, y2: -20, radius: 17.5, startAngle: 0, endAngle: 1, bisCode: 'A', viewRole: 'PLAN' }]).reason, 'unsupported-curves');
pass('phase10 cylinders cones ok arcs deferred');
// 29 deterministic under rerun; reorder keeps the same vertex/edge sets
// (input order may permute vertex indices, never the sets)
var ents29 = hexEnts;
var a29 = R.reconstructLive(ents29);
var b29 = R.reconstructLive(ents29.slice().reverse());
eq(canonGeom(a29.geometry), canonGeom(b29.geometry));
deep(R.reconstructLive(hexEnts), R.reconstructLive(hexEnts));
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
  var res = R.reconstructLive(ents);
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
checkRoundTrip(restingBox(), 'box');
pass('phase10 round-trip holds');
// 31 guards: bad eps throws, non-array reads as quiet
throws(function () { R.reconstructLive(boxBoth(), { eps: 0 }); });
throws(function () { R.reconstructLive(boxBoth(), { eps: -1 }); });
eq(R.reconstructLive('nope').reason, 'empty-sketch');
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
S.setGeometry(st35, r28c.geometry);
eq(st35.geometry.vertices.length, 48);
eq(st35.geometry.name, 'cylinder');
function MockCtx() {
  return {
    beginPath: function () {}, save: function () {}, restore: function () {},
    moveTo: function () {}, lineTo: function () {}, stroke: function () {},
    arc: function () {}, fill: function () {}, setLineDash: function () {}
  };
}
var c35 = S.render(MockCtx(), st35);
eq(c35.vertices, 48);
eq(c35.front + c35.hidden, 72);
ok(c35.hidden > 0, 'some hidden');
pass('phase10 setGeometry renders cylinder');
// 36 cylinder hidden set golden at rest, stable under orbit
var st36 = S.createSolidState({});
S.setGeometry(st36, r28c.geometry);
var hid36 = S.classifyEdges(st36).map(function (e, i) { return e.hidden ? i : -1; })
  .filter(function (i) { return i >= 0; });
deep(hid36, [0, 2, 3, 5, 6, 8, 45, 48, 50, 51, 53, 54, 56, 57, 59, 60,
  62, 63, 65, 66, 68, 69, 71]);
var mn = 99, mx = 0;
for (var yaw = -3; yaw <= 3.01; yaw += 0.37) {
  for (var pitch = -1.4; pitch <= 1.41; pitch += 0.31) {
    st36.yaw = yaw;
    st36.pitch = pitch;
    var cl = S.classifyEdges(st36);
    eq(cl.length, 72);
    var h = cl.filter(function (e) { return e.hidden; }).length;
    if (h < mn) mn = h;
    if (h > mx) mx = h;
  }
}
eq(mn, 23);
eq(mx, 23);
pass('phase10 cylinder hidden golden stable');
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
  var res = R.reconstructLive(t42.visibleEntities());
  if (res.status === 'ok') S.setGeometry(st42, res.geometry);
  else S.setUnavailable(st42, res.reason, res.label);
  return res;
}
var live1 = rebuild42();
eq(live1.status, 'ok');
eq(S.render(MockCtx(), st42).vertices, 12);
t42.clear();
var live2 = rebuild42();
eq(live2.reason, 'empty-sketch');
eq(S.render(MockCtx(), st42).unavailable, 'empty-sketch');
hexEnts.forEach(function (s) { t42.create(s.type, s); });
var boxRes = rebuild42();
eq(boxRes.status, 'ok');
var preX = boxRes.geometry.vertices.map(function (v) { return v.x; });
t42.findByType('POINT').filter(function (e) { return e.y < 0; })
  .forEach(function (e) { t42.move(e.id, 0.2, 0); });
var live3 = rebuild42();
eq(live3.status, 'ok');
eq(live3.class, null);
var postX = live3.geometry.vertices.map(function (v) { return v.x; });
ok(postX.some(function (x, i) { return Math.abs(x - preX[i]) > 1e-9; }), 'move reshapes 3D');
t42.update(t42.findByType('SEGMENT')[0].id, { caption: 'shifted' });
eq(rebuild42().status, 'ok');
t42.findByType('SEGMENT').filter(function (e) {
  return !(e.meta && e.meta.kind === 'projector');
}).forEach(function (e) { t42.remove(e.id); });
var live4 = rebuild42();
eq(live4.status, 'ok');
eq(live4.geometry.vertices.length, 12);
eq(live4.geometry.edges.length, 0);
t42.findByType('POINT').forEach(function (e) { t42.remove(e.id); });
var live5 = rebuild42();
eq(live5.status, 'unavailable');
eq(live5.reason, 'empty-sketch');
pass('phase10 headless live flow');
// 43 app wires the live bridge
var html = fs.readFileSync('public/index.html', 'utf8');
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
R.reconstructLive(t44.visibleEntities());
var after = t44.list().map(function (e) { return Object.keys(e).sort().join(','); });
deep(after, before);
after.forEach(function (k) {
  ok(k.indexOf('vertices') === -1 && k.indexOf('geometry') === -1, 'no 3D keys');
});
pass('phase10 entities stay 2D');
// 45 baseNameOf strips prime ticks to the shared base
eq(R.baseNameOf("a'"), 'a');
eq(R.baseNameOf('a'), 'a');
eq(R.baseNameOf("a''"), 'a');
eq(R.baseNameOf('b1’'), 'b1');
eq(R.baseNameOf('  c′  '), 'c');
eq(R.baseNameOf(''), '');
eq(R.baseNameOf("'"), '');
eq(R.baseNameOf(undefined), '');
pass('phase10 baseNameOf primes');
// 46 mismatched names stay 2D-only; profile dots never gate the wire
function npt(x, y, role, caption) {
  return { type: 'POINT', x: x, y: y, bisCode: 'B', viewRole: role, caption: caption };
}
var r46 = R.reconstructLive([
  npt(10, -25, 'PLAN', 'd'), npt(10, 35, 'ELEVATION', "a'"),
  proj(10, -25, 35)
]);
eq(r46.status, 'unavailable');
eq(r46.reason, 'empty-sketch');
var r46p = R.reconstructLive([
  npt(10, -25, 'PLAN', 'a'), npt(10, 35, 'ELEVATION', "a'"),
  npt(60, 35, 'PROFILE', "d''"), proj(10, -25, 35)
]);
eq(r46p.status, 'ok', 'profile labels never gate');
eq(r46p.geometry.vertices.length, 1);
var r46q = R.reconstructLive([
  npt(10, -25, 'PLAN', 'a'), npt(10, 35, 'ELEVATION', "a'"),
  npt(60, 35, 'PROFILE', "a''"), proj(10, -25, 35)
]);
eq(r46q.status, 'ok');
pass('phase10 names pair, profile ignored');
// 47 matching a/a' lifts the 3D point
var r47 = R.reconstructLive([
  npt(10, -25, 'PLAN', 'a'), npt(10, 35, 'ELEVATION', "a'"),
  proj(10, -25, 35)
]);
eq(r47.status, 'ok');
eq(r47.class, null);
eq(r47.geometry.vertices.length, 1);
pass('phase10 name match lifts');
// 48 a unique caption-less pair lifts geometrically
var r48 = R.reconstructLive(
  [pt(10, -25, 'PLAN'), pt(10, 35, 'ELEVATION'), proj(10, -25, 35)]);
eq(r48.status, 'ok');
eq(r48.class, null);
pass('phase10 unlabeled unique lifts');
// 49 no opt-outs: mismatched names stay 2D-only, plainly
var r49 = R.reconstructLive([
  npt(10, -25, 'PLAN', 'd'), npt(10, 35, 'ELEVATION', "a'"),
  proj(10, -25, 35)
]);
eq(r49.status, 'unavailable');
eq(r49.reason, 'empty-sketch');
pass('phase10 mismatch stays 2D-only');
// 50 a one-sided label pins its dot (no auto-pair); pyramid still lifts
var r50a = R.reconstructLive([npt(10, -25, 'PLAN', 'd'), pt(10, 35, 'ELEVATION'),
  proj(10, -25, 35)]);
eq(r50a.status, 'unavailable');
eq(r50a.reason, 'empty-sketch');
var r50b = R.reconstructLive(C.regularSolid({ solid: 'PYRAMID' }).entities);
eq(r50b.status, 'ok');
pass('phase10 one-sided pinned plus pyramid');
// 51 names resolve a shared-x station the geometry cannot
var r51 = R.reconstructLive([
  npt(10, -20, 'PLAN', 'a'), npt(10, -25, 'PLAN', 'b'),
  npt(10, 20, 'ELEVATION', "a'"), npt(10, 30, 'ELEVATION', "b'"),
  proj(10, -25, 30)
]);
eq(r51.status, 'ok');
eq(r51.class, null);
eq(r51.geometry.vertices.length, 2);
pass('phase10 names resolve shared-x');
// 52 a named mate at another station stays 2D-only, quietly
var r52 = R.reconstructLive([
  npt(10, -25, 'PLAN', 'a'), npt(13, 35, 'ELEVATION', "a'"),
  proj(10, -25, 35), proj(13, -25, 35)
]);
eq(r52.status, 'unavailable');
eq(r52.reason, 'empty-sketch');
pass('phase10 off-station mate quiet');
// 53 one letter on two dots stays 2D-only, never guessed
var r53 = R.reconstructLive([
  npt(10, -25, 'PLAN', 'a'), npt(10, -30, 'PLAN', 'a'),
  npt(10, 35, 'ELEVATION', "a'"),
  proj(10, -30, 35)
]);
eq(r53.status, 'unavailable');
eq(r53.reason, 'empty-sketch');
pass('phase10 duplicate label quiet');
// 54 the §4.8 hand recipes resolve exactly as the manual promises:
// multi-caption box corners lift 8v/12e with no diagonals, the named
// pyramid with plan slants lifts 5v/8e
var recipeBox = [
  seg(-30, -40, 30, -40), seg(30, -40, 30, -10),
  seg(30, -10, -30, -10), seg(-30, -10, -30, -40),
  seg(-30, 10, 30, 10), seg(30, 10, 30, 50),
  seg(30, 50, -30, 50), seg(-30, 50, -30, 10),
  cpt(-30, -40, 'BOTH', 'a,e'), cpt(30, -40, 'BOTH', 'c,g'),
  cpt(30, -10, 'BOTH', 'd,h'), cpt(-30, -10, 'BOTH', 'b,f'),
  cpt(-30, 10, 'BOTH', "a',b'"), cpt(30, 10, 'BOTH', "c',d'"),
  cpt(30, 50, 'BOTH', "g',h'"), cpt(-30, 50, 'BOTH', "e',f'"),
  proj(-30, -40, 50), proj(30, -40, 50)
];
var r54a = R.reconstructLive(recipeBox);
eq(r54a.status, 'ok');
eq(r54a.geometry.vertices.length, 8);
eq(r54a.geometry.edges.length, 12);
r54a.geometry.edges.forEach(function (e) {
  var va = r54a.geometry.vertices[e[0]], vb = r54a.geometry.vertices[e[1]];
  var nz = (va.x !== vb.x ? 1 : 0) + (va.y !== vb.y ? 1 : 0) +
    (va.z !== vb.z ? 1 : 0);
  eq(nz, 1, 'box edge axis-aligned');
});
var recipePyr = [
  seg(-20, -50, 20, -50), seg(20, -50, 20, -10),
  seg(20, -10, -20, -10), seg(-20, -10, -20, -50),
  seg(-20, -50, 0, -30), seg(20, -50, 0, -30),
  seg(20, -10, 0, -30), seg(-20, -10, 0, -30),
  seg(-20, 10, 20, 10), seg(-20, 10, 0, 50), seg(20, 10, 0, 50),
  cpt(-20, -50, 'BOTH', 'a'), cpt(20, -50, 'BOTH', 'b'),
  cpt(20, -10, 'BOTH', 'c'), cpt(-20, -10, 'BOTH', 'd'),
  cpt(0, -30, 'BOTH', 's'),
  cpt(-20, 10, 'BOTH', "a',d'"), cpt(20, 10, 'BOTH', "b',c'"),
  cpt(0, 50, 'BOTH', "s'"),
  proj(-20, -50, 10), proj(20, -50, 10), proj(0, -30, 50)
];
var r54b = R.reconstructLive(recipePyr);
eq(r54b.status, 'ok');
eq(r54b.geometry.vertices.length, 5);
eq(r54b.geometry.edges.length, 8);
ok(hasVert(r54b.geometry.vertices, 0, 50, 30), 'recipe apex');
pass('phase10 hand recipes resolve');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase10 tests passed');

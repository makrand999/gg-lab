'use strict';
var assert = require('assert');
var S = require('../public/lib/educad-solid.js');
var R = require('../public/lib/educad-spatial.js');
var n = 0;
function check(name, fn) { fn(); n++; console.log('PASS ' + name); }
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-8, a + ' != ' + b); }
function wire(vertices, edges) { return S.createGeometry({ vertices: vertices, edges: edges || [], faces: [] }); }
var geometry = wire([{ x: 100, y: 25, z: 40 }, { x: 130, y: 65, z: 40 }], [[0, 1]]);
var st = S.createGlassState({ w: 1280, h: 800 });
S.setGeometry(st, geometry);

check('reference planes use world zero, even when the model is translated', function () {
  var refs = R.references(geometry);
  refs.hp.forEach(function (p) { assert.equal(p.y, 0); });
  refs.vp.forEach(function (p) { assert.equal(p.z, 0); });
  refs.xy.forEach(function (p) { assert.equal(p.y, 0); assert.equal(p.z, 0); });
  assert.ok(refs.hp[0].x < 100 && refs.hp[1].x > 130);
  assert.equal(R.summary(geometry), '25 mm above HP · 40 mm in front of VP');
});
check('normalization retains original millimeters without modifying vertices', function () {
  assert.strictEqual(st.geometryMm, geometry);
  assert.deepStrictEqual(geometry.vertices[0], { x: 100, y: 25, z: 40 });
  near(st.geometryTransform.cy, 45);
  var ground = R.toStage({ x: 115, y: 0, z: 0 }, st.geometryTransform);
  near(ground.y, -2.25); near(ground.z, -2);
});
check('world projection agrees with the wireframe across orbit and zoom', function () {
  [-2, 0, 0.7, 2.3].forEach(function (yaw) {
    [-1.4, 0, 0.6, 1.4].forEach(function (pitch) {
      st.yaw = yaw; st.pitch = pitch; st.scale = 1.7;
      var projected = S.project(st, st.cx, st.cy);
      geometry.vertices.forEach(function (p, i) {
        var actual = R.projectMm(p, st, S);
        near(actual.x, projected[i].x); near(actual.y, projected[i].y); near(actual.z, projected[i].z);
      });
    });
  });
  S.resetGlassView(st);
});
check('orthographic projection feet preserve height and depth distances', function () {
  var p = geometry.vertices[0], t = st.geometryTransform;
  var v = R.toStage(p, t), hp = R.toStage({ x: p.x, y: 0, z: p.z }, t), vp = R.toStage({ x: p.x, y: p.y, z: 0 }, t);
  near((v.y - hp.y) / t.scale, 25); near((v.z - vp.z) / t.scale, 40);
  near(v.x, hp.x); near(v.z, hp.z); near(v.y, vp.y);
});
check('negative and crossing quadrants retain signed coordinates', function () {
  assert.equal(R.summary(wire([{ x: 0, y: -30, z: -10 }])), '30 mm below HP · 10 mm behind VP');
  assert.equal(R.summary(wire([{ x: 0, y: -10, z: 20 }])), '10 mm below HP · 20 mm in front of VP');
  assert.equal(R.summary(wire([{ x: 0, y: 10, z: -20 }])), '10 mm above HP · 20 mm behind VP');
  var g = wire([{ x: -5, y: -20, z: -30 }, { x: 5, y: 20, z: 30 }], [[0, 1]]);
  assert.equal(R.summary(g), 'Crosses HP · Crosses VP');
  var refs = R.references(g);
  assert.ok(refs.vp[0].y < -20 && refs.vp[2].y > 20);
  assert.ok(refs.hp[0].z < -30 && refs.hp[2].z > 30);
});
check('touching and on-plane geometry are distinguished', function () {
  assert.equal(R.summary(wire([{ x: 0, y: 0, z: 0 }])), 'On HP · On VP');
  assert.equal(R.summary(wire([{ x: 0, y: 0, z: 10 }, { x: 5, y: 20, z: 10 }])), 'Touches HP · 10 mm in front of VP');
  assert.equal(R.summary(wire([{ x: 0, y: -20, z: 0 }, { x: 5, y: 0, z: -10 }])), 'Touches HP · Touches VP');
});
check('edge length and plane inclinations use real 3D geometry', function () {
  var info = R.edgeInfo(geometry, 0);
  near(info.length, 50); near(info.hp, Math.asin(0.8) * 180 / Math.PI); near(info.vp, 0);
  var line = wire([{ x: 0, y: 0, z: 0 }, { x: 40, y: 40, z: Math.sqrt(3200) }], [[0, 1]]);
  info = R.edgeInfo(line, 0); near(info.length, 80); near(info.hp, 30); near(info.vp, 45);
});
check('normal and degenerate edges have well-defined angle readouts', function () {
  var vertical = R.edgeInfo(wire([{ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 }], [[0, 1]]), 0);
  near(vertical.hp, 90); near(vertical.vp, 0);
  var zero = R.edgeInfo(wire([{ x: 1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }], [[0, 1]]), 0);
  assert.equal(zero.length, 0); assert.equal(zero.hp, null); assert.equal(zero.vp, null);
});
check('click picking distinguishes vertices, edges, and empty space', function () {
  var pts = S.project(st, st.cx, st.cy);
  assert.deepStrictEqual(R.pick(st, pts[0].x, pts[0].y, S), { kind: 'point', index: 0 });
  assert.deepStrictEqual(R.pick(st, (pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, S), { kind: 'edge', index: 0 });
  assert.equal(R.pick(st, 0, 0, S), null);
});
check('coincident screen points select the nearer vertex', function () {
  var overlap = S.createGlassState({ w: 1280, h: 800, yaw: 0, pitch: 0 });
  S.setGeometry(overlap, wire([{ x: 0, y: 5, z: -10 }, { x: 0, y: 5, z: 10 }]));
  assert.deepStrictEqual(R.pick(overlap, overlap.cx, overlap.cy, S), { kind: 'point', index: 1 });
});
check('single points have usable reference surfaces', function () {
  var refs = R.references(wire([{ x: 500, y: 20, z: 30 }]));
  assert.ok(refs.hp[1].x - refs.hp[0].x >= 15);
  assert.ok(refs.vp[2].y > 20 && refs.hp[2].z > 30);
  assert.equal(R.references(null), null); assert.equal(R.summary(null), '');
  assert.equal(R.fmt(-0), '0'); assert.equal(R.fmt(100), '100'); assert.equal(R.fmt(1.234), '1.23');
  assert.equal(R.fmt(-0.004), '0');
});
check('empty states and posed stage geometry cannot retain stale references', function () {
  S.setUnavailable(st, 'empty-sketch');
  assert.equal(st.geometryMm, null); assert.equal(st.geometryTransform, null); assert.equal(R.pick(st, st.cx, st.cy, S), null);
  S.setGeometry(st, geometry, { normalize: false }); assert.equal(st.geometryMm, null);
  S.setGeometry(st, geometry); assert.strictEqual(st.geometryMm, geometry);
  S.setGeometry(st, null); assert.equal(st.geometryMm, null);
});
check('reference surfaces never capture input outside the model wireframe', function () {
  S.setGeometry(st, geometry);
  var refs = R.references(geometry);
  var ground = R.projectMm(refs.xy[0], st, S);
  assert.equal(S.hitTestFrame(S.buildGlassFrame(st), ground.x, ground.y), false);
});
check('inspection vertex passes keep isolated points visible and never fill faces', function () {
  var g = S.createGeometry({ vertices: S.VERTICES.concat([{ x: 3, y: 3, z: 3 }]), edges: S.EDGES, faces: S.CUBE_FACES });
  var view = S.createSolidState({ geometry: g }); view.inspection = true;
  var alpha = 1, start = null, arcs = [], connectors = 0;
  var ctx = {
    save: function () {}, restore: function () {}, beginPath: function () { start = null; },
    moveTo: function (x, y) { start = { x: x, y: y }; }, lineTo: function () {}, stroke: function () {}, fill: function () {}, setLineDash: function () {},
    arc: function (x, y, r) { if (!start || Math.abs(start.x - x - r) > 1e-8 || start.y !== y) connectors++; arcs.push({ x: x, y: y, alpha: alpha }); }
  };
  Object.defineProperty(ctx, 'globalAlpha', { get: function () { return alpha; }, set: function (v) { alpha = v; } });
  S.renderFast(ctx, view);
  assert.equal(arcs.length, 9); assert.equal(connectors, 0);
  var lone = S.project(view, view.size / 2, view.size / 2)[8];
  assert.equal(arcs.find(function (a) { return a.x === lone.x && a.y === lone.y; }).alpha, 1);
  assert.ok(arcs.some(function (a) { return a.alpha === 0.32; }));
});
check('scanline gaps cut panel, quad, segment, and dot coverage', function () {
  assert.deepStrictEqual(R.scanGaps(100, [{ x0: 10, y0: 90, x1: 50, y1: 110 }], [], [], []), [[10, 50]]);
  assert.deepStrictEqual(R.scanGaps(80, [{ x0: 10, y0: 90, x1: 50, y1: 110 }], [], [], []), []);
  assert.deepStrictEqual(R.scanGaps(100, [{ x0: 10, y0: 90, x1: 10, y1: 110 }], [], [], []), []);
  var diamond = [[{ x: 0, y: 80 }, { x: 20, y: 100 }, { x: 0, y: 120 }, { x: -20, y: 100 }]];
  assert.deepStrictEqual(R.scanGaps(100, [], diamond, [], []), [[-21, 21]]);
  assert.deepStrictEqual(R.scanGaps(60, [], diamond, [], []), []);
  assert.deepStrictEqual(R.scanGaps(100, [], [], [{ ax: 0, ay: 90, bx: 10, by: 110, pad: 2 }], []), [[3, 7]]);
  assert.deepStrictEqual(R.scanGaps(100, [], [], [{ ax: 0, ay: 102, bx: 10, by: 110, pad: 2 }], []), []);
  assert.deepStrictEqual(R.scanGaps(100, [], [], [], [{ x: 30, y: 102, pad: 3 }]), [[27, 33]]);
  assert.deepStrictEqual(R.scanGaps(100, [], [], [], [{ x: 30, y: 104, pad: 3 }]), []);
});
check('scanline gaps merge overlaps and span collinear edges', function () {
  assert.deepStrictEqual(R.scanGaps(100,
    [{ x0: 25, y0: 90, x1: 50, y1: 110 }, { x0: 10, y0: 90, x1: 30, y1: 110 }],
    [], [{ ax: 62, ay: 90, bx: 62, by: 110, pad: 2 }], []), [[10, 50], [60, 64]]);
  assert.deepStrictEqual(R.scanGaps(100,
    [{ x0: 0, y0: 90, x1: 10, y1: 110 }, { x0: 10, y0: 90, x1: 20, y1: 110 }],
    [], [], []), [[0, 20]]);
  assert.deepStrictEqual(R.scanGaps(100, [], [], [{ ax: 5, ay: 100, bx: 15, by: 100, pad: 2 }], []), [[3, 17]]);
  assert.deepStrictEqual(R.scanGaps(100, [], [], [{ ax: 5, ay: 105, bx: 15, by: 105, pad: 2 }], []), []);
});
check('projected plane fills gap the datum row they cross', function () {
  var g = wire([{ x: 0, y: 10, z: 10 }, { x: 40, y: 10, z: 10 }], [[0, 1]]);
  var view = S.createGlassState({ w: 1280, h: 800, yaw: 0.7, pitch: 0.5 });
  S.setGeometry(view, g);
  var refs = R.references(g);
  function proj(p) { return R.projectMm(p, view, S); }
  var hp = refs.hp.map(proj);
  var ys = hp.map(function (p) { return p.y; });
  var midY = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2;
  var gaps = R.scanGaps(midY, [], [hp], [], []);
  assert.equal(gaps.length, 1);
  var xs = hp.map(function (p) { return p.x; });
  assert.ok(gaps[0][0] >= Math.min.apply(null, xs) - 1.01);
  assert.ok(gaps[0][1] <= Math.max.apply(null, xs) + 1.01);
  assert.ok(gaps[0][1] - gaps[0][0] > 0);
  assert.deepStrictEqual(R.scanGaps(-1000, [], [hp], [], []), []);
  var pts = g.vertices.map(proj);
  var eg = R.scanGaps((pts[0].y + pts[1].y) / 2, [], [],
    [{ ax: pts[0].x, ay: pts[0].y, bx: pts[1].x, by: pts[1].y, pad: 3 }], []);
  assert.equal(eg.length, 1); near(eg[0][1] - eg[0][0], 6);
});
check('inspection fills solid faces paper-opaque under hidden ink', function () {
  assert.equal(S.FACE_FILL, '#f8fafc');
  var cube = S.createGeometry({ vertices: S.VERTICES, edges: S.EDGES, faces: S.CUBE_FACES });
  function callsFor(geometry, inspection) {
    var view = S.createSolidState({ geometry: geometry });
    view.inspection = inspection;
    var calls = [], fills = [], style = '#000';
    var ctx = {
      save: function () {}, restore: function () {}, beginPath: function () {},
      moveTo: function () {}, lineTo: function () {}, arc: function () {},
      stroke: function () { calls.push('stroke'); },
      fill: function () { calls.push('fill'); fills.push(style); },
      setLineDash: function () {}
    };
    Object.defineProperty(ctx, 'globalAlpha', { get: function () { return 1; }, set: function () {} });
    Object.defineProperty(ctx, 'fillStyle', { get: function () { return style; }, set: function (v) { style = v; } });
    S.renderFast(ctx, view);
    return { calls: calls, fills: fills };
  }
  function preStrokeFills(run) {
    return run.calls.slice(0, run.calls.indexOf('stroke')).filter(function (c) { return c === 'fill'; }).length;
  }
  var on = callsFor(cube, true);
  var faceFills = preStrokeFills(on);
  assert.equal(faceFills, 6);
  on.fills.slice(0, faceFills).forEach(function (s) { assert.equal(s, '#f8fafc'); });
  assert.equal(preStrokeFills(callsFor(cube, false)), 0);
  var wire = S.createGeometry({ vertices: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], edges: [[0, 1]], faces: [] });
  assert.equal(preStrokeFills(callsFor(wire, true)), 0);
});
console.log('OK ' + n + ' spatial checks passed');

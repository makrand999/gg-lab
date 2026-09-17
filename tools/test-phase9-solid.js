'use strict';
var assert = require('assert');
var S = require('../mirror/files/www.geogebra.org/educad-solid.js');

var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/55 ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

// --- Pen-style constants (7) ---
eq(S.SIZE_DEFAULT, 260); pass('solid default stage 260px');
eq(S.LINE_COLOR, '#1e293b'); pass('solid ink line color');
eq(S.LINE_WIDTH_PX, 1.75); pass('solid line width 1.75px');
eq(S.VERTEX_FILL, '#0f172a'); pass('solid vertex fill');
eq(S.VERTEX_R_PX, 3); pass('solid vertex radius 3px');
deep(S.HIDDEN_DASH, [4, 4]); pass('solid hidden dash [4,4]');
eq(S.HIDDEN_OPACITY, 0.45); pass('solid hidden opacity 0.45');

// --- Cube topology (5) ---
eq(S.VERTICES.length, 8); pass('solid 8 vertices');
eq(S.EDGES.length, 12); pass('solid 12 edges');
S.EDGES.forEach(function (e, i) {
  ok(e[0] >= 0 && e[0] < 8 && e[1] >= 0 && e[1] < 8, 'edge ' + i + ' indices');
  var d = Math.abs(S.VERTICES[e[0]].x - S.VERTICES[e[1]].x) +
    Math.abs(S.VERTICES[e[0]].y - S.VERTICES[e[1]].y) +
    Math.abs(S.VERTICES[e[0]].z - S.VERTICES[e[1]].z);
  eq(d, 2, 'edge ' + i + ' unit length');
});
pass('solid edges join adjacent corners');
var degree = [0, 0, 0, 0, 0, 0, 0, 0];
S.EDGES.forEach(function (e) { degree[e[0]]++; degree[e[1]]++; });
deep(degree, [3, 3, 3, 3, 3, 3, 3, 3]); pass('solid every vertex degree 3');
eq(S.FACE_NORMALS.length, 6); eq(S.EDGE_FACES.length, 12);
S.EDGE_FACES.forEach(function (f, i) {
  var u = S.FACE_NORMALS[f[0]], v = S.FACE_NORMALS[f[1]];
  eq(u.x * v.x + u.y * v.y + u.z * v.z, 0, 'edge ' + i + ' faces adjacent');
});
pass('solid edge faces perpendicular');

// --- Isometric rest pose (3) ---
near(S.ISO_YAW_RAD, Math.PI / 4, 1e-12, 'yaw'); pass('solid iso yaw 45deg');
near(S.ISO_PITCH_RAD, Math.atan(1 / Math.sqrt(2)), 1e-12, 'pitch');
pass('solid iso pitch atan(1/sqrt2)');
near(S.ISO_PITCH_RAD * 180 / Math.PI, 35.264, 1e-3, 'pitch deg');
pass('solid iso pitch ~=35.26deg');

// --- State (6) ---
var st0 = S.createSolidState({});
eq(st0.yaw, S.ISO_YAW_RAD); eq(st0.pitch, S.ISO_PITCH_RAD); eq(st0.scale, 1);
eq(st0.size, 260); pass('solid state isometric defaults');
var stC = S.createSolidState({ yaw: 1, pitch: 9, scale: 99, size: 9999 });
eq(stC.pitch, S.PITCH_LIMIT_RAD); eq(stC.scale, S.ZOOM_MAX);
eq(stC.size, S.SIZE_MAX); pass('solid state clamps pitch/scale/size');
var stC2 = S.createSolidState({ pitch: -9, scale: 0.001, size: 4 });
eq(stC2.pitch, -S.PITCH_LIMIT_RAD); eq(stC2.scale, S.ZOOM_MIN);
eq(stC2.size, S.SIZE_MIN); pass('solid state clamps lower bounds');
throws(function () { S.createSolidState({ yaw: NaN }); });
pass('solid state NaN yaw throws');
var stR = S.createSolidState({ yaw: 2, pitch: 0.5, scale: 2 });
S.resetView(stR);
eq(stR.yaw, S.ISO_YAW_RAD); eq(stR.pitch, S.ISO_PITCH_RAD); eq(stR.scale, 1);
pass('solid resetView restores isometric');
S.rotateBy(stR, 100, -50);
near(stR.yaw, S.ISO_YAW_RAD + 100 * S.ORBIT_RAD_PER_PX, 1e-12, 'yaw');
near(stR.pitch, S.ISO_PITCH_RAD - 50 * S.ORBIT_RAD_PER_PX, 1e-12, 'pitch');
pass('solid rotateBy turntable rates');

// --- Orbit / zoom guards (5) ---
var stL = S.createSolidState({});
S.rotateBy(stL, 0, 1e6); eq(stL.pitch, S.PITCH_LIMIT_RAD);
S.rotateBy(stL, 0, -1e6); eq(stL.pitch, -S.PITCH_LIMIT_RAD);
pass('solid pitch clamped both poles');
throws(function () { S.rotateBy(S.createSolidState({}), NaN, 0); });
pass('solid rotateBy NaN throws');
var stZ = S.createSolidState({});
S.zoomBy(stZ, 2); eq(stZ.scale, 2);
S.zoomBy(stZ, 0.25); near(stZ.scale, 0.5, 1e-12, 'zoom out');
pass('solid zoomBy in/out factors');
S.zoomBy(stZ, 1e6); eq(stZ.scale, S.ZOOM_MAX);
S.zoomBy(stZ, 1e-9); eq(stZ.scale, S.ZOOM_MIN);
pass('solid zoom clamps min/max');
throws(function () { S.zoomBy(S.createSolidState({}), 0); });
throws(function () { S.zoomBy(S.createSolidState({}), -1); });
throws(function () { S.zoomBy(S.createSolidState({}), NaN); });
pass('solid zoom non-positive/NaN throws');

// --- Projection (5) ---
var stP = S.createSolidState({});
var pts = S.project(stP, 130, 130);
eq(pts.length, 8); pass('solid project 8 points');
pts.forEach(function (p, i) {
  ok(isFinite(p.x) && isFinite(p.y) && isFinite(p.z), 'pt ' + i + ' finite');
});
pass('solid projected points finite');
var cx = 0, cy = 0;
pts.forEach(function (p) { cx += p.x; cy += p.y; });
near(cx / 8, 130, 1e-9, 'cx'); near(cy / 8, 130, 1e-9, 'cy');
pass('solid projection centered on stage');
function distinct2D(list) {
  var seen = {};
  list.forEach(function (p) { seen[p.x.toFixed(6) + ',' + p.y.toFixed(6)] = 1; });
  return Object.keys(seen).length;
}
eq(distinct2D(pts), 7);
pass('solid exact iso doubles near/far corner at center');
var stT = S.createSolidState({});
S.rotateBy(stT, 20, 13);
eq(distinct2D(S.project(stT, 130, 130)), 8);
pass('solid orbited pose shows 8 distinct dots');

// --- Hidden edges (5) ---
deep(S.faceVisibility(stP.yaw, stP.pitch),
  [true, false, false, true, false, true]);
pass('solid iso faces -X+Y+Z front');
var cls = S.classifyEdges(stP);
eq(cls.length, 12); pass('solid 12 classified edges');
var hid = cls.filter(function (e) { return e.hidden; });
eq(hid.length, 3); pass('solid iso exactly 3 hidden edges');
deep(hid.map(function (e) { return [e.a, e.b]; }), [[0, 1], [1, 3], [1, 5]]);
pass('solid hidden edges meet at far corner');
var badSweep = 0;
for (var yaw = -3; yaw <= 3.01; yaw += 0.37) {
  for (var pitch = -1.4; pitch <= 1.41; pitch += 0.31) {
    var hh = S.classifyEdges({ yaw: yaw, pitch: pitch })
      .filter(function (e) { return e.hidden; }).length;
    if (hh !== 3) badSweep++;
  }
}
eq(badSweep, 0); pass('solid 3 hidden edges across orbit sweep');

// --- Render (8) ---
function MockCtx() {
  return {
    calls: [],
    strokeStyle: null, fillStyle: null, lineWidth: 0, lineCap: null,
    lineJoin: null, globalAlpha: 1, dash: [],
    save: function () { this.calls.push('save'); },
    restore: function () { this.calls.push('restore'); },
    beginPath: function () { this.calls.push('beginPath'); },
    moveTo: function (x, y) { this.calls.push(['moveTo', x, y]); },
    lineTo: function (x, y) { this.calls.push(['lineTo', x, y]); },
    stroke: function () {
      this.calls.push(['stroke', this.strokeStyle, this.lineWidth, this.globalAlpha]);
    },
    arc: function (x, y, r) { this.calls.push(['arc', x, y, r]); },
    fill: function () { this.calls.push(['fill', this.fillStyle]); },
    setLineDash: function (d) { this.dash = d; this.calls.push(['dash', d.join(',')]); },
    fillRect: function () { this.calls.push('fillRect'); },
    clearRect: function () { this.calls.push('clearRect'); }
  };
}
function ofType(ctx, tag) {
  return ctx.calls.filter(function (c) { return c[0] === tag; });
}
var m0 = MockCtx();
var counts = S.render(m0, S.createSolidState({}));
deep(counts, { front: 9, hidden: 3, vertices: 8 });
pass('solid render counts 9/3/8');
eq(ofType(m0, 'lineTo').length, 12); pass('solid render strokes 12 edges');
eq(ofType(m0, 'arc').length, 8); pass('solid render draws 8 vertex dots');
ofType(m0, 'arc').forEach(function (c) { eq(c[3], 3, 'dot r'); });
pass('solid dots radius 3px');
var strokes = ofType(m0, 'stroke');
strokes.forEach(function (c) {
  eq(c[1], '#1e293b', 'ink'); eq(c[2], 1.75, 'width');
});
pass('solid edges ink #1e293b 1.75px');
eq(m0.lineCap, 'round'); pass('solid lineCap round');
var fills = ofType(m0, 'fill');
eq(fills.length, 8);
fills.forEach(function (c) { eq(c[1], '#0f172a', 'dot fill'); });
pass('solid dots filled #0f172a');
var dashes = ofType(m0, 'dash').filter(function (c) { return c[1] === '4,4'; });
eq(dashes.length, 3); pass('solid 3 dashed hidden strokes');
eq(m0.calls.indexOf('fillRect'), -1); pass('solid never paints background');

// --- Headless widget (2) ---
var stub = S.mountSolidWidget(null, {});
eq(stub.headless, true); eq(stub.mounted, true);
eq(stub.state.yaw, S.ISO_YAW_RAD);
pass('solid headless stub without DOM');
eq(stub.draw(), null); eq(stub.dispose(), null);
pass('solid headless draw/dispose safe');

// --- Mounted widget behavior via minimal fake DOM (8) ---
function FakeEl(tag) {
  return {
    tag: tag, children: [], listeners: {}, style: {}, dataset: {},
    className: '', textContent: '', width: 0, height: 0,
    offsetLeft: 0, offsetTop: 0, clientWidth: 0, clientHeight: 0,
    parentNode: null, _ctx: new MockCtx(),
    setAttribute: function (k, v) { this.dataset[k] = v; },
    appendChild: function (c) {
      c.parentNode = this; this.children.push(c); return c;
    },
    removeChild: function (c) {
      var i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      c.parentNode = null;
    },
    addEventListener: function (t, h) {
      (this.listeners[t] = this.listeners[t] || []).push(h);
    },
    removeEventListener: function (t, h) {
      var a = this.listeners[t] || [];
      var i = a.indexOf(h);
      if (i >= 0) a.splice(i, 1);
    },
    getContext: function () { return this._ctx; },
    fire: function (t, e) {
      (this.listeners[t] || []).slice().forEach(function (h) { h(e); });
    }
  };
}
function FakeEvt(o) {
  o = o || {};
  o.stopPropagation = function () { o.stopped = true; };
  o.preventDefault = function () { o.defaulted = true; };
  return o;
}
global.document = { createElement: function (t) { return new FakeEl(t); } };
var fakeBox = new FakeEl('div');
fakeBox.clientWidth = 1280;
fakeBox.clientHeight = 661;
var widget = S.mountSolidWidget(fakeBox, { size: 260 });
eq(widget.headless, false); eq(widget.mounted, true);
eq(widget.el.style.right, '24px'); eq(widget.el.style.top, '64px');
eq(widget.handle.textContent, '⠿ 3D Solid');
eq(fakeBox.children.length, 1);
pass('solid widget mounts top-right with handle pill');
var yawBefore = widget.state.yaw;
var cv0 = widget.canvas;
cv0.fire('pointerdown', FakeEvt({ button: 0, clientX: 100, clientY: 100 }));
cv0.fire('pointermove', FakeEvt({ clientX: 170, clientY: 140 }));
cv0.fire('pointerup', FakeEvt({ clientX: 170, clientY: 140 }));
near(widget.state.yaw, yawBefore + 70 * S.ORBIT_RAD_PER_PX, 1e-12, 'drag yaw');
pass('solid canvas drag orbits yaw/pitch');
widget.el.offsetLeft = 996;
widget.el.offsetTop = 64;
var grip0 = widget.handle;
grip0.fire('pointerdown', FakeEvt({ button: 0, clientX: 1126, clientY: 76 }));
eq(widget.el.style.left, '996px'); eq(widget.el.style.top, '64px');
eq(widget.el.style.right, 'auto');
pass('solid grip grab snapshots position without jumping');
grip0.fire('pointermove', FakeEvt({ clientX: 876, clientY: 256 }));
eq(widget.el.style.left, '746px'); eq(widget.el.style.top, '244px');
pass('solid grip drag moves widget by pointer delta');
grip0.fire('pointermove', FakeEvt({ clientX: -2000, clientY: 5000 }));
eq(widget.el.style.left, '0px'); eq(widget.el.style.top, '401px');
grip0.fire('pointerup', FakeEvt({}));
pass('solid grip drag clamps to sheet bounds');
widget.el.fire('wheel', FakeEvt({ deltaY: -240, clientX: 800, clientY: 300 }));
eq(widget.state.scale, S.ZOOM_STEP);
pass('solid wheel zooms projection');
widget.el.fire('dblclick', FakeEvt({ clientX: 800, clientY: 300 }));
eq(widget.state.yaw, S.ISO_YAW_RAD); eq(widget.state.pitch, S.ISO_PITCH_RAD);
eq(widget.state.scale, 1);
pass('solid double-click resets isometric view');
var isoEvt = FakeEvt({ button: 0, clientX: 10, clientY: 10 });
cv0.fire('pointerdown', isoEvt);
ok(isoEvt.stopped && isoEvt.defaulted, 'orbit down isolated');
var wEvt = FakeEvt({ deltaY: 100 });
widget.el.fire('wheel', wEvt);
ok(wEvt.stopped && wEvt.defaulted, 'wheel isolated');
widget.dispose();
eq(fakeBox.children.length, 0);
delete global.document;
pass('solid events isolated and dispose unmounts');

console.log('solid: ' + n + ' passed');

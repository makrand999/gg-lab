'use strict';
var assert = require('assert');
var S = require('../public/lib/educad-solid.js');

var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/42 ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

// --- Glass constants (3) ---
eq(S.GLASS_ZOOM_MIN, 0.08); eq(S.GLASS_ZOOM_MAX, 60);
eq(S.GLASS_PAN_MARGIN, 1.75);
pass('glass zoom limits 0.08..60');
eq(S.AURA_PX, 12); pass('glass aura margin 12px');
eq(S.GLASS_RADIUS_FRAC, 0.16);
eq(S.GLASS_RADIUS_MIN, 64); eq(S.GLASS_RADIUS_MAX, 200);
eq(S.GLASS_CLASS, 'educad-solid-glass');
eq(S.GLASS_CANVAS_CLASS, 'educad-solid-glass-canvas');
pass('glass radius + class constants');

// --- Glass state (5) ---
near(S.glassBaseRadius(1280, 661), 661 * 0.16, 1e-9, 'scales');
eq(S.glassBaseRadius(4000, 3000), 200);
eq(S.glassBaseRadius(200, 150), 64);
throws(function () { S.glassBaseRadius(0, 100); });
pass('glass base radius scales and clamps');
var rest = S.glassRestCenter(1280, 800, 128);
near(rest.x, 1280 - Math.max(190, 128 * 2.1), 1e-9, 'rest x');
near(rest.y, Math.max(170, 128 * 2.0), 1e-9, 'rest y');
ok(rest.x > 1280 / 2 && rest.y < 800 / 2, 'rest top-right');
var tiny = S.glassRestCenter(120, 100, 64);
ok(tiny.x >= 40 && tiny.x <= 80 && tiny.y >= 40 && tiny.y <= 60, 'tiny clamp');
pass('glass rest center top-right, clamped');
var gs = S.createGlassState({ w: 1280, h: 800 });
eq(gs.yaw, S.ISO_YAW_RAD); eq(gs.pitch, S.ISO_PITCH_RAD); eq(gs.scale, 1);
near(gs.baseR, 800 * 0.16, 1e-9, 'baseR');
eq(gs.w, 1280); eq(gs.h, 800);
eq(gs.minScale, S.GLASS_ZOOM_MIN); eq(gs.maxScale, S.GLASS_ZOOM_MAX);
near(gs.cx, S.glassRestCenter(1280, 800, gs.baseR).x, 1e-9, 'cx');
near(gs.cy, S.glassRestCenter(1280, 800, gs.baseR).y, 1e-9, 'cy');
eq(gs.status.available, true);
pass('glass state isometric defaults + rest center');
var gsDef = S.createGlassState({});
eq(gsDef.w, 800); eq(gsDef.h, 600);
throws(function () { S.createGlassState({ w: 0, h: 100 }); });
throws(function () { S.createGlassState({ w: 100, h: 100, scale: NaN }); });
pass('glass state defaults w/h, guards bad input');
near(S.projectionRadius(gs), 128, 1e-9, 'glass radius');
var leg = S.createGlassState === S.createSolidState ? null : S.createSolidState({});
near(S.projectionRadius(leg), 260 * 0.28, 1e-9, 'legacy radius');
eq(leg.baseR, undefined); eq(leg.minScale, undefined);
pass('projection radius prefers baseR, legacy unchanged');

// --- Pan / zoom / reset (6) ---
var zp = S.createGlassState({ w: 1000, h: 700 });
S.zoomBy(zp, 30);
eq(zp.scale, 30);
S.zoomBy(zp, 100);
eq(zp.scale, S.GLASS_ZOOM_MAX);
S.zoomBy(zp, 1e-9);
eq(zp.scale, S.GLASS_ZOOM_MIN);
var zl = S.createSolidState({});
S.zoomBy(zl, 100);
eq(zl.scale, S.ZOOM_MAX);
pass('zoomBy honors glass limits, legacy clamps intact');
var pn = S.createGlassState({ w: 1000, h: 700 });
var r0 = S.projectionRadius(pn);
var cx0 = pn.cx, cy0 = pn.cy;
S.panBy(pn, 10, -20);
near(pn.cx, cx0 + 10, 1e-9, 'pan x'); near(pn.cy, cy0 - 20, 1e-9, 'pan y');
S.panBy(pn, 1e6, 1e6);
var pm = S.GLASS_PAN_MARGIN * r0;
eq(pn.cx, 1000 + pm); eq(pn.cy, 700 + pm);
S.panBy(pn, -1e9, -1e9);
eq(pn.cx, -pm); eq(pn.cy, -pm);
pass('panBy slides and clamps center to [-m*r, w+m*r]');
// Any vertex reaches screen center at max zoom, across orbit poses;
// the model bbox still overlaps the sheet at the clamp extremes.
var reach = S.createGlassState({ w: 1000, h: 700, scale: 60 });
var rr = S.projectionRadius(reach);
var mgn = S.GLASS_PAN_MARGIN * rr;
for (var syaw = -3; syaw <= 3.01; syaw += 0.5) {
  for (var spitch = -1.4; spitch <= 1.41; spitch += 0.5) {
    reach.yaw = syaw; reach.pitch = spitch;
    var offs = S.project(reach, 0, 0);
    offs.forEach(function (p) {
      var nx2 = 500 - p.x, ny2 = 350 - p.y;
      ok(nx2 >= -mgn && nx2 <= 1000 + mgn, 'reach x');
      ok(ny2 >= -mgn && ny2 <= 700 + mgn, 'reach y');
    });
  }
}
ok(Math.sqrt(3) * rr < mgn, 'overlap strip survives');
pass('max zoom + pan reaches every vertex, keeps overlap');
var za = S.createGlassState({ w: 1000, h: 700, cx: 500, cy: 350 });
S.glassZoomAt(za, 600, 400, 2);
eq(za.scale, 2);
near(za.cx, 400, 1e-9, 'anchor x'); near(za.cy, 300, 1e-9, 'anchor y');
// Model point under cursor stays fixed: p = c + q*r invariant.
var qx = (600 - 500) / r0, qy = (400 - 350) / r0;
near(za.cx + qx * S.projectionRadius(za), 600, 1e-9, 'fixed x');
near(za.cy + qy * S.projectionRadius(za), 400, 1e-9, 'fixed y');
pass('glassZoomAt anchors the model point under the cursor');
var zc = S.createGlassState({ w: 1000, h: 700, scale: 60, cx: 500, cy: 350 });
S.glassZoomAt(zc, 600, 400, 2);
eq(zc.scale, 60); eq(zc.cx, 500); eq(zc.cy, 350);
throws(function () { S.glassZoomAt(zc, 0, 0, 0); });
pass('glassZoomAt clamped zoom holds center, bad factor throws');
var rv = S.createGlassState({ w: 1000, h: 700 });
S.rotateBy(rv, 40, 25); S.zoomBy(rv, 3); S.panBy(rv, 90, -60);
S.resetGlassView(rv);
eq(rv.yaw, S.ISO_YAW_RAD); eq(rv.pitch, S.ISO_PITCH_RAD); eq(rv.scale, 1);
near(rv.cx, S.glassRestCenter(1000, 700, rv.baseR).x, 1e-9, 'rcx');
near(rv.cy, S.glassRestCenter(1000, 700, rv.baseR).y, 1e-9, 'rcy');
pass('resetGlassView restores iso + scale + rest center');
var rs = S.createGlassState({ w: 2000, h: 1000 });
var rsBase = rs.baseR;
S.resizeGlassState(rs, 800, 600);
eq(rs.w, 800); eq(rs.h, 600); eq(rs.baseR, rsBase);
eq(rs.cx, 800 + S.GLASS_PAN_MARGIN * rsBase);
throws(function () { S.resizeGlassState(rs, -5, 10); });
pass('resizeGlassState tracks size, keeps base, clamps pan');

// --- Aura geometry (6) ---
eq(S.distPointSeg(0, 5, -10, 0, 10, 0), 5);
eq(S.distPointSeg(3, 0, -10, 0, 10, 0), 0);
eq(S.distPointSeg(15, 0, -10, 0, 10, 0), 5);
eq(S.distPointSeg(3, 4, 0, 0, 0, 0), 5);
pass('distPointSeg perpendicular/on/endpoint/degenerate');
var bf = S.createGlassState({ w: 1000, h: 700 });
var frame = S.buildGlassFrame(bf);
eq(frame.available, true);
eq(frame.pts.length, 8); eq(frame.edges.length, 12);
ok(frame.bbox && frame.bbox.minX < frame.bbox.maxX, 'bbox spans');
frame.pts.forEach(function (p, i) {
  ok(p.x >= frame.bbox.minX && p.x <= frame.bbox.maxX, 'pt ' + i + ' x');
  ok(p.y >= frame.bbox.minY && p.y <= frame.bbox.maxY, 'pt ' + i + ' y');
});
pass('buildGlassFrame projects cube + bbox');
var bu = S.createGlassState({ w: 1000, h: 700 });
S.setUnavailable(bu, 'missing-view', 'empty');
var uframe = S.buildGlassFrame(bu);
eq(uframe.available, false); eq(uframe.pts.length, 0);
eq(S.hitTestFrame(uframe, bu.cx, bu.cy), false);
pass('unavailable frame carries no aura');
var e0 = frame.edges[0];
var pa0 = frame.pts[e0[0]], pb0 = frame.pts[e0[1]];
var mx = (pa0.x + pb0.x) / 2, my = (pa0.y + pb0.y) / 2;
var edx = pb0.x - pa0.x, edy = pb0.y - pa0.y;
var elen = Math.sqrt(edx * edx + edy * edy);
var nx = -edy / elen, ny = edx / elen;
function minEdgeDist(x, y) {
  var m = Infinity;
  for (var i = 0; i < frame.edges.length; i++) {
    var a = frame.pts[frame.edges[i][0]], b = frame.pts[frame.edges[i][1]];
    var d = S.distPointSeg(x, y, a.x, a.y, b.x, b.y);
    if (d < m) m = d;
  }
  return m;
}
function minVertDist(x, y) {
  var m = Infinity;
  for (var j = 0; j < frame.pts.length; j++) {
    var dx = x - frame.pts[j].x, dy = y - frame.pts[j].y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < m) m = d;
  }
  return m;
}
eq(S.hitTestFrame(frame, mx, my), true);
var nearPt = { x: mx + nx * 5, y: my + ny * 5 };
near(minEdgeDist(nearPt.x, nearPt.y), 5, 1e-6, 'setup 5px');
eq(S.hitTestFrame(frame, nearPt.x, nearPt.y), true);
pass('aura hits on ink and within margin');
var farPt = { x: mx + nx * 20, y: my + ny * 20 };
ok(minEdgeDist(farPt.x, farPt.y) > S.AURA_PX, 'setup clear of ink');
ok(minVertDist(farPt.x, farPt.y) > S.AURA_PX + S.VERTEX_R_PX, 'clear of dots');
eq(S.hitTestFrame(frame, farPt.x, farPt.y), false);
eq(S.hitTestFrame(frame, 5, 5), false);
eq(S.hitTestFrame(frame, NaN, 0), false);
eq(S.hitTestFrame(null, 0, 0), false);
pass('aura misses past margin, far corner, bad input');
var dotGeo = S.createGeometry({
  name: 'point', vertices: [{ x: 0, y: 0, z: 0 }], edges: [], faces: []
});
var ds = S.createGlassState({ w: 1000, h: 700, geometry: dotGeo });
var dframe = S.buildGlassFrame(ds);
eq(dframe.pts.length, 1); eq(dframe.edges.length, 0);
eq(S.hitTestFrame(dframe, dframe.cx, dframe.cy), true);
eq(S.hitTestFrame(dframe, dframe.cx + 10, dframe.cy), true);
eq(S.hitTestFrame(dframe, dframe.cx + 20, dframe.cy), false);
ok(minEdgeDist(nearPt.x, nearPt.y) > 2, 'setup past aura 2');
eq(S.hitTestFrame(frame, nearPt.x, nearPt.y, 2), false);
pass('lone vertex aura + custom aura radius');

// --- Batched render (4) ---
function MockCtx() {
  return {
    calls: [],
    strokeStyle: null, fillStyle: null, lineWidth: 0, lineCap: null,
    lineJoin: null, globalAlpha: 1, font: null, dash: [],
    connectedArcs: 0, hasCurrent: false, curX: 0, curY: 0,
    save: function () { this.calls.push('save'); },
    restore: function () { this.calls.push('restore'); },
    beginPath: function () { this.calls.push('beginPath'); this.hasCurrent = false; },
    moveTo: function (x, y) {
      this.calls.push(['moveTo', x, y]);
      this.hasCurrent = true; this.curX = x; this.curY = y;
    },
    lineTo: function (x, y) {
      this.calls.push(['lineTo', x, y]);
      this.hasCurrent = true; this.curX = x; this.curY = y;
    },
    stroke: function () {
      this.calls.push(['stroke', this.strokeStyle, this.lineWidth, this.globalAlpha]);
    },
    // Canvas arc() connects the current point to the arc start with a
    // straight line; a batched dot pass must moveTo the arc start
    // first, otherwise fill() paints the polygon between the dots.
    arc: function (x, y, r) {
      var sx = x + r, sy = y; // angle 0 start of the arc
      if (this.hasCurrent && (this.curX !== sx || this.curY !== sy)) {
        this.connectedArcs++;
      }
      this.hasCurrent = true; this.curX = sx; this.curY = sy;
      this.calls.push(['arc', x, y, r]);
    },
    fill: function () { this.calls.push(['fill', this.fillStyle]); },
    fillText: function (t, x, y) { this.calls.push(['fillText', t, x, y]); },
    setLineDash: function (d) { this.dash = d; this.calls.push(['dash', d.join(',')]); },
    setTransform: function () { this.calls.push('setTransform'); },
    clearRect: function () { this.calls.push('clearRect'); }
  };
}
function ofType(ctx, tag) {
  return ctx.calls.filter(function (c) { return c[0] === tag; });
}
var legacyCounts = S.render(MockCtx(), S.createSolidState({}));
var fastCounts = S.renderFast(MockCtx(), S.createSolidState({}));
deep(fastCounts, legacyCounts);
deep(fastCounts, { front: 9, hidden: 3, vertices: 8 });
pass('renderFast matches render counts 9/3/8');
var wire = S.createGeometry({
  name: 'wire', vertices: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }],
  edges: [[0, 1]], faces: []
});
deep(S.renderFast(MockCtx(), S.createSolidState({ geometry: wire })),
  { front: 1, hidden: 0, vertices: 2 });
pass('renderFast draws faceless wire solid');
var fm = MockCtx();
S.renderFast(fm, S.createSolidState({}));
eq(ofType(fm, 'lineTo').length, 12);
eq(ofType(fm, 'arc').length, 8);
ok(ofType(fm, 'stroke').length <= 2, 'batched strokes');
eq(ofType(fm, 'fill').length, 1);
eq(fm.calls.indexOf('fillRect'), -1);
pass('renderFast batches: <=2 strokes, 1 fill, no background');
// Regression: batched vertex dots must not connect into one subpath
// (that made fill() paint the caps between them, black caps on the
// cylinder/prism). Every arc needs its own moveTo.
eq(fm.connectedArcs, 0, 'no arc connectors in dot pass');
var fmCyl = MockCtx();
var K = 24, cverts = [], cedges = [], cfaces = [];
for (var ci = 0; ci < K; ci++) {
  var ca = ci / K * 2 * Math.PI;
  cverts.push({ x: Math.cos(ca), y: -1, z: Math.sin(ca) });
}
for (ci = 0; ci < K; ci++) {
  var cb = ci / K * 2 * Math.PI;
  cverts.push({ x: Math.cos(cb), y: 1, z: Math.sin(cb) });
}
for (ci = 0; ci < K; ci++) {
  var cn = (ci + 1) % K;
  cedges.push([ci, cn], [ci + K, cn + K], [ci, ci + K]);
}
var cbottom = [], ctop = [];
for (ci = 0; ci < K; ci++) { cbottom.push(ci); ctop.push(ci + K); }
cfaces.push(cbottom, ctop);
for (ci = 0; ci < K; ci++) {
  var cj = (ci + 1) % K;
  cfaces.push([ci, cj, cj + K, ci + K]);
}
var cylGeo = S.createGeometry({
  name: 'cylinder', vertices: cverts, edges: cedges, faces: cfaces
});
var fmWire = MockCtx();
S.renderFast(fmWire, S.createSolidState({ geometry: cylGeo }));
eq(ofType(fmWire, 'arc').length, 48);
eq(fmWire.connectedArcs, 0, 'cylinder dots stay separate');
eq(ofType(fmWire, 'fill').length, 1);
var fmLegacy = MockCtx();
S.render(fmLegacy, S.createSolidState({ geometry: cylGeo }));
eq(fmLegacy.connectedArcs, 0, 'legacy render stays separate');
pass('cylinder dot pass keeps 48 isolated dots');
var us = S.createSolidState({});
S.setUnavailable(us, 'missing-view', 'empty');
deep(S.renderFast(MockCtx(), us),
  { front: 0, hidden: 0, vertices: 0, unavailable: 'missing-view' });
eq(S.renderFast(null, us), null);
pass('renderFast unavailable + null ctx');

// --- Headless glass mount (2) ---
var gstub = S.mountSolidGlass(null, {});
eq(gstub.headless, true); eq(gstub.mounted, true);
eq(gstub.state.yaw, S.ISO_YAW_RAD);
eq(gstub.frameOf(), null);
pass('glass headless stub without DOM');
eq(gstub.draw(), null); eq(gstub.dispose(), null);
eq(gstub.hitTest(10, 10), false);
eq(gstub.orbitBy(5, 5), gstub.state);
eq(gstub.resize(1, 1), gstub.state);
pass('glass headless methods safe no-ops');

// --- Mounted glass via minimal fake DOM (8) ---
function FakeEl(tag) {
  return {
    tag: tag, children: [], style: {}, dataset: {},
    className: '', width: 0, height: 0,
    clientWidth: 0, clientHeight: 0, parentNode: null,
    _ctx: new MockCtx(), _rect: { left: 0, top: 0 },
    setAttribute: function (k, v) { this.dataset[k] = v; },
    appendChild: function (c) {
      c.parentNode = this; this.children.push(c); return c;
    },
    removeChild: function (c) {
      var i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      c.parentNode = null;
    },
    getContext: function () { return this._ctx; },
    getBoundingClientRect: function () { return this._rect; }
  };
}
global.document = { createElement: function (t) { return new FakeEl(t); } };
var fakeBox = new FakeEl('div');
var glass = S.mountSolidGlass(fakeBox, { w: 1000, h: 700, dpr: 1 });
eq(glass.headless, false); eq(glass.mounted, true);
eq(glass.el.className, S.GLASS_CLASS);
eq(glass.el.style.pointerEvents, 'none');
eq(glass.canvas.className, S.GLASS_CANVAS_CLASS);
eq(glass.canvas.style.pointerEvents, 'none');
eq(glass.canvas.style.width, '1000px');
eq(glass.canvas.style.height, '700px');
eq(glass.canvas.width, 1000);
eq(glass.el.style.width, '1000px');
eq(fakeBox.children.length, 1);
pass('glass mounts fullscreen transparent passthrough sheet');
deep(glass.draw(), { front: 9, hidden: 3, vertices: 8 });
ok(glass.frameOf() && glass.frameOf().available, 'frame cached');
pass('glass draw renders cube + caches aura frame');
var gv = glass.frameOf().pts[0];
eq(glass.hitTest(gv.x, gv.y), true);
eq(glass.hitTest(5, 5), false);
glass.canvas._rect = { left: 10, top: 20 };
glass.draw();
eq(glass.hitTest(gv.x + 10, gv.y + 20), true);
pass('glass hitTest on vertex, miss far, honors canvas offset');
var gyaw = glass.state.yaw;
glass.orbitBy(10, 0);
near(glass.state.yaw, gyaw + 10 * S.ORBIT_RAD_PER_PX, 1e-12, 'orbit');
var gcx = glass.state.cx, gcy = glass.state.cy;
glass.panBy(20, 10);
near(glass.state.cx, gcx + 20, 1e-9, 'pan x');
near(glass.state.cy, gcy + 10, 1e-9, 'pan y');
pass('glass orbitBy/panBy move state');
var acx = glass.state.cx, acy = glass.state.cy;
glass.zoomAt(acx + 10, acy + 20, 2);
eq(glass.state.scale, 2);
near(glass.state.cx, acx, 1e-9, 'anchored x');
near(glass.state.cy, acy, 1e-9, 'anchored y');
pass('glass zoomAt scales anchored at cursor');
glass.resetView();
eq(glass.state.yaw, S.ISO_YAW_RAD);
eq(glass.state.pitch, S.ISO_PITCH_RAD);
eq(glass.state.scale, 1);
near(glass.state.cx,
  S.glassRestCenter(1000, 700, glass.state.baseR).x, 1e-9, 'rest x');
pass('glass resetView restores rest pose');
glass.resize(500, 400);
eq(glass.state.w, 500); eq(glass.state.h, 400);
eq(glass.canvas.style.width, '500px');
eq(glass.state.cx, 500 + S.GLASS_PAN_MARGIN * glass.state.baseR);
pass('glass resize tracks sheet, clamps pan');
var box2 = S.createGeometry({
  name: 'box2',
  vertices: S.defaultGeometry().vertices,
  edges: S.defaultGeometry().edges,
  faces: S.defaultGeometry().faces
});
S.setGeometry(glass, box2);
eq(glass.el.dataset['data-solid'], 'box2');
deep(glass.draw(), { front: 9, hidden: 3, vertices: 8 });
S.setUnavailable(glass, 'missing-view', 'empty');
var unc = glass.draw();
eq(unc.unavailable, 'missing-view');
eq(glass.hitTest(glass.state.cx, glass.state.cy), false);
pass('glass setGeometry/setUnavailable bridge + aura clears');
glass.dispose();
eq(fakeBox.children.length, 0);
eq(glass.frameOf(), null);
delete global.document;
pass('glass dispose unmounts and drops frame');

// --- Double-tap reset tracker (5) ---
eq(S.TAP_WINDOW_MS, 450); eq(S.TAP_SLOP_PX, 8);
pass('glass tap constants 450ms/8px');
var tap = S.createTapState();
eq(tap.armed, false);
eq(S.tapHit(tap, 1000, 50, 60), false);
eq(tap.armed, true);
eq(S.tapHit(tap, 1200, 52, 61), true);
eq(tap.armed, false);
pass('glass tapHit pairs two quick presses');
var tap2 = S.createTapState();
eq(S.tapHit(tap2, 1000, 0, 0), false);
eq(S.tapHit(tap2, 1000 + S.TAP_WINDOW_MS + 1, 0, 0), false);
eq(S.tapHit(tap2, 1000 + S.TAP_WINDOW_MS + 2, 0, 0), true);
pass('glass tapHit timeout misses then re-arms');
var tap3 = S.createTapState();
eq(S.tapHit(tap3, 2000, 100, 100), false);
eq(S.tapHit(tap3, 2100, 100 + S.TAP_SLOP_PX + 1, 100), false);
pass('glass tapHit distance miss re-arms');
var tap4 = S.createTapState();
eq(S.tapHit(tap4, 3000, 10, 10), false);
S.invalidateTap(tap4);
eq(S.tapHit(tap4, 3100, 10, 10), false);
eq(tap4.armed, true);
throws(function () { S.tapHit(tap4, NaN, 0, 0); });
pass('glass invalidateTap breaks pair, NaN throws');

console.log('glass: ' + n + ' passed');

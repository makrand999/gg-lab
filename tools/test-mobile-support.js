'use strict';
// Mobile View/Pose support: Node contract suite. Zero deps. Run:
//   node tools/test-mobile-support.js
// Three sections. FOUNDATION pins the existing pure math and gates the
// mobile UI reuses (modes, pose gestures/snap/datum clamp, 2D viewport
// and 3D camera transforms, tap picks, history and command read-only
// gates). MOBILE unit-tests the EduCADMobile pure helpers (verdict,
// layout, fit, gesture tracker, pose values, null shell). DISCOVERY
// fails clearly if the mobile module ever goes missing. See
// docs/MOBILE_SUPPORT_TEST_PLAN.md.
var assert = require('assert');
var M = require('../public/lib/educad-measure.js');
var P = require('../public/lib/educad-pose.js');
var V = require('../public/lib/educad-viewport.js');
var S = require('../public/lib/educad-solid.js');
var R = require('../public/lib/educad-spatial.js');
var E = require('../public/lib/educad-entities.js');
var Sv = require('../public/lib/educad-saves.js');
var D = require('../public/lib/educad-drafting.js');
var C = require('../public/lib/educad-command.js');
var MB = null, MB_LOAD_ERROR = null;
try {
  MB = require('../public/lib/educad-mobile.js');
} catch (error) {
  MB_LOAD_ERROR = error;
}
function needMB() {
  if (!MB) {
    throw new Error('MISSING mobile helper module: ' +
      (MB_LOAD_ERROR && MB_LOAD_ERROR.code === 'MODULE_NOT_FOUND' ? 'absent' :
        String(MB_LOAD_ERROR && MB_LOAD_ERROR.message || MB_LOAD_ERROR)) +
      '. Land public/lib/educad-mobile.js (Node-safe require, pure helpers).');
  }
  return MB;
}

var results = [];
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }
function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, msg + ' (' + a + ' vs ' + b + ')');
}
function nearEach(a, b, eps, msg) {
  eq(a.length, b.length, msg + ' length');
  for (var i = 0; i < a.length; i++) near(a[i], b[i], eps, msg + '[' + i + ']');
}
async function test(name, fn) {
  try {
    var evidence = await fn();
    results.push({ name: name, status: 'PASS', evidence: evidence || null });
    console.log('PASS ' + name);
  } catch (error) {
    results.push({ name: name, status: 'FAIL', evidence: String(error && error.message || error) });
    console.log('FAIL ' + name + ': ' + (error && error.message || error));
  }
}
function flushTick() { return Promise.resolve(); }

async function main() {
  // ---- FOUNDATION: mode guards (plan A3-A5) ----
  await test('modes: unknown ignored, switch drops pick, pose is view-like', function () {
    var st = M.createViewState();
    deep(st, { mode: 'edit', inspectId: null, inspectSide: null }, 'fresh state');
    ok(M.isEdit(st) && !M.isView(st) && !M.isPose(st), 'edit is not view-like');
    ok(M.isEdit(null) && !M.isView(null) && !M.isPose(null), 'missing state reads as edit');
    eq(M.setMode(st, 'bogus'), 'edit', 'unknown mode ignored');
    eq(st.mode, 'edit', 'mode unchanged');
    M.setInspect(st, 'e1', 1);
    eq(M.setMode(st, 'view'), 'view', 'enters view');
    eq(st.inspectId, null, 'switch drops pick');
    eq(st.inspectSide, null, 'switch drops side');
    ok(M.isView(st) && !M.isPose(st) && !M.isEdit(st), 'view flags');
    eq(M.setMode(st, 'pose'), 'pose', 'enters pose');
    ok(M.isView(st) && M.isPose(st), 'pose takes read-only branches');
    return { modes: [M.MODE_EDIT, M.MODE_VIEW, M.MODE_POSE] };
  });

  // ---- FOUNDATION: pose core math (plan E2) ----
  await test('pose core: clone detaches, scale/rotation about center, input pure', function () {
    var p0 = P.createPose();
    deep(p0.t, [0, 0, 0], 'zero shift');
    deep(p0.rm, [1, 0, 0, 0, 1, 0, 0, 0, 1], 'identity spin');
    eq(p0.s, 1, 'unit scale');
    ok(P.isIdentityPose(p0), 'fresh is identity');
    var pc = P.clonePose(p0);
    pc.t[0] = 5; pc.rm[0] = 0; pc.s = 3;
    deep(p0.t, [0, 0, 0], 'clone detaches t');
    eq(p0.rm[0], 1, 'clone detaches rm');
    eq(p0.s, 1, 'clone detaches s');
    throws(function () { P.clonePose(null); }, 'null pose');
    var grown = P.applyPose([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
      { t: [0, 0, 0], rm: p0.rm, s: 2 }, { x: 1, y: 0, z: 0 });
    deep(grown, [{ x: -1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], 'scale about center');
    var z90 = P.axisAngleMatrix(0, 0, 1, Math.PI / 2);
    var twice = P.rotateAboutAxis(P.rotateAboutAxis(p0.rm, [0, 0, 1], Math.PI / 2), [0, 0, 1], Math.PI / 2);
    near(twice[0], -1, 1e-9, 'two quarters flip x');
    near(twice[4], -1, 1e-9, 'two quarters flip y');
    near(z90[1], -1, 1e-9, 'quarter turn');
    var dirty = { t: [4, 5, 6], rm: z90.slice(), s: 2 };
    P.clearTranslation(dirty);
    deep(dirty.t, [0, 0, 0], 'clear t');
    ok(!P.isIdentityPose(dirty), 'still posed');
    P.clearRotation(dirty); P.clearScale(dirty);
    ok(P.isIdentityPose(dirty), 'clears compose to identity');
    var frozen = [{ x: 4, y: 5, z: 6 }];
    P.applyPose(frozen, { t: [9, 9, 9], rm: z90, s: 3 }, { x: 0, y: 0, z: 0 });
    deep(frozen, [{ x: 4, y: 5, z: 6 }], 'input untouched');
    return { contactEps: P.CONTACT_EPS };
  });

  // ---- FOUNDATION: pose gesture mapping, the slider backend (plan E1-E2) ----
  await test('pose gestures: axis projection, snap steps, scale clamp, purity', function () {
    var ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    var cam = { yaw: 0, pitch: 0 };
    ['grab', 'rotate', 'scale'].forEach(function (op) {
      eq(P.startGesture(op).op, op, 'starts ' + op);
    });
    throws(function () { P.startGesture('bogus'); }, 'unknown op');
    var g = P.startGesture('grab');
    P.setGestureAxis(g, 'X');
    eq(g.axis, 'X', 'axis locks');
    throws(function () { P.setGestureAxis(g, 'W'); }, 'bad axis');
    throws(function () { P.setGestureAxis(null, 'X'); }, 'gesture needed');
    var start = { t: [0, 0, 0], rm: ID.slice(), s: 1 };
    var moved = P.applyGesture(start, g, 100, 50, cam, { pxPerMm: 10, snap: false });
    deep(moved.t, [10, 0, 0], 'X lock drops cross-axis travel');
    deep(start.t, [0, 0, 0], 'start pose untouched');
    var free = P.applyGesture(start, P.startGesture('grab'), 100, 50, cam, { pxPerMm: 10, snap: false });
    deep(free.t, [10, -5, 0], 'free grab maps screen basis');
    var snapped = P.applyGesture(start, g, 103, 0, cam, { pxPerMm: 10, snap: true });
    eq(snapped.t[0], Math.round(10.3 / P.SNAP_MM) * P.SNAP_MM, 'move snaps to SNAP_MM');
    var rz = P.startGesture('rotate'); P.setGestureAxis(rz, 'Z');
    var turned = P.applyGesture(start, rz, 100, 0, cam, { pxPerMm: 10, snap: false });
    nearEach(turned.rm, P.axisAngleMatrix(0, 0, 1, 100 * P.RAD_PER_PX), 1e-9, 'rotate angle');
    var rx = P.startGesture('rotate'); P.setGestureAxis(rx, 'X');
    var rsnap = P.applyGesture(start, rx, (7 * Math.PI / 180) / P.RAD_PER_PX, 0, cam, { pxPerMm: 10, snap: true });
    nearEach(rsnap.rm, P.axisAngleMatrix(1, 0, 0, 5 * Math.PI / 180), 1e-9, 'rotate snaps to SNAP_DEG');
    var grown = P.applyGesture(start, P.startGesture('scale'), 0, -100, cam, { pxPerMm: 10, snap: false });
    near(grown.s, Math.exp(100 * P.SCALE_PER_PX), 1e-9, 'scale factor');
    var ssnap = P.applyGesture(start, P.startGesture('scale'), 0, -100, cam, { pxPerMm: 10, snap: true });
    eq(ssnap.s, Math.round(grown.s / P.SNAP_SCALE) * P.SNAP_SCALE, 'scale snaps to SNAP_SCALE');
    eq(P.applyGesture(start, P.startGesture('scale'), 0, 1e6, cam, { pxPerMm: 10 }).s, P.SCALE_MIN, 'scale floor');
    eq(P.applyGesture(start, P.startGesture('scale'), 0, -1e6, cam, { pxPerMm: 10 }).s, P.SCALE_MAX, 'scale ceiling');
    throws(function () { P.applyGesture(start, g, 1, 1, cam, {}); }, 'pxPerMm required');
    throws(function () { P.applyGesture(start, g, 1, 1, null, { pxPerMm: 10 }); }, 'camera required');
    return { snapMm: P.SNAP_MM, snapDeg: P.SNAP_DEG, snapScale: P.SNAP_SCALE };
  });

  // ---- FOUNDATION: datum clamp (plan E2) ----
  await test('datum clamp: XY wall, contact pairs, identity follow', function () {
    eq(P.limitFraction(function (f) { return f; }, function () { return true; }), 1, 'valid gesture keeps full travel');
    var half = P.limitFraction(function (f) { return f; }, function (p) { return p <= 0.5; });
    near(half, 0.5, 0.001, 'bisection finds the wall');
    throws(function () { P.limitFraction(null, function () { return true; }); }, 'poseAt required');
    eq(P.holdsSide(10, -5, 'elev'), false, 'elevation cannot sink');
    eq(P.holdsSide(10, 0, 'elev'), true, 'elevation may touch');
    eq(P.holdsSide(-10, 5, 'plan'), false, 'plan cannot rise');
    eq(P.holdsSide(-10, 0, 'plan'), true, 'plan may touch');
    eq(P.holdsSide(10, -5), false, 'rest sign defaults the side');
    throws(function () { P.holdsSide(1, 1, 'side'); }, 'bad side');
    var rest = { elev: { pts: [{ x: 0, y: 10 }] }, plan: { pts: [{ x: 0, y: -10 }] } };
    var posed = { elev: { pts: [{ x: 1, y: 9 }] }, plan: { pts: [{ x: 1, y: -11 }] } };
    var pairs = P.projectionPairs(rest, posed);
    eq(pairs.length, 2, 'one pair per vertex');
    deep(pairs[0], { ry: 10, py: 9, side: 'elev' }, 'elev pair');
    deep(pairs[1], { ry: -10, py: -11, side: 'plan' }, 'plan pair');
    throws(function () {
      P.projectionPairs(rest, { elev: { pts: [] }, plan: { pts: [{ x: 0, y: 0 }] } });
    }, 'lengths must match');
    var verts = [{ x: 0, y: 10, z: 5 }, { x: 20, y: 30, z: 15 }, { x: 4, y: 40, z: 25 }];
    var rest2D = P.reproject(verts, [[0, 1], [1, 2]]);
    var sims = P.simsForPose(verts, [[0, 1], [1, 2]], P.createPose(), P.bboxCenter(verts), rest2D);
    ['elev', 'plan'].forEach(function (side) {
      near(sims[side].angle, 0, 1e-9, side + ' identity angle');
      near(sims[side].sx, 1, 1e-9, side + ' identity sx');
      near(sims[side].sy, 1, 1e-9, side + ' identity sy');
      near(sims[side].tx, 0, 1e-9, side + ' identity tx');
      near(sims[side].ty, 0, 1e-9, side + ' identity ty');
    });
    return { pairSides: pairs.map(function (p) { return p.side; }) };
  });

  // ---- FOUNDATION: 3D camera math, the touch-3D backend (plan D2) ----
  await test('solid camera: orbit clamp, anchored zoom, pan, tap semantics', function () {
    var g = S.createGeometry({
      vertices: [{ x: 100, y: 25, z: 40 }, { x: 130, y: 65, z: 40 }],
      edges: [[0, 1]], faces: []
    });
    var st = S.createGlassState({ w: 800, h: 600 });
    S.setGeometry(st, g);
    var yaw0 = st.yaw;
    S.rotateBy(st, 10, 0);
    near(st.yaw - yaw0, 10 * S.ORBIT_RAD_PER_PX, 1e-12, 'yaw rate');
    S.rotateBy(st, 0, 1e6);
    eq(st.pitch, S.PITCH_LIMIT_RAD, 'pitch ceiling');
    S.rotateBy(st, 0, -1e6);
    eq(st.pitch, -S.PITCH_LIMIT_RAD, 'pitch floor');
    var s0 = st.scale;
    S.zoomBy(st, 2);
    near(st.scale, s0 * 2, 1e-12, 'zoom multiplies');
    throws(function () { S.zoomBy(st, 0); }, 'zoom needs positive factor');
    var p0 = S.project(st, st.cx, st.cy)[0];
    var zx0 = st.cx, zy0 = st.cy, zs0 = st.scale;
    S.glassZoomAt(st, p0.x, p0.y, 2);
    var p1 = S.project(st, st.cx, st.cy)[0];
    near(p1.x, p0.x, 1e-6, 'zoom anchors cursor x');
    near(p1.y, p0.y, 1e-6, 'zoom anchors cursor y');
    S.glassZoomAt(st, p0.x, p0.y, 0.5);
    near(st.scale, zs0, 1e-9, 'zoom inverts scale');
    near(st.cx, zx0, 1e-6, 'zoom inverts center x');
    near(st.cy, zy0, 1e-6, 'zoom inverts center y');
    var cx0 = st.cx, cy0 = st.cy;
    S.panBy(st, 5, -3);
    eq(st.cx, cx0 + 5, 'pan x');
    eq(st.cy, cy0 - 3, 'pan y');
    S.resetGlassView(st);
    eq(st.scale, 1, 'reset restores unit scale');
    near(st.yaw, S.ISO_YAW_RAD, 1e-12, 'reset restores yaw');
    near(st.pitch, S.ISO_PITCH_RAD, 1e-12, 'reset restores pitch');
    S.zoomBy(st, 1.5);
    S.resizeGlassState(st, 390, 844);
    eq(st.w, 390, 'phone width tracked');
    eq(st.h, 844, 'phone height tracked');
    near(st.scale, 1.5, 1e-12, 'resize keeps scale');
    var tap = S.createTapState();
    eq(S.tapHit(tap, 1000, 50, 60), false, 'first press arms');
    eq(S.tapHit(tap, 1200, 52, 61), true, 'pair inside window+slop taps');
    eq(S.tapHit(tap, 1300, 52, 61), false, 'tap consumes the pair');
    S.invalidateTap(tap);
    eq(S.tapHit(tap, 1350, 52, 61), false, 'moved press is not a tap');
    eq(S.tapHit(tap, 1400, 500, 500), false, 'far press re-arms');
    eq(S.tapHit(tap, 1400 + S.TAP_WINDOW_MS, 500, 500), false, 'stale press re-arms');
    return { orbitPerPx: S.ORBIT_RAD_PER_PX, tapWindowMs: S.TAP_WINDOW_MS };
  });

  // ---- FOUNDATION: 2D viewport math, the touch-2D backend (plan D1/B2) ----
  await test('viewport: round trip, anchored zoom, pan, resize', function () {
    var v = V.createViewport({ s: 2, tx: 100, ty: 200, w: 800, h: 600 });
    var w = { x: 3.5, y: -12.25 };
    var back = V.inverse(v, V.forward(v, w));
    near(back.x, w.x, 1e-9, 'round trip x');
    near(back.y, w.y, 1e-9, 'round trip y');
    var c = { x: 123, y: 456 };
    var before = V.inverse(v, c);
    var nv = V.zoomAt(v, c, 2);
    eq(nv.s, 4, 'zoom multiplies');
    var after = V.inverse(nv, c);
    near(after.x, before.x, 1e-9, 'zoom anchors cursor x');
    near(after.y, before.y, 1e-9, 'zoom anchors cursor y');
    eq(V.zoomAt(v, c, 1e9).s, V.SCALE_MAX, 'zoom ceiling');
    eq(V.zoomAt(v, c, 1e-9).s, V.SCALE_MIN, 'zoom floor');
    throws(function () { V.zoomAt(v, c, 0); }, 'zoom needs positive factor');
    var pv = V.panBy(v, 7, -9);
    eq(pv.tx, 107, 'pan x');
    eq(pv.ty, 191, 'pan y');
    eq(pv.s, v.s, 'pan keeps scale');
    var rv = V.resize(v, 390.7, 843.2);
    eq(rv.w, 391, 'resize rounds w');
    eq(rv.h, 843, 'resize rounds h');
    eq(rv.s, v.s, 'resize keeps scale');
    return { scaleMin: V.SCALE_MIN, scaleMax: V.SCALE_MAX };
  });

  // ---- FOUNDATION: tap-to-inspect picks (plan D1/D2) ----
  await test('tap pick: nearest point wins, hidden skipped, bad input null', function () {
    var t = E.createTable();
    var a = t.create('POINT', { x: 0, y: 20 });
    t.create('POINT', { x: 40, y: 20 });
    var view = { s: 2, tx: 100, ty: 200 };
    var onA = V.forward(view, { x: 0, y: 20 });
    eq(M.hitTestAll(t.list(), onA, view, 14), a.id, 'tap on point picks it');
    eq(M.hitTestAll(t.list(), { x: 0, y: 0 }, view, 14), null, 'empty tap clears');
    eq(M.hitTestAll(t.list(), { x: 130, y: 160 }, view, 60), a.id, 'nearest wins');
    var ghost = t.create('POINT', { x: 0, y: 20, visible: false });
    eq(ghost.visible, false, 'hidden flag stored');
    eq(M.hitTestAll(t.list(), onA, view, 14), a.id, 'hidden point never picks');
    eq(M.hitTestAll(null, onA, view, 14), null, 'null table safe');
    eq(M.hitTestAll(t.list(), null, view, 14), null, 'null cursor safe');
    eq(M.hitTestAll(t.list(), onA, null, 14), null, 'null view safe');
    eq(M.hitTestAll(t.list(), onA, view, -1), null, 'negative tol safe');
    return { picked: a.id };
  });

  // ---- FOUNDATION: 3D tap pick incl. empty model (plan D2/F1) ----
  await test('spatial pick: vertex at cursor wins, empty model safe', function () {
    var g = S.createGeometry({
      vertices: [{ x: 100, y: 25, z: 40 }, { x: 130, y: 65, z: 40 }],
      edges: [[0, 1]], faces: []
    });
    var st = S.createGlassState({ w: 800, h: 600 });
    eq(R.pick(st, 10, 10, S), null, 'no geometry, no pick');
    S.setGeometry(st, g);
    var px = R.projectMm(g.vertices[0], st, S);
    var hit = R.pick(st, px.x, px.y, S);
    deep(hit, { kind: 'point', index: 0 }, 'tap on vertex picks it');
    eq(R.pick(st, -5000, -5000, S), null, 'empty tap clears');
    return { hit: hit };
  });

  // ---- FOUNDATION: history semantics behind pose exit (plan E4) ----
  await test('history: cancel restores base silently, undo round-trips', async function () {
    var t = E.createTable();
    var h = D.createHistory(t, function (snap) {
      Sv.restoreTable(E, t, { entities: snap });
    });
    var a = t.create('POINT', { x: 0, y: 10 });
    await flushTick();
    deep(h.counts(), { undo: 1, redo: 0 }, 'one gesture stacked');
    var counts = h.counts();
    var before = JSON.stringify(t.list());
    h.begin();
    t.update(a.id, { x: 99 });
    await flushTick();
    h.cancel();
    eq(t.get(a.id).x, 0, 'cancel rolls back the preview');
    deep(h.counts(), counts, 'cancel leaves the stacks alone');
    eq(JSON.stringify(t.list()), before, 'cancel restores the sheet exactly');
    ok(h.undo(), 'undoes');
    eq(t.count(), 0, 'undo empties the gesture');
    ok(h.redo(), 'redoes');
    eq(JSON.stringify(t.list()), before, 'redo restores the sheet exactly');
    return { counts: h.counts() };
  });

  // ---- FOUNDATION: command read-only gate (plan A4) ----
  await test('command gate: read-only bars mutating lines only', function () {
    var t = E.createTable();
    var ro = { table: t, readOnly: true };
    var r1 = C.execute('/point a 0 30 elevation', ro);
    eq(r1.ok, false, 'point barred');
    ok(/read-only/.test(r1.message), 'read-only message');
    eq(C.execute('/demo 3view', ro).ok, false, 'demo barred');
    eq(C.execute('/tutorial square', ro).ok, false, 'tutorial barred');
    eq(t.count(), 0, 'barred lines leave the table alone');
    eq(C.execute('/help', ro).ok, true, 'help stays');
    var rw = { table: t };
    var r2 = C.execute('/point a 0 30 elevation', rw);
    eq(r2.ok, true, 'point runs when writable, got: ' + r2.message);
    ok(t.count() >= 1, 'table grows');
    return { gated: ['point', 'demo', 'tutorial'] };
  });

  // ---- DISCOVERY: mobile helper module ----
  await test('DISCOVERY: mobile helper module loads Node-safe', function () {
    var mb = needMB();
    var keys = Object.keys(mb).sort();
    ok(keys.length > 10, 'exports inventoried');
    return { module: '../public/lib/educad-mobile.js', exports: keys };
  });

  // ---- MOBILE: inspection verdict (plan A) ----
  await test('mobile verdict: touch-only input, never space or laptops', function () {
    var mb = needMB();
    eq(mb.detectTouchOnly({ coarse: true, fine: false }), true, 'coarse-only inspects');
    eq(mb.detectTouchOnly({ coarse: true, fine: true }), false, 'touchscreen laptop edits');
    eq(mb.detectTouchOnly({ fine: true }), false, 'fine pointer edits');
    eq(mb.detectTouchOnly({ touch: true, minDim: 390 }), true, 'touch + small falls back');
    eq(mb.detectTouchOnly({ touch: true, minDim: 1024 }), false, 'touch + roomy edits');
    eq(mb.detectTouchOnly({}), false, 'no input info edits');
    eq(mb.detectTouchOnly(null), false, 'null info edits');
    function fakeWindow(media, touch, w, h) {
      return {
        matchMedia: function (q) {
          return { matches: q === '(pointer: coarse)' ? media.coarse : media.fine };
        },
        navigator: { maxTouchPoints: touch ? 5 : 0 },
        innerWidth: w, innerHeight: h
      };
    }
    var phone = mb.detectFromWindow(fakeWindow({ coarse: true, fine: false }, true, 390, 844));
    deep({ coarse: phone.coarse, fine: phone.fine, touch: phone.touch, minDim: phone.minDim, touchOnly: phone.touchOnly },
      { coarse: true, fine: false, touch: true, minDim: 390, touchOnly: true }, 'phone verdict');
    var laptop = mb.detectFromWindow(fakeWindow({ coarse: true, fine: true }, true, 1440, 900));
    eq(laptop.touchOnly, false, 'laptop verdict');
    var hybrid = fakeWindow({ coarse: true, fine: false }, true, 1024, 768);
    hybrid.matchMedia = function (q) {
      return { matches: q === '(pointer: coarse)' || q === '(any-pointer: fine)' };
    };
    eq(mb.detectFromWindow(hybrid).touchOnly, false, 'secondary fine pointer keeps Edit');
    var broken = mb.detectFromWindow({ matchMedia: function () { throw new Error('no media'); } });
    eq(broken.touchOnly, false, 'media failure degrades to edit');
    var none = mb.detectFromWindow(null);
    eq(none.touchOnly, false, 'no window degrades to edit');
    return { verdict: 'input-only' };
  });

  // ---- MOBILE: split layout math (plan B) ----
  await test('mobile layout: split rule, orientation, pane shares', function () {
    var mb = needMB();
    eq(mb.shouldSplitLayout(3000, 2000, true), true, 'tablets split at any size');
    eq(mb.shouldSplitLayout(800, 900, false), true, 'narrow window splits');
    eq(mb.shouldSplitLayout(1280, 800, false), false, 'desktop stays whole');
    eq(mb.shouldSplitLayout(1000, 500, false), true, 'short window splits');
    eq(mb.shouldSplitLayout(0, 0, false), false, 'invalid dims stay whole');
    eq(mb.orientationOf(390, 844), 'portrait', 'phone portrait');
    eq(mb.orientationOf(844, 390), 'landscape', 'phone landscape');
    eq(mb.orientationOf(500, 500), 'portrait', 'square stacks');
    eq(mb.clampFraction(0.9), mb.DIVIDE_MAX, 'fraction ceiling');
    eq(mb.clampFraction(0.05), mb.DIVIDE_MIN, 'fraction floor');
    var ps = mb.paneSplit(390, 844, 'portrait', 0.42, 16);
    eq(ps.first, Math.round(844 * 0.42), '3D share of height');
    eq(ps.second, 844 - 16 - ps.first, '2D takes the rest');
    near(ps.frac, 0.42, 1e-12, 'fraction echoed');
    var land = mb.paneSplit(844, 390, 'landscape', 0.44, 16);
    eq(land.first, Math.round(844 * 0.44), '3D share of width');
    var tiny = mb.paneSplit(100, 100, 'portrait', 0.5, 16);
    ok(tiny.first > 0 && tiny.second > 0, 'both panes keep space');
    eq(tiny.first + tiny.second + 16, 100, 'small panes fit the viewport');
    return { narrowW: mb.SPLIT_NARROW_W, minDim: mb.SPLIT_MIN_DIM };
  });

  // ---- MOBILE: sheet fit math (plan B2/F1) ----
  await test('mobile fit: bbox extent, centered fit, empty sheets safe', function () {
    var mb = needMB();
    eq(mb.extentOf([]), null, 'empty has no extent');
    eq(mb.extentOf([{ type: 'POINT', x: 0, y: 0, visible: false }]), null, 'hidden skipped');
    eq(mb.extentOf([{ type: 'POINT', x: NaN, y: 0 }]), null, 'non-finite skipped');
    deep(mb.extentOf([
      { type: 'POINT', x: -30, y: 25 },
      { type: 'SEGMENT', x: -30, y: 25, x2: 50, y2: -20 },
      { type: 'CIRCLE', x: 0, y: 0, radius: 10 }
    ]), { x0: -30, x1: 50, y0: -20, y1: 25 }, 'extent spans ink');
    var rim = mb.extentOf([{ type: 'CIRCLE', x: 100, y: 100, radius: 10 }]);
    deep(rim, { x0: 90, x1: 110, y0: 90, y1: 110 }, 'rims count, not centers');
    var empty = mb.fitSheetView(390, 400, null);
    deep(empty, { s: 2, tx: 195, ty: 200 }, 'empty centers the origin');
    var fit = mb.fitSheetView(390, 400, { x0: -30, x1: 50, y0: 10, y1: 60 });
    var center = V.forward(fit, { x: 10, y: 30 });
    near(center.x, 195, 1e-9, 'fit centers x');
    near(center.y, 200, 1e-9, 'fit centers y');
    ok(fit.s >= mb.SCALE_MIN && fit.s <= mb.SCALE_MAX, 'fit scale clamped');
    var top = V.forward(fit, { x: 0, y: 60 }), bottom = V.forward(fit, { x: 0, y: -60 });
    ok(top.y < fit.ty && fit.ty < bottom.y, 'front above, plan below');
    var old = { s: 2, tx: 0, ty: 300 };
    var keep = mb.preserveCenterTxTy(400, 300, 200, 600, old.s, old.tx, old.ty);
    var held = V.forward({ s: 2, tx: keep.tx, ty: keep.ty },
      V.inverse(old, { x: 200, y: 150 }));
    near(held.x, 100, 1e-9, 'resize holds center x');
    near(held.y, 300, 1e-9, 'resize holds center y');
    return { emptyScale: empty.s };
  });

  // ---- MOBILE: gesture tracker (plan D; critical multi-touch paths) ----
  await test('mobile tracker: tap, drag, slop, cancel', function () {
    var mb = needMB();
    function rig() {
      var events = [];
      var t = mb.createGestureTracker({
        onDragStart: function (g) { events.push(['dragstart', g.x, g.y]); },
        onDrag: function (g) { events.push(['drag', g.dx, g.dy]); },
        onPinchStart: function (g) { events.push(['pinchstart', g.x, g.y]); },
        onPinch: function (g) { events.push(['pinch', g.factor, g.dx, g.dy]); },
        onPinchEnd: function (g) { events.push(['pinchend', g.x, g.y]); },
        onTap: function (g) { events.push(['tap', g.x, g.y]); },
        onEnd: function () { events.push(['end']); },
        onCancel: function () { events.push(['cancel']); }
      });
      return { t: t, events: events };
    }
    var r = rig();
    r.t.down('a', 50, 60, 1000);
    r.t.up('a', 1100);
    deep(r.events, [['tap', 50, 60], ['end']], 'clean tap');
    deep(r.t.state(), { mode: 'idle', count: 0, moved: false }, 'idle after tap');
    r = rig();
    r.t.down('a', 0, 0, 0);
    r.t.move('a', 3, 4);
    r.t.up('a', 100);
    deep(r.events, [['tap', 0, 0], ['end']], 'slop still taps');
    r = rig();
    r.t.down('a', 0, 0, 0);
    r.t.move('a', 30, 0);
    r.t.move('a', 40, 0);
    r.t.up('a', 100);
    deep(r.events, [['dragstart', 30, 0], ['drag', 30, 0], ['drag', 10, 0], ['end']], 'drag never taps');
    r = rig();
    r.t.down('a', 0, 0, 0);
    r.t.move('a', 30, 0);
    r.t.cancel();
    deep(r.events, [['dragstart', 30, 0], ['drag', 30, 0], ['cancel']], 'cancel ends silently');
    deep(r.t.state().mode, 'idle', 'idle after cancel');
    r.t.down('a', 5, 5, 200);
    r.t.up('a', 250);
    deep(r.events.slice(3), [['tap', 5, 5], ['end']], 'next gesture starts fresh');
    r = rig();
    r.t.down('a', 0, 0, 0);
    r.t.down('a', 9, 9, 10);
    r.t.move('ghost', 99, 99);
    r.t.up('ghost', 20);
    r.t.up('a', 30);
    deep(r.events, [['tap', 0, 0], ['end']], 'duplicate and ghost contacts ignored');
    r = rig();
    r.t.down('a', 50, 60, 0);
    r.t.up('a', mb.TAP_MAX_MS + 1);
    deep(r.events, [['end']], 'a long press never becomes a tap');
    return { tapSlopPx: mb.TAP_SLOP_PX };
  });

  await test('mobile tracker: pinch math, re-baseline, third finger', function () {
    var mb = needMB();
    var pinches = [], ends = [];
    var t = mb.createGestureTracker({
      onDrag: function (g) { ends.push(['drag', g.dx, g.dy]); },
      onPinchStart: function (g) { pinches.push(['start', g.x, g.y]); },
      onPinch: function (g) { pinches.push([g.factor, g.dx, g.dy, g.x, g.y]); },
      onPinchEnd: function (g) { ends.push(['pinchend', g.x, g.y]); },
      onTap: function () { ends.push(['tap']); },
      onEnd: function () { ends.push(['end']); }
    });
    t.down('a', 0, 0, 0);
    t.down('b', 100, 0, 10);
    deep(pinches, [['start', 50, 0]], 'pinch starts at centroid');
    t.move('b', 200, 0);
    near(pinches[1][0], 2, 1e-9, 'spread doubles');
    t.move('b', 300, 0);
    near(pinches[2][0], 1.5, 1e-9, 'factors stay incremental');
    t.down('c', 500, 500, 20);
    eq(t.state().count, 2, 'third finger ignored');
    t.up('b', 30);
    deep(ends, [['pinchend', 0, 0]], 'lift re-baselines the survivor');
    t.move('a', 5, 0);
    deep(ends[1], ['drag', 5, 0], 'survivor drags without jumping');
    t.up('a', 40);
    deep(ends.slice(2), [['end']], 'pinch never taps');
    var min = [];
    var t2 = mb.createGestureTracker({ onPinch: function (g) { min.push(g.factor); } });
    t2.down('a', 7, 7, 0);
    t2.down('b', 7, 7, 5);
    t2.move('b', 9, 7);
    ok(min.length === 1 && isFinite(min[0]) && min[0] > 0, 'coincident fingers stay finite');
    return { pinchMinPx: mb.PINCH_MIN_DIST_PX };
  });

  // ---- MOBILE: pose dock value helpers (plan E1) ----
  await test('mobile pose values: ranges, snap steps match pose core', function () {
    var mb = needMB();
    deep(mb.poseRangeFor('move'), mb.POSE_MOVE_RANGE, 'move range');
    deep(mb.poseRangeFor('rotate'), mb.POSE_ROT_RANGE, 'rotate range');
    deep(mb.poseRangeFor('scale'), mb.POSE_SCALE_RANGE, 'scale range');
    deep(mb.poseRangeFor('bogus'), mb.POSE_MOVE_RANGE, 'unknown op reads as move');
    eq(mb.snapPoseValue('move', 23), 25, 'move snaps to 5mm');
    eq(mb.snapPoseValue('rotate', 23), 25, 'rotate snaps to 5deg');
    eq(mb.snapPoseValue('scale', 1.56), 1.6, 'scale snaps to 0.1');
    eq(mb.snapPoseValue('move', P.SNAP_MM), P.SNAP_MM, 'move step equals pose core');
    eq(mb.snapPoseValue('rotate', P.SNAP_DEG), P.SNAP_DEG, 'rotate step equals pose core');
    eq(mb.POSE_SCALE_RANGE.snap, P.SNAP_SCALE, 'scale step equals pose core');
    eq(mb.clampPoseValue('move', 9999), mb.POSE_MOVE_RANGE.max, 'move ceiling');
    eq(mb.clampPoseValue('move', -9999), mb.POSE_MOVE_RANGE.min, 'move floor');
    eq(mb.clampPoseValue('rotate', 9999), mb.POSE_ROT_RANGE.max, 'rotate ceiling');
    eq(mb.clampPoseValue('scale', 9999), mb.POSE_SCALE_RANGE.max, 'scale ceiling');
    eq(mb.clampPoseValue('scale', 0), mb.POSE_SCALE_RANGE.min, 'scale floor');
    return { moveRange: [mb.POSE_MOVE_RANGE.min, mb.POSE_MOVE_RANGE.max] };
  });

  // ---- MOBILE: shell probes stay null-safe without DOM ----
  await test('mobile shell: probes and mount degrade without DOM', function () {
    var mb = needMB();
    eq(mb.hasDOM(), false, 'no DOM in Node');
    eq(mb.splitActive(), false, 'split probe silent');
    eq(mb.clickSuppressed(), false, 'click probe silent');
    eq(mb.shouldDesktopIgnore({}), false, 'ignore probe silent');
    mb.flash('hello');
    var shell = mb.mount({});
    ok(shell && typeof shell === 'object', 'null shell returned');
    ['active', 'inspection', 'sync', 'setMode', 'setTitle', 'setInspect',
      'setSpatialNote', 'refreshPoseDock', 'updatePoseReadout',
      'shouldDesktopIgnore', 'clickSuppressed', 'noteGestureEnd', 'flash'
    ].forEach(function (fn) {
      eq(typeof shell[fn], 'function', 'null shell ships ' + fn);
    });
    eq(shell.active(), false, 'null shell inactive');
    return { nullShell: true };
  });

  var passed = results.filter(function (r) { return r.status === 'PASS'; }).length;
  var failed = results.filter(function (r) { return r.status === 'FAIL'; }).length;
  console.log(passed + ' passed; ' + failed + ' failed');
  results.filter(function (r) { return r.status === 'FAIL'; }).forEach(function (r) {
    console.log('FAILED ' + r.name + ' :: ' + r.evidence);
  });
  process.exitCode = failed ? 1 : 0;
}

main().catch(function (error) { console.error(error); process.exitCode = 1; });

'use strict';
// EduCAD phase 34: pose mode. Grab the 3D model Blender-style (G/R/S,
// axis locks, numpad views) and the already-drawn 2D Monge views ride
// along in real time, clamped to their own side of the XY line;
// visualization only, the table never changes. Run:
// `npm run test:phase34`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var P = require('../mirror/files/www.geogebra.org/educad-pose.js');
var M = require('../mirror/files/www.geogebra.org/educad-measure.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'mirror', 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 19;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }
function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, msg + ' (' + a + ' vs ' + b + ')');
}

// 1 poses create, clone, and compare; bad shapes throw
var p0 = P.createPose();
deep(p0.t, [0, 0, 0], 'zero shift');
deep(p0.rm, [1, 0, 0, 0, 1, 0, 0, 0, 1], 'identity spin');
eq(p0.s, 1, 'unit scale');
ok(P.isIdentityPose(p0), 'fresh is identity');
var pc = P.clonePose(p0);
pc.t[0] = 5;
deep(p0.t, [0, 0, 0], 'clone detaches');
ok(!P.isIdentityPose(pc), 'moved is not identity');
throws(function () { P.clonePose(null); }, 'null pose');
throws(function () { P.clonePose({ t: [0, 0], rm: p0.rm, s: 1 }); }, 'short t');
throws(function () { P.clonePose({ t: [0, 0, 0], rm: [1], s: 1 }); }, 'short rm');
throws(function () { P.clonePose({ t: [0, 0, 0], rm: p0.rm, s: 0 }); }, 'dead scale');
['similarity2D', 'applySimilarity', 'classifySide', 'contactPoints',
  'holdsSide', 'poseEntity', 'limitFraction'].forEach(function (fn) {
  eq(typeof P[fn], 'function', 'ships ' + fn);
});
eq(P.CONTACT_EPS, 1e-6, 'contact epsilon');
pass('phase34 pose basics');

// 2 rotation matrices compose known quarter-turns
var z90 = P.axisAngleMatrix(0, 0, 1, Math.PI / 2);
near(z90[0], 0, 1e-9, 'z90 cos');
near(z90[1], -1, 1e-9, 'z90 -sin');
near(z90[3], 1, 1e-9, 'z90 sin');
var spin = P.rotateAboutAxis(p0.rm, [0, 0, 1], Math.PI / 2);
near(spin[0], 0, 1e-9, 'spin applies');
var twice = P.rotateAboutAxis(spin, [0, 0, 1], Math.PI / 2);
near(twice[0], -1, 1e-9, 'two quarters flip');
near(twice[4], -1, 1e-9, 'two quarters flip y');
throws(function () { P.axisAngleMatrix(0, 0, 0, 1); }, 'zero axis');
throws(function () { P.matMul3([1], p0.rm); }, 'short matrix');
pass('phase34 rotation math');

// 3 posing scales and spins about the center, never in place
var c = { x: 1, y: 0, z: 0 };
var grown = P.applyPose([{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
  { t: [0, 0, 0], rm: p0.rm, s: 2 }, c);
deep(grown, [{ x: -1, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }], 'scale about center');
var turned = P.applyPose([{ x: 1, y: 0, z: 0 }],
  { t: [0, 0, 0], rm: z90, s: 1 }, { x: 0, y: 0, z: 0 });
near(turned[0].x, 0, 1e-9, 'quarter x');
near(turned[0].y, 1, 1e-9, 'quarter y');
var moved = P.applyPose([{ x: 1, y: 2, z: 3 }],
  { t: [0, 10, 0], rm: p0.rm, s: 1 }, c);
deep(moved, [{ x: 1, y: 12, z: 3 }], 'shift adds last');
var frozen = [{ x: 4, y: 5, z: 6 }];
P.applyPose(frozen, { t: [9, 9, 9], rm: z90, s: 3 }, c);
deep(frozen, [{ x: 4, y: 5, z: 6 }], 'input untouched');
deep(P.bboxCenter([{ x: 0, y: 0, z: 0 }, { x: 2, y: 4, z: 6 }]),
  { x: 1, y: 2, z: 3 }, 'bbox middle');
throws(function () { P.bboxCenter([]); }, 'empty bbox');
pass('phase34 pose application');

// 4 the rest-stage mapping keeps translation visible in the widget
var staged = P.stageWithRest([{ x: 12, y: 4, z: 6 }],
  { cx: 10, cy: 0, cz: 0, scale: 0.5 });
deep(staged, [{ x: 1, y: 2, z: 3 }], 'rest math');
throws(function () {
  P.stageWithRest([{ x: 0, y: 0, z: 0 }], { cx: 0, cy: 0, cz: 0, scale: 0 });
}, 'dead rest scale');
pass('phase34 rest stage');

// 5 re-projection honors the locked Monge contract in both views
var rp = P.reproject(
  [{ x: 10, y: 20, z: 30 }, { x: 40, y: 50, z: 60 }], [[0, 1]]);
deep(rp.elev.pts, [{ x: 10, y: 20 }, { x: 40, y: 50 }], 'elevation reads x,y');
deep(rp.plan.pts, [{ x: 10, y: -30 }, { x: 40, y: -60 }], 'plan reads x,-z');
deep(rp.elev.segs, [[0, 1]], 'edge indices pass through');
deep(rp.plan.segs, [[0, 1]], 'both views share edges');
throws(function () { P.reproject([{ x: 0, y: 0, z: 0 }], [[0, 5]]); },
  'edge out of range');
throws(function () { P.reproject('nope', []); }, 'verts array');

// similarity recovery: translation, spin, zoom, degenerate rest
var simT = P.similarity2D(
  [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
  [{ x: 5, y: -3 }, { x: 15, y: -3 }, { x: 5, y: 7 }]);
near(simT.angle, 0, 1e-9, 'shift keeps angle');
near(simT.scale, 1, 1e-9, 'shift keeps scale');
near(simT.tx, 5, 1e-9, 'shift tx');
near(simT.ty, -3, 1e-9, 'shift ty');
var simR = P.similarity2D([{ x: 1, y: 0 }, { x: 0, y: 1 }],
  [{ x: 0, y: 1 }, { x: -1, y: 0 }]);
near(simR.angle, Math.PI / 2, 1e-9, 'quarter recovered');
near(simR.scale, 1, 1e-9, 'spin keeps scale');
var simS = P.similarity2D([{ x: 1, y: 0 }, { x: 0, y: 1 }],
  [{ x: 2, y: 0 }, { x: 0, y: 2 }]);
near(simS.scale, 2, 1e-9, 'zoom recovered');
near(simS.tx, 0, 1e-9, 'zoom centered');
var simD = P.similarity2D([{ x: 3, y: 3 }, { x: 3, y: 3 }],
  [{ x: 4, y: 5 }, { x: 4, y: 5 }]);
eq(simD.angle, 0, 'coincident keeps angle');
eq(simD.scale, 1, 'coincident keeps scale');
deep([simD.tx, simD.ty], [1, 2], 'coincident still shifts');
var simE = P.similarity2D([], []);
deep(simE, { angle: 0, scale: 1, tx: 0, ty: 0 }, 'empty is identity');
throws(function () { P.similarity2D([{ x: 0, y: 0 }], []); }, 'lengths match');
var ap = P.applySimilarity({ angle: Math.PI / 2, scale: 2, tx: 1, ty: 0 }, 1, 0);
near(ap.x, 1, 1e-9, 'applySpin x');
near(ap.y, 2, 1e-9, 'applySpin y');
throws(function () { P.applySimilarity({ angle: 0, scale: 0, tx: 0, ty: 0 }, 0, 0); },
  'apply needs live scale');

// drawn entities follow their own view; datum never moves
var simE2 = { angle: 0, scale: 1, tx: 0, ty: 5 };
var simP2 = { angle: 0, scale: 1, tx: 0, ty: -5 };
var pt = { id: 'E1', type: 'POINT', viewRole: 'ELEVATION', x: 10, y: 20 };
var ptP = P.poseEntity(pt, simE2, simP2);
deep([ptP.x, ptP.y], [10, 25], 'point rides elevation');
deep([pt.x, pt.y], [10, 20], 'entity untouched');
var seg = { id: 'E2', type: 'SEGMENT', viewRole: 'BOTH',
  x: 0, y: 10, x2: 0, y2: -10 };
var segP = P.poseEntity(seg, simE2, simP2);
deep([segP.x, segP.y, segP.x2, segP.y2], [0, 15, 0, -15], 'projector splits');
var offside = { id: 'E9', type: 'POINT', viewRole: 'ELEVATION', x: 0, y: -10 };
var offsideP = P.poseEntity(offside, simE2, simP2);
deep([offsideP.x, offsideP.y], [0, -15], 'geometry beats role label');
var dat = { id: 'E3', type: 'DATUM_AXIS', viewRole: 'BOTH', x: -30, y: 0, x2: 30, y2: 0 };
ok(P.poseEntity(dat, simE2, simP2) === dat, 'datum passes through');
var cir = { id: 'E4', type: 'CIRCLE', viewRole: 'PLAN', x: 5, y: -5, radius: 10 };
var cirP = P.poseEntity(cir, simE2, { angle: 0, scale: 2, tx: 0, ty: 0 });
eq(cirP.radius, 20, 'circle scales with plan');
deep([cirP.x, cirP.y], [10, -10], 'circle center rides plan');
var arc = { id: 'E5', type: 'CIRCULAR_ARC', viewRole: 'ELEVATION',
  x: 1, y: 1, radius: 4, startAngle: 0, endAngle: 1 };
var arcP = P.poseEntity(arc, { angle: 0.5, scale: 1, tx: 0, ty: 0 }, simP2);
near(arcP.startAngle, 0.5, 1e-9, 'arc angles turn');
near(arcP.endAngle, 1.5, 1e-9, 'arc sweep kept');
var txt = { id: 'E6', type: 'TEXT', viewRole: 'PLAN', x: 7, y: -7, caption: 'hi' };
var txtP = P.poseEntity(txt, simE2, simP2);
deep([txtP.x, txtP.y], [7, -12], 'text anchor rides plan');
eq(txtP.caption, 'hi', 'text kept');

// the datum line is the wall: neither view crosses it, ever
eq(P.classifySide(0), 'elev', 'line reads elevation');
eq(P.classifySide(-0.5), 'plan', 'below reads plan');
var cps = P.contactPoints({ id: 'E2', type: 'SEGMENT', viewRole: 'BOTH',
  x: 0, y: 10, x2: 0, y2: -10 }, simE2, simP2);
deep(cps, [{ ry: 10, py: 15, side: 'elev' }, { ry: -10, py: -15, side: 'plan' }],
  'projector splits');
var cpc = P.contactPoints({ id: 'E4', type: 'CIRCLE', viewRole: 'PLAN',
  x: 5, y: -5, radius: 10 }, simE2, { angle: 0, scale: 2, tx: 0, ty: 0 });
deep(cpc, [{ ry: -5, py: -10, side: 'plan' },
  { ry: -15, py: -30, side: 'plan' }, { ry: 5, py: 10, side: 'elev' }],
  'circle counts its rim');
deep(P.contactPoints(dat, simE2, simP2), [], 'datum never counts');
deep(P.contactPoints({ id: 'E9', type: 'POINT', viewRole: 'PLAN', x: 4, y: 8 },
  simE2, simP2), [{ ry: 8, py: 13, side: 'elev' }],
  'clamp pairs go geometric too');
ok(P.holdsSide(5, -1e-9), 'epsilon tolerated');
ok(!P.holdsSide(5, -0.1), 'elevation cannot sink');
ok(!P.holdsSide(-5, 0.1), 'plan cannot rise');
ok(P.holdsSide(0, 0.5), 'rest-on-line keeps side');
ok(!P.holdsSide(0, -0.5), 'rest-on-line cannot cross');
throws(function () { P.holdsSide('a', 0); }, 'finite sides');
var lim = P.limitFraction(function (f) { return f; }, function (p) { return p < 0.5; });
near(lim, 0.5, 1 / 2048, 'bisect finds the wall');
eq(P.limitFraction(function (f) { return f; }, function () { return true; }), 1,
  'free gesture runs full');
eq(P.limitFraction(function (f) { return f; }, function () { return false; }), 0,
  'walled start holds still');
pass('phase34 follow math');

// 6 the camera basis matches the widget projector at known angles
var b0 = P.cameraAxes(0, 0);
deep(b0.right, [1, 0, 0], 'rest right');
deep(b0.up, [0, 1, 0], 'rest up');
deep(b0.fwd, [0, 0, 1], 'rest forward');
var b90 = P.cameraAxes(Math.PI / 2, 0);
near(b90.right[2], 1, 1e-9, 'yawed right');
near(b90.fwd[0], -1, 1e-9, 'yawed forward');
near(b90.up[1], 1, 1e-9, 'yaw keeps up');
throws(function () { P.cameraAxes('x', 0); }, 'yaw numeric');
pass('phase34 camera basis');

// 7 grab walks the camera plane, locks to axes, snaps to 5mm
var g = P.startGesture('grab');
eq(g.op, 'grab');
eq(g.axis, null);
throws(function () { P.startGesture('wiggle'); }, 'unknown op');
throws(function () { P.setGestureAxis(g, 'W'); }, 'unknown axis');
var g0 = P.applyGesture(p0, g, 10, 0, { yaw: 0, pitch: 0 }, { pxPerMm: 2 });
deep(g0.t, [5, 0, 0], 'screen right walks world x');
var gUp = P.applyGesture(p0, g, 0, -20, { yaw: 0, pitch: 0 }, { pxPerMm: 2 });
deep(gUp.t, [0, 10, 0], 'screen up walks world y');
P.setGestureAxis(g, 'Y');
var gLock = P.applyGesture(p0, g, 10, -20, { yaw: 0, pitch: 0 }, { pxPerMm: 2 });
deep(gLock.t, [0, 10, 0], 'lock drops the x walk');
var gSnap = P.applyGesture(p0, P.startGesture('grab'), 12, 0,
  { yaw: 0, pitch: 0 }, { pxPerMm: 2, snap: true });
deep(gSnap.t, [5, 0, 0], 'snap rounds 6 to 5');
deep(p0.t, [0, 0, 0], 'start pose untouched');
throws(function () {
  P.applyGesture(p0, g, 1, 1, { yaw: 0, pitch: 0 }, { pxPerMm: 0 });
}, 'pxPerMm positive');
pass('phase34 grab gesture');

// 8 rotate banks mouse travel as angle; scale zooms about the center
var r0 = P.applyGesture(p0, P.startGesture('rotate'), 100, 0,
  { yaw: 0, pitch: 0 }, { pxPerMm: 10 });
var eul = P.eulerXYZOf(r0.rm);
near(eul[2], 100 * P.RAD_PER_PX * 180 / Math.PI, 0.5, 'drag banks angle');
var gr = P.startGesture('rotate');
P.setGestureAxis(gr, 'Y');
var rY = P.applyGesture(p0, gr, 60, 0, { yaw: 0, pitch: 0 }, { pxPerMm: 10 });
near(P.eulerXYZOf(rY.rm)[1], 60 * P.RAD_PER_PX * 180 / Math.PI, 0.5, 'y lock');
var rSnap = P.applyGesture(p0, P.startGesture('rotate'), 60, 0,
  { yaw: 0, pitch: 0 }, { pxPerMm: 10, snap: true });
near(P.eulerXYZOf(rSnap.rm)[2], 35, 0.5, 'angle snaps to 5 deg');
deep(p0.rm, [1, 0, 0, 0, 1, 0, 0, 0, 1], 'spin start untouched');
var sUp = P.applyGesture(p0, P.startGesture('scale'), 0, -100,
  { yaw: 0, pitch: 0 }, { pxPerMm: 10 });
near(sUp.s, Math.exp(100 * P.SCALE_PER_PX), 1e-9, 'up grows');
var sSnap = P.applyGesture(p0, P.startGesture('scale'), 0, -100,
  { yaw: 0, pitch: 0 }, { pxPerMm: 10, snap: true });
eq(sSnap.s, 1.6, 'scale snaps to tenth');
var sMin = P.applyGesture(p0, P.startGesture('scale'), 0, 100000,
  { yaw: 0, pitch: 0 }, { pxPerMm: 10 });
eq(sMin.s, P.SCALE_MIN, 'scale clamps low');
pass('phase34 rotate scale gestures');

// 9 clears drop one channel; the euler readout round-trips
var pr = P.applyGesture(p0, P.startGesture('rotate'), 200, 50,
  { yaw: 0.5, pitch: 0.2 }, { pxPerMm: 10 });
P.clearRotation(pr);
deep(pr.rm, [1, 0, 0, 0, 1, 0, 0, 0, 1], 'clear spins');
var pt = P.applyGesture(p0, P.startGesture('grab'), 30, 40,
  { yaw: 0, pitch: 0 }, { pxPerMm: 10 });
P.clearTranslation(pt);
deep(pt.t, [0, 0, 0], 'clear shift');
P.clearScale(sUp);
eq(sUp.s, 1, 'clear zoom');
P.resetPose(pt);
ok(P.isIdentityPose(pt), 'reset restores');
var e0 = P.eulerXYZOf(p0.rm);
near(e0[0], 0, 1e-9, 'rest reads zero x');
near(e0[1], 0, 1e-9, 'rest reads zero y');
near(e0[2], 0, 1e-9, 'rest reads zero z');
var y90 = P.eulerXYZOf(P.axisAngleMatrix(0, 1, 0, Math.PI / 2));
near(y90[0], 0, 1e-6, 'y90 x');
near(y90[1], 90, 1e-6, 'y90 y');
near(y90[2], 0, 1e-6, 'y90 z');
pass('phase34 clears readout');

// 10 the Blender key map answers every shortcut and nothing else
eq(P.keyAction('g', 'KeyG', {}), 'grab');
eq(P.keyAction('G', 'KeyG', { shift: true }), 'grab', 'shift g still grabs');
eq(P.keyAction('r', 'KeyR', {}), 'rotate');
eq(P.keyAction('s', 'KeyS', {}), 'scale');
eq(P.keyAction('x', 'KeyX', {}), 'axis-x');
eq(P.keyAction('Y', 'KeyY', {}), 'axis-y');
eq(P.keyAction('Enter', 'Enter', {}), 'confirm');
eq(P.keyAction('Escape', 'Escape', {}), 'cancel');
eq(P.keyAction('Tab', 'Tab', {}), 'exit-pose');
eq(P.keyAction('1', 'Digit1', {}), 'view-front');
eq(P.keyAction('3', 'Numpad3', {}), 'view-right');
eq(P.keyAction('7', 'Numpad7', {}), 'view-top');
eq(P.keyAction('1', 'Digit1', { ctrl: true }), 'view-back');
eq(P.keyAction('3', 'Digit3', { ctrl: true }), 'view-left');
eq(P.keyAction('7', 'Numpad7', { ctrl: true }), 'view-bottom');
eq(P.keyAction('g', 'KeyG', { alt: true }), 'clear-t');
eq(P.keyAction('r', 'KeyR', { alt: true }), 'clear-r');
eq(P.keyAction('s', 'KeyS', { alt: true }), 'clear-s');
eq(P.keyAction('q', 'KeyQ', {}), null, 'stray key ignored');
eq(P.keyAction('g', 'KeyG', { ctrl: true }), null, 'ctrl-g ignored');
eq(P.keyAction('!', 'Digit1', { shift: true }), null, 'shift-1 ignored');
eq(P.keyAction('', '', {}), null, 'empty ignored');
pass('phase34 blender keymap');

// 11 six view presets stay inside the widget pitch clamp
var names = Object.keys(P.VIEW_PRESETS).sort();
deep(names, ['back', 'bottom', 'front', 'left', 'right', 'top'], 'six views');
names.forEach(function (nm) {
  var pr = P.VIEW_PRESETS[nm];
  ok(Math.abs(pr.pitch) <= 1.45, nm + ' pitch clamped');
});
eq(P.VIEW_PRESETS.front.yaw, 0, 'front yaw');
eq(P.VIEW_PRESETS.front.pitch, 0, 'front pitch');
pass('phase34 view presets');

// 12 pose is a third measure mode that reads as view-like
eq(M.MODE_POSE, 'pose', 'mode const');
var s = M.createViewState();
eq(M.setMode(s, 'pose'), 'pose', 'pose accepted');
ok(M.isPose(s) && M.isView(s) && !M.isEdit(s), 'pose predicates');
eq(M.setMode(s, 'measure'), 'pose', 'unknown still ignored');
M.setMode(s, 'edit');
ok(M.isEdit(s) && !M.isPose(s), 'edit restores');
M.setInspect(s, 'E1', 1);
M.setMode(s, 'pose');
eq(s.inspectId, null, 'inspect drops on entry');
pass('phase34 measure pose mode');

// 13 the page ships the pose engine, HUD, and gesture branches
var index = fs.readFileSync(INDEX_PATH, 'utf8');
ok(index.indexOf('<script src="files/www.geogebra.org/educad-pose.js"></script>') !== -1,
  'pose module loaded');
['id="btn-mode-pose"', 'id="pose-panel"', 'id="pose-readout"',
  'id="pose-reset"', 'id="pose-exit"', 'id="pose-close"',
  'enterPose()', 'exitPose()', 'updatePoseView()', 'updatePoseHud()',
  'startPoseGesture', 'poseGestureMove', 'confirmPoseGesture',
  'cancelPoseGesture', 'poseSetView', 'poseKey(e)', 'poseEntity',
  'poseState.sims', 'poseSimsFor', 'drawList',
  'renderEntity(ctx1, v, drawList[i])', 'resolve(drawList, v,',
  'limitFraction', 'poseHoldsSides', 'poseClearance',
  'contactPoints', 'holdsSide', 'clearanceMm', 'beforeClear',
  'handle.solidMm', '{ normalize: false }',
  'isPose(handle.measure)) return;',
  "getElementById('btn-mode-pose')"].forEach(function (str) {
  ok(index.indexOf(str) !== -1, 'ships ' + str);
});
var bar = /<div class="demo-bar">([\s\S]*?)<\/div>/.exec(index);
ok(bar[1].indexOf('id="btn-mode-pose"') < bar[1].indexOf('id="btn-manual"'),
  'pose ahead of manual');
pass('phase34 page wiring');

// 14 the drawn views ride the pose with datum pinned; the datum
// line holds; the agent bridge exposes the live per-view similarities.
["type === 'DATUM_AXIS'", 'EduCADPose.poseEntity', 'at view limit',
  'poseState.limited', 'Pose — 3D → 2D preview', 'X right', 'Y up',
  'Z toward you', 'G move · R rotate', 'Pose needs a point', 'poseSavedMode',
  "e.key === 'Tab'", 'window.educadPoseViews'].forEach(function (str) {
  ok(index.indexOf(str) !== -1, 'ships ' + str);
});
ok(index.indexOf('drawPoseGhosts') === -1, 'no ghost overlay');
ok(index.indexOf('educadPoseGhosts') === -1, 'no ghost bridge');
pass('phase34 posed views hud');

// 15 the manual documents pose mode, the moving views, and the key map
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
['### 3.13 Pose mode', 'Blender', 'XY line', 'Alt+G', '1/3/7',
  'X right', 'visualization only', 'never cross', 'DATUM'].forEach(function (str) {
  ok(md.indexOf(str) !== -1, 'manual has ' + str);
});
ok(html.indexOf('Pose mode') !== -1, 'html rebuilt');
pass('phase34 manual documents pose');

// 16 README lists phase34 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase34`') !== -1, 'phase34 row');
ok(readme.indexOf('Pose mode: Blender-style 3D moves drag the drawn 2D views') !== -1,
  'phase34 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 960');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase34'], 'node tools/test-phase34-pose.js',
  'test:phase34 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase34-pose.js') !== -1,
  'chained in test');
pass('phase34 package wiring');

// 17 the follow fit foreshortens honestly: independent x/y scales,
// mirror normalized onto x, legacy fallbacks for degenerate rests
var sq = [{ x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }];
var fNarrow = P.follow2D(sq,
  [{ x: -0.5, y: -1 }, { x: 0.5, y: -1 }, { x: 0.5, y: 1 }, { x: -0.5, y: 1 }]);
near(fNarrow.angle, 0, 1e-9, 'narrow keeps angle');
near(fNarrow.sx, 0.5, 1e-9, 'narrow halves x');
near(fNarrow.sy, 1, 1e-9, 'narrow keeps y exact');
near(fNarrow.scale, Math.sqrt(0.5), 1e-9, 'area scale');
near(fNarrow.tx, 0, 1e-9, 'narrow centered x');
near(fNarrow.ty, 0, 1e-9, 'narrow centered y');
var fRot = P.follow2D(sq,
  [{ x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }, { x: -1, y: -1 }]);
near(fRot.angle, Math.PI / 2, 1e-9, 'quarter recovered');
near(fRot.sx, 1, 1e-9, 'spin keeps sx');
near(fRot.sy, 1, 1e-9, 'spin keeps sy');
var fMir = P.follow2D(sq,
  [{ x: 1, y: -1 }, { x: -1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 }]);
near(fMir.angle, 0, 1e-9, 'mirror keeps angle');
near(fMir.sx, -1, 1e-9, 'flip lives on x');
near(fMir.sy, 1, 1e-9, 'mirror keeps y exact');
ok(fMir.scale < 0, 'mirror signs the area scale');
near(fMir.tx, 0, 1e-9, 'mirror centered x');
var fYMir = P.follow2D(sq,
  [{ x: -1, y: 1 }, { x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }]);
near(fYMir.sy, 1, 1e-9, 'y flip renormalized');
near(fYMir.sx, -1, 1e-9, 'y flip moves to x');
var mappedYM = P.applyFollow(fYMir, -1, -1);
near(mappedYM.x, -1, 1e-9, 'renormalized maps x');
near(mappedYM.y, 1, 1e-9, 'renormalized maps y');
deep(P.follow2D([], []),
  { angle: 0, sx: 1, sy: 1, scale: 1, tx: 0, ty: 0 }, 'empty is identity');
var fCo = P.follow2D([{ x: 3, y: 3 }, { x: 3, y: 3 }],
  [{ x: 4, y: 5 }, { x: 4, y: 5 }]);
deep([fCo.sx, fCo.sy, fCo.tx, fCo.ty], [1, 1, 1, 2], 'coincident shifts');
var fLine = P.follow2D([{ x: 0, y: 5 }, { x: 10, y: 5 }],
  [{ x: 0, y: 5 }, { x: 5, y: 5 }]);
near(fLine.sx, 0.5, 1e-9, 'line falls back to similarity');
near(fLine.sy, 0.5, 1e-9, 'fallback stays uniform');
throws(function () { P.follow2D([{ x: 0, y: 0 }], []); }, 'lengths match');
var af = P.applyFollow({ angle: Math.PI / 2, scale: 2, tx: 1, ty: 0 }, 1, 0);
near(af.x, 1, 1e-9, 'legacy shape applies');
near(af.y, 2, 1e-9, 'legacy shape applies y');
var afA = P.applyFollow({ angle: 0, sx: 0.5, sy: 2, scale: 1, tx: 0, ty: 0 },
  4, 3);
deep([afA.x, afA.y], [2, 6], 'aniso applies per axis');
throws(function () {
  P.applyFollow({ angle: 0, sx: 0, sy: 0, tx: 0, ty: 0 }, 0, 0);
}, 'double zero rejected');
near(P.followAngle({ angle: 0.5, scale: 1, tx: 0, ty: 0 }, 0), 0.5, 1e-9,
  'legacy angle reads');
near(P.followAngle({ angle: 0.5, scale: 1, tx: 0, ty: 0 }, 1), 1.5, 1e-9,
  'legacy angle adds');
near(P.followAngle({ angle: 0, sx: -1, sy: 1, scale: -1, tx: 0, ty: 0 }, 0),
  Math.PI, 1e-9, 'mirror flips direction zero');
var arcM = P.poseEntity({ id: 'E8', type: 'CIRCULAR_ARC', viewRole: 'PLAN',
  x: 0, y: -5, radius: 4, startAngle: 0, endAngle: 1 },
  simE2, { angle: 0, sx: -1, sy: 1, scale: -1, tx: 0, ty: 0 });
near(arcM.startAngle, Math.PI - 1, 1e-9, 'mirrored arc start');
near(arcM.endAngle, Math.PI, 1e-9, 'mirrored arc end');
eq(arcM.radius, 4, 'mirror keeps circle area');
pass('phase34 follow fit');

// 18 datum ties route to their own view; the clamp measures exact
// projections, so fits can neither hide a crossing nor invent one
eq(P.routeSide(5, null), 'elev', 'above rides elevation');
eq(P.routeSide(-5, null), 'plan', 'below rides plan');
eq(P.routeSide(0, { viewRole: 'PLAN' }), 'plan', 'plan role wins ties');
eq(P.routeSide(0, { viewRole: 'ELEVATION' }), 'elev', 'elev role wins ties');
eq(P.routeSide(0, { viewRole: 'PROFILE' }), 'elev', 'profile rides elev');
eq(P.routeSide(0, { viewRole: 'BOTH' }, -3), 'plan', 'other end plan');
eq(P.routeSide(0, { viewRole: 'BOTH' }, 7), 'elev', 'other end elev');
eq(P.routeSide(0, { viewRole: 'BOTH' }), 'elev', 'legacy default');
eq(P.routeSide(5, null, undefined, 'plan'), 'plan', 'force pins');
deep(P.routeCopies(dat), [undefined], 'datum never dual');
deep(P.routeCopies({ id: 'E1', type: 'POINT', viewRole: 'PLAN', x: 4, y: 0 }),
  [undefined], 'role disambiguates');
deep(P.routeCopies({ id: 'E1', type: 'POINT', viewRole: 'BOTH', x: 4, y: 0 }),
  ['elev', 'plan'], 'role-less datum point dual');
deep(P.routeCopies({ id: 'E1', type: 'POINT', viewRole: 'BOTH', x: 4, y: 5 }),
  [undefined], 'off-line point single');
deep(P.routeCopies({ id: 'E2', type: 'SEGMENT', viewRole: 'BOTH',
  x: 0, y: 0, x2: 10, y2: 0 }), ['elev', 'plan'], 'datum edge dual');
deep(P.routeCopies({ id: 'E2', type: 'SEGMENT', viewRole: 'BOTH',
  x: 0, y: -5, x2: 10, y2: 0 }), [undefined], 'spanning edge single');
var liftE = { angle: 0, scale: 1, tx: 0, ty: 100 };
var stillP = { angle: 0, scale: 1, tx: 0, ty: 0 };
var datumEdge = { id: 'E7', type: 'SEGMENT', viewRole: 'BOTH',
  x: 35, y: 0, x2: 0, y2: 0 };
var elevCopy = P.poseEntity(datumEdge, liftE, stillP, 'elev');
deep([elevCopy.y, elevCopy.y2], [100, 100], 'elev copy floats');
var planCopy = P.poseEntity(datumEdge, liftE, stillP, 'plan');
deep([planCopy.y, planCopy.y2], [0, 0], 'plan copy stays');
var span = P.poseEntity({ id: 'E2', type: 'SEGMENT', viewRole: 'BOTH',
  x: 35, y: -35, x2: 35, y2: 0 }, liftE, stillP);
deep([span.y, span.y2], [-35, 0], 'datum corner follows plan loop');
var rimSink = P.contactPoints(
  { id: 'E4', type: 'CIRCLE', viewRole: 'PLAN', x: 50, y: -10, radius: 10 },
  liftE, { angle: 0, scale: 1, tx: 0, ty: -5 });
deep(rimSink[2], { ry: 0, py: -5, side: 'plan' }, 'rim inherits plan side');
ok(P.holdsSide(0, -5, 'plan'), 'plan rim may sink plan-ward');
ok(!P.holdsSide(0, -5), 'legacy tie still binds elev');
ok(!P.holdsSide(0, 5, 'plan'), 'plan bound rejects above');
throws(function () { P.holdsSide(0, 0, 'sideways'); }, 'side checked');
throws(function () {
  P.poseEntity(datumEdge, liftE, stillP, 'sideways');
}, 'force checked');
var pp = P.projectionPairs(
  { elev: { pts: [{ x: 0, y: 10 }] }, plan: { pts: [{ x: 0, y: -10 }] } },
  { elev: { pts: [{ x: 0, y: 10 }] }, plan: { pts: [{ x: 0, y: 5 }] } });
deep(pp, [{ ry: 10, py: 10, side: 'elev' }, { ry: -10, py: 5, side: 'plan' }],
  'true pairs bind views absolutely');
ok(P.holdsSide(pp[0].ry, pp[0].py, pp[0].side), 'elev true holds');
ok(!P.holdsSide(pp[1].ry, pp[1].py, pp[1].side), 'plan true crosses');
throws(function () {
  P.projectionPairs({ elev: { pts: [] }, plan: { pts: [] } }, null);
}, 'posed views needed');
// end-to-end clamp regressions on a 35x60x35 prism + plan circle,
// mirroring the page posePairsFor loop over exact + drawn pairs
var boxV = [];
[0, 35].forEach(function (x) {
  [0, 60].forEach(function (y) {
    [0, 35].forEach(function (z) { boxV.push({ x: x, y: y, z: z }); });
  });
});
var boxE = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3],
  [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
var boxC = P.bboxCenter(boxV);
var boxR = P.reproject(boxV, boxE);
function sheetSeg(id, x, y, x2, y2) {
  return { id: id, type: 'SEGMENT', viewRole: 'BOTH',
    x: x, y: y, x2: x2, y2: y2 };
}
var sheet = [
  dat,
  sheetSeg('p1', 0, -35, 35, -35), sheetSeg('p2', 35, -35, 35, 0),
  sheetSeg('p3', 35, 0, 0, 0), sheetSeg('p4', 0, 0, 0, -35),
  sheetSeg('e1', 0, 0, 35, 0), sheetSeg('e2', 35, 0, 35, 60),
  sheetSeg('e3', 35, 60, 0, 60), sheetSeg('e4', 0, 60, 0, 0),
  { id: 'c1', type: 'CIRCLE', viewRole: 'PLAN', x: 17.5, y: -17.5,
    radius: 10 }
];
function clampHolds(t, ax, ay, az, deg) {
  var pose = { t: t,
    rm: P.axisAngleMatrix(ax, ay, az, deg * Math.PI / 180), s: 1 };
  var sims = P.simsForPose(boxV, boxE, pose, boxC, boxR);
  var pairs = P.projectionPairs(boxR, sims.now);
  sheet.forEach(function (ent) {
    P.routeCopies(ent).forEach(function (force) {
      P.contactPoints(ent, sims.elev, sims.plan, force).forEach(function (pt) {
        pairs.push(pt);
      });
    });
  });
  for (var i = 0; i < pairs.length; i++) {
    if (!P.holdsSide(pairs[i].ry, pairs[i].py, pairs[i].side)) return false;
  }
  return true;
}
var idSims = P.simsForPose(boxV, boxE, P.createPose(), boxC, boxR);
deep(idSims.elev, { angle: 0, sx: 1, sy: 1, scale: 1, tx: 0, ty: 0 },
  'rest elev follows identity');
eq(idSims.posed.length, 8, 'posed verts pass through');
ok(clampHolds([0, 0, 0], 0, 0, 1, 0), 'rest holds');
ok(clampHolds([0, 100, 0], 0, 0, 1, 90), 'z90 with room holds');
ok(clampHolds([0, 100, 0], 0, 0, 1, 135), 'z135 with room holds');
ok(clampHolds([0, 100, 0], 0, 0, 1, 180), 'z180 with room holds');
ok(!clampHolds([0, 0, 0], 0, 1, 0, 10), 'y10 poke-through blocked');
ok(!clampHolds([0, 100, 0], 1, 0, 0, 30), 'x30 plan rise blocked');
var y45 = P.simsForPose(boxV, boxE,
  { t: [0, 0, 0], rm: P.axisAngleMatrix(0, 1, 0, Math.PI / 4), s: 1 },
  boxC, boxR);
near(y45.elev.sx, Math.SQRT1_2, 1e-9, 'vp narrows under y spin');
near(y45.elev.sy, 1, 1e-9, 'vp height stays exact');
pass('phase34 datum routing true clamp');

// 19 the page draws both datum copies and clamps exact + drawn pairs
['follow2D', 'applyFollow', 'followAngle', 'routeSide', 'routeCopies',
  'simsForPose', 'projectionPairs'].forEach(function (fn) {
  eq(typeof P[fn], 'function', 'ships ' + fn);
});
['simsForPose', 'projectionPairs', 'routeCopies', 'poseDrawCopies',
  'posePairsFor'].forEach(function (str) {
  ok(index.indexOf(str) !== -1, 'ships ' + str);
});
pass('phase34 dual draw wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase34 tests passed');

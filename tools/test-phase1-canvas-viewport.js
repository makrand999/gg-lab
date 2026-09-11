'use strict';
var assert = require('assert');
var V = require('../mirror/files/www.geogebra.org/educad-viewport.js');
var C = require('../mirror/files/www.geogebra.org/educad-canvas.js');

var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/49 ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

// --- Viewport (28) ---
eq(V.DEFAULT_SCALE, 2.0); pass('viewport default scale 2.0');
eq(V.clampScale(0.01), 0.05); pass('viewport clamp min 0.05');
eq(V.clampScale(99), 50); pass('viewport clamp max 50');
var v0 = V.createViewport({ s: 2, tx: 10, ty: 20 });
var p0 = V.forward(v0, { x: 0, y: 0 });
eq(p0.x, 10); eq(p0.y, 20); pass('viewport forward origin');
var v1 = V.createViewport({ s: 2, tx: 100, ty: 200 });
var p1 = V.forward(v1, { x: 3, y: 4 });
eq(p1.x, 106); eq(p1.y, 192); pass('viewport forward px=x*s+tx py=ty-y*s');
var rt = V.inverse(v1, p1);
near(rt.x, 3, 1e-9, 'rt x'); near(rt.y, 4, 1e-9, 'rt y'); pass('viewport round-trip <1e-9');
var inv = V.inverse(v1, { x: 106, y: 192 });
near(inv.x, 3, 1e-12, 'inv x'); near(inv.y, 4, 1e-12, 'inv y'); pass('viewport inverse formula');
var vb = V.createViewport({ s: 2, tx: 100, ty: 200, w: 800, h: 600 });
var cur = { x: 150, y: 170 };
var wBefore = V.inverse(vb, cur);
var vz = V.zoomAt(vb, cur, 2);
var wAfter = V.inverse(vz, cur);
near(wBefore.x, wAfter.x, 1e-9, 'zoom wx'); near(wBefore.y, wAfter.y, 1e-9, 'zoom wy'); pass('viewport cursor-anchored zoom');
eq(V.zoomAt(vb, cur, 2).s, 4); pass('viewport zoom factor>1 grows s');
eq(V.zoomAt(V.createViewport({ s: 40 }), cur, 2).s, 50); pass('viewport zoom clamps max');
eq(V.zoomAt(V.createViewport({ s: 0.06 }), cur, 0.5).s, 0.05); pass('viewport zoom clamps min');
throws(function () { V.zoomAt(vb, cur, 0); }); pass('viewport zoom factor<=0 throws');
throws(function () { V.zoomAt(vb, { x: NaN, y: 0 }, 2); }); pass('viewport zoom NaN throws');
var r1 = V.resize(vb, 801.6, 599.4);
eq(r1.w, 802); eq(r1.h, 599); pass('viewport resize integers');
var r2 = V.resize(vb, 0, -5);
eq(r2.w, 1); eq(r2.h, 1); pass('viewport resize min 1');
eq(r1.s, vb.s); eq(r1.tx, vb.tx); eq(r1.ty, vb.ty); pass('viewport resize preserves s/tx/ty');
throws(function () { V.resize(vb, NaN, 100); }); pass('viewport resize NaN throws');
throws(function () { V.assertFinite(NaN); }); pass('viewport guard NaN');
throws(function () { V.assertFinite(Infinity); }); pass('viewport guard Infinity');
throws(function () { V.assertFinite('2'); }); pass('viewport guard non-number');
eq(V.alignHalfPixel(10.2), 10.5); pass('viewport half-pixel align');
eq(V.alignHalfPixel(10), 10.5); pass('viewport half-pixel integer input');
throws(function () { V.forward(vb, { x: NaN, y: 0 }); }); pass('viewport forward NaN guard');
throws(function () { V.inverse(vb, { x: 0, y: Infinity }); }); pass('viewport inverse NaN guard');
ok(V.checkProjector({ x: 5, y: 1 }, { x: 5, y: 9 })); pass('viewport projector true');
ok(!V.checkProjector({ x: 5, y: 1 }, { x: 6, y: 9 })); pass('viewport projector false');
var vp = V.panBy(vb, 7, -3);
eq(vp.tx, vb.tx + 7); eq(vp.ty, vb.ty - 3); pass('viewport panBy shifts tx/ty');
var vd = V.createViewport({});
eq(vd.s, 2.0); eq(vd.w, 800); eq(vd.h, 600); pass('viewport create defaults');

// --- Canvas (21) ---
eq(C.SHOW_GRID_DEFAULT, false); pass('canvas showGrid false default');
ok(C.LAYER_STATIC !== C.LAYER_DYNAMIC); pass('canvas layer1/layer2 distinct');
eq(C.MENU_OPTIONS.length, 2);
eq(C.MENU_OPTIONS.map(function (o) { return o.id; }).join(','), 'plain,mesh');
eq(C.MENU_OPTIONS.map(function (o) { return o.label; }).join('|'), 'Plain (No Mesh)|Box Mesh');
pass('canvas 2-option menu');
eq(C.shouldShowContextMenu(null), true); pass('canvas menu on empty null');
eq(C.shouldShowContextMenu(13.9), false); pass('canvas menu suppressed <14px');
eq(C.shouldShowContextMenu(14), true); pass('canvas menu boundary 14px');
eq(C.shouldShowContextMenu(100), true); pass('canvas menu far entity');
var cp1 = C.clampMenuPosition(10, 10, 160, 64, 800, 600);
eq(cp1.x, 10); eq(cp1.y, 10); pass('canvas menu clamp inside unchanged');
var cp2 = C.clampMenuPosition(700, 580, 160, 64, 800, 600);
eq(cp2.x, 640); eq(cp2.y, 536); pass('canvas menu clamp overflow');
var cp3 = C.clampMenuPosition(-5, -8, 160, 64, 800, 600);
eq(cp3.x, 0); eq(cp3.y, 0); pass('canvas menu clamp negative');
eq(C.shouldDismissMenu('pointerdown'), true); pass('canvas dismiss pointerdown');
eq(C.shouldDismissMenu('Escape'), true); pass('canvas dismiss Escape');
eq(C.shouldDismissMenu('zoom'), true); pass('canvas dismiss zoom');
eq(C.shouldDismissMenu('mousemove'), false); pass('canvas no-dismiss mousemove');
var hd1 = C.computeHiDPISize(800, 600, 1);
eq(hd1.canvasW, 800); eq(hd1.canvasH, 600); eq(hd1.scale, 1); pass('canvas hidpi 1x');
var hd2 = C.computeHiDPISize(800, 600, 2);
eq(hd2.canvasW, 1600); eq(hd2.canvasH, 1200); pass('canvas hidpi 2x');
var cv = { s: 2, tx: 400, ty: 300, w: 800, h: 600 };
var czi = C.buttonAction(cv, 'zoom-in', { x: 400, y: 300 });
ok(czi.s > 2); pass('canvas button plus zooms in');
var czo = C.buttonAction(cv, 'zoom-out', { x: 400, y: 300 });
ok(czo.s < 2); pass('canvas button minus zooms out');
var czh = C.buttonAction({ s: 8, tx: 0, ty: 0, w: 800, h: 600 }, 'zoom-home');
eq(czh.s, 2); eq(czh.tx, 400); eq(czh.ty, 300); pass('canvas button home resets');
eq(C.cursorForState('panning'), 'grabbing');
eq(C.cursorForState('hover-entity'), 'pointer');
eq(C.cursorForState('idle'), 'default'); pass('canvas cursor cues');
var st = C.createCanvasState({});
eq(st.showGrid, false);
eq(C.menuCheckedState(false).plain, true);
eq(C.menuCheckedState(false).mesh, false);
C.applyMenuAction(st, 'mesh');
eq(st.showGrid, true);
eq(C.menuCheckedState(true).mesh, true);
eq(C.menuCheckedState(true).plain, false);
C.applyMenuAction(st, 'plain');
eq(st.showGrid, false);
throws(function () { C.applyMenuAction(st, 'grid'); }); pass('canvas menu plain/mesh + checked');

if (n !== 49) throw new Error('expected 49 tests, ran ' + n);
console.log('OK 49/49 phase1 tests passed');

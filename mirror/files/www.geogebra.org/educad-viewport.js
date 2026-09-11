(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADViewport = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // World coordinates in mm only inside entities and solvers.
  // Screen px is ephemeral render only (never stored on entities).
  // Projector invariant: elevation x equals plan x (mm).
  var WORLD_UNITS = 'mm';
  var SCALE_MIN = 0.05;
  var SCALE_MAX = 50;
  var DEFAULT_SCALE = 2.0;
  var VERTICAL_EPS = 1e-9;
  var ZOOM_STEP = 1.25;

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function clampScale(s) {
    assertFinite(s);
    if (s < SCALE_MIN) return SCALE_MIN;
    if (s > SCALE_MAX) return SCALE_MAX;
    return s;
  }

  function toIntSize(v) {
    assertFinite(v);
    var r = Math.round(v);
    return r < 1 ? 1 : r;
  }

  function createViewport(opts) {
    opts = opts || {};
    var s = (opts.s === undefined) ? DEFAULT_SCALE : opts.s;
    var tx = (opts.tx === undefined) ? 0 : opts.tx;
    var ty = (opts.ty === undefined) ? 0 : opts.ty;
    assertFinite(s, tx, ty);
    var w = (opts.w === undefined) ? 800 : toIntSize(opts.w);
    var h = (opts.h === undefined) ? 600 : toIntSize(opts.h);
    return { s: clampScale(s), tx: tx, ty: ty, w: w, h: h };
  }

  // Forward: px = x*s + tx, py = ty - y*s (world mm y-up -> screen px y-down).
  function forward(view, ptMm) {
    assertFinite(view.s, view.tx, view.ty, ptMm.x, ptMm.y);
    return { x: ptMm.x * view.s + view.tx, y: view.ty - ptMm.y * view.s };
  }

  // Inverse: x = (px - tx)/s, y = (ty - py)/s.
  function inverse(view, ptPx) {
    assertFinite(view.s, view.tx, view.ty, ptPx.x, ptPx.y);
    return { x: (ptPx.x - view.tx) / view.s, y: (view.ty - ptPx.y) / view.s };
  }

  // Cursor-anchored zoom: world point under cursor stays fixed.
  function zoomAt(view, cursorPx, factor) {
    assertFinite(view.s, view.tx, view.ty, cursorPx.x, cursorPx.y, factor);
    if (factor <= 0) throw new Error('zoom factor must be > 0');
    var ns = clampScale(view.s * factor);
    var wx = (cursorPx.x - view.tx) / view.s;
    var wy = (view.ty - cursorPx.y) / view.s;
    return {
      s: ns,
      tx: cursorPx.x - wx * ns,
      ty: cursorPx.y + wy * ns,
      w: view.w, h: view.h
    };
  }

  function zoomIn(view, cursorPx) {
    return zoomAt(view, cursorPx, ZOOM_STEP);
  }

  function zoomOut(view, cursorPx) {
    return zoomAt(view, cursorPx, 1 / ZOOM_STEP);
  }

  function panBy(view, dxPx, dyPx) {
    assertFinite(view.s, view.tx, view.ty, dxPx, dyPx);
    return { s: view.s, tx: view.tx + dxPx, ty: view.ty + dyPx, w: view.w, h: view.h };
  }

  // Integer resize: w/h rounded to ints >= 1, view otherwise unchanged.
  function resize(view, w, h) {
    assertFinite(view.s, view.tx, view.ty);
    return { s: view.s, tx: view.tx, ty: view.ty, w: toIntSize(w), h: toIntSize(h) };
  }

  // Half-pixel align for crisp Canvas2D strokes.
  function alignHalfPixel(v) {
    assertFinite(v);
    return Math.floor(v) + 0.5;
  }

  function alignPoint(ptPx) {
    assertFinite(ptPx.x, ptPx.y);
    return { x: alignHalfPixel(ptPx.x), y: alignHalfPixel(ptPx.y) };
  }

  // Projector invariant: elevation x equals plan x (mm).
  function checkProjector(planMm, elevMm, eps) {
    assertFinite(planMm.x, planMm.y, elevMm.x, elevMm.y);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  return {
    WORLD_UNITS: WORLD_UNITS,
    SCALE_MIN: SCALE_MIN, SCALE_MAX: SCALE_MAX,
    DEFAULT_SCALE: DEFAULT_SCALE,
    VERTICAL_EPS: VERTICAL_EPS, ZOOM_STEP: ZOOM_STEP,
    assertFinite: assertFinite,
    clampScale: clampScale,
    createViewport: createViewport,
    forward: forward, inverse: inverse,
    worldToScreen: forward, screenToWorld: inverse,
    zoomAt: zoomAt, zoomIn: zoomIn, zoomOut: zoomOut,
    panBy: panBy, resize: resize,
    alignHalfPixel: alignHalfPixel, alignPoint: alignPoint,
    checkProjector: checkProjector
  };
});

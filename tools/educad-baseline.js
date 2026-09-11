(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADBaseline = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // World coordinates in mm only inside entities and solvers.
  // Screen px is ephemeral render only (never stored on entities).
  var WORLD_UNITS = 'mm';
  var SCALE_MIN = 0.05;
  var SCALE_MAX = 50;
  var VERTICAL_EPS = 1e-9;
  var COINCIDENT_TOL_MM = 1e-6;
  var RADIUS_MIN_MM = 0.01;
  var LM_STEP_MAX_MM = 50;

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

  function createAffine(scale, tx, ty) {
    assertFinite(scale, tx, ty);
    var s = clampScale(scale);
    return {
      scale: s, tx: tx, ty: ty,
      worldToScreen: function (ptMm) {
        assertFinite(ptMm.x, ptMm.y);
        return { x: ptMm.x * s + tx, y: ptMm.y * s + ty };
      },
      screenToWorld: function (ptPx) {
        assertFinite(ptPx.x, ptPx.y);
        return { x: (ptPx.x - tx) / s, y: (ptPx.y - ty) / s };
      }
    };
  }

  // Cursor-anchored zoom: world point under cursor stays fixed.
  function zoomAt(view, cursorPx, factor) {
    assertFinite(view.scale, view.tx, view.ty, cursorPx.x, cursorPx.y, factor);
    if (factor <= 0) throw new Error('zoom factor must be > 0');
    var ns = clampScale(view.scale * factor);
    var wx = (cursorPx.x - view.tx) / view.scale;
    var wy = (cursorPx.y - view.ty) / view.scale;
    return { scale: ns, tx: cursorPx.x - wx * ns, ty: cursorPx.y - wy * ns };
  }

  function isVerticalDx(dxMm) {
    assertFinite(dxMm);
    return Math.abs(dxMm) < VERTICAL_EPS;
  }

  function distMm(p, q) {
    assertFinite(p.x, p.y, q.x, q.y);
    var dx = p.x - q.x, dy = p.y - q.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function isCoincident(p, q) {
    return distMm(p, q) < COINCIDENT_TOL_MM;
  }

  function clampRadius(rMm) {
    assertFinite(rMm);
    return rMm < RADIUS_MIN_MM ? RADIUS_MIN_MM : rMm;
  }

  function clampLMStep(step) {
    if (typeof step === 'number') {
      assertFinite(step);
      if (step > LM_STEP_MAX_MM) return LM_STEP_MAX_MM;
      if (step < -LM_STEP_MAX_MM) return -LM_STEP_MAX_MM;
      return step;
    }
    assertFinite(step.dx, step.dy);
    var n = Math.sqrt(step.dx * step.dx + step.dy * step.dy);
    if (n <= LM_STEP_MAX_MM) return { dx: step.dx, dy: step.dy };
    var k = LM_STEP_MAX_MM / n;
    return { dx: step.dx * k, dy: step.dy * k };
  }

  // Projector invariant: elevation x equals plan x (mm).
  function checkProjector(planMm, elevMm, eps) {
    assertFinite(planMm.x, planMm.y, elevMm.x, elevMm.y);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  function elevationLength(trueLenMm, phiRad) {
    assertFinite(trueLenMm, phiRad);
    return trueLenMm * Math.cos(phiRad);
  }

  function planLength(trueLenMm, thetaRad) {
    assertFinite(trueLenMm, thetaRad);
    return trueLenMm * Math.cos(thetaRad);
  }

  return {
    WORLD_UNITS: WORLD_UNITS,
    SCALE_MIN: SCALE_MIN, SCALE_MAX: SCALE_MAX,
    VERTICAL_EPS: VERTICAL_EPS,
    COINCIDENT_TOL_MM: COINCIDENT_TOL_MM,
    RADIUS_MIN_MM: RADIUS_MIN_MM,
    LM_STEP_MAX_MM: LM_STEP_MAX_MM,
    assertFinite: assertFinite,
    clampScale: clampScale,
    createAffine: createAffine,
    zoomAt: zoomAt,
    isVerticalDx: isVerticalDx,
    distMm: distMm,
    isCoincident: isCoincident,
    clampRadius: clampRadius,
    clampLMStep: clampLMStep,
    checkProjector: checkProjector,
    elevationLength: elevationLength,
    planLength: planLength
  };
});

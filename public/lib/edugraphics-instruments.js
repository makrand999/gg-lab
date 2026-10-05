(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduGraphicsInstruments = factory();
    root.EduCADInstruments = root.EduGraphicsInstruments;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD Phase 5: virtual ruler + virtual compass, canvas-drawn on
  // Layer2 only. World mm only; screen px is ephemeral render only.
  // Projector invariant: elevation x equals plan x (mm). Direct
  // manipulation state machines; ruler commits Type A/B SEGMENT specs,
  // compass commits Type B/K CIRCLE or CIRCULAR_ARC specs. Zero deps.
  // Dual-env: window.EduGraphicsInstruments, Node module.exports.
  var WORLD_UNITS = 'mm';
  var VERSION = '5.0.0-edugraphics';
  var LAYER = 'layer2';
  var LAYER_DYNAMIC = 'layer2';
  var DETENTS_DEG = [15, 30, 45];
  var DETENT_STEP_DEG = 15;
  var DETENT_TOL_DEG = 2;
  var TICK_MINOR_MM = 1;
  var TICK_MID_MM = 5;
  var TICK_MAJOR_MM = 10;
  var RADIUS_MIN_MM = 0.01;
  var VERTICAL_EPS = 1e-9;
  var RULER_STATES = ['idle', 'placing', 'placed'];
  var COMPASS_STATES = ['idle', 'pin-set', 'radius-set'];
  var RULER_BIS = ['A', 'B'];
  var COMPASS_BIS = ['B', 'K'];

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function checkProjector(planMm, elevMm, eps) {
    assertFinite(planMm.x, planMm.y, elevMm.x, elevMm.y);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    assertFinite(e);
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  function distMm(a, b) {
    assertFinite(a.x, a.y, b.x, b.y);
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function angleDeg(p1, p2) {
    assertFinite(p1.x, p1.y, p2.x, p2.y);
    return Math.atan2(p2.y - p1.y, p2.x - p1.x) / Math.PI * 180;
  }

  function norm180(a) {
    assertFinite(a);
    var r = a % 180;
    if (r < 0) r += 180;
    if (r === 180) r = 0;
    return r;
  }

  function nearestDetent(a) {
    var n = norm180(a);
    var m = Math.round(n / DETENT_STEP_DEG) * DETENT_STEP_DEG;
    if (m === 180) m = 0;
    return m;
  }

  function detentSnap(a, tolDeg) {
    var tol = (tolDeg === undefined) ? DETENT_TOL_DEG : tolDeg;
    assertFinite(a, tol);
    var target = nearestDetent(a);
    var err = Math.abs(norm180(a) - target);
    if (err > 90) err = 180 - err;
    return { detent: target, snapped: err <= tol, errDeg: err, angleDeg: err <= tol ? target : a };
  }

  function copyPt(p) { return { x: p.x, y: p.y }; }

  // ---- Ruler: idle -> placing -> placed ----
  function createRuler(opts) {
    opts = opts || {};
    return {
      kind: 'ruler', state: 'idle',
      p1Mm: null, p2Mm: null,
      angleDeg: 0, lengthMm: 0, detent: detentSnap(0),
      bisCode: opts.bisCode || 'B'
    };
  }

  function rulerRefresh(r) {
    if (r.p1Mm && r.p2Mm) {
      r.lengthMm = distMm(r.p1Mm, r.p2Mm);
      var raw = angleDeg(r.p1Mm, r.p2Mm);
      r.detent = detentSnap(raw);
      r.angleDeg = r.detent.snapped ? r.detent.angleDeg : raw;
    } else { r.lengthMm = 0; }
    return r;
  }

  function rulerDown(r, ptMm) {
    assertFinite(ptMm.x, ptMm.y);
    if (r.state !== 'idle') throw new Error('rulerDown only from idle, got ' + r.state);
    r.p1Mm = copyPt(ptMm);
    r.p2Mm = copyPt(ptMm);
    r.state = 'placing';
    return rulerRefresh(r);
  }

  function rulerMove(r, ptMm) {
    assertFinite(ptMm.x, ptMm.y);
    if (r.state !== 'placing') throw new Error('rulerMove only while placing, got ' + r.state);
    r.p2Mm = copyPt(ptMm);
    return rulerRefresh(r);
  }

  function rulerUp(r, ptMm) {
    if (r.state !== 'placing') throw new Error('rulerUp only while placing, got ' + r.state);
    if (ptMm !== undefined && ptMm !== null) {
      assertFinite(ptMm.x, ptMm.y);
      r.p2Mm = copyPt(ptMm);
    }
    r.state = 'placed';
    return rulerRefresh(r);
  }

  function rulerReset(r) {
    r.state = 'idle'; r.p1Mm = null; r.p2Mm = null;
    r.angleDeg = 0; r.lengthMm = 0; r.detent = detentSnap(0);
    return r;
  }

  function rulerSetBis(r, code) {
    if (RULER_BIS.indexOf(code) === -1) throw new Error('ruler bisCode must be A or B, got ' + code);
    r.bisCode = code;
    return r;
  }

  // Commit a Type A or B SEGMENT spec (mm only, no px keys).
  function rulerCommit(r, opts) {
    opts = opts || {};
    if (r.state !== 'placed') throw new Error('rulerCommit needs placed ruler, got ' + r.state);
    var code = opts.bisCode || r.bisCode || 'B';
    if (RULER_BIS.indexOf(code) === -1) throw new Error('ruler bisCode must be A or B, got ' + code);
    var a = r.detent.snapped ? r.detent.angleDeg * Math.PI / 180 : angleDeg(r.p1Mm, r.p2Mm) * Math.PI / 180;
    var len = distMm(r.p1Mm, r.p2Mm);
    return {
      type: 'SEGMENT', bisCode: code,
      x: r.p1Mm.x, y: r.p1Mm.y,
      x2: r.p1Mm.x + len * Math.cos(a), y2: r.p1Mm.y + len * Math.sin(a),
      viewRole: opts.viewRole || 'BOTH'
    };
  }

  // mm ticks along an edge of length lenMm: minor 1, mid 5, major 10.
  function rulerTicks(lenMm) {
    assertFinite(lenMm);
    if (lenMm < 0) throw new Error('lenMm must be >= 0');
    var out = [];
    var total = Math.floor(lenMm + 1e-9);
    for (var i = 0; i <= total; i++) {
      var kind = (i % TICK_MAJOR_MM === 0) ? 'major' : (i % TICK_MID_MM === 0 ? 'mid' : 'minor');
      out.push({ atMm: i, kind: kind });
    }
    return out;
  }

  // Layer2-only ruler geometry (mm world; no px stored).
  function rulerGeometry(r) {
    if (r.state === 'idle' || !r.p1Mm || !r.p2Mm) return [];
    var ticks = rulerTicks(r.lengthMm);
    return [
      { layer: LAYER_DYNAMIC, shape: 'ruler-edge', p1Mm: copyPt(r.p1Mm), p2Mm: copyPt(r.p2Mm), lengthMm: r.lengthMm, angleDeg: r.angleDeg, detent: r.detent.detent, snapped: r.detent.snapped },
      { layer: LAYER_DYNAMIC, shape: 'ruler-ticks', count: ticks.length, ticks: ticks }
    ];
  }

  // ---- Compass: idle -> pin-set -> radius-set ----
  function createCompass(opts) {
    opts = opts || {};
    return {
      kind: 'compass', state: 'idle',
      pinMm: null, radiusMm: 0,
      startAngleDeg: 0, endAngleDeg: 360,
      bisCode: opts.bisCode || 'B'
    };
  }

  function compassSetPin(c, ptMm) {
    assertFinite(ptMm.x, ptMm.y);
    if (c.state !== 'idle') throw new Error('compassSetPin only from idle, got ' + c.state);
    c.pinMm = copyPt(ptMm);
    c.state = 'pin-set';
    return c;
  }

  function clampRadius(v) {
    assertFinite(v);
    return v < RADIUS_MIN_MM ? RADIUS_MIN_MM : v;
  }

  function compassSetRadius(c, ptMmOrMm) {
    if (c.state !== 'pin-set' && c.state !== 'radius-set') {
      throw new Error('compassSetRadius needs pin-set compass, got ' + c.state);
    }
    var r;
    if (typeof ptMmOrMm === 'number') { r = ptMmOrMm; }
    else { assertFinite(ptMmOrMm.x, ptMmOrMm.y); r = distMm(c.pinMm, ptMmOrMm); }
    c.radiusMm = clampRadius(r);
    c.state = 'radius-set';
    return c;
  }

  function compassSetArc(c, startDeg, endDeg) {
    assertFinite(startDeg, endDeg);
    if (c.state !== 'radius-set') throw new Error('compassSetArc needs radius-set compass, got ' + c.state);
    c.startAngleDeg = startDeg;
    c.endAngleDeg = endDeg;
    return c;
  }

  // Direct manipulation: drag the pin or the radius handle.
  function compassMove(c, handle, ptMm) {
    assertFinite(ptMm.x, ptMm.y);
    if (handle === 'pin') {
      if (c.state === 'idle') throw new Error('compassMove pin needs a pin');
      c.pinMm = copyPt(ptMm);
      return c;
    }
    if (handle === 'radius') {
      if (c.state === 'idle') throw new Error('compassMove radius needs a pin');
      c.radiusMm = clampRadius(distMm(c.pinMm, ptMm));
      c.state = 'radius-set';
      return c;
    }
    throw new Error('unknown compass handle: ' + String(handle));
  }

  function compassReset(c) {
    c.state = 'idle'; c.pinMm = null; c.radiusMm = 0;
    c.startAngleDeg = 0; c.endAngleDeg = 360;
    return c;
  }

  function compassSetBis(c, code) {
    if (COMPASS_BIS.indexOf(code) === -1) throw new Error('compass bisCode must be B or K, got ' + code);
    c.bisCode = code;
    return c;
  }

  function compassRadiusReadout(c) {
    assertFinite(c.radiusMm);
    return { radiusMm: c.radiusMm, text: c.radiusMm.toFixed(1) + ' mm' };
  }

  // Commit a Type B or K CIRCLE / CIRCULAR_ARC spec (mm only).
  function compassCommit(c, opts) {
    opts = opts || {};
    if (c.state !== 'radius-set') throw new Error('compassCommit needs radius-set compass, got ' + c.state);
    var code = opts.bisCode || c.bisCode || 'B';
    if (COMPASS_BIS.indexOf(code) === -1) throw new Error('compass bisCode must be B or K, got ' + code);
    var full = Math.abs(c.endAngleDeg - c.startAngleDeg) >= 360 - 1e-9;
    var spec = {
      type: full ? 'CIRCLE' : 'CIRCULAR_ARC', bisCode: code,
      x: c.pinMm.x, y: c.pinMm.y, radius: c.radiusMm,
      viewRole: opts.viewRole || 'BOTH'
    };
    if (!full) { spec.startAngle = c.startAngleDeg; spec.endAngle = c.endAngleDeg; }
    return spec;
  }

  // Layer2-only compass geometry (mm world; no px stored).
  function compassGeometry(c) {
    if (c.state === 'idle' || !c.pinMm) return [];
    var geos = [
      { layer: LAYER_DYNAMIC, shape: 'compass-pin', pinMm: copyPt(c.pinMm) }
    ];
    if (c.state === 'radius-set') {
      geos.push({ layer: LAYER_DYNAMIC, shape: 'compass-radius', pinMm: copyPt(c.pinMm), radiusMm: c.radiusMm, readout: compassRadiusReadout(c).text });
      geos.push({
        layer: LAYER_DYNAMIC, shape: 'compass-arc', pinMm: copyPt(c.pinMm),
        radiusMm: c.radiusMm, startAngleDeg: c.startAngleDeg, endAngleDeg: c.endAngleDeg
      });
    }
    return geos;
  }

  function stateOf(inst) { return inst.state; }

  return {
    WORLD_UNITS: WORLD_UNITS, VERSION: VERSION,
    LAYER: LAYER, LAYER_DYNAMIC: LAYER_DYNAMIC,
    DETENTS_DEG: DETENTS_DEG, DETENT_STEP_DEG: DETENT_STEP_DEG, DETENT_TOL_DEG: DETENT_TOL_DEG,
    TICK_MINOR_MM: TICK_MINOR_MM, TICK_MID_MM: TICK_MID_MM, TICK_MAJOR_MM: TICK_MAJOR_MM,
    RADIUS_MIN_MM: RADIUS_MIN_MM, VERTICAL_EPS: VERTICAL_EPS,
    RULER_STATES: RULER_STATES, COMPASS_STATES: COMPASS_STATES,
    RULER_BIS: RULER_BIS, COMPASS_BIS: COMPASS_BIS,
    assertFinite: assertFinite, checkProjector: checkProjector,
    distMm: distMm, angleDeg: angleDeg,
    nearestDetent: nearestDetent, detentSnap: detentSnap, snapAngle: detentSnap,
    createRuler: createRuler, rulerDown: rulerDown, rulerMove: rulerMove,
    rulerUp: rulerUp, rulerReset: rulerReset, rulerSetBis: rulerSetBis,
    rulerCommit: rulerCommit, rulerTicks: rulerTicks, rulerGeometry: rulerGeometry,
    createCompass: createCompass, compassSetPin: compassSetPin,
    compassSetRadius: compassSetRadius, compassSetArc: compassSetArc,
    compassMove: compassMove, compassReset: compassReset, compassSetBis: compassSetBis,
    compassRadiusReadout: compassRadiusReadout, compassCommit: compassCommit,
    compassGeometry: compassGeometry, stateOf: stateOf
  };
});

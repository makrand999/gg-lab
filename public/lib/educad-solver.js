(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADSolver = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD Phase 4 constraint and geometry solver.
  // World coordinates in mm only inside entities and solvers; screen px is
  // ephemeral render only and never enters the solver. Projector invariant:
  // elevation x equals plan x (mm). Analytic O(1) rigid-cluster pass plus a
  // damped Levenberg-Marquardt fallback (lambda x10 after 5 rising
  // residuals, 50 iteration cap, snapshot revert plus solver:unresolved
  // event, delta clamp 50 mm). Zero dependencies. Dual-env: browser via
  // window.EduCADSolver, plain Node via module.exports. No 3D.
  var WORLD_UNITS = 'mm';
  var VERSION = '4.0.0-educad';
  var MAX_ITERATIONS = 50;
  var RISING_LIMIT = 5;
  var LAMBDA_INITIAL = 0.01;
  var LAMBDA_FACTOR = 10;
  var DELTA_CLAMP_MM = 50;
  var ANGLE_TOL_DEG = 0.01;
  var PROJECTOR_EPS = 1e-9;
  var VERTICAL_EPS = 1e-9;
  var DEG = Math.PI / 180;
  var SINGULAR_EPS = 1e-15;

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function deg2rad(d) { assertFinite(d); return d * DEG; }
  function rad2deg(r) { assertFinite(r); return r / DEG; }

  function clampDelta(v) {
    assertFinite(v);
    if (v > DELTA_CLAMP_MM) return DELTA_CLAMP_MM;
    if (v < -DELTA_CLAMP_MM) return -DELTA_CLAMP_MM;
    return v;
  }

  function dist2D(ax, ay, bx, by) {
    assertFinite(ax, ay, bx, by);
    var dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function residualNorm(r) {
    var s = 0;
    for (var i = 0; i < r.length; i++) {
      var v = r[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) return Infinity;
      s += v * v;
    }
    return Math.sqrt(s);
  }

  function checkProjector(planMm, elevMm, eps) {
    assertFinite(planMm.x, planMm.y, elevMm.x, elevMm.y);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    assertFinite(e);
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  function projectorDx(planMm, elevMm) {
    assertFinite(planMm.x, elevMm.x);
    return elevMm.x - planMm.x;
  }

  function projectorExactMm(planMm, elevMm) {
    return Math.abs(projectorDx(planMm, elevMm)).toFixed(3);
  }

  function clampUnit(v) {
    assertFinite(v);
    if (v > 1) return 1;
    if (v < -1) return -1;
    return v;
  }

  // Line rotation: PL = TL cos theta, EL = TL cos phi.
  function planLength(TL, thetaDeg) {
    assertFinite(TL, thetaDeg);
    if (TL < 0) throw new Error('TL must be >= 0');
    return TL * Math.cos(thetaDeg * DEG);
  }

  function elevationLength(TL, phiDeg) {
    assertFinite(TL, phiDeg);
    if (TL < 0) throw new Error('TL must be >= 0');
    return TL * Math.cos(phiDeg * DEG);
  }

  function lineRotation(o) {
    o = o || {};
    assertFinite(o.TL, o.thetaDeg, o.phiDeg);
    return {
      TL: o.TL, thetaDeg: o.thetaDeg, phiDeg: o.phiDeg,
      PL: planLength(o.TL, o.thetaDeg),
      EL: elevationLength(o.TL, o.phiDeg)
    };
  }

  // Locus of B-prime: y = y(a-prime) + TL sin theta.
  function locusBPrimeY(yaPrime, TL, thetaDeg) {
    assertFinite(yaPrime, TL, thetaDeg);
    return yaPrime + TL * Math.sin(thetaDeg * DEG);
  }

  // Locus of B: y = y(a) - TL sin phi.
  function locusBY(ya, TL, phiDeg) {
    assertFinite(ya, TL, phiDeg);
    return ya - TL * Math.sin(phiDeg * DEG);
  }

  function inclinationThetaDeg(TL, PL) {
    assertFinite(TL, PL);
    if (TL <= 0) throw new Error('TL must be > 0');
    return Math.acos(clampUnit(PL / TL)) / DEG;
  }

  function inclinationPhiDeg(TL, EL) {
    assertFinite(TL, EL);
    if (TL <= 0) throw new Error('TL must be > 0');
    return Math.acos(clampUnit(EL / TL)) / DEG;
  }

  // Alpha/beta via tans: atan2(opposite, adjacent).
  function alphaBeta(o) {
    o = o || {};
    assertFinite(o.TL, o.PL, o.EL);
    if (o.TL <= 0) throw new Error('TL must be > 0');
    var dh = Math.sqrt(Math.max(0, o.TL * o.TL - o.PL * o.PL));
    var dd = Math.sqrt(Math.max(0, o.TL * o.TL - o.EL * o.EL));
    return {
      alphaDeg: Math.atan2(dh, o.PL) / DEG,
      betaDeg: Math.atan2(dd, o.EL) / DEG
    };
  }

  // Physical feasibility: a real 3D line satisfies sin^2 theta +
  // sin^2 phi <= 1 (equivalently theta + phi <= 90 deg for angles in
  // [0, 90]). Beyond that, dx^2 = TL^2(1 - sin^2t - sin^2p) < 0 and the
  // clamped dx = 0 silently describes an impossible line. Tolerance 1e-9
  // keeps exact boundary cases (e.g. 45/45 deg) feasible under fp error.
  var FEAS_TOL = 1e-9;

  function lineFeasibility(o) {
    o = o || {};
    assertFinite(o.thetaDeg, o.phiDeg);
    var st = Math.sin(o.thetaDeg * DEG), sp = Math.sin(o.phiDeg * DEG);
    var sum = st * st + sp * sp;
    var inRange = o.thetaDeg >= 0 && o.thetaDeg <= 90 && o.phiDeg >= 0 && o.phiDeg <= 90;
    return {
      possible: inRange && sum <= 1 + FEAS_TOL,
      sin2sum: sum,
      thetaPlusPhiDeg: o.thetaDeg + o.phiDeg
    };
  }

  // Projector dx consistency via sqrt.
  function projectorDxFromTL(o) {
    o = o || {};
    assertFinite(o.TL, o.dh, o.dd);
    return Math.sqrt(Math.max(0, o.TL * o.TL - o.dh * o.dh - o.dd * o.dd));
  }

  function projectorDxFromViews(o) {
    o = o || {};
    assertFinite(o.TL, o.PL, o.EL);
    return Math.sqrt(Math.max(0, o.PL * o.PL + o.EL * o.EL - o.TL * o.TL));
  }

  // Trapezoidal true length: TL from PL with dh, TL from EL with dd.
  function trueLengthFromPlan(PL, dh) {
    assertFinite(PL, dh);
    return Math.sqrt(PL * PL + dh * dh);
  }

  function trueLengthFromElevation(EL, dd) {
    assertFinite(EL, dd);
    return Math.sqrt(EL * EL + dd * dd);
  }

  // 3-step rabattement: chained arcs of radius TL splitting sweepDeg in 3.
  function rabattement(o) {
    o = o || {};
    var ax = (o.ax === undefined) ? 0 : o.ax;
    var ay = (o.ay === undefined) ? 0 : o.ay;
    var base = (o.startAngleDeg === undefined) ? 0 : o.startAngleDeg;
    var sweep = (o.sweepDeg === undefined) ? 90 : o.sweepDeg;
    assertFinite(ax, ay, o.TL, base, sweep);
    if (!(o.TL > 0)) throw new Error('rabattement TL must be > 0');
    var steps = [];
    var cx = ax, cy = ay;
    for (var i = 0; i < 3; i++) {
      var a0 = base + sweep * i / 3;
      var a1 = base + sweep * (i + 1) / 3;
      var ex = cx + o.TL * Math.cos(a1 * DEG);
      var ey = cy + o.TL * Math.sin(a1 * DEG);
      steps.push({
        step: i + 1,
        center: { x: cx, y: cy },
        radius: o.TL,
        startAngleDeg: a0,
        endAngleDeg: a1,
        end: { x: ex, y: ey }
      });
      cx = ex; cy = ey;
    }
    return { steps: steps };
  }

  function lineXYIntersection(p, q) {
    assertFinite(p.x, p.y, q.x, q.y);
    var dy = q.y - p.y;
    if (Math.abs(dy) < 1e-12) {
      // Collinear with XY (line lies in the ground line): every point is
      // an intersection; report the segment midpoint with a flag.
      if (Math.abs(p.y) < 1e-12 && Math.abs(q.y) < 1e-12) {
        return { x: (p.x + q.x) / 2, y: 0, collinear: true };
      }
      return null;
    }
    var t = (0 - p.y) / dy;
    return { x: p.x + t * (q.x - p.x), y: 0 };
  }

  // HT/VT traces through the XY ground line plus vertical projector mates.
  function traces(o) {
    o = o || {};
    var hp = lineXYIntersection(o.planA, o.planB);
    var ve = lineXYIntersection(o.elevA, o.elevB);
    var HTplan = hp;
    var HTelev = hp ? { x: hp.x, y: 0 } : null;
    var VTelev = ve;
    var VTplan = ve ? { x: ve.x, y: 0 } : null;
    var ok = true;
    if (HTplan && HTelev) ok = ok && checkProjector(HTplan, HTelev);
    if (VTplan && VTelev) ok = ok && checkProjector(VTplan, VTelev);
    return {
      HTplan: HTplan, HTelev: HTelev,
      VTplan: VTplan, VTelev: VTelev,
      HT: HTplan, VT: VTelev,
      HTcollinear: !!(hp && hp.collinear),
      VTcollinear: !!(ve && ve.collinear),
      projectorOk: ok
    };
  }

  // Damping policy: lambda x10 after 5 rising residuals.
  function dampingBoost(lambda, rises) {
    assertFinite(lambda, rises);
    return rises >= RISING_LIMIT ? lambda * LAMBDA_FACTOR : lambda;
  }

  function createEmitter() {
    var map = {};
    return {
      on: function (ev, cb) {
        if (typeof cb !== 'function') return false;
        if (!map[ev]) map[ev] = [];
        map[ev].push(cb);
        return true;
      },
      off: function (ev, cb) {
        var a = map[ev];
        if (!a) return false;
        var i = a.indexOf(cb);
        if (i === -1) return false;
        a.splice(i, 1);
        return true;
      },
      emit: function (ev, data) {
        var a = map[ev];
        if (!a) return;
        for (var i = 0; i < a.length; i++) {
          try { a[i](data); } catch (e) { /* listener errors never break solve */ }
        }
      }
    };
  }

  var globalEmitter = createEmitter();

  function jacobian(residualFn, x, r, h) {
    var n = x.length, m = r.length;
    var J = [];
    for (var i = 0; i < m; i++) {
      var row = [];
      for (var j = 0; j < n; j++) row.push(0);
      J.push(row);
    }
    for (var j = 0; j < n; j++) {
      var xp = x.slice();
      xp[j] += h;
      var rp = residualFn(xp);
      for (var i = 0; i < m; i++) J[i][j] = (rp[i] - r[i]) / h;
    }
    return J;
  }

  function solveLinear(A, b) {
    var n = b.length;
    var M = [];
    for (var i = 0; i < n; i++) {
      var row = A[i].slice();
      row.push(b[i]);
      M.push(row);
    }
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) {
        if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      }
      if (Math.abs(M[piv][c]) < SINGULAR_EPS) return null;
      var tmp = M[c]; M[c] = M[piv]; M[piv] = tmp;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = M[r2][c] / M[c][c];
        for (var k = c; k <= n; k++) M[r2][k] -= f * M[c][k];
      }
    }
    var x = [];
    for (var i = 0; i < n; i++) x.push(0);
    for (var r3 = n - 1; r3 >= 0; r3--) {
      var s = M[r3][n];
      for (var k = r3 + 1; k < n; k++) s -= M[r3][k] * x[k];
      x[r3] = s / M[r3][r3];
    }
    return x;
  }

  // Damped Levenberg-Marquardt: 50 iteration cap, delta clamp 50 mm,
  // snapshot revert plus solver:unresolved event on failure.
  function lmSolve(x0, residualFn, emitFn, opts) {
    opts = opts || {};
    if (!Array.isArray(x0) || x0.length === 0) {
      throw new Error('x0 must be a non-empty array');
    }
    assertFinite.apply(null, x0);
    if (typeof residualFn !== 'function') throw new Error('residualFn must be a function');
    var tol = (opts.tolerance === undefined) ? 1e-9 : opts.tolerance;
    var maxIter = (opts.maxIterations === undefined) ? MAX_ITERATIONS : opts.maxIterations;
    var lambda = (opts.lambda === undefined) ? LAMBDA_INITIAL : opts.lambda;
    assertFinite(tol, lambda);
    if (!(maxIter > 0) || Math.floor(maxIter) !== maxIter) {
      throw new Error('maxIterations must be a positive integer');
    }
    var snapshot = x0.slice();
    var x = x0.slice();
    var r = residualFn(x.slice());
    var res = residualNorm(r);
    var trace = [lambda];
    var rises = 0, it = 0;
    var lastDelta = null, clampedSteps = 0;
    while (it < maxIter) {
      if (res <= tol) break;
      var n = x.length, m = r.length;
      var J = jacobian(residualFn, x, r, 1e-6);
      var A = [], g = [];
      for (var i = 0; i < n; i++) {
        var arow = [];
        for (var j = 0; j < n; j++) {
          var s = 0;
          for (var k = 0; k < m; k++) s += J[k][i] * J[k][j];
          if (i === j) s += lambda;
          arow.push(s);
        }
        A.push(arow);
        var gs = 0;
        for (var k2 = 0; k2 < m; k2++) gs += J[k2][i] * r[k2];
        g.push(-gs);
      }
      var d = solveLinear(A, g);
      if (d === null) {
        rises++;
        if (rises >= RISING_LIMIT) { lambda *= LAMBDA_FACTOR; rises = 0; }
        trace.push(lambda);
        it++;
        continue;
      }
      for (var c = 0; c < n; c++) {
        var raw = d[c];
        d[c] = clampDelta(raw);
        if (d[c] !== raw) clampedSteps++;
      }
      var xn = [];
      for (var c2 = 0; c2 < n; c2++) xn.push(x[c2] + d[c2]);
      var rn = residualFn(xn);
      var resn = residualNorm(rn);
      if (resn > res) {
        rises++;
        if (rises >= RISING_LIMIT) { lambda *= LAMBDA_FACTOR; rises = 0; }
      } else {
        rises = 0;
      }
      trace.push(lambda);
      lastDelta = d.slice();
      x = xn; r = rn; res = resn; it++;
    }
    if (res <= tol) {
      return {
        ok: true, x: x, residual: res, iterations: it,
        lambda: lambda, lambdaTrace: trace, reverted: false,
        lastDelta: lastDelta, clampedSteps: clampedSteps
      };
    }
    try {
      emitFn('solver:unresolved', { residual: res, iterations: it, lambda: lambda });
    } catch (e) { /* emit never breaks solve */ }
    return {
      ok: false, x: snapshot, residual: res, iterations: it,
      lambda: lambda, lambdaTrace: trace, reverted: true,
      lastDelta: lastDelta, clampedSteps: clampedSteps
    };
  }

  function solveSystem(x0, residualFn, opts) {
    return lmSolve(x0, residualFn, function (ev, data) {
      globalEmitter.emit(ev, data);
    }, opts);
  }

  function createSolver() {
    var emitter = createEmitter();
    return {
      on: function (ev, cb) { return emitter.on(ev, cb); },
      off: function (ev, cb) { return emitter.off(ev, cb); },
      solve: function (x0, residualFn, opts) {
        return lmSolve(x0, residualFn, function (ev, data) {
          emitter.emit(ev, data);
        }, opts);
      }
    };
  }

  function cloneState(state) {
    var o = {};
    for (var k in state) {
      if (hasOwn(state, k)) {
        o[k] = { x: state[k].x, y: state[k].y, locked: !!state[k].locked };
      }
    }
    return o;
  }

  function analyticFail(state, reason) {
    return { ok: false, iters: 1, iterations: 1, values: cloneState(state), method: 'analytic', reason: reason };
  }

  // Analytic O(1) rigid-cluster pass: fixed sweep count, no iteration.
  function solveAnalytic(state, constraints) {
    if (!state || typeof state !== 'object') throw new Error('state must be an object');
    if (!Array.isArray(constraints)) throw new Error('constraints must be an array');
    var v = cloneState(state);
    for (var pass = 0; pass < 2; pass++) {
      for (var i = 0; i < constraints.length; i++) {
        var c = constraints[i] || {};
        if (c.type === 'FIXED') {
          var p = v[c.point];
          if (!p) return analyticFail(state, 'unknown point: ' + c.point);
          assertFinite(c.x, c.y);
          if (p.locked) {
            if (Math.abs(p.x - c.x) > 1e-9 || Math.abs(p.y - c.y) > 1e-9) {
              return analyticFail(state, 'locked point cannot move: ' + c.point);
            }
          } else { p.x = c.x; p.y = c.y; }
        } else if (c.type === 'COINCIDENT') {
          var s1 = v[c.p1], s2 = v[c.p2];
          if (!s1 || !s2) return analyticFail(state, 'unknown point');
          if (s2.locked) {
            if (s1.locked) {
              if (dist2D(s1.x, s1.y, s2.x, s2.y) > 1e-6) return analyticFail(state, 'locked points differ');
            } else { s1.x = s2.x; s1.y = s2.y; }
          } else { s2.x = s1.x; s2.y = s1.y; }
        } else if (c.type === 'HORIZONTAL') {
          var h1 = v[c.p1], h2 = v[c.p2];
          if (!h1 || !h2) return analyticFail(state, 'unknown point');
          if (h2.locked) { if (!h1.locked) h1.y = h2.y; }
          else h2.y = h1.y;
        } else if (c.type === 'VERTICAL') {
          var t1 = v[c.p1], t2 = v[c.p2];
          if (!t1 || !t2) return analyticFail(state, 'unknown point');
          if (t2.locked) { if (!t1.locked) t1.x = t2.x; }
          else t2.x = t1.x;
        } else if (c.type === 'PROJECTOR') {
          var pl = v[c.plan], el = v[c.elev];
          if (!pl || !el) return analyticFail(state, 'unknown point');
          if (el.locked) { if (!pl.locked) pl.x = el.x; }
          else el.x = pl.x;
        } else if (c.type === 'DISTANCE') {
          var A = v[c.p1], B = v[c.p2];
          if (!A || !B) return analyticFail(state, 'unknown point');
          assertFinite(c.d);
          if (c.d < 0) return analyticFail(state, 'negative distance');
          var dx = B.x - A.x, dy = B.y - A.y;
          var cur = Math.sqrt(dx * dx + dy * dy);
          if (A.locked && B.locked) {
            if (Math.abs(cur - c.d) > 1e-6) return analyticFail(state, 'locked distance conflict');
          } else if (A.locked) {
            if (cur < 1e-12) { B.x = A.x + c.d; B.y = A.y; }
            else { B.x = A.x + dx / cur * c.d; B.y = A.y + dy / cur * c.d; }
          } else if (B.locked) {
            if (cur < 1e-12) { A.x = B.x - c.d; A.y = B.y; }
            else { A.x = B.x - dx / cur * c.d; A.y = B.y - dy / cur * c.d; }
          } else { B.x = A.x + c.d; B.y = A.y; }
        } else {
          return analyticFail(state, 'unknown constraint: ' + c.type);
        }
      }
    }
    return { ok: true, iters: 1, iterations: 1, values: v, method: 'analytic' };
  }

  function applySolveToTable(table, x, varNames) {
    if (!table || typeof table.update !== 'function') throw new Error('table must expose update(id, patch)');
    if (!Array.isArray(x) || !Array.isArray(varNames)) throw new Error('x and varNames must be arrays');
    if (x.length !== varNames.length) throw new Error('x/varNames length mismatch');
    assertFinite.apply(null, x);
    for (var i = 0; i < varNames.length; i++) {
      var parts = String(varNames[i]).split('.');
      if (parts.length !== 2) throw new Error('varName must be id.prop: ' + varNames[i]);
      var patch = {};
      patch[parts[1]] = x[i];
      table.update(parts[0], patch);
    }
    return varNames.length;
  }

  // One-call Monge line solve: rotation + loci + dx + angle check.
  function solveMongeLine(o) {
    o = o || {};
    assertFinite(o.TL, o.thetaDeg, o.phiDeg, o.yaPlan, o.yaElev);
    if (o.TL <= 0) throw new Error('TL must be > 0');
    var feas = lineFeasibility({ thetaDeg: o.thetaDeg, phiDeg: o.phiDeg });
    var rot = lineRotation({ TL: o.TL, thetaDeg: o.thetaDeg, phiDeg: o.phiDeg });
    var dh = o.TL * Math.sin(o.thetaDeg * DEG);
    var dd = o.TL * Math.sin(o.phiDeg * DEG);
    var dxA = projectorDxFromTL({ TL: o.TL, dh: dh, dd: dd });
    var dxB = projectorDxFromViews({ TL: o.TL, PL: rot.PL, EL: rot.EL });
    var ab = alphaBeta({ TL: o.TL, PL: rot.PL, EL: rot.EL });
    var thR = inclinationThetaDeg(o.TL, rot.PL);
    var phR = inclinationPhiDeg(o.TL, rot.EL);
    return {
      TL: o.TL, thetaDeg: o.thetaDeg, phiDeg: o.phiDeg,
      physicallyImpossible: !feas.possible,
      feasibility: feas,
      PL: rot.PL, EL: rot.EL,
      locusPlanY: locusBY(o.yaPlan, o.TL, o.phiDeg),
      locusElevY: locusBPrimeY(o.yaElev, o.TL, o.thetaDeg),
      alphaDeg: ab.alphaDeg, betaDeg: ab.betaDeg,
      dx: dxA, dxViews: dxB,
      projectorOk: Math.abs(dxA - dxB) < 1e-9,
      thetaRecDeg: thR,
      phiRecDeg: phR,
      angleErrTheta: Math.abs(thR - o.thetaDeg),
      angleErrPhi: Math.abs(phR - o.phiDeg)
    };
  }

  return {
    WORLD_UNITS: WORLD_UNITS,
    VERSION: VERSION,
    MAX_ITERATIONS: MAX_ITERATIONS, MAX_ITER: MAX_ITERATIONS,
    RISING_LIMIT: RISING_LIMIT, RISING_RESIDUAL_LIMIT: RISING_LIMIT,
    LAMBDA_INITIAL: LAMBDA_INITIAL, LAMBDA_FACTOR: LAMBDA_FACTOR,
    DELTA_CLAMP_MM: DELTA_CLAMP_MM, DELTA_MAX_MM: DELTA_CLAMP_MM,
    ANGLE_TOL_DEG: ANGLE_TOL_DEG, ANGLE_TOLERANCE_DEG: ANGLE_TOL_DEG,
    PROJECTOR_EPS: PROJECTOR_EPS, VERTICAL_EPS: VERTICAL_EPS,
    assertFinite: assertFinite,
    deg2rad: deg2rad, rad2deg: rad2deg,
    clampDelta: clampDelta,
    dist2D: dist2D, residualNorm: residualNorm,
    checkProjector: checkProjector,
    projectorDx: projectorDx, projectorExactMm: projectorExactMm,
    planLength: planLength, elevationLength: elevationLength,
    lineRotation: lineRotation,
    locusBPrimeY: locusBPrimeY, locusBY: locusBY,
    locusElevationY: locusBPrimeY, locusPlanY: locusBY,
    inclinationThetaDeg: inclinationThetaDeg, inclinationPhiDeg: inclinationPhiDeg,
    alphaBeta: alphaBeta,
    lineFeasibility: lineFeasibility, FEAS_TOL: FEAS_TOL,
    projectorDxFromTL: projectorDxFromTL, projectorDxFromViews: projectorDxFromViews,
    trueLengthFromPlan: trueLengthFromPlan, trueLengthFromElevation: trueLengthFromElevation,
    rabattement: rabattement,
    lineXYIntersection: lineXYIntersection, traces: traces,
    dampingBoost: dampingBoost,
    on: function (ev, cb) { return globalEmitter.on(ev, cb); },
    off: function (ev, cb) { return globalEmitter.off(ev, cb); },
    solveSystem: solveSystem, createSolver: createSolver,
    solveAnalytic: solveAnalytic,
    applySolveToTable: applySolveToTable,
    solveMongeLine: solveMongeLine
  };
});

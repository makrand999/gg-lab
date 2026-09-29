(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADReconstruct = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD two/three-view reconstruction: plan + elevation drawings, with
  // an optional first-angle profile (side) view, resolve to a 3D wireframe
  // in widget space (X, Y, Z) = (sheetX, elevY, -planY) with Y up and Z
  // toward the viewer. Zero deps. Dual-env: browser via
  // window.EduCADReconstruct, plain Node via module.exports. Node-safe.
  //
  // Interpretation contract (locked): 3D point (x, d, h) reads as elevation
  // (x, h) and plan (x, -d); viewRole wins when PLAN/ELEVATION/PROFILE and
  // BOTH is classified by y-sign plus a plan-x-overlap profile split;
  // dimensions/text/datum axes, meta.kind in {projector, locus, axis}, and
  // sheet-vertical lines crossing XY are filtered out. A profile depth d
  // reads at xRef + s * (d - dRef); round-trip projection is the
  // acceptance gate: drawn geometry must be covered by the reconstruction
  // within tolerance.
  //
  // Strategy is recognize-then-verify (profile first): closed loops are
  // found per view, class hypotheses (A prismatic sweep, B pyramid with
  // apex, C lifted wireframe) are built directly from the loop inventory,
  // and each hypothesis is scored by drawn-length coverage. Ambiguity is
  // reported, never guessed; deterministic tie-breaks prefer max coverage,
  // then min total edge length.
  var WORLD_UNITS = 'mm';
  var VERSION = '10.1.0-educad';
  var WELD_MIN_MM = 1e-6;
  var WELD_REL = 1e-4;
  var WELD_MAX_MM = 0.5;
  var MATCH_EPS_MM = 0.5;
  var LOOSE_EPS_MM = 2.5;
  var COVERAGE_GATE = 0.999;
  var VERTICAL_EPS = 1e-9;
  var RIM_K = 24;

  var REASON_LABELS = {
    'missing-view': 'needs both plan and elevation views',
    'no-closed-profile': 'no closed profile found in either view',
    'unsupported-curves': 'curves not supported yet',
    'x-mismatch': 'plan/elevation x stations differ beyond eps',
    'name-mismatch': 'plan/elevation labels name different points',
    'ambiguous-pairing': 'ambiguous pairing across views',
    'non-convex-profile': 'non-convex profile (M1 covers convex only)',
    'unmatched-edge': 'a drawn edge fits no interpretation',
    'unmatched-point': 'a drawn point fits no interpretation',
    'non-manifold': 'degenerate solid (zero height or area)',
    'coverage-failed': 'round-trip coverage below gate',
    'hint-conflict': 'projector claims contradict each other',
    'hint-loose-foot': 'a claim foot lands off drawn vertices',
    'duplicate-corners': 'two corners lift to one 3D point',
    'corners-not-coplanar': 'claimed corners leave the profile plane',
    'non-convex-corners': 'claimed corners bound no convex face'
  };

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function fail(reason, label, coverage) {
    return {
      pass: false, reason: reason,
      label: label || REASON_LABELS[reason] || reason,
      coverage: coverage === undefined ? 0 : coverage
    };
  }

  function describeEntity(e, idx) {
    var tag = (e && (e.id || e.caption)) ? String(e.id || e.caption) : '#' + idx;
    return ((e && e.type) ? e.type : '?') + ' ' + tag;
  }

  // --- Input filter (§3.2): geometry types only; drops annotations, datum
  // helpers, and sheet-vertical lines crossing XY (projector helpers even
  // without meta.kind). Circles/arcs are set aside as curves (M1 defers
  // them); invisible entities are skipped silently (caller snapshots the
  // visible set).
  var KEEP_TYPES = {
    POINT: 1, SEGMENT: 1, LINE: 1, RAY: 1, CIRCLE: 1, CIRCULAR_ARC: 1
  };
  var DROP_META = { projector: 1, locus: 1, axis: 1 };

  function isSheetVertical(e) {
    return Math.abs(e.x2 - e.x) <= VERTICAL_EPS;
  }

  function crossesXY(e) {
    // Strict crossing, plus touching-from-below: a vertical from a base
    // station (y = 0) into the plan half is a projector just the same.
    // Single-sided verticals (plan or elevation outlines) never match.
    var lo = Math.min(e.y, e.y2), hi = Math.max(e.y, e.y2);
    return lo < 0 && hi >= 0;
  }

  function filterEntities(list) {
    var kept = [], curves = [];
    var dropped = { invisible: 0, type: 0, meta: 0, crossing: 0 };
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      if (e.visible === false) { dropped.invisible++; continue; }
      if (!KEEP_TYPES[e.type]) { dropped.type++; continue; }
      var kind = e.meta && e.meta.kind;
      if (kind && DROP_META[kind]) { dropped.meta++; continue; }
      if ((e.type === 'SEGMENT' || e.type === 'LINE' || e.type === 'RAY') &&
          isSheetVertical(e) && crossesXY(e)) {
        dropped.crossing++;
        continue;
      }
      if (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') {
        curves.push(e);
        continue;
      }
      kept.push(e);
    }
    return { kept: kept, curves: curves, dropped: dropped };
  }

  // --- View classification (§3.3 + M2 third view): viewRole wins when
  // PLAN/ELEVATION/PROFILE; BOTH falls back to midpoint y-sign. Entities
  // exactly on XY with no off-datum end are set aside with a warning.
  // Untagged upper entities are then split by plan-x overlap: the cluster
  // aligning with the plan x-range stays elevation, a disjoint cluster is
  // the profile view. The split only commits when the profile reading is
  // confirmed (tagged PROFILE, or an untagged cluster that width/height
  // matches); otherwise every bucket is exactly the legacy two-view
  // reading, so two-view behavior is bit-for-bit unchanged.
  function entityXRange(e) {
    var x1 = (e.x === undefined) ? 0 : e.x;
    var x2 = (e.x2 === undefined) ? x1 : e.x2;
    return { x0: Math.min(x1, x2), x1: Math.max(x1, x2) };
  }

  function entityYRange(e) {
    var y1 = (e.y === undefined) ? 0 : e.y;
    var y2 = (e.y2 === undefined) ? y1 : e.y2;
    return { y0: Math.min(y1, y2), y1: Math.max(y1, y2) };
  }

  function rangeOver(items) {
    var r = null;
    for (var i = 0; i < items.length; i++) {
      var xr = entityXRange(items[i]), yr = entityYRange(items[i]);
      if (!r) {
        r = { x0: xr.x0, x1: xr.x1, y0: yr.y0, y1: yr.y1 };
      } else {
        if (xr.x0 < r.x0) r.x0 = xr.x0;
        if (xr.x1 > r.x1) r.x1 = xr.x1;
        if (yr.y0 < r.y0) r.y0 = yr.y0;
        if (yr.y1 > r.y1) r.y1 = yr.y1;
      }
    }
    return r;
  }

  function isDiagonal45(e, tol) {
    if (e.type !== 'SEGMENT' && e.type !== 'LINE' && e.type !== 'RAY') {
      return false;
    }
    var dx = Math.abs(e.x2 - e.x), dy = Math.abs(e.y2 - e.y);
    if (!(dx > 0) && !(dy > 0)) return false;
    return Math.abs(dx - dy) <= tol;
  }

  function inInterval(x, x0, x1, tol) {
    return x >= x0 - tol && x <= x1 + tol;
  }

  // Endpoint sort vs the plan x-anchor: 'in' (both ends in), 'out'
  // (both ends out), 'span' (straddling the view boundary).
  function spanKind(e, anchor, epsT) {
    var x1 = (e.x === undefined) ? 0 : e.x;
    var x2 = (e.x2 === undefined) ? x1 : e.x2;
    var in1 = inInterval(x1, anchor.x0, anchor.x1, epsT);
    var in2 = inInterval(x2, anchor.x0, anchor.x1, epsT);
    if (in1 && in2) return 'in';
    if (!in1 && !in2) return 'out';
    return 'span';
  }

  function classifyViews(kept, epsOpt, curvesOpt) {
    var epsT = (epsOpt === undefined) ? MATCH_EPS_MM : epsOpt;
    var plan = [], elev = [], profile = [], onDatum = [];
    var i, e, my;
    for (i = 0; i < kept.length; i++) {
      e = kept[i];
      if (e.viewRole === 'PLAN') { plan.push(e); continue; }
      if (e.viewRole === 'ELEVATION') { elev.push(e); continue; }
      if (e.viewRole === 'PROFILE') { profile.push(e); continue; }
      my = ((e.y === undefined ? 0 : e.y) +
        (e.y2 === undefined ? 0 : e.y2)) / 2;
      if (my > 0) { elev.push(e); continue; }
      if (my < 0) { plan.push(e); continue; }
      if (e.y > 0 || e.y2 > 0) { elev.push(e); continue; }
      if (e.y < 0 || e.y2 < 0) { plan.push(e); continue; }
      onDatum.push(e);
    }
    // Tentative plan x-anchor over the lower pool, blind to 45-degree
    // diagonals so a miter line cannot widen it (solid 45-degree plan
    // edges stay inside the anchor and are never mistaken for helpers).
    var anchorItems = [];
    for (i = 0; i < plan.length; i++) {
      if (!isDiagonal45(plan[i], LOOSE_EPS_MM)) anchorItems.push(plan[i]);
    }
    var anchorR = rangeOver(anchorItems);
    var anchor = anchorR ? { x0: anchorR.x0, x1: anchorR.x1 } : null;
    if (Array.isArray(curvesOpt)) {
      for (var ci = 0; ci < curvesOpt.length; ci++) {
        var cc = curvesOpt[ci];
        if (!cc || cc.type !== 'CIRCLE') continue;
        if (cc.bisCode !== 'A' && cc.bisCode !== 'B') continue;
        var isPlan = false;
        if (cc.viewRole === 'PLAN') isPlan = true;
        else if (cc.viewRole === 'ELEVATION' || cc.viewRole === 'PROFILE') {
          isPlan = false;
        } else {
          var cyy = (cc.y === undefined) ? 0 : cc.y;
          isPlan = cyy < 0;
        }
        if (!isPlan) continue;
        var cocx0 = cc.x - cc.radius, cocx1 = cc.x + cc.radius;
        if (!anchor) anchor = { x0: cocx0, x1: cocx1 };
        else {
          if (cocx0 < anchor.x0) anchor.x0 = cocx0;
          if (cocx1 > anchor.x1) anchor.x1 = cocx1;
        }
      }
    }
    // Miter candidates: untagged lower 45-degree diagonals x-disjoint
    // from the anchor that reach up to the datum. Dropped only when a
    // profile view is confirmed (same side as the profile).
    var miterCands = [];
    if (anchor) {
      for (i = 0; i < plan.length; i++) {
        e = plan[i];
        if (e.viewRole === 'PLAN') continue;
        if (!isDiagonal45(e, LOOSE_EPS_MM)) continue;
        var mr = entityXRange(e);
        if (mr.x1 >= anchor.x0 - epsT && mr.x0 <= anchor.x1 + epsT) continue;
        if (entityYRange(e).y1 < -epsT) continue;
        miterCands.push(e);
      }
    }
    // Upper split vs the anchor. Tagged ELEVATION stays; untagged
    // degenerate-x entities (points, verticals) sort by station;
    // untagged wide entities sort by endpoint: both ends in = elevation,
    // both ends out = profile tentative, straddling = span helper.
    var elevKeep = [], profTent = [], spanTent = [];
    if (!anchor) {
      elevKeep = elev.slice();
    } else {
      for (i = 0; i < elev.length; i++) {
        e = elev[i];
        if (e.viewRole === 'ELEVATION') { elevKeep.push(e); continue; }
        var er = entityXRange(e);
        if (er.x1 - er.x0 <= epsT) {
          if (inInterval((er.x0 + er.x1) / 2, anchor.x0, anchor.x1, epsT)) {
            elevKeep.push(e);
          } else {
            profTent.push(e);
          }
          continue;
        }
        var kind = spanKind(e, anchor, epsT);
        if (kind === 'in') { elevKeep.push(e); continue; }
        if (kind === 'out') { profTent.push(e); continue; }
        spanTent.push(e);
      }
    }
    // Confirmation: tagged PROFILE declares a three-view sheet outright.
    // An untagged profile cluster must earn it: at least one drawn
    // segment (point-only clusters need explicit tags), profile width
    // matching plan depth, profile height matching elevation height.
    var confirmed = profile.length > 0;
    var profR = rangeOver(profTent);
    if (!confirmed && profR) {
      var hasSeg = false;
      for (i = 0; i < profTent.length; i++) {
        if (profTent[i].type !== 'POINT') { hasSeg = true; break; }
      }
      var planR = rangeOver(anchorItems);
      var elevR = rangeOver(elevKeep);
      if (hasSeg && planR && elevR &&
          Math.abs((profR.x1 - profR.x0) - (planR.y1 - planR.y0)) <= epsT &&
          Math.abs(profR.y0 - elevR.y0) <= epsT &&
          Math.abs(profR.y1 - elevR.y1) <= epsT) {
        confirmed = true;
      }
    }
    var droppedHelpers = [];
    if (confirmed && (profile.length > 0 || profTent.length > 0)) {
      var sideR = rangeOver(profile.concat(profTent));
      var anchorMid = anchor ? (anchor.x0 + anchor.x1) / 2 : 0;
      var profMid = (sideR.x0 + sideR.x1) / 2;
      var profSide = profMid >= anchorMid ? 1 : -1;
      var keptPlan = [];
      for (i = 0; i < plan.length; i++) {
        e = plan[i];
        var isMiter = miterCands.indexOf(e) !== -1;
        if (isMiter) {
          var ecr = entityXRange(e);
          var mSide = ((ecr.x0 + ecr.x1) / 2 >= anchorMid) ? 1 : -1;
          if (mSide === profSide) { droppedHelpers.push(e); continue; }
        }
        keptPlan.push(e);
      }
      plan = keptPlan;
      elev = elevKeep;
      for (i = 0; i < spanTent.length; i++) droppedHelpers.push(spanTent[i]);
      profile = profile.concat(profTent);
      // On-datum lines in a confirmed three-view sheet: spanners are
      // construction (drop), disjoint lines belong to the profile view,
      // in-range lines stay genuinely ambiguous (datum variants).
      var keptDatum = [];
      for (i = 0; i < onDatum.length; i++) {
        e = onDatum[i];
        if (anchor) {
          var er = entityXRange(e);
          if (er.x1 - er.x0 <= epsT) {
            if (!inInterval((er.x0 + er.x1) / 2,
                anchor.x0, anchor.x1, epsT)) {
              profile.push(e);
              continue;
            }
          } else {
            var dk = spanKind(e, anchor, epsT);
            if (dk === 'span') { droppedHelpers.push(e); continue; }
            if (dk === 'out') { profile.push(e); continue; }
          }
        }
        keptDatum.push(e);
      }
      onDatum = keptDatum;
    }
    return {
      plan: plan, elev: elev, profile: profile, onDatum: onDatum,
      droppedHelpers: droppedHelpers
    };
  }

  // Adaptive weld tolerance: exact for generated drawings, forgiving for
  // hand-drawn ones. Floor is the locked coincident tolerance.
  function weldTolerance(planItems, elevItems, profileItems) {
    var minX = Infinity, maxX = -Infinity;
    var minY = Infinity, maxY = -Infinity;
    var n = 0;
    function eat(x, y) {
      assertFinite(x, y);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      n++;
    }
    var all = planItems.concat(elevItems);
    if (profileItems) all = all.concat(profileItems);
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      if (e.type === 'POINT') { eat(e.x, e.y); continue; }
      eat(e.x, e.y);
      eat(e.x2, e.y2);
    }
    if (n === 0) return WELD_MIN_MM;
    var diag = Math.sqrt((maxX - minX) * (maxX - minX) +
      (maxY - minY) * (maxY - minY));
    var tol = diag * WELD_REL;
    if (tol < WELD_MIN_MM) tol = WELD_MIN_MM;
    if (tol > WELD_MAX_MM) tol = WELD_MAX_MM;
    return tol;
  }

  function stableKey(e, idx) {
    return String(e.viewRole) + '|' + String(e.type) + '|' +
      (e.x === undefined ? '' : e.x) + ',' + (e.y === undefined ? '' : e.y) +
      ',' + (e.x2 === undefined ? '' : e.x2) + ',' +
      (e.y2 === undefined ? '' : e.y2) + '|' + String(e.bisCode) + '|' +
      String(e.caption) + '|' + idx;
  }

  function sortStable(items) {
    var keyed = [];
    for (var i = 0; i < items.length; i++) {
      keyed.push({ e: items[i], k: stableKey(items[i], i) });
    }
    keyed.sort(function (a, b) { return a.k < b.k ? -1 : (a.k > b.k ? 1 : 0); });
    var out = [];
    for (var j = 0; j < keyed.length; j++) out.push(keyed[j].e);
    return out;
  }

  // --- Per-view 2D graph: welded vertices, drawn segments, drawn points.
  // LINE/RAY are finite between their stored points, matching the sheet
  // renderer (which strokes p1->p2). Zero-length segments collapse to
  // points. Items arrive pre-sorted so welding is order-independent.
  function buildViewGraph(items, tol) {
    var verts = [];
    var segs = [];
    var points = [];
    function vertAt(x, y) {
      for (var i = 0; i < verts.length; i++) {
        var dx = verts[i].x - x, dy = verts[i].y - y;
        if (dx * dx + dy * dy <= tol * tol) return i;
      }
      verts.push({ x: x, y: y });
      return verts.length - 1;
    }
    for (var i = 0; i < items.length; i++) {
      var e = items[i];
      if (e.type === 'POINT') {
        points.push({ v: vertAt(e.x, e.y), item: e, idx: i });
        continue;
      }
      var dx = e.x2 - e.x, dy = e.y2 - e.y;
      if (dx * dx + dy * dy <= tol * tol) {
        points.push({ v: vertAt(e.x, e.y), item: e, idx: i });
        continue;
      }
      var a = vertAt(e.x, e.y), b = vertAt(e.x2, e.y2);
      if (a === b) {
        points.push({ v: a, item: e, idx: i });
        continue;
      }
      segs.push({ a: a, b: b, item: e, idx: i });
    }
    return { verts: verts, segs: segs, points: points };
  }

  function distPtSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) {
      var ex = px - ax, ey = py - ay;
      return Math.sqrt(ex * ex + ey * ey);
    }
    var t = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var cx = ax + t * dx - px, cy = ay + t * dy - py;
    return Math.sqrt(cx * cx + cy * cy);
  }

  function minDistToSegs(px, py, verts, segs, bisOk) {
    var best = Infinity;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (bisOk && !bisOk(s.item.bisCode)) continue;
      var a = verts[s.a], b = verts[s.b];
      var d = distPtSeg(px, py, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    return best;
  }

  function isAB(bis) { return bis === 'A' || bis === 'B'; }

  // Fraction of samples along (ax,ay)->(bx,by) covered by A/B drawn
  // segments within tol. Straight-vs-straight deviation peaks at an end,
  // so a few samples are exact.
  function segCoveredFrac(ax, ay, bx, by, graph, tol, n) {
    n = n || 5;
    var hit = 0;
    for (var i = 0; i < n; i++) {
      var t = n === 1 ? 0 : i / (n - 1);
      var px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
      if (minDistToSegs(px, py, graph.verts, graph.segs, isAB) <= tol) hit++;
    }
    return hit / n;
  }

  // --- Convex plan loop (Andrew monotone chain over welded vertices).
  // Returns {order:[vertIdx...], area} CCW, or null when fewer than 3
  // non-collinear vertices exist.
  function convexLoop(graph, tol) {
    var verts = graph.verts;
    if (verts.length < 3) return null;
    var idx = [];
    for (var i = 0; i < verts.length; i++) idx.push(i);
    idx.sort(function (p, q) {
      if (verts[p].x !== verts[q].x) return verts[p].x - verts[q].x;
      return verts[p].y - verts[q].y;
    });
    function cross(o, a, b) {
      return (verts[a].x - verts[o].x) * (verts[b].y - verts[o].y) -
        (verts[a].y - verts[o].y) * (verts[b].x - verts[o].x);
    }
    var lower = [];
    for (var l = 0; l < idx.length; l++) {
      while (lower.length >= 2 &&
          cross(lower[lower.length - 2], lower[lower.length - 1], idx[l]) <= 0) {
        lower.pop();
      }
      lower.push(idx[l]);
    }
    var upper = [];
    for (var u = idx.length - 1; u >= 0; u--) {
      while (upper.length >= 2 &&
          cross(upper[upper.length - 2], upper[upper.length - 1], idx[u]) <= 0) {
        upper.pop();
      }
      upper.push(idx[u]);
    }
    lower.pop();
    upper.pop();
    var order = lower.concat(upper);
    if (order.length < 3) return null;
    var area = 0;
    for (var k = 0; k < order.length; k++) {
      var p = verts[order[k]], q = verts[order[(k + 1) % order.length]];
      area += p.x * q.y - q.x * p.y;
    }
    area = Math.abs(area) / 2;
    if (!(area > tol * tol)) return null;
    return { order: order, area: area };
  }

  // Every hull edge must be drawn (possibly as collinear pieces); a hull
  // shortcut across undrawn space means a non-convex profile (M1 limit).
  function loopSolidity(graph, loop, tol) {
    for (var i = 0; i < loop.order.length; i++) {
      var a = graph.verts[loop.order[i]];
      var b = graph.verts[loop.order[(i + 1) % loop.order.length]];
      if (segCoveredFrac(a.x, a.y, b.x, b.y, graph, tol, 5) < 1) {
        return { ok: false, edge: i };
      }
    }
    return { ok: true, edge: -1 };
  }

  function loopStations(graph, loop, tol) {
    var xs = [];
    for (var i = 0; i < loop.order.length; i++) {
      xs.push(graph.verts[loop.order[i]].x);
    }
    xs.sort(function (a, b) { return a - b; });
    var out = [];
    for (var j = 0; j < xs.length; j++) {
      if (out.length === 0 || Math.abs(xs[j] - out[out.length - 1]) > tol) {
        out.push(xs[j]);
      }
    }
    return out;
  }

  // Point vs loop polygon: 'in' | 'out' | 'on' (within tol of boundary).
  function pointInLoop(px, py, graph, loop, tol) {
    var order = loop.order, verts = graph.verts;
    for (var i = 0; i < order.length; i++) {
      var a = verts[order[i]], b = verts[order[(i + 1) % order.length]];
      if (distPtSeg(px, py, a.x, a.y, b.x, b.y) <= tol) return 'on';
    }
    var inside = false;
    for (var j = 0; j < order.length; j++) {
      var p = verts[order[j]], q = verts[order[(j + 1) % order.length]];
      if ((p.y > py) !== (q.y > py)) {
        var xin = p.x + (py - p.y) * (q.x - p.x) / (q.y - p.y);
        if (px < xin) inside = !inside;
      }
    }
    return inside ? 'in' : 'out';
  }

  function loopBBox(graph, loop) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (var i = 0; i < loop.order.length; i++) {
      var v = graph.verts[loop.order[i]];
      if (v.x < x0) x0 = v.x;
      if (v.x > x1) x1 = v.x;
      if (v.y < y0) y0 = v.y;
      if (v.y > y1) y1 = v.y;
    }
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
  }

  // Drawn A/B range of a view (segments only; points add no extent).
  function drawnRangeAB(graph) {
    var any = false;
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (var i = 0; i < graph.segs.length; i++) {
      if (!isAB(graph.segs[i].item.bisCode)) continue;
      var a = graph.verts[graph.segs[i].a], b = graph.verts[graph.segs[i].b];
      any = true;
      if (a.x < x0) x0 = a.x;
      if (b.x < x0) x0 = b.x;
      if (a.x > x1) x1 = a.x;
      if (b.x > x1) x1 = b.x;
      if (a.y < y0) y0 = a.y;
      if (b.y < y0) y0 = b.y;
      if (a.y > y1) y1 = a.y;
      if (b.y > y1) y1 = b.y;
    }
    if (!any) return null;
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
  }

  function hCovered(graph, y, x0, x1, tol) {
    return segCoveredFrac(x0, y, x1, y, graph, tol, 9) >= 1;
  }

  function vCovered(graph, x, y0, y1, tol) {
    return segCoveredFrac(x, y0, x, y1, graph, tol, 9) >= 1;
  }

  function slantCovered(graph, ax, ay, bx, by, tol) {
    return segCoveredFrac(ax, ay, bx, by, graph, tol, 9) >= 1;
  }

  // Hidden (E) edges depict occluded geometry: in a solid class they must
  // lie inside the view silhouette rather than coincide with an outline.
  function eSegsContained(segs, verts, insideTest, tol, n) {
    n = n || 5;
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].item.bisCode !== 'E') continue;
      var a = verts[segs[i].a], b = verts[segs[i].b];
      for (var k = 0; k < n; k++) {
        var t = n === 1 ? 0 : k / (n - 1);
        var px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        if (!insideTest(px, py, tol)) return { ok: false, seg: segs[i] };
      }
    }
    return { ok: true, seg: null };
  }

  function rectInside(x0, x1, y0, y1) {
    return function (px, py, tol) {
      return px >= x0 - tol && px <= x1 + tol &&
        py >= y0 - tol && py <= y1 + tol;
    };
  }

  function loopInside(graph, loop) {
    return function (px, py, tol) {
      return pointInLoop(px, py, graph, loop, tol) !== 'out';
    };
  }

  function newellVec(verts, face) {
    var nx = 0, ny = 0, nz = 0;
    for (var i = 0; i < face.length; i++) {
      var a = verts[face[i]], b = verts[face[(i + 1) % face.length]];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    return { x: nx, y: ny, z: nz };
  }

  // Orient faces by outward checks, flipping loops that face inward.
  // Deterministic: construction order is fixed, flips are local.
  function orientFaces(verts, faces, checks) {
    var out = [];
    for (var i = 0; i < faces.length; i++) {
      var loop = faces[i].slice();
      if (!checks[i](newellVec(verts, loop))) loop.reverse();
      out.push(loop);
    }
    return out;
  }

  function totalLength(verts, edges) {
    var sum = 0;
    for (var i = 0; i < edges.length; i++) {
      var a = verts[edges[i][0]], b = verts[edges[i][1]];
      var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    return sum;
  }

  function centroidXZ(verts, ring) {
    var cx = 0, cz = 0;
    for (var i = 0; i < ring.length; i++) {
      cx += verts[ring[i]].x;
      cz += verts[ring[i]].z;
    }
    return { x: cx / ring.length, z: cz / ring.length };
  }

  function outwardSideCheck(verts, loop, ia, ib) {
    var c = centroidXZ(verts, loop);
    var a = verts[ia], b = verts[ib];
    var mx = (a.x + b.x) / 2 - c.x, mz = (a.z + b.z) / 2 - c.z;
    return function (n) { return n.x * mx + n.z * mz > 0; };
  }

  // Canonical form for tie detection: rounded sorted vertices + edges.
  function canonicalOf(verts, edges) {
    function r(v) { return Math.round(v * 1e6) / 1e6; }
    var vs = verts.map(function (v) { return [r(v.x), r(v.y), r(v.z)]; });
    vs.sort(function (a, b) {
      if (a[0] !== b[0]) return a[0] - b[0];
      if (a[1] !== b[1]) return a[1] - b[1];
      return a[2] - b[2];
    });
    var keyOf = {};
    for (var i = 0; i < vs.length; i++) keyOf[vs[i].join(',')] = i;
    var es = edges.map(function (e) {
      var pa = [r(verts[e[0]].x), r(verts[e[0]].y), r(verts[e[0]].z)];
      var pb = [r(verts[e[1]].x), r(verts[e[1]].y), r(verts[e[1]].z)];
      var ka = keyOf[pa.join(',')], kb = keyOf[pb.join(',')];
      return ka < kb ? ka + '-' + kb : kb + '-' + ka;
    });
    es.sort();
    return JSON.stringify({ v: vs, e: es });
  }

  // Drawn-length coverage of one view: fraction of A/B sample points that
  // lie on the projected interpretation. E points count via containment.
  function viewCoverage(graph, onProjected, insideE, tol) {
    var need = 0, hit = 0;
    var n = 5;
    for (var i = 0; i < graph.segs.length; i++) {
      var s = graph.segs[i];
      var a = graph.verts[s.a], b = graph.verts[s.b];
      var isE = s.item.bisCode === 'E';
      for (var k = 0; k < n; k++) {
        var t = k / (n - 1);
        var px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
        need++;
        if (isE) {
          if (insideE(px, py, tol)) hit++;
        } else if (onProjected(px, py, tol)) {
          hit++;
        }
      }
    }
    for (var j = 0; j < graph.points.length; j++) {
      var v = graph.verts[graph.points[j].v];
      need++;
      if (onProjected(v.x, v.y, tol)) hit++;
    }
    if (need === 0) return 1;
    return hit / need;
  }

  function onLoopLines(graph, loop) {
    return function (px, py, tol) {
      for (var i = 0; i < loop.order.length; i++) {
        var a = graph.verts[loop.order[i]];
        var b = graph.verts[loop.order[(i + 1) % loop.order.length]];
        if (distPtSeg(px, py, a.x, a.y, b.x, b.y) <= tol) return true;
      }
      return false;
    };
  }

  function onPrismElevLines(stations, z0, z1) {
    return function (px, py, tol) {
      if (Math.abs(py - z0) <= tol || Math.abs(py - z1) <= tol) return true;
      for (var i = 0; i < stations.length; i++) {
        if (Math.abs(px - stations[i]) <= tol && py >= z0 - tol &&
            py <= z1 + tol) {
          return true;
        }
      }
      return false;
    };
  }

  // --- M2 third view: a plan depth d reads in the profile at local x
  // x'(d) = xRef + s * (d - dRef), with s = +1 (direct) or -1 (mirrored)
  // and dRef the near depth edge. Both orientations are always tried in
  // fixed order; the drawing (not a convention guess) picks the winner.
  function inferProfileMaps(dRef, p0, p1) {
    return [
      { xRef: p0, s: 1, dRef: dRef },
      { xRef: p1, s: -1, dRef: dRef }
    ];
  }

  function mapDepth(map, d) {
    return map.xRef + map.s * (d - map.dRef);
  }

  // Distinct plan-loop depths, mirroring loopStations (which reads x).
  function loopDepths(graph, loop, tol) {
    var ds = [];
    for (var i = 0; i < loop.order.length; i++) {
      ds.push(-graph.verts[loop.order[i]].y);
    }
    ds.sort(function (a, b) { return a - b; });
    var out = [];
    for (var j = 0; j < ds.length; j++) {
      if (out.length === 0 || Math.abs(ds[j] - out[out.length - 1]) > tol) {
        out.push(ds[j]);
      }
    }
    return out;
  }

  // Profile validation for Class A: the swept silhouette in the profile
  // is the mapped depth span crossed with [z0, z1], with verticals at the
  // mapped plan-loop depth stations. Rules mirror the elevation side.
  // Returns a fail object, or {pass, coverage} when the map fits.
  function checkPrismProfile(profG, depths, z0, z1, map, eps, stol) {
    var px = [];
    var pi;
    for (pi = 0; pi < depths.length; pi++) px.push(mapDepth(map, depths[pi]));
    var plo = Math.min.apply(null, px), phi = Math.max.apply(null, px);
    var pr = drawnRangeAB(profG);
    if (!pr) {
      return fail('unmatched-edge', 'profile shows no prism extent', 0);
    }
    if (Math.abs(pr.x0 - plo) > eps || Math.abs(pr.x1 - phi) > eps) {
      return fail('x-mismatch', 'profile x-range [' + pr.x0 + ', ' +
        pr.x1 + '] vs mapped depth [' + plo + ', ' + phi + '] beyond eps', 0);
    }
    var onProf = onPrismElevLines(px, z0, z1);
    var si, s, a, b, okLine, qx, qy;
    for (si = 0; si < profG.segs.length; si++) {
      s = profG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = profG.verts[s.a];
      b = profG.verts[s.b];
      okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        qx = a.x + (b.x - a.x) * u;
        qy = a.y + (b.y - a.y) * u;
        if (!onProf(qx, qy, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'profile ' +
          describeEntity(s.item, s.idx) + ' fits no prism line', 0);
      }
    }
    if (!hCovered(profG, z0, plo, phi, stol)) {
      return fail('unmatched-edge',
        'profile misses the base line at y=' + z0, 0);
    }
    if (!hCovered(profG, z1, plo, phi, stol)) {
      return fail('unmatched-edge',
        'profile misses the top line at y=' + z1, 0);
    }
    for (si = 0; si < px.length; si++) {
      if (!vCovered(profG, px[si], z0, z1, stol)) {
        return fail('unmatched-edge',
          'profile misses the vertical at x=' + px[si], 0);
      }
    }
    var inside = rectInside(plo, phi, z0, z1);
    var eOk = eSegsContained(profG.segs, profG.verts, inside, stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'profile hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) + ' escapes the outline', 0);
    }
    for (si = 0; si < profG.points.length; si++) {
      var pv = profG.verts[profG.points[si].v];
      if (!onProf(pv.x, pv.y, eps)) {
        return fail('unmatched-point', 'profile point ' +
          describeEntity(profG.points[si].item, profG.points[si].idx) +
          ' sits off the prism lines', 0);
      }
    }
    return { pass: true, coverage: viewCoverage(profG, onProf, inside, stol) };
  }

  // --- Class A: prismatic sweep of the plan loop over [z0, z1]. ---
  // Same-view checks use the weld tol; cross-view checks (plan stations
  // vs drawn elevation) use the structural tol, since paired stations
  // may legitimately differ by up to eps.
  function tryPrism(planG, elevG, planLoop, eps, tol, profG) {
    if (!planLoop) return null;
    var stol = Math.max(tol, eps);
    var solid = loopSolidity(planG, planLoop, tol);
    if (!solid.ok) {
      return fail('non-convex-profile',
        'plan loop edge ' + solid.edge + ' is not drawn (non-convex?)', 0);
    }
    var stations = loopStations(planG, planLoop, tol);
    var xL = stations[0], xR = stations[stations.length - 1];
    var er = drawnRangeAB(elevG);
    if (!er) {
      return fail('unmatched-edge', 'elevation shows no prism extent', 0);
    }
    if (Math.abs(er.x0 - xL) > eps || Math.abs(er.x1 - xR) > eps) {
      return fail('x-mismatch', 'elevation x-range [' + er.x0 + ', ' +
        er.x1 + '] vs plan [' + xL + ', ' + xR + '] beyond eps', 0);
    }
    var z0 = er.y0, z1 = er.y1;
    if (!(z1 - z0 > tol)) {
      return fail('non-manifold', 'elevation extent has zero height', 0);
    }
    var si, s, a, b, px, py, okLine;
    for (si = 0; si < planG.segs.length; si++) {
      s = planG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = planG.verts[s.a];
      b = planG.verts[s.b];
      okLine = true;
      for (var k = 0; k < 5; k++) {
        var t = k / 4;
        px = a.x + (b.x - a.x) * t;
        py = a.y + (b.y - a.y) * t;
        if (!onLoopLines(planG, planLoop)(px, py, tol)) {
          okLine = false;
          break;
        }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'plan ' +
          describeEntity(s.item, s.idx) + ' leaves the loop', 0);
      }
    }
    var onElev = onPrismElevLines(stations, z0, z1);
    for (si = 0; si < elevG.segs.length; si++) {
      s = elevG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = elevG.verts[s.a];
      b = elevG.verts[s.b];
      okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        px = a.x + (b.x - a.x) * u;
        py = a.y + (b.y - a.y) * u;
        if (!onElev(px, py, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'elevation ' +
          describeEntity(s.item, s.idx) + ' fits no prism line', 0);
      }
    }
    if (!hCovered(elevG, z0, xL, xR, stol)) {
      return fail('unmatched-edge',
        'elevation misses the base line at y=' + z0, 0);
    }
    if (!hCovered(elevG, z1, xL, xR, stol)) {
      return fail('unmatched-edge',
        'elevation misses the top line at y=' + z1, 0);
    }
    for (si = 0; si < stations.length; si++) {
      if (!vCovered(elevG, stations[si], z0, z1, stol)) {
        return fail('unmatched-edge',
          'elevation misses the vertical at x=' + stations[si], 0);
      }
    }
    var eOk = eSegsContained(elevG.segs, elevG.verts,
      rectInside(xL, xR, z0, z1), stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'elevation hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) + ' escapes the outline', 0);
    }
    var pOk = eSegsContained(planG.segs, planG.verts,
      loopInside(planG, planLoop), tol, 5);
    if (!pOk.ok) {
      return fail('unmatched-edge', 'plan hidden ' +
        describeEntity(pOk.seg.item, pOk.seg.idx) + ' escapes the loop', 0);
    }
    var onLoop = onLoopLines(planG, planLoop);
    for (si = 0; si < planG.points.length; si++) {
      var pv = planG.verts[planG.points[si].v];
      if (!onLoop(pv.x, pv.y, eps)) {
        return fail('unmatched-point', 'plan point ' +
          describeEntity(planG.points[si].item, planG.points[si].idx) +
          ' sits off the loop', 0);
      }
    }
    for (si = 0; si < elevG.points.length; si++) {
      var ev = elevG.verts[elevG.points[si].v];
      if (!onElev(ev.x, ev.y, eps)) {
        return fail('unmatched-point', 'elevation point ' +
          describeEntity(elevG.points[si].item, elevG.points[si].idx) +
          ' sits off the prism lines', 0);
      }
    }
    // M2: with a profile view, both depth orientations are tried in
    // fixed order; the first passing map wins (the solid derives from
    // plan/elevation alone, so dual-pass solids are identical and the
    // pick is deterministic, never a guess). Two failing maps report
    // the direct map's failure.
    var profMap = null, profRes = null;
    if (profG) {
      var pDepths = loopDepths(planG, planLoop, tol);
      var pr0 = drawnRangeAB(profG);
      if (!pr0) {
        return fail('unmatched-edge', 'profile shows no prism extent', 0);
      }
      var pMaps = inferProfileMaps(pDepths[0], pr0.x0, pr0.x1);
      var pFirstErr = null;
      for (var pmi = 0; pmi < pMaps.length; pmi++) {
        var pTry = checkPrismProfile(profG, pDepths, z0, z1,
          pMaps[pmi], eps, stol);
        if (pTry.pass) { profMap = pMaps[pmi]; profRes = pTry; break; }
        if (!pFirstErr) pFirstErr = pTry;
      }
      if (!profMap) return pFirstErr;
    }
    var n = planLoop.order.length;
    var verts = [];
    for (si = 0; si < n; si++) {
      var lp = planG.verts[planLoop.order[si]];
      verts.push({ x: lp.x, y: z0, z: -lp.y });
    }
    for (si = 0; si < n; si++) {
      var tp = planG.verts[planLoop.order[si]];
      verts.push({ x: tp.x, y: z1, z: -tp.y });
    }
    var edges = [];
    for (si = 0; si < n; si++) {
      var nx = (si + 1) % n;
      edges.push([si, nx]);
      edges.push([si + n, nx + n]);
      edges.push([si, si + n]);
    }
    var faces = [];
    var checks = [];
    var bottom = [], top = [];
    for (si = 0; si < n; si++) { bottom.push(si); top.push(si + n); }
    faces.push(bottom);
    checks.push(function (nn) { return nn.y < 0; });
    faces.push(top);
    checks.push(function (nn) { return nn.y > 0; });
    for (si = 0; si < n; si++) {
      var jx = (si + 1) % n;
      faces.push([si, jx, jx + n, si + n]);
      checks.push(outwardSideCheck(verts, bottom, si, jx));
    }
    faces = orientFaces(verts, faces, checks);
    var covPlan = viewCoverage(planG, onLoop,
      loopInside(planG, planLoop), tol);
    var covElev = viewCoverage(elevG, onElev,
      rectInside(xL, xR, z0, z1), stol);
    var covProfA = profRes ? profRes.coverage : 1;
    var cov = Math.min(covPlan, covElev, covProfA);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed',
        'prism round-trip coverage ' + cov.toFixed(3), cov);
    }
    var outA = {
      pass: true, class: 'A', coverage: cov,
      totalLength: totalLength(verts, edges),
      geometry: { name: 'prism', vertices: verts, edges: edges, faces: faces },
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(verts, edges)
    };
    if (profG) {
      outA.coverageProfile = covProfA;
      outA.profileMap = profMap;
    }
    return outA;
  }

  function onPyramidElevLines(xL, xR, xa, z0, z1) {
    return function (px, py, tol) {
      if (Math.abs(py - z0) <= tol && px >= xL - tol && px <= xR + tol) {
        return true;
      }
      if (distPtSeg(px, py, xL, z0, xa, z1) <= tol) return true;
      if (distPtSeg(px, py, xR, z0, xa, z1) <= tol) return true;
      return false;
    };
  }

  function onPyramidPlanLines(graph, loop, apex) {
    var onLoop = onLoopLines(graph, loop);
    return function (px, py, tol) {
      if (onLoop(px, py, tol)) return true;
      for (var i = 0; i < loop.order.length; i++) {
        var c = graph.verts[loop.order[i]];
        if (distPtSeg(px, py, apex.x, apex.y, c.x, c.y) <= tol) return true;
      }
      return false;
    };
  }

  function pyramidTriIn(xL, xR, xa, z0, z1) {
    return function (qx, qy, t2) {
      if (qy < z0 - t2 || qy > z1 + t2) return false;
      var f = (qy - z0) / (z1 - z0);
      var xl = xL + (xa - xL) * f, xr = xR + (xa - xR) * f;
      var lo = Math.min(xl, xr) - t2, hi = Math.max(xl, xr) + t2;
      return qx >= lo && qx <= hi;
    };
  }

  // Profile validation for Class B: base line plus slants to the mapped
  // apex, mirroring the elevation side. Returns a fail object, or
  // {pass, coverage} when the map fits.
  function checkPyramidProfile(profG, dLo, dHi, da, z0, z1, map, eps, tol, stol) {
    var plo = Math.min(mapDepth(map, dLo), mapDepth(map, dHi));
    var phi = Math.max(mapDepth(map, dLo), mapDepth(map, dHi));
    var pr = drawnRangeAB(profG);
    if (!pr) {
      return fail('unmatched-edge', 'profile shows no pyramid extent', 0);
    }
    if (Math.abs(pr.x0 - plo) > eps || Math.abs(pr.x1 - phi) > eps) {
      return fail('x-mismatch', 'profile x-range [' + pr.x0 + ', ' +
        pr.x1 + '] vs mapped depth [' + plo + ', ' + phi + '] beyond eps', 0);
    }
    var xa = mapDepth(map, da);
    var profApex = null;
    for (var ei = 0; ei < profG.points.length; ei++) {
      var qv = profG.verts[profG.points[ei].v];
      if (Math.abs(qv.y - z1) <= tol) {
        if (profApex !== null) {
          return fail('ambiguous-pairing',
            'two points share the profile top line', 0);
        }
        profApex = { x: qv.x, y: qv.y, ref: profG.points[ei] };
      }
    }
    if (profApex === null) {
      return fail('unmatched-point',
        'plan apex has no mate on the profile top line', 0);
    }
    var dxa = Math.abs(profApex.x - xa);
    if (dxa > eps) {
      if (dxa <= LOOSE_EPS_MM) {
        return fail('x-mismatch', 'apex mapped x=' + xa +
          ' vs profile x=' + profApex.x + ' beyond eps', 0);
      }
      return fail('unmatched-point',
        'profile top point matches no plan apex', 0);
    }
    var xap = (xa + profApex.x) / 2;
    if (!hCovered(profG, z0, plo, phi, stol)) {
      return fail('unmatched-edge',
        'profile misses the base line at y=' + z0, 0);
    }
    if (!slantCovered(profG, plo, z0, xap, z1, stol)) {
      return fail('unmatched-edge', 'profile misses the left slant', 0);
    }
    if (!slantCovered(profG, phi, z0, xap, z1, stol)) {
      return fail('unmatched-edge', 'profile misses the right slant', 0);
    }
    var onProf = onPyramidElevLines(plo, phi, xap, z0, z1);
    var si, s, a, b, okLine, qx, qy;
    for (si = 0; si < profG.segs.length; si++) {
      s = profG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = profG.verts[s.a];
      b = profG.verts[s.b];
      okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        qx = a.x + (b.x - a.x) * u;
        qy = a.y + (b.y - a.y) * u;
        if (!onProf(qx, qy, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'profile ' +
          describeEntity(s.item, s.idx) + ' fits no pyramid line', 0);
      }
    }
    var triIn = pyramidTriIn(plo, phi, xap, z0, z1);
    var eOk = eSegsContained(profG.segs, profG.verts, triIn, stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'profile hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) + ' escapes the outline', 0);
    }
    for (si = 0; si < profG.points.length; si++) {
      var pv = profG.verts[profG.points[si].v];
      if (!onProf(pv.x, pv.y, eps)) {
        return fail('unmatched-point', 'profile point ' +
          describeEntity(profG.points[si].item, profG.points[si].idx) +
          ' sits off the pyramid lines', 0);
      }
    }
    return { pass: true, coverage: viewCoverage(profG, onProf, triIn, stol) };
  }

  // --- Class B: pyramid over the plan loop with an interior apex seen in
  // both views. Returns null when no plan apex exists (not a pyramid).
  function tryPyramid(planG, elevG, planLoop, eps, tol, profG) {
    if (!planLoop) return null;
    var stol = Math.max(tol, eps);
    var solid = loopSolidity(planG, planLoop, tol);
    if (!solid.ok) {
      return fail('non-convex-profile',
        'plan loop edge ' + solid.edge + ' is not drawn (non-convex?)', 0);
    }
    var apexes = [];
    for (var pi = 0; pi < planG.points.length; pi++) {
      var pv = planG.verts[planG.points[pi].v];
      if (pointInLoop(pv.x, pv.y, planG, planLoop, tol) === 'in') {
        apexes.push({ x: pv.x, y: pv.y, ref: planG.points[pi] });
      }
    }
    if (apexes.length === 0) return null;
    if (apexes.length > 1) {
      return fail('ambiguous-pairing', apexes.length +
        ' interior plan points compete for the apex', 0);
    }
    var apex = apexes[0];
    var stations = loopStations(planG, planLoop, tol);
    var xL = stations[0], xR = stations[stations.length - 1];
    var er = drawnRangeAB(elevG);
    if (!er) {
      return fail('unmatched-edge', 'elevation shows no pyramid extent', 0);
    }
    if (Math.abs(er.x0 - xL) > eps || Math.abs(er.x1 - xR) > eps) {
      return fail('x-mismatch', 'elevation x-range [' + er.x0 + ', ' +
        er.x1 + '] vs plan [' + xL + ', ' + xR + '] beyond eps', 0);
    }
    var z0 = er.y0, z1 = er.y1;
    if (!(z1 - z0 > tol)) {
      return fail('non-manifold', 'elevation extent has zero height', 0);
    }
    var elevApex = null;
    for (var ei = 0; ei < elevG.points.length; ei++) {
      var qv = elevG.verts[elevG.points[ei].v];
      if (Math.abs(qv.y - z1) <= tol) {
        if (elevApex !== null) {
          return fail('ambiguous-pairing',
            'two points share the elevation top line', 0);
        }
        elevApex = { x: qv.x, y: qv.y, ref: elevG.points[ei] };
      }
    }
    if (elevApex === null) {
      return fail('unmatched-point',
        'plan apex has no mate on the elevation top line', 0);
    }
    var dxa = Math.abs(elevApex.x - apex.x);
    if (dxa > eps) {
      if (dxa <= LOOSE_EPS_MM) {
        return fail('x-mismatch', 'apex plan x=' + apex.x +
          ' vs elevation x=' + elevApex.x + ' beyond eps', 0);
      }
      return fail('unmatched-point',
        'elevation top point matches no plan apex', 0);
    }
    var xa = (apex.x + elevApex.x) / 2;
    if (!hCovered(elevG, z0, xL, xR, stol)) {
      return fail('unmatched-edge',
        'elevation misses the base line at y=' + z0, 0);
    }
    if (!slantCovered(elevG, xL, z0, xa, z1, stol)) {
      return fail('unmatched-edge', 'elevation misses the left slant', 0);
    }
    if (!slantCovered(elevG, xR, z0, xa, z1, stol)) {
      return fail('unmatched-edge', 'elevation misses the right slant', 0);
    }
    var onPlan = onPyramidPlanLines(planG, planLoop, apex);
    var si, s, a, b, okLine, px, py;
    for (si = 0; si < planG.segs.length; si++) {
      s = planG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = planG.verts[s.a];
      b = planG.verts[s.b];
      okLine = true;
      for (var k = 0; k < 5; k++) {
        var t = k / 4;
        px = a.x + (b.x - a.x) * t;
        py = a.y + (b.y - a.y) * t;
        if (!onPlan(px, py, tol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'plan ' +
          describeEntity(s.item, s.idx) + ' fits no pyramid line', 0);
      }
    }
    var onElev = onPyramidElevLines(xL, xR, xa, z0, z1);
    for (si = 0; si < elevG.segs.length; si++) {
      s = elevG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = elevG.verts[s.a];
      b = elevG.verts[s.b];
      okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        px = a.x + (b.x - a.x) * u;
        py = a.y + (b.y - a.y) * u;
        if (!onElev(px, py, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'elevation ' +
          describeEntity(s.item, s.idx) + ' fits no pyramid line', 0);
      }
    }
    var triIn = pyramidTriIn(xL, xR, xa, z0, z1);
    var eOk = eSegsContained(elevG.segs, elevG.verts, triIn, stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'elevation hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) + ' escapes the outline', 0);
    }
    var pOk = eSegsContained(planG.segs, planG.verts,
      loopInside(planG, planLoop), tol, 5);
    if (!pOk.ok) {
      return fail('unmatched-edge', 'plan hidden ' +
        describeEntity(pOk.seg.item, pOk.seg.idx) + ' escapes the loop', 0);
    }
    for (si = 0; si < planG.points.length; si++) {
      var pv2 = planG.verts[planG.points[si].v];
      if (!onPlan(pv2.x, pv2.y, eps)) {
        return fail('unmatched-point', 'plan point ' +
          describeEntity(planG.points[si].item, planG.points[si].idx) +
          ' sits off the pyramid lines', 0);
      }
    }
    for (si = 0; si < elevG.points.length; si++) {
      var ev2 = elevG.verts[elevG.points[si].v];
      if (!onElev(ev2.x, ev2.y, eps)) {
        return fail('unmatched-point', 'elevation point ' +
          describeEntity(elevG.points[si].item, elevG.points[si].idx) +
          ' sits off the pyramid lines', 0);
      }
    }
    // M2: profile trial mirrors Class A (fixed map order, first pass
    // wins, direct map's failure reported when neither passes).
    var profMapB = null, profResB = null;
    if (profG) {
      var bDepths = loopDepths(planG, planLoop, tol);
      var br0 = drawnRangeAB(profG);
      if (!br0) {
        return fail('unmatched-edge', 'profile shows no pyramid extent', 0);
      }
      var bMaps = inferProfileMaps(bDepths[0], br0.x0, br0.x1);
      var bFirstErr = null;
      for (var bmi = 0; bmi < bMaps.length; bmi++) {
        var bTry = checkPyramidProfile(profG, bDepths[0],
          bDepths[bDepths.length - 1], -apex.y, z0, z1,
          bMaps[bmi], eps, tol, stol);
        if (bTry.pass) { profMapB = bMaps[bmi]; profResB = bTry; break; }
        if (!bFirstErr) bFirstErr = bTry;
      }
      if (!profMapB) return bFirstErr;
    }
    var n = planLoop.order.length;
    var verts = [];
    for (si = 0; si < n; si++) {
      var bp = planG.verts[planLoop.order[si]];
      verts.push({ x: bp.x, y: z0, z: -bp.y });
    }
    verts.push({ x: xa, y: z1, z: -apex.y });
    var apexIdx = n;
    var edges = [];
    for (si = 0; si < n; si++) {
      edges.push([si, (si + 1) % n]);
      edges.push([si, apexIdx]);
    }
    var faces = [];
    var checks = [];
    var base = [];
    for (si = 0; si < n; si++) base.push(si);
    faces.push(base);
    checks.push(function (nn) { return nn.y < 0; });
    for (si = 0; si < n; si++) {
      var jx = (si + 1) % n;
      faces.push([si, jx, apexIdx]);
      checks.push(outwardSideCheck(verts, base, si, jx));
    }
    faces = orientFaces(verts, faces, checks);
    var covPlan = viewCoverage(planG, onPlan,
      loopInside(planG, planLoop), tol);
    var covElev = viewCoverage(elevG, onElev, triIn, stol);
    var covProfB = profResB ? profResB.coverage : 1;
    var cov = Math.min(covPlan, covElev, covProfB);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed',
        'pyramid round-trip coverage ' + cov.toFixed(3), cov);
    }
    var outB = {
      pass: true, class: 'B', coverage: cov,
      totalLength: totalLength(verts, edges),
      geometry: { name: 'pyramid', vertices: verts, edges: edges, faces: faces },
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(verts, edges)
    };
    if (profG) {
      outB.coverageProfile = covProfB;
      outB.profileMap = profMapB;
    }
    return outB;
  }

  // Union x-stations across both views: sorted greedy clustering within
  // eps. Returns {stations:[x...], planSt:[vertIdx->st], elevSt:[...]}.
  function unionStations(planG, elevG, eps) {
    var all = [];
    var i;
    for (i = 0; i < planG.verts.length; i++) {
      all.push({ x: planG.verts[i].x, view: 0, v: i });
    }
    for (i = 0; i < elevG.verts.length; i++) {
      all.push({ x: elevG.verts[i].x, view: 1, v: i });
    }
    all.sort(function (a, b) { return a.x - b.x; });
    var stations = [];
    var planSt = [], elevSt = [];
    for (i = 0; i < all.length; i++) {
      if (stations.length === 0 ||
          Math.abs(all[i].x - stations[stations.length - 1].x) > eps) {
        stations.push({ x: all[i].x, n: 0 });
      }
      var st = stations[stations.length - 1];
      st.x = (st.x * st.n + all[i].x) / (st.n + 1);
      st.n++;
      if (all[i].view === 0) planSt[all[i].v] = stations.length - 1;
      else elevSt[all[i].v] = stations.length - 1;
    }
    return {
      stations: stations.map(function (s) { return s.x; }),
      planSt: planSt, elevSt: elevSt
    };
  }

  function stationPairKey(s1, s2) {
    return s1 < s2 ? s1 + '-' + s2 : s2 + '-' + s1;
  }

  // --- Pair-by-name: display names are absolute. Plan `a`, elevation
  // `a'`, and profile `a''` share base `a` and name one 3D point; pairing
  // follows the shared base while the projector (same x-station within
  // eps) still validates the pair. Only genuine POINT entities name a
  // vertex; segment captions (edge names like `ab`) never do. Unlabeled
  // vertices keep the legacy geometric reading.
  function baseNameOf(caption) {
    var s = (caption === undefined || caption === null) ? '' : String(caption);
    s = s.replace(/^\s+|\s+$/g, '');
    while (s.length > 0) {
      var ch = s.charAt(s.length - 1);
      if (ch === "'" || ch === '′' || ch === '’') s = s.slice(0, -1);
      else break;
    }
    return s;
  }

  // Base-name SET of one caption: multi-caption parts split on commas,
  // one wrapping paren pair (the student's hidden verdict) stripped per
  // part, then prime ticks stripped. Verdicts are invisible to the gate:
  // typing parens never breaks reconstruction. 'h,(b\')' -> ['h','b'].
  function captionBases(caption) {
    var s = (caption === undefined || caption === null) ? '' : String(caption);
    var raw = s.split(',');
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var t = raw[i].replace(/^\s+|\s+$/g, '');
      if (t.length >= 2 && t.charAt(0) === '(' && t.charAt(t.length - 1) === ')') {
        t = t.slice(1, -1).replace(/^\s+|\s+$/g, '');
      }
      var b = baseNameOf(t);
      if (b !== '' && out.indexOf(b) === -1) out.push(b);
    }
    return out;
  }

  function vertBases(graph) {
    var per = [];
    for (var i = 0; i < graph.verts.length; i++) per.push([]);
    for (var j = 0; j < graph.points.length; j++) {
      var p = graph.points[j];
      if (!p.item || p.item.type !== 'POINT') continue;
      var bs = captionBases(p.item.caption);
      for (var k = 0; k < bs.length; k++) {
        if (per[p.v].indexOf(bs[k]) === -1) per[p.v].push(bs[k]);
      }
    }
    return per;
  }

  function shareBase(a, b) {
    for (var i = 0; i < a.length; i++) {
      if (b.indexOf(a[i]) !== -1) return true;
    }
    return false;
  }

  function namesCompatible(pb, eb) {
    if (pb.length === 0 || eb.length === 0) return true;
    return shareBase(pb, eb);
  }

  // Cross-view label contradiction detector (all classes): at any shared
  // x-station where both views carry POINT labels, the base sets must
  // meet; a profile label must name a plan/elevation base. Returns a
  // `name-mismatch` fail or null. Unlabeled drawings always pass.
  function checkNameGate(planG, elevG, eps, profG) {
    var pb = vertBases(planG), eb = vertBases(elevG);
    var U = unionStations(planG, elevG, eps);
    var planAt = {}, elevAt = {}, i, st;
    for (i = 0; i < U.planSt.length; i++) {
      st = U.planSt[i];
      if (!planAt[st]) planAt[st] = [];
      planAt[st].push(i);
    }
    for (i = 0; i < U.elevSt.length; i++) {
      st = U.elevSt[i];
      if (!elevAt[st]) elevAt[st] = [];
      elevAt[st].push(i);
    }
    function unionOf(per, verts) {
      var seen = {}, out = [];
      for (var k = 0; k < verts.length; k++) {
        var arr = per[verts[k]];
        for (var m = 0; m < arr.length; m++) {
          if (!seen[arr[m]]) { seen[arr[m]] = 1; out.push(arr[m]); }
        }
      }
      return out;
    }
    for (var sk in planAt) {
      if (!Object.prototype.hasOwnProperty.call(planAt, sk)) continue;
      if (!elevAt[sk]) continue;
      var pB = unionOf(pb, planAt[sk]);
      var eB = unionOf(eb, elevAt[sk]);
      if (pB.length === 0 || eB.length === 0) continue;
      if (!shareBase(pB, eB)) {
        return fail('name-mismatch', 'plan "' + pB[0] + '" vs elevation "' +
          eB[0] + '" at x=' + U.stations[Number(sk)] +
          ' share a projector but name different points', 0);
      }
    }
    if (profG) {
      var known = {}, anyKnown = false, q, w;
      var all = pb.concat(eb);
      for (i = 0; i < all.length; i++) {
        for (q = 0; q < all[i].length; q++) {
          known[all[i][q]] = 1;
          anyKnown = true;
        }
      }
      if (!anyKnown) return null;
      var qb = vertBases(profG);
      for (i = 0; i < qb.length; i++) {
        for (w = 0; w < qb[i].length; w++) {
          if (!known[qb[i][w]]) {
            return fail('name-mismatch', 'profile "' + qb[i][w] +
              '" names no plan/elevation point', 0);
          }
        }
      }
    }
    return null;
  }

  function nearDrawnPoint(graph, px, py, tol) {
    for (var j = 0; j < graph.points.length; j++) {
      var v = graph.verts[graph.points[j].v];
      var dx = px - v.x, dy = py - v.y;
      if (dx * dx + dy * dy <= tol * tol) return true;
    }
    return false;
  }

  // Profile validation for Class C: the lifted wireframe projects into
  // the profile through the depth map, and the projection must agree
  // with the drawn profile both ways (drawn geometry explained,
  // projected geometry drawn). Returns a fail object, or {pass,
  // coverage} when the map fits.
  function checkWireProfile(profG, verts, edges, map, eps, stol) {
    var projE = [], projV = [];
    var i;
    for (i = 0; i < edges.length; i++) {
      var va = verts[edges[i][0]], vb = verts[edges[i][1]];
      projE.push({
        ax: mapDepth(map, va.z), ay: va.y,
        bx: mapDepth(map, vb.z), by: vb.y
      });
    }
    for (i = 0; i < verts.length; i++) {
      projV.push({ x: mapDepth(map, verts[i].z), y: verts[i].y });
    }
    function onProjE(qx, qy, t2) {
      for (var l = 0; l < projE.length; l++) {
        if (distPtSeg(qx, qy, projE[l].ax, projE[l].ay,
            projE[l].bx, projE[l].by) <= t2) {
          return true;
        }
      }
      return false;
    }
    function onProjEW(qx, qy, t2) {
      if (onProjE(qx, qy, t2)) return true;
      for (var v = 0; v < projV.length; v++) {
        var dx = qx - projV[v].x, dy = qy - projV[v].y;
        if (dx * dx + dy * dy <= t2 * t2) return true;
      }
      return false;
    }
    var eOk = eSegsContained(profG.segs, profG.verts,
      function (qx, qy, t2) { return onProjE(qx, qy, t2); }, stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'profile hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) +
        ' matches no projected edge', 0);
    }
    var si, s, a, b, okLine, qx, qy;
    for (si = 0; si < profG.segs.length; si++) {
      s = profG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = profG.verts[s.a];
      b = profG.verts[s.b];
      okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        qx = a.x + (b.x - a.x) * u;
        qy = a.y + (b.y - a.y) * u;
        if (!onProjEW(qx, qy, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'profile ' +
          describeEntity(s.item, s.idx) + ' matches no projected edge', 0);
      }
    }
    for (si = 0; si < profG.points.length; si++) {
      var pv = profG.verts[profG.points[si].v];
      if (!onProjEW(pv.x, pv.y, eps)) {
        return fail('unmatched-point', 'profile point ' +
          describeEntity(profG.points[si].item, profG.points[si].idx) +
          ' matches no projected vertex', 0);
      }
    }
    for (i = 0; i < projE.length; i++) {
      if (segCoveredFrac(projE[i].ax, projE[i].ay, projE[i].bx, projE[i].by,
          profG, stol, 9) < 1) {
        return fail('unmatched-edge',
          'profile omits the projection of a wireframe edge', 0);
      }
    }
    for (i = 0; i < projV.length; i++) {
      if (minDistToSegs(projV[i].x, projV[i].y, profG.verts, profG.segs,
          isAB) > stol &&
          !nearDrawnPoint(profG, projV[i].x, projV[i].y, stol)) {
        return fail('unmatched-edge',
          'profile omits the projection of a wireframe vertex', 0);
      }
    }
    var cov = viewCoverage(profG,
      function (qx, qy, t2) { return onProjEW(qx, qy, t2); },
      function (qx, qy, t2) { return onProjE(qx, qy, t2); }, stol);
    return { pass: true, coverage: cov };
  }

  // --- Class C: lifted wireframe. Vertices pair across views by name
  // first (shared base at one station), then geometrically; edges need
  // both projections (degenerate point+segment pins excepted).
  // strictOpt === false restores the legacy pure-geometric pairing.
  function tryWireframe(planG, elevG, eps, tol, profG, strictOpt) {
    var strict = strictOpt !== false;
    var stol = Math.max(tol, eps);
    var planBases = strict ? vertBases(planG) : null;
    var elevBases = strict ? vertBases(elevG) : null;
    var planOwners = {}, elevOwners = {};
    var U = unionStations(planG, elevG, eps);
    var planSt = U.planSt, elevSt = U.elevSt;
    var P2E = {}, E2P = {};
    var ambiguous = null;
    function noteAmb(msg) { if (!ambiguous) ambiguous = msg; }
    function pairUp(p, q) {
      if (P2E[p] !== undefined && P2E[p] !== q) {
        noteAmb('plan vertex pairs twice');
        return false;
      }
      if (E2P[q] !== undefined && E2P[q] !== p) {
        noteAmb('elevation vertex pairs twice');
        return false;
      }
      P2E[p] = q;
      E2P[q] = p;
      return true;
    }
    var byStP = {}, byStE = {}, i, st;
    for (i = 0; i < planG.verts.length; i++) {
      st = planSt[i];
      if (!byStP[st]) byStP[st] = [];
      byStP[st].push(i);
    }
    for (i = 0; i < elevG.verts.length; i++) {
      st = elevSt[i];
      if (!byStE[st]) byStE[st] = [];
      byStE[st].push(i);
    }
    var segUsersP = {}, segUsersE = {};
    for (i = 0; i < planG.segs.length; i++) {
      segUsersP[planG.segs[i].a] = 1;
      segUsersP[planG.segs[i].b] = 1;
    }
    for (i = 0; i < elevG.segs.length; i++) {
      segUsersE[elevG.segs[i].a] = 1;
      segUsersE[elevG.segs[i].b] = 1;
    }
    function lonePointVert(users, idx) { return !users[idx]; }
    // Pass 0: pair by name. A plan vertex and an elevation vertex at one
    // station pair when each shares bases with exactly that one mate;
    // multi-labeled end-on dots fall through to the pin pass below.
    function distinctMates(owners, bases) {
      var out = [];
      for (var k = 0; k < bases.length; k++) {
        var own = owners[bases[k]] || [];
        for (var o = 0; o < own.length; o++) {
          if (out.indexOf(own[o]) === -1) out.push(own[o]);
        }
      }
      return out;
    }
    if (strict) {
      var vi, bi;
      for (vi = 0; vi < planBases.length; vi++) {
        for (bi = 0; bi < planBases[vi].length; bi++) {
          var pkk = planBases[vi][bi];
          if (!planOwners[pkk]) planOwners[pkk] = [];
          if (planOwners[pkk].indexOf(vi) === -1) planOwners[pkk].push(vi);
        }
      }
      for (vi = 0; vi < elevBases.length; vi++) {
        for (bi = 0; bi < elevBases[vi].length; bi++) {
          var ekk = elevBases[vi][bi];
          if (!elevOwners[ekk]) elevOwners[ekk] = [];
          if (elevOwners[ekk].indexOf(vi) === -1) elevOwners[ekk].push(vi);
        }
      }
      for (vi = 0; vi < planG.verts.length; vi++) {
        if (planBases[vi].length === 0 || P2E[vi] !== undefined) continue;
        var mates = distinctMates(elevOwners, planBases[vi]);
        if (mates.length !== 1) continue;
        var mq = mates[0];
        if (E2P[mq] !== undefined) continue;
        if (planSt[vi] !== elevSt[mq]) continue;
        if (distinctMates(planOwners, elevBases[mq]).length !== 1) continue;
        pairUp(vi, mq);
      }
    }
    // Pass 1: 1:1 stations.
    var sk;
    for (sk in byStP) {
      if (!Object.prototype.hasOwnProperty.call(byStP, sk)) continue;
      if (byStP[sk].length === 1 && byStE[sk] && byStE[sk].length === 1) {
        var p0 = byStP[sk][0], q0 = byStE[sk][0];
        if (!strict || namesCompatible(planBases[p0], elevBases[q0])) {
          pairUp(p0, q0);
        }
      }
    }
    // Pass 2: segment-guided matching by station span (fixed plan-driven
    // then elevation-driven order). Iterated with pass 3 to a fixpoint.
    function guidedDrive(segsA, stA, segsB, stB, flip) {
      var spanB = {};
      var i2, s1, s2, key;
      for (i2 = 0; i2 < segsB.length; i2++) {
        s1 = stB[segsB[i2].a];
        s2 = stB[segsB[i2].b];
        if (s1 === s2) continue;
        key = stationPairKey(s1, s2);
        if (!spanB[key]) spanB[key] = [];
        spanB[key].push(i2);
      }
      for (i2 = 0; i2 < segsA.length; i2++) {
        var a = segsA[i2].a, b = segsA[i2].b;
        s1 = stA[a];
        s2 = stA[b];
        if (s1 === s2) continue;
        if (flip ? (E2P[a] !== undefined || E2P[b] !== undefined)
          : (P2E[a] !== undefined || P2E[b] !== undefined)) {
          continue;
        }
        key = stationPairKey(s1, s2);
        var cands = spanB[key] || [];
        if (cands.length === 0) continue;
        if (cands.length > 1) {
          noteAmb('two edges share one station span');
          continue;
        }
        var c = segsB[cands[0]];
        var endAtS1 = stB[c.a] === s1 ? c.a : c.b;
        var endAtS2 = stB[c.a] === s1 ? c.b : c.a;
        if (flip) {
          if (!strict || (namesCompatible(planBases[endAtS1], elevBases[a]) &&
              namesCompatible(planBases[endAtS2], elevBases[b]))) {
            pairUp(endAtS1, a);
            pairUp(endAtS2, b);
          }
        } else {
          if (!strict || (namesCompatible(planBases[a], elevBases[endAtS1]) &&
              namesCompatible(planBases[b], elevBases[endAtS2]))) {
            pairUp(a, endAtS1);
            pairUp(b, endAtS2);
          }
        }
      }
    }
    var changed = true, guard = 0;
    while (changed && guard < 12) {
      guard++;
      changed = false;
      var before = Object.keys(P2E).length;
      guidedDrive(planG.segs, planSt, elevG.segs, elevSt, false);
      guidedDrive(elevG.segs, elevSt, planG.segs, planSt, true);
      for (sk in byStP) {
        if (!Object.prototype.hasOwnProperty.call(byStP, sk)) continue;
        if (!byStE[sk]) continue;
        var freeP = byStP[sk].filter(function (v) {
          return P2E[v] === undefined;
        });
        var freeE = byStE[sk].filter(function (v) {
          return E2P[v] === undefined;
        });
        if (freeP.length === 1 && freeE.length === 1) {
          if (!strict ||
              namesCompatible(planBases[freeP[0]], elevBases[freeE[0]])) {
            pairUp(freeP[0], freeE[0]);
          }
        }
      }
      if (Object.keys(P2E).length !== before) changed = true;
    }
    // Degenerate pins: a lone point in one view + a same-station segment
    // in the other is a vertical (plan pin) or depth (elevation pin) edge.
    var pins = [];
    function loneVertsAt(graph, users, stMap, wantSt, skipPaired) {
      var out = [];
      for (var v = 0; v < graph.verts.length; v++) {
        if (stMap[v] !== wantSt) continue;
        if (!lonePointVert(users, v)) continue;
        if (skipPaired && skipPaired[v] !== undefined) continue;
        out.push(v);
      }
      return out;
    }
    function sameStationSegs(graph, stMap, wantSt, skipPaired) {
      var out = [];
      for (var s = 0; s < graph.segs.length; s++) {
        var sg = graph.segs[s];
        if (stMap[sg.a] !== wantSt || stMap[sg.b] !== wantSt) continue;
        if (skipPaired &&
            (skipPaired[sg.a] !== undefined ||
              skipPaired[sg.b] !== undefined)) {
          continue;
        }
        out.push(sg);
      }
      return out;
    }
    var allSt = {};
    var kk;
    for (kk in byStP) {
      if (Object.prototype.hasOwnProperty.call(byStP, kk)) allSt[kk] = 1;
    }
    for (kk in byStE) {
      if (Object.prototype.hasOwnProperty.call(byStE, kk)) allSt[kk] = 1;
    }
    for (kk in allSt) {
      if (!Object.prototype.hasOwnProperty.call(allSt, kk)) continue;
      var want = Number(kk);
      var loneP = loneVertsAt(planG, segUsersP, planSt, want, P2E);
      var loneE = loneVertsAt(elevG, segUsersE, elevSt, want, E2P);
      var segP = sameStationSegs(planG, planSt, want, P2E);
      var segE = sameStationSegs(elevG, elevSt, want, E2P);
      var pinOkV = loneP.length === 1 && segE.length === 1 &&
        loneE.length === 0 && (!strict || namesCompatible(
          planBases[loneP[0]],
          elevBases[segE[0].a].concat(elevBases[segE[0].b])));
      var pinOkD = loneE.length === 1 && segP.length === 1 &&
        loneP.length === 0 && (!strict || namesCompatible(
          planBases[segP[0].a].concat(planBases[segP[0].b]),
          elevBases[loneE[0]]));
      if (pinOkV) {
        pins.push({ p: loneP[0], seg: segE[0], dir: 'vertical' });
        P2E[loneP[0]] = -1;
        E2P[segE[0].a] = -2;
        E2P[segE[0].b] = -2;
      } else if (pinOkD) {
        pins.push({ q: loneE[0], seg: segP[0], dir: 'depth' });
        E2P[loneE[0]] = -1;
        P2E[segP[0].a] = -2;
        P2E[segP[0].b] = -2;
      } else if ((loneP.length === 1 && segE.length > 1) ||
          (loneE.length === 1 && segP.length > 1)) {
        noteAmb('one point pins two same-station edges');
      }
    }
    // Leftover analysis: ambiguity residue stays silent; near misses are
    // x-mismatch; the rest are unmatched points/edges. In strict mode a
    // named vertex first blames duplicates, then its name-selected mate.
    var failInfo = null;
    function noteFail(reason, label) {
      if (!failInfo) failInfo = { reason: reason, label: label };
    }
    function nearestOppX(x, verts) {
      var best = Infinity;
      for (var v = 0; v < verts.length; v++) {
        var d = Math.abs(verts[v].x - x);
        if (d < best) best = d;
      }
      return best;
    }
    function compatStationMates(ownBases, ownSt, otherAtSt, otherBases) {
      var list = otherAtSt[ownSt];
      if (!list) return 0;
      var n = 0;
      for (var c = 0; c < list.length; c++) {
        if (namesCompatible(ownBases, otherBases[list[c]])) n++;
      }
      return n;
    }
    function duplicateBase(bases, owners) {
      for (var k = 0; k < bases.length; k++) {
        if ((owners[bases[k]] || []).length > 1) return bases[k];
      }
      return null;
    }
    function namedMate(bases, owners, verts) {
      var best = null;
      for (var k = 0; k < bases.length; k++) {
        var own = owners[bases[k]] || [];
        for (var o = 0; o < own.length; o++) {
          if (best === null || verts[own[o]].x < best.x) {
            best = { base: bases[k], x: verts[own[o]].x };
          }
        }
      }
      return best;
    }
    for (i = 0; i < planG.verts.length; i++) {
      if (P2E[i] !== undefined) continue;
      if (strict) {
        if (compatStationMates(planBases[i], planSt[i], byStE, elevBases) > 0) {
          noteAmb('plan vertex has several elevation mates');
          continue;
        }
        var dupP = duplicateBase(planBases[i], planOwners);
        if (dupP !== null) {
          noteAmb('plan label "' + dupP + '" marks two dots');
          continue;
        }
        var mateP = namedMate(planBases[i], elevOwners, elevG.verts);
        if (mateP !== null) {
          noteFail('x-mismatch', 'label "' + mateP.base + '" reads x=' +
            planG.verts[i].x + ' in plan but x=' + mateP.x + ' in elevation');
          continue;
        }
      } else if (byStE[planSt[i]] && byStE[planSt[i]].length > 0) {
        noteAmb('plan vertex has several elevation mates');
        continue;
      }
      var nearP = nearestOppX(planG.verts[i].x, elevG.verts);
      if (nearP <= LOOSE_EPS_MM) {
        noteFail('x-mismatch', 'plan vertex near x=' +
          planG.verts[i].x + ' misses its mate beyond eps');
      } else if (lonePointVert(segUsersP, i)) {
        noteFail('unmatched-point',
          strict && planBases[i].length > 0 ?
            'plan "' + planBases[i][0] + '" has no mate in elevation' :
            'plan point near x=' + planG.verts[i].x + ' has no mate');
      } else {
        noteFail('unmatched-edge',
          'plan vertex near x=' + planG.verts[i].x + ' has no mate');
      }
    }
    for (i = 0; i < elevG.verts.length; i++) {
      if (E2P[i] !== undefined) continue;
      if (strict) {
        if (compatStationMates(elevBases[i], elevSt[i], byStP, planBases) > 0) {
          noteAmb('elevation vertex has several plan mates');
          continue;
        }
        var dupE = duplicateBase(elevBases[i], elevOwners);
        if (dupE !== null) {
          noteAmb('elevation label "' + dupE + '" marks two dots');
          continue;
        }
        var mateE = namedMate(elevBases[i], planOwners, planG.verts);
        if (mateE !== null) {
          noteFail('x-mismatch', 'label "' + mateE.base + '" reads x=' +
            elevG.verts[i].x + ' in elevation but x=' + mateE.x + ' in plan');
          continue;
        }
      } else if (byStP[elevSt[i]] && byStP[elevSt[i]].length > 0) {
        noteAmb('elevation vertex has several plan mates');
        continue;
      }
      var nearE = nearestOppX(elevG.verts[i].x, planG.verts);
      if (nearE <= LOOSE_EPS_MM) {
        noteFail('x-mismatch', 'elevation vertex near x=' +
          elevG.verts[i].x + ' misses its mate beyond eps');
      } else if (lonePointVert(segUsersE, i)) {
        noteFail('unmatched-point',
          strict && elevBases[i].length > 0 ?
            'elevation "' + elevBases[i][0] + '" has no mate in plan' :
            'elevation point near x=' + elevG.verts[i].x + ' has no mate');
      } else {
        noteFail('unmatched-edge',
          'elevation vertex near x=' + elevG.verts[i].x + ' has no mate');
      }
    }
    if (failInfo) return fail(failInfo.reason, failInfo.label, 0);
    // Edges need both projections.
    var elevSpan = {};
    for (i = 0; i < elevG.segs.length; i++) {
      var es = elevG.segs[i];
      if (E2P[es.a] === undefined || E2P[es.b] === undefined) continue;
      if (E2P[es.a] < 0 || E2P[es.b] < 0) continue;
      elevSpan[E2P[es.a] + '-' + E2P[es.b]] = 1;
      elevSpan[E2P[es.b] + '-' + E2P[es.a]] = 1;
    }
    var planSpan = {};
    for (i = 0; i < planG.segs.length; i++) {
      var ps = planG.segs[i];
      if (P2E[ps.a] === undefined || P2E[ps.b] === undefined) continue;
      if (P2E[ps.a] < 0 || P2E[ps.b] < 0) continue;
      planSpan[P2E[ps.a] + '-' + P2E[ps.b]] = 1;
      planSpan[P2E[ps.b] + '-' + P2E[ps.a]] = 1;
    }
    for (i = 0; i < planG.segs.length; i++) {
      var pa = planG.segs[i];
      if (P2E[pa.a] === undefined || P2E[pa.b] === undefined) continue;
      if (P2E[pa.a] < 0 || P2E[pa.b] < 0) continue;
      if (planG.segs[i].item.bisCode === 'E') continue;
      if (!elevSpan[pa.a + '-' + pa.b]) {
        return fail('unmatched-edge', 'plan ' +
          describeEntity(pa.item, pa.idx) + ' lacks an elevation mate', 0);
      }
    }
    for (i = 0; i < elevG.segs.length; i++) {
      var ea = elevG.segs[i];
      if (E2P[ea.a] === undefined || E2P[ea.b] === undefined) continue;
      if (E2P[ea.a] < 0 || E2P[ea.b] < 0) continue;
      if (elevG.segs[i].item.bisCode === 'E') continue;
      if (!planSpan[ea.a + '-' + ea.b]) {
        return fail('unmatched-edge', 'elevation ' +
          describeEntity(ea.item, ea.idx) + ' lacks a plan mate', 0);
      }
    }
    if (ambiguous) return fail('ambiguous-pairing', ambiguous, 0);
    // Construct: one vertex per pair, x averaged to split the eps error.
    var pairs = [];
    for (var pk in P2E) {
      if (!Object.prototype.hasOwnProperty.call(P2E, pk)) continue;
      if (P2E[pk] < 0) continue;
      pairs.push({ p: Number(pk), q: P2E[pk] });
    }
    pairs.sort(function (a, b) {
      var ax = (planG.verts[a.p].x + elevG.verts[a.q].x) / 2;
      var bx = (planG.verts[b.p].x + elevG.verts[b.q].x) / 2;
      if (ax !== bx) return ax - bx;
      if (planG.verts[a.p].y !== planG.verts[b.p].y) {
        return planG.verts[a.p].y - planG.verts[b.p].y;
      }
      return elevG.verts[a.q].y - elevG.verts[b.q].y;
    });
    var pairIdx = {};
    var verts = [];
    for (i = 0; i < pairs.length; i++) {
      var pv = planG.verts[pairs[i].p], qv = elevG.verts[pairs[i].q];
      pairIdx[pairs[i].p + '-' + pairs[i].q] = verts.length;
      verts.push({ x: (pv.x + qv.x) / 2, y: qv.y, z: -pv.y });
    }
    function addPinned(x, d, h) {
      for (var v = 0; v < verts.length; v++) {
        var dx = verts[v].x - x, dy = verts[v].y - h, dz = verts[v].z - d;
        if (dx * dx + dy * dy + dz * dz <= tol * tol) return v;
      }
      verts.push({ x: x, y: h, z: d });
      return verts.length - 1;
    }
    var edges = [];
    var seenEdge = {};
    function addEdge(a, b) {
      if (a === b) return;
      var key = a < b ? a + '-' + b : b + '-' + a;
      if (seenEdge[key]) return;
      seenEdge[key] = 1;
      edges.push([a, b]);
    }
    for (i = 0; i < planG.segs.length; i++) {
      var gs = planG.segs[i];
      if (P2E[gs.a] === undefined || P2E[gs.b] === undefined) continue;
      if (P2E[gs.a] < 0 || P2E[gs.b] < 0) continue;
      if (gs.item.bisCode === 'E') continue;
      addEdge(pairIdx[gs.a + '-' + P2E[gs.a]],
        pairIdx[gs.b + '-' + P2E[gs.b]]);
    }
    for (i = 0; i < pins.length; i++) {
      var pin = pins[i];
      if (pin.dir === 'vertical') {
        var dp = planG.verts[pin.p];
        var eA = elevG.verts[pin.seg.a], eB = elevG.verts[pin.seg.b];
        var xa = (dp.x + eA.x + eB.x) / 3;
        addEdge(addPinned(xa, -dp.y, eA.y), addPinned(xa, -dp.y, eB.y));
      } else {
        var dq = elevG.verts[pin.q];
        var pA = planG.verts[pin.seg.a], pB = planG.verts[pin.seg.b];
        var xb = (dq.x + pA.x + pB.x) / 3;
        addEdge(addPinned(xb, -pA.y, dq.y), addPinned(xb, -pB.y, dq.y));
      }
    }
    // Hidden edges in a wireframe must coincide with a projected edge.
    var projPlan = [], projElev = [];
    for (i = 0; i < edges.length; i++) {
      var va = verts[edges[i][0]], vb = verts[edges[i][1]];
      projPlan.push({ ax: va.x, ay: -va.z, bx: vb.x, by: -vb.z });
      projElev.push({ ax: va.x, ay: va.y, bx: vb.x, by: vb.y });
    }
    var projVertPlan = verts.map(function (v) { return { x: v.x, y: -v.z }; });
    var projVertElev = verts.map(function (v) { return { x: v.x, y: v.y }; });
    function onProj(list) {
      return function (qx, qy, t2) {
        for (var l = 0; l < list.length; l++) {
          if (distPtSeg(qx, qy, list[l].ax, list[l].ay,
              list[l].bx, list[l].by) <= t2) {
            return true;
          }
        }
        return false;
      };
    }
    // Coverage accepts lone projected vertices too (point-only
    // wireframes have no edges to lie on).
    function onProjW(list, vlist) {
      var edgeOnly = onProj(list);
      return function (qx, qy, t2) {
        if (edgeOnly(qx, qy, t2)) return true;
        for (var l = 0; l < vlist.length; l++) {
          var dx = qx - vlist[l].x, dy = qy - vlist[l].y;
          if (dx * dx + dy * dy <= t2 * t2) return true;
        }
        return false;
      };
    }
    var eOkP = eSegsContained(planG.segs, planG.verts,
      function (qx, qy, t2) { return onProj(projPlan)(qx, qy, t2); }, stol, 5);
    if (!eOkP.ok) {
      return fail('unmatched-edge', 'plan hidden ' +
        describeEntity(eOkP.seg.item, eOkP.seg.idx) +
        ' matches no projected edge', 0);
    }
    var eOkE = eSegsContained(elevG.segs, elevG.verts,
      function (qx, qy, t2) { return onProj(projElev)(qx, qy, t2); }, stol, 5);
    if (!eOkE.ok) {
      return fail('unmatched-edge', 'elevation hidden ' +
        describeEntity(eOkE.seg.item, eOkE.seg.idx) +
        ' matches no projected edge', 0);
    }
    var covPlan = viewCoverage(planG, onProjW(projPlan, projVertPlan),
      function (qx, qy, t2) { return onProj(projPlan)(qx, qy, t2); }, stol);
    var covElev = viewCoverage(elevG, onProjW(projElev, projVertElev),
      function (qx, qy, t2) { return onProj(projElev)(qx, qy, t2); }, stol);
    // M2: with a profile view, both depth orientations are validated
    // against the lifted wireframe; the best passing map wins (ties go
    // to direct, deterministically). Two failing maps report the direct
    // map's failure.
    var covProfC = 1, profMapC = null;
    if (profG) {
      var zd = [];
      for (var zi = 0; zi < verts.length; zi++) zd.push(verts[zi].z);
      var zd0 = Math.min.apply(null, zd);
      var prC = drawnRangeAB(profG);
      var pp0, pp1;
      if (prC) {
        pp0 = prC.x0;
        pp1 = prC.x1;
      } else if (profG.points.length > 0) {
        pp0 = Infinity;
        pp1 = -Infinity;
        for (var zp = 0; zp < profG.points.length; zp++) {
          var zv = profG.verts[profG.points[zp].v];
          if (zv.x < pp0) pp0 = zv.x;
          if (zv.x > pp1) pp1 = zv.x;
        }
      } else {
        return fail('unmatched-edge',
          'profile shows no wireframe extent', 0);
      }
      var cMaps = inferProfileMaps(zd0, pp0, pp1);
      var cBest = null, cFirstErr = null;
      for (var cmi = 0; cmi < cMaps.length; cmi++) {
        var cTry = checkWireProfile(profG, verts, edges, cMaps[cmi],
          eps, stol);
        if (cTry.pass) {
          if (!cBest || cTry.coverage > cBest.coverage) {
            cBest = cTry;
            profMapC = cMaps[cmi];
          }
        } else if (!cFirstErr) {
          cFirstErr = cTry;
        }
      }
      if (!cBest) return cFirstErr;
      covProfC = cBest.coverage;
    }
    var cov = Math.min(covPlan, covElev, covProfC);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed',
        'wireframe round-trip coverage ' + cov.toFixed(3), cov);
    }
    var outC = {
      pass: true, class: 'C', coverage: cov,
      totalLength: totalLength(verts, edges),
      geometry: {
        name: 'wireframe', vertices: verts, edges: edges, faces: []
      },
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(verts, edges)
    };
    if (profG) {
      outC.coverageProfile = covProfC;
      outC.profileMap = profMapC;
    }
    return outC;
  }

  // --- Class E: claimed corner-lift lamina (M5). Class C pairs whole
  // vertices 1:1, which cannot express coincident corners (one elevation
  // dot yielding two corners at different plan feet). Where C fails, the
  // student's projector claims identify corners explicitly: one claim =
  // one 3D corner lifted from its plan + elevation feet. v1 builds
  // profile laminae only: all corners share x, and the face is the
  // convex hull in (depth, height), so a wrong pairing fails loudly
  // (duplicate corners, broken hull, uncovered ink) instead of guessing.
  // Claims apply always — hand drawings have no Check truth to gate on.
  // Returns null when no claims exist (no attempt, old behavior intact).
  function tryClaimedCorners(planG, elevG, eps, tol, claimLines, byId) {
    if (!claimLines || claimLines.length === 0) return null;
    function nearVert(verts, x, y) {
      for (var v = 0; v < verts.length; v++) {
        var dx = verts[v].x - x, dy = verts[v].y - y;
        if (dx * dx + dy * dy <= eps * eps) return true;
      }
      return false;
    }
    var corners = [];
    for (var li = 0; li < claimLines.length; li++) {
      var line = claimLines[li];
      var m = baseNameOf(String(line.meta.fromMember));
      if (m === '') {
        return fail('hint-conflict', 'a claim names no corner', 0);
      }
      var refs = line.meta.refs;
      var S = refs && refs.length > 0 ? byId[refs[0]] : null;
      var F = refs && refs.length > 1 ? byId[refs[1]] : null;
      if (!S || S.type !== 'POINT' || !F || F.type !== 'POINT') {
        return fail('hint-loose-foot', 'claim ' + m + ' has no resolvable feet', 0);
      }
      if (captionBases(S.caption).indexOf(m) === -1) {
        return fail('hint-conflict', 'claim ' + m + ' left its station', 0);
      }
      var sPlan = S.y < 0, fPlan = F.y < 0;
      if (sPlan === fPlan) {
        return fail('hint-conflict', 'claim ' + m + ' stays in one view', 0);
      }
      var P = sPlan ? S : F, E = sPlan ? F : S;
      if (Math.abs(P.x - E.x) > eps) {
        return fail('hint-conflict', 'claim ' + m + ' feet disagree in x', 0);
      }
      if (!nearVert(planG.verts, P.x, P.y) || !nearVert(elevG.verts, E.x, E.y)) {
        return fail('hint-loose-foot', 'claim ' + m + ' foot lands off drawn vertices', 0);
      }
      var dup = false;
      for (var ci = 0; ci < corners.length; ci++) {
        if (corners[ci].member !== m) continue;
        var c0 = corners[ci];
        if (Math.abs(c0.px - P.x) <= eps && Math.abs(c0.py - P.y) <= eps &&
            Math.abs(c0.ex - E.x) <= eps && Math.abs(c0.ey - E.y) <= eps) {
          dup = true;
          break;
        }
        return fail('hint-conflict', 'claim ' + m + ' pairs two ways', 0);
      }
      if (!dup) corners.push({ member: m, px: P.x, py: P.y, ex: E.x, ey: E.y });
    }
    if (corners.length < 3) {
      return fail('non-convex-corners', corners.length + ' corners cannot bound a face', 0);
    }
    corners.sort(function (a, b) {
      return a.member < b.member ? -1 : a.member > b.member ? 1 : 0;
    });
    var k;
    for (k = 0; k < corners.length; k++) {
      corners[k].x = (corners[k].px + corners[k].ex) / 2;
      corners[k].d = -corners[k].py;
      corners[k].h = corners[k].ey;
    }
    for (var i = 0; i < corners.length; i++) {
      for (var j = i + 1; j < corners.length; j++) {
        var ddx = corners[i].x - corners[j].x;
        var ddh = corners[i].h - corners[j].h;
        var ddz = corners[i].d - corners[j].d;
        if (ddx * ddx + ddh * ddh + ddz * ddz <= eps * eps) {
          return fail('duplicate-corners', '"' + corners[i].member + '" and "' +
            corners[j].member + '" lift to one point', 0);
        }
      }
    }
    var x0 = corners[0].x;
    for (k = 0; k < corners.length; k++) {
      if (Math.abs(corners[k].x - x0) > eps) {
        return fail('corners-not-coplanar', 'claimed corners leave the profile plane', 0);
      }
    }
    // Convex hull in (depth, height): monotone chain, deterministic.
    var order = corners.map(function (c, idx) { return idx; });
    order.sort(function (a, b) {
      if (corners[a].d !== corners[b].d) return corners[a].d - corners[b].d;
      if (corners[a].h !== corners[b].h) return corners[a].h - corners[b].h;
      return a - b;
    });
    function cross(o, a, b) {
      return (corners[a].d - corners[o].d) * (corners[b].h - corners[o].h) -
        (corners[a].h - corners[o].h) * (corners[b].d - corners[o].d);
    }
    var lower = [];
    for (k = 0; k < order.length; k++) {
      while (lower.length >= 2 &&
          cross(lower[lower.length - 2], lower[lower.length - 1], order[k]) <= 0) {
        lower.pop();
      }
      lower.push(order[k]);
    }
    var upper = [];
    for (k = order.length - 1; k >= 0; k--) {
      while (upper.length >= 2 &&
          cross(upper[upper.length - 2], upper[upper.length - 1], order[k]) <= 0) {
        upper.pop();
      }
      upper.push(order[k]);
    }
    lower.pop();
    upper.pop();
    var hull = lower.concat(upper);
    var onHull = {};
    for (k = 0; k < hull.length; k++) onHull[hull[k]] = 1;
    for (k = 0; k < corners.length; k++) {
      if (!onHull[k]) {
        return fail('non-convex-corners', hull.length <= 2 ?
          'claimed corners are collinear' :
          '"' + corners[k].member + '" lies inside the claimed face', 0);
      }
    }
    var verts = corners.map(function (c) { return { x: c.x, y: c.h, z: c.d }; });
    var edges = [];
    for (k = 0; k < hull.length; k++) {
      edges.push([hull[k], hull[(k + 1) % hull.length]]);
    }
    // Coverage both directions, per view, against drawn A/B ink.
    function inkSegs(graph) {
      var segs = [];
      for (var s = 0; s < graph.segs.length; s++) {
        var it = graph.segs[s];
        if (it.item.bisCode !== 'A' && it.item.bisCode !== 'B') continue;
        segs.push({ ax: graph.verts[it.a].x, ay: graph.verts[it.a].y,
          bx: graph.verts[it.b].x, by: graph.verts[it.b].y });
      }
      return segs;
    }
    function ptSegDist2(px, py, s) {
      var dx = s.bx - s.ax, dy = s.by - s.ay;
      var len2 = dx * dx + dy * dy;
      var t = len2 > 0 ? ((px - s.ax) * dx + (py - s.ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      var qx = px - (s.ax + t * dx), qy = py - (s.ay + t * dy);
      return qx * qx + qy * qy;
    }
    function fracCovered(probes, ink) {
      var hit = 0, n = 0;
      for (var s = 0; s < probes.length; s++) {
        for (var jj = 0; jj < 5; jj++) {
          var t = jj / 4;
          var px = probes[s].ax + (probes[s].bx - probes[s].ax) * t;
          var py = probes[s].ay + (probes[s].by - probes[s].ay) * t;
          n++;
          for (var u = 0; u < ink.length; u++) {
            if (ptSegDist2(px, py, ink[u]) <= tol * tol) { hit++; break; }
          }
        }
      }
      return n === 0 ? 1 : hit / n;
    }
    var planInk = inkSegs(planG), elevInk = inkSegs(elevG);
    var planLift = [], elevLift = [];
    for (k = 0; k < edges.length; k++) {
      var cA = corners[edges[k][0]], cB = corners[edges[k][1]];
      planLift.push({ ax: cA.px, ay: cA.py, bx: cB.px, by: cB.py });
      elevLift.push({ ax: cA.ex, ay: cA.ey, bx: cB.ex, by: cB.ey });
    }
    var covPlan = Math.min(fracCovered(planInk, planLift), fracCovered(planLift, planInk));
    var covElev = Math.min(fracCovered(elevInk, elevLift), fracCovered(elevLift, elevInk));
    var cov = Math.min(covPlan, covElev);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed', 'claimed lamina round-trip coverage ' + cov.toFixed(3), cov);
    }
    // Both windings: a lamina has no interior, so single-sidedness would
    // show all-dashed from behind and teach nothing. Faces only feed
    // hidden classification (edges are stroked, never filled); exactly
    // edge-on both faces turn away and the outline honestly dashes.
    var loop2 = hull.slice().reverse();
    return {
      pass: true, class: 'E', coverage: cov,
      totalLength: totalLength(verts, edges),
      geometry: { name: 'claimed-lamina', vertices: verts, edges: edges,
        faces: [hull.slice(), loop2] },
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(verts, edges)
    };
  }

  // --- Class D: vertical-axis solids of revolution (M3 curves). ---
  // Plan carries exactly one A/B CIRCLE (no polygon loop); elevation shows
  // the silhouette (rectangle = cylinder, triangle + apex = cone). Full
  // CIRCLE entities only; CIRCULAR_ARC never forms a D hypothesis.
  function isPlanCircle(curve) {
    if (!curve || curve.type !== 'CIRCLE') return false;
    if (curve.bisCode !== 'A' && curve.bisCode !== 'B') return false;
    if (curve.viewRole === 'PLAN') return true;
    if (curve.viewRole === 'ELEVATION' || curve.viewRole === 'PROFILE') {
      return false;
    }
    var cy = (curve.y === undefined) ? 0 : curve.y;
    return cy < 0;
  }

  function planCirclesOf(curves) {
    var out = [];
    for (var i = 0; i < curves.length; i++) {
      if (isPlanCircle(curves[i])) out.push(curves[i]);
    }
    return out;
  }

  // Rim vertex k (0..K-1) at angle th = 2*pi*k/K: x = xc + r*cos, z =
  // zc + r*sin. Vertex 0 sits at +X from the axis; increasing k runs
  // counter-clockwise seen from +Y (with +Z up in that top view).
  function rimPoint(xc, zc, r, y, k) {
    var th = 2 * Math.PI * k / RIM_K;
    return { x: xc + r * Math.cos(th), y: y, z: zc + r * Math.sin(th) };
  }

  function buildCylinderGeometry(xc, zc, r, z0, z1) {
    var verts = [], edges = [], faces = [], checks = [];
    var k;
    for (k = 0; k < RIM_K; k++) verts.push(rimPoint(xc, zc, r, z0, k));
    for (k = 0; k < RIM_K; k++) verts.push(rimPoint(xc, zc, r, z1, k));
    for (k = 0; k < RIM_K; k++) {
      var nx = (k + 1) % RIM_K;
      edges.push([k, nx]);
      edges.push([k + RIM_K, nx + RIM_K]);
      edges.push([k, k + RIM_K]);
    }
    var bottom = [], top = [];
    for (k = 0; k < RIM_K; k++) { bottom.push(k); top.push(k + RIM_K); }
    faces.push(bottom);
    checks.push(function (nn) { return nn.y < 0; });
    faces.push(top);
    checks.push(function (nn) { return nn.y > 0; });
    for (k = 0; k < RIM_K; k++) {
      var jx = (k + 1) % RIM_K;
      faces.push([k, jx, jx + RIM_K, k + RIM_K]);
      checks.push(outwardSideCheck(verts, bottom, k, jx));
    }
    faces = orientFaces(verts, faces, checks);
    return { name: 'cylinder', vertices: verts, edges: edges, faces: faces };
  }

  // Cylinder from a plan circle + elevation silhouette. Returns null only
  // when the caller should not treat this as a D hypothesis (never here;
  // the wrapper decides); otherwise pass or a named fail.
  function tryCylinder(planG, elevG, circle, eps, tol, profG) {
    var stol = Math.max(tol, eps);
    var xc = circle.x, yc = circle.y, r = circle.radius;
    assertFinite(xc, yc, r);
    if (!(r > 0)) {
      return fail('non-manifold', 'plan circle has zero radius', 0);
    }
    var si, s, a, b, px, py;
    for (si = 0; si < planG.segs.length; si++) {
      s = planG.segs[si];
      a = planG.verts[s.a];
      b = planG.verts[s.b];
      if (s.item.bisCode === 'E') {
        var inside = true;
        for (var k = 0; k < 5; k++) {
          var t = k / 4;
          px = a.x + (b.x - a.x) * t;
          py = a.y + (b.y - a.y) * t;
          var dx = px - xc, dy = py - yc;
          if (Math.sqrt(dx * dx + dy * dy) > r + tol) {
            inside = false;
            break;
          }
        }
        if (!inside) {
          return fail('unmatched-edge', 'plan hidden ' +
            describeEntity(s.item, s.idx) + ' escapes the circle', 0);
        }
        continue;
      }
      return fail('unmatched-edge', 'plan ' +
        describeEntity(s.item, s.idx) + ' fits no cylinder circle', 0);
    }
    if (planG.points.length > 1) {
      return fail('ambiguous-pairing', planG.points.length +
        ' plan points compete for the cylinder center', 0);
    }
    for (si = 0; si < planG.points.length; si++) {
      var pv = planG.verts[planG.points[si].v];
      var cdx = pv.x - xc, cdy = pv.y - yc;
      if (Math.sqrt(cdx * cdx + cdy * cdy) > tol) {
        return fail('unmatched-point', 'plan point ' +
          describeEntity(planG.points[si].item, planG.points[si].idx) +
          ' sits off the circle center', 0);
      }
    }
    var er = drawnRangeAB(elevG);
    if (!er) {
      return fail('unmatched-edge', 'elevation shows no cylinder extent', 0);
    }
    var silCx = (er.x0 + er.x1) / 2;
    var halfW = (er.x1 - er.x0) / 2;
    if (Math.abs(silCx - xc) > eps) {
      return fail('x-mismatch', 'cylinder center plan x=' + xc +
        ' vs elevation x=' + silCx + ' beyond eps', 0);
    }
    if (Math.abs(halfW - r) > eps) {
      return fail('x-mismatch', 'cylinder radius r=' + r +
        ' vs elevation half-width ' + halfW + ' beyond eps', 0);
    }
    var z0 = er.y0, z1 = er.y1;
    if (!(z1 - z0 > tol)) {
      return fail('non-manifold', 'elevation extent has zero height', 0);
    }
    var xL = xc - r, xR = xc + r;
    var onElev = onPrismElevLines([xL, xR], z0, z1);
    for (si = 0; si < elevG.segs.length; si++) {
      s = elevG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = elevG.verts[s.a];
      b = elevG.verts[s.b];
      var okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        px = a.x + (b.x - a.x) * u;
        py = a.y + (b.y - a.y) * u;
        if (!onElev(px, py, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'elevation ' +
          describeEntity(s.item, s.idx) + ' fits no cylinder line', 0);
      }
    }
    if (!hCovered(elevG, z0, xL, xR, stol)) {
      return fail('unmatched-edge',
        'elevation misses the base line at y=' + z0, 0);
    }
    if (!hCovered(elevG, z1, xL, xR, stol)) {
      return fail('unmatched-edge',
        'elevation misses the top line at y=' + z1, 0);
    }
    if (!vCovered(elevG, xL, z0, z1, stol)) {
      return fail('unmatched-edge',
        'elevation misses the vertical at x=' + xL, 0);
    }
    if (!vCovered(elevG, xR, z0, z1, stol)) {
      return fail('unmatched-edge',
        'elevation misses the vertical at x=' + xR, 0);
    }
    var eOk = eSegsContained(elevG.segs, elevG.verts,
      rectInside(xL, xR, z0, z1), stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'elevation hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) + ' escapes the outline', 0);
    }
    for (si = 0; si < elevG.points.length; si++) {
      var ev = elevG.verts[elevG.points[si].v];
      if (!onElev(ev.x, ev.y, eps)) {
        return fail('unmatched-point', 'elevation point ' +
          describeEntity(elevG.points[si].item, elevG.points[si].idx) +
          ' sits off the cylinder lines', 0);
      }
    }
    var profMap = null, profRes = null;
    if (profG) {
      var d0 = -(yc + r), d1 = -(yc - r);
      var pr0 = drawnRangeAB(profG);
      if (!pr0) {
        return fail('unmatched-edge', 'profile shows no cylinder extent', 0);
      }
      var pMaps = inferProfileMaps(d0, pr0.x0, pr0.x1);
      var pFirstErr = null;
      for (var pmi = 0; pmi < pMaps.length; pmi++) {
        var pTry = checkCylinderProfile(profG, d0, d1, z0, z1,
          pMaps[pmi], eps, stol);
        if (pTry.pass) { profMap = pMaps[pmi]; profRes = pTry; break; }
        if (!pFirstErr) pFirstErr = pTry;
      }
      if (!profMap) return pFirstErr;
    }
    var zc = -yc;
    var geometry = buildCylinderGeometry(xc, zc, r, z0, z1);
    var covPlan = 1;
    var covElev = viewCoverage(elevG, onElev,
      rectInside(xL, xR, z0, z1), stol);
    var covProf = profRes ? profRes.coverage : 1;
    var cov = Math.min(covPlan, covElev, covProf);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed',
        'cylinder round-trip coverage ' + cov.toFixed(3), cov);
    }
    var outD = {
      pass: true, class: 'D', coverage: cov,
      totalLength: totalLength(geometry.vertices, geometry.edges),
      geometry: geometry,
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(geometry.vertices, geometry.edges)
    };
    if (profG) {
      outD.coverageProfile = covProf;
      outD.profileMap = profMap;
    }
    return outD;
  }

  function checkCylinderProfile(profG, d0, d1, z0, z1, map, eps, stol) {
    var px = [mapDepth(map, d0), mapDepth(map, d1)];
    var plo = Math.min(px[0], px[1]), phi = Math.max(px[0], px[1]);
    var pr = drawnRangeAB(profG);
    if (!pr) {
      return fail('unmatched-edge', 'profile shows no cylinder extent', 0);
    }
    if (Math.abs(pr.x0 - plo) > eps || Math.abs(pr.x1 - phi) > eps) {
      return fail('x-mismatch', 'profile x-range [' + pr.x0 + ', ' +
        pr.x1 + '] vs mapped depth [' + plo + ', ' + phi + '] beyond eps', 0);
    }
    var onProf = onPrismElevLines(px, z0, z1);
    var si, s, a, b, okLine, qx, qy;
    for (si = 0; si < profG.segs.length; si++) {
      s = profG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = profG.verts[s.a];
      b = profG.verts[s.b];
      okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        qx = a.x + (b.x - a.x) * u;
        qy = a.y + (b.y - a.y) * u;
        if (!onProf(qx, qy, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'profile ' +
          describeEntity(s.item, s.idx) + ' fits no cylinder line', 0);
      }
    }
    if (!hCovered(profG, z0, plo, phi, stol)) {
      return fail('unmatched-edge',
        'profile misses the base line at y=' + z0, 0);
    }
    if (!hCovered(profG, z1, plo, phi, stol)) {
      return fail('unmatched-edge',
        'profile misses the top line at y=' + z1, 0);
    }
    for (si = 0; si < px.length; si++) {
      if (!vCovered(profG, px[si], z0, z1, stol)) {
        return fail('unmatched-edge',
          'profile misses the vertical at x=' + px[si], 0);
      }
    }
    var inside = rectInside(plo, phi, z0, z1);
    var eOk = eSegsContained(profG.segs, profG.verts, inside, stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'profile hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) + ' escapes the outline', 0);
    }
    for (si = 0; si < profG.points.length; si++) {
      var pv = profG.verts[profG.points[si].v];
      if (!onProf(pv.x, pv.y, eps)) {
        return fail('unmatched-point', 'profile point ' +
          describeEntity(profG.points[si].item, profG.points[si].idx) +
          ' sits off the cylinder lines', 0);
      }
    }
    return { pass: true, coverage: viewCoverage(profG, onProf, inside, stol) };
  }

  function buildConeGeometry(xc, zc, r, z0, xa, za, z1) {
    var verts = [], edges = [], faces = [], checks = [];
    var k;
    for (k = 0; k < RIM_K; k++) verts.push(rimPoint(xc, zc, r, z0, k));
    var apexIdx = RIM_K;
    verts.push({ x: xa, y: z1, z: za });
    for (k = 0; k < RIM_K; k++) {
      var nx = (k + 1) % RIM_K;
      edges.push([k, nx]);
      edges.push([k, apexIdx]);
    }
    var base = [];
    for (k = 0; k < RIM_K; k++) base.push(k);
    faces.push(base);
    checks.push(function (nn) { return nn.y < 0; });
    for (k = 0; k < RIM_K; k++) {
      var jx = (k + 1) % RIM_K;
      faces.push([k, jx, apexIdx]);
      checks.push(outwardSideCheck(verts, base, k, jx));
    }
    faces = orientFaces(verts, faces, checks);
    return { name: 'cone', vertices: verts, edges: edges, faces: faces };
  }

  function checkConeProfile(profG, d0, d1, da, z0, z1, map, eps, tol, stol) {
    var plo = Math.min(mapDepth(map, d0), mapDepth(map, d1));
    var phi = Math.max(mapDepth(map, d0), mapDepth(map, d1));
    var pr = drawnRangeAB(profG);
    if (!pr) {
      return fail('unmatched-edge', 'profile shows no cone extent', 0);
    }
    if (Math.abs(pr.x0 - plo) > eps || Math.abs(pr.x1 - phi) > eps) {
      return fail('x-mismatch', 'profile x-range [' + pr.x0 + ', ' +
        pr.x1 + '] vs mapped depth [' + plo + ', ' + phi + '] beyond eps', 0);
    }
    var xa = mapDepth(map, da);
    var profApex = null;
    for (var ei = 0; ei < profG.points.length; ei++) {
      var qv = profG.verts[profG.points[ei].v];
      if (Math.abs(qv.y - z1) <= tol) {
        if (profApex !== null) {
          return fail('ambiguous-pairing',
            'two points share the profile top line', 0);
        }
        profApex = { x: qv.x, y: qv.y, ref: profG.points[ei] };
      }
    }
    if (profApex === null) {
      return fail('unmatched-point',
        'plan apex has no mate on the profile top line', 0);
    }
    var dxa = Math.abs(profApex.x - xa);
    if (dxa > eps) {
      if (dxa <= LOOSE_EPS_MM) {
        return fail('x-mismatch', 'apex mapped x=' + xa +
          ' vs profile x=' + profApex.x + ' beyond eps', 0);
      }
      return fail('unmatched-point',
        'profile top point matches no plan apex', 0);
    }
    var xap = (xa + profApex.x) / 2;
    if (!hCovered(profG, z0, plo, phi, stol)) {
      return fail('unmatched-edge',
        'profile misses the base line at y=' + z0, 0);
    }
    if (!slantCovered(profG, plo, z0, xap, z1, stol)) {
      return fail('unmatched-edge', 'profile misses the left slant', 0);
    }
    if (!slantCovered(profG, phi, z0, xap, z1, stol)) {
      return fail('unmatched-edge', 'profile misses the right slant', 0);
    }
    var onProf = onPyramidElevLines(plo, phi, xap, z0, z1);
    var si, s, a, b, okLine, qx, qy;
    for (si = 0; si < profG.segs.length; si++) {
      s = profG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = profG.verts[s.a];
      b = profG.verts[s.b];
      okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        qx = a.x + (b.x - a.x) * u;
        qy = a.y + (b.y - a.y) * u;
        if (!onProf(qx, qy, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'profile ' +
          describeEntity(s.item, s.idx) + ' fits no cone line', 0);
      }
    }
    var triIn = pyramidTriIn(plo, phi, xap, z0, z1);
    var eOk = eSegsContained(profG.segs, profG.verts, triIn, stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'profile hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) + ' escapes the outline', 0);
    }
    for (si = 0; si < profG.points.length; si++) {
      var pv = profG.verts[profG.points[si].v];
      if (!onProf(pv.x, pv.y, eps)) {
        return fail('unmatched-point', 'profile point ' +
          describeEntity(profG.points[si].item, profG.points[si].idx) +
          ' sits off the cone lines', 0);
      }
    }
    return { pass: true, coverage: viewCoverage(profG, onProf, triIn, stol) };
  }

  function tryCone(planG, elevG, circle, eps, tol, profG) {
    var stol = Math.max(tol, eps);
    var xc = circle.x, yc = circle.y, r = circle.radius;
    assertFinite(xc, yc, r);
    if (!(r > 0)) {
      return fail('non-manifold', 'plan circle has zero radius', 0);
    }
    var si, s, a, b, px, py;
    for (si = 0; si < planG.segs.length; si++) {
      s = planG.segs[si];
      a = planG.verts[s.a];
      b = planG.verts[s.b];
      if (s.item.bisCode === 'E') {
        var inside = true;
        for (var k = 0; k < 5; k++) {
          var t = k / 4;
          px = a.x + (b.x - a.x) * t;
          py = a.y + (b.y - a.y) * t;
          var dx = px - xc, dy = py - yc;
          if (Math.sqrt(dx * dx + dy * dy) > r + tol) {
            inside = false;
            break;
          }
        }
        if (!inside) {
          return fail('unmatched-edge', 'plan hidden ' +
            describeEntity(s.item, s.idx) + ' escapes the circle', 0);
        }
        continue;
      }
      return fail('unmatched-edge', 'plan ' +
        describeEntity(s.item, s.idx) + ' fits no cone circle', 0);
    }
    if (planG.points.length === 0) {
      return fail('unmatched-point',
        'plan apex has no mate on the elevation top line', 0);
    }
    if (planG.points.length > 1) {
      return fail('ambiguous-pairing', planG.points.length +
        ' plan points compete for the cone apex', 0);
    }
    var planApexV = planG.verts[planG.points[0].v];
    var cdx = planApexV.x - xc, cdy = planApexV.y - yc;
    if (Math.sqrt(cdx * cdx + cdy * cdy) > tol) {
      return fail('unmatched-point', 'plan point ' +
        describeEntity(planG.points[0].item, planG.points[0].idx) +
        ' sits off the circle center', 0);
    }
    var apexPlan = { x: planApexV.x, y: planApexV.y };
    var er = drawnRangeAB(elevG);
    if (!er) {
      return fail('unmatched-edge', 'elevation shows no cone extent', 0);
    }
    var silCx = (er.x0 + er.x1) / 2;
    var halfW = (er.x1 - er.x0) / 2;
    if (Math.abs(silCx - xc) > eps) {
      return fail('x-mismatch', 'cone center plan x=' + xc +
        ' vs elevation x=' + silCx + ' beyond eps', 0);
    }
    if (Math.abs(halfW - r) > eps) {
      return fail('x-mismatch', 'cone radius r=' + r +
        ' vs elevation half-width ' + halfW + ' beyond eps', 0);
    }
    var z0 = er.y0, z1 = er.y1;
    if (!(z1 - z0 > tol)) {
      return fail('non-manifold', 'elevation extent has zero height', 0);
    }
    var xL = xc - r, xR = xc + r;
    var elevApex = null;
    for (var ei = 0; ei < elevG.points.length; ei++) {
      var qv = elevG.verts[elevG.points[ei].v];
      if (Math.abs(qv.y - z1) <= tol) {
        if (elevApex !== null) {
          return fail('ambiguous-pairing',
            'two points share the elevation top line', 0);
        }
        elevApex = { x: qv.x, y: qv.y, ref: elevG.points[ei] };
      }
    }
    if (elevApex === null) {
      return fail('unmatched-point',
        'plan apex has no mate on the elevation top line', 0);
    }
    var dxa = Math.abs(elevApex.x - apexPlan.x);
    if (dxa > eps) {
      if (dxa <= LOOSE_EPS_MM) {
        return fail('x-mismatch', 'apex plan x=' + apexPlan.x +
          ' vs elevation x=' + elevApex.x + ' beyond eps', 0);
      }
      return fail('unmatched-point',
        'elevation top point matches no plan apex', 0);
    }
    var xa = (apexPlan.x + elevApex.x) / 2;
    if (!hCovered(elevG, z0, xL, xR, stol)) {
      return fail('unmatched-edge',
        'elevation misses the base line at y=' + z0, 0);
    }
    if (!slantCovered(elevG, xL, z0, xa, z1, stol)) {
      return fail('unmatched-edge', 'elevation misses the left slant', 0);
    }
    if (!slantCovered(elevG, xR, z0, xa, z1, stol)) {
      return fail('unmatched-edge', 'elevation misses the right slant', 0);
    }
    var onElev = onPyramidElevLines(xL, xR, xa, z0, z1);
    for (si = 0; si < elevG.segs.length; si++) {
      s = elevG.segs[si];
      if (s.item.bisCode === 'E') continue;
      a = elevG.verts[s.a];
      b = elevG.verts[s.b];
      var okLine = true;
      for (var m = 0; m < 5; m++) {
        var u = m / 4;
        px = a.x + (b.x - a.x) * u;
        py = a.y + (b.y - a.y) * u;
        if (!onElev(px, py, stol)) { okLine = false; break; }
      }
      if (!okLine) {
        return fail('unmatched-edge', 'elevation ' +
          describeEntity(s.item, s.idx) + ' fits no cone line', 0);
      }
    }
    var triIn = pyramidTriIn(xL, xR, xa, z0, z1);
    var eOk = eSegsContained(elevG.segs, elevG.verts, triIn, stol, 5);
    if (!eOk.ok) {
      return fail('unmatched-edge', 'elevation hidden ' +
        describeEntity(eOk.seg.item, eOk.seg.idx) + ' escapes the outline', 0);
    }
    for (si = 0; si < elevG.points.length; si++) {
      var ev = elevG.verts[elevG.points[si].v];
      if (!onElev(ev.x, ev.y, eps)) {
        return fail('unmatched-point', 'elevation point ' +
          describeEntity(elevG.points[si].item, elevG.points[si].idx) +
          ' sits off the cone lines', 0);
      }
    }
    var profMap = null, profRes = null;
    if (profG) {
      var d0 = -(yc + r), d1 = -(yc - r), da = -apexPlan.y;
      var pr0 = drawnRangeAB(profG);
      if (!pr0) {
        return fail('unmatched-edge', 'profile shows no cone extent', 0);
      }
      var pMaps = inferProfileMaps(d0, pr0.x0, pr0.x1);
      var pFirstErr = null;
      for (var pmi = 0; pmi < pMaps.length; pmi++) {
        var pTry = checkConeProfile(profG, d0, d1, da, z0, z1,
          pMaps[pmi], eps, tol, stol);
        if (pTry.pass) { profMap = pMaps[pmi]; profRes = pTry; break; }
        if (!pFirstErr) pFirstErr = pTry;
      }
      if (!profMap) return pFirstErr;
    }
    var zc = -yc, za = -apexPlan.y;
    var geometry = buildConeGeometry(xc, zc, r, z0, xa, za, z1);
    var covPlan = 1;
    var covElev = viewCoverage(elevG, onElev, triIn, stol);
    var covProf = profRes ? profRes.coverage : 1;
    var cov = Math.min(covPlan, covElev, covProf);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed',
        'cone round-trip coverage ' + cov.toFixed(3), cov);
    }
    var outB = {
      pass: true, class: 'D', coverage: cov,
      totalLength: totalLength(geometry.vertices, geometry.edges),
      geometry: geometry,
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(geometry.vertices, geometry.edges)
    };
    if (profG) {
      outB.coverageProfile = covProf;
      outB.profileMap = profMap;
    }
    return outB;
  }

  // Class D dispatcher (cylinder + cone). Returns null when no D
  // hypothesis applies (plan loop exists, or no A/B plan circle);
  // otherwise a pass or a named fail. Two plan circles report
  // ambiguous-pairing, never a guess. Cylinder is tried first, then
  // cone; the first pass wins, otherwise the better-ranked fail.
  function tryRevolved(planG, elevG, planLoop, curves, eps, tol, profG) {
    if (planLoop) return null;
    var circles = planCirclesOf(curves || []);
    if (circles.length === 0) return null;
    if (circles.length > 1) {
      var amb = fail('ambiguous-pairing', circles.length +
        ' plan circles compete (no guess)', 0);
      amb.competingCircles = true;
      return amb;
    }
    var rcyl = tryCylinder(planG, elevG, circles[0], eps, tol, profG);
    if (rcyl.pass) return rcyl;
    var rcon = tryCone(planG, elevG, circles[0], eps, tol, profG);
    if (rcon.pass) return rcon;
    return failRank(rcyl.reason) <= failRank(rcon.reason) ? rcyl : rcon;
  }

  // Project a widget-space geometry back onto both sheet views:
  // elevation (X, Y), plan (X, -Z). Independent of the class attempts;
  // tests use it to verify the round-trip invariant from outside.
  // An optional profile map {xRef, s, dRef} adds the profile projection
  // (xRef + s * (Z - dRef), Y); one-argument calls are unchanged.
  function projectToViews(geometry, mapOpt) {
    var verts = geometry.vertices;
    var planPts = verts.map(function (v) { return { x: v.x, y: -v.z }; });
    var elevPts = verts.map(function (v) { return { x: v.x, y: v.y }; });
    var planSegs = [], elevSegs = [];
    for (var i = 0; i < geometry.edges.length; i++) {
      var a = geometry.edges[i][0], b = geometry.edges[i][1];
      planSegs.push({ a: planPts[a], b: planPts[b] });
      elevSegs.push({ a: elevPts[a], b: elevPts[b] });
    }
    var out = {
      planPts: planPts, elevPts: elevPts,
      planSegs: planSegs, elevSegs: elevSegs
    };
    if (mapOpt !== undefined && mapOpt !== null) {
      assertFinite(mapOpt.xRef, mapOpt.s, mapOpt.dRef);
      var profilePts = verts.map(function (v) {
        return { x: mapDepth(mapOpt, v.z), y: v.y };
      });
      var profileSegs = [];
      for (var j = 0; j < geometry.edges.length; j++) {
        var c = geometry.edges[j][0], d = geometry.edges[j][1];
        profileSegs.push({ a: profilePts[c], b: profilePts[d] });
      }
      out.profilePts = profilePts;
      out.profileSegs = profileSegs;
    }
    return out;
  }

  var FAIL_PRIORITY = [
    'missing-view', 'unsupported-curves', 'x-mismatch', 'name-mismatch',
    'hint-conflict', 'hint-loose-foot', 'duplicate-corners',
    'corners-not-coplanar', 'non-convex-corners',
    'non-convex-profile', 'unmatched-point', 'unmatched-edge',
    'non-manifold', 'ambiguous-pairing', 'no-closed-profile',
    'coverage-failed'
  ];

  function failRank(reason) {
    var r = FAIL_PRIORITY.indexOf(reason);
    return r === -1 ? FAIL_PRIORITY.length : r;
  }

  // Top-level reconstruction. entities: spec or table rows (any order).
  // opts.eps overrides the x-station match tolerance (mm).
  // opts.strictNames === false disables pair-by-name (legacy geometry).
  function reconstruct(entities, opts) {
    opts = opts || {};
    var eps = opts.eps === undefined ? MATCH_EPS_MM : opts.eps;
    assertFinite(eps);
    if (!(eps > 0)) throw new Error('eps must be > 0');
    var list = Array.isArray(entities) ? entities.slice() : [];
    var warnings = [];
    var f = filterEntities(list);
    // Class E inputs: claimed projectors never survive the helper filter,
    // so they are collected from the raw list (deterministic id order).
    var byId = {};
    for (var bi = 0; bi < list.length; bi++) {
      if (list[bi] && typeof list[bi].id === 'string') byId[list[bi].id] = list[bi];
    }
    var claimLines = [];
    for (var qi = 0; qi < list.length; qi++) {
      var qe = list[qi];
      if (!qe || qe.visible === false) continue;
      if (qe.type !== 'SEGMENT' && qe.type !== 'LINE' && qe.type !== 'RAY') continue;
      var qm = qe.meta && qe.meta.fromMember;
      if (qm === undefined || qm === null || String(qm) === '') continue;
      if (!isSheetVertical(qe) || !crossesXY(qe)) continue;
      claimLines.push(qe);
    }
    claimLines.sort(function (a, b) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    var cls = classifyViews(sortStable(f.kept), undefined, f.curves);
    var tol = weldTolerance(cls.plan, cls.elev, cls.profile);
    var stats = {
      kept: f.kept.length, curves: f.curves.length,
      dropped: f.dropped, onDatum: cls.onDatum.length,
      planItems: cls.plan.length, elevItems: cls.elev.length,
      profileItems: cls.profile.length,
      helpersDropped: cls.droppedHelpers.length,
      weldTol: tol, eps: eps, attempts: [], variant: 'direct'
    };
    function unavailable(reason, label) {
      var covOut = { plan: 0, elev: 0 };
      if (cls.profile.length > 0) covOut.profile = 0;
      return {
        status: 'unavailable', reason: reason,
        label: label || REASON_LABELS[reason] || reason,
        class: null, geometry: null,
        coverage: covOut,
        warnings: warnings, stats: stats
      };
    }
    if (f.kept.length === 0 && f.curves.length === 0) {
      return unavailable('missing-view', 'empty sheet');
    }
    if (f.kept.length === 0) {
      return unavailable('unsupported-curves',
        REASON_LABELS['unsupported-curves']);
    }
    // Entities exactly on XY are genuinely ambiguous (resting base vs
    // touching depth), so each placement is attempted as its own variant
    // in fixed order. Two readings that both pass with different solids
    // report ambiguity rather than guessing.
    var variants;
    if (cls.onDatum.length === 0) {
      variants = [{ plan: cls.plan, elev: cls.elev, profile: cls.profile,
        tag: 'direct' }];
    } else {
      variants = [
        { plan: cls.plan, elev: cls.elev.concat(cls.onDatum),
          profile: cls.profile, tag: 'datum-in-elev' },
        { plan: cls.plan.concat(cls.onDatum), elev: cls.elev,
          profile: cls.profile, tag: 'datum-in-plan' }
      ];
    }
    function solveFor(variant) {
      var hasPlanCircle = planCirclesOf(f.curves).length > 0;
      if ((variant.plan.length === 0 && !hasPlanCircle) ||
          variant.elev.length === 0) {
        return {
          tag: variant.tag, planLoop: null, attempts: [],
          win: null,
          fail: fail('missing-view', variant.plan.length === 0 ?
            'no plan view drawn' : 'no elevation view drawn', 0)
        };
      }
      var planG = buildViewGraph(sortStable(variant.plan), tol);
      var elevG = buildViewGraph(sortStable(variant.elev), tol);
      var profG = variant.profile.length > 0 ?
        buildViewGraph(sortStable(variant.profile), tol) : null;
      var strictNames = opts.strictNames !== false;
      if (strictNames) {
        var ng = checkNameGate(planG, elevG, eps, profG);
        if (ng) {
          return {
            tag: variant.tag, planLoop: null, attempts: [],
            win: null, fail: ng
          };
        }
      }
      var planLoop = convexLoop(planG, tol);
      var attempts = [];
      var ra = tryPrism(planG, elevG, planLoop, eps, tol, profG);
      if (ra) {
        attempts.push({ class: 'A', pass: !!ra.pass,
          coverage: ra.coverage || 0, reason: ra.reason || null });
      }
      var rb = tryPyramid(planG, elevG, planLoop, eps, tol, profG);
      if (rb) {
        attempts.push({ class: 'B', pass: !!rb.pass,
          coverage: rb.coverage || 0, reason: rb.reason || null });
      }
      var rc = tryWireframe(planG, elevG, eps, tol, profG, strictNames);
      attempts.push({ class: 'C', pass: !!rc.pass,
        coverage: rc.coverage || 0, reason: rc.reason || null });
      var rd = tryRevolved(planG, elevG, planLoop, f.curves, eps, tol, profG);
      if (rd) {
        attempts.push({ class: 'D', pass: !!rd.pass,
          coverage: rd.coverage || 0, reason: rd.reason || null });
      }
      // Class E rescues ambiguity/failure only: hints never compete with
      // a geometric success, and legacy geometry mode skips them outright.
      var re = null;
      var anyPass = (ra && ra.pass) || (rb && rb.pass) || (rc && rc.pass) || (rd && rd.pass);
      if (!anyPass && claimLines.length > 0 && strictNames) {
        re = tryClaimedCorners(planG, elevG, eps, tol, claimLines, byId);
        attempts.push({ class: 'E', pass: !!re.pass,
          coverage: re.coverage || 0, reason: re.reason || null });
      }
      var passing = [ra, rb, rc, rd, re].filter(function (r) { return r && r.pass; });
      passing.sort(function (a, b) {
        if (a.coverage !== b.coverage) return b.coverage - a.coverage;
        return a.totalLength - b.totalLength;
      });
      var sol = {
        tag: variant.tag, planLoop: planLoop, attempts: attempts,
        planVerts: planG.verts.length, elevVerts: elevG.verts.length,
        profVerts: profG ? profG.verts.length : 0,
        win: null, fail: null
      };
      if (passing.length > 0) {
        if (passing.length > 1 &&
            Math.abs(passing[0].coverage - passing[1].coverage) < 1e-9 &&
            passing[0].canonical !== passing[1].canonical) {
          sol.fail = fail('ambiguous-pairing',
            'two classes explain the drawing equally well', 0);
          return sol;
        }
        sol.win = passing[0];
        return sol;
      }
      if (rd && !rd.pass && rd.competingCircles) {
        sol.fail = rd;
        return sol;
      }
      var fails = [ra, rb, rc, rd, re].filter(function (r) { return r && !r.pass; });
      fails.sort(function (a, b) {
        return failRank(a.reason) - failRank(b.reason);
      });
      if (!planLoop && f.curves.length > 0 && !rd) {
        sol.fail = fail('unsupported-curves',
          REASON_LABELS['unsupported-curves'], 0);
        return sol;
      }
      if (fails.length > 0) {
        sol.fail = fails[0];
        return sol;
      }
      sol.fail = fail('no-closed-profile',
        REASON_LABELS['no-closed-profile'], 0);
      return sol;
    }
    var solved = variants.map(solveFor);
    var wins = solved.filter(function (s) { return !!s.win; });
    if (wins.length > 0) {
      var first = wins[0].win;
      for (var wi = 1; wi < wins.length; wi++) {
        if (wins[wi].win.canonical !== first.canonical) {
          stats.variant = 'split';
          stats.attempts = wins[0].attempts;
          return unavailable('ambiguous-pairing',
            'the XY entities admit two different solids');
        }
      }
      stats.variant = wins[0].tag;
      stats.attempts = wins[0].attempts;
      stats.planVerts = wins[0].planVerts;
      stats.elevVerts = wins[0].elevVerts;
      stats.profVerts = wins[0].profVerts;
      stats.planLoop = wins[0].planLoop ? wins[0].planLoop.order.length : 0;
      if (first.profileMap) stats.profileMap = first.profileMap;
      if (variants.length > 1) {
        warnings.push({
          code: 'on-datum-placed',
          label: cls.onDatum.length + ' XY entit(y/ies) read as ' +
            (wins[0].tag === 'datum-in-plan' ? 'plan' : 'elevation')
        });
      }
      if (cls.droppedHelpers.length > 0) {
        warnings.push({
          code: 'helpers-ignored',
          label: cls.droppedHelpers.length +
            ' construction helper(s) left out (projector/miter)'
        });
      }
      var leftoverCurves = f.curves.length;
      if (first.class === 'D') leftoverCurves = f.curves.length - 1;
      if (leftoverCurves > 0) {
        warnings.push({
          code: 'curves-ignored',
          label: leftoverCurves +
            ' circle/arc entit(y/ies) left out (curves deferred)'
        });
      }
      var covOk = { plan: first.coveragePlan, elev: first.coverageElev };
      if (first.coverageProfile !== undefined) {
        covOk.profile = first.coverageProfile;
      }
      return {
        status: 'ok', reason: null, label: '', class: first.class,
        geometry: first.geometry,
        coverage: covOk,
        warnings: warnings, stats: stats
      };
    }
    var ranked = solved.map(function (s, i) { return { s: s, i: i }; });
    ranked.sort(function (a, b) {
      var r = failRank(a.s.fail.reason) - failRank(b.s.fail.reason);
      return r !== 0 ? r : a.i - b.i;
    });
    var best = ranked[0].s;
    stats.variant = best.tag;
    stats.attempts = best.attempts;
    stats.planVerts = best.planVerts;
    stats.elevVerts = best.elevVerts;
    stats.profVerts = best.profVerts;
    stats.planLoop = best.planLoop ? best.planLoop.order.length : 0;
    return unavailable(best.fail.reason, best.fail.label);
  }

  return {
    WORLD_UNITS: WORLD_UNITS, VERSION: VERSION,
    WELD_MIN_MM: WELD_MIN_MM, WELD_REL: WELD_REL,
    WELD_MAX_MM: WELD_MAX_MM,
    MATCH_EPS_MM: MATCH_EPS_MM, LOOSE_EPS_MM: LOOSE_EPS_MM,
    COVERAGE_GATE: COVERAGE_GATE, VERTICAL_EPS: VERTICAL_EPS,
    REASON_LABELS: REASON_LABELS,
    filterEntities: filterEntities,
    classifyViews: classifyViews,
    weldTolerance: weldTolerance,
    buildViewGraph: buildViewGraph,
    convexLoop: convexLoop,
    pointInLoop: pointInLoop,
    inferProfileMaps: inferProfileMaps,
    mapDepth: mapDepth,
    tryPrism: tryPrism,
    tryPyramid: tryPyramid,
    tryWireframe: tryWireframe,
    tryCylinder: tryCylinder,
    tryCone: tryCone,
    tryRevolved: tryRevolved,
    RIM_K: RIM_K,
    projectToViews: projectToViews,
    baseNameOf: baseNameOf, captionBases: captionBases,
    reconstruct: reconstruct
  };
});

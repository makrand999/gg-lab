(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADReconstruct = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD two-view reconstruction: plan + elevation drawings resolve to a
  // 3D wireframe in widget space (X, Y, Z) = (sheetX, elevY, -planY) with Y
  // up and Z toward the viewer. Zero deps. Dual-env: browser via
  // window.EduCADReconstruct, plain Node via module.exports. Node-safe.
  //
  // Interpretation contract (locked): 3D point (x, d, h) reads as elevation
  // (x, h) and plan (x, -d); viewRole wins when PLAN/ELEVATION and BOTH is
  // classified by y-sign; dimensions/text/datum axes, meta.kind in
  // {projector, locus, axis}, and sheet-vertical lines crossing XY are
  // filtered out. Round-trip projection is the acceptance gate: drawn
  // geometry must be covered by the reconstruction within tolerance.
  //
  // Strategy is recognize-then-verify (profile first): closed loops are
  // found per view, class hypotheses (A prismatic sweep, B pyramid with
  // apex, C lifted wireframe) are built directly from the loop inventory,
  // and each hypothesis is scored by drawn-length coverage. Ambiguity is
  // reported, never guessed; deterministic tie-breaks prefer max coverage,
  // then min total edge length.
  var WORLD_UNITS = 'mm';
  var VERSION = '10.0.0-educad';
  var WELD_MIN_MM = 1e-6;
  var WELD_REL = 1e-4;
  var WELD_MAX_MM = 0.5;
  var MATCH_EPS_MM = 0.5;
  var LOOSE_EPS_MM = 2.5;
  var COVERAGE_GATE = 0.999;
  var VERTICAL_EPS = 1e-9;

  var REASON_LABELS = {
    'missing-view': 'needs both plan and elevation views',
    'no-closed-profile': 'no closed profile found in either view',
    'unsupported-curves': 'curves not supported yet',
    'x-mismatch': 'plan/elevation x stations differ beyond eps',
    'ambiguous-pairing': 'ambiguous pairing across views',
    'non-convex-profile': 'non-convex profile (M1 covers convex only)',
    'unmatched-edge': 'a drawn edge fits no interpretation',
    'unmatched-point': 'a drawn point fits no interpretation',
    'non-manifold': 'degenerate solid (zero height or area)',
    'coverage-failed': 'round-trip coverage below gate'
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
    return (e.y > 0 && e.y2 < 0) || (e.y < 0 && e.y2 > 0);
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

  // --- View classification (§3.3): viewRole wins when PLAN/ELEVATION;
  // BOTH falls back to midpoint y-sign. Entities exactly on XY with no
  // off-datum end are set aside with a warning.
  function classifyViews(kept) {
    var plan = [], elev = [], onDatum = [];
    for (var i = 0; i < kept.length; i++) {
      var e = kept[i];
      if (e.viewRole === 'PLAN') { plan.push(e); continue; }
      if (e.viewRole === 'ELEVATION') { elev.push(e); continue; }
      var my = ((e.y === undefined ? 0 : e.y) +
        (e.y2 === undefined ? 0 : e.y2)) / 2;
      if (my > 0) { elev.push(e); continue; }
      if (my < 0) { plan.push(e); continue; }
      if (e.y > 0 || e.y2 > 0) { elev.push(e); continue; }
      if (e.y < 0 || e.y2 < 0) { plan.push(e); continue; }
      onDatum.push(e);
    }
    return { plan: plan, elev: elev, onDatum: onDatum };
  }

  // Adaptive weld tolerance: exact for generated drawings, forgiving for
  // hand-drawn ones. Floor is the locked coincident tolerance.
  function weldTolerance(planItems, elevItems) {
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

  // --- Class A: prismatic sweep of the plan loop over [z0, z1]. ---
  // Same-view checks use the weld tol; cross-view checks (plan stations
  // vs drawn elevation) use the structural tol, since paired stations
  // may legitimately differ by up to eps.
  function tryPrism(planG, elevG, planLoop, eps, tol) {
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
    var cov = Math.min(covPlan, covElev);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed',
        'prism round-trip coverage ' + cov.toFixed(3), cov);
    }
    return {
      pass: true, class: 'A', coverage: cov,
      totalLength: totalLength(verts, edges),
      geometry: { name: 'prism', vertices: verts, edges: edges, faces: faces },
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(verts, edges)
    };
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

  // --- Class B: pyramid over the plan loop with an interior apex seen in
  // both views. Returns null when no plan apex exists (not a pyramid).
  function tryPyramid(planG, elevG, planLoop, eps, tol) {
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
    var triIn = function (qx, qy, t2) {
      if (qy < z0 - t2 || qy > z1 + t2) return false;
      var f = (qy - z0) / (z1 - z0);
      var xl = xL + (xa - xL) * f, xr = xR + (xa - xR) * f;
      var lo = Math.min(xl, xr) - t2, hi = Math.max(xl, xr) + t2;
      return qx >= lo && qx <= hi;
    };
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
    var cov = Math.min(covPlan, covElev);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed',
        'pyramid round-trip coverage ' + cov.toFixed(3), cov);
    }
    return {
      pass: true, class: 'B', coverage: cov,
      totalLength: totalLength(verts, edges),
      geometry: { name: 'pyramid', vertices: verts, edges: edges, faces: faces },
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(verts, edges)
    };
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

  // --- Class C: lifted wireframe. Vertices pair across views by station;
  // edges need both projections (degenerate point+segment pins excepted).
  function tryWireframe(planG, elevG, eps, tol) {
    var stol = Math.max(tol, eps);
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
    // Pass 1: 1:1 stations.
    var sk;
    for (sk in byStP) {
      if (!Object.prototype.hasOwnProperty.call(byStP, sk)) continue;
      if (byStP[sk].length === 1 && byStE[sk] && byStE[sk].length === 1) {
        pairUp(byStP[sk][0], byStE[sk][0]);
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
          pairUp(endAtS1, a);
          pairUp(endAtS2, b);
        } else {
          pairUp(a, endAtS1);
          pairUp(b, endAtS2);
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
          pairUp(freeP[0], freeE[0]);
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
      if (loneP.length === 1 && segE.length === 1 && loneE.length === 0) {
        pins.push({ p: loneP[0], seg: segE[0], dir: 'vertical' });
        P2E[loneP[0]] = -1;
        E2P[segE[0].a] = -2;
        E2P[segE[0].b] = -2;
      } else if (loneE.length === 1 && segP.length === 1 &&
          loneP.length === 0) {
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
    // x-mismatch; the rest are unmatched points/edges.
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
    for (i = 0; i < planG.verts.length; i++) {
      if (P2E[i] !== undefined) continue;
      if (byStE[planSt[i]] && byStE[planSt[i]].length > 0) {
        noteAmb('plan vertex has several elevation mates');
        continue;
      }
      var nearP = nearestOppX(planG.verts[i].x, elevG.verts);
      if (nearP <= LOOSE_EPS_MM) {
        noteFail('x-mismatch', 'plan vertex near x=' +
          planG.verts[i].x + ' misses its mate beyond eps');
      } else if (lonePointVert(segUsersP, i)) {
        noteFail('unmatched-point',
          'plan point near x=' + planG.verts[i].x + ' has no mate');
      } else {
        noteFail('unmatched-edge',
          'plan vertex near x=' + planG.verts[i].x + ' has no mate');
      }
    }
    for (i = 0; i < elevG.verts.length; i++) {
      if (E2P[i] !== undefined) continue;
      if (byStP[elevSt[i]] && byStP[elevSt[i]].length > 0) {
        noteAmb('elevation vertex has several plan mates');
        continue;
      }
      var nearE = nearestOppX(elevG.verts[i].x, planG.verts);
      if (nearE <= LOOSE_EPS_MM) {
        noteFail('x-mismatch', 'elevation vertex near x=' +
          elevG.verts[i].x + ' misses its mate beyond eps');
      } else if (lonePointVert(segUsersE, i)) {
        noteFail('unmatched-point',
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
    var cov = Math.min(covPlan, covElev);
    if (cov < COVERAGE_GATE) {
      return fail('coverage-failed',
        'wireframe round-trip coverage ' + cov.toFixed(3), cov);
    }
    return {
      pass: true, class: 'C', coverage: cov,
      totalLength: totalLength(verts, edges),
      geometry: {
        name: 'wireframe', vertices: verts, edges: edges, faces: []
      },
      coveragePlan: covPlan, coverageElev: covElev,
      canonical: canonicalOf(verts, edges)
    };
  }

  // Project a widget-space geometry back onto both sheet views:
  // elevation (X, Y), plan (X, -Z). Independent of the class attempts;
  // tests use it to verify the round-trip invariant from outside.
  function projectToViews(geometry) {
    var verts = geometry.vertices;
    var planPts = verts.map(function (v) { return { x: v.x, y: -v.z }; });
    var elevPts = verts.map(function (v) { return { x: v.x, y: v.y }; });
    var planSegs = [], elevSegs = [];
    for (var i = 0; i < geometry.edges.length; i++) {
      var a = geometry.edges[i][0], b = geometry.edges[i][1];
      planSegs.push({ a: planPts[a], b: planPts[b] });
      elevSegs.push({ a: elevPts[a], b: elevPts[b] });
    }
    return {
      planPts: planPts, elevPts: elevPts,
      planSegs: planSegs, elevSegs: elevSegs
    };
  }

  var FAIL_PRIORITY = [
    'missing-view', 'unsupported-curves', 'x-mismatch',
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
  function reconstruct(entities, opts) {
    opts = opts || {};
    var eps = opts.eps === undefined ? MATCH_EPS_MM : opts.eps;
    assertFinite(eps);
    if (!(eps > 0)) throw new Error('eps must be > 0');
    var list = Array.isArray(entities) ? entities.slice() : [];
    var warnings = [];
    var f = filterEntities(list);
    var cls = classifyViews(sortStable(f.kept));
    var tol = weldTolerance(cls.plan, cls.elev);
    var stats = {
      kept: f.kept.length, curves: f.curves.length,
      dropped: f.dropped, onDatum: cls.onDatum.length,
      planItems: cls.plan.length, elevItems: cls.elev.length,
      weldTol: tol, eps: eps, attempts: [], variant: 'direct'
    };
    function unavailable(reason, label) {
      return {
        status: 'unavailable', reason: reason,
        label: label || REASON_LABELS[reason] || reason,
        class: null, geometry: null,
        coverage: { plan: 0, elev: 0 },
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
      variants = [{ plan: cls.plan, elev: cls.elev, tag: 'direct' }];
    } else {
      variants = [
        { plan: cls.plan, elev: cls.elev.concat(cls.onDatum),
          tag: 'datum-in-elev' },
        { plan: cls.plan.concat(cls.onDatum), elev: cls.elev,
          tag: 'datum-in-plan' }
      ];
    }
    function solveFor(variant) {
      if (variant.plan.length === 0 || variant.elev.length === 0) {
        return {
          tag: variant.tag, planLoop: null, attempts: [],
          win: null,
          fail: fail('missing-view', variant.plan.length === 0 ?
            'no plan view drawn' : 'no elevation view drawn', 0)
        };
      }
      var planG = buildViewGraph(sortStable(variant.plan), tol);
      var elevG = buildViewGraph(sortStable(variant.elev), tol);
      var planLoop = convexLoop(planG, tol);
      var attempts = [];
      var ra = tryPrism(planG, elevG, planLoop, eps, tol);
      if (ra) {
        attempts.push({ class: 'A', pass: !!ra.pass,
          coverage: ra.coverage || 0, reason: ra.reason || null });
      }
      var rb = tryPyramid(planG, elevG, planLoop, eps, tol);
      if (rb) {
        attempts.push({ class: 'B', pass: !!rb.pass,
          coverage: rb.coverage || 0, reason: rb.reason || null });
      }
      var rc = tryWireframe(planG, elevG, eps, tol);
      attempts.push({ class: 'C', pass: !!rc.pass,
        coverage: rc.coverage || 0, reason: rc.reason || null });
      var passing = [ra, rb, rc].filter(function (r) { return r && r.pass; });
      passing.sort(function (a, b) {
        if (a.coverage !== b.coverage) return b.coverage - a.coverage;
        return a.totalLength - b.totalLength;
      });
      var sol = {
        tag: variant.tag, planLoop: planLoop, attempts: attempts,
        planVerts: planG.verts.length, elevVerts: elevG.verts.length,
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
      var fails = [ra, rb, rc].filter(function (r) { return r && !r.pass; });
      fails.sort(function (a, b) {
        return failRank(a.reason) - failRank(b.reason);
      });
      if (!planLoop && f.curves.length > 0) {
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
      stats.planLoop = wins[0].planLoop ? wins[0].planLoop.order.length : 0;
      if (variants.length > 1) {
        warnings.push({
          code: 'on-datum-placed',
          label: cls.onDatum.length + ' XY entit(y/ies) read as ' +
            (wins[0].tag === 'datum-in-plan' ? 'plan' : 'elevation')
        });
      }
      if (f.curves.length > 0) {
        warnings.push({
          code: 'curves-ignored',
          label: f.curves.length +
            ' circle/arc entit(y/ies) left out (curves deferred)'
        });
      }
      return {
        status: 'ok', reason: null, label: '', class: first.class,
        geometry: first.geometry,
        coverage: { plan: first.coveragePlan, elev: first.coverageElev },
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
    tryPrism: tryPrism,
    tryPyramid: tryPyramid,
    tryWireframe: tryWireframe,
    projectToViews: projectToViews,
    reconstruct: reconstruct
  };
});

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./educad-entities.js'), require('./educad-strict.js'),
      require('./educad-curve-reconstruct.js'), require('./educad-oblique-kernel.js'),function() {return require('./educad-project.js');},
      require('./educad-surfaces.js'), require('./educad-parametric.js'), require('./educad-parametric-reconstruct.js'),
      require('./educad-surface-infer.js'), require('./educad-conic.js'), require('./educad-view-frame.js'), require('./educad-drawing-sections.js'));
  } else {
    root.EduCADReconstruct = factory(root.EduCADEntities, root.EduCADStrict,
      root.EduCADCurveReconstruct, root.EduCADObliqueKernel,function() {return root.EduCADProject;},
      root.EduCADSurfaces, root.EduCADParametric, root.EduCADParametricReconstruct, root.EduCADSurfaceInfer,
      root.EduCADConic, root.EduCADViewFrame, root.EduCADDrawingSections);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (Entities, Strict, Curves, Oblique, getProject, Surfaces, Parametric, ParametricReconstruct, SurfaceInfer, Conic, ViewFrame, DrawingSections) {
  'use strict';


















  var WORLD_UNITS = 'mm';
  var VERSION = '10.6.0-educad';
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
    'unsupported-curves': 'curves not supported yet',
    'x-mismatch': 'plan/elevation x stations differ beyond eps',
    'ambiguous-pairing': 'ambiguous pairing across views',
    'unmatched-edge': 'a drawn edge fits no interpretation',
    'unmatched-point': 'a drawn point fits no interpretation',
    'non-manifold': 'degenerate solid (zero height or area)',
    'coverage-failed': 'round-trip coverage below gate',
    'hint-conflict': 'projector claims contradict each other',
    'hint-loose-foot': 'a claim foot lands off drawn vertices',
    'duplicate-corners': 'two corners lift to one 3D point',
    'corners-not-coplanar': 'claimed corners leave the profile plane',
    'non-convex-corners': 'claimed corners bound no convex face',
    'empty-sketch': 'nothing with both views drawn yet'
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






  var KEEP_TYPES = {
    POINT: 1, SEGMENT: 1, LINE: 1, RAY: 1, CIRCLE: 1, CIRCULAR_ARC: 1
  };
  var DROP_META = { projector: 1, locus: 1, axis: 1 };

  function isSheetVertical(e) {
    return Math.abs(e.x2 - e.x) <= VERTICAL_EPS;
  }

  function crossesXY(e) {



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



  function orientFaces(verts, faces, checks) {
    var out = [];
    for (var i = 0; i < faces.length; i++) {
      var loop = faces[i].slice();
      if (!checks[i](newellVec(verts, loop))) loop.reverse();
      out.push(loop);
    }
    return out;
  }








  var FACES_MAX_VERTS = 64;
  var FACES_MAX_EDGES = 96;
  var FACES_MAX_LEN = 10;
  var FACES_MAX_CYCLES = 3000;
  var FACES_MAX_STEPS = 150000;
  function inferClosedFaces(verts, edges) {
    if (!Array.isArray(verts) || !Array.isArray(edges)) return [];
    var V = verts.length, E = edges.length;
    if (V < 4 || E < 6 || V > FACES_MAX_VERTS || E > FACES_MAX_EDGES) {
      return [];
    }
    var vi, ei, a, b;
    for (vi = 0; vi < V; vi++) {
      var p = verts[vi];
      if (!p || typeof p.x !== 'number' || typeof p.y !== 'number' ||
          typeof p.z !== 'number' || !isFinite(p.x) || !isFinite(p.y) ||
          !isFinite(p.z)) {
        return [];
      }
    }
    var adj = [], deg = [];
    for (vi = 0; vi < V; vi++) { adj.push([]); deg.push(0); }
    var seenE = {}, ek;
    for (ei = 0; ei < E; ei++) {
      var ee = edges[ei];
      if (!ee || ee.length < 2) return [];
      a = ee[0]; b = ee[1];
      if (typeof a !== 'number' || typeof b !== 'number' ||
          a !== Math.floor(a) || b !== Math.floor(b) ||
          a < 0 || b < 0 || a >= V || b >= V || a === b) {
        return [];
      }
      ek = a < b ? a + '_' + b : b + '_' + a;
      if (seenE[ek]) continue;
      seenE[ek] = 1;
      adj[a].push(b); adj[b].push(a);
      deg[a]++; deg[b]++;
    }
    for (vi = 0; vi < V; vi++) {
      if (deg[vi] < 3) return [];
      adj[vi].sort(function (x, y) { return x - y; });
    }
    var minX = verts[0].x, maxX = verts[0].x;
    var minY = verts[0].y, maxY = verts[0].y;
    var minZ = verts[0].z, maxZ = verts[0].z;
    for (vi = 1; vi < V; vi++) {
      if (verts[vi].x < minX) minX = verts[vi].x;
      if (verts[vi].x > maxX) maxX = verts[vi].x;
      if (verts[vi].y < minY) minY = verts[vi].y;
      if (verts[vi].y > maxY) maxY = verts[vi].y;
      if (verts[vi].z < minZ) minZ = verts[vi].z;
      if (verts[vi].z > maxZ) maxZ = verts[vi].z;
    }
    var dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
    var planarTol = Math.max(1e-6,
      Math.sqrt(dx * dx + dy * dy + dz * dz) * 1e-9);


    var cycles = [], seenC = {}, steps = 0, capped = false;
    function canonKey(loop) {
      var n = loop.length, best = null, r, i, s;
      for (r = 0; r < 2; r++) {
        var seq = r === 0 ? loop : loop.slice().reverse();
        for (i = 0; i < n; i++) {
          s = [];
          for (var k = 0; k < n; k++) s.push(seq[(i + k) % n]);
          var key = s.join(',');
          if (best === null || key < best) best = key;
        }
      }
      return best;
    }
    function planar(loop) {
      var nrm = newellVec(verts, loop);
      var nl2 = nrm.x * nrm.x + nrm.y * nrm.y + nrm.z * nrm.z;
      if (!(nl2 > 1e-24)) return false;
      var nl = Math.sqrt(nl2);
      var qx = 0, qy = 0, qz = 0, i;
      for (i = 0; i < loop.length; i++) {
        qx += verts[loop[i]].x;
        qy += verts[loop[i]].y;
        qz += verts[loop[i]].z;
      }
      qx /= loop.length; qy /= loop.length; qz /= loop.length;
      for (i = 0; i < loop.length; i++) {
        var q = verts[loop[i]];
        var dev = Math.abs(nrm.x * (q.x - qx) + nrm.y * (q.y - qy) +
          nrm.z * (q.z - qz)) / nl;
        if (dev > planarTol) return false;
      }
      return true;
    }
    var path = [], onPath = {};
    function dfs(start, u) {
      if (capped) return;
      var nb = adj[u];
      for (var i = 0; i < nb.length; i++) {
        if (capped) return;
        steps++;
        if (steps > FACES_MAX_STEPS) { capped = true; return; }
        var w = nb[i];
        if (w === start) {
          if (path.length >= 3) {
            var key = canonKey(path);
            if (!seenC[key]) {
              seenC[key] = 1;
              if (planar(path)) cycles.push(path.slice());
              if (cycles.length >= FACES_MAX_CYCLES) {
                capped = true; return;
              }
            }
          }
        } else if (w > start && !onPath[w] &&
            path.length < FACES_MAX_LEN) {
          onPath[w] = 1;
          path.push(w);
          dfs(start, w);
          path.pop();
          delete onPath[w];
        }
      }
    }
    for (vi = 0; vi < V && !capped; vi++) {
      onPath = {};
      onPath[vi] = 1;
      path = [vi];
      dfs(vi, vi);
    }
    if (cycles.length === 0) return [];

    var comp = [], compId = -1, stack;
    var compOf = [];
    for (vi = 0; vi < V; vi++) compOf.push(-1);
    for (vi = 0; vi < V; vi++) {
      if (compOf[vi] !== -1) continue;
      compId++;
      comp.push({ verts: [], edges: 0 });
      stack = [vi];
      compOf[vi] = compId;
      while (stack.length > 0) {
        var u = stack.pop();
        comp[compId].verts.push(u);
        for (var q = 0; q < adj[u].length; q++) {
          if (compOf[adj[u][q]] === -1) {
            compOf[adj[u][q]] = compId;
            stack.push(adj[u][q]);
          }
        }
      }
    }
    Object.keys(seenE).forEach(function (k) {
      var vv = k.split('_');
      comp[compOf[Number(vv[0])]].edges++;
    });
    var byComp = [];
    for (vi = 0; vi < comp.length; vi++) byComp.push([]);
    cycles.forEach(function (c) { byComp[compOf[c[0]]].push(c); });


    function tryOrder(list, vCount, eCount, asc) {
      var ord = list.slice().sort(function (x, y) {
        return asc ? x.length - y.length : y.length - x.length;
      });
      var use = {}, picked = [], i, j, kk, okAll;
      for (i = 0; i < ord.length; i++) {
        okAll = true;
        for (j = 0; j < ord[i].length; j++) {
          var pa = ord[i][j], pb = ord[i][(j + 1) % ord[i].length];
          kk = pa < pb ? pa + '_' + pb : pb + '_' + pa;
          if ((use[kk] || 0) >= 2) { okAll = false; break; }
        }
        if (!okAll) continue;
        for (j = 0; j < ord[i].length; j++) {
          var qa = ord[i][j], qb = ord[i][(j + 1) % ord[i].length];
          kk = qa < qb ? qa + '_' + qb : qb + '_' + qa;
          use[kk] = (use[kk] || 0) + 1;
        }
        picked.push(ord[i]);
      }
      if (vCount - eCount + picked.length !== 2) return null;
      var keys = Object.keys(use);
      if (keys.length !== eCount) return null;
      for (i = 0; i < keys.length; i++) {
        if (use[keys[i]] !== 2) return null;
      }
      return picked;
    }
    var faces = [];
    for (vi = 0; vi < comp.length; vi++) {
      var set = tryOrder(byComp[vi], comp[vi].verts.length,
        comp[vi].edges, true) ||
        tryOrder(byComp[vi], comp[vi].verts.length,
          comp[vi].edges, false);
      if (!set) return [];

      var gx = 0, gy = 0, gz = 0, gi;
      for (gi = 0; gi < comp[vi].verts.length; gi++) {
        gx += verts[comp[vi].verts[gi]].x;
        gy += verts[comp[vi].verts[gi]].y;
        gz += verts[comp[vi].verts[gi]].z;
      }
      gx /= comp[vi].verts.length;
      gy /= comp[vi].verts.length;
      gz /= comp[vi].verts.length;
      for (gi = 0; gi < set.length; gi++) {
        var loop = set[gi].slice(), fn = newellVec(verts, loop);
        var mx = 0, my = 0, mz = 0, mi;
        for (mi = 0; mi < loop.length; mi++) {
          mx += verts[loop[mi]].x;
          my += verts[loop[mi]].y;
          mz += verts[loop[mi]].z;
        }
        mx = mx / loop.length - gx;
        my = my / loop.length - gy;
        mz = mz / loop.length - gz;
        if (fn.x * mx + fn.y * my + fn.z * mz <= 0) loop.reverse();
        faces.push(loop);
      }
    }
    return faces;
  }









  function supportingPlanes(verts, edges) {
    var adjacent = verts.map(function () { return []; }), planes = [];
    edges.forEach(function (e) { adjacent[e[0]].push(e[1]); adjacent[e[1]].push(e[0]); });
    adjacent.forEach(function (neighbors, v) {
      for (var i = 0; i < neighbors.length; i++) {
        for (var j = i + 1; j < neighbors.length; j++) {
          addPlane(planes, verts, [neighbors[i], v, neighbors[j]]);
        }
      }
    });
    return planes;
  }

  function faceLoops(face) { return [face].concat(face.holes || []); }
  function faceEdgeKeys(face) {
    var keys = [];
    faceLoops(face).forEach(function (loop) {
      loop.forEach(function (a, i) {
        var b = loop[(i + 1) % loop.length];
        keys.push(a < b ? a + '_' + b : b + '_' + a);
      });
    });
    return keys;
  }
  function cyclicLoopKey(loop) {
    var best = null, n = loop.length;
    for (var dir = 0; dir < 2; dir++) {
      var source = dir ? loop.slice().reverse() : loop.slice();
      for (var shift = 0; shift < n; shift++) {
        var rotated = [];
        for (var i = 0; i < n; i++) rotated.push(source[(i+shift) % n]);
        var key = rotated.join(',');
        if (best === null || key < best) best = key;
      }
    }
    return best;
  }
  function cyclicFaceKey(face) {
    return cyclicLoopKey(face) + '|' + (face.holes || []).map(cyclicLoopKey).sort().join('|');
  }
  function dedupeFaces(faces) {
    var seen = new Set(), out = [];
    (faces || []).forEach(function (face) {
      var key = cyclicFaceKey(face);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(face);
    });
    return out;
  }

  function addPlane(planes, verts, cycle) {
    var n = newellVec(verts, cycle);
    var nl = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
    if (!(nl > 1e-12)) return;
    n = { x: n.x / nl, y: n.y / nl, z: n.z / nl };
    if (n.x < -1e-9 ||
        (Math.abs(n.x) <= 1e-9 && (n.y < -1e-9 ||
        (Math.abs(n.y) <= 1e-9 && n.z < 0)))) {
      n = { x: -n.x, y: -n.y, z: -n.z };
    }
    var off = n.x * verts[cycle[0]].x + n.y * verts[cycle[0]].y +
      n.z * verts[cycle[0]].z;
    for (var i = 0; i < planes.length; i++) {
      var p = planes[i];
      var dot = n.x * p.n.x + n.y * p.n.y + n.z * p.n.z;
      if (dot > 1 - 1e-9 && Math.abs(off - p.off) <= 1e-6) return;
    }
    planes.push({ n: n, off: off });
  }






  function splitPlanarCrossings(points, edges) {
    var pts = points.map(function (p) { return { x: p.x, y: p.y }; });
    function cross(ax, ay, bx, by) { return ax * by - ay * bx; }
    function intern(p) {
      for (var i = 0; i < pts.length; i++) {
        if (Math.abs(p.x - pts[i].x) < 1e-8 && Math.abs(p.y - pts[i].y) < 1e-8) return i;
      }
      pts.push(p); return pts.length - 1;
    }
    edges.forEach(function (e, i) {
      var p = pts[e[0]], r = {x:pts[e[1]].x-p.x,y:pts[e[1]].y-p.y};
      for (var j = i + 1; j < edges.length; j++) {
        var q = pts[edges[j][0]], t = pts[edges[j][1]], sx=t.x-q.x, sy=t.y-q.y;
        var den = cross(r.x,r.y,sx,sy);
        if (Math.abs(den) < 1e-12) continue;
        var a = cross(q.x-p.x,q.y-p.y,sx,sy)/den;
        var b = cross(q.x-p.x,q.y-p.y,r.x,r.y)/den;
        if (a >= -1e-9 && a <= 1+1e-9 && b >= -1e-9 && b <= 1+1e-9) intern({x:p.x+a*r.x,y:p.y+a*r.y});
      }
    });
    var out = [], seen = {};
    edges.forEach(function(e) {
      var a=pts[e[0]], b=pts[e[1]], dx=b.x-a.x, dy=b.y-a.y, len=dx*dx+dy*dy;
      if (!len) return;
      var splits=[];
      pts.forEach(function(p,i) {
        var t=((p.x-a.x)*dx+(p.y-a.y)*dy)/len;
        if (t >= -1e-9 && t <= 1+1e-9 && Math.abs(cross(p.x-a.x,p.y-a.y,dx,dy)) <= 1e-8*Math.sqrt(len)) splits.push({t:t,id:i});
      });
      splits.sort(function(a,b) { return a.t-b.t; });
      for(var i=1;i<splits.length;i++) {
        if(splits[i].t-splits[i-1].t < 1e-9) continue;
        var u=splits[i-1].id,v=splits[i].id,k=u<v?u+'_'+v:v+'_'+u;
        if(!seen[k]) { seen[k]=true; out.push([u,v]); }
      }
    });
    return {points:pts,edges:out};
  }



  function splitSpatialEdges(verts, edges) {
    var out=[], seen={};
    edges.forEach(function(e) {
      var a=verts[e[0]],b=verts[e[1]], dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z, len=dx*dx+dy*dy+dz*dz;
      if(!len) return;
      var cuts=[{t:0,id:e[0]},{t:1,id:e[1]}];
      verts.forEach(function(p,i) {
        var t=((p.x-a.x)*dx+(p.y-a.y)*dy+(p.z-a.z)*dz)/len;
        if(t <= 1e-9 || t >= 1-1e-9) return;
        var ex=p.x-a.x-t*dx,ey=p.y-a.y-t*dy,ez=p.z-a.z-t*dz;
        if(ex*ex+ey*ey+ez*ez < 1e-12) cuts.push({t:t,id:i});
      });
      cuts.sort(function(a,b) { return a.t-b.t; });
      for(var i=1;i<cuts.length;i++) {
        if(cuts[i].t-cuts[i-1].t < 1e-9) continue;
        var u=cuts[i-1].id,v=cuts[i].id,k=u<v?u+'_'+v:v+'_'+u;
        if(!seen[k]) {seen[k]=true;out.push([u,v]);}
      }
    });
    return out;
  }



  function traceOuterFace(points, edges) {
    if (!points.length || !edges.length) return null;
    var adj = [], i;
    for (i = 0; i < points.length; i++) adj.push([]);
    for (i = 0; i < edges.length; i++) {
      var a = edges[i][0], b = edges[i][1];
      if (a === b) continue;
      adj[a].push(b); adj[b].push(a);
    }
    for (i = 0; i < points.length; i++) {
      var p = points[i];
      adj[i].sort(function (x, y) {
        var ax = Math.atan2(points[x].y - p.y, points[x].x - p.x);
        var ay = Math.atan2(points[y].y - p.y, points[y].x - p.x);
        return ax - ay;
      });
    }
    var seen = Object.create(null), loops = [];
    for (i = 0; i < edges.length; i++) {
      var ends = edges[i];
      for (var dir = 0; dir < 2; dir++) {
        var u = dir === 0 ? ends[0] : ends[1];
        var v = dir === 0 ? ends[1] : ends[0];
        var firstKey = u + '>' + v;
        if (seen[firstKey]) continue;
        var loop = [], cu = u, cv = v, guard = 0;
        while (guard++ <= points.length + edges.length + 4) {
          seen[cu + '>' + cv] = true;
          loop.push(cu);
          var nb = adj[cv], idx = nb.indexOf(cu);
          if (idx === -1) { loop = []; break; }
          var nxt = nb[(idx - 1 + nb.length) % nb.length];
          cu = cv; cv = nxt;
          if (cu === u && cv === v) break;
        }
        if (loop.length < 3) continue;
        var area = 0;
        for (var j = 0; j < loop.length; j++) {
          var p1 = points[loop[j]], p2 = points[loop[(j + 1) % loop.length]];
          area += p1.x * p2.y - p2.x * p1.y;
        }
        area /= 2;
        loops.push({ loop: loop, area: area });
      }
    }
    var best = null;
    for (i = 0; i < loops.length; i++) {
      if (best === null || Math.abs(loops[i].area) > Math.abs(best.area)) {
        best = loops[i];
      }
    }
    if (!best || Math.abs(best.area) <= 1e-12) return null;
    var out = best.loop.slice();
    if (best.area < 0) out.reverse();
    return out;
  }



  function manifoldVertexLinks(faces) {
    var links = new Map(), valid = true;
    faces.forEach(function(face) { faceLoops(face).forEach(function(loop) {
      if (new Set(loop).size !== loop.length) valid = false;
      loop.forEach(function(v,i) {
        var graph=links.get(v); if(!graph) {graph=new Map();links.set(v,graph);}
        var a=loop[(i+loop.length-1)%loop.length],b=loop[(i+1)%loop.length];
        if(!graph.has(a)) graph.set(a,[]); if(!graph.has(b)) graph.set(b,[]);
        graph.get(a).push(b); graph.get(b).push(a);
      });
    }); });
    links.forEach(function(graph) {
      var ends=0;
      graph.forEach(function(ns) { if(ns.length===1) ends++; else if(ns.length!==2) valid=false; });
      if(ends!==0 && ends!==2) valid=false;
      var seen=new Set(), stack=[graph.keys().next().value];
      while(stack.length) { var v=stack.pop(); if(seen.has(v)) continue; seen.add(v); graph.get(v).forEach(function(n) {stack.push(n);}); }
      if(seen.size!==graph.size) valid=false;
    });
    return valid;
  }




  function selectManifoldFaces(faces) {
    var keys = faces.map(faceEdgeKeys), owners = Object.create(null);
    keys.forEach(function (ks, i) { ks.forEach(function (k) { (owners[k] || (owners[k] = [])).push(i); }); });
    var visited = {}, result = [], exhausted = false, ambiguous = false, steps = 0;
    faces.forEach(function (_, start) {
      if (visited[start] || exhausted) return;
      var group = [], stack = [start]; visited[start] = true;
      while (stack.length) {
        var f = stack.pop(); group.push(f);
        keys[f].forEach(function (k) { owners[k].forEach(function (n) {
          if (!visited[n]) { visited[n] = true; stack.push(n); }
        }); });
      }
      group.sort(function (a, b) { return keys[b].length - keys[a].length || a - b; });
      function solve(closed) {
        var use = {}, remaining = {}, chosen = [], best = [], bestEdges = -1, tied = false;
        group.forEach(function (f) { keys[f].forEach(function (k) { remaining[k] = (remaining[k] || 0) + 1; }); });
        function search(at) {
          if (++steps > 250000) { exhausted = true; return; }
          if (exhausted) return;
          if (closed && Object.keys(use).some(function (k) { return use[k] === 1 && !remaining[k]; })) return;
          var possibleEdges = Object.keys(remaining).filter(function(k) { return remaining[k] || use[k]; }).length;
          if (possibleEdges < bestEdges || possibleEdges === bestEdges && chosen.length + group.length - at < best.length) return;
          if (at === group.length) {
            if (!manifoldVertexLinks(chosen.map(function(i) {return faces[i];}))) return;
            var covered = Object.keys(use).filter(function (k) { return use[k] > 0; }).length;
            if (covered > bestEdges || covered === bestEdges && chosen.length > best.length) {
              bestEdges = covered; best = chosen.slice(); tied = false;
            } else if (chosen.length && covered === bestEdges && chosen.length === best.length) tied = true;
            return;
          }
          var f = group[at];
          keys[f].forEach(function (k) { remaining[k]--; });
          if (keys[f].every(function (k) { return (use[k] || 0) < 2; })) {
            keys[f].forEach(function (k) { use[k] = (use[k] || 0) + 1; });
            chosen.push(f); search(at + 1); chosen.pop();
            keys[f].forEach(function (k) { use[k]--; });
          }


          if (best.length !== group.length) search(at + 1);
          keys[f].forEach(function (k) { remaining[k]++; });
        }
        search(0); return {faces:best, ambiguous:tied};
      }
      var selected = solve(true);
      if (!selected.faces.length && !exhausted) selected = solve(false);
      if (selected.ambiguous) ambiguous = true;
      selected.faces.forEach(function (i) { result.push(faces[i]); });
    });
    return { faces: exhausted || ambiguous ? [] : result, exhausted: exhausted, ambiguous: ambiguous };
  }




  function extractPlanarFaces(verts, edges, curves) {
    if (!Array.isArray(verts) || !Array.isArray(edges) ||
        verts.length < 3 || edges.length < 3) {
      return { edges: edges, faces: [] };
    }
    var analyticLoops = new Set();
    (curves || []).forEach(function (curve) {
      if (!curve || !(curve.closed || curve.kind === 'circle' || curve.kind === 'ellipse')) return;
      if (!Array.isArray(curve.displayVertices) || curve.displayVertices.length < 3) return;
      analyticLoops.add(cyclicLoopKey(curve.displayVertices));
    });
    edges = splitSpatialEdges(verts, edges);
    var planes = supportingPlanes(verts, edges), i;
    var faces = [];
    for (var pi = 0; pi < planes.length; pi++) {
      var plane = planes[pi];
      var planeEdges = [], used = Object.create(null);
      for (i = 0; i < edges.length; i++) {
        var a = edges[i][0], b = edges[i][1];
        var va = verts[a], vb = verts[b];
        if (Math.abs(plane.n.x * va.x + plane.n.y * va.y +
            plane.n.z * va.z - plane.off) > 1e-6) continue;
        if (Math.abs(plane.n.x * vb.x + plane.n.y * vb.y +
            plane.n.z * vb.z - plane.off) > 1e-6) continue;
        planeEdges.push([a, b]);
        used[a] = true; used[b] = true;
      }
      if (planeEdges.length < 3) continue;
      var ids = Object.keys(used).map(Number).sort(function (x, y) { return x - y; });
      var localOf = Object.create(null);
      for (i = 0; i < ids.length; i++) localOf[ids[i]] = i;
      var localEdges = planeEdges.map(function (e) {
        return [localOf[e[0]], localOf[e[1]]];
      });
      var adj = [], compOf = [];
      for (i = 0; i < ids.length; i++) { adj.push([]); compOf.push(-1); }
      localEdges.forEach(function (e) {
        adj[e[0]].push(e[1]); adj[e[1]].push(e[0]);
      });
      var comps = [];
      for (i = 0; i < ids.length; i++) {
        if (compOf[i] !== -1) continue;
        var ci = comps.length;
        comps.push([]);
        var stack = [i]; compOf[i] = ci;
        while (stack.length) {
          var u = stack.pop(); comps[ci].push(u);
          for (var q = 0; q < adj[u].length; q++) {
            if (compOf[adj[u][q]] === -1) {
              compOf[adj[u][q]] = ci;
              stack.push(adj[u][q]);
            }
          }
        }
      }

      var ax = Math.abs(plane.n.x), ay = Math.abs(plane.n.y),
        az = Math.abs(plane.n.z), ux, uy;
      if (az >= ax && az >= ay) {
        ux = function (p) { return p.x; };
        uy = function (p) { return p.y; };
      } else if (ay >= ax) {
        ux = function (p) { return p.x; };
        uy = function (p) { return p.z; };
      } else {
        ux = function (p) { return p.y; };
        uy = function (p) { return p.z; };
      }
      var planeFaces = [];
      for (var ci2 = 0; ci2 < comps.length; ci2++) {
        var comp = comps[ci2];
        var localIds = Object.create(null);
        for (i = 0; i < comp.length; i++) localIds[comp[i]] = true;
        var compEdges = localEdges.filter(function (e) {
          return localIds[e[0]] && localIds[e[1]];
        });
        if (compEdges.length < 3) continue;
        var remap = Object.create(null);
        for (i = 0; i < comp.length; i++) remap[comp[i]] = i;
        var points = comp.map(function (li) {
          var g = ids[li];
          return { x: ux(verts[g]), y: uy(verts[g]) };
        });
        var ce = compEdges.map(function (e) { return [remap[e[0]], remap[e[1]]]; });
        var split = splitPlanarCrossings(points, ce);
        var outer = traceOuterFace(split.points, split.edges);
        if (!outer) continue;
        var face = [], crossing = false;
        for (i = 0; i < outer.length; i++) {
          var li = outer[i];
          if (li >= comp.length) { crossing = true; break; }
          face.push(ids[comp[li]]);
        }
        if (crossing || face.length < 3) continue;
        planeFaces.push(face);
      }


      function contains(loop, v) {
        var x = ux(verts[v]), y = uy(verts[v]), inside = false;
        for (var a = 0, b = loop.length - 1; a < loop.length; b = a++) {
          var pa = verts[loop[a]], pb = verts[loop[b]];
          if ((uy(pa) > y) !== (uy(pb) > y) &&
              x < (ux(pb) - ux(pa)) * (y - uy(pa)) / (uy(pb) - uy(pa)) + ux(pa)) inside = !inside;
        }
        return inside;
      }
      var depths = planeFaces.map(function (f) {
        return planeFaces.filter(function (other) { return other !== f && f.every(function (v) { return contains(other, v); }); }).length;
      });
      planeFaces.forEach(function (f, fi) {
        if (depths[fi] % 2) return;
        f.holes = planeFaces.filter(function (h, hi) {
          return depths[hi] === depths[fi] + 1 && h.every(function (v) { return contains(f, v); });
        }).map(function (h) { return h.slice().reverse(); });
        faces.push(f);
      });
    }
    if (!faces.length) return { edges: edges, faces: [] };
    faces = dedupeFaces(faces);
    var selection = selectManifoldFaces(faces);
    faces = dedupeFaces(selection.faces);
    if (!faces.length) return { edges: edges, faces: [], topologyStatus: selection.exhausted ? 'search-limit' : selection.ambiguous ? 'ambiguous-surface' : 'wire' };
    var use = Object.create(null), candidate = Object.create(null);


    faces.forEach(function (face) {
      var n = newellVec(verts, face), length = Math.hypot(n.x,n.y,n.z), origin = verts[face[0]];
      var axis = Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 'x' : Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
      function xy(p) { return axis === 'x' ? [p.y,p.z] : axis === 'y' ? [p.x,p.z] : [p.x,p.y]; }
      function inside(loop, p) {
        var q=xy(p), hit=false;
        for(var i=0,j=loop.length-1;i<loop.length;j=i++) {
          var a=xy(verts[loop[i]]),b=xy(verts[loop[j]]);
          if((a[1]>q[1]) !== (b[1]>q[1]) && q[0] < (b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
        }
        return hit;
      }
      edges.forEach(function(e) {
        if (!e.every(function(v) { var p=verts[v]; return Math.abs(n.x*(p.x-origin.x)+n.y*(p.y-origin.y)+n.z*(p.z-origin.z))/length < 1e-6; })) return;
        var a=verts[e[0]],b=verts[e[1]],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2};
        if(inside(face,mid) && !(face.holes || []).some(function(h) {return inside(h,mid);})) {
          candidate[e[0]<e[1]?e[0]+'_'+e[1]:e[1]+'_'+e[0]]=true;
        }
      });
    });
    faces.forEach(function (f, fi) {
      faceLoops(f).forEach(function (loop) { loop.forEach(function (a, i) {
        var b = loop[(i + 1) % loop.length], k = a < b ? a + '_' + b : b + '_' + a;
        (use[k] || (use[k] = [])).push({ face: fi, dir: a < b ? 1 : -1 });
      }); });
    });
    var kept = edges.filter(function (e) {
      var k = e[0] < e[1] ? e[0] + '_' + e[1] : e[1] + '_' + e[0];
      return use[k] || !candidate[k];
    });


    var signs = [], components = [], invalid = !manifoldVertexLinks(faces);
    faces.forEach(function (_, start) {
      if (signs[start]) return;
      var component = [], queue = [start], closed = true; signs[start] = 1;
      while (queue.length) {
        var fi = queue.pop(); component.push(fi);
        faceEdgeKeys(faces[fi]).forEach(function (k) {
          var owners = use[k]; if (owners.length !== 2) { closed = false; return; }
          var a = owners[0].face === fi ? owners[0] : owners[1], b = owners[0].face === fi ? owners[1] : owners[0];
          var wanted = -signs[fi] * a.dir * b.dir;
          if (signs[b.face] && signs[b.face] !== wanted) invalid = true;
          if (!signs[b.face]) { signs[b.face] = wanted; queue.push(b.face); }
        });
      }
      var volume = 0, origin = verts[faces[start][0]];
      component.forEach(function (fi) { faceLoops(faces[fi]).forEach(function (loop) {
        for (var j = 1; j + 1 < loop.length; j++) {
          var ps = [loop[0], loop[j], loop[j+1]].map(function (v) { var p = verts[v]; return {x:p.x-origin.x,y:p.y-origin.y,z:p.z-origin.z}; });
          var a=ps[0], b=ps[1], c=ps[2];
          volume += signs[fi]*(a.x*(b.y*c.z-b.z*c.y)+a.y*(b.z*c.x-b.x*c.z)+a.z*(b.x*c.y-b.y*c.x))/6;
        }
      }); });
      if (closed && Math.abs(volume) < 1e-9) invalid = true;
      if (closed && volume < 0) component.forEach(function (fi) { signs[fi] *= -1; });
      components.push({ faceIndices: component, closed: closed, volume: closed ? Math.abs(volume) : null });
    });
    if (invalid) return { edges: edges, faces: [], topologyStatus: 'invalid-surface' };
    var finalFaces = [], faceHoles = [], regions = [], regionIndex = {};
    components.forEach(function (component) { component.faceIndices.forEach(function (fi) {
      var outer = faces[fi].slice(), holes = (faces[fi].holes || []).map(function (h) { return h.slice(); });
      if (signs[fi] < 0) { outer.reverse(); holes.forEach(function (h) { h.reverse(); }); }
      regionIndex[fi] = regions.length;
      regions.push({ outer: outer, holes: holes });
      finalFaces.push(outer); faceHoles.push(holes);
      if (!component.closed && !analyticLoops.has(cyclicLoopKey(outer))) {
        finalFaces.push(outer.slice().reverse());
        faceHoles.push(holes.map(function (h) { return h.slice().reverse(); }));
      }
    }); });
    components.forEach(function(c) { c.faceIndices = c.faceIndices.map(function(fi) { return regionIndex[fi]; }); });
    return { edges: kept, faces: finalFaces, faceHoles: faceHoles,
      faceRegions: regions, components: components, topologyStatus: 'inferred' };
  }




  function validateInferredSurfaces(geometry) {
    if (!Strict || typeof Strict.classifySurfaces !== 'function' ||
        typeof Strict.exact !== 'function' || !geometry || !(geometry.faces || []).length) return null;
    var triangles = [], holesSkipped = 0;
    function convex(loop) {
      if (!loop || loop.length < 3) return false;
      var nx=0,ny=0,nz=0;
      loop.forEach(function(v,i) {
        var a=geometry.vertices[v], b=geometry.vertices[loop[(i+1)%loop.length]];
        nx+=(a.y-b.y)*(a.z+b.z); ny+=(a.z-b.z)*(a.x+b.x); nz+=(a.x-b.x)*(a.y+b.y);
      });
      var len=Math.hypot(nx,ny,nz);
      if (!(len>1e-12)) return false;
      for (var i=0;i<loop.length;i++) {
        var p=geometry.vertices[loop[(i+loop.length-1)%loop.length]], q=geometry.vertices[loop[i]], r=geometry.vertices[loop[(i+1)%loop.length]];
        var ux=q.x-p.x,uy=q.y-p.y,uz=q.z-p.z, vx=r.x-q.x,vy=r.y-q.y,vz=r.z-q.z;
        if ((uy*vz-uz*vy)*nx+(uz*vx-ux*vz)*ny+(ux*vy-uy*vx)*nz < -1e-8) return false;
      }
      return true;
    }
    var regions = geometry.faceRegions;
    if (regions && regions.length) {
      regions.forEach(function(region) {
        if ((region.holes || []).length || !convex(region.outer)) { holesSkipped++; return; }
        var face = region.outer;
        for (var i = 1; i + 1 < face.length; i++) triangles.push([face[0], face[i], face[i + 1]]);
      });
    } else {
      geometry.faces.forEach(function(face, fi) {
        var holes = (geometry.faceHoles || [])[fi] || [];
        if (holes.length || !convex(face)) { holesSkipped++; return; }
        for (var i = 1; i + 1 < face.length; i++) triangles.push([face[0], face[i], face[i + 1]]);
      });
    }
    if (!triangles.length) return null;
    if (triangles.length > 400) return { contract: 'inferred-triangle-v1', arithmetic: 'exact-decimal-rational',
      status: 'skipped', reason: 'triangle-budget', triangles: triangles.length, holesSkipped: holesSkipped };
    var positions = geometry.vertices.map(function(v) {
      return [Strict.exact(v.x), Strict.exact(v.y), Strict.exact(v.z)];
    });
    var issues = [];
    var surfaces = Strict.classifySurfaces(triangles, positions, function(state, code, message) {
      issues.push({ state: state, code: code, message: message });
    });
    return { contract: 'inferred-triangle-v1', arithmetic: 'exact-decimal-rational',
      status: issues.length ? 'issues' : holesSkipped ? 'partial' : 'ok',
      holesSkipped: holesSkipped, issues: issues,
      solids: surfaces.solids.length, openSurfaces: surfaces.openSurfaces.length };
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





  function inferProfileMaps(dRef, p0, p1) {
    return [
      { xRef: p0, s: 1, dRef: dRef },
      { xRef: p1, s: -1, dRef: dRef }
    ];
  }

  function mapDepth(map, d) {
    return map.xRef + map.s * (d - map.dRef);
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

  function pyramidTriIn(xL, xR, xa, z0, z1) {
    return function (qx, qy, t2) {
      if (qy < z0 - t2 || qy > z1 + t2) return false;
      var f = (qy - z0) / (z1 - z0);
      var xl = xL + (xa - xL) * f, xr = xR + (xa - xR) * f;
      var lo = Math.min(xl, xr) - t2, hi = Math.max(xl, xr) + t2;
      return qx >= lo && qx <= hi;
    };
  }







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
      var explicitFeet = line.meta.endpointMembers;
      if (explicitFeet && (explicitFeet[0] !== m || explicitFeet[1] !== m)) {
        return fail('hint-conflict', 'projector endpoints select different or missing corners', 0);
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
    'missing-view', 'unsupported-curves', 'x-mismatch',
    'hint-conflict', 'hint-loose-foot', 'duplicate-corners',
    'corners-not-coplanar', 'non-convex-corners',
    'unmatched-point', 'unmatched-edge',
    'non-manifold', 'ambiguous-pairing', 'coverage-failed'
  ];

  function failRank(reason) {
    var r = FAIL_PRIORITY.indexOf(reason);
    return r === -1 ? FAIL_PRIORITY.length : r;
  }







  function collectClaimLines(list) {
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
    return claimLines;
  }

  function runReader(list, eps, which) {
    var warnings = [];
    var f = filterEntities(list);
    var byId = {};
    for (var bi = 0; bi < list.length; bi++) {
      if (list[bi] && typeof list[bi].id === 'string') byId[list[bi].id] = list[bi];
    }
    var claimLines = which === 'E' ? collectClaimLines(list) : [];
    var cls = classifyViews(sortStable(f.kept), undefined, f.curves);
    var tol = weldTolerance(cls.plan, cls.elev, cls.profile);
    var stats = {
      kept: f.kept.length, curves: f.curves.length,
      dropped: f.dropped, onDatum: cls.onDatum.length,
      planItems: cls.plan.length, elevItems: cls.elev.length,
      profileItems: cls.profile.length,
      helpersDropped: cls.droppedHelpers.length,
      weldTol: tol, eps: eps, reader: which, variant: 'direct'
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
      var hasPlanCircle = which === 'D' && planCirclesOf(f.curves).length > 0;
      if ((variant.plan.length === 0 && !hasPlanCircle) ||
          variant.elev.length === 0) {
        return {
          tag: variant.tag, planLoop: null,
          win: null,
          fail: fail('missing-view', variant.plan.length === 0 ?
            'no plan view drawn' : 'no elevation view drawn', 0)
        };
      }
      var planG = buildViewGraph(sortStable(variant.plan), tol);
      var elevG = buildViewGraph(sortStable(variant.elev), tol);
      var profG = variant.profile.length > 0 ?
        buildViewGraph(sortStable(variant.profile), tol) : null;
      var planLoop = convexLoop(planG, tol);
      var verdict = which === 'E' ?
        tryClaimedCorners(planG, elevG, eps, tol, claimLines, byId) :
        tryRevolved(planG, elevG, planLoop, f.curves, eps, tol, profG);
      var sol = {
        tag: variant.tag, planLoop: planLoop,
        planVerts: planG.verts.length, elevVerts: elevG.verts.length,
        profVerts: profG ? profG.verts.length : 0,
        win: null, fail: null, skipped: !verdict
      };
      if (verdict && verdict.pass) {
        sol.win = verdict;
        return sol;
      }
      if (verdict) {
        sol.fail = verdict;
        return sol;
      }
      return sol;
    }
    var solved = variants.map(solveFor);
    var wins = solved.filter(function (s) { return !!s.win; });
    if (wins.length > 0) {
      var first = wins[0].win;
      for (var wi = 1; wi < wins.length; wi++) {
        if (wins[wi].win.canonical !== first.canonical) {
          stats.variant = 'split';
          return unavailable('ambiguous-pairing',
            'the XY entities admit two different solids');
        }
      }
      stats.variant = wins[0].tag;
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
      var leftoverCurves = which === 'D' ? f.curves.length - 1 : f.curves.length;
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
        status: 'ok', reason: null, label: '', class: null,
        geometry: first.geometry,
        coverage: covOk,
        warnings: warnings, stats: stats
      };
    }
    var decided = solved.filter(function (s) { return !!s.fail; });
    if (decided.length === 0) return null;
    decided.sort(function (a, b) {
      var r = failRank(a.fail.reason) - failRank(b.fail.reason);
      if (r !== 0) return r;
      return a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0;
    });
    var best = decided[0];
    stats.variant = best.tag;
    stats.planVerts = best.planVerts;
    stats.elevVerts = best.elevVerts;
    stats.profVerts = best.profVerts;
    stats.planLoop = best.planLoop ? best.planLoop.order.length : 0;
    return unavailable(best.fail.reason, best.fail.label);
  }




















  function liveSideOf(e) {
    if (e.viewRole === 'PLAN') return 'plan';
    if (e.viewRole === 'ELEVATION') return 'elev';
    if (e.viewRole === 'PROFILE') return 'profile';
    if (e.y > 0) return 'elev';
    if (e.y < 0) return 'plan';
    return 'datum';
  }











  function autoMembersForStrict(entities, profileFrame) {
    if (!Array.isArray(entities)) return entities;
    entities = Entities.withDeclaredMembers(entities);
    var AUTO_EPS = 1e-6;
    var out = [], i;
    for (i = 0; i < entities.length; i++) {
      var src = entities[i];
      if (!src) { out.push(src); continue; }
      var e = Object.assign({}, src);
      if (src.meta) {
        e.meta = Object.assign({}, src.meta);
        if (Array.isArray(src.meta.members)) {
          e.meta.members = src.meta.members.map(function (m) { return Object.assign({}, m); });
        }
      }
      out.push(e);
    }
    function isAuto(p) {
      if (p.meta && p.meta.membersDeclared === true) return false;
      var ms = p.meta && p.meta.members;
      if (!Array.isArray(ms) || ms.length === 0) return true;
      for (var j = 0; j < ms.length; j++) {
        if (!ms[j] || !/^point:/.test(String(ms[j].id))) return false;
      }
      return true;
    }
    function sideOf(p) {
      if (p.viewRole === 'ELEVATION') return 'elev';
      if (p.viewRole === 'PLAN') return 'plan';
      if (p.viewRole === 'PROFILE') return 'profile';
      if (p.viewRole === 'AUX') return '';
      if (p.y > 0) return 'elev';
      if (p.y < 0) return 'plan';
      return '';
    }
    function near(a, b) { return Math.abs(a - b) <= AUTO_EPS; }
    function observation(p, side) {
      if (side === 'plan') return { x: p.x, depth: -p.y };
      if (side === 'elev') return { x: p.x, height: p.y };
      if (side === 'profile' && profileFrame) {
        return { depth: profileFrame.dRef + profileFrame.s * (p.x - profileFrame.xRef), height: p.y };
      }
      return null;
    }
    var entries = [];
    for (i = 0; i < out.length; i++) {
      var p = out[i];
      if (!p || p.type !== 'POINT' || !isAuto(p)) continue;
      var specs = Entities.parseMembers(p.caption || p.name);
      if (!specs.length) continue;
      var pside = sideOf(p);
      entries.push({ p: p, specs: specs, side: pside, obs: observation(p, pside) });
    }
    var byBase = Object.create(null);
    entries.forEach(function (ent) {
      ent.specs.forEach(function (spec, idx) {
        var rec = { ent: ent, idx: idx, name: spec.name, side: ent.side, obs: ent.obs };
        (byBase[spec.name] || (byBase[spec.name] = [])).push(rec);
      });
    });
    function sharedAxis(a, b) {
      if ((a === 'plan' && b === 'elev') || (a === 'elev' && b === 'plan')) return 'x';
      if ((a === 'plan' && b === 'profile') || (a === 'profile' && b === 'plan')) return 'depth';
      if ((a === 'elev' && b === 'profile') || (a === 'profile' && b === 'elev')) return 'height';
      return null;
    }
    function compatible(a, b) {
      if (!a.obs || !b.obs || a.side === b.side) return false;
      var axis = sharedAxis(a.side, b.side);
      return !!axis && near(a.obs[axis], b.obs[axis]);
    }



    function uniqueMatch(rec, sameView, otherView) {
      var matches = otherView.filter(function (other) { return compatible(rec, other); });
      if (matches.length !== 1) return null;
      var mate = matches[0];
      var back = sameView.filter(function (other) { return compatible(other, mate); });
      return back.length === 1 ? mate : null;
    }
    function groupId(base, members) {
      var values = { x: null, height: null, depth: null }, conflict = false;
      members.forEach(function (rec) {
        Object.keys(values).forEach(function (axis) {
          if (!rec.obs || rec.obs[axis] === undefined) return;
          if (values[axis] !== null && !near(values[axis], rec.obs[axis])) conflict = true;
          else if (values[axis] === null) values[axis] = rec.obs[axis];
        });
      });
      if (conflict || values.x === null || values.height === null || values.depth === null) return null;
      function key(value) { return Math.round(value / AUTO_EPS); }



      if (!members.some(function (rec) { return rec.side === 'profile'; })) {
        return 'auto:' + base + ':' + key(values.x);
      }
      return 'auto:' + base + ':' + key(values.x) + ':' + key(values.height) + ':' + key(values.depth);
    }
    function assignGroup(base, members) {
      var id = groupId(base, members);
      if (!id) return;
      members.forEach(function (rec) { rec.ent.specs[rec.idx].id = id; });
    }
    Object.keys(byBase).forEach(function (base) {
      var list = byBase[base], bySide = { plan: [], elev: [], profile: [] };
      list.forEach(function (rec) { if (rec.obs && bySide[rec.side]) bySide[rec.side].push(rec); });
      var parent = list.map(function (_, idx) { return idx; });
      function rootOf(idx) {
        while (parent[idx] !== idx) { parent[idx] = parent[parent[idx]]; idx = parent[idx]; }
        return idx;
      }
      function join(a, b) {
        var ra = rootOf(list.indexOf(a)), rb = rootOf(list.indexOf(b));
        if (ra !== rb) parent[rb] = ra;
      }



      bySide.plan.forEach(function (rec) {
        var mate = uniqueMatch(rec, bySide.plan, bySide.elev);
        if (mate) join(rec, mate);
      });
      var byRoot = Object.create(null), groups = [];
      list.forEach(function (rec, idx) {
        if (!rec.obs) return;
        var root = rootOf(idx);
        if (!byRoot[root]) { byRoot[root] = []; groups.push(byRoot[root]); }
        byRoot[root].push(rec);
      });
      var profileGroups = groups.map(function (group) {
        return group.some(function (rec) { return rec.side === 'plan' || rec.side === 'elev'; });
      });



      var candidates = groups.map(function (group, gi) {
        if (!profileGroups[gi]) return [];
        return bySide.profile.filter(function (rec) {
          return group.every(function (mate) { return compatible(rec, mate); });
        });
      });
      var groupCount = bySide.profile.map(function (rec) {
        return groups.reduce(function (n, group, gi) {
          return n + (profileGroups[gi] && group.every(function (mate) { return compatible(rec, mate); }) ? 1 : 0);
        }, 0);
      });
      var attached = Object.create(null);
      groups.forEach(function (group, gi) {
        var profileCandidates = candidates[gi];
        if (!profileCandidates || profileCandidates.length !== 1) return;
        var profile = profileCandidates[0];
        if (groupCount[bySide.profile.indexOf(profile)] !== 1) return;
        assignGroup(base, group.concat([profile]));
        attached[gi] = true;
      });
      groups.forEach(function (group, gi) {
        if (attached[gi] || group.length < 2) return;
        assignGroup(base, group);
      });
    });
    var oldToNew = Object.create(null);
    entries.forEach(function (ent) {
      var oldMembers = ent.p.meta && Array.isArray(ent.p.meta.members) ? ent.p.meta.members : [];
      var members = [];
      ent.specs.forEach(function (spec, idx) {
        var id = spec.id || ('auto:' + ent.p.id + ':' + idx);
        members.push({ id: id, name: spec.name, hidden: !!spec.hidden });
        if (oldMembers[idx] && oldMembers[idx].id) oldToNew[oldMembers[idx].id] = id;
      });
      ent.p.meta = ent.p.meta || {};
      ent.p.meta.members = members;
    });
    var byId = Object.create(null);
    out.forEach(function (e) { if (e && typeof e.id === 'string') byId[e.id] = e; });
    out.forEach(function (e) {
      if (!e || !e.meta || e.type === 'POINT' || !Array.isArray(e.meta.refs)) return;
      if (Array.isArray(e.meta.endpointMemberIds)) {
        e.meta.endpointMemberIds = e.meta.endpointMemberIds.map(function (id) {
          return oldToNew[id] || id;
        });
        return;
      }
      var a = byId[e.meta.refs[0]], b = byId[e.meta.refs[1]];
      if (!a || !b || a.type !== 'POINT' || b.type !== 'POINT') return;
      var am = a.meta && Array.isArray(a.meta.members) ? a.meta.members : [];
      var bm = b.meta && Array.isArray(b.meta.members) ? b.meta.members : [];
      if (am.length === 1 && bm.length === 1) {
        e.meta.endpointMemberIds = [am[0].id, bm[0].id];
      }
    });
    return out;
  }





  function attachFrameAudit(result, list, registry, curveIssues) {
    if (!registry || !registry.hasAux) return result;
    var auditGeometry = result.geometry || { frameEvidence: result.frameEvidence };
    var frameAudit = ViewFrame.audit(list, auditGeometry, registry, (result.issues || []).concat(curveIssues || []));
    registry.issues.forEach(function (issue) {
      if (!frameAudit.issues.some(function (d) { return d.code === issue.code && d.entityId === issue.entityId; }))
        frameAudit.issues.push(issue);
    });
    if (frameAudit.issues.length) frameAudit.status = 'issues';
    result.issues = (result.issues || []).slice();
    registry.issues.concat(frameAudit.issues).forEach(function (issue) {
      if (!result.issues.some(function (d) { return d.code === issue.code && d.entityId === issue.entityId; }))
        result.issues.push(issue);
    });
    if (frameAudit.status === 'issues' && ['inferred', 'determined'].indexOf(result.determination) !== -1)
      result.determination = 'partial';
    result.frameAudit = frameAudit;
    result.viewFrames = registry.serialize();
    if (result.geometry) {
      result.geometry.viewFrames = result.viewFrames;
      result.geometry.frameAudit = frameAudit;
    }
    return result;
  }

  function reconstructParametric(list, opts, frameRegistry) {
    var declared=opts.identity==='explicit'||list.some(function(e){return e.meta&&e.meta.membersDeclared;});
    var resolved=Curves.resolveProfileFrame(list,opts),normalized=autoMembersForStrict(list,resolved.profile);



    if(declared) {
      var check=Strict.reconstruct(normalized.filter(function(e){return e.type!=='CURVE'&&!Curves.isCurve(e);}),
        Object.assign({},opts,{frames:frameRegistry}));
      if(check.determination==='inconsistent') {
        var straightRows=list.filter(function(e){return e.type!=='CURVE';});
        attachFrameAudit(check,straightRows,frameRegistry);
        check.pipeline={version:1,input:'vertices-edges-curves',identity:'explicit',stage:'correspondence',diagnostics:check.issues||[]};
        return check;
      }
    }
    var ink=list.filter(function(e){return e.type==='CURVE';}),refs=new Set(ink.flatMap(function(e){return (e.meta||{}).throughRefs||[];}));
    var needed=new Set(list.filter(function(e){return e.type!=='CURVE'&&e.type!=='POINT';}).flatMap(function(e){return (e.meta||{}).refs||[];}));
    var rest=list.filter(function(e){return e.type!=='CURVE'&&!(e.type==='POINT'&&refs.has(e.id)&&!needed.has(e.id));});
    var hasRest=rest.some(function(e){return ['POINT','SEGMENT','LINE','RAY','CIRCLE','CIRCULAR_ARC'].indexOf(e.type)!==-1;});
    var base=hasRest?reconstructCore(rest,opts,frameRegistry):{geometry:null,issues:[]};
    if(base.determination==='inconsistent') {
      attachFrameAudit(base,rest,frameRegistry);
      base.pipeline.diagnostics=base.issues;
      return base;
    }
    var lifted=ParametricReconstruct.reconstruct(normalized,resolved.profile,frameRegistry);
    var diagnostics=((base.pipeline||{}).diagnostics||base.issues||[]).concat(lifted.issues);
    if(resolved.issue)diagnostics.push(resolved.issue);
    var g=base.geometry;
    if(lifted.curves.length) {
      if(!g)g={name:'parametric curve preview',vertices:[],edges:[],faces:[],curves:[],surfacePatches:[],smoothSideFaces:[]};
      if(!g.curves)g.curves=[];
      lifted.curves.forEach(function(c){
        var samples=Parametric.tessellate(c,0.1),offset=g.vertices.length;
        if(c.closed)samples.pop();
        c.displayVertices=samples.map(function(s,i){g.vertices.push(s.point);return offset+i;});
        c.displayEdges=[];
        for(var i=0;i<samples.length-(c.closed?0:1);i++) {c.displayEdges.push(g.edges.length);g.edges.push([offset+i,offset+(i+1)%samples.length]);}
        g.curves.push(c);
      });
      g.surfacePatches = g.surfacePatches || [];
      g.smoothSideFaces = g.smoothSideFaces || [];
      var patches = ParametricReconstruct.inferPatches(g, normalized);
      diagnostics = diagnostics.filter(function (issue) {
        return !patches.sourceIds.has(issue.entityId) ||
          ['curve-surface-unresolved','curve-surface-missing','unresolved-edge'].indexOf(issue.code) === -1;
      }).concat(patches.diagnostics);
      g.profileMap=resolved.profile;g.topologyStatus=diagnostics.length?'partial':'inferred';
      var model=Surfaces.build(g);g.surfaces=model.surfaces;g.surfaceModel=model.summary;
      applyDisplaySync(g,model);
      if(opts.deferValidation){g.analyticSurfaceValidation={status:'pending',deferred:true,contract:'analytic-surface-v1'};
        g.analyticCertificate={status:'pending',deferred:true,contract:'analytic-surface-certificate-v1'};}
      else{g.analyticSurfaceValidation=Surfaces.validate(model,g);g.analyticCertificate=Surfaces.certify(model,g);
        g.surfaceModel.status=g.analyticSurfaceValidation.status;}
    }
    var parametricResult = attachFrameAudit({status:g?'ok':'unavailable',geometry:g,
      frameEvidence:base.frameEvidence,determination:diagnostics.length?'partial':'inferred',
      issues:diagnostics},list,frameRegistry,lifted.issues);
    diagnostics=parametricResult.issues;
    return mergeDisplaySyncResult(Object.assign(parametricResult,{
      reason:g?null:diagnostics.length?diagnostics[0].code:'curve-correspondence-missing',
      label:diagnostics.length?diagnostics[0].message:'Parametric curves reconstructed',
      pipeline:{version:1,input:'vertices-edges-curves',identity:declared?'explicit':'inferred',stage:'surface-inference',diagnostics:diagnostics}}));
  }

  function applyDisplaySync(geometry, model) {
    if (!geometry || !model || !Surfaces || !Surfaces.syncDisplayHoles) return null;
    var sync = Surfaces.syncDisplayHoles(model, geometry);
    geometry.displaySync = {status:sync && sync.diagnostics && sync.diagnostics.length ? 'issues' : 'ok',
      holes:sync && Number.isFinite(sync.holes) ? sync.holes : 0,
      diagnostics:sync && sync.diagnostics ? sync.diagnostics.slice() : []};
    return geometry.displaySync;
  }

  function displaySyncDiagnostics(geometry) {
    return geometry && geometry.displaySync && Array.isArray(geometry.displaySync.diagnostics) ?
      geometry.displaySync.diagnostics : [];
  }

  function appendDisplayDiagnostics(list, diagnostics) {
    (diagnostics || []).forEach(function (diagnostic) {
      if (!list.some(function (existing) {
        return existing && existing.code === diagnostic.code &&
          existing.surfaceId === diagnostic.surfaceId &&
          existing.curveIndex === diagnostic.curveIndex;
      })) list.push(diagnostic);
    });
    return list;
  }

  function attachDrawingSections(result, rows, opts) {
    if (!result || !result.geometry || !DrawingSections || !DrawingSections.analyze) return result;
    if (result.geometry.sections) return result;
    var model = null;
    try {
      model = DrawingSections.analyze(result.geometry, rows, {
        profile: result.geometry.profileMap,
        acceptAnalyticBoundary: !!(opts && opts.acceptAnalyticBoundary === true)
      });
    } catch (err) {
      model = {contract:'drawing-sections-v1', status:'unresolved', evidence:[], queries:[],
        retained:[], diagnostics:[{code:'section-analysis-failed', severity:'warning',
          message:'Drawing sections could not be analysed: ' + (err && err.message || err)}],
        summary:{planes:0, queries:0, retained:0, unresolved:0}};
    }
    if (!model || model.status === 'none') return result;
    result.geometry.sections = model;
    var issues = Array.isArray(result.issues) ? result.issues.slice() : [];
    (model.diagnostics || []).forEach(function (diagnostic) {
      if (!issues.some(function (existing) {
        return existing && existing.code === diagnostic.code &&
          existing.entityId === diagnostic.entityId &&
          existing.surfaceId === diagnostic.surfaceId;
      })) issues.push(diagnostic);
    });
    result.issues = issues;
    if (result.pipeline) result.pipeline.diagnostics = issues.slice();
    if (issues.length && result.determination !== 'inconsistent') {
      result.determination = 'partial';
      result.geometry.topologyStatus = 'partial';
      if (!result.label) result.label = 'Partial 3D preview: ' + issues[0].message;
    }
    return result;
  }

  function mergeDisplaySyncResult(result) {
    if (!result) return result;
    var sync = displaySyncDiagnostics(result.geometry);
    if (!sync.length) return result;
    var issues = Array.isArray(result.issues) ? result.issues.slice() : [];
    appendDisplayDiagnostics(issues, sync);
    result.issues = issues;
    if (result.status === 'ok' && result.determination !== 'inconsistent') {
      result.determination = 'partial';
      if (result.geometry) result.geometry.topologyStatus = 'partial';
      result.label = 'Partial 3D preview: ' + sync[0].message;
    }
    if (!result.pipeline) result.pipeline = {version:1, input:'vertices-edges-curves',
      identity:'inferred', stage:'surface-inference', diagnostics:[]};
    result.pipeline.diagnostics = appendDisplayDiagnostics(
      Array.isArray(result.pipeline.diagnostics) ? result.pipeline.diagnostics.slice() : [], sync);
    return result;
  }

  function validateSurfaces(geometry) {
    if (!geometry || !Surfaces) return null;
    var priorScope=geometry.analyticCertificate&&geometry.analyticCertificate.scope||
      geometry.analyticSurfaceValidation&&geometry.analyticSurfaceValidation.scope;
    var model = Surfaces.build(geometry);
    if (!model) return null;
    geometry.surfaces = model.surfaces;
    geometry.surfaceModel = model.summary;
    applyDisplaySync(geometry, model);
    geometry.analyticSurfaceValidation = Surfaces.validate(model, geometry);
    geometry.analyticCertificate = Surfaces.certify(model, geometry);
    if (geometry.analyticSurfaceValidation)
      geometry.surfaceModel.status = geometry.analyticSurfaceValidation.status;
    if (geometry.partialSubset||priorScope==='resolved-subset') {
      if (geometry.analyticSurfaceValidation) geometry.analyticSurfaceValidation.scope='resolved-subset';
      if (geometry.analyticCertificate) geometry.analyticCertificate.scope='resolved-subset';
    }
    return {model:model, validation:geometry.analyticSurfaceValidation,
      certificate:geometry.analyticCertificate};
  }
  function auditCorrespondence(entities, profileFrame) {
    try {
      var moduleRef = (typeof require === 'function' && typeof module !== 'undefined') ?
        require('./educad-correspondence.js') :
        (typeof window !== 'undefined' ? window.EduCADCorrespondence : null);
      return moduleRef ? moduleRef.analyze(entities, {profileFrame:profileFrame || null}) : null;
    } catch (err) {
      return null;
    }
  }
  function isConicSource(e) {
    return !!(e && e.meta && e.meta.ellipse);
  }
  function reconstructCore(entities, opts, deferredFrameRegistry) {
    opts = opts || {};
    var list = Array.isArray(entities) ? entities.filter(Boolean).map(function(e) {
      return Object.assign({}, e, { visible: true });
    }) : [];
    list = Entities.withDeclaredMembers(list);
    var frameRegistry = deferredFrameRegistry || ViewFrame.resolve(list,opts);
    if(list.some(function(e){return e.type==='CURVE';})) return reconstructParametric(list,opts,frameRegistry);
    var declared = opts.identity === 'explicit' || list.some(function(e) { return e.meta && e.meta.membersDeclared; });
    var topology = opts.topology || list.some(function(e) { return e.meta && e.meta.reconstructionTopology; });
    var curveInk = list.filter(function(e) {
      var meta = e.meta || {};
      return Curves.isCurve(e) && e.viewRole !== 'AUX' && meta.reconstructionRole !== 'construction' && !DROP_META[meta.kind];
    });
    var resolvedFrame = Curves.resolveProfileFrame(list,opts), frame=resolvedFrame.profile;
    var auxEntities = list.some(function (e) { return e && e.viewRole === 'AUX'; });
    var normalized = autoMembersForStrict(list, frame);




    function hasNamedProfileStations() {
      if (!frame) return false;
      var views = Object.create(null);
      list.forEach(function (ent) {
        if (!ent || ent.type !== 'POINT') return;
        var meta = ent.meta || {};
        if (meta.reconstructionRole === 'construction' || DROP_META[meta.kind]) return;
        var side = ent.viewRole === 'PROFILE' ? 'profile' :
          ent.viewRole === 'PLAN' ? 'plan' :
          ent.viewRole === 'ELEVATION' ? 'elev' : '';
        if (!side) return;
        Entities.parseMembers(ent.caption || ent.name).forEach(function (spec) {
          var rec = views[spec.name] || (views[spec.name] = { plan: false, elev: false, profile: false });
          rec[side] = true;
        });
      });
      return Object.keys(views).some(function (name) {
        return views[name].profile && (views[name].plan || views[name].elev);
      });
    }
    var profileBridge = !declared && frame && !resolvedFrame.inferred && hasNamedProfileStations();
    var auxBridge = !declared && auxEntities;
    function strictComponent(rows) {
      var result=reconstructStrict(rows,opts,frameRegistry);
      if(result.geometry&&frame)result.geometry.profileMap=frame;
      return result;
    }
    function resolvedSubset(rows) {
      var normalizedById=new Map(normalized.map(function(e) {return [e.id,e];}));
      var source=rows.map(function(e) {return normalizedById.get(e.id)||e;});
      function observation(e) {
        if(e.viewRole==='PLAN') return {plan:{x:e.x,z:-e.y}};
        if(e.viewRole==='ELEVATION') return {elev:{x:e.x,y:e.y}};
        if(e.viewRole==='PROFILE'&&frame) return {profile:{z:frame.dRef+frame.s*(e.x-frame.xRef),y:e.y}};
        return null;
      }
      var memberObs=new Map();
      source.forEach(function(e) {
        if(e.type!=='POINT') return;
        var obs=observation(e);
        if(!obs) return;
        ((e.meta||{}).members||[]).forEach(function(m) {
          if(!memberObs.has(m.id)) memberObs.set(m.id,{views:new Set()});
          Object.keys(obs).forEach(function(role) {memberObs.get(m.id).views.add(role);});
        });
      });
      var completeMembers=new Set();
      memberObs.forEach(function(rec,id) {
        var views=rec.views;
        if((views.has('plan')&&views.has('elev'))||
           (views.has('plan')&&views.has('profile'))||
           (views.has('elev')&&views.has('profile'))) completeMembers.add(id);
      });
      if(!completeMembers.size) return [];
      var points=new Map(),selectedByPoint=new Map();
      source.forEach(function(e) {
        if(e.type!=='POINT') return;
        var members=(e.meta||{}).members||[];
        var selected=members.filter(function(m) {return completeMembers.has(m.id);});
        if(!selected.length) return;
        var clone=Object.assign({},e,{meta:Object.assign({},e.meta,{members:selected})});
        points.set(e.id,clone);
        selectedByPoint.set(e.id,new Set(selected.map(function(m) {return m.id;})));
      });
      if(!points.size) return [];
      var kept=new Set();
      source.forEach(function(e) {
        if(e.type!=='SEGMENT'&&e.type!=='LINE'&&e.type!=='RAY') return;
        var refs=(e.meta||{}).endpointRefs||(e.meta||{}).refs||[];
        if(!refs.length||!refs.every(function(id) {return points.has(id);})) return;
        var endpointMembers=(e.meta||{}).endpointMemberIds;
        var okay=Array.isArray(endpointMembers)&&endpointMembers.length?
          endpointMembers.every(function(id) {return completeMembers.has(id);}):
          refs.every(function(id) {
            var selected=selectedByPoint.get(id);
            return selected&&selected.size>0;
          });
        if(!okay) return;
        kept.add(e.id);
      });
      source.forEach(function(e) {
        if(e.type==='DATUM_AXIS') {kept.add(e.id);}
      });
      points.forEach(function(p,id) {kept.add(id);});
      return source.map(function(e) {
        return points.get(e.id)||e;
      }).filter(function(e) {return kept.has(e.id);});
    }
    function straightComponent(rows) {
      if(declared || auxBridge || rows.some(function (row) {
        return row.type === 'DIMENSION' && row.meta && row.meta.dimensionAxis;
      })) {
        var strict=strictComponent(rows);
        if(strict.geometry||strict.determination!=='underdetermined') return strict;
        if(!declared) return strict;
        var subset=resolvedSubset(rows);
        if(subset.length) {
          var part=strictComponent(subset);
          if(part.geometry) {
            part.determination='partial';
            part.geometry.topologyStatus='partial';
            part.geometry.partialSubset=true;
            applySubsetScope(part.geometry);
            var retained={};
            (strict.issues||[]).forEach(function(d) {
              if(!retained[d.code]) {retained[d.code]=true;part.issues=(part.issues||[]).concat([d]);}
            });
            return part;
          }
          if(part.determination==='inconsistent') return part;
        }
        return strict;
      }
      if(!profileBridge) return liveCore(rows,opts.eps===undefined?MATCH_EPS_MM:opts.eps);




      var normalizedRows=autoMembersForStrict(rows,frame),views=new Map();
      var exactCheck=Strict.reconstruct(normalizedRows,opts);
      if(exactCheck.determination==='inconsistent')return exactCheck;
      normalizedRows.forEach(function(e) {
        if(e.type!=='POINT'||!['PLAN','ELEVATION','PROFILE'].includes(e.viewRole))return;
        ((e.meta||{}).members||[]).forEach(function(m) {
          if(!views.has(m.id))views.set(m.id,new Set());
          views.get(m.id).add(e.viewRole);
        });
      });
      var known=new Set(Array.from(views).filter(function(entry){return entry[1].size>=2;}).map(function(entry){return entry[0];}));
      if(!known.size)return strictComponent(rows);
      var kept=new Set(),filtered=normalizedRows.filter(function(e) {
        if(e.type!=='POINT')return true;
        var found=((e.meta||{}).members||[]).some(function(m){return known.has(m.id);});
        if(found)kept.add(e.id);
        return found;
      }).filter(function(e) {
        var refs=(e.meta||{}).endpointRefs||(e.meta||{}).refs;
        return e.type!=='SEGMENT'||!Array.isArray(refs)||refs.every(function(id){return kept.has(id);});
      }).map(function(e) {
        return e.type==='POINT'?Object.assign({},e,{meta:Object.assign({},e.meta,{members:e.meta.members.filter(function(m){return known.has(m.id);})})}):e;
      });
      return strictComponent(filtered);
    }
    function visibilityProvider(curveIds) {
      var excluded=new Set(curveIds), pending=true, occluder=null;
      return function classify(point,role) {
        var projector=getProject();
        if(!projector || !projector.pointHidden) return null;
        if(pending) {
          pending=false;
          var refs=new Set(),needed=new Set();
          normalized.forEach(function(e) {
            ((e.meta || {}).endpointRefs || (e.meta || {}).refs || []).forEach(function(id) {
              (excluded.has(e.id)?refs:needed).add(id);
            });
          });
          var rows=normalized.filter(function(e) {return !excluded.has(e.id) && !Curves.isCurve(e) && !isConicSource(e) && !(refs.has(e.id) && !needed.has(e.id));});
          var result=straightComponent(rows);
          if(result.geometry && result.geometry.faces.length) {occluder=result.geometry;classify.sourceIds=rows.map(function(e) {return e.id;});}
        }
        if(!occluder) return null;
        var view=role==='PLAN'?'top':role==='ELEVATION'?'front':frame && frame.s===-1?'right':'left';
        return projector.pointHidden(occluder,point,view);
      };
    }
    var toroidal = Curves.inferToroidalSurfaces(curveInk.length ? normalized : [], frame);
    var curveRows = toroidal.consumedIds.size ? normalized.filter(function (e) {
      return !toroidal.consumedIds.has(e.id);
    }) : normalized;
    var conic = Conic && Conic.lift ? Conic.lift(curveRows,
      {profile:frame,frameRegistry:frameRegistry,visibilityProvider:visibilityProvider}) :
      {curves:[],consumedIds:[],pointIds:[],issues:[],groups:[],usedGroups:[]};
    var conicIssues = (conic.issues || []).slice();
    var lineLift = Conic && Conic.liftLine ? Conic.liftLine(curveRows,
      {profile:frame,frameRegistry:frameRegistry,groups:conic.groups,usedGroups:conic.usedGroups || []}) :
      {curves:[],consumedIds:[],issues:[],usedGroups:[],consideredGroups:[]};
    var lineConsidered = new Set(lineLift.consideredGroups || []), lineSegIds = new Set();
    var lineConsumed = new Set(lineLift.consumedIds || []);
    (conic.groups || []).forEach(function(g) {
      if(lineConsidered.has(g.id)) g.segmentIds.forEach(function(id) {lineSegIds.add(id);});
    });
    conicIssues = conicIssues.filter(function(issue) {
      return !lineConsumed.has(issue.entityId) && !(lineSegIds.has(issue.entityId) &&
        ['conic-projection-missing','conic-lift-ambiguous','conic-third-view-conflict',
          'conic-point-conflict'].indexOf(issue.code) !== -1);
    });
    var analyticCurves = (conic.curves || []).concat(lineLift.curves || []);
    var analyticIds = new Set((conic.consumedIds || []).concat(lineLift.consumedIds || []));
    var exactGroupSegments = new Set();
    (conic.groups || []).forEach(function(g) {
      g.segmentIds.forEach(function(id) {
        if (!g.nativePrincipal || analyticIds.has(id)) exactGroupSegments.add(id);
      });
    });
    var analyticIssues = conicIssues.concat(lineLift.issues || []);
    var blockedSegments = new Set(exactGroupSegments);
    (lineLift.consumedIds || []).forEach(function(id) {blockedSegments.add(id);});
    var oblique = Oblique && Oblique.reconstruct ?
      Oblique.reconstruct(curveRows.filter(function(e) {return !blockedSegments.has(e.id);}),
        {profile:frame,visibilityProvider:visibilityProvider}) :
      {curves:[],consumedIds:[],issues:[]};
    if(resolvedFrame.issue && (oblique.curves.length || oblique.issues.length || analyticCurves.length))
      oblique.issues.unshift(resolvedFrame.issue);
    var obliqueIds = new Set(oblique.consumedIds);
    analyticIds.forEach(function(id) {obliqueIds.add(id);});
    function applySubsetScope(g) {
      if (!g || !g.partialSubset) return g;
      if (g.analyticSurfaceValidation) g.analyticSurfaceValidation.scope = 'resolved-subset';
      if (g.analyticCertificate) g.analyticCertificate.scope = 'resolved-subset';
      return g;
    }
    function finalizeThroughCavities(g) {
      var exitDiagnostics=[];
      if(!g||!Array.isArray(g.recesses)||!g.recesses.length) return exitDiagnostics;
      var vertices=g.vertices||[];
      function vsub(a,b) {return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};}
      function vdot(a,b) {return a.x*b.x+a.y*b.y+a.z*b.z;}
      function vcross(a,b) {return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
      function vlen(a) {return Math.hypot(a.x,a.y,a.z);}
      function vunit(a) {var l=vlen(a);return l>1e-12?{x:a.x/l,y:a.y/l,z:a.z/l}:null;}
      function basisFromAxis(axis) {
        var n=vunit(axis);
        if(!n) return null;
        var ref=Math.abs(n.x)<0.9?{x:1,y:0,z:0}:{x:0,y:1,z:0};
        var u=vunit(vcross(n,ref));
        if(!u) return null;
        var v=vunit(vcross(n,u));
        return v?{u:u,v:v}:null;
      }
      function hostFaces() {
        return (g.surfacePatches||[]).filter(function(p) {
          return p&&p.kind==='plane'&&Array.isArray(p.outer)&&p.outer.length>=3&&
            !p.recess&&!p.recessMouth&&!p.recessBottom;
        });
      }
      function circleFor(record,volume) {
        if(Number.isInteger(record.bottomCurve)) {
          var curve=g.curves&&g.curves[record.bottomCurve];
          if(curve&&Number.isFinite(curve.radius)&&curve.radius>0&&
              curve.u&&curve.v) return curve;
        }
        if(!volume||volume.kind!=='cone'||!(volume.bottomRadius>0)) return null;
        var basis=basisFromAxis(volume.axis);
        if(!basis) return null;
        var center=volume.bottomCenter;
        if(!center) {
          var axis=vunit(volume.axis);
          if(!axis||!Number.isFinite(volume.depth)) return null;
          center={x:volume.origin.x+axis.x*volume.depth,
            y:volume.origin.y+axis.y*volume.depth,
            z:volume.origin.z+axis.z*volume.depth};
        }
        return {kind:'circle',center:center,u:basis.u,v:basis.v,
          radius:volume.bottomRadius,startAngle:0,sweepAngle:2*Math.PI};
      }
      function faceContains(circle,face) {
        if(typeof Surfaces.circleInPlanarFace!=='function') return false;
        var result=Surfaces.circleInPlanarFace(face,circle,vertices);
        return !!(result&&result.contained);
      }
      function sourceEntity(record) {
        return (record.sourceIds||[])[0];
      }
      g.recesses.forEach(function(record) {
        if(record.kind!=='conical'||record.throughCandidate!==true) return;
        var volume=Number.isInteger(record.volumeIndex)?(g.cavityVolumes||[])[record.volumeIndex]:null;
        var circle=circleFor(record,volume);
        var host=circle?hostFaces().find(function(face) {return faceContains(circle,face);}):null;
        if(host) {
          record.through=true;
          record.throughConfirmed=true;
          record.throughCandidate=true;
          record.throughHostSource=host.sourceIds||null;
          if(volume){volume.through=true;volume.throughCandidate=true;volume.openBottom=true;}
          return;
        }
        var grouped=volume&&volume.group!==null&&volume.group!==undefined;
        var floorEvidence=record.floorEvidence||
          (record.bottomClosure==='open'?'open':record.bottomClosure==='apex'?'apex':'plane');
        if(!grouped&&floorEvidence==='plane'&&Number.isInteger(record.bottomCurve)) {
          var curve=g.curves[record.bottomCurve];
          var faceIndex=g.faces.length;
          g.faces.push(curve.displayVertices.slice());
          record.through=false;
          record.throughCandidate=false;
          record.bottomClosure='plane';
          delete record.throughConfirmed;
          curve.recessMouth=undefined;
          curve.throughOpening=undefined;
          curve.recessBottom=true;
          g.surfacePatches=(g.surfacePatches||[]).filter(function(p) {
            return !(p&&p.throughOpening===true&&Array.isArray(p.boundaryCurves)&&
              p.boundaryCurves.indexOf(record.bottomCurve)!==-1);
          });
          g.surfacePatches.push({kind:'plane',boundaryCurves:[record.bottomCurve],
            faceIndices:[faceIndex],closure:'recess-bottom',recessBottom:true,
            sourceIds:(record.sourceIds||[]).slice(),volumeIndex:record.volumeIndex,
            memberRole:'bottom'});
          if(volume){volume.through=false;volume.throughCandidate=false;volume.openBottom=false;}
          if(Array.isArray(g.faceHoles))
            while(g.faceHoles.length<g.faces.length) g.faceHoles.push([]);
          return;
        }
        record.through=false;
        record.throughCandidate=false;
        record.bottomClosure=floorEvidence==='open'?'open':'unresolved';
        record.exitUnresolved=true;
        delete record.throughConfirmed;
        if(volume){volume.through=false;volume.throughCandidate=false;volume.openBottom=true;}
        if(Number.isInteger(record.bottomCurve)) {
          var openCurve=g.curves[record.bottomCurve];
          if(openCurve) {
            openCurve.recessMouth=undefined;
            openCurve.throughOpening=undefined;
            openCurve.recessBottom=true;
          }
        }
        if(!grouped) {
          g.surfacePatches=(g.surfacePatches||[]).filter(function(p) {
            return !(p&&p.throughOpening===true&&Array.isArray(p.boundaryCurves)&&
              p.boundaryCurves.indexOf(record.bottomCurve)!==-1);
          });
        }
        exitDiagnostics.push({code:'recess-exit-unresolved',entityId:sourceEntity(record),
          message:'The taper bottom has host-silhouette evidence but no reconstructed host face contains the exit circle; the opening is retained without a fabricated floor.'});
      });
      return exitDiagnostics;
    }

    function attachSurfaceModel(g) {
      if (!g || g.surfaceModel || !Surfaces || !Surfaces.build) return applySubsetScope(g);
      var model = Surfaces.build(g);
      if (model) {
        g.surfaces = model.surfaces;
        g.surfaceModel = model.summary;
        applyDisplaySync(g, model);
        if (opts.deferValidation) {
          g.analyticSurfaceValidation = {status:'pending', deferred:true,
            contract:'analytic-surface-v1'};
          g.analyticCertificate = {status:'pending', deferred:true,
            contract:'analytic-surface-certificate-v1'};
          return applySubsetScope(g);
        }
        g.analyticSurfaceValidation = Surfaces.validate(model, g);
        g.analyticCertificate = Surfaces.certify(model, g);
        if (g.analyticSurfaceValidation) g.surfaceModel.status = g.analyticSurfaceValidation.status;
        applySubsetScope(g);
      }
      return g;
    }
    function finish(result, stage, diagnostics) {
      if (frameRegistry.hasAux && !deferredFrameRegistry) {
        attachFrameAudit(result,list,frameRegistry);
        diagnostics = (result.issues || []).slice();
      }
      result.pipeline = { version: 1, input: 'vertices-edges-curves', identity: declared ? 'explicit' : 'inferred',
        stage: stage, diagnostics: (diagnostics || result.issues || []).slice() };
      mergeDisplaySyncResult(result);
      if (!result.determination) result.determination = result.status === 'ok' ? 'inferred' : 'underdetermined';
      if (result.status === 'ok' && !result.label) result.label = result.issues.length ?
        'Partial 3D preview: ' + result.issues[0].message : 'Geometry reconstructed from drawing primitives';
      if (opts && opts.correspondence === 'audit')
        result.correspondence = auditCorrespondence(list,
          result.geometry && result.geometry.profileMap);
      return result;
    }
    function unmatchedPoints(g, exempt) {
      if (!g) return [];
      var profile=g.profileMap;
      return list.filter(function(e) {
        var m=e.meta || {};
        if(e.type!=='POINT' || exempt && exempt.has(e.id) || m.reconstructionRole==='construction' || DROP_META[m.kind]) return false;
        if(e.viewRole==='AUX') return false;
        if(e.viewRole!=='PLAN' && e.viewRole!=='ELEVATION' && e.viewRole!=='PROFILE') return false;
        if(e.viewRole==='PROFILE' && !profile) return false;
        return !g.vertices.some(function(v) {
          if(e.viewRole==='PROFILE') return Math.abs(profile.xRef+profile.s*(v.z-profile.dRef)-e.x)<=MATCH_EPS_MM && Math.abs(v.y-e.y)<=MATCH_EPS_MM;
          return Math.abs(v.x-e.x)<=MATCH_EPS_MM && Math.abs((e.viewRole==='PLAN'?-v.z:v.y)-e.y)<=MATCH_EPS_MM;
        });
      }).map(function(e) {return {code:'point-correspondence-missing',entityId:e.id,message:'This point has no reconstructed correspondence; add or link its observation in another view.'};});
    }
    var SILHOUETTE_STROKE_TOL = 0.05;
    function silhouetteStrokeEvidence(g, rows, usedSet) {
      if (!g || !Surfaces || !Surfaces.build || !Surfaces.silhouettes) return [];
      function eligiblePatch(patch) {
        return !!(patch && (patch.kind === 'cylinder' || patch.kind === 'cone') &&
          !patch.recess && !patch.recessMouth && !patch.throughOpening &&
          !patch.recessBottom && !patch.approximateTrim && !patch.displayOnlyBoundary &&
          patch.booleanDomain === undefined && patch.volumeIndex === undefined);
      }
      if (!(g.surfacePatches || []).some(eligiblePatch)) return [];
      var byId = Object.create(null);
      rows.forEach(function(e) { if (e && typeof e.id === 'string') byId[e.id] = e; });
      function declaredStroke(e) {
        var m = e.meta || {};
        if (Array.isArray(m.endpointMemberIds) &&
            m.endpointMemberIds.some(function(id) {
              return id !== null && id !== undefined && id !== '';
            })) return true;
        if (Array.isArray(m.endpointMembers) &&
            m.endpointMembers.some(function(id) {return id !== null && id !== undefined && id !== '';})) return true;
        var refs = m.endpointRefs || m.refs || [];
        return refs.some(function(id) {
          var point = byId[id];
          return !!(point && point.meta && point.meta.membersDeclared === true);
        });
      }
      var byRole = {PLAN:[], ELEVATION:[], PROFILE:[]};
      rows.forEach(function(e) {
        if (e.type !== 'SEGMENT' || usedSet.has(e.id)) return;
        var m = e.meta || {};
        if (m.reconstructionRole === 'construction' || DROP_META[m.kind]) return;
        if (['G','H','K'].indexOf(e.bisCode) !== -1) return;
        if (!Object.prototype.hasOwnProperty.call(byRole,e.viewRole)) return;
        if (e.viewRole === 'PROFILE' && !frame) return;
        if (declaredStroke(e)) return;
        var dx = e.x2-e.x, dy = e.y2-e.y;
        if (![e.x,e.y,dx,dy].every(Number.isFinite) || Math.hypot(dx,dy) <= 1e-9) return;
        byRole[e.viewRole].push(e);
      });
      var roles = Object.keys(byRole).filter(function(role) {return byRole[role].length;});
      if (!roles.length) return [];
      var model = Surfaces.build(g,{cavityTrims:false});
      if (!model || !model.surfaces.length) return [];
      var surfaceById = new Map();
      model.surfaces.forEach(function(s) {
        if (!s || (s.kind !== 'cylinder' && s.kind !== 'cone')) return;
        if (s.closed === true || !Array.isArray(s.loops) || !s.loops.length) return;
        if (s.recess || s.recessMouth || s.throughOpening || s.volumeIndex !== undefined ||
            s.unionGroup !== undefined || s.memberRole || s.approximateBoundary ||
            s.displayOnlyBoundary || s.booleanDomain !== undefined) return;
        var patch = (g.surfacePatches || [])[s.patchIndex];
        if (!eligiblePatch(patch)) return;
        var finite = function(p) {
          return !!p && [p.x,p.y,p.z].every(Number.isFinite);
        };
        if (s.kind === 'cylinder') {
          if (!finite(s.origin) || !finite(s.axis) || !(s.radius > 0)) return;
        } else if (!finite(s.axis) || !(s.halfAngle > 0) ||
            !(s.halfAngle < Math.PI/2) || !finite(s.apex || s.origin)) return;
        surfaceById.set(s.id, s);
      });
      var supported = Array.from(surfaceById.values());
      if (!supported.length) return [];
      function project(p,role) {
        if (!p) return null;
        if (role === 'PLAN') return {x:p.x, y:-p.z};
        if (role === 'ELEVATION') return {x:p.x, y:p.y};
        if (role === 'PROFILE' && frame)
          return {x:frame.xRef + frame.s*(p.z-frame.dRef), y:p.y};
        return null;
      }
      function viewName(role) {
        if (role === 'PLAN') return 'top';
        if (role === 'ELEVATION') return 'front';
        return frame.s < 0 ? 'left' : 'right';
      }
      var accepted = [];
      roles.forEach(function(role) {
        var result = Surfaces.silhouettes({surfaces:supported},viewName(role),g);
        var groups = new Map();
        (result.curves || []).forEach(function(c) {
          if (c.kind !== 'line' || !c.start || !c.end) return;
          var surface = surfaceById.get(c.surfaceId);
          if (!surface) return;
          var a = project(c.start,role), b = project(c.end,role);
          if (!a || !b) return;
          var dx = b.x-a.x, dy = b.y-a.y, len = Math.hypot(dx,dy);
          if (!(len > 1e-9)) return;
          if (!groups.has(surface.id)) groups.set(surface.id,[]);
          groups.get(surface.id).push({surface:surface, a:a, b:b, curve:c});
        });
        if (!groups.size) return;
        byRole[role].forEach(function(e) {
          var dx = e.x2-e.x, dy = e.y2-e.y, len = Math.hypot(dx,dy);
          if (!(len > 1e-9)) return;
          var tol = Math.min(SILHOUETTE_STROKE_TOL, Math.max(1e-6, len * 0.01));
          var ux = dx/len, uy = dy/len, matches = [];
          groups.forEach(function(lines) {
            var spans = [];
            lines.forEach(function(line) {
              var d1 = Math.abs((line.a.x-e.x)*uy-(line.a.y-e.y)*ux);
              var d2 = Math.abs((line.b.x-e.x)*uy-(line.b.y-e.y)*ux);
              if (d1 > SILHOUETTE_STROKE_TOL || d2 > SILHOUETTE_STROKE_TOL) return;
              var t1 = (line.a.x-e.x)*ux + (line.a.y-e.y)*uy;
              var t2 = (line.b.x-e.x)*ux + (line.b.y-e.y)*uy;
              var sa = Math.min(t1,t2), sb = Math.max(t1,t2);
              if (sb < -tol || sa > len + tol) return;
              spans.push({line:line, a:sa, b:sb});
            });
            if (!spans.length) return;
            spans.sort(function(a,b) {return a.a-b.a;});
            if (spans[0].a > tol) return;
            var reach = spans[0].b, usedSpans = [spans[0]];
            for (var i=1;i<spans.length;i++) {
              if (spans[i].a > reach + tol) break;
              reach = Math.max(reach,spans[i].b);
              usedSpans.push(spans[i]);
            }
            if (reach < len - tol) return;
            matches.push({surface:lines[0].surface, spans:usedSpans});
          });
          if (matches.length !== 1) return;
          var match = matches[0];
          var evidence = {
            entityId:e.id,
            evidence:'analytic-silhouette',
            evidenceKind:'silhouette',
            viewRole:role,
            patchIndex:match.surface.patchIndex,
            surfaceId:match.surface.id,
            surfaceKind:match.surface.kind,
            sourceIds:(match.surface.sourceIds || []).slice(),
            bounded:true,
            physicalEdge:false,
            certified:false,
            viewStart:{x:e.x,y:e.y},
            viewEnd:{x:e.x2,y:e.y2},
            surface:match.surface.kind === 'cylinder' ?
              {kind:'cylinder',origin:match.surface.origin,axis:match.surface.axis,
                radius:match.surface.radius} :
              {kind:'cone',apex:match.surface.apex || match.surface.origin,
                axis:match.surface.axis,halfAngle:match.surface.halfAngle},
            silhouetteSegments:match.spans.map(function(span) {
              return {start:span.line.curve.start, end:span.line.curve.end};
            })
          };
          accepted.push(evidence);
        });
      });
      return accepted;
    }
    var JUNCTION_STROKE_TOL = 0.05;
    function crossingCylinderJunctionEvidence(g, rows, usedSet) {
      if (!g || !Surfaces || !Surfaces.build ||
          !Surfaces.crossingCylinderCandidates || !Surfaces.point) return [];
      var model = Surfaces.build(g,{cavityTrims:false});
      var candidates = Surfaces.crossingCylinderCandidates(model,g);
      if (!candidates.length) return [];
      var byRole = {PLAN:[], ELEVATION:[]};
      rows.forEach(function(e) {
        if (e.type !== 'SEGMENT' || usedSet.has(e.id)) return;
        var m = e.meta || {};
        if (m.reconstructionRole === 'construction' || DROP_META[m.kind]) return;
        if (e.bisCode === 'E' || e.hidden === true) return;
        if (['G','H','K'].indexOf(e.bisCode) !== -1) return;
        if (!Object.prototype.hasOwnProperty.call(byRole,e.viewRole)) return;
        var dx = e.x2-e.x, dy = e.y2-e.y;
        if (![e.x,e.y,dx,dy].every(Number.isFinite) || Math.hypot(dx,dy) <= 1e-9) return;
        byRole[e.viewRole].push(e);
      });
      if (!byRole.PLAN.length && !byRole.ELEVATION.length) return [];
      function projected(p, role) {
        if (!p) return null;
        if (role === 'PLAN') return {x:p.x, y:-p.z};
        if (role === 'ELEVATION') return {x:p.x, y:p.y};
        return null;
      }
      function segmentDistance(p, e) {
        var dx = e.x2-e.x, dy = e.y2-e.y, len2 = dx*dx+dy*dy;
        if (!(len2 > 1e-18)) return Math.hypot(p.x-e.x,p.y-e.y);
        var t = ((p.x-e.x)*dx + (p.y-e.y)*dy) / len2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x-(e.x+t*dx), p.y-(e.y+t*dy));
      }
      function polylineDistance(p, points) {
        var best = Infinity;
        for (var i = 0; i < points.length; i++) {
          var a = points[i], b = points[(i + 1) % points.length];
          var dx = b.x-a.x, dy = b.y-a.y, len2 = dx*dx+dy*dy;
          var t = len2 > 1e-18 ?
            ((p.x-a.x)*dx + (p.y-a.y)*dy) / len2 : 0;
          t = Math.max(0, Math.min(1, t));
          best = Math.min(best, Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy)));
        }
        return best;
      }
      var accepted = [];
      candidates.forEach(function(candidate) {
        var views = [], matched = new Set();
        var tolerance = JUNCTION_STROKE_TOL;
        function alignedView(role) {
          var direction = role === 'PLAN' ? {x:0,y:1,z:0} :
            role === 'ELEVATION' ? {x:0,y:0,z:1} : null;
          if (!direction) return true;
          var axes = [candidate.curve.v, candidate.curve.direction];
          return axes.some(function (axis) {
            if (!axis) return false;
            var lengthAxis = Math.hypot(axis.x, axis.y, axis.z);
            if (!(lengthAxis > 0)) return false;
            return Math.abs((axis.x*direction.x + axis.y*direction.y +
              axis.z*direction.z) / lengthAxis) > 1 - 1e-7;
          });
        }
        ['PLAN','ELEVATION'].forEach(function(role) {
          if (alignedView(role)) return;
          var strokes = byRole[role];
          if (!strokes.length) return;
          var seamPoints = [];
          for (var s = 0; s < 256; s++) {
            var seamPoint = Surfaces.point(candidate.curve, 2 * Math.PI * s / 256);
            var seamView = projected(seamPoint, role);
            if (seamView) seamPoints.push(seamView);
          }
          if (seamPoints.length < 3) return;
          var valid = strokes.filter(function(e) {
            for (var k = 0; k <= 4; k++) {
              var t = k / 4;
              var p = {x:e.x+(e.x2-e.x)*t, y:e.y+(e.y2-e.y)*t};
              if (polylineDistance(p, seamPoints) > tolerance) return false;
            }
            return true;
          });
          if (!valid.length) return;
          var total = 128, covered = 0;
          for (var i = 0; i < total; i++) {
            var p = Surfaces.point(candidate.curve, 2 * Math.PI * i / total);
            var q = projected(p, role);
            if (!q) continue;
            var bestDistance = Infinity;
            valid.forEach(function(e) {
              bestDistance = Math.min(bestDistance, segmentDistance(q, e));
            });
            if (bestDistance <= JUNCTION_STROKE_TOL) covered++;
          }
          if (covered / total < 0.95) return;
          views.push(role);
          valid.forEach(function(e) {matched.add(e.id);});
        });
        if (!views.length) return;
        var strokeIds = Array.from(matched).sort();
        accepted.push({contract:'analytic-solid-junction-evidence-v1',
          largerPatch:candidate.largerPatch, smallerPatch:candidate.smallerPatch,
          largerSurfaceId:candidate.largerSurfaceId,
          smallerSurfaceId:candidate.smallerSurfaceId,
          largerCapCurves:candidate.largerCapCurves.slice(),
          smallerMouthCurve:candidate.smallerMouthCurve,
          smallerBuriedCurve:candidate.smallerBuriedCurve,
          curve:candidate.curve,
          sourceIds:Array.from(new Set(candidate.sourceIds.concat(strokeIds))),
          views:views, strokeIds:strokeIds});
      });
      return accepted;
    }
    if (topology) return finish(reconstructStrict(list,opts,frameRegistry), 'declared-topology');
    if (!curveInk.length && !oblique.curves.length && !analyticCurves.length) {
      var straight = straightComponent(list.filter(function(e) {
        return e.type !== 'CIRCLE' || e.viewRole !== 'AUX' || !exactGroupSegments.has(e.id);
      }));
      var missing=unmatchedPoints(straight.geometry).concat(oblique.issues, analyticIssues);
      if(missing.length && straight.geometry) {straight.determination='partial';straight.geometry.topologyStatus='partial';}
      if((oblique.issues.length || analyticIssues.length) && !straight.geometry && straight.determination!=='inconsistent') {
        var firstIssue=oblique.issues[0] || analyticIssues[0];
        straight.reason=firstIssue.code;
        straight.label=firstIssue.message;
        if (frameRegistry.hasAux && analyticIssues.length)
          straight.issues=(straight.issues || []).filter(function(issue) {return issue.code!=='empty-model';});
      }
      var straightValidation=validateInferredSurfaces(straight.geometry);
      if(straightValidation) straight.geometry.surfaceValidation=straightValidation;
      attachSurfaceModel(straight.geometry);
      straight.issues=missing.concat(straight.issues || []);
      return finish(straight, 'surface-inference',straight.issues);
    }
    if (declared) {



      var check = Strict.reconstruct(normalized.filter(function(e) { return !Curves.isCurve(e) && !isConicSource(e); }),opts);
      if (check.determination === 'inconsistent') return finish(check,'correspondence',check.issues || []);
    }
    var lifted = curveInk.length ? Curves.reconstruct(normalized.filter(function(e) {
      return e.viewRole !== 'AUX' && !(e.type === 'CIRCLE' && analyticIds.has(e.id));
    }),
      Object.assign({}, opts, {toroidal:toroidal})) : {geometry:null,issues:[],consumedIds:[]};
    var geometry = lifted.geometry;
    var diagnostics = lifted.issues.filter(function(d) {return !d.entityId || !obliqueIds.has(d.entityId);})
      .concat(oblique.issues, analyticIssues);
    diagnostics=diagnostics.filter(function(d,i,all) {
      return all.findIndex(function(p) {return p.code===d.code && p.entityId===d.entityId;})===i;
    });
    var used = new Set(lifted.consumedIds);
    oblique.consumedIds.forEach(function(id) {used.add(id);});
    exactGroupSegments.forEach(function(id) {used.add(id);});
    analyticIds.forEach(function(id) {used.add(id);});
    if (analyticCurves.length || oblique.curves.length) {
      if (!geometry) geometry = {name:'primitive surface',vertices:[],edges:[],faces:[],curves:[],spheres:[],surfacePatches:[],smoothSideFaces:[]};
      geometry.profileMap=frame;
      if(resolvedFrame.inferred && frame) geometry.profileInferred=true;
      analyticCurves.concat(oblique.curves).forEach(function(c) {
        var closed=c.kind==='circle'||c.kind==='ellipse'||c.closed===true;
        var n=closed?24:Math.max(2,Math.ceil(24*c.sweepAngle/(2*Math.PI)-1e-7)), vo=geometry.vertices.length;
        c.displayVertices=[]; c.displayEdges=[];
        for (var i=0;i<(closed?n:n+1);i++) {
          geometry.vertices.push(Curves.point(c, c.startAngle+c.sweepAngle*i/n));
          c.displayVertices.push(vo+i);
        }
        for (var j=0;j<n;j++) {
          c.displayEdges.push(geometry.edges.length);
          geometry.edges.push([vo+j,closed?vo+(j+1)%n:vo+j+1]);
        }
        geometry.curves.push(c);
      });
    }
    if (geometry) {
      geometry.reservedConicIds = Array.from(exactGroupSegments);
      geometry.consumedConicIds = Array.from(analyticIds);
    }



    if (geometry && geometry.curves.some(function(c) {return c.oblique;}) && Curves.inferBoundedCones) {
      var cones = Curves.inferBoundedCones(geometry,normalized,frame);
      cones.consumedIds.forEach(function(id) {used.add(id);});
      diagnostics = diagnostics.concat(cones.issues);
      diagnostics = diagnostics.filter(function(d,i,all) {
        return all.findIndex(function(p) {return p.code===d.code && p.entityId===d.entityId;})===i;
      });
    }
    if (geometry && SurfaceInfer && SurfaceInfer.infer) {
      var inferredSurfaces = SurfaceInfer.infer(geometry,normalized,frame,{used:used});
      inferredSurfaces.consumedIds.forEach(function(id) {used.add(id);});
      var inferredIds = new Set(inferredSurfaces.resolvedIds || []);
      diagnostics = diagnostics.filter(function(d) {
        return !(d.entityId && inferredIds.has(d.entityId) &&
          ['unresolved-edge','curve-inclined-arc-unsupported'].indexOf(d.code) !== -1);
      });
      diagnostics = diagnostics.concat(inferredSurfaces.issues || []);
    }
    var silhouetteMatch = silhouetteStrokeEvidence(geometry,list,used);
    if (silhouetteMatch.length) {
      var silhouetteIds = new Set();
      silhouetteMatch.forEach(function(evidence) {
        used.add(evidence.entityId);
        silhouetteIds.add(evidence.entityId);
      });
      diagnostics = diagnostics.filter(function(d) {
        return !(d.code === 'unresolved-edge' && silhouetteIds.has(d.entityId));
      });
      geometry.silhouetteEvidence = (geometry.silhouetteEvidence || [])
        .concat(silhouetteMatch);
    }
    var crossingEvidence = crossingCylinderJunctionEvidence(geometry,list,used);
    if (crossingEvidence.length) {
      var crossingIds = new Set();
      crossingEvidence.forEach(function(evidence) {
        (evidence.strokeIds || []).forEach(function(id) {
          used.add(id);
          crossingIds.add(id);
        });
      });
      diagnostics = diagnostics.filter(function(d) {
        return !(d.code === 'unresolved-edge' && crossingIds.has(d.entityId));
      });
      geometry.cylinderJunctionEvidence = (geometry.cylinderJunctionEvidence || [])
        .concat(crossingEvidence);
    }
    var consumedPoints = new Set((oblique.pointIds || []).concat(conic.pointIds || [],
      lineLift.pointIds || [])), neededPoints = new Set();
    list.forEach(function(e) {
      var meta=e.meta || {}, refs=meta.endpointRefs || meta.refs || [];
      if (Curves.isCurve(e) || used.has(e.id)) refs.forEach(function(id) {consumedPoints.add(id);});
      else if (e.type === 'SEGMENT') refs.forEach(function(id) {neededPoints.add(id);});
    });
    list.forEach(function(e) {
      var meta=e.meta || {};
      if (meta.ellipse && typeof meta.ellipse.centerRef === 'string')
        consumedPoints.add(meta.ellipse.centerRef);
      if (meta.centerRef && e.type === 'SEGMENT')
        consumedPoints.add(meta.centerRef);
    });
    var consumedMembers = new Set();
    normalized.forEach(function(e) { if(consumedPoints.has(e.id)) ((e.meta || {}).members || []).forEach(function(m) {consumedMembers.add(m.id);}); });
    normalized.forEach(function(e) { if(e.type==='POINT' && ((e.meta || {}).members || []).some(function(m) {return consumedMembers.has(m.id);})) consumedPoints.add(e.id); });
    var remaining = list.filter(function(e) {
      return !Curves.isCurve(e) && !isConicSource(e) && !used.has(e.id) &&
        !(e.type==='POINT' && consumedPoints.has(e.id) && !neededPoints.has(e.id));
    });


    var wire = straightComponent(remaining);
    function coveredByWire(e,g) {
      if (e.type !== 'SEGMENT' || !g || !g.edges.length) return false;
      var role=e.viewRole, dx=e.x2-e.x,dy=e.y2-e.y,len=dx*dx+dy*dy;
      var sideFrame=g.profileMap||frame;
      if ((role!=='PLAN' && role!=='ELEVATION' && role!=='PROFILE') || role==='PROFILE'&&!sideFrame || len<1e-12) return false;
      var intervals=[];
      g.edges.forEach(function(edge) {
        var ps=edge.map(function(v) { var p=g.vertices[v];return role==='PROFILE'?
          {x:sideFrame.xRef+sideFrame.s*(p.z-sideFrame.dRef),y:p.y}:{x:p.x,y:role==='PLAN'?-p.z:p.y}; });
        if(ps.some(function(p) { return Math.abs((p.x-e.x)*dy-(p.y-e.y)*dx)>1e-6*Math.sqrt(len); })) return;
        var ts=ps.map(function(p) { return ((p.x-e.x)*dx+(p.y-e.y)*dy)/len; });
        intervals.push([Math.min.apply(null,ts),Math.max.apply(null,ts)]);
      });
      intervals.sort(function(a,b) {return a[0]-b[0];});
      var reach=0;
      for(var i=0;i<intervals.length;i++) {if(intervals[i][0]>reach+1e-6) break;reach=Math.max(reach,intervals[i][1]);}
      return reach>=1-1e-6;
    }
    if (wire.geometry && wire.geometry.vertices.length) {
      var wg = wire.geometry;
      diagnostics = diagnostics.filter(function(d) { var e=list.find(function(e) {return e.id===d.entityId;}); return !e || !coveredByWire(e,wg); });
      if (wg.partialSubset) (wire.issues||[]).forEach(function(d) {
        if (!diagnostics.some(function(p) {return p.code===d.code&&p.entityId===d.entityId;})) diagnostics.push(d);
      });
      if (!geometry) geometry = Object.assign({},wg,{curves:[],surfacePatches:[]});
      else {
        if(wg.partialSubset) geometry.partialSubset=true;
        applySubsetScope(geometry);
        var offset=geometry.vertices.length;
        geometry.vertices=geometry.vertices.concat(wg.vertices);
        geometry.edges=geometry.edges.concat(wg.edges.map(function(e) {return e.map(function(v) {return v+offset;});}));
        geometry.faceHoles=geometry.faces.map(function() {return [];}).concat((wg.faces || []).map(function(_,fi) {
          return ((wg.faceHoles || [])[fi] || []).map(function(h) {return h.map(function(v) {return v+offset;});});
        }));
        geometry.faces=geometry.faces.concat((wg.faces || []).map(function(f) {return f.map(function(v) {return v+offset;});}));
        (wg.faceRegions || []).forEach(function(f) { geometry.surfacePatches.push({kind:'plane',
          outer:f.outer.map(function(v) {return v+offset;}), holes:f.holes.map(function(h) {return h.map(function(v) {return v+offset;});})}); });
      }
    }

    list.forEach(function(e) {
      if ((e.type === 'LINE' || e.type === 'RAY') && !(e.meta && (DROP_META[e.meta.kind] || e.meta.reconstructionRole === 'construction'))) {
        diagnostics.push({code:'unbounded-edge-unsupported',entityId:e.id,message:'An infinite line/ray needs finite edge endpoints or an explicit construction role.'});
      }
    });
    if (!geometry) return finish({status:'unavailable',reason:diagnostics.length?diagnostics[0].code:'curve-projection-missing',
      label:diagnostics.length?diagnostics[0].message:'Needs another view of the curve.',geometry:null,issues:diagnostics},'primitive-lifting',diagnostics);


    if (!(geometry.smoothSideFaces || []).length) {
      var planar = extractPlanarFaces(geometry.vertices,geometry.edges,geometry.curves);
      geometry = Object.assign({},geometry,planar);
      geometry.surfaceComponents = planar.components || [];
      geometry.surfacePatches = (planar.faceRegions || []).map(function(region) {
        var indices = region.outer.slice();
        (region.holes || []).forEach(function(h) {indices=indices.concat(h);});
        var regionKey = cyclicLoopKey(region.outer), faceIndices = [];
        (geometry.faces || []).forEach(function(face, fi) {
          if (cyclicLoopKey(face) === regionKey) faceIndices.push(fi);
        });
        return {kind:'plane',outer:region.outer,holes:region.holes,faceIndices:faceIndices,
          boundaryCurves:(geometry.curves || []).map(function(c,i) {return c.displayVertices.every(function(v) {return indices.indexOf(v)!==-1;})?i:-1;}).filter(function(i) {return i!==-1;})};
      });
      if (planar.topologyStatus && ['wire','inferred'].indexOf(planar.topologyStatus) === -1) {
        diagnostics.push({code:planar.topologyStatus,message:'Surface inference is unresolved; the reconstructed primitives are retained.'});
      }
    }
    var displayEdges = new Map();
    geometry.edges.forEach(function(e,i) {displayEdges.set(Math.min(e[0],e[1])+'_'+Math.max(e[0],e[1]),i);});
    (geometry.curves || []).forEach(function(c) {
      c.displayEdges=[];
      var n=c.displayVertices.length, closed=c.kind==='circle'||c.kind==='ellipse', count=closed?n:n-1;
      for(var i=0;i<count;i++) {
        var a=c.displayVertices[i],b=c.displayVertices[(i+1)%n],index=displayEdges.get(Math.min(a,b)+'_'+Math.max(a,b));
        if(index!==undefined) c.displayEdges.push(index);
      }
    });
    diagnostics = diagnostics.concat(unmatchedPoints(geometry,consumedPoints));


    var exitDiagnostics=finalizeThroughCavities(geometry);
    if(exitDiagnostics&&exitDiagnostics.length) diagnostics=diagnostics.concat(exitDiagnostics);
    attachSurfaceModel(geometry);
    if (Array.isArray(geometry.silhouetteEvidence) && geometry.silhouetteEvidence.length) {
      var finalSurfaceByPatch = new Map();
      (geometry.surfaces || []).forEach(function(surface) {
        if (!surface || (surface.kind !== 'cylinder' && surface.kind !== 'cone')) return;
        if (Number.isInteger(surface.patchIndex)) finalSurfaceByPatch.set(surface.patchIndex,surface);
      });
      geometry.silhouetteEvidence.forEach(function(evidence) {
        var surface = Number.isInteger(evidence.patchIndex) ?
          finalSurfaceByPatch.get(evidence.patchIndex) : null;
        if (!surface) return;
        evidence.surfaceId = surface.id;
        evidence.sourceIds = (surface.sourceIds || []).slice();
      });
    }
    if (geometry.cylinderJunction && geometry.cylinderJunction.displayTrim === 'deferred' &&
        geometry.cylinderJunction.displayDiagnostic) {
      var displayDiagnostic = geometry.cylinderJunction.displayDiagnostic;
      if (!diagnostics.some(function (d) {return d.code === displayDiagnostic.code;})) {
        diagnostics.push({code:displayDiagnostic.code,
          severity:displayDiagnostic.severity, message:displayDiagnostic.message,
          sourceIds:(geometry.cylinderJunction.seams || []).reduce(function (ids, seam) {
            return ids.concat(seam.sourceIds || []);
          }, [])});
      }
    }
    if (opts.deferValidation) {
      geometry.surfaceValidation = {status:'pending', deferred:true};
    } else {
      var inferredValidation = validateInferredSurfaces(geometry);
      if (inferredValidation) geometry.surfaceValidation = inferredValidation;
    }
    geometry.topologyStatus = diagnostics.length ? 'partial' : 'inferred';
    return finish({status:'ok',reason:null,label:'',determination:diagnostics.length?'partial':'inferred',
      geometry:geometry,issues:diagnostics,stats:{paired:geometry.vertices.length,edges:geometry.edges.length,curves:(geometry.curves || []).length}},
      'surface-inference',diagnostics);
  }

  function dimensionConstraintsModule() {
    try {
      if (typeof require === 'function' && typeof module !== 'undefined')
        return require('./educad-constraints.js');
    } catch (error) {}
    if (typeof window !== 'undefined' && window.EduCADConstraints) return window.EduCADConstraints;
    if (typeof globalThis !== 'undefined' && globalThis.EduCADConstraints) return globalThis.EduCADConstraints;
    return null;
  }

  function postProcessDimensions(result, entities, opts) {
    if (!result || !Array.isArray(entities)) return result;
    if (opts && opts.dimensionConstraints === false) return result;
    if (!entities.some(function (entity) { return entity && entity.type === 'DIMENSION'; }))
      return result;
    var ConstraintModule = dimensionConstraintsModule();
    if (!ConstraintModule || typeof ConstraintModule.analyzeDimensions !== 'function')
      return result;
    var profileFrame = result.geometry && result.geometry.profileMap ? result.geometry.profileMap : null;
    var report = ConstraintModule.analyzeDimensions(entities, {
      profileFrame:profileFrame,
      axisEvidence:result.dimensionAxes,
      toleranceMm:opts && opts.dimensionToleranceMm
    });
    result.dimensionConstraints = report;
    var diagnostics = Array.isArray(report.diagnostics) ? report.diagnostics : [];
    if (!diagnostics.length) return result;
    function keyOf(diagnostic) {
      return [diagnostic.code || '', diagnostic.entityId || '', diagnostic.message || ''].join('|');
    }
    var issues = Array.isArray(result.issues) ? result.issues.slice() : [];
    var seen = Object.create(null);
    issues.forEach(function (issue) { seen[keyOf(issue)] = true; });
    diagnostics.forEach(function (diagnostic) {
      var key = keyOf(diagnostic);
      if (!seen[key]) { seen[key] = true; issues.push(diagnostic); }
    });
    result.issues = issues;
    if (result.pipeline) {
      var pipelineDiagnostics = Array.isArray(result.pipeline.diagnostics) ?
        result.pipeline.diagnostics.slice() : [];
      var pipelineSeen = Object.create(null);
      pipelineDiagnostics.forEach(function (diagnostic) { pipelineSeen[keyOf(diagnostic)] = true; });
      diagnostics.forEach(function (diagnostic) {
        var key = keyOf(diagnostic);
        if (!pipelineSeen[key]) { pipelineSeen[key] = true; pipelineDiagnostics.push(diagnostic); }
      });
      result.pipeline.diagnostics = pipelineDiagnostics;
    }
    if (report.status === 'inconsistent') {
      var hardCodes = ['dimension-residual','dimension-target-conflict',
        'dimension-axis-conflict','dimension-degenerate','dimension-target-invalid'];
      var first = diagnostics.filter(function (diagnostic) {
        return typeof ConstraintModule.isHardDiagnostic === 'function' ?
          ConstraintModule.isHardDiagnostic(diagnostic) :
          hardCodes.indexOf(diagnostic.code) !== -1;
      })[0] || diagnostics[0];
      result.determination = 'inconsistent';
      result.status = 'unavailable';
      result.reason = first.code;
      result.label = first.message;
    } else if (result.determination !== 'inconsistent') {
      result.determination = 'partial';
      if (result.status === 'ok' && !result.label)
        result.label = 'Partial 3D preview: ' + diagnostics[0].message;
    }
    return result;
  }

  function reconstruct(entities, opts) {
    var primitives = Array.isArray(entities) ? entities.filter(function (entity) {
      var meta = entity && entity.meta;
      return !meta || !meta.section && !meta.sectionBoundary && meta.kind !== 'section-boundary-point';
    }) : entities;
    var result = attachDrawingSections(reconstructCore(primitives, opts), entities, opts);
    return postProcessDimensions(result, entities, opts);
  }

  function reconstructStrict(entities, opts, frames) {
    if (!Strict) throw new Error('Load educad-strict.js before educad-reconstruct.js for explicit reconstruction.');



    var resolvedFrame = Array.isArray(entities) && Curves && Curves.resolveProfileFrame ?
      Curves.resolveProfileFrame(entities, opts || {}) : null;
    var profileFrame = resolvedFrame && resolvedFrame.profile && !resolvedFrame.inferred ? resolvedFrame.profile : null;
    var strictRows = Array.isArray(entities) ? entities.filter(function(e) {return !isConicSource(e);}) : entities;
    var strictOptions = Object.assign({}, opts || {}, { frames: frames || null });
    var result = Strict.reconstruct(autoMembersForStrict(strictRows, profileFrame), strictOptions);
    var declaredTopology = opts && opts.topology || Array.isArray(entities) && entities.some(function(e) {
      return e && e.meta && e.meta.reconstructionTopology;
    });
    if (result.geometry && !result.geometry.faces.length && !declaredTopology) {
      var g = result.geometry, planar = extractPlanarFaces(g.vertices, g.edges, g.curves);


      result.declaredGeometry = g;
      result.geometry = Object.assign({}, g, planar, { name: 'inferred surface preview',
        surfaceComponents: planar.components || [] });
    }
    if (result.geometry && Surfaces && Surfaces.build) {
      var model = Surfaces.build(result.geometry);
      if (model) {
        result.geometry.surfaces = model.surfaces;
        result.geometry.surfaceModel = model.summary;
        applyDisplaySync(result.geometry, model);
        if (opts && opts.deferValidation) {
          result.geometry.analyticSurfaceValidation = {status:'pending', deferred:true,
            contract:'analytic-surface-v1'};
          result.geometry.analyticCertificate = {status:'pending', deferred:true,
            contract:'analytic-surface-certificate-v1'};
        } else {
          result.geometry.analyticSurfaceValidation = Surfaces.validate(model, result.geometry);
          result.geometry.analyticCertificate = Surfaces.certify(model, result.geometry);
          if (result.geometry.analyticSurfaceValidation)
            result.geometry.surfaceModel.status = result.geometry.analyticSurfaceValidation.status;
        }
      }
    }
    return mergeDisplaySyncResult(result);
  }
  function reconstructLive(entities, opts) {
    if (opts && opts.mode === 'strict') return reconstructStrict(entities, opts);
    entities = Entities.withDeclaredMembers(entities);



    if (Entities && Array.isArray(entities) && entities.some(function (e) {
      return e && e.meta && e.meta.membersDeclared === true;
    })) entities = Entities.semanticEntities(entities, true);
    opts = opts || {};
    var eps = opts.eps === undefined ? MATCH_EPS_MM : opts.eps;
    assertFinite(eps);
    if (!(eps > 0)) throw new Error('eps must be > 0');
    var list = Array.isArray(entities) ? entities.slice() : [];


    if (opts.ignoreProfile) list = list.filter(function (e) {

      return e && e.viewRole !== 'PROFILE' && !/^(?:proj-pf-|ref-X1Y1$|miter$)/.test(e.caption || '');
    });
    var claims = collectClaimLines(list);
    var curves = false;
    for (var ci = 0; ci < list.length; ci++) {
      var ce = list[ci];
      if (!ce || ce.visible === false) continue;
      if (ce.type === 'CIRCLE' || ce.type === 'CIRCULAR_ARC') {
        curves = true;
        break;
      }
    }



    if (claims.length >= 3) {
      var owned = runReader(list, eps, 'E');
      if (owned) return owned;
      return liveCore(list, eps);
    }
    if (curves) {
      var rd = runReader(list, eps, 'D');
      if (rd) return rd;
      var live = liveCore(list, eps);
      if (live.status === 'ok') return live;
      return { status: 'unavailable', reason: 'unsupported-curves',
        label: REASON_LABELS['unsupported-curves'], class: null,
        geometry: null, stats: live.stats };
    }
    return liveCore(list, eps);
  }




  function liveCore(list, eps) {




    var kept = [];
    var ki;
    for (ki = 0; ki < list.length; ki++) {
      var ke = list[ki];
      if (!ke) continue;
      if (ke.visible === false) continue;
      if (ke.meta && ke.meta.reconstructionRole === 'construction') continue;
      if (!KEEP_TYPES[ke.type]) continue;
      var kkind = ke.meta && ke.meta.kind;
      if (kkind && DROP_META[kkind]) continue;
      if (ke.type === 'CIRCLE' || ke.type === 'CIRCULAR_ARC') continue;
      kept.push(ke);
    }
    var vp = [], hp = [], dp = [], segs = [];
    var i, e;
    for (i = 0; i < kept.length; i++) {
      e = kept[i];
      if (e.viewRole === 'PROFILE') continue;
      if (e.type === 'POINT') {
        var s = liveSideOf(e);
        if (s === 'elev') vp.push(e);
        else if (s === 'plan') hp.push(e);
        else if (s === 'datum') dp.push(e);
      } else if (e.type === 'SEGMENT' || e.type === 'LINE' ||
          e.type === 'RAY') {





        var fm = e.meta && e.meta.fromMember;
        if (fm !== undefined && fm !== null && String(fm) !== '' &&
            crossesXY(e)) continue;






        var vyl = Math.min(e.y, e.y2), vyh = Math.max(e.y, e.y2);
        if (isSheetVertical(e) && vyl < 0 && vyh > 0) continue;
        segs.push(e);
      }
    }



    var segClaims = [];
    for (i = 0; i < segs.length; i++) segClaims.push(parentClaim(segs[i]));
    var verts = [];
    var vBase = [];
    var vpDots = [];
    var hpDots = [];
    var usedVp = {}, usedHp = {}, usedDp = {};
    function claim(bucket, idx, served, v) {
      var ent = bucket === 'vp' ? vp[idx] :
        (bucket === 'hp' ? hp[idx] : dp[idx]);
      if (bucket === 'vp') usedVp[idx] = true;
      else if (bucket === 'hp') usedHp[idx] = true;
      else usedDp[idx] = true;
      if (served === 'vp') vpDots[v].push(ent);
      else hpDots[v].push(ent);
    }
    function emit(x, h, d, base) {
      verts.push({ x: x, y: h, z: d });
      vBase.push(base === undefined ? null : base);
      vpDots.push([]);
      hpDots.push([]);
      return verts.length - 1;
    }
    function basesOf(ent) { return captionBases(ent.caption); }





    function isProjectorInk(e) {
      if (!e || e.visible === false) return false;
      if (e.type !== 'SEGMENT' && e.type !== 'LINE' &&
          e.type !== 'RAY') return false;
      if (!isSheetVertical(e) || !crossesXY(e)) return false;
      var k = e.meta && e.meta.kind;
      if (k !== undefined && k !== null && k !== 'user-line' &&
          k !== 'projector') return false;
      return true;
    }
    var projectorInk = [];
    for (var pli = 0; pli < list.length; pli++) {
      if (isProjectorInk(list[pli])) projectorInk.push(list[pli]);
    }
    function coversDot(line, dot) {
      if (Math.abs(dot.x - line.x) > eps) return false;
      var lo = Math.min(line.y, line.y2) - eps;
      var hi = Math.max(line.y, line.y2) + eps;
      return dot.y >= lo && dot.y <= hi;
    }
    function linkedByProjector(d1, d2, member) {
      for (var li = 0; li < projectorInk.length; li++) {
        var explicit = projectorInk[li].meta && projectorInk[li].meta.endpointMembers;
        if (explicit && (explicit[0] !== member || explicit[1] !== member)) continue;
        var refs = projectorInk[li].meta && projectorInk[li].meta.refs;
        if (explicit && (!refs || !((refs[0] === d1.id && refs[1] === d2.id) ||
            (refs[0] === d2.id && refs[1] === d1.id)))) continue;
        if (coversDot(projectorInk[li], d1) &&
            coversDot(projectorInk[li], d2)) return explicit ? 'explicit' : true;
      }
      return false;
    }






    var byId = {};
    for (i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i].id === 'string') byId[list[i].id] = list[i];
    }
    var claimedFeet = {};
    var projUsedV = {}, projUsedH = {};
    for (i = 0; i < list.length; i++) {
      var cle = list[i];
      if (!cle || cle.visible === false) continue;
      if (cle.type !== 'SEGMENT' && cle.type !== 'LINE' &&
          cle.type !== 'RAY') continue;
      var cm = cle.meta && cle.meta.fromMember;
      if (cm === undefined || cm === null || String(cm) === '') continue;
      var cb = baseNameOf(String(cm));
      if (cb === '') continue;
      var explicitFeet = cle.meta.endpointMembers;
      if (explicitFeet && (explicitFeet[0] !== cb || explicitFeet[1] !== cb)) continue;
      var cr = cle.meta.refs;
      if (!cr || cr.length < 2) continue;
      var cS = byId[cr[0]], cF = byId[cr[1]];
      if (!cS || !cF || cS.type !== 'POINT' ||
          cF.type !== 'POINT') continue;
      if (cS.visible === false || cF.visible === false) continue;
      var cSs = liveSideOf(cS), cFs = liveSideOf(cF);
      if (cSs === cFs) continue;
      var cP = cSs === 'plan' ? cS : cF;
      var cE = cSs === 'elev' ? cS : cF;
      if (liveSideOf(cP) !== 'plan' || liveSideOf(cE) !== 'elev') continue;
      if (Math.abs(cP.x - cE.x) > eps) continue;
      if (!isProjectorInk(cle)) continue;
      if (!coversDot(cle, cP) || !coversDot(cle, cE)) continue;
      var cvi = vp.indexOf(cE), chi = hp.indexOf(cP);
      if (cvi === -1 || chi === -1) continue;
      var ckey = cvi + '_' + chi + (explicitFeet ? ':' + cb : '');
      if (claimedFeet[ckey]) continue;
      claimedFeet[ckey] = true;
      projUsedV[cvi + ':' + cb] = true;
      projUsedH[chi + ':' + cb] = true;
      var cvv = emit((cE.x + cP.x) / 2, cE.y, -cP.y, cb);
      claim('vp', cvi, 'vp', cvv);
      claim('hp', chi, 'hp', cvv);
    }




    var ownersV = {}, ownersH = {}, bi, b;
    for (i = 0; i < vp.length; i++) {
      var bv = basesOf(vp[i]);
      for (bi = 0; bi < bv.length; bi++) {
        if (!ownersV[bv[bi]]) ownersV[bv[bi]] = [];
        ownersV[bv[bi]].push(i);
      }
    }
    for (i = 0; i < hp.length; i++) {
      var bh = basesOf(hp[i]);
      for (bi = 0; bi < bh.length; bi++) {
        if (!ownersH[bh[bi]]) ownersH[bh[bi]] = [];
        ownersH[bh[bi]].push(i);
      }
    }
    for (b in ownersV) {
      if (!Object.prototype.hasOwnProperty.call(ownersV, b)) continue;
      var vlist = ownersV[b], hlist = ownersH[b] || [];
      for (var vi = 0; vi < vlist.length; vi++) {
        var pi = vlist[vi], matches = [];
        for (var hi = 0; hi < hlist.length; hi++) {
          if (Math.abs(vp[pi].x - hp[hlist[hi]].x) <= eps) matches.push(hlist[hi]);
        }
        if (matches.length !== 1) continue;
        var qi = matches[0], backs = 0;
        for (var vk = 0; vk < vlist.length; vk++) {
          if (Math.abs(vp[vlist[vk]].x - hp[qi].x) <= eps) backs++;
        }
        if (backs !== 1) continue;
        if (claimedFeet[pi + '_' + qi] || claimedFeet[pi + '_' + qi + ':' + b]) continue;
        claimedFeet[pi + '_' + qi + ':' + b] = true;
        var v = emit((vp[pi].x + hp[qi].x) / 2, vp[pi].y, -hp[qi].y, b);
        claim('vp', pi, 'vp', v);
        claim('hp', qi, 'hp', v);
      }
    }











    for (i = 0; i < list.length; i++) {
      var ple = list[i];
      if (!ple || ple.visible === false) continue;
      if (ple.type !== 'SEGMENT' && ple.type !== 'LINE' &&
          ple.type !== 'RAY') continue;
      if (!isSheetVertical(ple) || !crossesXY(ple)) continue;
      if (ple.meta && Array.isArray(ple.meta.endpointMembers)) continue;
      var pkind = ple.meta && ple.meta.kind;
      if (pkind !== undefined && pkind !== null && pkind !== 'user-line' &&
          pkind !== 'projector') continue;
      var plo = Math.min(ple.y, ple.y2) - eps;
      var phi = Math.max(ple.y, ple.y2) + eps;
      var pE = [], pP = [], pi;
      for (pi = 0; pi < vp.length; pi++) {
        if (Math.abs(vp[pi].x - ple.x) <= eps &&
            vp[pi].y >= plo && vp[pi].y <= phi) pE.push(pi);
      }
      for (pi = 0; pi < hp.length; pi++) {
        if (Math.abs(hp[pi].x - ple.x) <= eps &&
            hp[pi].y >= plo && hp[pi].y <= phi) pP.push(pi);
      }
      if (pE.length === 0 || pP.length === 0) continue;
      var pbases = [], pseen = {};
      for (pi = 0; pi < pE.length; pi++) {
        var pbb = basesOf(vp[pE[pi]]);
        for (var pb2 = 0; pb2 < pbb.length; pb2++) {
          if (!pseen[pbb[pb2]]) {
            pseen[pbb[pb2]] = 1;
            pbases.push(pbb[pb2]);
          }
        }
      }
      for (pi = 0; pi < pbases.length; pi++) {
        var pbd = pbases[pi], peOwn = [], ppOwn = [], pk;
        for (pk = 0; pk < pE.length; pk++) {
          if (projUsedV[pE[pk] + ':' + pbd]) continue;
          if (basesOf(vp[pE[pk]]).indexOf(pbd) !== -1) peOwn.push(pE[pk]);
        }
        for (pk = 0; pk < pP.length; pk++) {
          if (projUsedH[pP[pk] + ':' + pbd]) continue;
          if (basesOf(hp[pP[pk]]).indexOf(pbd) !== -1) ppOwn.push(pP[pk]);
        }
        if (peOwn.length !== 1 || ppOwn.length !== 1) continue;
        var pdd = vp[peOwn[0]], pqq = hp[ppOwn[0]];
        if (Math.abs(pdd.x - pqq.x) > eps) continue;
        var pkey = peOwn[0] + '_' + ppOwn[0];
        if (claimedFeet[pkey] || claimedFeet[pkey + ':' + pbd]) continue;
        claimedFeet[pkey + ':' + pbd] = true;
        projUsedV[peOwn[0] + ':' + pbd] = true;
        projUsedH[ppOwn[0] + ':' + pbd] = true;
        var pvv = emit((pdd.x + pqq.x) / 2, pdd.y, -pqq.y, pbd);
        claim('vp', peOwn[0], 'vp', pvv);
        claim('hp', ppOwn[0], 'hp', pvv);
      }
    }



    var ownersD = {};
    for (i = 0; i < dp.length; i++) {
      var bd = basesOf(dp[i]);
      for (bi = 0; bi < bd.length; bi++) {
        if (!ownersD[bd[bi]]) ownersD[bd[bi]] = [];
        ownersD[bd[bi]].push(i);
      }
    }
    for (b in ownersD) {
      if (!Object.prototype.hasOwnProperty.call(ownersD, b)) continue;
      var matesV = [], matesH = [];
      if (ownersV[b]) {
        for (bi = 0; bi < ownersV[b].length; bi++) {
          if (!usedVp[ownersV[b][bi]]) matesV.push(ownersV[b][bi]);
        }
      }
      if (ownersH[b]) {
        for (bi = 0; bi < ownersH[b].length; bi++) {
          if (!usedHp[ownersH[b][bi]]) matesH.push(ownersH[b][bi]);
        }
      }
      var freeD = [];
      for (bi = 0; bi < ownersD[b].length; bi++) {
        if (!usedDp[ownersD[b][bi]]) freeD.push(ownersD[b][bi]);
      }
      if (freeD.length === 2 && matesV.length === 0 &&
          matesH.length === 0 &&
          Math.abs(dp[freeD[0]].x - dp[freeD[1]].x) <= eps &&
          linkedByProjector(dp[freeD[0]], dp[freeD[1]])) {
        var t = emit((dp[freeD[0]].x + dp[freeD[1]].x) / 2, 0, 0, b);
        claim('dp', freeD[0], 'vp', t);
        claim('dp', freeD[1], 'hp', t);
        continue;
      }
      if (freeD.length !== 1) continue;
      var di = freeD[0];
      if (matesV.length === 1 && matesH.length === 0 &&
          Math.abs(dp[di].x - vp[matesV[0]].x) <= eps &&
          linkedByProjector(dp[di], vp[matesV[0]])) {
        var v1 = emit((dp[di].x + vp[matesV[0]].x) / 2,
          vp[matesV[0]].y, 0, b);
        claim('dp', di, 'hp', v1);
        claim('vp', matesV[0], 'vp', v1);
      } else if (matesH.length === 1 && matesV.length === 0 &&
          Math.abs(dp[di].x - hp[matesH[0]].x) <= eps &&
          linkedByProjector(dp[di], hp[matesH[0]])) {
        var v2 = emit((dp[di].x + hp[matesH[0]].x) / 2,
          0, -hp[matesH[0]].y, b);
        claim('dp', di, 'vp', v2);
        claim('hp', matesH[0], 'hp', v2);
      }
    }



    function unnamedAt(arr, used, idx) {
      return !used[idx] && basesOf(arr[idx]).length === 0;
    }
    var stations = [];
    function stationOf(x) {
      for (var k = 0; k < stations.length; k++) {
        if (Math.abs(stations[k] - x) <= eps) return k;
      }
      stations.push(x);
      return stations.length - 1;
    }
    var perStV = {}, perStH = {};
    for (i = 0; i < vp.length; i++) {
      if (!unnamedAt(vp, usedVp, i)) continue;
      var sv = stationOf(vp[i].x);
      if (!perStV[sv]) perStV[sv] = [];
      perStV[sv].push(i);
    }
    for (i = 0; i < hp.length; i++) {
      if (!unnamedAt(hp, usedHp, i)) continue;
      var sh = stationOf(hp[i].x);
      if (!perStH[sh]) perStH[sh] = [];
      perStH[sh].push(i);
    }
    for (var st in perStV) {
      if (!Object.prototype.hasOwnProperty.call(perStV, st)) continue;
      if (perStV[st].length !== 1 || !perStH[st] ||
          perStH[st].length !== 1) continue;
      var ui = perStV[st][0], wi = perStH[st][0];
      if (!linkedByProjector(vp[ui], hp[wi])) continue;
      var vu = emit((vp[ui].x + hp[wi].x) / 2, vp[ui].y, -hp[wi].y);
      claim('vp', ui, 'vp', vu);
      claim('hp', wi, 'hp', vu);
    }




    function pairKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
    function resolveSide(dots, x, y) {
      var out = [];
      for (var v = 0; v < dots.length; v++) {
        for (var k = 0; k < dots[v].length; k++) {
          var dx = dots[v][k].x - x, dy = dots[v][k].y - y;
          if (dx * dx + dy * dy <= eps * eps) {
            if (out.indexOf(v) === -1) out.push(v);
            break;
          }
        }
      }
      return out;
    }



    function dotCarries(x, y, base) {
      var buckets = [vp, hp, dp];
      for (var nb = 0; nb < buckets.length; nb++) {
        for (var ni = 0; ni < buckets[nb].length; ni++) {
          var nd = buckets[nb][ni];
          var dx = nd.x - x, dy = nd.y - y;
          if (dx * dx + dy * dy > eps * eps) continue;
          if (basesOf(nd).indexOf(base) !== -1) return true;
        }
      }
      return false;
    }
    function parentClaim(sg) {
      var endpoints = sg.meta && sg.meta.endpointMembers;
      if (Array.isArray(endpoints)) {
        return { endpoints: [
          { x: sg.x, y: sg.y, member: endpoints[0] },
          { x: sg.x2, y: sg.y2, member: endpoints[1] }
        ] };
      }
      var pm = sg.meta && sg.meta.fromMember;
      if (pm === undefined || pm === null || String(pm) === '') return null;
      var pb = baseNameOf(String(pm));
      if (pb === '') return null;
      var pts = [];
      if (dotCarries(sg.x, sg.y, pb)) pts.push({ x: sg.x, y: sg.y });
      if (dotCarries(sg.x2, sg.y2, pb)) pts.push({ x: sg.x2, y: sg.y2 });
      if (pts.length === 0) return null;
      return { member: pb, pts: pts };
    }
    function resolveAt(sg, dots, x, y) {
      var all = resolveSide(dots, x, y);
      var cl = sg.claim;
      if (!cl) return all;
      if (cl.endpoints) {
        for (var ei = 0; ei < cl.endpoints.length; ei++) {
          var endpoint = cl.endpoints[ei];
          if (!endpoint.member) continue;
          if (Math.hypot(endpoint.x - x, endpoint.y - y) <= eps) {

            return all.filter(function (v) { return vBase[v] === endpoint.member; });
          }
        }
        return all;
      }
      var atClaim = false;
      for (var k = 0; k < cl.pts.length; k++) {
        var dx = cl.pts[k].x - x, dy = cl.pts[k].y - y;
        if (dx * dx + dy * dy <= eps * eps) { atClaim = true; break; }
      }
      if (!atClaim) return all;
      var kept = [];
      for (var v = 0; v < all.length; v++) {
        if (vBase[all[v]] === cl.member) kept.push(all[v]);
      }
      return kept.length > 0 ? kept : all;
    }
    function combosFor(sg, dots) {
      var A = resolveAt(sg, dots, sg.x, sg.y);
      var B = resolveAt(sg, dots, sg.x2, sg.y2);
      var out = [];
      for (var ia = 0; ia < A.length; ia++) {
        for (var ib = 0; ib < B.length; ib++) {
          if (A[ia] === B[ib]) continue;
          var key = pairKey(A[ia], B[ib]);
          if (out.indexOf(key) === -1) out.push(key);
        }
      }
      return out;
    }
    var edges = [];
    var seenEdge = {};
    function emitEdge(a, b) {
      var key = pairKey(a, b);
      if (seenEdge[key]) return;
      seenEdge[key] = true;
      edges.push([a, b]);
    }









    var allDots = [];
    for (i = 0; i < vpDots.length; i++) {
      for (var idv = 0; idv < vpDots[i].length; idv++) {
        allDots.push(vpDots[i][idv]);
      }
    }
    for (i = 0; i < hpDots.length; i++) {
      for (var idh = 0; idh < hpDots[i].length; idh++) {
        allDots.push(hpDots[i][idh]);
      }
    }
    function splitSeg(sg) {
      var pts = [{ x: sg.x, y: sg.y }, { x: sg.x2, y: sg.y2 }];
      var dx = sg.x2 - sg.x, dy = sg.y2 - sg.y;
      var L2 = dx * dx + dy * dy;
      if (!(L2 > 0)) return [];
      for (var k = 0; k < allDots.length; k++) {
        var t = ((allDots[k].x - sg.x) * dx +
          (allDots[k].y - sg.y) * dy) / L2;
        if (t <= 0 || t >= 1) continue;
        var px = sg.x + t * dx - allDots[k].x;
        var py = sg.y + t * dy - allDots[k].y;
        if (px * px + py * py > eps * eps) continue;
        pts.push({ x: allDots[k].x, y: allDots[k].y });
      }
      pts.sort(function (p, q) {
        var tp = ((p.x - sg.x) * dx + (p.y - sg.y) * dy) / L2;
        var tq = ((q.x - sg.x) * dx + (q.y - sg.y) * dy) / L2;
        return tp - tq;
      });
      var out = [];
      for (var j = 0; j + 1 < pts.length; j++) {
        var ex = pts[j + 1].x - pts[j].x, ey = pts[j + 1].y - pts[j].y;
        if (ex * ex + ey * ey <= eps * eps) continue;
        out.push({ x: pts[j].x, y: pts[j].y,
          x2: pts[j + 1].x, y2: pts[j + 1].y });
      }
      return out;
    }
    var vpConn = {}, hpConn = {};
    var tier2 = [];
    var splitWhole = {};
    var workSegs = [];
    var wholeSeg = [];
    var splitOrigin = [];
    for (i = 0; i < segs.length; i++) {
      var parts = splitSeg(segs[i]);
      if (parts.length > 1) {
        workSegs.push({ x: segs[i].x, y: segs[i].y,
          x2: segs[i].x2, y2: segs[i].y2, claim: segClaims[i] });
        wholeSeg.push(true);
        splitOrigin.push(true);
      }
      var whole = parts.length <= 1;
      for (var ip = 0; ip < parts.length; ip++) {
        parts[ip].claim = segClaims[i];
        workSegs.push(parts[ip]);
        wholeSeg.push(whole);
        splitOrigin.push(parts.length > 1);
      }
    }
    for (i = 0; i < workSegs.length; i++) {
      var cv = combosFor(workSegs[i], vpDots);
      var ch = combosFor(workSegs[i], hpDots);
      var union = cv.slice();
      for (var ic = 0; ic < ch.length; ic++) {
        if (union.indexOf(ch[ic]) === -1) union.push(ch[ic]);
      }
      var iu;
      for (iu = 0; iu < cv.length; iu++) vpConn[cv[iu]] = true;
      for (iu = 0; iu < ch.length; iu++) hpConn[ch[iu]] = true;
      if (union.length === 1 && wholeSeg[i] && !splitOrigin[i]) {
        var ee = union[0].split('_');
        emitEdge(+ee[0], +ee[1]);
      } else if (union.length >= 1) {
        for (iu = 0; iu < union.length; iu++) {
          if (tier2.indexOf(union[iu]) === -1) tier2.push(union[iu]);
        }
        if (wholeSeg[i] && splitOrigin[i] && union.length === 1) {
          splitWhole[union[0]] = true;
        }
      }
    }
    function coincide(dots, a, b) {
      for (var ia = 0; ia < dots[a].length; ia++) {
        for (var ib = 0; ib < dots[b].length; ib++) {
          var dx = dots[a][ia].x - dots[b][ib].x;
          var dy = dots[a][ia].y - dots[b][ib].y;
          if (dx * dx + dy * dy <= 1e-18) return true;
        }
      }
      return false;
    }
    for (i = 0; i < tier2.length; i++) {
      var pp = tier2[i].split('_');
      var pa = +pp[0], pb = +pp[1];
      var inV = !!vpConn[tier2[i]], inH = !!hpConn[tier2[i]];
      if ((inV && (inH || coincide(hpDots, pa, pb))) ||
          (inH && (inV || coincide(vpDots, pa, pb)))) {
        var key2 = pairKey(pa, pb);
        if (!seenEdge[key2]) {
          seenEdge[key2] = true;
          edges.push([pa, pb]);
        }
      }
    }
    function projPt(vert, side) {
      if (side === 'vp') return { x: verts[vert].x, y: verts[vert].y };
      return { x: verts[vert].x, y: -verts[vert].z };
    }



    var keptEdges = edges.slice();





    function strictlyInside(vertC, vertA, vertB, side) {
      var p = projPt(vertA, side), q = projPt(vertB, side),
        r = projPt(vertC, side);
      var dx = q.x - p.x, dy = q.y - p.y;
      var L2 = dx * dx + dy * dy;
      if (!(L2 > 0)) return false;
      var t = ((r.x - p.x) * dx + (r.y - p.y) * dy) / L2;
      if (!(t > 1e-9 && t < 1 - 1e-9)) return false;
      var px = p.x + t * dx - r.x, py = p.y + t * dy - r.y;
      return px * px + py * py <= eps * eps;
    }
    var survived = {};
    for (i = 0; i < keptEdges.length; i++) {
      survived[pairKey(keptEdges[i][0], keptEdges[i][1])] = true;
    }
    edges = keptEdges.filter(function (e) {
      if (!splitWhole[pairKey(e[0], e[1])]) return true;
      for (var c = 0; c < verts.length; c++) {
        if (c === e[0] || c === e[1]) continue;
        if (!survived[pairKey(e[0], c)] ||
            !survived[pairKey(e[1], c)]) continue;
        if (strictlyInside(c, e[0], e[1], 'vp') &&
            strictlyInside(c, e[0], e[1], 'hp')) return false;
      }
      return true;
    });




    function segViewSide(sg) {
      if (sg.viewRole === 'ELEVATION') return 'elev';
      if (sg.viewRole === 'PLAN') return 'plan';
      if (sg.viewRole === 'PROFILE') return 'profile';
      var lo = Math.min(sg.y, sg.y2), hi = Math.max(sg.y, sg.y2);
      if (lo >= 0) return 'elev';
      if (hi <= 0) return 'plan';
      return '';
    }
    function edgeProjection(v, side) {
      var p = verts[v];
      return side === 'elev' ? { x: p.x, y: p.y } : { x: p.x, y: -p.z };
    }
    function pointEvidence(v, side) {
      return side === 'elev' ? vpDots[v].length > 0 : hpDots[v].length > 0;
    }
    function intervalFor(sg, p, ux, uy) {
      var ax = sg.x, ay = sg.y, bx = sg.x2, by = sg.y2;
      if (Math.abs((ax - p.x) * uy - (ay - p.y) * ux) > eps ||
          Math.abs((bx - p.x) * uy - (by - p.y) * ux) > eps) return null;
      var t1 = (ax - p.x) * ux + (ay - p.y) * uy;
      var t2 = (bx - p.x) * ux + (by - p.y) * uy;
      var lo = Math.min(t1, t2), hi = Math.max(t1, t2);
      if (sg.type === 'LINE') { lo = -Infinity; hi = Infinity; }
      else if (sg.type === 'RAY') {
        var dir = t2 - t1;
        if (Math.abs(dir) <= eps) return null;
        if (dir > 0) { lo = t1; hi = Infinity; }
        else { lo = -Infinity; hi = t1; }
      }
      return [lo, hi];
    }
    function coveredInView(a, b, side) {
      var p = edgeProjection(a, side), q = edgeProjection(b, side);
      var dx = q.x - p.x, dy = q.y - p.y;
      var L = Math.hypot(dx, dy);
      if (L <= eps) {
        return pointEvidence(a, side) && pointEvidence(b, side);
      }
      var ux = dx / L, uy = dy / L;
      var intervals = [];
      for (var k = 0; k < segs.length; k++) {
        if (segViewSide(segs[k]) !== side) continue;
        var iv = intervalFor(segs[k], p, ux, uy);
        if (!iv) continue;
        var lo = Math.max(0, iv[0]), hi = Math.min(L, iv[1]);
        if (hi + eps >= lo) intervals.push([lo, hi]);
      }
      intervals.sort(function (x, y) { return x[0] - y[0]; });
      var reach = 0;
      for (var m = 0; m < intervals.length; m++) {
        if (intervals[m][0] > reach + eps) return false;
        if (intervals[m][1] > reach) reach = intervals[m][1];
        if (reach >= L - eps) return true;
      }
      return reach >= L - eps;
    }
    var bothViewEdges = [];
    for (i = 0; i < edges.length; i++) {
      if (coveredInView(edges[i][0], edges[i][1], 'elev') &&
          coveredInView(edges[i][0], edges[i][1], 'plan')) {
        bothViewEdges.push(edges[i]);
      }
    }
    edges = bothViewEdges;
    var planar = extractPlanarFaces(verts, edges);
    edges = planar.edges;
    var faces = planar.faces;

    var stats = { seen: vp.length + hp.length + dp.length,
      paired: verts.length, edges: edges.length };
    if (verts.length > 0) {
      return { status: 'ok', reason: null, label: '', class: null,
        geometry: { name: 'wireframe', vertices: verts, edges: edges,
          faces: faces, faceHoles: planar.faceHoles || [],
          faceRegions: planar.faceRegions || [], surfaceComponents: planar.components || [],
          topologyStatus: planar.topologyStatus || 'wire' },
        stats: stats };
    }
    return { status: 'unavailable', reason: 'empty-sketch',
      label: REASON_LABELS['empty-sketch'], class: null, geometry: null,
      stats: stats };
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
    tryCylinder: tryCylinder,
    tryCone: tryCone,
    tryRevolved: tryRevolved,
    RIM_K: RIM_K,
    projectToViews: projectToViews,
    baseNameOf: baseNameOf, captionBases: captionBases,
    inferClosedFaces: inferClosedFaces,
    reconstruct: reconstruct,
    reconstructStrict: reconstructStrict,
    reconstructLive: reconstructLive,
    attachDrawingSections: attachDrawingSections,
    mergeDisplaySyncResult: mergeDisplaySyncResult,
    validateSurfaces: validateSurfaces
  };
});

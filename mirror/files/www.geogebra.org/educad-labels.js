(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADLabels = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD label layout: 3-tier dynamic annotation engine with leader
  // fallback. Tier 1 filters to genuine BIS SP 46 annotations (primed
  // points, dimensions, loci, datum ends; never projector/axis/hidden
  // internals). Tier 2 samples 8 radial sectors per anchor and keeps the
  // min-cost AABB (incident-line repulsion, label overlap = Infinity,
  // edge crossing, XY ground-line rule, aesthetic preference) in
  // O(8*N) time. Tier 3 is rendering (knockout halo, see canvas module).
  // Tier 4 emits a BIS Type B leader when every sector is blocked.
  // World mm inside; screen px is ephemeral (needs view {s,tx,ty,w,h}).
  // Deterministic: fixed sector order, strict-min wins. Zero deps.
  var WORLD_UNITS = 'mm';
  var VERSION = '8.0.0-educad';
  var SECTORS_DEG = [0, 45, 90, 135, 180, 225, 270, 315];
  // Screen-px steps (y down): 45 deg reads visually up-right.
  var SECTOR_STEP = {
    0: [1, 0], 45: [1, -1], 90: [0, -1], 135: [-1, -1],
    180: [-1, 0], 225: [-1, 1], 270: [0, 1], 315: [1, 1]
  };
  // Cartographic preference: top-right first, bottom-left last.
  var SECTOR_PREF = {
    45: 0, 135: 0.5, 0: 1, 90: 1.5,
    180: 2, 270: 2.5, 315: 3, 225: 3.5
  };
  var RADIUS_PX = 10;
  var FONT_PX = 13;
  var DEFAULT_FONT = 'italic 13px "Cambria", "Times New Roman", serif';
  var HALO_WIDTH_PX = 3.5;
  var HALO_STYLE = 'rgba(248, 250, 252, 0.95)';
  var TEXT_FILL = '#0f172a';
  var W_INCIDENT = 30;
  var W_EDGE_CROSS = 50;
  var W_GROUND = 100;
  var LEADER_THRESHOLD = 50;
  var LEADER_R_MM = 25;
  var LEADER_DOT_R_PX = 2;
  var INCIDENT_DOT = 0.5;
  var INCIDENT_EPS_MM = 1e-6;
  var OVERLAP_PAD_PX = 1;
  var SKIP_KINDS = ['projector', 'projector-mate', 'axis', 'hidden'];

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function nowMs() {
    if (typeof performance !== 'undefined' && performance &&
        typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function forward(view, x, y) {
    assertFinite(view.s, view.tx, view.ty, x, y);
    return { x: x * view.s + view.tx, y: view.ty - y * view.s };
  }

  function inverse(view, px, py) {
    assertFinite(view.s, view.tx, view.ty, px, py);
    return { x: (px - view.tx) / view.s, y: (view.ty - py) / view.s };
  }

  function distMm(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function kindOf(e) {
    return (e && e.meta && typeof e.meta.kind === 'string') ? e.meta.kind : '';
  }

  // Tier 1: semantic filter. Returns a job kind or null (never label).
  function labelKind(e) {
    if (!e || typeof e !== 'object') return null;
    if (e.showLabel === false || e.visible === false) return null;
    if (SKIP_KINDS.indexOf(kindOf(e)) !== -1) return null;
    if (e.type === 'TEXT') {
      return (typeof e.caption === 'string' && e.caption !== '') ? 'text' : null;
    }
    if (e.type === 'POINT') {
      return (typeof e.caption === 'string' && e.caption !== '') ? 'point' : null;
    }
    if (e.type === 'DIMENSION') {
      return (typeof e.caption === 'string' && e.caption !== '') ? 'dimension' : null;
    }
    if (e.type === 'LINE' && kindOf(e) === 'locus') return 'locus';
    if (e.type === 'DATUM_AXIS') return 'datum';
    return null;
  }

  function labelText(e, kind, datumEnd) {
    if (kind === 'datum') return datumEnd === 'left' ? 'X' : 'Y';
    if (kind === 'locus') {
      var c = (typeof e.caption === 'string') ? e.caption : '';
      if (c.indexOf('locus-') === 0) return 'locus of ' + c.slice(6);
      return c !== '' ? c : 'locus';
    }
    return e.caption;
  }

  // Fallback text metrics (override via opts.measure with ctx.measureText).
  function estimateTextSize(text, fontPx) {
    var fp = (fontPx === undefined || fontPx === null) ? FONT_PX : fontPx;
    assertFinite(fp);
    var t = String(text);
    return { w: Math.max(8, t.length * 0.55 * fp), h: fp * 1.15 };
  }

  // Tier 2 anchors (world mm). Locus labels sit at the outer (max-x) end;
  // datum ground lines split into X (left end) and Y (right end).
  function locusOuterEnd(e) {
    assertFinite(e.x, e.y, e.x2, e.y2);
    if (e.x2 > e.x || (e.x2 === e.x && e.y2 > e.y)) {
      return { x: e.x2, y: e.y2 };
    }
    return { x: e.x, y: e.y };
  }

  function datumEnds(e) {
    assertFinite(e.x, e.y, e.x2, e.y2);
    if (e.x <= e.x2) {
      return { left: { x: e.x, y: e.y }, right: { x: e.x2, y: e.y2 } };
    }
    return { left: { x: e.x2, y: e.y2 }, right: { x: e.x, y: e.y } };
  }

  function sectorDirPx(deg) {
    var st = SECTOR_STEP[deg];
    if (!st) throw new Error('unknown sector: ' + String(deg));
    var len = Math.sqrt(st[0] * st[0] + st[1] * st[1]);
    return { x: st[0] / len, y: st[1] / len, sx: st[0], sy: st[1] };
  }

  // Candidate AABB: the box corner nearest the anchor sits R px out along
  // the sector, so long texts clear the vertex instead of covering it.
  function candidateBox(axPx, ayPx, deg, w, h, radiusPx) {
    assertFinite(axPx, ayPx, w, h, radiusPx);
    var d = sectorDirPx(deg);
    var px = axPx + radiusPx * d.x;
    var py = ayPx + radiusPx * d.y;
    var x0 = d.sx > 0 ? px : (d.sx < 0 ? px - w : px - w / 2);
    var y0 = d.sy < 0 ? py - h : (d.sy > 0 ? py : py - h / 2);
    return { x: x0, y: y0, w: w, h: h };
  }

  function boxesOverlap(a, b, pad) {
    var p = (pad === undefined) ? OVERLAP_PAD_PX : pad;
    return a.x - p < b.x + b.w + p && b.x - p < a.x + a.w + p &&
      a.y - p < b.y + b.h + p && b.y - p < a.y + a.h + p;
  }

  function orient(ax, ay, bx, by, cx, cy) {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  function onSeg(ax, ay, bx, by, cx, cy) {
    return Math.min(ax, bx) <= cx && cx <= Math.max(ax, bx) &&
      Math.min(ay, by) <= cy && cy <= Math.max(ay, by);
  }

  function segsCross(p1, p2, p3, p4) {
    var d1 = orient(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y);
    var d2 = orient(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y);
    var d3 = orient(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    var d4 = orient(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
    if (d1 === 0 && onSeg(p3.x, p3.y, p4.x, p4.y, p1.x, p1.y)) return true;
    if (d2 === 0 && onSeg(p3.x, p3.y, p4.x, p4.y, p2.x, p2.y)) return true;
    if (d3 === 0 && onSeg(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y)) return true;
    if (d4 === 0 && onSeg(p1.x, p1.y, p2.x, p2.y, p4.x, p4.y)) return true;
    return false;
  }

  function pointInBox(p, box) {
    return p.x >= box.x && p.x <= box.x + box.w &&
      p.y >= box.y && p.y <= box.y + box.h;
  }

  function segBoxIntersect(p1, p2, box) {
    if (pointInBox(p1, box) || pointInBox(p2, box)) return true;
    var c = [
      { x: box.x, y: box.y }, { x: box.x + box.w, y: box.y },
      { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }
    ];
    for (var i = 0; i < 4; i++) {
      if (segsCross(p1, p2, c[i], c[(i + 1) % 4])) return true;
    }
    return false;
  }

  // Infinite line crosses the box iff box corners straddle it.
  function lineBoxIntersect(p1, p2, box) {
    var dx = p2.x - p1.x, dy = p2.y - p1.y;
    if (dx === 0 && dy === 0) return pointInBox(p1, box);
    var signs = [0, 0];
    var corners = [
      [box.x, box.y], [box.x + box.w, box.y],
      [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]
    ];
    for (var i = 0; i < 4; i++) {
      var s = dx * (corners[i][1] - p1.y) - dy * (corners[i][0] - p1.x);
      if (s > 0) signs[0] = 1;
      else if (s < 0) signs[1] = 1;
      else return true;
    }
    return signs[0] === 1 && signs[1] === 1;
  }

  // Ray (origin + unit dir, t >= 0) vs box via the slab test.
  function rayBoxIntersect(o, u, box) {
    var tmin = 0, tmax = Infinity;
    var axes = [[o.x, u.x, box.x, box.x + box.w], [o.y, u.y, box.y, box.y + box.h]];
    for (var i = 0; i < 2; i++) {
      var oo = axes[i][0], uu = axes[i][1], lo = axes[i][2], hi = axes[i][3];
      if (Math.abs(uu) < 1e-12) {
        if (oo < lo || oo > hi) return false;
      } else {
        var t1 = (lo - oo) / uu, t2 = (hi - oo) / uu;
        tmin = Math.max(tmin, Math.min(t1, t2));
        tmax = Math.min(tmax, Math.max(t1, t2));
        if (tmin > tmax) return false;
      }
    }
    return true;
  }

  function circleBoxIntersect(c, rPx, box) {
    var nx = Math.max(box.x, Math.min(c.x, box.x + box.w));
    var ny = Math.max(box.y, Math.min(c.y, box.y + box.h));
    var dx = c.x - nx, dy = c.y - ny;
    return dx * dx + dy * dy <= rPx * rPx;
  }

  function distPointSegMm(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return distMm(px, py, ax, ay);
    var t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return distMm(px, py, ax + t * dx, ay + t * dy);
  }

  function toScreenDir(dxMm, dyMm) {
    var len = Math.sqrt(dxMm * dxMm + dyMm * dyMm);
    if (!(len > 0)) return null;
    return { x: dxMm / len, y: -dyMm / len };
  }

  // Incident edge directions at an anchor (screen-px unit vectors). Lines
  // through the anchor repel in both directions; segments repel away from
  // the anchor along their span. Pushes labels into the open wedge.
  function incidentDirs(anchorMm, entities, selfId) {
    var out = [];
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e || e.id === selfId) continue;
      var t = e.type;
      if (t !== 'SEGMENT' && t !== 'DIMENSION' && t !== 'LINE' &&
          t !== 'RAY' && t !== 'DATUM_AXIS') continue;
      if (!isFinite(e.x) || !isFinite(e.y) ||
          !isFinite(e.x2) || !isFinite(e.y2)) continue;
      if (t === 'LINE') {
        // Infinite line: count it when the anchor sits on the line.
        var dx = e.x2 - e.x, dy = e.y2 - e.y;
        var len2 = dx * dx + dy * dy;
        if (!(len2 > 0)) continue;
        var tt = ((anchorMm.x - e.x) * dx + (anchorMm.y - e.y) * dy) / len2;
        var perp = distMm(anchorMm.x, anchorMm.y, e.x + tt * dx, e.y + tt * dy);
        if (perp > INCIDENT_EPS_MM) continue;
        var d = toScreenDir(dx, dy);
        if (d) out.push({ x: d.x, y: d.y, both: true });
        continue;
      }
      var d1 = distMm(anchorMm.x, anchorMm.y, e.x, e.y);
      var d2 = distMm(anchorMm.x, anchorMm.y, e.x2, e.y2);
      if (Math.min(d1, d2) <= INCIDENT_EPS_MM) {
        var away = (d1 <= d2) ?
          toScreenDir(e.x2 - e.x, e.y2 - e.y) :
          toScreenDir(e.x - e.x2, e.y - e.y2);
        if (away) out.push({ x: away.x, y: away.y, both: false });
      } else if (t !== 'RAY' && t !== 'DATUM_AXIS' &&
          distPointSegMm(anchorMm.x, anchorMm.y, e.x, e.y, e.x2, e.y2) <= INCIDENT_EPS_MM) {
        // Anchor lies mid-span (dimension midpoint, point on locus).
        var span = toScreenDir(e.x2 - e.x, e.y2 - e.y);
        if (span) out.push({ x: span.x, y: span.y, both: true });
      }
    }
    return out;
  }

  // True when any drawn stroke slices the candidate box. Invisible
  // entities are skipped; the anchor's own point has no stroke.
  function geometryCrossesBox(box, entities, view) {
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e || e.visible === false) continue;
      var t = e.type;
      if (t === 'SEGMENT' || t === 'DIMENSION' || t === 'DATUM_AXIS') {
        if (!isFinite(e.x) || !isFinite(e.y) ||
            !isFinite(e.x2) || !isFinite(e.y2)) continue;
        var a = forward(view, e.x, e.y);
        var b = forward(view, e.x2, e.y2);
        if (Math.max(a.x, b.x) < box.x || Math.min(a.x, b.x) > box.x + box.w ||
            Math.max(a.y, b.y) < box.y || Math.min(a.y, b.y) > box.y + box.h) continue;
        if (segBoxIntersect(a, b, box)) return true;
      } else if (t === 'LINE') {
        if (!isFinite(e.x) || !isFinite(e.y) ||
            !isFinite(e.x2) || !isFinite(e.y2)) continue;
        if (lineBoxIntersect(forward(view, e.x, e.y), forward(view, e.x2, e.y2), box)) return true;
      } else if (t === 'RAY') {
        if (!isFinite(e.x) || !isFinite(e.y) ||
            !isFinite(e.x2) || !isFinite(e.y2)) continue;
        var o = forward(view, e.x, e.y);
        var u = toScreenDir(e.x2 - e.x, e.y2 - e.y);
        if (!u) { if (pointInBox(o, box)) return true; continue; }
        if (rayBoxIntersect(o, u, box)) return true;
      } else if (t === 'CIRCLE' || t === 'CIRCULAR_ARC') {
        if (!isFinite(e.x) || !isFinite(e.y) || !isFinite(e.radius)) continue;
        if (circleBoxIntersect(forward(view, e.x, e.y), Math.abs(e.radius) * view.s, box)) return true;
      }
    }
    return false;
  }

  function boxWorldBounds(box, view) {
    var p1 = inverse(view, box.x, box.y);
    var p2 = inverse(view, box.x + box.w, box.y + box.h);
    return {
      minX: Math.min(p1.x, p2.x), maxX: Math.max(p1.x, p2.x),
      minY: Math.min(p1.y, p2.y), maxY: Math.max(p1.y, p2.y)
    };
  }

  // Cost(k) = 30*C_incident + inf*C_overlap + 50*C_edge + 100*C_ground
  //   + C_pref. Overlap is checked unless skipOverlap (leader fallback).
  function costCandidate(box, dir, deg, job, placed, entities, view, skipOverlap) {
    var cost = 0;
    var inc = job.incident;
    for (var i = 0; i < inc.length; i++) {
      var dot = dir.x * inc[i].x + dir.y * inc[i].y;
      var hit = inc[i].both ? Math.abs(dot) > INCIDENT_DOT : dot > INCIDENT_DOT;
      if (hit) { cost += W_INCIDENT; break; }
    }
    if (!skipOverlap) {
      for (var j = 0; j < placed.length; j++) {
        if (boxesOverlap(box, placed[j].box, OVERLAP_PAD_PX)) return Infinity;
      }
    }
    if (geometryCrossesBox(box, entities, view)) cost += W_EDGE_CROSS;
    if (job.groundRule === 'above' || job.groundRule === 'below') {
      var wb = boxWorldBounds(box, view);
      if (job.groundRule === 'above' && wb.minY < 0) cost += W_GROUND;
      if (job.groundRule === 'below' && wb.maxY > 0) cost += W_GROUND;
    }
    cost += SECTOR_PREF[deg];
    return cost;
  }

  // Ground-line rule applies only when the anchor sits on its expected
  // side (Q2/Q4 legitimately place both views on one side of XY).
  function groundRuleFor(e, anchorMm) {
    if (e.viewRole === 'ELEVATION' && anchorMm.y >= 0) return 'above';
    if (e.viewRole === 'PLAN' && anchorMm.y <= 0) return 'below';
    return null;
  }

  function collectJobs(entities) {
    var fixed = [], points = [], dims = [], loci = [], datums = [];
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      var kind = labelKind(e);
      if (kind === null) continue;
      if (kind === 'text') {
        fixed.push({ entity: e, kind: kind, text: e.caption,
          anchorMm: { x: e.x, y: e.y }, fixed: true });
      } else if (kind === 'point') {
        points.push({ entity: e, kind: kind, text: e.caption,
          anchorMm: { x: e.x, y: e.y }, sectors: SECTORS_DEG });
      } else if (kind === 'dimension') {
        dims.push({ entity: e, kind: kind, text: e.caption,
          anchorMm: { x: (e.x + e.x2) / 2, y: (e.y + e.y2) / 2 },
          sectors: SECTORS_DEG });
      } else if (kind === 'locus') {
        loci.push({ entity: e, kind: kind, text: labelText(e, kind),
          anchorMm: locusOuterEnd(e), sectors: SECTORS_DEG });
      } else if (kind === 'datum') {
        var ends = datumEnds(e);
        datums.push({ entity: e, kind: kind, text: 'X',
          anchorMm: ends.left, sectors: [225, 270, 180] });
        datums.push({ entity: e, kind: kind, text: 'Y',
          anchorMm: ends.right, sectors: [315, 270, 0] });
      }
    }
    return fixed.concat(points, dims, loci, datums);
  }

  function textDrawPos(box, h) {
    return { x: box.x, y: box.y + h * 0.8 };
  }

  // Tier 4: leader from the vertex to a label parked 25 mm out along the
  // least-bad sector, with a BIS Type B dot at the vertex end.
  function leaderPlacement(job, deg, box, cost, view) {
    var d = sectorDirPx(deg);
    var tip = {
      x: job.anchorMm.x + LEADER_R_MM * d.x,
      y: job.anchorMm.y - LEADER_R_MM * d.y
    };
    var tp = forward(view, tip.x, tip.y);
    var moved = candidateBox(tp.x, tp.y, deg, box.w, box.h, 0);
    var dp = textDrawPos(moved, box.h);
    return {
      entityId: job.entity.id || null, kind: job.kind, text: job.text,
      xPx: dp.x, yPx: dp.y, box: moved, sectorDeg: deg, cost: cost,
      viewRole: job.entity.viewRole || null, fixed: false,
      leader: {
        x1Mm: job.anchorMm.x, y1Mm: job.anchorMm.y,
        x2Mm: tip.x, y2Mm: tip.y, dotRpx: LEADER_DOT_R_PX
      }
    };
  }

  function placeJob(job, placed, entities, view, o) {
    var size = o.measure(job.text);
    var w = Math.max(1, size.w), h = Math.max(1, size.h);
    if (job.fixed) {
      var fp = forward(view, job.anchorMm.x, job.anchorMm.y);
      var fbox = { x: fp.x, y: fp.y - h, w: w, h: h };
      var fdp = textDrawPos(fbox, h);
      return {
        entityId: job.entity.id || null, kind: job.kind, text: job.text,
        xPx: fdp.x, yPx: fdp.y, box: fbox, sectorDeg: null, cost: 0,
        viewRole: job.entity.viewRole || null, fixed: true, leader: null
      };
    }
    var ap = forward(view, job.anchorMm.x, job.anchorMm.y);
    var best = null;
    var fallback = null;
    for (var i = 0; i < job.sectors.length; i++) {
      var deg = job.sectors[i];
      var dir = sectorDirPx(deg);
      var box = candidateBox(ap.x, ap.y, deg, w, h, o.radiusPx);
      var cost = costCandidate(box, dir, deg, job, placed, entities, view, false);
      var plain = costCandidate(box, dir, deg, job, placed, entities, view, true);
      if (fallback === null || plain < fallback.cost) {
        fallback = { deg: deg, box: box, cost: plain };
      }
      if (cost !== Infinity && (best === null || cost < best.cost)) {
        best = { deg: deg, box: box, cost: cost };
      }
    }
    if (best === null || best.cost > o.threshold) {
      var use = (best !== null && (fallback === null || best.cost <= fallback.cost)) ? best : fallback;
      return leaderPlacement(job, use.deg, use.box, use.cost, view);
    }
    var dp = textDrawPos(best.box, h);
    return {
      entityId: job.entity.id || null, kind: job.kind, text: job.text,
      xPx: dp.x, yPx: dp.y, box: best.box, sectorDeg: best.deg,
      cost: best.cost, viewRole: job.entity.viewRole || null,
      fixed: false, leader: null
    };
  }

  // resolve(entities, view, opts): full 3-tier layout + Tier 4 leaders.
  // opts: {radiusPx, fontPx, threshold, measure(text)->{w,h}}.
  function resolve(entities, view, opts) {
    var t0 = nowMs();
    if (!Array.isArray(entities)) throw new Error('entities must be an array');
    assertFinite(view.s, view.tx, view.ty, view.w, view.h);
    var o = opts || {};
    var fontPx = (o.fontPx === undefined || o.fontPx === null) ? FONT_PX : o.fontPx;
    var measure = (typeof o.measure === 'function') ? o.measure :
      function (t) { return estimateTextSize(t, fontPx); };
    var oc = {
      radiusPx: (o.radiusPx === undefined || o.radiusPx === null) ? RADIUS_PX : o.radiusPx,
      threshold: (o.threshold === undefined || o.threshold === null) ? LEADER_THRESHOLD : o.threshold,
      measure: measure
    };
    assertFinite(oc.radiusPx, oc.threshold);
    var jobs = collectJobs(entities);
    var placed = [];
    var leaders = 0;
    var maxCost = 0;
    for (var i = 0; i < jobs.length; i++) {
      var job = jobs[i];
      job.groundRule = job.fixed ? null : groundRuleFor(job.entity, job.anchorMm);
      job.incident = job.fixed ? [] :
        incidentDirs(job.anchorMm, entities, job.entity.id);
      var p = placeJob(job, placed, entities, view, oc);
      placed.push(p);
      if (p.leader) leaders++;
      if (p.cost > maxCost) maxCost = p.cost;
    }
    return {
      placements: placed,
      stats: { jobs: jobs.length, placed: placed.length, leaders: leaders,
        maxCost: maxCost, ms: nowMs() - t0 }
    };
  }

  return {
    WORLD_UNITS: WORLD_UNITS, VERSION: VERSION,
    SECTORS_DEG: SECTORS_DEG, SECTOR_STEP: SECTOR_STEP,
    SECTOR_PREF: SECTOR_PREF,
    RADIUS_PX: RADIUS_PX, FONT_PX: FONT_PX, DEFAULT_FONT: DEFAULT_FONT,
    HALO_WIDTH_PX: HALO_WIDTH_PX, HALO_STYLE: HALO_STYLE,
    TEXT_FILL: TEXT_FILL,
    W_INCIDENT: W_INCIDENT, W_EDGE_CROSS: W_EDGE_CROSS,
    W_GROUND: W_GROUND,
    LEADER_THRESHOLD: LEADER_THRESHOLD, LEADER_R_MM: LEADER_R_MM,
    LEADER_DOT_R_PX: LEADER_DOT_R_PX,
    INCIDENT_DOT: INCIDENT_DOT, INCIDENT_EPS_MM: INCIDENT_EPS_MM,
    OVERLAP_PAD_PX: OVERLAP_PAD_PX, SKIP_KINDS: SKIP_KINDS,
    assertFinite: assertFinite, forward: forward, inverse: inverse,
    labelKind: labelKind, labelText: labelText,
    estimateTextSize: estimateTextSize,
    locusOuterEnd: locusOuterEnd, datumEnds: datumEnds,
    sectorDirPx: sectorDirPx, candidateBox: candidateBox,
    boxesOverlap: boxesOverlap,
    segBoxIntersect: segBoxIntersect, lineBoxIntersect: lineBoxIntersect,
    rayBoxIntersect: rayBoxIntersect,
    circleBoxIntersect: circleBoxIntersect,
    incidentDirs: incidentDirs,
    geometryCrossesBox: geometryCrossesBox,
    boxWorldBounds: boxWorldBounds,
    costCandidate: costCandidate, groundRuleFor: groundRuleFor,
    collectJobs: collectJobs, resolve: resolve
  };
});

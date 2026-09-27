(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADMeasure = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD select-and-measure: the read-only View mode behind the
  // Edit/View toggle. Edit keeps every existing gesture; View inspects
  // one clicked entity at a time (coords, lengths, angles, radii) and
  // never mutates the entity table. All geometry here is pure: the page
  // owns rendering, this module owns the numbers. Zero deps. Dual-env:
  // browser via window.EduCADMeasure, plain Node via module.exports.
  var MODE_EDIT = 'edit';
  var MODE_VIEW = 'view';
  var MEASURE_TOL_PX = 14;
  var TWO_POINT_MEASURABLE = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION', 'DATUM_AXIS'];
  var ROUND_MEASURABLE = ['CIRCLE', 'CIRCULAR_ARC'];
  var TWO_POINT_TITLES = {
    SEGMENT: 'Segment', LINE: 'Line', RAY: 'Ray',
    DIMENSION: 'Dimension', DATUM_AXIS: 'Datum axis'
  };

  function createViewState() {
    return { mode: MODE_EDIT, inspectId: null, inspectSide: null };
  }
  function isView(st) {
    return !!st && st.mode === MODE_VIEW;
  }
  function isEdit(st) {
    return !st || st.mode !== MODE_VIEW;
  }
  // Switching modes always drops the inspected pick: a readout must
  // never survive into a mode that cannot explain it. Unknown modes
  // are ignored (the sheet keeps its current mode).
  function setMode(st, mode) {
    if (mode !== MODE_EDIT && mode !== MODE_VIEW) return st.mode;
    st.mode = mode;
    st.inspectId = null;
    st.inspectSide = null;
    return st.mode;
  }
  // The side (+1/-1) puts the dimension on the cursor's side of the
  // span; anything else stores a null side (centered default).
  function setInspect(st, id, side) {
    st.inspectId = (id === null || id === undefined) ? null : String(id);
    st.inspectSide = (side === 1 || side === -1) ? side : null;
    return st.inspectId;
  }
  function clearInspect(st) {
    st.inspectId = null;
    st.inspectSide = null;
    return true;
  }

  function finite(n) {
    return typeof n === 'number' && isFinite(n);
  }
  function fmtMm(v, digits) {
    var d = (digits === undefined || digits === null) ? 2 : digits;
    return Number(v).toFixed(d);
  }
  function fmtDeg(v, digits) {
    var d = (digits === undefined || digits === null) ? 1 : digits;
    return Number(v).toFixed(d);
  }
  // Undirected line orientation in [0, 180): a segment and its
  // reverse read the same angle, which is what a student checks.
  function lineAngleDeg(dx, dy) {
    var a = Math.atan2(dy, dx) * 180 / Math.PI;
    while (a < 0) a += 180;
    while (a >= 180) a -= 180;
    // Kill negative zero so badges never read "-0.0".
    return a + 0;
  }
  function viewTag(yMm) {
    if (yMm > 0) return 'Elevation (VP)';
    if (yMm < 0) return 'Plan (HP)';
    return 'On ground line XY';
  }
  function pointTitle(ent) {
    if (ent.caption !== undefined && ent.caption !== null && String(ent.caption) !== '') {
      return String(ent.caption);
    }
    if (ent.name !== undefined && ent.name !== null && String(ent.name) !== '') {
      return String(ent.name);
    }
    return 'Point';
  }

  // Pure readout for one entity: { kind, title, rows } with rows ready
  // to stack in a badge. Returns null for hidden entities, unmeasurable
  // types (TEXT and friends), and non-finite geometry. Never throws:
  // the click path must degrade to "nothing to show", not a crash.
  function inspectEntity(ent) {
    if (!ent || ent.visible === false) return null;
    if (ent.type === 'POINT') {
      if (!finite(ent.x) || !finite(ent.y)) return null;
      return {
        kind: 'point',
        title: pointTitle(ent),
        rows: ['X ' + fmtMm(ent.x) + ', Y ' + fmtMm(ent.y) + ' mm',
          viewTag(ent.y)]
      };
    }
    if (TWO_POINT_MEASURABLE.indexOf(ent.type) !== -1) {
      if (!finite(ent.x) || !finite(ent.y) || !finite(ent.x2) || !finite(ent.y2)) {
        return null;
      }
      var dx = ent.x2 - ent.x, dy = ent.y2 - ent.y;
      return {
        kind: 'line',
        title: TWO_POINT_TITLES[ent.type],
        rows: ['L ' + fmtMm(Math.sqrt(dx * dx + dy * dy)) + ' mm',
          'ΔX ' + fmtMm(dx) + ', ΔY ' + fmtMm(dy) + ' mm',
          '∠ ' + fmtDeg(lineAngleDeg(dx, dy)) + '° from +X']
      };
    }
    if (ent.type === 'CIRCLE' || ent.type === 'CIRCULAR_ARC') {
      if (!finite(ent.x) || !finite(ent.y) || !finite(ent.radius)) return null;
      if (!(ent.radius > 0)) return null;
      var rows = ['C (' + fmtMm(ent.x) + ', ' + fmtMm(ent.y) + ') mm',
        'r ' + fmtMm(ent.radius) + ' mm, Dia ' + fmtMm(2 * ent.radius) + ' mm'];
      if (ent.type === 'CIRCULAR_ARC') {
        if (!finite(ent.startAngle) || !finite(ent.endAngle)) return null;
        var sweep = Math.abs(ent.endAngle - ent.startAngle);
        rows.push('arc ' + fmtMm(ent.radius * sweep) + ' mm, ' +
          fmtDeg(ent.startAngle * 180 / Math.PI) + '° to ' +
          fmtDeg(ent.endAngle * 180 / Math.PI) + '°');
      }
      return { kind: 'round', title: ent.type === 'CIRCLE' ? 'Circle' : 'Arc', rows: rows };
    }
    return null;
  }

  function toPx(xMm, yMm, view) {
    return { x: xMm * view.s + view.tx, y: view.ty - yMm * view.s };
  }
  // Badge anchor in px: the point itself, a line midpoint, a round
  // center. Null when the entity has no measurable anchor.
  function inspectAnchor(ent, view) {
    if (!ent || !view || !finite(view.s) || !finite(view.tx) || !finite(view.ty)) {
      return null;
    }
    if (ent.type === 'POINT') {
      if (!finite(ent.x) || !finite(ent.y)) return null;
      return toPx(ent.x, ent.y, view);
    }
    if (TWO_POINT_MEASURABLE.indexOf(ent.type) !== -1) {
      if (!finite(ent.x) || !finite(ent.y) || !finite(ent.x2) || !finite(ent.y2)) {
        return null;
      }
      return toPx((ent.x + ent.x2) / 2, (ent.y + ent.y2) / 2, view);
    }
    if (ROUND_MEASURABLE.indexOf(ent.type) !== -1) {
      if (!finite(ent.x) || !finite(ent.y)) return null;
      return toPx(ent.x, ent.y, view);
    }
    return null;
  }

  // View-mode hit test: nearest visible POINT wins, then the nearest
  // two-point span, then the nearest round rim (a tiny circle also
  // grabs by its center). Same px math as the canvas hit tests, same
  // default tolerance. Skips unmeasurable types and bad geometry
  // silently; returns the entity id or null. Never throws.
  function hitTestAll(entities, cursorPx, view, tolPx) {
    if (!Array.isArray(entities) || !cursorPx || !view) return null;
    if (!finite(cursorPx.x) || !finite(cursorPx.y)) return null;
    if (!finite(view.s) || !finite(view.tx) || !finite(view.ty)) return null;
    var tol = (tolPx === undefined || tolPx === null) ? MEASURE_TOL_PX : tolPx;
    if (!finite(tol) || tol < 0) return null;
    var best = null, bestD = tol;
    var i, e, p, dx, dy, d;
    for (i = 0; i < entities.length; i++) {
      e = entities[i];
      if (!e || e.type !== 'POINT' || e.visible === false) continue;
      if (!finite(e.x) || !finite(e.y)) continue;
      p = toPx(e.x, e.y, view);
      dx = p.x - cursorPx.x;
      dy = p.y - cursorPx.y;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d <= tol && (best === null || d < bestD)) { best = e.id; bestD = d; }
    }
    if (best !== null) return best;
    for (i = 0; i < entities.length; i++) {
      e = entities[i];
      if (!e || e.visible === false) continue;
      if (TWO_POINT_MEASURABLE.indexOf(e.type) === -1) continue;
      if (!finite(e.x) || !finite(e.y) || !finite(e.x2) || !finite(e.y2)) continue;
      var ax = e.x * view.s + view.tx, ay = view.ty - e.y * view.s;
      var bx = e.x2 * view.s + view.tx, by = view.ty - e.y2 * view.s;
      var abx = bx - ax, aby = by - ay;
      var len2 = abx * abx + aby * aby;
      var t = 0;
      if (len2 > 0) {
        t = ((cursorPx.x - ax) * abx + (cursorPx.y - ay) * aby) / len2;
        if (t < 0) t = 0;
        if (t > 1) t = 1;
      }
      dx = ax + abx * t - cursorPx.x;
      dy = ay + aby * t - cursorPx.y;
      d = Math.sqrt(dx * dx + dy * dy);
      if (d <= tol && (best === null || d < bestD)) { best = e.id; bestD = d; }
    }
    if (best !== null) return best;
    for (i = 0; i < entities.length; i++) {
      e = entities[i];
      if (!e || e.visible === false) continue;
      if (ROUND_MEASURABLE.indexOf(e.type) === -1) continue;
      if (!finite(e.x) || !finite(e.y) || !finite(e.radius)) continue;
      if (!(e.radius > 0) || !finite(view.s)) continue;
      p = toPx(e.x, e.y, view);
      dx = p.x - cursorPx.x;
      dy = p.y - cursorPx.y;
      d = Math.sqrt(dx * dx + dy * dy);
      var rim = Math.abs(d - e.radius * view.s);
      var score = (d < rim) ? d : rim;
      if (score <= tol && (best === null || score < bestD)) { best = e.id; bestD = score; }
    }
    return best;
  }

  // ---- Drafting-style dimension layout (pure px geometry) ----
  // All three layouts return null on bad input and never throw, so
  // the overlay click path degrades to the plain badge. Text stays
  // horizontal (a legitimate drafting variant) and the caller draws
  // it left-aligned at textPos, which is pre-shifted to center it.
  var DIM_OFFSET_MM = 10;
  var DIM_EXT_GAP_MM = 1.5;
  var DIM_EXT_OVER_MM = 2.5;
  var DIM_ARROW_PX = 10;
  var DIM_LINE_H_PX = 15;

  function validView(view) {
    return !!view && finite(view.s) && view.s > 0 &&
      finite(view.tx) && finite(view.ty);
  }
  function twoPointEnds(ent) {
    if (!ent || TWO_POINT_MEASURABLE.indexOf(ent.type) === -1) return null;
    if (!finite(ent.x) || !finite(ent.y) || !finite(ent.x2) || !finite(ent.y2)) {
      return null;
    }
    return ent;
  }
  // Which side of the directed span the cursor is on (+1/-1), in the
  // same screen space the linear layout derives its normal from, so
  // the dimension always opens toward the click. Anything
  // non-measurable answers +1 (unused).
  function dimSideFor(ent, view, cursorPx) {
    var ends = twoPointEnds(ent);
    if (ends === null || !validView(view) || !cursorPx) return 1;
    if (!finite(cursorPx.x) || !finite(cursorPx.y)) return 1;
    var ax = ends.x * view.s + view.tx, ay = view.ty - ends.y * view.s;
    var bx = ends.x2 * view.s + view.tx, by = view.ty - ends.y2 * view.s;
    var cross = (bx - ax) * (cursorPx.y - ay) - (by - ay) * (cursorPx.x - ax);
    return cross >= 0 ? 1 : -1;
  }
  function dimTextWidth(text, measure) {
    if (typeof measure === 'function') {
      try {
        var w = measure(text);
        if (finite(w) && w >= 0) return w;
      } catch (err) { /* fall through to the estimate */ }
    }
    return String(text).length * 6.6 + 2;
  }
  // Linear dimension: extension lines off both ends, a parallel
  // dimension line on the picked side, arrow tips at both ends, and
  // the bare value centered. o: { side, offsetMm?, measure?, lineH? }.
  // When the value cannot fit between the arrows it parks past the
  // far end with a leader back to it (fitsInside false).
  function linearDimLayout(ent, view, o) {
    var ends = twoPointEnds(ent);
    if (ends === null || !validView(view)) return null;
    o = o || {};
    var side = (o.side === -1) ? -1 : 1;
    var offMm = (o.offsetMm === undefined || o.offsetMm === null) ?
      DIM_OFFSET_MM : o.offsetMm;
    if (!finite(offMm)) return null;
    var lineH = (o.lineH === undefined || o.lineH === null) ?
      DIM_LINE_H_PX : o.lineH;
    if (!finite(lineH) || lineH <= 0) return null;
    var dxMm = ends.x2 - ends.x, dyMm = ends.y2 - ends.y;
    var lenMm = Math.sqrt(dxMm * dxMm + dyMm * dyMm);
    if (!(lenMm > 1e-9)) return null;
    var A = toPx(ends.x, ends.y, view);
    var B = toPx(ends.x2, ends.y2, view);
    var dx = B.x - A.x, dy = B.y - A.y;
    var lenPx = Math.sqrt(dx * dx + dy * dy);
    if (!(lenPx > 1e-9)) return null;
    var ux = dx / lenPx, uy = dy / lenPx;
    var nx = -uy * side + 0, ny = ux * side + 0;
    var offPx = offMm * view.s;
    var D1 = { x: A.x + nx * offPx, y: A.y + ny * offPx };
    var D2 = { x: B.x + nx * offPx, y: B.y + ny * offPx };
    var gapPx = Math.max(2, DIM_EXT_GAP_MM * view.s);
    var overPx = Math.max(3, DIM_EXT_OVER_MM * view.s);
    var ext = [
      [{ x: A.x + nx * gapPx, y: A.y + ny * gapPx },
        { x: A.x + nx * (offPx + overPx), y: A.y + ny * (offPx + overPx) }],
      [{ x: B.x + nx * gapPx, y: B.y + ny * gapPx },
        { x: B.x + nx * (offPx + overPx), y: B.y + ny * (offPx + overPx) }]
    ];
    var text = fmtMm(lenMm);
    var textW = dimTextWidth(text, o.measure);
    var fitsInside = lenPx > textW + 2 * DIM_ARROW_PX + 6;
    // Perpendicular lift clears the glyph block off the line; the up
    // bias keeps near-horizontal text from straddling it.
    var lift = (ny > 0.35) ? (4 + lineH * 0.8) : 4;
    var upBias = (ny > -0.35 && ny <= 0.35) ? 4 : 0;
    var textPos, leader = null;
    if (fitsInside) {
      var mx = (D1.x + D2.x) / 2, my = (D1.y + D2.y) / 2;
      textPos = { x: mx - textW / 2 + nx * lift, y: my + ny * lift - upBias };
    } else {
      var bx = D2.x + ux * (DIM_ARROW_PX + 6);
      var by = D2.y + uy * (DIM_ARROW_PX + 6);
      textPos = { x: bx + nx * lift, y: by + ny * lift - upBias };
      leader = { from: { x: D2.x, y: D2.y },
        to: { x: textPos.x, y: textPos.y } };
    }
    return {
      p1: A, p2: B, lenMm: lenMm,
      dir: { x: ux, y: uy }, normal: { x: nx, y: ny }, side: side,
      d1: D1, d2: D2, ext: ext,
      text: text, textPos: textPos, textWpx: textW,
      fitsInside: fitsInside, leader: leader,
      secondaryPos: { x: textPos.x + nx * lineH, y: textPos.y + ny * lineH },
      lineHpx: lineH
    };
  }
  // Radius leader: center mark, a leader from the rim at the cursor's
  // angle (NE by default) with a horizontal shelf, and R + value.
  // o: { cursorPx?, measure?, lineH? }.
  function radiusLeaderLayout(ent, view, o) {
    if (!ent || ROUND_MEASURABLE.indexOf(ent.type) === -1) return null;
    if (!finite(ent.x) || !finite(ent.y) || !finite(ent.radius)) return null;
    if (!(ent.radius > 0) || !validView(view)) return null;
    o = o || {};
    var lineH = (o.lineH === undefined || o.lineH === null) ?
      DIM_LINE_H_PX : o.lineH;
    if (!finite(lineH) || lineH <= 0) return null;
    var C = toPx(ent.x, ent.y, view);
    var rPx = ent.radius * view.s;
    var ang = -Math.PI / 4;
    if (o.cursorPx && finite(o.cursorPx.x) && finite(o.cursorPx.y)) {
      var vx = o.cursorPx.x - C.x, vy = o.cursorPx.y - C.y;
      if (vx * vx + vy * vy > 1e-9) ang = Math.atan2(vy, vx);
    }
    var dir = { x: Math.cos(ang), y: Math.sin(ang) };
    var rim = { x: C.x + dir.x * rPx, y: C.y + dir.y * rPx };
    var elbow = { x: rim.x + dir.x * 12, y: rim.y + dir.y * 12 };
    var text = 'R ' + fmtMm(ent.radius);
    var textW = dimTextWidth(text, o.measure);
    var shelfX = (dir.x >= 0) ? elbow.x + textW + 8 : elbow.x - textW - 8;
    return {
      center: C, rim: rim, dir: dir, angleRad: ang,
      elbow: elbow, shelfEnd: { x: shelfX, y: elbow.y },
      text: text, textWpx: textW,
      textPos: { x: (dir.x >= 0) ? elbow.x + 2 : shelfX + 2,
        y: elbow.y - 4 },
      centerMark: [
        [{ x: C.x - 5, y: C.y }, { x: C.x + 5, y: C.y }],
        [{ x: C.x, y: C.y - 5 }, { x: C.x, y: C.y + 5 }]],
      lineHpx: lineH
    };
  }
  // Point witness: a thin line from the point straight to the XY
  // ground line at the same x, labeled with the |Y| height — the
  // point's distance to its own plane. Null on the fold or when the
  // witness would be a stub (o.minPx, default 10). o: { minPx? }.
  function pointWitnessLayout(ent, view, o) {
    if (!ent || ent.type !== 'POINT') return null;
    if (!finite(ent.x) || !finite(ent.y)) return null;
    if (!validView(view)) return null;
    o = o || {};
    var minPx = (o.minPx === undefined || o.minPx === null) ? 10 : o.minPx;
    if (!finite(minPx) || minPx < 0) return null;
    var P = toPx(ent.x, ent.y, view);
    var F = { x: P.x, y: view.ty };
    if (Math.abs(P.y - F.y) < minPx) return null;
    return {
      pt: P, foot: F, distMm: Math.abs(ent.y),
      text: fmtMm(Math.abs(ent.y)),
      textPos: { x: (P.x + F.x) / 2 + 5, y: (P.y + F.y) / 2 }
    };
  }

  return {
    MODE_EDIT: MODE_EDIT,
    MODE_VIEW: MODE_VIEW,
    MEASURE_TOL_PX: MEASURE_TOL_PX,
    DIM_OFFSET_MM: DIM_OFFSET_MM,
    DIM_ARROW_PX: DIM_ARROW_PX,
    createViewState: createViewState,
    isView: isView,
    isEdit: isEdit,
    setMode: setMode,
    setInspect: setInspect,
    clearInspect: clearInspect,
    inspectEntity: inspectEntity,
    inspectAnchor: inspectAnchor,
    hitTestAll: hitTestAll,
    lineAngleDeg: lineAngleDeg,
    dimSideFor: dimSideFor,
    linearDimLayout: linearDimLayout,
    radiusLeaderLayout: radiusLeaderLayout,
    pointWitnessLayout: pointWitnessLayout,
    fmtMm: fmtMm,
    fmtDeg: fmtDeg
  };
});

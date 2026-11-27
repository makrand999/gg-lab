(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./educad-geometry.js'));
  } else {
    root.EduCADMeasure = factory(root.EduCADGeometry);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (Geometry) {
  'use strict';






  var MODE_EDIT = 'edit';
  var MODE_VIEW = 'view';
  var MODE_POSE = 'pose';
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
    return !!st && (st.mode === MODE_VIEW || st.mode === MODE_POSE);
  }
  function isEdit(st) {
    return !st || st.mode === MODE_EDIT;
  }
  function isPose(st) {
    return !!st && st.mode === MODE_POSE;
  }



  function setMode(st, mode) {
    if (mode !== MODE_EDIT && mode !== MODE_VIEW && mode !== MODE_POSE) {
      return st.mode;
    }
    st.mode = mode;
    st.inspectId = null;
    st.inspectSide = null;
    return st.mode;
  }


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


  function lineAngleDeg(dx, dy) {
    var a = Math.atan2(dy, dx) * 180 / Math.PI;
    while (a < 0) a += 180;
    while (a >= 180) a -= 180;

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





  function inspectEntity(ent) {
    if (!ent || ent.visible === false) return null;
    if(ent.type==='CURVE'&&ent.meta&&ent.meta.curve) return {kind:'curve',title:'Interpolated curve',rows:[ent.meta.curve.closed?'Closed periodic cubic':'Open natural cubic',String((ent.meta.throughRefs||[]).length)+' defining points','Edit the defining points to change the curve.']};
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
        var sweep = Geometry.arcSweep(ent.startAngle, ent.endAngle);
        rows.push('arc ' + fmtMm(ent.radius * sweep * Geometry.RAD) + ' mm, ' +
          fmtDeg(ent.startAngle) + '° to ' + fmtDeg(ent.endAngle) + '°');
      }
      return { kind: 'round', title: ent.type === 'CIRCLE' ? 'Circle' : 'Arc', rows: rows };
    }
    return null;
  }

  function toPx(xMm, yMm, view) {
    return { x: xMm * view.s + view.tx, y: view.ty - yMm * view.s };
  }


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






  function hitTestAll(entities, cursorPx, view, tolPx) {
    if (!Array.isArray(entities) || !cursorPx || !view) return null;
    if (!finite(cursorPx.x) || !finite(cursorPx.y)) return null;
    if (!finite(view.s) || view.s <= 0 || !finite(view.tx) || !finite(view.ty)) return null;
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
      d = Geometry.spanDistance(cursorPx, { x: ax, y: ay }, { x: bx, y: by }, e.type);
      if (e.type === 'DIMENSION') {
        var offset = e.meta && e.meta.offsetMm !== undefined ? e.meta.offsetMm : 10;
        var length = Math.hypot(bx - ax, by - ay);
        if (length && finite(offset)) {
          var ox = (by - ay) / length * offset * view.s, oy = -(bx - ax) / length * offset * view.s;
          d = Math.min(d, Geometry.spanDistance(cursorPx, { x: ax + ox, y: ay + oy }, { x: bx + ox, y: by + oy }, 'SEGMENT'));
        }
      }
      if (d <= tol && (best === null || d < bestD)) { best = e.id; bestD = d; }
    }
    if (best !== null) return best;
    for (i = 0; i < entities.length; i++) {
      e = entities[i];
      if (!e || e.visible === false) continue;
      if(e.type==='CURVE') {
        var query={x:(cursorPx.x-view.tx)/view.s,y:(view.ty-cursorPx.y)/view.s};
        var pieces=Geometry.curveSegments(e,0.5/view.s),distance=Infinity;
        pieces.forEach(function(piece){distance=Math.min(distance,Geometry.spanDistance(query,piece.a,piece.b,'SEGMENT')*view.s);});
        if(distance<=tol&&(best===null||distance<bestD)){best=e.id;bestD=distance;}
        continue;
      }
      if (ROUND_MEASURABLE.indexOf(e.type) === -1) continue;
      if (!finite(e.x) || !finite(e.y) || !finite(e.radius)) continue;
      if (!(e.radius > 0) || !finite(view.s)) continue;
      p = toPx(e.x, e.y, view);
      dx = p.x - cursorPx.x;
      dy = p.y - cursorPx.y;
      d = Math.sqrt(dx * dx + dy * dy);
      var score = Geometry.roundDistance({ x: (cursorPx.x - view.tx) / view.s, y: (view.ty - cursorPx.y) / view.s }, e) * view.s;
      if (e.type === 'CIRCLE' && e.radius * view.s <= tol) score = Math.min(d, score);
      if (score <= tol && (best === null || score < bestD)) { best = e.id; bestD = score; }
    }
    return best;
  }






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
      } catch (err) {                                    }
    }
    return String(text).length * 6.6 + 2;
  }





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
    if (ent.type === 'CIRCULAR_ARC' && !Geometry.angleOnArc(-ang / Geometry.RAD, ent.startAngle, ent.endAngle)) {
      ang = -(ent.startAngle + Geometry.arcSweep(ent.startAngle, ent.endAngle) / 2) * Geometry.RAD;
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

  function guideLabel(from, to, text, measure, size, viewport, occupied) {
    var w = measure(text) + 10, h = size + 8;
    var dx = to.x - from.x, dy = to.y - from.y;
    var positions = Math.hypot(dx, dy) > 24 ? [0.5, 0.32, 0.68] : [];
    var mid = { x: from.x + dx / 2, y: from.y + dy / 2 };
    var centers = positions.map(function (t) { return { x: from.x + t * dx, y: from.y + t * dy }; });
    centers.push({ x: mid.x + w / 2 + 6, y: mid.y - h / 2 - 4 },
      { x: mid.x - w / 2 - 6, y: mid.y + h / 2 + 4 },
      { x: mid.x + w / 2 + 6, y: mid.y + h / 2 + 4 },
      { x: mid.x - w / 2 - 6, y: mid.y - h / 2 - 4 });
    for (var i = 0; i < centers.length; i++) {
      var x = centers[i].x - w / 2, y = centers[i].y - h / 2;
      var rect = { x0: x, y0: y, x1: x + w, y1: y + h };
      if (x < 2 || y < 2 || rect.x1 > viewport.w - 2 || rect.y1 > viewport.h - 2) continue;
      if (occupied.some(function (r) { return x < r.x1 + 2 && r.x0 < rect.x1 + 2 && y < r.y1 + 2 && r.y0 < rect.y1 + 2; })) continue;
      occupied.push(rect);
      return { anchor: i < positions.length ? centers[i] : mid, rect: rect, lines: [text] };
    }
    return null;
  }

  return {
    MODE_EDIT: MODE_EDIT,
    MODE_VIEW: MODE_VIEW,
    MODE_POSE: MODE_POSE,
    MEASURE_TOL_PX: MEASURE_TOL_PX,
    DIM_OFFSET_MM: DIM_OFFSET_MM,
    DIM_ARROW_PX: DIM_ARROW_PX,
    createViewState: createViewState,
    isView: isView,
    isEdit: isEdit,
    isPose: isPose,
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
    guideLabel: guideLabel,
    pointWitnessLayout: pointWitnessLayout,
    fmtMm: fmtMm,
    fmtDeg: fmtDeg
  };
});

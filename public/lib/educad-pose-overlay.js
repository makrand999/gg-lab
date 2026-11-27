(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./educad-pose.js'),
      require('./educad-measure.js'),
      require('./educad-orthographic.js'),
      require('./educad-spatial.js'),
      require('./educad-solid.js'),
      require('./educad-settings.js')
    );
  } else {
    root.EduCADPoseOverlay = factory(
      root.EduCADPose,
      root.EduCADMeasure,
      root.EduCADOrthographic,
      root.EduCADSpatial,
      root.EduCADSolid,
      root.EduCADSettings
    );
  }
})(typeof window !== 'undefined' ? window : globalThis, function (EduCADPose, EduCADMeasure, EduCADOrthographic, EduCADSpatial, EduCADSolid, Settings) {
  'use strict';
  var THEME_ROOT = typeof window !== 'undefined' ? window :
    (typeof globalThis !== 'undefined' ? globalThis : null);

  function themeColor(name, fallback) {
    var theme = THEME_ROOT && THEME_ROOT.EduCADTheme;
    return (theme && typeof theme.color === 'function') ? theme.color(name, fallback) : fallback;
  }

  function trackedSummary(poseState, map, prefs) {
    if (!poseState || !poseState.mm || typeof EduCADOrthographic === 'undefined') return '';
    var posedVerts = (poseState.sims && poseState.sims.posed)
      ? poseState.sims.posed
      : EduCADPose.applyPose(poseState.mm.vertices, poseState.pose, poseState.center);
    prefs = prefs || { precision: 2, textSize: 11 };
    map = map || { three: false };
    if (poseState.trackedCorner) {
      var tc = poseState.trackedCorner;
      var vS = posedVerts[tc.vertexIndex], vA = posedVerts[tc.otherA], vB = posedVerts[tc.otherB];
      if (!vS || !vA || !vB) return '';
      var cCallout = EduCADOrthographic.cornerAngleCallout({
        viewRole: tc.viewRole, vShared: vS, va: vA, vb: vB, map: map,
        angle3D: tc.angle3D, labelA: tc.labelA, labelB: tc.labelB, precision: prefs.precision
      });
      return cCallout ? cCallout.lines.join(' · ') : '';
    }
    if (poseState.trackedSpan) {
      var ts = poseState.trackedSpan;
      var sA = posedVerts[ts.vertexA], sB = posedVerts[ts.vertexB];
      if (!sA || !sB) return '';
      var rA = poseState.mm.vertices[ts.vertexA], rB = poseState.mm.vertices[ts.vertexB];
      var restD = ts.restDist3D || Math.hypot(rB.x - rA.x, rB.y - rA.y, rB.z - rA.z);
      var liveD = Math.hypot(sB.x - sA.x, sB.y - sA.y, sB.z - sA.z);
      var sp0 = EduCADOrthographic.toView3D(sA, ts.viewRole, map);
      var sp1 = EduCADOrthographic.toView3D(sB, ts.viewRole, map);
      var sCallout = EduCADOrthographic.pointSpanCalloutLines({
        viewRole: ts.viewRole,
        projLen: Math.hypot(sp1.x - sp0.x, sp1.y - sp0.y),
        trueLen: liveD,
        restTrueLen: restD,
        scale: poseState.pose.s,
        precision: prefs.precision
      });
      return sCallout ? sCallout.lines.join(' · ') : '';
    }
    if (!poseState.trackedEdge) return '';
    var tracked = poseState.trackedEdge;
    var edge = poseState.mm.edges && poseState.mm.edges[tracked.edgeIndex];
    if (!edge) return '';
    var va = posedVerts[tracked.reversed ? edge[1] : edge[0]];
    var vb = posedVerts[tracked.reversed ? edge[0] : edge[1]];
    if (!va || !vb) return '';
    var restA = poseState.mm.vertices[tracked.reversed ? edge[1] : edge[0]];
    var restB = poseState.mm.vertices[tracked.reversed ? edge[0] : edge[1]];
    var restTrueLen = tracked.restTrueLength || Math.hypot(restB.x - restA.x, restB.y - restA.y, restB.z - restA.z);
    var trueLen = Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
    var p0 = EduCADOrthographic.toView3D(va, tracked.viewRole, map);
    var p1 = EduCADOrthographic.toView3D(vb, tracked.viewRole, map);
    var projLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    var callout = EduCADOrthographic.edgeCalloutLines({
      name: tracked.label || ('Edge ' + (tracked.edgeIndex + 1)),
      viewRole: tracked.viewRole,
      projLen: projLen,
      trueLen: trueLen,
      restTrueLen: restTrueLen,
      scale: poseState.pose.s,
      precision: prefs.precision
    });
    return callout.lines.join(' · ');
  }

  function hitTestTrackedView(poseState, cursor, view, map, tolPx) {
    if (!poseState || (!poseState.trackedEdge && !poseState.trackedCorner && !poseState.trackedSpan) || poseState.gesture ||
        !poseState.mm || typeof EduCADOrthographic === 'undefined') return null;
    var targets = poseState.trackedTargets;
    if (!targets || !targets.length) {
      var posedVerts = (poseState.sims && poseState.sims.posed)
        ? poseState.sims.posed
        : EduCADPose.applyPose(poseState.mm.vertices, poseState.pose, poseState.center);
      map = map || { three: false };
      var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
      var v = view;
      if (poseState.trackedCorner) {
        var tc = poseState.trackedCorner;
        var vS = posedVerts[tc.vertexIndex], vA = posedVerts[tc.otherA], vB = posedVerts[tc.otherB];
        if (!vS || !vA || !vB) return null;
        targets = [];
        views.forEach(function (vr) {
          var s2 = EduCADOrthographic.toView3D(vS, vr, map);
          var a2 = EduCADOrthographic.toView3D(vA, vr, map);
          var b2 = EduCADOrthographic.toView3D(vB, vr, map);
          var pS = { x: s2.x * v.s + v.tx, y: v.ty - s2.y * v.s };
          var pA = { x: a2.x * v.s + v.tx, y: v.ty - a2.y * v.s };
          var pB = { x: b2.x * v.s + v.tx, y: v.ty - b2.y * v.s };
          var act = vr === tc.viewRole;
          targets.push({ viewRole: vr, p0: pS, p1: pA, isPoint: Math.hypot(pA.x - pS.x, pA.y - pS.y) < 1.5, tagRect: null, active: act });
          targets.push({ viewRole: vr, p0: pS, p1: pB, isPoint: Math.hypot(pB.x - pS.x, pB.y - pS.y) < 1.5, tagRect: null, active: act });
        });
      } else if (poseState.trackedSpan) {
        var ts = poseState.trackedSpan;
        var svA = posedVerts[ts.vertexA], svB = posedVerts[ts.vertexB];
        if (!svA || !svB) return null;
        targets = views.map(function (vr) {
          var a2 = EduCADOrthographic.toView3D(svA, vr, map);
          var b2 = EduCADOrthographic.toView3D(svB, vr, map);
          var p0 = { x: a2.x * v.s + v.tx, y: v.ty - a2.y * v.s };
          var p1 = { x: b2.x * v.s + v.tx, y: v.ty - b2.y * v.s };
          return {
            viewRole: vr, p0: p0, p1: p1,
            isPoint: Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1.5,
            tagRect: null, active: vr === ts.viewRole
          };
        });
      } else {
        var tracked = poseState.trackedEdge;
        var edge = poseState.mm.edges && poseState.mm.edges[tracked.edgeIndex];
        if (!edge) return null;
        var va = posedVerts[tracked.reversed ? edge[1] : edge[0]];
        var vb = posedVerts[tracked.reversed ? edge[0] : edge[1]];
        if (!va || !vb) return null;
        targets = views.map(function (vr) {
          var a2 = EduCADOrthographic.toView3D(va, vr, map);
          var b2 = EduCADOrthographic.toView3D(vb, vr, map);
          var p0 = { x: a2.x * v.s + v.tx, y: v.ty - a2.y * v.s };
          var p1 = { x: b2.x * v.s + v.tx, y: v.ty - b2.y * v.s };
          return {
            viewRole: vr,
            p0: p0,
            p1: p1,
            isPoint: Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1.5,
            tagRect: null,
            active: vr === tracked.viewRole
          };
        });
      }
    }
    return EduCADOrthographic.hitTestPoseEdgeTargets(cursor, targets, tolPx);
  }

  function pickProjectedPoint(state, cursor, view, map, tolerance) {
    if (!state.sims || !state.sims.posed) return null;
    var best = Infinity, chosen = null, runnerUp = Infinity;
    var roles = map.three ? ['PLAN', 'ELEVATION', 'PROFILE'] : ['PLAN', 'ELEVATION'];
    state.sims.posed.forEach(function (v, index) {
      var distance = Infinity;
      roles.forEach(function (role) {
        var p = EduCADOrthographic.toView3D(v, role, map);
        distance = Math.min(distance, Math.hypot(cursor.x - (view.tx + view.s * p.x), cursor.y - (view.ty - view.s * p.y)));
      });
      if (distance < best) { runnerUp = best; best = distance; chosen = index; }
      else runnerUp = Math.min(runnerUp, distance);
    });
    return best <= (tolerance || 12) && runnerUp - best > 2 ? chosen : null;
  }

  function posedScene(st, state) {
    var vertices = state.sims && state.sims.posed || EduCADPose.applyPose(state.mm.vertices, state.pose, state.center);
    var scene = Object.create(st);
    scene.geometryTransform = state.rest || st.geometryTransform;
    scene.geometryMm = { vertices: vertices, edges: state.mm.edges };
    return scene;
  }

  function drawPlanes(ctx, st, state, prefs) {
    if (!state || !prefs.planes) return;
    var scene = posedScene(st, state), refs = EduCADSpatial.references(scene.geometryMm);
    if (refs) EduCADSpatial.underlay(ctx, scene, EduCADSolid, refs);
  }

  function drawGlassOverlay(ctx, st, poseState, prefs) {
    if (!poseState || !st || !poseState.mm || !poseState.mm.vertices.length) return;
    prefs = prefs || Settings.normalizeInspection();
    var mm = poseState.mm, center = poseState.center;
    st = posedScene(st, poseState);
    if (!st.geometryTransform) return;
    var proj = function (pt) { return EduCADSpatial.projectMm(pt, st, EduCADSolid); };
    var afterVerts = st.geometryMm.vertices, after2 = afterVerts.map(proj);
    function seg(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }

    var point = Number.isInteger(poseState.pointIndex) ? { kind: 'point', index: poseState.pointIndex } : null;
    var edge = poseState.trackedEdge && { kind: 'edge', index: poseState.trackedEdge.edgeIndex, label: poseState.trackedEdge.label };
    if (point || edge) {
      var display = Object.assign({}, prefs, { overlay: 'pinned' });
      ctx.save(); ctx.font = display.textSize + 'px system-ui, sans-serif';
      var layout = EduCADSpatial.overlayLayout(st, EduCADSolid, EduCADSpatial.references(st.geometryMm),
        edge || point, edge && point ? [point] : [], display, function (t) { return ctx.measureText(t).width; });
      ctx.restore();
      EduCADSpatial.drawOverlay(ctx, layout, display);
    }
    if (poseState.trackedCorner && afterVerts[poseState.trackedCorner.vertexIndex] &&
        afterVerts[poseState.trackedCorner.otherA] && afterVerts[poseState.trackedCorner.otherB]) {
      var tc3 = poseState.trackedCorner;
      var accentC = themeColor('accent', '#0284c7');
      var vS3 = afterVerts[tc3.vertexIndex], vA3 = afterVerts[tc3.otherA], vB3 = afterVerts[tc3.otherB];
      var sS3 = after2[tc3.vertexIndex], sA3 = after2[tc3.otherA], sB3 = after2[tc3.otherB];
      ctx.save();
      ctx.strokeStyle = accentC;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([]);
      seg(sS3, sA3);
      seg(sS3, sB3);
      ctx.fillStyle = accentC;
      ctx.beginPath(); ctx.arc(sS3.x, sS3.y, 3.6, 0, Math.PI * 2); ctx.fill();
      var ax3 = vA3.x - vS3.x, ay3 = vA3.y - vS3.y, az3 = vA3.z - vS3.z;
      var bx3 = vB3.x - vS3.x, by3 = vB3.y - vS3.y, bz3 = vB3.z - vS3.z;
      var la3 = Math.hypot(ax3, ay3, az3), lb3 = Math.hypot(bx3, by3, bz3);
      if (la3 > 1e-6 && lb3 > 1e-6) {
        var uax = ax3 / la3, uay = ay3 / la3, uaz = az3 / la3;
        var ubx = bx3 / lb3, uby = by3 / lb3, ubz = bz3 / lb3;
        var rad3 = Math.min(12, Math.min(la3, lb3) * 0.28);
        var steps3 = 14, arc3 = [];
        for (var cs = 0; cs <= steps3; cs++) {
          var f3 = cs / steps3;
          var wx = uax * (1 - f3) + ubx * f3;
          var wy = uay * (1 - f3) + uby * f3;
          var wz = uaz * (1 - f3) + ubz * f3;
          var wl = Math.hypot(wx, wy, wz);
          if (wl > 1e-6) {
            arc3.push(proj({ x: vS3.x + (wx / wl) * rad3, y: vS3.y + (wy / wl) * rad3, z: vS3.z + (wz / wl) * rad3 }));
          }
        }
        if (arc3.length >= 2) {
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          for (var ci = 0; ci < arc3.length; ci++) {
            if (ci === 0) ctx.moveTo(arc3[ci].x, arc3[ci].y);
            else ctx.lineTo(arc3[ci].x, arc3[ci].y);
          }
          ctx.stroke();
          if (!poseState.gesture && prefs.labels && prefs.inclinations) {
            var mid3 = arc3[Math.floor(arc3.length / 2)];
            var dTag = String(Number(tc3.angle3D.toFixed(prefs.precision))) + '°';
            ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textBaseline = 'middle';
            var dw = ctx.measureText(dTag).width + 10, dh = 17;
            var dmx = mid3.x - sS3.x, dmy = mid3.y - sS3.y, dml = Math.hypot(dmx, dmy) || 1;
            var drx = Math.max(6, Math.min(st.w - dw - 6, mid3.x + (dmx / dml) * 14 - dw / 2));
            var dry = Math.max(6, Math.min(st.h - dh - 6, mid3.y + (dmy / dml) * 14 - dh / 2));
            ctx.fillStyle = themeColor('spatialLabelBg', 'rgba(248, 250, 252, 0.94)');
            ctx.fillRect(drx, dry, dw, dh);
            ctx.strokeStyle = accentC;
            ctx.globalAlpha = 0.42;
            ctx.lineWidth = 0.9;
            ctx.strokeRect(drx + 0.5, dry + 0.5, dw - 1, dh - 1);
            ctx.globalAlpha = 1;
            ctx.fillStyle = accentC;
            ctx.textAlign = 'left';
            ctx.fillText(dTag, drx + 5, dry + dh / 2);
          }
        }
      }
      ctx.restore();
    }
    if (poseState.trackedSpan && afterVerts[poseState.trackedSpan.vertexA] &&
        afterVerts[poseState.trackedSpan.vertexB]) {
      var ts3 = poseState.trackedSpan;
      var accentS = themeColor('accent', '#0284c7');
      var spA3 = after2[ts3.vertexA], spB3 = after2[ts3.vertexB];
      ctx.save();
      ctx.strokeStyle = accentS;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      seg(spA3, spB3);
      ctx.setLineDash([]);
      ctx.fillStyle = accentS;
      ctx.beginPath(); ctx.arc(spA3.x, spA3.y, 3.6, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(spB3.x, spB3.y, 3.6, 0, Math.PI * 2); ctx.fill();
      if (!poseState.gesture && prefs.labels && prefs.lengths) {
        var vSA3 = afterVerts[ts3.vertexA], vSB3 = afterVerts[ts3.vertexB];
        var d3Live = Math.hypot(vSB3.x - vSA3.x, vSB3.y - vSA3.y, vSB3.z - vSA3.z);
        var sTag = String(Number(d3Live.toFixed(prefs.precision))) + ' mm';
        var smx3 = (spA3.x + spB3.x) / 2, smy3 = (spA3.y + spB3.y) / 2;
        var sdx3 = spB3.x - spA3.x, sdy3 = spB3.y - spA3.y, sl3 = Math.hypot(sdx3, sdy3) || 1;
        var snx3 = -sdy3 / sl3, sny3 = sdx3 / sl3;
        if (sny3 > 0) { snx3 = -snx3; sny3 = -sny3; }
        ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
        ctx.textBaseline = 'middle';
        var sw3 = ctx.measureText(sTag).width + 10, sh3 = 17;
        var srx3 = Math.max(6, Math.min(st.w - sw3 - 6, smx3 + snx3 * 14 - sw3 / 2));
        var sry3 = Math.max(6, Math.min(st.h - sh3 - 6, smy3 + sny3 * 14 - sh3 / 2));
        ctx.fillStyle = themeColor('spatialLabelBg', 'rgba(248, 250, 252, 0.94)');
        ctx.fillRect(srx3, sry3, sw3, sh3);
        ctx.strokeStyle = accentS;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 0.9;
        ctx.strokeRect(srx3 + 0.5, sry3 + 0.5, sw3 - 1, sh3 - 1);
        ctx.globalAlpha = 1;
        ctx.fillStyle = accentS;
        ctx.textAlign = 'left';
        ctx.fillText(sTag, srx3 + 5, sry3 + sh3 / 2);
      }
      ctx.restore();
    }

    if (!poseState.gesture || !poseState.gestureStart) return;
    var beforeVerts = EduCADPose.applyPose(mm.vertices, poseState.gestureStart, center);
    var before2 = beforeVerts.map(proj);
    var gest = poseState.gesture;
    var axisColor = gest.axis === 'X' ? '#e03232'
      : gest.axis === 'Y' ? '#2f9e44'
      : gest.axis === 'Z' ? '#3b82f6'
      : themeColor('accent', '#0284c7');

    function arrowHead(from, to) {
      var dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy);
      if (l < 3) return;
      var ux = dx / l, uy = dy / l;
      seg(to, { x: to.x - ux * 8 + uy * 3, y: to.y - uy * 8 - ux * 3 });
      seg(to, { x: to.x - ux * 8 - uy * 3, y: to.y - uy * 8 + ux * 3 });
    }
    function pill(x, y, text, color) {
      ctx.save();
      ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      var w = ctx.measureText(text).width + 12, h = 22;
      var rx = Math.max(6, Math.min(st.w - w - 6, x - w / 2));
      var ry = Math.max(6, Math.min(st.h - h - 6, y - h / 2));
      ctx.fillStyle = themeColor('spatialLabelBg', 'rgba(248, 250, 252, 0.94)');
      ctx.fillRect(rx, ry, w, h);
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(text, rx + 6, ry + h / 2);
      ctx.restore();
    }
    function fmtNum(n, digits) {
      var p10 = Math.pow(10, digits || 1);
      var v = Math.round(n * p10) / p10;
      return String(Object.is(v, -0) ? 0 : v);
    }

    ctx.save();
    ctx.strokeStyle = themeColor('viewGuide', '#8a9dad');
    ctx.globalAlpha = 0.42;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    for (var i = 0; i < mm.edges.length; i++) {
      var ed = mm.edges[i];
      seg(before2[ed[0]], before2[ed[1]]);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    if (gest.op === 'grab') {
      var p0 = { x: center.x + poseState.gestureStart.t[0], y: center.y + poseState.gestureStart.t[1], z: center.z + poseState.gestureStart.t[2] };
      var p1 = { x: center.x + poseState.pose.t[0], y: center.y + poseState.pose.t[1], z: center.z + poseState.pose.t[2] };
      var dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
      var dist = Math.hypot(dx, dy, dz);
      if (dist > 0.05) {
        var s0 = proj(p0), s1 = proj(p1);
        ctx.strokeStyle = axisColor;
        ctx.fillStyle = axisColor;
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(s0.x, s0.y, 3, 0, Math.PI * 2); ctx.fill();
        seg(s0, s1);
        arrowHead(s0, s1);
        var sdx = s1.x - s0.x, sdy = s1.y - s0.y, sl = Math.hypot(sdx, sdy) || 1;
        var nx = -sdy / sl, ny = sdx / sl;
        if (ny > 0) { nx = -nx; ny = -ny; }
        var signedVal = gest.axis === 'X' ? dx : gest.axis === 'Y' ? dy : gest.axis === 'Z' ? dz : dist;
        var labelText = gest.axis
          ? ((signedVal >= 0 ? '+' : '') + fmtNum(signedVal, 1) + ' mm ' + gest.axis)
          : (fmtNum(dist, 1) + ' mm');
        pill((s0.x + s1.x) / 2 + nx * 16, (s0.y + s1.y) / 2 + ny * 16, labelText, axisColor);
      }
    } else if (gest.op === 'rotate') {
      var r0 = poseState.gestureStart.rm, r1 = poseState.pose.rm;
      var r0T = [r0[0], r0[3], r0[6], r0[1], r0[4], r0[7], r0[2], r0[5], r0[8]];
      var dR = EduCADPose.matMul3(r1, r0T);
      var u = null, theta = 0;
      if (gest.axis) {
        u = EduCADPose.AXES[gest.axis];
        var ref = Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        var dotRef = ref[0] * u[0] + ref[1] * u[1] + ref[2] * u[2];
        var vx = ref[0] - dotRef * u[0], vy = ref[1] - dotRef * u[1], vz = ref[2] - dotRef * u[2];
        var vl = Math.hypot(vx, vy, vz) || 1;
        vx /= vl; vy /= vl; vz /= vl;
        var wx = dR[0] * vx + dR[1] * vy + dR[2] * vz;
        var wy = dR[3] * vx + dR[4] * vy + dR[5] * vz;
        var wz = dR[6] * vx + dR[7] * vy + dR[8] * vz;
        var c = vx * wx + vy * wy + vz * wz;
        var cxp = vy * wz - vz * wy, cyp = vz * wx - vx * wz, czp = vx * wy - vy * wx;
        var s = cxp * u[0] + cyp * u[1] + czp * u[2];
        theta = Math.atan2(s, c);
      } else {
        var sx = dR[7] - dR[5], sy = dR[2] - dR[6], sz = dR[3] - dR[1];
        var sn = Math.hypot(sx, sy, sz);
        if (sn > 1e-6) {
          u = [sx / sn, sy / sn, sz / sn];
          theta = Math.atan2(sn / 2, (dR[0] + dR[4] + dR[8] - 1) / 2);
        }
      }
      if (u && Math.abs(theta) > 1e-3) {
        var piv = { x: center.x + poseState.pose.t[0], y: center.y + poseState.pose.t[1], z: center.z + poseState.pose.t[2] };
        var bestIdx = 0, bestRad = -1, bestProjAxis = 0;
        for (var k = 0; k < beforeVerts.length; k++) {
          var rx = beforeVerts[k].x - piv.x, ry = beforeVerts[k].y - piv.y, rz = beforeVerts[k].z - piv.z;
          var along = rx * u[0] + ry * u[1] + rz * u[2];
          var rad = Math.hypot(rx - along * u[0], ry - along * u[1], rz - along * u[2]);
          if (rad > bestRad) { bestRad = rad; bestIdx = k; bestProjAxis = along; }
        }
        if (bestRad > 1e-3) {
          var ac = { x: piv.x + bestProjAxis * u[0], y: piv.y + bestProjAxis * u[1], z: piv.z + bestProjAxis * u[2] };
          var rv0 = { x: beforeVerts[bestIdx].x - ac.x, y: beforeVerts[bestIdx].y - ac.y, z: beforeVerts[bestIdx].z - ac.z };
          var sac = proj(ac);
          ctx.strokeStyle = axisColor;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          seg(sac, before2[bestIdx]);
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.85;
          seg(sac, after2[bestIdx]);
          ctx.globalAlpha = 1;
          ctx.lineWidth = 1.75;
          var steps = 24, arcPts = [];
          for (var step = 0; step <= steps; step++) {
            var a = theta * (step / steps);
            var rm = EduCADPose.axisAngleMatrix(u[0], u[1], u[2], a);
            arcPts.push(proj({
              x: ac.x + rm[0] * rv0.x + rm[1] * rv0.y + rm[2] * rv0.z,
              y: ac.y + rm[3] * rv0.x + rm[4] * rv0.y + rm[5] * rv0.z,
              z: ac.z + rm[6] * rv0.x + rm[7] * rv0.y + rm[8] * rv0.z
            }));
          }
          ctx.beginPath();
          for (var m = 0; m < arcPts.length; m++) {
            if (m === 0) ctx.moveTo(arcPts[m].x, arcPts[m].y);
            else ctx.lineTo(arcPts[m].x, arcPts[m].y);
          }
          ctx.stroke();
          arrowHead(arcPts[steps - 1], arcPts[steps]);
          var midPt = arcPts[Math.floor(steps / 2)];
          var mdx = midPt.x - sac.x, mdy = midPt.y - sac.y, ml = Math.hypot(mdx, mdy) || 1;
          var deg = theta * 180 / Math.PI;
          var rotText = fmtNum(Math.abs(deg), 1) + '°' + (gest.axis ? ' ' + gest.axis : '');
          pill(midPt.x + (mdx / ml) * 18, midPt.y + (mdy / ml) * 18, rotText, axisColor);
        }
      }
    } else if (gest.op === 'scale') {
      var ratio = poseState.pose.s / poseState.gestureStart.s;
      if (Math.abs(ratio - 1) > 0.005) {
        var farIdx = 0, farDist = -1;
        for (var si = 0; si < before2.length; si++) {
          var d = Math.hypot(after2[si].x - before2[si].x, after2[si].y - before2[si].y);
          if (d > farDist) { farDist = d; farIdx = si; }
        }
        if (farDist > 2) {
          ctx.strokeStyle = axisColor;
          ctx.lineWidth = 1.5;
          seg(before2[farIdx], after2[farIdx]);
          arrowHead(before2[farIdx], after2[farIdx]);
          pill((before2[farIdx].x + after2[farIdx].x) / 2, (before2[farIdx].y + after2[farIdx].y) / 2 - 14, ratio.toFixed(2) + '×', axisColor);
        }
      }
    }
    ctx.restore();
  }

  function drawPointLeader(ctx, point, rect, color) {
    if (!rect) return;
    var x = Math.max(rect.x0, Math.min(rect.x1, point.x)), y = Math.max(rect.y0, Math.min(rect.y1, point.y));
    var dx = x - point.x, dy = y - point.y, length = Math.hypot(dx, dy);
    if (length <= 6.5) return;
    ctx.strokeStyle = color; ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(point.x + 6 * dx / length, point.y + 6 * dy / length);
    ctx.lineTo(x, y); ctx.stroke();
  }

  function drawTrackedEdge(ctx, view, poseState, map, prefs) {
    if (!poseState) return;
    poseState.trackedTargets = [];
    if (!poseState.trackedEdge || !poseState.mm ||
        typeof EduCADOrthographic === 'undefined') return;
    var tracked = poseState.trackedEdge;
    var edge = poseState.mm.edges && poseState.mm.edges[tracked.edgeIndex];
    if (!edge) return;
    var posedVerts = (poseState.sims && poseState.sims.posed)
      ? poseState.sims.posed
      : EduCADPose.applyPose(poseState.mm.vertices, poseState.pose, poseState.center);
    var va = posedVerts[tracked.reversed ? edge[1] : edge[0]];
    var vb = posedVerts[tracked.reversed ? edge[0] : edge[1]];
    if (!va || !vb) return;
    var restA = poseState.mm.vertices[tracked.reversed ? edge[1] : edge[0]];
    var restB = poseState.mm.vertices[tracked.reversed ? edge[0] : edge[1]];
    var restTrueLen = tracked.restTrueLength || Math.hypot(restB.x - restA.x, restB.y - restA.y, restB.z - restA.z);
    var trueLen = Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
    map = map || { three: false };
    prefs = prefs || { precision: 2, textSize: 11 };
    var toPx = function (pt) { return { x: pt.x * view.s + view.tx, y: view.ty - pt.y * view.s }; };
    var seg = function (a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    var arrow = function (a, b) {
      var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
      if (l < 2) return;
      var ux = dx / l, uy = dy / l;
      seg(b, { x: b.x - ux * 7 + uy * 2.5, y: b.y - uy * 7 - ux * 2.5 });
      seg(b, { x: b.x - ux * 7 - uy * 2.5, y: b.y - uy * 7 + ux * 2.5 });
    };
    var accent = themeColor('accent', '#0284c7');
    var ink = themeColor('viewInspect', '#415c74');
    var guide = themeColor('viewGuide', '#8a9dad');
    var bg = themeColor('viewLabelBg', 'rgba(248, 250, 252, 0.96)');
    var edgeName = tracked.label || ('Edge ' + (tracked.edgeIndex + 1));

    var viewCentroid = function (vr) {
      if (!posedVerts.length) return null;
      var sx = 0, sy = 0;
      for (var k = 0; k < posedVerts.length; k++) {
        var vp = toPx(EduCADOrthographic.toView3D(posedVerts[k], vr, map));
        sx += vp.x; sy += vp.y;
      }
      return { x: sx / posedVerts.length, y: sy / posedVerts.length };
    };
    var drawPill = function (x, y, lines) {
      if (prefs.labels === false || prefs.lengths === false) return null;
      ctx.font = prefs.textSize + 'px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      var width = Math.max.apply(null, lines.map(function (t) { return ctx.measureText(t).width; })) + 12;
      var lineH = prefs.textSize + 4;
      var height = lines.length * lineH + 6;
      var rx = Math.max(6, Math.min(view.w - width - 6, x - width / 2));
      var ry = Math.max(6, Math.min(view.h - height - 6, y - height / 2));
      ctx.fillStyle = bg;
      ctx.fillRect(rx, ry, width, height);
      ctx.textAlign = 'left';
      lines.forEach(function (line, i) {
        ctx.fillStyle = i === 0 ? ink : accent;
        ctx.fillText(line, rx + 6, ry + 3 + lineH * (i + 0.5));
      });
      return { x0: rx, y0: ry, x1: rx + width, y1: ry + height };
    };
    var drawTag = function (p0, p1, isPt, centroid, hovered) {
      ctx.save();
      var tagSize = Math.max(9.5, prefs.textSize - 0.5);
      ctx.font = '600 ' + tagSize + 'px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      var w = ctx.measureText(edgeName).width + 10;
      var h = Math.max(16, tagSize + 6);
      var cx, cy;
      if (isPt) {
        var ux = 0, uy = -1;
        if (centroid) {
          var pdx = p0.x - centroid.x, pdy = p0.y - centroid.y, pd = Math.hypot(pdx, pdy);
          if (pd > 4) { ux = pdx / pd; uy = pdy / pd; }
        }
        var pOff = Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2) + 10;
        cx = p0.x + ux * pOff;
        cy = p0.y + uy * pOff;
      } else {
        var mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        var dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
        var nx = -dy / len, ny = dx / len;
        if (centroid) {
          var dot = (mx - centroid.x) * nx + (my - centroid.y) * ny;
          if (Math.abs(dot) > 1) {
            if (dot < 0) { nx = -nx; ny = -ny; }
          } else if (ny > 0 || (Math.abs(ny) < 0.01 && nx < 0)) {
            nx = -nx; ny = -ny;
          }
        } else if (ny > 0 || (Math.abs(ny) < 0.01 && nx < 0)) {
          nx = -nx; ny = -ny;
        }
        var sOff = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2) + 6;
        cx = mx + nx * sOff;
        cy = my + ny * sOff;
      }
      var rx = Math.max(6, Math.min(view.w - w - 6, cx - w / 2));
      var ry = Math.max(6, Math.min(view.h - h - 6, cy - h / 2));
      if (isPt) {
        var nearX = Math.max(rx, Math.min(rx + w, p0.x));
        var nearY = Math.max(ry, Math.min(ry + h, p0.y));
        var ldx = nearX - p0.x, ldy = nearY - p0.y, ld = Math.hypot(ldx, ldy);
        if (ld > 5.5) {
          ctx.strokeStyle = hovered ? accent : guide;
          ctx.lineWidth = hovered ? 1.1 : 0.85;
          seg({ x: p0.x + (ldx / ld) * 5, y: p0.y + (ldy / ld) * 5 }, { x: nearX, y: nearY });
        }
      }
      ctx.fillStyle = bg;
      ctx.fillRect(rx, ry, w, h);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = hovered ? 0.95 : 0.45;
      ctx.lineWidth = hovered ? 1.3 : 0.9;
      ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.textAlign = 'left';
      ctx.fillText(edgeName, rx + 5, ry + h / 2);
      ctx.restore();
      return { x0: rx, y0: ry, x1: rx + w, y1: ry + h };
    };

    ctx.save();
    var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
    var activeDraw = null;
    views.forEach(function (vr) {
      var a2 = EduCADOrthographic.toView3D(va, vr, map);
      var b2 = EduCADOrthographic.toView3D(vb, vr, map);
      var p0 = toPx(a2), p1 = toPx(b2);
      var projLen = Math.hypot(b2.x - a2.x, b2.y - a2.y);
      var projPx = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      var centroid = viewCentroid(vr);
      var callout = EduCADOrthographic.edgeCalloutLines({
        name: edgeName,
        viewRole: vr,
        projLen: projLen,
        trueLen: trueLen,
        restTrueLen: restTrueLen,
        scale: poseState.pose.s,
        precision: prefs.precision,
        projPx: projPx
      });
      var isActive = vr === tracked.viewRole;
      var isHovered = !isActive && poseState.hoverView === vr;
      var isPt = callout.pointMarker || projPx < 1.5;

      if (isActive) {
        activeDraw = { vr: vr, a2: a2, b2: b2, p0: p0, p1: p1, centroid: centroid, callout: callout, isPt: isPt };
        return;
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = isHovered ? 2.3 : 1.7;
      ctx.globalAlpha = isHovered ? 1 : 0.82;
      ctx.setLineDash([]);
      if (isPt) {
        var midPt = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        ctx.beginPath(); ctx.arc(midPt.x, midPt.y, isHovered ? 5.5 : 4.8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(midPt.x, midPt.y, 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        var ptTagRect = drawTag(midPt, midPt, true, centroid, isHovered);
        poseState.trackedTargets.push({ viewRole: vr, p0: midPt, p1: midPt, isPoint: true, tagRect: ptTagRect, active: false });
      } else {
        seg(p0, p1);
        ctx.globalAlpha = 1;
        var tagRect = drawTag(p0, p1, false, centroid, isHovered);
        poseState.trackedTargets.push({ viewRole: vr, p0: p0, p1: p1, isPoint: false, tagRect: tagRect, active: false });
      }
    });

    if (activeDraw) {
      var ad = activeDraw;
      EduCADOrthographic.drawComponents(ctx, view, prefs, ad.a2, ad.b2);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      var activeRect = null;
      if (ad.callout.pointMarker) {
        var ptPx = { x: (ad.p0.x + ad.p1.x) / 2, y: (ad.p0.y + ad.p1.y) / 2 };
        ctx.lineWidth = 1.7;
        ctx.beginPath(); ctx.arc(ptPx.x, ptPx.y, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(ptPx.x, ptPx.y, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.font = prefs.textSize + 'px system-ui, sans-serif';
        var pw = Math.max.apply(null, ad.callout.lines.map(function (t) { return ctx.measureText(t).width; })) + 12;
        var ph = ad.callout.lines.length * (prefs.textSize + 4) + 6;
        var pux = 0, puy = -1;
        if (ad.centroid) {
          var cdx = ptPx.x - ad.centroid.x, cdy = ptPx.y - ad.centroid.y, cd = Math.hypot(cdx, cdy);
          if (cd > 4) { pux = cdx / cd; puy = cdy / cd; }
        }
        var pDist = Math.abs(pux) * (pw / 2) + Math.abs(puy) * (ph / 2) + 14;
        var pcx = ptPx.x + pux * pDist;
        var pcy = ptPx.y + puy * pDist;
        activeRect = drawPill(pcx, pcy, ad.callout.lines);
        drawPointLeader(ctx, ptPx, activeRect, guide);
        poseState.trackedTargets.push({ viewRole: ad.vr, p0: ptPx, p1: ptPx, isPoint: true, tagRect: activeRect, active: true });
      } else {
        seg(ad.p0, ad.p1);
        var side = tracked.sides && (tracked.sides[ad.vr] === 1 || tracked.sides[ad.vr] === -1)
          ? tracked.sides[ad.vr] : null;
        if (side === null) {
          var sdx = ad.p1.x - ad.p0.x, sdy = ad.p1.y - ad.p0.y, sl = Math.hypot(sdx, sdy) || 1;
          var sux = sdx / sl, suy = sdy / sl;
          var smx = (ad.p0.x + ad.p1.x) / 2, smy = (ad.p0.y + ad.p1.y) / 2;
          if (ad.centroid) {
            var sdot = (smx - ad.centroid.x) * (-suy) + (smy - ad.centroid.y) * sux;
            side = Math.abs(sdot) > 1 ? (sdot >= 0 ? 1 : -1) : (sux >= 0 ? -1 : 1);
          } else {
            side = sux >= 0 ? -1 : 1;
          }
          if (!tracked.sides) tracked.sides = {};
          tracked.sides[ad.vr] = side;
        }
        var virtualEnt = { type: 'SEGMENT', x: ad.a2.x, y: ad.a2.y, x2: ad.b2.x, y2: ad.b2.y };
        var linear = EduCADMeasure.linearDimLayout(virtualEnt, view, {
          side: side,
          offsetMm: tracked.offsetMm || Math.max(10, 26 / view.s),
          lineH: prefs.textSize + 4
        });
        if (linear) {
          ctx.strokeStyle = guide; ctx.lineWidth = 0.9; ctx.setLineDash([]);
          linear.ext.forEach(function (pair) { seg(pair[0], pair[1]); });
          ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
          seg(linear.d1, linear.d2);
          arrow(linear.d2, linear.d1);
          arrow(linear.d1, linear.d2);
          var pillOff = ad.callout.lines.length > 1 ? 18 : 13;
          var mx = (linear.d1.x + linear.d2.x) / 2 + linear.normal.x * pillOff;
          var my = (linear.d1.y + linear.d2.y) / 2 + linear.normal.y * pillOff;
          activeRect = drawPill(mx, my, ad.callout.lines);
        }
        poseState.trackedTargets.push({ viewRole: ad.vr, p0: ad.p0, p1: ad.p1, isPoint: false, tagRect: activeRect, active: true });
      }
    }
    ctx.restore();
  }

  function drawTrackedCorner(ctx, view, poseState, map, prefs) {
    if (!poseState) return;
    poseState.trackedTargets = [];
    if (!poseState.trackedCorner || !poseState.mm ||
        typeof EduCADOrthographic === 'undefined') return;
    var corner = poseState.trackedCorner;
    var posedVerts = (poseState.sims && poseState.sims.posed)
      ? poseState.sims.posed
      : EduCADPose.applyPose(poseState.mm.vertices, poseState.pose, poseState.center);
    var vS = posedVerts[corner.vertexIndex];
    var vA = posedVerts[corner.otherA];
    var vB = posedVerts[corner.otherB];
    if (!vS || !vA || !vB) return;
    map = map || { three: false };
    prefs = prefs || { precision: 2, textSize: 11 };
    var toPx = function (pt) { return { x: pt.x * view.s + view.tx, y: view.ty - pt.y * view.s }; };
    var seg = function (a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    var accent = themeColor('accent', '#0284c7');
    var ink = themeColor('viewInspect', '#415c74');
    var guide = themeColor('viewGuide', '#8a9dad');
    var bg = themeColor('viewLabelBg', 'rgba(248, 250, 252, 0.96)');
    var viewCaps = { ELEVATION: 'Front', PLAN: 'Top', PROFILE: 'Side' };

    var viewCentroid = function (vr) {
      if (!posedVerts.length) return null;
      var sx = 0, sy = 0;
      for (var k = 0; k < posedVerts.length; k++) {
        var vp = toPx(EduCADOrthographic.toView3D(posedVerts[k], vr, map));
        sx += vp.x; sy += vp.y;
      }
      return { x: sx / posedVerts.length, y: sy / posedVerts.length };
    };
    var drawPill = function (x, y, lines) {
      if (prefs.labels === false || prefs.angles === false) return null;
      ctx.font = prefs.textSize + 'px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      var width = Math.max.apply(null, lines.map(function (t) { return ctx.measureText(t).width; })) + 12;
      var lineH = prefs.textSize + 4;
      var height = lines.length * lineH + 6;
      var rx = Math.max(6, Math.min(view.w - width - 6, x - width / 2));
      var ry = Math.max(6, Math.min(view.h - height - 6, y - height / 2));
      ctx.fillStyle = bg;
      ctx.fillRect(rx, ry, width, height);
      ctx.textAlign = 'left';
      lines.forEach(function (line, i) {
        ctx.fillStyle = i === 0 ? ink : accent;
        ctx.fillText(line, rx + 6, ry + 3 + lineH * (i + 0.5));
      });
      return { x0: rx, y0: ry, x1: rx + width, y1: ry + height };
    };
    var drawCornerTag = function (pt, tagText, centroid, hovered) {
      ctx.save();
      var tagSize = Math.max(9.5, prefs.textSize - 0.5);
      ctx.font = '600 ' + tagSize + 'px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      var w = ctx.measureText(tagText).width + 10;
      var h = Math.max(16, tagSize + 6);
      var ux = 0, uy = -1;
      if (centroid) {
        var pdx = pt.x - centroid.x, pdy = pt.y - centroid.y, pd = Math.hypot(pdx, pdy);
        if (pd > 4) { ux = pdx / pd; uy = pdy / pd; }
      }
      var pOff = Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2) + 11;
      var rx = Math.max(6, Math.min(view.w - w - 6, pt.x + ux * pOff - w / 2));
      var ry = Math.max(6, Math.min(view.h - h - 6, pt.y + uy * pOff - h / 2));
      var nearX = Math.max(rx, Math.min(rx + w, pt.x));
      var nearY = Math.max(ry, Math.min(ry + h, pt.y));
      var ldx = nearX - pt.x, ldy = nearY - pt.y, ld = Math.hypot(ldx, ldy);
      if (ld > 5.5) {
        ctx.strokeStyle = hovered ? accent : guide;
        ctx.lineWidth = hovered ? 1.1 : 0.85;
        seg({ x: pt.x + (ldx / ld) * 5, y: pt.y + (ldy / ld) * 5 }, { x: nearX, y: nearY });
      }
      ctx.fillStyle = bg;
      ctx.fillRect(rx, ry, w, h);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = hovered ? 0.95 : 0.45;
      ctx.lineWidth = hovered ? 1.3 : 0.9;
      ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.textAlign = 'left';
      ctx.fillText(tagText, rx + 5, ry + h / 2);
      ctx.restore();
      return { x0: rx, y0: ry, x1: rx + w, y1: ry + h };
    };

    ctx.save();
    var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
    var activeDraw = null;
    views.forEach(function (vr) {
      var sS = toPx(EduCADOrthographic.toView3D(vS, vr, map));
      var sA = toPx(EduCADOrthographic.toView3D(vA, vr, map));
      var sB = toPx(EduCADOrthographic.toView3D(vB, vr, map));
      var centroid = viewCentroid(vr);
      var callout = EduCADOrthographic.cornerAngleCallout({
        viewRole: vr, vShared: vS, va: vA, vb: vB, map: map,
        angle3D: corner.angle3D, labelA: corner.labelA, labelB: corner.labelB,
        precision: prefs.precision
      });
      if (!callout) return;
      var isActive = vr === corner.viewRole;
      var isHovered = !isActive && poseState.hoverView === vr;
      if (isActive) {
        activeDraw = { vr: vr, sS: sS, sA: sA, sB: sB, centroid: centroid, callout: callout };
        return;
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = isHovered ? 2.2 : 1.6;
      ctx.globalAlpha = isHovered ? 1 : 0.78;
      ctx.setLineDash([]);
      var lenAPx = Math.hypot(sA.x - sS.x, sA.y - sS.y);
      var lenBPx = Math.hypot(sB.x - sS.x, sB.y - sS.y);
      if (lenAPx >= 1.5) seg(sS, sA);
      if (lenBPx >= 1.5) seg(sS, sB);
      if (callout.pointMarker) {
        ctx.beginPath(); ctx.arc(sS.x, sS.y, isHovered ? 5.5 : 4.8, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(sS.x, sS.y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      var tagLabel = (viewCaps[vr] || 'View') + ' ' + callout.shortText;
      var tagRect = drawCornerTag(sS, tagLabel, centroid, isHovered);
      poseState.trackedTargets.push({ viewRole: vr, p0: sS, p1: sA, isPoint: lenAPx < 1.5, tagRect: tagRect, active: false });
      poseState.trackedTargets.push({ viewRole: vr, p0: sS, p1: sB, isPoint: lenBPx < 1.5, tagRect: tagRect, active: false });
    });

    if (activeDraw) {
      var ad = activeDraw;
      var lenA = Math.hypot(ad.sA.x - ad.sS.x, ad.sA.y - ad.sS.y);
      var lenB = Math.hypot(ad.sB.x - ad.sS.x, ad.sB.y - ad.sS.y);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
      if (lenA >= 1.5) seg(ad.sS, ad.sA);
      if (lenB >= 1.5) seg(ad.sS, ad.sB);
      var activeRect = null;
      if (ad.callout.pointMarker) {
        ctx.lineWidth = 1.7;
        ctx.beginPath(); ctx.arc(ad.sS.x, ad.sS.y, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(ad.sS.x, ad.sS.y, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.font = prefs.textSize + 'px system-ui, sans-serif';
        var pw = Math.max.apply(null, ad.callout.lines.map(function (t) { return ctx.measureText(t).width; })) + 12;
        var ph = ad.callout.lines.length * (prefs.textSize + 4) + 6;
        var pux = 0, puy = -1;
        if (ad.centroid) {
          var cdx = ad.sS.x - ad.centroid.x, cdy = ad.sS.y - ad.centroid.y, cd = Math.hypot(cdx, cdy);
          if (cd > 4) { pux = cdx / cd; puy = cdy / cd; }
        }
        var pDist = Math.abs(pux) * (pw / 2) + Math.abs(puy) * (ph / 2) + 14;
        activeRect = drawPill(ad.sS.x + pux * pDist, ad.sS.y + puy * pDist, ad.callout.lines);
        drawPointLeader(ctx, ad.sS, activeRect, guide);
      } else {
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(ad.sS.x, ad.sS.y, 3, 0, Math.PI * 2); ctx.fill();
        var ca1 = Math.atan2(ad.sA.y - ad.sS.y, ad.sA.x - ad.sS.x);
        var ca2 = Math.atan2(ad.sB.y - ad.sS.y, ad.sB.x - ad.sS.x);
        var cdiff = ca2 - ca1;
        while (cdiff > Math.PI) cdiff -= 2 * Math.PI;
        while (cdiff < -Math.PI) cdiff += 2 * Math.PI;
        var arcR = Math.min(24, Math.max(12, Math.min(lenA, lenB) * 0.36));
        if (Math.abs(cdiff) > 0.03) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(ad.sS.x, ad.sS.y, arcR, ca1, ca1 + cdiff, cdiff < 0);
          ctx.stroke();
        }
        var midA = ca1 + cdiff / 2;
        ctx.font = prefs.textSize + 'px system-ui, sans-serif';
        var aw = Math.max.apply(null, ad.callout.lines.map(function (t) { return ctx.measureText(t).width; })) + 12;
        var ah = ad.callout.lines.length * (prefs.textSize + 4) + 6;
        var inside = Math.abs(cdiff) >= 0.45 && Math.min(lenA, lenB) >= arcR + 24;
        var dirA = inside ? midA : midA + Math.PI;
        var uxA = Math.cos(dirA), uyA = Math.sin(dirA);
        var baseR = inside ? arcR : 4;
        var distA = baseR + Math.abs(uxA) * (aw / 2) + Math.abs(uyA) * (ah / 2) + 8;
        activeRect = drawPill(ad.sS.x + uxA * distA, ad.sS.y + uyA * distA, ad.callout.lines);
        if (activeRect && !inside) {
          var nxA = Math.max(activeRect.x0, Math.min(activeRect.x1, ad.sS.x));
          var nyA = Math.max(activeRect.y0, Math.min(activeRect.y1, ad.sS.y));
          ctx.strokeStyle = guide;
          ctx.lineWidth = 0.85;
          seg({ x: ad.sS.x, y: ad.sS.y }, { x: nxA, y: nyA });
        }
      }
      poseState.trackedTargets.push({ viewRole: ad.vr, p0: ad.sS, p1: ad.sA, isPoint: lenA < 1.5, tagRect: activeRect, active: true });
      poseState.trackedTargets.push({ viewRole: ad.vr, p0: ad.sS, p1: ad.sB, isPoint: lenB < 1.5, tagRect: activeRect, active: true });
    }
    ctx.restore();
  }

  function drawTrackedSpan(ctx, view, poseState, map, prefs) {
    if (!poseState) return;
    poseState.trackedTargets = [];
    if (!poseState.trackedSpan || !poseState.mm ||
        typeof EduCADOrthographic === 'undefined') return;
    var span = poseState.trackedSpan;
    var posedVerts = (poseState.sims && poseState.sims.posed)
      ? poseState.sims.posed
      : EduCADPose.applyPose(poseState.mm.vertices, poseState.pose, poseState.center);
    var vA = posedVerts[span.vertexA];
    var vB = posedVerts[span.vertexB];
    if (!vA || !vB) return;
    var restA = poseState.mm.vertices[span.vertexA];
    var restB = poseState.mm.vertices[span.vertexB];
    var restDist = span.restDist3D || Math.hypot(restB.x - restA.x, restB.y - restA.y, restB.z - restA.z);
    var trueDist = Math.hypot(vB.x - vA.x, vB.y - vA.y, vB.z - vA.z);
    map = map || { three: false };
    prefs = prefs || { precision: 2, textSize: 11 };
    var toPx = function (pt) { return { x: pt.x * view.s + view.tx, y: view.ty - pt.y * view.s }; };
    var seg = function (a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    var arrow = function (a, b) {
      var dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy);
      if (l < 2) return;
      var ux = dx / l, uy = dy / l;
      seg(b, { x: b.x - ux * 7 + uy * 2.5, y: b.y - uy * 7 - ux * 2.5 });
      seg(b, { x: b.x - ux * 7 - uy * 2.5, y: b.y - uy * 7 + ux * 2.5 });
    };
    var accent = themeColor('accent', '#0284c7');
    var ink = themeColor('viewInspect', '#415c74');
    var guide = themeColor('viewGuide', '#8a9dad');
    var bg = themeColor('viewLabelBg', 'rgba(248, 250, 252, 0.96)');
    var viewCaps = { ELEVATION: 'Front', PLAN: 'Top', PROFILE: 'Side' };

    var viewCentroid = function (vr) {
      if (!posedVerts.length) return null;
      var sx = 0, sy = 0;
      for (var k = 0; k < posedVerts.length; k++) {
        var vp = toPx(EduCADOrthographic.toView3D(posedVerts[k], vr, map));
        sx += vp.x; sy += vp.y;
      }
      return { x: sx / posedVerts.length, y: sy / posedVerts.length };
    };
    var drawPill = function (x, y, lines) {
      if (prefs.labels === false || prefs.lengths === false) return null;
      ctx.font = prefs.textSize + 'px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      var width = Math.max.apply(null, lines.map(function (t) { return ctx.measureText(t).width; })) + 12;
      var lineH = prefs.textSize + 4;
      var height = lines.length * lineH + 6;
      var rx = Math.max(6, Math.min(view.w - width - 6, x - width / 2));
      var ry = Math.max(6, Math.min(view.h - height - 6, y - height / 2));
      ctx.fillStyle = bg;
      ctx.fillRect(rx, ry, width, height);
      ctx.textAlign = 'left';
      lines.forEach(function (line, i) {
        ctx.fillStyle = i === 0 ? ink : accent;
        ctx.fillText(line, rx + 6, ry + 3 + lineH * (i + 0.5));
      });
      return { x0: rx, y0: ry, x1: rx + width, y1: ry + height };
    };
    var drawSpanTag = function (p0, p1, isPt, tagText, centroid, hovered) {
      ctx.save();
      var tagSize = Math.max(9.5, prefs.textSize - 0.5);
      ctx.font = '600 ' + tagSize + 'px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      var w = ctx.measureText(tagText).width + 10;
      var h = Math.max(16, tagSize + 6);
      var cx, cy;
      if (isPt) {
        var ux = 0, uy = -1;
        if (centroid) {
          var pdx = p0.x - centroid.x, pdy = p0.y - centroid.y, pd = Math.hypot(pdx, pdy);
          if (pd > 4) { ux = pdx / pd; uy = pdy / pd; }
        }
        var pOff = Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2) + 10;
        cx = p0.x + ux * pOff;
        cy = p0.y + uy * pOff;
      } else {
        var mx = (p0.x + p1.x) / 2, my = (p0.y + p1.y) / 2;
        var dx = p1.x - p0.x, dy = p1.y - p0.y, len = Math.hypot(dx, dy) || 1;
        var nx = -dy / len, ny = dx / len;
        if (centroid) {
          var dot = (mx - centroid.x) * nx + (my - centroid.y) * ny;
          if (Math.abs(dot) > 1) {
            if (dot < 0) { nx = -nx; ny = -ny; }
          } else if (ny > 0 || (Math.abs(ny) < 0.01 && nx < 0)) {
            nx = -nx; ny = -ny;
          }
        } else if (ny > 0 || (Math.abs(ny) < 0.01 && nx < 0)) {
          nx = -nx; ny = -ny;
        }
        var sOff = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2) + 7;
        cx = mx + nx * sOff;
        cy = my + ny * sOff;
      }
      var rx = Math.max(6, Math.min(view.w - w - 6, cx - w / 2));
      var ry = Math.max(6, Math.min(view.h - h - 6, cy - h / 2));
      ctx.fillStyle = bg;
      ctx.fillRect(rx, ry, w, h);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = hovered ? 0.95 : 0.45;
      ctx.lineWidth = hovered ? 1.3 : 0.9;
      ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1);
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      ctx.textAlign = 'left';
      ctx.fillText(tagText, rx + 5, ry + h / 2);
      ctx.restore();
      return { x0: rx, y0: ry, x1: rx + w, y1: ry + h };
    };

    ctx.save();
    var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
    var activeDraw = null;
    views.forEach(function (vr) {
      var a2 = EduCADOrthographic.toView3D(vA, vr, map);
      var b2 = EduCADOrthographic.toView3D(vB, vr, map);
      var p0 = toPx(a2), p1 = toPx(b2);
      var projLen = Math.hypot(b2.x - a2.x, b2.y - a2.y);
      var projPx = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      var centroid = viewCentroid(vr);
      var callout = EduCADOrthographic.pointSpanCalloutLines({
        viewRole: vr,
        projLen: projLen,
        trueLen: trueDist,
        restTrueLen: restDist,
        scale: poseState.pose.s,
        precision: prefs.precision,
        projPx: projPx
      });
      var isActive = vr === span.viewRole;
      var isHovered = !isActive && poseState.hoverView === vr;
      var isPt = callout.pointMarker || projPx < 1.5;
      if (isActive) {
        activeDraw = { vr: vr, a2: a2, b2: b2, p0: p0, p1: p1, centroid: centroid, callout: callout, isPt: isPt };
        return;
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = isHovered ? 1.9 : 1.35;
      ctx.globalAlpha = isHovered ? 0.95 : 0.72;
      if (isPt) {
        var midPt = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(midPt.x, midPt.y, isHovered ? 5.5 : 4.8, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(midPt.x, midPt.y, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        var ptTag = drawSpanTag(midPt, midPt, true, (viewCaps[vr] || 'View') + ' ' + callout.shortText, centroid, isHovered);
        poseState.trackedTargets.push({ viewRole: vr, p0: midPt, p1: midPt, isPoint: true, tagRect: ptTag, active: false });
      } else {
        ctx.setLineDash([4, 4]);
        seg(p0, p1);
        ctx.setLineDash([]);
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(p0.x, p0.y, 2.8, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(p1.x, p1.y, 2.8, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
        var tagRect = drawSpanTag(p0, p1, false, (viewCaps[vr] || 'View') + ' ' + callout.shortText, centroid, isHovered);
        poseState.trackedTargets.push({ viewRole: vr, p0: p0, p1: p1, isPoint: false, tagRect: tagRect, active: false });
      }
    });

    if (activeDraw) {
      var ad = activeDraw;
      EduCADOrthographic.drawComponents(ctx, view, prefs, ad.a2, ad.b2);
      var activeRect = null;
      ctx.globalAlpha = 1;
      if (ad.callout.pointMarker) {
        var ptPx = { x: (ad.p0.x + ad.p1.x) / 2, y: (ad.p0.y + ad.p1.y) / 2 };
        ctx.strokeStyle = accent; ctx.lineWidth = 1.7; ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(ptPx.x, ptPx.y, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(ptPx.x, ptPx.y, 2.4, 0, Math.PI * 2); ctx.fill();
        ctx.font = prefs.textSize + 'px system-ui, sans-serif';
        var pw = Math.max.apply(null, ad.callout.lines.map(function (t) { return ctx.measureText(t).width; })) + 12;
        var ph = ad.callout.lines.length * (prefs.textSize + 4) + 6;
        var pux = 0, puy = -1;
        if (ad.centroid) {
          var cdx = ptPx.x - ad.centroid.x, cdy = ptPx.y - ad.centroid.y, cd = Math.hypot(cdx, cdy);
          if (cd > 4) { pux = cdx / cd; puy = cdy / cd; }
        }
        var pDist = Math.abs(pux) * (pw / 2) + Math.abs(puy) * (ph / 2) + 14;
        activeRect = drawPill(ptPx.x + pux * pDist, ptPx.y + puy * pDist, ad.callout.lines);
        drawPointLeader(ctx, ptPx, activeRect, guide);
        poseState.trackedTargets.push({ viewRole: ad.vr, p0: ptPx, p1: ptPx, isPoint: true, tagRect: activeRect, active: true });
      } else {
        ctx.strokeStyle = accent; ctx.globalAlpha = 0.45; ctx.lineWidth = 1.25; ctx.setLineDash([4, 4]);
        seg(ad.p0, ad.p1);
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(ad.p0.x, ad.p0.y, 3.2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(ad.p1.x, ad.p1.y, 3.2, 0, Math.PI * 2); ctx.fill();
        var side = span.sides && (span.sides[ad.vr] === 1 || span.sides[ad.vr] === -1)
          ? span.sides[ad.vr] : null;
        if (side === null) {
          var sdx = ad.p1.x - ad.p0.x, sdy = ad.p1.y - ad.p0.y, sl = Math.hypot(sdx, sdy) || 1;
          var sux = sdx / sl, suy = sdy / sl;
          var smx = (ad.p0.x + ad.p1.x) / 2, smy = (ad.p0.y + ad.p1.y) / 2;
          if (ad.centroid) {
            var sdot = (smx - ad.centroid.x) * (-suy) + (smy - ad.centroid.y) * sux;
            side = Math.abs(sdot) > 1 ? (sdot >= 0 ? 1 : -1) : (sux >= 0 ? -1 : 1);
          } else {
            side = sux >= 0 ? -1 : 1;
          }
          if (!span.sides) span.sides = {};
          span.sides[ad.vr] = side;
        }
        var virtualEnt = { type: 'SEGMENT', x: ad.a2.x, y: ad.a2.y, x2: ad.b2.x, y2: ad.b2.y };
        var linear = EduCADMeasure.linearDimLayout(virtualEnt, view, {
          side: side,
          offsetMm: span.offsetMm || Math.max(12, 28 / view.s),
          lineH: prefs.textSize + 4
        });
        if (linear) {
          ctx.strokeStyle = guide; ctx.lineWidth = 0.9; ctx.setLineDash([]);
          linear.ext.forEach(function (pair) { seg(pair[0], pair[1]); });
          ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
          seg(linear.d1, linear.d2);
          arrow(linear.d2, linear.d1);
          arrow(linear.d1, linear.d2);
          var pillOff = ad.callout.lines.length > 1 ? 18 : 13;
          var mx = (linear.d1.x + linear.d2.x) / 2 + linear.normal.x * pillOff;
          var my = (linear.d1.y + linear.d2.y) / 2 + linear.normal.y * pillOff;
          activeRect = drawPill(mx, my, ad.callout.lines);
        }
        poseState.trackedTargets.push({ viewRole: ad.vr, p0: ad.p0, p1: ad.p1, isPoint: false, tagRect: activeRect, active: true });
      }
    }
    ctx.restore();
  }

  function drawSheetTransform(ctx, view, poseState, map) {
    if (!poseState || !poseState.mm || !poseState.mm.vertices || !poseState.mm.vertices.length ||
        typeof EduCADOrthographic === 'undefined' || typeof EduCADPose === 'undefined') return;
    var mm = poseState.mm, center = poseState.center;
    map = map || { three: false };
    var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
    var afterVerts = (poseState.sims && poseState.sims.posed)
      ? poseState.sims.posed
      : EduCADPose.applyPose(mm.vertices, poseState.pose, center);
    var toPx = function (pt) { return { x: pt.x * view.s + view.tx, y: view.ty - pt.y * view.s }; };
    var seg = function (a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    var arrow = function (from, to) {
      var dx = to.x - from.x, dy = to.y - from.y, l = Math.hypot(dx, dy);
      if (l < 3) return;
      var ux = dx / l, uy = dy / l;
      seg(to, { x: to.x - ux * 7.5 + uy * 2.8, y: to.y - uy * 7.5 - ux * 2.8 });
      seg(to, { x: to.x - ux * 7.5 - uy * 2.8, y: to.y - uy * 7.5 + ux * 2.8 });
    };
    var accent = themeColor('accent', '#0284c7');
    var ink = themeColor('viewInspect', '#415c74');
    var guide = themeColor('viewGuide', '#8a9dad');
    var bg = themeColor('viewLabelBg', 'rgba(248, 250, 252, 0.95)');
    var drawBannerPill = function (x, y, text, color, bordered) {
      ctx.save();
      ctx.font = '600 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      var w = ctx.measureText(text).width + 14, h = 22;
      var rx = Math.max(8, Math.min(view.w - w - 8, x - w / 2));
      var ry = Math.max(46, Math.min(view.h - h - 8, y - h / 2));
      ctx.fillStyle = bg;
      ctx.fillRect(rx, ry, w, h);
      if (bordered) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 1;
        ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.fillText(text, rx + 7, ry + h / 2);
      ctx.restore();
    };
    var viewBox = function (verts, vr) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      var sx = 0, sy = 0;
      for (var i = 0; i < verts.length; i++) {
        var p = toPx(EduCADOrthographic.toView3D(verts[i], vr, map));
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
        sx += p.x; sy += p.y;
      }
      return { x0: x0, y0: y0, x1: x1, y1: y1, cx: sx / verts.length, cy: sy / verts.length };
    };

    if (poseState.gesture && poseState.gestureStart) {
      var gest = poseState.gesture;
      var beforeVerts = EduCADPose.applyPose(mm.vertices, poseState.gestureStart, center);
      var axisColor = gest.axis === 'X' ? '#c83232'
        : gest.axis === 'Y' ? '#267d39'
        : gest.axis === 'Z' ? '#2563eb'
        : accent;
      var labelText = EduCADPose.formatPoseGesture(poseState.gestureStart, poseState.pose, gest, poseState.limited);
      var delta = EduCADPose.gestureDelta(poseState.gestureStart, poseState.pose, gest);

      ctx.save();
      ctx.strokeStyle = guide;
      ctx.globalAlpha = 0.36;
      ctx.lineWidth = 0.9;
      ctx.setLineDash([4, 4]);
      views.forEach(function (vr) {
        var b2 = beforeVerts.map(function (v) { return toPx(EduCADOrthographic.toView3D(v, vr, map)); });
        for (var ei = 0; ei < mm.edges.length; ei++) {
          var ed = mm.edges[ei];
          seg(b2[ed[0]], b2[ed[1]]);
        }
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      var placed = false;
      if (delta && delta.op === 'grab') {
        var p0 = { x: center.x + poseState.gestureStart.t[0], y: center.y + poseState.gestureStart.t[1], z: center.z + poseState.gestureStart.t[2] };
        var p1 = { x: center.x + poseState.pose.t[0], y: center.y + poseState.pose.t[1], z: center.z + poseState.pose.t[2] };
        var bestView = 'ELEVATION', bestPx = -1, bestS0 = null, bestS1 = null;
        ctx.strokeStyle = axisColor;
        ctx.fillStyle = axisColor;
        ctx.lineWidth = 1.5;
        views.forEach(function (vr) {
          var s0 = toPx(EduCADOrthographic.toView3D(p0, vr, map));
          var s1 = toPx(EduCADOrthographic.toView3D(p1, vr, map));
          var dpx = Math.hypot(s1.x - s0.x, s1.y - s0.y);
          if (dpx >= 2.5) {
            ctx.beginPath(); ctx.arc(s0.x, s0.y, 2.6, 0, Math.PI * 2); ctx.fill();
            seg(s0, s1);
            arrow(s0, s1);
          }
          if (dpx > bestPx) { bestPx = dpx; bestView = vr; bestS0 = s0; bestS1 = s1; }
        });
        if (labelText) {
          if (bestPx >= 10 && bestS0 && bestS1) {
            var mdx = bestS1.x - bestS0.x, mdy = bestS1.y - bestS0.y, ml = Math.hypot(mdx, mdy) || 1;
            var nx = -mdy / ml, ny = mdx / ml;
            if (ny > 0) { nx = -nx; ny = -ny; }
            drawBannerPill((bestS0.x + bestS1.x) / 2 + nx * 18, (bestS0.y + bestS1.y) / 2 + ny * 18, labelText, axisColor, true);
          } else {
            var boxG = viewBox(afterVerts, bestView);
            drawBannerPill((boxG.x0 + boxG.x1) / 2, boxG.y0 - 20, labelText, axisColor, true);
          }
          placed = true;
        }
      } else if (delta && delta.op === 'rotate') {
        var rotView = 'ELEVATION';
        if (gest.axis === 'Y') rotView = 'PLAN';
        else if (gest.axis === 'X') rotView = (map && map.three) ? 'PROFILE' : 'ELEVATION';
        else if (gest.axis === 'Z') rotView = 'ELEVATION';
        else if (delta.u) {
          var scores = [
            { vr: 'ELEVATION', sc: Math.abs(delta.u[2]) },
            { vr: 'PLAN', sc: Math.abs(delta.u[1]) }
          ];
          if (map && map.three) scores.push({ vr: 'PROFILE', sc: Math.abs(delta.u[0]) });
          scores.sort(function (a, b) { return b.sc - a.sc; });
          rotView = scores[0].vr;
        }
        if (delta.u && Math.abs(delta.theta) > 1e-3) {
          var piv = { x: center.x + poseState.pose.t[0], y: center.y + poseState.pose.t[1], z: center.z + poseState.pose.t[2] };
          var piv2 = toPx(EduCADOrthographic.toView3D(piv, rotView, map));
          var b2r = beforeVerts.map(function (v) { return toPx(EduCADOrthographic.toView3D(v, rotView, map)); });
          var a2r = afterVerts.map(function (v) { return toPx(EduCADOrthographic.toView3D(v, rotView, map)); });
          var bestIdx = 0, bestRad = -1, bestProjAxis = 0;
          for (var k = 0; k < beforeVerts.length; k++) {
            var r2 = Math.hypot(b2r[k].x - piv2.x, b2r[k].y - piv2.y);
            var rx = beforeVerts[k].x - piv.x, ry = beforeVerts[k].y - piv.y, rz = beforeVerts[k].z - piv.z;
            var along = rx * delta.u[0] + ry * delta.u[1] + rz * delta.u[2];
            var r3 = Math.hypot(rx - along * delta.u[0], ry - along * delta.u[1], rz - along * delta.u[2]);
            if (r3 > 1e-3 && r2 > bestRad) { bestRad = r2; bestIdx = k; bestProjAxis = along; }
          }
          if (bestRad >= 8) {
            var ac = { x: piv.x + bestProjAxis * delta.u[0], y: piv.y + bestProjAxis * delta.u[1], z: piv.z + bestProjAxis * delta.u[2] };
            var rv0 = { x: beforeVerts[bestIdx].x - ac.x, y: beforeVerts[bestIdx].y - ac.y, z: beforeVerts[bestIdx].z - ac.z };
            var sac = toPx(EduCADOrthographic.toView3D(ac, rotView, map));
            ctx.strokeStyle = axisColor;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            seg(sac, b2r[bestIdx]);
            ctx.setLineDash([]);
            ctx.globalAlpha = 0.85;
            seg(sac, a2r[bestIdx]);
            ctx.globalAlpha = 1;
            ctx.lineWidth = 1.6;
            var steps = 20, arcPts = [];
            for (var step = 0; step <= steps; step++) {
              var ang = delta.theta * (step / steps);
              var rm = EduCADPose.axisAngleMatrix(delta.u[0], delta.u[1], delta.u[2], ang);
              var wp = {
                x: ac.x + rm[0] * rv0.x + rm[1] * rv0.y + rm[2] * rv0.z,
                y: ac.y + rm[3] * rv0.x + rm[4] * rv0.y + rm[5] * rv0.z,
                z: ac.z + rm[6] * rv0.x + rm[7] * rv0.y + rm[8] * rv0.z
              };
              arcPts.push(toPx(EduCADOrthographic.toView3D(wp, rotView, map)));
            }
            ctx.beginPath();
            for (var m = 0; m < arcPts.length; m++) {
              if (m === 0) ctx.moveTo(arcPts[m].x, arcPts[m].y);
              else ctx.lineTo(arcPts[m].x, arcPts[m].y);
            }
            ctx.stroke();
            arrow(arcPts[steps - 1], arcPts[steps]);
            if (labelText) {
              var midPt = arcPts[Math.floor(steps / 2)];
              var mdx2 = midPt.x - sac.x, mdy2 = midPt.y - sac.y, ml2 = Math.hypot(mdx2, mdy2) || 1;
              drawBannerPill(midPt.x + (mdx2 / ml2) * 20, midPt.y + (mdy2 / ml2) * 20, labelText, axisColor, true);
              placed = true;
            }
          }
        }
        if (!placed && labelText) {
          var boxR = viewBox(afterVerts, rotView);
          drawBannerPill((boxR.x0 + boxR.x1) / 2, boxR.y0 - 20, labelText, axisColor, true);
          placed = true;
        }
      } else if (delta && delta.op === 'scale') {
        var b2s = beforeVerts.map(function (v) { return toPx(EduCADOrthographic.toView3D(v, 'ELEVATION', map)); });
        var a2s = afterVerts.map(function (v) { return toPx(EduCADOrthographic.toView3D(v, 'ELEVATION', map)); });
        var farIdx = 0, farDist = -1;
        for (var si = 0; si < b2s.length; si++) {
          var sd = Math.hypot(a2s[si].x - b2s[si].x, a2s[si].y - b2s[si].y);
          if (sd > farDist) { farDist = sd; farIdx = si; }
        }
        if (farDist >= 3) {
          ctx.strokeStyle = axisColor;
          ctx.lineWidth = 1.5;
          seg(b2s[farIdx], a2s[farIdx]);
          arrow(b2s[farIdx], a2s[farIdx]);
        }
        if (labelText) {
          var boxS = viewBox(afterVerts, 'ELEVATION');
          drawBannerPill((boxS.x0 + boxS.x1) / 2, boxS.y0 - 20, labelText, axisColor, true);
          placed = true;
        }
      }
      if (!placed && labelText) {
        var boxF = viewBox(afterVerts, 'ELEVATION');
        drawBannerPill((boxF.x0 + boxF.x1) / 2, boxF.y0 - 20, labelText, axisColor, true);
      }
      ctx.restore();
      return;
    }

    var summary = EduCADPose.formatPoseSummary(poseState.pose, poseState.limited);
    if (summary) {
      var boxIdle = viewBox(afterVerts, 'ELEVATION');
      drawBannerPill((boxIdle.x0 + boxIdle.x1) / 2, boxIdle.y0 - 22, summary, ink, false);
    }
  }

  function drawSheetOverlay(ctx, view, poseState, map, prefs) {
    drawSheetTransform(ctx, view, poseState, map);
    if (poseState && poseState.sims && Number.isInteger(poseState.pointIndex)) {
      var point = poseState.sims.posed[poseState.pointIndex];
      if (point) EduCADOrthographic.drawProjectedOffsets(ctx, view, prefs, point, map, []);
    }
    if (poseState && poseState.trackedCorner) drawTrackedCorner(ctx, view, poseState, map, prefs);
    else if (poseState && poseState.trackedSpan) drawTrackedSpan(ctx, view, poseState, map, prefs);
    else drawTrackedEdge(ctx, view, poseState, map, prefs);
  }

  return {
    trackedSummary: trackedSummary,
    hitTestTrackedView: hitTestTrackedView, pickProjectedPoint: pickProjectedPoint,
    posedScene: posedScene, drawPlanes: drawPlanes,
    drawGlassOverlay: drawGlassOverlay,
    drawTrackedEdge: drawTrackedEdge,
    drawTrackedCorner: drawTrackedCorner,
    drawTrackedSpan: drawTrackedSpan,
    drawSheetTransform: drawSheetTransform,
    drawSheetOverlay: drawSheetOverlay
  };
});

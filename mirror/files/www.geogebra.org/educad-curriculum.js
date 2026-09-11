(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADCurriculum = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD Phase 6 procedural curriculum generators.
  // World coordinates in mm only inside entities and solvers; screen px is
  // ephemeral render only and never stored. Projector invariant: elevation x
  // equals plan x (mm). Dual-env: browser via window.EduCADCurriculum,
  // plain Node via module.exports. Zero dependencies. No 3D. Canvas2D only.
  var WORLD_UNITS = 'mm';
  var VERSION = '6.0.0-educad';
  var DEG = Math.PI / 180;
  var VERTICAL_EPS = 1e-9;
  var SOLID_SIZE_MM = 35;
  var QUADRANTS = [1, 2, 3, 4];
  var PROJECTIONS = ['FIRST_ANGLE', 'THIRD_ANGLE'];
  var SOLID_TYPES = ['PRISM', 'PYRAMID', 'CYLINDER', 'CONE'];
  var BIS_CODES = ['A', 'B', 'E', 'G', 'H', 'K'];
  var VIEW_ROLES = ['PLAN', 'ELEVATION', 'BOTH'];

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

  function primeLabel(label) { return String(label) + "'"; }

  function normalizeProjection(p) {
    var s = String(p === undefined ? 'FIRST_ANGLE' : p).trim().toUpperCase().replace(/[-\s]+/g, '_');
    if (s === 'FIRST_ANGLE' || s === 'FIRST' || s === '1' || s === 'BIS' || s === 'FIRSTANGLE') return 'FIRST_ANGLE';
    if (s === 'THIRD_ANGLE' || s === 'THIRD' || s === '3' || s === 'ASME' || s === 'THIRDANGLE') return 'THIRD_ANGLE';
    throw new Error('unknown projection: ' + String(p));
  }

  function normalizeQuadrant(q) {
    if (q !== 1 && q !== 2 && q !== 3 && q !== 4) throw new Error('quadrant must be 1, 2, 3 or 4, got ' + String(q));
    return q;
  }

  function normalizeSolid(s) {
    var k = String(s === undefined ? '' : s).trim().toUpperCase();
    if (SOLID_TYPES.indexOf(k) === -1) throw new Error('unknown solid: ' + String(s));
    return k;
  }

  function isValidBis(c) { return BIS_CODES.indexOf(c) !== -1; }
  function isValidRole(r) { return VIEW_ROLES.indexOf(r) !== -1; }

  // Entity-table-compatible spec (mm only, never px). Lacks id; table assigns.
  function spec(type, o) {
    o = o || {};
    var bis = (o.bisCode === undefined) ? 'B' : o.bisCode;
    var role = (o.viewRole === undefined) ? 'BOTH' : o.viewRole;
    if (!isValidBis(bis)) throw new Error('unknown bisCode: ' + String(bis));
    if (!isValidRole(role)) throw new Error('unknown viewRole: ' + String(role));
    var x = (o.x === undefined) ? 0 : o.x;
    var y = (o.y === undefined) ? 0 : o.y;
    var x2 = (o.x2 === undefined) ? 0 : o.x2;
    var y2 = (o.y2 === undefined) ? 0 : o.y2;
    var radius = (o.radius === undefined) ? 0 : o.radius;
    var sa = (o.startAngle === undefined) ? 0 : o.startAngle;
    var ea = (o.endAngle === undefined) ? 0 : o.endAngle;
    assertFinite(x, y, x2, y2, radius, sa, ea);
    return {
      type: type, x: x, y: y, x2: x2, y2: y2, radius: radius,
      startAngle: sa, endAngle: ea, bisCode: bis, viewRole: role,
      visible: true, locked: false,
      layer: (o.layer === undefined) ? 'layer1' : String(o.layer),
      color: null, thickness: null,
      caption: (o.caption === undefined) ? '' : String(o.caption),
      showLabel: !!o.showLabel, meta: (o.meta === undefined) ? {} : o.meta
    };
  }

  function ptSpec(x, y, role, bis, caption, meta) {
    return spec('POINT', { x: x, y: y, bisCode: bis, viewRole: role, caption: caption, showLabel: true, meta: meta || {} });
  }

  function segSpec(x1, y1, x2, y2, role, bis, caption, meta, label) {
    return spec('SEGMENT', { x: x1, y: y1, x2: x2, y2: y2, bisCode: bis, viewRole: role,
      caption: caption || '', showLabel: !!label, meta: meta || {} });
  }

  function lineSpec(x1, y1, x2, y2, role, bis, caption, meta) {
    return spec('LINE', { x: x1, y: y1, x2: x2, y2: y2, bisCode: bis, viewRole: role,
      caption: caption || '', showLabel: false, meta: meta || {} });
  }

  function circleSpec(x, y, r, role, bis, caption, meta) {
    return spec('CIRCLE', { x: x, y: y, radius: r, bisCode: bis, viewRole: role,
      caption: caption || '', showLabel: false, meta: meta || {} });
  }

  function datumSpec(x1, x2, caption) {
    return spec('DATUM_AXIS', { x: x1, y: 0, x2: x2, y2: 0, bisCode: 'G', viewRole: 'BOTH',
      caption: caption || 'XY', showLabel: true, meta: { kind: 'XY' } });
  }

  function locusRec(view, yMm, label) {
    assertFinite(yMm);
    return { view: view, yMm: yMm, kind: 'locus', label: label || '' };
  }

  function projectorRec(xMm, planY, elevY) {
    assertFinite(xMm, planY, elevY);
    return { xMm: xMm, planY: planY, elevY: elevY };
  }

  function projectionNote(proj) {
    return proj === 'FIRST_ANGLE' ? 'first-angle BIS (plan below, elevation above XY)'
      : 'third-angle ASME (plan above, elevation above XY variant marker)';
  }

  // Quadrant point: Q1(+,-) Q2(+,+) Q3(-,+) Q4(-,-) as (elevY, planY) signs.
  function quadrantPoint(opts) {
    opts = opts || {};
    var q = normalizeQuadrant(opts.quadrant === undefined ? 1 : opts.quadrant);
    var proj = normalizeProjection(opts.projection === undefined ? 'FIRST_ANGLE' : opts.projection);
    var label = String(opts.label === undefined ? 'a' : opts.label);
    var distHP = (opts.distHP === undefined) ? 20 : opts.distHP;
    var distVP = (opts.distVP === undefined) ? 15 : opts.distVP;
    var xMm = (opts.xMm === undefined) ? 10 : opts.xMm;
    assertFinite(distHP, distVP, xMm);
    if (distHP < 0 || distVP < 0) throw new Error('distHP/distVP must be >= 0');
    var planY, elevY;
    if (q === 1) { planY = -distVP; elevY = distHP; }
    else if (q === 2) { planY = distVP; elevY = distHP; }
    else if (q === 3) { planY = distVP; elevY = -distHP; }
    else { planY = -distVP; elevY = -distHP; }
    // Anti-collision: in Q2/Q4 both views share one side of XY, so when
    // plan and elevation sit within 6 mm their captions overlap. Push the
    // labels apart via meta offsets (geometry untouched).
    var planMeta = { kind: 'quadrant-point', quadrant: q, projection: proj };
    var elevMeta = { kind: 'quadrant-point', quadrant: q, projection: proj };
    if (Math.abs(elevY - planY) < 6) {
      var s = (elevY >= planY) ? 1 : -1;
      elevMeta.labelDyMm = s * 3;
      planMeta.labelDyMm = -s * 3;
    }
    var entities = [
      datumSpec(xMm - 25, xMm + 25),
      ptSpec(xMm, planY, 'PLAN', 'B', label, planMeta),
      ptSpec(xMm, elevY, 'ELEVATION', 'B', primeLabel(label), elevMeta),
      segSpec(xMm, planY, xMm, elevY, 'BOTH', 'G', 'proj-' + label, { kind: 'projector' })
    ];
    var loci = [locusRec('PLAN', planY, label), locusRec('ELEVATION', elevY, primeLabel(label))];
    var projectors = [projectorRec(xMm, planY, elevY)];
    var steps = [
      '1. Draw XY ground line (mm) with 25 mm margins at x=' + xMm + ' mm.',
      '2. Mark projector x=' + xMm + ' mm; elevation x equals plan x.',
      '3. Place ' + label + ' (plan) at y=' + planY + ' mm for Q' + q + ' (distVP=' + distVP + ' mm).',
      "4. Place " + primeLabel(label) + " (elevation) at y=" + elevY + ' mm for Q' + q + ' (distHP=' + distHP + ' mm).',
      '5. Join projector Type G thin chain; check loci horizontals.',
      '6. Projection: ' + projectionNote(proj) + '.'
    ];
    return {
      kind: 'quadrant-point', quadrant: q, projection: proj, label: label,
      plan: { x: xMm, y: planY }, elev: { x: xMm, y: elevY },
      distHP: distHP, distVP: distVP, xMm: xMm,
      entities: entities, steps: steps, loci: loci, projectors: projectors,
      projectorOk: checkProjector({ x: xMm, y: planY }, { x: xMm, y: elevY })
    };
  }

  function quadrantSet(opts) {
    opts = opts || {};
    var labels = opts.labels || ['a', 'b', 'c', 'd'];
    var xs = opts.xs || [-30, -10, 10, 30];
    var out = [];
    for (var i = 0; i < 4; i++) {
      out.push(quadrantPoint({
        quadrant: i + 1, label: labels[i], xMm: xs[i],
        distHP: opts.distHP, distVP: opts.distVP, projection: opts.projection
      }));
    }
    return out;
  }

  // Straight line with theta/phi rotation: PL=TL cos theta, EL=TL cos phi.
  function straightLine(opts) {
    opts = opts || {};
    var TL = (opts.TL === undefined) ? 50 : opts.TL;
    var thetaDeg = (opts.thetaDeg === undefined) ? 30 : opts.thetaDeg;
    var phiDeg = (opts.phiDeg === undefined) ? 30 : opts.phiDeg;
    var axMm = (opts.axMm === undefined) ? 0 : opts.axMm;
    var yaPlan = (opts.yaPlan === undefined) ? -10 : opts.yaPlan;
    var yaElev = (opts.yaElev === undefined) ? 20 : opts.yaElev;
    assertFinite(TL, thetaDeg, phiDeg, axMm, yaPlan, yaElev);
    if (TL <= 0) throw new Error('TL must be > 0');
    var labelA = String(opts.labelA === undefined ? 'a' : opts.labelA);
    var labelB = String(opts.labelB === undefined ? 'b' : opts.labelB);
    var PL = TL * Math.cos(thetaDeg * DEG);
    var EL = TL * Math.cos(phiDeg * DEG);
    var dh = TL * Math.sin(thetaDeg * DEG);
    var dd = TL * Math.sin(phiDeg * DEG);
    var locusPlanY = yaPlan - TL * Math.sin(phiDeg * DEG);
    var locusElevY = yaElev + TL * Math.sin(thetaDeg * DEG);
    var dx = Math.sqrt(Math.max(0, TL * TL - dh * dh - dd * dd));
    var bx = axMm + dx;
    var st = Math.sin(thetaDeg * DEG), sp = Math.sin(phiDeg * DEG);
    var physicallyImpossible = (st * st + sp * sp) > 1 + 1e-9;
    var meta = { kind: 'straight-line', TL: TL, thetaDeg: thetaDeg, phiDeg: phiDeg };
    var degenerateViews = [];
    // Apparent views shorter than 1e-6 mm (e.g. theta = 90 deg collapses
    // the plan to a point) are emitted as POINTs, never zero-length
    // SEGMENTs, so direction vectors downstream never divide by zero.
    function viewSeg(x1, y1, x2, y2, role, bis, caption, viewTag, m) {
      var mm = (m === undefined) ? meta : m;
      var ddx = x2 - x1, ddy = y2 - y1;
      if (ddx * ddx + ddy * ddy < 1e-12) {
        degenerateViews.push(viewTag);
        return ptSpec(x1, y1, role, bis, caption, mm);
      }
      return segSpec(x1, y1, x2, y2, role, bis, caption, mm);
    }
    var entities = [
      datumSpec(Math.min(axMm, bx) - 15, Math.max(axMm, bx) + 15),
      ptSpec(axMm, yaPlan, 'PLAN', 'B', labelA, meta),
      ptSpec(bx, locusPlanY, 'PLAN', 'B', labelB, meta),
      ptSpec(axMm, yaElev, 'ELEVATION', 'B', primeLabel(labelA), meta),
      ptSpec(bx, locusElevY, 'ELEVATION', 'B', primeLabel(labelB), meta),
      viewSeg(axMm, yaPlan, bx, locusPlanY, 'PLAN', 'A', labelA + labelB, 'PLAN'),
      viewSeg(axMm, yaElev, bx, locusElevY, 'ELEVATION', 'A', primeLabel(labelA + labelB), 'ELEVATION'),
      viewSeg(axMm, yaPlan, axMm, yaElev, 'BOTH', 'G', 'proj-' + labelA, 'PROJECTOR_A', { kind: 'projector' }),
      viewSeg(bx, locusPlanY, bx, locusElevY, 'BOTH', 'G', 'proj-' + labelB, 'PROJECTOR_B', { kind: 'projector' }),
      lineSpec(Math.min(axMm, bx) - 15, locusPlanY, Math.max(axMm, bx) + 15, locusPlanY, 'PLAN', 'K', 'locus-' + labelB, { kind: 'locus' }),
      lineSpec(Math.min(axMm, bx) - 15, locusElevY, Math.max(axMm, bx) + 15, locusElevY, 'ELEVATION', 'K', 'locus-' + primeLabel(labelB), { kind: 'locus' })
    ];
    var loci = [locusRec('PLAN', locusPlanY, labelB), locusRec('ELEVATION', locusElevY, primeLabel(labelB))];
    var projectors = [projectorRec(axMm, yaPlan, yaElev), projectorRec(bx, locusPlanY, locusElevY)];
    var steps = [
      '1. Draw XY; fix A at x=' + axMm + ' mm (plan y=' + yaPlan + ', elev y=' + yaElev + ').',
      '2. Rotation step theta: PL = TL cos theta = ' + PL + ' mm (TL=' + TL + ', theta=' + thetaDeg + ' deg).',
      '3. Rotation step phi: EL = TL cos phi = ' + EL + ' mm (phi=' + phiDeg + ' deg).',
      '4. Locus of B (plan): y = ya - TL sin phi = ' + locusPlanY + ' mm.',
      "5. Locus of B-prime (elevation): y = ya' + TL sin theta = " + locusElevY + ' mm.',
      '6. Projector dx = sqrt(TL^2 - dh^2 - dd^2) = ' + dx + ' mm; B x = ' + bx + ' mm.',
      '7. Join AB plan and A-prime B-prime elevation Type A; projectors Type G hold elev.x == plan.x.'
    ];
    if (physicallyImpossible) {
      steps.push(steps.length + 1 + '. WARNING: theta + phi = ' + (thetaDeg + phiDeg) +
        ' deg exceeds 90 deg; no real 3D line has these inclinations (dx clamped to 0).');
    }
    if (degenerateViews.length > 0) {
      steps.push(steps.length + 1 + '. NOTE: collapsed ' + degenerateViews.join(', ') +
        ' emitted as POINT (apparent length below 1e-6 mm).');
    }
    var ok = checkProjector({ x: axMm, y: yaPlan }, { x: axMm, y: yaElev }) &&
      checkProjector({ x: bx, y: locusPlanY }, { x: bx, y: locusElevY });
    return {
      kind: 'straight-line', TL: TL, thetaDeg: thetaDeg, phiDeg: phiDeg,
      physicallyImpossible: physicallyImpossible,
      degenerateViews: degenerateViews,
      PL: PL, EL: EL, dh: dh, dd: dd, dx: dx,
      locusPlanY: locusPlanY, locusElevY: locusElevY,
      aPlan: { x: axMm, y: yaPlan }, bPlan: { x: bx, y: locusPlanY },
      aElev: { x: axMm, y: yaElev }, bElev: { x: bx, y: locusElevY },
      entities: entities, steps: steps, loci: loci, projectors: projectors, projectorOk: ok
    };
  }

  // Plane surface with HT/VT traces meeting on XY plus tilt angle.
  function planeSurface(opts) {
    opts = opts || {};
    var xMm = (opts.xMm === undefined) ? 0 : opts.xMm;
    var sizeMm = (opts.sizeMm === undefined) ? 40 : opts.sizeMm;
    var tiltDeg = (opts.tiltDeg === undefined) ? 30 : opts.tiltDeg;
    assertFinite(xMm, sizeMm, tiltDeg);
    if (sizeMm <= 0) throw new Error('sizeMm must be > 0');
    var x1 = xMm - sizeMm / 2, x2 = xMm + sizeMm / 2;
    var vtx = xMm + sizeMm * Math.cos(tiltDeg * DEG);
    var vty = sizeMm * Math.sin(tiltDeg * DEG);
    var meta = { kind: 'plane-surface', tiltDeg: tiltDeg, sizeMm: sizeMm };
    var HTplan = { x1: x1, y1: 0, x2: x2, y2: 0 };
    var HTelev = { x1: x1, y1: 0, x2: x2, y2: 0 };
    var VTplan = { x1: xMm, y1: 0, x2: vtx, y2: 0 };
    var VTelev = { x1: xMm, y1: 0, x2: vtx, y2: vty };
    var entities = [
      datumSpec(x1 - 15, Math.max(x2, vtx) + 15),
      segSpec(HTplan.x1, 0, HTplan.x2, 0, 'PLAN', 'A', 'HT', meta),
      segSpec(HTelev.x1, 0, HTelev.x2, 0, 'ELEVATION', 'G', "HT'", { kind: 'projector-mate' }),
      segSpec(VTelev.x1, VTelev.y1, VTelev.x2, VTelev.y2, 'ELEVATION', 'A', "VT'", meta),
      segSpec(VTplan.x1, 0, VTplan.x2, 0, 'PLAN', 'G', 'VT', { kind: 'projector-mate' }),
      segSpec(vtx, 0, vtx, vty, 'BOTH', 'G', 'proj-VT', { kind: 'projector' }),
      lineSpec(x1 - 15, 0, Math.max(x2, vtx) + 15, 0, 'BOTH', 'K', 'locus-XY', { kind: 'locus' })
    ];
    var loci = [locusRec('PLAN', 0, 'HT'), locusRec('ELEVATION', vty, "VT'")];
    var projectors = [projectorRec(x1, 0, 0), projectorRec(x2, 0, 0), projectorRec(vtx, 0, vty)];
    var steps = [
      '1. Draw XY; HT and VT traces meet on XY at x=' + xMm + ' mm.',
      '2. HT trace (plan): horizontal ' + sizeMm + ' mm on XY, Type A visible.',
      "3. VT trace (elevation): tilt " + tiltDeg + ' deg to (' + vtx + ', ' + vty + ') mm, Type A.',
      '4. Projector mates Type G vertical: elev.x == plan.x at HT ends and VT tip.',
      '5. Locus horizontals Type K through XY and VT tip complete the plane.'
    ];
    var ok = checkProjector({ x: vtx, y: 0 }, { x: vtx, y: vty });
    return {
      kind: 'plane-surface', xMm: xMm, sizeMm: sizeMm, tiltDeg: tiltDeg,
      HTplan: HTplan, HTelev: HTelev, VTplan: VTplan, VTelev: VTelev,
      traces: { HTplan: HTplan, HTelev: HTelev, VTplan: VTplan, VTelev: VTelev },
      entities: entities, steps: steps, loci: loci, projectors: projectors, projectorOk: ok
    };
  }

  // 35 mm regular solids: prism, pyramid, cylinder, cone.
  function regularSolid(opts) {
    opts = opts || {};
    var solid = normalizeSolid(opts.solid === undefined ? 'PRISM' : opts.solid);
    var sizeMm = (opts.sizeMm === undefined) ? SOLID_SIZE_MM : opts.sizeMm;
    var heightMm = (opts.heightMm === undefined) ? sizeMm : opts.heightMm;
    var xMm = (opts.xMm === undefined) ? 0 : opts.xMm;
    assertFinite(sizeMm, heightMm, xMm);
    if (sizeMm <= 0 || heightMm <= 0) throw new Error('sizeMm/heightMm must be > 0');
    var h = sizeMm / 2, r = sizeMm / 2;
    var xL = xMm - h, xR = xMm + h;
    var planYc = -(h + 8);
    var meta = { kind: 'regular-solid', solid: solid, sizeMm: sizeMm, heightMm: heightMm };
    var entities = [datumSpec(xL - 15, xR + 15)];
    var loci = [];
    var projectors = [];
    var steps = [];
    function proj(x, py, ey, cap) {
      entities.push(segSpec(x, py, x, ey, 'BOTH', 'G', cap, { kind: 'projector' }));
      projectors.push(projectorRec(x, py, ey));
    }
    function axis(x, y1, y2, role) {
      entities.push(lineSpec(x, y1, x, y2, role, 'G', 'axis', { kind: 'axis' }));
    }
    function locusH(y, role, cap) {
      entities.push(lineSpec(xL - 15, y, xR + 15, y, role, 'K', cap, { kind: 'locus' }));
      loci.push(locusRec('ELEVATION', y, cap));
    }
    if (solid === 'PRISM') {
      var py1 = planYc - h, py2 = planYc + h;
      entities.push(segSpec(xL, py1, xR, py1, 'PLAN', 'A', 'p1p2', meta));
      entities.push(segSpec(xR, py1, xR, py2, 'PLAN', 'A', 'p2p3', meta));
      entities.push(segSpec(xR, py2, xL, py2, 'PLAN', 'A', 'p3p4', meta));
      entities.push(segSpec(xL, py2, xL, py1, 'PLAN', 'A', 'p4p1', meta));
      entities.push(segSpec(xL, 0, xR, 0, 'ELEVATION', 'A', "p1'p2'", meta));
      entities.push(segSpec(xR, 0, xR, heightMm, 'ELEVATION', 'A', "p2'p3'", meta));
      entities.push(segSpec(xR, heightMm, xL, heightMm, 'ELEVATION', 'A', "p3'p4'", meta));
      entities.push(segSpec(xL, heightMm, xL, 0, 'ELEVATION', 'A', "p4'p1'", meta));
      entities.push(segSpec(xL, heightMm / 2, xR, heightMm / 2, 'ELEVATION', 'E', 'hidden-seam', { kind: 'hidden' }));
      axis(xMm, py1 - 6, py2 + 6, 'PLAN');
      axis(xMm, -6, heightMm + 6, 'ELEVATION');
      proj(xL, py2, heightMm, 'proj-L');
      proj(xR, py2, heightMm, 'proj-R');
      locusH(0, 'ELEVATION', 'locus-base');
      locusH(heightMm, 'ELEVATION', 'locus-top');
      steps = [
        '1. Draw XY; 35 mm square prism base centred at x=' + xMm + ' mm.',
        '2. Plan: 35x35 mm square Type A visible below XY.',
        '3. Elevation: 35x' + heightMm + ' mm rectangle Type A above XY; hidden seam Type E.',
        '4. Centre axes Type G; projectors hold elev.x == plan.x at left/right edges.',
        "5. Loci Type K through base y=0 and top y=" + heightMm + " mm; prime labels (p1') in elevation."
      ];
    } else if (solid === 'PYRAMID') {
      var qy1 = planYc - h, qy2 = planYc + h;
      entities.push(segSpec(xL, qy1, xR, qy1, 'PLAN', 'A', 'b1b2', meta));
      entities.push(segSpec(xR, qy1, xR, qy2, 'PLAN', 'A', 'b2b3', meta));
      entities.push(segSpec(xR, qy2, xL, qy2, 'PLAN', 'A', 'b3b4', meta));
      entities.push(segSpec(xL, qy2, xL, qy1, 'PLAN', 'A', 'b4b1', meta));
      entities.push(segSpec(xL, qy1, xMm, planYc, 'PLAN', 'B', 's-b1', meta));
      entities.push(segSpec(xR, qy2, xMm, planYc, 'PLAN', 'E', 's-b3-hidden', { kind: 'hidden' }));
      entities.push(ptSpec(xMm, planYc, 'PLAN', 'B', 's', meta));
      entities.push(segSpec(xL, 0, xR, 0, 'ELEVATION', 'A', "b1'b2'", meta));
      entities.push(segSpec(xL, 0, xMm, heightMm, 'ELEVATION', 'A', "b1's'", meta));
      entities.push(segSpec(xR, 0, xMm, heightMm, 'ELEVATION', 'A', "b2's'", meta));
      entities.push(ptSpec(xMm, heightMm, 'ELEVATION', 'B', "s'", meta));
      axis(xMm, qy1 - 6, qy2 + 6, 'PLAN');
      axis(xMm, -6, heightMm + 6, 'ELEVATION');
      proj(xL, qy2, 0, 'proj-L');
      proj(xR, qy2, 0, 'proj-R');
      proj(xMm, planYc, heightMm, 'proj-apex');
      locusH(0, 'ELEVATION', 'locus-base');
      locusH(heightMm, 'ELEVATION', 'locus-apex');
      steps = [
        '1. Draw XY; 35 mm square pyramid base centred at x=' + xMm + ' mm.',
        '2. Plan: base square Type A + apex s with one slant Type E hidden.',
        "3. Elevation: triangle Type A with apex s' at height " + heightMm + ' mm.',
        '4. Axes Type G; apex projector holds elev.x == plan.x.',
        '5. Loci Type K through base and apex.'
      ];
    } else if (solid === 'CYLINDER') {
      entities.push(circleSpec(xMm, planYc, r, 'PLAN', 'A', 'rim', meta));
      entities.push(ptSpec(xMm, planYc, 'PLAN', 'B', 'o', meta));
      entities.push(segSpec(xL, 0, xR, 0, 'ELEVATION', 'A', "o1'o2'", meta));
      entities.push(segSpec(xR, 0, xR, heightMm, 'ELEVATION', 'A', 'gen-R', meta));
      entities.push(segSpec(xR, heightMm, xL, heightMm, 'ELEVATION', 'A', 'top', meta));
      entities.push(segSpec(xL, heightMm, xL, 0, 'ELEVATION', 'A', 'gen-L', meta));
      entities.push(segSpec(xL + 4, 0, xR - 4, 0, 'ELEVATION', 'E', 'hidden-base', { kind: 'hidden' }));
      axis(xMm, planYc - r - 6, planYc + r + 6, 'PLAN');
      axis(xMm, -6, heightMm + 6, 'ELEVATION');
      proj(xL, planYc, heightMm / 2, 'proj-L');
      proj(xR, planYc, heightMm / 2, 'proj-R');
      locusH(0, 'ELEVATION', 'locus-base');
      locusH(heightMm, 'ELEVATION', 'locus-top');
      steps = [
        '1. Draw XY; 35 mm diameter cylinder axis at x=' + xMm + ' mm.',
        '2. Plan: circle d=35 mm (r=17.5 mm) Type A + centre o.',
        '3. Elevation: 35x' + heightMm + ' mm rectangle Type A; hidden base Type E.',
        '4. Axis Type G vertical; rim projectors hold elev.x == plan.x.',
        '5. Loci Type K through base and top.'
      ];
    } else {
      entities.push(circleSpec(xMm, planYc, r, 'PLAN', 'A', 'base', meta));
      entities.push(ptSpec(xMm, planYc, 'PLAN', 'B', 's', meta));
      entities.push(segSpec(xL, 0, xR, 0, 'ELEVATION', 'A', "b1'b2'", meta));
      entities.push(segSpec(xL, 0, xMm, heightMm, 'ELEVATION', 'A', "b1's'", meta));
      entities.push(segSpec(xR, 0, xMm, heightMm, 'ELEVATION', 'A', "b2's'", meta));
      entities.push(segSpec(xL + 6, 0, xR - 6, 0, 'ELEVATION', 'E', 'hidden-base', { kind: 'hidden' }));
      entities.push(ptSpec(xMm, heightMm, 'ELEVATION', 'B', "s'", meta));
      axis(xMm, planYc - r - 6, planYc + r + 6, 'PLAN');
      axis(xMm, -6, heightMm + 6, 'ELEVATION');
      proj(xL, planYc, 0, 'proj-L');
      proj(xR, planYc, 0, 'proj-R');
      proj(xMm, planYc, heightMm, 'proj-apex');
      locusH(0, 'ELEVATION', 'locus-base');
      locusH(heightMm, 'ELEVATION', 'locus-apex');
      steps = [
        '1. Draw XY; 35 mm diameter cone axis at x=' + xMm + ' mm.',
        '2. Plan: base circle d=35 mm Type A + apex s at centre.',
        "3. Elevation: triangle Type A with apex s' at height " + heightMm + ' mm; hidden base Type E.',
        '4. Axis Type G; apex/rim projectors hold elev.x == plan.x.',
        '5. Loci Type K through base and apex.'
      ];
    }
    var ok = true;
    for (var i = 0; i < projectors.length; i++) {
      var p = projectors[i];
      if (!checkProjector({ x: p.xMm, y: p.planY }, { x: p.xMm, y: p.elevY })) { ok = false; break; }
    }
    return {
      kind: 'regular-solid', solid: solid, sizeMm: sizeMm, heightMm: heightMm, xMm: xMm,
      entities: entities, steps: steps, loci: loci, projectors: projectors, projectorOk: ok
    };
  }

  // Dispatcher across lesson kinds.
  function generateLesson(kind, opts) {
    var k = String(kind === undefined ? '' : kind).trim().toUpperCase().replace(/[-\s]+/g, '_');
    if (k === 'POINT' || k === 'QUADRANT' || k === 'QUADRANT_POINT') return quadrantPoint(opts);
    if (k === 'LINE' || k === 'STRAIGHT_LINE' || k === 'STRAIGHTLINE') return straightLine(opts);
    if (k === 'PLANE' || k === 'PLANE_SURFACE' || k === 'SURFACE') return planeSurface(opts);
    if (k === 'SOLID' || k === 'REGULAR_SOLID' || k === 'REGULARSOLID') return regularSolid(opts);
    throw new Error('unknown lesson kind: ' + String(kind));
  }

  // Full curriculum bundle: quadrants + line + plane + 4 solids.
  function generateCurriculum(opts) {
    opts = opts || {};
    var quads = quadrantSet({ distHP: opts.distHP, distVP: opts.distVP, projection: opts.projection });
    var line = straightLine(opts.line || { TL: 50, thetaDeg: 30, phiDeg: 30 });
    var plane = planeSurface(opts.plane || { tiltDeg: 30 });
    var solids = SOLID_TYPES.map(function (s, i) {
      return regularSolid({ solid: s, xMm: (i - 1.5) * 90 });
    });
    var entities = [], steps = [], loci = [], projectors = [];
    function absorb(b, tag) {
      for (var i = 0; i < b.entities.length; i++) entities.push(b.entities[i]);
      for (var j = 0; j < b.steps.length; j++) steps.push('[' + tag + '] ' + b.steps[j]);
      for (var k = 0; k < b.loci.length; k++) loci.push(b.loci[k]);
      for (var m = 0; m < b.projectors.length; m++) projectors.push(b.projectors[m]);
    }
    for (var q = 0; q < quads.length; q++) absorb(quads[q], 'Q' + (q + 1));
    absorb(line, 'LINE');
    absorb(plane, 'PLANE');
    for (var s = 0; s < solids.length; s++) absorb(solids[s], solids[s].solid);
    var ok = true;
    for (var p = 0; p < projectors.length; p++) {
      var pr = projectors[p];
      if (!checkProjector({ x: pr.xMm, y: pr.planY }, { x: pr.xMm, y: pr.elevY })) { ok = false; break; }
    }
    return {
      kind: 'curriculum', quadrants: quads, line: line, plane: plane, solids: solids,
      entities: entities, steps: steps, loci: loci, projectors: projectors, projectorOk: ok
    };
  }

  // Validate a bundle: mm-only finite, no px keys, valid bis/role, projectors.
  function validateBundle(bundle) {
    var errors = [];
    if (!bundle || !Array.isArray(bundle.entities)) { errors.push('bundle.entities must be an array'); return { ok: false, errors: errors }; }
    for (var i = 0; i < bundle.entities.length; i++) {
      var e = bundle.entities[i];
      var keys = Object.keys(e);
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].toLowerCase().indexOf('px') !== -1) errors.push('px key on entity ' + i + ': ' + keys[k]);
      }
      ['x', 'y', 'x2', 'y2', 'radius', 'startAngle', 'endAngle'].forEach(function (f) {
        if (typeof e[f] !== 'number' || Number.isNaN(e[f]) || !Number.isFinite(e[f])) {
          errors.push('non-finite ' + f + ' on entity ' + i);
        }
      });
      if (!isValidBis(e.bisCode)) errors.push('bad bisCode on entity ' + i);
      if (!isValidRole(e.viewRole)) errors.push('bad viewRole on entity ' + i);
    }
    (bundle.projectors || []).forEach(function (p, idx) {
      if (!checkProjector({ x: p.xMm, y: p.planY }, { x: p.xMm, y: p.elevY })) {
        errors.push('projector broken at ' + idx);
      }
    });
    if (!Array.isArray(bundle.steps) || bundle.steps.length === 0) errors.push('bundle.steps missing');
    if (!Array.isArray(bundle.loci) || bundle.loci.length === 0) errors.push('bundle.loci missing');
    return { ok: errors.length === 0, errors: errors };
  }

  return {
    WORLD_UNITS: WORLD_UNITS,
    VERSION: VERSION,
    VERTICAL_EPS: VERTICAL_EPS, PROJECTOR_EPS: VERTICAL_EPS,
    SOLID_SIZE_MM: SOLID_SIZE_MM,
    QUADRANTS: QUADRANTS, QUADRANT_IDS: QUADRANTS,
    PROJECTIONS: PROJECTIONS,
    PROJECTION_FIRST: 'FIRST_ANGLE', PROJECTION_THIRD: 'THIRD_ANGLE',
    FIRST_ANGLE: 'FIRST_ANGLE', THIRD_ANGLE: 'THIRD_ANGLE',
    SOLID_TYPES: SOLID_TYPES, REGULAR_SOLIDS: SOLID_TYPES,
    BIS_CODES: BIS_CODES, VIEW_ROLES: VIEW_ROLES,
    assertFinite: assertFinite,
    checkProjector: checkProjector,
    primeLabel: primeLabel, primedLabel: primeLabel,
    normalizeProjection: normalizeProjection, normalizeQuadrant: normalizeQuadrant,
    normalizeSolid: normalizeSolid,
    quadrantPoint: quadrantPoint, quadrantLesson: quadrantPoint, pointLesson: quadrantPoint,
    quadrantSet: quadrantSet, quadrantPoints: quadrantSet, allQuadrants: quadrantSet,
    straightLine: straightLine, lineLesson: straightLine, mongeLine: straightLine,
    planeSurface: planeSurface, planeLesson: planeSurface, surfaceLesson: planeSurface,
    regularSolid: regularSolid, solidLesson: regularSolid, solid: regularSolid, solid35mm: regularSolid,
    generateLesson: generateLesson, generate: generateLesson, buildLesson: generateLesson,
    generateCurriculum: generateCurriculum, buildCurriculum: generateCurriculum,
    curriculum: generateCurriculum, fullCurriculum: generateCurriculum,
    validateBundle: validateBundle, validate: validateBundle
  };
});

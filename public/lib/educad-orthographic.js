(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(
      require('./educad-measure.js'),
      require('./educad-geometry.js'),
      require('./educad-settings.js'),
      require('./educad-ortho-match.js')
    );
  } else {
    root.EduCADOrthographic = factory(
      root.EduCADMeasure,
      root.EduCADGeometry,
      root.EduCADSettings,
      root.EduCADOrthoMatch
    );
  }
})(typeof window !== 'undefined' ? window : globalThis, function (Measure, Geometry, Settings, Match) {
  'use strict';
  var THEME_ROOT = typeof window !== 'undefined' ? window :
    (typeof globalThis !== 'undefined' ? globalThis : null);

  function themeColor(name, fallback) {
    var theme = THEME_ROOT && THEME_ROOT.EduCADTheme;
    return (theme && typeof theme.color === 'function') ? theme.color(name) : fallback;
  }
  var ACQUIRE_PX = 12;
  var SWITCH_HYST_PX = 4;
  var PULL_TRIGGER_PX = 16;
  var OUTWARD_GRACE_PX = 96;
  var DWELL_FAST_MS = 135;
  var DWELL_SLOW_MS = 85;
  var LINGER_MS = 420;
  var SPANS = Match.SPANS;
  var TYPES = Match.TYPES;
  var VIEW_NAMES = Match.VIEW_NAMES;
  var SHORT_VIEW = Match.SHORT_VIEW;
  var SHORT_VIEW_CAP = Match.SHORT_VIEW_CAP;
  var EPS = Match.EPS;
  var MATCH_EPS = Match.MATCH_EPS;
  var number = Match.number;
  var role = Match.role;
  var category = Match.category;
  var construction = Match.construction;
  var toView3D = Match.toView3D;
  var near2 = Match.near2;
  var sameProjectedSpan = Match.sameProjectedSpan;
  var vertexLabel3D = Match.vertexLabel3D;
  var physicalEdgeLabel = Match.physicalEdgeLabel;
  var findSeparatingView = Match.findSeparatingView;
  var reconstructedEdgeInfo = Match.reconstructedEdgeInfo;
  var edgeCalloutLines = Match.edgeCalloutLines;
  var poseEdgeProjectionLabel = Match.poseEdgeProjectionLabel;
  var formatAngleDeg = Match.formatAngleDeg;
  var findSeparatingViewForCorners = Match.findSeparatingViewForCorners;
  var reconstructedCornerInfo = Match.reconstructedCornerInfo;
  var cornerAngleCallout = Match.cornerAngleCallout;
  var hitTestPoseEdgeTargets = Match.hitTestPoseEdgeTargets;
  var matchedVerticesForPoint = Match.matchedVerticesForPoint;
  var findSeparatingViewForVertices = Match.findSeparatingViewForVertices;
  var reconstructedPointPairInfo = Match.reconstructedPointPairInfo;
  var pointSpanCalloutLines = Match.pointSpanCalloutLines;
  var reconstructedPoint3D = Match.reconstructedPoint3D;
  var parallelSpacing = Match.parallelSpacing;
  var edgeRelation = Match.edgeRelation;
  var circleEdgeOffset = Match.circleEdgeOffset;
  var title = Match.title;
  var specs = Match.specs;
  var inventory = Match.inventory;
  var togglePin = Match.togglePin;
  var overlayItems = Match.overlayItems;
  var compactRows = Match.compactRows;
  var comparison = Match.comparison;
  var viewBounds = Match.viewBounds;
  var entityDistancePx = Match.entityDistancePx;
  var spanProjectionPx = Match.spanProjectionPx;

  function drawSheetGuide(ctx, view, prefs, from, to, text, color, occupied) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(to.x, to.y, 2.2, 0, 2 * Math.PI); ctx.stroke();
    var label = null;
    if (prefs.labels) {
      ctx.font = prefs.textSize + 'px system-ui, sans-serif';
      label = Measure.guideLabel(from, to, text, function (t) { return ctx.measureText(t).width; },
        prefs.textSize, view, occupied);
      if (label) {
        var r = label.rect;
        ctx.beginPath(); ctx.moveTo(label.anchor.x, label.anchor.y);
        ctx.lineTo(Math.max(r.x0, Math.min(r.x1, label.anchor.x)), Math.max(r.y0, Math.min(r.y1, label.anchor.y))); ctx.stroke();
        ctx.fillStyle = themeColor('viewLabelBg', 'rgba(248,250,252,0.96)');
        ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
        ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      }
    }
    ctx.restore();
    return label && label.rect;
  }

  function offsetText(plane, value, prefs) {
    if (Math.abs(value) < EPS) return 'On ' + plane;
    var direction = value < 0 ? (plane === 'HP' ? ' below ' : ' behind ') : ' · ';
    return number(Math.abs(value), prefs) + ' mm' + direction + plane;
  }

  function drawPointOffsets(ctx, view, prefs, pt, vr, map, occupied, lane) {
    if (!prefs.offsets || !prefs.dimensions || vr === 'SHARED') return null;
    var anchor = { x: pt.x * view.s + view.tx, y: view.ty - pt.y * view.s };
    function offset(plane, value, foot) {
      var text = offsetText(plane, value, prefs);
      var color = plane === 'HP' ? themeColor('spatialHpLabel', '#817a6c') : themeColor('spatialVpLabel', '#718399');
      return drawSheetGuide(ctx, view, prefs, anchor, foot, text, color, occupied);
    }
    if (vr === 'PROFILE' && map && map.three) {
      var zeroDepthX = map.xRef - map.s * map.dRef;
      offset('VP', map.s * (pt.x - zeroDepthX), { x: view.tx + zeroDepthX * view.s, y: anchor.y });
    }
    if (lane) {
      ctx.save(); ctx.strokeStyle = themeColor('viewGuide', '#8a9dad'); ctx.lineWidth = 0.75;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(anchor.x + lane, anchor.y);
      ctx.moveTo(anchor.x, view.ty); ctx.lineTo(anchor.x + lane, view.ty);
      ctx.stroke(); ctx.restore();
      anchor.x += lane;
    }
    return offset(vr === 'PLAN' ? 'VP' : 'HP', vr === 'PLAN' ? -pt.y : pt.y, { x: anchor.x, y: view.ty });
  }

  function drawProjectedOffsets(ctx, view, prefs, point, map, occupied) {
    if (!prefs.offsets || !prefs.dimensions) return;
    var hpLane = 0, vpLane = 0;
    if (point.y * point.z <= 0) {
      ctx.save(); ctx.font = prefs.textSize + 'px system-ui, sans-serif';
      var hpHalf = ctx.measureText(offsetText('HP', point.y, prefs)).width / 2 + 5;
      var vpHalf = ctx.measureText(offsetText('VP', point.z, prefs)).width / 2 + 5;
      ctx.restore();
      var x = point.x * view.s + view.tx;
      var gap = hpHalf + vpHalf + 6;
      var left = Math.max(hpHalf + 3, Math.min(x - gap / 2, view.w - vpHalf - gap - 3));
      hpLane = left - x;
      vpLane = left + gap - x;
    }
    drawPointOffsets(ctx, view, prefs, toView3D(point, 'ELEVATION', map), 'ELEVATION', map, occupied, hpLane);
    drawPointOffsets(ctx, view, prefs, toView3D(point, 'PLAN', map), 'PLAN', map, occupied, vpLane);
  }

  function drawComponents(ctx, view, prefs, a, b) {
    if (!prefs.components || !prefs.dimensions) return;
    var from = { x: a.x * view.s + view.tx, y: view.ty - a.y * view.s };
    var to = { x: b.x * view.s + view.tx, y: view.ty - b.y * view.s };
    var bend = { x: to.x, y: from.y }, occupied = [];
    var color = themeColor('viewInspect', '#415c74');
    if (Math.abs(a.x - b.x) > EPS) drawSheetGuide(ctx, view, prefs, from, bend, 'Δx ' + number(b.x - a.x, prefs) + ' mm', color, occupied);
    if (Math.abs(a.y - b.y) > EPS) drawSheetGuide(ctx, view, prefs, bend, to, 'Δy ' + number(b.y - a.y, prefs) + ' mm', color, occupied);
  }

  function mount(handle, spatial, container, options) {
    options = options || {};
    var prefs = Settings.normalizeSheetInspection(), pins = [], query = '', tab = spatial ? 'solid' : 'sheet';
    var revision = -1, lastSelected, records = [], entities = [], map = null, expandedSpecs = false;
    var hover = {
      id: null, stage: 'idle', side: 0, offsetMm: 0, enteredAt: 0,
      lastPos: null, speed: 0, candidateId: null, dwellTimer: null, lingerTimer: null, fadeRaf: null
    };
    var hoverHit = null;
    var resolvedPoseEdge = null;
    var overlapNarrowing = null;
    var resolvedPoseCorner = null;
    var cornerOverlapNarrowing = null;
    var resolvedPoseSpan = null;
    var spanOverlapState = null;
    var panelVisible = false;
    var panel = spatial ? spatial.panel : document.createElement('aside');
    if (!spatial) { panel.className = 'spatial-panel'; panel.innerHTML = '<div class="spatial-head"><span class="spatial-title-sr">Orthographic view</span><div class="spatial-head-actions"></div></div>'; container.appendChild(panel); }
    panel.setAttribute('aria-label', 'Drawing inspection');
    var head = panel.querySelector('.spatial-head'), heading = head.querySelector('span'), solidActions = head.querySelector('div');
    var solidBody = document.createElement('div'); solidBody.className = 'inspection-solid-body';
    Array.from(panel.children).forEach(function (node) { if (node !== head) solidBody.appendChild(node); });
    var switcher = document.createElement('div'); switcher.className = 'inspection-switch'; switcher.setAttribute('role', 'group'); switcher.setAttribute('aria-label', 'Inspection workspace');
    switcher.innerHTML = '<button type="button" data-inspect-tab="sheet">2D</button><button type="button" data-inspect-tab="solid">3D</button>';
    head.insertBefore(switcher, solidActions);
    var headRight = document.createElement('div'); headRight.className = 'spatial-head-right';
    headRight.appendChild(solidActions);
    var fit = document.createElement('button'); fit.type = 'button'; fit.textContent = 'Fit'; fit.title = 'Fit sheet'; fit.dataset.sheetAction = 'fit'; headRight.appendChild(fit);
    var collapseBtn = document.createElement('button'); collapseBtn.type = 'button'; collapseBtn.className = 'spatial-collapse-btn';
    collapseBtn.dataset.sheetAction = 'collapse'; collapseBtn.setAttribute('aria-expanded', 'true');
    collapseBtn.setAttribute('aria-label', 'Collapse inspection panel'); collapseBtn.title = 'Collapse panel'; collapseBtn.textContent = '–';
    headRight.appendChild(collapseBtn);
    head.appendChild(headRight);
    var collapsed = false;
    var bodyWrap = document.createElement('div'); bodyWrap.className = 'spatial-body';
    bodyWrap.appendChild(solidBody);
    var sheet = document.createElement('div'); sheet.className = 'inspection-sheet-body';
    sheet.innerHTML = '<p class="sheet-summary spatial-summary"></p>' +
      '<div class="sheet-tools"><div class="spatial-seg" role="group" aria-label="Sheet measurement overlays"><button type="button" data-sheet-overlay="selected">Selected</button><button type="button" data-sheet-overlay="pinned">Pinned</button><button type="button" data-sheet-overlay="all">All</button></div><select class="sheet-view-filter" aria-label="Orthographic view filter"><option value="all">All views</option><option value="elevation">Front</option><option value="plan">Top</option><option value="profile">Side</option></select><details class="sheet-filter"><summary title="Measurement fields">Filter</summary><div class="sheet-filter-fields"></div></details></div>' +
      '<div class="sheet-selection spatial-selection" hidden aria-live="polite"></div><div class="sheet-pins spatial-pins" hidden></div><div class="sheet-comparison" hidden></div>' +
      '<p class="sheet-label-note spatial-note" hidden></p>' +
      '<details class="sheet-details"><summary>Index</summary><input class="sheet-search spatial-search" type="search" aria-label="Find sheet geometry" placeholder="Filter label, edge, circle…"><div class="sheet-inventory-tools"><button type="button" data-sheet-action="expand-specs" aria-pressed="false">Expand all</button></div><div class="sheet-inventory"></div></details>';
    bodyWrap.appendChild(sheet);
    panel.appendChild(bodyWrap);
    var fields = sheet.querySelector('.sheet-filter-fields'), selectedEl = sheet.querySelector('.sheet-selection');
    var pinsEl = sheet.querySelector('.sheet-pins'), compareEl = sheet.querySelector('.sheet-comparison');
    var dataEl = sheet.querySelector('.sheet-inventory'), details = sheet.querySelector('.sheet-details');
    var labelNote = sheet.querySelector('.sheet-label-note');
    ['points', 'lines', 'curves', 'construction', 'coordinates', 'offsets', 'lengths', 'angles', 'radii', 'curveProperties', 'components', 'comparisonDimensions'].forEach(function (key) {
      var row = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.dataset.sheetPreference = key;
      row.appendChild(input); row.appendChild(document.createTextNode(Settings.SHEET_INSPECTION_FIELDS[key].label)); fields.appendChild(row);
    });
    function clearHoverTimers() {
      if (hover.dwellTimer) { clearTimeout(hover.dwellTimer); hover.dwellTimer = null; }
      if (hover.lingerTimer) { clearTimeout(hover.lingerTimer); hover.lingerTimer = null; }
      if (hover.fadeRaf) { cancelAnimationFrame(hover.fadeRaf); hover.fadeRaf = null; }
    }
    function scheduleFadeRedraw() {
      if (hover.fadeRaf) return;
      var tick = function () {
        hover.fadeRaf = null;
        if (!hover.id || handle.measure.mode !== 'view') return;
        options.redraw();
        if (Date.now() - hover.enteredAt < 140) hover.fadeRaf = requestAnimationFrame(tick);
      };
      hover.fadeRaf = requestAnimationFrame(tick);
    }
    function clearHover(redrawNow) {
      clearHoverTimers();
      var had = hover.id !== null;
      hover.id = null; hover.stage = 'idle'; hover.side = 0; hover.offsetMm = 0;
      hover.candidateId = null; hover.enteredAt = 0;
      hoverHit = null;
      if (had && redrawNow) options.redraw();
    }
    function hitTestHover(cursorPx) {
      if (!hoverHit || !cursorPx) return null;
      var r = hoverHit.pillRect;
      if (r && cursorPx.x >= r.x0 - 6 && cursorPx.x <= r.x1 + 6 &&
          cursorPx.y >= r.y0 - 6 && cursorPx.y <= r.y1 + 6) {
        return { id: hoverHit.id, side: hoverHit.side, offsetMm: hoverHit.offsetMm };
      }
      if (hoverHit.dimSeg && Geometry.spanDistance(cursorPx, hoverHit.dimSeg[0], hoverHit.dimSeg[1], 'SEGMENT') <= 10) {
        return { id: hoverHit.id, side: hoverHit.side, offsetMm: hoverHit.offsetMm };
      }
      if (hoverHit.radialSegs) {
        for (var i = 0; i < hoverHit.radialSegs.length; i++) {
          var s = hoverHit.radialSegs[i];
          if (Geometry.spanDistance(cursorPx, s[0], s[1], 'SEGMENT') <= 10) {
            return { id: hoverHit.id, side: hoverHit.side, offsetMm: hoverHit.offsetMm };
          }
        }
      }
      return null;
    }
    function pendingOverlapPin() {
      if (pins.length !== 1) return null;
      var pin = pins[0];
      if (resolvedPoseEdge && resolvedPoseEdge.entityId === pin.id) return null;
      var ent = entities.find(function (e) { return e.id === pin.id; });
      if (!ent || SPANS.indexOf(ent.type) === -1) return null;
      var info = reconstructedEdgeInfo(ent, handle.solidMm, map);
      if (!info || info.overlapCount < 2) return null;
      var activeDetails = info.edgeDetails;
      var excluded = [info.role];
      var narrowed = false;
      if (overlapNarrowing && overlapNarrowing.entityId === pin.id && overlapNarrowing.candidates.length >= 2) {
        activeDetails = overlapNarrowing.candidates;
        excluded = [info.role].concat(overlapNarrowing.narrowedViews || []);
        narrowed = true;
      }
      var sep = findSeparatingView(activeDetails, handle.solidMm, excluded, map);
      return { pin: pin, entity: ent, info: info, candidates: activeDetails, excludedViews: excluded, narrowed: narrowed, sep: sep };
    }
    function pickOverlapGroup(cursorPx, clickedEnt, pending) {
      if (!pending || !handle.solidMm || !handle.solidMm.vertices || !handle.solidMm.edges) return null;
      var g = handle.solidMm, candidates = pending.candidates, view = handle.view;
      var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
      var otherViews = views.filter(function (vr) { return pending.excludedViews.indexOf(vr) === -1; });
      if (pending.sep && pending.sep.view && otherViews.indexOf(pending.sep.view) > 0) {
        otherViews = [pending.sep.view].concat(otherViews.filter(function (vr) { return vr !== pending.sep.view; }));
      }
      if (clickedEnt && otherViews.indexOf(role(clickedEnt)) !== -1) {
        var cr = role(clickedEnt);
        var byEntity = [];
        candidates.forEach(function (d) {
          var edge = g.edges[d.index];
          var pa = toView3D(g.vertices[edge[0]], cr, map), pb = toView3D(g.vertices[edge[1]], cr, map);
          if (clickedEnt.type === 'POINT') {
            if (near2(pa, clickedEnt, MATCH_EPS) && near2(pb, clickedEnt, MATCH_EPS)) byEntity.push(d);
          } else if (SPANS.indexOf(clickedEnt.type) !== -1) {
            if (sameProjectedSpan(pa, pb, { x: clickedEnt.x, y: clickedEnt.y }, { x: clickedEnt.x2, y: clickedEnt.y2 }, MATCH_EPS)) byEntity.push(d);
          }
        });
        if (byEntity.length >= 1 && byEntity.length < candidates.length) {
          return { view: cr, group: byEntity };
        }
      }
      if (!cursorPx || !view) return null;
      var tol = (typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive()) ? 24 : 16;
      var bestPick = null, bestDist = tol;
      otherViews.forEach(function (vr) {
        var hits = [];
        candidates.forEach(function (d) {
          var edge = g.edges[d.index];
          var pa = toView3D(g.vertices[edge[0]], vr, map), pb = toView3D(g.vertices[edge[1]], vr, map);
          var ax = pa.x * view.s + view.tx, ay = view.ty - pa.y * view.s;
          var bx = pb.x * view.s + view.tx, by = view.ty - pb.y * view.s;
          var dist = Math.hypot(bx - ax, by - ay) < 1.5
            ? Math.hypot(cursorPx.x - ax, cursorPx.y - ay)
            : Geometry.spanDistance(cursorPx, { x: ax, y: ay }, { x: bx, y: by }, 'SEGMENT');
          if (dist <= tol) hits.push({ detail: d, dist: dist, pa: pa, pb: pb });
        });
        hits.sort(function (a, b) { return a.dist - b.dist; });
        if (!hits.length || hits[0].dist >= bestDist) return;
        var lead = hits[0];
        var coincident = hits.filter(function (h) {
          return sameProjectedSpan(h.pa, h.pb, lead.pa, lead.pb, MATCH_EPS);
        }).map(function (h) { return h.detail; });
        var distinctClose = hits.some(function (h) {
          return !sameProjectedSpan(h.pa, h.pb, lead.pa, lead.pb, MATCH_EPS) && Math.abs(h.dist - lead.dist) <= 2.5;
        });
        if (!distinctClose && coincident.length >= 1 && coincident.length < candidates.length) {
          bestDist = lead.dist;
          bestPick = { view: vr, group: coincident };
        }
      });
      return bestPick;
    }
    function trackedPosePoint() {
      sync();
      if (pins.length !== 1) return null;
      var e = entities.find(function (entity) { return entity.id === pins[0].id; });
      if (!e || e.type !== 'POINT') return null;
      var indices = matchedVerticesForPoint(e, handle.solidMm, role(e), map);
      return indices.length === 1 ? indices[0] : null;
    }
    function trackedPoseEdge() {
      sync();
      if (pins.length !== 1) return null;
      var pin = pins[0];
      if (resolvedPoseEdge && resolvedPoseEdge.entityId === pin.id) return Object.assign({}, resolvedPoseEdge);
      var ent = entities.find(function (e) { return e.id === pin.id; });
      if (!ent || SPANS.indexOf(ent.type) === -1) return null;
      var info = reconstructedEdgeInfo(ent, handle.solidMm, map);
      if (!info || !info.established || info.uniqueEdge === null) return null;
      return {
        entityId: ent.id,
        edgeIndex: info.uniqueEdge,
        reversed: !!info.uniqueReversed,
        label: physicalEdgeLabel(info.uniqueEdge, handle.solidMm, entities, map, !!info.uniqueReversed),
        viewRole: info.role,
        viewLabel: info.viewLabel,
        side: pin.side === -1 ? -1 : 1,
        offsetMm: pin.offsetMm || null,
        trueLength: info.trueLength,
        restTrueLength: info.trueLength
      };
    }
    function pinPairKey() {
      return pins.length === 2 ? (pins[0].id + '\0' + pins[1].id) : '';
    }
    function pendingOverlapCorner() {
      if (pins.length !== 2) return null;
      var pairKey = pinPairKey();
      if (resolvedPoseCorner && resolvedPoseCorner.pairKey === pairKey) return null;
      var a = entities.find(function (e) { return e.id === pins[0].id; });
      var b = entities.find(function (e) { return e.id === pins[1].id; });
      if (!a || !b) return null;
      var pref = {};
      if (pins[0].resolvedEdgeIndex !== undefined && pins[0].resolvedEdgeIndex !== null) pref.a = pins[0].resolvedEdgeIndex;
      if (pins[1].resolvedEdgeIndex !== undefined && pins[1].resolvedEdgeIndex !== null) pref.b = pins[1].resolvedEdgeIndex;
      var info = reconstructedCornerInfo(a, b, handle.solidMm, entities, map, pref);
      if (!info || info.overlapCount < 2) return null;
      var activeCandidates = info.candidates;
      var excluded = [info.viewRole];
      var narrowed = false;
      if (cornerOverlapNarrowing && cornerOverlapNarrowing.pairKey === pairKey && cornerOverlapNarrowing.candidates.length >= 2) {
        activeCandidates = cornerOverlapNarrowing.candidates;
        excluded = [info.viewRole].concat(cornerOverlapNarrowing.narrowedViews || []);
        narrowed = true;
      }
      var sep = findSeparatingViewForCorners(activeCandidates, handle.solidMm, excluded, map);
      return { pairKey: pairKey, a: a, b: b, info: info, candidates: activeCandidates, excludedViews: excluded, narrowed: narrowed, sep: sep };
    }
    function pickCornerOverlapGroup(cursorPx, clickedEnt, pending) {
      if (!pending || !handle.solidMm || !handle.solidMm.vertices) return null;
      var g = handle.solidMm, candidates = pending.candidates, view = handle.view;
      var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
      var otherViews = views.filter(function (vr) { return pending.excludedViews.indexOf(vr) === -1; });
      if (pending.sep && pending.sep.view && otherViews.indexOf(pending.sep.view) > 0) {
        otherViews = [pending.sep.view].concat(otherViews.filter(function (vr) { return vr !== pending.sep.view; }));
      }
      if (clickedEnt && clickedEnt.type === 'POINT' && otherViews.indexOf(role(clickedEnt)) !== -1) {
        var cr = role(clickedEnt);
        var byPoint = candidates.filter(function (c) {
          var pS = toView3D(g.vertices[c.vertexIndex], cr, map);
          return near2(pS, clickedEnt, MATCH_EPS);
        });
        if (byPoint.length >= 1 && byPoint.length < candidates.length) {
          return { view: cr, group: byPoint };
        }
      }
      if (!cursorPx || !view) return null;
      var tol = (typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive()) ? 24 : 18;
      var bestPick = null, bestDist = tol;
      otherViews.forEach(function (vr) {
        var hits = [];
        candidates.forEach(function (c) {
          var pS = toView3D(g.vertices[c.vertexIndex], vr, map);
          var sx = pS.x * view.s + view.tx, sy = view.ty - pS.y * view.s;
          var dist = Math.hypot(cursorPx.x - sx, cursorPx.y - sy);
          if (dist <= tol) hits.push({ cand: c, dist: dist, pS: pS });
        });
        hits.sort(function (h1, h2) { return h1.dist - h2.dist; });
        if (!hits.length || hits[0].dist >= bestDist) return;
        var lead = hits[0];
        var coincident = hits.filter(function (h) {
          return near2(h.pS, lead.pS, MATCH_EPS);
        }).map(function (h) { return h.cand; });
        var distinctClose = hits.some(function (h) {
          return !near2(h.pS, lead.pS, MATCH_EPS) && Math.abs(h.dist - lead.dist) <= 2.5;
        });
        if (!distinctClose && coincident.length >= 1 && coincident.length < candidates.length) {
          bestDist = lead.dist;
          bestPick = { view: vr, group: coincident };
        }
      });
      return bestPick;
    }
    function pendingOverlapSpan() {
      if (pins.length !== 2) return null;
      var pairKey = pinPairKey();
      if (resolvedPoseSpan && resolvedPoseSpan.pairKey === pairKey) return null;
      var a = entities.find(function (e) { return e.id === pins[0].id; });
      var b = entities.find(function (e) { return e.id === pins[1].id; });
      if (!a || !b || a.type !== 'POINT' || b.type !== 'POINT') return null;
      var info = reconstructedPointPairInfo(a, b, handle.solidMm, entities, map);
      if (!info || info.unique) return null;
      var candsA = info.candidatesA.slice(), candsB = info.candidatesB.slice();
      var exclA = [info.viewRole], exclB = [info.viewRole];
      if (spanOverlapState && spanOverlapState.pairKey === pairKey) {
        candsA = spanOverlapState.candidatesA.slice();
        candsB = spanOverlapState.candidatesB.slice();
        exclA = [info.viewRole].concat(spanOverlapState.narrowedViewsA || []);
        exclB = [info.viewRole].concat(spanOverlapState.narrowedViewsB || []);
      }
      if (candsA.length < 2 && candsB.length < 2) return null;
      var sepA = candsA.length >= 2 ? findSeparatingViewForVertices(candsA, handle.solidMm, exclA, map) : null;
      var sepB = candsB.length >= 2 ? findSeparatingViewForVertices(candsB, handle.solidMm, exclB, map) : null;
      var activeSlot = 'both';
      if (candsA.length >= 2 && candsB.length >= 2 && sepA && sepA.view && handle.solidMm && handle.solidMm.vertices) {
        var vrCheck = sepA.view;
        var overlapsInSep = candsA.some(function (ia) {
          var pA = toView3D(handle.solidMm.vertices[ia], vrCheck, map);
          return candsB.some(function (ib) {
            return near2(pA, toView3D(handle.solidMm.vertices[ib], vrCheck, map), MATCH_EPS);
          });
        });
        if (overlapsInSep) activeSlot = 'A';
      } else if (candsA.length >= 2) {
        activeSlot = 'A';
      } else {
        activeSlot = 'B';
      }
      return {
        pairKey: pairKey, a: a, b: b, info: info,
        candsA: candsA, candsB: candsB, exclA: exclA, exclB: exclB,
        sepA: sepA, sepB: sepB, activeSlot: activeSlot
      };
    }
    function pickSpanOverlapGroup(cursorPx, clickedEnt, pending) {
      if (!pending || !handle.solidMm || !handle.solidMm.vertices) return null;
      var g = handle.solidMm, view = handle.view;
      var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
      var slots = [];
      if (pending.candsA.length >= 2) slots.push({ slot: 'A', cands: pending.candsA, excl: pending.exclA, sep: pending.sepA });
      if (pending.candsB.length >= 2 && pending.activeSlot !== 'A') slots.push({ slot: 'B', cands: pending.candsB, excl: pending.exclB, sep: pending.sepB });
      if (!slots.length) return null;

      if (clickedEnt && clickedEnt.type === 'POINT') {
        var cr = role(clickedEnt);
        var ptMatches = [];
        slots.forEach(function (s) {
          if (s.excl.indexOf(cr) !== -1) return;
          var grp = s.cands.filter(function (idx) {
            return near2(toView3D(g.vertices[idx], cr, map), clickedEnt, MATCH_EPS);
          });
          if (grp.length >= 1 && grp.length < s.cands.length) {
            ptMatches.push({ slot: s.slot, view: cr, group: grp });
          }
        });
        if (ptMatches.length === 1) return ptMatches[0];
      }
      if (!cursorPx || !view) return null;
      var tol = (typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive()) ? 24 : 18;
      var allHits = [];
      slots.forEach(function (s) {
        var otherViews = views.filter(function (vr) { return s.excl.indexOf(vr) === -1; });
        if (s.sep && s.sep.view && otherViews.indexOf(s.sep.view) > 0) {
          otherViews = [s.sep.view].concat(otherViews.filter(function (vr) { return vr !== s.sep.view; }));
        }
        otherViews.forEach(function (vr) {
          s.cands.forEach(function (idx) {
            var pS = toView3D(g.vertices[idx], vr, map);
            var sx = pS.x * view.s + view.tx, sy = view.ty - pS.y * view.s;
            var dist = Math.hypot(cursorPx.x - sx, cursorPx.y - sy);
            if (dist <= tol) allHits.push({ slot: s.slot, view: vr, idx: idx, dist: dist, pS: pS, cands: s.cands });
          });
        });
      });
      if (!allHits.length) return null;
      allHits.sort(function (h1, h2) { return h1.dist - h2.dist; });
      var lead = allHits[0];
      var coincident = allHits.filter(function (h) {
        return h.slot === lead.slot && h.view === lead.view && near2(h.pS, lead.pS, MATCH_EPS);
      }).map(function (h) { return h.idx; });
      var distinctClose = allHits.some(function (h) {
        var sameCluster = h.slot === lead.slot && h.view === lead.view && near2(h.pS, lead.pS, MATCH_EPS);
        return !sameCluster && Math.abs(h.dist - lead.dist) <= 2.5;
      });
      if (!distinctClose && coincident.length >= 1 && coincident.length < lead.cands.length) {
        return { slot: lead.slot, view: lead.view, group: coincident };
      }
      return null;
    }
    function hitTestOverlapChoice(cursorPx) {
      if (!cursorPx || handle.measure.mode !== 'view') return false;
      var pc = pendingOverlapCorner();
      if (pc && pickCornerOverlapGroup(cursorPx, null, pc)) return true;
      var ps = pendingOverlapSpan();
      if (ps && pickSpanOverlapGroup(cursorPx, null, ps)) return true;
      var pe = pendingOverlapPin();
      if (pe && pickOverlapGroup(cursorPx, null, pe)) return true;
      return false;
    }
    function hasPendingOverlap() {
      return !!(pendingOverlapCorner() || pendingOverlapSpan() || pendingOverlapPin());
    }
    function trackedPoseSpan() {
      sync();
      if (pins.length !== 2) return null;
      var pairKey = pinPairKey();
      if (resolvedPoseSpan && resolvedPoseSpan.pairKey === pairKey) {
        return Object.assign({}, resolvedPoseSpan);
      }
      var a = entities.find(function (e) { return e.id === pins[0].id; });
      var b = entities.find(function (e) { return e.id === pins[1].id; });
      if (!a || !b || a.type !== 'POINT' || b.type !== 'POINT') return null;
      var info = reconstructedPointPairInfo(a, b, handle.solidMm, entities, map);
      if (!info || !info.unique) return null;
      return {
        viewRole: info.viewRole,
        viewLabel: info.viewLabel,
        vertexA: info.vertexA,
        vertexB: info.vertexB,
        labelA: info.labelA,
        labelB: info.labelB,
        dist3D: info.dist3D,
        restDist3D: info.restDist3D,
        side: null,
        offsetMm: null
      };
    }
    function trackedPoseCorner() {
      sync();
      if (pins.length !== 2) return null;
      var pairKey = pinPairKey();
      if (resolvedPoseCorner && resolvedPoseCorner.pairKey === pairKey) {
        return Object.assign({}, resolvedPoseCorner);
      }
      var a = entities.find(function (e) { return e.id === pins[0].id; });
      var b = entities.find(function (e) { return e.id === pins[1].id; });
      if (!a || !b) return null;
      var pref = {};
      if (pins[0].resolvedEdgeIndex !== undefined && pins[0].resolvedEdgeIndex !== null) pref.a = pins[0].resolvedEdgeIndex;
      if (pins[1].resolvedEdgeIndex !== undefined && pins[1].resolvedEdgeIndex !== null) pref.b = pins[1].resolvedEdgeIndex;
      var info = reconstructedCornerInfo(a, b, handle.solidMm, entities, map, pref);
      return (info && info.unique) ? info : null;
    }
    function enterGlance(id) {
      clearHoverTimers();
      hover.id = id;
      hover.stage = 'glance';
      hover.side = 0;
      hover.offsetMm = 0;
      hover.candidateId = null;
      hover.enteredAt = Date.now();
      hover.lingerTimer = setTimeout(function () {
        hover.lingerTimer = null;
        if (hover.id === id && hover.stage === 'glance') {
          hover.stage = 'linger';
          options.redraw();
        }
      }, LINGER_MS);
      scheduleFadeRedraw();
    }
    function inspectableEntities() {
      return entities.filter(function (e) {
        if (!Measure.inspectEntity(e) || !prefs[category(e)] || (!prefs.construction && construction(e))) return false;
        if (prefs.view !== 'all' && role(e).toLowerCase() !== prefs.view) return false;
        return true;
      });
    }
    function hitOtherEntity(cursorPx, excludeId, tolPx) {
      var list = inspectableEntities().filter(function (e) { return e.id !== excludeId; });
      return Measure.hitTestAll(list, cursorPx, handle.view, tolPx);
    }
    function pointerMove(cursorPx) {
      if (handle.measure.mode !== 'view' || !cursorPx) { clearHover(true); return; }
      sync();
      var now = Date.now();
      if (hover.lastPos) {
        var dt = Math.max(1, now - hover.lastPos.t);
        var instSpeed = Math.hypot(cursorPx.x - hover.lastPos.x, cursorPx.y - hover.lastPos.y) / dt;
        hover.speed = hover.speed * 0.55 + instSpeed * 0.45;
      }
      hover.lastPos = { x: cursorPx.x, y: cursorPx.y, t: now };
      var activeList = inspectableEntities();

      if (hover.id === null) {
        var cand = Measure.hitTestAll(activeList, cursorPx, handle.view, ACQUIRE_PX);
        if (!cand) {
          if (hover.dwellTimer) { clearTimeout(hover.dwellTimer); hover.dwellTimer = null; }
          hover.candidateId = null;
          return;
        }
        if (cand !== hover.candidateId || !hover.dwellTimer) {
          if (hover.dwellTimer) clearTimeout(hover.dwellTimer);
          hover.candidateId = cand;
          var wait = hover.speed > 0.65 ? DWELL_FAST_MS : DWELL_SLOW_MS;
          hover.dwellTimer = setTimeout(function () {
            hover.dwellTimer = null;
            if (handle.measure.mode !== 'view' || hover.candidateId !== cand) return;
            enterGlance(cand);
          }, wait);
        }
        return;
      }

      var cur = entities.find(function (e) { return e.id === hover.id; });
      if (!cur) { clearHover(true); return; }
      var onPulledAnnotation = !!hitTestHover(cursorPx);
      var curDist = entityDistancePx(cur, cursorPx, handle.view);
      var otherId = onPulledAnnotation ? null : hitOtherEntity(cursorPx, hover.id, ACQUIRE_PX - 2);
      if (otherId) {
        var otherEnt = entities.find(function (e) { return e.id === otherId; });
        var otherDist = entityDistancePx(otherEnt, cursorPx, handle.view);
        if (otherDist + SWITCH_HYST_PX < curDist) {
          enterGlance(otherId);
          return;
        }
      }

      if (SPANS.indexOf(cur.type) !== -1 && cur.type !== 'DATUM_AXIS') {
        var proj = spanProjectionPx(cur, cursorPx, handle.view);
        if (!proj) { clearHover(true); return; }
        var alongSpan = proj.t >= -0.22 && proj.t <= 1.22;
        if (hover.stage !== 'pulled' && alongSpan && proj.absPerp >= PULL_TRIGGER_PX && proj.absPerp <= OUTWARD_GRACE_PX) {
          if (hover.lingerTimer) { clearTimeout(hover.lingerTimer); hover.lingerTimer = null; }
          hover.stage = 'pulled';
          hover.side = proj.signedPerp >= 0 ? 1 : -1;
          hover.offsetMm = Math.max(10, 26 / handle.view.s);
          options.redraw();
          return;
        }
        if (onPulledAnnotation || (alongSpan && proj.absPerp <= OUTWARD_GRACE_PX)) return;
        if (curDist <= 28) return;
        clearHover(true);
        return;
      }

      if (cur.type === 'CIRCLE' || cur.type === 'CIRCULAR_ARC') {
        var cx = cur.x * handle.view.s + handle.view.tx, cy = handle.view.ty - cur.y * handle.view.s;
        var radDist = Math.hypot(cursorPx.x - cx, cursorPx.y - cy) - cur.radius * handle.view.s;
        if (hover.stage !== 'pulled' && radDist >= PULL_TRIGGER_PX && radDist <= OUTWARD_GRACE_PX) {
          if (hover.lingerTimer) { clearTimeout(hover.lingerTimer); hover.lingerTimer = null; }
          hover.stage = 'pulled';
          hover.side = Math.atan2(cursorPx.y - cy, cursorPx.x - cx);
          options.redraw();
          return;
        }
        if (onPulledAnnotation || curDist <= OUTWARD_GRACE_PX) return;
        clearHover(true);
        return;
      }

      if (cur.type === 'POINT') {
        if (hover.stage !== 'pulled' && curDist >= PULL_TRIGGER_PX && curDist <= OUTWARD_GRACE_PX) {
          if (hover.lingerTimer) { clearTimeout(hover.lingerTimer); hover.lingerTimer = null; }
          hover.stage = 'pulled';
          options.redraw();
          return;
        }
        if (onPulledAnnotation || curDist <= OUTWARD_GRACE_PX) return;
        clearHover(true);
      }
    }
    function pointerLeave() {
      hover.lastPos = null;
      hover.speed = 0;
      clearHover(true);
    }
    function clickSheet(id, side, cursorPx) {
      sync();
      var pending = pendingOverlapPin();
      if (pending) {
        var clickedEnt = id ? entities.find(function (e) { return e.id === id; }) : null;
        if (!clickedEnt || pending.excludedViews.indexOf(role(clickedEnt)) === -1) {
          var picked = pickOverlapGroup(cursorPx, clickedEnt, pending);
          if (picked) {
            if (picked.group.length === 1) {
              var only = picked.group[0];
              overlapNarrowing = null;
              resolvedPoseEdge = {
                entityId: pending.pin.id,
                edgeIndex: only.index,
                reversed: !!only.reversed,
                label: physicalEdgeLabel(only.index, handle.solidMm, entities, map, !!only.reversed),
                viewRole: pending.info.role,
                viewLabel: pending.info.viewLabel,
                side: pending.pin.side === -1 ? -1 : 1,
                offsetMm: pending.pin.offsetMm || null,
                trueLength: only.trueLength,
                restTrueLength: only.trueLength
              };
              pending.pin.resolvedEdgeIndex = only.index;
            } else {
              var used = (overlapNarrowing && overlapNarrowing.entityId === pending.pin.id && overlapNarrowing.narrowedViews)
                ? overlapNarrowing.narrowedViews.slice() : [];
              if (used.indexOf(picked.view) === -1) used.push(picked.view);
              overlapNarrowing = {
                entityId: pending.pin.id,
                candidates: picked.group,
                narrowedViews: used
              };
            }
            clearHover(false);
            options.select(pending.pin.id, pending.pin.side);
            renderInventory(); renderSelection(); renderPins(); sync(); options.redraw();
            return;
          }
        }
      }
      var pendingCorner = pendingOverlapCorner();
      if (pendingCorner) {
        var clickedCornerEnt = id ? entities.find(function (e) { return e.id === id; }) : null;
        if (!clickedCornerEnt || pendingCorner.excludedViews.indexOf(role(clickedCornerEnt)) === -1) {
          var pickedCorner = pickCornerOverlapGroup(cursorPx, clickedCornerEnt, pendingCorner);
          if (pickedCorner) {
            if (pickedCorner.group.length === 1) {
              cornerOverlapNarrowing = null;
              resolvedPoseCorner = Object.assign({ pairKey: pendingCorner.pairKey }, pickedCorner.group[0]);
            } else {
              var usedC = (cornerOverlapNarrowing && cornerOverlapNarrowing.pairKey === pendingCorner.pairKey && cornerOverlapNarrowing.narrowedViews)
                ? cornerOverlapNarrowing.narrowedViews.slice() : [];
              if (usedC.indexOf(pickedCorner.view) === -1) usedC.push(pickedCorner.view);
              cornerOverlapNarrowing = {
                pairKey: pendingCorner.pairKey,
                candidates: pickedCorner.group,
                narrowedViews: usedC
              };
            }
            clearHover(false);
            renderInventory(); renderSelection(); renderPins(); sync(); options.redraw();
            return;
          }
        }
      }
      var pendingSpan = pendingOverlapSpan();
      if (pendingSpan) {
        var clickedSpanEnt = id ? entities.find(function (e) { return e.id === id; }) : null;
        var pickedSpan = pickSpanOverlapGroup(cursorPx, clickedSpanEnt, pendingSpan);
        if (pickedSpan) {
          var nextA = pickedSpan.slot === 'A' ? pickedSpan.group : pendingSpan.candsA;
          var nextB = pickedSpan.slot === 'B' ? pickedSpan.group : pendingSpan.candsB;
          if (nextA.length === 1 && nextB.length === 1 && handle.solidMm && handle.solidMm.vertices) {
            var vSA = handle.solidMm.vertices[nextA[0]], vSB = handle.solidMm.vertices[nextB[0]];
            var d3s = Math.hypot(vSB.x - vSA.x, vSB.y - vSA.y, vSB.z - vSA.z);
            spanOverlapState = null;
            resolvedPoseSpan = {
              pairKey: pendingSpan.pairKey,
              viewRole: pendingSpan.info.viewRole,
              viewLabel: pendingSpan.info.viewLabel,
              vertexA: nextA[0],
              vertexB: nextB[0],
              labelA: vertexLabel3D(vSA, handle.solidMm, entities, map),
              labelB: vertexLabel3D(vSB, handle.solidMm, entities, map),
              dist3D: d3s,
              restDist3D: d3s,
              side: null,
              offsetMm: null
            };
          } else {
            var usedA = (spanOverlapState && spanOverlapState.pairKey === pendingSpan.pairKey && spanOverlapState.narrowedViewsA)
              ? spanOverlapState.narrowedViewsA.slice() : [];
            var usedB = (spanOverlapState && spanOverlapState.pairKey === pendingSpan.pairKey && spanOverlapState.narrowedViewsB)
              ? spanOverlapState.narrowedViewsB.slice() : [];
            if (pickedSpan.slot === 'A' && usedA.indexOf(pickedSpan.view) === -1) usedA.push(pickedSpan.view);
            if (pickedSpan.slot === 'B' && usedB.indexOf(pickedSpan.view) === -1) usedB.push(pickedSpan.view);
            spanOverlapState = {
              pairKey: pendingSpan.pairKey,
              candidatesA: nextA,
              candidatesB: nextB,
              narrowedViewsA: usedA,
              narrowedViewsB: usedB
            };
          }
          clearHover(false);
          renderInventory(); renderSelection(); renderPins(); sync(); options.redraw();
          return;
        }
      }
      if (!id) {
        pins = [];
        resolvedPoseEdge = null;
        overlapNarrowing = null;
        resolvedPoseCorner = null;
        cornerOverlapNarrowing = null;
        resolvedPoseSpan = null;
        spanOverlapState = null;
        clearHover(false);
        options.select(null, null);
        renderInventory(); renderSelection(); renderPins(); sync(); options.redraw();
        return;
      }
      var chosenSide = side;
      var chosenOffset = null;
      if (hover.id === id && hover.stage === 'pulled') {
        chosenSide = hover.side;
        chosenOffset = hover.offsetMm || null;
      }
      var existingIdx = pins.findIndex(function (p) { return p.id === id; });
      if (existingIdx !== -1) {
        pins.splice(existingIdx, 1);
        if (resolvedPoseEdge && resolvedPoseEdge.entityId === id) resolvedPoseEdge = null;
        if (overlapNarrowing && overlapNarrowing.entityId === id) overlapNarrowing = null;
        resolvedPoseCorner = null;
        cornerOverlapNarrowing = null;
        resolvedPoseSpan = null;
        spanOverlapState = null;
        var nextId = pins.length ? pins[pins.length - 1].id : null;
        var nextSide = pins.length ? pins[pins.length - 1].side : null;
        options.select(nextId, nextSide);
      } else {
        if (pins.length >= 2) pins = [];
        resolvedPoseEdge = null;
        overlapNarrowing = null;
        resolvedPoseCorner = null;
        cornerOverlapNarrowing = null;
        resolvedPoseSpan = null;
        spanOverlapState = null;
        pins.push({ id: id, side: chosenSide === -1 ? -1 : 1, offsetMm: chosenOffset });
        options.select(id, chosenSide);
      }
      clearHover(false);
      renderInventory(); renderSelection(); renderPins(); sync(); options.redraw();
    }

    function table(parent, rows) {
      var wrap = document.createElement('div'); wrap.className = 'spatial-table-scroll';
      var tableEl = document.createElement('table'), body = document.createElement('tbody'); tableEl.appendChild(body); wrap.appendChild(tableEl); parent.appendChild(wrap);
      rows.forEach(function (values) { var tr = body.insertRow(); values.forEach(function (value) { var td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }); });
    }
    function button(parent, label, action, id) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.sheetAction = action;
      if (id !== undefined) b.dataset.sheetId = id; parent.appendChild(b); return b;
    }
    function record(id) { return records.find(function (entry) { return entry.id === id; }); }
    function renderSelection() {
      selectedEl.replaceChildren();
      var hideForCompare = false;
      if (pins.length === 2) {
        var pa = entities.find(function (e) { return e.id === pins[0].id; });
        var pb = entities.find(function (e) { return e.id === pins[1].id; });
        hideForCompare = !!(pa && pb && comparison(pa, pb, prefs, handle.solidMm, entities, map));
      }
      var spec = hideForCompare ? null : record(handle.measure.inspectId);
      selectedEl.hidden = !spec;
      if (spec) {
        var resolvedSel = resolvedPoseEdge && resolvedPoseEdge.entityId === spec.id ? resolvedPoseEdge : null;
        var header = document.createElement('div'); header.className = 'spatial-selection-head';
        var name = document.createElement('strong'); name.textContent = resolvedSel ? resolvedSel.label : spec.title; header.appendChild(name);
        var actions = document.createElement('div'); header.appendChild(actions);
        var pinned = pins.some(function (pin) { return pin.id === spec.id; });
        button(actions, pinned ? 'Unpin' : 'Pin', 'pin', spec.id).setAttribute('aria-pressed', String(pinned));
        button(actions, '×', 'clear').setAttribute('aria-label', 'Clear 2D selection'); selectedEl.appendChild(header);
        var selRows = spec.rows.slice();
        if (resolvedSel && !selRows.some(function (r) { return r[0] === 'True length (3D)'; })) {
          selRows.splice(1, 0, ['True length (3D)', number(resolvedSel.trueLength, prefs) + ' mm']);
        }
        table(selectedEl, selRows);
      }
      dataEl.querySelectorAll('[data-sheet-action="select"]').forEach(function (b) {
        var active = b.dataset.sheetId === handle.measure.inspectId;
        b.setAttribute('aria-pressed', String(active)); b.closest('.sheet-record').classList.toggle('spatial-active-row', active);
      });
    }
    function renderPins() {
      pinsEl.replaceChildren(); pinsEl.hidden = !pins.length;
      if (pins.length) {
        var header = document.createElement('div'); header.className = 'spatial-selection-head';
        var name = document.createElement('span'); name.textContent = 'Pinned (' + pins.length + ')'; header.appendChild(name);
        button(header, 'Clear', 'clear-pins'); pinsEl.appendChild(header);
        pins.forEach(function (pin) {
          var spec = record(pin.id); if (!spec) return;
          var resolved = resolvedPoseEdge && resolvedPoseEdge.entityId === pin.id ? resolvedPoseEdge : null;
          var displayTitle = resolved ? resolved.label : spec.title;
          var row = document.createElement('div'); row.className = 'spatial-pin-row';
          button(row, displayTitle, 'select', pin.id);
          var value = document.createElement('span');
          if (resolved) {
            value.textContent = VIEW_NAMES[spec.role].split(' · ')[0] + ' · ' + number(resolved.trueLength, prefs) + ' mm true';
          } else {
            value.textContent = VIEW_NAMES[spec.role].split(' · ')[0] + ' · ' + compactRows(spec, false).map(function (r) { return r[1]; }).join(' · ');
          }
          row.appendChild(value);
          button(row, '×', 'unpin', pin.id).setAttribute('aria-label', 'Unpin ' + displayTitle); pinsEl.appendChild(row);
        });
      }
      compareEl.replaceChildren(); compareEl.hidden = true;
      if (pins.length === 2) {
        var a = entities.find(function (e) { return e.id === pins[0].id; }), b = entities.find(function (e) { return e.id === pins[1].id; });
        var compared = comparison(a, b, prefs, handle.solidMm, entities, map);
        if (compared) {
          compareEl.hidden = false;
          var name = document.createElement('div'); name.className = 'sheet-compare-title'; name.textContent = title(a, entities) + ' ↔ ' + title(b, entities); compareEl.appendChild(name);
          var note = document.createElement('p'); note.className = 'spatial-note'; note.textContent = compared.note; compareEl.appendChild(note);
          if (compared.rows.length) table(compareEl, compared.rows);
        }
      }
    }
    function renderInventory() {
      var open = {}; dataEl.querySelectorAll('details[data-sheet-group]').forEach(function (group) { open[group.dataset.sheetGroup] = group.open; });
      dataEl.replaceChildren(); var items = inventory(entities, prefs, query);
      ['ELEVATION', 'PLAN', 'PROFILE', 'SHARED'].forEach(function (r) {
        var list = items.filter(function (e) { return role(e) === r; }); if (!list.length) return;
        var group = document.createElement('details'); group.dataset.sheetGroup = r; group.open = !!query || prefs.overlay === 'all' || !!open[r];
        var summary = document.createElement('summary'); summary.textContent = VIEW_NAMES[r] + ' (' + list.length + ')'; group.appendChild(summary);
        list.forEach(function (e) {
          var spec = record(e.id), row = document.createElement('div'); row.className = 'sheet-record';
          var b = button(row, spec.title, 'select', e.id); b.title = 'Inspect ' + spec.title;
          if (pins.some(function (pin) { return pin.id === e.id; })) row.classList.add('spatial-pinned-row');
          var values = document.createElement('span'); values.textContent = compactRows(spec, false).map(function (entry) { return entry[0] + ' ' + entry[1]; }).join(' · ') || TYPES[e.type]; row.appendChild(values);
          var expanded = document.createElement('details'); expanded.className = 'sheet-full-specs'; expanded.open = expandedSpecs;
          var label = document.createElement('summary'); label.textContent = 'Specs'; expanded.appendChild(label); table(expanded, spec.rows); row.appendChild(expanded); group.appendChild(row);
        });
        dataEl.appendChild(group);
      });
      if (!items.length) { var empty = document.createElement('p'); empty.className = 'spatial-note'; empty.textContent = query ? 'No matching geometry.' : 'No geometry matches these filters.'; dataEl.appendChild(empty); }
      var counts = {};
      items.forEach(function (e) { counts[role(e)] = (counts[role(e)] || 0) + 1; });
      sheet.querySelector('.sheet-summary').textContent = Object.keys(counts).map(function (r) { return VIEW_NAMES[r].split(' · ')[0] + ' ' + counts[r]; }).join(' · ') || 'Empty sheet';
    }
    function sync() {
      var currentRevision = handle.table.revision();
      if (revision !== currentRevision) {
        pins = []; resolvedPoseEdge = null; overlapNarrowing = null; resolvedPoseCorner = null; cornerOverlapNarrowing = null; resolvedPoseSpan = null; spanOverlapState = null; clearHover(false); revision = currentRevision; entities = options.entities(); map = options.layout();
        records = entities.map(function (e) { return specs(e, entities, prefs, map, handle.solidMm); }).filter(Boolean);
        if (handle.measure.inspectId && !record(handle.measure.inspectId)) Measure.clearInspect(handle.measure);
        renderInventory(); renderPins(); lastSelected = undefined;
      }
      if (lastSelected !== handle.measure.inspectId) { lastSelected = handle.measure.inspectId; renderSelection(); }
      var available = !!spatial && !!handle.solid.state.geometryMm && (!handle.drafting || handle.drafting.solidVisible());
      if (tab === 'solid' && !available) tab = 'sheet';
      var mobileSplit = typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive();
      var hideSidePanel = !panelVisible && !mobileSplit;
      panel.dataset.sidePanelHidden = hideSidePanel ? 'true' : 'false';
      panel.hidden = handle.measure.mode !== 'view' || hideSidePanel;
      if (handle.measure.mode !== 'view') clearHover(false);
      solidBody.hidden = tab !== 'solid'; sheet.hidden = tab !== 'sheet'; solidActions.hidden = tab !== 'solid'; fit.hidden = tab !== 'sheet';
      heading.textContent = tab === 'sheet' ? 'Orthographic view' : 'Spatial view';
      switcher.querySelector('[data-inspect-tab="solid"]').disabled = !available;
      switcher.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.inspectTab === tab)); });
      if (mobileSplit) panel.style.maxHeight = 'none';
      else if (!panel.hidden) {
        panel.style.maxHeight = Math.max(90, window.innerHeight - panel.getBoundingClientRect().top - 24) + 'px';
      }
    }
    function setPanelVisible(visible) {
      panelVisible = !!visible;
      sync();
    }
    function activate(value) { tab = value === 'solid' ? 'solid' : 'sheet'; sync(); }
    function setPreferences(value) {
      var oldScope = prefs.overlay; prefs = Settings.normalizeSheetInspection(value);
      if (oldScope !== 'all' && prefs.overlay === 'all') details.open = true;
      fields.querySelectorAll('input').forEach(function (input) { input.checked = prefs[input.dataset.sheetPreference]; });
      sheet.querySelector('.sheet-view-filter').value = prefs.view;
      sheet.querySelectorAll('[data-sheet-overlay]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.sheetOverlay === prefs.overlay)); });
      entities = options.entities(); map = options.layout(); records = entities.map(function (e) { return specs(e, entities, prefs, map, handle.solidMm); }).filter(Boolean);
      renderInventory(); renderSelection(); renderPins(); sync();
    }
    function change(key, value) {
      var next = Object.assign({}, prefs); next[key] = value; setPreferences(next);
      if (options.onPreferencesChange) options.onPreferencesChange(Object.assign({}, prefs));
      options.redraw();
    }
    function choose(id) {
      sync(); var e = entities.find(function (item) { return item.id === id; }); if (!e) return;
      activate('sheet'); options.select(id, Measure.dimSideFor(e, handle.view, Measure.inspectAnchor(e, handle.view))); sync();
    }
    panel.addEventListener('click', function (event) {
      var b = event.target.closest('button'); if (!b) return;
      if (b.dataset.inspectTab) { activate(b.dataset.inspectTab); options.redraw(); }
      if (b.dataset.sheetOverlay) { change('overlay', b.dataset.sheetOverlay); return; }
      var action = b.dataset.sheetAction;
      if (action === 'fit') options.fit();
      else if (action === 'collapse') {
        collapsed = !collapsed;
        panel.classList.toggle('is-collapsed', collapsed);
        bodyWrap.hidden = collapsed;
        collapseBtn.setAttribute('aria-expanded', String(!collapsed));
        collapseBtn.setAttribute('aria-label', collapsed ? 'Expand inspection panel' : 'Collapse inspection panel');
        collapseBtn.title = collapsed ? 'Expand panel' : 'Collapse panel';
        collapseBtn.textContent = collapsed ? '+' : '–';
        options.redraw();
      }
      else if (action === 'expand-specs') {
        expandedSpecs = !expandedSpecs; b.textContent = expandedSpecs ? 'Collapse all' : 'Expand all';
        b.setAttribute('aria-pressed', String(expandedSpecs));
        dataEl.querySelectorAll('.sheet-full-specs').forEach(function (spec) { spec.open = expandedSpecs; });
        options.redraw();
      }
      else if (action === 'select') choose(b.dataset.sheetId);
      else if (action === 'clear') { pins = []; resolvedPoseEdge = null; overlapNarrowing = null; resolvedPoseCorner = null; cornerOverlapNarrowing = null; resolvedPoseSpan = null; spanOverlapState = null; options.select(null, null); renderInventory(); renderSelection(); renderPins(); sync(); options.redraw(); }
      else if (action === 'pin') {
        resolvedPoseEdge = null; overlapNarrowing = null; resolvedPoseCorner = null; cornerOverlapNarrowing = null; resolvedPoseSpan = null; spanOverlapState = null;
        pins = togglePin(pins, b.dataset.sheetId, handle.measure.inspectSide);
        if (pins.length && prefs.overlay === 'selected') change('overlay', 'pinned');
        renderInventory(); renderSelection(); renderPins(); options.redraw();
      } else if (action === 'unpin') {
        if (resolvedPoseEdge && resolvedPoseEdge.entityId === b.dataset.sheetId) resolvedPoseEdge = null;
        if (overlapNarrowing && overlapNarrowing.entityId === b.dataset.sheetId) overlapNarrowing = null;
        resolvedPoseCorner = null; cornerOverlapNarrowing = null; resolvedPoseSpan = null; spanOverlapState = null;
        pins = pins.filter(function (pin) { return pin.id !== b.dataset.sheetId; }); renderInventory(); renderSelection(); renderPins(); options.redraw();
      }
      else if (action === 'clear-pins') { pins = []; resolvedPoseEdge = null; overlapNarrowing = null; resolvedPoseCorner = null; cornerOverlapNarrowing = null; resolvedPoseSpan = null; spanOverlapState = null; options.select(null, null); renderInventory(); renderSelection(); renderPins(); sync(); options.redraw(); }
    });
    sheet.addEventListener('change', function (event) {
      if (event.target.dataset.sheetPreference) change(event.target.dataset.sheetPreference, event.target.checked);
      else if (event.target.classList.contains('sheet-view-filter')) change('view', event.target.value);
    });
    sheet.querySelector('.sheet-search').addEventListener('input', function (event) { query = event.target.value; renderInventory(); renderSelection(); options.redraw(); });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && tab === 'sheet') { pins = []; resolvedPoseEdge = null; overlapNarrowing = null; resolvedPoseCorner = null; cornerOverlapNarrowing = null; resolvedPoseSpan = null; spanOverlapState = null; clearHover(false); options.select(null, null); renderInventory(); renderSelection(); renderPins(); sync(); options.redraw(); }
      event.stopPropagation();
    });
    panel.addEventListener('toggle', function () { options.redraw(); }, true);
    ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'wheel', 'contextmenu'].forEach(function (type) { panel.addEventListener(type, function (event) { event.stopPropagation(); }); });
    setPreferences(prefs);

    function drawOverlay(ctx, view) {
      sync();
      hoverHit = null;
      if (handle.measure.mode !== 'view') return;
      ctx.save(); ctx.font = prefs.textSize + 'px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      var occupied = [], suppressed = 0;
      var bounds = viewBounds(entities, view);
      Object.keys(bounds).forEach(function (r) { occupied.push(bounds[r]); });
      var canvasBox = handle.mount.layer2.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
      if (!panel.hidden) occupied.push({ x0: panelBox.left - canvasBox.left, y0: panelBox.top - canvasBox.top, x1: panelBox.right - canvasBox.left, y1: panelBox.bottom - canvasBox.top });
      if (!(typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive())) {
        occupied.push({ x0: 0, y0: 0, x1: view.w, y1: 38 });
        if (handle.solid && handle.solid.state.geometryMm && handle.drafting.solidVisible()) {
          var points = handle.solid.state.geometryMm.vertices.map(function (p) { return EduCADSpatial.projectMm(p, handle.solid.state, EduCADSolid); });
          occupied.push({ x0: Math.min.apply(null, points.map(function (p) { return p.x; })) - 10, x1: Math.max.apply(null, points.map(function (p) { return p.x; })) + 10,
            y0: Math.min.apply(null, points.map(function (p) { return p.y; })) - 10, y1: Math.max.apply(null, points.map(function (p) { return p.y; })) + 10 });
        }
      }
      entities.forEach(function (e) {
        var anchor = Measure.inspectAnchor(e, view); if (!anchor) return;
        if (e.type === 'POINT') {
          occupied.push({ x0: anchor.x - 5, y0: anchor.y - 5, x1: anchor.x + 5, y1: anchor.y + 5 });
          if (e.showLabel !== false && e.caption) occupied.push({ x0: anchor.x - 8, y0: anchor.y - 24, x1: anchor.x + ctx.measureText(e.caption).width + 8, y1: anchor.y - 5 });
        }
      });
      function toPx(pt) { return { x: pt.x * view.s + view.tx, y: view.ty - pt.y * view.s }; }
      function segment(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      function arrow(a, b) {
        var dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); if (length < 2) return;
        var ux = dx / length, uy = dy / length;
        segment(b, { x: b.x - ux * 7 + uy * 2.5, y: b.y - uy * 7 - ux * 2.5 });
        segment(b, { x: b.x - ux * 7 - uy * 2.5, y: b.y - uy * 7 + ux * 2.5 });
      }
      function overlap(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
      function drawPill(x, y, lines, color, subColor) {
        var width = Math.max.apply(null, lines.map(function (line) { return ctx.measureText(line).width; })) + 12;
        var lineH = prefs.textSize + 4;
        var height = lines.length * lineH + 6;
        var cx = Math.max(6, Math.min(view.w - width - 6, x - width / 2));
        var cy = Math.max(6, Math.min(view.h - height - 6, y - height / 2));
        ctx.fillStyle = themeColor('viewLabelBg', 'rgba(248, 250, 252, 0.96)');
        ctx.fillRect(cx, cy, width, height);
        ctx.textAlign = 'left';
        lines.forEach(function (line, idx) {
          ctx.fillStyle = idx === 0 ? color : (subColor || themeColor('accent', '#0284c7'));
          ctx.fillText(line, cx + 6, cy + 3 + lineH * (idx + 0.5));
        });
        var rect = { x0: cx, y0: cy, x1: cx + width, y1: cy + height };
        occupied.push({ x0: cx - 3, y0: cy - 3, x1: cx + width + 3, y1: cy + height + 3 });
        return rect;
      }
      function drawEdgeTag(pa, pb, isPt, tagLabel, centroid) {
        if (!tagLabel) return null;
        var accent = themeColor('accent', '#0284c7');
        ctx.save();
        var tagSize = Math.max(9.5, prefs.textSize - 0.5);
        ctx.font = '600 ' + tagSize + 'px system-ui, sans-serif';
        ctx.textBaseline = 'middle';
        var tw = ctx.measureText(tagLabel).width;
        var w = tw + 10, h = Math.max(16, tagSize + 6);
        var cx, cy;
        if (isPt) {
          var ux = 0, uy = -1;
          if (centroid) {
            var pdx = pa.x - centroid.x, pdy = pa.y - centroid.y, pd = Math.hypot(pdx, pdy);
            if (pd > 4) { ux = pdx / pd; uy = pdy / pd; }
          }
          var pOff = Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2) + 10;
          cx = pa.x + ux * pOff;
          cy = pa.y + uy * pOff;
        } else {
          var mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
          var dx = pb.x - pa.x, dy = pb.y - pa.y, len = Math.hypot(dx, dy) || 1;
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
          var nearX = Math.max(rx, Math.min(rx + w, pa.x));
          var nearY = Math.max(ry, Math.min(ry + h, pa.y));
          var ldx = nearX - pa.x, ldy = nearY - pa.y, ld = Math.hypot(ldx, ldy);
          if (ld > 5.5) {
            ctx.strokeStyle = themeColor('viewGuide', '#8a9dad');
            ctx.lineWidth = 0.85;
            segment({ x: pa.x + (ldx / ld) * 5, y: pa.y + (ldy / ld) * 5 }, { x: nearX, y: nearY });
          }
        }
        ctx.fillStyle = themeColor('viewLabelBg', 'rgba(248, 250, 252, 0.96)');
        ctx.fillRect(rx, ry, w, h);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.42;
        ctx.lineWidth = 0.9;
        ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1);
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        ctx.textAlign = 'left';
        ctx.fillText(tagLabel, rx + 5, ry + h / 2);
        ctx.restore();
        var rect = { x0: rx, y0: ry, x1: rx + w, y1: ry + h };
        occupied.push({ x0: rx - 2, y0: ry - 2, x1: rx + w + 2, y1: ry + h + 2 });
        return rect;
      }
      function highlightOtherViewsForEdges(edgeIndices, excludeRole, force, tagLabel) {
        var g = handle.solidMm;
        if (!g || !edgeIndices || !edgeIndices.length || (!force && !prefs.links)) return;
        var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
        ctx.save();
        ctx.strokeStyle = themeColor('accent', '#0284c7');
        ctx.lineWidth = 1.75;
        ctx.setLineDash([]);
        views.forEach(function (vr) {
          if (vr === excludeRole) return;
          var centroid = null;
          if (tagLabel && g.vertices && g.vertices.length) {
            var sx = 0, sy = 0;
            for (var k = 0; k < g.vertices.length; k++) {
              var vp = toPx(toView3D(g.vertices[k], vr, map));
              sx += vp.x; sy += vp.y;
            }
            centroid = { x: sx / g.vertices.length, y: sy / g.vertices.length };
          }
          edgeIndices.forEach(function (idx) {
            var edge = g.edges[idx];
            if (!edge) return;
            var pa = toPx(toView3D(g.vertices[edge[0]], vr, map));
            var pb = toPx(toView3D(g.vertices[edge[1]], vr, map));
            var isPt = Math.hypot(pb.x - pa.x, pb.y - pa.y) < 1.5;
            if (isPt) {
              ctx.beginPath(); ctx.arc(pa.x, pa.y, 4.5, 0, Math.PI * 2); ctx.stroke();
            } else {
              segment(pa, pb);
            }
            if (tagLabel && edgeIndices.length === 1) {
              drawEdgeTag(pa, pb, isPt, tagLabel, centroid);
            }
          });
        });
        ctx.restore();
      }
      function highlightOtherViewsForPoint(ptEntity) {
        var v3 = reconstructedPoint3D(ptEntity, handle.solidMm, map);
        if (!v3 || !prefs.links) return;
        var r = role(ptEntity);
        var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
        ctx.save();
        ctx.strokeStyle = themeColor('accent', '#0284c7');
        ctx.lineWidth = 1.4;
        ctx.setLineDash([]);
        views.forEach(function (vr) {
          if (vr === r) return;
          var p = toPx(toView3D(v3, vr, map));
          ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2); ctx.stroke();
        });
        ctx.restore();
      }
      function strokeEntity(e, color, width) {
        var anchor = Measure.inspectAnchor(e, view); if (!anchor) return;
        ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash([]);
        if (SPANS.indexOf(e.type) !== -1) segment(toPx({ x: e.x, y: e.y }), toPx({ x: e.x2, y: e.y2 }));
        else {
          ctx.beginPath();
          if (e.type === 'POINT') ctx.arc(anchor.x, anchor.y, 5.5, 0, Math.PI * 2);
          else if (e.type === 'CIRCULAR_ARC') ctx.arc(anchor.x, anchor.y, e.radius * view.s, -e.startAngle * Geometry.RAD, -(e.startAngle + Geometry.arcSweep(e.startAngle, e.endAngle)) * Geometry.RAD, true);
          else ctx.arc(anchor.x, anchor.y, e.radius * view.s, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      function cornerOverlapPromptText(count, sep, narrowed) {
        var prefix = narrowed ? (count + ' corners still coincide') : (count + ' corners overlap');
        if (sep && sep.kind === 'full' && sep.label) return prefix + ' · choose in ' + sep.label;
        if (sep && sep.kind === 'partial' && sep.label) return prefix + ' · narrow in ' + sep.label;
        return prefix + ' · cannot distinguish in drawn views';
      }
      function markCornerVerticesInView(candidates, targetRole, showTag) {
        var g = handle.solidMm;
        if (!g || !g.vertices || !candidates || !candidates.length || !targetRole) return;
        var accent = themeColor('accent', '#0284c7');
        var centroid = null;
        if (g.vertices.length) {
          var sx = 0, sy = 0;
          for (var k = 0; k < g.vertices.length; k++) {
            var vp = toPx(toView3D(g.vertices[k], targetRole, map));
            sx += vp.x; sy += vp.y;
          }
          centroid = { x: sx / g.vertices.length, y: sy / g.vertices.length };
        }
        var marked = [];
        ctx.save();
        candidates.forEach(function (c) {
          var p2 = toView3D(g.vertices[c.vertexIndex], targetRole, map);
          if (marked.some(function (m) { return near2(m, p2, MATCH_EPS); })) return;
          marked.push(p2);
          var px = toPx(p2);
          ctx.strokeStyle = accent;
          ctx.lineWidth = 1.75;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(px.x, px.y, 7.5, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = accent;
          ctx.beginPath(); ctx.arc(px.x, px.y, 3, 0, Math.PI * 2); ctx.fill();
          if (showTag && c.vertexLabel) {
            drawEdgeTag(px, px, true, c.vertexLabel, centroid);
          }
        });
        ctx.restore();
      }
      function overlapPromptText(count, sep, narrowed) {
        var prefix = narrowed ? (count + ' edges still coincide') : (count + ' edges overlap');
        if (sep && sep.kind === 'full' && sep.label) return prefix + ' · choose in ' + sep.label;
        if (sep && sep.kind === 'partial' && sep.label) return prefix + ' · narrow to a group in ' + sep.label;
        return prefix + ' · cannot distinguish in drawn views';
      }
      function drawPulledEdgeDimension(e, side, offsetMm, color, showSecondary, isPinnedSingle) {
        var edgeInfo = reconstructedEdgeInfo(e, handle.solidMm, map);
        var resolved = isPinnedSingle && resolvedPoseEdge && resolvedPoseEdge.entityId === e.id ? resolvedPoseEdge : null;
        var uniquePinned = isPinnedSingle && !resolved && edgeInfo && edgeInfo.established && edgeInfo.uniqueEdge !== null
          ? {
              edgeIndex: edgeInfo.uniqueEdge,
              label: physicalEdgeLabel(edgeInfo.uniqueEdge, handle.solidMm, entities, map, !!edgeInfo.uniqueReversed),
              viewRole: edgeInfo.role,
              trueLength: edgeInfo.trueLength
            }
          : null;
        var namedTracked = resolved || uniquePinned;
        var pending = isPinnedSingle && !namedTracked ? pendingOverlapPin() : null;
        var linear = Measure.linearDimLayout(e, view, {
          side: side === -1 ? -1 : 1,
          measure: function (text) { return ctx.measureText(text).width; },
          offsetMm: offsetMm || Math.max(10, 26 / view.s),
          lineH: prefs.textSize + 4
        });
        if (!linear) return null;
        ctx.save();
        ctx.lineWidth = 0.9;
        ctx.strokeStyle = themeColor('viewGuide', '#8a9dad');
        ctx.setLineDash([]);
        linear.ext.forEach(function (pair) { segment(pair[0], pair[1]); });
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        segment(linear.d1, linear.d2);
        arrow(linear.d2, linear.d1);
        arrow(linear.d1, linear.d2);
        drawComponents(ctx, view, prefs, e, { x: e.x2, y: e.y2 });
        var lines;
        if (namedTracked) {
          lines = edgeCalloutLines({
            name: namedTracked.label,
            viewRole: namedTracked.viewRole,
            projLen: linear.lenMm,
            trueLen: namedTracked.trueLength,
            precision: prefs.precision
          }).lines;
        } else {
          var showViewTag = edgeInfo && (edgeInfo.foreshortened || (isPinnedSingle && edgeInfo.overlapCount >= 2));
          var primary = showViewTag
            ? (SHORT_VIEW_CAP[role(e)] || '') + ' ' + number(linear.lenMm, prefs) + ' mm'
            : number(linear.lenMm, prefs) + ' mm';
          lines = [primary];
          if (pending) {
            var candFirst = pending.candidates[0].trueLength;
            var candCommon = pending.candidates.every(function (c) { return Math.abs(c.trueLength - candFirst) <= 0.05; });
            if (candCommon && (candFirst - linear.lenMm) > 0.05) {
              lines.push('True length ' + number(candFirst, prefs) + ' mm');
            }
            lines.push(overlapPromptText(pending.candidates.length, pending.sep, pending.narrowed));
          } else if (showSecondary) {
            if (edgeInfo && edgeInfo.established && edgeInfo.foreshortened) {
              lines.push('True length ' + number(edgeInfo.trueLength, prefs) + ' mm');
            }
          }
        }
        if (showSecondary && prefs.angles && prefs.labels) {
          var direction = Measure.lineAngleDeg(e.x2 - e.x, e.y2 - e.y);
          var origin = e.y <= e.y2 ? toPx(e) : toPx({ x: e.x2, y: e.y2 });
          var theta = -direction * Math.PI / 180;
          var radius = Math.min(22, linear.lenMm * view.s / 3);
          if (Math.abs(theta) > 0.01 && radius >= 6) {
            ctx.strokeStyle = themeColor('viewGuide', '#8a9dad');
            ctx.setLineDash([3, 3]);
            segment(origin, { x: origin.x + radius + 6, y: origin.y });
            ctx.setLineDash([]);
            ctx.beginPath(); ctx.arc(origin.x, origin.y, radius, 0, theta, true);
            ctx.stroke();
            var bisector = theta / 2;
            drawPill(origin.x + Math.cos(bisector) * (radius + 15), origin.y + Math.sin(bisector) * (radius + 15),
              [number(direction, prefs) + '°'], color);
          }
        }
        var mx = (linear.d1.x + linear.d2.x) / 2 + linear.normal.x * (lines.length > 2 ? 24 : lines.length > 1 ? 18 : 13);
        var my = (linear.d1.y + linear.d2.y) / 2 + linear.normal.y * (lines.length > 2 ? 24 : lines.length > 1 ? 18 : 13);
        var pillRect = drawPill(mx, my, lines, color, themeColor('accent', '#0284c7'));
        if (namedTracked) {
          highlightOtherViewsForEdges([namedTracked.edgeIndex], namedTracked.viewRole, true, namedTracked.label);
        } else if (pending) {
          highlightOtherViewsForEdges(pending.candidates.map(function (c) { return c.index; }), pending.info.role, true);
        } else if (edgeInfo && edgeInfo.established && (showSecondary || edgeInfo.foreshortened)) {
          highlightOtherViewsForEdges(edgeInfo.edges, edgeInfo.role, false);
        }
        ctx.restore();
        return { dimSeg: [linear.d1, linear.d2], pillRect: pillRect };
      }
      function drawTwoPinComparison(a, b) {
        var accent = themeColor('accent', '#0284c7');
        var guide = themeColor('viewGuide', '#8a9dad');
        var ink = themeColor('viewInspect', '#415c74');
        if (role(a) !== role(b)) {
          if (a.type === 'POINT' && b.type === 'POINT') {
            strokeEntity(a, ink, 1.6);
            strokeEntity(b, ink, 1.6);
            var pa0 = toPx(a), pb0 = toPx(b);
            ctx.save();
            ctx.strokeStyle = guide; ctx.lineWidth = 0.9; ctx.setLineDash([4, 4]);
            segment(pa0, pb0);
            var dxCross = Math.abs(b.x - a.x);
            drawPill((pa0.x + pb0.x) / 2, (pa0.y + pb0.y) / 2, [dxCross < 0.05 ? 'Aligned · ΔX 0 mm' : 'ΔX ' + number(dxCross, prefs) + ' mm'], ink, accent);
            ctx.restore();
            return true;
          }
          return false;
        }
        if (a.type === 'POINT' && b.type === 'POINT') {
          var pa = toPx(a), pb = toPx(b);
          var dxMm = b.x - a.x, dyMm = b.y - a.y, distMm = Math.hypot(dxMm, dyMm);
          drawComponents(ctx, view, prefs, a, b);
          var pairKeyPt = pinPairKey();
          var resSpan = resolvedPoseSpan && resolvedPoseSpan.pairKey === pairKeyPt ? resolvedPoseSpan : null;
          var spanInfo = resSpan ? null : reconstructedPointPairInfo(a, b, handle.solidMm, entities, map);
          var confirmedSpan = resSpan || (spanInfo && spanInfo.unique ? spanInfo : null);
          var pendSpan = !confirmedSpan ? pendingOverlapSpan() : null;
          if ((confirmedSpan || pendSpan) && handle.solidMm && handle.solidMm.vertices) {
            var spanRole = confirmedSpan ? confirmedSpan.viewRole : pendSpan.info.viewRole;
            var centroidS = null;
            if (handle.solidMm.vertices.length) {
              var ssx = 0, ssy = 0;
              for (var sk = 0; sk < handle.solidMm.vertices.length; sk++) {
                var svp = toPx(toView3D(handle.solidMm.vertices[sk], spanRole, map));
                ssx += svp.x; ssy += svp.y;
              }
              centroidS = { x: ssx / handle.solidMm.vertices.length, y: ssy / handle.solidMm.vertices.length };
            }
            var sdx = pb.x - pa.x, sdy = pb.y - pa.y, slen = Math.hypot(sdx, sdy) || 1;
            var sux = sdx / slen, suy = sdy / slen;
            var smx = (pa.x + pb.x) / 2, smy = (pa.y + pb.y) / 2;
            var dimSide = sux >= 0 ? -1 : 1;
            if (centroidS) {
              var sdot = (smx - centroidS.x) * (-suy) + (smy - centroidS.y) * sux;
              if (Math.abs(sdot) > 1) dimSide = sdot >= 0 ? 1 : -1;
            }
            ctx.save();
            ctx.strokeStyle = guide; ctx.lineWidth = 0.85; ctx.setLineDash([4, 4]);
            segment(pa, pb);
            ctx.setLineDash([]);
            ctx.fillStyle = accent;
            ctx.beginPath(); ctx.arc(pa.x, pa.y, 3.2, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(pb.x, pb.y, 3.2, 0, Math.PI * 2); ctx.fill();
            strokeEntity(a, accent, 1.5);
            strokeEntity(b, accent, 1.5);

            var spanLines = null;
            if (confirmedSpan) {
              spanLines = pointSpanCalloutLines({
                viewRole: confirmedSpan.viewRole,
                projLen: distMm,
                trueLen: confirmedSpan.dist3D,
                precision: prefs.precision,
                projPx: slen
              }).lines;
            } else {
              var sViewTitle = SHORT_VIEW_CAP[spanRole] || 'View';
              var sepLabel = (pendSpan.sepA && pendSpan.sepA.label) || (pendSpan.sepB && pendSpan.sepB.label) || '';
              var needBoth = pendSpan.candsA.length >= 2 && pendSpan.candsB.length >= 2;
              var promptSpan;
              if (!sepLabel) {
                promptSpan = 'Stacked endpoint · cannot distinguish in drawn views';
              } else if (needBoth && pendSpan.activeSlot === 'A') {
                ctx.strokeStyle = accent; ctx.lineWidth = 1.8;
                ctx.beginPath(); ctx.arc(pa.x, pa.y, 8, 0, Math.PI * 2); ctx.stroke();
                promptSpan = 'Choose 1st endpoint in ' + sepLabel;
              } else if (needBoth) {
                promptSpan = 'Choose endpoints in ' + sepLabel;
              } else {
                promptSpan = 'Choose stacked endpoint in ' + sepLabel;
              }
              spanLines = [sViewTitle + ' ' + number(distMm, prefs) + ' mm', promptSpan];
            }

            var vSpanEnt = { type: 'SEGMENT', x: a.x, y: a.y, x2: b.x, y2: b.y };
            var spanLin = Measure.linearDimLayout(vSpanEnt, view, {
              side: dimSide,
              offsetMm: Math.max(12, 28 / view.s),
              lineH: prefs.textSize + 4
            });
            if (spanLin) {
              ctx.strokeStyle = guide; ctx.lineWidth = 0.9; ctx.setLineDash([]);
              spanLin.ext.forEach(function (pair) { segment(pair[0], pair[1]); });
              ctx.strokeStyle = ink; ctx.lineWidth = 1.1;
              segment(spanLin.d1, spanLin.d2);
              arrow(spanLin.d2, spanLin.d1);
              arrow(spanLin.d1, spanLin.d2);
              var spOff = spanLines.length > 1 ? 18 : 13;
              drawPill((spanLin.d1.x + spanLin.d2.x) / 2 + spanLin.normal.x * spOff,
                (spanLin.d1.y + spanLin.d2.y) / 2 + spanLin.normal.y * spOff, spanLines, ink, accent);
            } else {
              drawPill(smx, smy - 20, spanLines, ink, accent);
            }

            var otherSpanViews = (map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'])
              .filter(function (vr) { return vr !== spanRole; });
            if (pendSpan) {
              var toMarkerObjs = function (idxs) {
                return idxs.map(function (idx) {
                  return { vertexIndex: idx, vertexLabel: vertexLabel3D(handle.solidMm.vertices[idx], handle.solidMm, entities, map) };
                });
              };
              if (pendSpan.candsA.length >= 2 && pendSpan.sepA && pendSpan.sepA.view) {
                markCornerVerticesInView(toMarkerObjs(pendSpan.candsA), pendSpan.sepA.view, true);
              } else if (pendSpan.candsA.length === 1 && pendSpan.sepB && pendSpan.sepB.view) {
                var pChosenA = toPx(toView3D(handle.solidMm.vertices[pendSpan.candsA[0]], pendSpan.sepB.view, map));
                ctx.fillStyle = accent;
                ctx.beginPath(); ctx.arc(pChosenA.x, pChosenA.y, 4, 0, Math.PI * 2); ctx.fill();
              }
              if (pendSpan.candsB.length >= 2 && pendSpan.activeSlot !== 'A' && pendSpan.sepB && pendSpan.sepB.view) {
                markCornerVerticesInView(toMarkerObjs(pendSpan.candsB), pendSpan.sepB.view, true);
              } else if (pendSpan.candsB.length === 1 && pendSpan.sepA && pendSpan.sepA.view) {
                var pChosenB = toPx(toView3D(handle.solidMm.vertices[pendSpan.candsB[0]], pendSpan.sepA.view, map));
                ctx.fillStyle = accent;
                ctx.beginPath(); ctx.arc(pChosenB.x, pChosenB.y, 4, 0, Math.PI * 2); ctx.fill();
              }
            } else if (confirmedSpan) {
              otherSpanViews.forEach(function (vr) {
                var qA = toPx(toView3D(handle.solidMm.vertices[confirmedSpan.vertexA], vr, map));
                var qB = toPx(toView3D(handle.solidMm.vertices[confirmedSpan.vertexB], vr, map));
                ctx.strokeStyle = accent; ctx.globalAlpha = 0.65; ctx.lineWidth = 1.25; ctx.setLineDash([4, 4]);
                if (Math.hypot(qB.x - qA.x, qB.y - qA.y) >= 1.5) segment(qA, qB);
                ctx.setLineDash([]); ctx.globalAlpha = 1;
                markCornerVerticesInView([
                  { vertexIndex: confirmedSpan.vertexA, vertexLabel: confirmedSpan.labelA },
                  { vertexIndex: confirmedSpan.vertexB, vertexLabel: confirmedSpan.labelB }
                ], vr, true);
              });
            }
            ctx.restore();
            return true;
          }
          strokeEntity(a, ink, 1.6);
          strokeEntity(b, ink, 1.6);
          ctx.save();
          if (Math.abs(dxMm) > 0.05 && Math.abs(dyMm) > 0.05) {
            var corner = { x: pb.x, y: pa.y };
            ctx.strokeStyle = guide; ctx.lineWidth = 0.75; ctx.setLineDash([3, 4]);
            segment(pa, corner); segment(corner, pb);
          }
          ctx.strokeStyle = accent; ctx.lineWidth = 1.2; ctx.setLineDash([]);
          segment(pa, pb);
          arrow(pb, pa); arrow(pa, pb);
          var lines = [number(distMm, prefs) + ' mm'];
          if (!prefs.components && Math.abs(dxMm) > 0.05 && Math.abs(dyMm) > 0.05) {
            lines.push('ΔX ' + number(Math.abs(dxMm), prefs) + ' · ΔY ' + number(Math.abs(dyMm), prefs) + ' mm');
          }
          var vA = reconstructedPoint3D(a, handle.solidMm, map);
          var vB = reconstructedPoint3D(b, handle.solidMm, map);
          if (vA && vB) {
            var d3 = Math.hypot(vB.x - vA.x, vB.y - vA.y, vB.z - vA.z);
            if (d3 - distMm > 0.05) lines.push(number(d3, prefs) + ' mm · 3D');
          }
          var dpx = pb.x - pa.x, dpy = pb.y - pa.y, lpx = Math.hypot(dpx, dpy) || 1;
          var nx = -dpy / lpx, ny = dpx / lpx;
          if (ny > 0) { nx = -nx; ny = -ny; }
          drawPill((pa.x + pb.x) / 2 + nx * 18, (pa.y + pb.y) / 2 + ny * 18, lines, ink, accent);
          ctx.restore();
          return true;
        }
        if (SPANS.indexOf(a.type) !== -1 && SPANS.indexOf(b.type) !== -1) {
          var prefC = {};
          if (pins.length === 2) {
            if (pins[0].id === a.id && pins[0].resolvedEdgeIndex !== undefined) prefC.a = pins[0].resolvedEdgeIndex;
            if (pins[1].id === b.id && pins[1].resolvedEdgeIndex !== undefined) prefC.b = pins[1].resolvedEdgeIndex;
          }
          var pairKeyNow = pinPairKey();
          var resolvedCorner = resolvedPoseCorner && resolvedPoseCorner.pairKey === pairKeyNow ? resolvedPoseCorner : null;
          var cornerInfo = resolvedCorner ? null : reconstructedCornerInfo(a, b, handle.solidMm, entities, map, prefC);
          var corner3 = resolvedCorner || (cornerInfo && cornerInfo.unique ? cornerInfo : null);
          var pendingCorner = !corner3 ? pendingOverlapCorner() : null;
          if ((corner3 || pendingCorner) && handle.solidMm && handle.solidMm.vertices) {
            strokeEntity(a, accent, 1.8);
            strokeEntity(b, accent, 1.8);
            var sampleCorner = corner3 || pendingCorner.candidates[0];
            var vS = handle.solidMm.vertices[sampleCorner.vertexIndex];
            var vA = handle.solidMm.vertices[sampleCorner.otherA];
            var vB = handle.solidMm.vertices[sampleCorner.otherB];
            var vrC = sampleCorner.viewRole;
            var sS = toPx(toView3D(vS, vrC, map));
            var sA = toPx(toView3D(vA, vrC, map));
            var sB = toPx(toView3D(vB, vrC, map));
            var cOut = corner3 ? cornerAngleCallout({
              viewRole: corner3.viewRole, vShared: vS, va: vA, vb: vB, map: map,
              angle3D: corner3.angle3D, labelA: corner3.labelA, labelB: corner3.labelB,
              precision: prefs.precision
            }) : null;
            var linesC = null;
            var isPointMarkerC = !!(cOut && cOut.pointMarker);
            if (cOut) {
              linesC = cOut.lines;
            } else if (pendingCorner) {
              var cands = pendingCorner.candidates;
              var firstP = cands[0].projectedAngle;
              var commonP = firstP !== null && cands.every(function (c) { return c.projectedAngle !== null && Math.abs(c.projectedAngle - firstP) <= 0.1; }) ? firstP : null;
              var first3 = cands[0].angle3D;
              var common3 = cands.every(function (c) { return Math.abs(c.angle3D - first3) <= 0.1; }) ? first3 : null;
              var promptC = cornerOverlapPromptText(cands.length, pendingCorner.sep, pendingCorner.narrowed);
              if (commonP !== null) {
                linesC = [formatAngleDeg(commonP, prefs.precision) + '° · ' + promptC];
                if (common3 !== null && Math.abs(common3 - commonP) > 0.1) {
                  linesC.push('3D angle ' + formatAngleDeg(common3, prefs.precision) + '°');
                }
              } else {
                linesC = [promptC];
                if (common3 !== null) linesC.push('3D angle ' + formatAngleDeg(common3, prefs.precision) + '°');
              }
            }
            ctx.save();
            if (isPointMarkerC && linesC) {
              ctx.strokeStyle = accent; ctx.lineWidth = 1.6;
              ctx.beginPath(); ctx.arc(sS.x, sS.y, 6, 0, Math.PI * 2); ctx.stroke();
              ctx.fillStyle = accent;
              ctx.beginPath(); ctx.arc(sS.x, sS.y, 2.4, 0, Math.PI * 2); ctx.fill();
              drawPill(sS.x, sS.y - 24, linesC, ink, accent);
            } else if (linesC) {
              var lenAPx = Math.hypot(sA.x - sS.x, sA.y - sS.y);
              var lenBPx = Math.hypot(sB.x - sS.x, sB.y - sS.y);
              var ca1 = Math.atan2(sA.y - sS.y, sA.x - sS.x);
              var ca2 = Math.atan2(sB.y - sS.y, sB.x - sS.x);
              var cdiff = ca2 - ca1;
              while (cdiff > Math.PI) cdiff -= 2 * Math.PI;
              while (cdiff < -Math.PI) cdiff += 2 * Math.PI;
              ctx.fillStyle = accent;
              ctx.beginPath(); ctx.arc(sS.x, sS.y, 2.8, 0, Math.PI * 2); ctx.fill();
              var cArcR = Math.min(24, Math.max(12, Math.min(lenAPx, lenBPx) * 0.36));
              if (Math.abs(cdiff) > 0.03) {
                ctx.strokeStyle = accent; ctx.lineWidth = 1.4; ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(sS.x, sS.y, cArcR, ca1, ca1 + cdiff, cdiff < 0);
                ctx.stroke();
              }
              var cMidA = ca1 + cdiff / 2;
              var cDir = Math.abs(cdiff) < 0.45 ? cMidA + Math.PI : cMidA;
              var cPillR = cArcR + (linesC.length > 1 ? 26 : 20);
              drawPill(sS.x + Math.cos(cDir) * cPillR, sS.y + Math.sin(cDir) * cPillR, linesC, ink, accent);
            }
            if (pendingCorner) {
              if (pendingCorner.sep && pendingCorner.sep.view) {
                markCornerVerticesInView(pendingCorner.candidates, pendingCorner.sep.view, true);
              }
            } else if (corner3) {
              var otherViewsC = (map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'])
                .filter(function (vr) { return vr !== corner3.viewRole; });
              highlightOtherViewsForEdges([corner3.edgeA, corner3.edgeB], corner3.viewRole, !!resolvedCorner);
              if (resolvedCorner) {
                otherViewsC.forEach(function (vr) { markCornerVerticesInView([corner3], vr, true); });
              }
            }
            ctx.restore();
            return true;
          }
          var rel = edgeRelation(a, b);
          if (!rel) return false;
          strokeEntity(a, ink, 1.6);
          strokeEntity(b, ink, 1.6);
          ctx.save();
          if (rel.kind === 'parallel') {
            var q1 = toPx(rel.p1), q2 = toPx(rel.p2);
            if (rel.ext) {
              ctx.strokeStyle = guide; ctx.lineWidth = 0.8; ctx.setLineDash([3, 4]);
              segment(toPx(rel.ext[0]), toPx(rel.ext[1]));
            }
            ctx.strokeStyle = accent; ctx.lineWidth = 1.2; ctx.setLineDash([]);
            segment(q1, q2);
            arrow(q2, q1); arrow(q1, q2);
            var pmx = (q1.x + q2.x) / 2, pmy = (q1.y + q2.y) / 2;
            var pdx = q2.x - q1.x, pdy = q2.y - q1.y, plen = Math.hypot(pdx, pdy) || 1;
            var pnx = -pdy / plen, pny = pdx / plen;
            var spLines = [number(rel.spacing, prefs) + ' mm · spacing'];
            if (Math.abs(rel.diff) > 0.05) spLines.push('ΔL ' + number(Math.abs(rel.diff), prefs) + ' mm');
            drawPill(pmx + pnx * 18, pmy + pny * 18, spLines, ink, accent);
          } else {
            var ipx = toPx({ x: rel.ix, y: rel.iy });
            var mapx = toPx(rel.ma), mbpx = toPx(rel.mb);
            var far = Math.hypot(ipx.x - mapx.x, ipx.y - mapx.y) > 260;
            var projAngleText = (SHORT_VIEW_CAP[role(a)] || 'Projected') + ' angle ' + formatAngleDeg(rel.angle, prefs.precision) + '°';
            if (!far) {
              var ang1 = Math.atan2(mapx.y - ipx.y, mapx.x - ipx.x);
              var ang2 = Math.atan2(mbpx.y - ipx.y, mbpx.x - ipx.x);
              var diff = ang2 - ang1;
              while (diff > Math.PI) diff -= 2 * Math.PI;
              while (diff < -Math.PI) diff += 2 * Math.PI;
              if (Math.abs(diff) > Math.PI / 2) {
                ang2 += Math.PI;
                diff = ang2 - ang1;
                while (diff > Math.PI) diff -= 2 * Math.PI;
                while (diff < -Math.PI) diff += 2 * Math.PI;
              }
              var arcR = 26;
              ctx.strokeStyle = guide; ctx.lineWidth = 0.75; ctx.setLineDash([3, 4]);
              segment(ipx, { x: ipx.x + Math.cos(ang1) * (arcR + 8), y: ipx.y + Math.sin(ang1) * (arcR + 8) });
              segment(ipx, { x: ipx.x + Math.cos(ang1 + diff) * (arcR + 8), y: ipx.y + Math.sin(ang1 + diff) * (arcR + 8) });
              ctx.strokeStyle = accent; ctx.lineWidth = 1.25; ctx.setLineDash([]);
              ctx.beginPath();
              ctx.arc(ipx.x, ipx.y, arcR, ang1, ang1 + diff, diff < 0);
              ctx.stroke();
              var midA = ang1 + diff / 2;
              drawPill(ipx.x + Math.cos(midA) * (arcR + 22), ipx.y + Math.sin(midA) * (arcR + 22), [projAngleText], ink, accent);
            } else {
              drawPill((mapx.x + mbpx.x) / 2, (mapx.y + mbpx.y) / 2, [projAngleText], ink, accent);
            }
          }
          ctx.restore();
          return true;
        }
        var ce = circleEdgeOffset(a, b);
        if (ce) {
          strokeEntity(a, ink, 1.6);
          strokeEntity(b, ink, 1.6);
          var cPx = toPx(ce.center), fPx = toPx(ce.foot);
          ctx.save();
          ctx.strokeStyle = guide; ctx.lineWidth = 0.85; ctx.setLineDash([]);
          segment({ x: cPx.x - 5, y: cPx.y }, { x: cPx.x + 5, y: cPx.y });
          segment({ x: cPx.x, y: cPx.y - 5 }, { x: cPx.x, y: cPx.y + 5 });
          if (ce.ext) {
            ctx.setLineDash([3, 4]);
            segment(toPx(ce.ext[0]), toPx(ce.ext[1]));
            ctx.setLineDash([]);
          }
          if (ce.offset > 0.05) {
            ctx.strokeStyle = accent; ctx.lineWidth = 1.2;
            segment(cPx, fPx);
            arrow(fPx, cPx); arrow(cPx, fPx);
            var cdx = fPx.x - cPx.x, cdy = fPx.y - cPx.y, clen = Math.hypot(cdx, cdy) || 1;
            var cnx = -cdy / clen, cny = cdx / clen;
            if (cny > 0) { cnx = -cnx; cny = -cny; }
            var ceLines = [number(ce.offset, prefs) + ' mm · center offset'];
            if (ce.tangency === 'tangent') ceLines.push('Tangent');
            else if (ce.tangency === 'extension') ceLines.push('Tangent to extension');
            drawPill((cPx.x + fPx.x) / 2 + cnx * 18, (cPx.y + fPx.y) / 2 + cny * 18, ceLines, ink, accent);
          } else {
            drawPill(cPx.x, cPx.y - 18, ['0 mm · center on line'], ink, accent);
          }
          ctx.restore();
          return true;
        }
        return false;
      }
      function label(anchor, lines, color, preferred, referenceBounds) {
        var width = Math.max.apply(null, lines.map(function (line) { return ctx.measureText(line).width; })) + 10;
        var height = lines.length * (prefs.textSize + 4) + 6;
        var candidates = preferred ? [[preferred.x, preferred.y - prefs.textSize - 3]] : [];
        [[12, -height - 10], [12, 12], [-width - 12, -height - 10], [-width - 12, 12], [-width / 2, -height - 28], [-width / 2, 28], [24, -height / 2], [-width - 24, -height / 2]].forEach(function (offset) { candidates.push([anchor.x + offset[0], anchor.y + offset[1]]); });
        if (referenceBounds) candidates = candidates.concat([
          [referenceBounds.x1 + 12, anchor.y - height / 2], [referenceBounds.x0 - width - 12, anchor.y - height / 2],
          [referenceBounds.x1 + 12, anchor.y - height - 10], [referenceBounds.x0 - width - 12, anchor.y - height - 10],
          [referenceBounds.x1 + 12, anchor.y + 12], [referenceBounds.x0 - width - 12, anchor.y + 12]
        ]);
        for (var i = 0; i < candidates.length; i++) {
          var x = candidates[i][0], y = candidates[i][1], rect = { x0: x - 3, y0: y - 3, x1: x + width + 3, y1: y + height + 3 };
          if (x < 6 || y < 6 || rect.x1 > view.w - 6 || rect.y1 > view.h - 6 || occupied.some(function (box) { return overlap(rect, box); })) continue;
          occupied.push(rect);
          ctx.strokeStyle = themeColor('viewFrame', '#a8b8c7'); ctx.lineWidth = 0.6;
          segment(anchor, { x: Math.max(x, Math.min(x + width, anchor.x)), y: Math.max(y, Math.min(y + height, anchor.y)) });
          ctx.fillStyle = themeColor('viewLabelBg', 'rgba(248, 250, 252, 0.97)'); ctx.fillRect(x, y, width, height); ctx.fillStyle = color; ctx.textAlign = 'left';
          lines.forEach(function (line, index) { ctx.fillText(line, x + 5, y + 3 + (prefs.textSize + 4) * (index + 0.5)); });
          return true;
        }
        suppressed++; return false;
      }

      var twoPinActive = pins.length === 2;
      var comparisonDrawn = false;
      if (twoPinActive) {
        var pinA = entities.find(function (e) { return e.id === pins[0].id; });
        var pinB = entities.find(function (e) { return e.id === pins[1].id; });
        if (pinA && pinB) comparisonDrawn = !!drawTwoPinComparison(pinA, pinB);
      }
      var suppressIndividuals = twoPinActive && comparisonDrawn && !prefs.comparisonDimensions;

      if (hover.id && !suppressIndividuals && !pins.some(function (p) { return p.id === hover.id; })) {
        var he = entities.find(function (e) { return e.id === hover.id; });
        if (he) {
          var alpha = Math.min(1, Math.max(0.2, (Date.now() - hover.enteredAt) / 115));
          var hColor = themeColor('viewInspect', '#415c74');
          ctx.save();
          ctx.globalAlpha = alpha;
          strokeEntity(he, hColor, 1.5);
          if (SPANS.indexOf(he.type) !== -1 && he.type !== 'DATUM_AXIS') {
            if (hover.stage === 'pulled') {
              var pulledRes = drawPulledEdgeDimension(he, hover.side, hover.offsetMm, hColor, true);
              if (pulledRes) hoverHit = { id: hover.id, side: hover.side, offsetMm: hover.offsetMm, dimSeg: pulledRes.dimSeg, pillRect: pulledRes.pillRect };
            } else {
              var eInfo = reconstructedEdgeInfo(he, handle.solidMm, map);
              var midPx = toPx({ x: (he.x + he.x2) / 2, y: (he.y + he.y2) / 2 });
              var aPx = toPx({ x: he.x, y: he.y }), bPx = toPx({ x: he.x2, y: he.y2 });
              var ddx = bPx.x - aPx.x, ddy = bPx.y - aPx.y, dl = Math.hypot(ddx, ddy) || 1;
              var nnx = -ddy / dl, nny = ddx / dl;
              if (nny > 0) { nnx = -nnx; nny = -nny; }
              var gLines = [eInfo && eInfo.foreshortened
                ? number(eInfo.projectedLength, prefs) + ' mm · ' + eInfo.viewLabel
                : number(Math.hypot(he.x2 - he.x, he.y2 - he.y), prefs) + ' mm'];
              if (hover.stage === 'linger') {
                if (eInfo && eInfo.established && eInfo.foreshortened) {
                  gLines.push(number(eInfo.trueLength, prefs) + ' mm · true length');
                  highlightOtherViewsForEdges(eInfo.edges, eInfo.role);
                } else if (eInfo && eInfo.established) {
                  highlightOtherViewsForEdges(eInfo.edges, eInfo.role);
                }
              }
              var gRect = drawPill(midPx.x + nnx * 16, midPx.y + nny * 16, gLines, hColor, themeColor('accent', '#0284c7'));
              hoverHit = { id: hover.id, side: 1, offsetMm: null, pillRect: gRect };
            }
          } else if (he.type === 'CIRCLE' || he.type === 'CIRCULAR_ARC') {
            var cPx = toPx(he);
            if (hover.stage === 'pulled' || hover.stage === 'linger') {
              var angR = hover.stage === 'pulled' ? hover.side : -Math.PI / 4;
              var rl = Measure.radiusLeaderLayout(he, view, {
                cursorPx: { x: cPx.x + Math.cos(angR) * 40, y: cPx.y + Math.sin(angR) * 40 },
                measure: function (t) { return ctx.measureText(t).width; }
              });
              if (rl) {
                ctx.strokeStyle = themeColor('viewGuide', '#8a9dad'); ctx.lineWidth = 0.85;
                rl.centerMark.forEach(function (pair) { segment(pair[0], pair[1]); });
                ctx.strokeStyle = hColor;
                segment(rl.rim, rl.elbow); segment(rl.elbow, rl.shelfEnd); arrow(rl.elbow, rl.rim);
                var cLines = ['R ' + number(he.radius, prefs) + ' mm'];
                if (he.type === 'CIRCLE') cLines.push('Ø ' + number(2 * he.radius, prefs) + ' mm');
                else cLines.push(number(Geometry.arcSweep(he.startAngle, he.endAngle), prefs) + '°');
                var cRect = drawPill((rl.elbow.x + rl.shelfEnd.x) / 2, rl.elbow.y - 12, cLines, hColor, themeColor('accent', '#0284c7'));
                hoverHit = { id: hover.id, side: hover.side, offsetMm: null, pillRect: cRect, radialSegs: [[rl.rim, rl.elbow], [rl.elbow, rl.shelfEnd]] };
              }
            } else {
              var cgRect = drawPill(cPx.x, cPx.y - he.radius * view.s - 14, ['R ' + number(he.radius, prefs) + ' mm'], hColor);
              hoverHit = { id: hover.id, side: 1, offsetMm: null, pillRect: cgRect };
            }
          } else if (he.type === 'POINT') {
            var pRect = drawPointOffsets(ctx, view, prefs, he, role(he), map, []);
            if (prefs.coordinates && prefs.labels) {
              var pPx = toPx(he);
              pRect = drawPill(pPx.x, pPx.y - 17, ['(' + number(he.x, prefs) + ', ' + number(he.y, prefs) + ') mm'], hColor);
            }
            if (hover.stage !== 'glance') highlightOtherViewsForPoint(he);
            hoverHit = pRect ? { id: hover.id, side: 1, offsetMm: null, pillRect: pRect } : null;
          }
          ctx.restore();
        }
      }

      var items = suppressIndividuals ? [] : overlayItems(entities, handle.measure.inspectId, handle.measure.inspectSide, pins, prefs);
      if (!suppressIndividuals && twoPinActive) {
        pins.forEach(function (pin) {
          if (items.some(function (item) { return item.entity.id === pin.id; })) return;
          var pe = entities.find(function (e) { return e.id === pin.id; });
          if (pe && Measure.inspectEntity(pe)) items.push({ entity: pe, side: pin.side, focused: true, offsetMm: pin.offsetMm || null });
        });
      }
      items.forEach(function (item) {
        var e = item.entity, spec = record(e.id), anchor = Measure.inspectAnchor(e, view); if (!spec || !anchor) return;
        var color = e.id === handle.measure.inspectId || pins.some(function (p) { return p.id === e.id; })
          ? themeColor('viewInspect', '#415c74') : themeColor('viewMuted', '#7d8997');
        strokeEntity(e, color, item.focused ? 1.5 : 0.75);
        if (item.focused && prefs.dimensions) {
          if (SPANS.indexOf(e.type) !== -1 && prefs.lengths && e.type !== 'LINE' && e.type !== 'RAY' && e.type !== 'DATUM_AXIS') {
            var isSinglePinned = pins.length === 1 && pins[0].id === e.id;
            drawPulledEdgeDimension(e, item.side, item.offsetMm, color, true, isSinglePinned);
            return;
          } else if ((e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') && prefs.radii) {
            var radial = Measure.radiusLeaderLayout(e, view, { measure: function (text) { return ctx.measureText(text).width; } });
            if (radial) {
              ctx.lineWidth = 0.85; ctx.strokeStyle = themeColor('viewGuide', '#8a9dad');
              radial.centerMark.forEach(function (pair) { segment(pair[0], pair[1]); });
              ctx.strokeStyle = color;
              segment(radial.rim, radial.elbow); segment(radial.elbow, radial.shelfEnd); arrow(radial.elbow, radial.rim);
              if (prefs.labels) drawPill((radial.elbow.x + radial.shelfEnd.x) / 2, radial.elbow.y - 10,
                ['R ' + number(e.radius, prefs) + ' mm'], color);
              var sweep = e.type === 'CIRCULAR_ARC' ? Geometry.arcSweep(e.startAngle, e.endAngle) : null;
              function rimPoint(angle, radius) {
                return { x: anchor.x + Math.cos(angle * Geometry.RAD) * radius, y: anchor.y - Math.sin(angle * Geometry.RAD) * radius };
              }
              var radiusPx = e.radius * view.s;
              var midAngle = sweep === null ? 225 : e.startAngle + sweep / 2;
              var curvePoint = rimPoint(midAngle, radiusPx);
              if (sweep !== null && prefs.lengths) {
                drawSheetGuide(ctx, view, prefs, rimPoint(e.startAngle, radiusPx), rimPoint(e.endAngle, radiusPx),
                  'Chord ' + number(2 * e.radius * Math.sin(sweep * Geometry.RAD / 2), prefs) + ' mm', color, []);
              }
              if (sweep !== null && prefs.angles) {
                var arcRadius = Math.min(22, radiusPx / 2);
                ctx.beginPath(); ctx.arc(anchor.x, anchor.y, arcRadius, -e.startAngle * Geometry.RAD, -(e.startAngle + sweep) * Geometry.RAD, true); ctx.stroke();
                segment(anchor, rimPoint(e.startAngle, arcRadius + 3)); segment(anchor, rimPoint(e.endAngle, arcRadius + 3));
                if (prefs.labels) {
                  var sweepPoint = rimPoint(midAngle, arcRadius);
                  label(sweepPoint, [number(sweep, prefs) + '° sweep'], color, null, bounds[spec.role]);
                }
              }
              if (prefs.labels) {
                var centerRows = spec.rows.filter(function (row) { return row[0] === 'Center' || row[0] === 'Circle area'; });
                if (centerRows.length) label(anchor, centerRows.map(function (row) { return row[0] + ' ' + row[1]; }), color, null, bounds[spec.role]);
                var rimRows = spec.rows.filter(function (row) { return row[0] === 'Arc length' || row[0] === 'Circumference' || (row[0] === 'Diameter' && sweep === null); });
                if (rimRows.length) label(curvePoint, rimRows.map(function (row) { return row[0] + ' ' + row[1]; }), color, null, bounds[spec.role]);
              }
              return;
            }
          } else if (e.type === 'POINT' && prefs.offsets && role(e) !== 'SHARED') {
            var used = [];
            var physical = reconstructedPoint3D(e, handle.solidMm, map);
            if (physical && prefs.links && (role(e) === 'PLAN' || role(e) === 'ELEVATION')) {
              drawProjectedOffsets(ctx, view, prefs, physical, map, used);
            } else {
              drawPointOffsets(ctx, view, prefs, e, role(e), map, used);
            }
            occupied.push.apply(occupied, used);
            highlightOtherViewsForPoint(e);
            if (prefs.labels && prefs.coordinates) label(anchor, [spec.title, '(' + number(e.x, prefs) + ', ' + number(e.y, prefs) + ') mm'], color, null, bounds[spec.role]);
            return;
          }
        }
        if (prefs.labels) {
          var lines = [spec.title + ' · ' + VIEW_NAMES[spec.role].split(' · ')[0]].concat(compactRows(spec, item.focused).map(function (row) { return row[0] + ' ' + row[1]; }));
          if (lines.length > 1) label(anchor, lines, color, null, bounds[spec.role]);
        }
      });
      ctx.restore();
      if (labelNote) {
        labelNote.hidden = !prefs.labels || !suppressed;
        if (suppressed) {
          var noteText = '+' + suppressed + ' label' + (suppressed === 1 ? '' : 's') + ' in Index';
          if (labelNote.textContent !== noteText) labelNote.textContent = noteText;
        }
      }
    }
    function clear() {
      pins = [];
      resolvedPoseEdge = null;
      overlapNarrowing = null;
      resolvedPoseCorner = null;
      cornerOverlapNarrowing = null;
      resolvedPoseSpan = null;
      spanOverlapState = null;
      clearHover(false);
      options.select(null, null);
      renderInventory(); renderSelection(); renderPins(); sync(); options.redraw();
    }
    return {
      panel: panel, sheet: sheet, sync: sync, activate: activate, clear: clear,
      modeChanged: sync, selectionChanged: function () { activate('sheet'); sync(); },
      pointerMove: pointerMove, pointerLeave: pointerLeave, clickSheet: clickSheet,
      hitTestHover: hitTestHover, hitTestOverlapChoice: hitTestOverlapChoice,
      hasPendingOverlap: hasPendingOverlap,
      trackedPoseEdge: trackedPoseEdge, trackedPoseCorner: trackedPoseCorner,
      trackedPoseSpan: trackedPoseSpan, trackedPosePoint: trackedPosePoint,
      activeHover: function () { return { id: hover.id, stage: hover.stage, side: hover.side, offsetMm: hover.offsetMm }; },
      setPreferences: setPreferences, setPanelVisible: setPanelVisible, preferences: function () { return Object.assign({}, prefs); },
      pins: function () { return pins.map(function (pin) { return Object.assign({}, pin); }); },
      linksEnabled: function () { return handle.measure.mode !== 'view' || prefs.links; },
      drawOverlay: drawOverlay
    };
  }
  return {
    role: role, title: title, specs: specs, inventory: inventory, togglePin: togglePin,
    overlayItems: overlayItems, comparison: comparison, viewBounds: viewBounds,
    reconstructedEdgeInfo: reconstructedEdgeInfo, reconstructedCornerInfo: reconstructedCornerInfo,
    reconstructedPointPairInfo: reconstructedPointPairInfo,
    findSeparatingView: findSeparatingView, findSeparatingViewForCorners: findSeparatingViewForCorners,
    findSeparatingViewForVertices: findSeparatingViewForVertices,
    physicalEdgeLabel: physicalEdgeLabel, edgeCalloutLines: edgeCalloutLines,
    cornerAngleCallout: cornerAngleCallout, pointSpanCalloutLines: pointSpanCalloutLines,
    poseEdgeProjectionLabel: poseEdgeProjectionLabel, hitTestPoseEdgeTargets: hitTestPoseEdgeTargets,
    parallelSpacing: parallelSpacing, edgeRelation: edgeRelation, circleEdgeOffset: circleEdgeOffset,
    drawProjectedOffsets: drawProjectedOffsets, drawComponents: drawComponents,
    toView3D: toView3D, mount: mount
  };
});

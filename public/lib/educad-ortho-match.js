(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-measure.js'), require('./educad-geometry.js'), require('./educad-settings.js'));
  else root.EduCADOrthoMatch = factory(root.EduCADMeasure, root.EduCADGeometry, root.EduCADSettings);
})(typeof window !== 'undefined' ? window : globalThis, function (Measure, Geometry, Settings) {
  'use strict';
  var SPANS = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION', 'DATUM_AXIS'];
  var TYPES = { POINT: 'Point', SEGMENT: 'Segment', LINE: 'Line', RAY: 'Ray', DIMENSION: 'Dimension', DATUM_AXIS: 'Datum', CIRCLE: 'Circle', CIRCULAR_ARC: 'Arc' };
  var VIEW_NAMES = { ELEVATION: 'Front · VP', PLAN: 'Top · HP', PROFILE: 'Side · profile', SHARED: 'Shared / XY' };
  var SHORT_VIEW = { ELEVATION: 'front view', PLAN: 'top view', PROFILE: 'side view', SHARED: 'XY' };
  var SHORT_VIEW_CAP = { ELEVATION: 'Front', PLAN: 'Top', PROFILE: 'Side', SHARED: 'XY' };
  var EPS = 1e-6;
  var MATCH_EPS = 1e-2;

  function number(n, prefs) { return String(Number(n.toFixed(prefs.precision))); }
  function role(e) {
    if (['ELEVATION', 'PLAN', 'PROFILE'].indexOf(e.viewRole) !== -1) return e.viewRole;
    if (e.type === 'DATUM_AXIS' || (e.y === 0 && (e.y2 === undefined || e.y2 === 0)) ||
        (SPANS.indexOf(e.type) !== -1 && e.y * e.y2 < 0)) return 'SHARED';
    return e.y < 0 ? 'PLAN' : 'ELEVATION';
  }
  function category(e) { return e.type === 'POINT' ? 'points' : SPANS.indexOf(e.type) !== -1 ? 'lines' : 'curves'; }
  function construction(e) {
    return e.type === 'DATUM_AXIS' || ['G', 'H', 'K'].indexOf(e.bisCode) !== -1 ||
      !!(e.meta && ['axis', 'locus', 'projector', 'construction'].indexOf(e.meta.kind) !== -1);
  }
  function toView3D(v, r, map) {
    if (r === 'PLAN') return { x: v.x, y: -v.z };
    if (r === 'PROFILE' && map && map.three) return { x: map.xRef + map.s * (v.z - map.dRef), y: v.y };
    return { x: v.x, y: v.y };
  }
  function near2(a, b, tol) {
    return Math.hypot(a.x - b.x, a.y - b.y) <= (tol || MATCH_EPS);
  }
  function sameProjectedSpan(a1, a2, b1, b2, tol) {
    return (near2(a1, b1, tol) && near2(a2, b2, tol)) || (near2(a1, b2, tol) && near2(a2, b1, tol));
  }
  function parsePointBases(caption) {
    if (caption === undefined || caption === null) return [];
    var out = [];
    String(caption).split(',').forEach(function (part) {
      var s = part.trim().replace(/^\((.*)\)$/, '$1').trim().replace(/['′’"″]+$/g, '').trim();
      if (!s) return;
      if (/^[a-z]+[0-9]*$/i.test(s)) s = s.toUpperCase();
      if (out.indexOf(s) === -1) out.push(s);
    });
    return out;
  }
  function vertexLabel3D(v, solidMm, entities, map) {
    if (!v || !Array.isArray(entities)) return '';
    var views = map && map.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
    var viewSets = [];
    views.forEach(function (vr) {
      var proj = toView3D(v, vr, map);
      var stackCount = 0;
      if (solidMm && Array.isArray(solidMm.vertices)) {
        for (var k = 0; k < solidMm.vertices.length; k++) {
          if (near2(toView3D(solidMm.vertices[k], vr, map), proj, MATCH_EPS)) stackCount++;
        }
      }
      var found = [];
      entities.forEach(function (ent) {
        if (!ent || ent.type !== 'POINT' || ent.visible === false || role(ent) !== vr) return;
        if (!near2(ent, proj, MATCH_EPS)) return;
        parsePointBases(ent.caption || ent.name).forEach(function (b) {
          if (found.indexOf(b) === -1) found.push(b);
        });
      });
      if (found.length) viewSets.push({ names: found, stacked: stackCount > 1 });
    });
    if (!viewSets.length) return '';
    for (var u = 0; u < viewSets.length; u++) {
      if (!viewSets[u].stacked && viewSets[u].names.length === 1) return viewSets[u].names[0];
    }
    if (viewSets.length >= 2) {
      var common = viewSets[0].names.slice();
      for (var i = 1; i < viewSets.length; i++) {
        common = common.filter(function (name) { return viewSets[i].names.indexOf(name) !== -1; });
      }
      if (common.length === 1) return common[0];
    }
    return '';
  }
  function physicalEdgeLabel(edgeIndex, solidMm, entities, map, reversed) {
    if (solidMm && Array.isArray(solidMm.edges) && Array.isArray(solidMm.vertices)) {
      var edge = solidMm.edges[edgeIndex];
      if (edge) {
        var va = solidMm.vertices[reversed ? edge[1] : edge[0]];
        var vb = solidMm.vertices[reversed ? edge[0] : edge[1]];
        var na = vertexLabel3D(va, solidMm, entities, map);
        var nb = vertexLabel3D(vb, solidMm, entities, map);
        if (na && nb && na !== nb) return na + '–' + nb;
      }
    }
    return 'Edge ' + (edgeIndex + 1);
  }
  function findSeparatingView(edgeDetails, solidMm, excludeRoles, map) {
    var none = { view: null, label: '', kind: 'none', groups: 1 };
    if (!edgeDetails || edgeDetails.length < 2 || !solidMm || !solidMm.vertices || !solidMm.edges) return none;
    var excluded = Array.isArray(excludeRoles) ? excludeRoles : (excludeRoles ? [excludeRoles] : []);
    var primary = excluded[0] || '';
    var order = primary === 'ELEVATION' ? ['PLAN', 'PROFILE', 'ELEVATION']
      : primary === 'PLAN' ? ['ELEVATION', 'PROFILE', 'PLAN']
      : ['PLAN', 'ELEVATION', 'PROFILE'];
    var partial = null;
    for (var vi = 0; vi < order.length; vi++) {
      var vr = order[vi];
      if (excluded.indexOf(vr) !== -1) continue;
      if (vr === 'PROFILE' && (!map || !map.three)) continue;
      var projs = edgeDetails.map(function (d) {
        var edge = solidMm.edges[d.index];
        return [toView3D(solidMm.vertices[edge[0]], vr, map), toView3D(solidMm.vertices[edge[1]], vr, map)];
      });
      var distinctGroups = 0;
      for (var i = 0; i < projs.length; i++) {
        var dup = false;
        for (var j = 0; j < i; j++) {
          if (sameProjectedSpan(projs[i][0], projs[i][1], projs[j][0], projs[j][1], MATCH_EPS)) { dup = true; break; }
        }
        if (!dup) distinctGroups++;
      }
      if (distinctGroups === projs.length) {
        return { view: vr, label: SHORT_VIEW[vr] || '', kind: 'full', groups: distinctGroups };
      }
      if (distinctGroups > 1 && !partial) {
        partial = { view: vr, label: SHORT_VIEW[vr] || '', kind: 'partial', groups: distinctGroups };
      }
    }
    return partial || none;
  }
  function reconstructedEdgeInfo(e, solidMm, map) {
    if (!e || SPANS.indexOf(e.type) === -1 || e.type === 'LINE' || e.type === 'RAY' || e.type === 'DATUM_AXIS') return null;
    var r = role(e);
    var projectedLength = Math.hypot(e.x2 - e.x, e.y2 - e.y);
    var base = {
      established: false,
      foreshortened: false,
      projectedLength: projectedLength,
      trueLength: null,
      edges: [],
      edgeDetails: [],
      overlapCount: 0,
      separatingView: null,
      separatingLabel: '',
      separationKind: 'none',
      uniqueEdge: null,
      uniqueReversed: false,
      role: r,
      viewLabel: SHORT_VIEW[r] || ''
    };
    if (!solidMm || !Array.isArray(solidMm.vertices) || !Array.isArray(solidMm.edges) || r === 'SHARED') return base;
    if (r === 'PROFILE' && (!map || !map.three)) return base;
    var ea = { x: e.x, y: e.y }, eb = { x: e.x2, y: e.y2 };
    var matched = [], details = [];
    for (var i = 0; i < solidMm.edges.length; i++) {
      var edge = solidMm.edges[i];
      var va = solidMm.vertices[edge[0]], vb = solidMm.vertices[edge[1]];
      if (!va || !vb) continue;
      var pa = toView3D(va, r, map), pb = toView3D(vb, r, map);
      var forward = near2(pa, ea, MATCH_EPS) && near2(pb, eb, MATCH_EPS);
      var reverse = !forward && near2(pa, eb, MATCH_EPS) && near2(pb, ea, MATCH_EPS);
      if (forward || reverse) {
        var len3 = Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
        matched.push(i);
        details.push({ index: i, reversed: reverse, trueLength: len3 });
      }
    }
    if (!matched.length) return base;
    base.edges = matched;
    base.edgeDetails = details;
    base.overlapCount = matched.length;
    if (matched.length === 1) {
      base.uniqueEdge = details[0].index;
      base.uniqueReversed = details[0].reversed;
    } else {
      var sep = findSeparatingView(details, solidMm, [r], map);
      base.separatingView = sep.view;
      base.separatingLabel = sep.label;
      base.separationKind = sep.kind;
    }
    var firstL = details[0].trueLength, allSame = true;
    for (var j = 1; j < details.length; j++) {
      if (Math.abs(details[j].trueLength - firstL) > 0.05) { allSame = false; break; }
    }
    if (allSame) {
      base.established = true;
      base.trueLength = firstL;
      base.foreshortened = (firstL - projectedLength) > 0.05;
    }
    return base;
  }
  function edgeCalloutLines(opts) {
    opts = opts || {};
    var prec = typeof opts.precision === 'number' ? opts.precision : 2;
    var fmt = function (n) { return String(Number(n.toFixed(prec))); };
    var projLen = typeof opts.projLen === 'number' ? opts.projLen : 0;
    var trueLen = typeof opts.trueLen === 'number' ? opts.trueLen : null;
    var restTrueLen = typeof opts.restTrueLen === 'number' ? opts.restTrueLen : trueLen;
    var scale = typeof opts.scale === 'number' ? opts.scale : 1;
    var scaled = Math.abs(scale - 1) > 0.005;
    var viewTitle = opts.viewTitle || SHORT_VIEW_CAP[opts.viewRole] || '';
    var prefix = opts.name ? (opts.name + (viewTitle ? ' · ' + viewTitle + ' ' : ' · ')) : (viewTitle ? viewTitle + ' ' : '');
    var hasTrue = trueLen !== null && trueLen > 1e-6;
    var scaleTxt = String(Number(scale.toFixed(2))) + '×';
    var trueLine = hasTrue
      ? (scaled
          ? ('True length ' + fmt(restTrueLen) + ' → ' + fmt(trueLen) + ' mm at ' + scaleTxt)
          : ('True length ' + fmt(trueLen) + ' mm'))
      : '';
    var ratio = hasTrue ? (projLen / trueLen) : 1;
    var aligned = projLen <= 1e-5 || (hasTrue && ratio <= 1e-5);
    if (aligned) {
      var ptLines = [prefix + '0 mm · point view'];
      if (trueLine) ptLines.push(trueLine);
      return { kind: 'point', shortText: '0 mm', lines: ptLines, pointMarker: true };
    }
    var nearEndOn = hasTrue && ratio <= 0.05;
    var smallOnScreen = typeof opts.projPx === 'number' ? opts.projPx < 10 : nearEndOn;
    if (nearEndOn) {
      var minStep = Math.pow(10, -prec);
      var rounded = Number(projLen.toFixed(prec));
      var valText = rounded === 0
        ? ('< ' + (prec > 0 ? minStep.toFixed(prec) : '1') + ' mm')
        : (projLen.toFixed(prec) + ' mm');
      var nearLines = [prefix + valText + ' · near end-on'];
      if (trueLine) nearLines.push(trueLine);
      return { kind: 'near-end-on', shortText: valText, lines: nearLines, pointMarker: smallOnScreen };
    }
    var spanVal = fmt(projLen) + ' mm';
    if (hasTrue && Math.abs(trueLen - projLen) <= 0.05) {
      var fullLines = [prefix + spanVal + ' · true length'];
      if (scaled) fullLines.push(fmt(restTrueLen) + ' → ' + fmt(trueLen) + ' mm at ' + scaleTxt);
      return { kind: 'true-length', shortText: spanVal, lines: fullLines, pointMarker: smallOnScreen };
    }
    var spanLines = [prefix + spanVal];
    if (trueLine) spanLines.push(trueLine);
    return { kind: hasTrue ? 'foreshortened' : 'span', shortText: spanVal, lines: spanLines, pointMarker: smallOnScreen };
  }
  function poseEdgeProjectionLabel(projLen, trueLen, viewLabel, precision, projPx) {
    var prec = typeof precision === 'number' ? precision : 2;
    var ratio = trueLen > 1e-6 ? (projLen / trueLen) : 1;
    var aligned = projLen <= 1e-5 || (trueLen > 1e-6 && ratio <= 1e-5);
    if (aligned) {
      return { kind: 'point', shortText: '0 mm', text: '0 mm · point view', pointMarker: true };
    }
    var nearEndOn = trueLen > 1e-6 && ratio <= 0.05;
    var smallOnScreen = typeof projPx === 'number' ? projPx < 10 : nearEndOn;
    if (nearEndOn) {
      var minStep = Math.pow(10, -prec);
      var rounded = Number(projLen.toFixed(prec));
      var valText = rounded === 0
        ? ('< ' + (prec > 0 ? minStep.toFixed(prec) : '1') + ' mm')
        : (projLen.toFixed(prec) + ' mm');
      return { kind: 'near-end-on', shortText: valText, text: valText + ' · near end-on', pointMarker: smallOnScreen };
    }
    var spanVal = String(Number(projLen.toFixed(prec))) + ' mm';
    return { kind: 'span', shortText: spanVal, text: spanVal + ' · ' + (viewLabel || ''), pointMarker: smallOnScreen };
  }
  function formatAngleDeg(deg, precision) {
    var prec = Math.min(typeof precision === 'number' ? precision : 1, 1);
    var v = Number(deg.toFixed(prec));
    if (Object.is(v, -0)) v = 0;
    return String(v);
  }
  function findSeparatingViewForCorners(candidates, solidMm, excludeRoles, map) {
    var none = { view: null, label: '', kind: 'none', groups: 1 };
    if (!candidates || candidates.length < 2 || !solidMm || !solidMm.vertices) return none;
    var excluded = Array.isArray(excludeRoles) ? excludeRoles : (excludeRoles ? [excludeRoles] : []);
    var primary = excluded[0] || '';
    var order = primary === 'ELEVATION' ? ['PLAN', 'PROFILE', 'ELEVATION']
      : primary === 'PLAN' ? ['ELEVATION', 'PROFILE', 'PLAN']
      : ['PLAN', 'ELEVATION', 'PROFILE'];
    var partial = null;
    for (var vi = 0; vi < order.length; vi++) {
      var vr = order[vi];
      if (excluded.indexOf(vr) !== -1) continue;
      if (vr === 'PROFILE' && (!map || !map.three)) continue;
      var projs = candidates.map(function (c) {
        return toView3D(solidMm.vertices[c.vertexIndex], vr, map);
      });
      var distinctGroups = 0;
      for (var i = 0; i < projs.length; i++) {
        var dup = false;
        for (var j = 0; j < i; j++) {
          if (near2(projs[i], projs[j], MATCH_EPS)) { dup = true; break; }
        }
        if (!dup) distinctGroups++;
      }
      if (distinctGroups === projs.length) {
        return { view: vr, label: SHORT_VIEW_CAP[vr] || '', kind: 'full', groups: distinctGroups };
      }
      if (distinctGroups > 1 && !partial) {
        partial = { view: vr, label: SHORT_VIEW_CAP[vr] || '', kind: 'partial', groups: distinctGroups };
      }
    }
    return partial || none;
  }
  function reconstructedCornerInfo(a, b, solidMm, entities, map, preferredEdges) {
    if (!a || !b || !solidMm || !Array.isArray(solidMm.vertices) || !Array.isArray(solidMm.edges)) return null;
    if (SPANS.indexOf(a.type) === -1 || SPANS.indexOf(b.type) === -1) return null;
    if (a.type === 'LINE' || a.type === 'RAY' || a.type === 'DATUM_AXIS') return null;
    if (b.type === 'LINE' || b.type === 'RAY' || b.type === 'DATUM_AXIS') return null;
    var r = role(a);
    if (r !== role(b) || r === 'SHARED') return null;
    if (r === 'PROFILE' && (!map || !map.three)) return null;
    var infoA = reconstructedEdgeInfo(a, solidMm, map);
    var infoB = reconstructedEdgeInfo(b, solidMm, map);
    if (!infoA || !infoB || !infoA.edges.length || !infoB.edges.length) return null;
    var listA = infoA.edges, listB = infoB.edges;
    if (preferredEdges && typeof preferredEdges.a === 'number' && listA.indexOf(preferredEdges.a) !== -1) {
      listA = [preferredEdges.a];
    }
    if (preferredEdges && typeof preferredEdges.b === 'number' && listB.indexOf(preferredEdges.b) !== -1) {
      listB = [preferredEdges.b];
    }
    var pairs = [], seen = {};
    for (var i = 0; i < listA.length; i++) {
      var idxA = listA[i], eA = solidMm.edges[idxA];
      if (!eA) continue;
      for (var j = 0; j < listB.length; j++) {
        var idxB = listB[j], eB = solidMm.edges[idxB];
        if (!eB || idxA === idxB) continue;
        var sharedIdx = -1, otherA = -1, otherB = -1, revA = false, revB = false;
        var matchPairs = [
          [eA[0], eA[1], eB[0], eB[1], false, false],
          [eA[0], eA[1], eB[1], eB[0], false, true],
          [eA[1], eA[0], eB[0], eB[1], true, false],
          [eA[1], eA[0], eB[1], eB[0], true, true]
        ];
        for (var m = 0; m < matchPairs.length; m++) {
          var mp = matchPairs[m];
          if (mp[0] === mp[2]) {
            sharedIdx = mp[0]; otherA = mp[1]; otherB = mp[3]; revA = mp[4]; revB = mp[5];
            break;
          }
          var v1 = solidMm.vertices[mp[0]], v2 = solidMm.vertices[mp[2]];
          if (v1 && v2 && Math.hypot(v1.x - v2.x, v1.y - v2.y, v1.z - v2.z) <= MATCH_EPS) {
            sharedIdx = mp[0]; otherA = mp[1]; otherB = mp[3]; revA = mp[4]; revB = mp[5];
            break;
          }
        }
        if (sharedIdx === -1) continue;
        var key = sharedIdx + ':' + Math.min(idxA, idxB) + ':' + Math.max(idxA, idxB);
        if (seen[key]) continue;
        seen[key] = true;
        var vS = solidMm.vertices[sharedIdx], vA = solidMm.vertices[otherA], vB = solidMm.vertices[otherB];
        if (!vS || !vA || !vB) continue;
        var ax = vA.x - vS.x, ay = vA.y - vS.y, az = vA.z - vS.z;
        var bx = vB.x - vS.x, by = vB.y - vS.y, bz = vB.z - vS.z;
        var la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
        if (la < EPS || lb < EPS) continue;
        var uA = { x: ax / la, y: ay / la, z: az / la };
        var uB = { x: bx / lb, y: by / lb, z: bz / lb };
        var dot3 = Math.max(-1, Math.min(1, uA.x * uB.x + uA.y * uB.y + uA.z * uB.z));
        var angle3D = Math.acos(dot3) / Geometry.RAD;
        var pS = toView3D(vS, r, map), pA = toView3D(vA, r, map), pB = toView3D(vB, r, map);
        var pAx = pA.x - pS.x, pAy = pA.y - pS.y, pBx = pB.x - pS.x, pBy = pB.y - pS.y;
        var pLa = Math.hypot(pAx, pAy), pLb = Math.hypot(pBx, pBy);
        var projAngle = (pLa > EPS && pLb > EPS)
          ? Math.acos(Math.max(-1, Math.min(1, (pAx * pBx + pAy * pBy) / (pLa * pLb)))) / Geometry.RAD
          : null;
        pairs.push({
          viewRole: r,
          viewLabel: SHORT_VIEW[r] || '',
          vertexIndex: sharedIdx,
          vertexLabel: vertexLabel3D(vS, solidMm, entities, map),
          edgeA: idxA,
          edgeB: idxB,
          otherA: otherA,
          otherB: otherB,
          labelA: physicalEdgeLabel(idxA, solidMm, entities, map, revA),
          labelB: physicalEdgeLabel(idxB, solidMm, entities, map, revB),
          angle3D: angle3D,
          projectedAngle: projAngle
        });
      }
    }
    if (!pairs.length) return null;
    if (pairs.length === 1) {
      var only = pairs[0];
      return Object.assign({}, only, {
        unique: true,
        overlapCount: 1,
        candidates: pairs,
        separatingView: null,
        separatingLabel: '',
        separationKind: 'none'
      });
    }
    var first3D = pairs[0].angle3D;
    var common3D = pairs.every(function (p) { return Math.abs(p.angle3D - first3D) <= 0.1; }) ? first3D : null;
    var firstProj = pairs[0].projectedAngle;
    var commonProj = firstProj !== null && pairs.every(function (p) {
      return p.projectedAngle !== null && Math.abs(p.projectedAngle - firstProj) <= 0.1;
    }) ? firstProj : null;
    var sep = findSeparatingViewForCorners(pairs, solidMm, [r], map);
    return {
      viewRole: r,
      viewLabel: SHORT_VIEW[r] || '',
      unique: false,
      overlapCount: pairs.length,
      candidates: pairs,
      separatingView: sep.view,
      separatingLabel: sep.label,
      separationKind: sep.kind,
      vertexIndex: null,
      vertexLabel: '',
      edgeA: null,
      edgeB: null,
      otherA: null,
      otherB: null,
      labelA: '',
      labelB: '',
      angle3D: common3D,
      projectedAngle: commonProj
    };
  }
  function cornerAngleCallout(opts) {
    opts = opts || {};
    var viewRole = opts.viewRole || 'ELEVATION';
    var map = opts.map || { three: false };
    var vS = opts.vShared, vA = opts.va, vB = opts.vb;
    var pS = opts.pShared || (vS ? toView3D(vS, viewRole, map) : null);
    var pA = opts.pA || (vA ? toView3D(vA, viewRole, map) : null);
    var pB = opts.pB || (vB ? toView3D(vB, viewRole, map) : null);
    if (!pS || !pA || !pB) return null;
    var trueA = (vS && vA) ? Math.hypot(vA.x - vS.x, vA.y - vS.y, vA.z - vS.z) : null;
    var trueB = (vS && vB) ? Math.hypot(vB.x - vS.x, vB.y - vS.y, vB.z - vS.z) : null;
    var dxA = pA.x - pS.x, dyA = pA.y - pS.y, projA = Math.hypot(dxA, dyA);
    var dxB = pB.x - pS.x, dyB = pB.y - pS.y, projB = Math.hypot(dxB, dyB);
    var endOnA = projA <= 1e-5 || (trueA !== null && trueA > 1e-6 && projA / trueA <= 1e-5);
    var endOnB = projB <= 1e-5 || (trueB !== null && trueB > 1e-6 && projB / trueB <= 1e-5);
    var angle3D = typeof opts.angle3D === 'number' ? opts.angle3D : null;
    if (angle3D === null && vS && vA && vB && trueA > EPS && trueB > EPS) {
      var d3 = ((vA.x - vS.x) * (vB.x - vS.x) + (vA.y - vS.y) * (vB.y - vS.y) + (vA.z - vS.z) * (vB.z - vS.z)) / (trueA * trueB);
      angle3D = Math.acos(Math.max(-1, Math.min(1, d3))) / Geometry.RAD;
    }
    var prec = typeof opts.precision === 'number' ? opts.precision : 1;
    var viewTitle = opts.viewTitle || SHORT_VIEW_CAP[viewRole] || 'View';
    var line3D = angle3D !== null ? ('3D angle ' + formatAngleDeg(angle3D, prec) + '°') : '';
    if (endOnA && endOnB) {
      var bothLines = [(opts.labelA || 'Edge 1') + ' & ' + (opts.labelB || 'Edge 2') + ' are end-on'];
      if (line3D) bothLines.push(line3D);
      return { kind: 'both-end-on', endOn: 'both', pointMarker: true, projAngle: null, angle3D: angle3D, shortText: 'end-on', lines: bothLines };
    }
    if (endOnA || endOnB) {
      var endName = endOnA ? (opts.labelA || 'Edge 1') : (opts.labelB || 'Edge 2');
      var endLines = [endName + ' is end-on'];
      if (line3D) endLines.push(line3D);
      return { kind: 'end-on', endOn: endOnA ? 'A' : 'B', pointMarker: true, projAngle: null, angle3D: angle3D, shortText: 'end-on', lines: endLines };
    }
    var dot2 = Math.max(-1, Math.min(1, (dxA * dxB + dyA * dyB) / (projA * projB)));
    var projAngle = Math.acos(dot2) / Geometry.RAD;
    var degTxt = formatAngleDeg(projAngle, prec) + '°';
    var lines = [viewTitle + ' angle ' + degTxt];
    var differs = angle3D !== null && Math.abs(angle3D - projAngle) > 0.1;
    if (differs) lines.push(line3D);
    return { kind: differs ? 'projected-differs' : 'projected-true', endOn: null, pointMarker: false, projAngle: projAngle, angle3D: angle3D, shortText: degTxt, lines: lines };
  }
  function hitTestPoseEdgeTargets(cursorPx, targets, tolPx) {
    if (!cursorPx || !Array.isArray(targets) || !targets.length) return null;
    var tol = typeof tolPx === 'number' && tolPx > 0 ? tolPx : 14;
    var tagBest = null, tagBestDist = Infinity;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t || !t.tagRect) continue;
      var r = t.tagRect;
      if (cursorPx.x >= r.x0 - 5 && cursorPx.x <= r.x1 + 5 &&
          cursorPx.y >= r.y0 - 5 && cursorPx.y <= r.y1 + 5) {
        var cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
        var td = Math.hypot(cursorPx.x - cx, cursorPx.y - cy);
        if (!tagBest || (tagBest.active && !t.active) || (tagBest.active === t.active && td < tagBestDist)) {
          tagBest = t; tagBestDist = td;
        }
      }
    }
    if (tagBest) return tagBest.viewRole;
    var best = null, bestDist = tol;
    for (var j = 0; j < targets.length; j++) {
      var item = targets[j];
      if (!item || !item.p0 || !item.p1) continue;
      var d = item.isPoint
        ? Math.hypot(cursorPx.x - item.p0.x, cursorPx.y - item.p0.y)
        : Geometry.spanDistance(cursorPx, item.p0, item.p1, 'SEGMENT');
      if (d <= tol && (!best || d < bestDist - 0.5 || (Math.abs(d - bestDist) <= 0.5 && best.active && !item.active))) {
        best = item; bestDist = d;
      }
    }
    return best ? best.viewRole : null;
  }
  function matchedVerticesForPoint(pt, solidMm, r, map) {
    if (!pt || !solidMm || !Array.isArray(solidMm.vertices)) return [];
    if (r === 'SHARED' || (r === 'PROFILE' && (!map || !map.three))) return [];
    var out = [];
    for (var i = 0; i < solidMm.vertices.length; i++) {
      var v = solidMm.vertices[i];
      if (!v) continue;
      if (near2(toView3D(v, r, map), pt, MATCH_EPS)) out.push(i);
    }
    return out;
  }
  function findSeparatingViewForVertices(vertexIndices, solidMm, excludeRoles, map) {
    var none = { view: null, label: '', kind: 'none', groups: 1 };
    if (!vertexIndices || vertexIndices.length < 2 || !solidMm || !solidMm.vertices) return none;
    var excluded = Array.isArray(excludeRoles) ? excludeRoles : (excludeRoles ? [excludeRoles] : []);
    var primary = excluded[0] || '';
    var order = primary === 'ELEVATION' ? ['PLAN', 'PROFILE', 'ELEVATION']
      : primary === 'PLAN' ? ['ELEVATION', 'PROFILE', 'PLAN']
      : ['PLAN', 'ELEVATION', 'PROFILE'];
    var partial = null;
    for (var vi = 0; vi < order.length; vi++) {
      var vr = order[vi];
      if (excluded.indexOf(vr) !== -1) continue;
      if (vr === 'PROFILE' && (!map || !map.three)) continue;
      var projs = vertexIndices.map(function (idx) {
        return toView3D(solidMm.vertices[idx], vr, map);
      });
      var distinctGroups = 0;
      for (var i = 0; i < projs.length; i++) {
        var dup = false;
        for (var j = 0; j < i; j++) {
          if (near2(projs[i], projs[j], MATCH_EPS)) { dup = true; break; }
        }
        if (!dup) distinctGroups++;
      }
      if (distinctGroups === projs.length) {
        return { view: vr, label: SHORT_VIEW_CAP[vr] || '', kind: 'full', groups: distinctGroups };
      }
      if (distinctGroups > 1 && !partial) {
        partial = { view: vr, label: SHORT_VIEW_CAP[vr] || '', kind: 'partial', groups: distinctGroups };
      }
    }
    return partial || none;
  }
  function reconstructedPointPairInfo(a, b, solidMm, entities, map) {
    if (!a || !b || a.type !== 'POINT' || b.type !== 'POINT') return null;
    if (!solidMm || !Array.isArray(solidMm.vertices)) return null;
    var r = role(a);
    if (r !== role(b) || r === 'SHARED') return null;
    if (r === 'PROFILE' && (!map || !map.three)) return null;
    var vertsA = matchedVerticesForPoint(a, solidMm, r, map);
    var vertsB = matchedVerticesForPoint(b, solidMm, r, map);
    if (!vertsA.length || !vertsB.length) return null;
    if (vertsA.length === 1 && vertsB.length === 1 && vertsA[0] === vertsB[0]) return null;
    var projDist = Math.hypot(b.x - a.x, b.y - a.y);
    if (vertsA.length === 1 && vertsB.length === 1) {
      var vA = solidMm.vertices[vertsA[0]], vB = solidMm.vertices[vertsB[0]];
      var dist3D = Math.hypot(vB.x - vA.x, vB.y - vA.y, vB.z - vA.z);
      return {
        unique: true,
        viewRole: r,
        viewLabel: SHORT_VIEW[r] || '',
        vertexA: vertsA[0],
        vertexB: vertsB[0],
        labelA: vertexLabel3D(vA, solidMm, entities, map),
        labelB: vertexLabel3D(vB, solidMm, entities, map),
        candidatesA: vertsA,
        candidatesB: vertsB,
        sepA: { view: null, label: '', kind: 'none', groups: 1 },
        sepB: { view: null, label: '', kind: 'none', groups: 1 },
        projDist: projDist,
        dist3D: dist3D,
        restDist3D: dist3D
      };
    }
    var sepA = vertsA.length >= 2 ? findSeparatingViewForVertices(vertsA, solidMm, [r], map) : { view: null, label: '', kind: 'none', groups: 1 };
    var sepB = vertsB.length >= 2 ? findSeparatingViewForVertices(vertsB, solidMm, [r], map) : { view: null, label: '', kind: 'none', groups: 1 };
    return {
      unique: false,
      viewRole: r,
      viewLabel: SHORT_VIEW[r] || '',
      vertexA: vertsA.length === 1 ? vertsA[0] : null,
      vertexB: vertsB.length === 1 ? vertsB[0] : null,
      labelA: vertsA.length === 1 ? vertexLabel3D(solidMm.vertices[vertsA[0]], solidMm, entities, map) : '',
      labelB: vertsB.length === 1 ? vertexLabel3D(solidMm.vertices[vertsB[0]], solidMm, entities, map) : '',
      candidatesA: vertsA,
      candidatesB: vertsB,
      sepA: sepA,
      sepB: sepB,
      projDist: projDist,
      dist3D: null,
      restDist3D: null
    };
  }
  function pointSpanCalloutLines(opts) {
    opts = opts || {};
    var prec = typeof opts.precision === 'number' ? opts.precision : 2;
    var fmt = function (n) { return String(Number(n.toFixed(prec))); };
    var projLen = typeof opts.projLen === 'number' ? opts.projLen : 0;
    var trueLen = typeof opts.trueLen === 'number' ? opts.trueLen : null;
    var restTrueLen = typeof opts.restTrueLen === 'number' ? opts.restTrueLen : trueLen;
    var scale = typeof opts.scale === 'number' ? opts.scale : 1;
    var scaled = Math.abs(scale - 1) > 0.005;
    var viewTitle = opts.viewTitle || SHORT_VIEW_CAP[opts.viewRole] || 'View';
    var hasTrue = trueLen !== null && trueLen > 1e-6;
    var scaleTxt = String(Number(scale.toFixed(2))) + '×';
    var dist3DLine = hasTrue
      ? (scaled
          ? ('3D distance ' + fmt(restTrueLen) + ' → ' + fmt(trueLen) + ' mm at ' + scaleTxt)
          : ('3D distance ' + fmt(trueLen) + ' mm'))
      : '';
    var ratio = hasTrue ? (projLen / trueLen) : 1;
    var aligned = projLen <= 1e-5 || (hasTrue && ratio <= 1e-5);
    if (aligned) {
      var ptLines = [viewTitle + ' 0 mm · coincident'];
      if (dist3DLine) ptLines.push(dist3DLine);
      return { kind: 'coincident', shortText: '0 mm', lines: ptLines, pointMarker: true };
    }
    var nearEndOn = hasTrue && ratio <= 0.05;
    var smallOnScreen = typeof opts.projPx === 'number' ? opts.projPx < 10 : nearEndOn;
    if (nearEndOn) {
      var minStep = Math.pow(10, -prec);
      var rounded = Number(projLen.toFixed(prec));
      var valText = rounded === 0
        ? ('< ' + (prec > 0 ? minStep.toFixed(prec) : '1') + ' mm')
        : (projLen.toFixed(prec) + ' mm');
      var nearLines = [viewTitle + ' ' + valText + ' · near end-on'];
      if (dist3DLine) nearLines.push(dist3DLine);
      return { kind: 'near-end-on', shortText: valText, lines: nearLines, pointMarker: smallOnScreen };
    }
    var spanVal = fmt(projLen) + ' mm';
    if (hasTrue && Math.abs(trueLen - projLen) <= 0.05) {
      var fullLines = [viewTitle + ' ' + spanVal + ' · true distance'];
      if (scaled) fullLines.push(fmt(restTrueLen) + ' → ' + fmt(trueLen) + ' mm at ' + scaleTxt);
      return { kind: 'true-distance', shortText: spanVal, lines: fullLines, pointMarker: smallOnScreen };
    }
    if (hasTrue) {
      var foreLines = scaled
        ? [viewTitle + ' ' + spanVal, dist3DLine]
        : [viewTitle + ' ' + spanVal + ' · ' + dist3DLine];
      return { kind: 'foreshortened', shortText: spanVal, lines: foreLines, pointMarker: smallOnScreen };
    }
    return { kind: 'span', shortText: spanVal, lines: [viewTitle + ' ' + spanVal], pointMarker: smallOnScreen };
  }
  function reconstructedPoint3D(e, solidMm, map) {
    if (!e || e.type !== 'POINT' || !solidMm || !Array.isArray(solidMm.vertices)) return null;
    var r = role(e);
    if (r === 'SHARED' || (r === 'PROFILE' && (!map || !map.three))) return null;
    var found = null;
    for (var i = 0; i < solidMm.vertices.length; i++) {
      var v = solidMm.vertices[i];
      var p = toView3D(v, r, map);
      if (near2(p, e, MATCH_EPS)) {
        if (found && Math.hypot(v.x - found.x, v.y - found.y, v.z - found.z) > 0.05) return null;
        found = v;
      }
    }
    return found;
  }
  function parallelSpacing(a, b) {
    var ax = a.x2 - a.x, ay = a.y2 - a.y, bx = b.x2 - b.x, by = b.y2 - b.y;
    var al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
    if (al < EPS || bl < EPS) return null;
    var ux = ax / al, uy = ay / al;
    var cross = Math.abs(ux * (by / bl) - uy * (bx / bl));
    if (cross > 1e-3) return null;
    var nx = -uy, ny = ux;
    var signed = (b.x - a.x) * nx + (b.y - a.y) * ny;
    var spacing = Math.abs(signed);
    var tA0 = 0, tA1 = al;
    var tB0 = (b.x - a.x) * ux + (b.y - a.y) * uy;
    var tB1 = (b.x2 - a.x) * ux + (b.y2 - a.y) * uy;
    var loB = Math.min(tB0, tB1), hiB = Math.max(tB0, tB1);
    var ovLo = Math.max(tA0, loB), ovHi = Math.min(tA1, hiB);
    var tMid = ovHi >= ovLo ? (ovLo + ovHi) / 2 : al / 2;
    var p1 = { x: a.x + ux * tMid, y: a.y + uy * tMid };
    var p2 = { x: p1.x + nx * signed, y: p1.y + ny * signed };
    var ext = null;
    if (tMid < loB) ext = [{ x: a.x + ux * loB + nx * signed, y: a.y + uy * loB + ny * signed }, p2];
    else if (tMid > hiB) ext = [{ x: a.x + ux * hiB + nx * signed, y: a.y + uy * hiB + ny * signed }, p2];
    return { spacing: spacing, p1: p1, p2: p2, ext: ext };
  }
  function edgeRelation(a, b) {
    var ax = a.x2 - a.x, ay = a.y2 - a.y, bx = b.x2 - b.x, by = b.y2 - b.y;
    var al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
    if (al < EPS || bl < EPS) return null;
    var par = parallelSpacing(a, b);
    if (par) return { kind: 'parallel', spacing: par.spacing, p1: par.p1, p2: par.p2, ext: par.ext, diff: bl - al };
    var denom = ax * by - ay * bx;
    var angle = Math.atan2(Math.abs(denom), Math.abs(ax * bx + ay * by)) / Geometry.RAD;
    var t = ((b.x - a.x) * by - (b.y - a.y) * bx) / denom;
    var ix = a.x + t * ax, iy = a.y + t * ay;
    var ma = { x: (a.x + a.x2) / 2, y: (a.y + a.y2) / 2 };
    var mb = { x: (b.x + b.x2) / 2, y: (b.y + b.y2) / 2 };
    return { kind: 'angle', angle: angle, diff: bl - al, ix: ix, iy: iy, ma: ma, mb: mb };
  }
  function isRound(e) { return !!e && (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC'); }
  function circleEdgeOffset(a, b) {
    var circle = isRound(a) && SPANS.indexOf(b.type) !== -1 ? a
      : isRound(b) && SPANS.indexOf(a.type) !== -1 ? b : null;
    if (!circle) return null;
    var edge = circle === a ? b : a;
    var dx = edge.x2 - edge.x, dy = edge.y2 - edge.y, len = Math.hypot(dx, dy);
    if (len < EPS) return null;
    var ux = dx / len, uy = dy / len;
    var t = (circle.x - edge.x) * ux + (circle.y - edge.y) * uy;
    var foot = { x: edge.x + t * ux, y: edge.y + t * uy };
    var offset = Math.hypot(circle.x - foot.x, circle.y - foot.y);
    var ext = null;
    if (t < 0 && edge.type !== 'LINE' && edge.type !== 'DATUM_AXIS') ext = [{ x: edge.x, y: edge.y }, foot];
    else if (t > len && edge.type !== 'LINE' && edge.type !== 'RAY' && edge.type !== 'DATUM_AXIS') ext = [{ x: edge.x2, y: edge.y2 }, foot];
    var tangency = null;
    if (circle.radius > EPS && Math.abs(offset - circle.radius) <= 0.05) {
      var onRound = true;
      if (circle.type === 'CIRCULAR_ARC') {
        var contactDeg = Math.atan2(foot.y - circle.y, foot.x - circle.x) / Geometry.RAD;
        var sweep = Geometry.arcSweep(circle.startAngle, circle.endAngle);
        var rel = (((contactDeg - circle.startAngle) % 360) + 360) % 360;
        onRound = rel <= sweep + 0.25 || (360 - rel) <= 0.25;
      }
      if (onRound) {
        var onEdge = edge.type === 'LINE' || edge.type === 'DATUM_AXIS'
          ? true
          : edge.type === 'RAY'
            ? t >= -0.05
            : (t >= -0.05 && t <= len + 0.05);
        tangency = onEdge ? 'tangent' : 'extension';
      }
    }
    return { center: { x: circle.x, y: circle.y }, foot: foot, offset: offset, ext: ext, radius: circle.radius, tangency: tangency };
  }
  function endpointName(e, entities, second) {
    var refs = e.meta && (e.meta.endpointRefs || e.meta.refs), p;
    if (refs && refs.length === 2) p = entities.find(function (item) { return item.type === 'POINT' && item.id === refs[second ? 1 : 0]; });
    if (!p) {
      var x = second ? e.x2 : e.x, y = second ? e.y2 : e.y;
      var candidates = entities.filter(function (item) { return item.type === 'POINT' && role(item) === role(e) && Math.hypot(item.x - x, item.y - y) < 1e-6; });
      if (candidates.length === 1) p = candidates[0];
    }
    return p ? String(p.caption || p.name || '') : '';
  }
  function title(e, entities) {
    entities = entities || [];
    if (e.type === 'POINT') return String(e.caption || e.name || 'Point');
    if (e.caption) return TYPES[e.type] + ' ' + e.caption;
    if (SPANS.indexOf(e.type) !== -1) {
      var a = endpointName(e, entities, false), b = endpointName(e, entities, true);
      if (a && b) return TYPES[e.type] + ' ' + a + '–' + b;
    }
    if (e.name && !/^E\d+$/.test(e.name)) return TYPES[e.type] + ' ' + e.name;
    var peers = entities.filter(function (item) { return item.type === e.type; });
    return TYPES[e.type] + (peers.length > 1 ? ' ' + (peers.findIndex(function (item) { return item.id === e.id; }) + 1) : '');
  }
  function specs(e, entities, preferences, map, solidMm) {
    if (!Measure.inspectEntity(e)) return null;
    var prefs = Settings.normalizeSheetInspection(preferences), r = role(e), rows = [['View', VIEW_NAMES[r]]], dx, dy, length;
    function mm(n) { return number(n, prefs) + ' mm'; }
    function xy(x, y) { return '(' + number(x, prefs) + ', ' + number(y, prefs) + ') mm'; }
    if (e.type === 'POINT') {
      if (prefs.coordinates) rows.push(['Sheet X / Y', xy(e.x, e.y)]);
      if (prefs.offsets) {
        if (r === 'PROFILE' && map && map.three && Number.isFinite(map.xRef) && Number.isFinite(map.dRef) && (map.s === 1 || map.s === -1)) {
          rows.push(['Height from HP', mm(e.y)]);
          rows.push(['Depth from VP', mm(map.dRef + map.s * (e.x - map.xRef))]);
          rows.push(['Offset from X₁Y₁', mm(map.s * (e.x - map.xRef))]);
        } else if (r === 'ELEVATION') rows.push(['Height from HP', mm(e.y) + (e.y < 0 ? ' · below' : e.y > 0 ? ' · above' : ' · on HP')]);
        else if (r === 'PLAN') rows.push(['Depth from VP', mm(-e.y) + (e.y > 0 ? ' · behind' : e.y < 0 ? ' · in front' : ' · on VP')]);
        else rows.push(['Distance from XY', mm(Math.abs(e.y))]);
      }
    } else if (SPANS.indexOf(e.type) !== -1) {
      dx = e.x2 - e.x; dy = e.y2 - e.y; length = Math.hypot(dx, dy);
      if (prefs.coordinates) rows.push(['Start', xy(e.x, e.y)], ['End', xy(e.x2, e.y2)]);
      if (prefs.lengths) {
        rows.push([e.type === 'LINE' || e.type === 'RAY' || e.type === 'DATUM_AXIS' ? 'Defined span' : 'Projected length', mm(length)]);
        var edge3d = reconstructedEdgeInfo(e, solidMm, map);
        if (edge3d && edge3d.established && edge3d.foreshortened) {
          rows.push(['True length (3D)', mm(edge3d.trueLength)]);
        }
        rows.push(['ΔX / ΔY', mm(dx) + ' / ' + mm(dy)]);
      }
      if (prefs.angles) rows.push(['Orientation from +X', length > 1e-9 ? number(Measure.lineAngleDeg(dx, dy), prefs) + '°' : '—']);
      if (e.type === 'LINE') rows.push(['Extent', 'Infinite in both directions']);
      if (e.type === 'RAY') rows.push(['Extent', 'Infinite from its start']);
    } else {
      if (prefs.coordinates) rows.push(['Center', xy(e.x, e.y)]);
      if (prefs.radii) rows.push(['Radius', mm(e.radius)], ['Diameter', mm(2 * e.radius)]);
      if (e.type === 'CIRCLE' && prefs.curveProperties) rows.push(['Circumference', mm(2 * Math.PI * e.radius)], ['Circle area', number(Math.PI * e.radius * e.radius, prefs) + ' mm²']);
      if (e.type === 'CIRCULAR_ARC') {
        var sweep = Geometry.arcSweep(e.startAngle, e.endAngle);
        if (prefs.angles) rows.push(['Sweep', number(sweep, prefs) + '°'], ['Start / end angle', number(e.startAngle, prefs) + '° / ' + number(e.endAngle, prefs) + '°']);
        if (prefs.curveProperties) rows.push(['Arc length', mm(e.radius * sweep * Geometry.RAD)]);
        if (prefs.lengths) rows.push(['Chord length', mm(2 * e.radius * Math.abs(Math.sin(sweep * Geometry.RAD / 2)))]);
        if (prefs.coordinates) {
          [e.startAngle, e.endAngle].forEach(function (angle, i) {
            rows.push([i ? 'Arc end' : 'Arc start', xy(e.x + e.radius * Math.cos(angle * Geometry.RAD), e.y + e.radius * Math.sin(angle * Geometry.RAD))]);
          });
        }
      }
    }
    return { id: e.id, title: title(e, entities), role: r, kind: category(e), rows: rows };
  }
  function inventory(entities, preferences, query) {
    var prefs = Settings.normalizeSheetInspection(preferences), search = String(query || '').trim().toLowerCase().replace(/-/g, '–');
    return entities.filter(function (e) {
      if (!Measure.inspectEntity(e) || !prefs[category(e)] || (!prefs.construction && construction(e))) return false;
      if (prefs.view !== 'all' && role(e).toLowerCase() !== prefs.view) return false;
      return !search || (title(e, entities) + ' ' + VIEW_NAMES[role(e)] + ' ' + TYPES[e.type]).toLowerCase().indexOf(search) !== -1;
    });
  }
  function togglePin(pins, id, side, offsetMm) {
    if (pins.some(function (pin) { return pin.id === id; })) return pins.filter(function (pin) { return pin.id !== id; });
    return pins.concat([{ id: id, side: side === -1 ? -1 : 1, offsetMm: offsetMm || null }]);
  }
  function overlayItems(entities, selectedId, side, pins, preferences) {
    var prefs = Settings.normalizeSheetInspection(preferences), out = [], seen = {};
    function add(id, itemSide, focused, offsetMm) {
      var e = entities.find(function (item) { return item.id === id; });
      if (!e || !Measure.inspectEntity(e) || seen[id]) return;
      if (id !== selectedId && prefs.view !== 'all' && role(e).toLowerCase() !== prefs.view) return;
      seen[id] = true; out.push({ entity: e, side: itemSide, focused: !!focused, offsetMm: offsetMm || null });
    }
    add(selectedId, side, true, null);
    if (prefs.overlay !== 'selected') pins.forEach(function (pin) { add(pin.id, pin.side, true, pin.offsetMm); });
    if (prefs.overlay === 'all') inventory(entities, prefs).forEach(function (e) { add(e.id, 1, false, null); });
    return out;
  }
  function compactRows(spec, detailed) {
    var rows = spec.rows.filter(function (row) { return row[0] !== 'View' && row[0] !== 'Extent'; });
    if (detailed) return rows.slice(0, 3);
    var priority = spec.kind === 'points' ? ['Sheet X / Y', 'Height from HP', 'Depth from VP'] : spec.kind === 'lines' ? ['Projected length', 'Defined span', 'Orientation from +X'] : ['Radius', 'Arc length', 'Circumference', 'Sweep'];
    return priority.map(function (key) { return rows.find(function (row) { return row[0] === key; }); }).filter(Boolean).slice(0, 1);
  }
  function comparison(a, b, preferences, solidMm, entities, map) {
    var prefs = Settings.normalizeSheetInspection(preferences);
    if (!a || !b || !Measure.inspectEntity(a) || !Measure.inspectEntity(b)) return null;
    if (role(a) !== role(b)) return { note: 'Choose two items in the same orthographic view to compare.', rows: [] };
    var rows = [], dx, dy;
    if (a.type === 'POINT' && b.type === 'POINT') {
      dx = b.x - a.x; dy = b.y - a.y;
      var pair3 = reconstructedPointPairInfo(a, b, solidMm, entities, map);
      if (prefs.lengths) {
        rows.push([(SHORT_VIEW_CAP[role(a)] || 'Projected') + ' distance', number(Math.hypot(dx, dy), prefs) + ' mm']);
        if (pair3 && pair3.unique && Math.abs(pair3.dist3D - pair3.projDist) > 0.05) {
          rows.push(['3D distance', number(pair3.dist3D, prefs) + ' mm']);
        }
        rows.push(['ΔX / ΔY', number(dx, prefs) + ' / ' + number(dy, prefs) + ' mm']);
      }
      var ptNote = VIEW_NAMES[role(a)];
      if (pair3 && !pair3.unique) ptNote += ' · stacked endpoint';
      return { note: ptNote, rows: rows };
    }
    if (SPANS.indexOf(a.type) !== -1 && SPANS.indexOf(b.type) !== -1) {
      var corner = reconstructedCornerInfo(a, b, solidMm, entities, map);
      if (corner) {
        if (prefs.angles) {
          if (corner.projectedAngle !== null) rows.push([(SHORT_VIEW_CAP[corner.viewRole] || 'View') + ' angle', formatAngleDeg(corner.projectedAngle, prefs.precision) + '°']);
          if (corner.angle3D !== null && (corner.projectedAngle === null || Math.abs(corner.angle3D - corner.projectedAngle) > 0.1)) {
            rows.push(['3D angle', formatAngleDeg(corner.angle3D, prefs.precision) + '°']);
          }
        }
        return {
          note: VIEW_NAMES[role(a)] + (corner.unique ? ' · 3D corner' : (' · ' + corner.overlapCount + ' corners overlap')),
          rows: rows
        };
      }
      var rel = edgeRelation(a, b);
      if (rel && rel.kind === 'parallel') {
        if (prefs.lengths) rows.push(['Perpendicular spacing', number(rel.spacing, prefs) + ' mm']);
        if (prefs.lengths && Math.abs(rel.diff) > 0.05) rows.push(['Length difference', number(rel.diff, prefs) + ' mm']);
        return { note: VIEW_NAMES[role(a)] + ' · parallel edges', rows: rows };
      }
      if (rel) {
        if (prefs.angles) rows.push([(SHORT_VIEW_CAP[role(a)] || 'Included') + ' angle', formatAngleDeg(rel.angle, prefs.precision) + '°']);
        if (prefs.lengths) rows.push(['Span difference (2 − 1)', number(rel.diff, prefs) + ' mm']);
        return { note: VIEW_NAMES[role(a)] + ' · edges', rows: rows };
      }
    }
    var ce = circleEdgeOffset(a, b);
    if (ce) {
      if (prefs.lengths || prefs.offsets) {
        rows.push(['Center to line offset', number(ce.offset, prefs) + ' mm']);
        if (ce.tangency === 'tangent') rows.push(['Relation', 'Tangent']);
        else if (ce.tangency === 'extension') rows.push(['Relation', 'Tangent to extension']);
        else if (ce.offset - ce.radius > 0.05) rows.push(['Clearance to edge', number(ce.offset - ce.radius, prefs) + ' mm']);
      }
      return { note: VIEW_NAMES[role(a)] + ' · center to line', rows: rows };
    }
    return null;
  }
  function viewBounds(entities, view) {
    var out = {};
    entities.forEach(function (e) {
      if (!Measure.inspectEntity(e) || construction(e)) return;
      var r = role(e); if (r === 'SHARED') return;
      if (!out[r]) out[r] = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      var points = [{ x: e.x, y: e.y }];
      if (SPANS.indexOf(e.type) !== -1) points.push({ x: e.x2, y: e.y2 });
      if (e.radius) points.push({ x: e.x - e.radius, y: e.y - e.radius }, { x: e.x + e.radius, y: e.y + e.radius });
      points.forEach(function (point) {
        var x = point.x * view.s + view.tx, y = view.ty - point.y * view.s, b = out[r];
        b.x0 = Math.min(b.x0, x - 10); b.x1 = Math.max(b.x1, x + 10); b.y0 = Math.min(b.y0, y - 10); b.y1 = Math.max(b.y1, y + 10);
      });
    });
    return out;
  }
  function entityDistancePx(e, cursorPx, view) {
    if (!e || !cursorPx || !view) return Infinity;
    if (e.type === 'POINT') {
      var p = { x: e.x * view.s + view.tx, y: view.ty - e.y * view.s };
      return Math.hypot(cursorPx.x - p.x, cursorPx.y - p.y);
    }
    if (SPANS.indexOf(e.type) !== -1) {
      var a = { x: e.x * view.s + view.tx, y: view.ty - e.y * view.s };
      var b = { x: e.x2 * view.s + view.tx, y: view.ty - e.y2 * view.s };
      return Geometry.spanDistance(cursorPx, a, b, e.type);
    }
    if (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') {
      var q = { x: (cursorPx.x - view.tx) / view.s, y: (view.ty - cursorPx.y) / view.s };
      return Geometry.roundDistance(q, e) * view.s;
    }
    return Infinity;
  }
  function spanProjectionPx(e, cursorPx, view) {
    var ax = e.x * view.s + view.tx, ay = view.ty - e.y * view.s;
    var bx = e.x2 * view.s + view.tx, by = view.ty - e.y2 * view.s;
    var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < EPS) return null;
    var ux = dx / len, uy = dy / len;
    var nx = -uy, ny = ux;
    var rx = cursorPx.x - ax, ry = cursorPx.y - ay;
    var along = rx * ux + ry * uy;
    var t = along / len;
    var signedPerp = rx * nx + ry * ny;
    return { t: t, len: len, signedPerp: signedPerp, absPerp: Math.abs(signedPerp), ux: ux, uy: uy, nx: nx, ny: ny, ax: ax, ay: ay, bx: bx, by: by };
  }

  return {
    SPANS: SPANS,
    TYPES: TYPES,
    VIEW_NAMES: VIEW_NAMES,
    SHORT_VIEW: SHORT_VIEW,
    SHORT_VIEW_CAP: SHORT_VIEW_CAP,
    EPS: EPS,
    MATCH_EPS: MATCH_EPS,
    number: number,
    role: role,
    category: category,
    construction: construction,
    toView3D: toView3D,
    near2: near2,
    sameProjectedSpan: sameProjectedSpan,
    vertexLabel3D: vertexLabel3D,
    physicalEdgeLabel: physicalEdgeLabel,
    findSeparatingView: findSeparatingView,
    reconstructedEdgeInfo: reconstructedEdgeInfo,
    edgeCalloutLines: edgeCalloutLines,
    poseEdgeProjectionLabel: poseEdgeProjectionLabel,
    formatAngleDeg: formatAngleDeg,
    findSeparatingViewForCorners: findSeparatingViewForCorners,
    reconstructedCornerInfo: reconstructedCornerInfo,
    cornerAngleCallout: cornerAngleCallout,
    hitTestPoseEdgeTargets: hitTestPoseEdgeTargets,
    matchedVerticesForPoint: matchedVerticesForPoint,
    findSeparatingViewForVertices: findSeparatingViewForVertices,
    reconstructedPointPairInfo: reconstructedPointPairInfo,
    pointSpanCalloutLines: pointSpanCalloutLines,
    reconstructedPoint3D: reconstructedPoint3D,
    parallelSpacing: parallelSpacing,
    edgeRelation: edgeRelation,
    circleEdgeOffset: circleEdgeOffset,
    title: title,
    specs: specs,
    inventory: inventory,
    togglePin: togglePin,
    overlayItems: overlayItems,
    compactRows: compactRows,
    comparison: comparison,
    viewBounds: viewBounds,
    entityDistancePx: entityDistancePx,
    spanProjectionPx: spanProjectionPx
  };
});

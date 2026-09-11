(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduGraphicsSnapping = factory();
    root.EduCADSnapping = root.EduGraphicsSnapping;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD Phase 5: 6-tier object snap (ENDPOINT over INTERSECTION over
  // MIDPOINT over CENTER over PROJECTOR over LOCUS). World mm only inside
  // entities and solvers; screen px is ephemeral render only. Projector
  // invariant: elevation x equals plan x (mm). Hysteresis: lock 14px,
  // release 22px. Endpoint dedup rebind within 1.0 mm. Angle detents
  // 15/30/45 deg (15-deg steps, majors 15/30/45). Zero deps. Dual-env:
  // browser via window.EduGraphicsSnapping, Node via module.exports.
  var WORLD_UNITS = 'mm';
  var VERSION = '5.0.0-edugraphics';
  var SNAP_TIERS = ['ENDPOINT', 'INTERSECTION', 'MIDPOINT', 'CENTER', 'PROJECTOR', 'LOCUS'];
  var TIER_RANK = { ENDPOINT: 0, INTERSECTION: 1, MIDPOINT: 2, CENTER: 3, PROJECTOR: 4, LOCUS: 5 };
  var SNAP_LOCK_PX = 14;
  var SNAP_RELEASE_PX = 22;
  var ENDPOINT_DEDUP_MM = 1.0;
  var DETENTS_DEG = [15, 30, 45];
  var DETENT_STEP_DEG = 15;
  var DETENT_TOL_DEG = 2;
  var BADGE_TYPES = ['ENDPOINT', 'INTERSECTION', 'MIDPOINT', 'CENTER', 'PROJECTOR', 'LOCUS', 'DETENT'];
  var BADGE_LABELS = {
    ENDPOINT: 'Endpoint', INTERSECTION: 'Intersection', MIDPOINT: 'Midpoint',
    CENTER: 'Center', PROJECTOR: 'Projector', LOCUS: 'Locus', DETENT: 'Detent'
  };
  var RING_RADIUS_PX = 10;
  var RING_WIDTH_PX = 2;
  var LAYER_DYNAMIC = 'layer2';
  var VERTICAL_EPS = 1e-9;

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function forward(view, ptMm) {
    assertFinite(view.s, view.tx, view.ty, ptMm.x, ptMm.y);
    return { x: ptMm.x * view.s + view.tx, y: view.ty - ptMm.y * view.s };
  }

  function inverse(view, ptPx) {
    assertFinite(view.s, view.tx, view.ty, ptPx.x, ptPx.y);
    return { x: (ptPx.x - view.tx) / view.s, y: (view.ty - ptPx.y) / view.s };
  }

  function distPx(a, b) {
    assertFinite(a.x, a.y, b.x, b.y);
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function distMm(a, b) {
    assertFinite(a.x, a.y, b.x, b.y);
    var dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function checkProjector(planMm, elevMm, eps) {
    assertFinite(planMm.x, planMm.y, elevMm.x, elevMm.y);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    assertFinite(e);
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  function tierRank(tier) {
    if (!Object.prototype.hasOwnProperty.call(TIER_RANK, tier)) {
      throw new Error('unknown snap tier: ' + String(tier));
    }
    return TIER_RANK[tier];
  }

  function compareTiers(a, b) {
    return tierRank(a) - tierRank(b);
  }

  function isBetterTier(a, b) {
    return compareTiers(a, b) < 0;
  }

  function snapKey(c) {
    if (c.key !== undefined && c.key !== null) return String(c.key);
    return c.tier + ':' + c.xMm + ',' + c.yMm;
  }

  // Best = lowest tier rank, tie-broken by smallest distPx.
  function pickBest(candidates) {
    if (!Array.isArray(candidates)) throw new Error('candidates must be an array');
    var best = null;
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      tierRank(c.tier);
      assertFinite(c.distPx);
      if (best === null) { best = c; continue; }
      var d = compareTiers(c.tier, best.tier);
      if (d < 0 || (d === 0 && c.distPx < best.distPx)) best = c;
    }
    return best;
  }

  function candidatesWithin(candidates, radiusPx) {
    assertFinite(radiusPx);
    return candidates.filter(function (c) { return c.distPx <= radiusPx; });
  }

  function shouldLock(distPxVal) { assertFinite(distPxVal); return distPxVal <= SNAP_LOCK_PX; }
  function shouldRelease(distPxVal) { assertFinite(distPxVal); return distPxVal > SNAP_RELEASE_PX; }

  // Hysteresis: keep current lock while its live distance is <= 22px,
  // unless a strictly higher-tier candidate is within 14px. When idle,
  // lock the best candidate within 14px, else null.
  function updateSnap(current, candidates) {
    if (current !== null && current !== undefined) tierRank(current.tier);
    if (!Array.isArray(candidates)) throw new Error('candidates must be an array');
    if (current === null || current === undefined) {
      var fresh = candidatesWithin(candidates, SNAP_LOCK_PX);
      if (fresh.length === 0) return null;
      return pickBest(fresh);
    }
    var key = snapKey(current);
    var live = null;
    for (var i = 0; i < candidates.length; i++) {
      if (snapKey(candidates[i]) === key) { live = candidates[i]; break; }
    }
    var challengers = candidatesWithin(candidates, SNAP_LOCK_PX);
    var higher = null;
    for (var j = 0; j < challengers.length; j++) {
      if (isBetterTier(challengers[j].tier, current.tier)) {
        if (higher === null || compareTiers(challengers[j].tier, higher.tier) < 0 ||
          (challengers[j].tier === higher.tier && challengers[j].distPx < higher.distPx)) {
          higher = challengers[j];
        }
      }
    }
    if (higher !== null) return higher;
    if (live !== null && !shouldRelease(live.distPx)) return live;
    if (challengers.length === 0) return null;
    return pickBest(challengers);
  }

  // Endpoint dedup: rebind to an existing point within 1.0 mm.
  function rebindEndpoint(ptMm, existingList) {
    assertFinite(ptMm.x, ptMm.y);
    if (!Array.isArray(existingList)) throw new Error('existingList must be an array');
    for (var i = 0; i < existingList.length; i++) {
      var e = existingList[i];
      assertFinite(e.x, e.y);
      if (distMm(ptMm, e) <= ENDPOINT_DEDUP_MM) {
        return { point: { x: e.x, y: e.y }, rebound: true, index: i };
      }
    }
    return { point: { x: ptMm.x, y: ptMm.y }, rebound: false, index: -1 };
  }

  function dedupEndpoints(pointsMm) {
    if (!Array.isArray(pointsMm)) throw new Error('pointsMm must be an array');
    var kept = [];
    var map = [];
    for (var i = 0; i < pointsMm.length; i++) {
      var r = rebindEndpoint(pointsMm[i], kept);
      if (r.rebound) { map.push(r.index); }
      else { kept.push({ x: pointsMm[i].x, y: pointsMm[i].y }); map.push(kept.length - 1); }
    }
    return { points: kept, map: map };
  }

  function norm180(a) {
    assertFinite(a);
    var r = a % 180;
    if (r < 0) r += 180;
    if (r === 180) r = 0;
    return r;
  }

  function nearestDetent(angleDeg) {
    var n = norm180(angleDeg);
    var m = Math.round(n / DETENT_STEP_DEG) * DETENT_STEP_DEG;
    if (m === 180) m = 0;
    return m;
  }

  function isMajorDetent(angleDeg) {
    var m = Math.round(norm180(angleDeg));
    return DETENTS_DEG.indexOf(m) !== -1;
  }

  function detentSnap(angleDeg, tolDeg) {
    var tol = (tolDeg === undefined) ? DETENT_TOL_DEG : tolDeg;
    assertFinite(angleDeg, tol);
    var target = nearestDetent(angleDeg);
    var err = Math.abs(norm180(angleDeg) - target);
    if (err > 90) err = 180 - err;
    return { detent: target, snapped: err <= tol, errDeg: err, angleDeg: err <= tol ? target : angleDeg };
  }

  function badgeForTier(tier) {
    if (BADGE_TYPES.indexOf(tier) === -1) throw new Error('unknown badge type: ' + String(tier));
    return { type: tier, label: BADGE_LABELS[tier], tier: tier };
  }

  function badgeFor(snap) {
    if (!snap) return null;
    var b = badgeForTier(snap.tier);
    b.key = snapKey(snap);
    return b;
  }

  // Ephemeral px ring on Layer2 only (never stored on entities).
  function ringForSnap(snapPx, tier, opts) {
    opts = opts || {};
    assertFinite(snapPx.x, snapPx.y);
    var r = (opts.rPx === undefined) ? RING_RADIUS_PX : opts.rPx;
    assertFinite(r);
    return {
      layer: LAYER_DYNAMIC, shape: 'ring',
      xPx: snapPx.x, yPx: snapPx.y, rPx: r, widthPx: RING_WIDTH_PX,
      tier: tier || null
    };
  }

  function pushCandidate(out, tier, id, xMm, yMm, cursorPx, view) {
    var p = forward(view, { x: xMm, y: yMm });
    out.push({
      tier: tier, key: tier + ':' + id, id: id,
      xMm: xMm, yMm: yMm, xPx: p.x, yPx: p.y, distPx: distPx(cursorPx, p)
    });
  }

  function endpointCandidates(entities, cursorPx, view) {
    var out = [];
    entities.forEach(function (e) {
      if (e.type === 'POINT') pushCandidate(out, 'ENDPOINT', e.id + ':p', e.x, e.y, cursorPx, view);
      else if (e.type === 'SEGMENT' || e.type === 'DIMENSION' || e.type === 'CIRCULAR_ARC') {
        pushCandidate(out, 'ENDPOINT', e.id + ':p1', e.x, e.y, cursorPx, view);
        pushCandidate(out, 'ENDPOINT', e.id + ':p2', e.x2, e.y2, cursorPx, view);
      } else if (e.type === 'RAY') {
        pushCandidate(out, 'ENDPOINT', e.id + ':origin', e.x, e.y, cursorPx, view);
      }
    });
    return out;
  }

  function midpointCandidates(entities, cursorPx, view) {
    var out = [];
    entities.forEach(function (e) {
      if (e.type === 'SEGMENT' || e.type === 'DIMENSION') {
        pushCandidate(out, 'MIDPOINT', e.id + ':mid', (e.x + e.x2) / 2, (e.y + e.y2) / 2, cursorPx, view);
      }
    });
    return out;
  }

  function centerCandidates(entities, cursorPx, view) {
    var out = [];
    entities.forEach(function (e) {
      if (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') {
        pushCandidate(out, 'CENTER', e.id + ':c', e.x, e.y, cursorPx, view);
      }
    });
    return out;
  }

  function segSegInt(a, b, c, d) {
    var rX = b.x - a.x, rY = b.y - a.y, sX = d.x - c.x, sY = d.y - c.y;
    var den = rX * sY - rY * sX;
    if (Math.abs(den) < 1e-12) return null;
    var t = ((c.x - a.x) * sY - (c.y - a.y) * sX) / den;
    var u = ((c.x - a.x) * rY - (c.y - a.y) * rX) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: a.x + t * rX, y: a.y + t * rY };
  }

  function lineLineInt(a, b, c, d) {
    var rX = b.x - a.x, rY = b.y - a.y, sX = d.x - c.x, sY = d.y - c.y;
    var den = rX * sY - rY * sX;
    if (Math.abs(den) < 1e-12) return null;
    var t = ((c.x - a.x) * sY - (c.y - a.y) * sX) / den;
    return { x: a.x + t * rX, y: a.y + t * rY };
  }

  function intersectionCandidates(entities, cursorPx, view) {
    var out = [];
    var segs = entities.filter(function (e) {
      return e.type === 'SEGMENT' || e.type === 'LINE' || e.type === 'DIMENSION';
    });
    for (var i = 0; i < segs.length; i++) {
      for (var j = i + 1; j < segs.length; j++) {
        var A = segs[i], B = segs[j];
        var a = { x: A.x, y: A.y }, b = { x: A.x2, y: A.y2 };
        var c = { x: B.x, y: B.y }, d = { x: B.x2, y: B.y2 };
        var pt = (A.type === 'LINE' || B.type === 'LINE') ? lineLineInt(a, b, c, d) : segSegInt(a, b, c, d);
        if (pt) pushCandidate(out, 'INTERSECTION', A.id + 'x' + B.id, pt.x, pt.y, cursorPx, view);
      }
    }
    return out;
  }

  // Projector: vertical lines x = planX (mm); elev.x forced equal.
  function projectorCandidates(planXListMm, cursorPx, view) {
    if (!Array.isArray(planXListMm)) throw new Error('planXListMm must be an array');
    var w = inverse(view, cursorPx);
    var out = [];
    for (var i = 0; i < planXListMm.length; i++) {
      assertFinite(planXListMm[i]);
      var p = forward(view, { x: planXListMm[i], y: w.y });
      out.push({
        tier: 'PROJECTOR', key: 'PROJECTOR:px' + planXListMm[i], id: 'px' + i,
        xMm: planXListMm[i], yMm: w.y, xPx: p.x, yPx: p.y, distPx: Math.abs(p.x - cursorPx.x)
      });
    }
    return out;
  }

  // Locus: horizontal lines y = locusY (mm).
  function locusCandidates(locusYListMm, cursorPx, view) {
    if (!Array.isArray(locusYListMm)) throw new Error('locusYListMm must be an array');
    var w = inverse(view, cursorPx);
    var out = [];
    for (var i = 0; i < locusYListMm.length; i++) {
      assertFinite(locusYListMm[i]);
      var p = forward(view, { x: w.x, y: locusYListMm[i] });
      out.push({
        tier: 'LOCUS', key: 'LOCUS:ly' + locusYListMm[i], id: 'ly' + i,
        xMm: w.x, yMm: locusYListMm[i], xPx: p.x, yPx: p.y, distPx: Math.abs(p.y - cursorPx.y)
      });
    }
    return out;
  }

  function collectCandidates(o, cursorPx, view) {
    o = o || {};
    var entities = o.entities || [];
    var out = [];
    function append(a) { for (var i = 0; i < a.length; i++) out.push(a[i]); }
    append(endpointCandidates(entities, cursorPx, view));
    append(intersectionCandidates(entities, cursorPx, view));
    append(midpointCandidates(entities, cursorPx, view));
    append(centerCandidates(entities, cursorPx, view));
    append(projectorCandidates(o.planXMmList || [], cursorPx, view));
    append(locusCandidates(o.locusYMmList || [], cursorPx, view));
    return out;
  }

  // One-call snap: mm world in, ephemeral px ring out.
  function snapAt(cursorPx, view, o, current) {
    assertFinite(cursorPx.x, cursorPx.y);
    var cands = collectCandidates(o || {}, cursorPx, view);
    var snap = updateSnap(current === undefined ? null : current, cands);
    var badge = badgeFor(snap);
    var ring = snap ? ringForSnap({ x: snap.xPx, y: snap.yPx }, snap.tier) : null;
    return { snap: snap, candidates: cands, badge: badge, ring: ring };
  }

  return {
    WORLD_UNITS: WORLD_UNITS, VERSION: VERSION,
    SNAP_TIERS: SNAP_TIERS, TIER_RANK: TIER_RANK, TIERS: SNAP_TIERS,
    SNAP_LOCK_PX: SNAP_LOCK_PX, LOCK_PX: SNAP_LOCK_PX,
    SNAP_RELEASE_PX: SNAP_RELEASE_PX, RELEASE_PX: SNAP_RELEASE_PX,
    ENDPOINT_DEDUP_MM: ENDPOINT_DEDUP_MM, DEDUP_MM: ENDPOINT_DEDUP_MM,
    DETENTS_DEG: DETENTS_DEG, DETENT_STEP_DEG: DETENT_STEP_DEG, DETENT_TOL_DEG: DETENT_TOL_DEG,
    BADGE_TYPES: BADGE_TYPES, BADGE_LABELS: BADGE_LABELS,
    RING_RADIUS_PX: RING_RADIUS_PX, RING_WIDTH_PX: RING_WIDTH_PX,
    LAYER_DYNAMIC: LAYER_DYNAMIC, VERTICAL_EPS: VERTICAL_EPS,
    assertFinite: assertFinite, forward: forward, inverse: inverse,
    distPx: distPx, distMm: distMm, checkProjector: checkProjector,
    tierRank: tierRank, compareTiers: compareTiers, isBetterTier: isBetterTier,
    pickBest: pickBest, candidatesWithin: candidatesWithin,
    shouldLock: shouldLock, shouldRelease: shouldRelease,
    updateSnap: updateSnap, updateSnapLock: updateSnap,
    snapKey: snapKey,
    rebindEndpoint: rebindEndpoint, dedupEndpoints: dedupEndpoints,
    nearestDetent: nearestDetent, isMajorDetent: isMajorDetent,
    detentSnap: detentSnap, snapAngle: detentSnap,
    badgeForTier: badgeForTier, badgeFor: badgeFor,
    ringForSnap: ringForSnap, ringFor: ringForSnap,
    endpointCandidates: endpointCandidates, midpointCandidates: midpointCandidates,
    centerCandidates: centerCandidates, intersectionCandidates: intersectionCandidates,
    projectorCandidates: projectorCandidates, locusCandidates: locusCandidates,
    collectCandidates: collectCandidates, snapAt: snapAt
  };
});

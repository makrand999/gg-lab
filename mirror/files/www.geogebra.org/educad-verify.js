(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADVerify = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD verify-only lesson checker: the student does competing-points
  // analysis (hidden verdicts in parens, projector member claims) and this
  // module grades it against curriculum corner truth. It never derives
  // geometry and never feeds reconstruction: verdicts and claims are
  // student input, checked here and nowhere else. Without truth (hand
  // drawings) claim/verdict checks report unverifiable explicitly.
  // Zero deps. Dual-env: browser via window.EduCADVerify, plain Node via
  // module.exports. Node-safe.
  var WORLD_UNITS = 'mm';
  var VERSION = '1.0.0-educad';
  var MATCH_EPS_MM = 0.5;
  var VERTICAL_EPS = 1e-9;

  var REASON_LABELS = {
    'projector-foot-loose': 'projector end lands on no drawn point',
    'claim-not-projector': 'claimed member drawn on a non-projector line',
    'stale-claim': 'claimed member renamed away from its station',
    'unknown-member': 'claimed member names no known corner',
    'claim-foot-mismatch': 'projector foot is not the member\u2019s mate',
    'verdict-flipped': 'hidden verdict disagrees with the solid',
    'unknown-point': 'verdict names no known corner',
    'unchecked-view': 'profile verdicts are not checked in v1',
    'unverifiable': 'no reference sheet: draw or load a demo first'
  };

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  // Mirrors EduCADLabels.splitCaption/bareName/isHiddenMark (zero-dep).
  function splitCaption(caption) {
    var parts = String(caption === undefined || caption === null ? '' : caption).split(',');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var t = parts[i].replace(/^\s+|\s+$/g, '');
      if (t !== '') out.push(t);
    }
    return out;
  }

  function bareName(part) {
    var t = String(part === undefined || part === null ? '' : part);
    t = t.replace(/^\s+|\s+$/g, '');
    if (t.length >= 2 && t.charAt(0) === '(' && t.charAt(t.length - 1) === ')') {
      return t.slice(1, -1).replace(/^\s+|\s+$/g, '');
    }
    return t;
  }

  function isHiddenMark(part) {
    var t = String(part === undefined || part === null ? '' : part);
    t = t.replace(/^\s+|\s+$/g, '');
    return t.length >= 2 && t.charAt(0) === '(' && t.charAt(t.length - 1) === ')';
  }

  // Trailing prime ticks name the view, not the corner: a' is corner a.
  function cornerOf(bare) {
    var s = String(bare === undefined || bare === null ? '' : bare);
    while (s.length > 0) {
      var ch = s.charAt(s.length - 1);
      if (ch === "'" || ch === '\u2032' || ch === '\u2019') s = s.slice(0, -1);
      else break;
    }
    return s;
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function isSheetVertical(e) {
    return Math.abs(e.x2 - e.x) <= VERTICAL_EPS;
  }

  function crossesXY(e) {
    // Mirrors the reconstruction helper rule: strict crossing, plus
    // touching-from-below (a base-station projector starts at y = 0).
    var lo = Math.min(e.y, e.y2), hi = Math.max(e.y, e.y2);
    return lo < 0 && hi >= 0;
  }

  // Projector-shaped: the same geometric rule the reconstruction input
  // filter uses for helper verticals.
  function isProjectorShaped(e) {
    if (!e) return false;
    if (e.type !== 'SEGMENT' && e.type !== 'LINE' && e.type !== 'RAY') return false;
    return isSheetVertical(e) && crossesXY(e);
  }

  function viewOf(e) {
    if (e.viewRole === 'PLAN') return 'plan';
    if (e.viewRole === 'ELEVATION') return 'elev';
    if (e.viewRole === 'PROFILE') return 'profile';
    var my = ((e.y === undefined ? 0 : e.y) + (e.y2 === undefined ? 0 : e.y2)) / 2;
    if (my > 0) return 'elev';
    if (my < 0) return 'plan';
    return 'datum';
  }

  function truthCorners(truth) {
    if (!truth) return null;
    if (truth.corners && typeof truth.corners === 'object') return truth.corners;
    if (typeof truth === 'object') return truth;
    return null;
  }

  // Foot candidates: every drawn POINT plus every line-like endpoint.
  function collectFeet(entities, skipId) {
    var feet = [];
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e || e.visible === false) continue;
      if (e.id === skipId) continue;
      if (e.type === 'POINT') {
        feet.push({ x: e.x, y: e.y });
      } else if (e.type === 'SEGMENT' || e.type === 'LINE' || e.type === 'RAY' ||
          e.type === 'DIMENSION' || e.type === 'DATUM_AXIS') {
        feet.push({ x: e.x, y: e.y });
        feet.push({ x: e.x2, y: e.y2 });
      }
    }
    return feet;
  }

  function nearFoot(feet, x, y, eps) {
    for (var i = 0; i < feet.length; i++) {
      if (dist(x, y, feet[i].x, feet[i].y) <= eps) return true;
    }
    return false;
  }

  function byId(entities) {
    var map = {};
    for (var i = 0; i < entities.length; i++) {
      if (entities[i] && typeof entities[i].id === 'string') map[entities[i].id] = entities[i];
    }
    return map;
  }

  // True visibility of one corner within its station set: elevation shows
  // the foremost (max depth d = -planY), plan shows the tallest (max
  // elevY). Single-member stations are always visible.
  function truthHidden(cornerId, stationIds, corners, view) {
    var self = corners[cornerId];
    if (!self) return false;
    var key = (view === 'elev') ? 'd' : 'h';
    function val(id) {
      var c = corners[id];
      if (!c) return null;
      return (key === 'd') ? -c.plan.y : c.elev.y;
    }
    var mine = val(cornerId);
    if (mine === null) return false;
    for (var i = 0; i < stationIds.length; i++) {
      var o = val(stationIds[i]);
      if (o !== null && o > mine + 1e-9) return true;
    }
    return false;
  }

  function checkProjector(e, feet, eps) {
    var ok1 = nearFoot(feet, e.x, e.y, eps);
    var ok2 = nearFoot(feet, e.x2, e.y2, eps);
    if (ok1 && ok2) {
      return { id: e.id, kind: 'projector', verdict: 'pass', reason: null,
        label: 'projector ' + e.id + ' lands on drawn points' };
    }
    var loose = !ok1 ? 'P1' : 'P2';
    return { id: e.id, kind: 'projector', verdict: 'fail',
      reason: 'projector-foot-loose',
      label: 'projector ' + e.id + ' ' + loose + ' lands on no drawn point' };
  }

  function checkClaim(e, map, corners, eps) {
    var m = (e.meta && e.meta.fromMember !== undefined && e.meta.fromMember !== null) ?
      String(e.meta.fromMember) : '';
    if (m === '') return null;
    var member = cornerOf(m);
    if (!corners) {
      return { id: e.id, kind: 'claim', verdict: 'unverifiable',
        reason: 'unverifiable',
        label: 'claim ' + m + ' on ' + e.id + ': no reference sheet' };
    }
    if (!corners[member]) {
      return { id: e.id, kind: 'claim', verdict: 'fail',
        reason: 'unknown-member',
        label: 'claim ' + m + ' on ' + e.id + ' names no known corner' };
    }
    var refs = (e.meta && Array.isArray(e.meta.refs)) ? e.meta.refs : [];
    var station = refs.length > 0 ? (map[refs[0]] || null) : null;
    if (!station || station.type !== 'POINT' ||
        splitCaption(station.caption).map(bareName).map(cornerOf).indexOf(member) === -1) {
      return { id: e.id, kind: 'claim', verdict: 'fail',
        reason: 'stale-claim',
        label: 'claim ' + m + ' on ' + e.id + ': member left its station' };
    }
    var truth = corners[member];
    var p1Plan = dist(e.x, e.y, truth.plan.x, truth.plan.y) <= eps;
    var p1Elev = dist(e.x, e.y, truth.elev.x, truth.elev.y) <= eps;
    var p2Plan = dist(e.x2, e.y2, truth.plan.x, truth.plan.y) <= eps;
    var p2Elev = dist(e.x2, e.y2, truth.elev.x, truth.elev.y) <= eps;
    if ((p1Plan && p2Elev) || (p1Elev && p2Plan)) {
      return { id: e.id, kind: 'claim', verdict: 'pass', reason: null,
        label: 'claim ' + m + ' on ' + e.id + ' pairs the true feet' };
    }
    return { id: e.id, kind: 'claim', verdict: 'fail',
      reason: 'claim-foot-mismatch',
      label: 'claim ' + m + ' on ' + e.id + ': foot is not the member\u2019s mate' };
  }

  function checkStation(e, corners) {
    var parts = splitCaption(e.caption);
    if (parts.length === 0) return null;
    var view = viewOf(e);
    if (view === 'profile') {
      return { id: e.id, kind: 'station', verdict: 'unverifiable',
        reason: 'unchecked-view',
        label: 'station ' + e.id + ': profile verdicts are not checked in v1' };
    }
    if (view === 'datum') {
      return { id: e.id, kind: 'station', verdict: 'unverifiable',
        reason: 'unverifiable',
        label: 'station ' + e.id + ': on-datum points carry no verdict' };
    }
    if (!corners) {
      return { id: e.id, kind: 'station', verdict: 'unverifiable',
        reason: 'unverifiable',
        label: 'station ' + e.id + ': no reference sheet' };
    }
    var ids = parts.map(function (p) { return cornerOf(bareName(p)); });
    for (var u = 0; u < ids.length; u++) {
      if (!corners[ids[u]]) {
        return { id: e.id, kind: 'station', verdict: 'fail',
          reason: 'unknown-point',
          label: 'station ' + e.id + ': ' + parts[u] + ' names no known corner' };
      }
    }
    var bad = [];
    for (var k = 0; k < ids.length; k++) {
      var claimedHidden = isHiddenMark(parts[k]);
      var trulyHidden = truthHidden(ids[k], ids, corners, view);
      if (claimedHidden !== trulyHidden) bad.push(parts[k]);
    }
    if (bad.length === 0) {
      return { id: e.id, kind: 'station', verdict: 'pass', reason: null,
        label: 'station ' + e.id + ': verdicts agree' };
    }
    return { id: e.id, kind: 'station', verdict: 'fail',
      reason: 'verdict-flipped',
      label: 'station ' + e.id + ': ' + bad.join(', ') + ' verdict flipped' };
  }

  // verify(entities, truth, opts): grade student verdicts + claims.
  // entities: table list (only kind 'user-line' segments and POINTs with
  // captions are read; demo geometry is never judged). truth: corners map
  // ({id -> {plan:{x,y}, elev:{x,y}}}) or a bundle carrying .corners, or
  // null. opts.eps (default 0.5 mm).
  function verify(entities, truth, opts) {
    if (!Array.isArray(entities)) throw new Error('entities must be an array');
    var o = opts || {};
    var eps = (o.eps === undefined || o.eps === null) ? MATCH_EPS_MM : o.eps;
    assertFinite(eps);
    var corners = truthCorners(truth);
    var map = byId(entities);
    var checks = [];
    var i, e, c;
    for (i = 0; i < entities.length; i++) {
      e = entities[i];
      if (!e || e.visible === false) continue;
      var kind = e.meta && e.meta.kind;
      if ((e.type === 'SEGMENT' || e.type === 'LINE' || e.type === 'RAY') &&
          kind === 'user-line') {
        var claimed = e.meta && e.meta.fromMember !== undefined && e.meta.fromMember !== null &&
          String(e.meta.fromMember) !== '';
        var shaped = isProjectorShaped(e);
        if (shaped) {
          checks.push(checkProjector(e, collectFeet(entities, e.id), eps));
        }
        if (claimed) {
          if (shaped) {
            c = checkClaim(e, map, corners, eps);
            if (c) checks.push(c);
          } else {
            checks.push({ id: e.id, kind: 'claim', verdict: 'fail',
              reason: 'claim-not-projector',
              label: 'claim ' + String(e.meta.fromMember) + ' on ' + e.id +
                ' is drawn on a non-projector line' });
          }
        }
      } else if (e.type === 'POINT' && typeof e.caption === 'string' && e.caption !== '') {
        c = checkStation(e, corners);
        if (c) checks.push(c);
      }
    }
    var pass = 0, fail = 0, unver = 0;
    for (i = 0; i < checks.length; i++) {
      if (checks[i].verdict === 'pass') pass++;
      else if (checks[i].verdict === 'fail') fail++;
      else unver++;
    }
    return {
      pass: fail === 0,
      counts: { pass: pass, fail: fail, unverifiable: unver },
      checks: checks
    };
  }

  return {
    WORLD_UNITS: WORLD_UNITS, VERSION: VERSION,
    MATCH_EPS_MM: MATCH_EPS_MM, VERTICAL_EPS: VERTICAL_EPS,
    REASON_LABELS: REASON_LABELS,
    splitCaption: splitCaption, bareName: bareName,
    isHiddenMark: isHiddenMark, cornerOf: cornerOf,
    isProjectorShaped: isProjectorShaped,
    verify: verify
  };
});

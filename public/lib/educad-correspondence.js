(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADCorrespondence = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Read-only correspondence audit. This mirrors the auto-member rule used by
  // the reconstruction pipeline (same base name plus the shared orthographic
  // station) while also reporting alternatives and conflicts. It never edits
  // the drawing and never averages stations.
  var EPS = 1e-6;
  function names(caption) {
    return String(caption || '').split(',').map(function (part) {
      return part.replace(/^\s+|\s+$/g, '').replace(/['’′]+$/, '').toLowerCase();
    }).filter(Boolean);
  }
  function sideOf(p) {
    if (p.viewRole === 'ELEVATION') return 'elev';
    if (p.viewRole === 'PLAN') return 'plan';
    if (p.viewRole === 'PROFILE') return 'profile';
    if (p.y > 0) return 'elev';
    if (p.y < 0) return 'plan';
    return '';
  }
  function observation(p, side, frame) {
    if (side === 'plan') return {x:p.x, depth:-p.y};
    if (side === 'elev') return {x:p.x, height:p.y};
    if (side === 'profile' && frame) {
      return {depth:frame.dRef + frame.s * (p.x - frame.xRef), height:p.y};
    }
    return null;
  }
  function sharedAxis(a, b) {
    if ((a === 'plan' && b === 'elev') || (a === 'elev' && b === 'plan')) return 'x';
    if ((a === 'plan' && b === 'profile') || (a === 'profile' && b === 'plan')) return 'depth';
    if ((a === 'elev' && b === 'profile') || (a === 'profile' && b === 'elev')) return 'height';
    return null;
  }
  function compatible(a, b, frame) {
    if (!a.obs || !b.obs || a.side === b.side) return false;
    var axis = sharedAxis(a.side, b.side);
    if (!axis) return false;
    return Math.abs(a.obs[axis] - b.obs[axis]) <= EPS;
  }
  function analyze(entities, options) {
    options = options || {};
    var frame = options.profileFrame || null;
    var list = Array.isArray(entities) ? entities : [];
    var byBase = Object.create(null);
    list.forEach(function (entity) {
      if (!entity || entity.type !== 'POINT') return;
      if (entity.meta && entity.meta.membersDeclared === true) return;
      var specs = names(entity.caption || entity.name);
      if (!specs.length) return;
      var side = sideOf(entity);
      specs.forEach(function (base) {
        var rec = {entityId:entity.id, caption:entity.caption || entity.name || '',
          base:base, side:side, obs:observation(entity, side, frame),
          memberIds:(entity.meta && entity.meta.members || []).map(function (m) { return m && m.id; }).filter(Boolean)};
        (byBase[base] || (byBase[base] = [])).push(rec);
      });
    });
    var diagnostics = [], groups = [];
    Object.keys(byBase).sort().forEach(function (base) {
      var records = byBase[base];
      var bySide = {plan:[], elev:[], profile:[]};
      records.forEach(function (rec) { if (rec.obs && bySide[rec.side]) bySide[rec.side].push(rec); });
      var pairs = [], ambiguous = [], conflicts = [];
      function auditPair(firstSide, secondSide) {
        var first = bySide[firstSide], second = bySide[secondSide];
        if (!first.length || !second.length) return;
        first.forEach(function (one) {
          var matches = second.filter(function (two) { return compatible(one, two, frame); });
          if (matches.length === 0) {
            conflicts.push({observation:one.entityId, side:firstSide,
              reason:'no matching station in ' + secondSide});
            return;
          }
          if (matches.length > 1) {
            ambiguous.push({observation:one.entityId, side:firstSide,
              candidates:matches.map(function (m) { return m.entityId; })});
            return;
          }
          var mate = matches[0];
          var back = first.filter(function (other) { return compatible(other, mate, frame); });
          if (back.length === 1) pairs.push({a:one.entityId, b:mate.entityId,
            sides:[firstSide, secondSide], station:one.obs[sharedAxis(firstSide, secondSide)]});
          else ambiguous.push({observation:mate.entityId, side:secondSide,
            candidates:back.map(function (m) { return m.entityId; })});
        });
      }
      auditPair('plan', 'elev');
      if (frame) {
        auditPair('plan', 'profile');
        auditPair('elev', 'profile');
      }
      var sides = ['plan', 'elev', 'profile'].filter(function (side) { return bySide[side].length; });
      var status;
      if (ambiguous.length) status = 'ambiguous';
      else if (conflicts.length) status = 'conflict';
      else if (sides.length < 2 || pairs.length === 0) status = 'missing';
      else status = 'unique';
      var group = {base:base, status:status, sides:sides,
        observations:records.map(function (rec) { return {entityId:rec.entityId,
          side:rec.side, caption:rec.caption,
          station:rec.obs ? (rec.obs.x !== undefined ? rec.obs.x :
            rec.obs.depth !== undefined ? rec.obs.depth : rec.obs.height) : null}; }),
        pairs:pairs, alternatives:ambiguous, conflicts:conflicts};
      groups.push(group);
      if (status !== 'unique') diagnostics.push({code:'correspondence-' + status,
        severity:status === 'missing' ? 'info' : 'warning', base:base,
        message:status === 'ambiguous' ? 'Several compatible observations share this base.' :
          status === 'conflict' ? 'The shared station disagrees between views.' :
          'This base is observed in fewer than two compatible views.'});
    });
    var summary = {bases:groups.length, unique:0, ambiguous:0, conflict:0, missing:0,
      pairs:0, diagnostics:diagnostics.length};
    groups.forEach(function (group) {
      summary[group.status]++;
      summary.pairs += group.pairs.length;
    });
    return {contract:'correspondence-audit-v1', status:summary.diagnostics ? 'partial' : 'ok',
      groups:groups, summary:summary, diagnostics:diagnostics};
  }
  return {contract:'correspondence-audit-v1', analyze:analyze, names:names, sideOf:sideOf};
});

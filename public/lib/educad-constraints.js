(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADConstraints = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';




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
  function viewState(entities, options) {
    options = options || {};
    var list = Array.isArray(entities) ? entities : [];
    var counts = {plan:0, elev:0, profile:0};
    list.forEach(function (entity) {
      if (!entity || ['POINT', 'SEGMENT', 'LINE', 'RAY', 'CIRCLE', 'CIRCULAR_ARC', 'CURVE'].indexOf(entity.type) === -1) return;
      var side = sideOf(entity);
      if (counts[side] !== undefined) counts[side]++;
    });
    var present = Object.keys(counts).filter(function (side) { return counts[side] > 0; });
    var expected = options.expectedViews || ['plan', 'elev'];
    var missing = expected.filter(function (side) { return counts[side] === 0; });
    var hiddenLines = options.hiddenLines || 'unknown';
    if (['complete', 'omitted', 'unknown'].indexOf(hiddenLines) === -1)
      hiddenLines = 'unknown';
    return {contract:'view-state-v1',
      views:{plan:{present:counts.plan > 0, observations:counts.plan},
        elev:{present:counts.elev > 0, observations:counts.elev},
        profile:{present:counts.profile > 0, observations:counts.profile}},
      presentViews:present, missingViews:missing, hiddenLines:hiddenLines,
      visibility:hiddenLines === 'complete' ? 'hard-constraint' : 'soft-constraint',
      canvasSynthesis:false,
      status:missing.length ? 'underdetermined' : 'complete',
      diagnostics:missing.map(function (side) {
        return {code:'view-missing', severity:'info', view:side,
          message:'No ink is supplied for the ' + side + ' view; strokes are not synthesized.'};
      })};
  }

  function analyze(entities, options) {
    options = options || {};
    var frame = options.profileFrame || null;
    var list = Array.isArray(entities) ? entities : [];
    var byBase = Object.create(null);
    list.forEach(function (entity) {
      if (!entity || entity.type !== 'POINT') return;
      if (entity.meta && entity.meta.membersDeclared === true) return;
      names(entity.caption || entity.name).forEach(function (base) {
        (byBase[base] || (byBase[base] = [])).push(entity);
      });
    });
    var groups = [], diagnostics = [];
    Object.keys(byBase).sort().forEach(function (base) {
      var observations = byBase[base].map(function (entity) {
        return {entityId:entity.id, side:sideOf(entity), x:entity.x, y:entity.y};
      });
      var values = {x:[], y:[], z:[]};
      observations.forEach(function (obs) {
        if (obs.side === 'plan') {
          values.x.push({value:obs.x, entityId:obs.entityId, source:'plan.x'});
          values.z.push({value:-obs.y, entityId:obs.entityId, source:'plan.depth'});
        } else if (obs.side === 'elev') {
          values.x.push({value:obs.x, entityId:obs.entityId, source:'elev.x'});
          values.y.push({value:obs.y, entityId:obs.entityId, source:'elev.height'});
        } else if (obs.side === 'profile' && frame) {
          values.y.push({value:frame.dRef + frame.s * (obs.x - frame.xRef),
            entityId:obs.entityId, source:'profile.depth'});
        }
      });
      var conflicts = [];
      function axisConflict(axis, source) {
        if (values[axis].length < 2) return;
        var first = values[axis][0].value;
        var differing = values[axis].filter(function (v) {
          return Math.abs(v.value - first) > EPS;
        });
        if (!differing.length) return;
        conflicts.push({axis:axis, source:source,
          values:values[axis].map(function (v) {
            return {entityId:v.entityId, value:v.value, source:v.source};
          })});
      }
      axisConflict('x', 'x-station');
      axisConflict('y', 'height/depth station');
      var known = ['x', 'y', 'z'].filter(function (axis) { return values[axis].length > 0; });
      var free = ['x', 'y', 'z'].filter(function (axis) { return values[axis].length === 0; });
      var constraints = [];
      known.forEach(function (axis) {
        constraints.push({axis:axis, value:values[axis][0].value,
          observations:values[axis].map(function (v) { return v.entityId; })});
      });
      var status = conflicts.length ? 'conflict' :
        free.length ? 'underdetermined' : 'determined';
      groups.push({base:base, status:status, dof:free.length, freeAxes:free,
        knownAxes:known, constraints:constraints, conflicts:conflicts,
        observations:observations});
      if (status === 'conflict') diagnostics.push({code:'constraint-conflict',
        severity:'warning', base:base,
        message:'The same 3D axis is assigned different stations by different views.'});
      else if (status === 'underdetermined') diagnostics.push({code:'constraint-underdetermined',
        severity:'info', base:base,
        message:'The group leaves ' + free.join(', ') + ' unconstrained.'});
    });
    var summary = {groups:groups.length, determined:0, underdetermined:0, conflict:0,
      dof:0, diagnostics:diagnostics.length};
    groups.forEach(function (group) {
      summary[group.status]++;
      summary.dof += group.dof;
    });
    return {contract:'constraint-report-v1', status:diagnostics.length ? 'partial' : 'ok',
      groups:groups, summary:summary, diagnostics:diagnostics,
      views:viewState(list, options)};
  }
  return {contract:'constraint-report-v1', analyze:analyze, viewState:viewState,
    names:names, sideOf:sideOf};
});

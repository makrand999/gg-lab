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
  var DIMENSION_TOL_MM = 1e-6;
  var DIMENSION_HARD = {
    'dimension-residual':1, 'dimension-target-conflict':1,
    'dimension-axis-conflict':1, 'dimension-axis-offset-conflict':1, 'dimension-degenerate':1,
    'dimension-target-invalid':1
  };

  function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function dimensionView(entity) {
    if (entity.viewRole === 'PLAN') return 'plan';
    if (entity.viewRole === 'ELEVATION') return 'elevation';
    if (entity.viewRole === 'PROFILE') return 'profile';
    return '';
  }

  function pointDimensionView(point) {
    var role = dimensionView(point);
    if (role) return role;
    if (point.y > 0) return 'elevation';
    if (point.y < 0) return 'plan';
    return '';
  }

  function resolvePointReference(list, ref) {
    var exact = list.find(function (entity) {
      return entity && entity.id === ref;
    });
    if (exact) return exact.type === 'POINT' ? exact : null;
    var matches = list.filter(function (entity) {
      return entity && entity.type === 'POINT' &&
        (entity.name === ref || entity.caption === ref);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  function pointBase(point) {
    var labels = names(point && (point.caption || point.name));
    return labels.length ? labels[0] : '';
  }

  function baseCounts(list) {
    var counts = Object.create(null);
    list.forEach(function (entity) {
      if (!entity || entity.type !== 'POINT') return;
      var view = pointDimensionView(entity), base = pointBase(entity);
      if (!view || !base) return;
      var key = view + '|' + base;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }

  function pointIdentity(point, view, index, dimension, counts) {
    var meta = dimension.meta || {};
    var declared = meta.endpointMemberIds;
    if (Array.isArray(declared) && typeof declared[index] === 'string' && declared[index]) {
      return {id:declared[index], source:'endpointMemberIds', ambiguous:false};
    }
    var members = point.meta && point.meta.members;
    if (point.meta && point.meta.membersDeclared === true) {
      if (Array.isArray(members) && members.length === 1 && members[0] && members[0].id) {
        return {id:members[0].id, source:'member', ambiguous:false};
      }
      return {id:null, source:'member', ambiguous:true};
    }
    var base = pointBase(point);
    if (!base) return {id:null, source:'caption', ambiguous:true};
    return {id:'base:' + base, source:'caption',
      ambiguous:(counts[view + '|' + base] || 0) !== 1};
  }

  function dimensionDiagnostic(diagnostics, code, severity, message, dimension, extra) {
    var item = {code:code, severity:severity,
      entityId:dimension ? dimension.id : null,
      dimensionId:dimension ? dimension.id : null,
      message:message};
    if (extra) Object.keys(extra).forEach(function (key) { item[key] = extra[key]; });
    diagnostics.push(item);
    return item;
  }

  function analyzeDimensions(entities, options) {
    options = options || {};
    var tolerance = finiteNumber(options.toleranceMm) && options.toleranceMm >= 0 ?
      options.toleranceMm : DIMENSION_TOL_MM;
    var frame = options.profileFrame || null;
    var list = Array.isArray(entities) ? entities : [];
    var dimensions = list.filter(function (entity) {
      return entity && entity.type === 'DIMENSION';
    });
    var counts = baseCounts(list);
    var records = [], diagnostics = [], pairEntries = [], targetGroups = Object.create(null);
    var conflictIds = Object.create(null);

    dimensions.forEach(function (dimension) {
      var meta = dimension.meta || {};
      var hasTarget = Object.prototype.hasOwnProperty.call(meta, 'valueMm');
      var signedAxis = ['x','y','z'].indexOf(meta.dimensionAxis) !== -1 ? meta.dimensionAxis : null;
      var targetValue = finiteNumber(meta.valueMm) && (signedAxis || meta.valueMm >= 0) ? meta.valueMm : null;
      var driving = hasTarget || meta.dimensionMode === 'driving';
      var rec = {id:dimension.id, entityId:dimension.id,
        mode:driving ? 'driving' : 'measurement', view:null, refs:[],
        targetMm:targetValue, measuredMm:null, residualMm:null,
        components:null, axis:null, evidence:'none',
        status:driving ? 'unresolved' : 'measurement'};
      records.push(rec);
      if (hasTarget && targetValue === null) {
        dimensionDiagnostic(diagnostics, 'dimension-target-invalid', 'error',
          'A driving dimension needs a finite non-negative target.', dimension);
        rec.status = 'conflict';
        conflictIds[dimension.id] = true;
        return;
      }
      if (driving && targetValue === null) {
        dimensionDiagnostic(diagnostics, 'dimension-target-invalid', 'error',
          'A driving dimension needs an explicit target value.', dimension);
        rec.status = 'conflict';
        conflictIds[dimension.id] = true;
        return;
      }
      var refs = Array.isArray(meta.refs) ? meta.refs : [];
      if (refs.length !== 2) {
        if (driving) dimensionDiagnostic(diagnostics, 'dimension-reference-missing', 'warning',
          'A driving dimension needs two endpoint references.', dimension);
        rec.status = driving ? 'unresolved' : 'measurement';
        return;
      }
      var points = refs.map(function (ref) { return resolvePointReference(list, ref); });
      rec.refs = refs.map(function (ref, index) {
        var point = points[index];
        return {ref:ref, pointId:point ? point.id : null,
          memberId:null, view:point ? pointDimensionView(point) : '',
          resolved:!!point};
      });
      if (!points[0] || !points[1]) {
        if (driving) {
          var missing = !points[0] ? 0 : 1;
          dimensionDiagnostic(diagnostics, 'dimension-reference-missing', 'warning',
            'Dimension endpoint ' + (missing + 1) + ' does not resolve to a source point.',
            dimension, {refIndex:missing});
          rec.status = 'unresolved';
        }
        return;
      }
      var firstView = pointDimensionView(points[0]);
      var secondView = pointDimensionView(points[1]);
      var explicitView = dimensionView(dimension);
      if (explicitView && firstView && secondView &&
          (firstView !== explicitView || secondView !== explicitView)) {
        if (driving) dimensionDiagnostic(diagnostics, 'dimension-view-conflict', 'warning',
          'The dimension view disagrees with its referenced source points.', dimension);
        rec.status = driving ? 'unresolved' : 'measurement';
        return;
      }
      var view = explicitView ||
        (firstView && firstView === secondView ? firstView : '');
      rec.view = view || null;
      var identities = points.map(function (point, index) {
        return pointIdentity(point, view || firstView || secondView, index, dimension, counts);
      });
      rec.refs.forEach(function (ref, index) {
        ref.memberId = identities[index] && identities[index].id;
        ref.memberSource = identities[index] && identities[index].source;
      });
      if (signedAxis) {
        var axisEvidence = (options.axisEvidence || []).find(function (item) { return item.id === dimension.id; });
        rec.axis = signedAxis;
        rec.evidence = 'world-axis';
        rec.status = axisEvidence ? axisEvidence.status : 'unresolved';
        rec.measuredMm = axisEvidence ? axisEvidence.measuredMm : null;
        rec.residualMm = rec.measuredMm === null ? null : rec.measuredMm - targetValue;
        if (rec.status === 'conflict')
          dimensionDiagnostic(diagnostics, 'dimension-axis-offset-conflict', 'error',
            'The signed dimension disagrees with the reconstructed world-axis span.', dimension);
        else if (rec.status === 'unresolved')
          dimensionDiagnostic(diagnostics, 'dimension-axis-unanchored', 'warning',
            'The signed dimension needs distinct point identities and an anchored coordinate.', dimension);
        return;
      }
      if (!view) {
        if (driving) dimensionDiagnostic(diagnostics, 'dimension-view-ambiguous', 'warning',
          'Both dimension endpoints must share one declared view.', dimension);
        rec.status = driving ? 'unresolved' : 'measurement';
        return;
      }
      var dx = points[1].x - points[0].x;
      var dy = points[1].y - points[0].y;
      rec.evidence = 'reference';
      rec.measuredMm = Math.sqrt(dx * dx + dy * dy);
      var world;
      if (view === 'plan') {
        world = {uAxis:'x', vAxis:'z', du:dx, dv:-dy};
      } else if (view === 'elevation') {
        world = {uAxis:'x', vAxis:'y', du:dx, dv:dy};
      } else {
        if (!frame || !finiteNumber(frame.xRef) || !finiteNumber(frame.dRef) ||
            !finiteNumber(frame.s) || !frame.s) {
          if (driving) dimensionDiagnostic(diagnostics, 'dimension-profile-frame-missing', 'warning',
            'A side-view dimension needs the declared profile frame.', dimension);
          rec.status = driving ? 'unresolved' : 'measurement';
          return;
        }
        world = {uAxis:'z', vAxis:'y', du:frame.s * dx, dv:dy};
      }
      rec.components = {view:{dx:dx, dy:dy}, world:world};
      if (Math.abs(world.du) <= tolerance && Math.abs(world.dv) <= tolerance) {
        if (driving) {
          dimensionDiagnostic(diagnostics, 'dimension-degenerate', 'error',
            'A driving dimension has coincident source points.', dimension);
          rec.status = 'conflict';
          conflictIds[dimension.id] = true;
        }
        return;
      }
      rec.axis = Math.abs(world.du) <= tolerance ? world.vAxis :
        Math.abs(world.dv) <= tolerance ? world.uAxis : null;
      if (!driving) {
        rec.status = 'measurement';
        return;
      }
      rec.residualMm = rec.measuredMm - targetValue;
      if (Math.abs(rec.residualMm) > tolerance) {
        dimensionDiagnostic(diagnostics, 'dimension-residual', 'error',
          'The dimension target disagrees with its referenced drawing geometry.',
          dimension, {residualMm:rec.residualMm, measuredMm:rec.measuredMm});
        rec.status = 'conflict';
        conflictIds[dimension.id] = true;
      } else {
        rec.status = 'satisfied';
      }
      var groupKey = refs.slice().sort().join('|') + '|' + view;
      (targetGroups[groupKey] || (targetGroups[groupKey] = [])).push({rec:rec, target:targetValue});
      if (rec.axis) {
        var firstIdentity = identities[0], secondIdentity = identities[1];
        if (firstIdentity && secondIdentity && firstIdentity.id && secondIdentity.id &&
            !firstIdentity.ambiguous && !secondIdentity.ambiguous &&
            firstIdentity.id !== secondIdentity.id) {
          var ordered = [firstIdentity.id, secondIdentity.id].slice().sort();
          var forward = ordered[0] === firstIdentity.id ? 1 : -1;
          var component = rec.axis === world.uAxis ? world.du : world.dv;
          pairEntries.push({rec:rec, identityKey:ordered.join('|'),
            axis:rec.axis, view:view, value:forward * component});
        }
      }
    });

    Object.keys(targetGroups).forEach(function (key) {
      var entries = targetGroups[key];
      if (entries.length < 2) return;
      var first = entries[0].target;
      var differing = entries.filter(function (entry) {
        return Math.abs(entry.target - first) > tolerance;
      });
      if (!differing.length) return;
      differing.concat(entries[0]).forEach(function (entry) { conflictIds[entry.rec.id] = true; });
      dimensionDiagnostic(diagnostics, 'dimension-target-conflict', 'error',
        'One reference pair has different driving targets in the same view.',
        entries[0].rec, {dimensionIds:entries.map(function (entry) { return entry.rec.id; })});
    });

    var pairGroups = Object.create(null);
    pairEntries.forEach(function (entry) {
      var key = entry.identityKey + '|' + entry.axis;
      (pairGroups[key] || (pairGroups[key] = [])).push(entry);
    });
    Object.keys(pairGroups).forEach(function (key) {
      var entries = pairGroups[key];
      if (entries.length < 2) return;
      var views = Object.create(null);
      entries.forEach(function (entry) { views[entry.view] = true; });
      if (Object.keys(views).length < 2) return;
      var first = entries[0].value;
      var differing = entries.filter(function (entry) {
        return Math.abs(entry.value - first) > tolerance;
      });
      if (!differing.length) return;
      entries.forEach(function (entry) { conflictIds[entry.rec.id] = true; });
      dimensionDiagnostic(diagnostics, 'dimension-axis-conflict', 'error',
        'The views disagree about one world-axis span for the same source identity pair.',
        entries[0].rec, {dimensionIds:entries.map(function (entry) { return entry.rec.id; }) });
    });

    records.forEach(function (rec) {
      if (conflictIds[rec.id] && rec.mode === 'driving') rec.status = 'conflict';
    });

    var hard = diagnostics.filter(function (item) { return DIMENSION_HARD[item.code]; });
    var summary = {dimensions:records.length, driving:0, measurements:0,
      satisfied:0, conflicts:0, unresolved:0, ambiguous:0};
    records.forEach(function (rec) {
      if (rec.mode === 'driving') summary.driving++;
      else summary.measurements++;
      if (rec.status === 'satisfied') summary.satisfied++;
      else if (rec.status === 'conflict') summary.conflicts++;
      else if (rec.status === 'unresolved') summary.unresolved++;
      else if (rec.status === 'ambiguous') summary.ambiguous++;
    });
    return {contract:'dimension-constraints-v1',
      status:hard.length ? 'inconsistent' : diagnostics.length ? 'partial' : 'ok',
      toleranceMm:tolerance, dimensions:records, summary:summary,
      diagnostics:diagnostics, hardDiagnostics:hard.length};
  }

  return {contract:'constraint-report-v1', analyze:analyze, viewState:viewState,
    analyzeDimensions:analyzeDimensions,
    isHardDiagnostic:function (diagnostic) {
      return !!(diagnostic && DIMENSION_HARD[diagnostic.code]);
    },
    dimensionStatus:function (report) { return report && report.status || 'none'; },
    names:names, sideOf:sideOf};
});

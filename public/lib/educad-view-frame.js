(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADViewFrame = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var EPS = 1e-9;
  var ORTHO_EPS = 1e-5;
  var RESIDUAL_MM = 1e-5;
  var STANDARD = {
    PLAN: {
      id: 'PLAN', origin: { x: 0, y: 0, z: 0 },
      u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 0, z: -1 },
      n: { x: 0, y: 1, z: 0 }, sheet: { x: 0, y: 0 }
    },
    ELEVATION: {
      id: 'ELEVATION', origin: { x: 0, y: 0, z: 0 },
      u: { x: 1, y: 0, z: 0 }, v: { x: 0, y: 1, z: 0 },
      n: { x: 0, y: 0, z: 1 }, sheet: { x: 0, y: 0 }
    }
  };

  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
  function point(p) {
    return p && finite(p.x) && finite(p.y) && finite(p.z) ? { x: p.x, y: p.y, z: p.z } : null;
  }
  function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function cross(a, b) {
    return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
  }
  function length(v) { return Math.hypot(v.x, v.y, v.z); }
  function unit(v) {
    var l = length(v);
    return l > EPS ? { x: v.x / l, y: v.y / l, z: v.z / l } : null;
  }
  function copyFrame(frame) {
    return {
      id: String(frame.id), origin: point(frame.origin),
      u: point(frame.u), v: point(frame.v), n: point(frame.n),
      sheet: { x: frame.sheet.x, y: frame.sheet.y }
    };
  }
  function standard(role) {
    var frame = STANDARD[role];
    return frame ? copyFrame(frame) : null;
  }
  function fromProfile(profile) {
    if (!profile || !finite(profile.xRef) || !finite(profile.dRef) ||
        (profile.s !== 1 && profile.s !== -1)) return null;
    return {
      id: 'PROFILE',
      origin: { x: 0, y: 0, z: profile.dRef },
      u: { x: 0, y: 0, z: profile.s },
      v: { x: 0, y: 1, z: 0 },
      n: { x: -profile.s, y: 0, z: 0 },
      sheet: { x: profile.xRef, y: 0 }
    };
  }
  function forEntity(entity, profile, registry) {
    if (entity.viewRole === 'PROFILE') return fromProfile(profile);
    if (entity.viewRole === 'AUX') return registry ? registry.frameFor(entity) : null;
    return standard(entity.viewRole);
  }
  function declaration(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('A view frame needs an object declaration.');
    var id = String(raw.id || '').trim();
    if (!id) throw new Error('A view frame needs a nonempty id.');
    var origin = point(raw.origin);
    var sheet = raw.sheet || { x: raw.u0, y: raw.v0 };
    if (!origin) throw new Error('View frame ' + id + ' needs a finite world origin.');
    if (!sheet || !finite(sheet.x) || !finite(sheet.y))
      throw new Error('View frame ' + id + ' needs finite sheet placement.');
    var n = point(raw.n), u = point(raw.u), v = point(raw.v);
    if (!n || !u) throw new Error('View frame ' + id + ' needs a view normal and right axis.');
    var nUnit = unit(n);
    if (!nUnit) throw new Error('View frame ' + id + ' has a zero normal.');
    var uUnit = unit(u);
    if (!uUnit) throw new Error('View frame ' + id + ' has a zero right axis.');
    var skew = dot(nUnit, uUnit);
    if (Math.abs(skew) > ORTHO_EPS)
      throw new Error('View frame ' + id + ' right axis must be perpendicular to its normal.');
    uUnit = unit({ x: uUnit.x - nUnit.x * skew, y: uUnit.y - nUnit.y * skew, z: uUnit.z - nUnit.z * skew });
    var vUnit = v ? unit(v) : unit(cross(nUnit, uUnit));
    if (!vUnit) throw new Error('View frame ' + id + ' needs a usable up axis.');
    if (Math.abs(dot(vUnit, nUnit)) > ORTHO_EPS || Math.abs(dot(vUnit, uUnit)) > ORTHO_EPS)
      throw new Error('View frame ' + id + ' axes must be orthonormal.');
    var derived = unit(cross(uUnit, vUnit));
    if (!derived || (derived.x * nUnit.x + derived.y * nUnit.y + derived.z * nUnit.z) < 1 - ORTHO_EPS)
      throw new Error('View frame ' + id + ' must be right-handed with normal u x v.');
    return { id: id, origin: origin, u: uUnit, v: vUnit, n: nUnit,
      sheet: { x: sheet.x, y: sheet.y } };
  }
  function rawFrames(entities, options) {
    var out = [];
    function add(value) {
      if (!value) return;
      if (Array.isArray(value)) value.forEach(add);
      else if (typeof value === 'object') out.push(value);
    }
    (entities || []).forEach(function (e) {
      if (!e || !e.meta) return;
      add(e.meta.viewFrame);
      add(e.meta.viewFrames);
    });
    if (options) {
      add(options.viewFrame);
      add(options.viewFrames);
      add(options.frames);
    }
    return out;
  }
  function resolve(entities, options) {
    options = options || {};
    var byId = Object.create(null), list = [], issues = [];
    rawFrames(entities, options).forEach(function (raw) {
      var frame;
      try { frame = declaration(raw); }
      catch (error) {
        issues.push({ code: 'aux-frame-invalid', message: error.message });
        return;
      }
      if (byId[frame.id]) {
        var first = byId[frame.id];
        if (JSON.stringify(first) !== JSON.stringify(frame)) {
          issues.push({ code: 'aux-frame-conflict',
            message: 'Auxiliary frame ' + frame.id + ' is declared with different origins or axes.' });
        }
        return;
      }
      byId[frame.id] = frame;
      list.push(frame);
    });
    var auxEntities = (entities || []).filter(function (e) { return e && e.viewRole === 'AUX'; });
    auxEntities.forEach(function (e) {
      var id = e.meta && e.meta.frameId;
      if (!id) {
        issues.push({ code: 'aux-frame-missing', entityId: e.id,
          message: 'Auxiliary entity ' + e.id + ' needs an explicit frame id.' });
      } else if (!byId[id]) {
        issues.push({ code: 'aux-frame-missing', entityId: e.id,
          message: 'Auxiliary entity ' + e.id + ' refers to undeclared frame ' + id + '.' });
      }
    });
    function frameFor(entity) {
      if (!entity || entity.viewRole !== 'AUX') return null;
      var id = entity.meta && entity.meta.frameId;
      return id ? byId[id] || null : null;
    }
    return {
      byId: byId, list: list, issues: issues,
      hasAux: auxEntities.length > 0 || list.length > 0,
      frameFor: frameFor,
      serialize: function () { return list.map(copyFrame); }
    };
  }
  function project(frame, p) {
    if (!frame || !p) return null;
    var d = { x: p.x - frame.origin.x, y: p.y - frame.origin.y, z: p.z - frame.origin.z };
    return { x: frame.sheet.x + dot(d, frame.u), y: frame.sheet.y + dot(d, frame.v) };
  }
  function direction(frame, v) {
    if (!frame || !v) return null;
    return { x: dot(v, frame.u), y: dot(v, frame.v) };
  }
  function unproject(frame, p, depth) {
    if (!frame || !p) return null;
    var d = finite(depth) ? depth : 0;
    return {
      x: frame.origin.x + (p.x - frame.sheet.x) * frame.u.x + (p.y - frame.sheet.y) * frame.v.x + d * frame.n.x,
      y: frame.origin.y + (p.x - frame.sheet.x) * frame.u.y + (p.y - frame.sheet.y) * frame.v.y + d * frame.n.y,
      z: frame.origin.z + (p.x - frame.sheet.x) * frame.u.z + (p.y - frame.sheet.y) * frame.v.z + d * frame.n.z
    };
  }
  function observationRows(observations) {
    var rows = [];
    (observations || []).forEach(function (obs) {
      if (!obs || !obs.frame || !finite(obs.x) || !finite(obs.y)) return;
      var f = obs.frame, o = f.origin, s = f.sheet;
      rows.push({ a: [f.u.x, f.u.y, f.u.z], b: obs.x - s.x + dot(o, f.u),
        frame: f.id, entityId: obs.entityId, axis: 'u' });
      rows.push({ a: [f.v.x, f.v.y, f.v.z], b: obs.y - s.y + dot(o, f.v),
        frame: f.id, entityId: obs.entityId, axis: 'v' });
    });
    return rows;
  }
  function solveRows(rows) {
    if (rows.length < 3) return { rank: 0, point: null, residual: Infinity };
    var ata = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], atb = [0, 0, 0];
    rows.forEach(function (row) {
      for (var i = 0; i < 3; i++) {
        atb[i] += row.a[i] * row.b;
        for (var j = 0; j < 3; j++) ata[i][j] += row.a[i] * row.a[j];
      }
    });
    var matrix = ata.map(function (r, i) { return r.concat([atb[i]]); });
    var scale = Math.max(Math.abs(ata[0][0]), Math.abs(ata[1][1]), Math.abs(ata[2][2]), 1);
    var rank = 0;
    for (var col = 0; col < 3; col++) {
      var pivot = col;
      for (var r = col + 1; r < 3; r++) if (Math.abs(matrix[r][col]) > Math.abs(matrix[pivot][col])) pivot = r;
      if (Math.abs(matrix[pivot][col]) <= scale * 1e-12) continue;
      var swap = matrix[col]; matrix[col] = matrix[pivot]; matrix[pivot] = swap;
      var div = matrix[col][col];
      for (var c = col; c < 4; c++) matrix[col][c] /= div;
      for (var rr = 0; rr < 3; rr++) {
        if (rr === col) continue;
        var f = matrix[rr][col];
        for (var cc = col; cc < 4; cc++) matrix[rr][cc] -= f * matrix[col][cc];
      }
      rank++;
    }
    if (rank < 3) return { rank: rank, point: null, residual: Infinity };
    var p = { x: matrix[0][3], y: matrix[1][3], z: matrix[2][3] };
    var residual = 0;
    rows.forEach(function (row) {
      residual = Math.max(residual, Math.abs(row.a[0] * p.x + row.a[1] * p.y + row.a[2] * p.z - row.b));
    });
    return { rank: 3, point: p, residual: residual };
  }
  function residualAt(observations, p) {
    var residual = 0;
    (observations || []).forEach(function (obs) {
      var q = project(obs.frame, p);
      if (q) residual = Math.max(residual, Math.hypot(q.x - obs.x, q.y - obs.y));
    });
    return residual;
  }
  function solveObservations(observations) {
    var rows = observationRows(observations);
    var solved = solveRows(rows);
    return { contract: 'aux-view-frame-observation-v1', rows: rows.length,
      rank: solved.rank, point: solved.point, residual: solved.residual,
      observations: observations || [] };
  }
  function memberIds(entity) {
    return ((entity && entity.meta && entity.meta.members) || [])
      .map(function (m) { return m && m.id; }).filter(Boolean);
  }
  function endpointMembers(entity, byId) {
    var meta = entity.meta || {};
    if (Array.isArray(meta.endpointMemberIds) && meta.endpointMemberIds.length === 2)
      return meta.endpointMemberIds.slice();
    var refs = meta.endpointRefs || meta.refs;
    if (!Array.isArray(refs) || refs.length !== 2) return null;
    var out = [];
    for (var i = 0; i < 2; i++) {
      var p = byId.get(refs[i]);
      var ids = memberIds(p);
      if (ids.length !== 1) return null;
      out.push(ids[0]);
    }
    return out;
  }
  function audit(entities, geometry, registry, curveIssues) {
    if (!registry || !registry.hasAux) return { status: 'none', frames: [], issues: [],
      consumedIds: [], unresolvedIds: [], residual: 0, pointRank: 0, pointConflicts: 0 };
    var issues = [], consumed = new Set(), unresolved = new Set();
    var byId = new Map((entities || []).map(function (e) { return [e.id, e]; }));
    var curveSources = new Set(), traceSources = new Set(), stations = new Set(), fittedStations = new Set();
    var issueByCurve = new Map((curveIssues || []).filter(function (issue) {
      return /^(conic-|aux-conic-|curve-|aux-curve-)/.test(issue.code);
    }).map(function (issue) { return [issue.entityId, issue]; }));
    (geometry && geometry.curves || []).forEach(function (curve) {
      if (curve.kind === 'nurbs') {
        (curve.sourceEvidence || []).forEach(function (source) { curveSources.add(source.entityId); });
      } else if (curve.analytic) {
        (curve.sourceIds || []).forEach(function (id) { curveSources.add(id); });
        (curve.viewDefinitions || []).forEach(function (view) {
          if (view.kind === 'line' && view.role === 'AUX')
            (view.ids || []).forEach(function (id) { traceSources.add(id); });
        });
        (curve.centerSourceIds || []).forEach(function (id) { fittedStations.add(id); });
        (curve.pointEvidence || []).forEach(function (evidence) {
          (evidence.sourceIds || []).forEach(function (id) { fittedStations.add(id); });
        });
      }
    });
    (entities || []).forEach(function (entity) {
      if (entity.viewRole !== 'AUX') return;
      var meta = entity.meta || {};
      var center = meta.centerRef || meta.ellipse && meta.ellipse.centerRef;
      var refs = entity.type === 'CURVE' ? meta.throughRefs : center ? [center] : null;
      if (traceSources.has(entity.id)) {
        var endpoints = meta.endpointRefs || meta.refs;
        if (Array.isArray(endpoints) && endpoints.length === 2)
          refs = endpoints.filter(function (id, index) {
            var point = byId.get(id), x = index ? entity.x2 : entity.x, y = index ? entity.y2 : entity.y;
            return point && Math.hypot(point.x-x,point.y-y) <= RESIDUAL_MM;
          });
      }
      if (!Array.isArray(refs)) return;
      var frame = registry.frameFor(entity);
      refs.forEach(function (id) {
        var station = byId.get(id);
        if (!station || station.type !== 'POINT' || station.viewRole !== 'AUX' ||
            (station.meta || {}).frameId !== (entity.meta || {}).frameId) return;
        stations.add(id);
        if (frame && curveSources.has(entity.id)) fittedStations.add(id);
      });
    });
    var vertexByMember = new Map();
    (geometry && geometry.vertexIds || []).forEach(function (id, i) {
      if (geometry.vertices && geometry.vertices[i]) vertexByMember.set(id, geometry.vertices[i]);
    });
    var evidence = (geometry && geometry.frameEvidence) || [];
    var pointRank = evidence.length ? Math.min.apply(null, evidence.map(function (e) { return e.rank; })) : 0;
    var pointConflicts = evidence.filter(function (e) { return e.conflict; }).length;
    evidence.forEach(function (entry) {
      if (entry.conflict) issues.push({ code: 'aux-point-conflict', entityId: null, memberId: entry.memberId,
        message: 'Auxiliary observations for member ' + entry.memberId + ' are contradictory.' });
      else if (entry.rank < 3) issues.push({ code: 'aux-point-underdetermined', entityId: null, memberId: entry.memberId,
        message: 'Auxiliary observations for member ' + entry.memberId + ' have rank ' + entry.rank + '.' });
    });
    (entities || []).forEach(function (e) {
      if (!e || e.viewRole !== 'AUX') return;
      var frame = registry.frameFor(e);
      if (!frame) {
        unresolved.add(e.id);
        issues.push({ code: 'aux-frame-missing', entityId: e.id,
          message: 'Auxiliary entity ' + e.id + ' has no usable frame declaration.' });
        return;
      }
      if (curveSources.has(e.id)) {
        consumed.add(e.id);
        return;
      }
      if (e.meta && e.meta.ellipse) {
        unresolved.add(e.id);
        if (issueByCurve.has(e.id)) issues.push(issueByCurve.get(e.id));
        return;
      }
      if (e.type === 'POINT') {
        var ids = memberIds(e);
        var fitted = fittedStations.has(e.id);
        ids.forEach(function (id) {
          var vertex = vertexByMember.get(id);
          if (!vertex) {
            if (!fittedStations.has(e.id)) unresolved.add(e.id);
            return;
          }
          var q = project(frame, vertex);
          if (!q || Math.hypot(q.x - e.x, q.y - e.y) > RESIDUAL_MM) {
            unresolved.add(e.id);
            issues.push({ code: 'aux-reprojection-mismatch', entityId: e.id, memberId: id,
              message: 'Auxiliary point ' + e.id + ' does not match reconstructed member ' + id + '.' });
            return;
          }
          fitted = true;
        });
        if (fitted && !unresolved.has(e.id)) consumed.add(e.id);
        else if (!ids.length) {
          unresolved.add(e.id);
          if (!stations.has(e.id)) issues.push({ code: 'aux-point-unresolved', entityId: e.id,
            message: 'Auxiliary point ' + e.id + ' has no spatial member identity.' });
        }
        return;
      }
      if (e.type === 'SEGMENT') {
        var members = endpointMembers(e, byId);
        if (!members || !members.length) {
          unresolved.add(e.id);
          issues.push({ code: 'aux-stroke-unresolved', entityId: e.id,
            message: 'Auxiliary edge ' + e.id + ' has no resolved endpoint identities.' });
          return;
        }
        var a = vertexByMember.get(members[0]), b = vertexByMember.get(members[1]);
        var qa = a && project(frame, a), qb = b && project(frame, b);
        if (qa && qb && Math.hypot(qa.x - e.x, qa.y - e.y) <= RESIDUAL_MM &&
            Math.hypot(qb.x - e.x2, qb.y - e.y2) <= RESIDUAL_MM) consumed.add(e.id);
        else {
          unresolved.add(e.id);
          issues.push({ code: 'aux-reprojection-mismatch', entityId: e.id,
            message: 'Auxiliary edge ' + e.id + ' does not match its reconstructed endpoints.' });
        }
        return;
      }
      unresolved.add(e.id);
      issues.push(issueByCurve.get(e.id) || { code: 'aux-curve-unsupported', entityId: e.id,
        message: 'Auxiliary ' + e.type + ' ' + e.id + ' is retained but not reconstructed in this frame.' });
    });
    var residual = 0;
    evidence.forEach(function (e) { if (finite(e.residual)) residual = Math.max(residual, e.residual); });
    return {
      contract: 'aux-view-frame-v1',
      status: issues.length || unresolved.size ? 'issues' : 'ok',
      frames: registry.list.map(function (f) { return f.id; }),
      issues: issues, residual: residual,
      pointRank: pointRank, pointConflicts: pointConflicts,
      consumedIds: Array.from(consumed), unresolvedIds: Array.from(unresolved)
    };
  }

  return {
    EPS: EPS, RESIDUAL_MM: RESIDUAL_MM,
    standard: standard, fromProfile: fromProfile, forEntity: forEntity, declaration: declaration,
    resolve: resolve, frameFor: function (registry, entity) {
      return registry && registry.frameFor ? registry.frameFor(entity) : null;
    },
    project: project, direction: direction, unproject: unproject,
    observationRows: observationRows, solveObservations: solveObservations,
    residualAt: residualAt, audit: audit
  };
});

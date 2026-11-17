(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-entities.js'));
  else root.EduCADConic = factory(root.EduCADEntities);
})(typeof window !== 'undefined' ? window : globalThis, function (Entities) {
  'use strict';

  var TAU = 2 * Math.PI, EPS = 1e-9;
  var ROLE_PAIR = [
    {a:'PLAN', b:'ELEVATION', shared:'x', first:'z', second:'y'},
    {a:'PLAN', b:'PROFILE', shared:'z', first:'x', second:'y'},
    {a:'ELEVATION', b:'PROFILE', shared:'y', first:'x', second:'z'}
  ];

  function finite(v) { return Number.isFinite(v); }
  function vec(p) {
    return p && finite(p.x) && finite(p.y) ? {x:p.x, y:p.y} : null;
  }
  function resolveEntity(entities, ref, type) {
    if (!ref) return null;
    if (Entities && Entities.resolveReference)
      return Entities.resolveReference(entities || [], ref, type || null);
    var list = entities || [], exact = list.find(function (e) { return e && e.id === ref; });
    if (exact) return !type || exact.type === type ? exact : null;
    var matches = list.filter(function (e) {
      return e && (!type || e.type === type) && (e.name === ref || e.caption === ref);
    });
    return matches.length === 1 ? matches[0] : null;
  }
  function roleOfPoint(p) {
    if (!p) return null;
    if (p.viewRole === 'PLAN' || p.viewRole === 'ELEVATION' || p.viewRole === 'PROFILE')
      return p.viewRole;
    if (!p.viewRole || p.viewRole === 'BOTH') return p.y > 0 ? 'ELEVATION' : p.y < 0 ? 'PLAN' : null;
    return null;
  }
  function add(a, b) { return {x:a.x+b.x, y:a.y+b.y}; }
  function sub(a, b) { return {x:a.x-b.x, y:a.y-b.y}; }
  function mul(a, s) { return {x:a.x*s, y:a.y*s}; }
  function mul3(a, s) { return {x:a.x*s, y:a.y*s, z:a.z*s}; }
  function dot3(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
  function len3(a) { return Math.hypot(a.x, a.y, a.z); }
  function add3(a, b) { return {x:a.x+b.x, y:a.y+b.y, z:a.z+b.z}; }
  function cross3(a, b) {
    return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x};
  }
  function dot(a, b) { return a.x*b.x + a.y*b.y; }
  function len(a) { return Math.hypot(a.x, a.y); }
  function pointAt(def, angle) {
    return add(def.center, add(mul(def.a, Math.cos(angle)), mul(def.b, Math.sin(angle))));
  }
  function segmentAt(def, index) {
    var p0 = pointAt(def, TAU * index / def.count);
    var p1 = pointAt(def, TAU * (index + 1) / def.count);
    return [p0, p1];
  }
  function nearPoint(p, q, tol) {
    return Math.hypot(p.x-q.x, p.y-q.y) <= tol;
  }
  function sameDef(a, b) {
    return a.role === b.role && a.count === b.count &&
      a.center.x === b.center.x && a.center.y === b.center.y &&
      a.a.x === b.a.x && a.a.y === b.a.y &&
      a.b.x === b.b.x && a.b.y === b.b.y &&
      a.centerRef === b.centerRef;
  }
  function canonical(raw, entity) {
    if (!raw || typeof raw !== 'object') return {error:'missing ellipse definition'};
    if (raw.kind !== undefined && raw.kind !== 'ellipse' && raw.kind !== 'conic')
      return {error:'unknown conic kind'};
    if (raw.exact === false) return {error:'definition is not exact'};
    var group = typeof raw.group === 'string' && raw.group ? raw.group : null;
    if (!group) return {error:'missing conic group id'};
    var center = vec(raw.center);
    if (!center) return {error:'conic center is not finite'};
    var a = vec(raw.a), b = vec(raw.b);
    if (!a || !b) {
      var u = vec(raw.u), v = vec(raw.v);
      var ru = Number(raw.radiusU), rv = Number(raw.radiusV);
      if (u && v && ru > 0 && rv > 0) { a = mul(u, ru); b = mul(v, rv); }
      else if (ru > 0 && rv > 0 && !u && !v) { a = {x:ru, y:0}; b = {x:0, y:rv}; }
      else return {error:'conic basis vectors are missing'};
    }
    var shapeScale = Math.max(1e-12, len(a), len(b));
    var det = a.x*b.y - a.y*b.x;
    if (!(Math.abs(det) > 1e-12 * shapeScale * shapeScale))
      return {error:'conic basis vectors are dependent'};
    var count = Number(raw.count);
    if (!Number.isInteger(count) || count < 3 || count > 4096)
      return {error:'invalid conic segment count'};
    var index = Number(raw.index);
    if (!Number.isInteger(index) || index < 0 || index >= count)
      return {error:'invalid conic segment index'};
    var role = raw.role || (entity && entity.viewRole);
    if (['PLAN','ELEVATION','PROFILE'].indexOf(role) === -1)
      return {error:'invalid conic view role'};
    if (entity && ['PLAN','ELEVATION','PROFILE'].indexOf(entity.viewRole) !== -1 &&
        entity.viewRole !== role)
      return {error:'segment role disagrees with conic definition'};
    var centerRef = typeof raw.centerRef === 'string' && raw.centerRef ? raw.centerRef :
      entity && entity.meta && typeof entity.meta.centerRef === 'string' ? entity.meta.centerRef : null;
    return {def:{group:group, kind:'ellipse', exact:true, center:center, a:a, b:b,
      count:count, index:index, role:role, centerRef:centerRef, scale:shapeScale}};
  }
  function definition(entity) {
    if (!entity || entity.type !== 'SEGMENT' || !entity.meta || !entity.meta.ellipse) return null;
    var parsed = canonical(entity.meta.ellipse, entity);
    return parsed.error ? null : parsed.def;
  }
  function collect(entities) {
    var groups = new Map(), invalid = [];
    (entities || []).forEach(function (entity) {
      if (!entity || entity.type !== 'SEGMENT' || !entity.meta || !entity.meta.ellipse) return;
      var parsed = canonical(entity.meta.ellipse, entity), raw = entity.meta.ellipse;
      if (parsed.error) {
        invalid.push({entityId:entity.id,
          group:raw && typeof raw === 'object' && typeof raw.group === 'string' ? raw.group : null,
          code:'conic-definition-invalid', message:parsed.error});
        return;
      }
      var def = parsed.def;
      var rawCenter = raw && typeof raw === 'object' &&
        typeof raw.centerRef === 'string' && raw.centerRef ? raw.centerRef : null;
      var outerCenter = entity.meta && typeof entity.meta.centerRef === 'string' &&
        entity.meta.centerRef ? entity.meta.centerRef : null;
      var rawPoint = rawCenter ? resolveEntity(entities, rawCenter, 'POINT') : null;
      var outerPoint = outerCenter ? resolveEntity(entities, outerCenter, 'POINT') : null;
      if (rawCenter && !rawPoint) {
        invalid.push({entityId:entity.id, group:def.group,
          code:'conic-center-reference-invalid',
          message:'The ellipse centre reference does not resolve to a point.'});
        return;
      }
      if (outerCenter && !outerPoint) {
        invalid.push({entityId:entity.id, group:def.group,
          code:'conic-center-reference-invalid',
          message:'The ellipse centre reference does not resolve to a point.'});
        return;
      }
      if (rawPoint && outerPoint && rawPoint.id !== outerPoint.id) {
        invalid.push({entityId:entity.id, group:def.group,
          code:'conic-center-reference-invalid',
          message:'The nested and outer ellipse centre references disagree.'});
        return;
      }
      var centerPoint = rawPoint || outerPoint;
      if (centerPoint) {
        var pointRole = roleOfPoint(centerPoint);
        if (pointRole !== def.role) {
          invalid.push({entityId:entity.id, group:def.group,
            code:'conic-center-reference-invalid',
            message:'The ellipse centre point is not in the same declared view.'});
          return;
        }
        var shape = Math.max(1e-12, len(def.a), len(def.b));
        var tol = 1e-9*shape + 1e-12*Math.max(1, Math.abs(def.center.x), Math.abs(def.center.y));
        if (Math.abs(centerPoint.x-def.center.x) > tol ||
            Math.abs(centerPoint.y-def.center.y) > tol) {
          invalid.push({entityId:entity.id, group:def.group,
            code:'conic-center-reference-invalid',
            message:'The ellipse centre point does not agree with the analytic definition.'});
          return;
        }
        def.centerRef = centerPoint.id;
      } else {
        def.centerRef = null;
      }
      var entry = groups.get(def.group);
      if (!entry) { entry = {id:def.group, defs:[], entities:[]}; groups.set(def.group, entry); }
      entry.defs.push(def);
      entry.entities.push(entity);
    });
    var out = [];
    groups.forEach(function (entry) {
      var base = entry.defs[0], problem = null;
      for (var i = 1; i < entry.defs.length; i++)
        if (!sameDef(base, entry.defs[i])) { problem = 'conic group definitions disagree'; break; }
      if (!problem && entry.defs.length !== base.count)
        problem = 'incomplete conic group: expected ' + base.count + ' segments, found ' + entry.defs.length;
      var ordered = [], indexes = Object.create(null);
      if (!problem) entry.defs.forEach(function (def) {
        if (indexes[def.index]) { problem = 'duplicate conic segment index ' + def.index; return; }
        indexes[def.index] = true;
        ordered[def.index] = entry.entities[entry.defs.indexOf(def)];
      });
      for (var k = 0; !problem && k < base.count; k++)
        if (!ordered[k]) problem = 'missing conic segment index ' + k;
      var shape = Math.max(1e-12, len(base.a), len(base.b));
      var tol = 1e-9 * shape + 1e-12 * Math.max(1,
        Math.abs(base.center.x), Math.abs(base.center.y));
      for (var s = 0; !problem && s < base.count; s++) {
        var expected = segmentAt(base, s), e = ordered[s];
        var forward = nearPoint({x:e.x,y:e.y}, expected[0], tol) && nearPoint({x:e.x2,y:e.y2}, expected[1], tol);
        var reverse = nearPoint({x:e.x,y:e.y}, expected[1], tol) && nearPoint({x:e.x2,y:e.y2}, expected[0], tol);
        if (!forward && !reverse) problem = 'conic segment ' + s + ' no longer matches its analytic definition';
      }
      if (problem) {
        invalid.push({entityId:entry.entities[0].id, group:entry.id,
          code:'conic-definition-invalid', message:problem});
        return;
      }
      out.push({id:entry.id, role:base.role, definition:base, count:base.count,
        segments:ordered, segmentIds:ordered.map(function (e) { return e.id; }),
        center:base.center, a:base.a, b:base.b});
    });
    return {groups:out, invalid:invalid};
  }
  function viewQ(group) {
    var a = group.a, b = group.b;
    return {q00:a.x*a.x+b.x*b.x, q01:a.x*a.y+b.x*b.y, q11:a.y*a.y+b.y*b.y};
  }
  function viewData(group, profile) {
    var q = viewQ(group);
    if (group.role === 'PLAN')
      return {role:'PLAN', center:{x:group.center.x, z:-group.center.y},
        q:{xx:q.q00, xz:-q.q01, zz:q.q11}};
    if (group.role === 'ELEVATION')
      return {role:'ELEVATION', center:{x:group.center.x, y:group.center.y},
        q:{xx:q.q00, xy:q.q01, yy:q.q11}};
    if (group.role === 'PROFILE' && profile) {
      var s2 = profile.s * profile.s;
      return {role:'PROFILE',
        center:{z:profile.dRef + (group.center.x - profile.xRef) / profile.s, y:group.center.y},
        q:{zz:q.q00 / s2, zy:q.q01 / profile.s, yy:q.q11}};
    }
    return null;
  }
  function mergeCenter(a, b) {
    var out = {}, tol = 1e-6;
    var parts = [a, b];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) return null;
      Object.keys(p).forEach(function (key) {
        if (out[key] !== undefined && Math.abs(out[key] - p[key]) > tol) out.conflict = true;
        else out[key] = p[key];
      });
      if (out.conflict) return null;
    }
    return out.x !== undefined && out.y !== undefined && out.z !== undefined ? out : null;
  }
  function axisIndex(axis) { return axis === 'x' ? 0 : axis === 'y' ? 1 : 2; }
  function setSym(Q, a, b, value) {
    Q[axisIndex(a)][axisIndex(b)] = value;
    Q[axisIndex(b)][axisIndex(a)] = value;
  }
  function getSym(Q, a, b) { return Q[axisIndex(a)][axisIndex(b)]; }
  function eigenSym(Q) {
    var A = [[Q[0][0],Q[0][1],Q[0][2]],[Q[1][0],Q[1][1],Q[1][2]],[Q[2][0],Q[2][1],Q[2][2]]];
    var V = [[1,0,0],[0,1,0],[0,0,1]];
    for (var iter = 0; iter < 64; iter++) {
      var p = 0, r = 1, best = 0;
      for (var i = 0; i < 3; i++) for (var j = i + 1; j < 3; j++) {
        var value = Math.abs(A[i][j]);
        if (value > best) { best = value; p = i; r = j; }
      }
      var scale = Math.max(1, Math.abs(A[0][0]), Math.abs(A[1][1]), Math.abs(A[2][2]), best);
      if (best <= 1e-14 * scale) break;
      var theta = 0.5 * Math.atan2(2*A[p][r], A[r][r]-A[p][p]);
      var c = Math.cos(theta), s = Math.sin(theta);
      for (var k = 0; k < 3; k++) {
        var akp = A[k][p], akr = A[k][r];
        A[k][p] = c*akp - s*akr; A[k][r] = s*akp + c*akr;
      }
      for (var l = 0; l < 3; l++) {
        var apl = A[p][l], arl = A[r][l];
        A[p][l] = c*apl - s*arl; A[r][l] = s*apl + c*arl;
      }
      for (var m = 0; m < 3; m++) {
        var vmp = V[m][p], vmr = V[m][r];
        V[m][p] = c*vmp - s*vmr; V[m][r] = s*vmp + c*vmr;
      }
    }
    var values = [A[0][0],A[1][1],A[2][2]];
    var vectors = [
      {x:V[0][0],y:V[1][0],z:V[2][0]},
      {x:V[0][1],y:V[1][1],z:V[2][1]},
      {x:V[0][2],y:V[1][2],z:V[2][2]}
    ];
    for (var a = 0; a < 3; a++) for (var b = a + 1; b < 3; b++)
      if (values[b] > values[a]) {
        var tv = values[a]; values[a] = values[b]; values[b] = tv;
        var tq = vectors[a]; vectors[a] = vectors[b]; vectors[b] = tq;
      }
    return {values:values, vectors:vectors};
  }
  function fullQ(Q) {
    return {xx:Q[0][0], xy:Q[0][1], xz:Q[0][2],
      yy:Q[1][1], yz:Q[1][2], zz:Q[2][2]};
  }
  function rank2Factor(Q) {
    var rows = [[Q[0][0],Q[0][1],Q[0][2]],[Q[1][0],Q[1][1],Q[1][2]],
      [Q[2][0],Q[2][1],Q[2][2]]];
    var maxEntry = 1;
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++)
      maxEntry = Math.max(maxEntry, Math.abs(Q[i][j]));
    var best = null;
    for (var p = 0; p < 3; p++) for (var q = p + 1; q < 3; q++) {
      var rp = {x:rows[p][0],y:rows[p][1],z:rows[p][2]};
      var rq = {x:rows[q][0],y:rows[q][1],z:rows[q][2]};
      var n = cross3(rp, rq), l = len3(n);
      if (!best || l > best.l) best = {n:n, l:l};
    }
    if (!best || !(best.l > 1e-14 * maxEntry))
      return null;
    var normal = mul3(best.n, 1/best.l);
    for (var r = 0; r < 3; r++) {
      var row = {x:rows[r][0],y:rows[r][1],z:rows[r][2]};
      if (Math.abs(dot3(row, normal)) > 1e-8 * maxEntry) return null;
    }
    var ref = Math.abs(normal.x) < 0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0};
    var e1 = cross3(normal, ref), l1 = len3(e1);
    if (!(l1 > 1e-14)) return null;
    e1 = mul3(e1, 1/l1);
    var e2 = cross3(normal, e1);
    function qf(a, b) {
      return a.x*(Q[0][0]*b.x+Q[0][1]*b.y+Q[0][2]*b.z) +
        a.y*(Q[1][0]*b.x+Q[1][1]*b.y+Q[1][2]*b.z) +
        a.z*(Q[2][0]*b.x+Q[2][1]*b.y+Q[2][2]*b.z);
    }
    var a = qf(e1,e1), b = qf(e1,e2), c = qf(e2,e2);
    var trace = a + c, disc = Math.sqrt(Math.max(0, (a-c)*(a-c) + 4*b*b));
    var large = (trace + disc) / 2;
    if (!(large > 0)) return null;
    var det = a*c - b*b;
    var detTol = 1e-12 * Math.max(1, Math.abs(a*c), Math.abs(b*b));
    if (det < -detTol) return null;
    var small = det > 0 ? det / large : 0;
    var theta = 0.5 * Math.atan2(2*b, a-c);
    var d1 = {x:Math.cos(theta), y:Math.sin(theta)};
    var d2 = {x:-Math.sin(theta), y:Math.cos(theta)};
    var v1 = add3(mul3(e1,d1.x), mul3(e2,d1.y));
    var v2 = add3(mul3(e1,d2.x), mul3(e2,d2.y));
    return {values:[large,small], vectors:[v1,v2], normal:normal, det:det};
  }
  function solvePair(first, second, profile) {
    var d1 = viewData(first, profile), d2 = viewData(second, profile);
    if (!d1 || !d2) return {issue:{code:'conic-profile-frame-missing',
      entityId:first.segmentIds[0], message:'The profile projection needs a declared side-view frame.'}};
    var pair = null;
    ROLE_PAIR.forEach(function (rec) {
      if (!pair && ((first.role === rec.a && second.role === rec.b) ||
          (first.role === rec.b && second.role === rec.a)))
        pair = rec;
    });
    if (!pair) return {issue:{code:'conic-projection-conflict', entityId:first.segmentIds[0],
      message:'The two exact conics are in the same view.'}};
    var left = first.role === pair.a ? d1 : d2, right = first.role === pair.a ? d2 : d1;
    function qv(view, axis1, axis2) {
      var direct = axis1 + axis2, reverse = axis2 + axis1;
      return view.q[direct] !== undefined ? view.q[direct] : view.q[reverse];
    }
    var a = qv(left, pair.shared, pair.shared);
    var a2 = qv(right, pair.shared, pair.shared);
    var b = qv(left, pair.shared, pair.first), d = qv(left, pair.first, pair.first);
    var c = qv(right, pair.shared, pair.second), e = qv(right, pair.second, pair.second);
    var scaleS = Math.sqrt(Math.max(0, a));
    var scaleA = Math.sqrt(Math.max(0, d));
    var scaleB = Math.sqrt(Math.max(0, e));
    if (!(scaleS > 0) || !(scaleA > 0) || !(scaleB > 0))
      return {issue:{code:'conic-lift-degenerate-shared-axis', entityId:first.segmentIds[0],
        message:'A projected covariance block is rank one; the view is not a full ellipse and leaves an affine continuum.'}};
    var diagTol = 1e-7 * Math.max(1e-12, Math.abs(a), Math.abs(a2));
    if (Math.abs(a - a2) > diagTol)
      return {issue:{code:'conic-projection-conflict', entityId:first.segmentIds[0],
        message:'The two views disagree on the shared-axis variance of the spatial ellipse.'}};
    var r1 = b / (scaleS*scaleA), r2 = c / (scaleS*scaleB);
    var corrTol = 1e-7;
    if (Math.abs(r1) > 1 + corrTol || Math.abs(r2) > 1 + corrTol)
      return {issue:{code:'conic-projection-conflict', entityId:first.segmentIds[0],
        message:'The two projected ellipses do not admit a real rank-two spatial covariance.'}};
    var minor1 = 1 - r1*r1, minor2 = 1 - r2*r2;
    if (minor1 < -corrTol || minor2 < -corrTol)
      return {issue:{code:'conic-projection-conflict', entityId:first.segmentIds[0],
        message:'The two projected ellipses do not admit a real rank-two spatial covariance.'}};
    var rootNorm = Math.sqrt(Math.max(0, minor1*minor2));
    var rNorm1 = r1*r2 + rootNorm, rNorm2 = r1*r2 - rootNorm;
    var r1phys = scaleA*scaleB*rNorm1, r2phys = scaleA*scaleB*rNorm2;
    var centers = mergeCenter(left.center, right.center);
    if (!centers)
      return {issue:{code:'conic-center-conflict', entityId:first.segmentIds[0],
        message:'The projected ellipse centers disagree in their shared view coordinates.'}};
    var values = rootNorm <= 1e-12 ? [r1phys] : [r1phys, r2phys];
    var candidates = [];
    values.forEach(function (r) {
      var Q = [[0,0,0],[0,0,0],[0,0,0]];
      setSym(Q, pair.shared, pair.shared, a);
      setSym(Q, pair.shared, pair.first, b);
      setSym(Q, pair.shared, pair.second, c);
      setSym(Q, pair.first, pair.first, d);
      setSym(Q, pair.second, pair.second, e);
      setSym(Q, pair.first, pair.second, r);
      var factor = rank2Factor(Q);
      if (!factor) return;
      candidates.push({center:centers, q:Q, values:factor.values.slice(), vectors:factor.vectors.slice(),
        normal:factor.normal, shared:pair.shared, firstAxis:pair.first, secondAxis:pair.second,
        missingCovariance:r, scale:Math.sqrt(Math.max(0, factor.values[0]))});
    });
    if (!candidates.length)
      return {issue:{code:'conic-projection-conflict', entityId:first.segmentIds[0],
        message:'The completed covariance is not positive semidefinite rank two.'}};
    return {candidates:candidates};
  }
  function profileViewQ(candidate, role, profile) {
    var Q = candidate.q, center = candidate.center;
    if (role === 'PLAN')
      return {center:{x:center.x, y:-center.z}, q:{q00:Q[0][0], q01:-Q[0][2], q11:Q[2][2]}};
    if (role === 'ELEVATION')
      return {center:{x:center.x, y:center.y}, q:{q00:Q[0][0], q01:Q[0][1], q11:Q[1][1]}};
    if (role === 'PROFILE' && profile) {
      var s2 = profile.s * profile.s;
      return {center:{x:profile.xRef + profile.s*(center.z - profile.dRef), y:center.y},
        q:{q00:s2*Q[2][2], q01:profile.s*Q[1][2], q11:Q[1][1]}};
    }
    return null;
  }
  function qNear(a, b, tol) {
    function near(x, y) {
      var scale = Math.max(1e-12, Math.abs(x), Math.abs(y));
      return Math.abs(x-y) <= tol*scale + 1e-12;
    }
    return near(a.q00, b.q00) && near(a.q01, b.q01) && near(a.q11, b.q11);
  }
  function centerNear(a, b, tol, scale) {
    var s = Math.max(1e-12, scale || 1);
    return Math.abs(a.x-b.x) <= tol*s && Math.abs(a.y-b.y) <= tol*s;
  }
  function thirdMatches(candidate, group, profile) {
    var view = profileViewQ(candidate, group.role, profile);
    if (!view) return false;
    var q = viewQ(group);
    var shape = Math.sqrt(Math.max(0, candidate.values[0]));
    return centerNear(view.center, group.center, 1e-7, shape) &&
      qNear(view.q, q, 1e-7);
  }
  function onGroup(group, p) {
    var q = sub(p, group.center), a = group.a, b = group.b;
    var det = a.x*b.y - a.y*b.x;
    if (!(Math.abs(det) > EPS)) return false;
    var alpha = (q.x*b.y - q.y*b.x) / det;
    var beta = (a.x*q.y - a.y*q.x) / det;
    return Math.abs(Math.hypot(alpha, beta) - 1) <= 1e-6;
  }
  function pointCoordinates(p, role, profile) {
    if (role === 'PLAN') return {x:p.x, z:-p.y};
    if (role === 'ELEVATION') return {x:p.x, y:p.y};
    if (role === 'PROFILE' && profile)
      return {z:profile.dRef + (p.x - profile.xRef) / profile.s, y:p.y};
    return null;
  }
  function linkedPoints(entities, first, second, profile) {
    var byMember = new Map();
    (entities || []).forEach(function (e) {
      if (!e || e.type !== 'POINT' || !e.meta || !Array.isArray(e.meta.members)) return;
      var role = e.viewRole;
      if (role !== first.role && role !== second.role) return;
      var group = role === first.role ? first : second;
      if (!onGroup(group, {x:e.x, y:e.y})) return;
      e.meta.members.forEach(function (m) {
        if (!m || typeof m.id !== 'string') return;
        if (!byMember.has(m.id)) byMember.set(m.id, []);
        byMember.get(m.id).push(e);
      });
    });
    var out = [], seen = new Set();
    byMember.forEach(function (points, id) {
      var left = points.filter(function (p) { return p.viewRole === first.role; });
      var right = points.filter(function (p) { return p.viewRole === second.role; });
      left.forEach(function (p) { right.forEach(function (q) {
        var key = id + '|' + p.id + '|' + q.id;
        if (seen.has(key)) return;
        var position = mergeCenter(pointCoordinates(p, first.role, profile),
          pointCoordinates(q, second.role, profile));
        if (!position) return;
        seen.add(key);
        out.push({memberId:id, pointIds:[p.id,q.id], position:position});
      }); });
    });
    return out;
  }
  function endpointIdentity(entity, index, entities) {
    var meta = entity && entity.meta || {};
    var refs = Array.isArray(meta.endpointRefs) ? meta.endpointRefs : Array.isArray(meta.refs) ? meta.refs : null;
    var explicit = !!refs || Array.isArray(meta.endpointMemberIds) ||
      meta.fromMemberId || meta.toMemberId;
    if (!explicit) return {explicit:false};
    if (Array.isArray(meta.endpointMemberIds)) {
      var id = meta.endpointMemberIds[index];
      return id ? {explicit:true, memberId:id, resolved:true} : {explicit:true, dangling:true};
    }
    if (index === 0 && meta.fromMemberId)
      return {explicit:true, memberId:meta.fromMemberId, resolved:true};
    if (index === 1 && meta.toMemberId)
      return {explicit:true, memberId:meta.toMemberId, resolved:true};
    if (!refs) return {explicit:true, dangling:true};
    var point = (entities || []).find(function (e) {
      return e && e.id === refs[index] && e.type === 'POINT';
    });
    if (!point) return {explicit:true, dangling:true};
    var members = point.meta && Array.isArray(point.meta.members) ? point.meta.members : [];
    if (members.length === 1 && members[0] && typeof members[0].id === 'string')
      return {explicit:true, memberId:members[0].id, resolved:true, pointId:point.id};
    return {explicit:true, memberId:'point:' + point.id, resolved:true, pointId:point.id};
  }
  function segmentEndpointObservations(entities, first, second, profile) {
    var roles = {};
    roles[first.role] = first;
    roles[second.role] = second;
    var scale = Math.max(1, Math.hypot(first.a.x, first.a.y), Math.hypot(first.b.x, first.b.y),
      Math.hypot(second.a.x, second.a.y), Math.hypot(second.b.x, second.b.y));
    var tol = 1e-6 * scale;
    var issues = [], raw = [], byRole = {PLAN:[], ELEVATION:[], PROFILE:[]};
    (entities || []).forEach(function (entity) {
      if (!entity || entity.type !== 'SEGMENT') return;
      if (entity.meta && entity.meta.ellipse) return;
      if (entity.meta && (entity.meta.reconstructionRole === 'construction' ||
          ['axis', 'projector', 'locus'].indexOf(entity.meta.kind) !== -1)) return;
      var role = entity.viewRole;
      var group = roles[role];
      if (!group) return;
      var points = [{x:entity.x, y:entity.y}, {x:entity.x2, y:entity.y2}];
      points.forEach(function (p, index) {
        if (!onGroup(group, p)) return;
        var identity = endpointIdentity(entity, index, entities);
        if (identity.dangling) {
          issues.push({code:'conic-observation-reference-missing', entityId:entity.id,
            message:'A segment endpoint reference is dangling; the boundary observation is left unresolved rather than guessed from geometry.'});
          return;
        }
        if (identity.resolved) return;
        raw.push({role:role, x:p.x, y:p.y, segmentId:entity.id, endpointIndex:index,
          hardId:null});
      });
    });
    function clustersFor(role) {
      var list = raw.filter(function (o) { return o.role === role; });
      var clusters = [];
      list.forEach(function (o) {
        var cluster = clusters.find(function (c) {
          if (Math.hypot(c.x - o.x, c.y - o.y) > tol) return false;
          if (c.hardId && o.hardId && c.hardId !== o.hardId) return false;
          return true;
        });
        if (!cluster) {
          cluster = {role:role, x:o.x, y:o.y, hardId:o.hardId, sources:[]};
          clusters.push(cluster);
        }
        if (o.hardId && !cluster.hardId) cluster.hardId = o.hardId;
        cluster.sources.push({segmentId:o.segmentId, endpointIndex:o.endpointIndex, role:role});
      });
      return clusters;
    }
    var left = clustersFor(first.role), right = clustersFor(second.role);
    function sharedAxis(a, b) {
      if ((a === 'PLAN' && b === 'ELEVATION') || (a === 'ELEVATION' && b === 'PLAN')) return 'x';
      if ((a === 'PLAN' && b === 'PROFILE') || (a === 'PROFILE' && b === 'PLAN')) return 'z';
      if ((a === 'ELEVATION' && b === 'PROFILE') || (a === 'PROFILE' && b === 'ELEVATION')) return 'y';
      return null;
    }
    var axis = sharedAxis(first.role, second.role);
    if (!axis) return {evidence:issues.length ? [] : [], issues:issues};
    function coordinateOf(cluster) {
      var c = pointCoordinates(cluster, cluster.role, profile);
      return c ? c[axis] : null;
    }
    var leftCoordinates = left.map(coordinateOf), rightCoordinates = right.map(coordinateOf);
    function matches(index, coordinates, otherCoordinates) {
      var out = [];
      otherCoordinates.forEach(function (value, j) {
        if (value === null || Math.abs(value - coordinates[index]) <= tol) out.push(j);
      });
      return out;
    }
    var evidence = [];
    left.forEach(function (l, i) {
      var forward = matches(i, leftCoordinates, rightCoordinates);
      if (forward.length !== 1) return;
      var j = forward[0];
      var reverse = matches(j, rightCoordinates, leftCoordinates);
      if (reverse.length !== 1 || reverse[0] !== i) return;
      var r = right[j], position = mergeCenter(pointCoordinates(l, first.role, profile),
        pointCoordinates(r, second.role, profile));
      if (!position) return;
      var sources = l.sources.concat(r.sources);
      evidence.push({memberId:'endpoint:' + sources.map(function (s) {
        return s.segmentId + ':' + s.endpointIndex;
      }).join('|'), position:position, pointIds:[], sources:sources});
    });
    return {evidence:evidence, issues:issues};
  }
  function candidatePointResidual(candidate, position) {
    var d = {x:position.x-candidate.center.x, y:position.y-candidate.center.y,
      z:position.z-candidate.center.z};
    var u = candidate.vectors[0], v = candidate.vectors[1];
    var ru = Math.sqrt(Math.max(0, candidate.values[0]));
    var rv = Math.sqrt(Math.max(0, candidate.values[1]));
    var alpha = (d.x*u.x + d.y*u.y + d.z*u.z) / ru;
    var beta = (d.x*v.x + d.y*v.y + d.z*v.z) / rv;
    var n = {
      x:u.y*v.z-u.z*v.y, y:u.z*v.x-u.x*v.z, z:u.x*v.y-u.y*v.x
    };
    return Math.max(Math.abs(Math.hypot(alpha, beta) - 1),
      Math.abs((d.x*n.x + d.y*n.y + d.z*n.z) / Math.max(ru, rv)));
  }
  function pointFit(candidate, evidence) {
    if (!evidence.length) return {tested:0, ok:true, residual:0};
    var residual = 0;
    evidence.forEach(function (e) {
      residual = Math.max(residual, candidatePointResidual(candidate, e.position));
    });
    return {tested:evidence.length, ok:residual <= 1e-6, residual:residual};
  }
  function orient(vectors) {
    var u = vectors[0], v = vectors[1];
    function dominantPositive(p) {
      var ax = Math.abs(p.x), ay = Math.abs(p.y), az = Math.abs(p.z);
      if (ax >= ay && ax >= az) return p.x > 0;
      if (ay >= az) return p.y > 0;
      return p.z > 0;
    }
    function negate(p) { return {x:-p.x,y:-p.y,z:-p.z}; }
    if (!dominantPositive(u)) u = negate(u);
    var n = {x:u.y*v.z-u.z*v.y, y:u.z*v.x-u.x*v.z, z:u.x*v.y-u.y*v.x};
    if (!dominantPositive(n)) {
      v = negate(v);
      n = negate(n);
    }
    return {u:u, v:v, n:n};
  }
  function basisFromNormal(n) {
    var ref = Math.abs(n.x) < 0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0};
    var u = {x:n.y*ref.z-n.z*ref.y, y:n.z*ref.x-n.x*ref.z, z:n.x*ref.y-n.y*ref.x};
    var l = Math.hypot(u.x,u.y,u.z);
    u = {x:u.x/l, y:u.y/l, z:u.z/l};
    var v = {x:n.y*u.z-n.z*u.y, y:n.z*u.x-n.x*u.z, z:n.x*u.y-n.y*u.x};
    return {u:u, v:v};
  }
  function makeCurve(candidate, roles, groups) {
    var values = candidate.values, vectors = candidate.vectors;
    var ru = Math.sqrt(Math.max(0, values[0])), rv = Math.sqrt(Math.max(0, values[1]));
    if (!(ru > EPS) || !(rv > EPS)) return null;
    var oriented = orient(vectors);
    var circular = Math.abs(ru - rv) <= 1e-6 * Math.max(1, ru);
    var frames = oriented;
    if (circular) {
      var b = basisFromNormal(oriented.n);
      frames = {u:b.u, v:b.v, n:oriented.n};
    }
    var aVec = mul3(frames.u, ru), bVec = mul3(frames.v, rv);
    var sourceIds = [];
    groups.forEach(function (g) { sourceIds = sourceIds.concat(g.segmentIds); });
    sourceIds = Array.from(new Set(sourceIds));
    var curve = {
      kind:circular ? 'circle' : 'ellipse',
      center:{x:candidate.center.x,y:candidate.center.y,z:candidate.center.z},
      u:frames.u, v:frames.v,
      radiusU:ru, radiusV:rv,
      startAngle:0, sweepAngle:TAU, closed:true,
      analytic:true, sourceExact:true, exact:false, fitted:false, inferred:true,
      provenance:{source:'exact-planar-conic-definitions',
        reconstruction:'orthographic-rational-covariance-lift',
        status:'inferred', inference:true, fit:false},
      sourceIds:sourceIds,
      sourceGroups:groups.map(function (g) { return g.id; }),
      sourceView:roles[0], framePair:roles.slice(),
      definition:{kind:'ellipse', center:{x:candidate.center.x,y:candidate.center.y,z:candidate.center.z},
        a:aVec, b:bVec, u:frames.u, v:frames.v, radiusU:ru, radiusV:rv,
        normal:frames.n, exact:true},
      viewDefinitions:groups.map(function (g) {
        return {group:g.id, role:g.role, center:{x:g.center.x,y:g.center.y},
          a:{x:g.a.x,y:g.a.y}, b:{x:g.b.x,y:g.b.y}, count:g.count};
      })
    };
    if (circular) curve.radius = ru;
    return curve;
  }
  function sameCenter(a, b, tol, scale) {
    var s = Math.max(1e-12, scale || 1);
    return Math.abs(a.x-b.x) <= tol*s && Math.abs(a.y-b.y) <= tol*s &&
      Math.abs(a.z-b.z) <= tol*s;
  }
  function sameQMatrix(a, b) {
    for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
      var scale = Math.max(1e-12, Math.abs(a[r][c]), Math.abs(b[r][c]));
      if (Math.abs(a[r][c]-b[r][c]) > 1e-7 * scale + 1e-12) return false;
    }
    return true;
  }
  function sameCandidateGeometry(a, b) {
    var scale = Math.sqrt(Math.max(1e-12, Math.abs(a.q[0][0]), Math.abs(a.q[1][1]), Math.abs(a.q[2][2])));
    return sameCenter(a.center, b.center, 1e-7, scale) && sameQMatrix(a.q, b.q);
  }
  function curveQ(curve) {
    var d = curve.definition;
    var a = d.a, b = d.b, Q = [[0,0,0],[0,0,0],[0,0,0]];
    [a,b].forEach(function (v) {
      var c = [v.x,v.y,v.z];
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) Q[i][j] += c[i]*c[j];
    });
    return Q;
  }
  function sameCurveGeometry(a, b) {
    var scale = Math.max(1e-12, a.radiusU || 0, a.radiusV || 0, b.radiusU || 0, b.radiusV || 0);
    return a.kind === b.kind && sameCenter(a.center, b.center, 1e-7, scale) &&
      sameQMatrix(curveQ(a), curveQ(b));
  }
  function candidateVisibility(candidate, entities, profile, visibilityAt) {
    if (!visibilityAt) return null;
    var byId = new Map((entities || []).map(function (e) { return [e.id, e]; }));
    var A = mul3(candidate.vectors[0], Math.sqrt(Math.max(0, candidate.values[0])));
    var B = mul3(candidate.vectors[1], Math.sqrt(Math.max(0, candidate.values[1])));
    var tested = 0, conflicts = 0;
    [candidate.first, candidate.second].forEach(function (group) {
      if (!group) return;
      var A2 = projectVector(A, group.role, profile), B2 = projectVector(B, group.role, profile);
      var C2 = projectVector(candidate.center, group.role, profile);
      if (!A2 || !B2 || !C2) return;
      var det = A2.x*B2.y - A2.y*B2.x;
      if (!(Math.abs(det) > 1e-12 * Math.max(1, Math.hypot(A2.x,A2.y) * Math.hypot(B2.x,B2.y)))) return;
      group.segmentIds.forEach(function (id) {
        var e = byId.get(id);
        if (!e || e.type !== 'SEGMENT' || (e.bisCode !== 'A' && e.bisCode !== 'E')) return;
        function parameter(p) {
          var qx = p.x - C2.x, qy = p.y - C2.y;
          var alpha = (qx*B2.y - qy*B2.x) / det;
          var beta = (A2.x*qy - A2.y*qx) / det;
          return Math.atan2(beta, alpha);
        }
        var u0 = parameter({x:e.x, y:e.y}), u1 = parameter({x:e.x2, y:e.y2});
        var delta = ((u1-u0+Math.PI) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI) - Math.PI;
        if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return;
        [0.25, 0.5, 0.75].forEach(function (t) {
          var u = u0 + delta*t;
          var p = {x:candidate.center.x + A.x*Math.cos(u) + B.x*Math.sin(u),
            y:candidate.center.y + A.y*Math.cos(u) + B.y*Math.sin(u),
            z:candidate.center.z + A.z*Math.cos(u) + B.z*Math.sin(u)};
          var hidden = visibilityAt(p, group.role);
          if (hidden === null || hidden === undefined) return;
          tested++;
          if (hidden !== (e.bisCode === 'E')) conflicts++;
        });
      });
    });
    return {tested:tested, conflicts:conflicts};
  }
  function lift(entities, options) {
    options = options || {};
    var profile = options.profile || null;
    var collected = collect(entities), groups = collected.groups;
    var invalidSeen = new Set();
    var issues = collected.invalid.filter(function (bad) {
      var key = bad.group || bad.entityId;
      if (invalidSeen.has(key)) return false;
      invalidSeen.add(key);
      return true;
    }).map(function (bad) {
      return {code:bad.code, entityId:bad.entityId, message:bad.message};
    });
    if (!groups.length) return {curves:[], consumedIds:[], pointIds:[], issues:issues, groups:[]};
    var byRole = {PLAN:[], ELEVATION:[], PROFILE:[]};
    groups.forEach(function (g) { byRole[g.role].push(g); });
    var visibilityAt = options.visibilityProvider ? options.visibilityProvider([]) : null;
    var candidates = [];
    ROLE_PAIR.forEach(function (pair) {
      byRole[pair.a].forEach(function (first) {
        byRole[pair.b].forEach(function (second) {
          var solved = solvePair(first, second, profile);
          if (solved.issue) return;
          solved.candidates.forEach(function (candidate) {
            var entry = Object.assign({}, candidate, {first:first, second:second,
              roles:[first.role, second.role], pair:pair});
            var linked = linkedPoints(entities, first, second, profile);
            var endpoint = segmentEndpointObservations(entities, first, second, profile);
            issues = issues.concat(endpoint.issues);
            var mergedEvidence = linked.slice();
            var mergeTol = 1e-6 * Math.max(1, candidate.scale || 0);
            endpoint.evidence.forEach(function (observation) {
              var duplicate = mergedEvidence.some(function (existing) {
                return Math.hypot(existing.position.x - observation.position.x,
                  existing.position.y - observation.position.y,
                  existing.position.z - observation.position.z) <= mergeTol;
              });
              if (!duplicate) mergedEvidence.push(observation);
            });
            entry.evidence = mergedEvidence;
            entry.fit = pointFit(entry, entry.evidence);
            entry.third = [];
            ['PLAN','ELEVATION','PROFILE'].forEach(function (role) {
              if (role === first.role || role === second.role) return;
              byRole[role].forEach(function (third) {
                if (thirdMatches(entry, third, profile)) entry.third.push(third);
              });
            });
            entry.visibility = candidateVisibility(entry, entities, profile, visibilityAt);
            candidates.push(entry);
          });
        });
      });
    });
    var pairGroups = new Map();
    candidates.forEach(function (c) {
      var key = c.first.id + '|' + c.second.id;
      if (!pairGroups.has(key))
        pairGroups.set(key, {key:key, first:c.first, second:c.second, candidates:[]});
      pairGroups.get(key).candidates.push(c);
    });
    pairGroups.forEach(function (entry) {
      var unique = [];
      entry.candidates.forEach(function (c) {
        var same = unique.find(function (d) { return sameCandidateGeometry(d, c); });
        if (same) {
          same.third = same.third.concat(c.third.filter(function (g) {
            return !same.third.some(function (q) { return q.id === g.id; });
          }));
          if (!same.evidence.length && c.evidence.length) {
            same.evidence = c.evidence;
            same.fit = c.fit;
          }
        } else unique.push(c);
      });
      entry.candidates = unique;
    });
    var selected = [], selectionIssues = new Map();
    function noteGroup(group, code, message) {
      if (!selectionIssues.has(group.id))
        selectionIssues.set(group.id, {code:code, entityId:group.segmentIds[0], message:message});
    }
    var parent = {};
    groups.forEach(function (g) { parent[g.id] = g.id; });
    function root(id) {
      while (parent[id] !== id) { parent[id] = parent[parent[id]]; id = parent[id]; }
      return id;
    }
    function join(a, b) {
      var ra = root(a), rb = root(b);
      if (ra !== rb) parent[rb] = ra;
    }
    candidates.forEach(function (c) {
      join(c.first.id, c.second.id);
      c.third.forEach(function (g) { join(c.first.id, g.id); });
    });
    var components = new Map();
    groups.forEach(function (g) {
      var r = root(g.id);
      if (!components.has(r)) components.set(r, []);
      components.get(r).push(g);
    });
    components.forEach(function (componentGroups, compId) {
      var roleCount = {PLAN:0, ELEVATION:0, PROFILE:0};
      componentGroups.forEach(function (g) { roleCount[g.role]++; });
      var entries = Array.from(pairGroups.values()).filter(function (entry) {
        return root(entry.first.id) === compId;
      });
      entries.forEach(function (entry) {
        var evidence = entry.candidates[0].evidence;
        var fit = (evidence.length ? entry.candidates.filter(function (c) { return c.fit.ok; }) :
          entry.candidates.slice()).filter(function (c) {
            return !c.visibility || !c.visibility.tested || c.visibility.conflicts === 0;
          });
        var otherRoles = ['PLAN','ELEVATION','PROFILE'].filter(function (role) {
          return entry.first.role !== role && entry.second.role !== role;
        });
        var expectsThird = otherRoles.some(function (role) { return roleCount[role] === 1; });
        var anyThird = entry.candidates.some(function (c) { return c.third.length === 1; });
        if (expectsThird && !anyThird) {
          noteGroup(entry.first, 'conic-third-view-conflict',
            'The third view contains an exact ellipse for this projection set, but no spatial completion agrees with it; the correspondence is unresolved.');
          noteGroup(entry.second, 'conic-third-view-conflict',
            'The third view contains an exact ellipse for this projection set, but no spatial completion agrees with it; the correspondence is unresolved.');
          return;
        }
        if (evidence.length && !fit.length) {
          noteGroup(entry.first, 'conic-point-conflict',
            'Linked boundary points contradict every spatial completion supported by these two projections.');
          noteGroup(entry.second, 'conic-point-conflict',
            'Linked boundary points contradict every spatial completion supported by these two projections.');
          return;
        }
        if (!fit.length) {
          noteGroup(entry.first, 'conic-visibility-conflict',
            'Every spatial completion contradicts the drawn visible or hidden strokes.');
          noteGroup(entry.second, 'conic-visibility-conflict',
            'Every spatial completion contradicts the drawn visible or hidden strokes.');
          return;
        }
        var choice = null;
        if (fit.length === 1) {
          choice = fit[0];
          if (evidence.length > 0) choice = fit[0];
          else if (choice.third.length === 1) choice = fit[0];
          else if (choice.third.length > 1) {
            noteGroup(entry.first, 'conic-lift-ambiguous',
              'Several third-view ellipses agree with this spatial conic; the correspondence is unresolved.');
            return;
          } else {
            var pairOnly = entries.length === 1 &&
              roleCount[entry.first.role] === 1 && roleCount[entry.second.role] === 1;
            if (!pairOnly) {
              noteGroup(entry.first, 'conic-lift-ambiguous',
                'More than one ellipse in these views can take part in this correspondence; add a linked boundary identity or a third view.');
              noteGroup(entry.second, 'conic-lift-ambiguous',
                'More than one ellipse in these views can take part in this correspondence; add a linked boundary identity or a third view.');
              return;
            }
          }
        } else if (fit.length > 1) {
          var thirdSelect = fit.filter(function (c) { return c.third.length === 1; });
          if (thirdSelect.length === 1) choice = thirdSelect[0];
          else {
            noteGroup(entry.first, 'conic-lift-ambiguous',
              'The projections leave more than one spatial completion and the linked evidence does not select one; add a selecting third view or boundary point.');
            noteGroup(entry.second, 'conic-lift-ambiguous',
              'The projections leave more than one spatial completion and the linked evidence does not select one; add a selecting third view or boundary point.');
            return;
          }
        } else return;
        selected.push(choice);
      });
    });
    var usage = new Map();
    function involve(group) {
      if (!usage.has(group.id)) usage.set(group.id, []);
      usage.get(group.id).push(group);
    }
    selected.forEach(function (c) {
      involve(c.first); involve(c.second);
      c.third.forEach(involve);
    });
    var conflicted = new Set();
    usage.forEach(function (selections, id) {
      if (selections.length < 2) return;
      var geometry = selected.filter(function (c) {
        return c.first.id === id || c.second.id === id ||
          c.third.some(function (g) { return g.id === id; });
      });
      var same = geometry.length > 1 && geometry.every(function (c) {
        return sameCandidateGeometry(geometry[0], c);
      });
      if (!same) geometry.forEach(function (c) {
        conflicted.add(c);
        [c.first, c.second].concat(c.third).forEach(function (g) {
          noteGroup(g, 'conic-lift-ambiguous',
            'Several spatial completions share a projection; the correspondence is unresolved rather than guessed.');
        });
      });
    });
    selected = selected.filter(function (c) { return !conflicted.has(c); });
    var curves = [], used = new Set(), pointIds = new Set();
    selected.forEach(function (c) {
      var involved = [c.first, c.second].concat(c.third);
      var curve = makeCurve(c, c.roles, involved);
      if (!curve) return;
      if (c.evidence.length) curve.pointEvidence = c.evidence.map(function (e) {
        var ids = e.pointIds || [];
        ids.forEach(function (id) { pointIds.add(id); });
        var record = {memberId:e.memberId, position:e.position, sourceIds:ids.slice()};
        if (e.sources && e.sources.length) record.observations = e.sources.slice();
        return record;
      });
      if (c.visibility && c.visibility.tested)
        curve.visibilityEvidence = {samples:c.visibility.tested, sourceIds:curve.sourceIds.slice(),
          occluderSourceIds:[]};
      if (c.third.length === 1) curve.thirdView = c.third[0].role;
      var same = curves.find(function (existing) { return sameCurveGeometry(existing, curve); });
      if (same) {
        same.sourceIds = Array.from(new Set(same.sourceIds.concat(curve.sourceIds)));
        same.sourceGroups = Array.from(new Set(same.sourceGroups.concat(curve.sourceGroups)));
        (curve.viewDefinitions || []).forEach(function (def) {
          if (!same.viewDefinitions.some(function (q) { return q.group === def.group; }))
            same.viewDefinitions.push(def);
        });
      } else curves.push(curve);
      involved.forEach(function (g) { used.add(g.id); });
    });
    groups.forEach(function (g) {
      if (used.has(g.id)) return;
      if (selectionIssues.has(g.id)) {
        var issue = selectionIssues.get(g.id);
        issues.push({code:issue.code, entityId:g.segmentIds[0], message:issue.message});
        return;
      }
      var hasCandidate = candidates.some(function (c) {
        return c.first.id === g.id || c.second.id === g.id ||
          c.third.some(function (t) { return t.id === g.id; });
      });
      if (hasCandidate) {
        issues.push({code:'conic-lift-ambiguous', entityId:g.segmentIds[0],
          message:'The exact ellipse projections leave more than one spatial completion; add a third view or linked boundary identity.'});
      } else {
        issues.push({code:'conic-projection-missing', entityId:g.segmentIds[0],
          message:'This exact ellipse needs a corresponding projection in another declared view.'});
      }
    });
    var consumed = [];
    curves.forEach(function (curve) { consumed = consumed.concat(curve.sourceIds); });
    issues = issues.filter(function (issue, index, all) {
      return all.findIndex(function (other) {
        return other.code === issue.code && other.entityId === issue.entityId;
      }) === index;
    });
    return {curves:curves, consumedIds:Array.from(new Set(consumed)),
      pointIds:Array.from(pointIds), issues:issues, groups:groups,
      usedGroups:Array.from(used)};
  }
  function lineEquation(line) {
    if (Number.isFinite(line.nx) && Number.isFinite(line.ny) && Number.isFinite(line.c))
      return {nx:line.nx, ny:line.ny, c:line.c};
    var nx = line.y2 - line.y, ny = line.x - line.x2;
    return {nx:nx, ny:ny, c:nx*line.x + ny*line.y};
  }
  function unionCovers(line, lo, hi, tol) {
    var intervals = line.intervals ? line.intervals.slice() : [{min:line.min, max:line.max}];
    intervals.sort(function (a, b) { return a.min - b.min; });
    var reach = lo;
    for (var i = 0; i < intervals.length; i++) {
      if (intervals[i].max < lo - tol) continue;
      if (intervals[i].min > reach + tol) break;
      reach = Math.max(reach, intervals[i].max);
      if (reach >= hi - tol) return true;
    }
    return reach >= hi - tol;
  }
  function unionExact(line, lo, hi, tol) {
    var intervals = line.intervals ? line.intervals : [{min:line.min, max:line.max}];
    var mn = Infinity, mx = -Infinity;
    intervals.forEach(function (iv) { mn = Math.min(mn, iv.min); mx = Math.max(mx, iv.max); });
    return Math.abs(mn-lo) <= tol && Math.abs(mx-hi) <= tol;
  }
  function lineRuns(entities) {
    var runs = [];
    (entities || []).forEach(function (e) {
      if (!e || e.type !== 'SEGMENT' || e.meta && e.meta.ellipse) return;
      if (e.meta && (e.meta.reconstructionRole === 'construction' ||
          ['axis','projector','locus'].indexOf(e.meta.kind) !== -1)) return;
      if (['PLAN','ELEVATION','PROFILE'].indexOf(e.viewRole) === -1) return;
      var dx = e.x2-e.x, dy = e.y2-e.y, l = Math.hypot(dx,dy);
      if (!(l > 1e-12)) return;
      dx /= l; dy /= l;
      if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
      var nx = -dy, ny = dx, c = nx*e.x + ny*e.y;
      var run = runs.find(function (r) {
        return r.role === e.viewRole &&
          Math.abs(r.dx*dy-r.dy*dx) <= 1e-9 &&
          Math.abs(r.nx-nx) <= 1e-9 && Math.abs(r.ny-ny) <= 1e-9 &&
          Math.abs(c-r.c) <= 1e-7 * Math.max(1e-12, Math.abs(c), Math.abs(r.c));
      });
      if (!run) {
        run = {role:e.viewRole, viewRole:e.viewRole, dx:dx, dy:dy, nx:nx, ny:ny, c:c,
          intervals:[], ids:[], segments:[]};
        runs.push(run);
      }
      var t1 = dx*e.x+dy*e.y, t2 = dx*e.x2+dy*e.y2;
      run.intervals.push({min:Math.min(t1,t2), max:Math.max(t1,t2), id:e.id});
      run.ids.push(e.id);
      run.segments.push({id:e.id, x:e.x, y:e.y, x2:e.x2, y2:e.y2});
    });
    runs.forEach(function (run) {
      var mn = Infinity, mx = -Infinity;
      run.intervals.forEach(function (iv) { mn = Math.min(mn, iv.min); mx = Math.max(mx, iv.max); });
      run.key = run.ids.join('|');
      run.min = mn; run.max = mx;
      run.x = run.dx*mn+run.nx*run.c; run.y = run.dy*mn+run.ny*run.c;
      run.x2 = run.dx*mx+run.nx*run.c; run.y2 = run.dy*mx+run.ny*run.c;
    });
    return runs;
  }
  function projectVector(v, role, profile) {
    if (role === 'PLAN') return {x:v.x, y:-v.z};
    if (role === 'ELEVATION') return {x:v.x, y:v.y};
    if (role === 'PROFILE' && profile) return {x:profile.s*v.z, y:v.y};
    return null;
  }
  function lineCandidate(group, line, profile) {
    var eq = lineEquation(line), nx = eq.nx, ny = eq.ny;
    var cs = group.center, as = group.a, bs = group.b;
    var C = null, A = null, B = null;
    if (group.role === 'PLAN' && line.viewRole === 'ELEVATION') {
      if (Math.abs(ny) <= 1e-12) return {issue:'The edge-on elevation trace is vertical; a full plan ellipse cannot lie on it.'};
      var m = -nx/ny, b0 = eq.c/ny;
      C = {x:cs.x, y:m*cs.x+b0, z:-cs.y};
      A = {x:as.x, y:m*as.x, z:-as.y};
      B = {x:bs.x, y:m*bs.x, z:-bs.y};
    } else if (group.role === 'PLAN' && line.viewRole === 'PROFILE') {
      if (!profile) return {issue:'The profile trace needs a declared side-view frame.'};
      if (Math.abs(ny) <= 1e-12) return {issue:'The edge-on profile trace is vertical; a full plan ellipse cannot lie on it.'};
      var mz = -(nx*profile.s)/ny;
      var bz = (eq.c - nx*(profile.xRef - profile.s*profile.dRef))/ny;
      C = {x:cs.x, y:mz*(-cs.y)+bz, z:-cs.y};
      A = {x:as.x, y:mz*(-as.y), z:-as.y};
      B = {x:bs.x, y:mz*(-bs.y), z:-bs.y};
    } else if (group.role === 'ELEVATION' && line.viewRole === 'PLAN') {
      if (Math.abs(ny) <= 1e-12) return {issue:'The edge-on plan trace is vertical; a full elevation ellipse cannot lie on it.'};
      var mx = nx/ny, bx = -eq.c/ny;
      C = {x:cs.x, y:cs.y, z:mx*cs.x+bx};
      A = {x:as.x, y:as.y, z:mx*as.x};
      B = {x:bs.x, y:bs.y, z:mx*bs.x};
    } else if (group.role === 'ELEVATION' && line.viewRole === 'PROFILE') {
      if (!profile) return {issue:'The profile trace needs a declared side-view frame.'};
      if (Math.abs(nx) <= 1e-12) return {issue:'The edge-on profile trace is horizontal; a full elevation ellipse cannot lie on it.'};
      var my = -ny/(nx*profile.s);
      var by = profile.dRef + (eq.c - nx*profile.xRef)/(nx*profile.s);
      C = {x:cs.x, y:cs.y, z:my*cs.y+by};
      A = {x:as.x, y:as.y, z:my*as.y};
      B = {x:bs.x, y:bs.y, z:my*bs.y};
    } else if (group.role === 'PROFILE' && line.viewRole === 'PLAN') {
      if (!profile) return {issue:'The profile ellipse needs a declared side-view frame.'};
      if (Math.abs(nx) <= 1e-12) return {issue:'The edge-on plan trace is horizontal; a full profile ellipse cannot lie on it.'};
      var pz = profile.s, mx2 = ny/nx, bx2 = eq.c/nx;
      var zC = profile.dRef + (cs.x-profile.xRef)/pz;
      var zA = as.x/pz, zB = bs.x/pz;
      C = {x:mx2*zC+bx2, y:cs.y, z:zC};
      A = {x:mx2*zA, y:as.y, z:zA};
      B = {x:mx2*zB, y:bs.y, z:zB};
    } else if (group.role === 'PROFILE' && line.viewRole === 'ELEVATION') {
      if (!profile) return {issue:'The profile ellipse needs a declared side-view frame.'};
      if (Math.abs(nx) <= 1e-12) return {issue:'The edge-on elevation trace is vertical; a full profile ellipse cannot lie on it.'};
      var pz2 = profile.s, my2 = -ny/nx, by2 = eq.c/nx;
      var zC2 = profile.dRef + (cs.x-profile.xRef)/pz2;
      var zA2 = as.x/pz2, zB2 = bs.x/pz2;
      C = {x:my2*cs.y+by2, y:cs.y, z:zC2};
      A = {x:my2*as.y, y:as.y, z:zA2};
      B = {x:my2*bs.y, y:bs.y, z:zB2};
    } else {
      return {issue:'The exact ellipse and the edge-on trace are in the same view.'};
    }
    var Q = [[0,0,0],[0,0,0],[0,0,0]];
    [A,B].forEach(function (v) {
      var c = [v.x,v.y,v.z];
      for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) Q[i][j] += c[i]*c[j];
    });
    var factor = rank2Factor(Q);
    if (!factor || !(factor.values[1] > 0))
      return {issue:'The edge-on trace does not produce a rank-two spatial ellipse.'};
    var A2 = projectVector(A, line.viewRole, profile), B2 = projectVector(B, line.viewRole, profile);
    var center2 = projectVector(C, line.viewRole, profile);
    if (!A2 || !B2 || !center2) return {issue:'The edge-on trace needs a declared side-view frame.'};
    if (Math.abs(A2.x*B2.y - A2.y*B2.x) > 1e-7 * Math.max(1,
        Math.hypot(A2.x,A2.y) * Math.hypot(B2.x,B2.y)))
      return {issue:'The edge-on trace is not compatible with a rank-one projection of this ellipse.'};
    var dx = line.dx, dy = line.dy, dl = Math.hypot(dx,dy);
    if (!(dl > 1e-12)) return {issue:'The edge-on trace has no extent.'};
    dx /= dl; dy /= dl;
    var ca = A2.x*dx + A2.y*dy, cb = B2.x*dx + B2.y*dy;
    var radius = Math.hypot(ca, cb), mid = center2.x*dx + center2.y*dy;
    var lo = mid - radius, hi = mid + radius;
    var tol = 1e-7 * Math.max(1e-12, radius, Math.abs(lo), Math.abs(hi));
    var exact = unionExact(line, lo, hi, tol);
    var contains = unionCovers(line, lo, hi, tol);
    if (!contains) return {issue:'The edge-on trace covers only part of the spatial ellipse; the remaining bound is unresolved.'};
    return {candidate:{center:C, q:Q, values:factor.values.slice(), vectors:factor.vectors.slice(),
      normal:factor.normal, scale:Math.sqrt(Math.max(0, factor.values[0]))}, line:line, group:group,
      coverage:exact ? 'exact' : 'contains', exact:exact,
      interval:{lo:lo, hi:hi, lineLo:line.min, lineHi:line.max}};
  }
  function liftLine(entities, options) {
    options = options || {};
    var profile = options.profile || null;
    var collected = collect(entities);
    var used = new Set(options.usedGroups || []);
    var issues = [];
    var groups = collected.groups.filter(function (g) { return !used.has(g.id); });
    var lines = lineRuns(entities);
    var entries = [];
    groups.forEach(function (group) {
      var list = [];
      lines.forEach(function (line) {
        if (line.viewRole === group.role) return;
        var result = lineCandidate(group, line, profile);
        if (!result.candidate) {
          if (result.issue) list.push({group:group, line:line, issue:result.issue});
          return;
        }
        var candidate = result.candidate;
        candidate.third = groups.filter(function (other) {
          return other.id !== group.id && other.role !== group.role &&
            other.role !== line.viewRole && thirdMatches(candidate, other, profile);
        });
        list.push({group:group, line:line, candidate:candidate,
          coverage:result.coverage, exact:result.exact, interval:result.interval});
      });
      entries.push({group:group, candidates:list.filter(function (e) { return !!e.candidate; }),
        rejected:list.filter(function (e) { return !e.candidate; })});
    });
    var selected = [];
    entries.forEach(function (entry) {
      if (!entry.candidates.length) return;
      var ok = entry.candidates;
      if (ok.length > 1) {
        var exact = ok.filter(function (c) { return c.exact; });
        if (exact.length === 1) ok = exact;
        else {
          var third = ok.filter(function (c) { return c.candidate.third.length === 1; });
          if (third.length === 1) ok = third;
          else {
            issues.push({code:'conic-line-ambiguous', entityId:entry.group.segmentIds[0],
              message:'Several edge-on traces can carry this exact ellipse; add a linked identity or a third view.'});
            return;
          }
        }
      }
      selected.push(ok[0]);
    });
    var lineUse = new Map();
    selected.forEach(function (entry) {
      if (!lineUse.has(entry.line.key)) lineUse.set(entry.line.key, []);
      lineUse.get(entry.line.key).push(entry);
    });
    var blocked = new Set();
    lineUse.forEach(function (list) {
      if (list.length < 2) return;
      var same = list.every(function (e) { return sameCandidateGeometry(e.candidate, list[0].candidate); });
      if (!same) list.forEach(function (e) { blocked.add(e); });
    });
    var curves = [], consumed = [], usedGroups = new Set();
    selected.forEach(function (entry) {
      if (blocked.has(entry)) return;
      var curve = makeCurve(entry.candidate, [entry.group.role, entry.line.viewRole], [entry.group]);
      if (!curve) return;
      curve.lineTrace = {role:entry.line.viewRole, ids:entry.line.ids.slice(), coverage:entry.coverage};
      curve.sourceIds = Array.from(new Set(curve.sourceIds.concat(entry.line.ids)));
      curve.sourceGroups = Array.from(new Set(curve.sourceGroups.concat(
        entry.line.ids.map(function (id) { return 'line:'+id; }))));
      curve.viewDefinitions.push({kind:'line', ids:entry.line.ids.slice(),
        segments:entry.line.segments.slice(), role:entry.line.viewRole,
        x:entry.line.x, y:entry.line.y, x2:entry.line.x2, y2:entry.line.y2});
      var same = curves.find(function (existing) { return sameCurveGeometry(existing, curve); });
      if (same) {
        same.sourceIds = Array.from(new Set(same.sourceIds.concat(curve.sourceIds)));
        same.sourceGroups = Array.from(new Set(same.sourceGroups.concat(curve.sourceGroups)));
      } else curves.push(curve);
      consumed = consumed.concat(curve.sourceIds);
      usedGroups.add(entry.group.id);
    });
    entries.forEach(function (entry) {
      if (usedGroups.has(entry.group.id)) return;
      if (entry.rejected.length) issues.push({code:'conic-line-partial',
        entityId:entry.group.segmentIds[0], message:entry.rejected[0].issue});
    });
    issues = issues.filter(function (issue, index, all) {
      return all.findIndex(function (other) {
        return other.code === issue.code && other.entityId === issue.entityId;
      }) === index;
    });
    return {curves:curves, consumedIds:Array.from(new Set(consumed)),
      issues:issues, usedGroups:Array.from(usedGroups),
      consideredGroups:entries.filter(function (e) {
        return e.candidates.length || e.rejected.length;
      }).map(function (e) { return e.group.id; })};
  }

  function definitionSummary(entity) {
    var parsed = entity && entity.meta && entity.meta.ellipse ?
      canonical(entity.meta.ellipse, entity) : {error:'missing'};
    if (parsed.error) return null;
    var d = parsed.def;
    return {group:d.group, role:d.role, center:{x:d.center.x,y:d.center.y},
      a:{x:d.a.x,y:d.a.y}, b:{x:d.b.x,y:d.b.y}, count:d.count, index:d.index,
      centerRef:d.centerRef};
  }
  return {
    TAU:TAU, definition:definition, definitionSummary:definitionSummary,
    collect:collect, segmentAt:segmentAt, pointAt:pointAt, viewQ:viewQ,
    eigenSym:eigenSym, solvePair:solvePair, profileViewQ:profileViewQ,
    lift:lift, liftLine:liftLine, lineCandidate:lineCandidate
  };
});

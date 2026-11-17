(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-implicit.js'), require('./educad-entities.js'));
  else root.EduCADSurfaceInfer = factory(root.EduCADImplicit, root.EduCADEntities);
})(typeof window !== 'undefined' ? window : globalThis, function (Implicit, Entities) {
  'use strict';

  var TAU = 2 * Math.PI, EPS = 1e-6;
  function finite(p) { return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z); }
  function add(a, b) { return {x:a.x+b.x, y:a.y+b.y, z:a.z+b.z}; }
  function sub(a, b) { return {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}; }
  function mul(a, s) { return {x:a.x*s, y:a.y*s, z:a.z*s}; }
  function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
  function cross(a, b) { return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}; }
  function length(a) { return Math.hypot(a.x, a.y, a.z); }
  function unit(a) { var l = length(a); return l > EPS ? mul(a, 1/l) : null; }
  function close(a, b, tol) { return length(sub(a, b)) <= tol; }
  function helper(e) {
    var m = e && e.meta || {};
    return m.reconstructionRole === 'construction' || ['axis', 'projector', 'locus'].indexOf(m.kind) !== -1;
  }
  function viewOf(e) {
    return e.viewRole === 'PLAN' ? 'PLAN' : e.viewRole === 'ELEVATION' ? 'ELEVATION' :
      e.viewRole === 'PROFILE' ? 'PROFILE' : null;
  }
  function sheetPoint(p, role, profile) {
    if (role === 'PLAN') return {x:p.x, y:-p.z};
    if (role === 'ELEVATION') return {x:p.x, y:p.y};
    if (role === 'PROFILE' && profile) return {x:profile.xRef + profile.s*(p.z-profile.dRef), y:p.y};
    return null;
  }
  function sheetVector(v, role, profile) {
    if (role === 'PLAN') return {x:v.x, y:-v.z};
    if (role === 'ELEVATION') return {x:v.x, y:v.y};
    if (role === 'PROFILE' && profile) return {x:profile.s*v.z, y:v.y};
    return null;
  }
  function conic(c) {
    if (!c || !finite(c.center) || !finite(c.u) || !finite(c.v)) return null;
    var ru = c.radiusU === undefined ? c.radius : c.radiusU;
    var rv = c.radiusV === undefined ? c.radius : c.radiusV;
    if (!(ru > 0) || !(rv > 0)) return null;
    var A = mul(c.u, ru), B = mul(c.v, rv), n = cross(A, B);
    if (length(n) <= EPS) return null;
    return {C:c.center, A:A, B:B, n:n, ru:ru, rv:rv, scale:Math.max(ru, rv)};
  }
  function conicPoint(c, t) {
    var k = conic(c);
    return add(k.C, add(mul(k.A, Math.cos(t)), mul(k.B, Math.sin(t))));
  }
  function full(c) {
    return c && (c.sweepAngle === undefined ||
      Math.abs(Math.abs(c.sweepAngle) - TAU) <= 1e-9);
  }
  function analyticTolerance(scale) { return 1e-6 * Math.max(1, Math.abs(scale)); }
  function objectStroke(e) {
    if (!e || e.type !== 'SEGMENT' || helper(e) || e.annotation === true) return false;
    return ['G','H','K'].indexOf(e.bisCode) === -1;
  }
  function sourceSet(c) {
    var out = new Set();
    (c.sourceIds || []).forEach(function (id) { out.add(id); });
    return out;
  }
  function projected(c, role, profile) {
    var k = conic(c);
    if (!k) return null;
    var center = sheetPoint(k.C, role, profile);
    if (!center) return null;
    var a = sheetVector(k.A, role, profile), b = sheetVector(k.B, role, profile);
    if (!a || !b) return null;
    return {center:center, a:a, b:b, scale:k.scale};
  }
  function nearBoundary(c, role, profile, p, tol) {
    var pr = projected(c, role, profile);
    if (!pr) return false;
    var q = {x:p.x-pr.center.x, y:p.y-pr.center.y};
    var aa = pr.a.x*pr.a.x + pr.a.y*pr.a.y;
    var ab = pr.a.x*pr.b.x + pr.a.y*pr.b.y;
    var bb = pr.b.x*pr.b.x + pr.b.y*pr.b.y;
    var det = aa*bb - ab*ab;
    if (aa > 0 && bb > 0 && Math.abs(det) > 1e-12*aa*bb) {
      var aq = pr.a.x*q.x + pr.a.y*q.y, bq = pr.b.x*q.x + pr.b.y*q.y;
      var alpha = (bb*aq - ab*bq)/det, beta = (aa*bq - ab*aq)/det;
      var radiusScale = Math.max(Math.sqrt(aa), Math.sqrt(bb));
      return Math.abs(Math.hypot(alpha,beta) - 1) * radiusScale <= tol;
    }
    var dir = (aa >= bb ? pr.a : pr.b);
    var dirLength = Math.hypot(dir.x, dir.y);
    if (!(dirLength > 0)) return false;
    var dx = dir.x/dirLength, dy = dir.y/dirLength;
    var along = q.x*dx + q.y*dy, across = Math.abs(q.x*dy - q.y*dx);
    var support = Math.abs(pr.a.x*dx + pr.a.y*dy) + Math.abs(pr.b.x*dx + pr.b.y*dy);
    return across <= tol && Math.abs(along) <= support + tol;
  }
  function quadric(C, A, B, D, k) {
    var aa = dot(A,A), ab = dot(A,B), bb = dot(B,B);
    if (!(aa > 0) || !(bb > 0)) return null;
    var det = aa*bb - ab*ab;
    if (!(Math.abs(det) > 1e-12*aa*bb)) return null;
    var rawN = cross(A, B), w = unit(rawN);
    if (!w) return null;
    var d = sub(D, C), h = dot(w, d);
    if (Math.abs(h) <= 1e-12*Math.max(1, length(d))) return null;
    var u = unit(sub(A, mul(w, dot(A,w))));
    if (!u) return null;
    var v = cross(w, u);
    var n = w;
    function local(v3) { return {x:dot(v3,u), y:dot(v3,v), z:dot(v3,w)}; }
    var aw = local(A), bw = local(B), dw = local(d), nw = local(n);
    var tx = nw.x/h, ty = nw.y/h, tz = nw.z/h;
    var qx = {c:-tx*dw.x, x:1-tx*dw.x, y:-ty*dw.x, z:-tz*dw.x};
    var qy = {c:-tx*dw.y, x:-tx*dw.y, y:1-ty*dw.y, z:-tz*dw.y};
    var qz = {c:-tx*dw.z, x:-tx*dw.z, y:-ty*dw.z, z:1-tz*dw.z};
    function lin(vec, a, b, c) {
      return {c:0, x:vec.x*a.x + vec.y*b.x + vec.z*c.x,
        y:vec.x*a.y + vec.y*b.y + vec.z*c.y,
        z:vec.x*a.z + vec.y*b.z + vec.z*c.z};
    }
    var aq = lin(aw, qx, qy, qz), bq = lin(bw, qx, qy, qz);
    var alpha = {c:(bb*aq.c-ab*bq.c)/det, x:(bb*aq.x-ab*bq.x)/det,
      y:(bb*aq.y-ab*bq.y)/det, z:(bb*aq.z-ab*bq.z)/det};
    var beta = {c:(aa*bq.c-ab*aq.c)/det, x:(aa*bq.x-ab*aq.x)/det,
      y:(aa*bq.y-ab*aq.y)/det, z:(aa*bq.z-ab*aq.z)/det};
    var endpoint = {c:1, x:(k-1)*tx, y:(k-1)*ty, z:(k-1)*tz};
    function evalLocal(x, y, z) {
      var a = alpha.c + alpha.x*x + alpha.y*y + alpha.z*z;
      var b = beta.c + beta.x*x + beta.y*y + beta.z*z;
      var e = endpoint.c + endpoint.x*x + endpoint.y*y + endpoint.z*z;
      return a*a + b*b - e*e;
    }
    function gradLocal(x, y, z) {
      var a = alpha.c + alpha.x*x + alpha.y*y + alpha.z*z;
      var b = beta.c + beta.x*x + beta.y*y + beta.z*z;
      var e = endpoint.c + endpoint.x*x + endpoint.y*y + endpoint.z*z;
      return {x:2*(a*alpha.x + b*beta.x - e*endpoint.x),
        y:2*(a*alpha.y + b*beta.y - e*endpoint.y),
        z:2*(a*alpha.z + b*beta.z - e*endpoint.z)};
    }
    var terms = [[evalLocal(0,0,0),0,0,0],
      [2*(alpha.c*alpha.x+beta.c*beta.x-endpoint.c*endpoint.x),1,0,0],
      [2*(alpha.c*alpha.y+beta.c*beta.y-endpoint.c*endpoint.y),0,1,0],
      [2*(alpha.c*alpha.z+beta.c*beta.z-endpoint.c*endpoint.z),0,0,1],
      [alpha.x*alpha.x+beta.x*beta.x-endpoint.x*endpoint.x,2,0,0],
      [alpha.y*alpha.y+beta.y*beta.y-endpoint.y*endpoint.y,0,2,0],
      [alpha.z*alpha.z+beta.z*beta.z-endpoint.z*endpoint.z,0,0,2],
      [2*(alpha.x*alpha.y+beta.x*beta.y-endpoint.x*endpoint.y),1,1,0],
      [2*(alpha.x*alpha.z+beta.x*beta.z-endpoint.x*endpoint.z),1,0,1],
      [2*(alpha.y*alpha.z+beta.y*beta.z-endpoint.y*endpoint.z),0,1,1]];
    terms = terms.filter(function (t) { return t[0] !== 0; });
    return {frame:{origin:C, u:u, v:v, w:w}, terms:terms, h:h, n:n, d:d,
      C:C, A:A, B:B, D:D, k:k,
      evaluate:function (p) {
        var q = sub(p, C);
        return evalLocal(dot(q,u), dot(q,v), dot(q,w));
      }, gradient:function (p) {
        var q = sub(p, C), g = gradLocal(dot(q,u), dot(q,v), dot(q,w));
        return add(mul(u,g.x), add(mul(v,g.y), mul(w,g.z)));
      }, localF:evalLocal};
  }

  function implicitRecord(q, sourceIds) {
    if (!q || !Implicit) return null;
    var ids = Array.from(new Set(sourceIds || []));
    var h = q.h, slope = q.k - 1, constraints = [];
    function inequality(terms, op, label) {
      constraints.push({kind:'inequality', terms:terms, op:op, label:label});
    }
    if (h > 0) {
      inequality([[1,0,0,1]], '>=', 'parameter-min');
      inequality([[1,0,0,1],[-h,0,0,0]], '<=', 'parameter-max');
      inequality([[slope,0,0,1],[h,0,0,0]], '>=', 'profile-nonnegative');
    } else {
      inequality([[1,0,0,1]], '<=', 'parameter-min');
      inequality([[1,0,0,1],[-h,0,0,0]], '>=', 'parameter-max');
      inequality([[slope,0,0,1],[h,0,0,0]], '<=', 'profile-nonnegative');
    }
    var dLocal = sub(q.D, q.C);
    var axes = [q.frame.u, q.frame.v, q.frame.w];
    var lo = {}, hi = {};
    ['x','y','z'].forEach(function (axis, i) {
      var av = dot(q.A, axes[i]), bv = dot(q.B, axes[i]);
      var radius = Math.hypot(av, bv), dv = dot(dLocal, axes[i]);
      var endRadius = q.k * radius;
      lo[axis] = Math.min(-radius, dv - endRadius);
      hi[axis] = Math.max(radius, dv + endRadius);
    });
    return Implicit.normalizeEquation({frame:q.frame, terms:q.terms,
      kind:'ruledConic', constraints:constraints, bounds:{lo:lo, hi:hi}, compact:true,
      identity:{kind:'implicit', status:'inferred', sourceIds:ids},
      domain:{compiled:['parameter-range','profile-nonnegative'], unresolved:[]},
      paramChart:{kind:'ruledConic', C:q.C, A:q.A, B:q.B, D:q.D, k:q.k},
      sourceEvidence:{family:'homothetic-conic-sweep', sourceIds:ids}});
  }

  function quadricResidual(q, p) {
    if (!q || !finite(p)) return Infinity;
    var value = q.evaluate(p), scale = length(q.gradient(p));
    return scale > 0 ? Math.abs(value) / scale : Infinity;
  }
  function sampleCurve(c, count) {
    var out = [], n = count || 32;
    var start = c.startAngle === undefined ? 0 : c.startAngle;
    var sweep = c.sweepAngle === undefined ? TAU : c.sweepAngle;
    for (var i = 0; i < n; i++) out.push(conicPoint(c, start + sweep * i / n));
    return out;
  }
  function curveResidual(q, c, count) {
    var max = 0;
    sampleCurve(c, count).forEach(function (p) { max = Math.max(max, quadricResidual(q, p)); });
    return max;
  }
  function edgeKey(a, b) { return Math.min(a,b) + '_' + Math.max(a,b); }
  function addEdge(state, a, b) {
    var key = edgeKey(a, b);
    if (state.edgeMap.has(key)) return state.edgeMap.get(key);
    var index = state.geometry.edges.length;
    state.geometry.edges.push([a,b]);
    state.edgeMap.set(key, index);
    return index;
  }
  function faceNormal(geometry, loop) {
    var normal = {x:0,y:0,z:0};
    for (var i=0;i<loop.length;i++) {
      var a = geometry.vertices[loop[i]], b = geometry.vertices[loop[(i+1)%loop.length]];
      if (!finite(a) || !finite(b)) return null;
      normal.x += (a.y-b.y)*(a.z+b.z);
      normal.y += (a.z-b.z)*(a.x+b.x);
      normal.z += (a.x-b.x)*(a.y+b.y);
    }
    return length(normal) > EPS ? unit(normal) : null;
  }
  function addFace(state, loop, q, smooth, desiredNormal) {
    if (!loop || loop.length < 3) return -1;
    var normal = faceNormal(state.geometry, loop);
    if (normal && desiredNormal && length(desiredNormal) > EPS) {
      if (dot(normal, desiredNormal) < 0) loop = loop.slice().reverse();
    } else if (normal && q) {
      var center = {x:0,y:0,z:0};
      loop.forEach(function (i) { center = add(center, state.geometry.vertices[i]); });
      center = mul(center, 1/loop.length);
      var gradient = q.gradient(center);
      if (length(gradient) > EPS && dot(normal, gradient) < 0) loop = loop.slice().reverse();
    }
    var index = state.geometry.faces.length;
    state.geometry.faces.push(loop);
    if (smooth) state.geometry.smoothSideFaces.push(index);
    return index;
  }
  function makeState(geometry) {
    var state = {geometry:geometry, edgeMap:new Map()};
    geometry.vertices = geometry.vertices || [];
    geometry.edges = geometry.edges || [];
    geometry.faces = geometry.faces || [];
    geometry.curves = geometry.curves || [];
    geometry.surfacePatches = geometry.surfacePatches || [];
    geometry.smoothSideFaces = geometry.smoothSideFaces || [];
    geometry.edges.forEach(function (e, i) { state.edgeMap.set(edgeKey(e[0], e[1]), i); });
    return state;
  }
  function vertexAt(state, p, tol) {
    for (var i=0;i<state.geometry.vertices.length;i++)
      if (close(state.geometry.vertices[i], p, tol)) return i;
    state.geometry.vertices.push({x:p.x,y:p.y,z:p.z});
    return state.geometry.vertices.length - 1;
  }
  function isCapFace(geometry, face, curve) {
    if (!face || face.length < 3 || !curve.displayVertices || !curve.displayVertices.length) return false;
    var set = new Set(curve.displayVertices);
    return face.every(function (i) { return set.has(i); });
  }
  function removeCaps(state, curve) {
    var geometry = state.geometry, removed = new Set(), map = new Map(), faces = [];
    geometry.faces.forEach(function (face, i) {
      if (isCapFace(geometry, face, curve)) { removed.add(i); return; }
      map.set(i, faces.length); faces.push(face);
    });
    if (!removed.size) return;
    geometry.faces = faces;
    geometry.surfacePatches.forEach(function (patch) {
      if (patch.faceIndices) patch.faceIndices = patch.faceIndices.map(function (i) {
        return map.has(i) ? map.get(i) : -1;
      }).filter(function (i) { return i >= 0; });
    });
    geometry.smoothSideFaces = geometry.smoothSideFaces.map(function (i) {
      return map.has(i) ? map.get(i) : -1;
    }).filter(function (i) { return i >= 0; });
    var keptPatches = [], patchMap = new Map();
    geometry.surfacePatches.forEach(function (patch, index) {
      var keep = patch.kind !== 'plane' || !(patch.boundaryCurves || []).length ||
        patch.boundaryCurves[0] !== geometry.curves.indexOf(curve) || (patch.faceIndices || []).length;
      if (!keep) return;
      patchMap.set(index, keptPatches.length);
      keptPatches.push(patch);
    });
    geometry.surfacePatches = keptPatches;
    (geometry.generatorLines || []).forEach(function (line) {
      if (!Number.isInteger(line.surfacePatch)) return;
      if (patchMap.has(line.surfacePatch)) line.surfacePatch = patchMap.get(line.surfacePatch);
      else line.surfacePatch = undefined;
    });
  }

  function pointIdentity(e, selectedId) {
    var meta = e && e.meta || {};
    var members = Array.isArray(meta.members) ? meta.members : [];
    var selected = selectedId ? members.find(function (m) { return m && m.id === selectedId; }) : null;
    if (selectedId && !selected) return null;
    if (meta.membersDeclared === true) {
      if (selected) return 'id:' + selected.id;
      return members.length === 1 ? 'id:' + members[0].id : null;
    }
    var names = selected ? [selected.name] :
      members.map(function (m) { return m && m.name; }).filter(Boolean);
    return names.length === 1 ? 'auto-name:' + names[0] : null;
  }
  function endpointSelection(e, index) {
    var meta = e && e.meta || {};
    if (Array.isArray(meta.endpointMemberIds)) return meta.endpointMemberIds[index] || null;
    if (index === 0 && meta.fromMemberId) return meta.fromMemberId;
    if (index === 1 && meta.toMemberId) return meta.toMemberId;
    return null;
  }
  function pointMatchesAtView(entities, role, p, tol) {
    return (entities || []).filter(function (e) {
      return e && e.type === 'POINT' && viewOf(e) === role &&
        Math.abs(e.x - p.x) <= tol && Math.abs(e.y - p.y) <= tol;
    });
  }
  function segmentEndpointPoint(entities, e, index, role, p, tol) {
    var meta = e && e.meta || {};
    var explicit = Array.isArray(meta.endpointRefs) || Array.isArray(meta.refs);
    var selectedId = endpointSelection(e, index);
    if (explicit) {
      if (!Entities || !Entities.endpointReferences)
        return {state:'invalid', reason:'missing-endpoint-resolver'};
      var refs = Entities.endpointReferences(entities, e, tol);
      var pointEntity = refs && refs[index];
      if (!pointEntity || pointEntity.type !== 'POINT')
        return {state:'invalid', reason:'unresolved-endpoint-reference'};
      if (viewOf(pointEntity) !== role || Math.abs(pointEntity.x - p.x) > tol ||
          Math.abs(pointEntity.y - p.y) > tol)
        return {state:'conflict', reason:'endpoint-reference-coordinate-mismatch'};
      return {state:'ok', point:pointEntity, selectedId:selectedId};
    }
    var matches = pointMatchesAtView(entities, role, p, tol);
    if (matches.length > 1) return {state:'ambiguous', reason:'coincident-point-observations'};
    return matches.length === 1 ? {state:'ok', point:matches[0], selectedId:selectedId} :
      {state:'geometric', point:null, selectedId:selectedId};
  }
  function hardMemberId(id) {
    return id && !/^(auto:|point:|legacy:)/.test(id) ? id : null;
  }
  function generatorObservations(geometry, ci, c, entities, profile) {
    var baseConic = conic(c);
    if (!baseConic) return {groups:new Map(), sourceIds:new Set(), tol:0, errors:[]};
    var tol = analyticTolerance(baseConic.scale), errors = [], observations = [];
    var sourceIds = new Set(), groups = new Map();
    function addPoint(group, role, pointEntity) {
      if (!group.points[role]) group.points[role] = [];
      if (!group.points[role].some(function (p) { return p.id === pointEntity.id; }))
        group.points[role].push(pointEntity);
    }
    (entities || []).forEach(function (e) {
      if (!objectStroke(e)) return;
      var role = viewOf(e);
      if (!role || role === 'PROFILE' && !profile) return;
      if (sourceSet(c).has(e.id)) return;
      var p = {x:e.x, y:e.y}, q = {x:e.x2, y:e.y2};
      var pBoundary = nearBoundary(c, role, profile, p, tol);
      var qBoundary = nearBoundary(c, role, profile, q, tol);
      if (pBoundary === qBoundary) return;
      var apex = pBoundary ? q : p, contact = pBoundary ? p : q;
      var apexIndex = pBoundary ? 1 : 0;
      var resolved = segmentEndpointPoint(entities, e, apexIndex, role, apex, tol);
      if (resolved.state !== 'ok' && resolved.state !== 'geometric') {
        if (resolved.state === 'conflict' || resolved.state === 'invalid')
          errors.push({entityId:e.id, code:'surface-generator-reference-conflict'});
        return;
      }
      var hardId = hardMemberId(resolved.selectedId), hints = [];
      var pointEntity = resolved.point || null;
      var members = pointEntity && pointEntity.meta && Array.isArray(pointEntity.meta.members) ?
        pointEntity.meta.members : [];
      if (resolved.selectedId) {
        var selected = members.find(function (m) { return m && m.id === resolved.selectedId; });
        if (selected) hints.push(selected.name);
      } else {
        members.forEach(function (m) { if (m && m.name) hints.push(m.name); });
      }
      observations.push({role:role, apex:apex, contact:contact, id:e.id,
        hardId:hardId, hints:hints, point:pointEntity});
      sourceIds.add(e.id);
    });

    var candidates = [];
    observations.forEach(function (obs, index) {
      var found = candidates.find(function (candidate) {
        if (candidate.role !== obs.role ||
            Math.hypot(candidate.apex.x - obs.apex.x, candidate.apex.y - obs.apex.y) > tol)
          return false;
        if (candidate.hardId && obs.hardId && candidate.hardId !== obs.hardId) return false;
        return true;
      });
      if (!found) {
        found = {role:obs.role, apex:obs.apex, hardId:obs.hardId, obs:[], hints:[]};
        candidates.push(found);
      } else if (obs.hardId && !found.hardId) found.hardId = obs.hardId;
      found.obs.push(index);
      obs.hints.forEach(function (name) { if (found.hints.indexOf(name) === -1) found.hints.push(name); });
    });
    function sharedAxis(a, b) {
      if ((a === 'PLAN' && b === 'ELEVATION') || (a === 'ELEVATION' && b === 'PLAN')) return 'x';
      if ((a === 'PLAN' && b === 'PROFILE') || (a === 'PROFILE' && b === 'PLAN')) return 'depth';
      if ((a === 'ELEVATION' && b === 'PROFILE') || (a === 'PROFILE' && b === 'ELEVATION')) return 'height';
      return null;
    }
    function coords(candidate) {
      if (candidate.role === 'PLAN') return {x:candidate.apex.x, depth:-candidate.apex.y};
      if (candidate.role === 'ELEVATION') return {x:candidate.apex.x, height:candidate.apex.y};
      return {depth:profile.dRef + (candidate.apex.x - profile.xRef) / profile.s,
        height:candidate.apex.y};
    }
    function pointCoords(pointEntity, role) {
      if (role === 'PLAN') return {x:pointEntity.x, depth:-pointEntity.y};
      if (role === 'ELEVATION') return {x:pointEntity.x, height:pointEntity.y};
      return {depth:profile.dRef + (pointEntity.x - profile.xRef) / profile.s,
        height:pointEntity.y};
    }
    function compatible(a, b) {
      if (a === b || a.role === b.role) return false;
      if (a.hardId && b.hardId && a.hardId !== b.hardId) return false;
      var axis = sharedAxis(a.role, b.role);
      if (!axis) return false;
      return Math.abs(coords(a)[axis] - coords(b)[axis]) <= tol;
    }
    var parent = candidates.map(function (_, i) { return i; });
    function root(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function join(a, b) { var ra = root(a), rb = root(b); if (ra !== rb) parent[rb] = ra; }
    [['PLAN','ELEVATION'], ['PLAN','PROFILE'], ['ELEVATION','PROFILE']].forEach(function (pair) {
      candidates.forEach(function (a, ai) {
        if (a.role !== pair[0]) return;
        var matches = [];
        candidates.forEach(function (b, bi) {
          if (b.role === pair[1] && compatible(a, b)) matches.push(bi);
        });
        if (matches.length !== 1) return;
        var bi = matches[0], b = candidates[bi];
        var back = candidates.filter(function (c) { return c.role === a.role && compatible(c, b); });
        if (back.length === 1) join(ai, bi);
      });
    });
    var components = new Map();
    candidates.forEach(function (candidate, index) {
      var r = root(index);
      if (!components.has(r)) components.set(r, []);
      components.get(r).push(candidate);
    });
    var componentIndex = 0;
    components.forEach(function (component) {
      var roles = new Set(component.map(function (c) { return c.role; }));
      if (!roles.size) return;
      var hardIds = Array.from(new Set(component.map(function (c) { return c.hardId; }).filter(Boolean)));
      var group = {key:hardIds.length === 1 ? 'id:' + hardIds[0] : 'geom:' + componentIndex++,
        views:{}, points:{}, ids:[]};
      if (hardIds.length > 1) group.conflict = true;
      component.forEach(function (candidate) {
        candidate.obs.forEach(function (index) {
          var obs = observations[index];
          if (!group.views[obs.role]) group.views[obs.role] = {apex:[], contacts:[], ids:[]};
          group.views[obs.role].apex.push(obs.apex);
          group.views[obs.role].contacts.push(obs.contact);
          group.views[obs.role].ids.push(obs.id);
          group.ids.push(obs.id);
          if (obs.point) addPoint(group, obs.role, obs.point);
        });
      });
      if (hardIds.length === 1) {
        (entities || []).forEach(function (e) {
          if (!e || e.type !== 'POINT' || !Array.isArray(e.meta && e.meta.members)) return;
          if (!e.meta.members.some(function (m) { return m && m.id === hardIds[0]; })) return;
          var role = viewOf(e);
          if (role) addPoint(group, role, e);
        });
      } else {
        var names = [];
        component.forEach(function (candidate) {
          candidate.hints.forEach(function (name) { if (names.indexOf(name) === -1) names.push(name); });
        });
        if (names.length) (entities || []).forEach(function (e) {
          if (!e || e.type !== 'POINT' || !Array.isArray(e.meta && e.meta.members)) return;
          if (!e.meta.members.some(function (m) { return m && names.indexOf(m.name) !== -1; })) return;
          var role = viewOf(e);
          if (role) addPoint(group, role, e);
        });
      }
      if (!hardIds.length) {
        ['PLAN','ELEVATION','PROFILE'].forEach(function (role) {
          if (role === 'PROFILE' && !profile) return;
          if (group.views[role] || group.points[role]) return;
          var matches = (entities || []).filter(function (e) {
            if (!e || e.type !== 'POINT' || viewOf(e) !== role) return false;
            var pointPosition = pointCoords(e, role), any = false, okay = true;
            component.forEach(function (candidate) {
              var axis = sharedAxis(candidate.role, role);
              if (!axis) return;
              any = true;
              if (Math.abs(coords(candidate)[axis] - pointPosition[axis]) > tol) okay = false;
            });
            return any && okay;
          });
          if (matches.length === 1) addPoint(group, role, matches[0]);
        });
      }
      var coverage = new Set(Object.keys(group.views).concat(Object.keys(group.points)));
      if (coverage.size < 2) return;
      groups.set(group.key, group);
    });
    groups.forEach(function (group) {
      Object.keys(group.views).forEach(function (role) {
        var entry = group.views[role], first = entry.apex[0];
        if (entry.apex.some(function (p) { return Math.hypot(p.x-first.x,p.y-first.y) > tol; }))
          group.conflict = true;
        var distinct = entry.contacts.some(function (p) {
          return Math.hypot(p.x-entry.contacts[0].x,p.y-entry.contacts[0].y) > tol;
        });
        if (!distinct) group.insufficient = true;
      });
      Object.keys(group.points).forEach(function (role) {
        var points = group.points[role], first = points[0];
        if (points.some(function (p) { return Math.abs(p.x-first.x) > tol || Math.abs(p.y-first.y) > tol; }))
          group.conflict = true;
      });
    });
    return {groups:groups, sourceIds:sourceIds, tol:tol, errors:errors};
  }
  function observationCoordinates(points, role, profile) {
    if (!points || !points.length) return [];
    var p = points[0], out = [];
    if (role === 'PLAN') out.push({x:p.x, z:-p.y});
    else if (role === 'ELEVATION') out.push({x:p.x, y:p.y});
    else if (role === 'PROFILE' && profile)
      out.push({y:p.y, z:profile.dRef + (p.x - profile.xRef) / profile.s});
    return out;
  }
  function solveApex(group, profile, tol) {
    var estimates = {x:[], y:[], z:[]};
    Object.keys(group.points).forEach(function (role) {
      observationCoordinates(group.points[role], role, profile).forEach(function (o) {
        if (o.x !== undefined) estimates.x.push(o.x);
        if (o.y !== undefined) estimates.y.push(o.y);
        if (o.z !== undefined) estimates.z.push(o.z);
      });
    });
    Object.keys(group.views).forEach(function (role) {
      var p = group.views[role].apex[0], o = observationCoordinates([{x:p.x,y:p.y}], role, profile)[0];
      if (!o) return;
      if (o.x !== undefined) estimates.x.push(o.x);
      if (o.y !== undefined) estimates.y.push(o.y);
      if (o.z !== undefined) estimates.z.push(o.z);
    });
    var apex = {};
    for (var i=0;i<['x','y','z'].length;i++) {
      var axis = ['x','y','z'][i], values = estimates[axis];
      if (!values.length) return {state:'missing'};
      var first = values[0];
      if (values.some(function (v) { return Math.abs(v-first) > tol; }))
        return {state:'conflict', axis:axis, values:values.slice()};
      apex[axis] = values.reduce(function (s,v) { return s+v; }, 0) / values.length;
    }
    return {state:'ok', apex:apex};
  }

  function inferApex(geometry, ci, c, entities, profile, state, result, claimedVertices) {
    if (!full(c) || !conic(c)) return false;
    var evidence = generatorObservations(geometry, ci, c, entities, profile);
    var valid = [];
    evidence.groups.forEach(function (group) {
      var roles = Object.keys(group.views), pointRoles = Object.keys(group.points);
      if (!roles.length || group.conflict || group.insufficient) return;
      if (roles.length < 2 && pointRoles.length < 2) return;
      var solved = solveApex(group, profile, evidence.tol);
      if (solved.state !== 'ok') {
        if (solved.state === 'conflict')
          result.issues.push({code:'surface-apex-observation-conflict', entityId:(group.ids || [])[0],
            message:'The declared generator endpoints do not agree on one apex; no surface is inferred.'});
        return;
      }
      valid.push({group:group, roles:roles, apex:solved.apex});
    });
    if (valid.length !== 1) {
      if (valid.length > 1) result.issues.push({code:'surface-apex-ambiguous',
        message:'Several independent apex identities fit this boundary; the cone is unresolved.'});
      else if (evidence.errors.length) result.issues.push({code:evidence.errors[0].code,
        entityId:evidence.errors[0].entityId,
        message:'A generator endpoint reference does not agree with its drawn coordinates or member identity; no surface is inferred.'});
      return false;
    }
    var choice = valid[0], apex = choice.apex;
    if (!finite(apex)) return false;
    var q = quadric(CONIC_C(c), CONIC_A(c), CONIC_B(c), apex, 0);
    if (!q || curveResidual(q, c, 32) > evidence.tol) return false;
    var apexIndex = null;
    for (var vi=0;vi<geometry.vertices.length;vi++) {
      if (claimedVertices.has(vi)) continue;
      if (close(geometry.vertices[vi], apex, evidence.tol)) { apexIndex=vi; break; }
    }
    if (apexIndex === null) apexIndex = vertexAt(state, apex, evidence.tol);
    claimedVertices.add(apexIndex);
    removeCaps(state, c);
    var lateral = [], n = c.displayVertices.length;
    for (var i=0;i<n;i++) {
      var a = c.displayVertices[i], b = c.displayVertices[(i+1)%n];
      addEdge(state, a, b); addEdge(state, a, apexIndex);
      lateral.push(addFace(state, [a,b,apexIndex], q, true));
    }
    var baseNormal = unit(cross(CONIC_A(c), CONIC_B(c)));
    var desiredCapNormal = baseNormal ? mul(baseNormal, q.h > 0 ? -1 : 1) : null;
    var cap = addFace(state, c.displayVertices.slice(), null, false, desiredCapNormal);
    geometry.surfacePatches.push({kind:'plane', boundaryCurves:[ci],
      loops:[{kind:'outer', curves:[ci]}], origin:c.center,
      normal:desiredCapNormal, u:c.u, v:c.v,
      faceIndices:[cap], sourceIds:(c.sourceIds || []).slice()});
    var sourceIds = Array.from(new Set((c.sourceIds || []).concat(choice.group.ids)));
    geometry.surfacePatches.push({kind:'implicit', analyticKind:'ruledConic',
      boundaryCurves:[ci], faceIndices:lateral, sourceIds:sourceIds,
      implicit:implicitRecord(q, sourceIds), generator:{C:q.frame.origin,
        A:CONIC_A(c), B:CONIC_B(c), D:apex, k:0, n:q.n, h:q.h},
      origin:q.frame.origin, apex:apex, inferred:true,
      inference:{family:'homothetic-conic-sweep', endpoint:'apex', status:'inferred',
        views:choice.roles.slice(), generatorSourceIds:choice.group.ids.slice(),
        identityKey:choice.group.key}});
    choice.group.ids.forEach(function (id) { result.consumedIds.push(id); });
    result.patches.push({curve:ci, apex:apex, views:choice.roles.slice()});
    return true;
  }
  function CONIC_C(c) { return conic(c).C; }
  function CONIC_A(c) { return conic(c).A; }
  function CONIC_B(c) { return conic(c).B; }

  function ringFamily(c1, c2) {
    var k1 = conic(c1), k2 = conic(c2);
    if (!k1 || !k2) return null;
    var denom = dot(k1.A, k1.A);
    if (!(denom > EPS)) return null;
    var k = dot(k2.A, k1.A) / denom;
    if (!(k > 0)) return null;
    var tol = analyticTolerance(k1.scale);
    if (length(sub(k2.A, mul(k1.A, k))) > tol ||
        length(sub(k2.B, mul(k1.B, k))) > tol) return null;
    var q = quadric(k1.C, k1.A, k1.B, k2.C, k);
    if (!q) return null;
    return {k:k, q:q, c1:k1, c2:k2, tol:tol};
  }

  function projectedParamCandidates(c, role, profile, p, tol) {
    var pr = projected(c, role, profile);
    if (!pr) return [];
    var q = {x:p.x-pr.center.x, y:p.y-pr.center.y};
    var aa = pr.a.x*pr.a.x + pr.a.y*pr.a.y;
    var ab = pr.a.x*pr.b.x + pr.a.y*pr.b.y;
    var bb = pr.b.x*pr.b.x + pr.b.y*pr.b.y;
    var det = aa*bb - ab*ab;
    if (aa > 0 && bb > 0 && Math.abs(det) > 1e-12*aa*bb) {
      var aq = pr.a.x*q.x + pr.a.y*q.y, bq = pr.b.x*q.x + pr.b.y*q.y;
      var alpha = (bb*aq - ab*bq)/det, beta = (aa*bq - ab*aq)/det;
      var radiusScale = Math.max(Math.sqrt(aa), Math.sqrt(bb));
      if (Math.abs(Math.hypot(alpha,beta) - 1) * radiusScale > tol) return [];
      return [Math.atan2(beta, alpha)];
    }
    var dir = aa >= bb ? pr.a : pr.b, dirLength = Math.hypot(dir.x,dir.y);
    if (!(dirLength > 0)) return [];
    var dx = dir.x/dirLength, dy = dir.y/dirLength;
    var along = q.x*dx + q.y*dy, across = Math.abs(q.x*dy - q.y*dx);
    var A = pr.a.x*dx + pr.a.y*dy, B = pr.b.x*dx + pr.b.y*dy;
    var radius = Math.hypot(A,B);
    if (across > tol || !(radius > 0)) return [];
    var ratio = along/radius;
    if (Math.abs(ratio) > 1 + tol/radius) return [];
    var phi = Math.atan2(B,A), delta = Math.acos(Math.max(-1,Math.min(1,ratio)));
    return [phi+delta, phi-delta];
  }
  function generatorMatchesView(c1, c2, k, role, profile, observed, tol) {
    var candidates = projectedParamCandidates(c1, role, profile, observed[0], tol);
    for (var i=0;i<candidates.length;i++) {
      var u = candidates[i];
      var p1 = conicPoint(c1, u);
      var p2 = add(c2.center, mul(conic(c1).A, k*Math.cos(u)));
      p2 = add(p2, mul(conic(c1).B, k*Math.sin(u)));
      var s1 = sheetPoint(p1, role, profile), s2 = sheetPoint(p2, role, profile);
      if (!s1 || !s2) continue;
      if (Math.hypot(s1.x-observed[0].x,s1.y-observed[0].y) <= tol &&
          Math.hypot(s2.x-observed[1].x,s2.y-observed[1].y) <= tol) return true;
    }
    return false;
  }
  function ringGenerators(geometry, c1, c2, k, entities, profile, patch, boundaries) {
    var tol = analyticTolerance(Math.max(conic(c1).scale, conic(c2).scale));
    var own = new Set((c1.sourceIds || []).concat(c2.sourceIds || []));
    var out = {ids:[], views:[], angles:[], valid:false, conflict:false, conflictIds:[]};
    function considerChain(role, chain) {
      var p = chain.p, q = chain.q;
      var pFirst = nearBoundary(c1, role, profile, p, tol) && nearBoundary(c2, role, profile, q, tol);
      var pSecond = nearBoundary(c1, role, profile, q, tol) && nearBoundary(c2, role, profile, p, tol);
      var observed = pFirst ? [p,q] : pSecond ? [q,p] : null;
      if (!observed) return;
      if (generatorMatchesView(c1, c2, k, role, profile, observed, tol)) {
        chain.ids.forEach(function (id) {
          if (out.ids.indexOf(id) === -1) out.ids.push(id);
        });
        if (out.views.indexOf(role) === -1) out.views.push(role);
        projectedParamCandidates(c1, role, profile, observed[0], tol).forEach(function (u) {
          if (!out.angles.some(function (existing) { return angleDistance(existing, u) <= 1e-9; }))
            out.angles.push(u);
        });
      } else {
        out.conflict = true;
        out.conflictIds.push(chain.ids[0]);
      }
    }
    ['PLAN', 'ELEVATION', 'PROFILE'].forEach(function (role) {
      if (role === 'PROFILE' && !profile) return;
      strokeChains(entities, role, profile, own, tol, boundaries).forEach(function (chain) {
        considerChain(role, chain);
      });
    });
    out.ids = Array.from(new Set(out.ids));
    out.valid = out.ids.length > 0 && out.views.length > 0 && !out.conflict;
    return out;
  }
  function crossSectionRadius(c) {
    if (c.radius !== undefined) return c.radius;
    var k = conic(c);
    return k ? Math.min(k.ru, k.rv) : 0;
  }
  function coneApexFromBoundaries(patch, curves) {
    if (!patch.axis || !patch.origin || !patch.halfAngle) return null;
    var axis = unit(patch.axis);
    if (!axis) return null;
    if (curves && curves.length >= 2) {
      var first = curves[0], second = curves[1];
      var r1 = crossSectionRadius(first), r2 = crossSectionRadius(second);
      if (Math.abs(r1 - r2) > EPS) {
        var axial = dot(sub(second.center, first.center), axis);
        return add(patch.origin, mul(axis, axial * r1 / (r1 - r2)));
      }
    }
    return add(patch.origin, mul(axis, patch.radius / Math.tan(patch.halfAngle)));
  }
  function legacyResidual(patch, curves) {
    if (!patch || ['cone','cylinder','ruled'].indexOf(patch.kind) === -1 || !curves.length) return Infinity;
    var max = 0, axis = unit(patch.axis);
    var apex = patch.kind === 'cone' ? coneApexFromBoundaries(patch, curves) : null;
    curves.forEach(function (c) {
      sampleCurve(c, 24).forEach(function (p) {
        var value;
        if (patch.kind === 'cylinder') {
          var d = sub(p, patch.origin);
          var axial = dot(d, axis);
          value = Math.abs(Math.sqrt(Math.max(0, dot(d,d)-axial*axial)) - patch.radius);
        } else {
          if (!apex) return;
          var dc = sub(p, apex), ac = dot(dc, axis);
          value = Math.abs(Math.sqrt(Math.max(0, dot(dc,dc)-ac*ac)) -
            Math.abs(ac)*Math.tan(patch.halfAngle));
        }
        max = Math.max(max, value);
      });
    });
    return max;
  }
  function nativePointResidual(patch, p, apex, axis) {
    if (!finite(p)) return Infinity;
    if (patch.kind === 'cylinder') {
      var d = sub(p, patch.origin);
      var axial = dot(d, axis);
      return Math.abs(Math.sqrt(Math.max(0, dot(d,d) - axial*axial)) - patch.radius);
    }
    if (patch.kind === 'cone') {
      if (!finite(apex)) return Infinity;
      var dc = sub(p, apex), ac = dot(dc, axis);
      return Math.abs(Math.sqrt(Math.max(0, dot(dc,dc) - ac*ac)) -
        Math.abs(ac) * Math.tan(patch.halfAngle));
    }
    return Infinity;
  }
  function nativeGeneratorEvidence(patch, c1, c2, entities, profile, tol, boundaries) {
    if (!patch || ['cylinder','cone'].indexOf(patch.kind) === -1) return {valid:true, conflict:false};
    var axis = unit(patch.axis);
    if (!axis) return {valid:true, conflict:false};
    var apex = patch.kind === 'cone' ? coneApexFromBoundaries(patch, [c1,c2]) : null;
    if (patch.kind === 'cone' && !finite(apex)) return {valid:true, conflict:false};
    var observations = ringObservations(c1, c2, entities, profile, tol, boundaries);
    var ownIds = new Set(patch.sourceIds || []);
    if (ownIds.size)
      observations = observations.filter(function (observation) {
        return observation.ids.some(function (id) { return ownIds.has(id); });
      });
    if (!observations.length) return {valid:true, conflict:false, observations:0};
    var invalidIds = [];
    observations.forEach(function (observation) {
      var matched = false;
      observation.base.forEach(function (u1) {
        if (matched) return;
        observation.top.forEach(function (u2) {
          if (matched) return;
          var base = conicPoint(c1, u1), top = conicPoint(c2, u2);
          if (nativePointResidual(patch, base, apex, axis) > 10*tol ||
              nativePointResidual(patch, top, apex, axis) > 10*tol) return;
          var direction = unit(sub(top, base));
          if (!direction) return;
          if (patch.kind === 'cylinder') {
            if (length(cross(direction, axis)) <= 1e-4) matched = true;
          } else {
            var fromBase = unit(sub(base, apex)), fromTop = unit(sub(top, apex));
            if (fromBase && fromTop && length(cross(fromBase, fromTop)) <= 1e-4) matched = true;
          }
        });
      });
      if (!matched) invalidIds.push(observation.ids[0]);
    });
    return {valid:invalidIds.length === 0, conflict:invalidIds.length > 0,
      conflictIds:invalidIds, observations:observations.length};
  }
  function asImplicitPatch(patch, family, evidence, generator) {
    patch.kind = 'implicit';
    patch.analyticKind = 'ruledConic';
    patch.sourceIds = Array.from(new Set((patch.sourceIds || []).concat(evidence.ids)));
    patch.implicit = implicitRecord(family.q, patch.sourceIds);
    patch.generator = generator;
    patch.origin = family.c1.C;
    patch.inferred = true;
    patch.inference = {family:'homothetic-conic-sweep', endpoint:'ring', status:'inferred',
      scale:family.k, views:evidence.views.slice(), generatorSourceIds:evidence.ids.slice()};
    delete patch.axis; delete patch.apex; delete patch.halfAngle; delete patch.radius;
  }

  function angleDistance(a, b) {
    var d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return Math.abs(d);
  }
  function wrapParam(a) { return ((a % TAU) + TAU) % TAU; }
  function curveDisplayParams(c) {
    var n = c.displayVertices && c.displayVertices.length;
    if (!(n > 0)) return [];
    if (Array.isArray(c.displayParams) && c.displayParams.length === n)
      return c.displayParams.slice();
    var start = c.startAngle === undefined ? 0 : c.startAngle;
    var sweep = c.sweepAngle === undefined ? TAU : c.sweepAngle;
    var out = [];
    for (var i = 0; i < n; i++) out.push(start + sweep * i / n);
    return out;
  }
  function conicChordParams(c, s, phi, u) {
    return s > 0 ? u + phi : phi - u;
  }
  function nearAnyBoundary(boundaries, role, profile, point, tol) {
    return (boundaries || []).some(function (c) {
      return nearBoundary(c, role, profile, point, tol);
    });
  }
  function strokeChains(entities, role, profile, exclude, tol, boundaries) {
    var strokes = [];
    (entities || []).forEach(function (e) {
      if (!objectStroke(e) || viewOf(e) !== role) return;
      if (role === 'PROFILE' && !profile) return;
      if (exclude.has(e.id)) return;
      var p = {x:e.x, y:e.y}, q = {x:e.x2, y:e.y2};
      var dx = q.x - p.x, dy = q.y - p.y, length = Math.hypot(dx, dy);
      if (!(length > tol)) return;
      var meta = e.meta || {};
      var explicit = Array.isArray(meta.endpointRefs) || Array.isArray(meta.refs) ||
        Array.isArray(meta.endpointMemberIds) || meta.fromMemberId || meta.toMemberId;
      var ends = [p, q].map(function (point, index) {
        var resolved = segmentEndpointPoint(entities, e, index, role, point, tol);
        if (explicit && resolved.state !== 'ok' && resolved.state !== 'geometric')
          return {invalid:true, state:resolved.state};
        var hard = hardMemberId(resolved.selectedId), hint = [];
        var pointEntity = resolved.point || null;
        if (!hard && pointEntity && pointEntity.meta && Array.isArray(pointEntity.meta.members)) {
          pointEntity.meta.members.forEach(function (m) {
            if (!m) return;
            var id = hardMemberId(m.id);
            if (id && hint.indexOf(id) === -1) hint.push(id);
          });
          if (hint.length === 1) hard = hint[0];
        }
        return {hard:hard, resolved:resolved};
      });
      if (ends.some(function (end) { return end.invalid; })) return;
      strokes.push({id:e.id, p:p, q:q, dx:dx, dy:dy, length:length,
        hard:[ends[0].hard, ends[1].hard]});
    });
    var cuts = boundaries || [];
    function onStroke(point, stroke, tolerance) {
      var along = ((point.x - stroke.p.x)*stroke.dx + (point.y - stroke.p.y)*stroke.dy) /
        (stroke.length*stroke.length);
      if (along < -1e-6 || along > 1 + 1e-6) return false;
      var across = Math.abs((point.x - stroke.p.x)*stroke.dy -
        (point.y - stroke.p.y)*stroke.dx) / stroke.length;
      return across <= tolerance;
    }
    function crossViewMates(e) {
      if (!e || e.type !== 'POINT' || viewOf(e) !== role) return [];
      var members = (e.meta && e.meta.members) || [];
      var ids = members.map(function (m) { return m && m.id; }).filter(Boolean);
      var names = members.map(function (m) { return m && m.name; }).filter(Boolean);
      if (!ids.length && !names.length) return [];
      var mates = [];
      (entities || []).forEach(function (other) {
        if (!other || other.id === e.id || other.type !== 'POINT') return;
        var otherRole = viewOf(other);
        if (!otherRole || otherRole === role) return;
        var otherMembers = (other.meta && other.meta.members) || [];
        var matched = otherMembers.some(function (member) {
          if (!member) return false;
          if (member.id && ids.indexOf(member.id) !== -1) return true;
          return !!(member.name && names.indexOf(member.name) !== -1 &&
            (!member.id || !ids.length));
        });
        if (!matched) return;
        var point = {x:other.x, y:other.y};
        var supported = (entities || []).some(function (stroke) {
          if (!objectStroke(stroke) || viewOf(stroke) !== otherRole) return false;
          var dx = stroke.x2 - stroke.x, dy = stroke.y2 - stroke.y;
          var length = Math.hypot(dx, dy);
          if (!(length > tol)) return false;
          return onStroke(point, {p:{x:stroke.x, y:stroke.y}, dx:dx, dy:dy,
            length:length}, tol);
        });
        if (supported) mates.push({entity:other, role:otherRole});
      });
      return mates;
    }
    function worldObservation(viewRole, p, profile) {
      if (viewRole === 'PLAN') return {x:p.x, z:-p.y};
      if (viewRole === 'ELEVATION') return {x:p.x, y:p.y};
      if (viewRole === 'PROFILE' && profile)
        return {y:p.y, z:profile.dRef + (p.x - profile.xRef)/profile.s};
      return null;
    }
    function combineObservation(a, b, tolerance) {
      if (!a || !b) return null;
      var out = {};
      var conflict = ['x','y','z'].some(function (axis) {
        var values = [];
        if (a[axis] !== undefined) values.push(a[axis]);
        if (b[axis] !== undefined) values.push(b[axis]);
        if (!values.length) return false;
        if (values.some(function (value) {
          return Math.abs(value - values[0]) > tolerance;
        })) return true;
        out[axis] = values[0];
        return false;
      });
      if (conflict) return null;
      return finite(out) ? out : null;
    }
    function pointOnConic3D(c, p, tolerance) {
      var k = conic(c);
      if (!k) return false;
      var d = sub(p, k.C), nlen = length(k.n);
      if (!(nlen > EPS)) return false;
      if (Math.abs(dot(d, k.n))/nlen > tolerance*10) return false;
      var aa = dot(k.A,k.A), ab = dot(k.A,k.B), bb = dot(k.B,k.B);
      var det = aa*bb - ab*ab;
      if (!(Math.abs(det) > 1e-12*aa*bb)) return false;
      var aq = dot(k.A,d), bq = dot(k.B,d);
      var alpha = (bb*aq - ab*bq)/det, beta = (aa*bq - ab*aq)/det;
      var scale = Math.max(k.ru, k.rv);
      return Math.abs(Math.hypot(alpha,beta) - 1)*scale <= tolerance*10;
    }
    var parent = strokes.map(function (_, i) { return i; });
    function root(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function join(a, b) { var ra = root(a), rb = root(b); if (ra !== rb) parent[rb] = ra; }
    function endpoints(stroke) {
      return [{point:stroke.p, hard:stroke.hard && stroke.hard[0]},
        {point:stroke.q, hard:stroke.hard && stroke.hard[1]}];
    }
    function nearPoint(a, b) { return Math.hypot(a.x-b.x, a.y-b.y) <= tol; }
    function collinear(a, b) {
      var cross = Math.abs(a.dx*b.dy - a.dy*b.dx);
      return cross <= 1e-9 * Math.max(1e-30, a.length*b.length);
    }
    function sharingEndpoint(a, b) {
      return endpoints(a).some(function (left) {
        return endpoints(b).some(function (right) {
          if (!nearPoint(left.point, right.point)) return false;
          if (left.hard && right.hard) return left.hard === right.hard;
          return true;
        });
      });
    }
    for (var i = 0; i < strokes.length; i++) for (var j = i + 1; j < strokes.length; j++) {
      if (!collinear(strokes[i], strokes[j])) continue;
      if (sharingEndpoint(strokes[i], strokes[j])) join(i, j);
    }
    var groups = new Map();
    strokes.forEach(function (stroke, index) {
      var r = root(index);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(stroke);
    });
    var chains = [];
    groups.forEach(function (group) {
      var points = [];
      group.forEach(function (stroke) { points.push(stroke.p, stroke.q); });
      var first = points[0], second = points[1], best = -1;
      for (var a = 0; a < points.length; a++) for (var b = a + 1; b < points.length; b++) {
        var span = Math.hypot(points[a].x-points[b].x, points[a].y-points[b].y);
        if (span > best) { best = span; first = points[a]; second = points[b]; }
      }
      if (!(best > tol)) return;
      var dx = second.x - first.x, dy = second.y - first.y, length = best;
      var off = 0;
      points.forEach(function (p) {
        off = Math.max(off, Math.abs((p.x-first.x)*dy - (p.y-first.y)*dx) / length);
      });
      if (off > tol) return;
      function alongPoint(p) { return ((p.x-first.x)*dx + (p.y-first.y)*dy) / length; }
      var terminal = cuts.filter(function (boundary) {
        return nearBoundary(boundary, role, profile, first, tol) ||
          nearBoundary(boundary, role, profile, second, tol);
      });
      var active = cuts.filter(function (boundary) { return terminal.indexOf(boundary) === -1; });
      var samples = [];
      function addSample(point) {
        var pos = alongPoint(point);
        if (samples.some(function (entry) { return Math.abs(entry.pos - pos) <= tol; })) return;
        samples.push({pos:pos, point:{x:point.x, y:point.y}});
      }
      group.forEach(function (stroke) {
        addSample(stroke.p);
        addSample(stroke.q);
      });
      (entities || []).forEach(function (entity) {
        var mates = crossViewMates(entity);
        if (!mates.length) return;
        var point = {x:entity.x, y:entity.y};
        group.forEach(function (stroke) {
          if (!onStroke(point, stroke, tol)) return;
          var sp = alongPoint(stroke.p), sq = alongPoint(stroke.q);
          var a = Math.min(sp, sq), b = Math.max(sp, sq);
          var pos = alongPoint(point);
          if (pos <= a + tol || pos >= b - tol) return;
          var t = (pos - sp) / (sq - sp);
          if (!(t > 1e-7 && t < 1 - 1e-7)) return;
          if (!nearAnyBoundary(active, role, profile, point, tol)) return;
          var incidence = mates.some(function (mate) {
            var otherPoint = {x:mate.entity.x, y:mate.entity.y};
            var joined = combineObservation(worldObservation(role, point, profile),
              worldObservation(mate.role, otherPoint, profile), tol);
            if (!joined) return false;
            return active.some(function (boundary) {
              return pointOnConic3D(boundary, joined, tol);
            });
          });
          if (incidence) addSample(point);
        });
      });
      samples.sort(function (a, b) { return a.pos - b.pos; });
      if (samples.length < 2) return;
      var atoms = [];
      for (var s = 0; s < samples.length - 1; s++) {
        var lo = samples[s], hi = samples[s + 1];
        if (hi.pos - lo.pos <= tol) continue;
        var atom = {p:{x:lo.point.x, y:lo.point.y}, q:{x:hi.point.x, y:hi.point.y},
          pos0:lo.pos, pos1:hi.pos, ids:[], segments:[]};
        group.forEach(function (stroke) {
          var sp = alongPoint(stroke.p), sq = alongPoint(stroke.q);
          var a = Math.min(sp, sq), b = Math.max(sp, sq);
          var mid = 0.5*(atom.pos0 + atom.pos1);
          if (mid < a - tol || mid > b + tol) return;
          if (atom.ids.indexOf(stroke.id) === -1) atom.ids.push(stroke.id);
          var from = (atom.pos0 - sp) / (sq - sp);
          var to = (atom.pos1 - sp) / (sq - sp);
          atom.segments.push({id:stroke.id,
            from:Math.max(0, Math.min(1, from)), to:Math.max(0, Math.min(1, to)),
            p:{x:atom.p.x, y:atom.p.y}, q:{x:atom.q.x, y:atom.q.y}});
        });
        if (atom.ids.length) atoms.push(atom);
      }
      if (!atoms.length) return;
      var runs = [], current = null;
      atoms.forEach(function (atom) {
        if (!current) {
          current = {p:atom.p, q:atom.q, ids:atom.ids.slice(),
            segments:atom.segments.slice()};
          return;
        }
        var shared = {x:current.q.x, y:current.q.y};
        var stop = nearAnyBoundary(active, role, profile, shared, tol);
        if (stop) {
          runs.push(current);
          current = {p:atom.p, q:atom.q, ids:atom.ids.slice(),
            segments:atom.segments.slice()};
        } else {
          current.q = atom.q;
          atom.ids.forEach(function (id) {
            if (current.ids.indexOf(id) === -1) current.ids.push(id);
          });
          atom.segments.forEach(function (segment) {
            if (!current.segments.some(function (existing) {
              return existing.id === segment.id &&
                Math.abs(existing.from - segment.from) <= 1e-9 &&
                Math.abs(existing.to - segment.to) <= 1e-9;
            })) current.segments.push(segment);
          });
        }
      });
      if (current) runs.push(current);
      runs.forEach(function (run) {
        run.length = Math.hypot(run.q.x - run.p.x, run.q.y - run.p.y);
        if (run.length <= tol) return;
        run.sourceSegments = run.segments.map(function (segment) {
          return {id:segment.id, from:segment.from, to:segment.to,
            p:{x:segment.p.x, y:segment.p.y}, q:{x:segment.q.x, y:segment.q.y}};
        });
        delete run.segments;
        chains.push(run);
      });
    });
    return chains;
  }
  function ringObservations(c1, c2, entities, profile, tol, boundaries) {
    var exclude = sourceSet(c1);
    sourceSet(c2).forEach(function (id) { exclude.add(id); });
    var observations = [];
    var stops = boundaries && boundaries.length ? boundaries : [c1, c2];
    ['PLAN', 'ELEVATION', 'PROFILE'].forEach(function (role) {
      if (role === 'PROFILE' && !profile) return;
      strokeChains(entities, role, profile, exclude, tol, stops).forEach(function (chain) {
        var p = chain.p, q = chain.q;
        var pBase = nearBoundary(c1, role, profile, p, tol);
        var qBase = nearBoundary(c1, role, profile, q, tol);
        var pTop = nearBoundary(c2, role, profile, p, tol);
        var qTop = nearBoundary(c2, role, profile, q, tol);
        var basePoint = null, topPoint = null;
        if (pBase && qTop && !qBase && !pTop) { basePoint = p; topPoint = q; }
        else if (qBase && pTop && !pBase && !qTop) { basePoint = q; topPoint = p; }
        else return;
        var base = projectedParamCandidates(c1, role, profile, basePoint, tol);
        var top = projectedParamCandidates(c2, role, profile, topPoint, tol);
        if (!base.length || !top.length) return;
        observations.push({role:role, base:base, top:top, ids:chain.ids.slice(),
          basePoint:basePoint, topPoint:topPoint, segments:chain.ids.length,
          sourceSegments:chain.sourceSegments || []});
      });
    });
    return observations;
  }
  function ringCorrespondence(c1, c2, entities, profile, tol, boundaries) {
    var observations = ringObservations(c1, c2, entities, profile, tol, boundaries);
    if (!observations.length) return {status:'missing', observations:observations};
    var k1 = conic(c1), k2 = conic(c2);
    var scale = Math.max(k1 ? k1.scale : 1, k2 ? k2.scale : 1);
    var angleTol = Math.max(1e-7, Math.min(0.2, tol / Math.max(1, scale)));
    var maps = [];
    function addMap(s, phi) {
      var wrapped = wrapParam(phi);
      for (var i = 0; i < maps.length; i++) {
        if (maps[i].s === s && angleDistance(maps[i].phi, wrapped) <= angleTol) return;
      }
      maps.push({s:s, phi:wrapped});
    }
    observations.forEach(function (obs) {
      obs.base.forEach(function (u1) {
        obs.top.forEach(function (u2) {
          addMap(1, u2 - u1);
          addMap(-1, u2 + u1);
        });
      });
    });
    function matches(obs, map) {
      return obs.base.some(function (u1) {
        return obs.top.some(function (u2) {
          return angleDistance(u2, map.s * u1 + map.phi) <= angleTol;
        });
      });
    }
    var valid = maps.filter(function (map) {
      return observations.every(function (obs) { return matches(obs, map); });
    });
    if (!valid.length) return {status:'conflict', observations:observations,
      angleTolerance:angleTol};
    if (valid.length > 1) return {status:'ambiguous', candidates:valid,
      observations:observations, angleTolerance:angleTol};
    return {status:'ok', correspondence:valid[0], observations:observations,
      angleTolerance:angleTol};
  }
  function matchedGeneratorPairs(observation, correspondence, angleTol) {
    var out = [];
    observation.base.forEach(function (u1) {
      observation.top.forEach(function (u2) {
        var error = angleDistance(u2, correspondence.s * u1 + correspondence.phi);
        if (error <= angleTol) out.push({u1:u1, u2:u2, error:error});
      });
    });
    out.sort(function (a, b) { return a.error - b.error; });
    return out;
  }
  function generalRingFamily(c1, c2, correspondence) {
    if (!Implicit || !Implicit.ruledConicAffineRecord) return null;
    var k1 = conic(c1), k2 = conic(c2);
    if (!k1 || !k2) return null;
    var cphi = Math.cos(correspondence.phi), sphi = Math.sin(correspondence.phi);
    var A2 = add(mul(k2.A, cphi), mul(k2.B, sphi));
    var B2 = mul(add(mul(k2.B, cphi), mul(k2.A, -sphi)), correspondence.s);
    var spec = {C:k1.C, A:k1.A, B:k1.B, A2:A2, B2:B2, D:k2.C};
    var geometry = Implicit.ruledConicAffineGeometry(spec);
    if (!geometry) return null;
    if (geometry.regularityUnresolved || geometry.singular.length)
      return {equation:null, geometry:geometry, A2:A2, B2:B2,
        correspondence:correspondence, singular:geometry.singular,
        regularityUnresolved:geometry.regularityUnresolved === true};
    var equation = Implicit.ruledConicAffineRecord(spec);
    if (!equation) return null;
    var tol = Math.max(analyticTolerance(k1.scale), analyticTolerance(k2.scale));
    var samples = sampleCurve(c1, 16).concat(sampleCurve(c2, 16));
    for (var i = 0; i < samples.length; i++) {
      var evaluated = Implicit.evaluate(equation, samples[i]);
      if (!evaluated) return null;
      var gradient = length(evaluated.gradient);
      if (!(gradient > 0) || Math.abs(evaluated.value) / gradient > 10 * tol) return null;
    }
    return {equation:equation, geometry:geometry, A2:A2, B2:B2,
      correspondence:correspondence, tol:tol, singular:geometry.singular,
      det:geometry.det};
  }
  function ringIssue(result, code, message, entityId, extra) {
    if (result.issues.some(function (issue) { return issue.code === code &&
        issue.entityId === (entityId || undefined); })) return;
    var issue = {code:code, message:message};
    if (entityId) issue.entityId = entityId;
    if (extra) Object.keys(extra).forEach(function (key) { issue[key] = extra[key]; });
    result.issues.push(issue);
  }
  function pruneStaleEdges(geometry, state, candidates) {
    if (!candidates || !candidates.length) return;
    var used = new Set(), pairIndex = new Map();
    (geometry.edges || []).forEach(function (edge, index) {
      pairIndex.set(edgeKey(edge[0], edge[1]), index);
    });
    (geometry.faces || []).forEach(function (face) {
      for (var i = 0; i < face.length; i++) {
        var index = pairIndex.get(edgeKey(face[i], face[(i + 1) % face.length]));
        if (index !== undefined) used.add(index);
      }
    });
    (geometry.curves || []).forEach(function (curve) {
      (curve.displayEdges || []).forEach(function (index) { used.add(index); });
    });
    var remove = new Set();
    candidates.forEach(function (index) {
      if (Number.isInteger(index) && index >= 0 && index < (geometry.edges || []).length &&
          !used.has(index)) remove.add(index);
    });
    if (!remove.size) return;
    var remap = new Map(), edges = [];
    (geometry.edges || []).forEach(function (edge, index) {
      if (remove.has(index)) return;
      remap.set(index, edges.length);
      edges.push(edge);
    });
    geometry.edges = edges;
    state.edgeMap = new Map();
    edges.forEach(function (edge, index) {
      state.edgeMap.set(edgeKey(edge[0], edge[1]), index);
    });
    (geometry.curves || []).forEach(function (curve) {
      curve.displayEdges = (curve.displayEdges || []).map(function (index) {
        return remap.get(index);
      }).filter(function (index) { return index !== undefined; });
    });
    (geometry.generatorLines || []).forEach(function (line) {
      if (remap.has(line.edgeIndex)) line.edgeIndex = remap.get(line.edgeIndex);
      else line.edgeIndex = undefined;
    });
    (geometry.surfacePatches || []).forEach(function (patch) {
      if (!patch || !patch.inference || !Array.isArray(patch.inference.generators)) return;
      patch.inference.generators.forEach(function (generator) {
        if (remap.has(generator.edgeIndex)) generator.edgeIndex = remap.get(generator.edgeIndex);
        else generator.edgeIndex = undefined;
      });
      patch.inference.generators = patch.inference.generators.filter(function (generator) {
        return generator.edgeIndex !== undefined;
      });
      if (!patch.inference.generators.length) delete patch.inference.generators;
    });
  }
  function oldVertexForParam(entries, param, tolerance) {
    for (var i = 0; i < entries.length; i++) {
      if (Number.isInteger(entries[i].index) &&
          angleDistance(entries[i].param, param) <= tolerance) return entries[i];
    }
    return null;
  }
  function addGeneralGenerator(patch, geometry, observation, pair, index, state, c1, c2, topVertexOverride) {
    var basePoint = conicPoint(c1, pair.u1);
    var topPoint = conicPoint(c2, pair.u2);
    var direction = unit(sub(topPoint, basePoint));
    if (!direction) return null;
    var baseVertex = c1.displayVertices[index];
    var topVertex = topVertexOverride === undefined ? c2.displayVertices[index] : topVertexOverride;
    if (!Number.isInteger(baseVertex) || !Number.isInteger(topVertex)) return null;
    var edgeIndex = state.edgeMap.get(edgeKey(baseVertex, topVertex));
    if (edgeIndex === undefined) return null;
    var record = {sourceIds:observation.ids.slice(), views:[observation.role],
      base:basePoint, top:topPoint, direction:direction,
      length:length(sub(topPoint, basePoint)), u:pair.u1,
      baseVertex:baseVertex, topVertex:topVertex, edgeIndex:edgeIndex,
      sourceSegments:(observation.sourceSegments || []).map(function (segment) {
        return {id:segment.id, from:segment.from, to:segment.to,
          p:{x:segment.p.x, y:segment.p.y}, q:{x:segment.q.x, y:segment.q.y}};
      }),
      surfacePatch:geometry.surfacePatches.indexOf(patch)};
    var duplicate = (geometry.generatorLines || []).find(function (existing) {
      return existing && existing.edgeIndex === edgeIndex &&
        Math.abs(existing.u - record.u) <= 1e-7;
    });
    if (duplicate) {
      if (duplicate.views.indexOf(observation.role) === -1) duplicate.views.push(observation.role);
      observation.ids.forEach(function (id) {
        if (duplicate.sourceIds.indexOf(id) === -1) duplicate.sourceIds.push(id);
      });
      (observation.sourceSegments || []).forEach(function (segment) {
        var exists = (duplicate.sourceSegments || []).some(function (existing) {
          return existing.id === segment.id &&
            Math.abs(existing.from - segment.from) <= 1e-9 &&
            Math.abs(existing.to - segment.to) <= 1e-9;
        });
        if (!exists) {
          duplicate.sourceSegments = duplicate.sourceSegments || [];
          duplicate.sourceSegments.push({id:segment.id, from:segment.from, to:segment.to,
            p:{x:segment.p.x, y:segment.p.y}, q:{x:segment.q.x, y:segment.q.y}});
        }
      });
    } else {
      geometry.generatorLines = geometry.generatorLines || [];
      geometry.generatorLines.push(record);
    }
    return record;
  }
  function tryGeneralRing(geometry, entities, profile, state, result, claimed, blocked, ci1, ci2, c1, c2, options) {
    if (!Implicit || !Implicit.ruledConicAffineRecord) return false;
    options = options || {};
    function block() {
      if (blocked) { blocked.add(ci1); blocked.add(ci2); }
    }
    function note(code, message, entityId, always) {
      if (!options.quiet || always) ringIssue(result, code, message, entityId);
    }
    var k1 = conic(c1), k2 = conic(c2);
    if (!k1 || !k2) return false;
    if (!c1.displayVertices || c1.displayVertices.length < 3 ||
        !c2.displayVertices || c2.displayVertices.length < 3) return false;
    var tol = Math.max(analyticTolerance(k1.scale), analyticTolerance(k2.scale));
    var evidence, family;
    if (options.preset) {
      var presetObservations = ringObservations(c1, c2, entities, profile, tol, geometry.curves);
      if (!presetObservations.length) return false;
      var presetScale = Math.max(k1.scale, k2.scale);
      var presetAngleTolerance = Math.max(1e-7, Math.min(0.2, tol / Math.max(1, presetScale)));
      var presetMatches = presetObservations.every(function (observation) {
        return matchedGeneratorPairs(observation, options.preset.correspondence,
          presetAngleTolerance).length > 0;
      });
      if (!presetMatches) {
        block();
        note('surface-ruled-generator-conflict',
          'A drawn generator that touches both boundaries does not belong to the supported optimized ruled surface; the side patch is unresolved rather than certified.',
          (c1.sourceIds || [])[0]);
        return false;
      }
      var presetGeometry = Implicit.ruledConicAffineGeometry({C:k1.C, A:k1.A, B:k1.B,
        A2:options.preset.A2, B2:options.preset.B2, D:k2.C});
      if (!presetGeometry) return false;
      evidence = {status:'ok', correspondence:options.preset.correspondence,
        observations:presetObservations, angleTolerance:presetAngleTolerance};
      family = {A2:options.preset.A2, B2:options.preset.B2, geometry:presetGeometry,
        equation:options.preset.equation, correspondence:options.preset.correspondence,
        singular:[], preset:options.preset};
    } else {
      evidence = ringCorrespondence(c1, c2, entities, profile, tol, geometry.curves);
      if (evidence.status === 'missing') return false;
      if (evidence.status === 'ambiguous') {
        block();
        note('surface-ruled-correspondence-ambiguous',
          'The drawn generator contacts leave more than one angular correspondence between these boundaries; the connecting surface is unresolved.',
          (c1.sourceIds || [])[0]);
        return false;
      }
      if (evidence.status === 'conflict') {
        block();
        note('surface-ruled-correspondence-conflict',
          'The drawn generator contacts do not agree on one angular correspondence between these boundaries; the connecting surface is unresolved.',
          (c1.sourceIds || [])[0]);
        return false;
      }
      family = generalRingFamily(c1, c2, evidence.correspondence);
      if (!family) {
        block();
        note('surface-ruled-family-unsupported',
          'The supported boundary curves do not define a supported parallel-plane affine ruled conic patch; the connecting surface is unresolved.',
          (c1.sourceIds || [])[0], true);
        return false;
      }
      if (family.singular.length || family.regularityUnresolved) {
        block();
        note('surface-ruled-singular-station',
          'The affine ruled conic chart has a singular or unresolved determinant station inside its finite domain; the connecting surface is retained unresolved rather than drawn as a regular patch.',
          (c1.sourceIds || [])[0], true);
        return false;
      }
    }
    var angleTol = evidence.angleTolerance;
    var sourcePairs = [];
    evidence.observations.forEach(function (observation) {
      var pairs = matchedGeneratorPairs(observation, evidence.correspondence, angleTol);
      if (!pairs.length) return;
      var best = pairs[0];
      var ambiguous = pairs.some(function (pair) {
        return angleDistance(pair.u1, best.u1) > angleTol && pair.error <= best.error + angleTol;
      });
      if (ambiguous) return;
      sourcePairs.push({observation:observation, pair:best});
    });
    var staleRingEdges = (c1.displayEdges || []).slice().concat(c2.displayEdges || []);
    removeCaps(state, c1);
    removeCaps(state, c2);
    var oldBase = curveDisplayParams(c1).map(function (param, i) {
      return {param:wrapParam(param), index:c1.displayVertices[i]};
    });
    var oldTop = curveDisplayParams(c2).map(function (param, i) {
      return {param:wrapParam(param), index:c2.displayVertices[i]};
    });
    var angles = [];
    function addAngle(value) {
      var wrapped = wrapParam(value);
      for (var i = 0; i < angles.length; i++) {
        if (angleDistance(angles[i], wrapped) <= 1e-9) return;
      }
      angles.push(wrapped);
    }
    curveDisplayParams(c1).forEach(addAngle);
    curveDisplayParams(c2).forEach(function (param) {
      addAngle(evidence.correspondence.s > 0 ? param - evidence.correspondence.phi :
        evidence.correspondence.phi - param);
    });
    sourcePairs.forEach(function (entry) { addAngle(entry.pair.u1); });
    angles.sort(function (a, b) { return a - b; });
    if (angles.length < 3) return false;
    var baseIndices = [], topIndices = [], basePoints = [], topPoints = [];
    angles.forEach(function (u) {
      var base = conicPoint(c1, u);
      var topParam = conicChordParams(c2, evidence.correspondence.s,
        evidence.correspondence.phi, u);
      var top = conicPoint(c2, topParam);
      var oldBaseEntry = oldVertexForParam(oldBase, u, 1e-9);
      var oldTopEntry = oldVertexForParam(oldTop, topParam, 1e-9);
      baseIndices.push(oldBaseEntry ? oldBaseEntry.index : vertexAt(state, base, tol));
      topIndices.push(oldTopEntry ? oldTopEntry.index : vertexAt(state, top, tol));
      basePoints.push(base);
      topPoints.push(top);
    });
    c1.displayVertices = baseIndices;
    c2.displayVertices = topIndices;
    c1.displayEdges = [];
    c2.displayEdges = [];
    var count = angles.length;
    for (var e = 0; e < count; e++) {
      c1.displayEdges.push(addEdge(state, baseIndices[e], baseIndices[(e + 1) % count]));
      c2.displayEdges.push(addEdge(state, topIndices[e], topIndices[(e + 1) % count]));
    }
    var N = family.geometry.N, h = family.geometry.h;
    var span = sub(k2.C, k1.C);
    function sideNormal(u) {
      var mid = add(k1.A, mul(sub(family.A2, k1.A), 0.5));
      var midB = add(k1.B, mul(sub(family.B2, k1.B), 0.5));
      var tangent = add(mul(mid, -Math.sin(u)), mul(midB, Math.cos(u)));
      var station = add(span, add(mul(sub(family.A2, k1.A), Math.cos(u)),
        mul(sub(family.B2, k1.B), Math.sin(u))));
      return unit(cross(tangent, station));
    }
    var faceIndices = [];
    for (var i = 0; i < count; i++) {
      var j = (i + 1) % count;
      var a = baseIndices[i], b = baseIndices[j];
      var c = topIndices[i], d = topIndices[j];
      addEdge(state, a, b); addEdge(state, c, d);
      addEdge(state, a, c); addEdge(state, b, d); addEdge(state, a, d);
      var uMid = angles[i] + 0.5 * (j === 0 ? TAU - angles[i] + angles[0] :
        angles[j] - angles[i]);
      var desired = sideNormal(uMid);
      faceIndices.push(addFace(state, [a, b, d], null, true, desired));
      faceIndices.push(addFace(state, [a, d, c], null, true, desired));
    }
    var baseCap = addFace(state, baseIndices.slice(), null, false, mul(N, -1));
    var topCap = addFace(state, topIndices.slice(), null, false, N);
    var capBaseIds = (c1.sourceIds || []).slice();
    var capTopIds = (c2.sourceIds || []).slice();
    geometry.surfacePatches.push({kind:'plane', boundaryCurves:[ci1],
      loops:[{kind:'outer', curves:[ci1]}], origin:c1.center,
      normal:mul(N, -1), u:c1.u, v:c1.v, faceIndices:[baseCap], sourceIds:capBaseIds});
    geometry.surfacePatches.push({kind:'plane', boundaryCurves:[ci2],
      loops:[{kind:'outer', curves:[ci2]}], origin:c2.center,
      normal:N, u:c2.u, v:c2.v, faceIndices:[topCap], sourceIds:capTopIds});
    var generatorIds = [];
    sourcePairs.forEach(function (entry) {
      entry.observation.ids.forEach(function (id) {
        if (generatorIds.indexOf(id) === -1) generatorIds.push(id);
      });
    });
    var sourceIds = Array.from(new Set(capBaseIds.concat(capTopIds, generatorIds)));
    if (family.equation.identity) family.equation.identity.sourceIds = sourceIds.slice();
    if (family.equation.sourceEvidence) family.equation.sourceEvidence.sourceIds = sourceIds.slice();
    var preset = family.preset || null;
    var generatorRecord = preset ? preset.generator : {C:k1.C, A:k1.A, B:k1.B, D:k2.C,
      A2:family.A2, B2:family.B2, n:N, h:h,
      correspondence:{s:evidence.correspondence.s, phi:evidence.correspondence.phi}};
    var inferenceRecord = preset ? {
      family:preset.family, endpoint:'ring', status:'inferred',
      correspondence:{s:evidence.correspondence.s, phi:evidence.correspondence.phi},
      views:evidence.observations.map(function (observation) { return observation.role; })
        .filter(function (role, index, all) { return all.indexOf(role) === index; }),
      generatorSourceIds:generatorIds.slice()} : {
      family:'general-affine-ruled-conic', endpoint:'ring', status:'inferred',
      correspondence:{s:evidence.correspondence.s, phi:evidence.correspondence.phi},
      views:evidence.observations.map(function (observation) { return observation.role; })
        .filter(function (role, index, all) { return all.indexOf(role) === index; }),
      generatorSourceIds:generatorIds.slice()};
    if (preset && preset.inference)
      Object.keys(preset.inference).forEach(function (key) {
        if (inferenceRecord[key] === undefined) inferenceRecord[key] = preset.inference[key];
      });
    geometry.surfacePatches.push({kind:'implicit', analyticKind:'ruledConic',
      boundaryCurves:[ci1, ci2], faceIndices:faceIndices, sourceIds:sourceIds,
      implicit:family.equation, generator:generatorRecord, origin:k1.C, inferred:true,
      inference:inferenceRecord,
      displayTessellation:{kind:'union-ring-triangulation', samples:count,
        nonplanar:'triangulated', smooth:true}});
    pruneStaleEdges(geometry, state, staleRingEdges);
    var usedObservations = [];
    sourcePairs.forEach(function (entry) {
      var index = -1;
      for (var ai = 0; ai < angles.length; ai++) {
        if (angleDistance(angles[ai], entry.pair.u1) <= angleTol) { index = ai; break; }
      }
      if (index < 0) return;
      var record = addGeneralGenerator(geometry.surfacePatches[geometry.surfacePatches.length - 1],
        geometry, entry.observation, entry.pair, index, state, c1, c2);
      if (record) usedObservations.push(entry.observation);
    });
    if (geometry.generatorLines && geometry.generatorLines.length) {
      geometry.surfacePatches[geometry.surfacePatches.length - 1].inference.generators =
        geometry.generatorLines.map(function (line) {
          return {u:line.u, sourceIds:line.sourceIds.slice(), views:line.views.slice(),
            edgeIndex:line.edgeIndex};
        });
    }
    sourcePairs.forEach(function (entry) {
      entry.observation.ids.forEach(function (id) { result.consumedIds.push(id); });
    });
    (c1.sourceIds || []).concat(c2.sourceIds || []).forEach(function (id) {
      result.resolvedIds.push(id);
    });
    result.patches.push({curves:[ci1, ci2], correspondence:evidence.correspondence,
      views:evidence.observations.map(function (observation) { return observation.role; })
        .filter(function (role, index, all) { return all.indexOf(role) === index; }),
      samples:count});
    claimed.add(ci1); claimed.add(ci2);
    return true;
  }
  function ownedBoundary(geometry, index) {
    var curve = geometry.curves && geometry.curves[index];
    if (curve && (curve.recessMouth || curve.recessBottom || curve.throughOpening))
      return true;
    return (geometry.surfacePatches || []).some(function (patch) {
      if ((patch.boundaryCurves || []).indexOf(index) === -1) return false;
      if (patch.kind !== 'plane') return true;
      return !!(patch.recessBottom || patch.recessMouth || patch.closure ||
        patch.volumeIndex !== undefined || patch.memberRole);
    });
  }
  function planGeneralBand(geometry, entities, profile, ci1, ci2, c1, c2) {
    if (!Implicit || !Implicit.ruledConicAffineRecord) return {status:'missing'};
    var k1 = conic(c1), k2 = conic(c2);
    if (!k1 || !k2) return {status:'missing'};
    if (!c1.displayVertices || c1.displayVertices.length < 3 ||
        !c2.displayVertices || c2.displayVertices.length < 3) return {status:'missing'};
    var tol = Math.max(analyticTolerance(k1.scale), analyticTolerance(k2.scale));
    var scale = Math.max(k1.scale, k2.scale);
    var angleTol = Math.max(1e-7, Math.min(0.2, tol / Math.max(1, scale)));
    var legacy = null, homotheticConflict = null;
    var homothetic = ringFamily(c1, c2);
    if (homothetic && curveResidual(homothetic.q, c1, 24) <= homothetic.tol &&
        curveResidual(homothetic.q, c2, 24) <= homothetic.tol) {
      var legacyEvidence = ringGenerators(geometry, c1, c2, homothetic.k,
        entities, profile, null, geometry.curves);
      if (legacyEvidence.conflict)
        homotheticConflict = {ids:legacyEvidence.conflictIds.slice()};
      if (legacyEvidence.valid) {
        var displayAngles = curveDisplayParams(c1).map(wrapParam);
        var offGrid = legacyEvidence.angles.some(function (angle) {
          return !displayAngles.some(function (param) {
            return angleDistance(param, angle) <= angleTol;
          });
        });
        legacy = {family:homothetic, evidence:legacyEvidence,
          count:Math.min(c1.displayVertices.length, c2.displayVertices.length),
          onGrid:!offGrid};
      }
    }
    var evidence = ringCorrespondence(c1, c2, entities, profile, tol, geometry.curves);
    if (legacy) {
      evidence = {status:'ok', correspondence:{s:1, phi:0},
        observations:evidence.observations || [], angleTolerance:angleTol};
    } else {
      if (evidence.status === 'missing') return {status:'missing'};
      if (homotheticConflict && evidence.status !== 'ok') return {status:'conflict', observationCount:evidence.observations.length,
        issue:{code:'surface-ruled-generator-conflict', entityId:(c1.sourceIds || [])[0],
          generatorId:homotheticConflict.ids[0] || null,
          message:'A drawn generator that touches both boundaries does not belong to the supported optimized ruled surface; the side patch is unresolved rather than certified.'}};
      if (evidence.status === 'ambiguous') return {status:'ambiguous', observationCount:evidence.observations.length,
        issue:{code:'surface-ruled-correspondence-ambiguous', entityId:(c1.sourceIds || [])[0],
          message:'The drawn generator contacts leave more than one angular correspondence between these boundaries; the connecting surface is unresolved.'}};
      if (evidence.status === 'conflict') return {status:'conflict', observationCount:evidence.observations.length,
        issue:{code:'surface-ruled-correspondence-conflict', entityId:(c1.sourceIds || [])[0],
          message:'The drawn generator contacts do not agree on one angular correspondence between these boundaries; the connecting surface is unresolved.'}};
    }
    var family = generalRingFamily(c1, c2, evidence.correspondence);
    if (!family && !legacy) {
      if (homotheticConflict) return {status:'conflict', observationCount:evidence.observations.length,
        issue:{code:'surface-ruled-generator-conflict', entityId:(c1.sourceIds || [])[0],
          generatorId:homotheticConflict.ids[0] || null,
          message:'A drawn generator that touches both boundaries does not belong to the supported optimized ruled surface; the side patch is unresolved rather than certified.'}};
      return {status:'unsupported', observationCount:evidence.observations.length,
        issue:{code:'surface-ruled-family-unsupported', entityId:(c1.sourceIds || [])[0],
          message:'The supported boundary curves do not define a supported parallel-plane affine ruled conic patch; the connecting surface is unresolved.'}};
    }
    if (family && (family.singular.length || family.regularityUnresolved))
      return {status:'unsupported', observationCount:evidence.observations.length,
        issue:{code:'surface-ruled-singular-station', entityId:(c1.sourceIds || [])[0],
          message:'The affine ruled conic chart has a singular or unresolved determinant station inside its finite domain; the connecting surface is retained unresolved rather than drawn as a regular patch.'}};
    var sourcePairs = [];
    if (!legacy || !legacy.onGrid) {
      evidence.observations.forEach(function (observation) {
        var pairs = matchedGeneratorPairs(observation, evidence.correspondence, angleTol);
        if (!pairs.length) return;
        var best = pairs[0];
        var ambiguous = pairs.some(function (pair) {
          return angleDistance(pair.u1, best.u1) > angleTol && pair.error <= best.error + angleTol;
        });
        if (ambiguous) return;
        sourcePairs.push({observation:observation, pair:best});
      });
    }
    return {status:'ok', ci1:ci1, ci2:ci2, c1:c1, c2:c2,
      evidence:evidence, family:family, angleTol:angleTol,
      sourcePairs:sourcePairs, legacy:legacy};
  }
  function bandTopParam(band, u) {
    var correspondence = band.evidence.correspondence;
    return wrapParam(correspondence.s > 0 ? u + correspondence.phi : correspondence.phi - u);
  }
  function bandBaseParam(band, v) {
    var correspondence = band.evidence.correspondence;
    return wrapParam(correspondence.s > 0 ? v - correspondence.phi : correspondence.phi - v);
  }
  function addStationParam(table, index, param) {
    var list = table.get(index);
    if (!list) { list = []; table.set(index, list); }
    var wrapped = wrapParam(param);
    for (var i = 0; i < list.length; i++) {
      if (angleDistance(list[i], wrapped) <= 1e-9) return false;
    }
    list.push(wrapped);
    return true;
  }
  function stationParamIndex(list, param) {
    for (var i = 0; i < list.length; i++) {
      if (angleDistance(list[i], param) <= 1e-9) return i;
    }
    return -1;
  }
  function materializeStations(geometry, state, c, params, tol) {
    var old = curveDisplayParams(c);
    var unchanged = old.length === params.length && old.every(function (param) {
      return stationParamIndex(params, param) !== -1;
    });
    if (unchanged) return;
    var start = old.length ? wrapParam(old[0]) : wrapParam(params[0]);
    function fromStart(param) { return wrapParam(wrapParam(param) - start); }
    var ordered = params.map(wrapParam).sort(function (a, b) {
      return fromStart(a) - fromStart(b);
    });
    var indices = [];
    ordered.forEach(function (param) {
      var existing = -1;
      for (var i = 0; i < old.length; i++) {
        if (angleDistance(old[i], param) <= 1e-9) {
          existing = c.displayVertices[i];
          break;
        }
      }
      if (existing < 0) existing = vertexAt(state, conicPoint(c, param), tol);
      indices.push(existing);
    });
    c.displayParams = ordered.slice();
    c.displayVertices = indices;
    c.displayEdges = [];
    for (var i = 0; i < indices.length; i++) {
      c.displayEdges.push(addEdge(state, indices[i], indices[(i + 1) % indices.length]));
    }
  }
  function applyCurveTransform(transform, alpha) {
    return wrapParam(transform.s*alpha + transform.phi);
  }
  function inverseCurveTransform(transform, param) {
    return wrapParam(transform.s*(param - transform.phi));
  }
  function midSurfaceOutward(band, u) {
    var k1 = conic(band.c1), k2 = conic(band.c2);
    if (!k1 || !k2) return null;
    var A2 = band.family ? band.family.A2 : mul(k1.A, band.legacy.family.k);
    var B2 = band.family ? band.family.B2 : mul(k1.B, band.legacy.family.k);
    var radial = add(mul(add(k1.A, A2), 0.5*Math.cos(u)),
      mul(add(k1.B, B2), 0.5*Math.sin(u)));
    var point = add(mul(add(k1.C, k2.C), 0.5), radial);
    var gradient = null;
    if (band.legacy && band.legacy.family.q) {
      gradient = band.legacy.family.q.gradient(point);
    } else if (band.family && Implicit && Implicit.evaluate) {
      var evaluated = Implicit.evaluate(band.family.equation, point);
      gradient = evaluated && evaluated.gradient;
    }
    if (!gradient || !(length(gradient) > EPS)) return null;
    var direction = unit(gradient);
    if (dot(direction, radial) < 0) direction = mul(direction, -1);
    return direction;
  }
  function inferGeneralGraph(geometry, entities, profile, state, result, claimed, blocked) {
    var curves = geometry.curves || [];
    var plans = [], relationFailure = new Set(), staleEdges = [];
    for (var i = 0; i < curves.length; i++) for (var j = i + 1; j < curves.length; j++) {
      if (!curves[i] || !curves[j]) continue;
      if (!finite(curves[i].center) || !finite(curves[j].center)) continue;
      if (!full(curves[i]) || !full(curves[j])) continue;
      if (blocked && (blocked.has(i) || blocked.has(j))) continue;
      if (claimed.has(i) || claimed.has(j)) continue;
      if (ownedBoundary(geometry, i) || ownedBoundary(geometry, j)) continue;
      var baseIndex = i, topIndex = j;
      for (var axisIndex = 0; axisIndex < 3; axisIndex++) {
        var axis = ['x','y','z'][axisIndex];
        var deltaCenter = curves[i].center[axis] - curves[j].center[axis];
        if (Math.abs(deltaCenter) > 1e-9) { if (deltaCenter > 0) baseIndex = j, topIndex = i; break; }
      }
      var plan = planGeneralBand(geometry, entities, profile, baseIndex, topIndex,
        curves[baseIndex], curves[topIndex]);
      if (plan.status === 'missing') continue;
      if (plan.status !== 'ok') {
        if (plan.issue) ringIssue(result, plan.issue.code, plan.issue.message, plan.issue.entityId,
          plan.issue.generatorId ? {generatorId:plan.issue.generatorId} : null);
        relationFailure.add(i); relationFailure.add(j);
        continue;
      }
      plans.push(plan);
    }
    if (!plans.length) {
      relationFailure.forEach(function (index) { if (!claimed.has(index) && blocked) blocked.add(index); });
      return false;
    }
    var parent = curves.map(function (_, index) { return index; });
    function root(index) { while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; } return index; }
    var degree = Object.create(null), selected = [];
    plans.forEach(function (candidate) {
      var a = candidate.ci1, b = candidate.ci2;
      if ((degree[a] || 0) >= 2 || (degree[b] || 0) >= 2) {
        ringIssue(result, 'surface-ruled-incidence-branch',
          'More than two supported side bands meet at a boundary; this branch is not emitted and the incidence is unresolved by the current graph policy.',
          (curves[a].sourceIds || [])[0]);
        relationFailure.add(a); relationFailure.add(b);
        return;
      }
      if (root(a) === root(b)) {
        ringIssue(result, 'surface-ruled-incidence-cycle',
          'The supported side bands close a cycle; this cycle is unsupported by the current shell policy, so the extra band is not emitted and the relation remains unresolved.',
          (curves[a].sourceIds || [])[0]);
        relationFailure.add(a); relationFailure.add(b);
        return;
      }
      parent[root(b)] = root(a);
      degree[a] = (degree[a] || 0) + 1;
      degree[b] = (degree[b] || 0) + 1;
      selected.push(candidate);
    });
    if (!selected.length) {
      relationFailure.forEach(function (index) { if (!claimed.has(index) && blocked) blocked.add(index); });
      return false;
    }
    var components = new Map();
    selected.forEach(function (band) {
      var componentRoot = root(band.ci1);
      if (!components.has(componentRoot)) components.set(componentRoot, []);
      components.get(componentRoot).push(band);
    });
    var emitted = false;
    components.forEach(function (bands) {
      var curveIndices = [];
      bands.forEach(function (band) {
        [band.ci1, band.ci2].forEach(function (index) {
          if (curveIndices.indexOf(index) === -1) curveIndices.push(index);
        });
      });
      curveIndices.sort(function (a, b) { return a - b; });
      var adjacency = new Map();
      curveIndices.forEach(function (index) { adjacency.set(index, []); });
      bands.forEach(function (band) {
        var correspondence = band.evidence.correspondence;
        adjacency.get(band.ci1).push({to:band.ci2, s:correspondence.s, phi:correspondence.phi});
        adjacency.get(band.ci2).push({to:band.ci1, s:correspondence.s,
          phi:wrapParam(-correspondence.s*correspondence.phi)});
      });
      var transforms = new Map();
      var start = curveIndices[0];
      transforms.set(start, {s:1, phi:0});
      var queue = [start], conflict = false;
      while (queue.length && !conflict) {
        var current = queue.shift(), base = transforms.get(current);
        adjacency.get(current).forEach(function (edge) {
          if (conflict) return;
          var next = {s:edge.s*base.s, phi:wrapParam(edge.s*base.phi + edge.phi)};
          if (!transforms.has(edge.to)) {
            transforms.set(edge.to, next);
            queue.push(edge.to);
            return;
          }
          var existing = transforms.get(edge.to);
          if (existing.s !== next.s ||
              angleDistance(existing.phi, next.phi) > 1e-7) conflict = true;
        });
      }
      if (conflict) {
        ringIssue(result, 'surface-ruled-station-conflict',
          'The supported side bands impose incompatible intrinsic boundary phases; the component is retained unresolved rather than emitted with a discontinuous seam.',
          (curves[start].sourceIds || [])[0]);
        return;
      }
      var rootStations = [];
      function addRootStation(value) {
        var wrapped = wrapParam(value);
        for (var index = 0; index < rootStations.length; index++) {
          if (angleDistance(rootStations[index], wrapped) <= 1e-9) return;
        }
        rootStations.push(wrapped);
      }
      curveIndices.forEach(function (index) {
        curveDisplayParams(curves[index]).forEach(function (param) {
          addRootStation(inverseCurveTransform(transforms.get(index), param));
        });
      });
      bands.forEach(function (band) {
        var baseTransform = transforms.get(band.ci1);
        var topTransform = transforms.get(band.ci2);
        band.sourcePairs.forEach(function (entry) {
          addRootStation(inverseCurveTransform(baseTransform, entry.pair.u1));
          addRootStation(inverseCurveTransform(topTransform, entry.pair.u2));
        });
      });
      var localStations = new Map();
      curveIndices.forEach(function (index) {
        var transform = transforms.get(index);
        var params = rootStations.map(function (alpha) {
          return applyCurveTransform(transform, alpha);
        });
        localStations.set(index, params);
      });
      var mappingFailure = false;
      bands.forEach(function (band) {
        var baseParams = localStations.get(band.ci1), topParams = localStations.get(band.ci2);
        if (baseParams.length !== topParams.length) { mappingFailure = true; return; }
        baseParams.forEach(function (param) {
          if (stationParamIndex(topParams, bandTopParam(band, param)) < 0) mappingFailure = true;
        });
      });
      if (mappingFailure) {
        ringIssue(result, 'surface-ruled-station-conflict',
          'The propagated boundary stations do not pair across every supported side band; the component is retained unresolved rather than emitted with a T-junction.',
          (curves[start].sourceIds || [])[0]);
        return;
      }
      curveIndices.forEach(function (index) {
        var curve = curves[index];
        var oldVertices = (curve.displayVertices || []).slice();
        for (var edgeIndex = 0; edgeIndex < oldVertices.length; edgeIndex++) {
          var chord = state.edgeMap.get(edgeKey(oldVertices[edgeIndex],
            oldVertices[(edgeIndex + 1) % oldVertices.length]));
          if (chord !== undefined) staleEdges.push(chord);
        }
        (curve.displayEdges || []).forEach(function (edgeIndex) { staleEdges.push(edgeIndex); });
        removeCaps(state, curve);
        materializeStations(geometry, state, curve, localStations.get(index),
          analyticTolerance(conic(curves[index]).scale));
      });
      var entries = [];
      bands.forEach(function (band) {
        var c1 = band.c1, c2 = band.c2;
        var baseParams = curveDisplayParams(c1), topParams = curveDisplayParams(c2);
        var count = baseParams.length;
        if (!(count >= 3) || topParams.length !== count) { mappingFailure = true; return; }
        var baseIndices = [], topIndices = [];
        for (var index = 0; index < count; index++) {
          var topIndex = stationParamIndex(topParams, bandTopParam(band, baseParams[index]));
          if (topIndex < 0) { mappingFailure = true; return; }
          baseIndices.push(c1.displayVertices[index]);
          topIndices.push(c2.displayVertices[topIndex]);
        }
        var k1 = conic(c1), k2 = conic(c2);
        var normal = band.legacy ? unit(band.legacy.family.q.n) : band.family.geometry.N;
        var span = sub(k2.C, k1.C);
        if (dot(span, normal) < 0) normal = mul(normal, -1);
        function sideNormal(u) {
          var midA = add(k1.A, mul(sub(band.family.A2, k1.A), 0.5));
          var midB = add(k1.B, mul(sub(band.family.B2, k1.B), 0.5));
          var tangent = add(mul(midA, -Math.sin(u)), mul(midB, Math.cos(u)));
          var station = add(span, add(mul(sub(band.family.A2, k1.A), Math.cos(u)),
            mul(sub(band.family.B2, k1.B), Math.sin(u))));
          return unit(cross(tangent, station));
        }
        var legacyMode = band.legacy && band.legacy.onGrid && count === band.legacy.count;
        var faces = [];
        if (legacyMode) {
          for (var i = 0; i < count; i++) {
            var j = (i + 1) % count;
            var a = baseIndices[i], b = baseIndices[j], c = topIndices[i], d = topIndices[j];
            var next = baseParams[j];
            var delta = j === 0 ? wrapParam(baseParams[0] + TAU - baseParams[i]) :
              wrapParam(next - baseParams[i]);
            var desired = midSurfaceOutward(band, baseParams[i] + 0.5*delta);
            addEdge(state, a, b); addEdge(state, c, d);
            addEdge(state, a, c); addEdge(state, b, d);
            faces.push(addFace(state, [a, b, d, c], null, true, desired));
          }
        } else {
          for (var i = 0; i < count; i++) {
            var j = (i + 1) % count;
            var a = baseIndices[i], b = baseIndices[j], c = topIndices[i], d = topIndices[j];
            addEdge(state, a, b); addEdge(state, c, d);
            addEdge(state, a, c); addEdge(state, b, d); addEdge(state, a, d);
            var next = baseParams[j];
            var delta = j === 0 ? wrapParam(baseParams[0] + TAU - baseParams[i]) :
              wrapParam(next - baseParams[i]);
            var desired = midSurfaceOutward(band, baseParams[i] + 0.5*delta) ||
              (band.family ? sideNormal(baseParams[i] + 0.5*delta) : null);
            faces.push(addFace(state, [a, b, d], null, true, desired));
            faces.push(addFace(state, [a, d, c], null, true, desired));
          }
        }
        var generatorIds = [];
        band.sourcePairs.forEach(function (entry) {
          entry.observation.ids.forEach(function (id) {
            if (generatorIds.indexOf(id) === -1) generatorIds.push(id);
          });
        });
        var capBaseIds = (c1.sourceIds || []).slice(), capTopIds = (c2.sourceIds || []).slice();
        var sourceIds = Array.from(new Set(capBaseIds.concat(capTopIds, generatorIds,
          band.legacy ? band.legacy.evidence.ids : [])));
        var views = band.evidence.observations.map(function (observation) { return observation.role; })
          .filter(function (role, index, all) { return all.indexOf(role) === index; });
        var patch;
        if (band.legacy) {
          var legacyGeneratorIds = Array.from(new Set(
            band.legacy.evidence.ids.concat(generatorIds)));
          patch = {kind:'implicit', analyticKind:'ruledConic',
            boundaryCurves:[band.ci1, band.ci2], faceIndices:faces, sourceIds:sourceIds,
            implicit:implicitRecord(band.legacy.family.q, sourceIds),
            generator:{C:band.legacy.family.c1.C, A:band.legacy.family.c1.A,
              B:band.legacy.family.c1.B, D:band.legacy.family.c2.C, k:band.legacy.family.k,
              n:band.legacy.family.q.n, h:band.legacy.family.q.h},
            origin:k1.C, inferred:true,
            inference:{family:'homothetic-conic-sweep', endpoint:'ring', status:'inferred',
              scale:band.legacy.family.k, views:views,
              generatorSourceIds:legacyGeneratorIds}};
          if (!legacyMode) patch.displayTessellation = {kind:'union-ring-triangulation',
            samples:count, nonplanar:'triangulated', smooth:true};
        } else {
          if (band.family.equation.identity) band.family.equation.identity.sourceIds = sourceIds.slice();
          if (band.family.equation.sourceEvidence) band.family.equation.sourceEvidence.sourceIds = sourceIds.slice();
          patch = {kind:'implicit', analyticKind:'ruledConic',
            boundaryCurves:[band.ci1, band.ci2], faceIndices:faces, sourceIds:sourceIds,
            implicit:band.family.equation,
            generator:{C:k1.C, A:k1.A, B:k1.B, D:k2.C, A2:band.family.A2, B2:band.family.B2,
              n:band.family.geometry.N, h:band.family.geometry.h,
              correspondence:{s:band.evidence.correspondence.s, phi:band.evidence.correspondence.phi}},
            origin:k1.C, inferred:true,
            inference:{family:'general-affine-ruled-conic', endpoint:'ring', status:'inferred',
              correspondence:{s:band.evidence.correspondence.s, phi:band.evidence.correspondence.phi},
              views:views, generatorSourceIds:generatorIds.slice()},
            displayTessellation:{kind:'union-ring-triangulation', samples:count,
              nonplanar:'triangulated', smooth:true}};
        }
        entries.push({band:band, patch:patch, baseIndices:baseIndices,
          topIndices:topIndices, baseParams:baseParams, normal:normal,
          baseCapNormal:mul(normal, -1), topCapNormal:normal, legacyMode:legacyMode});
      });
      if (mappingFailure || !entries.length) return;
      var incidence = Object.create(null);
      entries.forEach(function (entry) {
        incidence[entry.band.ci1] = (incidence[entry.band.ci1] || 0) + 1;
        incidence[entry.band.ci2] = (incidence[entry.band.ci2] || 0) + 1;
      });
      var capEntries = [];
      entries.forEach(function (entry) {
        [[entry.band.ci1, entry.baseCapNormal], [entry.band.ci2, entry.topCapNormal]]
          .forEach(function (side) {
            var ci = side[0], desired = side[1];
            if ((incidence[ci] || 0) !== 1) return;
            if (capEntries.some(function (cap) { return cap.ci === ci; })) return;
            var curve = curves[ci];
            var cap = addFace(state, curve.displayVertices.slice(), null, false, desired);
            capEntries.push({ci:ci, face:cap, patch:{kind:'plane', boundaryCurves:[ci],
              loops:[{kind:'outer', curves:[ci]}], origin:curve.center,
              normal:desired, u:curve.u, v:curve.v,
              faceIndices:[cap], sourceIds:(curve.sourceIds || []).slice()}});
          });
      });
      capEntries.sort(function (a, b) { return a.ci - b.ci; });
      var allLegacy = entries.every(function (entry) { return entry.legacyMode; });
      var pushedCaps = new Set();
      function pushEntryCaps(entry) {
        [entry.band.ci1, entry.band.ci2].forEach(function (ci) {
          capEntries.forEach(function (cap) {
            if (cap.ci === ci && !pushedCaps.has(ci)) {
              geometry.surfacePatches.push(cap.patch);
              pushedCaps.add(ci);
            }
          });
        });
      }
      if (allLegacy) {
        entries.forEach(function (entry) {
          geometry.surfacePatches.push(entry.patch);
          pushEntryCaps(entry);
        });
        capEntries.forEach(function (cap) {
          if (!pushedCaps.has(cap.ci)) {
            geometry.surfacePatches.push(cap.patch);
            pushedCaps.add(cap.ci);
          }
        });
      } else {
        capEntries.forEach(function (entry) { geometry.surfacePatches.push(entry.patch); });
        entries.forEach(function (entry) { geometry.surfacePatches.push(entry.patch); });
      }
      entries.forEach(function (entry) {
        if (!entry.legacyMode) {
          entry.patch.inference.generators = [];
          entry.band.sourcePairs.forEach(function (sourcePair) {
            var index = stationParamIndex(entry.baseParams, sourcePair.pair.u1);
            if (index < 0) {
              for (var ai = 0; ai < entry.baseParams.length; ai++) {
                if (angleDistance(entry.baseParams[ai], sourcePair.pair.u1) <= entry.band.angleTol) {
                  index = ai;
                  break;
                }
              }
            }
            if (index < 0) return;
            var record = addGeneralGenerator(entry.patch, geometry, sourcePair.observation,
              sourcePair.pair, index, state, entry.band.c1, entry.band.c2,
              entry.topIndices[index]);
            if (record) entry.patch.inference.generators.push({u:record.u,
              sourceIds:record.sourceIds.slice(), views:record.views.slice(),
              edgeIndex:record.edgeIndex});
          });
          if (!entry.patch.inference.generators.length) delete entry.patch.inference.generators;
        }
        result.patches.push({curves:[entry.band.ci1, entry.band.ci2],
          correspondence:entry.band.evidence.correspondence,
          views:entry.patch.inference.views.slice(),
          samples:entry.legacyMode ? entry.band.legacy.count :
            entry.patch.displayTessellation.samples});
        entry.band.sourcePairs.forEach(function (sourcePair) {
          sourcePair.observation.ids.forEach(function (id) { result.consumedIds.push(id); });
        });
        if (entry.band.legacy)
          entry.band.legacy.evidence.ids.forEach(function (id) { result.consumedIds.push(id); });
        (entry.band.c1.sourceIds || []).concat(entry.band.c2.sourceIds || [])
          .forEach(function (id) { result.resolvedIds.push(id); });
        claimed.add(entry.band.ci1); claimed.add(entry.band.ci2);
      });
      emitted = true;
    });
    if (!emitted) {
      relationFailure.forEach(function (index) { if (!claimed.has(index) && blocked) blocked.add(index); });
      return false;
    }
    pruneStaleEdges(geometry, state, staleEdges);
    relationFailure.forEach(function (index) { if (!claimed.has(index) && blocked) blocked.add(index); });
    return true;
  }

  function inferRings(geometry, entities, profile, state, result, claimed, blocked) {
    var pads = geometry.surfacePatches;
    pads.forEach(function (patch) {
      if (!patch || ['cone','cylinder','ruled'].indexOf(patch.kind) === -1) return;
      var bcs = (patch.boundaryCurves || []).filter(function (i) { return !!geometry.curves[i]; });
      if (bcs.length < 2) return;
      var c1 = geometry.curves[bcs[0]], c2 = geometry.curves[bcs[1]];
      if (!full(c1) || !full(c2)) return;
      var nativeLimit = 1e-5 * Math.max(1, conic(c1).scale, conic(c2).scale);
      if (legacyResidual(patch, [c1,c2]) <= nativeLimit) {
        var nativeEvidence = nativeGeneratorEvidence(patch, c1, c2, entities, profile,
          analyticTolerance(Math.max(conic(c1).scale, conic(c2).scale)), geometry.curves);
        if (nativeEvidence.valid) {
          bcs.forEach(function (i) { claimed.add(i); });
          return;
        }
        if (nativeEvidence.conflict) {
          if (blocked) { blocked.add(bcs[0]); blocked.add(bcs[1]); }
          ringIssue(result, 'surface-ruled-generator-conflict',
            'A drawn generator that touches both boundaries does not belong to the supported native ruled surface; the side patch is unresolved rather than certified.',
            (c1.sourceIds || [])[0], {generatorId:nativeEvidence.conflictIds[0] || null});
          return;
        }
      }
      var family = ringFamily(c1, c2);
      function generalFallback(quiet) {
        if (claimed.has(bcs[0]) || claimed.has(bcs[1])) return false;
        return tryGeneralRing(geometry, entities, profile, state, result, claimed,
          blocked, bcs[0], bcs[1], c1, c2, quiet ? {quiet:true} : null);
      }
      if (!family) { generalFallback(); return; }
      if (curveResidual(family.q, c1, 24) > family.tol ||
          curveResidual(family.q, c2, 24) > family.tol) { generalFallback(); return; }
      var evidence = ringGenerators(geometry, c1, c2, family.k, entities, profile, patch, geometry.curves);
      if (!evidence.valid) {
        if (evidence.conflict) {
          var legacyIssueStart = result.issues.length;
          if (!generalFallback(true)) {
            if (blocked) { blocked.add(bcs[0]); blocked.add(bcs[1]); }
            var legacyPrecise = result.issues.slice(legacyIssueStart).some(function (issue) {
              return issue.code === 'surface-ruled-singular-station' ||
                issue.code === 'surface-ruled-family-unsupported';
            });
            if (!legacyPrecise)
              ringIssue(result, 'surface-ruled-generator-conflict',
                'A drawn generator that touches both boundaries does not belong to the supported optimized ruled surface; the side patch is unresolved rather than certified.',
                (c1.sourceIds || [])[0], {generatorId:evidence.conflictIds[0] || null});
          }
        } else generalFallback();
        return;
      }
      asImplicitPatch(patch, family, evidence, {C:family.c1.C, A:family.c1.A,
        B:family.c1.B, D:family.c2.C, k:family.k, n:family.q.n, h:family.q.h});
      patch.sourceIds = Array.from(new Set((patch.sourceIds || []).concat(evidence.ids)));
      bcs.forEach(function (i) { claimed.add(i); });
      evidence.ids.forEach(function (id) { result.consumedIds.push(id); });
      (c1.sourceIds || []).concat(c2.sourceIds || []).forEach(function (id) { result.resolvedIds.push(id); });
      result.patches.push({curves:bcs.slice(), scale:family.k, views:evidence.views.slice()});
    });
    inferGeneralGraph(geometry, entities, profile, state, result, claimed, blocked);
  }

  function infer(geometry, entities, profile, options) {
    options = options || {};
    var result = {consumedIds:[], issues:[], patches:[], resolvedIds:[]};
    if (!geometry || !geometry.curves || !geometry.curves.length) return result;
    var state = makeState(geometry), claimed = new Set(), claimedVertices = new Set();
    var blocked = new Set();
    try {
      inferRings(geometry, entities, profile, state, result, claimed, blocked);
      geometry.curves.forEach(function (c, ci) {
        if (claimed.has(ci) || blocked.has(ci) || !full(c)) return;
        if (geometry.surfacePatches.some(function (p) { return p.kind !== 'plane' &&
          (p.boundaryCurves || []).indexOf(ci) !== -1; })) return;
        if (inferApex(geometry, ci, c, entities, profile, state, result, claimedVertices)) {
          claimed.add(ci);
          (c.sourceIds || []).forEach(function (id) { result.resolvedIds.push(id); });
        }
      });
    } catch (err) {
      result.issues.push({code:'surface-inference-failed',
        message:'General surface inference failed: ' + (err && err.message || err)});
    }
    result.consumedIds = Array.from(new Set(result.consumedIds));
    result.resolvedIds = Array.from(new Set(result.resolvedIds.concat(result.consumedIds)));
    return result;
  }

  return {infer:infer};
});

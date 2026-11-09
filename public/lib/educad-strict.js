(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADStrict = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Exact reconstruction of declared incidence, never recognition of drawn ink.
  // See docs/RECONSTRUCTION_CONTRACT.md for domain, proof and numeric semantics.
  function gcd(a, b) { a = a < 0n ? -a : a; while (b) { var r = a % b; a = b; b = r; } return a || 1n; }
  function rational(n, d) {
    if (!d) throw new Error('Zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    var g = gcd(n, d); return { n: n / g, d: d / g };
  }
  function exact(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Coordinates must be finite numbers');
    var match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
    var fraction = match[3] || '', exponent = Number(match[4] || 0) - fraction.length;
    var n = BigInt(match[2] + fraction) * (match[1] ? -1n : 1n);
    return exponent >= 0 ? rational(n * 10n ** BigInt(exponent), 1n) : rational(n, 10n ** BigInt(-exponent));
  }
  function add(a, b) { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
  function neg(a) { return { n: -a.n, d: a.d }; }
  function sub(a, b) { return add(a, neg(b)); }
  function mul(a, b) { return rational(a.n * b.n, a.d * b.d); }
  function equal(a, b) { return a.n === b.n && a.d === b.d; }
  function serial(a) { return a.n.toString() + '/' + a.d.toString(); }
  // Rendering is approximate. Scientific conversion avoids Infinity/Infinity for
  // valid rationals with large denominators; the exact certificate stays intact.
  function numeric(a) {
    if (!a.n) return 0;
    var sign = a.n < 0n ? -1 : 1, n = (a.n < 0n ? -a.n : a.n).toString(), d = a.d.toString();
    var nn = n.slice(0, 16), dd = d.slice(0, 16);
    var mantissa = sign * (Number(nn) / Math.pow(10, nn.length - 1)) / (Number(dd) / Math.pow(10, dd.length - 1));
    return Number(String(mantissa) + 'e' + (n.length - d.length));
  }
  function stationMembers(e) { return e && e.meta && Array.isArray(e.meta.members) ? e.meta.members.filter(function (m) { return m && typeof m.id === 'string' && m.id; }) : []; }
  function div(a, b) { return rational(a.n * b.d, a.d * b.n); }
  function cmp(a, b) { var n = a.n * b.d - b.n * a.d; return n < 0n ? -1 : n > 0n ? 1 : 0; }
  function vector(a, b) { return a.map(function (v, i) { return sub(v, b[i]); }); }
  function dot(a, b) { return a.reduce(function (sum, v, i) { return add(sum, mul(v, b[i])); }, rational(0n, 1n)); }
  function cross(a, b) { return [sub(mul(a[1], b[2]), mul(a[2], b[1])), sub(mul(a[2], b[0]), mul(a[0], b[2])), sub(mul(a[0], b[1]), mul(a[1], b[0]))]; }
  function samePoint(a, b) { return a.every(function (v, i) { return equal(v, b[i]); }); }
  function interpolate(a, b, t) { return a.map(function (v, i) { return add(v, mul(sub(b[i], v), t)); }); }
  function normal(triangle) { return cross(vector(triangle[1], triangle[0]), vector(triangle[2], triangle[0])); }
  function insideTriangle(point, triangle, n) {
    return triangle.every(function (a, i) { return dot(n, cross(vector(triangle[(i + 1) % 3], a), vector(point, a))).n >= 0n; });
  }
  // Intersect a segment with a closed triangle exactly. Coplanar segments
  // are clipped against its three linear half-space inequalities in t.
  function segmentTriangle(a, b, triangle, n) {
    var da = dot(n, vector(a, triangle[0])), db = dot(n, vector(b, triangle[0]));
    if (da.n === 0n && db.n === 0n) {
      var lo = rational(0n, 1n), hi = rational(1n, 1n);
      for (var i = 0; i < 3; i++) {
        var v = triangle[i], edge = vector(triangle[(i + 1) % 3], v);
        var ga = dot(n, cross(edge, vector(a, v))), gb = dot(n, cross(edge, vector(b, v)));
        if (ga.n < 0n && gb.n < 0n) return [];
        if (ga.n < 0n) { var lower = div(neg(ga), sub(gb, ga)); if (cmp(lower, lo) > 0) lo = lower; }
        if (gb.n < 0n) { var upper = div(ga, sub(ga, gb)); if (cmp(upper, hi) < 0) hi = upper; }
        if (cmp(lo, hi) > 0) return [];
      }
      return [interpolate(a, b, lo), interpolate(a, b, hi)];
    }
    if (da.n > 0n && db.n > 0n || da.n < 0n && db.n < 0n) return [];
    var point = interpolate(a, b, div(da, sub(da, db)));
    return insideTriangle(point, triangle, n) ? [point] : [];
  }
  function improperIntersection(a, b, positions) {
    var ta = a.map(function (i) { return positions[i]; }), tb = b.map(function (i) { return positions[i]; });
    // Exact boxes only reject provably disjoint triangles.
    for (var axis = 0; axis < 3; axis++) {
      var aa = ta.map(function (p) { return p[axis]; }).sort(cmp), bb = tb.map(function (p) { return p[axis]; }).sort(cmp);
      if (cmp(aa[2], bb[0]) < 0 || cmp(bb[2], aa[0]) < 0) return false;
    }
    var common = a.filter(function (id) { return b.indexOf(id) !== -1; });
    function allowed(point) {
      if (!common.length) return false;
      var start = positions[common[0]];
      if (common.length === 1) return samePoint(point, start);
      var end = positions[common[1]], side = cross(vector(point, start), vector(end, start));
      return side.every(function (v) { return v.n === 0n; }) && dot(vector(point, start), vector(point, end)).n <= 0n;
    }
    var na = normal(ta), nb = normal(tb);
    for (var i = 0; i < 3; i++) {
      var contacts = segmentTriangle(ta[i], ta[(i + 1) % 3], tb, nb).concat(segmentTriangle(tb[i], tb[(i + 1) % 3], ta, na));
      if (contacts.some(function (p) { return !allowed(p); })) return true;
    }
    return false;
  }
  function classifySurfaces(faces, positions, issue) {
    var edgeMap = new Map(), vertexLinks = new Map(), adjacent = faces.map(function () { return []; });
    var solids = [], open = [], valid = true;
    function invalid(code, message) { valid = false; issue('inconsistent', code, message); }
    faces.forEach(function (face, fi) {
      face.forEach(function (a, i) {
        var b = face[(i + 1) % 3], key = Math.min(a, b) + ':' + Math.max(a, b);
        if (!edgeMap.has(key)) edgeMap.set(key, []);
        edgeMap.get(key).push({ face: fi, dir: a < b ? 1 : -1 });
        if (!vertexLinks.has(a)) vertexLinks.set(a, new Map());
        var link = vertexLinks.get(a), c = face[(i + 2) % 3];
        if (!link.has(b)) link.set(b, new Set());
        if (!link.has(c)) link.set(c, new Set());
        link.get(b).add(c); link.get(c).add(b);
      });
    });
    edgeMap.forEach(function (uses) {
      if (uses.length > 2) { invalid('surface-nonmanifold-edge', 'A surface edge belongs to more than two triangles.'); return; }
      if (uses.length === 2) {
        var a = uses[0], b = uses[1], relation = -a.dir * b.dir;
        adjacent[a.face].push({ face: b.face, relation: relation });
        adjacent[b.face].push({ face: a.face, relation: relation });
      }
    });
    vertexLinks.forEach(function (link) {
      var ends = 0, degreeBad = false;
      link.forEach(function (neighbors) { if (neighbors.size === 1) ends++; else if (neighbors.size !== 2) degreeBad = true; });
      var reached = new Set(), queue = [link.keys().next().value];
      while (queue.length) { var v = queue.pop(); if (reached.has(v)) continue; reached.add(v); link.get(v).forEach(function (n) { if (!reached.has(n)) queue.push(n); }); }
      if (degreeBad || ends !== 0 && ends !== 2 || reached.size !== link.size) invalid('surface-nonmanifold-vertex', 'Triangles at a surface vertex must form one disk or half-disk, not touching separate shells.');
    });
    // Triangle intersection is allowed only at its declared shared simplex.
    // This also catches coincident positions carrying different vertex IDs.
    for (var i = 0; i < faces.length; i++) {
      for (var j = i + 1; j < faces.length; j++) {
        if (improperIntersection(faces[i], faces[j], positions)) invalid('surface-self-intersection', 'Triangles ' + i + ' and ' + j + ' intersect outside their declared shared edge or vertex.');
      }
    }
    var orientation = new Map();
    faces.forEach(function (_, start) {
      if (orientation.has(start)) return;
      var component = [], queue = [start]; orientation.set(start, 1);
      while (queue.length) {
        var fi = queue.pop(); component.push(fi);
        adjacent[fi].forEach(function (next) {
          var wanted = orientation.get(fi) * next.relation;
          if (orientation.has(next.face)) { if (orientation.get(next.face) !== wanted) invalid('surface-nonorientable', 'Surface triangles cannot be oriented consistently.'); }
          else { orientation.set(next.face, wanted); queue.push(next.face); }
        });
      }
      component.sort(function (a, b) { return a - b; });
      var componentSet = new Set(component), boundary = [];
      edgeMap.forEach(function (uses, key) { if (uses.length === 1 && componentSet.has(uses[0].face)) boundary.push(key.split(':').map(Number)); });
      if (boundary.length) { open.push({ faceIndices: component, boundaryEdges: boundary }); return; }
      // Sum oriented tetrahedral volumes about a vertex. The divergence theorem
      // gives the bounded interior volume of a closed embedded surface.
      var origin = positions[faces[start][0]], sixVolume = rational(0n, 1n);
      component.forEach(function (fi) {
        var p = faces[fi].map(function (id) { return vector(positions[id], origin); });
        var term = dot(p[0], cross(p[1], p[2]));
        sixVolume = add(sixVolume, orientation.get(fi) === 1 ? term : neg(term));
      });
      if (!sixVolume.n) { invalid('solid-zero-volume', 'A closed surface must enclose nonzero volume.'); return; }
      if (sixVolume.n < 0n) { sixVolume = neg(sixVolume); component.forEach(function (fi) { orientation.set(fi, -orientation.get(fi)); }); }
      component.forEach(function (fi) { if (orientation.get(fi) === -1) faces[fi] = [faces[fi][0], faces[fi][2], faces[fi][1]]; });
      var volume = div(sixVolume, rational(6n, 1n)), approximate = numeric(volume);
      solids.push({ faceIndices: component, volumeMm3Exact: serial(volume), volumeMm3: Number.isFinite(approximate) && approximate > 0 ? approximate : null });
    });
    return { solids: valid ? solids : [], openSurfaces: open };
  }
  function helper(e) { return e.meta && e.meta.reconstructionRole === 'construction'; }
  function reconstruct(entities, options) {
    options = options || {};
    var issues = [], points = new Map(), members = new Map(), seen = new Set();
    var vertices = [], vertexIds = [], exactVertices = [], index = new Map(), edges = [], faces = [], edgeKeys = new Set();
    function issue(state, code, message, entityId, memberId) {
      issues.push({ state: state, code: code, message: message, entityId: entityId || null, memberId: memberId || null });
    }
    function inconsistent(code, message, e, id) { issue('inconsistent', code, message, e && e.id, id); }
    function missing(code, message, e, id) { issue('underdetermined', code, message, e && e.id, id); }
    function assign(member, axis, value, e) {
      if (member[axis] && !equal(member[axis].value, value)) {
        inconsistent('coordinate-conflict', 'Member ' + member.id + ' has conflicting ' + axis + ' coordinates at ' + member[axis].entityId + ' and ' + e.id + '.', e, member.id);
      } else if (!member[axis]) member[axis] = { value: value, entityId: e.id };
    }
    if (!Array.isArray(entities)) { inconsistent('invalid-input', 'Expected an array of drawing entities.'); entities = []; }
    var frames = entities.filter(function (e) { return e && e.meta && e.meta.draftingLayout; }).map(function (e) { return e.meta.draftingLayout; });
    if (options.profile) frames.push(options.profile);
    var profile = frames[0], profileExact = null;
    if (frames.some(function (f) { return f.xRef !== profile.xRef || f.dRef !== profile.dRef || f.s !== profile.s; })) inconsistent('profile-frame-conflict', 'Declared side-view frames disagree.');
    var declarations = entities.filter(function (e) { return e && e.meta && e.meta.reconstructionTopology; }).map(function (e) { return e.meta.reconstructionTopology; });
    if (options.topology) declarations.push(options.topology);
    if (declarations.length > 1) inconsistent('topology-duplicate', 'Declare topology once, on one drawing record or through the reconstruction API.');
    if (profile) {
      try {
        if (profile.s !== 1 && profile.s !== -1) throw new Error('Profile direction must be +1 or -1');
        profileExact = { xRef: exact(profile.xRef), dRef: exact(profile.dRef), s: exact(profile.s) };
      } catch (error) { inconsistent('profile-frame-invalid', error.message); }
    }
    if (!Array.isArray(entities)) { inconsistent('invalid-input', 'Expected an array of drawing entities.'); entities = []; }
    entities.forEach(function (e) {
      if (!e || typeof e.id !== 'string' || !e.id || seen.has(e.id)) {
        inconsistent('entity-id-invalid', 'Every entity needs a unique stable ID.', e); return;
      }
      seen.add(e.id);
      if (helper(e) || e.type !== 'POINT') return;
      points.set(e.id, e);
      var list = e.meta && e.meta.members;
      if (!Array.isArray(list) || !list.length) { missing('members-missing', 'Point ' + e.id + ' needs an explicit spatial member identity.', e); return; }
      var local = new Set(), x, y;
      try { x = exact(e.x); y = exact(e.y); }
      catch (error) { inconsistent('coordinate-invalid', error.message, e); return; }
      list.forEach(function (m) {
        if (!m || typeof m.id !== 'string' || !m.id || local.has(m.id)) { inconsistent('member-id-invalid', 'Station members need distinct nonempty IDs.', e); return; }
        local.add(m.id);
        var member = members.get(m.id);
        if (!member) { member = { id: m.id, observations: [] }; members.set(m.id, member); }
        member.observations.push(e.id);
        if (e.viewRole === 'ELEVATION') { assign(member, 'x', x, e); assign(member, 'height', y, e); }
        else if (e.viewRole === 'PLAN') { assign(member, 'x', x, e); assign(member, 'depth', neg(y), e); }
        else if (e.viewRole === 'PROFILE') {
          assign(member, 'height', y, e);
          if (!profileExact) missing('profile-frame-missing', 'Side projections need an explicitly declared profile frame.', e, m.id);
          else assign(member, 'depth', add(profileExact.dRef, mul(profileExact.s, sub(x, profileExact.xRef))), e);
        } else missing('view-missing', 'Point ' + e.id + ' needs an explicit front, top or side view; its position does not determine the view.', e, m.id);
      });
    });
    Array.from(members.keys()).sort().forEach(function (id) {
      var member = members.get(id), absent = ['x', 'height', 'depth'].filter(function (axis) { return !member[axis]; });
      if (absent.length) { missing('coordinates-missing', 'Member ' + id + ' needs ' + absent.join(', ') + ' from another projection.', null, id); return; }
      var coords = [member.x.value, member.height.value, member.depth.value];
      var values = coords.map(numeric);
      if (values.some(function (v) { return !Number.isFinite(v); })) { issue('unsupported', 'render-range', 'Reconstructed coordinates exceed the renderer range.', null, id); return; }
      index.set(id, vertices.length); vertexIds.push(id);
      vertices.push({ x: values[0], y: values[1], z: values[2] });
      exactVertices.push({ id: id, x: serial(coords[0]), height: serial(coords[1]), depth: serial(coords[2]), observations: member.observations.slice().sort() });
    });
    function addEdge(a, b) {
      var key = JSON.stringify([a, b].sort());
      if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push([index.get(a), index.get(b)]); }
    }
    entities.forEach(function (e) {
      if (!e || helper(e) || ['POINT', 'TEXT', 'DIMENSION', 'DATUM_AXIS'].indexOf(e.type) !== -1) return;
      var meta = e.meta || {};
      // Projector ink is an annotation of a relationship already declared by
      // shared member IDs. It cannot create or merge spatial identities.
      if (e.type === 'SEGMENT' && meta.kind === 'projector' && meta.endpointMemberIds === undefined) {
        var feet = Array.isArray(meta.refs) && meta.refs.map(function (id) { return points.get(id); });
        if (!feet || feet.length !== 2 || !feet[0] || !feet[1]) missing('projector-feet-missing', 'Projector ' + e.id + ' needs two explicit stations.', e);
        else {
          var a = stationMembers(feet[0]), b = stationMembers(feet[1]);
          if (!a.some(function (m) { return b.some(function (n) { return m.id === n.id; }); })) inconsistent('projector-unlinked', 'Projector ' + e.id + ' connects stations with no shared spatial identity.', e);
        }
        return;
      }
      if (e.type !== 'SEGMENT') { issue('unsupported', 'geometry-unsupported', 'Strict reconstruction does not define ' + e.type + ' geometry yet. Mark helper ink as construction explicitly.', e.id); return; }
      var refs = meta.endpointRefs || meta.refs, ids = meta.endpointMemberIds;
      if (!Array.isArray(refs) || refs.length !== 2 || !Array.isArray(ids) || ids.length !== 2 || ids.some(function (id) { return typeof id !== 'string' || !id; })) {
        missing('edge-endpoints-missing', 'Line ' + e.id + ' needs an explicit station and member at each endpoint.', e); return;
      }
      var endpoints = refs.map(function (id) { return points.get(id); }), valid = true;
      endpoints.forEach(function (p, i) {
        if (!p || !stationMembers(p).some(function (m) { return m.id === ids[i]; })) { inconsistent('endpoint-stale', 'Line ' + e.id + ' endpoint ' + (i + 1) + ' no longer belongs to its chosen station.', e, ids[i]); valid = false; return; }
        try {
          if (!equal(exact(i ? e.x2 : e.x), exact(p.x)) || !equal(exact(i ? e.y2 : e.y), exact(p.y))) { inconsistent('endpoint-position-conflict', 'Line ' + e.id + ' no longer ends at its declared station.', e, ids[i]); valid = false; }
        } catch (error) { inconsistent('coordinate-invalid', error.message, e); valid = false; }
      });
      if (!valid) return;
      if (endpoints[0].viewRole !== endpoints[1].viewRole) {
        if (ids[0] !== ids[1]) inconsistent('cross-view-edge', 'A cross-view projector must identify the same spatial member at both ends.', e);
        return;
      }
      if (e.viewRole && e.viewRole !== 'BOTH' && e.viewRole !== endpoints[0].viewRole) { inconsistent('edge-view-conflict', 'Line ' + e.id + ' is assigned to a different view from its endpoints.', e); return; }
      if (ids[0] === ids[1]) { inconsistent('edge-loop', 'A straight edge needs two different vertex identities.', e); return; }
      if (index.has(ids[0]) && index.has(ids[1])) {
        var a = members.get(ids[0]), b = members.get(ids[1]);
        if (['x', 'height', 'depth'].every(function (axis) { return equal(a[axis].value, b[axis].value); })) inconsistent('edge-degenerate', 'Distinct identities define a zero-length spatial edge.', e);
        else addEdge(ids[0], ids[1]);
      }
    });
    var topology = declarations[0] || {};
    if (typeof topology !== 'object' || Array.isArray(topology)) { inconsistent('topology-invalid', 'Topology must be an object of explicit declarations.'); topology = {}; }
    Object.keys(topology).forEach(function (key) {
      if (['triangles', 'solid', 'solids'].indexOf(key) === -1) issue('unsupported', 'topology-unsupported', 'Unsupported topology declaration: ' + key + '.');
    });
    var triangles = topology.triangles === undefined ? [] : topology.triangles, triangleKeys = new Set();
    if (!Array.isArray(triangles)) { inconsistent('triangles-invalid', 'Declared triangles must be an array.'); triangles = []; }
    triangles.forEach(function (triangle) {
      if (!Array.isArray(triangle) || triangle.length !== 3 || new Set(triangle).size !== 3 || triangle.some(function (id) { return typeof id !== 'string'; })) { inconsistent('triangle-invalid', 'Each triangle needs three distinct member IDs.'); return; }
      if (triangle.some(function (id) { return !index.has(id); })) { missing('triangle-vertices-missing', 'A declared triangle has unresolved vertices.'); return; }
      var key = JSON.stringify(triangle.slice().sort());
      if (triangleKeys.has(key)) { inconsistent('triangle-duplicate', 'A triangle has been declared more than once.'); return; }
      triangleKeys.add(key);
      var p = triangle.map(function (id) { var m = members.get(id); return [m.x.value, m.height.value, m.depth.value]; });
      var u = p[1].map(function (v, i) { return sub(v, p[0][i]); }), v = p[2].map(function (v, i) { return sub(v, p[0][i]); });
      var cross = [sub(mul(u[1], v[2]), mul(u[2], v[1])), sub(mul(u[2], v[0]), mul(u[0], v[2])), sub(mul(u[0], v[1]), mul(u[1], v[0]))];
      if (cross.every(function (c) { return c.n === 0n; })) { inconsistent('triangle-degenerate', 'A triangle has collinear vertices.'); return; }
      faces.push(triangle.map(function (id) { return index.get(id); }));
      addEdge(triangle[0], triangle[1]); addEdge(triangle[1], triangle[2]); addEdge(triangle[2], triangle[0]);
    });
    var positions = vertexIds.map(function (id) { var m = members.get(id); return [m.x.value, m.height.value, m.depth.value]; });
    var surfaces = classifySurfaces(faces, positions, issue);
    if (topology.solid !== undefined && typeof topology.solid !== 'boolean') inconsistent('solid-request-invalid', 'The solid requirement must be true or false.');
    if (topology.solid === true && (!faces.length || surfaces.openSurfaces.length)) missing('surface-open', 'A solid needs a closed surface; some boundary faces are missing.');
    if (topology.solids !== undefined) issue('unsupported', 'solid-grouping-unsupported', 'Solid grouping and cavity subtraction are not declared by triangle closure. Each closed shell is one solid.');
    if (!members.size) missing('empty-model', 'No explicitly identified spatial vertices have been declared.');
    var state = ['inconsistent', 'unsupported', 'underdetermined'].find(function (s) { return issues.some(function (i) { return i.state === s; }); }) || 'determined';
    var first = issues.find(function (i) { return i.state === state; });
    return {
      status: state === 'determined' ? 'ok' : 'unavailable', determination: state,
      reason: first ? first.code : null, label: first ? first.message : '', issues: issues,
      geometry: state === 'determined' ? { name: surfaces.solids.length ? 'explicit solid' : faces.length ? 'declared triangular surface' : 'explicit wireframe', vertices: vertices, edges: edges, faces: faces, vertexIds: vertexIds, solids: surfaces.solids, openSurfaces: surfaces.openSurfaces } : null,
      certificate: state === 'determined' ? { contract: 'educad-explicit-v1', arithmetic: 'exact-decimal-rational', vertices: exactVertices, edgeMembers: edges.map(function (edge) { return edge.map(function (i) { return vertexIds[i]; }); }), triangles: faces.map(function (face) { return face.map(function (i) { return vertexIds[i]; }); }), solids: surfaces.solids.map(function (solid) { return { volumeMm3Exact: solid.volumeMm3Exact, boundary: solid.faceIndices.map(function (fi) { return faces[fi].map(function (i) { return vertexIds[i]; }); }) }; }) } : null,
      stats: { seen: points.size, paired: vertices.length, edges: edges.length, solids: surfaces.solids.length }
    };
  }
  return { reconstruct: reconstruct, classifySurfaces: classifySurfaces, exact: exact,
    CONTRACT: 'educad-explicit-v1' };
});

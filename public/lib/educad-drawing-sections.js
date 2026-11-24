(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-surfaces.js'));
  else root.EduCADDrawingSections = factory(root.EduCADSurfaces);
})(typeof window !== 'undefined' ? window : globalThis, function (Surfaces) {
  'use strict';

  var VERSION = '1.0.0-educad';
  var CUTTING = 'cutting-plane-evidence-v1';
  var BOUNDARY = 'section-boundary-evidence-v1';
  var MODEL = 'drawing-sections-v1';
  var QUERY = 'section-boundary-v1';
  var RETAIN = 'section-split-v1';
  var EPS = 1e-6;
  var TAU = 2 * Math.PI;

  function finite(p) {
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
  }
  function add(a, b) { return {x:a.x+b.x, y:a.y+b.y, z:a.z+b.z}; }
  function sub(a, b) { return {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}; }
  function mul(a, s) { return {x:a.x*s, y:a.y*s, z:a.z*s}; }
  function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
  function cross(a, b) {
    return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x};
  }
  function length(v) { return Math.hypot(v.x, v.y, v.z); }
  function unit(v) {
    var l = length(v);
    return l > EPS ? mul(v, 1/l) : null;
  }
  function copyPoint(p) { return finite(p) ? {x:p.x, y:p.y, z:p.z} : null; }
  function distance(a, b) { return length(sub(a, b)); }
  function pointDistance2(a, b) {
    var dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z;
    return dx*dx+dy*dy+dz*dz;
  }
  function pointSegmentDistance(p, a, b) {
    var ab = sub(b, a), l2 = dot(ab, ab);
    if (l2 <= EPS*EPS) return distance(p, a);
    var t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
    return distance(p, add(a, mul(ab, t)));
  }

  function viewDirection(view) {
    if (view === 'PLAN') return {x:0, y:1, z:0};
    if (view === 'ELEVATION') return {x:0, y:0, z:1};
    if (view === 'PROFILE') return {x:1, y:0, z:0};
    return null;
  }
  function viewRoleForNormal(normal) {
    var ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z);
    var m = Math.max(ax, ay, az);
    if (m < 1 - 1e-6) return null;
    if (m === ax) return 'PROFILE';
    if (m === ay) return 'PLAN';
    return 'ELEVATION';
  }
  function worldPointForView(x, y, view, profile) {
    if (view === 'PLAN') return {x:x, y:0, z:-y};
    if (view === 'ELEVATION') return {x:x, y:y, z:0};
    if (view === 'PROFILE') {
      if (!profile || !Number.isFinite(profile.xRef) || !Number.isFinite(profile.dRef) ||
          (profile.s !== 1 && profile.s !== -1)) return null;
      return {x:0, y:y, z:profile.dRef + profile.s * (x - profile.xRef)};
    }
    return null;
  }
  function pointOnPlane(p, plane) {
    return Math.abs(dot(plane.normal, sub(p, plane.origin)));
  }
  function projectToPlane(p, plane) {
    return sub(p, mul(plane.normal, dot(plane.normal, sub(p, plane.origin))));
  }
  function planeBasis(plane) {
    var ref = Math.abs(plane.normal.x) < 0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0};
    var u = unit(cross(plane.normal, ref));
    if (!u) return null;
    var v = unit(cross(plane.normal, u));
    return v ? {u:u, v:v} : null;
  }

  function curveClosed(c) {
    if (!c) return false;
    if (c.kind === 'line') return false;
    var sweep = Number.isFinite(c.sweepAngle) ? c.sweepAngle : TAU;
    return Math.abs(sweep) >= TAU - 1e-9;
  }
  function curveStart(c) {
    return Number.isFinite(c.startAngle) ? c.startAngle : 0;
  }
  function curveSweep(c) {
    return Number.isFinite(c.sweepAngle) ? c.sweepAngle : TAU;
  }
  function curvePoint(c, t) {
    if (c && c.kind === 'line') {
      var d = unit(sub(c.end, c.start));
      return d ? add(c.start, mul(d, t)) : copyPoint(c.start);
    }
    if (Surfaces && Surfaces.point) return Surfaces.point(c, t);
    var r = Surfaces.radii(c);
    return add(c.center, add(mul(c.u, r.u*Math.cos(t)), mul(c.v, r.v*Math.sin(t))));
  }
  function componentEndpoints(c) {
    if (!c) return null;
    if (c.kind === 'line') return {start:copyPoint(c.start), end:copyPoint(c.end)};
    if (curveClosed(c)) return null;
    var start = curveStart(c), sweep = curveSweep(c);
    return {start:curvePoint(c, start), end:curvePoint(c, start + sweep)};
  }
  function componentSamples(c, count) {
    if (!c) return [];
    if (c.kind === 'line') return [copyPoint(c.start), copyPoint(c.end)];
    var n = count || Math.max(8, Math.ceil(64 * Math.abs(curveSweep(c)) / TAU));
    var start = curveStart(c), sweep = curveSweep(c), out = [];
    var closed = curveClosed(c);
    for (var i=0;i<=n;i++) {
      if (closed && i === n) break;
      out.push(curvePoint(c, start + sweep*i/n));
    }
    if (closed && out.length) out.push(copyPoint(out[0]));
    return out;
  }
  function componentLength(c) {
    var pts = componentSamples(c, 48), total = 0;
    for (var i=1;i<pts.length;i++) total += distance(pts[i-1], pts[i]);
    return total;
  }
  function componentKind(c) {
    return c && c.kind === 'line' ? 'line' : 'curve';
  }
  function componentValid(c) {
    if (!c) return false;
    if (c.kind === 'line') return finite(c.start) && finite(c.end) &&
      distance(c.start, c.end) > EPS;
    return finite(c.center) && finite(c.u) && finite(c.v) &&
      Number.isFinite(curveSweep(c));
  }
  function cloneComponent(c) {
    if (!c) return null;
    if (c.kind === 'line') return {kind:'line', start:copyPoint(c.start), end:copyPoint(c.end),
      sourceIds:(c.sourceIds || []).slice(), surfaceIds:(c.surfaceIds || []).slice()};
    return {kind:c.kind, center:copyPoint(c.center), u:copyPoint(c.u), v:copyPoint(c.v),
      radius:c.radius, radiusU:c.radiusU, radiusV:c.radiusV,
      startAngle:curveStart(c), sweepAngle:curveSweep(c), closed:curveClosed(c),
      sourceIds:(c.sourceIds || []).slice(), surfaceIds:(c.surfaceIds || []).slice()};
  }
  function reverseComponent(c) {
    var out = cloneComponent(c);
    if (out.kind === 'line') {
      var t = out.start; out.start = out.end; out.end = t;
      return out;
    }
    out.startAngle = curveStart(out) + curveSweep(out);
    out.sweepAngle = -curveSweep(out);
    return out;
  }

  function uniqueById(list) {
    var seen = Object.create(null), out = [];
    (list || []).forEach(function (item) {
      var key = item && item.id ? 'id:' + item.id : 'obj:' + (out.length);
      if (seen[key]) return;
      seen[key] = true;
      out.push(item);
    });
    return out;
  }

  function resolveEvidence(entity, spec, profile) {
    var diagnostics = [];
    function push(code, message, extra) {
      var d = {code:code, severity:'warning', message:message,
        entityId:entity && entity.id, sourceIds:entity && entity.id ? [entity.id] : []};
      Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
      diagnostics.push(d);
    }
    var view = spec.view || (entity.viewRole === 'BOTH' ? null : entity.viewRole);
    if (!view || ['PLAN','ELEVATION','PROFILE'].indexOf(view) === -1) {
      push('section-plane-view-ambiguous', 'A cutting-plane trace needs one view role.');
      return {contract:CUTTING, id:spec.id || null, entityId:entity.id,
        sourceIds:[entity.id], status:'unresolved', diagnostics:diagnostics};
    }
    var p1 = worldPointForView(entity.x, entity.y, view, profile);
    var p2 = worldPointForView(entity.x2, entity.y2, view, profile);
    if (!finite(p1) || !finite(p2)) {
      push('section-plane-invalid', 'The cutting-plane trace cannot be mapped to 3D.');
      return {contract:CUTTING, id:spec.id || null, entityId:entity.id, view:view,
        sourceIds:[entity.id], status:'unresolved', diagnostics:diagnostics};
    }
    var trace = sub(p2, p1), traceLength = length(trace);
    if (traceLength <= EPS) {
      push('section-plane-invalid', 'The cutting-plane trace has zero length.');
      return {contract:CUTTING, id:spec.id || null, entityId:entity.id, view:view,
        sourceIds:[entity.id], status:'unresolved', diagnostics:diagnostics};
    }
    var dir = unit(trace), viewDir = viewDirection(view);
    var origin = finite(spec.origin) ? copyPoint(spec.origin) : copyPoint(p1);
    var normal = finite(spec.normal) ? unit(spec.normal) : unit(cross(dir, viewDir));
    if (!finite(normal)) {
      push('section-plane-invalid', 'The cutting-plane normal is degenerate.');
      return {contract:CUTTING, id:spec.id || null, entityId:entity.id, view:view,
        sourceIds:[entity.id], status:'unresolved', diagnostics:diagnostics};
    }
    if (Math.abs(dot(normal, dir)) > 1e-6) {
      push('section-plane-trace-conflict',
        'The declared normal is not perpendicular to the cutting-plane trace.');
    }
    if (Math.abs(dot(normal, viewDir)) > 1e-6) {
      push('section-plane-trace-conflict',
        'The cutting-plane normal does not contain the trace view direction.');
    }
    var retain = spec.retain === true || spec.mode === 'retain';
    var side = String(spec.side || spec.keepSide || '').toLowerCase();
    if (side !== 'positive' && side !== 'negative') side = null;
    var sectionView = viewRoleForNormal(normal);
    var oblique = !sectionView;
    if (spec.sectionView && sectionView && spec.sectionView !== sectionView) {
      push('section-view-conflict',
        'The declared section view is not normal to the resolved cutting plane.',
        {declared:spec.sectionView, resolved:sectionView});
    }
    if (retain && oblique) {
      push('section-plane-oblique-unsupported',
        'A retained full section needs a cutting plane parallel to a principal view plane.');
    }
    if (retain && !side) {
      push('section-plane-side-unresolved',
        'A retained full section needs an explicit positive or negative side.');
    }
    var fatal = diagnostics.some(function (d) {
      return d.code === 'section-plane-invalid' ||
        d.code === 'section-plane-view-ambiguous' ||
        d.code === 'section-plane-trace-conflict' ||
        d.code === 'section-view-conflict' ||
        (retain && (d.code === 'section-plane-oblique-unsupported' ||
          d.code === 'section-plane-side-unresolved'));
    });
    return {contract:CUTTING, id:spec.id || null, entityId:entity.id,
      sourceIds:[entity.id], view:view, trace:{start:p1, end:p2},
      origin:origin, normal:normal, plane:{origin:origin, normal:normal},
      side:side, retain:retain, full:spec.full === true,
      sectionView:spec.sectionView || sectionView,
      oblique:oblique, traceLength:traceLength,
      status:fatal ? 'unresolved' : 'resolved', diagnostics:diagnostics};
  }

  function collectEvidence(entities, profile) {
    var evidence = [], diagnostics = [];
    (entities || []).forEach(function (entity) {
      var spec = entity && entity.meta && entity.meta.section;
      if (!spec || typeof spec !== 'object') return;
      if (spec.contract && spec.contract !== CUTTING) return;
      if (spec.role && spec.role !== 'cutting-plane') return;
      var rec = resolveEvidence(entity, spec, profile);
      evidence.push(rec);
      diagnostics = diagnostics.concat(rec.diagnostics || []);
    });
    return {evidence:evidence, diagnostics:diagnostics};
  }

  function collectBoundaries(entities, profile) {
    var groups = Object.create(null), diagnostics = [];
    var byId = Object.create(null);
    (entities || []).forEach(function (entity) { if (entity && entity.id) byId[entity.id] = entity; });
    (entities || []).forEach(function (entity) {
      var spec = entity && entity.meta && entity.meta.sectionBoundary;
      if (!spec || typeof spec !== 'object') return;
      if (spec.contract && spec.contract !== BOUNDARY) return;
      if (spec.role && spec.role !== 'section-boundary') return;
      var loopId = spec.loopId || ('loop:' + (spec.planeId || '') + ':' + (spec.points || []).join(','));
      var key = String(spec.planeId || '') + '|' + loopId;
      if (!groups[key]) groups[key] = {spec:spec, records:[]};
      groups[key].records.push(entity);
    });
    var loops = [];
    Object.keys(groups).forEach(function (key) {
      var group = groups[key], spec = group.spec;
      var ids = Array.isArray(spec.points) ? spec.points.slice() : [];
      if (spec.shape === 'circle' && spec.center &&
          Number.isFinite(spec.center.x) && Number.isFinite(spec.center.y) &&
          Number.isFinite(spec.radius) && spec.radius > 0) {
        var circleView = spec.view || group.records[0].viewRole;
        if (!circleView || circleView === 'BOTH') {
          diagnostics.push({code:'section-boundary-unresolved', severity:'warning',
            message:'A drawn circular section boundary needs one view role.',
            sourceIds:group.records.map(function (e) { return e.id; })});
          return;
        }
        var circlePoints = [];
        for (var ci=0;ci<64;ci++) {
          var angle = TAU * ci / 64;
          var world = worldPointForView(spec.center.x + spec.radius*Math.cos(angle),
            spec.center.y + spec.radius*Math.sin(angle), circleView, profile);
          if (!finite(world)) { circlePoints = []; break; }
          circlePoints.push(world);
        }
        if (circlePoints.length < 3) {
          diagnostics.push({code:'section-boundary-unresolved', severity:'warning',
            message:'A drawn circular section boundary cannot be mapped to 3D.',
            sourceIds:group.records.map(function (e) { return e.id; })});
          return;
        }
        loops.push({contract:BOUNDARY, planeId:spec.planeId || null, loopId:spec.loopId || key,
          view:circleView, points:circlePoints, closed:true, shape:'circle',
          sourceIds:group.records.map(function (e) { return e.id; })});
        return;
      }
      if (!ids.length) {
        diagnostics.push({code:'section-boundary-unresolved', severity:'warning',
          message:'A drawn section boundary has no ordered point references.',
          sourceIds:group.records.map(function (e) { return e.id; })});
        return;
      }
      var points = [], view = spec.view || null;
      var missing = false;
      ids.forEach(function (id) {
        var point = byId[id];
        if (!point) { missing = true; return; }
        var pview = point.viewRole === 'BOTH' ? view : point.viewRole;
        if (!view) view = pview;
        if (pview !== view) { missing = true; return; }
        var world = worldPointForView(point.x, point.y, pview, profile);
        if (!finite(world)) { missing = true; return; }
        points.push(world);
      });
      if (missing || points.length < 3) {
        diagnostics.push({code:'section-boundary-unresolved', severity:'warning',
          message:'A drawn section boundary is open or references a missing point.',
          sourceIds:group.records.map(function (e) { return e.id; })});
        return;
      }
      loops.push({contract:BOUNDARY, planeId:spec.planeId || null, loopId:spec.loopId || key,
        view:view, points:points, closed:true,
        sourceIds:group.records.map(function (e) { return e.id; })});
    });
    return {loops:loops, diagnostics:diagnostics};
  }

  function geometryExtent(geometry) {
    var minX=Infinity,minY=Infinity,minZ=Infinity;
    var maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity, found = false;
    function include(p) {
      if (!finite(p)) return;
      found = true;
      if (p.x<minX)minX=p.x; if (p.x>maxX)maxX=p.x;
      if (p.y<minY)minY=p.y; if (p.y>maxY)maxY=p.y;
      if (p.z<minZ)minZ=p.z; if (p.z>maxZ)maxZ=p.z;
    }
    (geometry && geometry.vertices || []).forEach(include);
    (geometry && geometry.curves || []).forEach(function (c) {
      if (!c) return;
      if (c.center && Number.isFinite(c.radius || c.radiusU)) {
        var r = Math.max(c.radius || 0, c.radiusU || 0, c.radiusV || 0);
        include(c.center);
        include(add(c.center, {x:r,y:0,z:0}));
        include(add(c.center, {x:0,y:r,z:0}));
        include(add(c.center, {x:0,y:0,z:r}));
      }
      componentSamples(c, 12).forEach(include);
    });
    (geometry && geometry.surfaces || []).forEach(function (s) {
      if (!s) return;
      if (s.origin) include(s.origin);
      if (s.center) include(s.center);
      (s.loops || []).forEach(function (loop) {
        (loop.points || []).forEach(include);
        (loop.elements || []).forEach(function (el) {
          if (el && el.kind === 'polyline') (el.points || []).forEach(include);
          if (el && el.kind === 'curve') componentSamples(el.curve, 12).forEach(include);
        });
      });
    });
    if (!found) return null;
    return {min:{x:minX,y:minY,z:minZ}, max:{x:maxX,y:maxY,z:maxZ},
      center:{x:(minX+maxX)/2,y:(minY+maxY)/2,z:(minZ+maxZ)/2},
      size:Math.max(maxX-minX,maxY-minY,maxZ-minZ,1)};
  }

  function sectionPatch(geometry, plane) {
    var extent = geometryExtent(geometry);
    if (!extent) return null;
    var frame = planeBasis(plane);
    if (!frame) return null;
    var d = sub(extent.center, plane.origin);
    var center = add(plane.origin, add(mul(frame.u, dot(d, frame.u)), mul(frame.v, dot(d, frame.v))));
    var half = 4 * extent.size + 10;
    var corners = [
      add(center, add(mul(frame.u, half), mul(frame.v, half))),
      add(center, add(mul(frame.u, -half), mul(frame.v, half))),
      add(center, add(mul(frame.u, -half), mul(frame.v, -half))),
      add(center, add(mul(frame.u, half), mul(frame.v, -half)))
    ];
    return {id:'section-patch', kind:'plane', origin:copyPoint(center),
      normal:copyPoint(plane.normal), u:frame.u, v:frame.v,
      loops:[{kind:'outer', points:corners}], closed:false,
      sourceIds:[]};
  }

  function normalizeComponent(component, surface) {
    if (!component) return null;
    var out = cloneComponent(component);
    if (!out) return null;
    out.surfaceId = surface && surface.id !== undefined ? surface.id : null;
    out.surfaceKind = surface && surface.kind || null;
    out.sourceIds = Array.from(new Set((out.sourceIds || []).concat(surface && surface.sourceIds || [])));
    out.surfaceIds = Array.from(new Set((out.surfaceIds || []).concat(surface && surface.id !== undefined ? [surface.id] : [])));
    return componentValid(out) ? out : null;
  }

  function weldComponents(components, tolerance) {
    var loops = [], open = [], ambiguous = [], diagnostics = [];
    var edges = [], closed = [];
    (components || []).forEach(function (component, index) {
      if (!component) return;
      if (curveClosed(component)) {
        closed.push({components:[component], componentIndices:[index],
          closed:true, sourceIds:(component.sourceIds || []).slice()});
        return;
      }
      var ends = componentEndpoints(component);
      if (!ends || !finite(ends.start) || !finite(ends.end)) return;
      edges.push({component:component, index:index, start:ends.start, end:ends.end,
        a:-1, b:-1});
    });
    var nodes = [];
    function nodeFor(p) {
      for (var i=0;i<nodes.length;i++) {
        if (distance(nodes[i].point, p) <= tolerance) return i;
      }
      nodes.push({point:copyPoint(p), edges:[]});
      return nodes.length - 1;
    }
    edges.forEach(function (edge) {
      edge.a = nodeFor(edge.start);
      edge.b = nodeFor(edge.end);
      nodes[edge.a].edges.push(edge);
      nodes[edge.b].edges.push(edge);
    });
    var used = edges.map(function () { return false; });
    for (var i=0;i<edges.length;i++) {
      if (used[i]) continue;
      var stack = [edges[i]], group = [], guard = 0;
      used[i] = true;
      while (stack.length && guard++ <= edges.length + 1) {
        var edge = stack.pop();
        group.push(edge);
        [edge.a, edge.b].forEach(function (nodeIndex) {
          nodes[nodeIndex].edges.forEach(function (other) {
            var oi = edges.indexOf(other);
            if (!used[oi]) { used[oi] = true; stack.push(other); }
          });
        });
      }
      var bad = null;
      group.forEach(function (edge) {
        if (!bad && nodes[edge.a].edges.length !== 2) bad = {kind:'open', point:nodes[edge.a].point};
        if (!bad && nodes[edge.b].edges.length !== 2) bad = {kind:'open', point:nodes[edge.b].point};
        if (!bad && (nodes[edge.a].edges.length > 2 || nodes[edge.b].edges.length > 2))
          bad = {kind:'ambiguous', point:nodes[edge.a].point};
      });
      if (bad) {
        if (bad.kind === 'ambiguous') ambiguous.push(bad);
        else open.push(bad);
        diagnostics.push({code:bad.kind === 'ambiguous' ? 'section-boundary-ambiguous' : 'section-boundary-open',
          severity:'warning', message:bad.kind === 'ambiguous' ?
            'Section boundary components meet at a multi-way junction.' :
            'Section boundary components do not close into a loop.',
          point:copyPoint(bad.point)});
        continue;
      }
      loops.push({components:group.map(function (e) { return e.component; }),
        componentIndices:group.map(function (e) { return e.index; }),
        closed:true,
        sourceIds:Array.from(new Set(group.reduce(function (ids, e) {
          return ids.concat(e.component.sourceIds || []);
        }, [])))});
    }
    return {loops:closed.concat(loops), open:open, ambiguous:ambiguous, diagnostics:diagnostics};
  }

  function sectionBoundary(geometry, evidence, options) {
    options = options || {};
    var plane = evidence && evidence.plane;
    if (!plane || !finite(plane.origin) || !finite(plane.normal)) {
      return {contract:QUERY, kind:'section-boundary', status:'unresolved',
        plane:plane || null, components:[], loops:[], bySurface:[], unresolved:[],
        display:{components:[], loops:[]},
        diagnostics:[{code:'section-plane-invalid', severity:'error',
          message:'The cutting plane has no finite origin and normal.'}],
        summary:{surfaces:0, contributing:0, components:0, loops:0, unresolved:0}};
    }
    var surfaces = geometry && geometry.surfaces || [];
    var patch = sectionPatch(geometry, plane);
    if (!patch) {
      return {contract:QUERY, kind:'section-boundary', status:'unresolved',
        plane:plane, components:[], loops:[], bySurface:[], unresolved:[],
        display:{components:[], loops:[]},
        diagnostics:[{code:'section-boundary-unresolved', severity:'error',
          message:'The model has no bounded extent for a section boundary.'}],
        summary:{surfaces:surfaces.length, contributing:0, components:0, loops:0, unresolved:surfaces.length}};
    }
    var extent = geometryExtent(geometry);
    var tolerance = Math.max(1e-5, (extent ? extent.size : 1) * 2e-5);
    var components = [], bySurface = [], unresolved = [], diagnostics = [];
    surfaces.forEach(function (surface) {
      if (!surface || !surface.kind) return;
      var record = {surfaceId:surface.id, surfaceKind:surface.kind,
        status:'none', components:[], diagnostics:[]};
      var bounded = null;
      try { bounded = Surfaces.intersectBounded(patch, surface, geometry, options); }
      catch (err) {
        record.status = 'unresolved';
        record.diagnostics.push({code:'section-surface-failed', severity:'warning',
          message:'The bounded section query failed: ' + (err && err.message || err),
          surfaceId:surface.id});
      }
      if (!bounded) {
        if (!record.diagnostics.length)
          record.diagnostics.push({code:'section-surface-failed', severity:'warning',
            message:'The bounded section query returned nothing.', surfaceId:surface.id});
      } else if (bounded.status === 'ok' && Array.isArray(bounded.components) && bounded.components.length) {
        bounded.components.forEach(function (component) {
          var normalized = normalizeComponent(component, surface);
          if (!normalized) {
            record.diagnostics.push({code:'section-surface-unsupported', severity:'warning',
              message:'A bounded section component is not a supported analytic line or conic.',
              surfaceId:surface.id});
            return;
          }
          components.push(normalized);
          record.components.push(normalized);
        });
        record.status = record.components.length ? 'ok' : 'unresolved';
      } else if (bounded.status === 'coincident') {
        record.status = 'coincident';
        record.diagnostics.push({code:'section-surface-coincident', severity:'warning',
          message:'The cutting plane is coincident with the surface.', surfaceId:surface.id});
      } else if (bounded.status === 'none') {
        record.status = 'none';
      } else {
        record.status = 'unresolved';
        record.diagnostics.push({code:'section-surface-unresolved', severity:'warning',
          message:'The surface cannot be bounded by this section query.' +
            (bounded.status ? ' (' + bounded.status + ')' : ''), surfaceId:surface.id});
      }
      bySurface.push(record);
      record.diagnostics.forEach(function (d) { diagnostics.push(d); });
      if (record.status !== 'ok' && record.status !== 'none')
        unresolved.push({surfaceId:surface.id, code:record.diagnostics[0] ?
          record.diagnostics[0].code : 'section-surface-unresolved',
          message:record.diagnostics[0] ? record.diagnostics[0].message :
            'The surface has no resolved section boundary.'});
    });
    var welded = weldComponents(components, tolerance);
    diagnostics = diagnostics.concat(welded.diagnostics);
    var display = {components:[], loops:[]};
    components.forEach(function (component) {
      var samples = componentSamples(component, 48);
      if (samples.length) display.components.push({surfaceId:component.surfaceId,
        kind:component.kind, points:samples});
    });
    welded.loops.forEach(function (loop) {
      var points = [];
      loop.components.forEach(function (component) {
        componentSamples(component, 48).forEach(function (p) { points.push(p); });
      });
      display.loops.push({closed:loop.closed, points:points,
        componentIndices:loop.componentIndices.slice()});
    });
    var status = 'ok';
    if (!components.length || !welded.loops.length) status = 'unresolved';
    else if (unresolved.length || welded.open.length || welded.ambiguous.length) status = 'partial';
    return {contract:QUERY, kind:'section-boundary', status:status,
      plane:{origin:copyPoint(plane.origin), normal:copyPoint(plane.normal)},
      sectionView:evidence.sectionView || null,
      components:components, loops:welded.loops,
      bySurface:bySurface, unresolved:unresolved, diagnostics:diagnostics,
      display:display,
      summary:{surfaces:surfaces.length,
        contributing:bySurface.filter(function (r) { return r.components.length; }).length,
        components:components.length, loops:welded.loops.length,
        open:welded.open.length, ambiguous:welded.ambiguous.length,
        unresolved:unresolved.length},
      tolerance:tolerance};
  }

  function polylineSegments(points, closed) {
    var out = [];
    if (!points || points.length < 2) return out;
    for (var i=1;i<points.length;i++) out.push([points[i-1], points[i]]);
    if (closed && points.length > 2) out.push([points[points.length-1], points[0]]);
    return out;
  }
  function polylineLength(points, closed) {
    return polylineSegments(points, closed).reduce(function (sum, seg) {
      return sum + distance(seg[0], seg[1]);
    }, 0);
  }
  function nearestSegmentDistance(p, segments) {
    var best = Infinity;
    (segments || []).forEach(function (seg) {
      var d = pointSegmentDistance(p, seg[0], seg[1]);
      if (d < best) best = d;
    });
    return best;
  }
  function compareLoop(analytic, drawn, plane, tolerance) {
    var analyticPoints = [], analyticSegments = [], analyticLength = 0;
    (analytic.components || []).forEach(function (component) {
      var samples = componentSamples(component, 64);
      analyticPoints = analyticPoints.concat(samples);
      analyticSegments = analyticSegments.concat(polylineSegments(samples, curveClosed(component)));
      analyticLength += componentLength(component);
    });
    var drawnPoints = drawn.points.map(function (p) { return projectToPlane(p, plane); });
    if (analyticPoints.length < 2 || drawnPoints.length < 3)
      return {status:'unresolved', code:'section-boundary-unresolved'};
    var drawnSegments = polylineSegments(drawnPoints, true);
    var drawnLength = polylineLength(drawnPoints, true);
    var residual = 0;
    analyticPoints.forEach(function (p) {
      residual = Math.max(residual, nearestSegmentDistance(p, drawnSegments));
    });
    drawnPoints.forEach(function (p) {
      residual = Math.max(residual, nearestSegmentDistance(p, analyticSegments));
    });
    drawnSegments.forEach(function (seg) {
      residual = Math.max(residual, nearestSegmentDistance(add(seg[0], mul(sub(seg[1], seg[0]), 0.5)), analyticSegments));
    });
    var lengthScale = Math.max(1, analyticLength, drawnLength);
    if (Math.abs(analyticLength - drawnLength) > Math.max(tolerance * 4, lengthScale * 0.01))
      return {status:'conflict', code:'section-boundary-conflict',
        residual:residual, tolerance:tolerance,
        lengthResidual:Math.abs(analyticLength - drawnLength)};
    if (residual > Math.max(tolerance * 4, lengthScale * 1e-4))
      return {status:'conflict', code:'section-boundary-conflict',
        residual:residual, tolerance:tolerance};
    return {status:'ok', code:'section-boundary-match', residual:residual, tolerance:tolerance};
  }
  function compareBoundaries(query, boundaries, plane, tolerance) {
    if (!boundaries || !boundaries.length) {
      return {status:'missing', code:'section-boundary-missing',
        message:'No drawn section boundary is available for this plane.',
        matches:[], diagnostics:[]};
    }
    var loops = query && query.loops || [];
    if (!loops.length) {
      return {status:'unresolved', code:'section-boundary-unresolved',
        message:'The analytic section has no closed boundary loop.',
        matches:[], diagnostics:[]};
    }
    if (boundaries.length !== loops.length) {
      return {status:'conflict', code:'section-boundary-conflict',
        message:'The number of drawn section loops does not match the analytic section.',
        matches:[], diagnostics:[{code:'section-boundary-conflict', severity:'warning',
          message:'The drawn section boundary loop count differs from the analytic section.'}]};
    }
    var remaining = boundaries.slice(), matches = [];
    for (var i=0;i<loops.length;i++) {
      var best = null;
      remaining.forEach(function (drawn, index) {
        var result = compareLoop(loops[i], drawn, plane, tolerance);
        if (!best || result.residual < best.result.residual)
          best = {drawn:drawn, index:index, result:result};
      });
      if (!best || best.result.status !== 'ok')
        return {status:'conflict', code:'section-boundary-conflict',
          message:'The drawn section boundary does not match the analytic section.',
          matches:matches.concat(best ? [best.result] : []),
          diagnostics:[{code:'section-boundary-conflict', severity:'warning',
            message:'The drawn section boundary does not match the analytic section.',
            residual:best && best.result.residual, tolerance:tolerance}]};
      matches.push(best.result);
      remaining.splice(best.index, 1);
    }
    return {status:'ok', code:'section-boundary-match', message:'',
      matches:matches, diagnostics:[]};
  }

  function surfaceSide(surface, plane, geometry, tolerance) {
    var points = [];
    function include(p) { if (finite(p)) points.push(p); }
    (surface.loops || []).forEach(function (loop) {
      (loop.vertices || []).forEach(function (i) { include(geometry && geometry.vertices && geometry.vertices[i]); });
      (loop.points || []).forEach(include);
      (loop.elements || []).forEach(function (el) {
        if (el && el.kind === 'polyline') (el.points || []).forEach(include);
        if (el && el.kind === 'curve') componentSamples(el.curve, 8).forEach(include);
      });
      if (loop.section) componentSamples(loop.section, 8).forEach(include);
      (loop.curves || []).forEach(function (c) {
        var curve = typeof c === 'object' ? c : geometry && geometry.curves && geometry.curves[c];
        componentSamples(curve, 8).forEach(include);
      });
      (loop.lines || []).forEach(function (line) {
        if (line && line.start) include(line.start);
        if (line && line.end) include(line.end);
      });
    });
    include(surface.origin);
    include(surface.center);
    if (!points.length) return {status:'unknown'};
    var min = Infinity, max = -Infinity;
    points.forEach(function (p) {
      var d = dot(plane.normal, sub(p, plane.origin));
      if (d < min) min = d;
      if (d > max) max = d;
    });
    if (max <= tolerance) return {status:'negative', min:min, max:max};
    if (min >= -tolerance) return {status:'positive', min:min, max:max};
    return {status:'mixed', min:min, max:max};
  }

  function collectSectionElements(surface, plane, tolerance) {
    var out = [];
    function pushCurve(c) {
      if (!c || !componentValid(c)) return;
      var samples = componentSamples(c, 12);
      if (samples.length && samples.every(function (p) { return pointOnPlane(p, plane) <= tolerance * 8; }))
        out.push({kind:'curve', curve:c});
    }
    function pushLine(a, b) {
      if (!finite(a) || !finite(b) || distance(a, b) <= EPS) return;
      if (pointOnPlane(a, plane) <= tolerance * 8 && pointOnPlane(b, plane) <= tolerance * 8)
        out.push({kind:'polyline', points:[copyPoint(a), copyPoint(b)]});
    }
    (surface.loops || []).forEach(function (loop) {
      if (loop.section) pushCurve(loop.section);
      (loop.curves || []).forEach(function (c) {
        pushCurve(typeof c === 'object' ? c : null);
      });
      (loop.lines || []).forEach(function (line) {
        if (line) pushLine(line.start, line.end);
      });
      (loop.elements || []).forEach(function (el) {
        if (!el) return;
        if (el.kind === 'curve') pushCurve(el.curve);
        else if (el.kind === 'polyline') {
          (el.points || []).forEach(function (p, i, list) {
            if (i < list.length - 1) pushLine(p, list[i+1]);
          });
        }
      });
    });
    return out;
  }

  function elementEndpoints(element) {
    if (!element) return null;
    if (element.kind === 'curve' && element.curve)
      return componentEndpoints(element.curve);
    if (element.kind === 'polyline' && element.points && element.points.length >= 2)
      return {start:element.points[0], end:element.points[element.points.length-1]};
    return null;
  }
  function weldElements(elements, tolerance) {
    var nodes = [], edges = [], loops = [], open = [], ambiguous = [];
    elements.forEach(function (element) {
      if (element && element.kind === 'curve' && element.curve && curveClosed(element.curve))
        loops.push({kind:'outer', elements:[element]});
    });
    function nodeFor(p) {
      for (var i=0;i<nodes.length;i++) if (distance(nodes[i].point, p) <= tolerance) return i;
      nodes.push({point:copyPoint(p), edges:[]});
      return nodes.length - 1;
    }
    elements.forEach(function (element) {
      var ends = elementEndpoints(element);
      if (!ends) return;
      var edge = {element:element, a:nodeFor(ends.start), b:nodeFor(ends.end)};
      edges.push(edge);
      nodes[edge.a].edges.push(edge);
      nodes[edge.b].edges.push(edge);
    });
    var used = edges.map(function () { return false; });
    for (var i=0;i<edges.length;i++) {
      if (used[i]) continue;
      var stack = [edges[i]], group = [], guard = 0;
      used[i] = true;
      while (stack.length && guard++ <= edges.length + 1) {
        var edge = stack.pop();
        group.push(edge);
        [edge.a, edge.b].forEach(function (nodeIndex) {
          nodes[nodeIndex].edges.forEach(function (other) {
            var oi = edges.indexOf(other);
            if (!used[oi]) { used[oi] = true; stack.push(other); }
          });
        });
      }
      var bad = null;
      group.forEach(function (edge) {
        if (!bad && nodes[edge.a].edges.length !== 2) bad = {kind:'open', point:nodes[edge.a].point};
        if (!bad && nodes[edge.b].edges.length !== 2) bad = {kind:'open', point:nodes[edge.b].point};
        if (!bad && (nodes[edge.a].edges.length > 2 || nodes[edge.b].edges.length > 2))
          bad = {kind:'ambiguous', point:nodes[edge.a].point};
      });
      if (bad) {
        if (bad.kind === 'ambiguous') ambiguous.push(bad); else open.push(bad);
        continue;
      }
      loops.push({kind:'outer', elements:group.map(function (e) { return e.element; })});
    }
    return {loops:loops, open:open, ambiguous:ambiguous};
  }

  function retainConvexPolyhedron(geometry, evidence, query) {
    var surfaces = geometry.surfaces || [], vertices = geometry.vertices || [];
    if (!surfaces.length || surfaces.some(function (surface) {
      return surface.kind !== 'plane' || surface.loops.length !== 1 ||
        !Array.isArray(surface.loops[0].vertices);
    })) return null;
    var original = geometry.analyticCertificate;
    if (!original || original.deferred)
      original = Surfaces.certify({surfaces:surfaces, diagnostics:[]}, geometry);
    if (!original || original.status !== 'ok' || original.counts.closedShells !== 1 ||
        original.counts.openComponents !== 0) return null;
    var indices = Array.from(new Set(surfaces.flatMap(function (surface) {
      return surface.loops[0].vertices;
    })));
    var plane = evidence.plane, tolerance = query.tolerance || EPS;
    var center = mul(indices.reduce(function (sum, index) {
      return add(sum, vertices[index]);
    }, {x:0,y:0,z:0}), 1 / indices.length);
    if (surfaces.some(function (surface) {
      var direction = dot(surface.normal, sub(center, surface.origin));
      return Math.abs(direction) <= tolerance || indices.some(function (index) {
        return Math.sign(direction) * dot(surface.normal, sub(vertices[index], surface.origin)) < -tolerance;
      });
    })) return null;
    var sign = evidence.side === 'positive' ? 1 : -1;
    var distances = vertices.map(function (vertex) {
      return sign * dot(plane.normal, sub(vertex, plane.origin));
    });
    if (!indices.some(function (index) { return distances[index] > tolerance; }) ||
        !indices.some(function (index) { return distances[index] < -tolerance; })) return null;
    var crossings = new Map(), cut = new Set();
    function intersection(a, b) {
      if (Math.abs(distances[a]) <= tolerance) return vertices[a];
      if (Math.abs(distances[b]) <= tolerance) return vertices[b];
      var low = Math.min(a, b), high = Math.max(a, b), key = low + ':' + high;
      if (!crossings.has(key)) {
        var delta = sub(vertices[high], vertices[low]);
        crossings.set(key, add(vertices[low], mul(delta, distances[low] /
          (distances[low] - distances[high]))));
      }
      return crossings.get(key);
    }
    var lineIds = new Map();
    function patch(points, normal, sourceIds) {
      var lines = points.map(function (start, index) {
        var end = points[(index + 1) % points.length];
        var key = [start, end].map(function (p) {
          return [p.x, p.y, p.z].join(',');
        }).sort().join('|');
        if (!lineIds.has(key)) lineIds.set(key, 'section-edge:' + lineIds.size);
        return {id:lineIds.get(key), kind:'line', start:start, end:end};
      });
      return {kind:'plane', origin:points[0], normal:normal, sourceIds:sourceIds,
        loops:[{kind:'outer', lines:lines}]};
    }
    var retained = [], removed = [];
    surfaces.forEach(function (surface) {
      var loop = surface.loops[0].vertices;
      var clipped = [];
      loop.forEach(function (a, i) {
        var b = loop[(i + 1) % loop.length];
        var keepA = distances[a] >= -tolerance, keepB = distances[b] >= -tolerance;
        if (keepA) clipped.push(vertices[a]);
        if (keepA !== keepB) clipped.push(intersection(a, b));
      });
      clipped = Array.from(new Set(clipped));
      if (clipped.length < 3) {
        removed.push(surface);
        return;
      }
      clipped.forEach(function (point) {
        if (pointOnPlane(point, plane) <= tolerance) cut.add(point);
      });
      var normal = dot(surface.normal, sub(center, surface.origin)) < 0 ?
        surface.normal : mul(surface.normal, -1);
      retained.push(patch(clipped, normal, surface.sourceIds));
    });
    var points = Array.from(cut);
    if (points.length < 3) return null;
    var origin = mul(points.reduce(add), 1 / points.length);
    var normal = mul(plane.normal, -sign);
    var right = unit(sub(points[0], origin));
    if (!right) return null;
    var up = cross(normal, right);
    function angle(point) {
      var offset = sub(point, origin);
      return Math.atan2(dot(up, offset), dot(right, offset));
    }
    points.sort(function (a, b) { return angle(a) - angle(b); });
    var cap = patch(points, normal, evidence.sourceIds);
    var retainedGeometry = {vertices:[], curves:[], faces:[], surfacePatches:retained.concat(cap)};
    var model = Surfaces.build(retainedGeometry);
    var certificate = Surfaces.certify(model, retainedGeometry);
    var validation = Surfaces.validate(model, retainedGeometry);
    if (certificate.status !== 'ok' || certificate.counts.closedShells !== 1) return null;
    return {contract:RETAIN, kind:'section-split', status:'ok', plane:plane,
      side:evidence.side, section:query, surfaces:retained, removed:removed,
      unresolved:[], cap:[cap], model:model.summary, certificate:certificate,
      validation:validation, diagnostics:[],
      summary:{surfaces:surfaces.length, retained:retained.length, removed:removed.length, unresolved:0}};
  }

  function identifyCutBoundaries(split, source, evidence) {
    function elements(surface) {
      return (surface && surface.loops || []).flatMap(function (loop) {
        return [loop.section].concat(loop.curves || [], loop.lines || [],
          (loop.elements || []).map(function (element) { return element.curve; })
        ).filter(function (element) { return element && typeof element === 'object'; });
      });
    }
    var original = new Set(elements(source).map(function (element) { return element.id; }));
    var seen = new Set(), ids = new Map();
    elements(split.positive).concat(elements(split.negative)).forEach(function (element) {
      if (seen.has(element) || original.has(element.id)) return;
      seen.add(element);
      if (!ids.has(element.id))
        ids.set(element.id, 'drawing-section:' + evidence.entityId + ':' + source.id + ':' + ids.size);
      element.id = ids.get(element.id);
    });
  }

  function retain(geometry, evidence, query, options) {
    options = options || {};
    var diagnostics = [];
    function fail(code, message, extra) {
      var d = {code:code, severity:'warning', message:message};
      Object.keys(extra || {}).forEach(function (k) { d[k] = extra[k]; });
      diagnostics.push(d);
      return {contract:RETAIN, kind:'section-split', status:'refused',
        plane:query && query.plane || evidence && evidence.plane || null,
        side:evidence && evidence.side || null, section:query || null,
        surfaces:[], removed:[], unresolved:[], cap:null, certificate:null,
        validation:null, diagnostics:diagnostics,
        summary:{surfaces:0, retained:0, removed:0, unresolved:0}};
    }
    if (!evidence || !evidence.plane || evidence.status !== 'resolved')
      return fail('section-plane-invalid', 'A retained section needs a resolved cutting plane.');
    if (evidence.oblique)
      return fail('section-plane-oblique-unsupported',
        'A retained full section needs a principal cutting plane.');
    if (!evidence.side)
      return fail('section-plane-side-unresolved',
        'A retained full section needs an explicit positive or negative side.');
    if (!query || query.status === 'unresolved')
      return fail('section-boundary-unresolved',
        'A retained section needs a resolved analytic section boundary.');
    var boundary = query.boundary || evidence.boundary || null;
    if (boundary && boundary.status === 'conflict')
      return fail('section-boundary-conflict',
        'The drawn section boundary does not match the analytic section.',
        {residual:boundary.matches && boundary.matches[0] && boundary.matches[0].residual});
    if ((!boundary || boundary.status !== 'ok') && options.acceptAnalyticBoundary !== true)
      return fail(boundary && boundary.code === 'section-boundary-conflict' ?
        'section-boundary-conflict' : 'section-boundary-missing',
        'A retained full section needs a resolved drawn section boundary.');

    var planarShell = retainConvexPolyhedron(geometry, evidence, query);
    if (planarShell) return planarShell;
    var plane = evidence.plane;
    var tolerance = query.tolerance || Math.max(EPS, (geometryExtent(geometry) || {size:1}).size * 1e-6);
    var retained = [], removed = [], unresolved = [];
    (geometry && geometry.surfaces || []).forEach(function (surface) {
      if (!surface || !surface.kind) return;
      var record = (query.bySurface || []).filter(function (r) { return r.surfaceId === surface.id; })[0];
      if (record && record.components && record.components.length) {
        if (surface.kind === 'plane') {
          unresolved.push({surfaceId:surface.id, code:'section-planar-split-unsupported',
            message:'The planar faces need a supported convex shell with a closed cut loop.'});
          return;
        }
        var splitDiagnostics = [];
        var split = null;
        try { split = Surfaces.split(surface, plane, geometry, splitDiagnostics); }
        catch (err) {
          splitDiagnostics.push({code:'section-split-failed', message:err && err.message || String(err)});
        }
        if (!split) {
          unresolved.push({surfaceId:surface.id,
            code:splitDiagnostics[0] ? splitDiagnostics[0].code : 'section-split-refused',
            message:splitDiagnostics[0] ? splitDiagnostics[0].message :
              'The surface could not be split by the cutting plane.'});
          return;
        }
        identifyCutBoundaries(split, surface, evidence);
        var kept = evidence.side === 'positive' ? split.positive : split.negative;
        var dropped = evidence.side === 'positive' ? split.negative : split.positive;
        if (kept) retained.push(kept);
        if (dropped) removed.push(dropped);
        return;
      }
      var side = surfaceSide(surface, plane, geometry, tolerance);
      if (side.status === evidence.side) retained.push(surface);
      else if (side.status === 'unknown' || side.status === 'mixed') {
        unresolved.push({surfaceId:surface.id, code:'section-surface-side-unresolved',
          message:'The surface lies partly on the cutting plane without a resolved section split.'});
      }
    });
    diagnostics = diagnostics.concat(unresolved.map(function (u) {
      return {code:u.code, severity:'warning', message:u.message, surfaceId:u.surfaceId};
    }));
    if (unresolved.length) {
      return {contract:RETAIN, kind:'section-split', status:'partial',
        plane:{origin:copyPoint(plane.origin), normal:copyPoint(plane.normal)},
        side:evidence.side, section:query, surfaces:retained, removed:removed,
        unresolved:unresolved, cap:null, certificate:null, validation:null,
        diagnostics:diagnostics,
        summary:{surfaces:(geometry.surfaces || []).length, retained:retained.length,
          removed:removed.length, unresolved:unresolved.length}};
    }

    var elements = [];
    retained.forEach(function (surface) {
      elements = elements.concat(collectSectionElements(surface, plane, tolerance));
    });
    var welded = weldElements(elements, tolerance);
    if (welded.open.length || welded.ambiguous.length || !welded.loops.length) {
      diagnostics.push({code:'section-cap-pending', severity:'warning',
        message:welded.ambiguous.length ?
          'The retained section boundary has a multi-way junction and no cap can be certified.' :
          welded.open.length ? 'The retained section boundary is open and no cap can be certified.' :
            'The retained section has no section boundary elements for a cap.'});
      return {contract:RETAIN, kind:'section-split', status:'partial',
        plane:{origin:copyPoint(plane.origin), normal:copyPoint(plane.normal)},
        side:evidence.side, section:query, surfaces:retained, removed:removed,
        unresolved:[], cap:null, certificate:null, validation:null,
        diagnostics:diagnostics,
        summary:{surfaces:(geometry.surfaces || []).length, retained:retained.length,
          removed:removed.length, unresolved:0}};
    }
    var capNormal = evidence.side === 'positive' ?
      mul(plane.normal, -1) : copyPoint(plane.normal);
    var caps = welded.loops.map(function (loop, index) {
      return {kind:'plane', origin:copyPoint(plane.origin), normal:copyPoint(capNormal),
        loops:[loop], closed:false, cap:true,
        sourceIds:(evidence.sourceIds || []).slice(),
        sectionCap:{planeId:evidence.id, side:evidence.side, loopIndex:index}};
    });
    var model = null, validation = null, certificate = null;
    try {
      model = Surfaces.build({vertices:geometry.vertices || [], curves:geometry.curves || [],
        faces:[], surfacePatches:retained.concat(caps)});
      if (model) {
        validation = Surfaces.validate(model, geometry);
        certificate = Surfaces.certify(model, geometry);
      }
    } catch (err) {
      diagnostics.push({code:'section-shell-failed', severity:'warning',
        message:'The retained section shell could not be certified: ' +
          (err && err.message || err)});
    }
    var certified = !!(certificate && certificate.status === 'ok' &&
      certificate.counts && certificate.counts.closedShells > 0);
    if (!certified) {
      diagnostics.push({code:'section-shell-open', severity:'warning',
        message:'The retained section with cap does not certify a closed shell.'});
      return {contract:RETAIN, kind:'section-split', status:'partial',
        plane:{origin:copyPoint(plane.origin), normal:copyPoint(plane.normal)},
        side:evidence.side, section:query, surfaces:retained, removed:removed,
        unresolved:[], cap:caps, model:model ? model.summary : null,
        certificate:certificate, validation:validation,
        diagnostics:diagnostics,
        summary:{surfaces:(geometry.surfaces || []).length, retained:retained.length,
          removed:removed.length, unresolved:0}};
    }
    return {contract:RETAIN, kind:'section-split', status:'ok',
      plane:{origin:copyPoint(plane.origin), normal:copyPoint(plane.normal)},
      side:evidence.side, section:query, surfaces:retained, removed:removed,
      unresolved:[], cap:caps, model:model ? model.summary : null,
      certificate:certificate, validation:validation, diagnostics:diagnostics,
      summary:{surfaces:(geometry.surfaces || []).length, retained:retained.length,
        removed:removed.length, unresolved:0}};
  }

  function analyze(geometry, entities, options) {
    options = options || {};
    if (!geometry || !Array.isArray(geometry.surfaces) || !geometry.surfaces.length) {
      return {contract:MODEL, status:'none', evidence:[], queries:[], retained:[],
        diagnostics:[], summary:{planes:0, queries:0, retained:0, unresolved:0}};
    }
    var collected = collectEvidence(entities, options.profile || geometry.profileMap);
    if (!collected.evidence.length)
      return {contract:MODEL, status:'none', evidence:[], queries:[], retained:[],
        diagnostics:[], summary:{planes:0, queries:0, retained:0, unresolved:0}};
    var boundaries = collectBoundaries(entities, options.profile || geometry.profileMap);
    var diagnostics = collected.diagnostics.concat(boundaries.diagnostics);
    var queries = [], retained = [];
    var extent = geometryExtent(geometry);
    var globalTolerance = Math.max(1e-5, (extent ? extent.size : 1) * 2e-5);
    collected.evidence.forEach(function (evidence) {
      if (evidence.status !== 'resolved' || !evidence.plane) return;
      var query = sectionBoundary(geometry, evidence, options);
      var planeBoundaries = boundaries.loops.filter(function (loop) {
        return !loop.planeId || !evidence.id || loop.planeId === evidence.id;
      });
      query.boundary = compareBoundaries(query, planeBoundaries, evidence.plane,
        Math.max(globalTolerance, query.tolerance || 0));
      diagnostics = diagnostics.concat(query.diagnostics || []);
      diagnostics = diagnostics.concat(query.boundary.diagnostics || []);
      queries.push(query);
      if (evidence.retain) {
        var retainedResult = retain(geometry, evidence, query, options);
        retained.push(retainedResult);
        diagnostics = diagnostics.concat(retainedResult.diagnostics || []);
      }
    });
    var seen = Object.create(null);
    diagnostics = diagnostics.filter(function (d) {
      var key = [d.code, d.entityId || '', d.surfaceId || '', d.message || ''].join('|');
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
    var status = 'ok';
    if (collected.evidence.some(function (e) { return e.status !== 'resolved'; })) status = 'unresolved';
    else if (queries.some(function (q) { return q.status !== 'ok'; }) ||
      retained.some(function (r) { return r.status !== 'ok'; })) status = 'partial';
    return {contract:MODEL, status:status, evidence:collected.evidence,
      queries:queries, retained:retained, diagnostics:diagnostics,
      summary:{planes:collected.evidence.length, queries:queries.length,
        retained:retained.length,
        unresolved:collected.evidence.filter(function (e) { return e.status !== 'resolved'; }).length +
          retained.reduce(function (n, r) { return n + (r.unresolved ? r.unresolved.length : 0); }, 0)}};
  }

  return {
    VERSION:VERSION,
    CUTTING_CONTRACT:CUTTING,
    BOUNDARY_CONTRACT:BOUNDARY,
    MODEL_CONTRACT:MODEL,
    QUERY_CONTRACT:QUERY,
    RETAIN_CONTRACT:RETAIN,
    analyze:analyze,
    collectEvidence:collectEvidence,
    collectBoundaries:collectBoundaries,
    sectionBoundary:sectionBoundary,
    compareBoundaries:compareBoundaries,
    retain:retain,
    retainSection:retain,
    worldPointForView:worldPointForView,
    viewRoleForNormal:viewRoleForNormal
  };
});

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADSurfaces = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Bounded analytic surfaces. This is the bridge between the inferred display
  // patches and a surface/boundary model: every patch keeps an analytic
  // definition (plane, cylinder, cone, sphere) plus ordered boundary loops.
  // Intersections and trims use those definitions; display tessellation is
  // never the source of truth.
  var EPS = 1e-7, TAU = 2 * Math.PI;

  function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
  function cross(a, b) { return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}; }
  function sub(a, b) { return {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}; }
  function add(a, b) { return {x:a.x+b.x, y:a.y+b.y, z:a.z+b.z}; }
  function mul(a, s) { return {x:a.x*s, y:a.y*s, z:a.z*s}; }
  function length(v) { return Math.hypot(v.x, v.y, v.z); }
  function unit(v) {
    var l = length(v);
    return l > EPS ? {x:v.x/l, y:v.y/l, z:v.z/l} : {x:0, y:1, z:0};
  }
  function finite(v) { return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z); }
  function basis(n) {
    var ref = Math.abs(n.x) < 0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0};
    var u = unit(cross(n, ref));
    return {u:u, v:unit(cross(n, u))};
  }
  function newell(points) {
    var n = {x:0,y:0,z:0};
    for (var i=0;i<points.length;i++) {
      var a=points[i], b=points[(i+1)%points.length];
      n.x += (a.y-b.y)*(a.z+b.z);
      n.y += (a.z-b.z)*(a.x+b.x);
      n.z += (a.x-b.x)*(a.y+b.y);
    }
    return length(n) > EPS ? unit(n) : null;
  }
  function radii(c) {
    return {u:c.radiusU === undefined ? c.radius : c.radiusU,
      v:c.radiusV === undefined ? c.radius : c.radiusV};
  }
  function curvePoint(c, t) {
    var r=radii(c), cs=Math.cos(t)*r.u, sn=Math.sin(t)*r.v;
    return {x:c.center.x+c.u.x*cs+c.v.x*sn,
      y:c.center.y+c.u.y*cs+c.v.y*sn,
      z:c.center.z+c.u.z*cs+c.v.z*sn};
  }
  function curveNormal(c) { return unit(cross(c.u, c.v)); }
  function planeSpec(plane) {
    if (!plane) return null;
    var n = plane.normal || plane.n;
    var origin = plane.origin || plane.point || null;
    if (!n && plane.axis) n = plane.axis;
    if (!n && plane.points && plane.points.length >= 3) {
      n = newell(plane.points);
      origin = origin || plane.points[0];
    }
    if (!n || !finite(n) || length(n) <= EPS) return null;
    n = unit(n);
    if (!origin) {
      if (Number.isFinite(plane.d)) origin = mul(n, plane.d);
      else origin = {x:0,y:0,z:0};
    }
    return finite(origin) ? {origin:origin, normal:n} : null;
  }
  function validCurve(c) {
    return c && finite(c.center) && finite(c.u) && finite(c.v) &&
      Number.isFinite(radii(c).u) && radii(c).u > 0 &&
      Number.isFinite(radii(c).v) && radii(c).v > 0 &&
      Math.abs(length(c.u)-1) <= EPS && Math.abs(length(c.v)-1) <= EPS && Math.abs(dot(c.u,c.v)) <= EPS;
  }

  function build(geometry, options) {
    if (!geometry) return null;
    var model = {version:1, contract:'analytic-surface-v1', surfaces:[], diagnostics:[]};
    var vertices = geometry.vertices || [], curves = geometry.curves || [], faces = geometry.faces || [];
    function diag(code, message, sourceIds) {
      model.diagnostics.push({code:code, message:message, sourceIds:sourceIds || []});
    }
    function addSurface(surface) {
      if (!surface) return;
      surface.id = 'surface:' + model.surfaces.length;
      surface.inferred = true;
      surface.closed = !!surface.closed;
      model.surfaces.push(surface);
    }
    var patches = (geometry.surfacePatches || []).slice();
    // Legacy wire adapters expose logical planar regions directly, without
    // the primitive pipeline's surfacePatches array.
    if (!patches.length && geometry.faceRegions) patches = geometry.faceRegions.map(function (region) {
      return {kind:'plane', outer:region.outer, holes:region.holes || []};
    });
    patches.forEach(function (patch, pi) {
      var sourceIds = (patch.sourceIds || []).slice(), surface = null;
      try {
        if (patch.kind === 'sphere') {
          if (!finite(patch.center) || !(patch.radius > 0)) {
            diag('surface-invalid-sphere', 'A sphere needs a finite centre and positive radius.', sourceIds); return;
          }
          // A complete sphere silhouette has no boundary. A spherical patch
          // (for example a recess cap) keeps its analytic boundary loop.
          var sphereBoundary = (patch.boundaryCurves || []).slice();
          var sphereLoops = [];
          if (patch.curveLoops && patch.curveLoops.length) {
            sphereLoops = patch.curveLoops.map(function (l) {
              return {kind:l.kind || 'outer', curves:(l.curves || []).slice()};
            });
            sphereBoundary = [];
            sphereLoops.forEach(function (l) { sphereBoundary = sphereBoundary.concat(l.curves); });
          } else if (sphereBoundary.length) {
            sphereLoops = [{kind:'outer', curves:sphereBoundary.slice()}];
          }
          if (sphereBoundary.some(function (i) { return !validCurve(curves[i]); })) {
            diag('surface-invalid-boundary', 'A spherical patch references a missing analytic boundary.', sourceIds); return;
          }
          surface = {kind:'sphere', center:patch.center, radius:patch.radius, loops:sphereLoops,
            closed:sphereLoops.length === 0, sourceIds:sourceIds,
            displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
          if (sphereBoundary.length) surface.boundaryCurves = sphereBoundary;
          if (patch.cap) surface.cap = patch.cap;
          if (patch.recess) surface.recess = true;
        } else if (patch.kind === 'plane') {
          if (patch.outer && patch.outer.length >= 3) {
            var pts = patch.outer.map(function (i) { return vertices[i]; });
            if (pts.some(function (p) { return !finite(p); })) {
              diag('surface-invalid-boundary', 'A planar boundary references a missing vertex.', sourceIds); return;
            }
            var n = newell(pts);
            if (!n) { diag('surface-degenerate-plane', 'A planar boundary has no area.', sourceIds); return; }
            var b = basis(n);
            var loops = [{kind:'outer', vertices:patch.outer.slice()}];
            (patch.holes || []).forEach(function (h) { loops.push({kind:'inner', vertices:h.slice()}); });
            var innerInvalid = false;
            (patch.innerCurves || []).forEach(function (i) {
              if (!validCurve(curves[i])) {
                diag('surface-invalid-boundary', 'A planar inner boundary references a missing analytic curve.', sourceIds);
                innerInvalid = true; return;
              }
              loops.push({kind:'inner', curves:[i]});
            });
            if (innerInvalid) return;
            surface = {kind:'plane', origin:pts[0], normal:n, u:b.u, v:b.v, loops:loops,
              boundaryCurves:(patch.boundaryCurves || []).slice(), closed:false, sourceIds:sourceIds,
              displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
            if (patch.closure) surface.closure = patch.closure;
          } else if (patch.boundaryCurves && patch.boundaryCurves.length) {
            var ci = patch.boundaryCurves[0], c = curves[ci];
            if (!validCurve(c)) {
              diag('surface-invalid-boundary', 'A planar cap references a missing analytic curve.', sourceIds); return;
            }
            var cn = curveNormal(c);
            if (patch.faceIndices && patch.faceIndices.length && faces[patch.faceIndices[0]]) {
              var faceN = newell(faces[patch.faceIndices[0]].map(function (i) { return vertices[i]; }));
              if (faceN && dot(faceN, cn) < 0) cn = mul(cn, -1);
            }
            surface = {kind:'plane', origin:c.center, normal:cn, u:c.u, v:c.v,
              loops:[{kind:'outer', curves:[ci]}], boundaryCurves:[ci], closed:false,
              sourceIds:sourceIds, displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
            if (patch.closure) surface.closure = patch.closure;
            if (patch.recessMouth) surface.recessMouth = true;
          } else {
            diag('surface-unbounded-plane', 'A planar patch has no boundary loop.', sourceIds); return;
          }
        } else if (patch.kind === 'cylinder' || patch.kind === 'cone' || patch.kind === 'ruled') {
          var bcs = (patch.boundaryCurves || []).slice();
          if (!bcs.length) { diag('surface-unbounded-ruled', 'A ruled patch has no boundary curve.', sourceIds); return; }
          var first = curves[bcs[0]], second = bcs.length > 1 ? curves[bcs[1]] : null;
          if (!validCurve(first) || second && !validCurve(second)) {
            diag('surface-invalid-boundary', 'A ruled patch references a missing analytic boundary.', sourceIds); return;
          }
          var axis = patch.axis && finite(patch.axis) ? unit(patch.axis) :
            second && length(sub(second.center, first.center)) > EPS ? unit(sub(second.center, first.center)) : curveNormal(first);
          var kind = patch.analyticKind || patch.kind;
          if (kind === 'ruled') kind = second && Math.abs(first.radius - second.radius) <= EPS ? 'cylinder' : 'cone';
          var loops2 = bcs.map(function (i) { return {kind:'outer', curves:[i]}; });
          var surface2 = {kind:kind, origin:first.center, axis:axis, radius:first.radius,
            loops:loops2, boundaryCurves:bcs, closed:false, sourceIds:sourceIds,
            displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
          if (patch.apex) surface2.apex = patch.apex;
          if (Number.isFinite(patch.halfAngle)) surface2.halfAngle = patch.halfAngle;
          if (kind === 'cone' && !surface2.apex && second) {
            var r1 = first.radius, r2 = second.radius;
            if (Math.abs(r1 - r2) > EPS) {
              var delta = sub(second.center, first.center);
              var axial = dot(delta, axis);
              surface2.apex = add(first.center, mul(axis, axial * r1 / (r1 - r2)));
              surface2.halfAngle = Math.atan2(Math.abs(r1 - r2), Math.abs(axial));
            }
          }
          surface = surface2;
        } else {
          diag('surface-kind-unsupported', 'The surface patch kind "' + patch.kind + '" has no analytic model.', sourceIds);
          return;
        }
      } catch (err) {
        diag('surface-build-failed', 'The surface could not be modelled: ' + (err && err.message || err), sourceIds);
        return;
      }
      addSurface(surface);
    });
    model.summary = summarize(model);
    if (model.diagnostics.length) model.summary.status = 'issues';
    return model;
  }

  // Indexed drawing curves and inline section curves share boundary processing.
  function loopCurves(loop, curves) {
    return (loop.curves || []).map(function(i) { return curves[i]; })
      .concat(loop.section ? [loop.section] : []);
  }

  function loopElements(loop) {
    var keys = [];
    if (loop && loop.section) keys.push(loop.section);
    if (loop && loop.curves) loop.curves.forEach(function (i) { keys.push('c:' + i); });
    if (loop && loop.vertices && loop.vertices.length >= 2) {
      for (var i=0;i<loop.vertices.length;i++) {
        var a=loop.vertices[i], b=loop.vertices[(i+1)%loop.vertices.length];
        keys.push('e:' + Math.min(a,b) + '_' + Math.max(a,b));
      }
    }
    return keys;
  }

  function analyze(model) {
    var usage = new Map(), surfKeys = new Map();
    model.surfaces.forEach(function (s) {
      var keys = [];
      (s.loops || []).forEach(function (loop) {
        loopElements(loop).forEach(function (k) {
          keys.push(k);
          if (!usage.has(k)) usage.set(k, []);
          usage.get(k).push(s.id);
        });
      });
      surfKeys.set(s.id, keys);
    });
    var parent = new Map();
    model.surfaces.forEach(function (s) { parent.set(s.id, s.id); });
    function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
    function union(a,b) { a=find(a); b=find(b); if (a!==b) parent.set(a,b); }
    usage.forEach(function (ids) { for (var i=1;i<ids.length;i++) union(ids[0], ids[i]); });
    var groups = new Map();
    model.surfaces.forEach(function (s) {
      var root=find(s.id);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(s);
    });
    var openBoundaries = 0, nonmanifoldBoundaries = 0;
    usage.forEach(function (ids) { if (ids.length === 1) openBoundaries++; else if (ids.length > 2) nonmanifoldBoundaries++; });
    var closedShells = 0, openSurfaces = 0;
    groups.forEach(function (surfaces) {
      var closed = surfaces.every(function (s) {
        return (s.loops || []).length === 0 ? s.closed === true :
          (surfKeys.get(s.id) || []).length > 0 && (surfKeys.get(s.id) || []).every(function (k) { return (usage.get(k) || []).length === 2; });
      });
      if (closed) closedShells++; else openSurfaces++;
    });
    return {usage:usage, groups:groups, openBoundaries:openBoundaries,
      nonmanifoldBoundaries:nonmanifoldBoundaries, closedShells:closedShells, openSurfaces:openSurfaces};
  }

  function validate(model, geometry) {
    if (!model) return null;
    var issues = [], curves = geometry && geometry.curves || [];
    function add(code, message, sourceIds) { issues.push({code:code, message:message, sourceIds:sourceIds || []}); }
    (model.diagnostics || []).forEach(function (d) { issues.push(d); });
    (model.surfaces || []).forEach(function (s) {
      if (!finite(s.origin) && s.kind !== 'sphere') add('surface-invalid-origin', 'Surface ' + s.id + ' has no finite origin.', s.sourceIds);
      if (s.kind === 'cylinder' || s.kind === 'cone' || s.kind === 'sphere') {
        if (!Number.isFinite(s.radius) || !(s.radius > 0)) add('surface-invalid-radius', 'Surface ' + s.id + ' needs a positive radius.', s.sourceIds);
      }
      if (s.kind === 'cylinder' || s.kind === 'cone') {
        if (!finite(s.axis) || Math.abs(length(s.axis)-1) > EPS) add('surface-invalid-axis', 'Surface ' + s.id + ' needs a unit axis.', s.sourceIds);
      }
      if (s.kind === 'sphere' && s.cap) {
        if (!finite(s.cap.pole) || Math.abs(length(s.cap.pole)-1) > EPS ||
            !Number.isFinite(s.cap.angle) || !(s.cap.angle > 0) || !(s.cap.angle < Math.PI)) {
          add('surface-invalid-cap', 'Surface ' + s.id + ' has an invalid spherical-cap pole or angle.', s.sourceIds);
        } else if (s.cap.mouth && finite(s.cap.mouth.origin) && finite(s.cap.mouth.normal) &&
                   Math.abs(length(s.cap.mouth.normal)-1) > EPS) {
          add('surface-invalid-cap', 'Surface ' + s.id + ' has an invalid cap mouth plane.', s.sourceIds);
        } else if (s.cap.mouth) {
          var capTol = 1e-5 * Math.max(1, s.radius || 1);
          var capAxis = mul(s.cap.pole, -1);
          var capDistance = dot(sub(s.cap.mouth.origin, s.center), s.cap.pole);
          if (Math.abs(dot(s.cap.mouth.normal, capAxis) - 1) > 1e-7 ||
              Math.abs(capDistance - s.radius * Math.cos(s.cap.angle)) > capTol)
            add('surface-cap-mismatch', 'Surface ' + s.id + ' cap plane does not match its pole and angle.', s.sourceIds);
          (s.loops || []).forEach(function (loop) {
            loopCurves(loop, curves).forEach(function (c) {
              if (!validCurve(c)) return;
              var ca = radii(c).u;
              if (Math.abs(length(sub(c.center, s.cap.mouth.origin))) > capTol ||
                  Math.abs(ca - (s.radius || 0) * Math.sin(s.cap.angle)) > capTol)
                add('surface-cap-mismatch', 'Surface ' + s.id + ' cap boundary does not match the mouth circle.', s.sourceIds);
            });
          });
        }
      }
      var tol = 1e-5 * Math.max(1, s.radius || 1);
      // Boundary curves must lie on their analytic surface.
      (s.loops || []).forEach(function (loop) {
        if (loop.vertices && s.kind === 'plane') loop.vertices.forEach(function (i) {
          var p = geometry && geometry.vertices && geometry.vertices[i];
          if (p && Math.abs(dot(sub(p, s.origin), s.normal)) > tol)
            add('surface-boundary-off-surface', 'A plane boundary vertex is off ' + s.id + '.', s.sourceIds);
        });
        loopCurves(loop, curves).forEach(function (c) {
          if (!validCurve(c)) { add('surface-boundary-missing', 'Surface ' + s.id + ' references a missing boundary curve.', s.sourceIds); return; }
          for (var k=0;k<8;k++) {
            var p = curvePoint(c, (c.startAngle === undefined ? 0 : c.startAngle) + (c.sweepAngle === undefined ? TAU : c.sweepAngle)*k/8), ok = true;
            if (s.kind === 'cylinder') {
              var d = sub(p, s.origin), axial = dot(d, unit(s.axis));
              var radial = Math.sqrt(Math.max(0, dot(d,d) - axial*axial));
              ok = Math.abs(radial - s.radius) <= tol;
            } else if (s.kind === 'cone') {
              var apex = s.apex || s.origin, dc = sub(p, apex), ac = dot(dc, unit(s.axis));
              var rc = Math.sqrt(Math.max(0, dot(dc,dc) - ac*ac));
              ok = Number.isFinite(s.halfAngle) && Math.abs(rc - Math.abs(ac)*Math.tan(s.halfAngle)) <= tol;
            } else if (s.kind === 'plane') {
              ok = Math.abs(dot(sub(p, s.origin), s.normal)) <= tol;
            } else if (s.kind === 'sphere') {
              ok = Math.abs(length(sub(p, s.center)) - s.radius) <= tol;
            }
            if (!ok) { add('surface-boundary-off-surface', 'A boundary curve does not lie on ' + s.id + '.', s.sourceIds); break; }
          }
          // The boundary plane must recover the same section from the surface.
          if (s.kind === 'cylinder') {
            var sec = section(s, {origin:c.center, normal:curveNormal(c)});
            if (!sec || (sec.kind !== 'circle' && sec.kind !== 'ellipse')) {
              add('surface-section-mismatch', 'The boundary plane does not section ' + s.id + ' in its drawn boundary.', s.sourceIds);
            } else {
              var ra = radii(c), sa = [sec.radiusU === undefined ? sec.radius : sec.radiusU, sec.radiusV === undefined ? sec.radius : sec.radiusV];
              var ca = [ra.u, ra.v].sort(function (a,b) { return a-b; }), cb = sa.sort(function (a,b) { return a-b; });
              if (length(sub(sec.center, c.center)) > tol || Math.abs(ca[0]-cb[0]) > tol || Math.abs(ca[1]-cb[1]) > tol)
                add('surface-section-mismatch', 'The section through ' + s.id + ' does not match its drawn boundary.', s.sourceIds);
            }
          }
        });
      });
    });
    var analysis = analyze(model);
    if (analysis.nonmanifoldBoundaries) issues.push({code:'surface-boundary-nonmanifold',
      message:'A boundary is shared by more than two surfaces.', count:analysis.nonmanifoldBoundaries});
    return {contract:'analytic-surface-v1', status:issues.length ? 'issues' : analysis.openBoundaries ? 'partial' : 'ok',
      closedShells:analysis.closedShells, openSurfaces:analysis.openSurfaces,
      openBoundaries:analysis.openBoundaries, nonmanifoldBoundaries:analysis.nonmanifoldBoundaries,
      surfaces:(model.surfaces || []).length, issues:issues};
  }

  function summarize(model) {
    var byKind = {}, loops = 0;
    (model.surfaces || []).forEach(function (s) {
      byKind[s.kind] = (byKind[s.kind] || 0) + 1;
      loops += (s.loops || []).length;
    });
    var analysis = analyze(model);
    return {total:(model.surfaces || []).length, byKind:byKind, boundaryLoops:loops,
      closedShells:analysis.closedShells, openSurfaces:analysis.openSurfaces,
      openBoundaries:analysis.openBoundaries, status:analysis.openBoundaries ? 'partial' : 'ok'};
  }

  // Analytic section of a bounded surface by a plane. The result is a conic
  // or line set in space; it is independent of the display tessellation.
  function section(surface, plane) {
    var spec = planeSpec(plane), q = spec && spec.origin, n = spec && spec.normal;
    if (!surface || !spec) return null;
    if (surface.kind === 'plane') {
      var sn = unit(surface.normal), direction = cross(sn, n);
      var denominator = dot(direction, direction);
      if (denominator < EPS*EPS) {
        return Math.abs(dot(n, sub(surface.origin, q))) < EPS ?
          {kind:'plane-overlap', surfaceId:surface.id} : null;
      }
      // Move within the source plane along the cutting normal's projection.
      var tangent = cross(direction, sn);
      var origin = add(surface.origin, mul(tangent, dot(n, sub(q, surface.origin))/denominator));
      return {kind:'line', origin:origin, direction:unit(direction),
        surfaceId:surface.id, sectionType:'plane-plane'};
    }
    if (surface.kind === 'sphere') {
      var d = dot(sub(surface.center, q), n);
      var foot = sub(surface.center, mul(n, d));
      var rho2 = surface.radius*surface.radius - d*d;
      if (rho2 < -EPS) return null;
      var rho = Math.sqrt(Math.max(0, rho2));
      if (rho < EPS) return {kind:'point', point:foot, surfaceId:surface.id, sectionType:'tangent'};
      var sb = basis(n);
      return {kind:'circle', center:foot, u:sb.u, v:sb.v, radius:rho,
        sourceIds:(surface.sourceIds || []).slice(), surfaceId:surface.id, sectionType:'plane-sphere'};
    }
    if (surface.kind === 'cylinder') {
      var a = unit(surface.axis), o = surface.origin, r = surface.radius;
      var ca = dot(n, a), D = dot(n, sub(q, o));
      if (Math.abs(ca) < EPS) {
        var e = unit(sub(n, mul(a, ca)));
        var dist = dot(sub(q, o), e);
        var inside = r*r - dist*dist;
        if (inside < -EPS) return null;
        var w = unit(cross(a, e));
        if (inside <= EPS) {
          return {kind:'line', origin:add(o, mul(e, dist)), direction:a,
            surfaceId:surface.id, sectionType:'plane-cylinder-tangent'};
        }
        var half = Math.sqrt(inside);
        return {kind:'lines', lines:[
          {origin:add(add(o, mul(e, dist)), mul(w, half)), direction:a},
          {origin:add(add(o, mul(e, dist)), mul(w, -half)), direction:a}
        ], surfaceId:surface.id, sectionType:'plane-cylinder-parallel'};
      }
      var s0 = D / ca;
      var center = add(o, mul(a, s0));
      if (Math.sqrt(Math.max(0, 1 - ca*ca)) < EPS) {
        var cb = basis(a);
        return {kind:'circle', center:center, u:cb.u, v:cb.v, radius:r,
          sourceIds:(surface.sourceIds || []).slice(), surfaceId:surface.id, sectionType:'plane-cylinder-circle'};
      }
      var beta = Math.sqrt(Math.max(0, 1 - ca*ca));
      var e2 = unit(sub(n, mul(a, ca)));
      var major = unit(sub(e2, mul(a, beta / ca)));
      var w2 = unit(cross(a, e2));
      return {kind:'ellipse', center:center, u:major, v:w2,
        radiusU:r / Math.abs(ca), radiusV:r,
        sourceIds:(surface.sourceIds || []).slice(), surfaceId:surface.id,
        sectionType:'plane-cylinder-ellipse'};
    }
    if (surface.kind === 'cone') {
      var apex = surface.apex || surface.origin;
      var axis = unit(surface.axis), halfAngle = surface.halfAngle;
      if (!Number.isFinite(halfAngle)) return null;
      var ac = dot(n, axis), Dc = dot(n, sub(q, apex));
      if (Math.abs(Math.abs(ac) - 1) < EPS) {
        var t0 = Dc / ac;
        // The support is the same double cone used by boundary validation.
        // Boundary loops, rather than axis sign, select the bounded patch.
        var radius = Math.abs(t0) * Math.tan(halfAngle);
        if (radius < EPS) return {kind:'point', point:add(apex, mul(axis, t0)),
          sourceIds:(surface.sourceIds || []).slice(), surfaceId:surface.id, sectionType:'plane-cone-apex'};
        var cb2 = basis(axis);
        return {kind:'circle', center:add(apex, mul(axis, t0)), u:cb2.u, v:cb2.v,
          radius:radius, sourceIds:(surface.sourceIds || []).slice(), surfaceId:surface.id,
          sectionType:'plane-cone-circle'};
      }
      var discriminant = Math.abs(ac) - Math.sin(halfAngle);
      var conicType = Math.abs(discriminant) <= 1e-6 ? 'parabola' : discriminant > 0 ? 'ellipse' : 'hyperbola';
      return {kind:'conic', conicType:conicType, apex:apex, axis:axis, halfAngle:halfAngle,
        plane:spec, surfaceId:surface.id, sectionType:'plane-cone-' + conicType};
    }
    return null;
  }

  // Surface–surface intersections. Only exact analytic families are handled:
  // plane/plane, plane/quadric (through section), sphere/sphere,
  // parallel-axis cylinder/cylinder, and a sphere with a cylinder whose axis
  // passes through the sphere centre. A supported pair always returns a
  // result; `kind:'none'` means the supporting surfaces miss. An unsupported
  // pair returns null rather than a sampled or approximate curve.
  function tolerance(values) {
    var scale = 1;
    values.forEach(function (v) {
      if (Number.isFinite(v)) scale = Math.max(scale, Math.abs(v));
    });
    return 1e-6 * scale;
  }
  function copyFields(source) {
    var out = {};
    Object.keys(source || {}).forEach(function (k) { out[k] = source[k]; });
    return out;
  }
  function none(reason, extra) {
    var result = {kind:'none', relation:'none', reason:reason};
    Object.keys(extra || {}).forEach(function (k) { result[k] = extra[k]; });
    return result;
  }
  function tagged(result, a, b) {
    result.surfaceIds = [a.id === undefined ? null : a.id, b.id === undefined ? null : b.id];
    result.surfaceKinds = [a.kind, b.kind];
    if (result.kind === 'point') result.degenerate = true;
    return result;
  }

  function planePlane(a, b) {
    var pa = planeSpec(a), pb = planeSpec(b);
    if (!pa || !pb) return null;
    var direction = cross(pa.normal, pb.normal);
    var tol = tolerance([length(pa.origin), length(pb.origin)]);
    if (length(direction) <= EPS) {
      var distance = Math.abs(dot(pa.normal, sub(pb.origin, pa.origin)));
      if (distance <= tol) return {kind:'plane-overlap', relation:'coincident',
        plane:{origin:pa.origin, normal:pa.normal}};
      return none('parallel', {distance:distance});
    }
    var cut = section(a, b);
    return {kind:'line', relation:'transverse', origin:cut.origin, direction:cut.direction};
  }

  // A plane section is already the exact intersection of one plane with one
  // quadric. Reuse it, adding the pair identity and the relation.
  function planeQuadric(plane, surface) {
    var cut = section(surface, plane);
    if (!cut) return none('no-section');
    var result = copyFields(cut);
    if (cut.kind === 'point') result.relation = cut.sectionType === 'tangent' ? 'tangent' : 'degenerate';
    else if (/tangent/.test(cut.sectionType || '')) result.relation = 'tangent';
    else result.relation = 'transverse';
    return result;
  }

  function sphereSphere(a, b) {
    var delta = sub(b.center, a.center), d = length(delta);
    var r1 = a.radius, r2 = b.radius;
    var tol = tolerance([r1, r2, d]);
    if (d <= tol) {
      if (Math.abs(r1 - r2) <= tol) return {kind:'coincident', relation:'coincident',
        center:a.center, radius:r1};
      return none('concentric', {distance:d});
    }
    var e = mul(delta, 1/d);
    if (d > r1 + r2 + tol) return none('separate', {distance:d, gap:d - r1 - r2});
    if (d < Math.abs(r1 - r2) - tol) return none('contained', {distance:d});
    var h = (d*d + r1*r1 - r2*r2) / (2*d);
    var rho2 = r1*r1 - h*h;
    if (rho2 <= tol*tol) {
      // External tangency touches between the centres; internal tangency
      // touches on the far side of the smaller sphere.
      var point;
      if (Math.abs(d - r1 - r2) <= Math.abs(d - Math.abs(r1 - r2))) {
        point = add(a.center, mul(e, r1));
        return {kind:'point', relation:'tangent', tangent:'external', point:point};
      }
      point = add(a.center, mul(e, r1 >= r2 ? r1 : -r1));
      return {kind:'point', relation:'tangent', tangent:'internal', point:point};
    }
    var b2 = basis(e);
    return {kind:'circle', relation:'transverse', center:add(a.center, mul(e, h)),
      u:b2.u, v:b2.v, radius:Math.sqrt(rho2)};
  }

  // Parallel/coaxial cylinders intersect in zero, one or two lines. Skew and
  // intersecting-axis cylinders (a quartic curve) are not approximated.
  function cylinderCylinder(a, b) {
    var axis = unit(a.axis), otherAxis = unit(b.axis);
    if (length(cross(axis, otherAxis)) > 1e-7) return null;
    var delta = sub(b.origin, a.origin);
    var perp = sub(delta, mul(axis, dot(delta, axis)));
    var p = length(perp);
    var r1 = a.radius, r2 = b.radius;
    var tol = tolerance([r1, r2, p]);
    if (p <= tol) {
      if (Math.abs(r1 - r2) <= tol) return {kind:'coincident', relation:'coincident',
        origin:a.origin, axis:axis, radius:r1};
      return none('coaxial', {distance:p});
    }
    if (p > r1 + r2 + tol) return none('separate', {distance:p, gap:p - r1 - r2});
    if (p < Math.abs(r1 - r2) - tol) return none('contained', {distance:p});
    var e = mul(perp, 1/p);
    var h = (p*p + r1*r1 - r2*r2) / (2*p);
    var s2 = r1*r1 - h*h;
    var origin = add(a.origin, mul(e, h));
    if (s2 <= tol*tol) {
      return {kind:'line', relation:'tangent',
        tangent:p >= r1 + r2 - tol ? 'external' : 'internal',
        origin:origin, direction:axis};
    }
    var s = Math.sqrt(s2), w = unit(cross(axis, e));
    return {kind:'lines', relation:'transverse', lines:[
      {origin:add(origin, mul(w, s)), direction:axis},
      {origin:add(origin, mul(w, -s)), direction:axis}
    ]};
  }

  // Exact sphere/cylinder case: the cylinder axis passes through the sphere
  // centre, so both are surfaces of revolution about that axis. The general
  // offset-axis case is a quartic space curve and stays unsupported.
  function sphereCylinder(sphere, cylinder) {
    var axis = unit(cylinder.axis);
    var delta = sub(sphere.center, cylinder.origin);
    var axial = dot(delta, axis);
    var offset = length(sub(delta, mul(axis, axial)));
    var tol = tolerance([sphere.radius, cylinder.radius, offset]);
    if (offset > tol) {
      // An offset axis is a quartic curve, but the clearly disjoint cases are
      // still decidable from the radial distance range of the sphere.
      var gap = offset - cylinder.radius - sphere.radius;
      if (gap > tol) return none('separate', {distance:offset, gap:gap});
      if (offset + sphere.radius < cylinder.radius - tol) return none('contained', {distance:offset});
      return null;
    }
    var center = add(cylinder.origin, mul(axis, axial));
    var h2 = sphere.radius*sphere.radius - cylinder.radius*cylinder.radius;
    if (h2 < -tol*tol) return none('contained', {distance:offset});
    var b = basis(axis);
    if (Math.abs(h2) <= tol*tol) {
      return {kind:'circle', relation:'tangent', center:center,
        u:b.u, v:b.v, radius:cylinder.radius};
    }
    var h = Math.sqrt(h2);
    return {kind:'circles', relation:'transverse', circles:[
      {center:add(center, mul(axis, h)), u:b.u, v:b.v, radius:cylinder.radius},
      {center:add(center, mul(axis, -h)), u:b.u, v:b.v, radius:cylinder.radius}
    ]};
  }

  function intersect(a, b) {
    if (!a || !b || !a.kind || !b.kind) return null;
    var result;
    if (a.kind === 'plane' && b.kind === 'plane') result = planePlane(a, b);
    else if (a.kind === 'plane') result = planeQuadric(a, b);
    else if (b.kind === 'plane') result = planeQuadric(b, a);
    else if (a.kind === 'sphere' && b.kind === 'sphere') result = sphereSphere(a, b);
    else if (a.kind === 'cylinder' && b.kind === 'cylinder') result = cylinderCylinder(a, b);
    else if (a.kind === 'sphere' && b.kind === 'cylinder') result = sphereCylinder(a, b);
    else if (a.kind === 'cylinder' && b.kind === 'sphere') result = sphereCylinder(b, a);
    else return null;
    return result && tagged(result, a, b);
  }

  function loopSide(loop, spec, curves, vertices) {
    var distances = [], invalid = false;
    function distance(p) { return dot(spec.normal, sub(p, spec.origin)); }
    (loop.vertices || []).forEach(function(i) {
      if (!vertices || !finite(vertices[i])) invalid = true;
      else distances.push(distance(vertices[i]));
    });
    loopCurves(loop, curves).forEach(function(c) {
      if (!validCurve(c)) { invalid = true; return; }
      // Signed distance is A cos(t) + B sin(t) + C. Its extrema, together
      // with arc endpoints, decide the side exactly (no sampling blind spots).
      var r = radii(c), A = dot(spec.normal, c.u)*r.u, B = dot(spec.normal, c.v)*r.v;
      var start = c.startAngle === undefined ? 0 : c.startAngle;
      var sweep = c.sweepAngle === undefined ? TAU : c.sweepAngle;
      var angles = [start, start+sweep], critical = Math.atan2(B, A);
      [critical, critical+Math.PI].forEach(function(t) {
        var offset = ((t-start)%TAU+TAU)%TAU;
        if (offset <= sweep+EPS) angles.push(start+offset);
      });
      angles.forEach(function(t) { distances.push(distance(curvePoint(c,t))); });
    });
    if (invalid || !distances.length) return 2;
    var pos = distances.some(function(d) { return d > EPS; });
    var neg = distances.some(function(d) { return d < -EPS; });
    return pos && neg ? 2 : pos ? 1 : neg ? -1 : 0;
  }

  // Replace boundary loops on the discarded side by the analytic section.
  // Loops that cross the cutting plane are reported unsupported instead of guessed.
  function trim(surface, plane, keepPositive, geometry) {
    if (!surface || surface.kind === 'plane') return null;
    var spec = planeSpec(plane);
    if (!spec) return null;
    var cut = section(surface, spec);
    if (!cut || (cut.kind !== 'circle' && cut.kind !== 'ellipse')) return null;
    var curves = geometry && geometry.curves || [];
    var vertices = geometry && geometry.vertices || [];
    var keep = keepPositive === false ? -1 : 1;
    var kept = [], unsupported = false;
    (surface.loops || []).forEach(function (loop) {
      var side = loopSide(loop, spec, curves, vertices);
      if (side === 2) { unsupported = true; return; }
      if (side === keep) kept.push(loop);
    });
    if (unsupported) return null;
    kept.push({kind:'outer', section:cut});
    var out = {};
    Object.keys(surface).forEach(function (k) { out[k] = surface[k]; });
    out.id = (surface.id || 'surface') + '/trim';
    out.loops = kept;
    out.closed = false;
    out.cut = cut;
    out.trimmedBy = {plane:{origin:spec.origin, normal:spec.normal}, keepPositive:keep === 1};
    out.sourceIds = Array.from(new Set((surface.sourceIds || []).concat(cut.sourceIds || [])));
    return out;
  }

  return {
    build:build,
    validate:validate,
    summarize:summarize,
    section:section,
    intersect:intersect,
    trim:trim,
    planeSpec:planeSpec,
    point:curvePoint,
    radii:radii,
    curveNormal:curveNormal
  };
});

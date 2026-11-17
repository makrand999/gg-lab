(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports =
    factory(require('./educad-planar.js'), require('./educad-implicit.js'));
  else root.EduCADSurfaces = factory(root.EduCADPlanar, root.EduCADImplicit);
})(typeof window !== 'undefined' ? window : globalThis, function (Planar, Implicit) {
  'use strict';






  var EPS = 1e-7, TAU = 2 * Math.PI;
  var TOLERANCE_CONTRACT = 'edu-tolerance-v1';
  var TOLERANCE = {absLength:1e-7, relLength:1e-6, numericAngle:1e-9,
    nearParallelAngle:1e-6, exactRelLength:1e-9};

  function scaleOf(values) {
    var scale = 1;
    (values || []).forEach(function (v) {
      if (Number.isFinite(v)) scale = Math.max(scale, Math.abs(v));
    });
    return scale;
  }



  function tolerancePolicy(values) {
    var scale = scaleOf(values);
    return {contract:TOLERANCE_CONTRACT, scale:scale,
      length:Math.max(TOLERANCE.absLength, TOLERANCE.relLength*scale),
      exactLength:Math.max(Number.EPSILON*32*scale, TOLERANCE.exactRelLength*scale),
      angle:TOLERANCE.numericAngle, nearParallel:TOLERANCE.nearParallelAngle};
  }
  function gapClass(gap, policy) {
    var g = Math.abs(gap);
    if (g <= policy.exactLength) return {status:'exact', gap:0, signedGap:0};
    if (g <= policy.length) return {status:'near', gap:g, signedGap:gap};
    return {status:'separate', gap:g, signedGap:gap};
  }
  function nearResult(result, cls, policy, relation) {
    result.relation = relation;
    result.gap = cls.gap;
    result.signedGap = cls.signedGap;
    result.tolerance = policy.length;
    result.guarantee = 'numeric';
    result.nearDegenerate = true;
    return result;
  }

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
  function unitOrNull(v) {
    var l = length(v);
    return l > EPS ? {x:v.x/l, y:v.y/l, z:v.z/l} : null;
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
  function torusContourPoint(c, t) {
    var axis = unit(c.axis), e1 = unit(c.u), e2 = unit(c.v);
    var view = unit(c.viewDirection);
    var A = dot(e1, view), B = dot(e2, view), D = dot(axis, view);
    var W = A * Math.cos(t) + B * Math.sin(t);
    var phi = Math.atan2(D, W);
    var v = phi + (c.branch < 0 ? -0.5 : 0.5) * Math.PI;
    var radial = c.majorRadius + c.minorRadius * Math.cos(v);
    var cs = Math.cos(t) * radial, sn = Math.sin(t) * radial;
    var axial = c.minorRadius * Math.sin(v);
    return {x:c.center.x + e1.x*cs + e2.x*sn + axis.x*axial,
      y:c.center.y + e1.y*cs + e2.y*sn + axis.y*axial,
      z:c.center.z + e1.z*cs + e2.z*sn + axis.z*axial};
  }
  function torusSectionPoint(c, t) {
    var W = c.A * Math.cos(t) + c.B * Math.sin(t);
    var M = Math.hypot(W, c.D);
    if (M <= EPS) return null;
    var R = c.majorRadius, r = c.minorRadius;
    var K = (c.E - R * W) / r;
    var ratio = Math.max(-1, Math.min(1, K / M));
    if (ratio > 1 - 1e-9) ratio = 1;
    else if (ratio < -1 + 1e-9) ratio = -1;
    var phi = Math.atan2(c.D, W);
    var v = phi + c.branch * Math.acos(ratio);
    var radial = R + r * Math.cos(v), axial = r * Math.sin(v);
    var cs = Math.cos(t) * radial, sn = Math.sin(t) * radial;
    return {x:c.center.x + c.frameU.x*cs + c.frameV.x*sn + c.axis.x*axial,
      y:c.center.y + c.frameU.y*cs + c.frameV.y*sn + c.axis.y*axial,
      z:c.center.z + c.frameU.z*cs + c.frameV.z*sn + c.axis.z*axial};
  }
  function torusSpherePoint(c, t) {
    var W = c.A * Math.cos(t) + c.B * Math.sin(t);
    var coeffA = 2 * c.minorRadius * (c.majorRadius + W);
    var coeffB = 2 * c.minorRadius * c.dA;
    var N = c.N0 - 2 * c.majorRadius * W;
    var M = Math.hypot(coeffA, coeffB);
    if (M <= EPS) return null;
    var ratio = Math.max(-1, Math.min(1, N / M));
    if (ratio > 1 - 1e-9) ratio = 1;
    else if (ratio < -1 + 1e-9) ratio = -1;
    var psi = Math.atan2(coeffB, coeffA);
    var v = psi + c.branch * Math.acos(ratio);
    var radial = c.majorRadius + c.minorRadius * Math.cos(v);
    var axial = c.minorRadius * Math.sin(v);
    var cs = Math.cos(t) * radial, sn = Math.sin(t) * radial;
    return {x:c.center.x + c.frameU.x*cs + c.frameV.x*sn + c.axis.x*axial,
      y:c.center.y + c.frameU.y*cs + c.frameV.y*sn + c.axis.y*axial,
      z:c.center.z + c.frameU.z*cs + c.frameV.z*sn + c.axis.z*axial};
  }
  function curvePoint(c, t) {
    if (c.kind === 'torusContour') return torusContourPoint(c, t);
    if (c.kind === 'torusSectionBranch') {
      var point = torusSectionPoint(c, t);
      if (point) return point;
    }
    if (c.kind === 'torusSphereBranch') {
      var spherePoint = torusSpherePoint(c, t);
      if (spherePoint) return spherePoint;
    }
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




  var boundarySerial = 0;
  function boundaryElementId(element, prefix) {
    if (!element || typeof element !== 'object') return null;
    if (typeof element.id === 'string' && element.id !== '') return element.id;
    element.id = (prefix || element.kind || 'boundary') + ':' + (++boundarySerial);
    return element.id;
  }
  function stampLoopIdentity(loop) {
    if (!loop || typeof loop !== 'object') return;
    if (loop.section) boundaryElementId(loop.section, 'section');
    (loop.lines || []).forEach(function (line) { boundaryElementId(line, 'line'); });
    (loop.curves || []).forEach(function (curve) {
      if (curve && typeof curve === 'object') boundaryElementId(curve, 'curve');
    });
    (loop.elements || []).forEach(function (element) {
      if (!element || element.kind !== 'curve' || !element.curve) return;
      boundaryElementId(element.curve, element.curve.parentKind ? 'arc' : 'curve');
    });
  }
  function stampModelIdentity(model) {
    (model.surfaces || []).forEach(function (surface) {
      (surface.loops || []).forEach(stampLoopIdentity);
    });
    return model;
  }





  function validLine(l) {
    return l && l.kind === 'line' && finite(l.start) && finite(l.end) &&
      length(sub(l.end, l.start)) > EPS;
  }
  function finiteLine(l) {
    return !!(l && l.kind === 'line' && finite(l.start) && finite(l.end));
  }
  function linePoint(l, t) {
    return add(l.start, mul(sub(l.end, l.start), t));
  }
  function lineLength(l) {
    return validLine(l) ? length(sub(l.end, l.start)) : 0;
  }




  function planarBoolean(faceA, faceB, operation, geometry) {
    function refuse(code, message) {
      return {ok:false, contract:'planar-boolean-v1', operation:operation,
        loops:[], area:0, cells:[], diagnostics:[{code:code, severity:'warning', message:message}]};
    }
    if (!Planar || typeof Planar.booleanRegion !== 'function')
      return refuse('planar-module-missing', 'Load educad-planar.js before educad-surfaces.js.');
    if (!faceA || !faceB || faceA.kind !== 'plane' || faceB.kind !== 'plane')
      return refuse('planar-face-kind', 'Both operands must be planar faces.');
    var normalA = unit(faceA.normal), normalB = unit(faceB.normal);
    if (length(cross(normalA, normalB)) > 1e-7)
      return refuse('planar-faces-not-parallel', 'Both faces must be coplanar.');
    var tolerance = Math.max(surfaceTolerance(faceA), surfaceTolerance(faceB));
    var frame = planeBasis(faceA);
    var origin = faceA.origin;
    function project(p) {
      var d = sub(p, origin);
      return {x:dot(d, frame.u), y:dot(d, frame.v)};
    }
    function unproject(p) {
      return add(origin, add(mul(frame.u, p.x), mul(frame.v, p.y)));
    }
    function regionOf(face) {
      var loops = [];
      var items = face.loops || [];
      if (!items.length) return {error:'planar-face-unbounded'};
      for (var i=0;i<items.length;i++) {
        var polygon = loopPolygon(items[i], geometry && geometry.curves || [],
          geometry && geometry.vertices || [], tolerance);
        if (!polygon) return null;
        for (var k=0;k<polygon.length;k++) {
          if (Math.abs(dot(sub(polygon[k], origin), normalA)) > tolerance * 4)
            return {error:'planar-faces-not-coplanar'};
        }
        loops.push({role:items[i].kind === 'inner' ? 'inner' : 'outer',
          points:polygon.map(project)});
      }
      return {loops:loops};
    }
    var regionA = regionOf(faceA), regionB = regionOf(faceB);
    if (!regionA || regionA.error) return refuse(regionA && regionA.error || 'planar-loop-unsupported',
      'A face boundary is not a closed straight loop on the plane.');
    if (!regionB || regionB.error) return refuse(regionB && regionB.error || 'planar-loop-unsupported',
      'A face boundary is not a closed straight loop on the plane.');
    var result;
    try { result = Planar.booleanRegion(regionA, regionB, operation); }
    catch (err) { return refuse('planar-boolean-failed', err && err.message || String(err)); }
    return {ok:result.ok, contract:'planar-boolean-v1', operation:operation,
      loops:result.loops.map(function (loop) {
        return {role:loop.role, area:loop.area, points:loop.points.map(unproject)};
      }),
      area:result.area, cells:result.cells.map(function (cell) {
        return {area:cell.area, selected:cell.selected, insideA:cell.insideA,
          insideB:cell.insideB, points:cell.points.map(unproject),
          holes:(cell.holes || []).map(function (hole) { return hole.map(unproject); })};
      }),
      tolerance:result.tolerance, diagnostics:result.diagnostics};
  }





  function subtractContainedLoop(surface, loop, geometry) {
    function refuse(code, message) {
      return {ok:false, surface:null, innerLoop:null,
        diagnostics:[{code:code, severity:'warning', message:message}]};
    }
    if (!surface || surface.kind !== 'plane')
      return refuse('planar-face-kind', 'subtractContainedLoop needs a planar face.');
    var curve = loop && loop.kind === 'curve' && loop.curve ? loop.curve : loop;
    if (!curve || !validCurve(curve) || curveSweep(curve) < TAU - 1e-9)
      return refuse('planar-loop-not-closed',
        'The subtracted boundary must be one full analytic circle or ellipse.');
    var loops = surface.loops || [];
    var already = loops.some(function (item) {
      return item.section === curve || (item.curves || []).some(function (c) {
        return (typeof c === 'object' ? c : (geometry && geometry.curves || [])[c]) === curve;
      });
    });
    if (already) return refuse('planar-loop-duplicate',
      'The face already uses this boundary curve.');
    for (var i = 0; i < 24; i++) {
      var state = classifyPoint(surface, curvePoint(curve, TAU * i / 24), geometry || {});
      if (state.status === 'unknown')
        return refuse('planar-loop-unknown', 'The face could not classify the subtracted loop.');
      if (state.status === 'boundary')
        return refuse('planar-loop-on-boundary',
          'The subtracted loop lies on the face boundary.');
      if (state.status !== 'inside')
        return refuse('planar-loop-not-contained',
          'The subtracted loop is not wholly inside the face.');
    }
    var out = copyFields(surface);
    out.id = (surface.id || 'plane') + '/subtract';
    out.loops = loops.slice();
    var curveIndex = geometry && geometry.curves ? geometry.curves.indexOf(curve) : -1;
    var inner = curveIndex >= 0 ? {kind:'inner', curves:[curveIndex]} : {kind:'inner', section:curve};
    out.loops.push(inner);
    out.closed = false;
    out.subtractedBy = curve.id || null;
    return {ok:true, surface:out, innerLoop:inner, diagnostics:[]};
  }





  function mergeUnionMouths(model, geometry) {
    var curves = geometry && geometry.curves || [];
    var hosts = (model.surfaces || []).filter(function (s) {
      return s.kind === 'plane' && !s.recessMouth && !s.recessBottom &&
        !s.closed && (s.loops || []).length;
    });
    var merged = 0;
    curves.forEach(function (curve, curveIndex) {
      if (!curve || !curve.unionMouth || !curve.recessMouth) return;
      var points = (curve.displayVertices || []).map(function (index) {
        return geometry.vertices && geometry.vertices[index];
      }).filter(finite);
      if (points.length < 3) return;
      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        if (!finite(host.origin) || !finite(host.normal)) continue;
        var tolerance = surfaceTolerance(host);
        var coplanar = points.every(function (p) {
          return Math.abs(dot(sub(p, host.origin), host.normal)) <= tolerance;
        });
        if (!coplanar) continue;
        var inside = points.every(function (p) {
          var state = classifyPoint(host, p, geometry);
          return state.status === 'inside';
        });
        if (!inside) continue;
        host.loops.push({kind:'inner', points:points.map(function (p) {
          return {x:p.x, y:p.y, z:p.z};
        })});
        host.bounded = true;
        host.unionMouth = true;
        curve.hostSurfaceId = host.id;
        (geometry.recesses || []).forEach(function (record) {
          if (record.mouthCurve === curveIndex) {
            record.closure = 'host';
            record.hostMouth = true;
          }
        });
        merged++;
        break;
      }
    });
    return {merged:merged};
  }

  function mergeContainedMouths(model, geometry) {
    var removed = new Set();
    var hosts = (model.surfaces || []).filter(function (s) {
      return s.kind === 'plane' && !s.recessMouth && !s.recessBottom &&
        !s.closed && (s.loops || []).length;
    });
    (model.surfaces || []).forEach(function (mouth) {
      if (mouth.kind !== 'plane' || !mouth.recessMouth) return;
      var curve = null;
      (mouth.loops || []).some(function (loop) {
        var candidate = loop.section;
        if (!candidate && loop.curves && loop.curves.length)
          candidate = typeof loop.curves[0] === 'object' ? loop.curves[0]
            : (geometry.curves || [])[loop.curves[0]];
        if (candidate && validCurve(candidate) &&
            curveSweep(candidate) >= TAU - 1e-9) { curve = candidate; return true; }
        return false;
      });
      if (!curve) return;
      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        var already = (host.loops || []).some(function (loop) {
          return loop.kind === 'inner' && (loop.section === curve ||
            (loop.curves || []).some(function (c) {
              return (typeof c === 'object' ? c : (geometry.curves || [])[c]) === curve;
            }));
        });
        if (!already) {
          var contained = true;
          for (var k = 0; k < 24; k++) {
            var state = classifyPoint(host, curvePoint(curve, TAU * k / 24), geometry);
            if (state.status !== 'inside' && state.status !== 'boundary') { contained = false; break; }
          }
          if (!contained) continue;
          var curveIndex = (geometry.curves || []).indexOf(curve);
          if (curveIndex >= 0) host.loops.push({kind:'inner', curves:[curveIndex]});
          else host.loops.push({kind:'inner', section:curve});
        }
        (geometry.recesses || []).forEach(function (record) {
          if (record && record.mouthCurve === (geometry.curves || []).indexOf(curve)) {
            record.closure = 'host';
            record.hostMouth = true;
          }
        });
        host.bounded = true;
        removed.add(mouth);
        mouth.mergedInto = host.id;
        return;
      }
    });
    if (removed.size)
      model.surfaces = model.surfaces.filter(function (s) { return !removed.has(s); });
    return {merged:removed.size};
  }

  function canonicalLoopKey(loop) {
    var n = (loop || []).length;
    if (!n) return '';
    var best = null;
    [loop, loop.slice().reverse()].forEach(function (sequence) {
      for (var start = 0; start < n; start++) {
        var key = sequence.slice(start).concat(sequence.slice(0, start)).join(',');
        if (best === null || key < best) best = key;
      }
    });
    return best;
  }

  function sameLoopCyclic(a, b) {
    return !!a && !!b && a.length === b.length && canonicalLoopKey(a) === canonicalLoopKey(b);
  }

  function displayOuterLoop(surface) {
    var loops = surface && surface.loops || [];
    for (var i = 0; i < loops.length; i++) {
      if (loops[i].kind === 'inner') continue;
      if (loops[i].vertices && loops[i].vertices.length >= 3) return loops[i].vertices;
    }
    return null;
  }

  function pointLoopState(loop, point, normal, vertices, tolerance) {
    var b = basis(normal), q = {x:dot(point, b.u), y:dot(point, b.v)}, inside = false;
    for (var i = 0; i < loop.length; i++) {
      var a = vertices[loop[i]], c = vertices[loop[(i + 1) % loop.length]];
      if (!finite(a) || !finite(c)) return 'outside';
      var pa = {x:dot(a, b.u), y:dot(a, b.v)}, pc = {x:dot(c, b.u), y:dot(c, b.v)};
      var dx = pc.x - pa.x, dy = pc.y - pa.y, length2 = dx*dx + dy*dy;
      var t = length2 > 0 ? ((q.x - pa.x)*dx + (q.y - pa.y)*dy) / length2 : 0;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(pa.x + t*dx - q.x, pa.y + t*dy - q.y) <= tolerance) return 'boundary';
      if ((pa.y > q.y) !== (pc.y > q.y) &&
          q.x < (pc.x - pa.x) * (q.y - pa.y) / (pc.y - pa.y) + pa.x) inside = !inside;
    }
    return inside ? 'inside' : 'outside';
  }

  function rimSamples(curve, geometry, hole) {
    var samples = [], vertices = geometry.vertices || [];
    hole.forEach(function (index) {
      if (finite(vertices[index])) samples.push(vertices[index]);
    });
    if (validCurve(curve)) {
      for (var k = 0; k < 32; k++) samples.push(curvePoint(curve, TAU * k / 32));
    }
    for (var i = 0; i < hole.length; i++) {
      var a = vertices[hole[i]], b = vertices[hole[(i + 1) % hole.length]];
      if (finite(a) && finite(b))
        samples.push({x:(a.x+b.x)/2, y:(a.y+b.y)/2, z:(a.z+b.z)/2});
    }
    return samples;
  }

  function faceOnSurface(face, surface, geometry, tolerance) {
    var vertices = geometry.vertices || [];
    var pts = face.map(function (index) { return vertices[index]; });
    if (pts.some(function (p) {
      return !finite(p) || Math.abs(dot(sub(p, surface.origin), surface.normal)) > tolerance;
    })) return false;
    var faceNormal = newell(pts);
    return !!faceNormal && Math.abs(dot(faceNormal, surface.normal)) >= 1 - 1e-6;
  }

  function loopClearance(loop, point, normal, vertices) {
    var b = basis(normal), q = {x:dot(point, b.u), y:dot(point, b.v)}, minimum = Infinity;
    for (var i = 0; i < loop.length; i++) {
      var a = vertices[loop[i]], c = vertices[loop[(i + 1) % loop.length]];
      if (!finite(a) || !finite(c)) return 0;
      var pa = {x:dot(a, b.u), y:dot(a, b.v)}, pc = {x:dot(c, b.u), y:dot(c, b.v)};
      var dx = pc.x - pa.x, dy = pc.y - pa.y, length2 = dx*dx + dy*dy;
      var t = length2 > 0 ? ((q.x - pa.x)*dx + (q.y - pa.y)*dy) / length2 : 0;
      t = Math.max(0, Math.min(1, t));
      minimum = Math.min(minimum, Math.hypot(pa.x + t*dx - q.x, pa.y + t*dy - q.y));
    }
    return minimum;
  }

  function circleLoopState(loop, curve, surface, geometry, tolerance, keepOutside) {
    var sweep = curve.sweepAngle === undefined ? TAU : curve.sweepAngle;
    if (!(curve.radius > 0) || Math.abs(sweep - TAU) > 1e-9)
      return 'rim-contained-unsupported';
    if (!finite(curve.center) ||
        Math.abs(dot(sub(curve.center, surface.origin), surface.normal)) > tolerance)
      return 'rim-off-face';
    var state = pointLoopState(loop, curve.center, surface.normal, geometry.vertices, tolerance);
    if (keepOutside) {
      if (state !== 'outside') return 'rim-overlaps-hole';
    } else {
      if (state === 'boundary') return 'rim-touching-boundary';
      if (state !== 'inside') return 'rim-not-contained';
    }
    if (loopClearance(loop, curve.center, surface.normal, geometry.vertices) <=
        curve.radius + tolerance)
      return keepOutside ? 'rim-overlaps-hole' : 'rim-touching-boundary';
    return null;
  }

  function analyticCircle(curve) {
    if (!curve || !(curve.radius > 0) || !finite(curve.center)) return null;
    var sweep = curve.sweepAngle === undefined ? TAU : curve.sweepAngle;
    return Math.abs(sweep - TAU) <= 1e-9 ? curve : null;
  }

  function analyticCircleForHole(hole, geometry) {
    var curves = geometry.curves || [];
    for (var i = 0; i < curves.length; i++) {
      var curve = analyticCircle(curves[i]);
      if (curve && curve.displayVertices && sameLoopCyclic(curve.displayVertices, hole)) return curve;
    }
    return null;
  }

  function circlesOverlap(a, b, tolerance) {
    var distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y,
      a.center.z - b.center.z);
    return distance < a.radius + b.radius - tolerance;
  }

  function rimFaceState(face, hole, curve, existingHoles, surface, geometry, tolerance) {
    if (!validCurve(curve) && curve && curve.unionMouth) {
      var vertices = geometry.vertices || [];
      for (var h = 0; h < hole.length; h++) {
        var state = pointLoopState(face, vertices[hole[h]], surface.normal, vertices, tolerance);
        if (state === 'boundary') return 'rim-touching-boundary';
        if (state !== 'inside') return 'rim-not-contained';
      }
      return null;
    }
    var state = circleLoopState(face, curve, surface, geometry, tolerance, false);
    if (state) return state;
    for (var h = 0; h < (existingHoles || []).length; h++) {
      var existing = existingHoles[h];
      if (sameLoopCyclic(existing, hole)) continue;
      var existingCircle = analyticCircleForHole(existing, geometry);
      if (existingCircle && analyticCircle(curve)) {
        if (circlesOverlap(curve, existingCircle, tolerance)) return 'rim-overlaps-hole';
        continue;
      }
      state = circleLoopState(existing, curve, surface, geometry, tolerance, true);
      if (state) return state;
    }
    return null;
  }

  function displayCoverage(faces, samples, surface, geometry, tolerance) {
    var vertices = geometry.vertices || [], covered = 0, keys = {}, any = false;
    faces.forEach(function (fi) { keys[canonicalLoopKey(geometry.faces[fi])] = true; });
    samples.forEach(function (sample) {
      var hit = false;
      faces.forEach(function (fi) {
        var state = pointLoopState(geometry.faces[fi], sample, surface.normal, vertices, tolerance);
        if (state !== 'outside') { hit = true; if (state === 'inside') any = true; }
      });
      if (hit) covered++;
    });
    return {all:covered === samples.length, any:any, boundaries:Object.keys(keys).length};
  }

  function displayTolerance(curve, geometry) {
    var scale = 1, center = curve.center;
    [curve.radius, curve.radiusU, curve.radiusV].forEach(function (radius) {
      if (Number.isFinite(radius)) scale = Math.max(scale, Math.abs(radius));
    });
    if (finite(center)) {
      (curve.displayVertices || []).forEach(function (index) {
        var p = geometry.vertices && geometry.vertices[index];
        if (finite(p)) scale = Math.max(scale,
          Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z));
      });
    } else {
      var first = (curve.displayVertices || []).map(function (index) {
        return geometry.vertices && geometry.vertices[index];
      }).filter(finite)[0];
      if (first) (curve.displayVertices || []).forEach(function (index) {
        var p = geometry.vertices && geometry.vertices[index];
        if (finite(p)) scale = Math.max(scale,
          Math.hypot(p.x - first.x, p.y - first.y, p.z - first.z));
      });
    }
    return 1e-5 * scale;
  }

  function displayTargets(surface, geometry, curve) {
    var faces = geometry.faces || [], patches = geometry.surfacePatches || [];
    var hole = (curve.displayVertices || []).slice();
    if (hole.length < 3) return {indices:[], reason:'boundary-missing'};
    if (!finite(surface.normal) || !finite(surface.origin)) return {indices:[], reason:'host-missing'};
    var tolerance = displayTolerance(curve, geometry);
    var hostOuter = displayOuterLoop(surface);
    var candidates = [], groups = {};
    function keep(index) {
      if (Number.isInteger(index) && index >= 0 && index < faces.length &&
          candidates.indexOf(index) === -1) candidates.push(index);
    }
    (surface.displayFaceIndices || []).forEach(keep);
    if (!candidates.length) {
      var patch = surface.patchIndex !== undefined ? patches[surface.patchIndex] : null;
      if (patch && Array.isArray(patch.faceIndices)) patch.faceIndices.forEach(keep);
    }
    if (!candidates.length && hostOuter) {
      faces.forEach(function (face, fi) {
        if (sameLoopCyclic(face, hostOuter)) keep(fi);
      });
    }
    if (!candidates.length) {
      candidates = faces.map(function (_, fi) { return fi; }).filter(function (fi) {
        return faceOnSurface(faces[fi], surface, geometry, tolerance);
      });
    }
    if (!candidates.length) return {indices:[], reason:'host-missing'};
    var failure = null;
    candidates.forEach(function (fi) {
      if (!faceOnSurface(faces[fi], surface, geometry, tolerance)) return;
      var existing = geometry.faceHoles && geometry.faceHoles[fi] || [];
      var state = rimFaceState(faces[fi], hole, curve, existing, surface, geometry, tolerance);
      if (state) { failure = failure || state; return; }
      var key = canonicalLoopKey(faces[fi]);
      (groups[key] || (groups[key] = [])).push(fi);
    });
    var keys = Object.keys(groups);
    if (keys.length === 1) return {indices:groups[keys[0]], reason:null};
    if (keys.length > 1) return {indices:[], reason:'host-ambiguous'};
    var samples = rimSamples(curve, geometry, hole);
    var coverageCandidates = candidates.filter(function (fi) {
      return faceOnSurface(faces[fi], surface, geometry, tolerance);
    });
    if (!coverageCandidates.length) return {indices:[], reason:'host-missing'};
    var coverage = displayCoverage(coverageCandidates, samples, surface, geometry, tolerance);
    if (coverage.all && coverage.boundaries > 1) return {indices:[], reason:'host-split'};
    if (coverage.any) return {indices:[], reason:failure || 'rim-not-contained'};
    return {indices:[], reason:failure || (hostOuter ? 'rim-not-contained' : 'host-missing')};
  }

  function syncDisplayHoles(model, geometry) {
    if (!model || !geometry || !(geometry.faces || []).length) return {holes:0, diagnostics:[]};
    var curves = geometry.curves || [], mouths = [];
    (model.surfaces || []).forEach(function (surface) {
      if (surface.kind !== 'plane') return;
      (surface.loops || []).forEach(function (loop) {
        if (loop.kind !== 'inner') return;
        loopCurves(loop, curves).forEach(function (curve) {
          if (curve && curve.recessMouth && (curve.displayVertices || []).length >= 3)
            mouths.push({surface:surface, curve:curve});
        });
      });
    });
    curves.forEach(function (curve) {
      if (!curve || !curve.unionMouth || !curve.recessMouth) return;
      if (!(curve.displayVertices || []).length) return;
      var surface = (model.surfaces || []).filter(function (candidate) {
        return candidate.id === curve.hostSurfaceId;
      })[0];
      if (surface) mouths.push({surface:surface, curve:curve});
    });
    if (!mouths.length) return {holes:0, diagnostics:[]};
    var faces = geometry.faces, patches = geometry.surfacePatches || [];
    var faceHoles = Array.isArray(geometry.faceHoles) ? geometry.faceHoles : [];
    geometry.faceHoles = faces.map(function (_, i) {
      return (faceHoles[i] || []).map(function (hole) { return hole.slice(); });
    });
    faceHoles = geometry.faceHoles;
    var regions = Array.isArray(geometry.faceRegions) ? geometry.faceRegions : null;
    var applied = 0, diagnostics = [];
    mouths.forEach(function (mouth) {
      var surface = mouth.surface, curve = mouth.curve, hole = curve.displayVertices.slice();
      var targets = displayTargets(surface, geometry, curve);
      if (!targets.indices.length) {
        diagnostics.push({code:'surface-display-' + targets.reason, message:
          'The displayed host face of an analytic recess mouth could not be identified (' +
          targets.reason + ').', surfaceId:surface.id, curveIndex:curves.indexOf(curve),
          sourceIds:(curve.sourceIds || []).slice()});
        return;
      }
      targets.indices.forEach(function (fi) {
        if (!faceHoles[fi].some(function (existing) { return sameLoopCyclic(existing, hole); })) {
          faceHoles[fi].push(hole.slice());
          applied++;
        }
        if (regions) regions.forEach(function (region) {
          if (!region || !sameLoopCyclic(region.outer, faces[fi])) return;
          region.holes = Array.isArray(region.holes) ? region.holes : [];
          if (!region.holes.some(function (existing) { return sameLoopCyclic(existing, hole); }))
            region.holes.push(hole.slice());
        });
        var patch = surface.patchIndex !== undefined ? patches[surface.patchIndex] : null;
        if (!patch) patch = patches.filter(function (p) { return sameLoopCyclic(p.outer, faces[fi]); })[0];
        var curveIndex = curves.indexOf(curve);
        if (patch && curveIndex >= 0) {
          patch.innerCurves = Array.isArray(patch.innerCurves) ? patch.innerCurves : [];
          if (patch.innerCurves.indexOf(curveIndex) === -1) patch.innerCurves.push(curveIndex);
        }
      });
    });
    return {holes:applied, diagnostics:diagnostics};
  }

  function circleInPlanarFace(face, circle, vertices, options) {
    if (!face || !Array.isArray(face.outer) || face.outer.length < 3)
      return {contained:false, reason:'face-missing'};
    if (!circle || !finite(circle.center) || !(circle.radius > 0) ||
        !finite(circle.u) || !finite(circle.v))
      return {contained:false, reason:'circle-invalid'};
    if (!Array.isArray(vertices))
      return {contained:false, reason:'face-vertex-invalid'};
    var outer = face.outer.map(function (i) { return vertices[i]; });
    var holes = face.holes || [];
    if (outer.some(function (p) { return !finite(p); }))
      return {contained:false, reason:'face-vertex-invalid'};
    var normal = newell(outer);
    if (!normal)
      return {contained:false, reason:'face-degenerate'};
    var circleCross = cross(circle.u, circle.v);
    if (!finite(circleCross) || length(circleCross) <= EPS)
      return {contained:false, reason:'circle-basis-invalid'};
    var circleNormal = unitOrNull(circleCross);
    if (!circleNormal)
      return {contained:false, reason:'circle-basis-invalid'};
    var scale = Math.max(1, circle.radius);
    function edgeScale(points) {
      for (var i = 0; i < points.length; i++) {
        var a = points[i], b = points[(i + 1) % points.length];
        if (finite(a) && finite(b)) scale = Math.max(scale, length(sub(b, a)));
      }
    }
    edgeScale(outer);
    holes.forEach(function (hole) {
      if (Array.isArray(hole)) edgeScale(hole.map(function (i) { return vertices[i]; }));
    });
    var tolerance = options && Number.isFinite(options.tolerance) ?
      options.tolerance : 1e-5 * scale;
    if (Math.abs(Math.abs(dot(normal, circleNormal)) - 1) > 1e-6)
      return {contained:false, reason:'circle-plane-not-parallel'};
    var origin = outer[0];
    if (Math.abs(dot(sub(circle.center, origin), normal)) > tolerance)
      return {contained:false, reason:'circle-plane-offset'};
    var rawU = sub(outer[1], origin);
    if (!finite(rawU) || length(rawU) <= EPS)
      return {contained:false, reason:'face-basis-invalid'};
    var u = unitOrNull(rawU);
    if (!u) return {contained:false, reason:'face-basis-invalid'};
    var rawV = cross(normal, u);
    if (!finite(rawV) || length(rawV) <= EPS)
      return {contained:false, reason:'face-basis-invalid'};
    var v = unitOrNull(rawV);
    if (!v) return {contained:false, reason:'face-basis-invalid'};
    function projectPoint(p) {
      var d = sub(p, origin);
      return {x:dot(d, u), y:dot(d, v)};
    }
    function polygon2(indices) {
      return indices.map(function (i) { return projectPoint(vertices[i]); });
    }
    function distanceToPolygon(p, polygon) {
      var best = Infinity;
      for (var i = 0; i < polygon.length; i++) {
        var a = polygon[i], b = polygon[(i + 1) % polygon.length];
        var dx = b.x - a.x, dy = b.y - a.y, l2 = dx*dx + dy*dy;
        var t = l2 > 0 ? Math.max(0, Math.min(1,
          ((p.x - a.x)*dx + (p.y - a.y)*dy) / l2)) : 0;
        best = Math.min(best, Math.hypot(p.x - a.x - t*dx, p.y - a.y - t*dy));
      }
      return best;
    }
    var center = projectPoint(circle.center);
    var outerPolygon = polygon2(face.outer);
    if (!pointInPolygon2(center, outerPolygon))
      return {contained:false, reason:'circle-center-outside-face'};
    var clearance = distanceToPolygon(center, outerPolygon);
    for (var h = 0; h < holes.length; h++) {
      if (!Array.isArray(holes[h])) continue;
      var holePolygon = polygon2(holes[h]);
      if (pointInPolygon2(center, holePolygon))
        return {contained:false, reason:'circle-center-inside-hole'};
      clearance = Math.min(clearance, distanceToPolygon(center, holePolygon));
    }
    if (clearance <= circle.radius + tolerance)
      return {contained:false, reason:'circle-crosses-face-boundary',
        clearance:clearance, tolerance:tolerance};
    return {contained:true, clearance:clearance, tolerance:tolerance};
  }

  var CAVITY_TRIM_CONTRACT = 'cavity-analytic-trim-v1';

  function trimStatusRank(status) {
    return {none:0, exact:1, numeric:2, unresolved:3, unsupported:4}[status] || 0;
  }
  function trimWorst(a, b) {
    return trimStatusRank(a) >= trimStatusRank(b) ? a : b;
  }
  function trimTolerance(volumes) {
    var scale = 1;
    (volumes || []).forEach(function (volume) {
      if (!volume) return;
      scale = Math.max(scale, Math.abs(volume.radius || 0),
        Math.abs(volume.bottomRadius || 0),
        Math.abs(volume.depth || 0), Math.abs(volume.mouthRadius || 0));
      if (volume.kind === 'sphere' && Number.isFinite(volume.capAngle))
        scale = Math.max(scale, Math.abs(volume.radius || 0) * Math.sin(volume.capAngle));
    });
    return 1e-7 * scale;
  }
  function axialVolumeRadius(volume, station) {
    if (!volume || volume.kind !== 'cone') return volume && volume.radius;
    var start = volume.radius;
    var end = Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : start;
    if (!(volume.depth > 0)) return start;
    var fraction = Math.max(0, Math.min(1, station / volume.depth));
    return start + (end - start) * fraction;
  }
  function trimVolumeContains(volume, p, tolerance) {
    if (!volume || !finite(p)) return false;
    if (volume.kind === 'cylinder') {
      var axis = unit(volume.axis), d = sub(p, volume.origin);
      var axial = dot(d, axis);
      var radial = length(sub(d, mul(axis, axial)));
      return axial >= -tolerance && axial <= volume.depth + tolerance &&
        radial <= volume.radius + tolerance;
    }
    if (volume.kind === 'cone') {
      var coneAxis = unit(volume.axis), delta = sub(p, volume.origin);
      var coneAxial = dot(delta, coneAxis);
      if (coneAxial < -tolerance || coneAxial > volume.depth + tolerance) return false;
      var coneRadial = length(sub(delta, mul(coneAxis, coneAxial)));
      return coneRadial <= axialVolumeRadius(volume, coneAxial) + tolerance;
    }
    if (volume.kind === 'sphere') {
      var distance = length(sub(p, volume.center));
      var plane = dot(sub(p, volume.mouthCenter), unit(volume.outward));
      return distance <= volume.radius + tolerance && plane <= tolerance;
    }
    return false;
  }
  function trimInsideUnion(volumes, indices, p, tolerance) {
    for (var i = 0; i < indices.length; i++) {
      if (trimVolumeContains(volumes[indices[i]], p, tolerance)) return true;
    }
    return false;
  }
  function trimSurfaceFor(volume, role, model) {
    var surfaces = model && model.surfaces || [];
    for (var i = 0; i < surfaces.length; i++) {
      var surface = surfaces[i];
      if (surface && surface.volumeIndex === volume.index && surface.memberRole === role)
        return surface;
    }
    return null;
  }
  function trimSupport(volume, role, model) {
    var surface = trimSurfaceFor(volume, role, model);
    if (volume.kind === 'cylinder' && role === 'side') {
      surface = surface || {kind:'cylinder', origin:volume.origin, axis:volume.axis,
        radius:volume.radius};
    } else if (volume.kind === 'cylinder' && role === 'bottom') {
      surface = surface || {kind:'plane', origin:volume.bottomCenter ||
        add(volume.origin, mul(unit(volume.axis), volume.depth)),
        normal:unit(volume.axis)};
    } else if (volume.kind === 'cone' && role === 'side') {
      if (!surface) {
        var coneAxis = unit(volume.axis), coneStart = volume.radius;
        var coneEnd = Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : coneStart;
        var coneSlope = volume.depth > 0 ? (coneEnd - coneStart) / volume.depth : 0;
        var coneApexOffset = Math.abs(coneSlope) > EPS ? -coneStart / coneSlope : 0;
        surface = {kind:'cone', origin:volume.origin, axis:coneAxis,
          radius:coneStart, apex:add(volume.origin, mul(coneAxis, coneApexOffset)),
          halfAngle:Math.atan2(coneStart, Math.abs(coneApexOffset))};
      }
    } else if (volume.kind === 'cone' && role === 'bottom') {
      surface = surface || {kind:'plane', origin:volume.bottomCenter ||
        add(volume.origin, mul(unit(volume.axis), volume.depth)),
        normal:unit(volume.axis)};
    } else if (volume.kind === 'sphere' && role === 'cap') {
      surface = surface || {kind:'sphere', center:volume.center, radius:volume.radius};
    }
    if (!surface) return null;
    return {volume:volume, role:role, surface:surface,
      surfaceId:surface.id === undefined ? null : surface.id,
      sourceIds:Array.from(new Set((surface.sourceIds || []).concat(volume.sourceIds || [])))};
  }
  function trimSupportsFor(volume, model) {
    var roles = volume.kind === 'cylinder' ? ['side', 'bottom'] :
      volume.kind === 'cone' ? ['side'].concat(
        Number.isFinite(volume.bottomRadius) && volume.bottomRadius > EPS ? ['bottom'] : []) :
      volume.kind === 'sphere' ? ['cap'] : [];
    return roles.map(function (role) {
      return trimSupport(volume, role, model);
    }).filter(Boolean);
  }
  function trimDomainRecord(volume, role) {
    if (volume.kind === 'cylinder' && role === 'side')
      return {volume:volume.index, role:role, kind:'cylinder-side',
        origin:copyPoint(volume.origin), axis:copyPoint(unit(volume.axis)),
        radius:volume.radius, axial:[0, volume.depth]};
    if (volume.kind === 'cylinder' && role === 'bottom')
      return {volume:volume.index, role:role, kind:'cylinder-cap',
        center:copyPoint(volume.bottomCenter ||
          add(volume.origin, mul(unit(volume.axis), volume.depth))),
        normal:copyPoint(unit(volume.axis)), radius:volume.radius};
    if (volume.kind === 'cone' && role === 'side')
      return {volume:volume.index, role:role, kind:'cone-side',
        origin:copyPoint(volume.origin), axis:copyPoint(unit(volume.axis)),
        radius:volume.radius, bottomRadius:volume.bottomRadius, axial:[0, volume.depth]};
    if (volume.kind === 'cone' && role === 'bottom')
      return {volume:volume.index, role:role, kind:'cone-cap',
        center:copyPoint(volume.bottomCenter ||
          add(volume.origin, mul(unit(volume.axis), volume.depth))),
        normal:copyPoint(unit(volume.axis)),
        radius:Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : volume.radius};
    if (volume.kind === 'sphere' && role === 'cap')
      return {volume:volume.index, role:role, kind:'sphere-cap',
        center:copyPoint(volume.center), radius:volume.radius,
        capAngle:volume.capAngle, mouthCenter:copyPoint(volume.mouthCenter),
        outward:copyPoint(unit(volume.outward)),
        mouthRadius:Number.isFinite(volume.mouthRadius) ? volume.mouthRadius :
          volume.radius * Math.sin(volume.capAngle)};
    return null;
  }
  function trimNormalizeAngle(a) { return ((a % TAU) + TAU) % TAU; }
  function trimTrigLe(A, B, C) {
    var amplitude = Math.hypot(A, B), rhs = -C;
    var tolerance = 1e-12 * Math.max(1, Math.abs(C), amplitude);
    if (amplitude <= tolerance) return rhs >= -tolerance ? [{start:0, end:TAU}] : [];
    if (rhs >= amplitude - tolerance) return [{start:0, end:TAU}];
    if (rhs <= -amplitude + tolerance) return [];
    var ratio = Math.max(-1, Math.min(1, rhs / amplitude));
    var phi = Math.atan2(B, A), delta = Math.acos(ratio);
    if (delta <= 1e-12) return [{start:0, end:TAU}];
    if (Math.PI - delta <= 1e-12) return [];
    var start = trimNormalizeAngle(phi + delta);
    var end = trimNormalizeAngle(phi + TAU - delta);
    if (start < end) return [{start:start, end:end}];
    return [{start:start, end:TAU}, {start:0, end:end}];
  }
  function trimIntersectIntervals(a, b) {
    var out = [];
    for (var i = 0; i < a.length; i++) for (var j = 0; j < b.length; j++) {
      var start = Math.max(a[i].start, b[j].start);
      var end = Math.min(a[i].end, b[j].end);
      if (end >= start - 1e-12) out.push({start:start, end:end});
    }
    out.sort(function (x, y) { return x.start - y.start; });
    var merged = [];
    out.forEach(function (interval) {
      var last = merged[merged.length - 1];
      if (last && interval.start <= last.end + 1e-12) last.end = Math.max(last.end, interval.end);
      else merged.push({start:interval.start, end:interval.end});
    });
    return merged;
  }
  function trimLinearLe(A, B) {
    var tolerance = 1e-12 * Math.max(1, Math.abs(A), Math.abs(B));
    if (Math.abs(A) <= tolerance)
      return B <= tolerance ? [{start:-Infinity, end:Infinity}] : [];
    var t = -B / A;
    return A > 0 ? [{start:-Infinity, end:t}] : [{start:t, end:Infinity}];
  }
  function trimQuadraticLe(a, b, c, tolerance) {
    if (Math.abs(a) <= tolerance * tolerance) return trimLinearLe(b, c);
    var disc = b * b - 4 * a * c;
    if (disc < -tolerance * Math.max(1, Math.abs(b), Math.abs(c))) return [];
    var root = Math.sqrt(Math.max(0, disc));
    var t0 = (-b - root) / (2 * a), t1 = (-b + root) / (2 * a);
    if (t0 > t1) { var swap = t0; t0 = t1; t1 = swap; }
    return a > 0 ? [{start:t0, end:t1}] :
      [{start:-Infinity, end:t0}, {start:t1, end:Infinity}];
  }
  function trimPolyNormalize(c) {
    var n = c.length - 1;
    while (n > 0 && !Number.isFinite(c[n])) n--;
    var scale = 0;
    for (var i = 0; i <= n; i++) scale = Math.max(scale, Math.abs(c[i]));
    if (!(scale > 0)) return {c:[0], scale:0};
    var out = [];
    for (var k = 0; k <= n; k++) out.push(c[k] / scale);
    while (out.length > 1 && Math.abs(out[out.length - 1]) <= 1e-15) out.pop();
    return {c:out, scale:scale};
  }
  function trimPolyEval(c, x) {
    var value = 0;
    for (var i = c.length - 1; i >= 0; i--) value = value * x + c[i];
    return value;
  }
  function trimPolyDerivative(c) {
    var out = [];
    for (var i = 1; i < c.length; i++) out.push(i * c[i]);
    return out.length ? out : [0];
  }
  function trimPolyBisect(c, a, b, fa) {
    var left = a, right = b, fleft = fa;
    for (var i = 0; i < 200; i++) {
      var middle = 0.5 * (left + right);
      if (!(middle > left && middle < right)) break;
      var fm = trimPolyEval(c, middle);
      if (fm === 0) return middle;
      if ((fleft < 0) !== (fm < 0)) { right = middle; }
      else { left = middle; fleft = fm; }
      if (right - left <= 1e-15 * (1 + Math.abs(middle))) break;
    }
    return 0.5 * (left + right);
  }
  function trimPolyUnique(values) {
    var sorted = values.filter(Number.isFinite).sort(function (a, b) { return a - b; });
    var out = [];
    sorted.forEach(function (value) {
      var last = out[out.length - 1];
      if (last === undefined || Math.abs(value - last) > 1e-12 * (1 + Math.abs(value)))
        out.push(value);
    });
    return out;
  }
  function trimPolyRealRoots(coeffs) {
    var norm = trimPolyNormalize(coeffs);
    var c = norm.c, n = c.length - 1;
    if (n <= 0) return [];
    if (n === 1) return [-c[0] / c[1]];
    if (n === 2) {
      var disc = c[1] * c[1] - 4 * c[2] * c[0];
      var bound = Math.max(1, c[1] * c[1], Math.abs(4 * c[2] * c[0]));
      if (disc < -1e-14 * bound) return [];
      var root = Math.sqrt(Math.max(0, disc));
      return trimPolyUnique([(-c[1] - root) / (2 * c[2]),
        (-c[1] + root) / (2 * c[2])]);
    }
    var critical = trimPolyUnique(trimPolyRealRoots(trimPolyDerivative(c)));
    var limit = 1;
    for (var i = 0; i < n; i++) limit = Math.max(limit, Math.abs(c[i] / c[n]));
    limit = 1 + limit;
    critical = critical.filter(function (value) { return Math.abs(value) <= limit * (1 + 1e-12); });
    var valueTolerance = 1e-13;
    var roots = [];
    critical.forEach(function (value) {
      if (Math.abs(trimPolyEval(c, value)) <= valueTolerance) roots.push(value);
    });
    var points = [-limit].concat(critical, [limit]);
    for (var k = 0; k < points.length - 1; k++) {
      var a = points[k], b = points[k + 1];
      if (!(b > a)) continue;
      var fa = a === -limit ? (c[n] > 0 ? (n % 2 ? -1 : 1) : (n % 2 ? 1 : -1))
        : trimPolyEval(c, a);
      var fb = b === limit ? (c[n] > 0 ? 1 : -1) : trimPolyEval(c, b);
      if (fa === 0 || fb === 0) continue;
      if ((fa < 0) !== (fb < 0)) roots.push(trimPolyBisect(c, a, b, fa));
    }
    return trimPolyUnique(roots);
  }
  function trimHarmonicScale(coeffs) {
    return Math.max(1e-300, Math.abs(coeffs.a0 || 0), Math.abs(coeffs.a1 || 0),
      Math.abs(coeffs.b1 || 0), Math.abs(coeffs.a2 || 0), Math.abs(coeffs.b2 || 0));
  }
  function trimHarmonicEval(coeffs, t) {
    var ct = Math.cos(t), st = Math.sin(t);
    return (coeffs.a0 || 0) + (coeffs.a1 || 0) * ct + (coeffs.b1 || 0) * st +
      (coeffs.a2 || 0) * (ct * ct - st * st) + (coeffs.b2 || 0) * (2 * st * ct);
  }
  function trimHarmonicQuartic(coeffs) {
    var a0 = coeffs.a0 || 0, a1 = coeffs.a1 || 0, b1 = coeffs.b1 || 0,
      a2 = coeffs.a2 || 0, b2 = coeffs.b2 || 0;
    return [a0 + a1 + a2, 2 * b1 + 4 * b2, 2 * a0 - 6 * a2,
      2 * b1 - 4 * b2, a0 - a1 + a2];
  }
  function trimHarmonicIntervals(coeffs, valueTolerance) {
    var scale = trimHarmonicScale(coeffs);
    var tolerance = Number.isFinite(valueTolerance) ? valueTolerance : 0;
    var amplitude = Math.max(Math.abs(coeffs.a1 || 0), Math.abs(coeffs.b1 || 0),
      Math.abs(coeffs.a2 || 0), Math.abs(coeffs.b2 || 0));
    if (amplitude <= 1e-14) {
      var constant = coeffs.a0 || 0;
      var coincident = Math.abs(constant) <= 1e-14;
      return {ok:true, intervals:(constant <= tolerance) ? [{start:0, end:TAU}] : [],
        events:[], residual:coincident ? 0 : Math.abs(constant),
        residualKnown:coincident, scale:Math.max(scale, Math.abs(constant)),
        breakpoints:[0, TAU], constant:true, coincident:coincident,
        value:constant};
    }
    var roots = trimPolyRealRoots(trimHarmonicQuartic(coeffs));
    var events = [], points = [0, Math.PI, TAU];
    var residual = 0;
    roots.forEach(function (z) {
      var t = 2 * Math.atan(z);
      t = trimNormalizeAngle(t);
      if (t <= 1e-12 || TAU - t <= 1e-12) t = 0;
      else if (Math.abs(t - Math.PI) <= 1e-12) t = Math.PI;
      points.push(t);
      residual = Math.max(residual, Math.abs(trimHarmonicEval(coeffs, t)) / scale);
      events.push({t:t, z:z,
        residual:Math.abs(trimHarmonicEval(coeffs, t)) / scale});
    });
    if (Math.abs(trimHarmonicEval(coeffs, Math.PI)) / scale <= 1e-12) {
      events.push({t:Math.PI, z:null,
        residual:Math.abs(trimHarmonicEval(coeffs, Math.PI)) / scale});
    }
    var sorted = points.slice().sort(function (a, b) { return a - b; });
    var breakpoints = [];
    sorted.forEach(function (value) {
      var last = breakpoints[breakpoints.length - 1];
      if (last === undefined || value - last > 1e-12) breakpoints.push(value);
    });
    if (breakpoints[0] !== 0) breakpoints.unshift(0);
    if (breakpoints[breakpoints.length - 1] !== TAU) breakpoints.push(TAU);
    var intervals = [];
    breakpoints.forEach(function (start, index) {
      var end = breakpoints[index + 1];
      if (end === undefined || !(end > start)) return;
      var middle = 0.5 * (start + end);
      var value = trimHarmonicEval(coeffs, middle);
      if (value <= tolerance) intervals.push({start:start, end:end});
    });
    var seen = {};
    var uniqueEvents = [];
    events.forEach(function (event) {
      var key = Math.round(event.t * 1e9);
      if (seen[key]) { seen[key].residual = Math.max(seen[key].residual, event.residual); return; }
      seen[key] = event;
      uniqueEvents.push(event);
    });
    uniqueEvents.sort(function (a, b) { return a.t - b.t; });
    return {ok:true, intervals:intervals, events:uniqueEvents,
      residual:residual, residualKnown:true, scale:scale,
      breakpoints:breakpoints, constant:false, coincident:false};
  }
  function trimNegateCoeffs(coeffs) {
    return {a0:-coeffs.a0, a1:-coeffs.a1, b1:-coeffs.b1,
      a2:-coeffs.a2, b2:-coeffs.b2};
  }
  function trimAxialCoeffs(volume, branch, offset) {
    var axis = unit(volume.axis), radiiUV = radii(branch);
    return {a0:dot(sub(branch.center, volume.origin), axis) - (offset || 0),
      a1:radiiUV.u * dot(branch.u, axis), b1:radiiUV.v * dot(branch.v, axis),
      a2:0, b2:0};
  }
  function trimPlaneCoeffs(origin, normal, branch, offset) {
    var n = unit(normal), radiiUV = radii(branch);
    return {a0:dot(sub(branch.center, origin), n) - (offset || 0),
      a1:radiiUV.u * dot(branch.u, n), b1:radiiUV.v * dot(branch.v, n),
      a2:0, b2:0};
  }
  function trimQuadricCoeffs(center, radius, branch) {
    var radiiUV = radii(branch), q = sub(branch.center, center);
    var uu = dot(branch.u, branch.u), vv = dot(branch.v, branch.v),
      uv = dot(branch.u, branch.v);
    return {a0:dot(q, q) + 0.5 * (radiiUV.u * radiiUV.u * uu +
        radiiUV.v * radiiUV.v * vv) - radius * radius,
      a1:2 * radiiUV.u * dot(q, branch.u),
      b1:2 * radiiUV.v * dot(q, branch.v),
      a2:0.5 * (radiiUV.u * radiiUV.u * uu - radiiUV.v * radiiUV.v * vv),
      b2:radiiUV.u * radiiUV.v * uv};
  }
  function trimCylinderRadialCoeffs(volume, branch) {
    var quadric = trimQuadricCoeffs(volume.origin, 0, branch);
    var axial = trimAxialCoeffs(volume, branch, 0);
    var a0 = axial.a0, a1 = axial.a1, b1 = axial.b1;
    return {a0:quadric.a0 - (a0 * a0 + 0.5 * (a1 * a1 + b1 * b1)),
      a1:quadric.a1 - 2 * a0 * a1, b1:quadric.b1 - 2 * a0 * b1,
      a2:quadric.a2 - 0.5 * (a1 * a1 - b1 * b1),
      b2:quadric.b2 - a1 * b1};
  }
  function trimCylinderBottomCenter(volume) {
    return volume.bottomCenter ||
      add(volume.origin, mul(unit(volume.axis), volume.depth));
  }
  function trimCurveDomainChecks(volume, role, branch, tolerance) {
    if (volume.kind === 'cylinder' && role === 'side') {
      var axis = unit(volume.axis), axial = trimAxialCoeffs(volume, branch, 0);
      return {checks:[{coeffs:trimNegateCoeffs(axial), valueTolerance:tolerance,
          source:'parent-axial-start'},
        {coeffs:trimAxialCoeffs(volume, branch, volume.depth),
          valueTolerance:tolerance, source:'parent-axial-end'}], reason:null};
    }
    if (volume.kind === 'cylinder' && role === 'bottom') {
      var center = trimCylinderBottomCenter(volume);
      var normal = unit(volume.axis);
      if (Math.abs(dot(sub(branch.center, center), normal)) > tolerance)
        return {checks:[], reason:'circle-plane-offset'};
      return {checks:[{coeffs:trimQuadricCoeffs(center, volume.radius, branch),
        valueTolerance:2 * Math.max(volume.radius, 1) * tolerance,
        source:'parent-disk'}], reason:null};
    }
    if (volume.kind === 'cone' && role === 'side') {
      var coneAxis = unit(volume.axis);
      var coneDelta = sub(branch.center, volume.origin);
      var coneStation = dot(coneDelta, coneAxis);
      var coneRadial = sub(coneDelta, mul(coneAxis, coneStation));
      var branchNormal = finite(branch.u) && finite(branch.v) ?
        unit(cross(branch.u, branch.v)) : null;
      var expectedRadius = axialVolumeRadius(volume, coneStation);
      var branchRadius = Number.isFinite(branch.radius) ? branch.radius :
        Number.isFinite(branch.radiusU) ? branch.radiusU : null;
      if (length(coneRadial) > tolerance * 8 ||
          !branchNormal || Math.abs(Math.abs(dot(branchNormal, coneAxis)) - 1) > 1e-6 ||
          branchRadius === null || Math.abs(branchRadius - expectedRadius) > tolerance * 8)
        return {checks:[], reason:'circle-off-cone'};
      var coneAxial = trimAxialCoeffs(volume, branch, 0);
      return {checks:[{coeffs:trimNegateCoeffs(coneAxial), valueTolerance:tolerance,
          source:'parent-axial-start'},
        {coeffs:trimAxialCoeffs(volume, branch, volume.depth),
          valueTolerance:tolerance, source:'parent-axial-end'}], reason:null};
    }
    if (volume.kind === 'cone' && role === 'bottom') {
      var coneCenter = volume.bottomCenter ||
        add(volume.origin, mul(unit(volume.axis), volume.depth));
      var coneCapNormal = unit(volume.axis);
      if (Math.abs(dot(sub(branch.center, coneCenter), coneCapNormal)) > tolerance)
        return {checks:[], reason:'circle-plane-offset'};
      var coneBottomRadius = Number.isFinite(volume.bottomRadius) ?
        volume.bottomRadius : volume.radius;
      return {checks:[{coeffs:trimQuadricCoeffs(coneCenter, coneBottomRadius, branch),
        valueTolerance:2 * Math.max(coneBottomRadius, 1) * tolerance,
        source:'parent-disk'}], reason:null};
    }
    if (volume.kind === 'sphere' && role === 'cap') {
      return {checks:[{coeffs:trimPlaneCoeffs(volume.mouthCenter,
        volume.outward, branch, 0), valueTolerance:tolerance,
        source:'parent-cap-plane'}], reason:null};
    }
    return {checks:[], reason:'finite-domain-unsupported'};
  }
  function trimCurveFiniteIntervals(volume, role, branch, tolerance) {
    var domain = trimCurveDomainChecks(volume, role, branch, tolerance);
    if (domain.reason) return {ok:false, status:'unresolved', reason:domain.reason};
    var intervals = [{start:0, end:TAU}], events = [], coincident = [];
    var residual = 0;
    for (var i = 0; i < domain.checks.length; i++) {
      var check = domain.checks[i];
      var set = trimHarmonicIntervals(check.coeffs, check.valueTolerance);
      residual = Math.max(residual, set.residual);
      if (set.coincident) coincident.push(check.source);
      intervals = trimIntersectIntervals(intervals, set.intervals);
      set.events.forEach(function (event) {
        events.push({kind:'bounds', source:check.source, t:event.t,
          residual:event.residual});
      });
    }
    return {ok:true, intervals:intervals, events:events, coincident:coincident,
      residual:residual, method:'harmonic-event-intervals'};
  }
  function trimCurveInsideVolume(volume, branch, tolerance) {
    var inset = Math.max(1e-9, 1e-8 * Math.max(1, volume.radius || 0));
    var checks = [], boundaryChecks = [], source;
    if (volume.kind === 'cylinder') {
      var axis = unit(volume.axis), axial = trimAxialCoeffs(volume, branch, 0);
      source = 'member-cylinder';
      checks.push({a0:-(axial.a0 - inset), a1:-axial.a1, b1:-axial.b1,
        a2:0, b2:0});
      checks.push(trimAxialCoeffs(volume, branch, volume.depth - inset));
      var radial = trimCylinderRadialCoeffs(volume, branch);
      radial.a0 -= Math.pow(Math.max(0, volume.radius - inset), 2);
      checks.push(radial);
      boundaryChecks.push({a0:-axial.a0, a1:-axial.a1, b1:-axial.b1,
        a2:0, b2:0});
      boundaryChecks.push(trimAxialCoeffs(volume, branch, volume.depth));
      var boundaryRadial = trimCylinderRadialCoeffs(volume, branch);
      boundaryRadial.a0 -= volume.radius * volume.radius;
      boundaryChecks.push(boundaryRadial);
    } else if (volume.kind === 'cone') {
      source = 'member-cone';
      var coneStart = volume.radius;
      var coneEnd = Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : coneStart;
      var coneSlope = volume.depth > 0 ? (coneEnd - coneStart) / volume.depth : 0;
      var coneAxial = trimAxialCoeffs(volume, branch, 0);
      var coneQuadric = trimQuadricCoeffs(volume.origin, 0, branch);
      function coneProfileCoeffs(offset) {
        var radius0 = coneStart + coneSlope * coneAxial.a0 - offset;
        var radiusCos = coneSlope * coneAxial.a1;
        var radiusSin = coneSlope * coneAxial.b1;
        return {constant:radius0, cos:radiusCos, sin:radiusSin};
      }
      function coneInterior(offset) {
        var profile = coneProfileCoeffs(offset);
        var squareHalf = 0.5 * (profile.cos * profile.cos + profile.sin * profile.sin);
        var squareDiff = 0.5 * (profile.cos * profile.cos - profile.sin * profile.sin);
        return {
          a0:coneQuadric.a0 -
            (coneAxial.a0 * coneAxial.a0 +
              0.5 * (coneAxial.a1 * coneAxial.a1 + coneAxial.b1 * coneAxial.b1)) -
            (profile.constant * profile.constant + squareHalf),
          a1:coneQuadric.a1 - 2 * coneAxial.a0 * coneAxial.a1 -
            2 * profile.constant * profile.cos,
          b1:coneQuadric.b1 - 2 * coneAxial.a0 * coneAxial.b1 -
            2 * profile.constant * profile.sin,
          a2:coneQuadric.a2 -
            0.5 * (coneAxial.a1 * coneAxial.a1 - coneAxial.b1 * coneAxial.b1) -
            squareDiff,
          b2:coneQuadric.b2 - coneAxial.a1 * coneAxial.b1 -
            profile.cos * profile.sin
        };
      }
      checks.push(coneInterior(inset));
      checks.push({a0:-(coneAxial.a0 - inset), a1:-coneAxial.a1,
        b1:-coneAxial.b1, a2:0, b2:0});
      checks.push(trimAxialCoeffs(volume, branch, volume.depth - inset));
      boundaryChecks.push({a0:-(coneAxial.a0), a1:-coneAxial.a1,
        b1:-coneAxial.b1, a2:0, b2:0});
      boundaryChecks.push(trimAxialCoeffs(volume, branch, volume.depth));
      boundaryChecks.push(coneInterior(0));
    } else if (volume.kind === 'sphere') {
      source = 'member-sphere';
      checks.push(trimQuadricCoeffs(volume.center,
        Math.max(0, volume.radius - inset), branch));
      checks.push(trimPlaneCoeffs(volume.mouthCenter, volume.outward,
        branch, -inset));
      boundaryChecks.push(trimQuadricCoeffs(volume.center, volume.radius, branch));
      boundaryChecks.push(trimPlaneCoeffs(volume.mouthCenter, volume.outward,
        branch, 0));
    } else return {ok:false, status:'unresolved',
      reason:'finite-domain-unsupported'};
    var intervals = [{start:0, end:TAU}], events = [], coincident = [];
    var residual = 0;
    for (var i = 0; i < checks.length; i++) {
      var set = trimHarmonicIntervals(checks[i], 0);
      residual = Math.max(residual, set.residual);
      if (set.coincident) coincident.push(source);
      intervals = trimIntersectIntervals(intervals, set.intervals);
      set.events.forEach(function (event) {
        events.push({kind:'contact', source:source, t:event.t,
          residual:event.residual});
      });
    }
    var contactEvents = [];
    boundaryChecks.forEach(function (coeffs) {
      var set = trimHarmonicIntervals(coeffs, 0);
      if (set.coincident && coincident.indexOf(source) === -1)
        coincident.push(source);
      set.events.forEach(function (event) {
        contactEvents.push({kind:'contact', source:source, t:event.t,
          residual:event.residual});
      });
    });
    return {ok:true, intervals:intervals, events:events,
      contactEvents:contactEvents, coincident:coincident, residual:residual,
      source:source, inset:inset};
  }
  function trimLineFiniteIntervals(volume, role, branch, tolerance) {
    var origin = branch.origin, direction = unit(branch.direction);
    var intervals = [{start:-Infinity, end:Infinity}];
    function le(A, B) { intervals = trimIntersectIntervals(intervals, trimLinearLe(A, B)); }
    if (volume.kind === 'cylinder' && role === 'side') {
      var axis = unit(volume.axis);
      var s0 = dot(sub(origin, volume.origin), axis);
      var s1 = dot(direction, axis);
      le(-s1, -s0);
      le(s1, s0 - volume.depth);
    } else if (volume.kind === 'cylinder' && role === 'bottom') {
      var center = trimCylinderBottomCenter(volume);
      var delta = sub(origin, center);
      intervals = trimIntersectIntervals(intervals,
        trimQuadraticLe(dot(direction, direction), 2 * dot(delta, direction),
          dot(delta, delta) - volume.radius * volume.radius, tolerance));
    } else if (volume.kind === 'cone' && role === 'side') {
      var coneAxis = unit(volume.axis);
      var coneStation = dot(sub(origin, volume.origin), coneAxis);
      var coneRate = dot(direction, coneAxis);
      le(-coneRate, -coneStation);
      le(coneRate, coneStation - volume.depth);
    } else if (volume.kind === 'cone' && role === 'bottom') {
      var coneCenter = volume.bottomCenter ||
        add(volume.origin, mul(unit(volume.axis), volume.depth));
      var coneDelta = sub(origin, coneCenter);
      var coneRadius = Number.isFinite(volume.bottomRadius) ?
        volume.bottomRadius : volume.radius;
      intervals = trimIntersectIntervals(intervals,
        trimQuadraticLe(dot(direction, direction), 2 * dot(coneDelta, direction),
          dot(coneDelta, coneDelta) - coneRadius * coneRadius, tolerance));
    } else if (volume.kind === 'sphere' && role === 'cap') {
      var outward = unit(volume.outward);
      le(dot(direction, outward), dot(sub(origin, volume.mouthCenter), outward));
    } else return {ok:false, status:'unresolved', reason:'finite-domain-unsupported'};
    return {ok:true, intervals:intervals, method:'event-intervals'};
  }
  function trimLineInsideVolume(volume, origin, direction, tolerance) {
    var strict = Math.max(tolerance, 1e-9);
    var intervals = [{start:-Infinity, end:Infinity}];
    function le(A, B) { intervals = trimIntersectIntervals(intervals, trimLinearLe(A, B)); }
    function quad(a, b, c) {
      intervals = trimIntersectIntervals(intervals, trimQuadraticLe(a, b, c, 1e-12));
    }
    if (volume.kind === 'cylinder') {
      var axis = unit(volume.axis);
      var s0 = dot(sub(origin, volume.origin), axis);
      var s1 = dot(direction, axis);
      le(-s1, -(s0 - strict));
      le(s1, s0 - (volume.depth - strict));
      var base = sub(sub(origin, volume.origin), mul(axis, s0));
      var velocity = sub(direction, mul(axis, s1));
      var radius = Math.max(0, volume.radius - strict);
      quad(dot(velocity, velocity), 2 * dot(base, velocity),
        dot(base, base) - radius * radius);
    } else if (volume.kind === 'cone') {
      var coneAxis = unit(volume.axis), coneStart = volume.radius;
      var coneEnd = Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : coneStart;
      var coneSlope = volume.depth > 0 ? (coneEnd - coneStart) / volume.depth : 0;
      var coneS0 = dot(sub(origin, volume.origin), coneAxis);
      var coneS1 = dot(direction, coneAxis);
      var coneBase = sub(sub(origin, volume.origin), mul(coneAxis, coneS0));
      var coneVelocity = sub(direction, mul(coneAxis, coneS1));
      var coneRadiusAt0 = coneStart + coneSlope * coneS0 - strict;
      var coneRadiusRate = coneSlope * coneS1;
      le(-coneS1, -(coneS0 - strict));
      le(coneS1, coneS0 - (volume.depth - strict));
      quad(dot(coneVelocity, coneVelocity) -
          coneRadiusRate * coneRadiusRate,
        2 * dot(coneBase, coneVelocity) -
          2 * coneRadiusAt0 * coneRadiusRate,
        dot(coneBase, coneBase) - coneRadiusAt0 * coneRadiusAt0);
    } else if (volume.kind === 'sphere') {
      var delta = sub(origin, volume.center);
      var sphereRadius = Math.max(0, volume.radius - strict);
      quad(dot(direction, direction), 2 * dot(delta, direction),
        dot(delta, delta) - sphereRadius * sphereRadius);
      var outward = unit(volume.outward);
      le(dot(direction, outward),
        dot(sub(origin, volume.mouthCenter), outward) + strict);
    }
    return intervals;
  }
  function implicitLineIntervals(volume, origin, direction, options) {
    if (!Implicit || !volume || !finite(origin) || !finite(direction)) return null;
    var spec = Implicit.volumeConstraints(volume);
    if (!spec) return null;
    return Implicit.lineConstraintIntervals(spec.constraints, {origin:origin, direction:direction},
      options || {});
  }
  function implicitEquation(surface, options) {
    return implicitEquationFor(surface, options);
  }
  function trimSubtractIntervals(base, cuts) {
    var out = [];
    base.forEach(function (interval) {
      var segments = [interval];
      cuts.forEach(function (cut) {
        var next = [];
        segments.forEach(function (segment) {
          if (cut.end <= segment.start || cut.start >= segment.end) {
            next.push(segment);
            return;
          }
          if (cut.start <= segment.start && cut.end >= segment.end) return;
          if (cut.start > segment.start)
            next.push({start:segment.start, end:Math.min(cut.start, segment.end)});
          if (cut.end < segment.end)
            next.push({start:Math.max(cut.end, segment.start), end:segment.end});
        });
        segments = next;
      });
      out = out.concat(segments);
    });
    return out.filter(function (segment) { return segment.end - segment.start > 1e-12; });
  }
  function trimBranchKind(branch) {
    if (branch.kind === 'line') return 'line';
    var radiiUV = radii(branch);
    return Math.abs(radiiUV.u - radiiUV.v) <= 1e-9 * Math.max(1, radiiUV.u, radiiUV.v) ?
      'circle' : 'ellipse';
  }
  function trimBoundBranch(branch, sa, sb, volumes, group, tolerance) {
    var kind = trimBranchKind(branch);
    var first = kind === 'line' ?
      trimLineFiniteIntervals(sa.volume, sa.role, branch, tolerance) :
      trimCurveFiniteIntervals(sa.volume, sa.role, branch, tolerance);
    if (!first.ok) return first;
    var second = kind === 'line' ?
      trimLineFiniteIntervals(sb.volume, sb.role, branch, tolerance) :
      trimCurveFiniteIntervals(sb.volume, sb.role, branch, tolerance);
    if (!second.ok) return second;
    var intervals = trimIntersectIntervals(first.intervals, second.intervals);
    var subtraction = 'none', events = [], coincident = [];
    (first.events || []).concat(second.events || []).forEach(function (event) {
      events.push(event);
    });
    (first.coincident || []).concat(second.coincident || []).forEach(function (source) {
      coincident.push(source);
    });
    function stationResidual(list, t) {
      var best = null, bestDistance = Infinity;
      (list || []).forEach(function (event) {
        if (!Number.isFinite(event.t)) return;
        var distance = Math.abs(event.t - t);
        distance = Math.min(distance, Math.abs(TAU - distance));
        if (distance < bestDistance && distance <= 1e-7) {
          bestDistance = distance;
          best = Number.isFinite(event.residual) ? event.residual : null;
        }
      });
      return best;
    }
    var removed = [];
    (group || []).forEach(function (index) {
      if (index === sa.volume.index || index === sb.volume.index) return;
      if (!volumes[index]) return;
      var inside = kind === 'line' ?
        {ok:true, intervals:trimLineInsideVolume(volumes[index], branch.origin,
          unit(branch.direction), tolerance), events:[]} :
        trimCurveInsideVolume(volumes[index], branch, tolerance);
      if (!inside.ok) return;
      var cuts = trimIntersectIntervals(intervals, inside.intervals);
      var positive = cuts.filter(function (cut) {
        return cut.end - cut.start > 1e-12;
      });
      (inside.coincident || []).forEach(function (source) {
        coincident.push('member-' + index + ':' + source);
      });
      if (positive.length) {
        positive.forEach(function (cut) {
          removed.push({member:index, start:cut.start, end:cut.end});
          events.push({kind:'occlusion', source:'member-' + index,
            member:index, t:cut.start,
            residual:stationResidual(inside.events, cut.start)});
          events.push({kind:'occlusion', source:'member-' + index,
            member:index, t:cut.end,
            residual:stationResidual(inside.events, cut.end)});
        });
        intervals = trimSubtractIntervals(intervals, positive);
        subtraction = 'event-intervals';
      } else if (kind !== 'line' && (inside.contactEvents || []).length) {
        var seenContact = {};
        intervals.forEach(function (interval) {
          inside.contactEvents.forEach(function (event) {
            var key = Math.round(event.t * 1e9);
            if (seenContact[key]) return;
            if (event.t >= interval.start - 1e-12 && event.t <= interval.end + 1e-12) {
              seenContact[key] = true;
              events.push({kind:'contact', source:event.source, member:index,
                t:event.t, residual:event.residual});
            }
          });
        });
      }
    });
    var components = [];
    var angularTolerance = tolerance / Math.max(1e-9, Math.min(
      Math.abs(radii(branch).u || 0), Math.abs(radii(branch).v || 0)));
    intervals.forEach(function (interval) {
      if (kind === 'line') {
        if (!Number.isFinite(interval.start) || !Number.isFinite(interval.end)) return;
        var start = add(branch.origin, mul(unit(branch.direction), interval.start));
        var end = add(branch.origin, mul(unit(branch.direction), interval.end));
        if (length(sub(end, start)) <= tolerance) return;
        var lineComponent = {kind:'line', start:copyPoint(start), end:copyPoint(end),
          origin:copyPoint(branch.origin), direction:copyPoint(unit(branch.direction)),
          startParameter:interval.start, endParameter:interval.end,
          bounded:true, supportStatus:'exact', boundsStatus:'exact',
          unionDomainSubtraction:subtraction, boundsMethod:'event-intervals'};
        var lineEvents = events.filter(function (event) {
          return Number.isFinite(event.t) && event.t >= interval.start - 1e-12 &&
            event.t <= interval.end + 1e-12;
        }).map(function (event) {
          return {kind:event.kind, source:event.source, member:event.member,
            t:event.t, residual:event.residual};
        });
        var lineResiduals = lineEvents.map(function (event) {
          return event.residual;
        }).filter(Number.isFinite);
        lineComponent.events = lineEvents;
        lineComponent.eventCount = lineEvents.length;
        lineComponent.residual = lineResiduals.length ?
          Math.max.apply(null, lineResiduals) : null;
        lineComponent.residualKnown = lineResiduals.length > 0;
        lineComponent.coincident = Array.from(new Set(coincident));
        lineComponent.coincidentCount = lineComponent.coincident.length;
        components.push(lineComponent);
        return;
      }
      if (interval.end - interval.start <= Math.max(1e-12, angularTolerance)) return;
      var radiiUV = radii(branch), circular = kind === 'circle';
      var full = Math.abs((interval.end - interval.start) - TAU) <= 1e-9;
      var point = {kind:full ? (circular ? 'circle' : 'ellipse') :
        (circular ? 'arc' : 'arc'), center:copyPoint(branch.center),
        u:copyPoint(branch.u), v:copyPoint(branch.v),
        startAngle:full ? 0 : interval.start,
        sweepAngle:full ? TAU : interval.end - interval.start,
        closed:full, bounded:true, supportStatus:'exact', boundsStatus:'exact',
        unionDomainSubtraction:subtraction, boundsMethod:'harmonic-event-intervals'};
      if (circular) point.radius = radiiUV.u;
      else { point.radiusU = radiiUV.u; point.radiusV = radiiUV.v; }
      point.start = copyPoint(curvePoint(point, point.startAngle));
      point.end = copyPoint(curvePoint(point, point.startAngle + point.sweepAngle));
      point.events = events.filter(function (event) {
        return event.t >= interval.start - 1e-12 &&
          event.t <= interval.end + 1e-12;
      }).map(function (event) {
        return {kind:event.kind, source:event.source, member:event.member,
          t:event.t, residual:event.residual};
      });
      point.eventCount = point.events.length;
      var knownResiduals = point.events.map(function (event) {
        return event.residual;
      }).filter(Number.isFinite);
      point.residual = knownResiduals.length ?
        Math.max.apply(null, knownResiduals) : null;
      point.residualKnown = knownResiduals.length > 0;
      point.coincident = Array.from(new Set(coincident));
      point.coincidentCount = point.coincident.length;
      components.push(point);
    });
    if (kind === 'line' && !components.length &&
        intervals.some(function (i) { return !Number.isFinite(i.start) || !Number.isFinite(i.end); }))
      return {ok:false, status:'unresolved', reason:'unbounded-trim-branch'};
    return {ok:true, components:components, method:'event-intervals'};
  }
  function trimSupportNormal(support, p) {
    var surface = support.surface;
    if (surface.kind === 'cylinder') {
      var axis = unit(surface.axis), d = sub(p, surface.origin);
      var radial = sub(d, mul(axis, dot(d, axis)));
      return length(radial) > 1e-12 ? unit(radial) : basis(axis).u;
    }
    if (surface.kind === 'cone') {
      var coneAxis = unit(surface.axis);
      var apex = finite(surface.apex) ? surface.apex : surface.origin;
      var delta = sub(p, apex);
      var station = dot(delta, coneAxis);
      var coneRadial = sub(delta, mul(coneAxis, station));
      if (length(coneRadial) <= 1e-12) return basis(coneAxis).u;
      var radialDirection = unit(coneRadial);
      var halfAngle = Number.isFinite(surface.halfAngle) ? surface.halfAngle :
        Math.atan2(surface.radius || 0, Math.abs(station));
      return unit(add(mul(radialDirection, Math.cos(halfAngle)),
        mul(coneAxis, station >= 0 ? -Math.sin(halfAngle) : Math.sin(halfAngle))));
    }
    if (surface.kind === 'sphere') return unit(sub(p, surface.center));
    if (surface.kind === 'plane') return unit(surface.normal);
    return null;
  }
  function trimSolveLinear(matrix, rhs) {
    var n = rhs.length, a = [], i, j, k;
    for (i = 0; i < n; i++) a.push(matrix[i].slice().concat([rhs[i]]));
    for (i = 0; i < n; i++) {
      var pivot = i;
      for (j = i + 1; j < n; j++)
        if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
      if (Math.abs(a[pivot][i]) <= 1e-14) return null;
      if (pivot !== i) { var row = a[i]; a[i] = a[pivot]; a[pivot] = row; }
      for (j = i + 1; j < n; j++) {
        var factor = a[j][i] / a[i][i];
        for (k = i; k <= n; k++) a[j][k] -= factor * a[i][k];
      }
    }
    var out = new Array(n);
    for (i = n - 1; i >= 0; i--) {
      var sum = a[i][n];
      for (j = i + 1; j < n; j++) sum -= a[i][j] * out[j];
      out[i] = sum / a[i][i];
    }
    return out;
  }
  function trimHullDistance(points) {
    var count = (points || []).length;
    if (!count) return 1;
    var best = 1;
    function consider(indices) {
      var m = indices.length, gram = [], rhs = [], i, j;
      for (i = 0; i < m; i++) {
        gram.push([]);
        for (j = 0; j < m; j++)
          gram[i].push(2 * dot(points[indices[i]], points[indices[j]]));
        gram[i].push(1);
      }
      var last = [];
      for (i = 0; i < m; i++) last.push(1);
      last.push(0);
      gram.push(last);
      for (i = 0; i < m; i++) rhs.push(0);
      rhs.push(1);
      var solution = trimSolveLinear(gram, rhs);
      if (!solution) return;
      var lambda = solution.slice(0, m);
      for (i = 0; i < m; i++) if (lambda[i] < -1e-9) return;
      var point = {x:0, y:0, z:0};
      for (i = 0; i < m; i++) point = add(point, mul(points[indices[i]], lambda[i]));
      best = Math.min(best, length(point));
    }
    var subset = [];
    function enumerate(start) {
      if (subset.length) consider(subset.slice());
      if (subset.length === 4 || start >= count) return;
      for (var index = start; index < count; index++) {
        subset.push(index);
        enumerate(index + 1);
        subset.pop();
      }
    }
    enumerate(0);
    return best;
  }
  function trimVolumeBoundaryState(volume, p, tolerance) {
    if (volume.kind === 'cylinder') {
      var axis = unit(volume.axis), delta = sub(p, volume.origin);
      var axial = dot(delta, axis);
      var radialVector = sub(delta, mul(axis, axial));
      var radial = length(radialVector);
      var tol = Math.max(tolerance, 1e-9 * Math.max(1, volume.radius));
      if (axial < -tol || axial > volume.depth + tol ||
          radial > volume.radius + tol) return {state:'outside'};
      var normals = [], corner = false;
      if (Math.abs(radial - volume.radius) <= tol) {
        normals.push(radial > 1e-12 ? unit(radialVector) : basis(axis).u);
      } else if (radial < volume.radius - tol) {
        if (axial > tol && axial < volume.depth - tol) return {state:'inside'};
        corner = true;
      }
      if (Math.abs(axial) <= tol) { normals.push(mul(axis, -1)); corner = normals.length > 1; }
      else if (Math.abs(axial - volume.depth) <= tol) {
        normals.push(axis); corner = normals.length > 1;
      } else if (axial > tol && axial < volume.depth - tol && normals.length === 0) {
        return {state:'inside'};
      }
      if (!normals.length) return {state:'outside'};
      return {state:'boundary', normals:normals, corner:corner};
    }
    if (volume.kind === 'cone') {
      var axis = unit(volume.axis), delta = sub(p, volume.origin);
      var axial = dot(delta, axis);
      var radialVector = sub(delta, mul(axis, axial));
      var radial = length(radialVector);
      var coneTol = Math.max(tolerance, 1e-9 * Math.max(1, volume.radius,
        Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : volume.radius));
      if (axial < -coneTol || axial > volume.depth + coneTol ||
          radial > axialVolumeRadius(volume, axial) + coneTol) return {state:'outside'};
      var start = volume.radius;
      var end = Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : start;
      var slope = volume.depth > 0 ? (end - start) / volume.depth : 0;
      var apexStation = Math.abs(slope) > EPS ? -start / slope : -Infinity;
      var nappe = axial >= apexStation ? 1 : -1;
      var halfAngle = Math.atan2(Math.abs(slope), 1);
      var coneNormals = [], coneCorner = false;
      var profile = axialVolumeRadius(volume, axial);
      if (Math.abs(radial - profile) <= coneTol) {
        var radialDirection = radial > 1e-12 ? unit(radialVector) :
          basis(axis).u;
        coneNormals.push(unit(add(mul(radialDirection, Math.cos(halfAngle)),
          mul(axis, -nappe * Math.sin(halfAngle)))));
      } else if (radial < profile - coneTol) {
        if (axial > coneTol && axial < volume.depth - coneTol)
          return {state:'inside'};
        coneCorner = true;
      }
      if (Math.abs(axial) <= coneTol) {
        coneNormals.push(mul(axis, -1));
        coneCorner = coneNormals.length > 1;
      } else if (Math.abs(axial - volume.depth) <= coneTol &&
                 end > 1e-12 && volume.openBottom !== true) {
        coneNormals.push(axis);
        coneCorner = coneNormals.length > 1;
      } else if (axial > coneTol && axial < volume.depth - coneTol &&
                 coneNormals.length === 0) {
        return {state:'inside'};
      }
      if (!coneNormals.length) return {state:'boundary', normals:[], corner:false};
      return {state:'boundary', normals:coneNormals, corner:coneCorner};
    }
    if (volume.kind === 'sphere') {
      var distance = length(sub(p, volume.center));
      var plane = dot(sub(p, volume.mouthCenter), unit(volume.outward));
      var sphereTol = Math.max(tolerance, 1e-9 * Math.max(1, volume.radius));
      if (distance > volume.radius + sphereTol || plane > sphereTol)
        return {state:'outside'};
      var sphereNormals = [], sphereCorner = false;
      if (Math.abs(distance - volume.radius) <= sphereTol)
        sphereNormals.push(unit(sub(p, volume.center)));
      else if (distance < volume.radius - sphereTol) {
        if (plane < -sphereTol) return {state:'inside'};
        sphereCorner = true;
      }
      if (Math.abs(plane) <= sphereTol) {
        sphereNormals.push(unit(volume.outward));
        sphereCorner = sphereNormals.length > 1;
      } else if (plane < -sphereTol && sphereNormals.length === 0) {
        return {state:'inside'};
      }
      if (!sphereNormals.length) return {state:'outside'};
      return {state:'boundary', normals:sphereNormals, corner:sphereCorner};
    }
    return {state:'outside'};
  }
  function trimClassifyComponent(component, sa, sb, volumes, group, tolerance, record) {
    var relation = record.supportRelation ||
      (record.support && record.support.relation) || null;
    if (relation === 'tangent')
      return {role:'contact', method:'tangent-support', exposureStatus:'numeric'};
    if (relation !== 'transverse')
      return {role:'boundary', method:'support-relation-unproven',
        exposureStatus:'unresolved', reason:'normal-topology-unresolved'};
    var parameters;
    if (component.kind === 'line') {
      var first = component.startParameter, last = component.endParameter;
      parameters = [first + (last - first) * 0.5,
        first + (last - first) * 0.25, first + (last - first) * 0.75];
    } else {
      var start = component.startAngle, sweep = component.sweepAngle;
      parameters = [start + sweep * 0.5, start + sweep * 0.25,
        start + sweep * 0.75];
    }
    var thirdActive = false, stable = true, signature = null;
    var insideMember = false, corner = false, pointed = false;
    var coveredCount = 0, exposedCount = 0, margin = Infinity;
    parameters.forEach(function (t) {
      var p = component.kind === 'line' ?
        add(component.origin, mul(component.direction, t)) : curvePoint(component, t);
      var normals = [], active = [];
      (group || [sa.volume.index, sb.volume.index]).forEach(function (index) {
        var state = trimVolumeBoundaryState(volumes[index], p, tolerance);
        if (state.state === 'inside') insideMember = true;
        if (state.state === 'boundary') {
          active.push(index);
          (state.normals || []).forEach(function (normal) {
            if (finite(normal)) normals.push(unit(normal));
          });
          if (state.corner) corner = true;
          if (index !== sa.volume.index && index !== sb.volume.index)
            thirdActive = true;
        }
      });
      active.sort(function (a, b) { return a - b; });
      var key = active.join(',');
      if (signature === null) signature = key;
      else if (signature !== key) stable = false;
      if (!normals.length) return;
      var distance = trimHullDistance(normals);
      margin = Math.min(margin, distance);
      if (distance <= 1e-6) coveredCount++;
      else exposedCount++;
      if (distance > 1e-6 && distance > 1e-3) pointed = true;
    });
    if (insideMember)
      return {role:'internal', exposureStatus:'unresolved',
        method:'member-normal-cone', reason:'member-interior-evidence'};
    if (!stable || corner)
      return {role:'boundary', exposureStatus:'unresolved',
        method:'member-normal-cone', reason:'multi-member-topology-unresolved',
        evidence:{margin:margin}};
    if (coveredCount && !exposedCount)
      return {role:'internal', exposureStatus:'unresolved',
        method:'member-normal-cone', reason:'union-normal-cone-covered',
        evidence:{margin:margin}};
    if (coveredCount && exposedCount)
      return {role:'unresolved', exposureStatus:'unresolved',
        method:'member-normal-cone', reason:'union-normal-cone-transition',
        evidence:{margin:margin}};
    if (!pointed)
      return {role:'boundary', exposureStatus:'unresolved',
        method:'member-normal-cone', reason:'narrow-exterior-cone',
        evidence:{margin:margin}};
    if (thirdActive)
      return {role:'boundary', exposureStatus:'numeric',
        method:'member-normal-cone', reason:'multi-member-exterior-wedge',
        evidence:{margin:margin}};
    return {role:'boundary', exposureStatus:'exact',
      method:'transverse-analytic', evidence:{margin:margin}};
  }
  function trimSerializeCurve(curve) {
    if (!curve) return null;
    var out = {kind:curve.kind || 'circle', center:copyPoint(curve.center),
      u:copyPoint(curve.u), v:copyPoint(curve.v)};
    if (curve.radiusU !== undefined || curve.radiusV !== undefined) {
      out.radiusU = curve.radiusU === undefined ? curve.radius : curve.radiusU;
      out.radiusV = curve.radiusV === undefined ? curve.radius : curve.radiusV;
    } else out.radius = curve.radius;
    if (curve.origin) out.origin = copyPoint(curve.origin);
    if (curve.direction) out.direction = copyPoint(curve.direction);
    return out;
  }
  function trimJsonClone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  function trimSerializeSupport(support) {
    if (!support) return {kind:'unsupported', reason:'analytic-support-unimplemented'};
    var out = {kind:support.kind, relation:support.relation || null};
    if (support.contract) out.contract = support.contract;
    if (support.kind === 'circle' || support.kind === 'ellipse') {
      var curve = trimSerializeCurve(support);
      Object.keys(curve).forEach(function (key) { out[key] = curve[key]; });
    } else if (support.kind === 'circles') {
      out.circles = (support.circles || []).map(trimSerializeCurve).filter(Boolean);
    } else if (support.kind === 'line') {
      out.origin = copyPoint(support.origin);
      out.direction = copyPoint(support.direction);
    } else if (support.kind === 'lines') {
      out.lines = (support.lines || []).map(function (line) {
        return {origin:copyPoint(line.origin), direction:copyPoint(line.direction)};
      });
    } else if (support.kind === 'point') {
      out.point = copyPoint(support.point);
    } else if (support.kind === 'points') {
      out.points = (support.points || []).map(copyPoint).filter(Boolean);
    } else if (support.kind === 'plane-overlap') {
      out.plane = support.plane ? {origin:copyPoint(support.plane.origin),
        normal:copyPoint(support.plane.normal)} : null;
    } else if (support.kind === 'coincident') {
      ['origin', 'center', 'axis'].forEach(function (key) {
        if (finite(support[key])) out[key] = copyPoint(support[key]);
      });
      if (Number.isFinite(support.radius)) out.radius = support.radius;
    } else if (support.kind === 'unsupported') {
      out.reason = support.reason || null;
      out.guarantee = support.guarantee || 'numeric';
    } else if (support.kind === 'none' || support.kind === 'implicit-intersection') {
      ['proven', 'separated', 'supportOnly', 'status', 'guarantee', 'method', 'topologyCertified',
        'bounds', 'equations', 'constraints', 'evidence', 'coincidence', 'legacy',
        'unresolvedDomain', 'diagnostic', 'display'].forEach(function (key) {
        if (support[key] !== undefined) out[key] = trimJsonClone(support[key]);
      });
    }
    if (Array.isArray(support.surfaceIds)) out.surfaceIds = support.surfaceIds.slice();
    if (Array.isArray(support.surfaceKinds)) out.surfaceKinds = support.surfaceKinds.slice();
    return out;
  }
  function trimRecordStatus(record) {
    return [record.supportStatus || 'exact', record.boundsStatus || 'none',
      record.exposureStatus || 'none'].reduce(trimWorst, 'none');
  }
  function trimSupportPair(sa, sb, relation, volumes, group, tolerance) {
    var support = intersect(sa.surface, sb.surface);
    var record = {aVolume:sa.volume.index, bVolume:sb.volume.index,
      aRole:sa.role, bRole:sb.role, aSurfaceId:sa.surfaceId, bSurfaceId:sb.surfaceId,
      relation:relation.relation, kind:support && support.kind || null,
      support:trimSerializeSupport(support), supportStatus:'exact',
      boundsStatus:'none', exposureStatus:'none', status:'exact', role:null, reason:null,
      domain:[trimDomainRecord(sa.volume, sa.role), trimDomainRecord(sb.volume, sb.role)],
      sourceIds:Array.from(new Set((sa.sourceIds || []).concat(sb.sourceIds || []))),
      branches:[], excluded:0};
    if (!support) {
      record.supportStatus = 'unsupported';
      record.status = 'unsupported';
      record.reason = 'analytic-support-unimplemented';
      return record;
    }
    record.kind = support.kind;
    record.supportRelation = support.relation || relation.relation;
    if (support.kind === 'implicit-intersection') {
      record.supportStatus = 'implicit';
      record.boundsStatus = 'unresolved';
      record.exposureStatus = 'unresolved';
      record.status = 'unresolved';
      record.role = support.relation === 'coincident-support' ? 'coincident' : null;
      record.reason = support.relation === 'coincident-support' ?
        'implicit-coincident-support-domain-unresolved' :
        (support.supportOnly ? 'implicit-support-only-domain-unresolved' :
          'implicit-support-topology-numeric');
      record.exactness = 'algebraic-set';
      record.guarantee = support.guarantee || 'algebraic-set';
      record.topologyCertified = false;
      record.domainStatus = support.supportOnly ? 'unresolved-support-only' : 'algebraic-only';
      record.supportOnly = !!support.supportOnly;
      if (support.equations) record.equations = trimJsonClone(support.equations);
      if (support.evidence) record.evidence = trimJsonClone(support.evidence);
      return record;
    }
    if (support.kind === 'none' && support.proven === false) {
      record.supportStatus = 'numeric';
      record.boundsStatus = 'none';
      record.exposureStatus = 'unresolved';
      record.status = 'unresolved';
      record.reason = 'numeric-interval-separation-not-certified';
      record.coverage = {complete:false, uncertain:true};
      return record;
    }
    if (support.kind === 'unsupported') {
      record.supportStatus = 'unsupported';
      record.status = 'unsupported';
      record.reason = support.reason || 'analytic-support-unsupported';
      return record;
    }
    if (support.kind === 'none') {
      record.supportStatus = 'none';
      record.status = 'none';
      return record;
    }
    if (support.kind === 'coincident' || support.kind === 'plane-overlap') {
      record.supportStatus = 'exact';
      record.boundsStatus = 'none';
      record.exposureStatus = 'unresolved';
      record.status = 'unresolved';
      record.role = 'coincident';
      record.reason = support.kind === 'plane-overlap' ?
        'coincident-plane-topology-unresolved' : 'coincident-support-topology-unresolved';
      if (support.kind === 'plane-overlap' && support.plane && finite(support.plane.normal)) {
        var plane = support.plane;
        var referenceA = volumeInteriorReference(sa.volume);
        var referenceB = volumeInteriorReference(sb.volume);
        if (finite(referenceA) && finite(referenceB)) {
          var sideA = dot(unit(plane.normal), sub(referenceA, plane.origin));
          var sideB = dot(unit(plane.normal), sub(referenceB, plane.origin));
          if (sideA * sideB < 0) {
            record.role = 'internal';
            record.reason = 'opposed-cap-contact-uncertified';
            record.evidence = {contact:relation.contact || null};
          } else if (sideA * sideB > 0) {
            record.reason = 'same-facing-common-floor-topology-unresolved';
          }
        }
      }
      return record;
    }
    if (support.kind === 'point' || support.kind === 'points') {
      var points = support.kind === 'point' ? [copyPoint(support.point)] :
        (support.points || []).map(copyPoint).filter(Boolean);
      points = points.filter(function (point) {
        return trimVolumeContains(sa.volume, point, tolerance) &&
          trimVolumeContains(sb.volume, point, tolerance);
      });
      if (!points.length) {
        record.supportStatus = 'exact';
        record.boundsStatus = 'exact';
        record.exposureStatus = 'none';
        record.status = 'none';
        return record;
      }
      record.supportStatus = 'exact';
      record.boundsStatus = 'exact';
      record.exposureStatus = 'numeric';
      record.status = 'numeric';
      record.role = 'contact';
      record.points = points;
      record.reason = 'tangent-point-contact';
      return record;
    }
    var branches;
    if (support.kind === 'circle' || support.kind === 'ellipse') branches = [support];
    else if (support.kind === 'circles') branches = support.circles || [];
    else if (support.kind === 'line') branches = [support];
    else if (support.kind === 'lines') branches = support.lines || [];
    else {
      record.supportStatus = 'unsupported';
      record.status = 'unsupported';
      record.reason = 'bounded-support-kind';
      return record;
    }
    record.boundsStatus = 'exact';
    branches.forEach(function (branch) {
      if (!branch.kind) branch.kind = finite(branch.center) ? 'circle' : 'line';
      var bounded = trimBoundBranch(branch, sa, sb, volumes, group, tolerance);
      if (!bounded.ok) {
        record.boundsStatus = trimWorst(record.boundsStatus, bounded.status || 'unresolved');
        record.reason = record.reason || bounded.reason || 'trim-bounds-unresolved';
        return;
      }
      bounded.components.forEach(function (component) {
        var classification = trimClassifyComponent(component, sa, sb, volumes,
          group, tolerance, record);
        component.role = classification.role;
        component.classification = classification.method;
        component.reason = classification.reason || null;
        component.exposureStatus = classification.exposureStatus || 'numeric';
        component.status = trimWorst(component.boundsStatus || 'exact',
          component.exposureStatus);
        if (component.role === 'outside') record.excluded++;
        record.branches.push(component);
      });
    });
    record.exposureStatus = record.branches.length ?
      record.branches.reduce(function (worst, branch) {
        return trimWorst(worst, branch.exposureStatus || 'numeric');
      }, 'none') : 'none';
    if (record.branches.length) {
      record.branches.forEach(function (branch) {
        record.status = trimWorst(record.status, branch.status || 'exact');
      });
    } else if (record.supportStatus === 'exact' && record.boundsStatus === 'exact') {
      record.status = 'none';
    }
    record.status = trimRecordStatus(record);
    return record;
  }
  function trimUnionGroup(relation, unions) {
    for (var i = 0; i < unions.length; i++) {
      var members = (unions[i].members || []).map(function (member) { return member.volume; });
      if (members.indexOf(relation.a) !== -1 && members.indexOf(relation.b) !== -1)
        return members;
    }
    return [relation.a, relation.b];
  }
  function cavityTrims(model, geometry) {
    var volumes = geometry && geometry.cavityVolumes || [];
    var relations = geometry && geometry.cavityRelations || [];
    var unions = geometry && geometry.cavityUnions || [];
    var result = {contract:CAVITY_TRIM_CONTRACT, version:1, status:'none',
      exactness:'none', pairs:[], boundaries:[], diagnostics:[]};
    if (!volumes.length || !relations.length) return result;
    var tolerance = trimTolerance(volumes);
    relations.forEach(function (relation) {
      if (!relation || relation.relation === 'separate') return;
      var a = volumes[relation.a], b = volumes[relation.b];
      if (!a || !b) return;
      var group = trimUnionGroup(relation, unions);
      var pair = {a:relation.a, b:relation.b, relation:relation.relation,
        status:'exact', exactness:'exact', kind:null, reason:null, supports:[], boundaries:0};
      if (relation.relation === 'duplicate') {
        pair.kind = 'duplicate';
        pair.role = 'internal';
        pair.reason = 'duplicate-cavity-member';
        result.pairs.push(pair);
        return;
      }
      var supportsA = trimSupportsFor(a, model), supportsB = trimSupportsFor(b, model);
      supportsA.forEach(function (sa) {
        supportsB.forEach(function (sb) {
          var record = trimSupportPair(sa, sb, relation, volumes, group, tolerance);
          pair.supports.push(record);
          pair.boundaries += record.branches.length;
          record.branches.forEach(function (branch) {
            var boundary = {};
            Object.keys(branch).forEach(function (key) { boundary[key] = branch[key]; });
            boundary.contract = CAVITY_TRIM_CONTRACT;
            boundary.memberVolumes = [relation.a, relation.b];
            boundary.surfaceIds = [sa.surfaceId, sb.surfaceId];
            boundary.supportKind = record.kind;
            boundary.supportRelation = record.supportRelation;
            boundary.sourceIds = Array.from(new Set((sa.sourceIds || [])
              .concat(sb.sourceIds || [])));
            boundary.domain = record.domain;
            result.boundaries.push(boundary);
          });
          if (record.status === 'unsupported' || record.status === 'unresolved' ||
              record.status === 'numeric')
            result.diagnostics.push({code:'cavity-trim-' + record.status,
              message:'Cavity trim support pair ' + sa.role + '/' + sb.role + ' is ' +
                record.status + (record.reason ? ': ' + record.reason : ''),
              pair:[relation.a, relation.b],
              surfaceIds:[sa.surfaceId, sb.surfaceId],
              sourceIds:record.sourceIds.slice()});
        });
      });
      pair.status = pair.supports.reduce(function (worst, support) {
        return trimWorst(worst, support.status);
      }, 'exact');
      if (pair.status === 'none') pair.status = 'exact';
      pair.exactness = pair.status;
      result.pairs.push(pair);
    });
    var worst = 'none';
    result.pairs.forEach(function (pair) { worst = trimWorst(worst, pair.status); });
    result.exactness = worst;
    result.status = result.pairs.length ? 'partial' : 'none';
    result.boundaryCount = result.boundaries.length;
    result.visible = result.boundaries.filter(function (b) { return b.role === 'boundary'; }).length;
    result.internal = result.boundaries.filter(function (b) { return b.role === 'internal'; }).length;
    result.contact = result.boundaries.filter(function (b) { return b.role === 'contact'; }).length;
    result.unsupported = result.pairs.reduce(function (count, pair) {
      return count + pair.supports.filter(function (support) {
        return support.status === 'unsupported';
      }).length;
    }, 0);
    result.unresolved = result.pairs.reduce(function (count, pair) {
      return count + pair.supports.filter(function (support) {
        return support.status === 'unresolved';
      }).length;
    }, 0);
    result.numeric = result.pairs.reduce(function (count, pair) {
      return count + pair.supports.filter(function (support) {
        return support.status === 'numeric';
      }).length;
    }, 0);
    result.exact = result.pairs.reduce(function (count, pair) {
      return count + pair.supports.filter(function (support) {
        return support.status === 'exact';
      }).length;
    }, 0);
    return result;
  }

  function build(geometry, options) {
    if (!geometry) return null;
    var model = {version:1, contract:'analytic-surface-v1', surfaces:[], diagnostics:[]};
    var vertices = geometry.vertices || [], curves = geometry.curves || [], faces = geometry.faces || [];
    function diag(code, message, sourceIds) {
      model.diagnostics.push({code:code, message:message, sourceIds:sourceIds || []});
    }
    function addSurface(surface, patch) {
      if (!surface) return;
      surface.id = 'surface:' + model.surfaces.length;
      surface.inferred = true;
      if (surface.implicit && surface.implicit.identity) {
        surface.implicit.identity.surfaceId = surface.id;
        if (surface.implicit.sourceEvidence)
          surface.implicit.sourceEvidence.surfaceIds = [surface.id];
      }
      surface.closed = !!surface.closed;
      if (patch) {
        if (patch.approximateTrim) surface.approximateBoundary = true;
        if (patch.displayOnlyBoundary) surface.displayOnlyBoundary = true;
        if (patch.booleanDomain) surface.booleanDomain = patch.booleanDomain;
        if (patch.unionGroup !== undefined) surface.unionGroup = patch.unionGroup;
        if (patch.volumeIndex !== undefined) surface.volumeIndex = patch.volumeIndex;
        if (patch.memberRole) surface.memberRole = patch.memberRole;
      }
      if (Implicit && IMPLICIT_KINDS[surface.kind] && surface.kind !== 'implicit') {
        try {
          var equation = Implicit.equation(surface, {inferred:true});
          if (equation) surface.implicit = equation;
        } catch (err) {}
      }
      model.surfaces.push(surface);
    }
    function unique(list) {
      var out = [];
      (list || []).forEach(function (v) { if (out.indexOf(v) === -1) out.push(v); });
      return out;
    }
    function copyLoopInput(loop) {
      if (!loop || typeof loop !== 'object') return null;
      var out = {kind:loop.kind || 'outer'};
      if (Array.isArray(loop.vertices)) out.vertices = loop.vertices.slice();
      if (Array.isArray(loop.curves)) out.curves = loop.curves.slice();
      if (Array.isArray(loop.lines)) out.lines = loop.lines.slice();
      if (Array.isArray(loop.elements)) out.elements = loop.elements.slice();
      if (Array.isArray(loop.points)) out.points = loop.points.slice();
      if (loop.section) out.section = loop.section;
      return out;
    }
    function loopInputValid(loop) {
      if (!loop || (!loop.vertices && !loop.curves && !loop.lines &&
          !loop.section && !loop.elements && !loop.points)) return false;
      if (loop.vertices && loop.vertices.length < 2) return false;
      var okay = true;
      (loop.curves || []).forEach(function (i) { if (!validCurve(curves[i])) okay = false; });
      (loop.lines || []).forEach(function (l) { if (!validLine(l)) okay = false; });
      if (loop.section && !validCurve(loop.section)) okay = false;
      (loop.elements || []).forEach(function (el) {
        if (!el) { okay = false; return; }
        if (el.kind === 'curve') { if (!validCurve(el.curve)) okay = false; }
        else if (el.kind === 'polyline') {
          if (!Array.isArray(el.points) || el.points.length < 2 ||
              el.points.some(function (p) { return !finite(p); })) okay = false;
        } else okay = false;
      });
      (loop.points || []).forEach(function (p) { if (!finite(p)) okay = false; });
      return okay;
    }




    function patchLoops(patch, sourceIds) {
      if (!patch.loops || !patch.loops.length) return {loops:null, ok:true};
      var loops = patch.loops.map(copyLoopInput);
      if (loops.some(function (l) { return !loopInputValid(l); })) {
        diag('surface-invalid-boundary', 'A patch references a missing, degenerate or invalid loop element.', sourceIds);
        return {loops:null, ok:false};
      }
      return {loops:loops, ok:true};
    }
    function loopCurveIndices(loops) {
      var out = [];
      (loops || []).forEach(function (l) {
        (l.curves || []).forEach(function (i) { if (out.indexOf(i) === -1) out.push(i); });
      });
      return out;
    }
    var patches = (geometry.surfacePatches || []).slice();


    if (!patches.length && geometry.faceRegions) patches = geometry.faceRegions.map(function (region) {
      return {kind:'plane', outer:region.outer, holes:region.holes || []};
    });
    patches.forEach(function (patch, pi) {
      var sourceIds = (patch.sourceIds || []).slice(), surface = null;
      var requested = patchLoops(patch, sourceIds);
      if (!requested.ok) return;
      try {
        if (patch.kind === 'sphere') {
          if (!finite(patch.center) || !(patch.radius > 0)) {
            diag('surface-invalid-sphere', 'A sphere needs a finite centre and positive radius.', sourceIds); return;
          }


          var sphereBoundary = (patch.boundaryCurves || []).slice();
          var sphereLoops = [];
          if (requested.loops) {
            sphereLoops = requested.loops;
            sphereBoundary = loopCurveIndices(sphereLoops);
          } else if (patch.curveLoops && patch.curveLoops.length) {
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
        } else if (patch.kind === 'torus') {
          var major = patch.majorRadius !== undefined ? patch.majorRadius : patch.major;
          var minor = patch.minorRadius !== undefined ? patch.minorRadius : patch.minor;
          var torusAxis = patch.axis && finite(patch.axis) ? unitOrNull(patch.axis) : null;
          if (!finite(patch.center) || !(major > 0) || !(minor > 0) || !torusAxis) {
            diag(torusAxis === null && patch.axis ? 'surface-invalid-axis' : 'surface-invalid-torus',
              'A torus needs a finite centre, a nonzero unit axis and positive major/minor radii.', sourceIds);
            return;
          }
          var torusLoops = requested.loops || [];
          surface = {kind:'torus', origin:patch.center, center:patch.center,
            axis:torusAxis, majorRadius:major, minorRadius:minor, radius:minor,
            loops:torusLoops, closed:torusLoops.length === 0 && patch.closed !== false,
            sourceIds:sourceIds,
            displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
          if (patch.domain) {
            if (validTorusDomain(patch.domain))
              surface.domain = {u:patch.domain.u.slice(), v:patch.domain.v.slice()};
            else diag('surface-invalid-torus-domain',
              'A torus parameter domain needs finite increasing u and v intervals no longer than one turn.',
              sourceIds);
          }
        } else if (patch.kind === 'implicit') {
          var implicitPatch = patch.implicit ? Implicit.normalizeEquation(patch.implicit) : null;
          if (!implicitPatch) {
            diag('surface-invalid-implicit', 'An implicit patch needs a valid equation.', sourceIds); return;
          }
          var implicitBoundary = requested.loops ? loopCurveIndices(requested.loops) :
            (patch.boundaryCurves || []).slice();
          if (implicitBoundary.some(function (i) { return !validCurve(curves[i]); })) {
            diag('surface-invalid-boundary', 'An implicit patch references a missing analytic boundary.', sourceIds); return;
          }
          var implicitLoops = requested.loops ||
            implicitBoundary.map(function (i) { return {kind:'outer', curves:[i]}; });
          surface = {kind:'implicit', analyticKind:patch.analyticKind || 'implicit',
            origin:patch.origin || implicitPatch.frame.origin, implicit:implicitPatch,
            loops:implicitLoops, boundaryCurves:implicitBoundary, closed:false,
            sourceIds:sourceIds, displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
          if (patch.generator) surface.generator = JSON.parse(JSON.stringify(patch.generator));
          if (patch.apex) surface.apex = patch.apex;
          if (patch.inference) surface.inference = JSON.parse(JSON.stringify(patch.inference));
          if (patch.displayTessellation)
            surface.displayTessellation = JSON.parse(JSON.stringify(patch.displayTessellation));
        } else if (patch.kind === 'plane') {
          if (requested.loops) {
            var origin = patch.origin, normal = patch.normal, u = patch.u, v = patch.v;
            if ((!finite(origin) || !finite(normal)) && patch.outer && patch.outer.length >= 3) {
              var explicitPts = patch.outer.map(function (i) { return vertices[i]; });
              if (explicitPts.some(function (p) { return !finite(p); })) {
                diag('surface-invalid-boundary', 'A planar boundary references a missing vertex.', sourceIds); return;
              }
              origin = explicitPts[0];
              normal = newell(explicitPts);
              if (!normal) { diag('surface-degenerate-plane', 'A planar boundary has no area.', sourceIds); return; }
              var explicitBasis = basis(normal);
              u = explicitBasis.u; v = explicitBasis.v;
            }
            if (!finite(origin) || !finite(normal)) {
              var firstPlaneCurve = null;
              requested.loops.some(function (l) {
                (l.curves || []).some(function (i) {
                  if (validCurve(curves[i])) { firstPlaneCurve = curves[i]; return true; }
                  return false;
                });
                return !!firstPlaneCurve;
              });
              if (firstPlaneCurve) {
                origin = firstPlaneCurve.center;
                normal = curveNormal(firstPlaneCurve);
                u = firstPlaneCurve.u; v = firstPlaneCurve.v;
              }
            }
            if (!finite(origin) || !finite(normal)) {
              diag('surface-unbounded-plane', 'A planar patch with explicit loops needs an origin and normal.', sourceIds); return;
            }
            normal = unitOrNull(normal);
            if (!normal) {
              diag('surface-invalid-normal', 'A planar patch needs a nonzero normal.', sourceIds); return;
            }
            if (!finite(u) || !finite(v)) {
              var derivedBasis = basis(normal);
              u = derivedBasis.u; v = derivedBasis.v;
            }
            var planeBoundaryCurves = loopCurveIndices(requested.loops);
            surface = {kind:'plane', origin:origin, normal:normal, u:u, v:v,
              loops:requested.loops, boundaryCurves:planeBoundaryCurves, closed:false,
              sourceIds:sourceIds, displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
            if (patch.closure) surface.closure = patch.closure;
            if (patch.recessMouth) surface.recessMouth = true;
          } else if (patch.outer && patch.outer.length >= 3) {
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
          if (requested.loops) {
            var explicitCurves = loopCurveIndices(requested.loops);
            var explicitFirst = explicitCurves.length ? curves[explicitCurves[0]] : null;
            var explicitSecond = explicitCurves.length > 1 ? curves[explicitCurves[1]] : null;
            if (explicitCurves.some(function (i) { return !validCurve(curves[i]); })) {
              diag('surface-invalid-boundary', 'A ruled patch references a missing analytic boundary.', sourceIds); return;
            }
            var explicitKind = patch.analyticKind || patch.kind;
            if (explicitKind === 'ruled') {
              if (!explicitFirst || !explicitSecond) {
                diag('surface-invalid-boundary', 'A ruled patch with explicit loops needs two analytic boundaries or an explicit analyticKind.', sourceIds); return;
              }
              explicitKind = Math.abs(explicitFirst.radius - explicitSecond.radius) <= EPS ? 'cylinder' : 'cone';
            }
            var explicitOrigin = finite(patch.origin) ? patch.origin :
              explicitFirst ? explicitFirst.center : null;
            var explicitRadius = Number.isFinite(patch.radius) ? patch.radius :
              explicitFirst ? explicitFirst.radius : null;
            if (!finite(explicitOrigin) || !(explicitRadius > 0)) {
              diag('surface-unbounded-ruled', 'A ruled patch with explicit loops needs a finite origin and positive radius.', sourceIds); return;
            }
            var explicitAxis = patch.axis && finite(patch.axis) ? unit(patch.axis) :
              explicitSecond && length(sub(explicitSecond.center, explicitFirst.center)) > EPS ?
                unit(sub(explicitSecond.center, explicitFirst.center)) :
                explicitFirst ? curveNormal(explicitFirst) : null;
            if (!finite(explicitAxis)) {
              diag('surface-invalid-axis', 'A ruled patch with explicit loops needs a finite axis.', sourceIds); return;
            }
            var explicitSurface = {kind:explicitKind, origin:explicitOrigin, axis:explicitAxis,
              radius:explicitRadius, loops:requested.loops, boundaryCurves:explicitCurves,
              closed:false, sourceIds:sourceIds,
              displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
            if (patch.apex) explicitSurface.apex = patch.apex;
            if (Number.isFinite(patch.halfAngle)) explicitSurface.halfAngle = patch.halfAngle;
            if (patch.recess) explicitSurface.recess = true;
            if (explicitKind === 'cone' && !explicitSurface.apex && explicitFirst && explicitSecond) {
              var er1 = explicitFirst.radius, er2 = explicitSecond.radius;
              if (Math.abs(er1 - er2) > EPS) {
                var edelta = sub(explicitSecond.center, explicitFirst.center);
                var eaxial = dot(edelta, explicitAxis);
                explicitSurface.apex = add(explicitFirst.center, mul(explicitAxis, eaxial * er1 / (er1 - er2)));
                explicitSurface.halfAngle = Math.atan2(Math.abs(er1 - er2), Math.abs(eaxial));
              }
            }
            surface = explicitSurface;
          } else {
            var bcs = (patch.boundaryCurves || []).slice();
            if (!bcs.length) { diag('surface-unbounded-ruled', 'A ruled patch has no boundary curve.', sourceIds); return; }
            var first = curves[bcs[0]], second = bcs.length > 1 ? curves[bcs[1]] : null;
            if (!validCurve(first) || second && !validCurve(second)) {
              diag('surface-invalid-boundary', 'A ruled patch references a missing analytic boundary.', sourceIds); return;
            }
            var axis = patch.axis && finite(patch.axis) ? unitOrNull(patch.axis) :
              second && length(sub(second.center, first.center)) > EPS ? unitOrNull(sub(second.center, first.center)) : curveNormal(first);
            if (!axis || !finite(axis)) {
              diag('surface-invalid-axis', 'A ruled patch needs a finite nonzero axis.', sourceIds);
              return;
            }
            var kind = patch.analyticKind || patch.kind;
            if (kind === 'ruled') kind = second && Math.abs(first.radius - second.radius) <= EPS ? 'cylinder' : 'cone';
            var loops2 = bcs.map(function (i) { return {kind:'outer', curves:[i]}; });
            var surface2 = {kind:kind, origin:first.center, axis:axis, radius:first.radius,
              loops:loops2, boundaryCurves:bcs, closed:false, sourceIds:sourceIds,
              displayFaceIndices:(patch.faceIndices || []).slice(), patchIndex:pi};
            if (patch.apex) surface2.apex = patch.apex;
            if (Number.isFinite(patch.halfAngle)) surface2.halfAngle = patch.halfAngle;
            if (patch.recess) surface2.recess = true;
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
          }
        } else {
          diag('surface-kind-unsupported', 'The surface patch kind "' + patch.kind + '" has no analytic model.', sourceIds);
          return;
        }
      } catch (err) {
        diag('surface-build-failed', 'The surface could not be modelled: ' + (err && err.message || err), sourceIds);
        return;
      }
      addSurface(surface, patch);
    });
    mergeContainedMouths(model, geometry);
    mergeUnionMouths(model, geometry);
    model.summary = summarize(model);
    stampModelIdentity(model);
    model.cavityTrims = cavityTrims(model, geometry);
    if (geometry.cavityVolumes && geometry.cavityVolumes.length)
      geometry.cavityTrims = model.cavityTrims;
    else delete geometry.cavityTrims;
    if (model.diagnostics.length) model.summary.status = 'issues';
    return model;
  }







  function loopCurves(loop, curves) {
    var out = [];
    (loop.elements || []).forEach(function (el) {
      if (el && el.kind === 'curve' && el.curve) out.push(el.curve);
    });
    (loop.curves || []).forEach(function(i) {
      out.push(typeof i === 'object' && i ? i : curves[i]);
    });
    if (loop.section) out.push(loop.section);
    return out;
  }

  function loopInlinePoints(loop) {
    var out = [];
    (loop.elements || []).forEach(function (el) {
      if (el && el.kind === 'polyline') (el.points || []).forEach(function (p) { out.push(p); });
    });
    (loop.points || []).forEach(function (p) { out.push(p); });
    return out;
  }

  function pointKey(p) { return p.x + ',' + p.y + ',' + p.z; }
  function edgeKey(a, b) { return 'p:' + pointKey(a) + '_' + pointKey(b); }



  function loopGeometry(loop, curves, vertices) {
    var out = {curves:[], edges:[]};
    if (loop.elements) {
      loop.elements.forEach(function (el) {
        if (!el) return;
        if (el.kind === 'curve' && el.curve) out.curves.push(el.curve);
        else if (el.kind === 'polyline') {
          for (var i=0;i<(el.points || []).length-1;i++) out.edges.push([el.points[i], el.points[i+1]]);
        }
      });
      return out;
    }
    (loop.curves || []).forEach(function (i) {
      out.curves.push(typeof i === 'object' && i ? i : curves[i]);
    });
    if (loop.section) out.curves.push(loop.section);
    var verts = (loop.vertices || []).map(function (i) { return vertices && vertices[i]; });
    for (var i=0;i<verts.length;i++) out.edges.push([verts[i], verts[(i+1)%verts.length]]);
    var pts = loop.points || [];
    for (var j=0;j<pts.length;j++) out.edges.push([pts[j], pts[(j+1)%pts.length]]);
    return out;
  }

  function loopElements(loop) {
    var keys = [];
    if (loop && loop.elements) loop.elements.forEach(function (el) {
      if (!el) return;
      if (el.kind === 'curve' && el.curve) keys.push(el.curve);
      else if (el.kind === 'polyline') {
        var pts = el.points || [];
        for (var i=0;i<pts.length-1;i++) keys.push(edgeKey(pts[i], pts[i+1]));
      }
    });
    if (loop && loop.section) keys.push(loop.section);
    if (loop && loop.lines) loop.lines.forEach(function (line) { keys.push(line); });
    if (loop && loop.curves) loop.curves.forEach(function (i) {
      keys.push(typeof i === 'object' && i ? i : 'c:' + i);
    });
    if (loop && loop.vertices && loop.vertices.length >= 2) {
      for (var i=0;i<loop.vertices.length;i++) {
        var a=loop.vertices[i], b=loop.vertices[(i+1)%loop.vertices.length];
        keys.push('e:' + Math.min(a,b) + '_' + Math.max(a,b));
      }
    }
    if (loop && loop.points && loop.points.length >= 2) {
      for (var j=0;j<loop.points.length;j++)
        keys.push(edgeKey(loop.points[j], loop.points[(j+1)%loop.points.length]));
    }
    return keys;
  }




  function incidence(model) {
    var sectionIds = new Map(), lineIds = new Map(), uses = new Map(), bySurface = new Map();
    function elementId(element) {
      if (typeof element === 'string') return element;
      if (element && typeof element === 'object') {
        if (typeof element.id === 'string' && element.id !== '') return 'boundary:' + element.id;
        if (element.kind === 'line') {
          if (!lineIds.has(element)) lineIds.set(element, 'line:' + lineIds.size);
          return lineIds.get(element);
        }
        if (!sectionIds.has(element)) sectionIds.set(element, 'section:' + sectionIds.size);
        return sectionIds.get(element);
      }
      return 'invalid-element';
    }
    (model.surfaces || []).forEach(function (s, si) {
      var ids = [];
      (s.loops || []).forEach(function (loop, li) {
        loopElements(loop).forEach(function (element) {
          var id = elementId(element);
          ids.push(id);
          if (!uses.has(id)) uses.set(id, {id:id, element:element, kind:boundaryElementKind(element),
            useCount:0, surfaceIds:[], surfaceUses:[], loopRefs:[]});
          var use = uses.get(id);
          use.useCount++;
          use.surfaceUses.push(s.id);
          if (use.surfaceIds.indexOf(s.id) === -1) use.surfaceIds.push(s.id);
          use.loopRefs.push({surfaceIndex:si, surfaceId:s.id, loopIndex:li});
        });
      });
      bySurface.set(s.id, ids);
    });
    return {uses:uses, bySurface:bySurface, elementId:elementId};
  }




  function topology(model, geometry) {
    model = model || {surfaces:[]};
    stampModelIdentity(model);
    var curves = geometry && geometry.curves || [];
    var displayVertices = geometry && geometry.vertices || [];
    var edges = new Map(), vertices = new Map(), faces = [];

    function vertexKey(p) {
      var scale = 1e-9;
      return [Math.round(p.x/scale), Math.round(p.y/scale), Math.round(p.z/scale)].join(',');
    }
    function addVertex(p, surfaceId, edgeId) {
      var key = vertexKey(p);
      if (!vertices.has(key)) vertices.set(key, {id:'vertex:' + vertices.size,
        point:{x:p.x, y:p.y, z:p.z}, edges:[], faces:[]});
      var vertex = vertices.get(key);
      if (vertex.edges.indexOf(edgeId) === -1) vertex.edges.push(edgeId);
      if (surfaceId && vertex.faces.indexOf(surfaceId) === -1) vertex.faces.push(surfaceId);
      return vertex;
    }
    function addEdge(id, kind, data, surfaceId, loopIndex, role, orientation) {
      if (!edges.has(id)) {
        var edge = {id:id, kind:kind, closed:!!data.closed, uses:[],
          faces:[], sourceIds:(data.sourceIds || []).slice()};
        if (data.curve) edge.curveId = data.curveId || data.curve.id || null;
        if (data.curve) edge.curveKind = data.curve.kind || null;
        if (data.start) edge.start = {x:data.start.x, y:data.start.y, z:data.start.z};
        if (data.end) edge.end = {x:data.end.x, y:data.end.y, z:data.end.z};
        edges.set(id, edge);
      }
      var edge = edges.get(id);
      if (surfaceId && edge.faces.indexOf(surfaceId) === -1) edge.faces.push(surfaceId);
      edge.uses.push({surfaceId:surfaceId === undefined ? null : surfaceId,
        loopIndex:loopIndex, role:role || 'outer', orientation:orientation === -1 ? -1 : 1});
      if (data.start) addVertex(data.start, surfaceId, id);
      if (data.end && (!data.start || vertexKey(data.start) !== vertexKey(data.end)))
        addVertex(data.end, surfaceId, id);
      return edge;
    }
    function addCurveElement(element, surfaceId, loopIndex, role, explicitId) {
      var curve = boundaryCurve(element, curves);
      if (!curve || !validCurve(curve)) return null;
      var id = explicitId || (element && typeof element === 'object' && element.id ?
        'boundary:' + element.id : 'boundary:' + (curve.id || 'curve'));
      var start = curvePoint(curve, curveStart(curve));
      var closed = curveSweep(curve) >= TAU - 1e-9;
      var end = closed ? start : curvePoint(curve, curveStart(curve) + curveSweep(curve));
      addEdge(id, 'curve', {curve:curve, curveId:explicitId || curve.id || null,
        start:start, end:end, closed:closed,
        sourceIds:curve.sourceIds || []}, surfaceId, loopIndex, role);
      return id;
    }
    function addLineElement(line, surfaceId, loopIndex, role) {
      if (!validLine(line)) return false;
      var id = line.id ? 'boundary:' + line.id : 'line:' + pointKey(line.start) + '_' + pointKey(line.end);
      addEdge(id, 'line', {start:line.start, end:line.end,
        sourceIds:line.sourceIds || []}, surfaceId, loopIndex, role);
      return true;
    }
    function segmentId(a, b) {
      var first = pointKey(a), second = pointKey(b);
      return 'edge:' + (first < second ? first + '_' + second : second + '_' + first);
    }
    function addPolyline(points, surfaceId, loopIndex, role) {
      for (var i=0;i<points.length;i++) {
        var a = points[i], b = points[(i+1)%points.length];
        if (!finite(a) || !finite(b) || pointDistance(a,b) <= EPS) continue;
        var id = segmentId(a, b);
        var existing = edges.get(id);
        var orientation = existing && existing.start &&
          vertexKey(existing.start) === vertexKey(b) &&
          vertexKey(existing.end) === vertexKey(a) ? -1 : 1;
        addEdge(id, 'line', {start:a, end:b}, surfaceId, loopIndex, role, orientation);
      }
    }
    function loopItems(loop, surfaceId, loopIndex, role, edgeUses) {
      function use(id) { edgeUses.push({edgeId:id, orientation:1}); }
      (loop.elements || []).forEach(function (element) {
        if (!element) return;
        if (element.kind === 'curve') {
          var elementId = addCurveElement(element.curve, surfaceId, loopIndex, role);
          if (elementId) use(elementId);
        } else if (element.kind === 'polyline') {
          addPolyline(element.points || [], surfaceId, loopIndex, role);
        }
      });
      if (loop.section) {
        var sectionId = addCurveElement(loop.section, surfaceId, loopIndex, role);
        if (sectionId) use(sectionId);
      }
      (loop.lines || []).forEach(function (line) {
        if (addLineElement(line, surfaceId, loopIndex, role))
          use(line.id ? 'boundary:' + line.id : 'line:' + pointKey(line.start) + '_' + pointKey(line.end));
      });
      (loop.curves || []).forEach(function (item) {
        var curve = typeof item === 'object' ? item : curves[item];
        var curveId = addCurveElement(curve, surfaceId, loopIndex, role,
          typeof item === 'number' ? 'c:' + item : null);
        if (curveId && !edgeUses.some(function (u) { return u.edgeId === curveId; }))
          use(curveId);
      });
      var points = [];
      (loop.vertices || []).forEach(function (i) {
        if (displayVertices[i]) points.push(displayVertices[i]);
      });
      (loop.points || []).forEach(function (p) { points.push(p); });
      if (points.length) {
        addPolyline(points, surfaceId, loopIndex, role);
        for (var i=0;i<points.length;i++) {
          var a = points[i], b = points[(i+1)%points.length];
          if (finite(a) && finite(b) && pointDistance(a,b) > EPS)
            use(segmentId(a,b));
        }
      }
    }
    (model.surfaces || []).forEach(function (surface) {
      var face = {id:'face:' + faces.length, surfaceId:surface.id,
        kind:surface.kind, closed:!!surface.closed, loops:[]};
      (surface.loops || []).forEach(function (loop, loopIndex) {
        var edgeUses = [];
        loopItems(loop, surface.id, loopIndex, loop.kind || 'outer', edgeUses);
        face.loops.push({id:surface.id + '/loop:' + loopIndex,
          role:loop.kind || 'outer', edgeUses:edgeUses});
      });
      faces.push(face);
    });
    var edgeList = Array.from(edges.values()).map(function (edge) {
      edge.useCount = edge.uses.length;
      edge.status = edge.useCount === 1 ? 'open' :
        edge.useCount === 2 ? 'shared' : 'nonmanifold';
      return edge;
    });
    var vertexList = Array.from(vertices.values());
    var openEdges = edgeList.filter(function (e) { return e.status === 'open'; }).length;
    var sharedEdges = edgeList.filter(function (e) { return e.status === 'shared'; }).length;
    var nonmanifoldEdges = edgeList.filter(function (e) { return e.status === 'nonmanifold'; }).length;
    return {contract:'analytic-topology-v1', modelContract:model.contract || 'analytic-surface-v1',
      faces:faces, edges:edgeList, vertices:vertexList,
      summary:{faces:faces.length, edges:edgeList.length, vertices:vertexList.length,
        loops:faces.reduce(function (n, f) { return n + f.loops.length; }, 0),
        openEdges:openEdges, sharedEdges:sharedEdges, nonmanifoldEdges:nonmanifoldEdges,
        status:openEdges || nonmanifoldEdges ? 'partial' : 'closed'}};
  }

  function surfaceNormalAt(surface, point) {
    if (!surface || !finite(point)) return null;
    var direction = null;
    if (surface.kind === 'plane') direction = finite(surface.normal) ? unit(surface.normal) : null;
    else if (surface.kind === 'sphere')
      direction = finite(surface.center) ? unit(sub(point, surface.center)) : null;
    else if (surface.kind === 'cylinder') {
      if (!finite(surface.origin) || !finite(surface.axis)) return null;
      var axis = unit(surface.axis);
      var delta = sub(point, surface.origin);
      var radial = sub(delta, mul(axis, dot(delta, axis)));
      direction = length(radial) > EPS ? unit(radial) : null;
    } else if (surface.kind === 'cone') {
      if (!finite(surface.origin) || !finite(surface.axis)) return null;
      var coneAxis = unit(surface.axis);
      var apex = finite(surface.apex) ? surface.apex : surface.origin;
      var apexDelta = sub(point, apex);
      var station = dot(apexDelta, coneAxis);
      var coneRadial = sub(apexDelta, mul(coneAxis, station));
      if (length(coneRadial) <= EPS) return null;
      var radialDirection = unit(coneRadial);
      var halfAngle = Number.isFinite(surface.halfAngle) ? surface.halfAngle :
        Math.atan2(surface.radius || 0, Math.abs(station));
      var nappe = station >= 0 ? 1 : -1;
      direction = unit(add(mul(radialDirection, Math.cos(halfAngle)),
        mul(coneAxis, -nappe * Math.sin(halfAngle))));
    } else if (surface.kind === 'implicit' || surface.kind === 'polynomial') {
      var implicitNormal = implicitEquationFor(surface);
      if (!implicitNormal || !Implicit) return null;
      var implicitAt = Implicit.evaluate(implicitNormal, point);
      direction = implicitAt && length(implicitAt.gradient) > EPS ? unit(implicitAt.gradient) : null;
    } else if (surface.kind === 'torus') {
      if (!finite(surface.center) || !finite(surface.axis)) return null;
      var tAxis = unit(surface.axis), tDelta = sub(point, surface.center);
      var tAxial = dot(tDelta, tAxis);
      var tRadial = sub(tDelta, mul(tAxis, tAxial));
      if (length(tRadial) <= EPS) return null;
      var tDir = unit(tRadial);
      direction = unit(add(mul(tDir, length(tRadial) - surface.majorRadius),
        mul(tAxis, tAxial)));
    }
    if (direction && surface.recess) direction = mul(direction, -1);
    return direction;
  }
  function edgeMidpoint(edge) {
    if (!edge || !finite(edge.start) || !finite(edge.end)) return null;
    return {x:0.5*(edge.start.x + edge.end.x), y:0.5*(edge.start.y + edge.end.y),
      z:0.5*(edge.start.z + edge.end.z)};
  }
  function edgeTangent(edge, geometry) {
    if (!edge) return null;
    var curve = null;
    if (edge.curveId) {
      var indexed = /^c:(\d+)$/.exec(edge.curveId);
      if (indexed && geometry && geometry.curves)
        curve = geometry.curves[Number(indexed[1])];
      if (!curve) curve = ((geometry && geometry.curves) || []).find(function (c) {
        return c.id === edge.curveId;
      });
    }
    if (curve && validCurve(curve)) {
      var t = curveStart(curve) + 0.5 * curveSweep(curve);
      var a = curvePoint(curve, t - 1e-6), b = curvePoint(curve, t + 1e-6);
      var tangent = sub(b, a);
      return length(tangent) > EPS ? unit(tangent) : null;
    }
    if (finite(edge.start) && finite(edge.end) && pointDistance(edge.start, edge.end) > EPS)
      return unit(sub(edge.end, edge.start));
    return null;
  }
  function classifyDihedral(edge, model, geometry) {
    if (!edge || edge.useCount !== 2) return {convexity:'open', angle:null};
    var first = model.surfaces.find(function (s) { return s.id === edge.uses[0].surfaceId; });
    var second = model.surfaces.find(function (s) { return s.id === edge.uses[1].surfaceId; });
    var point = edgeMidpoint(edge), tangent = edgeTangent(edge, geometry);
    var one = first && surfaceNormalAt(first, point);
    var two = second && surfaceNormalAt(second, point);
    if (!one || !two || !tangent) return {convexity:'unknown', angle:null};
    var cosine = Math.max(-1, Math.min(1, dot(one, two)));
    var angle = Math.acos(cosine);
    if (angle <= 1e-3 || Math.PI - angle <= 1e-3)
      return {convexity:'smooth', angle:angle};
    var side = dot(cross(one, two), tangent);
    return {convexity:side > 0 ? 'convex' : 'concave', angle:angle,
      tangent:tangent, normals:[one, two]};
  }
  function viewDirection(view) {
    if (view && finite(view.direction || view)) {
      var direction = view.direction || view;
      return length(direction) > EPS ? unit(direction) : null;
    }
    if (view === 'front' || view === 'elevation') return {x:0,y:0,z:1};
    if (view === 'top' || view === 'plan') return {x:0,y:1,z:0};
    if (view === 'left') return {x:-1,y:0,z:0};
    if (view === 'right') return {x:1,y:0,z:0};
    return null;
  }
  function geometryExtent(geometry, surface) {
    var extent = 1;
    ((geometry && geometry.vertices) || []).forEach(function (v) {
      if (finite(v)) extent = Math.max(extent, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    });
    [surface].forEach(function (s) {
      if (!s) return;
      if (finite(s.origin)) extent = Math.max(extent, length(s.origin));
      if (finite(s.center)) extent = Math.max(extent, length(s.center));
      if (finite(s.apex)) extent = Math.max(extent, length(s.apex));
      if (Number.isFinite(s.radius)) extent += Math.abs(s.radius);
    });
    return extent;
  }
  function clipPredicateRuns(samples, pointAt, insideAt, stationAt) {
    var count = samples.length, runs = [];
    if (samples.every(Boolean)) return {runs:[], allInside:true, none:false};
    if (!samples.some(Boolean)) return {runs:[], allInside:false, none:true};
    var entering = -1;
    for (var i=0;i<count;i++) {
      if (!samples[i] && samples[(i+1)%count]) { entering = (i+1)%count; break; }
    }
    if (entering === -1) return {runs:[], allInside:false, none:true};
    var index = entering, guard = 0;
    while (guard++ <= count) {
      if (!samples[index]) break;
      var startIndex = index, endIndex = index, steps = 0;
      while (samples[endIndex] && steps++ <= count) endIndex = (endIndex+1)%count;
      var start = stationAt(startIndex, (startIndex-1+count)%count);
      var end = stationAt((endIndex-1+count)%count, endIndex);
      if (start.t > end.t) end.t += TAU;
      if (end.t - start.t > 1e-12) runs.push({start:start, end:end});
      index = endIndex;
      while (!samples[index] && guard++ <= count) index = (index+1)%count;
      if (index === entering) break;
    }
    return {runs:runs, allInside:false, none:false};
  }
  function clipCurveToSurface(surface, curve, geometry, options) {
    var count = Math.max(32, options && options.samples || 128);
    var inside = [], parameters = [];
    for (var i=0;i<count;i++) {
      var t = (i + 0.5) * TAU / count;
      parameters.push(t);
      inside.push(boundedInside(classifyPoint(surface, curvePoint(curve, t), geometry)));
    }
    function stationBetween(tInside, tOutside) {
      var a = tInside, b = tOutside;
      if (Math.abs(b - a) > Math.PI) { if (b > a) b -= TAU; else b += TAU; }
      for (var k=0;k<64;k++) {
        var mid = 0.5*(a+b);
        if (boundedInside(classifyPoint(surface, curvePoint(curve, mid), geometry))) a = mid;
        else b = mid;
        if (Math.abs(b-a) <= 1e-12 * Math.max(1, Math.abs(mid))) break;
      }
      var t = 0.5*(a+b);
      return {t:t, point:curvePoint(curve, t), method:'bisection', confidence:'numeric'};
    }
    var runs = clipPredicateRuns(inside, null, null, function (tInside, tOutside) {
      return stationBetween(parameters[tInside], parameters[tOutside]);
    });
    if (runs.allInside) {
      var full = copyFields(curve);
      full.bounded = true;
      full.confidence = 'analytic-silhouette';
      return [full];
    }
    return runs.runs.map(function (run) {
      var t0 = ((run.start.t % TAU) + TAU) % TAU;
      var t1 = ((run.end.t % TAU) + TAU) % TAU;
      if (t1 <= t0 + 1e-12) t1 += TAU;
      var arc = subArc(curve, t0, t1);
      arc.bounded = true;
      arc.closed = false;
      arc.confidence = 'analytic-silhouette';
      arc.startStation = Object.assign({}, run.start, {t:t0});
      arc.endStation = Object.assign({}, run.end, {t:t1});
      return arc;
    });
  }
  function clipLineToSurface(surface, origin, direction, geometry) {
    var extent = geometryExtent(geometry, surface) * 4 + 10;
    var count = 192, samples = [], parameters = [];
    function at(t) { return add(origin, mul(direction, t)); }
    for (var i=0;i<count;i++) {
      var t = -extent + (i + 0.5) * (2 * extent) / count;
      parameters.push(t);
      samples.push(boundedInside(classifyPoint(surface, at(t), geometry)));
    }
    function stationBetween(tInside, tOutside) {
      var a = tInside, b = tOutside;
      for (var k=0;k<64;k++) {
        var mid = 0.5*(a+b);
        if (boundedInside(classifyPoint(surface, at(mid), geometry))) a = mid;
        else b = mid;
        if (Math.abs(b-a) <= 1e-12 * Math.max(1, Math.abs(mid))) break;
      }
      var t = 0.5*(a+b);
      return {t:t, point:at(t), method:'bisection', confidence:'numeric'};
    }
    var runs = [];
    if (samples.some(Boolean)) {
      var start = -1;
      for (var j=0;j<count;j++) {
        if (samples[j] && start === -1) start = j;
        if (start !== -1 && (!samples[j] || j === count-1)) {
          var endSample = samples[j] ? j : j-1;
          var startStation = start === 0 ? {t:parameters[0], point:at(parameters[0]),
            method:'sample', confidence:'numeric'} :
            stationBetween(parameters[start], parameters[start-1]);
          var endStation = endSample === count-1 ? {t:parameters[count-1],
            point:at(parameters[count-1]), method:'sample', confidence:'numeric'} :
            stationBetween(parameters[endSample], parameters[endSample+1]);
          runs.push({start:startStation, end:endStation});
          start = -1;
        }
      }
    }
    return runs.map(function (run) {
      return {kind:'line', start:run.start.point, end:run.end.point,
        direction:direction, bounded:true, confidence:'analytic-silhouette',
        startStation:run.start, endStation:run.end};
    });
  }
  function silhouettes(model, view, geometry) {
    model = model || {surfaces:[]};
    var direction = viewDirection(view);
    if (!direction)
      return {contract:'analytic-silhouette-v1', status:'unsupported', curves:[],
        diagnostics:[{code:'silhouette-view-invalid', severity:'error',
          message:'Use front, top, left, right or a finite direction vector.'}]};
    var curves = [], diagnostics = [];
    (model.surfaces || []).forEach(function (surface) {
      if (surface.kind === 'sphere') {
        var frame = basis(direction);
        var circle = {kind:'circle', center:surface.center, u:frame.u, v:frame.v,
          radius:surface.radius, startAngle:0, sweepAngle:TAU,
          sourceIds:(surface.sourceIds || []).slice(), surfaceId:surface.id,
          silhouette:'sphere'};
        if (surface.closed === true && !surface.cap) curves.push(circle);
        else curves = curves.concat(clipCurveToSurface(surface, circle, geometry || {}));
      } else if (surface.kind === 'torus') {
        var torusAxis = unit(surface.axis), torusViewDot = dot(torusAxis, direction);
        var torusFrame = basis(torusAxis), torusR = surface.majorRadius, torusr = surface.minorRadius;
        if (!(torusR > 0) || !(torusr > 0)) return;
        var torusBounded = surface.closed !== true &&
          ((surface.loops || []).length > 0 || !!surface.domain);
        if (torusBounded && !validTorusDomain(surface.domain)) {
          diagnostics.push({code:'torus-patch-clipping-unsupported', severity:'info',
            surfaceId:surface.id,
            message:'A bounded torus patch needs a u/v parameter domain before its silhouettes can be clipped.'});
          return;
        }
        function addTorusCurve(curve) {
          curve.silhouette = 'torus';
          curve.surfaceId = surface.id;
          if (!curve.confidence) curve.confidence = 'analytic-silhouette';
          if (torusBounded) {
            var clipped = clipCurveToSurface(surface, curve, geometry || {});
            clipped.forEach(function (piece) {
              piece.silhouette = 'torus';
              piece.surfaceId = surface.id;
              piece.contourClass = curve.contourClass;
              if (curve.confidence === 'analytic-parameterization')
                piece.confidence = 'analytic-parameterization-clipped';
            });
            curves = curves.concat(clipped);
          } else curves.push(curve);
        }
        if (Math.abs(Math.abs(torusViewDot) - 1) <= 1e-7) {
          var torusRadii = [torusR + torusr];
          if (torusR - torusr > EPS) torusRadii.push(torusR - torusr);
          torusRadii.forEach(function (radius) {
            addTorusCurve({kind:'circle', center:surface.center,
              u:torusFrame.u, v:torusFrame.v, radius:radius, startAngle:0,
              sweepAngle:TAU, contourClass:radius > torusR ? 'outer' : 'inner',
              sourceIds:(surface.sourceIds || []).slice()});
          });
        } else if (Math.abs(torusViewDot) <= 1e-7) {
          var torusRadial = unit(cross(torusAxis, direction));
          [1,-1].forEach(function (sign) {
            addTorusCurve({kind:'circle', center:add(surface.center, mul(torusRadial, sign*torusR)),
              u:torusAxis, v:torusRadial, radius:torusr, startAngle:0, sweepAngle:TAU,
              contourClass:'tube', sourceIds:(surface.sourceIds || []).slice()});
          });
          [1,-1].forEach(function (sign) {
            addTorusCurve({kind:'circle', center:add(surface.center, mul(torusAxis, sign*torusr)),
              u:torusFrame.u, v:torusFrame.v, radius:torusR, startAngle:0, sweepAngle:TAU,
              contourClass:'ridge', sourceIds:(surface.sourceIds || []).slice()});
          });
        } else {
          [1,-1].forEach(function (branch) {
            addTorusCurve({kind:'torusContour', center:surface.center, axis:torusAxis,
              u:torusFrame.u, v:torusFrame.v, majorRadius:torusR, minorRadius:torusr,
              viewDirection:direction, branch:branch, startAngle:0, sweepAngle:TAU,
              contourClass:'branch', confidence:'analytic-parameterization',
              sourceIds:(surface.sourceIds || []).slice()});
          });
        }
      } else if (surface.kind === 'cylinder') {
        var axis = unit(surface.axis);
        var across = cross(axis, direction);
        if (length(across) <= EPS) {
          diagnostics.push({code:'silhouette-view-along-axis', severity:'info',
            surfaceId:surface.id,
            message:'A cylinder viewed along its axis has no side silhouette lines.'});
          return;
        }
        var radial = unit(across);
        [1,-1].forEach(function (sign) {
          var line = {kind:'line', origin:add(surface.origin, mul(radial, sign*surface.radius)),
            direction:axis, surfaceId:surface.id, silhouette:'cylinder'};
          if ((surface.loops || []).length) {
            var clippedCylinder = clipLineToSurface(surface, line.origin, line.direction, geometry || {});
            clippedCylinder.forEach(function (piece) {
              piece.surfaceId = surface.id;
              piece.silhouette = 'cylinder';
            });
            curves = curves.concat(clippedCylinder);
          } else curves.push(line);
        });
      } else if (surface.kind === 'cone') {
        if (!Number.isFinite(surface.halfAngle)) return;
        var axisCone = unit(surface.axis), alpha = surface.halfAngle;
        var frame2 = basis(axisCone);
        var A = dot(frame2.u, direction), B = dot(frame2.v, direction);
        var amplitude = Math.hypot(A, B);
        if (amplitude <= EPS) {
          diagnostics.push({code:'silhouette-view-along-axis', severity:'info',
            surfaceId:surface.id,
            message:'A cone viewed along its axis has no generator silhouette lines.'});
          return;
        }
        var ratio = Math.tan(alpha) * dot(axisCone, direction) / amplitude;
        if (ratio < -1 - 1e-9 || ratio > 1 + 1e-9) return;
        ratio = Math.max(-1, Math.min(1, ratio));
        var base = Math.atan2(B, A), delta = Math.acos(ratio);
        var apex = finite(surface.apex) ? surface.apex : surface.origin;
        [base+delta, base-delta].forEach(function (theta) {
          var radialCone = add(mul(frame2.u, Math.cos(theta)), mul(frame2.v, Math.sin(theta)));
          var generator = unit(add(mul(axisCone, Math.cos(alpha)),
            mul(radialCone, Math.sin(alpha))));
          var line = {kind:'line', origin:apex, direction:generator,
            surfaceId:surface.id, silhouette:'cone'};
          if ((surface.loops || []).length) {
            var clippedCone = clipLineToSurface(surface, line.origin, line.direction, geometry || {});
            clippedCone.forEach(function (piece) {
              piece.surfaceId = surface.id;
              piece.silhouette = 'cone';
            });
            curves = curves.concat(clippedCone);
          } else curves.push(line);
        });
      }
    });
    var byKind = {};
    curves.forEach(function (curve) {
      var kind = curve.silhouette || curve.kind;
      byKind[kind] = (byKind[kind] || 0) + 1;
    });
    return {contract:'analytic-silhouette-v1', status:curves.length ? 'ok' : 'none',
      view:typeof view === 'string' ? view : null, direction:direction,
      curves:curves, byKind:byKind, diagnostics:diagnostics};
  }

  function projectViewPoint(p, view) {
    if (view && typeof view === 'object') {
      var d = unit(view);
      if (Math.abs(d.z) > 1 - 1e-9) return d.z > 0 ? {x:p.x, y:p.y} : {x:-p.x, y:p.y};
      if (Math.abs(d.y) > 1 - 1e-9) return d.y > 0 ? {x:p.x, y:-p.z} : {x:p.x, y:p.z};
      if (Math.abs(d.x) > 1 - 1e-9) return d.x > 0 ? {x:p.z, y:p.y} : {x:-p.z, y:p.y};
      var screen = unit(cross({x:0, y:0, z:1}, d));
      var up = cross(d, screen);
      return {x:dot(p, screen), y:dot(p, up)};
    }
    if (view === 'top' || view === 'plan') return {x:p.x, y:-p.z};
    if (view === 'front' || view === 'elevation') return {x:p.x, y:p.y};
    if (view === 'left') return {x:-p.z, y:p.y};
    if (view === 'right') return {x:p.z, y:p.y};
    return null;
  }
  function silhouetteHLR(model, view, geometry, hidden, options) {
    var silhouettesResult = silhouettes(model, view, geometry);
    var count = Math.max(16, options && options.samples || 64);
    function curvePointAt(curve, t) {
      if (curve.kind === 'line') {
        if (finite(curve.start) && finite(curve.end))
          return add(curve.start, mul(unit(sub(curve.end, curve.start)), t));
        return add(curve.origin, mul(unit(curve.direction), t));
      }
      return curvePoint(curve, t);
    }
    function parameterRange(curve) {
      if (curve.kind === 'line') {
        var length = finite(curve.start) && finite(curve.end) ?
          pointDistance(curve.start, curve.end) : 1;
        return {from:0, to:length, closed:false};
      }
      if (curve.kind === 'arc' || curve.kind === 'torusContour' ||
          curve.kind === 'torusSectionBranch' || curve.kind === 'torusSphereBranch') {
        var sweep = curveSweep(curve);
        return {from:curveStart(curve), to:curveStart(curve) + sweep,
          closed:sweep >= TAU - 1e-9};
      }
      return {from:0, to:TAU, closed:true};
    }
    var strokes = [];
    (silhouettesResult.curves || []).forEach(function (curve) {
      var range = parameterRange(curve);
      var samples = [];
      var sampleCount = range.closed ? count : Math.max(2, count);
      for (var i=0;i<sampleCount;i++) {
        var fraction = range.closed ? i / sampleCount : i / (sampleCount - 1);
        var t = range.from + (range.to - range.from) * fraction;
        var point = curvePointAt(curve, t);
        var projected = projectViewPoint(point, view);
        if (!projected) return;
        var verdict = false;
        if (typeof hidden === 'function') {
          try { verdict = !!hidden(point); } catch (err) { verdict = false; }
        }
        samples.push({t:t, point:projected, hidden:verdict});
      }
      if (samples.length < 2) return;
      var intervals = [];
      var start = 0;
      for (var j=1;j<samples.length;j++) {
        if (samples[j].hidden !== samples[j-1].hidden) {
          intervals.push({t0:samples[start].t, t1:samples[j-1].t,
            hidden:samples[start].hidden});
          start = j;
        }
      }
      intervals.push({t0:samples[start].t, t1:samples[samples.length-1].t,
        hidden:samples[start].hidden});
      if (range.closed && intervals.length > 1) {
        var first = intervals[0], last = intervals[intervals.length-1];
        if (first.hidden === last.hidden) {
          last.t1 = first.t1 + TAU;
          intervals.shift();
        }
      }
      strokes.push({curveId:curve.silhouette || curve.kind,
        surfaceId:curve.surfaceId || null, samples:samples, intervals:intervals,
        visibleIntervals:intervals.filter(function (i) { return !i.hidden; }),
        hiddenIntervals:intervals.filter(function (i) { return i.hidden; })});
    });
    return {contract:'silhouette-hlr-v1', view:typeof view === 'string' ? view : null,
      strokes:strokes, summary:{strokes:strokes.length,
        visible:strokes.filter(function (s) { return s.hiddenIntervals.length === 0; }).length,
        partiallyHidden:strokes.filter(function (s) {
          return s.hiddenIntervals.length > 0 && s.visibleIntervals.length > 0;
        }).length,
        fullyHidden:strokes.filter(function (s) {
          return s.hiddenIntervals.length > 0 && s.visibleIntervals.length === 0;
        }).length},
      diagnostics:(silhouettesResult.diagnostics || []).slice()};
  }

  function featureGraph(model, geometry) {
    model = model || {surfaces:[]};
    var graph = topology(model, geometry);
    var edges = graph.edges.map(function (edge) {
      var dihedral = classifyDihedral(edge, model, geometry);
      return {id:edge.id, kind:edge.kind, surfaceIds:edge.faces.slice(),
        useCount:edge.useCount, status:edge.status,
        convexity:dihedral.convexity, angle:dihedral.angle};
    });
    var surfaceIndex = new Map();
    (model.surfaces || []).forEach(function (surface, index) { surfaceIndex.set(index, surface); });
    var features = [];
    ((geometry && geometry.recesses) || []).forEach(function (record, index) {
      var faces = [];
      if (Number.isInteger(record.surface) && surfaceIndex.has(record.surface))
        faces.push(surfaceIndex.get(record.surface).id);
      (model.surfaces || []).forEach(function (surface) {
        if (!surface.recess) return;
        if (faces.indexOf(surface.id) === -1) faces.push(surface.id);
      });
      features.push({id:'feature:recess:' + index, type:'recess',
        family:record.kind, faces:faces, closure:record.closure || 'open',
        bottomClosure:record.bottomClosure || null,
        through:record.through === true,
        mouthCurve:record.mouthCurve === undefined ? null : record.mouthCurve,
        sourceIds:(record.sourceIds || []).slice()});
    });
    ((geometry && geometry.fillets) || []).forEach(function (record, index) {
      var faces = [];
      if (Number.isInteger(record.surface) && surfaceIndex.has(record.surface))
        faces.push(surfaceIndex.get(record.surface).id);
      (record.adjacentSurfaces || []).forEach(function (i) {
        if (surfaceIndex.has(i)) faces.push(surfaceIndex.get(i).id);
      });
      (record.closureSurfaces || []).forEach(function (i) {
        if (surfaceIndex.has(i) && faces.indexOf(surfaceIndex.get(i).id) === -1)
          faces.push(surfaceIndex.get(i).id);
      });
      features.push({id:'feature:fillet:' + index, type:'fillet',
        family:record.kind || 'cylindrical', faces:faces, closure:record.closure || 'open',
        tangentLines:(record.tangentLines || []).map(function (line) { return line.id || null; }),
        sourceIds:(record.sourceIds || []).slice()});
    });
    var counts = {convex:0, concave:0, smooth:0, open:0, unknown:0};
    edges.forEach(function (edge) { counts[edge.convexity] = (counts[edge.convexity] || 0) + 1; });
    return {contract:'feature-graph-v1', graphContract:graph.contract,
      faces:graph.faces, edges:edges, features:features,
      summary:{faces:graph.faces.length, edges:graph.edges.length,
        convex:counts.convex, concave:counts.concave, smooth:counts.smooth,
        open:counts.open, unknown:counts.unknown,
        recesses:features.filter(function (f) { return f.type === 'recess'; }).length,
        fillets:features.filter(function (f) { return f.type === 'fillet'; }).length}};
  }

  function analyze(model) {
    var graph = incidence(model), usage = new Map();
    graph.uses.forEach(function (use, id) { usage.set(id, use.surfaceUses.slice()); });
    var surfKeys = graph.bySurface;
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
        if (!(s.loops || []).length)
          return s.closed === true || (s.kind === 'torus' && validTorusDomain(s.domain));
        return (surfKeys.get(s.id) || []).length > 0 &&
          (surfKeys.get(s.id) || []).every(function (k) { return (usage.get(k) || []).length === 2; });
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
      if (s.kind === 'torus') {
        if (!Number.isFinite(s.majorRadius) || !(s.majorRadius > 0) ||
            !Number.isFinite(s.minorRadius) || !(s.minorRadius > 0))
          add('surface-invalid-torus', 'Surface ' + s.id + ' needs positive major and minor radii.', s.sourceIds);
        if (!finite(s.axis) || Math.abs(length(s.axis)-1) > EPS)
          add('surface-invalid-axis', 'Surface ' + s.id + ' needs a unit axis.', s.sourceIds);
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
      var tol = 1e-5 * Math.max(1, s.radius || 1, s.majorRadius || 0);




      (s.loops || []).forEach(function (loop) {
        if (loop.vertices && s.kind === 'plane') loop.vertices.forEach(function (i) {
          var p = geometry && geometry.vertices && geometry.vertices[i];
          if (p && Math.abs(dot(sub(p, s.origin), s.normal)) > tol)
            add('surface-boundary-off-surface', 'A plane boundary vertex is off ' + s.id + '.', s.sourceIds);
        });
        loopInlinePoints(loop).forEach(function (p) {
          if (!finite(p) || surfaceResidual(s, p) > tol)
            add('surface-boundary-off-surface', 'An inline boundary point is off ' + s.id + '.', s.sourceIds);
        });
        (loop.lines || []).forEach(function (l) {
          if (!validLine(l)) {
            add('surface-boundary-missing', 'Surface ' + s.id + ' references a missing or degenerate line boundary.', s.sourceIds);
            return;
          }
          [l.start, linePoint(l, 0.5), l.end].forEach(function (p) {
            var residual = surfaceResidual(s, p);
            if (!(residual <= tol))
              add('surface-boundary-off-surface', 'A line boundary does not lie on ' + s.id + '.', s.sourceIds);
          });
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
            } else if (s.kind === 'torus') {
              ok = surfaceResidual(s, p) <= tol;
            }
            if (!ok) { add('surface-boundary-off-surface', 'A boundary curve does not lie on ' + s.id + '.', s.sourceIds); break; }
          }

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






  var DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;
  function exactNormalize(n, d) {
    if (!d) throw new Error('Zero denominator');
    if (d < 0n) { n = -n; d = -d; }
    var a = n < 0n ? -n : n, b = d;
    while (b) { var r = a % b; a = b; b = r; }
    var g = a || 1n;
    return {n:n/g, d:d/g};
  }
  function exactNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    var match = String(value).match(DECIMAL_RE);
    if (!match) return null;
    var fraction = match[3] || '', exponent = Number(match[4] || 0) - fraction.length;
    var n = BigInt(match[2] + fraction) * (match[1] ? -1n : 1n), d = 1n;
    if (exponent >= 0) n *= 10n ** BigInt(exponent);
    else d = 10n ** BigInt(-exponent);
    return exactNormalize(n, d);
  }
  function exactAdd(a, b) { return exactNormalize(a.n*b.d + b.n*a.d, a.d*b.d); }
  function exactSub(a, b) { return exactNormalize(a.n*b.d - b.n*a.d, a.d*b.d); }
  function exactMul(a, b) { return exactNormalize(a.n*b.n, a.d*b.d); }
  function exactZero(a) { return a.n === 0n; }
  function exactEqual(a, b) { return a.n === b.n && a.d === b.d; }
  function exactVector(v) {
    if (!finite(v)) return null;
    var x = exactNumber(v.x), y = exactNumber(v.y), z = exactNumber(v.z);
    return x && y && z ? [x, y, z] : null;
  }
  function exactSubVectors(a, b) { return [exactSub(a[0],b[0]), exactSub(a[1],b[1]), exactSub(a[2],b[2])]; }
  function exactCrossVectors(a, b) {
    return [exactSub(exactMul(a[1],b[2]), exactMul(a[2],b[1])),
      exactSub(exactMul(a[2],b[0]), exactMul(a[0],b[2])),
      exactSub(exactMul(a[0],b[1]), exactMul(a[1],b[0]))];
  }
  function exactDotVectors(a, b) {
    return exactAdd(exactAdd(exactMul(a[0],b[0]), exactMul(a[1],b[1])), exactMul(a[2],b[2]));
  }
  function exactZeroVector(v) { return v.every(exactZero); }
  function exactNumbersEqual(a, b) {
    var x = exactNumber(a), y = exactNumber(b);
    return !!(x && y && exactEqual(x, y));
  }
  function exactPositive(value) {
    var x = exactNumber(value);
    return !!(x && x.n > 0n);
  }


  function exactCoplanar(points) {
    if (!points || points.length < 3) return {ok:false, reason:'fewer-than-three'};
    var exactPoints = points.map(exactVector);
    if (exactPoints.some(function (p) { return !p; })) return {ok:false, reason:'non-finite'};
    var p0 = exactPoints[0], i1 = -1, i;
    for (i=1;i<exactPoints.length;i++) {
      if (!exactZeroVector(exactSubVectors(exactPoints[i], p0))) { i1 = i; break; }
    }
    if (i1 < 0) return {ok:false, reason:'coincident'};
    var e1 = exactSubVectors(exactPoints[i1], p0), i2 = -1;
    for (i=1;i<exactPoints.length;i++) {
      if (i === i1) continue;
      var e = exactSubVectors(exactPoints[i], p0);
      if (!exactZeroVector(exactCrossVectors(e1, e))) { i2 = i; break; }
    }
    if (i2 < 0) return {ok:false, reason:'collinear'};
    var n = exactCrossVectors(e1, exactSubVectors(exactPoints[i2], p0));
    for (i=0;i<exactPoints.length;i++) {
      if (i === 0 || i === i1 || i === i2) continue;
      if (!exactZero(exactDotVectors(n, exactSubVectors(exactPoints[i], p0))))
        return {ok:false, reason:'noncoplanar', pointIndex:i};
    }
    return {ok:true};
  }

  function copyPoint(p) { return finite(p) ? {x:p.x, y:p.y, z:p.z} : null; }
  function surfaceParameters(s) {
    if (!s) return {};
    if (s.kind === 'plane') return {origin:copyPoint(s.origin), normal:copyPoint(s.normal),
      u:copyPoint(s.u), v:copyPoint(s.v)};
    if (s.kind === 'cylinder') return {origin:copyPoint(s.origin), axis:copyPoint(s.axis), radius:s.radius};
    if (s.kind === 'cone') return {origin:copyPoint(s.origin), axis:copyPoint(s.axis),
      radius:s.radius, apex:copyPoint(s.apex), halfAngle:s.halfAngle};
    if (s.kind === 'sphere') return {center:copyPoint(s.center), radius:s.radius};
    if (s.kind === 'torus') return {center:copyPoint(s.center), axis:copyPoint(s.axis),
      majorRadius:s.majorRadius, minorRadius:s.minorRadius,
      domain:s.domain ? {u:s.domain.u.slice(), v:s.domain.v.slice()} : null};
    return {};
  }
  function torusParameters(surface, p) {
    if (!surface || surface.kind !== 'torus' || !finite(p)) return null;
    var axis = unit(surface.axis), frame = basis(axis);
    var q = sub(p, surface.center);
    var axial = dot(q, axis);
    var radial = sub(q, mul(axis, axial));
    var rho = length(radial);
    if (rho <= EPS) return null;
    return {u:Math.atan2(dot(radial, frame.v), dot(radial, frame.u)),
      v:Math.atan2(axial, rho - surface.majorRadius), rho:rho, axial:axial};
  }
  function validTorusDomain(domain) {
    if (!domain) return false;
    function interval(pair) {
      return Array.isArray(pair) && pair.length === 2 &&
        Number.isFinite(pair[0]) && Number.isFinite(pair[1]) &&
        pair[1] - pair[0] > EPS && pair[1] - pair[0] <= TAU + EPS;
    }
    return interval(domain.u) && interval(domain.v);
  }
  function angleWithin(value, start, end, tolerance) {
    var span = end - start;
    if (span >= TAU - 1e-9) return {inside:true, distance:0, boundary:false};
    var d = ((value - start) % TAU + TAU) % TAU;
    if (d > span + tolerance) return {inside:false, distance:Math.min(d - span, TAU - d), boundary:false};
    var edge = Math.min(d, span - d);
    return {inside:true, distance:edge, boundary:edge <= tolerance};
  }

  function surfaceTolerance(s) {
    var radius = Math.abs((s && s.radius) || 0);
    if (s && Number.isFinite(s.majorRadius))
      radius = Math.max(radius, Math.abs(s.majorRadius));
    if (s && s.generator) {
      radius = Math.max(radius, length(s.generator.A || {x:0,y:0,z:0}),
        length(s.generator.B || {x:0,y:0,z:0}),
        length(sub(s.generator.D || {x:0,y:0,z:0}, s.generator.C || {x:0,y:0,z:0})));
      if (finite(s.generator.A2)) radius = Math.max(radius, length(s.generator.A2));
      if (finite(s.generator.B2)) radius = Math.max(radius, length(s.generator.B2));
    }
    return 1e-5 * Math.max(1, Number.isFinite(radius) ? radius : 1);
  }
  function surfaceResidual(s, p) {
    if (!s || !finite(p)) return Infinity;
    if (s.kind === 'plane') {
      return finite(s.origin) && finite(s.normal) ? Math.abs(dot(sub(p, s.origin), s.normal)) : Infinity;
    }
    if (s.kind === 'torus') {
      if (!finite(s.center) || !finite(s.axis) || !(s.majorRadius > 0) || !(s.minorRadius > 0))
        return Infinity;
      var q = sub(p, s.center), axisT = unit(s.axis);
      var axialT = dot(q, axisT);
      var radialT = Math.sqrt(Math.max(0, dot(q,q) - axialT*axialT));
      return Math.abs(Math.sqrt(Math.pow(radialT - s.majorRadius, 2) + axialT*axialT) - s.minorRadius);
    }
    if (s.kind === 'cylinder') {
      if (!finite(s.origin) || !finite(s.axis) || !(s.radius > 0)) return Infinity;
      var cd = sub(p, s.origin), ca = dot(cd, unit(s.axis));
      return Math.abs(Math.sqrt(Math.max(0, dot(cd,cd) - ca*ca)) - s.radius);
    }
    if (s.kind === 'cone') {
      if (!finite(s.axis) || !Number.isFinite(s.halfAngle)) return Infinity;
      var apex = s.apex || s.origin;
      if (!finite(apex)) return Infinity;
      var dc = sub(p, apex), ac = dot(dc, unit(s.axis));
      return Math.abs(Math.sqrt(Math.max(0, dot(dc,dc) - ac*ac)) - Math.abs(ac)*Math.tan(s.halfAngle));
    }
    if (s.kind === 'sphere') {
      return finite(s.center) && s.radius > 0 ? Math.abs(length(sub(p, s.center)) - s.radius) : Infinity;
    }
    if (s.kind === 'implicit' || s.kind === 'polynomial') {
      var implicitSurface = implicitEquationFor(s);
      if (!implicitSurface || !Implicit) return Infinity;
      var implicitValue = Implicit.evaluate(implicitSurface, p);
      if (!implicitValue) return Infinity;
      var implicitGradient = length(implicitValue.gradient);
      return implicitGradient > 0 ? Math.abs(implicitValue.value) / implicitGradient : Infinity;
    }
    return Infinity;
  }
  function boundaryCurve(element, curves) {
    if (typeof element === 'string') {
      var m = /^c:(\d+)$/.exec(element);
      return m ? curves[Number(m[1])] : null;
    }
    return element && typeof element === 'object' && element.kind !== 'line' ? element : null;
  }
  function boundaryElementKind(element) {
    if (typeof element === 'string') {
      if (/^c:\d+$/.test(element)) return 'curve';
      if (/^e:\d+_\d+$/.test(element)) return 'edge';
      if (/^p:/.test(element)) return 'edge';
      return 'unknown';
    }
    if (element && typeof element === 'object') return element.kind === 'line' ? 'line' : 'section';
    return 'unknown';
  }
  function boundarySourceIds(element, curves) {
    if (element && typeof element === 'object' && element.kind === 'line')
      return Array.isArray(element.sourceIds) ? element.sourceIds.slice() : [];
    var c = boundaryCurve(element, curves);
    return c && Array.isArray(c.sourceIds) ? c.sourceIds.slice() : [];
  }
  function boundaryCurveValid(c) {
    if (!validCurve(c)) return false;
    if (c.startAngle !== undefined && !Number.isFinite(c.startAngle)) return false;
    if (c.sweepAngle !== undefined && (!Number.isFinite(c.sweepAngle) || c.sweepAngle <= 0)) return false;
    return true;
  }
  function sampleBoundaryCurve(c, count) {
    var start = Number.isFinite(c.startAngle) ? c.startAngle : 0;
    var sweep = Number.isFinite(c.sweepAngle) ? c.sweepAngle : TAU;
    var points = [];
    for (var i=0;i<=count;i++) points.push(curvePoint(c, start + sweep*i/count));
    return points;
  }

  function certify(model, geometry) {
    if (!model || !Array.isArray(model.surfaces)) return null;
    var curves = geometry && geometry.curves || [];
    var vertices = geometry && geometry.vertices || [];
    var issues = [];
    var counters = {checks:0, exactChecks:0, numericChecks:0};
    var graph = incidence(model);
    var elementId = graph.elementId;

    function unique(values) {
      var out = [];
      (values || []).forEach(function(v) { if (out.indexOf(v) === -1) out.push(v); });
      return out;
    }
    function issue(code, message, detail) {
      detail = detail || {};
      var record = {id:'issue:' + issues.length, code:code,
        severity:detail.severity || 'error', message:message,
        sourceIds:unique(detail.sourceIds || [])};
      ['surfaceId','boundaryId','check','arithmetic'].forEach(function (key) {
        if (detail[key] !== undefined) record[key] = detail[key];
      });
      ['surfaceIds','boundaryIds'].forEach(function (key) {
        if (detail[key] !== undefined) record[key] = unique(detail[key]);
      });
      ['residual','tolerance'].forEach(function (key) {
        if (detail[key] !== undefined && Number.isFinite(detail[key])) record[key] = detail[key];
      });
      issues.push(record);
      return record;
    }
    function check(owner, surface, name, spec) {
      spec = spec || {};
      spec.id = owner.id + '/check:' + name;
      spec.check = name;
      spec.status = spec.status || 'ok';
      spec.arithmetic = spec.arithmetic || 'numeric';
      spec.method = spec.method || (spec.arithmetic.indexOf('exact') === 0 ? 'exact' : 'numeric');
      if (spec.residual !== undefined && !Number.isFinite(spec.residual)) delete spec.residual;
      owner.checks.push(spec);
      counters.checks++;
      if (spec.arithmetic.indexOf('exact') === 0) counters.exactChecks++;
      else counters.numericChecks++;
      if (spec.status === 'failed') {
        issue(spec.issue || 'certificate-check-failed',
          spec.message || ('Check "' + name + '" failed for ' + surface.id + '.'),
          {surfaceId:surface.id, check:name, arithmetic:spec.arithmetic,
            residual:spec.residual, tolerance:spec.tolerance,
            sourceIds:spec.sourceIds || owner.sourceIds});
      }
      return spec;
    }
    function checkLabel(name, suffix) {
      return name.replace(new RegExp('-' + suffix + '$'), '').replace(/^(plane|cylinder|cone|sphere)-/, '');
    }
    function finiteVector(owner, surface, name, value, issueCode) {
      var ok = !!finite(value);
      check(owner, surface, name, {status:ok?'ok':'failed', arithmetic:'exact-decimal-rational',
        method:'exact-finiteness', issue:issueCode,
        message:surface.id + ' has no finite ' + checkLabel(name, 'finite') + '.'});
      return ok;
    }
    function positiveExact(owner, surface, name, value, issueCode) {
      var ok = exactPositive(value);
      check(owner, surface, name, {status:ok?'ok':'failed', arithmetic:'exact-decimal-rational',
        method:'exact-rational', issue:issueCode,
        message:surface.id + ' needs an exactly positive ' + checkLabel(name, 'positive') + '.'});
      return ok;
    }
    function unitVector(owner, surface, name, value, issueCode, tolerance) {
      var ok = !!finite(value), residual = ok ? Math.abs(length(value) - 1) : Infinity;
      tolerance = tolerance || EPS;
      check(owner, surface, name, {status:ok && residual <= tolerance ? 'ok':'failed',
        arithmetic:'numeric', method:'numeric-direction', residual:residual, tolerance:tolerance,
        issue:issueCode, message:surface.id + ' has a non-unit ' + checkLabel(name, 'unit') + '.'});
      return ok && residual <= tolerance;
    }

    (model.diagnostics || []).forEach(function (d) {
      issue(d.code || 'certificate-model-diagnostic', d.message || 'The surface model reported a diagnostic.',
        {sourceIds:d.sourceIds || []});
    });

    var idCounts = new Map();
    model.surfaces.forEach(function (s) {
      var key = s && s.id;
      idCounts.set(key, (idCounts.get(key) || 0) + 1);
    });




    var uses = graph.uses;

    function loopIncidence(loop) {
      var ids = loopElements(loop).map(elementId);
      var elements = ids.map(function (id) {
        var use = uses.get(id);
        return {id:id, useCount:use ? use.useCount : 0, surfaces:use ? use.surfaceIds.slice() : []};
      });
      return {elements:elements,
        shared:elements.length > 0 && elements.every(function (e) { return e.useCount === 2 && e.surfaces.length === 2; }),
        open:elements.some(function (e) { return e.useCount === 1; }),
        nonmanifold:elements.some(function (e) { return e.useCount > 2 || (e.useCount === 2 && e.surfaces.length !== 2); }),
        selfShared:elements.some(function (e) { return e.useCount === 2 && e.surfaces.length === 1; })};
    }


    var surfaceRecords = model.surfaces.map(function (s, si) {
      var id = s && typeof s.id === 'string' ? s.id : 'surface-index:' + si;
      var surface = s || {};
      var rec = {id:id, kind:surface.kind || 'unknown', closed:surface.closed === true,
        sourceIds:unique(surface.sourceIds || []),
        displayFaceIndices:(surface.displayFaceIndices || []).slice(),
        parameters:surfaceParameters(surface), loops:[], checks:[], status:'ok',
        boundaryApproximate:surface.approximateBoundary === true};
      var known = ['plane','cylinder','cone','sphere','torus','implicit','polynomial'].indexOf(rec.kind) !== -1;

      check(rec, rec, 'surface-id-present', {status:typeof surface.id === 'string' && surface.id !== '' ? 'ok':'failed',
        arithmetic:'exact-combinatorial', method:'combinatorial', issue:'certificate-surface-id-missing',
        message:'A surface record has no stable id.'});
      check(rec, rec, 'surface-id-unique', {status:(idCounts.get(surface.id) || 0) <= 1 ? 'ok':'failed',
        arithmetic:'exact-combinatorial', method:'combinatorial', issue:'certificate-surface-id-duplicate',
        message:'Several surface records reuse the id ' + id + '.'});
      check(rec, rec, 'surface-kind-supported', {status:known ? 'ok':'failed',
        arithmetic:'exact-combinatorial', method:'combinatorial', issue:'certificate-surface-kind-unsupported',
        message:'The surface kind "' + rec.kind + '" has no analytic certificate.'});

      var hasLoops = (surface.loops || []).length > 0;
      var domainBounded = rec.kind === 'torus' && validTorusDomain(surface.domain);
      check(rec, rec, 'surface-bounded', {status:hasLoops || rec.closed || domainBounded ? 'ok':'failed',
        arithmetic:'exact-combinatorial', method:'combinatorial', issue:'certificate-surface-unbounded',
        message:'A surface with no boundary loop is not marked closed.'});
      check(rec, rec, 'surface-closed-consistency',
        {status:!(rec.closed && hasLoops) ? 'ok':'failed', arithmetic:'exact-combinatorial',
          method:'combinatorial', issue:'certificate-surface-closed-with-boundaries',
          message:'A surface marked closed still carries boundary loops.'});

      if (rec.kind === 'plane') {
        finiteVector(rec, rec, 'plane-origin-finite', surface.origin, 'certificate-plane-origin-invalid');
        if (finite(surface.normal)) {
          var nr = Math.abs(length(surface.normal) - 1);
          check(rec, rec, 'plane-normal-unit', {status:nr <= EPS ? 'ok':'failed', arithmetic:'numeric',
            method:'numeric-direction', residual:nr, tolerance:EPS,
            issue:'certificate-plane-normal-invalid', message:rec.id + ' has a non-unit normal.'});
        } else {
          check(rec, rec, 'plane-normal-unit', {status:'failed', arithmetic:'numeric',
            method:'numeric-direction', issue:'certificate-plane-normal-invalid',
            message:rec.id + ' has no finite normal.'});
        }
        if (finite(surface.u) && finite(surface.v) && finite(surface.normal)) {
          var fr = Math.max(Math.abs(length(surface.u)-1), Math.abs(length(surface.v)-1),
            Math.abs(dot(surface.u, surface.v)), Math.abs(dot(surface.u, surface.normal)),
            Math.abs(dot(surface.v, surface.normal)));
          check(rec, rec, 'plane-frame-orthonormal', {status:fr <= EPS ? 'ok':'failed', arithmetic:'numeric',
            method:'numeric-direction', residual:fr, tolerance:EPS,
            issue:'certificate-plane-frame-invalid', message:rec.id + ' has a non-orthonormal plane frame.'});
        } else {
          check(rec, rec, 'plane-frame-orthonormal', {status:'failed', arithmetic:'numeric',
            method:'numeric-direction', issue:'certificate-plane-frame-invalid',
            message:rec.id + ' has no finite plane frame.'});
        }
      } else if (rec.kind === 'cylinder') {
        finiteVector(rec, rec, 'cylinder-origin-finite', surface.origin, 'certificate-cylinder-origin-invalid');
        positiveExact(rec, rec, 'cylinder-radius-positive', surface.radius, 'certificate-cylinder-radius-invalid');
        unitVector(rec, rec, 'cylinder-axis-unit', surface.axis, 'certificate-cylinder-axis-invalid');
      } else if (rec.kind === 'cone') {
        finiteVector(rec, rec, 'cone-origin-finite', surface.origin, 'certificate-cone-origin-invalid');
        positiveExact(rec, rec, 'cone-radius-positive', surface.radius, 'certificate-cone-radius-invalid');
        unitVector(rec, rec, 'cone-axis-unit', surface.axis, 'certificate-cone-axis-invalid');
        finiteVector(rec, rec, 'cone-apex-finite', surface.apex, 'certificate-cone-apex-invalid');
        if (Number.isFinite(surface.halfAngle)) {
          var hpos = exactPositive(surface.halfAngle), hrange = hpos && surface.halfAngle < Math.PI/2;
          check(rec, rec, 'cone-half-angle-range', {status:hrange ? 'ok':'failed', arithmetic:'numeric',
            method:'numeric-range', issue:'certificate-cone-half-angle-invalid',
            message:rec.id + ' needs 0 < halfAngle < pi/2.'});
        } else {
          check(rec, rec, 'cone-half-angle-range', {status:'failed', arithmetic:'numeric',
            method:'numeric-range', issue:'certificate-cone-half-angle-invalid',
            message:rec.id + ' has no finite halfAngle.'});
        }
        if (finite(surface.axis) && finite(surface.apex) && finite(surface.origin)) {
          var ad = sub(surface.apex, surface.origin), aa = dot(ad, unit(surface.axis));
          var ar = Math.sqrt(Math.max(0, dot(ad,ad) - aa*aa));
          check(rec, rec, 'cone-apex-on-axis', {status:ar <= surfaceTolerance(surface) ? 'ok':'failed',
            arithmetic:'numeric', method:'numeric-direction', residual:ar, tolerance:surfaceTolerance(surface),
            issue:'certificate-cone-apex-off-axis', message:rec.id + ' has an apex off its own axis.'});
          var axial = Math.abs(aa);
          var expected = axial * Math.tan(surface.halfAngle);
          var hr = Math.abs(expected - surface.radius);
          check(rec, rec, 'cone-half-angle-radius', {status:hr <= surfaceTolerance(surface) ? 'ok':'failed',
            arithmetic:'numeric', method:'numeric-relation', residual:hr, tolerance:surfaceTolerance(surface),
            issue:'certificate-cone-radius-mismatch',
            message:rec.id + ' has a half-angle that does not reproduce its base radius.'});
        } else {
          check(rec, rec, 'cone-apex-on-axis', {status:'failed', arithmetic:'numeric',
            method:'numeric-direction', issue:'certificate-cone-apex-off-axis',
            message:rec.id + ' cannot place its apex on an axis.'});
          check(rec, rec, 'cone-half-angle-radius', {status:'failed', arithmetic:'numeric',
            method:'numeric-relation', issue:'certificate-cone-radius-mismatch',
            message:rec.id + ' cannot relate its half-angle to a base radius.'});
        }
      } else if (rec.kind === 'sphere') {
        finiteVector(rec, rec, 'sphere-center-finite', surface.center, 'certificate-sphere-center-invalid');
        positiveExact(rec, rec, 'sphere-radius-positive', surface.radius, 'certificate-sphere-radius-invalid');
      } else if (rec.kind === 'implicit' || rec.kind === 'polynomial') {
        var implicitEquation = implicitEquationFor(surface);
        finiteVector(rec, rec, 'implicit-origin-finite', surface.origin, 'certificate-implicit-origin-invalid');
        check(rec, rec, 'implicit-equation-valid', {
          status:implicitEquation && Implicit && Implicit.equationIsValid(implicitEquation) ? 'ok' : 'failed',
          arithmetic:'exact-combinatorial', method:'combinatorial',
          issue:'certificate-implicit-equation-invalid',
          message:rec.id + ' has no valid polynomial equation.'});
        if (implicitEquation && Implicit && Implicit.equationIsValid(implicitEquation)) {
          var implicitDegree = implicitEquation.degree;
          var degreeSupported = Number.isInteger(implicitDegree) && implicitDegree >= 1 &&
            (implicitDegree <= 2 || (implicitDegree === 4 && implicitEquation.paramChart &&
              Implicit.paramChartStatus(implicitEquation) === 'ok'));
          check(rec, rec, 'implicit-degree-supported', {
            status:degreeSupported ? 'ok' : 'failed',
            arithmetic:'exact-combinatorial', method:'combinatorial',
            issue:'certificate-implicit-degree-unsupported',
            message:rec.id + ' has an unsupported implicit degree.'});
        }
      } else if (rec.kind === 'torus') {
        finiteVector(rec, rec, 'torus-center-finite', surface.center, 'certificate-torus-center-invalid');
        positiveExact(rec, rec, 'torus-major-positive', surface.majorRadius, 'certificate-torus-major-invalid');
        positiveExact(rec, rec, 'torus-minor-positive', surface.minorRadius, 'certificate-torus-minor-invalid');
        unitVector(rec, rec, 'torus-axis-unit', surface.axis, 'certificate-torus-axis-invalid');
        if (surface.domain) {
          check(rec, rec, 'torus-domain-valid', {status:validTorusDomain(surface.domain) ? 'ok' : 'failed',
            arithmetic:'numeric', method:'periodic-interval',
            issue:'certificate-torus-domain-invalid',
            message:rec.id + ' has an invalid torus parameter domain.'});
        }
      }



      if (rec.kind === 'plane') {
        var planePoints = [];
        (surface.loops || []).forEach(function (loop) {
          (loop.vertices || []).forEach(function (i) { if (finite(vertices[i])) planePoints.push(vertices[i]); });
          loopInlinePoints(loop).forEach(function (p) { if (finite(p)) planePoints.push(p); });
        });
        if (planePoints.length) {
          var exact = exactCoplanar(planePoints);
          if (exact.ok) {
            check(rec, rec, 'plane-boundary-coplanar', {status:'ok', arithmetic:'exact-decimal-rational',
              method:'exact-rational', issue:'certificate-plane-boundary-not-coplanar'});
          } else {
            var pr = 0;
            planePoints.forEach(function (p) { pr = Math.max(pr, surfaceResidual(surface, p)); });
            var ptol = surfaceTolerance(surface);
            var degenerate = exact.reason === 'collinear' || exact.reason === 'coincident' || exact.reason === 'fewer-than-three';
            check(rec, rec, 'plane-boundary-coplanar', {status:!degenerate && pr <= ptol ? 'ok':'failed',
              arithmetic:'numeric', method:'numeric-fallback', residual:pr, tolerance:ptol,
              exactPass:false, exactReason:exact.reason,
              issue:degenerate ? 'certificate-plane-boundary-degenerate' : 'certificate-plane-boundary-not-coplanar',
              message:degenerate ? rec.id + ' has a degenerate plane boundary.' :
                rec.id + ' boundary vertices are not exactly coplanar.'});
          }
        }
      }

      (surface.loops || []).forEach(function (loop, li) {
        var elements = loopElements(loop).map(elementId);
        var sourceIds = [];
        elements.forEach(function (element) {
          var use = uses.get(element);
          if (use) sourceIds = sourceIds.concat(boundarySourceIds(use.element, curves));
        });
        var loopRec = {id:rec.id + '/loop:' + li, kind:loop.kind || 'outer',
          elements:elements, checks:[], sourceIds:unique(sourceIds), status:'ok'};
        if (loop.vertices) loopRec.vertices = loop.vertices.slice();
        if (loop.curves) loopRec.curves = loop.curves.slice();
        if (loop.points) loopRec.points = loop.points.slice();
        if (loop.elements) loopRec.elements = loop.elements.map(function (el) {
          return el && el.kind === 'curve' ? {kind:'curve', curve:elementId(el.curve)} :
            el && el.kind === 'polyline' ? {kind:'polyline', points:(el.points || []).length} : {kind:'unknown'};
        });
        if (loop.lines) loopRec.lines = loop.lines.map(elementId);
        if (loop.section) loopRec.section = elementId(loop.section);
        loopRec.incidence = loopIncidence(loop);
        if (!elements.length) {
          loopRec.status = 'issues';
          issue('certificate-boundary-empty-loop', rec.id + ' has a boundary loop with no elements.',
            {surfaceId:rec.id, sourceIds:rec.sourceIds});
        }

        var tol = surfaceTolerance(surface);
        var maxResidual = 0, samples = 0, missing = false, invalidCurve = false,
          invalidLine = false, lineCount = 0, lineMinimum = Infinity, undefinedResidual = false;
        (loop.vertices || []).forEach(function (i) {
          var p = vertices[i];
          if (!finite(p)) { missing = true; return; }
          var r = surfaceResidual(surface, p);
          if (!Number.isFinite(r)) undefinedResidual = true;
          else maxResidual = Math.max(maxResidual, r);
          samples++;
        });
        loopInlinePoints(loop).forEach(function (p) {
          if (!finite(p)) { missing = true; return; }
          var r = surfaceResidual(surface, p);
          if (!Number.isFinite(r)) undefinedResidual = true;
          else maxResidual = Math.max(maxResidual, r);
          samples++;
        });
        loopCurves(loop, curves).forEach(function (c) {
          if (!boundaryCurveValid(c)) { invalidCurve = true; return; }
          sampleBoundaryCurve(c, 32).forEach(function (p) {
            var r = surfaceResidual(surface, p);
            if (!Number.isFinite(r)) undefinedResidual = true;
            else maxResidual = Math.max(maxResidual, r);
            samples++;
          });
        });
        (loop.lines || []).forEach(function (l) {
          lineCount++;
          if (!finiteLine(l)) { invalidLine = true; return; }
          lineMinimum = Math.min(lineMinimum, length(sub(l.end, l.start)));
          [l.start, linePoint(l, 0.5), l.end].forEach(function (p) {
            var r = surfaceResidual(surface, p);
            if (!Number.isFinite(r)) undefinedResidual = true;
            else maxResidual = Math.max(maxResidual, r);
            samples++;
          });
        });
        if (lineCount) {
          check(loopRec, rec, 'boundary-lines-finite', {
            status:invalidLine ? 'failed' : 'ok', arithmetic:'exact-decimal-rational',
            method:'exact-finiteness', issue:'certificate-line-boundary-invalid',
            message:'A loop line boundary is not a finite line element.',
            sourceIds:loopRec.sourceIds.length ? loopRec.sourceIds : rec.sourceIds});
          if (!invalidLine) check(loopRec, rec, 'boundary-line-length', {
            status:lineMinimum > tol ? 'ok' : 'failed', arithmetic:'numeric',
            method:'numeric-length-lower-bound',
            residual:Number.isFinite(lineMinimum) ? lineMinimum : undefined, tolerance:tol,
            issue:'certificate-line-boundary-degenerate',
            message:'A line boundary is shorter than the surface tolerance.',
            sourceIds:loopRec.sourceIds.length ? loopRec.sourceIds : rec.sourceIds});
        }
        if (missing) {
          loopRec.status = 'issues';
          issue('certificate-boundary-missing-vertex', rec.id + ' references a missing boundary vertex.',
            {surfaceId:rec.id, boundaryId:loopRec.id, sourceIds:rec.sourceIds});
        }
        if (invalidCurve) {
          loopRec.status = 'issues';
          issue('certificate-boundary-invalid-curve', rec.id + ' references an invalid analytic boundary.',
            {surfaceId:rec.id, boundaryId:loopRec.id, sourceIds:loopRec.sourceIds.length ? loopRec.sourceIds : rec.sourceIds});
        }
        if (undefinedResidual) {
          loopRec.status = 'issues';
          check(loopRec, rec, 'boundary-on-surface', {status:'failed', arithmetic:'numeric',
            method:'numeric-sampled', issue:'certificate-boundary-unchecked',
            message:'The surface parameters do not define a finite residual for this boundary.',
            sourceIds:loopRec.sourceIds.length ? loopRec.sourceIds : rec.sourceIds});
        } else if (!missing && !invalidCurve && samples) {
          check(loopRec, rec, 'boundary-on-surface', {status:maxResidual <= tol ? 'ok':'failed',
            arithmetic:'numeric', method:'numeric-sampled', residual:maxResidual,
            tolerance:tol, samples:samples, issue:'certificate-boundary-off-surface',
            message:'A boundary element does not lie on ' + rec.id + '.',
            sourceIds:loopRec.sourceIds.length ? loopRec.sourceIds : rec.sourceIds});
        }




        if (rec.kind === 'cylinder') {
          loopCurves(loop, curves).forEach(function (c) {
            if (!boundaryCurveValid(c)) return;
            var minor = c.kind === 'circle' ? c.radius : Math.min(radii(c).u, radii(c).v);
            if (Number.isFinite(minor)) {
              var exactRadius = exactNumbersEqual(minor, surface.radius);
              var rr = Math.abs(minor - surface.radius);
              check(loopRec, rec, 'cylinder-boundary-radius', {status:exactRadius || rr <= tol ? 'ok':'failed',
                arithmetic:exactRadius ? 'exact-decimal-rational' : 'numeric',
                method:exactRadius ? 'exact-rational' : 'numeric', residual:rr, tolerance:tol,
                exactPass:exactRadius, issue:'certificate-cylinder-radius-mismatch',
                message:'A cylinder boundary radius does not match ' + rec.id + '.',
                sourceIds:boundarySourceIds(c, curves)});
            }
            var cut;
            try { cut = section(surface, {origin:c.center, normal:curveNormal(c)}); }
            catch (err) { cut = null; }
            if (!cut || (cut.kind !== 'circle' && cut.kind !== 'ellipse')) {
              check(loopRec, rec, 'cylinder-boundary-section', {status:'failed', arithmetic:'numeric',
                method:'numeric-section', issue:'certificate-cylinder-section-mismatch',
                message:'The boundary plane does not section ' + rec.id + ' in its drawn boundary.',
                sourceIds:boundarySourceIds(c, curves)});
            } else {
              var cr = radii(c), sr = radii(cut);
              var ccr = [cr.u, cr.v].sort(function (a,b) { return a-b; });
              var scr = [sr.u, sr.v].sort(function (a,b) { return a-b; });
              var secResidual = Math.max(length(sub(cut.center, c.center)),
                Math.abs(ccr[0]-scr[0]), Math.abs(ccr[1]-scr[1]));
              check(loopRec, rec, 'cylinder-boundary-section', {status:secResidual <= tol ? 'ok':'failed',
                arithmetic:'numeric', method:'numeric-section', residual:secResidual, tolerance:tol,
                issue:'certificate-cylinder-section-mismatch',
                message:'The section through ' + rec.id + ' does not match its drawn boundary.',
                sourceIds:boundarySourceIds(c, curves)});
            }
            var cd = sub(c.center, surface.origin), axial = dot(cd, unit(surface.axis));
            var radial = Math.sqrt(Math.max(0, dot(cd,cd) - axial*axial));
            check(loopRec, rec, 'cylinder-boundary-axis', {status:radial <= tol ? 'ok':'failed',
              arithmetic:'numeric', method:'numeric-direction', residual:radial, tolerance:tol,
              issue:'certificate-cylinder-boundary-axis', message:'A cylinder boundary is not centred on its axis.',
              sourceIds:boundarySourceIds(c, curves)});
          });
        } else if (rec.kind === 'cone') {
          loopCurves(loop, curves).forEach(function (c) {
            if (!boundaryCurveValid(c) || !finite(surface.axis)) return;
            var cd = sub(c.center, surface.origin), axial = dot(cd, unit(surface.axis));
            var radial = Math.sqrt(Math.max(0, dot(cd,cd) - axial*axial));
            check(loopRec, rec, 'cone-boundary-axis', {status:radial <= tol ? 'ok':'failed',
              arithmetic:'numeric', method:'numeric-direction', residual:radial, tolerance:tol,
              issue:'certificate-cone-boundary-axis', message:'A cone boundary is not centred on its axis.',
              sourceIds:boundarySourceIds(c, curves)});
          });
        }

        if (loopRec.checks.some(function (c) { return c.status === 'failed'; }) ||
            loopRec.incidence.nonmanifold || loopRec.incidence.open ||
            !elements.length || missing || invalidCurve || invalidLine || undefinedResidual) {
          if (loopRec.status !== 'issues')
            loopRec.status = loopRec.incidence.nonmanifold ? 'issues' : 'partial';
        }
        rec.loops.push(loopRec);
      });

      var failed = rec.checks.some(function (c) { return c.status === 'failed'; }) ||
        rec.loops.some(function (l) { return l.status === 'issues'; });
      var open = rec.loops.some(function (l) { return l.status === 'partial'; });
      rec.status = failed ? 'issues' : open ? 'partial' : 'ok';
      return rec;
    });



    var boundaryRecords = [];
    uses.forEach(function (use) {
      var status = use.useCount > 2 ? 'nonmanifold' :
        use.useCount === 2 ? (use.surfaceIds.length === 2 ? 'shared' : 'self-shared') :
        use.useCount === 1 ? 'open' : 'invalid';
      var rec = {id:use.id, kind:use.kind, sourceIds:unique(boundarySourceIds(use.element, curves)),
        useCount:use.useCount, surfaces:use.surfaceIds.slice(), status:status};
      if (use.kind === 'curve') {
        var m = /^c:(\d+)$/.exec(use.id); rec.curveIndex = m ? Number(m[1]) : null;
      } else if (use.kind === 'edge') {
        var e = /^e:(\d+)_(\d+)$/.exec(use.id);
        rec.vertices = e ? [Number(e[1]), Number(e[2])] : [];
      } else if (use.kind === 'section') {
        rec.sectionType = use.element && (use.element.sectionType || use.element.kind) || null;
      } else if (use.kind === 'line') {
        rec.lineType = 'segment';
        rec.start = copyPoint(use.element && use.element.start);
        rec.end = copyPoint(use.element && use.element.end);
        rec.length = lineLength(use.element);
      }
      if (status === 'nonmanifold') {
        issue('certificate-boundary-nonmanifold', 'A boundary is shared by more than two surfaces.',
          {boundaryId:use.id, sourceIds:rec.sourceIds});
      } else if (status === 'self-shared') {
        issue('certificate-boundary-self-shared', 'A surface uses the same boundary element twice.',
          {boundaryId:use.id, sourceIds:rec.sourceIds, surfaceIds:use.surfaceIds});
      }
      boundaryRecords.push(rec);
    });



    var parent = model.surfaces.map(function (_, i) { return i; });
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[b] = a; }
    uses.forEach(function (use) {
      for (var i=1;i<use.loopRefs.length;i++) union(use.loopRefs[0].surfaceIndex, use.loopRefs[i].surfaceIndex);
    });
    var groups = new Map();
    model.surfaces.forEach(function (_, i) {
      var root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(i);
    });
    var shellRecords = [];
    groups.forEach(function (members) {
      var surfaceIds = members.map(function (i) { return surfaceRecords[i].id; });
      var boundaryIds = [];
      members.forEach(function (i) {
        (model.surfaces[i].loops || []).forEach(function (loop) {
          loopElements(loop).forEach(function (element) {
            var id = elementId(element);
            if (boundaryIds.indexOf(id) === -1) boundaryIds.push(id);
          });
        });
      });
      var recs = boundaryIds.map(function (id) { return uses.get(id); }).filter(Boolean);
      var nonmanifold = recs.some(function (r) {
        return r.useCount > 2 || (r.useCount === 2 && r.surfaceIds.length !== 2);
      });
      var openIds = recs.filter(function (r) { return r.useCount === 1; }).map(function (r) { return r.id; });
      var unbounded = members.some(function (i) {
        var s = model.surfaces[i];
        return (s.loops || []).length === 0 && s.closed !== true &&
          !(s.kind === 'torus' && validTorusDomain(s.domain));
      });
      var surfaced = members.every(function (i) { return surfaceRecords[i].status !== 'issues'; });
      var closed = !nonmanifold && !openIds.length && !unbounded && surfaced;
      var shell = {id:'shell:' + shellRecords.length, surfaces:unique(surfaceIds),
        boundaryIds:boundaryIds, boundaryCount:boundaryIds.length,
        openBoundaryIds:openIds, closed:closed,
        status:!closed && (nonmanifold || unbounded || !surfaced) ? 'issues' : closed ? 'ok' : 'partial',
        sourceIds:unique(members.reduce(function (all, i) {
          return all.concat(model.surfaces[i].sourceIds || []);
        }, []))};
      if (!closed && nonmanifold) {
        issue('certificate-shell-nonmanifold', 'A shell has a non-manifold boundary.',
          {severity:'error', surfaceIds:shell.surfaces, boundaryIds:boundaryIds,
            sourceIds:shell.sourceIds});
      } else if (!closed && unbounded) {
        issue('certificate-surface-unbounded', 'A shell contains an unbounded surface.',
          {severity:'error', surfaceIds:shell.surfaces, boundaryIds:boundaryIds,
            sourceIds:shell.sourceIds});
      } else if (!closed && openIds.length) {
        issue('certificate-open-component',
          'A shell is open; its boundary is not shared by exactly two surfaces.',
          {severity:'warning', surfaceIds:shell.surfaces, boundaryIds:openIds,
            sourceIds:shell.sourceIds});
      }
      shellRecords.push(shell);
    });

    var approximate = model.surfaces.some(function (s) {
      return s && s.approximateBoundary === true;
    });
    if (approximate) {
      issue('certificate-approximate-union-boundary',
        'A cavity union boundary is represented by a deterministic display Boolean; its parent analytic surfaces are certified but the trim boundary is approximate.',
        {severity:'warning', sourceIds:model.surfaces.reduce(function (all, s) {
          return all.concat(s.approximateBoundary ? (s.sourceIds || []) : []);
        }, [])});
    }
    var singularContacts = (geometry && Array.isArray(geometry.cavityRelations) ?
      geometry.cavityRelations : []).filter(function (pair) {
        return pair && pair.relation === 'touch' && pair.contact &&
          pair.contact.positiveArea === false;
      });
    if (singularContacts.length) {
      var contactSources = [];
      var cavityVolumes = geometry && geometry.cavityVolumes || [];
      singularContacts.forEach(function (pair) {
        [pair.a, pair.b].forEach(function (index) {
          var volume = cavityVolumes[index];
          if (volume && Array.isArray(volume.sourceIds))
            contactSources = contactSources.concat(volume.sourceIds);
        });
      });
      issue('certificate-singular-contact',
        'Two cavity volumes meet along a zero-area contact; the joined material manifold is not established.',
        {severity:'warning', sourceIds:unique(contactSources)});
    }
    var counts = {
      surfaces:surfaceRecords.length,
      boundaryLoops:surfaceRecords.reduce(function (n, s) { return n + s.loops.length; }, 0),
      boundaries:boundaryRecords.length,
      sharedBoundaries:boundaryRecords.filter(function (b) { return b.status === 'shared'; }).length,
      openBoundaries:boundaryRecords.filter(function (b) { return b.status === 'open'; }).length,
      nonmanifoldBoundaries:boundaryRecords.filter(function (b) { return b.status === 'nonmanifold'; }).length,
      selfSharedBoundaries:boundaryRecords.filter(function (b) { return b.status === 'self-shared'; }).length,
      closedShells:shellRecords.filter(function (s) { return s.closed; }).length,
      openComponents:shellRecords.filter(function (s) { return !s.closed; }).length,
      checks:counters.checks,
      exactChecks:counters.exactChecks,
      numericChecks:counters.numericChecks,
      errors:issues.filter(function (i) { return i.severity === 'error'; }).length,
      warnings:issues.filter(function (i) { return i.severity === 'warning'; }).length,
      issues:issues.length
    };
    var status = counts.errors ? 'issues' : surfaceRecords.length && shellRecords.every(function (s) { return s.closed; }) ? 'ok' : 'partial';
    if (!surfaceRecords.length) {
      issue('certificate-empty-model', 'There are no analytic surfaces to certify.',
        {severity:'warning'});
      counts.warnings++;
      counts.issues++;
      if (status !== 'issues') status = 'partial';
    }
    if (approximate && status === 'ok') status = 'partial';
    if (singularContacts.length && status === 'ok') status = 'partial';
    var result = {contract:'analytic-surface-certificate-v1', modelContract:model.contract || 'analytic-surface-v1',
      arithmetic:'mixed-exact-rational-and-numeric', status:status,
      surfaceCount:counts.surfaces, boundaryCount:counts.boundaries,
      counts:counts, surfaces:surfaceRecords, boundaries:boundaryRecords,
      shells:shellRecords, issues:issues};
    if (approximate) result.scope = 'display-boolean';
    else if (singularContacts.length) result.scope = 'contact';
    return result;
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







  function torusObliqueSection(surface, spec) {
    var axis = unit(surface.axis), frame = basis(axis), n = spec.normal;
    var A = dot(n, frame.u), B = dot(n, frame.v), D = dot(n, axis);
    var E = dot(n, sub(spec.origin, surface.center));
    var R = surface.majorRadius, r = surface.minorRadius;
    var Q = R*R - r*r;
    if (!(Q > EPS)) return null;
    var amp = Math.hypot(A, B);
    if (amp <= EPS) return null;
    var disc = r*r*(E*E + Q*D*D);
    var root = Math.sqrt(Math.max(0, disc));
    var w0 = (E*R - root) / Q, w1 = (E*R + root) / Q;
    if (w0 > w1) { var swap = w0; w0 = w1; w1 = swap; }
    var phiW = Math.atan2(B, A);
    function normAngle(value) { return ((value % TAU) + TAU) % TAU; }
    function tangentPointAt(u) {
      var W = A*Math.cos(u) + B*Math.sin(u);
      var M = Math.hypot(W, D);
      if (M <= EPS) return null;
      var phi = Math.atan2(D, W);
      var K = (E - R*W) / r;
      var v = phi + (K >= 0 ? 0 : Math.PI);
      var radial = R + r*Math.cos(v), axial = r*Math.sin(v);
      return add(surface.center, add(add(mul(frame.u, Math.cos(u)*radial),
        mul(frame.v, Math.sin(u)*radial)), mul(axis, axial)));
    }
    function tangentResult(candidates) {
      var points = [];
      candidates.forEach(function (point) {
        if (!point) return;
        if (!points.some(function (p) { return pointDistance(p, point) <= surfaceTolerance(surface); }))
          points.push(point);
      });
      if (!points.length) return null;
      return {contract:'torus-section-v1', kind:'points', points:points,
        surfaceId:surface.id, relation:'tangent', sectionType:'plane-torus-tangent'};
    }
    if (w1 - w0 <= 1e-9) {
      if (w0 > amp + 1e-9 || w0 < -amp - 1e-9) return null;
      var base = Math.acos(Math.max(-1, Math.min(1, w0/amp)));
      return tangentResult([tangentPointAt(phiW + base), tangentPointAt(phiW - base)]);
    }
    if (w0 > amp + 1e-9 || w1 < -amp - 1e-9) return null;
    var c = Math.max(-1, Math.min(1, w0/amp));
    var d = Math.max(-1, Math.min(1, w1/amp));
    if (d - c <= 1e-9)
      return tangentResult([tangentPointAt(phiW + (c > 0 ? 0 : Math.PI))]);
    var intervals = [];
    if (c <= -1 + 1e-12 && d >= 1 - 1e-12) {
      intervals.push({start:0, end:TAU, full:true});
    } else if (c <= -1 + 1e-12) {
      var hiOnly = Math.acos(d);
      intervals.push({start:phiW + hiOnly, end:phiW + TAU - hiOnly, full:false});
    } else if (d >= 1 - 1e-12) {
      var loOnly = Math.acos(c);
      intervals.push({start:phiW - loOnly, end:phiW + loOnly, full:false});
    } else {
      var hi = Math.acos(c), lo = Math.acos(d);
      intervals.push({start:phiW - hi, end:phiW - lo, full:false});
      intervals.push({start:phiW + lo, end:phiW + hi, full:false});
    }
    function branchRecord(branch, start, end, closed) {
      return {kind:'torusSectionBranch', branch:branch, center:surface.center,
        axis:axis, frameU:frame.u, frameV:frame.v, majorRadius:R, minorRadius:r,
        A:A, B:B, D:D, E:E, uStart:start, uEnd:end, startAngle:start,
        sweepAngle:end - start, closed:closed, surfaceId:surface.id,
        sectionType:'plane-torus-quartic', confidence:'analytic-parameterization'};
    }
    var branches = [], loops = [];
    intervals.forEach(function (interval) {
      var start = normAngle(interval.start), end = normAngle(interval.end);
      if (interval.full) start = 0, end = TAU;
      else if (end <= start + 1e-12) end += TAU;
      if (interval.full) {
        [1, -1].forEach(function (branch) {
          var index = branches.length;
          branches.push(branchRecord(branch, 0, TAU, true));
          loops.push({closed:true, full:true, branches:[index]});
        });
      } else {
        var plus = branches.length;
        branches.push(branchRecord(1, start, end, false));
        var minus = branches.length;
        branches.push(branchRecord(-1, end, start, false));
        loops.push({closed:true, full:false, branches:[plus, minus]});
      }
    });
    return {contract:'torus-section-v1', kind:'torusSection', surfaceId:surface.id,
      plane:{origin:copyPoint(spec.origin), normal:copyPoint(spec.normal)},
      relation:'transverse', sectionType:'plane-torus-quartic',
      branches:branches, loops:loops,
      parameters:{A:A, B:B, D:D, E:E, majorRadius:R, minorRadius:r,
        wMin:w0, wMax:w1, amplitude:amp}};
  }



  function principalConicAxes(A, B) {
    var areaVector = cross(A, B);
    var area = length(areaVector);
    var normal = area > EPS ? unitOrNull(areaVector) : null;
    if (!normal) return null;
    var u0 = unitOrNull(A);
    if (!u0) return null;
    var v0 = cross(normal, u0);
    var a1 = dot(A,u0), a2 = dot(A,v0), b1 = dot(B,u0), b2 = dot(B,v0);
    var m11 = a1*a1 + b1*b1, m12 = a1*a2 + b1*b2, m22 = a2*a2 + b2*b2;
    var scale = Math.max(Math.abs(m11), Math.abs(m12), Math.abs(m22));
    if (!(scale > 0)) return null;
    var s11 = m11/scale, s12 = m12/scale, s22 = m22/scale;
    var trace = s11 + s22;
    var determinant = area*area/(scale*scale);
    var discriminant = Math.sqrt(Math.max(0, trace*trace - 4*determinant));
    var l1 = (trace + discriminant)/2;
    if (!(l1 > 0)) return null;
    var l2 = determinant/l1;
    var theta = 0.5 * Math.atan2(2*s12, s11 - s22);
    var axis1 = unitOrNull(add(mul(u0,Math.cos(theta)), mul(v0,Math.sin(theta))));
    if (!axis1) return null;
    var axis2 = unitOrNull(cross(normal, axis1));
    if (!axis2) return null;
    return {u:axis1, v:axis2, radiusU:Math.sqrt(Math.max(0,l1*scale)),
      radiusV:Math.sqrt(Math.max(0,l2*scale))};
  }

  function section(surface, plane) {
    var spec = planeSpec(plane), q = spec && spec.origin, n = spec && spec.normal;
    if (!surface || !spec) return null;
    if (surface.kind === 'implicit' && surface.generator) {
      var generator = surface.generator;
      var generatorNormal = finite(generator.n) ? generator.n : cross(generator.A, generator.B);
      var generatorSpan = sub(generator.D, generator.C);
      var perpendicular = cross(generatorNormal, n);
      var denominator = dot(generatorNormal, generatorSpan);
      if (length(perpendicular) <= 1e-6 * Math.max(1, length(generatorNormal)) &&
          Math.abs(denominator) > EPS) {
        var station = -dot(generatorNormal, sub(generator.C, q)) / denominator;
        var localExtent = Math.max(1, length(generator.A), length(generator.B), length(generatorSpan));
        if (finite(generator.A2)) localExtent = Math.max(localExtent, length(generator.A2));
        if (finite(generator.B2)) localExtent = Math.max(localExtent, length(generator.B2));
        var worldTolerance = 1e-6 * localExtent;
        var parameterTolerance = worldTolerance / Math.max(EPS, Math.abs(denominator));
        if (station < -parameterTolerance || station > 1 + parameterTolerance) return null;
        var sectionCenter = add(generator.C, mul(generatorSpan, station));
        var sectionA, sectionB, scale = null;
        if (finite(generator.A2) && finite(generator.B2)) {
          sectionA = add(generator.A, mul(sub(generator.A2, generator.A), station));
          sectionB = add(generator.B, mul(sub(generator.B2, generator.B), station));
        } else {
          scale = 1 + station * (generator.k - 1);
          if (scale < -parameterTolerance) return null;
          if (Math.abs(scale) <= parameterTolerance)
            return {kind:'point', point:sectionCenter, center:sectionCenter,
              surfaceId:surface.id, sectionType:'apex', t:station, scale:scale,
              topologyCertified:true, domainStatus:'bounded'};
          sectionA = mul(generator.A, scale);
          sectionB = mul(generator.B, scale);
        }
        var principal = principalConicAxes(sectionA, sectionB);
        if (principal) {
          var circular = Math.abs(principal.radiusU - principal.radiusV) <=
            1e-6*Math.max(1, principal.radiusU);
          var result = {kind:circular ? 'circle' : 'ellipse', center:sectionCenter,
            u:principal.u, v:principal.v, radius:Math.min(principal.radiusU,principal.radiusV),
            radiusU:principal.radiusU, radiusV:principal.radiusV,
            startAngle:0, sweepAngle:TAU, closed:true, surfaceId:surface.id,
            t:station, domainStatus:'bounded'};
          if (scale === null) {
            var inverseU = 1 / (principal.radiusU * principal.radiusU);
            var inverseV = 1 / (principal.radiusV * principal.radiusV);
            result.sectionType = 'parallel-affine-conic';
            result.conicMatrix = {
              basis:{origin:sectionCenter, u:principal.u, v:principal.v},
              quadratic:[[inverseU, 0], [0, inverseV]],
              homogeneous:[[inverseU, 0, 0], [0, inverseV, 0], [0, 0, -1]],
              exact:true};
            result.parameterization = {a:sectionA, b:sectionB, exact:true};
          } else {
            result.sectionType = 'parallel-homothetic-conic';
            result.scale = scale;
          }
          return result;
        }
      }
    }
    if (surface.kind === 'implicit' || surface.kind === 'polynomial') {
      var implicitRecord = implicitEquationFor(surface);
      if (!implicitRecord || !Implicit) return null;
      var implicitSection = Implicit.planeSection(implicitRecord,
        {origin:q, normal:n, u:spec.u, v:spec.v});
      if (!implicitSection) return null;
      return {kind:'implicit-section', sectionType:'implicit-plane',
        algebraic:implicitSection.algebraic, display:implicitSection.display,
        surfaceId:surface.id, sourceIds:(surface.sourceIds || []).slice(),
        topologyCertified:false, guarantee:'numeric-display',
        contract:Implicit.INTERSECTION_CONTRACT};
    }
    if (surface.kind === 'plane') {
      var sn = unit(surface.normal), direction = cross(sn, n);
      var denominator = dot(direction, direction);
      if (denominator < EPS*EPS) {
        return Math.abs(dot(n, sub(surface.origin, q))) < EPS ?
          {kind:'plane-overlap', surfaceId:surface.id} : null;
      }

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
      var apex = finite(surface.apex) ? surface.apex : surface.origin;
      var coneAxis = unit(surface.axis);
      if (!finite(apex) || !Number.isFinite(surface.halfAngle))
        return {kind:'unsupported', reason:'cone-section-parameters-unavailable',
          surfaceId:surface.id, guarantee:'numeric'};
      var ca = dot(n, coneAxis);
      if (Math.abs(Math.abs(ca) - 1) <= 1e-7) {
        var station = dot(n, sub(q, apex)) / ca;
        var radius = Math.abs(station) * Math.tan(surface.halfAngle);
        var center = add(apex, mul(coneAxis, station));
        if (radius <= EPS)
          return {kind:'point', point:center, surfaceId:surface.id,
            sectionType:'plane-cone-apex'};
        var coneBasis = basis(coneAxis);
        return {kind:'circle', center:center, u:coneBasis.u, v:coneBasis.v,
          radius:radius, sourceIds:(surface.sourceIds || []).slice(),
          surfaceId:surface.id, sectionType:'plane-cone-circle'};
      }
      return {kind:'unsupported', relation:'oblique',
        reason:'cone-oblique-section-unsupported', surfaceId:surface.id,
        guarantee:'numeric'};
    }
    if (surface.kind === 'torus') {
      var ta = unit(surface.axis), tc = surface.center;
      var R = surface.majorRadius, r = surface.minorRadius;
      var tn = dot(n, ta), td = dot(n, sub(tc, q));
      if (Math.abs(Math.abs(tn) - 1) <= 1e-7) {
        if (Math.abs(td) > r + EPS) return null;
        var tube = Math.sqrt(Math.max(0, r*r - td*td));
        var centerOnPlane = sub(tc, mul(n, td));
        var tb = basis(n);
        var radiiList = tube <= EPS ? [R] : [R - tube, R + tube];
        var torusCircles = radiiList.filter(function (radius) { return radius > EPS; })
          .map(function (radius) {
            return {kind:'circle', center:centerOnPlane, u:tb.u, v:tb.v, radius:radius,
              sourceIds:(surface.sourceIds || []).slice(), surfaceId:surface.id};
          });
        if (!torusCircles.length) return null;
        if (torusCircles.length === 1) {
          var single = torusCircles[0];
          single.sectionType = tube <= EPS ? 'plane-torus-tangent' : 'plane-torus-circle';
          return single;
        }
        return {kind:'circles', circles:torusCircles, surfaceId:surface.id,
          sectionType:'plane-torus-circles'};
      }
      if (Math.abs(tn) <= 1e-7 && Math.abs(td) <= EPS * Math.max(1, R, r)) {
        var radialDir = unit(cross(ta, n));
        if (!radialDir) return null;
        var circleBase = {kind:'circle', u:ta, v:radialDir, radius:r,
          sourceIds:(surface.sourceIds || []).slice(), surfaceId:surface.id};
        return {kind:'circles', circles:[
          Object.assign({}, circleBase, {center:add(tc, mul(radialDir, R))}),
          Object.assign({}, circleBase, {center:add(tc, mul(radialDir, -R))})
        ], surfaceId:surface.id, sectionType:'plane-torus-axis'};
      }
      return torusObliqueSection(surface, {origin:q, normal:n});
    }
    if (surface.kind === 'cone') {
      var apex = surface.apex || surface.origin;
      var axis = unit(surface.axis), halfAngle = surface.halfAngle;
      if (!Number.isFinite(halfAngle)) return null;
      var ac = dot(n, axis), Dc = dot(n, sub(q, apex));
      if (Math.abs(Math.abs(ac) - 1) < EPS) {
        var t0 = Dc / ac;


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







  function tolerance(values) {
    return tolerancePolicy(values).length;
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
    var policy = tolerancePolicy([length(pa.origin), length(pb.origin)]);
    var sinAngle = length(direction);
    if (sinAngle <= policy.angle) {
      var distance = Math.abs(dot(pa.normal, sub(pb.origin, pa.origin)));
      var cls = gapClass(distance, policy);
      if (cls.status === 'exact')
        return {kind:'plane-overlap', relation:'coincident',
          plane:{origin:pa.origin, normal:pa.normal}, tolerance:policy.length};
      if (cls.status === 'near')
        return nearResult({kind:'plane-overlap'}, cls, policy, 'near-coincident');
      return none('parallel', {distance:distance, tolerance:policy.length});
    }
    if (sinAngle <= policy.nearParallel) {
      return {kind:'unsupported', relation:'near-parallel', reason:'near-parallel',
        angle:Math.asin(Math.min(1, sinAngle)), tolerance:policy.nearParallel,
        guarantee:'numeric'};
    }
    var cut = section(a, b);
    return {kind:'line', relation:'transverse', origin:cut.origin, direction:cut.direction};
  }



  function planeQuadric(plane, surface) {
    var spec = planeSpec(plane);
    var policy = tolerancePolicy([surface.radius, surface.origin && length(surface.origin),
      surface.center && length(surface.center), length(spec && spec.origin)]);
    if (spec && surface.kind === 'sphere') {
      var d = dot(sub(surface.center, spec.origin), spec.normal);
      var sphereGap = Math.abs(d) - surface.radius;
      var sphereClass = gapClass(sphereGap, policy);
      if (sphereGap > 0 && sphereClass.status === 'near')
        return nearResult({kind:'none', reason:'near-tangent'}, sphereClass, policy, 'near-tangent');
      if (sphereGap > 0 && sphereClass.status === 'separate')
        return none('separate', {gap:sphereGap, tolerance:policy.length});
    }
    if (spec && surface.kind === 'cylinder') {
      var axis = unit(surface.axis), ca = dot(spec.normal, axis);
      if (Math.abs(ca) <= policy.angle) {
        var radial = unit(sub(spec.normal, mul(axis, ca)));
        var offset = Math.abs(dot(sub(spec.origin, surface.origin), radial));
        var cylinderGap = offset - surface.radius;
        var cylinderClass = gapClass(cylinderGap, policy);
        if (cylinderGap > 0 && cylinderClass.status === 'near')
          return nearResult({kind:'none', reason:'near-tangent'}, cylinderClass, policy, 'near-tangent');
        if (cylinderGap > 0 && cylinderClass.status === 'separate')
          return none('separate', {gap:cylinderGap, tolerance:policy.length});
      }
    }
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
    var policy = tolerancePolicy([r1, r2, d]);
    if (d <= policy.length) {
      var drift = Math.abs(r1 - r2);
      var concurrent = gapClass(Math.max(d, drift), policy);
      if (drift <= policy.length && concurrent.status !== 'separate') {
        if (concurrent.status === 'exact')
          return {kind:'coincident', relation:'coincident', center:a.center, radius:r1,
            tolerance:policy.length};
        return nearResult({kind:'coincident', center:a.center, radius:r1},
          concurrent, policy, 'near-coincident');
      }
      return none('concentric', {distance:d, tolerance:policy.length});
    }
    var e = mul(delta, 1/d);
    var external = d - r1 - r2;
    var internal = d - Math.abs(r1 - r2);
    if (Math.abs(external) <= policy.exactLength)
      return {kind:'point', relation:'tangent', tangent:'external',
        point:add(a.center, mul(e, r1)), tolerance:policy.length};
    if (Math.abs(internal) <= policy.exactLength) {
      var exactPoint = add(a.center, mul(e, r1 >= r2 ? r1 : -r1));
      return {kind:'point', relation:'tangent', tangent:'internal', point:exactPoint,
        tolerance:policy.length};
    }
    if (external > 0) {
      var externalClass = gapClass(external, policy);
      if (externalClass.status === 'near')
        return nearResult({kind:'point', tangent:'external',
          point:add(a.center, mul(e, r1))}, externalClass, policy, 'near-tangent');
      return none('separate', {distance:d, gap:external, tolerance:policy.length});
    }
    if (internal < 0) {
      var internalClass = gapClass(-internal, policy);
      if (internalClass.status === 'near')
        return nearResult({kind:'point', tangent:'internal',
          point:add(a.center, mul(e, r1 >= r2 ? r1 : -r1))},
          internalClass, policy, 'near-tangent');
      return none('contained', {distance:d, tolerance:policy.length});
    }
    var h = (d*d + r1*r1 - r2*r2) / (2*d);
    var rho2 = r1*r1 - h*h;
    var b2 = basis(e);
    return {kind:'circle', relation:'transverse', center:add(a.center, mul(e, h)),
      u:b2.u, v:b2.v, radius:Math.sqrt(Math.max(0, rho2))};
  }



  function cylinderCylinder(a, b) {
    var axis = unit(a.axis), otherAxis = unit(b.axis);
    var policy = tolerancePolicy([a.radius, b.radius]);
    var sinAngle = length(cross(axis, otherAxis));
    if (sinAngle > policy.angle) {
      if (sinAngle <= policy.nearParallel)
        return {kind:'unsupported', relation:'near-parallel', reason:'near-parallel',
          angle:Math.asin(Math.min(1, sinAngle)), tolerance:policy.nearParallel,
          guarantee:'numeric'};
      return null;
    }
    var delta = sub(b.origin, a.origin);
    var perp = sub(delta, mul(axis, dot(delta, axis)));
    var p = length(perp);
    var r1 = a.radius, r2 = b.radius;
    policy = tolerancePolicy([r1, r2, p]);
    if (p <= policy.length) {
      var drift = Math.abs(r1 - r2);
      var coaxial = gapClass(Math.max(p, drift), policy);
      if (drift <= policy.length && coaxial.status !== 'separate') {
        if (coaxial.status === 'exact')
          return {kind:'coincident', relation:'coincident', origin:a.origin, axis:axis,
            radius:r1, tolerance:policy.length};
        return nearResult({kind:'coincident', origin:a.origin, axis:axis, radius:r1},
          coaxial, policy, 'near-coincident');
      }
      return none('coaxial', {distance:p, tolerance:policy.length});
    }
    var e = mul(perp, 1/p);
    var external = p - r1 - r2;
    var internal = p - Math.abs(r1 - r2);
    if (Math.abs(external) <= policy.exactLength) {
      var externalOrigin = add(a.origin, mul(e, r1));
      return {kind:'line', relation:'tangent', tangent:'external',
        origin:externalOrigin, direction:axis, tolerance:policy.length};
    }
    if (Math.abs(internal) <= policy.exactLength) {
      var internalOrigin = add(a.origin, mul(e, (p*p + r1*r1 - r2*r2)/(2*p)));
      return {kind:'line', relation:'tangent', tangent:'internal',
        origin:internalOrigin, direction:axis, tolerance:policy.length};
    }
    if (external > 0) {
      var externalClass = gapClass(external, policy);
      if (externalClass.status === 'near')
        return nearResult({kind:'line', tangent:'external',
          origin:add(a.origin, mul(e, r1)), direction:axis},
          externalClass, policy, 'near-tangent');
      return none('separate', {distance:p, gap:external, tolerance:policy.length});
    }
    if (internal < 0) {
      var internalClass = gapClass(-internal, policy);
      if (internalClass.status === 'near')
        return nearResult({kind:'line', tangent:'internal',
          origin:add(a.origin, mul(e, (p*p + r1*r1 - r2*r2)/(2*p))), direction:axis},
          internalClass, policy, 'near-tangent');
      return none('contained', {distance:p, tolerance:policy.length});
    }
    var h = (p*p + r1*r1 - r2*r2) / (2*p);
    var s2 = r1*r1 - h*h;
    var origin = add(a.origin, mul(e, h));
    var s = Math.sqrt(Math.max(0, s2)), w = unit(cross(axis, e));
    return {kind:'lines', relation:'transverse', lines:[
      {origin:add(origin, mul(w, s)), direction:axis},
      {origin:add(origin, mul(w, -s)), direction:axis}
    ]};
  }




  function sphereCylinder(sphere, cylinder) {
    var axis = unit(cylinder.axis);
    var delta = sub(sphere.center, cylinder.origin);
    var axial = dot(delta, axis);
    var offset = length(sub(delta, mul(axis, axial)));
    var policy = tolerancePolicy([sphere.radius, cylinder.radius, offset]);
    if (offset > policy.length) {


      var gap = offset - cylinder.radius - sphere.radius;
      if (gap > 0) {
        var gapInfo = gapClass(gap, policy);
        if (gapInfo.status === 'near')
          return nearResult({kind:'unsupported', reason:'near-tangent'},
            gapInfo, policy, 'near-tangent');
        return none('separate', {distance:offset, gap:gap, tolerance:policy.length});
      }
      if (offset + sphere.radius < cylinder.radius - policy.length)
        return none('contained', {distance:offset, tolerance:policy.length});
      return null;
    }
    var center = add(cylinder.origin, mul(axis, axial));
    var radiusGap = Math.abs(sphere.radius - cylinder.radius);
    var radiusClass = gapClass(radiusGap, policy);
    var b = basis(axis);
    if (radiusClass.status === 'exact')
      return {kind:'circle', relation:'tangent', center:center,
        u:b.u, v:b.v, radius:cylinder.radius, tolerance:policy.length};
    if (radiusClass.status === 'near')
      return nearResult({kind:'circle', center:center, u:b.u, v:b.v,
        radius:cylinder.radius}, radiusClass, policy, 'near-tangent');
    if (sphere.radius < cylinder.radius)
      return none('contained', {distance:offset, tolerance:policy.length});
    var h = Math.sqrt(sphere.radius*sphere.radius - cylinder.radius*cylinder.radius);
    return {kind:'circles', relation:'transverse', circles:[
      {center:add(center, mul(axis, h)), u:b.u, v:b.v, radius:cylinder.radius},
      {center:add(center, mul(axis, -h)), u:b.u, v:b.v, radius:cylinder.radius}
    ]};
  }





  function torusSphere(torus, sphere) {
    if (!finite(torus.center) || !finite(torus.axis) || !finite(sphere.center) ||
        !(sphere.radius > 0)) return null;
    var axis = unit(torus.axis), frame = basis(axis);
    var d = sub(torus.center, sphere.center);
    var dA = dot(d, axis), dPerp = sub(d, mul(axis, dA));
    var Dperp = length(dPerp);
    var R = torus.majorRadius, r = torus.minorRadius, sr = sphere.radius;
    var Q = R*R - r*r;
    if (!(Q > EPS)) return null;
    var N0 = sr*sr - dot(d, d) - R*R - r*r;
    var a2 = 4*Q, a1 = -4*R*(N0 + 2*r*r), a0 = N0*N0 - 4*r*r*(R*R + dA*dA);
    var disc = a1*a1 - 4*a2*a0;
    if (disc < -EPS) return none('separate');
    var root = Math.sqrt(Math.max(0, disc));
    var w0 = (-a1 - root) / (2*a2), w1 = (-a1 + root) / (2*a2);
    if (w0 > w1) { var swap = w0; w0 = w1; w1 = swap; }
    var Acomp = dot(dPerp, frame.u), Bcomp = dot(dPerp, frame.v);
    function makeBranch(branch, start, end, closed) {
      return {kind:'torusSphereBranch', branch:branch, center:torus.center,
        axis:axis, frameU:frame.u, frameV:frame.v, majorRadius:R, minorRadius:r,
        dA:dA, N0:N0, A:Acomp, B:Bcomp, uStart:start, uEnd:end,
        startAngle:start, sweepAngle:end - start, closed:closed,
        surfaceId:torus.id, sectionType:'torus-sphere',
        confidence:'analytic-parameterization'};
    }
    function tangentResult(points) {
      if (!points.length) return null;
      return {contract:'torus-quadric-v1', kind:'points', points:points,
        surfaceId:torus.id, relation:'tangent', sectionType:'torus-sphere-tangent'};
    }
    var branches = [], loops = [], intervals = [];
    if (Dperp <= EPS) {
      if (w0 > EPS || w1 < -EPS) return none('separate');
      var coaxial = sr*sr - dot(d, d) - R*R - r*r;
      var ratio = coaxial / (2*r*R);
      if (Math.abs(ratio) > 1 + 1e-9) return none('separate');
      var tangent = Math.abs(1 - Math.abs(ratio)) <= 1e-9;
      if (tangent) {
        branches.push(makeBranch(1, 0, TAU, true));
        loops.push({closed:true, full:true, branches:[0]});
      } else {
        [1, -1].forEach(function (branch) {
          var index = branches.length;
          branches.push(makeBranch(branch, 0, TAU, true));
          loops.push({closed:true, full:true, branches:[index]});
        });
      }
      return {contract:'torus-quadric-v1', kind:'torusSphere', relation:'transverse',
        sectionType:'torus-sphere', branches:branches, loops:loops,
        parameters:{N0:N0, dA:dA, majorRadius:R, minorRadius:r}};
    }
    var amp = Dperp;
    if (w0 > amp + 1e-9 || w1 < -amp - 1e-9) return none('separate');
    var c = Math.max(-1, Math.min(1, w0/amp));
    var dRatio = Math.max(-1, Math.min(1, w1/amp));
    var phiW = Math.atan2(Bcomp, Acomp);
    function normAngle(value) { return ((value % TAU) + TAU) % TAU; }
    if (dRatio - c <= 1e-9) {
      var base = Math.acos(c);
      var points = [];
      var tubeCircle = null;
      [phiW + base, phiW - base].forEach(function (u) {
        var W = Acomp*Math.cos(u) + Bcomp*Math.sin(u);
        var coeffA = 2*r*(R + W), coeffB = 2*r*dA;
        var N = N0 - 2*R*W;
        if (Math.abs(coeffA) <= EPS && Math.abs(coeffB) <= EPS && Math.abs(N) <= EPS) {
          if (!tubeCircle) {
            var radial = add(mul(frame.u, Math.cos(u)), mul(frame.v, Math.sin(u)));
            tubeCircle = {contract:'torus-quadric-v1', kind:'circle',
              center:add(torus.center, mul(radial, R)), u:radial, v:axis,
              radius:r, surfaceId:torus.id, relation:'tangent',
              sectionType:'torus-sphere-tube-circle'};
          }
          return;
        }
        var p = torusSpherePoint(makeBranch(1, u, u, false), u);
        if (!p) return;
        if (!points.some(function (q) { return pointDistance(p, q) <= surfaceTolerance(torus); }))
          points.push(p);
      });
      return tubeCircle || tangentResult(points);
    }
    if (c <= -1 + 1e-12 && dRatio >= 1 - 1e-12) {
      intervals.push({start:0, end:TAU, full:true});
    } else if (c <= -1 + 1e-12) {
      var hiOnly = Math.acos(dRatio);
      intervals.push({start:phiW + hiOnly, end:phiW + TAU - hiOnly, full:false});
    } else if (dRatio >= 1 - 1e-12) {
      var loOnly = Math.acos(c);
      intervals.push({start:phiW - loOnly, end:phiW + loOnly, full:false});
    } else {
      var hi = Math.acos(c), lo = Math.acos(dRatio);
      intervals.push({start:phiW - hi, end:phiW - lo, full:false});
      intervals.push({start:phiW + lo, end:phiW + hi, full:false});
    }
    intervals.forEach(function (interval) {
      var start = interval.full ? 0 : normAngle(interval.start);
      var end = interval.full ? TAU : normAngle(interval.end);
      if (!interval.full && end <= start + 1e-12) end += TAU;
      if (interval.full) {
        [1, -1].forEach(function (branch) {
          var index = branches.length;
          branches.push(makeBranch(branch, 0, TAU, true));
          loops.push({closed:true, full:true, branches:[index]});
        });
      } else {
        var plus = branches.length;
        branches.push(makeBranch(1, start, end, false));
        var minus = branches.length;
        branches.push(makeBranch(-1, end, start, false));
        loops.push({closed:true, full:false, branches:[plus, minus]});
      }
    });
    return {contract:'torus-quadric-v1', kind:'torusSphere', relation:'transverse',
      sectionType:'torus-sphere', branches:branches, loops:loops,
      parameters:{N0:N0, dA:dA, wMin:w0, wMax:w1, amplitude:amp,
        majorRadius:R, minorRadius:r}};
  }




  function torusCylinder(torus, cylinder) {
    if (!finite(torus.center) || !finite(torus.axis) ||
        !finite(cylinder.origin) || !finite(cylinder.axis) ||
        !(cylinder.radius > 0)) return null;
    var axis = unit(torus.axis), cylinderAxis = unit(cylinder.axis);
    var policy = tolerancePolicy([torus.majorRadius, torus.minorRadius, cylinder.radius]);
    if (length(cross(axis, cylinderAxis)) > policy.angle)
      return {kind:'unsupported', relation:'skew', reason:'torus-cylinder-skew-unsupported',
        guarantee:'numeric'};
    var delta = sub(cylinder.origin, torus.center);
    var offset = sub(delta, mul(axis, dot(delta, axis)));
    if (length(offset) > policy.length)
      return {kind:'unsupported', relation:'offset', reason:'torus-cylinder-offset-unsupported',
        gap:length(offset), tolerance:policy.length, guarantee:'numeric'};
    var rho = cylinder.radius, R = torus.majorRadius, r = torus.minorRadius;
    var gap = r*r - (rho - R)*(rho - R);
    if (gap < -policy.length) return none('separate');
    var dz = Math.sqrt(Math.max(0, gap));
    var frame = basis(axis);
    function circleAt(height) {
      return {kind:'circle', center:add(torus.center, mul(axis, height)),
        u:frame.u, v:frame.v, radius:rho, surfaceId:torus.id,
        sourceIds:(torus.sourceIds || []).slice()};
    }
    if (dz <= policy.length) {
      var tangent = circleAt(0);
      tangent.sectionType = 'torus-cylinder-tangent';
      tangent.relation = 'tangent';
      return tangent;
    }
    return {kind:'circles', relation:'transverse', sectionType:'torus-cylinder-coaxial',
      circles:[circleAt(dz), circleAt(-dz)]};
  }




  function torusCone(torus, cone) {
    if (!finite(torus.center) || !finite(torus.axis) || !finite(cone.axis))
      return null;
    var apex = cone.apex || cone.origin;
    if (!finite(apex) || !Number.isFinite(cone.halfAngle) ||
        !(cone.halfAngle > 0) || !(cone.halfAngle < Math.PI/2)) return null;
    var axis = unit(torus.axis), coneAxis = unit(cone.axis);
    var policy = tolerancePolicy([torus.majorRadius, torus.minorRadius,
      length(sub(apex, torus.center))]);
    if (length(cross(axis, coneAxis)) > policy.angle)
      return {kind:'unsupported', relation:'skew', reason:'torus-cone-skew-unsupported',
        guarantee:'numeric'};
    var delta = sub(apex, torus.center);
    var offset = sub(delta, mul(axis, dot(delta, axis)));
    if (length(offset) > policy.length)
      return {kind:'unsupported', relation:'offset', reason:'torus-cone-offset-unsupported',
        gap:length(offset), tolerance:policy.length, guarantee:'numeric'};
    var sign = dot(coneAxis, axis) >= 0 ? 1 : -1;
    var a0 = dot(delta, axis), k = Math.tan(cone.halfAngle);
    var R = torus.majorRadius, r = torus.minorRadius;
    var A = k*k + 1, B = -2*k*R + 2*a0*sign, C = R*R + a0*a0 - r*r;
    var disc = B*B - 4*A*C;
    if (disc < -policy.length) return none('separate');
    var root = Math.sqrt(Math.max(0, disc));
    var stations = [(-B - root) / (2*A), (-B + root) / (2*A)].filter(function (s) {
      return s >= -policy.length;
    }).map(function (s) { return Math.max(0, s); });
    stations.sort(function (x, y) { return x - y; });
    var frame = basis(axis), circles = [];
    stations.forEach(function (s, index) {
      if (index > 0 && Math.abs(s - stations[index-1]) <= policy.length) return;
      var radial = k*s;
      if (radial <= policy.length) return;
      circles.push({kind:'circle', center:add(torus.center, mul(axis, a0 + sign*s)),
        u:frame.u, v:frame.v, radius:radial, surfaceId:torus.id,
        sourceIds:(torus.sourceIds || []).slice()});
    });
    if (!circles.length) return none('separate');
    if (circles.length === 1) {
      circles[0].sectionType = 'torus-cone-coaxial';
      circles[0].relation = 'tangent';
      return circles[0];
    }
    return {kind:'circles', relation:'transverse', sectionType:'torus-cone-coaxial',
      circles:circles};
  }

  var IMPLICIT_KINDS = {plane:1, sphere:1, cylinder:1, cone:1, torus:1, implicit:1, polynomial:1};
  function implicitEquationFor(surface, options) {
    if (!Implicit || !surface || typeof surface.kind !== 'string') return null;
    if (surface.kind === 'implicit' || surface.kind === 'polynomial')
      return Implicit.normalizeEquation(surface.implicit || surface);
    if (!IMPLICIT_KINDS[surface.kind]) return null;
    return Implicit.normalizeEquation(Implicit.equation(surface, options));
  }
  function implicitPair(a, b, options) {
    var ea = implicitEquationFor(a, options), eb = implicitEquationFor(b, options);
    if (!ea || !eb) return null;
    return Implicit.algebraicIntersection(ea, eb, options);
  }
  function intersect(a, b, options) {
    if (!a || !b || !a.kind || !b.kind) return null;
    if (!IMPLICIT_KINDS[a.kind] || !IMPLICIT_KINDS[b.kind]) return null;
    var result = null;
    if (a.kind === 'plane' && b.kind === 'plane') result = planePlane(a, b);
    else if (a.kind === 'plane') result = planeQuadric(a, b);
    else if (b.kind === 'plane') result = planeQuadric(b, a);
    else if (a.kind === 'sphere' && b.kind === 'sphere') result = sphereSphere(a, b);
    else if (a.kind === 'cylinder' && b.kind === 'cylinder') result = cylinderCylinder(a, b);
    else if (a.kind === 'sphere' && b.kind === 'cylinder') result = sphereCylinder(a, b);
    else if (a.kind === 'cylinder' && b.kind === 'sphere') result = sphereCylinder(b, a);
    else if (a.kind === 'torus' && b.kind === 'sphere') result = torusSphere(a, b);
    else if (a.kind === 'sphere' && b.kind === 'torus') result = torusSphere(b, a);
    else if (a.kind === 'torus' && b.kind === 'cylinder') result = torusCylinder(a, b);
    else if (a.kind === 'cylinder' && b.kind === 'torus') result = torusCylinder(b, a);
    else if (a.kind === 'torus' && b.kind === 'cone') result = torusCone(a, b);
    else if (a.kind === 'cone' && b.kind === 'torus') result = torusCone(b, a);
    if (result && result.kind !== 'unsupported') return tagged(result, a, b);
    var fallback = implicitPair(a, b, options);
    if (!fallback) return result && tagged(result, a, b);
    if (result) fallback.legacy = {kind:result.kind, relation:result.relation || null,
      reason:result.reason || null, guarantee:result.guarantee || null};
    return tagged(fallback, a, b);
  }

  function loopSide(loop, spec, curves, vertices) {
    var distances = [], invalid = false;
    function distance(p) { return dot(spec.normal, sub(p, spec.origin)); }
    (loop.vertices || []).forEach(function(i) {
      if (!vertices || !finite(vertices[i])) invalid = true;
      else distances.push(distance(vertices[i]));
    });
    loopInlinePoints(loop).forEach(function (p) {
      if (!finite(p)) invalid = true;
      else distances.push(distance(p));
    });
    loopCurves(loop, curves).forEach(function(c) {
      if (!validCurve(c)) { invalid = true; return; }


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
    (loop.lines || []).forEach(function(l) {
      if (!validLine(l)) { invalid = true; return; }


      distances.push(distance(l.start), distance(l.end));
    });
    if (invalid || !distances.length) return 2;
    var pos = distances.some(function(d) { return d > EPS; });
    var neg = distances.some(function(d) { return d < -EPS; });
    return pos && neg ? 2 : pos ? 1 : neg ? -1 : 0;
  }



  function trim(surface, plane, keepPositive, geometry) {
    if (!surface || surface.kind === 'plane') return null;
    if (surface.kind === 'torus') {
      var torusPlan = torusSplitPlan(surface, plane, geometry);
      if (!torusPlan.ok) return null;
      var keptPiece = keepPositive === false ? torusPlan.result.negative : torusPlan.result.positive;
      var trimmed = {};
      Object.keys(keptPiece).forEach(function (k) { trimmed[k] = keptPiece[k]; });
      trimmed.id = (surface.id || 'surface') + '/trim';
      trimmed.cut = torusPlan.result.section;
      trimmed.trimmedBy = {plane:{origin:copyPoint(torusPlan.result.plane.origin),
        normal:copyPoint(torusPlan.result.plane.normal)}, keepPositive:keepPositive !== false};
      return trimmed;
    }
    var spec = planeSpec(plane);
    if (!spec) return null;
    var cut = section(surface, spec);
    if (!cut || (cut.kind !== 'circle' && cut.kind !== 'ellipse')) return null;
    boundaryElementId(cut, 'section');
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
    stampModelIdentity({surfaces:[out]});
    return out;
  }




  function loopValid(loop, curves, vertices) {
    var ok = true;
    (loop.curves || []).forEach(function (i) {
      var c = typeof i === 'object' && i ? i : curves[i];
      if (!validCurve(c)) ok = false;
    });
    (loop.elements || []).forEach(function (el) {
      if (!el) { ok = false; return; }
      if (el.kind === 'curve') { if (!validCurve(el.curve)) ok = false; }
      else if (el.kind === 'polyline') {
        if (!el.points || el.points.length < 2) ok = false;
        (el.points || []).forEach(function (p) { if (!finite(p)) ok = false; });
      } else ok = false;
    });
    (loop.points || []).forEach(function (p) { if (!finite(p)) ok = false; });
    (loop.lines || []).forEach(function (l) { if (!validLine(l)) ok = false; });
    if (loop.section && !validCurve(loop.section)) ok = false;
    if (loop.vertices && loop.vertices.length < 2) ok = false;
    (loop.vertices || []).forEach(function (i) {
      if (!vertices || !finite(vertices[i])) ok = false;
    });
    return ok;
  }











  function curveStart(c) { return Number.isFinite(c.startAngle) ? c.startAngle : 0; }
  function curveSweep(c) { return Number.isFinite(c.sweepAngle) ? c.sweepAngle : TAU; }
  function pointDistance(a, b) {
    var dx=a.x-b.x, dy=a.y-b.y, dz=a.z-b.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
  }
  function pointsClose(a, b, tol) { return finite(a) && finite(b) && pointDistance(a,b) <= tol; }

  function curveAcceptsParameter(c, t, tol) {
    var start = curveStart(c), sweep = curveSweep(c);
    if (sweep >= TAU - 1e-9) return true;
    for (var k=-2;k<=2;k++) {
      var u = t + k*TAU;
      if (u >= start - tol && u <= start + sweep + tol) return true;
    }
    return false;
  }
  function curveAcceptsPoint(c, p, tol) {
    if (!finite(p)) return false;
    var r = radii(c), q = sub(p, c.center);
    var a = dot(q, c.u)/r.u, b = dot(q, c.v)/r.v;
    if (Math.abs(a*a + b*b - 1) > 1e-5) return false;
    return curveAcceptsParameter(c, Math.atan2(b, a), 1e-6);
  }

  function subArc(c, t0, t1) {
    boundaryElementId(c, c.kind === 'line' ? 'line' : 'curve');
    var out = copyFields(c);
    out.kind = (c.kind === 'torusContour' || c.kind === 'torusSectionBranch' ||
      c.kind === 'torusSphereBranch') ? c.kind : 'arc';


    out.id = c.id + '/arc:' + Number(t0).toFixed(9) + ':' + Number(t1).toFixed(9);
    out.parentKind = c.kind;
    out.startAngle = t0;
    out.sweepAngle = t1 - t0;
    if (out.kind === 'torusSectionBranch' || out.kind === 'torusSphereBranch') {
      out.uStart = t0;
      out.uEnd = t1;
    }
    out.closed = false;
    out.splitFrom = {kind:c.kind, startAngle:curveStart(c), sweepAngle:curveSweep(c)};
    return out;
  }

  function planeCurveData(c, spec) {
    var r = radii(c), n = spec.normal;
    return {A:dot(n, c.u)*r.u, B:dot(n, c.v)*r.v,
      C:dot(n, sub(c.center, spec.origin))};
  }
  function curveSignedDistance(c, t, spec) {
    return dot(spec.normal, sub(curvePoint(c, t), spec.origin));
  }



  function curveRoots(c, spec) {
    var data = planeCurveData(c, spec), amplitude = Math.hypot(data.A, data.B);
    var start = curveStart(c), sweep = curveSweep(c), roots = [];
    if (amplitude <= EPS) {
      return {onPlane:Math.abs(data.C) <= EPS,
        roots:roots, data:data, amplitude:amplitude};
    }
    var ratio = -data.C/amplitude;
    if (ratio < -1-1e-9 || ratio > 1+1e-9)
      return {onPlane:false, roots:roots, data:data, amplitude:amplitude};
    ratio = Math.max(-1, Math.min(1, ratio));
    var base = Math.atan2(data.B, data.A), delta = Math.acos(ratio);
    var critical = delta <= 1e-12 || Math.PI - delta <= 1e-12 ? [base] : [base+delta, base-delta];
    critical.forEach(function (a) {
      for (var k=-2;k<=2;k++) {
        var t = a + k*TAU;
        if (t > start + 1e-9 && t < start + sweep - 1e-9 &&
            !roots.some(function (u) { return Math.abs(u-t) <= 1e-9; })) roots.push(t);
      }
    });
    roots.sort(function (a,b) { return a-b; });
    return {onPlane:false, roots:roots, data:data, amplitude:amplitude};
  }
  function splitCurveElement(c, spec) {
    var info = curveRoots(c, spec), start = curveStart(c), sweep = curveSweep(c);
    if (info.onPlane) return {ok:false, code:'split-loop-on-plane'};
    var startPoint = curvePoint(c, start), endPoint = curvePoint(c, start + sweep);
    var cuts = [start].concat(info.roots).concat([start + sweep]);
    var scale = Math.max(1, length(sub(c.center, spec.origin)));
    var segments = [];
    for (var i=0;i<cuts.length-1;i++) {
      var t0 = cuts[i], t1 = cuts[i+1];
      if (t1 - t0 <= 1e-10) continue;
      var d = curveSignedDistance(c, 0.5*(t0+t1), spec);



      if (Math.abs(d) <= 1e-12*scale) return {ok:false, code:'split-loop-on-plane'};
      segments.push({sign:d > 0 ? 1 : -1, curve:subArc(c, t0, t1),
        start:curvePoint(c, t0), end:curvePoint(c, t1), t0:t0, t1:t1});
    }
    if (!segments.length) return {ok:false, code:'split-loop-invalid'};
    if (segments.every(function (s) { return s.sign === segments[0].sign; })) {
      return {ok:true, segments:[{sign:segments[0].sign, curve:c,
        start:startPoint, end:endPoint}]};
    }



    if (sweep >= TAU - 1e-9 && segments.length > 2 &&
        segments[0].sign === segments[segments.length-1].sign) {
      var firstSeg = segments.shift(), lastSeg = segments.pop();
      var merged = subArc(c, lastSeg.t0, firstSeg.t1 + TAU);
      segments.unshift({sign:firstSeg.sign, curve:merged, start:lastSeg.start,
        end:firstSeg.end, t0:lastSeg.t0, t1:firstSeg.t1 + TAU});
    }
    return {ok:true, segments:segments};
  }

  function splitPolylineElement(points, spec, surface, loopIndex) {
    if (!points || points.length < 2) return {ok:false, code:'split-boundary-invalid', loopIndex:loopIndex};
    var scale = 1;
    points.forEach(function (p) {
      if (!finite(p)) return;
      scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
    });
    var planeTol = 1e-7*scale, surfaceTol = surfaceTolerance(surface);
    var segments = [];
    for (var i=0;i<points.length;i++) {
      var a = points[i], b = points[(i+1)%points.length];
      if (!finite(a) || !finite(b)) return {ok:false, code:'split-boundary-invalid', loopIndex:loopIndex};
      var da = dot(spec.normal, sub(a, spec.origin));
      var db = dot(spec.normal, sub(b, spec.origin));
      if (Math.abs(da) <= planeTol && surfaceResidual(surface, a) > Math.max(surfaceTol*4, planeTol*4))
        return {ok:false, code:'split-loop-crossing-off-surface', loopIndex:loopIndex,
          point:copyPoint(a)};
      if (Math.abs(db) <= planeTol && surfaceResidual(surface, b) > Math.max(surfaceTol*4, planeTol*4))
        return {ok:false, code:'split-loop-crossing-off-surface', loopIndex:loopIndex,
          point:copyPoint(b)};
      if (Math.abs(da) <= planeTol && Math.abs(db) <= planeTol)
        return {ok:false, code:'split-loop-on-plane', loopIndex:loopIndex};
      if (da*db < -planeTol*planeTol) {
        var alpha = da/(da-db);
        var p = add(a, mul(sub(b, a), alpha));
        if (surfaceResidual(surface, p) > Math.max(surfaceTol*4, planeTol*4))
          return {ok:false, code:'split-loop-crossing-off-surface', loopIndex:loopIndex,
            point:copyPoint(p)};
        segments.push({sign:da > 0 ? 1 : -1, points:[a, p], start:a, end:p});
        segments.push({sign:db > 0 ? 1 : -1, points:[p, b], start:p, end:b});
      } else {
        var sign = Math.abs(da) > planeTol ? (da > 0 ? 1 : -1) :
          Math.abs(db) > planeTol ? (db > 0 ? 1 : -1) : 0;
        if (!sign) return {ok:false, code:'split-loop-on-plane', loopIndex:loopIndex};
        segments.push({sign:sign, points:[a, b], start:a, end:b});
      }
    }
    return {ok:true, segments:segments};
  }

  function loopOrderedElements(loop, curves, vertices) {
    if (loop.elements) {
      var mapped = loop.elements.map(function (el) {
        if (el && el.kind === 'curve') return {type:'curve', curve:el.curve};
        if (el && el.kind === 'polyline') return {type:'points', points:el.points || []};
        return {type:'unknown'};
      });
      if (mapped.some(function (el) { return el.type === 'unknown'; }))
        return {ok:false, code:'split-loop-unsupported-element'};
      return {ok:true, elements:mapped};
    }
    var out = [], groups = 0;
    if (loop.curves && loop.curves.length) {
      groups++;
      loop.curves.forEach(function (i) {
        out.push({type:'curve', curve:typeof i === 'object' && i ? i : curves[i]});
      });
    }
    if (loop.section) { groups++; out.push({type:'curve', curve:loop.section}); }
    if (loop.vertices && loop.vertices.length) {
      groups++;
      out.push({type:'points', points:loop.vertices.map(function (i) { return vertices && vertices[i]; })});
    }
    if (loop.points && loop.points.length) {
      groups++;
      out.push({type:'points', points:loop.points.slice()});
    }
    if (groups > 1) return {ok:false, code:'split-loop-mixed-elements'};
    return {ok:true, elements:out};
  }

  function appendLoopSegment(chain, segment, matchTol) {
    if (segment.curve) {
      chain.elements.push({kind:'curve', curve:segment.curve});
    } else {
      var last = chain.elements[chain.elements.length-1];
      if (last && last.kind === 'polyline' &&
          pointsClose(last.points[last.points.length-1], segment.points[0], matchTol))
        last.points.push(segment.points[1]);
      else chain.elements.push({kind:'polyline', points:[segment.points[0], segment.points[1]]});
    }
    chain.end = segment.end;
  }




  function splitLoopForCrossing(loop, surface, spec, curves, vertices, loopIndex) {
    var ordered = loopOrderedElements(loop, curves, vertices);
    if (!ordered.ok) return {ok:false, code:ordered.code, loopIndex:loopIndex};
    var matchTol = 1e-7*Math.max(1, surface.radius || 1);
    var segments = [];
    for (var e=0;e<ordered.elements.length;e++) {
      var el = ordered.elements[e], part;
      if (el.type === 'curve') {
        if (!validCurve(el.curve)) return {ok:false, code:'split-boundary-invalid', loopIndex:loopIndex};
        part = splitCurveElement(el.curve, spec);
      } else {
        part = splitPolylineElement(el.points, spec, surface, loopIndex);
      }
      if (!part.ok) return {ok:false, code:part.code, loopIndex:loopIndex, detail:part};
      if (segments.length && part.segments.length &&
          !pointsClose(segments[segments.length-1].end, part.segments[0].start, matchTol))
        return {ok:false, code:'split-loop-disconnected', loopIndex:loopIndex};
      segments = segments.concat(part.segments);
    }
    if (!segments.length) return {ok:false, code:'split-loop-invalid', loopIndex:loopIndex};
    if (!pointsClose(segments[segments.length-1].end, segments[0].start, matchTol))
      return {ok:false, code:'split-loop-disconnected', loopIndex:loopIndex};
    if (segments.some(function (s) { return s.sign === 0; }))
      return {ok:false, code:'split-loop-on-plane', loopIndex:loopIndex};

    var groups = [], current = null;
    segments.forEach(function (segment) {
      if (!current || current.sign !== segment.sign) {
        current = {sign:segment.sign, elements:[], start:segment.start, end:segment.end};
        groups.push(current);
      }
      appendLoopSegment(current, segment, matchTol);
    });
    if (groups.length > 1 && groups[0].sign === groups[groups.length-1].sign) {
      var last = groups.pop(), first = groups.shift();
      groups.unshift({sign:first.sign, elements:last.elements.concat(first.elements),
        start:last.start, end:first.end});
    }
    if (groups.length < 2) return {ok:false, code:'split-loop-crossing-missing', loopIndex:loopIndex};

    var crossingPoints = [];
    for (var i=0;i<segments.length;i++) {
      var next = segments[(i+1)%segments.length];
      if (segments[i].sign !== next.sign) crossingPoints.push(segments[i].end);
    }
    return {ok:true, chains:groups, crossingPoints:crossingPoints};
  }

  function loopIsClosed(loop, curves, vertices, tol) {
    var ordered = loopOrderedElements(loop, curves, vertices);
    if (!ordered.ok || !ordered.elements.length) return false;
    function ends(el) {
      if (el.type === 'curve') {
        return {start:curvePoint(el.curve, curveStart(el.curve)),
          end:curvePoint(el.curve, curveStart(el.curve) + curveSweep(el.curve)),
          closed:curveSweep(el.curve) >= TAU - 1e-9};
      }
      return {start:el.points[0], end:el.points[el.points.length-1],
        closed:el.points.length >= 3};
    }
    tol = tol || 1e-6;
    if (ordered.elements.length === 1) return ends(ordered.elements[0]).closed ||
      pointsClose(ends(ordered.elements[0]).start, ends(ordered.elements[0]).end, tol);
    for (var i=0;i<ordered.elements.length;i++) {
      var a = ends(ordered.elements[i]);
      var b = ends(ordered.elements[(i+1)%ordered.elements.length]);
      if (!pointsClose(a.end, b.start, tol)) return false;
    }
    return true;
  }

  function sectionParameterOf(cut, p) {
    var r = radii(cut), q = sub(p, cut.center);
    var a = dot(q, cut.u)/r.u, b = dot(q, cut.v)/r.v;
    if (Math.abs(a*a + b*b - 1) > 1e-5) return null;
    var t = Math.atan2(b, a);
    if (!curveAcceptsPoint(cut, p, 1e-5*Math.max(1, r.u, r.v))) return null;
    return t;
  }

  function axisFrame(surface) {
    var axis = unit(surface.axis), b = basis(axis);
    return {axis:axis, u:b.u, v:b.v};
  }
  function radialAngleAt(base, p, frame) {
    var d = sub(p, base), axial = dot(d, frame.axis);
    var radial = sub(d, mul(frame.axis, axial));
    return Math.atan2(dot(radial, frame.v), dot(radial, frame.u));
  }




  function curveStationAt(surface, c, theta, frame, tol) {
    var n = curveNormal(c);
    var d = add(mul(frame.u, Math.cos(theta)), mul(frame.v, Math.sin(theta)));
    var point, den, base;
    if (surface.kind === 'cylinder') {
      base = surface.origin;
      var q0 = add(base, mul(d, surface.radius));
      den = dot(n, frame.axis);
      if (Math.abs(den) <= EPS) {
        if (Math.abs(dot(n, sub(c.center, q0))) <= tol) return {ambiguous:true};
        return {station:null};
      }
      point = add(q0, mul(frame.axis, dot(n, sub(c.center, q0))/den));
    } else {
      base = surface.apex || surface.origin;
      var alpha = surface.halfAngle;
      if (!Number.isFinite(alpha)) return {station:null};
      var g = add(mul(frame.axis, Math.cos(alpha)), mul(d, Math.sin(alpha)));
      den = dot(n, g);
      if (Math.abs(den) <= EPS) {
        if (Math.abs(dot(n, sub(c.center, base))) <= tol) return {ambiguous:true};
        return {station:null};
      }
      point = add(base, mul(g, dot(n, sub(c.center, base))/den));
    }
    if (!curveAcceptsPoint(c, point, tol)) return {station:null};
    if (surfaceResidual(surface, point) > tol*10) return {station:null};
    return {station:dot(sub(point, base), frame.axis)};
  }

  function segmentStationAt(a, b, q0, dir, axis, base, tol) {
    if (!finite(a) || !finite(b) || !finite(q0)) return {station:null};
    var e = sub(b, a), dd = dot(dir, dir), ee = dot(e, e), de = dot(dir, e);
    var den = dd*ee - de*de;
    if (ee <= EPS*EPS || Math.abs(den) <= EPS*Math.max(1, dd*ee)) return {ambiguous:true};
    var w = sub(q0, a), wd = dot(w, dir), we = dot(w, e);
    var t = (-wd*ee - de*we)/den;
    var u = (-dd*we - de*wd)/den;
    var p = add(q0, mul(dir, t));
    var q = add(a, mul(e, u));
    if (!pointsClose(p, q, tol)) return {station:null};
    if (u < -1e-6 || u > 1+1e-6) return {station:null};
    return {station:dot(sub(p, base), axis)};
  }

  function loopStationsAt(surface, loop, theta, curves, vertices, frame, tol) {
    var geometry = loopGeometry(loop, curves, vertices);
    var stations = [];
    for (var i=0;i<geometry.curves.length;i++) {
      var c = geometry.curves[i];
      if (!validCurve(c)) return {ok:false, reason:'invalid-curve'};
      var cs = curveStationAt(surface, c, theta, frame, tol);
      if (cs.ambiguous) return {ok:false, reason:'generator-ambiguous'};
      if (cs.station !== null && cs.station !== undefined) stations.push(cs.station);
    }
    var q0, dir, base;
    if (surface.kind === 'cylinder') {
      base = surface.origin;
      var d = add(mul(frame.u, Math.cos(theta)), mul(frame.v, Math.sin(theta)));
      q0 = add(base, mul(d, surface.radius));
      dir = frame.axis;
    } else {
      base = surface.apex || surface.origin;
      var dd = add(mul(frame.u, Math.cos(theta)), mul(frame.v, Math.sin(theta)));
      q0 = base;
      dir = add(mul(frame.axis, Math.cos(surface.halfAngle)), mul(dd, Math.sin(surface.halfAngle)));
    }
    for (var j=0;j<geometry.edges.length;j++) {
      var edge = geometry.edges[j];
      if (!finite(edge[0]) || !finite(edge[1])) return {ok:false, reason:'invalid-edge'};
      var es = segmentStationAt(edge[0], edge[1], q0, dir, frame.axis, base, tol);
      if (es.ambiguous) return {ok:false, reason:'generator-ambiguous'};
      if (es.station !== null && es.station !== undefined) stations.push(es.station);
    }
    var unique = [];
    stations.forEach(function (s) {
      if (!Number.isFinite(s)) return;
      if (!unique.some(function (u) { return Math.abs(u-s) <= tol*8; })) unique.push(s);
    });
    return {ok:true, stations:unique};
  }

  function sphereCapContainsPoint(surface, p) {
    var cap = surface.cap;
    if (!cap || !finite(cap.pole) || !finite(cap.mouth && cap.mouth.origin) ||
        !Number.isFinite(cap.angle)) return {ok:false, reason:'cap-unknown'};
    var pole = unit(cap.pole), tol = surfaceTolerance(surface);
    var h = dot(sub(cap.mouth.origin, surface.center), pole);
    var s = dot(sub(p, surface.center), pole);
    if (s < h - tol) return {ok:true, inside:false};
    if (s < h + tol) return {ok:false, reason:'boundary'};
    return {ok:true, inside:true};
  }




  function patchContainsPoint(surface, p, curves, vertices) {
    var tol = surfaceTolerance(surface);
    if (surface.kind === 'sphere') return sphereCapContainsPoint(surface, p);
    if (surface.kind !== 'cylinder' && surface.kind !== 'cone')
      return {ok:false, reason:'surface-kind'};
    var loops = surface.loops || [];
    if (surface.kind === 'cylinder' && loops.length !== 2)
      return {ok:false, reason:'topology'};
    if (surface.kind === 'cone' &&
        !(loops.length === 2 || (loops.length === 1 && finite(surface.apex || surface.origin))))
      return {ok:false, reason:'topology'};
    var frame = axisFrame(surface);
    var base = surface.kind === 'cone' ? (surface.apex || surface.origin) : surface.origin;
    var theta = radialAngleAt(base, p, frame), stations = [];
    for (var i=0;i<loops.length;i++) {
      var info = loopStationsAt(surface, loops[i], theta, curves, vertices, frame, tol);
      if (!info.ok) return {ok:false, reason:info.reason};
      if (info.stations.length !== 1)
        return {ok:false, reason:info.stations.length ? 'generator-multiple' : 'generator-missing'};
      stations.push(info.stations[0]);
    }
    if (surface.kind === 'cone' && loops.length === 1) stations.push(0);
    if (surface.kind === 'cone' && loops.length === 2 && stations[0]*stations[1] < 0)
      return {ok:false, reason:'apex-between-loops'};
    var s = dot(sub(p, base), frame.axis);
    var lo = Math.min.apply(null, stations), hi = Math.max.apply(null, stations);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return {ok:false, reason:'station'};
    if (s < lo - tol || s > hi + tol) return {ok:true, inside:false};
    if (s < lo + tol || s > hi - tol) return {ok:false, reason:'boundary'};
    return {ok:true, inside:true};
  }

  function segmentDistance2(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx*dx + dy*dy;
    if (l2 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    var t = Math.max(0, Math.min(1, ((p.x - a.x)*dx + (p.y - a.y)*dy) / l2));
    return Math.hypot(p.x - a.x - t*dx, p.y - a.y - t*dy);
  }
  function pointInPolygon2(p, polygon) {
    var inside = false;
    for (var i=0,j=polygon.length-1;i<polygon.length;j=i++) {
      var a = polygon[i], b = polygon[j];
      if ((a.y > p.y) !== (b.y > p.y) &&
          p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function pointOnPolygon2(p, polygon, tol) {
    for (var i=0;i<polygon.length;i++) {
      if (segmentDistance2(p, polygon[i], polygon[(i+1)%polygon.length]) <= tol)
        return true;
    }
    return false;
  }
  function appendPolygonCurve(out, c, chordTol) {
    if (!validCurve(c)) return false;
    var start = curveStart(c), sweep = curveSweep(c);
    var r = Math.max(radii(c).u, radii(c).v);
    var ratio = Math.max(-1, Math.min(1, 1 - (chordTol || EPS) / r));
    var step = 2 * Math.acos(ratio);
    var count = Math.max(16, Math.min(4096, Math.ceil(sweep / step)));
    var closed = sweep >= TAU - 1e-9;
    for (var i=0;i<(closed?count:count+1);i++)
      out.push(curvePoint(c, start + sweep*i/count));
    return true;
  }


  function loopPolygon(loop, curves, vertices, chordTol) {
    var out = [];
    function add(p) {
      if (!finite(p)) return false;
      if (!out.length || pointDistance(p, out[out.length-1]) > EPS) out.push(p);
      return true;
    }
    if (loop.elements) {
      for (var e=0;e<loop.elements.length;e++) {
        var el = loop.elements[e];
        if (!el) return null;
        if (el.kind === 'curve') {
          if (!appendPolygonCurve(out, el.curve, chordTol)) return null;
        } else if (el.kind === 'polyline') {
          (el.points || []).forEach(function (p) { add(p); });
        } else return null;
      }
    } else if (loop.section) {
      if (!appendPolygonCurve(out, loop.section, chordTol)) return null;
    } else if (loop.curves && loop.curves.length) {
      if (loop.lines && loop.lines.length) return null;
      for (var c=0;c<loop.curves.length;c++) {
        var curve = typeof loop.curves[c] === 'object' ? loop.curves[c] : curves[loop.curves[c]];
        if (!appendPolygonCurve(out, curve, chordTol)) return null;
      }
    } else if (loop.lines && loop.lines.length) {
      for (var l=0;l<loop.lines.length;l++) {
        if (!validLine(loop.lines[l])) return null;
        add(loop.lines[l].start);
        if (l === loop.lines.length-1) add(loop.lines[l].end);
      }
    } else if (loop.vertices && loop.vertices.length) {
      for (var v=0;v<loop.vertices.length;v++) {
        var point = vertices && vertices[loop.vertices[v]];
        if (!add(point)) return null;
      }
    } else if (loop.points && loop.points.length) {
      loop.points.forEach(function (p) { add(p); });
    } else return null;
    return out.length >= 3 ? out : null;
  }

  function fullCircleCurve(loop, curves) {
    var curve = null;
    if (loop.section) curve = loop.section;
    else if (loop.curves && loop.curves.length === 1 &&
        !(loop.lines && loop.lines.length) && !(loop.elements && loop.elements.length))
      curve = typeof loop.curves[0] === 'object' ? loop.curves[0] : curves[loop.curves[0]];
    if (!curve || !validCurve(curve)) return null;
    return curveSweep(curve) >= TAU - 1e-9 ? curve : null;
  }

  function classifyPlanePoint(surface, p, geometry) {
    var loops = surface.loops || [];
    if (!loops.length) return {status:'inside', method:'plane-unbounded', residual:0};
    var normal = unit(surface.normal), frame = basis(normal);
    var u = finite(surface.u) ? unit(surface.u) : frame.u;
    var v = finite(surface.v) ? unit(surface.v) : frame.v;
    var origin = surface.origin;
    var tol = surfaceTolerance(surface);
    var curves = geometry && geometry.curves || [];
    var vertices = geometry && geometry.vertices || [];
    function project(point) {
      var d = sub(point, origin);
      return {x:dot(d, u), y:dot(d, v)};
    }
    var q = project(p);
    var outerInside = false, holeInside = false, onBoundary = false;
    for (var i=0;i<loops.length;i++) {
      var loop = loops[i], state;
      var circle = fullCircleCurve(loop, curves);
      if (circle) {
        var r = radii(circle), rel = sub(p, circle.center);
        var a = dot(rel, circle.u) / r.u, b = dot(rel, circle.v) / r.v;
        var radialTol = tol / Math.min(r.u, r.v);
        var rho = Math.hypot(a, b);
        state = Math.abs(rho - 1) <= radialTol ? 'boundary' :
          rho < 1 ? 'inside' : 'outside';
      } else {
        var polygon = loopPolygon(loop, curves, vertices, tol);
        if (!polygon)
          return {status:'unknown', reason:'loop-unsupported', loopIndex:i, residual:0};
        var flat = polygon.map(project);
        if (pointOnPolygon2(q, flat, tol)) state = 'boundary';
        else state = pointInPolygon2(q, flat) ? 'inside' : 'outside';
      }
      if (state === 'boundary') onBoundary = true;
      else if (loop.kind === 'inner') { if (state === 'inside') holeInside = true; }
      else if (state === 'inside') outerInside = true;
    }
    if (onBoundary)
      return {status:'boundary', method:'plane-loops', residual:0, tolerance:tol};
    if (!loops.some(function (loop) { return loop.kind !== 'inner'; }))
      return {status:'unknown', reason:'no-outer-loop', residual:0};
    return {status:outerInside && !holeInside ? 'inside' : 'outside',
      method:'plane-loops', residual:0, tolerance:tol};
  }





  function volumeInteriorReference(volume) {
    if (!volume) return null;
    if (volume.kind === 'cylinder')
      return add(volume.origin, mul(volume.axis, volume.depth * 0.5));
    if (volume.kind === 'cone')
      return add(volume.origin, mul(volume.axis, volume.depth * 0.5));
    if (volume.kind === 'sphere') {
      var pole = unit(volume.pole || neg(volume.outward));
      return add(volume.center, mul(pole, volume.radius * 0.5));
    }
    return null;
  }

  function oppositeCapSides(parent, capCenter, capNormal, tolerance) {
    var reference = volumeInteriorReference(parent);
    if (!reference) return false;
    return dot(sub(reference, capCenter), capNormal) > Math.max(tolerance, 1e-9);
  }

  function booleanDomainState(surface, p, tolerance) {
    var domain = surface && surface.booleanDomain;
    if (!domain || !Array.isArray(domain.exclude)) return null;
    var onBoundary = false;
    var parentNormal = surface.kind === 'plane' ?
      (surface.normal || (surface.parameters && surface.parameters.normal)) : null;
    for (var i = 0; i < domain.exclude.length; i++) {
      var volume = domain.exclude[i];
      if (volume.kind === 'cylinder') {
        var axis = unit(volume.axis);
        var d = sub(p, volume.origin);
        var axial = dot(d, axis);
        var radial = Math.sqrt(Math.max(0, dot(d, d) - axial * axial));
        if (axial > tolerance && axial < volume.depth - tolerance &&
            radial < volume.radius - tolerance) return 'outside';
        var onCap = Math.abs(axial) <= tolerance*2 ||
          Math.abs(axial - volume.depth) <= tolerance*2;
        if (onCap && radial < volume.radius - tolerance) {
          var capNormal = Math.abs(axial) <= tolerance*2 ? neg(axis) : axis;
          var capCenter = Math.abs(axial) <= tolerance*2 ? volume.origin :
            add(volume.origin, mul(axis, volume.depth));
          var coincidentCap = parentNormal &&
            Math.abs(Math.abs(dot(unit(parentNormal), capNormal)) - 1) <= 1e-6;
          if (coincidentCap) {
            if (oppositeCapSides(domain.volume, capCenter, capNormal, tolerance))
              return 'outside';
            continue;
          }
          onBoundary = true;
          continue;
        }
        var withinAxial = axial >= -tolerance*2 && axial <= volume.depth + tolerance*2;
        var onSide = withinAxial &&
          Math.abs(radial - volume.radius) <= tolerance*2;
        if (onSide || (onCap && radial <= volume.radius + tolerance*2))
          onBoundary = true;
      } else if (volume.kind === 'cone') {
        var axis = unit(volume.axis), d = sub(p, volume.origin);
        var axial = dot(d, axis);
        var radial = Math.sqrt(Math.max(0, dot(d, d) - axial * axial));
        var profile = axialVolumeRadius(volume, Math.max(0, Math.min(volume.depth, axial)));
        var bottomRadius = Number.isFinite(volume.bottomRadius) ?
          volume.bottomRadius : volume.radius;
        if (axial > tolerance && axial < volume.depth - tolerance &&
            radial < profile - tolerance) return 'outside';
        var onMouth = Math.abs(axial) <= tolerance * 2 &&
          radial <= volume.radius + tolerance * 2;
        var onBottom = bottomRadius > 1e-12 && volume.openBottom !== true &&
          Math.abs(axial - volume.depth) <= tolerance * 2 &&
          radial <= bottomRadius + tolerance * 2;
        if ((onMouth || onBottom) && radial <
            (onMouth ? volume.radius : bottomRadius) - tolerance) {
          var capNormal = onMouth ? mul(axis, -1) : axis;
          var capCenter = onMouth ? volume.origin :
            add(volume.origin, mul(axis, volume.depth));
          var coincidentCap = parentNormal &&
            Math.abs(Math.abs(dot(unit(parentNormal), capNormal)) - 1) <= 1e-6;
          if (coincidentCap) {
            if (oppositeCapSides(domain.volume, capCenter, capNormal, tolerance))
              return 'outside';
            continue;
          }
          onBoundary = true;
          continue;
        }
        var withinAxial = axial >= -tolerance * 2 &&
          axial <= volume.depth + tolerance * 2;
        var onSide = withinAxial &&
          Math.abs(radial - profile) <= tolerance * 2;
        if (onSide || onMouth || onBottom) onBoundary = true;
      } else if (volume.kind === 'sphere') {
        var radius = length(sub(p, volume.center));
        var plane = dot(sub(p, volume.mouthCenter), volume.outward);
        if (radius < volume.radius - tolerance && plane < -tolerance) return 'outside';
        var normal = unit(volume.outward);
        var inPlane = sub(sub(p, volume.mouthCenter), mul(normal, plane));
        var mouthRadius = Number.isFinite(volume.mouthRadius) ? volume.mouthRadius :
          volume.radius * Math.sin(volume.capAngle);
        if (Math.abs(plane) <= tolerance*2 && Number.isFinite(mouthRadius) &&
            length(inPlane) < mouthRadius - tolerance) {
          var sphereCap = normal;
          var coincidentSphereCap = parentNormal &&
            Math.abs(Math.abs(dot(unit(parentNormal), sphereCap)) - 1) <= 1e-6;
          if (coincidentSphereCap) {
            if (oppositeCapSides(domain.volume, volume.mouthCenter, sphereCap, tolerance))
              return 'outside';
            continue;
          }
          onBoundary = true;
          continue;
        }
        if (Math.abs(radius - volume.radius) <= tolerance*2 && plane <= tolerance*2)
          onBoundary = true;
        if (Math.abs(plane) <= tolerance*2 && Number.isFinite(mouthRadius) &&
            length(inPlane) <= mouthRadius + tolerance*2) onBoundary = true;
      }
    }
    return onBoundary ? 'boundary' : null;
  }

  function implicitGeneratorState(surface, p, tolerance) {
    var g = surface.generator;
    if (!g || !finite(g.C) || !finite(g.A) || !finite(g.B) || !finite(g.D)) return null;
    var normal = finite(g.n) ? g.n : cross(g.A, g.B);
    var span = sub(g.D, g.C), h = dot(normal, span);
    var residual = surfaceResidual(surface, p);
    if (Math.abs(h) <= EPS) {
      if (Math.abs(g.k - 1) > EPS) return null;
      return {status:'inside', method:'implicit-generator', residual:residual, tolerance:tolerance};
    }
    var t = dot(normal, sub(p, g.C)) / h;
    var slack = tolerance / Math.max(1, length(span));
    if (t < -slack || t > 1 + slack)
      return {status:'outside', method:'implicit-generator', residual:residual,
        tolerance:tolerance, t:t};
    return {status:'inside', method:'implicit-generator', residual:residual,
      tolerance:tolerance, t:t};
  }

  function classifyPoint(surface, p, geometry) {
    if (!surface || !finite(p))
      return {status:'unknown', reason:'invalid-input'};
    var tol = surfaceTolerance(surface);
    var residual = surfaceResidual(surface, p);
    if (!Number.isFinite(residual) || residual > Math.max(tol*4, EPS))
      return {status:'outside', reason:'off-surface', residual:residual,
        tolerance:Math.max(tol*4, EPS)};
    var domainState = booleanDomainState(surface, p, tol);
    if (domainState === 'outside')
      return {status:'outside', method:'boolean-domain', residual:residual, tolerance:tol};
    if (surface.kind === 'plane') {
      var planeState = classifyPlanePoint(surface, p, geometry || {});
      if (domainState === 'boundary' && planeState.status === 'inside')
        return {status:'boundary', method:'boolean-domain', residual:residual, tolerance:tol};
      return planeState;
    }
    if (surface.kind === 'sphere' && surface.closed === true && !surface.cap)
      return {status:'inside', method:'closed-sphere', residual:residual, tolerance:tol};
    if (surface.kind === 'implicit' && surface.generator) {
      var generatorState = implicitGeneratorState(surface, p, tol);
      if (generatorState) return generatorState;
    }
    if (surface.kind === 'torus') {
      if (validTorusDomain(surface.domain)) {
        var params = torusParameters(surface, p);
        if (!params)
          return {status:'unknown', reason:'torus-parameter-undefined',
            residual:residual, tolerance:tol};
        var angleTol = tol / Math.max(surface.minorRadius, EPS);
        var uCheck = angleWithin(params.u, surface.domain.u[0], surface.domain.u[1], angleTol);
        var vCheck = angleWithin(params.v, surface.domain.v[0], surface.domain.v[1], angleTol);
        if (!uCheck.inside || !vCheck.inside)
          return {status:'outside', method:'torus-domain', residual:residual,
            tolerance:tol, parameters:params};
        if (uCheck.boundary || vCheck.boundary)
          return {status:'boundary', method:'torus-domain', residual:residual,
            tolerance:tol, parameters:params};
        return {status:'inside', method:'torus-domain', residual:residual,
          tolerance:tol, parameters:params};
      }
      if (surface.closed === true)
        return {status:'inside', method:'closed-torus', residual:residual, tolerance:tol};
      return {status:'unknown', reason:'torus-loops-unsupported',
        residual:residual, tolerance:tol};
    }
    var curves = geometry && geometry.curves || [];
    var vertices = geometry && geometry.vertices || [];
    var contained = patchContainsPoint(surface, p, curves, vertices);
    if (!contained.ok)
      return {status:contained.reason === 'boundary' ? 'boundary' : 'unknown',
        reason:contained.reason, residual:residual, tolerance:tol};
    if (domainState === 'boundary' && contained.inside)
      return {status:'boundary', method:'boolean-domain', residual:residual, tolerance:tol};
    return {status:contained.inside ? 'inside' : 'outside',
      method:surface.kind === 'sphere' ? 'sphere-cap' : 'loop-stations',
      residual:residual, tolerance:tol};
  }

  function boundedInside(state) {
    return !!(state && (state.status === 'inside' || state.status === 'boundary'));
  }
  function patchBounded(surface) {
    return !!((surface.loops && surface.loops.length) || surface.closed === true ||
      (surface.kind === 'torus' && validTorusDomain(surface.domain)));
  }
  function branchPointAt(branch, t) {
    if (branch.kind === 'line') {
      var direction = unit(branch.direction);
      return add(branch.origin, mul(direction, t));
    }
    return curvePoint(branch, t);
  }
  function boundedTolerance(a, b) {
    return Math.max(surfaceTolerance(a), surfaceTolerance(b), EPS);
  }
  function sampleStates(a, b, branch, t, geometry) {
    var point = branchPointAt(branch, t);
    var first = classifyPoint(a, point, geometry);
    var second = classifyPoint(b, point, geometry);
    return {t:t, point:point, first:first, second:second,
      inside:boundedInside(first) && boundedInside(second)};
  }
  function findBoundedStation(a, b, branch, tInside, tOutside, geometry, tolerance) {
    var inside = tInside, outside = tOutside;


    if (branch.kind !== 'line' && Math.abs(outside - inside) > Math.PI) {
      if (outside > inside) outside -= TAU; else outside += TAU;
    }
    for (var i = 0; i < 64; i++) {
      var mid = 0.5 * (inside + outside);
      var state = sampleStates(a, b, branch, mid, geometry);
      if (state.inside) inside = mid; else outside = mid;
      if (Math.abs(outside - inside) <= 1e-12 * Math.max(1, Math.abs(mid))) break;
    }
    var t = 0.5 * (inside + outside);
    return {t:t, point:branchPointAt(branch, t),
      method:'bisection', confidence:'numeric',
      parameterTolerance:Math.abs(outside - inside)};
  }
  function boundedRuns(samples, a, b, branch, geometry, tolerance, diagnostics) {
    var count = samples.length, runs = [];
    var allInside = samples.every(function (sample) { return sample.inside; });
    if (allInside) return {runs:[], allInside:true};
    if (!samples.some(function (sample) { return sample.inside; }))
      return {runs:[], allInside:false, none:true};
    var entering = -1;
    for (var i = 0; i < count; i++) {
      var next = (i + 1) % count;
      if (!samples[i].inside && samples[next].inside) { entering = next; break; }
    }
    if (entering === -1) {
      diagnostics.push({code:'bounded-station-missing', severity:'warning',
        message:'No inside-to-outside transition was found on an intersection branch.'});
      return {runs:[], allInside:false};
    }
    var index = entering, guard = 0;
    while (guard++ <= count) {
      if (!samples[index].inside) break;
      var startIndex = index, endIndex = index;
      var steps = 0;
      while (samples[endIndex].inside && steps++ <= count) endIndex = (endIndex + 1) % count;
      var start = findBoundedStation(a, b, branch,
        samples[startIndex].t, samples[(startIndex - 1 + count) % count].t,
        geometry, tolerance);
      var end = findBoundedStation(a, b, branch,
        samples[(endIndex - 1 + count) % count].t, samples[endIndex].t,
        geometry, tolerance);
      if (start.t > end.t) end.t += TAU;
      if (end.t - start.t > 1e-12) runs.push({start:start, end:end});
      index = endIndex;
      while (!samples[index].inside && guard++ <= count) index = (index + 1) % count;
      if (index === entering) break;
    }
    return {runs:runs, allInside:false};
  }
  function clipPeriodicBranch(a, b, branch, geometry, options, diagnostics) {
    var count = Math.max(32, options.samples || 128);
    var samples = [];
    for (var i = 0; i < count; i++) {
      samples.push(sampleStates(a, b, branch, (i + 0.5) * TAU / count, geometry));
    }
    var tolerance = boundedTolerance(a, b);
    var split = boundedRuns(samples, a, b, branch, geometry, tolerance, diagnostics);
    if (split.allInside) {
      var full = copyFields(branch);
      full.id = branch.id || undefined;
      full.bounded = true;
      full.closed = true;
      full.confidence = 'numeric';
      full.method = 'sampled-stations';
      return [full];
    }
    return split.runs.map(function (run) {
      var t0 = ((run.start.t % TAU) + TAU) % TAU;
      var t1 = ((run.end.t % TAU) + TAU) % TAU;
      if (t1 <= t0 + 1e-12) t1 += TAU;
      var arc = subArc(branch, t0, t1);
      arc.bounded = true;
      arc.closed = false;
      arc.confidence = 'numeric';
      arc.method = 'sampled-stations';
      arc.startStation = Object.assign({}, run.start, {t:t0});
      arc.endStation = Object.assign({}, run.end, {t:t1});
      arc.surfaceIds = [a.id === undefined ? null : a.id,
        b.id === undefined ? null : b.id];
      return arc;
    });
  }
  function clipParametricBranch(a, b, branch, start, end, geometry, options, diagnostics) {
    var count = Math.max(32, options.samples || 128);
    var closed = Math.abs((end - start) - TAU) <= 1e-9;
    var samples = [], parameters = [];
    for (var i = 0; i < count; i++) {
      var t = start + (end - start) * (i + 0.5) / count;
      parameters.push(t);
      samples.push(sampleStates(a, b, branch, t, geometry).inside);
    }
    function station(tInside, tOutside) {
      var inside = tInside, outside = tOutside;
      for (var k = 0; k < 64; k++) {
        var mid = 0.5 * (inside + outside);
        if (sampleStates(a, b, branch, mid, geometry).inside) inside = mid;
        else outside = mid;
        if (Math.abs(outside - inside) <= 1e-12 * Math.max(1, Math.abs(mid))) break;
      }
      var t = 0.5 * (inside + outside);
      return {t:t, point:branchPointAt(branch, t), method:'bisection', confidence:'numeric'};
    }
    function boundedArc(t0, t1) {
      var arc = subArc(branch, t0, t1);
      arc.bounded = true;
      arc.closed = false;
      arc.confidence = 'numeric';
      arc.method = 'sampled-stations';
      arc.surfaceIds = [a.id === undefined ? null : a.id,
        b.id === undefined ? null : b.id];
      return arc;
    }
    if (samples.every(Boolean)) {
      if (closed) {
        var full = copyFields(branch);
        full.bounded = true;
        full.closed = true;
        full.confidence = 'numeric';
        full.method = 'sampled-stations';
        return [full];
      }
      return [boundedArc(start, end)];
    }
    if (!samples.some(Boolean)) return [];
    var runs = [];
    if (closed) {
      var entering = -1;
      for (var j = 0; j < count; j++) {
        if (!samples[j] && samples[(j + 1) % count]) { entering = (j + 1) % count; break; }
      }
      if (entering === -1) return [];
      var index = entering, guard = 0;
      while (guard++ <= count) {
        if (!samples[index]) break;
        var startIndex = index, endIndex = index, steps = 0;
        while (samples[endIndex] && steps++ <= count) endIndex = (endIndex + 1) % count;
        var t0 = station(parameters[startIndex], parameters[(startIndex - 1 + count) % count]).t;
        var t1 = station(parameters[(endIndex - 1 + count) % count], parameters[endIndex]).t;
        if (t1 <= t0) t1 += TAU;
        runs.push({t0:t0, t1:t1});
        index = endIndex;
        while (!samples[index] && guard++ <= count) index = (index + 1) % count;
        if (index === entering) break;
      }
    } else {
      var cursor = 0;
      while (cursor < count) {
        if (!samples[cursor]) { cursor++; continue; }
        var first = cursor;
        while (cursor < count && samples[cursor]) cursor++;
        var last = cursor - 1;
        var openStart = first === 0 ? start : station(parameters[first], parameters[first - 1]).t;
        var openEnd = last === count - 1 ? end : station(parameters[last], parameters[last + 1]).t;
        runs.push({t0:openStart, t1:openEnd});
      }
    }
    return runs.map(function (run) { return boundedArc(run.t0, run.t1); });
  }

  function clipLineBranch(a, b, branch, geometry, options, diagnostics) {
    var direction = unit(branch.direction), origin = branch.origin;
    var extent = 1;
    ((geometry && geometry.vertices) || []).forEach(function (v) {
      if (finite(v)) extent = Math.max(extent, Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    });
    [a, b].forEach(function (s) {
      if (finite(s.origin)) extent = Math.max(extent, length(s.origin));
      if (finite(s.center)) extent = Math.max(extent, length(s.center));
      if (Number.isFinite(s.radius)) extent += Math.abs(s.radius);
    });
    var limit = extent * 4 + 10;
    var count = Math.max(64, options.samples || 192);
    var samples = [];
    for (var i = 0; i < count; i++) {
      var t = -limit + (i + 0.5) * (2 * limit) / count;
      samples.push(sampleStates(a, b, {kind:'line', origin:origin, direction:direction}, t, geometry));
    }
    var tolerance = boundedTolerance(a, b);
    var split = boundedRuns(samples, a, b, {kind:'line', origin:origin, direction:direction},
      geometry, tolerance, diagnostics);
    if (split.allInside) return [];
    return split.runs.map(function (run) {
      return {kind:'line', start:run.start.point, end:run.end.point,
        direction:direction, bounded:true, confidence:'numeric',
        method:'sampled-stations', startStation:run.start, endStation:run.end,
        surfaceIds:[a.id === undefined ? null : a.id, b.id === undefined ? null : b.id]};
    });
  }




  function surfacePatchPoints(surface, geometry) {
    if (!surface) return [];
    var curves = geometry && geometry.curves || [];
    var vertices = geometry && geometry.vertices || [];
    var points = [];
    function addCurve(c) {
      if (!validCurve(c)) return;
      var start = c.startAngle === undefined ? 0 : c.startAngle;
      var sweep = c.sweepAngle === undefined ? TAU : c.sweepAngle;
      for (var k = 0; k <= 24; k++) {
        var p = curvePoint(c, start + sweep * k / 24);
        if (finite(p)) points.push(copyPoint(p));
      }
    }
    (surface.loops || []).forEach(function (loop) {
      (loop.vertices || []).forEach(function (i) {
        if (vertices && finite(vertices[i])) points.push(copyPoint(vertices[i]));
      });
      (loop.points || []).forEach(function (p) { if (finite(p)) points.push(copyPoint(p)); });
      (loop.curves || []).forEach(function (i) { addCurve(curves[i]); });
      (loop.lines || []).forEach(function (line) {
        if (validLine(line)) { points.push(copyPoint(line.start)); points.push(copyPoint(line.end)); }
      });
      (loop.elements || []).forEach(function (element) {
        if (!element) return;
        if (element.kind === 'curve') addCurve(element.curve);
        else if (element.kind === 'polyline')
          (element.points || []).forEach(function (p) { if (finite(p)) points.push(copyPoint(p)); });
      });
      if (loop.section) addCurve(loop.section);
    });
    return points;
  }
  function surfacePatchBounds(surface, geometry) {
    var points = surfacePatchPoints(surface, geometry);
    if (!points.length) return null;
    var min = {x:Infinity, y:Infinity, z:Infinity};
    var max = {x:-Infinity, y:-Infinity, z:-Infinity};
    points.forEach(function (p) {
      min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y); min.z = Math.min(min.z, p.z);
      max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y); max.z = Math.max(max.z, p.z);
    });
    return {min:min, max:max, source:'patch-loops'};
  }
  function intersectWorldBoxes(boxes) {
    if (!boxes.length) return null;
    var min = {x:-Infinity, y:-Infinity, z:-Infinity};
    var max = {x:Infinity, y:Infinity, z:Infinity};
    boxes.forEach(function (box) {
      min.x = Math.max(min.x, box.min.x); min.y = Math.max(min.y, box.min.y);
      min.z = Math.max(min.z, box.min.z);
      max.x = Math.min(max.x, box.max.x); max.y = Math.min(max.y, box.max.y);
      max.z = Math.min(max.z, box.max.z);
    });
    if (max.x < min.x || max.y < min.y || max.z < min.z) return null;
    return {min:min, max:max, source:boxes.map(function (box) { return box.source; }).filter(Boolean)};
  }
  function splitInsideRuns(points, inside, closed) {
    var runs = [], current = [];
    points.forEach(function (p) {
      if (inside(p)) current.push(p);
      else { if (current.length) runs.push(current); current = []; }
    });
    if (current.length) runs.push(current);
    if (closed && runs.length > 1 && inside(points[0])) {
      var merged = runs.pop().concat(runs.shift() || []);
      runs.push(merged);
    }
    return runs.map(function (run) {
      return {points:run, closed:closed && run.length === points.length};
    });
  }
  function classifyImplicitSurface(eq, p) {
    if (!Implicit || !eq) return {status:'unknown', reason:'no-equation'};
    var evaluated = Implicit.evaluate(eq, p);
    if (!evaluated) return {status:'unknown', reason:'invalid-point'};
    var residual = Math.abs(evaluated.value);
    var tolerance = Implicit.equationTolerance(eq, p) * 64;
    if (residual > tolerance)
      return {status:'outside', reason:'off-support', residual:residual, tolerance:tolerance};
    var domain = Implicit.constraintsHold(eq, p);
    if (!domain.ok)
      return {status:'outside', reason:'domain', residual:residual,
        violations:domain.violations};
    if (eq.domain && eq.domain.unresolved && eq.domain.unresolved.length)
      return {status:'unknown', reason:'unresolved-domain', residual:residual,
        unresolvedDomain:eq.domain.unresolved.slice()};
    return {status:'inside', residual:residual, tolerance:tolerance};
  }
  function boundedImplicitIntersection(a, b, support, geometry, options) {
    options = options || {};
    if (!Implicit || !support) return null;
    var equationA = implicitEquationFor(a), equationB = implicitEquationFor(b);
    if (!equationA || !equationB) return null;
    var diagnostics = [];
    var bounds = null;
    if (options.bounds) {
      var lo = options.bounds.min || options.bounds.lo;
      var hi = options.bounds.max || options.bounds.hi;
      if (finite(lo) && finite(hi)) {
        bounds = {min:copyPoint(lo), max:copyPoint(hi), source:'caller'};
        if (bounds.min.x > bounds.max.x || bounds.min.y > bounds.max.y ||
            bounds.min.z > bounds.max.z) {
          return {contract:'bounded-intersection-v1', kind:'bounded', status:'unresolved',
            support:support, components:[],
            diagnostics:[{code:'bounded-implicit-invalid-bounds', severity:'error',
              message:'Caller bounds are not an ordered finite world box.'}],
            topologyCertified:false, confidence:'none'};
        }
      }
    }
    var boxes = [];
    [a, b].forEach(function (surface) {
      var box = surfacePatchBounds(surface, geometry);
      if (box) boxes.push(box);
    });
    if (support.bounds) boxes.push(support.bounds);
    var combined = intersectWorldBoxes(boxes);
    if (boxes.length && !combined)
      return {contract:'bounded-intersection-v1', kind:'bounded', status:'none',
        support:support, components:[],
        separation:{emptyWithinBounds:true, proven:false,
          reason:'patch-and-compact-bounds-disjoint', method:'world-box-intersection'},
        diagnostics:[{code:'bounded-implicit-bounds-disjoint', severity:'info',
          message:'Patch, compact support and caller boxes do not overlap; no display curve is claimed.'}],
        method:'implicit-interval-trace', confidence:'numeric', topologyCertified:false,
        coverage:{complete:false, uncertain:true}};
    if (bounds && combined) {
      var overlap = intersectWorldBoxes([bounds, combined]);
      if (!overlap)
        return {contract:'bounded-intersection-v1', kind:'bounded', status:'none',
          support:support, components:[],
          separation:{emptyWithinBounds:true, proven:false, reason:'caller-bounds-disjoint',
            method:'world-box-intersection'},
          diagnostics:[{code:'bounded-implicit-caller-bounds-disjoint', severity:'info',
            message:'Caller bounds do not overlap the compact or patch bounds.'}],
          method:'implicit-interval-trace', confidence:'numeric', topologyCertified:false,
          coverage:{complete:false, uncertain:true}};
      bounds = overlap;
    } else if (combined) bounds = combined;
    if (!bounds)
      return {contract:'bounded-intersection-v1', kind:'bounded', status:'unbounded',
        support:support, components:[],
        diagnostics:[{code:'bounded-implicit-unbounded', severity:'warning',
          message:'The implicit support set needs finite patch, compact or caller bounds for display.'}],
        method:'implicit-interval-trace', confidence:'numeric', topologyCertified:false};
    var display = Implicit.trace(equationA, equationB, Object.assign({}, options, {bounds:bounds}));
    var components = [];
    var implicitKind = {implicit:true, polynomial:true};
    var clipA = implicitKind[a.kind] ? true : patchBounded(a);
    var clipB = implicitKind[b.kind] ? true : patchBounded(b);
    var unknownDomain = 0;
    var insideSurface = function (surface, equation, clip, p) {
      if (!clip) return true;
      if (implicitKind[surface.kind]) {
        var state = classifyImplicitSurface(equation, p);
        if (state.status === 'unknown') {
          unknownDomain++;
          return true;
        }
        return state.status === 'inside' || state.status === 'boundary';
      }
      return boundedInside(classifyPoint(surface, p, geometry));
    };
    display.curves.forEach(function (curve) {
      var inside = function (p) {
        return insideSurface(a, equationA, clipA, p) &&
          insideSurface(b, equationB, clipB, p);
      };
      splitInsideRuns(curve.points, inside, curve.closed).forEach(function (run) {
        if (run.points.length === 1) {
          components.push({kind:'point', point:run.points[0], bounded:true,
            confidence:'numeric', method:'implicit-interval-trace',
            residual:curve.residual, topologyCertified:false});
        } else if (run.points.length > 1) {
          components.push({kind:'polyline', points:run.points, closed:run.closed,
            bounded:true, confidence:'numeric', method:'implicit-interval-trace',
            residual:curve.residual, trace:curve.trace,
            sourceIds:(curve.sourceIds || []).slice(), topologyCertified:false,
            domainStatus:'patch-classified'});
        }
      });
    });
    if (unknownDomain)
      diagnostics.push({code:'bounded-implicit-domain-unknown', severity:'warning',
        message:'Implicit loop or boolean domain masks are not compiled; curve points are retained with unknown domain membership.'});
    var status = components.length ?
      (display.status === 'partial' ? 'partial' : 'ok') :
      display.status === 'none' ? 'none' :
      display.status === 'coincident' ? 'coincident' :
      display.status === 'unresolved' ? 'unresolved' :
      display.status === 'unbounded' ? 'unbounded' : 'unresolved';
    (display.diagnostics || []).forEach(function (d) { diagnostics.push(d); });
    if (support.supportOnly)
      diagnostics.push({code:'bounded-implicit-support-only', severity:'warning',
        message:'The support equations compile finite axes and nappes; loop or boolean domains are classified through the patches.'});
    if (display.unresolved && display.unresolved.length)
      diagnostics.push({code:'bounded-implicit-unresolved', severity:'warning',
        message:'Some implicit display cells or trace ends remain unresolved.'});
    var result = {contract:'bounded-intersection-v1', kind:'bounded', status:status,
      support:support, components:components, diagnostics:diagnostics,
      summary:{components:components.length,
        arcs:components.filter(function (c) { return c.kind === 'arc'; }).length,
        full:components.filter(function (c) { return c.closed === true; }).length,
        points:components.filter(function (c) { return c.kind === 'point'; }).length,
        polylines:components.filter(function (c) { return c.kind === 'polyline'; }).length},
      method:'implicit-interval-trace', confidence:'numeric',
      topologyCertified:false, bounds:bounds,
      unresolved:(display.unresolved || []).concat(unknownDomain ?
        [{reason:'implicit-domain-unknown', count:unknownDomain}] : []),
      domainUnknown:unknownDomain > 0,
      coverage:display.coverage || {complete:false, uncertain:true},
      tolerance:boundedTolerance(a, b)};
    if (display.status === 'none')
      result.separation = {emptyWithinBounds:true, proven:false,
        reason:'numeric-parameter-grid-and-interval-exclusion',
        method:'interval-separation-parameter-domain'};
    return result;
  }

  function intersectBounded(a, b, geometry, options) {
    options = options || {};
    var diagnostics = [];
    var contract = 'bounded-intersection-v1';
    var support = intersect(a, b, options);
    if (!support) {
      return {contract:contract, kind:'bounded', status:'unsupported',
        support:null, components:[],
        diagnostics:[{code:'bounded-support-unsupported', severity:'error',
          message:'The support intersection is not implemented for this surface pair.'}]};
    }
    if (support.contract === (Implicit && Implicit.INTERSECTION_CONTRACT) &&
        support.kind === 'implicit-intersection') {
      var generic = boundedImplicitIntersection(a, b, support, geometry, options);
      if (generic) return generic;
    }
    if (support.contract === (Implicit && Implicit.INTERSECTION_CONTRACT) &&
        support.kind === 'none' && support.proven === false) {
      return {contract:contract, kind:'bounded', status:'unresolved', support:support,
        components:[], diagnostics:[{code:'bounded-implicit-separation-numeric',
          severity:'warning', message:'Interval separation is numeric evidence, not a certified empty intersection.'}],
        topologyCertified:false, confidence:'numeric',
        coverage:{complete:false, uncertain:true}};
    }
    if (support.kind === 'none') {
      return {contract:contract, kind:'bounded', status:'none', support:support,
        components:[], diagnostics:diagnostics};
    }
    if (!patchBounded(a) || !patchBounded(b)) {
      return {contract:contract, kind:'bounded', status:'unbounded',
        support:support, components:[],
        diagnostics:[{code:'bounded-patch-unbounded', severity:'warning',
          message:'Both input patches need a boundary loop or closed compact support.'}]};
    }
    if (support.kind === 'none') {
      return {contract:contract, kind:'bounded', status:'none', support:support,
        components:[], diagnostics:diagnostics};
    }
    if (support.kind === 'point') {
      var pointState = sampleStates(a, b, {kind:'line', origin:support.point,
        direction:{x:0,y:0,z:1}}, 0, geometry);
      return {contract:contract, kind:'bounded', status:'ok', support:support,
        components:pointState.inside ? [{kind:'point', point:support.point,
          bounded:true, confidence:'numeric'}] : [],
        diagnostics:diagnostics};
    }
    if (support.kind === 'plane-overlap' || support.kind === 'coincident') {
      return {contract:contract, kind:'bounded', status:'coincident',
        support:support, components:[],
        diagnostics:[{code:'bounded-overlap-unsupported', severity:'warning',
          message:'Bounded overlap topology is not implemented.'}]};
    }
    if (support.kind === 'unsupported') {
      return {contract:contract, kind:'bounded', status:'unsupported',
        support:support, components:[], diagnostics:diagnostics};
    }
    if (support.kind === 'points') {
      var boundedPoints = (support.points || []).filter(function (point) {
        return boundedInside(classifyPoint(a, point, geometry)) &&
          boundedInside(classifyPoint(b, point, geometry));
      }).map(function (point) {
        return {kind:'point', point:point, bounded:true, confidence:'analytic'};
      });
      return {contract:contract, kind:'bounded', status:'ok', support:support,
        components:boundedPoints, diagnostics:diagnostics};
    }
    var components = [], usedAnalytic = false, usedNumeric = false;
    var branches = [];
    if (support.kind === 'circle' || support.kind === 'ellipse') branches = [support];
    else if (support.kind === 'circles') branches = support.circles || [];
    else if (support.kind === 'line') branches = [support];
    else if (support.kind === 'lines') branches = support.lines || [];
    else if (support.kind === 'torusSection' || support.kind === 'torusSphere') {
      (support.branches || []).forEach(function (branch) {
        var start = Number.isFinite(branch.uStart) ? branch.uStart : curveStart(branch);
        var end = Number.isFinite(branch.uEnd) ? branch.uEnd :
          start + curveSweep(branch);
        components = components.concat(clipParametricBranch(a, b, branch, start, end,
          geometry, options || {}, diagnostics));
      });
      return {contract:contract, kind:'bounded', status:'ok', support:support,
        components:components, diagnostics:diagnostics};
    } else {
      return {contract:contract, kind:'bounded', status:'unsupported',
        support:support, components:[],
        diagnostics:[{code:'bounded-support-kind', severity:'error',
          message:'Bounded clipping does not handle support kind ' + support.kind + '.'}]};
    }
    branches.forEach(function (branch) {
      if (!branch.kind && finite(branch.center)) branch.kind = 'circle';
      if (branch.kind === 'line' || !branch.kind && branch.direction) {
        var analyticLine = null;
        if (a.kind === 'plane' && b.kind === 'plane')
          analyticLine = clipLinePlanarAnalytic(a, b, branch, geometry);
        if (analyticLine !== null) {
          components = components.concat(analyticLine);
          usedAnalytic = true;
        } else {
          components = components.concat(clipLineBranch(a, b, branch, geometry, options, diagnostics));
          usedNumeric = true;
        }
      } else {
        var analytic = null;
        if (a.kind === 'plane' && b.closed === true)
          analytic = clipPeriodicBranchAnalytic(a, b, branch, geometry, a, b);
        else if (b.kind === 'plane' && a.closed === true)
          analytic = clipPeriodicBranchAnalytic(a, b, branch, geometry, b, a);
        if (analytic !== null) {
          components = components.concat(analytic);
          usedAnalytic = true;
        } else {
          components = components.concat(clipPeriodicBranch(a, b, branch, geometry, options, diagnostics));
          usedNumeric = true;
        }
      }
    });
    var totalSweep = components.reduce(function (sum, component) {
      return sum + (Number.isFinite(component.sweepAngle) ? component.sweepAngle : 0);
    }, 0);
    return {contract:contract, kind:'bounded',
      status:components.length ? 'ok' : 'none',
      support:support, components:components, diagnostics:diagnostics,
      summary:{components:components.length,
        arcs:components.filter(function (c) { return c.kind === 'arc'; }).length,
        full:components.filter(function (c) { return c.closed === true; }).length,
        sweepRatio:Math.round(totalSweep / Math.PI * 1e4) / 1e4},
      method:usedAnalytic && usedNumeric ? 'mixed-stations' :
        usedAnalytic ? 'analytic-plane-stations' : 'sampled-stations',
      confidence:usedAnalytic && !usedNumeric ? 'analytic-stations' : 'numeric',
      tolerance:boundedTolerance(a, b)};
  }

  function planePolygonSegments(surface, geometry) {
    var segments = [], supported = true;
    (surface.loops || []).forEach(function (loop) {
      if (loop.section || (loop.curves && loop.curves.length)) {
        supported = false;
        return;
      }
      function segment(a, b) {
        if (finite(a) && finite(b) && pointDistance(a, b) > EPS)
          segments.push({start:a, end:b});
      }
      if (loop.points && loop.points.length) {
        loop.points.forEach(function (p, i) {
          segment(p, loop.points[(i+1)%loop.points.length]);
        });
      } else if (loop.vertices && loop.vertices.length) {
        var points = loop.vertices.map(function (i) { return geometry.vertices && geometry.vertices[i]; });
        points.forEach(function (p, i) { segment(p, points[(i+1)%points.length]); });
      } else if (loop.lines && loop.lines.length) {
        loop.lines.forEach(function (line) {
          if (!validLine(line)) { supported = false; return; }
          segment(line.start, line.end);
        });
      } else if (loop.elements && loop.elements.length) {
        loop.elements.forEach(function (element) {
          if (!element) { supported = false; return; }
          if (element.kind === 'polyline') {
            (element.points || []).forEach(function (p, i, list) {
              if (i < list.length - 1) segment(p, list[i+1]);
            });
          } else supported = false;
        });
      } else supported = false;
    });
    return supported && segments.length ? segments : null;
  }



  function analyticPlaneStations(surface, branch, geometry, tolerance) {
    if (!surface || surface.kind !== 'plane' || !finite(surface.origin) ||
        !finite(surface.normal)) return null;
    if (!branch || !finite(branch.center) || !finite(branch.u) || !finite(branch.v))
      return null;
    var normal = unit(surface.normal), r = radii(branch);
    if (Math.abs(dot(sub(branch.center, surface.origin), normal)) > tolerance) return null;
    if (Math.abs(dot(branch.u, normal)) > 1e-7 ||
        Math.abs(dot(branch.v, normal)) > 1e-7) return null;
    var segments = planePolygonSegments(surface, geometry);
    if (!segments) return null;
    var stations = [];
    segments.forEach(function (line) {
      var direction = sub(line.end, line.start);
      var length2 = dot(direction, direction);
      if (length2 <= EPS * EPS) return;
      var inPlaneNormal = unitOrNull(cross(direction, normal));
      if (!inPlaneNormal) return;
      var a = dot(inPlaneNormal, mul(branch.u, r.u));
      var b = dot(inPlaneNormal, mul(branch.v, r.v));
      var c = dot(inPlaneNormal, sub(branch.center, line.start));
      var amplitude = Math.hypot(a, b);
      if (amplitude <= EPS) return;
      var ratio = -c / amplitude;
      if (ratio < -1 - 1e-9 || ratio > 1 + 1e-9) return;
      ratio = Math.max(-1, Math.min(1, ratio));
      var base = Math.atan2(b, a), delta = Math.acos(ratio);
      [base + delta, base - delta].forEach(function (angle) {
        var t = ((angle % TAU) + TAU) % TAU;
        var point = curvePoint(branch, t);
        var along = dot(sub(point, line.start), direction) / length2;
        var distance = length(sub(sub(point, line.start), mul(direction, along)));
        if (along >= -1e-7 && along <= 1 + 1e-7 && distance <= tolerance * 4) {
          if (!stations.some(function (u) { return Math.abs(u - t) <= 1e-9; }))
            stations.push(t);
        }
      });
    });
    stations.sort(function (a, b) { return a - b; });
    return stations;
  }



  function clipPeriodicBranchAnalytic(a, b, branch, geometry, planeSurface, otherSurface) {
    var tolerance = boundedTolerance(a, b);
    var stations = analyticPlaneStations(planeSurface, branch, geometry, tolerance);
    if (stations === null) return null;
    var toleranceAngle = 1e-9;
    var clean = [];
    stations.concat([0]).sort(function (x, y) { return x - y; }).forEach(function (t) {
      if (t >= TAU - toleranceAngle) t = 0;
      if (!clean.length || Math.abs(t - clean[clean.length-1]) > toleranceAngle) clean.push(t);
    });
    if (clean.length === 1) {
      var fullState = sampleStates(a, b, branch, 0.5 * TAU, geometry);
      if (!fullState.inside) return [];
      var full = copyFields(branch);
      full.bounded = true;
      full.closed = true;
      full.confidence = 'analytic-stations';
      full.method = 'analytic-plane-stations';
      return [full];
    }
    var components = [];
    for (var i = 0; i < clean.length; i++) {
      var t0 = clean[i];
      var t1 = i + 1 < clean.length ? clean[i+1] : clean[0] + TAU;
      if (t1 - t0 <= 1e-12) continue;
      var state = sampleStates(a, b, branch, 0.5 * (t0 + t1), geometry);
      if (!state.inside) continue;
      var arc = subArc(branch, t0, t1);
      arc.bounded = true;
      arc.closed = false;
      arc.confidence = 'analytic-stations';
      arc.method = 'analytic-plane-stations';
      arc.surfaceIds = [a.id === undefined ? null : a.id,
        b.id === undefined ? null : b.id];
      components.push(arc);
    }


    var merged = [];
    components.forEach(function (component) {
      var last = merged[merged.length-1];
      if (last && Math.abs(component.startAngle -
          (last.startAngle + last.sweepAngle)) <= 1e-9) {
        last.sweepAngle += component.sweepAngle;
      } else merged.push(component);
    });
    components = merged;
    if (components.length > 1) {
      var first = components[0], last = components[components.length-1];
      if (Math.abs(first.startAngle) <= 1e-12 &&
          Math.abs(last.startAngle + last.sweepAngle - TAU) <= 1e-9) {
        last.sweepAngle += first.sweepAngle;
        components.shift();
      }
    }
    return components;
  }

  function planeBasis(surface) {
    var normal = unit(surface.normal);
    var frame = basis(normal);
    return {normal:normal,
      u:finite(surface.u) ? unit(surface.u) : frame.u,
      v:finite(surface.v) ? unit(surface.v) : frame.v};
  }
  function linePolygonIntervals(surface, origin, direction, geometry, tolerance) {
    if (!surface || surface.kind !== 'plane') return null;
    var segments = planePolygonSegments(surface, geometry);
    if (!segments) return null;
    var frame = planeBasis(surface);
    function project(p) {
      var d = sub(p, surface.origin);
      return {x:dot(d, frame.u), y:dot(d, frame.v)};
    }
    var o = project(origin), dirEnd = project(add(origin, direction));
    var d2 = {x:dirEnd.x - o.x, y:dirEnd.y - o.y};
    var length2 = d2.x*d2.x + d2.y*d2.y;
    if (length2 <= EPS*EPS) return null;
    var stations = [];
    function addStation(s) {
      if (!Number.isFinite(s)) return;
      if (!stations.some(function (u) { return Math.abs(u - s) <= 1e-9; }))
        stations.push(s);
    }
    segments.forEach(function (segment) {
      var a = project(segment.start), b = project(segment.end);
      var e = {x:b.x - a.x, y:b.y - a.y};
      var q = {x:a.x - o.x, y:a.y - o.y};
      var den = d2.x*e.y - d2.y*e.x;
      if (Math.abs(den) <= 1e-12) {
        var distance = Math.abs(q.x*d2.y - q.y*d2.x) / Math.sqrt(length2);
        if (distance <= tolerance) {
          addStation((q.x*d2.x + q.y*d2.y) / length2);
          addStation(((b.x-o.x)*d2.x + (b.y-o.y)*d2.y) / length2);
        }
        return;
      }
      var t = (q.x*d2.y - q.y*d2.x) / den;
      if (t < -1e-7 || t > 1 + 1e-7) return;
      addStation((q.x*e.y - q.y*e.x) / den);
    });
    if (!stations.length) return null;
    stations.sort(function (a, b) { return a - b; });
    var intervals = [];
    for (var i = 0; i + 1 < stations.length; i++) {
      var t0 = stations[i], t1 = stations[i+1];
      if (t1 - t0 <= 1e-12) continue;
      var mid = 0.5 * (t0 + t1);
      var point = add(origin, mul(unit(direction), mid));
      var state = classifyPoint(surface, point, geometry);
      if (boundedInside(state)) intervals.push({start:t0, end:t1});
    }
    return intervals;
  }
  function clipLinePlanarAnalytic(a, b, branch, geometry) {
    var direction = unit(branch.direction);
    var tolerance = boundedTolerance(a, b);
    var first = linePolygonIntervals(a, branch.origin, direction, geometry, tolerance);
    var second = linePolygonIntervals(b, branch.origin, direction, geometry, tolerance);
    if (first === null || second === null) return null;
    var components = [];
    first.forEach(function (one) {
      second.forEach(function (two) {
        var t0 = Math.max(one.start, two.start);
        var t1 = Math.min(one.end, two.end);
        if (t1 - t0 <= 1e-12) return;
        components.push({kind:'line',
          start:add(branch.origin, mul(direction, t0)),
          end:add(branch.origin, mul(direction, t1)),
          direction:direction, bounded:true, confidence:'analytic-stations',
          method:'analytic-line-stations',
          surfaceIds:[a.id === undefined ? null : a.id, b.id === undefined ? null : b.id]});
      });
    });
    return components;
  }

  function splitSectionForCrossing(surface, spec, cut, crossingPoints, geometry) {
    var params = [];
    for (var i=0;i<crossingPoints.length;i++) {
      var t = sectionParameterOf(cut, crossingPoints[i]);
      if (t === null) return {ok:false, code:'split-section-intersection-mismatch',
        point:copyPoint(crossingPoints[i])};
      var normalized = ((t % TAU) + TAU) % TAU;
      if (!params.some(function (u) { return Math.abs(u-normalized) <= 1e-7 || Math.abs(u-normalized) >= TAU-1e-7; }))
        params.push(normalized);
    }
    params.sort(function (a,b) { return a-b; });
    if (params.length < 2) return {ok:false, code:'split-section-tangent'};
    var closed = curveSweep(cut) >= TAU - 1e-9;
    var arcs = [];
    for (var j=0;j<params.length;j++) {
      var t0 = params[j];
      var t1 = j+1 < params.length ? params[j+1] : (closed ? params[0] + TAU : null);
      if (t1 === null) break;
      if (t1 - t0 <= 1e-9) continue;
      var mid = 0.5*(t0+t1);
      var contains = patchContainsPoint(surface, curvePoint(cut, mid),
        geometry && geometry.curves || [], geometry && geometry.vertices || []);
      if (!contains.ok) return {ok:false, code:'split-section-outside-patch',
        reason:contains.reason};
      if (contains.inside) {
        var arc = subArc(cut, t0, t1);
        arc.sourceIds = (cut.sourceIds || []).slice();
        arc.sectionArc = true;
        arcs.push(arc);
      }
    }
    if (!arcs.length) return {ok:false, code:'split-section-outside-patch'};
    return {ok:true, arcs:arcs};
  }

  function sectionArcChain(arc) {
    return {sign:0, shared:true, elements:[{kind:'curve', curve:arc}],
      start:curvePoint(arc, curveStart(arc)),
      end:curvePoint(arc, curveStart(arc) + curveSweep(arc))};
  }
  function chainElements(chain, reversed) {
    var elements = reversed ? chain.elements.slice().reverse() : chain.elements;
    return elements.map(function (el) {
      if (el.kind === 'curve') return {kind:'curve', curve:el.curve};
      var pts = reversed ? el.points.slice().reverse() : el.points.slice();
      return {kind:'polyline', points:pts};
    });
  }




  function assembleCrossingLoops(surface, loopChains, arcs) {
    var matchTol = 1e-6*Math.max(1, surface.radius || 1);
    var chains = loopChains.concat(arcs.map(sectionArcChain));
    if (!chains.length) return {ok:true, loops:[]};
    var used = chains.map(function () { return false; }), loops = [];
    for (var i=0;i<chains.length;i++) {
      if (used[i]) continue;
      used[i] = true;
      var cycle = [{chain:chains[i], reversed:false}];
      var start = chains[i].start, current = chains[i].end, guard = 0;
      while (!pointsClose(current, start, matchTol)) {
        if (++guard > chains.length + 1)
          return {ok:false, code:'split-loop-assembly-failed', reason:'cycle-guard'};
        var found = -1, reversed = false;
        for (var j=0;j<chains.length;j++) {
          if (used[j]) continue;
          if (pointsClose(chains[j].start, current, matchTol)) { found = j; reversed = false; break; }
          if (pointsClose(chains[j].end, current, matchTol)) { found = j; reversed = true; break; }
        }
        if (found < 0) return {ok:false, code:'split-loop-assembly-failed', reason:'open-chain'};
        used[found] = true;
        cycle.push({chain:chains[found], reversed:reversed});
        current = reversed ? chains[found].start : chains[found].end;
      }
      if (!cycle.some(function (entry) { return !entry.chain.shared; }))
        return {ok:false, code:'split-loop-assembly-failed', reason:'section-only-cycle'};
      var elements = [];
      cycle.forEach(function (entry) {
        elements = elements.concat(chainElements(entry.chain, entry.reversed));
      });
      if (elements.length) loops.push({kind:'outer', elements:elements});
    }
    if (used.some(function (u) { return !u; }))
      return {ok:false, code:'split-loop-assembly-failed', reason:'unused-chain'};
    return {ok:true, loops:loops};
  }




  function sphereCapContainsCut(surface, spec, cut) {
    var cap = surface.cap;
    if (!cap || !finite(cap.pole) || !finite(cap.mouth && cap.mouth.origin) ||
        !Number.isFinite(cap.angle)) return {ok:false, reason:'unknown'};
    var pole = unit(cap.pole), tol = surfaceTolerance(surface);
    if (Math.abs(Math.abs(dot(spec.normal, pole)) - 1) > 1e-7)
      return {ok:false, reason:'oblique'};
    var mouthHeight = dot(sub(cap.mouth.origin, surface.center), pole);
    var cutHeight = dot(sub(cut.center, surface.center), pole);
    if (!(cutHeight > mouthHeight + tol) || !(cutHeight < surface.radius - tol))
      return {ok:false, reason:'outside'};
    return {ok:true};
  }




  function splitSideBounded(surface, retained, spec, sign) {
    if (surface.kind === 'sphere') return true;
    if (retained > 0) return true;
    if (surface.kind === 'cone' && finite(surface.apex || surface.origin)) {
      var apex = surface.apex || surface.origin;
      var distance = dot(spec.normal, sub(apex, spec.origin));
      return sign * distance > surfaceTolerance(surface);
    }
    return false;
  }

  function splitPiece(surface, loops, cut, spec, sign, detail) {
    var out = {};
    Object.keys(surface).forEach(function (k) { if (k !== 'loops') out[k] = surface[k]; });
    out.id = (surface.id || 'surface') + '/split:' + (sign > 0 ? 'positive' : 'negative');
    out.loops = loops.slice();




    if (!detail || detail.appendSection !== false)
      out.loops.push({kind:'outer', section:cut});
    out.closed = false;


    delete out.cap;
    delete out.recess;
    delete out.boundaryCurves;
    out.parentSurfaceId = surface.id === undefined ? null : surface.id;
    out.splitBy = {surfaceId:out.parentSurfaceId,
      plane:{origin:copyPoint(spec.origin), normal:copyPoint(spec.normal)},
      sectionKind:cut.kind, side:sign > 0 ? 'positive' : 'negative'};
    if (detail && detail.sectionArcCount !== undefined)
      out.splitBy.sectionArcCount = detail.sectionArcCount;
    if (detail && detail.analyticLoops) out.splitBy.analyticLoops = true;
    out.sourceIds = Array.from(new Set((surface.sourceIds || []).concat(cut.sourceIds || [])));
    return out;
  }




  function crossingSplitPlan(surface, spec, cut, geometry, loops, sides) {
    function fail(code, message, detail) {
      var diagnostic = {code:code, message:message};
      Object.keys(detail || {}).forEach(function (k) { diagnostic[k] = detail[k]; });
      return {ok:false, diagnostic:diagnostic};
    }
    var curves = geometry && geometry.curves || [];
    var vertices = geometry && geometry.vertices || [];
    if (surface.kind === 'sphere') {
      if (!surface.cap || !finite(surface.cap.pole) ||
          !finite(surface.cap.mouth && surface.cap.mouth.origin) ||
          !Number.isFinite(surface.cap.angle))
        return fail('split-sphere-cap-unknown',
          'A bounded sphere patch without recess cap metadata has an ambiguous material side.',
          {surfaceId:surface.id});
    } else if (surface.kind === 'cylinder') {
      if (loops.length !== 2) return fail('split-patch-topology-unsupported',
        'A crossing cut on a cylinder needs both end loops; the patch would be unbounded otherwise.',
        {surfaceId:surface.id, loopCount:loops.length});
    } else if (surface.kind === 'cone') {
      if (!(loops.length === 2 || (loops.length === 1 && finite(surface.apex || surface.origin))))
        return fail('split-patch-topology-unsupported',
          'A crossing cut on a cone needs a frustum between two loops or an apex-bounded tip patch.',
          {surfaceId:surface.id, loopCount:loops.length});
    }
    var closureTol = 1e-6*Math.max(1, surface.radius || 1);
    for (var i=0;i<loops.length;i++) {
      if (!loopIsClosed(loops[i], curves, vertices, closureTol))
        return fail('split-loop-disconnected',
          'Boundary loop ' + i + ' is not a closed cycle, so a crossing split cannot close both sides.',
          {surfaceId:surface.id, loopIndex:i});
    }

    var positiveChains = [], negativeChains = [], positiveFull = [], negativeFull = [];
    var crossingPoints = [];
    for (var j=0;j<loops.length;j++) {
      if (sides[j] !== 2) {
        (sides[j] > 0 ? positiveFull : negativeFull).push(loops[j]);
        continue;
      }
      var splitLoop = splitLoopForCrossing(loops[j], surface, spec, curves, vertices, j);
      if (!splitLoop.ok) return fail(splitLoop.code,
        'Boundary loop ' + j + ' could not be split analytically at the cutting plane.',
        {surfaceId:surface.id, loopIndex:j, reason:splitLoop.detail && splitLoop.detail.code});
      splitLoop.chains.forEach(function (chain) {
        (chain.sign > 0 ? positiveChains : negativeChains).push(chain);
      });
      crossingPoints = crossingPoints.concat(splitLoop.crossingPoints);
    }
    if (!crossingPoints.length)
      return fail('split-section-crossing-missing',
        'The crossing loops did not produce a section station.', {surfaceId:surface.id});

    var sectionSplit = splitSectionForCrossing(surface, spec, cut, crossingPoints, geometry);
    if (!sectionSplit.ok) {
      var messages = {
        'split-section-tangent':'The crossing loops touch the section at fewer than two stations.',
        'split-section-intersection-mismatch':'A loop/section crossing point is not on the analytic section.',
        'split-section-outside-patch':'The analytic section does not pass through the bounded patch interior.'
      };
      return fail(sectionSplit.code, messages[sectionSplit.code] ||
        'The cutting section could not be split into patch-interior arcs.',
        {surfaceId:surface.id, reason:sectionSplit.reason});
    }

    var positiveAssembly = assembleCrossingLoops(surface, positiveChains, sectionSplit.arcs);
    if (!positiveAssembly.ok) return fail('split-loop-assembly-failed',
      'The positive loop pieces did not close into boundary cycles.',
      {surfaceId:surface.id, side:'positive', reason:positiveAssembly.reason});
    var negativeAssembly = assembleCrossingLoops(surface, negativeChains, sectionSplit.arcs);
    if (!negativeAssembly.ok) return fail('split-loop-assembly-failed',
      'The negative loop pieces did not close into boundary cycles.',
      {surfaceId:surface.id, side:'negative', reason:negativeAssembly.reason});

    var positiveLoops = positiveAssembly.loops.concat(positiveFull);
    var negativeLoops = negativeAssembly.loops.concat(negativeFull);
    if (!splitSideBounded(surface, positiveLoops.length, spec, 1))
      return fail('split-patch-unbounded',
        'The positive piece has no boundary loop and no compact support to bound it.',
        {surfaceId:surface.id, side:'positive'});
    if (!splitSideBounded(surface, negativeLoops.length, spec, -1))
      return fail('split-patch-unbounded',
        'The negative piece has no boundary loop and no compact support to bound it.',
        {surfaceId:surface.id, side:'negative'});

    var detail = {appendSection:false, analyticLoops:true,
      sectionArcCount:sectionSplit.arcs.length};
    var positive = splitPiece(surface, positiveLoops, cut, spec, 1, detail);
    var negative = splitPiece(surface, negativeLoops, cut, spec, -1, detail);
    var result = {kind:'split', surfaceId:surface.id === undefined ? null : surface.id,
      plane:{origin:copyPoint(spec.origin), normal:copyPoint(spec.normal)},
      section:cut, sectionArcs:sectionSplit.arcs,
      sectionArcCount:sectionSplit.arcs.length,
      positive:positive, negative:negative, surfaces:[positive, negative]};
    stampModelIdentity(result);
    return {ok:true, result:result};
  }








  function torusSplitPlan(surface, plane, geometry) {
    function fail(code, message, detail) {
      var diagnostic = {code:code, message:message};
      Object.keys(detail || {}).forEach(function (k) { diagnostic[k] = detail[k]; });
      return {ok:false, diagnostic:diagnostic};
    }
    var spec = planeSpec(plane);
    if (!spec) return fail('split-plane-invalid', 'The cutting plane needs a finite origin and unit-able normal.');
    if (!finite(surface.center) || !finite(surface.axis))
      return fail('split-torus-invalid', 'The torus needs a finite centre and axis.', {surfaceId:surface.id});
    if ((surface.loops || []).length || surface.domain)
      return fail('split-torus-patch-unsupported',
        'Only a closed torus can be split; a bounded torus patch already has a parameter domain.',
        {surfaceId:surface.id});
    if (surface.closed !== true)
      return fail('split-surface-unbounded',
        'The torus is neither closed nor bounded by a parameter domain.', {surfaceId:surface.id});
    var axis = unit(surface.axis), frame = basis(axis);
    var cut;
    try { cut = section(surface, spec); }
    catch (err) { return fail('split-section-failed',
      'The section of ' + surface.id + ' by the cutting plane failed: ' + (err && err.message || err)); }
    var nAxis = dot(spec.normal, axis);
    if (!cut) {
      if (Math.abs(nAxis) > 1e-7 && Math.abs(Math.abs(nAxis) - 1) > 1e-7)
        return fail('split-torus-plane-oblique',
          'An oblique plane meets a torus in a quartic curve; that split is not implemented.',
          {surfaceId:surface.id, axisDotNormal:nAxis});
      return fail('split-section-missing', 'The cutting plane does not meet ' + surface.id + '.',
        {surfaceId:surface.id});
    }
    if (cut.kind === 'circle' || cut.kind === 'point' || cut.kind === 'points')
      return fail('split-torus-tangent',
        'A plane tangent to the tube does not split the torus into two bounded pieces.',
        {surfaceId:surface.id});
    if (cut.kind !== 'circles' && Math.abs(nAxis) > 1e-7 && Math.abs(Math.abs(nAxis) - 1) > 1e-7)
      return fail('split-torus-plane-oblique',
        'An oblique plane meets a torus in a quartic curve; that split is not implemented.',
        {surfaceId:surface.id, axisDotNormal:nAxis});
    if (cut.kind !== 'circles' || !cut.circles || cut.circles.length !== 2)
      return fail('split-torus-section-unsupported',
        'Splitting a torus needs two circular section loops from a perpendicular or axis-containing plane.',
        {surfaceId:surface.id, sectionKind:cut.kind});
    var circles = cut.circles;
    if (!circles.every(validCurve))
      return fail('split-section-invalid', 'The torus section is not a valid analytic circle pair.',
        {surfaceKind:'torus'});
    circles.forEach(function (circle) { boundaryElementId(circle, 'section'); });

    var R = surface.majorRadius, r = surface.minorRadius;
    function pointAt(u, v) {
      var radial = R + r * Math.cos(v), axial = r * Math.sin(v);
      return add(surface.center, add(add(mul(frame.u, Math.cos(u) * radial),
        mul(frame.v, Math.sin(u) * radial)), mul(axis, axial)));
    }
    function piece(domain, sign, mode) {
      var out = {};
      Object.keys(surface).forEach(function (k) {
        if (k !== 'loops' && k !== 'domain' && k !== 'closed') out[k] = surface[k];
      });
      out.id = (surface.id || 'surface') + '/split:' + (sign > 0 ? 'positive' : 'negative');
      out.loops = circles.map(function (circle) { return {kind:'outer', section:circle}; });
      out.domain = {u:domain.u.slice(), v:domain.v.slice()};
      out.closed = false;
      out.parentSurfaceId = surface.id === undefined ? null : surface.id;
      out.splitBy = {surfaceId:out.parentSurfaceId,
        plane:{origin:copyPoint(spec.origin), normal:copyPoint(spec.normal)},
        sectionKind:'circles', side:sign > 0 ? 'positive' : 'negative', torusSplit:mode};
      out.sourceIds = Array.from(new Set((surface.sourceIds || [])
        .concat(circles[0].sourceIds || [], circles[1].sourceIds || [])));
      return out;
    }
    var tol = surfaceTolerance(surface);
    var domains, mode;
    if (Math.abs(Math.abs(nAxis) - 1) <= 1e-7) {
      var axial = dot(sub(spec.origin, surface.center), axis);
      if (Math.abs(axial) >= r - tol)
        return fail('split-torus-tangent',
          'A plane tangent to the tube does not split the torus into two bounded pieces.',
          {surfaceId:surface.id, axial:axial});
      var half = Math.sqrt(Math.max(0, r*r - axial*axial));
      var v0 = Math.atan2(axial, half), v1 = Math.atan2(axial, -half);
      if (v1 <= v0) v1 += TAU;
      var first = {u:[0, TAU], v:[v0, v1]}, second = {u:[0, TAU], v:[v1, v0 + TAU]};


      domains = nAxis > 0 ? {positive:first, negative:second} :
        {positive:second, negative:first};
      mode = 'perpendicular-plane';
    } else if (Math.abs(nAxis) <= 1e-7) {
      if (Math.abs(dot(spec.normal, sub(surface.center, spec.origin))) > tol)
        return fail('split-torus-plane-offset',
          'A plane parallel to the torus axis must pass through the centre to produce circular sections.',
          {surfaceId:surface.id});
      var radial = sub(circles[0].center, surface.center);
      var u0 = Math.atan2(dot(radial, frame.v), dot(radial, frame.u));
      var arcOne = {u:[u0, u0 + Math.PI], v:[0, TAU]};
      var arcTwo = {u:[u0 + Math.PI, u0 + TAU], v:[0, TAU]};
      var mid = pointAt(u0 + Math.PI/2, 0);
      var firstPositive = dot(spec.normal, sub(mid, spec.origin)) > 0;
      domains = firstPositive ? {positive:arcOne, negative:arcTwo} :
        {positive:arcTwo, negative:arcOne};
      mode = 'axis-plane';
    } else {
      return fail('split-torus-plane-oblique',
        'An oblique plane meets a torus in a quartic curve; that split is not implemented.',
        {surfaceId:surface.id, axisDotNormal:nAxis});
    }
    var positive = piece(domains.positive, 1, mode);
    var negative = piece(domains.negative, -1, mode);
    var result = {kind:'split', surfaceId:surface.id === undefined ? null : surface.id,
      plane:{origin:copyPoint(spec.origin), normal:copyPoint(spec.normal)},
      section:cut, positive:positive, negative:negative,
      surfaces:[positive, negative]};
    stampModelIdentity(result);
    return {ok:true, result:result};
  }


  function splitPlan(surface, plane, geometry) {
    function fail(code, message, detail) {
      var diagnostic = {code:code, message:message};
      Object.keys(detail || {}).forEach(function (k) { diagnostic[k] = detail[k]; });
      return {ok:false, diagnostic:diagnostic};
    }
    if (!surface || !surface.kind) return fail('split-surface-missing',
      'split needs a surface record with an analytic kind.');
    if (surface.kind === 'plane') return fail('split-plane-surface-unsupported',
      'Splitting a bounded planar face is not implemented; use the loop splitter instead.',
      {surfaceKind:'plane'});
    if (surface.kind === 'torus') return torusSplitPlan(surface, plane, geometry);
    if (surface.kind !== 'cylinder' && surface.kind !== 'cone' && surface.kind !== 'sphere')
      return fail('split-surface-kind-unsupported',
        'The surface kind "' + surface.kind + '" has no split operation.', {surfaceKind:surface.kind});
    var spec = planeSpec(plane);
    if (!spec) return fail('split-plane-invalid', 'The cutting plane needs a finite origin and unit-able normal.');
    var cut;
    try { cut = section(surface, spec); }
    catch (err) { return fail('split-section-failed',
      'The section of ' + surface.id + ' by the cutting plane failed: ' + (err && err.message || err)); }
    if (!cut) return fail('split-section-missing',
      'The cutting plane does not meet ' + surface.id + '.');
    if (cut.kind !== 'circle' && cut.kind !== 'ellipse')
      return fail('split-section-not-closed',
        'Only a closed circle or ellipse section can split a surface.', {sectionKind:cut.kind});
    if (!validCurve(cut)) return fail('split-section-invalid',
      'The section is not a valid analytic circle or ellipse.', {sectionKind:cut.kind});
    boundaryElementId(cut, 'section');
    var sr = radii(cut);
    if (!(sr.u > EPS) || !(sr.v > EPS)) return fail('split-section-degenerate',
      'The section has zero radius and cannot bound two patches.', {sectionKind:cut.kind});

    var curves = geometry && geometry.curves || [];
    var vertices = geometry && geometry.vertices || [];
    var positiveLoops = [], negativeLoops = [], positiveRetained = 0, negativeRetained = 0;
    var loopSides = [], crossing = false;
    var loops = surface.loops || [];
    if (!loops.length && !(surface.kind === 'sphere' && surface.closed === true))
      return fail('split-surface-unbounded',
        'The input surface has neither a boundary loop nor closed compact support.',
        {surfaceId:surface.id});
    for (var i = 0; i < loops.length; i++) {
      var loop = loops[i];
      if (!loopValid(loop, curves, vertices))
        return fail('split-boundary-invalid',
          'Boundary loop ' + i + ' of ' + surface.id + ' references a missing or invalid element.',
          {loopIndex:i});
      var side = loopSide(loop, spec, curves, vertices);
      if (side === 0) return fail('split-loop-on-plane',
        'Boundary loop ' + i + ' lies in the cutting plane and cannot be assigned to one side.',
        {loopIndex:i, side:'plane'});
      loopSides.push(side);
      if (side === 2) { crossing = true; continue; }
      if (side > 0) { positiveLoops.push(loop); positiveRetained++; }
      else { negativeLoops.push(loop); negativeRetained++; }
    }



    if (crossing) return crossingSplitPlan(surface, spec, cut, geometry, loops, loopSides);

    if (surface.kind === 'sphere' && loops.length) {
      var capCheck = sphereCapContainsCut(surface, spec, cut);
      if (!capCheck.ok) {
        if (capCheck.reason === 'unknown') return fail('split-sphere-cap-unknown',
          'A bounded sphere patch without recess cap metadata has an ambiguous material side.',
          {surfaceId:surface.id});
        if (capCheck.reason === 'oblique') return fail('split-section-outside-patch',
          'An oblique section circle is not wholly inside the spherical cap patch.',
          {surfaceId:surface.id, reason:'oblique'});
        return fail('split-section-outside-patch',
          'The section circle is not strictly between the cap pole and its mouth loop.',
          {surfaceId:surface.id, reason:'outside'});
      }
    }

    if (!splitSideBounded(surface, positiveRetained, spec, 1))
      return fail('split-patch-unbounded',
        'The positive piece has no retained boundary loop and no compact support to bound it.',
        {surfaceId:surface.id, side:'positive'});
    if (!splitSideBounded(surface, negativeRetained, spec, -1))
      return fail('split-patch-unbounded',
        'The negative piece has no retained boundary loop and no compact support to bound it.',
        {surfaceId:surface.id, side:'negative'});

    var positive = splitPiece(surface, positiveLoops, cut, spec, 1);
    var negative = splitPiece(surface, negativeLoops, cut, spec, -1);
    var result = {kind:'split', surfaceId:surface.id === undefined ? null : surface.id,
      plane:{origin:copyPoint(spec.origin), normal:copyPoint(spec.normal)},
      section:cut, positive:positive, negative:negative,
      surfaces:[positive, negative]};
    stampModelIdentity(result);
    return {ok:true, result:result};
  }





  function split(surface, plane, geometry, diagnostics) {
    var plan = splitPlan(surface, plane, geometry);
    if (!plan.ok) {
      if (Array.isArray(diagnostics) && plan.diagnostic) diagnostics.push(plan.diagnostic);
      return null;
    }
    return plan.result;
  }



  function splitDiagnostic(surface, plane, geometry) {
    var plan = splitPlan(surface, plane, geometry);
    return plan.ok ? null : plan.diagnostic;
  }

  function loopReferencesCurve(loop, boundary, curves) {
    if (loop.section === boundary) return true;
    if ((loop.elements || []).some(function (el) { return el && el.curve === boundary; })) return true;
    if ((loop.lines || []).indexOf(boundary) !== -1) return true;
    return (loop.curves || []).some(function (i) {
      return (typeof i === 'object' && i ? i : curves[i]) === boundary;
    });
  }







  function attachBoundary(surface, boundary, geometry, diagnostics) {
    function fail(code, message) {
      if (Array.isArray(diagnostics)) diagnostics.push({code:code, message:message});
      return null;
    }
    if (!surface || !surface.kind) return fail('attach-surface-missing',
      'attachBoundary needs a surface record.');
    var isLine = !!boundary && typeof boundary === 'object' && boundary.kind === 'line';
    if (isLine ? !validLine(boundary) : !boundary || typeof boundary !== 'object' || !validCurve(boundary))
      return fail('attach-boundary-invalid',
        isLine ? 'attachBoundary needs a finite nonzero line segment.' :
          'attachBoundary needs a finite analytic circle or ellipse.');
    var start = isLine ? 0 : Number.isFinite(boundary.startAngle) ? boundary.startAngle : 0;
    var sweep = isLine ? 0 : Number.isFinite(boundary.sweepAngle) ? boundary.sweepAngle : TAU;
    if (!isLine && sweep < TAU - 1e-9) return fail('attach-boundary-open',
      'attachBoundary needs a full closed curve, not an arc.');
    boundaryElementId(boundary, isLine ? 'line' : 'section');
    var curves = geometry && geometry.curves || [];
    var loops = surface.loops || [];
    if (loops.some(function (loop) { return loopReferencesCurve(loop, boundary, curves); }))
      return fail('attach-boundary-duplicate',
        'The surface already uses this boundary object.');
    var tol = surfaceTolerance(surface);
    if (isLine) {
      var offSurface = false;
      [boundary.start, linePoint(boundary, 0.5), boundary.end].forEach(function (p) {
        var residual = surfaceResidual(surface, p);
        if (!Number.isFinite(residual) || residual > tol) offSurface = true;
      });
      if (offSurface) return fail('attach-boundary-off-surface',
        'The line boundary does not lie on ' + surface.id + '.');
    } else {
      for (var k = 0; k <= 16; k++) {
        var point = curvePoint(boundary, start + sweep*k/16);
        var residual = surfaceResidual(surface, point);
        if (!Number.isFinite(residual) || residual > tol)
          return fail('attach-boundary-off-surface',
            'The boundary curve does not lie on ' + surface.id + '.');
      }
    }
    var out = {};
    Object.keys(surface).forEach(function (key) { out[key] = surface[key]; });
    out.id = (surface.id || 'surface') + '/attach:' + loops.length;
    out.loops = loops.slice();
    out.loops.push(isLine ? {kind:'outer', lines:[boundary]} : {kind:'outer', section:boundary});
    out.closed = false;


    delete out.cap;
    out.parentSurfaceId = surface.id === undefined ? null : surface.id;
    out.attachedBoundary = {kind:isLine ? 'line' : (boundary.kind || 'curve'), closed:!isLine,
      loopIndex:out.loops.length - 1};
    out.sourceIds = Array.from(new Set((surface.sourceIds || []).concat(boundary.sourceIds || [])));
    return out;
  }



  function shareBoundary(a, b, boundary, geometry, diagnostics) {
    if (!a || !b || a === b) {
      if (Array.isArray(diagnostics)) diagnostics.push({code:'share-surfaces-invalid',
        message:'shareBoundary needs two distinct surface records.'});
      return null;
    }
    var first = attachBoundary(a, boundary, geometry, diagnostics);
    if (!first) return null;
    var second = attachBoundary(b, boundary, geometry, diagnostics);
    if (!second) return null;
    return {boundary:boundary, surfaces:[first, second]};
  }




  function intersectionCurves(result) {
    if (!result || typeof result !== 'object') return null;
    var components = null;
    if (result.kind === 'circle' || result.kind === 'ellipse') components = [result];
    else if (result.kind === 'circles' && Array.isArray(result.circles)) components = result.circles;
    if (!components) return null;
    var promoted = components.map(function (c) {
      if (!c || !finite(c.center) || !finite(c.u) || !finite(c.v)) return null;
      var curve = {kind:c.kind || (result.kind === 'ellipse' ? 'ellipse' : 'circle'),
        center:copyPoint(c.center), u:copyPoint(c.u), v:copyPoint(c.v)};
      if (c.radiusU !== undefined || c.radiusV !== undefined) {
        curve.radiusU = c.radiusU === undefined ? c.radius : c.radiusU;
        curve.radiusV = c.radiusV === undefined ? c.radius : c.radiusV;
      } else curve.radius = c.radius;
      if (!validCurve(curve)) return null;
      boundaryElementId(curve, 'section');
      curve.closed = true;
      curve.startAngle = 0;
      curve.sweepAngle = TAU;
      curve.promoted = 'intersection';
      curve.intersection = {kind:result.kind, relation:result.relation,
        surfaceIds:(result.surfaceIds || []).slice(),
        surfaceKinds:(result.surfaceKinds || []).slice()};
      if (Array.isArray(c.sourceIds) && c.sourceIds.length) curve.sourceIds = c.sourceIds.slice();
      return curve;
    }).filter(Boolean);
    return promoted.length ? promoted : null;
  }

  return {
    build:build,
    validate:validate,
    certify:certify,
    incidence:incidence,
    topology:topology,
    featureGraph:featureGraph,
    silhouettes:silhouettes,
    silhouetteHLR:silhouetteHLR,
    summarize:summarize,
    section:section,
    intersect:intersect,
    trim:trim,
    split:split,
    splitDiagnostic:splitDiagnostic,
    attachBoundary:attachBoundary,
    shareBoundary:shareBoundary,
    intersectionCurves:intersectionCurves,
    intersectBounded:intersectBounded,
    implicitEquation:implicitEquation,
    implicitLineIntervals:implicitLineIntervals,
    cavityTrims:cavityTrims,
    circleInPlanarFace:circleInPlanarFace,
    trimCurveInsideVolume:trimCurveInsideVolume,
    trimLineInsideVolume:trimLineInsideVolume,
    classifyPoint:classifyPoint,
    surfaceNormal:surfaceNormalAt,
    planarBoolean:planarBoolean,
    subtractContainedLoop:subtractContainedLoop,
    syncDisplayHoles:syncDisplayHoles,
    planeSpec:planeSpec,
    point:curvePoint,
    torusParameters:torusParameters,
    radii:radii,
    curveNormal:curveNormal,
    tolerancePolicy:tolerancePolicy,
    toleranceContract:TOLERANCE_CONTRACT
  };
});

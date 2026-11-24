(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-planar.js'));
  else root.EduCADCavityBoolean = factory(root.EduCADPlanar);
})(typeof window !== 'undefined' ? window : globalThis, function (Planar) {
  'use strict';

  var TAU = 2 * Math.PI;

  function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
  function cross(a, b) { return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x}; }
  function sub(a, b) { return {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}; }
  function add(a, b) { return {x:a.x+b.x, y:a.y+b.y, z:a.z+b.z}; }
  function mul(a, s) { return {x:a.x*s, y:a.y*s, z:a.z*s}; }
  function len(v) { return Math.hypot(v.x, v.y, v.z); }
  function unit(v) {
    var l = len(v);
    return l > 1e-12 ? {x:v.x/l, y:v.y/l, z:v.z/l} : {x:0, y:1, z:0};
  }
  function neg(v) { return {x:-v.x, y:-v.y, z:-v.z}; }
  function finite(v) { return v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z); }

  function basis(axis) {
    var n = unit(axis);
    var ref = Math.abs(n.x) < 0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0};
    var u = unit(cross(n, ref));
    return {u:u, v:unit(cross(n, u))};
  }

  function extentOf(volumes) {
    var scale = 1;
    (volumes || []).forEach(function (v) {
      scale = Math.max(scale, Math.abs(v.radius || 0), Math.abs(v.bottomRadius || 0),
        Math.abs(v.depth || 0), Math.abs(v.mouthRadius || 0));
      if (v.kind === 'sphere' && Number.isFinite(v.capAngle))
        scale = Math.max(scale, Math.abs(v.radius || 0) * Math.sin(v.capAngle));
    });
    return scale;
  }

  function volumeTolerance(volumes) {
    return 1e-7 * extentOf(volumes);
  }

  function angleTolerance(volumes) {
    return 1e-7;
  }

  function cylinderPoint(volume, angle, station) {
    var frame = basis(volume.axis);
    return add(add(volume.origin, mul(volume.axis, station)),
      add(mul(frame.u, Math.cos(angle) * volume.radius),
        mul(frame.v, Math.sin(angle) * volume.radius)));
  }

  function perpendicularBoreJunction(a, b) {
    if (![a, b].every(function (volume) {
      return volume && volume.kind === 'cylinder' && !volume.through &&
        finite(volume.origin) && finite(volume.axis) && len(volume.axis) > 1e-12 &&
        Number.isFinite(volume.radius) && volume.radius > 0 &&
        Number.isFinite(volume.depth) && volume.depth > 0;
    })) return null;

    var larger = a.radius > b.radius ? a : b;
    var smaller = larger === a ? b : a;
    var tolerance = 1e-9 * extentOf([larger, smaller]);
    if (larger.radius - smaller.radius <= tolerance) return null;

    var largerAxis = unit(larger.axis), smallerAxis = unit(smaller.axis);
    if (Math.abs(dot(largerAxis, smallerAxis)) > 1e-12) return null;
    var outward = neg(smallerAxis);
    var across = unit(cross(largerAxis, outward));
    var betweenMouths = sub(smaller.origin, larger.origin);
    if (Math.abs(dot(betweenMouths, across)) > tolerance) return null;

    var largerStation = dot(betweenMouths, largerAxis);
    var smallerStation = dot(betweenMouths, outward);
    var radius = smaller.radius, otherRadius = larger.radius;
    var smallerFloorOffset = smaller.depth - smallerStation;
    var maxLargerStation = largerStation + radius;
    var innerReach = Math.sqrt((otherRadius - radius) * (otherRadius + radius));
    if (largerStation - radius <= tolerance ||
        maxLargerStation > larger.depth + tolerance ||
        smallerStation - otherRadius <= tolerance ||
        Math.abs(smallerFloorOffset) >= innerReach - tolerance) return null;

    var floorContact = Math.abs(maxLargerStation - larger.depth) <= tolerance;
    return {
      larger: larger.index,
      smaller: smaller.index,
      floorContact: floorContact,
      curve: {
        kind: 'cylinder-intersection',
        origin: add(larger.origin, mul(largerAxis, largerStation)),
        u: across,
        v: largerAxis,
        direction: outward,
        radius: radius,
        otherRadius: otherRadius,
        startAngle: floorContact ? Math.PI / 2 : 0,
        sweepAngle: TAU
      }
    };
  }

  function junctionPoint(curve, angle) {
    var across = curve.radius * Math.cos(angle);
    var axial = curve.radius * Math.sin(angle);
    var along = Math.sqrt((curve.otherRadius - across) * (curve.otherRadius + across));
    return add(add(curve.origin, mul(curve.u, across)),
      add(mul(curve.v, axial), mul(curve.direction, along)));
  }

  function bottomRadiusOf(volume) {
    return Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : volume.radius;
  }

  function axialRadius(volume, station) {
    var start = volume.radius, end = bottomRadiusOf(volume);
    if (volume.kind !== 'cone') return start;
    if (!(volume.depth > 0)) return start;
    var fraction = station / volume.depth;
    if (fraction < 0) fraction = 0;
    else if (fraction > 1) fraction = 1;
    return start + (end - start) * fraction;
  }

  function coneApexPoint(volume) {
    var start = volume.radius, end = bottomRadiusOf(volume);
    if (Math.abs(start - end) <= 1e-12) return null;
    return add(volume.origin, mul(unit(volume.axis), volume.depth * start / (start - end)));
  }

  function coneHalfAngle(volume) {
    if (volume.kind !== 'cone') return 0;
    return Math.atan2(Math.abs(bottomRadiusOf(volume) - volume.radius), volume.depth);
  }

  function sphereCapPoint(volume, angle, theta) {
    var frame = basis(volume.pole);
    var radial = add(mul(frame.u, Math.cos(angle)), mul(frame.v, Math.sin(angle)));
    return add(add(volume.center, mul(volume.pole, volume.radius * Math.cos(theta))),
      mul(radial, volume.radius * Math.sin(theta)));
  }

  function orient(face, vertices, wanted) {
    var a = vertices[face[0]], b = vertices[face[1]], c = vertices[face[2]];
    var n = cross(sub(b, a), sub(c, a));
    if (dot(n, wanted) < 0) face.reverse();
    return face;
  }

  function buildVolumeMesh(volume, segments) {
    var n = segments || 24;
    if (volume.kind === 'cylinder') return buildCylinderMesh(volume, n);
    if (volume.kind === 'cone') return buildConeMesh(volume, n);
    if (volume.kind === 'sphere') return buildSphereMesh(volume, n);
    return null;
  }

  function buildCylinderMesh(volume, n) {
    var frame = basis(volume.axis);
    var vertices = [], faces = [], i;
    var mouthRing = [], bottomRing = [];
    for (i = 0; i < n; i++) {
      var t = TAU * i / n;
      var radial = add(mul(frame.u, Math.cos(t) * volume.radius),
        mul(frame.v, Math.sin(t) * volume.radius));
      mouthRing.push(vertices.length);
      vertices.push(add(volume.origin, radial));
      bottomRing.push(vertices.length);
      vertices.push(add(add(volume.origin, mul(volume.axis, volume.depth)), radial));
    }
    var sideDirection = {x:0, y:0, z:0};
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var centroid = mul(add(add(vertices[mouthRing[i]], vertices[mouthRing[j]]),
        add(vertices[bottomRing[j]], vertices[bottomRing[i]])), 0.25);
      var q = sub(centroid, volume.origin);
      var axial = dot(q, volume.axis);
      var radialCentre = sub(q, mul(volume.axis, axial));
      var face = orient([mouthRing[i], mouthRing[j], bottomRing[j], bottomRing[i]],
        vertices, radialCentre);
      faces.push({vertices:face, tag:{volume:volume.index, role:'side'},
        plane:planeOf(face, vertices)});
      sideDirection = add(sideDirection, unit(radialCentre));
    }
    var mouthCentre = vertices.length;
    vertices.push(volume.origin);
    var bottomCentre = vertices.length;
    vertices.push(add(volume.origin, mul(volume.axis, volume.depth)));
    for (i = 0; i < n; i++) {
      var j2 = (i + 1) % n;
      var mouthFace = orient([mouthCentre, mouthRing[i], mouthRing[j2]], vertices, neg(volume.axis));
      faces.push({vertices:mouthFace, tag:{volume:volume.index, role:'mouth'},
        plane:planeOf(mouthFace, vertices)});
      var bottomFace = orient([bottomCentre, bottomRing[j2], bottomRing[i]], vertices, volume.axis);
      faces.push({vertices:bottomFace, tag:{volume:volume.index, role:'bottom'},
        plane:planeOf(bottomFace, vertices)});
    }
    return {vertices:vertices, faces:faces, frame:frame};
  }

  function buildConeMesh(volume, n) {
    var frame = basis(volume.axis);
    var radius = volume.radius, bottom = bottomRadiusOf(volume);
    var vertices = [], faces = [], i;
    var mouthRing = [], bottomRing = [], apexIndex = null;
    for (i = 0; i < n; i++) {
      var t = TAU * i / n;
      var mouthRadial = add(mul(frame.u, Math.cos(t) * radius),
        mul(frame.v, Math.sin(t) * radius));
      mouthRing.push(vertices.length);
      vertices.push(add(volume.origin, mouthRadial));
      if (bottom > 1e-12) {
        var bottomRadial = add(mul(frame.u, Math.cos(t) * bottom),
          mul(frame.v, Math.sin(t) * bottom));
        bottomRing.push(vertices.length);
        vertices.push(add(add(volume.origin, mul(volume.axis, volume.depth)), bottomRadial));
      }
    }
    if (!(bottom > 1e-12)) {
      apexIndex = vertices.length;
      vertices.push(add(volume.origin, mul(volume.axis, volume.depth)));
    }
    for (i = 0; i < n; i++) {
      var j = (i + 1) % n;
      var loop = apexIndex !== null ? [mouthRing[i], mouthRing[j], apexIndex] :
        [mouthRing[i], mouthRing[j], bottomRing[j], bottomRing[i]];
      var p0 = vertices[loop[0]], p1 = vertices[loop[1]], p2 = vertices[loop[2]];
      var normal = cross(sub(p1, p0), sub(p2, p0));
      var centroid = {x:0, y:0, z:0};
      loop.forEach(function (index) {
        var p = vertices[index];
        centroid.x += p.x / loop.length;
        centroid.y += p.y / loop.length;
        centroid.z += p.z / loop.length;
      });
      var q = sub(centroid, volume.origin);
      var axial = dot(q, volume.axis);
      var radialCentre = sub(q, mul(volume.axis, axial));
      if (dot(normal, radialCentre) < 0) loop.reverse();
      faces.push({vertices:loop, tag:{volume:volume.index, role:'side'},
        plane:planeOf(loop, vertices)});
    }
    var mouthCentre = vertices.length;
    vertices.push(volume.origin);
    for (i = 0; i < n; i++) {
      var jm = (i + 1) % n;
      var mouthFace = orient([mouthCentre, mouthRing[i], mouthRing[jm]], vertices, neg(volume.axis));
      faces.push({vertices:mouthFace, tag:{volume:volume.index, role:'mouth'},
        plane:planeOf(mouthFace, vertices)});
    }
    if (bottom > 1e-12) {
      var bottomCentre = vertices.length;
      vertices.push(add(volume.origin, mul(volume.axis, volume.depth)));
      for (i = 0; i < n; i++) {
        var jb = (i + 1) % n;
        var bottomFace = orient([bottomCentre, bottomRing[jb], bottomRing[i]], vertices, volume.axis);
        faces.push({vertices:bottomFace,
          tag:{volume:volume.index, role:volume.openBottom === true ? 'mouth' : 'bottom'},
          plane:planeOf(bottomFace, vertices)});
      }
    }
    return {vertices:vertices, faces:faces, frame:frame, apex:apexIndex};
  }

  function buildSphereMesh(volume, n) {
    var frame = basis(volume.pole);
    var rings = Math.max(2, Math.ceil(6 * volume.capAngle / Math.PI));
    var vertices = [], faces = [], i, j;
    var poleIndex = vertices.length;
    vertices.push(add(volume.center, mul(volume.pole, volume.radius)));
    var ringIndices = [];
    for (i = 1; i <= rings; i++) {
      var theta = volume.capAngle * i / rings;
      var ring = [];
      for (j = 0; j < n; j++) {
        var t = TAU * j / n;
        var radial = add(mul(frame.u, Math.cos(t)), mul(frame.v, Math.sin(t)));
        ring.push(vertices.length);
        vertices.push(add(add(volume.center, mul(volume.pole, volume.radius * Math.cos(theta))),
          mul(radial, volume.radius * Math.sin(theta))));
      }
      ringIndices.push(ring);
    }
    function capFace(a, b, c) {
      var centroid = mul(add(add(vertices[a], vertices[b]), vertices[c]), 1/3);
      var outward = sub(centroid, volume.center);
      var face = orient([a, b, c], vertices, outward);
      faces.push({vertices:face, tag:{volume:volume.index, role:'cap'},
        plane:planeOf(face, vertices)});
    }
    var first = ringIndices[0];
    for (j = 0; j < n; j++) capFace(poleIndex, first[j], first[(j+1)%n]);
    for (i = 0; i < rings-1; i++) {
      var A = ringIndices[i], B = ringIndices[i+1];
      for (j = 0; j < n; j++) {
        var a = A[j], b = A[(j+1)%n], c = B[j], d = B[(j+1)%n];
        capFace(a, b, c);
        capFace(b, d, c);
      }
    }
    var boundary = ringIndices[rings-1];
    var mouthCentre = vertices.length;
    vertices.push(volume.mouthCenter);
    var outward = volume.outward;
    for (j = 0; j < n; j++) {
      var f = orient([mouthCentre, boundary[(j+1)%n], boundary[j]], vertices, outward);
      faces.push({vertices:f, tag:{volume:volume.index, role:'mouth'},
        plane:planeOf(f, vertices)});
    }
    return {vertices:vertices, faces:faces, frame:frame};
  }

  function planeOf(face, vertices) {
    var a = vertices[face[0]], b = vertices[face[1]], c = vertices[face[2]];
    var normal = unit(cross(sub(b, a), sub(c, a)));
    return {normal:normal, w:dot(normal, a)};
  }

  function polygonArea(points) {
    var total = {x:0, y:0, z:0};
    for (var i = 1; i + 1 < points.length; i++)
      total = add(total, cross(sub(points[i], points[0]), sub(points[i+1], points[0])));
    return len(total) / 2;
  }

  function splitPolygon(polygon, plane, epsilon, front, back, coplanarFront, coplanarBack) {
    var types = [], polygonType = 0, i;
    for (i = 0; i < polygon.vertices.length; i++) {
      var d = dot(plane.normal, polygon.vertices[i]) - plane.w;
      types[i] = d < -epsilon ? 0 : d > epsilon ? 1 : 2;
      polygonType |= types[i];
    }
    if (types.every(function (t) { return t === 2; })) {
      if (dot(plane.normal, polygon.plane.normal) >= 0) coplanarFront.push(polygon);
      else coplanarBack.push(polygon);
      return;
    }
    var f = [], b = [];
    for (i = 0; i < polygon.vertices.length; i++) {
      var j = (i + 1) % polygon.vertices.length;
      var ti = types[i], tj = types[j];
      var vi = polygon.vertices[i], vj = polygon.vertices[j];
      if (ti !== 0) f.push(vi);
      if (ti !== 1) b.push(ti === 2 ? vi : {x:vi.x, y:vi.y, z:vi.z});
      if ((ti === 0 && tj === 1) || (ti === 1 && tj === 0)) {
        var t = (plane.w - dot(plane.normal, vi)) / dot(plane.normal, sub(vj, vi));
        var v = add(vi, mul(sub(vj, vi), t));
        f.push(v);
        b.push({x:v.x, y:v.y, z:v.z});
      }
    }
    function fragment(points) {
      var cleaned = [];
      points.forEach(function (p) {
        if (!cleaned.length || len(sub(p, cleaned[cleaned.length-1])) > epsilon)
          cleaned.push(p);
      });
      if (cleaned.length > 1 && len(sub(cleaned[0], cleaned[cleaned.length-1])) <= epsilon)
        cleaned.pop();
      if (cleaned.length < 3 || polygonArea(cleaned) <= epsilon * epsilon) return null;
      return cleaned;
    }
    var frontFragment = fragment(f);
    var backFragment = fragment(b);
    if (frontFragment) front.push({vertices:frontFragment, plane:polygon.plane, tag:polygon.tag});
    if (backFragment) back.push({vertices:backFragment, plane:polygon.plane, tag:polygon.tag});
  }

  function Node(polygons, epsilon) {
    this.epsilon = epsilon;
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons && polygons.length) this.build(polygons);
  }
  Node.prototype.build = function (polygons) {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane;
    var front = [], back = [], coplanar = [];
    for (var i = 0; i < polygons.length; i++)
      splitPolygon(polygons[i], this.plane, this.epsilon, front, back, coplanar, coplanar);
    if (front.length) {
      if (!this.front) this.front = new Node(null, this.epsilon);
      this.front.build(front);
    }
    if (back.length) {
      if (!this.back) this.back = new Node(null, this.epsilon);
      this.back.build(back);
    }
    this.polygons = this.polygons.concat(coplanar);
  };
  Node.prototype.clipPolygons = function (polygons) {
    if (!this.plane) return polygons.slice();
    var front = [], back = [];
    for (var i = 0; i < polygons.length; i++)
      splitPolygon(polygons[i], this.plane, this.epsilon, front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    if (this.back) back = this.back.clipPolygons(back);
    else back = [];
    return front.concat(back);
  };
  Node.prototype.clipTo = function (bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  };
  Node.prototype.invert = function () {
    for (var i = 0; i < this.polygons.length; i++) {
      var p = this.polygons[i];
      p.vertices.reverse();
      p.plane = {normal:neg(p.plane.normal), w:-p.plane.w};
    }
    if (this.plane) this.plane = {normal:neg(this.plane.normal), w:-this.plane.w};
    if (this.front) this.front.invert();
    if (this.back) this.back.invert();
    var swap = this.front;
    this.front = this.back;
    this.back = swap;
  };
  Node.prototype.allPolygons = function () {
    var out = this.polygons.slice();
    if (this.front) out = out.concat(this.front.allPolygons());
    if (this.back) out = out.concat(this.back.allPolygons());
    return out;
  };

  function unionPolygons(a, b, epsilon) {
    if (!a.length) return b.slice();
    if (!b.length) return a.slice();
    var A = new Node(a, epsilon), B = new Node(b, epsilon);
    A.clipTo(B);
    B.clipTo(A);
    B.invert();
    B.clipTo(A);
    B.invert();
    A.build(B.allPolygons());
    return A.allPolygons();
  }

  function cleanPolygons(polygons, epsilon) {
    var out = [];
    polygons.forEach(function (polygon) {
      var points = [];
      polygon.vertices.forEach(function (p) {
        if (!points.length || len(sub(p, points[points.length-1])) > epsilon)
          points.push(p);
      });
      if (points.length > 1 && len(sub(points[0], points[points.length-1])) <= epsilon)
        points.pop();
      if (points.length < 3 || polygonArea(points) <= epsilon * epsilon) return;
      out.push({vertices:points, plane:polygon.plane, tag:polygon.tag});
    });
    return out;
  }

  function signedDistanceToVolume(volume, p) {
    if (volume.kind === 'cylinder') {
      var d = sub(p, volume.origin);
      var axial = dot(d, volume.axis);
      var radial = sub(d, mul(volume.axis, axial));
      var radialLength = len(radial);
      var outsideRadial = Math.max(0, radialLength - volume.radius);
      var outsideAxial = Math.max(0, -axial, axial - volume.depth);
      if (outsideRadial === 0 && outsideAxial === 0) {
        return -Math.min(volume.radius - radialLength, axial, volume.depth - axial);
      }
      return Math.hypot(outsideRadial, outsideAxial);
    }
    if (volume.kind === 'cone') {
      var axis = unit(volume.axis), d = sub(p, volume.origin);
      var axial = dot(d, axis);
      var radial = len(sub(d, mul(axis, axial)));
      var clamped = axial < 0 ? 0 : axial > volume.depth ? volume.depth : axial;
      var profile = axialRadius(volume, clamped);
      var outsideAxial = Math.max(0, -axial, axial - volume.depth);
      var lateral = (radial - profile) * Math.cos(coneHalfAngle(volume));
      if (outsideAxial === 0 && lateral <= 0)
        return -Math.min(-lateral, axial, volume.depth - axial);
      return Math.hypot(Math.max(0, lateral), outsideAxial);
    }
    if (volume.kind === 'sphere') {
      var distance = len(sub(p, volume.center));
      var sphereResidual = distance - volume.radius;
      var planeResidual = dot(sub(p, volume.mouthCenter), volume.outward);
      if (sphereResidual <= 0 && planeResidual <= 0)
        return -Math.min(-sphereResidual, -planeResidual);
      return Math.hypot(Math.max(0, sphereResidual), Math.max(0, planeResidual));
    }
    return Infinity;
  }

  function contains(volume, p, margin) {
    margin = margin || 0;
    if (volume.kind === 'cylinder') {
      var d = sub(p, volume.origin);
      var axial = dot(d, volume.axis);
      var radial = sub(d, mul(volume.axis, axial));
      return axial >= -margin && axial <= volume.depth + margin &&
        len(radial) <= volume.radius + margin;
    }
    if (volume.kind === 'cone') {
      var axis = unit(volume.axis), d = sub(p, volume.origin);
      var axial = dot(d, axis);
      if (axial < -margin || axial > volume.depth + margin) return false;
      var clamped = axial < 0 ? 0 : axial > volume.depth ? volume.depth : axial;
      return len(sub(d, mul(axis, axial))) <= axialRadius(volume, clamped) + margin;
    }
    if (volume.kind === 'sphere') {
      var distance = len(sub(p, volume.center));
      var plane = dot(sub(p, volume.mouthCenter), volume.outward);
      return distance <= volume.radius + margin && plane <= margin;
    }
    return false;
  }

  function simplifyPolygonVertices(polygons, epsilon) {
    return polygons.map(function (polygon) {
      var points = polygon.vertices.slice(), changed = true;
      while (changed && points.length > 3) {
        changed = false;
        for (var i = 0; i < points.length; i++) {
          var a = points[(i + points.length - 1) % points.length];
          var b = points[i];
          var c = points[(i + 1) % points.length];
          var ab = sub(b, a), bc = sub(c, b);
          if (len(cross(ab, bc)) <= epsilon * (len(ab) + len(bc)) + 1e-15) {
            points.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      return {vertices:points, plane:polygon.plane, tag:polygon.tag};
    });
  }

  function resolveTJunctions(polygons, epsilon) {
    var vertices = [], index = new Map();
    function key(p) {
      return [Math.round(p.x/epsilon), Math.round(p.y/epsilon), Math.round(p.z/epsilon)].join(',');
    }
    polygons.forEach(function (polygon) {
      polygon.vertices.forEach(function (p) {
        var k = key(p);
        if (!index.has(k)) {
          index.set(k, vertices.length);
          vertices.push(p);
        }
      });
    });
    var tolerance = epsilon * 4;
    return polygons.map(function (polygon) {
      var output = [];
      for (var i = 0; i < polygon.vertices.length; i++) {
        var a = polygon.vertices[i], b = polygon.vertices[(i + 1) % polygon.vertices.length];
        output.push(a);
        var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        var denominator = dx*dx + dy*dy + dz*dz;
        if (denominator <= 1e-24) continue;
        var insertions = [];
        vertices.forEach(function (p) {
          var t = ((p.x - a.x)*dx + (p.y - a.y)*dy + (p.z - a.z)*dz) / denominator;
          if (t <= 1e-7 || t >= 1 - 1e-7) return;
          var closest = {x:a.x + dx*t, y:a.y + dy*t, z:a.z + dz*t};
          if (len(sub(p, closest)) > tolerance) return;
          insertions.push({t:t, point:p});
        });
        insertions.sort(function (x, y) { return x.t - y.t; });
        var last = null;
        insertions.forEach(function (insertion) {
          if (last !== null && Math.abs(insertion.t - last) <= 1e-12) return;
          output.push(insertion.point);
          last = insertion.t;
        });
      }
      return {vertices:output, plane:polygon.plane, tag:polygon.tag};
    });
  }

  function supportCylinder(volume, direction) {
    var axis = unit(volume.axis), d = unit(direction);
    var axial = dot(d, axis);
    var station = axial > 0 ? volume.depth : axial < 0 ? 0 : volume.depth / 2;
    var radial = sub(d, mul(axis, axial));
    var radialDirection = len(radial) > 1e-12 ? unit(radial) : basis(axis).u;
    return add(add(volume.origin, mul(axis, station)), mul(radialDirection, volume.radius));
  }

  function supportCone(volume, direction) {
    var axis = unit(volume.axis), d = unit(direction);
    var axial = dot(d, axis);
    var radial = sub(d, mul(axis, axial));
    var radialLength = len(radial);
    var radialDirection = radialLength > 1e-12 ? unit(radial) : basis(axis).u;
    var mouthScore = volume.radius * radialLength;
    var bottomScore = volume.depth * axial + bottomRadiusOf(volume) * radialLength;
    var station = bottomScore > mouthScore ? volume.depth : 0;
    return add(add(volume.origin, mul(axis, station)),
      mul(radialDirection, axialRadius(volume, station)));
  }

  function supportSphere(volume, direction) {
    var d = unit(direction);
    var pole = unit(volume.pole), outward = unit(volume.outward);
    var sphere = add(volume.center, mul(d, volume.radius));
    if (dot(sub(sphere, volume.mouthCenter), outward) <= 0) return sphere;
    var tangent = sub(d, mul(outward, dot(d, outward)));
    if (len(tangent) > 1e-12)
      return add(volume.mouthCenter, mul(unit(tangent), volume.mouthRadius));
    return {x:volume.mouthCenter.x, y:volume.mouthCenter.y, z:volume.mouthCenter.z};
  }

  function support(volume, direction) {
    return volume.kind === 'cylinder' ? supportCylinder(volume, direction) :
      volume.kind === 'cone' ? supportCone(volume, direction) :
      volume.kind === 'sphere' ? supportSphere(volume, direction) : null;
  }

  function supportPair(a, b, direction) {
    var pa = support(a, direction), pb = support(b, neg(direction));
    return {w:sub(pa, pb), a:pa, b:pb};
  }

  function dot2(v) { return dot(v, v); }

  function closestSegment(a, b) {
    var ab = sub(b, a), denominator = dot2(ab);
    if (denominator <= 1e-24) return {point:a, indices:[0]};
    var t = -dot(a, ab) / denominator;
    if (t <= 0) return {point:a, indices:[0]};
    if (t >= 1) return {point:b, indices:[1]};
    return {point:add(a, mul(ab, t)), indices:[0, 1]};
  }

  function closestTriangle(a, b, c) {
    var ab = sub(b, a), ac = sub(c, a), ap = neg(a);
    var d1 = dot(ab, ap), d2 = dot(ac, ap);
    if (d1 <= 0 && d2 <= 0) return {point:a, indices:[0]};
    var bp = neg(b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) return {point:b, indices:[1]};
    var vc = d1*d4 - d3*d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
      var v = d1 / (d1 - d3);
      return {point:add(a, mul(ab, v)), indices:[0, 1]};
    }
    var cp = neg(c), d5 = dot(ab, cp), d6 = dot(ac, cp);
    if (d6 >= 0 && d5 <= d6) return {point:c, indices:[2]};
    var vb = d5*d2 - d1*d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
      var w = d2 / (d2 - d6);
      return {point:add(a, mul(ac, w)), indices:[0, 2]};
    }
    var va = d3*d6 - d5*d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
      var u = (d4 - d3) / ((d4 - d3) + (d5 - d6));
      return {point:add(b, mul(sub(c, b), u)), indices:[1, 2]};
    }
    var denominator = 1 / (va + vb + vc);
    var vv = vb * denominator, ww = vc * denominator;
    return {point:add(a, add(mul(ab, vv), mul(ac, ww))), indices:[0, 1, 2]};
  }

  function determinant3(a, b, c) {
    return dot(a, cross(b, c));
  }

  function closestTetrahedron(a, b, c, d) {
    var b0 = sub(b, a), c0 = sub(c, a), d0 = sub(d, a), origin = neg(a);
    var denominator = determinant3(b0, c0, d0);
    if (Math.abs(denominator) > 1e-18) {
      var u = determinant3(origin, c0, d0) / denominator;
      var v = determinant3(b0, origin, d0) / denominator;
      var w = determinant3(b0, c0, origin) / denominator;
      if (u >= 0 && v >= 0 && w >= 0 && u + v + w <= 1)
        return {point:{x:0, y:0, z:0}, indices:[0, 1, 2, 3], inside:true};
    }
    var faces = [
      {points:[a, b, c], indices:[0, 1, 2]},
      {points:[a, c, d], indices:[0, 2, 3]},
      {points:[a, d, b], indices:[0, 3, 1]},
      {points:[b, d, c], indices:[1, 3, 2]}
    ];
    var best = null;
    faces.forEach(function (face) {
      var closest = closestTriangle(face.points[0], face.points[1], face.points[2]);
      var distance = dot2(closest.point);
      if (!best || distance < best.distance)
        best = {point:closest.point, indices:closest.indices.map(function (i) { return face.indices[i]; }),
          distance:distance};
    });
    return best;
  }

  function closestSimplex(points) {
    if (points.length === 1) return {point:points[0], indices:[0]};
    if (points.length === 2) return closestSegment(points[0], points[1]);
    if (points.length === 3) return closestTriangle(points[0], points[1], points[2]);
    return closestTetrahedron(points[0], points[1], points[2], points[3]);
  }

  function separatingGap(a, b, direction) {
    var n = unit(direction);
    return dot(n, support(a, neg(n))) - dot(n, support(b, n));
  }

  function gjkSeparation(a, b, tolerance) {
    var simplex = [supportPair(a, b, {x:1, y:0, z:0})];
    var v = simplex[0].w;
    if (dot2(v) <= tolerance * tolerance) return {separated:false, distance:0};
    for (var iteration = 0; iteration < 512; iteration++) {
      var direction = neg(v);
      var next = supportPair(a, b, direction);
      var gap = separatingGap(a, b, v);
      if (gap > tolerance)
        return {separated:true, clearance:gap, distance:Math.sqrt(dot2(v))};
      var progress = dot2(v) - dot(v, next.w);
      var length = Math.sqrt(dot2(v));
      var converged = progress <= tolerance * Math.max(length, 1e-12);
      var duplicate = simplex.some(function (item) {
        return len(sub(item.w, next.w)) <= tolerance;
      });
      if (converged || duplicate)
        return {separated:false, distance:length};
      simplex.push(next);
      var closest = closestSimplex(simplex.map(function (item) { return item.w; }));
      if (closest.inside) return {separated:false, distance:0};
      simplex = closest.indices.map(function (i) { return simplex[i]; });
      v = closest.point;
      if (dot2(v) <= tolerance * tolerance) return {separated:false, distance:0};
    }
    var finalGap = separatingGap(a, b, v);
    if (finalGap > tolerance)
      return {separated:true, clearance:finalGap, distance:Math.sqrt(dot2(v))};
    return {separated:false, distance:Math.sqrt(dot2(v))};
  }

  function parallelAxialRelation(a, b, tolerance) {
    var axisA = unit(a.axis), axisB = unit(b.axis);
    var alignment = dot(axisA, axisB);
    var delta = sub(b.origin, a.origin);
    var axisDistance = len(sub(delta, mul(axisA, dot(delta, axisA))));
    var startB = dot(delta, axisA);
    var endB = startB + b.depth * alignment;
    var lowB = Math.min(startB, endB), highB = Math.max(startB, endB);
    var lowA = 0, highA = a.depth;
    var axialOverlap = Math.min(highA, highB) - Math.max(lowA, lowB);
    function radiusB(station) {
      var local = Math.abs(alignment) <= 1e-12 ? 0 : (station - startB) / alignment;
      return axialRadius(b, local);
    }
    function gapAt(station) {
      return axisDistance - axialRadius(a, station) - radiusB(station);
    }
    function covers(sourceLow, sourceHigh, targetLow, targetHigh, sourceRadius, targetRadius) {
      return sourceLow >= targetLow - tolerance && sourceHigh <= targetHigh + tolerance &&
        sourceRadius(sourceLow) + axisDistance <= targetRadius(sourceLow) + tolerance &&
        sourceRadius(sourceHigh) + axisDistance <= targetRadius(sourceHigh) + tolerance;
    }
    var result = {relation:'overlap', tolerance:tolerance, aInsideB:false, bInsideA:false,
      radialGap:null, axialOverlap:axialOverlap};
    var aInsideB = covers(lowA, highA, lowB, highB,
      function (s) { return axialRadius(a, s); }, radiusB);
    var bInsideA = covers(lowB, highB, lowA, highA,
      radiusB, function (s) { return axialRadius(a, s); });
    var duplicate = axisDistance <= tolerance &&
      Math.abs(lowA - lowB) <= tolerance && Math.abs(highA - highB) <= tolerance &&
      Math.abs(radiusB(lowA) - axialRadius(a, lowA)) <= tolerance &&
      Math.abs(radiusB(highA) - axialRadius(a, highA)) <= tolerance;
    if (duplicate) {
      result.relation = 'duplicate';
      result.aInsideB = true;
      result.bInsideA = true;
      return result;
    }
    if (aInsideB || bInsideA) {
      result.relation = 'contained';
      result.aInsideB = aInsideB;
      result.bInsideA = bInsideA;
      return result;
    }
    if (axialOverlap < -tolerance) {
      var radialGap = axisDistance - Math.max(a.radius, bottomRadiusOf(a)) -
        Math.max(b.radius, bottomRadiusOf(b));
      result.relation = 'separate';
      result.radialGap = radialGap;
      result.clearance = Math.hypot(Math.max(0, radialGap), Math.max(0, -axialOverlap));
      return result;
    }
    var low = Math.max(lowA, lowB), high = Math.min(highA, highB);
    var gapLow = gapAt(low), gapHigh = gapAt(high);
    var minGap = Math.min(gapLow, gapHigh);
    result.radialGap = minGap;
    if (minGap > tolerance) {
      result.relation = 'separate';
      result.clearance = minGap;
      return result;
    }
    if (minGap < -tolerance && axialOverlap > tolerance) {
      result.relation = 'overlap';
      return result;
    }
    result.relation = 'touch';
    return result;
  }

  function interiorWitness(a, b) {
    function strict(volume, p) { return contains(volume, p, 0); }
    var points = [];
    if (a.kind === 'cylinder') {
      var frame = basis(a.axis);
      [0.5, 0.25, 0.75].forEach(function (fraction) {
        points.push(add(a.origin, mul(a.axis, a.depth * fraction)));
        for (var i = 0; i < 32; i++) {
          var t = TAU * i / 32;
          var radial = add(mul(frame.u, Math.cos(t) * a.radius * 0.5),
            mul(frame.v, Math.sin(t) * a.radius * 0.5));
          points.push(add(add(a.origin, mul(a.axis, a.depth * fraction)), radial));
        }
      });
    } else if (a.kind === 'cone') {
      var frameCone = basis(a.axis);
      [0.5, 0.25, 0.75].forEach(function (fraction) {
        var station = a.depth * fraction;
        var radius = axialRadius(a, station) * 0.5;
        points.push(add(a.origin, mul(a.axis, station)));
        for (var i = 0; i < 32; i++) {
          var t = TAU * i / 32;
          var radial = add(mul(frameCone.u, Math.cos(t) * radius),
            mul(frameCone.v, Math.sin(t) * radius));
          points.push(add(add(a.origin, mul(a.axis, station)), radial));
        }
      });
    } else if (a.kind === 'sphere') {
      var frame2 = basis(a.pole);
      points.push(a.center);
      points.push(add(a.center, mul(a.pole, a.radius * 0.5)));
      for (var j = 1; j < 4; j++) {
        var theta = a.capAngle * j / 4;
        for (var k = 0; k < 32; k++) {
          var angle = TAU * k / 32;
          var radial2 = add(mul(frame2.u, Math.cos(angle)), mul(frame2.v, Math.sin(angle)));
          points.push(add(add(a.center, mul(a.pole, a.radius * Math.cos(theta))),
            mul(radial2, a.radius * Math.sin(theta) * 0.5)));
        }
      }
    }
    return points.some(function (p) { return strict(a, p) && strict(b, p); });
  }

  function shrunkenVolume(volume, delta) {
    if (volume.kind === 'cylinder') {
      var radius = volume.radius - delta;
      var depth = volume.depth - 2 * delta;
      if (!(radius > 0) || !(depth > 0)) return null;
      var copy = {kind:'cylinder', radius:radius, depth:depth, axis:volume.axis,
        origin:add(volume.origin, mul(volume.axis, delta)),
        mouthCenter:add(volume.origin, mul(volume.axis, delta)),
        outward:volume.outward};
      return copy;
    }
    if (volume.kind === 'cone') {
      var coneRadius = volume.radius - delta;
      var coneBottom = bottomRadiusOf(volume) - delta;
      var coneDepth = volume.depth - 2 * delta;
      if (!(coneRadius > 0) || coneBottom < 0 || !(coneDepth > 0)) return null;
      return {kind:'cone', radius:coneRadius, bottomRadius:coneBottom, depth:coneDepth,
        axis:volume.axis, origin:add(volume.origin, mul(unit(volume.axis), delta)),
        mouthCenter:add(volume.origin, mul(unit(volume.axis), delta)),
        bottomCenter:add(volume.origin, mul(unit(volume.axis), volume.depth - delta)),
        outward:volume.outward};
    }
    if (volume.kind === 'sphere') {
      var sphereRadius = volume.radius - delta;
      if (!(sphereRadius > 0)) return null;
      var pole = unit(volume.pole), outward = unit(volume.outward);
      var planeDistance = volume.radius * Math.cos(volume.capAngle);
      var shrunkPlane = planeDistance + delta;
      if (shrunkPlane >= sphereRadius) return null;
      var capAngle = Math.acos(Math.max(-1, Math.min(1, shrunkPlane / sphereRadius)));
      var mouthCenter = add(volume.center, mul(pole, shrunkPlane));
      return {kind:'sphere', center:volume.center, radius:sphereRadius, pole:pole,
        outward:outward, capAngle:capAngle, mouthCenter:mouthCenter,
        mouthRadius:sphereRadius * Math.sin(capAngle)};
    }
    return null;
  }

  function volumeCaps(volume) {
    if (volume.kind === 'cylinder') {
      var axis = unit(volume.axis);
      return [
        {role:'mouth', center:volume.origin, normal:neg(axis), radius:volume.radius},
        {role:'bottom', center:add(volume.origin, mul(axis, volume.depth)), normal:axis, radius:volume.radius}
      ];
    }
    if (volume.kind === 'cone') {
      var axis = unit(volume.axis), caps = [
        {role:'mouth', center:volume.origin, normal:neg(axis), radius:volume.radius}];
      var bottom = bottomRadiusOf(volume);
      if (bottom > 1e-12) caps.push({role:'bottom',
        center:add(volume.origin, mul(axis, volume.depth)), normal:axis, radius:bottom});
      return caps;
    }
    if (volume.kind === 'sphere') {
      var mouthRadius = Number.isFinite(volume.mouthRadius) ? volume.mouthRadius :
        volume.radius * Math.sin(volume.capAngle);
      return [{role:'mouth', center:volume.mouthCenter, normal:unit(volume.outward), radius:mouthRadius}];
    }
    return [];
  }

  function diskOverlapArea(radiusA, radiusB, distance) {
    var low = Math.abs(radiusA - radiusB), high = radiusA + radiusB;
    if (distance <= low) return Math.PI * Math.min(radiusA, radiusB) * Math.min(radiusA, radiusB);
    if (distance >= high) return 0;
    var d = Math.max(distance, 1e-12);
    var alpha = Math.acos(Math.max(-1, Math.min(1, (d*d + radiusA*radiusA - radiusB*radiusB) / (2*d*radiusA))));
    var beta = Math.acos(Math.max(-1, Math.min(1, (d*d + radiusB*radiusB - radiusA*radiusA) / (2*d*radiusB))));
    return radiusA*radiusA*(alpha - Math.sin(2*alpha)/2) +
      radiusB*radiusB*(beta - Math.sin(2*beta)/2);
  }

  function capContactInfo(a, b, tolerance) {
    var capsA = volumeCaps(a), capsB = volumeCaps(b), best = null;
    capsA.forEach(function (capA) {
      capsB.forEach(function (capB) {
        if (dot(capA.normal, capB.normal) > -1 + 1e-7) return;
        if (Math.abs(dot(capA.normal, sub(capB.center, capA.center))) > tolerance*4 + 1e-12) return;
        var distance = len(sub(capB.center, capA.center));
        if (distance >= capA.radius + capB.radius - tolerance) return;
        var overlapArea = diskOverlapArea(capA.radius, capB.radius, distance);
        if (!(overlapArea > tolerance*tolerance)) return;
        if (!best || overlapArea > best.overlapArea)
          best = {kind:'cap-overlap', positiveArea:true,
            plane:{normal:capA.normal, point:capA.center},
            caps:[capA.role, capB.role], radii:[capA.radius, capB.radius],
            centerDistance:distance, overlapArea:overlapArea};
      });
    });
    return best;
  }

  function contactInfo(a, b, tolerance) {
    var cap = capContactInfo(a, b, tolerance);
    if (cap) return cap;
    var line = a.kind === 'cylinder' && b.kind === 'cylinder' &&
      len(cross(unit(a.axis), unit(b.axis))) <= angleTolerance([a, b]);
    return {kind:line?'line':'point', positiveArea:false};
  }

  function relation(a, b) {
    var tolerance = volumeTolerance([a, b]);
    var result = {relation:'separate', tolerance:tolerance, aInsideB:false, bInsideA:false};
    if (a.kind === 'sphere' && b.kind === 'sphere') {
      var centerDistance = len(sub(a.center, b.center));
      var sameCenter = centerDistance <= tolerance;
      var sameRadius = Math.abs(a.radius - b.radius) <= tolerance;
      var poleAlignment = dot(unit(a.pole), unit(b.pole));
      var samePole = Math.abs(poleAlignment - 1) <= angleTolerance([a, b]);
      var sameCap = Math.abs(a.capAngle - b.capAngle) <= 1e-7;
      var sameMouth = len(sub(a.mouthCenter, b.mouthCenter)) <= tolerance;
      if (sameCenter && sameRadius && samePole && sameCap && sameMouth) {
        result.relation = 'duplicate';
        result.aInsideB = true;
        result.bInsideA = true;
        return result;
      }
      if (sameCenter && sameRadius && samePole && !sameCap) {
        result.relation = 'contained';
        result.aInsideB = a.capAngle < b.capAngle;
        result.bInsideA = b.capAngle < a.capAngle;
        return result;
      }
    }
    var axialKinds = ['cylinder', 'cone'];
    if (axialKinds.indexOf(a.kind) !== -1 && axialKinds.indexOf(b.kind) !== -1) {
      var crossAxes = cross(unit(a.axis), unit(b.axis));
      if (len(crossAxes) <= angleTolerance([a, b])) {
        var parallel = parallelAxialRelation(a, b, tolerance);
        if (parallel.relation === 'touch' && a.kind === 'cylinder' && b.kind === 'cylinder')
          parallel.contact = contactInfo(a, b, tolerance);
        return parallel;
      }
    }
    var separation = gjkSeparation(a, b, tolerance);
    if (separation.separated) {
      result.relation = 'separate';
      result.clearance = separation.clearance;
      return result;
    }
    var delta = Math.max(tolerance * 4, 1e-9);
    var shrunkA = shrunkenVolume(a, delta), shrunkB = shrunkenVolume(b, delta);
    if (shrunkA && shrunkB && !gjkSeparation(shrunkA, shrunkB, tolerance).separated)
      result.relation = 'overlap';
    else if (interiorWitness(a, b) || interiorWitness(b, a))
      result.relation = 'overlap';
    else
      result.relation = 'touch';
    if (result.relation === 'touch') result.contact = contactInfo(a, b, tolerance);
    return result;
  }

  function meshPolygons(volume, segments) {
    var mesh = buildVolumeMesh(volume, segments);
    if (!mesh) return {polygons:[], mesh:null};
    var polygons = mesh.faces.map(function (face) {
      return {vertices:face.vertices.map(function (i) { return mesh.vertices[i]; }),
        plane:face.plane, tag:face.tag};
    });
    return {polygons:polygons, mesh:mesh};
  }

  function weld(polygons, epsilon) {
    var vertices = [], index = new Map(), faces = [];
    function key(p) {
      return [Math.round(p.x/epsilon), Math.round(p.y/epsilon), Math.round(p.z/epsilon)].join(',');
    }
    polygons.forEach(function (polygon) {
      var face = [];
      polygon.vertices.forEach(function (p) {
        var k = key(p);
        if (!index.has(k)) {
          index.set(k, vertices.length);
          vertices.push({x:p.x, y:p.y, z:p.z});
        }
        var i = index.get(k);
        if (!face.length || face[face.length-1] !== i) face.push(i);
      });
      if (face.length > 1 && face[0] === face[face.length-1]) face.pop();
      if (face.length >= 3)
        faces.push({face:face, tag:polygon.tag, plane:polygon.plane});
    });
    return {vertices:vertices, faces:faces};
  }

  function chainLoops(polygons, normal, epsilon) {
    var b = basis(normal);
    var edges = new Map();
    function pointKey(p) {
      return [Math.round(p.x/epsilon), Math.round(p.y/epsilon), Math.round(p.z/epsilon)].join(',');
    }
    polygons.forEach(function (polygon) {
      var points = polygon.vertices;
      for (var i = 0; i < points.length; i++) {
        var a = points[i], c = points[(i+1)%points.length];
        if (len(sub(a, c)) <= epsilon) continue;
        var ka = pointKey(a), kc = pointKey(c);
        var key = ka < kc ? ka + '|' + kc : kc + '|' + ka;
        var record = edges.get(key);
        if (!record) edges.set(key, {a:a, c:c, count:1});
        else record.count++;
      }
    });
    var adjacency = new Map();
    edges.forEach(function (record) {
      if (record.count !== 1) return;
      var ka = pointKey(record.a), kc = pointKey(record.c);
      if (!adjacency.has(ka)) adjacency.set(ka, []);
      if (!adjacency.has(kc)) adjacency.set(kc, []);
      adjacency.get(ka).push({key:kc, point:record.c});
      adjacency.get(kc).push({key:ka, point:record.a});
    });
    var visited = new Set(), loops = [];
    var starts = Array.from(adjacency.keys()).sort();
    starts.forEach(function (start) {
      if (visited.has(start)) return;
      var loop = [], current = start, previous = null;
      while (current && !visited.has(current)) {
        visited.add(current);
        var record = adjacency.get(current);
        if (!record || !record.length) break;
        var next = null;
        for (var i = 0; i < record.length; i++) {
          if (record[i].key !== previous) { next = record[i]; break; }
        }
        if (!next) next = record[0];
        loop.push(next.point);
        previous = current;
        current = next.key;
        if (current === start) break;
      }
      if (loop.length >= 3) {
        var simplified = [];
        for (var i = 0; i < loop.length; i++) {
          var prev = loop[(i+loop.length-1)%loop.length], p = loop[i], next2 = loop[(i+1)%loop.length];
          var e1 = sub(p, prev), e2 = sub(next2, p);
          if (len(cross(e1, e2)) > epsilon * len(e1) && len(e1) > epsilon) simplified.push(p);
        }
        if (simplified.length >= 3) loops.push(simplified);
      }
    });
    return loops;
  }

  function planeBasis(normal) { return basis(normal); }

  function pointOnPlane(point, plane, tolerance) {
    return Math.abs(dot(sub(point, plane.point), plane.normal)) <= tolerance;
  }

  function projectPoint(point, plane) {
    var frame = planeBasis(plane.normal), delta = sub(point, plane.point);
    return {x:dot(delta, frame.u), y:dot(delta, frame.v)};
  }

  function unprojectPoint(point, plane) {
    var frame = planeBasis(plane.normal);
    return add(plane.point, add(mul(frame.u, point.x), mul(frame.v, point.y)));
  }

  function rimSegments(polygons, plane, tolerance) {
    var segments = [];
    polygons.forEach(function (polygon) {
      var points = polygon.vertices;
      for (var i = 0; i < points.length; i++) {
        var a = points[i], b = points[(i + 1) % points.length];
        if (!pointOnPlane(a, plane, tolerance) || !pointOnPlane(b, plane, tolerance)) continue;
        if (len(sub(a, b)) <= tolerance) continue;
        segments.push({a:projectPoint(a, plane), b:projectPoint(b, plane),
          A:a, B:b});
      }
    });
    return segments;
  }

  function parameterOnSegment(segment, point) {
    var dx = segment.b.x - segment.a.x, dy = segment.b.y - segment.a.y;
    var denominator = dx*dx + dy*dy;
    if (denominator <= 1e-24) return null;
    var t = ((point.x - segment.a.x)*dx + (point.y - segment.a.y)*dy) / denominator;
    var closest = {x:segment.a.x + t*dx, y:segment.a.y + t*dy};
    if (Math.hypot(point.x - closest.x, point.y - closest.y) > 1e-9) return null;
    if (t < -1e-9 || t > 1 + 1e-9) return null;
    return Math.max(0, Math.min(1, t));
  }

  function splitRimSegments(segments, tolerance, simplifyLoops) {
    segments.forEach(function (segment) { segment.parameters = [0, 1]; });
    function addParameter(index, t) {
      if (!Number.isFinite(t)) return;
      segments[index].parameters.push(Math.max(0, Math.min(1, t)));
    }
    for (var i = 0; i < segments.length; i++) {
      for (var j = 0; j < segments.length; j++) {
        if (i === j) continue;
        var other = segments[j];
        [other.a, other.b].forEach(function (point) {
          var t = parameterOnSegment(segments[i], point);
          if (t !== null) addParameter(i, t);
        });
        var rx = segments[i].b.x - segments[i].a.x, ry = segments[i].b.y - segments[i].a.y;
        var sx = other.b.x - other.a.x, sy = other.b.y - other.a.y;
        var denominator = rx*sy - ry*sx;
        if (Math.abs(denominator) <= 1e-15) continue;
        var qx = other.a.x - segments[i].a.x, qy = other.a.y - segments[i].a.y;
        var t = (qx*sy - qy*sx) / denominator;
        var u = (qx*ry - qy*rx) / denominator;
        if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) {
          addParameter(i, t);
          addParameter(j, u);
        }
      }
    }
    function key(point) {
      return [Math.round(point.x/tolerance), Math.round(point.y/tolerance)].join(',');
    }
    var subedges = new Map();
    segments.forEach(function (segment) {
      var parameters = segment.parameters.slice().sort(function (a, b) { return a - b; });
      var unique = [];
      parameters.forEach(function (t) {
        if (!unique.length || Math.abs(t - unique[unique.length-1]) > 1e-12) unique.push(t);
      });
      for (var i = 0; i + 1 < unique.length; i++) {
        var t0 = unique[i], t1 = unique[i+1];
        if (t1 - t0 <= 1e-12) continue;
        var a = {x:segment.a.x + (segment.b.x - segment.a.x)*t0,
          y:segment.a.y + (segment.b.y - segment.a.y)*t0};
        var b = {x:segment.a.x + (segment.b.x - segment.a.x)*t1,
          y:segment.a.y + (segment.b.y - segment.a.y)*t1};
        var ka = key(a), kb = key(b);
        if (ka === kb) continue;
        var edgeKey = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        var record = subedges.get(edgeKey);
        if (!record) subedges.set(edgeKey, {a:a, b:b, count:1});
        else record.count++;
      }
    });
    var edges = [];
    subedges.forEach(function (record) {
      if (record.count % 2 === 0) return;
      edges.push({a:record.a, b:record.b});
    });
    var adjacency = new Map(), edgeKeys = [];
    edges.forEach(function (edge, index) {
      var ka = key(edge.a), kb = key(edge.b);
      edgeKeys.push(ka + '|' + kb);
      if (!adjacency.has(ka)) adjacency.set(ka, []);
      if (!adjacency.has(kb)) adjacency.set(kb, []);
      adjacency.get(ka).push({edge:index, point:edge.b, other:kb});
      adjacency.get(kb).push({edge:index, point:edge.a, other:ka});
    });
    var used = new Set(), loops = [];
    edges.forEach(function (edge, edgeIndex) {
      if (used.has(edgeIndex)) return;
      var startKey = key(edge.a), currentKey = key(edge.b);
      var points = [edge.a, edge.b], guard = 0, closed = false;
      used.add(edgeIndex);
      while (guard++ <= edges.length + 2) {
        if (currentKey === startKey) { closed = true; break; }
        var options = adjacency.get(currentKey) || [];
        var next = null;
        for (var i = 0; i < options.length; i++) {
          if (!used.has(options[i].edge)) { next = options[i]; break; }
        }
        if (!next) break;
        used.add(next.edge);
        points.push(next.point);
        currentKey = next.other;
      }
      if (!closed) return;
      if (points.length > 1 && len(sub(points[0], points[points.length-1])) <= tolerance)
        points.pop();
      if (points.length < 3) return;
      if (simplifyLoops === false) { loops.push(points); return; }
      var changed = true;
      while (changed && points.length > 3) {
        changed = false;
        for (var i = 0; i < points.length; i++) {
          var previous = points[(i + points.length - 1) % points.length];
          var point = points[i];
          var next = points[(i + 1) % points.length];
          var oneX = point.x - previous.x, oneY = point.y - previous.y;
          var twoX = next.x - point.x, twoY = next.y - point.y;
          var determinant = oneX*twoY - oneY*twoX;
          if (Math.abs(determinant) <= tolerance *
              (Math.hypot(oneX, oneY) + Math.hypot(twoX, twoY)) + 1e-15) {
            points.splice(i, 1);
            changed = true;
            break;
          }
        }
      }
      if (points.length >= 3) loops.push(points);
    });
    return loops;
  }

  function insertRimPoints(polygons, loops, plane, tolerance) {
    var rimPoints = [];
    loops.forEach(function (loop) { loop.forEach(function (p) { rimPoints.push(p); }); });
    return polygons.map(function (polygon) {
      var output = [], points = polygon.vertices;
      function onPlane(p) { return pointOnPlane(p, plane, tolerance); }
      for (var i = 0; i < points.length; i++) {
        var a = points[i], b = points[(i + 1) % points.length];
        output.push(a);
        if (!onPlane(a) || !onPlane(b)) continue;
        var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        var denominator = dx*dx + dy*dy + dz*dz;
        if (denominator <= 1e-24) continue;
        var insertions = [];
        rimPoints.forEach(function (p) {
          var t = ((p.x - a.x)*dx + (p.y - a.y)*dy + (p.z - a.z)*dz) / denominator;
          if (t <= 1e-9 || t >= 1 - 1e-9) return;
          var closest = {x:a.x + dx*t, y:a.y + dy*t, z:a.z + dz*t};
          if (len(sub(p, closest)) > tolerance) return;
          insertions.push({t:t, point:p});
        });
        insertions.sort(function (x, y) { return x.t - y.t; });
        var last = null;
        insertions.forEach(function (insertion) {
          if (last !== null && Math.abs(insertion.t - last) <= 1e-12) return;
          output.push({x:insertion.point.x, y:insertion.point.y, z:insertion.point.z});
          last = insertion.t;
        });
      }
      return {vertices:output, plane:polygon.plane, tag:polygon.tag};
    });
  }

  function meshMetrics(polygons, epsilon) {
    var volume = 0, edges = new Map();
    function key(p) {
      return [Math.round(p.x/epsilon), Math.round(p.y/epsilon), Math.round(p.z/epsilon)].join(',');
    }
    polygons.forEach(function (polygon) {
      var points = polygon.vertices, p0 = points[0];
      for (var i = 1; i + 1 < points.length; i++) {
        var a = points[i], b = points[i + 1];
        volume += (p0.x*(a.y*b.z - a.z*b.y) - p0.y*(a.x*b.z - a.z*b.x) +
          p0.z*(a.x*b.y - a.y*b.x)) / 6;
      }
      for (var j = 0; j < points.length; j++) {
        var first = key(points[j]), second = key(points[(j + 1) % points.length]);
        if (first === second) continue;
        var edgeKey = first < second ? first + '|' + second : second + '|' + first;
        var record = edges.get(edgeKey);
        if (!record) {
          record = {count:0, balance:0};
          edges.set(edgeKey, record);
        }
        record.count++;
        record.balance += first < second ? 1 : -1;
      }
    });
    var open = 0, nonmanifold = 0;
    edges.forEach(function (record) {
      if (record.count === 1) open++;
      else if (record.count !== 2 || record.balance !== 0) nonmanifold++;
    });
    return {volume:Math.abs(volume), signedVolume:volume,
      openEdges:open, nonmanifoldEdges:nonmanifold, closed:open === 0 && nonmanifold === 0};
  }

  function mouthArea(polygons) {
    var total = 0;
    polygons.forEach(function (polygon) { total += polygonArea(polygon.vertices); });
    return total;
  }

  function dedupeLoop(loop, tolerance) {
    var out = [];
    loop.forEach(function (p) {
      if (!out.length || len(sub(p, out[out.length-1])) > tolerance) out.push(p);
    });
    if (out.length > 1 && len(sub(out[0], out[out.length-1])) <= tolerance) out.pop();
    return out;
  }

  function orientLoop(loop, normal) {
    var area = {x:0, y:0, z:0};
    for (var i = 0; i < loop.length; i++) {
      var a = loop[i], b = loop[(i + 1) % loop.length];
      area.x += a.y*b.z - a.z*b.y;
      area.y += a.z*b.x - a.x*b.z;
      area.z += a.x*b.y - a.y*b.x;
    }
    if (dot(area, normal) < 0) loop.reverse();
    return loop;
  }

  function classifyMouthLoops(loops, plane, tolerance) {
    if (loops.length <= 1) return {outer:loops,metric:loops};
    var frame = basis(plane.normal), origin = loops[0][0] || {x:0,y:0,z:0};
    function project(p) {
      var d = sub(p, origin);
      return {x:dot(d, frame.u), y:dot(d, frame.v)};
    }
    function inside(p, polygon) {
      var found = false;
      for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        var a = polygon[i], b = polygon[j];
        if ((a.y > p.y) !== (b.y > p.y) &&
            p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) found = !found;
      }
      return found;
    }
    var projected = loops.map(function (loop) {return loop.map(project);});
    var outer = [], metric = [];
    loops.forEach(function (loop, index) {
      var point = projected[index][0], hole = false;
      for (var j = 0; j < projected.length; j++) {
        if (j === index) continue;
        if (inside(point, projected[j])) {hole = true; break;}
      }
      if (hole) metric.push(loop.slice().reverse());
      else {outer.push(loop);metric.push(loop);}
    });
    return {outer: outer.length ? outer : loops, metric:metric};
  }

  function samePlane(a, b, tolerance) {
    if (Math.abs(Math.abs(dot(a.normal, b.normal)) - 1) > 1e-6) return false;
    return Math.abs(dot(a.normal, sub(b.point, a.point))) <= tolerance;
  }

  function referencePoint(volume) {
    if (!volume) return {x:0, y:0, z:0};
    if (volume.kind === 'cylinder' || volume.kind === 'cone')
      return volume.mouthCenter || volume.origin;
    return volume.mouthCenter || volume.center;
  }

  function shiftedVolume(volume, origin) {
    if (!volume) return volume;
    var copy = {kind:volume.kind, index:volume.index, radius:volume.radius,
      bottomRadius:volume.bottomRadius, depth:volume.depth,
      capAngle:volume.capAngle, halfAngle:volume.halfAngle, openBottom:volume.openBottom,
      mouthRadius:volume.mouthRadius, absorbed:volume.absorbed};
    ['origin', 'center', 'mouthCenter', 'bottomCenter', 'apex'].forEach(function (key) {
      if (finite(volume[key])) copy[key] = sub(volume[key], origin);
    });
    if (finite(volume.axis)) copy.axis = {x:volume.axis.x, y:volume.axis.y, z:volume.axis.z};
    if (finite(volume.pole)) copy.pole = {x:volume.pole.x, y:volume.pole.y, z:volume.pole.z};
    if (finite(volume.outward)) copy.outward = {x:volume.outward.x, y:volume.outward.y, z:volume.outward.z};
    return copy;
  }

  function union(volumes, options) {
    options = options || {};
    var segments = options.segments || 24;
    var tolerance = volumeTolerance(volumes);
    var epsilon = Math.max(1e-10, tolerance * 0.5);
    var origin = referencePoint(volumes[0]);
    var local = volumes.map(function (volume) { return shiftedVolume(volume, origin); });
    var built = local.map(function (volume) {
      return meshPolygons(volume, segments);
    });
    var merged = [];
    local.forEach(function (volume, i) {
      if (volume.absorbed) return;
      merged = unionPolygons(merged, built[i].polygons, epsilon);
    });
    merged = cleanPolygons(merged, epsilon);
    merged = resolveTJunctions(merged, epsilon);
    var bodyPolygons = merged.filter(function (p) { return !(p.tag && p.tag.role === 'mouth'); });
    var mouthPlanes = [];
    local.forEach(function (volume, i) {
      var plane = {normal:unit(volume.outward), point:volume.mouthCenter};
      var group = mouthPlanes.find(function (g) { return samePlane(g.plane, plane, tolerance); });
      if (!group) {
        group = {plane:plane, sourceVolumes:[]};
        mouthPlanes.push(group);
      }
      group.sourceVolumes.push(i);
      if (volume.openBottom === true) {
        var axis = unit(volume.axis);
        var bottomPlane = {normal:axis,
          point:add(volume.origin, mul(axis, volume.depth))};
        var bottomGroup = mouthPlanes.find(function (g) {
          return samePlane(g.plane, bottomPlane, tolerance);
        });
        if (!bottomGroup) {
          bottomGroup = {plane:bottomPlane, sourceVolumes:[]};
          mouthPlanes.push(bottomGroup);
        }
        bottomGroup.sourceVolumes.push(i);
      }
    });
    mouthPlanes.forEach(function (group) {
      group.segments = rimSegments(bodyPolygons, group.plane, tolerance);
      var classified = classifyMouthLoops(splitRimSegments(group.segments, tolerance).map(function (loop) {
        return orientLoop(dedupeLoop(loop.map(function (p) { return unprojectPoint(p, group.plane); }), tolerance),
          group.plane.normal);
      }), group.plane, tolerance);
      group.loops = classified.outer;
      group.metricLoops = classified.metric;
      bodyPolygons = insertRimPoints(bodyPolygons, group.loops, group.plane, tolerance);
    });
    bodyPolygons = simplifyPolygonVertices(bodyPolygons, epsilon * 0.1);
    var trueMouthPolygons = [];
    mouthPlanes.forEach(function (group) {
      (group.metricLoops || group.loops).forEach(function (loop) {
        trueMouthPolygons.push({vertices:loop,
          plane:{normal:group.plane.normal, w:dot(group.plane.normal, loop[0])},
          tag:{role:'mouth'}});
      });
    });
    var resolvedPolygons = cleanPolygons(resolveTJunctions(bodyPolygons.concat(trueMouthPolygons), epsilon), epsilon);
    bodyPolygons = resolvedPolygons.filter(function (polygon) {
      return !(polygon.tag && polygon.tag.role === 'mouth');
    });
    var resolvedMouthPolygons = resolvedPolygons.filter(function (polygon) {
      return polygon.tag && polygon.tag.role === 'mouth';
    });
    mouthPlanes.forEach(function (group) {
      group.segments = rimSegments(resolvedMouthPolygons, group.plane, tolerance);
      var classifiedAgain = classifyMouthLoops(splitRimSegments(group.segments, tolerance, false).map(function (loop) {
        return orientLoop(dedupeLoop(loop.map(function (p) { return unprojectPoint(p, group.plane); }), tolerance),
          group.plane.normal);
      }), group.plane, tolerance);
      group.loops = classifiedAgain.outer;
      group.metricLoops = classifiedAgain.metric;
    });
    trueMouthPolygons = [];
    mouthPlanes.forEach(function (group) {
      (group.metricLoops || group.loops).forEach(function (loop) {
        trueMouthPolygons.push({vertices:loop,
          plane:{normal:group.plane.normal, w:dot(group.plane.normal, loop[0])},
          tag:{role:'mouth'}});
      });
    });
    var welded = weld(bodyPolygons, epsilon);
    var mouths = mouthPlanes.map(function (group) {
      return {plane:{normal:group.plane.normal, point:add(group.plane.point, origin)},
        sourceVolumes:group.sourceVolumes,
        loops:group.loops.map(function (loop) {
          return loop.map(function (p) { return add(p, origin); });
        })};
    }).filter(function (group) { return group.loops.length; });
    var vertices = welded.vertices.map(function (p) {
      return {x:p.x + origin.x, y:p.y + origin.y, z:p.z + origin.z};
    });
    var faceParents = [];
    welded.faces.forEach(function (face) {
      var tag = face.tag || {};
      faceParents.push({volume:tag.volume, role:tag.role});
    });
    var openMouthPolygons = [];
    mouthPlanes.forEach(function (group) {
      group.loops.forEach(function (loop) {
        openMouthPolygons.push({vertices:loop});
      });
    });
    return {vertices:vertices, faces:welded.faces, parents:faceParents,
      mouths:mouths, polygons:bodyPolygons.concat(trueMouthPolygons),
      fullPolygons:resolvedPolygons, tolerance:tolerance,
      metrics:meshMetrics(resolvedPolygons, epsilon), mouthArea:mouthArea(openMouthPolygons)};
  }

  return {
    buildVolumeMesh:buildVolumeMesh,
    meshPolygons:meshPolygons,
    signedDistanceToVolume:signedDistanceToVolume,
    contains:contains,
    support:support,
    relation:relation,
    contact:contactInfo,
    perpendicularBoreJunction:perpendicularBoreJunction,
    junctionPoint:junctionPoint,
    union:union,
    tolerance:volumeTolerance
  };
});

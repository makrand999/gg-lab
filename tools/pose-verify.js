'use strict';













var Pose = require('../public/lib/educad-pose.js');
var Project = require('../public/lib/educad-project.js');

var TOL = 1e-6;
var HIT_EPS = 1e-7;
var IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function fail(msg) { throw new Error('pose-check: ' + msg); }

function close(a, b) {
  return typeof a === 'number' && typeof b === 'number' && isFinite(a) &&
    Math.abs(a - b) <= TOL * Math.max(1, Math.abs(a), Math.abs(b));
}

function assertClose(actual, expected, what) {
  if (!close(actual, expected)) {
    fail(what + ': expected ' + expected + ', got ' + actual);
  }
}

function assertFiniteNumber(v, what) {
  if (typeof v !== 'number' || !isFinite(v)) fail(what + ' needs a finite number');
}

function readPoint3(value, what) {
  if (Array.isArray(value)) {
    if (value.length !== 3) fail(what + ' needs [x,y,z]');
    value.forEach(function (n, i) { assertFiniteNumber(n, what + '[' + i + ']'); });
    return { x: value[0], y: value[1], z: value[2] };
  }
  if (!value || typeof value !== 'object') fail(what + ' needs [x,y,z]');
  assertFiniteNumber(value.x, what + '.x');
  assertFiniteNumber(value.y, what + '.y');
  assertFiniteNumber(value.z, what + '.z');
  return { x: value.x, y: value.y, z: value.z };
}

function readPoint2(value, what) {
  if (Array.isArray(value)) {
    if (value.length !== 2) fail(what + ' needs [x,y]');
    assertFiniteNumber(value[0], what + '[0]');
    assertFiniteNumber(value[1], what + '[1]');
    return { x: value[0], y: value[1] };
  }
  if (!value || typeof value !== 'object') fail(what + ' needs [x,y]');
  assertFiniteNumber(value.x, what + '.x');
  assertFiniteNumber(value.y, what + '.y');
  return { x: value.x, y: value.y };
}

function readSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    fail('needs a JSON object');
  }
  var out = {
    name: spec.name === undefined ? '' : String(spec.name),
    t: [0, 0, 0],
    scale: 1,
    axis: null,
    deg: 0,
    center: null,
    expect: spec.expect || null
  };
  if (spec.translate !== undefined) {
    if (!Array.isArray(spec.translate) || spec.translate.length !== 3) {
      fail('translate needs [x,y,z]');
    }
    out.t = spec.translate.map(function (n, i) {
      assertFiniteNumber(n, 'translate[' + i + ']');
      return n;
    });
  }
  if (spec.scale !== undefined) {
    assertFiniteNumber(spec.scale, 'scale');
    if (!(spec.scale > 0)) fail('scale needs a positive number');
    out.scale = spec.scale;
  }
  if (spec.rotate !== undefined) {
    var r = spec.rotate;
    if (Array.isArray(r)) {
      if (r.length !== 4) fail('rotate needs [x,y,z,degrees]');
      out.axis = r.slice(0, 3);
      out.deg = r[3];
    } else if (r && typeof r === 'object') {
      if (!Array.isArray(r.axis) || r.axis.length !== 3) {
        fail('rotate.axis needs [x,y,z]');
      }
      out.axis = r.axis.slice();
      out.deg = r.deg !== undefined ? r.deg :
        (r.degrees !== undefined ? r.degrees : r.angle);
    } else {
      fail('rotate needs {axis:[x,y,z], deg:number}');
    }
    out.axis.forEach(function (n, i) {
      assertFiniteNumber(n, 'rotate.axis[' + i + ']');
    });
    assertFiniteNumber(out.deg, 'rotate.deg');
    var len = Math.hypot(out.axis[0], out.axis[1], out.axis[2]);
    if (!(len > 0)) fail('rotate.axis must be nonzero');
  }
  if (spec.center !== undefined) out.center = readPoint3(spec.center, 'center');
  if (out.expect !== null && (typeof out.expect !== 'object' ||
      Array.isArray(out.expect))) {
    fail('expect needs a JSON object');
  }
  return out;
}

function bboxCenter(verts) {
  if (!Array.isArray(verts) || verts.length < 1) fail('need vertices');
  var minX = verts[0].x, maxX = verts[0].x;
  var minY = verts[0].y, maxY = verts[0].y;
  var minZ = verts[0].z, maxZ = verts[0].z;
  verts.forEach(function (v) {
    assertFiniteNumber(v.x, 'vertex.x');
    assertFiniteNumber(v.y, 'vertex.y');
    assertFiniteNumber(v.z, 'vertex.z');
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  });
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2 };
}

function quaternion(axis, deg) {
  var len = Math.hypot(axis[0], axis[1], axis[2]);
  if (!(len > 0)) fail('rotate.axis must be nonzero');
  var half = deg * Math.PI / 360;
  var sin = Math.sin(half);
  return {
    w: Math.cos(half),
    x: axis[0] / len * sin,
    y: axis[1] / len * sin,
    z: axis[2] / len * sin
  };
}



function rotate(q, v) {
  var tx = 2 * (q.y * v.z - q.z * v.y);
  var ty = 2 * (q.z * v.x - q.x * v.z);
  var tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx)
  };
}

function independentPose(verts, spec, center) {
  var q = spec.axis ? quaternion(spec.axis, spec.deg) :
    { w: 1, x: 0, y: 0, z: 0 };
  return verts.map(function (v) {
    var rotated = rotate(q, {
      x: (v.x - center.x) * spec.scale,
      y: (v.y - center.y) * spec.scale,
      z: (v.z - center.z) * spec.scale
    });
    return {
      x: rotated.x + center.x + spec.t[0],
      y: rotated.y + center.y + spec.t[1],
      z: rotated.z + center.z + spec.t[2]
    };
  });
}

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function mix(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t };
}
function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
function det3(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function checkRotation(rm) {
  var c0 = { x: rm[0], y: rm[3], z: rm[6] };
  var c1 = { x: rm[1], y: rm[4], z: rm[7] };
  var c2 = { x: rm[2], y: rm[5], z: rm[8] };
  assertClose(dot(c0, c0), 1, 'rotation column 0 norm');
  assertClose(dot(c1, c1), 1, 'rotation column 1 norm');
  assertClose(dot(c2, c2), 1, 'rotation column 2 norm');
  assertClose(dot(c0, c1), 0, 'rotation column 0·1');
  assertClose(dot(c0, c2), 0, 'rotation column 0·2');
  assertClose(dot(c1, c2), 0, 'rotation column 1·2');
  assertClose(det3(rm), 1, 'rotation determinant');
}

function assertPoints3(actual, expected, what) {
  if (actual.length !== expected.length) {
    fail(what + ': expected ' + expected.length + ' points, got ' + actual.length);
  }
  actual.forEach(function (p, i) {
    assertClose(p.x, expected[i].x, what + '[' + i + '].x');
    assertClose(p.y, expected[i].y, what + '[' + i + '].y');
    assertClose(p.z, expected[i].z, what + '[' + i + '].z');
  });
}

function assertPoints2(actual, expected, what) {
  if (actual.length !== expected.length) {
    fail(what + ': expected ' + expected.length + ' points, got ' + actual.length);
  }
  actual.forEach(function (p, i) {
    assertClose(p.x, expected[i].x, what + '[' + i + '].x');
    assertClose(p.y, expected[i].y, what + '[' + i + '].y');
  });
}

function checkRigid(rest, posed, scale) {
  for (var i = 0; i < rest.length; i++) {
    for (var j = i + 1; j < rest.length; j++) {
      assertClose(dist(posed[i], posed[j]), dist(rest[i], rest[j]) * scale,
        'rigid distance ' + i + '-' + j);
    }
  }
}

function projectPoint(v, view, map) {
  if (view === 'front') return { x: v.x, y: v.y };
  if (view === 'top') return { x: v.x, y: -v.z };
  if (!map) fail('profile map needed for ' + view + ' view');
  return { x: map.xRef + map.s * (v.z - map.dRef), y: v.y };
}

function viewDirection(view) {
  if (view === 'front') return { x: 0, y: 0, z: 1 };
  if (view === 'top') return { x: 0, y: 1, z: 0 };
  if (view === 'left') return { x: -1, y: 0, z: 0 };
  if (view === 'right') return { x: 1, y: 0, z: 0 };
  fail('unknown view ' + view);
}


function faceNormal(verts, loop) {
  var n = { x: 0, y: 0, z: 0 };
  for (var i = 0; i < loop.length; i++) {
    var p = verts[loop[i]], q = verts[loop[(i + 1) % loop.length]];
    n.x += (p.y - q.y) * (p.z + q.z);
    n.y += (p.z - q.z) * (p.x + q.x);
    n.z += (p.x - q.x) * (p.y + q.y);
  }
  return n;
}

function faceAxis(n) {
  return Math.abs(n.x) > Math.abs(n.y) && Math.abs(n.x) > Math.abs(n.z) ? 'x' :
    Math.abs(n.y) > Math.abs(n.z) ? 'y' : 'z';
}

function faceXY(p, axis) {
  return axis === 'x' ? [p.y, p.z] : axis === 'y' ? [p.x, p.z] : [p.x, p.y];
}




function insideLoop(verts, loop, point, axis) {
  var q = faceXY(point, axis), found = false;
  for (var i = 0; i < loop.length; i++) {
    var j = (i + loop.length - 1) % loop.length;
    var a = faceXY(verts[loop[i]], axis), b = faceXY(verts[loop[j]], axis);
    var cross2 = (q[0] - a[0]) * (b[1] - a[1]) -
      (q[1] - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross2) < 1e-9 &&
        q[0] >= Math.min(a[0], b[0]) - 1e-9 &&
        q[0] <= Math.max(a[0], b[0]) + 1e-9 &&
        q[1] >= Math.min(a[1], b[1]) - 1e-9 &&
        q[1] <= Math.max(a[1], b[1]) + 1e-9) {
      return true;
    }
    if ((a[1] > q[1]) !== (b[1] > q[1]) &&
        q[0] < (b[0] - a[0]) * (q[1] - a[1]) / (b[1] - a[1]) + a[0]) {
      found = !found;
    }
  }
  return found;
}

function hiddenAt(verts, faces, point, view) {
  var direction = viewDirection(view), hit = false;
  faces.forEach(function (loop) {
    if (hit) return;
    var normal = faceNormal(verts, loop);
    var den = dot(normal, direction);
    if (Math.abs(den) < 1e-12) return;
    var p0 = verts[loop[0]];
    var t = dot(normal, sub(p0, point)) / den;
    if (t <= HIT_EPS) return;
    var crossing = {
      x: point.x + t * direction.x,
      y: point.y + t * direction.y,
      z: point.z + t * direction.z
    };
    hit = insideLoop(verts, loop, crossing, faceAxis(normal));
  });
  return hit;
}

function hasHoles(holes) {
  return (holes || []).some(function (loop) { return loop && loop.length > 0; });
}

function checkView(view, map, expected, posed, edges, faces, holes) {
  var segments = Project.projectSolid(posed, edges, faces, view, map, holes);
  if (segments.length !== edges.length) {
    fail(view + ': expected ' + edges.length + ' projected edges, got ' +
      segments.length);
  }
  var canHide = faces.length > 0 && !hasHoles(holes);
  var hidden = 0;
  segments.forEach(function (segment, i) {
    var a = edges[i][0], b = edges[i][1];
    var pa = projectPoint(expected[a], view, map);
    var pb = projectPoint(expected[b], view, map);
    assertClose(segment.ax, pa.x, view + ' edge ' + i + ' ax');
    assertClose(segment.ay, pa.y, view + ' edge ' + i + ' ay');
    assertClose(segment.bx, pb.x, view + ' edge ' + i + ' bx');
    assertClose(segment.by, pb.y, view + ' edge ' + i + ' by');
    if (canHide) {
      var mid = mix(expected[a], expected[b], 0.5);
      var rayHidden = hiddenAt(expected, faces, mid, view);
      if (!!segment.hidden !== rayHidden) {
        fail(view + ' edge ' + i + ': visibility does not match ray casting (' +
          'project=' + !!segment.hidden + ', ray=' + rayHidden +
          ', midpoint=' + mid.x + ',' + mid.y + ',' + mid.z + ')');
      }
      hidden++;
    }
    (segment.intervals || []).forEach(function (piece, j) {
      var qa = projectPoint(mix(expected[a], expected[b], piece.t0), view, map);
      var qb = projectPoint(mix(expected[a], expected[b], piece.t1), view, map);
      assertClose(piece.ax, qa.x, view + ' edge ' + i + ' interval ' + j + ' ax');
      assertClose(piece.ay, qa.y, view + ' edge ' + i + ' interval ' + j + ' ay');
      assertClose(piece.bx, qb.x, view + ' edge ' + i + ' interval ' + j + ' bx');
      assertClose(piece.by, qb.y, view + ' edge ' + i + ' interval ' + j + ' by');
      if (canHide) {
        var pm = mix(expected[a], expected[b], (piece.t0 + piece.t1) / 2);
        if (!!piece.hidden !== hiddenAt(expected, faces, pm, view)) {
          fail(view + ' edge ' + i + ' interval ' + j +
            ': visibility does not match ray casting');
        }
      }
    });
  });
  return { segments: segments, hidden: hidden };
}

function checkGeometryView(view, map, expected, edges, faces, holes, g) {
  var shape = {
    name: g.name,
    vertices: expected,
    edges: edges,
    faces: faces,
    faceHoles: holes,
    smoothSideFaces: g.smoothSideFaces
  };
  var segments = Project.projectGeometry(shape, view, map);
  var filtered = !!g.smoothSideFaces || g.name === 'cylinder' || g.name === 'cone';
  if (!filtered) {
    if (segments.length !== edges.length) {
      fail(view + ': projectGeometry returned ' + segments.length +
        ' segments for ' + edges.length + ' edges');
    }
    segments.forEach(function (segment, i) {
      var a = edges[i][0], b = edges[i][1];
      var pa = projectPoint(expected[a], view, map);
      var pb = projectPoint(expected[b], view, map);
      assertClose(segment.ax, pa.x, view + ' overlay edge ' + i + ' ax');
      assertClose(segment.ay, pa.y, view + ' overlay edge ' + i + ' ay');
      assertClose(segment.bx, pb.x, view + ' overlay edge ' + i + ' bx');
      assertClose(segment.by, pb.y, view + ' overlay edge ' + i + ' by');
    });
    return;
  }
  segments.forEach(function (segment, i) {
    var matched = edges.some(function (edge) {
      var pa = projectPoint(expected[edge[0]], view, map);
      var pb = projectPoint(expected[edge[1]], view, map);
      return close(segment.ax, pa.x) && close(segment.ay, pa.y) &&
        close(segment.bx, pb.x) && close(segment.by, pb.y);
    });
    if (!matched) {
      fail(view + ': overlay segment ' + i +
        ' is not a projection of a reconstructed edge');
    }
  });
}

function angleClose(a, b) {
  var d = Math.atan2(Math.sin(a - b), Math.cos(a - b));
  return Math.abs(d) <= TOL * Math.max(1, Math.abs(a));
}

function applyFollow(sim, x, y) {
  var sx = sim.sx !== undefined ? sim.sx : sim.scale;
  var sy = sim.sy !== undefined ? sim.sy : sim.scale;
  var ca = Math.cos(sim.angle), sa = Math.sin(sim.angle);
  return {
    x: ca * sx * x - sa * sy * y + sim.tx,
    y: sa * sx * x + ca * sy * y + sim.ty
  };
}

function checkFollowView(sim, rest, now, angleDeg, scale, center, translate, view) {
  var theta = angleDeg * Math.PI / 180;
  var ca = Math.cos(theta), sa = Math.sin(theta);
  if (!angleClose(sim.angle, theta)) {
    fail(view + ' follow angle: expected ' + theta + ', got ' + sim.angle);
  }
  assertClose(sim.sx, scale, view + ' follow sx');
  assertClose(sim.sy, scale, view + ' follow sy');
  assertClose(sim.tx, center.x + translate.x -
    scale * (ca * center.x - sa * center.y), view + ' follow tx');
  assertClose(sim.ty, center.y + translate.y -
    scale * (sa * center.x + ca * center.y), view + ' follow ty');
  if (rest.length !== now.length) fail(view + ' follow point-count mismatch');
  rest.forEach(function (p, i) {
    var q = applyFollow(sim, p.x, p.y);
    assertClose(q.x, now[i].x, view + ' follow point ' + i + ' x');
    assertClose(q.y, now[i].y, view + ' follow point ' + i + ' y');
  });
}

function spread(pts) {
  return pts.some(function (p) {
    return Math.abs(p.x - pts[0].x) > TOL || Math.abs(p.y - pts[0].y) > TOL;
  });
}

function checkFollow(spec, rest2D, now, sims, center) {
  var axis = spec.axis;
  if (!axis) {
    if (spread(rest2D.elev.pts)) {
      checkFollowView(sims.elev, rest2D.elev.pts, now.elev.pts, 0, spec.scale,
        { x: center.x, y: center.y },
        { x: spec.t[0], y: spec.t[1] }, 'elev');
    }
    if (spread(rest2D.plan.pts)) {
      checkFollowView(sims.plan, rest2D.plan.pts, now.plan.pts, 0, spec.scale,
        { x: center.x, y: -center.z },
        { x: spec.t[0], y: -spec.t[2] }, 'plan');
    }
    return;
  }
  var len = Math.hypot(axis[0], axis[1], axis[2]);
  var ax = axis[0] / len, ay = axis[1] / len, az = axis[2] / len;
  if (Math.abs(az) > 1 - 1e-9 && Math.abs(ax) < 1e-9 && Math.abs(ay) < 1e-9) {
    if (spread(rest2D.elev.pts)) {
      checkFollowView(sims.elev, rest2D.elev.pts, now.elev.pts, spec.deg,
        spec.scale, { x: center.x, y: center.y },
        { x: spec.t[0], y: spec.t[1] }, 'elev');
    }
  } else if (Math.abs(ay) > 1 - 1e-9 && Math.abs(ax) < 1e-9 &&
      Math.abs(az) < 1e-9) {
    if (spread(rest2D.plan.pts)) {
      checkFollowView(sims.plan, rest2D.plan.pts, now.plan.pts, spec.deg,
        spec.scale, { x: center.x, y: -center.z },
        { x: spec.t[0], y: -spec.t[2] }, 'plan');
    }
  }
}

function checkExpect(expect, expected, projected, edges, g) {
  if (!expect) return;
  function actualView(view) {
    if (view === 'side' && !projected.side && g.profileMap) {
      return g.profileMap.side;
    }
    return view;
  }
  Object.keys(expect).forEach(function (key) {
    if (['posed', 'front', 'top', 'side', 'hidden'].indexOf(key) === -1) {
      fail('unknown expect key "' + key + '"');
    }
  });
  if (expect.posed !== undefined) {
    var posed = expect.posed.map(function (v, i) {
      return readPoint3(v, 'expect.posed[' + i + ']');
    });
    assertPoints3(expected, posed, 'expect.posed');
  }
  ['front', 'top', 'side'].forEach(function (view) {
    if (expect[view] === undefined) return;
    var key = actualView(view);
    if (!projected[key]) fail('expect.' + view + ' has no ' + view + ' view');
    var pts = expect[view].map(function (v, i) {
      return readPoint2(v, 'expect.' + view + '[' + i + ']');
    });
    var map = view === 'side' ? g.profileMap : null;
    assertPoints2(pts, expected.map(function (v) {
      return projectPoint(v, view, map);
    }), 'expect.' + view);
  });
  if (expect.hidden !== undefined) {
    Object.keys(expect.hidden).forEach(function (view) {
      var key = actualView(view);
      if (!projected[key]) fail('expect.hidden.' + view + ' has no ' + view + ' view');
      var flags = expect.hidden[view];
      if (!Array.isArray(flags) || flags.length !== edges.length) {
        fail('expect.hidden.' + view + ' needs ' + edges.length + ' booleans');
      }
      flags.forEach(function (flag, i) {
        if (typeof flag !== 'boolean') {
          fail('expect.hidden.' + view + '[' + i + '] needs true or false');
        }
        if (!!projected[key].segments[i].hidden !== flag) {
          fail('expect.hidden.' + view + '[' + i + ']: expected ' + flag +
            ', got ' + !!projected[key].segments[i].hidden);
        }
      });
    });
  }
}

function verify(spec, solid) {
  var s = readSpec(spec);
  if (!solid || solid.status !== 'ok' || !solid.geometry) {
    fail((s.name ? s.name + ': ' : '') + 'no reconstructed solid');
  }
  var g = solid.geometry;
  var verts = g.vertices || [];
  var edges = g.edges || [];
  var faces = g.faces || [];
  var holes = g.faceHoles || [];
  if (!verts.length) fail((s.name ? s.name + ': ' : '') + 'solid has no vertices');

  var center = s.center || bboxCenter(verts);
  if (!s.center) {
    var publishedCenter = Pose.bboxCenter(verts);
    assertClose(publishedCenter.x, center.x, 'bbox center x');
    assertClose(publishedCenter.y, center.y, 'bbox center y');
    assertClose(publishedCenter.z, center.z, 'bbox center z');
  }

  var expected = independentPose(verts, s, center);
  var rm = s.axis ? Pose.axisAngleMatrix(s.axis[0], s.axis[1], s.axis[2],
    s.deg * Math.PI / 180) : IDENTITY.slice();
  checkRotation(rm);
  var pose = { t: s.t.slice(), rm: rm, s: s.scale };
  var posed = Pose.applyPose(verts, pose, center);
  assertPoints3(posed, expected, 'posed');
  checkRigid(verts, posed, s.scale);

  var rest2D = Pose.reproject(verts, edges);
  var now = Pose.reproject(posed, edges);
  var expectedFront = expected.map(function (v) { return projectPoint(v, 'front'); });
  var expectedTop = expected.map(function (v) { return projectPoint(v, 'top'); });
  assertPoints2(now.elev.pts, expectedFront, 'reproject.front');
  assertPoints2(now.plan.pts, expectedTop, 'reproject.top');

  var sims = Pose.simsForPose(verts, edges, pose, center, rest2D);
  assertPoints3(sims.posed, expected, 'sims.posed');
  assertPoints2(sims.now.elev.pts, expectedFront, 'sims.now.front');
  assertPoints2(sims.now.plan.pts, expectedTop, 'sims.now.top');
  checkFollow(s, rest2D, now, sims, center);

  var projected = {
    front: checkView('front', null, expected, posed, edges, faces, holes),
    top: checkView('top', null, expected, posed, edges, faces, holes)
  };
  checkGeometryView('front', null, expected, edges, faces, holes, g);
  checkGeometryView('top', null, expected, edges, faces, holes, g);
  if (g.profileMap && g.profileMap.three) {
    var view = g.profileMap.side;
    projected[view] = checkView(view, g.profileMap, expected, posed, edges,
      faces, holes);
    checkGeometryView(view, g.profileMap, expected, edges, faces, holes, g);
  }

  for (var i = 0; i < now.elev.pts.length; i++) {
    assertClose(now.elev.pts[i].x, now.plan.pts[i].x,
      'Monge x alignment vertex ' + i);
  }

  if (s.expect) checkExpect(s.expect, expected, projected, edges, g);

  return {
    vertices: verts.length,
    projections: edges.length * Object.keys(projected).length,
    hidden: Object.keys(projected).reduce(function (n, view) {
      return n + projected[view].hidden;
    }, 0)
  };
}

module.exports = { verify: verify, close: close };

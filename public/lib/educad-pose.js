(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./educad-geometry.js'));
  } else {
    root.EduCADPose = factory(root.EduCADGeometry);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (Geometry) {
  'use strict';
  // EduCAD pose mode: grab the 3D model Blender-style and the
  // already-drawn 2D Monge views ride along in real time. All numbers
  // here are pure: the page owns the widget, the sheet, and the
  // events; this module owns the transform, the gestures, the key
  // map, the per-view follow similarities, and the XY-line clamp.
  // Zero deps. Dual-env: browser via window.EduCADPose, plain Node via
  // module.exports. Node-safe. World units mm; widget space is the
  // locked reconstruct frame (X, Y, Z) = (sheetX, elevY, -planY).
  //
  // A pose is {t:[x,y,z], rm:[9 row-major], s:number}: uniform scale
  // about the model center, then rotation about the center, then
  // translation. Gestures are pure functions of total mouse travel
  // from the gesture start, so cancel is just "keep the start pose".
  var WORLD_UNITS = 'mm';
  var VERSION = '1.0.0-educad';

  var AXES = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
  var AXIS_COLORS = { X: '#e03232', Y: '#7ac74f', Z: '#3b82f6' };
  // Datum-line clamp: a posed point may touch the XY line within
  // CONTACT_EPS but never cross to the other view's side.
  var CONTACT_EPS = 1e-6;

  var RAD_PER_PX = 0.01;
  var SCALE_PER_PX = 0.005;
  var SNAP_MM = 5;
  var SNAP_DEG = 5;
  var SNAP_SCALE = 0.1;
  var SCALE_MIN = 0.1;
  var SCALE_MAX = 10;

  // Numpad-style view presets (yaw/pitch radians for the glass state).
  // Top/bottom stop at the widget pitch limit, like the orbit clamp.
  var VIEW_PRESETS = {
    front: { yaw: 0, pitch: 0 },
    back: { yaw: Math.PI, pitch: 0 },
    right: { yaw: -Math.PI / 2, pitch: 0 },
    left: { yaw: Math.PI / 2, pitch: 0 },
    top: { yaw: 0, pitch: 1.45 },
    bottom: { yaw: 0, pitch: -1.45 }
  };

  var IDENTITY9 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function fail(msg) { throw new Error('educad-pose: ' + msg); }

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || !isFinite(v)) fail('need finite numbers');
    }
  }

  function assertVec3(v, what) {
    if (!Array.isArray(v) || v.length !== 3) fail(what + ' needs [x,y,z]');
    assertFinite(v[0], v[1], v[2]);
  }

  function assertMat3(m, what) {
    if (!Array.isArray(m) || m.length !== 9) fail(what + ' needs 9 numbers');
    for (var i = 0; i < 9; i++) {
      if (typeof m[i] !== 'number' || !isFinite(m[i])) {
        fail(what + ' needs finite numbers');
      }
    }
  }

  function checkPose(p) {
    if (!p || typeof p !== 'object') fail('pose needed');
    assertVec3(p.t, 'pose.t');
    assertMat3(p.rm, 'pose.rm');
    if (typeof p.s !== 'number' || !isFinite(p.s) || p.s <= 0) {
      fail('pose.s needs a positive number');
    }
    return p;
  }

  function createPose() {
    return { t: [0, 0, 0], rm: IDENTITY9.slice(), s: 1 };
  }

  function clonePose(p) {
    checkPose(p);
    return { t: p.t.slice(), rm: p.rm.slice(), s: p.s };
  }

  function isIdentityPose(p) {
    checkPose(p);
    if (p.t[0] !== 0 || p.t[1] !== 0 || p.t[2] !== 0) return false;
    if (p.s !== 1) return false;
    for (var i = 0; i < 9; i++) {
      if (p.rm[i] !== IDENTITY9[i]) return false;
    }
    return true;
  }

  function bboxCenter(verts) {
    if (!Array.isArray(verts) || verts.length < 1) {
      fail('need >= 1 vertex');
    }
    var minX = verts[0].x, maxX = verts[0].x;
    var minY = verts[0].y, maxY = verts[0].y;
    var minZ = verts[0].z, maxZ = verts[0].z;
    for (var i = 0; i < verts.length; i++) {
      assertFinite(verts[i].x, verts[i].y, verts[i].z);
      if (verts[i].x < minX) minX = verts[i].x;
      if (verts[i].x > maxX) maxX = verts[i].x;
      if (verts[i].y < minY) minY = verts[i].y;
      if (verts[i].y > maxY) maxY = verts[i].y;
      if (verts[i].z < minZ) minZ = verts[i].z;
      if (verts[i].z > maxZ) maxZ = verts[i].z;
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2 };
  }

  function matMul3(a, b) {
    assertMat3(a, 'a');
    assertMat3(b, 'b');
    var o = new Array(9);
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] +
          a[r * 3 + 2] * b[6 + c];
      }
    }
    return o;
  }

  // Rodrigues rotation matrix for a unit axis and angle (radians).
  function axisAngleMatrix(ax, ay, az, angle) {
    assertFinite(ax, ay, az, angle);
    var len = Math.sqrt(ax * ax + ay * ay + az * az);
    if (!(len > 0)) fail('rotation axis must be nonzero');
    var x = ax / len, y = ay / len, z = az / len;
    var c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
    return [
      t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c
    ];
  }

  // World-frame rotation: premultiply so locked-axis spins stay put no
  // matter how the model already turned.
  function rotateAboutAxis(rm, axis, angle) {
    assertMat3(rm, 'rm');
    assertVec3(axis, 'axis');
    assertFinite(angle);
    return matMul3(axisAngleMatrix(axis[0], axis[1], axis[2], angle), rm);
  }

  // v' = R * (s * (v - c)) + c + t. Pure: input verts untouched.
  function applyPose(verts, pose, center) {
    checkPose(pose);
    if (!Array.isArray(verts)) fail('verts must be an array');
    if (!center || typeof center !== 'object') fail('center needed');
    assertFinite(center.x, center.y, center.z);
    var out = [];
    for (var i = 0; i < verts.length; i++) {
      assertFinite(verts[i].x, verts[i].y, verts[i].z);
      var x = (verts[i].x - center.x) * pose.s;
      var y = (verts[i].y - center.y) * pose.s;
      var z = (verts[i].z - center.z) * pose.s;
      var m = pose.rm;
      out.push({
        x: m[0] * x + m[1] * y + m[2] * z + center.x + pose.t[0],
        y: m[3] * x + m[4] * y + m[5] * z + center.y + pose.t[1],
        z: m[6] * x + m[7] * y + m[8] * z + center.z + pose.t[2]
      });
    }
    return out;
  }

  // Rest-stage mapping: posed mm verts into the widget's stage space
  // with the ORIGINAL normalize transform, so translation and scale
  // stay visible instead of being recentered away.
  function stageWithRest(mmVerts, rest) {
    if (!Array.isArray(mmVerts)) fail('verts must be an array');
    if (!rest || typeof rest !== 'object') fail('rest transform needed');
    assertFinite(rest.cx, rest.cy, rest.cz, rest.scale);
    if (!(rest.scale > 0)) fail('rest scale must be positive');
    var out = [];
    for (var i = 0; i < mmVerts.length; i++) {
      assertFinite(mmVerts[i].x, mmVerts[i].y, mmVerts[i].z);
      out.push({
        x: (mmVerts[i].x - rest.cx) * rest.scale,
        y: (mmVerts[i].y - rest.cy) * rest.scale,
        z: (mmVerts[i].z - rest.cz) * rest.scale
      });
    }
    return out;
  }

  // Exact inverse of the reconstruct contract: 3D (x, y, z) reads as
  // elevation (x, y) and plan (x, -z). Points keep vertex order;
  // segments pass edge indices through.
  function reproject(verts, edges) {
    if (!Array.isArray(verts)) fail('verts must be an array');
    if (!Array.isArray(edges)) fail('edges must be an array');
    var elev = [], plan = [];
    for (var i = 0; i < verts.length; i++) {
      assertFinite(verts[i].x, verts[i].y, verts[i].z);
      elev.push({ x: verts[i].x, y: verts[i].y });
      plan.push({ x: verts[i].x, y: -verts[i].z });
    }
    var segs = [];
    for (var e = 0; e < edges.length; e++) {
      if (!Array.isArray(edges[e]) || edges[e].length !== 2) {
        fail('edge ' + e + ' needs [a,b]');
      }
      var a = edges[e][0], b = edges[e][1];
      if (typeof a !== 'number' || typeof b !== 'number' ||
          a < 0 || b < 0 || a >= verts.length || b >= verts.length) {
        fail('edge ' + e + ' indexes out of range');
      }
      segs.push([a, b]);
    }
    return { elev: { pts: elev, segs: segs }, plan: { pts: plan, segs: segs } };
  }

  // Follow similarities: each drawn view rides the 3D pose by the 2D
  // similarity (rotation + uniform scale + shift) that best carries
  // the rest projection to the posed projection (Kabsch, closed
  // form). Rigid in-plane 3D moves fit exactly; foreshortening moves
  // fit by least squares, which is the honest "what-if" read for a
  // viz mode. A sim is {angle, scale, tx, ty}: p' = s*R(a)*p + t.
  function checkSim(sim, what) {
    if (!sim || typeof sim !== 'object') fail(what + ' needs a similarity');
    assertFinite(sim.angle, sim.tx, sim.ty);
    if (sim.sx !== undefined || sim.sy !== undefined) {
      assertFinite(sim.sx, sim.sy);
      if (!(sim.sy >= 0) || (sim.sx === 0 && sim.sy === 0)) {
        fail(what + ' needs live scales');
      }
    } else {
      assertFinite(sim.scale);
      if (!(sim.scale > 0)) fail(what + ' needs a live scale');
    }
    return sim;
  }

  // Per-axis scales of either sim shape: legacy {scale} reads as
  // uniform, follow {sx, sy} reads as anisotropic.
  function scalesOf(sim) {
    checkSim(sim, 'sim');
    if (sim.sx !== undefined || sim.sy !== undefined) {
      return { sx: sim.sx, sy: sim.sy };
    }
    return { sx: sim.scale, sy: sim.scale };
  }

  function checkPts2(pts, what) {
    if (!Array.isArray(pts)) fail(what + ' must be an array');
    for (var i = 0; i < pts.length; i++) {
      if (!pts[i] || typeof pts[i] !== 'object') fail(what + ' needs {x,y}');
      assertFinite(pts[i].x, pts[i].y);
    }
    return pts;
  }

  function similarity2D(restPts, posedPts) {
    checkPts2(restPts, 'rest');
    checkPts2(posedPts, 'posed');
    if (restPts.length !== posedPts.length) {
      fail('rest and posed need matching lengths');
    }
    var n = restPts.length;
    if (n === 0) return { angle: 0, scale: 1, tx: 0, ty: 0 };
    var rcx = 0, rcy = 0, qcx = 0, qcy = 0, i;
    for (i = 0; i < n; i++) {
      rcx += restPts[i].x; rcy += restPts[i].y;
      qcx += posedPts[i].x; qcy += posedPts[i].y;
    }
    rcx /= n; rcy /= n; qcx /= n; qcy /= n;
    var sxx = 0, sqq = 0, dot = 0, cross = 0;
    for (i = 0; i < n; i++) {
      var px = restPts[i].x - rcx, py = restPts[i].y - rcy;
      var qx = posedPts[i].x - qcx, qy = posedPts[i].y - qcy;
      sxx += px * px + py * py;
      sqq += qx * qx + qy * qy;
      dot += px * qx + py * qy;
      cross += px * qy - py * qx;
    }
    if (!(sxx > 0)) {
      return { angle: 0, scale: 1, tx: qcx - rcx, ty: qcy - rcy };
    }
    var angle = Math.atan2(cross, dot);
    var scale = Math.sqrt(sqq / sxx);
    var ca = Math.cos(angle), sa = Math.sin(angle);
    return {
      angle: angle,
      scale: scale,
      tx: qcx - scale * (ca * rcx - sa * rcy),
      ty: qcy - scale * (sa * rcx + ca * rcy)
    };
  }

  // Follow fit: rotation + INDEPENDENT x/y scales + shift, the
  // smallest map that foreshortens honestly (a Y spin narrows the
  // elevation's width while its height stays exact; a uniform
  // similarity would freeze it or squash it). Returns {angle, sx,
  // sy, scale, tx, ty} with scale = signed sqrt(|sx*sy|): negative
  // exactly when the data mirrors (a Z spin past 90 mirrors the
  // plan's x), in which case the flip is normalized onto x so sy
  // stays exact and arcs remap deterministically. Falls back to the
  // legacy similarity (converted) only when the rest set is
  // degenerate (a point, a horizontal/vertical line). Zero on one
  // axis is an honest edge-on read (that view is now a line).
  function follow2D(restPts, posedPts) {
    checkPts2(restPts, 'rest');
    checkPts2(posedPts, 'posed');
    if (restPts.length !== posedPts.length) {
      fail('rest and posed need matching lengths');
    }
    var fromSim = function () {
      var s = similarity2D(restPts, posedPts);
      return { angle: s.angle, sx: s.scale, sy: s.scale,
        scale: s.scale, tx: s.tx, ty: s.ty };
    };
    var n = restPts.length;
    if (n === 0) {
      return { angle: 0, sx: 1, sy: 1, scale: 1, tx: 0, ty: 0 };
    }
    var rcx = 0, rcy = 0, qcx = 0, qcy = 0, i;
    for (i = 0; i < n; i++) {
      rcx += restPts[i].x; rcy += restPts[i].y;
      qcx += posedPts[i].x; qcy += posedPts[i].y;
    }
    rcx /= n; rcy /= n; qcx /= n; qcy /= n;
    var sxx = 0, syy = 0, dot = 0, cross = 0;
    for (i = 0; i < n; i++) {
      var px = restPts[i].x - rcx, py = restPts[i].y - rcy;
      var qx = posedPts[i].x - qcx, qy = posedPts[i].y - qcy;
      sxx += px * px; syy += py * py;
      dot += px * qx + py * qy;
      cross += px * qy - py * qx;
    }
    if (!(sxx > 0) || !(syy > 0)) return fromSim();
    var angle = Math.atan2(cross, dot);
    var ca = Math.cos(angle), sa = Math.sin(angle);
    var nx = 0, ny = 0;
    for (i = 0; i < n; i++) {
      var rx = restPts[i].x - rcx, ry = restPts[i].y - rcy;
      var zx = posedPts[i].x - qcx, zy = posedPts[i].y - qcy;
      nx += (ca * zx + sa * zy) * rx;
      ny += (-sa * zx + ca * zy) * ry;
    }
    var sx = nx / sxx, sy = ny / syy;
    if (sx < 0 && sx > -1e-9) sx = 0;
    if (sy < 0 && sy > -1e-9) sy = 0;
    if (sy < 0) {
      angle += Math.PI;
      if (angle > Math.PI) angle -= 2 * Math.PI;
      sx = -sx; sy = -sy;
      ca = Math.cos(angle); sa = Math.sin(angle);
    }
    var area = Math.sqrt(Math.abs(sx * sy));
    return {
      angle: angle,
      sx: sx,
      sy: sy,
      scale: sx < 0 ? -area : area,
      tx: qcx - (ca * sx * rcx - sa * sy * rcy),
      ty: qcy - (sa * sx * rcx + ca * sy * rcy)
    };
  }

  function applyFollow(sim, x, y) {
    var s = scalesOf(sim);
    assertFinite(x, y);
    var ca = Math.cos(sim.angle), sa = Math.sin(sim.angle);
    return {
      x: ca * s.sx * x - sa * s.sy * y + sim.tx,
      y: sa * s.sx * x + ca * s.sy * y + sim.ty
    };
  }

  function applySimilarity(sim, x, y) {
    return applyFollow(sim, x, y);
  }

  // Y half-extent of a unit circle through a sim: exact rim reach
  // for circles under anisotropic scales (legacy uniform sims read
  // exactly r * scale, as before; mirrors square away).
  function radiusExtentY(sim) {
    var s = scalesOf(sim);
    var ca = Math.cos(sim.angle), sa = Math.sin(sim.angle);
    return Math.sqrt(sa * s.sx * sa * s.sx + ca * s.sy * ca * s.sy);
  }

  // Image of a rest direction angle through a sim. Exact for
  // similarities (angle + turn, as before) and for mirror x (which
  // reads the flipped direction); the best endpoint read under
  // anisotropic scales, whose true arcs are elliptical.
  function followAngle(sim, phi) {
    var s = scalesOf(sim);
    assertFinite(phi);
    return sim.angle +
      Math.atan2(s.sy * Math.sin(phi), s.sx * Math.cos(phi));
  }

  // View sides of the XY line: world y >= 0 is elevation (VP).
  function classifySide(y) {
    assertFinite(y);
    return y >= 0 ? 'elev' : 'plan';
  }

  // Datum routing: which view's sim moves a drawn point. Nonzero y
  // routes geometrically (a spanning projector stretches instead of
  // detaching). Points exactly ON the line are ambiguous by
  // construction — a plan top edge and an elevation bottom edge
  // coincide there — so ties break by viewRole (PLAN rides plan,
  // ELEVATION and PROFILE ride elevation, matching the reconstruct
  // grouping), then by the segment's other endpoint, then elevation
  // (legacy default). force pins every point to one view; the page
  // uses it to draw role-less datum geometry in BOTH views (see
  // routeCopies), which is the only honest read of a shared edge.
  function routeSide(y, ent, otherY, force) {
    assertFinite(y);
    if (force === 'elev' || force === 'plan') return force;
    if (y > 0) return 'elev';
    if (y < 0) return 'plan';
    var role = ent ? ent.viewRole : undefined;
    if (role === 'PLAN') return 'plan';
    if (role === 'ELEVATION' || role === 'PROFILE') return 'elev';
    if (typeof otherY === 'number' && otherY !== 0) {
      return otherY > 0 ? 'elev' : 'plan';
    }
    return 'elev';
  }

  // Copies a datum-ambiguous entity needs: role-less two-point
  // geometry lying exactly ON the line, and role-less single points
  // sitting on it, belong to both views at once (their plan and
  // elevation readings coincide at rest), so they draw and clamp
  // under each sim. Everything else rides one sim. DATUM_AXIS is
  // never dual: the line is the fixed reference.
  function routeCopies(ent) {
    if (!ent || typeof ent !== 'object') fail('entity needed');
    if (ent.type === 'DATUM_AXIS') return [undefined];
    var role = ent.viewRole;
    if (role === 'PLAN' || role === 'ELEVATION' || role === 'PROFILE') {
      return [undefined];
    }
    var two = POSE_TWO_POINT_TYPES.indexOf(ent.type) !== -1 &&
      typeof ent.x2 === 'number' && typeof ent.y2 === 'number';
    if (two) {
      return (ent.y === 0 && ent.y2 === 0) ? ['elev', 'plan'] : [undefined];
    }
    return (ent.y === 0) ? ['elev', 'plan'] : [undefined];
  }

  function checkForce(force) {
    if (force !== undefined && force !== 'elev' && force !== 'plan') {
      fail('force must be elev, plan, or omitted');
    }
    return force;
  }

  // Contact pairs of one entity: rest-y, posed-y, and bound side of
  // every drawn point the datum clamp watches — anchor, second
  // endpoint, and the circle rim extremes. DATUM_AXIS yields none:
  // the XY line is the fixed reference, never a crossing body. Rim
  // extremes inherit the anchor's side at ties, so a plan circle
  // touching the line may sink plan-ward without tripping.
  function contactPoints(ent, simElev, simPlan, force) {
    if (!ent || typeof ent !== 'object') fail('entity needed');
    checkSim(simElev, 'simElev');
    checkSim(simPlan, 'simPlan');
    checkForce(force);
    if (ent.type === 'DATUM_AXIS') return [];
    var two = POSE_TWO_POINT_TYPES.indexOf(ent.type) !== -1 &&
      typeof ent.x2 === 'number' && typeof ent.y2 === 'number';
    var simOf = function (side) { return side === 'elev' ? simElev : simPlan; };
    var out = [];
    var sa = routeSide(ent.y, ent, two ? ent.y2 : undefined, force);
    var a = applyFollow(simOf(sa), ent.x, ent.y);
    out.push({ ry: ent.y, py: a.y, side: sa });
    if (two) {
      var sb = routeSide(ent.y2, ent, ent.y, force);
      var b = applyFollow(simOf(sb), ent.x2, ent.y2);
      out.push({ ry: ent.y2, py: b.y, side: sb });
    }
    if (typeof ent.radius === 'number' && ent.radius !== 0) {
      var r = ent.radius * radiusExtentY(simOf(sa));
      var lo = ent.y - ent.radius, hi = ent.y + ent.radius;
      out.push({ ry: lo, py: a.y - r,
        side: routeSide(lo, ent, ent.y, force) });
      out.push({ ry: hi, py: a.y + r,
        side: routeSide(hi, ent, ent.y, force) });
    }
    return out;
  }

  // Datum hold: a posed point stays on its bound side of the XY line
  // (touching within CONTACT_EPS is still holding). The side
  // defaults to the rest sign, exactly as before; callers pass the
  // contact pair's side so datum ties bind to their own view.
  function holdsSide(restY, posedY, side) {
    assertFinite(restY, posedY);
    var s = (side === undefined || side === null) ? classifySide(restY) : side;
    if (s !== 'elev' && s !== 'plan') fail('side must be elev or plan');
    if (s === 'elev') return posedY >= -CONTACT_EPS;
    return posedY <= CONTACT_EPS;
  }

  // Entity kinds whose second point is drawn geometry (mirrors the
  // table's two-point rule); every other kind rides on its anchor.
  // Dummy x2/y2 on single-point entities must stay put, or the XY
  // clamp would trip on geometry that was never drawn.
  var POSE_TWO_POINT_TYPES = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION',
    'DATUM_AXIS'];

  // Reference ink the sheet holds fixed in pose mode: centre axes and
  // locus lines are drawing furniture, not part geometry. A spanning
  // elevation axis ridden endpoint-wise would tilt into a diagonal
  // across the sheet (each end follows its own view's map), so the
  // page draws pinned entities unposed, exactly like DATUM_AXIS, and
  // skips them in the datum clamp. poseCopies/poseEntity stay purely
  // mechanical (riderless helpers still fit); this predicate is the
  // page's riding policy, kept here so tests can pin it. Projectors
  // and hidden edges are NOT pinned: they are live correspondence.
  var POSE_PINNED_KINDS = ['axis', 'locus'];
  function isPosePinned(ent) {
    if (!ent || typeof ent !== 'object') return false;
    if (ent.type === 'DATUM_AXIS') return true;
    return !!(ent.meta && POSE_PINNED_KINDS.indexOf(ent.meta.kind) !== -1);
  }

  // Posed render copy of one entity: each drawn point rides its own
  // view's follow map (see routeSide), so a projector spanning the XY
  // line stretches instead of detaching. Geometric side wins over
  // viewRole off the line: a point below it rides with plan even on
  // an ELEVATION entity, so Y slides never drag plan-side geometry
  // across the datum; on the line the role breaks the tie. force
  // pins the whole copy to one view for dual-drawn datum geometry.
  // DATUM_AXIS passes through untouched (the XY line is the fixed
  // reference). Never mutates the input.
  function copyEntity(ent) {
    var out = {};
    for (var k in ent) {
      if (Object.prototype.hasOwnProperty.call(ent, k)) out[k] = ent[k];
    }
    return out;
  }

  // Fresh meta object for a posed copy: rider tags must never leak
  // back onto the committed entity through the shared reference.
  function copyMeta(meta) {
    var out = {};
    if (meta && typeof meta === 'object') {
      for (var k in meta) {
        if (Object.prototype.hasOwnProperty.call(meta, k)) out[k] = meta[k];
      }
    }
    return out;
  }

  function unionRiders(a, b) {
    var out = Array.isArray(a) ? a.slice() : [];
    (Array.isArray(b) ? b : []).forEach(function (i) {
      if (out.indexOf(i) === -1) out.push(i);
    });
    return out;
  }

  // Fitted size/angle finish for a posed copy: circle radius keeps its
  // area under the anchor view's scales, arc angles remap through the
  // same map (mirrors swap the sweep). Approximate under anisotropic
  // scales, where true circles image as ellipses; exact for
  // similarities. Shared by the fitted and exact-riding copies.
  function finishApprox(out, ent, csim) {
    if (typeof ent.radius === 'number' && ent.radius !== 0) {
      var rs = scalesOf(csim);
      out.radius = ent.radius * Math.sqrt(Math.abs(rs.sx * rs.sy));
    }
    if (ent.type === 'CIRCULAR_ARC' && typeof ent.startAngle === 'number' && typeof ent.endAngle === 'number') {
      var scale = scalesOf(csim);
      function angle(value) { return followAngle(csim, value * Geometry.RAD) / Geometry.RAD; }
      if (scale.sx * scale.sy < 0) {
        out.startAngle = angle(ent.endAngle);
        out.endAngle = angle(ent.startAngle);
      } else {
        out.startAngle = angle(ent.startAngle);
        out.endAngle = angle(ent.endAngle);
      }
      // Retain a normalized positive CCW sweep across the atan2 branch cut.
      out.endAngle = out.startAngle + Geometry.arcSweep(out.startAngle, out.endAngle);
    }
    return out;
  }

  function poseEntity(ent, simElev, simPlan, force) {
    if (!ent || typeof ent !== 'object') fail('entity needed');
    checkSim(simElev, 'simElev');
    checkSim(simPlan, 'simPlan');
    checkForce(force);
    if (ent.type === 'DATUM_AXIS') return ent;
    var two = POSE_TWO_POINT_TYPES.indexOf(ent.type) !== -1 &&
      typeof ent.x2 === 'number' && typeof ent.y2 === 'number';
    var simOf = function (side) { return side === 'elev' ? simElev : simPlan; };
    var out = copyEntity(ent);
    var sa = routeSide(ent.y, ent, two ? ent.y2 : undefined, force);
    var a = applyFollow(simOf(sa), ent.x, ent.y);
    out.x = a.x; out.y = a.y;
    if (two) {
      var sb = routeSide(ent.y2, ent, ent.y, force);
      var b = applyFollow(simOf(sb), ent.x2, ent.y2);
      out.x2 = b.x; out.y2 = b.y;
    }
    return finishApprox(out, ent, simOf(sa));
  }

  // Exact riding: drawn ink sitting on a solid vertex rides that vertex
  // instead of the fitted similarity, so dots, labels, and projector
  // feet stay glued to the exact overlay when a pose splits coincident
  // geometry (a Z spin parts the prism's plan rings, which no single
  // similarity can follow). A drawn point rides the vertices whose rest
  // projection it touches within POSE_SNAP_EPS; anything else keeps the
  // fitted copy, exactly as before. Rest-anchored (correspondence never
  // drifts mid-gesture), deduped (coincident points merge, collinear
  // overlapping segments merge to their union, so rest poses draw
  // exactly as before).
  var POSE_SNAP_EPS = 1e-6;

  function edgeKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }

  // Compact exact-riding lookup: rest and posed per-view projections
  // (reproject shapes, same vertex order) plus the solid edge set.
  function exactIndex(rest2D, now2D, edges) {
    if (!rest2D || typeof rest2D !== 'object' ||
        !rest2D.elev || !rest2D.plan) {
      fail('rest2D needs elev and plan views');
    }
    if (!now2D || typeof now2D !== 'object' ||
        !now2D.elev || !now2D.plan) {
      fail('now2D needs elev and plan views');
    }
    checkPts2(rest2D.elev.pts, 'rest elev');
    checkPts2(rest2D.plan.pts, 'rest plan');
    checkPts2(now2D.elev.pts, 'posed elev');
    checkPts2(now2D.plan.pts, 'posed plan');
    var n = rest2D.elev.pts.length;
    if (rest2D.plan.pts.length !== n || now2D.elev.pts.length !== n ||
        now2D.plan.pts.length !== n) {
      fail('rest and posed views need matching vertex counts');
    }
    if (!Array.isArray(edges)) fail('edges must be an array');
    var edgeSet = {};
    for (var i = 0; i < edges.length; i++) {
      if (!Array.isArray(edges[i]) || edges[i].length !== 2) {
        fail('edge ' + i + ' needs [a,b]');
      }
      var a = edges[i][0], b = edges[i][1];
      if (typeof a !== 'number' || typeof b !== 'number' ||
          a < 0 || b < 0 || a >= n || b >= n ||
          a !== Math.floor(a) || b !== Math.floor(b)) {
        fail('edge ' + i + ' indexes out of range');
      }
      edgeSet[edgeKey(a, b)] = true;
    }
    return { rest: rest2D, now: now2D, edgeSet: edgeSet };
  }

  function ridersOf(index, view, x, y) {
    assertFinite(x, y);
    var pts = view === 'elev' ? index.rest.elev.pts : index.rest.plan.pts;
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      if (Math.abs(pts[i].x - x) <= POSE_SNAP_EPS &&
          Math.abs(pts[i].y - y) <= POSE_SNAP_EPS) out.push(i);
    }
    return out;
  }

  function nowAt(index, view, i) {
    var pts = view === 'elev' ? index.now.elev.pts : index.now.plan.pts;
    return { x: pts[i].x, y: pts[i].y };
  }

  function samePlace(p, q) {
    return Math.abs(p.x - q.x) <= POSE_SNAP_EPS &&
      Math.abs(p.y - q.y) <= POSE_SNAP_EPS;
  }

  function dedupePoints(copies) {
    // Merged copies union their rider tags: at rest one copy stands
    // for every corner still stacked on it, so annotations keep the
    // full caption until the corners genuinely part.
    var kept = [];
    copies.forEach(function (cp) {
      for (var j = 0; j < kept.length; j++) {
        if (samePlace(cp, kept[j])) {
          var km = copyMeta(kept[j].meta);
          var cm = cp.meta || {};
          kept[j].meta = km;
          km.poseRiders = unionRiders(km.poseRiders, cm.poseRiders);
          return;
        }
      }
      kept.push(cp);
    });
    return kept;
  }

  function lineDist(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len = Math.hypot(dx, dy);
    if (!(len > 0)) return Math.hypot(px - ax, py - ay);
    return Math.abs((px - ax) * dy - (py - ay) * dx) / len;
  }

  // Near-collinear with overlapping range: the two copies read as one
  // line (per-corner projectors at rest overlap on the original line;
  // parted corners fail the distance test and stay split).
  function collinearOverlap(a, b) {
    var eps = POSE_SNAP_EPS;
    if (lineDist(a.x, a.y, b.x, b.y, b.x2, b.y2) > eps) return false;
    if (lineDist(a.x2, a.y2, b.x, b.y, b.x2, b.y2) > eps) return false;
    if (lineDist(b.x, b.y, a.x, a.y, a.x2, a.y2) > eps) return false;
    if (lineDist(b.x2, b.y2, a.x, a.y, a.x2, a.y2) > eps) return false;
    var dx = a.x2 - a.x, dy = a.y2 - a.y;
    if (!(Math.abs(dx) + Math.abs(dy) > 0)) {
      dx = b.x2 - b.x; dy = b.y2 - b.y;
    }
    if (!(Math.abs(dx) + Math.abs(dy) > 0)) return true;
    var len = Math.hypot(dx, dy);
    dx /= len; dy /= len;
    var t = function (x, y) { return x * dx + y * dy; };
    var lo = Math.max(Math.min(t(a.x, a.y), t(a.x2, a.y2)),
      Math.min(t(b.x, b.y), t(b.x2, b.y2)));
    var hi = Math.min(Math.max(t(a.x, a.y), t(a.x2, a.y2)),
      Math.max(t(b.x, b.y), t(b.x2, b.y2)));
    return hi >= lo - eps;
  }

  // Coincident ink draws once: transitively merge near-collinear
  // overlapping copies, each group redrawn as its bounding union, so a
  // rest projector renders as its whole original line while parted
  // corners keep their own readings.
  function dedupeSegs(segs) {
    var groups = [];
    segs.forEach(function (sg) {
      var placed = false;
      for (var g = 0; g < groups.length; g++) {
        var members = groups[g];
        for (var m = 0; m < members.length; m++) {
          if (collinearOverlap(members[m], sg)) {
            members.push(sg);
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed) groups.push([sg]);
    });
    return groups.map(function (grp) {
      if (grp.length === 1) return grp[0];
      var dx = grp[0].x2 - grp[0].x, dy = grp[0].y2 - grp[0].y;
      if (!(Math.abs(dx) + Math.abs(dy) > 0)) { dx = 1; dy = 0; }
      var len = Math.hypot(dx, dy);
      dx /= len; dy /= len;
      var nx = -dy, ny = dx;
      var off = grp[0].x * nx + grp[0].y * ny;
      var lo = Infinity, hi = -Infinity;
      grp.forEach(function (cp) {
        [[cp.x, cp.y], [cp.x2, cp.y2]].forEach(function (p) {
          var t = p[0] * dx + p[1] * dy;
          if (t < lo) lo = t;
          if (t > hi) hi = t;
        });
      });
      var out = copyEntity(grp[0]);
      out.x = dx * lo + nx * off; out.y = dy * lo + ny * off;
      out.x2 = dx * hi + nx * off; out.y2 = dy * hi + ny * off;
      return out;
    });
  }

  function distToSeg2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (!(len2 > 0)) return Math.hypot(px - ax, py - ay);
    var t = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // Every solid corner a rest segment touches (endpoints and interior
  // through-points alike, either view): the cross-view correspondence
  // a spanning line carries. Endpoint riders are always a subset (both
  // ends lie on the segment).
  function touchedBy(index, ent) {
    var out = [];
    var n = index.rest.elev.pts.length;
    for (var i = 0; i < n; i++) {
      var e = index.rest.elev.pts[i], p = index.rest.plan.pts[i];
      if (distToSeg2(e.x, e.y, ent.x, ent.y, ent.x2, ent.y2) <= POSE_SNAP_EPS ||
          distToSeg2(p.x, p.y, ent.x, ent.y, ent.x2, ent.y2) <= POSE_SNAP_EPS) {
        out.push(i);
      }
    }
    return out;
  }

  // Posed render copies with exact riding (see above). Points emit one
  // copy per ridden vertex. Spanning two-point entities are cross-view
  // correspondence: every solid corner the rest line touches gets its
  // own true projector, endpoints pinned to their own views. Same-view
  // two-point entities read edge-wise (a drawn outline stands for the
  // solid edges joining its ridden endpoints). Either falls back to the
  // single fitted copy when nothing qualifies; index null/omitted
  // disables snapping entirely. Never mutates inputs.
  function poseCopies(ent, simElev, simPlan, force, index) {
    if (!ent || typeof ent !== 'object') fail('entity needed');
    checkSim(simElev, 'simElev');
    checkSim(simPlan, 'simPlan');
    checkForce(force);
    if (ent.type === 'DATUM_AXIS') return [ent];
    var fitted = function () {
      return [poseEntity(ent, simElev, simPlan, force)];
    };
    if (!index) return fitted();
    var two = POSE_TWO_POINT_TYPES.indexOf(ent.type) !== -1 &&
      typeof ent.x2 === 'number' && typeof ent.y2 === 'number';
    var simOf = function (side) { return side === 'elev' ? simElev : simPlan; };
    if (!two) {
      var s = routeSide(ent.y, ent, undefined, force);
      var riders = ridersOf(index, s, ent.x, ent.y);
      if (riders.length === 0) return fitted();
      var copies = [];
      riders.forEach(function (i) {
        var out = copyEntity(ent);
        var q = nowAt(index, s, i);
        out.x = q.x; out.y = q.y;
        out.meta = copyMeta(ent.meta);
        out.meta.poseRiders = [i];
        copies.push(finishApprox(out, ent, simOf(s)));
      });
      return dedupePoints(copies);
    }
    var sa = routeSide(ent.y, ent, ent.y2, force);
    var sb = routeSide(ent.y2, ent, ent.y, force);
    if (sa !== sb) {
      var touched = touchedBy(index, ent);
      if (touched.length === 0) return fitted();
      var pros = touched.map(function (v) {
        var out = copyEntity(ent);
        var q1 = nowAt(index, sa, v);
        var q2 = nowAt(index, sb, v);
        out.x = q1.x; out.y = q1.y; out.x2 = q2.x; out.y2 = q2.y;
        return finishApprox(out, ent, simOf(sa));
      });
      return dedupeSegs(pros);
    }
    var A = ridersOf(index, sa, ent.x, ent.y);
    var B = ridersOf(index, sb, ent.x2, ent.y2);
    var pairs = [];
    A.forEach(function (a) {
      B.forEach(function (b) {
        if (a !== b && index.edgeSet[edgeKey(a, b)]) pairs.push([a, b]);
      });
    });
    if (pairs.length === 0) return fitted();
    var segs = pairs.map(function (pr) {
      var out = copyEntity(ent);
      var qa = nowAt(index, sa, pr[0]);
      var qb = nowAt(index, sb, pr[1]);
      out.x = qa.x; out.y = qa.y; out.x2 = qb.x; out.y2 = qb.y;
      return finishApprox(out, ent, simOf(sa));
    });
    return dedupeSegs(segs);
  }

  // Stack-split captions: a multi-part POINT caption ('g,a') names
  // coincident corners; when the pose parts them, each copy keeps only
  // the part naming its own corner. Parts resolve through the mate dot
  // in the other view: a part belongs to the rider whose rest mate
  // position carries that corner's name. Collaborators arrive via ctx
  // ({index, restPoints, splitCaption, bareName, cornerOf}) so this
  // module stays dependency-free; anything missing or unresolvable
  // keeps the full caption — the worst case is today's duplication,
  // never a lost name. Mutates copy captions in place, never the
  // committed entity. Returns copies.
  function splitStackCaption(ent, copies, force, ctx) {
    if (!ent || ent.type !== 'POINT' || !Array.isArray(copies) ||
        copies.length < 2) {
      return copies;
    }
    if (!ctx || !ctx.index || !ctx.index.rest ||
        !Array.isArray(ctx.restPoints)) {
      return copies;
    }
    if (typeof ctx.splitCaption !== 'function' ||
        typeof ctx.bareName !== 'function' ||
        typeof ctx.cornerOf !== 'function') {
      return copies;
    }
    var parts = ctx.splitCaption(ent.caption || '');
    if (!Array.isArray(parts) || parts.length < 2) return copies;
    var side = routeSide(ent.y, ent, undefined, force);
    var mateSide = side === 'plan' ? 'elev' : 'plan';
    var mateView = mateSide === 'plan' ?
      ctx.index.rest.plan : ctx.index.rest.elev;
    if (!mateView || !Array.isArray(mateView.pts)) return copies;
    var cornerOf = function (p) { return ctx.cornerOf(ctx.bareName(p)); };
    copies.forEach(function (cp) {
      if (!cp || !cp.meta || !Array.isArray(cp.meta.poseRiders) ||
          cp.meta.poseRiders.length === 0) {
        return;
      }
      var mine = [];
      cp.meta.poseRiders.forEach(function (i) {
        var mp = mateView.pts[i];
        if (!mp) return;
        ctx.restPoints.forEach(function (m) {
          if (!m || m.type !== 'POINT') return;
          if (Math.abs(m.x - mp.x) > POSE_SNAP_EPS ||
              Math.abs(m.y - mp.y) > POSE_SNAP_EPS) {
            return;
          }
          if (routeSide(m.y, m, undefined, undefined) !== mateSide) return;
          var mates = ctx.splitCaption(m.caption || '').map(cornerOf);
          parts.forEach(function (p) {
            if (mates.indexOf(cornerOf(p)) !== -1 && mine.indexOf(p) === -1) {
              mine.push(p);
            }
          });
        });
      });
      if (mine.length > 0) cp.caption = mine.join(',');
    });
    return copies;
  }

  // Per-view follow maps for a pose: pose the mm verts about the
  // center, reproject, and fit each rest view to its posed view.
  // Returns {elev, plan, posed, now} — the two follow maps plus the
  // posed verts and their exact reprojection, which the datum clamp
  // measures (drawn entities can only approximate it).
  function simsForPose(verts, edges, pose, center, rest2D) {
    if (!rest2D || typeof rest2D !== 'object' ||
        !rest2D.elev || !rest2D.plan) {
      fail('rest2D needs elev and plan views');
    }
    var posed = applyPose(verts, pose, center);
    var now = reproject(posed, edges);
    return {
      elev: follow2D(rest2D.elev.pts, now.elev.pts),
      plan: follow2D(rest2D.plan.pts, now.plan.pts),
      posed: posed,
      now: now
    };
  }

  // True-projection contact pairs: every reprojected vertex bound to
  // its own view's side of the XY line, absolutely — elevation may
  // sit on the line but never below it, plan never above it. This is
  // the one datum rule, measured on exact projections rather than
  // fitted similarities, so no fit can hide a crossing or invent one.
  function projectionPairs(rest2D, posed2D) {
    if (!rest2D || typeof rest2D !== 'object' ||
        !rest2D.elev || !rest2D.plan) {
      fail('rest2D needs elev and plan views');
    }
    if (!posed2D || typeof posed2D !== 'object' ||
        !posed2D.elev || !posed2D.plan) {
      fail('posed2D needs elev and plan views');
    }
    checkPts2(rest2D.elev.pts, 'rest elev');
    checkPts2(rest2D.plan.pts, 'rest plan');
    checkPts2(posed2D.elev.pts, 'posed elev');
    checkPts2(posed2D.plan.pts, 'posed plan');
    if (rest2D.elev.pts.length !== posed2D.elev.pts.length ||
        rest2D.plan.pts.length !== posed2D.plan.pts.length) {
      fail('rest and posed views need matching lengths');
    }
    var out = [], i;
    for (i = 0; i < rest2D.elev.pts.length; i++) {
      out.push({ ry: rest2D.elev.pts[i].y, py: posed2D.elev.pts[i].y,
        side: 'elev' });
    }
    for (i = 0; i < rest2D.plan.pts.length; i++) {
      out.push({ ry: rest2D.plan.pts[i].y, py: posed2D.plan.pts[i].y,
        side: 'plan' });
    }
    return out;
  }

  // Gesture clamp: largest fraction f in [0,1] whose pose holds.
  // poseAt maps a fraction to a pose; isValid answers the XY wall.
  function limitFraction(poseAt, isValid) {
    if (typeof poseAt !== 'function' || typeof isValid !== 'function') {
      fail('limitFraction needs two functions');
    }
    if (isValid(poseAt(1))) return 1;
    var lo = 0, hi = 1;
    for (var i = 0; i < 12; i++) {
      var mid = (lo + hi) / 2;
      if (isValid(poseAt(mid))) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // Camera basis in world coords from the glass yaw/pitch (inverse of
  // the widget projector): screen-right, screen-up, and view-forward.
  function cameraAxes(yaw, pitch) {
    assertFinite(yaw, pitch);
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    // +0 folds negative zero so rest angles read exactly.
    return {
      right: [cy + 0, 0, sy + 0],
      up: [sp * sy + 0, cp + 0, -sp * cy + 0],
      fwd: [-cp * sy + 0, sp + 0, cp * cy + 0]
    };
  }

  var GESTURE_OPS = ['grab', 'rotate', 'scale'];

  function startGesture(op) {
    if (GESTURE_OPS.indexOf(op) === -1) fail('unknown gesture ' + op);
    return { op: op, axis: null };
  }

  function setGestureAxis(g, axis) {
    if (!g || typeof g !== 'object' || GESTURE_OPS.indexOf(g.op) === -1) {
      fail('gesture needed');
    }
    if (axis !== null && axis !== 'X' && axis !== 'Y' && axis !== 'Z') {
      fail('axis must be X, Y, Z, or null');
    }
    g.axis = axis;
    return g;
  }

  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  // Pure gesture step: start pose + TOTAL mouse travel -> new pose.
  // camera = {yaw, pitch}; opts = {pxPerMm (>0), snap (bool)}.
  function applyGesture(startPose, gesture, dxPx, dyPx, camera, opts) {
    checkPose(startPose);
    if (!gesture || GESTURE_OPS.indexOf(gesture.op) === -1) {
      fail('gesture needed');
    }
    assertFinite(dxPx, dyPx);
    if (!camera || typeof camera !== 'object') fail('camera needed');
    var ppm = opts && opts.pxPerMm;
    if (typeof ppm !== 'number' || !(ppm > 0)) fail('pxPerMm must be positive');
    var snap = !!(opts && opts.snap);
    var out = clonePose(startPose);
    var basis = cameraAxes(camera.yaw, camera.pitch);
    if (gesture.op === 'grab') {
      var wx = (dxPx * basis.right[0] - dyPx * basis.up[0]) / ppm;
      var wy = (dxPx * basis.right[1] - dyPx * basis.up[1]) / ppm;
      var wz = (dxPx * basis.right[2] - dyPx * basis.up[2]) / ppm;
      if (gesture.axis !== null) {
        var a = AXES[gesture.axis];
        var k = dot3([wx, wy, wz], a);
        wx = a[0] * k;
        wy = a[1] * k;
        wz = a[2] * k;
      }
      out.t = [startPose.t[0] + wx, startPose.t[1] + wy, startPose.t[2] + wz];
      if (snap) {
        out.t = out.t.map(function (v) {
          return Math.round(v / SNAP_MM) * SNAP_MM;
        });
      }
      return out;
    }
    if (gesture.op === 'rotate') {
      var angle = dxPx * RAD_PER_PX;
      if (snap) {
        var step = SNAP_DEG * Math.PI / 180;
        angle = Math.round(angle / step) * step;
      }
      var axis = gesture.axis !== null ? AXES[gesture.axis] : basis.fwd;
      out.rm = rotateAboutAxis(startPose.rm, axis, angle);
      return out;
    }
    var factor = Math.exp(-dyPx * SCALE_PER_PX);
    var s = startPose.s * factor;
    if (snap) s = Math.round(s / SNAP_SCALE) * SNAP_SCALE;
    if (s < SCALE_MIN) s = SCALE_MIN;
    if (s > SCALE_MAX) s = SCALE_MAX;
    out.s = s;
    return out;
  }

  function clearTranslation(pose) {
    checkPose(pose);
    pose.t = [0, 0, 0];
    return pose;
  }

  function clearRotation(pose) {
    checkPose(pose);
    pose.rm = IDENTITY9.slice();
    return pose;
  }

  function clearScale(pose) {
    checkPose(pose);
    pose.s = 1;
    return pose;
  }

  function resetPose(pose) {
    checkPose(pose);
    pose.t = [0, 0, 0];
    pose.rm = IDENTITY9.slice();
    pose.s = 1;
    return pose;
  }

  // XYZ-Euler readout (degrees) for the HUD. Display only: the matrix
  // stays the source of truth.
  function eulerXYZOf(rm) {
    assertMat3(rm, 'rm');
    var sy = rm[2];
    if (sy > 1) sy = 1;
    if (sy < -1) sy = -1;
    var y = Math.asin(sy);
    var x, z;
    if (Math.abs(sy) < 0.9999999) {
      x = Math.atan2(-rm[5], rm[8]);
      z = Math.atan2(-rm[1], rm[0]);
    } else {
      x = Math.atan2(rm[3], rm[4]);
      z = 0;
    }
    var d = 180 / Math.PI;
    return [x * d, y * d, z * d];
  }

  // Blender-style key map. key = e.key, code = e.code (may be missing
  // in old browsers). Returns an action name or null (not ours).
  function keyAction(key, code, mods) {
    mods = mods || {};
    var k = String(key === undefined || key === null ? '' : key);
    var c = String(code === undefined || code === null ? '' : code);
    if (k === 'Escape') return 'cancel';
    if (k === 'Enter') return 'confirm';
    if (k === 'Tab') return 'exit-pose';
    if (mods.alt && !mods.ctrl && !mods.meta) {
      var al = k.toLowerCase();
      if (al === 'g') return 'clear-t';
      if (al === 'r') return 'clear-r';
      if (al === 's') return 'clear-s';
      return null;
    }
    if (mods.ctrl || mods.meta || mods.alt) {
      if ((mods.ctrl || mods.meta) && !mods.alt && !mods.shift) {
        if (k === '1' || c === 'Numpad1') return 'view-back';
        if (k === '3' || c === 'Numpad3') return 'view-left';
        if (k === '7' || c === 'Numpad7') return 'view-bottom';
      }
      return null;
    }
    var low = k.toLowerCase();
    if (low === 'g' && k.length === 1) return 'grab';
    if (low === 'r' && k.length === 1) return 'rotate';
    if (low === 's' && k.length === 1) return 'scale';
    if ((low === 'x' || low === 'y' || low === 'z') && k.length === 1) {
      return 'axis-' + low;
    }
    if (k === '1' || c === 'Numpad1') return 'view-front';
    if (k === '3' || c === 'Numpad3') return 'view-right';
    if (k === '7' || c === 'Numpad7') return 'view-top';
    return null;
  }

  return {
    VERSION: VERSION,
    WORLD_UNITS: WORLD_UNITS,
    POSE_PINNED_KINDS: POSE_PINNED_KINDS,
    isPosePinned: isPosePinned,
    AXES: AXES,
    AXIS_COLORS: AXIS_COLORS,
    CONTACT_EPS: CONTACT_EPS,
    POSE_SNAP_EPS: POSE_SNAP_EPS,
    exactIndex: exactIndex,
    poseCopies: poseCopies,
    splitStackCaption: splitStackCaption,
    RAD_PER_PX: RAD_PER_PX,
    SCALE_PER_PX: SCALE_PER_PX,
    SNAP_MM: SNAP_MM,
    SNAP_DEG: SNAP_DEG,
    SNAP_SCALE: SNAP_SCALE,
    SCALE_MIN: SCALE_MIN,
    SCALE_MAX: SCALE_MAX,
    VIEW_PRESETS: VIEW_PRESETS,
    GESTURE_OPS: GESTURE_OPS,
    createPose: createPose,
    clonePose: clonePose,
    isIdentityPose: isIdentityPose,
    bboxCenter: bboxCenter,
    matMul3: matMul3,
    axisAngleMatrix: axisAngleMatrix,
    rotateAboutAxis: rotateAboutAxis,
    applyPose: applyPose,
    stageWithRest: stageWithRest,
    reproject: reproject,
    similarity2D: similarity2D,
    follow2D: follow2D,
    applySimilarity: applySimilarity,
    applyFollow: applyFollow,
    followAngle: followAngle,
    classifySide: classifySide,
    routeSide: routeSide,
    routeCopies: routeCopies,
    contactPoints: contactPoints,
    holdsSide: holdsSide,
    poseEntity: poseEntity,
    simsForPose: simsForPose,
    projectionPairs: projectionPairs,
    limitFraction: limitFraction,
    cameraAxes: cameraAxes,
    startGesture: startGesture,
    setGestureAxis: setGestureAxis,
    applyGesture: applyGesture,
    clearTranslation: clearTranslation,
    clearRotation: clearRotation,
    clearScale: clearScale,
    resetPose: resetPose,
    eulerXYZOf: eulerXYZOf,
    keyAction: keyAction
  };
});

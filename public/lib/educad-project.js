(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADProject = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD exact 2D projection: orthographic Monge views of a 3D solid
  // with per-edge occlusion, for pose mode's live overlay. Pose fits
  // move existing ink and can never split coincident geometry (the two
  // hexagons of a spun prism); this module projects the posed solid
  // itself, so VP and HP always show the true stance. Pure: verts in,
  // segments out. Zero deps. Dual-env: browser via
  // window.EduCADProject, plain Node via module.exports. Node-safe.
  // World units mm; widget space is the locked reconstruct frame
  // (X, Y, Z) = (sheetX, elevY, -planY): front reads (x, y), top
  // reads (x, -z). Faces are planar loops (reconstruct contract);
  // winding is irrelevant (occlusion is double-sided).
  var WORLD_UNITS = 'mm';
  var VERSION = '1.0.0-educad';
  var VIEWS = ['front', 'top', 'left', 'right'];
  // A face pierced at or below this ray distance does not occlude:
  // the edge midpoint starts on its own faces (t ~ 0), and only a
  // face strictly between the midpoint and the viewer hides it.
  // Models are mm-scale, so 1e-7 clears float noise by ~5 decades.
  var HIT_EPS = 1e-7;

  function fail(msg) { throw new Error('educad-project: ' + msg); }

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || !isFinite(v)) fail('need finite numbers');
    }
  }

  function checkVerts(verts) {
    if (!Array.isArray(verts) || verts.length < 1) fail('need >= 1 vertex');
    for (var i = 0; i < verts.length; i++) {
      if (!verts[i] || typeof verts[i] !== 'object') {
        fail('vertex ' + i + ' needs {x,y,z}');
      }
      assertFinite(verts[i].x, verts[i].y, verts[i].z);
    }
    return verts;
  }

  function checkIndex(v, hi, what) {
    if (typeof v !== 'number' || v < 0 || v >= hi || v !== Math.floor(v)) {
      fail(what + ' indexes out of range');
    }
  }

  function checkEdges(edges, nVerts) {
    if (!Array.isArray(edges)) fail('edges must be an array');
    for (var i = 0; i < edges.length; i++) {
      if (!Array.isArray(edges[i]) || edges[i].length !== 2) {
        fail('edge ' + i + ' needs [a,b]');
      }
      checkIndex(edges[i][0], nVerts, 'edge ' + i + ' a');
      checkIndex(edges[i][1], nVerts, 'edge ' + i + ' b');
      if (edges[i][0] === edges[i][1]) fail('edge ' + i + ' loops');
    }
    return edges;
  }

  function checkFaces(faces, nVerts) {
    if (!Array.isArray(faces)) fail('faces must be an array');
    for (var i = 0; i < faces.length; i++) {
      if (!Array.isArray(faces[i]) || faces[i].length < 3) {
        fail('face ' + i + ' needs >= 3 indices');
      }
      for (var j = 0; j < faces[i].length; j++) {
        checkIndex(faces[i][j], nVerts, 'face ' + i + ' index');
      }
    }
    return faces;
  }

  function edgeKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }

  // Moller-Trumbore ray/triangle, double-sided (winding-free).
  // Returns the ray distance t, or -1 on miss/parallel.
  function rayHitsTri(ox, oy, oz, dx, dy, dz,
      ax, ay, az, bx, by, bz, cx, cy, cz) {
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    var px = dy * e2z - dz * e2y;
    var py = dz * e2x - dx * e2z;
    var pz = dx * e2y - dy * e2x;
    var det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-12 && det < 1e-12) return -1;
    var inv = 1 / det;
    var tx = ox - ax, ty = oy - ay, tz = oz - az;
    var u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0 || u > 1) return -1;
    var qx = ty * e1z - tz * e1y;
    var qy = tz * e1x - tx * e1z;
    var qz = tx * e1y - ty * e1x;
    var v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) return -1;
    return (e2x * qx + e2y * qy + e2z * qz) * inv;
  }

  // An edge is hidden iff the ray from its midpoint toward the
  // viewer pierces a non-adjacent face strictly in front of it.
  // Adjacent faces are skipped (they contain the midpoint); face
  // fans cover convex loops, matching the reconstruct contract.
  function edgeHidden(verts, faces, adj, a, b, dx, dy, dz) {
    var mx = (verts[a].x + verts[b].x) / 2;
    var my = (verts[a].y + verts[b].y) / 2;
    var mz = (verts[a].z + verts[b].z) / 2;
    var own = adj[edgeKey(a, b)] || [];
    for (var f = 0; f < faces.length; f++) {
      if (own.indexOf(f) !== -1) continue;
      var loop = faces[f];
      var v0 = verts[loop[0]];
      for (var i = 1; i + 1 < loop.length; i++) {
        var v1 = verts[loop[i]], v2 = verts[loop[i + 1]];
        var t = rayHitsTri(mx, my, mz, dx, dy, dz,
          v0.x, v0.y, v0.z, v1.x, v1.y, v1.z, v2.x, v2.y, v2.z);
        if (t > HIT_EPS) return true;
      }
    }
    return false;
  }

  // Exact orthographic Monge views of a solid: every edge projected
  // to sheet mm with its occlusion verdict. view 'front' is the
  // elevation (x, y) seen from +Z; view 'top' is the plan (x, -z)
  // seen from +Y. Returns [{ax, ay, bx, by, hidden}] in edge order,
  // so callers can diff rest vs posed segment by segment.
  function projectSolid(verts, edges, faces, view, profileMap) {
    checkVerts(verts);
    checkEdges(edges, verts.length);
    checkFaces(faces, verts.length);
    if (VIEWS.indexOf(view) === -1) {
      fail('view must be front, top, left or right');
    }
    var map = profileMap || { xRef: 0, dRef: 0, s: view === 'right' ? -1 : 1 };
    assertFinite(map.xRef, map.dRef, map.s);
    if (map.s !== 1 && map.s !== -1) fail('profile direction must be 1 or -1');
    var adj = {};
    for (var g = 0; g < faces.length; g++) {
      var lp = faces[g];
      for (var h = 0; h < lp.length; h++) {
        var key = edgeKey(lp[h], lp[(h + 1) % lp.length]);
        if (!adj[key]) adj[key] = [];
        adj[key].push(g);
      }
    }
    var dx = 0, dy = 0, dz = 0;
    if (view === 'front') dz = 1;
    else if (view === 'top') dy = 1;
    else dx = view === 'left' ? -1 : 1;
    var out = [];
    for (var e = 0; e < edges.length; e++) {
      var a = verts[edges[e][0]], b = verts[edges[e][1]];
      var pa, pb;
      if (view === 'front') {
        pa = { x: a.x, y: a.y };
        pb = { x: b.x, y: b.y };
      } else if (view === 'top') {
        pa = { x: a.x, y: -a.z };
        pb = { x: b.x, y: -b.z };
      } else {
        pa = { x: map.xRef + map.s * (a.z - map.dRef), y: a.y };
        pb = { x: map.xRef + map.s * (b.z - map.dRef), y: b.y };
      }
      out.push({
        ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y,
        hidden: faces.length > 0 &&
          edgeHidden(verts, faces, adj, edges[e][0], edges[e][1], dx, dy, dz)
      });
    }
    return out;
  }

  // Revolved readers use a polygon mesh for 3D display. Its internal
  // generators are sampling lines, not drafting edges. Keep the rims and
  // generators at the silhouette, for every posed orthographic direction.
  function projectGeometry(geometry, view, profileMap) {
    var out = projectSolid(geometry.vertices, geometry.edges, geometry.faces || [], view, profileMap);
    if (geometry.name !== 'cylinder' && geometry.name !== 'cone') return out;
    var direction = view === 'front' ? [0, 0, 1] : view === 'top' ? [0, 1, 0] : view === 'left' ? [-1, 0, 0] : [1, 0, 0];
    var sideSize = geometry.name === 'cylinder' ? 4 : 3;
    var sides = (geometry.faces || []).filter(function (face) { return face.length === sideSize; });
    function facing(face) {
      var a = geometry.vertices[face[0]], b = geometry.vertices[face[1]], c = geometry.vertices[face[2]];
      var ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
      var vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      return (uy * vz - uz * vy) * direction[0] + (uz * vx - ux * vz) * direction[1] + (ux * vy - uy * vx) * direction[2];
    }
    return out.filter(function (segment, i) {
      var edge = geometry.edges[i];
      var adjacent = sides.filter(function (face) {
        for (var k = 0; k < face.length; k++) {
          var a = face[k], b = face[(k + 1) % face.length];
          if ((a === edge[0] && b === edge[1]) || (a === edge[1] && b === edge[0])) return true;
        }
        return false;
      });
      if (adjacent.length !== 2) return true;
      var f1 = facing(adjacent[0]), f2 = facing(adjacent[1]);
      return f1 * f2 < 0 || (Math.abs(f1) < 1e-7 && Math.abs(f2) >= 1e-7) || (Math.abs(f2) < 1e-7 && Math.abs(f1) >= 1e-7);
    });
  }

  return {
    VERSION: VERSION,
    WORLD_UNITS: WORLD_UNITS,
    VIEWS: VIEWS,
    HIT_EPS: HIT_EPS,
    projectSolid: projectSolid, projectGeometry: projectGeometry
  };
});

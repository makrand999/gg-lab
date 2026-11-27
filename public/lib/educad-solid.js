(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADSolid = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var THEME_ROOT = typeof window !== 'undefined' ? window :
    (typeof globalThis !== 'undefined' ? globalThis : null);

  function themeColor(name, fallback) {
    var theme = THEME_ROOT && THEME_ROOT.EduCADTheme;
    return (theme && typeof theme.color === 'function') ? theme.color(name) : fallback;
  }

  function themeFaces(st) {
    var theme = THEME_ROOT && THEME_ROOT.EduCADTheme;
    var faces = theme && typeof theme.faceShading === 'function' ? theme.faceShading() : null;
    var hues = { teal: 172, blue: 212, amber: 38 };
    var hue = st && (st.inspection || st.posing) && hues[st.modelColor];
    if (typeof hue !== 'number') return faces;
    return { hue: hue, sat: 58, base: faces && faces.base < 50 ? 22 : 42, range: 25 };
  }












  var SIZE_DEFAULT = 260;
  var SIZE_MIN = 120;
  var SIZE_MAX = 520;
  var LINE_COLOR = '#1e293b';
  var LINE_WIDTH_PX = 1.75;
  var VERTEX_FILL = '#0f172a';
  var VERTEX_R_PX = 3;
  var HIDDEN_DASH = [4, 4];
  var HIDDEN_OPACITY = 0.45;



  var FACE_FILL = '#f8fafc';
  var ISO_YAW_RAD = Math.PI / 4;
  var ISO_PITCH_RAD = Math.atan(1 / Math.sqrt(2));
  var ORBIT_RAD_PER_PX = 0.008;
  var PITCH_LIMIT_RAD = 1.45;
  var ZOOM_MIN = 0.35;
  var ZOOM_MAX = 4;
  var ZOOM_STEP = 1.15;
  var RADIUS_FRAC = 0.28;
  var WIDGET_CLASS = 'educad-solid';
  var CANVAS_CLASS = 'educad-solid-canvas';
  var HANDLE_CLASS = 'educad-solid-handle';
  var HANDLE_TEXT = '⠿ 3D Solid';





  var GLASS_RADIUS_FRAC = 0.16;
  var GLASS_RADIUS_MIN = 64;
  var GLASS_RADIUS_MAX = 200;
  var GLASS_ZOOM_MIN = 0.08;
  var GLASS_ZOOM_MAX = 60;




  var GLASS_PAN_MARGIN = 1.75;
  var AURA_PX = 12;




  var TAP_WINDOW_MS = 450;
  var TAP_SLOP_PX = 8;
  var GLASS_CLASS = 'educad-solid-glass';
  var GLASS_CANVAS_CLASS = 'educad-solid-glass-canvas';


  var VERTICES = [
    { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 },
    { x: -1, y: 1, z: -1 }, { x: 1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 },
    { x: -1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }
  ];

  var EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];


  var FACE_NORMALS = [
    { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }
  ];

  var EDGE_FACES = [
    [2, 4], [3, 4], [2, 5], [3, 5],
    [0, 4], [1, 4], [0, 5], [1, 5],
    [0, 2], [1, 2], [0, 3], [1, 3]
  ];




  var CUBE_FACES = [
    [0, 4, 6, 2], [1, 3, 7, 5],
    [0, 1, 5, 4], [2, 6, 7, 3],
    [0, 2, 3, 1], [4, 5, 7, 6]
  ];
  var STATUS_FONT = '600 12px system-ui, -apple-system, sans-serif';
  var STATUS_SUB_FONT = '12px system-ui, -apple-system, sans-serif';

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function clampSizePx(v) {
    assertFinite(v);
    return clamp(Math.round(v), SIZE_MIN, SIZE_MAX);
  }

  function assertIndex(v, hi, what) {
    if (typeof v !== 'number' || Math.floor(v) !== v || v < 0 || v >= hi) {
      throw new Error('bad ' + what + ': ' + String(v));
    }
  }



  function newellNormal(verts, loop) {
    var nx = 0, ny = 0, nz = 0;
    for (var i = 0; i < loop.length; i++) {
      var a = verts[loop[i]], b = verts[loop[(i + 1) % loop.length]];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 1e-12)) return { x: 0, y: 0, z: 0 };
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  function edgeKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }





  function createGeometry(spec) {
    spec = spec || {};
    var vs = spec.vertices || spec.VERTICES;
    var es = spec.edges || spec.EDGES || [];
    var fs = spec.faces || spec.FACES || [];
    if (!Array.isArray(vs) || vs.length < 1) {
      throw new Error('geometry needs >= 1 vertex');
    }
    var verts = [];
    for (var i = 0; i < vs.length; i++) {
      assertFinite(vs[i].x, vs[i].y, vs[i].z);
      verts.push({ x: vs[i].x, y: vs[i].y, z: vs[i].z });
    }
    var edges = [];
    for (var j = 0; j < es.length; j++) {
      assertIndex(es[j][0], verts.length, 'edge a');
      assertIndex(es[j][1], verts.length, 'edge b');
      if (es[j][0] === es[j][1]) throw new Error('edge loop on ' + es[j][0]);
      edges.push([es[j][0], es[j][1]]);
    }
    var faces = [];
    for (var k = 0; k < fs.length; k++) {
      if (!Array.isArray(fs[k]) || fs[k].length < 3) {
        throw new Error('face ' + k + ' needs >= 3 indices');
      }
      var loop = [];
      for (var m = 0; m < fs[k].length; m++) {
        assertIndex(fs[k][m], verts.length, 'face index');
        loop.push(fs[k][m]);
      }
      faces.push(loop);
    }
    var faceHoles = faces.map(function (_, i) {
      return ((spec.faceHoles || [])[i] || []).map(function (hole) {
        if (!Array.isArray(hole) || hole.length < 3) throw new Error('hole needs >= 3 indices');
        hole.forEach(function (v) { assertIndex(v, verts.length, 'hole index'); });
        return hole.slice();
      });
    });
    var normals = [];
    for (var f = 0; f < faces.length; f++) {
      normals.push(newellNormal(verts, faces[f]));
    }
    var smooth = [];
    var smoothSpec = spec.smoothSideFaces || [];
    if (!Array.isArray(smoothSpec)) throw new Error('smoothSideFaces must be an array');
    var seenSmooth = {};
    for (var s = 0; s < smoothSpec.length; s++) {
      assertIndex(smoothSpec[s], faces.length, 'smooth face');
      if (seenSmooth[smoothSpec[s]]) continue;
      seenSmooth[smoothSpec[s]] = true;
      smooth.push(smoothSpec[s]);
    }
    var adj = {};
    for (var g = 0; g < faces.length; g++) {
      var loops = [faces[g]].concat(faceHoles[g]);
      for (var li = 0; li < loops.length; li++) {
      var lp = loops[li];
      for (var h = 0; h < lp.length; h++) {
        var key = edgeKey(lp[h], lp[(h + 1) % lp.length]);
        if (!adj[key]) adj[key] = [];
        adj[key].push(g);
      }
      }
    }
    var edgeFaces = [];
    for (var e = 0; e < edges.length; e++) {
      var ek = edgeKey(edges[e][0], edges[e][1]);
      edgeFaces.push(adj[ek] ? adj[ek].slice() : []);
    }
    return {
      name: String(spec.name === undefined ? 'custom' : spec.name),
      vertices: verts, edges: edges, faces: faces, faceHoles: faceHoles,
      faceNormals: normals, edgeFaces: edgeFaces, smoothSideFaces: smooth,
      curves: Array.isArray(spec.curves) ? spec.curves : [],
      surfaces: Array.isArray(spec.surfaces) ? spec.surfaces : []
    };
  }

  var CUBE_GEOMETRY = createGeometry({
    name: 'cube', vertices: VERTICES, edges: EDGES, faces: CUBE_FACES
  });

  function defaultGeometry() { return CUBE_GEOMETRY; }

  function geometryOf(st) {
    return (st && st.geometry) ? st.geometry : CUBE_GEOMETRY;
  }





  function normalizeGeometry(geometry) {
    if (!geometry || !Array.isArray(geometry.vertices) ||
        geometry.vertices.length < 1) {
      throw new Error('cannot normalize empty geometry');
    }
    var vs = geometry.vertices;
    var minX = vs[0].x, maxX = vs[0].x;
    var minY = vs[0].y, maxY = vs[0].y;
    var minZ = vs[0].z, maxZ = vs[0].z;
    for (var i = 1; i < vs.length; i++) {
      assertFinite(vs[i].x, vs[i].y, vs[i].z);
      if (vs[i].x < minX) minX = vs[i].x;
      if (vs[i].x > maxX) maxX = vs[i].x;
      if (vs[i].y < minY) minY = vs[i].y;
      if (vs[i].y > maxY) maxY = vs[i].y;
      if (vs[i].z < minZ) minZ = vs[i].z;
      if (vs[i].z > maxZ) maxZ = vs[i].z;
    }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    var half = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    var scale = half > 1e-12 ? 1 / half : 1;
    var out = [];
    for (var j = 0; j < vs.length; j++) {
      out.push({
        x: (vs[j].x - cx) * scale,
        y: (vs[j].y - cy) * scale,
        z: (vs[j].z - cz) * scale
      });
    }
    return {
      geometry: createGeometry({
        name: geometry.name || 'custom',
        vertices: out,
        edges: geometry.edges || [],
        faces: geometry.faces || [],
        faceHoles: geometry.faceHoles || [],
        smoothSideFaces: geometry.smoothSideFaces || [],
        curves: (geometry.curves || []).map(function (curve) {
          return transformCurve(curve, cx, cy, cz, scale);
        }),
        surfaces: (geometry.surfaces || []).map(function (surface) {
          return transformSurface(surface, cx, cy, cz, scale);
        })
      }),
      transform: { cx: cx, cy: cy, cz: cz, scale: scale }
    };
  }

  function transformCurve(curve, cx, cy, cz, scale) {
    var out = {};
    if (curve && typeof curve === 'object') {
      for (var k in curve) {
        if (Object.prototype.hasOwnProperty.call(curve, k)) out[k] = curve[k];
      }
    }
    if (out.center && finitePoint(out.center)) {
      out.center = {
        x: (out.center.x - cx) * scale,
        y: (out.center.y - cy) * scale,
        z: (out.center.z - cz) * scale
      };
    }
    ['radius', 'radiusU', 'radiusV'].forEach(function (field) {
      if (typeof out[field] === 'number' && isFinite(out[field])) {
        out[field] = out[field] * scale;
      }
    });
    if (Array.isArray(out.points)) {
      out.points = out.points.map(function (p) {
        if (!finitePoint(p)) return p;
        return {
          x: (p.x - cx) * scale,
          y: (p.y - cy) * scale,
          z: (p.z - cz) * scale
        };
      });
    }
    return out;
  }

  function transformSurface(surface, cx, cy, cz, scale) {
    var out = {};
    if (surface && typeof surface === 'object') {
      for (var k in surface) {
        if (Object.prototype.hasOwnProperty.call(surface, k)) out[k] = surface[k];
      }
    }
    ['origin', 'center', 'apex'].forEach(function (field) {
      if (finitePoint(out[field])) {
        out[field] = {
          x: (out[field].x - cx) * scale,
          y: (out[field].y - cy) * scale,
          z: (out[field].z - cz) * scale
        };
      }
    });
    ['radius', 'radiusU', 'radiusV', 'majorRadius', 'minorRadius'].forEach(function (field) {
      if (typeof out[field] === 'number' && isFinite(out[field])) {
        out[field] = out[field] * scale;
      }
    });
    return out;
  }

  function finitePoint(p) {
    return !!p && typeof p.x === 'number' && typeof p.y === 'number' &&
      typeof p.z === 'number' && isFinite(p.x) && isFinite(p.y) && isFinite(p.z);
  }

  function createSolidState(opts) {
    opts = opts || {};
    var size = (opts.size === undefined || opts.size === null) ?
      SIZE_DEFAULT : clampSizePx(opts.size);
    var yaw = (opts.yaw === undefined || opts.yaw === null) ?
      ISO_YAW_RAD : opts.yaw;
    var pitch = (opts.pitch === undefined || opts.pitch === null) ?
      ISO_PITCH_RAD : opts.pitch;
    var scale = (opts.scale === undefined || opts.scale === null) ?
      1 : opts.scale;
    assertFinite(yaw, pitch, scale);
    return {
      yaw: yaw,
      pitch: clamp(pitch, -PITCH_LIMIT_RAD, PITCH_LIMIT_RAD),
      scale: clamp(scale, ZOOM_MIN, ZOOM_MAX),
      size: size,
      geometry: (opts.geometry === undefined || opts.geometry === null) ?
        CUBE_GEOMETRY : opts.geometry,
      status: { available: true, reason: '', label: '' }
    };
  }

  function statusOf(st) {
    return (st && st.status) ? st.status : { available: true, reason: '', label: '' };
  }






  function setGeometry(target, geometry, opts) {
    var st = (target && target.state) ? target.state : target;
    if (!st) throw new Error('setGeometry needs a state or widget');
    opts = opts || {};
    if (geometry === undefined || geometry === null) {
      st.geometry = CUBE_GEOMETRY;
      st.geometryMm = null;
      st.geometryTransform = null;
    } else if (opts.normalize === false) {
      st.geometry = geometry;
      st.geometryMm = null;
      st.geometryTransform = null;
    } else {
      var normalized = normalizeGeometry(geometry);
      st.geometry = normalized.geometry;
      st.geometryMm = geometry;
      st.geometryTransform = normalized.transform;
    }
    st.status = { available: true, reason: '', label: '' };
    if (target && target.state && target.el &&
        typeof target.el.setAttribute === 'function') {
      target.el.setAttribute('data-solid', st.geometry.name || 'custom');
    }
    if (target && target.state && typeof target.draw === 'function') {
      target.draw();
      return target;
    }
    return st;
  }



  function setUnavailable(target, reason, label) {
    var st = (target && target.state) ? target.state : target;
    if (!st) throw new Error('setUnavailable needs a state or widget');
    st.geometryMm = null;
    st.geometryTransform = null;
    st.status = {
      available: false,
      reason: String(reason === undefined ? 'unknown' : reason),
      label: String(label === undefined ? '' : label)
    };
    if (target && target.state && typeof target.draw === 'function') {
      target.draw();
      return target;
    }
    return st;
  }


  function resetView(st) {
    st.yaw = ISO_YAW_RAD;
    st.pitch = ISO_PITCH_RAD;
    st.scale = 1;
    return st;
  }



  function rotateBy(st, dxPx, dyPx) {
    assertFinite(dxPx, dyPx);
    st.yaw += dxPx * ORBIT_RAD_PER_PX;
    st.pitch = clamp(st.pitch + dyPx * ORBIT_RAD_PER_PX,
      -PITCH_LIMIT_RAD, PITCH_LIMIT_RAD);
    return st;
  }

  function zoomBy(st, factor) {
    assertFinite(factor);
    if (!(factor > 0)) throw new Error('zoom factor must be > 0');
    var lo = (st && st.minScale !== undefined && st.minScale !== null) ?
      st.minScale : ZOOM_MIN;
    var hi = (st && st.maxScale !== undefined && st.maxScale !== null) ?
      st.maxScale : ZOOM_MAX;
    st.scale = clamp(st.scale * factor, lo, hi);
    return clampPan(st);
  }

  function projectionRadius(st) {
    if (st && st.baseR !== undefined && st.baseR !== null) {
      return st.scale * st.baseR;
    }
    return st.scale * st.size * RADIUS_FRAC;
  }





  function project(st, cxPx, cyPx) {
    assertFinite(st.yaw, st.pitch, st.scale, cxPx, cyPx);
    var verts = geometryOf(st).vertices;
    var r = projectionRadius(st);
    var out = [];
    for (var i = 0; i < verts.length; i++) {
      var v = verts[i];
      var q = rotateDir(v.x, v.y, v.z, st.yaw, st.pitch);
      out.push({ x: cxPx + q.x * r, y: cyPx - q.y * r, z: q.z });
    }
    return out;
  }



  function rotateDir(x, y, z, yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var x1 = x * cy + z * sy;
    var z1 = -x * sy + z * cy;
    return { x: x1, y: y * cp - z1 * sp, z: y * sp + z1 * cp };
  }



  function faceVisibilityFor(normals, yaw, pitch) {
    assertFinite(yaw, pitch);
    var out = [];
    for (var i = 0; i < normals.length; i++) {
      var n = normals[i];
      out.push(rotateDir(n.x, n.y, n.z, yaw, pitch).z > 0);
    }
    return out;
  }



  function faceVisibility(yaw, pitch) {
    return faceVisibilityFor(FACE_NORMALS, yaw, pitch);
  }






  function classifyEdges(st) {
    assertFinite(st.yaw, st.pitch);
    var g = geometryOf(st);
    var vis = faceVisibilityFor(g.faceNormals, st.yaw, st.pitch);
    var smooth = {};
    var smoothList = g.smoothSideFaces || [];
    for (var s = 0; s < smoothList.length; s++) smooth[smoothList[s]] = true;
    var junctionEdges = {};
    var solidJunctionEdges = {};
    (g.curves || []).forEach(function (curve) {
      if (!curve || curve.kind !== 'cylinder-intersection') return;
      var target = curve.solidJunction === true ? solidJunctionEdges : junctionEdges;
      (curve.displayEdges || []).forEach(function (index) {
        if (Number.isInteger(index)) target[index] = true;
      });
    });
    function curveOf(item) {
      return typeof item === 'object' && item ? item : (g.curves || [])[item];
    }
    function analyticSurfaces() {
      if (typeof EduCADSurfaces !== 'undefined' && EduCADSurfaces &&
          typeof EduCADSurfaces.surfaceNormal === 'function')
        return EduCADSurfaces;
      if (typeof window !== 'undefined' && window.EduCADSurfaces &&
          typeof window.EduCADSurfaces.surfaceNormal === 'function')
        return window.EduCADSurfaces;
      if (typeof require === 'function') {
        try {
          var loaded = require('./educad-surfaces.js');
          if (loaded && typeof loaded.surfaceNormal === 'function') return loaded;
        } catch (err) {}
      }
      return null;
    }
    var seamSurfaces = {};
    (g.curves || []).forEach(function (curve) {
      if (!curve || curve.solidJunction !== true) return;
      var indices = curve.displayEdges || [];
      (g.surfaces || []).forEach(function (surface) {
        var uses = (surface.loops || []).some(function (loop) {
          return (loop.curves || []).some(function (item) {
            return curveOf(item) === curve;
          });
        });
        if (!uses) return;
        indices.forEach(function (index) {
          if (!seamSurfaces[index]) seamSurfaces[index] = [];
          if (seamSurfaces[index].indexOf(surface) === -1)
            seamSurfaces[index].push(surface);
        });
      });
    });
    function solidJunctionHidden(index) {
      var surfaces = seamSurfaces[index];
      var edge = g.edges[index];
      var Surfaces = analyticSurfaces();
      if (!surfaces || !surfaces.length || !edge || !Surfaces) return false;
      var a = g.vertices[edge[0]], b = g.vertices[edge[1]];
      if (!a || !b) return false;
      var midpoint = {x:(a.x+b.x)/2, y:(a.y+b.y)/2, z:(a.z+b.z)/2};
      var facing = surfaces.every(function (surface) {
        var normal = Surfaces.surfaceNormal(surface, midpoint);
        if (!normal) return false;
        return rotateDir(normal.x, normal.y, normal.z, st.yaw, st.pitch).z >= -1e-9;
      });
      return !facing;
    }
    var out = [];
    for (var i = 0; i < g.edges.length; i++) {
      var f = g.edgeFaces[i] || [];
      if (solidJunctionEdges[i]) {
        out.push({ a:g.edges[i][0], b:g.edges[i][1], hidden:solidJunctionHidden(i), index:i });
        continue;
      }
      if (f.length === 2 && smooth[f[0]] && smooth[f[1]]) continue;
      if (f.length === 0 && junctionEdges[i]) continue;
      var hidden = false;
      if (f.length > 0) {
        hidden = true;
        for (var j = 0; j < f.length; j++) {
          if (vis[f[j]]) { hidden = false; break; }
        }
      }
      out.push({ a: g.edges[i][0], b: g.edges[i][1], hidden: hidden, index: i });
    }
    return out;
  }

  function curveDotSuppression(g, edges) {
    var out = {};
    var curves = (g && g.curves) || [];
    if (!curves.length) return out;
    var incident = {};
    for (var i = 0; i < edges.length; i++) {
      var key = edgeKey(edges[i].a, edges[i].b);
      if (!incident[edges[i].a]) incident[edges[i].a] = [];
      if (!incident[edges[i].b]) incident[edges[i].b] = [];
      incident[edges[i].a].push(key);
      incident[edges[i].b].push(key);
    }
    for (var c = 0; c < curves.length; c++) {
      var curve = curves[c] || {};
      var dv = Array.isArray(curve.displayVertices) ? curve.displayVertices : [];
      if (!dv.length) continue;
      var keys = {};
      var de = Array.isArray(curve.displayEdges) ? curve.displayEdges : [];
      if (de.length) {
        for (var e = 0; e < de.length; e++) {
          var ed = g.edges && g.edges[de[e]];
          if (ed) keys[edgeKey(ed[0], ed[1])] = true;
        }
      } else {
        var closed = curve.kind === 'circle' || curve.kind === 'ellipse' ||
          curve.closed === true;
        var count = closed ? dv.length : dv.length - 1;
        for (var k = 0; k < count; k++) {
          keys[edgeKey(dv[k], dv[(k + 1) % dv.length])] = true;
        }
      }
      for (var v = 0; v < dv.length; v++) {
        var list = incident[dv[v]] || [];
        var only = true;
        for (var q = 0; q < list.length; q++) {
          if (!keys[list[q]]) { only = false; break; }
        }
        if (only) out[dv[v]] = true;
      }
    }
    return out;
  }



  var TAU = 2 * Math.PI;
  var CHORD_TOL_PX = 0.15;
  var CONIC_MAX_DEPTH = 6;
  var FACE_HUE = 349;
  var FACE_SAT = 46;
  var LIGHT_DIR = (function () {
    var x = -0.35, y = 0.55, z = 0.75;
    var len = Math.sqrt(x * x + y * y + z * z);
    return { x: x / len, y: y / len, z: z / len };
  })();

  function conicRadii(curve) {
    if (!curve) return null;
    var ru = (typeof curve.radiusU === 'number' && curve.radiusU > 0) ?
      curve.radiusU : curve.radius;
    var rv = (typeof curve.radiusV === 'number' && curve.radiusV > 0) ?
      curve.radiusV : curve.radius;
    if (!(typeof ru === 'number' && typeof rv === 'number')) return null;
    if (!(ru > 0 && rv > 0) || !isFinite(ru) || !isFinite(rv)) return null;
    return { u: ru, v: rv };
  }

  function supportedConic(curve) {
    if (!curve || curve.kind === 'cylinder-intersection' || !finitePoint(curve.center) ||
        !finitePoint(curve.u) || !finitePoint(curve.v)) return null;
    return conicRadii(curve);
  }

  function conicPointAt(curve, angle) {
    var r = conicRadii(curve);
    if (!r) return null;
    var c = Math.cos(angle), s = Math.sin(angle);
    return {
      x: curve.center.x + curve.u.x * r.u * c + curve.v.x * r.v * s,
      y: curve.center.y + curve.u.y * r.u * c + curve.v.y * r.v * s,
      z: curve.center.z + curve.u.z * r.u * c + curve.v.z * r.v * s
    };
  }

  function conicParamAt(curve, p) {
    var r = conicRadii(curve);
    if (!r || !finitePoint(p)) return null;
    var dx = p.x - curve.center.x;
    var dy = p.y - curve.center.y;
    var dz = p.z - curve.center.z;
    var qx = (dx * curve.u.x + dy * curve.u.y + dz * curve.u.z) / r.u;
    var qy = (dx * curve.v.x + dy * curve.v.y + dz * curve.v.z) / r.v;
    var angle = Math.atan2(qy, qx);
    var c = Math.cos(angle), s = Math.sin(angle);
    var ex = curve.center.x + curve.u.x * r.u * c + curve.v.x * r.v * s - p.x;
    var ey = curve.center.y + curve.u.y * r.u * c + curve.v.y * r.v * s - p.y;
    var ez = curve.center.z + curve.u.z * r.u * c + curve.v.z * r.v * s - p.z;
    return {
      angle: angle,
      error: Math.sqrt(ex * ex + ey * ey + ez * ez)
    };
  }

  function curveIsClosed(curve) {
    if (!curve) return false;
    if (curve.kind === 'circle' || curve.kind === 'ellipse') return true;
    if (curve.closed === true) return true;
    return typeof curve.sweepAngle === 'number' &&
      Math.abs(Math.abs(curve.sweepAngle) - TAU) <= 1e-9;
  }

  function curveSampleAngles(curve) {
    var dv = Array.isArray(curve.displayVertices) ? curve.displayVertices : [];
    var n = dv.length;
    if (n < 2) return null;
    var closed = curveIsClosed(curve);
    var params = null;
    if (Array.isArray(curve.displayParams) && curve.displayParams.length === n) {
      params = curve.displayParams.slice();
    } else {
      var start = (typeof curve.startAngle === 'number') ? curve.startAngle : 0;
      var sweep = (typeof curve.sweepAngle === 'number') ? curve.sweepAngle : TAU;
      if (!isFinite(start) || !isFinite(sweep) || Math.abs(sweep) < 1e-12) {
        sweep = TAU;
      }
      var steps = closed ? n : n - 1;
      if (steps < 1) return null;
      params = [];
      for (var i = 0; i < n; i++) params.push(start + sweep * i / steps);
    }
    var dir = null;
    if (typeof curve.sweepAngle === 'number' && isFinite(curve.sweepAngle) &&
        Math.abs(curve.sweepAngle) > 1e-12) {
      dir = curve.sweepAngle > 0 ? 1 : -1;
    }
    var angles = [params[0]];
    for (var j = 1; j < n; j++) {
      var d = params[j] - params[j - 1];
      d -= TAU * Math.round(d / TAU);
      if (dir && Math.abs(Math.abs(d) - Math.PI) <= 1e-9 && d * dir < 0) {
        d += dir * TAU;
      }
      angles.push(angles[j - 1] + d);
    }
    return { angles: angles, closed: closed, count: n, dir: dir };
  }

  function edgeConicAngles(curve, verts, ia, ib, expected) {
    var a = verts[ia], b = verts[ib];
    var r = supportedConic(curve);
    if (!r) return null;
    var pa = conicParamAt(curve, a), pb = conicParamAt(curve, b);
    if (!pa || !pb) return null;
    var tol = 1e-6 * Math.max(1, r.u, r.v);
    if (pa.error > tol || pb.error > tol) return null;
    var d = pb.angle - pa.angle;
    d -= TAU * Math.round(d / TAU);
    if (typeof expected === 'number' && Math.abs(expected) > 1e-12) {
      if (expected > 0 && d < 0) d += TAU;
      else if (expected < 0 && d > 0) d -= TAU;
    } else if (Math.abs(Math.abs(d) - Math.PI) <= 1e-9 &&
        typeof curve.sweepAngle === 'number' &&
        Math.abs(curve.sweepAngle) > 1e-12) {
      if (curve.sweepAngle > 0 && d < 0) d += TAU;
      else if (curve.sweepAngle < 0 && d > 0) d -= TAU;
    }
    return { a: pa.angle, b: pa.angle + d };
  }

  function buildConicEdgeMap(geometry) {
    var map = {};
    var verts = geometry.vertices || [];
    var curves = geometry.curves || [];
    var edges = geometry.edges || [];
    for (var c = 0; c < curves.length; c++) {
      var curve = curves[c];
      if (!supportedConic(curve)) continue;
      var dv = Array.isArray(curve.displayVertices) ? curve.displayVertices : [];
      var de = Array.isArray(curve.displayEdges) ? curve.displayEdges : [];
      var pairs = [];
      if (de.length) {
        for (var e = 0; e < de.length; e++) {
          var edge = edges[de[e]];
          if (!edge) continue;
          pairs.push({ ia: edge[0], ib: edge[1], expected: null });
        }
      } else {
        if (dv.length < 2) continue;
        var info = curveSampleAngles(curve);
        if (!info) continue;
        var n = dv.length;
        var segs = info.closed ? n : n - 1;
        for (var i = 0; i < segs; i++) {
          var ia = dv[i], ib = dv[(i + 1) % n];
          var expected;
          if (info.closed && i === n - 1) {
            var spanAngle = info.angles[n - 1] - info.angles[0];
            var dir = Math.abs(spanAngle) > 1e-9 ?
              (spanAngle > 0 ? 1 : -1) : (info.dir || 1);
            expected = info.angles[0] + dir * TAU - info.angles[n - 1];
            if (info.dir &&
                Math.abs(Math.abs(expected) - Math.PI) <= 1e-9 &&
                expected * info.dir < 0) {
              expected = info.angles[0] + info.dir * TAU - info.angles[n - 1];
            }
          } else {
            expected = info.angles[i + 1] - info.angles[i];
          }
          pairs.push({ ia: ia, ib: ib, expected: expected });
        }
      }
      for (var p = 0; p < pairs.length; p++) {
        var pr = pairs[p];
        if (pr.ia === pr.ib) continue;
        if (!(pr.ia >= 0 && pr.ia < verts.length &&
            pr.ib >= 0 && pr.ib < verts.length)) continue;
        var key = edgeKey(pr.ia, pr.ib);
        if (map[key]) continue;
        var span = edgeConicAngles(curve, verts, pr.ia, pr.ib, pr.expected);
        if (!span) continue;
        map[key] = {
          curve: curve, ia: pr.ia, ib: pr.ib, a: span.a, b: span.b
        };
      }
    }
    return map;
  }

  function projectConicPoint(st, curve, angle, cx, cy) {
    var p = conicPointAt(curve, angle);
    if (!p) return null;
    var q = rotateDir(p.x, p.y, p.z, st.yaw, st.pitch);
    var r = projectionRadius(st);
    return { x: cx + q.x * r, y: cy - q.y * r, z: q.z };
  }

  function refineConicSegment(st, curve, a, b, cx, cy, tol) {
    if (!curve || !isFinite(a) || !isFinite(b)) return null;
    var pa = projectConicPoint(st, curve, a, cx, cy);
    var pb = projectConicPoint(st, curve, b, cx, cy);
    if (!pa || !pb) return null;
    var out = [pa];
    function walk(a0, b0, p0, p1, depth) {
      var mid = (a0 + b0) / 2;
      var pm = projectConicPoint(st, curve, mid, cx, cy);
      if (!pm) { out.push(p1); return; }
      if (depth >= CONIC_MAX_DEPTH ||
          distPointSeg(pm.x, pm.y, p0.x, p0.y, p1.x, p1.y) <= tol) {
        out.push(p1);
        return;
      }
      walk(a0, mid, p0, pm, depth + 1);
      walk(mid, b0, pm, p1, depth + 1);
    }
    walk(a, b, pa, pb, 0);
    return out;
  }

  function buildConicRunCache(st, conics, cx, cy) {
    var runs = {};
    for (var key in conics) {
      if (!Object.prototype.hasOwnProperty.call(conics, key)) continue;
      var entry = conics[key];
      var pts = refineConicSegment(st, entry.curve, entry.a, entry.b,
        cx, cy, CHORD_TOL_PX);
      if (pts && pts.length > 1) runs[key] = pts;
    }
    return runs;
  }

  function conicRunFor(runs, entry, from, to) {
    if (!entry) return null;
    var key = edgeKey(from, to);
    var run = runs[key];
    if (!run) return null;
    if (from === entry.ia && to === entry.ib) return run;
    if (from === entry.ib && to === entry.ia) {
      var reverseKey = key + 'r';
      var reverse = runs[reverseKey];
      if (!reverse) {
        reverse = run.slice().reverse();
        runs[reverseKey] = reverse;
      }
      return reverse;
    }
    return null;
  }

  function appendEdgeStroke(ctx, st, entry, from, to, pts, cx, cy, runs) {
    var pa = pts[from], pb = pts[to];
    if (!pa || !pb) return;
    ctx.moveTo(pa.x, pa.y);
    var refined = conicRunFor(runs, entry, from, to);
    if (refined && refined.length > 2) {
      for (var i = 1; i < refined.length - 1; i++) {
        ctx.lineTo(refined[i].x, refined[i].y);
      }
    }
    ctx.lineTo(pb.x, pb.y);
  }

  function appendLoopPath(ctx, st, loop, pts, conics, cx, cy, runs) {
    if (!loop || loop.length < 3) return false;
    var first = pts[loop[0]];
    if (!first) return false;
    ctx.moveTo(first.x, first.y);
    for (var i = 0; i < loop.length; i++) {
      var ai = loop[i], bi = loop[(i + 1) % loop.length];
      var pb = pts[bi];
      if (!pb) return false;
      var refined = conicRunFor(runs, conics[edgeKey(ai, bi)], ai, bi);
      if (refined && refined.length > 2) {
        for (var j = 1; j < refined.length - 1; j++) {
          ctx.lineTo(refined[j].x, refined[j].y);
        }
      }
      ctx.lineTo(pb.x, pb.y);
    }
    ctx.closePath();
    return true;
  }

  function cameraNormal(n, st) {
    var q = rotateDir(n.x, n.y, n.z, st.yaw, st.pitch);
    if (q.z < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; }
    return q;
  }

  function shadeOfCameraNormal(q) {
    var d = q.x * LIGHT_DIR.x + q.y * LIGHT_DIR.y + q.z * LIGHT_DIR.z;
    if (!(d > 0)) d = 0;
    return 0.62 + 0.38 * d;
  }

  function shadeOfNormal(n, st) {
    return shadeOfCameraNormal(cameraNormal(n, st));
  }

  function litFaceColor(q, st) {
    var shade = shadeOfCameraNormal(q);
    var faces = themeFaces(st);
    var hue = faces ? faces.hue : FACE_HUE;
    var sat = faces ? faces.sat : FACE_SAT;
    var lightness = (faces ? faces.base : 82) + (faces ? faces.range : 13) * shade;
    return 'hsl(' + hue + ', ' + sat + '%, ' +
      lightness.toFixed(1) + '%)';
  }

  function hueChannel(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function hslToRgb(h, s, l) {
    var r, g, b;
    if (s === 0) {
      r = g = b = l;
    } else {
      var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
      var p = 2 * l - q;
      r = hueChannel(p, q, h + 1 / 3);
      g = hueChannel(p, q, h);
      b = hueChannel(p, q, h - 1 / 3);
    }
    return [
      Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)
    ];
  }

  var SHADE_LUT = null;
  var SHADE_LUT_KEY = '';

  function shadeLut(st) {
    var faces = themeFaces(st);
    var hue = faces ? faces.hue : FACE_HUE;
    var sat = faces ? faces.sat : FACE_SAT;
    var base = faces ? faces.base : 82;
    var range = faces ? faces.range : 13;
    var key = hue + '/' + sat + '/' + base + '/' + range;
    if (SHADE_LUT && SHADE_LUT_KEY === key) return SHADE_LUT;
    SHADE_LUT_KEY = key;
    SHADE_LUT = [];
    for (var i = 0; i < 256; i++) {
      var shade = i / 255;
      SHADE_LUT.push(hslToRgb(hue / 360, sat / 100,
        (base + range * shade) / 100));
    }
    return SHADE_LUT;
  }

  function fitShadePlane(samples, fallback) {
    var n = samples.length;
    if (n < 3) return { a: fallback, b: 0, c: 0 };
    var sx = 0, sy = 0, ss = 0, sxx = 0, sxy = 0, syy = 0;
    var sxs = 0, sys = 0;
    for (var i = 0; i < n; i++) {
      var p = samples[i], v = p.s;
      sx += p.x; sy += p.y; ss += v;
      sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y;
      sxs += p.x * v; sys += p.y * v;
    }
    var det = n * (sxx * syy - sxy * sxy) -
      sx * (sx * syy - sxy * sy) + sy * (sx * sxy - sxx * sy);
    if (!(Math.abs(det) > 1e-9)) return { a: fallback, b: 0, c: 0 };
    var a = (ss * (sxx * syy - sxy * sxy) -
      sx * (sxs * syy - sxy * sys) +
      sy * (sxs * sxy - sxx * sys)) / det;
    var b = (n * (sxs * syy - sxy * sys) -
      ss * (sx * syy - sxy * sy) +
      sy * (sx * sys - sxs * sy)) / det;
    var c = (n * (sxx * sys - sxs * sxy) -
      sx * (sx * sys - sxs * sy) +
      ss * (sx * sxy - sxx * sy)) / det;
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) {
      return { a: fallback, b: 0, c: 0 };
    }
    return { a: a, b: b, c: c };
  }

  function faceShadePlane(g, index, pts, normals, smooth, st) {
    var base = shadeOfNormal(g.faceNormals[index], st);
    if (!smooth) return { a: base, b: 0, c: 0 };
    var loop = g.faces[index];
    var samples = [];
    for (var k = 0; k < loop.length; k++) {
      var p = pts[loop[k]];
      var n = normals[loop[k]];
      if (!p || !n) continue;
      samples.push({ x: p.x, y: p.y, s: shadeOfNormal(n, st) });
    }
    return fitShadePlane(samples, base);
  }

  function flatFaceColor(n, st) {
    return litFaceColor(cameraNormal(n, st), st);
  }

  function smoothVertexNormals(g) {
    var sums = {};
    var sm = {};
    var list = g.smoothSideFaces || [];
    for (var i = 0; i < list.length; i++) sm[list[i]] = true;
    for (var f = 0; f < g.faces.length; f++) {
      if (!sm[f]) continue;
      var n = g.faceNormals[f];
      var loop = g.faces[f];
      for (var k = 0; k < loop.length; k++) {
        var key = loop[k];
        if (!sums[key]) sums[key] = { x: 0, y: 0, z: 0 };
        sums[key].x += n.x; sums[key].y += n.y; sums[key].z += n.z;
      }
    }
    var out = {};
    for (var v in sums) {
      if (!Object.prototype.hasOwnProperty.call(sums, v)) continue;
      var s = sums[v];
      var len = Math.sqrt(s.x * s.x + s.y * s.y + s.z * s.z);
      if (len > 1e-12) {
        out[v] = { x: s.x / len, y: s.y / len, z: s.z / len };
      }
    }
    return out;
  }

  function smoothFaceSides(g, i, pts, conics, normals) {
    var loop = g.faces[i];
    var sides = [];
    for (var k = 0; k < loop.length; k++) {
      var ai = loop[k], bi = loop[(k + 1) % loop.length];
      if (conics[edgeKey(ai, bi)]) continue;
      var na = normals[ai] || g.faceNormals[i];
      var nb = normals[bi] || g.faceNormals[i];
      var n = { x: na.x + nb.x, y: na.y + nb.y, z: na.z + nb.z };
      var len = Math.sqrt(n.x * n.x + n.y * n.y + n.z * n.z);
      if (!(len > 1e-12)) n = g.faceNormals[i];
      else { n.x /= len; n.y /= len; n.z /= len; }
      var pa = pts[ai], pb = pts[bi];
      if (!pa || !pb) continue;
      sides.push({
        x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2, normal: n
      });
    }
    return sides;
  }

  function loopDepth(loop, pts) {
    var sum = 0, count = 0;
    for (var i = 0; i < loop.length; i++) {
      var p = pts[loop[i]];
      if (!p) continue;
      sum += p.z; count++;
    }
    return count ? sum / count : 0;
  }

  function loopProjectable(loop, pts) {
    if (!loop || loop.length < 3) return false;
    for (var i = 0; i < loop.length; i++) {
      if (!pts[loop[i]]) return false;
    }
    return true;
  }

  function loopRing(loop, pts, conics, runs) {
    if (!loop || loop.length < 3) return null;
    var ring = [];
    for (var i = 0; i < loop.length; i++) {
      var ai = loop[i], bi = loop[(i + 1) % loop.length];
      if (!pts[bi]) return null;
      var run = conicRunFor(runs, conics[edgeKey(ai, bi)], ai, bi);
      if (run && run.length > 1) {
        for (var j = 0; j < run.length - 1; j++) ring.push(run[j]);
      } else {
        var pa = pts[ai];
        if (!pa) return null;
        ring.push(pa);
      }
    }
    return ring.length >= 3 ? ring : null;
  }

  function buildFaceRings(g, index, pts, conics, runs) {
    var rings = [];
    var outer = loopRing(g.faces[index], pts, conics, runs);
    if (!outer) return null;
    rings.push(outer);
    var holes = (g.faceHoles || [])[index] || [];
    for (var h = 0; h < holes.length; h++) {
      var ring = loopRing(holes[h], pts, conics, runs);
      if (ring) rings.push(ring);
    }
    return rings;
  }

  var RASTER_SUPERSAMPLE = 2;
  var RASTER_MAX_PIXELS = 1400000;
  var rasterScratch = {
    canvas: null, ctx: null, image: null, depth: null, shade: null,
    width: 0, height: 0
  };

  function rasterBuffer(w, h) {
    if (!rasterScratch.canvas && hasDOM()) {
      var cv = document.createElement('canvas');
      var c2 = null;
      try { c2 = cv.getContext('2d'); } catch (e) { c2 = null; }
      if (!c2 || typeof c2.createImageData !== 'function' ||
          typeof c2.putImageData !== 'function') return null;
      rasterScratch.canvas = cv;
      rasterScratch.ctx = c2;
    }
    if (!rasterScratch.canvas) return null;
    var s = rasterScratch;
    if (s.width !== w || s.height !== h) {
      s.canvas.width = w;
      s.canvas.height = h;
      s.width = w;
      s.height = h;
      s.image = s.ctx.createImageData(w, h);
      s.depth = new Float64Array(w * h);
      s.shade = new Uint8Array(w * h);
    }
    s.image.data.fill(0);
    s.depth.fill(-Infinity);
    return s;
  }

  function rasterFaces(ctx, st, g, pts, conics, runs, cx, cy, normals) {
    var smooth = {};
    var smoothList = g.smoothSideFaces || [];
    for (var s = 0; s < smoothList.length; s++) smooth[smoothList[s]] = true;
    var draws = [];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var i = 0; i < g.faces.length; i++) {
      var rings = buildFaceRings(g, i, pts, conics, runs);
      if (!rings) continue;
      var plane = faceShadePlane(g, i, pts, normals, !!smooth[i], st);
      for (var r = 0; r < rings.length; r++) {
        var ring = rings[r];
        for (var k = 0; k < ring.length; k++) {
          var p = ring[k];
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
      }
      draws.push({ rings: rings, plane: plane });
    }
    if (!draws.length) return true;
    var bounds = null;
    if (ctx.canvas && typeof ctx.getTransform === 'function') {
      try {
        var m = ctx.getTransform();
        if (m && isFinite(m.a) && isFinite(m.d) &&
            isFinite(m.e) && isFinite(m.f) &&
            m.a > 0 && m.d > 0 &&
            Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9 &&
            isFinite(ctx.canvas.width) && isFinite(ctx.canvas.height)) {
          bounds = {
            left: -m.e / m.a,
            right: (ctx.canvas.width - m.e) / m.a,
            top: -m.f / m.d,
            bottom: (ctx.canvas.height - m.f) / m.d
          };
        }
      } catch (err) { bounds = null; }
    }
    if (bounds) {
      if (minX < bounds.left) minX = bounds.left;
      if (maxX > bounds.right) maxX = bounds.right;
      if (minY < bounds.top) minY = bounds.top;
      if (maxY > bounds.bottom) maxY = bounds.bottom;
    } else {
      var screenW = (typeof st.w === 'number' && st.w > 0) ? st.w :
        ((typeof st.size === 'number' && st.size > 0) ? st.size : 0);
      var screenH = (typeof st.h === 'number' && st.h > 0) ? st.h :
        ((typeof st.size === 'number' && st.size > 0) ? st.size : 0);
      if (screenW > 0) {
        if (minX < 0) minX = 0;
        if (maxX > screenW) maxX = screenW;
      }
      if (screenH > 0) {
        if (minY < 0) minY = 0;
        if (maxY > screenH) maxY = screenH;
      }
    }
    if (!(maxX > minX && maxY > minY)) return true;
    var bw = maxX - minX, bh = maxY - minY;
    var ss = RASTER_SUPERSAMPLE;
    var pw = 1, ph = 1;
    for (var t = 0; t < 6; t++) {
      pw = Math.max(1, Math.ceil(bw * ss));
      ph = Math.max(1, Math.ceil(bh * ss));
      if (pw * ph <= RASTER_MAX_PIXELS) break;
      ss *= Math.sqrt(RASTER_MAX_PIXELS / (pw * ph)) * 0.97;
    }
    if (!(ss > 0) || !isFinite(ss)) return false;
    var buf = rasterBuffer(pw, ph);
    if (!buf) return false;
    var depth = buf.depth, shade = buf.shade;
    for (var d = 0; d < draws.length; d++) {
      var draw = draws[d];
      var plane = draw.plane;
      var pa = plane.a + plane.b * minX + plane.c * minY;
      var pb = plane.b / ss, pc = plane.c / ss;
      var xs = [], zs = [], order = [];
      function byX(a, b) { return xs[a] - xs[b]; }
      for (var py = 0; py < ph; py++) {
        xs.length = 0;
        zs.length = 0;
        order.length = 0;
        var sy = minY + (py + 0.5) / ss;
        for (var rr = 0; rr < draw.rings.length; rr++) {
          var ring2 = draw.rings[rr];
          for (var vi = 0; vi < ring2.length; vi++) {
            var p0 = ring2[vi], p1 = ring2[(vi + 1) % ring2.length];
            if ((p0.y <= sy && p1.y > sy) || (p1.y <= sy && p0.y > sy)) {
              var f = (sy - p0.y) / (p1.y - p0.y);
              xs.push(p0.x + (p1.x - p0.x) * f);
              zs.push(p0.z + (p1.z - p0.z) * f);
            }
          }
        }
        if (xs.length < 2) continue;
        for (var q = 0; q < xs.length; q++) order.push(q);
        order.sort(byX);
        for (var ci = 0; ci + 1 < order.length; ci += 2) {
          var ia = order[ci], ib = order[ci + 1];
          var xa = xs[ia], xb = xs[ib];
          if (!(xb > xa)) continue;
          var za = zs[ia], zb = zs[ib];
          var px0 = Math.ceil((xa - minX) * ss - 0.5);
          var px1 = Math.floor((xb - minX) * ss - 0.5);
          if (px0 < 0) px0 = 0;
          if (px1 >= pw) px1 = pw - 1;
          if (px1 < px0) continue;
          var slope = (zb - za) / (xb - xa);
          var z = za + ((minX + (px0 + 0.5) / ss) - xa) * slope;
          var zStep = slope / ss;
          var row = py * pw;
          for (var px = px0; px <= px1; px++, z += zStep) {
            var idx = row + px;
            if (z > depth[idx]) {
              depth[idx] = z;
              var sv = (pa + pb * (px + 0.5) + pc * (py + 0.5)) * 255;
              shade[idx] = sv < 0 ? 0 : (sv > 255 ? 255 : sv);
            }
          }
        }
      }
    }
    var lut = shadeLut(st);
    var data = buf.image.data;
    for (var pidx = 0; pidx < depth.length; pidx++) {
      if (depth[pidx] === -Infinity) continue;
      var rgb = lut[shade[pidx]];
      var o = pidx * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
    try {
      buf.ctx.putImageData(buf.image, 0, 0);
      ctx.globalAlpha = 1;
      if (typeof ctx.imageSmoothingEnabled !== 'undefined') {
        try { ctx.imageSmoothingEnabled = true; } catch (e) { }
      }
      ctx.drawImage(buf.canvas, 0, 0, pw, ph,
        minX, minY, pw / ss, ph / ss);
    } catch (err) {
      return false;
    }
    return true;
  }

  function drawFaces(ctx, st, g, pts, conics, runs, cx, cy) {
    var normals = smoothVertexNormals(g);
    if (hasDOM() && typeof ctx.drawImage === 'function' &&
        rasterFaces(ctx, st, g, pts, conics, runs, cx, cy, normals)) {
      return;
    }
    var faces = [];
    var smooth = {};
    var smoothList = g.smoothSideFaces || [];
    for (var s = 0; s < smoothList.length; s++) smooth[smoothList[s]] = true;
    for (var i = 0; i < g.faces.length; i++) {
      var loop = g.faces[i];
      if (!loopProjectable(loop, pts)) continue;
      faces.push({ index: i, depth: loopDepth(loop, pts) });
    }
    faces.sort(function (a, b) {
      return a.depth - b.depth || a.index - b.index;
    });
    for (var f = 0; f < faces.length; f++) {
      var index = faces[f].index;
      var face = g.faces[index];
      var pathOk;
      ctx.beginPath();
      pathOk = appendLoopPath(ctx, st, face, pts, conics, cx, cy, runs);
      var holes = (g.faceHoles || [])[index] || [];
      for (var h = 0; h < holes.length; h++) {
        if (!loopProjectable(holes[h], pts)) continue;
        appendLoopPath(ctx, st, holes[h], pts, conics, cx, cy, runs);
      }
      if (!pathOk) continue;
      var fill = null;
      if (smooth[index]) {
        var sides = smoothFaceSides(g, index, pts, conics, normals);
        if (sides.length >= 2 &&
            typeof ctx.createLinearGradient === 'function') {
          var sa = sides[0], sb = sides[sides.length - 1];
          var dx = sb.x - sa.x, dy = sb.y - sa.y;
          if (dx * dx + dy * dy > 0.25) {
            fill = ctx.createLinearGradient(sa.x, sa.y, sb.x, sb.y);
            fill.addColorStop(0, flatFaceColor(sa.normal, st));
            fill.addColorStop(1, flatFaceColor(sb.normal, st));
          }
        }
      }
      if (!fill) fill = flatFaceColor(g.faceNormals[index], st);
      ctx.fillStyle = fill;
      ctx.globalAlpha = 1;
      ctx.fill('evenodd');
    }
  }

  function drawEdgePass(ctx, st, edges, wantHidden, pts, conics, runs, cx, cy, inspect) {
    var hidden = !!wantHidden;
    var drew = false;
    ctx.beginPath();
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      if ((e.hidden ? 1 : 0) !== (hidden ? 1 : 0)) continue;
      if (!pts[e.a] || !pts[e.b]) continue;
      drew = true;
      appendEdgeStroke(ctx, st, conics[edgeKey(e.a, e.b)],
        e.a, e.b, pts, cx, cy, runs);
    }
    if (!drew) return;
    ctx.strokeStyle = themeColor('solidLine', LINE_COLOR);
    ctx.globalAlpha = hidden ? (inspect ? 0.32 : HIDDEN_OPACITY) : 1;
    ctx.lineWidth = hidden && inspect ? 1.15 : LINE_WIDTH_PX;
    if (typeof ctx.setLineDash === 'function') {
      ctx.setLineDash(hidden ? HIDDEN_DASH : []);
    }
    ctx.stroke();
  }

  function faceVertexIds(g) {
    var used = {};
    for (var i = 0; i < g.faces.length; i++) {
      var loops = [g.faces[i]].concat((g.faceHoles || [])[i] || []);
      for (var l = 0; l < loops.length; l++) {
        for (var k = 0; k < loops[l].length; k++) used[loops[l][k]] = true;
      }
    }
    return used;
  }

  function drawDots(ctx, st, g, pts, edges, dots, cx, cy, inspect) {
    var used = faceVertexIds(g);
    ctx.fillStyle = themeColor('solidVertex', VERTEX_FILL);
    if (!inspect) {
      var any = false;
      ctx.beginPath();
      for (var i = 0; i < pts.length; i++) {
        if (dots[i] || used[i]) continue;
        any = true;
        ctx.moveTo(pts[i].x + VERTEX_R_PX, pts[i].y);
        ctx.arc(pts[i].x, pts[i].y, VERTEX_R_PX, 0, TAU);
      }
      if (any) {
        ctx.globalAlpha = 1;
        if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
        ctx.fill();
      }
      return;
    }
    var front = {}, incident = {};
    for (var e = 0; e < edges.length; e++) {
      incident[edges[e].a] = true;
      incident[edges[e].b] = true;
      if (!edges[e].hidden) {
        front[edges[e].a] = true;
        front[edges[e].b] = true;
      }
    }
    var radius = 2.3;
    for (var pass = 0; pass < 2; pass++) {
      var wantFront = pass === 1;
      ctx.beginPath();
      var drew = false;
      for (var v = 0; v < pts.length; v++) {
        if (dots[v]) continue;
        var visible = !incident[v] || !!front[v];
        if (visible !== wantFront) continue;
        drew = true;
        ctx.moveTo(pts[v].x + radius, pts[v].y);
        ctx.arc(pts[v].x, pts[v].y, radius, 0, TAU);
      }
      if (!drew) continue;
      ctx.globalAlpha = wantFront ? 1 : 0.32;
      ctx.fill();
    }
  }

  function drawSectionOutlines(ctx, st, cx, cy) {
    var source = st.geometryMm || st.geometry, transform = st.geometryTransform;
    var sections = source && source.sections && source.sections.queries;
    if (!Array.isArray(sections) || !sections.length) return;
    var radius = projectionRadius(st);
    ctx.save();
    ctx.strokeStyle = themeColor('solidSection', '#a64d0f');
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    sections.forEach(function (section) {
      var components = section.display && section.display.components || [];
      components.forEach(function (component) {
        if (!component.points || !component.points.every(finitePoint)) return;
        component.points.forEach(function (p, i) {
          var x = transform ? (p.x - transform.cx) * transform.scale : p.x;
          var y = transform ? (p.y - transform.cy) * transform.scale : p.y;
          var z = transform ? (p.z - transform.cz) * transform.scale : p.z;
          var q = rotateDir(x, y, z, st.yaw, st.pitch);
          if (i) ctx.lineTo(cx + q.x * radius, cy - q.y * radius);
          else ctx.moveTo(cx + q.x * radius, cy - q.y * radius);
        });
        if (component.closed) ctx.closePath();
      });
    });
    ctx.stroke();
    ctx.restore();
  }

  function renderScene(ctx, st, o) {
    if (!ctx || typeof ctx.beginPath !== 'function') return null;
    o = o || {};
    var size = st.size;
    var cx = (o.cxPx === undefined || o.cxPx === null) ? size / 2 : o.cxPx;
    var cy = (o.cyPx === undefined || o.cyPx === null) ? size / 2 : o.cyPx;
    assertFinite(cx, cy);
    var status = statusOf(st);
    if (!status.available) return renderUnavailable(ctx, status, cx, cy);
    var g = geometryOf(st);
    var pts = project(st, cx, cy);
    var edges = classifyEdges(st);
    var conics = buildConicEdgeMap(g);
    var runs = buildConicRunCache(st, conics, cx, cy);
    var dots = curveDotSuppression(g, edges);
    var counts = { front: 0, hidden: 0, vertices: pts.length };
    for (var c = 0; c < edges.length; c++) {
      if (edges[c].hidden) counts.hidden++;
      else counts.front++;
    }
    var inspect = !!st.inspection;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var wireframe = (inspect || st.posing) && st.modelStyle === 'wireframe';
    if (!wireframe) drawFaces(ctx, st, g, pts, conics, runs, cx, cy);
    var standalone = [];
    var edgeFaces = g.edgeFaces || [];
    for (var e = 0; e < edges.length; e++) {
      var f = edgeFaces[edges[e].index];
      if (!f || f.length === 0) standalone.push(edges[e]);
    }
    if (inspect || wireframe) {
      drawEdgePass(ctx, st, edges, true, pts, conics, runs, cx, cy, true);
      drawEdgePass(ctx, st, edges, false, pts, conics, runs, cx, cy, true);
    } else {
      drawEdgePass(ctx, st, standalone, true, pts, conics, runs, cx, cy, false);
      drawEdgePass(ctx, st, standalone, false, pts, conics, runs, cx, cy, false);
    }
    drawSectionOutlines(ctx, st, cx, cy);
    drawDots(ctx, st, g, pts, edges, dots, cx, cy, inspect);
    ctx.restore();
    return counts;
  }

  function renderUnavailable(ctx, status, cx, cy) {
    var msg = status.label || status.reason || 'unavailable';
    ctx.save();
    try {
      ctx.fillStyle = themeColor('solidLine', LINE_COLOR);
      ctx.globalAlpha = 1;
      if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'center';
      if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'middle';
      if (typeof ctx.fillText === 'function') {
        if (status.reason === 'empty-sheet') {
          ctx.fillStyle = themeColor('muted', '#64748b');
          ctx.font = STATUS_SUB_FONT;
          ctx.fillText('Add matching geometry in the front', cx, cy - 9);
          ctx.fillText('and top views to build a 3D preview.', cx, cy + 9);
        } else {
          ctx.font = STATUS_FONT;
          ctx.fillText('3D unavailable', cx, cy - 9);
          ctx.font = STATUS_SUB_FONT;
          ctx.globalAlpha = 0.75;
          ctx.fillText(String(msg), cx, cy + 9);
        }
      }
    } finally {
      if (typeof ctx.restore === 'function') ctx.restore();
    }
    return { front: 0, hidden: 0, vertices: 0, unavailable: status.reason };
  }







  function render(ctx, st, o) {
    return renderScene(ctx, st, o);
  }

  function hasDOM() {
    return (typeof document !== 'undefined') && !!document &&
      (typeof document.createElement === 'function');
  }

  function stopEvt(e) {
    if (!e) return;
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }

  function resolveDpr(optsDpr) {
    if (optsDpr !== undefined && optsDpr !== null) {
      var o = Number(optsDpr);
      if (isFinite(o) && o >= 1) return o;
    }
    if (typeof window !== 'undefined' && window &&
        isFinite(Number(window.devicePixelRatio)) &&
        Number(window.devicePixelRatio) >= 1) {
      return Number(window.devicePixelRatio);
    }
    return 1;
  }




  function mountSolidWidget(container, opts) {
    opts = opts || {};
    var st = createSolidState(opts);
    if (!hasDOM() || container === null || container === undefined ||
        typeof container.appendChild !== 'function') {
      return {
        headless: true, container: null, el: null, canvas: null,
        handle: null, state: st, mounted: true,
        draw: function () { return null; },
        dispose: function () { return null; }
      };
    }
    var dpr = resolveDpr(opts.dpr);
    var buf = Math.max(1, Math.round(st.size * dpr));

    var el = document.createElement('div');
    el.className = WIDGET_CLASS;
    el.setAttribute('data-solid', geometryOf(st).name || 'cube');
    el.style.width = st.size + 'px';
    el.style.height = st.size + 'px';
    if (opts.x !== undefined && opts.x !== null &&
        opts.y !== undefined && opts.y !== null) {
      assertFinite(opts.x, opts.y);
      el.style.left = Math.round(opts.x) + 'px';
      el.style.top = Math.round(opts.y) + 'px';
    } else {
      el.style.right = '24px';
      el.style.top = '64px';
    }

    var grip = document.createElement('div');
    grip.className = HANDLE_CLASS;
    grip.textContent = HANDLE_TEXT;
    el.appendChild(grip);

    var cv = document.createElement('canvas');
    cv.className = CANVAS_CLASS;
    cv.width = buf;
    cv.height = buf;
    cv.style.width = st.size + 'px';
    cv.style.height = st.size + 'px';
    el.appendChild(cv);
    container.appendChild(el);

    var ctx = null;
    try {
      if (typeof cv.getContext === 'function') ctx = cv.getContext('2d');
    } catch (e) { ctx = null; }

    function draw() {
      if (!ctx) return null;
      if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (typeof ctx.clearRect === 'function') {
        ctx.clearRect(0, 0, st.size, st.size);
      }
      return render(ctx, st);
    }


    var rafPending = false;
    function scheduleDraw() {
      if (rafPending) return;
      rafPending = true;
      var raf = (typeof window !== 'undefined' && window &&
        typeof window.requestAnimationFrame === 'function') ?
        window.requestAnimationFrame : null;
      if (!raf) {
        rafPending = false;
        draw();
        return;
      }
      raf(function () {
        rafPending = false;
        draw();
      });
    }

    function capture(el2, e) {
      try {
        if (el2 && typeof el2.setPointerCapture === 'function' &&
            e && e.pointerId !== undefined) {
          el2.setPointerCapture(e.pointerId);
        }
      } catch (err) {                                                     }
    }


    var orbiting = false;
    var lastX = 0, lastY = 0;
    function onOrbitDown(e) {
      stopEvt(e);
      if (e && e.button !== undefined && e.button !== 0) return;
      if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) return;
      orbiting = true;
      lastX = e.clientX;
      lastY = e.clientY;
      cv.style.cursor = 'grabbing';
      capture(cv, e);
    }
    function onOrbitMove(e) {
      if (!orbiting) return;
      stopEvt(e);
      rotateBy(st, e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleDraw();
    }
    function onOrbitUp(e) {
      if (!orbiting) return;
      stopEvt(e);
      orbiting = false;
      cv.style.cursor = '';
    }


    var moving = false;
    var mStartX = 0, mStartY = 0, mBaseL = 0, mBaseT = 0;
    function onGripDown(e) {
      stopEvt(e);
      if (e && e.button !== undefined && e.button !== 0) return;
      moving = true;
      mStartX = e.clientX;
      mStartY = e.clientY;


      mBaseL = el.offsetLeft || 0;
      mBaseT = el.offsetTop || 0;
      el.style.right = 'auto';
      el.style.left = mBaseL + 'px';
      el.style.top = mBaseT + 'px';
      capture(grip, e);
    }
    function onGripMove(e) {
      if (!moving) return;
      stopEvt(e);
      var w = (container && container.clientWidth) || window.innerWidth || st.size;
      var h = (container && container.clientHeight) || window.innerHeight || st.size;
      var nl = clamp(mBaseL + (e.clientX - mStartX), 0, Math.max(0, w - st.size));
      var nt = clamp(mBaseT + (e.clientY - mStartY), 0, Math.max(0, h - st.size));
      el.style.left = Math.round(nl) + 'px';
      el.style.top = Math.round(nt) + 'px';
    }
    function onGripUp(e) {
      if (!moving) return;
      stopEvt(e);
      moving = false;
    }

    function onWheel(e) {
      stopEvt(e);
      var f = (e && e.deltaY < 0) ? ZOOM_STEP : (1 / ZOOM_STEP);
      zoomBy(st, f);
      scheduleDraw();
    }
    function onDblClick(e) {
      stopEvt(e);
      resetView(st);
      scheduleDraw();
    }
    function onIsolate(e) {

      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    cv.addEventListener('pointerdown', onOrbitDown);
    cv.addEventListener('pointermove', onOrbitMove);
    cv.addEventListener('pointerup', onOrbitUp);
    cv.addEventListener('pointercancel', onOrbitUp);
    grip.addEventListener('pointerdown', onGripDown);
    grip.addEventListener('pointermove', onGripMove);
    grip.addEventListener('pointerup', onGripUp);
    grip.addEventListener('pointercancel', onGripUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('click', onIsolate);
    el.addEventListener('contextmenu', onIsolate);

    draw();

    return {
      headless: false, container: container, el: el, canvas: cv,
      handle: grip, state: st, mounted: true, dpr: dpr,
      draw: draw,
      dispose: function () {
        cv.removeEventListener('pointerdown', onOrbitDown);
        cv.removeEventListener('pointermove', onOrbitMove);
        cv.removeEventListener('pointerup', onOrbitUp);
        cv.removeEventListener('pointercancel', onOrbitUp);
        grip.removeEventListener('pointerdown', onGripDown);
        grip.removeEventListener('pointermove', onGripMove);
        grip.removeEventListener('pointerup', onGripUp);
        grip.removeEventListener('pointercancel', onGripUp);
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('dblclick', onDblClick);
        el.removeEventListener('click', onIsolate);
        el.removeEventListener('contextmenu', onIsolate);
        if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
          el.parentNode.removeChild(el);
        }
        orbiting = false;
        moving = false;
        return null;
      }
    };
  }





  function glassBaseRadius(w, h) {
    assertFinite(w, h);
    if (!(w > 0 && h > 0)) throw new Error('glass needs positive w/h');
    return clamp(Math.min(w, h) * GLASS_RADIUS_FRAC,
      GLASS_RADIUS_MIN, GLASS_RADIUS_MAX);
  }



  function glassRestCenter(w, h, baseR) {
    assertFinite(w, h, baseR);
    var x = w - Math.max(190, baseR * 2.1);
    var y = Math.max(170, baseR * 2.0);
    return {
      x: clamp(x, 40, Math.max(40, w - 40)),
      y: clamp(y, 40, Math.max(40, h - 40))
    };
  }




  function createGlassState(opts) {
    opts = opts || {};
    var w = (opts.w === undefined || opts.w === null) ? 800 : opts.w;
    var h = (opts.h === undefined || opts.h === null) ? 600 : opts.h;
    assertFinite(w, h);
    if (!(w > 0 && h > 0)) throw new Error('glass needs positive w/h');
    var st = createSolidState(opts);
    st.minScale = GLASS_ZOOM_MIN;
    st.maxScale = GLASS_ZOOM_MAX;
    var sc = (opts.scale === undefined || opts.scale === null) ?
      1 : opts.scale;
    assertFinite(sc);
    st.scale = clamp(sc, GLASS_ZOOM_MIN, GLASS_ZOOM_MAX);
    st.baseR = glassBaseRadius(w, h);
    st.w = w;
    st.h = h;
    var rest = glassRestCenter(w, h, st.baseR);
    st.cx = (opts.cx === undefined || opts.cx === null) ? rest.x : opts.cx;
    st.cy = (opts.cy === undefined || opts.cy === null) ? rest.y : opts.cy;
    assertFinite(st.cx, st.cy);
    return clampPan(st);
  }







  function clampPan(st) {
    if (!st || typeof st.cx !== 'number' || typeof st.cy !== 'number') {
      return st;
    }
    if (typeof st.w !== 'number' || typeof st.h !== 'number' ||
        !(st.w > 0) || !(st.h > 0)) {
      return st;
    }
    var r = projectionRadius(st);
    if (!isFinite(r) || r < 0) return st;
    var m = GLASS_PAN_MARGIN * r;
    st.cx = clamp(st.cx, -m, st.w + m);
    st.cy = clamp(st.cy, -m, st.h + m);
    return st;
  }


  function panBy(st, dxPx, dyPx) {
    assertFinite(dxPx, dyPx);
    if (typeof st.cx !== 'number' || typeof st.cy !== 'number') {
      var c = (st && isFinite(st.size)) ? st.size / 2 : 0;
      st.cx = c;
      st.cy = c;
    }
    st.cx += dxPx;
    st.cy += dyPx;
    return clampPan(st);
  }




  function glassZoomAt(st, mx, my, factor) {
    assertFinite(mx, my, factor);
    if (!(factor > 0)) throw new Error('zoom factor must be > 0');
    if (typeof st.cx !== 'number' || typeof st.cy !== 'number') {
      var c = (st && isFinite(st.size)) ? st.size / 2 : 0;
      st.cx = c;
      st.cy = c;
    }
    var r0 = projectionRadius(st);
    zoomBy(st, factor);
    var r1 = projectionRadius(st);
    var k = (r0 > 1e-12) ? r1 / r0 : 1;
    st.cx = mx + (st.cx - mx) * k;
    st.cy = my + (st.cy - my) * k;
    return clampPan(st);
  }


  function resetGlassView(st) {
    resetView(st);
    if (typeof st.w === 'number' && typeof st.h === 'number' &&
        typeof st.baseR === 'number' && st.w > 0 && st.h > 0) {
      var rest = glassRestCenter(st.w, st.h, st.baseR);
      st.cx = rest.x;
      st.cy = rest.y;
    }
    return clampPan(st);
  }



  function resizeGlassState(st, w, h) {
    assertFinite(w, h);
    if (!(w > 0 && h > 0)) throw new Error('glass needs positive w/h');
    st.w = w;
    st.h = h;
    return clampPan(st);
  }

  function defaultCenter(st) {
    var c = (st && isFinite(st.size)) ? st.size / 2 : 0;
    return {
      x: (st && typeof st.cx === 'number') ? st.cx : c,
      y: (st && typeof st.cy === 'number') ? st.cy : c
    };
  }



  function distPointSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    if (!(len2 > 1e-12)) {
      var ex = px - ax, ey = py - ay;
      return Math.sqrt(ex * ex + ey * ey);
    }
    var t = ((px - ax) * dx + (py - ay) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    var qx = px - (ax + dx * t), qy = py - (ay + dy * t);
    return Math.sqrt(qx * qx + qy * qy);
  }




  function buildGlassFrame(st) {
    var dc = defaultCenter(st);
    var status = statusOf(st);
    if (!status.available) {
      return {
        pts: [], edges: [], bbox: null,
        cx: dc.x, cy: dc.y, available: false
      };
    }
    var pts = project(st, dc.x, dc.y);
    var g = geometryOf(st);
    var bbox = null;
    if (pts.length > 0) {
      var minX = pts[0].x, minY = pts[0].y;
      var maxX = pts[0].x, maxY = pts[0].y;
      for (var i = 1; i < pts.length; i++) {
        if (pts[i].x < minX) minX = pts[i].x;
        if (pts[i].y < minY) minY = pts[i].y;
        if (pts[i].x > maxX) maxX = pts[i].x;
        if (pts[i].y > maxY) maxY = pts[i].y;
      }
      bbox = { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
    }
    return {
      pts: pts, edges: g.edges, faces: g.faces, faceHoles: g.faceHoles,
      bbox: bbox, cx: dc.x, cy: dc.y, available: true
    };
  }






  function pointInProjectedLoop(pts, loop, x, y) {
    if (!loop || loop.length < 3) return false;
    var winding = 0;
    for (var i = 0; i < loop.length; i++) {
      var pa = pts[loop[i]], pb = pts[loop[(i + 1) % loop.length]];
      if (!pa || !pb) return false;
      if (pa.y <= y) {
        if (pb.y > y && ((pb.x - pa.x) * (y - pa.y) -
            (x - pa.x) * (pb.y - pa.y)) > 0) winding++;
      } else if (pb.y <= y && ((pb.x - pa.x) * (y - pa.y) -
          (x - pa.x) * (pb.y - pa.y)) < 0) {
        winding--;
      }
    }
    return winding !== 0;
  }

  function pointInProjectedFace(frame, index, x, y) {
    var pts = frame.pts || [];
    var faces = frame.faces || [];
    var face = faces[index];
    if (!face || !pointInProjectedLoop(pts, face, x, y)) return false;
    var holes = (frame.faceHoles || [])[index] || [];
    for (var h = 0; h < holes.length; h++) {
      if (pointInProjectedLoop(pts, holes[h], x, y)) return false;
    }
    return true;
  }

  function hitTestFrame(frame, x, y, auraPx) {
    if (!frame || frame.available === false) return false;
    var a = (auraPx === undefined || auraPx === null) ?
      AURA_PX : Number(auraPx);
    if (!(a >= 0) || !isFinite(a)) return false;
    if (typeof x !== 'number' || typeof y !== 'number') return false;
    if (!isFinite(x) || !isFinite(y)) return false;
    var pts = frame.pts || [];
    var edges = frame.edges || [];
    if (pts.length < 1) return false;
    if (frame.bbox) {
      var b = frame.bbox, m = a + VERTEX_R_PX;
      if (x < b.minX - m || x > b.maxX + m ||
          y < b.minY - m || y > b.maxY + m) {
        return false;
      }
    }
    for (var i = 0; i < edges.length; i++) {
      var pa = pts[edges[i][0]], pb = pts[edges[i][1]];
      if (!pa || !pb) continue;
      if (distPointSeg(x, y, pa.x, pa.y, pb.x, pb.y) <= a) return true;
    }
    var faces = frame.faces || [];
    for (var f = 0; f < faces.length; f++) {
      if (pointInProjectedFace(frame, f, x, y)) return true;
    }
    var vr = a + VERTEX_R_PX;
    var vr2 = vr * vr;
    for (var j = 0; j < pts.length; j++) {
      var dx = x - pts[j].x, dy = y - pts[j].y;
      if (dx * dx + dy * dy <= vr2) return true;
    }
    return false;
  }






  function createTapState() {
    return { armed: false, t: 0, x: 0, y: 0 };
  }

  function tapHit(st, nowMs, x, y) {
    assertFinite(nowMs, x, y);
    var dt = nowMs - st.t;
    var near = (Math.abs(x - st.x) + Math.abs(y - st.y)) <= TAP_SLOP_PX;
    var hit = st.armed && (dt >= 0) && (dt < TAP_WINDOW_MS) && near;
    if (hit) {
      st.armed = false;
    } else {
      st.armed = true;
      st.t = nowMs;
      st.x = x;
      st.y = y;
    }
    return hit;
  }

  function invalidateTap(st) {
    st.armed = false;
    return st;
  }





  function renderFast(ctx, st, o) {
    o = o || {};
    var dc = defaultCenter(st);
    return renderScene(ctx, st, { cxPx: o.cxPx == null ? dc.x : o.cxPx, cyPx: o.cyPx == null ? dc.y : o.cyPx });
  }








  function mountSolidGlass(container, opts) {
    opts = opts || {};
    var cw = (container && isFinite(container.clientWidth)) ?
      container.clientWidth : 0;
    var ch = (container && isFinite(container.clientHeight)) ?
      container.clientHeight : 0;
    var ww = (typeof window !== 'undefined' && window &&
      isFinite(window.innerWidth)) ? window.innerWidth : 800;
    var wh = (typeof window !== 'undefined' && window &&
      isFinite(window.innerHeight)) ? window.innerHeight : 600;
    var w = (opts.w !== undefined && opts.w !== null) ? opts.w :
      (cw > 0 ? cw : ww);
    var h = (opts.h !== undefined && opts.h !== null) ? opts.h :
      (ch > 0 ? ch : wh);
    var st = createGlassState({
      w: w, h: h, yaw: opts.yaw, pitch: opts.pitch, scale: opts.scale,
      geometry: opts.geometry, cx: opts.cx, cy: opts.cy
    });
    function noopState() { return st; }
    if (!hasDOM() || container === null || container === undefined ||
        typeof container.appendChild !== 'function') {
      return {
        headless: true, container: null, el: null, canvas: null,
        state: st, mounted: true,
        draw: function () { return null; },
        scheduleDraw: function () { return null; },
        frameOf: function () { return null; },
        resize: function () { return st; },
        hitTest: function () { return false; },
        orbitBy: noopState, panBy: noopState, zoomAt: noopState,
        resetView: noopState,
        dispose: function () { return null; }
      };
    }
    var dpr = resolveDpr(opts.dpr);
    var el = document.createElement('div');
    el.className = GLASS_CLASS;
    el.setAttribute('data-solid', geometryOf(st).name || 'cube');


    el.style.position = 'absolute';
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.zIndex = '2';
    el.style.background = 'transparent';
    el.style.pointerEvents = 'none';
    el.style.overflow = 'hidden';
    var cv = document.createElement('canvas');
    cv.className = GLASS_CANVAS_CLASS;
    cv.style.display = 'block';
    cv.style.background = 'transparent';
    cv.style.pointerEvents = 'none';
    el.appendChild(cv);
    container.appendChild(el);
    var ctx = null;
    try {
      if (typeof cv.getContext === 'function') ctx = cv.getContext('2d');
    } catch (e) { ctx = null; }
    function applySize() {
      cv.width = Math.max(1, Math.round(st.w * dpr));
      cv.height = Math.max(1, Math.round(st.h * dpr));
      cv.style.width = st.w + 'px';
      cv.style.height = st.h + 'px';
      el.style.width = st.w + 'px';
      el.style.height = st.h + 'px';
    }
    applySize();
    var frame = null;
    var rectL = 0, rectT = 0;
    function draw() {
      if (!ctx) { frame = null; return null; }
      if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (typeof ctx.clearRect === 'function') {
        ctx.clearRect(0, 0, st.w, st.h);
      }
      if (typeof opts.drawUnderlay === 'function') opts.drawUnderlay(ctx, st);
      var counts = renderFast(ctx, st, { cxPx: st.cx, cyPx: st.cy });
      if (typeof opts.drawOverlay === 'function') opts.drawOverlay(ctx, st);
      frame = buildGlassFrame(st);
      try {
        if (typeof cv.getBoundingClientRect === 'function') {
          var r = cv.getBoundingClientRect();
          if (r && isFinite(r.left) && isFinite(r.top)) {
            rectL = r.left;
            rectT = r.top;
          }
        }
      } catch (err) {                                       }



      if (typeof opts.afterDraw === 'function') opts.afterDraw(st);
      return counts;
    }
    var rafPending = false;
    function scheduleDraw() {
      if (rafPending) return null;
      rafPending = true;
      var raf = (typeof window !== 'undefined' && window &&
        typeof window.requestAnimationFrame === 'function') ?
        window.requestAnimationFrame : null;
      if (!raf) {
        rafPending = false;
        return draw();
      }
      raf(function () {
        rafPending = false;
        draw();
      });
      return null;
    }
    var widget = {
      headless: false, container: container, el: el, canvas: cv,
      state: st, mounted: true, dpr: dpr,
      draw: draw, scheduleDraw: scheduleDraw,
      frameOf: function () { return frame; },
      resize: function (nw, nh) {
        resizeGlassState(st, nw, nh);
        applySize();
        scheduleDraw();
        return st;
      },
      hitTest: function (clientX, clientY, auraPx) {
        if (!frame) return false;
        return hitTestFrame(frame, clientX - rectL, clientY - rectT, auraPx);
      },
      orbitBy: function (dxPx, dyPx) {
        rotateBy(st, dxPx, dyPx);
        scheduleDraw();
        return st;
      },
      panBy: function (dxPx, dyPx) {
        panBy(st, dxPx, dyPx);
        scheduleDraw();
        return st;
      },
      zoomAt: function (clientX, clientY, factor) {
        glassZoomAt(st, clientX - rectL, clientY - rectT, factor);
        scheduleDraw();
        return st;
      },
      resetView: function () {
        resetGlassView(st);
        scheduleDraw();
        return st;
      },
      dispose: function () {
        if (el.parentNode &&
            typeof el.parentNode.removeChild === 'function') {
          el.parentNode.removeChild(el);
        }
        frame = null;
        return null;
      }
    };
    draw();
    return widget;
  }

  return {
    SIZE_DEFAULT: SIZE_DEFAULT, SIZE_MIN: SIZE_MIN, SIZE_MAX: SIZE_MAX,
    LINE_COLOR: LINE_COLOR, LINE_WIDTH_PX: LINE_WIDTH_PX,
    VERTEX_FILL: VERTEX_FILL, VERTEX_R_PX: VERTEX_R_PX,
    HIDDEN_DASH: HIDDEN_DASH, HIDDEN_OPACITY: HIDDEN_OPACITY,
    FACE_FILL: FACE_FILL,
    ISO_YAW_RAD: ISO_YAW_RAD, ISO_PITCH_RAD: ISO_PITCH_RAD,
    ORBIT_RAD_PER_PX: ORBIT_RAD_PER_PX,
    PITCH_LIMIT_RAD: PITCH_LIMIT_RAD,
    ZOOM_MIN: ZOOM_MIN, ZOOM_MAX: ZOOM_MAX, ZOOM_STEP: ZOOM_STEP,
    RADIUS_FRAC: RADIUS_FRAC,
    WIDGET_CLASS: WIDGET_CLASS, CANVAS_CLASS: CANVAS_CLASS,
    HANDLE_CLASS: HANDLE_CLASS, HANDLE_TEXT: HANDLE_TEXT,
    VERTICES: VERTICES, EDGES: EDGES,
    FACE_NORMALS: FACE_NORMALS, EDGE_FACES: EDGE_FACES,
    CUBE_FACES: CUBE_FACES,
    rotateDir: rotateDir, faceVisibility: faceVisibility,
    faceVisibilityFor: faceVisibilityFor,
    createSolidState: createSolidState,
    createGeometry: createGeometry, defaultGeometry: defaultGeometry,
    normalizeGeometry: normalizeGeometry,
    setGeometry: setGeometry, setUnavailable: setUnavailable,
    statusOf: statusOf,
    resetView: resetView,
    rotateBy: rotateBy, zoomBy: zoomBy,
    projectionRadius: projectionRadius,
    project: project, classifyEdges: classifyEdges,
    curveDotSuppression: curveDotSuppression,
    render: render,
    renderFast: renderFast,
    hasDOM: hasDOM,
    mountSolidWidget: mountSolidWidget,
    GLASS_RADIUS_FRAC: GLASS_RADIUS_FRAC,
    GLASS_RADIUS_MIN: GLASS_RADIUS_MIN,
    GLASS_RADIUS_MAX: GLASS_RADIUS_MAX,
    GLASS_ZOOM_MIN: GLASS_ZOOM_MIN, GLASS_ZOOM_MAX: GLASS_ZOOM_MAX,
    GLASS_PAN_MARGIN: GLASS_PAN_MARGIN,
    TAP_WINDOW_MS: TAP_WINDOW_MS, TAP_SLOP_PX: TAP_SLOP_PX,
    createTapState: createTapState,
    tapHit: tapHit, invalidateTap: invalidateTap,
    AURA_PX: AURA_PX,
    GLASS_CLASS: GLASS_CLASS, GLASS_CANVAS_CLASS: GLASS_CANVAS_CLASS,
    createGlassState: createGlassState,
    glassBaseRadius: glassBaseRadius,
    glassRestCenter: glassRestCenter,
    clampPan: clampPan, panBy: panBy,
    glassZoomAt: glassZoomAt,
    resetGlassView: resetGlassView,
    resizeGlassState: resizeGlassState,
    distPointSeg: distPointSeg,
    buildGlassFrame: buildGlassFrame,
    hitTestFrame: hitTestFrame,
    mountSolidGlass: mountSolidGlass
  };
});

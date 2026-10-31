(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADRef3d = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD reference-3D previews: the teacher's browser derives a small 3D
  // shape from the 2D model answer and stores it on the question; students
  // receive that shape (never the 2D ink) while the per-question show_3d
  // toggle is on, and draw the 2D views from it. Zero deps. Dual-env:
  // browser via window.EduCADRef3d, plain Node via module.exports.
  //
  // A preview is {status:'ok', geometry:{name, vertices, edges, faces}} or
  // {status:'unavailable', reason, label}, mirroring reconstructLive but
  // detached to plain JSON the server stores opaquely.
  var VERSION = '1.0.0-educad';

  function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
  }

  function copyVertex(v) {
    if (!v || !isFiniteNumber(v.x) || !isFiniteNumber(v.y) ||
        !isFiniteNumber(v.z)) {
      throw new Error('ref3d: bad vertex');
    }
    return { x: v.x, y: v.y, z: v.z };
  }

  function copyEdge(e, nverts) {
    if (!Array.isArray(e) || e.length < 2 ||
        !Number.isInteger(e[0]) || !Number.isInteger(e[1]) ||
        e[0] < 0 || e[1] < 0 || e[0] >= nverts || e[1] >= nverts ||
        e[0] === e[1]) {
      throw new Error('ref3d: bad edge');
    }
    return [e[0], e[1]];
  }

  function copyFace(f, nverts) {
    if (!Array.isArray(f) || f.length < 3) throw new Error('ref3d: bad face');
    var loop = [];
    for (var i = 0; i < f.length; i++) {
      if (!Number.isInteger(f[i]) || f[i] < 0 || f[i] >= nverts) {
        throw new Error('ref3d: bad face');
      }
      loop.push(f[i]);
    }
    return loop;
  }

  // Derive a storable preview from model-ink entity rows. R is the
  // reconstruct module (passed in so Node callers control the dep).
  // Returns null when there is nothing to derive from (no rows, no
  // module); a model that reconstructs to nothing yields an honest
  // {status:'unavailable'} preview instead of nothing.
  function buildPreview(entities, R) {
    if (!Array.isArray(entities) || !R ||
        typeof R.reconstructLive !== 'function') {
      return null;
    }
    var res;
    try {
      res = R.reconstructLive(entities);
    } catch (err) {
      return { status: 'unavailable', reason: 'preview-failed',
        label: 'could not build 3D preview' };
    }
    if (!res || res.status !== 'ok' || !res.geometry) {
      return {
        status: 'unavailable',
        reason: (res && res.reason) || 'preview-failed',
        label: (res && res.label) || 'could not build 3D preview'
      };
    }
    try {
      var g = res.geometry;
      var verts = (g.vertices || []).map(copyVertex);
      if (!verts.length) throw new Error('ref3d: empty geometry');
      var edges = (g.edges || []).map(function (e) {
        return copyEdge(e, verts.length);
      });
      var faces = (g.faces || []).map(function (f) {
        return copyFace(f, verts.length);
      });
      var preview = {
        status: 'ok',
        geometry: {
          name: String(g.name === undefined ? 'wireframe' : g.name),
          vertices: verts, edges: edges, faces: faces
        }
      };
      // Detach from live objects; the payload must survive JSON storage.
      return JSON.parse(JSON.stringify(preview));
    } catch (err) {
      return { status: 'unavailable', reason: 'preview-failed',
        label: 'could not build 3D preview' };
    }
  }

  // Shape check for previews arriving over the wire. Never throws.
  function validPreview(p) {
    try {
      if (!p || typeof p !== 'object') return false;
      if (p.status === 'unavailable') {
        return typeof p.reason === 'string' && p.reason !== '' &&
          typeof p.label === 'string' && p.label !== '';
      }
      if (p.status !== 'ok' || !p.geometry ||
          typeof p.geometry !== 'object') {
        return false;
      }
      var g = p.geometry;
      if (typeof g.name !== 'string' || !Array.isArray(g.vertices) ||
          !g.vertices.length) {
        return false;
      }
      var i;
      for (i = 0; i < g.vertices.length; i++) copyVertex(g.vertices[i]);
      if (!Array.isArray(g.edges) || !Array.isArray(g.faces)) return false;
      for (i = 0; i < g.edges.length; i++) copyEdge(g.edges[i], g.vertices.length);
      for (i = 0; i < g.faces.length; i++) copyFace(g.faces[i], g.vertices.length);
      return true;
    } catch (err) {
      return false;
    }
  }

  return {
    VERSION: VERSION,
    buildPreview: buildPreview,
    validPreview: validPreview
  };
});

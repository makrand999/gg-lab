(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./educad-parametric.js'));
  } else {
    root.EduCADRef3d = factory(root.EduCADParametric);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (Parametric) {
  'use strict';









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






  function buildPreview(entities, R) {
    if (!Array.isArray(entities) || !R ||
        typeof R.reconstruct !== 'function') {
      return null;
    }
    var res;
    try {
      res = R.reconstruct(entities);
    } catch (err) {
      return { status: 'unavailable', reason: 'preview-failed',
        label: 'could not build 3D preview' };
    }
    if (!res || res.status !== 'ok' || !res.geometry) {
      return {
        status: 'unavailable',
        reason: (res && res.reason) || 'preview-failed',
        label: (res && res.label) || 'could not build 3D preview',
        determination: res && res.determination,
        pipeline: res && res.pipeline,
        issues: JSON.parse(JSON.stringify(res && res.issues || []))
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
        determination: res.determination,
        label: res.label || '',
        issues: res.issues || [],
        pipeline: res.pipeline,
        geometry: {
          name: String(g.name === undefined ? 'wireframe' : g.name),
          vertices: verts, edges: edges, faces: faces,
          curves: g.curves || [], surfacePatches: g.surfacePatches || [],
          surfaces: g.surfaces || [], surfaceModel: g.surfaceModel || null,
          generatorLines: g.generatorLines || [],
          recesses: g.recesses || [], fillets: g.fillets || [],
          cavityVolumes: g.cavityVolumes || [], cavityRelations: g.cavityRelations || [],
          cavityUnions: g.cavityUnions || [],
          cavityTrims: g.cavityTrims || null,
          analyticSurfaceValidation: g.analyticSurfaceValidation || null,
          analyticCertificate: g.analyticCertificate || null,
          smoothSideFaces: g.smoothSideFaces, topologyStatus: g.topologyStatus,
          partialSubset: g.partialSubset === true,
          profileMap: g.profileMap, profileInferred: g.profileInferred,
          surfaceValidation: g.surfaceValidation, displaySync: g.displaySync || null,
          faceHoles: (g.faceHoles || faces.map(function() { return []; })).map(function(holes) { return holes.map(function(hole) { return copyFace(hole, verts.length); }); })
        }
      };

      return JSON.parse(JSON.stringify(preview));
    } catch (err) {
      return { status: 'unavailable', reason: 'preview-failed',
        label: 'could not build 3D preview' };
    }
  }


  function validPreview(p) {
    try {
      if (!p || typeof p !== 'object') return false;


      if (p.determination !== undefined && ['determined','inferred','partial','underdetermined','inconsistent','unsupported'].indexOf(p.determination) === -1) return false;
      if (p.issues !== undefined && (!Array.isArray(p.issues) || !p.issues.every(function(issue) {
        return issue && typeof issue.code === 'string' && typeof issue.message === 'string';
      }))) return false;
      if (p.status === 'ok' && (p.determination === 'inconsistent' || p.determination === 'underdetermined' || p.determination === 'unsupported')) return false;
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
      if (g.faceHoles !== undefined) {
        if (!Array.isArray(g.faceHoles) || g.faceHoles.length !== g.faces.length) return false;
        g.faceHoles.forEach(function(holes) {
          if (!Array.isArray(holes)) throw new Error('invalid face holes');
          holes.forEach(function(hole) { copyFace(hole, g.vertices.length); });
        });
      }
      if (g.displaySync !== undefined && g.displaySync !== null) {
        if (typeof g.displaySync !== 'object' ||
            ['ok','issues'].indexOf(g.displaySync.status) === -1 ||
            !Array.isArray(g.displaySync.diagnostics) ||
            !g.displaySync.diagnostics.every(function (diagnostic) {
              return diagnostic && typeof diagnostic.code === 'string' &&
                typeof diagnostic.message === 'string';
            })) return false;
      }
      function indices(values, count) {
        return Array.isArray(values) && values.every(function(v) {return Number.isInteger(v) && v>=0 && v<count;});
      }
      if (g.smoothSideFaces !== undefined && !indices(g.smoothSideFaces,g.faces.length)) return false;
      if (g.surfaces !== undefined && !Array.isArray(g.surfaces)) return false;
      if (g.surfaces !== undefined) {
        for (var si=0;si<g.surfaces.length;si++) {
          var surface=g.surfaces[si];
          if (!surface || !Array.isArray(surface.loops)) return false;
          for (var li=0;li<surface.loops.length;li++) {
            var lines=(surface.loops[li] || {}).lines;
            if (lines === undefined) continue;
            if (!Array.isArray(lines)) return false;
            for (var lj=0;lj<lines.length;lj++) {
              var line=lines[lj], dx, dy, dz;
              if (!line || line.kind !== 'line') return false;
              copyVertex(line.start); copyVertex(line.end);
              dx=line.end.x-line.start.x; dy=line.end.y-line.start.y; dz=line.end.z-line.start.z;
              if (dx*dx+dy*dy+dz*dz <= 1e-14) return false;
            }
          }
        }
      }
      if (g.recesses !== undefined && !Array.isArray(g.recesses)) return false;
      if (g.fillets !== undefined && !Array.isArray(g.fillets)) return false;
      if (g.surfaceModel !== undefined && g.surfaceModel !== null && typeof g.surfaceModel !== 'object') return false;
      if (g.analyticSurfaceValidation !== undefined && g.analyticSurfaceValidation !== null &&
          typeof g.analyticSurfaceValidation !== 'object') return false;
      if (g.analyticCertificate !== undefined && g.analyticCertificate !== null) {
        if (typeof g.analyticCertificate !== 'object') return false;
        if (['ok','partial','issues'].indexOf(g.analyticCertificate.status) === -1) return false;
      }
      if (g.cavityTrims !== undefined && g.cavityTrims !== null) {
        if (typeof g.cavityTrims !== 'object' ||
            g.cavityTrims.contract !== 'cavity-analytic-trim-v1' ||
            !Array.isArray(g.cavityTrims.pairs) ||
            !Array.isArray(g.cavityTrims.boundaries) ||
            ['none','partial','unsupported'].indexOf(g.cavityTrims.status) === -1) return false;
      }
      if (g.curves !== undefined) {
        if (!Array.isArray(g.curves)) return false;
        for (var ci=0;ci<g.curves.length;ci++) {
          var c=g.curves[ci];
          if(c && c.kind==='nurbs') {
            if(!Parametric.validate(c)||!indices(c.displayVertices,g.vertices.length)||!indices(c.displayEdges,g.edges.length))return false;
            continue;
          }
          if(c && c.kind==='polyline') {
            if(!Array.isArray(c.points)||c.points.length<2)return false;
            c.points.forEach(copyVertex);
            if(!indices(c.displayVertices,g.vertices.length)||!indices(c.displayEdges,g.edges.length))return false;
            continue;
          }
          if (!c || ['circle','circular-arc','ellipse','arc'].indexOf(c.kind)===-1 ||
              !isFiniteNumber(c.startAngle) || !isFiniteNumber(c.sweepAngle) || c.sweepAngle<=0) return false;
          if (c.kind === 'ellipse' || c.radiusU !== undefined || c.radiusV !== undefined) {
            if (!isFiniteNumber(c.radiusU) || c.radiusU<=0 || !isFiniteNumber(c.radiusV) || c.radiusV<=0) return false;
          } else if (!isFiniteNumber(c.radius) || c.radius<=0) return false;
          copyVertex(c.center); copyVertex(c.u); copyVertex(c.v);
          if (!indices(c.displayVertices,g.vertices.length) || !indices(c.displayEdges,g.edges.length)) return false;
        }
      }
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

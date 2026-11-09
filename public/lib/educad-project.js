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

  function sheetPoint(v, view, map) {
    if (view === 'front') return {x:v.x,y:v.y};
    if (view === 'top') return {x:v.x,y:-v.z};
    return {x:map.xRef + map.s * (v.z - map.dRef), y:v.y};
  }
  function pointOnEdge(verts, a, b, t) {
    var va=verts[a],vb=verts[b];
    return {x:va.x+(vb.x-va.x)*t,y:va.y+(vb.y-va.y)*t,z:va.z+(vb.z-va.z)*t};
  }
  function faceAxis(nx, ny, nz) {
    return Math.abs(nx)>Math.abs(ny)&&Math.abs(nx)>Math.abs(nz)?'x':Math.abs(ny)>Math.abs(nz)?'y':'z';
  }
  function faceXY(p, axis) {
    return axis==='x'?[p.y,p.z]:axis==='y'?[p.x,p.z]:[p.x,p.y];
  }
  function insideProjected(verts, boundary, holes, point, axis) {
    function inside(loop) {
      var q=faceXY(point,axis),found=false;
      for(var i=0;i<loop.length;i++) {
        var j=(i+loop.length-1)%loop.length;
        var a=faceXY(verts[loop[i]],axis),b=faceXY(verts[loop[j]],axis);
        var cross=(q[0]-a[0])*(b[1]-a[1])-(q[1]-a[1])*(b[0]-a[0]);
        if(Math.abs(cross)<1e-9 && q[0]>=Math.min(a[0],b[0])-1e-9 && q[0]<=Math.max(a[0],b[0])+1e-9 && q[1]>=Math.min(a[1],b[1])-1e-9 && q[1]<=Math.max(a[1],b[1])+1e-9) return true;
        if((a[1]>q[1])!==(b[1]>q[1]) && q[0]<(b[0]-a[0])*(q[1]-a[1])/(b[1]-a[1])+a[0]) found=!found;
      }
      return found;
    }
    return inside(boundary) && !(holes || []).some(inside);
  }
  // Intersect the view ray from one edge station with every non-adjacent
  // face plane, then locate the hit in its polygon region. Triangle fans
  // would incorrectly fill concavities and holes.
  function edgeHiddenAt(verts, faces, holes, adj, a, b, dx, dy, dz, t) {
    var origin = pointOnEdge(verts, a, b, t);
    var own = adj[edgeKey(a,b)] || [];
    for (var f=0; f<faces.length; f++) {
      if (own.indexOf(f)!==-1) continue;
      var loop=faces[f], nx=0,ny=0,nz=0;
      loop.forEach(function(v,i) {
        var p=verts[v],q=verts[loop[(i+1)%loop.length]];
        nx+=(p.y-q.y)*(p.z+q.z); ny+=(p.z-q.z)*(p.x+q.x); nz+=(p.x-q.x)*(p.y+q.y);
      });
      var den=nx*dx+ny*dy+nz*dz;
      if (Math.abs(den)<1e-12) continue;
      var p=verts[loop[0]],hitT=(nx*(p.x-origin.x)+ny*(p.y-origin.y)+nz*(p.z-origin.z))/den;
      if(hitT<=HIT_EPS) continue;
      var hit={x:origin.x+hitT*dx,y:origin.y+hitT*dy,z:origin.z+hitT*dz};
      if(insideProjected(verts,loop,holes[f] || [],hit,faceAxis(nx,ny,nz))) return true;
    }
    return false;
  }
  function edgeHidden(verts, faces, holes, adj, a, b, dx, dy, dz) {
    return edgeHiddenAt(verts, faces, holes, adj, a, b, dx, dy, dz, 0.5);
  }
  function segmentHit2D(p1, p2, q1, q2) {
    var rx=p2.x-p1.x, ry=p2.y-p1.y, sx=q2.x-q1.x, sy=q2.y-q1.y;
    var den=rx*sy-ry*sx;
    if (Math.abs(den)<1e-12) return null;
    var qx=q1.x-p1.x, qy=q1.y-p1.y;
    var t=(qx*sy-qy*sx)/den, u=(qx*ry-qy*rx)/den;
    return t>=-1e-9 && t<=1+1e-9 && u>=-1e-9 && u<=1+1e-9 ? t : null;
  }
  function segmentParam2D(p, a, b) {
    var dx=b.x-a.x, dy=b.y-a.y, len=dx*dx+dy*dy;
    return len>1e-18 ? ((p.x-a.x)*dx+(p.y-a.y)*dy)/len : 0;
  }
  function onSegment2D(p, a, b) {
    var dx=b.x-a.x, dy=b.y-a.y, cross=(p.x-a.x)*dy-(p.y-a.y)*dx;
    if (Math.abs(cross)>1e-9*Math.sqrt(Math.max(1e-18,dx*dx+dy*dy))) return false;
    var t=segmentParam2D(p,a,b);
    return t>=-1e-9 && t<=1+1e-9;
  }
  // Split an edge where its visibility can change: projected face/hole
  // boundaries and the face planes themselves. Each interval is classified
  // by the same ray test, so the result is a split hidden-line stroke rather
  // than a single midpoint verdict.
  function edgeIntervals(verts, faces, holes, adj, a, b, dx, dy, dz, view, map) {
    if (!faces.length) return [{t0:0,t1:1,hidden:false}];
    var pa=sheetPoint(verts[a],view,map), pb=sheetPoint(verts[b],view,map);
    var ts=[0,1];
    function add(t) { if(t>1e-9 && t<1-1e-9) ts.push(t); }
    for (var f=0; f<faces.length; f++) {
      var loop=faces[f], nx=0,ny=0,nz=0;
      loop.forEach(function(v,i) {
        var p=verts[v],q=verts[loop[(i+1)%loop.length]];
        nx+=(p.y-q.y)*(p.z+q.z); ny+=(p.z-q.z)*(p.x+q.x); nz+=(p.x-q.x)*(p.y+q.y);
      });
      var p0=verts[loop[0]], d0=nx*(verts[a].x-p0.x)+ny*(verts[a].y-p0.y)+nz*(verts[a].z-p0.z);
      var d1=nx*(verts[b].x-p0.x)+ny*(verts[b].y-p0.y)+nz*(verts[b].z-p0.z);
      if (d0*d1<=0 && Math.abs(d0-d1)>1e-12) {
        var t=d0/(d0-d1);
        if (t>1e-9 && t<1-1e-9 &&
            insideProjected(verts,loop,holes[f] || [],pointOnEdge(verts,a,b,t),faceAxis(nx,ny,nz))) add(t);
      }
      [loop].concat(holes[f] || []).forEach(function(boundary) {
        for (var i=0; i<boundary.length; i++) {
          var q1=sheetPoint(verts[boundary[i]],view,map);
          var q2=sheetPoint(verts[boundary[(i+1)%boundary.length]],view,map);
          var hit=segmentHit2D(pa,pb,q1,q2);
          if (hit!==null) add(hit);
          if (onSegment2D(q1,pa,pb)) add(segmentParam2D(q1,pa,pb));
          if (onSegment2D(q2,pa,pb)) add(segmentParam2D(q2,pa,pb));
        }
      });
    }
    ts.sort(function(a,b) {return a-b;});
    var cuts=[];
    ts.forEach(function(t) {if(!cuts.length || t-cuts[cuts.length-1]>1e-7) cuts.push(t);});
    var out=[];
    for (var i=0;i<cuts.length-1;i++) {
      var t0=cuts[i], t1=cuts[i+1];
      if (t1-t0<1e-9) continue;
      var hidden=edgeHiddenAt(verts,faces,holes,adj,a,b,dx,dy,dz,(t0+t1)/2);
      var last=out[out.length-1];
      if (last && last.hidden===hidden && Math.abs(last.t1-t0)<1e-9) last.t1=t1;
      else out.push({t0:t0,t1:t1,hidden:hidden});
    }
    return out.length?out:[{t0:0,t1:1,hidden:edgeHiddenAt(verts,faces,holes,adj,a,b,dx,dy,dz,0.5)}];
  }

  // Exact orthographic Monge views of a solid: every edge projected
  // to sheet mm with its occlusion verdict. view 'front' is the
  // elevation (x, y) seen from +Z; view 'top' is the plan (x, -z)
  // seen from +Y. Returns [{ax, ay, bx, by, hidden, intervals}] in edge
  // order, so callers can diff rest vs posed segment by segment. `hidden`
  // keeps the midpoint verdict; `intervals` carries the visible/hidden
  // split strokes for partially occluded edges.
  function projectSolid(verts, edges, faces, view, profileMap, faceHoles) {
    faceHoles = faceHoles || [];
    checkVerts(verts);
    checkEdges(edges, verts.length);
    checkFaces(faces, verts.length);
    faceHoles.forEach(function(holes) { checkFaces(holes, verts.length); });
    if (VIEWS.indexOf(view) === -1) {
      fail('view must be front, top, left or right');
    }
    var map = profileMap || { xRef: 0, dRef: 0, s: view === 'right' ? -1 : 1 };
    assertFinite(map.xRef, map.dRef, map.s);
    if (map.s !== 1 && map.s !== -1) fail('profile direction must be 1 or -1');
    var adj = {};
    for (var g = 0; g < faces.length; g++) {
      var loops = [faces[g]].concat(faceHoles[g] || []);
      for (var li = 0; li < loops.length; li++) {
      var lp = loops[li];
      for (var h = 0; h < lp.length; h++) {
        var key = edgeKey(lp[h], lp[(h + 1) % lp.length]);
        if (!adj[key]) adj[key] = [];
        adj[key].push(g);
      }
      }
    }
    var dx = 0, dy = 0, dz = 0;
    if (view === 'front') dz = 1;
    else if (view === 'top') dy = 1;
    else dx = view === 'left' ? -1 : 1;
    var out = [];
    for (var e = 0; e < edges.length; e++) {
      var ea=edges[e][0], eb=edges[e][1];
      var pa = sheetPoint(verts[ea],view,map), pb = sheetPoint(verts[eb],view,map);
      var pieces = faces.length ? edgeIntervals(verts,faces,faceHoles,adj,ea,eb,dx,dy,dz,view,map)
        : [{t0:0,t1:1,hidden:false}];
      var hidden=false;
      pieces.forEach(function(piece) {
        if (piece.t0<=0.5+1e-9 && piece.t1>=0.5-1e-9) hidden=piece.hidden;
      });
      out.push({
        ax: pa.x, ay: pa.y, bx: pb.x, by: pb.y, hidden: hidden,
        intervals: pieces.map(function(piece) {
          var qa=sheetPoint(pointOnEdge(verts,ea,eb,piece.t0),view,map);
          var qb=sheetPoint(pointOnEdge(verts,ea,eb,piece.t1),view,map);
          return {ax:qa.x,ay:qa.y,bx:qb.x,by:qb.y,hidden:piece.hidden,t0:piece.t0,t1:piece.t1};
        })
      });
    }
    return out;
  }

  // Revolved readers use a polygon mesh for 3D display. Its internal
  // generators are sampling lines, not drafting edges. Keep the rims and
  // generators at the silhouette, for every posed orthographic direction.
  function projectGeometry(geometry, view, profileMap) {
    var out = projectSolid(geometry.vertices, geometry.edges, geometry.faces || [], view, profileMap, geometry.faceHoles);
    if (!geometry.smoothSideFaces && geometry.name !== 'cylinder' && geometry.name !== 'cone') return out;
    var direction = view === 'front' ? [0, 0, 1] : view === 'top' ? [0, 1, 0] : view === 'left' ? [-1, 0, 0] : [1, 0, 0];
    var sideSize = geometry.name === 'cylinder' ? 4 : 3;
    var sides = (geometry.faces || []).filter(function (face, i) { return geometry.smoothSideFaces ? geometry.smoothSideFaces.indexOf(i) !== -1 : face.length === sideSize; });
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

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-parametric.js'), require('./educad-vec3.js'));
  else root.EduCADCurveReconstruct = factory(root.EduCADParametric, root.EduCADVec3);
})(typeof window !== 'undefined' ? window : globalThis, function (Parametric, Vec3) {
  'use strict';

  // First primitive lifting stage: a circle/arc seen in true shape in one
  // principal view and edge-on in the other. Analytic geometry is authoritative;
  // vertices/edges below are only the display approximation. No solid names.
  var TAU = 2 * Math.PI, EPS = 1e-6, SAMPLES = 24;
  function near(a, b) { return Math.abs(a - b) <= EPS; }
  // One vector implementation for every stage in this file. Local names keep
  // the long geometry expressions readable.
  var add = Vec3.add, sub = Vec3.sub, mul = Vec3.mul, dot = Vec3.dot, cross = Vec3.cross;
  // The coaxial ruled-surface stage historically treated a zero normal as the
  // Y axis; the oblique-cone stage needs null so it can reject a degeneracy.
  function unit(v) { return Vec3.unit(v, EPS) || {x:0, y:1, z:0}; }
  function cvUnit(v) { return Vec3.unit(v, EPS); }
  function helper(e) {
    var m = e.meta || {};
    return m.reconstructionRole === 'construction' || ['axis', 'projector', 'locus'].indexOf(m.kind) !== -1;
  }
  function isCurve(e) { return e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC'; }
  function side(e) { return e.viewRole === 'PLAN' ? 'PLAN' : e.viewRole === 'ELEVATION' ? 'ELEVATION' : null; }
  function angle(a) { return ((a % TAU) + TAU) % TAU; }
  function curveSpan(e) {
    var start = angle(e.startAngle * Math.PI / 180), sweep = e.type === 'CIRCLE' ? TAU : angle((e.endAngle - e.startAngle) * Math.PI / 180);
    if (e.type === 'CIRCLE') start = 0;
    var angles = [start, start + sweep];
    [0, Math.PI].forEach(function (a) { if (angle(a - start) <= sweep + EPS) angles.push(a); });
    var xs = angles.map(function (a) { return e.x + e.radius * Math.cos(a); });
    return { start: start, sweep: sweep, min: Math.min.apply(null, xs), max: Math.max.apply(null, xs) };
  }
  function radii(curve) {
    var a = curve.radiusU === undefined ? curve.radius : curve.radiusU;
    var b = curve.radiusV === undefined ? curve.radius : curve.radiusV;
    return { u: a, v: b };
  }
  function point(curve, a) {
    if(curve.kind==='nurbs')return Parametric.point(curve,a);
    return Parametric.point(curve,(a-(curve.startAngle||0))/(curve.sweepAngle===undefined?TAU:curve.sweepAngle));
  }
  function reconstructPair(entities) {
    var ink = entities.filter(function (e) { return e && !helper(e); });
    var sourceCurves = ink.filter(isCurve), segments = ink.filter(function (e) { return e.type === 'SEGMENT'; });
    var byId = new Map(ink.map(function (e) { return [e.id, e]; }));
    var curves = [], issues = [], used = new Set(), vertices = [], edges = [], faces = [], patches = [], smooth = [];
    function issue(code, e, message) { issues.push({ code: code, entityId: e.id, message: message }); }
    // Union touching/overlapping edge-on strokes, keeping their evidence IDs.
    function horizontalRuns(role) {
      var rows = [];
      segments.forEach(function (s) {
        if (side(s) !== role || !near(s.y, s.y2) || near(s.x, s.x2)) return;
        var row = rows.find(function (r) { return near(r.y, s.y); });
        if (!row) { row = { y: s.y, intervals: [] }; rows.push(row); }
        row.intervals.push({ min: Math.min(s.x,s.x2), max: Math.max(s.x,s.x2), ids: [s.id] });
      });
      var runs = [];
      rows.forEach(function (row) {
        row.intervals.sort(function (a,b) { return a.min-b.min || a.max-b.max; });
        var merged = [];
        row.intervals.forEach(function (i) {
          var last = merged[merged.length-1];
          if (last && i.min <= last.max + EPS) { last.max = Math.max(last.max,i.max); last.ids = last.ids.concat(i.ids); }
          else merged.push({min:i.min,max:i.max,ids:i.ids.slice()});
        });
        merged.forEach(function (r) { r.y = row.y; runs.push(r); });
      });
      return runs;
    }
    // Slanted edge-on traces are the projection of a circle whose plane is
    // inclined to the projection plane. They are distinct from the horizontal
    // traces of planes parallel to the projection plane.
    function slantedRuns(role) {
      var rows = [];
      function sameLine(m1,b1,m2,b2) {
        return Math.abs(m1-m2) <= 1e-6*(1+Math.abs(m1)) &&
          Math.abs(b1-b2) <= 1e-5*(1+Math.abs(b1));
      }
      segments.forEach(function (s) {
        if (side(s) !== role || near(s.y, s.y2) || near(s.x, s.x2)) return;
        var m = (s.y2-s.y)/(s.x2-s.x), b = s.y - m*s.x;
        var row = rows.find(function (r) { return sameLine(r.m,r.b,m,b); });
        if (!row) { row = { m:m, b:b, intervals: [] }; rows.push(row); }
        row.intervals.push({ min: Math.min(s.x,s.x2), max: Math.max(s.x,s.x2), ids: [s.id] });
      });
      var runs = [];
      rows.forEach(function (row) {
        row.intervals.sort(function (a,b) { return a.min-b.min || a.max-b.max; });
        var merged = [];
        row.intervals.forEach(function (i) {
          var last = merged[merged.length-1];
          if (last && i.min <= last.max + EPS) { last.max = Math.max(last.max,i.max); last.ids = last.ids.concat(i.ids); }
          else merged.push({min:i.min,max:i.max,ids:i.ids.slice()});
        });
        merged.forEach(function (r) { r.m = row.m; r.b = row.b; runs.push(r); });
      });
      return runs;
    }
    var runs = { PLAN: horizontalRuns('PLAN'), ELEVATION: horizontalRuns('ELEVATION') };
    var slants = { PLAN: slantedRuns('PLAN'), ELEVATION: slantedRuns('ELEVATION') };
    sourceCurves.forEach(function (e) {
      var view = side(e), span = curveSpan(e);
      if (!view) { issue('curve-view-unsupported', e, 'This curve needs a true-shape principal view with an edge-on projection in a paired view.'); return; }
      if (!(span.sweep > EPS)) { issue('curve-degenerate', e, 'The arc has no angular extent.'); return; }
      var other = view === 'PLAN' ? 'ELEVATION' : 'PLAN';
      var matches = runs[other].filter(function (r) { return near(r.min,span.min) && near(r.max,span.max); });
      if (!matches.length) {
        var covering = runs[other].filter(function(r) {return r.min <= span.min+EPS && r.max >= span.max-EPS;});
        if (covering.length === 1) matches = covering;
      }
      // A linked centre constrains the missing coordinate when present.
      var center = byId.get(e.meta && e.meta.centerRef);
      if (center) {
        var members = ((center.meta || {}).members || []).map(function (m) { return m.id; });
        var mates = ink.filter(function (p) {
          return p.type === 'POINT' && side(p) === other && ((p.meta || {}).members || []).some(function (m) { return members.indexOf(m.id) !== -1; });
        });
        if (mates.length) matches = matches.filter(function (r) { return mates.every(function (p) { return near(p.x,e.x) && near(p.y,r.y); }); });
      }
      matches.forEach(function (r) {
        var c = { kind: e.type === 'CIRCLE' ? 'circle' : 'circular-arc',
          center: {x:e.x,y:view === 'PLAN' ? r.y : e.y,z:view === 'PLAN' ? -e.y : -r.y},
          u: {x:1,y:0,z:0}, v: view === 'PLAN' ? {x:0,y:0,z:-1} : {x:0,y:1,z:0},
          radius:e.radius, startAngle:span.start, sweepAngle:span.sweep,
          sourceIds:[e.id].concat(near(r.min,span.min) && near(r.max,span.max) ? r.ids : []), sourceView:view, edgeOnCoordinate:r.y,
          displayVertices:[], displayEdges:[] };
        var duplicate = curves.find(function (d) { return d.kind === c.kind && d.sourceView === c.sourceView &&
          near(d.center.x,c.center.x) && near(d.center.y,c.center.y) && near(d.center.z,c.center.z) &&
          near(d.radius,c.radius) && near(d.startAngle,c.startAngle) && near(d.sweepAngle,c.sweepAngle); });
        if (duplicate) duplicate.sourceIds = Array.from(new Set(duplicate.sourceIds.concat(c.sourceIds)));
        else curves.push(c);
        c.sourceIds.forEach(function (id) { used.add(id); });
      });
      // A full circle plus a slanted trace in the paired view describes one
      // elliptical boundary in an inclined plane. The trace's x extent is the
      // circle diameter; its slope fixes the plane through the missing axis.
      if (e.type === 'CIRCLE') slants[other].forEach(function (r) {
        if (!near(r.min,span.min) || !near(r.max,span.max)) return;
        var m = r.m, b = r.b, len = Math.hypot(1,m), c;
        if (view === 'PLAN') c = { kind:'ellipse', center:{x:e.x,y:m*e.x+b,z:-e.y},
          u:{x:1/len,y:m/len,z:0}, v:{x:0,y:0,z:-1}, radiusU:e.radius*len, radiusV:e.radius, radius:e.radius,
          startAngle:span.start, sweepAngle:span.sweep };
        else c = { kind:'ellipse', center:{x:e.x,y:e.y,z:-(m*e.x+b)},
          u:{x:1/len,y:0,z:-m/len}, v:{x:0,y:1,z:0}, radiusU:e.radius*len, radiusV:e.radius, radius:e.radius,
          startAngle:span.start, sweepAngle:span.sweep };
        c.sourceIds = [e.id].concat(r.ids);
        c.sourceView = view;
        c.displayVertices = [];
        c.displayEdges = [];
        // Coordinate of the trace at the centre station in the paired view.
        c.edgeOnCoordinate = m*e.x+b;
        c.inclinedTrace = { m:m, b:b, view:other, ids:r.ids.slice() };
        var duplicate = curves.find(function (d) { return d.kind === c.kind && d.sourceView === c.sourceView &&
          near(d.center.x,c.center.x) && near(d.center.y,c.center.y) && near(d.center.z,c.center.z) &&
          near(radii(d).u,radii(c).u) && near(radii(d).v,radii(c).v) &&
          near(d.u.x,c.u.x) && near(d.u.y,c.u.y) && near(d.u.z,c.u.z) &&
          near(d.startAngle,c.startAngle) && near(d.sweepAngle,c.sweepAngle); });
        if (duplicate) duplicate.sourceIds = Array.from(new Set(duplicate.sourceIds.concat(c.sourceIds)));
        else curves.push(c);
        c.sourceIds.forEach(function (id) { used.add(id); });
      });
      var inclined = curves.filter(function(c) {return c.inclinedTrace && c.sourceIds.indexOf(e.id)!==-1;});
      if (inclined.length > 1) issue('curve-projection-ambiguous', e,
        'Several inclined traces fit this circle; the cut level is unresolved.');
      if (!inclined.length && e.type === 'CIRCLE') {
        var contained = slants[other].filter(function(r) {
          var mid = (r.min + r.max) / 2;
          return r.min >= span.min-EPS && r.max <= span.max+EPS &&
            Math.abs(mid - e.x) <= 0.25*e.radius &&
            !(near(r.min,span.min) && near(r.max,span.max));
        });
        if (contained.length) issue('curve-inclined-arc-unsupported', e,
          'An inclined trace covers only part of this circle; inclined arcs are not reconstructed yet.');
      }
      if (!matches.length && !inclined.length)
        issue('curve-projection-missing', e, 'Needs a matching edge-on projection with the same horizontal extent in the other view.');
    });
    curves.forEach(function (c) {
      var n = Math.max(2, Math.ceil(SAMPLES*c.sweepAngle/TAU)), closed = c.kind === 'circle' || c.kind === 'ellipse';
      for (var i=0;i<(closed?n:n+1);i++) { c.displayVertices.push(vertices.length); vertices.push(point(c,c.startAngle+c.sweepAngle*i/n)); }
      for (var j=0;j<n;j++) { c.displayEdges.push(edges.length); edges.push([c.displayVertices[j],c.displayVertices[(j+1)%c.displayVertices.length]]); }
    });
    function lineEvidence(view, x1,y1,x2,y2) {
      // Accept split and overlapping straight evidence along the same segment.
      var dx=x2-x1,dy=y2-y1,length=Math.hypot(dx,dy), candidates=[];
      if(length<EPS) return [];
      segments.forEach(function(s) {
        if(side(s)!==view) return;
        var a=((s.x-x1)*dx+(s.y-y1)*dy)/(length*length), b=((s.x2-x1)*dx+(s.y2-y1)*dy)/(length*length);
        if(Math.abs((s.x-x1)*dy-(s.y-y1)*dx)/length>EPS || Math.abs((s.x2-x1)*dy-(s.y2-y1)*dx)/length>EPS) return;
        // Do not claim a longer stroke was fully explained by a shorter edge.
        if(Math.min(a,b)<-EPS || Math.max(a,b)>1+EPS) return;
        candidates.push({a:Math.min(a,b),b:Math.max(a,b),id:s.id});
      });
      candidates.sort(function(a,b) {return a.a-b.a;});
      var reach=0,ids=[];
      for(var i=0;i<candidates.length;i++) {
        if(candidates[i].a>reach+EPS) return [];
        reach=Math.max(reach,candidates[i].b);ids.push(candidates[i].id);
      }
      return reach>=1-EPS?ids:[];
    }
    function axial(c) { return c.sourceView === 'PLAN' ? c.center.y : c.center.z; }
    function curveNormal(c) {return unit(cross(c.u,c.v));}
    // The two silhouette generators of a surface join the same angular station
    // on its boundaries. This also gives the cap orientation axis.
    function generatorPoint(c, positive) {
      var p=point(c,positive?c.startAngle:c.startAngle+Math.PI);
      return c.sourceView==='PLAN'?{x:p.x,y:p.y}:{x:p.x,y:-p.z};
    }
    var bound = new Set();
    // A straight generator at each silhouette bounds a ruled patch between
    // coaxial boundaries. A true-shape circle and an inclined ellipse use the
    // same operation: their generators meet at matching angular stations.
    var circular = curves.filter(function(c) {return c.kind==='circle'||c.kind==='ellipse';});
    circular.sort(function(a,b) {return axial(a)-axial(b);});
    circular.forEach(function(a,ai) {
      var candidates = circular.slice(ai+1).filter(function(b) {
        return b.sourceView===a.sourceView && near(a.center.x,b.center.x) &&
          (a.sourceView==='PLAN'?near(a.center.z,b.center.z):near(a.center.y,b.center.y)) && axial(b)>axial(a)+EPS;
      });
      if(!candidates.length) return;
      var b=candidates[0], view=a.sourceView==='PLAN'?'ELEVATION':'PLAN';
      var aL=generatorPoint(a,false), aR=generatorPoint(a,true);
      var bL=generatorPoint(b,false), bR=generatorPoint(b,true);
      var left=lineEvidence(view,aL.x,aL.y,bL.x,bL.y);
      var right=lineEvidence(view,aR.x,aR.y,bR.x,bR.y);
      if(!left.length || !right.length) return;
      left.concat(right).forEach(function(id) {used.add(id);});
      var indices=[];
      for(var i=0;i<a.displayVertices.length;i++) {
        var j=(i+1)%a.displayVertices.length;
        edges.push([a.displayVertices[i],b.displayVertices[i]]);
        indices.push(faces.length);smooth.push(faces.length);
        faces.push([a.displayVertices[i],a.displayVertices[j],b.displayVertices[j],b.displayVertices[i]]);
      }
      var axis=unit(sub(b.center,a.center));
      var sameRadius=near(a.radius,b.radius);
      patches.push({kind:sameRadius?'cylinder':'cone',analyticKind:sameRadius?'cylinder':'cone',
        origin:a.center,axis:axis,radius:a.radius,
        halfAngle:sameRadius?0:Math.atan2(Math.abs(a.radius-b.radius),Math.hypot(sub(b.center,a.center).x,sub(b.center,a.center).y,sub(b.center,a.center).z)),
        boundaryCurves:[curves.indexOf(a),curves.indexOf(b)],faceIndices:indices,sourceIds:left.concat(right)});
      bound.add(a);bound.add(b);
    });
    // A collapsed circular boundary is a point. This is the same ruled-surface
    // construction, with its position constrained by two meeting generators.
    circular.forEach(function(c) {
      if(bound.has(c)) return;
      var view=c.sourceView==='PLAN'?'ELEVATION':'PLAN', apexCandidates=[];
      segments.forEach(function(s) {
        if(side(s)!==view) return;
        [[s.x,s.y],[s.x2,s.y2]].forEach(function(p) {
          if(near(p[0],c.center.x) && !near(p[1],c.edgeOnCoordinate) && !apexCandidates.some(function(q) {return near(q[1],p[1]);})) apexCandidates.push(p);
        });
      });
      var supported=apexCandidates.map(function(p) {
        return {p:p, left:lineEvidence(view,c.center.x-c.radius,c.edgeOnCoordinate,p[0],p[1]),right:lineEvidence(view,c.center.x+c.radius,c.edgeOnCoordinate,p[0],p[1])};
      }).filter(function(a) {return a.left.length && a.right.length;});
      if(supported.length>1) { issue('curve-surface-ambiguous',{id:c.sourceIds[0]},'Several apex positions fit this boundary; the connecting surface is unresolved.');return; }
      if(!supported.length) return;
      var a=supported[0],apex=c.sourceView==='PLAN'?{x:c.center.x,y:a.p[1],z:c.center.z}:{x:c.center.x,y:c.center.y,z:-a.p[1]};
      var index=vertices.length;vertices.push(apex);
      var positive=(c.sourceView==='PLAN'?apex.y:apex.z)>axial(c),indices=[];
      for(var i=0;i<c.displayVertices.length;i++) {
        var j=(i+1)%c.displayVertices.length, loop=[c.displayVertices[i],c.displayVertices[j],index];
        if(!positive) loop.reverse();
        edges.push([c.displayVertices[i],index]);indices.push(faces.length);smooth.push(faces.length);faces.push(loop);
      }
      var apexAxis=unit(sub(apex,c.center));
      patches.push({kind:'cone',analyticKind:'cone',axis:apexAxis,origin:c.center,radius:c.radius,
        halfAngle:Math.atan2(c.radius,Math.hypot(sub(apex,c.center).x,sub(apex,c.center).y,sub(apex,c.center).z)),
        boundaryCurves:[curves.indexOf(c)],apex:apex,faceIndices:indices,sourceIds:a.left.concat(a.right)});
      c.apexDirection=positive?1:-1;bound.add(c);
      a.left.concat(a.right).forEach(function(id) {used.add(id);});
    });
    // An inclined boundary without a connecting side surface leaves the
    // cylinder/cut interpretation incomplete; report it instead of showing
    // two unrelated end disks as a finished object.
    curves.forEach(function(c) {
      if (c.inclinedTrace && !bound.has(c)) issue('curve-surface-missing', {id:c.sourceIds[0]},
        'An inclined boundary has no supporting generators; the connecting surface is unresolved.');
    });
    // End disks are inferred planar patches. Internal rings shared by two
    // side patches do not get an artificial interior cap.
    circular.forEach(function(c) {
      var ci=curves.indexOf(c),incident=patches.filter(function(p) {return p.boundaryCurves && p.boundaryCurves.indexOf(ci)!==-1 && p.kind!=='plane';});
      if(incident.length>1) return;
      var loop=c.displayVertices.slice(),indices=[];
      if(incident.length) {
        var patch=incident[0];
        if(patch.axis) {
          var outward=dot(sub(c.center,patch.origin),patch.axis)>EPS?1:-1;
          if(dot(cross(c.u,c.v),patch.axis)*outward<0) loop.reverse();
        } else {
          var other=patch.boundaryCurves.filter(function(i) {return i!==ci;})[0];
          if(c.apexDirection===1 || other!==undefined && axial(curves[other])>axial(c)) loop.reverse();
        }
        indices.push(faces.length);faces.push(loop);
      } else { indices.push(faces.length);faces.push(loop);indices.push(faces.length);faces.push(loop.slice().reverse()); }
      patches.push({kind:'plane',boundaryCurves:[ci],faceIndices:indices,sourceIds:c.sourceIds.slice()});
    });
    var unresolved = sourceCurves.concat(segments).filter(function(e) {return !used.has(e.id);});
    unresolved.forEach(function(e) {
      if(!isCurve(e)) issue('unresolved-edge',e,'This stroke is not yet explained by the reconstructed curved boundaries and surfaces.');
    });
    return { geometry: vertices.length ? {name:'primitive surface',vertices:vertices,edges:edges,faces:faces,
      curves:curves,surfacePatches:patches,smoothSideFaces:smooth,topologyStatus:issues.length?'partial':'inferred'} : null,
      issues:issues, consumedIds:Array.from(used), unresolvedIds:unresolved.map(function(e) {return e.id;}) };
  }
  function viewOf(e) {
    if (e.viewRole==='PLAN' || e.viewRole==='ELEVATION' || e.viewRole==='PROFILE') return e.viewRole;
    if (!e.viewRole || e.viewRole==='BOTH') return e.y>0?'ELEVATION':e.y<0?'PLAN':null;
    return null;
  }
  function extentOf(list, role) {
    var xs=[], zs=[];
    list.forEach(function(e) {
      if (!e || e.type==='DATUM_AXIS' || e.type==='TEXT' || e.type==='DIMENSION') return;
      if (e.meta && ['axis','locus','projector'].indexOf(e.meta.kind)!==-1) return;
      if (viewOf(e)!==role) return;
      if (isCurve(e)) {
        var span=curveSpan(e), angles=[span.start,span.start+span.sweep];
        [0,Math.PI/2,Math.PI,3*Math.PI/2].forEach(function(t) {
          if(angle(t-span.start)<=span.sweep+EPS) angles.push(t);
        });
        angles.forEach(function(t) {
          xs.push(e.x+e.radius*Math.cos(t));
          if(role==='PLAN') zs.push(-e.y-e.radius*Math.sin(t));
        });
        return;
      }
      xs.push(e.x);
      if (e.type==='SEGMENT' || e.type==='LINE' || e.type==='RAY') xs.push(e.x2);
      if (e.radius) xs.push(e.x-e.radius,e.x+e.radius);
      if (role==='PLAN') {
        zs.push(-e.y);
        if (e.type==='SEGMENT' || e.type==='LINE' || e.type==='RAY') zs.push(-e.y2);
      }
    });
    return {xs:xs,zs:zs};
  }
  // Mirrors the drafting layout convention when no /profile or stored
  // meta.draftingLayout exists. An explicit frame always wins.
  function inferProfileFrame(list) {
    var pb=extentOf(list,'PROFILE'), eb=extentOf(list,'ELEVATION'), plan=extentOf(list,'PLAN');
    if (!pb.xs.length) return null;
    function mid(a) {return (Math.min.apply(null,a)+Math.max.apply(null,a))/2;}
    var s=!eb.xs.length || mid(pb.xs)>mid(eb.xs) ? 1 : -1;
    var ref=list.find(function(e) {
      return e.caption==='ref-X1Y1' || (e.meta && e.meta.kind==='axis' && Math.abs(e.x-e.x2)<EPS &&
        e.x>=Math.min.apply(null,pb.xs)-EPS && e.x<=Math.max.apply(null,pb.xs)+EPS);
    });
    return {three:true, side:s===1?'left':'right',
      xRef:ref?ref.x:(s===1?Math.min.apply(null,pb.xs):Math.max.apply(null,pb.xs)),
      dRef:plan.zs.length?Math.min.apply(null,plan.zs):0, s:s, inferred:true};
  }
  function circleCenter(e, profile) {
    var role=viewOf(e);
    if (role==='PLAN') return {x:e.x,z:-e.y};
    if (role==='ELEVATION') return {x:e.x,y:e.y};
    if (role==='PROFILE' && profile) return {z:profile.dRef+profile.s*(e.x-profile.xRef),y:e.y};
    return null;
  }
  function sphereCompatible(e, center, profile) {
    var p=circleCenter(e,profile);
    if (!p) return false;
    return Object.keys(p).every(function(k) {return near(p[k],center[k]);});
  }
  // Equal full circles in two or more views are sphere silhouettes. This is a
  // surface family, not a solid-name declaration: the shared radius and the
  // projected centre fix the three centre coordinates.
  function inferSpheres(list, profile) {
    var circles=list.filter(function(e) {return e.type==='CIRCLE' && !helper(e);}), out=[];
    for (var i=0;i<circles.length;i++) {
      for (var j=i+1;j<circles.length;j++) {
        var a=circles[i], b=circles[j];
        if (viewOf(a)===viewOf(b) || !near(a.radius,b.radius)) continue;
        var ca=circleCenter(a,profile), cb=circleCenter(b,profile);
        if (!ca || !cb) continue;
        var center={}, okay=true;
        [ca,cb].forEach(function(p) {
          Object.keys(p).forEach(function(k) {
            if (center[k]!==undefined && !near(center[k],p[k])) okay=false;
            else center[k]=p[k];
          });
        });
        if (!okay || center.x===undefined || center.y===undefined || center.z===undefined) continue;
        var sources=circles.filter(function(c) {return near(c.radius,a.radius) && sphereCompatible(c,center,profile);});
        var views=new Set(sources.map(viewOf));
        if (sources.length<2 || views.size<2) continue;
        var duplicate=out.find(function(s) {return near(s.radius,a.radius) &&
          near(s.center.x,center.x) && near(s.center.y,center.y) && near(s.center.z,center.z);});
        if (duplicate) duplicate.sourceIds=Array.from(new Set(duplicate.sourceIds.concat(sources.map(function(c) {return c.id;}))));
        else out.push({center:{x:center.x,y:center.y,z:center.z},radius:a.radius,sourceIds:sources.map(function(c) {return c.id;})});
      }
    }
    return out;
  }
  function sphereMesh(center, radius) {
    var lat=8, lon=12, vertices=[], faces=[], edges=[], seen={};
    vertices.push({x:center.x,y:center.y+radius,z:center.z});
    for (var i=1;i<lat;i++) {
      var phi=Math.PI*i/lat;
      for (var j=0;j<lon;j++) {
        var theta=2*Math.PI*j/lon;
        vertices.push({x:center.x+radius*Math.sin(phi)*Math.cos(theta),
          y:center.y+radius*Math.cos(phi),z:center.z+radius*Math.sin(phi)*Math.sin(theta)});
      }
    }
    var bottom=vertices.length;
    vertices.push({x:center.x,y:center.y-radius,z:center.z});
    function ring(i,j) {return 1+(i-1)*lon+(j%lon);}
    function tri(a,b,c) {
      var pa=vertices[a],pb=vertices[b],pc=vertices[c];
      var ux=pb.x-pa.x,uy=pb.y-pa.y,uz=pb.z-pa.z,vx=pc.x-pa.x,vy=pc.y-pa.y,vz=pc.z-pa.z;
      var nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      var mx=(pa.x+pb.x+pc.x)/3-center.x,my=(pa.y+pb.y+pc.y)/3-center.y,mz=(pa.z+pb.z+pc.z)/3-center.z;
      if (nx*mx+ny*my+nz*mz<0) {var swap=b;b=c;c=swap;}
      faces.push([a,b,c]);
      [[a,b],[b,c],[c,a]].forEach(function(e) {
        var k=e[0]<e[1]?e[0]+'_'+e[1]:e[1]+'_'+e[0];
        if (!seen[k]) {seen[k]=true;edges.push([e[0],e[1]]);}
      });
    }
    for (var j=0;j<lon;j++) tri(0,ring(1,j),ring(1,j+1));
    for (var i=1;i<lat-1;i++) for (var j2=0;j2<lon;j2++) {
      var a=ring(i,j2), b=ring(i,j2+1), c=ring(i+1,j2), d=ring(i+1,j2+1);
      tri(a,b,c); tri(b,d,c);
    }
    for (var j3=0;j3<lon;j3++) tri(bottom,ring(lat-1,j3+1),ring(lat-1,j3));
    return {vertices:vertices,edges:edges,faces:faces};
  }
  // --- Spherical recess inference -----------------------------------------
  // A full circular mouth in one principal view plus a circular-arc
  // silhouette in the other view determine a sphere: the mouth circle fixes
  // the axis and mouth radius, the silhouette fixes the sphere centre/radius,
  // and the two must satisfy R^2 = a^2 + offset^2. This is a bounded curved
  // recess, not a solid/feature-name reader. Only PLAN/ELEVATION pairs are
  // used; PROFILE-mouth recesses remain unsupported.
  function principalFrame(role) {
    if(role==='PLAN') return {role:'PLAN',free:'y',u:{x:1,y:0,z:0},v:{x:0,y:0,z:-1},
      normal:{x:0,y:1,z:0},
      to3D:function(u,v,free) {return {x:u,y:free,z:-v};},
      project:function(p) {return {x:p.x,y:-p.z};}};
    if(role==='ELEVATION') return {role:'ELEVATION',free:'z',u:{x:1,y:0,z:0},v:{x:0,y:1,z:0},
      normal:{x:0,y:0,z:1},
      to3D:function(u,v,free) {return {x:u,y:v,z:free};},
      project:function(p) {return {x:p.x,y:p.y};}};
    return null;
  }
  function sheetArcSpan(e) {
    if(e.type==='CIRCLE') return {start:0,sweep:TAU};
    var start=e.startAngle*Math.PI/180;
    var sweep=((e.endAngle-e.startAngle)%360+360)%360*Math.PI/180;
    return {start:start,sweep:sweep};
  }
  function arcHasAngle(a,start,sweep,tol) {
    var off=((a-start)%TAU+TAU)%TAU;
    return off<=sweep+tol || off>=TAU-tol;
  }
  // A recess is closed only when the drawing supplies the edge-on mouth
  // stroke. Exact/contained strokes are consumed; a longer face edge is
  // treated as corroboration but is left for the straight-wire stage.
  function mouthLineEvidence(ink,W,p1,p2,used) {
    var dx=p2.x-p1.x,dy=p2.y-p1.y,len2=dx*dx+dy*dy;
    if(len2<EPS*EPS) return {found:false,ids:[]};
    var lineTol=1e-5*Math.max(1,Math.sqrt(len2)),ids=[],found=false;
    ink.forEach(function(s) {
      if(!s || s.type!=='SEGMENT' || used.has(s.id) || viewOf(s)!==W.role) return;
      if(Math.abs((s.x-p1.x)*dy-(s.y-p1.y)*dx)>lineTol*Math.sqrt(len2) ||
         Math.abs((s.x2-p1.x)*dy-(s.y2-p1.y)*dx)>lineTol*Math.sqrt(len2)) return;
      var t1=((s.x-p1.x)*dx+(s.y-p1.y)*dy)/len2;
      var t2=((s.x2-p1.x)*dx+(s.y2-p1.y)*dy)/len2;
      var a=Math.min(t1,t2),b=Math.max(t1,t2);
      if(a>1e-4 || b<1-1e-4) return;
      found=true;
      if(a>=-1e-4 && b<=1+1e-4) ids.push(s.id);
    });
    return {found:found,ids:ids};
  }
  function recessCandidate(C,V,A,W,ink,used) {
    var a=C.radius,R=A.radius;
    if(!(a>EPS) || !(R>EPS) || V.role===W.role) return null;
    var tol=1e-4*Math.max(1,a,R);
    var C0=V.to3D(C.x,C.y,0),O=W.to3D(A.x,A.y,0);
    O[W.free]=C0[W.free];
    var op=V.project(O);
    // Not even on the mouth axis: this is an unrelated circle/arc pair.
    if(Math.abs(op.x-C.x)>tol || Math.abs(op.y-C.y)>tol) return null;
    var span=sheetArcSpan(A);
    if(!(span.sweep>EPS)) return null;
    function at(t) {return {x:A.x+R*Math.cos(t),y:A.y+R*Math.sin(t)};}
    var q1=at(span.start),q2=at(span.start+span.sweep);
    var E1=W.to3D(q1.x,q1.y,O[W.free]),E2=W.to3D(q2.x,q2.y,O[W.free]);
    var mf1=E1[V.free],mf2=E2[V.free];
    // An arc whose ends are not on one mouth plane is not a rim-to-rim cap
    // silhouette; leave it to the ordinary curve stage instead of claiming a
    // recess conflict.
    if(Math.abs(mf1-mf2)>tol) return null;
    var mouthFree=(mf1+mf2)/2,M=V.to3D(C.x,C.y,mouthFree);
    var mid=at(span.start+span.sweep/2);
    var Pmid=W.to3D(mid.x,mid.y,O[W.free]);
    var side=dot(sub(Pmid,M),V.normal);
    if(Math.abs(side)<=tol) return null;
    var outward=mul(V.normal,side<0?1:-1),pole=mul(outward,-1);
    for(var k=1;k<8;k++) {
      var p=at(span.start+span.sweep*k/8),P=W.to3D(p.x,p.y,O[W.free]);
      if(dot(sub(P,M),outward)>tol) return null;
    }
    var poleAngle=Math.atan2(dot(pole,W.v),dot(pole,W.u));
    if(!arcHasAngle(poleAngle,span.start,span.sweep,1e-5)) return null;
    // The rim pair must straddle the mouth centre before a radius/endpoint
    // mismatch is worth reporting as a recess conflict.
    if(Vec3.length(add(sub(E1,M),sub(E2,M)))>Math.max(tol,0.25*a)) return null;
    if(Math.abs(Vec3.length(sub(E1,M))-a)>tol || Math.abs(Vec3.length(sub(E2,M))-a)>tol)
      return {conflict:'The silhouette arc endpoints do not meet the mouth circle.'};
    var q=sub(O,M),offset=dot(q,V.normal);
    if(Math.abs(Math.hypot(a,offset)-R)>tol)
      return {conflict:'The silhouette radius does not satisfy R^2 = mouthRadius^2 + offset^2.'};
    var cosAngle=dot(q,outward)/R;
    if(cosAngle<-1-tol/R || cosAngle>1+tol/R)
      return {conflict:'The sphere centre is not consistent with the mouth circle.'};
    var capAngle=Math.acos(Math.max(-1,Math.min(1,cosAngle)));
    if(!(capAngle>1e-4) || !(capAngle<Math.PI-1e-4))
      return {conflict:'The recess cap is degenerate.'};
    var depth=R-dot(q,outward);
    if(!(depth>tol)) return {conflict:'The recess depth is not positive.'};
    var u=V.u,v=V.v;
    if(dot(cross(u,v),outward)<0) v=mul(v,-1);
    return {circle:C,arc:A,view:V,otherView:W,center:O,radius:R,mouthCenter:M,
      mouthRadius:a,outward:outward,pole:pole,capAngle:capAngle,depth:depth,u:u,v:v,
      closure:mouthLineEvidence(ink,W,W.project(E1),W.project(E2),used)};
  }
  function sphereCapMesh(O,R,pole,thetaMax,halfU,halfV,lon) {
    var vertices=[],faces=[],edges=[],edgeMap=new Map();
    var poleIndex=vertices.length;
    vertices.push(add(O,mul(pole,R)));
    var rings=Math.max(2,Math.ceil(6*thetaMax/Math.PI));
    var ringIndices=[];
    for(var i=1;i<=rings;i++) {
      var theta=thetaMax*i/rings,ring=[];
      for(var j=0;j<lon;j++) {
        var t=TAU*j/lon;
        var radial=add(mul(halfU,Math.cos(t)),mul(halfV,Math.sin(t)));
        var p=add(add(O,mul(pole,R*Math.cos(theta))),mul(radial,R*Math.sin(theta)));
        ring.push(vertices.length);vertices.push(p);
      }
      ringIndices.push(ring);
    }
    function face(a,b,c) {
      var pa=vertices[a],pb=vertices[b],pc=vertices[c];
      var n=cross(sub(pb,pa),sub(pc,pa));
      var centroid=mul(add(add(pa,pb),pc),1/3);
      // A recess is viewed from inside its bowl: orient the display mesh
      // toward the sphere centre, unlike the outward full-sphere mesh.
      if(dot(n,sub(centroid,O))>0) {var swap=b;b=c;c=swap;}
      faces.push([a,b,c]);
    }
    var first=ringIndices[0];
    for(var f=0;f<lon;f++) face(poleIndex,first[f],first[(f+1)%lon]);
    for(var r=0;r<rings-1;r++) {
      var A=ringIndices[r],B=ringIndices[r+1];
      for(var c2=0;c2<lon;c2++) {
        var a=A[c2],b=A[(c2+1)%lon],c=B[c2],d=B[(c2+1)%lon];
        face(a,b,c);face(b,d,c);
      }
    }
    faces.forEach(function(f) {
      for(var k=0;k<3;k++) {
        var a=f[k],b=f[(k+1)%3],key=a<b?a+'_'+b:b+'_'+a;
        if(!edgeMap.has(key)) {edgeMap.set(key,edges.length);edges.push([a,b]);}
      }
    });
    var boundary=ringIndices[rings-1],boundaryEdges=[];
    for(var e=0;e<lon;e++) {
      var a2=boundary[e],b2=boundary[(e+1)%lon],key2=a2<b2?a2+'_'+b2:b2+'_'+a2;
      boundaryEdges.push(edgeMap.get(key2));
    }
    return {vertices:vertices,faces:faces,edges:edges,boundaryVertices:boundary,
      boundaryEdges:boundaryEdges};
  }
  function addSphericalRecess(geometry,cand,sourceIds,closureIds,closed) {
    var mesh=sphereCapMesh(cand.center,cand.radius,cand.pole,cand.capAngle,cand.u,cand.v,SAMPLES);
    var vo=geometry.vertices.length,eo=geometry.edges.length,fo=geometry.faces.length;
    geometry.vertices=geometry.vertices.concat(mesh.vertices);
    geometry.edges=geometry.edges.concat(mesh.edges.map(function(e) {return [e[0]+vo,e[1]+vo];}));
    geometry.faces=geometry.faces.concat(mesh.faces.map(function(f) {return f.map(function(v) {return v+vo;});}));
    var faceIndices=mesh.faces.map(function(_,i) {return i+fo;});
    geometry.smoothSideFaces=geometry.smoothSideFaces.concat(faceIndices);
    var ci=geometry.curves.length;
    var curve={kind:'circle',center:cand.mouthCenter,u:cand.u,v:cand.v,radius:cand.mouthRadius,
      startAngle:0,sweepAngle:TAU,sourceIds:[cand.circle.id].concat(closureIds),
      sourceView:cand.view.role,recessMouth:true,
      displayVertices:mesh.boundaryVertices.map(function(v) {return v+vo;}),
      displayEdges:mesh.boundaryEdges.map(function(e) {return e+eo;})};
    geometry.curves.push(curve);
    var sphereIndex=geometry.surfacePatches.length;
    geometry.surfacePatches.push({kind:'sphere',center:cand.center,radius:cand.radius,
      boundaryCurves:[ci],cap:{pole:cand.pole,angle:cand.capAngle,
        mouth:{origin:cand.mouthCenter,normal:cand.outward}},
      faceIndices:faceIndices,sourceIds:sourceIds.slice(),recess:true});
    if(closed) geometry.surfacePatches.push({kind:'plane',boundaryCurves:[ci],faceIndices:[],
      closure:'recess-mouth',recessMouth:true,
      sourceIds:[cand.circle.id].concat(closureIds)});
    if(!geometry.recesses) geometry.recesses=[];
    geometry.recesses.push({kind:'spherical',center:cand.center,radius:cand.radius,
      mouth:{center:cand.mouthCenter,normal:cand.outward,radius:cand.mouthRadius},
      depth:cand.depth,capAngle:cand.capAngle,closure:closed?'plane':'open',
      sourceIds:sourceIds.slice(),mouthCurve:ci,surface:sphereIndex});
  }
  function inferRecesses(ink,used,geometry) {
    var issues=[],records=[],claimed=new Set();
    var circles=ink.filter(function(e) {return e && e.type==='CIRCLE' && !helper(e) &&
      !used.has(e.id) && principalFrame(viewOf(e));});
    var arcs=ink.filter(function(e) {return e && e.type==='CIRCULAR_ARC' && !helper(e) &&
      !used.has(e.id) && principalFrame(viewOf(e));});
    circles.forEach(function(C) {
      if(used.has(C.id)) return;
      var V=principalFrame(viewOf(C)),valid=[],conflicts=[];
      arcs.forEach(function(A) {
        if(claimed.has(A.id) || used.has(A.id)) return;
        var W=principalFrame(viewOf(A));
        if(!W || W.role===V.role) return;
        var cand=recessCandidate(C,V,A,W,ink,used);
        if(!cand) return;
        if(cand.conflict) conflicts.push({C:C,A:A,message:cand.conflict});
        else valid.push(cand);
      });
      if(!valid.length) {
        if(conflicts.length) issues.push({code:'recess-evidence-conflict',entityId:C.id,
          message:conflicts[0].message,
          sourceIds:[C.id].concat(conflicts.map(function(c) {return c.A.id;}))});
        return;
      }
      var groups=[];
      valid.forEach(function(cand) {
        var tol=1e-5*Math.max(1,cand.radius),group=null;
        for(var i=0;i<groups.length;i++) {
          var g=groups[i];
          if(Vec3.near(g.center,cand.center,tol) && Math.abs(g.radius-cand.radius)<=tol &&
             Vec3.near(g.mouthCenter,cand.mouthCenter,tol) &&
             Math.abs(g.capAngle-cand.capAngle)<=1e-5 &&
             dot(g.outward,cand.outward)>1-1e-6) {group=g;break;}
        }
        if(!group) {group={center:cand.center,radius:cand.radius,mouthCenter:cand.mouthCenter,
          outward:cand.outward,capAngle:cand.capAngle,candidates:[],closureIds:[],
          closure:false};groups.push(group);}
        group.candidates.push(cand);
        cand.closure.ids.forEach(function(id) {if(group.closureIds.indexOf(id)===-1) group.closureIds.push(id);});
        group.closure=group.closure||cand.closure.found;
      });
      if(groups.length>1) {
        issues.push({code:'recess-evidence-ambiguous',entityId:C.id,
          message:'Several silhouette arcs fit this mouth circle with different sphere geometry; the recess is unresolved.',
          sourceIds:[C.id].concat(valid.map(function(c) {return c.arc.id;}))});
        return;
      }
      var group=groups[0],cand=group.candidates[0];
      var sourceIds=Array.from(new Set([C.id].concat(group.candidates.map(function(c) {return c.arc.id;}),group.closureIds)));
      if(!group.closure) issues.push({code:'recess-mouth-unclosed',entityId:C.id,
        message:'The spherical recess is determined, but no edge-on mouth stroke closes it; the cap is retained open.'});
      addSphericalRecess(geometry,cand,sourceIds,group.closureIds,group.closure);
      sourceIds.forEach(function(id) {used.add(id);claimed.add(id);});
      records.push({kind:'spherical',center:cand.center,radius:cand.radius,
        mouthCenter:cand.mouthCenter,mouthRadius:cand.mouthRadius,depth:cand.depth,
        closure:group.closure?'plane':'open',sourceIds:sourceIds.slice()});
    });
    return {records:records,issues:issues};
  }
  // --- Cylindrical recess inference ---------------------------------------
  // A blind cylindrical recess is a full circular mouth in one principal view
  // (the centre of a recess, not a bare end cap) and, in the paired view, two
  // edge-on depth strokes at the mouth's lateral extremes plus a bottom edge.
  // The mouth normal is the cylinder axis; the depth strokes and bottom edge
  // fix its depth and the bottom circle. The mouth must be an opening in a
  // drawn face: a four-sided straight frame around the circle in its own view.
  // That keeps a bare circular end face with matching far edge in the existing
  // ruled-surface path instead of relabelling it as a recess.
  function frameAroundMouth(ink, role, cx, cy, a) {
    var segments=ink.filter(function(s) {
      return s && s.type==='SEGMENT' && viewOf(s)===role && !helper(s);
    });
    if(segments.length<4) return false;
    var x0=cx-a,x1=cx+a,y0=cy-a,y1=cy+a,tol=1e-6*Math.max(1,a);
    function coversX(s) {return Math.min(s.x,s.x2)<=x0+tol && Math.max(s.x,s.x2)>=x1-tol;}
    function coversY(s) {return Math.min(s.y,s.y2)<=y0+tol && Math.max(s.y,s.y2)>=y1-tol;}
    var above=false,below=false,left=false,right=false;
    segments.forEach(function(s) {
      if(Math.min(s.y,s.y2)>y1+tol && coversX(s)) above=true;
      if(Math.max(s.y,s.y2)<y0-tol && coversX(s)) below=true;
      if(Math.max(s.x,s.x2)<x0-tol && coversY(s)) left=true;
      if(Math.min(s.x,s.x2)>x1+tol && coversY(s)) right=true;
    });
    return above && below && left && right;
  }
  // Group collinear strokes into merged intervals. horizontal groups by y and
  // measures x; vertical groups by x and measures y.
  function recessRuns(ink, role, horizontal, used) {
    var rows=[];
    ink.forEach(function(s) {
      if(!s || s.type!=='SEGMENT' || viewOf(s)!==role || used.has(s.id)) return;
      var key,i;
      if(horizontal) {
        if(!near(s.y,s.y2) || near(s.x,s.x2)) return;
        key=s.y;i={min:Math.min(s.x,s.x2),max:Math.max(s.x,s.x2),ids:[s.id],items:[{id:s.id,min:Math.min(s.x,s.x2),max:Math.max(s.x,s.x2)}]};
      } else {
        if(!near(s.x,s.x2) || near(s.y,s.y2)) return;
        key=s.x;i={min:Math.min(s.y,s.y2),max:Math.max(s.y,s.y2),ids:[s.id],items:[{id:s.id,min:Math.min(s.y,s.y2),max:Math.max(s.y,s.y2)}]};
      }
      var row=rows.find(function(r) {return near(r.key,key);});
      if(!row) {row={key:key,intervals:[]};rows.push(row);}
      row.intervals.push(i);
    });
    rows.forEach(function(row) {
      row.intervals.sort(function(a,b) {return a.min-b.min || a.max-b.max;});
      var merged=[];
      row.intervals.forEach(function(i) {
        var last=merged[merged.length-1];
        if(last && i.min<=last.max+EPS) {
          last.max=Math.max(last.max,i.max);
          last.ids=Array.from(new Set(last.ids.concat(i.ids)));
          last.items=last.items.concat(i.items);
        } else merged.push({min:i.min,max:i.max,ids:i.ids.slice(),items:i.items.slice()});
      });
      row.intervals=merged;
    });
    return rows;
  }
  function cylindricalRecessEvidence(C,V,ink,used) {
    var a=C.radius;
    if(!(a>EPS) || !frameAroundMouth(ink,V.role,C.x,C.y,a)) return null;
    var W=principalFrame(V.role==='PLAN'?'ELEVATION':'PLAN');
    if(!W) return null;
    var tol=1e-4*Math.max(1,a),spanMin=C.x-a,spanMax=C.x+a;
    var hRows=recessRuns(ink,W.role,true,used),vRows=recessRuns(ink,W.role,false,used);
    var full=[];
    hRows.forEach(function(row) {
      row.intervals.forEach(function(r) {
        if(r.min<=spanMin+EPS && r.max>=spanMax-EPS) {
          var exactIds=r.items.filter(function(item) {
            return near(item.min,spanMin)&&near(item.max,spanMax);
          }).map(function(item) {return item.id;});
          full.push({station:row.key,min:r.min,max:r.max,
            exact:near(r.min,spanMin)&&near(r.max,spanMax),
            exactIds:Array.from(new Set(exactIds)),
            cover:r.min<spanMin-EPS || r.max>spanMax+EPS,ids:r.ids});
        }
      });
    });
    function runAt(station) {
      return full.filter(function(r) {return near(r.station,station);})[0] || null;
    }
    function sideAt(x) {
      for(var i=0;i<vRows.length;i++) if(near(vRows[i].key,x)) return vRows[i].intervals;
      return [];
    }
    var left=sideAt(spanMin),right=sideAt(spanMax),spans=[];
    left.forEach(function(l) {right.forEach(function(r) {
      if(near(l.min,r.min) && near(l.max,r.max))
        spans.push({lo:Math.min(l.min,l.max),hi:Math.max(l.min,l.max),left:l,right:r});
    });});
    var unique=[];
    spans.forEach(function(s) {
      if(!unique.some(function(u) {return near(u.lo,s.lo)&&near(u.hi,s.hi);})) unique.push(s);
    });
    if(!unique.length) {
      if(full.length) return {missing:'The mouth is an opening in a drawn face, but no depth strokes fix the recess depth.'};
      return null;
    }
    var candidates=[],conflicts=[];
    unique.forEach(function(span) {
      var depth=span.hi-span.lo;
      if(!(depth>tol)) return;
      var loRun=runAt(span.lo),hiRun=runAt(span.hi);
      var loExact=!!(loRun&&loRun.exact),hiExact=!!(hiRun&&hiRun.exact);
      var loMouth=!!(loRun&&loRun.exactIds.length),hiMouth=!!(hiRun&&hiRun.exactIds.length);
      var mouthStation,bottomStation,bottomRun,mouthRun,closedMouth=false;
      // Exact edges at both ends, with no longer face edge, are an ordinary
      // cylinder between two drawn circles; the existing ruled-surface stage
      // owns that case.
      if(loExact&&hiExact) return;
      if(loExact) {
        bottomStation=span.lo;bottomRun=loRun;mouthStation=span.hi;mouthRun=hiRun;closedMouth=hiMouth;
      } else if(hiExact) {
        bottomStation=span.hi;bottomRun=hiRun;mouthStation=span.lo;mouthRun=loRun;closedMouth=loMouth;
      } else {
        var partial=false;
        hRows.forEach(function(row) {
          row.intervals.forEach(function(r) {
            if((near(row.key,span.lo)||near(row.key,span.hi)) &&
               (r.min>spanMin+tol || r.max<spanMax-tol)) partial=true;
          });
        });
        conflicts.push(partial?'The bottom edge does not span the mouth diameter.':
          'The depth strokes end without an exact bottom edge; the flat bottom is unresolved.');
        return;
      }
      // A full edge inside the side-stroke span is a bottom at a different
      // level than the strokes assert.
      full.forEach(function(r) {
        if(r.station>span.lo+tol && r.station<span.hi-tol)
          conflicts.push('A bottom edge lies inside the depth strokes at another level.');
      });
      // A partial edge at the bottom station is an incomplete bottom loop.
      hRows.forEach(function(row) {
        row.intervals.forEach(function(r) {
          if(near(row.key,bottomStation) && (r.min>spanMin+tol || r.max<spanMax-tol))
            conflicts.push('The bottom edge does not span the mouth diameter.');
        });
      });
      candidates.push({span:span,mouthStation:mouthStation,bottomStation:bottomStation,
        mouthRun:mouthRun,bottomRun:bottomRun,closedMouth:closedMouth});
    });
    if(conflicts.length) return {conflict:conflicts[0]};
    if(candidates.length>1) return {ambiguous:'Several depth-stroke spans fit this mouth circle; the recess depth is unresolved.'};
    if(!candidates.length) return {missing:'The depth strokes do not bound a consistent flat-bottomed cavity.'};
    return {candidate:candidates[0]};
  }
  function cylinderRecessMesh(M,axis,depth,a,u,v,lon) {
    var vertices=[],faces=[],edges=[],edgeMap=new Map();
    var bottom=add(M,mul(axis,depth)),topRing=[],bottomRing=[];
    for(var j=0;j<lon;j++) {
      var t=TAU*j/lon,radial=add(mul(u,Math.cos(t)*a),mul(v,Math.sin(t)*a));
      topRing.push(vertices.length);vertices.push(add(M,radial));
      bottomRing.push(vertices.length);vertices.push(add(bottom,radial));
    }
    function edge(i,j) {
      var key=i<j?i+'_'+j:j+'_'+i;
      if(!edgeMap.has(key)) {edgeMap.set(key,edges.length);edges.push([i,j]);}
      return edgeMap.get(key);
    }
    var topEdges=[],bottomEdges=[],sideFaces=[];
    for(var j=0;j<lon;j++) {
      topEdges.push(edge(topRing[j],topRing[(j+1)%lon]));
      bottomEdges.push(edge(bottomRing[j],bottomRing[(j+1)%lon]));
    }
    for(var j=0;j<lon;j++) {
      var j2=(j+1)%lon,loop=[topRing[j],topRing[j2],bottomRing[j2],bottomRing[j]];
      var p0=vertices[loop[0]],p1=vertices[loop[1]],p2=vertices[loop[2]];
      var n=cross(sub(p1,p0),sub(p2,p0));
      var centroid=mul(add(add(p0,p1),p2),1/3);
      var along=dot(sub(centroid,M),axis);
      var radial=sub(sub(centroid,M),mul(axis,along));
      // A cavity is viewed from inside: orient the display facets toward the
      // axis, matching the inward-facing spherical-recess bowl.
      if(dot(n,radial)>0) loop.reverse();
      sideFaces.push(faces.length);faces.push(loop);
      edge(bottomRing[j],topRing[j]);
    }
    return {vertices:vertices,faces:faces,edges:edges,topRing:topRing,bottomRing:bottomRing,
      topEdges:topEdges,bottomEdges:bottomEdges,sideFaces:sideFaces};
  }
  function addCylindricalRecess(geometry,cand,sourceIds,mouthIds,bottomIds,closedMouth) {
    var mesh=cylinderRecessMesh(cand.mouthCenter,cand.axis,cand.depth,cand.radius,cand.u,cand.v,SAMPLES);
    var vo=geometry.vertices.length,eo=geometry.edges.length,fo=geometry.faces.length;
    geometry.vertices=geometry.vertices.concat(mesh.vertices);
    geometry.edges=geometry.edges.concat(mesh.edges.map(function(e) {return [e[0]+vo,e[1]+vo];}));
    geometry.faces=geometry.faces.concat(mesh.faces.map(function(f) {return f.map(function(v) {return v+vo;});}));
    var sideFaceIndices=mesh.sideFaces.map(function(i) {return i+fo;});
    geometry.smoothSideFaces=geometry.smoothSideFaces.concat(sideFaceIndices);
    var bottomFaceIndex=geometry.faces.length;
    geometry.faces.push(mesh.bottomRing.map(function(v) {return v+vo;}));
    var mouthCi=geometry.curves.length;
    geometry.curves.push({kind:'circle',center:cand.mouthCenter,u:cand.u,v:cand.v,radius:cand.radius,
      startAngle:0,sweepAngle:TAU,sourceIds:[cand.circle.id].concat(mouthIds),
      sourceView:cand.view.role,recessMouth:true,
      displayVertices:mesh.topRing.map(function(v) {return v+vo;}),
      displayEdges:mesh.topEdges.map(function(e) {return e+eo;})});
    var bottomCi=geometry.curves.length;
    geometry.curves.push({kind:'circle',center:cand.bottomCenter,u:cand.u,v:cand.v,radius:cand.radius,
      startAngle:0,sweepAngle:TAU,sourceIds:[cand.circle.id].concat(bottomIds),
      sourceView:cand.view.role,recessBottom:true,
      displayVertices:mesh.bottomRing.map(function(v) {return v+vo;}),
      displayEdges:mesh.bottomEdges.map(function(e) {return e+eo;})});
    var cylinderIndex=geometry.surfacePatches.length;
    geometry.surfacePatches.push({kind:'cylinder',analyticKind:'cylinder',origin:cand.mouthCenter,
      axis:cand.axis,radius:cand.radius,boundaryCurves:[mouthCi,bottomCi],
      faceIndices:sideFaceIndices,sourceIds:sourceIds.slice(),recess:true});
    geometry.surfacePatches.push({kind:'plane',boundaryCurves:[bottomCi],faceIndices:[bottomFaceIndex],
      closure:'recess-bottom',recessBottom:true,sourceIds:[cand.circle.id].concat(bottomIds)});
    if(closedMouth) geometry.surfacePatches.push({kind:'plane',boundaryCurves:[mouthCi],
      faceIndices:[],closure:'recess-mouth',recessMouth:true,
      sourceIds:[cand.circle.id].concat(mouthIds)});
    if(!geometry.recesses) geometry.recesses=[];
    geometry.recesses.push({kind:'cylindrical',mouth:{center:cand.mouthCenter,normal:cand.outward,radius:cand.radius},
      axis:cand.axis,depth:cand.depth,bottom:{center:cand.bottomCenter,radius:cand.radius},
      closure:closedMouth?'plane':'open',bottomClosure:'plane',sourceIds:sourceIds.slice(),
      mouthCurve:mouthCi,bottomCurve:bottomCi,surface:cylinderIndex});
  }
  function inferCylindricalRecesses(ink,used,geometry) {
    var issues=[],records=[],claimed=new Set();
    var circles=ink.filter(function(e) {
      return e && e.type==='CIRCLE' && !helper(e) && !used.has(e.id) && principalFrame(viewOf(e));
    });
    circles.forEach(function(C) {
      if(used.has(C.id)||claimed.has(C.id)) return;
      var V=principalFrame(viewOf(C)),evidence=cylindricalRecessEvidence(C,V,ink,used);
      if(!evidence) return;
      if(evidence.conflict) {
        issues.push({code:'recess-depth-conflict',entityId:C.id,message:evidence.conflict});
        return;
      }
      if(evidence.missing) {
        issues.push({code:'recess-depth-missing',entityId:C.id,message:evidence.missing});
        return;
      }
      if(evidence.ambiguous) {
        issues.push({code:'recess-depth-ambiguous',entityId:C.id,message:evidence.ambiguous});
        return;
      }
      var cand=evidence.candidate,a=C.radius,W=principalFrame(V.role==='PLAN'?'ELEVATION':'PLAN');
      var o0=W.project(V.to3D(0,0,0)),o1=W.project(V.to3D(0,0,1));
      var dx=o1.x-o0.x,dy=o1.y-o0.y,len=Math.hypot(dx,dy);
      if(len<EPS) return;
      var axis2={x:dx/len,y:dy/len};
      if(Math.abs(axis2.y)<EPS) return;
      var mouthFree=(cand.mouthStation-o0.y)/axis2.y;
      var bottomFree=(cand.bottomStation-o0.y)/axis2.y;
      var freeDelta=bottomFree-mouthFree;
      if(Math.abs(freeDelta)<=1e-6*Math.max(1,a)) return;
      var axis=mul(V.normal,freeDelta>0?1:-1),outward=mul(axis,-1);
      var u=V.u,v=V.v;
      if(dot(cross(u,v),outward)<0) v=mul(v,-1);
      var mouthCenter=V.to3D(C.x,C.y,mouthFree);
      var resolved={circle:C,view:V,mouthCenter:mouthCenter,radius:a,axis:axis,outward:outward,
        depth:Math.abs(freeDelta),bottomCenter:add(mouthCenter,mul(axis,Math.abs(freeDelta))),
        u:u,v:v,mouthRun:cand.mouthRun,bottomRun:cand.bottomRun,span:cand.span};
      var mouthIds=cand.mouthRun&&cand.closedMouth?cand.mouthRun.exactIds.slice():[];
      var bottomIds=cand.bottomRun.ids.slice();
      var sideIds=cand.span.left.ids.concat(cand.span.right.ids);
      var sourceIds=Array.from(new Set([C.id].concat(cand.mouthRun?cand.mouthRun.ids:[],bottomIds,sideIds)));
      var consumed=Array.from(new Set([C.id].concat(mouthIds,bottomIds,sideIds)));
      if(!cand.closedMouth) issues.push({code:'recess-mouth-unclosed',entityId:C.id,
        message:'The cylindrical recess is determined, but no exact mouth stroke closes it; the cavity is retained open.'});
      addCylindricalRecess(geometry,resolved,sourceIds,mouthIds,bottomIds,cand.closedMouth);
      consumed.forEach(function(id) {used.add(id);claimed.add(id);});
      records.push({kind:'cylindrical',mouthCenter:mouthCenter,mouthRadius:a,axis:axis,depth:resolved.depth,
        bottomCenter:resolved.bottomCenter,closure:cand.closedMouth?'plane':'open',
        bottomClosure:'plane',sourceIds:sourceIds.slice()});
    });
    return {records:records,issues:issues};
  }
  // --- Cylindrical fillet between two planar faces -------------------------
  // A fillet is a partial cylinder tangent to two planar faces. In the view
  // where its cross-section is true (PLAN or ELEVATION) it is a circular arc
  // whose endpoints are tangent to two straight face edges. The paired view
  // shows the two tangent generator lines (the straight boundaries shared
  // with the faces) spanning the fillet length; the same view's end strokes
  // already fix the two coaxial end arcs. No solid or feature name is read.
  var FILLET_VIEWS = ['PLAN','ELEVATION','PROFILE'];
  function filletTolerance(arc) {
    return Math.max(1e-4, 1e-6 * Math.max(1, arc.radius));
  }
  function angleDistance(a, b) {
    var d = Math.abs(((a - b) % TAU + TAU) % TAU);
    return Math.min(d, TAU - d);
  }
  function pointOnSegment2D(p, s, tol) {
    var dx = s.x2 - s.x, dy = s.y2 - s.y, len2 = dx*dx + dy*dy;
    if (len2 < EPS*EPS) return false;
    var t = ((p.x - s.x)*dx + (p.y - s.y)*dy) / len2;
    if (t < -1e-6 || t > 1 + 1e-6) return false;
    return Math.hypot(p.x - (s.x + t*dx), p.y - (s.y + t*dy)) <= tol;
  }
  function filletArcEndpoint(arc, theta) {
    var radial = add(mul(arc.u, Math.cos(theta)), mul(arc.v, Math.sin(theta)));
    return add(arc.center, mul(radial, arc.radius));
  }
  function filletTangentDirection(arc, theta) {
    return add(mul(arc.u, -Math.sin(theta)), mul(arc.v, Math.cos(theta)));
  }
  // Find one straight stroke tangent to the projected cross-section arc at
  // each endpoint. The stroke must contain the tangency point and must extend
  // along the face, away from the arc's angular span. The extent it draws
  // becomes the adjacent planar patch's width.
  function filletTangentEvidence(arc, role, profile, ink, used, tol) {
    var conic = projectedConic(arc, role, profile);
    if (!conic) return {conflict:'The fillet cross-section cannot be projected into its own view.'};
    var start = angle(arc.startAngle || 0), sweep = arc.sweepAngle === undefined ? TAU : arc.sweepAngle;
    var end = angle(start + sweep), angleTol = tol / Math.max(1, arc.radius);
    var candidates = {start:[], end:[]};
    ink.forEach(function (segment) {
      if (!segment || segment.type !== 'SEGMENT' || viewOf(segment) !== role || used.has(segment.id) || helper(segment)) return;
      var tangent = segmentTangency(conic, segment, tol);
      if (!tangent) return;
      var theta = angle(tangent.t);
      var which = angleDistance(theta, start) <= angleTol ? 'start' :
        angleDistance(theta, end) <= angleTol ? 'end' : null;
      if (!which) return;
      var tangentPoint = filletArcEndpoint(arc, theta);
      var projected = sheetPoint(tangentPoint, role, profile);
      if (!projected || !pointOnSegment2D(projected, segment, tol)) return;
      var viewDirection = which === 'start' ? mul(filletTangentDirection(arc, theta), -1) :
        filletTangentDirection(arc, theta);
      var projectedDirection = sheetVector(viewDirection, role, profile);
      var length = Math.hypot(projectedDirection.x, projectedDirection.y);
      if (length < EPS) return;
      var dx = projectedDirection.x/length, dy = projectedDirection.y/length;
      var reachA = (segment.x - projected.x)*dx + (segment.y - projected.y)*dy;
      var reachB = (segment.x2 - projected.x)*dx + (segment.y2 - projected.y)*dy;
      var extent = Math.max(reachA, reachB);
      if (extent <= tol)
        return candidates[which].push({conflict:true, segment:segment, theta:theta,
          message:'The face edge at an arc endpoint extends into the fillet instead of away from it.'});
      candidates[which].push({segment:segment, theta:theta, extent:extent,
        point:tangentPoint, direction:{x:viewDirection.x,y:viewDirection.y,z:viewDirection.z},
        viewDirection:{x:dx,y:dy}});
    });
    function best(list) {
      var conflicts = list.filter(function (c) { return c.conflict; });
      var valid = list.filter(function (c) { return !c.conflict; });
      if (valid.length) {
        valid.sort(function (a, b) {
          return b.extent - a.extent || String(a.segment.id).localeCompare(String(b.segment.id));
        });
        return valid[0];
      }
      return conflicts[0] || null;
    }
    var first = best(candidates.start), second = best(candidates.end);
    if (!first && !second) return {missing:'both'};
    if (!first || !second) return {missing:first ? 'end' : 'start'};
    if (first.conflict || second.conflict) return {conflict:first.conflict ? first.message : second.message};
    var d1 = {x:first.segment.x2-first.segment.x, y:first.segment.y2-first.segment.y};
    var d2 = {x:second.segment.x2-second.segment.x, y:second.segment.y2-second.segment.y};
    var cross2 = Math.abs(d1.x*d2.y - d1.y*d2.x);
    var l1 = Math.hypot(d1.x,d1.y), l2 = Math.hypot(d2.x,d2.y);
    if (l1 < EPS || l2 < EPS || cross2 <= 1e-6*l1*l2)
      return {conflict:'The two tangent face edges are parallel and do not form a fillet corner.'};
    return {start:first, end:second};
  }
  // The tangent generator at each arc endpoint is a straight boundary shared
  // with a planar face. It is visible as a line in a view perpendicular to the
  // arc plane; that drawn line is the paired-view evidence.
  function filletBoundaryCoverage(line, arcRole, profile, ink, used, tol) {
    for (var i=0;i<FILLET_VIEWS.length;i++) {
      var role = FILLET_VIEWS[i];
      if (role === arcRole || (role === 'PROFILE' && !profile)) continue;
      var p1 = sheetPoint(line.start, role, profile), p2 = sheetPoint(line.end, role, profile);
      if (!p1 || !p2) continue;
      var len = Math.hypot(p2.x-p1.x, p2.y-p1.y);
      if (len <= tol) continue;
      var dx = (p2.x-p1.x)/len, dy = (p2.y-p1.y)/len, slack = tol/len, intervals = [];
      ink.forEach(function (segment) {
        if (!segment || segment.type !== 'SEGMENT' || viewOf(segment) !== role || used.has(segment.id) || helper(segment)) return;
        if (Math.abs((segment.x-p1.x)*dy - (segment.y-p1.y)*dx) > tol) return;
        if (Math.abs((segment.x2-p1.x)*dy - (segment.y2-p1.y)*dx) > tol) return;
        var a = ((segment.x-p1.x)*dx + (segment.y-p1.y)*dy)/len;
        var b = ((segment.x2-p1.x)*dx + (segment.y2-p1.y)*dy)/len;
        intervals.push({a:Math.min(a,b), b:Math.max(a,b), id:segment.id});
      });
      if (!intervals.length) continue;
      intervals.sort(function (a,b) { return a.a - b.a || a.b - b.b; });
      var reach = 0, ids = [];
      intervals.forEach(function (interval) {
        if (interval.a > reach + slack) return;
        reach = Math.max(reach, interval.b);
        if (interval.a >= -slack && interval.b <= 1 + slack) ids.push(interval.id);
      });
      if (reach >= 1 - slack) return {ok:true, role:role, ids:Array.from(new Set(ids))};
    }
    return {ok:false};
  }
  function addCylindricalFillet(geometry, candidate) {
    var low = candidate.low, high = candidate.high;
    if (!geometry || !Array.isArray(geometry.vertices) || !Array.isArray(geometry.edges) || !Array.isArray(geometry.faces)) return null;
    geometry.surfacePatches = geometry.surfacePatches || [];
    geometry.faces = geometry.faces || [];
    geometry.edges = geometry.edges || [];
    geometry.smoothSideFaces = geometry.smoothSideFaces || [];
    var lowDV = low.displayVertices || [], highDV = high.displayVertices || [];
    if (lowDV.length < 2 || lowDV.length !== highDV.length) return null;
    var n = lowDV.length - 1;
    var edgeKeys = new Set();
    geometry.edges.forEach(function (e) { edgeKeys.add(Math.min(e[0],e[1])+'_'+Math.max(e[0],e[1])); });
    function ensureEdge(a, b) {
      var key = Math.min(a,b)+'_'+Math.max(a,b);
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      geometry.edges.push([a,b]);
    }
    function addFace(loop, smooth) {
      var index = geometry.faces.length;
      geometry.faces.push(loop);
      if (smooth) geometry.smoothSideFaces.push(index);
      return index;
    }
    var cylinderFaces = [];
    for (var i=0;i<n;i++) {
      // The quad follows the arc tessellation and its z translation. Adjacent
      // quads share the existing arc display edges and a new generator edge.
      cylinderFaces.push(addFace([lowDV[i], lowDV[i+1], highDV[i+1], highDV[i]], true));
      ensureEdge(lowDV[i], highDV[i]);
    }
    ensureEdge(lowDV[n], highDV[n]);
    var vo = geometry.vertices.length;
    var A0 = lowDV[0], A1 = highDV[0], B0 = lowDV[n], B1 = highDV[n];
    var wallDirection = candidate.start.direction, floorDirection = candidate.end.direction;
    var wallExtent = candidate.start.extent, floorExtent = candidate.end.extent;
    var W0 = vo, W1 = vo+1, F0 = vo+2, F1 = vo+3;
    function offsetVertex(index, direction, extent) {
      var p = geometry.vertices[index];
      return {x:p.x + direction.x*extent, y:p.y + direction.y*extent, z:p.z + direction.z*extent};
    }
    geometry.vertices.push(offsetVertex(A0, wallDirection, wallExtent));
    geometry.vertices.push(offsetVertex(A1, wallDirection, wallExtent));
    geometry.vertices.push(offsetVertex(B0, floorDirection, floorExtent));
    geometry.vertices.push(offsetVertex(B1, floorDirection, floorExtent));
    // Planar face strips. The shared generator lines are traversed in the
    // opposite direction from the cylinder side, so the display complex stays
    // consistently oriented.
    var wallFace = addFace([A0, A1, W1, W0], false);
    var floorFace = addFace([B0, F0, F1, B1], false);
    ensureEdge(A1, W1); ensureEdge(W1, W0); ensureEdge(W0, A0);
    ensureEdge(B0, F0); ensureEdge(F0, F1); ensureEdge(F1, B1);
    var u = candidate.u, v = candidate.v, axis = candidate.axis;
    var normalStart = unit(add(mul(u, Math.cos(candidate.startAngle)), mul(v, Math.sin(candidate.startAngle))));
    var normalEnd = unit(add(mul(u, Math.cos(candidate.endAngle)), mul(v, Math.sin(candidate.endAngle))));
    function planeFrame(normal) {
      var frameU = axis;
      var frameV = cvUnit(cross(normal, axis));
      return {u:frameU, v:frameV};
    }
    var wallFrame = planeFrame(normalStart), floorFrame = planeFrame(normalEnd);
    var lineStart = candidate.lineStart, lineEnd = candidate.lineEnd;
    var filletNumber = (geometry.fillets || []).length;
    lineStart.id = 'fillet-line:' + filletNumber + ':start';
    lineEnd.id = 'fillet-line:' + filletNumber + ':end';
    var wallOuter = {kind:'line', start:{x:geometry.vertices[W1].x,y:geometry.vertices[W1].y,z:geometry.vertices[W1].z},
      end:{x:geometry.vertices[W0].x,y:geometry.vertices[W0].y,z:geometry.vertices[W0].z},
      id:'fillet-line:' + filletNumber + ':wall-outer', sourceIds:lineStart.sourceIds.slice()};
    var wallEndHigh = {kind:'line', start:{x:geometry.vertices[A1].x,y:geometry.vertices[A1].y,z:geometry.vertices[A1].z},
      end:{x:geometry.vertices[W1].x,y:geometry.vertices[W1].y,z:geometry.vertices[W1].z},
      id:'fillet-line:' + filletNumber + ':wall-end-high', sourceIds:lineStart.sourceIds.slice()};
    var wallEndLow = {kind:'line', start:{x:geometry.vertices[W0].x,y:geometry.vertices[W0].y,z:geometry.vertices[W0].z},
      end:{x:geometry.vertices[A0].x,y:geometry.vertices[A0].y,z:geometry.vertices[A0].z},
      id:'fillet-line:' + filletNumber + ':wall-end-low', sourceIds:lineStart.sourceIds.slice()};
    var floorOuter = {kind:'line', start:{x:geometry.vertices[F0].x,y:geometry.vertices[F0].y,z:geometry.vertices[F0].z},
      end:{x:geometry.vertices[F1].x,y:geometry.vertices[F1].y,z:geometry.vertices[F1].z},
      id:'fillet-line:' + filletNumber + ':floor-outer', sourceIds:lineEnd.sourceIds.slice()};
    var floorEndLow = {kind:'line', start:{x:geometry.vertices[B0].x,y:geometry.vertices[B0].y,z:geometry.vertices[B0].z},
      end:{x:geometry.vertices[F0].x,y:geometry.vertices[F0].y,z:geometry.vertices[F0].z},
      id:'fillet-line:' + filletNumber + ':floor-end-low', sourceIds:lineEnd.sourceIds.slice()};
    var floorEndHigh = {kind:'line', start:{x:geometry.vertices[F1].x,y:geometry.vertices[F1].y,z:geometry.vertices[F1].z},
      end:{x:geometry.vertices[B1].x,y:geometry.vertices[B1].y,z:geometry.vertices[B1].z},
      id:'fillet-line:' + filletNumber + ':floor-end-high', sourceIds:lineEnd.sourceIds.slice()};
    var cylinderIndex = geometry.surfacePatches.length;
    var cylinderSource = candidate.sourceIds.slice();
    geometry.surfacePatches.push({kind:'cylinder',analyticKind:'cylinder',origin:low.center,
      axis:axis,radius:low.radius,
      loops:[{kind:'outer',curves:[candidate.lowIndex,candidate.highIndex],
        lines:[lineStart,lineEnd]}],
      faceIndices:cylinderFaces,sourceIds:cylinderSource,fillet:true});
    var wallIndex = geometry.surfacePatches.length;
    geometry.surfacePatches.push({kind:'plane',origin:{x:lineStart.start.x,y:lineStart.start.y,z:lineStart.start.z},
      normal:normalStart,u:wallFrame.u,v:wallFrame.v,
      loops:[{kind:'outer',lines:[lineStart,wallEndHigh,wallOuter,wallEndLow]}],
      faceIndices:[wallFace],sourceIds:cylinderSource.slice(),filletAdjacent:true});
    var floorIndex = geometry.surfacePatches.length;
    geometry.surfacePatches.push({kind:'plane',origin:{x:lineEnd.end.x,y:lineEnd.end.y,z:lineEnd.end.z},
      normal:normalEnd,u:floorFrame.u,v:floorFrame.v,
      loops:[{kind:'outer',lines:[lineEnd,floorEndLow,floorOuter,floorEndHigh]}],
      faceIndices:[floorFace],sourceIds:cylinderSource.slice(),filletAdjacent:true});
    // Close the corner bar: one back plane and two cross-section end caps.
    var backStart={kind:'line',start:{x:geometry.vertices[W0].x,y:geometry.vertices[W0].y,z:geometry.vertices[W0].z},
      end:{x:geometry.vertices[F0].x,y:geometry.vertices[F0].y,z:geometry.vertices[F0].z},
      id:'fillet-line:' + filletNumber + ':back-start', sourceIds:cylinderSource.slice()};
    var backEnd={kind:'line',start:{x:geometry.vertices[W1].x,y:geometry.vertices[W1].y,z:geometry.vertices[W1].z},
      end:{x:geometry.vertices[F1].x,y:geometry.vertices[F1].y,z:geometry.vertices[F1].z},
      id:'fillet-line:' + filletNumber + ':back-end', sourceIds:cylinderSource.slice()};
    ensureEdge(W0,F0); ensureEdge(W1,F1);
    var backFace=addFace([W1,W0,F0,F1],false);
    var startFace=addFace([A0,B0,F0,W0],false);
    var endFace=addFace([A1,F1,B1,W1],false);
    function loopNormal(points) {
      return cvUnit(cross(sub(points[1],points[0]),sub(points[2],points[0])));
    }
    var pW0=geometry.vertices[W0],pW1=geometry.vertices[W1],pF0=geometry.vertices[F0],pF1=geometry.vertices[F1];
    var pA0=geometry.vertices[A0],pB0=geometry.vertices[B0];
    var pA1=geometry.vertices[A1],pB1=geometry.vertices[B1];
    var backNormal=loopNormal([pW1,pW0,pF0]), startNormal=loopNormal([pA0,pB0,pF0]),
      endNormal=loopNormal([pA1,pF1,pB1]);
    if(backNormal) { var backIndex=geometry.surfacePatches.length; geometry.surfacePatches.push({kind:'plane',origin:pW0,normal:backNormal,
      u:cvUnit(cross(backNormal,axis)),v:cvUnit(cross(backNormal,cvUnit(cross(backNormal,axis)))),
      loops:[{kind:'outer',lines:[wallOuter,backStart,floorOuter,backEnd]}],
      faceIndices:[backFace],sourceIds:cylinderSource.slice(),filletClosure:true}); }
    if(startNormal) { var startIndex=geometry.surfacePatches.length; geometry.surfacePatches.push({kind:'plane',origin:pA0,normal:startNormal,
      loops:[{kind:'outer',curves:[candidate.lowIndex],lines:[floorEndLow,backStart,wallEndLow]}],
      faceIndices:[startFace],sourceIds:cylinderSource.slice(),filletClosure:true}); }
    if(endNormal) { var endIndex=geometry.surfacePatches.length; geometry.surfacePatches.push({kind:'plane',origin:pA1,normal:endNormal,
      loops:[{kind:'outer',curves:[candidate.highIndex],lines:[floorEndHigh,backEnd,wallEndHigh]}],
      faceIndices:[endFace],sourceIds:cylinderSource.slice(),filletClosure:true}); }
    if (!geometry.fillets) geometry.fillets=[];
    var record = {kind:'cylindrical',center:{x:low.center.x,y:low.center.y,z:low.center.z},
      axis:{x:axis.x,y:axis.y,z:axis.z},radius:low.radius,
      startAngle:candidate.startAngle,sweepAngle:candidate.sweepAngle,length:candidate.length,
      tangentLines:[lineStart,lineEnd],endArcs:[candidate.lowIndex,candidate.highIndex],
      closure:'closed',sourceIds:cylinderSource.slice(),surface:cylinderIndex,
      closureSurfaces:[backIndex,startIndex,endIndex].filter(function (i) { return i !== undefined; }),
      adjacentSurfaces:[wallIndex,floorIndex]};
    geometry.fillets.push(record);
    return record;
  }
  function filletPair(upper, lower) {
    var a = upper.c, b = lower.c, tol = filletTolerance(a);
    if (a.sourceView !== b.sourceView || !a.sourceView) return null;
    if (Math.abs(a.radius - b.radius) > tol) return null;
    if (Math.abs(a.startAngle - b.startAngle) > 1e-7 || Math.abs(a.sweepAngle - b.sweepAngle) > 1e-7) return null;
    if (dot(a.u, b.u) < 1 - 1e-9 || dot(a.v, b.v) < 1 - 1e-9 ||
        Math.abs(dot(a.u, b.v)) > 1e-7 || Math.abs(dot(a.v, b.u)) > 1e-7) return null;
    var n = cvNormal(a);
    if (!n) return null;
    var delta = sub(b.center, a.center), axial = dot(delta, n);
    if (Math.abs(axial) <= tol) return null;
    if (Vec3.length(sub(delta, mul(n, axial))) > tol) return null;
    if (!(a.sweepAngle > EPS) || !(a.sweepAngle < Math.PI - EPS)) return null;
    if (axial > 0) return {low:upper, high:lower, lowIndex:upper.index, highIndex:lower.index};
    return {low:lower, high:upper, lowIndex:lower.index, highIndex:upper.index};
  }
  function inferCylindricalFillets(geometry,ink,used,profile) {
    var issues=[],records=[],consumed=new Set();
    if(!geometry||!Array.isArray(geometry.curves)) return {records:records,issues:issues,consumedIds:[]};
    var bound=new Set();
    (geometry.surfacePatches||[]).forEach(function(p) {
      (p.boundaryCurves||[]).forEach(function(i) {bound.add(i);});
    });
    var arcs=[];
    geometry.curves.forEach(function(c,index) {
      if(c.kind!=='circular-arc'||bound.has(index)) return;
      if(['PLAN','ELEVATION'].indexOf(c.sourceView)===-1&&!(c.sourceView==='PROFILE'&&profile)) return;
      arcs.push({c:c,index:index});
    });
    var claimed=new Set(),pairs=[];
    for(var i=0;i<arcs.length;i++) for(var j=i+1;j<arcs.length;j++) {
      var pair=filletPair(arcs[i],arcs[j]);
      if(pair) pairs.push(pair);
    }
    var pairCounts=new Map(),ambiguousReported=new Set();
    pairs.forEach(function(pair) {
      pairCounts.set(pair.lowIndex,(pairCounts.get(pair.lowIndex)||0)+1);
      pairCounts.set(pair.highIndex,(pairCounts.get(pair.highIndex)||0)+1);
    });
    pairs.forEach(function(pair) {
      if(claimed.has(pair.lowIndex)||claimed.has(pair.highIndex)) return;
      var ambiguous=pairCounts.get(pair.lowIndex)>1||pairCounts.get(pair.highIndex)>1;
      if(ambiguous) {
        [pair.lowIndex,pair.highIndex].forEach(function(index) {
          if(ambiguousReported.has(index)) return;
          ambiguousReported.add(index);
          issues.push({code:'fillet-ambiguous',entityId:(arcs[index].c.sourceIds||[])[0],
            message:'Several coaxial arc pairs fit this cross-section; the fillet length is unresolved.'});
        });
        return;
      }
      var low=pair.low.c,high=pair.high.c,role=low.sourceView,tol=filletTolerance(low);
      var evidence=filletTangentEvidence(low,role,profile,ink,used,tol);
      var entityId=(low.sourceIds||[])[0];
      function report(code,message) {issues.push({code:code,entityId:entityId,message:message});}
      if(evidence.missing) {
        if(evidence.missing!=='both') report('fillet-tangent-missing',
          'One tangent face edge at the fillet arc endpoints is missing; the fillet is unresolved.');
        return;
      }
      if(evidence.conflict) {report('fillet-tangent-conflict',evidence.conflict);return;}
      var start=angle(low.startAngle||0),end=angle(start+low.sweepAngle);
      var lineStart={kind:'line',start:filletArcEndpoint(low,start),end:filletArcEndpoint(high,start),
        sourceIds:Array.from(new Set([].concat(low.sourceIds||[],high.sourceIds||[],evidence.start.segment.id)))};
      var lineEnd={kind:'line',start:filletArcEndpoint(high,end),end:filletArcEndpoint(low,end),
        sourceIds:Array.from(new Set([].concat(low.sourceIds||[],high.sourceIds||[],evidence.end.segment.id)))};
      var coverStart=filletBoundaryCoverage(lineStart,role,profile,ink,used,tol);
      var coverEnd=filletBoundaryCoverage(lineEnd,role,profile,ink,used,tol);
      if(!coverStart.ok||!coverEnd.ok) {
        report('fillet-boundary-missing','The tangent generator boundary has no matching straight edge in the paired view; the fillet is unresolved.');
        return;
      }
      var sourceIds=Array.from(new Set([].concat(low.sourceIds||[],high.sourceIds||[],
        evidence.start.segment.id,evidence.end.segment.id,coverStart.ids,coverEnd.ids)));
      lineStart.sourceIds=sourceIds.slice();lineEnd.sourceIds=sourceIds.slice();
      var candidate={low:low,high:high,lowIndex:pair.lowIndex,highIndex:pair.highIndex,
        u:low.u,v:low.v,axis:cvUnit(sub(high.center,low.center)),
        startAngle:low.startAngle,sweepAngle:low.sweepAngle,
        endAngle:low.startAngle+low.sweepAngle,
        length:Vec3.length(sub(high.center,low.center)),
        start:evidence.start,end:evidence.end,lineStart:lineStart,lineEnd:lineEnd,
        sourceIds:sourceIds};
      if(addCylindricalFillet(geometry,candidate)) {
        claimed.add(pair.lowIndex);claimed.add(pair.highIndex);
        [evidence.start.segment.id,evidence.end.segment.id].concat(coverStart.ids,coverEnd.ids).forEach(function(id) {
          if(id) {used.add(id);consumed.add(id);}
        });
        records.push({kind:'cylindrical',radius:low.radius,axis:candidate.axis,
          center:low.center,startAngle:low.startAngle,sweepAngle:low.sweepAngle,
          length:candidate.length,closure:'open',sourceIds:sourceIds.slice()});
      }
    });
    return {records:records,issues:issues,consumedIds:Array.from(consumed)};
  }
  // Share frame validation and inference with the oblique primitive stage.
  function resolveProfileFrame(entities, options) {
    options = options || {};
    var ink = entities.filter(function(e) {return e && !helper(e);});
    var frames = ink.filter(function(e) {return e.meta && e.meta.draftingLayout;}).map(function(e) {return e.meta.draftingLayout;});
    if (options.profile) frames.push(options.profile);
    var inferredProfile = false;
    if (!frames.length) {
      var inferred = inferProfileFrame(ink);
      if (inferred) {frames.push(inferred); inferredProfile = true;}
    }
    var profile = frames[0], frameIssue = null;
    if (profile && (!Number.isFinite(profile.xRef) || !Number.isFinite(profile.dRef) || (profile.s !== 1 && profile.s !== -1))) {
      frameIssue = {code:'profile-frame-invalid',message:'The side-view frame needs finite xRef/dRef and direction +1 or -1.'}; profile = null;
    }
    if (profile && frames.some(function(f) {return f.xRef!==profile.xRef || f.dRef!==profile.dRef || f.s!==profile.s;})) {
      frameIssue = {code:'profile-frame-conflict',message:'The declared side-view coordinate frames disagree.'}; profile = null;
    }
    return {profile:profile || null, issue:frameIssue, inferred:inferredProfile};
  }
  // Principal views are coordinate observations. Rotate each view pair into
  // one canonical two-view problem, then transform the inferred primitives
  // back. This reuses the same curve and ruled-patch construction for all axes.
  function reconstruct(entities, options) {
    options = options || {};
    var ink = entities.filter(function(e) {return e && !helper(e);});
    var resolved = resolveProfileFrame(entities,options);
    var profile=resolved.profile, frameIssue=resolved.issue, inferredProfile=resolved.inferred;
    var pairs = [{roles:['PLAN','ELEVATION'], maps:[function(x,y) {return [x,y];},function(x,y) {return [x,y];}],world:function(p) {return {x:p.x,y:p.y,z:p.z};}, reflected:false}];
    if (profile) {
      var depth = function(x) {return profile.dRef+profile.s*(x-profile.xRef);};
      pairs.push({roles:['PLAN','PROFILE'],maps:[function(x,y) {return [-y,-x];},function(x,y) {return [depth(x),y];}],world:function(p) {return {x:p.z,y:p.y,z:p.x};},reflected:true});
      pairs.push({roles:['ELEVATION','PROFILE'],maps:[function(x,y) {return [y,-x];},function(x,y) {return [y,depth(x)];}],world:function(p) {return {x:p.z,y:p.x,z:p.y};},reflected:false});
    }
    function transformEntity(e,pair) {
      var which=pair.roles.indexOf(e.viewRole);
      if(which<0) return null;
      var map=pair.maps[which], origin=map(0,0), ux=map(1,0),uy=map(0,1);
      var q=Object.assign({},e),a=map(e.x,e.y),b=map(e.x2,e.y2);
      q.x=a[0];q.y=a[1];q.x2=b[0];q.y2=b[1];q.viewRole=which===0?'PLAN':'ELEVATION';
      if(isCurve(e)) {
        var m00=ux[0]-origin[0],m10=ux[1]-origin[1],m01=uy[0]-origin[0],m11=uy[1]-origin[1];
        function transformAngle(deg) {var t=deg*Math.PI/180;return Math.atan2(m10*Math.cos(t)+m11*Math.sin(t),m00*Math.cos(t)+m01*Math.sin(t))*180/Math.PI;}
        q.startAngle=transformAngle(e.startAngle);q.endAngle=transformAngle(e.endAngle);
        if(m00*m11-m01*m10<0) {var swap=q.startAngle;q.startAngle=q.endAngle;q.endAngle=swap;}
      }
      return q;
    }
    var used=new Set(), curvesIn=ink.filter(isCurve), sourceById=new Map(ink.map(function(e) {return [e.id,e];}));
    var geometry={name:'primitive surface',vertices:[],edges:[],faces:[],curves:[],spheres:[],surfacePatches:[],smoothSideFaces:[],recesses:[]};
    var selectedIssues=[], explanations=new Map(), ambiguousSources=new Set();
    function sourceKey(e) {
      function r(v) {return Math.round(v*1e6)/1e6;}
      return [e.type,e.viewRole,r(e.x),r(e.y),r(e.radius),
        e.type==='CIRCLE'?0:r(e.startAngle),e.type==='CIRCLE'?0:r(e.endAngle)].join('|');
    }
    // Sphere silhouettes are consumed before paired curve lifting so the same
    // circles are not also reported as missing edge-on projections.
    inferSpheres(ink,profile).forEach(function(s) {
      var mesh=sphereMesh(s.center,s.radius), vo=geometry.vertices.length, eo=geometry.edges.length, fo=geometry.faces.length;
      geometry.vertices=geometry.vertices.concat(mesh.vertices);
      geometry.edges=geometry.edges.concat(mesh.edges.map(function(e) {return e.map(function(v) {return v+vo;});}));
      geometry.faces=geometry.faces.concat(mesh.faces.map(function(f) {return f.map(function(v) {return v+vo;});}));
      var indices=mesh.faces.map(function(_,i) {return i+fo;});
      geometry.smoothSideFaces=geometry.smoothSideFaces.concat(indices);
      geometry.spheres.push({center:s.center,radius:s.radius,sourceIds:s.sourceIds.slice()});
      geometry.surfacePatches.push({kind:'sphere',center:s.center,radius:s.radius,
        sourceIds:s.sourceIds.slice(),faceIndices:indices});
      s.sourceIds.forEach(function(id) {used.add(id);});
    });
    // A full mouth circle plus a cap-silhouette arc determines a spherical
    // recess. This runs before paired curve lifting so the same primitives are
    // not also reported as unrelated circles/arcs.
    inferRecesses(ink,used,geometry).issues.forEach(function(issue) {selectedIssues.push(issue);});
    // A cylindrical recess needs the surrounding-face frame and the edge-on
    // depth strokes; this runs after the spherical pass so a mouth/arc pair is
    // not consumed by the wrong surface family.
    inferCylindricalRecesses(ink,used,geometry).issues.forEach(function(issue) {selectedIssues.push(issue);});
    function project(p,role) {
      return role==='PLAN'?[p.x,-p.z]:role==='ELEVATION'?[p.x,p.y]:[profile.xRef+profile.s*(p.z-profile.dRef),p.y];
    }
    // A planar curve is edge-on in a principal view only when both projected
    // basis vectors are collinear. The returned span includes arc extrema so
    // the evidence check does not depend on display sampling.
    function projectedSpan(c,role) {
      var center=project(c.center,role);
      var u=project({x:c.center.x+c.u.x,y:c.center.y+c.u.y,z:c.center.z+c.u.z},role).map(function(v,i) {return v-center[i];});
      var v=project({x:c.center.x+c.v.x,y:c.center.y+c.v.y,z:c.center.z+c.v.z},role).map(function(v,i) {return v-center[i];});
      if(Math.abs(u[0]*v[1]-u[1]*v[0])>EPS) return null;
      var axis=Math.hypot(u[0],v[0])>EPS?0:1, critical=Math.atan2(v[axis],u[axis]);
      var angles=[c.startAngle,c.startAngle+c.sweepAngle];
      [critical,critical+Math.PI].forEach(function(t) {if(angle(t-c.startAngle)<=c.sweepAngle+EPS) angles.push(t);});
      var points=angles.map(function(t) {return project(point(c,t),role);});
      points.sort(function(a,b) {return a[axis]-b[axis];});
      var a=points[0],b=points[points.length-1],dx=b[0]-a[0],dy=b[1]-a[1],len=dx*dx+dy*dy;
      if(len<EPS*EPS) return null;
      return {a:a,b:b,dx:dx,dy:dy,len:len};
    }
    // Treat overlapping and split strokes as one interval set, exactly as an
    // inferred straight edge does. A drawn stroke at the same line either
    // covers the projection or contradicts it; no stroke leaves the view silent.
    function strokeEvidence(role,span) {
      var intervals=[];
      ink.forEach(function(e) {
        if(e.type!=='SEGMENT' || e.viewRole!==role) return;
        if(Math.abs((e.x-span.a[0])*span.dy-(e.y-span.a[1])*span.dx)>EPS*Math.sqrt(span.len) ||
           Math.abs((e.x2-span.a[0])*span.dy-(e.y2-span.a[1])*span.dx)>EPS*Math.sqrt(span.len)) return;
        var ts=[((e.x-span.a[0])*span.dx+(e.y-span.a[1])*span.dy)/span.len,
          ((e.x2-span.a[0])*span.dx+(e.y2-span.a[1])*span.dy)/span.len];
        intervals.push({a:Math.min.apply(null,ts),b:Math.max.apply(null,ts),id:e.id});
      });
      if(!intervals.length) return {state:'absent',intervals:intervals};
      intervals.sort(function(a,b) {return a.a-b.a;});
      var reach=0;
      intervals.forEach(function(i) {if(i.a<=reach+EPS) reach=Math.max(reach,i.b);});
      return {state:reach>=1-EPS?'covered':'contradicted',intervals:intervals};
    }
    function worldCurve(pair,c) {
      return {kind:c.kind,center:pair.world(c.center),u:pair.world(c.u),v:pair.world(c.v),
        radius:c.radius,startAngle:c.startAngle,sweepAngle:c.sweepAngle};
    }
    // Score a pair interpretation against every declared view. A third view
    // can distinguish real curve levels from the cross product of two
    // overlapping two-view matches; silent views do not vote against a curve.
    function candidateSupport(pair,result) {
      var support={covered:0,contradicted:0,curves:0};
      if(!result.geometry) return support;
      result.geometry.curves.forEach(function(c) {
        support.curves++;
        var w=worldCurve(pair,c);
        ['PLAN','ELEVATION','PROFILE'].forEach(function(role) {
          if(role==='PROFILE' && !profile) return;
          var span=projectedSpan(w,role);
          if(!span) return;
          var evidence=strokeEvidence(role,span);
          if(evidence.state==='covered') support.covered++;
          else if(evidence.state==='contradicted') support.contradicted++;
        });
      });
      return support;
    }
    // Select supported groups; never reconstruct the same source curve twice
    // merely because it is corroborated by a third view. When two pairs explain
    // the same source curves, prefer the one that no other view contradicts,
    // then the one with more corroboration and fewer speculative instances.
    while(true) {
      var candidates=pairs.map(function(pair) {
        var rows=ink.filter(function(e) {return !isCurve(e) || !used.has(e.id);}).map(function(e) {return transformEntity(e,pair);}).filter(Boolean);
        var result=reconstructPair(rows);
        result.issues.forEach(function(issue) {if(!explanations.has(issue.entityId)) explanations.set(issue.entityId,issue);});
        var count=result.consumedIds.filter(function(id) {return sourceById.has(id) && isCurve(sourceById.get(id));}).length;
        return {pair:pair,result:result,count:count,support:candidateSupport(pair,result)};
      }).filter(function(c) {return c.count>0;});
      candidates.sort(function(a,b) {
        return b.count-a.count ||
          a.support.contradicted-b.support.contradicted ||
          b.support.covered-a.support.covered ||
          a.support.curves-b.support.curves ||
          b.result.consumedIds.length-a.result.consumedIds.length;
      });
      if(!candidates.length) break;
      var choice=candidates[0],g=choice.result.geometry,pair=choice.pair;
      var vo=geometry.vertices.length,eo=geometry.edges.length,fo=geometry.faces.length,co=geometry.curves.length;
      geometry.vertices=geometry.vertices.concat(g.vertices.map(pair.world));
      geometry.edges=geometry.edges.concat(g.edges.map(function(e) {return e.map(function(v) {return v+vo;});}));
      geometry.faces=geometry.faces.concat(g.faces.map(function(f) {var loop=f.map(function(v) {return v+vo;});return pair.reflected?loop.reverse():loop;}));
      geometry.curves=geometry.curves.concat(g.curves.map(function(c) {
        var original=sourceById.get(c.sourceIds[0]);
        return Object.assign({},c,{center:pair.world(c.center),u:pair.world(c.u),v:pair.world(c.v),sourceView:original.viewRole,
          framePair:pair.roles.slice(),displayVertices:c.displayVertices.map(function(v) {return v+vo;}),displayEdges:c.displayEdges.map(function(e) {return e+eo;})});
      }));
      geometry.surfacePatches=geometry.surfacePatches.concat(g.surfacePatches.map(function(p) {
        var patch=Object.assign({},p,{boundaryCurves:p.boundaryCurves.map(function(i) {return i+co;}),faceIndices:p.faceIndices.map(function(i) {return i+fo;})});
        ['origin','center','apex','axis','normal','u','v'].forEach(function(key) {
          if(p[key]) patch[key]=pair.world(p[key]);
        });
        return patch;
      }));
      geometry.smoothSideFaces=geometry.smoothSideFaces.concat(g.smoothSideFaces.map(function(i) {return i+fo;}));
      choice.result.consumedIds.forEach(function(id) {used.add(id);});
      choice.result.issues.filter(function(i) {
        return ['curve-surface-ambiguous','curve-surface-missing','curve-projection-ambiguous','curve-inclined-arc-unsupported'].indexOf(i.code)!==-1;
      }).forEach(function(i) {selectedIssues.push(i);});
      // Several distinct source projections each yielding several levels is the
      // cross-product ambiguity left when no third view selects a pairing.
      var sourceGroups=new Map();
      g.curves.forEach(function(c) {
        var ids=c.sourceIds.filter(function(id) {var e=sourceById.get(id);return e && isCurve(e);});
        if(!ids.length) return;
        var key=Array.from(new Set(ids.map(function(id) {return sourceKey(sourceById.get(id));}))).sort().join(';');
        var group=sourceGroups.get(key);
        if(!group) {group={count:0,id:ids[0]};sourceGroups.set(key,group);}
        group.count++;
      });
      var multiplied=Array.from(sourceGroups.values()).filter(function(group) {return group.count>1;});
      if(multiplied.length>1) multiplied.forEach(function(group) {
        if(ambiguousSources.has(group.id)) return;
        ambiguousSources.add(group.id);
        selectedIssues.push({code:'curve-projection-ambiguous',entityId:group.id,
          message:'Several curves share this projected extent; add a third view to select the matching level.'});
      });
    }
    // Validate extra edge-on observations analytically, including vertical
    // side-view strokes and arc extrema that fall between display samples.
    geometry.curves.forEach(function(c) {
      ['PLAN','ELEVATION','PROFILE'].forEach(function(role) {
        if(role==='PROFILE' && !profile) return;
        var span=projectedSpan(c,role);
        if(!span) return;
        var evidence=strokeEvidence(role,span);
        if(evidence.state!=='covered') return;
        evidence.intervals.forEach(function(i) {
          if(i.a>=-EPS && i.b<=1+EPS) {used.add(i.id);if(c.sourceIds.indexOf(i.id)===-1) c.sourceIds.push(i.id);}
        });
      });
    });
    // A cylindrical fillet needs two coaxial cross-section arcs, a tangent
    // face edge at each arc endpoint and matching generator edges in the paired
    // view. This runs after curve lifting, so the end arcs already exist.
    var fillets=inferCylindricalFillets(geometry,ink,used,profile);
    fillets.issues.forEach(function(issue) {selectedIssues.push(issue);});
    var issues=selectedIssues.slice();
    if(frameIssue) issues.push(frameIssue);
    if(!profile && ink.some(function(e) {return e.viewRole==='PROFILE';}) && !frameIssue) {
      issues.push({code:'profile-frame-missing',message:'Set the side-view coordinate frame with /profile xRef dRef s.'});
    }
    ink.forEach(function(e) {
      if(used.has(e.id)) return;
      if(isCurve(e)) issues.push(explanations.get(e.id) || {code:'curve-projection-missing',entityId:e.id,message:'Needs a corresponding projection in another declared view.'});
      else if(e.type==='SEGMENT') issues.push({code:'unresolved-edge',entityId:e.id,message:'This stroke is not yet explained by reconstructed boundaries and surfaces.'});
    });
    geometry.profileMap=profile || null;
    if(profile && inferredProfile) geometry.profileInferred=true;
    return {geometry:geometry.vertices.length?geometry:null,issues:issues,consumedIds:Array.from(used),
      unresolvedIds:ink.filter(function(e) {return (isCurve(e)||e.type==='SEGMENT') && !used.has(e.id);}).map(function(e) {return e.id;})};
  }
  // ---- Bounded cones over inclined circular boundaries ----
  // A circle in a general plane projects to an ellipse in a principal view.
  // Two straight silhouette strokes tangent to that projection and meeting at
  // a common point locate the projected apex. The 3D apex is then the point on
  // the base circle's plane normal that projects to it. This is the same
  // surface family as the coaxial cone path, but the tangency and apex are
  // derived from the actual projected conic instead of center.x +/- radius.
  function cvNormal(c) {return cvUnit(cross(c.u,c.v));}
  function sheetPoint(p,role,profile) {
    if(role==='PLAN') return {x:p.x,y:-p.z};
    if(role==='ELEVATION') return {x:p.x,y:p.y};
    if(role==='PROFILE'&&profile) return {x:profile.xRef+profile.s*(p.z-profile.dRef),y:p.y};
    return null;
  }
  function sheetVector(v,role,profile) {
    if(role==='PLAN') return {x:v.x,y:-v.z};
    if(role==='ELEVATION') return {x:v.x,y:v.y};
    if(role==='PROFILE'&&profile) return {x:profile.s*v.z,y:v.y};
    return null;
  }
  function curveRadii(c) {
    return {u:c.radiusU===undefined?c.radius:c.radiusU,v:c.radiusV===undefined?c.radius:c.radiusV};
  }
  function anglePoint(c,a) {
    var start=c.startAngle||0,sweep=c.sweepAngle===undefined?TAU:c.sweepAngle;
    return Parametric.point(c,sweep?((a-start)/sweep):0);
  }
  function projectedConic(c,role,profile) {
    var center=sheetPoint(c.center,role,profile),ru=sheetVector(c.u,role,profile),rv=sheetVector(c.v,role,profile);
    if(!center||!ru||!rv) return null;
    var radii=curveRadii(c);
    return {center:center,u:{x:ru.x*radii.u,y:ru.y*radii.u},v:{x:rv.x*radii.v,y:rv.y*radii.v}};
  }
  function coneTolerance(c) {
    var radii=curveRadii(c);
    return Math.max(0.75,0.01*Math.max(radii.u,radii.v));
  }
  // A line is tangent to x(t)=center+u*cos(t)+v*sin(t) exactly when its
  // signed support at the centre equals the conic's support in that normal
  // direction. Solving that sinusoid gives the tangency station on the drawn
  // boundary, including the degenerate line projection of an edge-on circle.
  function segmentTangency(conic,segment,tol) {
    var dx=segment.x2-segment.x,dy=segment.y2-segment.y,len=Math.hypot(dx,dy);
    if(len<EPS) return null;
    var a=-dy/len,b=dx/len,c=-(a*segment.x+b*segment.y);
    var d0=a*conic.center.x+b*conic.center.y+c;
    var A=a*conic.u.x+b*conic.u.y,B=a*conic.v.x+b*conic.v.y,rho=Math.hypot(A,B);
    if(rho<EPS||Math.abs(Math.abs(d0)-rho)>tol) return null;
    var t=Math.atan2(-d0*B,-d0*A);
    return {t:t};
  }
  function lineIntersection(a,b) {
    var dx1=a.x2-a.x,dy1=a.y2-a.y,dx2=b.x2-b.x,dy2=b.y2-b.y;
    var den=dx1*dy2-dy1*dx2,scale=Math.hypot(dx1,dy1)*Math.hypot(dx2,dy2);
    if(Math.abs(den)<=1e-9*scale) return null;
    var t=((b.x-a.x)*dy2-(b.y-a.y)*dx2)/den;
    return {x:a.x+t*dx1,y:a.y+t*dy1};
  }
  // Accept split/overlapping strokes along the same tangent. The union must
  // start at the tangency station and reach the common apex station.
  function tangentStrokeEvidence(segments,role,from,to,tol) {
    var dx=to.x-from.x,dy=to.y-from.y,len2=dx*dx+dy*dy;
    if(len2<EPS*EPS) return [];
    var len=Math.sqrt(len2),slack=tol/len,intervals=[];
    segments.forEach(function(s) {
      if(viewOf(s)!==role) return;
      if(Math.abs((s.x-from.x)*dy-(s.y-from.y)*dx)/len>tol) return;
      if(Math.abs((s.x2-from.x)*dy-(s.y2-from.y)*dx)/len>tol) return;
      var a=((s.x-from.x)*dx+(s.y-from.y)*dy)/len2;
      var b=((s.x2-from.x)*dx+(s.y2-from.y)*dy)/len2;
      intervals.push({a:Math.min(a,b),b:Math.max(a,b),id:s.id});
    });
    if(!intervals.length) return [];
    intervals.sort(function(a,b) {return a.a-b.a;});
    var reach=0,ids=[],first=Infinity;
    intervals.forEach(function(i) {
      if(i.a<=reach+1e-6) {reach=Math.max(reach,i.b);ids.push(i.id);first=Math.min(first,i.a);}
    });
    if(first>slack||reach<1-slack) return [];
    return Array.from(new Set(ids));
  }
  // The base plane normal is the only direction a right circular cone's apex
  // can lie along. Intersect that line with the view's projection ray.
  function solveConeApex(c,role,projected,profile,tol) {
    var normal=cvNormal(c);
    if(!normal) return {state:'invalid'};
    var fixed=[];
    if(role==='PLAN') fixed=[{axis:'x',value:projected.x},{axis:'z',value:-projected.y}];
    else if(role==='ELEVATION') fixed=[{axis:'x',value:projected.x},{axis:'y',value:projected.y}];
    else if(role==='PROFILE'&&profile&&profile.s) {
      fixed=[{axis:'y',value:projected.y},{axis:'z',value:profile.dRef+(projected.x-profile.xRef)/profile.s}];
    } else return {state:'invalid'};
    var best=null;
    fixed.forEach(function(f) {
      var coef=normal[f.axis];
      if(Math.abs(coef)>1e-6&&(!best||Math.abs(coef)>Math.abs(best.coef))) best={axis:f.axis,coef:coef};
    });
    if(!best) {
      // The normal is parallel to this view's projection ray. If the ray is
      // the normal line itself the apex height is genuinely open; a distinct
      // parallel ray cannot contain any right-cone apex.
      var centerOnSheet=sheetPoint(c.center,role,profile);
      if(centerOnSheet&&Math.hypot(centerOnSheet.x-projected.x,centerOnSheet.y-projected.y)<=tol)
        return {state:'undetermined'};
      return {state:'conflict',residual:Infinity};
    }
    var t=(fixed.find(function(f) {return f.axis===best.axis;}).value-c.center[best.axis])/best.coef;
    var residual=0;
    fixed.forEach(function(f) {residual=Math.max(residual,Math.abs(c.center[f.axis]+t*normal[f.axis]-f.value));});
    if(residual>tol) return {state:'conflict',residual:residual};
    if(Math.abs(t)*Math.hypot(normal.x,normal.y,normal.z)<tol) return {state:'degenerate'};
    return {state:'ok',apex:add(c.center,mul(normal,t)),t:t};
  }
  function candidateConeApices(c,segments,profile) {
    var tol=coneTolerance(c),out=[];
    ['PLAN','ELEVATION','PROFILE'].forEach(function(role) {
      if(role==='PROFILE'&&!profile) return;
      var conic=projectedConic(c,role,profile);
      if(!conic) return;
      var viewSegments=segments.filter(function(s) {return viewOf(s)===role;});
      var tangents=[];
      viewSegments.forEach(function(s) {
        var tg=segmentTangency(conic,s,tol);
        if(!tg) return;
        var p3=anglePoint(c,tg.t),p2=sheetPoint(p3,role,profile);
        if(!p2) return;
        tg.segment=s;tg.projected=p2;
        tangents.push(tg);
      });
      for(var i=0;i<tangents.length;i++) for(var j=i+1;j<tangents.length;j++) {
        var a=tangents[i],b=tangents[j];
        if(Math.hypot(a.projected.x-b.projected.x,a.projected.y-b.projected.y)<=tol) continue;
        var apex2=lineIntersection(a.segment,b.segment);
        if(!apex2) continue;
        var left=tangentStrokeEvidence(viewSegments,role,a.projected,apex2,tol);
        var right=tangentStrokeEvidence(viewSegments,role,b.projected,apex2,tol);
        if(!left.length||!right.length) continue;
        var candidate={role:role,point:apex2,ids:Array.from(new Set(left.concat(right)))};
        var duplicate=out.find(function(q) {return q.role===role&&Math.hypot(q.point.x-apex2.x,q.point.y-apex2.y)<=tol;});
        if(duplicate) duplicate.ids=Array.from(new Set(duplicate.ids.concat(candidate.ids)));
        else out.push(candidate);
      }
    });
    return out;
  }
  function addInferredCone(geometry,ci,apex,sourceIds) {
    var c=geometry.curves[ci],normal=cvNormal(c);
    if(!normal||!c.displayVertices||c.displayVertices.length<3) return false;
    var height=dot(sub(apex,c.center),normal);
    if(Math.abs(height)<EPS) return false;
    var positive=height>0,apexIndex=geometry.vertices.length;
    geometry.vertices.push({x:apex.x,y:apex.y,z:apex.z});
    var faceIndices=[];
    for(var i=0;i<c.displayVertices.length;i++) {
      var j=(i+1)%c.displayVertices.length,a=c.displayVertices[i],b=c.displayVertices[j];
      var loop=[a,b,apexIndex];
      if(!positive) loop.reverse();
      geometry.edges.push([a,apexIndex]);
      faceIndices.push(geometry.faces.length);
      geometry.smoothSideFaces.push(geometry.faces.length);
      geometry.faces.push(loop);
    }
    var cap=c.displayVertices.slice();
    if(positive) cap.reverse();
    var capIndex=geometry.faces.length;
    geometry.faces.push(cap);
    var axis=cvUnit(sub(apex,c.center));
    geometry.surfacePatches.push({kind:'cone',analyticKind:'cone',axis:axis,origin:c.center,
      radius:c.radius,halfAngle:Math.atan2(c.radius,Math.abs(height)),
      boundaryCurves:[ci],apex:{x:apex.x,y:apex.y,z:apex.z},faceIndices:faceIndices,
      sourceIds:sourceIds.slice()});
    geometry.surfacePatches.push({kind:'plane',boundaryCurves:[ci],faceIndices:[capIndex],
      sourceIds:c.sourceIds.slice()});
    return true;
  }
  // Public surface-inference stage for curves that were lifted by the oblique
  // kernel. It mutates the geometry and returns consumed stroke IDs and
  // specific diagnostics. A boundary with no tangent-pair evidence is left as
  // a standalone planar boundary rather than promoted to a guessed cone.
  function inferBoundedCones(geometry,entities,profile) {
    if(!geometry||!Array.isArray(geometry.curves)||!geometry.curves.length) return {consumedIds:[],issues:[]};
    var issues=[],consumed=new Set();
    geometry.surfacePatches=geometry.surfacePatches||[];
    geometry.smoothSideFaces=geometry.smoothSideFaces||[];
    var bound=new Set();
    geometry.surfacePatches.forEach(function(p) {
      (p.boundaryCurves||[]).forEach(function(i) {bound.add(i);});
    });
    var boundarySources=new Set();
    geometry.curves.forEach(function(c) {
      (c.sourceIds||[]).forEach(function(id) {boundarySources.add(id);});
    });
    var segments=(entities||[]).filter(function(e) {
      return e&&e.type==='SEGMENT'&&!helper(e)&&!boundarySources.has(e.id);
    });
    geometry.curves.forEach(function(c,ci) {
      if(bound.has(ci)||c.kind!=='circle') return;
      var sweep=c.sweepAngle===undefined?TAU:c.sweepAngle;
      if(Math.abs(sweep-TAU)>1e-6) return;
      var candidates=candidateConeApices(c,segments,profile);
      if(!candidates.length) return;
      candidates.forEach(function(candidate) {candidate.ids.forEach(function(id) {consumed.add(id);});});
      var tol=coneTolerance(c),determined=[],conflict=false;
      candidates.forEach(function(candidate) {
        var solved=solveConeApex(c,candidate.role,candidate.point,profile,tol);
        if(solved.state==='ok') {
          var duplicate=determined.find(function(q) {return Math.hypot(q.apex.x-solved.apex.x,q.apex.y-solved.apex.y,q.apex.z-solved.apex.z)<=tol;});
          if(!duplicate) determined.push({apex:solved.apex,candidate:candidate});
        } else if(solved.state==='conflict') conflict=true;
      });
      var entityId=(c.sourceIds||[])[0];
      function report(code,message) {issues.push({code:code,entityId:entityId,message:message});}
      if(determined.length>1) {
        report('cone-apex-ambiguous','Distinct tangent-generator pairs support different apices; the cone is unresolved.');
        return;
      }
      if(!determined.length) {
        if(conflict) report('cone-apex-conflict','The tangent generators do not meet the base circle\'s plane normal; an oblique cone is not supported.');
        else report('cone-apex-undetermined','The tangent generators leave the apex position along the base normal undetermined.');
        return;
      }
      var apex=determined[0].apex,mismatch=null,evidence=[];
      candidates.forEach(function(candidate) {
        evidence=Array.from(new Set(evidence.concat(candidate.ids)));
        if(mismatch) return;
        var projected=sheetPoint(apex,candidate.role,profile);
        if(!projected||Math.hypot(projected.x-candidate.point.x,projected.y-candidate.point.y)>tol) mismatch=candidate;
      });
      if(mismatch) {
        report('cone-apex-conflict','Generator evidence in the declared views does not agree on one apex for this base boundary.');
        return;
      }
      if(addInferredCone(geometry,ci,apex,evidence)) bound.add(ci);
    });
    return {consumedIds:Array.from(consumed),issues:issues};
  }
  return { reconstruct:reconstruct, point:point, isCurve:isCurve, resolveProfileFrame:resolveProfileFrame,
    inferBoundedCones:inferBoundedCones };
});

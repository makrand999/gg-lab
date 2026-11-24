(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-parametric.js'), require('./educad-vec3.js'), require('./educad-cavity-boolean.js'));
  else root.EduCADCurveReconstruct = factory(root.EduCADParametric, root.EduCADVec3, root.EduCADCavityBoolean);
})(typeof window !== 'undefined' ? window : globalThis, function (Parametric, Vec3, CavityBoolean) {
  'use strict';




  var TAU = 2 * Math.PI, EPS = 1e-6, SAMPLES = 24;
  function near(a, b) { return Math.abs(a - b) <= EPS; }


  var add = Vec3.add, sub = Vec3.sub, mul = Vec3.mul, dot = Vec3.dot, cross = Vec3.cross;


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



    function slantedRuns(role) {
      var rows = [];
      function sameLine(a, b) {
        var ax=a.x2-a.x, ay=a.y2-a.y, bx=b.x2-b.x, by=b.y2-b.y;
        var la=Math.hypot(ax,ay), lb=Math.hypot(bx,by), scale=Math.max(1,la,lb);
        if (la<=EPS || lb<=EPS) return false;
        if (Math.abs(ax*by-ay*bx) > 1e-6*la*lb) return false;
        var d1=Math.abs(ax*(b.y-a.y)-ay*(b.x-a.x))/la;
        var d2=Math.abs(ax*(b.y2-a.y)-ay*(b.x2-a.x))/la;
        return Math.max(d1,d2) <= 1e-6*scale;
      }
      segments.forEach(function (s) {
        if (side(s) !== role || near(s.y, s.y2) || near(s.x, s.x2)) return;
        var m = (s.y2-s.y)/(s.x2-s.x), b = s.y - m*s.x;
        var row = rows.find(function (r) { return sameLine(r.segment,s); });
        if (!row) { row = { m:m, b:b, segment:s, intervals: [] }; rows.push(row); }
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

      var dx=x2-x1,dy=y2-y1,length=Math.hypot(dx,dy), candidates=[];
      if(length<EPS) return [];
      segments.forEach(function(s) {
        if(side(s)!==view) return;
        var a=((s.x-x1)*dx+(s.y-y1)*dy)/(length*length), b=((s.x2-x1)*dx+(s.y2-y1)*dy)/(length*length);
        if(Math.abs((s.x-x1)*dy-(s.y-y1)*dx)/length>EPS || Math.abs((s.x2-x1)*dy-(s.y2-y1)*dx)/length>EPS) return;

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


    function generatorPoint(c, positive) {
      var p=point(c,positive?c.startAngle:c.startAngle+Math.PI);
      return c.sourceView==='PLAN'?{x:p.x,y:p.y}:{x:p.x,y:-p.z};
    }
    var bound = new Set();



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



    curves.forEach(function(c) {
      if (c.inclinedTrace && !bound.has(c)) issue('curve-surface-missing', {id:c.sourceIds[0]},
        'An inclined boundary has no supporting generators; the connecting surface is unresolved.');
    });


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







  function principalFrame(role,profile) {
    if(role==='PLAN') return {role:'PLAN',free:'y',u:{x:1,y:0,z:0},v:{x:0,y:0,z:-1},
      normal:{x:0,y:1,z:0},
      to3D:function(u,v,free) {return {x:u,y:free,z:-v};},
      project:function(p) {return {x:p.x,y:-p.z};}};
    if(role==='ELEVATION') return {role:'ELEVATION',free:'z',u:{x:1,y:0,z:0},v:{x:0,y:1,z:0},
      normal:{x:0,y:0,z:1},
      to3D:function(u,v,free) {return {x:u,y:v,z:free};},
      project:function(p) {return {x:p.x,y:p.y};}};
    if(role==='PROFILE' && profile) return {role:'PROFILE',free:'x',u:{x:0,y:0,z:profile.s},v:{x:0,y:1,z:0},
      normal:{x:1,y:0,z:0},
      to3D:function(u,v,free) {return {x:free,y:v,z:profile.dRef+profile.s*(u-profile.xRef)};},
      project:function(p) {return {x:profile.xRef+profile.s*(p.z-profile.dRef),y:p.y};}};
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

  function inferToroidalSurfaces(entities, profile) {
    var ink = entities.filter(function (e) {
      return !helper(e) && e.bisCode !== 'E' && !e.hidden;
    });
    var circles = ink.filter(function (e) { return e.type === 'CIRCLE'; });
    var arcs = ink.filter(function (e) { return e.type === 'CIRCULAR_ARC'; });
    var frames = ['PLAN','ELEVATION','PROFILE'].map(function (role) {
      return principalFrame(role, profile);
    }).filter(Boolean);
    var candidates = [];
    circles.forEach(function (outer) {
      var axial = frames.find(function (frame) { return frame.role === outer.viewRole; });
      if (!axial) return;
      circles.forEach(function (inner) {
        if (inner.viewRole !== outer.viewRole || !near(inner.x, outer.x) ||
            !near(inner.y, outer.y) || outer.radius - inner.radius <= EPS) return;
        var major = (outer.radius + inner.radius) / 2;
        var minor = (outer.radius - inner.radius) / 2;
        var base = axial.to3D(outer.x, outer.y, 0);
        frames.forEach(function (side) {
          if (side === axial) return;
          var sheetAxis = {x:dot(axial.normal, side.u), y:dot(axial.normal, side.v)};
          var sheetRadial = {x:sheetAxis.y, y:-sheetAxis.x};
          var sheetBase = side.project(base);
          function local(p) {
            var x = p.x - sheetBase.x, y = p.y - sheetBase.y;
            return {x:x * sheetRadial.x + y * sheetRadial.y,
              y:x * sheetAxis.x + y * sheetAxis.y};
          }
          function endArc(row, sign) {
            if (row.viewRole !== side.role || !near(row.radius, minor)) return false;
            var span = sheetArcSpan(row);
            if (!near(span.sweep, Math.PI)) return false;
            var center = local(row);
            if (!near(center.x, sign * major)) return false;
            var middle = span.start + Math.PI / 2;
            var midpoint = local({x:row.x + minor * Math.cos(middle),
              y:row.y + minor * Math.sin(middle)});
            return near(midpoint.x, sign * (major + minor)) && near(midpoint.y, center.y);
          }
          function tangentIds(y) {
            var intervals = [];
            ink.forEach(function (row) {
              if (row.type !== 'SEGMENT' || row.viewRole !== side.role) return;
              var a = local(row), b = local({x:row.x2,y:row.y2});
              if (!near(a.y, y) || !near(b.y, y)) return;
              var start = Math.min(a.x, b.x), end = Math.max(a.x, b.x);
              if (start < -major - EPS || end > major + EPS || end - start <= EPS) return;
              intervals.push({start:start, end:end, id:row.id});
            });
            intervals.sort(function (a, b) { return a.start - b.start; });
            var reach = -major, ids = [];
            intervals.forEach(function (interval) {
              if (interval.start > reach + EPS) return;
              reach = Math.max(reach, interval.end);
              ids.push(interval.id);
            });
            return reach >= major - EPS ? ids : [];
          }
          var rightArcs = arcs.filter(function (row) { return endArc(row, 1); });
          arcs.filter(function (row) { return endArc(row, -1); }).forEach(function (left) {
            var station = local(left).y;
            var right = rightArcs.filter(function (row) { return near(local(row).y, station); });
            var low = tangentIds(station - minor), high = tangentIds(station + minor);
            if (!right.length || !low.length || !high.length) return;
            var sources = [outer.id, inner.id, left.id].concat(right.map(function (row) {
              return row.id;
            }), low, high);
            var center = axial.to3D(outer.x, outer.y, station);
            var match = candidates.find(function (candidate) {
              return candidate.rings[0] === outer.id && candidate.rings[1] === inner.id &&
                near(candidate.center.x, center.x) && near(candidate.center.y, center.y) &&
                near(candidate.center.z, center.z);
            });
            if (match) match.sourceIds = Array.from(new Set(match.sourceIds.concat(sources)));
            else candidates.push({kind:'torus', center:center, axis:axial.normal,
              u:axial.u, v:axial.v, majorRadius:major, minorRadius:minor,
              rings:[outer.id, inner.id], sourceIds:sources});
          });
        });
      });
    });
    var issues = [], patches = candidates.filter(function (candidate) {
      var conflicting = candidates.some(function (other) {
        return candidate !== other && candidate.sourceIds.some(function (id) {
          return other.sourceIds.indexOf(id) !== -1;
        });
      });
      if (conflicting) issues.push({code:'toroidal-silhouette-conflict',
        entityId:candidate.rings[0], sourceIds:candidate.sourceIds.slice(),
        message:'The concentric contours and side silhouettes admit conflicting toroidal surfaces.'});
      return !conflicting;
    });
    return {patches:patches, issues:issues, consumedIds:new Set(patches.flatMap(function (patch) {
      return patch.sourceIds;
    }))};
  }

  function addToroidalPatch(geometry, patch) {
    var turns = 32, sections = 16, offset = geometry.vertices.length;
    var faceIndices = [];
    function vertex(i, j) { return offset + (i % turns) * sections + (j % sections); }
    for (var i = 0; i < turns; i++) {
      var u = TAU * i / turns;
      var radial = add(mul(patch.u, Math.cos(u)), mul(patch.v, Math.sin(u)));
      for (var j = 0; j < sections; j++) {
        var v = TAU * j / sections;
        var distance = patch.majorRadius + patch.minorRadius * Math.cos(v);
        geometry.vertices.push(add(patch.center, add(mul(radial, distance),
          mul(patch.axis, patch.minorRadius * Math.sin(v)))));
        var a = vertex(i,j), b = vertex(i + 1,j), c = vertex(i + 1,j + 1), d = vertex(i,j + 1);
        geometry.edges.push([a,b], [a,d]);
        faceIndices.push(geometry.faces.length);
        geometry.faces.push(dot(cross(patch.u, patch.v), patch.axis) > 0 ?
          [a,b,c,d] : [a,d,c,b]);
      }
    }
    geometry.smoothSideFaces.push.apply(geometry.smoothSideFaces, faceIndices);
    geometry.surfacePatches.push({kind:'torus', center:patch.center, axis:patch.axis,
      majorRadius:patch.majorRadius, minorRadius:patch.minorRadius,
      closed:true, sourceIds:patch.sourceIds, faceIndices:faceIndices});
  }



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

    if(Math.abs(op.x-C.x)>tol || Math.abs(op.y-C.y)>tol) return null;
    var span=sheetArcSpan(A);
    if(!(span.sweep>EPS)) return null;
    function at(t) {return {x:A.x+R*Math.cos(t),y:A.y+R*Math.sin(t)};}
    var q1=at(span.start),q2=at(span.start+span.sweep);
    var E1=W.to3D(q1.x,q1.y,O[W.free]),E2=W.to3D(q2.x,q2.y,O[W.free]);
    var mf1=E1[V.free],mf2=E2[V.free];



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
  function addSphericalRecess(geometry,cand,sourceIds,closureIds,closed,volumeIndex) {
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
      faceIndices:faceIndices,sourceIds:sourceIds.slice(),recess:true,
      volumeIndex:volumeIndex,memberRole:'cap'});
    if(closed) geometry.surfacePatches.push({kind:'plane',boundaryCurves:[ci],faceIndices:[],
      closure:'recess-mouth',recessMouth:true,
      sourceIds:[cand.circle.id].concat(closureIds)});
    if(!geometry.recesses) geometry.recesses=[];
    geometry.recesses.push({kind:'spherical',center:cand.center,radius:cand.radius,
      mouth:{center:cand.mouthCenter,normal:cand.outward,radius:cand.mouthRadius},
      depth:cand.depth,capAngle:cand.capAngle,closure:closed?'plane':'open',
      sourceIds:sourceIds.slice(),mouthCurve:ci,surface:sphereIndex});
  }
  function inferRecesses(ink,used,geometry,profile) {
    var issues=[],records=[],resolutions=[],claimed=new Set();
    var circles=ink.filter(function(e) {return e && e.type==='CIRCLE' && !helper(e) &&
      !used.has(e.id) && principalFrame(viewOf(e),profile);});
    var arcs=ink.filter(function(e) {return e && e.type==='CIRCULAR_ARC' && !helper(e) &&
      !used.has(e.id) && principalFrame(viewOf(e),profile);});
    circles.forEach(function(C) {
      if(used.has(C.id)) return;
      var V=principalFrame(viewOf(C),profile),valid=[],conflicts=[];
      arcs.forEach(function(A) {
        if(claimed.has(A.id) || used.has(A.id)) return;
        var W=principalFrame(viewOf(A),profile);
        if(!W || W.role===V.role) return;
        var cand=recessCandidate(C,V,A,W,ink,used);
        if(!cand) return;
        if(cand.conflict) conflicts.push({C:C,A:A,message:cand.conflict});
        else valid.push(cand);
      });
      if(valid.length&&conflicts.length) {
        issues.push({code:'recess-evidence-conflict',entityId:C.id,
          message:conflicts[0].message,sourceIds:[C.id].concat(conflicts.map(function(c){return c.A.id;}))});
        return;
      }
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
      resolutions.push({kind:'spherical',cand:cand,sourceIds:sourceIds,
        closureIds:group.closureIds.slice(),closed:group.closure,index:resolutions.length});
      sourceIds.forEach(function(id) {used.add(id);claimed.add(id);});
      records.push({kind:'spherical',center:cand.center,radius:cand.radius,
        mouthCenter:cand.mouthCenter,mouthRadius:cand.mouthRadius,depth:cand.depth,
        closure:group.closure?'plane':'open',sourceIds:sourceIds.slice()});
    });
    return {records:records,issues:issues,resolutions:resolutions};
  }









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
  function cylindricalRecessEvidence(C,V,ink,used,W) {
    var a=C.radius;
    if(!(a>EPS) || !frameAroundMouth(ink,V.role,C.x,C.y,a)) return null;
    if(!W) return null;



    var origin=W.project(V.to3D(C.x,C.y,0)),unit=W.project(V.to3D(C.x,C.y,1));
    var dx=unit.x-origin.x,dy=unit.y-origin.y,len=Math.hypot(dx,dy);
    if(len<EPS) return null;
    var depthDirection={x:dx/len,y:dy/len},across={x:dy/len,y:-dx/len};
    function local(x,y) {return {x:x*across.x+y*across.y,y:x*depthDirection.x+y*depthDirection.y};}
    var center=local(origin.x,origin.y),projectedInk=ink.map(function(e) {
      if(viewOf(e)!==W.role) return e;
      var p=local(e.x,e.y),q=local(e.x2,e.y2);
      return Object.assign({},e,{x:p.x,y:p.y,x2:q.x,y2:q.y});
    });
    var tol=1e-4*Math.max(1,a),spanMin=center.x-a,spanMax=center.x+a;
    var hRows=recessRuns(projectedInk,W.role,true,used),vRows=recessRuns(projectedInk,W.role,false,used);
    var full=[];
    hRows.forEach(function(row) {
      row.intervals.forEach(function(r) {
        if(r.min<=spanMin+EPS && r.max>=spanMax-EPS) {
          var exactIds=r.items.filter(function(item) {
            return near(item.min,spanMin)&&near(item.max,spanMax);
          }).map(function(item) {return item.id;});
          var hostCover=r.items.some(function(item) {
            return item.min<=spanMin+EPS && item.max>=spanMax-EPS &&
              (item.min<spanMin-EPS || item.max>spanMax+EPS);
          });
          full.push({station:row.key,min:r.min,max:r.max,
            exact:near(r.min,spanMin)&&near(r.max,spanMax),
            sourceExact:exactIds.length>0,
            exactIds:Array.from(new Set(exactIds)),
            cover:r.min<spanMin-EPS || r.max>spanMax+EPS,
            hostCover:hostCover,ids:r.ids});
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
    var linked=null;
    var centerId=C.meta&&C.meta.centerRef;
    if(centerId) {
      var centerPoint=ink.filter(function(e) {return e.id===centerId;})[0];
      var memberIds=centerPoint&&centerPoint.meta&&Array.isArray(centerPoint.meta.members)?
        centerPoint.meta.members.map(function(m) {return m.id;}):[];
      if(memberIds.length) linked=ink.filter(function(e) {
        return e && e.type==='POINT' && viewOf(e)===W.role && e.meta && Array.isArray(e.meta.members) &&
          e.meta.members.some(function(m) {return memberIds.indexOf(m.id)!==-1;});
      });
    }
    var linkedStations=[];
    if(linked) linked.forEach(function(p) {
      var q=local(p.x,p.y);
      if(near(q.x,center.x)) linkedStations.push(q.y);
    });
    var candidates=[],conflicts=[];
    unique.forEach(function(span) {
      var depth=span.hi-span.lo;
      if(!(depth>tol)) return;
      var loRun=runAt(span.lo),hiRun=runAt(span.hi);
      var loMerged=!!(loRun&&loRun.exact),hiMerged=!!(hiRun&&hiRun.exact);
      var loSource=!!(loRun&&loRun.sourceExact),hiSource=!!(hiRun&&hiRun.sourceExact);
      var loBoundary=!!(loRun&&loRun.hostCover),hiBoundary=!!(hiRun&&hiRun.hostCover);
      var loCover=!!(loRun&&loRun.cover),hiCover=!!(hiRun&&hiRun.cover);
      var mouthStation,bottomStation,bottomRun,mouthRun,closedMouth=false,mouthIsLo=null;
      if(loBoundary!==hiBoundary) mouthIsLo=loBoundary;
      else if(loMerged!==hiMerged) mouthIsLo=hiMerged;
      else if(loSource!==hiSource) mouthIsLo=hiSource;
      else if(loCover!==hiCover) mouthIsLo=loCover;
      if(mouthIsLo===null&&linkedStations.length) {
        var loLinked=linkedStations.some(function(station) {return near(station,span.lo);});
        var hiLinked=linkedStations.some(function(station) {return near(station,span.hi);});
        if(loLinked!==hiLinked) mouthIsLo=loLinked;
      }
      if(mouthIsLo===null) {
        if(loMerged&&hiMerged) return;
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
      bottomRun=mouthIsLo?hiRun:loRun;
      if(!(bottomRun&&(bottomRun.sourceExact||bottomRun.exact))) {
        conflicts.push(bottomRun?'The bottom edge does not span the mouth diameter.':
          'The depth strokes end without an exact bottom edge; the flat bottom is unresolved.');
        return;
      }
      bottomStation=mouthIsLo?span.hi:span.lo;
      mouthStation=mouthIsLo?span.lo:span.hi;
      mouthRun=mouthIsLo?loRun:hiRun;
      closedMouth=!!(mouthRun&&mouthRun.exactIds.length);

      full.forEach(function(r) {
        if(r.station<=span.lo+tol || r.station>=span.hi-tol) return;
        if(r.sourceExact || r.exact)
          conflicts.push('A bottom edge lies inside the depth strokes at another level.');
      });

      hRows.forEach(function(row) {
        row.intervals.forEach(function(r) {
          if(!near(row.key,bottomStation)) return;
          var overlaps=r.max>=spanMin-EPS && r.min<=spanMax+EPS;
          var covers=r.min<=spanMin+EPS && r.max>=spanMax-EPS;
          if(overlaps && !covers)
            conflicts.push('The bottom edge does not span the mouth diameter.');
        });
      });
      candidates.push({span:span,mouthStation:mouthStation,bottomStation:bottomStation,
        mouthRun:mouthRun,bottomRun:bottomRun,closedMouth:closedMouth,
        mouthFree:(mouthStation-center.y)/len,bottomFree:(bottomStation-center.y)/len});
    });
    if(linked&&linked.length) {
      var fixed=[];
      candidates.forEach(function(cand) {
        if(linked.every(function(p) {
          var q=local(p.x,p.y);
          return near(q.x,center.x)&&near(q.y,cand.mouthStation);
        })) fixed.push(cand);
      });
      if(fixed.length) candidates=fixed;
      else if(candidates.length) return {conflict:'The linked centre station does not agree with any depth-stroke mouth level for this mouth circle.'};
    }
    if(conflicts.length) return {conflict:conflicts[0]};
    if(candidates.length>1) return {candidates:candidates,ambiguous:'Several depth-stroke spans fit this mouth circle; the recess depth is unresolved.'};
    if(!candidates.length) return {missing:'The depth strokes do not bound a consistent flat-bottomed cavity.'};
    var only=candidates[0];
    return {candidates:candidates,candidate:only,mouthFree:only.mouthFree,bottomFree:only.bottomFree};
  }
  function axialRecessMesh(M,axis,depth,topRadius,bottomRadius,u,v,lon,through) {
    var vertices=[],faces=[],edges=[],edgeMap=new Map();
    var bottom=add(M,mul(axis,depth)),topRing=[],bottomRing=[],apexIndex=null;
    var hasBottom=bottomRadius>EPS;
    for(var j=0;j<lon;j++) {
      var t=TAU*j/lon,radial=add(mul(u,Math.cos(t)*topRadius),mul(v,Math.sin(t)*topRadius));
      topRing.push(vertices.length);vertices.push(add(M,radial));
      if(hasBottom) {
        var lower=add(mul(u,Math.cos(t)*bottomRadius),mul(v,Math.sin(t)*bottomRadius));
        bottomRing.push(vertices.length);vertices.push(add(bottom,lower));
      }
    }
    if(!hasBottom) {apexIndex=vertices.length;vertices.push(bottom);}
    function edge(i,j) {
      var key=i<j?i+'_'+j:j+'_'+i;
      if(!edgeMap.has(key)) {edgeMap.set(key,edges.length);edges.push([i,j]);}
      return edgeMap.get(key);
    }
    var topEdges=[],bottomEdges=[],sideFaces=[];
    for(var j=0;j<lon;j++) topEdges.push(edge(topRing[j],topRing[(j+1)%lon]));
    if(hasBottom) for(var j=0;j<lon;j++) bottomEdges.push(edge(bottomRing[j],bottomRing[(j+1)%lon]));
    for(var j=0;j<lon;j++) {
      var j2=(j+1)%lon;
      var loop=hasBottom?[topRing[j],topRing[j2],bottomRing[j2],bottomRing[j]]:
        [topRing[j],topRing[j2],apexIndex];
      var p0=vertices[loop[0]],p1=vertices[loop[1]],p2=vertices[loop[2]];
      var n=cross(sub(p1,p0),sub(p2,p0));
      var centroid={x:0,y:0,z:0};
      loop.forEach(function(index) {
        var p=vertices[index];
        centroid.x+=p.x/loop.length;centroid.y+=p.y/loop.length;centroid.z+=p.z/loop.length;
      });
      var along=dot(sub(centroid,M),axis);
      var radial=sub(sub(centroid,M),mul(axis,along));
      if(dot(n,radial)>0) loop.reverse();
      sideFaces.push(faces.length);faces.push(loop);
      if(hasBottom) edge(bottomRing[j],topRing[j]);
      else edge(topRing[j],apexIndex);
    }
    var bottomFace=null;
    if(hasBottom&&!through) {bottomFace=faces.length;faces.push(bottomRing.slice());}
    return {vertices:vertices,faces:faces,edges:edges,topRing:topRing,
      bottomRing:bottomRing,apex:apexIndex,topEdges:topEdges,
      bottomEdges:bottomEdges,sideFaces:sideFaces,bottomFace:bottomFace};
  }
  function cylinderRecessMesh(M,axis,depth,a,u,v,lon) {
    return axialRecessMesh(M,axis,depth,a,a,u,v,lon,true);
  }
  function addCylindricalRecess(geometry,cand,sourceIds,mouthIds,bottomIds,closedMouth,volumeIndex) {
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
      faceIndices:sideFaceIndices,sourceIds:sourceIds.slice(),recess:true,
      volumeIndex:volumeIndex,memberRole:'side'});
    geometry.surfacePatches.push({kind:'plane',boundaryCurves:[bottomCi],faceIndices:[bottomFaceIndex],
      closure:'recess-bottom',recessBottom:true,sourceIds:[cand.circle.id].concat(bottomIds),
      volumeIndex:volumeIndex,memberRole:'bottom'});
    if(closedMouth) geometry.surfacePatches.push({kind:'plane',boundaryCurves:[mouthCi],
      faceIndices:[],closure:'recess-mouth',recessMouth:true,
      sourceIds:[cand.circle.id].concat(mouthIds)});
    if(!geometry.recesses) geometry.recesses=[];
    geometry.recesses.push({kind:'cylindrical',mouth:{center:cand.mouthCenter,normal:cand.outward,radius:cand.radius},
      axis:cand.axis,depth:cand.depth,bottom:{center:cand.bottomCenter,radius:cand.radius},
      closure:closedMouth?'plane':'open',bottomClosure:'plane',sourceIds:sourceIds.slice(),
      mouthCurve:mouthCi,bottomCurve:bottomCi,surface:cylinderIndex});
  }
  function coneRecessMesh(M,axis,depth,a,b,u,v,lon,through) {
    return axialRecessMesh(M,axis,depth,a,b,u,v,lon,through===true);
  }
  function coneGeometry(radius,bottomRadius,depth,axis) {
    var difference=bottomRadius-radius;
    var scale=Math.max(1,Math.abs(radius),Math.abs(bottomRadius));
    var slope=depth>EPS?difference/depth:0;
    if(Math.abs(difference)<=1e-9*scale)
      return {apexOffset:0,halfAngle:0,slope:0,zeroSlope:true};
    var apexOffset=-radius/slope;
    return {apexOffset:apexOffset,halfAngle:Math.atan2(radius,Math.abs(apexOffset)),
      slope:slope,zeroSlope:false};
  }
  function addTaperedRecess(geometry,cand,sourceIds,mouthIds,bottomIds,ringIds,closedMouth,volumeIndex) {
    var a=cand.radius,rb=cand.bottomRadius;
    var openBottom=cand.bottomClosure==='open';
    var mesh=coneRecessMesh(cand.mouthCenter,cand.axis,cand.depth,a,rb,cand.u,cand.v,
      SAMPLES,cand.through||openBottom);
    var vo=geometry.vertices.length,eo=geometry.edges.length,fo=geometry.faces.length;
    geometry.vertices=geometry.vertices.concat(mesh.vertices);
    geometry.edges=geometry.edges.concat(mesh.edges.map(function(e) {return [e[0]+vo,e[1]+vo];}));
    geometry.faces=geometry.faces.concat(mesh.faces.map(function(f) {return f.map(function(v) {return v+vo;});}));
    var sideFaceIndices=mesh.sideFaces.map(function(i) {return i+fo;});
    geometry.smoothSideFaces=geometry.smoothSideFaces.concat(sideFaceIndices);
    var mouthCi=geometry.curves.length;
    geometry.curves.push({kind:'circle',center:cand.mouthCenter,u:cand.u,v:cand.v,radius:a,
      startAngle:0,sweepAngle:TAU,sourceIds:[cand.circle.id].concat(mouthIds),
      sourceView:cand.view.role,recessMouth:true,
      displayVertices:mesh.topRing.map(function(v) {return v+vo;}),
      displayEdges:mesh.topEdges.map(function(e) {return e+eo;})});
    var bottomCi=null;
    if(rb>EPS) {
      bottomCi=geometry.curves.length;
      geometry.curves.push({kind:'circle',center:cand.bottomCenter,u:cand.u,v:cand.v,radius:rb,
        startAngle:0,sweepAngle:TAU,sourceIds:[cand.circle.id].concat(bottomIds,ringIds),
        sourceView:cand.view.role,recessBottom:true,
        recessMouth:cand.through?true:undefined,throughOpening:cand.through?true:undefined,
        displayVertices:mesh.bottomRing.map(function(v) {return v+vo;}),
        displayEdges:mesh.bottomEdges.map(function(e) {return e+eo;})});
    }
    var analytic=coneGeometry(a,rb,cand.depth,cand.axis);
    var apex=add(cand.mouthCenter,mul(cand.axis,analytic.apexOffset));
    var coneIndex=geometry.surfacePatches.length;
    geometry.surfacePatches.push({kind:'cone',analyticKind:'cone',origin:cand.mouthCenter,
      axis:cand.axis,radius:a,bottomRadius:rb,apex:apex,halfAngle:analytic.halfAngle,
      boundaryCurves:bottomCi===null?[mouthCi]:[mouthCi,bottomCi],
      faceIndices:sideFaceIndices,sourceIds:sourceIds.slice(),recess:true,
      volumeIndex:volumeIndex,memberRole:'side'});
    if(bottomCi!==null&&!cand.through&&!openBottom) geometry.surfacePatches.push({kind:'plane',
      boundaryCurves:[bottomCi],faceIndices:[mesh.bottomFace+fo],closure:'recess-bottom',
      recessBottom:true,sourceIds:[cand.circle.id].concat(bottomIds,ringIds),
      volumeIndex:volumeIndex,memberRole:'bottom'});
    else if(bottomCi!==null&&cand.through) geometry.surfacePatches.push({kind:'plane',
      boundaryCurves:[bottomCi],faceIndices:[],closure:'recess-mouth',recessMouth:true,
      recessBottom:true,throughOpening:true,
      sourceIds:[cand.circle.id].concat(bottomIds,ringIds),
      volumeIndex:volumeIndex,memberRole:'bottom'});
    if(closedMouth) geometry.surfacePatches.push({kind:'plane',boundaryCurves:[mouthCi],
      faceIndices:[],closure:'recess-mouth',recessMouth:true,
      sourceIds:[cand.circle.id].concat(mouthIds)});
    if(!geometry.recesses) geometry.recesses=[];
    geometry.recesses.push({kind:'conical',mouth:{center:cand.mouthCenter,normal:cand.outward,
      radius:a},axis:cand.axis,depth:cand.depth,bottom:{center:cand.bottomCenter,
      radius:rb},apex:rb>EPS?null:{x:apex.x,y:apex.y,z:apex.z},
      taper:analytic.slope,through:cand.through,
      throughCandidate:cand.throughCandidate===true,volumeIndex:volumeIndex,
      floorEvidence:cand.floorEvidence||null,
      closure:closedMouth?'plane':'open',
      bottomClosure:cand.bottomClosure||(cand.through?'through':openBottom?'open':'plane'),
      sourceIds:sourceIds.slice(),mouthCurve:mouthCi,bottomCurve:bottomCi,surface:coneIndex});
  }

  function inferCylindricalRecesses(ink,used,geometry,profile,skip) {
    var issues=[],records=[],claimed=new Set(),resolutions=[];
    var evidenceBlocked=new Set(used);
    skip=skip||new Set();
    function sameCandidate(a,b) {return near(a.mouthFree,b.mouthFree)&&near(a.bottomFree,b.bottomFree);}
    var circles=ink.filter(function(e) {
      return e && e.type==='CIRCLE' && !helper(e) && !used.has(e.id) && !skip.has(e.id) &&
        principalFrame(viewOf(e),profile);
    });
    circles.forEach(function(C) {
      if(used.has(C.id)||claimed.has(C.id)) return;
      var V=principalFrame(viewOf(C),profile);
      var observations=['PLAN','ELEVATION','PROFILE'].filter(function(role){return role!==V.role;}).map(function(role) {
        return cylindricalRecessEvidence(C,V,ink,evidenceBlocked,principalFrame(role,profile));
      }).filter(Boolean);
      var conflicting=observations.find(function(e){return e.conflict;});
      if(conflicting) {
        issues.push({code:'recess-depth-conflict',entityId:C.id,message:conflicting.conflict});
        return;
      }
      var sets=observations.map(function(o){return o.candidates||(o.candidate?[o.candidate]:[]);}).filter(function(set){return set.length;});
      var chosen=null,ambig=null;
      if(sets.length) {
        var common=sets[0].slice();
        sets.slice(1).forEach(function(set) {
          common=common.filter(function(c) {return set.some(function(d) {return sameCandidate(c,d);});});
        });
        if(common.length===1) chosen=common[0];
        else if(common.length>1) ambig='Several depth-stroke spans fit this mouth circle; the recess depth is unresolved.';
        else ambig='The paired views support different mouth or bottom levels; constrain the recess depth.';
      }
      if(!chosen) {
        var missing=observations.find(function(e){return e.missing;});
        var ambiguous=observations.find(function(e){return e.ambiguous;});
        if(missing) issues.push({code:'recess-depth-missing',entityId:C.id,message:missing.missing});
        else if(ambig||ambiguous) issues.push({code:'recess-depth-ambiguous',entityId:C.id,
          message:ambig||ambiguous.ambiguous});
        return;
      }
      var matched=observations.map(function(o) {
        return (o.candidates||[]).filter(function(c) {return sameCandidate(c,chosen);})[0];
      }).filter(Boolean);
      var cand=matched[0]||chosen,a=C.radius;
      var freeDelta=cand.bottomFree-cand.mouthFree;
      if(Math.abs(freeDelta)<=1e-6*Math.max(1,a)) return;
      var axis=mul(V.normal,freeDelta>0?1:-1),outward=mul(axis,-1);
      var u=V.u,v=V.v;
      if(dot(cross(u,v),outward)<0) v=mul(v,-1);
      var mouthCenter=V.to3D(C.x,C.y,cand.mouthFree);
      var resolved={circle:C,view:V,mouthCenter:mouthCenter,radius:a,axis:axis,outward:outward,
        depth:Math.abs(freeDelta),bottomCenter:add(mouthCenter,mul(axis,Math.abs(freeDelta))),
        u:u,v:v,mouthRun:cand.mouthRun,bottomRun:cand.bottomRun,span:cand.span};
      var mouthIds=cand.mouthRun&&cand.closedMouth?cand.mouthRun.exactIds.slice():[];
      var bottomIds=cand.bottomRun.exactIds.length?cand.bottomRun.exactIds.slice():cand.bottomRun.ids.slice();
      var sourceIds=Array.from(new Set([C.id].concat(cand.mouthRun?cand.mouthRun.ids:[],bottomIds,
        cand.span.left.ids,cand.span.right.ids)));
      var consumed=Array.from(new Set([C.id].concat(mouthIds,bottomIds,cand.span.left.ids,cand.span.right.ids)));
      matched.forEach(function(other) {
        var oMouth=other.mouthRun?other.mouthRun.exactIds:[],
          oBottom=other.bottomRun?(other.bottomRun.exactIds.length?other.bottomRun.exactIds:other.bottomRun.ids):[],
          oSides=other.span.left.ids.concat(other.span.right.ids);
        sourceIds=sourceIds.concat(other.mouthRun?other.mouthRun.ids:[],oBottom,oSides);
        consumed=consumed.concat(other.closedMouth?oMouth:[],oBottom,oSides);
      });
      sourceIds=Array.from(new Set(sourceIds));consumed=Array.from(new Set(consumed));
      resolutions.push({C:C,cand:cand,resolved:resolved,sourceIds:sourceIds,consumed:consumed,
        mouthIds:mouthIds,bottomIds:bottomIds});
    });
    resolutions.forEach(function(item) {
      var cand=item.cand;
      if(!cand.closedMouth) issues.push({code:'recess-mouth-unclosed',entityId:item.C.id,
        message:'The cylindrical recess is determined, but no exact mouth stroke closes it; the cavity is retained open.'});
      item.consumed.forEach(function(id) {used.add(id);claimed.add(id);});
      item.kind='cylindrical';
      records.push({kind:'cylindrical',mouthCenter:item.resolved.mouthCenter,mouthRadius:item.resolved.radius,
        axis:item.resolved.axis,depth:item.resolved.depth,bottomCenter:item.resolved.bottomCenter,
        closure:cand.closedMouth?'plane':'open',bottomClosure:'plane',sourceIds:item.sourceIds.slice()});
    });
    return {records:records,issues:issues,resolutions:resolutions};
  }

  function taperedRecessEvidence(C,V,ink,used,W,profile) {
    if(!W||W.role===V.role) return null;
    var a=C.radius;
    if(!(a>EPS)||!frameAroundMouth(ink,V.role,C.x,C.y,a)) return null;
    var origin=W.project(V.to3D(C.x,C.y,0)),unit=W.project(V.to3D(C.x,C.y,1));
    var dx=unit.x-origin.x,dy=unit.y-origin.y,len=Math.hypot(dx,dy);
    if(len<EPS) return null;
    var depthDirection={x:dx/len,y:dy/len},across={x:dy/len,y:-dx/len};
    function local(x,y) {return {x:x*across.x+y*across.y,y:x*depthDirection.x+y*depthDirection.y};}
    var center=local(origin.x,origin.y);
    var tol=1e-4*Math.max(1,a);
    var projectedInk=ink.map(function(e) {
      if(viewOf(e)!==W.role) return e;
      var p=local(e.x,e.y),q=local(e.x2,e.y2);
      return Object.assign({},e,{x:p.x,y:p.y,x2:q.x,y2:q.y});
    });
    var hRows=recessRuns(projectedInk,W.role,true,used),runs=[];
    hRows.forEach(function(row) {
      row.intervals.forEach(function(r) {
        runs.push({station:row.key,min:r.min,max:r.max,ids:r.ids.slice(),
          items:(r.items||[]).slice()});
      });
    });
    function spanIds(station,radius) {
      var ids=[];
      runs.forEach(function(run) {
        if(!near(run.station,station)) return;
        run.items.forEach(function(item) {
          if(near(item.min,center.x-radius)&&near(item.max,center.x+radius)) ids.push(item.id);
        });
      });
      return Array.from(new Set(ids));
    }
    function hostCover(station,radius) {
      return runs.some(function(run) {
        return near(run.station,station) &&
          run.min<=center.x-radius+tol&&run.max>=center.x+radius-tol&&
          (run.min<center.x-radius-tol||run.max>center.x+radius+tol);
      });
    }
    function hostComponentExtent(excluded) {
      var segments=[];
      ink.forEach(function(s) {
        if(!s||s.type!=='SEGMENT'||viewOf(s)!==W.role||helper(s)||excluded.has(s.id)) return;
        var p=local(s.x,s.y),q=local(s.x2,s.y2);
        segments.push({id:s.id,p:p,q:q,min:Math.min(p.x,q.x),max:Math.max(p.x,q.x)});
      });
      if(!segments.length) return null;
      var parent=segments.map(function(_,i) {return i;});
      function find(i) {while(parent[i]!==i) {parent[i]=parent[parent[i]];i=parent[i];} return i;}
      function unite(a,b) {a=find(a);b=find(b);if(a!==b)parent[b]=a;}
      function pointSegment(p,a,b) {
        var dx=b.x-a.x,dy=b.y-a.y,l2=dx*dx+dy*dy;
        var t=l2>0?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l2)):0;
        return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=tol;
      }
      for(var i=0;i<segments.length;i++) for(var j=i+1;j<segments.length;j++) {
        var segA=segments[i],segB=segments[j];
        if(near(segA.p.x,segB.p.x)&&near(segA.p.y,segB.p.y)||
           near(segA.p.x,segB.q.x)&&near(segA.p.y,segB.q.y)||
           near(segA.q.x,segB.p.x)&&near(segA.q.y,segB.p.y)||
           near(segA.q.x,segB.q.x)&&near(segA.q.y,segB.q.y)||
           pointSegment(segA.p,segB.p,segB.q)||pointSegment(segA.q,segB.p,segB.q)||
           pointSegment(segB.p,segA.p,segA.q)||pointSegment(segB.q,segA.p,segA.q)) unite(i,j);
      }
      var seeds=[];
      segments.forEach(function(s,i) {
        if(near(s.p.y,mouthStation)&&near(s.q.y,mouthStation)&&
           s.min<=center.x-a+tol&&s.max>=center.x+a-tol) seeds.push(i);
      });
      if(!seeds.length) return null;
      var root=find(seeds[0]),stations=[];
      segments.forEach(function(s,i) {
        if(find(i)!==root) return;
        stations.push(s.p.y,s.q.y);
      });
      if(!stations.length) return null;
      return {min:Math.min.apply(null,stations),max:Math.max.apply(null,stations)};
    }

    var linked=null,centerId=C.meta&&C.meta.centerRef;
    if(centerId) {
      var centerPoint=ink.filter(function(e) {return e.id===centerId;})[0];
      var memberIds=centerPoint&&centerPoint.meta&&Array.isArray(centerPoint.meta.members)?
        centerPoint.meta.members.map(function(m) {return m.id;}):[];
      if(memberIds.length) linked=ink.filter(function(e) {
        return e && e.type==='POINT' && viewOf(e)===W.role && e.meta && Array.isArray(e.meta.members) &&
          e.meta.members.some(function(m) {return memberIds.indexOf(m.id)!==-1;});
      });
    }
    var linkedStations=[];
    if(linked) linked.forEach(function(p) {
      var q=local(p.x,p.y);
      if(near(q.x,center.x)) linkedStations.push(q.y);
    });
    var rawSlanted=[];
    ink.forEach(function(s) {
      if(!s||s.type!=='SEGMENT'||viewOf(s)!==W.role||used.has(s.id)||helper(s)) return;
      var p=local(s.x,s.y),q=local(s.x2,s.y2);
      if(near(p.y,q.y)||near(p.x,q.x)) return;
      rawSlanted.push({id:s.id,p:p,q:q});
    });
    var lineGroups=[];
    rawSlanted.forEach(function(seg) {
      var dx=seg.q.x-seg.p.x;
      if(Math.abs(dx)<=EPS) return;
      var m=(seg.q.y-seg.p.y)/dx,b=seg.p.y-m*seg.p.x;
      var group=lineGroups.find(function(g) {
        return Math.abs(g.m-m)<=1e-6*(1+Math.abs(g.m))&&
          Math.abs(g.b-b)<=1e-6*Math.max(1,Math.abs(g.m),Math.abs(g.b));
      });
      if(!group) {group={m:m,b:b,intervals:[]};lineGroups.push(group);}
      group.intervals.push({min:Math.min(seg.p.x,seg.q.x),max:Math.max(seg.p.x,seg.q.x),ids:[seg.id]});
    });
    var slanted=[];
    lineGroups.forEach(function(group) {
      group.intervals.sort(function(a,b) {return a.min-b.min||a.max-b.max;});
      var merged=[];
      group.intervals.forEach(function(interval) {
        var last=merged[merged.length-1];
        if(last&&interval.min<=last.max+tol) {
          last.max=Math.max(last.max,interval.max);
          last.ids=Array.from(new Set(last.ids.concat(interval.ids)));
        } else merged.push({min:interval.min,max:interval.max,ids:interval.ids.slice()});
      });
      merged.forEach(function(interval) {
        slanted.push({id:interval.ids[0],ids:interval.ids.slice(),
          p:{x:interval.min,y:group.m*interval.min+group.b},
          q:{x:interval.max,y:group.m*interval.max+group.b}});
      });
    });
    function mirror(p) {return {x:2*center.x-p.x,y:p.y};}
    function samePoint(p,q) {return near(p.x,q.x)&&near(p.y,q.y);}
    function mouthEnd(seg) {
      var ends=[seg.p,seg.q];
      var atMouth=ends.filter(function(p) {return Math.abs(Math.abs(p.x-center.x)-a)<=tol;});
      if(atMouth.length!==1) return null;
      var mouth=atMouth[0],other=ends[0]===mouth?ends[1]:ends[0];
      return {mouth:mouth,other:other};
    }
    function inverseLocal(p) {
      return {x:p.x*across.x+p.y*depthDirection.x,
        y:p.x*across.y+p.y*depthDirection.y};
    }
    function pointMembers(p) {
      return ((p.meta||{}).members||[]).map(function(m) {return m.id;});
    }
    function linkedEndpoint(localPoint,free,mouthFree,radius,isMouth) {
      var worldPoints=ink.filter(function(e) {
        if(!e||e.type!=='POINT'||viewOf(e)!==W.role) return false;
        var p=local(e.x,e.y);
        return near(p.x,localPoint.x)&&near(p.y,localPoint.y);
      });
      var memberIds=new Set();
      worldPoints.forEach(function(p) {
        pointMembers(p).forEach(function(id) {memberIds.add(id);});
      });
      if(!memberIds.size) return null;
      var matePoints=[];
      ink.forEach(function(P) {
        if(!P||P.type!=='POINT'||viewOf(P)===W.role) return;
        if(!P.meta||!Array.isArray(P.meta.members)) return;
        if(!P.meta.members.some(function(m) {return memberIds.has(m.id);})) return;
        var RP=principalFrame(viewOf(P),profile);
        if(!RP) return;
        var p3=RP.to3D(P.x,P.y,free);
        var projected=W.project(p3),lp=local(projected.x,projected.y);
        if(!near(lp.x,localPoint.x)||!near(lp.y,localPoint.y)) return;
        if(!matePoints.some(function(q) {
          return near(q.x,p3.x)&&near(q.y,p3.y)&&near(q.z,p3.z);
        })) matePoints.push(p3);
      });
      if(!matePoints.length) return null;
      if(matePoints.length>1)
        return {conflict:'Linked observations for a generator endpoint do not agree.'};
      var freeDelta=free-mouthFree;
      var axis=mul(V.normal,freeDelta>0?1:-1);
      var M=V.to3D(C.x,C.y,mouthFree);
      function acrossAt(p3) {return local(W.project(p3).x,W.project(p3).y).x;}
      var au=acrossAt(add(M,mul(V.u,a)))-center.x;
      var av=acrossAt(add(M,mul(V.v,a)))-center.x;
      var angle=Math.atan2(av,au);
      var radial=cvUnit(add(mul(V.u,Math.cos(angle)),mul(V.v,Math.sin(angle))));
      var sign=localPoint.x>=center.x?1:-1;
      var nominal=isMouth?add(M,mul(radial,a*sign)):
        add(add(M,mul(axis,Math.abs(freeDelta))),mul(radial,radius*sign));
      var residual=Math.hypot(matePoints[0].x-nominal.x,
        matePoints[0].y-nominal.y,matePoints[0].z-nominal.z);
      if(residual>tol) return {unsupported:isMouth?
        {code:'recess-taper-mouth-conflict',
          message:'A linked mouth boundary point does not match the stated mouth circle.'}:
        radius<=EPS?
        {code:'recess-taper-axis-unsupported',
          message:'The linked apex identity implies an oblique cone; only axial linear-radius cavities are supported.'}:
        {code:'recess-taper-bottom-conflict',
          message:'A linked lower boundary point does not match the generator bottom circle.'}};
      return {point:matePoints[0]};
    }
    var nearMouth=false;
    slanted.forEach(function(seg) {
      [seg.p,seg.q].forEach(function(p) {
        if(Math.abs(Math.abs(p.x-center.x)-a)<=tol&&spanIds(p.y,a).length) nearMouth=true;
      });
    });
    var candidates=[],conflicts=[];
    for(var i=0;i<slanted.length;i++) for(var j=i+1;j<slanted.length;j++) {
      var A=slanted[i],B=slanted[j];
      var direct=samePoint(mirror(A.p),B.p)&&samePoint(mirror(A.q),B.q);
      var swapped=samePoint(mirror(A.p),B.q)&&samePoint(mirror(A.q),B.p);
      if(!direct&&!swapped) continue;
      var ea=mouthEnd(A),eb=mouthEnd(B);
      if(!ea||!eb) continue;
      if(!near(ea.mouth.y,eb.mouth.y)||!near(ea.other.y,eb.other.y)) continue;
      if(!near(Math.abs(ea.other.x-center.x),Math.abs(eb.other.x-center.x))) continue;
      var mouthStation=(ea.mouth.y+eb.mouth.y)/2;
      var bottomStation=(ea.other.y+eb.other.y)/2;
      var bottomRadius=(Math.abs(ea.other.x-center.x)+Math.abs(eb.other.x-center.x))/2;
      if(!(Math.abs(bottomStation-mouthStation)>tol)) continue;
      if(Math.abs(bottomRadius-a)<=tol) continue;
      var mouthIds=spanIds(mouthStation,a);
      if(!mouthIds.length||!hostCover(mouthStation,a)) continue;
      if(linkedStations.length&&!linkedStations.some(function(station) {return near(station,mouthStation);})) {
        conflicts.push('The linked mouth centre does not agree with the generator mouth level.');
        continue;
      }
      var bottomIds=spanIds(bottomStation,bottomRadius);
      var excludedStrokes=new Set(A.ids.concat(B.ids,mouthIds,bottomIds));
      var hostExtent=hostComponentExtent(excludedStrokes);
      var through=bottomRadius>EPS&&hostCover(bottomStation,bottomRadius)&&
        !!hostExtent&&(near(bottomStation,hostExtent.min)||near(bottomStation,hostExtent.max));
      if(bottomRadius>EPS&&!through&&!bottomIds.length) {
        var mismatched=runs.some(function(run) {
          return near(run.station,bottomStation)&&
            run.max>center.x-bottomRadius+tol&&run.min<center.x+bottomRadius-tol;
        });
        if(mismatched) {
          conflicts.push('The bottom edge at this level does not match the generator radius.');
          continue;
        }
      }
      var mouthFree=(mouthStation-center.y)/len,bottomFree=(bottomStation-center.y)/len;
      var linkedChecks=[
        linkedEndpoint(ea.mouth,mouthFree,mouthFree,a,true),
        linkedEndpoint(eb.mouth,mouthFree,mouthFree,a,true),
        linkedEndpoint(ea.other,bottomFree,mouthFree,bottomRadius,false),
        linkedEndpoint(eb.other,bottomFree,mouthFree,bottomRadius,false)
      ];
      var linkedProblem=linkedChecks.find(function(check) {
        return check&&(check.conflict||check.unsupported);
      });
      if(linkedProblem) {
        if(linkedProblem.unsupported) return {unsupported:linkedProblem.unsupported};
        conflicts.push(linkedProblem.conflict);
        continue;
      }
      var duplicate=candidates.find(function(c) {
        return near(c.mouthFree,mouthFree)&&near(c.bottomFree,bottomFree)&&
          near(c.bottomRadius,bottomRadius);
      });
      var candidate={mouthFree:mouthFree,bottomFree:bottomFree,bottomRadius:bottomRadius,
        through:through,mouthStation:mouthStation,bottomStation:bottomStation,
        mouthIds:mouthIds,bottomIds:bottomIds,generatorIds:A.ids.concat(B.ids)};
      if(duplicate) duplicate.generatorIds=Array.from(new Set(duplicate.generatorIds.concat(candidate.generatorIds)));
      else candidates.push(candidate);
    }
    if(candidates.length>1) {
      var unique=[];
      candidates.forEach(function(c) {
        if(!unique.some(function(u) {
          return near(u.mouthFree,c.mouthFree)&&near(u.bottomFree,c.bottomFree)&&
            near(u.bottomRadius,c.bottomRadius);
        })) unique.push(c);
      });
      if(unique.length>1)
        return {ambiguous:'Several generator pairs fit this mouth circle with different linear-radius profiles; the tapered cavity is unresolved.'};
      candidates=unique;
    }
    if(!candidates.length) {
      if(conflicts.length) return {conflict:conflicts[0]};
      if(nearMouth)
        return {conflict:'The generator strokes at the mouth do not form a symmetric linear-radius wall about the mouth axis.'};
      return null;
    }
    return {candidate:candidates[0],candidates:candidates};
  }

  function inferTaperedRecesses(ink,used,geometry,profile) {
    var issues=[],records=[],claimed=new Set(),resolutions=[],blocked=new Set();
    function sameCandidate(a,b) {
      return near(a.mouthFree,b.mouthFree)&&near(a.bottomFree,b.bottomFree)&&
        near(a.bottomRadius,b.bottomRadius);
    }
    var circles=ink.filter(function(e) {
      return e && e.type==='CIRCLE' && !helper(e) && !used.has(e.id) &&
        principalFrame(viewOf(e),profile);
    });
    circles.forEach(function(C) {
      if(used.has(C.id)||claimed.has(C.id)) return;
      var V=principalFrame(viewOf(C),profile);
      var roles=['PLAN','ELEVATION','PROFILE'].filter(function(role) {return role!==V.role;});
      var observations=roles.map(function(role) {
        return taperedRecessEvidence(C,V,ink,used,principalFrame(role,profile),profile);
      }).filter(Boolean);
      var unsupported=observations.find(function(e) {return e.unsupported;});
      if(unsupported) {
        issues.push({code:unsupported.unsupported.code,entityId:C.id,
          message:unsupported.unsupported.message});
        blocked.add(C.id);
        return;
      }
      var conflicting=observations.find(function(e) {return e.conflict;});
      if(conflicting) {
        issues.push({code:'recess-taper-conflict',entityId:C.id,message:conflicting.conflict});
        blocked.add(C.id);
        return;
      }
      var sets=observations.map(function(o) {return o.candidates||(o.candidate?[o.candidate]:[]);})
        .filter(function(set) {return set.length;});
      var chosen=null,ambig=null,crossConflict=false;
      if(sets.length) {
        var common=sets[0].slice();
        sets.slice(1).forEach(function(set) {
          common=common.filter(function(c) {return set.some(function(d) {return sameCandidate(c,d);});});
        });
        if(common.length===1) chosen=common[0];
        else if(common.length>1) ambig='Several generator pairs fit this mouth circle; the tapered cavity is unresolved.';
        else crossConflict=true;
      }
      if(!chosen) {
        var ambiguous=observations.find(function(e) {return e.ambiguous;});
        if(crossConflict) {
          issues.push({code:'recess-taper-conflict',entityId:C.id,
            message:'The paired views support different tapered profiles for this mouth circle.'});
          blocked.add(C.id);
        } else if(ambig||ambiguous) {
          issues.push({code:'recess-taper-ambiguous',entityId:C.id,message:ambig||ambiguous.ambiguous});
          blocked.add(C.id);
        }
        return;
      }
      var a=C.radius;
      var freeDelta=chosen.bottomFree-chosen.mouthFree;
      if(Math.abs(freeDelta)<=1e-6*Math.max(1,a)) return;
      var axis=mul(V.normal,freeDelta>0?1:-1),outward=mul(axis,-1);
      var u=V.u,v=V.v;
      if(dot(cross(u,v),outward)<0) v=mul(v,-1);
      var mouthCenter=V.to3D(C.x,C.y,chosen.mouthFree);
      var bottomCenter=V.to3D(C.x,C.y,chosen.bottomFree);
      var ring=null;
      ink.forEach(function(R) {
        if(!R||R.type!=='CIRCLE'||R.id===C.id||used.has(R.id)||claimed.has(R.id)||helper(R)) return;
        var RV=principalFrame(viewOf(R),profile);
        if(!RV) return;
        var projected=RV.project(bottomCenter);
        if(!near(projected.x,R.x)||!near(projected.y,R.y)) return;
        if(!near(R.radius,chosen.bottomRadius)) return;
        ring=R;
      });
      var through=chosen.through;
      var throughValues=[];
      sets.forEach(function(set) {
        set.forEach(function(candidate) {
          if(sameCandidate(candidate,chosen)) throughValues.push(candidate.through);
        });
      });
      if(throughValues.length&&throughValues.some(Boolean)) through=true;
      var floorEvidence=chosen.bottomRadius<=EPS?'apex':
        chosen.bottomIds.length||ring?'plane':'open';
      var bottomClosure=through?'through':floorEvidence;
      if(bottomClosure==='open')
        issues.push({code:'recess-bottom-unclosed',entityId:C.id,
          message:'The tapered wall is determined, but no bottom edge or lower boundary circle fixes the floor; the bottom is retained open.'});
      var resolved={circle:C,view:V,mouthCenter:mouthCenter,radius:a,bottomCenter:bottomCenter,
        bottomRadius:chosen.bottomRadius,axis:axis,outward:outward,depth:Math.abs(freeDelta),
        u:u,v:v,through:through,throughCandidate:through,bottomClosure:bottomClosure,
        floorEvidence:floorEvidence};
      var sourceIds=Array.from(new Set([C.id].concat(chosen.generatorIds,chosen.mouthIds,
        chosen.bottomIds,ring?[ring.id]:[])));
      var consumed=sourceIds.slice();
      resolutions.push({kind:'conical',C:C,cand:chosen,resolved:resolved,sourceIds:sourceIds,
        consumed:consumed,mouthIds:chosen.mouthIds,bottomIds:chosen.bottomIds,
        ringIds:ring?[ring.id]:[]});
      sourceIds.forEach(function(id) {used.add(id);claimed.add(id);});
      records.push({kind:'conical',mouthCenter:mouthCenter,mouthRadius:a,
        bottomCenter:bottomCenter,bottomRadius:chosen.bottomRadius,axis:axis,
        depth:Math.abs(freeDelta),through:through,throughCandidate:through,
        closure:'plane',bottomClosure:bottomClosure,
        sourceIds:sourceIds.slice()});
    });
    return {records:records,issues:issues,resolutions:resolutions,blocked:blocked};
  }

  function cavityVolumeOf(resolution) {
    if(resolution.kind==='cylindrical') {
      var r=resolution.resolved;
      return {kind:'cylinder',index:resolution.index,origin:r.mouthCenter,axis:r.axis,
        radius:r.radius,depth:r.depth,outward:r.outward,mouthCenter:r.mouthCenter,
        bottomCenter:r.bottomCenter,sourceIds:resolution.sourceIds.slice()};
    }
    if(resolution.kind==='conical') {
      var q=resolution.resolved;
      return {kind:'cone',index:resolution.index,origin:q.mouthCenter,axis:q.axis,
        radius:q.radius,bottomRadius:q.bottomRadius,depth:q.depth,outward:q.outward,
        mouthCenter:q.mouthCenter,bottomCenter:q.bottomCenter,through:q.through,
        throughCandidate:q.throughCandidate===true,
        openBottom:q.bottomClosure==='open'||q.through===true,
        floorEvidence:q.floorEvidence||null,
        sourceIds:resolution.sourceIds.slice()};
    }
    if(resolution.kind==='spherical') {
      var c=resolution.cand;
      return {kind:'sphere',index:resolution.index,center:c.center,radius:c.radius,
        pole:c.pole,outward:c.outward,capAngle:c.capAngle,mouthCenter:c.mouthCenter,
        mouthRadius:c.mouthRadius,depth:c.depth,sourceIds:resolution.sourceIds.slice()};
    }
    return null;
  }
  function cavityVolumeSize(volume) {
    if(volume.kind==='cylinder') return Math.PI*volume.radius*volume.radius*volume.depth;
    if(volume.kind==='cone') {
      var a=volume.radius,b=volume.bottomRadius;
      return Math.PI*volume.depth*(a*a+a*b+b*b)/3;
    }
    if(volume.kind==='sphere') {
      var h=volume.radius*(1-Math.cos(volume.capAngle));
      return Math.PI*h*h*(3*volume.radius-h)/3;
    }
    return 0;
  }
  function cavityExclusion(volume) {
    if(volume.kind==='cylinder') return {kind:'cylinder',origin:volume.origin,axis:volume.axis,
      radius:volume.radius,depth:volume.depth};
    if(volume.kind==='cone') return {kind:'cone',origin:volume.origin,axis:volume.axis,
      radius:volume.radius,bottomRadius:volume.bottomRadius,depth:volume.depth,
      mouthCenter:volume.mouthCenter,bottomCenter:volume.bottomCenter,
      outward:volume.outward,through:volume.through===true,
      throughCandidate:volume.throughCandidate===true,
      openBottom:volume.openBottom===true,floorEvidence:volume.floorEvidence||null};
    if(volume.kind==='sphere') return {kind:'sphere',center:volume.center,radius:volume.radius,
      pole:volume.pole,outward:volume.outward,capAngle:volume.capAngle,
      mouthCenter:volume.mouthCenter,mouthRadius:volume.mouthRadius};
    return null;
  }
  function unionFindGroups(count, pairs) {
    var parent=[];
    for(var i=0;i<count;i++) parent.push(i);
    function find(i) {while(parent[i]!==i) {parent[i]=parent[parent[i]];i=parent[i];} return i;}
    pairs.forEach(function(pair) {
      var a=find(pair.a),b=find(pair.b);
      if(a!==b) parent[b]=a;
    });
    var groups=new Map();
    for(var i=0;i<count;i++) {
      var root=find(i);
      if(!groups.has(root)) groups.set(root,[]);
      groups.get(root).push(i);
    }
    return Array.from(groups.values()).sort(function(a,b) {return a[0]-b[0];});
  }
  function addParentCircle(geometry,center,u,v,radius,sourceIds) {
    var index=geometry.curves.length;
    geometry.curves.push({kind:'circle',center:center,u:u,v:v,radius:radius,
      startAngle:0,sweepAngle:TAU,sourceIds:sourceIds.slice(),unionParent:true,
      displayVertices:[],displayEdges:[]});
    return index;
  }
  function addUnionMouth(geometry,group,curveSourceIds) {
    var addedCurves=[];
    group.loops.forEach(function(loop) {
      var indices=[],base=geometry.vertices.length,added=0;
      function vertexKey(p) {
        var scale=group.vertexTolerance;
        return [Math.round(p.x/scale),Math.round(p.y/scale),Math.round(p.z/scale)].join(',');
      }
      loop.forEach(function(p) {
        var index=group.vertexIndex.get(vertexKey(p));
        if(index===undefined) {
          index=base+added;
          geometry.vertices.push({x:p.x,y:p.y,z:p.z});
          added++;
        }
        if(!indices.length||indices[indices.length-1]!==index) indices.push(index);
      });
      if(indices.length>1&&indices[0]===indices[indices.length-1]) indices.pop();
      var displayEdges=[];
      for(var i=0;i<indices.length;i++) {
        var a=indices[i],b=indices[(i+1)%indices.length];
        var key=Math.min(a,b)+'_'+Math.max(a,b);
        if(group.edgeIndex.has(key)) displayEdges.push(group.edgeIndex.get(key));
      }
      var curveIndex=geometry.curves.length;
      geometry.curves.push({kind:'polyline',points:loop.map(function(p){return {x:p.x,y:p.y,z:p.z};}),
        displayVertices:indices,displayEdges:displayEdges,sourceIds:curveSourceIds.slice(),
        unionMouth:true,recessMouth:true,unionGroup:group.unionGroup,approximate:true,
        sourceView:group.sourceView});
      addedCurves.push(curveIndex);
    });
    return addedCurves;
  }
  function rotateFaceStart(face,vertices) {
    function areaAt(index) {
      var a=vertices[face[index%face.length]],b=vertices[face[(index+1)%face.length]],c=vertices[face[(index+2)%face.length]];
      var u=sub(b,a),v=sub(c,a);
      return Math.hypot(cross(u,v).x,cross(u,v).y,cross(u,v).z);
    }
    for(var i=0;i<face.length;i++) {
      if(areaAt(i)>EPS) return face.slice(i).concat(face.slice(0,i));
    }
    return face;
  }
  function addResolvedCavities(geometry,resolutions) {
    if(!resolutions.length) return;
    resolutions.forEach(function(resolution,index) {resolution.index=index;});
    var volumes=resolutions.map(function(resolution) {return cavityVolumeOf(resolution);});
    var relations=[],interacting=[];
    for(var i=0;i<volumes.length;i++) for(var j=i+1;j<volumes.length;j++) {
      var result=CavityBoolean.relation(volumes[i],volumes[j]);
      relations.push({a:i,b:j,relation:result.relation,clearance:result.clearance,
        aInsideB:result.aInsideB,bInsideA:result.bInsideA,tolerance:result.tolerance,
        contact:result.contact});
      if(result.relation==='overlap'||result.relation==='contained'||result.relation==='duplicate'||result.relation==='touch')
        interacting.push({a:i,b:j});
    }
    var groups=unionFindGroups(volumes.length,interacting);
    var absorbed=new Set(),absorbedBy={},duplicateOf={};
    groups.forEach(function(group) {
      group.forEach(function(a) {
        group.forEach(function(b) {
          if(a===b) return;
          var relation=relations.find(function(pair) {
            return (pair.a===a&&pair.b===b)||(pair.a===b&&pair.b===a);
          });
          if(!relation) return;
          if(relation.relation==='duplicate') {
            var keep=Math.min(a,b),drop=Math.max(a,b);
            if(a===drop) {absorbed.add(a);duplicateOf[a]=keep;}
          } else if(relation.relation==='contained') {
            if(relation.aInsideB&&a===relation.a) {absorbed.add(a);absorbedBy[a]=b;}
            if(relation.bInsideA&&b===relation.b) {absorbed.add(b);absorbedBy[b]=a;}
          }
        });
      });
    });
    var unionGroupFor={};
    groups.forEach(function(group,groupIndex) {
      if(group.length<2) return;
      group.forEach(function(index) {unionGroupFor[index]=groupIndex;});
    });
    geometry.cavityRelations=relations;
    geometry.cavityVolumes=volumes.map(function(volume,index) {
      var entry=Object.assign({},cavityExclusion(volume));
      entry.index=index;
      entry.group=unionGroupFor[index]===undefined?null:unionGroupFor[index];
      entry.absorbed=absorbed.has(index);
      entry.sourceIds=volume.sourceIds.slice();
      return entry;
    });
    geometry.cavityUnions=geometry.cavityUnions||[];
    geometry.recesses=geometry.recesses||[];
    function addAnalyticParent(volume,groupIndex,exclusions) {
      var resolution=resolutions[volume.index];
      var booleanDomain={exclude:exclusions,unionGroup:groupIndex,volumeIndex:volume.index,volume:cavityExclusion(volume)};
      if(volume.kind==='cone') {
        var cone=resolution.resolved;
        var coneMouth=addParentCircle(geometry,cone.mouthCenter,cone.u,cone.v,cone.radius,resolution.sourceIds);
        var coneBottom=cone.bottomRadius>EPS?
          addParentCircle(geometry,cone.bottomCenter,cone.u,cone.v,cone.bottomRadius,resolution.sourceIds):null;
        var coneAnalytic=coneGeometry(cone.radius,cone.bottomRadius,cone.depth,cone.axis);
        var coneApex=add(cone.mouthCenter,mul(cone.axis,coneAnalytic.apexOffset));
        var coneSideFaceIndices=volume.faceIndices&&volume.faceIndices.side||[];
        var coneBottomFaceIndices=volume.faceIndices&&volume.faceIndices.bottom||[];
        var coneSidePatch=geometry.surfacePatches.length;
        geometry.surfacePatches.push({kind:'cone',analyticKind:'cone',origin:cone.mouthCenter,
          axis:cone.axis,radius:cone.radius,bottomRadius:cone.bottomRadius,apex:coneApex,
          halfAngle:coneAnalytic.halfAngle,
          boundaryCurves:coneBottom===null?[coneMouth]:[coneMouth,coneBottom],
          faceIndices:coneSideFaceIndices,sourceIds:resolution.sourceIds.slice(),recess:true,
          unionGroup:groupIndex,volumeIndex:volume.index,memberRole:'side',
          approximateTrim:true,displayOnlyBoundary:true,booleanDomain:booleanDomain});
        var coneBottomPatch=null;
        if(coneBottom!==null&&!cone.through&&cone.bottomClosure!=='open') {
          coneBottomPatch=geometry.surfacePatches.length;
          geometry.surfacePatches.push({kind:'plane',boundaryCurves:[coneBottom],
            faceIndices:coneBottomFaceIndices,closure:'recess-bottom',recessBottom:true,
            sourceIds:resolution.sourceIds.slice(),unionGroup:groupIndex,
            volumeIndex:volume.index,memberRole:'bottom',approximateTrim:true,
            displayOnlyBoundary:true,booleanDomain:booleanDomain});
        }
        return {surface:coneSidePatch,bottom:coneBottomPatch};
      }
      if(volume.kind==='cylinder') {
        var r=resolution.resolved;
        var mouth=addParentCircle(geometry,r.mouthCenter,r.u,r.v,r.radius,resolution.sourceIds);
        var bottom=addParentCircle(geometry,r.bottomCenter,r.u,r.v,r.radius,resolution.sourceIds);
        var sideFaceIndices=[],bottomFaceIndices=[];
        if(volume.faceIndices) {
          sideFaceIndices=volume.faceIndices.side||[];
          bottomFaceIndices=volume.faceIndices.bottom||[];
        }
        var sidePatch=geometry.surfacePatches.length;
        geometry.surfacePatches.push({kind:'cylinder',analyticKind:'cylinder',origin:r.mouthCenter,
          axis:r.axis,radius:r.radius,boundaryCurves:[mouth,bottom],faceIndices:sideFaceIndices,
          sourceIds:resolution.sourceIds.slice(),recess:true,unionGroup:groupIndex,
          volumeIndex:volume.index,memberRole:'side',
          approximateTrim:true,displayOnlyBoundary:true,booleanDomain:booleanDomain});
        var bottomPatch=geometry.surfacePatches.length;
        geometry.surfacePatches.push({kind:'plane',boundaryCurves:[bottom],faceIndices:bottomFaceIndices,
          closure:'recess-bottom',recessBottom:true,sourceIds:resolution.sourceIds.slice(),
          unionGroup:groupIndex,volumeIndex:volume.index,memberRole:'bottom',
          approximateTrim:true,displayOnlyBoundary:true,
          booleanDomain:booleanDomain});
        return {surface:sidePatch,bottom:bottomPatch};
      }
      var c=resolution.cand;
      var capMouth=addParentCircle(geometry,c.mouthCenter,c.u,c.v,c.mouthRadius,resolution.sourceIds);
      var capFaceIndices=volume.faceIndices&&volume.faceIndices.cap?volume.faceIndices.cap:[];
      var capPatch=geometry.surfacePatches.length;
      geometry.surfacePatches.push({kind:'sphere',center:c.center,radius:c.radius,
        boundaryCurves:[capMouth],cap:{pole:c.pole,angle:c.capAngle,
          mouth:{origin:c.mouthCenter,normal:c.outward}},faceIndices:capFaceIndices,
        sourceIds:resolution.sourceIds.slice(),recess:true,unionGroup:groupIndex,
        volumeIndex:volume.index,memberRole:'cap',
        approximateTrim:true,displayOnlyBoundary:true,booleanDomain:booleanDomain});
      return {surface:capPatch};
    }
    groups.forEach(function(group,groupIndex) {
      if(group.length===1) {
        var only=resolutions[group[0]];
        if(only.kind==='cylindrical')
          addCylindricalRecess(geometry,only.resolved,only.sourceIds,only.mouthIds,only.bottomIds,only.cand.closedMouth,group[0]);
        else if(only.kind==='conical')
          addTaperedRecess(geometry,only.resolved,only.sourceIds,only.mouthIds,only.bottomIds,
            only.ringIds||[],true,group[0]);
        else
          addSphericalRecess(geometry,only.cand,only.sourceIds,only.closureIds,only.closed,group[0]);
        return;
      }
      var groupRelations=relations.filter(function(pair) {
        return group.indexOf(pair.a)!==-1&&group.indexOf(pair.b)!==-1;
      });
      var booleanGroup=groupRelations.some(function(pair) {
        return pair.relation==='overlap'||pair.relation==='contained'||pair.relation==='duplicate'||
          (pair.relation==='touch'&&pair.contact&&pair.contact.positiveArea===true);
      });
      if(!booleanGroup) {
        group.forEach(function(index) {
          var only=resolutions[index];
          if(only.kind==='cylindrical')
            addCylindricalRecess(geometry,only.resolved,only.sourceIds,only.mouthIds,only.bottomIds,only.cand.closedMouth,index);
          else if(only.kind==='conical')
            addTaperedRecess(geometry,only.resolved,only.sourceIds,only.mouthIds,only.bottomIds,
              only.ringIds||[],true,index);
          else
            addSphericalRecess(geometry,only.cand,only.sourceIds,only.closureIds,only.closed,index);
        });
        return;
      }
      var active=group.filter(function(index) {return !absorbed.has(index);});
      if(!active.length) active=[group[0]];
      var groupVolumes=group.map(function(originalIndex,localIndex) {
        var copy=Object.assign({},volumes[originalIndex]);
        copy.index=localIndex;
        copy.absorbed=absorbed.has(originalIndex)&&active.indexOf(originalIndex)===-1;
        return copy;
      });
      var union=CavityBoolean.union(groupVolumes,{segments:SAMPLES});
      var unionMouths=union.mouths.map(function(mouth) {
        return {plane:mouth.plane,loops:mouth.loops,
          sourceVolumes:mouth.sourceVolumes.map(function(localIndex) {
            return group[localIndex];
          })};
      });
      var vertexOffset=geometry.vertices.length,faceOffset=geometry.faces.length;
      var edgeMap=new Map();
      union.vertices.forEach(function(p) {geometry.vertices.push({x:p.x,y:p.y,z:p.z});});
      union.faces.forEach(function(record,faceIndex) {
        var face=rotateFaceStart(record.face.slice().reverse().map(function(index) {return index+vertexOffset;}),geometry.vertices);
        geometry.faces.push(face);
        for(var i=0;i<face.length;i++) {
          var a=face[i],b=face[(i+1)%face.length];
          var key=Math.min(a,b)+'_'+Math.max(a,b);
          if(!edgeMap.has(key)) {
            edgeMap.set(key,geometry.edges.length);
            geometry.edges.push([a,b]);
          }
        }
        var role=record.tag&&record.tag.role;
        if(role==='side'||role==='cap') geometry.smoothSideFaces.push(faceOffset+faceIndex);
      });
      var faceGroups={};
      union.parents.forEach(function(parent,faceIndex) {
        var originalIndex=group[parent.volume];
        if(!faceGroups[originalIndex]) faceGroups[originalIndex]={side:[],bottom:[],cap:[]};
        if(parent.role==='side') faceGroups[originalIndex].side.push(faceOffset+faceIndex);
        else if(parent.role==='bottom') faceGroups[originalIndex].bottom.push(faceOffset+faceIndex);
        else if(parent.role==='cap') faceGroups[originalIndex].cap.push(faceOffset+faceIndex);
      });
      var patchInfo={},memberRecords=[];
      active.forEach(function(index) {
        var volume=volumes[index];
        volume.faceIndices=faceGroups[index]||{side:[],bottom:[],cap:[]};
        var exclusions=[];
        group.forEach(function(other) {
          if(other!==index&&!absorbed.has(other)) exclusions.push(cavityExclusion(volumes[other]));
        });
        patchInfo[index]=addAnalyticParent(volume,groupIndex,exclusions);
        if(volume.kind==='cylinder') {
          var r=resolutions[index].resolved;
          memberRecords.push({kind:'cylindrical',mouthCenter:r.mouthCenter,mouthRadius:r.radius,
            axis:r.axis,depth:r.depth,bottomCenter:r.bottomCenter,closure:'host',
            bottomClosure:'plane',sourceIds:resolutions[index].sourceIds.slice(),
            unionGroup:groupIndex,unionMode:'display-boolean',absorbed:false,volumeIndex:index,
            approximateTrim:true,surface:patchInfo[index].surface});
        } else if(volume.kind==='cone') {
          var q=resolutions[index].resolved;
          memberRecords.push({kind:'conical',mouthCenter:q.mouthCenter,mouthRadius:q.radius,
            axis:q.axis,depth:q.depth,bottomCenter:q.bottomCenter,bottomRadius:q.bottomRadius,
            through:q.through,throughCandidate:q.throughCandidate===true,
            floorEvidence:q.floorEvidence||null,
            closure:'host',
            bottomClosure:q.through?'through':q.bottomClosure==='open'?'open':'plane',
            sourceIds:resolutions[index].sourceIds.slice(),
            unionGroup:groupIndex,unionMode:'display-boolean',absorbed:false,volumeIndex:index,
            approximateTrim:true,surface:patchInfo[index].surface});
        } else {
          var c=resolutions[index].cand;
          memberRecords.push({kind:'spherical',center:c.center,radius:c.radius,
            mouthCenter:c.mouthCenter,mouthRadius:c.mouthRadius,depth:c.depth,
            capAngle:c.capAngle,closure:'host',sourceIds:resolutions[index].sourceIds.slice(),
            unionGroup:groupIndex,unionMode:'display-boolean',absorbed:false,volumeIndex:index,
            approximateTrim:true,surface:patchInfo[index].surface});
        }
      });
      group.filter(function(index){return absorbed.has(index);}).forEach(function(index) {
        var volume=volumes[index];
        if(volume.kind==='cylinder') {
          var r=resolutions[index].resolved;
          memberRecords.push({kind:'cylindrical',mouthCenter:r.mouthCenter,mouthRadius:r.radius,
            axis:r.axis,depth:r.depth,bottomCenter:r.bottomCenter,
            closure:'absorbed',bottomClosure:'plane',sourceIds:resolutions[index].sourceIds.slice(),
            unionGroup:groupIndex,unionMode:'display-boolean',absorbed:true,volumeIndex:index,
            absorbedBy:absorbedBy[index]===undefined?null:absorbedBy[index],
            duplicateOf:duplicateOf[index]===undefined?null:duplicateOf[index],
            approximateTrim:true});
        } else if(volume.kind==='cone') {
          var q=resolutions[index].resolved;
          memberRecords.push({kind:'conical',mouthCenter:q.mouthCenter,mouthRadius:q.radius,
            axis:q.axis,depth:q.depth,bottomCenter:q.bottomCenter,bottomRadius:q.bottomRadius,
            through:q.through,closure:'absorbed',
            bottomClosure:q.through?'through':q.bottomClosure==='open'?'open':'plane',
            sourceIds:resolutions[index].sourceIds.slice(),
            unionGroup:groupIndex,unionMode:'display-boolean',absorbed:true,volumeIndex:index,
            absorbedBy:absorbedBy[index]===undefined?null:absorbedBy[index],
            duplicateOf:duplicateOf[index]===undefined?null:duplicateOf[index],
            approximateTrim:true});
        } else {
          var c=resolutions[index].cand;
          memberRecords.push({kind:'spherical',center:c.center,radius:c.radius,
            mouthCenter:c.mouthCenter,mouthRadius:c.mouthRadius,depth:c.depth,
            capAngle:c.capAngle,closure:'absorbed',sourceIds:resolutions[index].sourceIds.slice(),
            unionGroup:groupIndex,unionMode:'display-boolean',absorbed:true,volumeIndex:index,
            absorbedBy:absorbedBy[index]===undefined?null:absorbedBy[index],
            duplicateOf:duplicateOf[index]===undefined?null:duplicateOf[index],
            approximateTrim:true});
        }
      });
      var firstFaceIndex=faceOffset;
      var vertexTolerance=Math.max(union.tolerance*0.5,1e-9);
      var unionVertexIndex=new Map();
      union.vertices.forEach(function(p,index) {
        unionVertexIndex.set([Math.round(p.x/vertexTolerance),Math.round(p.y/vertexTolerance),
          Math.round(p.z/vertexTolerance)].join(','),vertexOffset+index);
      });
      unionMouths.forEach(function(mouth) {
        var sourceIds=[];
        mouth.sourceVolumes.forEach(function(index) {
          sourceIds=sourceIds.concat(resolutions[index].sourceIds);
        });
        var sourceResolution=resolutions[mouth.sourceVolumes[0]];
        var sourceView=sourceResolution.kind==='cylindrical'||sourceResolution.kind==='conical'?
          sourceResolution.resolved.view.role:'PLAN';
        var curves=addUnionMouth(geometry,{loops:mouth.loops,unionGroup:groupIndex,
          firstFaceIndex:firstFaceIndex,sourceView:sourceView,
          vertexTolerance:vertexTolerance,vertexIndex:unionVertexIndex,edgeIndex:edgeMap},sourceIds);
        if(curves.length) memberRecords.forEach(function(record) {
          if(mouth.sourceVolumes.indexOf(record.volumeIndex)!==-1&&record.mouthCurve===undefined)
            record.mouthCurve=curves[0];
        });
      });
      memberRecords.forEach(function(record) {geometry.recesses.push(record);});
      geometry.cavityUnions.push({id:'cavity-union:'+geometry.cavityUnions.length,
        members:group.map(function(index) {
          return {volume:index,kind:volumes[index].kind,absorbed:absorbed.has(index),
            absorbedBy:absorbedBy[index]===undefined?null:absorbedBy[index],
            duplicateOf:duplicateOf[index]===undefined?null:duplicateOf[index],
            sourceIds:resolutions[index].sourceIds.slice()};
        }),relations:relations.filter(function(pair) {
          return group.indexOf(pair.a)!==-1&&group.indexOf(pair.b)!==-1;
        }),display:'polyhedral-boolean',analyticParents:true,approximate:true,
        volume:union.metrics.volume,closed:union.metrics.closed,
        openEdges:union.metrics.openEdges,nonmanifoldEdges:union.metrics.nonmanifoldEdges,
        mouthArea:union.mouthArea,segments:SAMPLES,mouths:unionMouths.map(function(mouth) {
          return {sourceVolumes:mouth.sourceVolumes.slice(),
            loops:mouth.loops.map(function(loop){return loop.map(function(p){return {x:p.x,y:p.y,z:p.z};});})};
        })});
      if(!Array.isArray(geometry.faceHoles))
        geometry.faceHoles=geometry.faces.map(function(){return [];});
      while(geometry.faceHoles.length<geometry.faces.length) geometry.faceHoles.push([]);
    });
    if(!Array.isArray(geometry.faceHoles))
      geometry.faceHoles=geometry.faces.map(function(){return [];});
    while(geometry.faceHoles.length<geometry.faces.length) geometry.faceHoles.push([]);
  }

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
    var toroidal = options.toroidal || inferToroidalSurfaces(ink, profile);
    var used = new Set(toroidal.consumedIds);
    var sourceById = new Map(ink.map(function(e) {return [e.id,e];}));
    ink = ink.filter(function (e) { return !used.has(e.id); });
    var geometry={name:'primitive surface',vertices:[],edges:[],faces:[],curves:[],spheres:[],surfacePatches:[],smoothSideFaces:[],recesses:[]};
    var selectedIssues=toroidal.issues.slice(), explanations=new Map(), ambiguousSources=new Set();
    toroidal.patches.forEach(function (patch) { addToroidalPatch(geometry, patch); });
    function sourceKey(e) {
      function r(v) {return Math.round(v*1e6)/1e6;}
      return [e.type,e.viewRole,r(e.x),r(e.y),r(e.radius),
        e.type==='CIRCLE'?0:r(e.startAngle),e.type==='CIRCLE'?0:r(e.endAngle)].join('|');
    }


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



    var sphericalCavities=inferRecesses(ink,used,geometry,profile);
    sphericalCavities.issues.forEach(function(issue) {selectedIssues.push(issue);});
    var taperedCavities=inferTaperedRecesses(ink,used,geometry,profile);
    taperedCavities.issues.forEach(function(issue) {selectedIssues.push(issue);});
    var cylindricalCavities=inferCylindricalRecesses(ink,used,geometry,profile,
      taperedCavities.blocked);
    cylindricalCavities.issues.forEach(function(issue) {selectedIssues.push(issue);});
    addResolvedCavities(geometry,sphericalCavities.resolutions
      .concat(taperedCavities.resolutions,cylindricalCavities.resolutions));
    function project(p,role) {
      return role==='PLAN'?[p.x,-p.z]:role==='ELEVATION'?[p.x,p.y]:[profile.xRef+profile.s*(p.z-profile.dRef),p.y];
    }



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


    geometry.curves.forEach(function(c) {
      if(c.unionParent||c.unionMouth) return;
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
    inferBoundedCones:inferBoundedCones, inferToroidalSurfaces:inferToroidalSurfaces };
});

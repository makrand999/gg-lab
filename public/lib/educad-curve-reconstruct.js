(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-parametric.js'));
  else root.EduCADCurveReconstruct = factory(root.EduCADParametric);
})(typeof window !== 'undefined' ? window : globalThis, function (Parametric) {
  'use strict';

  // First primitive lifting stage: a circle/arc seen in true shape in one
  // principal view and edge-on in the other. Analytic geometry is authoritative;
  // vertices/edges below are only the display approximation. No solid names.
  var TAU = 2 * Math.PI, EPS = 1e-6, SAMPLES = 24;
  function near(a, b) { return Math.abs(a - b) <= EPS; }
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
    function sub(a,b) {return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};}
    function add(a,b) {return {x:a.x+b.x,y:a.y+b.y,z:a.z+b.z};}
    function mul(a,s) {return {x:a.x*s,y:a.y*s,z:a.z*s};}
    function dot(a,b) {return a.x*b.x+a.y*b.y+a.z*b.z;}
    function cross(a,b) {return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
    function unit(v) {var l=Math.hypot(v.x,v.y,v.z);return l>EPS?{x:v.x/l,y:v.y/l,z:v.z/l}:{x:0,y:1,z:0};}
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
    var geometry={name:'primitive surface',vertices:[],edges:[],faces:[],curves:[],spheres:[],surfacePatches:[],smoothSideFaces:[]};
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
  return { reconstruct:reconstruct, point:point, isCurve:isCurve, resolveProfileFrame:resolveProfileFrame };
});

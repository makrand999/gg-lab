'use strict';
// EduCAD Script (.edc): the command palette as a file format. One slash
// command per line, `#` comments and blank lines ignored, geometry only
// (/demo /tutorial /check /mode need the live page and are refused).
// CLI: `node tools/edc.js <file.edc>` prints a validation report and
// exits 0 (clean) or 1 (any bad line or misaligned projector).
// Module: require('./edc.js').runScript(text) for tests and agents.
var fs = require('fs');
var path = require('path');
var C = require('../public/lib/educad-command.js');
var E = require('../public/lib/educad-entities.js');
var R = require('../public/lib/educad-reconstruct.js');
var P = require('../public/lib/educad-project.js');
var Surfaces = require('../public/lib/educad-surfaces.js');
var Parametric = require('../public/lib/educad-parametric.js');
var Ref3d = require('../public/lib/educad-ref3d.js');

function baseName(caption) {
  return String(caption).replace(/['’′]+$/, '').toLowerCase();
}

// checkProjectors(table): points sharing a base name (a/a', b/b') are
// one 3D point, so their x must match across views (Monge invariant).
function checkProjectors(table) {
  var groups = Object.create(null);
  table.list().forEach(function (e) {
    if (e.type !== 'POINT' || e.viewRole === 'PROFILE') return;
    var b = baseName(e.caption || e.name);
    if (!groups[b]) groups[b] = [];
    groups[b].push(e);
  });
  var aligned = [];
  var misaligned = [];
  Object.keys(groups).forEach(function (b) {
    var g = groups[b];
    if (g.length < 2) return;
    var x0 = g[0].x;
    var bad = g.some(function (p) { return Math.abs(p.x - x0) > 1e-9; });
    if (bad) misaligned.push(b);
    else aligned.push(b);
  });
  return { aligned: aligned, misaligned: misaligned };
}

function summarize(table) {
  var byType = {};
  var roles = {};
  var hasDatum = false;
  table.list().forEach(function (e) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    roles[e.viewRole] = (roles[e.viewRole] || 0) + 1;
    if (e.type === 'DATUM_AXIS') hasDatum = true;
  });
  return { count: table.count(), byType: byType, roles: roles, hasDatum: hasDatum };
}

function runScript(text, options) {
  options = options || {};
  E.resetIdCounter();
  var table = E.createTable();
  var env = { table: table };
  var lines = String(text).split(/\r?\n/);
  var steps = [];
  var errors = [], rejected = 0;
  lines.forEach(function (raw, i) {
    var line = raw.replace(/^\s+|\s+$/g, '');
    var reject=/^#\s*reject:\s*(.*)$/.exec(line);
    if(reject) {
      try {
        var spec=JSON.parse(reject[1]),before=JSON.stringify(table.list()),failure=C.execute(spec.command,env);
        if(failure.ok || (spec.contains && failure.message.indexOf(spec.contains)===-1) || JSON.stringify(table.list())!==before)
          errors.push({n:i+1,line:line,message:'Expected an atomic rejection: '+failure.message});
        else rejected++;
      } catch(error) {errors.push({n:i+1,line:line,message:error.message});}
      return;
    }
    if (line === '' || line.charAt(0) === '#') return;
    var r = C.execute(line, env);
    steps.push({ n: i + 1, line: line, ok: r.ok, message: r.message });
    if (!r.ok) errors.push({ n: i + 1, line: line, message: r.message });
  });
  var proj = checkProjectors(table);
  proj.misaligned.forEach(function (b) {
    errors.push({ n: 0, line: '', message: 'Projector "' + b + '" misaligned: x differs across views.' });
  });
  var summary = summarize(table);
  // The 3D model is a pure function of the sheet: the same live
  // reconstruction the glass widget runs, headless. Representation
  // only — a script never edits the solid, it determines it.
  var solid = R.reconstruct(table.list(), {identity: options.strict ? 'explicit' : 'auto'});
  var properties = topologyProperties(solid);
  properties.rejected = rejected;
  var parametric=((solid.geometry||{}).curves||[]).filter(function(c){return c.kind==='nurbs';});
  properties.parametricCurves=parametric.length;
  var defined=table.list().filter(function(e){return e.meta&&e.meta.throughRefs;});
  properties.throughEdit=defined.length?defined.every(function(e){
    try {
      var copy=E.createTable();copy.importEntities(JSON.parse(JSON.stringify(table.list())));
      var point=copy.get(e.meta.throughRefs[0]);
      require('../public/lib/educad-drafting.js').movePoint(copy,E,point.id,{x:point.x,y:point.y-0.125},(solid.geometry||{}).profileMap||{});
      var changed=copy.get(e.id),points=changed.meta.throughRefs.map(function(id){return copy.get(id);});
      if(changed.type==='CURVE')return points.every(function(p,i){var q=Parametric.point(changed.meta.curve,changed.meta.curve.parameters[i]);return Math.hypot(q.x-p.x,q.y-p.y)<1e-6;});
      return points.every(function(p){return Math.abs(Math.hypot(p.x-changed.x,p.y-changed.y)-changed.radius)<1e-6;});
    } catch(error) {return false;}
  })?'ok':'issues':'none';
  properties.curveFit=parametric.length?parametric.every(function(c){return Parametric.validate(c)&&c.interpolationPoints.every(function(p,i){var q=Parametric.point(c,c.parameters[i]);return Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)<1e-6;});})?'ok':'issues':'none';
  properties.curveReprojection=parametric.length?parametric.every(function(c){return c.sourceEvidence.every(function(evidence){
    var source=table.get(evidence.entityId),definition=source.meta.curve,n=evidence.order.length,frame=solid.geometry.profileMap;
    var count=c.closed?n:n-1;
    for(var i=0;i<=40;i++) {
      var t=i/40,station=t*count,index=Math.min(Math.floor(station),count-1),fraction=station-index;
      var start=evidence.order[index],next=evidence.order[(index+1)%n],delta=next-start;
      if(c.closed&&delta>1)delta-=n;if(c.closed&&delta< -1)delta+=n;
      var sourceT=(start+fraction*delta)/count;
      if(c.closed)sourceT=(sourceT%1+1)%1;
      var p=Parametric.point(c,t),q=Parametric.point(definition,sourceT),x=p.x,y=source.viewRole==='PLAN'?-p.z:p.y;
      if(source.viewRole==='PROFILE')x=frame.xRef+frame.s*(p.z-frame.dRef);
      if(Math.hypot(x-q.x,y-q.y)>1e-6)return false;
    }
    return true;
  });})?'ok':'issues':'none';
  if(parametric.length) {
    var preview=JSON.parse(JSON.stringify(Ref3d.buildPreview(table.list(),R)));
    properties.curvePreview=Ref3d.validPreview(preview)?'ok':'issues';
  } else properties.curvePreview='none';
  properties.obliqueReprojection = checkObliqueReprojection(solid, table.list());
  var obliqueCurves=((solid.geometry || {}).curves || []).filter(function(c) {return c.oblique;});
  properties.obliqueArcs=obliqueCurves.filter(function(c) {return c.kind==='arc';}).length;
  properties.obliqueVisibility=obliqueCurves.filter(function(c) {return c.visibilityEvidence && c.visibilityEvidence.samples>0;}).length;
  properties.obliqueVisibilityFit=checkObliqueVisibility(solid,table.list());
  properties.arcSweep=obliqueCurves.filter(function(c) {return c.kind==='arc';}).map(function(c) {return Math.round(c.sweepAngle*180/Math.PI);}).sort(function(a,b) {return a-b;}).join(',') || 'none';
  if(/^\d+$/.test(properties.arcSweep)) properties.arcSweep=Number(properties.arcSweep);
  if (obliqueCurves.length) {
    var arcPreview = JSON.parse(JSON.stringify(Ref3d.buildPreview(table.list(), R)));
    properties.obliquePreview = Ref3d.validPreview(arcPreview) ? 'ok' : 'issues';
  } else properties.obliquePreview = 'none';
  properties.diagnostics = Array.from(new Set(((solid.pipeline || {}).diagnostics || solid.issues || []).map(function(d) {return d.code;}))).sort().join(',') || 'none';
  var evidenced = ((solid.geometry || {}).curves || []).filter(function(c) {return c.oblique && (c.pointEvidence || []).length;});
  properties.obliquePoints = evidenced.reduce(function(n,c) {return n+c.pointEvidence.length;},0);
  properties.obliquePointFit = !evidenced.length ? 'none' : evidenced.every(function(c) {
    return c.pointEvidence.every(function(e) {
      var d={x:e.position.x-c.center.x,y:e.position.y-c.center.y,z:e.position.z-c.center.z};
      var u=d.x*c.u.x+d.y*c.u.y+d.z*c.u.z, v=d.x*c.v.x+d.y*c.v.y+d.z*c.v.z;
      var residual=Math.hypot(d.x-u*c.u.x-v*c.v.x,d.y-u*c.u.y-v*c.v.y,d.z-u*c.u.z-v*c.v.z);
      return residual<=0.5 && Math.abs(Math.hypot(u,v)-c.radius)<=0.5;
    });
  }) ? 'ok' : 'issues';
  // Declarative surface queries exercise public APIs on the reconstructed
  // drawing. Expected values are recursive subsets with numeric tolerance.
  // Trim, split and attach results carry the analytic validation/certificate
  // of the model they produce.
  var surfaceChecks = 0, surfaceFailures = 0, querySurfaces = Object.create(null), queryCurves = Object.create(null);
  function matches(actual, expected) {
    if (typeof expected === 'number') return Number.isFinite(actual) && Math.abs(actual-expected) <= 1e-6*Math.max(1,Math.abs(expected));
    if (expected && typeof expected === 'object') return actual && Object.keys(expected).every(function(k) { return matches(actual[k],expected[k]); });
    return actual === expected;
  }
  lines.forEach(function(line, i) {
    var query = /^\s*#\s*surface-query:\s*(.*)$/.exec(line);
    if (!query) return;
    surfaceChecks++;
    try {
      var request = JSON.parse(query[1]), g = solid.geometry;
      function pick(ref) {
        if (typeof ref === 'number') return g && (g.surfaces || [])[ref];
        if (typeof ref === 'string') return querySurfaces[ref];
        return undefined;
      }
      function pickCurve(ref) {
        if (typeof ref === 'string') return queryCurves[ref];
        if (typeof ref === 'number') return g && g.curves && g.curves[ref];
        if (ref && typeof ref === 'object') return ref;
        return undefined;
      }
      function modelOf(surfaces) {
        return {version:1,contract:'analytic-surface-v1',surfaces:surfaces,diagnostics:[]};
      }
      function identityCounts(surfaces) {
        var graph = Surfaces.incidence(modelOf(surfaces));
        var counts = {boundaries:0, shared:0, open:0, nonmanifold:0};
        graph.uses.forEach(function (use) {
          counts.boundaries++;
          if (use.useCount === 1) counts.open++;
          else if (use.useCount === 2) counts.shared++;
          else counts.nonmanifold++;
        });
        return counts;
      }
      function identitySummary(surfaces) {
        var model = modelOf(surfaces);
        return {before:identityCounts(model.surfaces),
          after:identityCounts(JSON.parse(JSON.stringify(model)).surfaces)};
      }
      var result;
      if (request.operation === 'intersect') {
        var refs = request.surfaces || [
          request.from !== undefined ? request.from : request.surface,
          request.with !== undefined ? request.with : request.other
        ];
        var first = pick(refs[0]), second = pick(refs[1]);
        if (!first || !second) throw new Error('Missing reconstructed surface');
        result = Surfaces.intersect(first,second);
      } else if (request.operation === 'split') {
        var splitSurface = pick(request.from !== undefined ? request.from : request.surface);
        if (!splitSurface) throw new Error('Missing reconstructed surface');
        var splitDiagnostics = [];
        var splitResult = Surfaces.split(splitSurface,request.plane,g,splitDiagnostics);
        if (splitResult) {
          if (request.save && typeof request.save === 'object') {
            if (request.save.positive) querySurfaces[request.save.positive] = splitResult.positive;
            if (request.save.negative) querySurfaces[request.save.negative] = splitResult.negative;
          } else if (typeof request.save === 'string') {
            querySurfaces[request.save] = splitResult.positive;
          }
          var splitModel = modelOf(splitResult.surfaces);
          result = {refused:false, section:splitResult.section, surfaces:splitResult.surfaces,
            sectionArcs:splitResult.sectionArcs || [],
            sectionArcCount:splitResult.sectionArcCount || 0,
            identity:identitySummary(splitResult.surfaces),
            positive:splitResult.positive, negative:splitResult.negative,
            validation:Surfaces.validate(splitModel,g),
            certificate:Surfaces.certify(splitModel,g)};
        } else result = {refused:true, diagnostic:splitDiagnostics[0] || null};
      } else if (request.operation === 'intersectionCurves') {
        var curveRefs = request.surfaces || [
          request.from !== undefined ? request.from : request.surface,
          request.with !== undefined ? request.with : request.other
        ];
        var curveFirst = pick(curveRefs[0]), curveSecond = pick(curveRefs[1]);
        if (!curveFirst || !curveSecond) throw new Error('Missing reconstructed surface');
        var promoted = Surfaces.intersectionCurves(Surfaces.intersect(curveFirst,curveSecond));
        if (request.save && promoted) queryCurves[request.save] = promoted[0];
        result = promoted ? {curves:promoted, count:promoted.length} : null;
      } else if (request.operation === 'attach') {
        var attachRefs = request.surfaces || [request.from !== undefined ? request.from : request.surface];
        if (!Array.isArray(attachRefs)) attachRefs = [attachRefs];
        var boundary = request.curve !== undefined ? pickCurve(request.curve) : request.line;
        if (!boundary) throw new Error('Missing analytic boundary curve or line');
        var attached = [], attachDiagnostics = [];
        attachRefs.forEach(function(ref) {
          var source = pick(ref);
          if (!source) throw new Error('Missing reconstructed surface');
          var clone = Surfaces.attachBoundary(source,boundary,g,attachDiagnostics);
          if (!clone) throw new Error(attachDiagnostics.length ? attachDiagnostics[0].message : 'Boundary attachment refused');
          attached.push(clone);
        });
        if (request.save) querySurfaces[request.save] = attached[0];
        var attachModel = modelOf(attached), attachGraph = Surfaces.incidence(attachModel), boundaryUse = null;
        attachGraph.uses.forEach(function(use) {
          if (use.element === boundary) boundaryUse = {useCount:use.useCount, surfaceIds:use.surfaceIds.slice()};
        });
        result = {surfaces:attached, boundary:boundaryUse,
          identity:identitySummary(attached),
          validation:Surfaces.validate(attachModel,g),
          certificate:Surfaces.certify(attachModel,g)};
      } else if (request.operation === 'rebuild') {
        var rebuildRefs = request.surfaces || [
          request.from !== undefined ? request.from : request.surface
        ];
        if (!Array.isArray(rebuildRefs)) rebuildRefs = [rebuildRefs];
        var rebuildSurfaces = rebuildRefs.map(pick).filter(Boolean);
        if (!rebuildSurfaces.length) throw new Error('Missing reconstructed surface');
        var rebuilt = Surfaces.build({vertices:[], curves:[], faces:[],
          surfacePatches:rebuildSurfaces});
        if (request.save && typeof request.save === 'string')
          querySurfaces[request.save] = (rebuilt.surfaces || [])[0];
        result = {surfaces:rebuilt.surfaces, summary:rebuilt.summary,
          diagnostics:rebuilt.diagnostics,
          identity:identitySummary(rebuilt.surfaces)};
      } else if (request.operation === 'intersect-spec') {
        result = Surfaces.intersect(request.a, request.b);
      } else if (request.operation === 'predicate') {
        var Predicates = require('../public/lib/educad-predicates.js');
        var pts = (request.points || []).map(function (p) {
          return {x:p.x, y:p.y, z:p.z};
        });
        if (request.predicate === 'orient3d') result = Predicates.orient3d(pts[0],pts[1],pts[2],pts[3]);
        else if (request.predicate === 'orient2d') result = Predicates.orient2d(pts[0],pts[1],pts[2]);
        else if (request.predicate === 'coplanar') result = Predicates.coplanar(pts[0],pts[1],pts[2],pts[3]);
        else if (request.predicate === 'pointOnPlane') {
          result = Predicates.pointOnPlane(Predicates.point(pts[0]), Predicates.plane(pts[1], pts[2]));
        } else throw new Error('Unknown predicate');
      } else if (request.operation === 'classify') {
        var classifySurface = pick(request.surface);
        if (!classifySurface) throw new Error('Missing reconstructed surface');
        result = Surfaces.classifyPoint(classifySurface, request.point, g);
      } else if (request.operation === 'intersect-bounded') {
        var boundedRefs = request.surfaces || [
          request.from !== undefined ? request.from : request.surface,
          request.with !== undefined ? request.with : request.other
        ];
        var boundedFirst = pick(boundedRefs[0]), boundedSecond = pick(boundedRefs[1]);
        if (!boundedFirst || !boundedSecond) throw new Error('Missing reconstructed surface');
        result = Surfaces.intersectBounded(boundedFirst, boundedSecond, g, request.options);
      } else if (request.operation === 'intersect-bounded-spec') {
        result = Surfaces.intersectBounded(request.a, request.b, g, request.options);
      } else if (request.operation === 'planar-subtract') {
        var subtractFace = request.face !== undefined ? request.face : pick(request.surface);
        if (!subtractFace) throw new Error('Missing planar face');
        var subtractLoop = request.curve !== undefined ? pickCurve(request.curve) : request.loop;
        result = Surfaces.subtractContainedLoop(subtractFace, subtractLoop, g);
      } else if (request.operation === 'topology') {
        var topoRefs = request.surfaces || (g && g.surfaces) || [];
        var topoSurfaces = request.surfaces ?
          topoRefs.map(pick).filter(Boolean) : topoRefs;
        result = Surfaces.topology(modelOf(topoSurfaces), g);
      } else if (request.operation === 'planar-boolean') {
        var planarA = request.a && request.a.kind ? request.a : pick(request.a);
        var planarB = request.b && request.b.kind ? request.b : pick(request.b);
        if (!planarA || !planarB) throw new Error('Missing planar face');
        result = Surfaces.planarBoolean(planarA, planarB,
          request.boolean || request.op || 'union', g);
      } else if (request.operation === 'feature-graph') {
        result = Surfaces.featureGraph(modelOf((g && g.surfaces) || []), g);
      } else if (request.operation === 'silhouettes') {
        result = Surfaces.silhouettes(modelOf((g && g.surfaces) || []),
          request.view || request.direction || 'front', g);
      } else if (request.operation === 'silhouette-hlr') {
        var hlrView = request.view || 'front';
        result = Surfaces.silhouetteHLR(modelOf((g && g.surfaces) || []),
          hlrView, g, function (point) { return P.pointHidden(g, point, hlrView); },
          request.options);
      } else if (request.operation === 'correspondence') {
        var Correspondence = require('../public/lib/educad-correspondence.js');
        result = Correspondence.analyze(table.list(),
          {profileFrame:g && g.profileMap});
      } else if (request.operation === 'correspondence-spec') {
        var CorrespondenceSpec = require('../public/lib/educad-correspondence.js');
        result = CorrespondenceSpec.analyze(request.entities || [],
          {profileFrame:request.profileFrame || null});
      } else if (request.operation === 'constraints') {
        var Constraints = require('../public/lib/educad-constraints.js');
        result = Constraints.analyze(table.list(), {profileFrame:g && g.profileMap});
      } else if (request.operation === 'constraints-spec') {
        var ConstraintsSpec = require('../public/lib/educad-constraints.js');
        result = ConstraintsSpec.analyze(request.entities || [],
          {profileFrame:request.profileFrame || null});
      } else if (request.operation === 'view-state') {
        var ViewState = require('../public/lib/educad-constraints.js');
        result = ViewState.viewState(request.entities || table.list(),
          {hiddenLines:request.hiddenLines, expectedViews:request.expectedViews});
      } else {
        var surface = pick(request.from !== undefined ? request.from : request.surface);
        if (!surface) throw new Error('Missing reconstructed surface');
        if (request.operation === 'section') result = Surfaces.section(surface,request.plane);
        else if (request.operation === 'trim') {
          var trimmed = Surfaces.trim(surface,request.plane,request.keepPositive,g);
          if (request.save && trimmed) querySurfaces[request.save] = trimmed;
          result = trimmed && {surface:trimmed, identity:identitySummary([trimmed]), validation:Surfaces.validate({surfaces:[trimmed]},g),
            certificate:Surfaces.certify({version:1,contract:'analytic-surface-v1',surfaces:[trimmed],diagnostics:[]},g)};
        } else throw new Error('Unknown surface operation');
      }
      if (!Object.prototype.hasOwnProperty.call(request,'expect') || !matches(result,request.expect))
        throw new Error('Expected '+JSON.stringify(request.expect)+', got '+JSON.stringify(result));
    } catch (err) {
      surfaceFailures++;
      errors.push({n:i+1,line:line,message:err.message});
    }
  });
  properties.surfaceChecks = surfaceChecks;
  properties.surfaceQueries = surfaceFailures ? 'issues' : surfaceChecks ? 'ok' : 'none';
  lines.forEach(function (line, i) {
    var match = /^\s*#\s*expect:\s*(.*)$/i.exec(line);
    if (!match) return;
    var tokens = match[1].trim().split(/\s+/);
    tokens.forEach(function (token) {
      var count = /^(\d+)([VEF])$/.exec(token), property = /^([a-zA-Z]+)=(\S+)$/.exec(token);
      var key = count ? count[2] : property ? property[1] : null;
      var expected = count ? Number(count[1]) : property ? (/^\d+$/.test(property[2]) ? Number(property[2]) : property[2]) : null;
      if (!key || !Object.prototype.hasOwnProperty.call(properties, key)) {
        errors.push({ n: i + 1, line: line, message: 'Unknown topology expectation: ' + token });
      } else if (properties[key] !== expected) {
        errors.push({ n: i + 1, line: line, message: key + ': expected ' + expected + ', got ' + properties[key] });
      }
    });
  });
  return {
    ok: errors.length === 0,
    steps: steps,
    errors: errors,
    projectors: proj,
    summary: summary,
    solid: solid,
    properties: properties
  };
}

// Check analytic circles against source ellipse endpoints, independently of
// the display mesh. Inverting the projected basis recovers unit-circle (u,v).
function checkObliqueReprojection(solid, entities) {
  var g = solid && solid.geometry, byId = new Map(entities.map(function(e) {return [e.id,e];}));
  if (!g) return 'none';
  var curves = (g.curves || []).filter(function(c) {return c.oblique;});
  if (!curves.length) return 'none';
  var frame = g.profileMap || (entities.find(function(e) {return e.meta && e.meta.draftingLayout;}) || {meta:{}}).meta.draftingLayout;
  return curves.every(function(c) {
    return c.sourceIds.every(function(id) {
      var e = byId.get(id);
      if (!e || e.type !== 'SEGMENT') return false;
      function project(p, vector) {
        if (e.viewRole === 'PLAN') return [p.x,-p.z];
        if (e.viewRole === 'ELEVATION') return [p.x,p.y];
        if (e.viewRole === 'PROFILE' && frame) return [frame.s*p.z+(vector?0:frame.xRef-frame.s*frame.dRef),p.y];
        return null;
      }
      var center=project(c.center), u=project(c.u,true), v=project(c.v,true);
      if (!center || !u || !v) return false;
      var det=u[0]*v[1]-u[1]*v[0];
      if (Math.abs(det)<1e-9) {
        // Edge-on source: the analytic circle must project to the same line
        // segment, not to a degenerate inverse-basis formula.
        var pts=[];
        for(var k=0;k<=24;k++) {
          var a=c.startAngle+c.sweepAngle*k/24;
          pts.push(project({x:c.center.x+c.radius*(c.u.x*Math.cos(a)+c.v.x*Math.sin(a)),
            y:c.center.y+c.radius*(c.u.y*Math.cos(a)+c.v.y*Math.sin(a)),
            z:c.center.z+c.radius*(c.u.z*Math.cos(a)+c.v.z*Math.sin(a))}));
        }
        var dx=Math.hypot(u[0],u[1])>1e-9?u[0]:v[0];
        var dy=Math.hypot(u[0],u[1])>1e-9?u[1]:v[1];
        var len=Math.hypot(dx,dy);
        if(len<1e-9) return false;
        dx/=len;dy/=len;
        var ts=pts.map(function(p) {return (p[0]-center[0])*dx+(p[1]-center[1])*dy;});
        var lo=Math.min.apply(null,ts),hi=Math.max.apply(null,ts);
        return [[e.x,e.y],[e.x2,e.y2]].every(function(p) {
          var qx=p[0]-center[0],qy=p[1]-center[1],t=qx*dx+qy*dy;
          return Math.abs(qx*dy-qy*dx)<=0.5 && t>=lo-0.5 && t<=hi+0.5;
        });
      }
      return [[e.x,e.y],[e.x2,e.y2]].every(function(p) {
        var x=(p[0]-center[0])/c.radius,y=(p[1]-center[1])/c.radius;
        var a=(x*v[1]-y*v[0])/det,b=(u[0]*y-u[1]*x)/det;
        var angle=((Math.atan2(b,a)-c.startAngle)%(2*Math.PI)+2*Math.PI)%(2*Math.PI);
        return Math.abs(a*a+b*b-1)<=0.08 && (c.kind==='circle' || angle<=c.sweepAngle+0.02 || angle>=2*Math.PI-0.02);
      });
    });
  }) ? 'ok' : 'issues';
}

// Recheck selected planes against the final model, not the selection scores.
function checkObliqueVisibility(solid,entities) {
  var g=solid.geometry,curves=g?(g.curves || []).filter(function(c) {return c.visibilityEvidence;}):[];
  if(!curves.length) return 'none';
  var byId=new Map(entities.map(function(e) {return [e.id,e];})),frame=g.profileMap;
  return curves.every(function(c) {
    return c.visibilityEvidence.sourceIds.every(function(id) {
      var e=byId.get(id);
      if(!e || e.bisCode!=='A' && e.bisCode!=='E') return true;
      function project(p,vector) {
        if(e.viewRole==='PLAN') return [p.x,-p.z];
        if(e.viewRole==='ELEVATION') return [p.x,p.y];
        return [frame.s*p.z+(vector?0:frame.xRef-frame.s*frame.dRef),p.y];
      }
      var center=project(c.center),u=project(c.u,true),v=project(c.v,true);
      var x=(e.x+e.x2)/2-center[0],y=(e.y+e.y2)/2-center[1],det=u[0]*v[1]-u[1]*v[0];
      var angle=Math.atan2((u[0]*y-u[1]*x)/det,(x*v[1]-y*v[0])/det);
      var point={x:c.center.x+c.radius*(c.u.x*Math.cos(angle)+c.v.x*Math.sin(angle)),
        y:c.center.y+c.radius*(c.u.y*Math.cos(angle)+c.v.y*Math.sin(angle)),
        z:c.center.z+c.radius*(c.u.z*Math.cos(angle)+c.v.z*Math.sin(angle))};
      var view=e.viewRole==='PLAN'?'top':e.viewRole==='ELEVATION'?'front':frame.s===-1?'right':'left';
      return P.pointHidden(g,point,view)===(e.bisCode==='E');
    });
  })?'ok':'issues';
}

// F counts logical regions, not the duplicated front/back display loops.
function topologyProperties(solid) {
  var g = solid && solid.geometry;
  if (!g) return { V: 0, E: 0, F: 0, holes: 0, components: 0, closed: 0, open: 0, boundary: 0, curves: 0, minRadius: 0, maxRadius: 0, surfaces: 0, surfaceKinds: 'none', surfaceLoops: 0, surfaceShells: 0, surfaceOpen: 0, surfaceBoundary: 0, surfaceModel: 'none', surfaceCertificate: 'none', surfaceCertificateIssues: 'none', surfaceCertificateChecks: 0, surfaceLineBoundaries: 0, surfaceSharedLineBoundaries: 0, surfaceCurveBoundaries: 0, recesses: 0, fillets: 0, unresolved: (solid && solid.issues || []).length, status: (solid && solid.reason) || 'unavailable' };
  var faces = g.faceRegions || (g.faces || []).map(function (f) { return { outer: f, holes: [] }; });
  var unique = new Map();
  faces.forEach(function (f) {
    var key = f.outer.slice().sort(function(a,b) { return a-b; }).join(',') + '/' + f.holes.map(function(h) { return h.slice().sort(function(a,b) { return a-b; }).join(','); }).sort().join('/');
    unique.set(key, f);
  });
  var uses = {}, adjacency = g.vertices.map(function () { return []; });
  g.edges.forEach(function (e) { adjacency[e[0]].push(e[1]); adjacency[e[1]].push(e[0]); });
  unique.forEach(function (f) { [f.outer].concat(f.holes).forEach(function(loop) {
    loop.forEach(function(a,i) { var b=loop[(i+1)%loop.length], k=a<b?a+'_'+b:b+'_'+a; uses[k]=(uses[k]||0)+1; });
  }); });
  unique.forEach(function(f) { f.holes.forEach(function(h) { adjacency[f.outer[0]].push(h[0]); adjacency[h[0]].push(f.outer[0]); }); });
  var seen = new Set(), components = 0;
  adjacency.forEach(function (_, start) {
    if (seen.has(start)) return;
    components++; var stack=[start]; seen.add(start);
    while(stack.length) adjacency[stack.pop()].forEach(function(v) { if(!seen.has(v)) { seen.add(v); stack.push(v); } });
  });
  var surfaces = g.surfaceComponents || g.components;
  var analytic = g.surfaces || [], model = g.surfaceModel || null, modelCheck = g.analyticSurfaceValidation || null;
  var certificate = g.analyticCertificate || null;
  var certificateIssues = certificate ? Array.from(new Set((certificate.issues || []).map(function(i) { return i.code; }))).sort() : [];
  var boundaryRecords = certificate && Array.isArray(certificate.boundaries) ? certificate.boundaries : [];
  var top = P.projectGeometry(g, 'top'), front = P.projectGeometry(g, 'front');
  return { V: g.vertices.length, E: g.edges.length, F: unique.size,
    holes: Array.from(unique.values()).reduce(function(n,f) { return n+f.holes.length; },0),
    components: components,
    closed: surfaces ? surfaces.filter(function(c) { return c.closed; }).length : (g.solids || []).length,
    open: surfaces ? surfaces.filter(function(c) { return !c.closed; }).length : (g.openSurfaces || []).length,
    boundary: Object.keys(uses).filter(function(k) { return uses[k]===1; }).length,
    profileInferred: g.profileInferred ? 1 : 0,
    topHidden: top.filter(function(e) { return e.hidden; }).length,
    frontHidden: front.filter(function(e) { return e.hidden; }).length,
    splitHidden: top.filter(function(e) { return e.intervals && e.intervals.length > 1; }).length,
    curves: (g.curves || []).length,
    oblique: (g.curves || []).filter(function(c) { return c.oblique; }).length,
    spheres: (g.spheres || []).length,
    surfaces: analytic.length,
    surfaceKinds: analytic.length ? Array.from(new Set(analytic.map(function(s) {return s.kind;}))).sort().join(',') : 'none',
    surfaceLoops: model ? model.boundaryLoops : 0,
    surfaceShells: model ? model.closedShells : 0,
    surfaceOpen: model ? model.openSurfaces : 0,
    surfaceBoundary: modelCheck ? modelCheck.openBoundaries : 0,
    surfaceModel: modelCheck ? modelCheck.status : 'none',
    surfaceCertificate: certificate ? certificate.status : 'none',
    surfaceCertificateIssues: certificateIssues.length ? certificateIssues.join(',') : 'none',
    surfaceCertificateChecks: certificate && certificate.counts ? certificate.counts.checks : 0,
    surfaceLineBoundaries: boundaryRecords.filter(function(b) { return b.kind === 'line'; }).length,
    surfaceSharedLineBoundaries: boundaryRecords.filter(function(b) { return b.kind === 'line' && b.status === 'shared'; }).length,
    surfaceCurveBoundaries: boundaryRecords.filter(function(b) { return b.kind === 'curve'; }).length,
    surfaceValidation: g.surfaceValidation ? g.surfaceValidation.status : 'none',
    recesses: (g.recesses || []).length,
    fillets: (g.fillets || []).length,
    minRadius: (g.curves || []).length ? Math.min.apply(null,g.curves.map(function(c) {return c.radius||0;})) : 0,
    maxRadius: (g.curves || []).length ? Math.max.apply(null,g.curves.map(function(c) {return c.radius||0;})) : 0,
    unresolved: (solid.pipeline && solid.pipeline.diagnostics || []).length,
    status: g.topologyStatus || 'ok' };
}

function solidLine(solid) {
  if (!solid || solid.status !== 'ok' || !solid.geometry) {
    return 'solid: unavailable (' + ((solid && solid.reason) || 'unknown') + ')';
  }
  var g = solid.geometry;
  var f = topologyProperties(solid).F;
  return 'solid: ok — ' + g.vertices.length + 'V ' + g.edges.length + 'E ' + f + 'F' + (g.topologyStatus && g.topologyStatus !== 'inferred' ? ' [' + g.topologyStatus + ']' : '');
}

function report(file, res) {
  var out = [];
  out.push('edc ' + file + ': ' + res.steps.length + ' steps, ' +
    res.summary.count + ' entities' + (res.ok ? ' — CLEAN' : ' — ' + res.errors.length + ' PROBLEM(S)'));
  res.errors.forEach(function (e) {
    out.push('  line ' + (e.n > 0 ? e.n : '-') + ': ' + (e.line !== '' ? e.line + ' => ' : '') + e.message);
  });
  if (!res.summary.hasDatum) out.push('  note: no XY datum on the sheet.');
  if (res.projectors.aligned.length > 0) {
    out.push('  projectors aligned: ' + res.projectors.aligned.join(', '));
  }
  var types = Object.keys(res.summary.byType).map(function (t) {
    return t + ' ' + res.summary.byType[t];
  });
  out.push('  entities: ' + (types.join(', ') || 'none'));
  out.push('  ' + solidLine(res.solid));
  ((res.solid.pipeline || {}).diagnostics || []).forEach(function(d) { out.push('  ' + d.code + (d.entityId ? ' [' + d.entityId + ']' : '') + ': ' + (d.message || d.label)); });
  return out.join('\n');
}

function main(argv) {
  var flags = {solid:false, strict:false, corpus:false, json:false,
    junit:false, requireExpect:false};
  var positional = [], corpusDir = null;
  for (var i = 2; i < argv.length; i++) {
    var arg = argv[i];
    if (arg === '--solid') flags.solid = true;
    else if (arg === '--strict') flags.strict = true;
    else if (arg === '--corpus') {
      flags.corpus = true;
      if (argv[i + 1] && argv[i + 1].charAt(0) !== '-') {
        corpusDir = argv[++i];
      }
    } else if (arg === '--json') flags.json = true;
    else if (arg === '--junit') flags.junit = true;
    else if (arg === '--require-expect') flags.requireExpect = true;
    else if (arg.charAt(0) === '-') {
      console.error('edc: unknown option ' + arg);
      return 2;
    } else positional.push(arg);
  }
  if (flags.corpus) {
    var dir = corpusDir || positional[0] || path.join(__dirname, 'scripts');
    var corpus = runCorpus(dir, {strict:flags.strict, requireExpect:flags.requireExpect});
    if (flags.json) console.log(JSON.stringify(corpus, null, 2));
    else if (flags.junit) console.log(junitReport(corpus));
    else console.log(corpusReport(corpus));
    return corpus.ok ? 0 : 1;
  }
  var file = positional[0];
  if (!file) {
    console.error('Usage: node tools/edc.js [--solid] [--strict] <file.edc|file.edu>');
    console.error('       node tools/edc.js --corpus [dir] [--json|--junit] [--require-expect]');
    return 2;
  }
  var text;
  try {
    text = fs.readFileSync(path.resolve(file), 'utf8');
  } catch (err) {
    console.error('edc: cannot read ' + file);
    return 2;
  }
  var res = runScript(text, { strict: flags.strict });
  console.log(report(file, res));
  if (flags.solid) console.log(JSON.stringify(res.solid));
  return res.ok ? 0 : 1;
}

// Machine-checkable directive count for --require-expect.
function expectationCount(text) {
  return String(text).split(/\r?\n/).filter(function (line) {
    return /^\s*#\s*(expect|surface-query|reject|pose-check):/i.test(line);
  }).length;
}

function runCorpus(dir, options) {
  options = options || {};
  var started = Date.now();
  var files;
  try {
    files = fs.readdirSync(dir).filter(function (f) {
      return /\.(edu|edc)$/.test(f);
    }).sort();
  } catch (err) {
    return {ok:false, error:'cannot read corpus ' + dir, scripts:[], total:0,
      passed:0, failed:1, durationMs:0};
  }
  var scripts = files.map(function (file) {
    var res, error = null, ms = 0;
    try {
      var text = fs.readFileSync(path.join(dir, file), 'utf8');
      var t0 = process.hrtime.bigint();
      res = runScript(text, { strict:options.strict });
      ms = Number(process.hrtime.bigint() - t0) / 1e6;
      var expectations = expectationCount(text);
      res.properties.expectations = expectations;
      if (options.requireExpect && expectations === 0) {
        res.ok = false;
        res.errors.push({n:0, line:'', message:'No expectation directive (# expect, # surface-query, # reject or # pose-check).'});
      }
    } catch (err) {
      error = err && err.message ? err.message : String(err);
      res = {ok:false, errors:[{n:0,line:'',message:error}], properties:{},
        steps:[], summary:{count:0}};
    }
    return {file:file, ok:!!res.ok, ms:Number(ms.toFixed(1)),
      steps:(res.steps || []).length, entities:res.summary ? res.summary.count : 0,
      expectations:res.properties ? res.properties.expectations || 0 : 0,
      errors:(res.errors || []).map(function (e) {
        return {line:e.n || 0, message:e.message};
      })};
  });
  var failed = scripts.filter(function (s) { return !s.ok; }).length;
  return {ok:failed === 0, total:scripts.length, passed:scripts.length - failed,
    failed:failed, durationMs:Date.now() - started, scripts:scripts};
}

function corpusReport(corpus) {
  var out = [];
  corpus.scripts.forEach(function (s) {
    if (s.ok) return;
    out.push('FAIL ' + s.file);
    s.errors.forEach(function (e) {
      out.push('  line ' + (e.line || '-') + ': ' + e.message);
    });
  });
  out.push('edc corpus: ' + corpus.passed + '/' + corpus.total + ' clean' +
    (corpus.failed ? ' — ' + corpus.failed + ' FAILED' : '') +
    ' in ' + corpus.durationMs + ' ms');
  return out.join('\n');
}

function junitEscape(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function junitReport(corpus) {
  var out = ['<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuite name="educad" tests="' + corpus.total + '" failures="' +
      corpus.failed + '" time="' + (corpus.durationMs / 1000).toFixed(3) + '">'];
  corpus.scripts.forEach(function (s) {
    out.push('  <testcase classname="educad" name="' + junitEscape(s.file) +
      '" time="' + (s.ms / 1000).toFixed(3) + '">');
    if (!s.ok) {
      out.push('    <failure message="' +
        junitEscape(s.errors.map(function (e) { return e.message; }).join('; ')) +
        '"/>');
    }
    out.push('  </testcase>');
  });
  out.push('</testsuite>');
  return out.join('\n');
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  runScript: runScript,
  checkProjectors: checkProjectors,
  summarize: summarize,
  report: report,
  runCorpus: runCorpus,
  corpusReport: corpusReport,
  junitReport: junitReport,
  expectationCount: expectationCount
};

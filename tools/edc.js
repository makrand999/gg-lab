'use strict';








var fs = require('fs');
var path = require('path');
var C = require('../public/lib/educad-command.js');
var E = require('../public/lib/educad-entities.js');
var R = require('../public/lib/educad-reconstruct.js');
var P = require('../public/lib/educad-project.js');
var Surfaces = require('../public/lib/educad-surfaces.js');
var Implicit = require('../public/lib/educad-implicit.js');
var Parametric = require('../public/lib/educad-parametric.js');
var Ref3d = require('../public/lib/educad-ref3d.js');
var PoseVerify = require('./pose-verify.js');

function baseName(caption) {
  return String(caption).replace(/['’′]+$/, '').toLowerCase();
}



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
    var corrupt=/^#\s*conic-corrupt:\s*(.*)$/.exec(line);
    if(corrupt) {
      try {
        var spec=JSON.parse(corrupt[1]);
        var group=spec.group;
        var rows=table.list().filter(function(e) {
          return e&&e.type==='SEGMENT'&&e.meta&&e.meta.ellipse&&e.meta.ellipse.group===group;
        });
        if(!rows.length) throw new Error('Unknown conic group '+group);
        var patches={};
        if(spec.mode==='missing') {
          rows.forEach(function(e) {
            patches[e.id]={meta:Object.assign({},e.meta,{centerRef:'absent-center',
              ellipse:Object.assign({},e.meta.ellipse,{centerRef:'absent-center'})})};
          });
        } else if(spec.mode==='wrong-view') {
          var point=E.resolveReference(table.list(),spec.point,'POINT');
          if(!point) throw new Error('Unknown centre point '+spec.point);
          rows.forEach(function(e) {
            patches[e.id]={meta:Object.assign({},e.meta,{centerRef:point.id,
              ellipse:Object.assign({},e.meta.ellipse,{centerRef:point.id})})};
          });
        } else if(spec.mode==='stale') {
          var shift=Number.isFinite(spec.dx)?spec.dx:5;
          rows.forEach(function(e) {
            var def=Object.assign({},e.meta.ellipse,{center:{x:e.meta.ellipse.center.x+shift,
              y:e.meta.ellipse.center.y}});
            patches[e.id]={meta:Object.assign({},e.meta,{ellipse:def})};
          });
        } else if(spec.mode==='edit-segment') {
          var target=rows[Number.isInteger(spec.index)?spec.index:0];
          if(!target) throw new Error('Unknown conic segment index '+spec.index);
          patches[target.id]={x2:target.x2+(Number.isFinite(spec.dx)?spec.dx:1)};
        } else throw new Error('Unknown conic corruption mode '+spec.mode);
        table.updateMany(patches);
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



  var solid = R.reconstruct(table.list(), {identity: options.strict ? 'explicit' : 'auto'});
  var properties = topologyProperties(solid);
  properties.determination=solid.determination||'none';
  if(lines.some(function(line){return /^\s*#\s*expect:.*\bpreview[A-Z]/.test(line);})) {
    var saved=JSON.parse(JSON.stringify(Ref3d.buildPreview(table.list(),R)));
    function faceHoleSignature(holes) {
      return JSON.stringify((holes || []).map(function (hole, index) {
        return hole && hole.length ? [index, hole] : null;
      }).filter(Boolean));
    }
    properties.previewStatus=saved&&saved.status||'none';
    properties.previewDetermination=saved&&saved.determination||'none';
    properties.previewDiagnostics=Array.from(new Set((saved&&saved.issues||[]).map(function(d){return d.code;}))).sort().join(',')||'none';
    properties.previewCertificateScope=saved&&saved.geometry&&saved.geometry.analyticCertificate&&saved.geometry.analyticCertificate.scope||'none';
    properties.previewValidationScope=saved&&saved.geometry&&saved.geometry.analyticSurfaceValidation&&saved.geometry.analyticSurfaceValidation.scope||'none';
    properties.previewPartialSubset=saved&&saved.geometry&&saved.geometry.partialSubset===true?'true':'false';
    var savedTrims=saved&&saved.geometry&&saved.geometry.cavityTrims||null;
    properties.previewTrimStatus=savedTrims&&savedTrims.status||'none';
    properties.previewTrimExactness=savedTrims&&savedTrims.exactness||'none';
    properties.previewTrimVisible=savedTrims&&Number.isFinite(savedTrims.visible)?savedTrims.visible:0;
    properties.previewTrimUnsupported=savedTrims&&Number.isFinite(savedTrims.unsupported)?savedTrims.unsupported:0;
    if(lines.some(function(line){return /^\s*#\s*expect:.*\bsurfaceRevalidationScope\b/.test(line);})) {
      var probe=solid&&solid.geometry?JSON.parse(JSON.stringify(solid.geometry)):null;
      var revalidated=probe&&R.validateSurfaces?R.validateSurfaces(probe):null;
      properties.surfaceRevalidationScope=revalidated&&revalidated.certificate&&revalidated.certificate.scope||'none';
      properties.surfaceRevalidationValidationScope=revalidated&&revalidated.validation&&revalidated.validation.scope||'none';
    }
    properties.previewParity=Ref3d.validPreview(saved)&&saved.status===solid.status&&
      saved.determination===solid.determination&&JSON.stringify(saved.issues)===JSON.stringify(solid.issues||[])&&
      (!solid.geometry||JSON.stringify(saved.geometry.vertices)===JSON.stringify(solid.geometry.vertices)&&
        JSON.stringify(saved.geometry.edges)===JSON.stringify(solid.geometry.edges)&&JSON.stringify(saved.geometry.faces)===JSON.stringify(solid.geometry.faces)&&
        faceHoleSignature(saved.geometry.faceHoles)===faceHoleSignature(solid.geometry.faceHoles)&&
        JSON.stringify(saved.geometry.cavityVolumes||[])===JSON.stringify(solid.geometry.cavityVolumes||[])&&
        JSON.stringify(saved.geometry.cavityRelations||[])===JSON.stringify(solid.geometry.cavityRelations||[])&&
        JSON.stringify(saved.geometry.cavityUnions||[])===JSON.stringify(solid.geometry.cavityUnions||[])&&
        JSON.stringify(saved.geometry.cavityTrims||null)===JSON.stringify(solid.geometry.cavityTrims||null)&&
        JSON.stringify(saved.geometry.displaySync||null)===JSON.stringify(solid.geometry.displaySync||null))?'ok':'issues';
  }
  properties.rejected = rejected;
  var recessDepths=((solid.geometry||{}).recesses||[]).map(function(r){return r.depth;}).filter(Number.isFinite);
  properties.minRecessDepth=recessDepths.length?Math.min.apply(null,recessDepths):0;
  properties.maxRecessDepth=recessDepths.length?Math.max.apply(null,recessDepths):0;
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
  var centred=table.list().filter(function(e){return (e.type==='CIRCLE'||e.type==='CIRCULAR_ARC')&&e.meta&&e.meta.centerRef;});
  properties.centreRefs=centred.length?centred.every(function(e){
    var c=table.get(e.meta.centerRef);
    var view=c&&(c.viewRole==='PLAN'||c.viewRole==='ELEVATION'||c.viewRole==='PROFILE')?c.viewRole:(c&&c.y<0?'PLAN':'ELEVATION');
    return !!c&&c.type==='POINT'&&view===e.viewRole&&Math.abs(c.x-e.x)<1e-9&&Math.abs(c.y-e.y)<1e-9;
  })?'ok':'issues':'none';
  properties.centreEdit=centred.length?centred.every(function(e){
    try {
      var copy=E.createTable();copy.importEntities(JSON.parse(JSON.stringify(table.list())));
      var c=copy.get(e.meta.centerRef);
      var view=c.viewRole==='PLAN'||c.viewRole==='ELEVATION'||c.viewRole==='PROFILE'?c.viewRole:(c.y<0?'PLAN':'ELEVATION');
      var target=view==='PLAN'?{x:c.x+1,y:c.y}:{x:c.x,y:c.y+1};
      require('../public/lib/educad-drafting.js').movePoint(copy,E,c.id,target,(solid.geometry||{}).profileMap||{});
      var changed=copy.get(e.id);
      return Math.abs(changed.x-target.x)<1e-9&&Math.abs(changed.y-target.y)<1e-9;
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
  var projectionCurves=((solid.geometry || {}).curves || []).filter(function(c) {return c.oblique||c.analytic;});
  var obliqueCurves=projectionCurves.filter(function(c) {return c.oblique;});
  properties.oblique=projectionCurves.length;
  properties.analyticConics=projectionCurves.filter(function(c) {return c.analytic;}).length;
  properties.obliqueArcs=obliqueCurves.filter(function(c) {return c.kind==='arc';}).length;
  properties.obliqueVisibility=obliqueCurves.filter(function(c) {return c.visibilityEvidence && c.visibilityEvidence.samples>0;}).length;
  properties.obliqueVisibilityFit=checkObliqueVisibility(solid,table.list());
  properties.arcSweep=obliqueCurves.filter(function(c) {return c.kind==='arc';}).map(function(c) {return Math.round(c.sweepAngle*180/Math.PI);}).sort(function(a,b) {return a-b;}).join(',') || 'none';
  if(/^\d+$/.test(properties.arcSweep)) properties.arcSweep=Number(properties.arcSweep);
  if (projectionCurves.length) {
    var arcPreview = JSON.parse(JSON.stringify(Ref3d.buildPreview(table.list(), R)));
    properties.obliquePreview = Ref3d.validPreview(arcPreview) ? 'ok' : 'issues';
  } else properties.obliquePreview = 'none';
  properties.diagnostics = Array.from(new Set(((solid.pipeline || {}).diagnostics || solid.issues || []).map(function(d) {return d.code;}))).sort().join(',') || 'none';
  var evidenced = ((solid.geometry || {}).curves || []).filter(function(c) {return (c.oblique||c.analytic) && (c.pointEvidence || []).length;});
  properties.obliquePoints = evidenced.reduce(function(n,c) {return n+c.pointEvidence.length;},0);
  properties.obliquePointFit = !evidenced.length ? 'none' : evidenced.every(function(c) {
    return c.pointEvidence.every(function(e) {
      var d={x:e.position.x-c.center.x,y:e.position.y-c.center.y,z:e.position.z-c.center.z};
      if (c.analytic) {
        var ru=Number.isFinite(c.radiusU)?c.radiusU:c.radius;
        var rv=Number.isFinite(c.radiusV)?c.radiusV:c.radius;
        var alpha=(d.x*c.u.x+d.y*c.u.y+d.z*c.u.z)/ru;
        var beta=(d.x*c.v.x+d.y*c.v.y+d.z*c.v.z)/rv;
        var n={x:c.u.y*c.v.z-c.u.z*c.v.y,y:c.u.z*c.v.x-c.u.x*c.v.z,z:c.u.x*c.v.y-c.u.y*c.v.x};
        var plane=Math.abs(d.x*n.x+d.y*n.y+d.z*n.z)/Math.max(ru,rv);
        return Math.abs(Math.hypot(alpha,beta)-1)<=1e-6 && plane<=1e-6;
      }
      var u=d.x*c.u.x+d.y*c.u.y+d.z*c.u.z, v=d.x*c.v.x+d.y*c.v.y+d.z*c.v.z;
      var residual=Math.hypot(d.x-u*c.u.x-v*c.v.x,d.y-u*c.u.y-v*c.v.y,d.z-u*c.u.z-v*c.v.z);
      return residual<=0.5 && Math.abs(Math.hypot(u,v)-c.radius)<=0.5;
    });
  }) ? 'ok' : 'issues';
  var conicCheck=checkConicProjection(solid);
  properties.conicProjection=conicCheck.status;
  properties.conicResidual=conicCheck.residual;
  var conicCurves=((solid.geometry || {}).curves || []).filter(function(c) {return c.analytic;});
  properties.conicDefinitions=!conicCurves.length?'none':conicCurves.every(function(c) {
    return c.sourceExact===true && c.inferred===true && c.fitted===false &&
      c.definition && c.definition.exact===true &&
      Number.isFinite(c.radiusU) && c.radiusU>0 && Number.isFinite(c.radiusV) && c.radiusV>0 &&
      Array.isArray(c.viewDefinitions) && c.viewDefinitions.length>0 &&
      c.viewDefinitions.every(function(v) {return v.kind==='line'||(v.center&&v.a&&v.b);});
  })?'ok':'issues';
  properties.conicJSON=!conicCurves.length?'none':(conicJSONParity(table,solid)?'ok':'issues');
  properties.rawFaces=(solid.geometry&&solid.geometry.faces||[]).length;
  properties.faceBindings=!solid.geometry||!((solid.geometry.surfaces||[]).length)?'none':
    (solid.geometry.surfaces||[]).every(function(s) {
      return !(s.boundaryCurves||[]).length || (s.displayFaceIndices||[]).length>0;
    })?'ok':'issues';




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
        result = Surfaces.intersect(first,second,request.options);
      } else if (request.operation === 'split') {
        var splitSurface = request.surface && request.surface.kind ?
          request.surface : pick(request.from !== undefined ? request.from : request.surface);
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
        result = Surfaces.intersect(request.a, request.b, request.options);
      } else if (request.operation === 'implicit-equation') {
        var implicitSpec = request.spec || (request.surface && request.surface.kind ?
          request.surface : pick(request.surface));
        if (!implicitSpec) throw new Error('Missing implicit surface spec');
        result = implicitSpec.terms ? Implicit.normalizeEquation(implicitSpec) :
          Implicit.equation(implicitSpec, request.options);
        if (!result) throw new Error('Invalid implicit surface spec');
      } else if (request.operation === 'implicit-line') {
        var lineSpec = request.equation || request.spec || request.surface;
        var lineEquation = lineSpec && lineSpec.terms ? Implicit.normalizeEquation(lineSpec) :
          Implicit.equation(lineSpec, request.options);
        if (!lineEquation) throw new Error('Invalid implicit equation');
        if (!request.line) throw new Error('Missing line');
        result = Implicit.lineIntersection(lineEquation, request.line, request.options);
      } else if (request.operation === 'implicit-roots') {
        if (!Array.isArray(request.coefficients)) throw new Error('Missing coefficients');
        result = Implicit.isolateRoots(request.coefficients,
          Number.isFinite(request.from) ? request.from : -1,
          Number.isFinite(request.to) ? request.to : 1, request.options);
      } else if (request.operation === 'implicit-trace') {
        var traceA = request.a && request.a.terms ? Implicit.normalizeEquation(request.a) :
          Implicit.equation(request.a, request.options);
        var traceB = request.b && request.b.terms ? Implicit.normalizeEquation(request.b) :
          Implicit.equation(request.b, request.options);
        if (!traceA || !traceB) throw new Error('Invalid implicit trace equations');
        result = Implicit.trace(traceA, traceB, request.options || {});
      } else if (request.operation === 'implicit-plane-section') {
        var sectionSpec = request.equation || request.surface;
        var sectionEquation = sectionSpec && sectionSpec.terms ?
          Implicit.normalizeEquation(sectionSpec) : Implicit.equation(sectionSpec, request.options);
        if (!sectionEquation || !request.plane) throw new Error('Invalid implicit section input');
        result = Implicit.planeSection(sectionEquation, request.plane, request.options || {});
      } else if (request.operation === 'preview-implicit') {
        var implicitPreview = JSON.parse(JSON.stringify(Ref3d.buildPreview(table.list(), R)));
        var previewSurfaces = implicitPreview && implicitPreview.geometry &&
          implicitPreview.geometry.surfaces || [];
        var liveSurfaces = solid && solid.geometry && solid.geometry.surfaces || [];
        var rebuilt = R.reconstruct(JSON.parse(JSON.stringify(table.list())), {});
        var rebuiltSurfaces = rebuilt && rebuilt.geometry && rebuilt.geometry.surfaces || [];
        function implicitKey(surface) { return JSON.stringify(surface && surface.implicit || null); }
        var liveParity = previewSurfaces.every(function (surface, index) {
          return liveSurfaces[index] && implicitKey(surface) === implicitKey(liveSurfaces[index]);
        });
        var rebuiltParity = previewSurfaces.every(function (surface, index) {
          return rebuiltSurfaces[index] && implicitKey(surface) === implicitKey(rebuiltSurfaces[index]);
        });
        var missing = previewSurfaces.filter(function (surface) { return !surface.implicit; }).length;
        var declared = previewSurfaces.filter(function (surface) {
          return surface.implicit && surface.implicit.identity && surface.implicit.identity.declared === true;
        }).length;
        var previewGenerators = implicitPreview && implicitPreview.geometry &&
          implicitPreview.geometry.generatorLines || [];
        var liveGenerators = solid && solid.geometry && solid.geometry.generatorLines || [];
        var rebuiltGenerators = rebuilt && rebuilt.geometry &&
          rebuilt.geometry.generatorLines || [];
        var generatorSourceIds = [];
        previewGenerators.forEach(function (line) {
          (line.sourceIds || []).forEach(function (id) {
            if (generatorSourceIds.indexOf(id) === -1) generatorSourceIds.push(id);
          });
        });
        result = {valid:Ref3d.validPreview(implicitPreview), count:previewSurfaces.length,
          missing:missing, declared:declared, inferred:previewSurfaces.filter(function (surface) {
            return surface.implicit && surface.implicit.identity &&
              surface.implicit.identity.status === 'inferred';
          }).length,
          liveParity:liveParity, rebuiltParity:rebuiltParity,
          equationParity:liveParity && rebuiltParity ? 'ok' : 'mismatch',
          generatorLineCount:previewGenerators.length,
          generatorSourceIds:generatorSourceIds.sort(),
          generatorLineParity:JSON.stringify(liveGenerators) === JSON.stringify(previewGenerators) &&
            JSON.stringify(rebuiltGenerators) === JSON.stringify(previewGenerators) ? 'ok' : 'mismatch',
          surfaces:previewSurfaces.map(function (surface) {
            return {kind:surface.kind, hasImplicit:!!surface.implicit,
              identity:surface.implicit && surface.implicit.identity || null,
              degree:surface.implicit && surface.implicit.degree,
              contract:surface.implicit && surface.implicit.contract,
              paramChart:surface.implicit && surface.implicit.paramChart || null,
              domain:surface.implicit && surface.implicit.domain || null,
              displayTessellation:surface.displayTessellation || null};
          })};
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
        var classifySurface = request.surface && request.surface.kind ?
          request.surface : pick(request.surface);
        if (!classifySurface) throw new Error('Missing reconstructed surface');
        result = Surfaces.classifyPoint(classifySurface, request.point, g);
      } else if (request.operation === 'normal') {
        var normalSurface = request.surface && request.surface.kind ?
          request.surface : pick(request.surface);
        if (!normalSurface) throw new Error('Missing reconstructed surface');
        result = {normal:Surfaces.surfaceNormal(normalSurface, request.point)};
      } else if (request.operation === 'generator-lines') {
        var generatorLines = (g && g.generatorLines) || [];
        var reprojectionError = 0, surfaceResidual = 0, checkedEdges = 0, edgeBacked = true;
        var checkedSources = 0, missingSource = 0, missingProjection = 0, missingEquation = 0;
        var sourceIntervalError = 0, invalidSourceIntervals = 0, ownershipFailures = 0;
        var ownerPatchIndices = [];
        var profileFrame = g && g.profileMap || null;
        if (!profileFrame) {
          var layoutEntity = table.list().find(function (entity) {
            return entity.meta && entity.meta.draftingLayout;
          });
          profileFrame = layoutEntity ? layoutEntity.meta.draftingLayout : null;
        }
        function projectView(p, role) {
          if (!p) return null;
          if (role === 'PLAN') return {x:p.x, y:-p.z};
          if (role === 'ELEVATION') return {x:p.x, y:p.y};
          if (role === 'PROFILE' && profileFrame)
            return {x:profileFrame.xRef + profileFrame.s*(p.z - profileFrame.dRef), y:p.y};
          return null;
        }
        function ownerPatch(line) {
          if (Number.isInteger(line.surfacePatch) &&
              g.surfacePatches && g.surfacePatches[line.surfacePatch])
            return g.surfacePatches[line.surfacePatch];
          return (g.surfacePatches || []).find(function (patch) {
            return patch && patch.kind === 'implicit' &&
              patch.inference && (patch.inference.generators || []).some(function (generator) {
                return generator.edgeIndex === line.edgeIndex ||
                  (generator.sourceIds || []).some(function (id) {
                    return (line.sourceIds || []).indexOf(id) !== -1;
                  });
              });
          }) || null;
        }
        generatorLines.forEach(function (line) {
          var sourceIds = line.sourceIds || [];
          if (!sourceIds.length) missingSource++;
          var sourceSegments = Array.isArray(line.sourceSegments) && line.sourceSegments.length ?
            line.sourceSegments : null;
          if (sourceSegments) {
            sourceSegments.forEach(function (segment) {
              var source = table.get(segment.id);
              if (!source || source.type !== 'SEGMENT') { missingSource++; return; }
              checkedSources++;
              var from = segment.from, to = segment.to;
              if (!Number.isFinite(from) || !Number.isFinite(to) ||
                  from < -1e-7 || from > 1 + 1e-7 || to < -1e-7 || to > 1 + 1e-7) {
                invalidSourceIntervals++;
                return;
              }
              if (!segment.p || !segment.q) { missingProjection++; return; }
              var expectedFrom = {x:source.x + (source.x2 - source.x)*from,
                y:source.y + (source.y2 - source.y)*from};
              var expectedTo = {x:source.x + (source.x2 - source.x)*to,
                y:source.y + (source.y2 - source.y)*to};
              sourceIntervalError = Math.max(sourceIntervalError,
                Math.hypot(segment.p.x - expectedFrom.x, segment.p.y - expectedFrom.y),
                Math.hypot(segment.q.x - expectedTo.x, segment.q.y - expectedTo.y));
            });
          } else {
            sourceIds.forEach(function (id) {
              var source = table.get(id);
              if (!source || source.type !== 'SEGMENT') { missingSource++; return; }
              checkedSources++;
              var a = projectView(line.base, source.viewRole);
              var b = projectView(line.top, source.viewRole);
              if (!a || !b) { missingProjection++; return; }
              var forward = Math.max(Math.hypot(a.x-source.x,a.y-source.y),
                Math.hypot(b.x-source.x2,b.y-source.y2));
              var reverse = Math.max(Math.hypot(a.x-source.x2,a.y-source.y2),
                Math.hypot(b.x-source.x,b.y-source.y));
              reprojectionError = Math.max(reprojectionError, Math.min(forward, reverse));
            });
          }
          var patch = ownerPatch(line);
          var implicitSurface = null;
          if (patch) {
            var patchIndex = (g.surfacePatches || []).indexOf(patch);
            implicitSurface = patchIndex >= 0 ? (g.surfaces || [])[patchIndex] : null;
          }
          if (!implicitSurface || !implicitSurface.implicit) {
            missingEquation++;
          } else {
            var middle = {x:(line.base.x+line.top.x)/2, y:(line.base.y+line.top.y)/2,
              z:(line.base.z+line.top.z)/2};
            var evaluated = Implicit.evaluate(implicitSurface.implicit, middle);
            if (!evaluated) missingEquation++;
            else {
              var gradient = Math.hypot(evaluated.gradient.x, evaluated.gradient.y,
                evaluated.gradient.z);
              if (gradient > 0) surfaceResidual = Math.max(surfaceResidual,
                Math.abs(evaluated.value)/gradient);
              else missingEquation++;
            }
          }
          if (Number.isInteger(line.edgeIndex) && g.edges[line.edgeIndex]) {
            checkedEdges++;
            var edge = g.edges[line.edgeIndex];
            if (!(Number.isInteger(line.baseVertex) && Number.isInteger(line.topVertex)) ||
                !((edge[0] === line.baseVertex && edge[1] === line.topVertex) ||
                  (edge[1] === line.baseVertex && edge[0] === line.topVertex)))
              edgeBacked = false;
          } else edgeBacked = false;
          var ownedGenerator = !!patch && Number.isInteger(line.surfacePatch) &&
            g.surfacePatches[line.surfacePatch] === patch && patch.inference &&
            (patch.inference.generators || []).some(function (generator) {
              return generator.edgeIndex === line.edgeIndex &&
                (generator.sourceIds || []).some(function (id) {
                  return sourceIds.indexOf(id) !== -1;
                });
            });
          if (!ownedGenerator) ownershipFailures++;
          if (Number.isInteger(line.surfacePatch) && ownerPatchIndices.indexOf(line.surfacePatch) === -1)
            ownerPatchIndices.push(line.surfacePatch);
        });
        var generatorAngles = generatorLines.map(function (line) { return line.u; })
          .sort(function (a, b) { return a-b; });
        var generatorSourceIds = [];
        generatorLines.forEach(function (line) {
          (line.sourceIds || []).forEach(function (id) {
            if (generatorSourceIds.indexOf(id) === -1) generatorSourceIds.push(id);
          });
        });
        result = {count:generatorLines.length, checkedEdges:checkedEdges,
          surfaceEdges:generatorLines.length, edgeBacked:edgeBacked,
          checkedSources:checkedSources, missingSource:missingSource,
          missingProjection:missingProjection, missingEquation:missingEquation,
          reprojectionError:reprojectionError, sourceIntervalError:sourceIntervalError,
          invalidSourceIntervals:invalidSourceIntervals,
          ownershipFailures:ownershipFailures, ownershipParity:ownershipFailures === 0,
          ownerPatchIndices:ownerPatchIndices.slice().sort(function (a,b) { return a-b; }),
          surfaceResidual:surfaceResidual,
          angles:generatorAngles, sourceIds:generatorSourceIds.sort(),
          ok:generatorLines.length > 0 && checkedEdges === generatorLines.length &&
            edgeBacked && missingSource === 0 && missingProjection === 0 &&
            missingEquation === 0 && invalidSourceIntervals === 0 &&
            ownershipFailures === 0 && reprojectionError <= 1e-6 &&
            sourceIntervalError <= 1e-6 && surfaceResidual <= 1e-6};
      } else if (request.operation === 'implicit-evaluate') {
        var evaluateSurface = request.surface && request.surface.kind ?
          request.surface : pick(request.surface);
        if (!evaluateSurface) throw new Error('Missing reconstructed surface');
        var evaluateEquation = evaluateSurface.implicit ?
          Implicit.normalizeEquation(evaluateSurface.implicit) : null;
        if (!evaluateEquation) throw new Error('Missing implicit equation');
        var evaluated = Implicit.evaluate(evaluateEquation, request.point);
        if (!evaluated) throw new Error('Invalid evaluation point');
        var evaluatedGradient = Math.hypot(evaluated.gradient.x, evaluated.gradient.y,
          evaluated.gradient.z);
        result = {value:evaluated.value, gradient:evaluated.gradient,
          gradientNorm:evaluatedGradient,
          residual:evaluatedGradient > 0 ? Math.abs(evaluated.value)/evaluatedGradient : null};
      } else if (request.operation === 'param-partial') {
        var chartEquation;
        if (request.chart) {
          chartEquation = Implicit.normalizeEquation({
            frame:{origin:{x:0,y:0,z:0}, u:{x:1,y:0,z:0},
              v:{x:0,y:1,z:0}, w:{x:0,y:0,z:1}},
            terms:[[1,0,0,0]], paramChart:request.chart});
        } else {
          var chartSurface = request.surface && request.surface.kind ?
            request.surface : pick(request.surface);
          chartEquation = chartSurface && chartSurface.implicit ?
            Implicit.normalizeEquation(chartSurface.implicit) : null;
        }
        if (!chartEquation || !chartEquation.paramChart)
          throw new Error('Missing ruled conic parameter chart');
        var chartU = Number(request.u), chartV = Number(request.v);
        var partial = Implicit.paramPartial(chartEquation, chartU, chartV);
        if (!partial) throw new Error('Parameter partial failed');
        var delta = 1e-6;
        function finitePartial(offset) {
          var before = Implicit.paramPoint(chartEquation, chartU + offset.u,
            chartV + offset.v);
          var after = Implicit.paramPoint(chartEquation, chartU - offset.u,
            chartV - offset.v);
          if (!before || !after) return null;
          return {x:(before.x-after.x)/(2*offset.u || 2*offset.v),
            y:(before.y-after.y)/(2*offset.u || 2*offset.v),
            z:(before.z-after.z)/(2*offset.u || 2*offset.v)};
        }
        var finiteU = finitePartial({u:delta, v:0});
        var finiteV = finitePartial({u:0, v:delta});
        function relativeVector(a, b) {
          if (!a || !b) return Infinity;
          var scale = Math.max(1, Math.hypot(a.x,a.y,a.z), Math.hypot(b.x,b.y,b.z));
          return Math.max(Math.abs(a.x-b.x), Math.abs(a.y-b.y), Math.abs(a.z-b.z))/scale;
        }
        function crossUnit(a, b) {
          if (!a || !b) return null;
          var c = {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x};
          var length = Math.hypot(c.x,c.y,c.z);
          return length > 0 ? {x:c.x/length, y:c.y/length, z:c.z/length} : null;
        }
        var analyticNormal = crossUnit(partial.u, partial.v);
        var finiteNormal = crossUnit(finiteU, finiteV);
        var normalError = analyticNormal && finiteNormal ?
          1 - Math.abs(analyticNormal.x*finiteNormal.x + analyticNormal.y*finiteNormal.y +
            analyticNormal.z*finiteNormal.z) : Infinity;
        var partialError = Math.max(relativeVector(partial.u, finiteU),
          relativeVector(partial.v, finiteV));
        result = {u:partial.u, v:partial.v, maxError:partialError,
          normal:analyticNormal, normalError:normalError,
          ok:partialError <= 1e-5 && normalError <= 1e-5};
      } else if (request.operation === 'trim-inside') {
        var trimVolume = request.volume;
        if (!trimVolume) throw new Error('Missing trim volume');
        var trimBranch = request.branch;
        var trimTolerance = Number.isFinite(request.tolerance) ? request.tolerance : 1e-7;
        var trimResult = trimBranch && trimBranch.kind === 'line' ?
          {ok:true, intervals:Surfaces.trimLineInsideVolume(trimVolume,
            trimBranch.origin, trimBranch.direction, trimTolerance)} :
          Surfaces.trimCurveInsideVolume(trimVolume, trimBranch, trimTolerance);
        var trimIntervals = trimResult && trimResult.intervals || [];
        result = {intervals:trimIntervals, intervalCount:trimIntervals.length,
          empty:trimIntervals.length === 0,
          full:trimIntervals.length === 1 && Math.abs(trimIntervals[0].start) <= 1e-9 &&
            Math.abs(trimIntervals[0].end - 2 * Math.PI) <= 1e-9,
          coincident:trimResult && trimResult.coincident || [],
          reason:trimResult && trimResult.reason || null};
      } else if (request.operation === 'build-spec') {
        var specModel = Surfaces.build({vertices:request.vertices || [],
          curves:request.curves || [], faces:request.faces || [],
          surfacePatches:request.patches || []});
        result = {surfaces:specModel.surfaces, summary:specModel.summary,
          diagnostics:specModel.diagnostics,
          validation:Surfaces.validate(specModel, {vertices:[],curves:request.curves || [],faces:[]}),
          certificate:Surfaces.certify(specModel, {vertices:[],curves:request.curves || [],faces:[]})};
      } else if (request.operation === 'primitive-reconstruct') {
        var primitiveInput = table.list().filter(function (entity) {
          return entity.type !== 'POINT';
        }).map(function (entity) {
          var copy = JSON.parse(JSON.stringify(entity));
          if (copy.type === 'SEGMENT' && copy.meta) {
            delete copy.meta.refs;
            delete copy.meta.endpointRefs;
            delete copy.meta.endpointMemberIds;
            delete copy.meta.fromMemberId;
            delete copy.meta.toMemberId;
          }
          return copy;
        });
        if (request.reverse === true) primitiveInput.reverse();
        var primitiveBefore = JSON.stringify(primitiveInput);
        var primitiveResult = R.reconstruct(primitiveInput, {});
        var primitiveGeometry = primitiveResult.geometry || {};
        var primitiveCurves = primitiveGeometry.curves || [];
        var primitiveSurfaces = primitiveGeometry.surfaces || [];
        result = {status:primitiveResult.status, determination:primitiveResult.determination,
          vertices:(primitiveGeometry.vertices || []).length,
          edges:(primitiveGeometry.edges || []).length,
          faces:(primitiveGeometry.faces || []).length,
          curves:primitiveCurves.length,
          analyticCurves:primitiveCurves.filter(function (curve) { return curve.analytic; }).length,
          pointEvidence:primitiveCurves.map(function (curve) {
            return (curve.pointEvidence || []).length;
          }),
          generatorLines:(primitiveGeometry.generatorLines || []).length,
          generatorSourceIds:Array.from(new Set((primitiveGeometry.generatorLines || [])
            .reduce(function (ids, line) { return ids.concat(line.sourceIds || []); }, []))).sort(),
          generatorEdgesBacked:(primitiveGeometry.generatorLines || []).every(function (line) {
            var edge = primitiveGeometry.edges && primitiveGeometry.edges[line.edgeIndex];
            return !!edge && ((edge[0] === line.baseVertex && edge[1] === line.topVertex) ||
              (edge[1] === line.baseVertex && edge[0] === line.topVertex));
          }),
          generatorOwnership:(primitiveGeometry.generatorLines || []).every(function (line) {
            var patch = primitiveGeometry.surfacePatches &&
              primitiveGeometry.surfacePatches[line.surfacePatch];
            return !!patch && (patch.inference && (patch.inference.generators || [])
              .some(function (generator) {
                return generator.edgeIndex === line.edgeIndex &&
                  (generator.sourceIds || []).some(function (id) {
                    return (line.sourceIds || []).indexOf(id) !== -1;
                  });
              }));
          }),
          mesh:basicMeshAudit(primitiveGeometry),
          implicitKinds:primitiveSurfaces.filter(function (surface) {
            return surface.kind === 'implicit';
          }).map(function (surface) { return surface.analyticKind; }),
          implicitDegrees:primitiveSurfaces.filter(function (surface) {
            return surface.kind === 'implicit' && surface.implicit;
          }).map(function (surface) { return surface.implicit.degree; }),
          meshVolume:signedMeshVolume(primitiveGeometry.vertices, primitiveGeometry.faces),
          surfaces:primitiveSurfaces.map(function (surface) { return surface.kind; }),
          inputUnchanged:JSON.stringify(primitiveInput) === primitiveBefore,
          diagnostics:(primitiveResult.pipeline && primitiveResult.pipeline.diagnostics || [])
            .map(function (diagnostic) { return diagnostic.code; }).sort()};
      } else if (request.operation === 'reference-audit') {
        var auditedInput = JSON.parse(JSON.stringify(table.list()));
        (request.corrupt || []).forEach(function (spec) {
          var target = auditedInput.find(function (entity) { return entity.id === spec.id; });
          if (!target) return;
          target.meta = target.meta || {};
          if (spec.refs) target.meta.refs = spec.refs.slice();
          if (spec.endpointRefs) target.meta.endpointRefs = spec.endpointRefs.slice();
        });
        var auditedBefore = JSON.stringify(auditedInput);
        var audited = R.reconstruct(auditedInput, {});
        var auditedGeometry = audited.geometry || {};
        var auditedGeneratorIds = [];
        (auditedGeometry.generatorLines || []).forEach(function (line) {
          (line.sourceIds || []).forEach(function (id) {
            if (auditedGeneratorIds.indexOf(id) === -1) auditedGeneratorIds.push(id);
          });
        });
        var auditedSurfaceGeneratorIds = [];
        (auditedGeometry.surfacePatches || []).forEach(function (patch) {
          ((patch.inference && patch.inference.generatorSourceIds) || []).forEach(function (id) {
            if (auditedSurfaceGeneratorIds.indexOf(id) === -1) auditedSurfaceGeneratorIds.push(id);
          });
        });
        var auditedConsumed = (audited.pipeline && audited.pipeline.diagnostics || [])
          .map(function (diagnostic) { return diagnostic.code; });
        result = {status:audited.status, determination:audited.determination,
          vertices:(auditedGeometry.vertices || []).length,
          edges:(auditedGeometry.edges || []).length,
          faces:(auditedGeometry.faces || []).length,
          generatorLines:(auditedGeometry.generatorLines || []).length,
          generatorSourceIds:auditedGeneratorIds.sort(),
          surfaceGeneratorSourceIds:auditedSurfaceGeneratorIds.sort(),
          invalidInGeneratorEvidence:auditedGeneratorIds.indexOf(request.invalid) !== -1,
          invalidInSurfaceGeneratorEvidence:auditedSurfaceGeneratorIds.indexOf(request.invalid) !== -1,
          invalidInSurfaceSource:((auditedGeometry.surfacePatches || []).some(function (patch) {
            return (patch.sourceIds || []).indexOf(request.invalid) !== -1;
          })),
          diagnostics:auditedConsumed.sort(),
          issueEntities:Array.from(new Set((audited.issues || []).map(function (issue) {
            return issue.entityId;
          }).filter(Boolean))).sort(),
          inputUnchanged:JSON.stringify(auditedInput) === auditedBefore};
      } else if (request.operation === 'mesh-audit') {
        var auditFaces = g && g.faces || [], auditVertices = g && g.vertices || [];
        var signedVolume = 0, directed = new Map();
        var anchor = {x:0, y:0, z:0};
        if (auditVertices.length) {
          auditVertices.forEach(function (vertex) {
            anchor.x += vertex.x; anchor.y += vertex.y; anchor.z += vertex.z;
          });
          anchor.x /= auditVertices.length; anchor.y /= auditVertices.length;
          anchor.z /= auditVertices.length;
        }
        function anchored(vertex) {
          return vertex ? {x:vertex.x - anchor.x, y:vertex.y - anchor.y,
            z:vertex.z - anchor.z} : null;
        }
        auditFaces.forEach(function (face) {
          for (var i = 0; i < face.length; i++) {
            var a = face[i], b = face[(i + 1) % face.length], key = a + '_' + b;
            directed.set(key, (directed.get(key) || 0) + 1);
          }
          var p0 = anchored(auditVertices[face[0]]);
          for (var j = 1; j < face.length - 1; j++) {
            var p1 = anchored(auditVertices[face[j]]);
            var p2 = anchored(auditVertices[face[j + 1]]);
            if (!p0 || !p1 || !p2) continue;
            signedVolume += (p0.x * (p1.y * p2.z - p1.z * p2.y) -
              p0.y * (p1.x * p2.z - p1.z * p2.x) +
              p0.z * (p1.x * p2.y - p1.y * p2.x)) / 6;
          }
        });
        function validVertex(index) {
          var vertex = Number.isInteger(index) ? auditVertices[index] : null;
          return !!vertex && Number.isFinite(vertex.x) && Number.isFinite(vertex.y) &&
            Number.isFinite(vertex.z);
        }
        var invalidVertexIndices = [], invalidFaces = 0;
        var faceEdgeUse = new Map(), faceEdgePairs = new Map();
        var faceVertexSet = new Set(), faceList = [];
        auditFaces.forEach(function (face, faceIndex) {
          var invalid = false;
          face.forEach(function (index, position) {
            if (!validVertex(index)) {
              invalid = true;
              invalidVertexIndices.push({face:faceIndex, position:position, index:index});
            }
          });
          if (invalid) { invalidFaces++; return; }
          faceList.push(faceIndex);
          face.forEach(function (index) { faceVertexSet.add(index); });
          for (var i = 0; i < face.length; i++) {
            var a = face[i], b = face[(i + 1) % face.length];
            if (a === b) continue;
            var key = Math.min(a, b) + '_' + Math.max(a, b);
            faceEdgeUse.set(key, (faceEdgeUse.get(key) || 0) + 1);
            if (!faceEdgePairs.has(key)) faceEdgePairs.set(key, [Math.min(a, b), Math.max(a, b)]);
          }
        });
        var sameDirection = 0, oppositeDirection = 0, visited = new Set();
        directed.forEach(function (count, key) {
          if (visited.has(key)) return;
          var parts = key.split('_'), reverse = parts[1] + '_' + parts[0];
          visited.add(key); visited.add(reverse);
          var opposite = directed.get(reverse) || 0;
          if (count === 1 && opposite === 1) oppositeDirection++;
          else if (count === 2 && opposite === 0) sameDirection++;
        });
        var openEdges = 0, nonmanifoldEdges = 0;
        faceEdgeUse.forEach(function (count) {
          if (count === 1) openEdges++;
          else if (count > 2) nonmanifoldEdges++;
        });
        var parent = [], roots = new Map();
        faceVertexSet.forEach(function (index) { parent[index] = index; });
        function vertexRoot(index) {
          while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
          return index;
        }
        auditFaces.forEach(function (face) {
          var valid = face.every(validVertex);
          if (!valid || !face.length) return;
          var first = face[0];
          face.slice(1).forEach(function (index) {
            var ra = vertexRoot(first), rb = vertexRoot(index);
            if (ra !== rb) parent[rb] = ra;
          });
        });
        faceVertexSet.forEach(function (index) {
          var rootIndex = vertexRoot(index);
          if (!roots.has(rootIndex)) roots.set(rootIndex, {vertices:new Set(), edges:new Set(), faces:0});
          roots.get(rootIndex).vertices.add(index);
        });
        faceList.forEach(function (faceIndex) {
          var face = auditFaces[faceIndex];
          var rootIndex = vertexRoot(face[0]);
          var component = roots.get(rootIndex);
          component.faces++;
          for (var i = 0; i < face.length; i++) {
            var a = face[i], b = face[(i + 1) % face.length];
            if (a === b) continue;
            component.edges.add(Math.min(a, b) + '_' + Math.max(a, b));
          }
        });
        var componentEulers = [], componentOpenEdges = [], componentNonmanifoldEdges = [];
        roots.forEach(function (component) {
          var componentOpen = 0, componentNonmanifold = 0;
          component.edges.forEach(function (key) {
            var count = faceEdgeUse.get(key) || 0;
            if (count === 1) componentOpen++;
            else if (count > 2) componentNonmanifold++;
          });
          componentOpenEdges.push(componentOpen);
          componentNonmanifoldEdges.push(componentNonmanifold);
          componentEulers.push(component.vertices.size - component.edges.size + component.faces);
        });
        var displayEdgeSet = new Set((g && g.edges || []).map(function (edge) {
          return Math.min(edge[0], edge[1]) + '_' + Math.max(edge[0], edge[1]);
        }));
        var missingDisplayEdges = [];
        faceEdgePairs.forEach(function (pair, key) {
          if (!displayEdgeSet.has(key)) missingDisplayEdges.push(pair);
        });
        var unusedDisplayEdges = [];
        (g && g.edges || []).forEach(function (edge) {
          var key = Math.min(edge[0], edge[1]) + '_' + Math.max(edge[0], edge[1]);
          if (!faceEdgePairs.has(key)) unusedDisplayEdges.push(edge);
        });
        var faceEuler = componentEulers.reduce(function (sum, value) { return sum + value; }, 0);
        result = {volume:signedVolume, faces:auditFaces.length,
          edges:(g && g.edges || []).length, vertices:auditVertices.length,
          euler:auditVertices.length - (g && g.edges || []).length + auditFaces.length,
          oppositeEdges:oppositeDirection, sameDirectionEdges:sameDirection,
          oriented:sameDirection === 0 && oppositeDirection > 0,
          invalidVertexIndices:invalidVertexIndices, invalidVertexCount:invalidVertexIndices.length,
          invalidFaces:invalidFaces,
          openEdges:openEdges, nonmanifoldEdges:nonmanifoldEdges,
          missingDisplayEdges:missingDisplayEdges,
          missingDisplayEdgeCount:missingDisplayEdges.length,
          unusedDisplayEdges:unusedDisplayEdges,
          unusedDisplayEdgeCount:unusedDisplayEdges.length,
          allDisplayEdgesFaceBacked:unusedDisplayEdges.length === 0,
          faceVertices:faceVertexSet.size, faceEdges:faceEdgePairs.size,
          faceEuler:faceEuler, faceComponents:roots.size,
          componentEulers:componentEulers, componentOpenEdges:componentOpenEdges,
          componentNonmanifoldEdges:componentNonmanifoldEdges,
          allFaceEdgesOpposite:invalidVertexIndices.length === 0 && openEdges === 0 &&
            nonmanifoldEdges === 0 && sameDirection === 0 &&
            missingDisplayEdges.length === 0};
      } else if (request.operation === 'torus-parameters') {
        result = Surfaces.torusParameters(request.surface, request.point) || {};
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
      } else if (request.operation === 'visibility') {
        result = {hidden:!!P.pointHidden(g,request.point,request.view||'front')};
      } else if (request.operation === 'edge-visibility') {
        var edgeView = request.view || 'front', edgeSegments = P.projectSolid(g.vertices,
          g.edges || [], g.faces || [], edgeView, g.profileMap, g.faceHoles || []);
        var best = -1, bestDistance = Infinity;
        (g.edges || []).forEach(function (edge, index) {
          var a = g.vertices[edge[0]], b = g.vertices[edge[1]];
          var mid = {x:(a.x+b.x)/2, y:(a.y+b.y)/2, z:(a.z+b.z)/2};
          var target = request.point || (request.edge && {
            x:(request.edge.a.x+request.edge.b.x)/2,
            y:(request.edge.a.y+request.edge.b.y)/2,
            z:(request.edge.a.z+request.edge.b.z)/2});
          if (!target) return;
          var distance = Math.hypot(mid.x-target.x,mid.y-target.y,mid.z-target.z);
          if (distance < bestDistance) { bestDistance = distance; best = index; }
        });
        result = {edge:best, distance:best >= 0 ? bestDistance : null,
          hidden:best >= 0 && edgeSegments[best] ? !!edgeSegments[best].hidden : null,
          intervals:best >= 0 && edgeSegments[best] ? edgeSegments[best].intervals.length : 0};
      } else if (request.operation === 'display-holes') {
        var displayHoles = (g && g.faceHoles) || [];
        result = {count:displayHoles.reduce(function (n, holes) { return n + (holes || []).length; }, 0),
          faces:displayHoles.map(function (holes, fi) {
            return {face:fi, count:(holes || []).length,
              vertices:(holes || []).map(function (hole) { return hole.length; })};
          }).filter(function (face) { return face.count; })};
      } else if (request.operation === 'display-sync-spec') {
        var syncGeometry = JSON.parse(JSON.stringify(request.geometry || {}));
        var syncModel = request.model ? JSON.parse(JSON.stringify(request.model)) : null;
        var syncModelBefore = syncModel ? JSON.stringify(syncModel) : null;
        var sourceBefore = JSON.stringify({
          vertices:syncGeometry.vertices || [], curves:syncGeometry.curves || [],
          faces:syncGeometry.faces || [],
          patches:(syncGeometry.surfacePatches || []).map(function (patch) {
            return {kind:patch.kind, outer:patch.outer || null,
              boundaryCurves:patch.boundaryCurves || null, faceIndices:patch.faceIndices || null};
          })
        });
        var repeats = Number.isInteger(request.repeats) && request.repeats > 0 ? request.repeats : 1;
        var signature = null, stable = true, syncResult = null, syncDiagnostics = [];
        for (var repeat = 0; repeat < repeats; repeat++) {
          var modelNow = syncModel ? JSON.parse(JSON.stringify(syncModel)) : Surfaces.build(syncGeometry);
          syncResult = Surfaces.syncDisplayHoles(modelNow, syncGeometry);
          var repeatDiagnostics = syncResult.diagnostics || [];
          repeatDiagnostics.forEach(function (diagnostic) {
            if (!syncDiagnostics.some(function (existing) { return existing.code === diagnostic.code; }))
              syncDiagnostics.push(diagnostic);
          });
          if (!syncModel) {
            syncGeometry.surfaceModel = modelNow.summary;
          }
          syncGeometry.surfaces = modelNow.surfaces;
          syncGeometry.displaySync = {status:repeatDiagnostics.length ? 'issues' : 'ok',
            holes:syncResult.holes || 0, diagnostics:repeatDiagnostics.slice()};
          var currentSignature = JSON.stringify({
            holes:syncGeometry.faceHoles || [],
            patches:(syncGeometry.surfacePatches || []).map(function (patch) { return patch.innerCurves || []; }),
            loops:(modelNow.surfaces || []).map(function (surface) { return surface.loops || []; })
          });
          if (signature !== null && currentSignature !== signature) stable = false;
          signature = currentSignature;
        }
        var sourceAfter = JSON.stringify({
          vertices:syncGeometry.vertices || [], curves:syncGeometry.curves || [],
          faces:syncGeometry.faces || [],
          patches:(syncGeometry.surfacePatches || []).map(function (patch) {
            return {kind:patch.kind, outer:patch.outer || null,
              boundaryCurves:patch.boundaryCurves || null, faceIndices:patch.faceIndices || null};
          })
        });
        var syncCodes = Array.from(new Set(syncDiagnostics.map(function (diagnostic) { return diagnostic.code; }))).sort();
        var syncHoleCounts = (syncGeometry.faceHoles || []).map(function (hole) { return hole.length; });
        var previewGeometry = JSON.parse(JSON.stringify({
          name:syncGeometry.name || 'display sync fixture',
          vertices:syncGeometry.vertices || [], edges:syncGeometry.edges || [],
          faces:syncGeometry.faces || [], faceHoles:syncGeometry.faceHoles || [],
          curves:syncGeometry.curves || [], surfacePatches:syncGeometry.surfacePatches || [],
          surfaces:syncGeometry.surfaces || [], surfaceModel:syncGeometry.surfaceModel || null,
          displaySync:syncGeometry.displaySync
        }));
        var previewObject = {status:'ok', determination:'inferred', label:'', issues:[],
          geometry:previewGeometry};
        var previewValid = Ref3d.validPreview(previewObject);
        var visibility = null, previewVisibility = null;
        if (Array.isArray(request.visibility)) {
          visibility = {};
          previewVisibility = {};
          request.visibility.forEach(function (item) {
            if (!item || !item.name || !item.point) return;
            visibility[item.name] = !!P.pointHidden(syncGeometry, item.point, item.view || 'front');
            previewVisibility[item.name] = !!P.pointHidden(previewGeometry, item.point, item.view || 'front');
          });
        }
        var propagation = {status:'ok', determination:request.resultDetermination || 'inferred',
          label:'', issues:[], geometry:syncGeometry,
          pipeline:{version:1, input:'vertices-edges-curves', identity:'inferred',
            stage:'surface-inference', diagnostics:[]}};
        R.mergeDisplaySyncResult(propagation);
        var propagationIssues = Array.from(new Set((propagation.issues || []).map(function (issue) {
          return issue.code;
        }))).sort();
        var propagationPipeline = Array.from(new Set(((propagation.pipeline || {}).diagnostics || [])
          .map(function (issue) { return issue.code; }))).sort();
        result = {
          holes:syncHoleCounts.reduce(function (count, length) { return count + length; }, 0),
          faceHoleCounts:syncHoleCounts,
          diagnostics:syncCodes.length ? syncCodes.join(',') : 'none',
          displaySync:syncGeometry.displaySync.status,
          displaySyncIssues:syncCodes.length ? syncCodes.join(',') : 'none',
          modelSurfaces:syncGeometry.surfaces ? syncGeometry.surfaces.length : 0,
          modelLoops:syncGeometry.surfaces ? syncGeometry.surfaces.reduce(function (count, surface) {
            return count + (surface.loops || []).length;
          }, 0) : 0,
          stable:stable,
          sourceUnchanged:sourceBefore === sourceAfter && (!syncModel || syncModelBefore === JSON.stringify(syncModel)),
          serializationValid:previewValid,
          serializationParity:previewValid &&
            JSON.stringify(previewGeometry.faceHoles) === JSON.stringify(syncGeometry.faceHoles) &&
            JSON.stringify(previewGeometry.displaySync) === JSON.stringify(syncGeometry.displaySync) ? 'ok' : 'issues',
          serializationDisplaySync:previewGeometry.displaySync ? previewGeometry.displaySync.status : 'none',
          serializationFaceHoleCounts:(previewGeometry.faceHoles || []).map(function (hole) { return hole.length; }),
          visibility:visibility,
          serializationVisibility:previewVisibility,
          serializationVisibilityParity:visibility &&
            JSON.stringify(visibility) === JSON.stringify(previewVisibility) ? 'ok' : 'none',
          resultDetermination:propagation.determination,
          resultIssues:propagationIssues.length ? propagationIssues.join(',') : 'none',
          resultPipeline:propagationPipeline.length ? propagationPipeline.join(',') : 'none',
          resultLabelDisplaySync:/displayed host face/.test(propagation.label || '')
        };
      } else if (request.operation === 'cavity-spec') {
        var CavitySpec = require('../public/lib/educad-cavity-boolean.js');
        if (request.action === 'union') {
          var specUnion = CavitySpec.union(request.volumes || [], request.options || {});
          result = {metrics:specUnion.metrics, mouthArea:specUnion.mouthArea,
            mouthLoops:specUnion.mouths.map(function (mouth) { return mouth.loops.length; }),
            mouthVertices:specUnion.mouths.reduce(function (count, mouth) {
              return count + mouth.loops.reduce(function (n, loop) { return n + loop.length; }, 0);
            }, 0)};
        } else if (request.action === 'support') {
          result = {support: request.volume ? CavitySpec.support(request.volume, request.direction) :
            CavitySpec.support(request.a, request.direction)};
        } else {
          result = CavitySpec.relation(request.a, request.b);
        }
      } else if (request.operation === 'cavity') {
        var CavityBoolean = require('../public/lib/educad-cavity-boolean.js');
        var action = request.action || 'summary';
        var unions = g && g.cavityUnions || [];
        var cavityVolumes = g && g.cavityVolumes || [];
        if (action === 'relations') {
          if (request.a !== undefined && request.b !== undefined &&
              cavityVolumes[request.a] && cavityVolumes[request.b]) {
            result = CavityBoolean.relation(cavityVolumes[request.a], cavityVolumes[request.b]);
          } else result = {relations:g && g.cavityRelations || []};
        } else if (action === 'buried') {
          var buriedTolerance = Number.isFinite(request.tolerance) ? request.tolerance : 1e-3;
          var minVolumes = Number.isInteger(request.minVolumes) ? request.minVolumes : 2;
          var buriedFaces = [], buriedCount = 0, buriedBoth = 0, maxDepth = 0;
          (g && g.faces || []).forEach(function (face, faceIndex) {
            var centroid = {x:0, y:0, z:0};
            face.forEach(function (vertex) {
              centroid.x += g.vertices[vertex].x;
              centroid.y += g.vertices[vertex].y;
              centroid.z += g.vertices[vertex].z;
            });
            centroid.x /= face.length;
            centroid.y /= face.length;
            centroid.z /= face.length;
            var hits = [], depth = Infinity;
            cavityVolumes.forEach(function (volume, volumeIndex) {
              if (volume.absorbed === true && request.includeAbsorbed !== true) return;
              var distance = CavityBoolean.signedDistanceToVolume(volume, centroid);
              if (distance < -buriedTolerance) {
                hits.push(volumeIndex);
                depth = Math.min(depth, -distance);
              }
            });
            if (hits.length >= minVolumes) {
              buriedCount++;
              if (hits.length > 1) buriedBoth++;
              maxDepth = Math.max(maxDepth, depth);
              buriedFaces.push({face:faceIndex, volumes:hits, depth:depth});
            }
          });
          result = {count:buriedCount, both:buriedBoth, faces:buriedFaces,
            maxDepth:maxDepth, tolerance:buriedTolerance, minVolumes:minVolumes};
        } else if (action === 'mouths') {
          var mouthCurves = ((g && g.curves) || []).filter(function (curve) {
            return curve && curve.unionMouth;
          });
          var mouthLoops = [], mouthArea = 0;
          mouthCurves.forEach(function (curve) {
            var points = (curve.displayVertices || []).map(function (index) {
              return g.vertices[index];
            }).filter(Boolean);
            var areaVector = {x:0, y:0, z:0};
            var origin = points[0];
            for (var i = 1; i + 1 < points.length; i++) {
              var a = points[i], b = points[i + 1];
              var one = {x:a.x - origin.x, y:a.y - origin.y, z:a.z - origin.z};
              var two = {x:b.x - origin.x, y:b.y - origin.y, z:b.z - origin.z};
              areaVector.x += one.y*two.z - one.z*two.y;
              areaVector.y += one.z*two.x - one.x*two.z;
              areaVector.z += one.x*two.y - one.y*two.x;
            }
            var area = Math.hypot(areaVector.x, areaVector.y, areaVector.z) / 2;
            mouthArea += area;
            mouthLoops.push({vertices:points.length, area:area,
              closure:curve.hostSurfaceId ? 'host' : 'open'});
          });
          result = {count:mouthCurves.length, loops:mouthLoops, area:mouthArea,
            faceHoles:(g && g.faceHoles || []).reduce(function (count, holes) {
              return count + (holes || []).length;
            }, 0)};
        } else if (action === 'volume') {
          result = {unions:unions.map(function (union) {
            return {volume:union.volume, mouthArea:union.mouthArea,
              closed:union.closed, openEdges:union.openEdges,
              nonmanifoldEdges:union.nonmanifoldEdges,
              approximate:union.approximate, members:union.members.length};
          })};
        } else {
          result = {volumes:cavityVolumes.length, recesses:(g && g.recesses || []).length,
            unions:unions.length,
            absorbed:(g && g.recesses || []).filter(function (record) {
              return record.absorbed === true;
            }).length,
            approximate:unions.filter(function (union) {
              return union.approximate === true;
            }).length,
            duplicateOf:(g && g.cavityUnions || []).reduce(function (list, union) {
              (union.members || []).forEach(function (member) {
                if (member.duplicateOf !== null && member.duplicateOf !== undefined)
                  list.push({volume:member.volume, duplicateOf:member.duplicateOf});
              });
              return list;
            }, []),
            relations:(g && g.cavityRelations || []).map(function (pair) {
              return {a:pair.a, b:pair.b, relation:pair.relation};
            })};
        }
      } else if (request.operation === 'cavity-trims' || request.operation === 'cavity-trims-spec') {
        var trimGeometry = request.operation === 'cavity-trims-spec' ? {
          surfaces:[], cavityVolumes:request.volumes || [],
          cavityRelations:request.relations || [], cavityUnions:request.unions || []
        } : g;
        var trims = request.operation === 'cavity-trims-spec' ? null :
          trimGeometry && trimGeometry.cavityTrims;
        if (!trims && Surfaces.cavityTrims)
          trims = Surfaces.cavityTrims({surfaces:(trimGeometry&&trimGeometry.surfaces)||[]},
            trimGeometry);
        if (!trims) throw new Error('Missing cavity trim metadata');
        function trimPoint(p) {
          if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))
            return null;
          if (request.relativeTo && Number.isFinite(request.relativeTo.x) &&
              Number.isFinite(request.relativeTo.y) && Number.isFinite(request.relativeTo.z))
            return {x:p.x - request.relativeTo.x, y:p.y - request.relativeTo.y,
              z:p.z - request.relativeTo.z};
          return {x:p.x, y:p.y, z:p.z};
        }
        function trimBoundary(b) {
          return {kind:b.kind, role:b.role, status:b.status, reason:b.reason || null,
            supportStatus:b.supportStatus, boundsStatus:b.boundsStatus,
            exposureStatus:b.exposureStatus,
            center:trimPoint(b.center), radius:b.radius, radiusU:b.radiusU,
            radiusV:b.radiusV, start:trimPoint(b.start),
            end:trimPoint(b.end), startAngle:b.startAngle, sweepAngle:b.sweepAngle,
            events:(b.events || []).map(function (event) {
              return {kind:event.kind, source:event.source, member:event.member,
                t:event.t, residual:event.residual};
            }),
            eventCount:b.eventCount, residual:b.residual,
            residualKnown:b.residualKnown, coincident:b.coincident,
            coincidentCount:b.coincidentCount,
            memberVolumes:b.memberVolumes, surfaceIds:b.surfaceIds,
            sourceIds:b.sourceIds, supportKind:b.supportKind,
            supportRelation:b.supportRelation, classification:b.classification,
            boundsMethod:b.boundsMethod, unionDomainSubtraction:b.unionDomainSubtraction,
            domain:b.domain};
        }
        function trimOrder(a, b) {
          function key(value) {
            if (Array.isArray(value)) return value.join(',');
            if (value && typeof value === 'object')
              return [value.x, value.y, value.z].map(function (n) {
                return Number.isFinite(n) ? n.toFixed(9) : '';
              }).join(',');
            return String(value);
          }
          return [key(a.memberVolumes), key(a.role), key(a.kind), key(a.center),
            key(a.start), key(a.startAngle)].join('|').localeCompare(
            [key(b.memberVolumes), key(b.role), key(b.kind), key(b.center),
              key(b.start), key(b.startAngle)].join('|'));
        }
        var trimBoundaries = (trims.boundaries || []).filter(function (b) {
          return b.role === 'boundary';
        }).map(trimBoundary).sort(trimOrder);
        var trimInternal = (trims.boundaries || []).filter(function (b) {
          return b.role === 'internal';
        }).map(trimBoundary).sort(trimOrder);
        var trimContacts = (trims.boundaries || []).filter(function (b) {
          return b.role === 'contact';
        }).map(trimBoundary).sort(trimOrder);
        if (request.kind) {
          trimBoundaries = trimBoundaries.filter(function (b) { return b.kind === request.kind; });
          trimInternal = trimInternal.filter(function (b) { return b.kind === request.kind; });
          trimContacts = trimContacts.filter(function (b) { return b.kind === request.kind; });
        }
        if (Array.isArray(request.members)) {
          function sameMembers(values) {
            return Array.isArray(values) && values.length === request.members.length &&
              values.every(function (value, index) { return value === request.members[index]; });
          }
          trimBoundaries = trimBoundaries.filter(function (b) { return sameMembers(b.memberVolumes); });
          trimInternal = trimInternal.filter(function (b) { return sameMembers(b.memberVolumes); });
          trimContacts = trimContacts.filter(function (b) { return sameMembers(b.memberVolumes); });
        }
        var trimSupports = [];
        (trims.pairs || []).forEach(function (pair) {
          if (Array.isArray(request.members) &&
              !(pair.a === request.members[0] && pair.b === request.members[1])) return;
          (pair.supports || []).forEach(function (support) {
            trimSupports.push({a:pair.a, b:pair.b, aRole:support.aRole, bRole:support.bRole,
              status:support.status, kind:support.kind, reason:support.reason,
              supportStatus:support.supportStatus, boundsStatus:support.boundsStatus,
              exposureStatus:support.exposureStatus, support:support.support,
              aSurfaceId:support.aSurfaceId, bSurfaceId:support.bSurfaceId,
              excluded:support.excluded});
          });
        });
        function trimSupportList(status) {
          return trimSupports.filter(function (support) { return support.status === status; });
        }
        result = {contract:trims.contract, version:trims.version, status:trims.status,
          exactness:trims.exactness, pairCount:(trims.pairs || []).length,
          boundaryCount:trims.boundaryCount || 0, visible:trims.visible || 0,
          internal:trims.internal || 0, contact:trims.contact || 0,
          unsupported:trims.unsupported || 0, unresolved:trims.unresolved || 0,
          numeric:trims.numeric || 0, exact:trims.exact || 0,
          matchedBoundaries:trimBoundaries.length,
          matchedInternal:trimInternal.length,
          matchedContacts:trimContacts.length,
          matchedSupports:trimSupports.length,
          boundaries:trimBoundaries, internalBoundaries:trimInternal,
          contactBoundaries:trimContacts,
          unsupportedSupports:trimSupportList('unsupported'),
          unresolvedSupports:trimSupportList('unresolved'),
          numericSupports:trimSupportList('numeric'),
          coincidentSupports:trimSupports.filter(function (support) {
            return support.kind === 'coincident' || support.kind === 'plane-overlap';
          }),
          pairs:(trims.pairs || []).map(function (pair) {
            return {a:pair.a, b:pair.b, relation:pair.relation, status:pair.status,
              exactness:pair.exactness, kind:pair.kind, reason:pair.reason,
              boundaries:pair.boundaries,
              supports:(pair.supports || []).map(function (support) {
                return {aRole:support.aRole, bRole:support.bRole, status:support.status,
                  kind:support.kind, reason:support.reason,
                  supportStatus:support.supportStatus, boundsStatus:support.boundsStatus,
                  exposureStatus:support.exposureStatus, support:support.support,
                  aSurfaceId:support.aSurfaceId, bSurfaceId:support.bSurfaceId,
                  excluded:support.excluded};
              })};
          }),
          diagnostics:(trims.diagnostics || []).map(function (diagnostic) {
            return {code:diagnostic.code, pair:diagnostic.pair,
              surfaceIds:diagnostic.surfaceIds};
          })};
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
      } else if (request.operation === 'silhouettes-spec') {
        result = Surfaces.silhouettes({version:1, contract:'analytic-surface-v1',
          surfaces:request.surfaces || [], diagnostics:[]},
          request.view || request.direction || 'front',
          request.geometry || {vertices:[], curves:[]});
      } else if (request.operation === 'silhouette-hlr-spec') {
        var hlrSpecView = request.view || 'front';
        result = Surfaces.silhouetteHLR({version:1, contract:'analytic-surface-v1',
          surfaces:request.surfaces || [], diagnostics:[]}, hlrSpecView,
          request.geometry || {vertices:[], curves:[]},
          function () { return request.hideAll === true; }, request.options);
      } else if (request.operation === 'curve-point-spec') {
        result = Surfaces.point(request.curve, request.t || 0);
      } else if (request.operation === 'section-branch-point') {
        var branchSection = Surfaces.section(request.surface, request.plane);
        var branchIndex = request.branch === undefined ? 0 : request.branch;
        var branchCurve = branchSection && branchSection.branches &&
          branchSection.branches[branchIndex];
        if (!branchCurve) throw new Error('Missing torus section branch');
        result = Surfaces.point(branchCurve, request.t === undefined ?
          branchCurve.uStart : request.t);
      } else if (request.operation === 'intersect-branch-point') {
        var quadricResult = Surfaces.intersect(request.a, request.b);
        var quadricIndex = request.branch === undefined ? 0 : request.branch;
        var quadricCurve = quadricResult && quadricResult.branches &&
          quadricResult.branches[quadricIndex];
        if (!quadricCurve) throw new Error('Missing quadric intersection branch');
        result = Surfaces.point(quadricCurve, request.t === undefined ?
          quadricCurve.uStart : request.t);
      } else if (request.operation === 'correspondence') {
        var Correspondence = require('../public/lib/educad-correspondence.js');
        result = Correspondence.analyze(table.list(),
          {profileFrame:g && g.profileMap});
      } else if (request.operation === 'correspondence-spec') {
        var CorrespondenceSpec = require('../public/lib/educad-correspondence.js');
        result = CorrespondenceSpec.analyze(request.entities || [],
          {profileFrame:request.profileFrame || null});
      } else if (request.operation === 'preview-spec') {
        result={valid:Ref3d.validPreview(request.preview)};
      } else if (request.operation === 'reconstruct') {
        var imported=JSON.parse(JSON.stringify(table.list()));
        (request.entityPatches||[]).forEach(function(change) {
          var row=imported.find(function(e){return e.id===change.entityId;});
          if(!row)throw new Error('Missing drawing entity '+change.entityId);
          var patch=Object.assign({},change.patch);
          if(patch.meta)patch.meta=Object.assign({},row.meta,patch.meta);
          Object.assign(row,patch);
        });
        (request.curvePatches||[]).forEach(function(change) {
          var row=imported.find(function(e){return e.id===change.entityId;});
          if(!row||row.type!=='CURVE'||!row.meta||!row.meta.curve)throw new Error('Missing parametric curve '+change.entityId);
          Object.assign(row.meta.curve,change.definition);
        });
        var inputBefore=JSON.stringify(imported);
        var rebuilt=R.reconstruct(imported,request.options||{}),persisted=Ref3d.buildPreview(imported,R);
        result={status:rebuilt.status,determination:rebuilt.determination,
          vertices:((rebuilt.geometry||{}).vertices||[]).length,
          identity:rebuilt.pipeline&&rebuilt.pipeline.identity,
          recesses:(rebuilt.geometry||{}).recesses||[],
          surfaceKinds:Array.from(new Set(((rebuilt.geometry||{}).surfaces||[]).map(function(s){return s.kind;}))).sort(),
          surfaceCertificateStatus:((rebuilt.geometry||{}).analyticCertificate||{}).status,
          curves:((rebuilt.geometry||{}).curves||[]).length,
          diagnostics:Array.from(new Set((rebuilt.issues||[]).map(function(d){return d.code;}))).sort(),
          previewStatus:persisted.status,previewDetermination:persisted.determination,
          previewIdentity:persisted.pipeline&&persisted.pipeline.identity,
          previewVertices:((persisted.geometry||{}).vertices||[]).length,
          sourceUnchanged:JSON.stringify(imported)===inputBefore,
          previewValid:Ref3d.validPreview(persisted)};
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
        var surface = request.surface && request.surface.kind ?
          request.surface : pick(request.from !== undefined ? request.from : request.surface);
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




  var conicChecks = 0, conicFailures = 0;
  lines.forEach(function (line, i) {
    var query = /^\s*#\s*conic-query:\s*(.*)$/i.exec(line);
    if (!query) return;
    conicChecks++;
    try {
      var request = JSON.parse(query[1]), g = solid && solid.geometry;
      var curves = ((g && g.curves) || []).filter(function (c) { return c && c.analytic; });
      var curve = null;
      if (typeof request.group === 'string')
        curve = curves.find(function (c) { return (c.sourceGroups || []).indexOf(request.group) !== -1; });
      if (!curve && Number.isInteger(request.index)) curve = curves[request.index];
      if (!curve) curve = curves[0];
      if (!curve) throw new Error('Missing analytic conic');
      var residual = conicProjectionResidual(curve, g && g.profileMap);
      var axes = conicAxes(curve);
      var normal = curve.definition && curve.definition.normal;
      if (!normal) normal = {x:curve.u.y*curve.v.z-curve.u.z*curve.v.y,
        y:curve.u.z*curve.v.x-curve.u.x*curve.v.z, z:curve.u.x*curve.v.y-curve.u.y*curve.v.x};
      var curveIndex = (g.curves || []).indexOf(curve);
      var volume = conicAnalyticVolume(g, curveIndex);
      var result = {count:curves.length, kind:curve.kind, center:curve.center,
        axes:[axes.u,axes.v], normal:normal, closed:curve.closed === true,
        sweep:curve.sweepAngle, exact:curve.exact, sourceExact:curve.sourceExact,
        inferred:curve.inferred, fitted:curve.fitted, analytic:curve.analytic,
        definition:curve.definition, sourceGroups:curve.sourceGroups,
        sourceIds:curve.sourceIds, viewDefinitions:curve.viewDefinitions,
        projectionResidual:residual.max, projectionOk:residual.max <= 1e-7,
        jsonParity:conicJSONParity(table, solid), analyticVolume:volume.volume,
        volumePatch:volume.patch};
      if (!Object.prototype.hasOwnProperty.call(request, 'expect') || !matches(result, request.expect))
        throw new Error('Expected ' + JSON.stringify(request.expect) + ', got ' + JSON.stringify(result));
    } catch (err) {
      conicFailures++;
      errors.push({n:i+1, line:line, message:err.message});
    }
  });
  properties.conicChecks = conicChecks;
  properties.conicQueries = conicFailures ? 'issues' : conicChecks ? 'ok' : 'none';




  var ellipseGroups = new Map();
  table.list().forEach(function (e) {
    if (!e || e.type !== 'SEGMENT' || !e.meta || !e.meta.ellipse) return;
    var def = e.meta.ellipse, group = def && def.group;
    if (!group) return;
    if (!ellipseGroups.has(group)) ellipseGroups.set(group, []);
    ellipseGroups.get(group).push(e);
  });
  properties.ellipseGroups = ellipseGroups.size;
  var ellipseRefs = 0, ellipseRefOk = true;
  Array.from(ellipseGroups.values()).forEach(function (segments) {
    var refs = Array.from(new Set(segments.map(function (e) { return e.meta.ellipse.centerRef; })));
    if (refs.length !== 1 || !refs[0]) { if (refs.some(Boolean)) ellipseRefOk = false; return; }
    ellipseRefs++;
    var center = table.get(refs[0]);
    if (!center || center.type !== 'POINT') { ellipseRefOk = false; return; }
    var centerRole = center.viewRole === 'PLAN' || center.viewRole === 'ELEVATION' ||
      center.viewRole === 'PROFILE' ? center.viewRole : center.y > 0 ? 'ELEVATION' :
      center.y < 0 ? 'PLAN' : null;
    segments.forEach(function (e) {
      var def = e.meta.ellipse;
      if (def.role !== e.viewRole || def.role !== centerRole ||
          Math.abs(def.center.x - center.x) > 1e-9 ||
          Math.abs(def.center.y - center.y) > 1e-9) ellipseRefOk = false;
    });
  });
  properties.ellipseCentreRefs = ellipseRefs ? (ellipseRefOk ? 'ok' : 'issues') : 'none';
  properties.ellipseCentreEdit = !ellipseRefs ? 'none' : (function () {
    try {
      var copy = E.createTable();
      copy.importEntities(JSON.parse(JSON.stringify(table.list())));
      var frame = (solid.geometry || {}).profileMap || {xRef:0,dRef:0,s:1};
      var done = 0;
      Array.from(ellipseGroups.values()).forEach(function (segments) {
        var ref = segments[0].meta.ellipse.centerRef;
        if (!ref) return;
        var center = copy.get(ref);
        if (!center) return;
        var target = {x:center.x+1, y:center.y+0.5};
        require('../public/lib/educad-drafting.js').movePoint(copy, E, ref, target, frame);
        done++;
        segments.forEach(function (source) {
          var changed = copy.get(source.id), def = changed.meta.ellipse;
          if (!def || Math.abs(def.center.x-target.x) > 1e-9 ||
              Math.abs(def.center.y-target.y) > 1e-9) throw new Error('centre definition not updated');
          var t0 = 2*Math.PI*def.index/def.count, t1 = 2*Math.PI*(def.index+1)/def.count;
          var x0 = def.center.x+def.a.x*Math.cos(t0)+def.b.x*Math.sin(t0);
          var y0 = def.center.y+def.a.y*Math.cos(t0)+def.b.y*Math.sin(t0);
          var x1 = def.center.x+def.a.x*Math.cos(t1)+def.b.x*Math.sin(t1);
          var y1 = def.center.y+def.a.y*Math.cos(t1)+def.b.y*Math.sin(t1);
          if (Math.abs(changed.x-x0) > 1e-9 || Math.abs(changed.y-y0) > 1e-9 ||
              Math.abs(changed.x2-x1) > 1e-9 || Math.abs(changed.y2-y1) > 1e-9)
            throw new Error('centre tessellation not updated');
        });
      });
      return done ? 'ok' : 'none';
    } catch (err) { return 'issues'; }
  })();




  var poseChecks = 0, poseFailures = 0;
  var poseVertices = 0, poseProjections = 0, poseHidden = 0;
  lines.forEach(function (line, i) {
    var query = /^\s*#\s*pose-check:\s*(.*)$/i.exec(line);
    if (!query) return;
    poseChecks++;
    try {
      var stats = PoseVerify.verify(JSON.parse(query[1]), solid);
      poseVertices += stats.vertices;
      poseProjections += stats.projections;
      poseHidden += stats.hidden;
    } catch (err) {
      poseFailures++;
      errors.push({ n: i + 1, line: line, message: err.message });
    }
  });
  properties.poseChecks = poseChecks;
  properties.poseStatus = poseFailures ? 'issues' : poseChecks ? 'ok' : 'none';
  properties.poseVertices = poseVertices;
  properties.poseProjections = poseProjections;
  properties.poseHidden = poseHidden;
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



function conicAxes(curve) {
  return {u:Number.isFinite(curve.radiusU) ? curve.radiusU : curve.radius,
    v:Number.isFinite(curve.radiusV) ? curve.radiusV : curve.radius};
}
function conicWorldVector(view, p, role, frame, vector) {
  if (role === 'PLAN') return vector ? {x:p.x, y:0, z:-p.y} : {x:p.x, y:0, z:-p.y};
  if (role === 'ELEVATION') return vector ? {x:p.x, y:p.y, z:0} : {x:p.x, y:p.y, z:0};
  if (role === 'PROFILE' && frame) return vector ?
    {x:0, y:p.y, z:frame.s*p.x} : {x:0, y:p.y, z:frame.dRef + (p.x-frame.xRef)/frame.s};
  return null;
}
function projectWorld(p, role, frame, vector) {
  if (role === 'PLAN') return {x:p.x, y:-p.z};
  if (role === 'ELEVATION') return {x:p.x, y:p.y};
  if (role === 'PROFILE' && frame) return vector ?
    {x:frame.s*p.z, y:p.y} : {x:frame.xRef + frame.s*(p.z-frame.dRef), y:p.y};
  return null;
}
function conicViewQ(curve, role, frame) {
  var d = curve.definition || {};
  var A = d.a || {x:curve.u.x*curve.radiusU, y:curve.u.y*curve.radiusU, z:curve.u.z*curve.radiusU};
  var B = d.b || {x:curve.v.x*curve.radiusV, y:curve.v.y*curve.radiusV, z:curve.v.z*curve.radiusV};
  var pa = projectWorld(A, role, frame, true), pb = projectWorld(B, role, frame, true);
  return {q00:pa.x*pa.x+pb.x*pb.x, q01:pa.x*pa.y+pb.x*pb.y, q11:pa.y*pa.y+pb.y*pb.y};
}
function conicProjectionResidual(curve, frame) {
  var max = 0, sourceQ = curve.definition && curve.definition.exact;
  var d = curve.definition || {};
  var A3 = d.a || {x:curve.u.x*curve.radiusU, y:curve.u.y*curve.radiusU, z:curve.u.z*curve.radiusU};
  var B3 = d.b || {x:curve.v.x*curve.radiusV, y:curve.v.y*curve.radiusV, z:curve.v.z*curve.radiusV};
  (curve.viewDefinitions || []).forEach(function (view) {
    if (!view) return;
    if (view.kind === 'line') {
      var A2 = projectWorld(A3, view.role, frame, true), B2 = projectWorld(B3, view.role, frame, true);
      var C2 = projectWorld(curve.center, view.role, frame);
      if (!A2 || !B2 || !C2) { max = Math.max(max, Infinity); return; }
      var la = Math.hypot(A2.x,A2.y), lb = Math.hypot(B2.x,B2.y);
      if (!(la > 0) && !(lb > 0)) { max = Math.max(max, Infinity); return; }
      max = Math.max(max, la*lb > 0 ? Math.abs(A2.x*B2.y-A2.y*B2.x)/(la*lb) : 0);
      var scale = Math.max(1e-12, curve.radiusU, curve.radiusV);
      var segments = Array.isArray(view.segments) && view.segments.length ? view.segments :
        [{x:view.x, y:view.y, x2:view.x2, y2:view.y2}];
      var first = segments[0];
      var nx = first.y2-first.y, ny = first.x-first.x2, l = Math.hypot(nx,ny);
      if (!(l > 0)) { max = Math.max(max, Infinity); return; }
      var dx = (first.x2-first.x)/Math.hypot(first.x2-first.x,first.y2-first.y);
      var dy = (first.y2-first.y)/Math.hypot(first.x2-first.x,first.y2-first.y);
      var c = nx*first.x+ny*first.y, intervals = [];
      for (var si = 0; si < segments.length; si++) {
        var seg = segments[si];
        max = Math.max(max,
          Math.abs(nx*seg.x+ny*seg.y-c)/l/scale,
          Math.abs(nx*seg.x2+ny*seg.y2-c)/l/scale);
        intervals.push({min:Math.min(seg.x*dx+seg.y*dy, seg.x2*dx+seg.y2*dy),
          max:Math.max(seg.x*dx+seg.y*dy, seg.x2*dx+seg.y2*dy)});
      }
      max = Math.max(max, Math.abs(nx*C2.x+ny*C2.y-c)/l/scale);
      var ca = A2.x*dx+A2.y*dy, cb = B2.x*dx+B2.y*dy, radius = Math.hypot(ca,cb);
      var mid = C2.x*dx+C2.y*dy, lo = mid-radius, hi = mid+radius;
      intervals.sort(function (a,b) { return a.min-b.min; });
      var reach = lo;
      for (var ii = 0; ii < intervals.length; ii++) {
        if (intervals[ii].max < lo-1e-7*scale) continue;
        if (intervals[ii].min > reach+1e-7*scale) break;
        reach = Math.max(reach, intervals[ii].max);
        if (reach >= hi-1e-7*scale) break;
      }
      if (reach < hi-1e-7*scale) max = Math.max(max, Infinity);
      return;
    }
    if (!view.center || !view.a || !view.b) return;
    var projected = conicViewQ(curve, view.role, frame);
    var v00 = view.a.x*view.a.x+view.b.x*view.b.x;
    var v01 = view.a.x*view.a.y+view.b.x*view.b.y;
    var v11 = view.a.y*view.a.y+view.b.y*view.b.y;
    function rel(x, y) {
      if (Math.abs(x) <= 1e-7 && Math.abs(y) <= 1e-7) return Math.abs(x-y);
      var scale = Math.max(Math.abs(x), Math.abs(y));
      return Math.abs(x-y)/scale;
    }
    max = Math.max(max, rel(projected.q00, v00), rel(projected.q01, v01),
      rel(projected.q11, v11));
    var centerShape = Math.sqrt(Math.max(1e-12, v00, v11));
    var center = projectWorld(curve.center, view.role, frame);
    if (center) max = Math.max(max,
      Math.hypot(center.x-view.center.x, center.y-view.center.y) / centerShape);
    var count = Math.min(Number.isInteger(view.count) ? view.count : 24, 48);
    var sampleA = projectWorld(A3, view.role, frame, true);
    var sampleB = projectWorld(B3, view.role, frame, true);
    var sampleDet = sampleA ? sampleA.x*sampleB.y-sampleA.y*sampleB.x : 0;
    for (var i = 0; i < count; i++) {
      var t = 2*Math.PI*i/count;
      var source = {x:view.center.x + view.a.x*Math.cos(t) + view.b.x*Math.sin(t),
        y:view.center.y + view.a.y*Math.cos(t) + view.b.y*Math.sin(t)};
      var local = {x:source.x-view.center.x, y:source.y-view.center.y};
      if (!(Math.abs(sampleDet) > 1e-18)) continue;
      var alpha = (local.x*sampleB.y-local.y*sampleB.x)/sampleDet;
      var beta = (sampleA.x*local.y-sampleA.y*local.x)/sampleDet;
      max = Math.max(max, Math.abs(Math.hypot(alpha,beta)-1));
    }
  });
  return {max:max, exactInput:!!sourceQ};
  function paDot(q, point, row) {
    if (row === 0) return q.q00*point.x + q.q01*point.y;
    return q.q01*point.x + q.q11*point.y;
  }
}
function checkConicProjection(solid) {
  var g = solid && solid.geometry;
  if (!g) return {status:'none', curves:0, residual:0};
  var curves = (g.curves || []).filter(function (c) { return c && c.analytic; });
  if (!curves.length) return {status:'none', curves:0, residual:0};
  var frame = g.profileMap || null, max = 0;
  curves.forEach(function (c) {
    var result = conicProjectionResidual(c, frame);
    max = Math.max(max, result.max);
  });
  return {status:max <= 1e-7 ? 'ok' : 'issues', curves:curves.length, residual:max};
}
function conicSignature(geometry) {
  return ((geometry || {}).curves || []).filter(function (c) { return c && c.analytic; })
    .map(function (c) {
      var axes = conicAxes(c);
      return JSON.stringify({kind:c.kind, center:c.center, u:c.u, v:c.v,
        radiusU:axes.u, radiusV:axes.v, sweep:c.sweepAngle,
        sourceGroups:c.sourceGroups, exact:c.exact, inferred:c.inferred});
    }).sort().join(';');
}
function signedMeshVolume(vertices, faces) {
  var total = 0, anchor = {x:0, y:0, z:0};
  if (!vertices || !vertices.length) return 0;
  vertices.forEach(function (vertex) {
    anchor.x += vertex.x; anchor.y += vertex.y; anchor.z += vertex.z;
  });
  anchor.x /= vertices.length; anchor.y /= vertices.length; anchor.z /= vertices.length;
  (faces || []).forEach(function (face) {
    var p0 = vertices[face[0]];
    if (!p0) return;
    var a0 = {x:p0.x-anchor.x, y:p0.y-anchor.y, z:p0.z-anchor.z};
    for (var j = 1; j < face.length - 1; j++) {
      var p1 = vertices[face[j]], p2 = vertices[face[j+1]];
      if (!p1 || !p2) continue;
      var a1 = {x:p1.x-anchor.x, y:p1.y-anchor.y, z:p1.z-anchor.z};
      var a2 = {x:p2.x-anchor.x, y:p2.y-anchor.y, z:p2.z-anchor.z};
      total += (a0.x*(a1.y*a2.z-a1.z*a2.y) - a0.y*(a1.x*a2.z-a1.z*a2.x) +
        a0.z*(a1.x*a2.y-a1.y*a2.x)) / 6;
    }
  });
  return total;
}
function integrateAbsoluteQuadratic(c0, c1, c2) {
  function integral(a, b) {
    return c0*(b-a) + c1*(b*b-a*a)/2 + c2*(b*b*b-a*a*a)/3;
  }
  var roots = [];
  var scale = Math.max(Math.abs(c0), Math.abs(c1), Math.abs(c2), 1e-300);
  if (Math.abs(c2) <= 1e-12*scale) {
    if (Math.abs(c1) > 1e-12*scale) {
      var linear = -c0/c1;
      if (linear > 0 && linear < 1) roots.push(linear);
    }
  } else {
    var discriminant = c1*c1 - 4*c2*c0;
    if (discriminant > 0) {
      var root = Math.sqrt(discriminant);
      [(-c1-root)/(2*c2), (-c1+root)/(2*c2)].forEach(function (t) {
        if (t > 1e-12 && t < 1-1e-12) roots.push(t);
      });
    }
  }
  roots.sort(function (a, b) { return a-b; });
  var points = [0].concat(roots, [1]), total = 0;
  for (var i=0;i<points.length-1;i++) {
    var lo = points[i], hi = points[i+1];
    total += Math.abs(integral(lo,hi));
  }
  return total;
}
function basicMeshAudit(geometry) {
  var vertices = geometry && geometry.vertices || [];
  var faces = geometry && geometry.faces || [];
  var use = new Map(), pairs = new Map(), invalid = [], faceList = [];
  function valid(index) {
    var vertex = Number.isInteger(index) ? vertices[index] : null;
    return !!vertex && Number.isFinite(vertex.x) && Number.isFinite(vertex.y) &&
      Number.isFinite(vertex.z);
  }
  faces.forEach(function (face, faceIndex) {
    var bad = false;
    face.forEach(function (index, position) {
      if (!valid(index)) { bad = true; invalid.push({face:faceIndex, position:position, index:index}); }
    });
    if (bad) return;
    faceList.push(faceIndex);
    for (var i = 0; i < face.length; i++) {
      var a = face[i], b = face[(i + 1) % face.length];
      if (a === b) continue;
      var key = Math.min(a, b) + '_' + Math.max(a, b);
      use.set(key, (use.get(key) || 0) + 1);
      if (!pairs.has(key)) pairs.set(key, [Math.min(a, b), Math.max(a, b)]);
    }
  });
  var directed = new Map(), same = 0;
  faces.forEach(function (face) {
    if (!face.every(valid)) return;
    for (var i = 0; i < face.length; i++) {
      var a = face[i], b = face[(i + 1) % face.length];
      if (a === b) continue;
      var key = a + '_' + b;
      directed.set(key, (directed.get(key) || 0) + 1);
    }
  });
  directed.forEach(function (count, key) {
    var parts = key.split('_'), reverse = parts[1] + '_' + parts[0];
    if (count === 2 && !(directed.get(reverse) || 0)) same++;
  });
  var open = 0, nonmanifold = 0;
  use.forEach(function (count) {
    if (count === 1) open++;
    else if (count > 2) nonmanifold++;
  });
  var parent = [], roots = new Map(), vertexSet = new Set();
  faces.forEach(function (face) {
    if (!face.every(valid)) return;
    face.forEach(function (index) { vertexSet.add(index); });
  });
  vertexSet.forEach(function (index) { parent[index] = index; });
  function root(index) {
    while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
    return index;
  }
  faces.forEach(function (face) {
    if (!face.every(valid) || !face.length) return;
    face.slice(1).forEach(function (index) {
      var ra = root(face[0]), rb = root(index);
      if (ra !== rb) parent[rb] = ra;
    });
  });
  vertexSet.forEach(function (index) {
    var r = root(index);
    if (!roots.has(r)) roots.set(r, {vertices:0, edges:new Set(), faces:0});
    roots.get(r).vertices++;
  });
  faceList.forEach(function (faceIndex) {
    var face = faces[faceIndex], component = roots.get(root(face[0]));
    component.faces++;
    for (var i = 0; i < face.length; i++) {
      var a = face[i], b = face[(i + 1) % face.length];
      if (a !== b) component.edges.add(Math.min(a, b) + '_' + Math.max(a, b));
    }
  });
  var componentEulers = [];
  roots.forEach(function (component) {
    componentEulers.push(component.vertices - component.edges.size + component.faces);
  });
  var displayEdges = geometry && geometry.edges || [];
  var unusedDisplayEdges = displayEdges.filter(function (edge) {
    return !use.has(Math.min(edge[0], edge[1]) + '_' + Math.max(edge[0], edge[1]));
  });
  return {vertices:vertices.length, edges:displayEdges.length,
    faces:faces.length, volume:signedMeshVolume(vertices, faces),
    euler:vertices.length - (geometry && geometry.edges || []).length + faces.length,
    invalidVertexIndices:invalid, openEdges:open, nonmanifoldEdges:nonmanifold,
    sameDirectionEdges:same, faceComponents:roots.size,
    unusedDisplayEdgeCount:unusedDisplayEdges.length,
    faceEuler:componentEulers.reduce(function (sum, value) { return sum + value; }, 0),
    faceVertices:vertexSet.size, faceEdges:pairs.size,
    allFaceEdgesOpposite:invalid.length === 0 && open === 0 && nonmanifold === 0 && same === 0};
}
function conicAnalyticVolume(geometry, curveIndex) {
  var total = 0, found = null;
  ((geometry && geometry.surfacePatches) || []).forEach(function (patch) {
    if (!patch || !patch.generator || !(patch.boundaryCurves || []).includes(curveIndex)) return;
    var gen = patch.generator, C = gen.C, A = gen.A, B = gen.B, D = gen.D, k = gen.k;
    if (!C || !A || !B || !D) return;
    var cross = {x:A.y*B.z-A.z*B.y, y:A.z*B.x-A.x*B.z, z:A.x*B.y-A.y*B.x};
    var area = Math.PI*Math.hypot(cross.x,cross.y,cross.z);
    var d = {x:D.x-C.x, y:D.y-C.y, z:D.z-C.z}, nlen = Math.hypot(cross.x,cross.y,cross.z);
    if (!(nlen > 0)) return;
    var h = Math.abs(d.x*cross.x+d.y*cross.y+d.z*cross.z)/nlen;
    if (gen.A2 && gen.B2) {
      var normal = Math.hypot(gen.n.x,gen.n.y,gen.n.z) > 0 ? gen.n : cross;
      var normalLength = Math.hypot(normal.x,normal.y,normal.z);
      var unitNormal = {x:normal.x/normalLength, y:normal.y/normalLength, z:normal.z/normalLength};
      var axial = Math.abs(d.x*unitNormal.x+d.y*unitNormal.y+d.z*unitNormal.z);
      var deltaA = {x:gen.A2.x-A.x, y:gen.A2.y-A.y, z:gen.A2.z-A.z};
      var deltaB = {x:gen.B2.x-B.x, y:gen.B2.y-B.y, z:gen.B2.z-B.z};
      function triple(u, v) {
        var w = {x:u.y*v.z-u.z*v.y, y:u.z*v.x-u.x*v.z, z:u.x*v.y-u.y*v.x};
        return w.x*unitNormal.x+w.y*unitNormal.y+w.z*unitNormal.z;
      }
      var d0 = triple(A,B);
      var d1 = triple(deltaA,B) + triple(A,deltaB);
      var d2 = triple(deltaA,deltaB);
      var volume = Math.PI*axial*integrateAbsoluteQuadratic(d0,d1,d2);
      total += volume;
      found = {kind:'affine-ruled-conic-volume', area:area, height:axial,
        d0:d0, d1:d1, d2:d2, volume:volume};
      return;
    }
    var volume = Number.isFinite(k) && Math.abs(k) > 1e-9 ?
      area*h*(1+k+k*k)/3 : area*h/3;
    total += volume;
    found = {kind:'homothetic-conic-volume', k:k, area:area, height:h, volume:volume};
  });
  return {volume:total, patch:found};
}
function conicJSONParity(table, solid) {
  try {
    var clone = JSON.parse(JSON.stringify(table.list()));
    var rebuilt = R.reconstruct(clone, {});
    return conicSignature(solid && solid.geometry) === conicSignature(rebuilt && rebuilt.geometry);
  } catch (err) {
    return false;
  }
}

function checkObliqueReprojection(solid, entities) {
  var g = solid && solid.geometry, byId = new Map(entities.map(function(e) {return [e.id,e];}));
  if (!g) return 'none';
  var curves = (g.curves || []).filter(function(c) {return c.oblique||c.analytic;});
  if (!curves.length) return 'none';
  var frame = g.profileMap || (entities.find(function(e) {return e.meta && e.meta.draftingLayout;}) || {meta:{}}).meta.draftingLayout;
  return curves.every(function(c) {
    if (c.analytic) return conicProjectionResidual(c,frame).max <= 1e-7;
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


function topologyProperties(solid) {
  var g = solid && solid.geometry;
  if (!g) return { V: 0, E: 0, F: 0, holes: 0, components: 0, closed: 0, open: 0, boundary: 0, curves: 0, minRadius: 0, maxRadius: 0, surfaces: 0, surfaceKinds: 'none', surfaceLoops: 0, surfaceShells: 0, surfaceOpen: 0, surfaceBoundary: 0, surfaceModel: 'none', surfaceCertificate: 'none', surfaceCertificateIssues: 'none', surfaceCertificateChecks: 0, surfaceLineBoundaries: 0, surfaceSharedLineBoundaries: 0, surfaceCurveBoundaries: 0, surfaceValidation: 'none', displaySync: 'none', displaySyncIssues: 'none', recesses: 0, fillets: 0, unresolved: (solid && solid.issues || []).length, status: (solid && solid.reason) || 'unavailable' };
  var faces = g.faceRegions || (g.faces || []).map(function (f, i) { return { outer: f, holes: (g.faceHoles || [])[i] || [] }; });
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
    surfaceCertificateScope: certificate && certificate.scope ? certificate.scope : 'none',
    surfaceValidationScope: modelCheck && modelCheck.scope ? modelCheck.scope : 'none',
    displaySync: g.displaySync ? g.displaySync.status : 'none',
    displaySyncIssues: g.displaySync && (g.displaySync.diagnostics || []).length ?
      Array.from(new Set(g.displaySync.diagnostics.map(function(d) { return d.code; }))).sort().join(',') : 'none',
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
  if (res.properties && res.properties.poseChecks) {
    out.push('  pose: ' + res.properties.poseChecks + ' check(s), ' +
      res.properties.poseVertices + ' vertex maps, ' +
      res.properties.poseProjections + ' view projections' +
      (res.properties.poseHidden ? ', ' + res.properties.poseHidden +
        ' hidden verdicts' : '') + ' — ' +
      (res.properties.poseStatus === 'ok' ? 'math holds' : 'PROBLEMS'));
  }
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

(function(root,factory) {
  if(typeof module!=='undefined'&&module.exports) module.exports=factory(require('./educad-parametric.js'));
  else root.EduCADParametricReconstruct=factory(root.EduCADParametric);
})(typeof window!=='undefined'?window:globalThis,function(P) {
  'use strict';
  var EPS=1e-6;
  function reconstruct(entities,profile) {
    var byId=new Map(entities.map(function(e){return [e.id,e];}));
    var rows=entities.filter(function(e){return e.type==='CURVE'&&!(e.meta&&e.meta.reconstructionRole==='construction');});
    var curves=[],issues=[];
    function diag(code,e,message){issues.push({code:code,entityId:e.id,sourceIds:[e.id],message:message});}
    function stations(e){return (e.meta.throughRefs||[]).map(function(id){return byId.get(id);});}
    function ids(p){return ((p.meta||{}).members||[]).map(function(m){return m.id;});}
    // Compatibility import reads station labels once at this boundary. A
    // suffix-stripped base name (a, a', a'') names the same spatial station;
    // explicit member IDs remain the authoritative identity.
    function names(p){return String(p.caption||p.name||'').split(',').map(function(part){
      return part.trim().replace(/^\((.*)\)$/,'$1').replace(/['′’]+$/,'');
    }).filter(Boolean);}
    function shared(a,b){return ids(a).some(function(id){return ids(b).indexOf(id)!==-1;}) ||
      names(a).some(function(name){return names(b).indexOf(name)!==-1;});}
    function linkedTo(a,b){return stations(a).some(function(p){return stations(b).some(function(q){return shared(p,q);});});}
    function coords(p,role) {
      if(role==='PLAN') return {x:p.x,z:-p.y};
      if(role==='ELEVATION') return {x:p.x,y:p.y};
      if(role==='PROFILE'&&profile)return {z:profile.dRef+profile.s*(p.x-profile.xRef),y:p.y};
      return {};
    }
    function pair(a,b) {
      if(a.viewRole===b.viewRole||a.meta.curve.closed!==b.meta.curve.closed)return [];
      var A=stations(a),B=stations(b),n=A.length,closed=a.meta.curve.closed;
      if(n<2||n!==B.length||A.concat(B).some(function(p){return !p;}))return [];
      var aid=new Set(A.flatMap(ids)),bid=new Set(B.flatMap(ids));
      var sharedId=Array.from(aid).some(function(id){return bid.has(id);});
      var explicit=A.concat(B).some(function(p){return p.meta&&p.meta.membersDeclared;});
      var constrainStations=explicit||sharedId||linkedTo(a,b);
      var solutions=[];
      for(var reverse=0;reverse<2;reverse++)for(var offset=0;offset<(closed?n:1);offset++) {
        var order=A.map(function(_,i){return closed?(offset+(reverse?-i:i)+n)%n:reverse?n-1-i:i;});
        var points=[],valid=true;
        A.forEach(function(p,i) {
          var q=B[order[i]];
          if(constrainStations&&!shared(p,q)) {valid=false;return;}
          var x=coords(p,a.viewRole),y=coords(q,b.viewRole),v={};
          ['x','y','z'].forEach(function(k){
            if(x[k]!==undefined&&y[k]!==undefined&&Math.abs(x[k]-y[k])>EPS)valid=false;
            v[k]=x[k]===undefined?y[k]:x[k];if(!Number.isFinite(v[k]))valid=false;
          });points.push(v);
        });
        if(valid)solutions.push({points:points,other:b,order:order});
      }
      return solutions;
    }
    // A reconstructed point projected back into a drawing view.
    function drawing(p,role) {
      if(role==='PLAN') return {x:p.x,y:-p.z};
      if(role==='ELEVATION') return {x:p.x,y:p.y};
      if(role==='PROFILE'&&profile&&profile.s)return {x:profile.xRef+(p.z-profile.dRef)/profile.s,y:p.y};
      return null;
    }
    function samePoints(p,q) {
      return p.every(function(point,i){var other=q[i];return Math.hypot(point.x-other.x,point.y-other.y,point.z-other.z)<EPS;});
    }
    function plausible(a,b) {
      return a.viewRole!==b.viewRole && a.meta.curve.closed===b.meta.curve.closed &&
        stations(a).length>=2 && stations(a).length===stations(b).length;
    }
    // Return the station order of c that projects the reconstructed points
    // back onto c's drawing, or null when c disagrees with the model.
    function orderFor(points,refs,c) {
      var C=stations(c),n=C.length,closed=c.meta.curve.closed;
      if(n!==points.length)return null;
      var constrain=c.meta.membersDeclared||refs.some(function(p){return C.some(function(q){return shared(p,q);});});
      for(var reverse=0;reverse<2;reverse++)for(var offset=0;offset<(closed?n:1);offset++) {
        var order=C.map(function(_,i){return closed?(offset+(reverse?-i:i)+n)%n:reverse?n-1-i:i;});
        var valid=true;
        for(var i=0;i<n;i++) {
          var q=C[order[i]],p=drawing(points[i],c.viewRole);
          if(constrain&&!shared(refs[i],q)) {valid=false;break;}
          if(!p||Math.abs(p.x-q.x)>EPS||Math.abs(p.y-q.y)>EPS) {valid=false;break;}
        }
        if(valid)return order;
      }
      return null;
    }
    rows=rows.filter(function(a) {
      if(!a.meta || !P.validate(a.meta.curve)||a.meta.curve.parameterization!=='uniform-stations'||!a.meta.throughRefs||stations(a).some(function(p){return !p;})) {
        diag('curve-definition-unsupported',a,'This curve needs a valid definition and its defining stations for cross-view reconstruction.');return false;
      }
      var definition;
      try {definition=P.interpolate(stations(a),a.meta.curve.closed);} catch(error) {diag('curve-definition-conflict',a,error.message);return false;}
      if(definition.controlPoints.length!==a.meta.curve.controlPoints.length || definition.controlPoints.some(function(p,i){var q=a.meta.curve.controlPoints[i];return Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)>EPS;})) {
        diag('curve-definition-conflict',a,'The stored curve no longer matches its defining stations. Rebuild the curve from its points.');return false;
      }
      return true;
    });
    // Curves with the same station count and closure in different views are
    // candidate projections of one 3D curve. Build connected components so a
    // third view cannot be silently ignored after a two-view pair is found.
    var parent=rows.map(function(_,i){return i;});
    function find(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    function union(i,j){var a=find(i),b=find(j);if(a!==b)parent[b]=a;}
    for(var i=0;i<rows.length;i++)for(var j=i+1;j<rows.length;j++)if(plausible(rows[i],rows[j]))union(i,j);
    var components=[],componentIndex=Object.create(null);
    rows.forEach(function(e,i){
      var root=find(i);
      if(componentIndex[root]===undefined){componentIndex[root]=components.length;components.push([]);}
      components[componentIndex[root]].push(e);
    });
    components.forEach(function(component) {
      if(component.length===1) {
        diag('curve-correspondence-missing',component[0],'No compatible second view supplies all three coordinates at the defining stations.');
        return;
      }
      var candidates=[];
      for(var ci=0;ci<component.length;ci++)for(var cj=ci+1;cj<component.length;cj++) {
        if(!plausible(component[ci],component[cj]))continue;
        pair(component[ci],component[cj]).forEach(function(solution){
          if(!candidates.some(function(c){return samePoints(c.points,solution.points);}))
            candidates.push({points:solution.points,refs:stations(component[ci])});
        });
      }
      var solutions=[];
      candidates.forEach(function(candidate){
        var evidence=[];
        for(var k=0;k<component.length;k++) {
          var order=orderFor(candidate.points,candidate.refs,component[k]);
          if(!order)return;
          evidence.push({entityId:component[k].id,order:order});
        }
        if(!solutions.some(function(s){return samePoints(s.points,candidate.points);}))
          solutions.push({points:candidate.points,evidence:evidence});
      });
      if(solutions.length!==1) {
        var code=solutions.length?'curve-correspondence-ambiguous':'curve-projection-conflict';
        var message=solutions.length?'Several curve correspondences fit these stations; link identities or add a constraining view.':
          'The corresponding views disagree at the defining stations; correct the conflicting projection.';
        component.forEach(function(e){diag(code,e,message);});
        return;
      }
      var curve=P.interpolate(solutions[0].points,component[0].meta.curve.closed);
      curve.sourceIds=Array.from(new Set(component.flatMap(function(e){return [e.id].concat(e.meta.throughRefs);})));
      curve.sourceEvidence=solutions[0].evidence;
      curve.surfaceInference={status:'unresolved',reason:'A parametric boundary alone does not select its spanning surface.'};
      curves.push(curve);
      diag('curve-surface-unresolved',component[0],'The 3D curve is reconstructed; its spanning surface is not determined by the curve alone.');
    });
    return {curves:curves,issues:issues};
  }
  return {reconstruct:reconstruct};
});

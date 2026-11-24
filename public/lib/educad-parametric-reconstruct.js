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
    function stations(e){return (Array.isArray((e.meta||{}).throughRefs)?e.meta.throughRefs:[]).map(function(id){return byId.get(id);});}
    function ids(p){return ((p.meta||{}).members||[]).map(function(m){return m.id;});}



    function names(p){return String(p.caption||p.name||'').split(',').map(function(part){
      return part.trim().replace(/^\((.*)\)$/,'$1').replace(/['′’]+$/,'');
    }).filter(Boolean);}
    function sharedIds(a,b){return ids(a).some(function(id){return ids(b).indexOf(id)!==-1;});}
    function declared(p){return !!(p.meta&&p.meta.membersDeclared);}
    function sharedNames(a,b){return !declared(a)&&!declared(b)&&names(a).some(function(name){return names(b).indexOf(name)!==-1;});}
    function shared(a,b){return sharedIds(a,b)||sharedNames(a,b);}
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
      var explicit=A.concat(B).some(declared);
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


    function orderFor(points,refs,c) {
      var C=stations(c),n=C.length,closed=c.meta.curve.closed;
      if(n!==points.length)return null;
      var constrain=refs.concat(C).some(declared)||refs.some(function(p){return C.some(function(q){return shared(p,q);});});
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
      if(!a.meta || !P.validate(a.meta.curve)||a.meta.curve.parameterization!=='uniform-stations'||!Array.isArray(a.meta.throughRefs)||stations(a).some(function(p){return !p||p.type!=='POINT'||p.viewRole!==a.viewRole;})) {
        diag('curve-definition-unsupported',a,'This curve needs a valid definition and an array of defining point stations in the same declared view for cross-view reconstruction.');return false;
      }
      var definition;
      try {definition=P.interpolate(stations(a),a.meta.curve.closed);} catch(error) {diag('curve-definition-conflict',a,error.message);return false;}
      var stored=a.meta.curve;
      var sameBasis=stored.degree===definition.degree&&stored.knots.length===definition.knots.length&&
        stored.knots.every(function(k,i){return k===definition.knots[i];})&&
        stored.weights.every(function(w){return Math.abs(w/stored.weights[0]-1)<1e-12;});
      if(!sameBasis || definition.controlPoints.length!==stored.controlPoints.length || definition.controlPoints.some(function(p,i){var q=stored.controlPoints[i];return Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z)>EPS;})) {
        diag('curve-definition-conflict',a,'The stored curve no longer matches its defining stations. Rebuild the curve from its points.');return false;
      }
      return true;
    });




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
    var rowIndex=new Map(rows.map(function(e,i){return [e,i];}));



    function roundedPoints(points) {
      return points.map(function(p){return [p.x,p.y,p.z].map(function(v){return Math.round(v*1e7)/1e7;}).join(',');});
    }
    function sequenceKey(sequence,closed) {
      if(!closed)return sequence.join(';');
      var best=null;
      for(var i=0;i<sequence.length;i++) {
        var key=sequence.slice(i).concat(sequence.slice(0,i)).join(';');
        if(best===null||key<best)best=key;
      }
      return best;
    }
    function pointsKey(points,closed) {
      var forward=sequenceKey(roundedPoints(points),closed);
      var backward=sequenceKey(roundedPoints(points.slice().reverse()),closed);
      return forward<backward?forward:backward;
    }
    function stationKeys(p) {
      return ids(p).map(function(id){return 'id:'+id;}).concat(declared(p)?[]:names(p).map(function(name){return 'name:'+name;}));
    }



    function identityConflict(evidence) {
      var seen=Object.create(null),conflict=false;
      evidence.forEach(function(entry) {
        var S=stations(entry.row);
        entry.order.forEach(function(stationIndex,k) {
          stationKeys(S[stationIndex]).forEach(function(key) {
            if(seen[key]!==undefined&&seen[key]!==k)conflict=true;
            else seen[key]=k;
          });
        });
      });
      return conflict;
    }
    function identityScore(evidence) {
      var idHits=0,nameHits=0;
      for(var a=0;a<evidence.length;a++)for(var b=a+1;b<evidence.length;b++) {
        var A=stations(evidence[a].row),B=stations(evidence[b].row);
        var oa=evidence[a].order,ob=evidence[b].order;
        for(var k=0;k<oa.length;k++) {
          var pa=A[oa[k]],pb=B[ob[k]];
          if(sharedIds(pa,pb))idHits++;
          else if(sharedNames(pa,pb))nameHits++;
        }
      }
      return idHits*1000000+nameHits;
    }
    function compareRows(a,b) {
      for(var i=0;i<Math.min(a.rows.length,b.rows.length);i++) {
        var ai=rowIndex.get(a.rows[i]),bi=rowIndex.get(b.rows[i]);
        if(ai!==bi)return ai-bi;
      }
      return a.rows.length-b.rows.length;
    }
    components.forEach(function(component) {
      if(component.length===1) {
        diag('curve-correspondence-missing',component[0],'No compatible second view supplies all three coordinates at the defining stations.');
        return;
      }
      function diagnose(code,message) {
        component.forEach(function(e){diag(code,e,message);});
      }


      var candidates=[];
      for(var ci=0;ci<component.length;ci++)for(var cj=ci+1;cj<component.length;cj++) {
        if(!plausible(component[ci],component[cj]))continue;
        pair(component[ci],component[cj]).forEach(function(solution){
          if(!candidates.some(function(c){return samePoints(c.points,solution.points);}))
            candidates.push({points:solution.points,refs:stations(component[ci])});
        });
      }




      var groups=[];
      candidates.forEach(function(candidate) {
        var support=[],byRole=Object.create(null),roleOrder=[];
        component.forEach(function(row) {
          var order=orderFor(candidate.points,candidate.refs,row);
          if(!order)return;
          var entry={row:row,order:order};
          support.push(entry);
          if(!byRole[row.viewRole]){byRole[row.viewRole]=[];roleOrder.push(row.viewRole);}
          byRole[row.viewRole].push(entry);
        });
        if(roleOrder.length<2)return;
        var choices=[[]];
        roleOrder.forEach(function(role) {
          var next=[];
          choices.forEach(function(prefix) {
            byRole[role].forEach(function(entry){next.push(prefix.concat([entry]));});
          });
          choices=next;
        });
        choices.forEach(function(evidence) {
          if(identityConflict(evidence))return;
          evidence=evidence.slice().sort(function(a,b){return rowIndex.get(a.row)-rowIndex.get(b.row);});
          groups.push({rows:evidence.map(function(e){return e.row;}),evidence:evidence,
            points:candidate.points,score:identityScore(evidence)});
        });
      });

      var options=[];
      groups.forEach(function(group) {
        var key=group.evidence.map(function(e){return e.row.id+':'+e.order.join(',');}).join('|')+
          '@'+pointsKey(group.points,group.rows[0].meta.curve.closed);
        if(!options.some(function(o){return o.key===key;})){group.key=key;options.push(group);}
      });
      options.sort(function(a,b) {
        return b.score-a.score || compareRows(a,b) ||
          (pointsKey(a.points,a.rows[0].meta.curve.closed)<pointsKey(b.points,b.rows[0].meta.curve.closed)?-1:1);
      });



      var solutions=[],cap=512,exhausted=false;
      function walk(remaining,chosen) {
        if(solutions.length>=cap){exhausted=true;return;}
        if(!remaining.length){solutions.push(chosen.slice());return;}
        var first=remaining[0];
        for(var oi=0;oi<options.length;oi++) {
          var group=options[oi];
          if(group.rows.indexOf(first)===-1)continue;
          if(!group.rows.every(function(row){return remaining.indexOf(row)!==-1;}))continue;
          chosen.push(group);
          walk(remaining.filter(function(row){return group.rows.indexOf(row)===-1;}),chosen);
          chosen.pop();
          if(solutions.length>=cap){exhausted=true;return;}
        }
      }
      walk(component.slice(),[]);
      if(exhausted) {
        diagnose('curve-correspondence-search-limit','Curve matching reached its search limit; link station identities or add a constraining view before selecting a reconstruction.');
        return;
      }
      if(!solutions.length) {
        diagnose('curve-projection-conflict','The corresponding views disagree at the defining stations; correct the conflicting projection.');
        return;
      }



      var top=-1;
      solutions.forEach(function(solution){
        var score=solution.reduce(function(sum,group){return sum+group.score;},0);
        if(score>top)top=score;
      });
      var best=solutions.filter(function(solution){
        return solution.reduce(function(sum,group){return sum+group.score;},0)===top;
      });
      function geometryKey(solution) {
        return solution.map(function(group){
          return pointsKey(group.points,group.rows[0].meta.curve.closed);
        }).sort().join('|');
      }
      var keys=Array.from(new Set(best.map(geometryKey)));
      if(keys.length!==1) {
        diagnose('curve-correspondence-ambiguous','Several curve correspondences fit these stations; link identities or add a constraining view.');
        return;
      }
      var chosen=best[0];
      chosen.forEach(function(group) {
        var curve=P.interpolate(group.points,group.rows[0].meta.curve.closed);
        curve.sourceIds=Array.from(new Set(group.rows.flatMap(function(e){return [e.id].concat(e.meta.throughRefs);})));
        curve.sourceEvidence=group.evidence.map(function(e){return {entityId:e.row.id,order:e.order};});
        curve.surfaceInference={status:'unresolved',reason:'A parametric boundary alone does not select its spanning surface.'};
        curves.push(curve);
        diag('curve-surface-unresolved',group.rows[0],'The 3D curve is reconstructed; its spanning surface is not determined by the curve alone.');
      });
    });
    return {curves:curves,issues:issues};
  }
  function inferPatches(geometry, entities) {
    var byId = new Map(entities.map(function (row) { return [row.id, row]; }));
    var strokes = entities.filter(function (row) {
      return row.type === 'SEGMENT' && row.meta && row.meta.reconstructionRole !== 'construction' &&
        Array.isArray(row.meta.refs) && row.meta.refs.length === 2;
    });
    var curves = geometry.curves, candidates = [];
    function observations(curve, index) {
      var result = new Map();
      curve.sourceEvidence.forEach(function (record) {
        var row = byId.get(record.entityId);
        var ref = row && row.meta.throughRefs[record.order[index]];
        if (ref) result.set(row.viewRole, ref);
      });
      return result;
    }
    function matchedStrokes(a, b, index, otherIndex) {
      var first = observations(a, index), second = observations(b, otherIndex);
      return strokes.filter(function (row) {
        var from = first.get(row.viewRole), to = second.get(row.viewRole);
        if (!from || !to || from === to) return false;
        var refs = row.meta.refs;
        if (!((refs[0] === from && refs[1] === to) || (refs[1] === from && refs[0] === to))) return false;
        var a = byId.get(refs[0]), b = byId.get(refs[1]);
        return Math.hypot(row.x-a.x, row.y-a.y) <= EPS &&
          Math.hypot(row.x2-b.x, row.y2-b.y) <= EPS;
      });
    }
    function sourceDefinition(curve) {
      return {kind:curve.kind, degree:curve.degree, knots:curve.knots.slice(),
        controlPoints:curve.controlPoints.slice(), weights:curve.weights.slice(), closed:curve.closed};
    }
    function stationMatches(a, at, b, bt) {
      var first = observations(a, at), second = observations(b, bt), count = 0;
      first.forEach(function (ref, role) { if (second.get(role) === ref) count++; });
      return count >= 2;
    }
    function translatedPair(a, b, reverse) {
      if (!P.plane(a) || a.controlPoints.length !== b.controlPoints.length ||
          a.weights.some(function (weight) { return weight !== 1; }) ||
          b.weights.some(function (weight) { return weight !== 1; })) return false;
      var last = b.controlPoints.length - 1, first = a.controlPoints[0];
      var second = b.controlPoints[reverse ? last : 0];
      return a.knots.length === b.knots.length && a.knots.every(function (knot, i) {
        return Math.abs(knot - (reverse ? 1 - b.knots[b.knots.length - 1 - i] : b.knots[i])) <= EPS;
      }) && a.controlPoints.every(function (p, i) {
        var q = b.controlPoints[reverse ? last - i : i];
        return Math.hypot((q.x-p.x)-(second.x-first.x), (q.y-p.y)-(second.y-first.y),
          (q.z-p.z)-(second.z-first.z)) <= EPS;
      });
    }
    curves.forEach(function (a, ai) {
      if (a.kind !== 'nurbs' || a.closed || a.interpolationPoints.length < 3) return;
      for (var bi = ai + 1; bi < curves.length; bi++) {
        var b = curves[bi], n = a.interpolationPoints.length;
        if (b.kind !== 'nurbs' || b.closed || b.interpolationPoints.length !== n) continue;
        [false, true].forEach(function (reverse) {
          if (translatedPair(a, b, reverse)) curves.forEach(function (rail, ri) {
            if (ri === ai || ri === bi || rail.kind !== 'nurbs' || rail.closed ||
                rail.interpolationPoints.length < 3) return;
            var end = rail.interpolationPoints.length - 1, bStart = reverse ? n - 1 : 0;
            [false, true].forEach(function (railReverse) {
              if (!stationMatches(a, 0, rail, railReverse ? end : 0) ||
                  !stationMatches(b, bStart, rail, railReverse ? 0 : end)) return;
              var chart = {kind:'translated-spline', first:sourceDefinition(a), second:sourceDefinition(b),
                reverse:reverse, rail:sourceDefinition(rail), railReverse:railReverse};
              var sourceIds = Array.from(new Set(a.sourceIds.concat(b.sourceIds, rail.sourceIds)));
              candidates.push({a:ai, b:bi, rail:ri, chart:chart, strokeIds:[], sourceIds:sourceIds});
            });
          });
          var generators = a.interpolationPoints.map(function (p, i) {
            var other = reverse ? n - 1 - i : i, q = b.interpolationPoints[other];
            if (Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z) <= EPS) return [];
            return matchedStrokes(a, b, i, other);
          });
          if (candidates.some(function (candidate) {
            return candidate.a === ai && candidate.b === bi && candidate.rail !== undefined;
          }) || generators.some(function (rows) {
            return new Set(rows.map(function (row) { return row.viewRole; })).size < 2;
          })) return;
          var chart = {kind:'ruled-spline', first:sourceDefinition(a), second:sourceDefinition(b), reverse:reverse};
          var strokeIds = generators.flat().map(function (row) { return row.id; });
          var sourceIds = Array.from(new Set(a.sourceIds.concat(b.sourceIds, strokeIds)));
          candidates.push({a:ai, b:bi, chart:chart, strokeIds:strokeIds, sourceIds:sourceIds});
        });
      }
    });
    var ringIndices = curves.map(function (curve, i) {
      var bound = (geometry.surfacePatches || []).some(function (patch) {
        return patch.kind !== 'plane' && (patch.boundaryCurves || []).indexOf(i) !== -1;
      });
      return curve.kind === 'circle' && !bound ? i : -1;
    }).filter(function (i) { return i !== -1; });
    function ringDefinition(ring) {
      return {kind:'circle', center:ring.center, radius:ring.radius, u:ring.u, v:ring.v};
    }
    function alignedRims(first, second, chart) {
      var indices = first.displayVertices || [];
      if (indices.length < 3 || !second.displayVertices || second.displayVertices.length !== indices.length) return null;
      var frame = chart.frame;
      var tangent = {
        x:frame.axis.y * frame.radial.z - frame.axis.z * frame.radial.y,
        y:frame.axis.z * frame.radial.x - frame.axis.x * frame.radial.z,
        z:frame.axis.x * frame.radial.y - frame.axis.y * frame.radial.x
      };
      var rim = indices.map(function (index) {
        var p = geometry.vertices[index];
        var x = p.x - frame.origin.x, y = p.y - frame.origin.y, z = p.z - frame.origin.z;
        var angle = Math.atan2(x*tangent.x + y*tangent.y + z*tangent.z,
          x*frame.radial.x + y*frame.radial.y + z*frame.radial.z);
        var u = ((angle / (2*Math.PI)) + 1) % 1;
        var expected = P.surfacePoint(chart, u, 1);
        var next = second.displayVertices.find(function (other) {
          var p = geometry.vertices[other];
          return Math.hypot(p.x-expected.x, p.y-expected.y, p.z-expected.z) <= EPS;
        });
        return {u:u, first:index, second:next};
      });
      return rim.every(function (entry) { return entry.second !== undefined; }) ?
        rim.sort(function (a, b) { return a.u - b.u; }) : null;
    }
    function bindCaps(candidate) {
      [candidate.a, candidate.b].forEach(function (index, which) {
        var curve = curves[index];
        var patch = geometry.surfacePatches.find(function (item) {
          return item.kind === 'plane' && item.outer && !(item.holes || []).length &&
            (item.boundaryCurves || []).length === 1 && item.boundaryCurves[0] === index &&
            item.outer.length === curve.displayVertices.length;
        });
        if (!patch) return;
        var axis = candidate.chart.frame.axis, sign = which ? 1 : -1;
        patch.origin = curve.center;
        patch.normal = {x:sign*axis.x, y:sign*axis.y, z:sign*axis.z};
        patch.loops = [{kind:'outer', curves:[index]}];
        patch.sourceIds = curve.sourceIds.slice();
        (patch.faceIndices || []).forEach(function (fi) {
          var face = geometry.faces[fi], normals = [0, 0, 0];
          face.forEach(function (vertex, k) {
            var a = geometry.vertices[vertex], b = geometry.vertices[face[(k+1) % face.length]];
            normals[0] += (a.y-b.y)*(a.z+b.z);
            normals[1] += (a.z-b.z)*(a.x+b.x);
            normals[2] += (a.x-b.x)*(a.y+b.y);
          });
          if (normals[0]*patch.normal.x + normals[1]*patch.normal.y + normals[2]*patch.normal.z < 0)
            face.reverse();
        });
      });
    }
    curves.forEach(function (curve, index) {
      if (curve.kind !== 'nurbs' || curve.closed || curve.interpolationPoints.length < 3) return;
      ringIndices.forEach(function (ai, i) {
        ringIndices.slice(i + 1).forEach(function (bi) {
          [false, true].forEach(function (reverse) {
            var a = curves[ai], b = curves[bi];
            var chart = {kind:'revolved-spline', first:ringDefinition(a), second:ringDefinition(b),
              meridian:sourceDefinition(curve), reverse:reverse};
            chart.frame = P.revolutionFrame(chart);
            if (!chart.frame) return;
            var sourceIds = Array.from(new Set(a.sourceIds.concat(b.sourceIds, curve.sourceIds)));
            candidates.push({a:ai, b:bi, rail:index, chart:chart, strokeIds:[], sourceIds:sourceIds});
          });
        });
      });
    });
    var resolved = new Set(), diagnostics = [];
    candidates.forEach(function (candidate) {
      var a = curves[candidate.a], b = curves[candidate.b];
      if (candidates.some(function (other) {
        return other !== candidate && [other.a, other.b, other.rail].some(function (index) {
          return index !== undefined && [candidate.a, candidate.b, candidate.rail].indexOf(index) !== -1;
        });
      })) {
        diagnostics.push({code:'spline-patch-ambiguous', entityId:a.sourceIds[0],
          sourceIds:candidate.sourceIds, message:'The generator strokes admit more than one spline station pairing.'});
        return;
      }
      var chart = candidate.chart;
      var revolved = chart.kind === 'revolved-spline';
      var rims = revolved ? alignedRims(a, b, chart) : null;
      var nu = revolved ? (rims ? rims.length : 36) :
        Math.min(96, Math.max(24, (a.interpolationPoints.length - 1) * 4));
      var nv = candidate.rail === undefined ? 4 : 24;
      var grid = [], faces = [];
      var faceHoles = geometry.faceHoles || (geometry.faceHoles = geometry.faces.map(function () { return []; }));
      var rowCount = revolved ? nu : nu + 1;
      for (var i = 0; i < rowCount; i++) {
        var row = [];
        for (var j = 0; j <= nv; j++) {
          if (rims && (j === 0 || j === nv)) row.push(j === 0 ? rims[i].first : rims[i].second);
          else {
            row.push(geometry.vertices.length);
            geometry.vertices.push(P.surfacePoint(chart, rims ? rims[i].u : i / nu, j / nv));
          }
        }
        grid.push(row);
      }
      for (var u = 0; u < nu; u++) {
        for (var v = 0; v < nv; v++) {
          var first = grid[u], next = grid[(u + 1) % rowCount];
          var face = [first[v], next[v], next[v + 1], first[v + 1]];
          faces.push(geometry.faces.length);
          geometry.faces.push(face);
          faceHoles.push([]);
          if (geometry.faceRegions) geometry.faceRegions.push({outer:face, holes:[]});
        }
      }
      geometry.surfacePatches.push({kind:'parametric', chart:chart,
        boundaryCurves:[candidate.a, candidate.b], faceIndices:faces, sourceIds:candidate.sourceIds});
      geometry.smoothSideFaces.push.apply(geometry.smoothSideFaces, faces);
      if (rims) bindCaps(candidate);
      var members = candidate.rail === undefined ? [a, b] : [a, b, curves[candidate.rail]];
      members.forEach(function (curve) {
        if (curve.kind === 'nurbs') curve.surfaceInference = {status:'inferred', family:chart.kind};
        (curve.sourceIds || []).forEach(function (id) { resolved.add(id); });
      });
      candidate.strokeIds.forEach(function (id) { resolved.add(id); });
    });
    return {sourceIds:resolved, diagnostics:diagnostics};
  }
  return {reconstruct:reconstruct,inferPatches:inferPatches};
});

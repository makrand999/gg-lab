(function(root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADParametric = factory();
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';
  var EPS=1e-9, TAU=2*Math.PI;
  function xyz(p) { return {x:p.x,y:p.y,z:p.z === undefined ? 0 : p.z}; }
  function finite(p) { return p && ['x','y','z'].every(function(k) {return Number.isFinite(p[k]);}); }
  function add(a,b) {return {x:a.x+b.x,y:a.y+b.y,z:a.z+b.z};}
  function sub(a,b) {return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};}
  function mul(a,s) {return {x:a.x*s,y:a.y*s,z:a.z*s};}
  function dot(a,b) {return a.x*b.x+a.y*b.y+a.z*b.z;}
  function norm(a) {return Math.hypot(a.x,a.y,a.z);}
  function cross(a,b) {return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
  function validate(c) {
    if (!c || c.kind!=='nurbs' || !Number.isInteger(c.degree) || c.degree<1 || c.degree>8) return false;
    var p=c.controlPoints,w=c.weights,k=c.knots;
    return Array.isArray(p) && p.length>c.degree && p.length<=4096 && p.every(finite) &&
      Array.isArray(w) && w.length===p.length && w.every(function(v) {return Number.isFinite(v)&&v>0;}) &&
      Array.isArray(k) && k.length===p.length+c.degree+1 && k.every(function(v,i) {return Number.isFinite(v)&&(!i||v>=k[i-1]);}) && k[c.degree]<k[p.length];
  }
  function domain(c) { return c.kind==='nurbs' ? [c.knots[c.degree],c.knots[c.controlPoints.length]] : [0,1]; }
  // Homogeneous de Boor evaluation; the same evaluator handles every degree
  // and positive rational weight, rather than recognising named shapes.
  function point(c,t) {
    if(c.kind!=='nurbs') {
      var a=(c.startAngle||0)+(c.sweepAngle===undefined?TAU:c.sweepAngle)*t;
      return add(c.center,add(mul(c.u,Math.cos(a)*(c.radiusU===undefined?c.radius:c.radiusU)),mul(c.v,Math.sin(a)*(c.radiusV===undefined?c.radius:c.radiusV))));
    }
    var p=c.degree,k=c.knots,n=c.controlPoints.length-1,lo=k[p],hi=k[n+1];
    t=Math.max(lo,Math.min(hi,t));
    var span=p;
    if(t===hi) span=n;
    else while(span<n && t>=k[span+1]) span++;
    var d=[];
    for(var j=0;j<=p;j++) {var i=span-p+j,w=c.weights[i],v=c.controlPoints[i];d.push([v.x*w,v.y*w,v.z*w,w]);}
    for(var r=1;r<=p;r++) for(var j2=p;j2>=r;j2--) {
      var at=span-p+j2,den=k[at+p-r+1]-k[at],alpha=den?(t-k[at])/den:0;
      for(var axis=0;axis<4;axis++) d[j2][axis]=(1-alpha)*d[j2-1][axis]+alpha*d[j2][axis];
    }
    return {x:d[p][0]/d[p][3],y:d[p][1]/d[p][3],z:d[p][2]/d[p][3]};
  }
  function transform(c,map) {
    var out=JSON.parse(JSON.stringify(c));
    if(c.kind==='nurbs') out.controlPoints=c.controlPoints.map(map);
    else {
      var zero=map({x:0,y:0,z:0});out.center=map(c.center);
      out.u=sub(map(c.u),zero);out.v=sub(map(c.v),zero);
    }
    if(c.interpolationPoints) out.interpolationPoints=c.interpolationPoints.map(map);
    return out;
  }
  function interpolate(input,closed) {
    var points=input.map(xyz),n=points.length;
    if(n<(closed?3:2)||n>128||!points.every(finite)) throw new Error('A curve needs 2–128 finite points (at least 3 when closed).');
    for(var i=1;i<n;i++) if(norm(sub(points[i],points[i-1]))<EPS) throw new Error('Consecutive curve points must be distinct.');
    if(closed && norm(sub(points[0],points[n-1]))<EPS) throw new Error('Use closed without repeating the first point.');
    // Natural/periodic cubic interpolation: M[i-1]+4M[i]+M[i+1]
    // = 6(P[i-1]-2P[i]+P[i+1]) at uniform station parameters.
    var A=[],rhs=[];
    for(var row=0;row<n;row++) {
      A[row]=Array(n).fill(0);rhs[row]=[0,0,0];
      if(!closed&&(row===0||row===n-1)) A[row][row]=1;
      else {
        var prev=(row+n-1)%n,next=(row+1)%n;A[row][row]=4;A[row][prev]+=1;A[row][next]+=1;
        var v=mul(add(sub(points[prev],mul(points[row],2)),points[next]),6);rhs[row]=[v.x,v.y,v.z];
      }
    }
    for(var col=0;col<n;col++) {
      var pivot=A[col][col];
      for(var jj=col;jj<n;jj++) A[col][jj]/=pivot;
      for(var ax=0;ax<3;ax++) rhs[col][ax]/=pivot;
      for(var rr=col+1;rr<n;rr++) {
        var f=A[rr][col];if(!f)continue;
        for(var cc=col;cc<n;cc++) A[rr][cc]-=f*A[col][cc];
        for(var aa=0;aa<3;aa++) rhs[rr][aa]-=f*rhs[col][aa];
      }
    }
    for(var back=n-1;back>=0;back--) for(var r2=0;r2<back;r2++) for(var a2=0;a2<3;a2++) rhs[r2][a2]-=A[r2][back]*rhs[back][a2];
    var M=rhs.map(function(v) {return {x:v[0],y:v[1],z:v[2]};}),count=closed?n:n-1,cp=[],knots=[0,0,0,0];
    for(var seg=0;seg<count;seg++) {
      var end=(seg+1)%n,delta=sub(points[end],points[seg]);
      var d0=sub(delta,mul(add(mul(M[seg],2),M[end]),1/6));
      var d1=add(delta,mul(add(M[seg],mul(M[end],2)),1/6));
      if(!seg) cp.push(points[seg]);
      cp.push(add(points[seg],mul(d0,1/3)),sub(points[end],mul(d1,1/3)),points[end]);
      if(seg<count-1) knots.push((seg+1)/count,(seg+1)/count,(seg+1)/count);
    }
    knots.push(1,1,1,1);
    return {kind:'nurbs',degree:3,controlPoints:cp,weights:cp.map(function(){return 1;}),knots:knots,closed:!!closed,
      definition:'interpolated',interpolation:closed?'periodic-cubic':'natural-cubic',parameterization:'uniform-stations',
      interpolationPoints:points,parameters:points.map(function(_,i){return i/count;})};
  }
  function throughCircle(input,arc) {
    var a=xyz(input[0]),b=xyz(input[1]),c=xyz(input[2]),u=sub(b,a),v=sub(c,a),det=2*(u.x*v.y-u.y*v.x);
    var scale=Math.max(norm(u),norm(v));
    if(!finite(a)||!finite(b)||!finite(c)||Math.abs(det)<=EPS*scale*scale) throw new Error('A circle or arc needs three distinct non-collinear points.');
    var U=dot(u,u),V=dot(v,v),center={x:a.x+(U*v.y-V*u.y)/det,y:a.y+(u.x*V-v.x*U)/det,z:0};
    function angle(p){return (Math.atan2(p.y-center.y,p.x-center.x)+TAU)%TAU;}
    var start=angle(a),mid=angle(b),end=angle(c),sweep=(end-start+TAU)%TAU;
    var reverse=(mid-start+TAU)%TAU>sweep;
    return {x:center.x,y:center.y,radius:norm(sub(a,center)),startAngle:arc?(reverse?end:start)*180/Math.PI:0,
      endAngle:arc?(reverse?start:end)*180/Math.PI:0,throughDirection:reverse?-1:1};
  }
  // Display approximation only. Knot breaks are always retained; quarter
  // samples avoid the midpoint blind spot of inflection-shaped cubic spans.
  function tessellate(c,tolerance) {
    tolerance=tolerance||0.1;
    var bounds=domain(c),breaks=c.kind==='nurbs'?c.knots.filter(function(t,i,k){return t>=bounds[0]&&t<=bounds[1]&&(!i||t!==k[i-1]);}):[0,0.25,0.5,0.75,1];
    var out=[{t:bounds[0],point:point(c,bounds[0])}];
    function split(a,b,pa,pb,depth) {
      var d=sub(pb,pa),l=dot(d,d),worst=0;
      [0.25,0.5,0.75].forEach(function(f){var q=point(c,a+(b-a)*f),w=sub(q,pa),u=l?Math.max(0,Math.min(1,dot(w,d)/l)):0;worst=Math.max(worst,norm(sub(w,mul(d,u))));});
      if(worst>tolerance&&depth<12) {var m=(a+b)/2,pm=point(c,m);split(a,m,pa,pm,depth+1);split(m,b,pm,pb,depth+1);}
      else out.push({t:b,point:pb});
    }
    for(var i=1;i<breaks.length;i++)split(breaks[i-1],breaks[i],point(c,breaks[i-1]),point(c,breaks[i]),0);
    return out;
  }
  function plane(c) {
    var p=c.controlPoints;if(!p||p.length<3)return null;
    var origin=p[0],n=null;
    for(var i=1;i<p.length-1;i++) {var candidate=cross(sub(p[i],origin),sub(p[i+1],origin));if(norm(candidate)>EPS){n=mul(candidate,1/norm(candidate));break;}}
    if(!n||p.some(function(q){return Math.abs(dot(sub(q,origin),n))>1e-6;}))return null;
    return {origin:origin,normal:n};
  }
  return {point:point,domain:domain,validate:validate,transform:transform,interpolate:interpolate,throughCircle:throughCircle,tessellate:tessellate,plane:plane};
});

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADObliqueKernel = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Oblique circle kernel: a circle in a general plane projects to an ellipse
  // in each principal view. Fit each projected ellipse, recover the plane
  // normal from its major/minor axes, then combine centres from two views.
  // This is deliberately separate from the true-shape/edge-on curve stage.
  var EPS = 1e-6, TAU = 2 * Math.PI, TOL = 0.5, MIN_SEGS = 12, MIN_LINE_SEGS = 32;
  function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? EPS : tol); }
  function helper(e) {
    var m = e.meta || {};
    return m.reconstructionRole === 'construction' || ['axis', 'projector', 'locus'].indexOf(m.kind) !== -1;
  }
  function viewOf(e) {
    if (e.viewRole === 'PLAN' || e.viewRole === 'ELEVATION' || e.viewRole === 'PROFILE') return e.viewRole;
    if (!e.viewRole || e.viewRole === 'BOTH') return e.y > 0 ? 'ELEVATION' : e.y < 0 ? 'PLAN' : null;
    return null;
  }
  function keyOf(x, y) { return Math.round(x * 1e4) + ',' + Math.round(y * 1e4); }
  function fitEllipse(points) {
    if (!points || points.length < 3) return null;
    var cx = 0, cy = 0, i;
    for (i = 0; i < points.length; i++) { cx += points[i].x; cy += points[i].y; }
    cx /= points.length; cy /= points.length;
    var xx = 0, yy = 0, xy = 0;
    for (i = 0; i < points.length; i++) {
      var dx = points[i].x - cx, dy = points[i].y - cy;
      xx += dx * dx; yy += dy * dy; xy += dx * dy;
    }
    xx /= points.length; yy /= points.length; xy /= points.length;
    var tr = xx + yy, det = xx * yy - xy * xy;
    var disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    var l1 = tr / 2 + disc, l2 = tr / 2 - disc;
    if (!(l1 > EPS * EPS) || !(l2 > 0)) return null;
    var a = Math.sqrt(2 * l1), b = Math.sqrt(2 * l2);
    // A near-axis-aligned ellipse has a tiny but nonzero xy from rounding.
    // Compare it relatively, or the eigenvector above collapses to noise.
    var mx = 1, my = 0;
    if (Math.abs(xy) > 1e-12 * Math.max(1, xx + yy)) { mx = l1 - yy; my = xy; }
    else if (xx < yy) { mx = 0; my = 1; }
    var ml = Math.hypot(mx, my);
    if (!(ml > EPS)) {
      if (xx < yy) { mx = 0; my = 1; } else { mx = 1; my = 0; }
      ml = 1;
    }
    mx /= ml; my /= ml;
    var maxErr = 0;
    for (i = 0; i < points.length; i++) {
      var px = points[i].x - cx, py = points[i].y - cy;
      var u = (px * mx + py * my) / a, v = (px * -my + py * mx) / b;
      maxErr = Math.max(maxErr, Math.abs(u * u + v * v - 1));
    }
    if (maxErr > 0.08) return null;
    return {center:{x:cx,y:cy}, a:a, b:b, major:{x:mx,y:my}, maxError:maxErr};
  }
  // Partial ellipses are not uniformly sampled full rings. Fit a normalized
  // conic instead of estimating its axes from sample covariance.
  function fitArcEllipse(points) {
    var cx=0,cy=0;
    points.forEach(function(p) {cx+=p.x;cy+=p.y;});cx/=points.length;cy/=points.length;
    var scale=Math.max.apply(null,points.map(function(p) {return Math.hypot(p.x-cx,p.y-cy);}));
    if(scale<EPS) return null;
    var rows=points.map(function(p) {var x=(p.x-cx)/scale,y=(p.y-cy)/scale;return [x*x,x*y,y*y,x,y];});
    var matrix=Array.from({length:5},function(_,i) {
      return Array.from({length:6},function(_,j) {return rows.reduce(function(s,r) {return s+r[i]*(j===5?1:r[j]);},0);});
    });
    for(var i=0;i<5;i++) {
      var pivot=i;
      for(var j=i+1;j<5;j++) if(Math.abs(matrix[j][i])>Math.abs(matrix[pivot][i])) pivot=j;
      if(Math.abs(matrix[pivot][i])<1e-10) return null;
      var swap=matrix[i];matrix[i]=matrix[pivot];matrix[pivot]=swap;
      var divisor=matrix[i][i];
      for(var k=i;k<6;k++) matrix[i][k]/=divisor;
      for(var r=0;r<5;r++) if(r!==i) {
        var factor=matrix[r][i];
        for(var c=i;c<6;c++) matrix[r][c]-=factor*matrix[i][c];
      }
    }
    var q=matrix.map(function(r) {return r[5];}), a=q[0],b=q[1]/2,d=q[2],det=a*d-b*b;
    if(a<=0 || det<=1e-12) return null;
    var x=(b*q[4]-d*q[3])/(2*det),y=(b*q[3]-a*q[4])/(2*det);
    var level=1-(q[3]*x+q[4]*y)/2;
    var disc=Math.hypot(a-d,2*b),lo=(a+d-disc)/2,hi=(a+d+disc)/2;
    if(lo<=0 || level<=0) return null;
    var mx=Math.abs(b)>1e-12?b:(a<=d?1:0),my=Math.abs(b)>1e-12?lo-a:(a<=d?0:1),len=Math.hypot(mx,my);
    var fit={center:{x:cx+scale*x,y:cy+scale*y},a:scale*Math.sqrt(level/lo),b:scale*Math.sqrt(level/hi),major:{x:mx/len,y:my/len}};
    fit.maxError=Math.max.apply(null,points.map(function(p) {
      var dx=p.x-fit.center.x,dy=p.y-fit.center.y;
      return Math.abs(Math.pow((dx*fit.major.x+dy*fit.major.y)/fit.a,2)+Math.pow((-dx*fit.major.y+dy*fit.major.x)/fit.b,2)-1);
    }));
    return fit.maxError<=0.02?fit:null;
  }
  function loopsInView(list, role) {
    var segs = list.filter(function(e) { return e.type === 'SEGMENT' && viewOf(e) === role && !helper(e); });
    var nodes = new Map(), owner = new Map();
    function node(k, x, y) {
      if (!nodes.has(k)) nodes.set(k, {x:x,y:y,adj:[]});
      return nodes.get(k);
    }
    segs.forEach(function(s) {
      var ka = keyOf(s.x, s.y), kb = keyOf(s.x2, s.y2);
      if (ka === kb) return;
      node(ka, s.x, s.y); node(kb, s.x2, s.y2);
      nodes.get(ka).adj.push(kb); nodes.get(kb).adj.push(ka);
      owner.set(s.id, [ka, kb]);
    });
    var seen = new Set(), loops = [];
    nodes.forEach(function(_, start) {
      if (seen.has(start)) return;
      var queue = [start], keys = [], edges = [], good = true;
      seen.add(start);
      while (queue.length) {
        var k = queue.pop(), node = nodes.get(k);
        keys.push(k);
        if (node.adj.length < 1 || node.adj.length > 2) good = false;
        node.adj.forEach(function(n) {
          edges.push(k < n ? k + '>' + n : n + '>' + k);
          if (!seen.has(n)) { seen.add(n); queue.push(n); }
        });
      }
      edges = Array.from(new Set(edges));
      var ends=keys.filter(function(k) {return nodes.get(k).adj.length===1;});
      var closed=ends.length===0;
      if (!good || keys.length < MIN_SEGS || (closed?edges.length!==keys.length:ends.length!==2 || edges.length!==keys.length-1)) return;
      var ordered=[], previous=null, current=closed?start:ends[0];
      while(current!==undefined && ordered.indexOf(current)===-1) {
        ordered.push(current);
        var next=nodes.get(current).adj.find(function(k) {return k!==previous;});
        previous=current;current=next;
      }
      var points = ordered.map(function(k) { var n = nodes.get(k); return {x:n.x,y:n.y}; });
      var fit = closed?fitEllipse(points):fitArcEllipse(points);
      if (!fit) return;
      var ids = [];
      segs.forEach(function(s) {
        var o = owner.get(s.id);
        if (o && keys.indexOf(o[0]) !== -1 && keys.indexOf(o[1]) !== -1) ids.push(s.id);
      });
      if (ids.length < MIN_SEGS-1) return;
      fit.role = role; fit.segments = ids; fit.points = points;fit.closed=closed;
      loops.push(fit);
    });
    return loops;
  }
  // Edge-on traces of a circle are straight runs, including split/overlapping
  // strokes. Keep each run's midpoint, direction and full covered interval so
  // an ellipse in one view can be paired with its line projection in another.
  function lineRunsInView(list, role) {
    var segs = list.filter(function (e) { return e.type === 'SEGMENT' && viewOf(e) === role && !helper(e); });
    var rows = [];
    function sameRow(a, b) {
      return Math.abs(a.dx*b.dy - a.dy*b.dx) <= 1e-6 && Math.abs(a.c - b.c) <= 1e-5*(1+Math.abs(a.c));
    }
    segs.forEach(function (s) {
      var dx = s.x2-s.x, dy = s.y2-s.y, len = Math.hypot(dx,dy);
      if (!(len > EPS)) return;
      dx /= len; dy /= len;
      if (dx < -EPS || (Math.abs(dx) <= EPS && dy < 0)) { dx = -dx; dy = -dy; }
      var c = dx*s.y - dy*s.x;
      var t1 = dx*s.x + dy*s.y, t2 = dx*s.x2 + dy*s.y2;
      var row = rows.find(function (r) { return sameRow(r, {dx:dx,dy:dy,c:c}); });
      if (!row) { row = {dx:dx, dy:dy, c:c, intervals:[]}; rows.push(row); }
      row.intervals.push({min:Math.min(t1,t2), max:Math.max(t1,t2), ids:[s.id]});
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
      merged.forEach(function (r) {
        var t = (r.min+r.max)/2;
        // Anchor the line at the point nearest the sheet origin.
        var anchorX = row.dx*t - row.dy*row.c;
        var anchorY = row.dy*t + row.dx*row.c;
        runs.push({role:role, dx:row.dx, dy:row.dy, c:row.c,
          min:r.min, max:r.max, length:r.max-r.min, ids:r.ids,
          mid:{x:anchorX, y:anchorY}, point:{x:anchorX, y:anchorY}});
      });
    });
    return runs;
  }
  function centerFromLoop(loop, profile) {
    if (loop.role === 'PLAN') return {x:loop.center.x,z:-loop.center.y};
    if (loop.role === 'ELEVATION') return {x:loop.center.x,y:loop.center.y};
    if (loop.role === 'PROFILE' && profile) {
      return {z:profile.dRef + profile.s * (loop.center.x - profile.xRef),y:loop.center.y};
    }
    return null;
  }
  function partialFromPoint(p, role, profile) {
    if (role === 'PLAN') return {x:p.x, z:-p.y};
    if (role === 'ELEVATION') return {x:p.x, y:p.y};
    if (role === 'PROFILE' && profile) return {z:profile.dRef + profile.s*(p.x-profile.xRef), y:p.y};
    return null;
  }
  function centerFromLoopAndLine(loop, run, profile) {
    var out = {}, ok = true;
    [centerFromLoop(loop,profile), partialFromPoint(run.mid, run.role, profile)].forEach(function (part) {
      if (!part) { ok = false; return; }
      Object.keys(part).forEach(function (k) {
        if (out[k] !== undefined && !near(out[k], part[k], TOL)) ok = false;
        else out[k] = part[k];
      });
    });
    return ok && out.x !== undefined && out.y !== undefined && out.z !== undefined ? out : null;
  }
  function runPoint(run,t) {
    return {x:run.dx*t - run.dy*run.c, y:run.dy*t + run.dx*run.c};
  }
  // For an open projected arc the run's midpoint is not the circle centre.
  // Solve the missing centre coordinate from the run's supporting line, then
  // keep endpoint/radius evidence as a fallback for a degenerate line equation.
  function centersFromLoopAndArcLine(loop, run, profile) {
    var base = centerFromLoop(loop, profile);
    if (!base) return [];
    var axes = ['x','y','z'], missing = axes.filter(function(k) { return base[k] === undefined; });
    if (missing.length !== 1) return [];
    var axis = missing[0], known = axes.filter(function(k) { return k !== axis; });
    var ends = [runPoint(run,run.min), runPoint(run,run.max)];
    var first = loop.points[0], last = loop.points[loop.points.length-1];
    var tol = Math.max(TOL, 0.02*run.length), out = [];
    function add(center) {
      var p = project(center, run.role, profile);
      if (!p || Math.abs(run.dx*p.y - run.dy*p.x - run.c) > tol) return;
      if (!out.some(function(q) { return Math.hypot(q.x-center.x,q.y-center.y,q.z-center.z) < TOL; })) out.push(center);
    }
    // The run's supporting line is affine in the missing centre coordinate.
    // Solve it first; this is the robust path for major arcs whose run ends
    // are extrema inside the arc rather than the arc endpoints.
    var p0 = Object.assign({}, base), p1 = Object.assign({}, base);
    p0[axis] = 0; p1[axis] = 1;
    var q0 = project(p0, run.role, profile), q1 = project(p1, run.role, profile);
    if (q0 && q1) {
      var off0 = run.dx*q0.y - run.dy*q0.x - run.c, off1 = run.dx*q1.y - run.dy*q1.x - run.c;
      if (Math.abs(off1-off0) > 1e-9) {
        var center = Object.assign({}, base); center[axis] = -off0/(off1-off0); add(center);
      }
    }
    // Fall back to endpoint/radius evidence when the run is parallel to the
    // missing axis, so the line equation alone cannot locate the centre.
    for (var reverse=0; reverse<2; reverse++) {
      var P = mergeCenter(partialFromPoint(first,loop.role,profile), partialFromPoint(reverse?ends[1]:ends[0],run.role,profile));
      var Q = mergeCenter(partialFromPoint(last,loop.role,profile), partialFromPoint(reverse?ends[0]:ends[1],run.role,profile));
      if (!P || !Q) continue;
      var remP = loop.a*loop.a, remQ = loop.a*loop.a;
      known.forEach(function(k) { remP -= (P[k]-base[k])*(P[k]-base[k]); remQ -= (Q[k]-base[k])*(Q[k]-base[k]); });
      if (remP < -tol*tol || remQ < -tol*tol) continue;
      var rootsP = [P[axis]+Math.sqrt(Math.max(0,remP)), P[axis]-Math.sqrt(Math.max(0,remP))];
      var rootsQ = [Q[axis]+Math.sqrt(Math.max(0,remQ)), Q[axis]-Math.sqrt(Math.max(0,remQ))];
      rootsP.forEach(function(a) { rootsQ.forEach(function(b) {
        if (Math.abs(a-b) > tol) return;
        var center = Object.assign({}, base); center[axis] = (a+b)/2; add(center);
      }); });
    }
    return out;
  }
  // A circle is edge-on in a view exactly when its normal has no component
  // along that view's projection axis.
  function edgeOnInRole(n, role) {
    var axis = role === 'PLAN' ? 'y' : role === 'ELEVATION' ? 'z' : 'x';
    return Math.abs(n[axis]) <= 1e-6;
  }
  // Compare a candidate curve's projection with a straight edge-on run,
  // including the run's supporting line and its covered interval. The run is
  // not assumed to be centred on the circle, so this also supports arcs.
  function lineRunMatchesCurve(curve, run, profile) {
    var start = curve.kind === 'arc' ? curve.startAngle : 0;
    var sweep = curve.kind === 'arc' ? curve.sweepAngle : TAU;
    var tol = Math.max(TOL, 0.02*run.length);
    var center = project(curve.center, run.role, profile);
    if (!center || Math.abs(run.dx*center.y - run.dy*center.x - run.c) > tol) return false;
    var lo = Infinity, hi = -Infinity;
    for (var i=0;i<=24;i++) {
      var p = project(curvePoint(curve, start+sweep*i/24), run.role, profile);
      if (!p || Math.abs(run.dx*p.y - run.dy*p.x - run.c) > tol) return false;
      var t = run.dx*p.x + run.dy*p.y;
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    return Math.abs(lo-run.min) <= tol && Math.abs(hi-run.max) <= tol;
  }
  function sameCurveGeometry(a, b) {
    if (!a || !b || a.kind !== b.kind || !near(a.radius,b.radius,TOL) ||
        !near(a.center.x,b.center.x,TOL) || !near(a.center.y,b.center.y,TOL) || !near(a.center.z,b.center.z,TOL) ||
        !samePlane(cross(a.u,a.v),cross(b.u,b.v))) return false;
    if (a.kind === 'circle') return true;
    if (!near(a.sweepAngle,b.sweepAngle,0.02)) return false;
    var pa = curvePoint(a,a.startAngle+a.sweepAngle/2), pb = curvePoint(b,b.startAngle+b.sweepAngle/2);
    return Math.hypot(pa.x-pb.x,pa.y-pb.y,pa.z-pb.z) < TOL;
  }
  function normalFromLoop(loop, profile) {
    var ratio = Math.max(0, Math.min(1, loop.b / loop.a));
    var minor = {x:-loop.major.y,y:loop.major.x};
    if (ratio > 0.999) ratio = 1;
    var nk = ratio, np = Math.sqrt(Math.max(0, 1 - ratio * ratio));
    var n;
    if (loop.role === 'PLAN') n = {x:np*minor.x,y:nk,z:-np*minor.y};
    else if (loop.role === 'ELEVATION') n = {x:np*minor.x,y:np*minor.y,z:nk};
    else if (loop.role === 'PROFILE' && profile) n = {x:-profile.s*nk,y:np*minor.y,z:profile.s*np*minor.x};
    else return null;
    var len = Math.hypot(n.x,n.y,n.z);
    return len > EPS ? {x:n.x/len,y:n.y/len,z:n.z/len} : null;
  }
  function mergeCenter(a, b) {
    var out = {}, ok = true;
    [a,b].forEach(function(p) {
      if (!p) { ok = false; return; }
      Object.keys(p).forEach(function(k) {
        if (out[k] !== undefined && !near(out[k],p[k],TOL)) ok = false;
        else out[k] = p[k];
      });
    });
    return ok && out.x !== undefined && out.y !== undefined && out.z !== undefined ? out : null;
  }
  function normalize(v) {
    var l = Math.hypot(v.x,v.y,v.z);
    return l > EPS ? {x:v.x/l,y:v.y/l,z:v.z/l} : {x:0,y:0,z:1};
  }
  function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
  function cross(a, b) { return {x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x}; }
  // A single ellipse leaves the sign of the viewing-axis component open.
  // Plane normals n and -n describe the same circle, not two alternatives.
  function normalCandidates(loop, profile) {
    var n = normalFromLoop(loop, profile);
    if (!n) return [];
    var mirror = {x:n.x,y:n.y,z:n.z};
    mirror[loop.role === 'PLAN' ? 'y' : loop.role === 'ELEVATION' ? 'z' : 'x'] *= -1;
    return Math.abs(dot(n,mirror)) > 1 - 1e-10 ? [n] : [n,mirror];
  }
  function samePlane(a, b) { return Math.abs(dot(a,b)) >= 0.9998; }
  function matchingNormals(a, b, profile) {
    var out = [];
    normalCandidates(a,profile).forEach(function(na) {
      normalCandidates(b,profile).forEach(function(nb) {
        if (!samePlane(na,nb)) return;
        var sign = dot(na,nb) < 0 ? -1 : 1;
        var n = normalize({x:na.x+sign*nb.x,y:na.y+sign*nb.y,z:na.z+sign*nb.z});
        if (!out.some(function(p) {return samePlane(p,n);})) out.push(n);
      });
    });
    return out;
  }
  function onEllipse(p, loop) {
    var dx=p.x-loop.center.x, dy=p.y-loop.center.y;
    var u=(dx*loop.major.x+dy*loop.major.y)/loop.a;
    var v=(-dx*loop.major.y+dy*loop.major.x)/loop.b;
    return Math.abs(u*u+v*v-1)<=0.08;
  }
  function onProjection(p,loop) {
    if(!onEllipse(p,loop)) return false;
    if(loop.closed) return true;
    function angleOf(q) {
      var x=q.x-loop.center.x,y=q.y-loop.center.y;
      return Math.atan2((-x*loop.major.y+y*loop.major.x)/loop.b,(x*loop.major.x+y*loop.major.y)/loop.a);
    }
    var range=rangeFromAngles(loop.points.map(angleOf));
    var t=range?wrap(angleOf(p)-range.start):0;
    return !!range && (t<=range.sweep+0.02 || t>=TAU-0.02);
  }
  // Only corresponding boundary stations constrain the plane. Unlinked
  // points, centres, and unrelated geometry cannot select a mirror.
  function boundaryPoints(list, a, b, profile) {
    var groups=new Map(), out=[];
    list.forEach(function(p) {
      if(p.type!=='POINT') return;
      var role=viewOf(p), loop=role===a.role?a:role===b.role?b:null;
      if(!loop || !onProjection(p,loop)) return;
      ((p.meta || {}).members || []).forEach(function(m) {
        if(!groups.has(m.id)) groups.set(m.id,[]);
        groups.get(m.id).push(p);
      });
    });
    groups.forEach(function(points,id) {
      var left=points.filter(function(p) {return viewOf(p)===a.role;});
      var right=points.filter(function(p) {return viewOf(p)===b.role;});
      left.forEach(function(p) {right.forEach(function(q) {
        function coords(e) {return centerFromLoop({role:viewOf(e),center:{x:e.x,y:e.y}},profile);}
        var position=mergeCenter(coords(p),coords(q));
        if(position) out.push({memberId:id,position:position,sourceIds:[p.id,q.id]});
      });});
    });
    return out;
  }
  function pointFits(p, center, radius, normal) {
    var d={x:p.x-center.x,y:p.y-center.y,z:p.z-center.z};
    var tol=Math.max(TOL,0.02*radius);
    return Math.abs(dot(d,normal))<=tol && Math.abs(Math.hypot(d.x,d.y,d.z)-radius)<=tol;
  }
  function basis(n) {
    var ref = Math.abs(n.x) < 0.9 ? {x:1,y:0,z:0} : {x:0,y:1,z:0};
    var u = normalize(cross(n, ref));
    var v = normalize(cross(n, u));
    return {u:u,v:v};
  }
  function makeCurve(center, normal, radius, sources, roleA, roleB) {
    var n = normalize(normal), b = basis(n);
    return {kind:'circle',center:{x:center.x,y:center.y,z:center.z},u:b.u,v:b.v,
      radius:radius,startAngle:0,sweepAngle:TAU,sourceIds:sources.slice(),
      sourceView:roleA,framePair:[roleA,roleB],oblique:true,
      displayVertices:[],displayEdges:[]};
  }
  function wrap(t) {return (t%TAU+TAU)%TAU;}
  function project(p,role,profile,vector) {
    if(role==='PLAN') return {x:p.x,y:-p.z};
    if(role==='ELEVATION') return {x:p.x,y:p.y};
    if(role==='PROFILE'&&profile)return {x:profile.s*p.z+(vector?0:profile.xRef-profile.s*profile.dRef),y:p.y};
    return null;
  }
  function parameter(p,curve,role,profile) {
    var c=project(curve.center,role,profile),u=project(curve.u,role,profile,true),v=project(curve.v,role,profile,true);
    var x=p.x-c.x,y=p.y-c.y,det=u.x*v.y-u.y*v.x;
    return Math.atan2((u.x*y-u.y*x)/det,(x*v.y-y*v.x)/det);
  }
  function curvePoint(c,t) {
    return {x:c.center.x+c.radius*(c.u.x*Math.cos(t)+c.v.x*Math.sin(t)),
      y:c.center.y+c.radius*(c.u.y*Math.cos(t)+c.v.y*Math.sin(t)),
      z:c.center.z+c.radius*(c.u.z*Math.cos(t)+c.v.z*Math.sin(t))};
  }
  function arcRange(loop,curve,profile) {
    if(loop.closed) return {start:0,sweep:TAU};
    var angles=loop.points.map(function(p) {return parameter(p,curve,loop.role,profile);});
    return rangeFromAngles(angles);
  }
  function rangeFromAngles(angles) {
    var total=0,sign=0;
    for(var i=1;i<angles.length;i++) {
      var delta=wrap(angles[i]-angles[i-1]+Math.PI)-Math.PI;
      if(Math.abs(delta)<1e-8) continue;
      if(sign && sign*delta<0) return null;
      sign=delta>0?1:-1;total+=delta;
    }
    if(Math.abs(total)<1e-4 || Math.abs(total)>=TAU-1e-4) return null;
    return {start:wrap(total>0?angles[0]:angles[angles.length-1]),sweep:Math.abs(total)};
  }
  function sameRange(a,b) {
    return a && b && Math.abs(wrap(a.start-b.start+Math.PI)-Math.PI)<0.02 && Math.abs(a.sweep-b.sweep)<0.02;
  }
  function visibilityEvidence(curve,sources,byId,profile,visibilityAt) {
    var tested=0,conflicts=0;
    sources.forEach(function(id) {
      var e=byId.get(id), role=viewOf(e);
      if(e.bisCode!=='A' && e.bisCode!=='E') return;
      var start=parameter({x:e.x,y:e.y},curve,role,profile);
      var end=parameter({x:e.x2,y:e.y2},curve,role,profile);
      var delta=wrap(end-start+Math.PI)-Math.PI;
      [0.25,0.5,0.75].forEach(function(t) {
        var hidden=visibilityAt(curvePoint(curve,start+t*delta),role);
        if(hidden===null) return;
        tested++;if(hidden!==(e.bisCode==='E')) conflicts++;
      });
    });
    return {tested:tested,conflicts:conflicts};
  }
  function reconstruct(entities, options) {
    options = options || {};
    var list = (entities || []).filter(function(e) { return e && !helper(e); });
    var profile = options.profile || null;
    var loops = [];
    ['PLAN','ELEVATION','PROFILE'].forEach(function(role) { loops = loops.concat(loopsInView(list, role)); });
    var byId=new Map(list.map(function(e) {return [e.id,e];}));
    var visibilityAt=options.visibilityProvider?options.visibilityProvider([].concat.apply([],loops.map(function(l) {return l.segments;}))):null;
    var curves = [], issues = [], used = new Set(), pointIds = new Set();
    for (var i = 0; i < loops.length; i++) {
      for (var j = i + 1; j < loops.length; j++) {
        var a = loops[i], b = loops[j];
        if (a.role === b.role) continue;
        if(a.closed!==b.closed) continue;
        if (!near(a.a, b.a, Math.max(TOL, 0.02 * Math.max(a.a, b.a)))) continue;
        var ca = centerFromLoop(a, profile), cb = centerFromLoop(b, profile);
        var center = mergeCenter(ca, cb);
        if (!center) continue;
        var normals = matchingNormals(a,b,profile);
        if (!normals.length) {
          issues.push({code:'oblique-curve-conflict',entityId:a.segments[0],
            message:'The two elliptical projections do not describe one circle plane.'});
          continue;
        }
        var radius = (a.a + b.a) / 2;
        var evidence = boundaryPoints(list,a,b,profile);
        normals = normals.filter(function(n) {
          return evidence.every(function(p) {return pointFits(p.position,center,radius,n);});
        });
        if(!normals.length) {
          issues.push({code:'oblique-point-conflict',entityId:a.segments[0],
            message:'Linked boundary points contradict every circle plane supported by these ellipses.'});
          continue;
        }
        var sources = a.segments.concat(b.segments);
        var candidates=normals.map(function(n) {
          var curve=makeCurve(center,n,radius,sources,a.role,b.role);
          var rangeA=arcRange(a,curve,profile),rangeB=arcRange(b,curve,profile);
          if(!sameRange(rangeA,rangeB)) return null;
          if(!a.closed) {curve.kind='arc';curve.startAngle=rangeA.start;curve.sweepAngle=rangeA.sweep;}
          return curve;
        }).filter(Boolean);
        if(!candidates.length) {
          issues.push({code:'oblique-arc-conflict',entityId:a.segments[0],message:'The projected arc endpoints and sweeps do not describe the same spatial arc.'});
          continue;
        }
        if(visibilityAt && candidates.length>1) {
          var scored=candidates.map(function(c) {return visibilityEvidence(c,sources,byId,profile,visibilityAt);});
          if(scored.some(function(s) {return s.tested>0;})) {
            candidates=candidates.filter(function(c,i) {
              if(scored[i].conflicts) return false;
              c.visibilityEvidence={samples:scored[i].tested,sourceIds:sources.slice(),occluderSourceIds:(visibilityAt.sourceIds || []).slice()};return true;
            });
            if(!candidates.length) {
              issues.push({code:'oblique-visibility-conflict',entityId:a.segments[0],message:'No candidate plane agrees with the drawn visible/hidden strokes and reconstructed occluders.'});
              continue;
            }
          }
        }
        if (candidates.length > 1) issues.push({code:'oblique-curve-ambiguous',entityId:a.segments[0],
          message:'The projections determine the oblique circle up to a mirror in depth; add visibility or point evidence to select one.'});
        var chosen=candidates[0];
        var duplicate = curves.find(function(c) { return sameCurveGeometry(c,chosen); });
        if (duplicate) duplicate.sourceIds = Array.from(new Set(duplicate.sourceIds.concat(sources)));
        else {duplicate=chosen;curves.push(duplicate);}
        if(chosen.visibilityEvidence) duplicate.visibilityEvidence=chosen.visibilityEvidence;
        duplicate.pointEvidence=duplicate.pointEvidence || [];
        evidence.forEach(function(p) {
          if(!duplicate.pointEvidence.some(function(q) {return q.memberId===p.memberId && q.sourceIds.join('|')===p.sourceIds.join('|');})) duplicate.pointEvidence.push(p);
          p.sourceIds.forEach(function(id) {pointIds.add(id);});
        });
        sources.forEach(function(id) { used.add(id); });
      }
    }
    // A circle or arc whose plane is edge-on in one view projects to an
    // ellipse in another view and a straight run in the edge-on view. The
    // ellipse fixes the radius and normal candidates. A closed circle uses the
    // run midpoint for its centre; an open arc solves the missing coordinate
    // from the run's supporting line and checks the covered interval instead.
    var lineRuns = [];
    ['PLAN','ELEVATION','PROFILE'].forEach(function(role) {
      lineRuns = lineRuns.concat(lineRunsInView(list, role));
    });
    loops.forEach(function(loop) {
      if (loop.segments.length < (loop.closed ? MIN_LINE_SEGS : MIN_SEGS-1) ||
          loop.segments.some(function(id) { return used.has(id); })) return;
      var radius = loop.a;
      lineRuns.forEach(function(run) {
        if (run.role === loop.role || run.ids.some(function(id) { return used.has(id); })) return;
        if (loop.closed && Math.abs(run.length - 2*radius) > Math.max(TOL, 0.02*radius)) return;
        var centers = loop.closed ? [centerFromLoopAndLine(loop, run, profile)] : centersFromLoopAndArcLine(loop, run, profile);
        centers = centers.filter(Boolean);
        if (!centers.length) return;
        var normals = normalCandidates(loop, profile).filter(function(n) { return edgeOnInRole(n, run.role); });
        if (!normals.length) return;
        var sources = loop.segments.concat(run.ids);
        var candidates = [];
        centers.forEach(function(center) {
          normals.forEach(function(n) {
            var curve = makeCurve(center, n, radius, sources, loop.role, run.role);
            if (!loop.closed) {
              var range = arcRange(loop, curve, profile);
              if (!range) return;
              curve.kind = 'arc'; curve.startAngle = range.start; curve.sweepAngle = range.sweep;
            }
            if (!lineRunMatchesCurve(curve, run, profile)) return;
            curve.obliqueLine = {role:run.role, ids:run.ids.slice()};
            candidates.push(curve);
          });
        });
        candidates = candidates.filter(function(c,i) { return candidates.findIndex(function(q) { return sameCurveGeometry(c,q); }) === i; });
        if (!candidates.length) {
          issues.push({code:'oblique-line-conflict',entityId:loop.segments[0],
            message:'The straight edge-on trace does not match the elliptical projection and its plane.'});
          return;
        }
        if (candidates.length > 1) issues.push({code:'oblique-curve-ambiguous',entityId:loop.segments[0],
          message:'The projected curve and line leave a depth mirror; add a third view or point evidence.'});
        var chosen = candidates[0];
        var duplicate = curves.find(function(c) { return sameCurveGeometry(c, chosen); });
        if (duplicate) duplicate.sourceIds = Array.from(new Set(duplicate.sourceIds.concat(sources)));
        else { duplicate = chosen; curves.push(duplicate); }
        sources.forEach(function(id) { used.add(id); });
      });
    });
    loops.forEach(function(loop) {
      if (!loop.segments.some(function(id) { return used.has(id); })) {
        issues.push({code:'oblique-curve-projection-missing',entityId:loop.segments[0],
          message:'This elliptical projection needs a matching ellipse in another view.'});
      }
    });
    return {curves:curves, consumedIds:Array.from(used), pointIds:Array.from(pointIds), issues:issues};
  }
  return {reconstruct:reconstruct, fitEllipse:fitEllipse, loopsInView:loopsInView,
    centerFromLoop:centerFromLoop, normalFromLoop:normalFromLoop};
});

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADObliqueKernel = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Oblique circle kernel: a circle in a general plane projects to an ellipse
  // in each principal view. Fit each projected ellipse, recover the plane
  // normal from its major/minor axes, then combine centres from two views.
  // This is deliberately separate from the true-shape/edge-on curve stage.
  var EPS = 1e-6, TAU = 2 * Math.PI, TOL = 0.5, MIN_SEGS = 12;
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
    var mx = 1, my = 0;
    if (Math.abs(xy) > 1e-12) { mx = l1 - yy; my = xy; }
    else if (xx < yy) { mx = 0; my = 1; }
    var ml = Math.hypot(mx, my);
    if (!(ml > EPS)) { mx = 1; my = 0; ml = 1; }
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
        if (node.adj.length !== 2) good = false;
        node.adj.forEach(function(n) {
          edges.push(k < n ? k + '>' + n : n + '>' + k);
          if (!seen.has(n)) { seen.add(n); queue.push(n); }
        });
      }
      edges = Array.from(new Set(edges));
      if (!good || keys.length < MIN_SEGS || edges.length !== keys.length) return;
      var points = keys.map(function(k) { var n = nodes.get(k); return {x:n.x,y:n.y}; });
      var fit = fitEllipse(points);
      if (!fit) return;
      var ids = [];
      segs.forEach(function(s) {
        var o = owner.get(s.id);
        if (o && keys.indexOf(o[0]) !== -1 && keys.indexOf(o[1]) !== -1) ids.push(s.id);
      });
      if (ids.length < MIN_SEGS) return;
      fit.role = role; fit.segments = ids; fit.points = points;
      loops.push(fit);
    });
    return loops;
  }
  function centerFromLoop(loop, profile) {
    if (loop.role === 'PLAN') return {x:loop.center.x,z:-loop.center.y};
    if (loop.role === 'ELEVATION') return {x:loop.center.x,y:loop.center.y};
    if (loop.role === 'PROFILE' && profile) {
      return {z:profile.dRef + profile.s * (loop.center.x - profile.xRef),y:loop.center.y};
    }
    return null;
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
  function reconstruct(entities, options) {
    options = options || {};
    var list = (entities || []).filter(function(e) { return e && !helper(e); });
    var profile = options.profile || null;
    var loops = [];
    ['PLAN','ELEVATION','PROFILE'].forEach(function(role) { loops = loops.concat(loopsInView(list, role)); });
    var curves = [], issues = [], used = new Set();
    for (var i = 0; i < loops.length; i++) {
      for (var j = i + 1; j < loops.length; j++) {
        var a = loops[i], b = loops[j];
        if (a.role === b.role) continue;
        if (!near(a.a, b.a, Math.max(TOL, 0.02 * Math.max(a.a, b.a)))) continue;
        var ca = centerFromLoop(a, profile), cb = centerFromLoop(b, profile);
        var center = mergeCenter(ca, cb);
        if (!center) continue;
        var na = normalFromLoop(a, profile), nb = normalFromLoop(b, profile);
        var dp = na && nb ? dot(na, nb) : 0;
        var parallel = Math.abs(dp) >= 0.99;
        var mirror = !parallel && na && nb &&
          near(Math.abs(na.x), Math.abs(nb.x), 0.02) &&
          near(Math.abs(na.y), Math.abs(nb.y), 0.02) &&
          near(Math.abs(na.z), Math.abs(nb.z), 0.02);
        if (!na || !nb || (!parallel && !mirror)) {
          issues.push({code:'oblique-curve-conflict',entityId:a.segments[0],
            message:'The two elliptical projections do not describe one circle plane.'});
          continue;
        }
        if (mirror) issues.push({code:'oblique-curve-ambiguous',entityId:a.segments[0],
          message:'The projections determine the oblique circle up to a mirror in depth; add visibility or point evidence to select one.'});
        var sign = dp < 0 ? -1 : 1;
        var normal = parallel ? normalize({x:na.x + sign*nb.x,y:na.y + sign*nb.y,z:na.z + sign*nb.z}) : na;
        var radius = (a.a + b.a) / 2;
        var sources = a.segments.concat(b.segments);
        var duplicate = curves.find(function(c) {
          return near(c.radius, radius, TOL) &&
            near(c.center.x, center.x, TOL) && near(c.center.y, center.y, TOL) && near(c.center.z, center.z, TOL) &&
            Math.abs(dot(basis(c).u, basis({x:normal.x,y:normal.y,z:normal.z}).u)) > 0.999;
        });
        if (duplicate) duplicate.sourceIds = Array.from(new Set(duplicate.sourceIds.concat(sources)));
        else curves.push(makeCurve(center, normal, radius, sources, a.role, b.role));
        sources.forEach(function(id) { used.add(id); });
      }
    }
    loops.forEach(function(loop) {
      if (!loop.segments.some(function(id) { return used.has(id); })) {
        issues.push({code:'oblique-curve-projection-missing',entityId:loop.segments[0],
          message:'This elliptical projection needs a matching ellipse in another view.'});
      }
    });
    return {curves:curves, consumedIds:Array.from(used), issues:issues};
  }
  return {reconstruct:reconstruct, fitEllipse:fitEllipse, loopsInView:loopsInView,
    centerFromLoop:centerFromLoop, normalFromLoop:normalFromLoop};
});

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADPlanar = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';





  var EPS = 1e-9, TAU = 2 * Math.PI;

  function point(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw new Error('planar: point needs finite x and y');
    return {x:p.x, y:p.y};
  }
  function sub(a, b) { return {x:a.x - b.x, y:a.y - b.y}; }
  function cross(a, b) { return a.x*b.y - a.y*b.x; }
  function dot(a, b) { return a.x*b.x + a.y*b.y; }
  function length(v) { return Math.hypot(v.x, v.y); }
  function key(p) {
    return Math.round(p.x / 1e-9) + ',' + Math.round(p.y / 1e-9);
  }
  function pointKey(p) { return key(point(p)); }
  function samePoint(a, b) { return pointKey(a) === pointKey(b); }

  function regionLoops(region) {
    if (!region) return [];
    if (Array.isArray(region)) {
      if (!region.length) return [];
      if (Array.isArray(region[0])) return region.map(function (points) {
        return {role:'outer', points:points.map(point)};
      });
      return [{role:'outer', points:region.map(point)}];
    }
    if (Array.isArray(region.loops)) return region.loops.map(function (loop) {
      return {role:loop.role || loop.kind || 'outer',
        points:(loop.points || loop.vertices || []).map(point)};
    });
    var loops = [];
    if (Array.isArray(region.outer))
      loops.push({role:'outer', points:region.outer.map(point)});
    (region.holes || []).forEach(function (hole) {
      loops.push({role:'inner', points:hole.map(point)});
    });
    return loops;
  }
  function allSegments(regions) {
    var segments = [];
    regions.forEach(function (region, regionIndex) {
      regionLoops(region).forEach(function (loop, loopIndex) {
        var points = loop.points;
        for (var i=0;i<points.length;i++) {
          var a = points[i], b = points[(i+1)%points.length];
          if (!samePoint(a, b))
            segments.push({a:a, b:b, regionIndex:regionIndex, loopIndex:loopIndex});
        }
      });
    });
    return segments;
  }
  function toleranceFor(segments) {
    var scale = 1;
    segments.forEach(function (s) {
      scale = Math.max(scale, Math.abs(s.a.x), Math.abs(s.a.y),
        Math.abs(s.b.x), Math.abs(s.b.y));
    });
    return Math.max(1e-12, scale * 1e-9);
  }
  function addSplit(splits, index, t, tolerance) {
    if (!Number.isFinite(t)) return;
    var length = Math.hypot(
      splits[index].segment.b.x - splits[index].segment.a.x,
      splits[index].segment.b.y - splits[index].segment.a.y);
    if (t < -tolerance/length || t > 1 + tolerance/length) return;
    splits[index].ts.push(Math.max(0, Math.min(1, t)));
  }
  function segmentIntersections(one, two, tolerance) {
    var p = one.a, r = sub(one.b, one.a);
    var q = two.a, s = sub(two.b, two.a);
    var den = cross(r, s);
    var qp = sub(q, p);
    if (Math.abs(den) <= tolerance * Math.max(1, length(r), length(s))) {
      if (Math.abs(cross(qp, r)) > tolerance * Math.max(1, length(r))) return [];
      var rr = dot(r, r), ss = dot(s, s);
      if (rr <= EPS || ss <= EPS) return [];
      var t0 = dot(qp, r) / rr;
      var t1 = t0 + dot(s, r) / rr;
      var lo = Math.max(0, Math.min(t0, t1));
      var hi = Math.min(1, Math.max(t0, t1));
      if (hi < lo - tolerance) return [];
      var u0 = dot(sub(one.a, two.a), s) / ss;
      var u1 = u0 + dot(r, s) / ss;
      return [{one:lo, two:Math.max(0, Math.min(1, Math.min(u0, u1))), point:null},
        {one:hi, two:Math.max(0, Math.min(1, Math.max(u0, u1))), point:null}];
    }
    var t = cross(qp, s) / den;
    var u = cross(qp, r) / den;
    if (t < -tolerance || t > 1 + tolerance ||
        u < -tolerance || u > 1 + tolerance) return [];
    return [{one:Math.max(0, Math.min(1, t)), two:Math.max(0, Math.min(1, u)),
      point:{x:p.x + r.x*t, y:p.y + r.y*t}}];
  }

  function buildArrangement(regions) {
    var segments = allSegments(regions);
    var tolerance = toleranceFor(segments);
    if (!segments.length) return {vertices:[], edges:[], faces:[], tolerance:tolerance,
      diagnostics:[{code:'planar-empty-region', severity:'warning',
        message:'No straight boundary segments were supplied.'}]};
    var splits = segments.map(function (segment) {
      return {segment:segment, ts:[0, 1]};
    });
    for (var i=0;i<segments.length;i++) {
      for (var j=i+1;j<segments.length;j++) {
        var hits = segmentIntersections(segments[i], segments[j], tolerance);
        hits.forEach(function (hit) {
          addSplit(splits, i, hit.one, tolerance);
          if (hit.two !== null) addSplit(splits, j, hit.two, tolerance);
        });
      }
    }
    var edges = [], edgeMap = Object.create(null);
    splits.forEach(function (split) {
      split.ts.sort(function (a, b) { return a - b; });
      for (var k=0;k+1<split.ts.length;k++) {
        var t0 = split.ts[k], t1 = split.ts[k+1];
        if (t1 - t0 <= tolerance) continue;
        var a = {x:split.segment.a.x + (split.segment.b.x - split.segment.a.x)*t0,
          y:split.segment.a.y + (split.segment.b.y - split.segment.a.y)*t0};
        var b = {x:split.segment.a.x + (split.segment.b.x - split.segment.a.x)*t1,
          y:split.segment.a.y + (split.segment.b.y - split.segment.a.y)*t1};
        if (samePoint(a, b)) continue;
        var ka = pointKey(a), kb = pointKey(b);
        var edgeKey = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        if (edgeMap[edgeKey]) continue;
        edgeMap[edgeKey] = true;
        edges.push({a:a, b:b});
      }
    });
    var vertices = Object.create(null);
    edges.forEach(function (edge) {
      vertices[pointKey(edge.a)] = edge.a;
      vertices[pointKey(edge.b)] = edge.b;
    });
    var vertexList = Object.keys(vertices).map(function (k) { return vertices[k]; });
    var halfEdges = [];
    function addHalfEdge(from, to) {
      halfEdges.push({id:halfEdges.length, from:from, to:to, twin:null, used:false});
    }
    edges.forEach(function (edge) {
      addHalfEdge(point(edge.a), point(edge.b));
      addHalfEdge(point(edge.b), point(edge.a));
    });
    var outgoing = Object.create(null);
    halfEdges.forEach(function (half) {
      var k = pointKey(half.from);
      (outgoing[k] || (outgoing[k] = [])).push(half.id);
    });
    function angle(half) {
      return Math.atan2(half.to.y - half.from.y, half.to.x - half.from.x);
    }
    Object.keys(outgoing).forEach(function (k) {
      outgoing[k].sort(function (a, b) { return angle(halfEdges[a]) - angle(halfEdges[b]); });
    });
    halfEdges.forEach(function (half, id) {
      var twinKey = pointKey(half.to) + '|' + pointKey(half.from);
      for (var j=0;j<halfEdges.length;j++) {
        if (j !== id && pointKey(halfEdges[j].from) === pointKey(half.to) &&
            pointKey(halfEdges[j].to) === pointKey(half.from)) {
          half.twin = j;
          break;
        }
      }
    });
    function nextHalfEdge(id) {
      var half = halfEdges[id], twin = halfEdges[half.twin];
      var list = outgoing[pointKey(half.to)] || [];
      var index = list.indexOf(half.twin);
      if (index === -1) index = 0;
      return list[(index - 1 + list.length) % list.length];
    }
    var cycles = [];
    for (var h=0;h<halfEdges.length;h++) {
      if (halfEdges[h].used) continue;
      var cycle = [], current = h, guard = 0;
      while (!halfEdges[current].used && guard++ <= halfEdges.length + 1) {
        halfEdges[current].used = true;
        cycle.push(point(halfEdges[current].from));
        current = nextHalfEdge(current);
        if (current === h) break;
      }
      if (cycle.length >= 3) {
        var area = 0;
        for (var c=0;c<cycle.length;c++) {
          var one = cycle[c], two = cycle[(c+1)%cycle.length];
          area += one.x*two.y - two.x*one.y;
        }
        cycles.push({points:cycle, area:area/2});
      }
    }
    var positives = cycles.filter(function (cycle) { return cycle.area > tolerance*tolerance; });
    var negatives = cycles.filter(function (cycle) { return cycle.area < -tolerance*tolerance; });
    function contains(polygon, p) {
      var inside = false;
      for (var i=0,j=polygon.length-1;i<polygon.length;j=i++) {
        var a = polygon[i], b = polygon[j];
        if ((a.y > p.y) !== (b.y > p.y) &&
            p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    }
    positives.forEach(function (cell) { cell.holes = []; });
    negatives.forEach(function (hole) {
      var cx = 0, cy = 0;
      hole.points.forEach(function (p) { cx += p.x; cy += p.y; });
      var probe = {x:cx/hole.points.length, y:cy/hole.points.length};
      if (!pointInPolygon(hole.points, probe)) probe = hole.points[0];
      var owner = null;
      positives.forEach(function (cell) {
        if (Math.abs(hole.area) >= Math.abs(cell.area)) return;
        if (!contains(cell.points, probe)) return;
        if (!owner || Math.abs(cell.area) < Math.abs(owner.area)) owner = cell;
      });
      if (owner) owner.holes.push(hole);
    });
    var faces = positives.map(function (cell, index) {
      var holeArea = cell.holes.reduce(function (sum, hole) { return sum + Math.abs(hole.area); }, 0);
      return {id:'cell:' + index, points:cell.points, holes:cell.holes.map(function (h) { return h.points; }),
        area:Math.abs(cell.area) - holeArea, signedArea:cell.area};
    });
    return {vertices:vertexList, edges:edges, faces:faces, tolerance:tolerance,
      diagnostics:[]};
  }

  function pointInRegion(region, p) {
    var inside = false;
    regionLoops(region).forEach(function (loop) {
      var points = loop.points;
      if (points.length < 3) return;
      var hit = false;
      for (var i=0,j=points.length-1;i<points.length;j=i++) {
        var a = points[i], b = points[j];
        if ((a.y > p.y) !== (b.y > p.y) &&
            p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) hit = !hit;
      }
      if (hit) inside = !inside;
    });
    return inside;
  }
  function pointInCell(cell, p) {
    if (!pointInPolygon(cell.points, p)) return false;
    return !cell.holes.some(function (hole) { return pointInPolygon(hole, p); });
  }
  function pointInPolygon(points, p) {
    var inside = false;
    for (var i=0,j=points.length-1;i<points.length;j=i++) {
      var a = points[i], b = points[j];
      if ((a.y > p.y) !== (b.y > p.y) &&
          p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function cellRepresentative(cell, tolerance) {
    var centroid = {x:0, y:0};
    cell.points.forEach(function (p) { centroid.x += p.x; centroid.y += p.y; });
    centroid.x /= cell.points.length;
    centroid.y /= cell.points.length;
    if (pointInCell(cell, centroid)) return centroid;
    var epsilon = tolerance * 16;
    for (var i=0;i<cell.points.length;i++) {
      var a = cell.points[i], b = cell.points[(i+1)%cell.points.length];
      var dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      if (len <= EPS) continue;
      var p = {x:0.5*(a.x+b.x) - dy/len*epsilon,
        y:0.5*(a.y+b.y) + dx/len*epsilon};
      if (pointInCell(cell, p)) return p;
    }
    return null;
  }
  function booleanTerms(operation) {
    if (operation === 'union') return function (a, b) { return a || b; };
    if (operation === 'intersect') return function (a, b) { return a && b; };
    if (operation === 'difference') return function (a, b) { return a && !b; };
    if (operation === 'xor') return function (a, b) { return a !== b; };
    throw new Error('planar: unknown operation ' + operation);
  }
  function directedBoundary(cells, tolerance) {
    var map = Object.create(null);
    function add(a, b) {
      var k = pointKey(a) + '|' + pointKey(b);
      var reverse = pointKey(b) + '|' + pointKey(a);
      if (map[reverse]) { delete map[reverse]; return; }
      map[k] = {from:a, to:b};
    }
    cells.forEach(function (cell) {
      addCell(cell.points, add);


      cell.holes.forEach(function (hole) { addCell(hole, add); });
    });
    function addCell(points, addEdge) {
      for (var i=0;i<points.length;i++) addEdge(points[i], points[(i+1)%points.length]);
    }
    var edges = Object.keys(map).map(function (k) { return map[k]; });
    var outgoing = Object.create(null);
    edges.forEach(function (edge, i) {
      var k = pointKey(edge.from);
      (outgoing[k] || (outgoing[k] = [])).push(i);
    });
    var used = Object.create(null), loops = [];
    edges.forEach(function (edge, start) {
      if (used[start]) return;
      var points = [], current = start, guard = 0;
      while (!used[current] && guard++ <= edges.length + 1) {
        used[current] = true;
        points.push(edges[current].from);
        if (pointKey(edges[current].to) === pointKey(edges[start].from)) break;
        var candidates = outgoing[pointKey(edges[current].to)] || [];
        if (!candidates.length) break;
        var next = null;
        if (candidates.length === 1) next = candidates[0];
        else {
          var incoming = Math.atan2(edges[current].to.y - edges[current].from.y,
            edges[current].to.x - edges[current].from.x);
          var best = Infinity;
          candidates.forEach(function (candidate) {
            if (used[candidate]) return;
            var dx = edges[candidate].to.x - edges[candidate].from.x;
            var dy = edges[candidate].to.y - edges[candidate].from.y;
            var turn = ((incoming - Math.atan2(dy, dx)) % TAU + TAU) % TAU;
            if (turn < best) { best = turn; next = candidate; }
          });
        }
        if (next === null || next === start) break;
        current = next;
      }
      if (points.length >= 3) {
        var area = 0;
        for (var i=0;i<points.length;i++) {
          var a = points[i], b = points[(i+1)%points.length];
          area += a.x*b.y - b.x*a.y;
        }
        loops.push({points:points, area:area/2});
      }
    });
    return loops;
  }
  function booleanRegion(regionA, regionB, operation) {
    var arrangement = buildArrangement([regionA, regionB]);
    var term = booleanTerms(operation);
    var cells = arrangement.faces.map(function (cell) {
      var representative = cellRepresentative(cell, arrangement.tolerance);
      if (!representative) return null;
      var inA = pointInRegion(regionA, representative);
      var inB = regionB ? pointInRegion(regionB, representative) : false;
      var selected = term(inA, inB);
      return {points:cell.points, holes:cell.holes, area:cell.area,
        representative:representative, insideA:inA, insideB:inB, selected:selected};
    }).filter(Boolean);
    var selected = cells.filter(function (cell) { return cell.selected; });
    var loops = directedBoundary(selected, arrangement.tolerance);
    var area = selected.reduce(function (sum, cell) { return sum + cell.area; }, 0);
    return {contract:'educad-planar-v1', operation:operation,
      ok:arrangement.diagnostics.length === 0,
      loops:loops.map(function (loop) { return {points:loop.points,
        role:loop.area < 0 ? 'inner' : 'outer', area:loop.area}; }),
      cells:cells, area:area, tolerance:arrangement.tolerance,
      diagnostics:arrangement.diagnostics.slice()};
  }
  function arrangement(region) {
    return buildArrangement([region]);
  }

  return {
    contract:'educad-planar-v1',
    point:point,
    regionLoops:regionLoops,
    arrangement:arrangement,
    booleanRegion:booleanRegion,
    pointInRegion:pointInRegion,
    tolerance:function (regions) { return toleranceFor(allSegments(regions)); }
  };
});

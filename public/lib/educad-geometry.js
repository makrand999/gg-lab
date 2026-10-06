(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADGeometry = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Entity angles are degrees CCW in world coordinates. Screen tolerance is
  // converted at the boundary; geometry and coverage stay in millimeters.
  var RAD = Math.PI / 180, EPS = 1e-9, INTERVAL_EPS = 32 * Number.EPSILON;
  function degrees(a) { return ((a % 360) + 360) % 360; }
  function arcSweep(start, end) { return degrees(degrees(end) - degrees(start)); }
  function angleOnArc(angle, start, end) { return degrees(angle - start) <= arcSweep(start, end) + EPS; }
  function spanDistance(p, a, b, type) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    var t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
    if (type !== 'LINE') t = Math.max(0, t);
    if (type !== 'LINE' && type !== 'RAY') t = Math.min(1, t);
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function roundDistance(p, e) {
    var dx = p.x - e.x, dy = p.y - e.y, radius = Math.hypot(dx, dy);
    if (e.type === 'CIRCLE') return Math.abs(radius - e.radius);
    if (!Number.isFinite(e.startAngle) || !Number.isFinite(e.endAngle) || !arcSweep(e.startAngle, e.endAngle)) return Infinity;
    var angle = Math.atan2(dy, dx) / RAD;
    if (angleOnArc(angle, e.startAngle, e.endAngle)) return Math.abs(radius - e.radius);
    return Math.min.apply(null, [e.startAngle, e.endAngle].map(function (a) {
      return Math.hypot(dx - e.radius * Math.cos(a * RAD), dy - e.radius * Math.sin(a * RAD));
    }));
  }
  // Exact intervals where a query segment lies inside a segment's tolerance
  // capsule (rectangle plus endpoint disks). Union these instead of sampling.
  function capsuleIntervals(a, b, c, d, tolerance) {
    var out = [], vx = b.x - a.x, vy = b.y - a.y, q2 = vx * vx + vy * vy;
    function disk(p) {
      var x = a.x - p.x, y = a.y - p.y;
      if (!q2) { if (Math.hypot(x, y) <= tolerance) out.push([0, 1]); return; }
      var dot = x * vx + y * vy, cross = x * vy - y * vx;
      var slack = tolerance * tolerance - cross * cross / q2;
      if (slack < 0) return;
      var mid = -dot / q2, half = Math.sqrt(Math.max(0, slack) / q2);
      var lo = Math.max(0, mid - half), hi = Math.min(1, mid + half);
      if (hi >= lo) out.push([lo, hi]);
    }
    disk(c); disk(d);
    var dx = d.x - c.x, dy = d.y - c.y, length = Math.hypot(dx, dy);
    if (!length) return out;
    var interval = [0, 1];
    function clip(value, delta, lo, hi) {
      if (delta === 0) return value >= lo && value <= hi;
      var x = (lo - value) / delta, y = (hi - value) / delta;
      interval[0] = Math.max(interval[0], Math.min(x, y));
      interval[1] = Math.min(interval[1], Math.max(x, y));
      return interval[0] <= interval[1];
    }
    var ux = dx / length, uy = dy / length, x = a.x - c.x, y = a.y - c.y;
    if (clip(x * ux + y * uy, vx * ux + vy * uy, 0, length) &&
        clip(-x * uy + y * ux, -vx * uy + vy * ux, -tolerance, tolerance)) out.push(interval);
    return out;
  }
  function segmentCovered(a, b, segments, tolerance, points) {
    if (!Number.isFinite(tolerance) || tolerance < 0) return false;
    var intervals = [];
    segments.forEach(function (s) { intervals = intervals.concat(capsuleIntervals(a, b, s.a, s.b, Math.max(0, tolerance - (s.error || 0)))); });
    (points || []).forEach(function (p) { intervals = intervals.concat(capsuleIntervals(a, b, p, p, tolerance)); });
    intervals.sort(function (x, y) { return x[0] - y[0]; });
    var end = 0;
    for (var i = 0; i < intervals.length; i++) {
      if (intervals[i][0] > end + INTERVAL_EPS) return false;
      end = Math.max(end, intervals[i][1]);
      if (end >= 1 - INTERVAL_EPS) return true;
    }
    return false;
  }
  // Chord error, rather than a fixed count, controls curved coverage.
  function roundSegments(e, error) {
    var sweep = e.type === 'CIRCLE' ? 360 : arcSweep(e.startAngle, e.endAngle);
    if (!(e.radius > 0) || !sweep) return [];
    var angle = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - error / e.radius)));
    var count = Math.max(1, Math.ceil(sweep * RAD / Math.max(angle, 1e-9)));
    if (count > 32768) return null; // Never certify coverage beyond the error budget.
    var out = [], start = e.type === 'CIRCLE' ? 0 : e.startAngle;
    function at(i) { var a = (start + sweep * i / count) * RAD; return { x: e.x + e.radius * Math.cos(a), y: e.y + e.radius * Math.sin(a) }; }
    var a = at(0);
    for (var i = 1; i <= count; i++) { var b = at(i); out.push({ a: a, b: b }); a = b; }
    return out;
  }
  return { RAD: RAD, degrees: degrees, arcSweep: arcSweep, angleOnArc: angleOnArc,
    spanDistance: spanDistance, roundDistance: roundDistance,
    capsuleIntervals: capsuleIntervals, segmentCovered: segmentCovered, roundSegments: roundSegments };
});

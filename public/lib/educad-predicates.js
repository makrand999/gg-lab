(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADPredicates = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Exact geometric predicates for kernel decisions. A floating-point filter
  // answers the easy cases; near-degenerate inputs fall back to exact decimal
  // rationals (the stored JSON numbers are the input, not an approximation).
  // The exact path is intentionally small: orientation, coplanarity and
  // point-on-plane.
  var EPS = Number.EPSILON;
  var FILTER = 32 * EPS;

  function point(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))
      throw new Error('predicates: point needs finite x, y, z');
    return {x:p.x, y:p.y, z:p.z};
  }
  function point2(p) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y))
      throw new Error('predicates: point needs finite x, y');
    return {x:p.x, y:p.y};
  }
  function plane(origin, normal) {
    if (!origin || !normal) throw new Error('predicates: plane needs an origin and normal');
    return {origin:point(origin), normal:point(normal)};
  }
  function sign(value) {
    return value > 0 ? 1 : value < 0 ? -1 : 0;
  }

  function gcd(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }
  // Exact decimal value of a finite double, as a reduced fraction. This is
  // exact with respect to the number the program stored and serialized.
  function fraction(value) {
    if (!Number.isFinite(value)) throw new Error('predicates: non-finite number');
    var s = String(value);
    var match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i.exec(s);
    if (!match) throw new Error('predicates: unsupported number ' + s);
    var negative = match[1] === '-';
    var digits = match[2] + (match[3] || '');
    var exponent = (match[4] ? parseInt(match[4], 10) : 0) - (match[3] || '').length;
    var numerator = BigInt(digits);
    if (negative) numerator = -numerator;
    var denominator = 1n;
    if (exponent >= 0) numerator *= 10n ** BigInt(exponent);
    else denominator = 10n ** BigInt(-exponent);
    var common = gcd(numerator, denominator);
    if (common > 1n) { numerator /= common; denominator /= common; }
    return {n:numerator, d:denominator};
  }
  function subFraction(a, b) {
    return {n:a.n * b.d - b.n * a.d, d:a.d * b.d};
  }
  function mulFraction(a, b) {
    return {n:a.n * b.n, d:a.d * b.d};
  }
  function addFraction(a, b) {
    return {n:a.n * b.d + b.n * a.d, d:a.d * b.d};
  }
  function subFraction3(a, b) {
    return {x:subFraction(a.x, b.x), y:subFraction(a.y, b.y), z:subFraction(a.z, b.z)};
  }
  function exactPoint(p) {
    return {x:fraction(p.x), y:fraction(p.y), z:fraction(p.z)};
  }

  function orient2dFloat(a, b, c) {
    var acx = a.x - c.x, bcx = b.x - c.x;
    var acy = a.y - c.y, bcy = b.y - c.y;
    return {det:acx * bcy - acy * bcx,
      bound:FILTER * (Math.abs(acx * bcy) + Math.abs(acy * bcx))};
  }
  function orient2d(a, b, c) {
    a = point2(a); b = point2(b); c = point2(c);
    var f = orient2dFloat(a, b, c);
    if (Math.abs(f.det) > f.bound)
      return {sign:sign(f.det), determinant:f.det, guarantee:'numeric-filter'};
    var fx = exactPoint(a), fy = exactPoint(b), fz = exactPoint(c);
    var acx = subFraction(fx.x, fz.x), acy = subFraction(fx.y, fz.y);
    var bcx = subFraction(fy.x, fz.x), bcy = subFraction(fy.y, fz.y);
    var det = subFraction(mulFraction(acx, bcy), mulFraction(acy, bcx));
    return {sign:sign(det.n), determinant:f.det, guarantee:'exact-decimal'};
  }

  function orient3dFloat(a, b, c, d) {
    var ax = a.x - d.x, ay = a.y - d.y, az = a.z - d.z;
    var bx = b.x - d.x, by = b.y - d.y, bz = b.z - d.z;
    var cx = c.x - d.x, cy = c.y - d.y, cz = c.z - d.z;
    var det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    var bound = FILTER * (Math.abs(ax * (by * cz - bz * cy)) +
      Math.abs(ay * (bx * cz - bz * cx)) + Math.abs(az * (bx * cy - by * cx)));
    return {det:det, bound:bound};
  }
  function orient3d(a, b, c, d) {
    a = point(a); b = point(b); c = point(c); d = point(d);
    var f = orient3dFloat(a, b, c, d);
    if (Math.abs(f.det) > f.bound)
      return {sign:sign(f.det), determinant:f.det, guarantee:'numeric-filter'};
    var fa = exactPoint(a), fb = exactPoint(b), fc = exactPoint(c), fd = exactPoint(d);
    var ux = subFraction(fa.x, fd.x), uy = subFraction(fa.y, fd.y), uz = subFraction(fa.z, fd.z);
    var vx = subFraction(fb.x, fd.x), vy = subFraction(fb.y, fd.y), vz = subFraction(fb.z, fd.z);
    var wx = subFraction(fc.x, fd.x), wy = subFraction(fc.y, fd.y), wz = subFraction(fc.z, fd.z);
    var vwz = subFraction(mulFraction(vy, wz), mulFraction(vz, wy));
    var vwx = subFraction(mulFraction(vx, wz), mulFraction(vz, wx));
    var vwy = subFraction(mulFraction(vx, wy), mulFraction(vy, wx));
    var det = addFraction(subFraction(mulFraction(ux, vwz), mulFraction(uy, vwx)),
      mulFraction(uz, vwy));
    return {sign:sign(det.n), determinant:f.det, guarantee:'exact-decimal'};
  }

  function coplanar(a, b, c, d) {
    var result = orient3d(a, b, c, d);
    return {coplanar:result.sign === 0, sign:result.sign,
      determinant:result.determinant, guarantee:result.guarantee};
  }

  function pointOnPlane(p, support) {
    p = point(p);
    support = support || {};
    var origin = point(support.origin), normal = point(support.normal);
    var dx = p.x - origin.x, dy = p.y - origin.y, dz = p.z - origin.z;
    var residual = dx * normal.x + dy * normal.y + dz * normal.z;
    var bound = FILTER * (Math.abs(dx * normal.x) + Math.abs(dy * normal.y) +
      Math.abs(dz * normal.z));
    if (Math.abs(residual) > bound)
      return {onPlane:false, residual:residual, guarantee:'numeric-filter'};
    var fp = exactPoint(p), fo = exactPoint(origin), fn = exactPoint(normal);
    var ex = subFraction(fp.x, fo.x), ey = subFraction(fp.y, fo.y), ez = subFraction(fp.z, fo.z);
    var exact = addFraction(addFraction(mulFraction(ex, fn.x), mulFraction(ey, fn.y)),
      mulFraction(ez, fn.z));
    return {onPlane:exact.n === 0n, residual:residual, guarantee:'exact-decimal'};
  }

  return {
    contract:'edu-predicates-v1',
    orient2d:orient2d,
    orient3d:orient3d,
    coplanar:coplanar,
    pointOnPlane:pointOnPlane,
    point:point,
    plane:plane,
    fraction:fraction
  };
});

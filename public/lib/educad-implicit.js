(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADImplicit = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var CONTRACT = 'implicit-surface-v1';
  var INTERSECTION_CONTRACT = 'implicit-intersection-v1';
  var VERSION = '1.0.0';
  var TAU = 2 * Math.PI;
  var EPS = 1e-9;
  var MAX_DEGREE = 12;
  var BINOMIAL = (function () {
    var table = [];
    for (var n = 0; n <= MAX_DEGREE; n++) {
      table[n] = [];
      for (var k = 0; k <= n; k++)
        table[n][k] = k === 0 || k === n ? 1 : table[n - 1][k - 1] + table[n - 1][k];
    }
    return table;
  })();

  function num(v) { return typeof v === 'number' && Number.isFinite(v); }
  function vec(x, y, z) { return {x:x, y:y, z:z}; }
  function point(p) {
    return p && num(p.x) && num(p.y) && num(p.z) ? {x:p.x, y:p.y, z:p.z} : null;
  }
  function vadd(a, b) { return vec(a.x + b.x, a.y + b.y, a.z + b.z); }
  function vsub(a, b) { return vec(a.x - b.x, a.y - b.y, a.z - b.z); }
  function vmul(a, s) { return vec(a.x * s, a.y * s, a.z * s); }
  function vdot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function vcross(a, b) {
    return vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  function vlen(a) { return Math.hypot(a.x, a.y, a.z); }
  function vunit(a) {
    var l = vlen(a);
    return l > EPS ? {x:a.x / l, y:a.y / l, z:a.z / l} : null;
  }
  function basis(n) {
    var ref = Math.abs(n.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0);
    var u = vunit(vcross(n, ref));
    return u ? {u:u, v:vunit(vcross(n, u))} : null;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function wrapAngle(a) { return ((a % TAU) + TAU) % TAU; }
  function uniqueStrings(list) {
    var out = [];
    (list || []).forEach(function (v) {
      if (v !== undefined && v !== null && out.indexOf(v) === -1) out.push(v);
    });
    return out;
  }
  function makeFrame(origin, w, uHint, vHint) {
    var axis = vunit(w || vec(0, 0, 0));
    if (!axis || !point(origin)) return null;
    var u = null;
    [uHint, vHint].forEach(function (candidate) {
      if (u) return;
      if (!candidate || !point(candidate)) return;
      var projected = vsub(candidate, vmul(axis, vdot(candidate, axis)));
      if (vlen(projected) > 1e-7) u = vunit(projected);
    });
    if (!u) {
      var b = basis(axis);
      if (!b) return null;
      u = b.u;
    }
    var v = vunit(vcross(axis, u));
    return v ? {origin:point(origin), u:u, v:v, w:axis} : null;
  }
  function frameValid(frame) {
    if (!frame || !point(frame.origin) || !point(frame.u) || !point(frame.v) || !point(frame.w))
      return false;
    var u = frame.u, v = frame.v, w = frame.w;
    return Math.abs(vlen(u) - 1) <= 1e-7 && Math.abs(vlen(v) - 1) <= 1e-7 &&
      Math.abs(vlen(w) - 1) <= 1e-7 && Math.abs(vdot(u, v)) <= 1e-7 &&
      Math.abs(vdot(u, w)) <= 1e-7 && Math.abs(vdot(v, w)) <= 1e-7 &&
      vdot(vcross(u, v), w) > 0.9;
  }
  function localPoint(frame, p) {
    var d = vsub(p, frame.origin);
    return {x:vdot(frame.u, d), y:vdot(frame.v, d), z:vdot(frame.w, d)};
  }
  function worldPoint(frame, local) {
    return vadd(frame.origin,
      vadd(vadd(vmul(frame.u, local.x), vmul(frame.v, local.y)), vmul(frame.w, local.z)));
  }
  function termsValid(terms) {
    if (!Array.isArray(terms) || !terms.length) return false;
    return terms.every(function (term) {
      return Array.isArray(term) && term.length === 4 && num(term[0]) &&
        term[1] >= 0 && term[2] >= 0 && term[3] >= 0 &&
        term[1] + term[2] + term[3] <= MAX_DEGREE &&
        term[1] === Math.floor(term[1]) && term[2] === Math.floor(term[2]) &&
        term[3] === Math.floor(term[3]);
    }) && terms.some(function (term) { return Math.abs(term[0]) > 0; });
  }
  function termsDegree(terms) {
    var degree = 0;
    terms.forEach(function (t) { degree = Math.max(degree, t[1] + t[2] + t[3]); });
    return degree;
  }
  function termsScale(terms, radius) {
    var r = Math.max(1, radius || 1);
    return terms.reduce(function (sum, t) {
      return sum + Math.abs(t[0]) * Math.pow(r, t[1] + t[2] + t[3]);
    }, 0);
  }
  function normalizeTerms(terms) {
    if (!termsValid(terms)) return null;
    var seen = {}, out = [];
    terms.forEach(function (t) {
      var key = t[1] + ',' + t[2] + ',' + t[3];
      if (seen[key] === undefined) { seen[key] = out.length; out.push([t[0], t[1], t[2], t[3]]); }
      else out[seen[key]][0] += t[0];
    });
    out = out.filter(function (t) { return t[0] !== 0; });
    return out.length ? out : null;
  }
  function polyEval(terms, x, y, z) {
    var value = 0, gx = 0, gy = 0, gz = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i], c = t[0], a = t[1], b = t[2], d = t[3];
      var xp = Math.pow(x, a), yp = Math.pow(y, b), zp = Math.pow(z, d);
      value += c * xp * yp * zp;
      if (a > 0) gx += c * a * Math.pow(x, a - 1) * yp * zp;
      if (b > 0) gy += c * b * xp * Math.pow(y, b - 1) * zp;
      if (d > 0) gz += c * d * xp * yp * Math.pow(z, d - 1);
    }
    return {value:value, gradient:{x:gx, y:gy, z:gz}};
  }

  var NEXT_BUFFER = new ArrayBuffer(8);
  var NEXT_FLOAT = new Float64Array(NEXT_BUFFER);
  var NEXT_INT = new BigInt64Array(NEXT_BUFFER);
  function nextUp(x) {
    if (!Number.isFinite(x)) return x;
    if (x === 0) return Number.MIN_VALUE;
    NEXT_FLOAT[0] = x;
    NEXT_INT[0] += x > 0 ? 1n : -1n;
    return NEXT_FLOAT[0];
  }
  function nextDown(x) {
    if (!Number.isFinite(x)) return x;
    return -nextUp(-x);
  }
  function ival(lo, hi) { return {lo:lo, hi:hi}; }
  function iadd(a, b) { return ival(nextDown(a.lo + b.lo), nextUp(a.hi + b.hi)); }
  function imul(a, b) {
    var values = [nextDown(a.lo * b.lo), nextDown(a.lo * b.hi),
      nextDown(a.hi * b.lo), nextDown(a.hi * b.hi)];
    var upper = [nextUp(a.lo * b.lo), nextUp(a.lo * b.hi),
      nextUp(a.hi * b.lo), nextUp(a.hi * b.hi)];
    return ival(Math.min.apply(null, values), Math.max.apply(null, upper));
  }
  function iscale(a, s) {
    var p1 = nextDown(a.lo * s), p2 = nextDown(a.hi * s);
    var q1 = nextUp(a.lo * s), q2 = nextUp(a.hi * s);
    return ival(Math.min(p1, p2), Math.max(q1, q2));
  }
  function ipow(a, n) {
    if (n === 0) return ival(1, 1);
    var out = ival(1, 1);
    for (var i = 0; i < n; i++) out = imul(out, a);
    return out;
  }
  function icontains(a, v) { return v >= a.lo && v <= a.hi; }
  function iintervalPolyEval(terms, bx, by, bz) {
    var out = ival(0, 0);
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      out = iadd(out, iscale(imul(imul(ipow(bx, t[1]), ipow(by, t[2])), ipow(bz, t[3])), t[0]));
    }
    return out;
  }
  function intervalCos(a, b) {
    if (b - a >= TAU) return ival(-1, 1);
    var ca = Math.cos(a), cb = Math.cos(b);
    var lo = Math.min(ca, cb), hi = Math.max(ca, cb);
    if (TAU * Math.ceil(a / TAU) <= b) hi = 1;
    if (Math.PI + TAU * Math.ceil((a - Math.PI) / TAU) <= b) lo = -1;
    return ival(nextDown(lo), nextUp(hi));
  }
  function intervalSin(a, b) { return intervalCos(a - Math.PI / 2, b - Math.PI / 2); }

  function polyEvalPower(coeffs, t) {
    var out = 0;
    for (var i = coeffs.length - 1; i >= 0; i--) out = out * t + coeffs[i];
    return out;
  }
  var EXACT_BITS = 20000;
  function bigAbs(a) { return a < 0n ? -a : a; }
  function bigGcd(a, b) {
    a = bigAbs(a); b = bigAbs(b);
    while (b) { var t = a % b; a = b; b = t; }
    return a;
  }
  function bigBits(a) { return bigAbs(a).toString(2).length; }
  function rat(n, d) {
    if (d === undefined) d = 1n;
    if (d < 0n) { n = -n; d = -d; }
    var g = bigGcd(n, d) || 1n;
    n = n / g; d = d / g;
    if (bigBits(n) > EXACT_BITS || bigBits(d) > EXACT_BITS)
      throw {code:'exact-budget', message:'Rational coefficient bit budget exceeded.'};
    return {n:n, d:d};
  }
  function rZero() { return {n:0n, d:1n}; }
  function rIsZero(a) { return a.n === 0n; }
  function rNeg(a) { return {n:-a.n, d:a.d}; }
  function rAdd(a, b) { return rat(a.n * b.d + b.n * a.d, a.d * b.d); }
  function rSub(a, b) { return rat(a.n * b.d - b.n * a.d, a.d * b.d); }
  function rMul(a, b) { return rat(a.n * b.n, a.d * b.d); }
  function rDiv(a, b) { return rat(a.n * b.d, a.d * b.n); }
  function rSign(a) { return a.n > 0n ? 1 : a.n < 0n ? -1 : 0; }
  function rToNumber(a) {
    var sign = a.n < 0n ? -1 : 1, n = bigAbs(a.n), d = a.d, shift = 0;
    while (n > (1n << 62n)) { n >>= 1n; shift++; }
    while (d > (1n << 62n)) { d >>= 1n; shift--; }
    return sign * (Number(n) / Number(d)) * Math.pow(2, shift);
  }
  function integerCoeffs(values) {
    var parts = [];
    for (var i = 0; i < values.length; i++) {
      var v = values[i], m, e;
      if (v === 0) { parts.push({m:0n, e:0}); continue; }
      var buffer = new ArrayBuffer(8), view = new DataView(buffer);
      view.setFloat64(0, v, false);
      var hi = view.getUint32(0, false), lo = view.getUint32(4, false);
      var sign = hi >>> 31;
      var exponent = (hi >>> 20) & 0x7ff;
      var fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
      if (exponent === 0) { m = fraction; e = -1074; }
      else { m = (1n << 52n) | fraction; e = exponent - 1023 - 52; }
      parts.push({m:sign ? -m : m, e:e});
    }
    var eMin = null;
    parts.forEach(function (p) { if (p.m !== 0n && (eMin === null || p.e < eMin)) eMin = p.e; });
    if (eMin === null) return null;
    var out = parts.map(function (p) {
      return p.m === 0n ? 0n : p.m << BigInt(p.e - eMin);
    });
    var common = 0n;
    out.forEach(function (c) { if (c !== 0n) common = bigGcd(common, c); });
    if (common > 1n) out = out.map(function (c) { return c / common; });
    return out;
  }
  function polyDegree(p) {
    for (var i = p.length - 1; i >= 0; i--) if (!rIsZero(p[i])) return i;
    return -1;
  }
  function polyTrim(p) {
    var n = polyDegree(p);
    return n < 0 ? [rZero()] : p.slice(0, n + 1);
  }
  function polyDeriv(p) {
    var out = [];
    for (var i = 1; i < p.length; i++) out.push(rMul(p[i], rat(BigInt(i), 1n)));
    return out.length ? polyTrim(out) : [rZero()];
  }
  function polyEvalRat(p, x) {
    var out = rZero();
    for (var i = p.length - 1; i >= 0; i--) out = rAdd(rMul(out, x), p[i]);
    return out;
  }
  function polyDivRem(a, b) {
    var A = polyTrim(a.slice()), B = polyTrim(b.slice());
    if (polyDegree(B) < 0) throw {code:'exact-divide', message:'Division by the zero polynomial.'};
    var q = [];
    var db = polyDegree(B);
    for (var i = 0; i <= polyDegree(A); i++) q.push(rZero());
    var guard = 0;
    while (polyDegree(A) >= db) {
      if (guard++ > 4 * EXACT_BITS) throw {code:'exact-budget', message:'Polynomial division budget exceeded.'};
      var da = polyDegree(A), shift = da - db;
      var factor = rDiv(A[da], B[db]);
      q[shift] = rAdd(q[shift] || rZero(), factor);
      for (var j = 0; j <= db; j++) A[shift + j] = rSub(A[shift + j], rMul(factor, B[j]));
      A = polyTrim(A);
      if (polyDegree(A) === da) throw {code:'exact-divide', message:'Polynomial division did not reduce degree.'};
    }
    return {q:polyTrim(q), r:polyTrim(A)};
  }
  function polyPositiveScale(p) {
    var n = polyDegree(p);
    if (n < 0) return [rZero()];
    var lead = p[n];
    var scale = rat(bigAbs(lead.n), lead.d);
    return p.slice(0, n + 1).map(function (c) { return rDiv(c, scale); });
  }
  function polyGcd(a, b) {
    var A = polyPositiveScale(polyTrim(a.slice()));
    var B = polyPositiveScale(polyTrim(b.slice()));
    var guard = 0;
    while (polyDegree(B) >= 0) {
      if (guard++ > MAX_DEGREE + 2) throw {code:'exact-gcd', message:'Polynomial gcd did not converge.'};
      if (polyDegree(B) === 0) return [rat(1n, 1n)];
      var rem = polyDivRem(A, B).r;
      A = B;
      B = polyPositiveScale(rem);
    }
    return polyPositiveScale(A);
  }
  function sturmSequence(p) {
    var first = polyPositiveScale(polyTrim(p.slice()));
    if (polyDegree(first) < 1) return [first];
    var seq = [first, polyPositiveScale(polyDeriv(first))];
    var guard = 0;
    while (polyDegree(seq[seq.length - 1]) > 0) {
      if (guard++ > MAX_DEGREE + 2) throw {code:'exact-sturm', message:'Sturm sequence did not terminate.'};
      var rem = polyDivRem(seq[seq.length - 2], seq[seq.length - 1]).r;
      if (polyDegree(rem) < 0) break;
      rem = polyTrim(rem.map(rNeg));
      seq.push(polyPositiveScale(rem));
    }
    return seq;
  }
  function sturmVariations(seq, x) {
    var previous = 0, variations = 0;
    seq.forEach(function (p) {
      var sign = rSign(polyEvalRat(p, x));
      if (sign === 0) return;
      if (previous && sign !== previous) variations++;
      previous = sign;
    });
    return variations;
  }
  function sturmCount(seq, lo, hi) {
    return sturmVariations(seq, lo) - sturmVariations(seq, hi);
  }

  function rootBound(coeffs) {
    var normalized = normalizedDoubleCoeffs(coeffs);
    if (!normalized) return 0;
    var n = normalized.length - 1;
    if (n < 1) return 0;
    var lead = Math.abs(normalized[n]);
    if (!(lead > 0)) return 0;
    var max = 0;
    for (var i = 0; i < n; i++) max = Math.max(max, Math.abs(normalized[i]) / lead);
    return 1 + max;
  }
  function rationalMid(a, b) {
    return rat(a.n * b.d + b.n * a.d, 2n * a.d * b.d);
  }
  function ceilDiv(a, b) { return (a + b - 1n) / b; }
  function cauchyBound(integer) {
    var degree = integer.length - 1;
    while (degree > 0 && integer[degree] === 0n) degree--;
    var lead = bigAbs(integer[degree]), bound = 0n;
    for (var i = 0; i < degree; i++)
      if (integer[i] !== 0n) bound = bound > ceilDiv(bigAbs(integer[i]), lead) ?
        bound : ceilDiv(bigAbs(integer[i]), lead);
    return 1n + bound;
  }
  function normalizedDoubleCoeffs(coeffs) {
    var n = coeffs.length - 1;
    while (n > 0 && Math.abs(coeffs[n]) === 0) n--;
    var c = coeffs.slice(0, n + 1).map(Number);
    var scale = Math.max.apply(null, c.map(Math.abs));
    if (!(scale > 0)) return null;
    return c.map(function (v) { return v / scale; });
  }
  function exactMultiplicity(P, squareFree, interval) {
    var multiplicity = 1;
    var current = polyPositiveScale(polyGcd(P, polyDeriv(P)));
    var guard = 0;
    while (polyDegree(current) >= 1) {
      if (guard++ > MAX_DEGREE) throw {code:'exact-multiplicity', message:'Multiplicity chain exceeded degree.'};
      var currentGcd = polyGcd(current, polyDeriv(current));
      var square = polyDegree(currentGcd) >= 1 ?
        polyTrim(polyDivRem(current, currentGcd).q) : polyPositiveScale(current);
      if (polyDegree(square) < 1) break;
      var count = sturmCount(sturmSequence(square), interval.lo, interval.hi);
      if (count <= 0) break;
      multiplicity++;
      current = currentGcd;
    }
    return multiplicity;
  }
  function rationalFromNumber(value) {
    if (!Number.isFinite(value)) throw {code:'invalid-range', message:'Range bounds must be finite.'};
    if (value === 0) return rat(0n, 1n);
    var buffer = new ArrayBuffer(8), view = new DataView(buffer);
    view.setFloat64(0, value, false);
    var hi = view.getUint32(0, false), lo = view.getUint32(4, false);
    var sign = hi >>> 31;
    var exponent = (hi >>> 20) & 0x7ff;
    var fraction = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    var m, e;
    if (exponent === 0) { m = fraction; e = -1074; }
    else { m = (1n << 52n) | fraction; e = exponent - 1023 - 52; }
    if (sign) m = -m;
    if (e >= 0) return rat(m << BigInt(e), 1n);
    return rat(m, 1n << BigInt(-e));
  }
  function rationalCompare(a, b) {
    var left = a.n * b.d, right = b.n * a.d;
    return left < right ? -1 : left > right ? 1 : 0;
  }
  function rationalBetween(a, b, bits) {
    var step = rat(b.n * a.d - a.n * b.d, a.d * b.d * (1n << BigInt(bits)));
    return rAdd(a, step);
  }
  function exactMultiplicityAt(P, x) {
    var multiplicity = 1, derivative = polyDeriv(P);
    while (polyDegree(derivative) >= 1 && rIsZero(polyEvalRat(derivative, x))) {
      if (multiplicity > MAX_DEGREE) break;
      multiplicity++;
      derivative = polyDeriv(derivative);
    }
    return multiplicity;
  }
  function exactIsolate(coeffs, options) {
    options = options || {};
    if (!Array.isArray(coeffs) || !coeffs.length ||
        !coeffs.every(function (v) { return Number.isFinite(v); }))
      return {roots:[], unresolved:true, reason:'invalid-coefficients', method:'sturm-exact'};
    if (coeffs.length - 1 > MAX_DEGREE)
      return {roots:[], unresolved:true, reason:'degree-exceeds-budget', method:'sturm-exact'};
    var integer;
    try { integer = integerCoeffs(coeffs); }
    catch (err) { return {roots:[], unresolved:true, reason:'coefficient-conversion', method:'sturm-exact'}; }
    if (!integer) return {roots:[], unresolved:false, count:0, method:'sturm-exact'};
    var P = polyTrim(integer.map(function (c) { return rat(c, 1n); }));
    var degree = polyDegree(P);
    if (degree < 1) return {roots:[], unresolved:false, count:0, degree:degree, method:'sturm-exact'};
    var confirmed = [], regions = [], endpointRoots = [];
    try {
      var gcd = polyGcd(P, polyDeriv(P));
      var squareFree = polyDegree(gcd) >= 1 ?
        polyTrim(polyDivRem(P, gcd).q) : polyPositiveScale(P);
      var sequence = sturmSequence(squareFree);
      var bound = cauchyBound(integer);
      var LO = rat(-bound, 1n), HI = rat(bound, 1n);
      var rangeGiven = false;
      if (options.range) {
        var rangeLo = options.range[0], rangeHi = options.range[1];
        if (!Number.isFinite(rangeLo) || !Number.isFinite(rangeHi) || rangeHi < rangeLo)
          return {roots:[], unresolved:true, reason:'invalid-range', method:'sturm-exact'};
        var rlo = rationalFromNumber(rangeLo), rhi = rationalFromNumber(rangeHi);
        if (rationalCompare(LO, rlo) < 0) LO = rlo;
        if (rationalCompare(HI, rhi) > 0) HI = rhi;
        rangeGiven = true;
      }
      if (rationalCompare(LO, HI) > 0)
        return {roots:[], unresolved:false, count:0, degree:degree, method:'sturm-exact-squarefree'};
      var interiorLo = LO, interiorHi = HI;
      if (rIsZero(polyEvalRat(squareFree, LO))) {
        endpointRoots.push({t:rToNumber(LO), multiplicity:exactMultiplicityAt(P, LO), endpoint:true});
        var bits = 200, guard = 0;
        do {
          interiorLo = rationalBetween(LO, HI, bits);
          if (++guard > 16) throw {code:'exact-bound', message:'Cannot shift the lower range endpoint.'};
          bits += 40;
        } while (rIsZero(polyEvalRat(squareFree, interiorLo)) && bits < 1200);
      }
      if (rIsZero(polyEvalRat(squareFree, HI))) {
        endpointRoots.push({t:rToNumber(HI), multiplicity:exactMultiplicityAt(P, HI), endpoint:true});
        var hiBits = 200, hiGuard = 0, hiStep;
        do {
          if (++hiGuard > 16) throw {code:'exact-bound', message:'Cannot shift the upper range endpoint.'};
          hiStep = rat(HI.n * LO.d - LO.n * HI.d, LO.d * HI.d * (1n << BigInt(hiBits)));
          interiorHi = rSub(HI, hiStep);
          hiBits += 40;
        } while (rIsZero(polyEvalRat(squareFree, interiorHi)) && hiBits < 1200);
      }
      if (!rangeGiven && endpointRoots.length)
        throw {code:'exact-bound', message:'Unexpected root at the Cauchy bound.'};
      var total = 0;
      if (rationalCompare(interiorLo, interiorHi) < 0)
        total = sturmCount(sequence, interiorLo, interiorHi);
      if (total < 0 || total > degree)
        return {roots:[], unresolved:true, reason:'sturm-count-inconsistent', total:total,
          degree:degree, method:'sturm-exact'};
      var stack = [{lo:interiorLo, hi:interiorHi, count:total, depth:0}];
      var nodes = 0, maxNodes = options.maxNodes || 8192;
      while (stack.length) {
        if (++nodes > maxNodes) {
          regions = stack.map(function (node) {
            return {lo:rToNumber(node.lo), hi:rToNumber(node.hi), count:node.count};
          });
          break;
        }
        var node = stack.pop();
        if (node.count === 0) continue;
        var mid = rationalMid(node.lo, node.hi);
        var nudge = 0;
        while (rIsZero(polyEvalRat(squareFree, mid))) {
          if (++nudge > 512) throw {code:'exact-root-endpoint', message:'Cannot avoid a rational root endpoint.'};
          mid = rationalMid(node.lo, mid);
        }
        if (node.count === 1) {
          var tight = {lo:node.lo, hi:node.hi};
          var target = 1e-13 * Math.max(1, Math.abs(rToNumber(mid)));
          for (var refine = 0; refine < 220; refine++) {
            if (rToNumber(rSub(tight.hi, tight.lo)) <= target) break;
            var cut = rationalMid(tight.lo, tight.hi);
            while (rIsZero(polyEvalRat(squareFree, cut))) cut = rationalMid(tight.lo, cut);
            var leftOne = sturmCount(sequence, tight.lo, cut);
            tight = leftOne === 1 ? {lo:tight.lo, hi:cut} : {lo:cut, hi:tight.hi};
          }
          var center = rationalMid(tight.lo, tight.hi);
          confirmed.push({t:rToNumber(center),
            interval:{lo:rToNumber(tight.lo), hi:rToNumber(tight.hi)},
            multiplicity:exactMultiplicity(P, squareFree, tight), exactInterval:true});
          continue;
        }
        var leftCount = sturmCount(sequence, node.lo, mid);
        var rightCount = sturmCount(sequence, mid, node.hi);
        if (leftCount + rightCount !== node.count)
          throw {code:'exact-split', message:'Sturm counts do not partition the interval.'};
        if (node.depth > 420) {
          regions.push({lo:rToNumber(node.lo), hi:rToNumber(node.hi), count:node.count});
          continue;
        }
        if (rightCount > 0) stack.push({lo:mid, hi:node.hi, count:rightCount, depth:node.depth + 1});
        if (leftCount > 0) stack.push({lo:node.lo, hi:mid, count:leftCount, depth:node.depth + 1});
      }
    } catch (err) {
      return {roots:confirmed.sort(function (a, b) { return a.t - b.t; }),
        unresolved:true, reason:err.code || 'exact-failure', method:'sturm-exact-partial',
        regions:regions, partial:true};
    }
    var roots = confirmed.concat(endpointRoots);
    roots.sort(function (a, b) { return a.t - b.t; });
    var expected = total + endpointRoots.length;
    if (roots.length > degree)
      return {roots:roots, unresolved:true, reason:'root-count-exceeds-degree', degree:degree,
        method:'sturm-exact-squarefree', regions:regions};
    return {roots:roots, unresolved:regions.length > 0, count:expected,
      regions:regions, degree:degree, method:'sturm-exact-squarefree',
      coefficientScale:Math.max.apply(null, integer.map(function (c) {
        return Number(bigAbs(c));
      }))};
  }
  function isolateRoots(coeffs, lo, hi, options) {
    options = Object.assign({}, options || {});
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo)
      return {roots:[], degree:0, method:'sturm-exact-squarefree', unresolved:true,
        reason:'invalid-range', unresolvedRegions:[], nearMisses:[]};
    options.range = [lo, hi];
    var result = exactIsolate(coeffs, options);
    var normalized = normalizedDoubleCoeffs(coeffs);
    var roots = result.roots.map(function (root) {
      return {t:root.t, residual:normalized ? Math.abs(polyEvalPower(normalized, root.t)) : null,
        multiplicity:root.multiplicity || 1, bracket:root.interval || null,
        certain:!result.unresolved, endpoint:!!root.endpoint, method:'sturm-exact-squarefree'};
    }).sort(function (a, b) { return a.t - b.t; });
    return {roots:roots, count:result.count === undefined ? roots.length : result.count,
      degree:normalized ? normalized.length - 1 : 0,
      method:'sturm-exact-squarefree', unresolved:!!result.unresolved,
      unresolvedRegions:result.regions || [], reason:result.reason || null,
      nearMisses:[], tolerance:Number.EPSILON};
  }

  function identityOf(surface, options) {
    options = options || {};
    var inferred = surface.inferred === true || options.inferred === true;
    return {kind:surface.kind, surfaceId:surface.id === undefined ? null : surface.id,
      status:inferred ? 'inferred' : 'declared', declared:!inferred,
      sourceIds:(surface.sourceIds || []).slice(), labels:(surface.labels || []).slice()};
  }
  function inequality(terms, op, label) {
    return {kind:'inequality', terms:terms, op:op, label:label || null};
  }
  function axialInterval(surface, options) {
    options = options || {};
    var axial = options.axial || surface.axialExtent || surface.axial ||
      surface.domain && (surface.domain.s || surface.domain.axial);
    if (Array.isArray(axial) && axial.length === 2 && num(axial[0]) && num(axial[1]) &&
        axial[1] >= axial[0]) return [axial[0], axial[1]];
    return null;
  }
  function angularInterval(surface) {
    var angular = surface.domain && surface.domain.u;
    if (Array.isArray(angular) && angular.length === 2 && num(angular[0]) && num(angular[1]) &&
        angular[1] > angular[0]) return [angular[0], angular[1]];
    return null;
  }
  function equationOf(surface, options) {
    options = options || {};
    if (!surface || typeof surface !== 'object') return null;
    if (surface.kind === 'implicit' || surface.kind === 'polynomial')
      return normalizeEquation(surface.implicit || surface, options);
    var identity = identityOf(surface, options);
    var frame = null, terms = null, constraints = [], localBounds = null;
    var extra = {};
    if (surface.kind === 'plane') {
      var origin = point(surface.origin), normal = point(surface.normal);
      if (!origin || !normal) return null;
      frame = makeFrame(origin, normal, surface.u, surface.v);
      if (!frame) return null;
      terms = [[1, 0, 0, 1]];
      extra.paramChart = {kind:'plane'};
    } else if (surface.kind === 'sphere') {
      if (!point(surface.center) || !(surface.radius > 0)) return null;
      frame = makeFrame(surface.center, vec(0, 0, 1), vec(1, 0, 0), vec(0, 1, 0));
      if (!frame) return null;
      var sr = surface.radius;
      terms = [[1, 2, 0, 0], [1, 0, 2, 0], [1, 0, 0, 2], [-sr * sr, 0, 0, 0]];
      extra.paramChart = {kind:'sphere', radius:sr};
      localBounds = {lo:vec(-sr, -sr, -sr), hi:vec(sr, sr, sr)};
    } else if (surface.kind === 'cylinder') {
      if (!point(surface.origin) || !point(surface.axis) || !(surface.radius > 0)) return null;
      frame = makeFrame(surface.origin, surface.axis, surface.u, surface.v);
      if (!frame) return null;
      var cr = surface.radius;
      terms = [[1, 2, 0, 0], [1, 0, 2, 0], [-cr * cr, 0, 0, 0]];
      extra.paramChart = {kind:'cylinder', radius:cr};
      var cylinderAxial = axialInterval(surface, options);
      if (cylinderAxial) {
        constraints.push(inequality([[1, 0, 0, 1], [-cylinderAxial[0], 0, 0, 0]], '>=', 'axial-min'));
        constraints.push(inequality([[1, 0, 0, 1], [-cylinderAxial[1], 0, 0, 0]], '<=', 'axial-max'));
        localBounds = {lo:vec(-cr, -cr, cylinderAxial[0]), hi:vec(cr, cr, cylinderAxial[1])};
      }
      var cylinderAngular = angularInterval(surface);
      if (cylinderAngular)
        constraints.push({kind:'parameter', family:'cylinder', u:cylinderAngular.slice(), label:'angular'});
    } else if (surface.kind === 'torus') {
      var center = point(surface.center || surface.origin);
      if (!center || !point(surface.axis)) return null;
      frame = makeFrame(center, surface.axis, surface.u, surface.v);
      if (!frame) return null;
      var R = surface.majorRadius, r = surface.minorRadius !== undefined ? surface.minorRadius : surface.radius;
      if (!(R > 0) || !(r > 0)) return null;
      var q = R * R - r * r;
      terms = [[1, 4, 0, 0], [1, 0, 4, 0], [1, 0, 0, 4],
        [2, 2, 2, 0], [2, 2, 0, 2], [2, 0, 2, 2],
        [-2 * (R * R + r * r), 2, 0, 0], [-2 * (R * R + r * r), 0, 2, 0],
        [2 * q, 0, 0, 2], [q * q, 0, 0, 0]];
      localBounds = {lo:vec(-R - r, -R - r, -r), hi:vec(R + r, R + r, r)};
      extra.majorRadius = R; extra.minorRadius = r;
      extra.paramChart = {kind:'torus', majorRadius:R, minorRadius:r};
      if (surface.domain && Array.isArray(surface.domain.u) && Array.isArray(surface.domain.v))
        constraints.push({kind:'parameter', family:'torus',
          u:surface.domain.u.slice(), v:surface.domain.v.slice(), label:'torus-domain'});
    } else if (surface.kind === 'cone') {
      var cone = coneData(surface);
      if (!cone) return null;
      frame = cone.frame; terms = cone.terms;
      constraints.push(inequality([[cone.k, 0, 0, 1], [cone.r0, 0, 0, 0]], '>=', 'nappe'));
      extra.r0 = cone.r0; extra.k = cone.k; extra.apex = cone.apex;
      extra.apexStation = cone.apexStation;
      extra.paramChart = {kind:'cone', r0:cone.r0, k:cone.k};
      var coneAxial = axialInterval(surface, options);
      if (coneAxial) {
        constraints.push(inequality([[1, 0, 0, 1], [-coneAxial[0], 0, 0, 0]], '>=', 'axial-min'));
        constraints.push(inequality([[1, 0, 0, 1], [-coneAxial[1], 0, 0, 0]], '<=', 'axial-max'));
      }
      var coneAngular = angularInterval(surface);
      if (coneAngular)
        constraints.push({kind:'parameter', family:'cone', u:coneAngular.slice(), label:'angular'});
    } else return null;
    var normalized = normalizeTerms(terms);
    if (!normalized || !frameValid(frame)) return null;
    var compiled = [];
    constraints.forEach(function (c) {
      var label = c.label || c.kind;
      if (compiled.indexOf(label) === -1) compiled.push(label);
    });
    var unresolved = [];
    if (surface.loops && surface.loops.length) unresolved.push('loops');
    if (surface.booleanDomain) unresolved.push('boolean-domain');
    if (surface.approximateBoundary) unresolved.push('approximate-boundary');
    var record = {contract:CONTRACT, kind:surface.kind, frame:frame, terms:normalized,
      degree:termsDegree(normalized), constraints:constraints, identity:identity,
      compact:!!localBounds, bounds:localBounds,
      domain:{compiled:compiled, unresolved:unresolved},
      sourceEvidence:{surfaceIds:[identity.surfaceId], kinds:[surface.kind],
        sourceIds:uniqueStrings(identity.sourceIds)}};
    Object.keys(extra).forEach(function (key) { record[key] = extra[key]; });
    return record;
  }
  function coneData(surface) {
    if (!point(surface.origin) || !point(surface.axis)) return null;
    var axis = vunit(surface.axis);
    if (!axis) return null;
    var apex = point(surface.apex);
    var halfAngle = surface.halfAngle;
    if (halfAngle !== undefined && (!num(halfAngle) || halfAngle <= 0 || halfAngle >= Math.PI / 2))
      return null;
    var frame, r0, k, apexStation = null;
    if (apex) {
      var delta = vsub(apex, surface.origin);
      var h = vdot(delta, axis);
      var perpendicular = vsub(delta, vmul(axis, h));
      if (delta.x === 0 && delta.y === 0 && delta.z === 0) {
        if (!num(halfAngle)) return null;
        frame = makeFrame(surface.origin, axis, surface.u, surface.v);
        r0 = 0; k = Math.tan(halfAngle); apexStation = 0;
      } else {
        if (vlen(perpendicular) > 1e-6 * Math.max(vlen(delta), Math.abs(surface.radius) || 0))
          return null;
        if (!(surface.radius > 0) || !(Math.abs(h) > 1e-9 * Math.max(1, Math.abs(surface.radius))))
          return null;
        r0 = surface.radius;
        k = -r0 / h;
        apexStation = h;
        if (num(halfAngle) &&
            Math.abs(Math.tan(halfAngle) - Math.abs(k)) > 1e-6 * Math.max(1, Math.abs(k)))
          return null;
        frame = makeFrame(surface.origin, axis, surface.u, surface.v);
      }
    } else {
      if (!num(halfAngle) || !(surface.radius >= 0)) return null;
      frame = makeFrame(surface.origin, axis, surface.u, surface.v);
      r0 = surface.radius; k = Math.tan(halfAngle);
    }
    if (!frame || !(k !== 0) || !num(k) || !Number.isFinite(k)) return null;
    var terms = [[1, 2, 0, 0], [1, 0, 2, 0], [-k * k, 0, 0, 2],
      [-2 * r0 * k, 0, 0, 1], [-r0 * r0, 0, 0, 0]];
    return {frame:frame, terms:terms, r0:r0, k:k, apex:apex, apexStation:apexStation};
  }

  function normalizeParamChart(chart) {
    if (chart === undefined || chart === null) return null;
    if (!chart || typeof chart !== 'object') return null;
    if (chart.kind === 'plane') return {kind:'plane'};
    if (chart.kind === 'sphere' || chart.kind === 'cylinder') {
      if (!(chart.radius > 0)) return null;
      return {kind:chart.kind, radius:chart.radius};
    }
    if (chart.kind === 'cone') {
      if (!num(chart.r0) || !num(chart.k) || chart.k === 0) return null;
      return {kind:'cone', r0:chart.r0, k:chart.k};
    }
    if (chart.kind === 'torus') {
      if (!(chart.majorRadius > 0) || !(chart.minorRadius > 0)) return null;
      return {kind:'torus', majorRadius:chart.majorRadius, minorRadius:chart.minorRadius};
    }
    if (chart.kind === 'ruledConic') {
      if (!point(chart.C) || !point(chart.A) || !point(chart.B) || !point(chart.D)) return null;
      var affine = point(chart.A2) && point(chart.B2);
      if (!affine && !num(chart.k)) return null;
      var ruled = {kind:'ruledConic', C:point(chart.C), A:point(chart.A), B:point(chart.B),
        D:point(chart.D)};
      if (affine) { ruled.A2 = point(chart.A2); ruled.B2 = point(chart.B2); }
      else ruled.k = chart.k;
      if (num(chart.k)) ruled.k = chart.k;
      return ruled;
    }
    return null;
  }
  function normalizeEquation(input, options) {
    options = options || {};
    if (!input || typeof input !== 'object') return null;
    if (!frameValid(input.frame) || !termsValid(input.terms)) return null;
    var terms = normalizeTerms(input.terms);
    if (!terms) return null;
    var identity;
    if (input.identity !== undefined) {
      if (!input.identity || typeof input.identity !== 'object') return null;
      var status = input.identity.status === undefined ? 'inferred' : input.identity.status;
      if (['declared', 'inferred', 'display'].indexOf(status) === -1) return null;
      identity = {kind:input.identity.kind || 'implicit',
        surfaceId:input.identity.surfaceId === undefined ||
          input.identity.surfaceId === null ? null : String(input.identity.surfaceId),
        status:status, declared:status === 'declared',
        sourceIds:(input.identity.sourceIds || []).map(String),
        labels:(input.identity.labels || []).map(String)};
      if (!Array.isArray(input.identity.sourceIds || []) ||
          !Array.isArray(input.identity.labels || [])) return null;
    } else {
      if (input.id !== undefined && input.id !== null && typeof input.id !== 'string') return null;
      identity = {kind:'implicit', surfaceId:input.id === undefined ? null : input.id,
        status:options.inferred ? 'inferred' : 'declared', declared:!options.inferred,
        sourceIds:(input.sourceIds || []).map(String), labels:[]};
    }
    var constraints = [];
    if (input.constraints !== undefined) {
      if (!Array.isArray(input.constraints)) return null;
      for (var i = 0; i < input.constraints.length; i++) {
        var parsed = cloneConstraint(input.constraints[i]);
        if (!parsed) return null;
        constraints.push(parsed);
      }
    }
    var bounds = null;
    if (input.bounds !== undefined && input.bounds !== null) {
      if (!point(input.bounds.lo) || !point(input.bounds.hi)) return null;
      var lo = point(input.bounds.lo), hi = point(input.bounds.hi);
      if (!(hi.x >= lo.x && hi.y >= lo.y && hi.z >= lo.z)) return null;
      bounds = {lo:lo, hi:hi};
    }
    var compact = input.compact === undefined ? !!bounds : !!input.compact;
    if (compact && !bounds) return null;
    if (input.kind !== undefined && typeof input.kind !== 'string') return null;
    var paramChart = normalizeParamChart(input.paramChart);
    if (input.paramChart !== undefined && input.paramChart !== null && !paramChart) return null;
    var domain = null;
    if (input.domain !== undefined) {
      if (!input.domain || typeof input.domain !== 'object') return null;
      var compiled = input.domain.compiled === undefined ? [] : input.domain.compiled;
      var unresolvedDomain = input.domain.unresolved === undefined ? [] : input.domain.unresolved;
      if (!Array.isArray(compiled) || !Array.isArray(unresolvedDomain)) return null;
      if (compiled.some(function (v) { return typeof v !== 'string'; }) ||
          unresolvedDomain.some(function (v) { return typeof v !== 'string'; })) return null;
      domain = {compiled:compiled.slice(), unresolved:unresolvedDomain.slice()};
    }
    return {contract:CONTRACT,
      kind:input.kind === 'implicit' || input.kind === 'polynomial' ? 'implicit' : (input.kind || 'implicit'),
      frame:{origin:point(input.frame.origin), u:point(input.frame.u),
        v:point(input.frame.v), w:point(input.frame.w)},
      terms:terms, degree:termsDegree(terms), constraints:constraints, identity:identity,
      compact:compact, bounds:bounds, domain:domain, paramChart:paramChart,
      r0:num(input.r0) ? input.r0 : undefined,
      k:num(input.k) ? input.k : undefined,
      majorRadius:num(input.majorRadius) ? input.majorRadius : undefined,
      minorRadius:num(input.minorRadius) ? input.minorRadius : undefined,
      apex:point(input.apex) || undefined,
      apexStation:num(input.apexStation) ? input.apexStation : undefined,
      sourceEvidence:input.sourceEvidence && typeof input.sourceEvidence === 'object' ?
        clonePlain(input.sourceEvidence) :
        {surfaceIds:[identity.surfaceId], kinds:[identity.kind], sourceIds:uniqueStrings(identity.sourceIds)}};
  }
  function negPoly(poly) {
    var out = {};
    Object.keys(poly).forEach(function (k) { out[k] = -poly[k]; });
    return out;
  }
  function affinePoly(c0, c1, h) {
    var out = {};
    if (c0 !== 0) out['0,0,0'] = c0;
    if (c1 !== 0) out['0,0,1'] = c1 / h;
    return out;
  }
  function ruledConicAffineGeometry(spec) {
    spec = spec || {};
    var C = point(spec.C), A = point(spec.A), B = point(spec.B);
    var A2 = point(spec.A2), B2 = point(spec.B2), D = point(spec.D);
    if (!C || !A || !B || !A2 || !B2 || !D) return null;
    var n1 = vcross(A, B), n2 = vcross(A2, B2);
    var l1 = vlen(n1), l2 = vlen(n2);
    if (!(l1 > EPS) || !(l2 > EPS)) return null;
    var span = vsub(D, C);
    var localScale = Math.max(1, vlen(A), vlen(B), vlen(A2), vlen(B2), vlen(span));
    var ulp = 64 * Number.EPSILON * Math.max(1, vlen(C), vlen(D),
      vlen(A), vlen(B), vlen(A2), vlen(B2));
    var N = vunit(n1);
    if (!N || vlen(vcross(N, vmul(n2, 1 / l2))) >
        1e-7 + 64 * Number.EPSILON) return null;
    var h = vdot(N, span);
    if (!(Math.abs(h) > Math.max(1e-12 * localScale, ulp))) return null;
    if (h < 0) { N = vmul(N, -1); h = -h; }
    var U = vunit(vsub(A, vmul(N, vdot(A, N))));
    if (!U) U = vunit(vsub(B, vmul(N, vdot(B, N))));
    if (!U) return null;
    var V = vunit(vcross(N, U));
    if (!V) return null;
    var planeTolerance = Math.max(1e-7 * localScale, ulp);
    if (Math.abs(vdot(N, A2)) > planeTolerance ||
        Math.abs(vdot(N, B2)) > planeTolerance) return null;
    var a0x = vdot(A, U), a0y = vdot(A, V);
    var a1x = vdot(A2, U) - a0x, a1y = vdot(A2, V) - a0y;
    var b0x = vdot(B, U), b0y = vdot(B, V);
    var b1x = vdot(B2, U) - b0x, b1y = vdot(B2, V) - b0y;
    var det0 = a0x * b0y - a0y * b0x;
    var det1 = a1x * b0y + a0x * b1y - a1y * b0x - a0y * b1x;
    var det2 = a1x * b1y - a1y * b1x;
    var singular = [], regularityUnresolved = false, isolated = null;
    try {
      isolated = isolateRoots([det0, det1, det2], 0, 1, {});
      if (!isolated || isolated.unresolved) regularityUnresolved = true;
      else singular = isolated.roots.map(function (root) { return root.t; });
    } catch (err) { regularityUnresolved = true; }
    singular.sort(function (x, y) { return x - y; });
    return {C:C, A:A, B:B, A2:A2, B2:B2, D:D, N:N, h:h, localScale:localScale,
      frame:{origin:C, u:U, v:V, w:N}, a0:{x:a0x, y:a0y}, a1:{x:a1x, y:a1y},
      b0:{x:b0x, y:b0y}, b1:{x:b1x, y:b1y}, det:[det0, det1, det2],
      singular:singular, regularityUnresolved:regularityUnresolved};
  }
  function ruledConicAffineRecord(spec) {
    var geometry = ruledConicAffineGeometry(spec);
    if (!geometry || geometry.regularityUnresolved || geometry.singular.length) return null;
    var h = geometry.h, U = geometry.frame.u, V = geometry.frame.v, N = geometry.frame.w;
    var span = vsub(geometry.D, geometry.C);
    var dU = vdot(U, span), dV = vdot(V, span);
    var qx = {'1,0,0':1, '0,0,1':-dU / h};
    var qy = {'0,1,0':1, '0,0,1':-dV / h};
    var ax = affinePoly(geometry.a0.x, geometry.a1.x, h);
    var ay = affinePoly(geometry.a0.y, geometry.a1.y, h);
    var bx = affinePoly(geometry.b0.x, geometry.b1.x, h);
    var by = affinePoly(geometry.b0.y, geometry.b1.y, h);
    var r0 = sparseAdd(sparseMul(by, qx), sparseMul(negPoly(bx), qy));
    var r1 = sparseAdd(sparseMul(negPoly(ay), qx), sparseMul(ax, qy));
    var det = sparseAdd(sparseMul(ax, by), sparseMul(negPoly(ay), bx));
    var F = sparseAdd(sparseAdd(sparseMul(r0, r0), sparseMul(r1, r1)),
      sparseMul(negPoly(det), det));
    var terms = Object.keys(F).map(function (key) {
      var powers = key.split(',').map(Number);
      return [F[key], powers[0], powers[1], powers[2]];
    });
    var maximum = terms.reduce(function (m, t) { return Math.max(m, Math.abs(t[0])); }, 0);
    if (!(maximum > 0)) return null;
    terms = terms.map(function (t) { return [t[0] / maximum, t[1], t[2], t[3]]; });
    var lo = {x:Infinity, y:Infinity, z:Infinity};
    var hi = {x:-Infinity, y:-Infinity, z:-Infinity};
    [['x', U], ['y', V], ['z', N]].forEach(function (entry) {
      var axis = entry[1];
      var c0 = 0, c1 = vdot(span, axis);
      var r0 = Math.hypot(vdot(geometry.A, axis), vdot(geometry.B, axis));
      var r1 = Math.hypot(vdot(geometry.A2, axis), vdot(geometry.B2, axis));
      lo[entry[0]] = Math.min(c0 - r0, c1 - r1);
      hi[entry[0]] = Math.max(c0 + r0, c1 + r1);
    });
    var constraints = [
      {kind:'inequality', terms:[[1,0,0,1]], op:'>=', label:'parameter-min'},
      {kind:'inequality', terms:[[-1,0,0,1],[h,0,0,0]], op:'>=', label:'parameter-max'}];
    var ids = uniqueStrings(spec.sourceIds);
    var chart = {kind:'ruledConic', C:geometry.C, A:geometry.A, B:geometry.B,
      D:geometry.D, A2:geometry.A2, B2:geometry.B2};
    return normalizeEquation({frame:geometry.frame, terms:terms, kind:'implicit',
      constraints:constraints, bounds:{lo:lo, hi:hi}, compact:true, paramChart:chart,
      identity:{kind:'implicit', status:'inferred', sourceIds:ids},
      domain:{compiled:['parameter-range'], unresolved:[]},
      sourceEvidence:{family:'general-affine-ruled-conic', sourceIds:ids}});
  }

  function cloneConstraint(constraint) {
    if (!constraint || typeof constraint !== 'object') return null;
    if (constraint.kind === 'inequality') {
      var terms = normalizeTerms(constraint.terms);
      if (!terms || ['>=', '<=', '=='].indexOf(constraint.op) === -1) return null;
      return {kind:'inequality', terms:terms, op:constraint.op, label:constraint.label || null};
    }
    if (constraint.kind === 'parameter') {
      if (['torus', 'cylinder', 'cone'].indexOf(constraint.family) === -1) return null;
      if (!Array.isArray(constraint.u) || constraint.u.length !== 2 ||
          !num(constraint.u[0]) || !num(constraint.u[1]) ||
          !(constraint.u[1] >= constraint.u[0])) return null;
      var out = {kind:'parameter', family:constraint.family, u:constraint.u.slice()};
      if (constraint.v !== undefined) {
        if (!Array.isArray(constraint.v) || constraint.v.length !== 2 ||
            !num(constraint.v[0]) || !num(constraint.v[1]) ||
            !(constraint.v[1] >= constraint.v[0])) return null;
        out.v = constraint.v.slice();
      } else if (constraint.family === 'torus') return null;
      out.label = constraint.label || null;
      return out;
    }
    return null;
  }
  function clonePlain(value) {
    if (Array.isArray(value)) return value.map(clonePlain);
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).forEach(function (key) { out[key] = clonePlain(value[key]); });
      return out;
    }
    return value;
  }
  function cloneEquation(eq) {
    return {contract:CONTRACT, kind:eq.kind || 'implicit',
      frame:{origin:point(eq.frame.origin), u:point(eq.frame.u),
        v:point(eq.frame.v), w:point(eq.frame.w)},
      terms:normalizeTerms(eq.terms) || eq.terms.map(function (t) { return t.slice(); }),
      degree:eq.degree !== undefined ? eq.degree : termsDegree(eq.terms),
      constraints:(eq.constraints || []).map(cloneConstraint).filter(Boolean),
      identity:eq.identity && typeof eq.identity === 'object' ? clonePlain(eq.identity) : null,
      compact:!!eq.compact,
      bounds:eq.bounds && point(eq.bounds.lo) && point(eq.bounds.hi) ?
        {lo:point(eq.bounds.lo), hi:point(eq.bounds.hi)} : null,
      domain:eq.domain && typeof eq.domain === 'object' ?
        {compiled:(eq.domain.compiled || []).slice(), unresolved:(eq.domain.unresolved || []).slice()} : null,
      sourceEvidence:eq.sourceEvidence ? clonePlain(eq.sourceEvidence) : null,
      majorRadius:eq.majorRadius, minorRadius:eq.minorRadius, r0:eq.r0, k:eq.k,
      apex:point(eq.apex), paramChart:normalizeParamChart(eq.paramChart)};
  }
  function serialize(eq) {
    var out = cloneEquation(eq);
    out.guarantee = eq.identity && eq.identity.status === 'declared' ? 'declared-definition' : 'inferred-definition';
    return out;
  }
  function equationIsValid(eq) {
    return !!eq && eq.contract === CONTRACT && frameValid(eq.frame) && termsValid(eq.terms) &&
      (!eq.constraints || eq.constraints.every(function (c) { return !!cloneConstraint(c); }));
  }

  function evaluate(eq, p) {
    if (!equationIsValid(eq) || !point(p)) return null;
    var local = localPoint(eq.frame, p);
    var result = polyEval(eq.terms, local.x, local.y, local.z);
    return {value:result.value, local:local,
      gradient:vadd(vadd(vmul(eq.frame.u, result.gradient.x),
        vmul(eq.frame.v, result.gradient.y)), vmul(eq.frame.w, result.gradient.z)),
      localGradient:result.gradient};
  }
  function equationTolerance(eq, p) {
    var scale = 1;
    if (eq.bounds) {
      var hi = eq.bounds.hi, lo = eq.bounds.lo;
      scale = Math.max(1, Math.abs(hi.x), Math.abs(hi.y), Math.abs(hi.z),
        Math.abs(lo.x), Math.abs(lo.y), Math.abs(lo.z));
    } else if (p) {
      var local = localPoint(eq.frame, p);
      scale = Math.max(1, Math.abs(local.x), Math.abs(local.y), Math.abs(local.z));
    }
    return 1e-8 * Math.max(Number.MIN_VALUE, termsScale(eq.terms, scale));
  }
  function parameterOf(eq, p) {
    if (!eq || !point(p) || !frameValid(eq.frame)) return null;
    if (eq.paramChart && eq.paramChart.kind === 'ruledConic') {
      var chart = eq.paramChart, span = vsub(chart.D, chart.C);
      var normal = vcross(chart.A, chart.B), h = vdot(normal, span);
      if (!(Math.abs(h) > 1e-12)) return null;
      var delta = vsub(p, chart.C), t = vdot(normal, delta) / h;
      var residual = vsub(delta, vmul(span, t));
      var basis = ruledConicBasisAt(chart, t);
      var aa = vdot(basis.A, basis.A), ab = vdot(basis.A, basis.B), bb = vdot(basis.B, basis.B);
      var det = aa * bb - ab * ab;
      if (!(Math.abs(det) > 1e-12 * aa * bb)) return null;
      var aq = vdot(basis.A, residual), bq = vdot(basis.B, residual);
      var alpha = (bb * aq - ab * bq) / det, beta = (aa * bq - ab * aq) / det;
      return {u:wrapAngle(Math.atan2(beta, alpha)), v:t, radial:Math.hypot(alpha, beta), s:t};
    }
    var local = localPoint(eq.frame, p);
    var radial = Math.hypot(local.x, local.y);
    var u = Math.atan2(local.y, local.x);
    var torusLike = eq.kind === 'torus' || (eq.paramChart && eq.paramChart.kind === 'torus') ||
      (eq.majorRadius > 0 && eq.minorRadius > 0 &&
      (eq.constraints || []).some(function (c) {
        return c.kind === 'parameter' && c.family === 'torus';
      }));
    if (torusLike) {
      var R = eq.majorRadius, r = eq.minorRadius;
      var offset = radial - R;
      return {u:wrapAngle(u), v:wrapAngle(Math.atan2(local.z, offset)), radial:radial, s:local.z};
    }
    return {u:wrapAngle(u), v:local.z, radial:radial, s:local.z};
  }
  function constraintValue(eq, constraint, p) {
    if (constraint.kind === 'inequality') {
      var local = localPoint(eq.frame, p);
      return polyEval(constraint.terms, local.x, local.y, local.z).value;
    }
    if (constraint.kind === 'parameter') {
      var params = parameterOf(eq, p);
      if (!params) return NaN;
      if (constraint.family === 'torus')
        return Math.max(angleError(params.u, constraint.u), angleError(params.v, constraint.v));
      return angleError(params.u, constraint.u);
    }
    return NaN;
  }
  function angleError(value, range) {
    if (!range) return 0;
    var lo = range[0], hi = range[1], span = hi - lo;
    if (span >= TAU - 1e-9) return 0;
    var rel = wrapAngle(value - lo), width = wrapAngle(span);
    if (width <= 1e-12) width = span;
    if (rel <= width) return 0;
    return Math.min(rel - width, TAU - rel);
  }
  function constraintsHold(eq, p, options) {
    options = options || {};
    var violations = [];
    (eq.constraints || []).forEach(function (constraint, index) {
      if (constraint.kind === 'inequality') {
        var local = localPoint(eq.frame, p);
        var value = polyEval(constraint.terms, local.x, local.y, local.z).value;
        var tol = 1e-8 * Math.max(Number.MIN_VALUE,
          termsScale(constraint.terms, 1 + Math.hypot(local.x, local.y, local.z)));
        var holds = constraint.op === '>=' ? value >= -tol :
          constraint.op === '<=' ? value <= tol : Math.abs(value) <= tol;
        if (!holds) violations.push({index:index, kind:constraint.kind, label:constraint.label,
          op:constraint.op, value:value, tolerance:tol});
      } else if (constraint.kind === 'parameter') {
        var params = parameterOf(eq, p);
        if (!params) {
          violations.push({index:index, kind:constraint.kind, label:constraint.label, value:NaN});
          return;
        }
        var error = constraint.family === 'torus' ?
          Math.max(angleError(params.u, constraint.u), angleError(params.v, constraint.v)) :
          angleError(params.u, constraint.u);
        var angleTolerance = options.angleTolerance !== undefined ? options.angleTolerance : 1e-7;
        if (error > angleTolerance)
          violations.push({index:index, kind:constraint.kind, label:constraint.label,
            value:error, tolerance:angleTolerance});
      }
    });
    return {ok:violations.length === 0, violations:violations};
  }

  function restrictToLine(eq, line) {
    if (!equationIsValid(eq) || !line || !point(line.origin) || !point(line.direction)) return null;
    var frame = eq.frame;
    var x0 = vdot(frame.u, vsub(line.origin, frame.origin));
    var y0 = vdot(frame.v, vsub(line.origin, frame.origin));
    var z0 = vdot(frame.w, vsub(line.origin, frame.origin));
    var dx = vdot(frame.u, line.direction);
    var dy = vdot(frame.v, line.direction);
    var dz = vdot(frame.w, line.direction);
    var coeffs = [], magnitude = 0;
    eq.terms.forEach(function (t) {
      var c = t[0], a = t[1], b = t[2], d = t[3];
      for (var i = 0; i <= a; i++) for (var j = 0; j <= b; j++) for (var k = 0; k <= d; k++) {
        var power = i + j + k;
        var value = c * BINOMIAL[a][i] * BINOMIAL[b][j] * BINOMIAL[d][k] *
          Math.pow(x0, a - i) * Math.pow(y0, b - j) * Math.pow(z0, d - k) *
          Math.pow(dx, i) * Math.pow(dy, j) * Math.pow(dz, k);
        coeffs[power] = (coeffs[power] || 0) + value;
        magnitude += Math.abs(value);
      }
    });
    for (var n = 0; n < coeffs.length; n++) if (coeffs[n] === undefined) coeffs[n] = 0;
    while (coeffs.length > 1 && coeffs[coeffs.length - 1] === 0) coeffs.pop();
    var scale = Math.max.apply(null, coeffs.map(Math.abs));
    var ratio = magnitude > 0 ? scale / magnitude : (scale === 0 ? 0 : Infinity);
    var coincident = scale === 0;
    return {coefficients:coeffs, degree:coeffs.length - 1, scale:scale, magnitude:magnitude,
      ratio:ratio, coincident:coincident, uncertain:!coincident && ratio <= 1e-7,
      guarantee:coincident ? 'exact-structural-zero' : 'numeric-restriction', frame:frame};
  }
  function lineIntersection(eq, line, options) {
    options = options || {};
    var restriction = restrictToLine(eq, line);
    if (!restriction) return null;
    if (restriction.coincident)
      return {coincident:true, roots:[], polynomial:restriction, method:'line-restriction-sturm'};
    var coeffs = restriction.coefficients;
    if (restriction.degree < 1)
      return {coincident:false, uncertain:restriction.uncertain, roots:[],
        polynomial:restriction, method:'line-restriction-sturm',
        guarantee:restriction.guarantee};
    var bound = rootBound(coeffs);
    var lo = options.tMin !== undefined ? options.tMin : -bound;
    var hi = options.tMax !== undefined ? options.tMax : bound;
    if (!(hi > lo)) return {coincident:false, roots:[], polynomial:restriction,
      method:'line-restriction'};
    var isolation = isolateRoots(coeffs, lo, hi, options);
    var accepted = [], excluded = [];
    isolation.roots.forEach(function (root) {
      var p = vadd(line.origin, vmul(line.direction, root.t));
      var state = constraintsHold(eq, p, options);
      var entry = {t:root.t, point:p, residual:root.residual,
        multiplicity:root.multiplicity, bracket:root.bracket,
        onDomain:state.ok, domainViolations:state.violations};
      if (state.ok) accepted.push(entry); else excluded.push(entry);
    });
    return {coincident:false, roots:accepted, excluded:excluded,
      polynomial:restriction, isolation:isolation, method:'line-restriction-sturm'};
  }

  function sparseAdd(A, B) {
    var out = {};
    [A, B].forEach(function (poly) {
      Object.keys(poly).forEach(function (key) {
        out[key] = (out[key] || 0) + poly[key];
        if (out[key] === 0) delete out[key];
      });
    });
    return out;
  }
  function sparseMul(A, B) {
    var out = {};
    Object.keys(A).forEach(function (ka) {
      var a = ka.split(',').map(Number);
      Object.keys(B).forEach(function (kb) {
        var b = kb.split(',').map(Number);
        var key = (a[0] + b[0]) + ',' + (a[1] + b[1]) + ',' + (a[2] + b[2]);
        out[key] = (out[key] || 0) + A[ka] * B[kb];
        if (out[key] === 0) delete out[key];
      });
    });
    return out;
  }
  function relativeTerms(eq, targetFrame) {
    if (!eq || !equationIsValid(eq) || !frameValid(targetFrame)) return null;
    var o = vsub(targetFrame.origin, eq.frame.origin);
    var coordinatePolys = [];
    [eq.frame.u, eq.frame.v, eq.frame.w].forEach(function (axis) {
      var poly = {};
      poly['1,0,0'] = vdot(axis, targetFrame.u);
      poly['0,1,0'] = vdot(axis, targetFrame.v);
      poly['0,0,1'] = vdot(axis, targetFrame.w);
      poly['0,0,0'] = vdot(axis, o);
      coordinatePolys.push(poly);
    });
    var result = {'0,0,0':0};
    eq.terms.forEach(function (t) {
      var term = {'0,0,0':t[0]};
      for (var i = 0; i < t[1]; i++) term = sparseMul(term, coordinatePolys[0]);
      for (var j = 0; j < t[2]; j++) term = sparseMul(term, coordinatePolys[1]);
      for (var k = 0; k < t[3]; k++) term = sparseMul(term, coordinatePolys[2]);
      result = sparseAdd(result, term);
    });
    return result;
  }
  function framesIdentical(a, b) {
    function same(p, q) { return p && q && p.x === q.x && p.y === q.y && p.z === q.z; }
    return same(a.origin, b.origin) && same(a.u, b.u) && same(a.v, b.v) && same(a.w, b.w);
  }
  function exponentMaps(terms) {
    var map = {};
    terms.forEach(function (t) { map[t[1] + ',' + t[2] + ',' + t[3]] = t[0]; });
    return map;
  }
  function exactProportionalSameFrame(a, b) {
    var mapA = exponentMaps(a.terms), mapB = exponentMaps(b.terms);
    var keys = uniqueStrings(Object.keys(mapA).concat(Object.keys(mapB)));
    var valuesA = keys.map(function (key) { return mapA[key] || 0; });
    var valuesB = keys.map(function (key) { return mapB[key] || 0; });
    var integerA, integerB;
    try {
      integerA = integerCoeffs(valuesA);
      integerB = integerCoeffs(valuesB);
    } catch (err) { return {comparable:false, coincident:false, exact:false}; }
    if (!integerA || !integerB) return {comparable:false, coincident:false, exact:false};
    var pivot = -1;
    for (var i = 0; i < integerA.length; i++) if (integerA[i] !== 0n) { pivot = i; break; }
    if (pivot === -1) return {comparable:false, coincident:false, exact:false};
    if (integerB[pivot] === 0n)
      return {comparable:true, coincident:false, exact:true,
        method:'exact-integer-cross-product'};
    for (var j = 0; j < integerA.length; j++) {
      if (integerB[j] * integerA[pivot] !== integerA[j] * integerB[pivot])
        return {comparable:true, coincident:false, exact:true,
          method:'exact-integer-cross-product'};
    }
    return {comparable:true, coincident:true, exact:true,
      method:'exact-integer-cross-product'};
  }
  function proportionalEquation(a, b, options) {
    options = options || {};
    if (framesIdentical(a.frame, b.frame)) return exactProportionalSameFrame(a, b);
    var relative = relativeTerms(a, b.frame);
    if (!relative) return {comparable:false, coincident:false, uncertain:false, exact:false};
    var bMap = {};
    b.terms.forEach(function (t) { bMap[t[1] + ',' + t[2] + ',' + t[3]] = t[0]; });
    var keys = uniqueStrings(Object.keys(relative).concat(Object.keys(bMap)));
    var dotProduct = 0, bNormSquared = 0, relativeNormSquared = 0;
    keys.forEach(function (key) {
      var av = relative[key] || 0, bv = bMap[key] || 0;
      dotProduct += av * bv;
      bNormSquared += bv * bv;
      relativeNormSquared += av * av;
    });
    if (!(bNormSquared > 0))
      return {comparable:false, coincident:false, uncertain:false, exact:false};
    var lambda = dotProduct / bNormSquared;
    var differenceNormSquared = 0;
    keys.forEach(function (key) {
      var delta = (relative[key] || 0) - lambda * (bMap[key] || 0);
      differenceNormSquared += delta * delta;
    });
    var denominator = Math.max(Math.sqrt(relativeNormSquared),
      Math.abs(lambda) * Math.sqrt(bNormSquared), 1e-300);
    var residual = Math.sqrt(differenceNormSquared) / denominator;
    return {comparable:true, coincident:false, uncertain:residual <= 1e-6,
      exact:false, residual:residual, lambda:lambda,
      method:'affine-relative-proportional-numeric'};
  }
  function frameWorldBox(frame, lo, hi) {
    var min = vec(Infinity, Infinity, Infinity), max = vec(-Infinity, -Infinity, -Infinity);
    [lo.x, hi.x].forEach(function (x) {
      [lo.y, hi.y].forEach(function (y) {
        [lo.z, hi.z].forEach(function (z) {
          var p = worldPoint(frame, vec(x, y, z));
          var error = 32 * Number.EPSILON * (Math.abs(frame.origin.x) + Math.abs(frame.origin.y) +
            Math.abs(frame.origin.z) + Math.abs(frame.u.x * x) + Math.abs(frame.u.y * x) +
            Math.abs(frame.u.z * x) + Math.abs(frame.v.x * y) + Math.abs(frame.v.y * y) +
            Math.abs(frame.v.z * y) + Math.abs(frame.w.x * z) + Math.abs(frame.w.y * z) +
            Math.abs(frame.w.z * z));
          min.x = Math.min(min.x, p.x - error); min.y = Math.min(min.y, p.y - error);
          min.z = Math.min(min.z, p.z - error);
          max.x = Math.max(max.x, p.x + error); max.y = Math.max(max.y, p.y + error);
          max.z = Math.max(max.z, p.z + error);
        });
      });
    });
    return {min:min, max:max};
  }
  function worldBoxLocalIntervals(frame, box) {
    function intervalOf(axis) {
      var min = Infinity, max = -Infinity;
      [box.min.x, box.max.x].forEach(function (x) {
        [box.min.y, box.max.y].forEach(function (y) {
          [box.min.z, box.max.z].forEach(function (z) {
            var dot = vdot(axis, vsub(vec(x, y, z), frame.origin));
            var error = 16 * Number.EPSILON * (Math.abs(axis.x * (x - frame.origin.x)) +
              Math.abs(axis.y * (y - frame.origin.y)) + Math.abs(axis.z * (z - frame.origin.z)));
            min = Math.min(min, dot - error); max = Math.max(max, dot + error);
          });
        });
      });
      return ival(nextDown(min), nextUp(max));
    }
    return {x:intervalOf(frame.u), y:intervalOf(frame.v), z:intervalOf(frame.w)};
  }
  function intervalPolyEvalWorld(eq, box) {
    var local = worldBoxLocalIntervals(eq.frame, box);
    return iintervalPolyEval(eq.terms, local.x, local.y, local.z);
  }
  function equationWorldBox(eq) {
    if (!eq || !eq.bounds) return null;
    return frameWorldBox(eq.frame, eq.bounds.lo, eq.bounds.hi);
  }
  function paddedRange(range) {
    var magnitude = Math.max(Math.abs(range.lo), Math.abs(range.hi), Number.MIN_VALUE);
    var pad = 512 * Number.EPSILON * magnitude + 1e-10 * magnitude;
    return {lo:range.lo - pad, hi:range.hi + pad, pad:pad};
  }
  function constraintsImpossible(eq, box) {
    var local = worldBoxLocalIntervals(eq.frame, box);
    return (eq.constraints || []).some(function (constraint) {
      if (constraint.kind !== 'inequality') return false;
      var range = paddedRange(iintervalPolyEval(constraint.terms, local.x, local.y, local.z));
      if (constraint.op === '>=') return range.hi < 0;
      if (constraint.op === '<=') return range.lo > 0;
      return range.lo > 0 || range.hi < 0;
    });
  }
  function proveDisjoint(a, b) {
    var order = [[a, b], [b, a]];
    for (var i = 0; i < order.length; i++) {
      var box = equationWorldBox(order[i][0]);
      if (!box) continue;
      if (constraintsImpossible(order[i][1], box))
        return {separated:true, proven:false, method:'constraint-interval-separation',
          box:box, guarantee:'numeric-interval-separation',
          coverage:{uncertain:true, reason:'floating-point-interval-enclosure'}};
      var raw = intervalPolyEvalWorld(order[i][1], box);
      var range = paddedRange(raw);
      if (!icontains(range, 0))
        return {separated:true, proven:false, method:'polynomial-interval-separation',
          box:box, range:range, guarantee:'numeric-interval-separation',
          coverage:{uncertain:true, reason:'floating-point-interval-enclosure'}};
      if (Math.abs(range.lo) <= range.pad || Math.abs(range.hi) <= range.pad)
        return {separated:false, proven:false, nearZero:true, box:box, range:range};
    }
    return {separated:false, proven:false};
  }
  function boundsForPair(a, b, options) {
    options = options || {};
    if (options.bounds) {
      var lo = point(options.bounds.min || options.bounds.lo);
      var hi = point(options.bounds.max || options.bounds.hi);
      if (lo && hi) return {min:vec(Math.min(lo.x, hi.x), Math.min(lo.y, hi.y), Math.min(lo.z, hi.z)),
        max:vec(Math.max(lo.x, hi.x), Math.max(lo.y, hi.y), Math.max(lo.z, hi.z)),
        source:'caller'};
    }
    var boxes = [equationWorldBox(a), equationWorldBox(b)].filter(Boolean);
    if (!boxes.length) return null;
    var min = vec(-Infinity, -Infinity, -Infinity), max = vec(Infinity, Infinity, Infinity);
    boxes.forEach(function (box) {
      min.x = Math.max(min.x, box.min.x); min.y = Math.max(min.y, box.min.y);
      min.z = Math.max(min.z, box.min.z);
      max.x = Math.min(max.x, box.max.x); max.y = Math.min(max.y, box.max.y);
      max.z = Math.min(max.z, box.max.z);
    });
    if (!(max.x >= min.x) || !(max.y >= min.y) || !(max.z >= min.z)) return null;
    return {min:min, max:max, source:'compact-support'};
  }
  function sourceEvidenceFor(a, b) {
    var evidence = {surfaceIds:[], kinds:[], sourceIds:[], status:[]};
    [a, b].forEach(function (eq) {
      var identity = eq.identity || {};
      evidence.surfaceIds.push(identity.surfaceId === undefined ? null : identity.surfaceId);
      evidence.kinds.push(identity.kind || eq.kind);
      evidence.sourceIds = uniqueStrings(evidence.sourceIds.concat(identity.sourceIds || []));
      evidence.status.push(identity.status || 'inferred');
    });
    evidence.declared = evidence.status.map(function (s) { return s === 'declared'; });
    return evidence;
  }
  function algebraicIntersection(a, b, options) {
    options = options || {};
    if (!equationIsValid(a) || !equationIsValid(b)) return null;
    var coincidence = proportionalEquation(a, b, options);
    var domainRestricted = (a.constraints || []).length > 0 || (b.constraints || []).length > 0;
    if (coincidence.coincident) {
      if (!domainRestricted)
        return {contract:INTERSECTION_CONTRACT, kind:'coincident', relation:'coincident',
          equations:[serialize(a), serialize(b)], constraints:[],
          topologyCertified:false, guarantee:'algebraic-proportional-support',
          method:coincidence.method, proportional:coincidence,
          surfaceIds:[a.identity && a.identity.surfaceId, b.identity && b.identity.surfaceId],
          surfaceKinds:[a.kind, b.kind], evidence:sourceEvidenceFor(a, b)};
      return {contract:INTERSECTION_CONTRACT, kind:'implicit-intersection',
        relation:'coincident-support',
        equations:[serialize(a), serialize(b)],
        constraints:constraintList(a, b), bounds:boundsForPair(a, b, options),
        topologyCertified:false, guarantee:'algebraic-proportional-support-with-domain',
        method:coincidence.method, proportional:coincidence,
        surfaceIds:[a.identity && a.identity.surfaceId, b.identity && b.identity.surfaceId],
        surfaceKinds:[a.kind, b.kind], evidence:sourceEvidenceFor(a, b)};
    }
    if (coincidence.uncertain)
      options = Object.assign({}, options, {coincidenceUncertain:true});
    var disjoint = proveDisjoint(a, b);
    if (disjoint.separated)
      return {contract:INTERSECTION_CONTRACT, kind:'none', relation:'none',
        separated:true, proven:false, method:disjoint.method, bounds:disjoint.box || null,
        equations:[serialize(a), serialize(b)], constraints:constraintList(a, b),
        topologyCertified:false, guarantee:disjoint.guarantee,
        surfaceIds:[a.identity && a.identity.surfaceId, b.identity && b.identity.surfaceId],
        surfaceKinds:[a.kind, b.kind], evidence:sourceEvidenceFor(a, b),
        diagnostic:{code:'implicit-interval-disjoint', severity:'info',
          message:'Conservative interval exclusion separates the supports on the compact bounds.'}};
    var bounds = boundsForPair(a, b, options);
    var result = {contract:INTERSECTION_CONTRACT, kind:'implicit-intersection',
      relation:'algebraic', equations:[serialize(a), serialize(b)],
      constraints:constraintList(a, b), bounds:bounds,
      topologyCertified:false, guarantee:'algebraic-set', method:'implicit-polynomial',
      surfaceIds:[a.identity && a.identity.surfaceId, b.identity && b.identity.surfaceId],
      surfaceKinds:[a.kind, b.kind], evidence:sourceEvidenceFor(a, b),
      tolerance:{residual:1e-8, method:'scaled-polynomial'}};
    if (coincidence.comparable) {
      result.coincidence = {residual:coincidence.residual, uncertain:!!coincidence.uncertain,
        lambda:coincidence.lambda};
      if (coincidence.uncertain)
        result.diagnostic = {code:'implicit-coincidence-uncertain', severity:'warning',
          message:'The supports are nearly proportional but not certified coincident.'};
    }
    var unresolvedDomain = [];
    [a, b].forEach(function (eq, index) {
      ((eq.domain && eq.domain.unresolved) || []).forEach(function (name) {
        unresolvedDomain.push({surface:index, name:name});
      });
    });
    if (unresolvedDomain.length) {
      result.supportOnly = true;
      result.status = 'support-only';
      result.guarantee = 'algebraic-support-only';
      result.unresolvedDomain = unresolvedDomain;
      result.diagnostic = {code:'implicit-domain-unresolved', severity:'warning',
        message:'Finite patch or boolean domains are not compiled into polynomial constraints; the algebraic set describes the supports only.'};
    }
    if (!bounds)
      result.display = {status:'unbounded', reason:'finite-bounds-required',
        message:'The algebraic set is complete; display needs caller bounds or compact supports.'};
    return result;
  }
  function constraintList(a, b) {
    return (a.constraints || []).map(function (c, index) {
      var out = cloneConstraint(c); out.surface = 0; out.index = index; return out;
    }).concat((b.constraints || []).map(function (c, index) {
      var out = cloneConstraint(c); out.surface = 1; out.index = index; return out;
    }));
  }

  function linearInZ(constraint) {
    if (!constraint || constraint.kind !== 'inequality') return null;
    var a = 0, b = 0;
    for (var i = 0; i < constraint.terms.length; i++) {
      var t = constraint.terms[i];
      if (t[1] === 0 && t[2] === 0 && t[3] === 1) a += t[0];
      else if (t[1] === 0 && t[2] === 0 && t[3] === 0) b += t[0];
      else return null;
    }
    var scale = Math.max(Math.abs(a), Math.abs(b));
    if (scale > 0) { a /= scale; b /= scale; }
    return {a:a, b:b, op:constraint.op};
  }
  function chartMatchesEquation(eq) {
    var chart = eq.paramChart;
    if (!chart) return false;
    var samples;
    if (chart.kind === 'plane') samples = [[0, 0], [1, -1]];
    else if (chart.kind === 'sphere') samples = [[0, 0], [1, 0.5], [2.2, -0.7], [4.1, 1.1]];
    else if (chart.kind === 'cylinder') samples = [[0, 0], [1, 1], [2.5, -2], [4, 3]];
    else if (chart.kind === 'cone') samples = [[0, 1], [1.2, 2], [3.1, 0.5], [5, 3]];
    else if (chart.kind === 'torus') samples = [[0, 0], [1, 0.7], [2.4, -1.2], [4.5, 2.1]];
    else if (chart.kind === 'ruledConic') samples = [[0, 0], [1.1, 0.3], [2.7, 0.65], [4.9, 1]];
    else return false;
    for (var i = 0; i < samples.length; i++) {
      var p = paramPoint(eq, samples[i][0], samples[i][1]);
      if (!p) return false;
      var evaluated = evaluate(eq, p);
      if (!evaluated || !Number.isFinite(evaluated.value)) return false;
      var local = localPoint(eq.frame, p);
      var tolerance = 1e-6 * Math.max(Number.MIN_VALUE, termsScale(eq.terms,
        1 + Math.hypot(local.x, local.y, local.z)));
      if (Math.abs(evaluated.value) > tolerance) return false;
    }
    return true;
  }
  function paramChartStatus(eq) {
    if (!eq || !eq.paramChart) return 'none';
    return chartMatchesEquation(eq) ? 'ok' : 'inconsistent';
  }
  function paramDomain(eq, options) {
    options = options || {};
    var chart = eq.paramChart;
    if (!chart || !chartMatchesEquation(eq)) return null;
    var domain = null;
    if (options.paramDomain && Array.isArray(options.paramDomain.u) &&
        Array.isArray(options.paramDomain.v)) domain = options.paramDomain;
    if (chart.kind === 'sphere') return {u:[0, TAU], v:[-Math.PI / 2, Math.PI / 2],
      periodicU:true, periodicV:false, source:'natural'};
    if (chart.kind === 'torus') {
      var torusConstraint = (eq.constraints || []).filter(function (c) {
        return c.kind === 'parameter' && c.family === 'torus';
      })[0];
      var torusU = torusConstraint ? torusConstraint.u.slice() : [0, TAU];
      var torusV = torusConstraint ? torusConstraint.v.slice() : [0, TAU];
      return {u:torusU, v:torusV,
        periodicU:torusU[1] - torusU[0] >= TAU - 1e-9,
        periodicV:torusV[1] - torusV[0] >= TAU - 1e-9,
        source:torusConstraint ? 'declared-domain' : 'natural'};
    }
    if (chart.kind === 'plane') {
      if (domain) return {u:domain.u.slice(), v:domain.v.slice(), periodicU:false,
        periodicV:false, source:'caller'};
      if (!options.bounds) return null;
      var corners = [];
      [options.bounds.min.x, options.bounds.max.x].forEach(function (x) {
        [options.bounds.min.y, options.bounds.max.y].forEach(function (y) {
          [options.bounds.min.z, options.bounds.max.z].forEach(function (z) {
            var local = localPoint(eq.frame, vec(x, y, z));
            corners.push(local);
          });
        });
      });
      var us = corners.map(function (p) { return p.x; }), vs = corners.map(function (p) { return p.y; });
      return {u:[Math.min.apply(null, us), Math.max.apply(null, us)],
        v:[Math.min.apply(null, vs), Math.max.apply(null, vs)],
        periodicU:false, periodicV:false, source:'world-bounds'};
    }
    if (chart.kind === 'ruledConic')
      return {u:[0, TAU], v:[0, 1], periodicU:true, periodicV:false, source:'declared-domain'};
    if (chart.kind !== 'cylinder' && chart.kind !== 'cone') return null;
    var angular = (eq.constraints || []).filter(function (c) {
      return c.kind === 'parameter' && (c.family === 'cylinder' || c.family === 'cone');
    })[0];
    var uRange = angular ? angular.u.slice() : [0, TAU];
    var lo = -Infinity, hi = Infinity, empty = false;
    (eq.constraints || []).forEach(function (c) {
      var linear = linearInZ(c);
      if (!linear || linear.op === '==') return;
      if (Math.abs(linear.a) <= 1e-14) { if (!(linear.op === '>=' ? linear.b >= 0 : linear.b <= 0)) empty = true; return; }
      var bound = -linear.b / linear.a;
      var lower = linear.op === '>=' ? linear.a > 0 : linear.a < 0;
      if (lower) lo = Math.max(lo, bound); else hi = Math.min(hi, bound);
    });
    if (empty || lo > hi) return null;
    if ((!Number.isFinite(lo) || !Number.isFinite(hi)) && options.bounds) {
      var zs = [];
      [options.bounds.min.x, options.bounds.max.x].forEach(function (x) {
        [options.bounds.min.y, options.bounds.max.y].forEach(function (y) {
          [options.bounds.min.z, options.bounds.max.z].forEach(function (z) {
            zs.push(localPoint(eq.frame, vec(x, y, z)).z);
          });
        });
      });
      var zlo = Math.min.apply(null, zs), zhi = Math.max.apply(null, zs);
      if (!Number.isFinite(lo)) lo = zlo;
      if (!Number.isFinite(hi)) hi = zhi;
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return null;
    return {u:uRange, v:[lo, hi], periodicU:uRange[1] - uRange[0] >= TAU - 1e-9,
      periodicV:false, source:angular ? 'declared-angular' : 'computed-axial'};
  }
  function localVector(frame, local) {
    return vadd(vadd(vmul(frame.u, local.x), vmul(frame.v, local.y)), vmul(frame.w, local.z));
  }
  function ruledConicAffine(chart) {
    return !!(chart && point(chart.A2) && point(chart.B2));
  }
  function ruledConicBasisAt(chart, v) {
    if (ruledConicAffine(chart))
      return {A:vadd(chart.A, vmul(vsub(chart.A2, chart.A), v)),
        B:vadd(chart.B, vmul(vsub(chart.B2, chart.B), v))};
    var scale = 1 + v * (chart.k - 1);
    return {A:vmul(chart.A, scale), B:vmul(chart.B, scale)};
  }
  function ruledConicPoint(chart, u, v) {
    var basis = ruledConicBasisAt(chart, v);
    return vadd(vadd(chart.C, vmul(vsub(chart.D, chart.C), v)),
      vadd(vmul(basis.A, Math.cos(u)), vmul(basis.B, Math.sin(u))));
  }
  function paramPoint(eq, u, v) {
    var chart = eq.paramChart;
    if (!chart) return null;
    if (chart.kind === 'ruledConic') return ruledConicPoint(chart, u, v);
    var local;
    if (chart.kind === 'plane') local = vec(u, v, 0);
    else if (chart.kind === 'sphere') {
      var sphereRadius = chart.radius;
      local = vec(sphereRadius * Math.cos(v) * Math.cos(u),
        sphereRadius * Math.cos(v) * Math.sin(u), sphereRadius * Math.sin(v));
    } else if (chart.kind === 'cylinder') {
      var cylinderRadius = chart.radius;
      local = vec(cylinderRadius * Math.cos(u), cylinderRadius * Math.sin(u), v);
    } else if (chart.kind === 'cone') {
      var radius = chart.r0 + chart.k * v;
      local = vec(radius * Math.cos(u), radius * Math.sin(u), v);
    } else if (chart.kind === 'torus') {
      var R = chart.majorRadius, r = chart.minorRadius, ring = R + r * Math.cos(v);
      local = vec(ring * Math.cos(u), ring * Math.sin(u), r * Math.sin(v));
    } else return null;
    return worldPoint(eq.frame, local);
  }
  function paramPartial(eq, u, v) {
    var chart = eq.paramChart;
    if (!chart) return null;
    if (chart.kind === 'ruledConic') {
      var basis = ruledConicBasisAt(chart, v);
      var tangent = vadd(vmul(basis.A, -Math.sin(u)), vmul(basis.B, Math.cos(u)));
      var span = vsub(chart.D, chart.C);
      if (ruledConicAffine(chart)) {
        var deltaA = vsub(chart.A2, chart.A), deltaB = vsub(chart.B2, chart.B);
        return {u:tangent,
          v:vadd(span, vadd(vmul(deltaA, Math.cos(u)), vmul(deltaB, Math.sin(u))))};
      }
      var unscaledBoundary = vadd(vmul(chart.A, Math.cos(u)), vmul(chart.B, Math.sin(u)));
      return {u:tangent,
        v:vadd(span, vmul(unscaledBoundary, chart.k - 1))};
    }
    if (chart.kind === 'plane') return {u:eq.frame.u, v:eq.frame.v};
    if (chart.kind === 'sphere') {
      var sr = chart.radius;
      return {u:localVector(eq.frame, vec(-sr * Math.cos(v) * Math.sin(u),
          sr * Math.cos(v) * Math.cos(u), 0)),
        v:localVector(eq.frame, vec(-sr * Math.sin(v) * Math.cos(u),
          -sr * Math.sin(v) * Math.sin(u), sr * Math.cos(v)))};
    }
    if (chart.kind === 'cylinder') {
      var cr = chart.radius;
      return {u:localVector(eq.frame, vec(-cr * Math.sin(u), cr * Math.cos(u), 0)),
        v:eq.frame.w};
    }
    if (chart.kind === 'cone') {
      var radius = chart.r0 + chart.k * v;
      return {u:localVector(eq.frame, vec(-radius * Math.sin(u), radius * Math.cos(u), 0)),
        v:vadd(localVector(eq.frame, vec(chart.k * Math.cos(u), chart.k * Math.sin(u), 0)),
          eq.frame.w)};
    }
    if (chart.kind === 'torus') {
      var R = chart.majorRadius, r = chart.minorRadius, ring = R + r * Math.cos(v);
      return {u:localVector(eq.frame, vec(-ring * Math.sin(u), ring * Math.cos(u), 0)),
        v:localVector(eq.frame, vec(-r * Math.sin(v) * Math.cos(u),
          -r * Math.sin(v) * Math.sin(u), r * Math.cos(v)))};
    }
    return null;
  }
  function paramCellLocalBox(eq, u0, u1, v0, v1) {
    var chart = eq.paramChart;
    if (!chart) return null;
    if (chart.kind === 'plane') return {lo:vec(u0, v0, 0), hi:vec(u1, v1, 0)};
    var cu = intervalCos(u0, u1), su = intervalSin(u0, u1);
    if (chart.kind === 'sphere') {
      var sr = chart.radius;
      var cv = intervalCos(v0, v1), sv = intervalSin(v0, v1);
      var cx = iscale(imul(cv, cu), sr), cy = iscale(imul(cv, su), sr), cz = iscale(sv, sr);
      return {lo:vec(cx.lo, cy.lo, cz.lo), hi:vec(cx.hi, cy.hi, cz.hi)};
    }
    if (chart.kind === 'cylinder') {
      var cr = chart.radius;
      return {lo:vec(iscale(cu, cr).lo, iscale(su, cr).lo, v0),
        hi:vec(iscale(cu, cr).hi, iscale(su, cr).hi, v1)};
    }
    if (chart.kind === 'cone') {
      var r1 = chart.r0 + chart.k * v0, r2 = chart.r0 + chart.k * v1;
      var rr = ival(Math.min(r1, r2), Math.max(r1, r2));
      var rx = imul(rr, cu), ry = imul(rr, su);
      return {lo:vec(rx.lo, ry.lo, Math.min(v0, v1)), hi:vec(rx.hi, ry.hi, Math.max(v0, v1))};
    }
    if (chart.kind === 'torus') {
      var R = chart.majorRadius, r = chart.minorRadius;
      var cv2 = intervalCos(v0, v1), sv2 = intervalSin(v0, v1);
      var ring = iadd(ival(R, R), iscale(cv2, r));
      var tx = imul(ring, cu), ty = imul(ring, su), tz = iscale(sv2, r);
      return {lo:vec(tx.lo, ty.lo, tz.lo), hi:vec(tx.hi, ty.hi, tz.hi)};
    }
    if (chart.kind === 'ruledConic') {
      var frame = eq.frame;
      var centerLocal = localPoint(frame, chart.C);
      var delta = vsub(chart.D, chart.C);
      var dLocal = vec(vdot(frame.u, delta), vdot(frame.v, delta), vdot(frame.w, delta));
      var aLocal = vec(vdot(frame.u, chart.A), vdot(frame.v, chart.A), vdot(frame.w, chart.A));
      var bLocal = vec(vdot(frame.u, chart.B), vdot(frame.v, chart.B), vdot(frame.w, chart.B));
      var tv = ival(v0, v1);
      function axisRange(center, direction, a, b, a2, b2) {
        var motion = iscale(tv, direction);
        var ar = iadd(ival(a, a), iscale(tv, a2 - a));
        var br = iadd(ival(b, b), iscale(tv, b2 - b));
        var wave = iadd(imul(cu, ar), imul(su, br));
        return iadd(ival(center, center), iadd(motion, wave));
      }
      if (ruledConicAffine(chart)) {
        var a2Local = vec(vdot(frame.u, chart.A2), vdot(frame.v, chart.A2), vdot(frame.w, chart.A2));
        var b2Local = vec(vdot(frame.u, chart.B2), vdot(frame.v, chart.B2), vdot(frame.w, chart.B2));
        var rx2 = axisRange(centerLocal.x, dLocal.x, aLocal.x, bLocal.x, a2Local.x, b2Local.x);
        var ry2 = axisRange(centerLocal.y, dLocal.y, aLocal.y, bLocal.y, a2Local.y, b2Local.y);
        var rz2 = axisRange(centerLocal.z, dLocal.z, aLocal.z, bLocal.z, a2Local.z, b2Local.z);
        return {lo:vec(rx2.lo, ry2.lo, rz2.lo), hi:vec(rx2.hi, ry2.hi, rz2.hi)};
      }
      var scale = iadd(ival(1, 1), iscale(tv, chart.k - 1));
      function axisScale(center, direction, a, b) {
        var motion = iscale(tv, direction);
        var wave = iadd(iscale(cu, a), iscale(su, b));
        return iadd(ival(center, center), iadd(motion, imul(scale, wave)));
      }
      var rx = axisScale(centerLocal.x, dLocal.x, aLocal.x, bLocal.x);
      var ry = axisScale(centerLocal.y, dLocal.y, aLocal.y, bLocal.y);
      var rz = axisScale(centerLocal.z, dLocal.z, aLocal.z, bLocal.z);
      return {lo:vec(rx.lo, ry.lo, rz.lo), hi:vec(rx.hi, ry.hi, rz.hi)};
    }
    return null;
  }
  function paramCellWorldBox(eq, u0, u1, v0, v1) {
    var local = paramCellLocalBox(eq, u0, u1, v0, v1);
    if (!local) return null;
    return frameWorldBox(eq.frame, local.lo, local.hi);
  }
  function boxesOverlap(a, b, tolerance) {
    if (!a || !b) return true;
    var tol = tolerance || 0;
    return a.max.x >= b.min.x - tol && a.min.x <= b.max.x + tol &&
      a.max.y >= b.min.y - tol && a.min.y <= b.max.y + tol &&
      a.max.z >= b.min.z - tol && a.min.z <= b.max.z + tol;
  }
  function cellMayIntersect(tracer, target, u0, u1, v0, v1, bounds) {
    var box = paramCellWorldBox(tracer, u0, u1, v0, v1);
    if (!box) return true;
    if (bounds && !boxesOverlap(box, bounds, 1e-9 * boundsScale(bounds))) return false;
    var range = paddedRange(intervalPolyEvalWorld(target, box));
    if (!icontains(range, 0)) return false;
    var local = worldBoxLocalIntervals(target.frame, box);
    var blocked = (target.constraints || []).some(function (c) {
      if (c.kind !== 'inequality') return false;
      var r = paddedRange(iintervalPolyEval(c.terms, local.x, local.y, local.z));
      if (c.op === '>=') return r.hi < 0;
      if (c.op === '<=') return r.lo > 0;
      return r.lo > 0 || r.hi < 0;
    });
    return !blocked;
  }

  function domainContains(domain, u, v, tolerance) {
    var tol = tolerance || 1e-9;
    if (!domain.periodicU && (u < domain.u[0] - tol || u > domain.u[1] + tol)) return false;
    if (!domain.periodicV && (v < domain.v[0] - tol || v > domain.v[1] + tol)) return false;
    return true;
  }
  function domainWrap(domain, u, v) {
    function wrap(value, range, periodic) {
      if (!periodic) return value;
      var width = range[1] - range[0];
      if (!(width > 0)) return value;
      return range[0] + ((value - range[0]) % width + width) % width;
    }
    return {u:wrap(u, domain.u, domain.periodicU), v:wrap(v, domain.v, domain.periodicV)};
  }
  function paramGradient(tracer, target, u, v) {
    var p = paramPoint(tracer, u, v);
    if (!p) return null;
    var evaluated = evaluate(target, p), partial = paramPartial(tracer, u, v);
    if (!evaluated || !partial) return null;
    return {g:evaluated.value, gu:vdot(evaluated.gradient, partial.u),
      gv:vdot(evaluated.gradient, partial.v), point:p, gradient:evaluated.gradient,
      partial:partial};
  }
  function surfaceResiduals(a, b, point) {
    var ea = evaluate(a, point), eb = evaluate(b, point);
    return {a:ea ? Math.abs(ea.value) : Infinity, b:eb ? Math.abs(eb.value) : Infinity};
  }
  function constraintMargin(eq, point) {
    var margin = Infinity;
    (eq.constraints || []).forEach(function (c) {
      if (c.kind === 'inequality') {
        var local = localPoint(eq.frame, point);
        var value = polyEval(c.terms, local.x, local.y, local.z).value;
        var scale = Math.max(Number.MIN_VALUE,
          termsScale(c.terms, 1 + Math.hypot(local.x, local.y, local.z)));
        var normalized = value / scale;
        margin = Math.min(margin, c.op === '>=' ? normalized : c.op === '<=' ? -normalized :
          -Math.abs(normalized));
      } else if (c.kind === 'parameter') {
        var params = parameterOf(eq, point);
        if (!params) { margin = -Infinity; return; }
        var error = c.family === 'torus' ?
          Math.max(angleError(params.u, c.u), angleError(params.v, c.v)) : angleError(params.u, c.u);
        margin = Math.min(margin, -error);
      }
    });
    return margin;
  }
  function bisectEdge(tracer, target, fixedValue, varyAxis, lo, hi, flo, fhi) {
    for (var i = 0; i < 70; i++) {
      var mid = 0.5 * (lo + hi);
      var u = varyAxis === 'u' ? mid : fixedValue;
      var v = varyAxis === 'u' ? fixedValue : mid;
      var evaluated = paramGradient(tracer, target, u, v);
      if (!evaluated) return null;
      if ((flo > 0) === (evaluated.g > 0)) { lo = mid; flo = evaluated.g; }
      else { hi = mid; fhi = evaluated.g; }
      if (hi - lo <= 1e-13 * Math.max(1, Math.abs(mid))) break;
    }
    var result = varyAxis === 'u' ? {u:0.5 * (lo + hi), v:fixedValue} :
      {u:fixedValue, v:0.5 * (lo + hi)};
    return result;
  }
  function tangencySeed(tracer, target, cell, tolerance) {
    var u = 0.5 * (cell.u0 + cell.u1), v = 0.5 * (cell.v0 + cell.v1);
    for (var i = 0; i < 24; i++) {
      var evaluated = paramGradient(tracer, target, u, v);
      if (!evaluated) return null;
      if (Math.abs(evaluated.g) <= tolerance) return {u:u, v:v, tangency:true};
      var norm2 = evaluated.gu * evaluated.gu + evaluated.gv * evaluated.gv;
      if (!(norm2 > 0)) break;
      u -= evaluated.g * evaluated.gu / norm2;
      v -= evaluated.g * evaluated.gv / norm2;
      if (u < cell.u0 || u > cell.u1 || v < cell.v0 || v > cell.v1) return null;
    }
    var final = paramGradient(tracer, target, u, v);
    return final && Math.abs(final.g) <= tolerance * 16 ? {u:u, v:v, tangency:true} : null;
  }
  function findSeeds(tracer, target, domain, options, diagnostics, bounds) {
    var gridU = Math.max(2, Math.min(options.gridU || 10, 48));
    var gridV = Math.max(2, Math.min(options.gridV || 10, 48));
    var du = (domain.u[1] - domain.u[0]) / gridU, dv = (domain.v[1] - domain.v[0]) / gridV;
    var maxDepth = options.seedDepth === undefined ? 6 : options.seedDepth;
    var maxCells = options.maxCells || 4096;
    var tolerance = (options.seedTolerance || 1e-10) *
      Math.max(Number.MIN_VALUE, termsScale(target.terms, 1));
    var stack = [], seeds = [], unresolved = [], cells = 0;
    function seedInside(seed) {
      if (!bounds) return true;
      var world = paramPoint(tracer, seed.u, seed.v);
      return world && insideBounds(bounds, world, 1e-9 * boundsScale(bounds));
    }
    for (var i = 0; i < gridU; i++) for (var j = 0; j < gridV; j++)
      stack.push({u0:domain.u[0] + i * du, u1:domain.u[0] + (i + 1) * du,
        v0:domain.v[0] + j * dv, v1:domain.v[0] + (j + 1) * dv, depth:0});
    function valueAt(u, v) {
      var evaluated = paramGradient(tracer, target, u, v);
      return evaluated ? evaluated.g : NaN;
    }
    while (stack.length) {
      var cell = stack.pop();
      if (++cells > maxCells) {
        unresolved.push({u:[cell.u0, cell.u1], v:[cell.v0, cell.v1], depth:cell.depth,
          reason:'cell-budget'});
        continue;
      }
      if (!cellMayIntersect(tracer, target, cell.u0, cell.u1, cell.v0, cell.v1, bounds)) continue;
      var f00 = valueAt(cell.u0, cell.v0), f10 = valueAt(cell.u1, cell.v0);
      var f01 = valueAt(cell.u0, cell.v1), f11 = valueAt(cell.u1, cell.v1);
      if (![f00, f10, f01, f11].every(Number.isFinite)) {
        unresolved.push({u:[cell.u0, cell.u1], v:[cell.v0, cell.v1], depth:cell.depth,
          reason:'non-finite-evaluation'});
        continue;
      }
      var found = [], edges = [
        {fixed:cell.v0, axis:'u', lo:cell.u0, hi:cell.u1, flo:f00, fhi:f10},
        {fixed:cell.v1, axis:'u', lo:cell.u0, hi:cell.u1, flo:f01, fhi:f11},
        {fixed:cell.u0, axis:'v', lo:cell.v0, hi:cell.v1, flo:f00, fhi:f01},
        {fixed:cell.u1, axis:'v', lo:cell.v0, hi:cell.v1, flo:f10, fhi:f11}
      ];
      edges.forEach(function (edge) {
        if (!((edge.flo > 0) !== (edge.fhi > 0))) return;
        var seed = bisectEdge(tracer, target, edge.fixed, edge.axis, edge.lo, edge.hi,
          edge.flo, edge.fhi);
        if (seed && seedInside(seed)) found.push(seed);
      });
      if (found.length) { seeds = seeds.concat(found); continue; }
      if (cell.depth < maxDepth &&
          cell.u1 - cell.u0 > 1e-9 * Math.max(1, Math.abs(cell.u0)) &&
          cell.v1 - cell.v0 > 1e-9 * Math.max(1, Math.abs(cell.v0))) {
        var um = 0.5 * (cell.u0 + cell.u1), vm = 0.5 * (cell.v0 + cell.v1);
        stack.push({u0:cell.u0, u1:um, v0:cell.v0, v1:vm, depth:cell.depth + 1},
          {u0:um, u1:cell.u1, v0:cell.v0, v1:vm, depth:cell.depth + 1},
          {u0:cell.u0, u1:um, v0:vm, v1:cell.v1, depth:cell.depth + 1},
          {u0:um, u1:cell.u1, v0:vm, v1:cell.v1, depth:cell.depth + 1});
        continue;
      }
      var tangent = tangencySeed(tracer, target, cell, tolerance);
      if (tangent && seedInside(tangent)) seeds.push(tangent);
      else unresolved.push({u:[cell.u0, cell.u1], v:[cell.v0, cell.v1], depth:cell.depth,
        reason:'interval-survivor-without-seed'});
    }
    return {seeds:seeds, unresolved:unresolved, cells:cells};
  }

  function boundsScale(bounds) {
    if (!bounds) return 1;
    return Math.max(1, Math.abs(bounds.max.x - bounds.min.x), Math.abs(bounds.max.y - bounds.min.y),
      Math.abs(bounds.max.z - bounds.min.z));
  }
  function insideBounds(bounds, p, tolerance) {
    if (!bounds) return true;
    var tol = tolerance || 0;
    return p.x >= bounds.min.x - tol && p.x <= bounds.max.x + tol &&
      p.y >= bounds.min.y - tol && p.y <= bounds.max.y + tol &&
      p.z >= bounds.min.z - tol && p.z <= bounds.max.z + tol;
  }
  function paramPeriodicDistance(domain, a, b) {
    var du = Math.abs(a.u - b.u), dv = Math.abs(a.v - b.v);
    if (domain.periodicU) {
      var widthU = domain.u[1] - domain.u[0];
      if (widthU > 0) du = Math.min(du, Math.abs(widthU - du));
    }
    if (domain.periodicV) {
      var widthV = domain.v[1] - domain.v[0];
      if (widthV > 0) dv = Math.min(dv, Math.abs(widthV - dv));
    }
    return Math.hypot(du, dv);
  }
  function boundaryOnBounds(tracer, target, current, candidate, bounds) {
    if (!bounds) return null;
    var currentWorld = paramPoint(tracer, current.u, current.v);
    var candidateWorld = paramPoint(tracer, candidate.u, candidate.v);
    if (!currentWorld || !candidateWorld) return null;
    var axis = null, planeValue = null;
    ['x', 'y', 'z'].some(function (name) {
      var lo = bounds.min[name], hi = bounds.max[name];
      if (candidateWorld[name] > hi && currentWorld[name] <= hi) {
        axis = name; planeValue = hi; return true;
      }
      if (candidateWorld[name] < lo && currentWorld[name] >= lo) {
        axis = name; planeValue = lo; return true;
      }
      return false;
    });
    if (!axis) return null;
    var u = current.u, v = current.v;
    var tolerance = 1e-10 * Math.max(1, boundsScale(bounds));
    var converged = false;
    for (var i = 0; i < 24; i++) {
      var evaluated = paramGradient(tracer, target, u, v);
      if (!evaluated) break;
      var partial = paramPartial(tracer, u, v);
      if (!partial) break;
      var g1 = evaluated.g;
      var g2 = evaluated.point[axis] - planeValue;
      if (Math.abs(g1) <= tolerance && Math.abs(g2) <= tolerance) { converged = true; break; }
      var a = evaluated.gu, b = evaluated.gv;
      var c = partial.u[axis], d = partial.v[axis];
      var determinant = a * d - b * c;
      if (Math.abs(determinant) <= 1e-14 *
          Math.max(Number.MIN_VALUE, Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)))
        break;
      var deltaU = (-g1 * d + b * g2) / determinant;
      var deltaV = (-a * g2 + c * g1) / determinant;
      u += deltaU; v += deltaV;
      if (!Number.isFinite(u) || !Number.isFinite(v)) break;
    }
    var world = paramPoint(tracer, u, v);
    var evaluatedFinal = paramGradient(tracer, target, u, v);
    var inside = world && ['x', 'y', 'z'].every(function (name) {
      return world[name] >= bounds.min[name] - tolerance && world[name] <= bounds.max[name] + tolerance;
    });
    var residual = evaluatedFinal ? Math.abs(evaluatedFinal.g) : Infinity;
    if (!inside || residual > tolerance * 100) return {verified:false, u:u, v:v, residual:residual};
    return {verified:true, u:u, v:v, residual:residual, axis:axis, planeValue:planeValue};
  }
  function traceDirection(tracer, target, domain, seed, direction, options, bounds) {
    var spanU = domain.u[1] - domain.u[0], spanV = domain.v[1] - domain.v[0];
    var scale = Math.max(1, spanU, spanV);
    var worldStep = options.worldStep || boundsScale(bounds) / 160;
    var minStep = 1e-9 * scale, maxStep = 0.02 * scale;
    var fieldScale = Math.max(Number.MIN_VALUE,
      termsScale(target.terms, 1 + boundsScale(bounds)));
    var residualTolerance = options.residualTolerance !== undefined ?
      options.residualTolerance : 1e-8 * fieldScale;
    var gradTolerance = 1e-12 * fieldScale;
    var singularTolerance = Math.max(gradTolerance, 1e-7 * fieldScale);
    var boundTolerance = 1e-9 * boundsScale(bounds);
    var seedWorld = paramPoint(tracer, seed.u, seed.v);
    if (bounds && (!seedWorld || !insideBounds(bounds, seedWorld, boundTolerance)))
      return {points:[], closed:false, stopped:'bounds', singular:false, steps:0};
    var points = [], current = {u:seed.u, v:seed.v};
    var closed = false, stopped = 'budget', singular = false, stepCount = 0;
    var maxPoints = options.maxPoints || 2000;
    var seedEvaluation = paramGradient(tracer, target, seed.u, seed.v);
    var previousTangent = seedEvaluation && Math.hypot(seedEvaluation.gu, seedEvaluation.gv) > 0 ?
      {u:-seedEvaluation.gv / Math.hypot(seedEvaluation.gu, seedEvaluation.gv),
        v:seedEvaluation.gu / Math.hypot(seedEvaluation.gu, seedEvaluation.gv)} : null;
    for (var step = 0; step < maxPoints; step++) {
      var evaluated = paramGradient(tracer, target, current.u, current.v);
      if (!evaluated) { stopped = 'evaluation'; break; }
      var gradNorm = Math.hypot(evaluated.gu, evaluated.gv);
      if (gradNorm <= singularTolerance) {
        singular = true; stopped = 'singular';
        points.push(current);
        break;
      }
      var tu = -evaluated.gv / gradNorm * direction;
      var tv = evaluated.gu / gradNorm * direction;
      var velocity = vadd(vmul(evaluated.partial.u, tu), vmul(evaluated.partial.v, tv));
      var speed = vlen(velocity);
      if (!(speed > 1e-14)) { stopped = 'zero-speed'; break; }
      var stepSize = clamp(worldStep / speed, minStep, maxStep);
      var rawU = current.u + tu * stepSize, rawV = current.v + tv * stepSize;
      if (!domain.periodicV &&
          (rawV < domain.v[0] - 1e-12 || rawV > domain.v[1] + 1e-12)) {
        var boundV = rawV < domain.v[0] ? domain.v[0] : domain.v[1];
        var fraction = Math.abs(rawV - current.v) > 0 ? (boundV - current.v) / (rawV - current.v) : 0;
        var edgeU = current.u + (rawU - current.u) * fraction;
        if (domain.periodicU) {
          var edgeWidth = domain.u[1] - domain.u[0];
          edgeU = domain.u[0] + ((edgeU - domain.u[0]) % edgeWidth + edgeWidth) % edgeWidth;
        }
        var edgePoint = {u:edgeU, v:boundV};
        for (var edgeStep = 0; edgeStep < 10; edgeStep++) {
          var edgeEval = paramGradient(tracer, target, edgePoint.u, edgePoint.v);
          if (!edgeEval || !(Math.abs(edgeEval.gu) > 1e-14)) break;
          edgePoint.u -= edgeEval.g / edgeEval.gu;
          if (domain.periodicU) {
            var edgeSpan = domain.u[1] - domain.u[0];
            edgePoint.u = domain.u[0] + ((edgePoint.u - domain.u[0]) % edgeSpan + edgeSpan) % edgeSpan;
          } else {
            edgePoint.u = Math.max(domain.u[0], Math.min(domain.u[1], edgePoint.u));
          }
          if (Math.abs(edgeEval.g) <= residualTolerance) break;
        }
        var edgeCheck = paramGradient(tracer, target, edgePoint.u, edgePoint.v);
        points.push(edgePoint);
        stopped = edgeCheck && Math.abs(edgeCheck.g) <= residualTolerance * 8 &&
          domainContains(domain, edgePoint.u, edgePoint.v, 1e-12) ?
          'domain-boundary' : 'domain-boundary-unresolved';
        break;
      }
      if (domain.periodicU && (rawU < domain.u[0] || rawU > domain.u[1])) {
        var seamU = rawU < domain.u[0] ? domain.u[0] : domain.u[1];
        var seamFraction = Math.abs(rawU - current.u) > 0 ? (seamU - current.u) / (rawU - current.u) : 0;
        var seamV = current.v + (rawV - current.v) * seamFraction;
        var vTolerance = 1e-6 * Math.max(1, spanV);
        if (Math.abs(seamV - domain.v[0]) <= vTolerance || Math.abs(seamV - domain.v[1]) <= vTolerance) {
          var seamBound = Math.abs(seamV - domain.v[0]) <= vTolerance ? domain.v[0] : domain.v[1];
          var seamPoint = {u:seamU, v:seamBound};
          for (var seamStep = 0; seamStep < 10; seamStep++) {
            var seamEval = paramGradient(tracer, target, seamPoint.u, seamPoint.v);
            if (!seamEval || !(Math.abs(seamEval.gv) > 1e-14)) break;
            seamPoint.v -= seamEval.g / seamEval.gv;
            seamPoint.v = Math.max(domain.v[0], Math.min(domain.v[1], seamPoint.v));
            if (Math.abs(seamEval.g) <= residualTolerance) break;
          }
          var seamCheck = paramGradient(tracer, target, seamPoint.u, seamPoint.v);
          points.push(seamPoint);
          stopped = seamCheck && Math.abs(seamCheck.g) <= residualTolerance * 8 &&
            domainContains(domain, seamPoint.u, seamPoint.v, 1e-12) ?
            'domain-boundary' : 'domain-boundary-unresolved';
          break;
        }
      }
      var accepted = null, acceptedEval = null;
      for (var attempt = 0; attempt < 8; attempt++) {
        var candidate = domainWrap(domain, current.u + tu * stepSize, current.v + tv * stepSize);
        if (!domainContains(domain, candidate.u, candidate.v, 1e-12)) break;
        var candidateEval = paramGradient(tracer, target, candidate.u, candidate.v);
        if (!candidateEval) break;
        for (var correction = 0; correction < 6; correction++) {
          var gNorm2 = candidateEval.gu * candidateEval.gu + candidateEval.gv * candidateEval.gv;
          if (!(gNorm2 > 0)) break;
          var deltaU = -candidateEval.g * candidateEval.gu / gNorm2;
          var deltaV = -candidateEval.g * candidateEval.gv / gNorm2;
          candidate = domainWrap(domain, candidate.u + deltaU, candidate.v + deltaV);
          if (!domainContains(domain, candidate.u, candidate.v, 1e-12)) {
            candidateEval = null; break;
          }
          candidateEval = paramGradient(tracer, target, candidate.u, candidate.v);
          if (!candidateEval) break;
          if (Math.abs(candidateEval.g) <= residualTolerance) break;
        }
        if (candidateEval && Math.abs(candidateEval.g) <= residualTolerance * 8) {
          var candidateNorm = Math.hypot(candidateEval.gu, candidateEval.gv);
          if (!(candidateNorm > 0)) { stepSize *= 0.5; continue; }
          var candidateTangent = {u:-candidateEval.gv / candidateNorm,
            v:candidateEval.gu / candidateNorm};
          if (previousTangent) {
            var turn = Math.abs(previousTangent.u * candidateTangent.u +
              previousTangent.v * candidateTangent.v);
            if (turn < 0.9) { stepSize *= 0.5; continue; }
          }
          accepted = candidate; acceptedEval = candidateEval;
          accepted.tangent = candidateTangent;
          break;
        }
        stepSize *= 0.5;
      }
      if (!accepted || !acceptedEval) { stopped = 'correction'; break; }
      if (!insideBounds(bounds, acceptedEval.point, boundTolerance)) {
        var boundary = boundaryOnBounds(tracer, target, current, accepted, bounds);
        if (boundary && boundary.verified) {
          points.push({u:boundary.u, v:boundary.v});
          stopped = 'bounds';
        } else stopped = 'bounds-unresolved';
        break;
      }
      var targetMargin = constraintMargin(target, acceptedEval.point);
      if (targetMargin < 0) {
        var previousPoint = paramPoint(tracer, current.u, current.v);
        if (previousPoint && constraintMargin(target, previousPoint) >= 0) {
          var lo = 0, hi = 1, boundary = null;
          for (var bisect = 0; bisect < 36; bisect++) {
            var mid = 0.5 * (lo + hi);
            var mu = domainWrap(domain, current.u + (accepted.u - current.u) * mid,
              current.v + (accepted.v - current.v) * mid);
            var mp = paramPoint(tracer, mu.u, mu.v);
            if (mp && constraintMargin(target, mp) >= 0) lo = mid; else hi = mid;
          }
          var finalU = domainWrap(domain, current.u + (accepted.u - current.u) * lo,
            current.v + (accepted.v - current.v) * lo);
          boundary = finalU;
          if (boundary) points.push(boundary);
        }
        stopped = 'domain-boundary';
        break;
      }
      current = accepted;
      previousTangent = accepted.tangent;
      stepCount++;
      points.push({u:current.u, v:current.v});
      var du = Math.abs(current.u - seed.u);
      if (domain.periodicU) du = Math.min(du, Math.abs(spanU - du));
      var dv = Math.abs(current.v - seed.v);
      if (domain.periodicV) dv = Math.min(dv, Math.abs(spanV - dv));
      if (stepCount > 8 && paramPeriodicDistance(domain, current, seed) <= stepSize * 0.6) {
        closed = true; stopped = 'closed'; break;
      }
    }
    return {points:points, closed:closed, stopped:stopped, singular:singular, steps:stepCount};
  }
  function traceComponent(tracer, target, domain, seed, options, bounds) {
    var forward = traceDirection(tracer, target, domain, seed, 1, options, bounds);
    if (forward.closed)
      return {points:cleanTracePoints(tracer, target, domain, seed, forward.points, options, bounds),
        closed:true, forward:forward, backward:{points:[], stopped:'not-needed', steps:0,
          singular:false, closed:false}};
    var backward = traceDirection(tracer, target, domain, seed, -1, options, bounds);
    if (backward.closed)
      return {points:cleanTracePoints(tracer, target, domain, seed, backward.points, options, bounds),
        closed:true, forward:{points:[], stopped:'not-needed', steps:0, singular:false,
          closed:false}, backward:backward};
    var raw = backward.points.slice().reverse().concat([{u:seed.u, v:seed.v}], forward.points);
    return {points:cleanTracePoints(tracer, target, domain, seed, raw, options, bounds),
      closed:false, forward:forward, backward:backward};
  }
  function clampToWorldBounds(bounds, world, tolerance) {
    if (!bounds) return world;
    var tol = tolerance || 0, out = point(world);
    if (!out) return null;
    var valid = true;
    ['x', 'y', 'z'].forEach(function (axis) {
      if (!valid) return;
      var lo = axis === 'x' ? bounds.min.x : axis === 'y' ? bounds.min.y : bounds.min.z;
      var hi = axis === 'x' ? bounds.max.x : axis === 'y' ? bounds.max.y : bounds.max.z;
      if (out[axis] < lo - tol || out[axis] > hi + tol) { valid = false; return; }
      out[axis] = Math.max(lo, Math.min(hi, out[axis]));
    });
    return valid ? out : null;
  }
  function cleanTracePoints(tracer, target, domain, seed, points, options, bounds) {
    var cleaned = [];
    points.forEach(function (p) {
      if (!Number.isFinite(p.u) || !Number.isFinite(p.v)) return;
      var world = clampToWorldBounds(bounds, paramPoint(tracer, p.u, p.v),
        1e-10 * boundsScale(bounds));
      if (!world) return;
      var last = cleaned[cleaned.length - 1];
      if (last && vlen(vsub(world, last.point)) <= 1e-12 * Math.max(1, boundsScale(bounds))) return;
      cleaned.push({u:p.u, v:p.v, point:world});
    });
    return cleaned;
  }
  function paramTangentUnit(tracer, target, u, v) {
    var evaluated = paramGradient(tracer, target, u, v);
    if (!evaluated) return null;
    var norm = Math.hypot(evaluated.gu, evaluated.gv);
    if (!(norm > 0)) return null;
    return {u:-evaluated.gv / norm, v:evaluated.gu / norm};
  }
  function normalizeForSolver(eq) {
    function maxAbs(terms) {
      var m = 0;
      terms.forEach(function (t) { m = Math.max(m, Math.abs(t[0])); });
      return m;
    }
    var coefficient = maxAbs(eq.terms);
    if (!(coefficient > 0)) return eq;
    var out = cloneEquation(eq);
    out.terms = eq.terms.map(function (t) { return [t[0] / coefficient, t[1], t[2], t[3]]; });
    out.constraints = (eq.constraints || []).map(function (c) {
      if (c.kind !== 'inequality') return cloneConstraint(c);
      var scale = maxAbs(c.terms);
      var cloned = cloneConstraint(c);
      if (scale > 0) cloned.terms = c.terms.map(function (t) {
        return [t[0] / scale, t[1], t[2], t[3]];
      });
      return cloned;
    });
    out.degree = termsDegree(out.terms);
    return out;
  }
  function traceIntersection(a, b, options) {
    options = options || {};
    if (!equationIsValid(a) || !equationIsValid(b))
      return {contract:INTERSECTION_CONTRACT, kind:'implicit-display', status:'invalid',
        method:'implicit-interval-trace', curves:[], diagnostics:[{code:'implicit-invalid-equation',
          severity:'error', message:'Both equations must be valid implicit polynomial records.'}],
        topologyCertified:false, confidence:'none'};
    var coincidence = proportionalEquation(a, b, options);
    if (coincidence.coincident)
      return {contract:INTERSECTION_CONTRACT, kind:'implicit-display', status:'coincident',
        method:'relative-proportional-polynomial', curves:[], unresolved:[],
        topologyCertified:false, confidence:'algebraic-proportional',
        diagnostic:{code:'implicit-coincident-supports', severity:'info',
          message:'The two supports are proportional; their intersection is a domain overlap, not a curve.'}};
    a = normalizeForSolver(a);
    b = normalizeForSolver(b);
    var bounds = options.bounds ? boundsForPair(a, b, options) : boundsForPair(a, b, options);
    var tracer = null, target = null;
    var domainA = null, domainB = null;
    if (options.tracerSurface === 1) {
      domainB = paramDomain(b, {bounds:bounds, paramDomain:options.paramDomain});
      if (domainB) { tracer = b; target = a; }
    } else {
      domainA = paramDomain(a, {bounds:bounds, paramDomain:options.paramDomain});
      if (domainA) { tracer = a; target = b; }
      else {
        domainB = paramDomain(b, {bounds:bounds, paramDomain:options.paramDomain});
        if (domainB) { tracer = b; target = a; }
      }
    }
    if (!tracer) {
      var chartStatus = [paramChartStatus(a), paramChartStatus(b)];
      if (chartStatus.indexOf('inconsistent') !== -1)
        return {contract:INTERSECTION_CONTRACT, kind:'implicit-display', status:'unresolved',
          method:'implicit-interval-trace', curves:[], unresolved:[{reason:'param-chart-inconsistent',
            surfaces:chartStatus}], topologyCertified:false,
          diagnostics:[{code:'implicit-param-chart-inconsistent', severity:'warning',
            message:'A parameter chart does not reproduce its polynomial equation; no display curve is claimed.'}],
          bounds:bounds, confidence:'none'};
      return {contract:INTERSECTION_CONTRACT, kind:'implicit-display', status:'unbounded',
        method:'implicit-interval-trace', curves:[], unresolved:[],
        topologyCertified:false, diagnostics:[{code:'implicit-display-unbounded', severity:'warning',
          message:'A finite parameter or world bound is required for numerical display curves.'}],
        bounds:bounds, confidence:'none'};
    }
    var domain = tracer === a ? domainA : domainB;
    var diagnostics = [];
    var scan = findSeeds(tracer, target, domain, options, diagnostics, bounds);
    var curves = [], unresolved = scan.unresolved.slice();
    var tracedSamples = [];
    var spanU = domain.u[1] - domain.u[0], spanV = domain.v[1] - domain.v[0];
    var skipTolerance = 0.01 * Math.max(spanU, spanV);
    scan.seeds.forEach(function (seed) {
      var seedTangent = paramTangentUnit(tracer, target, seed.u, seed.v);
      var covered = tracedSamples.some(function (sample) {
        var distance = paramPeriodicDistance(domain, seed, sample);
        if (distance > skipTolerance) return false;
        if (!seedTangent || !sample.tangent) return true;
        var alignment = Math.abs(seedTangent.u * sample.tangent.u +
          seedTangent.v * sample.tangent.v);
        return alignment > 0.9;
      });
      if (covered) return;
      var component = traceComponent(tracer, target, domain, seed, options, bounds);
      if (!component.points.length) return;
      component.points.forEach(function (p, index) {
        var previous = component.points[Math.max(0, index - 1)];
        var next = component.points[Math.min(component.points.length - 1, index + 1)];
        var tu = next.u - previous.u, tv = next.v - previous.v;
        var norm = Math.hypot(tu, tv);
        tracedSamples.push({u:p.u, v:p.v,
          tangent:norm > 0 ? {u:tu / norm, v:tv / norm} : null});
      });
      var residualMax = 0, residualSum = 0, invalid = 0;
      var worldPoints = component.points.map(function (p) {
        var residuals = surfaceResiduals(a, b, p.point);
        var residual = Math.max(residuals.a, residuals.b);
        residualMax = Math.max(residualMax, residual);
        residualSum += residual;
        if (!Number.isFinite(residual)) invalid++;
        return point(p.point);
      });
      var singular = component.forward.singular || component.backward.singular;
      var allowedStop = {closed:true, bounds:true, 'domain-boundary':true, 'not-needed':true};
      if (!allowedStop[component.forward.stopped])
        unresolved.push({reason:'trace-' + component.forward.stopped,
          seed:{u:seed.u, v:seed.v}, direction:1});
      if (!allowedStop[component.backward.stopped])
        unresolved.push({reason:'trace-' + component.backward.stopped,
          seed:{u:seed.u, v:seed.v}, direction:-1});
      if (singular)
        unresolved.push({reason:'singular-contact', seed:{u:seed.u, v:seed.v},
          point:worldPoints[0] || null});
      if (invalid)
        unresolved.push({reason:'invalid-residual', seed:{u:seed.u, v:seed.v}});
      curves.push({kind:'polyline', points:worldPoints, closed:component.closed,
        parameterStart:component.points[0] || null,
        parameterEnd:component.points[component.points.length - 1] || null,
        method:'implicit-interval-trace', confidence:'numeric', topologyCertified:false,
        residual:{max:residualMax, mean:residualSum / Math.max(1, worldPoints.length)},
        invalidResiduals:invalid, trace:{stopped:component.forward.stopped,
          backwardStopped:component.backward.stopped,
          singular:singular,
          steps:component.forward.steps + component.backward.steps},
        sourceIds:uniqueStrings((tracer.identity && tracer.identity.sourceIds || [])
          .concat(target.identity && target.identity.sourceIds || []))});
    });
    var uTolerance = 1e-6 * Math.max(1, spanU), vTolerance = 1e-6 * Math.max(1, spanV);
    unresolved = unresolved.filter(function (entry) {
      if (entry.reason !== 'interval-survivor-without-seed') return true;
      var atSeam = domain.periodicU && (
        Math.abs(entry.u[0] - domain.u[0]) <= uTolerance ||
        Math.abs(entry.u[1] - domain.u[1]) <= uTolerance ||
        Math.abs(entry.u[1] - domain.u[0]) <= uTolerance ||
        Math.abs(entry.u[0] - domain.u[1]) <= uTolerance);
      var atBoundary = !domain.periodicV && (
        Math.abs(entry.v[0] - domain.v[0]) <= vTolerance ||
        Math.abs(entry.v[1] - domain.v[1]) <= vTolerance);
      if (!atSeam || !atBoundary) return true;
      var width = domain.u[1] - domain.u[0];
      return !curves.some(function (curve) {
        if (curve.closed || !curve.trace ||
            (curve.trace.stopped !== 'domain-boundary' &&
             curve.trace.backwardStopped !== 'domain-boundary')) return false;
        return [curve.parameterStart, curve.parameterEnd].some(function (p) {
          if (!p) return false;
          if (p.v < entry.v[0] - vTolerance || p.v > entry.v[1] + vTolerance) return false;
          return [p.u, p.u + width, p.u - width].some(function (candidateU) {
            return candidateU >= entry.u[0] - uTolerance &&
              candidateU <= entry.u[1] + uTolerance;
          });
        });
      });
    });
    var status = curves.length ? (unresolved.length ? 'partial' : 'ok') :
      (unresolved.length ? 'unresolved' : 'none');
    var totalPoints = 0, closedCurves = 0, maxResidual = 0;
    curves.forEach(function (curve) {
      totalPoints += curve.points.length;
      if (curve.closed) closedCurves++;
      maxResidual = Math.max(maxResidual, curve.residual.max);
    });
    var result = {contract:INTERSECTION_CONTRACT, kind:'implicit-display', status:status,
      method:'implicit-interval-trace', curves:curves, unresolved:unresolved,
      summary:{curves:curves.length, closed:closedCurves, points:totalPoints,
        maxResidual:maxResidual, residualOk:maxResidual <= 1e-4},
      tracer:{surfaceId:tracer.identity && tracer.identity.surfaceId, kind:tracer.kind},
      target:{surfaceId:target.identity && target.identity.surfaceId, kind:target.kind},
      bounds:bounds, parameters:{domain:domain, grid:{u:options.gridU || 10, v:options.gridV || 10},
        maxCells:options.maxCells || 4096, seedDepth:options.seedDepth === undefined ? 6 : options.seedDepth},
      coverage:{cells:scan.cells, seeds:scan.seeds.length, curves:curves.length,
        unresolved:unresolved.length, complete:false, uncertain:true,
        note:'numeric display coverage; topology is not certified'},
      topologyCertified:false, guarantee:'numeric-display', confidence:'numeric',
      sourceIds:uniqueStrings((tracer.identity && tracer.identity.sourceIds || [])
        .concat(target.identity && target.identity.sourceIds || []))};
    if (!curves.length && !unresolved.length)
      result.proven = {empty:true, method:'interval-exclusion-parameter-domain',
        guarantee:'numeric-interval-exclusion', topologyCertified:false};
    if (unresolved.length)
      result.diagnostic = {code:'implicit-display-unresolved', severity:'warning',
        message:'Some parameter cells survived interval pruning without a verified seed; they are retained as unresolved coverage.'};
    return result;
  }
  function traceResult(result, options) {
    if (!result || !Array.isArray(result.equations) || result.equations.length !== 2) return null;
    var a = normalizeEquation(result.equations[0]);
    var b = normalizeEquation(result.equations[1]);
    if (!a || !b) return null;
    var merged = Object.assign({}, options || {});
    if (!merged.bounds && result.bounds) merged.bounds = result.bounds;
    return traceIntersection(a, b, merged);
  }
  function planeEquation(plane) {
    if (!plane || !point(plane.origin) || !point(plane.normal)) return null;
    return equationOf({kind:'plane', origin:plane.origin, normal:plane.normal,
      u:plane.u, v:plane.v}, {declared:true});
  }
  function planeSection(eq, plane, options) {
    var planeEq = planeEquation(plane);
    if (!planeEq) return null;
    var intersection = algebraicIntersection(eq, planeEq, options || {});
    var display = traceIntersection(normalizeEquation(eq), planeEq,
      Object.assign({}, options || {}, {tracerSurface:0}));
    return {contract:INTERSECTION_CONTRACT, kind:'implicit-section',
      algebraic:intersection, display:display, topologyCertified:false,
      method:'implicit-polynomial-section', sourceIds:uniqueStrings(
        (eq.identity && eq.identity.sourceIds || []).concat(
          (plane.sourceIds || []).slice()))};
  }

  function volumeConstraints(volume) {
    if (!volume || typeof volume !== 'object') return null;
    var constraints = [], frame;
    if (volume.kind === 'cylinder') {
      if (!point(volume.origin) || !point(volume.axis) || !(volume.radius > 0) ||
          !(volume.depth > 0)) return null;
      frame = makeFrame(volume.origin, volume.axis);
      if (!frame) return null;
      constraints.push({frame:frame, terms:[[1, 2, 0, 0], [1, 0, 2, 0],
        [-volume.radius * volume.radius, 0, 0, 0]], op:'<=', label:'cylinder-side'});
      constraints.push({frame:frame, terms:[[1, 0, 0, 1]], op:'>=', label:'cylinder-min'});
      constraints.push({frame:frame, terms:[[1, 0, 0, 1], [-volume.depth, 0, 0, 0]], op:'<=',
        label:'cylinder-max'});
    } else if (volume.kind === 'cone') {
      if (!point(volume.origin) || !point(volume.axis) || !(volume.radius >= 0) ||
          !(volume.depth > 0)) return null;
      frame = makeFrame(volume.origin, volume.axis);
      if (!frame) return null;
      var start = volume.radius;
      var end = Number.isFinite(volume.bottomRadius) ? volume.bottomRadius : start;
      var slope = (end - start) / volume.depth;
      var terms = [[1, 2, 0, 0], [1, 0, 2, 0], [-slope * slope, 0, 0, 2],
        [-2 * start * slope, 0, 0, 1], [-start * start, 0, 0, 0]];
      constraints.push({frame:frame, terms:terms, op:'<=', label:'cone-side'});
      constraints.push({frame:frame, terms:[[1, 0, 0, 1]], op:'>=', label:'cone-min'});
      constraints.push({frame:frame, terms:[[1, 0, 0, 1], [-volume.depth, 0, 0, 0]], op:'<=',
        label:'cone-max'});
    } else if (volume.kind === 'sphere') {
      if (!point(volume.center) || !(volume.radius > 0)) return null;
      frame = makeFrame(volume.center, vec(0, 0, 1), vec(1, 0, 0), vec(0, 1, 0));
      if (!frame) return null;
      constraints.push({frame:frame, terms:[[1, 2, 0, 0], [1, 0, 2, 0], [1, 0, 0, 2],
        [-volume.radius * volume.radius, 0, 0, 0]], op:'<=', label:'sphere-ball'});
      if (point(volume.mouthCenter) && point(volume.outward)) {
        var outward = vunit(volume.outward);
        if (outward) {
          var offset = -vdot(outward, vsub(volume.mouthCenter, volume.center));
          constraints.push({frame:frame,
            terms:[[outward.x, 1, 0, 0], [outward.y, 0, 1, 0], [outward.z, 0, 0, 1],
              [offset, 0, 0, 0]], op:'<=', label:'sphere-mouth'});
        }
      }
    } else return null;
    return {frame:frame, constraints:constraints, method:'volume-polynomial-constraints',
      exactness:'analytic-inequalities'};
  }
  function restrictTermsToLine(frame, terms, line) {
    var x0 = vdot(frame.u, vsub(line.origin, frame.origin));
    var y0 = vdot(frame.v, vsub(line.origin, frame.origin));
    var z0 = vdot(frame.w, vsub(line.origin, frame.origin));
    var dx = vdot(frame.u, line.direction);
    var dy = vdot(frame.v, line.direction);
    var dz = vdot(frame.w, line.direction);
    var coeffs = [], magnitude = 0;
    terms.forEach(function (t) {
      var c = t[0], a = t[1], b = t[2], d = t[3];
      for (var i = 0; i <= a; i++) for (var j = 0; j <= b; j++) for (var k = 0; k <= d; k++) {
        var power = i + j + k;
        var value = c * BINOMIAL[a][i] * BINOMIAL[b][j] * BINOMIAL[d][k] *
          Math.pow(x0, a - i) * Math.pow(y0, b - j) * Math.pow(z0, d - k) *
          Math.pow(dx, i) * Math.pow(dy, j) * Math.pow(dz, k);
        coeffs[power] = (coeffs[power] || 0) + value;
        magnitude += Math.abs(value);
      }
    });
    for (var n = 0; n < coeffs.length; n++) if (coeffs[n] === undefined) coeffs[n] = 0;
    while (coeffs.length > 1 && coeffs[coeffs.length - 1] === 0) coeffs.pop();
    var scale = Math.max.apply(null, coeffs.map(Math.abs));
    return {coefficients:coeffs, scale:scale, magnitude:magnitude,
      constant:coeffs.length === 1, degree:coeffs.length - 1};
  }
  function mergeIntervals(intervals) {
    var sorted = intervals.slice().sort(function (a, b) { return a.start - b.start; });
    var out = [];
    sorted.forEach(function (interval) {
      if (interval.end < interval.start) return;
      var last = out[out.length - 1];
      if (last && interval.start <= last.end + 1e-12 * Math.max(1, Math.abs(last.end)))
        last.end = Math.max(last.end, interval.end);
      else out.push({start:interval.start, end:interval.end});
    });
    return out;
  }
  function intersectInterval(a, b) {
    return {start:Math.max(a.start, b.start), end:Math.min(a.end, b.end)};
  }
  function signIntervals(coeffs, op, options) {
    options = options || {};
    var bound = rootBound(coeffs) || 1;
    var pad = bound + 1;
    var searchLo = Number.isFinite(options.tMin) ? options.tMin : -pad;
    var searchHi = Number.isFinite(options.tMax) ? options.tMax : pad;
    var roots = isolateRoots(coeffs, searchLo, searchHi, options);
    if (roots.unresolved) return {unresolved:true, reason:roots.reason || 'root-isolation',
      intervals:[]};
    var cuts = roots.roots.map(function (root) { return root.t; })
      .filter(function (t) { return t > searchLo && t < searchHi; });
    cuts.sort(function (a, b) { return a - b; });
    var breaks = [Number.isFinite(options.tMin) ? options.tMin : -Infinity]
      .concat(cuts)
      .concat([Number.isFinite(options.tMax) ? options.tMax : Infinity]);
    var intervals = [];
    for (var i = 0; i < breaks.length - 1; i++) {
      var a = breaks[i], b = breaks[i + 1];
      if (!(b > a) && !(a === -Infinity && b === Infinity)) continue;
      var value;
      if (coeffs.length === 1) value = coeffs[0];
      else {
        var test;
        if (a === -Infinity) test = Number.isFinite(b) ? b - pad : -pad;
        else if (b === Infinity) test = Number.isFinite(a) ? a + pad : pad;
        else test = 0.5 * (a + b);
        value = polyEvalPower(coeffs, test);
      }
      var holds = op === '<=' ? value <= 0 : op === '>=' ? value >= 0 : Math.abs(value) === 0;
      if (holds) intervals.push({start:a, end:b});
    }
    return {unresolved:false, intervals:mergeIntervals(intervals), roots:roots,
      method:'polynomial-sign-intervals'};
  }
  function lineConstraintIntervals(constraints, line, options) {
    options = options || {};
    if (!line || !point(line.origin) || !point(line.direction)) return null;
    var working = [{start:-Infinity, end:Infinity}], unresolved = [], coincident = [];
    for (var i = 0; i < constraints.length; i++) {
      var constraint = constraints[i];
      var restriction = restrictTermsToLine(constraint.frame, constraint.terms, line);
      var ratio = restriction.magnitude > 0 ? restriction.scale / restriction.magnitude :
        (restriction.scale === 0 ? 0 : Infinity);
      if (restriction.scale === 0) {
        coincident.push(constraint.label || i);
        var constant = restriction.constant ? restriction.coefficients[0] : 0;
        var always = constraint.op === '<=' ? constant <= 0 : constraint.op === '>=' ? constant >= 0 : constant === 0;
        if (!always) return {ok:false, reason:'inconsistent-coincident-constraint',
          intervals:[], unresolved:unresolved, coincident:coincident};
        continue;
      }
      if (ratio <= 1e-7) {
        unresolved.push({label:constraint.label || i, reason:'uncertain-coincident-constraint'});
        continue;
      }
      if (restriction.degree > MAX_DEGREE) {
        unresolved.push({label:constraint.label || i, reason:'degree-exceeds-budget'});
        continue;
      }
      var domain = {tMin:options.tMin, tMax:options.tMax};
      var result = signIntervals(restriction.coefficients, constraint.op, domain);
      if (result.unresolved) {
        unresolved.push({label:constraint.label || i, reason:result.reason});
        continue;
      }
      var next = [];
      working.forEach(function (interval) {
        result.intervals.forEach(function (piece) {
          var overlap = intersectInterval(interval, piece);
          if (overlap.end >= overlap.start) next.push(overlap);
        });
      });
      working = mergeIntervals(next);
      if (!working.length) break;
    }
    if (options.tMin !== undefined || options.tMax !== undefined) {
      var lo = Number.isFinite(options.tMin) ? options.tMin : -Infinity;
      var hi = Number.isFinite(options.tMax) ? options.tMax : Infinity;
      working = mergeIntervals(working.map(function (interval) {
        return {start:Math.max(interval.start, lo), end:Math.min(interval.end, hi)};
      }).filter(function (interval) { return interval.end >= interval.start; }));
    }
    return {ok:unresolved.length === 0, intervals:working, unresolved:unresolved,
      coincident:coincident, method:'polynomial-line-constraints',
      exactness:unresolved.length ? 'partial' : 'analytic-intervals'};
  }


  return {
    CONTRACT:CONTRACT, INTERSECTION_CONTRACT:INTERSECTION_CONTRACT, VERSION:VERSION,
    equation:equationOf, normalizeEquation:normalizeEquation, serialize:serialize,
    equationIsValid:equationIsValid, evaluate:evaluate, parameterOf:parameterOf,
    constraintValue:constraintValue, constraintsHold:constraintsHold,
    restrictToLine:restrictToLine, lineIntersection:lineIntersection,
    isolateRoots:isolateRoots, proportionalEquation:proportionalEquation,
    boundsForPair:boundsForPair, algebraicIntersection:algebraicIntersection,
    equationTolerance:equationTolerance, termsDegree:termsDegree,
    polyEval:polyEval, intervalPolyEval:iintervalPolyEval,
    paramDomain:paramDomain, paramPoint:paramPoint, paramPartial:paramPartial, trace:traceIntersection,
    paramChartStatus:paramChartStatus,
    ruledConicAffineGeometry:ruledConicAffineGeometry,
    ruledConicAffineRecord:ruledConicAffineRecord,
    traceResult:traceResult, planeSection:planeSection, volumeConstraints:volumeConstraints,
    lineConstraintIntervals:lineConstraintIntervals, planeEquation:planeEquation
  };
});

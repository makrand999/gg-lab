(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADVec3 = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // Minimal 3D vector arithmetic shared by the reconstruction stages. Vectors
  // are plain {x,y,z} records, matching every geometry object in the app.
  // `unit` returns null when the input has no direction; callers that need a
  // fallback choose it explicitly. `eps`/`tol` default to EPS but call sites
  // may pass their own tolerance to keep an existing numerical boundary.
  var EPS = 1e-9;

  function add(a, b) { return {x:a.x+b.x, y:a.y+b.y, z:a.z+b.z}; }
  function sub(a, b) { return {x:a.x-b.x, y:a.y-b.y, z:a.z-b.z}; }
  function mul(a, s) { return {x:a.x*s, y:a.y*s, z:a.z*s}; }
  function dot(a, b) { return a.x*b.x + a.y*b.y + a.z*b.z; }
  function cross(a, b) {
    return {x:a.y*b.z-a.z*b.y, y:a.z*b.x-a.x*b.z, z:a.x*b.y-a.y*b.x};
  }
  function length(v) { return Math.hypot(v.x, v.y, v.z); }

  function unit(v, eps) {
    var l = length(v);
    if (l <= (eps === undefined ? EPS : eps)) return null;
    return {x:v.x/l, y:v.y/l, z:v.z/l};
  }

  function near(a, b, tol) {
    return length(sub(a, b)) <= (tol === undefined ? EPS : tol);
  }

  return {add:add, sub:sub, mul:mul, dot:dot, cross:cross,
    length:length, unit:unit, near:near};
});

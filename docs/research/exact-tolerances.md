# Robust predicates, exact arithmetic, intervals and tolerance models

Research/design note for Major's analytic surface pipeline. This round changes no
production code. It records the current certificate design, surveys how mature
systems handle robustness, and proposes an incremental tolerance and predicate
architecture for EduCAD.

Scope: `public/lib/educad-surfaces.js`, the declared exact kernel in
`public/lib/educad-strict.js`, and the certificate expectations in
`tools/scripts/*.edu`. Major2 is out of scope.

## 1. Current tolerance and certificate design

### 1.1 The three certificates

Major currently separates three claims:

| Certificate | Contract | Input | Arithmetic |
|---|---|---|---|
| Declared explicit model | `educad-explicit-v1` | declared vertices, edges, triangles | exact decimal rational |
| Inferred display triangles | `inferred-triangle-v1` | display mesh | geometric checks, triangle budget |
| Analytic surface model | `analytic-surface-certificate-v1` | bounded planes, cylinders, cones, spheres and loops | mixed exact rational + numeric tolerance |

The distinction is deliberate and should remain. The analytic certificate does
not upgrade inferred geometry to declared geometry, and it never treats display
triangles as evidence about the analytic surface. See
`docs/RECONSTRUCTION_CONTRACT.md` ("Three certificates remain distinct") and
`docs/SURFACE_MODEL.md` ("Exact versus numeric checks").

### 1.2 Exact decimal-rational checks

`public/lib/educad-surfaces.js` converts a stored JavaScript number to a
rational by reading `String(value)` as a decimal (`DECIMAL_RE`, `exactNumber`,
`exactAdd/Sub/Mul`, lines 624-696). This is exact for the stored decimal value,
not for an intended real measurement. The same convention is used by
`public/lib/educad-strict.js` (`exact`, lines 8-26).

The exact analytic checks currently cover:

- stable ids, kind, boundedness, closed-flag consistency, loop incidence and
  shell closure counts (`exact-combinatorial`);
- finiteness of points, radii and line endpoints (`exact-finiteness`);
- exactly positive radii and half-angle positivity (`exact-rational`);
- plane vertex-loop and inline-point coplanarity by a homogeneous determinant
  (`exactCoplanar`, lines 671-696);
- exact equality of a cylinder boundary radius and the stored surface radius
  when the two decimals are exactly equal (`exactNumbersEqual`, used at lines
  1114-1119).

The exact coplanarity test is homogeneous: it never normalises a plane normal,
so it does not introduce division or a hidden length scale. It finds a
non-coincident pair, then a non-collinear third point, builds a normal by cross
product, and requires the remaining points to satisfy `n · (p - p0) = 0`
exactly. Degenerate reasons are `fewer-than-three`, `non-finite`, `coincident`
and `collinear`.

The declared kernel goes further: constraint equality, affine inversion, edge
degeneracy, triangle collinearity, segment/triangle intersection and signed
volume all use exact rational arithmetic (`educad-strict.js`, lines 8-89 and
146-155). Its contract is explicit that a stored `0.30000000000000004` conflicts
with a stored `0.3`, and that no welding radius or rounding-to-match exists
(`docs/RECONSTRUCTION_CONTRACT.md`, "Arithmetic and result semantics").

### 1.3 Numeric checks and their constants

The analytic certificate and its `.edu` verification use four different numeric scales:

| Constant / helper | Value | Used for |
|---|---|---|
| `EPS` | `1e-7` | unit vector/axis/frame checks, parallel-plane guard, sphere-section near-tangency, many split guards |
| `surfaceTolerance(s)` | `1e-5 * max(1, abs(radius))` | boundary-on-surface samples, cone apex/axis relations, line length, cylinder section/radius/axis, attachment |
| `tolerance(values)` | `1e-6 * max(1, max abs(value))` | sphere/cylinder pair classification and coincidence |
| `.edu` expectation match | `1e-6 * max(1, abs(expected))` | recursive subset comparison in `tools/edc.js` |

`docs/SURFACE_MODEL.md` says "Tolerances are relative (`1e-6` of the largest
relevant radius or distance)" in its intersection section, but the certificate's
`surfaceTolerance` is `1e-5`. The documentation and the implementation do not
agree on one scale.

Relevant code:

- `surfaceTolerance` at lines 709-712;
- `surfaceResidual` at lines 713-734;
- `sampleBoundaryCurve` at lines 764-770, called with 32 intervals (33 samples)
  at lines 1048-1056;
- plane coplanarity fallback at lines 979-1003;
- boundary-on-surface accumulation at lines 1030-1104;
- cylinder boundary checks at lines 1106-1149;
- intersection tolerance at lines 1409-1415;
- `planePlane`, `sphereSphere`, `cylinderCylinder`, `sphereCylinder` at lines
  1433-1553;
- split guards at lines 1743-1817, including `1e-10` parameter and
  `1e-12 * scale` midpoint tests.

The certificate records `residual` and `tolerance` on numeric checks and labels
the arithmetic `numeric`, `numeric-sampled`, `numeric-section`,
`numeric-direction` or `numeric-fallback`. It counts `exactChecks` and
`numericChecks`. It does **not** record a proof that a sampled maximum is a
bound on the unsampled curve, nor does it distinguish "passed by exact proof"
from "passed because the sample residual happened to be small". The top-level
`arithmetic` field is always `mixed-exact-rational-and-numeric`.

### 1.4 What the current certificate actually claims

A check with `arithmetic: 'numeric'` means "the computed residual is at most the
stated tolerance". It does not mean:

- that the residual is an upper bound for every point of a boundary curve;
- that the tolerance is derived from a floating-point error bound;
- that a near-tangent or near-coincident configuration is geometrically
  distinguishable;
- that an exact predicate that failed because of decimal construction noise has
  been proved.

The sampling is a useful regression signal. It is not a proof for a curved
boundary. For a straight line on a quadric, the implicit residual is a
polynomial of degree at most two, so three distinct samples can prove the whole
segment, provided the samples are evaluated exactly. For a circle or ellipse,
the residual is a trigonometric polynomial of degree at most two; coefficient
identities are stronger and cheaper than 33 samples.

### 1.5 Observed behaviour on small probes

The following probes used the current `Surfaces.section`, `Surfaces.intersect`
and `Surfaces.certify` directly. They are reproducible from the current code and
are the concrete motivation for the rest of this note.

| Probe | Result |
|---|---|
| plane vertex loop with one vertex `z = 1e-12` off plane | exact coplanarity fails; numeric fallback passes at `1e-5`; certificate reports `numeric`, `exactPass:false` |
| plane vertex loop with one vertex `z = 2e-5` off plane | numeric fallback fails; certificate reports `issues` |
| sphere `R=10`, plane `z = 10 + 1e-9` | `section` returns a `point` (tangent), not `none` |
| sphere `R=10`, plane `z = 10 + 1e-5` | `section` returns `null`; `intersect` returns `none` |
| sphere `R=10`, plane `z = 10 - 1e-9` | tiny `circle` of radius about `1.4e-4` |
| two spheres `r=10`, center distance `20 + 1e-5` | `intersect` still returns a tangent `point` |
| two parallel cylinders `r=10`, axis distance `20 + 1e-5` | `intersect` still returns one tangent `line` |
| two planes with angle `1e-7` rad | `intersect` returns `plane-overlap` / `coincident` |

Two problems are visible. First, a nonzero gap at `1e-5` is classified as
tangent. Second, different checks use `1e-7`, `1e-6` and `1e-5` without a stated
relationship. A near-tangent configuration should not silently become a tangent
result.

## 2. Predicate taxonomy

A predicate is a decision that affects topology or the certificate. It should
return a sign or a relation with evidence, not just a boolean computed from a
residual. The following taxonomy is the minimum vocabulary for the analytic
surface pipeline.

### 2.1 Orientation

**Definition.** For 2D points `a,b,c`, the sign of

```text
orient2d(a,b,c) = det [[ax-cx, ay-cy],
                       [bx-cx, by-cy]]
```

For 3D points `a,b,c,d`, the sign of

```text
orient3d(a,b,c,d) = det [[ax-dx, ay-dy, az-dz],
                         [bx-dx, by-dy, bz-dz],
                         [cx-dx, cy-dy, cz-dz]]
```

**Current use.** Plane normal construction (`newell`, lines 30-39), plane-frame
checks, `loopSide` (lines 1569-1604), split side classification, `curveRoots`,
patch-interior tests, and the exact triangle intersection in
`educad-strict.js`.

**Problem.** `loopSide` decides `pos`/`neg` with `d > EPS` and `d < -EPS`, where
`eps = 1e-7`. The sign of a determinant is a combinatorial fact about the stored
decimals; a tolerance turns a three-way decision into a four-way decision
(positive, negative, zero, don't-know) without saying which one it is.

**Recommendation.** Exact rational sign with a floating-point filter. The filter
computes the determinant in double and a forward error bound. If the magnitude
exceeds the bound, return the filtered sign. Otherwise evaluate the determinant
exactly as a rational (BigInt) and return the exact sign. Treat `0` as a real
third value; never replace it by a tolerance unless the caller explicitly asks
for a tolerance relation.

### 2.2 Coplanarity

**Definition.** For four points, `orient3d(a,b,c,d) = 0`. For more points, every
point lies in the plane through the first non-collinear triple. For an analytic
curve, the curve's supporting plane must be the same plane as the surface's
supporting plane.

**Current use.** `exactCoplanar` for plane vertex loops and inline points;
numeric `surfaceResidual` for curve samples. The exact test is used only for
plane loops, not for the plane of an analytic circle/ellipse boundary.

**Problem.** A plane face whose boundary is a full analytic circle can have a
circle plane that is only numerically equal to the face plane. The current
certificate samples the circle and calls it on-surface; it does not prove the
two planes coincide.

**Recommendation.** Keep the exact homogeneous determinant for point sets. For
a circle or ellipse, test the plane identity exactly:

```text
n_surface · (c - o_surface) = 0
n_surface · u = 0
n_surface · v = 0
```

where `c,u,v` define the curve's plane and `o_surface,n_surface` define the
surface. If `u,v` or `n_surface` are stored as unit vectors with floating-point
normalisation, use an interval or an exact raw direction instead; do not call
the normalised decimals exact.

### 2.3 Incidence

**Definition.** A point, segment, curve or boundary element lies on a surface
or on another element.

Incidence splits into two kinds:

- **combinatorial incidence**: the same boundary object is referenced by two
  loops, the same vertex id appears in two stations, or a loop endpoint is the
  same declared member. This is exact by identity and must never be inferred
  from coordinates.
- **geometric incidence**: a coordinate point lies on a line, plane, circle,
  ellipse, cylinder, cone or sphere. This is a polynomial or trigonometric
  identity on rational coordinates.

**Current use.** `incidence(model)` is the combinatorial graph. Geometric
incidence is `boundary-on-surface`, `cylinder-boundary-axis`,
`cylinder-boundary-section`, `cone-boundary-axis`, `attachBoundary` and
`loopStationsAt`.

**Problem.** `boundary-on-surface` is sampled. `attachBoundary` rejects a
boundary if a sample residual exceeds `surfaceTolerance`; a curve that is
off-surface only between samples is accepted. Equally, two distinct objects
with equal coordinates are not merged by the incidence graph, which is correct,
but a tolerance-based `pointsClose` is used elsewhere for split assembly.

**Recommendation.** Use exact polynomial identities for supported families:

- point on plane: `n · (p - o) = 0`;
- point on sphere: `|p - c|^2 = r^2`;
- point on cylinder: `|a|^2 |p - o|^2 - ((p - o) · a)^2 = r^2 |a|^2`;
- point on cone with slope `m = tan(halfAngle)`:
  `|a|^2 |p - A|^2 - (1 + m^2) ((p - A) · a)^2 = 0`;
- point on line/segment: cross product zero plus a parameter interval;
- point on circle/ellipse: implicit quadratic plus arc-side test.

All of these are rational if the parameters are rational. A raw axis vector
`a` is better than a normalised unit axis because it avoids the irrational
`1/|a|`.

### 2.4 Tangency

**Definition.** Two supports are tangent when they meet in a lower-dimensional
set than the transverse case: a point for plane/sphere, sphere/sphere or
cone/plane at the apex; a line for plane/cylinder containing a generator or
parallel cylinder/cylinder at external or internal contact; a circle for
sphere/cylinder when `R = r` and the axis passes through the centre.

**Current use.** `sphereSphere` checks `rho2 <= tol^2` and returns a point;
`cylinderCylinder` checks `s2 <= tol^2` and returns one line; `sphereCylinder`
checks `|h2| <= tol^2`; `section` for plane/sphere checks `rho < EPS`; section
for plane/cylinder checks `inside <= EPS`. All of these include a nonzero band
in the tangent result.

**Problem.** A gap of `1e-5` mm is classified as exact tangency for a radius-10
sphere or cylinder. The result's `relation: 'tangent'` is false as a statement
about the stored decimals. It is only "within tolerance".

**Recommendation.** Compute the discriminant or distance equality exactly
first. Then classify:

```text
gap == 0 exactly                  -> relation: 'tangent'
0 < |gap| <= tau                  -> relation: 'near-tangent', with signed gap
|gap| > tau                       -> transverse / separate / contained
```

`near-tangent` should retain the actual branch (`none`, `point`, `circle`,
`line`, `lines`) and the signed gap. It must never be reported as `tangent`.
This is the single most important behavioural change for pathological tests.

### 2.5 Coincidence

**Definition.** Two supports coincide when they are the same set, independent of
parameterisation:

- planes: normals parallel and one origin lies in the other plane;
- spheres: equal centres and equal radii;
- cylinders: parallel axes, equal radii, and the origin offset is parallel to
  the axis;
- cones: equal apexes, parallel axes and equal slopes (with nappe handling);
- circles/ellipses: same centre, same supporting plane, same semi-axes; basis
  may differ by a rotation or reflection.

**Current use.** `planePlane` returns `plane-overlap`/`coincident` if the
distance between origins is `<= tolerance`. `sphereSphere` returns `coincident`
if `d <= tol` and radii differ by `<= tol`. `cylinderCylinder` returns
`coincident` for coaxial equal-radius cylinders within tolerance.

**Problem.** Two parallel planes separated by `1e-7` are called coincident;
two concentric spheres with radii differing by `1e-7` are called coincident.
That can hide a real gap or a real shell thickness.

**Recommendation.** Exact coincidence test first; a nonzero but small
difference is `near-coincident`, not `coincident`. Preserve the actual distance
and radius difference. For circles/ellipses, use object identity or a canonical
comparison; do not claim curve coincidence from samples.

### 2.6 Curve-surface membership

**Definition.** A complete analytic curve (or arc) lies on a surface.

**Current use.** `boundary-on-surface` samples 33 points and takes the maximum
residual. `cylinder-boundary-section` recomputes a section and compares centre
and radii numerically. `validate` uses 8 samples for curves and 3 points for a
line.

**Problem.** Sampling is not a proof. A circle can be off a cylinder between
samples while all 33 samples pass. A 33-point sample is also blind to a
high-frequency deviation that vanishes at the sample stations, although the
supported families are low-degree and that specific failure is unlikely. The
real issue is that the certificate does not say "sampled"; it says
`boundary-on-surface` and counts it as a check.

**Recommendation.** Use coefficient identities for the supported families and
mark sampling as diagnostic only.

For a circle `C(t) = c + r(cos t u + sin t v)` on a sphere
`|p - O| = R` with orthonormal `u,v`:

```text
(c - O) · u = 0
(c - O) · v = 0
|c - O|^2 + r^2 = R^2
```

For a circle/ellipse on a cylinder with raw axis `a`, expand
`|a|^2 |C(t)-o|^2 - ((C(t)-o)·a)^2 - r^2 |a|^2` and require the constant,
`cos t`, `sin t`, `cos 2t` and `sin 2t` coefficients to vanish. For a cone,
replace the cylinder equation by
`|a|^2 |C(t)-A|^2 - (1+m^2)((C(t)-A)·a)^2` and require the same five
coefficients to vanish. For a line segment, the same expression is a quadratic
in `t`; three distinct exact samples prove it, but coefficient comparison is
simpler and avoids choosing sample stations.

For an arc, the same identities prove that the supporting curve lies on the
surface; the arc's parameter interval additionally needs an order/containment
test (section 2.7).

### 2.7 Ordering, containment and parameter intervals

**Definition.** A point lies between two arc endpoints, a split station lies
inside a sweep, a point is inside a bounded patch, a loop sub-arc is on one side
of a cutting plane.

**Current use.** `curveAcceptsParameter` compares angles with a tolerance;
`loopSide` compares signed distances with `EPS`; `curveRoots` sorts roots and
uses `1e-10` parameter gaps; patch interior tests use sphere half-spaces or
cylinder/cone generator stations.

**Problem.** Angle comparisons are not translation-invariant and depend on
`atan2` branch cuts. A tangent root can produce a zero-length or duplicate
sub-arc if the parameter comparison is not exact.

**Recommendation.** Prefer orientation and half-plane tests over angle
comparisons:

- point between two endpoints on a circle: use the sign of the 2D orientation
  of the endpoint radii and the point radius, plus the sweep direction;
- split side: exact sign of `n · (p - o)`;
- patch interior: exact sign of the defining inequalities, or an interval for
  the generator-station interval;
- parameter comparisons: compare exact rational parameters when the
  intersection point is rational; otherwise use an interval enclosure and
  return `undecided` if the intervals overlap.

### 2.8 Topological predicates

Boundary use counts, open/non-manifold/self-shared boundaries, connected
components and closed shells are combinatorial. They are already exact in the
certificate. They should stay independent of geometric tolerance. In
particular, never merge two boundary objects because their coordinates are
within a tolerance; incidence is by object identity or explicit `id`.

### 2.9 Separation and material side

Not currently in the analytic certificate, but needed for future recesses,
booleans and fillets:

- point inside/outside a sphere, cylinder, cone or bounded patch;
- two shells disjoint, nested or touching;
- material side of a face.

These are sign-of-polynomial predicates for the supported quadrics. Use exact
rational evaluation with raw parameters where possible; interval otherwise.
Do not infer material side from display normals.

### 2.10 Self-intersection

The declared triangle kernel already tests triangle-triangle intersection
exactly (`educad-strict.js`, lines 48-89). The analytic certificate does not
test self-intersection of curved patches. For the current surface families,
self-intersection can be reduced to support intersection plus parameter
containment; that is future work, not part of the first milestone.

## 3. OSS approaches and their guarantees and costs

### 3.1 CGAL exact predicates, kernels and interval arithmetic

CGAL 6.2.1 (documentation at <https://doc.cgal.org/latest/>) is the clearest
reference architecture.

- `CGAL::Filtered_kernel<CK>` provides exact and efficient predicates by
  combining a fast interval-arithmetic filter with an exact fallback. The
  constructions remain those of `CK`. See
  <https://doc.cgal.org/latest/Kernel_23/structCGAL_1_1Filtered__kernel.html>.
- `CGAL::Filtered_predicate<EP, FP, C2E, C2F>` runs the fast predicate `FP`;
  when `FP` cannot decide, it throws and the exact predicate `EP` is called. See
  <https://doc.cgal.org/latest/Kernel_23/classCGAL_1_1Filtered__predicate.html>.
- `Exact_predicates_inexact_constructions_kernel` (EPICK) gives exact
  predicates and inexact constructions.
  `Exact_predicates_exact_constructions_kernel` (EPECK) gives both exact.
  See
  <https://doc.cgal.org/latest/Kernel_23/classCGAL_1_1Exact__predicates__inexact__constructions__kernel.html>
  and
  <https://doc.cgal.org/latest/Kernel_23/classCGAL_1_1Exact__predicates__exact__constructions__kernel.html>.
- `CGAL::Interval_nt` implements interval arithmetic with the inclusion
  property. Comparisons return `Uncertain<bool>` or `Uncertain<Sign>`; an
  unsafe conversion throws. This is the filtering primitive, not a geometric
  tolerance model. See
  <https://doc.cgal.org/latest/Number_types/classCGAL_1_1Interval__nt.html>.
- `CGAL::Lazy_exact_nt<NT>` computes an approximation first and only evaluates
  the exact number when needed. See
  <https://doc.cgal.org/latest/Number_types/classCGAL_1_1Lazy__exact__nt.html>.
- Number types include `Quotient`, `MP_Float`, `Gmpq`, `Gmpfr`, `Gmpfi`; GMP,
  MPFR and MPFI are optional external dependencies. See
  <https://doc.cgal.org/latest/Number_types/index.html>.

**Guarantee.** Exact predicates (and exact constructions for EPECK), assuming
the chosen number type is exact and the input conversion is exact. The interval
filter is conservative; the exact fallback decides. **Cost.** C++ templates and
compile-time, exact fallback on hard cases, and optional GMP/MPFR/MPFI runtime
cost. **Tolerance model.** CGAL does not supply a CAD-style per-shape tolerance;
users choose a kernel and handle approximate data themselves.

**License.** The kernel and support libraries are LGPL-3.0-or-later; many
higher-level packages are GPL-3.0-or-later; a commercial license is available.
See <https://www.cgal.org/license.html>. This matters for a MIT project: LGPL
code can be linked with conditions, GPL code cannot be copied into MIT code
without changing the project's distribution terms.

### 3.2 Shewchuk adaptive predicates

Jonathan Richard Shewchuk's work is the canonical adaptive-precision reference:

- *Adaptive Precision Floating-Point Arithmetic and Fast Robust Geometric
  Predicates*, Discrete & Computational Geometry 18:305-363, 1997; technical
  report CMU-CS-96-140. Project page:
  <https://www.cs.cmu.edu/~quake/robust.html>.
- The predicates compute the sign of orientation and incircle determinants
  exactly, using error-free transformations and adaptive expansion arithmetic.
  The running time depends on how close the determinant is to zero and is
  usually close to plain double.
- The C code `predicates.c` is public domain on the project page. The page warns
  that it will not work correctly on processors with extended-precision
  registers (notably x87) unless those registers are configured to round to
  double.

**Guarantee.** Exact sign for the supported predicates (2D/3D orientation and
incircle), for inputs whose coordinates are exactly representable in the
arithmetic used. **Cost.** Very low on easy cases; grows near degeneracy;
limited predicate coverage. **Tolerance model.** None; the predicates decide
exact sign or require exact arithmetic. It is not a general surface kernel.

For EduCAD, the useful idea is the two-stage shape: a cheap floating-point
filter with a proved error bound, then an exact fallback. Full expansion
arithmetic is optional; BigInt rational fallback is simpler in JavaScript and
fast enough for a read-only certificate on current model sizes.

### 3.3 Boost.Multiprecision and Boost.Interval

Boost 1.92.0 documentation (latest at the time of writing;
<https://www.boost.org/doc/libs/latest/>):

- `boost::multiprecision::cpp_rational` is an unlimited-precision rational
  number type, header-only, with a native `cpp_int` backend. Division by zero
  throws. See
  <https://www.boost.org/doc/libs/latest/libs/multiprecision/doc/html/boost_multiprecision/tut/interval/rational/cpp_rational.html>.
- `cpp_bin_float<Digits>` is a fixed-precision binary floating-point type.
  Basic arithmetic is correctly rounded to nearest; string conversion and
  `sqrt` are correctly rounded; transcendental functions are not. See
  <https://www.boost.org/doc/libs/latest/libs/multiprecision/doc/html/boost_multiprecision/tut/floats/cpp_bin_float.html>.
- `boost::numeric::interval<T>` implements interval arithmetic with the
  inclusion property: every real result is contained in the returned interval.
  Comparisons are tri-state or throw on indeterminate. See
  <https://www.boost.org/doc/libs/latest/libs/numeric/interval/doc/interval.htm>.

**Guarantee.** Exact rational arithmetic is exact. Interval arithmetic is
enclosing only if the base type's rounding is correct. The interval page warns
that guaranteed native floating-point intervals are not supported on every
processor/OS/compiler combination; GCC needs `-frounding-math`, clang 10+ needs
it too, MSVC needs `/fp:strict`; older MSVC is not reliable. **Cost.** Rational
denominators can grow quickly; interval operations cost roughly 2-4x double,
plus rounding-mode switching if not using a protected policy. **Tolerance
model.** Interval arithmetic can represent uncertainty, but it has no CAD
semantics and no notion of a per-edge tolerance.

**License.** Boost Software License 1.0 (permissive).

### 3.4 Open CASCADE Technology tolerance model and `BRepCheck`

OCCT 8.0.1 documentation (the current documentation at
<https://dev.opencascade.org/doc/overview/html/>) treats tolerance as a
first-class property of topology.

- Only vertices, edges and faces have tolerances. `BRep_Tool::Tolerance`
  returns the tolerance for each. See
  <https://dev.opencascade.org/doc/refman/html/class_b_rep___tool.html> and the
  Shape Healing guide's statement that "In Open CASCADE Technology only
  vertices, edges and faces have tolerances."
- `Precision` defines global defaults: `Confusion() = 1.e-7`,
  `Angular() = 1.e-12`, `Intersection() = Confusion() * 0.01 = 1.e-9`,
  `Approximation() = Confusion() * 10 = 1.e-6`. Source:
  `src/FoundationClasses/TKernel/Precision/Precision.hxx` in OCCT V8_0_1,
  <https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/FoundationClasses/TKernel/Precision/Precision.hxx>.
- Boolean operations define interference using tolerances: two shapes interfere
  when the distance between their underlying geometry is less than or equal to
  the sum of their tolerances. A new vertex's tolerance is the radius of the
  sphere enclosing the source tolerance spheres. See
  <https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html>.
- `BRepCheck_Analyzer` checks topology and parameterisation. For an edge in a
  face, it checks `|C(t) - S(P(t))| <= edge tolerance`; it requires
  `SameParameter` and `SameRange`, checks wire closure, self-intersection,
  orientation, shell closure and solid enclosure. See
  <https://dev.opencascade.org/doc/refman/html/class_b_rep_check___analyzer.html>.
- `BRepCheck_Analyzer` defaults to computing distances in a finite number of
  points; `SetExactMethod(true)` uses `BRepLib_CheckCurveOnSurface` and is
  slower but more correct. This is a direct precedent for EduCAD's sampled
  checks, including the limitation.
- `BRepCheck_Status` includes `InvalidPointOnCurve`, `InvalidCurveOnSurface`,
  `InvalidSameParameterFlag`, `SelfIntersectingWire`, `NotClosed`,
  `BadOrientation`, `InvalidToleranceValue` and others. The documentation marks
  the tolerance-value check `NYI` (not yet implemented) for vertex, edge and
  face, so `BRepCheck` does not by itself validate that a tolerance is sane.
  See
  `src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Status.hxx`,
  <https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Status.hxx>.
- Shape Healing has a working precision (default `1e-7`), a maximum allowed
  tolerance (default equal to the working precision) and a minimum tolerance.
  Fixes can increase a tolerance, move geometry or change topology; the mode
  flags decide which is allowed. See
  <https://dev.opencascade.org/doc/overview/html/occt_user_guides__shape_healing.html>.

**Guarantee.** A valid shape is valid relative to its tolerances and the checks
implemented by `BRepCheck`; it is not an exact-real proof. A permissive
tolerance can make an invalid shape pass. **Cost.** Mature and fast for CAD,
but tolerance propagation and healing are complex; exact checking is optional
and slower. **Tolerance model.** Rich, per-entity, mutable, and used by all
downstream algorithms. **License.** LGPL-2.1 with the OCCT exception; a
commercial license is available. Verify the exception text before distributing
modified code; the repository ships `LICENSE_LGPL_21.txt` and
`OCCT_LGPL_EXCEPTION.txt`.

### 3.5 Manifold's epsilon and robustness approach

Manifold 3.3.2 (<https://github.com/elalish/manifold>) is a triangle-mesh
library, not an analytic B-rep kernel, but its robustness model is instructive.

- The topological guarantee is exact and by construction: every edge of every
  triangle is paired with exactly one other triangle edge with opposite
  orientation. Manifold output is manifold even when the input is marginal.
  See the wiki, "Manifoldness definition":
  <https://github.com/elalish/manifold/wiki/Manifold-Library#manifoldness-definition>.
- The geometric guarantee is `ε`-valid, not exact: an input is ε-valid if there
  exists a perturbation of the vertices, each by magnitude `< ε`, that makes the
  geometry non-overlapping. The library's goal is to always produce ε-valid
  output from ε-valid input; the wiki explicitly says this cannot be
  mathematically proven in the way of the manifoldness guarantee. A contrary
  example is treated as a bug. See "Definition of ε-valid".
- `kPrecision = 1e-12` in `src/utils.h`. `MaxEpsilon(minEpsilon, bBox)` is
  `max(minEpsilon, kPrecision * bBox.Scale())`, and `tolerance_` is at least
  `epsilon_`. Transforms scale epsilon by the spectral norm of the 3x3 part.
  See `src/utils.h`, `src/shared.h` and `src/impl.cpp` in tag `v3.3.2`:
  <https://github.com/elalish/manifold/blob/v3.3.2/src/utils.h>.
- The Boolean does not use a tolerance for classification. It uses symbolic
  perturbation to break ties for geometry that is exactly floating-point equal
  in any coordinate. Short edges below epsilon are collapsed; coplanar faces are
  merged within tolerance. See the wiki "Mesh Boolean" and `src/edge_op.cpp`.
- There is no exact arithmetic kernel. The approach is "same question is never
  asked in two different ways" plus topological construction, not exact real
  predicates.

**Guarantee.** Topological manifoldness: strong, by construction. Geometric
ε-validity: an engineering guarantee, explicitly not a theorem. **Cost.** Fast,
parallel, no required dependencies, but limited to triangle meshes and
floating-point geometry. **Tolerance model.** Two scalars, `epsilon` (rounding
uncertainty) and `tolerance` (simplification/coplanarity), both relative to the
bounding-box scale. **License.** Apache-2.0.

### 3.6 Cross-cutting lessons

1. **Separate exact decision from approximate construction.** CGAL's EPICK is
   the cleanest statement: exact predicates, inexact constructions. EduCAD
   already does this in the declared kernel, but the analytic certificate mixes
   the two.
2. **A filter needs a proved error bound.** Without a bound, "float first,
   exact on zero" is a heuristic.
3. **A tolerance is not an exactness proof.** OCCT is the mature example of a
   tolerance-first kernel; it is fast and practical, but `BRepCheck` validates
   against tolerances, not against exact reals.
4. **Topology can be exact even when geometry is approximate.** Manifold's
   topological guarantee is independent of its ε-validity goal. EduCAD's
   incidence and shell closure should be in that category.
5. **Relative scale matters.** Manifold's `kPrecision * bBox.Scale()` and
   OCCT's per-entity tolerances both avoid a single global absolute epsilon.
   EduCAD's `surfaceTolerance` uses radius but `planePlane` uses origin length;
   that is inconsistent and not translation-invariant.
6. **Near-degeneracy should be a result, not a silently chosen branch.**
   `near-tangent`, `near-coincident`, `near-parallel` and `undecided` are more
   honest than `tangent`, `coincident`, `parallel` and `ok`.

### 3.7 Primary sources

| Source | Version / file | URL |
|---|---|---|
| CGAL kernel manual | 6.2.1, `Kernel_23/index.html` | <https://doc.cgal.org/latest/Kernel_23/index.html> |
| CGAL filtered kernel | 6.2.1, `Filtered_kernel.h` | <https://doc.cgal.org/latest/Kernel_23/structCGAL_1_1Filtered__kernel.html> |
| CGAL filtered predicate | 6.2.1, `Filtered_predicate.h` | <https://doc.cgal.org/latest/Kernel_23/classCGAL_1_1Filtered__predicate.html> |
| CGAL interval number | 6.2.1, `Interval_nt.h` | <https://doc.cgal.org/latest/Number_types/classCGAL_1_1Interval__nt.html> |
| CGAL number types | 6.2.1, `Number_types/index.html` | <https://doc.cgal.org/latest/Number_types/index.html> |
| CGAL license | current page | <https://www.cgal.org/license.html> |
| Shewchuk robust predicates | 1997 paper and `predicates.c` | <https://www.cs.cmu.edu/~quake/robust.html> |
| Boost.Multiprecision `cpp_rational` | Boost 1.92.0 docs | <https://www.boost.org/doc/libs/latest/libs/multiprecision/doc/html/boost_multiprecision/tut/interval/rational/cpp_rational.html> |
| Boost.Multiprecision `cpp_bin_float` | Boost 1.92.0 docs | <https://www.boost.org/doc/libs/latest/libs/multiprecision/doc/html/boost_multiprecision/tut/floats/cpp_bin_float.html> |
| Boost.Interval | Boost 1.92.0 docs | <https://www.boost.org/doc/libs/latest/libs/numeric/interval/doc/interval.htm> |
| OCCT Boolean operations / tolerance interference | OCCT 8.0.1 guide | <https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html> |
| OCCT `BRepCheck_Analyzer` | OCCT 8.0.1 reference | <https://dev.opencascade.org/doc/refman/html/class_b_rep_check___analyzer.html> |
| OCCT `BRep_Tool` | OCCT 8.0.1 reference | <https://dev.opencascade.org/doc/refman/html/class_b_rep___tool.html> |
| OCCT Shape Healing | OCCT 8.0.1 guide | <https://dev.opencascade.org/doc/overview/html/occt_user_guides__shape_healing.html> |
| OCCT `Precision.hxx` | V8_0_1 source | <https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/FoundationClasses/TKernel/Precision/Precision.hxx> |
| OCCT `BRepCheck_Status.hxx` | master source | <https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Status.hxx> |
| Manifold library wiki | current wiki | <https://github.com/elalish/manifold/wiki/Manifold-Library> |
| Manifold source | tag `v3.3.2`, `src/utils.h`, `src/shared.h`, `src/impl.cpp`, `src/edge_op.cpp` | <https://github.com/elalish/manifold/tree/v3.3.2> |
| EduCAD reconstruction contract | `docs/RECONSTRUCTION_CONTRACT.md` | local file |
| EduCAD surface model | `docs/SURFACE_MODEL.md` | local file |
| EduCAD exact kernel | `public/lib/educad-strict.js` | local file |
| EduCAD analytic surfaces | `public/lib/educad-surfaces.js` | local file |
| EduCAD script runner | `tools/edc.js` | local file |

## 4. Comparison matrix and recommended tolerance policy

### 4.1 Comparison matrix

| System | Exactness guarantee | Tolerance model | Predicate coverage | Failure behaviour | Runtime cost | Integration cost in EduCAD | License |
|---|---|---|---|---|---|---|---|
| EduCAD current | exact for stored decimals on selected checks; sampled/numeric elsewhere | four inconsistent constants (`1e-7`, `1e-6`, `1e-5`, `.edu` `1e-6`) | orientation (numeric), coplanarity (exact points), incidence (sampled), tangency/coincidence (tolerance) | silently classifies near cases as tangent/coincident; `ok` can include tolerance-only checks | low | already integrated | MIT |
| CGAL EPICK/EPECK | exact predicates; EPECK exact constructions | none at kernel level; user handles approximate data | broad 2D/3D linear kernel plus algorithms | exact fallback or exception; no silent tolerance | low on easy, high on exact constructions | high: C++/WASM, GMP/MPFR, different model | LGPL-3+ kernel, GPL-3+ some packages |
| Shewchuk predicates | exact sign for orientation/incircle | none | 2D/3D orientation and incircle only | exact sign or requires exact arithmetic | low, adaptive | low if reimplemented; C code public domain | public domain |
| Boost.Multiprecision + Interval | exact rational; enclosing intervals if rounding correct | interval uncertainty, no CAD semantics | number types, not geometry predicates | exceptions/indeterminate comparisons | rational growth; interval 2-4x | high: C++, not JS | BSL-1.0 |
| OCCT 8.0.1 | validity relative to tolerances; not exact real | per-vertex/edge/face tolerances, global `Precision` defaults | broad B-rep modelling, BRepCheck, booleans | tolerance can hide errors; BRepCheck sampled by default | mature, moderate-high | very high: C++ CAD kernel | LGPL-2.1 + exception |
| Manifold 3.3.2 | topological manifold by construction; ε-valid geometry not proven | `epsilon` relative to bbox scale (`kPrecision = 1e-12`); `tolerance` is at least `epsilon` and user-settable | triangle mesh booleans, no analytic surfaces | topological guarantee; geometric edge cases are bugs | fast, parallel | high: triangle mesh model, not B-rep | Apache-2.0 |

### 4.2 Recommended policy for EduCAD

The recommendation is not "replace the model with exact arithmetic". It is
"make every certificate check say what it proves, and stop using a tolerance to
claim exactness".

**Policy `edu-tolerance-v1`:**

```text
length.relative   = 1e-6
length.absolute   = 1e-7
angle.absolute    = 1e-9 rad   // numeric unit-vector acceptance
angle.near        = 1e-6 rad   // near-parallel window; roughly tau_length / scale
parameter.relative = 1e-9
parameter.absolute = 1e-12
scale             = local geometric span (radius, loop bbox diagonal,
                    or max radius/distance in the predicate)
tol_length        = max(length.absolute, length.relative * scale)
```

Rules:

1. **Exact predicates use no tolerance.** If the predicate is a polynomial on
   the stored decimals, evaluate it exactly. A nonzero result is nonzero.
2. **Tolerance only accepts approximate evidence.** A residual at most
   `tol_length` may be accepted as `evidence:'tolerance'`; it is not an exact
   result and must not be labelled `exact`.
3. **Scale is local and translation-invariant.** Use the radius or loop span,
   not the absolute world origin. `planePlane` must not use `length(origin)` as
   its scale; use the distance between the two origins or the loop spans.
4. **One length scale.** Replace the current `1e-5 * max(1, radius)` surface
   tolerance with `tol_length`. During a compatibility window, keep the old
   value behind `mode:'compat'`; new checks use the policy. This removes the
   10x mismatch between `surfaceTolerance` and `tolerance`.
5. **Angles are not lengths.** Use `angle.absolute` for numeric unit-vector
   acceptance; exact parallelism/perpendicularity is a zero cross/dot product,
   not an angle tolerance. Use `angle.near` only for the `near-parallel`
   relation.
6. **Near is a first-class relation.** `near-tangent`, `near-coincident` and
   `near-parallel` carry the signed gap or angle. They are not aliases for the
   exact relation. For two directions, `0 < |sin(angle)| <= angle.near` is
   `near-parallel`; a larger nonzero angle is transverse.
7. **Undecided is a first-class result.** If an interval contains the decision
   boundary and no exact fallback is available, return `undecided`. In strict
   mode this produces `partial` with `certificate-undecided`; it never produces
   `ok`.
8. **No welding, snapping or averaging in predicates.** Identity is
   combinatorial. If input quantisation is desired, do it once at authoring
   time and record it; never merge two stored vertices because they are close.
9. **Tolerance provenance is recorded.** Every check carries the policy
   version, the scale, the residual and the bound (if any).
10. **Compatibility first.** Keep the current `status` semantics for
    `analytic-surface-certificate-v1` consumers, but add `guarantee` and
    evidence counts. A future v2 can make strict semantics the default.

**Why `1e-6` relative?** It matches the existing intersection tolerance and is
a reasonable acceptance scale for drawings whose authored coordinates are
typically exact decimals or millimetres with finite precision. It is still far
below a plausible drawing precision at model scale (for a 200 mm model,
`tau = 2e-4` mm). The absolute floor `1e-7` prevents a zero-radius or
zero-span predicate from collapsing to exact zero. These are policy choices,
not mathematical constants; the important part is that they are explicit,
scale-aware and recorded.

**Why not `1e-12` everywhere?** Manifold's `1e-12` is a relative rounding
bound for double-precision triangle meshes. It is not an acceptance tolerance
for authored CAD coordinates, and normalised vectors or trigonometric
constructions in JavaScript cannot reliably support it. Use `1e-12` only for
parameter comparisons or exact-zero tests where the quantity is dimensionless
and well-conditioned.

### 4.3 Certificate semantics

Add a `guarantee` field with four values:

| `guarantee` | Meaning | Top-level `status` in strict mode |
|---|---|---|
| `exact` | every check is exact rational or exact combinatorial | `ok` only if shells closed |
| `validated` | every check is exact or a rigorous interval enclosure with a decided sign | `ok` only if shells closed |
| `tolerance` | at least one check is accepted only because a residual is within the policy | `partial`, with `certificate-tolerance-only` |
| `incomplete` | at least one check is undecided or unsupported | `partial` or `issues`, with `certificate-undecided` |

`status` remains the v1 summary so existing `.edu` scripts do not break.
`guarantee` is the new truth-in-labelling field. `counts` gains
`exactChecks`, `intervalChecks`, `filteredChecks`, `toleranceChecks` and
`undecidedChecks`; the existing `exactChecks`/`numericChecks` remain for
compatibility.

## 5. Where to use exact rational, adaptive predicates, interval arithmetic or guarded floating point

### 5.1 Exact rational arithmetic

Use exact rational arithmetic when the predicate is a polynomial in the stored
decimal coordinates and the result is a sign or equality:

- orientation and coplanarity;
- point-on-plane, point-on-line, segment/segment and segment/triangle
  intersection;
- sphere/cylinder/cone implicit equations with rational raw parameters;
- discriminant signs for tangency and intersection classification;
- coincidence of planes, spheres, cylinders and cones with rational parameters;
- boundary incidence and shell closure (combinatorial);
- volume and orientation of declared triangle solids;
- parameter ordering when the intersection point is rational.

Do **not** use exact rational for:

- a normalised unit vector whose components were produced by `sqrt`;
- `sin`, `cos`, `tan`, `atan2`, `acos` values;
- display tessellation;
- broad-phase rejection where a float bound is enough.

### 5.2 Adaptive / filtered predicates

Use a float filter plus exact fallback for the hot combinatorial predicates:

- `orient2d`/`orient3d` in loop side, split side, point-in-triangle and
  point-in-patch;
- `coplanar` for plane loops;
- incircle (and insphere if a future 3D triangulation needs it);
- sign of small determinants in intersection classification.

In JavaScript, a practical first implementation is:

1. evaluate the determinant in double;
2. compute a forward error bound from the sum of absolute products (for example
   `gamma_n * sum |term|`, with `gamma_n = n * Number.EPSILON / (1 - n *
   Number.EPSILON)`), with a safety factor;
3. if `|det| > bound`, return the float sign;
4. otherwise convert the participating decimals to BigInt rationals and
   evaluate the determinant exactly.

This is not full Shewchuk expansion arithmetic, but it has the same
"filter-then-exact" shape and is much easier to audit. Add expansion arithmetic
only if profiling shows the exact fallback dominates. The certificate is
read-only and runs on small models; BigInt is acceptable there.

### 5.3 Interval arithmetic

Use interval arithmetic for quantities that are not polynomial or not rational:

- `sqrt` when a radius or distance must be reported, not only squared;
- normalised vector lengths and unit-axis deviations;
- `sin`/`cos`/`tan` when an angle cannot be eliminated from the representation;
- angle intervals and arc containment when exact orientation is insufficient;
- residual bounds for unsupported curve families;
- high-precision fallback when a BigInt rational expression is too large.

Important JavaScript caveat: ECMAScript does not require `Math.sin`, `Math.cos`,
`Math.tan`, `Math.atan2`, `Math.acos` or `Math.sqrt` to be correctly rounded.
Engines may differ in the last bits. A rigorous interval implementation must
not simply call `Math.sin` and widen by one ulp and call it a proof. The safe
options are:

1. **Eliminate the transcendental.** Store `tanHalfAngle` or a slope instead of
   a cone half-angle; store `h`, `R`, `mouthRadius` instead of a spherical cap
   angle; use orientation/half-plane tests instead of `atan2`; compare squared
   distances instead of distances. This is the preferred option and covers most
   current predicates.
2. **Use rational enclosures.** For `sqrt`, use integer square root on scaled
   BigInt numerators/denominators. For `sin`/`cos`, use a fixed-point Taylor
   series with a proved remainder and argument reduction. This is more work but
   is engine-independent.
3. **Treat `Math`-based intervals as non-rigorous.** If used, label the evidence
   `numeric-interval` or `tolerance`, never `validated` or `exact`.

For EduCAD's current model, option 1 is sufficient for the first milestone:
plane/cylinder/cone/sphere membership, tangency discriminants, coplanarity,
incidence and intersection classification can all be expressed with rational
polynomials if raw parameters are retained.

### 5.4 Guarded floating point

Use guarded floating point for:

- display tessellation and preview meshes;
- broad-phase bounding-box rejection;
- candidate generation and ranking;
- sampled diagnostics and regression signals;
- UI hit-testing and measurement.

A guarded float result carries a bound. If the decision is outside the bound,
it is safe for that computation; if it is inside, escalate or return
`undecided`. Do not use guarded float as certificate evidence unless the bound
is proved and recorded.

### 5.5 Exactify by representation

The cheapest robustness improvement is often representational, not
algorithmic:

- Store the raw axis/normal/basis vector used to construct a surface, in
  addition to the unit vector used for display. Exact tests use the raw vector.
- Store a cone's slope `tan(halfAngle)` (or `rise/run`) as a rational when it is
  constructed from a tangent or a ratio. Derive `halfAngle` for display.
- Store a spherical cap's `h`, `R` and mouth radius, or `cosAngle`, rather than
  only `angle`. The identities `a^2 + h^2 = R^2` and `h = R cos(angle)` are
  exact rational checks when `h`, `R`, `a` are rational.
- Store circle/ellipse basis vectors `u,v` and radii as raw values; avoid
  normalising them in the exact path. An ellipse's semi-axes are
  `r_u |u|` and `r_v |v|`; compare squared quantities.
- Store exact intersection points/parameters where the construction produces
  them (plane/plane line origin, plane/cylinder section stations), so later
  predicates do not have to recover them from floats.
- Keep `startAngle`/`sweepAngle` as display/parameter metadata; do not use them
  as the sole truth for arc containment. Store endpoint points and a direction,
  or an exact rational parameter where possible.

This preserves the existing `geometry.surfaces` schema. The new fields are
optional and additive; builders that do not supply them fall back to the
current numeric path and are labelled as such.

### 5.6 Degeneracy and symbolic perturbation

Symbolic perturbation is useful for meshing and Boolean tie-breaking (Manifold
uses it), but it is not a certificate strategy. If a configuration is exactly
degenerate in the stored model, the certificate should report the degeneracy
(or an exact tie-breaking rule) rather than perturb it silently. If a future
Boolean needs a deterministic tie-break, record the perturbation rule in the
result and keep it out of the analytic certificate.

## 6. How to integrate without rewriting all geometry

### 6.1 Principles

1. **Add a predicate module; do not replace the surface model.** The model
   keeps planes, cylinders, cones, spheres, loops and boundary identity.
2. **`certify` stays read-only and deterministic.** It may call predicates but
   must not mutate the model or the display mesh.
3. **Exact first, numeric fallback second, undecided third.** A check either
   proves, accepts with tolerance, or reports that it cannot decide.
4. **Compatibility is a mode, not a fork.** `mode:'compat'` preserves current
   outputs; `mode:'strict'` uses the new evidence rules.
5. **No new runtime dependency.** BigInt, Number and typed arrays are enough
   for the first milestone. Do not add GMP/MPFR/CGAL/OCCT to the browser app.

### 6.2 API sketch

New module: `public/lib/educad-predicates.js` (or `educad-certify.js`).

```js
// Policy
EduCADPredicates.policy({
  mode: 'compat' | 'strict',
  length: { relative: 1e-6, absolute: 1e-7 },
  angle:  { absolute: 1e-9 },
  parameter: { relative: 1e-9, absolute: 1e-12 },
  scale: 20 // local span/radius; computed by the caller if omitted
}) -> TolerancePolicy

// Evidence result
{
  value: true | false | null,        // null means undecided
  sign: -1 | 0 | 1 | null,
  evidence: 'exact-rational' | 'exact-combinatorial' |
            'filtered-double' | 'interval' | 'tolerance' | 'sampled',
  method: 'orient3d' | 'coplanar' | 'point-on-quadric' | ...,
  residual: number | undefined,
  bound: number | undefined,         // rigorous bound for filtered/interval
  tolerance: number | undefined,     // policy value for tolerance evidence
  scale: number | undefined,
  reason: string | undefined
}

// Predicates
EduCADPredicates.orient2d(a, b, c, options) -> EvidenceResult
EduCADPredicates.orient3d(a, b, c, d, options) -> EvidenceResult
EduCADPredicates.coplanar(points, options) -> EvidenceResult
EduCADPredicates.pointOnPlane(p, plane, options) -> EvidenceResult
EduCADPredicates.pointOnSurface(p, surface, options) -> EvidenceResult
EduCADPredicates.curveOnSurface(curve, surface, options) -> EvidenceResult
EduCADPredicates.classifyPair(a, b, options) -> {
  kind, relation, gap, nearTangent, evidence, method
}
EduCADPredicates.coincident(a, b, options) -> EvidenceResult
EduCADPredicates.tangent(a, b, options) -> EvidenceResult
```

`Surfaces.certify(model, geometry, options)` keeps its signature and gains
options:

```js
Surfaces.certify(model, geometry, {
  mode: 'compat' | 'strict',
  policy: TolerancePolicy,
  require: 'exact' | 'validated' | 'tolerance',
  maxSamples: 33,
  includeEvidence: true
}) -> certificate
```

Additive certificate fields (keep the v1 shape):

```js
{
  contract: 'analytic-surface-certificate-v1',
  arithmetic: 'mixed-exact-rational-and-numeric',
  guarantee: 'exact' | 'validated' | 'tolerance' | 'incomplete',
  policy: { version, mode, length, angle, parameter },
  counts: {
    // existing fields...
    exactChecks, intervalChecks, filteredChecks,
    toleranceChecks, undecidedChecks
  },
  surfaces: [{
    checks: [{
      // existing fields...
      evidence: 'exact-rational' | 'interval' | 'tolerance' | 'sampled' | ...,
      bound: number | undefined,
      scale: number | undefined,
      status: 'ok' | 'failed' | 'undecided'
    }]
  }],
  issues: [{
    // existing fields...
    code: 'certificate-undecided' | 'certificate-near-tangent' |
          'certificate-near-coincident' | 'certificate-tolerance-only' | ...
  }]
}
```

If a contract bump is unavoidable, use
`analytic-surface-certificate-v2` and keep a v1 adapter for existing `.edu`
properties. The preferred path is additive v1 fields plus `guarantee`, because
every existing `surfaceCertificate=ok` expectation continues to parse.

### 6.3 Mapping current checks to new evidence

| Current check | New primary method | Fallback |
|---|---|---|
| `plane-boundary-coplanar` | exact `orient3d`/determinant | interval then tolerance, labelled |
| `boundary-on-surface` (plane) | exact point-on-plane / plane identity | sampled diagnostic |
| `boundary-on-surface` (sphere) | exact squared-distance identity | interval for non-rational basis |
| `boundary-on-surface` (cylinder/cone) | exact implicit polynomial coefficients | interval for non-rational axis/slope |
| `cylinder-boundary-radius` | exact rational equality | tolerance, labelled |
| `cylinder-boundary-section` | exact plane/quadric coefficient comparison | interval |
| `cylinder-boundary-axis` / `cone-boundary-axis` | exact cross/dot zero with raw axis | interval |
| `cone-apex-on-axis` | exact cross product zero with raw axis | interval |
| `cone-half-angle-radius` | exact slope/radius relation | tolerance, labelled |
| `sphere cap` | exact `a^2 + h^2 = R^2`, `h = R cos(angle)` or `h/R` | interval |
| `line-boundary-length` | exact squared length > 0 | policy minimum length |
| `surface-*` pairwise classification | exact discriminant/gap | near-tangent relation |
| `open/non-manifold/self-shared` | exact combinatorial | none |

### 6.4 Migration phases

**Phase 0 (no behaviour change).** Add `educad-predicates.js`, the policy and
evidence records. Add `guarantee` and evidence counters to the certificate. No
check changes classification. Existing `.edu` scripts must still pass.

**Phase 1 (exact point/plane/coplanar).** Replace plane coplanarity fallback and
point-on-plane boundary checks with exact predicates. Add exact plane identity
for circle/ellipse boundaries. Add tests for `1e-12` coplanarity noise.

**Phase 2 (exact curve membership).** Add coefficient identities for circles,
ellipses and line segments on plane/cylinder/sphere/cone. Keep sampling as a
diagnostic. Add `boundary-on-surface` evidence `exact-rational` for supported
families.

**Phase 3 (exact pair classification).** Replace `sphereSphere`,
`cylinderCylinder`, `sphereCylinder`, `planePlane` and `planeQuadric`
classification with exact discriminant/gap tests and `near-tangent` /
`near-coincident` results. Update `.edu` queries that currently expect
`tangent`/`coincident` for nonzero gaps.

**Phase 4 (representation).** Add optional raw parameters to inferred surfaces
and curves (`axisRaw`, `normalRaw`, `uRaw`, `vRaw`, `slope`, `cosAngle`,
`exactCenter`). Use them in exact predicates. Keep the existing unit fields for
display and for old saved previews.

**Phase 5 (strict mode and intervals).** Add interval enclosures for
non-rational axis/basis values and unsupported curves. Make `mode:'strict'` the
default for new scripts; keep `compat` for old saved previews.

No phase requires rewriting `build`, `section`, `intersect`, `trim` or `split`.
They can continue to produce the same objects; the certificate and the
predicate module interpret them more carefully. Where a classification must
change (`near-tangent`), the change is local to the classifier and its callers.

## 7. Test plan using `.edu` and pathological near-tangent cases

### 7.1 Baseline

Run the current certificate and query scripts before any change:

```sh
node tools/edc.js tools/scripts/fillet-line-boundary.edu
node tools/edc.js tools/scripts/spherical-recess.edu
node tools/edc.js tools/scripts/truncated-cylinder.edu
node tools/edc.js tools/scripts/surface-intersect-spheres.edu
node tools/edc.js tools/scripts/surface-split-crossing.edu
node tools/edc.js tools/scripts/surface-line-boundary.edu
```

These were verified clean at the start of this research round. They cover a
closed cylinder shell, a spherical recess, a fillet with shared line boundaries,
sphere/sphere intersections, crossing split arcs and a promoted line boundary.

Record the current outputs as the compatibility baseline. Any change in
`surfaceCertificate`, `surfaceCertificateIssues`, `surfaceCertificateChecks`,
`surfaceChecks` or `surfaceQueries` must be intentional.

### 7.2 Pathological `.edu` scripts

Add scripts under `tools/scripts/` (names are suggestions):

| Script | Configuration | Expected exact result | Expected near result |
|---|---|---|---|
| `research-near-coplanar.edu` | plane loop vertex off by `0`, `1e-12`, `1e-9`, `1e-6`, `1e-4` | off `0`: exact coplanar | `1e-12`..`1e-6`: `guarantee:tolerance`, `certificate-tolerance-only`; `1e-4`: `issues` |
| `research-near-tangent-sphere-plane.edu` | sphere `R=10`, plane `z=R±δ`, `δ=0,1e-9,1e-6,1e-5` | `δ=0`: `point`/`tangent` | `δ>0`: `none`/`near-tangent`; `δ<0`: `circle`/`near-tangent`; never `tangent` for nonzero |
| `research-near-tangent-sphere-sphere.edu` | `d=r1+r2±δ` | `δ=0`: `point`/`tangent` | `δ>0`: `none`/`near-tangent`; `δ<0`: `circle`/`near-tangent` |
| `research-near-tangent-cylinder-cylinder.edu` | parallel axes, `p=r1+r2±δ` | `δ=0`: one `line`/`tangent` | `δ>0`: `none`/`near-tangent`; `δ<0`: two `lines`/`near-tangent` |
| `research-near-tangent-cylinder-plane.edu` | plane parallel to axis, `dist=r±δ` | `δ=0`: one `line`/`tangent` | `δ>0`: `none`; `δ<0`: two `lines`; near label |
| `research-near-parallel-planes.edu` | angle `0`, `1e-9`, `1e-7`, `1e-5` rad | `0`: `plane-overlap`/`coincident` | nonzero: `line`/`near-parallel`; never `coincident` |
| `research-near-coincident-coaxial.edu` | coaxial cylinders with radius `r±δ` | `δ=0`: `coincident` | nonzero: `near-coincident` with radius gap |
| `research-near-cone-apex.edu` | apex offset `δ` from axis | `δ=0`: exact `cone-apex-on-axis` | `0<δ<=τ`: `near`/tolerance evidence; `δ>τ`: `issues` |
| `research-near-circle-on-sphere.edu` | circle centre offset `δ` or radius error `δ` | `δ=0`: exact membership | nonzero: `near` or `failed`; no sampled-only `ok` in strict mode |
| `research-split-tangent-root.edu` | cutting plane tangent to sphere at a pole / arc endpoint | no zero-length split; tangent root not treated as two crossings | `undecided` or `near-tangent`; no duplicate sub-arc |
| `research-fillet-near-tangent.edu` | fillet arc/edge tangency error `δ` | `δ=0`: fillet accepted | `0<δ<=τ`: near-tangent diagnostic; `δ>τ`: `fillet-tangent-conflict` |
| `research-decimal-noise.edu` | `0.1 + 0.2` vs `0.3`, `1/3` vs decimal | exact non-equality | no tolerance-based merge in strict mode |
| `research-distinct-identical-boundaries.edu` | two line objects with equal coordinates, no shared identity | incidence 1 each | never merge; `selfShared` only for same object |

Use decimal values that are exactly representable in `String(number)` (for
example `0.000001`, `0.00001`, `0.1`). Avoid computing `δ` via binary
arithmetic that produces an unintended `0.30000000000000004`; if the test is
about stored decimal noise, make that explicit.

### 7.3 How to assert

Use the existing `.edu` mechanisms, not a separate unit-test suite.

```text
# expect: 48V 72E 26F curves=2 surfaces=3 surfaceKinds=cylinder,plane surfaceLoops=4 surfaceShells=1 surfaceOpen=0 surfaceBoundary=0 surfaceModel=ok surfaceCertificate=partial surfaceCertificateIssues=certificate-near-tangent surfaceCertificateChecks=...
```

For a relation, use a surface query:

```text
# surface-query: {"operation":"intersect","surfaces":[0,1],"expect":{"kind":"none","relation":"near-tangent"}}
```

For a certificate summary, add a `certify` operation to the existing query
runner:

```text
# surface-query: {"operation":"certify","expect":{"guarantee":"exact","counts":{"exactChecks":12,"toleranceChecks":0}}}
```

The query runner's `matches` function compares numbers with
`1e-6 * max(1, |expected|)` (`tools/edc.js`, lines 149-152). Do not use a
numeric query to assert the difference between exact zero and `1e-9`; assert
`kind`, `relation`, `guarantee` and boolean evidence fields instead. If a gap
must be checked, check its order of magnitude with a separate deliberately
loose expected value, or add a `gapSign`/`exact` field to the result.

The `surfaceCertificate` property is derived in `tools/edc.js` (lines 407-409)
from `geometry.analyticCertificate`. A new `guarantee` field can be exposed as
`surfaceGuarantee` without changing existing properties.

### 7.4 Acceptance criteria

1. **No false exact relation.** No nonzero gap or angle is reported as
   `tangent`, `coincident` or `parallel` in strict mode.
2. **Exact cases stay exact.** `δ=0` configurations remain exact
   `tangent`/`coincident`/`coplanar`, not tolerance fallbacks.
3. **Near cases are labelled.** Every `0<|δ|<=τ` case reports
   `near-tangent`/`near-coincident`/`near-parallel` or `undecided`, with the
   signed gap where applicable.
4. **Strict status is honest.** `status:'ok'` in strict mode implies
   `guarantee:'exact'` or `'validated'`; any tolerance-only check makes it
   `partial`.
5. **Compatibility is preserved.** Existing scripts produce the same
   `surfaceCertificate`, counts and queries in `mode:'compat'`.
6. **Sampling is diagnostic.** A sampled check cannot by itself produce
   `guarantee:'exact'`; it is labelled `sampled` or `tolerance`.
7. **Determinism.** Repeated runs on the same input produce byte-identical
   certificate JSON (apart from any explicitly non-deterministic timing field,
   which the certificate does not currently have).
8. **Performance.** Certificate overhead is measured on the existing scripts;
   target is no more than 2x current wall time in compat mode and no more than
   5x in strict mode for current model sizes. These are engineering targets,
   not guarantees.

### 7.5 Regression and fuzz strategy without a new suite

- Add one `.edu` per pathological family, each with several `surface-query`
  expectations at different `δ` values.
- Use the existing `# expect:` line for certificate status and counts.
- Add a `research-` prefix so the scripts are easy to find and can be run
  together with a shell glob (the runner accepts one file per invocation; a
  small shell loop is fine).
- Do not add JavaScript unit tests for this work. The project's verification
  contract is the drawing script and its `# expect:` properties.
- For randomized exploration, generate temporary `.edu` files outside the
  repository and keep only the minimized pathological cases as committed
  scripts.

## 8. Licensing and dependency notes

### 8.1 Licenses of the surveyed systems

| Project | Version surveyed | License | Note |
|---|---|---|---|
| CGAL | 6.2.1 | LGPL-3.0-or-later for kernel/support; GPL-3.0-or-later for many higher-level packages; commercial option | Do not copy GPL package code into this MIT project. LGPL linking has conditions. |
| Shewchuk predicates | 1997 paper / `predicates.c` | public domain (per project page) | Reimplementation is safe; retain attribution and the paper citation. The page warns about x87 extended precision. |
| Boost.Multiprecision / Boost.Interval | 1.92.0 docs | Boost Software License 1.0 | Permissive; header-only C++. |
| Open CASCADE Technology | 8.0.1 docs, V8_0_1 source | LGPL-2.1 with OCCT exception; commercial option | Verify `OCCT_LGPL_EXCEPTION.txt` before distributing modified code. |
| Manifold | 3.3.2 | Apache-2.0 | Permissive; patent grant. |
| EduCAD | current | MIT | Keep new code MIT-compatible. |

### 8.2 Dependency recommendation

**Do not add a native geometry kernel or a multi-precision runtime dependency
for this milestone.** The project is zero-npm-dependency and browser-first.
CGAL, OCCT, Boost and Manifold are C++ libraries; using them would require a
WASM build, a large binary, a different model, and license review. The current
JavaScript `BigInt` rational code already provides the exact arithmetic needed
for the first milestone.

Recommended dependency posture:

- **Built-in:** `BigInt`, `Number`, `Uint8Array`/`DataView` for bit-level
  `nextUp`/`nextDown` if interval arithmetic is added.
- **Optional future:** a small, in-repo interval module with exact rational
  endpoints; no external package.
- **Do not vendor:** CGAL, OCCT, Boost or Manifold source. If an algorithm is
  reimplemented, use the published paper or documentation and write new code;
  do not copy source text.
- **Attribution:** cite Shewchuk's paper and the CGAL/OCCT/Manifold documents in
  code comments and this note. Public-domain status of `predicates.c` does not
  remove the need for attribution and a warranty disclaimer.
- **WASM/native:** out of scope. If ever considered, treat LGPL/GPL compliance
  as a separate project decision, not a refactor detail.

### 8.3 Verification status and unverified claims

Verified from primary documentation/source during this round:

- CGAL 6.2.1 kernel/filter/interval/lazy-exact descriptions and license scheme.
- Shewchuk's adaptive predicate claims, public-domain code statement and x87
  warning.
- Boost rational/float/interval semantics and rounding caveats; Boost license.
- OCCT 8.0.1 `Precision` constants, per-entity tolerance model, boolean
  interference definition, `BRepCheck_Analyzer` checks and sampled/exact
  method, Shape Healing tolerance defaults, and LGPL-2.1 license file.
- Manifold 3.3.2 `kPrecision`, `MaxEpsilon`, `epsilon_`/`tolerance_`
  propagation, epsilon-valid definition and Apache-2.0 license.
- Current EduCAD constants, code paths, certificate fields and `.edu`
  expectations cited above; all baseline scripts listed in 7.1 ran clean.

Not independently verified or inferred:

- The exact performance multipliers for BigInt rational versus double on
  EduCAD-sized models (the 2x/5x targets are engineering estimates).
- The claim that every current certificate check can be expressed as a rational
  polynomial without changing the stored model. Most can; normalized
  vectors and stored angles may require optional raw parameters or intervals.
- The claim that `Math.sin`/`Math.cos`/`Math.sqrt` are not correctly rounded on
  every JavaScript engine. ECMAScript specifies implementation-approximated
  results for many transcendental functions, but the exact behaviour is
  engine/version dependent. Treat this as a reason to avoid them in certified
  decisions, not as a measured result.
- The OCCT exception text was not read in full; the license file name and
  repository packaging were verified, but legal review is still required.
- CGAL package-by-package licensing varies; only the general kernel/support vs
  higher-level split was verified.
- The `1e-6` relative / `1e-7` absolute policy is a recommendation, not an
  empirically optimized value. It should be calibrated against the project's
  authored drawing precision and the existing `.edu` corpus.

## 9. Ranked recommendation and smallest next milestone

### Ranked recommendation

1. **Make near-degeneracy a first-class result.** Change tangency, coincidence
   and parallelism classification to `exact` / `near-*` / `transverse` (or
   `separate`) with a signed gap. This is the highest-value change because the
   current probes show false `tangent`/`coincident` results at `1e-5` and
   `1e-7`. It does not require rewriting geometry.
2. **Unify the tolerance policy and record its provenance.** Replace the
   `1e-7`/`1e-6`/`1e-5` mixture with `edu-tolerance-v1` and a local scale.
   Keep `mode:'compat'` for existing scripts. Add `policy`, `evidence` and
   `guarantee` to the certificate.
3. **Add exact orientation/coplanarity and exact point-on-plane.** These are
   small, well-understood predicates and remove the largest class of
   exact-fallback ambiguity. Use a float filter with a proved bound and BigInt
   rational fallback.
4. **Replace sampled curve membership with exact coefficient identities for
   plane/cylinder/sphere/cone circles, ellipses and line segments.** Keep
   sampling as a diagnostic. This turns `boundary-on-surface` from a sampled
   assertion into a proof for the supported families.
5. **Store exact raw parameters alongside display parameters.** Raw axis,
   normal, basis, slope and cap invariants make exact tests possible without
   normalising irrational values. This is additive and backward-compatible.
6. **Add exact pair classification and exact coincidence tests.** Plane/plane,
   sphere/sphere, parallel cylinder/cylinder and axis-through-centre
   sphere/cylinder are already formula-driven; exact discriminants and gaps are
   straightforward.
7. **Add interval arithmetic only where exact rational is insufficient.**
   Prefer algebraic elimination first. If intervals are needed, use exact
   rational endpoints or a proved fixed-point implementation; do not treat
   widened `Math` results as rigorous proofs.
8. **Adopt a strict certificate mode.** `status:'ok'` should mean exact or
   validated evidence; tolerance-only checks should be `partial` with
   `certificate-tolerance-only`. Keep compat mode for the existing corpus.

### Smallest next milestone

**Milestone: exact predicate core plus honest near-tangent classification.**

Concrete scope:

- Add `public/lib/educad-predicates.js` with:
  - `policy()` and `EvidenceResult`;
  - `orient2d`, `orient3d`, `coplanar`, `pointOnPlane`;
  - a float filter with a forward error bound and BigInt rational fallback.
- Add additive certificate fields: `guarantee`, `policy`,
  `exactChecks`/`intervalChecks`/`filteredChecks`/`toleranceChecks`/
  `undecidedChecks`, and per-check `evidence`.
- Use the exact predicates for `plane-boundary-coplanar` and plane
  `boundary-on-surface`.
- Add `near-tangent` to `sphereSphere`, `cylinderCylinder`,
  `sphereCylinder` and plane/sphere/cylinder `section`; do not change exact
  tangent results.
- Add three `.edu` scripts:
  - `research-near-coplanar.edu`;
  - `research-near-tangent-sphere-plane.edu`;
  - `research-near-tangent-cylinder-cylinder.edu`.
- Expose `surfaceGuarantee` in `tools/edc.js` and add a `certify`
  `surface-query` operation that returns the summary fields.
- Keep `mode:'compat'` as the default so the existing 151 drawing scripts and
  the baseline scripts in 7.1 pass unchanged.

Exit criteria:

- The three new scripts demonstrate exact `tangent`/`coplanar` at `δ=0` and
  non-tangent/non-coplanar results for every nonzero `δ`, with no false
  `tangent`/`coincident`.
- Existing scripts produce the same `surfaceCertificate`,
  `surfaceCertificateIssues`, `surfaceCertificateChecks`, `surfaceChecks` and
  `surfaceQueries` as before.
- A certificate from a `1e-12`-off plane loop reports
  `guarantee:'tolerance'`, `certificate-tolerance-only` or `undecided`, not
  `exact`.
- The new module has no npm dependency and no change to `geometry.surfaces`
  required.

# Constant- and variable-radius fillets: OSS practice and an EduCAD design

Status: research/design note, 2026-11-11. This round changes documentation only;
no production code or test fixture is modified.

Survey baseline: EduCAD commit `43d3b7f` (`Document cylindrical fillet and line
boundary support`). The current feature is the partial-cylinder fillet described
in [SURFACE_MODEL.md](../SURFACE_MODEL.md#end-to-end-case-cylindrical-fillet-between-two-planar-faces)
and [SURFACE_COMPLEX.md](../SURFACE_COMPLEX.md): one cylinder patch, two
straight tangent generator boundaries shared with two synthetic plane strips,
two end arcs, no corner or chain handling, and an open feature patch. The
existing `fillet-line-boundary.edu` fixture reports 3 surfaces, 3 loops, 8 open
boundary uses and `certificate-open-component`; only the two generator lines
have incidence 2.

## 1. Taxonomy

Terminology is not uniform across CAD systems. This note uses the following
definitions.

| Term | Meaning |
|---|---|
| **Fillet** | A blend at a concave (inside) edge, usually adding material. Many systems use "fillet" for both concave and convex cases. |
| **Round** | A blend at a convex (outside) edge, usually removing material. The current EduCAD fixture is drawn as a convex round. |
| **Constant-radius blend** | A rolling-ball blend whose radius `r` is the same at every station along the edge. The cross-section is a circular arc. |
| **Variable-radius blend** | `r` varies along the edge, e.g. `R1` at the start vertex and `R2` at the end vertex, an interpolated law `r(u)`, or a general function. The cross-section remains circular only for a rolling-ball definition; other definitions use a different profile. |
| **Asymmetric blend** | The two supports have different setback/contact distances, so the cross-section is generally elliptical or conic, not circular. This is not the same as a radius that changes along the edge. |
| **Setback** | The distance along an edge, measured back from a vertex, at which the edge blend stops and a vertex/corner blend begins. A setback plane normal to the edge cuts the blend; the vertex blend fills the remaining region. |
| **Rolling ball** | A ball of radius `r` is kept tangent to both support surfaces while its centre moves along the edge. The centre locus is the **spine** (or guide); the two contact curves are the **spring curves** (trim curves). The envelope of the ball is the blend surface. |
| **Blend surface** | The surface joining the two supports, bounded by the two spring curves (and by end/corner boundaries). A rolling-ball blend is a canal surface. |
| **Corner / vertex blend** | The patch that joins two or more edge blends where they meet at a vertex. It may be a sphere, a torus, a rolling-ball patch, an `n`-sided Gregory/Coons patch, or a B-spline fill. |
| **Fillet chain** | A sequence of tangent-continuous edges blended as one contour, with corner patches where other blended edges meet it. |
| **Full round** | A blend that consumes an entire face between two edges, rather than a specified-radius round on one edge. It is a related but different operation. |
| **Chamfer** | A ruled blend with a straight cross-section. It is not a rolling-ball fillet, but shares the spring/trim and corner vocabulary. |

### 1.1 What the rolling-ball model implies

For supports `S1`, `S2` with outward unit normals `n1`, `n2`, a ball of radius
`r` tangent to both has its centre `C` at signed distance `r` from each support.
For two planes `ni . x = di`, this is the linear system

```text
n1 . C = d1 + sigma r
n2 . C = d2 + sigma r
```

where `sigma = +1` for a convex round (ball outside the material) and
`sigma = -1` for a concave fillet (ball inside the material). The centre lies
on the angle bisector; the spine is a line parallel to the edge. The spring
point on support `i` is `C - sigma r ni`. This is the same construction OCCT
uses in its exact plane/plane case (see section 2.1).

The surface family follows from the spine:

| Spine | Radius | Blend surface |
|---|---|---|
| straight line | constant | cylinder |
| circular arc | constant | torus |
| point | constant | sphere |
| straight line | linear in spine parameter | cone (possibly truncated) |
| general curve | constant or varying | canal surface; generally a B-spline/approximation |

The first three rows are the classical "simple surface" cases; ACIS documents
exactly those three [13]. The cone row follows from the same offset
construction and is the natural first variable-radius extension for EduCAD.

### 1.2 Corner taxonomy

| Case | Description | Typical resolution |
|---|---|---|
| **Open end / runout** | The edge blend ends at a face or free boundary. | Trim the blend and the end face by the end cross-section; share the end arc. If there is no end face, leave the feature open and report it. |
| **Two-edge corner** | Two blended edges meet at a vertex. | Extend/trim the two blends; a sphere or torus may fit; otherwise a filling patch. |
| **Three-edge corner (trihedral)** | Three blended edges meet at a vertex. | Equal radii and suitable geometry: sphere octant or torus. Unequal radii or general geometry: `n`-sided/Gregory/B-spline fill. |
| **Four or more edges** | A vertex with four or more incident blended edges. | General vertex blend / multi-sided fill. OCCT's `BRepFilletAPI_MakeFillet` explicitly does not handle a contour endpoint at a 4-or-more-edge vertex [2]. |
| **Fillet chain** | A tangent-continuous sequence of edges. | Propagate the contour across tangent edges; split at corners; match radius laws at shared vertices. |
| **Tangent supports** | The two supports meet G1, so there is no sharp edge. | Refuse or treat as a smooth continuation; a finite-radius rolling ball is not defined by a sharp corner. |
| **Concave vs convex** | Material lies on opposite sides. | Choose the offset sign; the same cylinder/torus/cone family applies with a different centre. |
| **Radius overflow / self-intersection** | `r` exceeds the local support curvature or available space. | Detect and refuse; do not clamp silently. ACIS documents this failure mode [13]. |
| **G1 vs G2** | Constant-radius blends are tangent but generally have a curvature jump at the spring curves. | G1 is the default and is exact for cylinder/cone/torus/sphere. G2 requires a variable-radius or reparameterized blend, usually a B-spline. |

## 2. How mature systems represent fillet surfaces and spring curves

### 2.1 Open CASCADE Technology 8.0.1

Primary sources are the `V8.0.1` tag (commit
`b8f597c677811d1f9f4d8a97f5ae2825c0353a42`) under
`src/ModelingAlgorithms/TKFillet/` [1]. The user guide's "Fillets and Chamfers"
section is [2].

**Public API.** `BRepFilletAPI_MakeFillet` is the high-level builder. It
accepts a shape plus one or more edge/radius descriptions:

- `Add(Radius, E)` — constant radius, building a contour of tangent edges.
- `Add(R1, R2, E)` — linear radius evolution between the first and last vertex
  of the spine.
- `Add(Law_Function, E)` and `Add(Array1<gp_Pnt2d>, E)` — arbitrary/interpolated
  radius laws.
- `SetRadius` at contours, edges and vertices; `SetContinuity` sets internal
  continuity (C1 by default) and the angular G1 tolerance between fillet and
  support faces.
- `Build` / `IsDone` / `Shape`; failure introspection via `NbFaultyContours`,
  `FaultyContour`, `StripeStatus`, `HasResult` and `BadShape`.

See `BRepFilletAPI_MakeFillet.hxx` [3] and the reference manual [4]. The API
documentation warns that there is no initial error analysis and that the
current release does not handle a contour endpoint at a vertex of four or more
edges, or a fillet/face intersection not fully contained in the limiting face.

**Internal data structures.** `ChFi3d_FilBuilder` is the concrete tool:

- `ChFiDS_Spine` — the guide line; a contour composed of solid edges, tangent
  continuations, and face-tangent borders. `ChFiDS_FilSpine` adds the radius
  law. `ChFiDS_ElSpine` is an elementary guide used for walking.
- `ChFiDS_Stripe` — a "band of fillet": one spine plus a sequence of
  `ChFiDS_SurfData`.
- `ChFiDS_SurfData` — per-surface data: support surface indices, orientation,
  `ChFiDS_FaceInterference` on each support, and start/end `ChFiDS_CommonPoint`
  records.
- `ChFiDS_FaceInterference` — the contact curve representation: a 3D curve plus
  a pcurve on the support face and a pcurve on the fillet surface. These are
  OCCT's spring curves.
- `ChFiDS_CommonPoint` — a start/end point common to two adjacent fillets and
  to an edge of one of the support faces.

See `ChFiDS_Spine.hxx`, `ChFiDS_Stripe.hxx`, `ChFiDS_SurfData.hxx` and
`ChFiDS_FaceInterference.hxx` [5].

**Construction.** For each stripe, `ChFi3d_FilBuilder::PerformSurf` chooses a
constant-radius or evolving-radius blend function:

- `BRepBlend_ConstRad` is a typedef of `BlendFunc_ConstRad`; it defines the
  section circle, tangency and derivatives.
- `BRepBlend_EvolRad` / `BlendFunc_EvolRad` do the same with a `Law_Function`.
- `BRepBlend_Walking` marches along the guide, solving the section equations at
  each step and storing `Blend_Point` records (point on S1, point on S2,
  parameters, tangents). `BRepBlend_Line` is the resulting polyline of walking
  points; `AppBlend_Approx`/`CompleteData` turn it into a surface.
- `ChFi3d_Builder::Compute` computes stripes, then vertices/corners, then
  intersects stripes that meet, then feeds the topological data structure and
  rebuilds the shape.

See `ChFi3d_FilBuilder.cxx`, `ChFi3d_Builder.cxx`, `BlendFunc_ConstRad.hxx`,
`BlendFunc_EvolRad.hxx`, `BRepBlend_Walking.hxx`, `BRepBlend_Line.hxx` and
`Blend_Point.hxx` [6].

**Exact special cases.** OCCT does not represent every fillet as a NURBS.
`ChFiKPart_ComputeData_FilPlnPln.cxx` constructs an exact
`Geom_CylindricalSurface` for a plane/plane edge. It intersects the two planes
to get the edge line, computes the centre on the angle bisector at
`Radius / cos(Ang/2)` from the edge, and fills `ChFiDS_FaceInterference` with
the 3D spring line plus pcurves on each plane and on the cylinder. This is a
direct, source-level confirmation of the offset/bisector construction in
section 1.1 [7].

`FilletSurf_Builder` is the introspection API: it exposes the list of NUBS
surfaces, each support face, `CurveOnFace1/2` (the spring curves), the
corresponding pcurves on the supports and on the fillet, the circular section
`Section`, and start/end section status. This is a useful model for EduCAD's
public blend record [8].

**Corners.** `ChFi3d_Builder::ExtentAnalyse` classifies each vertex by the
number of incident stripes: one, two or three. `PerformFilletOnVertex` then
calls `ExtentOneCorner`, `ExtentTwoCorner` or `ExtentThreeCorner`. The two- and
three-corner builders contain analytic special cases:

- `ChFi3d_FilBuilder_C2.cxx`: `ToricRotule` detects a torus corner when three
  faces are planes, the two incident constant fillets have equal radii, and the
  third face is perpendicular to the other two.
- `ChFi3d_FilBuilder_C3.cxx`: `ToricCorner` detects a torus/sphere corner when
  the radii match and the third face is planar with the appropriate normal;
  `c1spheric` selects a spherical corner when all radii match.
- Otherwise OCCT builds a constraint filling patch (`GeomFill_ConstrainedFilling`)
  from two, three or four boundary curves, optionally with tangency
  constraints. The user guide explicitly says this filling is how gaps at
  intersecting fillets with different radii are closed [2], [9].

This hierarchy — exact torus/sphere when the geometry fits, B-spline filling
otherwise — is the most important design lesson for EduCAD.

**Failure behavior.** OCCT reports per-contour/per-vertex failures rather than
silently approximating: `ChFiDS_StartsolFailure`, `ChFiDS_TwistedSurface`,
`ChFiDS_WalkingFailure`, `ChFiDS_Error`, plus partial results in `BadShape`.
EduCAD should keep the same "refuse with a specific diagnostic" discipline.

### 2.2 FreeCAD 1.1.4

FreeCAD is a thin OCCT wrapper here, not an independent blend algorithm.

- **Part Fillet** (`Part::Fillet`): `src/Mod/Part/App/FeatureFillet.cpp`
  constructs `BRepFilletAPI_MakeFillet` and calls
  `mkFillet.Add(radius1, radius2, edge)` for every selected edge [10]. The
  dialog (`DlgFilletEdges.ui`) offers "Constant radius" and "Variable radius",
  with start/end radius fields; the variable case maps to OCCT's linear
  `R1 -> R2` law, not to an asymmetric two-support radius [11].
- **PartDesign Fillet** (`PartDesign::Fillet`): constant `Radius` only;
  `shape.makeElementFillet(baseShape, edges, Radius, Radius)` [12].
  `DressUp::getContinuousEdges` filters selected edges to sharp C0 edges with
  exactly two incident faces; the tangent-chain extension itself is still done
  inside OCCT's `Add`.
- **Validation**: PartDesign catches `Standard_Failure`, checks
  `BRepAlgo::IsValid`, limits tolerances with `ShapeFix_ShapeTolerance` when
  needed, and enforces the single-solid rule. Part Fillet catches
  `Standard_Failure` and returns an error string.
- **No setback**: neither the Part nor PartDesign dialog exposes a setback
  distance. Corner behavior is whatever OCCT's extension/filling produces.

FreeCAD therefore confirms the OCCT representation and the practical API
surface, but contributes no separate spring-curve or corner algorithm.

### 2.3 libfive (implicit SDF blends)

libfive is a functional-representation (f-rep) kernel, not a B-rep fillet
system. Surveyed commit:
`918387a9220dbac2f7ab32fb35e274c6794439cf` (2026-10-16) [14].

Relevant standard-library operations (`libfive/stdlib/stdlib_impl.cpp`):

```text
offset(a, o)          = a - o
shell(a, o)           = clearance(a, a, -abs(o))
blend_expt(a, b, m)   = -log(exp(-m*a) + exp(-m*b)) / m
blend_expt_unit(a,b,m)= blend_expt(a, b, 2.75 / m^2)
blend_rough(a, b, m)  = union(a, union(b, sqrt(abs(a)) + sqrt(abs(b)) - m))
blend_difference(a,b,m,o) = inverse(blend_expt_unit(inverse(a), offset(b,o), m))
```

These are smooth-min/smooth-subtract operations over signed distance fields.
`m` is a blend softness, not a radius. `blend_expt_unit` rescales it to behave
roughly like `blend_rough` for `m` in `[0,1]`, but the zero level set is not an
exact circular arc and the result has no explicit spine or spring curves. The
kernel meshes the f-rep into a watertight, manifold triangle mesh; that is a
different guarantee from an analytic B-rep certificate.

The useful comparison is conceptual: implicit blends handle arbitrary corners
and chains automatically by construction, but they cannot answer "is this
exactly a constant-radius fillet with these spring curves?" without a separate
fitting/verification step. EduCAD should not replace its analytic model with an
SDF blend; it can use an implicit/mesh fallback only as an explicitly
approximate display path.

### 2.4 ACIS: a documented offset/spring algorithm (proprietary reference)

ACIS R17's "Blend Geometry" and "Setbacks" documentation is a clear statement
of the classical algorithm [13]. It is proprietary documentation, included here
as an algorithm reference only.

- Constant radius: offset both support surfaces by `r`; intersect the offsets to
  get the **spine**; project the spine onto each support to get the **spring
  curves**. The blend surface is the portion of the rolling-ball envelope
  between the spring curves.
- Surface type by spine: straight line -> cylinder; circular arc -> torus;
  point -> sphere; otherwise a spline surface.
- Variable radius: the constant offset-intersection method no longer works
  because a variable offset is ill-defined on a surface. A marching algorithm
  evaluates a ball of radius `r(v)` at each station; analytic surfaces cannot
  represent even simple variable-radius blends in general. ACIS distinguishes a
  rolling-ball *snapshot* (the ball sampled at each station) from a rolling-ball
  *envelope* (the true envelope); the spring curves are identical, but the
  cross-sections differ subtly and the envelope is smoother across tangent
  transitions.
- Setback: a plane normal to the edge, set back from the vertex, cuts the blend;
  the intersection curve bounds the vertex blend. Setbacks may be explicit,
  automatic (`autosetback`), oblique (different left/right spring setbacks), or
  omitted (intersect adjacent spring curves to find the minimal cross edge).
- Vertex blends: a sphere/torus is used when it fits; otherwise an `n`-sided
  Gregory polygon surface (or a B-spline approximation) fills the vertex.
- Limitation: if the requested radius exceeds the support curvature in the
  wrong convexity, the upper spring curve can loop and the blend surface can
  self-intersect. ACIS detects and reports the failure.

The ACIS description matches OCCT's architecture (offset/spine/spring for the
simple case, walking/filling for the general case) and gives the clearest
statement of why variable radius is fundamentally harder.

### 2.5 Literature

- Vida, Martin and Varady's survey defines the common vocabulary: base
  surfaces, trimline (the common boundary of base and blend), spine curve,
  profile curve, and blending surface. It classifies rolling-ball, spine-based,
  trimline-based and polyhedral methods, and discusses topological aspects of
  blending a B-rep [15].
- Farouki and Sverrisson give a prescribed-precision approximation of
  constant-radius rolling-ball blends for free-form parametric surfaces. They
  trace the intersection of offset surfaces to get the spine and trim curves,
  then approximate the blend as a G1 sequence of rational tensor-product
  patches with approximately circular isoparametric loci [16]. This is the
  canonical "what to do when no simple surface fits" reference.
- Rossignac and Requicha's 1984 constant-radius blending work is the usual
  origin citation for the rolling-ball formulation in solid modeling; it is
  cited here second-hand through the survey and later reviews [17].

## 3. Comparison matrix

| Aspect | EduCAD current | OCCT 8.0.1 | FreeCAD 1.1.4 | libfive |
|---|---|---|---|---|
| Input | Drawn true-shape arc + tangent face edges + paired generator/end strokes | B-rep shape + edge + radius/law | B-rep shape + selected edges + radius | Implicit CSG trees + blend softness |
| Surface record | Partial `cylinder` with `loops`, `lines`, `curves` | `Geom_Surface` per face: exact cylinder/torus/sphere/cone or NUBS | Wraps OCCT `TopoShape` | No surface record; f-rep level set |
| Spine | Cylinder axis from two arc centres | `ChFiDS_Spine` / `ElSpine`; walking points | OCCT | None |
| Spring curves | Two straight generator lines, shared with plane strips | `FaceInterference`: 3D curve + pcurve on support + pcurve on fillet; `FilletSurf_Builder::CurveOnFace1/2` | OCCT | None; transition is implicit in the field |
| Adjacent-face trimming | None; synthetic strips are rectangles | Yes; builder rebuilds/trims support faces through `TopOpeBRepDS` | OCCT | None; CSG union/subtract |
| End treatment | Open | `ExtentOneCorner` / runout; section status | OCCT | Automatic smooth union |
| Corners | None | 2/3-edge: torus/sphere/filling; 4+ refused | OCCT | Automatic, no explicit corner control |
| Chain | No | Contour propagation across tangent edges | OCCT `Add` propagation; PartDesign filters C0 edges | N/A |
| Variable radius | No; paired arcs must have equal radius | `Add(R1,R2,E)`, `Law_Linear`, `Law_Interpol`, `SetRadius(law)` | Part: R1/R2 linear; PartDesign: constant | `m` can vary spatially, but is not a radius law |
| Setback | No | No explicit setback API; corner extension/filling only | No | No |
| Concavity / material side | Not checked; view tangency only | `ChFi3d::DefineConnectType` / `ConcaveSide` classify the edge | OCCT | Sign of the CSG field |
| Continuity | G1 checked via view tangency | G1 by default; `SetContinuity(C1/C2)` internal + angular G1 tolerance | OCCT default; no continuity control in the dialog | Smooth field blend, not an exact G1/G2 analytic certificate |
| Watertight | No (`partial`, open component) | Yes, typically a solid | Yes, solid (single-solid check) | Yes, watertight mesh |
| Failure behavior | Refuses with `fillet-*` diagnostics | Per-contour/vertex status, `BadShape` | OCCT exception -> FreeCAD error | Numeric field; can produce unintended bulges/self-intersections |
| Certification | Analytic certificate separate from mesh; currently `partial` | No EduCAD-style certificate | No | Mesh only |
| License | MIT | LGPL-2.1 + OCCT exception | LGPL-2.1-or-later | MPL-2.0 library/stdlib; GPL-2.0+ Studio |

The current implementation is best understood as a **view-evidence reader for
one cylinder patch**. It checks tangency and shares the two straight generator
boundaries, but it does not construct the blend from the support surfaces, does
not trim the supports, and does not close the ends. Mature systems invert the
emphasis: the edge, radius and supports define the blend; drawn geometry is
evidence for those parameters.

## 4. Recommended next algorithm for EduCAD

The target is a support-first, analytic blend construction that fits the
existing bounded-surface complex and its certificate. It should not be a new
solid reader.

### 4.1 Representation

Add a blend record next to the surface record, and make the spring curves
first-class boundary elements:

```js
{
  kind: 'cylinder' | 'cone' | 'torus' | 'sphere',
  // existing analytic parameters
  loops: [{
    kind: 'outer',
    elements: [
      {kind:'curve', curve: spring1},   // shared with support A
      {kind:'curve', curve: endArcHigh},
      {kind:'curve', curve: spring2},   // shared with support B
      {kind:'curve', curve: endArcLow}
    ]
  }],
  blend: {
    kind: 'constant-radius' | 'linear-radius',
    radius: 10,
    radiusLaw: {kind:'constant', value:10} |
               {kind:'linear', start:10, end:20},
    spine: {kind:'line'|'circle'|'curve', ...},
    springCurves: [spring1, spring2],
    supports: ['surface:1', 'surface:2'],
    setback: {start:0, end:0},
    continuity: 'G1',
    closure: 'open' | 'trimmed' | 'closed'
  }
}
```

Two small model extensions make this practical:

1. **Inline mixed loops.** `Surfaces.build` currently accepts `vertices`,
   `curves`, `lines` and `section`, but not `elements`-only patch loops, even
   though `loopGeometry`, `loopElements`, `validate` and `certify` already
   understand `elements`. Accept `elements` in `copyLoopInput`,
   `loopInputValid` and `loopCurveIndices`. This lets a producer emit an ordered
   cycle of computed spring lines, end arcs and polyline pieces without
   pretending they are drawing entities.
2. **Torus surface kind.** Add `kind:'torus'` with `center`, unit `axis`,
   `majorRadius` and `minorRadius`. Add its residual to `surfaceResidual`:
   `abs(sqrt((radial - majorRadius)^2 + axial^2) - minorRadius)`. Add
   `parameters` serialization and certificate checks (positive radii, unit axis,
   sampled boundary on torus). General torus/plane sectioning is a quartic and
   can remain unsupported initially; the fillet torus boundaries are known
   circles, so the round itself does not need a general torus intersection.

The existing `surfaceLineBoundaries` / `surfaceSharedLineBoundaries` /
`surfaceCurveBoundaries` counters already give the right observability for
spring curves.

### 4.2 Inference

Replace "arc pair first" with "support pair + edge + radius first", using drawn
evidence only to select parameters:

1. Identify an edge shared by two surfaces (or by two drawn face regions) and a
   radius/radius law. Evidence can be a true-shape arc, a dimension, a declared
   fillet, or an explicit `#` directive. If several candidates fit, report
   `fillet-ambiguous` rather than choosing one.
2. Determine convexity/material side from face orientation. If it cannot be
   determined, report `fillet-concavity-ambiguous`.
3. Offset the supports by `sigma r` and intersect the offsets to get the spine:
   - plane/plane: exact line, linear solve (section 1.1);
   - plane/cylinder: offset plane/cylinder section (line, circle or ellipse);
   - cylinder/cylinder coaxial: offset cylinders (circle or none);
   - unsupported pair: refuse with `fillet-support-pair-unsupported`.
4. Project the spine onto each support to get the spring curves. For
   plane/plane these are exact lines; for plane/cylinder they are a line, circle
   or ellipse depending on orientation; for torus cases they are circles.
5. Classify the blend surface from the spine/radius table in section 1.1:
   cylinder, cone, torus, sphere, or refuse/B-spline fallback.
6. Validate tangency analytically: distance from the spine to each support
   equals `r`; spring points lie on both the support and the blend; the blend
   normal at each spring point agrees with the support normal within tolerance.

The existing view-based inference remains useful as an **evidence adapter**: it
already finds a true-shape arc, tangent edges, generator lines and end stations.
It should produce a candidate `{supportPlanes, edge, radius, endStations}`
record, not the final geometry. The final geometry comes from the offset solve.
This also removes the current requirement that both generator lines be drawn;
they can be derived and then checked against any drawn strokes.

### 4.3 Tangent continuity

- Cylinder/plane: exact G1 along both spring lines by construction. Check
  `distance(axis, plane) = r` and `springPoint = C - sigma r n`.
- Cone/plane (linear radius): exact G1 along both spring lines; check the cone
  half-angle against the radius law and the spine direction.
- Torus/plane or torus/cylinder: exact G1 along the two contact circles; check
  `majorRadius`, `minorRadius`, centre and axis against the offset construction.
- Sphere corner: exact G1 along the three (or more) contact arcs; check the
  sphere centre solves the three offset-plane equations.
- Do **not** claim G2 for a constant-radius cylinder/cone/torus blend. The
  curvature generally jumps at the spring curve. Record `continuity:'G1'` in the
  blend record and in the certificate. A future G2 blend must use a
  variable-radius or B-spline surface and should be marked approximate/numeric.

### 4.4 Trimming adjacent faces

Add one public operation:

```js
Surfaces.trimByBoundary(surface, boundary, side, geometry, diagnostics)
```

- Plane + line: exact half-plane clip of the planar loop/polygon. Replace the
  clipped chain with the exact line object. This covers the plane/plane round.
- Plane + circular arc: exact 2D profile clip in the face plane. Split polygon
  edges at the arc intersections, insert the arc, keep the material side. This
  covers a block end face with a rounded corner.
- Cylinder/cone + circle/line: trim along a generator or circle. Start with the
  line generator (plane/cylinder round along a line parallel to the axis) and
  the circle (rim round); refuse general curves.
- Preserve boundary object identity. The trimmed support and the blend must
  reference the same spring line/arc object, so `Surfaces.incidence` sees
  `useCount: 2` without resampling.
- Refuse if the boundary is off the surface, if the loop crosses the boundary
  in an unsupported way, or if the kept region is disconnected. Report a
  specific `trim-*` code; do not approximate.

For the first milestone, the end faces can be constructed directly from the
known end profile rather than through a general trim. The general operation is
still the right long-term API.

### 4.5 End and corner handling

**Open end / runout.** If the blend ends at a planar face, the end cross-section
is a circular arc in that plane. Trim the end face by the arc and share the arc
with the blend. If the blend ends at a free boundary, leave it open and report
`fillet-end-open`; do not invent a cap.

**Two-edge corner.** If two blends meet at a vertex, first try the exact cases:

- equal radii, three mutually suitable planes -> sphere patch;
- equal radii and the OCCT `ToricRotule` condition (third face perpendicular to
  the other two) -> torus patch;
- otherwise refuse `fillet-corner-unsupported` until a filling patch exists.

**Three-edge corner.** Equal radii and a trihedral plane corner: solve the
three offset-plane equations for the sphere centre. If the geometry matches the
OCCT `ToricCorner` condition, use a torus. Otherwise refuse or use a future
`n`-sided/Gregory/Coons fill.

**Four or more edges.** Refuse explicitly. This matches OCCT's documented
limitation and avoids inventing a topology.

**Setback.** Add `setback:{start,end}` to the blend record. For each edge blend,
cut the blend at a plane normal to the edge at the setback distance; the cut
curve becomes an end boundary. The corner patch connects the cut curves. For
equal radii and a suitable trihedral corner, the corner patch can still be a
trimmed sphere/torus. For unequal radii or 4+ edges, a B-spline/Gregory fill is
required; refuse until implemented. Do not silently ignore a requested setback.

**Chain.** Propagate a contour across tangent-continuous edges. Split at
vertices; each segment gets its own blend surface. At a shared vertex, require
the radius laws to agree (`fillet-radius-discontinuity` otherwise). Build corner
patches after all incident segments are known. Start with single-edge blends;
add chains only after corner patches are sound.

### 4.6 Watertightness

A closed shell is a combinatorial property of the boundary graph, not of the
display mesh:

- every boundary element has exactly two uses;
- every connected component is closed;
- no boundary is self-shared or non-manifold;
- the certificate status is `ok`.

For a rectangular block with one rounded edge, the closed complex is:

```text
1 cylinder (fillet)
2 side planes (trimmed by the spring lines)
2 end planes (each trimmed by one end arc)
1..N remaining block faces (unchanged)
```

The cylinder's four boundaries are the two spring lines and the two end arcs.
Each spring line is shared with a side face; each end arc is shared with an end
face. The side and end faces share their other edges with the remaining block
faces. When all of those are present, the shell is closed and the certificate
can be `ok`.

Two practical requirements:

1. **Analytic loops first.** Create the shared boundary objects before building
   display faces. The certificate only trusts the analytic loops; the display
   mesh must not be the source of truth.
2. **Shared tessellation samples.** The cylinder and the end faces must use the
   same sample stations on the end arcs; the cylinder and the side faces must
   use the same endpoints on the spring lines. Otherwise `surfaceValidation`
   will show cracks even when the analytic certificate is `ok`. The current
   `addCylindricalFillet` already shares `lowDV`/`highDV` between the cylinder
   and strips; extend that pattern to the end caps and back face.

If the surrounding faces are missing, keep `closure:'open'` and report the
specific missing end/corner. A `partial` certificate is correct in that case.

### 4.7 Failure and diagnostics

Follow the mature-system pattern: compute what is sound, retain it, and name the
shortfall. Suggested codes:

- `fillet-support-missing` — edge not shared by two supports;
- `fillet-support-pair-unsupported` — no analytic offset intersection;
- `fillet-tangent-support` — supports meet G1 or are parallel;
- `fillet-radius-invalid` — non-positive, too large, or violates local curvature;
- `fillet-concavity-ambiguous` — material side unknown;
- `fillet-ambiguous` — multiple support/radius/end candidates;
- `fillet-end-open` — no end face/free boundary;
- `fillet-corner-unsupported` — 4+ edges, unequal radii without fill, or setback
  without corner patch;
- `fillet-radius-discontinuity` — chain segments disagree at a vertex;
- `fillet-self-intersection` — spring curve loops or blend surface self-intersects.

## 5. What is analytically achievable

### 5.1 Exact with plane/cylinder/cone/sphere

| Configuration | Exact blend | Notes |
|---|---|---|
| Plane/plane, straight edge, constant `r` | cylinder | Exact; current feature is this surface, but without support-based construction/trimming. |
| Plane/plane, straight edge, linear `r(t)` | cone (possibly truncated) | Spine is a line if `r` is linear; spring curves are straight lines. This is the first variable-radius extension. |
| Plane/cylinder, edge line parallel to the cylinder axis, constant `r` | cylinder | Offset plane/cylinder intersection is a line; spring lines are generators. |
| Trihedral plane corner, equal `r` | sphere patch | Solve three offset-plane equations for the centre. |
| Two-fillet corner, equal `r`, suitable perpendicular third face | torus (OCCT `ToricRotule`) or sphere | Exact only under the documented geometric conditions. |
| Three-fillet corner, equal `r`, trihedral planes | sphere patch | Exact; boundary arcs are the fillet end sections. |
| Sphere/plane or sphere/cylinder circular edge (edge plane perpendicular to the axis), constant `r` | torus | Offset sphere/cylinder intersection is a circle; verify tangency. |

### 5.2 Requires torus

| Configuration | Why torus |
|---|---|
| Cylinder/plane rim round (boss on a plate) | Spine is a circle; constant-radius envelope is a torus. |
| Coaxial cylinder/cylinder round | Offset cylinders intersect in a circle; torus. |
| Cone base circle round | Offset cone/plane intersection is a circle; torus (verify cone/torus tangency). |
| Sphere/plane circular edge (edge plane perpendicular to the sphere radius) | Offset sphere/plane intersection is a circle; torus. |
| Toric corner (OCCT `ToricRotule`/`ToricCorner`) | Corner surface is a torus subset. |

A torus patch is not representable with the current `plane`/`cylinder`/`cone`/
`sphere` kinds. Add it when circular-edge rounds enter scope; do not fake a
torus with a cylinder patch.

### 5.3 Requires B-rep / B-spline / Coons/Gregory fill

| Configuration | Why |
|---|---|
| General non-planar support pair (plane/cone oblique, cylinder/cone, free-form) | Spine is a general space curve; envelope is a canal surface, not a natural quadric. |
| Variable radius with a non-linear law | Offset-intersection is invalid for variable offsets; requires marching/approximation. |
| Unequal-radius two/three-edge corners | No single sphere/torus satisfies all radii; `n`-sided/Gregory/Coons fill. |
| Four-or-more-edge corners | Multi-sided vertex blend. |
| Setback corners with unequal radii or general geometry | Trimmed corner patch with `n` sides; often Gregory/B-spline. |
| G2 blends | Constant-radius surfaces have a curvature jump at the spring curve; G2 needs a different profile/reparameterization. |

### 5.4 Requires mesh/SDF fallback

Only when no analytic surface/trimming can be produced, or for a deliberately
approximate preview. The fallback must be labeled `approximate`/`displayOnly`,
must not enter the analytic certificate as an exact surface, and must not
silently replace a refused analytic blend. libfive-style smooth-min is a good
visual fallback, not a certificate.

## 6. API sketch and pseudocode

### 6.1 Public API

```js
// Construct one blend from supports and an edge. Pure with respect to the
// input model: returns a new surface record plus the updated supports.
Surfaces.fillet(model, {
  edge: {kind:'line', start:{...}, end:{...}} |
        {kind:'circle', center:{...}, u:{...}, v:{...}, radius:10},
  supports: ['surface:1', 'surface:2'],
  radius: 10 |
          {kind:'linear', start:10, end:20} |
          {kind:'law', samples:[{u:0,r:10},{u:1,r:20}]},
  setback: {start:0, end:0},
  continuity: 'G1',
  trim: true,
  corners: 'refuse' | 'sphere' | 'torus' | 'auto'
})
```

Returns:

```js
{
  surface,                    // cylinder | cone | torus | sphere record
  springCurves: [c1, c2],     // shared boundary objects
  trimmedSupports: [s1, s2],  // clones with replaced loops
  endBoundaries: [e1, e2],    // end arcs/circles if closed
  corner: null | {kind:'sphere'|'torus'|'fill', surface, boundaries},
  model,                      // updated model with shared boundaries
  diagnostics: []
}
```

The existing `.edu` `surface-query` grammar can expose this as a new operation
after it exists:

```text
# surface-query: {"operation":"fillet","surfaces":[0,1],"radius":10,"expect":{"surface":{"kind":"cylinder","radius":10},"springCurves":{"length":2}}}
```

### 6.2 Plane/plane constant radius

```text
function planePlaneRound(A, B, edge, r, sigma):
    n1, n2 = unit outward normals of A, B
    if |n1 x n2| < tol: return error('fillet-tangent-support')
    e = unit(n1 x n2); orient e along edge
    denom = 1 + dot(n1, n2)
    if denom < eps: return error('fillet-tangent-support')
    u = sigma * (n1 + n2) / denom
    C0 = solve:
        n1 . C0 = d1 + sigma*r
        n2 . C0 = d2 + sigma*r
        C0 . e  = edge.start . e
    spine = line(C0, e)
    spring1 = line(C0 - sigma*r*n1, e)
    spring2 = line(C0 - sigma*r*n2, e)
    cyl = cylinder(origin=C0, axis=e, radius=r)
    cyl.loop = orderedCycle([spring1, endArcHigh, spring2, endArcLow])
    trim A by spring1; trim B by spring2
    return cyl, spring1, spring2
```

Check after construction: `distance(spine, A) == r`, `distance(spine, B) == r`,
`spring_i` lies on both `A`/`B` and `cyl`, and the cylinder normal at
`spring_i` equals the support normal within `surfaceTolerance`.

### 6.3 Plane/plane linear variable radius

```text
function linearRadiusRound(A, B, edge, r0, r1, sigma):
    u = sigma * (n1 + n2) / (1 + dot(n1,n2))
    # u is perpendicular to the edge, so C(t) below is affine.
    P(t) = edge.start + t * (edge.end - edge.start)
    r(t) = r0 + t * (r1 - r0)
    C(t) = P(t) + r(t) * u
    # C(t) is affine because both P and r are affine -> a straight spine.
    spine = line(C(0), C(1))
    T = unit(spine.end - spine.start)
    k = (r1 - r0) / length(spine.end - spine.start)  # dr/ds
    if abs(k) >= 1: return error('fillet-radius-law-unsupported')
    halfAngle = asin(abs(k))
    apex = C(0) - (r0 / k) * T if abs(k) > eps else undefined
    # Choose origin/radius consistently with the apex and halfAngle; the
    # cone's radius at the origin station is r(origin)/cos(halfAngle).
    cone = cone(apex=apex, axis=T, halfAngle=halfAngle, ...)
    spring_i(t) = C(t) - sigma * r(t) * n_i   # straight lines
    return cone, spring1, spring2
```

The `asin` (not `atan`) is the exact relation for a canal surface with linear
radius along a straight spine: in the axial cross-section the envelope line is
tangent to the family of circles, so `dr/ds = sin(halfAngle)`. If `r0 == r1`,
return the cylinder case. If the radius law is not linear, refuse
(`fillet-radius-law-unsupported`) until a canal/B-spline fallback exists.

### 6.4 Circular edge / torus

```text
function circularEdgeRound(plane, cylinder, r, sigma):
    # convex external example: plane z=0, cylinder radius R about z
    # offset plane: z = sigma*r
    # offset cylinder: radius R + sigma*r
    Ccircle = intersection(offsetPlane, offsetCylinder)
    if not a circle: return error('fillet-support-pair-unsupported')
    torus = torus(center=Ccircle.center, axis=cylinder.axis,
                  majorRadius=Ccircle.radius, minorRadius=r)
    springPlane = circle on plane of radius Ccircle.radius
    springCyl   = circle on cylinder of radius R
    return torus, springPlane, springCyl
```

Choose the sign from material side and verify that the torus is tangent to both
supports along the two circles. Do not assume the sign from a single drawing
view.

### 6.5 Trihedral equal-radius corner

```text
function trihedralCorner(F1, F2, F3, r, sigma):
    n1,n2,n3 = outward normals; d1,d2,d3 = plane offsets
    C = solve 3x3:
        n1 . C = d1 + sigma*r
        n2 . C = d2 + sigma*r
        n3 . C = d3 + sigma*r
    if no unique finite solution: return error('fillet-corner-unsupported')
    sphere = sphere(center=C, radius=r)
    # The corner patch is the part of the sphere facing the material-side
    # corner. Its boundary arcs are the end sections of the incident blends.
    return sphere
```

For two incident fillets, use the OCCT `ToricRotule` condition as a guide; for
three, use `ToricCorner`/`c1spheric`. If the exact conditions are not met,
refuse rather than approximating a corner with a sphere that is not tangent to
all incident blends.

### 6.6 Trimming

```text
function trimPlaneByLine(face, line, keepSide):
    # face is planar; line lies in the face plane
    # 1. classify each loop vertex against the line's signed 2D distance
    # 2. split crossing polygon edges at the line
    # 3. keep the requested side
    # 4. replace the clipped chain with the exact line object
    # 5. return a clone; do not mutate the input face
    if loop crosses line in an unsupported way: return error('trim-crossing-unsupported')
    if kept region is disconnected: return error('trim-disconnected')
    return clone with replaced loop
```

For a plane/arc trim, the same algorithm uses the arc's implicit circle and
keeps the side selected by the material test. Start with line and circular-arc
boundaries; refuse general curves.

## 7. `.edu` test plan

The runner is the only test suite (`node tools/edc.js <file.edu>`), per
`AGENTS.md`. All new fixtures should use `# expect:` properties and
`surface-query` records; no separate unit tests.

| Fixture | Drawing / operation | Expected |
|---|---|---|
| `fillet-closed-corner.edu` | Extend the current `fillet-line-boundary.edu`: add a back plane through the two strip outer edges and two planar end caps. This is a **closure test solid**, not a part. | `fillets=1`, `surfaceKinds=cylinder,plane`, `surfaceLoops=6`, `surfaceShells=1`, `surfaceOpen=0`, `surfaceBoundary=0`, `surfaceModel=ok`, `surfaceCertificate=ok`, `surfaceCertificateIssues=none`, `surfaceLineBoundaries=10`, `surfaceSharedLineBoundaries=10`, `surfaceCurveBoundaries=2`, `surfaceValidation=ok`. V/E/F counts to be fixed by the first run; do not guess them. |
| `fillet-closed-block.edu` | A rectangular block with one long edge rounded R10. Draw the block faces, the true-shape end arc, the tangent spring lines, and both end faces. | Same surface/certificate shape, but `surfaceKinds=cylinder,plane` with the block's full face set; one closed shell; `fillets=1`; `surfaceOpen=0`, `surfaceBoundary=0`, `surfaceCertificate=ok`. |
| `fillet-spring-derivation.edu` | Block edge with supports and radius but **no drawn generator lines**. | The spring lines are derived from the offset planes; `surface-query` `intersect` of the cylinder and each support returns `kind:'line'`, `relation:'tangent'`; `surfaceSharedLineBoundaries=2`; no `fillet-boundary-missing`. |
| `fillet-linear-radius.edu` | Same block edge with R10 at one end and R20 at the other, declared by two true-shape end arcs or a radius law. | `surfaceKinds=cone,plane`; cone `halfAngle` matches the law; both spring lines shared; closed shell; `fillets=1`; certificate `ok`. |
| `fillet-torus-rim.edu` | Cylindrical boss on a plate, top rim rounded R5. | `surfaceKinds=torus,plane,cylinder`; torus `majorRadius`/`minorRadius` exact; two circular spring curves shared; closed shell; `surfaceCertificate=ok`. |
| `fillet-corner-sphere.edu` | Trihedral block corner with three equal-radius edge blends. | Sphere corner patch, radius R; three incident spring/end arcs shared; one closed shell; `surfaceCertificate=ok`. |
| `fillet-corner-torus.edu` | Two fillets meet on a face perpendicular to the other two (OCCT `ToricRotule` condition). | Torus corner patch; shared boundaries; closed shell; certificate `ok`. |
| `fillet-corner-unequal.edu` | Three-edge corner with unequal radii. | Exact refusal `fillet-corner-unsupported`; retained partial blends; no false `ok`; `surfaceCertificate=partial` or `issues` with the named code. |
| `fillet-chain.edu` | Two tangent-continuous edges blended with the same radius. | Two cylinder patches; shared end arc at the tangent junction; `fillets` count 1 chain or 2 segments (define in the fixture); closed shell where faces exist. |
| `fillet-setback.edu` | Two-edge corner with explicit setbacks. | Deferred: exact refusal `fillet-corner-unsupported` until the corner patch exists; once implemented, trimmed sphere/torus/fill and closed shell. |
| `fillet-open-end.edu` | Fillet ends at a free boundary with no end face. | `fillets=1`, `surfaceOpen=1`, `surfaceBoundary=2` (or the expected count), `surfaceCertificate=partial` with `fillet-end-open`; no invented cap. |
| `fillet-tangent-support.edu` | Two supports meet G1. | `fillet-tangent-support`; no blend surface; wires retained. |
| `fillet-radius-too-large.edu` | Radius exceeds the available block thickness or local curvature. | `fillet-radius-invalid` or `fillet-self-intersection`; no clamped/approximated result. |

Concrete first-milestone expectation for `fillet-closed-corner.edu`:

```text
# expect: fillets=1 surfaceKinds=cylinder,plane surfaceLoops=6 surfaceShells=1 surfaceOpen=0 surfaceBoundary=0 surfaceModel=ok surfaceCertificate=ok surfaceCertificateIssues=none surfaceLineBoundaries=10 surfaceSharedLineBoundaries=10 surfaceCurveBoundaries=2 surfaceValidation=ok
```

Why these counts: the closed corner-bar complex has six surfaces (cylinder,
wall strip, floor strip, back plane, two end caps). Its ten distinct line
boundaries are the two spring lines, the wall/floor outer lines, the four strip
end lines, and the two new back end lines. All ten are shared twice. The two end
arcs are the only curve boundaries and are shared twice. This is a precise
combinatorial target independent of tessellation.

Query checks to include in the fixture:

```text
# surface-query: {"operation":"section","surface":0,"plane":{"origin":{"x":10,"y":10,"z":20},"normal":{"x":0,"y":0,"z":1}},"expect":{"kind":"circle","radius":10,"center":{"x":10,"y":10,"z":20}}}
# surface-query: {"operation":"intersect","surfaces":[0,1],"expect":{"kind":"line","relation":"tangent"}}
# surface-query: {"operation":"intersect","surfaces":[0,2],"expect":{"kind":"line","relation":"tangent"}}
```

The existing `fillet-line-boundary.edu` queries already cover the cylinder
section, tangent intersection and attachment; the new fixture should add the
closure and the second spring line.

## 8. Licensing and dependency notes

| Component | Version / commit | License | Implication for EduCAD |
|---|---|---|---|
| OCCT | 8.0.1, tag `V8.0.1`, commit `b8f597c...` | LGPL-2.1 with OCCT exception [18] | Could be used as a dynamically linked library with LGPL compliance; **not** suitable for vendoring into a zero-dependency MIT project. Do not copy source/comments. |
| FreeCAD | 1.1.4, tag `1.1.4`, commit `4fd3bf3...` | LGPL-2.1-or-later [19] | Reference only. Its fillet code is a thin OCCT wrapper; no independent algorithm to copy. Source headers carry `SPDX-License-Identifier: LGPL-2.1-or-later`. |
| libfive | master `918387a...` | MPL-2.0 (library/stdlib/Python); GPL-2.0+ (Studio/Guile) [14] | MPL is file-level copyleft; still an external dependency. Not suitable for the zero-dependency core. Algorithm ideas (smooth-min) can be reimplemented independently. |
| ACIS | R17 documentation | Proprietary | Documentation reference only. Do not copy code, text or figures. |
| Vida et al. 1994; Farouki & Sverrisson 1996; Rossignac & Requicha 1984 | papers | Publisher copyright | Cite; implement the mathematics independently. Algorithms and mathematical methods are not copyrightable, but prose/figures are. |
| EduCAD | MIT | MIT | New implementation remains MIT. |

No new npm dependency is recommended. The analytic construction in section 4
uses only the existing vector helpers and the existing `.edu` runner. OCCT,
FreeCAD and libfive are references for architecture and failure behavior, not
runtime dependencies.

## 9. Ranked recommendation and minimal next milestone

### 9.1 Ranked options

| Rank | Option | Effort | Why |
|---|---|---|---|
| **1** | **Close the existing constant-radius feature into a watertight corner-bar test solid**: exact spring lines, two planar end caps sharing the end arcs, one back plane sharing the strip outer lines. | S–M | Uses only the existing `cylinder`/`plane` model. Proves spring/end boundary sharing, trimming-by-construction, incidence-2 closure and `certify=ok` before adding new surface families. Directly fixes the current "open feature patch" gap. |
| **2** | **Support-first construction + real block integration**: solve the offset planes for the spine and spring lines, trim a rectangular block's two side faces, construct the two end faces, and certify one closed shell. | M | Removes dependence on drawn generator lines and makes the fillet a real part feature. Reuses the closure machinery from rank 1. |
| **3** | **Torus surface kind + circular-edge rounds**: boss/plate rim, coaxial cylinder, cone base. | M–L | Adds the most common analytic round that is not a cylinder. Requires a new surface kind, residual/certificate checks, and circle trims, but no general surface intersection. |
| **4** | **Corner patches**: sphere for equal-radius trihedral corners, torus for the OCCT `ToricRotule`/`ToricCorner` conditions, then a Coons/Gregory/B-spline fill for unequal radii and 4+ edges. | L | Turns chains of edge blends into closed corners. Start with exact sphere; refuse the rest until fill exists. |
| **5** | **Fillet chains + linear variable radius**: propagate across tangent edges, split at vertices, match radius laws; represent a linear law as a cone. | L | Covers common engineering rounds and the first variable-radius case without a general canal surface. |
| **6** | **General variable radius, setback, G2, B-spline/canal fallback**. | XL | Requires marching/approximation, multi-sided fills and a numeric certificate path. Do last; do not let it block the exact cases. |

### 9.2 Minimal next milestone (recommended)

Implement **rank 1** first:

> Extend `fillet-line-boundary.edu` (or add `fillet-closed-corner.edu`) so the
> existing partial cylinder, two plane strips and two end arcs are closed by
> two planar end caps and one back plane. The end caps share the two end arcs
> with the cylinder and the strip end lines with the strips; the back plane
> shares the two strip outer lines. Compute/retain the two spring lines as exact
> shared line objects. Expect one closed shell:
>
> `surfaceLoops=6`, `surfaceShells=1`, `surfaceOpen=0`, `surfaceBoundary=0`,
> `surfaceCertificate=ok`, `fillets=1`, `surfaceLineBoundaries=10`,
> `surfaceSharedLineBoundaries=10`, `surfaceCurveBoundaries=2`.
>
> Out of scope for this milestone: torus, variable radius, corner patches,
> chains, setbacks, real block-face integration. If the drawing lacks an end
> face, keep the feature open with `fillet-end-open`; do not fabricate one.

This milestone is deliberately a **test solid**, not an engineering part. It
exercises the exact closure arithmetic that the real block integration needs,
with no new surface family and no Boolean operation. Rank 2 then swaps the
synthetic strips for the actual block faces and reuses the same end caps/spring
lines.

### 9.3 Design rules to keep

- Prefer exact spring curves from offset supports over drawn tangent edges.
- Share boundary objects; never resample a seam and call it shared.
- Refuse with a specific diagnostic rather than approximating an analytic case.
- Keep the analytic certificate independent of the display mesh.
- Do not claim G2 for a constant-radius blend.
- Do not add torus/B-spline complexity before the cylinder/plane closure is
  watertight.

## 10. Evidence, assumptions and unverified claims

### Verified by source reading

- OCCT 8.0.1 API, `ChFiDS_*` data structures, walking/`Blend_Point` pipeline,
  exact plane/plane cylinder construction, torus/sphere corner special cases,
  filling fallback, and the documented 4+ edge limitation.
- FreeCAD 1.1.4's use of `BRepFilletAPI_MakeFillet`, `Add(radius1, radius2,
  edge)`, constant PartDesign radius, C0-edge filtering, and validity checks.
- libfive's `blend_expt`/`blend_rough`/`offset`/`shell` definitions and its
  MPL-2.0/GPL-2.0+ licensing statement.
- ACIS R17's documented offset/spine/spring algorithm, surface-type table,
  variable-radius marching, setback definition and Gregory-patch fallback.
- The current EduCAD fillet implementation's boundaries, incidence, certificate
  status and `.edu` expectations, by reading the source and running the three
  existing `fillet-*.edu` fixtures.

### Derived but not implemented/tested

- The plane/plane bisector formula, the linear-radius cone construction, the
  torus offset construction, and the trihedral sphere-corner solve are
  geometric derivations. They are consistent with OCCT/ACIS descriptions but
  have not been implemented or numerically checked in EduCAD.
- The proposed `trimByBoundary` behavior for plane/line and plane/arc is a
  design, not an implemented operation.
- The expected `surfaceLineBoundaries=10`/`shared=10` counts for
  `fillet-closed-corner.edu` are a combinatorial count from the proposed
  topology, not a run result. V/E/F counts are intentionally omitted.
- The claim that a torus is tangent to a cone along the base circle, and to a
  sphere along a latitude circle, is a geometric derivation; verify with a
  fixture before adding those cases.

### Assumptions

- The current fixture is drawn as a convex external round; the inference itself
  does not certify material side. "Fillet" is used generically in the code and
  this note.
- Supports are non-degenerate planes/cylinders/cones/spheres; the radius is
  small enough that the blend does not self-intersect; the material side is
  known or can be inferred.
- The first milestone uses the existing synthetic strip extents; the back plane
  is planar only when the two strip outer edges are coplanar. The current
  fixture's equal extents satisfy that; a general fixture must check it or use a
  ruled/other closure.
- No G2 requirement in the first milestones.

### Unverified / limits of this survey

- OCCT, FreeCAD and libfive were not built or executed in this round. Their
  behavior is described from source and documentation, not from runtime
  experiments.
- OCCT's corner selection is more complicated than the two named predicates
  (`ToricRotule`, `ToricCorner`); the summary is a simplification of a large
  decision tree.
- FreeCAD UI behavior can vary by build and version; the 1.1.4 source is
  authoritative for this note.
- ACIS R17 documentation is a proprietary mirror; it may not match current ACIS
  behavior. It is used only as an algorithm reference.
- The exactness claim for libfive's `blend_expt` (not a circular arc) is an
  analytical reading of the formula; it was not numerically compared with a
  constant-radius fillet.
- License notes are summaries, not legal advice. Any actual dependency use
  requires a license review.

## References

1. Open CASCADE Technology 8.0.1, tag `V8.0.1`, commit
   `b8f597c677811d1f9f4d8a97f5ae2825c0353a42` —
   <https://github.com/Open-Cascade-SAS/OCCT/tree/V8.0.1>.
2. OCCT Modeling Algorithms, "Fillets and Chamfers" —
   <https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html#occt_modalg_6>.
3. `BRepFilletAPI_MakeFillet.hxx` —
   <https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ModelingAlgorithms/TKFillet/BRepFilletAPI/BRepFilletAPI_MakeFillet.hxx>.
4. `BRepFilletAPI_MakeFillet` reference —
   <https://dev.opencascade.org/doc/refman/html/class_b_rep_fillet_a_p_i___make_fillet.html>.
5. `ChFiDS_Spine.hxx`, `ChFiDS_Stripe.hxx`, `ChFiDS_SurfData.hxx`,
   `ChFiDS_FaceInterference.hxx` —
   <https://github.com/Open-Cascade-SAS/OCCT/tree/V8.0.1/src/ModelingAlgorithms/TKFillet/ChFiDS>.
6. `ChFi3d.hxx`, `ChFi3d_FilBuilder.cxx`, `ChFi3d_Builder.cxx`,
   `BlendFunc_ConstRad.hxx`, `BlendFunc_EvolRad.hxx`,
   `BRepBlend_Walking.hxx`, `BRepBlend_Line.hxx`, `Blend_Point.hxx` —
   <https://github.com/Open-Cascade-SAS/OCCT/tree/V8.0.1/src/ModelingAlgorithms/TKFillet>.
7. `ChFiKPart_ComputeData_FilPlnPln.cxx` —
   <https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ModelingAlgorithms/TKFillet/ChFiKPart/ChFiKPart_ComputeData_FilPlnPln.cxx>.
8. `FilletSurf_Builder.hxx` / reference —
   <https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ModelingAlgorithms/TKFillet/FilletSurf/FilletSurf_Builder.hxx>,
   <https://dev.opencascade.org/doc/refman/html/class_fillet_surf___builder.html>.
9. `ChFi3d_FilBuilder_C2.cxx` (`ToricRotule`),
   `ChFi3d_FilBuilder_C3.cxx` (`ToricCorner`, `c1spheric`, filling) —
   <https://github.com/Open-Cascade-SAS/OCCT/tree/V8.0.1/src/ModelingAlgorithms/TKFillet/ChFi3d>.
10. FreeCAD 1.1.4, `src/Mod/Part/App/FeatureFillet.cpp` —
    <https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Part/App/FeatureFillet.cpp>.
11. FreeCAD 1.1.4, `src/Mod/Part/Gui/DlgFilletEdges.ui` —
    <https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Part/Gui/DlgFilletEdges.ui>.
12. FreeCAD 1.1.4, `src/Mod/PartDesign/App/FeatureFillet.cpp` and
    `FeatureDressUp.cpp` —
    <https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/PartDesign/App/FeatureFillet.cpp>,
    <https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/PartDesign/App/FeatureDressUp.cpp>.
13. ACIS R17 documentation, "Blend Geometry" and "Setbacks" (proprietary
    reference, mirrored) —
    <http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_moblndbg.htm>,
    <http://www-isl.ece.arizona.edu/ACIS-docs/HTM/DATA/BLND/BLND/01CMP/0011.HTM>.
14. libfive, commit `918387a9220dbac2f7ab32fb35e274c6794439cf`; standard library
    implementation and header; license statement —
    <https://github.com/libfive/libfive/tree/918387a9220dbac2f7ab32fb35e274c6794439cf>,
    <https://github.com/libfive/libfive/blob/918387a9220dbac2f7ab32fb35e274c6794439cf/libfive/stdlib/stdlib_impl.cpp#L79-L94>,
    <https://github.com/libfive/libfive/blob/918387a9220dbac2f7ab32fb35e274c6794439cf/libfive/stdlib/libfive_stdlib.h#L40-L68>,
    <https://github.com/libfive/libfive/blob/918387a9220dbac2f7ab32fb35e274c6794439cf/README.md#license>.
15. J. Vida, R. R. Martin, T. Varady, "A survey of blending methods that use
    parametric surfaces", *Computer-Aided Design* 26(5), 1994, 341-365,
    <https://doi.org/10.1016/0010-4485(94)90023-X>.
16. R. A. Farouki, R. Sverrisson, "Approximation of rolling-ball blends for
    free-form parametric surfaces", *Computer-Aided Design* 28(11), 1996,
    871-878, <https://doi.org/10.1016/0010-4485(96)00008-5>.
17. J. R. Rossignac, A. A. G. Requicha, "Constant-radius blending in solid
    modeling", *Computers in Mechanical Engineering* 3(1), 1984, 65-73; cited
    second-hand through [15] and later reviews.
18. OCCT licenses —
    <https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/LICENSE_LGPL_21.txt>,
    <https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/OCCT_LGPL_EXCEPTION.txt>.
19. FreeCAD 1.1.4 license —
    <https://github.com/FreeCAD/FreeCAD/blob/1.1.4/LICENSE>.
20. FreeCAD 1.1.4 release —
    <https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.4>.

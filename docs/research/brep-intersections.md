# Surface–surface intersection and B-rep topology

**Status:** research/design note, not an implementation claim.
**Scope:** Major (the original EduCAD app). Major2 is out of scope.
**Baseline:** `43d3b7f` (`Document cylindrical fillet and line boundary support`).
**Date:** 2026-11-11.

This note studies how mature open-source kernels compute surface–surface
intersection and maintain B-rep topology, compares them with the bounded
analytic model in `public/lib/educad-surfaces.js`, and recommends a staged
design for EduCAD. It deliberately does not copy kernel code; the references
are documentation and source used to understand behaviour and interfaces.

The short version:

- EduCAD already has a useful **analytic support algebra** and a **shared
  boundary identity** model. What it lacks is a general, bounded **patch
  intersection** layer: it does not clip a support intersection to the two
  patches, it has no general point-in-patch test, and it cannot turn an
  arbitrary intersection branch into shared topology.
- OCCT solves this with a large hybrid B-rep architecture: analytic–analytic,
  analytic–parametric and parametric–parametric intersection classes, then a
  separate Boolean data structure with tolerance-aware interference,
  classification and pcurves.
- CGAL solves the degeneracy problem with exact predicates/constructions and
  arrangements/Nef polyhedra. It is the strongest correctness oracle, but its
  high-level packages are GPL and its exact arithmetic is not a good fit for a
  zero-dependency browser app.
- Manifold solves the mesh-Boolean problem with exact **topology** and
  floating-point **geometry**: manifold input, half-edge topology, a BVH,
  symbolic perturbation for exact float ties, and winding-number
  classification. It guarantees manifold output, not analytic curves or
  tolerance-independent geometry.
- The recommended path is a clean-room, dependency-free **bounded analytic
  patch intersection** layer: one tolerance policy, a general point-in-patch
  classifier, cut-station clipping of existing exact branches, then topology
  promotion and a generalized `splitByIntersection`. New analytic families and
  an optional mesh backend come later.

## 1. Problem statement and current limits

The problem is: given two bounded analytic surface patches `A` and `B`, each
with ordered boundary loops, produce the part of their support intersection
that lies on **both** patches, classify each resulting piece as a boundary,
contact or overlap, and make the retained pieces available to the topology
layer as shared vertices/edges. A support intersection that is not clipped to
the patch domains is not enough: it cannot tell a caller where the edge starts
and ends, whether the edge is already a shared seam, or whether a tangent
contact is a point rather than an edge.

### 1.1 What the current model represents

`public/lib/educad-surfaces.js` builds `geometry.surfaces` as bounded analytic
surfaces. A surface has a `kind` (`plane`, `cylinder`, `cone`, `sphere`), the
analytic parameters for that kind, ordered `loops`, `sourceIds`, optional
`displayFaceIndices`, and a `closed` flag for a complete sphere
(`docs/SURFACE_MODEL.md`, "Representation"). A loop is one of:

- a planar vertex loop (`vertices`);
- an analytic curve loop (`curves`, drawing-curve indices or inline curve
  objects);
- an inline closed `section` (circle/ellipse produced by `section`/`split`);
- a straight `lines` list of finite segments;
- an ordered `elements` list of `{kind:'curve',curve}` and
  `{kind:'polyline',points}` pieces produced by a crossing split.

The identity rule is important: a curve, section or line is shared when both
loops reference the **same object**, or when two line objects have the same
explicit `id` (`SURFACE_MODEL.md`, "Representation"; `incidence` in
`educad-surfaces.js`). `Surfaces.incidence` turns loops into a boundary-use
graph; `validate` and `certify` both consume it (`SURFACE_COMPLEX.md` §1).

### 1.2 What the current operations actually do

`Surfaces.section(surface, plane)` (line 1316) computes the analytic section of
the **supporting** surface by a plane. It does not use the surface's loops.
Plane–plane returns a line or `plane-overlap`; plane–sphere returns a circle or
tangent point; plane–cylinder returns a circle, ellipse, one/two generator
lines or none; plane–cone returns a circle, apex point, or a classified
`conic` (`ellipse`/`parabola`/`hyperbola`). The cone support is treated as a
double cone; the bounded nappe is selected by boundary geometry, not by the
axis sign (`SURFACE_MODEL.md`, "Intersections and trimming").

`Surfaces.intersect(a, b)` (line 1555) is a dispatch over exact support
families:

- plane–plane, including the coplanar `plane-overlap` case;
- plane–quadric via `section`;
- sphere–sphere, including external/internal tangency and coincidence;
- parallel/coaxial cylinder–cylinder, including tangent lines and coincidence;
- sphere–cylinder when the cylinder axis passes through the sphere centre,
  including the tangent circle and the two-circle case.

An unsupported pair returns `null`. A supported pair always returns a tagged
record with `kind`, `surfaceIds`, `surfaceKinds`, `relation` and a `reason` for
`none`. Results describe the **unbounded analytic support**; loops are not used
to clip anything (`SURFACE_MODEL.md` §"Limits"). Tolerances are relative
(`1e-6` of the largest relevant radius/distance) and are local to each
special-case formula (`tolerance`, line 1409).

`Surfaces.split(surface, plane, ...)` (line 2437, plan at 2336) is the only
operation that turns an intersection into topology. It is deliberately narrow:

- only `cylinder`, `cone` and `sphere` supports;
- the plane section must be a closed `circle` or `ellipse`;
- it handles a loop wholly on one side, or a crossing loop made of
  circle/ellipse/arc or inline polyline elements;
- it refuses planar faces, line sections, tangent points, classified conics,
  line-element crossings, and several topology classes.

For a crossing loop it finds analytic roots, splits the loop and the section at
the same stations, assembles same-side cycles, and shares the same section
sub-arc objects between the two pieces (`SURFACE_MODEL.md`, "Crossing-loop
algorithm"). This is the right pattern; it is specialised to a cutting plane
and to a few loop topologies.

`Surfaces.attachBoundary`/`shareBoundary` only promote an existing boundary
object into another loop. They do not clip either surface, orient material,
merge coincident loops, or remove an outer loop that the new loop should
replace. `Surfaces.intersectionCurves` promotes only closed circle/ellipse
results (and the two-circle sphere/cylinder result) into boundary curves; it
returns `null` for lines, points, conics and overlaps (`SURFACE_MODEL.md`,
"Intersections and trimming").

### 1.3 The concrete limits

| Limit | Current behaviour | Consequence |
|---|---|---|
| Support vs patch | `intersect` returns an unbounded line/circle/conic | A valid edge can extend outside both patches; callers cannot tell which part is a boundary |
| Bounded clipping | Only `split` by a plane clips loops | No general "intersection of two bounded patches" |
| Point-in-patch | `patchContainsPoint` handles sphere caps, cylinder bands with two loops, and cone bands/tips with two loops or one loop plus apex; otherwise `reason` | No holes, multiple loops, nested loops, or general planar faces |
| Classification | Exact special cases and `loopSide` extrema; no general IN/ON/OUT classifier | Tangency and near-coincidence are decided by local formulas, not one model-wide policy |
| Tangency | Point/tangent results exist for a few pairs; `TangentFaces`-like whole-patch tangency is absent | A tangent contact can be mistaken for a tiny transverse circle or dropped |
| Coincidence | `plane-overlap`, `coincident` for equal spheres/coaxial cylinders | No bounded overlap region; no 2-D overlap topology |
| Tolerance | `EPS=1e-7` in `section`, `1e-6` relative in `intersect`, `1e-5` relative in `surfaceTolerance` | Three different scales; small features can be classified differently by different operations |
| Topology | Shared boundary is object identity; vertices are not first-class; loops store separate arrays | Intersection endpoints do not become shared vertices automatically |
| General split | One plane at a time; no split by another surface or by an intersection branch | Boolean-like workflows cannot be built from the public API |
| Unsupported pairs | `null` for skew cylinders, offset-axis sphere–cylinder, cone–quadric, etc.; `{kind:'none'}` for a supported pair that misses | The `null` vs `none` distinction is a convention, not a diagnostic; there is no reason code for "not implemented" |

### 1.4 Why this matters for reconstruction

The project direction is to reconstruct surfaces from 2-D primitives and then
infer surfaces consistent with the views (`AGENTS.md`, "Reconstruction
pipeline"). A recess or fillet is only a special case of a bounded surface
complex; the general operation is "intersect two bounded surfaces, keep the
part that is on both patches, and make that part a shared boundary". Without
that operation, every new feature tends to add another recognizer or another
ad-hoc patch test. That is exactly the failure mode the project wants to avoid.

The existing `split` already demonstrates the desired topology pattern:
analytic cut stations, ordered sub-arcs, shared objects, incidence 2. The next
step is to make the cut source a **general bounded intersection branch**, not
only a plane section.

## 2. Candidate algorithms and architectures

### 2.1 Taxonomy

There are five practical ways to get from two surfaces to a boundary:

1. **Closed-form support algebra**, with no clipping. This is the current
   `intersect`.
2. **Closed-form support algebra plus bounded clipping**: compute the support
   branch, find its crossings with both patch boundaries, classify the
   intervals, and emit segments. This is the proposed base.
3. **Hybrid B-rep intersection**, as in OCCT: exact analytic cases, an
   analytic–parametric walker, and a parametric–parametric walker, then a
   separate topology/Boolean layer with tolerances and pcurves.
4. **Exact arrangement / Nef polyhedra**, as in CGAL: build the arrangement of
   curves or the Nef cell complex, using exact arithmetic so that degeneracies
   are not special cases.
5. **Mesh Boolean**, as in Manifold or CGAL's corefinement: tessellate, compute
   triangle–triangle intersections, and rebuild a manifold mesh. This is
   topology on a mesh, not analytic surface intersection.

A production kernel may combine 3, 4 and 5, but EduCAD should not need all of
them.

### 2.2 Candidate A: current exact support algebra

**Output:** an unbounded line, circle, circles, ellipse, conic, point,
plane-overlap, coincident or none.

**Complexity:** O(1) per pair for the closed-form cases; O(k) for a split's
loop stations, where k is the number of boundary elements. Memory is O(1) per
result.

**Robustness:** good for the exact families at the scale of a drawing. The
formulas are simple and easy to certify. The relative tolerance is local, so
near-degenerate cases can disagree with `validate` or `split`.

**Failure modes:** unsupported pairs; no bounded answer; tangency and
coincidence only for enumerated cases; a cone's oblique section is classified
but not parameterized, so it cannot become a boundary; `null` (unsupported)
and `{kind:'none'}` (supported but disjoint) are different shapes, but neither
carries a diagnostic code explaining why.

**Fit:** keep as the algebra layer. Do not throw it away.

### 2.3 Candidate B: bounded support algebra + cut-station clipping

**Idea:** keep the exact support branch, but treat it as a parameterized curve
on each surface. Find every parameter where the branch meets a patch boundary
or the natural domain boundary; sort the stations; classify the midpoint of
each interval with a general point-in-patch predicate; emit the intervals that
are inside both patches.

**Output:** a list of bounded analytic segments, each with a source branch, a
parameter interval, two endpoints, inside/outside/boundary states for both
patches, residuals, and a confidence label. Adjacent segments across a periodic
seam are merged; duplicate/overlapping branches are detected explicitly.

**Complexity:** for B branches, E boundary elements and R roots per branch,
roughly O(B · (E + R log R)); with the usual B=1 and one or two loops this is
O(E) plus sorting. Memory is O(segments + stations). Root finding is closed
form for line/circle/ellipse/arc; conics need root isolation. The expensive
part is not the algebra, it is the point classification and the number of
boundary elements.

**Robustness:** good if (a) the support branch is exact or certified, (b) the
station roots are isolated with a known tolerance, and (c) point-in-patch has
an explicit boundary/unknown state. It is much simpler than a full arrangement
because it never needs to compute all curve–curve intersections in parameter
space, only branch–boundary intersections.

**Failure modes:** a branch that lies along a boundary element (coincident
segment, not a transverse crossing); a branch that is tangent to a boundary
(tangent root, no interval change); a branch that self-intersects; singular
parameterizations (cone apex, sphere poles); a point-in-patch ray that hits a
vertex or is tangent to a loop; multiple loops/holes; periodic seams. These
must be explicit `unresolved` cases, not sampled guesses.

**Fit:** best base for EduCAD. It preserves the current exact algebra and the
current shared-object topology model.

### 2.4 Candidate C: OCCT-style hybrid B-rep

OCCT's `IntPatch` is not one algorithm. `IntPatch_Intersection` first
classifies the surface types and chooses one of three paths [O6]:

- analytic–analytic: `IntPatch_ImpImpIntersection` for Plane, Cone, Cylinder
  and Sphere patches [O7];
- analytic–parametric: `IntPatch_ImpPrmIntersection` for a natural quadric
  plus a bi-parametric surface [O8];
- parametric–parametric: `IntPatch_PrmPrmIntersection`, which approximates each
  surface by a polyhedron and uses a walking algorithm
  (`IntWalk_PWalking`) [O8].

The result is a set of `IntPatch_Line` objects: `GLine` (a conic), `ALine`
(a parameterized analytic curve), `RLine` (a restriction line on one surface,
used for coincident geometry), and `WLine` (a walking polyline) [O9]. The
intersector exposes `TangentFaces()` and `OppositeFaces()` for the case where
the two patches are considered entirely tangent, and `NbPnts()` for isolated
contact points [O5].

`GeomAPI_IntSS` is the simple two-`Geom_Surface` wrapper [O1][O2]. Its
documented domain is the natural parametric domain unless the surface is a
`Geom_RectangularTrimmedSurface` [O22]. Internally `GeomInt_IntSS` uses the
same `IntPatch` machinery, and for `RLine` it trims the curve against the
**rectangular** parameter bounds using `TrimILineOnSurfBoundaries`; it is not a
face-loop clip [O3][O4]. Face-level clipping and topology are the job of
`BRepAlgoAPI`/`BOPAlgo`.

The Boolean layer is separate. `BRepAlgoAPI_BooleanOperation` splits arguments
with the intersection results and combines the pieces as FUSE/COMMON/CUT/
SECTION [O10]. `BOPAlgo_PaveFiller` performs pairwise sub-shape intersections
in dimension order: vertex/vertex, vertex/edge, edge/edge, vertex/face,
edge/face, face/face, then vertex/solid, edge/solid, face/solid, solid/solid
[O11][O12]. It stores paves, pave blocks, common blocks, section edges and
pcurves in `BOPDS_DS`; the building step classifies the pieces into IN/ON/OUT
against the other arguments [O12].

**Complexity:** the analytic–analytic path is formula-driven. The
analytic–parametric and parametric–parametric paths are output-sensitive but
use polyhedral approximation and walking, so the constants and failure surface
are much larger. The Boolean phase is pairwise with bounding-box filtering;
the guide does not publish a worst-case asymptotic bound. A safe statement is
"roughly output-sensitive in practice; worst case quadratic in the number of
sub-shape pairs."

**Robustness:** production-hardened, but tolerance-driven. Argument shapes
must be valid and non-self-interfered; tolerances are per-shape; fuzzy values
and gluing modes are explicit user choices; tangency, tiny edges, bad
positioning and acquired self-interference are known failure classes
[O12].

**Fit:** too large to port. The architectural lesson is the separation of
support intersection, topology building and classification.

### 2.5 Candidate D: CGAL exact arrangements / Nef polyhedra

CGAL's approach is to avoid numerical degeneracy by using exact predicates and,
where needed, exact constructions.

- `Exact_predicates_exact_constructions_kernel` (EPECK) provides exact
  predicates and exact constructions; `Exact_predicates_inexact_constructions_kernel`
  (EPICK) provides exact predicates but inexact constructions [C5][C6]. This
  distinction matters: with EPICK the topology can be exact while the output
  embedding can still self-intersect after rounding.
- The 2-D Arrangements package builds a DCEL subdivision induced by
  x-monotone curves. It handles overlapping curves by merging the overlapping
  subcurves (the traits' merge functor) [C4]. It has traits for segments,
  conics, circles, Bézier curves and algebraic segments; the Bézier traits use
  filtering and fall back to exact algebraic computations for intersection
  points [C4].
- `Nef_polyhedron_3` is a B-rep for Nef polyhedra, closed under Boolean
  operations, complement, interior, boundary, closure and regularization. It
  is based on selective Nef complexes and local pyramids (sphere maps); point
  location returns the containing vertex, edge, facet or volume [C3]. Nef
  polyhedra handle non-manifold and lower-dimensional features exactly. The
  class works with halfspaces and oriented closed 2-manifolds; conversion from
  `Polyhedron_3` requires an oriented closed 2-manifold, and the package
  explicitly notes that general 2-manifold B-reps are not closed under Boolean
  operations [C3].
- CGAL's mesh Boolean/corefinement is a different package: it refines two
  triangle meshes so that their intersection polylines become edges, then
  computes union/intersection/difference. Exact predicates are the minimum for
  termination; exact constructions are recommended for consecutive operations;
  EPICK can leave a self-intersecting embedding [C1][C2]. Coplanar triangles
  are triangulated identically in both meshes and reported as constrained
  edges [C1].

**Complexity:** a sweep-line arrangement is typically O((n+k) log n) for n
curves and k intersections, with exact arithmetic and algebraic numbers adding
large constants; Nef operations are exact cell-complex operations whose cost
is driven by the output complex and can be much worse than the input size. CGAL
does not promise a simple worst-case bound that would be safe to quote without
qualification.

**Robustness:** the strongest of the three for degeneracies. Tangency,
coincidence and lower-dimensional contacts are represented rather than
special-cased. The price is exact arithmetic, algebraic numbers, memory, and
restricted input classes (Nef is polyhedral; it is not a curved-surface
kernel).

**Fit:** excellent as an offline oracle and for test-case generation; poor as
a browser runtime dependency. The high-level packages are GPL (see §7).

### 2.6 Candidate E: CGAL mesh corefinement

This is the closest CGAL analogue to a mesh Boolean. It computes intersection
polylines with `CGAL::Polygon_mesh_processing::intersection_polylines` (the
older `surface_intersection` is deprecated in CGAL 6.2) [C2]. It requires
non-self-intersecting input meshes; the Boolean functions require closed
manifold meshes bounding volumes, and the output must be representable as a
manifold mesh. Zero-thickness regions and non-manifold outputs are rejected or
need a special visitor [C1].

**Complexity:** AABB-tree broad phase plus exact predicates; typically
O((n+m+k) log(n+m)) for n and m triangles and k intersections, with exact
construction overhead. This is a practical statement, not a documented
worst-case guarantee.

**Robustness:** topology is exact with exact predicates; geometry is only as
exact as the kernel. It handles coplanar triangles consistently. It does not
produce analytic curves.

**Fit:** useful for an independent triangle-level check of a reconstructed
solid; not a replacement for the analytic surface model.

### 2.7 Candidate F: Manifold

Manifold is a mesh-Boolean library, not a B-rep kernel. Its documented
architecture is [M1][M2]:

- input and output are manifold triangle meshes; a non-manifold import gets an
  error status, and `Merge` is a best-effort repair;
- topology is exact integer connectivity; geometry is floating point;
- a BVH broad phase reduces the naive O(n²) triangle-pair test to O(n log n)
  work, parallelised when TBB is available;
- the Boolean is based on Julian Smith's algorithm, with the author's symbolic
  perturbation and a polygon triangulator that handles ε-valid degenerate
  polygons;
- intersections are found as edge–face pairs (`Intersect12`), and winding
  numbers (`Winding03`) classify vertices; the Boolean result is selected from
  the winding numbers [M3][M4];
- symbolic perturbation uses exact float equality as the tie-breaker
  (`Shadows(p,q,dir)`: if `p == q`, use `dir < 0`) and an axis-aligned
  projection to avoid introducing rounding error [M5];
- `kPrecision = 1e-12` is the baseline epsilon, scaled by the bounding box;
  `tolerance_` is a separate simplification tolerance that can be raised and
  causes coplanar merging and short-edge collapse [M6][M7][M8].

The wiki is explicit that the Boolean **does not account for tolerance**;
symbolic perturbation handles exact floating-point ties, not near-coincidence.
The guarantee is manifold output for manifold input. Geometric validity is
described by ε-valid input: there exists a perturbation of each vertex by less
than ε that is non-overlapping [M2].

**Complexity:** O(n log n) broad phase, output-sensitive after that; the number
of intersections can be O(n²) for contrived geometry. Memory is O(n + output).

**Robustness:** excellent for manifold mesh Booleans, including coplanar and
touching cases. It is not robust for non-manifold or self-overlapping input in
the sense of producing meaningful geometry; it may still produce manifold
output, but not the intended solid.

**Fit:** good optional preview/validation backend; not an analytic source of
truth, and it cannot represent the circles/ellipses/lines that EduCAD uses as
boundaries.

### 2.8 Candidate G: hybrid analytic + mesh fallback

Use analytic intersection and bounded clipping where the surface families are
supported; use a mesh Boolean only for display preview, independent validation,
or when the user explicitly accepts an approximate result. The analytic result
is authoritative when it exists; the mesh result must never be promoted to a
certificate.

**Complexity:** the analytic path dominates; the mesh path is the chosen mesh
kernel's cost. **Robustness:** depends on keeping the two paths separate and
labelled. **Failure mode:** inconsistent results between the analytic and mesh
paths; the UI must show which one is authoritative.

**Fit:** a reasonable later addition, not the first step.

### 2.9 Summary table

| Candidate | Output | Typical cost | Robustness | Main failure mode | Fit |
|---|---|---|---|---|---|
| A. Current support algebra | Unbounded analytic curve/point | O(1) per pair | Good exact families | No clipping; unsupported pairs | Keep as algebra |
| B. Bounded algebra + cut stations | Bounded analytic segments | O(B·(E + R log R)) | Good with a real classifier | Tangency, overlaps, singularities | **Recommended base** |
| C. OCCT hybrid B-rep | B-rep edges + pcurves + solids | Output-sensitive; large constants | Production-hardened | Tolerance/self-interference/tiny edges | Too large; learn architecture |
| D. CGAL arrangements/Nef | Exact arrangement / Nef complex | Exact arithmetic; output-driven | Strongest for degeneracy | Performance, algebraic degree, GPL | Offline oracle |
| E. CGAL mesh corefinement | Triangle intersection polylines / mesh Boolean | O((n+m+k) log(n+m)) typical | Exact topology, rounded geometry | Input restrictions; no analytic curves | Independent check |
| F. Manifold | Manifold triangle mesh Boolean | O(n log n) broad phase + output | Guaranteed manifold output | Non-manifold/self-overlap; no analytics | Optional preview |
| G. Hybrid | Analytic where possible, mesh fallback | Dominated by analytic path | Depends on separation | Inconsistent results | Later |

## 3. How OCCT, CGAL and Manifold handle the hard parts

### 3.1 Open CASCADE Technology 8.0.1

#### Topology and identity

OCCT's `TopoDS_Shape` is a handle to a `TopoDS_TShape` plus a
`TopLoc_Location` and a `TopAbs_Orientation` [O15]. `IsSame` means the same
TShape and location; `IsPartner` means the same TShape even if location and
orientation differ [O15]. This is the direct analogue of EduCAD's "same curve
object" sharing: topology is identity, not coordinate equality. `TopExp` maps
sub-shapes and their ancestors, e.g. edges to incident faces, which is the
lookup used by topology building [O16].

#### Intersection and topology

The low-level `IntPatch_Intersection` returns `IntPatch_Line` objects with
`GLine`, `ALine`, `RLine` and `WLine` subtypes [O5][O9]. It has explicit
tangent-face and opposite-face flags, and a count of isolated points [O5].
`IntPatch_ImpImpIntersection` restricts the analytic–analytic case to Plane,
Cone, Cylinder and Sphere; it also has an
`IntStatus_InfiniteSectionCurve` status for curves too long for reliable
floating-point evaluation [O7]. If the analytic–analytic intersector is not
done, `IntPatch_Intersection::GeomGeomPerfom` falls back to the
parametric–parametric path [O6]. That path approximates the surfaces by
polyhedra and walks the intersection [O8].

The Boolean layer is `BRepAlgoAPI_BooleanOperation` over `BOPAlgo_PaveFiller`
and `BOPAlgo_Builder` [O10][O11][O12]. The intersection phase computes
vertex/vertex through solid/solid interferences; the building phase classifies
parts as IN/ON/OUT and assembles the result. `BRepAlgoAPI_BuilderAlgo` can
simplify tangential edges/faces, and `BRepCheck_Analyzer` validates the result
[O23][O19].

#### Classification

OCCT classifies a point in a solid with `BRepClass3d_SolidClassifier`: it
returns a `TopAbs_State` (IN, ON or OUT), exposes `IsOnAFace()`, and can report
the face used for the ON decision [O13]. The Boolean building step uses this
kind of classification to choose which split pieces belong to the result
[O12]. This is a **tolerance-aware** classification: the point is classified
with an explicit `Tol`, and a point near a face can be ON rather than IN/OUT.

#### Tolerance

OCCT has a per-sub-shape tolerance. The Boolean guide defines interference as
"distance between the underlying geometries <= sum of the two tolerances" for
each pair type (vertex/vertex, vertex/edge, edge/edge, vertex/face, edge/face,
face/face), and describes how the new vertex tolerance is the enclosing sphere
of the source tolerance spheres [O12]. The global defaults are:

- `Precision::Confusion()` = `1e-7` for point coincidence;
- `Precision::Angular()` = `1e-12` for angular equality [O14].

Those are defaults, not a unit-independent policy: OCCT's own documentation
notes that the values are tuned for millimetre-scale mechanical design and
must be interpreted relative to the application's unit [O14]. `BOPAlgo_Options`
adds a fuzzy value on top of the shape tolerances [O17]. Fuzzy Booleans are
specifically for touching/near-coincident/misaligned entities; the guide warns
that the fuzzy value must be chosen from the measured gap, not guessed [O12].

#### Tangency and coincidence

OCCT has several mechanisms:

- analytic–analytic `IntPatch` reports `TangentFaces()`/`OppositeFaces()` when
  the patches are considered entirely tangent [O5][O7];
- `RLine` represents a restriction line on one surface, used when the
  intersection is coincident with a surface boundary [O9];
- the Boolean data structure has common blocks for coincident pave blocks, and
  same-domain vertices/edges/faces;
- `BOPAlgo_GlueShift` and `BOPAlgo_GlueFull` skip some intersection work when
  arguments are partially or fully coincident; the user must guarantee the
  coincidence because the algorithm does not verify it [O18][O12].

#### Bounded domains

`IntPatch` works on an `Adaptor3d_TopolTool` domain, so it can be restricted to
a face's parameter domain. But the public `GeomAPI_IntSS` only takes
`Geom_Surface` and documents the natural parametric domain unless the surface
is a `Geom_RectangularTrimmedSurface` [O1][O22]. The internal `RLine` trimming
uses rectangular parameter bounds [O4]. True face-loop clipping, pcurves and
shared topology happen in `BRepAlgoAPI`/`BOPAlgo`, not in `GeomAPI_IntSS`.
This distinction is important: OCCT's simple surface API is not a bounded-patch
API, and EduCAD should not model its `intersect` on `GeomAPI_IntSS` if the goal
is patch-level results.

#### Failure modes

The Boolean guide lists the known failure classes: self-interfering arguments,
too-small edges, not-splittable edges, bad positioning, failed intersection of
a sub-shape pair, acquired self-intersection, pcurve construction failure,
inappropriate fuzzy values, and misuse of gluing options [O11][O12]. It also
warns that open solids are non-manifold in the Boolean sense and that a face's
classification can depend on the point chosen [O12]. These are not exotic
corner cases; they are the normal taxonomy of a tolerance-based B-rep kernel.

### 3.2 CGAL 6.2.1

#### Exact predicates and exact constructions

CGAL distinguishes EPICK from EPECK [C5][C6]:

- EPICK: exact geometric predicates, inexact constructions. The topology can be
  exact while constructed points are rounded. For corefinement, CGAL says the
  graph structure is guaranteed but the embedding may self-intersect after
  rounding; for consecutive operations, use EPECK [C1].
- EPECK: exact predicates and exact constructions, at the cost of exact number
  types and slower arithmetic [C5].

This is the cleanest statement of the design trade-off: **topology can be
exact while geometry is approximate**, but you must not claim both. EduCAD's
current certificate already separates exact and numeric checks; the
intersection layer should do the same.

#### Arrangements

The 2-D Arrangements package builds a DCEL subdivision of a surface by
x-monotone curves. It supports overlapping curves: when two curves overlap, the
traits merge the overlapping section and the arrangement stores one edge with
merged data [C4]. It has traits for segments, conics, circles, Bézier curves
and algebraic segments; the Bézier traits use filtering and exact algebraic
fallback for intersection points [C4]. The package has topology traits for
bounded/unbounded planar arrangements and for arrangements of great-circle arcs
on a sphere [C11]. It does not provide a ready-made exact arrangement of
arbitrary quadrics in 3-D; the arrangement is 2-D (possibly on a 2-D surface).

#### Nef polyhedra

`Nef_polyhedron_3` represents a point set generated from halfspaces by
complement and intersection. It is closed under Boolean operations, and it
represents lower-dimensional features and non-manifold contacts exactly [C3].
Its local structure is a sphere map at each vertex; the global structure is a
selective Nef complex. `locate(Point_3)` returns the containing vertex, edge,
facet or volume [C3]. Conversion from a `Polyhedron_3` requires an oriented
closed 2-manifold, which is why Nef is a polyhedral kernel, not a general
curved-surface kernel [C3].

For EduCAD, Nef is attractive as a **reference semantics**: it shows what
"closed under Boolean" actually means and why lower-dimensional contacts need
first-class representation. It is not a practical runtime dependency.

#### Mesh Boolean / corefinement

CGAL's corefinement refines both meshes so the intersection polylines are edges
of both. It requires manifold, non-self-intersecting input for the Boolean
functions; the output must be manifold, and zero-thickness/non-manifold output
is rejected or handled by a special visitor [C1]. Coplanar triangles are
triangulated identically and reported as constrained edges [C1]. The minimal
kernel requirement is exact predicates; exact constructions are recommended
[C1]. The older `surface_intersection()` is deprecated in 6.2 in favour of
`intersection_polylines()` [C2].

#### Classification, tangency, tolerance, bounded domains

- Classification: Nef point location; arrangements have point-location
  strategies; mesh Booleans classify by volume/orientation after corefinement.
- Tangency/coincidence: exact arithmetic means tangency and coincidence are
  not special cases; arrangements merge overlaps, Nef represents them as
  lower-dimensional cells, and corefinement handles coplanar triangles
  consistently.
- Tolerance: there is no epsilon in the exact path. EPICK has exact predicates
  but rounded constructions; EPECK has exact constructions. This is a
  qualitative difference from OCCT's per-shape tolerances.
- Bounded domains: Nef uses an infimaximal bounding box for unbounded sets;
  arrangements are on a plane/sphere; mesh Booleans use closed meshes. There is
  no general "bounded analytic patch" type in these packages.

### 3.3 Manifold 3.5.4

#### Topology and geometry

Manifold separates exact integer topology from floating-point geometry. A
manifold mesh is a triangle mesh where every edge has exactly two incident
triangles with opposite orientation, and the 3MF definition is used [M2]. The
implementation uses a half-edge structure with vertex positions, face normals
and vertex normals (`Impl` in `impl.h`) [M9]. Input must be manifold; the
constructor sets an error status otherwise, and `Merge` is a best-effort repair
[M1].

#### Boolean architecture

`Boolean3` builds two `Intersections` sets: edges of P against faces of Q, and
faces of P against edges of Q (`Intersect12`) [M3][M4]. It then computes
winding numbers for vertices of each mesh with respect to the other
(`Winding03`), using flood fill over connected components [M4]. The result is
selected by winding number and the operation type; `expandP_` controls the
symbolic perturbation direction per operation [M4].

#### Symbolic perturbation and coincidence

Manifold's Boolean has no tolerance. It uses symbolic perturbation to break
ties when geometry is exactly equal in floating point. `Shadows(p,q,dir)`
returns `p == q ? dir < 0 : p < q`; `Interpolate` chooses the nearer endpoint
to reduce rounding; `GetAxisAlignedProjection` avoids projecting along the
normal and introducing error [M5]. The wiki explains the intent: for
axis-aligned coincident faces, perturb the first mesh in the surface-normal
direction for union (and the opposite for difference/intersection), so touching
cubes merge and a mesh minus itself is empty [M2]. This is a deliberate
alternative to exact arithmetic; it does not handle near-coincidence, only
exact float ties.

#### Tolerance

There are two notions:

- `kPrecision = 1e-12`, scaled by the bounding box, used to define `epsilon_`
  (the accumulated numerical error bound) [M6][M7];
- `tolerance_`, a simplification tolerance used for coplanar merging and
  short-edge collapse; it can be increased with `SetTolerance` and is exposed
  in `MeshGL` as `tolerance` [M7][M8].

`GetEpsilon()` documents the ε-valid bound; `GetTolerance()` documents the
simplification tolerance. The Boolean itself does not consume a tolerance
[M2]. This is a clean separation that EduCAD can borrow conceptually: an
**arithmetic uncertainty** bound is not the same as a **model simplification**
tolerance.

#### Bounded domains and failure modes

Manifold's domain is closed triangle meshes representing solids. It does not
have analytic surfaces, pcurves, or open patch Booleans (the Boolean is for
volumes). Failure modes are non-manifold or self-overlapping input, extremely
thin features, and geometry below the epsilon/tolerance scale; the library
guarantees manifold output but not that the output is geometrically the
intended solid for ε-invalid input [M2].

### 3.4 Cross-cutting observations

1. **All three separate geometry from topology.** OCCT has geometry + pcurves +
   topology; CGAL has exact traits + DCEL/Nef combinators; Manifold has
   floating geometry + integer half-edge topology. EduCAD already does this
   with analytic supports + object-identity loops. The missing piece is the
   bounded intersection record, not a new topology substrate.
2. **Tangency is not a curve.** OCCT has explicit tangent-face flags and
   restriction lines; CGAL represents it as a lower-dimensional cell; Manifold
   uses symbolic perturbation. EduCAD should make `tangent` and `coincident`
   explicit result kinds and never turn them into a zero-length edge or a tiny
   circle.
3. **Tolerance is a policy, not a constant.** OCCT propagates per-shape
   tolerances and adds fuzzy values; CGAL avoids epsilon by exact arithmetic;
   Manifold uses a scale-relative epsilon for uncertainty and a separate
   simplification tolerance. EduCAD currently has three constants with three
   meanings. One policy with named tolerances is the highest-value fix.
4. **Bounded-domain clipping is a separate operation from support
   intersection.** OCCT's `GeomAPI_IntSS` is explicitly natural-domain only;
   face clipping is in `BRepAlgoAPI`. CGAL's arrangements are bounded by their
   curves/DCEL; Nef uses an infimaximal box; Manifold is bounded by the mesh.
   EduCAD should likewise make `intersect` (support) and `intersectBounded`
   (patch) separate, composable operations.
5. **A general point-in-patch predicate is the bottleneck.** Every kernel has
   one: OCCT's solid/face classifiers, CGAL's point location, Manifold's
   winding numbers. EduCAD has only special-case tests. Implementing a real
   classifier unlocks clipping, splitting and validation at once.
6. **Do not certify approximate geometry as exact.** CGAL's EPICK/EPECK
   distinction and Manifold's ε-valid definition are both explicit about this.
   EduCAD's certificate should keep the same discipline.

## 4. Comparison matrix

Legend: **Y** = supported; **P** = partial/special-case; **N** = not supported.

| Capability | EduCAD current | EduCAD proposed | OCCT 8.0.1 | CGAL 6.2.1 | Manifold 3.5.4 |
|---|---|---|---|---|---|
| Analytic surface types | plane, cylinder, cone, sphere | same | planes, quadrics, torus, NURBS, … | kernel primitives + traits; Nef polyhedral | none (triangles) |
| Support intersection | Y, exact families | Y, unchanged | Y (IntPatch) | Y (arrangements/Nef/PMP) | only after tessellation |
| Bounded patch clipping | N (only plane split) | **Y (proposed)** | Y at B-rep level (BOPAlgo) | Y via arrangements/Nef/mesh | Y for volumes/meshes |
| General point-in-patch | P (sphere caps, cylinder/cone bands) | **Y (proposed)** | Y (classifiers) | Y (point location) | Y (winding number) |
| Tangency result | P (enumerated) | **Y explicit** | Y (`TangentFaces`, RLine) | Y (exact cells) | Y (perturbation) |
| Coincident-surface result | P (`plane-overlap`, equal quadrics) | **Y explicit overlap/refusal** | Y (common blocks, gluing) | Y (Nef/merge) | Y (coplanar handling) |
| Per-element tolerance | P (three constants) | **Y one policy** | Y (per-shape + fuzzy) | N (exact) / P (EPICK) | P (epsilon + simplification) |
| Ordered boundary loops | Y | Y (ordered elements) | Y (wires) | Y (DCEL/Nef) | Y (mesh boundaries) |
| Shared boundary identity | Y (object identity/id) | Y + vertex ids | Y (TShape sharing) | Y (exact cells) | Y (topology) |
| Intersection → topology | P (closed circle/ellipse promotion) | **Y segments/sub-arcs** | Y | Y | Y (mesh edges) |
| General split by surface | N | **Y (proposed)** | Y (Boolean) | Y (Boolean) | Y (Boolean) |
| Boolean solids | N | later | Y | Y | Y |
| Runtime dependency | none | **none** | C++/WASM, LGPL | C++ exact, GPL high-level | C++/WASM, Apache |
| Output guarantee | analytic certificate, partial | analytic segments + explicit unresolved | B-rep validity subject to tolerances | exact topology (EPECK) / manifold mesh | guaranteed manifold mesh |
| Fit for browser EduCAD | Y | **Y** | N | N (oracle only) | optional |

## 5. Recommended design for EduCAD

### 5.1 Principles

1. **Keep the analytic support algebra.** It is small, testable and already
   covers the important exact families.
2. **Add bounded clipping as a separate layer.** Do not change the meaning of
   `Surfaces.intersect`; add `Surfaces.intersectBounded` (or
   `intersectPatches`). Existing callers keep working; new callers get
   patch-level segments.
3. **One model-wide tolerance policy.** Every operation consumes the same
   `TolerancePolicy`; no new hard-coded `EPS` in a special case.
4. **Classification is explicit.** A point is `inside`, `outside`, `boundary`
   or `unknown`, with a residual and tolerance. Never guess when unknown.
5. **Tangency and coincidence are result kinds, not curves.** Do not emit a
   zero-length segment or a tiny circle for a tangent contact.
6. **Topology is object identity plus stable ids.** A shared sub-arc is the
   same object in both loops, exactly as today. Vertices become first-class
   records with ids; endpoint merging is tolerance-checked and diagnosed.
7. **Never use display triangles as evidence.** They remain a preview.
8. **Never silently approximate.** An unsupported branch returns a diagnostic
   with a code, not a sampled polyline presented as analytic.

### 5.2 Data structures

The existing surface record can be extended without breaking saved previews.
The important additions are a parameterization/domain, a tolerance policy, and
first-class boundary elements/vertices.

```js
// A bounded surface patch. Existing fields stay.
{
  id: 'surface:12',
  kind: 'cylinder',                 // plane | cylinder | cone | sphere
  origin, axis, radius,             // kind-specific
  frame: { origin, u, v },          // parameterization for clipping
  domain: {                         // natural parameter domain, if known
    u: [u0, u1], v: [v0, v1],
    uPeriodic: true, vPeriodic: false,
    singular: [{ u, v, kind: 'apex' | 'pole' }]
  },
  loops: [{
    id: 'loop:0',
    kind: 'outer',                  // outer | inner
    elements: [                     // canonical ordered cycle
      { kind: 'curve', curve, orientation: +1 },
      { kind: 'line', line, orientation: -1 },
      { kind: 'polyline', points, orientation: +1 }
    ]
  }],
  orientation: +1,                  // surface normal side, when known
  tolerance: { length: 1e-5, angle: 1e-7 },
  sourceIds: [], displayFaceIndices: [], closed: false
}
```

`BoundaryElement` identity is explicit:

```js
{
  id: 'curve:7' | 'section:3' | 'line:fillet/low' | 'arc:branch-2:0',
  kind: 'curve' | 'line' | 'polyline' | 'vertex-edge',
  curve, line, points,              // exactly one representation
  orientation: +1 | -1,             // relative to the loop direction
  paramRange: { surfaceId, t0, t1 } // for analytic sub-elements
}
```

The object itself remains the identity fallback for backward compatibility.
New producers should set `id`; split sub-arcs derive a deterministic id from
the parent branch and the station indices.

An intersection result has two levels, matching the two operations:

```js
// Support-level result, close to the current shape.
{
  kind: 'line' | 'circle' | 'circles' | 'ellipse' | 'conic' |
        'point' | 'plane-overlap' | 'coincident' | 'none' | 'unsupported',
  branches: [{
    id: 'branch:0',
    kind: 'line' | 'circle' | 'ellipse' | 'conic',
    parameterization: {
      type: 'line' | 'circle' | 'ellipse' | 'conic',
      origin, direction, center, u, v, radius, radiusU, radiusV,
      t0, t1, periodic
    },
    relation: 'transverse' | 'tangent' | 'coincident' | 'uncertain',
    exactness: 'analytic' | 'numeric',
    sourceIds: []
  }],
  surfaceIds: ['surface:0', 'surface:1'],
  surfaceKinds: ['plane', 'cylinder'],
  relation, reason, tangent, degenerate
}

// Patch-level result.
{
  kind: 'patch-intersection',
  a: 'surface:0', b: 'surface:1',
  relation: 'transverse' | 'tangent' | 'coincident' | 'uncertain' | 'none',
  branches: [ ... ],
  segments: [{
    id: 'segment:0',
    branchId: 'branch:0',
    curve: { /* analytic sub-arc or line segment */ },
    t0, t1,
    start: { x, y, z }, end: { x, y, z },
    insideA: true, insideB: true,
    onBoundaryA: false, onBoundaryB: false,
    boundaryCoincident: false,       // true when the branch is an existing seam
    boundaryElementIds: { a: null, b: null },
    residualA, residualB,
    tolerance,
    confidence: 'analytic' | 'numeric' | 'unknown',
    sourceIds: []
  }],
  contacts: [{ point, relation: 'tangent', surfaces: [...] }],
  overlaps: [{ surfaceId, region, kind: '2d-overlap' }],
  unresolved: [{ code, branchId, t0, t1, reason }],
  tolerance
}
```

A patch point location is a first-class result:

```js
Surfaces.classifyPoint(surface, p, options) -> {
  state: 'inside' | 'outside' | 'boundary' | 'unknown',
  residual, tolerance,
  loopId, elementId,               // when boundary
  u, v,                            // parameter coordinates, when known
  method: 'analytic' | 'parameter-ray' | 'cap-halfspace' | 'station-interval',
  reason                           // when unknown
}
```

### 5.3 API

Keep the existing API stable, add the new layer:

```js
// Existing: unbounded support intersection. Do not change its meaning.
Surfaces.intersect(a, b, options) -> SupportIntersection | null

// New: bounded patch intersection.
Surfaces.intersectBounded(a, b, options) -> PatchIntersection | null

// New: clip one support branch to one patch (used by intersectBounded).
Surfaces.clipBranchToPatch(surface, branch, options)
  -> { segments, unresolved }

// New: general point-in-patch classifier.
Surfaces.classifyPoint(surface, point, options) -> PatchPointLocation

// New: split a patch by another surface's bounded intersection.
Surfaces.splitByIntersection(surface, other, geometry, diagnostics)
  -> { kind:'split', surfaceId, otherId, positive, negative,
       segments, surfaces:[positive,negative] } | null

// New: promote a bounded segment/sub-arc to a boundary element.
Surfaces.promoteSegment(segment, options) -> boundaryElement | null

// Existing: promote a closed circle/ellipse intersection. Keep it as a
// convenience wrapper over promoteSegment.
Surfaces.intersectionCurves(result) -> boundaryElement[] | null
```

`options` carries `{ tolerance, allowTangent:false, allowCoincident:false }`.
The default for `allowTangent`/`allowCoincident` should be `false` for
topology-producing calls: a tangent contact is reported, not silently promoted
to a boundary.

Backward compatibility:

- `intersect` keeps the current return vocabulary and `null` for unsupported.
  Add `Surfaces.intersectDiagnostic(a,b)` (or an optional diagnostics array)
  so a caller can distinguish `unsupported` from `none`.
- `intersectionCurves` keeps its current behaviour for closed circles/ellipses;
  it can later accept a `PatchSegment` and promote sub-arcs.
- `split` keeps its plane-only contract. `splitByIntersection` is the general
  operation; `split(surface, plane)` can delegate to it once the plane section
  is represented as a branch.
- `attachBoundary`/`shareBoundary` keep their structural-promotion meaning.

### 5.4 Intersection/classification flow

The flow for `intersectBounded(A, B)` is:

1. **Normalize and validate.** Check finite parameters, positive radii, unit
   axes, valid loops and a consistent tolerance policy. If a surface is
   invalid, return a diagnostic, not a partial segment.
2. **Classify the support relation.** Compare canonical forms within
   `tol.length` / `tol.angle`:
   - same plane/cylinder/cone/sphere → `coincident`;
   - parallel normals/axes and zero signed distance → `tangent`;
   - otherwise `transverse`;
   - disjoint → `none`.
   The comparison must be symmetric and must not depend on argument order.
3. **Compute support branches.** Use the existing exact dispatch. For a
   supported pair, return one or more analytic branches. For an unsupported
   pair, return `unsupported` with a code; do not sample.
4. **Clip each branch to A and B.** Use `clipBranchToPatch` on each surface.
   On each surface, collect stations where the branch meets a loop element or
   a natural domain boundary; sort and deduplicate; classify each interval
   midpoint; keep intervals that are inside both patches. Merge across a
   periodic seam.
5. **Build segment records.** For each kept interval, compute the analytic
   sub-arc (same centre/frame/radii/start angle/sweep for a conic; line
   endpoints for a line). Record endpoint provenance (`loop element`,
   `natural boundary`, or `free`), residuals on both supports, and confidence.
   If the interval lies on a named boundary element, mark it
   `boundaryCoincident` and keep the boundary id; this is how an existing
   seam such as a cap circle or a fillet generator is discovered rather than
   dropped.
6. **Detect contacts and overlaps.** A tangent root with no interval is a
   contact point or contact curve, not a segment. A coincident support is an
   overlap region, not a curve. Return these explicitly.
7. **Validate.** Check every segment midpoint and endpoint lies on both
   supports within tolerance; check claimed boundary endpoints lie on the
   named loop element; check no two segments overlap in parameter space;
   check periodic continuity. Any failure becomes `unresolved`, not a silent
   pass.
8. **Optionally promote to topology.** `splitByIntersection` takes the
   segments, splits loops at the stations, creates/reuses vertices, shares the
   sub-arc objects, and returns two patches. It is the general form of the
   current crossing `split`.

The key invariant: **a segment is emitted when its interior is inside both
patches, or when it is coincident with a named boundary element on the
relevant patch and the two surfaces agree on that element**. A segment that is
inside one patch and strictly outside the other, with no boundary evidence, is
not an intersection edge.

### 5.5 Bounded-domain clipping algorithm

For a branch parameterized by `t`:

```text
stations = []
for each surface S in [A, B]:
  for each loop element e in S.loops:
    roots = intersectBranchWithElement(branch, e, S, tol)
    for root in roots:
      stations.push({t: root.t, surface: S.id, element: e.id,
                     point: branch.point(root.t), kind: root.kind})
  for each natural domain boundary of S:
    roots = intersectBranchWithDomain(branch, S, tol)
    stations.push(...)
sort stations by t, merging duplicates within tol.param
if branch is closed and stations is empty:
  intervals = [whole branch]
else:
  intervals = consecutive pairs, plus periodic wrap if closed
for each interval:
  mid = branch.point((t0 + t1)/2)
  a = classifyPoint(A, mid)
  b = classifyPoint(B, mid)
  if a.state == 'inside' and b.state == 'inside':
     emit segment(t0, t1, boundaryCoincident:false)
  else if a.state == 'boundary' and a.elementId != null and
          intervalIsOnElement(branch, t0, t1, a.elementId):
     emit segment(t0, t1, boundaryCoincident:true, onBoundaryA:true)
  else if b.state == 'boundary' and b.elementId != null and
          intervalIsOnElement(branch, t0, t1, b.elementId):
     emit segment(t0, t1, boundaryCoincident:true, onBoundaryB:true)
  else if a.state == 'unknown' or b.state == 'unknown':
     unresolved.push(...)
```

`intersectBranchWithElement` is closed-form for the important cases:

- line–line, line–circle/ellipse, line–arc: linear/quadratic;
- circle/ellipse–circle/ellipse: quartic in general, but the current supported
  families often reduce to a circle–circle, line–circle or coaxial case;
- conic–line: quadratic;
- conic–conic: quartic; if the branch is a classified cone conic and the
  element is a circle/ellipse, root isolation is needed before this family is
  enabled.

When a root is tangent (double root), record it as a **touch station**; do not
split the interval unless the inside/outside state actually changes. This
avoids the classic failure of splitting a curve at a tangent point and creating
two zero-length pieces.

For a closed branch with no stations, one interval is the whole branch; the
midpoint test decides whether the whole circle/ellipse is inside both patches.
If the whole branch is a named boundary element on one patch, emit it as a
`boundaryCoincident` segment; if it is only a tangent contact, emit a contact.
For a branch interval that lies along a boundary element, emit the
`boundaryCoincident` segment with the element id and the same sub-arc object;
do not reduce it to a set of zero-length roots or drop it because the midpoint
classifies as `boundary`.

A cap circle is the canonical example: the plane cap and the cylinder side
meet exactly along the circle, and the circle is a boundary of both. A general
patch-intersection operation must be able to return that circle as a
boundary-coincident segment, not treat it as "not inside either patch".

### 5.6 Tangent and coincident policy

- **Tangent point**: return a `contact` with a point, `relation:'tangent'`, and
  the two surfaces. Do not create a boundary element. Do not create a
  degenerate face.
- **Tangent curve** (e.g. a line where two cylinders touch): return a
  `contact` of kind `line`/`curve`, not a `segment` with zero thickness. If a
  caller wants to use it as a seam, it must opt in explicitly
  (`allowTangent:true`) and the topology layer must mark it as a non-manifold
  or zero-angle contact.
- **Coincident supports**: return `coincident` with an `overlaps` record. The
  overlap region is a 2-D region on the shared support. Computing it requires a
  2-D boolean of the two patches in a common parameter plane; until that is
  implemented, return `overlaps:[{kind:'2d-overlap', supported:false}]` and a
  diagnostic. Do not return one patch's loops as if they were the
  intersection.
- **Boundary-coincident branch**: the branch is the same curve as a named loop
  element of one patch (a cap circle, a fillet generator line, an existing
  shared seam). Return a `boundaryCoincident` segment that references that
  element; do not duplicate the element or classify the whole result as
  `coincident`. This is a one-dimensional coincidence, not a 2-D overlap.
- **Near-coincident/near-tangent**: if the residual is within tolerance but the
  relation is not exact, return `uncertain` with the residual. Do not snap.
- **Whole-patch tangency** (the OCCT `TangentFaces` case): if the two patches
  are tangent over an area, return `coincident`/`tangent-region` with the
  overlap classification; do not return a curve.

### 5.7 Tolerance policy

Use one `TolerancePolicy` per model, carried in `geometry`/`model`, not a
module-level `EPS`.

Suggested defaults (to be calibrated against the existing 151 sheets before
changing any behaviour):

```text
D       = bounding-box diagonal of the model (or the patch pair)
L       = max(1e-9, 1e-7 * D)        // length tolerance
A       = max(1e-9, L / Rref)        // angular tolerance, radians
Rref    = max(1, largest relevant radius/coordinate)
```

Named checks:

| Name | Meaning | Default |
|---|---|---|
| `tol.point` | two points are the same vertex | `L` |
| `tol.onSurface` | a point is on a support | `L` |
| `tol.boundary` | a point is on a loop element | `L` |
| `tol.angle` | normals/axes are parallel/tangent | `A` |
| `tol.param` | two curve parameters are the same station | `L / minSpeed`, clamped to `[1e-12, 1e-3]` |
| `tol.merge` | duplicate stations/segments | `0.5 * L` |
| `tol.simplify` | optional display simplification | separate, never used for topology |

Rules:

- **Scale-aware, not absolute.** Do not compare raw floats with `1e-7`.
  `Precision::Confusion` is a millimetre-scale default, not a universal law
  [O14].
- **One dead band.** For a signed distance `d` from a boundary:
  `d < -tol.boundary` → outside; `d > tol.boundary` → inside; otherwise
  `boundary`/`unknown`. Do not use different epsilons in different callers.
- **Residual + uncertainty.** Every emitted segment records `residualA`,
  `residualB`, `tolerance` and `confidence`. The certificate can then report
  "numeric within tolerance", never "exact" unless the computation was exact.
- **Refuse when tolerance is too large.** If `L > 1e-3 * D`, the drawing is too
  noisy for topology; return a diagnostic instead of snapping features
  together.
- **Separate arithmetic error from model simplification.** Manifold's
  `epsilon_` vs `tolerance_` is a good model: an uncertainty bound and a
  simplification tolerance are different values with different consumers
  [M7][M8].
- **Do not propagate tolerance silently.** A derived vertex/segment tolerance
  is the max of the inputs and the observed residual, but it must be recorded
  and surfaced.

### 5.8 Topology and incidence

The current `incidence` graph is a good start. Extend it rather than replace
it:

```js
Surfaces.incidence(model) -> {
  uses: Map<boundaryId, {
    id, element, kind, useCount, orientedUseCount,
    surfaceIds, surfaceUses, loopRefs,
    orientation: +1|-1|'mixed',
    status: 'open'|'shared'|'nonmanifold'|'selfShared'
  }>,
  bySurface, elementId,
  vertices: Map<vertexId, { point, tolerance, sourceIds, uses }>
}
```

Topology rules:

- A boundary element is shared when the **same object** (or same explicit
  `id`) is referenced by two loops. This preserves the current behaviour and
  the fillet's shared generator lines.
- A split sub-arc gets a stable `id` derived from the parent branch and the
  station interval. Both pieces reference the same object; no resampling.
- Endpoints become `vertex` records. Merge endpoints only when their distance
  is within `tol.point` and their source evidence does not conflict. A
  conflict is a diagnostic, not a silent merge.
- Loop elements carry `orientation`. For a consistently oriented shell, two
  uses of the same edge should have opposite orientation. Report
  `orientationConflict` rather than flipping silently.
- `shells` remain the connected components of shared boundaries. A shell is
  closed when every boundary use count is 2 and all vertices are resolved.
- Planar faces with holes: use `kind:'inner'` loops in the point-in-patch
  parity test. Do not assume one outer loop.
- A patch with no loops is not automatically "closed"; only `closed:true` for
  a complete sphere or a genuinely closed surface. A trimmed sphere without
  cap metadata must remain `unknown` for material-side splits, as today.

### 5.9 What not to copy

| Do not copy | Why |
|---|---|
| OCCT's `TopoDS`/`BRepAlgoAPI`/`BOPDS` class hierarchy and pcurves | Enormous surface area; pcurves and tolerance propagation are only needed for a general B-rep kernel |
| OCCT's global `Precision::Confusion` as a policy | It is a millimetre-scale default, not a unit-independent tolerance [O14] |
| CGAL's exact algebraic kernel at runtime | Exact numbers and algebraic intersections are too heavy for a zero-dependency browser app; high-level packages are GPL |
| Manifold's triangle-soup Boolean as a substitute for analytic topology | It cannot produce or certify circles/ellipses/lines, and it intentionally has no tolerance in the Boolean |
| Manifold's symbolic perturbation as a general degeneracy policy | It only breaks exact float ties; it does not classify near-coincidence |
| One recognizer per named solid/feature | Contradicts the reconstruction pipeline in `AGENTS.md`; the parent operation is bounded patch intersection |
| Sampling the display mesh to decide inside/outside | The display mesh is not the source of truth; current docs already require analytic evidence |
| Converting an unsupported intersection to a polyline and calling it analytic | Violates the "never silently drop unsupported curves" rule in `AGENTS.md` |
| Using object identity alone for vertices/endpoints | Curves can be shared, but endpoints need explicit identity/tolerance records; exact coordinate keys are brittle |

### 5.10 Migration and compatibility

1. Add `TolerancePolicy` and `classifyPoint` without changing `intersect`.
2. Add `intersectBounded`/`clipBranchToPatch`; keep `intersect` as the
   support-level API.
3. Extend `intersectionCurves` to accept bounded segments and sub-arcs; keep
   the old closed-circle/ellipse path.
4. Add `splitByIntersection`; make `split(surface, plane)` delegate when the
   plane section is representable as a branch.
5. Add `vertices` and `orientedUseCount` to `incidence`; keep the existing
   `uses` fields and `elementId` contract.
6. Update `validate`/`certify` to consume the new segment records and to
   report `unresolved` counts. Existing certificate fields remain; new fields
   are additive.
7. Keep saved previews compatible: optional fields, no required renaming, no
   change to `analytic-surface-v1` unless a version bump is justified.

## 6. Pseudocode and API sketch

### 6.1 `intersectBounded`

```js
function intersectBounded(A, B, options) {
  const tol = toleranceFor(A, B, options);
  const support = intersectSupports(A, B, { tolerance: tol });

  if (!support) {
    return patchResult(A, B, {
      relation: 'unsupported',
      unresolved: [{ code: 'intersection-unsupported',
                     surfaceKinds: [A.kind, B.kind] }]
    });
  }

  if (support.kind === 'none') {
    return patchResult(A, B, { relation: 'none' });
  }

  if (support.relation === 'coincident') {
    return patchResult(A, B, {
      relation: 'coincident',
      overlaps: [coincidentOverlap(A, B, tol)],
      unresolved: [{ code: 'coincident-overlap-unsupported' }]
    });
  }

  const segments = [];
  const contacts = [];
  const unresolved = [];

  for (const branch of support.branches) {
    const clippedA = clipBranchToPatch(A, branch, tol);
    const clippedB = clipBranchToPatch(B, branch, tol);
    const clipped = intersectIntervals(clippedA, clippedB, branch, tol);

    for (const interval of clipped.segments) {
      const segment = makeSegment(branch, interval, A, B, tol);
      if (validSegment(segment, A, B, tol)) segments.push(segment);
      else unresolved.push({ code: 'segment-validation-failed', ... });
    }
    contacts.push(...clipped.contacts);
    unresolved.push(...clippedA.unresolved, ...clippedB.unresolved);
  }

  return patchResult(A, B, {
    relation: support.relation,
    branches: support.branches,
    segments: mergeAcrossSeam(segments, tol),
    contacts, unresolved, tolerance: tol
  });
}
```

`intersectIntervals` must preserve the boundary-coincidence flags when it
intersects the A and B interval sets: an interval that is `inside` A and
`boundaryCoincident` B is a valid shared seam, and an interval that is
`boundaryCoincident` on both is an existing shared boundary, not a failure.
It must never silently turn a boundary interval into an interior segment.

### 6.2 `clipBranchToPatch`

```js
function clipBranchToPatch(S, branch, tol) {
  const stations = [];

  for (const loop of S.loops || []) {
    for (const element of loop.elements || []) {
      const roots = intersectBranchElement(branch, element, S, tol);
      for (const root of roots) {
        stations.push({
          t: root.t,
          kind: root.kind,          // 'cross' | 'touch' | 'overlap'
          elementId: element.id,
          loopId: loop.id,
          point: branch.point(root.t)
        });
      }
    }
  }

  for (const bound of naturalDomainBoundaries(S)) {
    for (const root of intersectBranchWithBoundary(branch, bound, tol)) {
      stations.push({ t: root.t, kind: root.kind, boundary: bound.kind });
    }
  }

  const sorted = sortAndMergeStations(stations, tol.param);
  const intervals = intervalsFromStations(branch, sorted);
  const segments = [], contacts = [], unresolved = [];

  for (const [t0, t1] of intervals) {
    const mid = branch.point((t0 + t1) / 2);
    const state = classifyPoint(S, mid, tol);

    if (state.state === 'inside') {
      segments.push({ t0, t1, boundaryCoincident: false });
    } else if (state.state === 'boundary' && state.elementId != null) {
      // Keep an existing seam only if the whole interval is on the same
      // named boundary element. Otherwise it is a contact/overlap clue.
      if (intervalIsOnElement(branch, t0, t1, state.elementId)) {
        segments.push({ t0, t1, boundaryCoincident: true,
                        onBoundary: true, elementId: state.elementId });
      } else {
        contacts.push({ kind: 'boundary-overlap', t0, t1,
                        elementId: state.elementId });
      }
    } else if (state.state === 'unknown') {
      unresolved.push({
        code: 'classification-unknown', t0, t1, reason: state.reason
      });
    }
  }

  for (const station of sorted) {
    if (station.kind === 'touch') contacts.push({ kind: 'tangent', ...station });
    if (station.kind === 'overlap') contacts.push({ kind: 'coincident', ...station });
  }

  return { segments, contacts, unresolved };
}
```

### 6.3 `classifyPoint`

```js
function classifyPoint(S, p, tol) {
  const residual = surfaceResidual(S, p);
  if (!Number.isFinite(residual)) return { state: 'unknown', reason: 'residual' };
  if (residual > tol.onSurface) return { state: 'outside', residual };

  const boundary = nearestBoundaryElement(S, p, tol);
  if (boundary && boundary.distance <= tol.boundary) {
    return { state: 'boundary', residual, loopId: boundary.loopId,
             elementId: boundary.elementId, ...boundary.param };
  }

  if (S.kind === 'plane') {
    return classifyPlanarFace(S, p, tol);        // 2-D parity with holes
  }
  if (S.kind === 'sphere' && S.cap) {
    return classifySphereCap(S, p, tol);         // current cap half-space
  }
  if (S.kind === 'cylinder' || S.kind === 'cone') {
    return classifyUnrolledPatch(S, p, tol);     // parameter-space ray
  }
  return { state: 'unknown', residual, reason: 'surface-kind' };
}
```

`classifyUnrolledPatch` projects `p` to the natural `(u,v)` coordinates,
casts a parameter-space ray from `(u,v)` to `+u`, counts crossings with the
projected loop elements, and uses parity. For a cylinder, `u` is periodic, so
the ray is cast over one period. For a cone, the apex is a singular point and
must be handled explicitly. For a sphere, use longitude/latitude with pole
handling or a spherical point-in-polygon test. If any crossing is tangent or
ambiguous, return `unknown` rather than guessing.

### 6.4 `splitByIntersection`

```js
function splitByIntersection(surface, other, geometry, diagnostics) {
  const hit = intersectBounded(surface, other, { tolerance: geometry.tolerance });
  if (!hit || hit.relation === 'unsupported' || hit.relation === 'coincident') {
    diagnostics.push({ code: 'split-intersection-unsupported', ... });
    return null;
  }
  const segments = hit.segments.filter(s =>
    (s.insideA && s.insideB) || s.boundaryCoincident);
  if (!segments.length) { diagnostics.push({ code: 'split-no-intersection' }); return null; }

  const stations = stationsFromSegments(segments);
  const positive = [], negative = [];
  for (const loop of surface.loops) {
    const split = splitLoopAtStations(loop, stations, surface, geometry);
    if (!split.ok) { diagnostics.push(split.diagnostic); return null; }
    positive.push(...split.positive);
    negative.push(...split.negative);
  }
  // Share the exact segment objects in both pieces, just like split().
  positive.push(...segments.map(segmentLoopElement));
  negative.push(...segments.map(segmentLoopElement));

  return buildSplitResult(surface, other, positive, negative, segments, hit);
}
```

This is deliberately the same topology pattern as the current crossing
`split`: analytic stations, same-side cycles, shared sub-arc objects, and a
refusal if a cycle does not close. If every retained segment is
`boundaryCoincident` and none crosses the patch interior, `splitByIntersection`
must refuse with `split-intersection-already-boundary`: there is no new cut to
make, and duplicating an existing seam would create a non-manifold use.

### 6.5 `.edu` test plan

The repository verifies drawing behaviour with EduCAD Script sheets, not a
separate unit-test suite (`AGENTS.md`). Add sheets under `tools/scripts/` and
exercise the public API with `# surface-query:` lines. `tools/edc.js` compares
`expect` recursively with numeric tolerance `1e-6 * max(1, |expected|)`, so
queries can assert both geometry and topology counts.

Existing sheets that already cover the baseline:

- `surface-intersect-planes.edu`, `surface-intersect-spheres.edu`,
  `surface-intersect-sphere-plane.edu`, `surface-intersect-cylinders.edu`,
  `surface-intersect-sphere-cylinder.edu`;
- `surface-split-sphere.edu`, `surface-split-cylinder.edu`,
  `surface-split-crossing.edu`, `surface-split-band-oblique.edu`,
  `surface-split-recess-cap.edu`, `surface-split-unsupported.edu`;
- `surface-attach-shared.edu`, `surface-line-boundary.edu`,
  `fillet-line-boundary.edu`.

Proposed new sheets:

| Sheet | What it proves | Representative expectation |
|---|---|---|
| `surface-bounded-plane-plane.edu` | Two perpendicular planar patches meet in one segment clipped to the overlap | `surfaceBoundedSegments=1`, both endpoints on loop elements, `unresolved=0` |
| `surface-bounded-plane-cylinder.edu` | A plane cuts a cylinder band; a full circle is clipped to the band | full circle inside the band → one closed segment; above the band → none; tangent to the top → contact, not a segment |
| `surface-bounded-sphere-plane-tangent.edu` | Tangent plane is reported as a contact, not a zero-length edge | `relation=tangent`, `surfaceBoundedSegments=0`, `surfaceContacts=1` |
| `surface-bounded-cylinder-cylinder-parallel.edu` | Parallel cylinder support lines are clipped to the overlapping axial intervals | 0/1/2 segments depending on the bands; each segment has both `insideA/insideB` |
| `surface-bounded-sphere-cylinder-coaxial.edu` | Coaxial sphere/cylinder two-circle result clips to the spherical cap mouth | two disjoint arcs or circles, no accidental join across the seam |
| `surface-bounded-coincident-planes.edu` | Coplanar overlapping rectangles are reported as a 2-D overlap, not a line | `relation=coincident`, `overlaps` non-empty, `unresolved` mentions the unsupported 2-D boolean until implemented |
| `surface-bounded-cone-plane-oblique.edu` | Oblique cone section is classified but not promoted until conics are parameterized | `intersect` returns `conic`; `intersectBounded` refuses with a specific diagnostic |
| `surface-bounded-fillet-plane.edu` | The fillet's cylindrical patch and a planar face produce a bounded line shared with the strip | line endpoints on the fillet end arcs, `surfaceSharedLineBoundaries` increases |
| `surface-bounded-seam.edu` | A branch crossing the cylinder's `u=0` seam is one segment, not two | `surfaceBoundedSegments=1`, parameter interval crosses the seam |
| `surface-bounded-multicomponent.edu` | Two disjoint branches stay disjoint after clipping | two segments, distinct branch ids, no merge |
| `surface-bounded-near-tangent.edu` | Near-tangent within tolerance is `uncertain`, not a tiny circle | `relation=uncertain`, no segment, diagnostic |
| `surface-bounded-unsupported.edu` | Skew cylinders return an explicit unsupported diagnostic | `null`/`unsupported`, code `intersection-unsupported`, no sampled curve |
| `surface-split-by-intersection.edu` | A bounded branch becomes a shared seam and two patches | `refused:false`, `validation.status=partial` or `ok`, shared boundary count 1 |
| `surface-bounded-holes.edu` | A planar face with an inner loop classifies a point correctly | point inside the hole → outside; point in the annulus → inside |

Example future query shape (the exact result fields will be finalized with the
implementation):

```text
# expect: surfaces=2 surfaceKinds=plane,cylinder surfaceChecks=4 surfaceQueries=ok
# surface-query: {"operation":"intersectBounded","surfaces":[0,1],"expect":{"relation":"transverse","segments":[{"insideA":true,"insideB":true}],"unresolved":[]}}
# surface-query: {"operation":"classifyPoint","surface":0,"point":{"x":20,"y":25,"z":30},"expect":{"state":"inside"}}
# surface-query: {"operation":"classifyPoint","surface":0,"point":{"x":20,"y":0,"z":30},"expect":{"state":"boundary"}}
# surface-query: {"operation":"splitByIntersection","surfaces":[0,1],"expect":{"refused":false,"segments":[{"insideA":true,"insideB":true}]}}
```

Acceptance criteria:

1. Every emitted segment is on both supports within `tol.onSurface` and its
   endpoints are on the claimed loop elements within `tol.boundary`.
2. Every emitted segment's midpoint is `inside` both patches, or is
   `boundaryCoincident` with a named boundary element on the relevant patch,
   by an independent `classifyPoint` call.
3. Tangent/coincident results never appear as zero-length or tiny segments.
4. Unsupported families return a diagnostic code; they do not return a
   sampled polyline or a guessed circle.
5. Periodic seams produce one segment, not two.
6. Existing 151 sheets still pass unchanged. Run each sheet with
   `node tools/edc.js <file.edu>` (or a shell loop over `tools/scripts/*.edu`);
   do not add a separate unit-test suite.
7. The certificate's shared/open/non-manifold counts agree with the incidence
   graph for both the input and the split result.

## 7. Licensing and dependency implications

EduCAD is MIT-licensed and has zero npm dependencies (`LICENSE`,
`package.json`). That is a product constraint, not just a preference: a browser
teaching app should not require a C++/WASM kernel, a GPL runtime, or a large
build chain.

| Project | Version studied | License | Runtime implication for EduCAD |
|---|---|---|---|
| Open CASCADE Technology | 8.0.1 | LGPL-2.1 with OCCT exception [O20][O21] | Possible but heavy: C++/WASM, per-shape tolerances, large API. Modifications to OCCT must remain LGPL; static/WASM bundling needs legal review. The exception covers header material in object code, not a general relicense. |
| CGAL (Nef, Arrangements, PMP) | 6.2.1 | GPL-3.0+ for these packages; Kernel is LGPL-3.0+; commercial license available [C7][C8][C9][C10] | GPL high-level packages would impose GPL on a distributed combined work. Not acceptable for an MIT app without a commercial license or a carefully isolated, non-distributed oracle. |
| Manifold | 3.5.4 | Apache-2.0 [M10] | Permissive and patent-granting; optional WASM backend is plausible. But it is mesh-only and cannot produce analytic boundaries. |
| CGAL Kernel (only) | 6.2.1 | LGPL-3.0+ [C5][C6] | Still a C++/exact-number dependency; not a browser fit. |
| OCCT exception | 1.0 | LGPL-2.1 exception [O21] | Allows object code incorporating header material under terms of your choice with notice; does not make the library permissive. |

Notes:

- **Do not copy code from any of these projects.** The algorithms and
  interfaces can inform a clean-room implementation; the source is copyrighted.
  In particular, do not paste OCCT's `IntPatch`/`BOPAlgo` code, CGAL's traits,
  or Manifold's Boolean into `public/lib/`.
- **Do not add a runtime dependency in this round.** The recommended design is
  implementable in the existing zero-dependency JavaScript module.
- **CGAL as an oracle.** If CGAL is used to generate expected results during
  development, keep it out of the shipped app and out of the repository's
  runtime path. GPL obligations trigger on distribution of the combined work;
  internal use is different, but the exact boundary is a legal question, not a
  coding decision.
- **OCCT as a reference.** Reading OCCT docs/source to understand the
  architecture is fine; porting its classes or copying its code is not.
- **Manifold as an optional preview.** If a mesh Boolean is ever added, load it
  lazily as an optional WASM module, keep the analytic result authoritative,
  and include the Apache notice. It must not be used to certify an analytic
  boundary.
- **Patent/notice hygiene.** Apache-2.0 requires preserving notices and
  including a NOTICE file if one is provided. LGPL requires notices and
  source/relink rights for the library. GPL requires source distribution of the
  combined work. These are distribution obligations, not just attribution.

## 8. Claims not verified / open questions

These are the places where this note goes beyond a direct source statement, or
where the source itself is ambiguous. They should be checked before they are
used as hard requirements.

1. **OCCT asymptotic complexity.** The Boolean guide describes pairwise
   interference and bounding-box filtering but does not publish a worst-case
   bound. The "worst case quadratic in sub-shape pairs" statement is an
   inference from the architecture, not a quoted complexity.
2. **CGAL arrangement/Nef complexity.** The manuals describe algorithms and
   exactness, not a single big-O guarantee for all inputs. The O((n+k) log n)
   figure is the standard sweep-line expectation, not a CGAL promise for every
   traits class.
3. **CGAL corefinement complexity.** The AABB-tree broad phase and output
   sensitivity are documented qualitatively; the O((n+m+k) log(n+m)) figure is
   a practical expectation, not a quoted theorem.
4. **CGAL package licensing details.** The package overview and source headers
   are not perfectly uniform: some generated `CGAL/license/*.h` headers carry
   `SPDX-License-Identifier: LGPL-3.0-or-later OR LicenseRef-Commercial`, while
   the package overview lists Nef/Arrangements/PMP as GPL and the actual
   `Nef_polyhedron_3.h`/`Arrangement_2.h` headers carry
   `GPL-3.0-or-later`. Treat the per-file header and the package overview as
   authoritative for the specific file/package, and obtain legal advice before
   distributing.
5. **OCCT `IntPatch` behaviour for every tangency case.** The headers expose
   `TangentFaces`, `OppositeFaces`, `RLine` and isolated points, but the exact
   result for a given near-tangent configuration depends on tolerances and the
   chosen path; this note did not run OCCT to enumerate them.
6. **OCCT version-specific paths.** OCCT 8.0.1 reorganized sources into
   module/toolkit directories (e.g.
   `src/ModelingAlgorithms/TKGeomAlgo/...`). Older 7.x paths differ; the URLs
   here are pinned to `V8_0_1`.
7. **Manifold's internal guarantees at 3.5.4.** The wiki and source comments
   were read; the library was not built or fuzzed here. The manifold guarantee
   is a documented design claim, and the ε-valid guarantee is explicitly not
   a proof for all inputs [M2].
8. **Manifold complexity.** The O(n log n) broad-phase figure is the author's
   wiki statement; the number of intersections can still be O(n²), and the
   constants depend on parallelization and triangulation.
9. **CGAL `surface_intersection` availability.** It is deprecated in 6.2 in
   favour of `intersection_polylines`; older code and tutorials still use the
   old name. The report uses the new name where possible.
10. **Whether a 2-D coincident-overlap boolean is in scope.** The current
    product scope is surface geometry, but a coincident-face overlap is a 2-D
    region, not a curve. The recommendation is to report it and defer the
    region boolean; that is a scope decision, not a mathematical limitation.
11. **Performance numbers.** No benchmarks were run against EduCAD's 151
    sheets. The proposed complexity is an algorithmic estimate, not a measured
    result.

## 9. References

All URLs were accessed on 2026-11-11. OCCT references are pinned to tag
`V8_0_1`; Manifold references to tag `v3.5.4`; CGAL references are the 6.2.1
manual (`latest` at the time of writing).

### Open CASCADE Technology 8.0.1

- **[O1]** `GeomAPI_IntSS.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKGeomAlgo/GeomAPI/GeomAPI_IntSS.hxx>
- **[O2]** `GeomAPI_IntSS.lxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKGeomAlgo/GeomAPI/GeomAPI_IntSS.lxx>
- **[O3]** `GeomInt_IntSS.cxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKGeomAlgo/GeomInt/GeomInt_IntSS.cxx>
- **[O4]** `GeomInt_IntSS_1.cxx`, OCCT `V8_0_1` (contains
  `TrimILineOnSurfBoundaries` and the rectangular-bound trimming):
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKGeomAlgo/GeomInt/GeomInt_IntSS_1.cxx>
- **[O5]** `IntPatch_Intersection` reference manual, OCCT 8.0.1:
  <https://occt3d.com/dev/doc/refman/html/class_int_patch___intersection.html>
- **[O6]** `IntPatch_Intersection.cxx`, OCCT `V8_0_1` (dispatch to
  `IntPatch_ImpImpIntersection`, `IntPatch_ImpPrmIntersection`,
  `IntPatch_PrmPrmIntersection`):
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKGeomAlgo/IntPatch/IntPatch_Intersection.cxx>
- **[O7]** `IntPatch_ImpImpIntersection.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKGeomAlgo/IntPatch/IntPatch_ImpImpIntersection.hxx>
- **[O8]** `IntPatch_PrmPrmIntersection.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKGeomAlgo/IntPatch/IntPatch_PrmPrmIntersection.hxx>
- **[O9]** `IntPatch_Line.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKGeomAlgo/IntPatch/IntPatch_Line.hxx>
- **[O10]** `BRepAlgoAPI_BooleanOperation.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKBO/BRepAlgoAPI/BRepAlgoAPI_BooleanOperation.hxx>
- **[O11]** `BOPAlgo_PaveFiller.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_PaveFiller.hxx>
- **[O12]** OCCT Boolean Operations user guide, OCCT 8.0.1:
  <https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html>
- **[O13]** `BRepClass3d_SolidClassifier.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKTopAlgo/BRepClass3d/BRepClass3d_SolidClassifier.hxx>
- **[O14]** `Precision.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/FoundationClasses/TKernel/Precision/Precision.hxx>
- **[O15]** `TopoDS_Shape.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingData/TKBRep/TopoDS/TopoDS_Shape.hxx>
- **[O16]** `TopExp.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingData/TKBRep/TopExp/TopExp.hxx>
- **[O17]** `BOPAlgo_Options.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_Options.hxx>
- **[O18]** `BOPAlgo_GlueEnum.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_GlueEnum.hxx>
- **[O19]** `BRepCheck_Analyzer.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Analyzer.hxx>
- **[O20]** OCCT LGPL 2.1 license text, `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/LICENSE_LGPL_21.txt>
- **[O21]** OCCT LGPL exception, `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/OCCT_LGPL_EXCEPTION.txt>
- **[O22]** `GeomAPI_IntSS` reference manual, "domain" paragraph, OCCT 8.0.1:
  <https://occt3d.com/dev/doc/refman/html/class_geom_a_p_i___int_s_s.html>
- **[O23]** `BRepAlgoAPI_BuilderAlgo.hxx`, OCCT `V8_0_1`:
  <https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V8_0_1/src/ModelingAlgorithms/TKBO/BRepAlgoAPI/BRepAlgoAPI_BuilderAlgo.hxx>

### CGAL 6.2.1

- **[C1]** Boolean Operations on Meshes user manual:
  <https://doc.cgal.org/latest/PMP_Boolean_operations/index.html>
- **[C2]** Corefinement and Autorefinement reference:
  <https://doc.cgal.org/latest/Polygon_mesh_processing/group__PMP__corefinement__grp.html>
- **[C3]** 3D Boolean Operations on Nef Polyhedra user manual:
  <https://doc.cgal.org/latest/Nef_3/index.html>
- **[C4]** 2D Arrangements user manual:
  <https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html>
- **[C5]** `CGAL::Exact_predicates_exact_constructions_kernel`:
  <https://doc.cgal.org/latest/Kernel_23/classCGAL_1_1Exact__predicates__exact__constructions__kernel.html>
- **[C6]** `CGAL::Exact_predicates_inexact_constructions_kernel`:
  <https://doc.cgal.org/latest/Kernel_23/classCGAL_1_1Exact__predicates__inexact__constructions__kernel.html>
- **[C7]** CGAL license page:
  <https://www.cgal.org/license.html>
- **[C8]** Polygon Mesh Processing reference (license: GPL):
  <https://doc.cgal.org/latest/Polygon_mesh_processing/group__PkgPolygonMeshProcessingRef.html>
- **[C9]** `Nef_polyhedron_3.h` source header (GPL-3.0-or-later):
  <https://raw.githubusercontent.com/CGAL/cgal/main/Nef_3/include/CGAL/Nef_polyhedron_3.h>
- **[C10]** `Arrangement_2.h` source header (GPL-3.0-or-later):
  <https://raw.githubusercontent.com/CGAL/cgal/main/Arrangement_on_surface_2/include/CGAL/Arrangement_2.h>
- **[C11]** `Arr_spherical_topology_traits_2` reference:
  <https://doc.cgal.org/latest/Arrangement_on_surface_2/classCGAL_1_1Arr__spherical__topology__traits__2.html>
- **[C12]** CGAL license manual (GPL vs LGPL rationale):
  <https://doc.cgal.org/latest/Manual/license.html>

### Manifold 3.5.4

- **[M1]** Manifold README, `v3.5.4`:
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/README.md>
- **[M2]** Manifold Library wiki (manifoldness, mesh Boolean, ε-valid,
  symbolic perturbation, complexity):
  <https://github.com/elalish/manifold/wiki/Manifold-Library>
- **[M3]** `boolean3.h`, `v3.5.4`:
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/src/boolean3.h>
- **[M4]** `boolean3.cpp`, `v3.5.4` (`Intersect12`, `Winding03`,
  `Boolean3`):
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/src/boolean3.cpp>
- **[M5]** `shared.h`, `v3.5.4` (`Shadows`, `Interpolate`,
  `GetAxisAlignedProjection`):
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/src/shared.h>
- **[M6]** `utils.h`, `v3.5.4` (`kPrecision = 1e-12`):
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/src/utils.h>
- **[M7]** `manifold.cpp`, `v3.5.4` (`GetEpsilon`, `GetTolerance`,
  `SetTolerance`):
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/src/manifold.cpp>
- **[M8]** `mesh.h`, `v3.5.4` (`MeshGL::tolerance`):
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/include/manifold/mesh.h>
- **[M9]** `impl.h`, `v3.5.4` (`Impl`, half-edge storage, `epsilon_`,
  `tolerance_`):
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/src/impl.h>
- **[M10]** Manifold LICENSE (Apache-2.0), `v3.5.4`:
  <https://raw.githubusercontent.com/elalish/manifold/v3.5.4/LICENSE>
- **[M11]** Manifold v3.5.4 release:
  <https://github.com/elalish/manifold/releases/tag/v3.5.4>

### Local project references

- `public/lib/educad-surfaces.js` at `43d3b7f`: `section` (line 1316),
  `intersect` (line 1555), `tolerance` (line 1409), `surfaceTolerance`
  (line 709), `incidence` (line 448), `split` (line 2437), `splitPlan`
  (line 2336), `patchContainsPoint` (line 2056).
- `docs/SURFACE_MODEL.md`, "Intersections and trimming", "Splitting a surface
  and sharing a boundary", "Limits".
- `docs/SURFACE_COMPLEX.md`, "Where the solutions overlap", "Current state and
  next steps".
- `tools/edc.js`, surface-query parsing and recursive `matches` comparison.
- `AGENTS.md`, "Product scope" and "Reconstruction pipeline".

## 10. Ranked recommendation

### 1. Implement the tolerance policy and general point-in-patch classifier first

This is the foundation every other step depends on. Today `1e-7`, `1e-6` and
`1e-5` mean different things in `section`, `intersect` and `validate`, and
`patchContainsPoint` only handles a sphere cap, a two-loop cylinder band, or a
cone band/tip with a loop plus apex. A single `TolerancePolicy` plus `classifyPoint` with
`inside/outside/boundary/unknown` gives clipping, splitting, tangency and
certification a shared answer. Without it, every new clipping rule will
re-invent its own epsilon and its own patch test.

**Why first:** it is small, testable with existing sheets, and it removes the
main source of inconsistency before adding more geometry.

### 2. Implement bounded clipping of the existing exact families

Add `intersectBounded`/`clipBranchToPatch` on top of the current `intersect`
algebra. Use cut stations plus midpoint classification, not a full
arrangement. Support the families that already have exact support curves:
line, circle, ellipse, coaxial circle pairs, tangent points, and the existing
plane–quadric sections. Emit analytic sub-arcs with residuals and explicit
unresolved intervals.

**Why second:** it directly removes the "unbounded support" limitation with
the least new mathematics, and it reuses the exact formulas already tested by
`surface-intersect-*.edu`.

### 3. Implement topology promotion and `splitByIntersection`

Turn bounded segments into shared boundary elements: split loops at the same
stations, create/reuse vertices, share the exact sub-arc objects, and return
two patches just like the current crossing `split`. Extend `intersectionCurves`
to promote sub-arcs, not only closed circles/ellipses. This is the general form
of the operation that the fillet/recess features need.

**Why third:** clipping without topology is still only a query. Topology
promotion is what closes shells, makes incidence 2 meaningful, and lets the
certificate check a real model. It builds directly on steps 1–2.

### 4. Expand the exact families in value order

After the base works, add the cheapest high-value families:

1. plane–conic clipping and a real parameterization for the cone's
   ellipse/parabola/hyperbola sections (the classifier already exists but
   returns an unparameterized `conic`);
2. bounded sphere–sphere and coaxial sphere–cylinder arcs;
3. parallel/coaxial cylinder–cylinder clipped lines;
4. plane–plane bounded segment/overlap in 2-D;
5. only then consider skew cylinder–cylinder or offset-axis sphere–cylinder.
   Those are quartic; do not pretend they are conics.

**Why after 1–3:** each new family is independent algebra; the clipping and
topology machinery should already be stable so the new family only supplies a
branch parameterization and root stations.

### 5. Add a conservative numerical tracer only for explicitly unsupported families

If the teaching domain needs a quartic branch, implement a branch tracer with
interval/root isolation and residual certification. It must return
`confidence:'numeric'`, an interval of uncertainty, and a diagnostic if it
cannot certify the branch. It must never be promoted as an exact boundary
without an explicit `allowNumeric` opt-in.

**Why fifth:** it is the highest-complexity, lowest-certainty part. It should
not block the exact, high-value work above.

### 6. Add an optional mesh backend for preview/validation, not for truth

If a mesh Boolean is useful for the 3-D preview or for an independent
sanity check, integrate Manifold (Apache-2.0) as a lazy optional WASM module.
Keep the analytic model authoritative; label mesh results as approximate; do
not feed mesh triangles into the analytic certificate. CGAL can remain an
offline oracle for test generation.

**Why last:** it adds a dependency and a second source of truth, and it does
not solve the analytic boundary problem. It is useful only after the analytic
path is trustworthy.

### What not to do

Do not port OCCT's `IntPatch`/`BOPAlgo` hierarchy, do not add CGAL's GPL
arrangements/Nef to the runtime, and do not replace analytic boundaries with
Manifold triangles. The project's advantage is the small, explainable analytic
model; the recommended design keeps that advantage while adding the one
missing general operation: **bounded patch intersection with explicit
classification and shared topology**.

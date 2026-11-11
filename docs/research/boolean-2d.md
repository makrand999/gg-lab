# Boolean, arrangement, and triangulation options for Major

**Status:** research/design note, 2026-11-11. No production code is changed.
**Scope:** the original Major pipeline (`public/lib/educad-*.js`, `tools/scripts/*.edu`).
**Question:** how should Major grow from bounded analytic surface patches to
region/solid Boolean operations, and which parts of that work belong to an
analytic B-rep, a 2D arrangement, a mesh Boolean, or an implicit surface?

This note compares Major's current planar face pass, analytic surface complex,
loop splitting, display triangulation and partial fillet closure with several
mature open-source families. It ends with a ranked recommendation and the
smallest useful next milestone.

The comparison is deliberately about **architecture and guarantees**, not about
copying an implementation. No source code from the cited projects was copied
into this repository. Version numbers and URLs are pinned in the source list at
the end; unverified claims are collected in section 8.

---

## 1. Current architecture and where Booleans are missing

### 1.1 Pipeline as it exists

Major's reconstruction pipeline currently runs in this order:

```text
2D drawing primitives in orthographic views
  -> view correspondence / primitive lifting
  -> 3D vertices, straight edges, analytic curves
  -> planar face pass (per supporting plane)
  -> display faces and faceRegions
  -> surfacePatches
  -> bounded analytic surface model
       plane | cylinder | cone | sphere
       ordered loops of curves, lines, vertices, sections
  -> section / intersect / trim / split / attach / certify
```

The surface model is described in `docs/SURFACE_MODEL.md` and
`docs/SURFACE_COMPLEX.md`. The planar pass is described in
`docs/PLANAR_RECONSTRUCTION.md`. The important implementation locations are:

- `public/lib/educad-reconstruct.js:858-869` — `supportingPlanes()` discovers
  candidate planes from every non-collinear incident edge pair at a vertex.
- `public/lib/educad-reconstruct.js:908-945` — `splitPlanarCrossings()` inserts
  proper 2D segment/segment crossings and splits edges at those crossings.
- `public/lib/educad-reconstruct.js:949-969` — `splitSpatialEdges()` splits
  collinear edges at existing spatial vertices.
- `public/lib/educad-reconstruct.js:973-1028` — `traceOuterFace()` walks
  half-edges with angular ordering and returns **the largest absolute-area
  cycle of one connected planar component**.
- `public/lib/educad-reconstruct.js:1057-1108` — `selectManifoldFaces()` is a
  bounded backtracking search over candidate faces, preferring a closed shell,
  then a manifold surface with boundary.
- `public/lib/educad-reconstruct.js:1113-1303` — `extractPlanarFaces()` is the
  complete planar pass: group by plane, project, split crossings, take the
  largest outer face, infer holes by containment, select a manifold subset,
  propagate winding and orientation.
- `public/lib/educad-reconstruct.js:1308-1355` — `validateInferredSurfaces()`
  triangulates only convex loops with no holes (a fan), deliberately skipping
  faces with holes because no bridge/hole triangulation exists.
- `public/lib/educad-surfaces.js:93-360` — `Surfaces.build()` turns planar
  regions and primitive patches into bounded analytic surfaces.
- `public/lib/educad-surfaces.js:1316-1553` — `section()`; `:1555-1567` —
  `intersect()`; `:1569-1604` — `loopSide()`; `:1608-1633` — `trim()`;
  `:2239-2334` — crossing-loop split; `:2340-2444` — `split()`;
  `:2468-2539` — `attachBoundary()` / `shareBoundary()`; `:2541-2565` —
  `intersectionCurves()`.

The analytic model is genuinely useful: a cylinder, cone or sphere is stored as
an analytic support with ordered boundary loops, not as a triangle mesh. The
certificate checks the analytic definitions and boundary incidence separately
from the display triangles. That separation should be preserved.

### 1.2 What the planar pass really is

`extractPlanarFaces()` is closer to a **partial planar arrangement** than to a
Boolean engine:

- It builds a planar graph per supporting plane, splits proper crossings, and
  orders half-edges by angle.
- It traces boundary cycles, but only keeps the largest cycle per connected
  component (`traceOuterFace` returns one loop, not all faces).
- It discovers holes by testing whether disconnected loops are contained in
  another loop, and uses even/odd nesting as the material convention.
- It runs a subset search to choose a manifold set of faces. Ties become
  `ambiguous-surface`; exhaustion becomes `search-limit`; invalid winding or
  vertex links become `invalid-surface`.
- It does not compute a winding number per cell, does not overlay two regions,
  does not split collinear overlaps, and does not retain a cell decomposition.

This is adequate for previewing a wireframe that tiles a shell. It is not an
arrangement that can answer "which material is on each side of this curve?" and
therefore cannot by itself implement union, difference or intersection.

### 1.3 Boolean-shaped operations that exist, and what they actually do

| Operation | Current behavior | Why it is not a Boolean |
|---|---|---|
| `Surfaces.section(surface, plane)` | Exact analytic section of a supporting surface: line, circle, ellipse, conic classification, tangent point. | It describes the unbounded support. It does not clip to the bounded patch and does not decide material side. |
| `Surfaces.intersect(a, b)` | Exact intersection for plane/plane, plane/quadric, sphere/sphere, coaxial cylinder/cylinder, axis-through-centre sphere/cylinder. | Unbounded supports only. Unsupported pairs return `null`. No bounded clipping, no region classification. |
| `Surfaces.trim(surface, plane, keepPositive)` | Replaces discarded loops with one closed circle/ellipse section. | One plane, one side, closed section only. Refuses crossing loops, line sections, conics and tangent points. Does not trim a planar face. |
| `Surfaces.split(surface, plane)` | Divides one **curved** surface into two pieces at a plane; shares a full section or analytic section sub-arcs. | One surface, one plane. Refuses planar surfaces (`split-plane-surface-unsupported`, `educad-surfaces.js:2348-2350`). Refuses non-circle/ellipse sections (`:2362-2366`). Produces two patches of the same surface, not two solids. |
| `Surfaces.attachBoundary` / `shareBoundary` | Promotes an existing boundary object into another loop so incidence becomes 2. | Purely structural. It does not clip either surface, remove the covered outer loop, orient material, or merge coincident regions. The docs say this explicitly in `docs/SURFACE_MODEL.md:887-891`. |
| `Surfaces.intersectionCurves(result)` | Promotes a closed circle/ellipse intersection into a reusable boundary curve. | Promotion only; no chaining into a resolver and no clipping. |
| `Surfaces.certify` | Checks analytic parameters, boundary-on-surface residuals, incidence, open/non-manifold boundaries and shells. | A consistency certificate, not a solid-model validity proof and not a Boolean. |

### 1.4 Concrete places where the missing Boolean is visible

**Cylindrical recess.** `docs/SURFACE_MODEL.md:685-690` records the key
divergence: the analytic cavity certificate is `ok`, but
`surfaceValidation=issues` because the surrounding plate's display face still
covers the mouth. The cavity is a separate closed shell; the host face was not
cut. In Boolean terms, this is a **difference of a planar face by a closed
mouth loop**, followed by sharing the mouth boundary with the cavity. It is not
performed today.

**Spherical recess.** The same pattern: the sphere cap and an optional plane
closure share the mouth loop, but the surrounding material face is not
subtracted (`docs/SURFACE_MODEL.md:804-808`). A bare mouth circle remains an
ordinary boundary rather than an inner loop of the plate face.

**Fillet.** `docs/SURFACE_MODEL.md:747-752` and `:826-831`: the fillet cylinder
shares its two tangent generator lines with two planar strips, but its end arcs
and the strips' outer edges stay open. The analytic certificate is `partial`
with `certificate-open-component`. This is correct behavior for a **feature
patch without a host solid**, not a bug that a fake end cap should hide. Closing
it requires trimming the actual wall/floor faces and sharing the tangent and
end boundaries, or unioning with a reconstructed host solid.

**Coplanar overlaps.** `extractPlanarFaces()` traces only the largest cycle per
connected component. Two overlapping or adjacent coplanar regions are not
overlaid into cells, and collinear overlapping edges are not split or merged.
If two primitives produce coplanar faces that should be unioned, the current
pass can retain duplicate or nested candidates instead of one region.

**Notches and internal cuts.** A notch that shares the outer boundary is a
single non-convex cycle and can be traced. An internal cut that is connected to
the outer boundary by an edge creates internal cycles; only the outer cycle is
returned. The pass can therefore show the wrong material region even when the
wire is topologically connected.

**Holes and triangulation.** The renderer fills faces with the canvas
`evenodd` rule and can accept `faceHoles`
(`public/lib/educad-solid.js:1053-1076`). The strict display triangle
certificate, however, skips every face with a hole or a concave loop
(`public/lib/educad-reconstruct.js:1330-1340`). A Boolean result with holes is
therefore displayable but not certifiable as a triangle mesh until a real
polygon-with-holes triangulator exists.

### 1.5 Why `split` is not the missing Boolean

`Surfaces.split()` is a valuable primitive, but it is a **one-surface plane
cut**:

- It requires a bounded curved surface; a bounded planar face is refused.
- It requires a closed circle/ellipse section. A line set, tangent point,
  classified conic or coplanar overlap is refused.
- It splits the boundary loop and assembles same-side cycles. It does not
  classify the resulting patches against another solid.
- It returns two patches of one support. It does not union two solids, subtract
  one solid from another, or stitch a shell from mixed surfaces.

The same limitation applies to `trim`: it is a one-sided loop replacement, not
a material Boolean.

### 1.6 Summary of the gap

Major has:

- analytic **sections and intersections** of supported analytic surfaces;
- analytic **boundary splitting** of a curved patch by one plane;
- structural **boundary sharing** and incidence accounting;
- an analytic **certificate**.

Major does not have:

- a general **2D region arrangement** with winding/fill labels;
- a **planar face Boolean** (difference by a loop, union/intersection of
  coplanar regions);
- a **surface split by an arbitrary intersection curve** (only planes);
- a **solid Boolean** (inside/outside classification, shell assembly);
- a **feature closure** operation for fillets and recesses against a host;
- a polygon-with-holes **triangulator** for display/export certification.

The rest of this note evaluates how to add those without weakening the analytic
model.

---

## 2. Candidate approaches

### 2.1 Analytic B-rep Booleans

**Idea:** keep the existing bounded analytic representation. For two solids,
compute every pairwise surface intersection, clip each intersection curve to
both bounded patches, split both patches along those curves, classify each
resulting region as inside/outside the other solid, keep the regions selected
by the operation, and stitch the kept boundaries into shells.

This is the natural extension of Major's model. It preserves surface identity
and dimensions, and it can certify what it did. The hard parts are:

1. **Intersection algebra for every surface pair.** Today only a subset is
   supported. Skew cylinder/cylinder, cone/cone, cone/cylinder, cone/sphere and
   offset sphere/cylinder are missing.
2. **Clipping to bounded patches.** A supporting intersection can leave the
   patch, enter a hole, or cross a seam. This needs a general point-in-patch
   test and curve/loop chaining, not the current sphere-cap/cylinder-station
   special cases.
3. **Region classification.** Each split region must be classified against the
   other solid. For a closed shell this can be a ray cast or a winding query
   against the analytic complex; for an open feature patch there is no
   inside/outside until a host exists.
4. **Shell assembly and orientation.** Shared boundaries must be the same
   objects, orientation must be consistent, and non-manifold contacts must be
   either represented deliberately or refused.
5. **Robustness.** Tangencies, coincident faces, seams and near-degenerate
   curves are the normal case in engineering drawings, not the exception.

For Major's current families, the needed pairs are mostly plane/cylinder,
plane/cone, plane/sphere and plane/plane — all already exact. That makes a
**limited** analytic Boolean for recesses and planar cuts feasible before a
general one.

### 2.2 Mesh Booleans

**Idea:** tessellate each bounded surface into a triangle mesh, run a mesh
Boolean, and use the result as display/export geometry.

Strengths:

- General topology and arbitrary intersection curves.
- Mature implementations guarantee a manifold output mesh (Manifold).
- Good performance and parallel broad phase.
- Easy to visualize and export.

Weaknesses:

- The result is a triangle mesh, not a plane/cylinder/cone/sphere with loops.
  Dimensions, feature identity and analytic certificates are lost.
- The input must be a watertight manifold. Major's recess and fillet display
  meshes are open feature patches, and the host plate currently covers the
  mouth. A mesh Boolean cannot repair a non-manifold input by itself.
- Coplanar faces and exact tangencies become numerical decisions; the output
  may be manifold but geometrically approximate.
- A mesh Boolean does not know which triangles belong to a drilled hole, a
  boss, a fillet or a host face unless the implementation carries provenance
  IDs.
- Every subsequent analytic query would need reverse engineering of the mesh.

A mesh Boolean is therefore a **preview/export or last-resort fallback**, not
the reconstruction source of truth.

### 2.3 2D arrangements and region Booleans

**Idea:** in a plane, build the arrangement of all boundary curves (lines and
analytic arcs), label each arrangement edge with its source and orientation,
compute a winding number for every face, and select faces by a Boolean
predicate on the operands' winding numbers. Then trace the boundary between
selected and unselected faces into regions with holes.

This is the exact 2D analogue of a B-rep Boolean and is the right tool for:

- a planar face minus a closed mouth circle (the recess case);
- union/intersection/difference of coplanar faces;
- inserting an inner loop or an island;
- splitting a planar face by a section curve, not just a full plane;
- extracting view regions with holes before lifting;
- trimming a wall/floor plane around a fillet's tangent lines and end arcs.

It is also the right **implementation core** for a later surface arrangement:
each surface can be parameterized to 2D, and the same DCEL/winding machinery
can operate in parameter space, provided the parameterization and seam handling
are explicit.

The main limitation is obvious: it is 2D. It does not by itself close a fillet
between non-coplanar faces, and it cannot classify a 3D solid.

### 2.4 SDF / implicit surfaces

**Idea:** represent a solid as a signed distance field and extract a mesh by a
level-set algorithm.

Strengths:

- Easy unions/differences/intersections by min/max.
- Natural blends and fillets.
- Handles arbitrary topology without a B-rep.

Weaknesses:

- Resolution-dependent; thin features, sharp edges and exact dimensions are
  smeared.
- No analytic surface identity, no exact boundary loops, no incidence
  certificate.
- Mesh extraction is expensive and produces many triangles.
- The input drawing is boundary-defined, not an SDF; constructing a good SDF
  from the drawing is itself a research problem.

SDF is useful for a visual blend/fillet fallback or a voxel preview, not for
dimensioned engineering reconstruction. Major's own scope emphasizes analytic
surface geometry and explicit dimensions, so SDF is the lowest-priority
candidate.

---

## 3. OSS design details

The projects below were chosen because they represent distinct answers to the
same design questions: topology, predicates, robustness, performance and
guarantees. None is proposed as a drop-in runtime dependency.

### 3.1 Manifold (v3.5.4, Apache-2.0)

**Primary sources**

- <https://github.com/elalish/manifold> (release `v3.5.4`, 2026-09-25)
- <https://github.com/elalish/manifold/wiki/Manifold-Library> (algorithm note)
- `src/boolean3.cpp`, `src/boolean3.h` — 3D mesh Boolean
- `src/boolean2.cpp`, `src/boolean2.h`, `src/boolean2_sweep.cpp` — 2D polygon
  Boolean/offset/sweep
- `src/polygon.cpp` — polygon triangulation
- `src/collider.h` — BVH broad phase
- `src/sdf.cpp` — level-set extraction
- `include/manifold/manifold.h` — public API and `LevelSet`

**Topology.** Manifold separates topology (integer indices and incidence) from
geometry (floating-point positions and properties). Its manifoldness definition
is topological: every triangle edge has exactly one opposite edge with the same
two vertex indices and reversed direction. This makes the set of manifold
meshes closed under Boolean operations even when vertices are duplicated
geometrically. The internal representation stores vertices, half-edges and
faces with oriented incidence; `originalID` and `faceID` retain provenance to
input meshes and faces.

**Predicates and robustness.** Manifold explicitly does **not** use exact
arithmetic for the Boolean. It follows Julian Smith's approach: accept
floating-point error, never ask the same geometric question two different ways,
and make the result manifold by construction. Symbolic perturbation breaks ties
for exactly equal floating-point coordinates; for common axis-aligned
coincident faces this avoids zero-thickness shards and holes. The geometry is
allowed to be `epsilon`-valid rather than exact. The project states that the
manifoldness guarantee holds for manifold input, while geometric validity is a
best-effort guarantee for `epsilon`-valid input; self-overlapping input is
outside the guarantee.

**Performance.** A parallel BVH broad phase reduces the naive all-pairs
triangle test from quadratic to roughly `O(n log n)` for typical inputs. The
Boolean and triangulation are partly serial; small problems fall back to serial
code. The WASM build is serial-only but still fast. The public API includes
`Boolean`, `BatchBoolean`, `LevelSet`, `Extrude`, `Revolve`, `Simplify` and
`Decompose`.

**Guarantees.** Guaranteed manifold output for manifold input; no guarantee
that the output is free of all degenerate triangles; no exact geometric
predicate guarantee. The project calls its Boolean the first guaranteed-
manifold mesh Boolean, which is a project claim rather than an independently
verified theorem.

**Why it matters here.** Manifold is the strongest mesh-Boolean candidate, and
its newer `boolean2` module is also a good architectural reference for a 2D
arrangement. `src/boolean2.h` describes a maintained-status sweep that discovers
crossings and vertex-on-edge incidences, applies a block rule for dense
near-concurrences, then runs a winding sweep to emit retained boundary edges.
That is almost exactly the 2D arrangement core Major needs. It is C++/WASM,
Apache-2.0, and not a zero-dependency browser module.

### 3.2 CGAL (v6.2.1, GPL/LGPL by package)

**Primary sources**

- <https://github.com/CGAL/cgal> (release `v6.2.1`, 2026-09-04)
- <https://doc.cgal.org/latest/Nef_3/index.html>
- <https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html>
- <https://doc.cgal.org/latest/Boolean_set_operations_2/index.html>
- <https://doc.cgal.org/latest/Manual/license.html>
- <https://www.cgal.org/license.html>

#### Nef polyhedra in 3D

A Nef polyhedron is a point set generated from a finite number of open
halfspaces by complement and intersection. The class `Nef_polyhedron_3` is a
boundary representation of such a set. It is closed under union, intersection,
difference, symmetric difference and complement, and it can represent
non-manifold and lower-dimensional features (edges, vertices, open/closed
boundaries) that a 2-manifold B-rep cannot.

Its topology is a **Selective Nef Complex (SNC)**: oriented edges, edge-uses,
oriented facets with outer and inner boundary cycles, shells and volumes, plus
a sphere map for each vertex that records the local pyramid. This is the most
general exact polyhedral B-rep in the comparison. Two Nef polyhedra with the
same point set have the same reduced representation, so equality and subset
comparison are structural.

The critical limitation for Major: Nef polyhedra are **polyhedral**. Their
facets are planar; the construction is from halfspaces and planar facets. A
cylinder, cone or sphere must be tessellated before it becomes a Nef
polyhedron, which loses the analytic surface. Nef is therefore not a direct
solution for Major's curved analytic model, although its local-classification
ideas are relevant.

Robustness requires an exact kernel. The manual recommends `Homogeneous`,
`Exact_predicates_exact_constructions_kernel` (EPECK) or
`Extended_homogeneous`; EPECK with filtering is usually faster than homogeneous
on non-degenerate input. Conversion to `Polyhedron_3` is only possible when the
Nef boundary is an oriented closed 2-manifold.

#### 2D arrangements

`Arrangement_2<Traits, Dcel>` is a DCEL of vertices, half-edges and faces. Each
edge is a pair of twin half-edges; each half-edge has a source, target, twin,
previous/next in the face cycle, and an incident face. A face has an outer CCB
(counter-clockwise) and zero or more inner CCBs (holes, clockwise), plus
isolated vertices. The geometry traits class supplies the curve type and the
predicates; bundled traits cover line segments, polylines, circular arcs,
conics and rational functions.

Arrangement construction can be incremental (insert a curve and compute its
zone) or aggregate by a plane sweep. The manual gives the aggregate complexity
as `O((n + k) log n)`, where `n` is the number of input curves and `k` the
number of intersection points. Overlay of two arrangements is also a plane
sweep; the Boolean set-operations package similarly reduces the operation to a
planar arrangement and extracts the result from it. The exactness of the result
depends on the traits/kernel: exact predicates suffice for intersection
predicates, but constructions such as new intersection vertices require exact
constructions (EPECK) for guaranteed robustness.

#### 2D regularized Boolean set-operations

`Polygon_set_2` / `General_polygon_set_2` represent a set of polygons with
holes on top of an internal `Arrangement_2`. Operations are **regularized**:
the result is the closure of the interior of the ordinary set operation, so
isolated lower-dimensional pieces are removed. The result is unique regardless
of operation order, and disconnected components are represented separately.
The package supports intersection, join (union), difference, symmetric
difference, complement, `do_intersect`, and point containment queries. General
polygons may be bounded by `x`-monotone circular arcs or conic arcs, not only
line segments.

This is the closest conceptual match to Major's planar need: analytic arcs,
holes, winding, and regularized Boolean semantics. The blockers are the C++
API, the GPL license of the relevant packages, and the build/runtime weight.

**License.** The Nef_3 reference page states `License: GPL`; the
Boolean_set_operations_2 reference page states `License: GPL`; the Arrangement
reference page states `License: GPL`. The kernel and support layers are LGPL,
but the packages Major would need are the GPL higher-level ones. CGAL offers a
commercial license for applications that cannot accept GPL.

### 3.3 Clipper2 (v2.0.1, BSL-1.0)

**Primary sources**

- <https://github.com/PolyClipping/Clipper2> (current home, release
  `Clipper2_2.0.1`, 2026-10-26)
- <https://github.com/AngusJohnson/Clipper2> (original repository, archived
  2026-10-28)
- <https://www.angusj.com/clipper2/Docs/Overview.htm>
- <https://www.angusj.com/clipper2/Docs/Robustness.htm>
- `CPP/Clipper2Lib/include/clipper2/clipper.engine.h`, `clipper.offset.h`,
  `clipper.triangulation.h`, `clipper.core.h`

**Architecture.** Clipper2 performs intersection, union, difference and XOR on
simple and complex polygons, plus polygon offsetting and constrained Delaunay
triangulation. It is based on Bala Vatti's polygon clipping algorithm, extended
with a scanbeam and active-edge list. It supports open subject paths (clip
paths must be closed), multiple fill rules (EvenOdd, NonZero, Positive,
Negative), and a `PolyTree` hierarchy that preserves outer/hole nesting.

There are two engines: `Clipper64` for `Path64` integer paths and `ClipperD` for
`PathD` floating-point paths. Both perform clipping in **integer coordinates
internally**; `ClipperD` scales doubles to integers with a user-selected decimal
precision and de-scales the result. Coordinates must remain within about 62
bits (`±4.6e18`) to leave room for addition/subtraction and the sign bit; the
intersection routine degrades gradually beyond `±1e15`.

**Robustness.** Integer arithmetic gives constant ±1-unit imprecision, which is
why Clipper2 is much more robust than a naive floating-point Vatti
implementation. The library warns that near-zero-area results (for example, a
triangle with an edge shorter than about 2 units) can be removed as rounding
artifacts, and that paths should be scaled so features are comfortably above
one integer unit. Offsetting requires non-intersecting closed paths;
intersecting or self-intersecting polygons must be unioned first. Offsetting
supports miter, square, bevel and round joins, with a miter limit and arc
tolerance.

**Triangulation.** `Triangulate()` performs constrained Delaunay
triangulation (or a faster non-Delaunay variant) and requires input polygons
that do not intersect or self-intersect. It is a post-arrangement triangulator,
not a Boolean engine.

**Fit.** Clipper2 is an excellent reference for a robust integer/snap-rounded
2D Boolean and the best candidate if Major ever needs polygon offsetting. It is
not a direct fit for analytic arcs: converting a circle to a polygon loses the
exact radius and tangency, and the integer grid introduces a quantization
choice. A TypeScript port exists, but it is not an official JS build, and the
project is C++-first.

### 3.4 Boost.Geometry (Boost 1.93.0, BSL-1.0)

**Primary sources**

- <https://www.boost.org/doc/libs/latest/libs/geometry/doc/html/index.html>
- <https://www.boost.org/doc/libs/latest/libs/geometry/doc/html/geometry/release_notes.html>
- <https://github.com/boostorg/geometry>

**Architecture.** Boost.Geometry is a header-only generic geometry library
following the OGC Simple Features model. It provides `union_`, `intersection`,
`difference`, `sym_difference`, `buffer`, relational predicates, and an R-tree.
Geometry types are adapted through traits; algorithms dispatch on geometry tag
and coordinate system. For areal operations it uses a turn-based overlay:
compute turns between rings, cluster them, and traverse the resulting graph.

**Predicates and robustness.** The default Cartesian strategies use floating
point and explicit robustness policies (which can be disabled with
`BOOST_GEOMETRY_NO_ROBUSTNESS`); the library does not provide a formal exactness
guarantee. Rescaling to an integer grid was the historical robustness
mechanism, but it was turned off by default in Boost 1.79 and the deprecated
rescaling code was removed in 1.87. The release notes show a long series of
union/intersection/difference fixes through 1.92, including invalid results for
complex cases. Polygons are linear rings; circular arcs are approximated by
segments (for example by `buffer`), not represented exactly.

**Fit.** Useful as a design reference for turn/cluster overlay and for
OGC-style polygon semantics. Not a runtime fit: C++ only, no analytic arcs, and
the robustness history is a warning for a dimensioned CAD tool.

### 3.5 earcut (v3.2.4, ISC)

**Primary sources**

- <https://github.com/mapbox/earcut>
- `src/earcut.js`, `README.md`, `package.json`

**Architecture.** Earcut is a small JavaScript ear-slicing triangulator
optimized with a z-order curve and spatial hashing. It supports holes by
linking ring vertices, and it attempts to handle twisted polygons, degeneracies
and self-intersections. It returns triangle indices into the flattened input.

**Guarantees.** The current README is explicit: earcut does **not** guarantee a
correct triangulation on arbitrary input. It assumes a valid polygon (rings do
not self-cross or overlap, holes are inside the outer ring, no duplicate or
zero-length edges). On invalid input it can produce overlapping triangles,
gaps, or triangles outside the polygon. It also does not produce a conforming
mesh: a vertex may lie in the middle of another triangle's edge (a T-junction).

**Performance.** The README reports ~445 ms for 119,680 real-world polygons
(1.9M vertices) on an M1 Pro, plus ~168 ms for optional Delaunay refinement.
That is a project benchmark, not an independent measurement.

**Fit.** If Major needs a small, dependency-free triangulator for **already
validated** arrangement faces, earcut is the most practical JS starting point.
It must not be used to decide topology, and its output should be checked for
zero-area or inverted triangles. The T-junction caveat matters if the mesh is
used for FEM/navmesh rather than rendering.

### 3.6 libtess2 (README 1.0.3; tag v1.0.2, SGI-B-2.0)

**Primary sources**

- <https://github.com/memononen/libtess2>
- `Source/sweep.c`, `Source/mesh.c`, `Source/geom.c`, `Source/tess.c`
- `Include/tesselator.h`

**Architecture.** libtess2 is a refactored GLU tessellator: a sweep-line mesh
with a priority queue, edge dictionary and winding rules. It accepts contours,
supports holes, self-intersections and multiple winding rules
(`TESS_WINDING_ODD`, `NONZERO`, `POSITIVE`, `NEGATIVE`, `ABS_GEQ_TWO`), and can
output triangles, polygons, boundary contours or connected polygons. The
bucketed allocator is a major performance improvement over the original GLU
code.

**Robustness.** It is designed to handle messy input and self-intersections by
winding rules, but it is floating-point and does not provide an exactness or
manifoldness guarantee. The project is minimally maintained; the README says
version 1.0.3 while the latest release tag is v1.0.2 (2019), with repository
activity in 2025.

**Fit.** A robust-ish tessellator for display/export of complex contours. It is
C, not JS, and it does not preserve analytic arcs. It is heavier than earcut
and not a Boolean engine.

### 3.7 poly2tri (untagged master, BSD-3-Clause)

**Primary sources**

- <https://github.com/jhasse/poly2tri>
- `poly2tri/poly2tri.h`, `poly2tri/sweep`, `poly2tri/common`
- Pinned commit `4732e46da88086c6b7b3935a5b4f6f87360062c3` (2026-10-20)

**Architecture.** Poly2Tri is a sweep-line constrained Delaunay triangulation
(CDT) library based on the Domiter–Zalik sweep-line algorithm, with a FlipScan
step. It supports simple polygons, holes and interior Steiner points.

**Guarantees / limits.** Its README is explicit: only simple polygons are
supported; holes must not touch each other or the outer boundary; repeated
points within epsilon are not supported; there is no input validation. It is a
triangulator for a valid planar straight-line graph, not a Boolean/arrangement
engine. It is C++ and has no tagged release.

**Fit.** Good reference for CDT quality if Major needs a Delaunay mesh for
analysis. Not needed for the first Boolean milestone.

### 3.8 Implicit / SDF (Manifold `LevelSet`)

Manifold exposes a `LevelSet` constructor that takes a signed-distance
function and bounds, and contains a level-set implementation in `src/sdf.cpp`
that it describes as improving significantly over marching cubes. The output is
still a triangle mesh; the SDF is sampled on a grid, so sharp edges and
dimensions are resolution-limited. This is the strongest readily available
SDF-to-manifold path, but it does not solve the analytic reconstruction
problem.

---

## 4. Comparison matrix for EduCAD

### 4.1 Boolean / arrangement engines

| Approach | Curved analytic geometry | Holes / overlaps | Predicates / robustness | Offset | Topology guarantee | Browser / zero-dep fit | License | Verdict for Major |
|---|---|---|---|---|---|---|---|---|
| Current planar pass (`extractPlanarFaces`) | Planar only; curves are approximated as display edges | Holes by nested disconnected loops; no coplanar overlay; no collinear overlap merge | Floating point, absolute tolerances (1e-6/1e-8); no exact predicates | None | Manifold subset search; ambiguous/exhausted refused | Native JS, zero-dep | MIT (project) | Keep as preview; upgrade to a real arrangement |
| Analytic B-rep (proposed) | Yes, exact within stored decimal parameters | Yes once curves are clipped and classified | Analytic; tolerance checks; exact rational certificate for some checks | Analytic for circles/planes; not general | Can be validated by incidence/certificate; non-manifold must be refused or represented | Native JS, zero-dep | MIT | **Primary long-term direction** |
| CGAL Nef 3D | No: planar facets only; curves must be tessellated | Yes; non-manifold and lower-dimensional features | Exact kernels (EPECK/homogeneous); robust | Not a focus | Closed under Boolean; SNC representation | C++ only; heavy build | GPL for Nef_3 | Reference for local classification; not a runtime dependency |
| CGAL 2D arrangements / Boolean | Yes for circular/conic arcs | Yes; regularized Boolean; unique polygon-with-holes result | Exact predicates; exact constructions required for new vertices | Not part of the core comparison; other CGAL packages cover skeletons/offsets | Regularized 2D sets; robust with EPECK | C++ only | GPL for Arrangement and Boolean_set_operations_2 | Best conceptual model; license/build block direct use |
| Manifold | Only as tessellated triangles | Yes, mesh-level | No exact arithmetic; symbolic perturbation; guaranteed manifold topology | 2D offset in `boolean2`; 3D Minkowski | Guaranteed manifold output for manifold input | C++/WASM; npm `manifold-3d`; not zero-dep | Apache-2.0 | Best mesh-Boolean fallback/preview |
| Clipper2 | No: integer polygons; arcs approximated | Yes; fill rules; PolyTree | Integer ±1 unit; 62-bit range; snap-rounding style | Excellent 2D offset (miter/square/bevel/round) | No manifold concept; valid polygons with holes | C++/C#/Delphi; JS ports unofficial | BSL-1.0 | Reference for 2D Boolean/offset; not analytic |
| Boost.Geometry | No: linear rings | Yes; OGC set ops | Floating point + robustness policies; no formal exactness | `buffer` approximates curves | No manifold guarantee | C++ header-only | BSL-1.0 | Design reference only |
| SDF / Manifold LevelSet | Approximate only | Yes, topology-free | Resolution-dependent | Blends by min/max | Manifold after extraction | C++/WASM | Apache-2.0 | Visual/fallback only |

### 4.2 Triangulators

| Project | Input requirement | Holes | Self-intersections | Quality / conformity | Robustness | Language / license | Fit |
|---|---|---|---|---|---|---|---|
| earcut 3.2.4 | Valid simple rings with holes inside | Yes | Attempted, no guarantee | Fast ear slicing; non-conforming (T-junctions possible) | No correctness guarantee; assumes valid input | JS, ISC | Best small JS option after arrangement validation |
| libtess2 1.0.3 | Contours; winding rules | Yes | Handles via winding | GLU-quality mesh; triangles/contours | Floating point; no exact guarantee; minimally maintained | C, SGI-B-2.0 | Robust display tessellator if C/WASM is acceptable |
| poly2tri | Simple polygon + holes/Steiner | Yes | Not supported | Constrained Delaunay | No input validation; simple polygons only | C++, BSD-3-Clause | CDT quality if analysis mesh is needed |
| Clipper2 `Triangulate` | Non-intersecting polygons | Yes (via paths) | Not supported; union first | Constrained Delaunay optional | Integer, robust within range | C++, BSL-1.0 | Good if Clipper2 is already used for 2D |

### 4.3 What each candidate solves for Major

| Major need | Best candidate | Why |
|---|---|---|
| Plate face minus recess mouth | In-house 2D arrangement | Exact circles/arcs, holes, no dependency, directly extends `Surfaces` |
| Union/intersection of coplanar faces | In-house 2D arrangement | Winding/overlay is the correct semantics |
| Split a planar face by a section curve | In-house 2D arrangement | Current `split` refuses planar faces |
| Trim a wall/floor around a fillet | In-house 2D arrangement on each plane + analytic tangent/end arcs | Fillet ends are planar cuts on the host faces |
| Split a curved patch by an arbitrary intersection curve | Analytic B-rep extension | 2D arrangement alone cannot do 3D curve clipping |
| Solid union/difference/intersection | Analytic B-rep (limited families); Manifold fallback | Preserve analytic surfaces; mesh only if unsupported |
| Display/export mesh of a Boolean result | earcut or libtess2 after arrangement | Renderer needs triangles/holes; current cert skips holes |
| Polygon offset / clearance | Analytic for circles/planes; Clipper2 reference for general polygons | Offsetting is not a core reconstruction need |
| Torus/variable fillet or complex blend | SDF/mesh fallback, explicitly approximate | No analytic implementation in scope |

---

## 5. Recommended design

### 5.1 Principle

**Analytic geometry remains the source of truth. A 2D arrangement is the
material/region engine for planar geometry. A mesh Boolean is a display/export
fallback, never the reconstruction kernel.**

This preserves the strongest part of the current design: a cylinder is still a
cylinder, a hole is still a circle with a radius, and the analytic certificate
still means something. It also gives a natural implementation order: the 2D
arrangement is useful immediately, while the full 3D analytic Boolean is a
later generalization.

### 5.2 What to do analytically

Keep and extend the analytic operations:

1. **Sections and intersections** for every surface pair that occurs in the
   supported feature set. The existing plane/quadric, sphere/sphere, coaxial
   cylinder/cylinder and axis-through-centre sphere/cylinder cases are the
   foundation. Add skew cylinder/cylinder, cone/cone, cone/cylinder,
   cone/sphere and offset sphere/cylinder only when a drawing actually needs
   them; return `boolean-unsupported-intersection` otherwise.
2. **Clip intersection curves to bounded patches.** Generalize the existing
   `splitLoopForCrossing` / `assembleCrossingLoops` machinery from a plane
   section to an arbitrary analytic cut curve. The result must be ordered
   sub-curves with source IDs and the same shared objects in both patches.
3. **Split surfaces by curves, not only planes.** A `splitByCurves(surface,
   cuts)` operation should accept a set of analytic curves, split each loop at
   the curve stations, and assemble cycles. The existing crossing-split code is
   most of the algorithm; the missing part is a general curve/loop intersection
   and a general point-in-patch test.
4. **Classify regions.** For a closed analytic solid, implement a point-in-solid
   query by ray casting against the analytic complex (or a tessellated
   conservative proxy), with a winding-number fallback. For an open feature
   patch, there is no inside/outside: refuse to classify and report
   `boolean-open-operand` instead of guessing.
5. **Share boundaries, orient, and certify.** The result must reference the
   same boundary objects in both adjacent patches, propagate orientation
   through shared edges, and run `Surfaces.validate` / `Surfaces.certify` on
   the result. Unsupported or ambiguous cases must produce a diagnostic, not a
   sampled approximation.
6. **Analytic offsets.** For a circle/arc, offsetting is a radius change; for a
   plane, it is a parallel shift. Do not polygonize an analytic curve just to
   offset it. General polygon offset belongs to the 2D arrangement/offset
   layer, not to the analytic surface model.

### 5.3 What to do with a 2D arrangement

Build one reusable `Arrangement2` module in `public/lib/` and use it for all
planar material operations:

- **Project** a planar face and its boundary curves into the face frame
  `(origin, u, v)`.
- **Insert** every boundary curve: line segments, circle/ellipse arcs, and
  polyline pieces. Split at proper crossings, collinear overlaps, vertex-on-edge
  incidences and tangencies.
- **Build a DCEL**: vertices with angularly sorted half-edges; half-edges with
  twin, next, previous, incident face; faces with outer and inner CCBs.
- **Label** each half-edge with its source operand and orientation. For two
  operands, each edge carries a winding delta pair `(dA, dB)`; for one operand,
  a single delta.
- **Propagate winding** from the unbounded face (winding 0) across edges. A
  crossing from the left to the right of an oriented edge adds the edge's
  delta. This is O(faces + edges), not a per-face ray cast.
- **Select faces** by the operation on `(wA, wB)`, after normalizing each
  operand's outer loops to counter-clockwise and its holes to clockwise:
  - union: `wA > 0 || wB > 0`;
  - intersection: `wA > 0 && wB > 0`;
  - difference: `wA > 0 && !(wB > 0)`;
  - xor: parity of `wA > 0` and `wB > 0`, or even-odd winding if that is the
    declared fill rule.
  Define the material convention explicitly; do not mix nonzero and even-odd
  silently.
- **Extract regions** as the boundary between selected and unselected faces.
  Trace outer cycles and inner cycles; return `{outer, holes, sourceIds,
  area}`. Remove zero-area faces, merge collinear edges, and refuse unresolved
  tangencies with a specific diagnostic.
- **Preserve curve identity**: an arrangement edge that comes from a circle or
  ellipse keeps its analytic curve record (center, frame, radii, start angle,
  sweep). Only split it into sub-arcs when a vertex requires it; never replace
  it with a polyline for the analytic result.

For Major's drawing sizes (tens to low hundreds of primitives per face), a
pairwise split followed by a DCEL is sufficient. A full Bentley–Ottmann sweep
is optional; the complexity is not the bottleneck at this scale. The important
properties are determinism, robust predicates, and explicit refusal.

Use the same arrangement in two places:

1. **Face space:** planar face Boolean, hole insertion, coplanar face union,
   wall/floor trimming for fillets.
2. **View space (later):** closed regions with holes from each orthographic
   view, which can improve view correspondence and silhouette extraction. This
   is a larger pipeline change and should not block the face-space use.

### 5.4 What to close analytically vs what to leave open

**Recess mouth.** This is the highest-value Boolean. The plate face should
receive the mouth loop as an **inner loop**, and the same loop object should be
referenced by the cavity. The display face should carry the corresponding
display hole so it no longer covers the cavity. This is a difference of a
planar face by a closed loop. In the common case the mouth loop is wholly
inside the face, so a fast path is possible: validate containment, add the
inner loop, update incidence. The general case (the mouth cuts the outer
boundary) needs the 2D arrangement.

**Fillet ends.** Do not fake closure with flat end caps. The fillet is a
feature patch whose ends belong to the host wall/floor. The correct operation
is:

1. reconstruct the host wall/floor as bounded planar faces;
2. trim each host face along the fillet's tangent generator line and end arc;
3. share the exact tangent line / end arc objects with the fillet;
4. remove the temporary feature strips, or keep them only as display helpers.

This is a **feature closure** operation. It can use the 2D arrangement on each
host plane, plus the existing analytic line/arc objects. If the host is absent
or ambiguous, keep the fillet open and report `feature-host-missing` or
`certificate-open-component`. That is more honest than a false closed solid.

**Recess bottom and cavity shell.** The cavity shell is already closed
analytically when the mouth/bottom loops are shared or when the closure plane
is present. The missing piece is the host face hole, not another cap. Do not
add a second mouth closure just to hide the overlap.

### 5.5 When a mesh Boolean is justified

A mesh Boolean stage is justified only when **all** of the following hold:

- a watertight, manifold tessellated solid already exists (or can be built
  without inventing topology);
- the operation is for display/export or for an analytic surface pair that is
  explicitly unsupported;
- the result is marked `approximate`/`mesh-only` and is not fed back into the
  analytic model or certificate;
- provenance is preserved (`originalID`/`faceID` or equivalent) so the UI can
  still identify the source feature.

It is not justified as a way to close an open feature patch, to repair a
non-manifold input, or to replace the analytic model. Manifold is the best
candidate if this stage is ever added: Apache-2.0, guaranteed manifold output,
C++/WASM, `manifold-3d` npm package. The cost is a WASM build and a second
geometry representation, which conflicts with the current zero-dependency
policy.

### 5.6 Why not adopt CGAL, Boost.Geometry or Clipper2 directly

- **CGAL**: the relevant packages are GPL, C++-only, and Nef_3 is planar-facet
  only. It is an excellent correctness reference and a source of algorithmic
  ideas (SNC, sphere maps, regularized Boolean, arrangement DCEL), not a
  runtime component for an MIT, zero-dependency browser app.
- **Boost.Geometry**: BSL-1.0 and header-only, but C++-only, linear rings only,
  and no formal exactness/manifold guarantee. Its release history shows that
  robust polygon overlay is a long tail of edge cases.
- **Clipper2**: BSL-1.0 and very robust for integer polygons, but C++-first,
  integer-quantized, and polygon-only. It is the right reference for a
  snap-rounded 2D Boolean and for offsetting; it is not the right source of
  truth for analytic arcs.

Borrow the **design**, not the code. In particular, the Manifold `boolean2`
description (maintained-status sweep, block rule for near-concurrences,
winding sweep) and CGAL's regularized-arrangement semantics are directly
applicable.

---

## 6. Data structures, API sketch, and `.edu` test plan

### 6.1 `Arrangement2` data structure

```js
// All coordinates are in the face frame (u, v). The frame maps back to 3D.
Arrangement2 = {
  frame: { origin, u, v, normal },
  vertices: [
    { id, u, v, sourceIds: [] }
  ],
  edges: [
    {
      id,
      curve,            // analytic curve record, see 6.2
      sourceIds: [],
      leftFace: faceId,
      rightFace: faceId,
      windingDelta: { a: 1, b: 0 } // oriented delta for each operand
    }
  ],
  halfEdges: [
    { id, twin, origin, next, prev, face, edge }
  ],
  faces: [
    {
      id,
      outer: halfEdgeId[],   // CCW
      holes: halfEdgeId[][], // CW
      winding: { a: 0, b: 0 },
      selected: false,
      unbounded: false,
      sourceIds: []
    }
  ],
  diagnostics: []
}
```

The topology is a standard DCEL. The addition that matters is the per-edge
winding delta and the analytic `curve` record. A face's winding is derived by
propagation, not stored as an independent truth.

### 6.2 Curve records

Reuse the existing analytic vocabulary so arrangement edges can become surface
loop elements without translation:

```js
{ kind: 'line', start: {x,y,z}, end: {x,y,z}, sourceIds: [] }

{ kind: 'circle' | 'ellipse' | 'arc',
  center: {x,y,z}, u: {x,y,z}, v: {x,y,z},
  radius, radiusU, radiusV,
  startAngle, sweepAngle, closed: true|false,
  sourceIds: [] }
```

A line in the face frame is lifted back to 3D using the face frame. An arc
keeps its parent circle/ellipse definition and a parameter interval; a split
arc is a child record with `parentKind`, `startAngle`, `sweepAngle` and
`splitFrom`, matching the existing `Surfaces` sub-arc convention.

### 6.3 API sketch

These are design names, not implemented signatures.

```js
// Pure 2D arrangement in one plane. `loops` may mix lines, arcs, circles,
// ellipses and vertex polylines. Returns regions with holes, or diagnostics.
Arrangement2.build({ plane, loops, curves, vertices, tolerance })
Arrangement2.boolean(a, b, op)        // op: union | intersection | difference | xor
Arrangement2.regions()                 // [{ outer, holes, area, sourceIds }]
Arrangement2.diagnostic()              // null or { code, message, ... }

// Surface-level planar operations.
Surfaces.planarBoolean(surfaceA, surfaceB, op, geometry)
Surfaces.planarDifference(surface, loop, geometry)
Surfaces.addInnerLoop(surface, loop, geometry) // fast path, wholly contained
Surfaces.splitPlanarFace(surface, cuts, geometry)

// General analytic operations (later).
Surfaces.splitByCurves(surface, cuts, geometry)
Surfaces.boolean(a, b, op, geometry)   // shells or diagnostics
Surfaces.closeFeature(feature, host, geometry)
```

Return shape for a planar Boolean:

```js
{
  kind: 'planar-boolean',
  op: 'difference',
  surfaces: [/* plane surfaces with outer + inner loops */],
  regions: [/* { outer, holes, area, sourceIds } */],
  diagnostics: [],
  validation, certificate
}
```

A refusal returns `null` plus a diagnostic array, matching the existing
`Surfaces.split` convention. Do not return a partially clipped or sampled
surface on failure.

### 6.4 Diagnostics

Use specific codes, consistent with the existing style:

- `arrangement-input-not-coplanar`
- `arrangement-curve-invalid`
- `arrangement-curve-unsupported`
- `arrangement-tangent-ambiguous`
- `arrangement-overlap-unresolved`
- `arrangement-unbounded-result`
- `arrangement-zero-area-face`
- `arrangement-loop-not-closed`
- `arrangement-self-intersection`
- `boolean-open-operand`
- `boolean-unsupported-intersection`
- `boolean-region-unclassified`
- `boolean-shell-assembly-failed`
- `feature-host-missing`

The project's existing rule applies: a case the code cannot decide soundly is
reported and left unresolved, not approximated.

### 6.5 `.edu` test plan

No separate unit-test suite. Add drawing scripts under `tools/scripts/` and
verify with `node tools/edc.js`. Extend the existing `# surface-query:` runner
with a `regionBoolean` operation when the implementation lands; until then the
scripts can assert the reconstructed surface/certificate properties.

| Script (proposed) | Scenario | Expected public properties |
|---|---|---|
| `boolean-2d-face-minus-circle.edu` | One planar rectangle with a wholly contained circle; difference. | 1 plane surface; 2 loops (outer + inner); `surfaceOpen=0`; `surfaceBoundary=0`; `surfaceCertificate=ok`; shared mouth boundary useCount 2. |
| `boolean-2d-face-minus-notch.edu` | Circle cuts the outer boundary, producing an open notch. | 1 plane surface; 1 outer loop; boundary arc + line elements preserved; no hole; `surfaceCertificate=partial` only if the host is open. |
| `boolean-2d-union-overlap.edu` | Two overlapping coplanar rectangles; union. | 1 plane surface; 1 outer loop; internal edges removed; area equals union area. |
| `boolean-2d-intersection.edu` | Two overlapping rectangles; intersection. | 1 plane surface; expected rectangle; no leftover edges. |
| `boolean-2d-difference-split.edu` | Rectangle minus an overlapping rectangle that splits it. | 1 or 2 regions as appropriate; no zero-area slivers. |
| `boolean-2d-nested-island.edu` | Square with a hole, plus a disjoint island inside the hole. | Even-odd/material convention explicit; separate regions or one region with an island, matching the declared rule. |
| `boolean-2d-tangent.edu` | Circle internally tangent to a rectangle edge. | No zero-area face; tangency handled analytically; deterministic result. |
| `boolean-2d-arc-preserve.edu` | Semicircle + diameter face unioned with a rectangle. | Arc sub-arcs remain `kind:'arc'`; `surfaceCurveBoundaries` counts preserved; no polyline substitution. |
| `boolean-2d-cylindrical-recess.edu` | Existing cylindrical recess + plate; subtract mouth. | `surfaceOpen=0`; `surfaceBoundary=0`; `surfaceCertificate=ok`; `surfaceValidation` becomes `ok` or `partial` only because holes are skipped by the triangle certificate, not `issues`. |
| `boolean-2d-spherical-recess.edu` | Spherical recess + plate; subtract mouth. | Same closure expectations; cap metadata remains. |
| `boolean-2d-fillet-host.edu` | Fillet + host wall/floor; trim host faces to tangent lines/end arcs. | Fillet ends shared; `surfaceOpen=0`; no fake cap; certificate `ok` only when the host is complete. |
| `boolean-2d-fillet-no-host.edu` | Fillet without host. | Refused/unresolved with `feature-host-missing`; certificate remains `partial`; no invented closure. |
| `boolean-2d-invalid-self-intersect.edu` | Self-intersecting input loop. | Refused with `arrangement-self-intersection`; no guess. |
| `boolean-2d-invalid-noncoplanar.edu` | Loop not in the face plane. | Refused with `arrangement-input-not-coplanar`. |
| `boolean-2d-invalid-conic.edu` | Parabola/hyperbola section. | Refused with `arrangement-curve-unsupported`. |

Example query shape for the future runner:

```text
# surface-query: {"operation":"regionBoolean","surfaces":[0,1],"op":"difference","expect":{"regions":1,"holes":1,"certificate":{"status":"ok"}}}
```

For the first milestone, the acceptance script should be a modified
`cylindrical-recess.edu` that expects the plate and cavity to form one closed
component with a shared mouth, and asserts that `surfaceValidation` is no longer
`issues`. Run it with:

```sh
node tools/edc.js tools/scripts/boolean-2d-cylindrical-recess.edu
node tools/edc.js --solid tools/scripts/boolean-2d-cylindrical-recess.edu
```

### 6.6 Invariants to check

- Every arrangement half-edge has a twin; `next`/`prev` cycles close.
- Every face has one outer CCB and zero or more inner CCBs.
- Every selected region has positive area; no zero-area sliver survives.
- A shared boundary is the **same object** in both surface loops (incidence 2).
- No boundary has more than two uses; non-manifold results are refused or
  represented explicitly.
- Orientation is consistent across shared edges; shell volume is used to flip
  closed components, as the current planar pass already does.
- Every output loop element is either a line, an analytic curve, or an inline
  sub-arc; no silent polyline approximation of an analytic boundary.
- A refused operation leaves the input model untouched.

---

## 7. Licensing and dependency notes

This is not legal advice; verify with counsel before distributing.

| Project / package | Version cited | License | Implications for Major |
|---|---|---|---|
| Major | repository | MIT | Permissive; can vendor compatible code if notices are kept. |
| Manifold | 3.5.4 | Apache-2.0 | Permissive with patent grant and notice obligations. A WASM binary adds a build artifact and a second geometry stack. |
| CGAL Nef_3 | 6.2.1 | GPL (package page) | Linking/distributing a GPL package in an MIT app generally requires GPL for the combined work or a commercial CGAL license. Not suitable as a runtime dependency without relicensing. |
| CGAL `Arrangement_on_surface_2` | 6.2.1 | GPL (package page) | Same GPL issue. |
| CGAL `Boolean_set_operations_2` | 6.2.1 | GPL (package page) | Same GPL issue. |
| CGAL kernel/support | 6.2.1 | LGPL (most) | LGPL is more permissive for linking but still has obligations; the packages above are the relevant ones and are GPL. |
| Clipper2 | 2.0.1 | BSL-1.0 | Permissive; retain the Boost license notice. C++/C#/Delphi first; unofficial JS ports. |
| Boost.Geometry | 1.93.0 | BSL-1.0 | Permissive; header-only C++. |
| earcut | 3.2.4 | ISC | Permissive; single-file JS, easy to vendor. No correctness guarantee. |
| libtess2 | README 1.0.3 / tag v1.0.2 | SGI-B-2.0 | Permissive, MIT-like; retain the SGI notice. C. |
| poly2tri | commit 4732e46 | BSD-3-Clause | Permissive; retain copyright/notice. C++; simple polygons only. |
| SDF / Manifold LevelSet | 3.5.4 | Apache-2.0 | Same as Manifold. |

**Zero-dependency policy.** The current project has no npm dependencies and is
served as static JS. An in-house `Arrangement2` keeps that property. Vendoring
earcut is the lightest external option if a triangulator is needed; it is ISC,
single-file, and already ES-module friendly. Manifold/WASM or CGAL/Boost would
break the zero-dependency and pure-JS properties, so they should be optional
developer/export tools, not the default runtime.

**No code copying.** The algorithms in this report are described from public
documentation. Any implementation should be written from the geometric
requirements and the existing Major style, with attribution to the ideas where
appropriate. Do not paste GPL code into the MIT repository.

---

## 8. Unverified claims and open questions

The following are project claims, interpretations, or version/documentation
mismatches rather than independently verified facts:

- Manifold's claim that its Boolean is "the first guaranteed-manifold mesh
  Boolean" is the project's claim. The guarantee itself (manifold output for
  manifold input) is documented and consistent with the wiki, but the priority
  claim is not independently established here.
- Manifold's statement that its level-set extraction "improves significantly
  over marching cubes" is a project claim; the exact extraction algorithm was
  not benchmarked.
- CGAL Nef_3 is described here as planar-facet-only because its construction is
  from halfspaces and planar facets. It is possible to approximate a curved
  solid by a fine Nef polyhedron, but there is no analytic cylinder/sphere
  facet in the Nef representation. This is an inference from the manual, not a
  statement that CGAL cannot approximate curves.
- The CGAL package licenses were read from the current 6.2.1 reference pages
  (Nef_3, Arrangement, Boolean_set_operations_2: GPL). The kernel/support
  packages are LGPL. License terms can change; verify the exact release before
  distributing.
- Clipper2's documentation pages are built for 2.0.0 while the current release
  tag is 2.0.1; the version header in the 2.0.1 source says `2.0.1`. The docs
  lag the release.
- The original `AngusJohnson/Clipper2` repository is archived (2026-10-28) and
  development moved to `PolyClipping/Clipper2`. The claim that the new
  repository will remain C++-only is from the retirement notice, not a
  guarantee.
- Clipper2's official language list is C++, C# and Delphi. The TypeScript
  port is listed as a third-party port; it was not evaluated for API parity or
  robustness.
- Boost.Geometry 1.93.0 is the current Boost release; the online release notes
  read during this research covered through 1.92. The exact 1.93 behavior of
  every set operation was not independently tested.
- Boost.Geometry's polygon model is linear rings; circular arcs are not a
  first-class geometry. This is an inference from the documented models and
  `buffer` behavior, not a claim that no extension exists.
- earcut's benchmark numbers and its "no correctness guarantee" wording are
  taken from its README. The benchmark was not reproduced. Its worst-case
  complexity is commonly described as quadratic ear clipping; the current
  README does not state a complexity bound, so this report avoids asserting
  one.
- libtess2's README says version 1.0.3, while the latest GitHub release tag is
  v1.0.2 (2019). The repository has 2025 activity; the version discrepancy is
  unresolved.
- poly2tri has no tagged release; the report pins the master commit
  `4732e46da88086c6b7b3935a5b4f6f87360062c3`. The exact API/behavior may change.
- The claim that a 2D arrangement can be lifted to a surface parameter domain
  for curved patches is a design direction, not a proven implementation. Seams,
  non-x-monotone curves and singularities need separate treatment.
- The performance estimates for Major's own arrangement are qualitative. The
  current drawings are small (tens to low hundreds of primitives per face), but
  no benchmark was run for a future arrangement.
- The recommendation to use robust predicates/snap rounding is a design choice;
  the exact predicate library and tolerance policy are not selected here.

Open questions for the implementation round:

1. What is the material convention for overlapping coplanar faces: nonzero
   winding, even-odd, or an explicit material-side declaration? The current
   planar pass uses even/odd nesting as a preview convention, not a material
   proof.
2. What tolerance model should the arrangement use: absolute in millimetres,
   relative to the face extent, or a scaled integer grid? The current code
   mixes absolute 1e-6/1e-8 tolerances with relative analytic tolerances.
3. Should a tangent contact create a shared vertex, a shared edge, or a
   refused ambiguous case? The current code often refuses; a Boolean needs a
   deterministic policy.
4. How should a Boolean result be represented when the operation produces two
   disjoint solids? The surface model has components/shells but no solid-level
   container yet.
5. How should provenance be carried through a split/union so a hole remains a
   hole and a fillet remains a fillet in the UI?
6. Should the first arrangement implementation support only lines and circular
   arcs, or also ellipses/conics? The current model already has ellipse
   sections, so limiting the first arrangement to circles/arcs may be too
   restrictive for inclined cuts.

---

## 9. Ranked recommendation and smallest next milestone

### 8.1 Ranked recommendation

1. **Build an in-house 2D arrangement and planar region Boolean first.**
   Highest value per unit of risk. It solves the visible recess/plate
   contradiction, gives exact holes and coplanar unions, reuses the existing
   line/circle/ellipse vocabulary, and stays dependency-free. It is also the
   reusable core for later surface arrangements.

2. **Add analytic feature closure on top of the arrangement.**
   Fast path for a wholly contained inner loop; then planar face splitting by
   arbitrary curves; then host-face trimming for recesses and fillets. Close
   features by sharing exact boundaries with a reconstructed host, not by
   inventing caps.

3. **Extend to a limited analytic B-rep Boolean for supported surface pairs.**
   Generalize `split` from a plane to an arbitrary analytic cut curve, add
   point-in-solid classification and shell assembly, and refuse unsupported
   pairs with specific diagnostics. This is the long-term correct kernel, but
   it should follow the 2D arrangement because it needs the same loop/clipping
   machinery.

4. **Use Manifold as an optional mesh-Boolean fallback for preview/export.**
   Only after a watertight tessellated solid exists, only for unsupported
   analytic pairs or export, and always marked approximate. Apache-2.0 and
   guaranteed manifold output make it the best choice if this stage is added.

5. **Treat SDF/implicit as a last-resort visual fallback.**
   Useful for blends and organic shapes, not for dimensioned reconstruction or
   analytic certificates.

6. **Use CGAL/Boost.Geometry/Clipper2 as design references, not runtime
   dependencies.** CGAL's GPL and C++ weight, Boost's linear-only geometry and
   robustness history, and Clipper2's integer polygons all argue against direct
   adoption. Clipper2 remains the reference for 2D offsetting; earcut/libtess2
   remain triangulation options after the arrangement is valid.

### 8.2 Smallest next milestone

**Milestone M1: planar face minus a wholly contained analytic loop, with the
mouth boundary shared and the display hole carried through.**

Deliverables:

1. A minimal `Arrangement2` in `public/lib/` that can build a DCEL for one
   planar face from line and circle/ellipse/arc loops, split at crossings, and
   compute winding/face selection for a **difference by one contained closed
   loop**. The full union/intersection/coplanar-overlap case can be the next
   increment.
2. `Surfaces.planarDifference(face, loop, geometry)` (or
   `Surfaces.addInnerLoop` as the contained fast path) that:
   - validates coplanarity, closure and containment;
   - adds the loop as an `inner` loop on the plane surface;
   - reparents the same loop object to the cavity/closure so incidence is 2;
   - adds the corresponding display hole to the face so the renderer stops
     covering the cavity;
   - returns the new surface plus validation and certificate.
3. A `.edu` script based on `cylindrical-recess.edu` that expects:
   - one closed component for plate + cavity;
   - `surfaceOpen=0`, `surfaceBoundary=0`;
   - `surfaceCertificate=ok`;
   - `surfaceValidation` no longer `issues` (either `ok` if the display hole is
     triangulated, or `partial` with `holesSkipped=1` until a triangulator is
     added, but never the current overlap issue).
4. A negative test for a loop that crosses the face boundary: it must be
   refused with a specific diagnostic, not clipped by guessing.

**Explicit non-goals for M1:** no 3D mesh Boolean, no general 3D solid
Boolean, no fillet host closure, no polygon offset, no SDF, no new external
dependency. Those follow only after the planar arrangement and the shared-loop
invariants are proven.

**Why this is the smallest useful milestone.** It removes the most visible
contradiction in the current model (a closed analytic cavity whose host face
still covers it), exercises the exact pieces Major already has (analytic
circles, loops, incidence, certificates), and creates the arrangement core that
every later Boolean needs. It does not require a full 3D intersection kernel,
a triangulator, or a WASM dependency.

---

## Sources

All URLs were accessed on 2026-11-11 unless noted.

**Major (this repository)**

- `docs/SURFACE_MODEL.md`, `docs/SURFACE_COMPLEX.md`,
  `docs/PLANAR_RECONSTRUCTION.md`, `docs/RECONSTRUCTION_CONTRACT.md`
- `public/lib/educad-reconstruct.js`, `public/lib/educad-surfaces.js`,
  `public/lib/educad-curve-reconstruct.js`, `public/lib/educad-solid.js`
- `tools/scripts/cylindrical-recess.edu`, `spherical-recess.edu`,
  `fillet-line-boundary.edu`, `surface-split-cylinder.edu`,
  `surface-split-crossing.edu`, `surface-split-sphere.edu`,
  `surface-split-recess-cap.edu`, `plane-sections.edu`

**Manifold**

- <https://github.com/elalish/manifold> (release `v3.5.4`, 2026-09-25)
- <https://github.com/elalish/manifold/wiki/Manifold-Library>
- <https://github.com/elalish/manifold/blob/master/src/boolean3.cpp>
- <https://github.com/elalish/manifold/blob/master/src/boolean2.cpp>
- <https://github.com/elalish/manifold/blob/master/src/boolean2_sweep.cpp>
- <https://github.com/elalish/manifold/blob/master/src/polygon.cpp>
- <https://github.com/elalish/manifold/blob/master/src/sdf.cpp>
- <https://github.com/elalish/manifold/blob/master/include/manifold/manifold.h>
- <https://manifoldcad.org/docs/html/classmanifold_1_1_manifold.html>

**CGAL**

- <https://github.com/CGAL/cgal> (release `v6.2.1`, 2026-09-04)
- <https://doc.cgal.org/latest/Nef_3/index.html>
- <https://doc.cgal.org/latest/Arrangement_on_surface_2/index.html>
- <https://doc.cgal.org/latest/Arrangement_on_surface_2/group__PkgArrangementOnSurface2Ref.html>
- <https://doc.cgal.org/latest/Boolean_set_operations_2/index.html>
- <https://doc.cgal.org/latest/Boolean_set_operations_2/group__PkgBooleanSetOperations2Ref.html>
- <https://doc.cgal.org/latest/Manual/license.html>
- <https://www.cgal.org/license.html>

**Clipper2**

- <https://github.com/PolyClipping/Clipper2> (release `Clipper2_2.0.1`,
  2026-10-26)
- <https://github.com/AngusJohnson/Clipper2> (archived 2026-10-28)
- <https://www.angusj.com/clipper2/Docs/Overview.htm>
- <https://www.angusj.com/clipper2/Docs/Robustness.htm>
- <https://www.angusj.com/clipper2/Docs/Units/Clipper/Functions/Triangulate.htm>
- <https://www.angusj.com/clipper2/Docs/Units/Clipper.Offset/Classes/ClipperOffset/_Body.htm>
- `CPP/Clipper2Lib/include/clipper2/clipper.version.h` (says `2.0.1`)

**Boost.Geometry**

- <https://www.boost.org/doc/libs/latest/libs/geometry/doc/html/index.html>
- <https://www.boost.org/doc/libs/latest/libs/geometry/doc/html/geometry/release_notes.html>
- <https://www.boost.org/doc/libs/latest/libs/geometry/doc/html/geometry/reference/algorithms/union_/union__3.html>
- <https://github.com/boostorg/geometry>

**earcut**

- <https://github.com/mapbox/earcut> (release `v3.2.4`, 2026-09-28)
- `src/earcut.js`, `README.md`, `package.json`

**libtess2**

- <https://github.com/memononen/libtess2> (README version 1.0.3; release
  `v1.0.2`, 2019-09-26)
- `Source/sweep.c`, `Source/mesh.c`, `Source/geom.c`, `Source/tess.c`
- `Include/tesselator.h`

**poly2tri**

- <https://github.com/jhasse/poly2tri> (master commit
  `4732e46da88086c6b7b3935a5b4f6f87360062c3`, 2026-10-20)
- `poly2tri/poly2tri.h`, `poly2tri/sweep`, `poly2tri/common`

**Licenses**

- Apache-2.0: <https://www.apache.org/licenses/LICENSE-2.0>
- Boost Software License 1.0: <https://www.boost.org/LICENSE_1_0.txt>
- ISC: <https://www.isc.org/licenses/>
- SGI-B-2.0: <https://directory.fsf.org/wiki/License:SGIFreeBv2>
- BSD-3-Clause: <https://opensource.org/license/bsd-3-clause>

---

*Documentation-only change. Major is the default scope; if Major2 reuses
`educad-surfaces.js` or the planar face pass, it will need the same
arrangement/Boolean work when those modules are next synchronized.*

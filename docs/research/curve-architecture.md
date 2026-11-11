# Curve and surface representation: a kernel architecture for EduCAD

Status: research and design report. No production code is changed by this
work. The repository snapshot is commit
`43d3b7f2951eb84c1974ec24f8e324195b1a2730` (2026-11-11), Major only.

This report asks three questions:

1. What are the entities and invariants of the current inferred curve/surface
   model?
2. How do mature open-source CAD systems separate geometry, topology,
   identity, tolerance, and parameterization?
3. What is the smallest kernel architecture that keeps the current model
   working, fixes its weakest invariants, and leaves room for torus, offset,
   and NURBS surfaces?

The short answer is: do not replace EduCAD with OCCT, SISL, Manifold, or a
FreeCAD-style document system. Keep the zero-dependency JavaScript kernel, but
adopt the part of those architectures that the current model lacks: **stable
boundary identity, a support/trim distinction, explicit tolerance, and a
surface-family capability registry**. Introduce them as a v2 shadow model under
the existing `analytic-surface-v1` output, not as a breaking rewrite.

---

## 1. Current EduCAD entities and invariants

### 1.1 Where the model sits in the pipeline

`EduCADReconstruct.reconstruct(entities, options)` is the public entry point.
It collects drawing primitives, resolves cross-view correspondence, lifts
curves and vertices, infers display patches, and finally calls
`EduCADSurfaces.build` at the end of the pipeline
(`public/lib/educad-reconstruct.js:2854-2862`, `3061-3069`). `build` returns the
bounded analytic model; `validate` and `certify` inspect it without using the
display triangles.

The important separation already exists:

- `geometry.curves` — analytic 1D definitions plus display/provenance fields.
- `geometry.surfacePatches` — display-facing patches, not the analytic model.
- `geometry.surfaces` — bounded analytic surfaces with loops.
- `geometry.surfaceModel` — summary counts.
- `geometry.analyticSurfaceValidation` — lightweight validation.
- `geometry.analyticCertificate` — detailed certificate.
- `geometry.surfaceValidation` — a separate `inferred-triangle-v1` mesh check.

The display mesh is never evidence for the analytic model. That is the right
foundation and should survive any refactor.

### 1.2 Drawing entities

The input layer is not the kernel. It contains `POINT`, `SEGMENT`, `CIRCLE`,
`CIRCULAR_ARC`, `CURVE` (a station-interpolated NURBS entity), `LINE`, `RAY`,
and `DATUM_AXIS`. The kernel sees only the lifted `geometry` object. This report
therefore treats drawing entities as evidence/provenance, not as topology.

### 1.3 Curve records

`geometry.curves` is an array, not a registry. A record mixes geometry,
display, and provenance:

| Field | Meaning | Invariant |
|---|---|---|
| `kind` | `circle`, `circular-arc`, `ellipse`, `arc`, or `nurbs` | Producers are inconsistent; see §1.8 |
| `center`, `u`, `v` | Plane point and orthonormal basis | finite; `|u|=|v|=1`; `u·v≈0` |
| `radius` / `radiusU`,`radiusV` | Positive radii | positive and finite |
| `startAngle`, `sweepAngle` | Parameter interval | `sweepAngle > 0`; full circles use `2π` |
| `displayVertices`, `displayEdges` | Tessellation indices | display only |
| `sourceIds`, `sourceView`, `sourceEvidence`, `pointEvidence` | Evidence | provenance, not identity |
| `oblique`, `inclinedTrace`, `visibilityEvidence` | Inference metadata | not geometry |
| `closed` | NURBS closure flag | only on NURBS records |

The evaluator is `EduCADParametric.point` / `EduCADSurfaces.point`:

```text
circle/ellipse: center + radiusU cos(t) u + radiusV sin(t) v
nurbs:          homogeneous de Boor over the stored knot vector
```

NURBS validation is in `public/lib/educad-parametric.js:15-21`; the de Boor
evaluator is `25-42`; interpolation is `53-93`; display tessellation is
`107-119`. NURBS curves carry degree 3, positive weights, nondecreasing knots,
and the usual `n + p + 1` knot count.

The curve kinds are produced as follows:

- `curve-reconstruct` emits `circle`, `circular-arc`, and `ellipse`
  (`public/lib/educad-curve-reconstruct.js:120-147`).
- `oblique-kernel` emits `circle` and `ellipse` initially
  (`public/lib/educad-oblique-kernel.js:403`), then changes a fitted open
  loop to `kind:'arc'` (`563`).
- `educad-parametric-reconstruct.js` emits `nurbs` through
  `Parametric.interpolate`.

There is no `line` curve kind in `geometry.curves`. A line boundary element is
a separate inline object (`kind:'line'`), not a member of the curve registry.
`conic` exists only as a section-result classification; it has no evaluator and
is not stored as a drawable curve.

### 1.4 Surface records

`EduCADSurfaces.build` creates `{version:1, contract:'analytic-surface-v1',
surfaces, diagnostics}` (`public/lib/educad-surfaces.js:93-360`). Each surface
gets a sequential id `surface:<n>` and `inferred:true`.

| Kind | Parameters | Boundary model |
|---|---|---|
| `plane` | `origin`, unit `normal`, optional `u`,`v` | vertex loops, curve loops, line loops, section loops |
| `cylinder` | `origin`, unit `axis`, positive `radius` | ordered loops, often two end loops |
| `cone` | `origin`, unit `axis`, `radius`, `apex`, `halfAngle` | ordered loops, possibly one loop plus apex |
| `sphere` | `center`, positive `radius` | zero loops for a complete sphere; one or more analytic loops for a cap |
| `ruled` (input only) | normalized to `cylinder` or `cone` | two analytic boundary curves |

An additional "surface" may be implied by a planar patch with explicit loops;
there is no standalone `line` surface, `torus`, `offset`, or `nurbs` surface
today. The builder accepts `plane`, `cylinder`, `cone`, `sphere`, and `ruled`
as patch kinds; every other kind produces `surface-kind-unsupported`
(`educad-surfaces.js:347-350`).

Surfaces also carry non-geometric metadata: `sourceIds`, `patchIndex`,
`displayFaceIndices`, `inferred`, `closed`, and feature metadata such as `cap`,
`recess`, `closure`, `recessMouth`, `parentSurfaceId`, `splitBy`, and
`attachedBoundary`. This is useful provenance, but it means a surface is
currently doing four jobs: support geometry, bounded face, feature record, and
serialization record.

### 1.5 Boundary elements and loops

A loop is one of:

```js
{kind:'outer'|'inner', vertices:[...]}
{kind:'outer'|'inner', curves:[...]}
{kind:'outer'|'inner', lines:[...]}
{kind:'outer', section:{...}}
{kind:'outer', elements:[{kind:'curve',curve}, {kind:'polyline',points}]}
```

The accepted vocabulary is documented in `docs/SURFACE_MODEL.md` and in the
code comment at `public/lib/educad-surfaces.js:362-367`. The important detail
is that a loop is **not a signed cycle of shared edges**. It is a set of
parallel arrays (`vertices`, `curves`, `lines`) plus an optional `section` or
`elements` list. Adjacency is by coincident endpoints on the surface, not by a
stored `edge -> edge` link. Loop order is canonical for record output, not an
orientation.

The boundary element identity scheme is irregular:

| Element | Identity used by `incidence` | Persistence |
|---|---|---|
| Drawing curve | string `c:<index>` | stable within a rebuild; depends on array order |
| Inline section | object identity, rendered `section:<n>` | **not stable across JSON** |
| Inline curve object | object identity, also rendered `section:<n>` | **not stable across JSON** |
| Inline line | object identity, or `line:id:<id>` if `id` is present | stable only with explicit `id` |
| Vertex loop edge | `e:<min>_<max>` | stable if vertex indices are stable |
| Inline polyline edge | `p:<x,y,z>_<x,y,z>` | geometric key, may collide |

`incidence` is at `public/lib/educad-surfaces.js:448-481`; `loopElements` is at
`417-443`; `boundaryElementKind` is at `742-751`. The identity rule is:

- sections are shared only when the **same object** is referenced by both
  loops;
- lines can be shared by object identity or by an explicit string `id`;
- drawing curves are shared by the same `c:<index>` string.

This is a real design choice, not an accident: it lets an inferred section be
shared without introducing a registry. But it is also the model's largest
serialization hazard (§1.8).

### 1.6 Incidence, shells, and the certificate

`Surfaces.incidence(model)` returns:

```js
{
  uses: Map<boundaryId, {id, element, kind, useCount, surfaceIds,
                          surfaceUses, loopRefs}>,
  bySurface: Map<surfaceId, boundaryId[]>,
  elementId(element)
}
```

`analyze` unions surfaces that share a boundary. A use count of 1 is an open
boundary; 2 is a manifold seam; more than 2 is non-manifold. A component is a
closed shell only when every loop element is used exactly twice, or the surface
has no loops and `closed:true` (`public/lib/educad-surfaces.js:483-510`).

`validate` is the lightweight check (`512-617`):

- finite parameters and positive radii;
- boundary curves sampled at 8 stations stay on the surface;
- line endpoints and midpoint stay on the surface;
- cylinder boundary sections reproduce the stored boundary;
- plane boundaries lie in the plane;
- spherical cap pole/angle/mouth relations;
- every boundary used at most twice;
- connected components closed when every boundary is shared exactly twice.

`certify` is the detailed, read-only certificate (`772-1295`). It uses BigInt
rational arithmetic for exact checks on the stored decimal values and numeric
sampling for the rest. This is stronger than a typical tolerance-only check:
exact coplanarity, exact positivity, and exact combinatorial incidence are
recorded separately from numeric residuals. The status vocabulary is
`ok`/`partial`/`issues`.

The certificate's exact checks are checks of the **stored decimal model**, not
of the author's intent. It does not prove that an inferred radius or apex is
the intended exact value, and it does not encode material side.

### 1.7 Inferred vs declared

The model is inferred. `surface.inferred = true` is set by `build`. There is a
separate exact declared-triangle kernel in `public/lib/educad-strict.js` and
`docs/RECONSTRUCTION_CONTRACT.md`; its certificate is not reused here. The
inferred analytic certificate deliberately does not promote inferred surfaces
to declared ones. That boundary should remain.

### 1.8 Invariants, stated explicitly

The current model relies on these invariants:

**I1 — Curve support.** A boundary curve has a finite center, two finite
orthonormal unit basis vectors, positive finite radii, and a positive sweep.
`validCurve` checks the basis and radii (`educad-surfaces.js:68-73`);
`boundaryCurveValid` additionally checks `sweepAngle > 0` (`758-763`).
The curve `kind` itself is not checked by `validCurve`.

**I2 — Surface support.** Plane/cylinder/cone origins and normals/axes are
finite; cylinder/cone radius is positive; axes are unit length; cone
`halfAngle` is finite and positive; sphere center/radius are finite/positive
(`validate`, `518-538`).

**I3 — Boundary-on-surface.** Every boundary element must lie on its surface
within a tolerance. Validation samples 8 points; the certificate samples 33
for analytic curves and start/mid/end for lines (`555-608`, `1030-1165`).

**I4 — Loop role only.** `outer`/`inner` is a role label. There is no signed
orientation, no stored material side, and no winding requirement. A plane may
carry both vertex loops and analytic inner loops.

**I5 — Boundary identity.** Incidence uses `c:<index>` for drawing curves,
object identity for sections, `line:id:<id>` or object identity for lines,
`e:`/`p:` keys for vertex and polyline edges. Two equal sections built
separately are **not** shared; two loops sharing one section object are.

**I6 — Manifold count.** A boundary used once is open; twice is a seam; more
than twice is non-manifold. A surface using the same boundary twice is
`selfShared`.

**I7 — Closed flag.** A surface with no loops is closed only when
`closed:true`; a bounded surface with loops is not closed even if every loop is
shared.

**I8 — Shells.** Shells are connected components of the boundary-sharing graph,
not explicit shell records. Closure is derived from incidence.

**I9 — Evidence separation.** Display tessellation (`surfacePatches`, `faces`,
`displayFaceIndices`) is not evidence for the analytic model. `certify` never
reads the mesh.

**I10 — Inferred status.** `inferred:true` and the `analytic-surface-v1`
contract distinguish this model from the declared strict kernel. The
certificate is a consistency certificate, not a proof of author intent.

**I11 — Unique surface ids.** Surface ids are `surface:<n>` and duplicate ids
fail the certificate (`surface-id-unique`, `educad-surfaces.js:879-887`).
Derived surfaces use string-derived ids such as
`surface:0/split:positive` and `surface:0/attach:2`.

**I12 — NURBS is not a surface boundary.** `validCurve` requires
`center/u/v/radius`; it rejects a NURBS record. NURBS curves are currently
display/evidence curves, not loop elements or surface boundaries.

**I13 — Loop input shape.** `build` accepts loops with `vertices`, `curves`,
`lines`, or `section`. It does **not** accept an elements-only loop as input:
`copyLoopInput` drops `elements`, and `loopInputValid` then rejects a loop that
has no other field (`educad-surfaces.js:112-142`). `elements` is only a product
of `split`.

**I14 — Certificate shape.** The v1 certificate shape is part of the public
contract (`docs/SURFACE_MODEL.md`). Any new model must keep producing it.

### 1.9 Verified representation weaknesses

These are not speculative; they follow from the code and, where noted, from a
local Node check.

**W1 — Section sharing does not survive JSON.** `Ref3d.buildPreview` builds the
preview and then calls `JSON.parse(JSON.stringify(preview))`
(`public/lib/educad-ref3d.js:94-104`). JSON serializes the same section object
twice as two independent objects. A local check with two surfaces sharing one
section gave `section:0 useCount 2` before the round-trip and
`section:0 useCount 1` plus `section:1 useCount 1` after it. The line element
does not have this problem when it carries an explicit `id`, because
`incidence` uses `line:id:<id>`. **In the `Ref3d` preview path, shared analytic
sections are therefore not persisted as shared boundaries today.** This is the
single most important correctness issue in the current model.

**W2 — Two arc spellings, one validator gap.** `curve-reconstruct` emits
`circular-arc`; `oblique-kernel` emits `arc`. `Ref3d.validPreview` accepts only
`circle`, `circular-arc`, `ellipse`, or `nurbs`
(`public/lib/educad-ref3d.js:172-187`). A synthetic preview containing
`kind:'arc'` was rejected by `validPreview` in a local check. The app might not
currently persist such a preview in every path, but the representation and the
validator disagree.

**W3 — Loop elements are not a signed cycle.** A mixed fillet loop stores
`curves:[lowArc, highArc]` and `lines:[lineStart, lineEnd]` in separate arrays.
The display mesh carries the rendered order. Incidence can count the seam, but
there is no stored orientation or edge-use order. This blocks orientation
consistency checks and robust face traversal.

**W4 — Elements-only loops are not accepted by `build`.** A split result can
produce an `elements` loop, but feeding that loop back into `build` (for example
after a serialization round-trip or a rebuild) is rejected. The model can
produce a loop shape it cannot consume.

**W5 — No edge/face identity beyond strings.** There is no edge registry, no
face registry, and no stable `faceId`/`edgeId` that survives a change in
surface ordering. `surface:<n>` is an array ordinal; adding an inferred
surface earlier in the list shifts every later id. Derived ids concatenate the
parent id string, so they inherit that instability.

**W6 — The curve registry is not a registry.** Drawing-curve indices are
implicit array positions; inline sections are anonymous objects; the same
geometric section built twice is not shared. This is both an identity and a
deduplication problem.

**W7 — `boundaryCurves` is advisory.** A surface's `boundaryCurves` list may
name curves that are not in any loop. It is not counted by incidence. This is
intentional (`docs/SURFACE_MODEL.md`), but it means there are two different
notions of "surface boundary" in the record. A v2 model should make the loop
authoritative and keep `boundaryCurves` as a legacy projection only.

**W8 — No UV parameterization or pcurves.** A face is `surface + loops`; the
surface has no explicit `(u,v)` domain, and an edge has no curve-on-surface.
This is adequate for plane/cylinder/cone/sphere loops that are already 3D
analytic curves, but it is not adequate for a NURBS surface trim, a torus
fillet end, or a general offset.

---

## 2. OSS data models

The versions below are the ones used for this report. All source links are
pinned to a release tag where a tag exists. No OSS project was built or run for
this report; claims are from the cited headers, documentation, and READMEs.

| Project | Version used | Primary role |
|---|---|---|
| Open CASCADE Technology | 8.0.1 (`V8_0_1`) | analytic B-rep kernel |
| SISL | 4.6.0 (`SISL-4.6.0`) | NURBS curves/surfaces and interrogation |
| TinySpline | 0.6.0 (`v0.6.0`) | small NURBS/B-spline curve library |
| Manifold | 3.5.4 (`v3.5.4`) | guaranteed-manifold triangle mesh kernel |
| FreeCAD | 1.1.4 (`1.1.4`) | document/feature model over OCCT |

### 2.1 Open CASCADE Technology 8.0.1

**Geometry.** `Geom_Geometry` is the root of all 3D geometric objects and
provides transformations and `Copy` (`Geom_Geometry.hxx`). `Geom_Curve` is
parameterized: it exposes `FirstParameter`, `LastParameter`, `IsClosed`,
`IsPeriodic`, `Reverse`, `EvalD0`–`EvalD3`, and `DN` (`Geom_Curve.hxx`).
`Geom_Surface` exposes `Bounds`, `IsUClosed`/`IsVClosed`,
`IsUPeriodic`/`IsVPeriodic`, `UIso`/`VIso`, `UReverse`/`VReverse`, continuity,
and `EvalD0`–`EvalD3` (`Geom_Surface.hxx`). Concrete families include plane,
cylinder, cone, sphere, torus, offset, trimmed, Bezier/BSpline, swept, and
revolution surfaces. Geometry knows its parameterization and orientation; it
does not know its topological role.

**Topology.** `TopoDS_Shape` is a value-like handle with three parts: a
`TopoDS_TShape` handle, a `TopLoc_Location`, and a `TopAbs_Orientation`
(`TopoDS_Shape.hxx`). `IsPartner` means same `TShape` (locations/orientations
may differ); `IsSame` adds the same location; `IsEqual` adds the same
orientation. This is the crucial identity design: **subshape identity is
shared implementation, not equal coordinates**. A shape can be placed multiple
times without copying its geometry. The topology vocabulary is
`VERTEX`, `EDGE`, `WIRE`, `FACE`, `SHELL`, `SOLID`, `COMPSOLID`, `COMPOUND`
(OCCT Modeling Data guide, §Topology).

**Geometry access.** `BRep_Tool` extracts a face's `Geom_Surface`, an edge's
`Geom_Curve` plus `First`/`Last` parameter range, the curve-on-surface
(`CurveOnSurface`) in a face's parametric space, and the per-shape tolerances
(`BRep_Tool.hxx`). `BRepLib` can build a missing 3D curve from a pcurve, enforce
same-parameter/same-range, update tolerances, and orient a closed solid
(`BRepLib.hxx`). The model deliberately stores several representations of the
same edge: 3D curve, pcurve on each adjacent face, and optionally a polygon or
triangulation. They are reconciled by `SameParameter` and tolerance, not by
assuming one representation.

**Tolerance.** Only vertices, edges, and faces have meaningful tolerance.
`BRep_Builder` documentation states the ordering
`Tol(Vertex) >= Tol(Edge) >= Tol(Face)`, that tolerances can be opened but not
restricted, and that an edge cannot be included within the fusion of the
tolerance spheres of its two vertices
(`https://occt3d.com/dev/doc/refman/html/class_b_rep___builder.html`).
`Precision` distinguishes:
`Confusion = 1e-7`, `Intersection = 1e-9`, `Approximation = 1e-6`,
`Angular = 1e-12`, plus parametric conversions
(`https://occt3d.com/dev/doc/refman/html/class_precision.html`). High-level
algorithms pass tolerances down; there is no single global epsilon.

**Ownership and parameterization.** Geometry is handle-owned and shared.
Topology is a graph of value handles; the underlying `TShape` is reference
counted. Parameterization is native to each curve/surface; an edge's parameter
range is separate from the curve's full domain. Orientation is a property of
the topological use, not of the underlying geometry.

**License.** LGPL-2.1 with the OCCT exception, or a commercial license
(`LICENSE_LGPL_21.txt`, `OCCT_LGPL_EXCEPTION.txt`, `README.md`).

### 2.2 SISL 4.6.0

SISL is a geometry/spline library, not a B-rep kernel. `include/sisl.h` defines:

- `SISLCurve`: order `ik`, vertex count `in`, knot vector `et`, coefficients
  `ecoef`, rational coefficients `rcoef`, kind (polynomial/rational
  B-spline/Bezier), dimension, copy mode, direction, bounding box, open/closed
  flag.
- `SISLSurf`: two orders, two vertex counts, two knot vectors, a tensor-product
  coefficient array, rational coefficients, kind, dimension, copy mode,
  direction, bounding box, `use_count`, and one open/closed flag per parameter
  direction.
- `SISLIntcurve`: intersection curve with parameter values in each object,
  optional geometry-space curve, optional parameter-space curves, an
  intersection type, and pretopology flags.

The library exposes functions such as `newCurve`, `copyCurve`, `freeCurve`,
`newSurf`, `copySurface`, `freeSurf`, `s1221` (evaluate curve), `s1421`
(evaluate surface), `s1859` (surface–surface intersection), and many fitting
and interrogation routines. Geometric algorithms take an `epsge` tolerance
argument; the `SISLbox` structure stores a base box, a tolerance-expanded box,
and per-direction tolerances. Ownership is raw pointers; `icopy` controls
whether arrays are copied or referenced.

SISL has no general `Vertex`/`Edge`/`Face`/`Shell` topology. Its "pretopology"
on intersection curves is a classification of intersection pieces, not a
persistent B-rep. It is an excellent reference for NURBS data layout and
interrogation, not for a topology/identity model.

**License.** AGPL-3.0-or-later (see `COPYING` and the header in `sisl.h`), with
a commercial option.

### 2.3 TinySpline 0.6.0

TinySpline is deliberately small and curve-only. `tsBSpline` is a PIMPL handle
over degree, control points, knots, and dimension. NURBS use homogeneous
control points (`[x*w, y*w, z*w, w, ...]`); lines and points are degree 1 and
0 Béziers. The C API covers evaluation, sampling, knot insertion, sub-spline
extraction, Bézier decomposition, derivatives, degree elevation, arc-length
reparameterization, rotation-minimizing frames, morphing, and JSON
serialization (`src/tinyspline.h`). It has no surfaces and no topology.

Tolerances are compile-time constants: `TS_KNOT_EPSILON = 1e-4`,
`TS_POINT_EPSILON = 1e-5`, `TS_LENGTH_ZERO = 1e-4`, default domain `[0,1]`,
and at most 10,000 knots. These are library defaults, not per-entity model
tolerances.

**License.** MIT (`LICENSE`). It is a viable optional curve evaluator, but
EduCAD already has a compact de Boor evaluator and does not need the
dependency.

### 2.4 Manifold 3.5.4

Manifold is a mesh kernel, not an analytic B-rep. Its public `Manifold` class
describes "an oriented, 2-manifold, triangle mesh — a simple boundary
representation of a solid object" (`include/manifold/manifold.h`). Internally
`Manifold::Impl` stores vertex positions, a `Halfedges` array, vertex
properties, normals, and a `MeshRelation` (`src/impl.h`). Topology is exact by
integer halfedge pairing; geometry is inexact floating point. This is the
opposite trade-off from OCCT: exact combinatorial topology, approximate
geometry.

Manifold's manifoldness definition is index-based: every triangle halfedge has
exactly one paired halfedge with reversed endpoints, and triangle winding is
counter-clockwise from outside. `MeshGL` is the flat I/O form: `triVerts`,
interleaved `vertProperties`, optional `mergeFromVert`/`mergeToVert`,
`runIndex`/`runOriginalID`/`runTransform`, and `faceID`. `merge` vectors
reconstruct manifoldness without floating-point comparisons.
`originalID`/`faceID` preserve provenance through Boolean operations for
material and face reapplication; they are not topological names.

`Manifold` provides Boolean, `SplitByPlane`, `TrimByPlane`, refinement, and
smoothing, with a guarantee of manifold output from manifold input. It has no
analytic curves or surfaces and no NURBS. Curved geometry is tessellated
before the Boolean.

**License.** Apache-2.0.

### 2.5 FreeCAD 1.1.4

FreeCAD separates the document/feature model from the geometry kernel.

- `App::Document` owns `DocumentObject`s and provides `recompute`,
  `recomputeFeature`, `isTouched`, `mustExecute`, transactions, and undo
  (`src/App/Document.h:410-450`).
- `App::DocumentObject` provides properties, `touch`, `isTouched`,
  `mustExecute`, `recomputeFeature`, `execute`, and status bits
  (`src/App/DocumentObject.h:180-394`, `725-734`).
- `PropertyLink` / `PropertyLinkSub` create dependency edges; the property
  framework exposes `InList`/`OutList` and detects cyclic dependencies
  (`src/App/PropertyLinks.h:58`, `221`, `1322-1324`).
- `Part::Feature` is the base of shape features. It holds a
  `PropertyPartShape Shape` and implements `mustExecute`, `execute`, and
  `recompute` (`src/Mod/Part/App/PartFeature.h`).
- `Part::TopoShape` wraps a `TopoDS_Shape` and adds transform, subshape
  lookup, element-map/mapped-name handling, and shape history
  (`src/Mod/Part/App/TopoShape.h:298`, `415-464`, `1616-1703`).

The feature is a recipe; the shape is a property computed by `execute`.
Recompute walks touched features and their dependents. Subelement references
are persisted with mapped names and element history, precisely because raw
OCCT subshape indices are not stable across recompute. This is the same
"topological naming" problem EduCAD will face as soon as saved previews
reference faces or edges.

**License.** LGPL-2.1-or-later (`LICENSE`, `PartFeature.h` SPDX header).

### 2.6 Cross-cutting lessons

1. **Separate support from bounded entity.** OCCT `Geom_Surface` is unbounded
   support; `TopoDS_Face` is the trimmed region. EduCAD currently stores both
   in one record.
2. **Make identity explicit.** OCCT uses shared `TShape`; FreeCAD adds mapped
   names and history; Manifold uses `originalID`/`faceID`; SISL is the
   counterexample (raw pointers, no topology). EduCAD currently uses a mixture
   of array indices, object identity, and explicit line ids.
3. **Tolerance is per entity and per algorithm.** OCCT's per-vertex/edge/face
   tolerance and `Precision` family is not overkill; it is how the kernel
   avoids one global epsilon doing unrelated jobs.
4. **Parameterization is first-class.** OCCT stores curve/surface parameters,
   edge ranges, and pcurves. A face trim is a parameter-space region, not just
   a list of 3D curves.
5. **Topology exact, geometry approximate.** Manifold makes this explicit:
   topology is integer incidence; geometry is float. OCCT also separates exact
   combinatorial checks from numeric tolerance. EduCAD's exact rational
   certificate is a local strength worth preserving.
6. **A feature graph is separate from the kernel.** FreeCAD's document model
   is not the B-rep. EduCAD should not turn `surfaces` into a document model.
7. **Extensions are capability-based.** OCCT's virtual `Geom_Surface` and
   FreeCAD's feature classes let new surface types plug in. EduCAD's
   `if (kind === ...)` chains do not.
8. **Do not copy code.** These are architectural patterns, not a source of
   implementation.

---

## 3. Comparison matrix

Legend: `OCCT` = Open CASCADE 8.0.1, `SISL` = SISL 4.6.0, `TS` = TinySpline
0.6.0, `MF` = Manifold 3.5.4, `FC` = FreeCAD 1.1.4, `EC-now` = current EduCAD,
`EC-target` = recommended EduCAD v2.

| Concern | OCCT | SISL | TS | MF | FC | EC-now | EC-target |
|---|---|---|---|---|---|---|---|
| Primary representation | analytic B-rep | NURBS geometry | NURBS curves | triangle mesh | document + OCCT B-rep | bounded analytic surfaces | analytic B-rep-lite |
| Support vs bounded | separate (`Geom_Surface` vs `Face`) | no topology | none | mesh is both | separate | conflated in `surfaces` | separate `Surface` vs `Face` |
| Topology depth | vertex/edge/wire/face/shell/solid | none (pretopology only) | none | halfedge mesh | OCCT + feature graph | surface/loop only | vertex/edge/loop/face/shell |
| Shared boundary identity | shared `TShape` + location + orientation | pointer | pointer | halfedge index | mapped names + OCCT shape | `c:<i>`, object identity, `line:id` | persisted `edge:<id>` |
| Orientation/material | `TopAbs_Orientation`; face normal | curve direction | curve direction | triangle winding | OCCT + feature | `outer`/`inner` label only | edge-use orientation + face side |
| Tolerance | per vertex/edge/face + algorithm precision | `epsge` per operation | compile-time constants | mesh tolerance / bbox | OCCT | one relative `1e-5*max(1,r)` | per-entity + evidence/topology/display split |
| Parameterization | native curve/surface params, edge ranges, pcurves | knot domains | knot domains | barycentric per triangle | OCCT | start/sweep, NURBS knots; no surface UV | explicit domains + optional pcurves |
| History/provenance | limited; names separate | none | none | `originalID`, `faceID` | document feature graph, element history | `sourceIds`, `parentSurfaceId`, `splitBy` | provenance graph + operation ids |
| Booleans | BRep algorithms | no | no | guaranteed mesh Boolean | OCCT | no general Boolean | not in v2 core; future solid layer |
| Persistence | native BRep/STEP | application-owned arrays | JSON | `MeshGL` + glTF | FCStd document | JSON preview, identity loss | ID-based JSON, v1 projection |
| Dependency weight | large C++ | C, AGPL | tiny C, MIT | C++/WASM, Apache | large app | zero-dep JS | zero-dep JS |

The current model is closest to a **surface/loop complex** from
`docs/SURFACE_COMPLEX.md`:

```text
C = (S, B, boundary, incidence)
```

That formulation is good. The gap is that `B` is a bag of heterogeneous
identities rather than an explicit edge registry, and `S` is both support and
face. The v2 model should preserve the complex vocabulary but make `B` a real
edge set and `S` a face layer over supports.

---

## 4. Recommended kernel architecture for EduCAD

### 4.1 Principles

1. **Keep zero npm dependencies.** The kernel is a small analytic B-rep-lite in
   plain JavaScript, not a wrapper around a C++ kernel.
2. **Separate support from bounded entity.** A `Surface` is an unbounded
   analytic support. A `Face` is a trimmed region on that support. This mirrors
   OCCT's `Geom_Surface`/`TopoDS_Face` split without adopting OCCT's size.
3. **Persist identity, not object references.** Every edge, loop, face, and
   surface has an id. Shared boundaries are shared ids. `sourceIds` are
   provenance, never identity.
4. **One incidence graph.** Validation, certification, split, attach, and
   serialization all consume the same `edgeId -> uses` graph.
5. **Tolerance is data.** Store a per-entity linear tolerance and a
   model-level policy. Do not hide a single relative epsilon in every check.
6. **Parameterization is data.** Curves and surfaces expose a domain and
   periodicity; loops trim that domain. Add pcurves only where a 3D boundary
   alone is insufficient.
7. **Capabilities, not `switch` chains.** Each surface family declares what it
   can do: evaluate, validate, section, intersect, split, trim. An unsupported
   operation returns a specific diagnostic, not a crash or a silent guess.
8. **Preserve the v1 projection.** `geometry.surfaces`,
   `geometry.surfaceModel`, `geometry.analyticCertificate`, and
   `geometry.surfaceValidation` keep their current shapes for existing
   `.edu` scripts and saved previews.
9. **Full rebuild for inference; incremental only for explicit operations.**
   Inference is global and cross-view; explicit trim/split/attach can be
   incremental and copy-on-write.
10. **Never use the display mesh as analytic evidence.** Keep the existing
    separation and the existing `inferred-triangle-v1` check.

### 4.2 Entity types

A v2 model can be serialized as arrays and indexed at runtime:

```js
{
  contract: 'analytic-kernel-v2',
  version: 2,
  geometry: {
    points:   [/* Point */],
    curves:   [/* Curve */],
    surfaces: [/* Surface */]
  },
  topology: {
    vertices: [/* Vertex */],
    edges:    [/* Edge */],
    loops:    [/* Loop */],
    faces:    [/* Face */],
    shells:   [/* Shell */]
  },
  tolerances: {
    policy: 'per-entity-v1',
    linear: 1e-6,
    angular: 1e-9,
    parametric: 1e-9
  },
  diagnostics: [],
  provenance: {
    inputHash: '...',
    operations: [/* {op, parentIds, resultIds, diagnostic?} */]
  }
}
```

The records:

```js
Point   = {id, p:{x,y,z}, tol}
Curve   = {id, kind, params, domain:[t0,t1], closed, periodic, exact,
           sourceIds}
Surface = {id, kind, params, domainU:[u0,u1], domainV:[v0,v1],
           closedU, closedV, periodicU, periodicV, exact, sourceIds}
Vertex  = {id, point:{x,y,z}, tol}
Edge    = {id, curveId?, polyline?, pcurves?, startVertex?, endVertex?,
           closed, tol, sourceIds}
EdgeUse = {edgeId, orientation:+1|-1}
Loop    = {id, role:'outer'|'inner', uses:[EdgeUse], signedArea?}
Face    = {id, surfaceId, loops:[loopId], tol, materialSide:'+'|'-',
           inferred, sourceIds, displayFaceIndices, parentId?, operation?}
Shell   = {id, faceIds:[faceId], closed}
```

Notes:

- `Curve` is a **support**; a full circle and a 90° arc can share a support
  with different `domain`s, or be separate records. Keep
  `startAngle`/`sweepAngle` as a compatibility projection of `domain`.
- `Surface` is a **support**; it has no loops. `Face` owns loops. This is the
  single most important structural change.
- `Edge` is the shared seam. It can be a drawing curve (`curveId`), a NURBS
  curve, a finite line (`polyline` with two points), a section sub-arc, or an
  analytic arc. A closed circle edge has `startVertex === endVertex` or
  `closed:true`. A pcurve is `{faceId, curve2d}` and is optional.
- `Loop` stores ordered `EdgeUse`s. `outer`/`inner` is a role; orientation is
  per use. A planar loop can additionally store `signedArea` for fast checks.
- `Face` replaces the current surface record in the topology layer. The v1
  surface record is a projection of a face. `materialSide` is relative to the
  support's natural normal (for a plane, `normal`; otherwise `u × v`), not a
  signed loop orientation.
- `Shell` is explicit only after closure analysis; no need to build it during
  inference. It can be derived and cached.

### 4.3 Ownership and lifecycle

- The model owns all records. `geometry`, `topology`, and `tolerances` are
  owned by the model; records do not own each other.
- Surface and curve supports are immutable after `resolve`. Operations create a
  new model with copy-on-write records; they do not mutate the input.
- References are one-way:
  `Face -> Surface`, `Face -> Loop`, `Loop -> EdgeUse`, `EdgeUse -> Edge`,
  `Edge -> Vertex`, `Edge -> Curve`, `Face -> displayFaceIndices`.
  There are no back-pointers; indexes are rebuilt on demand.
- `sourceIds` point to drawing entities for provenance. They do not own those
  entities and are not used for sharing.
- `parentId` and `operation` record derivation. They are informational; the
  edge/face id is authoritative.
- Candidates from inference are separate from the resolved model:
  `CandidateSet` → `resolve` → `KernelModel`. `infer` never mutates the current
  model.

### 4.4 Boundary elements and incidence

A boundary element is an **edge use**, not a raw curve object. The edge is the
unit of sharing; the use is the unit of orientation.

```text
Face A: loop LA uses edge E with orientation +1
Face B: loop LB uses edge E with orientation -1
=> E is a manifold seam with useCount 2
```

Incidence should return:

```js
{
  byEdge: Map<edgeId, {
    id, edge, useCount, faceIds, loopRefs,
    orientations:[+1,-1], orientationConsistent
  }>,
  byFace: Map<faceId, edgeId[]>,
  openEdges: edgeId[],
  nonManifoldEdges: edgeId[],
  selfSharedEdges: edgeId[]
}
```

Rules:

- `useCount === 1` → open boundary.
- `useCount === 2` and opposite orientations → manifold seam.
- `useCount === 2` and same orientation → orientation conflict, not a seam.
- `useCount > 2` → non-manifold.
- A loop with no uses is invalid.
- A closed face with no loops is allowed only for a complete sphere-like
  support and `face.closed:true`.
- A shell is closed when every edge use is paired and orientation-consistent,
  and every face is bounded. This is stricter and more informative than the
  current "every boundary used twice" rule.

This design also makes `attachBoundary` natural: it adds an `EdgeUse` to a
face's loop, referencing an existing `Edge`. No cloning of the boundary object
is needed, and JSON persistence is by `edgeId`.

### 4.5 Operation boundaries

| Operation | Input | Output | Mutates input? | Failure mode |
|---|---|---|---|---|
| `infer` | drawing evidence | `CandidateSet` | no | diagnostics, candidates retained |
| `resolve` | candidates + options | `KernelModel` | no | duplicate/conflict diagnostics |
| `intersect` | two supports | analytic/numeric curves; optional clipped result | no | `null` for unsupported family |
| `section` | support + plane | analytic section | no | `null` or classified `conic` |
| `trim` | face + cutter | new face(s), removed loops, preserved edges | no | refusal code |
| `split` | face + cutter | new faces, new edges, shared section edge(s) | no | refusal code |
| `attach` | face + edge | new face with an added edge use | no | refusal code |
| `certify` | model | certificate | no | never throws; reports issues |
| `validate` | model | summary | no | never throws |
| `migrate` | v1 model | v2 model | no | lossy diagnostics |

Every operation has an explicit **capability gate**. If a surface family does
not implement `split`, the operation returns
`surface-capability-unsupported` with the family and capability, not a partial
result that looks complete. This is how torus, offset, and NURBS can be added
without destabilizing plane/cylinder/cone/sphere.

`trim` and `split` should return changed-entity records:

```js
{
  ok: true,
  faces: [newFace],
  newEdges: [edgeId],
  modifiedEdges: [edgeId],
  deletedEdges: [edgeId],
  sharedEdges: [edgeId],
  diagnostics: []
}
```

The current v1 functions can be adapted to return `{surface, validation,
certificate}` with the same fields as today.

### 4.6 Rebuild versus incremental

**Full rebuild is canonical for inference.** Cross-view correspondence, curve
lifting, and surface inference are global operations. Trying to incrementally
patch an inferred model after one drawing stroke changes is likely to produce a
model that no full rebuild would produce. The current pipeline already has the
right shape: a pure function from drawing rows to geometry.

Recommendation:

- Full rebuild on every drawing change, with a cache keyed by a normalized
  input hash.
- Deterministic ordering: sort candidates by a stable key before assigning ids,
  so the same input produces the same output.
- Save the resolved model in previews; do not require the student side to
  re-infer.
- Incremental only for **explicit operations** on a resolved model:
  `trim`, `split`, `attach`, and future feature edits. These are copy-on-write
  and record `parentId`/`operation`.
- A future feature graph (FreeCAD-style) can invalidate only dependents of a
  changed feature, but it should not be used to make inference incremental.
- If a saved model's schema is current, load it directly. If not, migrate it.
  If the original ink is available and the model is only a cache, rebuild.

This keeps the mental model simple: **inference is a rebuild; modeling
operations are edits.**

### 4.7 Serialization and preview compatibility

The v1 projection must remain exact. A v2 model can be projected as:

```js
geometry.surfaces = model.faces.map(toV1Surface)
geometry.surfaceModel = summarizeV1(model)
geometry.analyticSurfaceValidation = validateV1(model)
geometry.analyticCertificate = certifyV1(model)
geometry.curves = model.geometry.curves.map(toV1Curve)
```

`toV1Surface` writes the same fields as today: `kind`, analytic parameters,
`loops`, `sourceIds`, `displayFaceIndices`, `closed`, feature metadata. A v1
consumer never sees `kernel` unless it asks for it.

New optional fields:

```js
geometry.kernelContract = 'analytic-kernel-v2'
geometry.kernel = { /* full model, or a compact face/edge projection */ }
```

Compatibility rules:

- Old preview with no `kernel` → accepted exactly as today.
- New preview with `kernelContract` → validator must accept it, and must
  validate the v1 projection and the kernel consistency.
- Unknown surface kind in a v1-only preview → reject or diagnostic, as today.
- Unknown surface kind in a v2 preview → allowed only if the family is
  registered and the capability gate says which operations are available.
- Never persist shared object references. Every shared section, line, and
  edge is an id. This directly fixes W1.
- Keep `surface:<n>` ids for v1 output. Add `faceId`/`edgeId` namespaced ids
  in the kernel block. Do not renumber existing surfaces.
- A v2 preview can omit the full support registry if it includes enough for
  display and the v1 projection. Prefer including the topology ids and the
  face records; the support records are small.

`Ref3d.buildPreview` currently serializes `surfaces` and `surfacePatches`
(`public/lib/educad-ref3d.js:94-100`) and then deep-clones via JSON (`104`).
Once sections have ids, the deep clone is harmless. The `validPreview` kind
list (`172-187`) needs either an `arc` alias or a `kernelContract` path.

### 4.8 Module layout

Keep the UMD/browser/Node pattern and zero dependencies. Proposed split:

| Module | Responsibility |
|---|---|
| `public/lib/educad-kernel.js` | records, ids, incidence, resolve, validate, certify |
| `public/lib/educad-surface-registry.js` | family traits and capability gates |
| `public/lib/educad-kernel-v1.js` | `fromV1`/`toV1` projection and compatibility |
| `public/lib/educad-kernel-serialize.js` | JSON schema, migrations, round-trip |
| `public/lib/educad-surfaces.js` | existing v1 facade; delegates to kernel where safe |
| `public/lib/educad-parametric.js` | existing curve evaluator; add surface tensor-product evaluator later |

Do not put the kernel in `educad-surfaces.js`; it is already 2,588 lines and
mixes build, validate, certify, section, intersect, split, attach, and feature
logic. The registry split is the main maintainability win.

---

## 5. Future torus, offset, and NURBS surfaces

### 5.1 Capability registry

Every surface family should provide:

```js
{
  kind,
  exact: true|false,
  analytic: true,
  params: {/* schema/defaults */},
  eval(surface, u, v),
  residual(surface, point),
  domain(surface),
  validate(surface),
  tessellate(surface, tolerance),
  section(surface, plane),          // exact | numeric | null
  intersect(a, b),                  // exact | numeric | null
  capabilities: {
    section: 'exact'|'numeric'|'none',
    intersect: 'exact'|'numeric'|'none',
    split: true|false,
    trim: true|false,
    boundaryFromLoop: true|false,
    pcurve: true|false
  }
}
```

The core kernel must not contain `if (kind === 'torus')` branches. It asks the
registry for a family and checks capabilities. Unknown/unregistered kinds
produce `surface-kind-unsupported` with the kind name.

### 5.2 Torus

The natural torus parameterization is:

```text
S(u,v) = C + (R + r cos v)(cos u X + sin u Y) + r sin v Z
```

with unit axis `Z`, orthonormal `X`,`Y`, `R>0`, `r>0`, `u` and `v` periodic.
The implicit residual is:

```text
rho = sqrt(((p-C)·X)^2 + ((p-C)·Y)^2)
residual = (rho - R)^2 + ((p-C)·Z)^2 - r^2
```

A torus fillet face is a bounded rectangle in `(u,v)`; its boundaries are
circles/arcs in planes `u = const` or `v = const`. That means the existing
curve vocabulary can represent its loops; no new curve kind is required.

Implementation order:

1. Add `kind:'torus'` as a **support** with `eval`, `residual`, `validate`,
   `tessellate`, and `certify` numeric checks.
2. Allow a `Face` to reference it; validate loop curves on the torus.
3. Add `section` only for exact special cases:
   plane perpendicular to the axis → one or two circles;
   plane through the axis → one or two circles;
   general plane → quartic; classify as `quartic`/`numeric` rather than
   pretending it is a conic.
4. Add `split` only after the section/loop machinery can handle those exact
   cases. Refuse general quartic cuts with a capability code.
5. Then infer a torus fillet patch from a quarter-round arc plus generator
   evidence. Do not make torus inference a prerequisite for the support type.

This staging lets a torus exist in the model and certificate without requiring
a full torus Boolean kernel.

### 5.3 Offset surfaces

An offset support is:

```text
S_d(u,v) = S(u,v) + d * N(u,v)
N = normalize(Su × Sv)
```

Record it as `{kind:'offset', baseSurfaceId, distance, orientation, domain}`.
The residual is the distance from the point to the base support, with a sign:
`distance(p, base) - |d|`. Computing that distance generally requires point
inversion (Newton) on the base; mark the result `numeric`.

Canonicalize when possible:

- offset of a plane along its normal → the same plane shifted by `d`;
- offset of a cylinder along its radial normal → a coaxial cylinder with
  radius `r ± d` (choose the side by orientation);
- offset of a sphere along its radial normal → a concentric sphere with radius
  `R ± d`;
- offset of a cone/torus/NURBS → generic offset unless a special case is
  proven exact.

Capabilities:

- `eval` exact (base eval + normal);
- `residual` numeric except canonicalized cases;
- `section` numeric except canonicalized cases;
- `intersect` numeric or `null`;
- `split`/`trim` false initially;
- `boundaryFromLoop` true only when the loop is already a known curve on the
  offset (for example a canonicalized cylinder offset).

This prevents an offset from being treated as a first-class exact surface
before the kernel can certify it.

### 5.4 NURBS surfaces

A NURBS support should mirror the existing NURBS curve contract:

```js
{
  kind: 'nurbs',
  degreeU, degreeV,
  controlPoints: [[{x,y,z}...]...],
  weights: [[w...]...],
  knotsU, knotsV,
  domainU: [u0,u1], domainV: [v0,v1],
  periodicU, periodicV,
  closedU, closedV
}
```

Evaluate with a tensor-product homogeneous de Boor. Validate:

- degrees 1..8;
- positive weights;
- nondecreasing knot vectors with the right lengths;
- finite control points;
- nonempty parameter domain;
- `n + p + 1` knot count in each direction.

Boundary curves can be extracted as NURBS curves at `u = const` or
`v = const`, or stored as pcurves in `(u,v)` space. For a face trim, the pcurve
is usually the better representation because it avoids re-solving the surface
evaluation. Add pcurves only for NURBS/torus/offset faces; the current
plane/cylinder/cone/sphere faces can continue to use 3D boundary curves.

Capabilities:

- `eval` exact in the rational tensor-product sense, but mark
  `exact:false` for certificate purposes because JavaScript floating point is
  not an exact arithmetic proof;
- `residual` numeric with point inversion;
- `section`/`intersect` numeric, or `null` until implemented;
- `split`/`trim` only for isoparametric cuts initially; general plane cuts
  refused with a capability code;
- `pcurve:true`.

Do not convert every analytic surface to NURBS for uniformity. OCCT keeps
specialized plane/cylinder/cone/sphere/torus classes for a reason: exact
predicates and simple parameters. EduCAD should do the same.

### 5.5 Guardrails

- A new family must pass `validate` and `certify` before it can be used by
  `split` or `trim`.
- An unsupported operation returns a typed refusal, never `null` without a
  reason in the kernel layer.
- Tolerance scales with the family's characteristic size:
  torus `max(R,r)`, offset `|d| + base size`, NURBS control-net extent.
- `exact:false` is a first-class status; numeric checks carry residuals and
  tolerances, and the certificate does not claim exactness.
- `surfacePatches` remains a display projection. A torus/NURBS face gets a
  tessellation, not a second source of truth.
- Existing plane/cylinder/cone/sphere behavior and `.edu` outputs must not
  change when a new family is registered.

---

## 6. Migration strategy

The migration is additive. No existing `.edu` script should need a new
expectation, and no saved preview should stop loading.

### Phase 0 — Baseline (this report)

- Freeze the current behavior and record it.
- Add no production code.
- Acceptance: this document and a clean worktree.

### Phase 1 — Boundary identity v2

Changes:

- Give every inline section, inline curve boundary, and generated sub-arc an
  explicit `id`.
- Extend `incidence` to prefer an explicit id over object identity, with the
  current behavior as fallback.
- Add `id` to `line` elements created by inference (the fillet already does
  this).
- Fix the `arc`/`circular-arc` validator mismatch as an alias, not a rename.
- Preserve `section:<n>` output for elements without an id.

Compatibility:

- Old models without ids still work.
- Old `section:<n>` ids remain in certificates for unlabeled elements.
- New models have stable ids across JSON.

Acceptance:

- A new `.edu` script creates two surfaces sharing a section, serializes and
  reloads the preview, and re-runs `incidence` with `useCount 2`.
- `fillet-line-boundary.edu` and the other seam-heavy scripts are unchanged.

### Phase 2 — Shadow kernel projection

Changes:

- Add `Kernel.fromV1(geometry)` and `Kernel.toV1(model)`.
- Build edges from every loop element:
  - drawing curve index → edge with `curveId`;
  - inline section/curve → edge with support curve id;
  - line → edge with a line support;
  - vertex/polyline loop → edges with line supports;
  - `elements` sub-arcs/polylines → child edges with `parentId`.
- Build loops as edge-use lists and faces as `surface + loops`.
- Derive incidence and compare it with `Surfaces.incidence`.

Compatibility:

- `geometry.surfaces` is still the v1 projection.
- `Kernel.fromV1` is read-only; no inference path calls it yet.
- No new surface kinds.

Acceptance:

- For every current `.edu` script, kernel incidence counts match v1 counts
  (surfaces, boundaries, shared/open/non-manifold).
- A round-trip `v1 -> v2 -> v1` preserves the surface records and certificate
  status.

### Phase 3 — Kernel operations

Changes:

- Implement `Kernel.split`, `Kernel.trim`, `Kernel.attach`, and
  `Kernel.promote` on the v2 model.
- Adapt the existing `Surfaces.split`/`trim`/`attachBoundary` to call the
  kernel adapters and project the result back to v1.
- Add `changedEdges`/`newEdges`/`sharedEdges` to the v2 result; the v1 result
  keeps its current shape.

Compatibility:

- Existing `surface-query` operations keep their result shapes.
- Existing `.edu` expectations stay valid.

Acceptance:

- A split of a cylinder band preserves unchanged edge ids and gives the new
  section edge to both pieces.
- A split/attach round-trip through JSON keeps shared ids.
- Existing refusal codes remain, with new capability codes only for new
  families.

### Phase 4 — Registry and tolerance policy

Changes:

- Move `plane`/`cylinder`/`cone`/`sphere` type-specific checks into family
  entries.
- Move `surfaceTolerance` into a model policy with per-entity overrides.
- Keep the current numeric values as defaults so existing certificates are
  unchanged.
- Add `evidenceTolerance`, `topologyTolerance`, and `displayTolerance` fields;
  the first two can initially share the current value.

Compatibility:

- Certificate shape and statuses unchanged.
- Numeric residuals may be identical because the default policy is the same.

Acceptance:

- Certificate diffs are empty for the existing scripts.
- A synthetic model with an overridden tolerance reports the override in its
  certificate.

### Phase 5 — New families

Order:

1. Torus support + validation + tessellation + certificate.
2. NURBS surface support + validation + numeric certificate.
3. Offset support + canonicalization + numeric certificate.
4. Only then enable family-specific inference (torus fillet, NURBS patches)
   and any exact special-case sections.
5. Enable split/trim per family only after the capability tests pass.

Compatibility:

- New kinds are not emitted by the existing inference path unless explicitly
  enabled.
- v1 consumers see new kinds only if they opt into `kernelContract`.
- Existing `.edu` scripts do not change.

### Phase 6 — Deprecate v1 internals

- Keep `geometry.surfaces` as a projection; do not delete it.
- Remove object-identity sharing from new code paths; keep fallback for old
  JSON.
- Keep `boundaryCurves` as a legacy advisory field, but make loops authoritative.
- Remove duplicate surface/loop logic only after the projection tests pass.

### Minimal breaking changes

The only unavoidable break is **semantic**: code that relied on two equal but
distinct section objects being "the same" was already relying on object
identity that does not survive serialization. Making ids explicit fixes that
and changes the result of such a model from "two open boundaries" to "one
shared boundary." That is the intended correction, and it should be reported
as a migration diagnostic for old previews instead of silently guessing.

Everything else is additive:

- no renamed v1 fields;
- no renumbered `surface:<n>`;
- no removed certificate fields;
- no changed `.edu` property names;
- no changed `surface-query` result shapes;
- old previews load;
- new previews are ignored gracefully by old clients.

Rollback: put the v2 path behind a `kernelV2` option. Phase 1 ids are safe
without a flag; phases 2–5 can be disabled and still produce the v1 projection.

---

## 7. API sketch and `.edu` test plan

### 7.1 API sketch

```js
// Construct a v2 model from the existing analytic projection.
var model = EduCADKernel.fromV1(geometry, {
  tolerancePolicy: 'v1-default'
});

// Project back; this is what existing consumers keep using.
var v1 = EduCADKernel.toV1(model);

// Read-only inspection.
EduCADKernel.validate(model);
EduCADKernel.certify(model);
var graph = EduCADKernel.incidence(model);
// graph.byEdge, graph.byFace, graph.openEdges, graph.nonManifoldEdges

// Inference stays a pure candidate pipeline.
var candidates = EduCADKernel.infer(evidence, options);
var resolved = EduCADKernel.resolve(candidates, {model: model});

// Explicit operations are copy-on-write.
var split = EduCADKernel.split(model, faceId, cutter, options);
var trimmed = EduCADKernel.trim(model, faceId, cutter, options);
var attached = EduCADKernel.attach(model, faceId, edgeId, options);

// Surface-family registration.
EduCADKernel.registerSurfaceFamily('torus', torusFamily);
EduCADKernel.capabilities('torus');
// {section:'exact-special-cases', intersect:'numeric',
//  split:false, trim:false, pcurve:false}

// Serialization.
var json = EduCADKernel.serialize(model);
var loaded = EduCADKernel.deserialize(json, {migrate:true});
```

The existing public surface API can remain:

```js
EduCADSurfaces.build(geometry, options)
EduCADSurfaces.validate(model, geometry)
EduCADSurfaces.certify(model, geometry)
EduCADSurfaces.section(surface, plane)
EduCADSurfaces.intersect(a, b)
EduCADSurfaces.split(surface, plane, geometry, diagnostics)
EduCADSurfaces.trim(surface, plane, keepPositive, geometry)
EduCADSurfaces.attachBoundary(surface, boundary, geometry, diagnostics)
EduCADSurfaces.shareBoundary(a, b, boundary, geometry, diagnostics)
EduCADSurfaces.intersectionCurves(result)
EduCADSurfaces.incidence(model)
```

Those functions can become adapters over the kernel. Their result shapes must
not change in v1 mode.

### 7.2 New `.edu` queries

Extend the existing `# surface-query:` parser rather than adding a second
parser. Proposed operations:

| Operation | Input | Expected result |
|---|---|---|
| `kernel` | none | `{contract, faceCount, edgeCount, loopCount, shellCount}` |
| `incidence` | none | counts and shared/open/non-manifold edge ids |
| `roundtrip` | `save`/`load` names | `{ok, useCount, certificateStatus}` |
| `face` | `face` ref | surface kind, loop count, edge ids |
| `capability` | `kind` | capability record |
| `split` | `face`, plane | v2 faces/newEdges/sharedEdges plus v1 projection |
| `attach` | `face`, `edge` | edge use count and faces |
| `curve` | curve ref | kind, domain, closed/periodic |

The `expect` matcher is already a recursive subset with numeric tolerance
(`tools/edc.js:149-153`). New queries can reuse it.

Example:

```text
# kernel-query: {"operation":"kernel","expect":{"contract":"analytic-kernel-v2","faceCount":3}}
# kernel-query: {"operation":"incidence","expect":{"sharedEdges":2,"openEdges":3,"nonManifoldEdges":0}}
# kernel-query: {"operation":"roundtrip","expect":{"ok":true,"useCount":2,"certificateStatus":"partial"}}
```

### 7.3 New `.edu` scripts

Add scripts, not unit-test files. Each script is a drawing plus `# expect:`
properties, and optional `# surface-query:`/`# kernel-query:` blocks.

1. `kernel-identity-roundtrip.edu`
   - Build a model with two faces sharing one section.
   - Serialize the preview, reload it, and re-run incidence.
   - Expect `kernelContract=analytic-kernel-v2 kernelSharedEdges=1
     kernelRoundTrip=ok`.
   - This is the acceptance test for Phase 1 and the smallest milestone.

2. `kernel-incidence-fillet.edu`
   - Reuse the fillet drawing.
   - Expect the two generator lines to have `useCount 2`, the two end arcs to
     be open, and the v1 counts unchanged.

3. `kernel-split-preserves-edges.edu`
   - Split a truncated cylinder band.
   - Expect unchanged bottom/top edges to keep their ids, the new section edge
     to be shared by both pieces, and the v1 `surface-query` result to match
     today.

4. `kernel-unsupported-capability.edu`
   - Register a fake family with `split:false`, or use a future torus/NURBS
     face.
   - Expect `split` to return `surface-capability-unsupported` and no mangled
     output.

5. `kernel-curve-kinds.edu`
   - Include a circle, an arc, an ellipse, and a NURBS curve.
   - Expect canonical `curveKinds`, `curveDomains`, and a persisted `arc`
     alias accepted by `validPreview`.

6. Future: `kernel-torus-fillet.edu`
   - A quarter-torus fillet patch with two circular end arcs.
   - Expect `surfaceKinds=torus,plane`, numeric certificate `partial` or `ok`,
     and a refused general split until supported.

7. Future: `kernel-nurbs-patch.edu`
   - A four-boundary NURBS patch with a known control net.
   - Expect `kernelCurveKinds=nurbs`, numeric validation, `pcurve` present,
     and `split` refused with a capability code.

8. Future: `kernel-offset-canonical.edu`
   - Offset a plane/cylinder/sphere and verify canonicalization to the same
     family with adjusted parameters.
   - Expect `offsetCanonicalized=ok` and no new support kind in the v1
     projection.

### 7.4 Properties to add to `tools/edc.js`

Current properties are computed in `topologyProperties` and the surface-query
block. Add, behind the v2 path:

```text
kernelContract=analytic-kernel-v2
kernelFaces=<n>
kernelEdges=<n>
kernelLoops=<n>
kernelSharedEdges=<n>
kernelOpenEdges=<n>
kernelNonManifoldEdges=<n>
kernelRoundTrip=ok|issues|none
kernelIncidence=ok|issues
kernelCertificate=ok|partial|issues
kernelCapability=<none|...>
```

Do not remove or rename existing properties. `surfaceChecks`,
`surfaceQueries`, `surfaceCertificate`, `surfaceLineBoundaries`, etc. remain.

### 7.5 Verification commands

Run the existing scripts that exercise seams, splits, attachments, and curved
surfaces:

```sh
node tools/edc.js tools/scripts/fillet-line-boundary.edu
node tools/edc.js tools/scripts/cone.edu
node tools/edc.js tools/scripts/spherical-recess.edu
node tools/edc.js tools/scripts/truncated-cylinder.edu
node tools/edc.js tools/scripts/surface-split-crossing.edu
node tools/edc.js tools/scripts/surface-attach-shared.edu
```

Then add and run:

```sh
node tools/edc.js tools/scripts/kernel-identity-roundtrip.edu
node tools/edc.js tools/scripts/kernel-incidence-fillet.edu
node tools/edc.js tools/scripts/kernel-split-preserves-edges.edu
node tools/edc.js tools/scripts/kernel-unsupported-capability.edu
node tools/edc.js tools/scripts/kernel-curve-kinds.edu
```

Acceptance is `CLEAN` for each script and no new diagnostics in existing
scripts. Since project policy forbids separate test suites, these scripts are
the test plan.

---

## 8. Licensing and dependency notes

| Project | Version | License | Fit for EduCAD | Recommendation |
|---|---|---|---|---|
| Open CASCADE Technology | 8.0.1 | LGPL-2.1 with OCCT exception, or commercial | analytic B-rep, but large C++ and LGPL obligations | Do not embed; use as architectural reference |
| SISL | 4.6.0 | AGPL-3.0-or-later, or commercial | NURBS only, no topology | Do not link; AGPL source-disclosure obligations are a poor fit for the zero-dep MIT distribution model |
| TinySpline | 0.6.0 | MIT | curves only; no surfaces | Optional; current JS evaluator is sufficient |
| Manifold | 3.5.4 | Apache-2.0 | guaranteed mesh Boolean; no analytic surfaces | Optional mesh backend later; not the kernel |
| FreeCAD | 1.1.4 | LGPL-2.1-or-later | application/document model | Reference only |
| EduCAD | current | MIT | zero npm dependencies | Keep MIT and zero-dep |

Specific notes:

- **OCCT.** The LGPL-2.1 text is in `LICENSE_LGPL_21.txt`; the header exception
  is in `OCCT_LGPL_EXCEPTION.txt`. The exception covers object code that
  incorporates material from OCCT header files, not a blanket permission to
  statically link the library into a proprietary product. A real integration
  would need a deliberate dynamic-link/notice strategy or a commercial license.
  For EduCAD, the architectural lessons are useful; the code is not needed.
- **SISL.** The `COPYING` file is AGPL-3.0, and `include/sisl.h` states that a
  commercial license is mandatory for commercial use without source
  disclosure. AGPL's network-use clause is a poor fit for a web-delivered
  teaching app. Avoid.
- **TinySpline.** MIT is compatible with EduCAD's MIT license. It is a
  curve-only library; EduCAD already has a ~100-line de Boor evaluator and
  interpolation code in `educad-parametric.js`. Vendoring it would add code
  without adding a surface model.
- **Manifold.** Apache-2.0 is compatible with MIT. It is a mesh kernel with a
  manifold guarantee, not an analytic curve/surface kernel. It could later
  provide a mesh Boolean/repair backend, but it would add a C++/WASM build and
  would not solve the analytic representation problem.
- **FreeCAD.** LGPL-2.1-or-later; its document/feature model is an application
  framework, not a library to embed in a zero-dependency browser app. Use its
  ideas (touch/recompute, property links, mapped names) without its code.
- **No code copied.** All OSS references in this report are documentation and
  source reading for architecture. The report contains no copied
  implementation.

This is an engineering assessment, not legal advice. Any actual dependency
adoption needs a license review against the distribution model.

---

## 9. Ranked recommendation

### Decision

Adopt an **analytic B-rep-lite v2 shadow kernel** in JavaScript, preserve the
v1 projection, and do not adopt an external kernel.

### Ranked actions

1. **Persist boundary identity (highest priority, lowest risk).**
   Give every section, curve boundary, line, and generated sub-arc an explicit
   id; make incidence prefer ids; keep object identity only as a legacy
   fallback. This fixes the JSON sharing bug (W1), makes saved previews
   trustworthy, and is a prerequisite for every later phase.

2. **Introduce the v2 shadow model: support vs face, edge vs use.**
   `Surface` becomes unbounded support; `Face` owns loops; `Edge` is the shared
   seam; `Loop` stores ordered oriented edge uses. Project to
   `analytic-surface-v1` so no existing consumer breaks.

3. **Make tolerance and parameterization explicit.**
   Per-entity linear tolerance, separate evidence/topology/display tolerances,
   explicit curve/surface domains, and optional pcurves. Keep the current
   default values so existing certificates do not change.

4. **Move surface families behind a capability registry.**
   Plane/cylinder/cone/sphere first, then torus/NURBS/offset. Unsupported
   operations return typed capability refusals. This is the guardrail that
   prevents a new surface from destabilizing split/trim/certify.

5. **Keep full rebuild for inference; use incremental edits only for explicit
   operations.**
   Inference is global and cross-view. Trim/split/attach are copy-on-write.
   Save resolved models; do not re-infer on the student side.

6. **Reject external kernels for this codebase.**
   OCCT is too large and LGPL-encumbered for the zero-dep MIT distribution;
   SISL is AGPL; TinySpline is curves-only; Manifold is mesh-only; FreeCAD is
   an application framework. Borrow architecture, not code.

7. **Defer torus/offset/NURBS until the registry and identity layers exist.**
   Add torus support first (validation/certificate, then special-case
   sections), NURBS surfaces second (numeric certificate, pcurves), offset
   third (canonicalize common cases). Do not add them as extra `if` branches
   in `educad-surfaces.js`.

### Why this ranking

The current model's geometry is already good enough for its supported
families. Its weak point is not the analytic formulas; it is the identity and
ownership layer. A full kernel rewrite would risk the 143 `.edu` scripts and
the saved-preview format for no immediate gain. The v2 shadow model captures
the useful OSS architecture while keeping the v1 contract as a stable facade.

---

## 10. Smallest next architectural milestone

**Milestone: boundary identity v2 and a JSON round-trip proof.**

Do only this:

1. Add an explicit `id` to every inline section, inline curve boundary, and
   generated sub-arc at creation time. Use a deterministic key:
   `section:<kind>:<canonical-geometry-hash>` or an operation path such as
   `section:<parentFaceId>/split:<n>`.
2. Keep `line:id:<id>` as-is and add ids where inference creates lines without
   one.
3. Extend `Surfaces.incidence` / `elementId` to use an explicit boundary id
   when present; fall back to object identity for legacy models.
4. Add a `kernel-identity-roundtrip.edu` script that:
   - creates two faces sharing one section,
   - serializes the preview and parses it back,
   - re-runs incidence,
   - checks `useCount:2` and the same certificate status.
5. Accept `arc` as an alias of `circular-arc` in `Ref3d.validPreview`, and add
   a regression script for an oblique arc preview.

Non-goals for this milestone:

- no new surface kinds;
- no edge/face registry yet;
- no changes to inference or `.edu` expectations;
- no changes to the certificate shape;
- no changes to `surface-query` result shapes.

Acceptance:

- `node tools/edc.js tools/scripts/kernel-identity-roundtrip.edu` is `CLEAN`.
- The six existing seam/split scripts in §7.5 are unchanged.
- The round-trip script proves `section` sharing survives JSON.
- A model with old, id-less sections still validates with the legacy path.

This milestone is small, testable through the existing `.edu` mechanism, and
creates the identity seam that the full v2 kernel needs.

---

## Appendix A — Source map

### EduCAD

- `docs/SURFACE_MODEL.md` — bounded analytic model, validation, certificate,
  split/attach semantics, limits.
- `docs/SURFACE_COMPLEX.md` — surface complex formulation and operation
  vocabulary.
- `docs/PRIMITIVE_RECONSTRUCTION.md` — public pipeline and curve/surface
  inference stages.
- `docs/RECONSTRUCTION_CONTRACT.md` — separate declared-triangle contract.
- `public/lib/educad-surfaces.js` — `build` (93-360), loop elements (362-443),
  incidence (448-481), analyze (483-510), validate (512-617), exact arithmetic
  (624-696), parameters/tolerance/residual (699-734), certify (772-1295),
  section (1316), intersect (1407), split (2437), attach (2468),
  intersectionCurves (2541).
- `public/lib/educad-curve-reconstruct.js` — circle/arc/ellipse lifting
  (100-180), oblique arc (563), recesses (592, 865-871), fillet lines
  (1130-1156), cone (1672).
- `public/lib/educad-oblique-kernel.js` — circle construction (403), arc
  promotion (563), fit/return (591).
- `public/lib/educad-parametric.js` — NURBS validation/evaluation/
  interpolation/tessellation (15-119).
- `public/lib/educad-ref3d.js` — preview fields (94-100), JSON deep clone
  (104), `validPreview` (112-187).
- `public/lib/educad-reconstruct.js` — surface attachment at the end of the
  pipeline (2854-2862, 3061-3069).
- `tools/edc.js` — surface-query parser and `expect` matcher (149-253).

### OSS

- OCCT 8.0.1 release:
  `https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8_0_1`.
- OCCT Modeling Data guide:
  `https://occt3d.com/dev/doc/overview/html/occt_user_guides__modeling_data.html`.
- `Geom_Geometry.hxx`:
  `https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingData/TKG3d/Geom/Geom_Geometry.hxx`.
- `Geom_Curve.hxx`:
  `https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingData/TKG3d/Geom/Geom_Curve.hxx`.
- `Geom_Surface.hxx`:
  `https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingData/TKG3d/Geom/Geom_Surface.hxx`.
- `TopoDS_Shape.hxx`:
  `https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingData/TKBRep/TopoDS/TopoDS_Shape.hxx`.
- `BRep_Tool.hxx`:
  `https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingData/TKBRep/BRep/BRep_Tool.hxx`.
- `BRepLib.hxx`:
  `https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/src/ModelingAlgorithms/TKTopAlgo/BRepLib/BRepLib.hxx`.
- `BRep_Builder` tolerance documentation:
  `https://occt3d.com/dev/doc/refman/html/class_b_rep___builder.html`.
- `Precision` documentation:
  `https://occt3d.com/dev/doc/refman/html/class_precision.html`.
- OCCT license:
  `https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/LICENSE_LGPL_21.txt`,
  `https://github.com/Open-Cascade-SAS/OCCT/blob/V8_0_1/OCCT_LGPL_EXCEPTION.txt`.
- SISL 4.6.0:
  `https://github.com/SINTEF-Geometry/SISL/tree/SISL-4.6.0`;
  `include/sisl.h`, `COPYING`.
- TinySpline 0.6.0:
  `https://github.com/msteinbeck/tinyspline/tree/v0.6.0`;
  `README.md`, `LICENSE`, `src/tinyspline.h`.
- Manifold 3.5.4:
  `https://github.com/elalish/manifold/tree/v3.5.4`;
  `README.md`, `LICENSE`, `include/manifold/manifold.h`,
  `include/manifold/mesh.h`, `src/impl.h`.
- Manifold Library wiki:
  `https://github.com/elalish/manifold/wiki/Manifold-Library`.
- FreeCAD 1.1.4:
  `https://github.com/FreeCAD/FreeCAD/tree/1.1.4`;
  `src/App/Document.h`, `src/App/DocumentObject.h`,
  `src/App/PropertyLinks.h`, `src/Mod/Part/App/PartFeature.h`,
  `src/Mod/Part/App/TopoShape.h`, `LICENSE`, `README.md`.

---

## Appendix B — Unverified claims and limits of this report

The following were not verified by building or running the OSS projects:

- OCCT 8.0.1 runtime behavior, performance, and the full BRep algorithm set.
  The report uses headers and documentation only.
- SISL 4.6.0 compilation, numerical behavior, and the exact semantics of every
  `epsge` argument. The report uses `include/sisl.h` and `COPYING`.
- TinySpline 0.6.0 build/runtime behavior. The report uses its README, header,
  and license.
- Manifold 3.5.4 build/runtime behavior and its Boolean robustness claims. The
  report uses its public headers, `impl.h`, README, and wiki.
- FreeCAD 1.1.4 runtime behavior, recompute semantics, and element-map
  behavior. The report uses headers and documentation. The current FreeCAD
  release channel also has a 26.3 release candidate; this report deliberately
  cites the stable 1.1.4 tag.
- OCCT's newer graph-based BRep direction is not analyzed in depth.

The following EduCAD claims are limited:

- The local baseline check ran the key seam/split scripts individually and a
  5-second-per-file sweep of the 143 `.edu` files. Four files exceeded the
  5-second per-file limit in the sweep but passed when run individually with a
  30-second limit. A complete timing-independent sweep was not finished, so
  this report does not claim "all 143 pass in one run."
- The `arc`/`validPreview` mismatch was verified with a synthetic preview and
  by reading the producer code; an end-to-end app save/load of an oblique arc
  preview was not reproduced.
- The JSON section-sharing loss was verified with a local Node round-trip on a
  synthetic two-surface model, not on a stored production preview.
- The torus, offset, and NURBS formulas and capability plans are design
  sketches. They were not numerically validated, and no implementation exists.
- The proposed `.edu` properties and `kernel-query` operations are not
  implemented. They are a test plan.
- No performance measurements or memory estimates are included.
- The licensing section is an engineering assessment, not legal advice.
- No production code, test suite, or generated manual was changed by this
  report.

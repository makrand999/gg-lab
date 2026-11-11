# Hidden-line removal and analytic projection

Status: research/design note (no production code changed)
Scope: **Major** (the original EduCAD interface), in the research worktree
`/home/max/.local/share/opencode/worktree/6031bc/research-hlr-projection`.
Date: 2026-11-11.

## 1. Problem statement

Major already reconstructs bounded analytic surfaces (`plane`, `cylinder`,
`cone`, `sphere`) and analytic curves (`circle`, `ellipse`, `arc`, `line`,
`conic`). It also reconstructs straight edges between 3D vertices. The
projection code, however, still performs hidden-line removal against the
**display mesh**: every edge is a mesh edge, every face is a triangle or a
planar loop, and every visible/hidden interval is a parameter interval on a
mesh edge.

That is adequate for a wireframe preview and is internally consistent for a
polyhedron. It is not adequate for an engineering drawing of a curved solid:

- a sphere silhouette is a jagged ring of mesh edges, not a circle;
- a cylinder rim is a 24-gon, not a circle or ellipse;
- a cylinder/cone side silhouette is selected from mesh generators, not
  solved from the analytic surface;
- an analytic curve cannot be split at an exact tangent or occlusion event;
- the result has no stable identity for a circle, ellipse, or analytic arc;
- there is no perspective projection at all.

The goal is therefore:

> Given a scene of bounded analytic surfaces and analytic edges/curves, and
> an orthographic or perspective view, return the maximal parameter intervals
> of every edge/curve that are visible or hidden, with the analytic geometry
> of each interval preserved. The interval boundaries must be the actual
> visibility-change events (surface crossings, projected patch boundaries,
> projected silhouettes, tangencies, and endpoint events), not tessellation
> vertices.

"Exact" in this report means **analytic event geometry evaluated in double
precision with an explicit tolerance**. It does not mean exact rational
arithmetic through trigonometric roots, and it does not mean that an inferred
surface is certified to be the author's intent. The analytic surface
certificate remains a separate concern (`Surfaces.certify`).

### 1.1 Formal setting

Let a view be one of:

```text
orthographic:  V = (D, R, U)
               pi(p)   = (p.R, p.U)
               depth(p) = p.D

perspective:   V = (E, R, U, f)
               q        = p - E
               pi(p)    = f * (q.R, q.U) / (q.D)
               depth(p) = q.D
```

`D` is the unit direction from the scene toward the viewer for orthographic
views (or from the eye into the scene for perspective), `R` and `U` are the
image-plane axes, `E` is the eye, and `f` is the image-plane distance. The
existing `front`, `top`, `left`, and `right` views are special cases of the
orthographic form.

A bounded surface is a support surface `S` plus a material patch `P` defined
by its ordered loops. A curve is a map `C(t)` on a finite parameter domain,
with the existing EduCAD curve representation:

```text
center, u, v, radiusU, radiusV, startAngle, sweepAngle
P(t) = center + u*radiusU*cos(theta) + v*radiusV*sin(theta)
theta = startAngle + sweepAngle*t
```

A line element is `L(t) = start + t*(end-start)`, `t` in `[0,1]`.

The visibility function of `C` is piecewise constant on its parameter domain.
Its transition set is a subset of:

1. **Curve-surface crossings** `C(t) in S`, where the candidate passes through
   the support surface and the depth ordering can reverse.
2. **Candidate-boundary crossings** `C(t) in boundary(P)`, where the candidate
   enters or leaves the bounded patch.
3. **Projected patch-boundary crossings**: the view ray through `C(t)` meets
   `boundary(P)` at some point, so the projection of `C` crosses the projection
   of the patch boundary. This is the general "the candidate passes behind the
   edge of the occluder" event.
4. **Projected silhouette crossings**: the view ray through `C(t)` is tangent
   to `S` at some point. Equivalently, `pi(C(t))` crosses `pi(silhouette(S))`.
5. **Endpoints and parameter seams** of `C`.
6. **Tangencies and coincidences**, where two of the above merge or where the
   depth difference has an even-order zero.

The first and second are 3D incidences. The third and fourth are naturally 2D
curve intersections of the projected candidate with the projected boundary or
silhouette. A correct algorithm must handle both; splitting only at 3D
crossings misses the projected outline of a bounded patch.

### 1.2 What the current implementation does

`public/lib/educad-project.js`:

- `projectSolid` projects mesh edges to sheet coordinates and computes
  per-edge intervals.
- `edgeIntervals` splits an edge at:
  - intersections with each planar face plane, when the hit is inside the
    projected face region;
  - intersections of the projected edge with projected outer/hole boundary
    edges;
  - projected boundary vertices lying on the edge.
- each interval is classified by `edgeHiddenAt` at its midpoint: cast a ray
  through the midpoint, intersect every non-adjacent planar face, and return
  hidden if any hit lies in front at `t > HIT_EPS`.
- `HIT_EPS` is an absolute `1e-7`.
- `projectGeometry` post-filters "smooth side" mesh edges by comparing the
  facing of the two adjacent side triangles, retaining an edge when the
  facing signs differ or one is edge-on.
- `pointHidden` reuses the same ray test for one point.

This is a correct mesh HLR for planar polygon faces (up to the usual
floating-point containment tolerances). It is **not** an analytic HLR:

- the sphere's "silhouette" is the boundary between front- and back-facing
  triangles, not the exact great circle;
- the cylinder/cone side silhouette is chosen from triangle generators;
- rims are `SAMPLES = 24` chord polylines (`educad-curve-reconstruct.js`);
- `intervals` are parameter intervals on mesh edges, not on analytic curves;
- the method is tied to the display tessellation density;
- there is no perspective path.

Measured on the current worktree with `node tools/edc.js` and
`projectGeometry`:

| Script | View | Current output |
|---|---|---|
| `tools/scripts/sphere.edu` | top | 12 segments, all chords of a mesh silhouette ring |
| `tools/scripts/sphere.edu` | front | 16 segments, all chords |
| `tools/scripts/truncated-cylinder.edu` | top | 48 segments (two 24-gons for the rims) |
| `tools/scripts/truncated-cylinder.edu` | front | 50 segments (24-gon rims plus mesh-selected generators) |

The exact answer for the sphere is one circle in each view. For the truncated
cylinder it is a circle/ellipse per rim plus two exact silhouette generators.

`public/lib/educad-solid.js` is a separate, even coarser path:
`classifyEdges` marks an edge hidden only when every adjacent face turns away
from the viewer. That is a convex-solid dash heuristic for the 3D widget, not
hidden-line removal for a drawing. It must not be used as evidence for an
analytic HLR result.

### 1.3 Why this matters for the reconstruction pipeline

The analytic surface model already records bounded surfaces, shared boundary
objects, source IDs, and display face indices. HLR should consume that same
model, not the display triangles. If it does not:

- the visible/hidden split of a reconstructed circle cannot be expressed as a
  sub-arc of the circle;
- a hidden silhouette of a sphere cannot be distinguished from a display
  artifact;
- the drawing cannot be regenerated at a different scale without changing
  the chord pattern;
- tangent seams (a fillet meeting a plane) cannot be classified as smooth
  rather than sharp;
- the `.edu` assertions can only count mesh edges, so a 24-gon and a true
  circle look different even when the reconstructed geometry is identical.

## 2. Open-source CAD algorithms

### 2.1 Open CASCADE Technology (OCCT 7.9.0)

OCCT is the closest mature open implementation. Its HLR package (`TKHLR`)
contains two algorithms:

- `HLRBRep_Algo`: works on the BRep itself, including the analytic surfaces,
  and is described by OCCT as the "exact" HLR path.
- `HLRBRep_PolyAlgo`: works on a triangulation (`BRepMesh`), is faster, and
  produces polygonal segments.

Both are documented as comparing each edge with each face and calculating the
visible/hidden parts of the edge. They are not shading algorithms. The class
documentation also states two important limits: **superimposed lines are not
eliminated**, and **points are not treated**. `HLRBRep_Algo` can be slow on
complicated shapes. See the OCCT 7.9.0 `HLRBRep_Algo`, `HLRBRep_PolyAlgo`, and
`HLRAlgo` class references in the References section.

#### 2.1.1 Projector

`HLRAlgo_Projector` is constructed either from a viewing coordinate system
(`gp_Ax2`) for an axonometric/orthographic projection, or from that system plus
a focus distance for a perspective projection. It exposes `Perspective()`,
`Focus()`, `Project()`, and the forward/inverse transformation. This is the
single object that both HLR algorithms use to define the view.

#### 2.1.2 Silhouettes / outlines

The exact HLR path does not derive silhouettes from mesh facing. In
`HLRTopoBRep_OutLiner::Fill`, OCCT builds a `Contap_Contour` from either:

- the view direction (orthographic), or
- the eye point (perspective),

and runs it over each face's surface and domain. `Contap_Contour` handles a
plane directly (a plane has no interior contour in a standard view) and
dispatches spheres, cylinders, and cones to `Contap_ContAna`, the analytic
quadric contour package; other surfaces use the general
marching/`Contap_Contour` path. The resulting contour edges are inserted into
an "outlined shape" as internal edges of the face, and the original edges are
split at the outline crossings (`HLRTopoBRep_DSFiller::ProcessEdges`). This is
the key architectural move: **silhouettes are computed as exact surface
contours before hidden-line classification**, and they become ordinary edges
in the data structure.

`Contap_ContAna` documents itself as "the computation of the contours for
quadric surfaces." Its supported cases are sphere, cylinder, and cone, with
both direction (orthographic) and eye (perspective) overloads. This covers the
curved surface family currently modelled by EduCAD; planes are handled by the
caller.

The standard extraction filters show the intended output classes
(`HLRBRep_HLRToShape`):

- visible/hidden sharp edges (C0);
- visible/hidden smooth edges (G1 between two surfaces);
- visible/hidden sewn edges (CN on one surface);
- visible/hidden outline edges ("silhouette");
- visible/hidden isoparametric lines (exact path only).

`HLRBRep_PolyAlgo` has the analogous `HLRBRep_PolyHLRToShape` filters but no
isoparametric output.

#### 2.1.3 Edge intervals and classification

`HLRBRep_Hider::Hide` contains a source-code outline of the exact interval
algorithm:

1. Iterate over edges that are not already hidden and are not rejected by the
   hiding face's min/max box.
2. Reject edges that are above the face, belong to the face, or are rejected
   by a wire min/max box.
3. Compute interferences between the edge and the boundary edges of the face.
4. Store `IN` and `ON` interferences in two sorted lists.
5. Resolve complex transitions and `ON` intersections.
6. If there are no interferences, classify the whole edge against the face:
   hide it if it is inside and under the face.
7. Otherwise build hidden parts, visible parts, boundary parts, and `ON`
   parts from the sorted interference lists.
8. Classify each candidate interval at its midpoint when the transition data
   is ambiguous.

`HLRBRep_EdgeBuilder` turns sorted vertex/interference states into alternating
areas. `HLRBRep_EdgeIList` inserts interferences in edge-parameter order and
resolves multiple interferences at the same geometric locus. The hider then
calls `HLRBRep_EdgeData::Status().Hide(p1, ..., p2, ...)` for each hidden
interval.

OCCT also sorts hiding faces by a priority: plane 10, cylinder 9, cone 8,
sphere 7, torus 6, with penalties for cut/side/outline faces. This is a
performance order for hiding, not a correctness rule. It confirms that
analytic surface type is part of the HLR data model.

#### 2.1.4 Depth and tolerance details

- `HLRBRep_Data` initializes `myToler = 1e-5`; many angular comparisons use
  `myToler * 10`, and `HLRBRep_EdgeIList` uses `TolAng = 1e-4`.
- `HLRBRep_Hider` rejects intervals shorter than `1e-7`.
- Planar-face rejection (`HLRBRep_Surface::IsAbove`) samples up to 30 points
  along a non-line edge; it is a conservative rejection, not a proof.
- `HLRBRep_Curve` uses 30 samples to update min/max boxes for non-line curves.
- Face and edge tolerances come from the BRep, not from a single global
  epsilon.

So OCCT's "exact" result is exact in the sense that it uses the BRep surfaces
and computes contour/interference curves analytically where possible, but it
still relies on tolerances, numeric root finding, and sampling for rejection.
That is the right standard for EduCAD too: analytic geometry, explicit
tolerances, and no hidden tessellation dependency.

#### 2.1.5 Perspective

For perspective, `HLRTopoBRep_OutLiner::Fill` transforms the view direction
and, when `Perspective()` is true, builds `Contap_Contour` from an eye point.
`HLRBRep_Data` uses `myProj.Perspective()` in silhouette orientation and in
`EdgeState`. `HLRBRep_Surface::IsSide` has perspective-specific cases (for
example, a cone is "side" when its apex coincides with the eye). `HLRAlgo`'s
projector handles the projective division.

OCCT therefore treats perspective as a first-class projector, not as a
post-processing scale. The exact silhouette of a sphere/cylinder/cone is still
a conic/generator construction, but the contour is computed in 3D from the eye.

### 2.2 FreeCAD TechDraw

FreeCAD's TechDraw workbench is a mature consumer of OCCT HLR. In FreeCAD
1.0.2, `src/Mod/TechDraw/App/GeometryObject.cpp`:

- `projectShape` creates `HLRBRep_Algo`, adds the source shape, builds
  `HLRAlgo_Projector(viewAxis)` for orthographic or
  `HLRAlgo_Projector(viewAxis, focus)` for perspective, calls `Update()` and
  `Hide()`, then extracts `VCompound`, `HCompound`, `Rg1Line*`, `RgNLine*`,
  `OutLine*`, and `IsoLine*` through `HLRBRep_HLRToShape`.
- `projectShapeWithPolygonAlgo` meshes the input with
  `BRepMesh_IncrementalMesh(inCopy, 0.10)`, uses `HLRBRep_PolyAlgo` and
  `HLRBRep_PolyHLRToShape`, and is the "coarse" path.
- `makeTDGeometry` selects which classes become visible or hidden geometry:
  hard edges and outlines are always considered; smooth, seam, and
  isoparametric lines are controlled by the view's `SmoothVisible`,
  `SmoothHidden`, `SeamVisible`, `SeamHidden`, `IsoVisible`, and `IsoHidden`
  properties.
- `DrawProjectSplit::removeOverlapEdges` can be applied repeatedly according
  to the view's scrub count, and zero/crazy edges are filtered before
  conversion to `BaseGeom`.

`GeometryObject.h` and `DrawViewPart.cpp` expose the corresponding properties:

- `CoarseView` chooses polygon HLR instead of exact HLR;
- `Perspective` and `Focus` choose the projector;
- `SmoothVisible`, `SmoothHidden`, `SeamVisible`, `SeamHidden`, `IsoVisible`,
  `IsoHidden`, `IsoCount`, and `HardHidden` control the extracted classes;
- `ScrubCount` controls overlap cleanup.

The FreeCAD wiki documents `Coarse View` as a polygon approximation that is
"much faster for complex models" with reduced curve quality, and lists the
same HLR parameter group. FreeCAD is therefore a useful confirmation of the
architecture:

1. exact BRep HLR by default;
2. polygon HLR as a fast fallback;
3. explicit visible/hidden class filters;
4. perspective as a projector option;
5. post-processing/cleanup of HLR output.

It is not an independent analytic algorithm; the analytic work is OCCT's.

### 2.3 Analytic quadric and exact-curve literature

Levin's 1976 paper, "A parametric algorithm for drawing pictures of solid
objects composed of quadric surfaces" (CACM 19(10):555-563), is the classic
statement that quadric solids can be drawn from their exact parametric
surfaces instead of polyhedral approximation. It describes a parametric
algorithm for pictures of solids made from patches of quadric surfaces and
handles quartic intersection curves with equations of no more than second
order. It is the right conceptual ancestor for an analytic quadric HLR.

Elber and Cohen's 1990 "Hidden curve removal for free form surfaces"
(SIGGRAPH 24(4):95-104) formalizes the object-space curve approach:

- extract silhouette curves where the surface normal is perpendicular to the
  view;
- extract boundary and discontinuity curves;
- split curves at intersections;
- determine visibility per curve region, using ray/surface tests and
  visibility propagation rather than a polygon mesh.

The paper explicitly targets exact curve representation and surface coherence.
Nishita, Takita, and Nakamae's 1992 "Hidden Curve Elimination of Trimmed
Surfaces Using Bézier Clipping" adds a robust subdivision/clipping method for
trimmed surfaces and silhouette/trimming curves. These are the relevant
references for the event-splitting and curve-curve root isolation parts of a
design; they do not provide a ready-made bounded-quadric HLR module.

A modern reference for the interval view is "Analytic Visibility on the GPU"
(Computer Graphics Forum 30(2), 2013): its edge phase intersects projected
triangles and edges and classifies visible segments from sorted event indices.
It is mesh-based, but it makes the interval/event formulation explicit and is
useful for the classification and ordering logic.

Two classical facts are worth stating because they drive the design:

- **Appel's quantitative invisibility** (1967) counts how many surfaces lie in
  front of a curve point along the view ray. A line drawing needs the count
  transition points, not a per-pixel depth buffer.
- For a quadric, the silhouette is itself a conic/generator construction, and
  the intersection of two quadrics is at most a quartic space curve. An
  analytic implementation must be prepared for quartic root isolation; it
  cannot assume every event is a quadratic.

### 2.4 What the OSS survey implies

This survey did not identify a widely used, standalone, permissively licensed
"analytic HLR for bounded quadrics" library independent of a BRep kernel. The
mature pattern is:

```text
BRep faces
  -> exact contours (silhouette + boundary) from the surface definition
  -> split all candidate edges at contour/edge interferences
  -> sort intervals by edge parameter
  -> classify each interval by a ray/face test
  -> extract visible/hidden/smooth/seam/outline classes
```

OCCT implements that pattern in C++ over a full BRep. EduCAD has the bounded
analytic surfaces but not a BRep kernel, so the sensible design is to
implement the same pattern over the existing `geometry.surfaces` records and
the existing analytic curve vocabulary, with the display mesh retained as a
fallback.

## 3. Comparison matrix

### 3.1 Capability comparison

| Capability | EduCAD `projectGeometry` / `pointHidden` | EduCAD `educad-solid` widget | OCCT `HLRBRep_Algo` | OCCT `HLRBRep_PolyAlgo` | FreeCAD TechDraw exact | FreeCAD TechDraw coarse | Target EduCAD analytic |
|---|---|---|---|---|---|---|---|
| Input | mesh vertices, edges, planar faces/holes | mesh vertices/faces/normals | BRep surfaces | triangulation | BRep via OCCT | meshed BRep | analytic surfaces + analytic curves + line edges |
| Silhouette | adjacent-triangle facing filter | none | exact `Contap_Contour`; analytic quadric contours | triangle-edge silhouette | OCCT exact | OCCT polygon | per-kind analytic formulas + patch clipping |
| Edge splitting | projected face boundaries + face-plane crossings | none | edge/face-edge interferences; outline splits original edges | triangle edges | OCCT | OCCT | projected boundary/silhouette + 3D surface crossings |
| Visibility decision | ray-plane + point-in-projected-polygon at interval midpoint | all adjacent faces back-facing | 3D edge-face interference + classification; sorted intervals | triangle depth | OCCT | OCCT | analytic ray-surface roots + bounded-patch containment |
| Curve output | mesh chords only | mesh edges | exact BRep edges; walking contours approximated to BSpline when needed | polylines | exact/converted | polylines | analytic sub-curves with parameter intervals |
| Hidden lines | yes, mesh intervals | dashed widget edges only | yes | yes | yes | yes | yes, exact intervals |
| Smooth/seam/outline classes | only crude smooth-side filter | none | sharp, smooth, sewn, outline, iso | sharp, smooth, sewn, outline | filters exposed | filters exposed | role field: sharp, outline, smooth, seam, boundary, iso |
| Perspective | no | orbit orthographic | yes | yes | yes | yes | planned, same interval engine |
| Tolerance | absolute `HIT_EPS=1e-7`, `1e-9` 2D epsilons | none | BRep tolerances; `1e-5`, `1e-7`, `1e-4` angular | mesh deflection | OCCT + cleanup | mesh deflection | scale-relative, explicit per result |
| Superimposed-line removal | no | no | no (documented limit) | no | scrub cleanup | scrub cleanup | dedupe by projected overlap; report |
| Cost | O(E·F) plus per-interval ray tests | O(E) | high; face-priority sorting | medium | high | medium | event-driven with AABB culling |
| Certification | mesh surface validation | none | numeric | mesh | numeric | mesh | analytic curve identity + numeric residual |

### 3.2 Behavioral comparison on the same shapes

| Shape | Current EduCAD | OCCT exact | Target EduCAD |
|---|---|---|---|
| Box / plate with hole | exact planar intervals (mesh = geometry) | exact | unchanged; keep mesh fast path |
| Vertical cylinder, plan | two 24-gon rims | two circles (visible/hidden) | two analytic circles |
| Vertical cylinder, front | 24-gon rims + mesh-selected generators | two exact generators + exact rims | two analytic lines + analytic circle/ellipse rims |
| Truncated cylinder | 24-gon top rim, mesh generators | exact ellipse, exact generators | exact ellipse + generators clipped at rims |
| Cone, front | 24-gon base + mesh generators | exact base curve + exact generators | exact base curve + generator lines |
| Sphere, top/front (measured) | 12-16 chord silhouette ring | exact silhouette circle | exact visible silhouette circle; hidden arc if occluded |
| Spherical/cylindrical recess | tessellated cavity; surrounding face not subtracted | exact surfaces, but still no Boolean subtraction | exact HLR only where surfaces exist; do not fake subtraction |
| Fillet | shared lines exist but HLR has no tangent/smooth role | smooth/outline classes | shared generator deduped; role smooth/tangent, not sharp |

The last two rows are important: **HLR does not repair a missing Boolean or
material-side operation**. A cylindrical recess whose surrounding plate face
still covers the mouth will still be occluded in HLR. HLR answers "what is in
front of what", not "what material should have been removed". The report
therefore separates HLR from any future Boolean/subtraction work.

## 4. Recommended design for EduCAD

### 4.1 Layers and module boundary

Keep the current mesh projector as a stable backend and add an analytic
backend beside it:

```text
public/lib/educad-project.js       existing mesh HLR; unchanged behavior
public/lib/educad-hlr.js           new analytic scene, silhouettes, events,
                                   ray tests, interval classification
public/lib/educad-surfaces.js      existing bounded-surface model; add
                                   surfaceContainsPoint and surfaceRayHits
public/lib/educad-curve-reconstruct.js
                                   existing analytic curve records
tools/edc.js                       add # hlr-query / HLR properties
```

Do not rewrite `projectSolid` in the first milestone. The existing mesh path is
the fallback and the regression baseline.

Recommended public entry point:

```js
HLR.project(geometry, view, options) -> {
  contract: 'hlr-projection-v1',
  view: { kind, direction, right, up, eye, focus, scale },
  curves: [ ... ],
  diagnostics: [ ... ]
}
```

`geometry` is the existing reconstructed geometry (`vertices`, `edges`,
`faces`, `curves`, `surfaces`, `surfaceModel`). `view` accepts the existing
`front`/`top`/`left`/`right` names or an explicit view record. `options`:

```js
{
  mode: 'analytic' | 'mesh' | 'auto',   // default 'auto'
  includeHidden: true,
  includeSmooth: false,
  includeSeam: false,
  includeIso: false,
  tolerance: { length, angle, parameter, depth },
  maxSubdivisions: 64
}
```

`mode: 'auto'` uses analytic HLR when every candidate surface and curve is in
the supported set and no event solver reports ambiguity; otherwise it returns
a mesh result with `evidence.method: 'mesh-fallback'` and a diagnostic. It must
never silently mix mesh visibility with analytic curve output.

### 4.2 Silhouette curves per surface kind

Silhouettes are computed once per surface per view, not per candidate edge.
Let `D` be the unit view direction (orthographic) and `E` the eye
(perspective). Let `N(p)` be a surface normal.

#### Plane

No interior silhouette. The patch boundary loops are the projected contour.
A plane seen edge-on has zero projected area and cannot hide anything except
its boundary; do not treat its interior as an occluder.

#### Sphere

Orthographic:

```text
N(p) = (p - C) / R
N(p) . D = 0
=> circle in the plane through C with normal D, radius R
```

Perspective (`d = |E - C|`):

```text
(p - E) . (p - C) = 0
=> circle centred at C + (R^2 / d^2) (E - C)
   radius R * sqrt(1 - R^2 / d^2)
   plane normal (E - C)
```

If `d <= R` (eye on or inside the sphere), there is no finite silhouette;
treat it as a degenerate view (the eye is on or inside the object) and return
a diagnostic rather than a tiny or imaginary circle. If `d` is barely greater
than `R`, the silhouette is a tiny circle and the radius computation must be
guarded.

For a complete sphere (`loops.length === 0`, `closed: true`), the silhouette is
a full circle. For a spherical cap/recess, intersect that circle with the cap
boundary loop and keep the arcs that lie in the patch. In the orthographic
case, the silhouette circle lies in a plane perpendicular to the view through
the centre, so all of its points have the same depth; in the perspective case
the circle is tilted toward the eye and its points have varying depth. In both
cases it is tangent to the sphere and does not hide itself. If another surface
is in front, the circle is split by the normal occlusion events; do not assume
the whole circle is visible without testing.

#### Cylinder

Orthographic, axis `a`, origin `o`, radius `R`:

```text
D_perp = D - (D . a) a
if |D_perp| <= tau: no side silhouette (view along the axis);
                     the end loops are the contour.
e1 = D_perp / |D_perp|
e2 = a x e1
silhouette generators: o + t a +/- R e2
```

If the view is exactly along the axis, the two generators merge with the cap
rim; return no separate side silhouette and let the boundary loops be the
contour.

Perspective (`p = distance(E, axis)`, `e1 = unit(projection of E onto the
cross-section)`, `e2 = a x e1`):

```text
if p <= R: no finite side silhouette
feet = o_proj + (R^2 / p) e1 +/- R sqrt(1 - R^2 / p^2) e2
silhouette generators: feet + t a
```

Clip each generator against the bounded patch by intersecting it with the
loop curves/edges and keeping the axial intervals inside the patch.

#### Cone

Orthographic or perspective, with apex `A` and axis `a`. A cone generator in
direction `g(theta)` has a normal `N(theta)` perpendicular to the generator and
to the tangent of the base circle. The silhouette is the set of `theta` with:

```text
N(theta) . D = 0          (orthographic)
N(theta) . (E - A) = 0    (perspective)
```

This reduces to a trigonometric equation of the form

```text
A cos(theta) + B sin(theta) = C
```

with zero, one, or two solutions. Each solution is a generator line through the
apex; clip it against the patch (base loop, truncation loop, or apex). A
tangent solution (one double root) must be marked `tangent`; it is a single
line, not a pair. If the view is along the axis, there is no side silhouette
and the end loops (or the apex) define the contour. If the eye is at the apex
or the projection degenerates (zero-length generator direction, undefined
surface normal), return a diagnostic rather than dividing by zero.

The exact trigonometric coefficients are implementation details; OCCT's
`Contap_ContAna` is a reference for the cylinder/cone/sphere direction and eye
cases. EduCAD should encode the same geometric conditions, not copy the code.

#### General clipping rule

A raw silhouette curve is intersected with the surface's loops:

- generator lines: intersect with circle/ellipse/arc/line boundary elements;
- sphere silhouette circle: intersect with boundary arcs/lines;
- keep the parameter intervals whose midpoint is inside the bounded patch;
- split at intersection points and at parameter seams;
- if the silhouette coincides with a boundary element, return the boundary
  identity instead of a duplicate silhouette.

Silhouette records:

```js
{
  kind: 'line' | 'circle' | 'ellipse' | 'arc',
  surfaceId,
  role: 'outline',
  geometry: { ... same analytic curve vocabulary ... },
  t0, t1,
  sourceIds
}
```

### 4.3 Candidate set and event splitting

Candidate curves for a view:

1. model edges (straight segments);
2. analytic boundary curves and section arcs referenced by surface loops;
3. silhouette curves from section 4.2;
4. optionally smooth/seam curves if the view requests them;
5. optionally isoparametric curves (not in the first milestone).

A candidate has a normalized parameter `t` on `[0,1]` for every curve kind.
For a circle/ellipse/arc, `t` maps to the existing `startAngle + sweepAngle*t`;
for a line, `t` maps to `start + t*(end-start)`.

For each candidate `C` and each surface `S`, collect event parameters:

#### A. 3D curve-surface crossings

Solve `F_S(C(t)) = 0` where `F_S` is the implicit support surface:

```text
plane:     n . (p - o) = 0
sphere:    |p - C_s|^2 - R^2 = 0
cylinder:  |(p - o) x a|^2 - R^2 = 0
cone:      ((p - A) . a)^2 - cos^2(alpha) |p - A|^2 = 0
```

The cone form is the double cone; bounded-patch containment selects the
modelled nappe. For a line candidate these are linear/quadratic. For a circle/ellipse
candidate in a plane, substitute the parametric curve and reduce to a
trigonometric quadratic or a low-degree polynomial; for a general conic or a
NURBS, use interval subdivision. Keep only roots whose point is inside the
bounded patch.

#### B. Candidate on the patch boundary

Solve `C(t) in boundary(P)`. This is needed when the candidate lies on the
surface and `F_S(C(t)) = 0` is identically zero. Use the loop element
equations (circle/ellipse/arc/line) and keep intersections with the correct
loop. This is a 3D curve-curve problem; for coplanar elements it reduces to a
2D conic/line problem.

#### C. Projected patch-boundary crossings

Project `C` and each boundary loop to 2D and solve

```text
pi(C(t)) in pi(boundary(P))
```

This is the event where the candidate passes behind the *edge* of the
occluding patch even though it never crosses the support surface. For a line
candidate and a circular/elliptical boundary, this is a line-conic
intersection. For a circle/ellipse candidate and a conic boundary, it is a
conic-conic intersection (up to quartic). For a general curve, use Bézier
clipping or interval subdivision.

#### D. Projected silhouette crossings

Project the surface silhouette from section 4.2 and solve

```text
pi(C(t)) in pi(silhouette(S))
```

Equivalently, for a point `p = C(t)`, the view ray through `p` is tangent to
`S`. For an orthographic line candidate and a sphere, this is the condition

```text
distance(C_s, line(p, D)) = R
```

which is quadratic in `t` after projection. For a cylinder/cone it reduces to
a distance-to-axis / generator condition. For a general curve, use the projected
2D intersection.

#### E. Endpoints, seams, and tangencies

Always include `t = 0`, `t = 1`, the curve's `startAngle` seam, and the
endpoints of every sub-arc. Include roots with even multiplicity (tangency)
even when there is no sign change. A tangency root that does not change the
visibility state must not create a zero-length visible/hidden pair.

After collecting events:

1. sort ascending;
2. merge values within a parameter tolerance;
3. split into open intervals `(t_i, t_{i+1})`;
4. drop intervals shorter than the parameter tolerance;
5. classify each interval at its midpoint;
6. merge adjacent intervals with identical visibility and role;
7. keep the event list as evidence on the output.

The midpoint classification is deliberate: it avoids relying on the transition
orientation at a root, which is where numerical errors concentrate. The roots
are used only to locate the boundaries. This is the same robust pattern used by
OCCT's hider when transition data is ambiguous.

### 4.4 Occlusion by bounded surfaces

For an interval midpoint `p = C(t_mid)`, cast the view ray:

```text
orthographic:  R(lambda) = p + lambda * D,  lambda in (-inf, +inf)
perspective:   R(lambda) = E + lambda * (p - E), lambda in [0, 1]
```

Use a signed depth along the ray so that larger depth is closer to the viewer
for orthographic and smaller `lambda` is closer for perspective. A simple
choice is to compare the ray parameter of the candidate point with each hit:

- orthographic: candidate depth `p.D`; hit depth `h.D`; hidden if
  `h.D > p.D + depthTol`.
- perspective: candidate `lambda = 1`; hit `lambda_h`; hidden if
  `lambda_h < 1 - depthTol / |p - E|`.

For each surface `S`, intersect the ray with the support surface:

```text
plane:     one root (denominator guarded)
sphere:    quadratic in lambda
cylinder:  quadratic in lambda
cone:      quadratic in lambda
```

Keep roots for which the hit point is inside the bounded patch `P`. For a
closed surface with no loops (the complete-sphere case), every root is inside.
For a plane with holes, use point-in-patch with holes. For a
cylinder/cone/sphere patch, use a parameter-domain containment test, not a
sample of the display mesh.

The candidate is hidden if any non-coincident hit lies strictly in front of
it. For deterministic output, record the nearest occluder and its source
surface ID.

**Own-surface handling.** Do not skip the surface that owns the candidate
unconditionally. A point on the back of a sphere is hidden by the front of the
same sphere. Instead, compare depths: a hit at the same depth as the candidate
(within `depthTol`) is the candidate itself and does not hide it; a hit
strictly in front does. This single rule handles:

- a boundary edge shared by two faces (both hits at the candidate depth);
- a silhouette curve tangent to its own surface (the tangent hit is at the
  candidate depth, so it does not hide itself);
- a non-silhouette point on the back of a sphere (the front of the same sphere
  is a legitimate closer hit);
- a concave crease (a neighboring face can legitimately lie in front);
- a tangent fillet seam (both surfaces at the same depth).

For a candidate that is a boundary element shared by two surfaces, use the
incidence graph (`Surfaces.incidence`) to know the owners and to preserve the
boundary identity. Depth comparison still decides whether a third surface
hides it.

**Bounded-patch containment.** This is the hardest missing primitive. The
current `Surfaces.split` has only narrow tests: a sphere cap half-space or a
cylinder/cone generator station interval. HLR needs a general
`surfaceContainsPoint(surface, point)`:

- plane: project to the plane frame, even-odd/winding test against outer and
  inner loops; analytic curve boundaries can be tested by their implicit
  equations plus parameter range, not by chord sampling;
- cylinder: map to `(theta, z)` and test the loop in the unwrapped parameter
  domain, handling the seam;
- cone: map to `(theta, s)` where `s` is the axial/generator station, and test
  the loop;
- sphere: map to `(theta, phi)` or use the cap half-space when cap metadata is
  present; general spherical loops use the parameter domain.

For the first milestone, support the common bounded patches (plane loops with
holes, cylinder band, cone frustum, sphere cap) and refuse/fallback for a
general curved patch with self-intersecting or nested loops. Refusal must be a
diagnostic, not a silent sample.

### 4.5 Visibility role classification

Each output interval should carry a role, not only visible/hidden:

```text
sharp    C0 edge between two surfaces
outline  silhouette of a smooth surface (view-dependent)
smooth   G1 edge between two surfaces
seam     CN seam on one surface
boundary patch boundary that is not a sharp crease
iso      isoparametric line (optional)
```

This mirrors OCCT's extraction classes and FreeCAD's smooth/seam filters. It
also prevents a tangent fillet seam from being drawn as a heavy sharp outline
and lets the renderer choose dash style, thin tangent ink, or omission.

Role inference:

- a boundary element used by two surfaces with a genuine C0 crease is `sharp`;
- a boundary element shared by two tangent surfaces is `smooth`/`seam`;
- a silhouette generated by section 4.2 is `outline`;
- an unshared boundary is `boundary`;
- an isoparametric line is `iso`.

Tangency can be checked analytically at sampled stations on the shared
boundary (surface normals parallel within an angular tolerance) or supplied as
explicit metadata by the inference stage. If the check is uncertain, report
`hlr-tangent-ambiguous` and default to `sharp` rather than silently dropping a
line.

### 4.6 Coincident, tangent, and degenerate cases

**Coincident boundaries.** Two loops may reference the same curve/line object.
Treat that as one boundary element by identity, not by coordinate equality.
The output should contain one stroke, not two. If two different boundary
objects coincide geometrically, detect with a distance check and emit
`hlr-superimposed`; do not let both occlude each other.

**Coincident surfaces.** Coplanar faces, a cap and a closure plane, or two
patches of the same support surface can produce hits at identical depth.
Tie-break deterministically by surface ID after applying `depthTol`; a
coincident hit is not an occluder. Emit `hlr-coincident-surface` if the overlap
is not explicitly declared by shared boundary incidence.

**Tangency.** A tangent event is a double root. Include it in the event list,
classify both sides, and merge if the state is the same. If the state differs
only within the tangent tolerance, prefer the state away from the tangency and
report `hlr-tangent-ambiguous`. A tangent contact along an interval (two
cylinders touching along a generator) is a coincident case, not a hidden
interval: classify it as visible/tangent and do not dash it as hidden.

**Edge-on surfaces.** A plane whose normal is perpendicular to the view has
zero projected area. Its interior cannot hide anything; only its boundary
curves can. A cylinder viewed along its axis has no side silhouette; its end
loops are the contour. A cone viewed along its axis has only its base loop.
A sphere with the eye inside has no finite silhouette. Guard every formula
with a degeneracy predicate and a diagnostic.

**Self-intersecting or open patches.** The current model permits open surfaces
and inferred patches. HLR should treat every bounded patch as an opaque
barrier on both sides (the current mesh projector already does this). Do not
require a closed shell. If a patch's containment is ambiguous, fall back to
the mesh for that surface and report it.

**Material side.** HLR as specified here does not need a globally consistent
outward normal: ray/surface hits and depth comparison decide visibility.
Normals are needed for silhouettes and tangency/role classification. Missing
orientation should therefore produce a role diagnostic, not a wrong hidden
line. This is important because `Surfaces.build` does not currently store a
global `outward` flag for every surface.

### 4.7 Output contract

Each output record should preserve both 3D geometry and its projected span:

```js
{
  id: 'hlr:<n>',
  sourceIds: [ ... ],
  sourceKind: 'edge' | 'curve' | 'silhouette',
  role: 'sharp' | 'outline' | 'smooth' | 'seam' | 'boundary' | 'iso',
  visible: true | false,
  geometry: {
    kind: 'line' | 'circle' | 'ellipse' | 'arc' | 'conic',
    // the same fields the model already uses
    center, u, v, radiusU, radiusV, startAngle, sweepAngle,
    start, end
  },
  t0, t1,           // normalized parameter on the parent curve
  parameter: 'normalized',
  projected: {      // optional precomputed 2D endpoint/control data
    kind: 'line' | 'conic' | 'polyline'
  },
  evidence: {
    method: 'analytic-root' | 'interval-subdivision' | 'mesh-fallback',
    occluders: [surfaceId],
    events: [t],
    tangent: false,
    residual: number,
    tolerance: number
  }
}
```

The output is an interval list, not a set of screen-space line segments.
Rendering can flatten each analytic interval adaptively. This is what lets the
same result be exported at any scale without a chord pattern.

Diagnostics should include:

```text
hlr-unsupported-surface
hlr-unsupported-curve
hlr-unresolved-event
hlr-tangent-ambiguous
hlr-coincident-surface
hlr-superimposed
hlr-patch-containment-ambiguous
hlr-perspective-clipped
hlr-mesh-fallback
```

### 4.8 What stays mesh-based

Keep the mesh path for:

- the live 3D widget and its dashed hidden edges (`educad-solid.js`);
- the pose-mode overlay (`projectGeometry`);
- fast previews and large scenes;
- arbitrary/unsupported surfaces (torus, NURBS, offset, general conic
  intersections that cannot be isolated);
- point visibility used only to choose between ambiguous reconstructed curve
  candidates (`pointHidden`), clearly tagged as mesh evidence;
- display tessellation and rendering;
- the triangle certificate (`surfaceValidation`), which is separate from HLR.

Do not keep mesh-based visibility as the source of truth for:

- analytic boundary curves;
- silhouette curves;
- exact visible/hidden interval endpoints;
- dashed hidden lines in an engineering drawing;
- any `.edu` assertion about a circle/ellipse/arc's visible span.

The mesh path remains a valid **fallback result**, but its output must be
labelled `mesh-fallback` and must not be mixed with analytic curve records.

### 4.9 Recommended migration order

1. Add `HLR.project` with silhouettes and ray tests, but initially support only
   orthographic views and the existing surface/curve families.
2. Add event splitting for line candidates against plane/cylinder/cone/sphere
   and for circle/ellipse/arc boundary curves against the same surfaces.
3. Add tangent/coincident/role handling and output filters.
4. Add perspective.
5. Add general conic and NURBS fallback (adaptive subdivision, no claim of
   exactness).
6. Only then consider replacing the mesh preview path or the widget's
   dashed-edge heuristic.

## 5. Pseudocode and API sketch

The following is intentionally implementation-neutral; it is not production
code and does not copy any external source.

### 5.1 Scene and view

```js
function buildScene(geometry, view) {
  const surfaces = geometry.surfaces || [];
  const curves = collectCandidateCurves(geometry); // edges + loop curves
  const sil = [];
  for (const s of surfaces) {
    sil.push(...silhouettesFor(s, view)); // section 4.2
  }
  return { surfaces, candidates: curves.concat(sil), view };
}
```

### 5.2 Silhouettes

```js
function silhouettesFor(surface, view) {
  if (surface.kind === 'plane') return [];

  if (surface.kind === 'sphere') {
    const circle = sphereSilhouette(surface, view);
    return clipToPatch(circle, surface, view);
  }

  if (surface.kind === 'cylinder') {
    const lines = cylinderSilhouette(surface, view);
    return clipToPatch(lines, surface, view);
  }

  if (surface.kind === 'cone') {
    const lines = coneSilhouette(surface, view);
    return clipToPatch(lines, surface, view);
  }

  return []; // unsupported surface; caller falls back to mesh
}
```

### 5.3 Events and intervals

```js
function intervalsFor(candidate, scene) {
  const events = [0, 1];
  for (const surface of scene.surfaces) {
    if (!bboxOverlaps(candidate, surface, scene.view)) continue;

    events.push(...curveSurfaceEvents(candidate, surface));
    events.push(...candidateBoundaryEvents(candidate, surface));
    events.push(...projectedBoundaryEvents(candidate, surface, scene.view));
    events.push(...projectedSilhouetteEvents(candidate, surface, scene.view));
  }

  const ts = mergeSorted(events, parameterTolerance(candidate));
  const raw = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const t0 = ts[i], t1 = ts[i + 1];
    if (t1 - t0 <= parameterTolerance(candidate)) continue;
    const tm = 0.5 * (t0 + t1);
    const hit = nearestOccluder(candidate.point(tm), scene);
    raw.push({
      t0, t1,
      visible: !hit || hit.coincident,
      occluders: hit ? [hit.surfaceId] : [],
      tangent: hit ? hit.tangent : false
    });
  }
  return mergeAdjacent(raw);
}
```

### 5.4 Occluder ray test

```js
function nearestOccluder(p, scene) {
  const ray = scene.view.rayThrough(p);
  let best = null;
  for (const surface of scene.surfaces) {
    for (const hit of surfaceRayHits(surface, ray)) {
      if (!surfaceContainsPoint(surface, hit.point)) continue;
      if (hit.kind === 'coincident') {
        if (!best) best = {surfaceId: surface.id, coincident: true};
        continue;
      }
      if (hit.inFrontOf(p) && (!best || hit.closerThan(best))) {
        best = {surfaceId: surface.id, coincident: false, tangent: hit.tangent};
      }
    }
  }
  return best;
}
```

### 5.5 `.edu` query surface

Extend `tools/edc.js` in the same style as `# surface-query`:

```text
# hlr-query: {"view":"front","mode":"analytic","expect":{"curves":[{"role":"outline","geometry":{"kind":"line"}}],"diagnostics":[]}}

# hlr-query: {"view":{"kind":"perspective","eye":{"x":0,"y":0,"z":400},"target":{"x":20,"y":30,"z":30},"up":{"x":0,"y":1,"z":0},"focus":400},"expect":{"curves":[{"role":"outline","geometry":{"kind":"circle"}}]}}
```

Useful aggregate properties for `# expect:` lines:

```text
hlrCurves         total output intervals
hlrVisible        visible intervals
hlrHidden         hidden intervals
hlrOutlines       generated silhouette intervals
hlrKinds          sorted unique output curve kinds (circle,ellipse,arc,line)
hlrSplits         candidates with more than one interval
hlrDiagnostics    sorted unique diagnostic codes
hlrMode           analytic | mesh-fallback
```

Keep `topHidden`, `frontHidden`, and `splitHidden` as mesh-regression
properties. They remain useful for the planar test suite and for comparing the
two backends, but they are not the target HLR contract.

## 6. `.edu` test plan

### 6.1 Regression baseline

Run all existing drawing scripts, with emphasis on:

- `tools/scripts/hidden-box.edu` (closed planar box);
- `tools/scripts/plate-occlusion.edu` (edge behind a plate);
- `tools/scripts/partial-hidden-edge.edu` (visible-hidden-visible split);
- `tools/scripts/hole-visibility.edu` (hole in a plate);
- `tools/scripts/sphere.edu`;
- `tools/scripts/truncated-cylinder.edu`;
- `tools/scripts/cone.edu`;
- `tools/scripts/cylindrical-recess.edu`;
- `tools/scripts/spherical-recess.edu`;
- `tools/scripts/fillet-line-boundary.edu`.

The existing expectations must not change when the analytic backend is added.
The mesh backend stays available under `mode:"mesh"` for exact regression.

### 6.2 New exact HLR scripts

| Script | View | Assertion |
|---|---|---|
| `hlr-sphere.edu` | top | one visible `circle`, radius 20, centre (20, -30); no chord ring |
| `hlr-sphere.edu` | front | one visible `circle`, radius 20, centre (20, 30) |
| `hlr-cylinder-plan.edu` | top | exact rim circle(s); no side silhouette; visible/hidden rim classification |
| `hlr-cylinder-front.edu` | front | two exact `line` generators at the silhouette stations; exact rim curves; `hlrOutlines=2` |
| `hlr-cylinder-oblique.edu` | front | silhouette generators at the analytic oblique stations, clipped at the end ellipses |
| `hlr-truncated-cylinder.edu` | front | exact inclined ellipse + two generators; no 24-gon top rim |
| `hlr-cone-front.edu` | front | two exact generator lines through the apex; exact base curve |
| `hlr-cone-oblique.edu` | front | generator pair matches the analytic cone silhouette; tangent case if applicable |
| `hlr-partial-edge.edu` | top | line over plate: intervals split exactly at plate boundary; `hlrSplits=1`; visible-hidden-visible |
| `hlr-depth-order.edu` | top | two occluders: only the nearest one is reported as the occluder |
| `hlr-tangent-fillet.edu` | front | shared fillet generator is a `smooth`/`tangent` role, not a duplicate sharp stroke; no zero-length hidden interval |
| `hlr-coincident-faces.edu` | top | two coplanar faces produce one stroke and `hlr-superimposed` or a declared shared boundary, not two |
| `hlr-edge-on-plane.edu` | front | edge-on plate interior does not hide; only its boundary does |
| `hlr-perspective-sphere.edu` | perspective | silhouette is the perspective circle from section 4.2, not a scaled orthographic circle |
| `hlr-perspective-box.edu` | perspective | straight edges remain lines and meet at the expected vanishing geometry |

### 6.3 Assertions that distinguish analytic from mesh

Do not assert only counts. For every exact-curve test, assert:

- `geometry.kind` (`circle`, `ellipse`, `arc`, `line`);
- `center`, `u`, `v`, `radiusU`, `radiusV`, `startAngle`, `sweepAngle`
  within numeric tolerance;
- the interval endpoints `t0/t1` within the root tolerance;
- the role (`outline`, `sharp`, `smooth`, `seam`, `boundary`);
- the visibility and the occluder surface ID where applicable;
- `hlrMode=analytic` and `hlrDiagnostics=none`.

For split tests, assert the interval sequence, not just the number of pieces:
for example `visible [0, 0.3125]`, `hidden [0.3125, 0.6875]`,
`visible [0.6875, 1]` with endpoints at the plate boundary.

For perspective tests, assert the conic parameters or at least the projected
endpoints and the silhouette circle radius; do not accept an orthographic
result with a different center.

### 6.4 Acceptance for the first milestone

- All 151 existing scripts still pass unchanged.
- `hidden-box`, `plate-occlusion`, `partial-hidden-edge`, and
  `hole-visibility` still pass with `mode:"mesh"` and with the default
  `mode:"auto"` (planar-only scenes may use the mesh fast path).
- `hlr-sphere`, `hlr-cylinder-plan`, `hlr-cylinder-front`, and
  `hlr-truncated-cylinder` pass with `hlrMode=analytic`, `hlrDiagnostics=none`,
  and exact curve identities.
- A line over a plate splits at the plate boundary within `1e-6` parameter
  tolerance and does not produce a zero-length hidden sliver.
- A tangent fillet generator is not duplicated and is not classified as a
  sharp edge.
- The analytic path does not consult `geometry.faces` for visibility; it may
  consult them only for a declared fallback or for a mesh comparison result.

## 7. Performance and numerical robustness

### 7.1 Performance

The analytic path should be event-driven, not tessellation-driven:

- **Per view:** build silhouettes once per surface. Cost is O(number of
  surfaces), independent of the candidate count.
- **Broad phase:** view-space AABBs for surfaces and candidates. Reject a
  candidate/surface pair when the projected boxes do not overlap or the depth
  ranges are disjoint. OCCT uses encoded min/max boxes for the same reason;
  EduCAD can use a simple AABB first.
- **Narrow phase:** ray-surface roots are constant-time for plane/cylinder/
  cone/sphere. A candidate has a small number of events, typically 0-8 per
  surface.
- **Output size:** O(total visible/hidden intervals), not O(tessellation).
  A sphere silhouette is one interval, not 12-96 chords.
- **Worst case:** naive O(C·S) pairs. For educational drawings (a few dozen
  surfaces) this is fine. If the model grows, add a uniform grid/BVH over
  projected surface bounds; do not optimize before the event model is correct.
- **Caching:** key silhouette and event results by
  `(surfaceId, curveId, viewSignature)`. A view signature includes the
  projector kind, direction/eye, and focus. The pose overlay changes the view
  every frame; use the mesh path there.
- **Display:** flatten each analytic interval adaptively only at draw/export
  time. Keep the analytic record; do not bake a fixed chord count into the
  HLR result.

The current mesh path is O(E·F) with a midpoint ray test per interval and a
boundary scan per face. The analytic path should be cheaper for curved scenes
because it removes the tessellation multiplier, even though each pair does
more algebra.

### 7.2 Numerical robustness

- **Normalize the model.** Compute a scene diagonal `L`; express depth,
  distance, and coincidence tolerances as `relative * L`. Avoid the current
  absolute `HIT_EPS = 1e-7` for scenes whose units or scale vary.
- **Stable quadratic roots.** Use the cancellation-resistant form
  `q = -0.5 * (b + sign(b) * sqrt(disc))`, roots `q/a` and `c/q`, rather than
  the naive two-root formula. Guard `a ~ 0` (ray parallel to the surface's
  quadratic term) and `disc < 0`.
- **Discriminant tolerance.** `disc` near zero is a tangency. Treat it as a
  double root, not two nearly equal roots that create a spurious tiny
  interval. If the neighboring interval states disagree, report
  `hlr-tangent-ambiguous` instead of guessing.
- **Parameter seams.** Split circles/ellipses at their `startAngle` and at
  `startAngle + 2*pi`; merge the first and last intervals when they are the
  same visibility. Keep a canonical parameter origin for stable output.
- **Projection degeneracies.** Guard `q.D` near zero in perspective, points
  behind the eye, and a focus distance near the eye plane. Clip to a near
  plane and report `hlr-perspective-clipped`; never emit an infinite segment.
- **Patch containment.** Use the analytic loop equations, not sampled
  chords. If containment cannot be decided for a general patch, return
  `hlr-patch-containment-ambiguous` and fall back to mesh for that surface.
- **Coincidence.** Use inclusive depth comparison: a hit at the same depth is
  not an occluder. Use `depthTol` proportional to the local surface size, not
  a global epsilon. When two surfaces are coincident over a patch, dedupe and
  report.
- **Tangency and role.** Tangency checks should use an angular tolerance on
  normals and a distance tolerance on the shared boundary. Do not decide
  "smooth" from the display triangle normals.
- **Root isolation for conics.** For line/conic and conic/conic
  intersections, bracket roots by sign changes on a parameter interval; for
  even multiplicity, use derivative roots or Bézier clipping. Do not sample
  the candidate at a fixed 24 stations and call the result exact.
- **Residuals.** Every analytic interval should carry the root residual or
  the subdivision width. A result with an unresolved event is `partial`, not
  silently visible.
- **Determinism.** Sort surfaces by stable ID, events by parameter, and
  intervals by source order. Coincident-depth ties use surface ID. This makes
  `.edu` assertions reproducible.

### 7.3 Relationship to the analytic certificate

HLR does not certify that an inferred cylinder radius, cone apex, or sphere
center is correct. It certifies only the visibility classification of the
curves against the stored surfaces, within tolerance. Keep the existing
`Surfaces.certify` checks separate. If HLR encounters an invalid surface or an
unbounded patch, return a diagnostic and use the mesh fallback; do not
"repair" the surface as part of projection.

## 8. Ranked recommendation

### Rank 1 (recommended): analytic silhouette + interval HLR on the bounded surface model

Implement the event-based analytic HLR described above over
`geometry.surfaces` and the existing analytic curve records. Keep the current
mesh projector as the preview/fallback backend.

Why first:

- it fixes the visible defect (sphere ring, cylinder/cone generators, chorded
  rims);
- it uses the surface model the project already has;
- it preserves curve identity for drawing/export;
- it creates the interval representation needed for exact hidden-line output;
- it is compatible with the existing `.edu` pipeline and surface certificate.

Cost: medium. The hard parts are patch containment and conic event roots, not
the ray tests.

### Rank 2: analytic silhouettes only, keep mesh occlusion

Generate exact silhouette curves and exact boundary curves, but classify them
against the existing mesh faces. This is a smaller change and immediately
improves sphere/cylinder/cone outlines. It still leaves chorded occlusion
boundaries and cannot produce exact interval endpoints on curved occluders.
Use it only as a stepping stone if Rank 1 must be split.

Why second: high visual payoff, low risk, but incomplete as an HLR contract.

### Rank 3: harden the mesh path as the explicit fallback

Add scale-relative tolerances, better coincidence handling, and output
`mesh-fallback` evidence to the current `projectGeometry`. This is valuable
regardless of Rank 1 because it keeps previews and unsupported scenes
trustworthy. It does not solve analytic exactness.

Why third: necessary safety net, not the target capability.

### Rank 4: pure mesh HLR or an OCCT dependency

Pure mesh HLR is the status quo and is not sufficient for analytic drawings.
Adding OCCT or another BRep kernel is a large dependency and does not fit the
project's zero-npm-dependency, small educational codebase. Do not take this
route unless the product scope changes to arbitrary BRep import.

### Minimal first milestone

**Scope:** orthographic views only; plane, cylinder, cone, and sphere
surfaces; straight edges and existing circle/ellipse/arc boundary curves;
analytic silhouettes and analytic ray tests; patch containment for the common
bounded patches; mesh fallback for everything else.

**Deliverables:**

1. `public/lib/educad-hlr.js` with `HLR.project`, `silhouettesFor`,
   `nearestOccluder`, and interval output.
2. `surfaceContainsPoint` and `surfaceRayHits` helpers for plane, cylinder,
   cone, and sphere in `educad-surfaces.js` (or a companion module).
3. `# hlr-query` in `tools/edc.js` plus `hlrCurves`, `hlrVisible`,
   `hlrHidden`, `hlrOutlines`, `hlrKinds`, and `hlrDiagnostics` properties.
4. New scripts: `hlr-sphere.edu`, `hlr-cylinder-plan.edu`,
   `hlr-cylinder-front.edu`, `hlr-truncated-cylinder.edu`,
   `hlr-cone-front.edu`, `hlr-partial-edge.edu`, `hlr-tangent-fillet.edu`.
5. A one-line comparison mode that runs both backends and reports where the
   mesh result differs from the analytic result, without making the mesh
   result authoritative.

**Acceptance:**

- all existing 151 scripts pass;
- the sphere view returns one exact circle, not 12/16 chords;
- the cylinder front view returns two exact generators plus exact rim curves;
- the truncated cylinder returns an exact inclined ellipse and clipped
  generators;
- a line over a plate splits at the plate boundary within tolerance;
- a tangent fillet generator is deduped and classified smooth/tangent;
- no analytic result is produced from `geometry.faces` visibility;
- `hlrDiagnostics=none` for the supported test scenes.

**Explicitly out of scope for the milestone:** perspective, general conics,
NURBS, tori, Boolean subtraction, material-side repair, variable-radius
fillets, and arbitrary non-manifold topology.

## References

URLs below were checked on 2026-11-11. Publisher DOI links may return a
browser challenge even when the DOI resolves normally.

### Open CASCADE Technology 7.9.0

- OCCT 7.9.0, `HLRBRep_Algo` class reference:
  https://dev.opencascade.org/doc/occt-7.9.0/refman/html/class_h_l_r_b_rep___algo.html
- OCCT 7.9.0, `HLRBRep_PolyAlgo` class reference:
  https://dev.opencascade.org/doc/occt-7.9.0/refman/html/class_h_l_r_b_rep___poly_algo.html
- OCCT 7.9.0, `HLRBRep_HLRToShape` class reference:
  https://dev.opencascade.org/doc/occt-7.9.0/refman/html/class_h_l_r_b_rep___h_l_r_to_shape.html
- OCCT 7.9.0, `HLRAlgo_Projector` class reference:
  https://dev.opencascade.org/doc/occt-7.9.0/refman/html/class_h_l_r_algo___projector.html
- OCCT 7.9.0, `Contap_ContAna` class reference:
  https://dev.opencascade.org/doc/occt-7.9.0/refman/html/class_contap___cont_ana.html
- OCCT 7.9.0, `HLRAlgo` class reference:
  https://dev.opencascade.org/doc/occt-7.9.0/refman/html/class_h_l_r_algo.html
- OCCT 7.9.0 Modeling Algorithms user guide, "Hidden Line Removal":
  https://dev.opencascade.org/doc/occt-7.9.0/overview/html/occt_user_guides__modeling_algos.html#occt_modalg_10_1
- OCCT source, tag `V7_9_0`:
  - `src/HLRBRep/HLRBRep_Hider.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRBRep/HLRBRep_Hider.cxx
  - `src/HLRBRep/HLRBRep_InternalAlgo.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRBRep/HLRBRep_InternalAlgo.cxx
  - `src/HLRBRep/HLRBRep_ShapeToHLR.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRBRep/HLRBRep_ShapeToHLR.cxx
  - `src/HLRBRep/HLRBRep_Data.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRBRep/HLRBRep_Data.cxx
  - `src/HLRBRep/HLRBRep_Surface.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRBRep/HLRBRep_Surface.cxx
  - `src/HLRBRep/HLRBRep_Curve.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRBRep/HLRBRep_Curve.cxx
  - `src/HLRBRep/HLRBRep_EdgeBuilder.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRBRep/HLRBRep_EdgeBuilder.cxx
  - `src/HLRBRep/HLRBRep_EdgeIList.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRBRep/HLRBRep_EdgeIList.cxx
  - `src/HLRTopoBRep/HLRTopoBRep_OutLiner.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRTopoBRep/HLRTopoBRep_OutLiner.cxx
  - `src/HLRTopoBRep/HLRTopoBRep_DSFiller.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/HLRTopoBRep/HLRTopoBRep_DSFiller.cxx
  - `src/Contap/Contap_ContAna.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/Contap/Contap_ContAna.cxx
  - `src/Contap/Contap_ContAna.lxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/Contap/Contap_ContAna.lxx
  - `src/Contap/Contap_Contour.cxx`:
    https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/V7_9_0/src/Contap/Contap_Contour.cxx

### FreeCAD TechDraw 1.0.2

- FreeCAD 1.0.2, `src/Mod/TechDraw/App/GeometryObject.cpp`:
  https://raw.githubusercontent.com/FreeCAD/FreeCAD/1.0.2/src/Mod/TechDraw/App/GeometryObject.cpp
- FreeCAD 1.0.2, `src/Mod/TechDraw/App/DrawViewPart.cpp`:
  https://raw.githubusercontent.com/FreeCAD/FreeCAD/1.0.2/src/Mod/TechDraw/App/DrawViewPart.cpp
- FreeCAD 1.0.2, `src/Mod/TechDraw/App/DrawViewPart.h`:
  https://raw.githubusercontent.com/FreeCAD/FreeCAD/1.0.2/src/Mod/TechDraw/App/DrawViewPart.h
- FreeCAD documentation wiki, `TechDraw_View` (HLR parameters, Coarse View,
  Smooth/Seam/Iso visible/hidden):
  https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/TechDraw_View.md

### Analytic HLR literature

- Joshua Z. Levin, "A parametric algorithm for drawing pictures of solid
  objects composed of quadric surfaces," *Communications of the ACM*
  19(10):555-563, 1976. DOI: https://doi.org/10.1145/360349.360355
- Gershon Elber and Elaine Cohen, "Hidden curve removal for free form
  surfaces," *SIGGRAPH 1990*, 24(4):95-104.
  DOI: https://doi.org/10.1145/97879.97890
- T. Nishita, S. Takita, and E. Nakamae, "Hidden Curve Elimination of Trimmed
  Surfaces Using Bézier Clipping," *Visual Computing*, pp. 599-619, 1992.
  DOI: https://doi.org/10.1007/978-4-431-68204-2_37
- Arthur Appel, "The notion of quantitative invisibility and the machine
  rendering of solids," *Proceedings of the 1967 22nd National Conference*,
  pp. 387-393. DOI: https://doi.org/10.1145/800196.806007
- "Analytic Visibility on the GPU," *Computer Graphics Forum* 30(2):409-418,
  2013. DOI: https://doi.org/10.1111/cgf.12061

### EduCAD files inspected

- `public/lib/educad-project.js` — `projectSolid`, `edgeIntervals`,
  `edgeHiddenAt`, `projectGeometry`, `pointHidden`, `HIT_EPS`.
- `public/lib/educad-solid.js` — `classifyEdges`, `faceVisibilityFor`.
- `public/lib/educad-surfaces.js` — `build`, `loopGeometry`, `incidence`,
  `section`, `trim`, `split`, `attachBoundary`, `intersect`.
- `public/lib/educad-curve-reconstruct.js` — analytic curve records,
  `SAMPLES = 24` display tessellation, surface patch construction.
- `public/lib/educad-reconstruct.js` — pipeline, `visibilityProvider`,
  `attachSurfaceModel`.
- `public/lib/educad-oblique-kernel.js` — `visibilityEvidence` sampling.
- `tools/edc.js` — `topHidden`, `frontHidden`, `splitHidden`,
  `surface-query`, `topologyProperties`.
- `tools/scripts/hidden-box.edu`, `plate-occlusion.edu`,
  `partial-hidden-edge.edu`, `hole-visibility.edu`, `sphere.edu`,
  `truncated-cylinder.edu`, `cone.edu`, `cylindrical-recess.edu`,
  `spherical-recess.edu`, `fillet-line-boundary.edu`.

## Appendix A: Current code map and measured behavior

| Concern | Current location | Consequence |
|---|---|---|
| Mesh edge projection | `educad-project.js:projectSolid` | output is mesh edges |
| Interval splitting | `educad-project.js:edgeIntervals` | only planar face boundaries and face-plane crossings |
| Ray visibility | `educad-project.js:edgeHiddenAt` | planar face planes; `HIT_EPS=1e-7` |
| Smooth side filter | `educad-project.js:projectGeometry` | adjacent triangle facing, not analytic silhouette |
| Point visibility | `educad-project.js:pointHidden` | one point; mesh faces only |
| Widget dashed edges | `educad-solid.js:classifyEdges` | adjacent face normals; convex-solid heuristic |
| Analytic curves | `educad-curve-reconstruct.js` | circle/ellipse/arc records; 24-sample display |
| Surface model | `educad-surfaces.js` | bounded kinds, loops, incidence, certificate |
| Test properties | `tools/edc.js:topologyProperties` | `topHidden`, `frontHidden`, `splitHidden` are mesh counts |
| Test query | `tools/edc.js` `# surface-query` | no HLR query yet |

Measured with the current worktree:

```text
sphere.edu          top:   12 segments, 0 hidden, 0 split
sphere.edu          front: 16 segments, 0 hidden, 0 split
truncated-cylinder  top:   48 segments, 24 hidden, 0 split
truncated-cylinder  front: 50 segments, 24 hidden, 0 split
```

The exact sphere result is one circle in each view. The exact truncated
cylinder result is two rims plus two silhouette generators (with visibility
per interval). These measurements are the concrete baseline for the first
milestone.

## Appendix B: Verification status

Verified in this worktree:

- the current projection/visibility code paths and their limits;
- the measured mesh segment counts above;
- the current `.edu` runner's property and `surface-query` mechanisms;
- the cited OCCT source behavior by reading the tagged source and class
  documentation;
- the cited FreeCAD source behavior by reading the 1.0.2 source and wiki.

Not verified by execution here:

- OCCT 7.9.0 was not built or run; the algorithm description is from source
  and documentation, and behavior may differ in other OCCT versions.
- FreeCAD 1.0.2 was not built or run; the integration description is from
  source and documentation.
- The literature summaries are based on abstracts/metadata and the cited
  papers, not on a line-by-line reproduction of every algorithm.
- The performance estimates are complexity arguments, not benchmarks on a
  large model.
- The exact perspective sphere/cylinder formulas in section 4.2 are derived
  from the geometry; they are not claimed to match every OCCT code path.

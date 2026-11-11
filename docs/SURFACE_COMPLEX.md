# Toward a bounded analytic surface complex

`SURFACE_MODEL.md` defines the bounded analytic model and the operations on it.
This note records how the recent capabilities relate, where their code
overlaps, and what a common formulation would look like. It is a design
direction, not a claim that every operation below is implemented.

## The capabilities

| Capability | Inference | Bounded analytic result | Operation added |
|---|---|---|---|
| Inclined cone | circle in 3D + two tangent generators | `cone` + planar base cap sharing one loop | projection tangency and apex solve |
| Spherical recess | circular mouth + rim-to-rim silhouette arc | partial `sphere` with one mouth loop | cap/sphere fitting and closure |
| Cylindrical recess | circular mouth + face frame + edge-on depth strokes and bottom edge | bounded `cylinder` + bottom cap + optional mouth closure | depth solve and shared-loop closure |
| Cylindrical fillet | true-shape tangent arc + two tangent face edges + paired generator/end lines | partial `cylinder` with two end arcs and two straight tangent boundaries, shared with two plane strips | line boundary elements and tangency evidence |
| Surface intersections | two analytic supports | curves/points, not clipped to loops | `Surfaces.intersect` |
| Boundary algebra | one surface + plane, or an existing curve or line | two patches sharing a section loop or section sub-arcs / one promoted curve or line | `Surfaces.split`, `attachBoundary`, `shareBoundary`, `intersectionCurves` |
| Analytic certificate | an existing bounded model | read-only certificate | `Surfaces.certify` |

All of these already agree on the same vocabulary: a surface has a `kind`,
analytic parameters, ordered `loops`, `sourceIds`, and optional
`displayFaceIndices`. A loop element is a drawing curve index, an inline
`section`, an inline straight `line`, or a planar vertex edge. The differences
are in how a surface is inferred and which operation consumes it.

## Where the solutions overlap

### 1. Boundary incidence

`Surfaces.validate` and `Surfaces.certify` both need to count boundary uses,
find open/non-manifold boundaries, and group surfaces into components. The
certificate also needs per-element records and stable section IDs.

This is now one shared graph:

```js
Surfaces.incidence(model)
// { uses: Map<boundaryId, {id, element, kind, useCount,
//                          surfaceIds, surfaceUses, loopRefs}>,
//   bySurface: Map<surfaceId, boundaryId[]>,
//   elementId(element) }
```

Drawing curves get `c:<index>`, inline sections get `section:<n>`, inline lines
get `line:<n>` or `line:id:<explicit-id>`, and planar vertex edges get
`e:<a>_<b>`. `validate` and `certify` both consume it. That prevents "closed" from meaning
one thing in the summary and another in the certificate, and it gives future
operations the same boundary identity rules for curves, sections and straight
elements.

### 2. Curve and surface construction

Cone inference, recess inference and fillet inference live in
`educad-curve-reconstruct.js` and all do the same three things:

1. project an analytic circle/silhouette into a view;
2. recover a spatial parameter (apex on a normal, sphere centre on an axis,
   recess depth, fillet length and tangent stations);
3. emit `surfacePatches` plus display faces and shared boundary elements.

The fillet adds the straight-element case: the paired view gives two tangent
generator lines and two end strokes; lifting the same cross-section arc at both
end stations gives two coaxial arcs; the cylinder loop is then
`{lines:[lineStart,lineEnd], curves:[lowArc,highArc]}`. The two adjacent plane
strips reference the exact line objects, so incidence is 2 without resampling
either boundary.

They currently use separate vector-helper bundles (`sub/add/...`,
`sub3/add3/...`, `cvAdd/cvSub/...`) and separate small projection utilities.
Those are the clearest duplication in the pipeline. A shared
`CurveProjection`/`Tangency` module would remove it without changing the model.

### 3. Section, trim, split and intersection

`section`, `intersect`, `trim`, `split` and `intersectionCurves` already share
the same curve vocabulary (`circle`, `ellipse`, `arc`, `line`, `conic`) and the
same plane specification. `trim` consumes a closed `circle`/`ellipse` section
and inserts it as a loop; `intersect` returns the supporting-surface
intersection without clipping. `split` divides a bounded curved surface at a
plane. When every loop stays on one side it inserts the same section object as
a new loop in both pieces. When a loop crosses the plane it cuts the loop
analytically into ordered sub-arcs and splits the section at the same
stations, so the cut is the same set of section sub-arc objects in both
pieces. `intersectionCurves` turns a closed circle/ellipse intersection into
that same loop-element vocabulary, and `attachBoundary`/`shareBoundary` promote
such a curve into one or two surfaces without resampling it. Straight loop
elements participate in the same checks: `loopSide` classifies their
endpoints, `split` refuses a crossing line with
`split-loop-crosses-plane`, and `attachBoundary` accepts a finite line as one
structural loop element.

A general loop operation makes the remaining relationship explicit:

```text
intersect(S1, S2) -> boundary curve(s)
intersectionCurves(result) -> analytic curve record(s)
trim(S, plane)     -> replace discarded loops with a section
split(S, plane)    -> divide the surface, sharing the section loop
                      or the section sub-arcs inside the bounded patch
share(S1, S2, curve) -> the same curve object in both loops
share(S1, S2, line)  -> the same straight element in both loops
split(loop, plane) -> ordered same-side sub-loops (implemented for curve,
                      polyline and vertex loops; line elements remain refused)
```

The loop element vocabulary carries both cases: an ordered loop may hold
drawing-curve indices, drawing-vertex edges, one inline closed section, inline
straight line elements, or an `elements` list of inline analytic sub-arcs
(`{kind:'curve',curve}`) and polyline pieces (`{kind:'polyline',points}`).
Incidence treats each shared sub-arc or line object as one boundary element,
exactly as it treats a full section. The crossing-loop split supports
circle/ellipse/arc boundaries and straight vertex-loop edges, refuses an edge
crossing that is not on the analytic surface, and classifies the section
sub-arcs with a sphere cap half-space or a cylinder/cone generator-station
interval. It is not a general Boolean clip: non-closed loops, unsupported loop
topologies, and section arcs outside the bounded patch are refused with
specific diagnostics rather than sampled. A loop made from the newer straight
line elements is not split yet.

### 4. Surface type-specific checks

`validate` and the certificate both sample boundary curves and straight
elements against their surface. The certificate adds exact/decimal checks for
plane coplanarity, positive radii, axis unit length, cone apex/half-angle,
sphere cap parameters and line finiteness/length. These checks are
type-specific, but they all fit the same
`check(id, status, arithmetic, residual, tolerance)` record. No second surface
type registry is needed.

## Parent formulation

A bounded analytic surface complex can be written as

```text
C = (S, B, boundary, incidence)
```

- `S` — surface records: `{kind, parameters, loops, sourceIds}`;
- `B` — boundary elements: drawing curve index, mesh edge key, inline section
- `B` — boundary elements: drawing curve index, mesh edge key, inline section
  object, inline finite line object, or an inline analytic sub-arc/polyline
  piece produced by a split;
- `boundary : S x loop -> B` — ordered element sequences;
- `incidence : B -> {surface uses}` — the graph already exposed by
  `Surfaces.incidence`.

The operations are then uniform:

| Operation | Input | Output |
|---|---|---|
| `infer` | primitive/silhouette evidence | candidate surface records |
| `resolve` | candidate records | one consistent complex (duplicate/conflict handling) |
| `intersect` | two surface records | analytic curves/points |
| `trim` / `split` | surface + cutting surface/plane | replaced or divided loops |
| `share` | two surfaces + curve | the same boundary element in both loops |
| `certify` | complex | exact/combinatorial + numeric certificate |

The features become predicates over the complex rather than separate readers:

- **cone**: a `cone` surface whose boundary loop is shared with a cap, with a
  solved apex on the base normal;
- **recess**: a `sphere` with one mouth loop, or a bounded `cylinder` with
  mouth/bottom loops and an optional planar mouth closure;
- **fillet**: a partial `cylinder` whose loop is two end arcs and two straight
  tangent generator lines, with those lines shared with adjacent planar faces;
- **intersection**: an analytic curve that may become a new boundary element
  through `trim`/`split`;
- **certificate**: a read-only traversal of the same complex.

This is the parent general solution: geometry is a set of bounded surfaces and
shared boundaries, not a list of named solid readers. The capabilities above
are special cases of construction and boundary operations on that set.

## Current state and next steps

Implemented now:

- `Surfaces.build`, `validate`, `certify` and the shared `incidence` graph;
- inline straight boundary elements on plane, cylinder, cone and sphere loops,
  including `build` loops, `validate`, `certify`, `split`, `trim`,
  `attachBoundary` and saved previews;
- `section`, `trim`, `intersect`;
- `split`, `splitDiagnostic`, `attachBoundary`, `shareBoundary`,
  `intersectionCurves`;
- crossing-loop `split` with analytic circle/ellipse/arc sub-arcs, straight
  edge/plane cuts, section splitting at the same stations, and shared section
  sub-arcs;
- cone-over-inclined-circle inference;
- spherical-recess inference;
- cylindrical-recess inference with flat bottom and optional mouth closure;
- cylindrical-fillet inference with two straight tangent boundaries shared
  with adjacent planar strips;
- 151 drawing scripts covering positive, open, conflict, split, attachment,
  line-boundary, profile and cross-feature cases.

Not yet unified:

- the curve/silhouette projection helpers themselves; their vector arithmetic
  now comes from the shared `educad-vec3.js`;
- a generic candidate resolver for overlapping inferred surfaces;
- a generic point-in-patch test for an arbitrary curved patch; `split` uses a
  sphere cap half-space or a cylinder/cone generator-station interval and
  refuses the cases those tests cannot decide;
- cone crossing cuts: the `section` classifier returns `conic` for every
  oblique cone plane, so the split section gate still refuses them before the
  crossing-loop machinery can run;
- vertex-loop crossings whose polygon chord leaves the analytic surface; they
  are refused rather than projected or snapped;
- splitting a straight `line` loop element that crosses the cutting plane;
  line elements are refused with `split-loop-crosses-plane`;
- automatic chaining of intersection -> promotion -> attach in one resolver;
  the three operations exist but are not called by the reconstruction pipeline;
- closing a fillet feature into a watertight solid: the current fillet patch
  shares its straight generator boundaries with two plane strips, but its end
  arcs and the strips' outer edges stay open, and no surrounding part is
  Boolean-unioned or subtracted;
- fillet chains, variable-radius fillets, torus fillets and general
  constant-radius blends between non-planar faces;
- exact interval arithmetic for the numeric certificate checks.

The shared incidence graph is the first concrete step. It makes validation,
certification and the boundary operations agree on boundary identity, and
`educad-vec3.js` removes the duplicated vector arithmetic. `split`, attachment
and `intersectionCurves` now provide the boundary algebra, including analytic
sub-loop splitting for a boundary that crosses a cutting plane. The straight
`line` loop element makes a fillet a cylinder patch with two shared generator
lines rather than a new reader. The next refactor should move the
curve/silhouette projection helpers into one module and close fillet ends
against the surrounding surface complex.

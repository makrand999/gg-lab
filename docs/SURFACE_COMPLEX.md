# Toward a bounded analytic surface complex

`SURFACE_MODEL.md` defines the bounded analytic model and the operations on it.
This note records how the five recent capabilities relate, where their code
overlaps, and what a common formulation would look like. It is a design
direction, not a claim that every operation below is implemented.

## The five capabilities

| Capability | Inference | Bounded analytic result | Operation added |
|---|---|---|---|
| Inclined cone | circle in 3D + two tangent generators | `cone` + planar base cap sharing one loop | projection tangency and apex solve |
| Spherical recess | circular mouth + rim-to-rim silhouette arc | partial `sphere` with one mouth loop | cap/sphere fitting and closure |
| Surface intersections | two analytic supports | curves/points, not clipped to loops | `Surfaces.intersect` |
| Boundary algebra | one surface + plane, or an existing curve | two patches sharing a section loop / one promoted curve | `Surfaces.split`, `attachBoundary`, `shareBoundary`, `intersectionCurves` |
| Analytic certificate | an existing bounded model | read-only certificate | `Surfaces.certify` |

All five already agree on the same vocabulary: a surface has a `kind`, analytic
parameters, ordered `loops`, `sourceIds`, and optional `displayFaceIndices`.
The differences are in how a surface is inferred and which operation consumes
it.

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

`validate` and `certify` both consume it. That prevents "closed" from meaning
one thing in the summary and another in the certificate, and it gives future
operations the same boundary identity rules.

### 2. Curve and surface construction

Cone inference and recess inference live in `educad-curve-reconstruct.js` and
both do the same three things:

1. project an analytic circle/silhouette into a view;
2. recover a spatial parameter (apex on a normal, sphere centre on an axis);
3. emit `surfacePatches` plus display faces and a shared boundary curve.

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
plane and inserts the same section object as a new loop in both pieces, so the
cut starts life as a shared boundary. `intersectionCurves` turns a closed
circle/ellipse intersection into that same loop-element vocabulary, and
`attachBoundary`/`shareBoundary` promote such a curve into one or two surfaces
without resampling it.

A general loop operation would make the remaining relationship explicit:

```text
intersect(S1, S2) -> boundary curve(s)
intersectionCurves(result) -> analytic curve record(s)
trim(S, plane)     -> replace discarded loops with a section
split(S, plane)    -> divide the surface, sharing the section loop
share(S1, S2, curve) -> the same curve object in both loops
split(loop, curve) -> sub-loops (not implemented)
```

The recess work already added analytic inner curves to plane patches, so the
loop element kinds are ready. What is still missing is a single
`BoundaryElement` factory and the generic loop split for a boundary that crosses
a cutting plane. The plane split is deliberately limited to surfaces whose
existing loops stay wholly on one side; `split` refuses a crossing loop with
`split-loop-crosses-plane` instead of sampling a replacement curve.

### 4. Surface type-specific checks

`validate` and the certificate both sample boundary curves against their
surface. The certificate adds exact/decimal checks for plane coplanarity,
positive radii, axis unit length, cone apex/half-angle and sphere cap
parameters. These checks are type-specific, but they all fit the same
`check(id, status, arithmetic, residual, tolerance)` record. No second surface
type registry is needed.

## Parent formulation

A bounded analytic surface complex can be written as

```text
C = (S, B, boundary, incidence)
```

- `S` — surface records: `{kind, parameters, loops, sourceIds}`;
- `B` — boundary elements: drawing curve index, mesh edge key, or inline
  section object;
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
- **recess**: a `sphere` surface with one mouth loop, optionally shared with a
  planar closure;
- **fillet** (future): a partial `cylinder` surface with two loops shared with
  adjacent faces;
- **intersection**: an analytic curve that may become a new boundary element
  through `trim`/`split`;
- **certificate**: a read-only traversal of the same complex.

This is the parent general solution: geometry is a set of bounded surfaces and
shared boundaries, not a list of named solid readers. The five current
capabilities are special cases of construction and boundary operations on that
set.

## Current state and next steps

Implemented now:

- `Surfaces.build`, `validate`, `certify` and the shared `incidence` graph;
- `section`, `trim`, `intersect`;
- `split`, `splitDiagnostic`, `attachBoundary`, `shareBoundary`,
  `intersectionCurves`;
- cone-over-inclined-circle inference;
- spherical-recess inference;
- 131 drawing scripts (123 `.edu` sheets and 8 `.edc` scripts) covering
  positive, open, conflict, split, attachment and cross-feature cases.

Not yet unified:

- the curve/silhouette projection helpers themselves; their vector arithmetic
  now comes from the shared `educad-vec3.js`;
- a generic candidate resolver for overlapping inferred surfaces;
- `split` for a loop that crosses a cutting surface, including analytic
  sub-arcs for circle/ellipse/arc loops;
- a generic point-in-patch test for an arbitrary curved patch; `split` currently
  proves the section is inside the accepted patch from loop sides, per-side
  boundedness and, for a sphere cap, the mouth/pole interval;
- automatic chaining of intersection -> promotion -> attach in one resolver;
  the three operations exist but are not called by the reconstruction pipeline;
- fillet inference;
- exact interval arithmetic for the numeric certificate checks.

The shared incidence graph is the first concrete step. It makes validation,
certification and the boundary operations agree on boundary identity, and
`educad-vec3.js` removes the duplicated vector arithmetic. `split`, attachment
and `intersectionCurves` now provide the boundary algebra. The next refactor
should move the curve/silhouette projection helpers into one module and add
analytic sub-loop splitting for crossing loops, after which a fillet is a
cylinder patch with two shared loops rather than a new reader.

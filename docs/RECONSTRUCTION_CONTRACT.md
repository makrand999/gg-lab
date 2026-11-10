# Explicit reconstruction contract v1

This is the mathematical specification for Major's strict reconstruction path,
implemented in `public/lib/educad-strict.js`. It is a proof about the model and
algorithm below, **not a claim that the JavaScript implementation has been
formally verified**. Tests check its implementation against this specification.

## Scope of the guarantee

The input describes a finite collection of explicitly identified vertices,
straight edges, and optionally explicitly declared nondegenerate triangles.
The result is the unique **declared** wireframe or embedded triangular surface
satisfying the projection observations. **Every valid closed connected surface
defines a solid: its boundary together with its bounded interior.** This does not establish that the author declared every
feature of an intended real-world object. Hidden or omitted features cannot be
recovered from absence of ink.

Curves, general curved surfaces, material/physical validity, Boolean grouping,
automatic cavity subtraction, and exact visibility inference are outside v1.
Declared surfaces must be embedded orientable manifolds, possibly with boundary:
non-manifold incidence, self-intersection and unintended contacts are rejected.
Open surfaces remain surfaces. Each closed connected component becomes a solid;
convexity and genus zero are not required. A closed cycle of edges never implies
a face, and an open surface is never filled with invented faces.

Multiple closed shells define separate solids, including nested shells. No
volume subtraction or union is guessed. Touching or intersecting shells do not
pass the global embedded-surface contract; explicit grouping/assembly semantics
would be a separate feature.

The old recognizers remain available through `reconstructLive` for compatibility.
They are not covered by this guarantee and Major's live bridge never falls back
to them. `reconstructLive(rows, {mode: 'strict'})` delegates to the strict path.

## Coordinates and observations

Use physical coordinates `(x, h, d)` in millimetres: sheet abscissa, height above
HP, and depth in front of VP. The renderer stores these as `{x, y: h, z: d}`.
Signs are unrestricted. A point's view is declared; the sign of a sheet
coordinate never determines its view, including points on the datum.

The projections are:

- Front / `ELEVATION`: `(u,v) = (x,h)`.
- Top / `PLAN`: `(u,v) = (x,-d)`.
- Side / `PROFILE`: `(u,v) = (xRef + s*(d-dRef), h)`, with declared `s` equal to
  `+1` or `-1` and declared `xRef,dRef`.

The inverse observations are therefore front `(x=u,h=v)`, top `(x=u,d=-v)`,
and side `(d=dRef+s*(u-xRef),h=v)`. Each observation fixes two coordinates.
Two independent views determine all three coordinates. Front plus side and top
plus side are as valid as front plus top. Repeating one view cannot determine
the missing coordinate.

A profile frame comes from an explicit `options.profile` or a drawing record's
`meta.draftingLayout`. Conflicting frames are inconsistent. The strict path never
estimates a frame from drawing bounds, names, or proximity. All declared side
observations are checked; they are not ignored to preserve an attractive preview.

## Identity and incidence

Each `POINT` station contains `meta.members: [{id, name, hidden}, ...]`.
The stable member ID identifies a spatial vertex. One station can contain many
IDs. One ID can occur in many stations. Distinct IDs remain distinct even when
all coordinates coincide. Names, captions, hidden verdicts, entity ordering and
screen visibility do not establish or remove constraints.

A point with no member identity, or view `BOTH`, is underdetermined. The kernel
does not derive identity from a caption or view from the point's position.

A spatial edge is declared by a `SEGMENT` with:

```js
meta: {
  refs: [sourceStationId, destinationStationId],
  endpointMemberIds: [sourceMemberId, destinationMemberId]
}
```

`endpointRefs`, if present, provides the station pair instead of `refs`.
Both member IDs must actually belong to their specified stations. Both segment
coordinates must exactly equal the declared station coordinates. A stale
endpoint is inconsistent; it never reattaches to a coincident vertex or a reused
name. A same-view edge connects distinct spatial vertices and must have nonzero
spatial length. Duplicate projected declarations of the same undirected edge
represent one edge. Crossings and intermediate points never split it.

An explicitly selected cross-view segment describes a projector only when its
endpoint member IDs are equal. It creates no spatial edge and merges no IDs.
The Project tool's `meta.kind: 'projector'` records are relationship annotations:
their two stations must already share a member ID. Extended helper ink is not
interpreted as edge geometry. Sharing a member ID is the actual correspondence;
a projector stroke is not required to reconstruct that member.

Dimensions, text and datum axes are annotations. Other helper entities must be
explicitly marked `meta.reconstructionRole: 'construction'`. Line style alone
never makes something an edge, a projector, or an ignorable helper. Unsupported
entity types are reported, not recognized as a cylinder or another shape.

## Declared triangles and persistence

A triangle is an ordered triple of member IDs. All three must be resolved,
distinct and noncollinear. Its three boundary edges are declared by the triangle
itself. Repeated triangle declarations are rejected. The kernel adds no other
faces or connections.

Pass `{topology: {triangles: [['a','b','c']]}}` to the strict API, or persist the
same object on exactly one drawing record as `meta.reconstructionTopology`.
For example, update the metadata of the drawing's datum axis while preserving
its other metadata. The existing save/load and undo mechanisms preserve it.
The API and storage format are implemented; a face-authoring UI is not part of
this change. Closed surfaces become solids without a flag. Optionally set
`topology.solid: true` to require every surface component to be closed: missing
boundary faces then produce `underdetermined` rather than an open-surface result.
`solid: false` removes that requirement, but does not prevent a closed surface
from defining a solid. The `solids` grouping key is unsupported; cavity/grouping
semantics must not be inferred from nesting.

## Existence and uniqueness proof

For each member, collect all equations fixing `x`, `h`, or `d`.

1. If two observations fix the same coordinate to different values, no point can
   satisfy both. The construction is inconsistent.
2. Otherwise, every assigned coordinate has one value. If an axis is unassigned,
   that coordinate can vary freely: there are infinitely many solutions. The
   construction is underdetermined.
3. If all three axes are assigned consistently, substituting the resulting
   triple into every observation satisfies every equation. Any other solution
   must share each of those three values, so it is the same point.

Applying this argument independently to every stable member establishes the
unique declared vertex assignment. The argument is independent of vertex count,
object shape, quadrant, overlap, and whether projections cross.

For a declared straight edge with endpoints `A,B`, every point is
`(1-t)A+tB`, `0 <= t <= 1`. For any of the affine projections above,

```
pi((1-t)A+tB) = (1-t)pi(A) + t*pi(B).
```

Thus its unique spatial segment projects exactly to the declared segment.
Endpoint identity validation establishes incidence independently of coordinates.
No crossing-based splitting or connection inference is needed.

For a noncollinear declared triangle `A,B,C`, its points are
`alpha*A + beta*B + gamma*C`, where coefficients are nonnegative and sum to one.
Affine projection commutes with these combinations too. The three unique
vertices therefore determine one unique triangular patch. The union of the
explicitly declared patches and edges is unique. This proves reconstruction
relative to the declarations, not uniqueness of an unknown solid inferred from
silhouettes.

## Closed-surface-to-solid theorem and checks

The engine establishes the following conditions before calling a component a
solid boundary:

1. Every triangle is nondegenerate and every boundary edge has exactly two
   incident triangles. An edge with one incident face identifies an open surface;
   more than two is non-manifold.
2. At every vertex, the *link graph* connects the other vertices of its incident
   triangles. For a closed surface it must be one connected cycle, establishing
   a disk neighbourhood. An open surface may instead have one connected path,
   establishing a half-disk neighbourhood. Edge counts alone do not establish
   this condition: two closed shells pinched at one vertex fail it.
3. Each pair of triangles intersects only in its declared shared vertex or edge,
   or is disjoint. This establishes an embedded simplicial surface: no crossing,
   coplanar overlap, T-junction, or accidental contact between different IDs.
4. Faces admit a consistent orientation. A traversal enforces opposite edge
   directions for the two faces incident on each edge. Contradictory orientation
   requirements are rejected. Input face winding may be mixed; the derived
   boundary is oriented consistently without changing the stored declarations.

These checks establish that each closed connected component is a compact,
connected, embedded piecewise-linear 2-manifold without boundary in R³. The
Jordan–Brouwer separation theorem for embedded hypersurfaces gives two
complementary regions, exactly one bounded. The solid is **the closure of this
bounded region**; it is therefore uniquely determined by the boundary. This
works for handles and concavities too, not only spheres or convex polyhedra.
See the [Jordan–Brouwer theorem and proof](https://www.math.uchicago.edu/~may/VIGRE/VIGRE2009/REUPapers/Schmaltz.pdf)
for the separation principle. The finite nondegenerate simplicial embedding
checks above establish the piecewise-linear setting used here. The distinction
between a closed mesh and a valid volume boundary is also reflected in
[CGAL's orientation and volume-boundary documentation](https://doc.cgal.org/5.6.3/Polygon_mesh_processing/index.html).

For an oriented closed triangle boundary, the divergence theorem yields

```
V_signed = (1/6) sum_faces det(A-O, B-O, C-O).
```

Here O is any fixed point; the implementation uses a boundary vertex to reduce
intermediate integer sizes. Consistent orientation makes this either the
bounded interior volume or its negative. A negative result reverses the derived
face orientation; zero volume is rejected. The positive volume is stored as a
normalized exact rational in `volumeMm3Exact`, with an approximate numeric
value only when representable. Volume is additional evidence, not a substitute
for manifoldness and intersection checks.

Intersection predicates use exact rational arithmetic. A segment in a
triangle's plane is clipped against the triangle's three linear half-space
inequalities; a transverse segment meets the plane in at most one point, which
is tested against those same inequalities. Testing all six triangle edges finds
the extreme points of their convex intersection. Every such point must lie in
the declared common simplex. Convexity then guarantees that the entire
intersection lies there. Exact bounding boxes only discard provably disjoint
pairs. The current pairwise validation costs O(F²) triangle comparisons; there
is no approximate fast path or face-count cutoff that bypasses validation.

A certified result contains `geometry.solids` and `certificate.solids`, listing
the boundary faces and exact volume of each solid. `geometry.openSurfaces`
records the face components that still have boundary edges. Removing a face
removes the closed-solid certificate on the next rebuild.

## Arithmetic and result semantics

Stored finite JavaScript coordinates are interpreted as the exact decimal values
of `String(number)`, including scientific notation. The kernel converts them to
normalized rational pairs of `BigInt`s. Constraint equality, affine inversion,
edge degeneracy, triangle collinearity, surface intersections and volume use
rational arithmetic. There is no
welding radius, rounding-to-match, averaging, or hidden geometric tolerance.

Consequently a stored `0.30000000000000004` conflicts with a stored `0.3`.
Floating-point authoring operations can produce such inputs. The solver reports
the conflict; it cannot certify the author's unstored intended value. Future
precision assists must explicitly change the observations before solving.
This is exactness for the stored decimal model, not recovery of exact real
measurements or exact trigonometric construction.

Rendering converts the solved rationals to approximate JavaScript numbers.
The exact certificate remains separate. Unsupported renderer range is not
reported as a mathematical contradiction.

Results contain `determination`:

- `determined`: every declared primitive in the supported domain is resolved;
  `status: 'ok'`, geometry and an exact certificate are returned.
- `underdetermined`: information is missing; no whole-model geometry or
  certificate is returned.
- `inconsistent`: declarations contradict each other or have invalid incidence;
  no whole-model geometry or certificate is returned.
- `unsupported`: a requested primitive or grouping operation is outside the contract.

All issues include a code and, where applicable, the responsible entity/member
ID. Mixed results retain every issue; precedence is inconsistent, unsupported,
then underdetermined. Counters may describe resolved vertices, but are not a
certificate for a partially valid whole object. An unresolved result does not
assert that a completion exists; remaining declarations can reveal further
contradictions.

Major exposes the current result as `educadHandle.reconstruction` and displays
the diagnostic when reconstruction is unavailable. Hiding bad geometry cannot
make it valid: visibility never removes constraints.

## Implementation verification

Draw the affected figure as an EduCAD Script sheet and validate it headlessly:

```sh
node tools/edc.js --solid tools/scripts/quad3d.edc
```

The runner executes every slash command, reports per-line errors, checks the
Monge projector alignment, and prints the reconstructed wireframe. A clean
script is a checkable drawing artifact; it does not prove the algebra, but it
shows that the implemented reader agrees with the drawn sheet.

## Inferred display adapter

The kernel contract above applies to `educad-strict.js` and its certificate.
`EduCADReconstruct.reconstructStrict` additionally supplies a shared planar
preview for determined wires without explicit topology declarations. In that
case `declaredGeometry` retains the certified wire; `geometry` is an inferred
display and its faces are not certified. Explicit topology is authoritative.
See [Shared planar surface previews](PLANAR_RECONSTRUCTION.md) for the display
representation, assumptions, limits, and `.edu` verification commands.


## Shared primitive application pipeline

Major's UI and script runner now call `EduCADReconstruct.reconstruct`. It uses
explicit identities as constraints and reconstructs supported curves through
the same primitive pipeline for linked and plain-label drawings. Its inferred
curve/surface results carry no exact-surface certificate. Inferred patches also
produce a bounded analytic surface model (`geometry.surfaces`) whose planes,
cylinders, cones and spheres have explicit loops and validated boundaries; this
model is inferred and separate from the exact declared-triangle certificate. The
low-level strict kernel and compatibility wrapper described above retain their
narrower contract. See [Primitive reconstruction](PRIMITIVE_RECONSTRUCTION.md)
and [Bounded analytic surface model](SURFACE_MODEL.md) for the implemented
geometry families, partial-result diagnostics, and remaining limitations.

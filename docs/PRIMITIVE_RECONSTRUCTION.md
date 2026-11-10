# Major: reconstruction from drawing primitives

The user draws vertices, straight edges, and curves in orthographic views.
The tool matches their observations, reconstructs 3D primitives, and infers
surfaces. Solid names and feature declarations are not required inputs.
Dimensions, sections, or explicit declarations may optionally resolve ambiguity.
This direction is also recorded in the repository's AGENTS.md.

## One application entry point

`EduCADReconstruct.reconstruct(entities, options)` is the public pipeline used
by Major's page, reference previews, and the `.edu` runner:

1. Collect primitive observations and explicit member constraints.
2. Resolve cross-view correspondence.
3. Lift vertices/edges and supported analytic curves into 3D.
4. Infer planar regions and supported ruled surface patches.
5. Return geometry plus specific diagnostics for unresolved observations.

Explicit identities are hard constraints. Contradictory declared observations
are rejected, including in drawings containing curves. Curved silhouette
stations and curve centres are observations; they need not each have a second
point station when their missing coordinates are established by curve evidence.

`reconstructLive` and `reconstructStrict` remain compatibility APIs, including
the older named-shape readers. New application code should use `reconstruct`.
The exact kernel's explicit topology/certificate contract is unchanged. Inferred
curves and surfaces are not certified by that kernel. Explicit triangle
declarations remain authoritative.

## Implemented curve and surface stage

`educad-curve-reconstruct.js` lifts a circle or circular arc that is seen in
true shape in a principal view and edge-on in a paired view. Plan/front,
plan/side, and front/side pairs are rotated into one canonical two-view problem,
so side-view true-shape curves and side-view edge-on evidence use the same
construction as front/top curves. It checks projected extents and combines
split/overlapping edge-on strokes. Linked centre observations, when present,
constrain the missing coordinate. Multiple supported levels can establish
multiple circular boundaries from coincident projections. An explicit side
frame (`/profile`, `options.profile`, or `meta.draftingLayout`) always wins. If
none is declared but profile ink exists, the frame is inferred from the profile
and front extents using the drafting layout convention, and the geometry is
marked `profileInferred`.
Frame extents include analytic circle and arc extrema; unused portions of an
arc's supporting circle do not enlarge those extents.
The oblique stage uses the same frame resolver, including validation of
explicit frames and inference for drawings containing only elliptical loops.

Coaxial circular boundaries with two corroborating straight silhouette
generators define an inferred ruled patch. Equal radii, unequal radii, and chains
of changing radii use the same operation. Two generators meeting at a common
point support a collapsed boundary (an apex). No cylinder/cone/frustum name is
read from the drawing. Planar end patches are inferred; intermediate shared
rings are not capped. Unsupported boundary configurations remain unresolved.
Reconstructed curves are projected back into every declared view, so an
edge-on stroke that covers the projection is claimed as corroborating evidence
rather than left unresolved. Profile point stations are checked through the
same frame instead of being ignored.

Overlapping projections are assessed as interval coverage, like overlapping
straight strokes, rather than by requiring a unique one-to-one line. When two
views offer several candidate levels for the same source curve, candidate pair
interpretations are scored against all declared views. A view with a covering
stroke supports a candidate; a view with a collinear stroke that does not cover
it contradicts that candidate; a silent view does not vote. The pair that keeps
the supported source curves with fewer contradictions and fewer speculative
instances is preferred, which avoids reconstructing every cross-product of two
overlapping two-view matches when a third view already selects the real levels.
If several distinct source projections each produce several levels and no view
selects a pairing, the supported curves are retained with
`curve-projection-ambiguous` instead of silently certifying the cross-product.

Equal full circles in two or more views are sphere silhouettes. Their shared
radius and projected centres fix the sphere centre, and the display mesh is a
smooth analytic sphere approximation; it is reported through `geometry.spheres`
and `surfacePatches.kind: 'sphere'`, not through a solid name.

A full circular mouth in one principal view and a rim-to-rim circular-arc
silhouette in the other determine a **spherical recess**. The mouth circle
fixes its axis and radius `a`; the lifted silhouette centre gives the sphere
centre `O` and radius `R`; the arc endpoints must be antipodal mouth points.
The accepted patch is the cap `{p : |p-O| = R, (p-M).n <= 0}` with
`a^2 + (q.n)^2 = R^2`, where `q = O - M`. An edge-on mouth stroke adds a
coplanar closure sharing the mouth loop; without it the cap is retained open.
The result is recorded in `geometry.recesses` and as a bounded `sphere` patch
with one outer loop. This is a spherical recess only: cylindrical/torus
fillets, elliptical mouths, partial mouth arcs and PROFILE mouths remain
unsupported. See [Bounded analytic surface model](SURFACE_MODEL.md).

A circle in a general plane projects as an ellipse. `educad-oblique-kernel.js`
groups closed elliptical loops, fits their centres/axes, recovers each plane
normal from the major/minor axes, and combines centers from two views. A
single projected ellipse leaves two possible plane normals (ignoring overall
normal sign). The kernel intersects these candidates across each view pair;
generic tilted ellipses select one plane. A closed ellipse can also pair with
a straight **edge-on run** in another view: the run supplies the missing centre
coordinate and its slope selects the depth mirror, while the ellipse supplies
the radius. The run must cover the same projected extent, so a polygon that
merely approximates an ellipse is not silently promoted; line pairing requires
a sufficiently dense projected loop. Corresponding boundary points can
select a remaining mirror: their recovered 3D positions must lie on the circle
and its plane. Both ordinary linked station names and explicit member IDs are
supported. Unlinked points do not choose a plane, and points on both candidate
planes leave the ambiguity intact. Contradictory boundary points produce
`oblique-point-conflict`. If two planes still fit both views and point evidence,
one supported circle is retained with `oblique-curve-ambiguous`. Matching
circles from additional view pairs merge their source evidence rather than
duplicating geometry. The reconstructed curve uses the same analytic curve
representation as principal circles.
Accepted point constraints are retained in each circle's `pointEvidence`, with
member IDs, source station IDs, and 3D positions, separately from tessellation.
Missing or incompatible ellipse projections retain their diagnostics even when
no oblique circle can be reconstructed and the pipeline uses straight geometry.

A closed circular boundary in a general plane can bound a cone without naming
the solid. Each declared view projects the analytic circle to a conic. A
straight stroke tangent to that conic at a boundary station is a candidate
silhouette generator; two such strokes that meet at one projected point and
cover the interval from their tangency stations to that point identify a
projected apex. The 3D apex is the intersection of that projection ray with the
base circle's plane normal, so the inferred analytic surface is a right
circular cone over the inclined circle. Tangency is evaluated from the actual
projected ellipse, not from `centre.x +/- radius`, and works in plan,
elevation, and the side frame. When the base plane is edge-on in a view, the
existing ellipse/line-run pair supplies the circle and the same degenerate-conic
tangency math supplies the generators. Generator evidence from several views must agree
on one apex. The base cap and the cone share the same analytic boundary loop,
so a complete drawing yields one closed shell. If tangent generators exist but
their apex does not lie on the base normal, the drawing reports
`cone-apex-conflict`; several distinct supported apices report
`cone-apex-ambiguous`; a view whose projection ray is parallel to the base
normal cannot fix the apex along that normal and reports
`cone-apex-undetermined` when no other view resolves it. A boundary with no
tangent-pair evidence stays a planar boundary. An oblique cone (apex off the
base-plane normal), a cone over a non-circular 3D ellipse, and a frustum
between two independently inclined boundaries remain unsupported.

Open, unbranched elliptical segment chains are fitted with a normalized conic
(at least 12 stations). Their ordered endpoints and swept portions must agree
in the recovered circle plane across views. The output is an analytic `arc`,
including major arcs and sweeps crossing the angular origin; display segments
never close an open arc. Incompatible sweeps report `oblique-arc-conflict`.
Degenerate or ill-conditioned fits remain with the straight-primitive stage.

An open elliptical arc can also pair with a straight **edge-on run** in another
view. The run's supporting line locates the missing centre coordinate, and its
covered interval must equal the arc's projected interval. This is solved from
the line equation rather than the run midpoint, so major arcs work even when
the run ends are interior projection extrema rather than arc endpoints.
Endpoint/radius evidence supplies a fallback when the run is parallel to the
missing axis. An incompatible run reports `oblique-line-conflict`; an arc with
no matching run retains `oblique-curve-projection-missing`.

### Free-form station curves

`/curve-through <p1> <p2> ... [closed] [view]` interpolates an ordered station
chain with a natural or periodic cubic. The entity stores its NURBS control
points, knots, positive weights, interpolation points and uniform station
parameters in `meta.curve`; `/circle-through` and `/arc-through` fit an exact
circle or arc through three ordered stations and use the same analytic curve
contract. Editing a defining point rebuilds the curve, and the point editor
refuses to edit derived control points directly.

Curves with the same station count and closure form a correspondence family,
not one spatial curve. Every cross-view pair proposes a full 3D station
sequence by combining the coordinates each view supplies. A proposal is
supported by any curve whose projected stations match it. The family is then
partitioned into spatial curves with at most one source curve per view; each
accepted curve is one NURBS with `sourceEvidence` recording its contributing
views and station orders. Two independent splines in plan and two in elevation
therefore produce two curves rather than one over-constrained conflict.

Shared member IDs are authoritative when ordering stations; suffix-stripped
station names are the compatibility fallback. The station order may be
reversed, and a closed curve may start at any station. Geometry is compared
modulo station direction and, for a closed curve, modulo the starting station.
When identities do not select one matching, every candidate is checked against
every declared view. A complete partition with one geometry is accepted;
equally strong partitions with different geometry report
`curve-correspondence-ambiguous`; a family that cannot be partitioned
consistently reports `curve-projection-conflict`; a curve with no compatible
second view reports `curve-correspondence-missing`. A contradictory third view
is not ignored in favour of a two-view pair. Deterministic tie-breaking
prefers more shared IDs, then more shared base names, then source order. A
family is all-or-nothing: an unmatched or contradictory member blocks the other
curves in the same station-count/closure family. A parametric boundary alone
does not select a spanning surface, so a reconstructed curve is retained with
`curve-surface-unresolved`.

Visible (A) and hidden (E) strokes can select a remaining mirror when independent
straight geometry reconstructs occluding faces. Both candidates are checked
against those faces and their holes using the shared projection ray test at
three interior stations per source segment. No occluder, or visibility that
fits both candidates, leaves the ambiguity intact. Contradictory visibility
reports `oblique-visibility-conflict`. `visibilityEvidence` retains stroke and
occluder source IDs plus the sample count. This is sampled visibility evidence,
not exact certification of an entire curved interval. Occlusion by newly inferred
curved patches is not used to choose the plane, avoiding circular inference.

A full circle seen in true shape also pairs with a **slanted** edge-on trace in
the other view. The trace's x extent is the circle diameter and its slope fixes
a cutting plane through the missing axis, so the spatial boundary is an analytic
ellipse rather than a circle. Two matching silhouette generators bound the
cylinder side surface between that ellipse and the original circle. This
reconstructs a truncated cylinder without reading a solid name; the same
operation covers the opposite slope and a side-view (`PROFILE`) trace. A trace
that covers only part of the circle is reported as
`curve-inclined-arc-unsupported`; two distinct traces for one circle are
retained with `curve-projection-ambiguous`.

Standalone planar circular boundaries share the planar containment/hole engine
with straight boundaries. Open arcs remain curves with no automatically invented
spanning surface. Independent straight components can coexist with curved ones.
Resolved geometry remains visible when another curve cannot be reconstructed;
`topologyStatus: 'partial'` and entity-specific diagnostics identify that omission.

The bounded analytic model is attached as `geometry.surfaces`, with
`geometry.surfaceModel` and `geometry.analyticSurfaceValidation`. It names each
plane, cylinder, cone or sphere, keeps outer/inner boundary loops, shares
boundary curves between caps and side surfaces, and validates boundaries
against the analytic definitions. Analytic plane sections are available through
`EduCADSurfaces.section`; exact surface–surface intersections through
`EduCADSurfaces.intersect`; and single-plane trimming through
`EduCADSurfaces.trim`. See [Bounded analytic surface model](SURFACE_MODEL.md).

## Representation and display

`geometry.curves` stores analytic definitions: `kind`, `center`, unit basis
vectors `u` and `v`, `radius`, `startAngle`, and `sweepAngle` (angles in radians).
A point on a curve is:

```
center + radius * (u * cos(angle) + v * sin(angle))
```

Each curve records `sourceIds` and its display vertex/edge indices.
`geometry.surfacePatches` records the display-facing patches (plane, cylinder,
cone or sphere) and their boundary curves, generators' source IDs, or apex.
`geometry.surfaces` is the bounded analytic model described above; it is
separate from the mesh and from the patch display records. An inclined boundary
uses the same `curves` representation with `kind: 'ellipse'`, `radiusU` and
`radiusV` (angles are measured in the ellipse's `u`/`v` basis). A full circle or
ellipse currently uses 24 display segments; script V/E/F counts describe that
display geometry, not the count of analytic primitives. Reference previews
preserve the analytic definitions and the surface model.

Smooth side-facet metadata lets orthographic/pose projections suppress interior
mesh generators while retaining silhouette generators. `projectGeometry` now
returns `intervals` with per-piece visible/hidden flags for partially occluded
edges, split at projected face/hole boundaries and face-plane crossings. The
solid widget's own face-visibility pass still classifies whole edges; its
interval drawing is a separate remainder. Rendering and some visibility paths
still use tessellation rather than exact analytic curves.

Inferred display faces are optionally checked with the exact rational triangle
kernel as `inferred-triangle-v1`: manifold edges/vertices, self-intersections,
orientation, and closed-shell volume. This certifies the display triangulation,
not the analytic curved surface. Holes and non-convex faces are skipped and the
result is `partial`; overlapping planar display regions may be reported as
`issues` without discarding the geometry. Triangulations over 400 triangles are
skipped with `triangle-budget` to keep live rebuilds bounded.

## Script verification only

```sh
node tools/edc.js tools/scripts/quarter-arc.edu
node tools/edc.js --strict tools/scripts/ruled-chain.edu
node tools/edc.js --solid tools/scripts/mixed-curved-plate.edu
node tools/edc.js tools/scripts/overlapping-curve-projections.edu
node tools/edc.js tools/scripts/partial-hidden-edge.edu
node tools/edc.js tools/scripts/inferred-profile-frame.edu
node tools/edc.js tools/scripts/sphere.edu
node tools/edc.js tools/scripts/spherical-recess.edu
node tools/edc.js tools/scripts/spherical-recess-shallow.edu
node tools/edc.js tools/scripts/spherical-recess-elevation-mouth.edu
node tools/edc.js tools/scripts/spherical-recess-open.edu
node tools/edc.js tools/scripts/spherical-recess-conflict.edu
node tools/edc.js tools/scripts/oblique-circle.edu
node tools/edc.js tools/scripts/oblique-line-circle.edu
node tools/edc.js tools/scripts/oblique-line-elevation-plan.edu
node tools/edc.js tools/scripts/oblique-line-conflict.edu
node tools/edc.js tools/scripts/oblique-quarter-arc.edu
node tools/edc.js tools/scripts/oblique-major-arc.edu
node tools/edc.js tools/scripts/oblique-arc-line.edu
node tools/edc.js tools/scripts/oblique-arc-line-slanted.edu
node tools/edc.js tools/scripts/oblique-arc-line-elevation-plan.edu
node tools/edc.js tools/scripts/oblique-arc-line-profile.edu
node tools/edc.js tools/scripts/oblique-major-arc-line.edu
node tools/edc.js tools/scripts/oblique-arc-line-conflict.edu
node tools/edc.js tools/scripts/truncated-cylinder.edu
node tools/edc.js tools/scripts/truncated-cylinder-opposite.edu
node tools/edc.js tools/scripts/truncated-cylinder-profile.edu
node tools/edc.js tools/scripts/truncated-cylinder-depth-axis.edu
node tools/edc.js tools/scripts/truncated-cylinder-mismatch.edu
node tools/edc.js tools/scripts/truncated-cylinder-missing-surface.edu
node tools/edc.js tools/scripts/truncated-cylinder-ambiguous.edu
node tools/edc.js tools/scripts/cone-oblique-boundary.edu
node tools/edc.js tools/scripts/cone-oblique-profile.edu
node tools/edc.js tools/scripts/cone-oblique-plan.edu
node tools/edc.js tools/scripts/cone-oblique-edge-on.edu
node tools/edc.js tools/scripts/cone-oblique-conflict.edu
node tools/edc.js tools/scripts/surface-intersect-planes.edu
node tools/edc.js tools/scripts/surface-intersect-spheres.edu
node tools/edc.js tools/scripts/surface-intersect-sphere-plane.edu
node tools/edc.js tools/scripts/surface-intersect-cylinders.edu
node tools/edc.js tools/scripts/surface-intersect-sphere-cylinder.edu
node tools/edc.js tools/scripts/spline-through.edu
node tools/edc.js tools/scripts/spline-reversed.edu
node tools/edc.js tools/scripts/spline-closed.edu
node tools/edc.js tools/scripts/spline-profile.edu
node tools/edc.js tools/scripts/spline-elevation-profile.edu
node tools/edc.js tools/scripts/spline-three-view.edu
node tools/edc.js tools/scripts/spline-conflict.edu
node tools/edc.js tools/scripts/spline-third-view-conflict.edu
node tools/edc.js tools/scripts/spline-ambiguous.edu
node tools/edc.js tools/scripts/spline-missing-view.edu
node tools/edc.js tools/scripts/spline-multiple.edu
node tools/edc.js tools/scripts/spline-multiple-identity.edu
node tools/edc.js tools/scripts/spline-multi-view.edu
node tools/edc.js tools/scripts/spline-multiple-ambiguous.edu
node tools/edc.js tools/scripts/spline-multiple-conflict.edu
node tools/edc.js tools/scripts/circle-through.edu
node tools/edc.js tools/scripts/arc-through.edu
```

`--strict` now selects explicit correspondence constraints in the shared pipeline;
it does not switch to a different surface-family reader. Existing declared
inconsistencies still reject. With an incomplete explicitly required point, the
strict adapter can report the model as underdetermined; the automatic adapter
can retain the resolved wire and report that point separately.

In addition to existing topology expectations, scripts can assert `curves`,
`minRadius`, `maxRadius`, `topHidden`, `splitHidden`, `profileInferred`,
`oblique`, `obliqueReprojection`, `spheres`, `surfaceValidation`, `surfaces`,
`surfaceKinds`, `surfaceLoops`, `surfaceShells`, `surfaceOpen`,
`surfaceBoundary`, `surfaceModel`, `recesses`, `obliquePoints`,
`obliquePointFit`, `obliqueArcs`, `arcSweep`, `obliqueVisibility`,
`obliqueVisibilityFit`, `parametricCurves`, `curveFit`, `curveReprojection`,
`curvePreview`, `throughEdit`, `diagnostics`, `unresolved`, and `status`:

```
# expect: 48V 72E 26F curves=2 minRadius=10 maxRadius=20 unresolved=0 status=inferred
# expect: 6V 5E 1F topHidden=1 splitHidden=1
# expect: 24V 24E 1F profileInferred=1
# expect: 86V 252E 168F spheres=1
# expect: 48V 72E 26F curves=2 surfaces=3 surfaceKinds=cylinder,plane surfaceLoops=4 surfaceShells=1 surfaceOpen=0 surfaceBoundary=0 surfaceModel=ok surfaceValidation=ok unresolved=0 status=inferred
# expect: parametricCurves=1 curveFit=ok curveReprojection=ok curvePreview=ok throughEdit=ok diagnostics=curve-surface-unresolved status=partial
```

`unresolved` counts reported diagnostics. A missing-view script may deliberately
expect an unavailable result. No separate unit-test files or suites are added.
`obliqueReprojection=ok` checks source segment endpoints against the analytic
circle projected into each source view, independently of display tessellation.
`obliquePoints` counts retained point constraints; `obliquePointFit=ok` checks
their positions against the analytic circle. `diagnostics` asserts sorted,
comma-separated diagnostic codes, or `none`.
`obliqueArcs` counts analytic oblique arcs; `arcSweep` lists their rounded sweeps
in degrees. Reprojection checks include arc membership, not just the supporting
ellipse. `obliqueVisibility` counts curves carrying visibility evidence, and
`obliqueVisibilityFit=ok` rechecks source-stroke midpoints against the final model.
`parametricCurves` counts accepted NURBS boundaries. `curveFit=ok` re-evaluates
each interpolation point through its control points; `curveReprojection=ok`
samples the 3D curve back into every source view; `curvePreview=ok` validates
the persisted reference preview; `throughEdit=ok` moves a defining station and
confirms the curve was rebuilt from it rather than keeping stale control points.

## Remaining work

This starts the agreed pipeline; it is not complete reconstruction for every
geometric solid. Full-circle inclined traces, closed and open ellipse/edge-on
This starts the agreed pipeline; it is not complete reconstruction for every
geometric solid. Full-circle inclined traces, closed and open ellipse/edge-on
line pairs, inclined circular cone bases with tangent generators, spherical
recesses, exact analytic surface–surface intersections for the supported plane,
sphere, parallel-cylinder and axis-through-centre sphere–cylinder families, and
a first bounded plane/cylinder/cone/sphere model are implemented. Important
next capabilities are oblique cones and non-circular elliptical bases,
cylindrical and torus fillets, merging a recess mouth into a surrounding face's
inner loop, broader skew-axis surface intersections, and certification of the
analytic surfaces rather than only their display triangles. Spheres, spherical
recesses, two-view oblique circles, elliptical arc chains, arc/line pairs, and
interpolated station curves with cross-view consistency checks are supported;
other curved families are not. Profile frames are inferred when necessary, and
overlapping projections are resolved when a declared view selects one
interpretation; contours that remain genuinely ambiguous between the available
views stay unresolved. The current planar/ruled surface choices are stated
inference conventions, not a proof of uniqueness. Analytic curve rendering and
the solid widget's interval drawing still use tessellation, and numeric
robustness at extreme scales remains work to do.

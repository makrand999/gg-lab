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

A circle in a general plane projects as an ellipse. `educad-oblique-kernel.js`
groups closed elliptical loops, fits their centres/axes, recovers each plane
normal from the major/minor axes, and combines centers from two views. The
projected ellipse fixes the normal up to a mirror in depth, so a two-view
oblique circle is retained with `oblique-curve-ambiguous` unless further
visibility or point evidence selects one mirror. The reconstructed curve uses
the same analytic curve representation as principal circles.

Standalone planar circular boundaries share the planar containment/hole engine
with straight boundaries. Open arcs remain curves with no automatically invented
spanning surface. Independent straight components can coexist with curved ones.
Resolved geometry remains visible when another curve cannot be reconstructed;
`topologyStatus: 'partial'` and entity-specific diagnostics identify that omission.

## Representation and display

`geometry.curves` stores analytic definitions: `kind`, `center`, unit basis
vectors `u` and `v`, `radius`, `startAngle`, and `sweepAngle` (angles in radians).
A point on a curve is:

```
center + radius * (u * cos(angle) + v * sin(angle))
```

Each curve records `sourceIds` and its display vertex/edge indices.
`geometry.surfacePatches` records planar or ruled patches and their circular
boundaries, generators' source IDs, or apex. These definitions are separate from
the mesh used by the existing renderer. A full circle currently uses 24 display
segments; script V/E/F counts describe that display geometry, not the count of
analytic primitives. Reference previews preserve the analytic definitions.

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
node tools/edc.js tools/scripts/oblique-circle.edu
```

`--strict` now selects explicit correspondence constraints in the shared pipeline;
it does not switch to a different surface-family reader. Existing declared
inconsistencies still reject. With an incomplete explicitly required point, the
strict adapter can report the model as underdetermined; the automatic adapter
can retain the resolved wire and report that point separately.

In addition to existing topology expectations, scripts can assert `curves`,
`minRadius`, `maxRadius`, `topHidden`, `splitHidden`, `profileInferred`,
`curves`, `oblique`, `spheres`, `surfaceValidation`, `unresolved`, and `status`:

```
# expect: 48V 72E 26F curves=2 minRadius=10 maxRadius=20 unresolved=0 status=inferred
# expect: 6V 5E 1F topHidden=1 splitHidden=1
# expect: 24V 24E 1F profileInferred=1
# expect: 86V 252E 168F spheres=1
```

`unresolved` counts reported diagnostics. A missing-view script may deliberately
expect an unavailable result. No separate unit-test files or suites are added.

## Remaining work

This starts the agreed pipeline; it is not complete reconstruction for every
geometric solid. Important next capabilities are mirror-disambiguated oblique
circles/arcs, arbitrary cross-view arc correspondence, curved recesses/fillets
and general curved patches, curved intersections, and certification of the
analytic surfaces rather than only their display triangles. Spheres and
two-view oblique circles are supported; other curved families are not.
Profile frames are inferred when necessary, and overlapping projections are
resolved when a declared view selects one interpretation; contours that remain
genuinely ambiguous between the available views stay unresolved. The current
planar/ruled surface choices are stated inference conventions, not a proof of
uniqueness. Analytic curve rendering and the solid widget's interval drawing
still use tessellation, and numeric robustness at extreme scales remains work
to do.

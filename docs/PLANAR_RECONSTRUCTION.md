# Shared planar surface previews

Major's public `reconstruct` pipeline and the compatibility adapters use the same
planar surface engine after resolving vertices and edges. Explicit member IDs
still determine correspondence. Strict coordinate/incidence validation runs
first; failures are never bypassed. Explicit topology declarations remain
authoritative and are not replaced by inferred faces.

The strict kernel in `educad-strict.js` and its exact certificate remain
unchanged. For an explicit wire with no topology declaration, the wrapper saves
the certified geometry as `declaredGeometry` and returns the inferred display in
`geometry`. The certificate applies to `declaredGeometry`; inferred faces and
volumes are not certified solids. `geometry.topologyStatus` identifies this
preview. The UI labels it as inferred.

## Algorithm

- Discover supporting planes from noncollinear incident edge pairs, without
  enumerating short cycles.
- Split collinear edges at existing spatial vertices. Build planar embeddings
  with deduplicated crossings, endpoint junctions and overlapping segments.
- Trace planar boundaries and group disconnected nested loops by containment.
  A logical face has `outer` and `holes`. Even/odd nesting is the preview's
  material convention; it does not prove the meaning of an ambiguous drawing.
- Partition candidate faces by shared boundary-edge constraints (including
  hole boundaries), then search subsets. Prefer a closed shell within each
  group; otherwise permit a manifold surface with boundary. Maximize covered
  candidate edges, then face count. Check vertex links as well as edge usage.
- Report tied optima as `ambiguous-surface`, a search budget exhaustion as
  `search-limit`, and invalid winding/vertex links/zero-volume shells as
  `invalid-surface`. These cases retain wire geometry instead of displaying a
  guessed face subset. The deterministic search budget is 250,000 nodes.
- Propagate winding across shared edges and orient closed components using
  signed volume, allowing concave polyhedra. Preserve separate wire components.

`faceRegions` contains logical faces. `faces` and parallel `faceHoles` contain
display loops, including both orientations of open surfaces. Hole boundaries
participate in adjacency, filled display, reference previews, pose previews,
and orthographic visibility. Visibility uses polygon containment with holes,
but still samples each edge at its midpoint; it does not split an edge into
partially hidden/visible intervals.

## Script verification

No unit-test suite was added. `.edu` and `.edc` both use the existing runner:

```sh
node tools/edc.js tools/scripts/through-hole.edu
node tools/edc.js --strict tools/scripts/through-hole.edu
node tools/edc.js --solid tools/scripts/plate-hole.edu
```

Expectation comments fail the process on mismatch:

```text
# expect: 16V 24E 10F holes=2 closed=1 open=0 boundary=0
```

`F` counts logical faces, not front/back display duplicates or triangles used
to display a polygon. Other properties are `components` (connected topology,
including the connection between an outer boundary and its holes), `holes`
(number of inner face loops), `closed` and `open` (surface components),
`boundary` (edges used by exactly one logical face), `topHidden`, `frontHidden`,
and `status`. Wire-only components count toward `components`, not `open`.
`closed`/`open` describe the shared planar engine or explicit certified surfaces;
legacy analytic curve meshes do not yet provide these component summaries.
Malformed or unknown expectations also fail. Without expectations, CLEAN still
only describes command/projector validity.

The `.edu` probes cover larger plates, a 20-face prism, nested plates, a
polygonal through-hole, mixed solid/plate/wire components, concave prisms,
hidden-line strokes, collinear overlap, a boundary T-junction, visibility
through a hole versus behind material, and the existing cone reader. Polyhedral
probes can run through both live and strict adapters. The shared primitive pipeline now reconstructs the cone probe from its circular
boundary and straight generators in both correspondence modes. The low-level
strict v1 kernel still only certifies explicitly declared straight geometry.

## Limits

This is a general planar preview engine, not a complete CAD inference kernel.
It does not prove that the input has a unique physical interpretation. It uses
floating-point geometric tolerances and does not perform the strict kernel's
exact pairwise surface-intersection certification on inferred polygon regions.
Complicated intersecting/touching contours and incomplete drawings may remain
wire-only or unresolved. It does not infer arbitrary curved surfaces,
cylindrical/torus fillets, threads, section semantics, dimensions, or
not-to-scale geometry. The shared pipeline supports an initial
circular-boundary/ruled-surface family, spherical recesses, and a bounded
analytic surface model; see [Primitive reconstruction](PRIMITIVE_RECONSTRUCTION.md)
and [Bounded analytic surface model](SURFACE_MODEL.md). Older named readers
remain only in compatibility APIs. Explicit triangular surfaces retain
the stronger exact contract documented in RECONSTRUCTION_CONTRACT.md.

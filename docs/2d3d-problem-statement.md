# Problem Statement — 2D ⇄ 3D Connection (EduCAD)

Status: **Locked** (scope decisions resolved)
Date: 2026-09-20

## 1. Current condition (baseline)

- EduCAD is a first-angle Monge sheet: one mm world, elevation (VP) normally above
  XY, plan (HP) normally below XY, hard invariant `elev.x == plan.x`
  (`educad-entities.js:221-232`).
- Every entity carries `viewRole ∈ {PLAN, ELEVATION, BOTH}`, but nothing consumes
  it for 3D.
- The 3D widget is a self-contained hardcoded unit cube (`educad-solid.js:44-68`);
  `project()`, `classifyEdges()`, `render()` read those constants directly. It is
  mounted once (`index.html:1034`) with `{size:260}` and is never fed drawing data
  and never re-rendered on table changes.

## 2. Goal

The 3D widget displays the 3D object described by the views drawn on the 2D sheet:

1. A drawing containing a plan view and an elevation view resolves to a 3D
   wireframe consistent with the drawn mm dimensions.
2. The 3D view updates live when the drawing changes.
3. Orbit, zoom, reset, hidden-edge styling, and the pen-sketch look are preserved;
   pointer isolation of the widget is preserved.

**Decision: general inference first.** Reconstruction works from the drawn
geometry itself (hand-drawn or curriculum-generated), not from a hidden 3D
generator description. Curriculum solids are 2D drawings like any other.

## 3. Interpretation contract (the condition for reconstruction)

### 3.1 Coordinate mapping

For a 3D point `(x, d, h)` — `x` = sheet x, `d` = depth in front of VP,
`h` = height above HP:

| View      | Sheet position |
|-----------|----------------|
| Elevation | `(x, h)`       |
| Plan      | `(x, -d)`      |

Reconstruction: `x = sheet x`, `h = elevation y`, `d = -plan y`.
Widget space: `(X, Y, Z) = (x, elevY, -planY)` with Y up and Z toward the viewer.
The mapping is universal — Q3/Q4 lessons legitimately produce negative
heights/depths; no clamping.

Verified against `quadrantPoint` (`curriculum.js:141-144`) and `straightLine`
(`TL² = dx² + dh² + dd²`, `curriculum.js:207-214`).

### 3.2 Input filter

Include: `POINT, SEGMENT, LINE, RAY, CIRCLE, CIRCULAR_ARC`.
Exclude: `DIMENSION, TEXT, DATUM_AXIS`, and `meta.kind ∈ {projector, locus, axis}`.
Also exclude sheet-vertical segments crossing XY (projector helpers, regardless
of `meta.kind`).

### 3.3 View classification

`viewRole` is authoritative when `PLAN` or `ELEVATION`. `BOTH` is classified by
geometry: upper half (y > 0) = elevation, lower half (y < 0) = plan. User-drawn
lines are created as `BOTH` (`index.html:275-279`), so this fallback is required.

### 3.4 Normalization

Sheet mm (e.g. 35–70 mm, offset from origin) is centered and uniformly scaled
into the 260 px stage; aspect ratio preserved. mm stay authoritative; px is
ephemeral.

## 4. Reconstruction model (M1)

### 4.1 Supported drawing classes

- **Class A — prismatic:** a closed planar profile in plan + a vertical extent
  `[z0, z1]` in elevation covering the profile's x-range. Solid = profile swept
  vertically. (Box, hexagonal prism, cylinder*.)
- **Class B — pyramidal:** a closed planar profile in plan + a matching apex in
  both views. (Square pyramid, cone*.)
- **Class C — wireframe:** point/line lessons. Paired vertices + edge matching
  produce a 3D wireframe, no faces.
- Anything else → explicit "3D unavailable" state with a reason.

*Curves are deferred to a later tier; until then circle/arc drawings report
"curves not supported yet".

### 4.2 Pipeline

1. Snapshot visible geometry entities; apply the input filter (§3.2).
2. Classify each entity into ELEV or PLAN (§3.3).
3. Build a 2D graph per view: welded vertices (`COINCIDENT_TOL_MM = 1e-6`) and
   edges.
4. Candidate 3D vertices: plan vertex `(x, -d)` + elevation vertex `(x, h)` with
   `|Δx| ≤ eps` → `(x, d, h)`.
5. Candidate 3D edges: match edges across views by shared x-interval and
   consistent `Δx`; degenerate projections pin the missing coordinate (a
   vertical 3D edge collapses to a point in plan; a depth edge collapses to a
   point in elevation).
6. Assemble per class (A: profile sweep; B: profile + apex; C: edge graph).
7. Derive faces where possible for hidden-line classification. If faces cannot
   be derived, render all edges solid and flag `hiddenLine: false`.
8. Emit `{vertices, edges, faces, warnings[]}` + normalization transform.

### 4.3 Invariant: round-trip projection

Reconstructed geometry must project back onto the drawn views within eps:
`project3d → elevation` must reproduce every elevation edge, and
`project3d → plan` every plan edge. This is the acceptance gate for any
candidate interpretation.

### 4.4 Ambiguity and failure rules

- Ambiguity must be **detected and reported, never silently guessed**.
- Deterministic tie-breaks (documented and tested): maximize edge coverage
  across both views, then minimize total edge length.
- Failure states: missing view, no closed profile, x mismatch beyond eps,
  ambiguous pairing, non-manifold/self-intersecting geometry, unsupported
  curves. Each maps to a named state shown in the widget (no crash, no silent
  garbage).

## 5. Live sync contract

- Add a change subscription to `CadEntityTable` (`add/remove/update/move/clear`
  fire a listener). The app subscribes and schedules a 3D rebuild, coalesced to
  one frame (RAF).
- Rebuild = reconstruct from the current table + push geometry to the widget.
- Clearing the sheet clears 3D; loading a demo updates 3D without page reload.
- 3D truth is derived and ephemeral — never persisted on entities.

## 6. Deliverables

- **D1** — generic 3D geometry model + renderer in `educad-solid.js`
  (`createGeometry`, `setGeometry`, face-based hidden-line classification). The
  cube remains the default geometry so the 55 phase-9 tests stay green.
- **D2** — `educad-reconstruct.js` (new): view classification, graph building,
  pairing, Class A/B/C assembly, round-trip validation, named failure states.
- **D3** — table change subscription + live rebuild bridge in `index.html`.
- **D4** — curriculum prism becomes a true hexagonal prism (2D only), matching
  the existing "Hexagonal Prism (35mm)" button label.
- **D5** — tests: reconstruction unit tests (mapping, sweep, apex, ambiguity,
  failure states, round-trip), `setGeometry` widget tests, live-sync integration
  tests. All 448 existing tests stay green. Zero new dependencies; Node-safe.

## 7. Non-goals (M1)

Third-angle interpretation (marker exists; later), curves (cylinder/cone
surfaces, tessellation), perspective, shading/fills/lighting, booleans,
sections, 3D dimensions, export, general two-view reconstruction of arbitrary
ambiguous drawings.

## 8. Acceptance criteria (M1)

1. Hexagonal prism demo: 3D shows a true hexagonal prism (12 vertices, 18 edges)
   at drawn proportions (35 mm across corners, 70 mm high); hidden edges correct
   under orbit.
2. Hand-drawn plan + elevation rectangles → box in 3D.
3. Pyramid demo → pyramid with apex.
4. Quadrant point/line lessons → 3D point/line wireframe, not an error.
5. Add/move/delete/clear updates 3D within one frame; no stale geometry.
6. Ambiguous or incomplete drawings → named "3D unavailable" state; no crash.
7. Round-trip projection invariant holds for every accepted reconstruction.
8. Orbit/zoom/reset, pointer isolation, transparent pen style unchanged.
9. `npm test` fully green (448 existing + new).

## 9. Decision log

| # | Decision | Choice |
|---|----------|--------|
| 1 | M1 reconstruction source | General inference first (T0+T2); curriculum solids are ordinary 2D drawings |
| 2 | Update model | Live on every table change, RAF-coalesced |
| 3 | Prism demo | Make it truly hexagonal (35 mm, 70 mm high) |

Deferred: curve fidelity (tessellated vs analytic), third-angle timing.

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
Also exclude sheet-vertical segments crossing XY or running from XY into
the plan half (projector helpers, regardless of `meta.kind`). Single-sided
verticals (edges ending on XY from above) stay geometry.

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
- **Class E — claimed lamina (M5):** where C fails, projector claims identify
  corners explicitly (one claim = one 3D corner); v1 builds profile laminae
  whose face is the convex hull in (depth, height).
- Anything else → explicit "3D unavailable" state with a reason.

*Full-circle plan drawings reconstruct as Class D solids (§11); arc-only
sheets report "curves not supported yet".

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

## 7. Scope note (M1)

M1 shipped the two-view scope in §§3–6. The third view (§10) and curve
support (§11) followed as amendments; §§12–14 record the lesson layer.

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

## 10. Third view — side/profile reading (M2 amendment)

A first-angle side (profile) view joins plan and elevation as an optional
third input. Two-view behavior is unchanged: sheets without a profile view
follow §3–§4 exactly.

### 10.1 Roles and classification

- `viewRole` gains `PROFILE`, honored outright wherever the entity sits.
- Untagged (`BOTH`) upper geometry splits by plan-x overlap: entities
  overlapping the plan x-range stay elevation; a disjoint upper cluster is
  the profile view. The split commits only when confirmed (tagged PROFILE,
  or an untagged cluster with a drawn segment whose width matches the plan
  depth span and whose height matches the elevation); otherwise the legacy
  two-view reading applies exactly.
- Entities exactly on XY keep the §4.4 variant rule; in a confirmed
  three-view sheet, on-datum spanners drop as helpers and disjoint
  on-datum lines join the profile view.

### 10.2 Reference line and depth mapping

- Plan depth `d = -planY` reads in the profile at `x'(d) = xRef + s·(d − d0)`
  with `s ∈ {+1, −1}`, `d0` the near plan-depth edge, and `xRef` the drawn
  reference edge. Heights are shared with the elevation.
- Both orientations are tried in fixed order (direct, then mirrored)
  against the drawn profile; the first passing map wins. Geometry derives
  from plan/elevation alone, so dual-pass maps yield identical solids and
  the pick is deterministic, never a guess. Two failing maps report the
  direct map's named failure.

### 10.3 Helper filtering

Kept alongside the §3.2 drops, and only on confirmed three-view sheets:
untagged horizontal front↔side projectors (entities straddling the
elevation/profile boundary), untagged 45° miter diagonals below XY that sit
clear of the plan and reach the datum on the profile's side, and
`meta.kind` axes as before. Tagged solid geometry is never helper-dropped.
Dropped helpers surface as a `helpers-ignored` warning.

### 10.4 Solvers and acceptance gate

- Class A/B: the plan-loop depth span maps into the profile; outline,
  stations/slants/apex, hidden-line containment, and drawn points must all
  agree, mirroring the elevation rules. Class C: the lifted wireframe must
  project onto the drawn profile both ways (drawn geometry explained,
  projected geometry drawn).
- No new failure reasons: profile disagreements reuse `x-mismatch`,
  `unmatched-edge`, `unmatched-point`, `ambiguous-pairing`, and
  `coverage-failed`. `projectToViews` takes an optional `{xRef, s, dRef}`
  map; `coverage` gains a `profile` key only when a profile view exists.
- Gate: round-trip coverage ≥ 0.999 in plan, elevation, and profile.

## 11. Curves — vertical cylinders and cones (M3 amendment)

This section amends §4.1/§7: full-circle cylinders/cones now reconstruct
as Class D; arc-only sheets report `unsupported-curves`.

### 11.1 Scope lock

Full `CIRCLE` only, vertical-axis solids of revolution (plan circle +
elevation silhouette: rectangle = cylinder, triangle + apex = cone).
`CIRCULAR_ARC` reports `unsupported-curves` when load-bearing,
`curves-ignored` otherwise. No new failure reasons.

### 11.2 Class D pairing

Attempted when the plan has no polygon loop but carries exactly one
`A`/`B` plan circle. Two plan circles report `ambiguous-pairing`.
A `B` center/apex point at the circle center is required for cones
and tolerated for cylinders (within weld tolerance). Cross-view checks
within 0.5 mm: center-x vs silhouette center-x, radius vs half-width
(`x-mismatch`); silhouette mirrors Class A (cylinder base/top/sides)
and Class B (cone base/slants/apex); `E` edges contained; profile (when
present) maps the circle depth span through the §10.2 depth map, both
orientations tried, first pass wins.

### 11.3 Tessellation and gate

Rim circles tessellate to a fixed K = 24-gon; vertex 0 at angle 0 (+X
from the axis), subsequent vertices counter-clockwise seen from +Y.
Cylinder: 48 vertices / 72 edges / 26 faces. Cone: 25 vertices / 48
edges / 25 faces. Faces feed the existing hidden-line classifier;
`projectToViews` is unchanged. The drawn circle is covered by
construction after the §11.2 checks pass; silhouette coverage ≥ 0.999
in plan, elevation, and profile. Class D competes by coverage, then
edge length; ties report `ambiguous-pairing`.

## 12. Verify-only lesson layer (M4 amendment)

Student verdicts and projector claims are checked, never derived:

- Multi-caption points (`a,b`) name coincident corners; parens (`a,(b)`)
  record the student's hidden verdict for that view. The name gate
  (§4.4 pair-by-name) compares bare part sets and strips parens, so
  typing verdicts can never break reconstruction.
- Anchoring a line on a multi-caption point asks which member the student
  draws for; the declaration is stored as `meta.fromMember` alongside the
  existing `meta.refs`. Reconstruction ignores both.
- `educad-verify.js` grades verdicts and claims against curriculum corner
  truth. Without truth (hand drawings) everything reports `unverifiable`,
  never a guess. Profile verdicts report `unchecked-view`.

## 13. Claimed corners — Class E corner-lift (M5 amendment)

Class C pairs whole vertices 1:1, which cannot express coincident corners
(one elevation dot yielding two corners at different plan feet). Where C
fails, Class E lifts corners from projector claims instead:

- One claim (projector-shaped line + `fromMember` + station/foot refs) =
  one 3D corner at (x̄, h, d) from its plan and elevation feet. Claims on
  non-projector lines are ignored (the checker flags them); claims apply
  always, since hand drawings have no Check truth to gate on.
- Class E builds profile laminae only: all corners share x
  (`corners-not-coplanar` otherwise), number ≥ 3, all on their convex hull
  in (depth, height) (`non-convex-corners` otherwise, collinear included).
- Wrong pairings fail loudly: same corner twice (`hint-conflict`), feet off
  drawn vertices (`hint-loose-foot`), two corners lifting to one point
  (`duplicate-corners`). Coverage is checked both directions per view
  against drawn A/B ink through the standard gate.
- E attempts only when no geometric class passes and claims exist, so hints
  rescue ambiguity but never compete with a success. Profile ink is ignored.
  The lamina face is emitted double-wound (no interior to hide).

## 12. Names are absolute — pair-by-name (M4 amendment)

This section amends §4.2 step 4: cross-view pairing follows POINT
labels, not bare x-stations.

### 12.1 Base names

Plan `a`, elevation `a'`, and profile `a''` share the base `a`
(caption trimmed, trailing prime ticks `'`, `′`, `’` stripped) and
name one 3D point. Only genuine `POINT` entities name a vertex;
segment captions (edge names like `ab`) never do.

### 12.2 Pairing rule

A plan vertex and an elevation vertex at one x-station pair when they
share a base; the shared x (within eps) validates the pair, it no
longer selects it. Names resolve geometric ambiguity (two labeled
dots per view at one station pair by base); multi-labeled end-on dots
still read as vertical/depth pins. A named vertex whose base-mate
sits at another station is `x-mismatch` at any distance; one letter
on two dots is `ambiguous-pairing`, never a guess. Unlabeled vertices
keep the exact §4.2 geometric reading.

### 12.3 Gate and profile

Before class attempts, any shared station labeled on both sides must
agree on at least one base, else the new `name-mismatch` reason;
every profile base must name a plan/elevation base. The gate adds the
first new failure reason since M1; all other reasons are unchanged.
`reconstruct(entities, { strictNames: false })` restores the legacy
pure-geometric pairing for programmatic use. Curriculum profile apex
labels read `s''` (not `pf-s`).

## 14. The honest solid — prism lesson (M6 note)

Not every stacked station needs a claim. The hexagonal prism's
elevation pairs (front+back at one x) resolve geometrically: Class C
pairs whole vertices 1:1 by base name, and the 3D solid builds the
moment ink + names are complete — verdicts and projectors are
Check-only. The `Tutorial: Prism` lesson pins this in 88 scripted
user steps ending 18/18 (14 stations + 4 projector wellformed
checks) with zero `fromMember` claims: claims are the square's
rescue for coincident corners, not a ritual every sheet must repeat.

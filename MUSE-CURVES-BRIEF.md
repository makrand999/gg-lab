# MUSE TASK: Add curve (cylinder/cone) support to the EduCAD 2D→3D reconstruction engine

You are the implementer and verifier of this feature. Work only inside this repository
(`/root/major/gg-lab`, Node, zero dependencies). Read the code first, implement, prove the
result with tests, and end with a concise report. Do not commit or push; leave the working
tree dirty for review.

## 0. Execution notes (read first)

- Work in **small increments**, not one giant step. Suggested milestones:
  M1: circle pairing + Class D cylinder (2-view) + tests.
  M2: Class D cone + profile-view validation for both + tests.
  M3: arc policy + failure hygiene + tessellation goldens + tests.
  M4: 3-point circle gesture (pick list + geometry + wiring) + tests.
  M5: docs (problem statement + targeted manual edits) + full `npm test`.
- After each milestone run the relevant test file, then continue. Do not rewrite
  modules in one shot; make surgical edits to `educad-reconstruct.js` (and the
  small additive branches elsewhere) and keep the existing code style (ES5 `var`,
  function expressions, no classes/arrow functions).
- Do not delete or weaken existing behavior except the one pre-authorized change
  below (phase10 test 28). The straight-edge contract must stay bit-for-bit
  compatible; the current suite is 544/544 green before you start.
- If a design decision is genuinely ambiguous, choose the option that keeps
  straight-edge behavior identical, and state the decision in your report. Do not
  ask for user input.
- Baseline check before editing: the M2 third-view work is merged, `npm test`
  is 544/544 green, and `git status --short` shows nothing but this brief file.
  If you see other modifications or a red suite, stop and report.

## 1. Background

EduCAD is a first-angle Monge drawing sheet with live 2D→3D reconstruction
(plan + elevation + optional PROFILE side view) into the 3D widget
(`mirror/index.html` bridge; `educad-reconstruct.js` engine, ES5, dual-env
`module.exports` + `window.EduCADReconstruct`).

Curves are the last deferred tier, and the deferral points are explicit:

- `filterEntities` keeps `POINT, SEGMENT, LINE, RAY` for solving and diverts
  `CIRCLE`/`CIRCULAR_ARC` to a `curves` list (with `dropped` counters).
- `solveFor` reports `unsupported-curves` when no plan loop exists and curves
  are present; successful drawings containing curves get a `curves-ignored`
  warning (not displayed by the page).
- `C.regularSolid({solid:'CYLINDER'|'CONE'})` emits a plan circle (center
  `(xMm, planYc)`, `r = sizeMm/2`, `PLAN`, `A`) plus a center/apex point and
  an elevation silhouette: rectangle + hidden base `E` (cylinder) or triangle
  + apex point + hidden base `E` (cone). Axes, loci, and projectors carry
  droppable `meta.kind`.
- `tools/test-phase10-reconstruct.js:28` pins the deferral: cylinder and cone
  bundles reconstruct to `status: 'unavailable', reason: 'unsupported-curves'`.
- The 2D→3D problem statement is `docs/2d3d-problem-statement.md` (§4.1 and
  §7 defer curves; §10 covers the M2 third view); the user manual is
  `docs/MANUAL.md` (built to `mirror/manual.html` via `npm run build:manual`,
  freshness enforced by `tools/test-phase11-manual.js`).
- Tests run via `npm test` (currently 544/544 green; last script is
  `tools/test-phase12-reconstruct-3view.js`, 30 tests). Tests are the
  executable spec.

## 2. Validated defect (already reproduced; do not re-litigate)

The two most teaching-relevant solids after box and pyramid cannot show in 3D:

```
C.regularSolid({solid:'CYLINDER', sizeMm:35, heightMm:70, xMm:0}).entities
  → status 'unavailable', reason 'unsupported-curves' (kept 6, curves 1)
C.regularSolid({solid:'CONE', ...}) → identical verdict
```

- Plan circle `(0,-25.5)` r=`17.5` never pairs with the elevation silhouette.
- `threeViewSheet` throws `threeViewSheet covers PRISM/PYRAMID only`, so no
  3-view cylinder/cone sheet can even be generated.
- Reference observations (recreate as tests; the first two must flip):
- 2-view cylinder / cone bundles: `unsupported-curves`.
- Arc-only sheet (single `CIRCULAR_ARC`, no polygon loop): `unsupported-curves`
  (must STAY deferred — arcs are out of scope).

## 3. Goal (M3)

Support vertical-axis **cylinders and cones** end-to-end: circle pairing,
tessellated 3D solids, 2-view and 3-view validation, round-trip coverage,
named failures. Straight-edge behavior must be unchanged.

### 3.1 Scope lock (do not expand)

- Full `CIRCLE` entities only. `CIRCULAR_ARC` stays deferred exactly as today
  (`unsupported-curves` when load-bearing, `curves-ignored` warning otherwise).
- Vertical-axis solids of revolution only: plan circle + elevation silhouette
  (rectangle = cylinder, triangle + apex = cone). No tilted axes, no ellipses,
  no partial rims, no toroidal or freeform curves.
- No new failure reasons. Curve disagreements reuse `x-mismatch`,
  `unmatched-edge`, `unmatched-point`, `ambiguous-pairing`,
  `coverage-failed`; `unsupported-curves` remains for arcs and non-circle
  curves. Keep `REASON_LABELS` and `FAIL_PRIORITY` untouched.

### 3.2 Class D (revolved) recognition and validation

- Attempt Class D when the plan has no polygon loop but carries exactly one
  `A`/`B` plan circle (a `B` center/apex point at the circle center is
  expected for cones and tolerated for cylinders). Competing circles
  (two plan circles) report `ambiguous-pairing`, never a guess.
- Cross-view consistency (all within `MATCH_EPS_MM = 0.5` unless noted):
  - circle center-x vs elevation silhouette center-x;
  - circle radius vs elevation silhouette half-width (`x-mismatch` on failure);
  - elevation silhouette checks mirror Class A (cylinder: drawn base/top and
    both side verticals, no interior stations required) and Class B (cone:
    drawn base, both slants, apex point on the top line at the plan apex x);
  - `E` edges contained in the silhouette (cylinder/cone hidden base);
  - plan center/apex point within the circle's weld tolerance of its center.
- Profile view (when present): the circle's depth span `[-(yc+r), -(yc-r)]`
  maps through the M2 depth map; cylinder profile is a rectangle over the
  mapped span × `[z0, z1]`, cone profile is base + slants to the mapped apex
  depth. Rules mirror §3.2 elevation checks; both orientations tried,
  first pass wins, direct map's failure reported on dual failure.
- Helpers (projectors, miter, reference axis) filter exactly as in M2; no new
  helper rules.

### 3.3 Tessellation (exact, deterministic)

- Rim circles tessellate to a fixed **K = 24-gon**; rim vertex 0 sits at angle
  0 (+X from the axis), subsequent vertices counter-clockwise seen from +Y.
- Cylinder from `(xc, r, z0, z1)`: two 24-gon rims + side quads + two cap
  faces → exactly **48 vertices / 72 edges / 26 faces**.
- Cone from `(xc, r, z0, apex(xa, z1))`: one 24-gon rim + apex + side
  triangles + base cap → exactly **25 vertices / 48 edges / 25 faces**.
- Faces feed the existing face-based hidden-line classifier unchanged; the
  pen-sketch renderer is untouched. `createGeometry` input guards must keep
  accepting the tessellated output (face loops ≥ 3 vertices, finite coords).
- `projectToViews` needs no signature change: tessellated edges project like
  any wireframe. Round-trip coverage ≥ `COVERAGE_GATE = 0.999` over silhouette
  segments; the drawn circle is covered by construction (geometry derives from
  its center/radius) after the §3.2 consistency checks pass.

### 3.4 Class competition and ordering

- Attempt order stays A, B, C; Class D is attempted when A/B cannot apply
  (no plan loop) and a plan circle exists. D's failures participate in the
  normal `FAIL_PRIORITY` ranking; `unsupported-curves` fires only when no D
  hypothesis applies.
- A passing D result competes by the existing rule (coverage, then total edge
  length); ties against another passing class with a different canonical
  solid report `ambiguous-pairing`.

### 3.5 Curriculum (required, low risk)

Extend `threeViewSheet` to `CYLINDER`/`CONE` (same read-back style: depth span
from the plan circle, heights from the elevation silhouette, PROFILE-tagged
silhouette + untagged projectors/miter + tagged reference axis). Keep the
`PRISM`/`PYRAMID` output byte-identical and the existing guards for unknown
solids/sides.

### 3.6 Circle from three Ctrl-picked points (first gesture for curves)

Today no mouse gesture creates circles (manual §12.6); circles reach the
sheet only via console glue. There is exactly one gesture, with no tool
to arm: **Ctrl+click three points** (existing dots, or free sheet spots
which place-and-add). The third pick auto-commits — three picked points
unambiguously mean "draw the circle", since no other 3-point gesture exists.

- Ordered multi-pick selection (new infrastructure): Ctrl+click toggles a
  point into/out of an ordered list, shown with the amber ring plus a
  pick-order numeral (1/2/3). Re-clicking a picked point removes it.
  Precedence: while the line/polar tool is armed, Ctrl+click keeps its
  legacy anchor behavior; the pick list only grows when idle.
- Commit rules on the third pick, in order:
  1. Non-collinear triple → circumcircle through all three.
  2. Collinear triple whose geometric middle is equidistant from the other
     two within `max(0.5 mm, 2% of span)` → circle centered at the middle
     point with radius half the outer span.
  3. Any other collinear triple (area ≤ weld tolerance) → rejected with a
     message, nothing committed.
- The committed `CIRCLE` takes `viewRole` by center-y (same rule as placed
  points: `ELEVATION` at/above XY, `PLAN` below), `bisCode: 'A'`, radius
  clamped to `RADIUS_MIN_MM`. The pick list clears on commit, Escape,
  right-click, or any plain single-select click. No tool buttons, no
  keyboard shortcuts, no preview obligation beyond the numeral badges
  (a thin live preview after pick 2 is allowed but optional).
- Pure geometry (`circleFromThreePoints` returning the circumcircle or the
  centered-circle fallback or a named rejection, NaN-guarded) must be
  exported from `educad-canvas.js` and unit-tested headless in Node like
  the line-tool helpers (cf. phase1); DOM wiring stays minimal and must
  keep phase11 green.

## 4. Acceptance scenarios (must all be covered by new tests)

1. 2-view cylinder (`regularSolid CYLINDER` 35×70) → `ok`, class D,
   48v/72e/26f, drawn proportions (35 ⌀, 70 high), coverage 1.0.
2. 2-view cone (`regularSolid CONE` 35×70) → `ok`, class D, 25v/48e/25f,
   apex at `(xMm, 70)`, coverage 1.0.
3. 3-view cylinder + 3-view cone (`threeViewSheet`, both sides) → `ok`,
   class D, coverage 1.0 in plan, elev, and profile.
4. Wrong radius (circle r=17.5 vs elevation half-width 12) → `unavailable`
   with a named reason, no crash, no wrong solid.
5. Cone with missing/drifted apex point → named `unmatched-point`
   (or `x-mismatch` within the loose band), never a guessed apex.
6. Two plan circles → `ambiguous-pairing`.
7. Arc-only sheet → `unsupported-curves` (unchanged deferral).
8. Valid cylinder + an extra arc → `ok` + `curves-ignored` (arc left out,
   never `unmatched-edge` because of the arc).
9. Determinism: byte-identical geometry under entity reorder and rerun;
   tessellation goldens (rim vertex 0 coords, counts) pinned.
10. Rendered solid: tessellated cylinder/cone through `setGeometry` renders
    with the right totals and a non-empty hidden set at rest (MockCtx style,
    cf. phase10 tests 35–36).
11. Circle gesture: `circleFromThreePoints` exact on axis points and stable
    on rotated triples; equidistant-collinear triple yields the centered
    circle; skewed-collinear triple rejected; pick list toggles in order,
    auto-commits on the third pick, and clears on cancel; armed-tool
    Ctrl+click precedence preserved; emitted `CIRCLE` carries correct
    role/BIS/radius; a gesture-drawn plan circle + hand silhouette
    reconstructs (ties the gesture to Class D).

Useful exact coordinates (all mm, first angle, 35 ⌀ × 70):

- Cylinder/cone plan: circle center `(0,-25.5)`, r=`17.5` (depths 8…43);
  cone apex point at the center.
- Cylinder elevation: rect `(-17.5,0)-(17.5,70)` + hidden base `E`.
- Cone elevation: base `(-17.5,0)-(17.5,0)` + slants to apex `(0,70)` +
  apex point + hidden base `E`.
- Cylinder profile: rect `(100,0)-(135,70)` with `xRef=100, s=+1`
  (`x' = 100 + (d-8)`); cone profile: base `(100,0)-(135,0)` + slants to
  apex `(117.5,70)` + apex point.

## 5. Tests and docs

- Add `tools/test-phase13-curves.js` following the existing phase-test format
  (counted `PASS n/TOTAL`, `assert`, exit non-zero on failure) and add it to
  the `test` script in `package.json` after phase12.
- **Pre-authorized change:** `tools/test-phase10-reconstruct.js:28` pins
  cylinder/cone to `unsupported-curves`; that is the feature being built, so
  test 28 MUST be updated to the new verdicts (`ok`, class D, exact counts)
  while keeping an arc-deferral assertion in its place. Call this out in your
  report. No other existing test may be weakened or deleted.
- Update `docs/2d3d-problem-statement.md` with a concise new section (§11)
  describing the M3 curve contract (scope lock, pairing rules, tessellation,
  gate). Keep it consistent with what you implemented.
- Make targeted edits to `docs/MANUAL.md` only where the new behavior
  invalidates existing text (circle gestures in §4; Class D row in §8.6;
  §8.7 rewrite — circles now reconstruct, arcs stay deferred; §8.8
  reason-count and detail templates; §12 items 6 and 13; §13 counts), then
  run `npm run build:manual` so
  `mirror/manual.html` stays fresh (phase11 enforces it; mind its exact-once
  strings, no new fenced blocks or blockquotes). Do not rewrite the manual.

## 6. Constraints

- Zero dependencies; Node-safe; dual-env headers preserved; ES5-style code
  matching the surrounding modules.
- Fixed K=24 tessellation; no adaptive subdivision, no new modules, no new
  global state. Deterministic under reorder and rerun.
- `educad-solid.js` renderer untouched (tessellated faces flow through the
  existing classifier); never regress phase9.
- No git commit, no push, no branch/worktree operations, no network.
- Change only what the task needs. In your final report list every file you
  changed.
- Do not leave background processes running.

## 7. Verification duties (report exact commands and results)

1. Before changing anything, reproduce the §2 defect with a short script
   (cylinder/cone → `unsupported-curves`). Keep the script outside the
   tracked tree if possible.
2. Implement.
3. Run the new phase13 tests and `npm test` (full suite). Everything must be
   green: baseline + phases 1–13 with the single pre-authorized test-28
   update. Any other red or weakened test stops the work: report it.
4. Re-run the pre-fix repro script: scenarios 1–3 must now be `ok`.
5. `git status` must show only intended file changes.
6. Sanity-check the straight-edge contract with three 2-view drawings (box,
   pyramid, wireframe lesson) and one 3-view box, reporting exact
   status/class/coverage for each.

## 8. Final report (required, concise)

- Files changed (path + one-line purpose).
- Exact test commands and results (new phase13 count + full `npm test`
  summary + the test-28 update).
- The pre-fix repro result and the post-fix result, side by side.
- Tessellation convention and pairing rules you implemented, including rim
  vertex-0 placement and how dual-circle sheets are rejected.
- Anything you could not support or verify; the three least-confident parts
  of your implementation.
- Honest gaps: what a user should still expect to fail (arcs, tilted axes,
  hand-wobbled circles).

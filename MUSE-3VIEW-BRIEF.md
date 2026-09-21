# MUSE TASK: Add first-angle third-view (profile/side) support to the EduCAD 2D→3D reconstruction engine

You are the implementer and verifier of this feature. Work only inside this repository
(`/root/major/gg-lab`, Node, zero dependencies). Read the code first, implement, prove the
result with tests, and end with a concise report. Do not commit or push; leave the working
tree dirty for review.

## 0. Execution notes (read first)

- Work in **small increments**, not one giant step. Suggested milestones:
  M1: PROFILE role + 3-view classification + helper filtering + classification/filter tests.
  M2: Class A (prism) and Class B (pyramid) profile validation + tests.
  M3: Class C (wireframe) 3-way pairing + ambiguity handling + tests.
  M4: docs (problem statement + targeted manual edits) + full `npm test`.
- After each milestone run the relevant test file, then continue. Do not rewrite the whole
  module in one shot; make surgical edits to `educad-reconstruct.js` and keep the existing
  code style (ES5 `var`, function expressions, no classes/arrow functions).
- Do not delete or weaken existing behavior. The 2-view contract must stay bit-for-bit
  compatible; the current suite is 492/492 green before you start.
- If a design decision is genuinely ambiguous, choose the option that keeps two-view
  behavior identical, and state the decision in your report. Do not ask for user input.
- Baseline check before editing: `git status --short` should show only the untracked
  `README.md` and `docs/MANUAL.md`; HEAD is `fe27543`. If you see other modifications, stop
  and report.

## 1. Background

EduCAD is a first-angle Monge drawing sheet. `mirror/index.html` hosts a live 2D→3D bridge:
every entity-table change calls `EduCADReconstruct.reconstruct(handle.table.visibleEntities())`
and pushes the result into the 3D widget (`mirror/index.html:1042-1062`).

The reconstruction engine is `mirror/files/www.geogebra.org/educad-reconstruct.js`
(1556 lines, ES5 style, dual-env `module.exports` + `window.EduCADReconstruct`).
Its interpretation contract is locked to exactly two views:

- 3D point `(x, d, h)` reads as elevation `(x, h)` and plan `(x, -d)`; widget space
  `(X, Y, Z) = (x, elevY, -planY)` (see `educad-reconstruct.js:9-26`, `:663-667`, `:1233`).
- `filterEntities` (`:90-112`) keeps `POINT, SEGMENT, LINE, RAY, CIRCLE, CIRCULAR_ARC`,
  drops annotations and `meta.kind in {projector, locus, axis}`, drops sheet-vertical
  segments crossing XY (`isSheetVertical` `:82-84` + `crossesXY` `:86-88`), and diverts
  circles/arcs to a deferred `curves` list.
- `classifyViews` (`:117-132`) has only two buckets, `plan` and `elev`:
  `viewRole === 'PLAN' | 'ELEVATION'` wins; `BOTH` falls back to y-sign; entities exactly
  on XY go to `onDatum` and are re-tried as two placement variants.
- `VIEW_ROLES` is `['PLAN','ELEVATION','BOTH']` in
  `mirror/files/www.geogebra.org/educad-entities.js:18` and `educad-curriculum.js:23`.
- Solvers: Class A prism (`tryPrism` `:555-706`), Class B pyramid (`tryPyramid` `:733-914`),
  Class C wireframe (`tryWireframe` `:953-1339`). Cross-view pairing is by shared x station
  within `eps` (`MATCH_EPS_MM = 0.5`), unioned by `unionStations` (`:918-945`). Acceptance
  gate is round-trip coverage `>= COVERAGE_GATE = 0.999` over each view's drawn A/B geometry
  and E containment (`viewCoverage` `:500-525`). Failures are named states
  (`REASON_LABELS` `:37-48`, `FAIL_PRIORITY` `:1360-1365`), never crashes.
- The 2D→3D problem statement is `docs/2d3d-problem-statement.md`; the user manual is
  `docs/MANUAL.md` (1288 lines, from a prior documentation pass; untracked in git).
- Tests: `tools/test-phase*.js`, run via `npm test` (currently 492/492 green, the last
  script is `tools/test-phase10-reconstruct.js`, 44 tests). Tests are the executable spec.
  `tools/test-phase10-reconstruct.js:19-42` has small helpers (`seg`, `pt`, `planRect`,
  `elevRect`, `boxBoth`) you can imitate in a new test file.

## 2. Validated defect (already reproduced; do not re-litigate)

A conventional first-angle 3-view sheet breaks the engine:

```
side view = rectangle x∈[60,80], y∈[5,50]   (a 20-deep × 50-high profile of a box whose
                                             elevation is x∈[0,30], y∈[5,50] and whose plan
                                             is x∈[0,30], y∈[-40,-10])
```

- Side-view entities land in the `elev` bucket (same for `BOTH` and `ELEVATION` tags, since
  both are in the y > 0 half).
- `tryPrism` compares the whole elevation A/B x-range `[0,80]` against the plan loop stations
  `[0,30]` and fails `x-mismatch` (`:565-572`). `tryWireframe` fails `unmatched-edge`.
- Reported state is `status: 'unavailable', reason: 'x-mismatch'`, label
  "plan/elevation x stations differ beyond eps".
- Extra helper geometry is not handled: untagged horizontal front↔side projectors
  (`y2 == y`) and untagged 45° miter lines are kept by `filterEntities` and trigger
  `unmatched-edge`; `meta.kind: 'projector'` helpers are already dropped regardless of
  orientation; quarter-circle arcs are already deferred to the `curves` list (warning
  `curves-ignored`), so arcs are NOT the problem.

Reference observations (recreate as tests; they must flip from fail to pass):
- 2-view control box: `status ok`, class A, coverage plan/elev 1.0.
- 3-view sheet above: `x-mismatch`.
- Side view placed below XY instead: poisons the plan bucket and yields
  `non-convex-profile`.

## 3. Goal (M2)

Support first-angle **three-view sheets** — elevation (front), plan (top), profile (side) —
end-to-end: classification, filtering, 3D solving, round-trip validation, named failures.
Two-view behavior must be unchanged.

### 3.1 View role and classification

- Add `'PROFILE'` to `VIEW_ROLES` in `educad-entities.js` and `educad-curriculum.js`
  (additive; old values stay valid, invalid values still throw).
- `classifyViews` gains a third bucket. For `viewRole === 'PROFILE'` the bucket is direct.
  For `BOTH` (user-drawn default) a **geometric** fallback must separate the two upper
  views: e.g. cluster the y > 0 vertices by x with a gap threshold, take the cluster that
  aligns with the plan's x-range as elevation, and treat a disjoint upper cluster as the
  profile view. A sheet with only one upper cluster must behave exactly as today (2-view).
- Profile entities below XY (non-standard layouts) may be treated as their own cluster if
  that falls out naturally; do not regress the existing plan handling.

### 3.2 Reference line and depth mapping

- The profile view is related to the plan by the classic X1Y1 / miter geometry: a point at
  depth `d` (plan `y = -d`) appears in the profile at local x `x' = xRef + s * d`, with
  `s ∈ {+1, -1}` (direct or mirrored orientation) and `xRef` the vertical reference line.
- `xRef` and `s` must be inferred from the drawing (the vertical gap between the elevation
  and profile clusters bounds `xRef`; the width match between the profile x-range and the
  plan y-range fixes `s` up to sign). Do not guess: if both orientations yield passing but
  different solids, report `ambiguous-pairing`; if neither passes, report a named mismatch.
- The profile's vertical coordinate is the same height `h` as the elevation.

### 3.3 Input filter / helper geometry

- Extend filtering so conventional third-view construction is ignored: horizontal
  front↔side projectors and 45° miter lines between views must not be treated as solid
  geometry. Prefer a geometry-based rule (e.g. an entity whose endpoints fall in two
  different view clusters is a construction helper) over new metadata requirements, so
  hand-drawn sheets work. Keep the existing `meta.kind` drops, the XY-crossing vertical
  rule, and the curve deferral.
- `DATUM_AXIS` and `meta.kind` helpers stay dropped. Do not silently drop legitimate edges:
  anything dropped for being a helper must not be needed by any candidate solid (the
  round-trip coverage gate is the arbiter).

### 3.4 Solvers

- Extend Class A (prism), Class B (pyramid) and Class C (wireframe) so that, when a profile
  view exists, the reconstructed geometry is also validated against it:
  - A: for every plan loop vertex and station, the swept silhouette in the profile
    (`x' = xRef + s*d`, verticals between `z0` and `z1`, horizontals at `z0`/`z1`) must be
    drawn; profile A/B/E handling mirrors the elevation rules.
  - B: the apex must also project into the profile (base + slant/apex point) and be checked.
  - C: pair vertices three ways (plan `(x, d)`, elevation `(x, h)`, profile `(x', h)`);
    a 3D vertex requires mates in the views it should project into; keep the existing
    deterministic greedy pairing and pin handling, and extend station union to profile
    stations. Unmatched/unpaired profile geometry must produce the existing named failures
    (`x-mismatch`, `unmatched-point`, `unmatched-edge`, `ambiguous-pairing`) rather than a
    new generic error where an existing reason fits.
- Add a failure reason only if none of the existing ones fits (e.g. a profile-only mismatch);
  keep `REASON_LABELS` and `FAIL_PRIORITY` additive and backward compatible.
- Extend the exported `projectToViews` so it can project against three views (optional
  second argument carrying `{xRef, s}` and/or profile data); existing callers with one
  argument must keep working unchanged.
- Coverage result should expose profile coverage as well (e.g.
  `coverage: {plan, elev, profile}`); when no profile view exists the shape of the result
  must remain compatible with the current tests (`coverage.plan`, `coverage.elev`).
- Keep everything deterministic, ES5-style (`var`, function expressions), zero-dep,
  dual-env, Node-safe, NaN-guarded, no new global state.

### 3.5 Curriculum (preferred, low risk)

If it can be done without disturbing existing demo/bridge tests, add a curriculum generator
that emits a first-angle 3-view sheet for a solid (e.g. extend `regularSolid` or add a
`threeViewSheet`/`profileView` helper) with PROFILE-tagged entities, a reference line and
miter/projectors. A UI/demo-bar button is optional; do not break `tools/test-phase6`,
`test-phase7` or the bridge assertions in `test-phase10`.

## 4. Acceptance scenarios (must all be covered by new tests)

1. 2-view regression: box plan/elevation → `ok`, class A, coverage 1.0 (unchanged).
2. 3-view box, PROFILE-tagged, with reference line + miter/projectors + datum axes →
   `ok`, class A, correct 12 vertices / 18 edges, coverage 1.0 in plan, elev and profile.
3. Same 3-view box with untagged `BOTH` entities → same result.
4. 3-view hexagonal prism (reuse the `regularSolid` PRISM geometry: hexagon plan, elevation
   rectangle with facet verticals and hidden seam E, plus a generated profile view) →
   `ok`, class A, correct vertex/edge counts.
5. 3-view pyramid (square base + apex in all three views) → `ok`, class B.
6. 3-view wireframe (point/line lesson geometry, e.g. quadrant point/line) → `ok`, class C.
7. Direct vs mirrored depth orientation: both candidate orientations tried; exactly one
   passes → deterministic pick. A constructed sheet where both pass with different solids →
   `ambiguous-pairing` (no guess).
8. Failure hygiene: 3-view sheet with an inconsistent profile (wrong depth/height) →
   `status: 'unavailable'` with a named reason, no crash, no silent wrong solid.
9. Helper geometry: add horizontal projectors and a 45° miter line to scenario 2/3; result
   stays `ok` (helpers ignored) — this is the previously failing case.
10. Curves stay deferred: arc in a 3-view sheet still yields `ok` + `curves-ignored`
    (or the established curve failure state), never `unmatched-edge` because of the arc.

Useful exact coordinates (all mm, first angle):
- Box: plan rect `(0,-40)-(30,-10)`; elevation rect `(0,5)-(30,50)`; profile rect
  `(100,5)-(130,50)` with `xRef=100, s=+1` (depth `d = -planY ∈ [10,40]` maps to
  `x' = 100 + (d - 10)`).
- Mirrored profile: same but drawn at `(-130,5)-(-100,50)` with `xRef=-100, s=-1`.
- Helpers: horizontal projectors `(30,5)-(xRef,5)` and `(30,50)-(xRef,50)` untagged;
  45° miter `(xRef,0)-(xRef+35,-35)` untagged; reference vertical at `x=xRef` tagged
  `meta.kind:'axis'`.
- Pyramid: square plan `(0,-40)-(30,-10)` + apex `(15,-25)` + hidden slant E; elevation
  base `(0,5)-(30,5)` + slants to apex `(15,50)`; profile base `(100,5)-(130,5)` + apex
  `(115,50)`.

Note on the box coordinates above: the box is 30 wide × 30 deep × 45 high; the plan depth
range 30 mm matches the profile width 30 mm. Keep that width-match invariant in every test
sheet (it is what fixes `s`), and compute `xRef` from the drawing, not from a hardcoded
assumption, in the implementation.

## 5. Tests and docs

- Add `tools/test-phase11-reconstruct-3view.js` following the existing phase-test format
  (counted `PASS n/TOTAL`, `assert`, exit non-zero on failure) and add it to the `test`
  script in `package.json` after phase10. Do not weaken or delete existing assertions;
  additive edits to existing tests are allowed only if strictly necessary (e.g. an enum
  enumeration), and must be called out in your report.
- Update `docs/2d3d-problem-statement.md` with a concise new section describing the M2
  third-view contract (roles, reference line/depth mapping, helper filtering, ambiguity
  rules, acceptance gate). Keep it consistent with what you implemented.
- Make targeted edits to `docs/MANUAL.md` only where the new behavior invalidates existing
  text (e.g. the limitation "No third view, sections, perspectives..." in the views/3D
  section, supported drawing classes, failure-state list). Do not rewrite the manual; keep
  its style.

## 6. Constraints

- Zero dependencies; Node-safe; dual-env headers preserved; ES5-style code matching the
  surrounding modules.
- Do not touch `mirror/files/www.geogebra.org/educad-solid.js` unless strictly required;
  never regress phase9.
- No git commit, no push, no branch/worktree operations, no network.
- Change only what the task needs. In your final report list every file you changed.
- Do not leave background processes running.

## 7. Verification duties (report exact commands and results)

1. Before changing anything, reproduce the defect with a short script (3-view box →
   `x-mismatch`). Keep the script outside the tracked tree if possible.
2. Implement.
3. Run the new phase11 tests and `npm test` (full suite). Everything must be green:
   baseline + phases 1-11. If a pre-existing test genuinely conflicts with the new feature,
   stop and report the conflict rather than weakening the test.
4. Re-run the pre-fix repro script: scenario 2/3 must now be `ok` with coverage 1.0.
5. `git status` must show only intended file changes (plus the pre-existing untracked
   `README.md` and `docs/MANUAL.md`).
6. Sanity-check the two-view contract with three different 2-view drawings (box, pyramid,
   wireframe/quadrant lesson) and report their exact status/class/coverage.

## 8. Final report (required, concise)

- Files changed (path + one-line purpose).
- Exact test commands and results (new phase11 count + full `npm test` summary).
- The pre-fix repro result and the post-fix result, side by side.
- Coordinate conventions and helper rules you implemented, including how `xRef` and `s`
  are inferred and how ambiguity is detected.
- Anything you could not support or verify; the three least-confident parts of your
  implementation.
- Honest gaps: what a user should still expect to fail in 3-view mode.

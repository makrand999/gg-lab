# MUSE TASK: Add the three-view demo button to the EduCAD demo bar

You are the implementer and verifier of this feature. Work only inside this repository
(`/root/major/gg-lab`, Node, zero dependencies). Read the code first, implement, prove the
result with tests, and end with a concise report. Do not commit or push; leave the working
tree dirty for review.

## 0. Execution notes (read first)

- Work in **small increments**, not one giant step. Suggested milestones:
  M1: demo button + `loadDemo('3view')` branch + click wiring + `#3view` hash in `mirror/index.html`.
  M2: new `tools/test-phase15-demo-3view.js` + `package.json` + `README.md`.
  M3: targeted `docs/MANUAL.md` edits + `npm run build:manual`.
  M4: full `npm test` + report.
- After each milestone run the relevant test file, then continue. Keep the existing code style
  in app code (ES5 `var`, function expressions, no classes/arrow functions). Zero new dependencies.
- Do not delete or weaken existing behavior or tests. Baseline: HEAD is `9a4ddc3`,
  `git status --short` is clean, and `npm test` is **616/616 green** before you start.
  If you see a red suite or unexpected modifications, stop and report.
- This task should touch only `mirror/index.html`, the new test file, `package.json`,
  `README.md`, `docs/MANUAL.md`, and the regenerated `mirror/manual.html` (plus the brief copy
  in §5). Do not modify `mirror/files/**` — the engine and curriculum already support everything
  needed. If you believe a module change is unavoidable, stop and explain in the report instead.
- If a design decision is genuinely ambiguous, choose the option that keeps existing demos and
  tests byte-identical, and state the decision in your report. Do not ask for user input.

## 1. Background

- EduCAD's demo bar is wired in `mirror/index.html`: buttons at `:178-182`, the
  `loadDemo(type)` function at `:1311-1344`, click listeners at `:1346-1349`, URL-hash
  dispatch at `:1352-1367`.
- Existing demos: `line` (default), `points`, `prism`, `clear`. Each demo clears the sheet,
  clears the `active` class from every `.demo-btn`, and — for real demos — re-activates its own
  button, then creates the curriculum bundle's entities with
  `handle.table.create(e.type, e)`.
- **Hard constraint:** `Manual` must stay the **last** child of the demo bar
  (`tools/test-phase11-manual.js` check 18 asserts this).
- The 3-view engine and generator already exist and are green:
  `EduCADCurriculum.threeViewSheet` (`educad-curriculum.js:479-596`) emits a first-angle sheet
  with a `PROFILE` side view, X1Y1 reference axis, horizontal projectors and a 45° miter. For
  `{solid:'PRISM', sizeMm:35, heightMm:70, xMm:0}` it reconstructs as class A,
  **12 vertices / 18 edges / 8 faces**, `coverage.profile === 1` (see
  `tools/test-phase12-reconstruct-3view.js` check 15).
- The M2 brief (`MUSE-3VIEW-BRIEF.md:154-160`) declared a UI/demo-bar button *optional*; this
  task is that button. The engine, classification, profile validation and docs already landed
  (problem statement §10, manual §8.6). Nothing engine-side is missing.

## 2. Goal

Add exactly one demo-bar button — label **`3-View Prism (35mm)`**, id **`btn-demo-3view`** —
that loads `EduCADCurriculum.threeViewSheet({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 })`
the same way the other demos load their bundles, so the 3D glass shows the class-A prism
(12 vertices / 18 edges) reconstructed from plan + elevation + profile.

### 2.1 `mirror/index.html` (surgical edits only)

1. Insert, immediately **after** `btn-demo-prism` and **before** `btn-clear`:
   `<button class="demo-btn" id="btn-demo-3view">3-View Prism (35mm)</button>`
   No CSS changes (`.demo-btn` already covers buttons; the `active` sweep uses
   `querySelectorAll('.demo-btn')`).
2. In `loadDemo`, add an `else if (type === '3view')` branch after the `prism` branch,
   following the same pattern: activate `btn-demo-3view`, call `threeViewSheet` with the exact
   options above, create every entity via `handle.table.create(e.type, e)`.
3. Add the click listener next to the other three:
   `document.getElementById('btn-demo-3view').addEventListener('click', function () { loadDemo('3view'); });`
4. Add an `else if (hash === '#3view')` branch in the hash dispatch (after `#prism`).

### 2.2 New test file `tools/test-phase15-demo-3view.js`

Follow the phase-file conventions exactly (`'use strict'`, `var TOTAL`, `pass(name)` printing
`PASS n/TOTAL name`, `require('assert')`, ending with
`assert.strictEqual(n, TOTAL); console.log('OK ' + TOTAL + '/' + TOTAL + ' phase15 tests passed');`).
Aim for **12-16 checks**, including at least:

1. `mirror/index.html` contains the exact button label and id, inside the demo bar.
2. Button order: `btn-demo-3view` appears after `btn-demo-prism` and before `btn-clear`;
   `btn-manual` remains the last demo-bar child (keep phase11's regex contract).
3. `loadDemo` has a `3view` branch that calls `EduCADCurriculum.threeViewSheet` with
   `solid: 'PRISM'`, `sizeMm: 35`, `heightMm: 70`, `xMm: 0` (assert the exact literals).
4. The click listener wires `btn-demo-3view` to `loadDemo('3view')`.
5. The hash dispatch recognizes `#3view` and the branch sits before the default `loadDemo('line')`.
6. The active sweep still selects all `.demo-btn` elements (the new button participates).
7. Headless reconstruction of the button's exact bundle: `C.validateBundle(bundle).ok === true`;
   `R.reconstruct(bundle.entities)` gives `status 'ok'`, `class 'A'`, 12 vertices, 18 edges,
   8 faces, coverage `plan/elev/profile === 1`, x-span 35 mm, height 70 mm.
8. Determinism: building and reconstructing the bundle twice yields identical JSON geometry.
9. Doc sync: `docs/MANUAL.md` contains the exact button label and the `#3view` hash;
   `README.md` lists the phase15 suite and the grand total; `package.json` chains
   `node tools/test-phase15-demo-3view.js` in `test`.

Do NOT test the DOM by running a browser; the repo's tests are static-text + Node-module
checks (see `test-phase11-manual.js`, `test-phase7-production-audit.js`). Reuse the tiny
helpers/patterns from `test-phase12-reconstruct-3view.js` (`require` the modules, build specs).

### 2.3 `package.json` and `README.md`

- `package.json`: add `"test:phase15": "node tools/test-phase15-demo-3view.js"` and append
  `&& node tools/test-phase15-demo-3view.js` to the `test` script after phase14.
- `README.md`: add the phase15 row to the test table (exact check count) and update the
  grand total in the Test section (`616` → `616 + phase15 count`). Keep the table format.

### 2.4 `docs/MANUAL.md` (targeted edits, then rebuild)

- §3.2 Demo bar: the count line must match the new bar; add a table row for
  `3-View Prism (35mm)` — "Loads the three-view prism lesson (plan + elevation + profile side
  view with projectors and miter)". Keep the "Clicking a demo also clears..." sentence true.
- §3.7 ASCII layout diagram: add a `3-View Prism...` line inside the demo-bar box, aligned
  with the existing rows.
- §9.1 intro: add `#3view` to the recognized-hash list.
- §9.1: add a `#### `3-View Prism (35mm)`` guided walkthrough after the Hexagonal Prism one,
  in the same voice (what it loads: side view at `xRef`, X1Y1 axis, projectors + 45° miter;
  what to look at: the side view validates depth; what it teaches: three-view (first-angle)
  reading; In 3D: class-A prism, 12 vertices / 18 edges, coverage 1.0 in all three views).
- §9.2: fix the stale facts while you are there: "Beyond the three demo buttons" → four;
  the `threeViewSheet` row says "PRISM/PYRAMID only" — it now covers
  `PRISM/PYRAMID/CYLINDER/CONE`; the `regularSolid` CYLINDER/CONE rows say "circle defers 3D
  (§8.7)" — full circles now reconstruct as Class D (§8.6-§8.7).
- §10.5 strings table row `Demo bar (5 buttons, §3.2)` → the new count.
- §13.1: `educad-curriculum.js` row "Partial (3 lessons via demo buttons...)" → 4;
  the tests paragraph says "574 checks" — replace with the **actual** new grand total and add
  `tools/test-phase14-glass.js` and `tools/test-phase15-demo-3view.js` to the sentence.
- §13.2 traceability table: add a row (next number, 43) for the 3-view demo button, citing the
  `index.html` button/loader anchor, `tools/test-phase12-reconstruct-3view.js` (engine proof)
  and `tools/test-phase15-demo-3view.js` (wiring proof).
- Troubleshooting table: the row "Only `#points`, `#prism`, `#mesh` are recognized" must
  include `#3view`.
- Then run `npm run build:manual`; `mirror/manual.html` must be regenerated and byte-identical
  on a second run (phase11 enforces freshness). Do not rewrite unrelated prose.

### 2.5 Brief copy

Copy this brief into the repo root as `MUSE-3VIEW-BUTTON-BRIEF.md` (`cp` is fine) so the task
is tracked with the other briefs. Do not modify `MUSE-3VIEW-BRIEF.md` or
`MUSE-CURVES-BRIEF.md`.

## 3. Acceptance criteria

1. Fresh page load shows the new button; clicking it clears the sheet, highlights itself, and
   loads the 3-view prism sheet; the 3D glass shows the class-A prism (no `3D unavailable`).
2. `http://127.0.0.1:8124/#3view` loads the same demo on startup.
3. Existing demos (`line`, `points`, `prism`, `clear`) and the Manual link behave exactly as
   before; `Manual` stays the last demo-bar child.
4. `node tools/test-phase15-demo-3view.js` passes; `npm test` is green end-to-end with the new
   checks added; `npm run build:manual` is deterministic and the freshness guard passes.
5. Documents match reality (manual §3.2/§3.7/§9.1/§9.2/§10.5/§13.1/§13.2 and README).

## 4. Verification duties (report exact commands and results)

1. Before editing: confirm no 3-view button exists
   (`grep -n "btn-demo-3view" mirror/index.html` → empty) and that the exact bundle reconstructs
   (`EduCADCurriculum.threeViewSheet({solid:'PRISM',sizeMm:35,heightMm:70,xMm:0})` → `ok`,
   class A, 12v/18e). Keep any scratch script in `/tmp`, not the repo.
2. Run `node tools/test-phase15-demo-3view.js` (report `PASS n/TOTAL`).
3. Run `npm test` (report every phase's `OK …` line and the final total).
4. Run `npm run build:manual` twice and report the sha256 of `mirror/manual.html` after each
   run (must match), then re-run phase11 (or `npm test`) to prove freshness.
5. Start the server on an **ephemeral port** (`node tools/serve.js 0` is fine; do not fight for
   8124), `curl -s http://127.0.0.1:<port>/` and confirm it contains
   `btn-demo-3view` and `3-View Prism (35mm)`, then kill the server. No processes left running.
6. `git status --short` must show only the intended changes (the modified files above, the
   regenerated `mirror/manual.html`, and the new untracked brief file).

## 5. Constraints

- Zero dependencies; Node-safe; ES5 style in `mirror/index.html` (match surrounding code).
- Do not change engine modules, tests other than adding the new phase file, or the existing
  brief files. Do not weaken or delete any existing assertion.
- No git commit, no push, no branch/worktree operations, no network.
- Change only what the task needs. In your final report list every file you changed.

## 6. Final report (required, concise)

- Files changed (path + one-line purpose).
- Exact test commands and results (phase15 count + full `npm test` total, before/after).
- The pre-change verification result and post-change result side by side.
- The exact button label/id/options, where it sits in the demo bar, and the hash behavior.
- Manual/README edits made (section list) and the two `npm run build:manual` hashes.
- Anything you could not support or verify; the three least-confident parts of your change.

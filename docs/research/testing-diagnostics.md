# Testing, diagnostics and error handling

Research and design report for **Major**. Major2 is out of scope.

- Date: 2026-11-11
- EduCAD baseline: commit `43d3b7f` (`Document cylindrical fillet and line boundary support`)
- Runtime used for measurements: Node.js `v24.21.0`
- Scope of the comparison: OCCT, FreeCAD, Manifold, OpenSCAD and CGAL as
  representative mature OSS CAD / geometry projects.
- Scope of the proposal: the public reconstruction pipeline, the EduCAD Script
  runner, and the `.edu`/`.edc` corpus. No production change is made by this
  report.

This report deliberately distinguishes three things that are often conflated:

1. **the drawing script** — the public, human-readable check;
2. **the diagnostic record** — the structured description of what was not
   resolved;
3. **the test harness** — how checks are discovered, run, reported and gated.

EduCAD currently has a strong drawing-script format and a rich set of
diagnostic *messages*, but only a partial diagnostic *schema* and no automated
harness around the corpus. The OSS projects reviewed here separate those
concerns more sharply.

---

## 1. Current verification and diagnostic architecture

### 1.1 One reconstruction pipeline, several entry points

`public/lib/educad-reconstruct.js` is the shared public pipeline. The live
application, saved previews and `tools/edc.js` enter through
`EduCADReconstruct.reconstruct`, so a script and the UI see the same surface
families and diagnostics. The exact path is `public/lib/educad-strict.js`;
the inferred display path and the analytic surface model are separate.

The contract is explicit in `docs/RECONSTRUCTION_CONTRACT.md`:

- declared vertices, edges and triangles are solved with exact decimal-rational
  arithmetic;
- the result has `determination` equal to `determined`, `underdetermined`,
  `inconsistent` or `unsupported`;
- issues carry a code and, where applicable, an entity/member ID;
- mixed results retain every issue, with precedence
  `inconsistent` > `unsupported` > `underdetermined`;
- an unresolved result does not return a whole-model certificate;
- three certificates remain distinct: `educad-explicit-v1`,
  `inferred-triangle-v1` and `analytic-surface-certificate-v1`.

The headless runner is `tools/edc.js`. It executes one slash command per line,
ignores comments and blank lines, and then reconstructs from the resulting
entity table. It is the only test suite named by the repository
(`docs/MANUAL.md`, `docs/PRIMITIVE_RECONSTRUCTION.md`, `CONTRIBUTING.md`).

### 1.2 What `.edu` / `.edc` checks actually assert

There are five assertion mechanisms in `tools/edc.js`:

| Mechanism | Supported by | What it checks |
|---|---|---|
| command result | every slash line | command parse/execute success; per-line error message |
| `# reject:` | `runScript` | command fails, optional message substring matches, and the entity table is byte-for-byte unchanged |
| projector alignment | `checkProjectors` | points sharing a base caption have equal sheet `x` across views |
| `# expect:` | `runScript` | a fixed vocabulary of topology and reconstruction properties |
| `# surface-query:` | `runScript` | a public `Surfaces` operation, matched as a recursive subset with a relative numeric tolerance of `1e-6` |

`# expect:` is intentionally simple. It accepts either a count token such as
`48V`, `72E`, `26F`, or a `key=value` token. Values are compared by exact
JavaScript equality. The parser only recognizes integer digits for the value,
so a decimal or negative numeric expectation is not expressible in
`key=value` form. Unknown keys fail with `Unknown topology expectation`.

`# surface-query:` is the more expressive check. It can call `section`,
`intersect`, `intersectionCurves`, `trim`, `split` and `attach`; it can save a
result under a name for a later query; and it compares the actual result as a
recursive subset of the expected object. That subset rule is useful because it
avoids freezing every incidental field. It also means an expectation can
silently ignore an unexpected extra field or array element unless the test
author asks for it explicitly.

`# reject:` is a small but important atomicity check. It asserts not only that
a bad command returns `{ok:false}`, but that the table did not mutate. This is
the right shape for parser and command-layer tests.

### 1.3 Measured baseline

The corpus was run as-is on 2026-11-11:

```sh
for f in tools/scripts/*; do node tools/edc.js "$f"; done
```

All **151** scripts exited 0. Those 151 files comprise 143 `.edu` files and
8 `.edc` files. The corpus contains:

| Measurement | Count |
|---|---:|
| scripts | 151 |
| `.edu` / `.edc` | 143 / 8 |
| scripts with at least one `# expect:` | 143 |
| `# expect:` lines | 164 |
| `# surface-query:` lines | 82 |
| `# reject:` lines | 5 |
| scripts whose output includes at least one diagnostic | 51 |
| distinct diagnostic codes printed by the corpus | 25 |
| scripts ending with `solid: ok` | 135 |
| scripts ending with `solid: unavailable` | 16 |
| scripts with no machine assertion at all | 8 |

The last two rows matter. **CLEAN means "the runner's expectations passed",
not "the model reconstructed".** Sixteen scripts currently finish unavailable.
Most assert a reason-code status, but not all: `curve-input-errors.edu`,
`oblique-conflicting-arcs.edu`, `or2.edc` and several spline-conflict scripts
assert related properties without asserting the unavailable solid itself. A
new script with no `# expect:` can also be CLEAN while the solid is
unavailable. For example, `tools/scripts/rule-a.edc` has no expectation; under
`node tools/edc.js --strict tools/scripts/rule-a.edc` it reports `CLEAN` while
printing `solid: unavailable (edge-endpoints-missing)`.

The eight scripts with no `# expect:`, `# surface-query:` or `# reject:` are:

- `edge-both-views.edc`
- `edge-missing-plan.edc`
- `flat-square.edc`
- `ln1.edc`
- `or2.edc`
- `quad3d.edc`
- `rule-a.edc`
- `wedge.edc`

Their expected values exist only in prose (`expectation.md`,
`docs/PRIMITIVE_RECONSTRUCTION.md`). The runner cannot see those expectations.

The 114 `status=` assertions show a second design issue. `status` is the
geometry's `topologyStatus`, not the reconstruction outcome. It is used as an
outcome in 107 cases (`inferred` 71, `partial` 34, `ok` 2), and as a *reason
code* in 7 cases (`oblique-line-conflict` 2,
`oblique-curve-projection-missing` 2, `curve-projection-missing` 1,
`oblique-curve-conflict` 1, `coordinates-missing` 1). A field named `status`
therefore mixes "how complete is this result" with "which diagnostic fired".

### 1.4 The diagnostic vocabularies

Diagnostics are produced at several layers, and each layer has its own record
shape:

| Producer | Record shape | Status vocabulary | Locality | Severity |
|---|---|---|---|---|
| command layer (`educad-command.js`) | `{ok, message}` | success / failure | message only | none |
| strict kernel (`educad-strict.js`) | `{state, code, message, entityId, memberId}` | `determined`, `underdetermined`, `inconsistent`, `unsupported` | entity + member | none |
| primitive pipeline (`educad-reconstruct.js`) | `{code, entityId?, message}` plus `determination` / `status` / `topologyStatus` | `ok`, `unavailable`, `inferred`, `partial` | entity | none |
| surface validation (`educad-surfaces.js`) | `{code, message, sourceIds}` | `ok`, `partial`, `issues` | source IDs | none |
| surface certificate (`educad-surfaces.js`) | `{id, code, severity, message, sourceIds, surfaceId?, boundaryId?, check?, arithmetic?, residual?, tolerance?}` | `ok`, `partial`, `issues` | source IDs + surface/boundary/check | `error` / `warning` |
| lesson verifier (`educad-verify.js`) | `{id, kind, verdict, reason, label}` | `pass`, `fail`, `unverifiable` | entity ID | none |
| script runner (`tools/edc.js`) | `{n, line, message}` plus `ok` | `CLEAN` / `PROBLEM` | line number | none |

Only the analytic certificate has a severity field. Only the strict kernel
carries `memberId`. `report()` prints `entityId` for pipeline diagnostics but
does not print `memberId`, even when the strict kernel attached one. The
lesson verifier is a separate grading system with its own `pass/fail/
unverifiable` vocabulary and is not connected to the script runner.

The certificate is the most mature part of the current model. It records
exact and numeric checks separately, includes residuals and tolerances, and
maps open components and empty models to `partial` while failed checks map to
`issues`. The rest of the pipeline does not yet use that discipline.

The mechanical source inventory found roughly 97 literal code/issue strings
across the diagnostic-producing modules. The corpus prints 25 distinct codes;
the source inventory is larger because many codes are built dynamically. The
inventory also includes some status values and certificate check names, so it
is a taxonomy snapshot, not a published API contract.

### 1.5 Strengths and gaps

**Strengths**

- The public check is a real drawing, not a mock of an internal function. It
  exercises the same commands a user types and the same reconstruction path the
  application uses.
- It is zero-dependency, deterministic and fast enough to run headlessly.
- Exact arithmetic in the strict path makes many checks reproducible across
  machines.
- `# reject:` checks atomicity, not just an error return.
- `# surface-query:` already exercises deep public APIs with tolerant subset
  matching and saved intermediate results.
- Partial results are a first-class product behavior: unresolved geometry is
  retained and named rather than silently filled in.
- The analytic certificate is a strong basis for structured diagnostics.

**Gaps**

- **Fragmented schema.** Seven record shapes and several overlapping status
  vocabularies mean consumers must special-case every producer.
- **No severity outside the certificate.** A missing optional annotation and a
  contradictory coordinate can both arrive as a bare `warning`-less code.
- **No machine-readable report.** `report()` is plain text; there is no JSON,
  JUnit, TAP or aggregate result. CI would have to parse prose.
- **No aggregate runner or CI.** There is no workflow that runs the 151 scripts
  on a pull request. A regression can land green.
- **No default geometry assertion.** A script without `# expect:` is CLEAN even
  when reconstruction is unavailable.
- **No generalized property-based or fuzz testing.** A few scripts contain
  hand-written invariants (curve fit, reprojection, through-edit), but the
  corpus covers known examples rather than generated inputs or adversarial
  cases.
- **Weak failure locality for expectations.** A mismatched count reports the
  key and values but not the responsible entity. A strict issue's `memberId` is
  dropped from the printed report.
- **Documentation drift is invisible.** `docs/MANUAL.md` documents
  `# pose-check:` but `tools/edc.js` implements no such directive. Unknown
  `#` directives are comments, so a typo or a stale directive passes silently.
- **Thin numeric golden evidence.** Most scripts assert topology counts and
  status strings; some surface queries assert exact radii and centres, but
  there are no volume, bounding-box or certificate-parameter snapshots.

---

## 2. OSS patterns

The five projects differ in scale, but the same separation recurs:

- a **regression corpus** that reproduces user-facing behavior;
- **golden or expected results** for stable output;
- **property/fuzz** checks for invariants and crashes;
- an **error model** that distinguishes expected failure from programmer error;
- a **machine-readable harness** that runs in CI.

### 2.1 OCCT: DRAW, test grids and BRepCheck

**Harness.** OCCT's automated testing system is documented in the OCCT 8.0.1
*Automated Testing System* guide and the *Draw Test Harness* guide. Tests live
under `tests/` and are organized as **group → grid → case**. A group has a
`grids.list`; grids have `begin`/`end` scripts and `parse.rules`; a case is a
Tcl script. `testgrid` runs all or a filtered subset in parallel, writes an
HTML summary and can emit JUnit-style XML. `test group grid case` runs a single
case. `testdiff` compares CPU, memory and images between two runs.

The status model is the most relevant part:

- `SKIPPED` — cannot run here, usually missing data;
- `FAILED` — unexpected output or missing `TEST COMPLETED`/`REQUIRED` line;
- `BAD` — a known problem, marked by a matching `TODO` line;
- `IMPROVEMENT` — a `TODO` problem disappeared;
- `OK` — no problem.

Integration requires `OK` or `BAD`; a new test for an unfixed bug should be
`BAD`, and a test for a fixed bug should be `FAILED` without the fix and `OK`
with it. `REQUIRED` marks output that must appear; `parse.rules` maps output
lines to statuses. This is a much richer notion of "expected failure" than a
plain assertion.

**BRepCheck.** `BRepCheck_Analyzer` checks a shape and its subshapes.
`BRepCheck_Status` has `BRepCheck_NoError` plus 36 specific defect values
(including `BRepCheck_FreeEdge`, `BRepCheck_SelfIntersectingWire`,
`BRepCheck_NotClosed`, `BRepCheck_NotConnected`,
`BRepCheck_BadOrientation`, `BRepCheck_UnorientableShape`,
`BRepCheck_InvalidToleranceValue`, `BRepCheck_EnclosedRegion` and
`BRepCheck_CheckFail`). `BRepCheck_Result::Status()` returns a *list* of
statuses for a shape, and `IsValid()` is the aggregate convenience answer.
The analyzer can run topological checks only, or include geometric checks; it
also has an exact method that is slower and more correct than finite-point
sampling.

This is a direct precedent for EduCAD: a single boolean or a single first code
loses the per-entity, multi-defect structure that a useful diagnostic report
needs.

**Exception/report model.** `Standard_Failure` is the root of OCCT's exception
hierarchy and implements `what()`. `Message_Report` collects alerts sorted by
`Message_Gravity`, can merge reports from nested algorithms, can answer
`HasAlert`, and can dump or forward the report. The DRAW harness treats an
uncaught exception as a test failure by default, but tests can mark specific
messages as `REQUIRED` or `TODO`.

**Lesson for EduCAD.** Separate "known bad" from "unexpected failure"; retain a
list of defects per entity; make the harness emit a machine report; do not
reduce a multi-defect shape to `reason = first code`.

### 2.2 FreeCAD: GTest, CTest and `DocumentObjectExecReturn`

FreeCAD's `tests/CMakeLists.txt` registers C++ test executables
(`App_tests_run`, `Base_tests_run`, `Part_tests_run`, and module-specific
targets) and uses `gtest_discover_tests` so each GTest case becomes a CTest
case. Qt tests are registered separately with `QT_QPA_PLATFORM=offscreen`.
Python-level module tests also exist (for example
`src/Mod/PartDesign/TestPartDesignApp.py`).

The error model is split in a useful way:

- `Base::Exception` and its subclasses (`ValueError`, `FileException`,
  `CADKernelError`, etc.) carry a message, source location and translation
  metadata. `reportException()` is once-only.
- `DocumentObjectExecReturn` is the expected-failure return value for a feature.
  `StdReturn` is `nullptr` on success; otherwise `Why` holds the reason and
  `Which` identifies the object that caused the failure.
- `Document::_recomputeFeature` catches `Base::AbortException`,
  `MemoryException` and other exceptions at the document boundary, adds a
  recompute log entry, and returns an error code. An expected feature failure
  becomes a logged `ExecReturn`, not an uncaught exception.

**Lesson for EduCAD.** A feature that cannot compute should return a structured
failure value with "why" and "which", not throw through the UI. Exceptions are
for unexpected or unrecoverable conditions at the boundary.

### 2.3 Manifold: status as part of the result, and FuzzTest

Manifold's public `Manifold` API has an `Error` enum with values including
`NoError`, `NonFiniteVertex`, `NotManifold`, `VertexOutOfBounds`,
`InvalidConstruction`, `ResultTooLarge`, `InvalidTangents` and `Cancelled`.
`Status()` returns the error for the (possibly deferred) CSG tree. Invalid
input produces an empty manifold with a status rather than throwing.

This is not just an API nicety; the test suite uses it:

- `test/manifold_fuzz.cpp` defines a FuzzTest domain of translated/rotated
  cubes combined by union or difference, asserts
  `result.Status() == Manifold::Error::NoError` after each operation, enables
  intermediate checks, and uses a 10-second timeout with `pthread_cancel`.
- `test/CMakeLists.txt` builds the ordinary GTest suite always, and builds
  `polygon_fuzz` and `manifold_fuzz` only when `MANIFOLD_FUZZ` is enabled.
- Tests cover primitives, booleans, properties, measurement, SDF, smoothing,
  hulls, samples and C API behavior. There are also model/polygon corpora.

The fuzz test is not checking aesthetic output; it is checking a contract
("no error, no hang, no crash") over a generated domain. That is a good model
for a geometry library whose unsupported inputs are supposed to fail cleanly.

**Lesson for EduCAD.** Put the error status in the result object, assert it in
tests, and fuzz the *contract boundary* — not just the happy-path examples.

### 2.4 OpenSCAD: CTest, golden regression, expected failures

OpenSCAD's `doc/testing.md` describes two layers:

- a CTest regression suite driven from `tests/CMakeLists.txt`, with expected
  text and image files under `tests/regression/`;
- a Catch2 unit-test binary (`OpenSCADUnitTests`) plus optional GUI tests.

`TEST_GENERATE=1 ctest -R <name>` regenerates the expected file for a test.
`add_failing_test` registers a test that is expected to fail, using
`shouldfail.py` and an expected return value. The test configurations separate
`Default`, `Heavy`, `Examples`, `Bugs` and `All`, so slow or known-bad groups
do not block the default run.

Error reporting is pragmatic:

- `LOG(message_group::Error/Warning, ...)` produces categorized user-facing
  messages;
- `src/geometry/cgal/cgalutils.cc` catches `CGAL::Assertion_exception` around
  Nef-polyhedron construction and translates known nonplanar-face failures into
  a retry or an `Error` log, rather than letting the exception escape;
- `--hardwarnings` turns the first warning into a stop condition, which is
  useful for CI and for tests that must be warning-free.

**Lesson for EduCAD.** A regeneration workflow is essential if golden data is
used, but it must be explicit and reviewed. Expected-failure tests deserve
their own category. Warnings need a mechanism to become failures in strict
modes.

### 2.5 CGAL: package test suites and check categories

CGAL's test suite is a per-package collection of compile-and-run programs under
`test/<Package>/`, using CMake/CTest. The wiki documents labels,
`ctest -R`/`-L`, parallel runs, nightly multi-platform testing, and `.cin`/
`.cmd` input files. The suite checks compilation on many platforms as well as
runtime behavior. There is no documented coverage-guided fuzzing harness in the
materials reviewed; the emphasis is breadth of platforms and parameterizations.

The check design is the relevant part for EduCAD:

- `CGAL_precondition` — caller violated the documented contract;
- `CGAL_postcondition` — the routine violated its promise;
- `CGAL_assertion` — invariant or internal check;
- `CGAL_warning` — non-fatal;
- static and destructor assertions.

CGAL forbids direct `std::abort`, `std::exit` and `assert` in library code
because the application cannot react. Checks are implemented as macros and
failures are reported as exceptions by default. Expensive and exactness checks
are disabled by default and can be enabled with `CGAL_CHECK_EXPENSIVE` and
`CGAL_CHECK_EXACTNESS`; `CGAL_NDEBUG` disables all checks. The wiki explicitly
warns that test-suite code should use `assert` rather than `CGAL_assertion`
when the check must survive a release build, because `CGAL_NDEBUG` may be set.

**Lesson for EduCAD.** Contract checks must be part of the result, not only
debug assertions that disappear in production. Separate "caller error",
"implementation bug" and "warning" in the taxonomy. Test the release path.

### 2.6 Pattern summary

| Pattern | Strong examples | What it buys |
|---|---|---|
| Case corpus organized by feature | OCCT groups/grids, CGAL packages, FreeCAD modules | coverage that maps to ownership |
| Expected-failure category | OCCT `BAD`/`TODO`, OpenSCAD `add_failing_test` | prevents known bugs from blocking CI without hiding them |
| Golden output with regeneration | OpenSCAD `TEST_GENERATE`, OCCT `testdiff` | stable regression detection |
| Status in the result | Manifold `Error`, FreeCAD `ExecReturn`, OCCT `BRepCheck_Status` | no exception-based control flow for expected failure |
| Multi-defect diagnostics | OCCT `BRepCheck_Result::Status()` | accurate failure locality |
| Machine-readable harness | OCCT JUnit XML, CTest, `gtest_discover_tests` | CI integration |
| Property/fuzz domains | Manifold FuzzTest | catches crashes and contract leaks beyond examples |
| Check categories | CGAL pre/post/assertion/warning | separates caller error, bug, and warning |
| Boundary exception translation | FreeCAD `_recomputeFeature`, OpenSCAD CGAL catch | user-facing report instead of a crash |

---

## 3. Comparison matrix

Rating scale: **●** strong, **◐** partial, **○** weak. For maintenance cost,
"low" is better. The ratings are relative to each project's own contract, not
a claim that a smaller project should match a larger one.

| Project | Coverage | Reproducibility | Failure locality | CI-friendliness | Maintenance cost |
|---|---|---|---|---|---|
| **EduCAD now** | ◐ 151 public scripts cover the supported solids and many deliberate failures, but there is no browser/UI/backend coverage and no unit-level isolation | ● headless, zero-dependency, deterministic; exact strict path | ◐ line numbers and messages; entity/member IDs exist but are not consistently printed; expectation failures do not name the entity | ○ no aggregate runner or CI; plain-text output; per-file exit codes only | Medium — 151 scripts and verbose expectations, but no framework to maintain |
| **OCCT** | ● module-wide groups, grids and cases, including known-bad cases | ◐ Tcl scripts plus data files; platform-specific `TODO` masks and image comparisons | ● group/grid/case plus `BRepCheck_Status` per subshape | ● `testgrid` parallel, JUnit XML, `-regress` | High — large data corpus, platform masks, TODO maintenance |
| **FreeCAD** | ● C++ GTest per module, Qt tests, Python module tests | ◐ deterministic GTest but large build/Qt/Python environment | ● test name, exception source location, `ExecReturn.Which` | ● CTest + `gtest_discover_tests` | High — many build configurations and modules |
| **Manifold** | ◐ focused library, but strong on core mesh/boolean operations and API surface | ● deterministic numeric tests, model corpora, seeded fuzz domains | ● GTest case plus `Error` status | ● CTest; optional FuzzTest target | Medium — compact suite, but fuzz failures need triage |
| **OpenSCAD** | ● language, rendering, export/import, examples, GUI tests | ◐ image comparison and fonts/GL make some checks environment-sensitive | ◐ test name and diff; CGAL errors may not identify the input feature | ● CTest configurations, golden files; image tests are heavy | High — golden image updates and many test variants |
| **CGAL** | ● per-package compile/run suites across many platforms and kernels | ◐ compiler/platform/number-type dependent; nightly matrix | ◐ per-program and assertion file/line, but not a domain-level CAD diagnostic | ● CTest labels, nightly; PR CI is narrower | High — very large platform and package matrix |

Two conclusions follow from the matrix:

1. EduCAD's **reproducibility is already excellent**; it should not trade that
   away for image-based or environment-dependent golden tests.
2. EduCAD's weakest axes are **CI-friendliness and failure locality**, both of
   which can be improved without changing the geometry kernel or abandoning
   `.edu` as the public check.

---

## 4. Concrete improvements, ranked

| Rank | Improvement | Impact | Effort | Risk |
|---|---|---|---|---|
| 1 | Corpus runner + CI + `--require-expect` | High | Low | Low |
| 2 | Unified diagnostic record with severity and outcome | High | Medium | Medium (compatibility) |
| 3 | Extend `# expect` / add `# expect-diagnostic` | High | Low–Medium | Low |
| 4 | Documentation/directive drift check; backfill the 8 unasserted scripts | Medium | Low | Low |
| 5 | Deterministic property/fuzz generator that emits `.edu` | High | Medium–High | Medium (scope) |
| 6 | Tolerant golden snapshots for certificate/numeric facts | Medium | Medium | Medium (brittleness) |
| 7 | Performance/timeout budgets per script | Medium | Low | Low |

### 4.1 R1 — Make the corpus a real CI gate

Add a corpus mode to the existing runner (or a tiny wrapper that invokes it):

- discover `tools/scripts/**/*.edu` and `*.edc`;
- run each file in a child process with a timeout;
- capture exit code, structured report and duration;
- emit a summary and JUnit XML;
- support `--require-expect` so a script with no assertion is a failure unless
  it explicitly declares `# no-expect: <reason>`;
- run in CI on every pull request with Node 22 (the repository's `.nvmrc`
  target), without building the C++ backend.

This is the highest-value change because it converts an already-green corpus
into a regression gate. It does not require a schema migration. It should be
paired with adding `# expect:` to the eight scripts listed in §1.3.

A minimal CI job needs no npm install: check out, set up Node, run
`node tools/edc.js --corpus tools/scripts --junit build/edc-junit.xml`, upload
the report on failure. The runner already exits nonzero on a bad script; the
corpus mode only aggregates and formats.

### 4.2 R2 — One diagnostic record, with explicit severity and outcome

Normalize every producer's issue into one additive record. Keep the existing
codes and fields; add `family`, `severity`, `phase`, `disposition`,
`sourceIds` and a stable `id`. The normalization should happen at the pipeline
boundary, not by rewriting each diagnostic site.

The key design decision is to separate:

- **severity** — how bad this finding is (`info`, `warning`, `error`,
  `fatal`);
- **determination** — the semantic state
  (`determined`, `inferred`, `underdetermined`, `inconsistent`, `unsupported`);
- **outcome** — what the caller received (`ok`, `partial`, `unavailable`).

A single `status` string cannot carry all three. The current `status=` values
already demonstrate the collision between outcome and reason code.

This change should be additive: `reason`, `issues`, `determination` and
`status` remain for compatibility. `report()` can print the new fields while
the JSON report exposes both old and new shapes.

### 4.3 R3 — Extend the script assertion language

Keep `# expect:` as the public, readable check. Add:

- `outcome=ok|partial|unavailable` (result-level outcome);
- `determination=determined|inferred|underdetermined|inconsistent|unsupported`;
- `errors=0`, `warnings=2`, `infos=1`;
- `issueCounts=curve-projection-missing:2,point-correspondence-missing:1`;
- a new `# expect-diagnostic: { ... }` directive using the same recursive
  subset matcher as `# surface-query:`, so a test can assert
  `{"code":"coordinates-missing","severity":"warning","memberId":"a"}`;
- optionally, an error form for `# surface-query:` operations that throw
  (`expectError: {code, contains}`).

Backward compatibility is straightforward: existing `diagnostics=` and
`status=` continue to work; the new fields are additional vocabulary. The
`# expect` parser should gain decimal and negative numeric values, or those
checks should move to `# expect-diagnostic`. The current integer-only value
parser is a real limitation for radii, tolerances and volumes.

### 4.4 R4 — Backfill silent scripts and check documentation drift

Add machine expectations to the eight scripts that currently rely on prose.
This also creates regression coverage for the foundational edge cases
(two-view edge evidence, flat square, wedge, quad, rule-a).

Add a documentation check that extracts directive names from
`docs/MANUAL.md` and `docs/*.md` and verifies that `tools/edc.js` implements
each one. This catches the current `# pose-check:` discrepancy. A simple
whitelist in the runner is enough; no parser framework is needed.

### 4.5 R5 — A deterministic generator, not a second test suite

The repository rule is explicit: drawing verification uses `.edu` scripts and
`# expect`; do not add a separate unit-test suite. A generator can respect that
rule if it **emits `.edu` text and uses the public runner**, and if every
persisted regression is still a `.edu` script. The generator is a development
tool, not a parallel test format.

Start with **corpus mutation** rather than a from-scratch model generator:

- parse existing scripts into commands;
- mutate coordinates, roles, command order, duplicate/delete commands, and
  annotations;
- run the public pipeline;
- check invariants (below);
- shrink a failing case by deleting commands and simplifying numbers;
- write a minimized `.edu` repro for a maintainer to turn into a regression.

This is cheap to build, uses the existing corpus as seeds, and avoids needing
a complete solid generator. A second phase can add structured primitive
generation for boxes, prisms, plates and simple curved features.

### 4.6 R6 — Tolerant golden snapshots for high-value facts

Counts and status strings are not enough to catch a wrong volume, a shifted
axis or a broken certificate parameter. Add a small `# expect-json:` directive
with JSON Pointer paths and tolerance-aware numbers, for example:

- `volumeMm3` and `volumeMm3Exact` for closed declared solids;
- bounding box min/max;
- analytic surface parameters (`radius`, `axis`, `origin`, `center`);
- certificate counts (`checks`, `exactChecks`, `numericChecks`, `errors`,
  `warnings`);
- issue counts by code and severity;
- section/intersection results that are already expressible through
  `# surface-query:`.

Do not snapshot whole solid dumps. IDs, display vertex counts and inferred
faces are too unstable and would create churn. Snapshot the contract-level
facts that a reviewer can reason about.

### 4.7 R7 — Budgets and timeouts

The corpus contains large cases (`surface-intersect-spheres.edu`,
`large-prism.edu`, `surface-intersect-sphere-cylinder.edu`). Add per-script
time and memory budgets and tag "heavy" scripts so PR CI can run the fast set
while a nightly job runs everything. This is also necessary before fuzzing.

---

## 5. Proposed diagnostic schema and test-generation strategy

### 5.1 Diagnostic record

Proposed contract: `educad-diagnostic-v1`.

```json
{
  "schema": "educad-diagnostic-v1",
  "id": "strict:E12:coordinates-missing:a",
  "code": "coordinates-missing",
  "family": "correspondence",
  "severity": "warning",
  "phase": "strict",
  "disposition": "partial",
  "message": "Member a needs depth from another projection.",
  "entityId": "E12",
  "memberId": "a",
  "sourceIds": ["E12"],
  "line": 7,
  "command": "/point a 0 -8 plan",
  "details": { "missing": ["depth"] },
  "remediation": "Add a plan or side observation for member a.",
  "aliases": []
}
```

Field rules:

- `code` is stable, lowercase kebab-case, never reused. Existing codes are
  retained verbatim.
- `family` is one of `input`, `correspondence`, `geometry`, `topology`,
  `surface`, `operation`, `runtime`. It is derived from the existing prefixes
  where possible, and set explicitly for new codes.
- `severity` is `info`, `warning`, `error` or `fatal`.
- `phase` is `command`, `strict`, `correspondence`, `primitive`, `surface`,
  `certificate`, `operation` or `runtime`.
- `disposition` is `ignored`, `retained`, `partial` or `blocked`.
- `entityId` / `memberId` / `sourceIds` are optional but must be populated when
  the producer knows them. `sourceIds` is the stable evidence list.
- `line` and `command` are added by the script runner, not by the kernel.
- `details` is structured data; consumers must not parse `message`.
- `id` is deterministic from `(phase, code, entityId, memberId)` and an
  ordinal only if duplicates are retained.
- `remediation` is optional user-facing guidance.

A result-level record should carry:

```json
{
  "schema": "educad-reconstruction-result-v1",
  "outcome": "partial",
  "determination": "underdetermined",
  "geometry": {},
  "certificate": {},
  "diagnostics": [],
  "counts": { "info": 0, "warning": 1, "error": 0, "fatal": 0 }
}
```

### 5.2 Severity, determination and outcome

| Situation | Severity | Determination | Outcome |
|---|---|---|---|
| Ignored helper, annotation, or unsupported non-geometric entity | `info` | `determined` / `inferred` | `ok` |
| Ambiguous or missing evidence, usable preview retained | `warning` | `underdetermined` / `inferred` | `partial` |
| Missing evidence, no whole-model result | `warning` | `underdetermined` | `unavailable` |
| Contradictory coordinates, stale incidence, non-manifold declared topology | `error` | `inconsistent` | `unavailable` |
| Requested feature outside the contract | `warning` | `unsupported` | `partial` or `unavailable` |
| Internal invariant, unreadable file, timeout, unexpected exception | `fatal` | not applicable | `unavailable` |

The reducer should be deterministic:

1. any `fatal` -> `unavailable`;
2. any `error` -> `unavailable` unless a partial preview is explicitly
   retained, in which case `partial`;
3. any `warning` -> `partial` if geometry exists, else `unavailable`;
4. only `info` -> `ok`.

This preserves the current strict precedence (`inconsistent` > `unsupported` >
`underdetermined`) while giving the UI and CI a single severity count.

### 5.3 Compatibility with the current API

- Keep `status`, `reason`, `issues`, `determination` and `topologyStatus`.
- Add `outcome`, `counts` and `diagnostics` as new fields; do not rename the
  old ones in this round.
- Keep `certificate` exactly as-is; the new schema is an envelope, not a
  replacement for the detailed certificate.
- Add an alias table for any code that is renamed. Never silently change the
  meaning of an existing code.
- Keep `# expect diagnostics=` matching the code set. New assertions use the
  richer record.

### 5.4 Test-generation strategy

The generator is optional and should be justified by its output, not by a new
test framework. Proposed name: `tools/edc-generate.js`. It is invoked as a
development command, not as `npm test`.

**Inputs**

- seed (integer), number of cases, mutation budget, timeout;
- a set of seed scripts from `tools/scripts/`;
- optional primitive templates for boxes, prisms, plates and simple curved
  features.

**Mutation operators**

- translate a subset of coordinates;
- change a view role (`PLAN` / `ELEVATION` / `PROFILE` / `BOTH`);
- add/remove a point, edge, annotation or projector;
- reorder independent commands;
- duplicate an entity or a member ID;
- perturb a coordinate by an exact decimal step;
- truncate or corrupt JSON in a `# surface-query:`;
- replace a caption with a Unicode or empty caption;
- inject extreme finite values (`1e-9`, `1e9`) and near-degenerate values.

**Invariants**

| ID | Invariant | Oracle |
|---|---|---|
| P1 | determinism | same script twice gives identical properties and certificate status |
| P2 | idempotence | running the same file again does not mutate the input table |
| P3 | annotation invariance | adding `TEXT`, `DIMENSION`, `DATUM_AXIS` or a construction helper does not change topology or certificate status |
| P4 | translation | translating all sheet coordinates preserves topology and shifts bounds predictably |
| P5 | uniform scale | scaling coordinates by `k` scales lengths/radii by `k` and volume by `k^3` |
| P6 | view symmetry | swapping front/top and flipping plan `y` preserves the 3D model |
| P7 | profile sign | `s=+1` with mirrored `xRef`/`dRef` agrees with `s=-1` |
| P8 | mutation detection | deleting a required view/edge yields the expected diagnostic family, not a crash |
| P9 | exactness | `0.1 + 0.2` vs `0.3` behaves according to the declared exact-decimal contract |
| P10 | parser safety | arbitrary token streams return `{ok:false}` or a valid result; `# reject` remains atomic |
| P11 | certificate consistency | `validate` and `certify` compute the same boundary/shell incidence; certificate status follows the documented mapping, including the empty-model/open-component `partial` cases |
| P12 | surface API safety | random planes/surfaces return a valid result, `null`, or a coded refusal; never throw |

**Shrinking**

When an invariant fails, reduce the script by:

1. deleting commands that do not affect the failure;
2. replacing coordinates with simpler values while preserving the failure;
3. removing captions/annotations;
4. minimizing the number of entities.

Write the minimized case to a file named with the seed and a short hash. A
maintainer reviews it, adds the intended `# expect:`/`# expect-diagnostic:`,
and commits it as a normal `.edu` regression. This is the crucial step that
keeps the public format authoritative.

**Where it runs**

- PR: the full corpus plus a small fixed seed set (for example 100 cases);
- nightly: a larger seed set (for example 5,000 cases) and a longer timeout;
- releases: the full corpus plus a fixed historical seed list.

The generator must be deterministic and must not depend on wall-clock time or
random device state. Print the seed and the mutation trace on failure.

### 5.5 Why this does not violate the "no separate unit test suite" rule

The rule is about the *verification format*, not about tooling:

- the authoritative artifact remains a `.edu` script;
- the assertion remains `# expect:` / `# surface-query:`;
- the runner remains `tools/edc.js`;
- generated cases are temporary unless a failure is minimized into a committed
  `.edu` regression;
- the generator does not replace the public check and does not introduce a
  second test runner.

The one justified exception is that the generator checks invariants
programmatically. That is a *checker*, not a suite: it has no persistent test
cases of its own, and every persistent case it produces becomes a drawing
script. If the maintainers want a stricter reading, keep the generator
developer-only and do not gate PRs on it; the corpus runner and schema changes
stand on their own.

---

## 6. Risks and migration

| Risk | Impact | Mitigation |
|---|---|---|
| Diagnostic code churn breaks `# expect diagnostics=` | High | Keep codes stable; alias table; additive schema; version the envelope |
| Expected failures bless regressions | High | Require review of expectation changes; property invariants; `--require-expect`; separate `known`/`expected` marker |
| Severity semantics drift between layers | Medium | One reducer; one mapping table; tests for the mapping |
| Fuzz false positives on valid but unsupported drawings | Medium | Assert only guaranteed invariants; classify `unsupported` separately; shrink and review |
| Generated cases bloat the repository | Medium | Do not commit generated corpora; commit only minimized repros |
| Runtime grows beyond CI budget | Medium | Tags, per-file timeout, PR fast set, nightly full set |
| Exact decimal arithmetic is brittle under coordinate edits | Medium | Use tolerances only for numeric checks; keep exact checks for topology; do not auto-snap |
| CI does not cover browser/UI/backend | Medium | Add a separate smoke job later; do not pretend the script corpus covers it |
| Documentation drifts from the runner | Medium | Directive whitelist check; docs generation from a single table |
| The report becomes a second source of truth | Medium | Derive printed diagnostics from the structured record; keep prose as explanation |
| Overly strict golden snapshots create churn | Medium | Snapshot contract facts, not full dumps; use tolerant numbers |

### Migration phases

**Phase 0 — harness only (one PR).**

- Add `--corpus`, `--json`, `--junit` and `--require-expect`.
- Add the CI workflow.
- Add `# expect:` to the eight silent scripts.
- Fix the `# pose-check:` documentation discrepancy or implement the directive.
- No kernel or schema change.

**Phase 1 — additive schema.**

- Add `educad-diagnostic-v1` normalization at the pipeline boundary.
- Add `outcome`, `counts` and `diagnostics` to the result.
- Keep all legacy fields and codes.
- Print severity/entity/member in the text report.
- Add `outcome=`, `errors=`, `warnings=` to `# expect:`.

**Phase 2 — richer assertions.**

- Add `# expect-diagnostic:`.
- Migrate the 48 scripts that already assert `diagnostics=` to the richer form
  only where it adds value; leave the rest.
- Add `# expect-json:` for selected certificate/volume facts.

**Phase 3 — generator.**

- Add `edc-generate.js` behind a development command.
- Run a fixed seed set in nightly CI.
- Commit only minimized regressions.

**Phase 4 — tighten.**

- Make `--require-expect` the default for CI.
- Add performance budgets and heavy tags.
- Revisit whether the browser/UI needs a separate smoke harness.

Rollback is straightforward because each phase is additive. The runner can
always emit the legacy text report and ignore the new fields.

---

## 7. Ranked recommendation

1. **Make the corpus a CI gate now.** Add `--corpus`, `--json`, `--junit`,
   `--require-expect`, a timeout, and a GitHub Actions workflow. Backfill the
   eight silent scripts. This is the largest reliability gain for the least
   design risk.
2. **Adopt one diagnostic envelope with severity, family, phase, disposition
   and outcome.** Keep the existing codes and fields. Normalize at the pipeline
   boundary, not at every call site.
3. **Extend `.edu` assertions additively.** Add `outcome`, severity counts,
   per-diagnostic subset matching and tolerant numeric expectations. Preserve
   `diagnostics=` and `status=`.
4. **Check documentation against the runner and backfill expectations.** A
   stale directive or an unasserted script is a silent test hole.
5. **Add the deterministic generator only after the harness and schema are
   stable.** Use it to find crashes and invariant violations, then shrink every
   real failure into a normal `.edu` regression.
6. **Add tolerant golden facts for high-value cases.** Volumes, bounds,
   analytic parameters and certificate counts. Do not snapshot whole models.
7. **Add budgets and a nightly full run.** Separate fast PR checks from heavy
   and fuzz workloads.

The order is deliberate: the first three changes make the existing investment
visible and trustworthy; the generator is valuable only after there is a
schema and a gate to catch its output.

---

## 8. Unverified claims and limitations

- EduCAD measurements were taken on this worktree at commit `43d3b7f` with
  Node `v24.21.0`. All 151 scripts exited 0, but "clean" includes 16 scripts
  that finish unavailable; not all of them assert that outcome directly. No
  browser, UI, backend or performance tests were run.
- The count of 97 literal code/issue strings is a mechanical extraction from
  the diagnostic-producing modules. It includes some status values and
  certificate check names and should be treated as an inventory snapshot, not
  a stable API count.
- The `# pose-check:` finding means "not implemented in `tools/edc.js`".
  It does not prove that no other part of the app consumes that directive.
- OCCT observations use the OCCT 8.0.1 documentation and the `master` source
  files. The exact release tag corresponding to every documentation page was
  not independently verified. No OCCT tests were run locally.
- FreeCAD observations use `main` at version `27.1.0-dev` (the `version.json`
  in the repository) and the listed `tests/` files. No FreeCAD tests were run.
- Manifold observations use `master` (CMake version 3.5.1; latest tagged
  release `v3.5.4` from 2026-09-25). The fuzz target was not built or run.
- OpenSCAD observations use `master`; the latest tagged release is
  `openscad-2021.01`. The development version defaults to a date-based version.
  No OpenSCAD tests were run.
- CGAL observations use the CGAL 6.2.1 manual and the public testing wiki.
  No CGAL test suite was run. The statement that CGAL has no documented
  coverage-guided fuzzing harness is limited to the public testing materials
  reviewed; absence of documentation is not proof of absence.
- The comparison ratings are qualitative and relative to each project's own
  contract. They are not benchmark results.
- The proposed schema and generator are designs, not implemented code. Their
  effort estimates are rough.

---

## References

Accessed 2026-11-11.

### EduCAD

- `tools/edc.js` — script runner, directives, report and exit codes.
- `public/lib/educad-reconstruct.js` — shared pipeline, partial results and
  diagnostics.
- `public/lib/educad-strict.js` — exact reconstruction, issue records and
  determination semantics.
- `public/lib/educad-surfaces.js` — analytic validation and certificate.
- `public/lib/educad-verify.js` — separate lesson grading verifier.
- `docs/RECONSTRUCTION_CONTRACT.md` — exact contract and result semantics.
- `docs/PRIMITIVE_RECONSTRUCTION.md` — script-only verification and property
  vocabulary.
- `docs/SURFACE_MODEL.md` — certificate schema, exact vs numeric checks,
  statuses.
- `docs/MANUAL.md` — public verification and diagnostic tables.
- `CONTRIBUTING.md` — verification workflow.

### OCCT

- OCCT 8.0.1, *Automated Testing System*:
  <https://dev.opencascade.org/doc/overview/html/occt_contribution__tests.html>
- OCCT 8.0.1, *Draw Test Harness*:
  <https://dev.opencascade.org/doc/overview/html/occt_user_guides__test_harness.html>
- `BRepCheck_Analyzer` reference:
  <https://dev.opencascade.org/doc/refman/html/class_b_rep_check___analyzer.html>
- `BRepCheck_Status` reference:
  <https://dev.opencascade.org/doc/refman/html/_b_rep_check___status_8hxx.html>
- `BRepCheck_Result` source:
  <https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Result.hxx>
- `BRepCheck_Status` source:
  <https://github.com/Open-Cascade-SAS/OCCT/blob/master/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Status.hxx>
- `Message_Report` reference:
  <https://dev.opencascade.org/doc/refman/html/class_message___report.html>
- `Standard_Failure` reference:
  <https://dev.opencascade.org/doc/refman/html/class_standard___failure.html>

### FreeCAD

- FreeCAD `main`, `version.json` (`27.1.0-dev`):
  <https://github.com/FreeCAD/FreeCAD/blob/main/version.json>
- `tests/CMakeLists.txt`:
  <https://github.com/FreeCAD/FreeCAD/blob/main/tests/CMakeLists.txt>
- `tests/src/Base/Exception.cpp`:
  <https://github.com/FreeCAD/FreeCAD/blob/main/tests/src/Base/Exception.cpp>
- `src/Base/Exception.h`:
  <https://github.com/FreeCAD/FreeCAD/blob/main/src/Base/Exception.h>
- `src/App/DocumentObject.h` (`DocumentObjectExecReturn`):
  <https://github.com/FreeCAD/FreeCAD/blob/main/src/App/DocumentObject.h>
- `src/App/Document.cpp` (`_recomputeFeature` exception/log handling):
  <https://github.com/FreeCAD/FreeCAD/blob/main/src/App/Document.cpp>
- `tests/src/App/DocumentObject.cpp`:
  <https://github.com/FreeCAD/FreeCAD/blob/main/tests/src/App/DocumentObject.cpp>
- Python module test example:
  <https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/PartDesign/TestPartDesignApp.py>

### Manifold

- Manifold master, `include/manifold/manifold.h` (`Error`, `Status`):
  <https://github.com/elalish/manifold/blob/master/include/manifold/manifold.h>
- Manifold FuzzTest target, `test/manifold_fuzz.cpp`:
  <https://github.com/elalish/manifold/blob/master/test/manifold_fuzz.cpp>
- Manifold test registration, `test/CMakeLists.txt`:
  <https://github.com/elalish/manifold/blob/master/test/CMakeLists.txt>
- Manifold version, `CMakeLists.txt` (3.5.1):
  <https://github.com/elalish/manifold/blob/master/CMakeLists.txt>
- Manifold release `v3.5.4`:
  <https://github.com/elalish/manifold/releases/tag/v3.5.4>

### OpenSCAD

- OpenSCAD `doc/testing.md`:
  <https://github.com/openscad/openscad/blob/master/doc/testing.md>
- OpenSCAD `tests/CMakeLists.txt`:
  <https://github.com/openscad/openscad/blob/master/tests/CMakeLists.txt>
- OpenSCAD test helpers, `tests/cmake/TestFunctions.cmake`:
  <https://github.com/openscad/openscad/blob/master/tests/cmake/TestFunctions.cmake>
- OpenSCAD CGAL translation and nonplanar retry,
  `src/geometry/cgal/cgalutils.cc`:
  <https://github.com/openscad/openscad/blob/master/src/geometry/cgal/cgalutils.cc>
- OpenSCAD option parsing (`--hardwarnings`), `src/openscad.cc`:
  <https://github.com/openscad/openscad/blob/master/src/openscad.cc>
- OpenSCAD latest tagged release:
  <https://github.com/openscad/openscad/releases/tag/openscad-2021.01>

### CGAL

- CGAL 6.2.1, *Checks: Pre- and Postconditions, Assertions, and Warnings*:
  <https://doc.cgal.org/latest/Manual/devman_checks.html>
- CGAL 6.2.1, *Running a Testsuite Locally*:
  <https://doc.cgal.org/latest/Manual/devman_testing.html>
- CGAL testing wiki (CTest, labels, nightly runs):
  <https://github.com/CGAL/cgal/wiki/Testing>
- Example package test registration:
  <https://github.com/CGAL/cgal/blob/master/Polygon_mesh_processing/test/Polygon_mesh_processing/CMakeLists.txt>
- CGAL repository overview:
  <https://github.com/CGAL/cgal>

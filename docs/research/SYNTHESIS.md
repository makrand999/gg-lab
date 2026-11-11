# Kernel and 2D→3D synthesis

Status: decision record. This chooses the next kernel architecture from the
research wave. Implementation starts only after this document is accepted.

## Executive decision

EduCAD should not adopt an external CAD kernel. It should evolve its existing
analytic, inferred model into an **analytic B-rep-lite** with:

1. persisted boundary identity;
2. one explicit tolerance and near-degeneracy policy;
3. an in-house 2D arrangement/planar-region Boolean layer;
4. bounded intersection and patch clipping;
5. analytic silhouettes and interval hidden-line removal;
6. a correspondence-audit graph for 2D→3D;
7. a full-rebuild canonical pipeline with caching, not a rewrite into an
   incremental kernel.

OCCT, CGAL, Manifold, FreeCAD and SolveSpace are design references, not runtime
dependencies. Manifold may become an optional mesh-only fallback later. No
GPL/LGPL code enters the default MIT artifact.

## Baseline

Measured before the research wave:

- 151 committed core scripts; 156 including the concurrent pose work;
- 0 failures;
- 143,047.8 ms total in-process, 916.97 ms mean for 156 scripts;
- slowest: `surface-intersect-cylinders.edu` 9.45 s,
  `truncated-cylinder-ambiguous.edu` 8.93 s,
  `surface-intersect-sphere-cylinder.edu` 7.36 s;
- `educad-surfaces.js` 2,588 lines, `educad-reconstruct.js` 3,851 lines;
- 37 diagnostic code literals.

Confirmed defects found during research:

- shared section identity is lost after JSON round-trip (`useCount 2 → 1`);
- oblique `arc` previews are rejected by `Ref3d.validPreview`;
- `elements`-only loops produced by `split` cannot be rebuilt by `build`;
- sphere–sphere and parallel-cylinder gaps of `1e-5` are reported as exact
  tangency;
- `restoreTable()` publishes `clear`, which nulls the save UI's `current.id`;
- `expectation.md` says `rule-a.edc`/`flat-square.edc` produce `2F`, but they
  produce `1F`;
- exact inferred-surface validation dominates reconstruction time;
- the full sheet is re-rendered on every 3D orbit frame.

## Evaluation criteria

Scores are 1–5; weights are product-biased.

| Criterion | Weight | Meaning |
|---|---:|---|
| Correctness / robustness | 30% | Tangency, coincidence, near-degeneracy, honest uncertainty |
| Domain fit | 20% | Orthographic graphics, analytic surfaces, sections, features |
| Implementation cost | 15% | Incremental build without a rewrite |
| Performance | 15% | Interactive latency, bounded worst cases |
| Dependencies / licensing | 10% | MIT-compatible, zero or optional dependencies |
| Testability / diagnostics | 10% | `.edu` verification and actionable failure codes |

## Research consensus

Reports: `api-build-licensing`, `boolean-2d`, `brep-intersections`,
`exact-tolerances`, `hlr-projection`, `curve-architecture`, `fillet-blend`,
`2d3d-sketch-features`, `document-history`, `performance-render`,
`2d3d-line-drawing`, `2d3d-constraints`, `testing-diagnostics`,
`app-architecture`, `2d3d-multiview-fitting`.

Consensus across independent tracks:

1. **Boundary identity is foundational.** Object identity sharing cannot
   survive serialization; explicit IDs are required before more topology.
2. **One tolerance policy.** Near-tangent/near-coincident/near-parallel must be
   explicit result kinds with signed gaps. Exactness must not be claimed from a
   tolerance test.
3. **Analytic model first; mesh fallback second.** HLR, intersections and
   Booleans should be analytic where possible, with the mesh used for preview,
   fallback and explicit approximation.
4. **2D arrangement before 3D Boolean.** A planar arrangement/region Boolean is
   the smallest sound step and fixes the recess-mouth/plate contradiction.
5. **No external runtime kernel.** OCCT is too large and LGPL-sensitive; CGAL
   high-level packages are GPL/ambiguous; SolveSpace and OpenSCAD are GPL;
   Manifold is Apache-2.0 but mesh-only. Borrow architecture, not code.
6. **Correspondence needs alternatives.** Replace silent unique-match rejection
   with scored candidate graphs and cycle consistency; return alternatives.
7. **Performance is a correctness requirement.** Exact validation must be
   deferred or asynchronous; caching and redraw boundaries are P0.
8. **Feature recognition should be a graph.** Express recesses, fillets and
   holes as predicates over an oriented surface-adjacency graph.
9. **Keep full rebuild canonical.** Add incremental paths only for explicit
   operations and previews; compare incremental and full hashes.
10. **The public format stays `.edu`.** Add corpus/CI tooling, not a parallel
    unit-test suite.

## Decision record

### D1. Kernel entity/topology model

**Chosen:** analytic B-rep-lite v2 as a shadow model projected to v1.

- `Surface` = unbounded analytic support (plane/cylinder/cone/sphere, later
  torus/NURBS).
- `Face` = trimmed surface bounded by `Loop`s of `EdgeUse`s.
- `Edge` = shared analytic boundary element; `Vertex` = explicit station.
- Persist IDs for sections, curves, lines, generated sub-arcs and polylines.
- Keep `geometry.surfaces`, loops and incidence as the v1 projection.

**Rejected:** full OCCT-style B-rep now (cost, LGPL, rewrite); object-identity
only (breaks serialization); mesh-first kernel (loses analytic domain fit).

**Why:** `curve-architecture` verified that object identity sharing is lost on
JSON round-trip, and `brep-intersections` shows bounded clipping needs shared
topology.

**First step:** boundary identity v2 + JSON round-trip proof.

### D2. Public API and module boundary

**Chosen:** one aggregate `EduCADKernel` with `apiVersion`, `contracts`,
`capabilities`, `version`; machine-readable `educad-api.json`; dependency
allowlist and kernel-purity check.

- Kernel modules: deterministic, no DOM/network/time/random.
- App shell may depend on kernel; kernel must not depend on app shell.
- Keep UMD and deep imports internal.
- Add release identity and `THIRD_PARTY_NOTICES.md`.

**Rejected:** npm package now; automatic plugin protocol; WASM backend now.

### D3. Surface–surface intersections

**Chosen:** two layers.

1. `Surfaces.intersect(a,b)` stays the support-level API.
2. `intersectBounded` / `clipBranchToPatch` clips branches to loops and natural
   domains, using exact cut stations, interval midpoint classification and
   periodic seam merging.

Add `classifyPoint(surface, point)` returning
`inside | outside | boundary | unknown` with residual and method. Make
tangency/coincidence/boundary-coincidence explicit result kinds.

**Order:** plane–conic clipping, cone conic parameterization, bounded
sphere–sphere, bounded coaxial sphere–cylinder, clipped parallel
cylinder–cylinder, bounded plane–plane overlap. Leave skew cylinder–cylinder
and offset-axis sphere–cylinder explicitly unsupported.

**Rejected:** full arrangement for every intersection; sampled polygon
intersections; OCCT/CGAL dependency.

### D4. Boolean and 2D arrangement strategy

**Chosen:** in-house 2D arrangement and planar-region Boolean first.

- Region algebra over planar faces, inner loops, coincident edges and holes.
- Analytic feature closure: contained inner loop fast path, planar face
  splitting by curves, host-face trimming for recesses/fillets.
- Then limited analytic B-rep Booleans for supported surface pairs.
- Manifold is an optional mesh-only fallback for preview/export.

**Rejected:** mesh Boolean as source of truth; SDF/implicit as analytic output;
CGAL/Clipper2 runtime dependency.

**First milestone:** planar face minus a wholly contained analytic loop, shared
with the cavity, display hole carried through; `cylindrical-recess.edu` reaches
`surfaceOpen=0`, `surfaceBoundary=0`, `surfaceCertificate=ok`.

### D5. Fillet and blend representation

**Chosen:** construct from supports, not drawn tangent edges.

- Offset the two supports by radius, intersect to get the spine, project the
  spine onto each support to get spring curves.
- Drawn arcs/tangent lines are evidence for radius, edge and end stations.
- Close the existing test fixture first: two end caps + back plane → watertight
  corner-bar test solid.
- Then integrate with a real block edge; trim adjacent faces by spring lines.
- Torus only for circular-edge rounds; corners later (sphere/torus, refuse
  unequal/4+ until a fill exists).
- Constant-radius blends are G1, not G2.
- SDF/mesh blends are approximate only.

**Rejected:** continuing to infer fillets from drawn tangent strokes alone;
claiming torus/curvature continuity without a torus surface kind.

### D6. Hidden-line removal and projection

**Chosen:** analytic silhouettes + interval HLR over the bounded surface model.

- Exact silhouettes for plane/cylinder/cone/sphere.
- Split edges/curves at silhouette and occlusion stations; classify intervals.
- Keep mesh HLR as explicit fallback with `mesh-fallback` evidence.
- Never derive analytic output from `geometry.faces`.

**First milestone:** exact sphere circle, truncated-cylinder inclined ellipse
plus clipped generators, exact plate-boundary splits.

**Rejected:** pure mesh HLR; OCCT HLR dependency; current face-normal heuristic
as the analytic answer.

### D7. Exact arithmetic and tolerance policy

**Chosen:** `edu-tolerance-v1` plus exact predicates.

- `1e-6` relative / `1e-7` absolute length; `1e-9` rad numeric angle;
  `1e-6` rad near-parallel window; `mode:'compat'` for existing scripts.
- Near-degeneracy result kinds: `near-tangent`, `near-coincident`,
  `near-parallel` with signed gaps.
- Exact orientation/coplanarity/point-on-plane with float filter + BigInt
  rational fallback.
- Exact coefficient identities for circles/ellipses/lines on supported
  surfaces; store raw parameters alongside normalized fields.
- Interval arithmetic only where rational elimination is insufficient; do not
  treat widened `Math.sin/cos/sqrt` as proof.
- Optional strict certificate mode: `ok` requires `guarantee:'exact'` or
  `'validated'`; tolerance-only checks become `partial`.

**First milestone:** `educad-predicates.js`, `near-tangent` for sphere/cylinder
pairs and plane sections, certificate `guarantee`/`evidence` fields.

### D8. 2D→3D correspondence and constraint strategy

**Chosen:** exact constraint report + combinatorial correspondence graph +
optional nonlinear refinement.

1. Normalize strict observations into a constraint IR with per-member DOF/free
   axes, exact conflict sets, and opt-in partial geometry.
2. Replace silent unique-match rejection with scored candidates, hard explicit
   IDs, three-view cycle checks and reported alternatives.
3. Add visibility as a first-class constraint
   (`hiddenLines: complete | omitted | unknown`).
4. Add set-valued missing-view handling: certain/possible/disputed strokes.
5. Use LM/GN refinement only for inferred constraints; mark results inferred,
   never certified.
6. Z3 only as an offline test oracle; no solver dependency.

**Rejected:** embedding SolveSpace/planeGCS/Ceres; SMT per keystroke; ML as the
core recognizer.

**First milestone:** read-only correspondence audit + constraint diagnostics
(`dof`, `freeAxes`, `conflictSets`, alternatives) with four `.edu` sheets.

Implementation order from the multi-view research:

1. **Consensus v0** — shared evidence scorer with unique-source accounting,
   ternary `covered / contradicted / silent` votes per view, ranked hypotheses;
   no geometry change.
2. **Robust conic fitting** — normalized direct least squares plus IRLS
   (Huber/Tukey), residuals in millimetres, parameter covariance, and
   uncertainty-aware matching gates.
3. **Global discrete partition** — branch-and-bound/exhaustive enumeration over
   point/curve tracks with unique evidence, instead of greedy pairwise matching.
4. **Constrained BA analog** — refine only free parameters, freeze declared
   coordinates, roll back if exact validation fails; no camera model or gauge
   freedom.
5. **Dimensions and sections as hard tie-breakers**, not prerequisites.

### D9. Performance and incremental recompute

**Chosen:** full rebuild remains the canonical oracle; make the UI fast.

P0:
- defer exact inferred-surface validation; app shows `pending` until async
  validation completes; `.edc`/export still validates synchronously;
- cache reconstruction by table revision + options;
- stop re-rendering the whole sheet on 3D orbit frames;
- remove redundant `rebuildSolid()` calls on mode switches.

P1:
- cache HLR per view; precompute face normals/adjacency;
- interactive preview/LOD;
- structural-sharing undo instead of full JSON snapshots.

P2:
- worker/offscreen evaluation;
- staged/component caches behind full-rebuild fallback, verified against full
  hashes.

**Rejected:** incremental kernel rewrite now; trusting unmeasured micro-caches.

### D10. Testing, diagnostics and CI

**Chosen:** `.edu` remains the public verification format; add a corpus runner
and CI.

- `tools/edc.js --corpus --json --junit --require-expect`.
- CI: backend build, core script corpus, manual rebuild diff, module require,
  API manifest, licence check.
- Additive diagnostic schema: `severity`, `family`, `phase`, `disposition`,
  `outcome`, preserving all existing codes.
- `# expect-diagnostic:` subset matching; tolerant numeric facts; timeouts.
- Deterministic property/fuzz generator that emits minimized `.edu` files.
- Backfill the 8 scripts with no machine assertion.
- Fix stale docs/directives (`rule-a`/`flat-square` F counts; pose-check
  documentation).

**Rejected:** a parallel unit-test suite as the primary gate; full solid
snapshots.

### D11. Document, history and persistence

**Chosen:** one document/transaction facade plus save format v2.

- Atomic table `replace`/batch event; one revision per transaction.
- Save v2 envelope with migration registry; v1 readable; reject newer versions
  without mutating the sheet.
- Server drawing revisions and compare-and-swap (409 conflicts).
- Preview format version, source fingerprint and contract IDs; hide stale
  previews.
- Structural-sharing undo with a byte bound; keep full rebuild as oracle.
- Fix `restoreTable` clear-event save-ID bug.

### D12. App architecture and grading

**Chosen:** module manifest and dependency guardrails first; then document
facade; then pure-core/mount split; then command/action objects.

- One manifest drives page script order and dependency checks.
- Keep existing files as re-export facades during migration.
- Unify grading behind `grading-v1` with declared member identities; freeze
  `legacy-2d` for old sets.
- Version `GeometryModel` and split reconstruction stages after boundaries are
  stable.

## Roadmap

### Phase 0 — correctness and guards (next)

1. Boundary identity v2 + JSON round-trip proof; fix `arc` preview and
   `elements`-only rebuild.
2. `edu-tolerance-v1` + near-degeneracy + exact predicates first slice.
3. Document atomic replace, save v2, undo/save-ID bug.
4. Corpus runner + CI + stale doc fixes.
5. Performance P0: defer validation, revision cache, orbit redraw.

### Phase 1 — analytic B-rep-lite

- Surface/Face/Edge/EdgeUse/Loop shadow model, projected to v1.
- `intersectBounded`, `classifyPoint`, clipped branches, explicit contacts.
- 2D arrangement and planar-region Boolean.

### Phase 2 — feature closure and HLR

- Recess mouth as inner loop; fillet watertight corner fixture; block-edge
  integration.
- Analytic silhouettes + interval HLR.
- Feature graph v1 over surface adjacency.

### Phase 3 — 2D→3D reasoning

- Correspondence audit graph + cycle consistency.
- Constraint IR with DOF/conflict sets; visibility and missing-view states.
- Optional nonlinear refinement for inferred constraints.

### Phase 4 — long tail

- Torus/offset/NURBS surfaces with typed certificates.
- Variable-radius fillets, corners, skew intersections.
- Optional Manifold mesh fallback; optional native/WASM backend.

## Scope freeze

**v1 must finish:** Phase 0 and Phase 1, plus the first milestones of Phase 2
and Phase 3.

**v2, not a gap:** torus/NURBS surfaces, variable-radius fillets, skew quartic
intersections, general Boolean solids, ML reconstruction, native/WASM backend,
plugin ecosystem.

Anything discovered inside Phase 0–1 is a blocker. Anything outside is v2.

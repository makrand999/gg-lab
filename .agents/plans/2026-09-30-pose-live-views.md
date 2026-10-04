# Pose live views: exact 2D projections from the posed solid

## Purpose

Pose mode answers "what if this sat the other way" — but today only the 3D
glass tells the truth. The 2D views ride along through fitted 2D maps that
move existing ink as rigid-ish sheets. That breaks on the exact question
users ask: draw the tutorial hex prism, spin it, and the plan should show
the top and bottom hexagons separating into two offset outlines. It shows
one, because a fitted map cannot split coincident geometry. This plan adds
exact per-frame 2D projections of the posed solid (visible + hidden edges)
drawn over the riding ink, so VP and HP always show the true stance.

## Problem

- Rest state: a standing prism's top and bottom faces coincide in plan, so
  the sheet holds ONE drawn hexagon. Its edges carry no 3D height.
- Z-spin the model: true plan x of each vertex shifts by an amount that
  depends on its height (`x' = cx + (x-cx)·cosθ − (y−cy)·sinθ`), so top
  and bottom hexagons separate. The fitted plan map is one 2D transform
  for all plan ink — it moves the single drawn hexagon as one piece and
  can neither split it nor conjure the second outline.
- General form: any pose whose true per-vertex motion needs the
  out-of-view coordinate (depth for VP, height for plan) is
  unrepresentable by a 2D map. Fits show conditional means; the missing
  spread/branches are exactly what the user asked to see.
- Evidence: `mirror/files/www.geogebra.org/educad-pose.js`
  (`follow2D`, `poseEntity`), page `poseDrawCopies`/`drawList` in
  `mirror/index.html` (~line 1980), phase34 tests
  `tools/test-phase34-pose.js`.

## Idea

Each frame in pose mode, take the already-computed posed mm verts
(`poseSimsFor` → `sims.posed`, ~free), orthographically project the
solid's edges into VP `(x, y)` and HP `(x, −z)` (the locked Monge
contract, same as `reproject`), classify each projected edge as
visible or hidden by occlusion testing against the posed faces, and
draw the result as an ephemeral overlay: visible edges in full ink,
hidden edges dashed (existing BIS A/E styles through `renderEntity`).
The riding ink stays underneath, faded, so dimensions, projectors,
labels, and annotations keep their context while the overlay carries
the truth. At rest the overlay coincides with the ink exactly and is
invisible; under foreshortening spins it shows what the fit cannot
(the two hexagons). Nothing is written to the entity table: pose mode
stays visualization-only, and the overlay needs no clamp of its own —
its endpoints are posed verts, already covered by the exact
datum clamp (straight segments between held endpoints cannot cross a
half-plane boundary).

## Goal

In pose mode, VP and HP always display the exact current projection
of the posed solid (visible + hidden edges), including branches the
fitted views cannot represent, while the existing riding ink, datum
clamp, and HUD behavior are preserved.

## Success Criteria

- Z-spun hex prism plan shows two separated hexagon outlines (exact
  vertex positions within 1e-6 of `reproject(applyPose(...))`).
  (Y-spins of right prisms correctly keep the rings coincident —
  Y rotation preserves the x–z footprint as a set.)
- Hidden edges render dashed, visible solid, matching the 3D glass
  verdicts on convex solids (9 solid + 3 dashed cube at iso rest).
- Rest pose renders pixel-identical to today (overlay coincides).
- Non-solid ink (dims, projectors, labels, text) still rides fits.
- Datum rule unchanged: no overlay segment crosses the XY line, ever.
- Full `npm test` green; manual documents the overlay; obscura E2E
  drives a Y-spin and observes the split.

## Approach

New pure module `educad-project.js` (zero deps, dual-env, ES5 style
matching the codebase) + thin page wiring. No new libraries.

- `projectSolid(verts, edges, faces, view)` with
  `view ∈ {'front','top'}` returns
  `[{ax, ay, bx, by, hidden}]` in sheet mm.
- Projection is the Monge orthographic map (front: `(x, y)`,
  top: `(x, −z)`).
- Occlusion: midpoint raycast — an edge is hidden iff the ray from
  its midpoint toward the viewer pierces any face (faces triangulated
  as fans; reconstruct faces are planar/convex for classes A/B/D).
  Faceless wireframes read all-solid, same as the glass.
- Page: `updatePoseView` already holds `sims.posed`; build both
  overlays there (prism: ~18 edges × ~6 faces ≈ hundreds of tri
  tests — microseconds, 60 fps safe), stash on `poseState`,
  draw after the faded ink in the `drawList` loop, skipping the
  label pass (overlay has no ids/names).
- Bridge `window.educadPoseViews()` gains the overlay segments so
  E2E can assert the hexagon split (bbox growth) without pixels.

## Key Decisions

- Overlay + faded ink (recommended) over overlay-only or fit-only:
  truth stays prominent while dims/projectors keep context; rest
  state is unchanged. Open question 1 lets the user veto the fade.
- Midpoint raycast over face-orientation test: strictly more correct
  (handles concave Class C), still trivial cost; agrees with the
  glass on convex solids. Faces assumed planar/convex (reconstruct
  contract); concave ngons may misclassify one edge — documented,
  same limitation class as the glass.
- New module over extending `educad-pose.js`: projection is
  independently testable and reusable (export/print later); pose
  module keeps transform/gesture/clamp ownership.
- No clamp changes: overlay endpoints are clamped posed verts;
  segment interiors inherit the hold by half-plane convexity.
  Regression tests assert this rather than new clamp code.
- Naming avoids `drawPoseGhosts`/`educadPoseGhosts` (phase34 test 14
  pins their absence — those were a rejected 3D approach; this is 2D
  projection, `poseProjectedEdges`).
- Curves/circles: tessellated solid rims (K=24, Class D) project as
  segments automatically; drawn 2D circle entities keep riding fits
  (accepted, documented divergence — a circle cannot become an
  ellipse as an entity).

## Steps

1. `educad-project.js`: view projection, fan triangulation, segment
   helpers, midpoint raycast occlusion, `projectSolid` + input
   validation (`educad-pose.js` style `fail` guards). Reuse nothing
   from solid module (pure duplication of ~15 lines beats a
   load-order dependency; note `newellNormal`/`classifyEdges` in
   `educad-solid.js:132,419` as the consistency reference).
2. `tools/test-phase35-project.js` (new phase per repo convention):
   box/prism exactness at 0/45/90° per view; cube 9/3 hidden split;
   Z-45 tapered-prism plan yields two offset hexagons (assert segment
   endpoints + ring separation); faceless wireframe all-solid;
   concave occlusion case; degenerate inputs throw. Wire `test:phase35`
   + `npm test` chain.
3. Page wiring (`mirror/index.html`): `poseProjectedEdges()` helper,
   `updatePoseView` builds + stashes overlays, `drawList` loop draws
   faded ink then overlay (BIS A solid / E dashed via existing
   `renderEntity`), bridge exposes counts. Keep all phase34 string
   contracts intact.
4. Suite updates: phase35 page-wiring strings, README row + grand
   total bump (all `checks)` pins, same as the 934→937 bump),
   `docs/MANUAL.md` §3.13 overlay paragraph + `npm run build:manual`.
5. E2E + full validation (see below).

Non-goals: writing projections back to the table (pose stays
viz-only); overlay outside pose mode; shaded faces; text/dim
re-layout on the overlay; concave-ngon exact triangulation.

## Validation Plan

- `node tools/test-phase35-project.js` — projection exactness,
  hidden splits, hexagon-split regression, throw cases.
- `npm test` — full suite green including rebuilt manual freshness.
- Node sweep (repo-pattern probe): rest/identity overlay ≡ fitted
  outline; 0/45/90/135/180° Y/Z/X sweeps assert every overlay
  endpoint holds its datum side (reuse the phase34 probe method).
- Obscura E2E (`/root/dumb/mtype/bin/obscura`, puppeteer-core,
  app on 8124): guest session seed, `#sel-demo` → 3view, pose on,
  lift, Z-spin → bridge top-overlay bbox width grows >1.5× rest
  (rings separate) with zero datum crossings; console error-free.
  Highest-risk
  step (harness drops localStorage/mousemove — seed via
  `evaluateOnNewDocument`, synthesize `pointermove`, as proven in
  the phase34 smoke test).
- Manual check: rest pixel-identity, fade legibility, HUD unchanged.

## Risks / Open Questions

- Risk: overlay + faded ink could read as cluttered on dense sheets.
  Mitigation: rest-coincidence (zero change at rest), fade keeps one
  visual hierarchy; E2E + manual check gate it.
- Risk: fan triangulation on concave ngons. Mitigation: reconstruct
  emits convex faces for solid classes; wireframes have no faces;
  documented limitation + unit test pinning the behavior.
- Open question 1 (UX preference, reversible default = ship
  faded-ink + overlay): should the riding ink fade under the overlay,
  or stay full ink with the overlay distinguished another way
  (accent color)? Default stands unless vetoed.
- Open question 2: none technical — all design inputs verified
  in-tree (`sims.posed`, faces adjacency, BIS dashed styles,
  bridge pattern). No external dependencies.

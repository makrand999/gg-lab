# 2D → 3D line-drawing reconstruction: research and design

Research snapshot: **2026-11-11**. Scope: Major's primitive reconstruction
pipeline. This is a design report, not a change to production code. It reads
the current implementation, the `.edu` corpus, and the classical and
engineering-drawing literature. References are numbered at the end.

The short version:

- Our pipeline is stronger than classical line-drawing interpretation on
  **authored, dimensioned, vector primitives**, and weaker on **geometric
  correspondence, global face/volume completion, hidden-line consistency, and
  missing views**.
- The classical results that matter most are Sugihara's algebraic
  realizability test, Wesley–Markowsky's "all solids" fleshing-out formulation,
  and the engineering-drawing B-rep/volume lineages. None of them gives a
  unique solid from three silhouettes, and none removes the need for explicit
  assumptions.
- The highest-leverage next step is a **read-only correspondence audit**: make
  the candidate graph, cycle consistency, and alternatives visible before
  changing geometry. Face/volume selection, visibility constraints, and
  set-valued missing-view handling follow.

## 1. Our current reconstruction strategy and assumptions

### 1.1 Entry point and stages

`EduCADReconstruct.reconstruct(entities, options)` is the public pipeline
(`public/lib/educad-reconstruct.js`). Its documented stages are:

1. collect primitive observations and explicit member constraints;
2. resolve cross-view correspondence;
3. lift vertices, edges, and supported analytic curves to 3D;
4. infer planar regions and supported ruled/analytic surface patches;
5. return geometry plus specific diagnostics for unresolved observations.

The implementation has three practical paths:

- **Explicit topology** (`options.topology` or
  `meta.reconstructionTopology`) goes to the exact strict kernel
  (`educad-strict.js`) and its declared-triangle certificate.
- **Straight drawings** use either `reconstructStrict` (explicit member IDs, or
  a named profile bridge) or the legacy live builder (`liveCore`).
- **Curved drawings** use `educad-curve-reconstruct.js` and, for general
  ellipse projections, `educad-oblique-kernel.js`; independent straight
  components are reconstructed separately and merged.

The design already follows the repository's stated direction: primitives and
views are the input; solid names are not. Feature names such as "cylinder" or
"recess" are not read from the drawing; they are consequences of inferred
surface records.

### 1.2 Correspondence: what actually decides a match

The current correspondence rules are deliberately conservative but are tied to
authored drawing conventions:

- **View roles.** `PLAN`, `ELEVATION`, and `PROFILE` win when present. Untagged
  entities fall back to the sheet half (`y > 0` elevation, `y < 0` plan). A
  profile side frame is `side(d) = xRef + s * (d - dRef)`; an explicit frame
  always wins, and an inferred frame is marked `profileInferred`.
- **Station x.** The legacy live builder requires plan and elevation `x` to
  agree within `MATCH_EPS_MM = 0.5`. The explicit strict adapter uses the
  stored decimal coordinates as exact equations, while the automatic
  compatibility adapter compares projection equations at `AUTO_EPS = 1e-6`.
  A profile observation agrees with plan on depth through the side frame and
  with elevation on height.
- **Names.** Point captions are split into base names (prime ticks stripped;
  parenthesized hidden verdicts ignored). Plan `a` and elevation `a'` share
  base `a`. Segment captions do not name vertices.
- **Explicit member IDs.** A shared `meta.members[].id` is an authoritative
  identity. The strict adapter never rewrites declared members; duplicate IDs
  and contradictory coordinates are rejected.
- **Auto members.** For table-created points, `autoMembersForStrict` assigns
  synthetic IDs. It links a plan/elevation pair only when each side is the
  other's unique compatible candidate. A profile station joins only when it is
  the single profile candidate for the group and the group is its single
  candidate. Contradictory or ambiguous candidates stay separate.
- **Projector ink.** The legacy live builder can require a drawn
  sheet-vertical projector covering both dots. The compatibility adapter can
  also link by base name plus agreeing projection equations; the explicit
  strict adapter uses shared member IDs and does not need projector ink.
  Projector lines are evidence, not a substitute for identity.
- **Averaging.** The strict/explicit path never averages, snaps, or rewrites
  coordinates; a conflict stays a conflict. The legacy live builder does
  average the two `x` values after its station-equality check
  (`(plan.x + elev.x) / 2`); that is a legacy convenience, not a tolerance-based
  snap, and it is one reason the strict contract is the better long-term
  foundation.

Assessment: this matcher **buys** exact authored identity, deterministic
behavior, and no combinatorial correspondence search. It **costs** generality:
unlabeled vertices, repeated names, dense stations, and drawings whose views
are not aligned by a declarative frame are outside its competence. It also has
no three-view cycle check; two pairwise unique matches can still disagree on
the third view. The candidate graph in §6.2 is the generalization that keeps
the strict identity contract while adding geometric evidence and alternatives.

This is a **name-and-station matcher**, not a general geometric correspondence
solver. It works well for teaching drawings where stations are named and
aligned. It does not solve the general case of unlabeled vertices, repeated
names, or a dense drawing where many vertices share an x station.

### 1.3 Lifting and surface inference

- Straight geometry is lifted as `(x, h, d)` from plan/elevation/profile
  observations. Exact arithmetic is used only in the strict declared path;
  inferred geometry is floating-point with explicit tolerances.
- Circles and arcs are lifted when seen in true shape in one principal view and
  edge-on in another. The curve stage checks projected extents, combines
  split/overlapping edge-on strokes, and can use linked centre observations.
- General-plane circles are handled by fitting projected ellipses in two views
  and intersecting the candidate plane normals. A closed ellipse can pair with
  an edge-on run; a slanted trace produces an analytic ellipse and a truncated
  cylinder.
- Higher-level surface records are inferred from curve evidence: coaxial ruled
  patches, spheres, spherical recesses, cylindrical recesses, cones over
  inclined circles, and cylindrical fillets. Each is a bounded analytic
  `plane`/`cylinder`/`cone`/`sphere` record with ordered loops.
- The bounded model is built by `Surfaces.build`, validated by
  `Surfaces.validate`, and certified by `Surfaces.certify`
  (`analytic-surface-certificate-v1`). This certifies consistency of the
  analytic model, not that the inferred model is the intended object.

### 1.4 Face and volume inference

There are two face paths:

- `extractPlanarFaces` groups lifted edges by supporting plane, projects each
  plane to 2D, traces the maximal outer boundary of each connected planar
  component, evaluates containment to assign holes, and then selects a
  manifold subset with `selectManifoldFaces`.
- `inferClosedFaces` is the older closed-wire path: enumerate simple planar
  cycles, greedily tile the shell, require every edge in exactly two faces and
  Euler `V - E + F = 2`, with hard limits (`64` vertices, `96` edges, cycle
  length `10`, `3000` cycles, `150000` steps).

`selectManifoldFaces` is already a small constraint solver: it prefers closed
shells, enforces edge use at most twice and a valid vertex link, and reports
`ambiguous-surface` or `search-limit` instead of guessing. It does not yet
enforce per-view stroke coverage, hidden/visible consistency, or a global
volume objective.

The exact strict kernel's certificate applies only to **declared** vertices,
edges, and triangles. Inferred display faces get `inferred-triangle-v1`, which
may be `partial` or skipped. The analytic certificate is separate. This
three-certificate separation is correct and should be preserved.

### 1.5 Partial results and diagnostics

`reconstruct` returns `determination: 'inferred' | 'partial'` in the automatic
path, and the strict path adds `determined | underdetermined | inconsistent |
unsupported`. Diagnostics are a flat list of `{code, entityId, message}`. The
main families are:

- missing evidence: `missing-view`, `point-correspondence-missing`,
  `curve-projection-missing`, `recess-depth-missing`;
- ambiguity: `ambiguous-pairing`, `curve-projection-ambiguous`,
  `curve-correspondence-ambiguous`, `oblique-curve-ambiguous`,
  `recess-depth-ambiguous`, `cone-apex-ambiguous`;
- conflict: `x-mismatch`, `hint-conflict`, `curve-projection-conflict`,
  `oblique-point-conflict`, `cone-apex-conflict`, `oblique-visibility-conflict`;
- unsupported: `unsupported-curves`, `curve-view-unsupported`,
  `curve-inclined-arc-unsupported`, `unbounded-edge-unsupported`;
- limits: `coverage-failed`, `search-limit`, `invalid-surface`.

This list is informative but not classified. A consumer cannot reliably tell
"the drawing is insufficient" from "there are two valid solids" from "this
feature is not implemented". The recommended taxonomy is in §6.6.

### 1.6 Assumptions we currently make

| Assumption | Where it appears | Consequence if false |
|---|---|---|
| First-angle principal orthographic views, axis-aligned | view roles, profile frame | wrong lifting or view classification |
| Drawing is already vectorized and semantic | `filterEntities`, `KEEP_TYPES` | raster/scanned drawings are not accepted |
| Coordinates are in millimetres at sheet scale | tolerances `MATCH_EPS_MM`, `LOOSE_EPS_MM` | scale-free reconstructions need a calibration step |
| Station names or shared member IDs identify vertices | `baseNameOf`, `parseMembers`, `autoMembersForStrict` | unlabeled drawings lose correspondence |
| Plan/elevation share `x`; profile uses a declared frame | `autoMembersForStrict`, `resolveProfileFrame` | a missing/wrong frame leaves profile ink unused |
| Curves are circles/arcs or projected ellipses of analytic surfaces | `educad-curve-reconstruct.js`, `educad-oblique-kernel.js` | free-form or general quadric surfaces are unsupported |
| Inferred surfaces are not unique | diagnostics and certificates | a displayed solid can be one of several valid completions |
| Hidden lines are optional and only locally used | `bisCode`, `pointHidden`, curve mirror selection | global face selection can violate visibility |
| Missing views are not synthesized | strict underdetermined, automatic partial | no "complete the third view" capability |

### 1.7 What is guaranteed now

- Given **explicit** identities and topology, the strict kernel gives a unique
  declared wireframe/embedded triangulation, with exact rational checks and a
  closed-solid certificate. This is a proof relative to declarations, not a
  proof that the declarations describe the intended object.
- Given inferred primitives, the pipeline returns **one consistent
  interpretation** with diagnostics, not a proof of uniqueness. Curves and
  surfaces are analytic records plus display tessellation; the analytic
  certificate checks consistency, not intent.
- If the same drawing admits several equally supported interpretations, the
  code sometimes reports ambiguity (e.g. `ambiguous-pairing`,
  `curve-projection-ambiguous`, `ambiguous-surface`) and sometimes keeps one
  interpretation with a partial status. There is no general "all alternatives"
  object today.

## 2. Classical line-drawing algorithms: guarantees and limits

### 2.1 Huffman–Clowes labeling (and Waltz filtering)

Huffman [S1] and Clowes [S2] label each line as convex, concave, or occluding
at a junction, using a junction dictionary. Waltz [S3] adds shadows and
occlusion labels and propagates constraints.

What it guarantees:

- A locally consistent labeling is a **necessary** condition for a polyhedral
  interpretation under the assumed junction vocabulary.
- It prunes impossible interpretations very cheaply and is a useful front-end.

What it cannot guarantee:

- Labeling does not produce 3D coordinates, faces, or a volume.
- It is not sufficient: Sugihara explicitly notes that labeling conditions are
  necessary but not sufficient [S6, §1.3].
- It assumes a restricted junction vocabulary (often trihedral vertices,
  generic viewpoint, no tangential edges). Curved objects need a richer label
  set [S14][S11].

For EduCAD, labeling is a good **candidate filter** for straight-line
junctions, not a reconstruction algorithm.

### 2.2 Sugihara: algebraic realizability

Sugihara's central result is a **necessary and sufficient** condition for a
line drawing to represent a polyhedral scene, expressed as a system of linear
equations and inequalities; checking it reduces to linear programming
[S5][S6, ch. 3–4]. The book also treats hidden-part-drawn pictures, degrees of
freedom, and generic reconstructibility.

What it guarantees:

- For a drawing with a given incidence structure (which vertices/edges/faces
  are intended), it can decide whether **some** polyhedron realizes that
  incidence under the projection, and it can recover the family of scenes.
- It can detect incorrect drawings and, with the generic-reconstructibility
  machinery, correct small vertex-position errors ("superstrictness") [S6,
  ch. 6–7].
- It makes the degrees of freedom explicit: a line drawing usually admits
  infinitely many scenes; uniqueness needs additional information (lengths,
  angles, texture, or another view) [S6, ch. 9–10].

What it cannot guarantee:

- It does not choose the intended face structure or correspondence; the
  incidence structure is an input.
- It is a polyhedral result. Curved objects are not covered by the same
  theorem; Cooper's linear-constraint work extends parts of the idea to
  labeled curved objects [S11][S12].
- It is sensitive to degeneracy and numerical error; the "superstrict"
  behavior is precisely why a naive exact test rejects freehand drawings.
- It does not solve missing views or incomplete drawings by itself.

For EduCAD, Sugihara is the right **validation model** for a future polyhedral
face/volume solver: after candidate faces are chosen, a rank/feasibility check
can reject impossible incidence. It is not a replacement for our authored
member-ID contract.

### 2.3 Marill: MSDA optimization

Marill [S7] interprets a single line drawing by adjusting 3D vertex positions
to minimize the standard deviation of angles (MSDA), with a preference for
"p-images" (drawings that look like projections of a 3D object).

What it guarantees:

- It produces a plausible 3D wireframe for a broad class of single-view line
  drawings, without a model library.

What it cannot guarantee:

- There is no correctness or uniqueness theorem; the result is the minimum of a
  regularity prior, not a certified scene.
- MSDA is not invariant under arbitrary affine viewing changes and can have
  local minima; the objective encodes a "general position" bias.
- It produces a wireframe, not faces or a solid, and it does not use
  engineering dimensions or multiple views.

### 2.4 Leclerc–Fischler: optimization with face regularities

Leclerc and Fischler [S8] extend Marill's angle-regularity objective with
face-planarity (and related) terms and solve the resulting optimization
numerically. This is a stronger prior for polyhedra than MSDA alone.

What it guarantees:

- A numerically optimal 3D wireframe under a documented objective, often a good
  fit to human interpretation.

What it cannot guarantee:

- No combinatorial realizability or uniqueness guarantee; the optimizer can
  converge to a wrong local minimum.
- It assumes a single view and no hidden lines; it does not use the
  orthographic multi-view constraints or dimensions that engineering drawings
  provide.
- Faces are implied by the objective, not certified as a manifold or volume.

### 2.5 Grimstead–Martin: single-sketch solid modeling

Grimstead and Martin [S9][S10] reconstruct a B-rep solid from a single
hidden-line-removed polyhedral sketch. The pipeline is line labeling, region
and face recognition, face-plane alignment, and vertex adjustment, followed by
solid construction.

What it guarantees:

- A usable B-rep for a valid, hidden-line-removed polyhedral sketch, with
  interactive correction when the sketch is inconsistent.

What it cannot guarantee:

- It assumes a single view, polyhedral geometry, no hidden lines, and a valid
  labeling. It does not handle orthographic multi-view correspondence or
  curved surfaces.
- It cannot recover geometry that is genuinely underdetermined from one view;
  user edits or additional constraints are part of the workflow.

### 2.6 Cooper: linear constraints for curved objects

Cooper's work [S11][S12][S13] formulates labeled line drawings of curved
objects as systems of linear constraints, solvable by linear programming, and
studies physical realizability and uniqueness for restricted classes (for
example, simple polyhedra under suitable labels and generic viewpoints).

What it guarantees:

- Realizability tests and, in restricted classes, unambiguous reconstruction
  from labels plus constraints.
- A principled way to use tangency, curvature, and occlusion labels for curved
  surfaces.

What it cannot guarantee:

- General engineering drawings with dimensions, sections, missing views, and
  arbitrary curved surfaces are outside the restricted theorems.
- The labels and incidence structure are inputs; the method does not discover
  them from raw strokes.
- It is a research-level constraint system, not a turnkey reconstruction
  pipeline.

### 2.7 What none of them guarantees

No classical method guarantees the intended solid from three orthographic
silhouettes alone. They guarantee, at best:

- a necessary labeling;
- realizability of a **given** incidence structure;
- a locally optimal wireframe under a prior;
- all solids consistent with a **complete** polyhedral drawing and a stated
  hidden-line convention;
- uniqueness only inside a restricted class with extra labels/constraints.

That is exactly the distinction the repository's `AGENTS.md` asks us to keep:
mathematical ambiguity, insufficient input, and unimplemented features are
different things.

## 3. Face/volume reconstruction and hidden-line consistency

### 3.1 The B-rep lineage

The engineering-drawing B-rep tradition generates candidate 3D vertices from
pairs of views, connects them into 3D edges, builds face loops, and validates a
solid:

- Wesley and Markowsky [S15] find **all** polyhedral solids consistent with a
  set of 2D projections. Their abstract explicitly covers dashed/solid depth
  information, sections, and detail views; labeling reduces the difficulty, but
  even with no labeling the algorithm enumerates all solutions, and some
  drawings have very many.
- Markowsky and Wesley [S16] first solve the wireframe problem: all polyhedral
  objects with a given wireframe.
- Sakurai and Gossard [S17] create solid models from orthographic projections;
  Preiss [S18], Chen–Perng [S19], Yan–Chen–Tang [S20], and Shin–Shin [S21]
  continue the candidate-vertex/edge/face lineage with performance and
  robustness improvements.
- Shpitalni and Lipson [S29] address face identification in a 2D wireframe
  projection; Varley et al. [S30] construct B-rep models from a single sketch.

The recurring assumptions are: complete views, polyhedral (or limited quadric)
geometry, clean line drawings, and a convention for hidden lines. The recurring
failure modes are: exponential candidate explosion, invalid faces from
accidental alignment, and no principled answer when views are incomplete.

### 3.2 Volume/CSG approaches

A second lineage constructs volumes by extruding/sweeping view regions and
combining them with Boolean operations:

- Shum et al. [S22] use two-stage extrusion, modifying incremental extrusion,
  and report handling of incomplete views/projections and cross-sections.
- Soni and Gurumoorthy [S24] add solids of revolution to a volume-based
  construction.
- Dimri and Gurumoorthy [S25] handle sectional views; the 2026 survey [S28]
  notes that this line often requires manual specification of section types.

Volume/CSG is robust for 2.5D and swept parts and naturally produces a solid.
It is weaker for non-monotone shapes, intersecting features, and general curved
surfaces; it also depends on clean region segmentation, which is exactly where
scanned drawings are difficult.

### 3.3 Curved solids from engineering drawings

Liu et al. [S23] reconstruct solids with planar, quadric, and toroidal surfaces
from three-view engineering drawings. The method uses view correspondence of
silhouettes and analytic surface fitting. It is the closest classical analogue
to our curve/surface stage, but it assumes complete three-view drawings and a
supported surface vocabulary.

Our analytic model is narrower in surface families (no general torus yet) but
stronger in explicit boundary loops, shared-boundary incidence, and
certificates.

### 3.4 Missing views

Srinivas and Dutta [S26] present an algorithm for generating a missing view
from two orthogonal views of a polyhedral solid. The 2026 survey [S28] still
lists incomplete/ambiguous drawings and missing views as an open challenge:
most methods assume complete, unambiguous input.

The important structural fact for us:

> Two independent orthographic views already fix all three coordinates of a
> corresponded vertex. A third view does not add coordinate information to that
> vertex; it adds **correspondence, face/edge existence, and visibility**
> constraints.

Therefore a missing view is usually **not uniquely determined** by two views.
For a given reconstructed solid it is unique (it is just a projection), but if
the solid is ambiguous, the missing view inherits the ambiguity. A correct
system should return a set of possible completions or a consensus/possible
stroke classification, not a single guessed view.

### 3.5 Hidden-line consistency

Hidden lines carry real information:

- Wesley–Markowsky's projections explicitly use dashed and solid lines as depth
  information [S15].
- Sugihara devotes a chapter to the correctness of hidden-part-drawn pictures
  [S6, ch. 4]; hidden lines change which interpretations are realizable.
- Liu, Chen, and Tang [S31] decompose complex line drawings **with hidden
  lines** for planar-faced manifold reconstruction.
- Without hidden lines, the back of an object is generally ambiguous; methods
  either add symmetry/regularity priors or ask for more input.

For EduCAD, visibility currently appears in two places: the curve stage uses
visible/hidden strokes to choose a remaining mirror in some oblique cases, and
`projectGeometry` returns interval visibility for display. It is not yet a
global constraint on inferred faces. That is the gap.

Two cautions:

1. **Do not require hidden lines to be complete.** Many engineering drawings
   omit hidden lines by convention. Treat visibility as a hard constraint only
   when the drawing declares `hiddenLines: 'complete'`; otherwise use it as a
   soft score and report what was assumed.
2. **Avoid circular inference.** Do not use a surface inferred from a curve to
   decide the curve's own depth unless the occluder is independent. The
   existing code already avoids this in the oblique visibility path; preserve
   that discipline.

### 3.6 What to borrow

- Candidate-set semantics from Wesley–Markowsky: find all solutions inside the
  candidate space, then rank; do not silently choose.
- Manifold/orientation/volume validation from our strict kernel and
  `selectManifoldFaces`; this is stronger than most classical implementations.
- Face selection under edge-use, vertex-link, coverage, and visibility
  constraints; this is the missing global layer.
- Sugihara-style feasibility as a post-check for polyhedral candidates, not as
  the primary matcher.
- Set-valued missing-view prediction, not hallucination.

## 4. Vectorization and drawing-primitive extraction

### 4.1 Why this is a separate stage

Our input is already vector entities (`POINT`, `SEGMENT`, `CIRCLE`,
`CIRCULAR_ARC`, `CURVE`). A scanned drawing needs a front-end that produces
those entities, with provenance and confidence. That front-end must not be
mixed into the geometric solver: a vectorization error should be reported as a
vectorization error, not as a geometric contradiction.

### 4.2 A defensible pipeline

1. **Acquire and normalize.** Deskew, crop views, estimate DPI, convert to
   grayscale.
2. **Binarize.** Adaptive/Sauvola thresholding for uneven scans; remove
   speckles.
3. **Separate semantics.** Detect and remove/mask text, dimension lines,
   arrowheads, hatching, title blocks, and centerlines. Keep them as annotations
   with source regions; do not feed them into geometry.
4. **Extract centrelines.** Thin the ink (Zhang–Suen) or use a line/edge
   detector. This is essential: engineering drawings are strokes, not filled
   regions.
5. **Fit primitives.** Line segments (Hough/LSD/EDLines), circles and ellipses
   (EDCircles or algebraic/RANSAC fitting), arcs (split at corners and fit),
   and free-form curves only when needed.
6. **Snap and chain.** Merge collinear dashes, close small gaps, snap endpoints
   at junctions, and build a planar graph per view. Preserve original pixel
   evidence and confidence.
7. **Classify line style.** Solid vs dashed vs chain-dotted vs construction;
   infer hidden/visible where the convention is clear. Do not guess when it is
   not.
8. **Segment views and calibrate.** Use layout/projection alignment to assign
   PLAN/ELEVATION/PROFILE; obtain millimetres from a dimension, a known scale,
   or an explicit calibration. Without calibration, reconstruction is
   scale-free.
9. **Emit EduCAD entities.** Attach `meta.vectorization` with source IDs,
   confidence, and any unclassified ink. Then run the normal pipeline.

### 4.3 Algorithms and tools

| Tool / algorithm | What it does | License | Fit |
|---|---|---|---|
| OpenCV 4.5+ `findContours` [S36] | border following; region/contour extraction | Apache-2.0 [S45] | useful for silhouettes/regions, not centrelines |
| OpenCV `approxPolyDP` [S37] | Douglas–Peucker polyline simplification | Apache-2.0 | good post-step |
| OpenCV `HoughLinesP` [S39] | progressive probabilistic Hough segments | Apache-2.0 | robust but parameter-sensitive |
| LSD [S40] | subpixel line segment detector | research/OpenCV ecosystem | good line evidence; check module license before vendoring |
| ED_Lib / EDLines / EDCircles [S41][S42] | edge-drawing line/circle/ellipse detection | MIT [S46] | best permissive primitive detector; C++/OpenCV dependency |
| Zhang–Suen thinning [S38] | skeletonization | algorithm; implement in-house | centrelines for strokes |
| Potrace 1.16 [S43][S48] | optimal polygon/Bezier tracing of bitmap regions | GPL-2.0-or-later; commercial dual license | **not** a centreline tracer; avoid in distributed app |
| Autotrace [S49] | outline **and centreline** tracing | program GPL-2.0+; library LGPL-2.1+ | centreline useful, but copyleft/GLib; avoid by default |
| VTracer [S47] | region/colour tracing to SVG | MIT | good for scans/regions; outputs outlines, not centrelines |
| scikit-image | thinning, morphology, measure | BSD-3-Clause [S54] | offline research/prototyping only |
| Hilaire–Tombre [S35] | robust skeleton-based line-drawing vectorization | research; no known permissive OSS | algorithm reference |

### 4.4 Why Potrace and VTracer are not enough

Potrace and VTracer are **region tracers**. A thin black line in a binary image
is a narrow region; tracing its boundary produces two outlines (one on each
side), not one centreline. That is the wrong primitive for engineering
geometry. They are useful for filled symbols, hatching regions, or cleanup, but
not as the primary line extractor. A centreline path via thinning or ED/LSD is
the right default.

### 4.5 Engineering-drawing semantics

- **Dashed lines** are usually hidden edges, but dash patterns also appear in
  centre lines, phantom lines, and break lines. Classify by pattern and layer,
  not by "any gap".
- **Dimension/leader text** must be removed or parsed separately. OCR is
  optional; simple connected-component filtering plus known arrow/leader
  shapes handles many sheets.
- **Scale** is not implicit in a raster. Require a dimension, a scale bar, or
  an explicit calibration. Otherwise report `scale-missing` and reconstruct a
  similarity class.
- **Line width and anti-aliasing** create parallel edges; thinning or
  subpixel line fitting avoids double-counting.
- **Junctions** are often rounded or broken; snapping must be evidence-based
  and must report when it merged two distinct strokes.

### 4.6 Integration shape

Given the zero-dependency constraint, do not add OpenCV.js or a native ED_Lib
build to the core application without a separate decision. The least risky
shape is:

- an **offline/optional** `tools/vectorize.*` front-end that emits `.edu` or a
  JSON primitive file;
- the core app remains pure JavaScript and accepts only vector primitives;
- vectorization metadata is preserved, but the geometry solver has no raster
  dependency.

## 5. Comparison matrix for EduCAD

Legend: **Strong** = directly usable; **Partial** = usable with adaptation;
**Weak** = research/reference only; **No** = incompatible or absent.

| Approach | Correspondence | Geometry / surfaces | Ambiguity | Missing views | Hidden lines | Fit for EduCAD |
|---|---|---|---|---|---|---|
| **EduCAD today** | names + station x + explicit IDs; unique mutual match | analytic circles/arcs/ellipses; plane/cylinder/cone/sphere patches; bounded loops | per-feature diagnostics; one interpretation kept | not synthesized; partial/underdetermined | local curve mirror + display intervals | Strong on authored primitives; weak global completion |
| Huffman–Clowes–Waltz [S1–S3] | none (junction labels only) | no 3D geometry | prunes labelings; no alternatives | no | occlusion labels | Partial: cheap junction filter |
| Sugihara [S4–S6] | incidence supplied | polyhedral scenes; LP feasibility | family of scenes; generic correction | no | hidden-part-drawn chapter | Partial: future realizability check |
| Marill [S7] | none | 3D wireframe by MSDA | local minima; no uniqueness | no | no | Weak: prior only |
| Leclerc–Fischler [S8] | none | 3D wireframe + face planarity | local minima; no guarantee | no | no | Weak: prior only |
| Grimstead–Martin [S9][S10] | single sketch | B-rep polyhedra | user correction | no | assumes hidden lines removed | Weak for multi-view; useful face pipeline |
| Cooper [S11–S13] | labels supplied | curved-object linear constraints | uniqueness in restricted classes | no | labels | Partial: research reference |
| Wesley–Markowsky [S15][S16] | projection alignment | all polyhedral solids | enumerates all solutions | no | dashed/solid depth | Strong conceptual fit; exponential |
| B-rep engineering [S17–S21][S29][S30] | candidate vertices | polyhedral/limited curved B-rep | multiple candidates; validity checks | no | often used | Partial: face/volume ideas |
| Volume/CSG [S22][S24][S25] | view regions | swept/extruded volumes | Boolean ambiguity | reported incomplete-view handling [S22] | sections | Partial: 2.5D parts |
| Liu curved [S23] | silhouette correspondence | planar/quadric/toroidal | limited | no | not specified in abstract | Partial: curve/surface reference |
| PlankAssembly [S50] | learned | shape programs → meshes | probabilistic | no | no | No for core (AGPL; learned) |
| OpenCV/ED_Lib/VTracer [S45–S47] | none | vector primitives | n/a | n/a | style classification needed | Strong front-end, not reconstruction |
| Our target design | candidate graph + cycle consistency | bounded surface complex + global face solver | explicit alternatives + classes | set-valued completion/filter | first-class constraint | Best fit |

### 5.1 Mapping the comparison onto the bounded surface complex

Classical reconstruction talks about vertices, edges, faces, shells, and
hidden lines. Our implementation already has a richer vocabulary:

| Classical object | EduCAD record | Consequence for a solver |
|---|---|---|
| vertex | member / observation group | correspondence is an explicit constraint, not an accidental coordinate match |
| edge | spatial edge or analytic curve | a curve is one boundary element, not a tessellated polyline |
| face | bounded `plane`/`cylinder`/`cone`/`sphere` patch | a curved face is one candidate, not many display triangles |
| shell | closed surface component | `Surfaces.validate`/`certify` already count closure |
| boundary use | `Surfaces.incidence` | use counts are shared across curves, lines, sections, and mesh edges |
| hidden line | A/E stroke + `visibilityEvidence` | visibility can be checked without a second geometric model |

This matters because most classical algorithms assume a polygonal edge/face
graph. Our bounded complex can represent a cylinder patch bounded by two arcs
and two shared straight generators as **one** face candidate. A future face
solver should consume `Surfaces.incidence` (or the same boundary IDs) rather
than re-counting display mesh edges; otherwise a shared analytic curve would
look like several unrelated segments. The solver chooses among candidate
surfaces and reports alternatives; it must not silently promote tessellation to
an analytic surface, and it must keep the analytic certificate separate from
the inferred-triangle certificate.

## 6. Recommended next algorithms

### 6.1 Ranked by leverage

1. **Correspondence candidate graph with cycle consistency** — highest
   leverage, pure JavaScript, no new dependency, directly addresses the
   weakest assumption.
2. **Global face/volume selection with alternatives** — the missing layer
   between our good local surface inference and a solid; reuse the existing
   manifold validator and analytic model.
3. **Visibility constraints with a hidden-line completeness declaration** —
   makes face selection use the information already present in A/E strokes.
4. **Set-valued missing-view completion/filter** — turns an impossible
   "guess the third view" request into a truthful candidate set.
5. **Vectorization front-end (optional)** — necessary for scanned drawings, but
   independent of the core solver and a large dependency decision.
6. **General curved-surface hypothesis engine** — later; our analytic families
   cover the product scope better than a premature Cooper-style system.

### 6.2 Correspondence candidate graph

**Goal.** Replace "name + x + unique mutual match" with a general candidate
system that still treats explicit member IDs as hard constraints.

**Observations.** Each entity yields one or more observations:

```js
{ id, view, u, v, memberIds, kind, style, curveId }
```

**Candidate generation.** For each view pair, an edge exists when the shared
coordinate agrees within tolerance:

```text
PLAN–ELEVATION:  |x_p - x_e| <= eps_x
PLAN–PROFILE:    |d_p - (dRef + s*(x_s - xRef))| <= eps_d
ELEVATION–PROFILE: |h_e - h_s| <= eps_h
```

If both observations have explicit member IDs, intersection is a hard match
and a non-empty disjoint set is a hard conflict. Otherwise the edge receives
evidence:

```text
score = w_id   * sharedMemberId
      + w_name * sameBaseName
      + w_proj * projectorInkCoverage
      + w_deg  * junctionDegreeAgreement
      + w_curve* curveRoleAgreement
      - w_res  * coordinateResidual / eps
```

**Global consistency.** Pairwise maximum-weight matching is not enough; three
views can form a cycle whose three pairwise matches are inconsistent. For every
PLAN–ELEVATION–PROFILE triangle, check that the three implied coordinates agree.
Reject or repair inconsistent cycles. Exact 3-partite matching is NP-hard in
general, so bound the candidate count and use branch-and-bound; report
`correspondence-search-limit` rather than guessing.

**Status.**

- `unique`: exactly one maximum-score consistent assignment.
- `ambiguous`: several distinct assignments with equal or near-equal support;
  return `alternatives`.
- `conflict`: explicit IDs or coordinates contradict.
- `insufficient`: one or more observations have no candidate.

**Important.** Do not average coordinates. A group gets one coordinate per axis
only when all observations agree; otherwise it is a conflict or an alternative.

### 6.3 Global face/volume selection

**Candidate faces.** Start from the existing planar-region extraction and
analytic patch loops. Include holes and open boundaries. Each candidate face
records its boundary elements and source evidence.

**Selection constraints.** For a candidate set `F` and 3D edge set `E`:

```text
for each edge e: use(e) in {0, 2}          (closed shell)
                 or use(e) in {0, 1}       (open surface)
use(e) <= 2                                (non-manifold rejected)
vertex link is one cycle (closed) or path (open)
face orientations are consistent
signed volume > 0 for closed components
each source stroke interval is covered by the projection of selected
  edges/curves, unless it is explicitly marked as omitted/hidden
visibility predictions agree with A/E labels where the drawing declares
  hidden lines complete
```

**Objective.**

```text
cost(S) = w_ink  * unexplained_ink(S)
        + w_face * |S.faces|
        + w_plan * planarity_residual(S)
        + w_vis  * visibility_violations(S)
        + w_curve* curvature_residual(S)
```

Prefer closed shells, then fewer unexplained strokes, then simpler face sets.
Return the best `k` distinct solutions, not just one.

**Why this is better than a minimal cycle basis.** A cycle basis can contain
non-planar or non-face cycles and misses holes/nesting. Our plane grouping plus
constrained selection is closer to the engineering-drawing "fleshing out"
formulation and can use coverage/visibility evidence.

**Limits.** This is exponential in the worst case. Keep the existing hard caps,
add a candidate budget, and emit `surface-search-limit` with the wire retained.
Never let a timeout silently become a solid.

### 6.4 Visibility consistency

Add a per-observation visibility field:

```js
{ bisCode: 'A' | 'E' | null, hiddenLines: 'complete' | 'omitted' | 'unknown' }
```

Use it in three ways:

1. **Hard filter** when `hiddenLines === 'complete'`: reject a candidate solid
   whose projection makes a dashed edge visible or a solid edge hidden.
2. **Soft score** when hidden lines are omitted/unknown: prefer solutions that
   do not contradict the visible strokes, but do not reject a face solely
   because its hidden boundary was not drawn.
3. **Ambiguity evidence**: if two candidates differ only in the depth of an
   edge that is hidden in one and visible in the other, the stroke label is the
   distinguishing evidence; report it in `visibilityEvidence`.

For exact polyhedra, use analytic interval visibility. For curved surfaces,
sample and mark the result as sampled evidence, as the current oblique path
already does.

### 6.5 Missing-view handling

**Do not synthesize a unique missing view.** Implement set-valued completion:

```text
solutions = face/volume solver output
for each solution: project all edges/curves into the missing view
certain   = strokes/segments common to every solution
possible  = union of all projected strokes
disputed  = possible - certain
```

If the user supplies partial missing-view ink:

- keep solutions whose projection covers the ink;
- `missing-view-selected` if one remains;
- `missing-view-ambiguous` if several remain;
- `missing-view-conflict` if none remains.

If no partial ink exists:

- return `missing-view-underdetermined` with `viewCompletion.certain`,
  `viewCompletion.possible`, and a bounded set of `alternatives`;
- do not display one alternative as "the" missing view.

If the user explicitly declares an assumption (`extrusion`, `revolution`,
`symmetry`, `uniform-thickness`), apply it and mark
`assumption: 'declared'`. An assumption is not an inference.

### 6.6 Ambiguity classification

Keep existing diagnostic codes, add a stable class:

| Class | Meaning | Existing examples | Behavior |
|---|---|---|---|
| `insufficient-input` | More evidence is needed; no valid completion is known | `missing-view`, `point-correspondence-missing`, `curve-projection-missing`, `recess-depth-missing` | retain partial wire; ask for the missing observation |
| `ambiguous-geometry` | Two or more valid completions survive | `ambiguous-pairing`, `curve-projection-ambiguous`, `curve-correspondence-ambiguous`, `oblique-curve-ambiguous`, `recess-depth-ambiguous`, `cone-apex-ambiguous`, `ambiguous-surface` | return alternatives with distinguishing evidence |
| `inconsistent-evidence` | The observations contradict | `x-mismatch`, `hint-conflict`, `curve-projection-conflict`, `oblique-point-conflict`, `cone-apex-conflict`, `oblique-visibility-conflict` | reject the affected group; no guess |
| `unsupported-feature` | The geometry is outside the implemented families | `unsupported-curves`, `curve-view-unsupported`, `curve-inclined-arc-unsupported`, `unbounded-edge-unsupported` | retain supported geometry; name the missing family |
| `numerical-or-limit` | The solver could not decide within its limits | `coverage-failed`, `search-limit`, `invalid-surface` | retain wire; explain the limit |

This is the classification the product needs to distinguish mathematical
ambiguity from insufficient input from an unimplemented feature.

### 6.7 Vectorization front-end (later)

If pursued, keep it optional and offline. Recommended permissive stack:
OpenCV 4.x (Apache-2.0) for thresholding, contours, Hough, and morphology;
ED_Lib (MIT) for EDLines/EDCircles; in-house thinning or OpenCV `ximgproc`
thinning for centrelines; optional VTracer (MIT) only for region cleanup. Avoid
Potrace/Autotrace in the distributed app unless the licensing decision is
explicitly made.

### 6.8 Curved-surface generalization (later)

Do not jump to a general Cooper-style curved-object solver. Instead:

- keep analytic families and their bounded loops;
- add a candidate-surface hypothesis record with residual and source evidence;
- add torus and general quadric fitting only when a `.edu` corpus case demands
  it;
- use silhouette/tangency consistency as evidence, not as a named-solid
  recognizer.

## 7. Pseudocode/API sketch and `.edu` test plan

### 7.1 New module: correspondence audit

```js
// public/lib/educad-correspondence.js (proposed, pure JS, UMD like the rest)
EduCADCorrespondence.analyze(entities, {
  profile: { xRef, dRef, s } | null,
  eps: 0.5,
  maxCandidates: 8,
  maxAlternatives: 8
}) -> {
  version: 1,
  observations: [{
    entityId, view, u, v, memberIds, kind, style
  }],
  candidates: [{
    a, b, axis, residual, score,
    evidence: { memberId, baseName, projector, junction, curve }
  }],
  groups: [{
    id, memberIds, observations, coords: { x, h, d } | null,
    status: 'unique' | 'ambiguous' | 'conflict' | 'insufficient'
  }],
  cycles: [{ views, edges, residual, status }],
  alternatives: [{ groups, score, distinguishingEvidence }],
  status: 'unique' | 'ambiguous' | 'conflict' | 'insufficient',
  issues: [{ code, class, entityId, message }]
}
```

`analyze` is read-only. `apply(entities, analysis)` returns cloned entities
with member IDs; it must not mutate input entities or change explicit IDs. The
first milestone runs only `analyze` and attaches the report; geometry stays on
the existing path.

### 7.2 Face/volume solver API

```js
// internal: public/lib/educad-face-solver.js (proposed)
EduCADFaceSolver.solve(geometry, {
  candidates,          // planar regions + analytic patch loops
  views,               // source view records
  visibility,          // A/E labels + hiddenLines policy
  limits: { maxSolutions: 8, maxSteps: 250000 },
  requireClosed: false
}) -> {
  solutions: [{
    id, faces, shells, openSurfaces, volume,
    score, evidence: { coveredInk, visibility, planarity }
  }],
  selected: 0 | null,
  status: 'unique' | 'ambiguous' | 'open' | 'invalid' | 'search-limit',
  issues: [...]
}
```

The solver consumes the existing `extractPlanarFaces` candidates and the
analytic loop records; it does not create a second face vocabulary. If a
solution is chosen, the existing `inferClosedFaces`/`selectManifoldFaces`
validation remains the last gate.

### 7.3 End-to-end pseudocode

```text
function reconstruct(entities, opts):
  obs = collectObservations(entities)
  corr = Correspondence.analyze(obs, opts)

  if corr.status == 'conflict':
      return inconsistent(corr.issues)

  if corr.status == 'ambiguous' and not opts.allowAmbiguous:
      return underdetermined(corr.issues + alternatives)

  entities2 = Correspondence.apply(entities, corr.groups)
  base = strictOrLive(entities2, opts)      # existing path
  candidates = planarAndAnalyticFaces(base)

  result = FaceSolver.solve(candidates, {
      views: obs.views,
      visibility: obs.visibility,
      requireClosed: opts.requireClosed
  })

  if result.status == 'ambiguous':
      return partial(base, result.solutions, 'ambiguous-geometry')
  if result.status == 'search-limit':
      return partial(base, [], 'numerical-or-limit')

  solid = result.solutions[result.selected]
  if opts.missingView:
      completion = ViewCompletion.project(solid, opts.missingView)
      completion = ViewCompletion.filter(completion, opts.partialInk)
      if completion.status != 'ok':
          return partial(solid, completion.alternatives, completion.status)

  return inferred(solid, completion)
```

### 7.4 `.edu` test plan

These scripts should be added only when the corresponding feature exists. They
follow the existing `# expect:` convention and run through
`node tools/edc.js`. New assertion properties would be added to
`tools/edc.js`: `correspondenceStatus`, `correspondenceAlternatives`,
`surfaceSolutions`, `missingView`, `viewCompletion`.

| Script | Purpose | Key expectation |
|---|---|---|
| `correspondence-cycle-unique.edu` | three views, one unambiguous station set | `correspondenceStatus=unique`, `diagnostics=none` |
| `correspondence-cycle-ambiguous.edu` | two stations share x/depth, profile has one candidate | `correspondenceStatus=ambiguous`, `correspondenceAlternatives=2`, `diagnostics=correspondence-ambiguous` |
| `correspondence-cycle-conflict.edu` | explicit IDs force contradictory profile depth | `determination=inconsistent`, `diagnostics=correspondence-conflict` |
| `face-completion-two-solids.edu` | open wire admits two closed completions | `surfaceSolutions=2`, `topologyStatus=ambiguous-surface`, no arbitrary solid |
| `face-completion-prism.edu` | existing notched prism | `12V 18E 8F`, `surfaceSolutions=1`, `status=inferred` |
| `visibility-rejects-back-face.edu` | two candidate faces, one violates a dashed stroke | selected solution, `visibilityChecks=ok`, `diagnostics=none` |
| `missing-view-underdetermined.edu` | plan + elevation only, no profile ink | `missingView=underdetermined`, `viewCompletion=alternatives`, `status=partial` |
| `missing-view-filter.edu` | plan + elevation + partial profile selects one | `missingView=selected`, `viewCompletion=ok`, expected V/E/F |
| `missing-view-conflict.edu` | partial profile contradicts every candidate | `diagnostics=missing-view-conflict`, `status=partial` |

Regression gate:

```sh
for f in tools/scripts/*.edu; do node tools/edc.js "$f" || exit 1; done
node tools/edc.js --strict tools/scripts/quad3d.edc
node tools/edc.js --solid tools/scripts/notched-prism.edu
```

The baseline at the time of this report is **143 `.edu` scripts, all passing**
(the directory also contains `.edc` scripts, for 151 script files total).

## 8. Licensing and dependency notes

The project is MIT (`LICENSE`, `package.json`) and intentionally
zero-dependency. That constrains what can be integrated:

| Component | License | Can we use it? |
|---|---|---|
| OpenCV 4.5+ / OpenCV.js | Apache-2.0 [S45] | Yes, with NOTICE/patent terms; but a large WASM/native dependency |
| ED_Lib (EDLines/EDCircles) | MIT [S46] | Yes, with attribution; C++ + OpenCV dependency |
| VTracer | MIT [S47] | Yes, with attribution; optional region tracing |
| Potrace 1.16 | GPL-2.0-or-later; commercial dual license [S48] | No for the distributed MIT app without a commercial license or legal review |
| Autotrace | program GPL-2.0+; library LGPL-2.1+ [S49] | Library possible with dynamic-linking terms, but GLib/centreline build is a heavy dependency; avoid by default |
| scikit-image | BSD-3-Clause [S54] | Yes for offline tooling; not a browser dependency |
| PlankAssembly | AGPL-3.0 [S50] | No for the core app; AGPL network use triggers source disclosure. Reference/evaluation only |
| Millrect | MIT [S51] | MIT-compatible, but it is an application, not a library; algorithm unverified |
| qrec | No license visible [S52] | No; treat as unlicensed/proprietary |
| amarschn/cv_orthographic_reconstruction | BSD-2-Clause [S53] | Ideas/porting reference only; Matlab research prototype |

Additional notes:

- **Core solver:** implement correspondence, face selection, and missing-view
  logic in-house in pure JavaScript. This preserves the zero-dependency
  constraint and keeps the exact/analytic certificate boundary intact.
- **Optional front-end:** if raster import is pursued, keep it behind a separate
  tool or worker. Vendoring OpenCV.js/ED_Lib changes the build and payload
  profile; that deserves its own decision, not a side effect of reconstruction.
- **AGPL/GPL:** do not copy code from PlankAssembly, Potrace, or Autotrace into
  the MIT codebase. Even "small" algorithm ports can create derivative-work
  questions. Use papers and public descriptions for algorithm design.
- **Citation/attribution:** if EDLines/EDCircles or VTracer are used, preserve
  their copyright notices and cite the papers/projects in the repository
  documentation.
- **Trademarks:** "Potrace" is a trademark; do not use the name for a modified
  port without permission [S48].

## 9. Ranked recommendation and smallest next milestone

### Ranked recommendation

1. **Build a read-only correspondence audit first (P0).** Candidate graph,
   cycle consistency, alternatives, and classified diagnostics. No geometry
   change. This de-risks the largest assumption and produces the data the face
   solver needs.
2. **Generalize face selection into a global constrained solver (P0/P1).**
   Candidate faces from the existing planar/analytic stages; edge-use,
   vertex-link, coverage, orientation, and volume constraints; top-k solutions;
   `ambiguous-surface`/`search-limit` instead of a guess.
3. **Make visibility a first-class constraint (P1).** Add
   `hiddenLines: complete|omitted|unknown`; use A/E strokes as hard filters only
   when complete, soft scores otherwise; keep sampled evidence labeled.
4. **Implement set-valued missing-view completion (P1).** Certain/possible/
   disputed strokes; filter with partial ink; report underdetermined instead of
   inventing a view.
5. **Add an optional vectorization front-end (P2).** OpenCV/ED_Lib for
   centrelines and primitives; VTracer only for regions; avoid GPL tools in the
   distributed app; require scale calibration.
6. **Extend curved surface families only as the `.edu` corpus demands (P3).**
   Torus/general quadrics later; no premature general curved-object solver.

### Smallest next milestone

**A read-only correspondence audit that changes no geometry.**

Deliverable:

- `public/lib/educad-correspondence.js` with `analyze` (and a no-op `apply`);
- `reconstruct(..., { correspondence: 'audit' })` attaches
  `result.correspondence` and classed diagnostic metadata, but still calls the
  existing `liveCore`/`reconstructStrict`/curve path unchanged;
- `tools/edc.js` assertions for `correspondenceStatus` and
  `correspondenceAlternatives`;
- three new `.edu` scripts: unique, ambiguous, conflict;
- all existing `143` `.edu` scripts still pass.

Why this is the right first step:

- It is pure JavaScript, zero-dependency, and reversible.
- It exposes the actual candidate structure on the existing corpus before any
  solver can change results.
- It gives the next milestone (global face selection) the correspondence
  alternatives it must consume.
- It directly addresses the repository's requirement to distinguish
  mathematical ambiguity, insufficient input, and unimplemented features.

### Unverified claims and evidence quality

- Leclerc–Fischler objective details and Grimstead–Martin pipeline order are
  based on abstracts, secondary descriptions, and the 2026 survey [S28]; the
  full texts were not available in a machine-readable form during this review.
- Sakurai–Gossard and Srinivas–Dutta are described from abstracts/metadata, not
  full-text algorithm inspection.
- PlankAssembly's AGPL-3.0 license was observed through the GitHub API/search
  result; the repository page was not rechecked after a rate limit.
- Millrect's MIT license and feature description come from its README; no
  algorithm paper or benchmark was verified.
- `elrinor/qrec` shows no license on its repository page; treat it as
  unlicensed.
- VTracer/ED_Lib/OpenCV versions and licenses are as observed on 2026-11-11;
  re-check before vendoring. OpenCV core is Apache-2.0 from 4.5.0, but optional
  modules and third-party code can carry other licenses.
- Huffman's page range (295–323) is the conventional citation; it was not
  independently rechecked online.
- The claim that "most existing engineering-drawing methods assume complete
  views" is the 2026 survey's summary [S28], not a claim about every paper.

## References

- [S1] D. A. Huffman, "Impossible objects as nonsense sentences," in *Machine
  Intelligence 6*, Edinburgh University Press, 1971, pp. 295–323.
- [S2] M. B. Clowes, "On seeing things," *Artificial Intelligence* 2(1), 1971.
  https://doi.org/10.1016/0004-3702(71)90005-1
- [S3] D. Waltz, "Understanding line drawings of scenes with shadows," in
  *The Psychology of Computer Vision*, McGraw-Hill, 1975.
- [S4] K. Sugihara, "Mathematical structures of line drawings of polyhedrons,"
  *IEEE TPAMI* 4(5), 1982. https://doi.org/10.1109/TPAMI.1982.4767289
- [S5] K. Sugihara, "A necessary and sufficient condition for a picture to
  represent a polyhedral scene," *IEEE TPAMI* 6(5), 1984.
  https://doi.org/10.1109/TPAMI.1984.4767571
- [S6] K. Sugihara, *Machine Interpretation of Line Drawings*, MIT Press, 1986.
  https://www.isc.meiji.ac.jp/~kokichis/openbooks/mild.pdf
- [S7] T. Marill, "Emulating the human interpretation of line-drawings as
  three-dimensional objects," *IJCV* 6(2), 1991.
  https://doi.org/10.1007/BF00128154
- [S8] Y. G. Leclerc and M. A. Fischler, "An optimization-based approach to the
  interpretation of single line drawings as 3D wire frames," *IJCV* 9(2), 1992.
  https://doi.org/10.1007/BF00129683
- [S9] I. J. Grimstead and R. R. Martin, "Creating solid models from single 2D
  sketches," *ACM Solid Modeling*, 1995.
  https://doi.org/10.1145/218013.218082
- [S10] I. J. Grimstead and R. R. Martin, "Incremental line labelling for sketch
  input of solid models," *Computer Graphics Forum* 15(2), 1996.
  https://doi.org/10.1111/1467-8659.1520155
- [S11] M. C. Cooper, "Linear constraints for the interpretation of line
  drawings of curved objects," *Artificial Intelligence* 119, 2000.
  https://doi.org/10.1016/S0004-3702(00)00008-4
- [S12] M. C. Cooper, "Wireframe projections: physical realisability of curved
  objects and unambiguous reconstruction of simple polyhedra," *IJCV* 64, 2005.
  https://doi.org/10.1007/s11263-005-1087-9
- [S13] M. C. Cooper, *Line Drawing Interpretation*, Springer, 2010.
  https://doi.org/10.1007/978-1-84800-229-6
- [S14] J. Malik, "Interpreting line drawings of curved objects," *IJCV* 1,
  1987. https://doi.org/10.1007/BF00128527
- [S15] M. A. Wesley and G. Markowsky, "Fleshing out projections," *IBM Journal
  of Research and Development* 25(6), 1981, pp. 934–954.
  https://doi.org/10.1147/rd.256.0934
- [S16] G. Markowsky and M. A. Wesley, "Fleshing out wire frames," *IBM Journal
  of Research and Development* 24(5), 1980.
  https://doi.org/10.1147/rd.245.0582
- [S17] H. Sakurai and D. C. Gossard, "Solid model input through orthographic
  views," *SIGGRAPH* 1983. https://doi.org/10.1145/800059.801155
- [S18] K. Preiss, "Constructing the solid representation from engineering
  projections," *Computers & Graphics* 8(4), 1984.
  https://doi.org/10.1016/0097-8493(84)90036-0
- [S19] Z. Chen and D. B. Perng, "Automatic reconstruction of 3D solid objects
  from 2D orthographic views," *Pattern Recognition* 21(5), 1988.
  https://doi.org/10.1016/0031-3203(88)90003-9
- [S20] Q. W. Yan, C. L. P. Chen, and Z. Tang, "Efficient algorithm for the
  reconstruction of 3D objects from orthographic projections," *Computer-Aided
  Design* 26(9), 1994. https://doi.org/10.1016/0010-4485(94)90020-5
- [S21] B. S. Shin and Y. S. Shin, "Fast 3D solid model reconstruction from
  orthographic views," *Computer-Aided Design* 30(1), 1998.
  https://doi.org/10.1016/S0010-4485(97)00054-7
- [S22] S. S. P. Shum, W. S. Lau, M. M. F. Yuen, and K. M. Yu, "Solid
  reconstruction from orthographic views using 2-stage extrusion,"
  *Computer-Aided Design* 33(1), 2001, pp. 91–102.
  https://doi.org/10.1016/S0010-4485(00)00079-8
- [S23] S. X. Liu, S. M. Hu, Y. J. Chen, and J. G. Sun, "Reconstruction of
  curved solids from engineering drawings," *Computer-Aided Design* 33(14),
  2001. https://doi.org/10.1016/S0010-4485(00)00143-3
- [S24] S. Soni and B. Gurumoorthy, "Handling solids of revolution in
  volume-based construction of solid models from orthographic views," *JCISE*
  3(3), 2003. https://doi.org/10.1115/1.1604831
- [S25] J. Dimri and B. Gurumoorthy, "Handling sectional views in volume-based
  approach to automatically construct 3D solid from 2D views," *Computer-Aided
  Design* 37(5), 2005. https://doi.org/10.1016/j.cad.2004.10.007
- [S26] Y. Srinivas and D. Dutta, "A solution to the missing-view problem for
  polyhedral solids," *ASME Design Automation Conference*, 1991.
  https://doi.org/10.1115/DETC1991-0126
- [S27] W. Wang and G. Grinstein, "A survey of 3D solid reconstruction from 2D
  projection line drawings," *Computer Graphics Forum* 12(2), 1993.
  https://doi.org/10.1111/1467-8659.1220137
- [S28] C. Zhang, R. Pinquié, A. Polette, M. Iida, H. de Charnace, and J.-P.
  Pernot, "3D CAD models reconstruction from 2D drawings: a survey and future
  challenges," *Computer-Aided Design & Applications* 23(6), 2026, pp. 646–678.
  https://doi.org/10.14733/cadaps.2026.646-678
- [S29] M. Shpitalni and H. Lipson, "Identification of faces in a 2D line
  drawing projection of a wireframe object," *IEEE TPAMI* 18(10), 1996.
  https://doi.org/10.1109/34.541409
- [S30] P. A. C. Varley, H. Suzuki, J. Mitani, and R. R. Martin,
  "Interpretation of single sketch input for mesh and solid models,"
  *International Journal of Shape Modeling* 6(2), 2000.
  https://doi.org/10.1142/S0218654300000144
- [S31] J. Liu, Y. Chen, and X. Tang, "Decomposition of complex line drawings
  with hidden lines for 3D planar-faced manifold object reconstruction,"
  *IEEE TPAMI* 33(1), 2011. https://doi.org/10.1109/TPAMI.2010.49
- [S32] C. Zou, Y. Chen, and H. Fu, "Progressive 3D reconstruction of
  planar-faced manifold objects with DRF-based line drawing decomposition,"
  *IEEE TVCG* 21(2), 2015. https://doi.org/10.1109/TVCG.2014.2354039
- [S33] R. Furferi, L. Governi, M. Palai, and Y. Volpe, "From 2D orthographic
  views to 3D pseudo-wireframe: an automatic procedure," *IJCA* 5(6), 2010.
  https://doi.org/10.5120/918-1296
- [S34] S. Ablameyko and T. Pridmore, *Machine Interpretation of Line Drawing
  Images*, Springer, 2000. https://doi.org/10.1007/978-1-4471-0789-7
- [S35] X. Hilaire and K. Tombre, "Robust and accurate vectorization of line
  drawings," *IEEE TPAMI* 28(6), 2006.
  https://doi.org/10.1109/TPAMI.2006.127
- [S36] S. Suzuki and K. Abe, "Topological structural analysis of digitized
  binary images by border following," *CVGIP* 30(1), 1985.
  https://doi.org/10.1016/0734-189X(85)90136-7
- [S37] D. H. Douglas and T. K. Peucker, "Algorithms for the reduction of the
  number of points required to represent a digitized line or its caricature,"
  *Cartographica* 10(2), 1973. https://doi.org/10.3138/FM57-6770-U75U-7727
- [S38] T. Y. Zhang and C. Y. Suen, "A fast parallel algorithm for thinning
  digital patterns," *Communications of the ACM* 27(3), 1984.
  https://doi.org/10.1145/357994.358023
- [S39] J. Matas, C. Galambos, and J. Kittler, "Robust detection of lines using
  the progressive probabilistic Hough transform," *CVIU* 78(1), 2000.
  https://doi.org/10.1006/cviu.1999.0831
- [S40] R. Grompone von Gioi, J. Jakubowicz, J.-M. Morel, and G. Randall,
  "LSD: a fast line segment detector with a false detection control,"
  *IEEE TPAMI* 32(4), 2010. https://doi.org/10.1109/TPAMI.2008.300
- [S41] C. Akinlar and C. Topal, "EDLines: a real-time line segment detector
  with a false detection control," *Pattern Recognition Letters* 32(13), 2011.
  https://doi.org/10.1016/j.patrec.2011.06.001
- [S42] C. Akinlar and C. Topal, "EDCircles: a real-time circle detector with a
  false detection control," *Pattern Recognition* 46(3), 2013.
  https://doi.org/10.1016/j.patcog.2012.09.020
- [S43] P. Selinger, "Potrace: a polygon-based tracing algorithm," 2003.
  https://potrace.sourceforge.net/potrace.pdf
- [S44] V. Egiazarian et al., "Deep vectorization of technical drawings,"
  *ECCV* 2020. https://doi.org/10.1007/978-3-030-58601-0_35
- [S45] OpenCV license (Apache-2.0 for 4.5.0+).
  https://opencv.org/license/
- [S46] ED_Lib (MIT). https://github.com/CihanTopal/ED_Lib
- [S47] VTracer (MIT). https://github.com/visioncortex/vtracer
- [S48] Potrace 1.16 (GPL-2.0-or-later). https://potrace.sourceforge.net/
- [S49] AutoTrace (GPL-2.0+ / LGPL-2.1+).
  https://github.com/autotrace/autotrace
- [S50] PlankAssembly (AGPL-3.0).
  https://github.com/manycore-research/PlankAssembly
- [S51] Millrect (MIT). https://github.com/JIROMO/Millrect
- [S52] qrec (no license visible). https://github.com/elrinor/qrec
- [S53] amarschn/cv_orthographic_reconstruction (BSD-2-Clause).
  https://github.com/amarschn/cv_orthographic_reconstruction
- [S54] scikit-image (BSD-3-Clause). https://scikit-image.org/

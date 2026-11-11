# 2D/3D sketch-to-CAD and CAD feature recognition: research and design note

Status: research/design only. No production code is changed by this note.

Scope: **Major** only. Major2 is out of scope. The subject is the existing
primitive/curve/surface pipeline in `public/lib/educad-reconstruct.js`,
`public/lib/educad-curve-reconstruct.js` and `public/lib/educad-surfaces.js`,
and the feature sheets under `tools/scripts/`.

Date: 2026-11-11.

Method: read the local pipeline and feature sheets; consulted the projects'
source repositories, license files, READMEs, papers and documentation listed in
the references. No source code was copied. The API and pseudocode below are
original design sketches.

---

## 0. Executive summary

1. Major already has a **deterministic, evidence-based reconstruction
   pipeline** that goes from 2D vertices/edges/curves in orthographic views to
   a bounded analytic surface complex. It reports specific diagnostics instead
   of silently guessing.
2. The relevant research is **not** primarily "sketch-to-CAD" sequence
   generation. DeepCAD, CAD-Recode, Text2CAD, Img2CAD and Sketch2CAD solve
   different problems: generating or recovering a CAD *construction sequence*
   from point clouds, text, images or freehand sketches. They do not consume
   orthographic engineering drawings, do not produce feature diagnostics, and
   most of their data/weights are non-commercial.
3. The directly useful body of work is **classical B-rep feature
   recognition**: attributed adjacency graphs, edge convexity, cavity
   seed/propagation, coaxial hole grouping, fillet/blend chains, hint-based
   recognition and defeaturing-based validation. Analysis Situs is the best
   open reference implementation of these ideas (BSD-3-Clause), and it
   explicitly does **not** use machine learning.
4. The highest-value next step is to build an **oriented surface-adjacency
   graph over our existing bounded analytic complex**, classify shared
   boundaries as convex/concave/smooth, and re-express the existing
   spherical/cylindrical recess and cylindrical fillet records as graph
   predicates. That adds a reusable feature foundation without a trained model,
   a new dependency, or a new geometry family.
5. The smallest next milestone is **`feature-graph-v1`**: graph + convexity +
   predicates over the existing recess/fillet records, verified by existing
   `.edu` sheets. Generic cavity and coaxial-hole rules come after that.

---

## 1. Our current primitive and feature inference

### 1.1 Input contract

The public entry point is `EduCADReconstruct.reconstruct(entities, options)`.
The input is a set of drawing entities, not a solid name:

| Entity | Role |
|---|---|
| `POINT` | A station observed in `PLAN`, `ELEVATION` or `PROFILE`. |
| `SEGMENT` | A finite straight stroke in one view. |
| `LINE` / `RAY` | Unbounded geometry; retained with `unbounded-edge-unsupported` unless it has a construction role. |
| `CIRCLE` | A full circular observation in one view. |
| `CIRCULAR_ARC` | An arc observation, including silhouette evidence. |
| `CURVE` | A NURBS station curve (`/curve-through`, `/circle-through`, `/arc-through`). |
| `DATUM_AXIS` | The drawing's XY datum/axis reference. |

Correspondence comes from:

- shared `x` between `PLAN` and `ELEVATION`;
- the declared side frame between plan depth and profile position,
  `side(d) = xRef + s * (d - dRef)`;
- shared `y` between `ELEVATION` and `PROFILE`;
- explicit member IDs (`meta.members`) or the compatibility station-name
  fallback.

Coordinates are never averaged, snapped or rewritten. Contradictory
observations stay separate and produce a diagnostic. This is a hard constraint
system, not a best-fit reconstruction.

The pipeline stages documented in `docs/PRIMITIVE_RECONSTRUCTION.md` are:

1. collect primitive observations and explicit member constraints;
2. resolve cross-view correspondence;
3. lift vertices/edges and supported analytic curves into 3D;
4. infer planar regions and supported ruled surface patches;
5. return geometry plus specific diagnostics for unresolved observations.

The older `reconstructLive`/`reconstructStrict` APIs, including the named-shape
readers, remain for compatibility. New code uses `reconstruct`; the surface
pipeline is not a list of solid-name readers.

### 1.2 Lifting and surface inference

The implemented curve/surface stage includes:

- **True-shape circles and arcs** paired with an edge-on trace in another
  principal view. Plan/front, plan/side and front/side pairs are rotated into
  one canonical two-view problem.
- **Oblique circles** from projected ellipses, with plane-normal candidates
  resolved by a second view, an edge-on run, or boundary-point evidence.
- **Spheres** from equal full circles in two or more views.
- **Spherical recesses**: a circular mouth plus a rim-to-rim circular-arc
  silhouette determines a sphere cap.
- **Cylindrical recesses**: a circular mouth framed as an opening in a drawn
  face, plus edge-on depth strokes and an exact bottom edge, determines a
  bounded cylinder with a flat bottom.
- **Cylindrical fillets**: a true-shape tangent arc, two tangent face edges and
  paired generator/end lines determine a partial cylinder with two straight
  tangent boundaries shared with adjacent plane strips.
- **Inclined cones**: a 3D circle plus two tangent silhouette generators
  determines a right circular cone over the base circle.
- **Ruled patches**: coaxial circular boundaries plus two corroborating
  straight silhouette generators; equal radii, unequal radii and chains use
  the same operation.
- **Planar faces with holes**: boundary walks are traced and nested loops
  become face holes.
- **NURBS station curves**: same station count/closure form a correspondence
  family, partitioned into spatial curves with at most one source curve per
  view.

The output is attached as `geometry.surfaces`, `geometry.surfaceModel` and
`geometry.analyticSurfaceValidation`. `EduCADSurfaces.build`, `validate`,
`certify`, `incidence`, `section`, `intersect`, `trim`, `split`,
`attachBoundary`, `shareBoundary` and `intersectionCurves` operate on the same
bounded analytic vocabulary.

### 1.3 Feature records and diagnostics

Feature-like output currently exists in two forms.

**Explicit feature records:**

| Record | Where | Fields |
|---|---|---|
| `geometry.recesses` | `educad-curve-reconstruct.js` | `kind:'spherical'` or `'cylindrical'`, centre/radius or mouth/axis/depth/bottom, `closure`, `sourceIds`, mouth/bottom curve indices, surface index. |
| `geometry.fillets` | `educad-curve-reconstruct.js` | `kind:'cylindrical'`, centre/axis/radius, start angle/sweep/length, `tangentLines`, `endArcs`, `closure:'open'`, `sourceIds`, `surface`, `adjacentSurfaces`. |
| `geometry.spheres` | `educad-curve-reconstruct.js` | centre/radius/source IDs. |

**Surface-patch tags:**

- `surfacePatches[].recess`, `recessMouth`, `recessBottom`, `closure`;
- `surfacePatches[].fillet`, `filletAdjacent`, `loops` with `lines`;
- planar patches with `boundaryCurves`, `outer`, `holes`, `faceIndices`.

**Diagnostic codes specific to features:**

| Code | Meaning |
|---|---|
| `recess-evidence-conflict` | A mouth/arc pair fails the sphere-cap radius/endpoint/mouth relation. |
| `recess-evidence-ambiguous` | Several silhouette arcs fit one mouth with different sphere geometry. |
| `recess-mouth-unclosed` | The recess is determined but no edge-on mouth stroke closes it. |
| `recess-depth-conflict` | A cylindrical-recess depth stroke/bottom edge is inconsistent. |
| `recess-depth-missing` | The mouth is framed but no depth strokes fix a depth. |
| `recess-depth-ambiguous` | Several depth-stroke spans fit one mouth. |
| `fillet-ambiguous` | Several coaxial arc pairs fit one cross-section. |
| `fillet-tangent-missing` | One tangent face edge at an arc endpoint is missing. |
| `fillet-tangent-conflict` | A face edge extends into the fillet instead of away from it, or the tangent pair is parallel. |
| `fillet-boundary-missing` | A tangent generator boundary has no matching straight edge in the paired view. |

The pipeline also reports generic `curve-*`, `point-correspondence-missing`,
`surface-*`, `split-*`, `unbounded-edge-unsupported`, and surface
validation/certificate issues.

The `.edu` runner exposes `recesses`, `fillets`, `surfaces`, `surfaceKinds`,
`surfaceLoops`, `surfaceShells`, `surfaceOpen`, `surfaceBoundary`,
`surfaceModel`, `surfaceCertificate`, `surfaceCertificateIssues`,
`surfaceLineBoundaries`, `surfaceSharedLineBoundaries`,
`surfaceCurveBoundaries`, `surfaceValidation`, `diagnostics`, `unresolved` and
`status`. `holes` is **not** a feature count: it counts inner loops of planar
display faces. A rectangular through-hole can therefore report `holes=2` while
having no `geometry.recesses` record.

### 1.4 What is actually recognized today

| Sheet | Geometry | Existing record | What it proves |
|---|---|---|---|
| `spherical-recess.edu` | Circular mouth + cap-silhouette arc | `recesses=1`, `kind:'spherical'` | Sphere cap with one mouth loop; optional planar mouth closure. |
| `cylindrical-recess.edu` | Circular mouth + framed face + depth strokes + bottom edge | `recesses=1`, `kind:'cylindrical'`, depth 20, radius 10 | Blind cylinder with flat bottom; mouth/bottom loops shared with the cylinder. |
| `fillet-line-boundary.edu` | Quarter arc + tangent face edges + plan generators | `fillets=1`, radius 10, length 40 | Partial cylinder with two shared straight tangent boundaries and two adjacent plane strips. |
| `through-hole.edu` | Rectangular opening through a plate | `holes=2`, no `recesses` record | Planar face-with-hole inference only; not a generic feature recognizer. |
| `plate-hole.edu` | Rectangular opening open at the bottom | `holes=1`, no `recesses` record | Same limitation. |

### 1.5 Gaps relevant to feature recognition

The pipeline has **no generic feature graph** and no edge-convexity classifier.
It has no generic cavity/hole recognizer beyond the two narrow recess readers.
In particular:

- only `PLAN`/`ELEVATION` circular mouths; `PROFILE` mouths are unsupported;
- only circular mouths, not elliptical or partial mouths;
- only flat-bottomed cylindrical recesses; no conical drill points,
  counterbores, stepped holes, counterbores/countersinks, or torus fillets;
- only cylindrical fillets between planar faces, no fillet chains, variable
  radius, torus fillets or general constant-radius blends between non-planar
  faces;
- no Boolean subtraction of the cavity from the surrounding display faces;
- no merging of a recess mouth into the surrounding face's inner loop;
- the spherical/cylindrical/fillet readers run in a fixed order and consume
  evidence, so interacting features can be order-dependent;
- no generic point-in-patch test for an arbitrary curved patch;
- cone crossing cuts are refused rather than split;
- the analytic certificate certifies the bounded model, not the display
  triangulation; the display triangle check is separate and can be `issues`.

These are the gaps a classical feature graph can address without changing the
primitive-lifting stage.

---

## 2. Research and OSS landscape

The table records exact repository/version information available on
2026-11-11. "Commit" is the default-branch HEAD at that date unless a tag is
named. License identifiers are from the repository's license file, not from a
package registry.

### 2.1 Reconstruction, generation and sketch/image systems

| Project | Version / commit | Input -> output | License | Relevance |
|---|---|---|---|---|
| **DeepCAD** (ICCV 2021) | `ChrisWu1997/DeepCAD`, HEAD `f7b3507` | CAD command sequence -> reconstructed/generated sequence; 178,238 models | Code **MIT**; data derived from ABC/Onshape, no separate data license in the repo | Generative sequence model. Not a feature recognizer; not drawing-based. |
| **CAD-Recode** (ICCV 2025) | `filaPro/cad-recode`, tag `v1.5` `aa732e0` | Point cloud -> executable Python CadQuery code; ~1M synthetic sequences | **CC BY-NC 4.0** (repo, model card, dataset card) | Shows code as an interpretable output representation; non-commercial; no drawings/diagnostics. |
| **Text2CAD** (NeurIPS 2024) | `SadilKhan/Text2CAD`, HEAD `669a814` | Text -> CAD command sequence; ~170K models / ~660K annotations from DeepCAD | **CC BY-NC-SA 4.0** | Text-conditioned generation; non-commercial/share-alike; not relevant to orthographic input. |
| **Img2CAD** (SIGGRAPH Asia 2025) | `qq456cvb/Img2CAD`, HEAD `afe48af` | Single image -> discrete CAD structure + continuous parameters; 4,574 furniture models | Code and model card **MIT**; dataset card **MIT**, built on PartNet-derived data (upstream terms need checking) | Image front-end/sequence model; furniture categories, not engineering drawings. |
| **Sketch2CAD** (SIGGRAPH Asia 2020) | `Enigma-li/Sketch2CAD`, HEAD `9702c24` | Freehand sketch sequence + partial CAD context -> CAD operation and parameters; ~400K synthetic train / 100K test | Code **MIT**; training-data license not stated in the repo | Interactive sketch-to-operation system; requires context and a trained network. |
| **Fusion 360 Gallery** (2021) | `AutodeskAILab/Fusion360GalleryDataset`, HEAD `1084b88`; reconstruction `r1.0.1`, segmentation `s2.0.1` | 8,625 sketch/extrude sequences; 35,680 segmented parts with 8 face labels | **Autodesk dataset license: non-commercial research only; no redistribution of the dataset as a whole** | Useful benchmark labels; not usable as a shipped dependency or commercial corpus. |
| **ABC** (CVPR 2019) | `v00`; 1M models | STEP/Parasolid/STL/OBJ/features of CAD models | Copyright owned by model creators; **Onshape Terms of Use 1.g.ii**; not a permissive dataset | Large B-rep corpus for research; redistribution/commercial use is not clean. |
| **BRepNet** (CVPR 2021) | `AutodeskAILab/BRepNet`, HEAD `2f41a9f` | B-rep -> per-face modeling-operation segmentation; Fusion 360 segmentation | **CC BY-NC-SA 4.0** | Strong B-rep ML baseline; non-commercial; needs a B-rep, not a drawing. |
| **UV-Net** (CVPR 2021) | `AutodeskAILab/UV-Net`, HEAD `91cc970` | B-rep UV-grids + face-adjacency graph -> segmentation/classification | Code **MIT**; datasets have separate licenses (MFCAD MIT, Fusion 360 non-commercial, SolidLetters own license) | Shows a clean local representation (UV grids + graph) but still supervised B-rep ML. |
| **MFCAD** | `hducg/MFCAD`, HEAD `ef6d58a` | 24 machining-feature classes of STEP models | **MIT** (repository) | Small, permissive feature-recognition benchmark; useful for offline evaluation. |
| **MFCAD++** | QUB dataset DOI `10.17034/d1fec5a0-8c10-4630-b02e-b92dc81df823` | 59,665 STEP models, 24 classes, 3-10 features per model | **CC BY** per QUB dataset page | Permissive benchmark; good for a future offline adapter. |

### 2.2 Kernels, CAD tooling and feature-recognition frameworks

| Project | Version / commit | What it provides | License | Use here |
|---|---|---|---|---|
| **Open CASCADE Technology (OCCT)** | `V8_0_1` `c560592` (30 Jul 2026) | B-rep kernel, booleans, fillets, defeaturing, STEP exchange | **LGPL-2.1 with OCCT exception** | Offline/evaluation only. Not a runtime dependency now. |
| **Analysis Situs** | `v2026.1.1` `3c3ec3f` (GitLab `ssv/AnalysisSitus`) | AAG, rule-based feature recognition, graph isomorphism, shape interrogation; explicitly no ML | **BSD-3-Clause** | Primary classical reference. Reimplement ideas; do not copy code. |
| **CadQuery** | `v2.8.0` `fb4c6d4` | Python parametric CAD on OCCT; STEP import/export, face/edge queries | **Apache-2.0**; OCCT is LGPL | Offline test-solid generation and benchmark adapter. |
| **pythonocc-core** | `8.0.1.2` `6c0a2d8` | Python bindings to OCCT | **LGPL-3.0** | Offline evaluation only. |
| **occt-import-js** | `0.0.23` `c2148e5` | STEP/IGES/BREP import to mesh in JS/WASM | **LGPL-2.1** | Possible future browser STEP import; not needed for the feature graph. |
| **opencascade.js** | 2.0 beta series, HEAD `5ff2b75` | OCCT compiled to WebAssembly | **LGPL-2.1** | Possible future browser kernel; large and licensing-sensitive. |
| **replicad** | `v1.2.1` `a04028c` | JS parametric CAD wrapper over OCCT | **MIT** wrapper; OCCT LGPL | Could generate test solids in JS; not a recognizer. |

### 2.3 What is permissively usable

For **ideas and offline evaluation**, the cleanest options are:

- **Analysis Situs** (BSD-3-Clause) for algorithm structure and test models;
- **OCCT** (LGPL-2.1 with exception) for validation/defeaturing, with license
  compliance;
- **CadQuery** (Apache-2.0) for generating STEP test solids;
- **MFCAD** (MIT) and **MFCAD++** (CC BY) for feature-recognition benchmarks;
- **UV-Net code** (MIT) if a learned baseline is ever needed, but its datasets
  are separately licensed;
- **DeepCAD code** (MIT) only for understanding sequence representation, not
  for its data.

For **runtime**, none of these are needed for `feature-graph-v1`. The project
is zero-npm-dependency and should stay that way.

---

## 3. Classical B-rep feature recognition

This is the part worth borrowing. Analysis Situs is used as the concrete
reference because its documentation is unusually explicit about the
algorithms, and because it states that it does not use machine learning
([feature recognition principles](https://analysissitus.org/features/features_recognition-principles.html)).

### 3.1 Attributed adjacency graph (AAG)

The classical AAG, following Joshi and Chang (1988):

- one node per B-rep face;
- one arc per pair of faces that share at least one edge;
- arcs carry attributes: convex/concave/smooth, dihedral angle, shared edges;
- nodes carry attributes: surface type, area, UV bounds, inner loops, base
  face, convex hull, axis/axial range.

Analysis Situs notes two variants: the face adjacency graph (FAG) permits
multiple arcs for multiple shared edges; its AAG keeps a single arc and caches
the shared edges in an arc attribute. It also supports optional
vertex-adjacency arcs for vertex blends. The graph can be serialized to JSON
with `{nodes, arcs}`; `dump-aag-json` is a useful debug format.

Why this matters for us: our `EduCADSurfaces.incidence(model)` already computes
boundary uses and surface membership. It is one step away from an AAG. What it
lacks is:

- an explicit arc per surface pair (rather than per boundary element);
- orientation/sense of each boundary use;
- convexity and dihedral attributes;
- surface-level attributes such as inner-loop count, area, axial range and
  material side.

### 3.2 Edge convexity and smoothness

Convexity is defined relative to the solid's material side. With outward
surface normals `nA`, `nB` at a shared boundary point, and `tA` the boundary
direction as traversed on face A's consistently oriented outer loop:

```text
s      = dot(cross(nA, nB), tA)
angle  = atan2(norm(cross(nA, nB)), dot(nA, nB))

s > 0        -> convex
s < 0        -> concave
angle < tol  -> smooth/tangent (G1)
```

The sign convention must be calibrated once on a box (all edges convex), a
slot/pocket (mouth edges vs bottom edges), and a through-hole. It depends on
consistent face orientation. If the sign is reversed, flip it globally; do not
flip per feature.

For curved surfaces, sample three or more stations on the shared boundary and
require a consistent sign. If normals vary or the material side is unknown,
report `feature-convexity-unknown`; do not guess. A tangent cylinder-plane
junction should classify as `smooth` and additionally satisfy
`distance(axis, plane) = radius` (or `distance(axis, line) = radius` for a
straight generator).

Analysis Situs exposes `check-vexity`, `check-vertex-vexity`, and arc
attributes such as `asiAlgo_FeatureAttrAngle`, `asiAlgo_FeatureAttrAdjacency`,
`asiAlgo_FeatureAttrArea`, `asiAlgo_FeatureAttrBaseFace`,
`asiAlgo_FeatureAttrConvexHull` and `asiAlgo_FeatureAttrUVBounds`. Those names
are useful as a checklist for graph attributes.

**Critical caveat for our model:** convexity is only defined with a material
side. Our display meshes for recesses are oriented "viewed from inside the
bowl", and fillet patches are open. A naive use of display normals would
misclassify. The graph builder must carry an explicit `materialSide` /
`outward` per surface, or derive it from a closed shell's signed volume, and
propagate it across shared boundaries. Open feature patches with unknown side
must stay `unknown`.

### 3.3 Cavity detection

Analysis Situs' cavity recognizer is a clean seed-and-propagate algorithm
([recognize cavities](https://analysissitus.org/features/features_recognize-cavities.html)):

1. **Seed face detection**: find faces with an inner loop whose boundary
   transitions have convex dihedral angles. These are candidate "base" or
   "capping" faces with a potential cavity opening.
2. **Propagation**: from each seed, visit adjacent faces over the inner-loop
   edges. Stop when another inner loop with convex-only adjacency is reached,
   when propagation would cover the entire shape (invalid cavity), or when a
   size threshold is exceeded.
3. **Connected components**: group recognized faces by AAG connectivity.
   **Base faces** are the non-cavity neighbors that cap the cavity.

The output is a set of face IDs plus base faces; the `-maxSize` option limits
cavity size by bounding-box diagonal. This is not a named "pocket" or "slot"
recognizer; it detects arbitrary cavities without differentiating type. That is
exactly the level of generality our current pipeline lacks.

For our complex, the analogue is:

- seed on a planar or curved surface with an `inner` loop;
- propagate across shared boundary elements whose convexity is known;
- stop at another inner loop or at a base surface;
- reject if the feature covers the whole connected component;
- return `faces`, `baseFaces`, `boundaryLoops`, `size`, `status`.

### 3.4 Drilled-hole recognition

Analysis Situs' drilled-hole recognizer is surface-based, not curve-based
([recognize drilled holes](https://analysissitus.org/features/features_recognize-drill-holes.html)):

- find isolated groups of faces that look like holes (coaxial cylinders for
  counterbores, coaxial cone+cylinder for countersinks);
- match the group against a dictionary of predefined feature patterns;
- extract axis, radius, depth, through/blind and face roles
  (`sinkFaces`, `holeFaces`, `boreFaces`, `blind`).

The docs explicitly warn against a curve-only approach: a hole in a round tube
produces a Steinmetz curve, not a circle; modelers may write a spline instead
of a clean circle; circle fitting produces noisy diameters such as 6.1 mm.
Surface type and coaxiality are more robust than the boundary curve's
analytical type.

This suggests a staged rule for us:

1. group `cylinder` and `cone` surfaces by axis (parallel/coaxial within
   tolerance);
2. require circular boundary loops whose radius agrees with the surface;
3. classify:
   - one cylinder, open both ends -> through hole;
   - one cylinder + planar bottom -> blind hole;
   - two coaxial cylinders of different radii -> counterbore;
   - cone + cylinder -> countersink;
4. compute depth from the axial span of the loops, radius from the cylinder,
   and through/blind from the end caps;
5. emit `hole` with `subtype`, `axis`, `radius`, `depth`, `through`,
   `faces`, `baseFaces`, `sourceIds`.

Our existing `cylindricalRecessEvidence` is a special case of this: it already
checks a framed circular mouth, depth strokes and a bottom edge. A generic
hole rule can reuse its evidence and add counterbore/countersink patterns.

### 3.5 Fillet, chamfer and blend recognition

Analysis Situs' blend recognizer is based on Venkataraman et al. (2002) and
Slyadnev and Turlapov (2020)
([recognize fillets](https://analysissitus.org/features/features_recognize-fillets.html)):

- first pass: local recognition marks candidate blend faces in the AAG;
- later passes: refine using the neighborhood, because a chamfered cube has no
  history to rely on;
- extract chains grouped by topological connectivity and radius;
- filter by size (radius for blends, width for chamfers);
- the command is `recognize-blends [-radius <r>] [-fid <id>]`.

The classical blend-removal approach (Venkataraman et al.) identifies blend
faces, traces spring edges, creates smooth faces, extends the support faces,
and then re-intersects them. The recognition part is the relevant half: a
blend face is a face that is tangent/smooth to two support faces along two
boundary curves, with a consistent radius.

Our current fillet reader is a 2D-evidence method, but its output already has
the right structure:

- `surfacePatches[].kind:'cylinder'` with `fillet:true`;
- `loops` with two end arcs and two inline straight lines;
- `tangentLines` and `adjacentSurfaces` in `geometry.fillets`;
- `surfacePatches[].filletAdjacent` on the two plane strips.

A graph predicate can therefore validate and chain existing fillets without
re-deriving them:

- cylinder patch with two smooth/tangent boundary transitions to support
  surfaces;
- radius > 0, sweep in `(0, pi)`;
- straight generators shared with adjacent planes;
- adjacent fillets share a tangent line, axis or radius.

### 3.6 Feature interaction and hints

Two classical ideas are directly relevant to our diagnostic philosophy:

- **Hint-based recognition** (Vandenbrande and Requicha, 1993): generate
  feature hints from local geometric/topological patterns, then complete them
  while respecting interactions; do not require a complete, isolated feature
  before reporting evidence.
- **Minimal condition subgraph** (Gao and Shah, 1998): represent the minimal
  set of faces/edges needed to recognize an interacting feature; use it to
  avoid losing a feature when another feature removes some of its faces.

Our pipeline already behaves like a hint system: `recess-*` and `fillet-*`
diagnostics distinguish missing evidence, conflicting evidence and ambiguity.
The missing piece is to attach those hints to a graph and let a later pass
complete or reject them after other features are recognized. This is the right
way to handle interacting holes, a fillet interrupted by a pocket, or a
counterbore whose mouth is partly hidden.

A practical rule: **a hint is a feature record with `status:'hinted'` and a
specific missing constraint**, not a silent negative. That preserves the
project's "retain supported geometry and explain the unresolved part"
principle.

### 3.7 Defeaturing as validation

Defeaturing is a powerful oracle for a feature recognizer:

1. recognize a candidate feature;
2. remove/suppress it (extend support faces, fill the cavity);
3. check that the result is valid, closed (if the input was closed), and that
   the volume changed by the expected amount;
4. check that the removed face set is exactly the candidate set.

OCCT provides `BRepAlgoAPI_Defeaturing` and Analysis Situs provides
suppression tools. OCCT also has feature-construction classes such as
`BRepFeat_MakeCylindricalHole`; these construct a feature from parameters,
they do not recognize one in an existing solid. This is **offline validation
only**: it requires a B-rep and a kernel, not a runtime dependency. It is
especially useful for testing a cavity/hole rule on `MFCAD`/`MFCAD++` STEP
files.

For our `.edu` sheets, a lighter analogue is enough: the analytic certificate
already checks closure/incidence/parameters; a feature predicate can check that
the candidate's boundary loops are shared and that the expected base faces are
present.

### 3.8 Classical reconstruction from orthographic views

Our pipeline is closer to the classical "fleshing out projections" tradition
than to modern sketch-to-CAD:

- Wesley and Markowsky (1981) reconstruct polyhedra from three orthographic
  views, including hidden-line reasoning;
- Markowsky and Wesley (1980) flesh out wire frames;
- Aldefeld (1983) recognizes 3D structures from 2D representations;
- Chen and Perng (1988) reconstruct 3D solid objects from 2D orthographic
  views.

These are the right ancestors for our constraint/correspondence stage. They
also reinforce a design rule: do not replace a complete, checkable 2D-to-3D
constraint pipeline with a learned image-to-sequence model. The classical
literature assumes exact line drawings and solves consistency; we do the same
with primitives, curves and diagnostics.

---

## 4. ML approaches

### 4.1 Input/output representation and data requirements

| System | Input | Output | Training data | Evaluation |
|---|---|---|---|---|
| DeepCAD | CAD command sequence (sketch/extrude) | Reconstructed/generated sequence | 178,238 models from ABC/Onshape | Command accuracy, parameter accuracy, chamfer distance, invalid ratio |
| CAD-Recode | Point cloud | Python CadQuery code | ~1M synthetic CAD sequences | Chamfer/F-score on DeepCAD, Fusion 360, CC3D; code executability |
| Text2CAD | Natural-language text | CAD command sequence | ~170K models, ~660K annotations from DeepCAD | Visual/parametric metrics |
| Img2CAD | Single RGB image | Discrete CAD structure + continuous parameters | 4,574 furniture models (chair/table/storage) | Image-to-CAD metrics on furniture categories |
| Sketch2CAD | Freehand sketch sequence + partial CAD context | CAD operation + parameters | ~400K synthetic train / 100K test | Operation recognition and parameter fit |
| BRepNet | B-rep faces/edges/coedges | Per-face segmentation | 35,680 Fusion 360 parts, 8 labels | IoU/segmentation accuracy |
| UV-Net | B-rep UV-grids + face-adjacency graph | Segmentation/classification | MFCAD, Fusion 360, SolidLetters | Accuracy/IoU |

The common data requirement is **large paired supervision**: 100K-1M CAD
sequences, point clouds, images or B-rep labels. Our `.edu` corpus is currently
about 151 hand-written sheets, designed for exact expectations, not for
gradient training. Building a drawing-to-feature dataset would require
synthetic rendering of orthographic views with exact feature labels, plus
hidden-line and dimension conventions; that is a project in itself.

### 4.2 Generalization

The ML systems generalize within their training distribution:

- DeepCAD/CAD-Recode/Text2CAD are dominated by sketch-extrude sequences from
  synthetic or Onshape-derived CAD; they do not model orthographic view
  conventions, dimensions, sections, hidden lines, or feature interactions in
  engineering drawings.
- Img2CAD is category-specific (furniture); it is not a mechanical-part
  recognizer.
- Sketch2CAD is interactive and assumes a partial CAD model as context; it is
  not a batch drawing interpreter.
- BRepNet/UV-Net assume a valid B-rep and learn modeling-operation labels, not
  geometric feature semantics with uncertainty.

None of them output "this recess is unresolved because the bottom edge is at
the wrong station" or "these two depth strokes are ambiguous". Their metrics
are geometric or label accuracy, not constraint provenance. That is a poor
match for an educational CAD tool whose value is explainable reconstruction.

### 4.3 Licensing

The ML ecosystem is mostly non-commercial:

- CAD-Recode: CC BY-NC 4.0 (code, weights, dataset);
- Text2CAD: CC BY-NC-SA 4.0;
- BRepNet: CC BY-NC-SA 4.0;
- Fusion 360 Gallery: non-commercial research only, no whole-dataset
  redistribution;
- ABC: copyright of creators, Onshape terms;
- Img2CAD/Sketch2CAD: MIT code, but datasets have upstream terms or no explicit
  license;
- DeepCAD: MIT code, data derived from ABC/Onshape.

Sharing a feature in a product that embeds these weights/data would require a
legal review and likely a commercial license. That is incompatible with the
current MIT, zero-dependency project.

### 4.4 Are ML sequence models relevant?

For the **core reconstruction pipeline**: no.

- The input is already structured 2D primitives with exact coordinates and
  view roles. A sequence model would discard that structure and introduce
  sampling ambiguity.
- The output must be a bounded analytic surface complex with source evidence
  and diagnostics. A token sequence or CadQuery program does not preserve the
  provenance we need.
- The project's differentiator is deterministic, checkable geometry. A learned
  prior would make failures harder to explain and regressions harder to test.

For **possible later auxiliaries**: maybe.

- A small learned ranker could order ambiguous candidate interpretations, but
  only after a deterministic candidate generator exists and a labeled corpus
  is available.
- A sketch/image front-end could propose primitives, but the existing drawing
  editor already provides exact primitives; an ML front-end is out of scope.
- A learned feature-hint classifier could help with heavily interacting
  features, but classical hint/MCS rules are a better first step and need no
  data.

Recommendation: **do not adopt ML for reconstruction or feature recognition
now.** Revisit only if a permissive, drawing-specific dataset and a clear
uncertainty interface appear.

---

## 5. Comparison matrix and recommendation

### 5.1 Matrix

Legend: ✅ good fit; ⚠️ partial/needs work; ❌ poor fit.

| Approach | Input fit | Output fit | Deterministic | Diagnostics | License fit | Dependency | Verdict |
|---|---|---|---|---|---|---|---|
| **Current Major pipeline** | ✅ exact 2D primitives/views | ✅ analytic surfaces + diagnostics | ✅ | ✅ specific codes | ✅ MIT | ✅ zero npm | Foundation. Extend, don't replace. |
| **Analysis Situs AAG/rules** | ❌ needs B-rep | ⚠️ face sets, not our records | ✅ | ⚠️ some | ✅ BSD-3 | ❌ C++/OCCT | Best idea source. Reimplement graph/convexity/cavity/hole/fillet rules. |
| **OCCT defeaturing** | ❌ needs B-rep | ⚠️ validation oracle | ✅ | ⚠️ kernel issues | ⚠️ LGPL | ❌ native/WASM | Offline validation only. |
| **CadQuery** | ❌ needs CAD code/STEP | ⚠️ test solids | ✅ | ❌ | ✅ Apache-2.0 (OCCT LGPL) | ❌ Python | Offline test-corpus generation only. |
| **DeepCAD** | ❌ sequence/point cloud | ❌ sequence | ⚠️ sampling | ❌ | ⚠️ code MIT/data unclear | ❌ PyTorch | Not for core. |
| **CAD-Recode** | ❌ point cloud | ❌ CadQuery code | ⚠️ sampling | ❌ | ❌ CC BY-NC | ❌ LLM/Python | Not for core. |
| **Text2CAD** | ❌ text | ❌ sequence | ⚠️ sampling | ❌ | ❌ CC BY-NC-SA | ❌ PyTorch | Not for core. |
| **Img2CAD** | ❌ single image/furniture | ❌ sequence | ⚠️ sampling | ❌ | ⚠️ MIT code/data caveats | ❌ PyTorch/VLM | Not for core. |
| **Sketch2CAD** | ❌ freehand + context | ❌ operation/params | ⚠️ sampling | ❌ | ⚠️ MIT code/data unclear | ❌ TensorFlow | Not for core. |
| **BRepNet/UV-Net** | ❌ valid B-rep | ⚠️ face labels | ⚠️ learned | ❌ | ❌/⚠️ NC or data restrictions | ❌ PyTorch/DGL | Offline baseline only, if ever. |
| **MFCAD/MFCAD++** | ❌ STEP B-rep | ✅ feature labels | n/a | n/a | ✅ MIT / CC BY | ❌ offline | Evaluation corpus only. |
| **Fusion 360 Gallery** | ❌ B-rep/sequences | ✅ segmentation labels | n/a | n/a | ❌ non-commercial | ❌ offline | Do not ship. |
| **ABC** | ❌ B-rep corpus | ⚠️ no feature labels | n/a | n/a | ❌ Onshape terms | ❌ offline | Do not ship. |

### 5.2 What to borrow now

1. **AAG structure**: nodes = analytic surfaces; arcs = shared boundary
   elements; arc attributes = convexity, dihedral angle, shared element IDs;
   node attributes = kind, area, inner-loop count, axial range, material side,
   source IDs.
2. **Edge convexity + smoothness**: exact for plane/plane; sampled with
   consistency checks for curved surfaces; `unknown` when material side is
   unresolved.
3. **Cavity seed/propagation**: inner-loop seed, propagate across known
   convexity, stop at another inner loop or base face, reject whole-shape
   propagation, size threshold, base faces.
4. **Surface-based hole grouping**: coaxial cylinders/cones, circular loops,
   through/blind/counterbore/countersink patterns, axis/radius/depth.
5. **Fillet candidate and chain rules**: cylinder/torus face, two
   smooth/tangent support transitions, radius/sweep, chain by shared tangent
   boundary/axis/radius.
6. **Hint-based diagnostics**: represent a partial feature as `hinted` with a
   specific missing constraint; complete/reject after other features.
7. **Defeaturing as an offline oracle**: validate candidates on STEP corpora
   by removal, closure and volume checks.

### 5.3 What to avoid

- Do **not** replace the deterministic pipeline with DeepCAD/CAD-Recode/
  Text2CAD/Img2CAD/Sketch2CAD.
- Do **not** ship or depend on non-commercial weights or datasets (CAD-Recode,
  Text2CAD, BRepNet, Fusion 360 Gallery, ABC).
- Do **not** add Python/PyTorch/OCCT as runtime dependencies. Keep the app
  zero-npm and browser-native.
- Do **not** copy Analysis Situs or OCCT code. Reimplement the algorithms from
  the papers/docs; if code is ever ported, preserve the BSD/LGPL notices.
- Do **not** treat `holes=` as a feature count. It is a display-loop count.
- Do **not** infer convexity from display normals without a material side.
- Do **not** add one recognizer per named solid. Keep the surface-family
  pipeline and express features as predicates over the complex.

### 5.4 Ranked recommendation

1. **Build the oriented surface-adjacency graph and convexity classifier**
   over `geometry.surfaces` / `Surfaces.incidence`. This is the enabling
   abstraction and the smallest useful change.
2. **Re-express existing recess/fillet records as graph predicates** and add
   `.edu` assertions. This validates the graph against known-good geometry
   before adding new feature classes.
3. **Add a generic cavity rule** (inner-loop seed + propagation + base faces +
   size threshold). This covers rectangular pockets, through-openings and
   arbitrary cavities that the current named readers miss.
4. **Add a coaxial-hole rule** (through/blind/counterbore/countersink) that
   reuses `cylindricalRecessEvidence` and extends it to multiple coaxial
   surfaces.
5. **Add fillet chains and hint-based interaction handling**, then use an
   offline MFCAD/MFCAD++ adapter to measure face-set and subtype accuracy.
6. **Only then consider ML**, and only for candidate ranking or a front-end,
   never as the source of truth.

---

## 6. Pseudocode and API sketch

### 6.1 Data model

The graph should be derived from the existing bounded model, not from display
triangles.

```text
SurfaceNode = {
  id: 'surface:<n>',
  surfaceIndex: n,
  kind: 'plane' | 'cylinder' | 'cone' | 'sphere',
  loops: [LoopRef],
  innerLoops: number,
  area: number | null,
  axialRange: {min, max} | null,
  materialSide: 'outside' | 'inside' | 'unknown',
  sourceIds: [entityId],
  featureTags: ['recess' | 'fillet' | 'closure' | ...]
}

LoopRef = {
  id: 'loop:<surface>:<index>',
  role: 'outer' | 'inner',
  elements: [BoundaryUse]
}

BoundaryUse = {
  boundaryId: 'c:<i>' | 'section:<n>' | 'line:<n>' | 'e:<a>_<b>',
  element: curve | line | vertexEdge | section,
  reversed: boolean,          // traversal direction relative to the element
  surfaceId,
  loopId
}

Arc = {
  id: 'arc:<a>_<b>',
  a: surfaceId,
  b: surfaceId,
  boundaryIds: [boundaryId],
  convexity: 'convex' | 'concave' | 'smooth' | 'unknown',
  dihedral: {angle, signed, samples, min, max} | null,
  tangent: boolean,
  sourceIds: [entityId]
}
```

`Surfaces.incidence(model)` already returns `uses` with `surfaceIds`,
`loopRefs`, `kind`, `element` and `useCount`. The extension needed is
`reversed` per use and a surface-pair aggregation. Do not duplicate the
incidence logic in a second module.

### 6.2 API

```js
// public/lib/educad-feature-graph.js (proposed; not implemented here)
EduCADFeatureGraph.build(geometry, options)
// -> {version:1, contract:'feature-graph-v1',
//     nodes, arcs, bySurface, diagnostics}

EduCADFeatureGraph.convexity(graph, arc, options)
// -> 'convex' | 'concave' | 'smooth' | 'unknown'

EduCADFeatureGraph.recognize(geometry, options)
// -> {features, hints, diagnostics, graph}

EduCADFeatureGraph.featuresOfKind(geometry, kind)
// -> feature records, for .edu assertions and previews
```

`options`:

```text
{
  tolerance: 1e-4,          // geometric tolerance, in drawing units
  smoothAngle: 1e-3,        // radians, G1 threshold
  maxCavitySize: Infinity,  // bounding-box diagonal
  minRadius: 0,
  maxRadius: Infinity,
  includeHints: true
}
```

Feature record:

```text
Feature = {
  id: 'feature:<n>',
  kind: 'hole' | 'cavity' | 'recess' | 'fillet' | 'chamfer' | 'boss',
  subtype: 'through' | 'blind' | 'counterbore' | 'countersink' |
           'spherical' | 'cylindrical' | 'chain' | 'pocket' | 'slot' | null,
  faces: [surfaceIndex],
  baseFaces: [surfaceIndex],
  boundaryLoops: [loopId],
  axis: {x,y,z} | null,
  radius: number | null,
  depth: number | null,
  through: boolean | null,
  chain: [featureId] | null,
  status: 'recognized' | 'hinted' | 'ambiguous',
  evidence: {arcIds, sourceIds, residuals, ...},
  diagnostics: [diagnosticCode],
  sourceIds: [entityId]
}
```

Keep the existing `geometry.recesses` and `geometry.fillets` records for
compatibility. The new feature records are a **view** over the same geometry,
not a second geometry construction.

### 6.3 Convexity pseudocode

```text
function edgeConvexity(surfaceA, useA, surfaceB, useB, tol):
  points = sampleBoundary(useA.element, max(3, sampleCount))
  signs = []
  for p in points:
    nA = outwardNormal(surfaceA, p)
    nB = outwardNormal(surfaceB, p)
    if nA == null or nB == null: return 'unknown'
    tA = boundaryTangent(useA, p)       // oriented on A's loop
    cross = cross(nA, nB)
    angle = atan2(norm(cross), dot(nA, nB))
    if angle <= smoothAngle: continue   // smooth sample
    s = dot(cross, tA)
    signs.push(s > tol ? +1 : s < -tol ? -1 : 0)
  if signs contains both +1 and -1: return 'unknown'  // inconsistent
  if all samples smooth: return 'smooth'
  if any 0 and no nonzero: return 'unknown'
  return majority(signs) > 0 ? 'convex' : 'concave'
```

Calibration tests:

| Shape | Expected |
|---|---|
| Box | All 12 edges convex. |
| Rectangular through-hole in a plate | Both rim loops: mouth edges convex; no bottom cap. |
| Rectangular blind pocket | Mouth edges convex; bottom edges concave. |
| Cylindrical through-hole | Both circular rims convex; cylinder-plane arcs smooth/tangent only where intended. |
| Cylindrical fillet | Cylinder-plane transitions smooth/tangent; tangent line distance equals radius. |

These expectations are hypotheses to calibrate, not axioms. The first test run
must confirm the sign convention and the effect of loop reversal.

### 6.4 Cavity rule pseudocode

```text
function recognizeCavities(graph, options):
  features = []
  visited = set()
  for node in graph.nodes where node.innerLoops > 0:
    if node.id in visited: continue
    seedLoop = firstInnerLoop(node)
    if not allKnown(seedLoop.arcs): continue
    region = {faces: [node], baseFaces: [], loops: [seedLoop]}
    queue = seedLoop.arcs
    while queue not empty:
      arc = queue.pop()
      neighbor = otherSurface(arc, region.faces)
      if neighbor == null: continue
      if neighbor.id in region.faces: continue
      if not isCavityTransition(arc): continue
      region.faces.add(neighbor)
      if neighbor.innerLoops > 0 and otherInnerLoopReached(neighbor, region):
        region.baseFaces.add(neighbor)
        break
      if size(region) > options.maxCavitySize: reject('feature-cavity-too-large')
      queue.push(adjacentArcs(neighbor))
    if region.faces covers entire component:
      reject('feature-cavity-whole-shape')
    else:
      visited.add(all region faces)
      features.push({kind:'cavity', faces: region.faces,
                     baseFaces: region.baseFaces, status:'recognized'})
  return features
```

`isCavityTransition(arc)` uses the calibrated convexity; do not hard-code
"concave" or "convex" until the calibration table is verified. The docs for
Analysis Situs describe convex inner-loop seeds; our orientation may define the
sign oppositely. The test is the authority.

### 6.5 Hole rule pseudocode

```text
function recognizeHoles(graph, options):
  cylinders = nodes where kind in {'cylinder','cone'}
  groups = groupByCoaxialAxis(cylinders, tol)
  for group in groups:
    loops = circularBoundaryLoops(group)
    if loops.length < 2: continue
    radii = uniqueRounded([n.radius for n in group], tol)
    if group has cone and cylinder:
      subtype = 'countersink'
    else if group has two cylinders with different radii:
      subtype = 'counterbore'
    else if loops form two open ends:
      subtype = 'through'
    else if one end has a planar cap:
      subtype = 'blind'
    else:
      hint('feature-hole-no-cap', group)
      continue
    axis = commonAxis(group)
    depth = axialSpan(loops)
    radius = min(radii)
    emit({kind:'hole', subtype, faces: group, axis, radius, depth,
          through: subtype == 'through'})
```

Reuse `cylindricalRecessEvidence` for the single-cylinder blind case; do not
reimplement the framed-mouth/depth-stroke logic.

### 6.6 Fillet rule pseudocode

```text
function recognizeFillets(graph, options):
  for node in nodes where kind in {'cylinder','torus'}:
    arcs = incidentArcs(node)
    smooth = arcs where convexity == 'smooth'
    if smooth.length < 2: continue
    supports = unique(otherSurface(arc) for arc in smooth)
    if supports.length != 2: continue
    if node.radius <= 0: continue
    sweep = boundarySweep(node)
    if not (0 < sweep < pi): continue
    if not tangentToBothSupports(node, supports): continue
    emit({kind:'fillet', faces:[node], radius:node.radius,
          adjacentSurfaces:supports, status:'recognized'})
  chain = groupFilletsBySharedTangentBoundaryOrAxis(features)
```

For our current cylindrical fillet, `geometry.fillets` already supplies
`tangentLines`, `adjacentSurfaces`, radius, sweep and length. The predicate
should verify those fields rather than reconstruct them. This is a low-risk
first integration.

### 6.7 Diagnostics

New codes should be specific and orthogonal to the existing ones:

| Code | Meaning |
|---|---|
| `feature-graph-nonmanifold` | A boundary has more than two surface uses. |
| `feature-graph-open` | A feature boundary is open; no closed shell. |
| `feature-convexity-unknown` | Material side or normals are insufficient. |
| `feature-cavity-too-large` | Cavity exceeds `maxCavitySize`. |
| `feature-cavity-whole-shape` | Propagation would consume the entire component. |
| `feature-cavity-no-base` | No base face caps the cavity. |
| `feature-hole-axis-mismatch` | Coaxial group disagrees on axis/position. |
| `feature-hole-no-cap` | No planar cap or second rim determines through/blind. |
| `feature-hole-radius-mismatch` | Cylinder radius and boundary loop disagree. |
| `feature-fillet-not-tangent` | Support transition is not smooth/tangent. |
| `feature-fillet-chain-ambiguous` | Several chain continuations fit. |
| `feature-overlap` | Two candidates claim the same face set. |

Keep `recess-*` and `fillet-*` for the existing readers. A feature record may
carry both an existing code and a graph code; do not rename existing codes
without a compatibility plan.

### 6.8 `.edu` evaluation plan

#### A. Extend the runner's properties

Add to `tools/edc.js` `topologyProperties` (implementation follow-up, not this
note):

```text
features, featureKinds, featureSubtypes, featureFaces, featureBaseFaces,
featureAxes, featureRadii, featureDepths, featureChains,
featureHints, featureGraphNodes, featureGraphArcs,
featureConvexity, featureUnknownConvexity
```

Keep `recesses`, `fillets`, `holes` unchanged.

#### B. Reuse existing sheets as regression anchors

| Script | New assertions |
|---|---|
| `spherical-recess.edu` | `featureKinds=recess featureSubtypes=spherical featureRadii=20 featureFaces=1` |
| `cylindrical-recess.edu` | `featureKinds=recess featureSubtypes=blind-cylindrical featureRadii=10 featureDepths=20 featureFaces=1` |
| `fillet-line-boundary.edu` | `featureKinds=fillet featureRadii=10 featureChains=1 featureFaces=1` |
| `through-hole.edu` | `featureKinds=cavity featureSubtypes=through` (the wall-face count is measured first) |
| `plate-hole.edu` | `featureKinds=cavity` or a hint; must not report a drilled hole. |

The `through-hole`/`plate-hole` expected face count must be derived from the
actual surface complex, not guessed. The first implementation should print the
graph and lock the count after inspection.

#### C. New positive sheets

| Script | Purpose | Expected |
|---|---|---|
| `circular-through-hole.edu` | Plate with one circular through hole | `featureKinds=hole featureSubtypes=through featureRadii=... featureDepths=plate thickness` |
| `counterbore.edu` | Two coaxial cylinders, larger shallow bore + smaller through hole | `featureKinds=hole featureSubtypes=counterbore featureRadii=...` |
| `countersink.edu` | Cone + cylinder | `featureKinds=hole featureSubtypes=countersink` |
| `blind-pocket.edu` | Rectangular pocket with planar bottom | `featureKinds=cavity featureSubtypes=pocket featureBaseFaces=1` |
| `fillet-chain.edu` | Two fillets meeting at a corner | `featureKinds=fillet featureChains=1 featureFaces=2` |
| `boss-vs-hole.edu` | Convex boss on a plate | No `cavity`; convexity classification must not invert. |
| `tangent-cylinder.edu` | Bare cylinder tangent to a plane, no blend | No `fillet`; `feature-fillet-not-tangent` or no candidate. |

#### D. New negative/ambiguity sheets

| Script | Purpose | Expected |
|---|---|---|
| `recess-depth-ambiguous.edu` | Two plausible depth spans | `recess-depth-ambiguous`; retained geometry |
| `recess-depth-conflict.edu` | Bottom edge at wrong station | `recess-depth-conflict` |
| `fillet-tangent-missing.edu` | One tangent edge absent | `fillet-tangent-missing`; no fillet record |
| `interacting-holes.edu` | Two intersecting holes | `feature-overlap` or `feature-hole-no-cap`; no silent merge |
| `open-cavity.edu` | Pocket open to a side | `feature-cavity-open`/`feature-cavity-no-base`; no false closed cavity |
| `profile-mouth-recess.edu` | Recess mouth in `PROFILE` | Existing unsupported diagnostic; no new false positive |

#### E. External benchmark (offline, optional)

Do not ship the dataset or adapter. A separate research script can:

1. load `MFCAD`/`MFCAD++` STEP files with CadQuery or pythonocc-core;
2. build the same `SurfaceNode`/`Arc` graph from the B-rep (faces, edges,
   convexity, coaxial groups);
3. run `EduCADFeatureGraph.recognize` on that graph;
4. compare face sets and subtypes with the dataset labels;
5. report per-class precision/recall, face-set IoU, axis/radius/depth error,
   and diagnostic rates.

This separates **algorithm evaluation** (on B-rep) from **drawing
reconstruction** (on `.edu`). It also avoids pretending that a STEP corpus is
a drawing corpus.

#### F. Acceptance criteria

- All existing `.edu` scripts still pass, including the 151-sheet surface
  suite.
- The graph is deterministic and independent of display tessellation.
- `featureGraphArcs` and convexity counts are stable across repeated runs.
- Existing `recesses`/`fillets` counts are unchanged.
- No clean sheet gains a new `unresolved` diagnostic.
- Every new feature has `sourceIds` tracing back to drawing entities.
- No dependency is added to `package.json`.

---

## 7. Licensing and dependency notes

### 7.1 This repository

Major is MIT-licensed (`LICENSE`, copyright 2026 makrand999). This note is
documentation only and adds no dependency.

### 7.2 If code is ported later

| Source | License | Obligation |
|---|---|---|
| Analysis Situs | BSD-3-Clause | Retain copyright/conditions/disclaimer; do not use the author's name to endorse. Reimplement rather than copy. |
| OCCT | LGPL-2.1 with OCCT exception | Dynamic linking is permitted; modifications to OCCT must be shared; provide relinking ability. Distribution of a WASM build needs care. |
| CadQuery | Apache-2.0 | Notice/patent terms; its OCCT dependency remains LGPL. |
| pythonocc-core | LGPL-3.0 | Same LGPL considerations. |
| occt-import-js / opencascade.js | LGPL-2.1 | Inherited OCCT terms; bundle notices and source offer. |
| replicad | MIT | MIT notice; OCCT LGPL still applies. |

### 7.3 Dataset/weight restrictions

| Asset | Restriction | Safe use here |
|---|---|---|
| DeepCAD code | MIT | Read/reference only; do not vendor data. |
| DeepCAD data | Derived from ABC/Onshape; no separate license in repo | Treat as research-only; do not redistribute. |
| CAD-Recode code/model/data | CC BY-NC 4.0 | Non-commercial; do not ship. |
| Text2CAD code/data | CC BY-NC-SA 4.0 | Non-commercial/share-alike; do not ship. |
| Img2CAD code/model | MIT | Could be used in research; model is furniture-specific. |
| Img2CAD dataset | MIT card, PartNet-derived | Check upstream terms before redistribution. |
| Sketch2CAD code | MIT | Research use; data license not explicit. |
| Fusion 360 Gallery | Non-commercial research only; no whole-dataset redistribution | Local benchmark only, if at all. |
| ABC | Copyright creators; Onshape terms | Do not redistribute; research use with caution. |
| BRepNet | CC BY-NC-SA 4.0 | Non-commercial; do not ship. |
| UV-Net code | MIT | Code reuse possible; datasets separate. |
| MFCAD | MIT | Permissive benchmark. |
| MFCAD++ | CC BY | Permissive benchmark with attribution. |

This is not legal advice. The safe default for the product is: **no external
dataset or model weights in the repository; no non-commercial asset in the
runtime; no copied code.**

---

## 8. Smallest next milestone

**Milestone: `feature-graph-v1` — oriented graph, convexity, and predicates
over existing feature records.**

Deliverables:

1. A function that builds nodes/arcs from `geometry.surfaces` using
   `Surfaces.incidence`; no new geometry and no new dependency.
2. An orientation-aware boundary use (`reversed`) and a `materialSide` field.
3. A convexity classifier for plane/plane and plane/cylinder at minimum;
   `unknown` elsewhere.
4. Predicates that re-express the existing `geometry.recesses` (spherical and
   cylindrical) and `geometry.fillets` (cylindrical) as graph features.
5. `.edu` assertions on the existing feature sheets, plus a graph JSON dump
   for debugging.
6. A calibration sheet for box / through-hole / blind pocket convexity signs.

Explicit non-goals for this milestone:

- no generic cavity or hole rule yet;
- no new recess/fillet geometry;
- no Boolean subtraction;
- no STEP import;
- no ML;
- no change to the public `reconstruct` contract.

Why this is the smallest useful step: it proves the graph, orientation and
convexity on geometry that already has exact expectations, before adding
feature classes that could regress the surface suite.

The follow-up milestone is **`feature-cavity-v1`**: inner-loop seed,
propagation, base faces and size threshold, tested on rectangular
pockets/through-openings. After that, **`feature-hole-v1`**: coaxial
cylinder/cone grouping, through/blind/counterbore/countersink.

---

## 9. Unverified claims and verification status

The following are deliberately flagged rather than presented as certain.

1. **DeepCAD data license.** The code repository is MIT. The README says the
   data was parsed from Onshape public documents with links from ABC. No
   separate data license file was found. Do not assume the 178,238-model
   dataset is MIT.
2. **Sketch2CAD training-data license.** The code is MIT; the data README
   gives download links but no explicit data license. Treat the dataset as
   research-only.
3. **Img2CAD dataset license.** The Hugging Face dataset card declares MIT,
   but the data is PartNet-derived. Upstream PartNet/ShapeNet terms were not
   audited. The paper reports 4,574 furniture models; that count comes from
   the dataset card, not a line-by-line audit.
4. **Fusion 360 Gallery code license.** The repository's `LICENSE.md` is a
   dataset license (non-commercial research, no whole-dataset redistribution).
   The tools' source-code license is not clearly separated in the files read.
   Treat the repository as research-only.
5. **ABC license.** The ABC page says copyright is owned by the model creators
   and points to Onshape Terms of Use 1.g.ii. The exact practical scope
   (redistribution, commercial use, derived models) was not legally analyzed.
6. **MFCAD class count.** The repository README does not state 24 classes; the
   count comes from the Hierarchical CADNet paper and secondary sources. The
   MFCAD++ count (59,665 models, 24 classes, 3-10 features/model) comes from
   the QUB dataset page and paper.
7. **OCCT feature recognition.** OCCT provides feature construction and
   defeaturing (`BRepFeat_*`, `BRepAlgoAPI_Defeaturing`), but no general
   AAG-based feature recognizer was found in the public documentation. This is
   a negative claim based on the docs reviewed, not an exhaustive source
   audit. Analysis Situs explicitly exists to add feature recognition logic to
   OCCT.
8. **Analysis Situs algorithm details.** The descriptions are from its public
   documentation, not a line-by-line code audit. The exact convexity sign
   convention in its AAG may differ from the convention proposed here; our
   calibration tests are the authority for our model.
9. **OCCT 8.0.1 release date.** The GitHub release page shows "30 Jul" and the
   tag sequence `V8_0_1`; the year 2026 is inferred from the current date and
   tag context, not printed unambiguously in the fetched text.
10. **Analysis Situs version.** `v2026.1.1` is the latest tag found; the docs
    pages fetched describe the 2026.1 feature set. Tag-to-doc drift is
    possible.
11. **CAD-Recode v1.5 date.** The README says March 2025; the tag is `v1.5`.
    The exact release date was not independently verified.
12. **Text2CAD dataset license.** The repository `LICENSE` is CC BY-NC-SA 4.0.
    The Hugging Face dataset is gated (HTTP 401 without auth), so the dataset
    card itself was not read.
13. **`holes=` semantics.** The claim that `holes` counts display face inner
    loops, not features, is based on `tools/edc.js` `topologyProperties` and
    the observed `through-hole.edu`/`plate-hole.edu` outputs, not on a formal
    schema statement.
14. **Through-hole face count for the new feature assertion.** The expected
    number of cavity wall faces must be measured from the graph; the question
    mark in the table is intentional.
15. **Convexity signs.** The box/slot/hole/pocket expectations in §6.3 are
    hypotheses for calibration. No sign was assumed in the pseudocode; the
    implementation should derive it once and lock it with tests.

---

## 10. References

### Local files

- `docs/PRIMITIVE_RECONSTRUCTION.md` — pipeline contract, curve/surface stage,
  recess/fillet limitations.
- `docs/SURFACE_COMPLEX.md` — bounded analytic surface complex, incidence,
  split/trim/attach, feature-as-predicate direction.
- `docs/SURFACE_MODEL.md` — analytic surface model and operations.
- `public/lib/educad-reconstruct.js` — public `reconstruct` entry point,
  diagnostics, planar/ruled surface integration.
- `public/lib/educad-curve-reconstruct.js` — sphere, spherical/cylindrical
  recess, cylindrical fillet, oblique curves, NURBS.
- `public/lib/educad-surfaces.js` — `build`, `validate`, `certify`,
  `incidence`, `section`, `intersect`, `trim`, `split`, `attachBoundary`.
- `tools/edc.js` — `.edu` runner and `topologyProperties`.
- `tools/scripts/spherical-recess.edu`, `cylindrical-recess.edu`,
  `fillet-line-boundary.edu`, `through-hole.edu`, `plate-hole.edu`.

### Classical feature recognition and reconstruction

- Joshi, S., & Chang, T.-C. (1988). Graph-based heuristics for recognition of
  machined features from a 3D solid model. *Computer-Aided Design*, 20(2),
  58-66. <https://doi.org/10.1016/0010-4485(88)90050-4>
- Vandenbrande, J. H., & Requicha, A. A. G. (1993). Spatial reasoning for the
  automatic recognition of machinable features in solid models. *IEEE TPAMI*,
  15(12), 1269-1285. <https://doi.org/10.1109/34.250845>
- Gao, S., & Shah, J. J. (1998). Automatic recognition of interacting
  machining features based on minimal condition subgraph. *Computer-Aided
  Design*, 30(9), 727-739.
  <https://doi.org/10.1016/S0010-4485(98)00033-5>
- Han, J., Pratt, M., & Regli, W. C. (2000). Manufacturing feature recognition
  from solid models: a status report. *IEEE Transactions on Robotics and
  Automation*, 16(6), 782-796.
  <https://doi.org/10.1109/70.897789>
- Venkataraman, S., Sohoni, M., & Rajadhyaksha, R. (2002). Removal of blends
  from boundary representation models. *Proceedings of the Seventh ACM
  Symposium on Solid Modeling and Applications*, 83-94.
  <https://doi.org/10.1145/566282.566297>
- Slyadnev, S. E., & Turlapov, V. E. (2020). Simplification of CAD models by
  automatic recognition and suppression of blend chains. *Programming and
  Computer Software*, 46, 233-243.
  <https://doi.org/10.1134/S0361768820030081>
- Slyadnev, S., Malyshev, A., Voevodin, I., & Turlapov, V. (2020). On the role
  of graph theory apparatus in a CAD modeling kernel. *GraphiCon 2020*.
  <https://doi.org/10.51130/graphicon-2020-2-3-70>
- Thakur, A., Banerjee, A. G., & Gupta, S. K. (2009). A survey of CAD model
  simplification techniques for physics-based simulation applications.
  *Computer-Aided Design*, 41(2), 65-80.
  <https://doi.org/10.1016/j.cad.2008.11.009>
- Wesley, M. A., & Markowsky, G. (1981). Fleshing out projections. *IBM
  Journal of Research and Development*, 25(6), 934-954.
  <https://doi.org/10.1147/rd.256.0934>
- Markowsky, G., & Wesley, M. A. (1980). Fleshing out wire frames. *IBM
  Journal of Research and Development*, 24(5), 582-597.
  <https://doi.org/10.1147/rd.245.0582>
- Aldefeld, B. (1983). On automatic recognition of 3D structures from 2D
  representations. *Computer-Aided Design*, 15(2), 59-64.
  <https://doi.org/10.1016/0010-4485(83)90169-0>
- Chen, Y., & Perng, D. (1988). Automatic reconstruction of 3D solid objects
  from 2D orthographic views. *Pattern Recognition*, 21(5), 439-449.
  <https://doi.org/10.1016/0031-3203(88)90003-9>

### Analysis Situs and OCCT

- Analysis Situs, `v2026.1.1`, BSD-3-Clause.
  <https://gitlab.com/ssv/AnalysisSitus>
- Analysis Situs feature recognition principles.
  <https://analysissitus.org/features/features_recognition-principles.html>
- Analysis Situs AAG.
  <https://analysissitus.org/features/features_aag.html>
- Analysis Situs cavity recognition.
  <https://analysissitus.org/features/features_recognize-cavities.html>
- Analysis Situs drilled-hole recognition.
  <https://analysissitus.org/features/features_recognize-drill-holes.html>
- Analysis Situs fillet/chamfer recognition.
  <https://analysissitus.org/features/features_recognize-fillets.html>
- Open CASCADE Technology `V8_0_1`, LGPL-2.1 with exception.
  <https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8_0_1>
- OCCT modeling algorithms documentation.
  <https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html>

### ML systems and datasets

- Wu, R., Xiao, C., & Zheng, C. (2021). DeepCAD: A Deep Generative Network for
  Computer-Aided Design Models. *ICCV 2021*, 6752-6762.
  <https://doi.org/10.1109/ICCV48922.2021.00670>
  Code: <https://github.com/ChrisWu1997/DeepCAD> (MIT).
- Rukhovich, D., Dupont, E., Mallis, D., Cherenkova, K., Kacem, A., &
  Aouada, D. (2025). CAD-Recode: Reverse Engineering CAD Code from Point
  Clouds. *ICCV 2025*, 9801-9811. <https://arxiv.org/abs/2412.14042>
  Code: <https://github.com/filaPro/cad-recode> (CC BY-NC 4.0).
- Khan, M. S., Sinha, S., Sheikh, T. U., Stricker, D., Ali, S. A., & Afzal,
  M. Z. (2024). Text2CAD: Generating Sequential CAD Designs from
  Beginner-to-Expert Level Text Prompts. *NeurIPS 2024*, 7552-7579.
  <https://arxiv.org/abs/2409.17106>
  Code: <https://github.com/SadilKhan/Text2CAD> (CC BY-NC-SA 4.0).
- You, Y., Uy, M. A., Han, J., Thomas, R., Zhang, H., Du, Y., Chen, H.,
  Engelmann, F., You, S., & Guibas, L. (2025). Img2CAD: Reverse Engineering 3D
  CAD Models from Images through VLM-Assisted Conditional Factorization.
  *SIGGRAPH Asia 2025*. <https://doi.org/10.1145/3757377.3763891>
  Code: <https://github.com/qq456cvb/Img2CAD> (MIT).
- Li, C., Pan, H., Bousseau, A., & Mitra, N. J. (2020). Sketch2CAD: Sequential
  CAD Modeling by Sketching in Context. *ACM Transactions on Graphics*,
  39(6), 164:1-164:14. <https://doi.org/10.1145/3414685.3417807>
  Code: <https://github.com/Enigma-li/Sketch2CAD> (MIT).
- Willis, K. D. D., Pu, Y., Luo, J., Chu, H., Du, T., Lambourne, J. G.,
  Solar-Lezama, A., & Matusik, W. (2021). Fusion 360 Gallery: A Dataset and
  Environment for Programmatic CAD Construction from Human Design Sequences.
  *ACM Transactions on Graphics*, 40(4), 1-24.
  <https://doi.org/10.1145/3450626.3459818>
  Dataset: <https://github.com/AutodeskAILab/Fusion360GalleryDataset>
  (non-commercial research license).
- Koch, S., Matveev, A., Jiang, Z., Williams, F., Artemov, A., Burnaev, E.,
  Alexa, M., Zorin, D., & Panozzo, D. (2019). ABC: A Big CAD Model Dataset for
  Geometric Deep Learning. *CVPR 2019*.
  <https://arxiv.org/abs/1812.06216>
  Dataset: <https://deep-geometry.github.io/abc-dataset/> (copyright creators;
  Onshape terms).
- Lambourne, J. G., Willis, K. D. D., Jayaraman, P. K., Sanghi, A., Meltzer,
  P., & Shayani, H. (2021). BRepNet: A Topological Message Passing System for
  Solid Models. *CVPR 2021*, 12768-12777.
  <https://doi.org/10.1109/CVPR46437.2021.01258>
  Code: <https://github.com/AutodeskAILab/BRepNet> (CC BY-NC-SA 4.0).
- Jayaraman, P. K., Sanghi, A., Lambourne, J. G., Willis, K. D. D., Davies,
  T., Shayani, H., & Morris, N. (2021). UV-Net: Learning from Boundary
  Representations. *CVPR 2021*, 11698-11707.
  <https://doi.org/10.1109/CVPR46437.2021.01153>
  Code: <https://github.com/AutodeskAILab/UV-Net> (MIT; datasets separate).
- Colligan, A. R., Robinson, T. T., Nolan, D. C., Hua, Y., & Cao, W. (2022).
  Hierarchical CADNet: Learning from B-Reps for Machining Feature Recognition.
  *Computer-Aided Design*, 147, 103226.
  <https://doi.org/10.1016/j.cad.2022.103226>
  MFCAD: <https://github.com/hducg/MFCAD> (MIT).
  MFCAD++: <https://doi.org/10.17034/d1fec5a0-8c10-4630-b02e-b92dc81df823>
  (CC BY).

### Tooling

- CadQuery `v2.8.0`, Apache-2.0. <https://github.com/CadQuery/cadquery>
- pythonocc-core `8.0.1.2`, LGPL-3.0.
  <https://github.com/tpaviot/pythonocc-core>
- occt-import-js `0.0.23`, LGPL-2.1.
  <https://github.com/kovacsv/occt-import-js>
- opencascade.js, LGPL-2.1. <https://github.com/donalffons/opencascade.js>
- replicad `v1.2.1`, MIT (OCCT LGPL).
  <https://github.com/sgenoud/replicad>

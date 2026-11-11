# Multi-view correspondence, robust fitting and surface reconstruction

Status: research and design report. This document changes no production code.
Scope: **Major**, the original EduCAD interface. Major2 is out of scope.

Baseline inspected: `43d3b7f` (`Document cylindrical fillet and line boundary support`).
At that commit all 151 `.edu`/`.edc` scripts pass through `node tools/edc.js`.

The question is narrow: what can OSS multi-view geometry, robust estimation and
surface reconstruction teach EduCAD about **correspondence robustness, ambiguity
resolution, and consensus across three orthographic views**? This is not a
proposal to replace the exact projection kernel with photogrammetry. It is a
proposal to add a robust *selection and diagnostic* layer around the exact
constraints that already work.

---

## 0. Short answer

1. EduCAD's exact orthographic kernel is stronger than a perspective
   bundle-adjustment pipeline for exact drawings. Do not replace it.
2. The most valuable imports are **bookkeeping ideas**, not solvers:
   correspondence graphs/tracks, unique-evidence accounting, truncated robust
   costs, ternary third-view votes, and explicit ambiguity/outlier records.
3. Random RANSAC is a poor primary fit for this problem: the candidate sets are
   small, structured and deterministic, and the test suite requires stable
   output. Prefer **exhaustive or branch-and-bound consensus**.
4. Use RANSAC/LMedS/IRLS only where they genuinely help: robust conic fitting,
   broken curve chains, and continuous refinement of free parameters.
5. Add a **two-lane** pipeline: an exact/declared lane that keeps the rational
   certificate, and an inferred/robust lane that may refine free parameters but
   never certifies them as exact.
6. The first milestone should be a pure **Consensus v0** scorer that changes no
   geometry, only metadata and diagnostics. It is the smallest change that
   addresses ambiguity and outlier reporting.

---

## 1. Our current correspondence and fitting methods

### 1.1 The projection model

EduCAD uses a fixed orthographic Monge frame. Let a spatial point be
`(x, h, d)` in millimetres: sheet abscissa, height above HP, and depth in front
of VP. The renderer stores it as `{x, y: h, z: d}`.

The projections are exactly:

```text
front / ELEVATION :  (u, v) = (x, h)
top   / PLAN      :  (u, v) = (x, -d)
side  / PROFILE   :  (u, v) = (xRef + s * (d - dRef), h),  s in {-1, +1}
```

The inverse observations are:

```text
front : x = u,        h = v
top   : x = u,        d = -v
side  : d = dRef + s * (u - xRef),  h = v
```

This is stated in `docs/RECONSTRUCTION_CONTRACT.md` and implemented in
`public/lib/educad-strict.js` and `public/lib/educad-project.js`.

Two independent views determine all three coordinates for observations that are
actually the same spatial point; a side view additionally needs a declared frame
`{xRef, dRef, s}`. Repeating one view does not determine the missing coordinate.
The strict kernel never estimates a side frame from drawing bounds.
The curve/oblique stage may infer a frame from the drafting layout convention
and marks the result `profileInferred`, but that is an inferred, non-certified
result.

### 1.2 The exact lane: identity, not fitting

The exact lane is unusual compared with photogrammetry: it does not estimate
camera parameters, and it does not minimize a reprojection error. It solves a
system of **coordinate equalities**.

A `POINT` station has `meta.members: [{id, name, hidden}, ...]`. A member ID is
the spatial identity. One station can hold several members; one member can occur
in several stations. The strict solver collects, for each member, all equations
fixing `x`, `h`, or `d`:

1. If two observations fix the same coordinate to different values, the result
   is `inconsistent`.
2. If an axis is unassigned, the result is `underdetermined`.
3. If all three axes are assigned consistently, the vertex is unique.

`educad-strict.js` implements this with exact decimal rationals: `exact(value)`
parses `String(value)` into normalized `BigInt` pairs. There is no welding
radius, no averaging, no snapping and no hidden geometric tolerance in the
kernel. A stored `0.30000000000000004` conflicts with a stored `0.3`, even
though the difference is below any practical drawing tolerance. That exactness
is deliberate: the certificate is a statement about the stored decimal model,
not about the author's intended real measurement.

The automatic compatibility adapter is separate. `autoMembersForStrict` links
auto-labelled stations by base name when their projection equations agree:

```text
plan + elevation : same x
plan + profile   : same depth through the declared side frame
elevation + profile : same height
all three        : every shared equation agrees
```

It is one-to-one at the shared station: a candidate links only when it is the
only match in its view and the only match back from the other view. A profile
link requires an explicit frame in the strict path. Contradictory or ambiguous
candidates stay separate; coordinates are never averaged. This is a
compatibility fallback, not an explicit identity operation.

The live builder (`liveCore`) is more permissive: it pairs a plan point and an
elevation point by base name, the same `x` station, and a drawn projector line
that physically covers both dots. Unnamed points pair only when exactly one
candidate per side shares station and line. Edges are emitted only when both
views provide evidence. `viewCoverage` samples five points per drawn segment
and counts a point-only observation once; the acceptance gate is `0.999`.
`weldTolerance` is `diagonal * 1e-4`, clamped to `[1e-6, 0.5]` mm.

The exact lane is therefore a **constraint satisfaction and proof** system, not
a robust estimator. This is a strength, and it must remain the final authority
for declared geometry.

### 1.3 Curve correspondence

`public/lib/educad-curve-reconstruct.js` handles the first curve families:

- A circle or circular arc seen in true shape in one principal view and edge-on
  in a paired view. Plan/front, plan/side and front/side pairs are rotated into
  one canonical two-view problem.
- A full circle plus a slanted edge-on trace gives an inclined elliptical
  boundary; two matching silhouette generators give a truncated cylinder.
- Coaxial circular boundaries plus two corroborating straight generators give a
  ruled patch. Equal radii, unequal radii and chains use the same operation.
- Two generators meeting at a common point support a collapsed boundary (apex).
- Equal full circles in two or more views are sphere silhouettes.
- A full circular mouth plus a rim-to-rim silhouette arc is a spherical recess.
- A full circular mouth in a framed face, plus edge-on depth strokes and an
  exact bottom edge, is a cylindrical recess.
- A true-shape tangent arc plus two tangent face edges and paired
  generator/end lines is a cylindrical fillet.
- An open elliptical segment chain with at least 12 stations is fitted with a
  normalized conic and lifted as an analytic arc.

The two-view matching itself is interval-based. Horizontal or slanted edge-on
strokes are merged into runs, including split and overlapping strokes. A curve
matches a run when the projected extent equals the run extent within `EPS =
1e-6`; if no exact extent match exists, a single run that *covers* the
projected span is accepted as a fallback. A linked centre point can constrain
the missing coordinate. When several runs match, every candidate is retained
and reported ambiguous if no further evidence selects one.

The important selection logic is `candidateSupport`. It scores a two-view
interpretation against **all declared views**:

- For each resulting 3D curve, project it into PLAN, ELEVATION and PROFILE.
- A view with a covering stroke contributes `covered`.
- A view with a collinear stroke that does not cover the projection contributes
  `contradicted`.
- A view with no matching stroke is `silent` and does not vote.

The candidates are then sorted lexicographically:

```text
more consumed curves
fewer contradictions
more covering views
fewer speculative curve instances
more consumed source IDs
```

The loop consumes the best candidate and repeats, so a third view can select the
real levels instead of reconstructing the full cross-product. When several
distinct source projections each produce several levels and no view selects a
pairing, the supported curves are retained with `curve-projection-ambiguous`
rather than silently certifying the cross-product.

This is already a ternary consensus model. It is the closest existing code to
the recommended design. Its weaknesses are that it is local to the curve stage,
uses a lexicographic sort rather than a principled evidence score, and does not
count unique source evidence explicitly.

### 1.4 Oblique circles and arcs

`public/lib/educad-oblique-kernel.js` handles a circle in a general plane:

1. Collect closed or open elliptical loops from segment graphs. A loop must have
   degree 1 or 2 at every node, at least 12 segments (32 for line pairing), and
   a valid fit.
2. For a closed loop, `fitEllipse` estimates the centre and axes from the sample
   covariance matrix. It accepts a maximum normalized algebraic error of
   `0.08`.
3. For an open arc, `fitArcEllipse` fits a normalized conic by ordinary least
   squares on the five-coefficient conic and converts it to centre/axes. It
   accepts a maximum normalized algebraic error of `0.02`.
4. `normalFromLoop` recovers the plane normal from the major/minor axis ratio.
   A full ellipse leaves the sign of the viewing-axis component open, so
   `normalCandidates` returns the normal and its mirror.
5. Two views are paired when their normal candidates agree within
   `samePlane` (`|dot| >= 0.9998`, about 1.15 degrees). Centres are merged from
   the two loops, or from a loop plus a straight edge-on run.
6. Linked boundary points can select a remaining mirror. Their recovered 3D
   positions must lie on the circle and its plane within
   `max(0.5, 0.02 * radius)` mm.
7. Visible/hidden strokes can select a mirror using sampled visibility at three
   interior stations per source segment, tested against independent straight
   occluders.

This is a strong analytic construction, but the fitting is not robust:

- `fitEllipse` is covariance/PCA fitting; it assumes a reasonably uniform,
  closed, full-ring sample. A single bad station or a strongly non-uniform
  sample can bias the axes.
- `fitArcEllipse` is ordinary algebraic least squares. It is not ellipse-specific
  in the Fitzgibbon sense, and it has no outlier trimming.
- Acceptance is a **normalized algebraic** residual (`0.08`, `0.02`), not a
  geometric distance in millimetres. The same tolerance means different physical
  errors at different drawing scales.
- There is no parameter covariance or uncertainty propagation. The hard
  `0.9998` normal agreement can reject a true pair when the ellipse is nearly
  circular, because the minor-axis direction and ratio are ill-conditioned
  there.
- The point/visibility gates use fixed tolerances and coarse sampling.

### 1.5 Parametric station curves

`public/lib/educad-parametric-reconstruct.js` treats interpolated curves with
the same station count and closure as a correspondence family. Every cross-view
pair proposes a full 3D station sequence by combining the coordinates each view
supplies. A proposal is supported by any curve whose projected stations match
it. The family is partitioned into spatial curves with at most one source curve
per view.

Order can be reversed; a closed curve may start at any station. Shared member
IDs are authoritative; suffix-stripped names are the fallback. A group is
identity-consistent when no station identity appears at two different parameter
positions. Candidate groups are scored by

```text
identityScore = 1000000 * sharedMemberIdHits + sharedBaseNameHits
```

then by source order, then by a canonical geometry key. A full partition is
required; a contradictory third view cannot be dropped in favour of a two-view
pair. Equally strong partitions with different geometry report
`curve-correspondence-ambiguous`; a family that cannot be partitioned reports
`curve-correspondence-conflict`; a curve with no compatible second view reports
`curve-correspondence-missing`. The enumeration cap is 512 solutions.

This is a global discrete partition for one curve family, but it is
all-or-nothing: an unmatched or contradictory member blocks the other curves in
the same station-count/closure family. It also has no notion of partial
evidence, outlier strokes, or a score margin.

### 1.6 Planar and surface inference

`public/lib/educad-reconstruct.js` infers planar faces from the reconstructed
wire:

- `supportingPlanes` groups edges by supporting plane.
- `traceOuterFace` extracts the maximal outer boundary of each connected planar
  component.
- `selectManifoldFaces` solves independent face/edge constraint groups by
  branch-and-bound. It prefers closed shells, then manifold surfaces with
  boundary. It has a 250,000-step cap; exhausted or tied searches return no
  faces and report `search-limit` or `ambiguous-surface`.

`public/lib/educad-surfaces.js` builds the bounded analytic model from
`surfacePatches` and exposes `build`, `validate`, `certify`, `incidence`,
`section`, `intersect`, `trim`, `split`, `attachBoundary`, `shareBoundary` and
`intersectionCurves`. Validation and certification sample boundary curves and
straight elements against their surface. `surfaceTolerance` is
`1e-5 * max(1, radius)` mm; `surfaceResidual` is family-specific. The
certificate has exact decimal-rational checks where the predicate permits and
explicitly marked numeric tolerance checks elsewhere.

Surface inference is currently local and pairwise:

- Coaxial boundary pair + two generators -> cylinder/cone.
- Circle silhouette(s) -> sphere.
- Mouth + silhouette arc -> spherical recess.
- Mouth + face frame + depth strokes + bottom edge -> cylindrical recess.
- Tangent arc + tangent face edges + generators -> cylindrical fillet.
- Tangent generator pair + base circle -> inclined cone.

There is no global score over alternative surface families and no robust
refinement of surface parameters. A pair/generator check either passes or
reports a specific conflict.

### 1.7 Where the current methods are strong and weak

| Area | Current behavior | Consequence |
|---|---|---|
| Exact projection | Rational coordinate equalities; no calibration | Stronger than BA for exact drawings |
| Identity | Member IDs authoritative; no averaging | Auditable and exact |
| Third-view vote | Ternary covered/contradicted/silent for curves | Already the right idea; local to curves |
| Curve matching | Interval extent + covering fallback | Good for clean drawings; brittle for hand jitter |
| Ellipse fit | Covariance / algebraic OLS; normalized error | Not robust; tolerance not in mm |
| Candidate selection | Lexicographic sort of local pairs | No global objective; cross-products reported, not ranked |
| Straight/point consensus | One-to-one unique match; no ternary vote | Ambiguity often becomes "missing" |
| Parametric curves | Full partition, 512 cap | Correct but all-or-nothing |
| Planar faces | Branch-and-bound over face subsets | Precedent for global discrete search |
| Surface families | Analytic and bounded | Strong; but no hypothesis scoring/refinement |
| Diagnostics | Specific codes, partial results | Good foundation; lacks outlier/ambiguity taxonomy |
| Noise model | Fixed tolerances; no σ estimate | Same tolerance for clean and hand-drawn sheets |
| Dimensions/sections | Filtered as annotations; not used as constraints | Missed tie-breaker for ambiguity |

The gaps that matter for this report are therefore:

1. **No shared evidence model.** Curves, points, edges and surfaces each decide
   locally with different rules.
2. **No unique-evidence accounting.** A hypothesis can look strong because the
   same source stroke or curve is counted repeatedly.
3. **No global partition for straight/point candidates.** The exact kernel
   solves one declared assignment; the live builder uses unique matching; neither
   ranks alternative assignments.
4. **No robust continuous fitting.** Ellipse/arc/surface parameters are fitted
   once by OLS/PCA, with no IRLS, LMedS or covariance.
5. **No principled ambiguity margin.** "Several candidates" is a count, not a
   score difference with a missing-constraint explanation.

---

## 2. OSS algorithms

### 2.1 Correspondence graphs and tracks

**COLMAP 4.0.0.** `CorrespondenceGraph` stores image-to-image and
feature-to-feature correspondences. `AddTwoViewGeometry` stores the inlier
matches of a robust two-view model. `ExtractTransitiveCorrespondences` performs
a breadth-first closure over correspondences up to a requested transitivity.
`Track` is the set of observations of one 3D point. `IncrementalTriangulator`
turns correspondence sets into points: it triangulates with RANSAC, keeps the
inlier mask, creates a `Track`, then merges and completes tracks. For short
tracks it deliberately uses exhaustive sampling
(`NChooseK(points.size(), 2)`) instead of random sampling. This is an important
precedent: when the candidate set is small, exhaustive beats random.

**OpenMVG 2.1.** `openMVG/tracks` implements unordered feature tracking by
union-find. `TracksBuilder::Build` fuses pairwise matches; `Filter` removes
tracks that are too short or contain multiple observations in one image
("forks"). The docs describe it as an efficient union of all pairwise
correspondences. This is almost exactly the shape of EduCAD's member/station
grouping, except EduCAD currently has no explicit fork filter and no
"minimum track length" policy.

**AliceVision 3.3.7.** `TracksBuilder` uses Lemon's union-find. Its
`filter(clearForks = true, minTrackLength = 2)` removes tracks with an ID
collision in one view or insufficient observations. The incremental SfM pipeline
fuses matches into tracks, removes incoherent tracks, chooses an initial pair,
resects new views with PnP in a RANSAC framework, triangulates, runs bundle
adjustment, and filters observations with high reprojection error or
insufficient angles.

**Transfer.** A spatial entity is a track. A valid track has at most one
observation per view (unless the drawing explicitly declares coincident distinct
members). EduCAD's member IDs already provide the track identity; what is
missing is:
- a fork diagnostic,
- a unique-evidence rule,
- a merge/complete policy for partial tracks.

### 2.2 The RANSAC family and consensus models

| Estimator | Model of the data | Score | Threshold | Useful for EduCAD? |
|---|---|---|---|---|
| RANSAC | Inliers + random gross outliers | Inlier count | Fixed residual threshold | Only for conic/primitive fitting from noisy samples |
| MSAC | Inliers + truncated outliers | Truncated quadratic cost | Fixed, but soft | Yes: best match for coverage/contradiction scoring |
| MLESAC | Inlier Gaussian + uniform outlier | Negative log likelihood | Estimated | Maybe: needs a noise model and enough samples |
| LMedS | Up to 50% outliers | Median squared residual | Derived from robust σ | Yes for ellipse/arc fitting with bad stations |
| ACRANSAC | A contrario background model | NFA (number of false alarms) | Automatic | Interesting, but the search space is hard to define for drawings |
| LO-RANSAC | Inliers refined locally | Inlier count after IRLS/LS | Fixed | Yes for continuous curve/surface refinement |
| Unique-inlier RANSAC | One vote per 3D entity | Unique inliers + residual | Fixed | Yes: prevents cross-product double counting |

**COLMAP.** `RANSACOptions` takes `max_error` as the maximum inlier error; the
estimator residual is a squared error, so it is compared to `max_error^2`.
Defaults are `min_inlier_ratio = 0.1`, `confidence = 0.99`,
`dyn_num_trials_multiplier = 3.0`, `random_seed = -1`, `num_threads = 1`.
`ComputeNumTrials` uses the exact hypergeometric probability of drawing an
all-inlier minimal sample, not the simpler `inlier_ratio^sample_size`
approximation. `LORANSAC` adds up to ten recursive local-optimization trials,
refitting from the current inlier set and keeping the result only if support
improves. `InlierSupportMeasurer` prefers more inliers, then a smaller residual
sum. `UniqueInlierSupportMeasurer` prefers more unique inliers. The
`MEstimatorSupportMeasurer` is MSAC: inlier residuals are summed, outlier
residuals contribute the threshold. `TriangulationEstimator` uses two-view
minimal samples, angular or reprojection residuals, a minimum triangulation
angle and a cheirality check. `EstimateTriangulation` wraps it in LORANSAC.
`TwoViewGeometryOptions` defaults to 4 px, confidence 0.999, 100 to 10,000
trials, minimum inlier ratio 0.25, and checks homography degeneracy and
watermark/translation degeneracies.

**OpenMVG.** `MaxConsensus` is the naive fixed-iteration version (1,024
iterations). `RANSAC` starts at 100 iterations, updates the bound from the best
inlier ratio, caps at 4,096 and uses an outlier probability of `1e-2`.
`LeastMedianOfSquares` uses an outlier ratio of 0.5 and minimum probability
0.99, then derives a threshold from the median residual. `ACRANSAC` computes a
Number of False Alarms over residual thresholds and selects the most meaningful
threshold automatically; it can return "no model" when the data is too noisy.
`ScorerEvaluator` sums inlier errors and charges the threshold for outliers
(MSAC-style). `matching_filters` implements Lowe's nearest-neighbor distance
ratio (default 0.6) and symmetric match filtering. `GeometricFilter` runs robust
model estimation per image pair and optionally guided matching.

**AliceVision.** `ACRansac.hpp` is the a-contrario implementation.
`LORansac.hpp` implements local optimization with iterative reweighted least
squares, following Lebeda, Matas and Chum, "Fixing the Locally Optimized
RANSAC" (BMVC 2012). `leastMedianOfSquares.hpp` is the LMedS variant.
`ScoreEvaluator` is the generic residual scorer. The Meshroom FeatureMatching
node exposes `acransac` and `loransac` as geometric estimators, with a
fundamental/essential/homography model and a distance ratio.

**OpenCV 5.1.0.** The `usac` directory implements the Universal RANSAC
framework: minimal solvers, SPRT, local optimization, degeneracy handling and
quality scoring. `PlaneModelMinimalSolver` uses three points. This is a useful
reference for how to structure a solver/estimator/scorer separation, but it is
not a dependency candidate.

**Open3D 0.20.0.** `RegistrationRANSACBasedOnCorrespondence` uses `ransac_n >= 3`,
a maximum correspondence distance, optional correspondence checkers, and a
fitness/RMSE result. `RANSACConvergenceCriteria` defaults to 100,000 iterations
and confidence 0.999. `RegistrationResult::IsBetterRANSACThan` prefers higher
fitness, then lower inlier RMSE. `SegmentPlane` defaults to distance threshold
0.01, `ransac_n = 3`, 100 iterations, probability 0.99999999; it refits the plane
from the final inlier set after the RANSAC loop.

**CGAL 6.2.1.** `Shape_detection::Efficient_RANSAC` follows Schnabel, Wahl and
Klein (2007). It is a greedy sequential extraction, not a single global model:
generate candidate shapes from random samples in octree cells, score them on
unassigned points, keep the best, remove its points, repeat. Parameters include
`probability`, `min_points` (default 1% of points, at least 10), `epsilon`
(default 1% of the bounding-box diagonal), `normal_threshold` (cos 25 degrees)
and `cluster_epsilon` (default 1% of the diagonal). Shape factories provide
planes (`minimum_sample_size = 3`), spheres (3), cylinders (2, using normals),
cones and tori. Connected components in the shape's parameter space prevent
merging disconnected patches. Cylinders, cones and tori are unbounded; caps are
not modeled.

**Determinism.** COLMAP exposes `random_seed`; Open3D pre-generates all samples
before the parallel region so results are reproducible for a seed; CGAL uses a
default random generator. EduCAD's `.edu` tests need stable output. If any
randomized estimator is added, it must be seeded, or the candidate enumeration
must be exhaustive.

### 2.3 Robust least squares and IRLS

Open3D's `RobustKernel.h` implements L2, L1, Huber, Cauchy, German-McClure and
Tukey losses. The header states the IRLS relation:

```text
w(r) = (1 / r) * dp(r) / dr
```

so the kernel changes only the per-residual weight in the least-squares step.
COLMAP's Ceres bundle adjuster exposes `TRIVIAL`, `SOFT_L1`, `CAUCHY` and
`HUBER` losses with a scale. AliceVision's LORANSAC uses IRLS on the inlier set
and reduces the threshold over iterations. These are mature, well-tested ways to
downweight a few bad observations without discarding them.

For EduCAD, robust IRLS is appropriate for:
- ellipse/arc parameters from a noisy station chain,
- circle/surface parameters when observations disagree within a tolerance,
- an inferred profile frame,
- free parameters of an inferred surface.

It is not appropriate for declared exact vertices. A Tukey loss must never turn
an exact contradiction into a small residual.

### 2.4 Bundle adjustment and joint refinement

Photogrammetric BA minimizes, over cameras and 3D points,

```text
sum_ij rho( || pi(K_i, R_i, t_i, X_j) - x_ij ||^2 )
```

with gauge fixing, robust loss, sparse Schur complement, and often covariance
estimation. COLMAP and AliceVision both use Ceres. COLMAP's
`BundleAdjustmentConfig` can hold cameras, rig poses, points and intrinsics
constant or variable; it fixes a gauge (`TWO_CAMS_FROM_WORLD` or
`THREE_POINTS`), supports local and global BA, and filters observations after
optimization. AliceVision has local BA with a graph-distance active region and
Ceres cost functions for projection, 2D constraints, positions and temporal
constraints.

The EduCAD analog is much smaller:

| Photogrammetric BA | EduCAD analog |
|---|---|
| Camera intrinsics/extrinsics | None; projection directions are known |
| 3D points | 3D vertices, curve centres/normals/radii, surface parameters |
| Reprojection residuals | Exact coordinate equalities, plus optional mm residuals |
| Gauge freedom | World frame and scale fixed; only profile frame may be inferred |
| Schur complement over cameras/points | Small dense or sparse normal equations |
| Robust loss on all residuals | Robust loss only for inferred/free parameters |
| Covariance of camera/point estimates | Covariance of fitted curve/surface parameters |
| Local BA over a camera graph | Local refinement over connected inferred components |

For straight vertices the orthographic residual is **linear** in the vertex
coordinates. A least-squares solution would be a weighted average of the
observations. That is precisely what the exact kernel refuses to do silently.
So the BA analog should be used only when the user has accepted an inferred
result, or when an axis is genuinely free and multiple views give a
least-squares estimate. It must not overwrite declared coordinates.

### 2.5 Primitive surface detection and mesh reconstruction

- **Open3D** has `SegmentPlane` (sequential RANSAC plus refit), Poisson surface
  reconstruction (screened Poisson), ball pivoting and alpha shapes. These are
  dense-point-cloud methods. They are useful as validation baselines, not as
  the primary reconstruction path for sparse line drawings.
- **CGAL** has Efficient RANSAC for planes, spheres, cylinders, cones and tori,
  plus Poisson surface reconstruction via Delaunay refinement. Efficient RANSAC
  returns unbounded primitives and connected components; it does not produce
  bounded faces. Poisson would invent a surface between unrelated strokes.
- **trimesh** provides weighted Procrustes (SVD), ICP, non-rigid ICP, hole
  filling, normal repair and stitching. It has no RANSAC primitive fitting.
- **libigl** provides PCA plane fitting (`fit_plane`), Procrustes
  (`procrustes`) and point-to-plane rigid alignment (`rigid_alignment`). It has
  no RANSAC shape detection.
- **OpenCV** provides `fitEllipse`, `fitEllipseAMS` and `fitEllipseDirect`.
  `fitEllipse` requires at least five points; exactly five uses the direct
  method, otherwise the Weiss SVD method. `fitEllipseAMS` is the approximate
  mean-square method. These are least-squares fits, not robust estimators.

The transferable part of primitive detection is the **family + residual +
minimum sample + connected component** structure, not the point-cloud meshing.

### 2.6 Orthographic and engineering-drawing-specific work

Engineering-drawing reconstruction has its own mature literature, mostly
pre-dating photogrammetric SfM:

- **Wesley and Markowsky (1981), "Fleshing out projections."** The wire-frame
  algorithm finds all solid polyhedra consistent with two or three orthographic
  views. The projection is inverted in stages: candidate vertices, candidate
  edges, candidate faces, candidate blocks, then a decision procedure.
- **Sakurai and Gossard (1983), "Solid model input through orthographic
  views."** Extends the B-rep approach to curved surfaces.
- **Shin and Shin (1998), "Fast 3D solid model reconstruction from orthographic
  views."** Efficient candidate vertex/edge generation, face loops, cutting
  edges, body loops and assembly of candidate objects. It explicitly handles
  broken lines and determines cutting edges/vertices.
- **Hoang (2020), "3D Solid Reconstruction from 2D Orthographic Views."** A
  clear modern description of the B-rep pipeline: candidate vertices from
  matching `x` stations, candidate edges from projected segments, candidate
  faces from projecting lines and minimal loops, candidate blocks, then removal
  of false elements by a search tree with attribute propagation and
  backtracking. It outputs **all** solutions, not one guess. It is limited to
  perfect line/circle/arc drawings and notes that real drawings need
  imperfection handling.
- **Single-view line-drawing optimization.** Marill (1991), Leclerc and Fischler
  (1992), and Lipson and Shpitalni (1996) reconstruct a 3D wireframe from one
  line drawing by minimizing a combination of projection error and regularity
  priors (parallelism, orthogonality, planarity, symmetry, smoothness). These
  priors are useful tie-breakers, but a single view is fundamentally
  underdetermined.
- **Favreau, Lafarge and Bousseau (CVPR 2015), "Line Drawing Interpretation in
  a Multi-View Context."** Combines line-drawing interpretation with a
  multi-view photo context, using a labeling/energy formulation. It is
  perspective and scene-aware, not orthographic Monge, but it is a useful
  example of global labeling rather than greedy pairwise matching.
- **PlankAssembly (ICCV 2023)** learns shape programs from three orthographic
  views and is explicitly motivated by the fragility of back-projection under
  noise. Its code is AGPL-3.0 and depends on PyTorch/PythonOCC.
- **Ortho2CAD (2026)** uses vision-language models to emit CadQuery code from
  rasterized orthographic drawings. The repository currently has no LICENSE
  file; it is a research baseline, not a code source.

The engineering-drawing literature contributes the right **global shape**:
generate all candidates consistent with the projections, propagate constraints,
remove impossible candidates, and report all surviving solutions. That is more
relevant to EduCAD than photogrammetric BA.

### 2.7 Source inventory

| Ref | Project / work | Version inspected | Key files | License |
|---|---|---|---|---|
| C1 | COLMAP | 4.0.0 (`8bac7b9aab8f`) | `src/colmap/optim/ransac.h`, `loransac.h` | BSD-3-Clause |
| C2 | COLMAP | 4.0.0 | `src/colmap/optim/support_measurement.h` | BSD-3-Clause |
| C3 | COLMAP | 4.0.0 | `src/colmap/estimators/triangulation.h/.cc` | BSD-3-Clause |
| C4 | COLMAP | 4.0.0 | `src/colmap/scene/correspondence_graph.h` | BSD-3-Clause |
| C5 | COLMAP | 4.0.0 | `src/colmap/sfm/incremental_triangulator.cc` | BSD-3-Clause |
| C6 | COLMAP | 4.0.0 | `src/colmap/estimators/bundle_adjustment*.{h,cc}` | BSD-3-Clause |
| C7 | COLMAP | 4.0.0 | `src/colmap/estimators/two_view_geometry.h` | BSD-3-Clause |
| M1 | OpenMVG | 2.1 (`01193a245ee3`) | `src/openMVG/robust_estimation/robust_estimator_*.hpp` | MPL-2.0 |
| M2 | OpenMVG | 2.1 | `src/openMVG/matching/matching_filters.hpp` | MPL-2.0 |
| M3 | OpenMVG | 2.1 | `src/openMVG/matching_image_collection/GeometricFilter.hpp` | MPL-2.0 |
| M4 | OpenMVG | 2.1 | `src/openMVG/tracks/{tracks,union_find}.hpp` | MPL-2.0 |
| A1 | AliceVision | 3.3.7 (`859f26de1a17`) | `src/aliceVision/robustEstimation/*.hpp` | MPL-2.0 |
| A2 | AliceVision | 3.3.7 | `src/aliceVision/track/TracksBuilder.*` | MPL-2.0 |
| A3 | AliceVision | 3.3.7 | `src/aliceVision/sfm/bundle/*` | MPL-2.0 |
| A4 | Meshroom manual | `develop` | `source/feature-documentation/nodes/StructureFromMotion.rst`, `FeatureMatching.rst` | docs |
| O1 | Open3D | 0.20.0 (`b6c5e196384a`) | `cpp/open3d/pipelines/registration/Registration.{h,cpp}` | MIT |
| O2 | Open3D | 0.20.0 | `cpp/open3d/pipelines/registration/RobustKernel.h` | MIT |
| O3 | Open3D | 0.20.0 | `cpp/open3d/geometry/PointCloudSegmentation.cpp`, `SurfaceReconstructionPoisson.cpp` | MIT |
| G1 | CGAL | 6.2.1 (`28811b671a12`) | `Shape_detection/include/CGAL/Shape_detection/Efficient_RANSAC/*` | GPL-3.0+ for Shape_detection |
| G2 | CGAL | 6.2.1 | `Poisson_surface_reconstruction_3/include/CGAL/poisson_surface_reconstruction.h` | GPL-3.0+ for this package |
| T1 | trimesh | 5.2.0 (`6c158cce2265`) | `trimesh/registration.py`, `repair.py` | MIT |
| L1 | libigl | 2.6.0 (`40e7900ccbd7`) | `include/igl/fit_plane.h`, `procrustes.h`, `rigid_alignment.h` | MPL-2.0 |
| V1 | OpenCV | 5.1.0 (`e4f78fbcf1a7`) | `modules/geometry/src/shapedescr.cpp` | Apache-2.0 |
| V2 | OpenCV | 5.1.0 | `modules/geometry/src/usac/*` | Apache-2.0 |
| E1 | Wesley & Markowsky | 1981 | IBM J. Res. Dev. 25(6):934-953 | paper |
| E2 | Sakurai & Gossard | 1983 | SIGGRAPH 17(3):243-252 | paper |
| E3 | Shin & Shin | 1998 | Computer-Aided Design 30(1):63-76 | paper |
| E4 | Hoang | 2020 | IntechOpen, DOI 10.5772/intechopen.91977 | CC BY 3.0 |
| E5 | Marill | 1991 | IJCV 6(2):147-161 | paper |
| E6 | Leclerc & Fischler | 1992 | IJCV 9(2):113-136 | paper |
| E7 | Lipson & Shpitalni | 1996 | Computer-Aided Design 28(8):651-663 | paper |
| E8 | Favreau et al. | 2015 | CVPR 2015, pp. 4018-4026 | paper |
| E9 | PlankAssembly | 2023 | ICCV 2023, arXiv:2308.05744 | AGPL-3.0 code |
| E10 | Ortho2CAD | 2026 | arXiv:2607.08891 | no LICENSE file found |

---

## 3. Which assumptions transfer from perspective photogrammetry to orthographic line drawings

### 3.1 The projection difference is structural, not cosmetic

A perspective camera observes

```text
x_ij ~ K_i [R_i | t_i] X_j
```

with unknown intrinsics, extrinsics, and a projective scale. Two views of a
point give epipolar geometry; triangulation depends on a sufficiently large
parallax angle. Outliers are random feature mismatches; the data is usually
redundant (many features, many views).

An orthographic Monge view observes

```text
u_v = P_v X + b_v,   P_v is a known rank-2 2x3 matrix
```

with `P_front = [[1,0,0],[0,1,0]]`, `P_top = [[1,0,0],[0,0,-1]]`, and the
side matrix containing `xRef, dRef, s`. There are no unknown camera parameters.
Two distinct views give four equations for three unknowns; consistency requires
the shared coordinate to agree exactly:

```text
front (x,h) + top (x,-d)  ->  same x
front (x,h) + side (x',h) ->  same h
top (x,-d) + side (x',h)  ->  x' = xRef + s * (-d - dRef)
```

A third view is an **independent consistency check**, not a new camera to
calibrate. The hard problem is not estimating geometry from noise; it is
deciding which 2D primitives correspond, when projections coincide or overlap.

This changes the robust-estimation problem substantially:

- There is no epipolar constraint to exploit; the constraint is simpler and
  exact.
- There is no triangulation-angle degeneracy; two distinct views, with the
  required profile frame for a side view, determine the three coordinates.
- The real degeneracies are **coincident projections**, **overlapping levels**,
  **occlusion/visibility**, and **missing identity**.
- The noise is not zero-mean feature jitter; it is a mix of exact drafting,
  hand-drawn imprecision, construction ink, hidden-line conventions, and
  semantic distractors.

### 3.2 What transfers directly

| Idea | Why it transfers |
|---|---|
| Correspondence graph / track | A spatial vertex, curve or surface is a track across views; member IDs already are track identities |
| One observation per view | A 3D entity projects once per view; multiple same-view observations are a fork or a duplicate |
| Unique-evidence accounting | A hypothesis should not win by counting the same source stroke or curve many times |
| Ternary support / contradiction / silence | A third view with no ink is not a veto; a covering stroke is support; a collinear non-covering stroke is contradiction |
| Truncated robust cost (MSAC) | Naturally expresses "covered vs contradicted" and avoids unbounded influence of a distant stroke |
| Robust IRLS / Huber / Tukey | Appropriate for hand-drawn jitter and continuous curve/surface parameters |
| Median/MAD scale estimate | A simple, outlier-resistant way to set tolerances from the drawing itself |
| Model selection / Occam | Prefer fewer surfaces, fewer free parameters and fewer speculative instances when evidence ties |
| Global candidate generation + backtracking | Engineering-drawing B-rep reconstruction has used this for decades; it matches our discrete problem |
| All-solutions reporting | When the drawing is genuinely ambiguous, report the alternatives instead of guessing |
| Deterministic tie-breaking | Required by the `.edu` test contract and by reproducible teaching feedback |

### 3.3 What does not transfer

| Assumption | Why it fails for orthographic line drawings |
|---|---|
| Unknown camera intrinsics/extrinsics | Projection matrices are known exactly; calibration is irrelevant |
| Epipolar / fundamental / essential matrix | Degenerates to shared-coordinate equality; no epipolar line to test |
| Triangulation angle / parallax | No camera baseline; two distinct views with the required frame determine the point exactly |
| Dense multi-view stereo | A line drawing is sparse; there is no texture or dense correspondence |
| Poisson / ball-pivoting / alpha shapes | Would invent surfaces between unrelated strokes; not an inference method for bounded analytic faces |
| Random independent outliers | Drawing distractors are structured: annotations, centre lines, hidden lines, construction lines, duplicate strokes |
| 50% outlier breakdown | A busy drawing can have more non-model ink than model ink; RANSAC's breakdown assumption is not reliable |
| Statistical redundancy | Two or three views, often few primitives; asymptotic confidence and covariance are weak |
| Similarity gauge freedom | World frame and scale are fixed by the drawing; only the profile frame may be inferred, and `s` is discrete |
| Appearance descriptors / Lowe ratio | No appearance; the analog is mutual uniqueness, not descriptor distance |
| Learned shape priors | A learned model can be a useful baseline, but it cannot certify exact geometry and may hallucinate plausible solids |

### 3.4 What transfers with modification

| Photogrammetric idea | EduCAD modification |
|---|---|
| RANSAC minimal sample | Enumerate discrete correspondence candidates; random sampling only when the candidate set is large or the curve chain is broken |
| Inlier count | Count **independent** covered length/source IDs, not raw sample count |
| Fixed inlier threshold | Use exact tolerance in exact mode; use `max(exactEps, k * MAD)` in robust mode |
| Bundle adjustment | Constrained joint refinement of free 3D/curve/surface parameters; freeze declared coordinates; no cameras |
| Local BA | Local refinement of one connected inferred component, not a camera graph |
| Covariance estimation | Covariance of fitted conic/surface parameters; propagate to matching gates |
| Primitive shape detection | Use the family/minimal-sample/connected-component structure, but keep bounded loops from the drawing |
| Multi-view track fusion | Union-find with fork filtering, unique evidence, and explicit ambiguity when the union is not unique |

### 3.5 Consequences for three-view consensus

The correct three-view rule is not majority vote. It is:

```text
accept if:
  hard constraints hold
  and at least two independent views support the hypothesis
  and no view contradicts it

silence is not contradiction.
a third view that covers the projection is support.
a third view that has a collinear stroke not covering the projection is contradiction.
a third view with a visible/hidden verdict that conflicts is contradiction.
```

This is already what `candidateSupport` does for curves. Generalizing it to
points, edges and surfaces is the main design opportunity.

A useful formalization is a 3-partite hypergraph:

- Observations are nodes, labeled by view.
- A candidate correspondence is a subset with at most one observation per view.
- A valid track is a matching that satisfies the projection equations and
  identity constraints.
- A hypothesis is a set of tracks covering a connected component.
- The problem is a weighted set packing/partition; it is NP-hard in general, but
  the instances are tiny. Exhaustive enumeration with propagation is feasible.

This is exactly the structure of the engineering-drawing B-rep algorithms, with
the addition of soft evidence and robust fitting.

---

## 4. Comparison matrix for EduCAD

Legend: `●` strong/explicit, `◐` partial/indirect, `○` absent or unsuitable.

| Approach | Correspondence model | Robust fitting | Global consensus | Exact constraints | Bounded analytic surfaces | Fit for EduCAD |
|---|---|---|---|---|---|---|
| COLMAP 4.0.0 | Correspondence graph + tracks | LORANSAC, MSAC, robust BA losses | Incremental/global SfM + BA | ○ (perspective, calibrated/unknown) | ○ (MVS mesh) | Ideas: tracks, unique inliers, local optimization |
| OpenMVG 2.1 | Pairwise matches + union-find tracks | RANSAC, MSAC, LMedS, ACRANSAC | Global rotation/translation averaging + BA | ○ | ○ | Ideas: track fork filter, LMedS, ACRANSAC |
| AliceVision 3.3.7 | Tracks + incremental SfM | ACRANSAC, LORANSAC + IRLS, LMedS | BA, local BA, track filtering | ○ | ○ | Ideas: track filter, IRLS, ambiguity handling |
| Open3D 0.20.0 | Correspondences / point clouds | RANSAC, robust kernels, ICP | Pose graph / global registration | ○ | ◐ (primitive plane, Poisson mesh) | Ideas: robust kernels, SegmentPlane refit |
| CGAL 6.2.1 | Point-set shape detection | Efficient RANSAC + connected components | Greedy sequential extraction | ○ | ◐ (unbounded primitives) | Ideas: family/minimal sample/components; license blocks code |
| trimesh 5.2.0 | Ordered point sets / meshes | Procrustes, ICP, NRICP | ICP / registration | ○ | ○ | Ideas: Procrustes/ICP baselines; no primitive fit |
| libigl 2.6.0 | Corresponding point sets | PCA plane, Procrustes, rigid alignment | ○ | ○ | ○ | Ideas: SVD/PCA primitives; no RANSAC |
| OpenCV 5.1.0 | Point sets / feature matches | USAC, RANSAC | USAC framework | ○ | ○ | Ideas: conic fitting, solver/scorer separation |
| Orthographic B-rep (Wesley, Sakurai, Shin, Hoang) | Candidate vertex/edge/face/block graph | Constraint propagation + backtracking | All-solutions search | ● (projection equalities) | ◐ (planes, cylinders, cones; limited curves) | **Strongest structural match** |
| Single-view optimization (Marill, Leclerc, Lipson) | One-view wireframe | Regularity-prior least squares | Global energy | ◐ | ○ | Tie-breaker priors only |
| PlankAssembly / Ortho2CAD | Learned shape programs / VLM code | Learned, noise-tolerant | Sequence/decoding | ○ | ◐ | Baselines only; licenses/deps unsuitable |
| **EduCAD current** | Member IDs + one-to-one auto links + interval curve matches | Fixed tolerances, OLS/PCA ellipse fits | Local lexicographic + `candidateSupport` | ● (rational exact lane) | ● (bounded plane/cylinder/cone/sphere + recess/fillet) | Strong exact core; weak robust/global layer |
| **EduCAD proposed** | Track/hypergraph + unique evidence | MSAC + IRLS for free parameters | Exhaustive/branch-and-bound consensus | ● (unchanged) | ● (unchanged) | Best fit: exact constraints + robust consensus |

Design-option comparison:

| Option | Robustness | Ambiguity handling | Exactness | Effort | Verdict |
|---|---|---|---|---|---|
| Keep current | Low for hand drawings | Reports counts, not ranked alternatives | High | 0 | Insufficient for the stated goal |
| Replace with RANSAC/BA | High for random noise | Weak for structured ambiguity | Lost if applied globally | High | Wrong model |
| Global set packing + exact constraints | Medium-high | Strong | Preserved | Medium | Recommended core |
| Add robust fit only | Medium | Weak | Preserved | Low | Useful but incomplete |
| Learned shape programs | High on benchmarks | Learned, opaque | Lost | Very high | Not suitable |

---

## 5. Recommended hybrid: exact projection constraints plus robust consensus

### 5.1 Architecture

```text
observations
  -> semantic filtering (annotations, construction, hidden/visible)
  -> candidate generation (points, edges, curves, surfaces)
  -> hard-constraint propagation (identity, projection, dimensions, incidence)
  -> hypothesis enumeration (exhaustive or branch-and-bound)
  -> evidence scoring (unique coverage, contradiction, silence, complexity)
  -> selection / ambiguity / outlier diagnosis
  -> optional robust refinement of free parameters
  -> exact validation and certificate (declared lane only)
```

Two lanes must remain distinct:

- **Exact lane**: declared identities, dimensions, topology, and any axis fully
  determined by exact observations. Rational arithmetic. No robust fitting. The
  certificate remains `educad-explicit-v1`.
- **Inferred lane**: auto correspondences, curve/surface parameters, inferred
  profile frame, and hand-drawn jitter. Robust scoring and optional IRLS/LM.
  No exact certificate. Results are marked `inferred` or `partial`.

The exact lane is never outvoted by the inferred lane. If a hard constraint
fails, the result is a conflict, not a low-cost fit.

### 5.2 Evidence states

For each source entity `e` and hypothesis `h`, project `h` into `e`'s view and
classify:

| State | Meaning | Effect |
|---|---|---|
| `exact` | Endpoints/centres coincide within exact tolerance | Strong support |
| `covered` | The source stroke covers the projected model interval within `τ` | Support |
| `partial` | The source stroke covers a proper sub-interval, or only one end matches | Weak support; needs another view |
| `silent` | No matching stroke in this view | No vote |
| `contradicted` | A collinear stroke covers an interval outside the model, or visibility disagrees | Negative |
| `hard` | Identity, dimension, projection or incidence violation | Infeasible |

Interval evidence must be merged before counting. Split and overlapping strokes
are one covered interval. A source entity is counted **once** per hypothesis,
even if several projected pieces touch it. This is the `UniqueInlierSupport`
idea applied to drawing evidence.

### 5.3 Scoring

Use a lexicographic rank rather than a single unit-mixed scalar. For a
hypothesis `h`:

```text
H(h)  = number/weight of hard violations                  (must be 0)
X(h)  = contradicted source length (mm) + visibility conflicts
U(h)  = unexplained source length (mm) after semantic filtering
M(h)  = model projection length not covered by any source (mm)
S(h)  = number of independent views with support and no contradiction
P(h)  = number of free parameters + number of speculative surfaces/curves
R(h)  = sum_e w_e * min((r_e / tau)^2, 1)                  (MSAC residual)
K(h)  = stable deterministic key
```

Rank ascending:

```text
(H, X, U + M, -S, P, R, K)
```

Why lexicographic:

- A hard violation is never traded for a better residual.
- A contradiction is worse than a small uncovered interval.
- A hypothesis that explains more source ink is preferred, but not at the cost
  of inventing model length.
- More independent views are better; silence does not veto.
- Simpler geometry wins ties.
- The residual is a tie-breaker, not the primary objective.
- The stable key makes tests reproducible.

If a scalar is needed for ranking within the same hard class, use the MSAC cost
`R(h)`. Do not add lengths and parameter counts with arbitrary weights unless
the weights are calibrated and documented.

### 5.4 Candidate generation

The current code already generates most candidates. The change is to retain
**all** of them, not just the first or the best pair.

- **Points**: index stations by `x`, `height`, `depth`; generate every pair
  across views that satisfies the projection equations. Explicit member IDs are
  hard constraints and are processed first. Do not assume one-to-one; enumerate
  alternatives and let consensus decide.
- **Edges**: for every pair of point candidates, check projection coverage in
  every view. Keep candidates with coverage in at least two views. Do not drop
  an edge because a third view is silent.
- **Curves**: keep the existing true-shape/edge-on, ellipse/ellipse,
  ellipse/line-run, arc/line-run, slanted-trace and coaxial-boundary
  candidates. For each, project into every view and build the evidence vector.
  Deduplicate by analytic geometry, not by source IDs.
- **Surfaces**: keep every cone apex, sphere centre, recess depth, fillet pair
  and coaxial boundary pair that passes its local analytic check. Do not return
  after the first success. Deduplicate by surface parameters and boundary loop
  identity.
- **Cap**: `maxHypotheses` (default 4096) with deterministic generation order.
  If the cap is hit, report `search-limit` and retain the best partial result.

### 5.5 Acceptance, ambiguity and outlier rules

Accept a hypothesis only when:

```text
H = 0
S >= 2
X = 0
```

For a three-view drawing, `S = 2` with one silent view is acceptable and should
be reported as `view-silent`. `S = 2` with one contradicting view should be
rejected or demoted and reported as `third-view-contradiction`. `S = 1` is
underdetermined, not accepted.

Ambiguity:

- Two feasible hypotheses with distinct geometry and a rank difference within
  `ambiguityMargin` are ambiguous.
- Report top-k, their scores, and the **specific missing constraint**:
  `third-view`, `member-identity`, `dimension`, `visibility`, `profile-frame`,
  or `surface-family`.
- Do not silently choose the lexicographically first candidate. If the UI needs
  one display, mark it `selected` and keep the alternatives in
  `correspondence.hypotheses`.

Outliers:

- A source stroke/point not explained by the selected hypothesis is an
  `evidence-outlier` candidate, not something to delete.
- Classify the reason: `annotation`, `construction`, `duplicate`, `broken`,
  `hidden-line`, `hand-jitter`, `wrong-view`, `unexplained`.
- If a lower-ranked hypothesis explains it, report the alternative. That is
  strong evidence that the selected hypothesis is incomplete.
- Never lower a tolerance just to make an outlier disappear.

### 5.6 Robust fitting of curves and surfaces

Conic/ellipse fitting should be upgraded in this order:

1. Normalize coordinates (centre and scale) before fitting.
2. Use an ellipse-specific direct least-squares fit (Fitzgibbon) or an
   approximate mean-square fit (Taubin/AMS) for closed loops.
3. For arcs, fit a conic with a normalized parameterization and evaluate a
   geometric/Sampson residual, not only the algebraic residual.
4. Run IRLS with Huber or Tukey weights on the station residuals. Estimate
   `σ` from the median absolute residual; do not let a few bad stations inflate
   it.
5. Report `rmsMm`, `maxMm`, `inlierCount`, `outlierCount`, `sigmaMm`,
   `conditionNumber`, and parameter covariance.
6. Reject fits with a bad condition number, a degenerate axis ratio, or an
   implausible sweep. Near-circular ellipses should be flagged
   `ellipse-fit-unstable` rather than forced into a normal.

Curve matching should use a tolerance derived from the fit uncertainty:

```text
tau_e = max(exactEps, k * sigma_e)
```

Do not require a `1e-6` extent equality for a hand-drawn curve. A covering run
with a small endpoint gap should be `covered`, not `contradicted`. Partial
coverage should count as weak support and require a third view or an explicit
endpoint identity.

Surface parameters should be solved from exact constraints first:

- cylinder/cone axis from generators or coaxial centres,
- radius from the true-shape circle/arc,
- apex from tangent generators,
- sphere centre from silhouette circle centres,
- recess depth from edge-on strokes.

Only the remaining free parameters should be refined. Robust losses are
appropriate there; they must not move a declared radius or a dimensioned depth.

### 5.7 Constrained refinement (the BA analog)

Use `EduCADSolver.solveSystem` or a new small LM/IRLS routine for free
parameters only. The residual vector should contain:

- reprojection residuals for inferred points/curves/surfaces,
- soft priors for coaxiality, tangency, planarity and symmetry,
- optional dimension residuals.

Variables:

- free 3D vertex coordinates,
- curve centre, unit basis, radius, start/sweep,
- surface origin/axis/radius/apex/sphere centre,
- inferred profile frame `{xRef, dRef}` (with `s` enumerated, not optimized).

Do not include camera variables. Do not refine declared vertices. Do not let a
robust loss change topology or incidence. After refinement, re-run the exact
validator; if it fails, roll back to the pre-refinement model and report
`refine-rejected`.

`EduCADSolver` currently uses a dense linear solve, finite-difference Jacobians,
a 50-iteration cap, and a 50 mm delta clamp. That is adequate for small teaching
drawings. For larger drawings, a sparse normal-equation path would be needed,
but that is a later optimization.

### 5.8 Diagnostic taxonomy

Keep existing codes for compatibility. Add structured fields and new codes
where needed.

| Code | Meaning | Severity | Typical action |
|---|---|---|---|
| `correspondence-ambiguous` | Two or more feasible hypotheses, distinct geometry, close scores | warning | Report alternatives and missing constraint |
| `correspondence-underdetermined` | No hypothesis with two independent views | error | Ask for another view/identity/dimension |
| `correspondence-conflict` | Hard constraints contradict | error | Point to the conflicting observations |
| `third-view-contradiction` | A two-view hypothesis is contradicted by a third view | warning/error | Demote/reject the pair; keep supported alternative |
| `view-silent` | A declared view has no ink for the hypothesis | info | Do not treat as contradiction |
| `evidence-outlier` | A source stroke/point is not explained | warning | Preserve ink; report reason and alternative |
| `evidence-noisy` | Residual exceeds exact tolerance but is within robust tolerance | info | Report σ, max residual, inlier count |
| `track-fork` | One member has multiple same-view observations at different stations | error | Merge or split identities explicitly |
| `surface-fit-ambiguous` | Two surface families fit within tolerance | warning | Keep both; ask for a section/dimension |
| `surface-fit-rejected` | Robust surface fit failed its residual/condition test | error | Retain boundary, do not certify surface |
| `ellipse-fit-unstable` | Near-circular or ill-conditioned conic | warning | Keep curve, do not use it to select a plane |
| `search-limit` | Hypothesis enumeration hit its cap | warning | Return best partial, explain |

Each ambiguity record should include:

```js
{
  code: 'correspondence-ambiguous',
  entityIds: ['E2', 'E3'],
  candidateIds: ['h1', 'h2'],
  scoreMargin: 0.12,
  missingConstraint: 'third-view',
  message: 'Two curve levels fit plan and elevation; add a side view or link a boundary station.'
}
```

This directly addresses the AGENTS requirement to distinguish mathematical
ambiguity, insufficient input, and an unimplemented feature:

- **Mathematical ambiguity**: multiple feasible hypotheses, equal hard
  constraints.
- **Insufficient input**: no hypothesis with enough independent views; missing
  coordinate/dimension.
- **Unimplemented**: a curve/surface family outside the supported set; report
  `unsupported-*`, not ambiguity.

### 5.9 What not to do

- Do not replace the exact kernel with least squares or bundle adjustment.
- Do not make RANSAC the primary correspondence mechanism.
- Do not use Poisson/ball-pivoting/alpha shapes to infer surfaces from sparse
  line drawings.
- Do not treat silence as contradiction.
- Do not count the same source stroke or curve repeatedly.
- Do not delete unexplained ink; report it.
- Do not lower tolerances globally to make a test pass.
- Do not import AGPL/GPL code or learned-model code into this MIT project.
- Do not let a robust refinement change a declared identity or dimension.

---

## 6. Pseudocode, API sketch and `.edu` test plan

### 6.1 Proposed modules

```text
public/lib/educad-correspondence.js   pure evidence model, candidate enumeration, scoring
public/lib/educad-fit.js              robust conic/circle/arc fitting and covariance
public/lib/educad-reconstruct.js      orchestrates the public pipeline
public/lib/educad-curve-reconstruct.js uses the scorer for curve candidates
public/lib/educad-oblique-kernel.js   uses robust conic fitting and uncertainty
public/lib/educad-solver.js           existing LM for free-parameter refinement
```

No new npm dependency. Reuse `educad-vec3.js` for vector math and
`educad-solver.js` for refinement.

### 6.2 Pseudocode

```js
function reconstruct(entities, options) {
  const obs = collectObservations(entities);           // points, segments, curves
  const hard = buildHardConstraints(obs, options);     // identity, projection, dimensions, topology
  const candidates = generateCandidates(obs, hard);    // all points, edges, curves, surfaces
  const hypotheses = enumerateConsistent(candidates, hard, options.maxHypotheses);

  const ranked = hypotheses
    .map(h => ({ h, evidence: score(h, obs, hard, options) }))
    .sort(compareRank);                                // (H, X, U+M, -S, P, R, key)

  const selected = choose(ranked, options);            // no silent tie-break
  if (selected && options.consensus.refine !== 'none') {
    selected.refined = refine(selected.h, obs, hard, options); // free params only
    if (!passesHardValidation(selected.refined)) {
      selected.refined = null;
      diagnostics.push(refineRejected(selected));
    }
  }

  return {
    geometry: emit(selected),                          // existing analytic/display pipeline
    correspondence: report(ranked, selected),          // hypotheses, ambiguity, outliers
    diagnostics: diagnose(ranked, selected, obs)
  };
}
```

Candidate generation sketch:

```js
function generateCandidates(obs, hard) {
  const points = enumeratePointTracks(obs, hard);     // all cross-view assignments
  const edges  = enumerateEdgeTracks(points, obs, hard);
  const curves = enumerateCurveTracks(obs, hard);     // all levels, all view pairs
  const surfaces = enumerateSurfaceTracks(curves, obs, hard);
  return { points, edges, curves, surfaces };
}
```

Scoring sketch:

```js
function score(h, obs, hard, options) {
  const stats = { exact: 0, covered: 0, partial: 0, silent: 0,
                  contradictedMm: 0, unexplainedMm: 0, unsupportedMm: 0,
                  supportedViews: 0, freeParameters: 0, residual: 0 };

  for (const view of declaredViews(obs)) {
    const projected = projectAnalytic(h, view);
    const evidence = mergeIntervals(obs[view], projected); // split/overlap merge
    classify(evidence, stats, options.toleranceMm);
    if (stats.supportedInView(view) && !stats.contradictedInView(view)) {
      stats.supportedViews++;
    }
  }

  const hardViolations = validateHard(h, hard);        // identity, dimension, incidence
  stats.freeParameters = countFreeParameters(h);
  return { hardViolations, ...stats };
}

// ascending lexicographic order
function compareRank(a, b) {
  return a.evidence.hardViolations - b.evidence.hardViolations ||
         a.evidence.contradictedMm - b.evidence.contradictedMm ||
         (a.evidence.unexplainedMm + a.evidence.unsupportedMm) -
         (b.evidence.unexplainedMm + b.evidence.unsupportedMm) ||
         b.evidence.supportedViews - a.evidence.supportedViews ||
         a.evidence.freeParameters - b.evidence.freeParameters ||
         a.evidence.residual - b.evidence.residual ||
         compareStableKey(a.h, b.h);
}
```

### 6.3 Public API sketch

```js
EduCADReconstruct.reconstruct(entities, {
  identity: 'auto' | 'explicit',
  topology: null | { triangles: [...] },
  profile: null | { xRef, dRef, s },
  consensus: {
    enabled: true,
    mode: 'exact' | 'robust',       // exact: declarations are hard; robust: inferred lane
    toleranceMm: 0.5,               // auto: derive from drawing precision
    sigmaMm: 'auto',                // robust scale from MAD
    ambiguityMarginMm: 0.25,
    minSupportedViews: 2,
    maxHypotheses: 4096,
    uniqueEvidence: true,
    retainAlternatives: true,
    refine: 'none' | 'irls' | 'lm'
  }
});
```

Suggested result schema:

```js
{
  status: 'ok' | 'unavailable',
  determination: 'determined' | 'inferred' | 'partial' | 'underdetermined' | 'inconsistent' | 'unsupported',
  geometry: { /* existing model */ },
  correspondence: {
    version: 1,
    selected: 'h:3',
    hypotheses: [
      { id: 'h:3', rank: 1, geometrySummary: '2 curves, 1 cylinder',
        hardViolations: 0, supportedViews: 3, contradictedMm: 0,
        unexplainedMm: 0.4, unsupportedMm: 0.2, freeParameters: 4,
        residualMm: 0.08, sourceIds: ['E2','E3','E4'] }
    ],
    ambiguous: [ /* {candidateIds, scoreMargin, missingConstraint} */ ],
    outliers: [ /* {entityId, reason, alternativeHypothesis} */ ],
    diagnostics: [ /* full structured records */ ]
  },
  fit: {
    curves: [ /* rmsMm, maxMm, sigmaMm, inliers, outliers, condition, covariance */ ],
    surfaces: [ /* family, residual, condition, inliers */ ]
  },
  pipeline: { /* existing version/stage/diagnostics */ }
}
```

### 6.4 `.edu` test plan

All new tests must use drawing scripts and `# expect:` properties, per
`AGENTS.md`. Do not add a separate unit-test framework.

**Regression gate**

```sh
for f in tools/scripts/*.edu tools/scripts/*.edc; do
  node tools/edc.js "$f" || exit 1
done
```

The baseline is 151/151 passing at `43d3b7f`. Consensus v0 must preserve that.

**Existing discriminating scripts**

| Script | Current expectation | What it proves |
|---|---|---|
| `three-view-circle.edu` | `24V 24E 1F curves=1 unresolved=0 status=inferred` | Third view corroborates one curve, not a duplicate |
| `overlapping-curve-projections.edu` | `48V 48E 2F curves=2 unresolved=0 status=inferred` | Side view selects two levels from four cross-products |
| `ambiguous-curve-projections.edu` | `96V 96E 4F curves=4 unresolved=2 status=partial` | No third view: all supported levels retained and reported |
| `spline-three-view.edu` | `parametricCurves=1 ... status=partial` | A spline family is partitioned across three views |
| `spline-multi-view.edu` | `curves=2 parametricCurves=2 ... status=partial` | Two spatial curves, one with three-view evidence |
| `spline-third-view-conflict.edu` | `parametricCurves=0 diagnostics=curve-projection-conflict` | Third view rejects a contradictory pair |
| `profile-station-conflict.edu` | `0V 0E 0F diagnostics=coordinates-missing` | Name match is not enough when depth contradicts |
| `oblique-conflicting-points.edu` | `curves=0 diagnostics=oblique-curve-projection-missing,oblique-point-conflict` | Point evidence rejects a mirror |
| `truncated-cylinder-ambiguous.edu` | `curves=3 ... diagnostics=curve-projection-ambiguous,...` | Two inclined traces remain ambiguous |
| `cone-oblique-conflict.edu` | `diagnostics=cone-apex-conflict` | Apex off the base normal is rejected, boundary retained |

**New scripts (proposed; add only with the implementation)**

| Script | Construction | Proposed expectation |
|---|---|---|
| `consensus-third-view-selects.edu` | Two plan circles, two front lines, one profile level selecting two pairs | `curves=2 unresolved=0 status=inferred correspondenceCandidates=2 selected=1` |
| `consensus-third-view-contradicts.edu` | Two-view pair supported, profile stroke contradicts one candidate | `curves=1 diagnostics=third-view-contradiction unresolved=1 status=partial` |
| `consensus-silent-view.edu` | Three views declared; profile has no relevant ink | `curves=1 diagnostics=view-silent unresolved=1 status=partial` |
| `consensus-outlier-stroke.edu` | Valid curve plus a short collinear stroke that does not cover it | `curves=1 diagnostics=evidence-outlier unresolved=1 status=partial` |
| `consensus-ambiguous-margin.edu` | Two candidates with nearly equal evidence, no selector | `curves=2 diagnostics=correspondence-ambiguous candidates=2 status=partial` |
| `ellipse-robust-fit.edu` | 24-station ellipse with one station displaced by 0.4 mm | `curves=1 diagnostics=evidence-noisy ellipseFit=robust fitOutliers=1 status=inferred` |
| `ellipse-fit-unstable.edu` | Small near-circular ellipse with noisy stations | `curves=1 diagnostics=ellipse-fit-unstable status=partial` |
| `surface-fit-ambiguous.edu` | Boundary and generators fit cylinder and cone within tolerance | `surfaces=2 diagnostics=surface-fit-ambiguous status=partial` |

New expectation keys should be added to `tools/edc.js` only in the same change
that implements them. Until then, assert existing keys (`curves`,
`diagnostics`, `unresolved`, `status`, `surfaceKinds`, `surfaceModel`) so the
scripts remain runnable.

**Determinism and performance**

- Candidate enumeration must be stable-sorted and independent of object key
  order.
- No unseeded randomness. If RANSAC is used for conic fitting, use a fixed seed
  or a deterministic sample order.
- `maxHypotheses` and branch-and-bound caps must be reported as `search-limit`,
  not silently truncated.
- The 151-script suite currently runs in seconds. Consensus v0 should stay
  within the same order of magnitude; use interval merging and source-ID sets,
  not per-sample quadratic scans over the whole sheet.

---

## 7. Licensing and dependency notes

EduCAD is MIT-licensed and has zero npm dependencies. The recommendation is to
keep it that way. This report used source reading and public documentation only;
no code was copied.

| Project / work | License | Dependency weight | Code reuse verdict |
|---|---|---|---|
| COLMAP 4.0.0 | BSD-3-Clause | C++, Eigen, Ceres, OpenMP, CUDA optional | Permissive, but far too heavy; use ideas only |
| OpenMVG 2.1 | MPL-2.0 | C++, Ceres, Boost | File-level copyleft; avoid copying files |
| AliceVision 3.3.7 | MPL-2.0 | C++, Ceres, Boost, Lemon | File-level copyleft; use ideas only |
| Open3D 0.20.0 | MIT | C++, Python, TBB, Eigen | Permissive, but heavy; use ideas only |
| CGAL 6.2.1 core | LGPL-3.0-or-later | C++, Boost, GMP/MPFR | Linking obligations; avoid for zero-dep app |
| CGAL Shape_detection | **GPL-3.0-or-later** | same | **Do not link/copy into MIT app** without GPL compliance |
| CGAL Poisson_surface_reconstruction_3 | **GPL-3.0-or-later** | same | **Do not use** for the same reason |
| trimesh 5.2.0 | MIT | Python, NumPy, SciPy | Permissive, but not a JS runtime; ideas only |
| libigl 2.6.0 | MPL-2.0 | C++, Eigen | File-level copyleft; avoid copying |
| OpenCV 5.1.0 | Apache-2.0 | C++ | Permissive; reimplement equations rather than vendoring |
| Ceres Solver | BSD-3-Clause | C++ | Permissive, but heavy; no runtime need |
| PlankAssembly | **AGPL-3.0** | PyTorch, PythonOCC, CUDA | **Do not copy**; cite as a baseline |
| Ortho2CAD | No LICENSE file found | Python, VLM stack | **Do not copy**; unverified licensing |
| Academic papers | copyright of authors | none | Implement equations with citation; do not copy text/code |

Specific notes:

- CGAL's core is LGPL, but the Shape_detection and
  Poisson_surface_reconstruction_3 packages are explicitly GPLv3+ in their
  package license headers. This is easy to miss because the project is often
  described as "LGPL CGAL". It rules out direct use in this MIT app without a
  commercial license or GPL compliance.
- COLMAP and Open3D are permissive, but their useful parts are C++/CUDA systems
  with large dependency graphs. Porting even a small RANSAC class would violate
  the zero-dependency constraint in spirit and add maintenance risk.
- OpenMVG/AliceVision are MPL-2.0 at the file level. Copying a file requires
  keeping that file MPL; it does not relicense the whole app, but it complicates
  the repository's simple MIT story.
- OpenCV is Apache-2.0, but `fitEllipse` is a large numerical routine with its
  own conventions. Reimplement the published Fitzgibbon/Taubin equations in
  plain JavaScript and cite the papers.
- PlankAssembly is AGPL-3.0; its learned shape-program idea is interesting, but
  the code cannot be used here. Ortho2CAD has no license file at the inspected
  revision, so it is not a safe source.
- If any code is ever ported, keep the original license header, add a NOTICE,
  and document the source tag/commit. This report recommends not doing that.

---

## References

### OSS source

- COLMAP 4.0.0, `src/colmap/optim/ransac.h`:
  <https://github.com/colmap/colmap/blob/4.0.0/src/colmap/optim/ransac.h>
- COLMAP 4.0.0, `src/colmap/optim/loransac.h`:
  <https://github.com/colmap/colmap/blob/4.0.0/src/colmap/optim/loransac.h>
- COLMAP 4.0.0, `src/colmap/optim/support_measurement.h`:
  <https://github.com/colmap/colmap/blob/4.0.0/src/colmap/optim/support_measurement.h>
- COLMAP 4.0.0, `src/colmap/estimators/triangulation.h`:
  <https://github.com/colmap/colmap/blob/4.0.0/src/colmap/estimators/triangulation.h>
- COLMAP 4.0.0, `src/colmap/scene/correspondence_graph.h`:
  <https://github.com/colmap/colmap/blob/4.0.0/src/colmap/scene/correspondence_graph.h>
- COLMAP 4.0.0, `src/colmap/sfm/incremental_triangulator.cc`:
  <https://github.com/colmap/colmap/blob/4.0.0/src/colmap/sfm/incremental_triangulator.cc>
- COLMAP 4.0.0, `src/colmap/estimators/bundle_adjustment_ceres.cc`:
  <https://github.com/colmap/colmap/blob/4.0.0/src/colmap/estimators/bundle_adjustment_ceres.cc>
- COLMAP 4.0.0, `src/colmap/estimators/two_view_geometry.h`:
  <https://github.com/colmap/colmap/blob/4.0.0/src/colmap/estimators/two_view_geometry.h>
- COLMAP changelog, 4.0.0 (2026-03):
  <https://colmap.github.io/changelog.html>
- OpenMVG 2.1, `src/openMVG/robust_estimation/robust_estimator_ACRansac.hpp`:
  <https://github.com/openMVG/openMVG/blob/v2.1/src/openMVG/robust_estimation/robust_estimator_ACRansac.hpp>
- OpenMVG 2.1, `src/openMVG/robust_estimation/robust_estimator_Ransac.hpp`:
  <https://github.com/openMVG/openMVG/blob/v2.1/src/openMVG/robust_estimation/robust_estimator_Ransac.hpp>
- OpenMVG 2.1, `src/openMVG/robust_estimation/robust_estimator_LMeds.hpp`:
  <https://github.com/openMVG/openMVG/blob/v2.1/src/openMVG/robust_estimation/robust_estimator_LMeds.hpp>
- OpenMVG 2.1, `src/openMVG/matching/matching_filters.hpp`:
  <https://github.com/openMVG/openMVG/blob/v2.1/src/openMVG/matching/matching_filters.hpp>
- OpenMVG 2.1, `src/openMVG/tracks/tracks.hpp`:
  <https://github.com/openMVG/openMVG/blob/v2.1/src/openMVG/tracks/tracks.hpp>
- OpenMVG robust estimation docs:
  <https://github.com/openMVG/openMVG/blob/v2.1/docs/sphinx/rst/openMVG/robust_estimation/robust_estimation.rst>
- AliceVision 3.3.7, `src/aliceVision/robustEstimation/ACRansac.hpp`:
  <https://github.com/alicevision/AliceVision/blob/v3.3.7/src/aliceVision/robustEstimation/ACRansac.hpp>
- AliceVision 3.3.7, `src/aliceVision/robustEstimation/LORansac.hpp`:
  <https://github.com/alicevision/AliceVision/blob/v3.3.7/src/aliceVision/robustEstimation/LORansac.hpp>
- AliceVision 3.3.7, `src/aliceVision/robustEstimation/leastMedianOfSquares.hpp`:
  <https://github.com/alicevision/AliceVision/blob/v3.3.7/src/aliceVision/robustEstimation/leastMedianOfSquares.hpp>
- AliceVision 3.3.7, `src/aliceVision/track/TracksBuilder.hpp`:
  <https://github.com/alicevision/AliceVision/blob/v3.3.7/src/aliceVision/track/TracksBuilder.hpp>
- Meshroom manual, `StructureFromMotion.rst`:
  <https://github.com/alicevision/meshroom-manual/blob/develop/source/feature-documentation/nodes/StructureFromMotion.rst>
- Meshroom manual, `FeatureMatching.rst`:
  <https://github.com/alicevision/meshroom-manual/blob/develop/source/feature-documentation/nodes/FeatureMatching.rst>
- Open3D 0.20.0, `cpp/open3d/pipelines/registration/Registration.cpp`:
  <https://github.com/isl-org/Open3D/blob/v0.20.0/cpp/open3d/pipelines/registration/Registration.cpp>
- Open3D 0.20.0, `cpp/open3d/pipelines/registration/RobustKernel.h`:
  <https://github.com/isl-org/Open3D/blob/v0.20.0/cpp/open3d/pipelines/registration/RobustKernel.h>
- Open3D 0.20.0, `cpp/open3d/geometry/PointCloudSegmentation.cpp`:
  <https://github.com/isl-org/Open3D/blob/v0.20.0/cpp/open3d/geometry/PointCloudSegmentation.cpp>
- CGAL 6.2.1, `Shape_detection/.../Efficient_RANSAC.h`:
  <https://github.com/CGAL/cgal/blob/v6.2.1/Shape_detection/include/CGAL/Shape_detection/Efficient_RANSAC/Efficient_RANSAC.h>
- CGAL 6.2.1, `Shape_detection/.../Cylinder.h`:
  <https://github.com/CGAL/cgal/blob/v6.2.1/Shape_detection/include/CGAL/Shape_detection/Efficient_RANSAC/Cylinder.h>
- CGAL 6.2.1, `Poisson_surface_reconstruction_3/.../poisson_surface_reconstruction.h`:
  <https://github.com/CGAL/cgal/blob/v6.2.1/Poisson_surface_reconstruction_3/include/CGAL/poisson_surface_reconstruction.h>
- CGAL 6.2.1, Shape_detection package license header:
  <https://github.com/CGAL/cgal/blob/v6.2.1/Installation/include/CGAL/license/Shape_detection.h>
- trimesh 5.2.0, `trimesh/registration.py`:
  <https://github.com/mikedh/trimesh/blob/5.2.0/trimesh/registration.py>
- trimesh 5.2.0, `trimesh/repair.py`:
  <https://github.com/mikedh/trimesh/blob/5.2.0/trimesh/repair.py>
- libigl 2.6.0, `include/igl/fit_plane.h`:
  <https://github.com/libigl/libigl/blob/v2.6.0/include/igl/fit_plane.h>
- libigl 2.6.0, `include/igl/procrustes.h`:
  <https://github.com/libigl/libigl/blob/v2.6.0/include/igl/procrustes.h>
- OpenCV 5.1.0, `modules/geometry/src/shapedescr.cpp`:
  <https://github.com/opencv/opencv/blob/5.1.0/modules/geometry/src/shapedescr.cpp>
- OpenCV 5.1.0, USAC:
  <https://github.com/opencv/opencv/tree/5.1.0/modules/geometry/src/usac>

### Papers and standards

- M. A. Wesley and G. Markowsky, "Fleshing out projections," *IBM Journal of
  Research and Development* 25(6):934-953, 1981.
- H. Sakurai and D. C. Gossard, "Solid model input through orthographic views,"
  *ACM SIGGRAPH Computer Graphics* 17(3):243-252, 1983.
- B.-S. Shin and Y. G. Shin, "Fast 3D solid model reconstruction from
  orthographic views," *Computer-Aided Design* 30(1):63-76, 1998.
- L. Hoang, "3D Solid Reconstruction from 2D Orthographic Views," IntechOpen,
  2020, DOI 10.5772/intechopen.91977.
- T. Marill, "Emulating the human interpretation of line-drawings as
  three-dimensional objects," *IJCV* 6(2):147-161, 1991.
- Y. G. Leclerc and M. A. Fischler, "An optimization-based approach to the
  interpretation of single line drawings as 3D wire frames," *IJCV*
  9(2):113-136, 1992.
- H. Lipson and M. Shpitalni, "Optimization-based reconstruction of a 3D object
  from a single freehand line drawing," *Computer-Aided Design* 28(8):651-663,
  1996.
- J.-D. Favreau, F. Lafarge and A. Bousseau, "Line Drawing Interpretation in a
  Multi-View Context," CVPR 2015, pp. 4018-4026.
- W. Hu et al., "PlankAssembly: Robust 3D Reconstruction from Three
  Orthographic Views with Learnt Shape Programs," ICCV 2023,
  arXiv:2308.05744.
- A. Joglekar et al., "Ortho2CAD: 3D CAD generation from orthographic drawings
  using vision language models," arXiv:2607.08891, 2026.
- M. A. Fischler and R. C. Bolles, "Random sample consensus: a paradigm for
  model fitting with applications to image analysis and automated
  cartography," *Communications of the ACM* 24(6):381-395, 1981.
- P. H. S. Torr and A. Zisserman, "MLESAC: A new robust estimator with
  application to estimating image geometry," *CVIU* 78(1):138-156, 2000.
- O. Chum, J. Matas and J. Kittler, "Locally optimized RANSAC," DAGM 2003.
- L. Moisan and B. Stival, "A probabilistic criterion to detect rigid point
  matches between two images and estimate the fundamental matrix," *IJCV*
  57(3):201-218, 2004.
- Z. Zhang, "Determining the epipolar geometry and its uncertainty: A review,"
  *IJCV* 27(2):161-195, 1998.
- B. Triggs, P. McLauchlan, R. Hartley and A. Fitzgibbon, "Bundle Adjustment -
  A Modern Synthesis," LNCS 1883, 2000.
- R. Schnabel, R. Wahl and R. Klein, "Efficient RANSAC for Point-Cloud Shape
  Detection," *Computer Graphics Forum* 26(2):214-226, 2007.
- A. Fitzgibbon, M. Pilu and R. B. Fisher, "Direct least square fitting of
  ellipses," *IEEE TPAMI* 21(5):476-480, 1999.
- K. Lebeda, J. Matas and O. Chum, "Fixing the Locally Optimized RANSAC,"
  BMVC 2012.
- M. Kazhdan, M. Bolitho and H. Hoppe, "Poisson Surface Reconstruction,"
  Symposium on Geometry Processing, 2006.

---

## 8. Verification, unverified claims and ranked recommendation

### 8.1 What was verified

- The exact projection equations in `docs/RECONSTRUCTION_CONTRACT.md`,
  `public/lib/educad-strict.js` and `public/lib/educad-project.js` agree.
- The 151-script baseline passes at `43d3b7f`:
  `TOTAL=151 FAIL=0`.
- The current curve consensus behavior was reproduced with
  `three-view-circle.edu`, `overlapping-curve-projections.edu` and
  `ambiguous-curve-projections.edu`.
- The current spline ambiguity and profile conflict behavior was reproduced with
  `spline-multiple-ambiguous.edu`, `spline-third-view-conflict.edu` and
  `profile-station-conflict.edu`.
- OSS versions, files and licenses were read from the pinned tags listed in
  section 2.7.

### 8.2 Unverified or judgment claims

- OSS runtime behavior was **not executed**. Defaults and algorithm descriptions
  come from source headers, comments and documentation at the pinned tags.
- No accuracy/performance benchmark was run against COLMAP, OpenMVG,
  AliceVision, Open3D, CGAL, trimesh or libigl. No claim is made that the
  proposed scorer beats them numerically.
- The proposed rank tuple and score weights are design choices, not tuned
  parameters. They need `.edu` calibration.
- The claim that robust consensus improves hand-drawn reconstruction is a
  design hypothesis, not a measured result.
- The exact line numbers and upstream behavior may drift after the pinned tags.
- Ortho2CAD's license status is "no LICENSE file found at the inspected
  revision"; this is not legal advice.
- PlankAssembly's AGPL status was verified, but its benchmark results were not
  reproduced.
- The 151-script pass is a regression baseline, not a proof of geometric
  correctness for every drawing.
- The suggested `correspondenceCandidates`, `selected`, `ellipseFit` and
  similar expectation keys do not exist yet; they are part of the proposed
  implementation.

### 8.3 Ranked recommendation

| Rank | Recommendation | Impact | Risk | Effort | Why |
|---|---|---|---|---|---|
| 1 | **Consensus v0**: shared evidence scorer + unique-evidence counting + ambiguity/outlier diagnostics, behavior-preserving | High | Low | 1-2 days | Turns existing pair heuristics into ranked hypotheses; immediate diagnostic value; no geometry change |
| 2 | **Robust conic/arc fitting**: direct ellipse LS + IRLS + mm residuals + covariance | High | Medium | 2-3 days | Fixes the weakest numerical part; improves matching gates and near-circular stability |
| 3 | **Global discrete partition** for points/curves using branch-and-bound and unique evidence | Medium-high | Medium | 3-5 days | Replaces greedy one-to-one matching; handles cross-products and third-view selection coherently |
| 4 | **Constrained refinement (BA analog)** for free parameters only, with exact rollback | Medium | High | 5-8 days | Extracts the useful part of BA without touching exact declarations |
| 5 | **Dimension/section constraints** as hard tie-breakers and ambiguity resolvers | Medium | Medium | Later | Uses engineering-drawing information the current pipeline ignores |
| 6 | **Optional RANSAC conic segmentation** for broken/flattened imported chains | Low-medium | Medium | Later | Useful only when loop topology is unreliable; not the primary path |
| 7 | **No new runtime dependency** on COLMAP/OpenMVG/AliceVision/Open3D/CGAL/trimesh/libigl/OpenCV | - | - | 0 | Preserves MIT/zero-dep and avoids GPL/MPL complications |

The strategic recommendation is rank 1 first, then rank 2. Ranks 3 and 4 should
be designed now but implemented only after the scorer has shown stable behavior
on the existing 151 scripts.

### 8.4 Smallest next milestone

**Milestone: Consensus v0 for curve candidates.**

Scope:

- Add `public/lib/educad-correspondence.js` with:
  - an evidence record per source entity,
  - interval merging and unique-source accounting,
  - a `scoreHypothesis` function using the rank tuple,
  - a `resolve` function returning selected/top-k/ambiguity/outlier records.
- Wire it into `public/lib/educad-curve-reconstruct.js` in place of the current
  `candidateSupport` sort, without changing which geometry is emitted for
  existing scripts.
- Expose `correspondence` and `fit` blocks from
  `public/lib/educad-reconstruct.js`.
- Add `third-view-contradiction`, `view-silent`, `evidence-outlier` and
  `correspondence-ambiguous` diagnostic records. Keep existing codes for
  backward compatibility.
- Add four `.edu` scripts:
  `consensus-third-view-selects.edu`,
  `consensus-third-view-contradicts.edu`,
  `consensus-silent-view.edu`,
  `consensus-outlier-stroke.edu`.
- Run all 151 existing scripts plus the four new ones.

Acceptance criteria:

1. `three-view-circle.edu` still yields one curve and no diagnostics.
2. `overlapping-curve-projections.edu` still yields two curves and no
   diagnostics.
3. `ambiguous-curve-projections.edu` still yields four curves and two
   `curve-projection-ambiguous` diagnostics.
4. `consensus-third-view-contradicts.edu` reports
   `third-view-contradiction` and selects the supported curve.
5. `consensus-silent-view.edu` reports `view-silent` but does **not** report
   ambiguity.
6. `consensus-outlier-stroke.edu` reports `evidence-outlier` and retains the
   valid geometry.
7. The full `.edu` suite passes with no changed vertex/edge/face counts.

Why this is the smallest useful milestone: it adds the evidence model and the
diagnostics without changing the exact kernel, without adding a dependency, and
without committing to a global partition or a new solver. It gives immediate
value on ambiguous drawings and creates the data structure that ranks 2-4 need.

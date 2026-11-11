# Constraint-based and solver-based 2D→3D reconstruction

Status: research/design only. No production code changed.
Scope: **Major** only. Major2 is out of scope.
Date: 2026-11-11.

This report asks what EduCAD should borrow from geometric constraint solvers, and
what it should not. It is based on the current Major pipeline, on source review
of SolveSpace and FreeCAD's planeGCS, and on the documented behavior of Z3 and
Ceres. No solver code was copied; the recommendations are clean-room designs
expressed as equations and data contracts.

The short version:

> EduCAD already has a small exact constraint **model**, but it does not have a
> constraint **solver**. The projection equations are linear, exact and local;
> identity is combinatorial; most ambiguous cases are discrete, not numeric.
> The right next step is therefore exact linear/combinatorial solving with
> explicit alternatives, not a general nonlinear solver or an SMT runtime.

---

## 1. Our current constraint model and failure modes

### 1.1 What is actually constrained today

Major has four different mechanisms that are easy to mistake for one solver.

**(a) Strict identity and projection kernel.**
`public/lib/educad-strict.js` treats each member ID as a spatial vertex with
coordinates `(x, h, d)`. A point station contributes equations according to its
declared view:

```text
front / ELEVATION:  x = u,  height = v
top / PLAN:         x = u,  depth = -v
side / PROFILE:     height = v,
                    depth = dRef + s * (u - xRef)
```

These are linear equations. For each member, the kernel accumulates assignments
to `x`, `height` and `depth` (`assign`, `educad-strict.js:170-174`). Two different
values for the same axis are an immediate `coordinate-conflict`. If any axis is
missing, the member is `coordinates-missing` and the model is
`underdetermined` (`educad-strict.js:217-220`). If all three axes are present,
the member has exactly one value. That is a complete and exact decision
procedure for the point-observation fragment, but it is not a general solver.

**(b) Name + projection compatibility.**
`autoMembersForStrict` (`educad-reconstruct.js:2560-2751`) turns auto-labelled
stations into shared IDs when a base name matches and the shared projection axis
agrees. Plan/elevation share `x`; plan/profile share `depth` through the declared
side frame; elevation/profile share `height`. It is deliberately one-to-one at
a station (`uniqueMatch`, lines 2632-2638) and refuses contradictory or multiple
candidates. It never averages or snaps; it also never reports the rejected
candidates as alternatives. This fallback is the compatibility layer for legacy
captions and table-created auto members, not the identity model.

**(c) Live wire builder.**
`liveCore` (`educad-reconstruct.js:3126-3851`) is the older heuristic path. It
pairs named plan/elevation points at the same `x` station, optionally requires
projector ink, resolves overlapping stations by coverage, builds edges by
endpoint candidacy, and then infers planar faces. It is a set of geometric
recognizers with tolerances, not a constraint solve. The shared `reconstruct()`
uses it for inferred drawings (`educad-reconstruct.js:2891`).

**(d) Curve correspondence and surface inference.**
`educad-parametric-reconstruct.js` enumerates reversed/rotated station orders,
proposes 3D point sequences from view pairs, and partitions a family into
spatial curves subject to one-source-per-view and identity consistency
(lines 30-53, 172-285). The oblique kernel and the bounded-surface pipeline infer
planes, cylinders, cones, spheres, recesses and blends from curve evidence.
These are model-selection procedures, not a solver that satisfies a declared
constraint set.

The only genuine hard constraints are:

- explicit member IDs shared across stations;
- declared view/projection observations;
- declared segment endpoints (`endpointMemberIds`);
- declared topology triangles;
- the declared profile frame.

Everything else is evidence, a heuristic, or an inference convention.

### 1.2 Tolerances and arithmetic are not one policy

The codebase uses at least five different notions of "same":

| Constant / path | Value | Use |
|---|---:|---|
| `WELD_MIN_MM` | `1e-6 mm` | minimum weld radius |
| `WELD_REL` | `1e-4` | relative weld radius |
| `WELD_MAX_MM` | `0.5 mm` | maximum weld radius |
| `MATCH_EPS_MM` | `0.5 mm` | live pairing and point coverage |
| `LOOSE_EPS_MM` | `2.5 mm` | loose geometric matching |
| `COVERAGE_GATE` | `0.999` | stroke coverage |
| `AUTO_EPS` | `1e-6 mm` | auto-member grouping |
| curve `EPS` | `1e-6` | parametric station agreement |
| strict equality | exact decimal rational | `educad-strict.js` |
| `edc.js` projector check | `1e-9`, lowercased names | runner pre-check |

Sources: `educad-reconstruct.js:33-40`, `educad-parametric-reconstruct.js:6`,
`educad-strict.js:14-20`, `tools/edc.js:18-20,38`.

This is a real semantic problem, not just a tuning detail. The same sheet can be
"ok" through the live path and "coordinate-conflict" through the strict path.
A concrete example:

```text
/point a' 0.30000000000000004 10 elevation
/point a  0.3                   -10 plan
```

The live path groups the two stations by a `1e-6` key and emits an **averaged**
`x`; the strict path compares the exact decimal values and reports
`coordinate-conflict`. I verified both behaviors with the current runner. The
strict contract says no averaging; the live builder does average
(`educad-reconstruct.js:3321`). The report's rule "do not average" is therefore
true for strict, but not for the live reader.

A second concrete inconsistency: `baseNameOf` is case-sensitive
(`educad-reconstruct.js:1489-1502`), while `tools/edc.js` lowercases names for
its projector alignment check (`tools/edc.js:18-20`). A sheet with `A'` and `a`
is reported by the runner as "projectors aligned: a" but strict reconstruction
does not pair the stations. I verified this too.

### 1.3 Failure modes that matter for underdetermined and ambiguous drawings

| ID | Failure | What happens now | Why it matters |
|---|---|---|---|
| F1 | One view only | Strict returns whole-model `underdetermined`, no geometry | A plan-only profile is useful as a 2D constraint; refusal loses partial information |
| F2 | Same base, several candidates | `uniqueMatch` returns null; stations stay separate; diagnostics say `coordinates-missing` | Ambiguity is misreported as missing information; no alternatives are offered |
| F3 | Caption alias / case mismatch | No pair; `coordinates-missing` | Names are display metadata, but the fallback can still block a geometrically obvious pair |
| F4 | Exact authoring noise | Strict `coordinate-conflict` for values differing by one ULP | Exact decimal is honest, but the UX must show the conflicting observations and offer a deliberate tolerance mode |
| F5 | Profile without declared frame | `profile-frame-missing`, whole model unavailable | Profile evidence is unusable even when the frame can be inferred safely elsewhere |
| F6 | One explicit member in a mixed drawing | `declared` becomes true for the whole list; strict owns the whole drawing | One authored station can suppress partial live geometry for unrelated legacy points |
| F7 | Contradiction | First/any conflicting assignments produce issues; status precedence hides the rest | No minimal conflict set; no "remove one of these" diagnosis |
| F8 | Dimensions | `DIMENSION` is skipped by strict (`educad-strict.js:232`); it is annotation-only | The docs say dimensions may resolve ambiguity, but the implementation never consumes them |
| F9 | Curve ambiguity | Family is all-or-nothing; equally strong partitions produce `curve-correspondence-ambiguous` and no curve | A single ambiguous family discards otherwise supported curves; enumeration is capped at 512 |
| F10 | Surface ambiguity | Inference conventions choose a family; `curve-surface-unresolved` where the boundary alone does not select one | Correct epistemically, but there is no constraint vocabulary to let the user resolve it |
| F11 | Topology limits | Planar face cycles limited to 10 edges; manifold search has a 250,000-step budget and returns no faces on exhaustion or ambiguity | Larger valid models degrade to partial rather than guessing |
| F12 | Visibility | Sampled occlusion; used only to choose an oblique mirror | Cannot be a hard constraint or a certificate |
| F13 | Incremental edits | Every rebuild re-runs the whole pipeline; strict surface checks are O(F²) | Interactive latency and unstable branch choices |
| F14 | Diagnostics | Code/entity/member only; no constraint IDs, strength, DOF count or free-axis list | Users cannot tell "free", "ambiguous", "contradictory" or "unsupported" apart |

Some of these are deliberate and good: no welding, no snapping, no guessing.
The recommendation is not to relax that discipline. It is to **report more**,
not to guess more.

### 1.4 What must be preserved

Any redesign must keep these properties:

1. Explicit member IDs are authoritative.
2. Captions, hidden parentheses, view position and screen visibility do not
   create or destroy identity.
3. Observations are never averaged or snapped in the exact path.
4. Declared geometry and inferred geometry remain distinct.
5. A certificate says what was proved, not what was drawn.
6. Unsupported geometry is reported, not silently approximated.
7. Reconstruction remains a pure function of the drawing plus explicit options.

---

## 2. Constraint taxonomy for orthographic reconstruction

Let a spatial vertex be `p_i = (x_i, h_i, d_i)`. Let the three principal
projections be:

```text
pi_F(p) = (x, h)                              front / elevation
pi_T(p) = (x, -d)                             top / plan
pi_S(p) = (xRef + s*(d - dRef), h)            side / profile
```

The classes below are ordered from cheap and exact to expensive and
interpretive. The "kind" column uses **L** linear, **P** polynomial,
**T** transcendental/parametric, **D** discrete/combinatorial.

| Class | Constraint form | Kind | Current support | Recommended role |
|---|---|---|---|---|
| Frame / units | declared `xRef, dRef, s`, mm | L | yes | hard declaration |
| Projection | `x=u`, `h=v`, `d=-v`, `d=dRef+s(u-xRef)` | L | yes | hard observation |
| Identity | `p_i = p_j` | L / D | explicit IDs and unique name fallback | hard if explicit; candidate otherwise |
| Name compatibility | candidate edge between stations with same base and agreeing shared axis | D | partial | ranked evidence, enumerable |
| Point incidence | `p` on line `ab`, on circle `(c,r)`, on plane `(n,a)` | P | only via edges/curves | hard when declared |
| Coverage | projected interval `[t0,t1]` contained in drawn union | L (1D) | live heuristic | exact evidence gate |
| Tangency | `dist(c, line)^2 = r^2` with side; `F=G`, `grad F` parallel to `grad G` | P | surface recognizers only | inferred constraint |
| Parallel / perpendicular | `(b-a) x (d-c) = 0`; `(b-a).(d-c)=0` | P | not general | inferred constraint |
| Symmetry | midpoint on axis/plane, difference perpendicular to it | L + P | not general | inferred constraint |
| Distance dimension | `norm(p-q)^2 = L^2` | P | ignored | driving or reference |
| Radius / diameter | `norm(p-c)^2 = r^2`, `r=d/2` | P | curve fitting | driving or reference |
| Angle dimension | `(u.v)^2 = cos^2(theta) * norm(u)^2 * norm(v)^2` plus sign | P | ignored | driving or reference |
| Equal length / radius | difference of squared norms = 0 | P | not general | inferred constraint |
| Coaxial / coplanar | axes parallel + point offset; scalar triple product = 0 | P | some recognizers | inferred constraint |
| Support surface | all boundary points satisfy `F(p; theta)=0` | P / T | yes, per family | model selection + validation |
| Visibility | ray/segment occlusion predicate; hidden/visible verdict | D + L | sampled | evidence only, never existence |
| Topology | edge incidence, face loops, manifold, orientation | D | strict triangles; inferred planar faces | exact combinatorial |
| Nondegeneracy | `norm(p-q)^2 > 0`, triangle area^2 > 0, `r > 0` | P inequalities | exact predicates in strict | hard |
| Design intent | horizontal/vertical, smooth G1/G2, equal spacing, pattern | P / D | ad hoc | inferred preference |

Two important distinctions:

- **Squared distances are polynomial.** `norm(p-q)^2 - L^2 = 0` avoids square
  roots. Tangency to a circle, point-on-circle and equal-radius are polynomial.
  Angles can be encoded with dot/cross products and sign conditions, avoiding
  `atan2`.
- **Visibility is not a geometric equality.** It is a disjunction over occluders
  plus an ordering along the projection ray. It should rank alternatives, not
  decide whether a vertex exists. This matches the current strict contract:
  hidden verdicts never remove constraints (`RECONSTRUCTION_CONTRACT.md:62-66`).

A useful strength lattice for the data model:

```text
exact observation   must hold exactly; contradiction is an error
driving declaration must hold within solver tolerance; user-authored
inferred constraint chosen by a named inference rule; may be rejected
evidence            only ranks otherwise valid alternatives
preference          weak tie-breaker; never creates geometry
```

This is the main missing concept in the current code. `coordinate-conflict` and
`curve-correspondence-ambiguous` are both "problems", but they are different
kinds of problem and need different repairs.

---

## 3. OSS solver architectures and diagnostics

### 3.1 SolveSpace v3.3

Version: tag `v3.3`, commit `30e1c3ac0beb77fe3e098315b1bb662840ddc99a`,
2026-10-20. License: GPL-3.0-or-later.

SolveSpace is the closest architectural match to a "sketch with constraints"
solver. Its unit is a **group**: a collection of entities and constraints solved
together. Entities include points in 2D/3D, line segments, cubics, circles,
arcs, workplanes, text and images (`src/sketch.h:422-456`). Constraints include
coincidence, point-point/point-line/point-plane/point-face distance,
point-on-line/face/circle, equal length/radius/angle, length ratio, symmetry,
midpoint, horizontal/vertical, diameter, angle, parallel, perpendicular,
tangency, and "where dragged" (`src/sketch.h:659-699`). Constraints apply in
3D by default, or projected into a workplane; point-coincident, distance, angle
and point-on-curve all have projected forms (SolveSpace tech page and constraint
reference).

The solver architecture:

1. **Symbolic equations.** Each constraint and entity generates equations over
   scalar parameters. Parameters are coordinates and angles, not whole entities.
2. **Symbolic Jacobian.** `WriteJacobian` deep-copies each equation, computes
   symbolic partial derivatives, folds constants, and stores a sparse matrix
   (`src/system.cpp:22-77`). This is a key design choice: derivatives are exact
   expressions, not finite differences.
3. **Substitution and standalone equations.** `SolveBySubstitution` eliminates
   `a = b` parameter equalities; equations with a single parameter are solved
   alone before the coupled system (`src/system.cpp:99-235, 544-571`).
4. **Least-squares Newton.** The remaining system is solved by a modified Newton
   iteration. For underdetermined systems it computes a minimum-norm
   least-squares step; for overdetermined systems it minimizes the residual
   (`src/system.cpp:273-352`). A backtracking line search halves the step until
   the residual decreases (`src/system.cpp:354-432`).
5. **Rank diagnostics.** `CalculateRank` uses sparse QR; `TestRank` sets
   `dof = n - rank` and accepts the system only when `rank == m`
   (`src/system.cpp:238-259`). If the rank is short, `FindWhichToRemoveToFixJacobian`
   removes each constraint in turn and re-tests the rank, producing a list of
   constraints whose removal repairs the system (`src/system.cpp:469-513`).
6. **Solve result.** `OKAY`, `DIDNT_CONVERGE`, `REDUNDANT_OKAY`,
   `REDUNDANT_DIDNT_CONVERGE`, `TOO_MANY_UNKNOWNS`
   (`src/solvespace.h:46-52`). The UI reports unsolvable constraints, redundant
   constraints ("remove any one of these"), and the remaining DOF
   (`src/textscreens.cpp:622-696`).

The important lessons are architectural, not numerical:

- constraints are first-class symbolic equations, not ad-hoc checks;
- the Jacobian is sparse and analytic;
- DOF is `n - rank`, not a hand-maintained counter;
- diagnostics are constraint-level, not just entity-level;
- the initial drawing selects the solution branch. The documentation is explicit
  that multiple solutions exist, that a fully constrained sketch can still be
  ambiguous, and that the solver chooses by the initial configuration
  (SolveSpace tutorial, "Constraints", sections on ambiguous solutions).
- There is no global uniqueness proof and no exact certificate. A converged
  numerical solution is not a proof that the declared constraints have one
  solution.

Citations:
<https://github.com/solvespace/solvespace/tree/v3.3>,
<https://solvespace.com/tech.pl>,
<https://solvespace.readthedocs.io/en/latest/constraints/>,
<https://github.com/solvespace/solvespace/blob/v3.3/COPYING.txt>.

### 3.2 FreeCAD 1.1.4 Sketcher / planeGCS / GCS

Version: tag `1.1.4`, commit `4fd3bf320d9566a27e60069fc8387448aaa3a094`.
License: LGPL-2.1-or-later per `LICENSE`; individual GCS headers state GNU
Library GPL v2 or later.

FreeCAD's `GCS::System` is a more elaborate version of the same idea. It stores:

- `plist`: unknown scalar parameters;
- `clist`: solver constraints;
- `c2p` / `p2c`: constraint-to-parameter and parameter-to-constraint adjacency
  (`GCS.h:110-123`);
- high-level constraint tags that group several solver equations;
- a reference configuration for reset (`GCS.cpp:1711-1734`).

`initSolution` does the structural work before solving (`GCS.cpp:1711-1846`):

1. store the current values as the reference;
2. run diagnosis if needed;
3. partition the constraint/parameter graph into connected components using
   Boost graph connected components;
4. eliminate equality constraints tagged `>= 0` by parameter substitution;
5. build one `SubSystem` for driving constraints and one auxiliary subsystem for
   non-driving constraints;
6. solve each subsystem independently.

The nonlinear solve is one of `BFGS`, `LevenbergMarquardt`, or `DogLeg`
(`GCS.h:52-66`, `GCS.cpp:1869-1932`). If the primary solver fails, `Sketch.cpp`
falls back through the other solvers and finally an augmented SQP system with
temporary equality constraints anchoring the initial parameters
(`Sketch.cpp:4786-4935`). `SolveStatus` distinguishes `Success` (zero residual),
`Converged` (residual minimized), `Failed`, and `SuccessfulSolutionInvalid`
(`GCS.h:52-59`).

Diagnosis is the most relevant part for EduCAD (`GCS.cpp:4738-5036`):

- a reduced Jacobian contains only driving constraints and removes driven-value
  parameters;
- two QR decompositions are used: one for constraints and one for parameters;
- `dofs = paramsNum - rank`;
- if `constrNum > rank`, it builds conflict groups from the R factor and runs a
  reduced solve;
- a constraint is classified as **redundant** if removing it still leaves a
  solvable system, and **conflicting** if the reduced system cannot satisfy it;
- **partially redundant** constraints are those that are redundant in some but
  not all solver equations associated with one high-level constraint;
- the conflict/redundant selection is heuristic and explicitly not a minimal
  set (`GCS.cpp:5492-5548`).

The UI exposes exactly the vocabulary EduCAD lacks: empty, over-constrained,
malformed, redundant, partially redundant, solver failed to converge,
under-constrained with `n DoF(s)`, fully constrained
(`FreeCAD-documentation`, `wiki/Sketcher_Dialog.md:20-41`). It also offers
"select elements with DoF", "select redundant constraints" and "select
conflicting constraints" (`wiki/Sketcher_SelectRedundantConstraints.md`,
`wiki/Sketcher_SelectConflictingConstraints.md`). Advanced solver controls
describe dense/sparse QR, iterative limits, convergence, and redundant-solving
settings (`wiki/Sketcher_Dialog.md:58-125`).

Citations:
<https://github.com/FreeCAD/FreeCAD/tree/1.1.4>,
<https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Sketcher/App/planegcs/GCS.cpp>,
<https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Sketcher/App/planegcs/GCS.h>,
<https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Sketcher/App/Sketch.cpp>,
<https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Dialog.md>,
<https://github.com/FreeCAD/FreeCAD/blob/1.1.4/LICENSE>.

There is also a standalone Python wrapper, `planegcs`
(<https://github.com/spookylukey/planegcs>), which extracts the 2D planeGCS
solver from FreeCAD and exposes it as a Python library. Its README states
LGPL-2.1-or-later. It is 2D only; it does not provide 3D constraints or
orthographic view semantics.

### 3.3 KittyCAD geometric-constraint-playground

This is an experimental MIT-licensed Rust/Python playground, not a production
solver (<https://github.com/KittyCAD/geometric-constraint-playground>). Its
README is a useful concise statement of the same architecture:

- residual per constraint, e.g. `current_distance - target_distance`;
- Newton for square full-rank systems;
- Gauss-Newton/least squares for overdetermined systems;
- Tikhonov/minimum-norm regularization for underdetermined systems;
- rank estimation via SVD or QR to distinguish underdetermined from exactly
  determined; "identifying truly overconstrained systems is more complex";
- structural separation of decoupled systems and symbolic substitution;
- residual scaling because distances and angles have different units;
- diagnostics (DOF, rank, sketch state) are listed as future work.

This is a good sanity check: even a modern implementation treats diagnostics as
the hard part.

### 3.4 OSS engineering-drawing reconstruction

I did **not** find a mature open-source project that reconstructs 3D from
orthographic views through a general geometric constraint solver. The closest
projects fall into other categories:

- **QRec** (`elrinor/qrec`, 2015): a proof-of-concept DXF→3D tool using section
  identification and a CSG-based method, not a constraint solver
  (<https://github.com/elrinor/qrec>). No clear license was found; do not copy.
- **cad-reconstruction-agent** (2026, MIT): an early prototype that extracts
  DXF/DWG evidence, proposes feature candidates, and validates B-Rep,
  dimensions and reprojection with OpenCascade
  (<https://github.com/NoNome1238/cad-reconstruction-agent>). Its README
  describes evidence/candidate search; I did not independently evaluate it.
- **Ortho2CAD** (2026): a vision-language model that emits CadQuery code from
  raster orthographic drawings, not a constraint solver
  (<https://github.com/AdityaJoglekar/Ortho2CAD>). At the time of access no
  `LICENSE` file was present in the repository.
- **PlankAssembly** (ICCV 2023), GaussianCAD and similar learned systems recover
  shapes but not declared constraints; they are not useful as a correctness
  layer for EduCAD.

Classical reconstruction work (Idesawa 1973; Markowsky & Wesley 1980; CSG/B-rep
volume methods) is combinatorial and predates modern constraint solvers. A 2026
survey summarizes the field as rule-based, CSG-based, optimization-based and
learning-based, and notes that explicit constraints and design history are
usually lost
(<https://cad-journal.net/files/vol_23/CAD_23(6)_2026_646-678.pdf>).

Conclusion: EduCAD's niche — exact projection constraints + explicit member
identity + inferred surfaces — is not covered by an existing OSS solver. Borrow
architecture and diagnostics; do not expect a drop-in library.

### 3.5 Comparison with EduCAD's four mechanisms

| EduCAD mechanism | Closest solver concept | Current difference | Recommendation |
|---|---|---|---|
| Name + `x` compatibility | Candidate correspondence / coincidence with evidence | SolveSpace and FreeCAD require the user to declare coincidence; EduCAD guesses by caption, but only accepts a unique match and reports failures as missing coordinates | Treat it as a scored matching problem with explicit alternatives; never let a caption override an explicit ID |
| Explicit member IDs | Equality substitution / union-find | Strict does per-member assignment propagation, not rank/nullspace analysis; SolveSpace substitutes `a=b` parameters and FreeCAD reduces equalities before solving | Keep IDs authoritative; add exact component rank and free-axis reporting |
| Pairwise curve matching | Discrete constraint satisfaction / permutation search | Current code enumerates orders and partitions, scores identities, caps at 512 and discards the family on ambiguity; SolveSpace/FreeCAD do not solve correspondence at all | Keep enumeration, but return supported curves and report the ambiguous family separately; use branch-and-bound with a deterministic cap |
| Analytic surface inference | Model selection + parameter fitting, not a constraint solve | Current recognizers choose a surface family from silhouettes, tangency and extents; SolveSpace/FreeCAD would require the user to declare the surface | Keep inference; validate the chosen family with exact boundary incidence and report `inferred`; do not let a surface fit choose correspondence |

The pattern is consistent: EduCAD is stronger than a classical solver at
**inferring** relationships and weaker at **explaining** them. The hybrid should
add explanation and alternatives without giving up inference.

---

## 4. Exact constraints vs least squares vs SMT

### 4.1 Guarantees

**Exact linear/rational systems.**
For linear equalities `A x = b` over the rationals:

- consistency is decidable by exact elimination;
- if consistent, the solution set is an affine subspace;
- `rank(A) = n` gives a unique solution;
- `rank(A) < n` gives `n - rank(A)` free directions and an exact basis;
- if the augmented rank exceeds `rank(A)`, the system is inconsistent;
- no tolerance is required.

This is exactly the fragment needed for view observations, explicit identity,
frame equations, axis-aligned dimensions and coverage intervals. The current
strict kernel already uses exact decimal rationals (`educad-strict.js:14-25`),
but only does per-member assignment propagation, not general rank/nullspace
analysis.

**Exact polynomial systems (SMT/NRA).**
The existential theory of the reals is decidable (Tarski; CAD; NLSAT). For
quantifier-free polynomial constraints, a complete procedure can answer `sat`
or `unsat` and produce an algebraic model. This covers squared distances,
circle/line tangency, point-on-circle, parallel/perpendicular cross products,
symmetry and polynomial angle encodings. It does **not** cover `sin`, `cos`,
`atan2`, logarithms, or arbitrary NURBS parameterizations without algebraic
elimination. It also does not directly enumerate all solutions; you enumerate by
blocking models, which is only practical for finitely many isolated solutions.

**Least squares.**
A least-squares solve always returns a minimizer (subject to convergence and
bounds), but:

- a zero residual does not prove exact satisfiability unless the arithmetic is
  exact;
- a nonzero residual may be a local minimum, a bad initial guess, or a genuinely
  inconsistent system;
- underdetermined systems need a minimum-norm or anchor choice; that choice is a
  modeling decision, not a consequence of the constraints;
- overdetermined systems produce a compromise that can silently move exact
  observations unless those are eliminated or heavily weighted;
- the Jacobian rank at the solution gives only **local infinitesimal** DOF, not
  global rigidity or uniqueness;
- the initial guess selects the branch.

Ceres is a mature implementation of this class: bounds-constrained robust
nonlinear least squares, sparse Jacobians, trust-region LM, covariance
estimation, and explicit rank-deficiency handling (pseudoinverse; by default
covariance computation fails on a rank-deficient Jacobian). It is not an exact
constraint solver and has no discrete constraints
(<https://ceres-solver.readthedocs.io/latest/nnls_modeling.html>,
<https://ceres-solver.readthedocs.io/latest/nnls_covariance.html>).

### 4.2 Ambiguity and underdetermination

The key distinction:

```text
underdetermined: a continuum of solutions (rank < n)
ambiguous:       finitely many discrete solutions, several with equal evidence
inconsistent:    no solution
```

A rank test finds the first. It cannot find the second. The SolveSpace tutorial's
fully constrained triangle with four mirror solutions is the canonical example:
zero DOF by rank, four valid realizations. FreeCAD's "fully constrained" message
has the same limitation. The current EduCAD curve matcher already handles a
discrete version of this by enumerating orders and partitions
(`educad-parametric-reconstruct.js:172-285`), but it collapses the result to
"ambiguous" and discards the alternatives.

The witness method is the standard way to improve on a single Jacobian rank:
evaluate the Jacobian at a generic witness configuration that preserves the
singular incidence structure, then use its kernel to detect structural and
non-structural dependencies (Michelucci & Foufou, "Interrogating witnesses for
geometric constraint solving", *Information and Computation* 216 (2012) 24-38,
<https://doi.org/10.1016/j.ic.2011.09.006>). It is more informative than raw
rank but still does not enumerate finite realizations.

### 4.3 SMT/NRA: guarantees and limits

Z3 5.4.1 is MIT-licensed. Its NLSAT engine implements a complete decision
procedure for the polynomial real fragment, using model-constructing search and
CAD-style projection (`Z3 Internals`, §2.2 and §3.3.3,
<https://z3prover.github.io/papers/z3internals.html>). The original NLSAT paper
is Jovanović & de Moura, IJCAR 2012,
<https://doi.org/10.1007/978-3-642-31365-3_27>.

But "complete procedure exists" is not the same as "the default solver always
answers." Z3's own guide warns that nonlinear real arithmetic is expensive and
that `check-sat` may return `unknown` or loop; it explicitly separates the
polynomial fragment from incomplete transcendental support
(<https://microsoft.github.io/z3guide/docs/theories/Arithmetic/>). The complete
NLSAT route is a tactic/fragment property, not a blanket runtime guarantee.
Transcendental constraints (`sin`, `cos`, `exp`, `log`) are incomplete and should
not be used for certification.

Performance is the decisive issue. CAD-based NRA is doubly exponential in the
number of variables in the worst case (cvc5 system description, IJCAR 2022,
<https://gereon-kremer.de/static/2022-ijcar-nonlinear.pdf>). SMT-COMP QF_NRA
benchmarks show thousands of solved instances, but those are small, curated
problems; they are not evidence that a 200-vertex drawing with visibility
disjunctions will solve in a browser per keystroke. SMT is a good **oracle** and
a good **proof tool**, not an interactive sketcher.

### 4.4 Comparison table

| Property | Exact linear/rational | Least squares (GN/LM) | SMT (QF_NRA) |
|---|---|---|---|
| Projection equations | exact, cheap | unnecessary | possible but overkill |
| Identity/incidence | exact combinatorial | awkward | possible with Bool/equalities |
| Parallel/tangent/symmetry | possible if polynomial | natural | natural, exact if polynomial |
| Underdetermined | exact nullspace basis | min-norm/anchor, arbitrary | model, but no free-direction basis |
| Overdetermined consistent | detect redundancy exactly | best fit | detect and prove redundancy |
| Inconsistent | exact conflict | residual only | exact unsat, possibly core |
| Finite ambiguity | enumerate discrete branches | initial guess picks one | enumerate by blocking models |
| Continuum ambiguity | nullspace | one point | one model, not a parameterization |
| Visibility/disjunction | awkward | not differentiable | possible but combinatorial |
| Global guarantee | yes for linear | no | yes for polynomial fragment, if it answers |
| Interactive performance | excellent | good with warm start | poor for large systems |
| Browser / zero-dep fit | native BigInt | needs linear algebra | huge WASM/native dependency |
| Diagnostics | rank, nullspace, exact conflict | residual, local rank | sat/unsat/unknown, model, maybe core |

The correct reading is not "pick one." It is:

- exact for what is linear or combinatorial;
- least squares for what is genuinely approximate or overdetermined;
- SMT only for small offline verification and hard finite ambiguity.

---

## 5. Recommended hybrid for EduCAD

### 5.1 Design rule

> **Exact-first, optimize-second, enumerate-discrete, never average.**

Every constraint carries a strength and a source. The solver tries the strongest
layer that can decide it, and it reports the weakest unresolved layer rather
than collapsing everything to one status.

### 5.2 Layers

**L0 — Constraint IR and provenance.**
Build one normalized model from entities, members, dimensions, curves and
surfaces. Every constraint records:

```text
id, type, strength, source entity/member/view IDs,
targets, value/unit, frame, enabled
```

No solver logic in the parser. The IR is the single input to exact, numeric and
diagnostic layers.

**L1 — Exact projection and linear layer.**
This generalizes what `educad-strict.js` already does:

- union-find explicit member identities;
- assign view equations exactly;
- detect contradictions with both source station IDs;
- compute, per connected component, the exact rank and nullspace of the
  remaining linear constraints;
- return a partial solution with `freeAxes` rather than `geometry: null`.

For a plan-only point, the answer should be:

```text
determination: underdetermined
dof: 1
free: [{member: "a", axis: "depth"}]
geometry: {point a at (x, h, null)}  // or a 2D constraint record
```

not "whole model unavailable." If an edge needs the free coordinate, that edge
is unresolved; the rest of the drawing remains useful.

**L2 — Combinatorial correspondence layer.**
This is where most current ambiguity lives.

- Candidate graph: nodes are stations/members; edges are compatibility evidence.
- Mandatory merges: explicit shared IDs, declared projectors with selected
  members, `membersDeclared` assignments.
- Optional matching: same base name + agreeing shared projection axis, one-to-one
  at a station.
- Score: explicit ID > declared projector > shared base + all shared axes >
  shared base + one axis > geometric proximity (tie-break only, never proof).
- Find a maximum matching. Enumerate all maximum matchings up to a small cap
  (e.g. 8 or 16). If several produce different 3D geometry, report
  `ambiguous` with alternatives and evidence; do not pick the first.
- Profile links require a declared frame. An inferred frame is allowed only in
  inferred mode and is marked `profileInferred`.
- Curve correspondence is the same problem with cyclic order/reversal. Keep the
  current score and partition logic, but:
  - return supported curves even when one family is ambiguous;
  - report the ambiguous family separately;
  - cap enumeration with a deterministic beam and a diagnostic, not silent
    truncation.

This is a discrete constraint solver, and it is the highest-value addition.
It directly fixes F2, F3, F9 and most "same base name" failures.

**L3 — Optional nonlinear refinement.**
Only for constraints that are genuinely nonlinear and only on variables that
remain free after L1/L2:

- parallel/perpendicular, tangency, symmetry, equal length/radius, general
  distance/angle dimensions, coaxial/coplanar, smooth continuity;
- curve fitting to sampled strokes, ellipse/conic fits, support-surface fitting;
- use Gauss-Newton or Levenberg-Marquardt with sparse QR and column scaling;
- gauge-fix global translation/rotation (and scale if unconstrained) or add a
  weak anchor to the drawn configuration;
- solve hard nonlinear constraints to a stated tolerance; if the residual
  cannot be reduced, report a conflict set, not a moved observation;
- never move exact observations. Substitute them as constants or eliminate them;
- mark the result `inferred` and do not attach the exact certificate.

For dimensions, offer three modes:

```text
ignore      annotation only (current behavior)
reference   measured and reported, never drives geometry
driving     hard/soft constraint, user-authored, reported as such
```

Default should be `reference` for imported drawings and `driving` for explicit
user dimensions. A contradictory pair of driving dimensions is a conflict, not
an invitation to average.

**L4 — Discrete branch enumeration.**
After L2/L3, enumerate the remaining finite choices:

- correspondence alternatives from L2;
- depth mirror choices (`d` vs `-d`) where the views do not select one;
- oblique plane normal sign;
- visibility-consistent mirror;
- surface family where finite (plane vs cylinder vs cone, cap vs recess).

Solve each branch, deduplicate by geometry, and report:

```text
alternatives: [{id, geometry, evidence, score, determination}]
```

If exactly one branch survives, accept it and keep the rejected branches as
diagnostic evidence. If several survive with equal evidence, `ambiguous`.
Never return "missing coordinates" for a finite choice.

**L5 — Surface and topology inference.**
Keep this as model selection, not constraint solving:

- boundary loops are exact incidence data;
- fit a surface family to the loops;
- validate boundary-on-surface exactly where possible, numerically where not;
- use constraints (coaxial, coplanar, tangent, equal radius) to rank families;
- retain the existing distinction between declared geometry, inferred display
  geometry, analytic surface certificate and display triangulation certificate.

A surface fit must not choose a correspondence that the views did not support.
That would be circular inference. This is already the stated policy for
occlusion by newly inferred curved patches (`PRIMITIVE_RECONSTRUCTION.md:231-239`).

### 5.3 Which constraints stay exact

| Constraint | Exact layer | Optimization | Reason |
|---|---|---|---|
| View projection | yes | no | linear, local |
| Explicit member identity | yes (union-find) | no | discrete equality |
| Declared edge/triangle incidence | yes | no | combinatorial |
| Declared profile frame | yes | no | linear |
| Axis-aligned dimension | yes | no | linear |
| Coverage interval | yes | no | 1D linear inequality |
| Nondegeneracy | yes | no | rational predicates |
| General distance/radius | simple cases | yes | polynomial, coupled |
| Parallel/perpendicular | no | yes | bilinear |
| Tangency | no | yes | polynomial, branch-sensitive |
| Symmetry | no | yes | linear + bilinear |
| Equal length/radius | no | yes | polynomial |
| Angle dimension | no | yes | trigonometric/polynomial |
| Coaxial/coplanar | no | yes | bilinear |
| Smooth continuity | no | yes | derivative constraints |
| Visibility | no | rank/evidence | discrete + occlusion |
| Support surface | boundary exact | fit parameters | model selection |

### 5.4 Reporting underdetermined and overdetermined

Use orthogonal fields, not one overloaded status:

```text
determination:
  determined       exact or accepted inferred model
  partial          some entities resolved, some unresolved
  underdetermined  continuum of solutions
  ambiguous        finite alternatives, no unique one
  inconsistent     contradiction
  unsupported      outside the supported domain

dof:
  total, local: true/false
  components: [{ id, dof, free: [{member, axis}], gauges: [...] }]

constraints:
  satisfied, violated, redundant, conflicting, unknown
```

Recommended precedence for the single legacy `reason` field:
`inconsistent` > `unsupported` > `ambiguous` > `underdetermined` > `partial` >
`determined`. But do not hide the others; `issues` keeps every finding, and
`alternatives` keeps every viable branch.

For a minimal conflict set on linear constraints, use exact deletion filtering:
remove constraints one at a time, re-check rank/consistency, and keep the
smallest set whose removal restores consistency. This is cheap for the small
systems in a drawing. For nonlinear constraints, the same deletion filter with
re-solve gives a **candidate** conflict set; label it as such, because a
nonlinear residual may have multiple causes.

### 5.5 Incremental solving

The current pipeline rebuilds everything. A constraint graph makes incremental
work natural:

1. Hash the constraint IR. Entities/members are nodes; constraints are
   hyperedges.
2. Union-find components once. Projection constraints are local, so most
   components are tiny; dimensions and parallel/symmetry constraints join them.
3. On an edit, mark only the touched entities/members and their incident
   constraints dirty. Recompute the dirty components; reuse the rest.
4. For L1, re-run exact assignment/rank only in dirty components.
5. For L2, update only candidate edges whose base name or coordinates changed;
   recompute the local matching, not the global one.
6. For L3, warm-start from the previous component solution. Keep a branch ID
   (correspondence choice + mirror choice). If the branch changes, say so; do
   not silently flip.
7. Cache the exact certificate and the inferred surface model per component.
   Invalidate a certificate only when its component changes.
8. Cap enumeration and optimization work per rebuild; report a deterministic
   `budget-exceeded` diagnostic instead of an arbitrary first answer.

### 5.6 Why not adopt an existing solver runtime

- **SolveSpace**: GPL-3.0, strongly coupled to its application, no exact
  certificate, and its group/entity model is not our view model. Reading it for
  architecture is useful; linking it into an MIT project is not.
- **FreeCAD planeGCS**: LGPL-2.1+, 2D only, C++/Eigen/Boost, no 3D view
  semantics. A WASM adapter could solve 2D sketches, but it would not understand
  projection equations, member identity or multi-view correspondence.
- **Z3**: MIT, but a large dependency and a poor fit for per-keystroke solving.
  It is excellent as an offline oracle for small ambiguous systems.
- **Ceres**: BSD-3-Clause, but C++/native, no exact constraints, no discrete
  alternatives, and no browser path without a WASM build.

The zero-dependency constraint in `AGENTS.md` and `package.json` is compatible
with implementing the exact linear layer and a small dense LM ourselves. It is
not compatible with casually embedding any of the above.

---

## 6. API and data-model sketch

### 6.1 Constraint model

```js
{
  version: 1,
  units: 'mm',
  views: [
    { id: 'front', role: 'ELEVATION' },
    { id: 'top', role: 'PLAN' },
    { id: 'side', role: 'PROFILE', frame: { xRef, dRef, s } }
  ],
  variables: [
    { id: 'v:a:x', owner: 'a', axis: 'x', value: 0, fixed: true },
    { id: 'v:a:h', owner: 'a', axis: 'height', value: 40, fixed: true },
    { id: 'v:a:d', owner: 'a', axis: 'depth', value: null, fixed: false }
  ],
  constraints: [
    {
      id: 'c:1',
      type: 'projection',
      strength: 'exact',
      targets: ['v:a:x', 'v:a:h'],
      value: [0, 40],
      source: { entityIds: ['E2'], memberIds: ['a'], viewIds: ['front'] }
    },
    {
      id: 'c:2',
      type: 'distance',
      strength: 'driving',
      targets: ['v:a:x', 'v:b:x'],
      value: 40,
      unit: 'mm',
      source: { entityIds: ['E9'] }
    }
  ],
  groups: [
    { id: 'g:1', variables: ['v:a:x', 'v:a:h', 'v:a:d'], constraints: ['c:1'] }
  ]
}
```

Constraint `type` vocabulary:

```text
projection, member-link, coincidence, point-on-line, point-on-circle,
point-on-plane, coverage, tangent, parallel, perpendicular, symmetric,
distance, radius, diameter, angle, equal, horizontal, vertical,
coplanar, coaxial, support-surface, visibility, nondegenerate
```

`strength` is `exact | driving | inferred | evidence | preference`.
`source` always includes stable entity/member/view IDs. A constraint without a
source is not allowed in a certificate.

### 6.2 Public API

```js
EduCADConstraints.build(entities, options)  // pure normalization
EduCADConstraints.solve(model, options)     // exact + optional numeric
EduCADConstraints.explain(result, filter)   // human-readable diagnosis
```

`options`:

```js
{
  identity: 'explicit' | 'auto',
  mode: 'strict' | 'assist' | 'infer',
  dimensions: 'ignore' | 'reference' | 'driving',
  visibility: 'ignore' | 'rank',
  allowPartial: true,
  maxAlternatives: 8,
  tolerance: 1e-6,        // only for inferred/assist; never for exact
  maxIterations: 100
}
```

`EduCADReconstruct.reconstruct(entities, options)` keeps its current contract and
adds:

```js
result.constraintReport = {
  modelVersion: 1,
  determination: '...',
  dof: { total, local, components: [...] },
  constraints: { satisfied, violated, redundant, conflicting, unknown },
  alternatives: [...],
  free: [...],
  provenance: [...]
}
```

The existing `status`, `reason`, `label`, `issues`, `geometry`, `certificate`,
`pipeline`, `determination` fields remain. New code reads `constraintReport`;
old callers keep working.

### 6.3 `.edu` test plan

The runner already supports `# expect:` with `V/E/F`, `diagnostics`, `status`,
`unresolved`, `curves`, `surfaces`, and other properties (`tools/edc.js:254-268`).
Add these properties:

```text
dof=<n>
free=<comma-separated member.axis or none>
alternatives=<n>
constraintStatus=determined|partial|underdetermined|ambiguous|inconsistent|unsupported
conflict=<comma-separated constraint IDs or none>
redundant=<n>
```

Declare constraints in the sheet with a comment directive, mirroring the existing
`# surface-query:` convention:

```text
# constraint: {"type":"distance","a":"a'","b":"b'","value":40,"strength":"driving"}
```

Names are resolved only at the script boundary; the normalized model uses member
IDs. Ambiguous names are rejected in the directive, not guessed.

Test sheets, all under `tools/scripts/` and all checked with
`node tools/edc.js --solid`:

| Sheet | Drawing | Expected |
|---|---|---|
| `constraint-underdetermined.edc` | plan point `a`, no elevation | `constraintStatus=underdetermined dof=1 free=a.depth status=unavailable` or partial point; no edge |
| `constraint-ambiguous-name.edc` | elevation `a'`, two plan stations with base `a` at different depths (explicit station-member assignment or fixture; plain `/point` rejects duplicate labels) | `constraintStatus=ambiguous alternatives=2`, no accepted 3D point; not `coordinates-missing` |
| `constraint-exact-conflict.edc` | `a'` x=`0.30000000000000004`, `a` x=`0.3` | `constraintStatus=inconsistent conflict=c:x-a`; exact values in message |
| `constraint-dimension-resolves.edc` | plan-only point plus a driving distance/height dimension to a fixed elevation point, with a sign constraint selecting the valid branch | `constraintStatus=determined dof=0`; free axis resolved |
| `constraint-redundant-dimension.edc` | two identical driving lengths | `redundant=1`, still `determined` |
| `constraint-conflicting-dimensions.edc` | lengths 40 and 50 on the same pair | `constraintStatus=inconsistent conflict=c:len1,c:len2` |
| `constraint-tangent.edc` | circle + line projected tangency in one view, paired | `constraintStatus=determined` or `inferred`; tangent residual reported |
| `constraint-symmetry.edc` | two holes symmetric about the center plane | `dof` reduced; symmetry constraint listed |
| `constraint-visibility.edc` | two mirror candidates, one occluded by a drawn face | one alternative survives; visibility evidence recorded |
| `constraint-profile-missing-frame.edc` | profile station with no `/profile` | `constraintStatus=underdetermined`, `free=...depth`, not whole-model loss |
| `constraint-incremental.edc` | change one driving dimension | only touched component re-solved; same branch ID |
| `constraint-curve-ambiguous.edc` | two valid spline correspondences | supported curve retained, `alternatives=2`, family ambiguity separate |

Acceptance rules:

1. Existing scripts `rule-a.edc`, `edge-both-views.edc`, `edge-missing-plan.edc`,
   `flat-square.edc`, `wedge.edc`, and the profile station sheets keep their
   current outputs (modulo the new fields).
2. Every new failure is a specific code, not a generic `coordinates-missing`.
3. No test relies on a separate JS test suite. `.edu` remains the only test
   format, per `AGENTS.md`.

The ambiguous-name fixture is deliberately built with explicit station-member
assignment. The plain `/point` command rejects duplicate labels in one view, so
the fixture demonstrates the import/legacy case that the current `uniqueMatch`
silently drops. That case is the target, not an artificial duplicate.

Note on current expectations: the working tree's runner currently reports
`rule-a.edc` as `4V 4E 1F` and `flat-square.edc` as `4V 4E 1F`, while
`expectation.md` says `2F`. That drift is independent of this report, but the
new tests should assert observed geometry, not copied prose. Verify before
basing a regression on the old counts.

---

## 7. Licensing and dependency notes

EduCAD is MIT (`LICENSE`). Compatibility matters.

| Project / version | License | Can we embed? | Notes |
|---|---|---|---|
| SolveSpace v3.3 | GPL-3.0-or-later | No, not in an MIT distributed work | Strong copyleft; library page explicitly warns about proprietary linking. Use ideas only. |
| FreeCAD 1.1.4 / planeGCS | LGPL-2.1-or-later (repo `LICENSE`; GCS headers say GNU Library GPL v2+) | Possible with LGPL obligations, but not desirable | Dynamic linking/relink requirements; static/WASM builds are awkward; 2D only. |
| `planegcs` Python wrapper | LGPL-2.1-or-later | Same as above | Extracted 2D solver; native/Python, not browser. |
| Z3 5.4.1 | MIT | Yes | Large WASM/native dependency; optional offline oracle only. |
| Ceres 2.2.0 | BSD-3-Clause | Yes | C++/native; optional deps (Eigen, SuiteSparse, glog, etc.) have separate licenses. |
| Eigen (if planeGCS) | MPL-2.0 | Yes with notices | Header-only, but still a dependency. |
| Boost (if planeGCS) | BSL-1.0 | Yes | Header/compiled parts. |
| QRec | No clear license found | No | Do not copy. |
| Ortho2CAD | No `LICENSE` found at access | No | Do not copy. |
| cad-reconstruction-agent | MIT | Reference only | Early prototype; not a solver library. |

Recommendation: **do not add a runtime dependency**. Implement the exact linear
layer with the existing `BigInt` rational arithmetic and a small dense/sparse
linear algebra module. If a numeric layer is added, implement a small
Gauss-Newton/LM with QR in plain JavaScript, or gate an optional WASM adapter
behind an explicit experimental flag and keep it out of the core distribution.
Vendoring any LGPL/GPL solver into the MIT browser bundle is a licensing and
maintenance trap.

If external code is ever consulted, keep a clean-room boundary: read public
documentation and equations, write our own implementation, and record the
source in a `NOTICE`/research note. Do not copy source, comments, or test data.

---

## 8. Ranked recommendation

**1. Build the exact constraint report first (highest value, lowest risk).**
Normalize the current strict observations into a constraint IR with provenance.
Return `dof`, `freeAxes`, `conflictSets`, and `partial` geometry for resolved
members. Keep exact arithmetic and refusal-to-average. This is mostly a
refactor of information the strict kernel already has.

**2. Add the combinatorial correspondence layer (highest value for ambiguity).**
Replace silent `uniqueMatch` rejection with candidate matching, scored evidence,
and enumerated alternatives. Report `ambiguous` with the competing candidates.
Handle curve order/reversal in the same framework. This fixes the most common
"why did my point not lift?" case without any nonlinear solver.

**3. Add nonlinear refinement only for genuinely inferred constraints.**
Parallel/tangent/symmetry/dimensions and surface fitting. Use LM/GN with rank
diagnostics, gauge fixing, and warm starts. Mark results `inferred`; never attach
the exact certificate. Treat conflicting driving dimensions as conflicts, not
least-squares compromises, unless the user explicitly chooses an "assist" mode.

**4. Use SMT offline, if at all.**
A small Z3-backed test oracle can prove unsatisfiability of a subsystem, find a
counterexample, or enumerate a handful of finite realizations during development.
It should not ship in the browser runtime. It is also the right way to validate
the exact/linear layer on tricky dimension networks.

**5. Do not embed SolveSpace, planeGCS or Ceres in the core.**
They solve a different problem, carry license/dependency costs, and cannot
certify our declared geometry. Their diagnostics are the valuable part; copy the
architecture, not the code.

### Smallest next milestone

**M1: exact diagnosis plus opt-in partial results.**

Add a `constraintReport` to the strict/shared result containing:

- per-member `dof` and `freeAxes`;
- exact `conflictSets` for conflicting coordinate assignments;
- `ambiguous` correspondence candidates for same-base/same-axis stations;
- `partial` geometry mode that keeps resolved vertices and reports unresolved
  edges separately.

Add four `.edu` sheets:

```text
constraint-underdetermined.edc
constraint-ambiguous-name.edc
constraint-exact-conflict.edc
constraint-profile-missing-frame.edc
```

Acceptance: those four report `underdetermined`, `ambiguous`, `inconsistent`,
and `underdetermined` respectively, with specific `free`/`conflict`/
`alternatives` fields; all existing `.edu` scripts keep their geometry and
certificate behavior. No new npm dependency, no nonlinear solver, no change to
the meaning of explicit member IDs.

This milestone is deliberately smaller than "add a solver." It gives users
actionable diagnostics, creates the IR that later layers need, and proves the
exact-first direction without risking the existing contract.

---

## Sources and versions

Accessed 2026-11-11 unless noted.

- SolveSpace v3.3, commit `30e1c3ac0beb77fe3e098315b1bb662840ddc99a`:
  <https://github.com/solvespace/solvespace/tree/v3.3>.
  Key files: `src/system.cpp`, `src/constraint.cpp`, `src/sketch.h`,
  `src/solvespace.h`, `src/textscreens.cpp`. License `COPYING.txt`.
  Technology page: <https://solvespace.com/tech.pl>.
  Constraint reference: <https://solvespace.readthedocs.io/en/latest/constraints/>.
- FreeCAD 1.1.4, tag commit `4fd3bf320d9566a27e60069fc8387448aaa3a094`:
  <https://github.com/FreeCAD/FreeCAD/tree/1.1.4>.
  Key files: `src/Mod/Sketcher/App/planegcs/GCS.cpp`, `GCS.h`,
  `src/Mod/Sketcher/App/Sketch.cpp`. License `LICENSE`.
  Sketcher dialog docs: <https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Dialog.md>.
- `planegcs` Python wrapper: <https://github.com/spookylukey/planegcs>,
  LGPL-2.1-or-later per README.
- Z3 5.4.1: <https://github.com/Z3Prover/z3/tree/z3-5.4.1>, MIT `LICENSE.txt`.
  Guide: <https://microsoft.github.io/z3guide/docs/theories/Arithmetic/>.
  Internals: <https://z3prover.github.io/papers/z3internals.html>.
  NLSAT: Jovanović & de Moura, IJCAR 2012,
  <https://doi.org/10.1007/978-3-642-31365-3_27>.
- Ceres Solver 2.2.0: <https://github.com/ceres-solver/ceres-solver/tree/2.2.0>,
  BSD-3-Clause. Modeling:
  <https://ceres-solver.readthedocs.io/latest/nnls_modeling.html>.
  Covariance/rank: <https://ceres-solver.readthedocs.io/latest/nnls_covariance.html>.
- KittyCAD geometric-constraint-playground:
  <https://github.com/KittyCAD/geometric-constraint-playground>, MIT.
- QRec: <https://github.com/elrinor/qrec> (license not found).
- cad-reconstruction-agent: <https://github.com/NoNome1238/cad-reconstruction-agent>,
  MIT per repository.
- Ortho2CAD: <https://github.com/AdityaJoglekar/Ortho2CAD> (no `LICENSE` found).
- Survey: "3D CAD Models Reconstruction from 2D Drawings: A Survey,"
  *Computer-Aided Design & Applications* 23(6), 2026,
  <https://cad-journal.net/files/vol_23/CAD_23(6)_2026_646-678.pdf>.
- Witness method: Foufou & Michelucci, *Information and Computation* 216
  (2012) 24-38, <https://doi.org/10.1016/j.ic.2011.09.006>.
- Local files: `docs/RECONSTRUCTION_CONTRACT.md`, `docs/IDENTITY_RULES.md`,
  `docs/PRIMITIVE_RECONSTRUCTION.md`, `public/lib/educad-reconstruct.js`,
  `public/lib/educad-strict.js`, `public/lib/educad-parametric-reconstruct.js`,
  `tools/edc.js`, `expectation.md`.

## Unverified or qualified claims

These are the points I did not prove or benchmark:

1. I did not run SolveSpace or FreeCAD; architecture and diagnostic behavior are
   from source and documentation, not from an independent test.
2. FreeCAD's redundant/conflicting classification is heuristic; I did not verify
   every branch or version-specific QR threshold.
3. Z3's completeness claim is fragment-specific. I did not benchmark a
   reconstruction-sized QF_NRA encoding, and the default `check-sat` route may
   return `unknown`.
4. Ceres performance and rank behavior were not measured here; the statements
   are from its documentation.
5. "No mature OSS constraint-based orthographic reconstructor" is based on a
   limited web/GitHub search, not a systematic survey. Absence of evidence is
   not proof of absence.
6. Ortho2CAD had no `LICENSE` file at access time; that may change.
7. `cad-reconstruction-agent` is described from its README only; I did not run
   it or audit its claims.
8. The failure modes in §1.3 are derived from code reading plus a few runner
   experiments; they are not an exhaustive test matrix.
9. The proposed performance and incremental behavior are design estimates, not
   measurements.
10. The `rule-a.edc`/`flat-square.edc` face-count drift noted in §6.3 is an
    observation from the current runner; I did not investigate whether it is a
    documentation bug or a geometry change.

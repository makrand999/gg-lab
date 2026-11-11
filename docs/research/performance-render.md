# Performance, incremental recompute, and rendering architecture

**Status:** research/design report. No production code changed.
**Scope:** Major (`public/index.html`, `public/lib/`, shared `backend/`). Major2
is out of scope per `AGENTS.md`.
**Date:** 2026-11-11.

This report compares EduCAD's every-edit full reconstruction, immediate-mode
Canvas2D sheet, display-mesh generation, interval visibility and floating 3D
widget with the architectures used by FreeCAD/Coin3D, OCCT, OpenSCAD, Manifold
and Blender. It ends with a ranked recommendation and a migration sequence.

The central finding is that the project does **not** need a new geometry kernel
or a retained-mode renderer first. It needs to stop doing two things on the
interactive path:

1. exact rational self-intersection validation of the *inferred display
   triangulation* on every edit, and
2. a full sheet redraw plus label layout on every 3D orbit frame.

Together these account for most of the measured latency. The 3D widget's own
per-frame geometry is already cheap.

---

## 0. Evidence and measurement method

### Source read

- `public/index.html`: `rebuildSolid` (l. 4187–4220), `setSheetMode`
  (l. 1828–1855), `renderLayer1` (l. 2393–2567), `renderLayer2` (l. 2674+),
  `updatePoseView` (l. 1605–1623), glass mount and `afterDraw`
  (l. 4144–4157), reference-preview card (l. 6032–6132).
- `public/lib/educad-entities.js`: revision/subscription model
  (l. 412–432), table mutations (`update`, `move`, `updateMany`).
- `public/lib/educad-reconstruct.js`: `reconstruct` (l. 2789–3039),
  `validateInferredSurfaces` (l. 1305–1355), face-inference bounds
  (l. 628–632), planar extraction (`extractPlanarFaces`, l. 1113+),
  parametric path (l. 2757–2787), visibility provider (l. 2828–2849).
- `public/lib/educad-strict.js`: exact rational arithmetic and
  `classifySurfaces` (l. 90–158), including the pairwise exact triangle
  intersection loop (l. 123–127).
- `public/lib/educad-project.js`: HLR interval visibility
  (`edgeIntervals`, l. 159–201) and `projectSolid` (l. 210–258).
- `public/lib/educad-solid.js`: `renderFast` (l. 1030–1138), glass `draw`
  and `afterDraw` (l. 1216–1242), `scheduleDraw` (l. 1244–1259).
- `public/lib/educad-spatial.js`: inspection overlay, `refresh`, `underlay`,
  `overlay`, `datumGaps` (l. 539–658), `overlayLayout` (l. 159+).
- `public/lib/educad-labels.js`: `resolve` / placement search.
- `public/lib/educad-ref3d.js`: `buildPreview` (l. 59–109), `validPreview`
  (l. 112–193).
- `docs/RECONSTRUCTION_CONTRACT.md`, `AGENTS.md`.

### Local measurements

Measured with **Node.js v24.21.0 on Linux**, loading the real modules and
replaying the existing `.edc`/`.edu` scripts through
`public/lib/educad-command.js`, then timing `EduCADReconstruct.reconstruct`
with warm-up and repeated calls. The harness was a temporary script outside
the repository; no production code was modified.

These numbers are **indicative**, not a controlled browser profile. Canvas
rasterisation, compositing and GPU cost are not measurable in Node. Treat the
absolute values as order-of-magnitude evidence and the *shares* as the robust
part.

| Sheet | Entities | Result | `reconstruct()` | Exact inferred validation | Share | Labels (`resolve`) | HLR front |
|---|---:|---|---:|---:|---:|---:|---:|
| `flat-square.edc` | 12 | 4V/4E/2F | 3.1 ms | 1.1 ms | 34% | 1.5 ms | 0.23 ms |
| `large-plate.edu` | 49 | 12V/12E/2F | 27.7 ms | 22.3 ms | 81% | 4.1 ms | 2.02 ms |
| `large-prism.edu` | 163 | 36V/54E/20F | 317.3 ms | 291.7 ms | 92% | 16.0 ms | 3.37 ms |
| `front-circle.edu` | 5 | 24V/24E/2F/1C | 543.3 ms | 540.3 ms | 99% | 0.2 ms | 0.28 ms |
| `cone.edu` | 9 | 25V/48E/25F/1C | 1462.8 ms | 1460.6 ms | 100% | 0.2 ms | 2.24 ms |
| `cylindrical-recess.edu` | 42 | 56V/84E/31F/2C | 1127.7 ms | 1115.3 ms | 99% | 2.1 ms | 3.52 ms |
| `linked-curved-boundary.edu` | 9 | 25V/48E/25F/1C | 1577.2 ms | 1574.8 ms | 100% | 0.5 ms | 1.77 ms |
| `mixed-curved-plate.edu` | 25 | 52V/76E/28F/2C | 2539.7 ms | 2535.5 ms | 100% | 1.0 ms | 3.40 ms |
| `fillet-line-boundary.edu` | 16 | 18V/25E/8F/2C | 69.2 ms | 65.8 ms | 95% | 0.2 ms | 0.33 ms |

Additional measurements:

| Measurement | Result |
|---|---:|
| `Surfaces.build` + `validate` + `certify` combined (all sheets above) | 0.4–3.5 ms |
| `setGeometry`/`normalizeGeometry` (36V/54E/20F) | 0.22 ms |
| `classifyEdges` + `project` (3D widget geometry, 20F) | < 0.05 ms |
| `EduCADLabels.resolve`, 163 entities | 16.0 ms |
| `EduCADLabels.resolve`, 270 entities (30-gon synthetic) | 37.5 ms |
| `spatialView.overlayLayout`, 36V/54E, all labels | 2.3 ms |
| `projectGeometry` front, 20F | 2.0–3.4 ms |
| `projectGeometry` front, 31F curved recess | 3.52 ms |
| JSON stringify of 163 entities | 0.36 ms |
| 18-gon prism reconstruct, synthetic (matches `large-prism`) | 370 ms |
| 30-gon prism reconstruct, synthetic | 878 ms (830 ms exact validation) |

The exact-validation cost is **topology-sensitive**, not just triangle-count
sensitive. A synthetic connected sphere with 360 triangles validates in
~2 ms, while a 68-triangle prism drawing takes ~292 ms. Coplanar/coincident
faces, duplicated plan rings and many adjacent exact tests are the expensive
cases. A 400-triangle budget can therefore still mean seconds, not
milliseconds. The 30-gon synthetic (116 triangles) took 830 ms in
`classifySurfaces`.

---

## 1. Current update and render pipeline

### 1.1 Entity table and rebuild trigger

`CadEntityTable` is a flat, ordered map of entities. Every mutation (`add`,
`remove`, `update`, `move`, `clear`, `updateMany`) calls `_emit`, increments a
monotonic `_rev`, and notifies subscribers
(`public/lib/educad-entities.js:412–432`). This is a good primitive: the table
already has a cheap, monotonic content version.

The 3D rebuild subscription is in `public/index.html:4187–4220`:

- every table change schedules exactly one `requestAnimationFrame`
  callback while a rebuild is pending (`rebuildQueued`);
- the callback reads `handle.table.list()` and calls
  `EduCADReconstruct.reconstruct(list)` with default options;
- on success it calls `EduCADSolid.setGeometry`, on failure
  `setUnavailable`;
- then it calls `drafting.refresh()` and `renderLayer2`.

There is no cache key beyond the pending flag. Mode changes call
`rebuildSolid()` unconditionally in several places
(`setSheetMode`, l. 1842/1853; `exitPose`, l. 1467), so entering or leaving
Pose can re-run the entire pipeline even though the table did not change.

### 1.2 Full reconstruction

`reconstruct(list)` is a pure-looking function of the visible entity rows plus
options, but internally it is a multi-stage pipeline
(`public/lib/educad-reconstruct.js:2789–3039`):

1. clone rows and force `visible: true`;
2. route to `reconstructParametric` if any `CURVE` exists;
3. resolve a profile frame and synthesize "auto members" for the strict
   readers;
4. if declared/members exist, call `Strict.reconstruct`; otherwise use
   `liveCore` for the straight-wire case;
5. lift curves (`Curves.reconstruct`), oblique curves, inferred bounded cones;
6. run `liveCore`/`reconstructStrict` again for remaining straight components;
7. `extractPlanarFaces` for the inferred display mesh;
8. `Surfaces.build`, `Surfaces.validate`, `Surfaces.certify`;
9. `validateInferredSurfaces` — triangulate the display faces and run exact
   rational triangle-pair intersection tests.

Step 9 is the expensive one. It is not the exact certificate. `Surfaces.certify`
is cheap on the measured sheets (0.3–2.6 ms). The killer is
`Strict.classifySurfaces` over every pair of inferred display triangles
(`public/lib/educad-strict.js:123–127`), using BigInt rational arithmetic.

The code itself notes that this check applies to the inferred display
triangulation, not the analytic curved surface
(`public/lib/educad-reconstruct.js:1305–1307`). It caps at 400 triangles and
reports `skipped` above that, but the cap is far above an interactive budget
for pathological topology.

Curve sheets also run a second reconstruction for the occluder inside
`visibilityProvider` (`public/lib/educad-reconstruct.js:2828–2849`) when
oblique-curve visibility needs evidence. That is a legitimate correctness
mechanism, but it doubles part of the work on curved sheets.

### 1.3 2D sheet rendering

`renderLayer1` (`index.html:2393–2567`) is immediate mode:

- clears the full CSS-pixel canvas;
- draws grid, XY datum, VP/HP labels;
- collects visible entities, plus pinned locus lines;
- draws every entity;
- runs `EduCADLabels.resolve` over the whole visible list and draws every
  label placement;
- in View mode asks `spatialView.datumGaps` for datum exclusions, which itself
  runs `overlayLayout` to get label/edge geometry.

`renderLayer2` (`index.html:2674+`) clears the full canvas again and draws
cursor/snap/selection/rubber-band overlays. Pointer moves call it; pans call
both layer 1 and layer 2.

Measured label layout alone is 16.0 ms at 163 entities and 37.5 ms at 270
entities. That is already at or beyond a 60 Hz CPU budget (16.7 ms) before any
canvas rasterisation. A 30 Hz budget (33 ms) also fails at 270 entities.
Entity drawing is comparatively cheap; label placement is the dominant 2D
cost.

### 1.4 3D widget

The floating glass widget is a separate full-window Canvas2D. `renderFast`
(`educad-solid.js:1030–1138`) batches hidden strokes, front strokes and vertex
dots into a handful of paths. `draw` calls `renderFast`, rebuilds the hit-test
frame, then calls `afterDraw`. Geometry work is tiny: `< 0.05 ms` for
`classifyEdges` + `project` on a 20-face solid. The widget is not the problem.

The integration is. In View mode, `afterDraw` calls `renderLayer1()` so the
datum gaps follow the moved model (`index.html:4154–4156`). That means every
orbit frame re-renders:

- the entire sheet,
- every entity,
- all labels (16–37 ms),
- and `datumGaps`, which runs the overlay layout a second time.

Orbit therefore costs a full document repaint to move one line's gaps. The
spatial underlay/overlay also recompute `overlayLayout` every frame: once for
`overlay`, again for `datumGaps`.

### 1.5 Pose path

`updatePoseView` (`index.html:1605–1623`) runs on every pose gesture move. It:

1. applies the pose to every vertex;
2. calls `projectGeometry` for front, top and (when present) side views —
   each is an interval HLR pass through `educad-project.js`;
3. calls `setGeometry` (normalizes and rebuilds adjacency);
4. updates pose sims and exact index;
5. calls `renderLayer1()` — a full sheet redraw and label layout.

Measured HLR is 2–3.5 ms per view on 20–31 faces; the full sheet redraw is the
larger cost. A pose drag is therefore HLR × 2–3 plus a full 2D repaint plus the
3D widget, on every pointer move.

### 1.6 Reference-preview path

The teacher publishes a reference preview by running the same
`EduCADReconstruct.reconstruct` in the browser and serialising the result with
`EduCADRef3d.buildPreview` (`public/index.html:5515`, `5667`, `6238`;
`educad-ref3d.js:59–109`). Students receive the detached JSON; `validPreview`
re-checks vertices, edges, faces, holes, curves, surfaces and certificates on
display (`educad-ref3d.js:112–193`), and the card disposes and recreates a
`mountSolidWidget` each time.

This is not a per-edit hot path, but it is a full exact reconstruction on
publish and a full payload validation on every display. It should share the
same staged pipeline and cache by model-answer revision/content digest.

### 1.7 Hotspots, ranked by measured evidence

1. **Exact inferred-surface validation** — 34–100% of `reconstruct`, 0.3–2.5 s
   on measured sheets. Dominant and pathological on coplanar/duplicated
   topology.
2. **No memoization and unconditional rebuilds** — every edit and every mode
   switch re-runs the whole pipeline. 18-gon prism 317–370 ms; 30-gon 878 ms.
3. **Full sheet + label layout on every 3D orbit frame** — 16–37 ms labels
   alone; `afterDraw` is the structural cause.
4. **Pose drag does 2–3 HLR passes plus a full sheet redraw per pointer move.**
5. **HLR interval code recomputes face normals inside edge × face loops** —
   measured 2–3.5 ms/view; a constant-factor fix, not a redesign.
6. **Immediate-mode full clear on pointer move/pan** — layer 2 is cheap today,
   but it scales with entity count and snapping scans.
7. **Reference preview revalidates and remounts every display.**

Not hotspots, despite intuition:

- display mesh generation and `setGeometry` normalization: 0.22 ms;
- 3D widget projection/visibility: < 0.05 ms;
- analytic certificate: 0.3–2.6 ms;
- `Surfaces.build`/`validate`: 0.4–3.5 ms combined.

---

## 2. OSS patterns

### 2.1 FreeCAD + Coin3D: application model, view provider, retained scene graph

FreeCAD separates the application document from the Gui view provider. A
`DocumentObject` owns properties and `execute()`; a `ViewProvider` owns Coin3D
nodes and presentation properties. `ViewProvider::pcRoot` is an
`SoFCSelectionRoot` (an `SoSeparator` subclass) with transform, mode switch and
child nodes; `setRenderCacheMode` maps to `SoSeparator::AUTO/ON/OFF`
(`src/Gui/ViewProvider.cpp`, FreeCAD main `7294e95`).

The key performance pattern is in `ViewProviderPartExt::updateVisual`
(`src/Mod/Part/Gui/ViewProviderExt.cpp`):

> "shape unchanged so do not rebuild geometry" — it early-outs when
> `lastRenderedShape.IsPartner(shape)` and no visual flag changed.

So the granularity is **per shape/object**, not per triangle. If the shape is
unchanged, the entire tessellation/Coin geometry is reused; only materials are
re-applied. If it changed, the object's visual representation is rebuilt.

Recompute is a dependency graph. `DocumentObject::touch` marks an object and,
with fine-grained recompute, individual properties; `mustExecute` asks whether
it needs work. `Document::recompute` obtains a dependency-sorted list, allows
at most two passes "to allow some form of dependency inversion", and after each
recompute touches dependent objects (or only dependent properties in
fine-grained mode). The wiki documents the user-visible contract: Recompute is
disabled when nothing needs it; "Mark to recompute" forces it
([Std_Refresh](https://wiki.freecad.org/Std_Refresh),
[Viewprovider](https://wiki.freecad.org/Viewprovider)).

Coin3D adds a retained render cache. `SoSeparator::renderCaching` defaults to
`AUTO`; `ON` is for static geometry, `OFF` is recommended for geometry that
changes every redraw. Coin's heuristic enables display-list caching for small
static shapes and disables it above ~1000 triangles to bound GPU memory
([Coin `SoSeparator`](https://www.coin3d.org/coin/classSoSeparator.html)).
FreeCAD's Part view provider exposes `Deviation` and `AngularDeflection`
properties, which feed tessellation quality (`ViewProviderExt.h`).

**Transferable idea:** one retained view representation per object, rebuilt
only when that object's shape changes; camera moves never touch the model.
**Not transferable directly:** Coin display lists do not exist in Canvas2D;
EduCAD would need an offscreen bitmap or path cache instead.

### 2.2 OCCT: AIS presentations, view invalidation, exact vs polygonal HLR

OCCT's visualization guide states the model/view split explicitly: a
presentable object creates its `Graphic3d_Structure` on the **first display
request** and "retain[s] this framework for further display"; the viewer then
operates on the graphic structure, not the application data
([Visualization guide](https://dev.opencascade.org/doc/overview/html/occt_user_guides__visualization.html)).
`AIS_InteractiveContext::Redisplay` calls `RecomputePrsOnly` and
`RecomputeSelectionOnly`; `AIS_InteractiveContext::Update` recomputes
presentations and selection; `V3d_View::Redraw` only redraws. `AIS_ViewController`
only calls `Redraw`/`Update` for views that are invalidated
(`src/AIS/AIS_ViewController.cxx`, `handleViewRedraw`). In computed/HLR mode it
calls `V3d_View::Update` (which recomputes) instead of `Redraw`.

HLR is part of the view pipeline. `AIS_Shape` supports two algorithms:

- `Prs3d_TOH_PolyAlgo` — polygonal, based on the shape's triangulation;
- `Prs3d_TOH_Algo` — exact, based on the real geometry.

The exact algorithm is the quality path; the polygonal one is the interactive
path. `HLRBRep_InternalAlgo::Update` loads each shape through
`HLRBRep_ShapeToHLR::Load` and computes outlines; `HLRBRep_HLRToShape` extracts
visible/hidden compounds (`src/HLRBRep/HLRBRep_InternalAlgo.cxx`,
`HLRBRep_HLRToShape.cxx`, OCCT `V7_8_0`). `AIS_InteractiveContext` exposes
deviation coefficient/angle setters for tessellation LOD.

**Transferable idea:** separate "recompute presentation" from "redraw view";
only invalidated views redraw; offer a polygonal preview HLR and an exact HLR
for final output.

### 2.3 OpenSCAD: preview vs full render, per-node cache, LRU

OpenSCAD compiles a CSG tree and evaluates it. The GUI has a fast preview
(OpenCSG, `$preview=true`, F5) and a full render (CGAL historically, F6). The
current CLI manual documents `--preview` and `--render`, and the 2025.08.17
help lists `--backend 'CGAL' (old/slow) [default]` or `'Manifold' (new/fast)`
([command-line manual](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment)).
The split exists because the exact CSG evaluation is much more expensive than
the preview approximation.

The 2021.01 source shows the caching model
([`src/GeometryEvaluator.cc`](https://github.com/openscad/openscad/blob/92350eba8ce749ddc1d04c2191c65a156a7f07ef/src/GeometryEvaluator.cc)):

- `evaluateGeometry` keys the cache by `this->tree.getIdString(node)` — a
  content-derived subtree identifier;
- two caches: `GeometryCache` (tessellated `Geometry`) and `CGALCache`
  (`CGAL_Nef_polyhedron`);
- `smartCacheInsert` / `smartCacheGet` choose the cache by geometry type;
- `Cache` is an LRU with a memory/cost budget; `GeometryCache` and `CGALCache`
  default to 100 MB each (`src/GeometryCache.h`, `src/CGALCache.h`,
  `src/cache.h`).

When a parameter changes, only subtrees whose `getIdString` changed are
re-evaluated; unaffected subtrees hit the cache. This is the closest analogue
to EduCAD's `reconstruct(list)`: a pure function of a subtree/content hash.

**Transferable idea:** content-addressed cache per pipeline stage with a
memory-bounded LRU; fast preview vs exact final.
**Not transferable:** OpenSCAD's CSG tree gives explicit subtree boundaries;
EduCAD's cross-view correspondence is global.

### 2.4 Manifold: lazy CSG tree, batch booleans, provenance

Manifold represents booleans as a deferred CSG node tree. The header documents
that Boolean operators, transforms, `Simplify` and `BatchBoolean` are
**deferred**; evaluation happens when a query forces it (`Volume`,
`GetMeshGL`, `BoundingBox`, etc.). `BatchBoolean` flattens an n-ary operation
into one CSG node instead of a left-deep chain. `AsOriginal`/`OriginalID`
preserve the mapping from result triangles back to input meshes, and
`Simplify(tolerance)` provides an explicit LOD/cleanup step
([`include/manifold/manifold.h`](https://github.com/elalish/manifold/blob/ce50d78021d64507f89e8c9fc2c2e51018117857/include/manifold/manifold.h),
v3.5.4). The README states reliability first, performance second, with TBB
parallelisation and serial fallbacks for small problems.

**Transferable idea:** make expensive stages lazy and batch independent work;
keep provenance so a result can be incrementally updated or simplified.
**Not transferable:** EduCAD is not a CSG evaluator; there is no boolean tree
to defer.

### 2.5 Blender: dependency graph and copy-on-write

Blender's dependency graph is the clearest statement of the dirty-propagation
contract:

> "the dependency graph only updates what was dependent on the modified value
> and will not update anything which was not changed"
> ([Dependency Graph](https://developer.blender.org/docs/features/core/depsgraph/)).

Nodes are scene entities, edges are relations. Evaluation works on
copy-on-write copies of original data, which lets different viewports evaluate
different states without mutating the source. Blender also splits invalidation
tagging by component, e.g. `DEG_RE_MATERIALS_UPDATE` vs
`DEG_RE_GEOMETRY_UPDATE`, so a material change does not force VBO/geometry
rebuilds.

**Transferable idea:** distinguish *what changed* (geometry vs appearance vs
selection) and invalidate the smallest downstream stage; evaluate on a copy so
the last good result stays displayable while a new one is computed.

### 2.6 Distilled patterns

1. **Model/view split.** Keep the application data independent of the
   presentation; a camera move must not re-run modelling.
2. **Retained representation.** Cache the generated display representation per
   object/component and reuse it when the object is unchanged.
3. **Dirty graph with per-object/component granularity.** Full rebuild per
   changed object is acceptable; per-triangle incremental is rarely worth it.
4. **Content-addressed caches with a memory budget.** Key by a stable subtree
   or document digest; evict by LRU.
5. **Two-tier evaluation.** Interactive preview (approximate, fast) vs final
   exact evaluation (certified, slower).
6. **Explicit invalidation flags.** Separate geometry changes from appearance,
   selection, camera and UI changes.
7. **Render only invalidated views.** Do not redraw the sheet because the 3D
   camera moved.
8. **LOD controls.** Tessellation deviation, exact vs polygonal HLR, preview
   segment counts.

### 2.7 What does not transfer

- Coin display lists / OCCT VBOs are GPU retained-mode mechanisms; EduCAD's
  Canvas2D sheet is immediate mode. The equivalent is an offscreen canvas or
  cached path objects, with the same memory tradeoff.
- OpenSCAD's subtree cache relies on an explicit CSG tree. EduCAD's
  correspondence and surface inference are global across views, so per-edge
  invalidation is unsafe without an explicit dependency model.
- Manifold's lazy CSG applies to boolean evaluation, not to Monge
  correspondence.
- Blender's copy-on-write duplicates evaluated data; EduCAD can use it for the
  "last good model while recomputing" pattern, not as a full architecture.

---

## 3. Comparison matrix

Latency is for an interactive edit on the measured sheets unless noted.
"Current" includes exact inferred validation. "Post-defer" subtracts the
measured exact-validation share and is an estimate, not an implementation.

| Strategy | What is recomputed | Latency | Memory | Complexity | Correctness risk | Fit for EduCAD |
|---|---|---|---|---|---|---|
| **Current full rebuild + exact validation** | Everything, on every mutation and mode switch | 0.3–2.5 s measured; 27 ms on 49 entities; 317 ms on 163; 878 ms on 30-gon | Low | Low | Low (but blocks UI) | Poor for curves/large sheets |
| **Memoized full rebuild** (revision key) | Nothing if revision/options unchanged | First run same; repeats ~0 ms; key < 1 ms | One result | Low | Low if every mutation bumps revision | Excellent first step |
| **Full rebuild, deferred exact validation** | Geometry + certificate now; exact self-intersection later | 2–12 ms measured remainder; 26 ms for 18-gon; ~48 ms for 30-gon (estimate) | One pending + one verified result | Medium | Medium: must show `pending`, never `ok` early | Excellent |
| **Staged pipeline cache** (correspondence / surfaces / display / HLR / labels) | Only stages whose input digest changed | ~1–10 ms warm (estimate) | Several small caches | Medium-high | Medium: key completeness | Good after stage boundaries are stable |
| **Per-component dirty graph** (FreeCAD/Blender-like) | Only components depending on changed entities | Sub-ms to a few ms (estimate) | Graph + per-component results | High | High: global correspondence is easy to miss | Long-term, explicit-identity sheets first |
| **Retained scene graph / display cache** (Coin/OCCT-like) | Only invalidated presentations | Frame < 1–5 ms after build (estimate) | High (display lists/bitmaps) | High | Low-medium (visual only) | Useful for the 2D sheet; not the modelling path |
| **Preview vs exact split** (OpenSCAD/OCCT) | Fast path while interacting; exact on idle/release | Preview 1–10 ms; exact 0.3–2.5 s background | Low | Medium | Medium: preview must be tagged | Excellent for drag/orbit |
| **Lazy CSG** (Manifold) | Only when a query forces evaluation | N/A | N/A | High | Low | Not applicable (no boolean tree) |
| **Depsgraph copy-on-write** (Blender) | Dependents of changed IDs | Sub-ms propagation (estimate) | ~2× evaluated data | Very high | Medium | Inspirational, not a near-term design |
| **LOD / tessellation controls** (OCCT/FreeCAD) | Same model, coarser display mesh | 20–50% less HLR/display work (estimate) | Lower | Low-medium | Medium: visual only, never certify coarse mesh | Useful during drag |

Notes:

- Memory numbers are order-of-magnitude. A cached 36V/54E/20F result is small
  (tens of KB); a curved 56V/84E/31F result with surfaces/certificate is
  larger; a full-window bitmap is 8 MB at 1920×1080 DPR 1 and 33 MB at DPR 2.
- The dominant risk in every caching strategy is **key completeness**, not
  algorithmic complexity. A stale cache is worse than a slow rebuild.

---

## 4. Concrete improvements, ranked

### R1. Take exact inferred-surface validation off the interactive path

**What.** Split `validateInferredSurfaces` (`educad-reconstruct.js:1305–1355`)
out of the synchronous `reconstruct()` path used by the app. Keep it in the
full/default path used by `tools/edc.js`, exports and reference-preview
publishing.

Suggested evaluation policy:

- `validation: 'full'` (default): current behaviour. `edc`, scripts, save
  previews, teacher publish, final export.
- `validation: 'deferred'`: return geometry + diagnostics + certificate
  immediately; set `surfaceValidation.status = 'pending'` (or `'skipped'`
  with a reason); schedule the exact check on idle/worker.
- optionally `validation: 'interactive'`: a numeric conservative broad-phase
  plus a small exact triangle budget (e.g. 64) for live feedback.

**Why it is safe.** This check validates the inferred *display triangulation*
of an analytic surface, not the declared topology. The exact certificate is a
separate, cheap result (`Surfaces.certify`, 0.3–2.6 ms). The strict declared
surface path must keep its full exact checks; do not weaken
`Strict.reconstruct` or `classifySurfaces` for declared topology.

**Expected gain.** Measured exact-validation shares are 34–100%. Removing it
from the interactive path should take:

- `large-prism` 317 ms → ~26 ms;
- 30-gon synthetic 878 ms → ~48 ms;
- `cone` 1463 ms → ~2 ms;
- `mixed-curved-plate` 2540 ms → ~4 ms;
- `front-circle` 543 ms → ~3 ms.

These are estimates from measured non-validation remainder. The 48 ms case is
still only ~20 fps, so large sheets also need R6 (drag preview/worker).

**Correctness guardrails.** While validation is pending, the UI must not show
the same "validated" badge as a completed exact check. Export/save/preview
publish must force `validation: 'full'`. `.edu` expectations such as
`surfaceValidation=issues` must continue to run the full path.

**Cache key.** Display mesh digest (canonical vertex positions + faces +
faceHoles + tolerance) plus pipeline version. Cache exact pair results by
sorted face vertex IDs/positions so unchanged pairs can be reused.

### R2. Memoize reconstruction by table revision + options

**What.** Use `handle.table.revision()` plus the pipeline options
(`eps`, identity mode, topology/validation policy) as the cache key. Keep the
last 1–2 results. Return the cached result instead of re-running.

The table already increments `_rev` on every mutation
(`educad-entities.js:412–432`). The key is O(1), and it cannot return stale
data as long as every semantic mutation goes through the table. Audit direct
mutations; the current drafting/command paths mostly update through
`table.update`/`updateMany`, but a development assertion or a content digest
fallback is prudent.

Also remove the unconditional `rebuildSolid()` calls on mode changes
(`index.html:1842`, `1853`, `1467`). With the cache they become no-ops; without
the cache they are wasted full reconstructions.

**Expected gain.** Mode switches and repeated identical states become ~0 ms.
The first edit still pays the full cost; this does not fix drag latency by
itself.

**Correctness risk.** Low, provided revision is the true content version.
If any code mutates an entity object in place without `_emit`, the cache would
be stale. Add a dev-only digest comparison in tests/demos, or migrate the
table to per-entity versions.

**Memory.** One geometry result is small (tens to hundreds of KB). Limit to
2–4 entries or a byte budget.

### R3. Stop re-rendering the whole sheet on 3D orbit; cache label layout

**What.** In View mode, `afterDraw` (`index.html:4154–4156`) calls
`renderLayer1()` to re-cut the XY datum. That is the structural cause of
16–37 ms label work plus entity raster work per orbit frame.

Two options, in order:

1. **Cache label layout.** Key `EduCADLabels.resolve` by table revision, view
   transform, canvas size, mode, drafting layout revision and label
   preferences. Reuse `lastLabelResult` when unchanged. This removes the
   dominant CPU cost even if the sheet is still re-stroked.
2. **Cache the sheet raster excluding the datum.** Render the sheet once to an
   offscreen canvas keyed by the same inputs, blit it to layer 1, then draw the
   datum with gaps on top of the blit. This removes the full entity stroke loop
   as well. Memory is 8 MB at 1920×1080 DPR 1, 33 MB at DPR 2; enable only on
   desktop or below a pixel budget, with a fallback to option 1.

Do not try to "punch a hole" through the transparent glass canvas with
`destination-out`: that erases glass pixels, not the sheet beneath. The
offscreen sheet cache (or a clipped redraw of the datum band) is the correct
mechanism.

**Expected gain.** Orbit in View mode should drop from >16–37 ms of layout plus
raster to a blit plus a line, comfortably inside 60 Hz for typical sheets.

**Verification.** Visual: orbit/pan/zoom/reset, split panes, selection rings,
datum gaps, labels crossing the datum, DPR changes. `.edc` cannot assert canvas
pixels; use the benchmark trace plus the demo recording/manual check. Keep
`renderLayer1` on table/view/preference changes.

### R4. Reuse the spatial overlay layout and stop computing it twice per frame

`spatialView.overlay` and `spatialView.datumGaps` each call `overlayLayout`
(`educad-spatial.js:607–658`). Compute it once per draw, pass the result to
both, and cache it by:

`geometry digest + selection + pins + preferences + font size + canvas size`.

Measured 2.3 ms per layout on 36V/54E; halving it is small but free once the
frame is already being touched. More importantly, it prevents a future
regression when more labels/pins are enabled.

### R5. Cache HLR per view and precompute face normals/adjacency

`projectSolid`/`edgeIntervals` (`educad-project.js:159–258`) recompute Newell
normals inside the edge × face loop. Precompute:

- face normals once per geometry;
- edge → adjacent face list once;
- projected face boundaries once per view.

Then run `edgeIntervals` from those tables. This is a pure constant-factor
improvement.

Cache `projectGeometry` by:

`geometry revision + view + profile frame (xRef/dRef/s) + pose matrix (if
posed) + smoothSideFaces`.

Rest/static views reuse; pose invalidates per frame. Measured 2–3.5 ms/view;
expect roughly 2–5× reduction from removing repeated normal/adjacency work.

### R6. Add an explicit interactive-vs-exact evaluation policy and LOD

Introduce a single pipeline option, e.g.:

```
evaluation: 'exact' | 'interactive'
```

Behaviour:

- `exact`: current output; full validation; current curve sampling
  (24-sample oblique rims, 0.1 tolerance for parametric curves); full HLR
  intervals.
- `interactive`: skip/defer exact inferred validation; optionally coarser
  curve sampling (e.g. 12–16 rim samples) and coarser HLR; tag geometry as
  preview.

Use `interactive` during point drags, pose gestures and orbit; switch to
`exact` on pointer-up/idle and update the badge. This mirrors OpenSCAD
preview vs full render, OCCT polygonal vs exact HLR and FreeCAD deviation
controls.

**Important:** never feed the coarse preview mesh to the exact certificate or
to a saved reference preview. The analytic curve definition stays separate
from display tessellation, as `AGENTS.md` requires.

**Expected gain.** Smooths drag on large sheets where even the post-R1 path is
26–48 ms. Without it, a 30-gon drag remains ~20 fps.

### R7. Move full reconstruction + exact validation to a Web Worker

After R1–R6, the main thread should be responsive; if large sheets still
block, move the *same* modules into a Worker:

- Worker input: serialized entity rows + options + sequence number.
- Worker output: geometry (transferable typed arrays where practical),
  diagnostics, certificate, validation status.
- Main thread keeps the last good geometry visible; drops stale sequence
  results.
- Fallback to synchronous execution when `Worker` is unavailable (Node,
  `.edc`, older browsers).

This does not reduce total CPU time, but it removes the freeze. It must use the
same public pipeline, not a second recognizer.

**Complexity:** medium-high. **Risk:** stale result ordering, structured-clone
cost, and keeping `.edc` results identical. Do it after the cheaper wins.

### R8. Per-entity/component dirty propagation (long-term)

Only after R1–R7, and only where the dependency model is explicit:

- build a graph from `meta.refs`, `endpointRefs`, `throughRefs`, member IDs,
  `viewRole` and declared topology;
- recompute only affected connected components;
- keep auto-inferred correspondence sheets on full rebuild.

The reason for caution: `reconstruct` matches across views by captions,
station names and x coordinates, infers profile frames and merges components.
An edge-level dirty set can easily miss a global correspondence change. A
stale model is worse than a 26 ms rebuild.

### 4.1 Cache keys and invalidation boundaries

| Cache | Key | Invalidate on | Scope |
|---|---|---|---|
| Reconstruction result | `table.revision()` + options (`eps`, identity, topology, validation policy) | any table mutation, option change | one document, 1–2 entries |
| Exact inferred validation | display mesh digest + tolerance + pipeline version | geometry/tessellation change | per mesh; pair results by face key |
| Label layout | table revision + view `(s,tx,ty,w,h)` + mode + drafting layout revision + label prefs | entity/view/preference change | one sheet |
| Sheet raster (optional) | same as labels + DPR + theme + datum policy | any sheet input | one bitmap |
| HLR view | geometry revision + view + profile frame + pose matrix | geometry/pose/frame change | per view |
| Spatial overlay | geometry digest + selection + pins + prefs + font + canvas size | any overlay input | one frame |
| 3D widget geometry | geometry object/revision | `setGeometry` | one widget |
| Reference preview | model-answer revision/content digest + pipeline version | model answer edit | per question |
| `.edc` verification | none (always full) | — | process |

**Invalidation levels:**

- **L0 camera/gesture:** orbit, pan, zoom, selection hover → no model
  recompute. 3D projection and (if needed) datum gaps only.
- **L1 UI/presentation:** mode, preferences, labels, inspection overlay →
  no model recompute; label/overlay caches.
- **L2 entity mutation:** add/remove/move/update/rename → full model
  reconstruction; exact validation deferred; label/sheet caches invalidated.
- **L3 document load/import/undo/redo:** full model + full exact validation.
- **L4 export/save/reference publish:** full exact validation and certificate.

### 4.2 What should stay full-rebuild

- **Any semantic drawing edit**: correspondence, profile-frame inference and
  surface inference are global and order-dependent. Keep one full
  reconstruction per revision.
- **Declared topology / closure / certificate**: global; keep exact.
- **`.edc`, exports, teacher reference previews, saved previews**: full exact
  path, because they are certification/verification boundaries.
- **Initial load/import/undo/redo**: full (cache by revision if desired).
- **Display mesh generation**: full per changed geometry; it is cheap
  (0.22 ms measured) and not worth incremental complexity.
- **HLR for changed geometry**: full per view; cache across camera moves.

What should *not* be full-rebuild:

- orbit/pan/zoom;
- selection, hover, inspection overlay;
- mode switches;
- label placement when only the 3D camera moved;
- sheet raster when only the 3D camera moved.

---

## 5. Target pipeline and migration sequence

### 5.1 Target pipeline

```
table mutation (rev++)
        |
        v
 [L0] snapshot + key: (revision, options, validation policy)
        |
        v
 [L1] fast reconstruction (numeric, no inferred exact validation)
        |            \
        |             +--> [L4 async] exact validation / certificate
        |                              -> badge update (pending -> ok/issues)
        v
 [L2] publish geometry (setGeometry)
        |
        +--> [L3a] HLR per view (cache by geometry+view)
        +--> [L3b] label layout (cache by entities+view+prefs)
        +--> [L3c] sheet raster (optional cache; datum gaps per frame)
        +--> [L3d] 3D widget frame (projection only; no model)
```

The exact path remains the default for `edc` and exports. The app opts into
the fast path explicitly, so the same pipeline serves both.

### 5.2 Migration sequence

**Phase 0 — Instrumentation (no behavior change).**

- Add stage timers around: `reconstruct` total, each major stage, exact
  validation, `Surfaces.*`, `renderLayer1`, `Labels.resolve`,
  `spatialView.overlayLayout`, `projectGeometry`, `setGeometry`.
- Expose counters: cache hits/misses, pending validations, dropped stale
  worker results.
- Add a `--timing` (or `EDUCAD_PERF=1`) mode to `tools/edc.js` that prints the
  same stage table per script. Do not change `.edu` expectations.
- Record a baseline across `tools/scripts/*.edu` and the demo sheets.

**Phase 1 — Revision-keyed memoization (R2).**

- Cache the last result by `table.revision()` + options.
- Remove duplicate `rebuildSolid()` calls on mode switches.
- Verify: all `.edu` scripts byte-identical reports; mode toggle; add/move/
  delete/rename; undo/redo; save/load.

**Phase 2 — Deferred exact validation (R1).**

- Add `validation: 'full' | 'deferred' | 'interactive'`; default `'full'`.
- App uses `'deferred'` during edits and upgrades on idle; `edc` stays
  `'full'`.
- Show a `pending`/`unverified` badge, never `ok`, until exact finishes.
- Verify: all `.edu` expectations (including `surfaceValidation=issues`) pass;
  the app's final status matches the old status after the upgrade; export
  forces full.

**Phase 3 — 2D frame and label cache (R3/R4).**

- Cache `EduCADLabels.resolve`; reuse it for `renderLayer1`, `datumGaps` and
  overlay.
- Remove the full `renderLayer1` from `afterDraw`; use an offscreen sheet
  raster excluding the datum, or a clipped datum-band redraw.
- Verify: orbit/pan/zoom/reset, split panes, selection rings, labels crossing
  the datum, DPR 1/2, mobile fallback.

**Phase 4 — HLR and overlay cache (R5).**

- Precompute face normals/adjacency; cache `projectGeometry` per view.
- Verify: pose front/top/side overlays, hidden-line expectations in `.edu`
  sheets, side-frame direction `s = ±1`.

**Phase 5 — Interactive LOD/preview (R6).**

- Coarser curve tessellation and/or HLR while dragging; exact on release.
- Verify: preview geometry is tagged; exact mode reproduces old counts;
  reference previews never use preview mesh.

**Phase 6 — Worker (R7), optional.**

- Move the exact/full run to a Worker; sequence numbers; last-good geometry.
- Verify: `.edc` unchanged; worker vs sync output digest equal; stale results
  dropped.

**Phase 7 — Component dirty graph (R8), optional.**

- Only for explicit-identity sheets with a proven dependency graph.
- Verify with a corpus of linked/member-declared `.edu` sheets; fall back to
  full rebuild whenever the graph is incomplete.

### 5.3 Benchmark suite and budgets

Add a small set of `.edu` sheets that are both correctness and performance
fixtures (they already carry `# expect:` properties):

- `perf-straight.edu` — 18-gon prism, matches `large-prism` (36V/54E/20F).
- `perf-large.edu` — 30-gon prism (60V/90E/32F).
- `perf-curved.edu` — cylinder/cone with oblique boundary (25V/48E/25F/1C).
- `perf-mixed.edu` — plate with holes/curves (`mixed-curved-plate` style).

Run them:

```sh
for f in tools/scripts/perf-*.edu; do node tools/edc.js "$f" || exit 1; done
node tools/edc.js --timing tools/scripts/perf-straight.edu
node tools/edc.js --timing tools/scripts/perf-curved.edu
```

Suggested interactive budgets (main-thread CPU, excluding GPU raster):

| Budget | Target |
|---|---|
| Fast reconstruct, straight sheet | < 16 ms |
| Fast reconstruct, curved sheet | < 33 ms |
| Exact validation (background) | < 250 ms typical; report `skipped` above budget |
| Orbit frame, main-thread JS | < 8 ms |
| Label cache hit | < 0.1 ms |
| Sheet blit (if added) | < 1 ms |
| Mode switch | < 1 ms (cache hit) |

These are starting points, not hard limits. The important regression gate is
that every existing `.edu`/`.edc` report and `# expect:` line stays unchanged.

### 5.4 `.edu` verification protocol

1. Before a change: run the full corpus and save the reports:
   `for f in tools/scripts/*.edu; do node tools/edc.js "$f"; done`.
2. After the change: run the same corpus; every `# expect:` must pass. Pay
   special attention to `surfaceValidation`, `surfaceCertificate`,
   `diagnostics`, `status` and geometry counts on curved/recess/fillet sheets.
3. For a performance change, run the same script 10 times in one process with
   `--timing`; compare median, not a single cold run.
4. For app-only changes (canvas/worker), use the demo recording plus a manual
   pass; `.edc` cannot assert pixels. Keep the exact path as the reference.

---

## 6. Risks and numeric tradeoffs

### 6.1 Correctness risks

| Risk | Mitigation |
|---|---|
| Deferred validation shows an unverified model as verified | Explicit `pending`/`unverified` status; force full validation on export/save/preview publish; never reuse the old `ok` badge |
| Revision-only cache misses an in-place mutation | Audit all entity writes; add dev assertion/content digest; or add per-entity versions to the table |
| HLR cache key omits side frame/pose | Include `xRef`, `dRef`, `s`, view and pose matrix; invalidate on pose gesture |
| Label cache key omits mode/drafting layout | Include table revision, view, mode, layout revision and label prefs |
| Coarse preview mesh leaks into certificate/save | Tag preview geometry; exact APIs reject preview meshes |
| Worker returns out of order | Monotonic sequence IDs; drop stale results; keep last good geometry |
| Per-component graph misses cross-view matching | Do not use for auto-inferred sheets; fall back to full rebuild on any incomplete graph |
| Offscreen sheet bitmap stale after font/DPR/theme change | Invalidate on DPR, font load, theme, canvas size, preferences |

### 6.2 Numeric and memory tradeoffs

- **Exactness vs latency.** Exact rational triangle-pair tests are expensive
  and, on inferred tessellation, certify an approximation. Keep exactness for
  declared topology and the certificate; use numeric/bounded checks or defer
  for inferred display meshes. If a numeric broad-phase is used, keep an exact
  fallback for near/ambiguous pairs and report `partial`, not `ok`.
- **Triangle budget.** The current 400-triangle cap is too high for an
  interactive exact check. 116 triangles took 830 ms on the 30-gon synthetic.
  A 64-triangle interactive budget is more realistic; anything above it should
  be background/skipped with a reason.
- **Tessellation.** 24 segments per curve is a display choice. A 12–16 segment
  preview halves triangle counts and HLR work, but changes silhouettes; only
  use it while dragging.
- **Memory.** One cached geometry result: tens to hundreds of KB. One
  full-window sheet bitmap: 8 MB at DPR 1, 33 MB at DPR 2 (1920×1080). A
  worker copy: 1–5 MB depending on geometry. OpenSCAD's default caches are
  100 MB each; EduCAD should use a much smaller budget (e.g. 16–32 MB) and an
  LRU.
- **Frame budget.** 60 Hz = 16.7 ms. Measured label layout alone is 16.0 ms at
  163 entities and 37.5 ms at 270. Any design that re-runs labels per orbit
  frame cannot meet 60 Hz on moderate sheets, regardless of GPU speed.
- **Reconstruct budget.** After removing exact validation, 18-gon is ~26 ms
  and 30-gon ~48 ms (estimate). That is 20–38 fps before raster. Large-sheet
  drag still needs R6 or R7.
- **Cache hit rate.** Mode switches and repeated identical states hit 100%.
  A drag produces a new revision per move, so the live cache does not help
  unless moves are coalesced or the fast path is used. Do not expect
  memoization alone to fix drag.

### 6.3 Unverified / needs browser profiling

- Canvas rasterisation and compositing costs are not measured; the 16–37 ms
  label numbers are CPU layout only. A browser trace is needed before choosing
  the offscreen bitmap vs clipped-redraw option.
- The post-defer latency estimates assume the non-validation remainder is
  unchanged; phase 0 instrumentation should confirm.
- The exact-validation share is topology-dependent; the 400-triangle worst
  case was not measured end-to-end in the app.
- Cache memory sizes are estimates; measure actual result object sizes before
  setting an LRU budget.
- Worker transfer costs and browser support for the chosen typed-array layout
  are untested.
- FreeCAD/OCCT/OpenSCAD/Manifold/Blender behaviour is cited from their
  documentation/source at the versions below; performance claims from those
  projects are not independently reproduced here.

---

## 7. Ranked recommendation

1. **R1 — Defer exact inferred-surface validation (P0).** Largest measured
   win: 34–100% of reconstruction, 0.3–2.5 s. Keep the exact certificate and
   declared-topology checks; change only the inferred display validation and
   its status honesty.
2. **R3/R4 — Stop the full sheet + label rebuild on every 3D frame (P0).**
   Cache label layout and overlay layout; move datum re-cutting to an
   offscreen sheet raster or clipped datum-band redraw. Mandatory for 60 Hz
   orbit at 163+ entities.
3. **R2 — Revision-keyed memoization and remove redundant rebuilds (P0/P1).**
   Cheap, low-risk, and makes mode switches/duplicate rebuilds free. Audit
   in-place mutations first.
4. **R5 — HLR/overlay caching and precomputed normals/adjacency (P1).**
   Moderate constant-factor win; also cleans up the most obviously redundant
   loop in the projection code.
5. **R6 — Interactive LOD/preview policy (P1).** Needed for large-sheet drag
   after R1; mirrors OpenSCAD/OCCT/FreeCAD practice and keeps exactness for
   final output.
6. **R7 — Worker for the full/exact pipeline (P2).** Removes the remaining
   main-thread freeze without changing results. Do after R1–R6 prove the
   remaining cost.
7. **R8 — Per-component dirty graph (P3).** High complexity and correctness
   risk; only for explicit-identity sheets with a proven dependency model.

If only one change is made, make R1. If two, make R1 + R3/R4. R2 is the
cheapest correctness-preserving cleanup and should ship alongside them.

---

## References

Versions and URLs are pinned as of 2026-11-11.

### FreeCAD / Coin3D

- FreeCAD main branch, commit
  [`7294e95e9756c6ed6093dc2bac5a35b34d017313`](https://github.com/FreeCAD/FreeCAD/tree/7294e95e9756c6ed6093dc2bac5a35b34d017313):
  - [`src/App/Document.cpp`](https://github.com/FreeCAD/FreeCAD/blob/7294e95e9756c6ed6093dc2bac5a35b34d017313/src/App/Document.cpp)
    — `Document::recompute`, dependency list, two-pass recompute.
  - [`src/App/DocumentObject.cpp`](https://github.com/FreeCAD/FreeCAD/blob/7294e95e9756c6ed6093dc2bac5a35b34d017313/src/App/DocumentObject.cpp)
    — `touch`, `mustExecute`, `getInListProp`, `getOutListProp`.
  - [`src/Gui/ViewProvider.cpp`](https://github.com/FreeCAD/FreeCAD/blob/7294e95e9756c6ed6093dc2bac5a35b34d017313/src/Gui/ViewProvider.cpp)
    — `pcRoot`, `setRenderCacheMode`.
  - [`src/Mod/Part/Gui/ViewProviderExt.cpp`](https://github.com/FreeCAD/FreeCAD/blob/7294e95e9756c6ed6093dc2bac5a35b34d017313/src/Mod/Part/Gui/ViewProviderExt.cpp)
    — `updateVisual`, `lastRenderedShape`, `Deviation`, `AngularDeflection`.
- FreeCAD wiki: [Std_Refresh](https://wiki.freecad.org/Std_Refresh),
  [Viewprovider](https://wiki.freecad.org/Viewprovider).
- Coin3D: [`SoSeparator`](https://www.coin3d.org/coin/classSoSeparator.html)
  — `renderCaching`, `AUTO/ON/OFF`, display-list heuristics.

### OCCT

- OCCT 7.8.0, tag
  [`V7_8_0`](https://github.com/Open-Cascade-SAS/OCCT/tree/V7_8_0):
  - [`src/AIS/AIS_InteractiveContext.cxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_0/src/AIS/AIS_InteractiveContext.cxx)
    — `Redisplay`, `RecomputePrsOnly`, `Update`.
  - [`src/AIS/AIS_ViewController.cxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_0/src/AIS/AIS_ViewController.cxx)
    — `handleViewRedraw`, invalidated views.
  - [`src/V3d/V3d_View.cxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_0/src/V3d/V3d_View.cxx)
    — `Update`, `Redraw`, `Invalidate`.
  - [`src/HLRBRep/HLRBRep_InternalAlgo.cxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_0/src/HLRBRep/HLRBRep_InternalAlgo.cxx)
    — HLR `Update`.
  - [`src/HLRBRep/HLRBRep_HLRToShape.cxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V7_8_0/src/HLRBRep/HLRBRep_HLRToShape.cxx)
    — visible/hidden compound extraction.
- OCCT Visualization user guide:
  <https://dev.opencascade.org/doc/overview/html/occt_user_guides__visualization.html>
  — retained presentation, HLR in view pipeline, `Prs3d_TOH_PolyAlgo` vs
  `Prs3d_TOH_Algo`.

### OpenSCAD

- OpenSCAD 2021.01, tag
  [`openscad-2021.01`](https://github.com/openscad/openscad/tree/92350eba8ce749ddc1d04c2191c65a156a7f07ef):
  - [`src/GeometryEvaluator.cc`](https://github.com/openscad/openscad/blob/92350eba8ce749ddc1d04c2191c65a156a7f07ef/src/GeometryEvaluator.cc)
    — `evaluateGeometry`, `getIdString`, `smartCache*`.
  - [`src/GeometryCache.h`](https://github.com/openscad/openscad/blob/92350eba8ce749ddc1d04c2191c65a156a7f07ef/src/GeometryCache.h),
    [`src/CGALCache.h`](https://github.com/openscad/openscad/blob/92350eba8ce749ddc1d04c2191c65a156a7f07ef/src/CGALCache.h),
    [`src/cache.h`](https://github.com/openscad/openscad/blob/92350eba8ce749ddc1d04c2191c65a156a7f07ef/src/cache.h)
    — LRU and default 100 MB budgets.
- OpenSCAD command-line manual (2025.08.17 CLI):
  <https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Using_OpenSCAD_in_a_command_line_environment>
  — `--preview`, `--render`, `--backend`.
- OpenSCAD Manifold-vs-CGAL benchmark discussion:
  <https://github.com/openscad/openscad/issues/6103>.

### Manifold

- Manifold v3.5.4, tag
  [`v3.5.4`](https://github.com/elalish/manifold/tree/ce50d78021d64507f89e8c9fc2c2e51018117857):
  - [`include/manifold/manifold.h`](https://github.com/elalish/manifold/blob/ce50d78021d64507f89e8c9fc2c2e51018117857/include/manifold/manifold.h)
    — deferred CSG ops, `BatchBoolean`, `AsOriginal`, `Simplify`.
  - [`README.md`](https://github.com/elalish/manifold/blob/ce50d78021d64507f89e8c9fc2c2e51018117857/README.md)
    — reliability/performance goals, TBB parallelisation.

### Blender

- Blender developer documentation, [Dependency Graph](https://developer.blender.org/docs/features/core/depsgraph/):
  only dependents of a changed value are updated; copy-on-write evaluation;
  component-level invalidation flags (`DEG_RE_MATERIALS_UPDATE`,
  `DEG_RE_GEOMETRY_UPDATE`).

### EduCAD

- `AGENTS.md` — Major scope, reconstruction pipeline and verification rules.
- `docs/RECONSTRUCTION_CONTRACT.md` — exact declared surface contract;
  inferred display meshes are outside the guarantee.
- `public/lib/educad-reconstruct.js`, `educad-strict.js`,
  `educad-project.js`, `educad-solid.js`, `educad-spatial.js`,
  `educad-labels.js`, `educad-ref3d.js`, `educad-entities.js`.

# EduCAD application architecture

**Current state, mature-OSS patterns, and a target design**

> Research/design round. No production code was changed. Scope is **Major**
> (`public/index.html`, `public/lib/`, `public/*.js`, `backend/`, `tools/edc.js`);
> Major2 is out of scope per `AGENTS.md`.
>
> Baseline: commit `43d3b7f`, 2026-11-11. Method: source reading, a headless run
> of every drawing script under `tools/scripts/`, and upstream source/docs for
> the versions listed in §2. No browser session, backend build, or benchmark was
> run; those limits are listed in §6.4.

## Executive summary

EduCAD's geometry core is in better architectural shape than its file layout
suggests. Of 35 library modules, 29 have no direct DOM references, all 35 load
under plain Node `require`, and the app, teacher preview, and `.edu` runner all
converge on one reconstruction entry point. The analytic surface layer is
explicitly independent of display tessellation, and 151 drawing scripts exercise
the command-to-reconstruction path end to end.

The bottlenecks are elsewhere:

- **No document/command facade.** `CadEntityTable` is a de facto document, but
  history, transactions, saving, selection, and mode live in different closures
  inside `public/index.html` and `educad-drafting.js`.
- **UI verticals contain kernels.** `educad-solid.js`, `educad-spatial.js`,
  `educad-orthographic.js`, and `educad-drafting.js` each combine a reusable
  pure core with a DOM mount. The split points are already visible in the files.
- **The geometry schema is duck-typed.** Reconstruction results are plain
  objects with many optional fields; there is no versioned model boundary
  between the kernel, display adapters, saved previews, and tests.
- **Commands are a parser plus a switch.** Mouse actions and slash commands are
  separate code paths, so `.edu` cannot verify the actions the UI actually runs.
- **Grading is a second geometry implementation.** The C++ backend's
  `compareDrawings` matches entities by nearest position in 0.5 mm, independent
  of the reconstruction pipeline and its identity rules.

Mature systems converge on three planes: a headless document/model, an
evaluator/kernel that turns it into geometry, and a presentation/command layer
that depends inward. FreeCAD's App/Gui and ViewProvider split, LibreCAD's action
state machine, OpenSCAD's AST/CSG/geometry-evaluator split, BRL-CAD's
librt/libged/GUI layering, and Manifold's small plain-data kernel API are five
different expressions of the same rule.

The recommended order is: add boundary guardrails, extract a document/transaction
facade, split the UI verticals, then introduce a command/action facade, unify
grading, version the geometry model and reconstruction stages, and finally
generate per-page bundles. Do **not** rewrite the geometry core, add npm
dependencies, or replace the `.edu` harness.

---

## 1. Current architecture

### 1.1 Composition roots

There are five places that assemble the application. Each has its own dependency
list and its own idea of what the app is.

| Root | Size | What it loads / owns |
|---|---:|---|
| `public/index.html` | 6,415 lines total; 5,824 lines of inline JS; 35 external scripts | Login gate, mobile classification, session bar, boot, all sheet rendering (`renderLayer1`, `renderLayer2`), pointer/keyboard routing, mode/pose/gesture state, tools, tutorials, settings, command line, save/drawings/sets panels, teacher and student panels reachable from the sheet. |
| `public/teacher.html` + `public/teacher.js` | 15 scripts; 971 lines JS | Teacher studio: classes, question sets, model-answer capture, strict auto-check toggle, per-question 3D preview. Loads the reconstruction modules directly and calls `EduCADRef3d.buildPreview(..., EduCADReconstruct)`. |
| `public/student.html` + `public/student.js` | 4 scripts; 522 lines JS | Student workspace: classes, sets, submissions, grades. Uses `EduCADSaves` only; no geometry imports. |
| `tools/edc.js` | 479 lines | Headless composition root for `.edu`/`.edc`: requires `educad-command`, `educad-entities`, `educad-reconstruct`, `educad-project`, `educad-surfaces`, `educad-parametric`, `educad-ref3d`, and lazily `educad-drafting` for through-point edits. Owns script parsing, surface queries, `# expect` checks, and reporting. |
| `backend/` | 3,128-line `src/main.cpp`; 9 SQLite tables; 32 routes | Static server, login/sessions/ERP, drawings, progress, classes, sets, submissions, grading, and a natural-language `/api/interpret` proxy. No geometry kernel; only a 2-D entity matcher used for grading. |

The important consequence: **the "application" is not a module**. It is a large
inline script plus page-specific scripts, each wiring library globals by hand.
`public/index.html:669-5024` alone is 4,355 lines of orchestration and rendering.

### 1.2 Module/dependency graph

Declared UMD dependencies (solid arrows), plus runtime global lookups marked
`{...}*` (dashed in prose because they are not in the factory signature):

```text
COMPOSITION ROOTS
  index.html ──> boot ──> viewport, canvas, entities, shim, solver,
                    snapping, instruments, curriculum, labels, common
       │
       ├──> drafting ──> geometry, entities, parametric
       │                 {mobile, solid, spatial}*
       ├──> solid
       ├──> spatial ──> settings {mobile}*
       ├──> orthographic ──> measure, geometry, settings
       │                    {mobile, solid, spatial}*
       ├──> measure ──> geometry
       ├──> pose ──> geometry
       ├──> command ──> {drafting}* (thunk), parametric
       ├──> reconstruct ──> entities, strict, curve-reconstruct,
       │                    oblique-kernel, project (thunk), surfaces,
       │                    parametric, parametric-reconstruct
       └──> settings, saves, tutorial, curriculum, mobile, ...

  teacher.js ──> saves, reconstruct, ref3d
  student.js ──> saves
  edc.js     ──> command, entities, reconstruct, project, surfaces,
                 parametric, ref3d {drafting}*
```

`L0` below groups modules with no declared library dependencies; it mixes pure
math with the DOM-bound `mobile` and `solid` modules, so it is a dependency
level, not a purity level. Read bottom-up, the domain graph is mostly acyclic:

```text
L0  vec3  parametric  viewport  settings  strict  surfaces  project
    oblique-kernel  solver  curriculum  labels  tutorial  saves
    mobile  solid

L1  geometry ──> parametric
    entities ──> parametric
    curve-reconstruct ──> parametric, vec3
    parametric-reconstruct ──> parametric
    ref3d ──> parametric
    measure ──> geometry
    pose ──> geometry

L2  reconstruct ──> entities, strict, curve-reconstruct,
                    oblique-kernel, project, surfaces, parametric,
                    parametric-reconstruct
    verify ──> entities
    auto ──> command, entities, saves
    command ──> drafting (lazy), parametric

L3  spatial ──> settings {mobile}*
    orthographic ──> measure, geometry, settings {mobile, solid, spatial}*
    drafting ──> geometry, entities, parametric {mobile, solid, spatial}*
    shim ──> entities, viewport, parametric
    boot ──> injected modules, or window globals
```

Two load-order facts matter:

- `educad-reconstruct.js` is loaded at `index.html:653`, before
  `educad-project.js` at line 665, but resolves `EduCADProject` through a thunk.
  The dependency is real; the script order only works by deferral.
- `educad-command.js` is loaded at line 662, before `educad-drafting.js` at
  line 666. Its browser factory passes `function () { return root.EduCADDrafting; }`,
  so `/delete`, `/rename`, and other edit commands work only because the thunk
  resolves later.

Neither dependency is visible in a manifest. Moving one `<script>` tag can
break a command at runtime rather than at load time.

### 1.3 Responsibilities

**Domain and math (pure; Node-safe)**

- `educad-vec3.js` (35 lines) — vector arithmetic.
- `educad-parametric.js` (128) — parametric curve representation, validation,
  tessellation, interpolation, exact circle/plane definitions.
- `educad-geometry.js` (96) — segment/arc/capsule geometry and curve tessellation.
- `educad-entities.js` (735) — entity types, factories, `CadEntityTable`,
  member identities, style/BIS resolution, projector checks, and a pure
  *render-job descriptor* (`renderEntity(view, entity)`), not a painter.
- `educad-strict.js` (308) — exact reconstruction of declared vertices,
  edges, and triangles; rational arithmetic; `educad-explicit-v1` certificate.
- `educad-surfaces.js` (2,588) — analytic bounded surfaces (plane, cylinder,
  cone, sphere), validation, incidence, certificates, sections, intersections,
  trims, splits, boundary attachment. Display tessellation is explicitly not
  authoritative.
- `educad-project.js` (304) — exact orthographic Monge projection with
  visibility intervals and point occlusion.
- `educad-curve-reconstruct.js` (1,743), `educad-oblique-kernel.js` (595),
  `educad-parametric-reconstruct.js` (289) — curve lifting, oblique-plane
  fitting, parametric reconstruction.
- `educad-reconstruct.js` (3,851) — the pipeline facade: view graph,
  correspondence, primitive recognizers, closed-face inference, strict and live
  entry points, diagnostics. This is the top of the domain graph and also the
  largest module.
- `educad-solver.js` (604) — Monge line solver and analytic geometry.
- `educad-curriculum.js` (810) — lessons, demos, and curriculum truth data.
- `educad-labels.js` (615) — label placement/layout (pure; no DOM).
- `educad-verify.js` (332) — lesson verdict/claim checker; never feeds
  reconstruction.
- `educad-ref3d.js` (200) — derives a storable, plain-JSON 3-D preview from a
  model-answer sheet.
- `educad-pose.js` (1,241) — pose transforms, copies, routes, gesture math.
- `educad-settings.js` (299) — preference schema and storage adapter.
- `educad-saves.js` (297) — session, snapshot/restore, HTTP API client.
- `educad-tutorial.js` (375), `educad-auto.js` (122) — tutorial stepper and
  staged auto-draw runner (`command` + `entities` + `saves`).
- `educad-command.js` (1,628) — 27 slash commands: metadata, parse, suggest,
  preview, execute. Pure parsing; `execute` mutates a table and may call
  `drafting` for edit operations.

**Presentation helpers (pure unless noted)**

- `educad-canvas.js` (1,283) — canvas state, hit-testing, selection/rename,
  typed distances, line/polar/plot/circle tool state machines. No DOM.
- `educad-measure.js` (430) — Edit/View/Pose mode state, inspection, dimension
  layout.
- `educad-viewport.js` (131) — mm ↔ screen-pixel transforms.
- `edugraphics-snapping.js` (430), `edugraphics-instruments.js` (316) — snap
  candidates and ruler/compass geometry.
- `edugraphics-common.js` (218) — DOM mount, HiDPI sizing, menu sync.
- `educad-shim.js` (1,990) — GeoGebra-compatible applet facade over the entity
  table and viewport.

**UI verticals (mixed core + mount)**

- `educad-spatial.js` (671) — pure reference surfaces, bounds, projection,
  measurement rows, inspection items (lines 1–342); panel mount and layout
  (lines 343–671).
- `educad-orthographic.js` (431) — pure role/title/spec/inventory/comparison
  logic (lines 1–149); panel mount and overlay painting (lines 150–431).
- `educad-drafting.js` (1,059) — pure edit rules, member linking, history,
  move/rename/profile logic (lines 1–426); editor menu, pointer handling, and
  dimension drawing (lines 427–1,059).
- `educad-solid.js` (1,361) — pure solid state, geometry normalization,
  projection, face visibility, edge classification, canvas rendering
  (lines 1–569); widget/glass mounting and interaction (lines 570–1,361).
- `educad-mobile.js` (1,701) — touch detection, gestures, split layout, HUD,
  storage. Entirely DOM/layout.
- `educad-boot.js` (199) — wires the core modules, creates the table/viewport,
  mounts the container, disposes. Its `MODULE_FILES` list names only the 11 core
  modules; it is not a full app manifest.

**Application layer**

- `public/index.html` inline JS — everything listed in §1.1.
- `public/teacher.js`, `public/student.js`, `public/login.js` — page-specific
  workflows.
- `tools/edc.js` — headless script runner and report generator.

### 1.4 Data flow

1. A pointer/key event in `index.html` reaches a tool state machine in
   `educad-canvas.js` or the drafting mount, which calls `table.create/update/remove`.
2. The table bumps its revision and notifies subscribers (entities.js:413–425).
3. Three subscribers react independently:
   - `educad-drafting.createHistory` snapshots the whole entity list on a
     microtask and stores up to 50 versions (drafting.js:187–231);
   - the inline app queues `rebuildSolid` on `requestAnimationFrame`, which
     calls `EduCADReconstruct.reconstruct(table.list())` and feeds
     `EduCADSolid.setGeometry`;
   - drafting refreshes its layout and the sheet repaints.
4. Save serializes the table through `EduCADSaves.snapshotTable`; load restores
   it through `restoreTable`.
5. A teacher model answer is snapshotted, then `EduCADRef3d.buildPreview` derives
   a plain-JSON 3-D shape and stores it opaquely with the question.
6. `.edu`/`.edc` runs `EduCADCommand.execute` against a fresh table, then
   `EduCADReconstruct.reconstruct`, then checks topology/surface expectations.
7. Auto-grading posts the student snapshot to
   `POST /api/sets/:code/verify`, where C++ `compareDrawings` does an
   independent nearest-entity match.

The reconstruction call is the one true seam: the live app, teacher preview, and
script runner all use it. Everything around that seam — document lifecycle,
command dispatch, view state, persistence, grading — has a different owner in
each root.

### 1.5 Measured baseline

Measurements taken in this worktree at `43d3b7f`:

| Property | Value | How measured |
|---|---:|---|
| Library modules | 35 | `ls public/lib/*.js` |
| Library lines | 27,415 | `cat public/lib/*.js \| wc -l` |
| Library payload | 1.25 MB raw, 319 KB gzip | `cat public/lib/*.js \| gzip -c \| wc -c` |
| Core 11-module payload | 284 KB raw, 71 KB gzip | boot manifest set, gzip |
| Modules load under Node | 35/35 | `require()` each module |
| Modules with direct DOM references | 6/35 | grep for `document.`, `getElementById`, `createElement`, `addEventListener` |
| Index external scripts | 35 | `<script src=` count |
| Index inline JS | 5,824 lines; main block 4,355 | extracted `<script>` bodies |
| Slash commands | 27 | `EduCADCommand.COMMANDS.length` |
| Drawing scripts | 151 (143 `.edu`, 8 `.edc`) | `tools/scripts/` |
| Scripts with `# expect` | 143 | grep |
| Scripts with `# surface-query` | 27 | grep |
| Scripts with `# reject` | 1 | grep |
| Scripts that invoke `--strict` | 0 | grep |
| Headless script result | 151/151 clean | `node tools/edc.js` each; one surface-intersection script takes ~10.2 s, so a 10 s timeout reports a false failure |
| Core cold boot | 0.28 ms headless | `EduCADBoot.coldBootMs` with explicit deps |
| Backend routes / tables | 32 / 9 | `svr` Get/Post/Put/Delete registrations; `backend/schema.sql` |

The core boot budget (`BOOT_BUDGET_MS = 3`, `BUNDLE_BUDGET_KB = 80`,
`HEAP_BUDGET_MB = 35`) holds for the 11-module core: 71 KB gzip and 0.28 ms.
There is no budget or measurement for the full 319 KB application payload.

### 1.6 What is already good

1. **The pure core is genuinely pure.** 29/35 modules are DOM-free; every module
   loads in Node. That is rare for a browser CAD app and is the main reason the
   `.edu` harness can work at all.
2. **One reconstruction facade.** The app, teacher preview, and script runner all
   call `EduCADReconstruct.reconstruct` (or `reconstructStrict` explicitly).
   There is no second JS reconstruction implementation.
3. **Strict and inferred are deliberately separated.** `EduCADStrict` implements
   the declared contract with rational arithmetic and a certificate; the live
   inferred pipeline is a separate path with diagnostics. The contract is
   documented in `docs/RECONSTRUCTION_CONTRACT.md`.
4. **Analytic surfaces are separate from display.** `EduCADSurfaces` owns
   analytic definitions, validation, and certificates; the renderer only consumes
   tessellation. This is exactly the boundary mature kernels enforce.
5. **The `.edu` harness is a real end-to-end check.** 151 scripts cover
   primitives, hidden-line projection, curves, surfaces, trims, splits, and
   diagnostics. This is stronger than a pile of unit tests for the geometry
   contract.
6. **The backend keeps geometry out of C++.** It stores drawings and previews
   opaquely; it does not reimplement reconstruction. (Grading is the exception;
   see below.)

### 1.7 What hurts

1. **The app is an inline god script.** The main block owns rendering, input,
   mode transitions, pose, tutorials, settings, command line, saves, sets, and
   teacher/student panels. It is 4,355 lines with no unit boundary, and it calls
   roughly every library global directly.
2. **There is no document object.** `CadEntityTable` is the model, but history
   lives in `educad-drafting.js`, serialization in `educad-saves.js`, mutation
   guards on the table, and transaction boundaries nowhere. Three different
   modules believe they own the document lifecycle.
3. **There is no command/action object.** `educad-command.COMMANDS` is a metadata
   array; `execute` is a 600-line switch. Mouse actions (`userPlacePoint`,
   `setSheetMode`, `enterPose`, toolbar handlers) are separate functions. The
   same user action has two implementations and only one is exercised by `.edu`.
4. **UI verticals mix kernel and presentation.** The pure/mount split points are
   visible (solid 569/570, spatial 342/343, orthographic 149/150, drafting
   426/427), but they are not module boundaries. The pure parts cannot be
   depended on without loading DOM code.
5. **The geometry schema is implicit.** A `geometry` object may carry
   `vertices`, `edges`, `faces`, `faceRegions`, `faceHoles`, `curves`,
   `surfaces`, `surfaceComponents`, `solids`, `profileMap`, `fillets`,
   `recesses`, and more. Each consumer duck-types the fields it needs.
   `EduCADRef3d.validPreview` is an ad-hoc validator for the stored preview.
6. **Load order is maintained by thunks and manual script lists.** 35 tags in
   `index.html`, 15 in `teacher.html`, different subsets, manual `?v=` strings,
   and no manifest that both pages share.
7. **The command layer reaches upward into UI by design.** `educad-command`
   depends on `educad-drafting` for edit commands. That makes the headless
   command surface depend on the editor mount, even when the command is pure.
8. **Zero-dependency islands duplicate logic.** `educad-canvas` mirrors
   `EduCADEntities.COINCIDENT_TOL_MM` and `EduCADLabels.splitCaption`
   (canvas.js:256, 373); `educad-verify` mirrors the same label parser
   (verify.js:43). The comments admit the duplication. Small copies are a
   reasonable zero-dep tradeoff; drift is not.
9. **Grading is a second geometry semantics.** `compareDrawings` in
   `backend/src/main.cpp:1286` greedily matches visible entities by type and
   position with `kEpsMm = 0.5`, ignoring member identity, view-role semantics,
   and the strict contract. Two equivalent drawings can grade differently from
   how they reconstruct.
10. **No CI gate.** `.github/` contains issue/PR templates but no workflow that
    runs `tools/edc.js` or the module graph check.

---

## 2. How mature OSS CAD systems separate concerns

### 2.0 Versions used

| Project | Version / source used | Why this version |
|---|---|---|
| FreeCAD | 1.1.4 stable, released 2026-09-28 ([release](https://github.com/FreeCAD/FreeCAD/releases/tag/1.1.4)); 26.3 in RC | Current stable source tree; App/Gui and command code are stable across 1.x. |
| LibreCAD | 2.2.1.6, released 2026-10-17 ([release](https://github.com/LibreCAD/LibreCAD/releases/tag/v2.2.1.6)) | Current stable 2D tree; action/document classes are directly comparable. |
| OpenSCAD | 2021.01 stable ([downloads](https://openscad.org/downloads.html)); 2026.11-RC0 current ([announcement](https://lists.openscad.org/empathy/thread/4INROLXVKUGWDWBYW6DQH3KD4A5AP727)) | Stable source for the AST/CSG/GeometryEvaluator split; RC for the Manifold backend. |
| BRL-CAD | 7.46.0 (2026-10-12 per `NEWS`; [release](https://github.com/BRL-CAD/brlcad/releases/tag/rel-7-46-0)) | Current library split; `libged`/`librt` interfaces are long-lived. |
| Manifold | 3.5.4, released 2026-09-25 ([release](https://github.com/elalish/manifold/releases/tag/v3.5.4)) | Current public kernel API and `MeshGL` boundary. |
| EduCAD | commit `43d3b7f` | This worktree. |

### 2.1 FreeCAD: App / Gui split, ViewProviders, commands, workbenches

FreeCAD is the clearest large-scale example of a **document/model plane that can
run without the GUI**. The documentation states that the graphical user
interface is separated from the base application, and that documents themselves
have an Application document (constructive parameters) and a View document
(representation) ([FreeCAD Document structure](https://wiki.freecad.org/Document_structure)).
The source boundary is explicit: `App::DocumentObject::getViewProviderName()` is
the method by which an App object names its Gui representation, and the Gui side
creates a `Gui::ViewProvider` for it. `ViewProvider` is a transaction-aware
object with `attach`, `updateData`, selection, drag/drop, and display properties
([`src/Gui/ViewProvider.h`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Gui/ViewProvider.h),
[`src/App/DocumentObject.h`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/DocumentObject.h)).
Property changes propagate from App to Gui through signals; the ViewProvider's
`updateData` is the documented reaction point
([Developers Handbook: Property Changes](https://freecad.github.io/DevelopersHandbook/technical/PropertyChanges.html)).

The **command framework** is a separate abstraction from both the document and
the Qt widgets. `Gui::Command` defines `activated(int)`, `isActive()`, resources,
and registration through `CommandManager::addCommand`. The header of
`src/Gui/Command.cpp` describes the framework as decoupling `QAction` and
`MainWindow`; a command can be enabled/disabled independently of a particular
toolbar button ([`src/Gui/Command.h`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Gui/Command.h),
[`src/Gui/Command.cpp`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Gui/Command.cpp),
[FreeCAD Command docs](https://wiki.freecad.org/Command)).

Domain code lives in workbenches under `src/Mod/<Name>/App` and
`src/Mod/<Name>/Gui`; Part, for example, keeps its `TopoShape` property in
`Part::Feature`
([`src/Mod/Part/App/PartFeature.h`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/Mod/Part/App/PartFeature.h))
and its display in PartGui view providers. Workbenches can be C++, Python, or both. Extension points are
therefore: new document object types, new properties, new ViewProviders, new
commands, and new workbench packages.

**Dependency direction:** `App` ← `Gui`; `<Workbench>/App` depends on `App` plus
the geometry kernel; `<Workbench>/Gui` depends on `<Workbench>/App` and `Gui`.
The App layer can run headless; the Gui layer is optional.

**Lesson for EduCAD:** the split to copy is *document data + view delegate +
command object*, not FreeCAD's property/signal machinery. EduCAD does not need a
generic property system; it needs the boundary and the command lifecycle.

### 2.2 LibreCAD: actions as state machines, event dispatch, document/layers

LibreCAD is a 2-D editor whose interaction model is built around
`RS_ActionInterface`. An action is a `QObject`/`RS_Snapper` subclass with
`init(status)`, mouse press/move/release, key press/release,
`coordinateEvent`, `commandEvent`, `setStatus/getStatus`, `finish`,
`suspend/resume`, and `getAvailableCommands`
([`librecad/src/lib/actions/rs_actioninterface.h`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/actions/rs_actioninterface.h)).
`RS_EventHandler` owns the current action stack and dispatches input to the
active action ([`librecad/src/lib/gui/rs_eventhandler.h`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/gui/rs_eventhandler.h)).
`LC_ActionFactory` constructs actions and `QG_ActionHandler` is the UI-side
entry point; this is the action/event architecture in practice.

The document side is `RS_Document`, a base for graphics and blocks. It owns the
layer list, block list, undo state, modified flag, file name, active pen, and
save/open operations; `RS_LayerList` owns layer creation/activation
([`librecad/src/lib/engine/rs_document.h`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_document.h),
[`librecad/src/lib/engine/rs_layerlist.h`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_layerlist.h)).
Entities are a separate hierarchy rooted at `RS_Entity`, with `RS_EntityContainer`
for blocks/graphics.

This is a **partial** separation, and the leaks are instructive:

- `RS_Document` stores an `RS_GraphicView*` and exposes `getGraphicView()`. The
  document knows a view, even though the view is a presentation object.
- `RS_ActionInterface` holds both `RS_GraphicView&` and `RS_Document*`; the action
  is simultaneously interaction controller, view client, and document mutator.
- Actions inherit `QObject` (for translation/signals) and are created by the UI
  action factory, so the action layer is not headless in the way
  `RS_Document`/`RS_Entity` are.

**Lesson for EduCAD:** the action state machine is a good fit for EduCAD's
line/polar/plot/circle tools, which already are implicit state machines. Copy the
lifecycle (`init`, event handlers, `finish`, `suspend/resume`, `isFinished`) and
the event-dispatch boundary. Do not copy the document→view pointer or the
QObject inheritance; keep the document headless.

### 2.3 OpenSCAD: source tree → CSG/evaluator → display backend

OpenSCAD is the closest architectural analogue to EduCAD's "drawing primitives →
reconstructed model" problem, because it separates several representations that
are easy to conflate:

1. **Source/AST** — [`src/AST.h`](https://github.com/openscad/openscad/blob/openscad-2021.01/src/AST.h),
   produced by the parser. This is the declarative document.
2. **Instantiated node tree** —
   [`src/node.h`](https://github.com/openscad/openscad/blob/openscad-2021.01/src/node.h)
   (`AbstractNode`), produced by module instantiation.
3. **CSG tree for preview** —
   [`src/csgnode.h`](https://github.com/openscad/openscad/blob/openscad-2021.01/src/csgnode.h),
   built by `CSGTreeEvaluator::buildCSGTree`
   ([`src/CSGTreeEvaluator.h`](https://github.com/openscad/openscad/blob/openscad-2021.01/src/CSGTreeEvaluator.h)).
   This tree is consumed by `OpenCSGRenderer` for the fast F5 OpenCSG preview.
4. **Evaluated geometry for render/export** — `GeometryEvaluator::evaluateGeometry`
   returns `shared_ptr<const Geometry>`
   ([`src/GeometryEvaluator.h`](https://github.com/openscad/openscad/blob/openscad-2021.01/src/GeometryEvaluator.h)),
   evaluated through CGAL Nef polyhedra for F6/STL export. Current master adds a
   Manifold backend at
   [`src/geometry/manifold/ManifoldGeometry.cc`](https://github.com/openscad/openscad/blob/master/src/geometry/manifold/ManifoldGeometry.cc).
5. **GUI** — [`src/MainWindow.h`](https://github.com/openscad/openscad/blob/openscad-2021.01/src/MainWindow.h)
   and [`src/GLView.h`](https://github.com/openscad/openscad/blob/openscad-2021.01/src/GLView.h);
   `GLView` explicitly notes that `OffscreenView` exists for offscreen rendering
   in tests and from the command line.

The documented behavior is exactly this split: F5 uses OpenCSG to fake CSG in
the framebuffer, while F6 uses CGAL to actually compute the solid for export
([OpenSCAD source notes](https://en.wikibooks.org/wiki/OpenSCAD_User_Manual/Building_OpenSCAD_from_Sources#Structure_of_OpenSCAD)).
The 2026.11-RC0 announcement lists the new Manifold geometry engine as a major
change, which is only possible because the evaluator/backend seam exists.

**Dependency direction:** AST/node/CSG/geometry are core; `GLView`,
`MainWindow`, and the Qt UI depend on them. The CLI path (`openscad -o out.stl
file.scad`) uses the same evaluator without a GUI, which is why OpenSCAD's render
tests can be headless.

**Lesson for EduCAD:** model the drawing as a declarative source (entities +
member identities + topology declarations), then evaluate it into (a) an exact
declared model, (b) an inferred model with diagnostics, and (c) display
tessellation. Do not let the display backend define the model. EduCAD already
does this for surfaces; it should do it for the whole pipeline and make the
geometry result a versioned value.

### 2.4 BRL-CAD: librt kernel, libged command layer, GUI applications

BRL-CAD's source tree documents the layering directly
([`src/README`](https://github.com/BRL-CAD/brlcad/blob/main/src/README)):

- `librt` — geometry representation, ray tracing, binary database I/O.
- `libged` — geometry editing commands, used by MGED/Archer.
- `libdm` — display manager; `libtclcad`/`libqtcad` — Tcl/Qt application support.
- `libwdb` — writing geometry; `libgcv` — conversion; `libanalyze` — analysis.
- `mged`, `archer`, `qged` — GUI applications on top.

A `libged` command has the signature
`int ged_xxx(struct ged *gedp, int argc, const char *argv[])`; `ged_exec`
dispatches, and `ged_cmd_list`/`ged_cmd_lookup` expose the command table
([`include/ged/commands.h`](https://github.com/BRL-CAD/brlcad/blob/main/include/ged/commands.h)).
Commands can be loaded as plugins; MGED and Archer use dynamic command loading
(per `NEWS`). MGED's `-c` mode runs the same commands without a GUI and accepts a
command stream on stdin, which is the direct analogue of EduCAD's `.edu` runner
([MGED manual](https://brl-cad.github.io/docs/man/1/mged.html)).

The libged header is candid about the tradeoff:

> "The library is tightly coupled to the LIBRT library for geometric
> representation and analysis. The libdm API is assumed for commands that
> manipulate geometric views."
>
> "calling libged's commands programmatically has a disadvantage ... input values
> must pass through string processing ... if you're writing C/C++ code ... you'll
> want to consider calling lower level routines instead."
>
> — [`include/ged.h`](https://github.com/BRL-CAD/brlcad/blob/main/include/ged.h)

That is a useful warning for EduCAD: a string command layer is an excellent
*stable external interface* (`.edu`, command line, agents), but it should not be
the internal API between application services and the kernel.

**Lesson for EduCAD:** keep the kernel (`reconstruct`/`surfaces`/`project`) free
of command parsing and view concerns; keep the command layer as a thin,
headless facade over application services; let the GUI and `.edu` both call it.
Do not put view-manipulation commands inside the geometry kernel.

### 2.5 Manifold: a small, value-semantic, data-oriented kernel boundary

Manifold is a geometry library, not a CAD application: it has no document, no
GUI, and no command layer. That is precisely why its boundary is worth studying.
The public `Manifold` class is a value type wrapping an internal CSG node; the
public API includes boolean operations, transforms, refinement/smoothing,
`GetMeshGL`, `Status`, volume/area/bounding box, and `Decompose`
([`include/manifold/manifold.h`](https://github.com/elalish/manifold/blob/v3.5.4/include/manifold/manifold.h)).
`MeshGL` is a plain data interchange type: interleaved `vertProperties`, a
`triVerts` index buffer, and optional run IDs (`runIndex`, `runOriginalID`) for
material/property mapping; it is designed to cross ABI/language boundaries
without exposing internal pointers
([`include/manifold/mesh.h`](https://github.com/elalish/manifold/blob/v3.5.4/include/manifold/mesh.h)).
Errors are returned as a `Manifold::Error` status, not thrown across the API.
The README states that the library has **no required dependencies** (parallelism,
Python, WASM, and tests are optional), and the same API is exposed through C,
C++, Python, and TypeScript/WASM bindings
([README](https://github.com/elalish/manifold)).

**Dependency direction:** callers depend on the library; the library depends on
nothing application-specific. There is no callback into a UI, no global document,
and no serialization policy beyond `MeshGL`.

**Lesson for EduCAD:** the reconstruction result should be a small, versioned,
plain-data value (`GeometryModel`) with an explicit error/diagnostic status and no
DOM or table references. `Surfaces` already behaves like this; the rest of the
pipeline should follow. Keep the public surface small and stable, and let
bindings/consumers (app, teacher preview, `.edu`, backend) adapt to it rather
than the kernel knowing about them.

### 2.6 Synthesis: the recurring pattern

| Concern | FreeCAD | LibreCAD | OpenSCAD | BRL-CAD | Manifold | EduCAD today |
|---|---|---|---|---|---|---|
| Headless model | `App::Document` | `RS_Document` (partial) | AST + node tree | database + `librt` | none (caller-owned) | `CadEntityTable` + snapshots |
| Evaluator/kernel | OCC via `Part::Feature` | entity geometry + actions | `GeometryEvaluator` | `librt` | `Manifold` | `reconstruct` + `surfaces` |
| Presentation | `Gui::ViewProvider` | `RS_GraphicView` + actions | `GLView`/`MainWindow` | `libdm` + MGED/Archer/QGED | none | inline index + mounts |
| Command abstraction | `Gui::Command` | `RS_ActionInterface` + handler | language modules/CLI | `ged_*` + `ged_exec` | none | parser + switch |
| Public extension point | workbench/command/ViewProvider | action/entity/filter | `.scad` language/backends | libged command/librt primitive | C++/C/Python/WASM API | 27 slash commands + UMD globals |
| Headless verification | App/Python + tests | engine/action tests | CLI render + test corpus | `mged -c` scripts | GTest/fuzz | `.edu` scripts |

The pattern is not "use a framework". It is **three dependency directions**:

1. **Document/model** knows nothing about rendering or input.
2. **Kernel/evaluator** is a pure function (or a small stateful service) from
   model to geometry/analysis; it knows nothing about commands or views.
3. **Presentation/commands** depend on the first two; they own input, view state,
   widgets, and user-facing enablement.

Every mature project above leaks somewhere — LibreCAD's document holds a view;
BRL-CAD's libged assumes libdm for view commands; FreeCAD's Gui is enormous;
OpenSCAD has global caches. The point is not purity, it is that the *primary*
dependency arrows point inward and the leaks are visible and localized.

---

## 3. Comparison matrix

### 3.1 Ratings

`H` = strong/clear, `M` = present but leaky, `L` = weak/absent. These are
architecture judgments, not product-quality scores.

| System | Cohesion | Coupling | Testability | Replaceability | UI independence | Zero-dependency tradeoff |
|---|---|---|---|---|---|---|
| **FreeCAD 1.1.4** | M — workbench App/Gui pairs are cohesive; `Gui` and `App` themselves are large | M — App↔Gui signals, property system, OCC types in Part; boundaries are explicit | M–H — App and Python are headless; GUI and workbench tests are heavier | M — workbenches/commands/view providers replaceable; OCC kernel is deeply embedded | H — App runs headless; ViewProvider is the adapter | L — Qt, Coin3D, OCC, Python, Boost. Dependencies buy the kernel and UI. |
| **LibreCAD 2.2.1.6** | M — engine/actions/ui separated by directory and class role | M — actions hold view + document; document holds a view pointer | M — engine/action tests exist; Qt types and event loop complicate pure tests | M — entities, actions, DXF filters replaceable; UI/action coupling limits swaps | M — engine is mostly widget-free, but `QObject`/`QString` and document→view leak | L — Qt. A focused 2-D editor can afford it. |
| **OpenSCAD 2021.01 / 2026.11-RC** | H — AST, node tree, CSG tree, geometry evaluator, GUI are distinct | M — clear direction, but global caches/singletons and a large `MainWindow` | H — CLI render/export and `.scad` corpus; `OffscreenView` for tests | H — CGAL→Manifold backend swap proves the seam; source language is the extension point | H — core/evaluator run without GUI | L — Qt, CGAL/Manifold, Boost. Heavy, but optional backends reduce lock-in. |
| **BRL-CAD 7.46.0** | M–H — libraries grouped by function (`librt`, `libged`, `libdm`, `libwdb`, …) | M — `libged` tightly coupled to `librt`, assumes `libdm` for view commands | H — `mged -c` scriptable command stream; long-lived regression suite | M — `librt` core stable; GUIs (MGED/Archer/QGED) are replaceable; command layer stringly typed | H — command layer runs headless except view commands | L — C libs, Tcl/Tk, Qt, many optional components. |
| **Manifold 3.5.4** | H — one job: manifold mesh booleans/refinement | L — no UI/document/global application state | H — GTest/fuzz/sanitizers; deterministic value API | H — C++/C/Python/WASM bindings over one value type | H — no UI at all | H — no required dependencies; TBB/Python/WASM/GTest optional. |
| **EduCAD `43d3b7f`** | M — pure core is cohesive; `reconstruct` and `index.html` are large; UI verticals mix kernel + mount | M–H — core is clean; UI uses globals, `handle`, thunks, and duplicate composition roots | H for kernel (151 scripts); L for app/UI (no headless app flow, no CI) | M — reconstruction/projection/surfaces are replaceable behind functions; geometry schema is implicit; grading is separate | M — 29/35 modules DOM-free and Node-loadable; 6 modules own DOM; app is inline and browser-only | H — zero npm deps, static deploy; costs: no module enforcement, hand-rolled UI, duplicate parsers, 319 KB gzip payload. |

### 3.2 Zero-dependency tradeoffs

EduCAD's zero-dependency rule is a genuine architectural asset, not a quirk. It
makes the app deployable as static files plus one C++ binary, keeps the supply
chain empty, and lets `tools/edc.js` run the same modules under Node with no
install step. Manifold shows that a focused kernel can be dependency-free without
compromising its API.

The costs are equally real:

| Benefit | Cost in EduCAD today | Mitigation that preserves zero deps |
|---|---|---|
| No `npm install`; instant checkout-to-run | No module graph tool, no bundler, no type checker | Node built-ins can implement a static manifest/cycle/DOM check and a small concatenating bundler. |
| Small, auditable dependency surface | 35 script tags with manual order and `?v=` cache busting; thunks hide real edges | Generate per-page manifests/bundles from one source of truth. |
| Plain JS, easy to inspect | Geometry results are duck-typed; validators are ad hoc | Version the plain-data schema and validate at boundaries; no TypeScript required. |
| Hand-rolled UI avoids framework churn | 5,824 inline JS lines; mobile/layout code is 1,701 lines; no component boundary | Extract pure cores and thin mounts; a framework is not required to get boundaries. |
| No test framework | `.edu` is excellent for geometry, but app/UI workflows are untested; no CI | Add `.edu` coverage for command/undo behavior and a shell/Node check; do not add a parallel unit suite. |
| Duplicated helpers keep modules dependency-free | Caption/tolerance parsing is copied in canvas, labels, verify; copies can drift | Centralize only helpers that already drift, in a tiny shared pure module; keep the rest local. |

The correct conclusion is **not** "add dependencies". It is "use Node's standard
library to enforce the boundaries that a framework would otherwise enforce".
Manifold's no-required-deps stance works because its boundary is small; EduCAD's
app boundary is currently large and implicit, which is the actual problem.

### 3.3 What the matrix says for EduCAD

- EduCAD's **kernel testability already matches or beats** several mature
  systems, because `.edu` is a headless, end-to-end, deterministic harness.
- EduCAD's **UI independence is better than it looks** (29/35 modules DOM-free),
  but the app root destroys the advantage: the 4,355-line inline block is the
  only place where workflows are assembled, and it is not testable.
- EduCAD's **replaceability is uneven**: `reconstruct`, `surfaces`, and `project`
  are replaceable behind small functions; the document, commands, grading, and
  UI are not.
- The biggest gap versus FreeCAD/OpenSCAD/BRL-CAD is not a missing kernel. It is
  the **missing application boundary** between the kernel and the page.

---

## 4. Concrete improvements, ranked by leverage and risk

Ranking is by leverage-to-risk ratio, with prerequisites noted. Each item lists
the boundary change, the interface owner, the migration shape, and the
verification gate.

| Rank | Change | Leverage | Risk | Effort | Prerequisite |
|---:|---|---|---|---|---|
| 1 | Module-boundary guardrails + schema note | High | Low | 1–2 days | none |
| 2 | Document/transaction facade | Very high | Medium | 1–2 weeks | 1 |
| 3 | Split UI verticals into core + mount | High | Medium | 1–2 weeks | 1 |
| 4 | Command/action facade over the document | High | Medium–high | 2–3 weeks | 2 |
| 5 | One grading contract; legacy fallback | High (integrity) | Medium–high | 1–2 weeks | 2 |
| 6 | Versioned `GeometryModel` + reconstruction stages | High (long-term) | High | 3–5 weeks | 1, 3 |
| 7 | Generated per-page manifest/bundle | Medium | Low–medium | 3–5 days | 1 |
| 8 | Backend modularization | Low–medium | Low | 1 week | none |

### 4.1 Rank 1 — Add module-boundary guardrails (low risk, immediate)

**Problem:** the dependency graph exists only in prose and script-tag order. The
boot manifest names 11 core modules while `index.html` loads 35; teacher loads a
different subset; `?v=` is manual; no check prevents a pure module from reaching
for `window` or a UI global.

**Change:** add `tools/check-modules.js` (Node built-ins only) and one
`tools/module-manifest.json` that declares:

```json
{
  "core": ["educad-vec3.js", "educad-parametric.js", "..."],
  "ui": ["educad-solid.js", "educad-mobile.js", "..."],
  "pages": {
    "index": ["educad-viewport.js", "..."],
    "teacher": ["educad-saves.js", "..."]
  }
}
```

Checks:

1. Every `require('./x.js')` in a UMD header resolves to a real file.
2. The declared core graph has no cycles.
3. Core modules contain no `document`, `window`, `getElementById`,
   `createElement`, `addEventListener`, `EduCADMobile`, `EduCADSolid`,
   `EduCADSpatial`, `EduCADOrthographic`, or `EduCADDrafting` references.
4. Each page's script list equals its manifest entry, and every dependency
   appears before its dependent (or is explicitly deferred via a thunk with a
   comment).
5. `educad-boot.MODULE_FILES` is generated from the manifest's core list, not
   hand-maintained.
6. No duplicate module version strings in script tags; a content hash or one
   `?v=` per release is generated.

**Why first:** it is cheap, it makes every later refactor safer, and it turns
"please keep the core pure" into a machine-checked rule. It also catches the
existing load-order traps without changing runtime behavior.

**Risk:** a naive regex can miss aliases/indirect DOM access. Start with a
conservative allowlist and treat new violations as failures; do not attempt a
full JS parser.

**What not to do:** do not introduce ESLint/TypeScript/Webpack for this. A
100–200-line Node script is enough and preserves zero dependencies.

### 4.2 Rank 2 — Extract a document/transaction facade

**Problem:** the de facto document is assembled from three places:
`CadEntityTable` (entities.js:253), `createHistory` (drafting.js:187), and
`EduCADSaves.snapshotTable/restoreTable` (saves.js). The inline app owns the
lifecycle, mutation guards are on the table, and transaction grouping is implicit
in a microtask flush. `handle.table` is passed around as a service locator.

**Change:** add `public/lib/educad-document.js` (pure UMD, no DOM):

```js
createDocument({ table, storage? }) -> doc
doc.table                 // compatibility alias during migration
doc.revision()
doc.transact(label, fn)   // one history entry; returns { ok, changedIds, error? }
doc.undo() / doc.redo()
doc.serialize()           // { version: 1, entities: [...] }
doc.load(snapshot)        // validates and restores; returns diagnostics
doc.subscribe(fn)
```

Ownership moves:

- `createHistory` moves from `educad-drafting.js` into the document module.
- `snapshotTable`/`restoreTable` remain the wire-format implementation in
  `educad-saves.js`; `doc.serialize/load` call them, so the saved JSON does not
  change.
- The table remains the entity store; the document owns its lifecycle,
  transactions, and persistence.
- Selection, camera, mode, pose, and hover stay out of the document; they are view
  state and belong to the presentation layer.

**Migration shape:** keep `handle.table = doc.table` and make `doc` available as
`handle.doc`. Move call sites one at a time. `EduCADDrafting.mount` can accept
either a table or a document; wrap mutations in `doc.transact` where a single
user gesture currently causes several table updates.

**Why high leverage:** it gives the app one place to test document workflows
headlessly, makes undo/redo deterministic, and is the prerequisite for command
objects and for a clean save/load contract.

**Risk:** history semantics change if a transaction contains asynchronous work.
Keep `transact` synchronous; for async workflows, use explicit
`begin/commit/abort` and document that no table mutation may occur between
`begin` and `commit` outside the transaction.

**Verification gate:** all 151 scripts clean; add `.edu` scripts that exercise
`/undo`, `/clear`, `/delete`, and a multi-step edit, asserting topology and entity
counts via `# expect`. Manually test save → reload → undo in the browser.

### 4.3 Rank 3 — Split the UI verticals into pure core + mount

**Problem:** four modules mix reusable logic with DOM wiring. The split points
are already marked by the `mount` function; no algorithm change is needed.

| Module | Pure core | Mount/UI | DOM-bound? |
|---|---|---|---|
| `educad-solid.js` | lines 1–569: constants, geometry normalization, state, projection, visibility, edge classification, canvas render | lines 570–1,361: `mountSolidWidget`, glass widget, taps | yes |
| `educad-spatial.js` | lines 1–342: bounds, references, projection, summary, measurement rows, inspection items | lines 343–671: panel, overlay layout/drawing, pin interactions | yes |
| `educad-orthographic.js` | lines 1–149: role/title/specs/inventory/comparison/view bounds | lines 150–431: panel, overlay, selection sync | yes |
| `educad-drafting.js` | lines 1–426: edit rules, identity linking, history, move/rename/profile | lines 427–1,059: editor menus, pointer/drag, dimension drawing | yes |

**Change:** create `*-core.js` and `*-view.js` pairs, and keep the existing file
as a facade that re-exports both. Example:

```text
educad-solid.js          -> re-export { ...SolidCore, ...SolidView }
educad-solid-core.js     -> pure state/geometry/render functions
educad-solid-view.js     -> mountSolidWidget, mountSolidGlass
```

Do the same for spatial, orthographic, and drafting. `educad-mobile.js` and
`edugraphics-common.js` remain DOM utilities; the goal is not zero DOM modules,
it is zero DOM in the core.

**Interface ownership:** the core consumes and returns the plain
`GeometryModel`/view-model; the view consumes DOM/canvas and a small host object
(`{ table, view, measure, ... }`). The view must not expose kernel functions, and
the core must not know about containers, canvases, or event listeners.

**Why high leverage:** it increases the Node-testable surface without touching
geometry, reduces the DOM-bound module count from 6 to 2–3, and makes the
`mount` functions replaceable (e.g., a headless renderer or a test double).

**Risk:** mechanical extraction can introduce circular imports if the core and
view share constants. Put shared constants in the core and have the view import
them; never have the core import the view.

**Verification gate:** all 151 scripts unchanged; `require()` each new core and
call representative pure functions; browser smoke for sheet, pose, spatial
inspection, orthographic panel, and drafting menus.

### 4.4 Rank 4 — Introduce a command/action facade

**Problem:** `educad-command` has 27 command specs but a monolithic `execute`
switch. Mouse actions are separate functions in `index.html`. There is no
per-command `isActive`, no uniform transaction, and no way for `.edu` to exercise
the exact code path a toolbar button uses.

**Change:** give each command a handler object, while preserving the existing
`COMMANDS` metadata and `execute` API:

```js
{
  name: 'line',
  spec: { usage, hint, args },       // existing metadata
  isActive(env) -> boolean,          // mode/session/selection predicates
  run(env, args) -> { ok, message, ids, diagnostics? },
  transaction: true                  // wrap in doc.transact
}
```

`execute(input, env)` remains the public parser/dispatcher for `.edu`, the
command line, and `educad-auto`. It looks up the handler, checks `isActive`,
runs it inside `env.doc.transact` when available, and normalizes the result.
`env` keeps the existing hooks (`clear`, `undo`, `loadDemo`, `startTutorial`,
`runVerify`, `setMode`) so `tools/edc.js` does not change.

**Why high leverage:** one action definition serves the mouse, the command line,
and the script harness; undo grouping becomes explicit; command enablement is
testable; adding a command no longer means editing a 600-line switch.

**Risk:** 27 commands with subtle argument parsing and error messages. Do this
incrementally: first wrap read-only/simple commands (`help`, `point`, `line`,
`circle`, `datum`), keep the switch as a fallback, and migrate one command family
per change. Do not change `.edu` syntax or messages.

**Verification gate:** every existing `.edu`/`.edc` script still passes; add
scripts for command rejection (`# reject:`) and undo grouping; compare messages
for the migrated commands.

### 4.5 Rank 5 — Unify grading with one versioned contract

**Problem:** the teacher model answer is reconstructed by the JS pipeline, but
`backend/src/main.cpp:1286` grades with a separate nearest-entity matcher
(`kEpsMm = 0.5`, `kAngleEpsDeg = 2.0`). It ignores member identity and view-role
semantics. A student can pass with a drawing that reconstructs differently, or
fail with an equivalent drawing whose entities are ordered differently.

**Change:** define a `grading-v1` contract with two modes:

- **`declared`** (new sets): the model answer carries the canonical
  `EduCADStrict` result (member IDs, edge member pairs, declared triangles,
  certificate) plus a tolerance policy. The student's sheet is canonicalized by
  the same shared pipeline before comparison; the server compares canonical
  identities/observations, not nearest neighbors.
- **`legacy-2d`** (existing sets): keep `compareDrawings` exactly as-is, label it
  in the API and UI, and never silently change pass/fail for old submissions.

Store the mode on the question (`check_mode: "declared" | "legacy-2d"`). The
teacher UI defaults new questions to `declared` when the model answer has member
declarations; otherwise it falls back to `legacy-2d` with a visible note.

**Interface ownership:** the canonicalization rules live in the shared JS
pipeline (`EduCADStrict`/`EduCADReconstruct`), not in the backend. The backend owns
the authoritative comparison and the storage of the model + mode. It must not
trust a client-supplied canonical model: store the teacher's canonical model,
receive the student's raw entity rows, and normalize/compare them server-side
using the same rules. If a C++ canonical comparator is needed, port only the
small identity/observation comparison, not the full reconstruction.

**Why high leverage:** it removes a second geometry semantics and aligns grading
with the contract the rest of the app claims to follow. It is also a data
migration problem, which is why it is not rank 1.

**Risk:** existing submissions and teacher expectations. Mitigate with the dual
mode, a fixture corpus of old model/student pairs, and a one-way migration that
never rewrites historical results.

**Verification gate:** replay a corpus of model/student snapshots under both
modes; assert legacy results are byte-for-byte identical; assert declared-mode
results are invariant under entity order, equivalent line splits, and harmless
style changes.

### 4.6 Rank 6 — Version the geometry model and split reconstruction stages

**Problem:** `educad-reconstruct` is 3,851 lines and returns one large object with
29 exports and dozens of optional fields. Consumers duck-type. The legacy
recognizers (`tryCylinder`, `tryCone`, `tryRevolved`, etc.) live in the same
module as the strict and live paths. Saved `model3d` previews are validated by
`EduCADRef3d.validPreview` rather than by a shared schema.

**Change:** add `public/lib/educad-geometry-model.js`:

```js
MODEL_VERSION = 'geometry-v1'
normalize(input) -> { ok, model, diagnostics }
validate(model) -> { ok, errors }
```

Required fields: `vertices`, `edges`, `faces` (or `faceRegions` with `outer`/
`holes`), optional `curves`, `surfaces`, `profileMap`, `solids`,
`surfaceComponents`. Unknown fields pass through for compatibility. Every
pipeline result and stored preview carries `schema: 'geometry-v1'`.
`EduCADSolid.setGeometry`, `EduCADRef3d.buildPreview`, and
`EduCADSurfaces.build` validate at their boundary. Validation is additive: the
success shapes stay the same, and malformed stored previews return the existing
`unavailable` shape with a diagnostic rather than throwing.

Then split `educad-reconstruct` into stages behind the existing facade:

```text
reconstruct/
  correspondence.js   view graph, member matching, profile frame
  primitives.js       lines, curves, cones/cylinders/revolved recognizers
  faces.js            closed-loop and planar-region inference
  surfaces.js         bridge to EduCADSurfaces
  assemble.js         final GeometryModel + diagnostics
  legacy.js           compatibility recognizers, isolated
  index.js            reconstruct / reconstructStrict / reconstructLive
```

Keep `EduCADReconstruct.reconstruct`, `reconstructStrict`, and `reconstructLive`
as the public entry points; `tools/edc.js` and the app must not change.

**Why high leverage:** it makes the kernel replaceable and the saved-preview
format safe, and it isolates the legacy recognizers so the strict path cannot
accidentally fall back to inference.

**Risk:** high. This is the core algorithm; a mechanical split can change
evaluation order, diagnostics order, or tolerance behavior. Do it only after the
document and UI splits, with a golden comparison harness: run all 151 scripts
before/after and diff the full JSON `solid` output (not just pass/fail).

**Verification gate:** byte-identical `solid` JSON for every script; identical
diagnostic code sets; identical `# expect` results; explicit `--strict` runs on a
representative subset.

### 4.7 Rank 7 — Generate per-page manifests/bundles

**Problem:** `index.html` has 35 script tags, `teacher.html` has 15, the subsets
differ, and `?v=` strings are manual. The dependency graph is enforced only by
tag order and thunks.

**Change:** add `tools/build-bundle.js` (Node built-ins) that reads the manifest
from §4.1 and emits deterministic per-page bundles:

```text
public/lib/bundle-sheet.js      # index
public/lib/bundle-teacher.js    # teacher
public/lib/bundle-student.js    # student (saves only)
```

Each bundle concatenates UMD modules in dependency order, preserves the global
names, and writes a content hash that the page uses in the script tag. Keep the
unbundled script tags available behind a query flag for debugging, or keep the
source pages generated from the manifest.

**Why moderate leverage:** fewer moving parts, no load-order surprises, better
caching, and one place to see the app's dependency set. It does not change
architecture by itself, which is why it ranks after the boundary work.

**Risk:** bundles make debugging harder and can mask cycles. Generate a source
map or a readable development bundle; keep `tools/check-modules.js` as the
authority, not the bundle order.

### 4.8 Rank 8 — Modularize the backend, defer until needed

**Problem:** `backend/src/main.cpp` is 3,128 lines and owns routing, auth, ERP,
drawings, sets, classes, grading, and the LLM proxy. It is a monolith, but it is
not on the geometry hot path.

**Change (only if classroom features keep growing):** split into
`server.cpp`, `api_auth.cpp`, `api_drawings.cpp`, `api_sets.cpp`,
`api_classes.cpp`, `verify.cpp`, `db.cpp`, with a single route table. Move
`compareDrawings` into `verify.cpp` as the legacy grader, and add the declared
grader beside it.

**Why last:** the backend already has a clean external contract (JSON over HTTP)
and no geometry kernel. Splitting it improves maintainability but not drawing
correctness; it should not compete with the document/UI work.

### 4.9 What should NOT be changed

1. **Do not add npm dependencies or a UI framework.** The zero-dependency
   property is a product feature and keeps the `.edu` runner trivial. Use Node
   built-ins for tooling.
2. **Do not replace the `.edu` harness or add a parallel unit-test suite.**
   `tools/edc.js` is the verification contract; 151 scripts are the regression
   net. Extend it with command/undo scripts; do not fork it.
3. **Do not change the strict contract's semantics.** `educad-explicit-v1` and
   `docs/RECONSTRUCTION_CONTRACT.md` define what "exact" means. Refactors may move
   code, not reinterpret declarations or make inference look exact.
4. **Do not make display tessellation authoritative.** `EduCADSurfaces` must
   continue to own analytic definitions, validation, and certificates; the
   renderer consumes tessellation.
5. **Do not break the saved drawing or preview format.** Old sheets without
   member declarations must remain loadable and honestly unresolved; teacher
   `model3d` previews must keep working.
6. **Do not split `educad-surfaces.js` just because it is 2,588 lines.** It is a
   cohesive analytic model. Split by responsibility, not by line count.
7. **Do not move the inline renderer wholesale before a painter API exists.**
   Extract the pure cores first; rewriting the sheet renderer is a separate,
   higher-risk change.
8. **Do not change auth, ERP, session, or password behavior as part of
   architecture work.** That is security-sensitive and out of scope.

---

## 5. Target architecture

### 5.1 Diagram

```text
                         COMPOSITION ROOTS
   index.html      teacher.js      student.js      tools/edc.js      backend
       │               │               │               │               │
       └───────────────┴───────┬───────┴───────────────┘               │
                               │                                       │
                    APPLICATION SERVICES                             HTTP
         session · settings · saves · sets · tutorial · pose          │
                               │                                       │
                    COMMAND / ACTION LAYER                            │
        parse/suggest/preview · isActive · transact · run             │
                               │                                       │
                    DOCUMENT (headless, versioned)                     │
        entity table · member identities · revision · history         │
        serialize/load · mutation guard                                │
                               │                                       │
                 RECONSTRUCTION FACADE (pure)                          │
     reconstruct / reconstructStrict / reconstructLive                 │
        ┌──────────────┼────────────────┬──────────────┐              │
        │              │                │              │              │
  correspondence   primitives      surfaces       projection/verify    │
        │              │                │              │              │
        └──────────────┴───────┬────────┴──────────────┘              │
                               │                                       │
                    GEOMETRY MODEL (plain data)  <────────────────────┘
                    geometry-v1 · diagnostics · certificates
                               │
                    PRESENTATION ADAPTERS
     sheet painter · solid widget · spatial panel · orthographic panel
     pose overlay · mobile shell · command palette
                               │
                    PLATFORM: DOM/Canvas · fetch · Node
```

The arrows are dependency arrows: upper layers may depend on lower layers, never
the reverse. The backend only sees opaque JSON plus the grading contract; it does
not import the kernel.

### 5.2 Module map

This is a logical map, not a demand to move every file. Physical moves can happen
one directory at a time behind facade re-exports.

| Layer | Modules | Owns | May depend on |
|---|---|---|---|
| **Model/document** | `educad-document` (new), `educad-entities`, `educad-saves` (wire format), `educad-settings` | entity schema, member identity, revision, transactions, history, serialization, preference schema | `parametric` only for entity geometry; no DOM |
| **Kernel** | `educad-vec3`, `educad-parametric`, `educad-geometry`, `educad-strict`, `educad-surfaces`, `educad-project`, `educad-curve-reconstruct`, `educad-oblique-kernel`, `educad-parametric-reconstruct`, `educad-reconstruct`, `educad-solver`, `educad-verify`, `educad-ref3d` | geometry/diagnostics/certificates/preview derivation | model data only; no DOM, no commands |
| **Presentation helpers** | `educad-canvas`, `educad-measure`, `educad-viewport`, `educad-pose`, `edugraphics-snapping`, `edugraphics-instruments`, `educad-labels`, `educad-tutorial`, `educad-command` (metadata/parse) | hit-testing, viewport/pose math, layout, label placement, command grammar | kernel/model; no DOM except explicit adapters |
| **View adapters** | `educad-solid-core/view`, `educad-spatial-core/view`, `educad-orthographic-core/view`, `educad-drafting-core/view`, `educad-mobile`, `edugraphics-common`, `educad-boot` | DOM/canvas mounting, gestures, panels, overlay painting, composition | presentation helpers + kernel; owns all DOM |
| **App roots** | `public/index.html` inline, `teacher.js`, `student.js`, `login.js`, `tools/edc.js` | workflow wiring, page-specific panels, script runner | services and adapters; no kernel internals |
| **Backend** | `backend/src/*` | auth, ERP, saves, sets, classes, grading, LLM proxy | HTTP/DB only; `grading-v1` contract |

### 5.3 Interface ownership

| Interface | Owner | Consumers | Stability rule |
|---|---|---|---|
| `EntityRow` / saved sheet (`entities-v1`) | `educad-document` + `educad-entities` | app, command, saves, teacher, `.edu` | Additive fields only; old rows load; no silent migration of unresolved sheets. |
| `Document` API (`revision`, `transact`, `undo`, `serialize`) | `educad-document` | app, command, drafting core, saves | One transaction = one undo entry. Table access is a compatibility alias, not the public API. |
| `GeometryModel` (`geometry-v1`) | reconstruction/kernel | solid/spatial/ortho, teacher preview, `.edu`, backend (opaque) | Required plain-data fields; unknown fields pass through; validated at every boundary. |
| `ReconstructResult` (`status`, `reason`, `label`, `geometry`, `issues`, `pipeline`, `certificate`) | `educad-reconstruct` | app, teacher, `.edu` | Existing shape retained; add fields, never repurpose `status`/`reason`. |
| `SurfaceModel` (`analytic-surface-v1`) | `educad-surfaces` | reconstruct, `.edu`, app | Analytic definitions and certificates are authoritative; tessellation is derived. |
| Diagnostic codes | reconstruction + surfaces | `.edu`, UI, saved reports | Codes are a public API; add new codes, deprecate old ones with aliases; document in one table. |
| `Command` (`name`, `spec`, `isActive`, `run`, `transaction`) | `educad-command` | command line, mouse actions, `.edu`, auto | Slash syntax and messages stay stable; handlers are an internal extension point. |
| `ViewState` (mode, selection, camera, pose) | presentation adapters | index/drafting/measure/pose | Never stored in the document or saved sheet. |
| `.edu` script format | `tools/edc.js` | tests/agents/CI | One command per line; `# expect`, `# reject`, `# surface-query` semantics remain. |
| Grading (`grading-v1`) | backend `verify` + JS canonicalizer | teacher/student panels | Versioned mode per question; legacy mode frozen. |

### 5.4 Dependency rules to enforce

1. **Core has no DOM.** No `document`, `window`, `getElementById`, `createElement`,
   `addEventListener`, or UI globals in model/kernel modules.
2. **Core has no upward imports.** `reconstruct` must not import `solid`,
   `spatial`, `orthographic`, `drafting`, `mobile`, or `command`.
3. **View state is not model state.** Selection, hover, camera, mode, and pose
   live in adapters; entity rows carry only sheet ink and its drawing semantics.
4. **One composition root per page.** Pages receive a document, services, and
   adapters; they do not reach into module internals or mutate `handle` bags.
5. **One geometry value at every boundary.** Saved previews, `.edu` reports, and
   display adapters receive `geometry-v1`, not ad-hoc subsets.
6. **Commands are the only mutation entry point.** Mouse gestures, slash commands,
   and auto-draw all go through the command/action layer (or a clearly named
   document transaction for continuous gestures such as drag).

### 5.5 Migration sequence

This is a strangler sequence: every step leaves a working app and a passing
script suite. Old modules remain as facades until call sites move.

**Step 0 — Baseline (1 day).**

- Run all 151 scripts; record pass/fail and the slow script.
- Record `EduCADBoot.coldBootMs` with explicit deps; record full payload size.
- Add the module manifest and `tools/check-modules.js`; make the check pass on the
  current tree with a small allowlist for known dynamic references.
- Write the `geometry-v1` schema note (required/optional fields, diagnostics
  codes, ownership).

**Gate:** check script passes; all scripts clean.

**Step 1 — Document facade (1–2 weeks).**

- Add `educad-document.js`; move `createHistory`; wrap `snapshotTable/restoreTable`.
- Set `handle.doc` and `handle.table = doc.table`; migrate the inline app one
  workflow at a time (clear, add point, delete, move, rename, undo/redo).
- Add `.edu` scripts for `/undo`, `/clear`, `/delete`, and a multi-step edit.

**Gate:** 151 scripts clean; browser save/load/undo smoke; no saved-format change.

**Step 2 — UI vertical splits (1–2 weeks).**

- Split spatial first (smallest, mostly pure), then orthographic, then solid, then
  drafting.
- Keep old files as re-export facades; update imports one at a time.
- Add a smoke checklist for each panel/mode.

**Gate:** DOM-bound module count reduced; all scripts clean; browser smoke for
sheet, pose, spatial, orthographic, drafting.

**Step 3 — Command/action facade (2–3 weeks).**

- Add handler objects for simple commands first; keep the switch fallback.
- Route mouse actions through the same handlers where practical; keep continuous
  gestures as explicit document transactions.
- Add rejection/undo scripts.

**Gate:** all scripts clean; command messages unchanged; undo grouping verified.

**Step 4 — Grading contract (1–2 weeks).**

- Add `check_mode` to questions; default new sets to `declared`; keep `legacy-2d`.
- Replay a fixture corpus; assert legacy results unchanged.
- Update teacher UI copy so the mode is visible.

**Gate:** legacy corpus identical; declared corpus invariant under entity order.

**Step 5 — Geometry schema and reconstruction stages (3–5 weeks).**

- Add `educad-geometry-model.js` and validate at `setGeometry`, `buildPreview`,
  `Surfaces.build`.
- Extract reconstruction stages behind the existing facade; isolate `legacy`.
- Golden-diff the full `solid` JSON for all scripts.

**Gate:** byte-identical geometry/diagnostics for all scripts; strict runs intact.

**Step 6 — Generated bundles (3–5 days).**

- Generate per-page bundles from the manifest; keep a debug/unbundled path.
- Replace manual script tags and `?v=` strings.
- Re-measure payload and cold boot.

**Gate:** pages load from bundle; check script passes; payload not worse.

**Step 7 — Backend split (optional, 1 week).**

- Only if classroom features continue to grow. Split routing/DB/verify; move the
  legacy grader into its own file; add the declared grader beside it.

**Gate:** API contract unchanged; auth/ERP smoke; grading corpus unchanged.

---

## 6. Risks and verification

### 6.1 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Moving globals/script order breaks a command at runtime | High during migration | High | Keep facade re-exports; load new modules in the same order; run `check-modules` and all scripts after every step. |
| Browser/Node UMD behavior diverges | Medium | High | Test both `require()` and browser globals for every changed module; keep Node-only thunks explicit and commented. |
| Removing `handle.table`/`handle` breaks inline closures or teacher/student panels | High if big-bang | High | Keep `handle.table = doc.table` and `handle.doc`; migrate call sites gradually; no rename-only sweep. |
| Transaction/history semantics change undo grouping | Medium | Medium | Make `transact` synchronous; add `/undo` scripts; compare undo/redo counts before/after. |
| Strict path accidentally falls back to inference | Low if guarded | Very high | Golden-diff full `solid` JSON; run representative `--strict` scripts; keep `legacy` recognizers isolated and opt-in. |
| Geometry schema rejects old saved previews | Medium | High | Permissive validator: required fields only; unknown fields pass through; version the schema; test old `model3d` payloads. |
| Grading migration changes historical pass/fail | High if rushed | High | Dual mode (`declared`/`legacy-2d`); freeze legacy; replay fixture corpus; never rewrite historical submissions. |
| Bundle hides a cycle or makes debugging harder | Medium | Medium | Bundle is generated from the manifest; `check-modules` remains the authority; keep an unbundled debug path. |
| Payload/boot regression | Medium | Medium | Re-measure gzip size and `coldBootMs` at each step; keep the core budget; do not bundle optional pages into the sheet. |
| Zero-dep tooling becomes its own maintenance burden | Low | Medium | Keep `check-modules`/`build-bundle` under ~200 lines each; no custom parser; use regex + explicit allowlists. |
| UI smoke coverage is manual and inconsistent | High | Medium | Write a short browser checklist per step; record results in the PR; add a CI job that at least runs all scripts and the static check. |
| Backend/auth changes introduce security regressions | Low if untouched | Very high | Keep auth/ERP/session out of scope; if touched, require a separate review and a security checklist. |

### 6.2 Verification strategy

**Baseline (already run in this round):**

```sh
for f in tools/scripts/*.edu tools/scripts/*.edc; do
  node tools/edc.js "$f" >/dev/null || echo "FAIL $f"
done
```

Result: 151/151 clean when the slow `surface-intersect-cylinders.edu` is given
more than 10 seconds (its direct run takes ~10.2 s and exits 0). Do not use a
10-second per-script timeout in CI without excluding or marking that script.

**Targeted checks:**

```sh
node tools/edc.js --solid tools/scripts/quad3d.edc
node tools/edc.js --strict tools/scripts/quad3d.edc
node tools/edc.js tools/scripts/surface-intersect-cylinders.edu
```

`--strict` is supported by the runner but no script currently invokes it; add at
least one declared-member script and run a representative subset in both modes.

**New scripts to add (do not add a separate test framework):**

- `/undo` after a multi-step edit, asserting entity counts and topology with
  `# expect`.
- `/clear` followed by redraw, asserting no stale entities.
- A rejected command with `# reject:` to prove atomicity.
- A document round-trip: draw, save/load via the same snapshot functions, assert
  identical topology.
- A command-facade case that runs the same handler as a mouse action where
  feasible.

**Static checks (proposed `tools/check-modules.js`):**

- UMD dependencies resolve; core graph has no cycles.
- Core files have no DOM/UI references.
- Page script lists match the manifest; dependencies precede dependents or are
  explicitly deferred.
- `educad-boot.MODULE_FILES` is derived from the manifest, not hand-written.

**Golden comparison for the reconstruction split:**

- Before the split, dump `res.solid` JSON for every script to a temp directory.
- After each stage extraction, dump again and diff. Require byte-identical
  geometry, diagnostics, and certificate output for unchanged inputs.
- Run the same comparison for `--strict` on a representative subset.

**Browser smoke checklist (manual until a UI harness exists):**

1. Guest login → sheet loads; draw line/circle/point; undo/redo.
2. View mode: inspect, measure, dimension rendering.
3. Pose mode: enter, move/rotate/scale, confirm/cancel, exit.
4. Spatial panel and orthographic panel open, pin, and sync.
5. Save → list → load → delete; old drawing loads.
6. Teacher: create set, attach model, toggle strict check, preview 3D.
7. Student: join set, submit, see pass/fail; no model leak.
8. Mobile/touch-only: View/Pose split, pan/pinch/orbit, no Edit authoring.

**Performance checks:**

Reuse the explicit-deps snippet from §1.5 for `EduCADBoot.coldBootMs`, and run
`cat public/lib/*.js | gzip -c | wc -c` for payload. Record core gzip and full
gzip separately; the current core is 71 KB gzip and 0.28 ms headless, the full
library is 319 KB gzip. A bundle must be measured against those numbers, not
against an unmeasured assumption.

**CI recommendation:** add a minimal workflow that runs the static check and all
151 scripts. No npm install is needed; Node 22 is enough. This is the cheapest
way to keep the architecture from drifting.

### 6.3 Acceptance criteria

A migration step is complete only when:

- `node tools/edc.js` is clean for all 151 scripts (or the slow script is given
  enough time).
- `tools/check-modules.js` passes, including no new core DOM references and no
  new cycles.
- The saved drawing format is unchanged; old drawings load; unresolved old sheets
  stay unresolved rather than being guessed.
- The public entry points (`EduCADReconstruct.reconstruct`,
  `reconstructStrict`, `reconstructLive`, `EduCADCommand.execute`,
  `EduCADSolid.setGeometry`, `EduCADSaves.*`) keep their signatures.
- The browser smoke checklist for the touched area passes.
- Payload and core boot are not worse than the baseline without an explicit,
  documented tradeoff.

### 6.4 Unverified claims and limits of this round

These are the claims in this report that were **not** independently verified by
building or running the upstream projects, or that rely on static inspection:

1. **Upstream architecture descriptions** for FreeCAD, LibreCAD, OpenSCAD,
   BRL-CAD, and Manifold come from their source headers, documentation, and
   READMEs, not from building or running those projects in this environment.
2. **FreeCAD's App/Gui dependency direction** is documented and visible in
   headers (`getViewProviderName`), but I did not trace every App source for Qt
   includes or build the project.
3. **LibreCAD's action/document behavior** is inferred from headers and docs; I
   did not run the app or its test suite. The document→view pointer is verified
   in `rs_document.h`.
4. **OpenSCAD's F5/F6 split** is from the official source notes and source files;
   the 2026.11-RC0 Manifold backend is from the RC announcement and current
   `src/geometry/manifold/ManifoldGeometry.cc`, not from a local build.
5. **BRL-CAD's `mged -c` behavior** is from the manual; I did not compile or run
   BRL-CAD. The `libged` coupling quote is from `include/ged.h`.
6. **Manifold's no-required-deps claim** is from its README; I did not build it.
7. **EduCAD's "29/35 modules DOM-free"** is a grep-based count for direct
   references (`document.`, `getElementById`, `createElement`,
   `addEventListener`). It can miss indirect DOM use through callbacks or
   aliases; treat it as a lower bound on purity, not a proof.
8. **"All 35 modules load under Node"** was measured with `require()` in this
   worktree. It does not prove every exported function is DOM-free at runtime.
9. **The 151/151 script result** was measured with a 10-second timeout loop plus
   a direct 30-second run of the one slow script. It is a local result, not a CI
   guarantee; there is no workflow in `.github/` that runs it.
10. **"No script invokes `--strict`"** is a grep result; a script could invoke
    strict behavior indirectly.
11. **Cold boot 0.28 ms** is a headless Node measurement with explicit module
    arguments, not a browser measurement. The browser's parse/eval cost and DOM
    mount are not included.
12. **Payload 319 KB gzip** covers `public/lib/*.js` only, not `index.html`,
    CSS, or fonts. It is a relative baseline, not a full page-weight number.
13. **Backend grading behavior** is from reading `compareDrawings`; I did not
    build the C++ server or run a grading corpus. The nearest-neighbor/0.5 mm
    description is accurate to the code, but real submission behavior may differ
    due to data shape.
14. **Teacher/student preview flow** is from reading `teacher.js` and
    `index.html`; I did not exercise it in a browser.
15. **FreeCAD version landscape** is moving: 1.1.4 is stable at the time of
    writing, while 26.3 is in RC and the project has moved to calendar versioning.
    The architectural claims are about the source tree, not a specific release
    guarantee.

---

## 7. Ranked recommendation

**1. Add the module-boundary guardrails first (low risk, highest immediate
leverage).**
Create one manifest and a small Node check that enforces resolved UMD deps,
acyclic core, no DOM/UI globals in core, and page script lists. This costs little,
turns the architecture rules into a gate, and makes every later change safer. It
also exposes the existing load-order thunks and the core-only boot manifest
without changing runtime behavior.

**2. Extract the document/transaction facade next.**
`CadEntityTable` is already a document; give it one owner for revision,
transactions, history, and serialization. Keep `handle.table` as an alias and the
saved JSON unchanged. This is the single highest-leverage change because it makes
undo deterministic, gives command objects a home, and creates the first headless
app workflow that `.edu` can exercise.

**3. Split the four UI verticals into pure core + mount.**
Use the existing line boundaries (solid 569/570, spatial 342/343, orthographic
149/150, drafting 426/427). Keep the old files as facades. This is mechanical,
raises the Node-testable surface, and reduces DOM-bound library modules from six
to two or three without touching the geometry algorithms.

**4. Introduce command/action objects over the document.**
Keep the 27 command specs and the `execute` API; add `isActive`, `run`, and a
transaction wrapper. Route mouse actions and slash commands through the same
handlers. This is where the UI becomes testable and where the `.edu` harness
starts covering the actions users actually invoke.

**5. Unify grading behind a versioned contract, with a frozen legacy mode.**
New sets use declared member identities and the shared canonicalization; old sets
keep `legacy-2d` exactly as-is. This removes the second geometry semantics in C++
without breaking historical results. It is an integrity fix, not a cosmetic one.

**6. Version the geometry model and split reconstruction stages.**
Do this after the document and UI boundaries are stable. Add `geometry-v1`
validation at the boundaries, then extract correspondence/primitives/faces/
surfaces/assemble behind the existing facade and isolate legacy recognizers.
Golden-diff the full JSON output; never accept a diagnostics or tolerance drift
as "close enough".

**7. Generate per-page manifests/bundles last among the front-end work.**
The bundle is a packaging improvement, not an architecture fix. Once the
manifest and boundaries are stable, generate deterministic sheet/teacher/student
bundles and content hashes. Keep an unbundled debug path.

**8. Defer backend modularization.**
Split `main.cpp` only when classroom features keep growing. It has a clean HTTP
contract and no geometry kernel; it should not compete with the document, UI, and
grading work. If it is split, move the legacy grader into its own file and put
the declared grader beside it.

**If only one thing can be done:** extract the document/transaction facade.
**If only one week is available:** add the module guardrails and the
`geometry-v1` schema note; they protect every later change and cost almost
nothing.
**Do not start with:** a full `index.html` rewrite, a reconstruction rewrite, or
a bundler. Those are the highest-risk changes and they depend on boundaries that
do not exist yet.

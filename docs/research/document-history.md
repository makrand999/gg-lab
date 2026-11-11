# Document models, transactions, history and persistence

Status: research and design report. No production code was changed.

Scope: **Major**, the original EduCAD app (`public/`, shared `backend/`). Major2 was not inspected.

Baseline: commit `43d3b7f` (`Document cylindrical fillet and line boundary support`) in the `research-document-history` worktree.

Method:

- Read `public/lib/educad-entities.js`, `educad-drafting.js`, `educad-saves.js`, `educad-ref3d.js`, `educad-reconstruct.js` (public rebuild path), `tools/edc.js`, `public/index.html` (history, save, preview call sites), and the backend schema/API.
- Read OSS documentation and source at pinned versions; no OSS code was copied.
- Ran small Node 22 measurements against the current worktree to quantify rebuild and undo costs. These are indicative, not browser benchmarks and not CI thresholds.

---

## 1. Current document, entity, history and persistence design

### 1.1 The sheet is the document

EduCAD has one mutable `CadEntityTable` per sheet. There is no separate document object, no document revision, no transaction log, and no persisted derived state. The table is the source of truth:

- `public/lib/educad-entities.js:253-259` creates the table from an ID map, an order array, a monotonic change counter, listeners, and a mutation guard.
- `public/lib/educad-entities.js:412-432` exposes `revision()` and `subscribe(fn)`. Every `add`, `remove`, `update`, `move`, and `clear` increments the counter and synchronously notifies listeners.
- `public/lib/educad-entities.js:434-509` implements add, remove, clear and import.
- `public/lib/educad-entities.js:512-550` implements update; entity `id` and `type` are immutable. `public/lib/educad-entities.js:552-562` implements relative move.
- `public/lib/educad-entities.js:602-615` implements `updateMany`: build a temp table, validate the whole graph, assign all patches, then emit one `update` per changed entity.
- `public/lib/educad-entities.js:692-696` implements point-cascade delete through `collectCascadeDeleteIds`.

The table is both the ownership root and the change bus. The saved drawing is simply the table's entity array; the derived 3D model is recomputed from that array.

### 1.2 Entity and member identity

Entity identity is deliberately stronger than display names:

- Entity IDs come from a module-global counter (`E1`, `E2`, ...) in `public/lib/educad-entities.js:44-70`. `createEntity` accepts an explicit ID when importing; `create()` retries until it finds an unused generated ID (`:451-459`).
- Point stations carry `meta.members: [{id, name, hidden}]`. Names are semantic labels; IDs own correspondence (`public/lib/educad-entities.js:272-297`).
- `resolveReference` accepts an exact entity ID first, then an unambiguous name/caption, and refuses ambiguity (`:263-268`).
- Legacy captions are converted to member IDs once at a compatibility boundary by `identitySnapshot` (`:298-328`). `importEntities` uses this path (`:463-476`).
- `validateIdentityGraph` requires a member ID to have one shared base name across stations (`:329-344`).
- `semanticEntities` is a pure adapter for legacy mathematical readers (`:347-367`).
- `normalizeMeta` resolves stored name references to IDs and derives older endpoint/center references (`:368-391`).

Explicit member IDs survive save/load because they are ordinary JSON in `meta`. The documentation states this contract in `docs/IDENTITY_RULES.md:55-107`: IDs are stable, captions are display labels, and legacy records are adapted rather than destructively rewritten.

There are two identity weak points:

1. The ID counter is not reserved from loaded data. A fresh page can load `E1..E1000` with the counter at zero; `create()` then probes `E1`, `E2`, ... until it finds a free ID. It is safe, but it is O(N) worst case and makes ID allocation depend on table contents.
2. Legacy IDs produced by `identitySnapshot` are derived from names (`legacy:<name>`) or from entity ID plus index when a name is ambiguous. They are deterministic and persisted after import, but they are not durable identities created by the authoring operation.

### 1.3 Derived model and live rebuild

The app has one shared reconstruction pipeline. `public/index.html:4191-4219` subscribes to every table event, coalesces work with `requestAnimationFrame`, then calls `EduCADReconstruct.reconstruct(list)` on the entire sheet. On success it stores `handle.solidMm` and calls `EduCADSolid.setGeometry`; on failure it clears the model and shows the reason.

`reconstruct` (`public/lib/educad-reconstruct.js:2789-3038`) does the following on every call:

- copies and normalizes every entity;
- resolves explicit or inferred member correspondence;
- routes straight wire, curves, oblique curves, declared topology, and surface inference through the shared pipeline;
- builds planar faces, surface components, analytic surfaces, validation, and certificates;
- returns display vertices, edges, faces, curves, patches and diagnostics.

There is no memoization or dependency index. `public/lib/educad-reconstruct.js` has compatibility entry points (`reconstructParametric`, `reconstructStrict`, `reconstructLive`) but no cache keyed by entity revision. The layout map is cached by table revision (`public/lib/educad-drafting.js:482-488`), but profile validation and 3D rebuild are not.

Consequences:

- The rebuild is deterministic and has one code path. That is excellent for correctness and `.edc` verification.
- Every edit, including each frame of a point drag, can trigger a full rebuild. RAF coalescing bounds it to one rebuild per frame, not one per mutation, but a 30 ms rebuild still exceeds a 16.7 ms frame budget.
- `handle.reconstruction` and `handle.solidMm` can become stale while pose mode is active because `rebuildSolid` returns early in pose mode (`public/index.html:4192-4196`). Pose mode is supposed to freeze the table, so this is usually benign, but programmatic edits during pose are not reflected until pose exits.

### 1.4 Undo history

`createHistory` in `public/lib/educad-drafting.js:187-230` is a whole-document snapshot stack:

- `base` is a deep JSON clone of `table.list()`.
- Every table event schedules a microtask `flush()`.
- `begin()`/`end()` nest a transaction counter; drag previews stay in one entry.
- On flush, a new deep clone is compared with `base` using `JSON.stringify`. Only a changed state is pushed.
- `past` is capped at 50 entries. `future` is cleared on a new edit.
- `undo`/`redo` clone the current list, restore a snapshot through the supplied `restore` callback, and push the previous state onto the opposite stack.
- `cancel` restores `base` and resets the transaction depth.

The app wires the restore callback to `EduCADSaves.restoreTable` (`public/index.html:726-731`). That callback clears the live table and re-adds every entity, so each undo/redo is a full table replacement.

Measured cost (Node 22, this worktree, points only):

| Entities | History commit | Undo |
|---:|---:|---:|
| 100 | 2.1 ms | 10.4 ms |
| 200 | 2.1 ms | 19.1 ms |
| 500 | 5.8 ms | 85.5 ms |
| 1000 | 22.4 ms | 304.2 ms |

The growth is expected: every snapshot is a full JSON clone, equality is a full stringify, and undo rebuilds every entity object and emits `clear` plus one `add` per entity. A 50-entry history at 1000 entities also retains 50 full copies of the sheet.

### 1.5 Save and load format

`public/lib/educad-saves.js:12` defines `SAVE_VERSION = 1`. `snapshotTable` (`:56-62`) writes:

```json
{ "version": 1, "savedAt": 1700000000000, "entities": [ ... ] }
```

`restoreTable` (`:67-97`):

1. requires `data.entities` to be an array;
2. builds every entity with `E.createEntity`, checking type and duplicate IDs;
3. normalizes metadata against the complete snapshot;
4. validates the identity graph;
5. calls `table.clear()`, then `table.add(e)` for each built entity.

The validation-before-mutation behavior is good. The publication behavior is not atomic in the observable sense: `clear()` emits, then each `add()` emits and revalidates the growing table. A subscriber sees intermediate states. If a subscriber throws, or an `add()` fails after the clear, the previous sheet is already gone.

`SAVE_VERSION` is written but never read. `restoreTable` ignores `data.version` and `savedAt`. The version field is therefore documentation, not a compatibility gate.

The app snapshots the entire table, including display-dead helper entities, when saving (`public/index.html:5099-5117`). Loading builds a staging table first (`public/index.html:3823-3842`), which protects against malformed payloads, but the live replacement still uses `restoreTable`.

### 1.6 Backend persistence layout

The backend is a small C++ HTTP server over SQLite. `backend/schema.sql:26-34` stores drawings as:

- `id`, `user_id`, `title`;
- `data_json TEXT NOT NULL DEFAULT '{}'`;
- `created_at`, `updated_at`.

The API is a thin JSON pass-through:

- `POST /api/drawings` requires a `data` member and stores `body["data"].dump()` (`backend/src/main.cpp:2121-2145`).
- `GET /api/drawings/:id` returns the parsed opaque value (`:2147-2161`).
- `PUT /api/drawings/:id` updates title and/or data (`:2163-2198`).
- There is no schema validation, no document revision, no compare-and-swap, and no history. The request body is capped at 1 MiB (`backend/src/main.cpp:61`).

Reference previews live inside `sets.questions_json` (`backend/schema.sql:56-64`). The model upsert stores a teacher's 2D snapshot in `questions[qi].model`, optionally a derived `model3d`, and a `show_3d` flag (`backend/src/main.cpp:2747-2789`). If no fresh preview is supplied, the stored preview is erased (`:2761-2774`), which is the right invalidation instinct.

Two server-side data-loss risks remain:

- `PUT /api/drawings/:id` is last-write-wins. Two tabs, or a stale tab and a fresh tab, can silently overwrite each other.
- Set question edits are read-modify-write of a JSON array (`parseStored`, mutate, one `UPDATE`). The process mutex serializes calls, but there is no revision check, so concurrent teacher edits can lose one another.

There is also no database schema migration mechanism. `CREATE TABLE IF NOT EXISTS` creates missing tables but does not add columns to an existing database, and there is no `user_version` or migration table.

### 1.7 Reference 3D previews

`public/lib/educad-ref3d.js:18` exports `VERSION = '1.0.0-educad'`, but the preview payload does not include that version. `buildPreview` (`:59-109`) calls the same `reconstruct` pipeline, copies a selected set of geometry fields, and returns either:

- `{status:'ok', pipeline, geometry:{name, vertices, edges, faces, curves, surfacePatches, surfaces, surfaceModel, recesses, fillets, analyticSurfaceValidation, analyticCertificate, ...}}`; or
- `{status:'unavailable', reason, label}`.

`validPreview` (`:112-193`) checks types and indices: vertices are finite, edges and faces are in range, holes match face count, loops and curve fields have plausible shapes, and certificates have a known status. It does not check a format version, a pipeline version, a source identity, a face/edge count limit, or consistency with the stored 2D model.

The teacher's browser builds the preview from the same snapshot it sends as the model (`public/index.html:6236-6243`), so the two are normally derived from the same ink. Nothing records that relationship in the payload. A stale or mismatched preview can therefore be served without the student-side validator noticing.

### 1.8 Compatibility adapters

The compatibility design is one of the stronger parts of the current system:

- `identitySnapshot` promotes legacy captions to member IDs once, at import.
- `normalizeMeta` resolves older name-based references to IDs.
- `semanticEntities` supplies a pure adapter to legacy readers without changing stored entities.
- `restoreTable` normalizes name references against the complete snapshot, so forward references work.
- The save format is JSON, so arbitrary `meta` survives even when the schema has no explicit field for it.
- `docs/IDENTITY_RULES.md:103-107` explicitly says save format version 1 preserves arbitrary metadata and does not need a destructive conversion.

The gap is that "arbitrary metadata survives" is not the same as "the format has a compatibility contract." There is no registry of versions, no migration function, no rule for unknown top-level fields, and no distinction between "unknown but safe to ignore" and "unknown and required."

### 1.9 `.edu` verification

`tools/edc.js` is a deterministic headless runner:

- `runScript` resets the ID counter, creates a table, executes slash commands, tracks errors, and optionally expects atomic rejection (`tools/edc.js:57-97`).
- It checks projector alignment, reconstructs once with the public pipeline (`:90`), computes topology properties, and evaluates `# expect:` tokens (`:255-268`).
- `# reject:` JSON checks that a command fails, contains the expected text, and leaves the table byte-for-byte unchanged (`:67-75`).
- `# surface-query:` checks the analytic surface API.

This is a good geometry harness, but it currently tests no save/load round trip, no history undo/redo, no preview versioning, and no server behavior. `.edc` itself is the project's accepted verification surface, so the right move is to extend this runner, not add a separate test suite.

### 1.10 Observed defects and measurement summary

Concrete issues found in the current design:

1. **Restore is not observably atomic.** `restoreTable` clears and re-adds one entity at a time (`public/lib/educad-saves.js:94-95`). Subscribers can see a partial sheet.
2. **Revision counts entities, not transactions.** A two-entity restore increments revision three times (`clear` plus two adds); `updateMany` increments once per changed entity. Cache invalidation and "document changed" semantics are therefore noisy.
3. **Undo can detach the open drawing.** The save UI treats any `clear` event as "new drawing" and nulls `current.id` (`public/index.html:5078-5085`). History restore calls `restoreTable`, which emits `clear`. After an undo, the next Save can POST a duplicate instead of updating the open drawing. This follows directly from the code path; it was not reproduced in a browser session.
4. **Loaded IDs are not reserved.** `create()` probes for a free generated ID instead of advancing the allocator past loaded `E<n>` values.
5. **Save version is ignored.** `SAVE_VERSION` is written but `restoreTable` never checks it.
6. **Preview format is unversioned.** `VERSION` exists but is not stored or checked; no source fingerprint links a preview to its 2D model.
7. **Server writes are last-write-wins.** No drawing revision or CAS; set question JSON has a read-modify-write race.
8. **No database migration path.** Adding a column to `drawings` or `sets` is not handled for existing databases.

Full rebuild cost, measured by calling `EduCADReconstruct.reconstruct` directly (Node 22, no rendering, first run includes warm-up):

| Script | Entities | First call | Warm calls |
|---|---:|---:|---:|
| `tools/scripts/large-plate.edu` | 49 | 96.5 ms | 30.2-30.9 ms |
| `tools/scripts/surface-intersect-spheres.edu` | 11 | 23.4 ms | 8.2-8.3 ms |

The 49-entity plate is the more relevant interactive case: a warm full rebuild is about two frames at 60 Hz before rendering. The sphere script's 4.6 s `edc` run is dominated by its analytic surface queries and certificates, not by `reconstruct`; do not attribute that number to live rebuild.

---

## 2. OSS patterns

The five systems differ less in their data structures than in where they put the boundary between authored state and derived state.

### 2.1 FreeCAD 1.1.4: document, features, transactions, dependency graph

FreeCAD's `App::Document` owns feature objects. `DocumentObject` has a durable internal `_Id`, a document name, a user-visible `Label`, and typed properties. Property links create the dependency edges. `DocumentObject::touch()` marks an object dirty, `mustExecute()` decides whether `execute()` runs, and `getInList()`/`getOutList()` expose reverse and forward dependencies ([`DocumentObject.h`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/DocumentObject.h), lines 180-191, 294-309, 374-391).

Transactions are explicit and named. `Document::openTransaction`, `commitTransaction`, and `abortTransaction` are declared in [`Document.h`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/Document.h), lines 475-520. `App::Transaction` stores per-object add/delete/change records; `TransactionObject` stores property deltas, and `Transaction::apply(Document&, bool forward)` applies them forward or backward ([`Transactions.h`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/Transactions.h), [`Transactions.cpp`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/Transactions.cpp)). Transactions have names, can be grouped across documents by shared ID, and the undo stack is bounded both by count (API default 20) and by a byte limit (`Document.h:496-505`).

Recompute is dependency-driven, not whole-document:

- `Document::recompute` refuses to run during undo/redo, obtains a topologically sorted dependency list, calls `_recomputeFeature` only for objects that must recompute, then marks dependents for a second pass ([`Document.cpp`](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/Document.cpp), lines 2624-2760).
- `getDependencyList` builds the graph and topologically sorts it (same file, around lines 2430-2570).
- `Document::undo` sets the `undoing` flag, applies the transaction backward, and deliberately suppresses recompute during the apply (same file, lines 157-205).

Persistence is a zip container. `Document.xml` carries `SchemaVersion="4"`, `ProgramVersion`, and `FileVersion`; `Restore` reads those fields and can schedule recompute for migration (`Document.cpp:989-1050`, `1938-2040`). Each object's B-rep is stored as a separate `.brep` file, so loading a current file does not require a full recompute. The format is documented in [File Format FCStd](https://wiki.freecad.org/File_Format_FCStd/en). The dependency graph is a first-class debugging view ([Std DependencyGraph](https://wiki.freecad.org/Std_DependencyGraph/en)).

Lessons for EduCAD:

- named transactions and property-level deltas make undo cheap and diagnosable;
- a dependency graph is what makes "recompute only what changed" possible;
- persisted computed shapes are a cache, not the authored source;
- schema version, program version, and file version are separate concepts.

FreeCAD's documented weak spot is topological naming: a sketch can remain linked to the wrong face after an upstream edit. Stable IDs do not automatically make derived sub-element identity stable. Any incremental EduCAD cache must key on authored IDs and invalidate conservatively, not assume that a regenerated face has the same meaning.

### 2.2 LibreCAD 2.2.1.6: containers, undo cycles, deletion state

LibreCAD's `RS_Document` multiply inherits `RS_EntityContainer` and `RS_Undo`. It owns the entity container plus layer/block lists and variables, and declares the abstract save/open operations ([`rs_document.h`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_document.h), lines 46-76). Containers own entities when `autoDelete` is set; `removeEntity` deletes on removal ([`rs_entitycontainer.h`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_entitycontainer.h), lines 47, 213-214, 274; [`rs_entitycontainer.cpp`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_entitycontainer.cpp), lines 367-389, 493-506).

Undo is a stack of `RS_UndoCycle` objects, each a set of `RS_Undoable*`. `RS_Undo` keeps a vector of cycles and an undo pointer; `startUndoCycle`/`endUndoCycle` nest, and `undo`/`redo` move the pointer and call `changeUndoState` on every object in the cycle ([`rs_undo.h`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_undo.h), lines 45-98; [`rs_undo.cpp`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_undo.cpp), lines 79-209). `RS_UndoCycle::changeUndoState` toggles each object's `FlagUndone` ([`rs_undocycle.h`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_undocycle.h), lines 49-82; [`rs_undocycle.cpp`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_undocycle.cpp), lines 65-68). This is cheap, but it is primarily a creation/deletion undo: there is no general property snapshot. Redo pruning must find objects no longer referenced by any live cycle and destroy them.

Entity IDs are a process-global static counter, not a persisted document identity ([`rs_entity.cpp`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_entity.cpp), lines 99-101). DXF handles, not these IDs, are the interchange identity. Save is delegated to DXF/DWG filters; the writer picks an `$ACADVER` target (AC1009 through AC1021 in the reviewed source), so compatibility is delegated to the external format ([`rs_filterdxfrw.cpp`](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/filters/rs_filterdxfrw.cpp), around lines 1412-1497).

Lessons:

- pointer-based undo is fast but couples history to object lifetime;
- toggling a deleted flag is not enough once edits change geometry rather than create/delete objects;
- an external format can carry compatibility, but then the app cannot control semantics or version migration.

### 2.3 OpenSCAD 2021.01 / current master: source is the document, caches are ephemeral

OpenSCAD's authored document is the `.scad` source. Compilation builds an `AbstractNode` tree; evaluation builds a CSG tree of `CSGLeaf` and `CSGOperation` nodes. `CSGNode::dump()` is the textual CSG representation ([`CSGNode.h`](https://github.com/openscad/openscad/blob/85186561f1d4eebf525d3d2172b535360ee11f65/src/core/CSGNode.h)), and `CSGTreeEvaluator` constructs that tree from the evaluated geometry ([`CSGTreeEvaluator.h`](https://github.com/openscad/openscad/blob/85186561f1d4eebf525d3d2172b535360ee11f65/src/core/CSGTreeEvaluator.h)).

The important design statement is in [`Tree.h`](https://github.com/openscad/openscad/blob/85186561f1d4eebf525d3d2172b535360ee11f65/src/core/Tree.h): node trees do not survive a recompilation, so neither does the tree abstraction. `GeometryEvaluator::evaluateGeometry` keys caching by the tree's node ID string and checks the geometry/CGAL caches before traversing ([`GeometryEvaluator.cc`](https://github.com/openscad/openscad/blob/85186561f1d4eebf525d3d2172b535360ee11f65/src/geometry/GeometryEvaluator.cc)). Node indices are compile-session identities, not durable document IDs.

Persistence is source text. The CSG export is a simplified subset of the source, with variables expanded and expressions evaluated; it is useful for interchange but loses parametric structure ([OpenSCAD CSG Export](https://files.openscad.org/documentation/manual/CSG_Export.html)). There is no model-level transaction or undo system; editor undo belongs to the text editor.

Lessons:

- keeping authored source and derived trees separate avoids many consistency problems;
- cache scope should be tied to a compile/evaluation generation, and caches should be discarded when the source changes;
- a textual interchange tree is not a substitute for a document format with stable identity.

### 2.4 OCCT 8.0.1 / XCAF: label tree, definitions vs instances, deltas

OCCT's application document is `TDocStd_Document`: a container of a `TDF_Data` label/attribute framework. It provides command transactions and undo/redo, with a configurable undo limit; by default undo is disabled ([`TDocStd_Document.hxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ApplicationFramework/TKLCAF/TDocStd/TDocStd_Document.hxx), lines 40-180). `TDF_Transaction` opens a transaction, commits it with an optional `TDF_Delta`, or aborts it; its destructor aborts an unclosed transaction, and commits/aborts include all nested transactions up to the current one ([`TDF_Transaction.hxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ApplicationFramework/TKLCAF/TDF/TDF_Transaction.hxx)). A `TDF_Delta` is a set of attribute deltas with begin/end times that restores the framework to the earlier state ([`TDF_Delta.hxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ApplicationFramework/TKLCAF/TDF/TDF_Delta.hxx)). `TDocStd_MultiTransactionManager` can synchronize transactions across documents, with nested-transaction mode delegated to each document ([OCCT reference](https://dev.opencascade.org/doc/occt-8.0.0/refman/html/class_t_doc_std___multi_transaction_manager.html)).

XCAF adds a standardized organization on top of the label tree. `XCAFDoc_ShapeTool` stores shapes on sub-labels of the shapes label; an assembly's components are sub-labels that reference the original shape label plus a location ([`XCAFDoc_ShapeTool.hxx`](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/DataExchange/TKXCAF/XCAFDoc/XCAFDoc_ShapeTool.hxx), lines 36-100). The XDE guide states the key modeling decision directly: shape definitions and their locations are separated, and an assembly references one shape with different locations ([XDE guide](https://dev.opencascade.org/doc/overview/html/occt_user_guides__xde.html), sections "Assemblies" and "Shapes and Assemblies").

Persistence is split:

- OCAF stores the document's label/attribute framework; the document warning says only the framework is saved, so application data must be represented as attributes.
- XDE readers/writers translate supported attributes (shapes, colors, layers, names, assemblies, validation properties) to/from STEP and IGES. `STEPCAFControl_Reader`/`Writer` perform the document-level transfer ([reader](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/DataExchange/TKDESTEP/STEPCAFControl/STEPCAFControl_Reader.hxx), [writer](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/DataExchange/TKDESTEP/STEPCAFControl/STEPCAFControl_Writer.hxx)). STEP has its own schema and entity graph; not every OCAF attribute round-trips.

Lessons:

- labels are a good durable identity for sub-elements, but the shape payload is a separate, immutable-ish value with a location;
- delta-based transactions are appropriate for a property framework;
- external exchange formats support a defined subset, so "save compatibility" must say which subset is lossless.

### 2.5 Blender 5.2.3: dependency graph, copy-on-write, memfile undo, versioned files

Blender separates authored DNA data from evaluated data. The dependency graph is a graph of scene entities and relations; it evaluates only what depends on a changed value, applies modifiers/constraints to a copy of the data, and stores generated results on the graph ([Dependency Graph](https://developer.blender.org/docs/features/core/depsgraph/)). The original DNA is not mutated by evaluation. The graph is rebuilt when relations change, not on every value edit.

Undo is a single stack of undo steps. Steps can be stateful or differential, and the stack is currently fully relative; reaching an arbitrary step requires processing the steps in between ([Undo System](https://developer.blender.org/docs/features/core/undo/)). Global undo uses memfile steps: a memory image of `.blend` data, with chunk merging between adjacent steps to avoid duplicating unchanged data ([`memfile_undo.cc`](https://raw.githubusercontent.com/blender/blender/v5.2.3/source/blender/editors/undo/memfile_undo.cc), `memfile_undosys_step_encode`/`step_free`). The user-facing controls are Undo Steps and Undo Memory Limit ([System preferences](https://docs.blender.org/manual/en/5.2/editors/preferences/system.html), "Memory & Limits").

`.blend` compatibility is versioned, not guessed. Files store the generating version and a minimum readable version; DNA is embedded; unknown data is ignored, missing data gets defaults, and incremental `do_versions` code converts old data ([Blend File Compatibility](https://developer.blender.org/docs/handbook/guidelines/compatibility_handling_for_blend_files/)). Backward compatibility is a strong guarantee; forward compatibility is deliberately limited and major breaks are restricted to release-cycle boundaries.

Lessons:

- authored data and evaluated data must be separate; caches belong to the evaluated side;
- whole-state snapshots are acceptable if the snapshot mechanism merges unchanged chunks and the history is bounded;
- explicit version metadata plus incremental migration is more robust than "the reader will figure it out."

### 2.6 Synthesis

| Concern | FreeCAD | LibreCAD | OpenSCAD | OCCT/XCAF | Blender | EduCAD today |
|---|---|---|---|---|---|---|
| Authored root | `App::Document` + feature objects | `RS_Document`/container | `.scad` source | `TDocStd_Document` label tree | DNA datablocks | entity table |
| Unit of change | named transaction, property deltas | undo cycle of object add/delete | source recompile | TDF transaction/delta | operator + undo step | table mutation |
| Derived data owner | feature `execute`, persisted `.brep` cache | none | evaluator tree/caches | shape/attributes, TNaming | depsgraph COW | full `reconstruct` result |
| Durable identity | internal `_Id` + links; topological naming caveat | process-global entity counter; DXF handles | node index only per compile | `TDF_Label` + shape/location | ID datablock/name | entity ID + member ID, no ID reservation |
| Undo storage | property deltas, named stack | pointers + deleted flag | editor text | attribute deltas | relative steps, memfile snapshots | full JSON snapshots, 50 deep |
| Save version gate | SchemaVersion/ProgramVersion/FileVersion | DXF `$ACADVER` | source language/tool version | OCAF/STEP schema | file/DNA version + `do_versions` | `version:1` written, never read |

The common pattern is not "use deltas everywhere." It is:

1. keep one authored representation with stable identity;
2. make changes go through an explicit boundary;
3. keep derived data behind a cache with a generation/version;
4. make persistence self-describing and migrate on read;
5. make undo storage a deliberate trade-off between snapshot size and delta complexity.

---

## 3. Comparison matrix

Ratings: **A** strong, **B** adequate with caveats, **C** weak, **N/A** not applicable.

| System | Identity stability | Atomicity | Recompute cost | Undo granularity | Save compatibility | Testability |
|---|---|---|---|---|---|---|
| **EduCAD (this commit)** | **B.** Entity/member IDs are stable within a sheet and survive JSON, but loaded IDs are not reserved and legacy IDs are name-derived. | **B.** Single edits and `updateMany` validate before commit; restore publishes `clear` plus N adds and can leave a partial table, while import publishes N add events after filling the table. | **C.** Full `reconstruct` on every table event, RAF-coalesced. 49 entities ~30 ms warm; no stage/component cache. | **B.** One entry per gesture, but whole-document JSON snapshots, 50 max, no labels; 500 entities ~85 ms undo, 1000 ~304 ms. | **C.** `version:1` is written but ignored; no migration registry; preview has no stored version or source fingerprint; server stores opaque JSON. | **B.** Excellent deterministic geometry checks via `.edc`; no save/history/preview/server coverage. |
| **FreeCAD 1.1.4** | **A.** Internal object IDs and property links; UI names are separate. Topological naming remains a derived-subshape weakness. | **A.** Named transactions with commit/abort and rollback; transaction lock and auto transactions. | **A.** Touched dependency closure, topological sort, `mustExecute`; recompute suppressed during undo. | **A.** Delta-based named transactions, count/byte limits, undo/redo across documents by transaction ID. | **A.** `.FCStd` zip with `SchemaVersion`, `ProgramVersion`, `FileVersion`, per-object `.brep`; migration on restore. | **A.** Python API, source-level tests, dependency graph export; easy to script. |
| **LibreCAD 2.2.1.6** | **C.** Process-global entity counter, not persisted; DXF handles are interchange identity; undo holds raw pointers. | **B.** Undo cycles group operations and nest, but there is no validation/rollback transaction at the document level. | **N/A.** 2D entities have no dependency graph or rebuild pipeline. | **B.** Cheap cycles toggle deleted flags; primarily create/delete, not arbitrary property edits; redo pruning destroys objects. | **B.** DXF/DWG via filter, `$ACADVER` target; compatibility delegated to external format. | **B.** `RS_Undo` self-test and integration tests exist, but no modern document-model test surface. |
| **OpenSCAD 2021.01/master** | **C.** Node index/tree identity lasts only for a compile; no persistent object IDs. | **C.** No model transactions; a source edit is a recompile. | **B.** Evaluation caches keyed by node/tree ID; invalidated when the tree is recompiled. | **C.** Editor text undo only; no CSG/document history. | **B.** `.scad` source is canonical; CSG export is a lossy subset; no document schema version. | **A.** Large golden/regression test suite and deterministic CLI. |
| **OCCT/XCAF 8.0.1** | **A.** `TDF_Label` identity within a document; assembly definitions and instance locations are separate. Persistent subshape naming still needs care (TNaming). | **A.** `TDF_Transaction` open/commit/abort, nested transactions, `TDF_Delta`; multi-document manager. | **B.** No general feature graph like FreeCAD; OCAF tracks modifications and shapes are values; application-level recompute is common. | **A.** Delta-based undo/redo with configurable limit; only TDF data participates. | **A/B.** OCAF framework persistence plus STEP/IGES subset; supported attributes round-trip, application-specific ones may not. | **A.** Draw/test harness, reference docs, deterministic C++ APIs. |
| **Blender 5.2.3** | **A.** ID datablocks with names/session identity; evaluated copies are separate. | **A.** Operators and undo boundaries; depsgraph updates are batched after changes. | **A.** Dependency graph + copy-on-write; updates only dependents, not the whole scene. | **A.** Relative undo stack with stateful/differential steps; memfile snapshots merge unchanged chunks; steps/memory limits. | **A.** File version + DNA + incremental `do_versions`; strong backward, limited forward compatibility. | **A.** Extensive automated tests and Python API. |

What the matrix says for EduCAD:

- The entity/member identity model is already closer to FreeCAD/OCCT than to LibreCAD/OpenSCAD. Keep it; do not replace it with a name-based model.
- The weakest dimensions are save compatibility and recompute cost, not geometric correctness.
- Undo snapshots are adequate for small sheets but are the wrong asymptotic structure.
- The backend has no document version at all, which is a bigger risk than the client-side history design.

---

## 4. Concrete improvements, ranked

### 4.1 Is the full-rebuild model acceptable?

**Yes as the authoritative baseline, no as the only long-term strategy.**

Keep full `reconstruct` for:

- loading a saved drawing;
- changing reconstruction options or identity mode;
- any sheet with unknown/custom `meta` that the dependency index cannot classify;
- debugging and `.edc` verification, where determinism matters more than latency;
- a correctness oracle for incremental results.

The measurements justify this for current-scale sheets: 49 entities rebuild in about 30 ms warm, and 11 curved/analytic entities in about 8 ms. That is acceptable for a click or a command. It is not comfortable for a continuous drag: 30 ms is roughly two 60 Hz frames before rendering, validation, and canvas work.

The real problem is not that the rebuild is full; it is that it is **unconditional and unlabelled**. A single pointer move, a style change, a selection change that somehow touches the table, and a multi-entity restore all trigger the same pipeline. The first improvement should be to make change batches coherent; the second is to cache stages; component-level incremental rebuild is a later optimization.

**What should become incremental, in order:**

1. **Event/rebuild batching.** One rebuild per committed transaction, not one per entity event.
2. **Cheap derived caches.** Cache profile validation, layout mapping, projection/visibility, and the preview by document revision. These are pure functions of the table and options.
3. **Stage cache.** Cache normalized identity, wireframe, surface model, and certificate separately, keyed by stage + options + contributing entity IDs.
4. **Component cache.** Partition independent solids/components by member links and geometric connectivity; rebuild only dirty components.
5. **Preview cache.** Reuse a preview when its `sourceHash` (the drawing's `contentHash`), pipeline version, and options match.

Do **not** start by making identity normalization incremental. It is small relative to surface inference and it is the part most likely to produce subtle correspondence bugs.

### 4.2 Ranked improvements

| Rank | Improvement | Value | Effort | Risk |
|---:|---|---|---|---|
| 1 | Atomic table replace + transaction-coherent revision | Fixes observable atomicity, undo/save duplication, event storms | Low | Medium |
| 2 | Drawing save v2 envelope + migration registry | Prevents silent format drift and future-data loss | Low-medium | Low |
| 3 | Server revisions/CAS + schema migration | Prevents multi-tab and multi-teacher data loss | Medium | Medium |
| 4 | Structural-share entity snapshots + bounded history | Makes undo O(changed), not O(document) | Medium | High |
| 5 | Preview v2 + source fingerprint + validation | Prevents stale/mismatched student previews | Medium | Medium |
| 6 | Stage/component incremental recompute behind full fallback | Restores frame budget on larger sheets | High | High |
| 7 | Named transaction labels and history audit | Better UX and debuggability | Low | Low |
| 8 | Optional server-side revision history | Cross-session recovery/audit | High | Medium |

#### Rank 1: atomic table replace and coherent revision

Add a table operation that publishes a complete entity set in one step:

- validate and build all entities in a staging table;
- swap the ID map and order array;
- increment the revision exactly once;
- emit one `replace` event (or one `batch` event with the changed IDs).

Use it for `restoreTable`, `importEntities`, and history undo/redo. Do not emit `clear` followed by `add` for a restore. Keep `clear` for the user's Clear command, where "this is a new empty drawing" is the intended semantic.

Also change `updateMany` to emit once after all patches are applied, with the list of changed IDs, and increment revision once per committed batch.

This fixes three current issues at once:

- subscribers never observe a half-restored sheet;
- cache invalidation sees one document generation per transaction;
- the save UI no longer mistakes an undo for a new drawing.

Acceptance:

- a subscriber counting events sees exactly one event for a restore and one for `updateMany`;
- undo/redo after saving keeps the same `current.id`, so Save updates rather than creates;
- malformed restore leaves the live table unchanged;
- all existing `.edc` scripts still pass.

#### Rank 2: drawing save v2 envelope and migration registry

Write a self-describing document envelope while keeping the entity payload compatible:

```json
{
  "format": "educad-drawing",
  "version": 2,
  "minReaderVersion": 2,
  "createdAt": 1700000000000,
  "savedAt": 1700000001000,
  "revision": 42,
  "contentHash": "fnv1a64:...",
  "app": { "name": "EduCAD", "version": "..." },
  "entities": [ ... ],
  "extensions": {}
}
```

Rules:

- read the current v1 shape (`{version:1,savedAt,entities}`) and a bare `{entities:[...]}` as legacy v1;
- write v2;
- reject a payload whose `version` or `minReaderVersion` is newer than the reader, with a clear message and no table mutation;
- do not silently drop unknown entity fields: add an explicit `extensions` object for additive data, or reject unknown required fields;
- keep `SAVE_VERSION` exported for compatibility, but make `CURRENT_SAVE_VERSION` the authority;
- put migration steps in one registry (`v1 -> v2`), not in scattered conditionals.

Why this outranks history changes: a format mistake is permanent and cross-version; an undo performance problem is local and fixable.

Acceptance:

- a v1 fixture loads and resaves as v2 with identical entity/member IDs and geometry;
- a v2 save loads in the same build;
- a hypothetical v3 save is refused without clearing the table;
- `.edc` round-trip properties pass.

#### Rank 3: server-side drawing revisions and CAS

Add a document revision to the backend:

- `drawings.rev INTEGER NOT NULL DEFAULT 1`;
- `sets.questions_rev INTEGER NOT NULL DEFAULT 1` (or equivalent for the JSON question array);
- `GET` returns the revision;
- `PUT /api/drawings/:id` accepts `base_rev`; the SQL update includes `AND rev = ?`; a zero-row update returns `409 conflict` after distinguishing "missing" from "stale";
- question model/check/show3d updates use the same compare-and-swap rule.

This is the only way to stop the classic two-tab overwrite: both tabs can be internally consistent and still destroy one another's work. It also makes the eventual client "reload or overwrite?" UX possible.

Add a database migration mechanism at the same time:

- a `schema_migrations` table, or `PRAGMA user_version`;
- guarded `ALTER TABLE` statements for existing databases;
- `backend/schema.sql` remains the canonical fresh-install schema;
- migrations run at startup before serving.

Acceptance:

- two clients with the same `base_rev` produce one success and one 409;
- a stale client can fetch and retry;
- an existing database upgrades once, idempotently;
- old clients that omit `base_rev` remain temporarily accepted (transition), then become an explicit error.

#### Rank 4: structural-share snapshots and byte-bounded history

The current history is a full JSON clone per entry. Replace it with a snapshot that shares immutable entity objects:

- treat published entity objects as immutable;
- `update`/`move`/`updateMany` create new entity objects for changed IDs instead of mutating in place;
- a snapshot is `{revision, order: [...ids], byId: {id: entity}}` with shallow map/order copies;
- history stores those snapshots; unchanged entities are shared;
- undo/redo swaps the snapshot in one atomic `replace` and emits one event;
- bound history by estimated entity references and/or bytes, not only by 50 entries;
- keep a small number of checkpoints if delta history is added later.

This is a larger change than ranks 1-3 because many call sites currently receive a mutable entity from `table.get()` and may mutate it. Audit all direct writes (`e.x = ...`, `e.meta = ...`) before enabling immutable publication. In development, freeze entities and run the `.edc` corpus to find violations.

If immutable entities are too invasive, an intermediate step is to keep mutable entities but store history as a change journal: each committed transaction records before/after copies for only the touched IDs, plus add/remove order positions. That is closer to FreeCAD/LibreCAD and gives O(changed) undo, at the cost of a more complex restore path.

Acceptance:

- 1000-point undo is materially below the current 304 ms (target: under 50 ms on this machine);
- undo/redo produces byte-identical canonical geometry and metadata;
- 50-entry history memory is bounded and measured;
- no caller mutates a published entity (freeze test).

#### Rank 5: preview v2 with source fingerprint

Treat a preview as a derived artifact with provenance, not an opaque blob:

```json
{
  "format": "educad-3d-preview",
  "version": 2,
  "minReaderVersion": 2,
  "generatedAt": 1700000002000,
  "source": {
    "format": "educad-drawing",
    "version": 2,
    "sourceHash": "fnv1a64:...",
    "entityCount": 42
  },
  "pipeline": { "name": "educad-reconstruct", "version": 1 },
  "status": "ok",
  "geometry": { ... }
}
```

Design choices:

- use a deterministic, documented, non-cryptographic `sourceHash` (for example FNV-1a 64 over canonical JSON sorted by entity ID) for invalidation, not as a security mechanism;
- include the reconstruction pipeline contract/version and the analytic certificate contract in validation;
- keep v1 previews readable as `legacy` objects, but do not attach a new v2 model to a legacy preview;
- `validPreview` should reject a newer major version, a missing/invalid source hash for v2, out-of-range indices, and implausible counts;
- the teacher client must verify `preview.source.sourceHash` equals the hash of the snapshot being attached;
- the server can compare the stored `model.contentHash` with `model3d.source.sourceHash` and erase/refuse a mismatch, without reconstructing geometry;
- updating `/model` without a preview continues to erase the preview (already correct).

This is a safety feature for students: a stale preview is worse than no preview because it teaches the wrong shape.

Acceptance:

- a v1 preview still renders;
- a v2 preview built from a snapshot has a matching source hash;
- a mismatch is rejected/hidden, not rendered;
- `.edc` can assert `previewVersion`, `previewValid`, and `previewSource`.

#### Rank 6: stage/component incremental recompute behind a full fallback

Introduce a derived-document layer, not a second reconstruction algorithm:

```
DocumentState
  authored: table snapshot
  revision: committed revision
  dirty: Set<entityId>
  stages:
    normalized  -> { version, inputRevision, status, value, diagnostics }
    wireframe   -> { ... }
    surfaces    -> { ... }
    projection  -> { ... }
    preview     -> { ... }
```

Implementation rules:

- build a reverse dependency index from every `meta` reference: `refs`, `endpointRefs`, `endpointMemberIds`, `centerRef`, `radiusRef`, `throughRefs`, `vertices`, `polygon`, plus member ID -> stations;
- a mutation dirties the changed entity and its reverse dependents;
- stages are cached by `stage + options + contributing entity IDs + pipeline version`;
- partition independent components by shared member IDs and shared geometry; rebuild only dirty components;
- if an entity has unknown `meta` keys, a `CURVE`, a declared topology, or any construct the index cannot classify, mark the whole stage dirty and fall back to full rebuild;
- after an incremental result, optionally run the full pipeline in development and compare a canonical geometry hash; on mismatch, discard the cache and use the full result;
- never persist the derived cache in a `.edu`/save file; recompute on load or store a preview as a separate artifact.

This mirrors FreeCAD's touched dependency graph and Blender's depsgraph, but keeps EduCAD's one public reconstruction path. It should be enabled behind a flag and only promoted after the `.edc` corpus matches the full rebuild.

Acceptance:

- incremental and full results have identical canonical hashes on all representative scripts;
- a point drag on `large-plate.edu` rebuilds only the affected component and stays under one frame;
- changing an option or loading a file invalidates all stages;
- unknown meta forces full rebuild and says so in diagnostics.

#### Rank 7: named transaction labels

Add a label to `begin(label)` and store it on the history entry. Then the UI can show "Undo Move point A" and the history can coalesce repeated edits by label. This is low risk and improves discoverability, but it is not required for correctness.

#### Rank 8: optional server-side revision history

An append-only `drawing_revisions` table (or periodic snapshots) would allow cross-session recovery and teacher audit. It is not needed for the current single-sheet workflow and adds storage/retention/privacy decisions. Defer until CAS is in place and there is a concrete recovery requirement.

---

## 5. Target data model and migration sequence

### 5.1 Authored document

```json
{
  "format": "educad-drawing",
  "version": 2,
  "minReaderVersion": 2,
  "createdAt": 0,
  "savedAt": 0,
  "revision": 0,
  "app": { "name": "EduCAD", "version": "..." },
  "entities": [],
  "extensions": {}
}
```

- `revision` is a local committed-edit counter. It is not a server concurrency token; the server has its own `rev`.
- `contentHash` is optional, deterministic and non-cryptographic; it is the value a preview records as its source fingerprint. If absent, the server cannot compare a preview to its model and must rely on the client's attach-time check.
- `minReaderVersion` allows a future v3 to declare that older readers must refuse it. v2 readers should accept v1 and bare entity arrays.
- `extensions` is the only place for additive document data that a v2 reader does not understand. Entity-level additive data should live in `meta` (already arbitrary) or an explicit `entity.extensions`; do not rely on unknown top-level entity fields, because `createEntity` currently drops them.
- `entities` keeps the current entity schema: stable `id`, immutable `type`, geometry in mm, style fields, `viewRole`, and `meta` with members/references.

### 5.2 Entity identity

- Entity IDs are assigned by the table; `create()` should advance a table allocator, and load should reserve every loaded `E<n>` ID.
- Member IDs remain as today. New member IDs should be opaque and stable, not derived from display order; keep the legacy name-derived IDs as compatibility values only.
- `meta.endpointMemberIds`, `centerRef`, `radiusRef`, `throughRefs`, and `polygon` remain ID-based. Names are resolved only at explicit input boundaries.
- Stale references are reported, never silently retargeted.

### 5.3 Derived document

```text
DerivedDocument
  revision
  optionsHash
  dirty: Set<entityId>
  stages:
    normalized: StageResult
    wireframe: StageResult
    surfaces: StageResult
    projection: StageResult
    preview: StageResult

StageResult
  version
  inputRevision
  inputHash
  status
  value
  diagnostics
```

- `inputHash` covers the contributing entity IDs and their canonical JSON, plus options and pipeline version.
- The cache is in memory only and is discarded on load, option change, or an unknown dependency.
- Full rebuild remains the fallback and the correctness oracle.

### 5.4 History

Two acceptable target designs:

**A. Structural snapshots (recommended first).** Publish immutable entities; snapshots share unchanged objects and copy only the ID map/order. Simple and low-risk once entities are immutable.

**B. Change journal (later, if needed).** A committed transaction stores add/remove/update records with before/after state; undo applies inverse records in reverse order. This is closer to FreeCAD and gives the smallest memory footprint, but it requires careful handling of cascade deletes, order, and revalidation.

Either design must:

- emit one atomic `replace`/`batch` event per undo/redo;
- preserve IDs, member metadata, and order;
- cap history by count and estimated bytes;
- never trigger a `clear` semantic in subscribers.

### 5.5 Preview

Preview v2 stores a derived geometry payload plus provenance:

- `format`, `version`, `minReaderVersion`;
- `source.sourceHash`, `source.entityCount`, `source.drawingVersion`;
- `pipeline.version` and the surface/certificate contract versions;
- `status` and diagnostics.

The source hash is an invalidation key, not a signature. The server may compare model and preview hashes; the client must validate the full geometry before rendering.

### 5.6 Server

- `drawings`: add `rev` and, if useful, `format_version`; keep `data_json` as the authoritative envelope.
- `sets`: add `questions_rev` (and return it) for CAS on the JSON question array.
- Add a migrations table or `PRAGMA user_version`; run guarded migrations at startup.
- Validate the envelope (`format`, integer `version`, `entities` array, size cap) before storing. Do not duplicate the full geometry validator on the server.
- For previews, validate `format`, `version`, `source.sourceHash`, and basic size/shape limits; reject a newer major version. When both are present, require `model.contentHash` to match `model3d.source.sourceHash`.
- Return `rev` from create/get/update and accept `base_rev` on update.

### 5.7 Migration sequence

| Phase | Change | Depends on | Acceptance |
|---:|---|---|---|
| 0 | Baseline measurements and representative `.edu` scripts | none | Current rebuild/history numbers recorded; scripts pass |
| 1 | Atomic `replace`/batch, one revision per transaction, single event | none | Restore/undo emit one event; save after undo keeps drawing ID; `.edc` corpus passes |
| 2 | Drawing envelope v2, reader accepts v1/bare, migration registry | 1 | v1 round-trip preserves IDs/members; newer version refused without table mutation |
| 3 | Preview v2, source hash, validation and teacher attach check | 2 | v1 preview readable; v2 source hash verified; mismatch hidden |
| 4 | Server `rev`/CAS, DB migrations, envelope/preview validation | 2, 3 | Two-client conflict returns 409; existing DB upgrades idempotently |
| 5 | Immutable entities + structural snapshots + byte-bounded history | 1 | 1000-point undo materially faster; canonical state identical |
| 6 | Stage/component incremental cache behind full fallback | 1, 5 | Incremental/full hash equality on `.edc` corpus; performance target met |
| 7 | Optional server revision history / audit | 4 | Retention/privacy policy defined; recovery demonstrated |

Ordering rationale:

- Phase 1 fixes a current correctness/UX bug and makes every later event-based optimization simpler.
- Phase 2 is cheap and prevents format drift before preview/server work.
- Phase 3 is a safety feature for students; it depends on the drawing envelope for source identity.
- Phase 4 stops data loss and is independent of the derived cache.
- Phase 5 is high-risk because it touches object mutability; do it after format and event semantics are stable.
- Phase 6 is last because cache invalidation bugs are the most expensive to diagnose; the full rebuild remains the oracle.

Compatibility policy:

- write only the current format;
- read v1 and bare arrays indefinitely (or for a documented deprecation window);
- accept unknown optional fields only under `extensions`/`meta`, never silently drop unknown required ones;
- reject newer `version`/`minReaderVersion` with a user-visible message;
- keep drawing version, preview version, app version, and server DB schema version independent;
- document the policy in `docs/IDENTITY_RULES.md` and the manual.

---

## 6. Risks and `.edu` verification strategy

### 6.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| v2 readers drop v1 data or v1 readers misinterpret v2 | Medium | High | v1 adapter + fixtures; additive fields only; explicit version refusal; no silent unknown-field drops |
| Atomic replace changes subscriber semantics | Medium | Medium | Introduce a `replace` event; audit subscribers; keep `clear` only for user Clear; test undo/save ID |
| Immutable entities break callers that mutate `get()` results | High | High | Audit direct writes; freeze in dev; convert all mutations to table operations; run `.edc` corpus |
| Incremental cache misses a dependency | Medium | High | Reverse dependency index; unknown-meta full fallback; compare full/incremental hashes in tests; version the cache |
| Preview source hash collision or non-crypto misuse | Low | Medium | Document as invalidation only; combine with entity count/revision; do not use for security |
| Server CAS migration breaks old clients | Medium | Medium | Optional `base_rev` transition; clear 409 UX; migration tests |
| History memory growth | Medium | Medium | Byte/reference cap; structural sharing; monitor |
| Full rebuild still janks larger sheets | High | Medium | Batch events, stage cache, component cache; keep full fallback |
| Save size grows beyond 1 MB body limit | Low-medium | Medium | Envelope size checks; avoid duplicate preview/geometry; compress at HTTP if needed |
| Pose/table interleaving leaves stale derived state | Low | Medium | On pose exit, force one rebuild; ignore table edits only while pose lock is authoritative |
| `.edc` runner extensions become a second test framework | Low | Low | Keep directives inside `tools/edc.js`; no new suite; reuse `# expect:` properties |

### 6.2 Extend the existing `.edc` runner

The project rule is to verify with `.edc` scripts and `# expect:`. Do not add a separate unit-test suite. Extend `tools/edc.js` with a small set of directives that compute properties from the same table:

- `# persist: roundtrip` — snapshot the table, restore into a fresh table, compare canonical entity JSON, IDs, members, and `CURRENT_SAVE_VERSION`; set `properties.persistRoundtrip`, `persistIds`, `persistMembers`, `saveVersion`.
- `# persist: legacy` — load an inline v1 fixture and assert it upgrades or loads compatibly; set `legacyLoad`.
- `# history: undo` — create a history over a copy of the current table, execute a named command, undo, and compare canonical state; set `historyUndo`.
- `# history: redo` — redo the same step and compare; set `historyRedo`.
- `# preview: valid` — build a preview, validate it, and check its format/source hash; set `previewValid`, `previewVersion`, `previewSource`.
- `# reject-restore: <json>` — attempt a malformed restore on a staging copy, assert it throws and the staging table's digest is unchanged; set `rejected`.
- `# expect:` already accepts arbitrary property names from `properties`, so no new expectation syntax is needed.

Implementation constraints:

- run these directives after the drawing commands, in the same `runScript` function;
- always use a copy/staging table so the measured table is untouched on failure;
- keep IDs deterministic (`E.resetIdCounter()` already does this);
- do not add timing assertions to CI; timing is a development measurement, not a deterministic `.edc` property.

Suggested scripts:

`tools/scripts/persistence-roundtrip.edu`

```text
/datum -40 80
/point a 10 20 plan
/point "a'" 10 40 elevation
/point b 40 20 plan
/point "b'" 40 40 elevation
/line a b
/line "a'" "b'"
/rename a a members
/rename "a'" a members
# persist: roundtrip
# expect: persistRoundtrip=ok persistIds=ok persistMembers=ok saveVersion=2
```

`tools/scripts/preview-version.edu`

```text
/datum -40 80
/circle 20 20 10
# preview: valid
# expect: previewValid=ok previewVersion=2 previewSource=ok
```

`tools/scripts/history-undo.edu`

```text
/point a 10 20
/point b 40 20
/line a b
# history: undo
# history: redo
# expect: historyUndo=ok historyRedo=ok
```

These are examples, not a claim that the current command syntax accepts every name; adapt the commands to the existing command set when implementing.

### 6.3 Verification commands

Run the focused new scripts and a representative subset of existing scripts:

```sh
node tools/edc.js tools/scripts/persistence-roundtrip.edu
node tools/edc.js --solid tools/scripts/preview-version.edu
node tools/edc.js tools/scripts/history-undo.edu
node tools/edc.js tools/scripts/large-plate.edu
node tools/edc.js tools/scripts/surface-intersect-spheres.edu
node tools/edc.js --strict tools/scripts/profile-plan-station.edu
node tools/edc.js tools/scripts/curve-input-errors.edu
```

For the backend, use a small documented `curl` smoke sequence (create, get, update with matching `base_rev`, update with stale `base_rev`, verify 409, verify preview hash rejection). This is not a `.edu` domain, so do not pretend it is covered by `edc.js`; either add a clearly separate integration command or mark it manual in the change description.

### 6.4 Unverified claims

The following are reasoned from source or documentation but were not reproduced end-to-end in a browser or multi-process server:

- the undo/save-ID duplication is derived from the `restoreTable` -> `clear` event path (`public/index.html:5078-5085`); it was not clicked through in a browser;
- the 1000-point undo timing is a Node measurement of the current modules, not a browser measurement with canvas rendering;
- `restoreTable` failure-after-clear was not forced; the code path shows it is possible if an `add()` or subscriber throws after `clear()`;
- the server CAS race was not reproduced; it is inferred from the last-write-wins SQL and the read-modify-write question update;
- the exact classroom sheet size distribution is unknown; the 49-entity and 11-entity scripts are only representative;
- FreeCAD's GUI undo-stack defaults can differ from the C++ API default; the API default of 20 is what the header documents;
- OpenSCAD's latest stable release is still 2021.01, while current master was reviewed at commit `85186561f1d4eebf525d3d2172b535360ee11f65`; behavior described from master may not match 2021.01 exactly;
- OCCT persistence details for application-specific attributes are summarized from the XDE guide and class documentation; no STEP round-trip experiment was run;
- no performance claim is made for Blender, FreeCAD, LibreCAD, or OCCT; their descriptions are architectural, not benchmarks.

---

## Sources

Current EduCAD:

- `public/lib/educad-entities.js`
- `public/lib/educad-drafting.js`
- `public/lib/educad-saves.js`
- `public/lib/educad-ref3d.js`
- `public/lib/educad-reconstruct.js`
- `public/index.html`
- `tools/edc.js`
- `backend/schema.sql`, `backend/src/main.cpp`
- `docs/IDENTITY_RULES.md`, `docs/RECONSTRUCTION_CONTRACT.md`

FreeCAD 1.1.4:

- [App::Document header](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/Document.h)
- [App::Document implementation](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/Document.cpp)
- [Transactions header](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/Transactions.h)
- [Transactions implementation](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/Transactions.cpp)
- [DocumentObject header](https://github.com/FreeCAD/FreeCAD/blob/1.1.4/src/App/DocumentObject.h)
- [File Format FCStd](https://wiki.freecad.org/File_Format_FCStd/en)
- [Std DependencyGraph](https://wiki.freecad.org/Std_DependencyGraph/en)
- [Std Undo](https://wiki.freecad.org/Std_Undo)
- [App::Document class reference](https://freecad.github.io/SourceDoc/d8/d3e/classApp_1_1Document.html)

LibreCAD 2.2.1.6:

- [rs_document.h](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_document.h)
- [rs_undo.h](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_undo.h)
- [rs_undo.cpp](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_undo.cpp)
- [rs_undocycle.h](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_undocycle.h)
- [rs_undocycle.cpp](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_undocycle.cpp)
- [rs_entitycontainer.h](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_entitycontainer.h)
- [rs_entity.cpp](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/engine/rs_entity.cpp)
- [rs_filterdxfrw.cpp](https://github.com/LibreCAD/LibreCAD/blob/v2.2.1.6/librecad/src/lib/filters/rs_filterdxfrw.cpp)

OpenSCAD:

- Stable release: [openscad-2021.01](https://github.com/openscad/openscad/releases/tag/openscad-2021.01)
- Master reviewed at commit [`85186561f1d4eebf525d3d2172b535360ee11f65`](https://github.com/openscad/openscad/commit/85186561f1d4eebf525d3d2172b535360ee11f65)
- [CSGNode.h](https://github.com/openscad/openscad/blob/85186561f1d4eebf525d3d2172b535360ee11f65/src/core/CSGNode.h)
- [Tree.h](https://github.com/openscad/openscad/blob/85186561f1d4eebf525d3d2172b535360ee11f65/src/core/Tree.h)
- [CSGTreeEvaluator.h](https://github.com/openscad/openscad/blob/85186561f1d4eebf525d3d2172b535360ee11f65/src/core/CSGTreeEvaluator.h)
- [GeometryEvaluator.cc](https://github.com/openscad/openscad/blob/85186561f1d4eebf525d3d2172b535360ee11f65/src/geometry/GeometryEvaluator.cc)
- [CSG Export manual](https://files.openscad.org/documentation/manual/CSG_Export.html)

OCCT 8.0.1:

- [TDF_Transaction.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ApplicationFramework/TKLCAF/TDF/TDF_Transaction.hxx)
- [TDF_Delta.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ApplicationFramework/TKLCAF/TDF/TDF_Delta.hxx)
- [TDocStd_Document.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/ApplicationFramework/TKLCAF/TDocStd/TDocStd_Document.hxx)
- [XCAFDoc_ShapeTool.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/DataExchange/TKXCAF/XCAFDoc/XCAFDoc_ShapeTool.hxx)
- [STEPCAFControl_Reader.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/DataExchange/TKDESTEP/STEPCAFControl/STEPCAFControl_Reader.hxx)
- [STEPCAFControl_Writer.hxx](https://github.com/Open-Cascade-SAS/OCCT/blob/V8.0.1/src/DataExchange/TKDESTEP/STEPCAFControl/STEPCAFControl_Writer.hxx)
- [XDE guide](https://dev.opencascade.org/doc/overview/html/occt_user_guides__xde.html)
- [TDF_Transaction reference](https://dev.opencascade.org/doc/occt-8.0.0/refman/html/class_t_d_f___transaction.html)
- [TDocStd_MultiTransactionManager reference](https://dev.opencascade.org/doc/occt-8.0.0/refman/html/class_t_doc_std___multi_transaction_manager.html)

Blender 5.2.3:

- [Dependency Graph](https://developer.blender.org/docs/features/core/depsgraph/)
- [Undo System](https://developer.blender.org/docs/features/core/undo/)
- [Undo & Redo manual](https://docs.blender.org/manual/en/5.2/interface/undo_redo.html)
- [System preferences: Memory & Limits](https://docs.blender.org/manual/en/5.2/editors/preferences/system.html)
- [Blend File Compatibility](https://developer.blender.org/docs/handbook/guidelines/compatibility_handling_for_blend_files/)
- [memfile_undo.cc](https://raw.githubusercontent.com/blender/blender/v5.2.3/source/blender/editors/undo/memfile_undo.cc)
- [ed_undo.cc](https://raw.githubusercontent.com/blender/blender/v5.2.3/source/blender/editors/undo/ed_undo.cc)
- [undo_system.cc](https://raw.githubusercontent.com/blender/blender/v5.2.3/source/blender/blenkernel/intern/undo_system.cc)

---

## Ranked recommendation

1. **Make table publication atomic and transaction-coherent.** Add one `replace`/batch event, one revision increment per committed transaction, and use it for restore, import, and undo/redo. This fixes the current observable atomicity gap, the undo/save-ID bug, and the event storm that makes every later cache harder to reason about.

2. **Ship drawing save v2 with a real migration registry.** Keep v1 readable forever, write a self-describing envelope, refuse newer versions without mutating the sheet, and stop relying on `version:1` as decoration.

3. **Add server-side drawing revisions and compare-and-swap.** Last-write-wins is a data-loss bug, not a missing optimization. Add `rev`/`questions_rev`, guarded migrations, and a clear 409 conflict path.

4. **Version and fingerprint previews.** A preview needs `format`, `version`, `sourceHash`, and pipeline/certificate contracts. Validate v1 as legacy; reject mismatches; let the server erase a preview that no longer matches its model.

5. **Replace full JSON history snapshots with structural sharing and a byte bound.** Keep full rebuild as the correctness oracle and default, but make undo O(changed) rather than O(document); the measured 500-1000 entity undo cost is already outside interactive comfort.

6. **Only then add incremental recompute.** Start with batching and cheap pure caches, then stage caches, then component-level rebuilding. Keep a conservative dependency index and a full-rebuild fallback for unknown metadata; compare incremental and full hashes in the `.edc` corpus before promoting it.

7. **Verify all of it through the existing `.edc` runner.** Extend `tools/edc.js` with `# persist:`, `# history:`, `# preview:`, and `# reject-restore:` directives, assert the resulting properties with `# expect:`, and run the existing representative scripts. No separate test framework is needed or wanted.

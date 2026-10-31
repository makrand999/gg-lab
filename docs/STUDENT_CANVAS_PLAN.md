# Student drawing studio — workflow and implementation plan

Status: step 1 delivered and browser-validated. Scope: student canvas in Major 2, including blank
drawings, saved drawings, assignment attempts, practice, and immutable reviews.
The remaining steps are an implementation roadmap, not features already shipped.

## What students are doing

The student's job is to construct and reason about related 2D views. The 3D
result should help them understand their own construction and return to it.
It should never silently draw an answer, change the paper, or stand in for the
teacher's verdict. Visual polish follows that hierarchy.

This plan combines the existing engine and browser workflow audit with NPTEL
engineering-drawing teaching material. It is a design hypothesis, not a claim
that we have observed students using the new interface. Step 12 includes actual
student observation and iteration.

### Construction sequence

| Student activity | What the interface needs to provide |
| --- | --- |
| Read the problem | Persistent access to dimensions, orientation, plane relationships, required views, and optional teacher hints; keep the prompt intact |
| Set up the sheet | Visible projection convention, XY reference, millimetres, scale context, view identity and sufficient room for related constructions |
| Choose the starting view | Start from the view giving useful true shape/length; let the student choose and change construction order |
| Place points and basic geometry | Reliable mouse placement, named numeric fields, dimension entry, explicit view roles, visible snapping and predictable cancellation |
| Project into the related view | Corresponding labels, aligned projectors, deliberate transfer of height/depth, and side-view transfer where required |
| Handle inclination or orientation | Separate initial and final construction states; make copying, auxiliary views and rotations deliberate, undoable operations |
| Finish the drawing | Visible/hidden/centre/construction line types, captions, units, dimensions and optional cleanup without losing working geometry |
| Check understanding | Measures and correspondence checks, honest reconstruction status, optional linked 3D inspection; preserve uncertainty |
| Save and submit | Distinguish device draft, account save, automatic check and teacher review; submit an immutable copy without losing the working attempt |
| Rework feedback | Open the correct attempt, retain the teacher's comments and use a new editable attempt rather than altering a submission |

The order is conditional. For a solid with its base on HP, the top view exposes
the true base shape and supplies the starting construction; other orientations
call for a different starting view. See [NPTEL, projection of solids](https://archive.nptel.ac.in/content/storage2/courses/112103019/module3/lec28/6.html).
In the usual first-angle solid layout, the top view is below the front view and
the right-side view is on its left. See [NPTEL, projection methods](https://archive.nptel.ac.in/content/storage2/courses/112103019/module2/lec15/1.html).
Point-projection exercises in other quadrants can put front and top projections
on the same side of XY; position must not replace an explicit view role. See
[NPTEL, quadrant exercises](https://archive.nptel.ac.in/content/storage2/courses/112103019/module2/lec18/1.html).

### Problem families

- **Points:** distances from HP/VP, quadrant, paired names, coincident
  projections, explicit front/top identity.
- **Lines:** endpoints, projected versus true length, inclination, traces,
  reference and auxiliary constructions; prevent cross-view distance being
  described as true 3D length.
- **Planes:** true shape, edge view, inclined-plane stages, closed boundaries.
- **Solids:** base orientation, height/axis, corresponding vertices and edges,
  hidden-edge interpretation, related views and deliberate inclination stages.
- **Curves, sections and developments:** admit only supported constructions;
  plan dedicated tools, section hatching, transfer and surface development
  separately. An unsupported reconstruction must remain a usable 2D drawing.

## Current canvas audit

Working foundations: point/line/circle tools; typed coordinates, lengths and
radii; linked edits; undo/redo; measurement and dimensions; command/import
validation; view movement and fit; live reconstruction; permitted teacher
references; pose previews; device drafts; account saves; immutable submissions;
action-based lessons; touch inspection restrictions.

The current live wire reader requires a drawn projector linking corresponding
front/top points; matching names and X positions alone are insufficient. Step 4
will make this relationship explicit in the normal tool workflow. The existing
More → Add a projector action creates a helper tagged `meta.kind=projector`,
which the reader excludes; it must not be presented as a correspondence claim
until the helper/claim distinction is resolved and tested.

Problems to resolve in order:

1. Task, current action, coordinate entry, selection properties, 3D and object
   inventory share a single scrolling guide. The model can be far from the
   paper while irrelevant sections compete with the current action.
2. Workspace display preferences do not consistently persist; guide visibility,
   paper, labels, grid and model layout lack one coherent customization model.
3. Drawing-time view identity currently uses the sign of Y for new points;
   explicit role selection is needed before expanding quadrant workflows.
4. Precise inputs and current-step instructions are separate from the pointer.
   Their information should agree and offer recovery without extra explanation.
5. Reconstruction availability does not mean the drawing is correct. Display
   source, missing information, unsupported geometry and teacher verdicts must
   be distinguishable.
6. Existing touch devices support inspection, not authoring. Keep this boundary
   until a separately validated input design can support authoring accurately.

## Non-negotiable interaction rules

- Paper is the dominant surface. Decoration stays outside it. 3D is docked by
  default; a student may explicitly float and position its window over the
  workspace. Focus hides the window, and narrow screens recover docked support.
- No automatic orbit, camera jump, focus steal or automatic model-answer reveal.
- A construction operation has a preview, commit, cancellation and undo boundary.
- Changing workspace preferences changes presentation and optional input aids;
  it never edits stored geometry, units, teacher permissions or verdicts.
- Model orbit, comparison and pose are visually and technically separate from
  changes to a submitted drawing.
- Tool labels, keyboard focus and core recovery actions stay discoverable.
- UI copy is short; actual questions, engineering terms and feedback stay intact.
- Warm Studio typography, square controls, paper rules and all six themes carry
  through. Drawing ink and paper remain readable independently of app theme.

## Step-by-step delivery

### 1. Drawing-first workspace and customization foundation

**Deliver now:** Keep existing tools and geometry behavior. Separate the
scrolling task/tools guide from a bounded live 3D dock. Give guide and 3D
independent visibility. Provide one-click Focus and an always-visible way back.
Offer right/left panels, panel width, model size/visibility, guide visibility,
comfortable/compact interface density, paper palette, labels and label size,
view captions, grid spacing/visibility and optional grid snap. Store normalized,
versioned preferences per student on this device. Provide live customization
preview, Cancel restoration and Reset workspace that leaves geometry intact.
Keep teacher/guest canvas behavior unchanged.

**Done when:** Drawing/undo/save/submit/lesson/review workflows pass; canvas world
coordinates and entities survive every preference change; 3D responds to actual
geometry or an explicitly selected permitted reference; hiding the guide does
not hide 3D or strand the student; Focus can be exited by mouse or keyboard;
preferences persist, isolate accounts and tolerate malformed/unavailable storage;
small screens and six themes remain usable.

### 2. Sheet setup and explicit projection identity

Provide a compact setup tray: assignment-required convention and units, optional
free-work convention, explicit active front/top/profile view, reference axes,
working extents and view placement. Keep first-angle defaults for current
assignments. Support quadrant point tasks with explicit roles. Do not relabel or
transform old drawings silently. Third-angle authoring requires consistent
engine, reference, export and grading support before becoming selectable.

**Done when:** Corresponding points have correct roles regardless of Y sign;
axis/view movement has defined behavior; saved drawings retain their convention;
teacher requirements cannot be overridden accidentally.

### 3. Contextual tool workflow and precise input

Keep common tools visible and expose only the active tool's next action. Specify
first point → second point, centre → radius, selected object → edit, and measure
start → end. Add nonblocking numeric input close to the working area, input
focus/Enter/Escape behavior, valid ranges, live previews, retained values,
selection feedback, readable units, and clear active view. Plan pencil-like
tool indicators without hiding the geometry under the cursor.

**Done when:** Typed and pointer construction agree; errors preserve the current
step; cancel creates no orphan objects; a novice can draw and correct a line
without opening commands.

### 4. Projection and correspondence tools

Introduce deliberate projector and point-pair tools, shared X alignment,
height/depth transfers, side-view/miter transfer and label matching. Show which
existing point is used before commit. Provide optional hints with configurable
strength; never silently snap to a hidden model answer.

**Done when:** Each helper has truthful view semantics, visible dependencies,
one undo unit and no duplicate/coincident-point surprises.

### 5. Editing, selection and construction management

Refine hit targets, overlapping-object choice, selection sets, endpoint versus
whole-object edits, dependent objects, deletion previews, copy/move and history.
Organize working construction stages and object visibility without losing
relationships. Preserve numeric inputs during unrelated model updates.

**Done when:** Students can explain what is selected and what changes with it;
undo restores dependencies and captions; hidden working geometry can be found.

### 6. Engineering finish and measurement

Make visible, hidden, construction and centre line styles understandable with
miniature samples. Refine arrowheads, dimension placement, text, label collision,
precision and units. Clearly separate projected lengths/angles from supported
true spatial measurements. Offer cleanup as reversible presentation/working
operations rather than deleting useful construction automatically.

**Done when:** Dimensions describe the intended geometry and survive edits;
small labels remain legible; export uses technical styles and real scale context.

### 7. 3D that deepens the current construction

Map selected 2D points/edges to supported 3D counterparts and back, with optional
matched emphasis. Explain missing correspondence close to the current task.
Provide chosen front/top/side camera orientations, stable orbit, camera lock,
view reset, wire/surface/hidden-edge choices and optional projection planes.
Keep student's reconstruction, teacher reference and moved preview clearly
identified. Add overlays only for supported correspondence; do not fabricate
faces or a unique solid from ambiguous views.

**Done when:** Paper input remains responsive; updates preserve camera choice
and selection; no geometry is altered by orbit/pose/display; failed or ambiguous
reconstruction produces accurate local guidance and clears stale geometry.

### 8. Optional construction guidance

Offer self-directed, lightly guided and lesson modes. Use conditional sequences
for points, lines, planes and solids; show the current action and a small visual
only where it helps. Let students revisit steps and choose their starting view.
Guidance may recognize a completed action only from actual drawing state.
Teacher-defined stages require structured assignment data before enforcement.

**Done when:** Guidance never awards completion for clicking Next alone or
forces all exercises into the same order; experienced students can reduce it.

### 9. Full customization and reusable workspace profiles

Build on step 1's preference schema rather than introducing scattered keys.
Add saved presets, pinned/reordered tools and panels, adjustable panel/model
sizes, shortcut remapping, coordinate precision, snap tolerance/types, line
display weights, label rules, projection overlays, model rendering/cameras,
accessibility and motion controls. Provide per-workspace overrides, profile
export/import, validated migrations and Reset section/Reset profile. Account
sync remains a separate feature until storage/API support exists.

**Done when:** Profiles are reversible, portable and validated; users can recover
hidden tools; settings do not cross accounts or change submitted geometry.

### 10. Save, recovery, checking and submission

Keep draft/account save status visible at every density and screen size.
Improve retry, offline continuity, draft conflicts and restore previews. Make
Check an optional explicit action; show exactly what it checked. Prepare a
submission review of the actual paper, preserve the student's note and submit a
versioned immutable copy. Make reopening feedback/new attempts predictable.

**Done when:** Network failures or account changes cannot lose or misattribute
work; checking and teacher review remain separate; rework preserves history.

### 11. Export, keyboard, accessibility and device refinement

Refine print/image/JSON exports, appropriate sheet bounds, font sizing, focus
order, screen-reader state, keyboard equivalents, shortcut discoverability,
high contrast, reduced motion and touch inspection. Plan accurate pen/touch
authoring as a separate validated capability, not merely enabling mouse tools.
Handle landscape, zoomed browser, short laptop screens and low-power devices.

**Done when:** Core operations have visible and keyboard paths; focused geometry
is not obscured; exported drawings preserve semantics; interaction stays smooth.

### 12. Student validation and controlled iteration

Observe novices and experienced students doing: a point pair; a line with given
inclination; a plane; a prism; a hidden-edge correction; a failed reconstruction;
save/recovery; submission and rework. Record hesitation, mistakes, recovery,
unnecessary panel switches and whether 3D helped reasoning. Include students
using different screen sizes and accessibility preferences. Change one problem
at a time, retest and document what worked. Do not treat browser checks as proof
of educational benefit.

**Done when:** Students can finish real exercises independently, find recovery,
and explain view correspondence with their own drawings.

## Customization coverage

| Area | Step 1 foundation | Planned extension |
| --- | --- | --- |
| Layout | Guide visibility, Focus, left/right side, width, density | Reorder/pin panels, keyboard resize, per-workspace overrides |
| Tools | Existing visible tools and More retained | Favorites, ordering, custom keyboard map, tool presets |
| Paper | Palette, grid spacing/visibility, view captions | Sheet sizes, extents, scale-aware printing, calibrated display |
| Precision | Optional existing grid snapping | Snap types/tolerance, angle/length constraints, precision profiles |
| Labels | Show/hide, three text sizes | Naming rules, collision/leader options, per-view labels |
| Linework | Existing technical styles preserved | Display weight/color profiles and construction visibility |
| 3D | Independent compact/large/hidden dock, explicit source | Camera lock, saved views, surfaces/wire, planes and linked emphasis |
| Teaching | Existing tasks, hints and real lesson stages retained | Guidance strength, optional workflow stages, teacher structured stages |
| Accessibility | 44-pixel controls, keyboard focus, reduced-motion support | Contrast profiles, text scaling, shortcut and announcement preferences |
| Persistence | Versioned account-scoped device preferences, Cancel/Reset | Named profiles, import/export, migrations and optional account sync |

## Architecture and release checks

- Keep Major 2 UI modules separate from legacy/shared engine source.
- Add narrowly scoped presentation hooks to the drawing controller; the entity
  snapshot stays the geometry source of truth.
- Bound and validate preference values; ignore unknown/prototype fields.
- Dispose listeners/observers and ignore responses after account/navigation changes.
- Test geometric invariants as well as visual layouts: entity snapshots, draft
  state, selected anchors, undo units, submitted copies and grading boundaries.
- Run the classroom browser suite against a disposable database; use isolated
  fixture previews for layout and preference testing. No live account mutations.
- Verify current student routes at 320/390/760/980/1280 pixels, six themes and
  short screens; inspect native pointer/keyboard interactions as well as DOM.
- Record completed scope and remaining limitations after each step. Continue
  with the next numbered step only as a separate deliberate delivery.

## Step 1 delivery record

Delivered: independent task/tools and 3D areas; paper-first layout; Focus and
visible recovery; left/right panels and width; comfortable/compact density;
compact/expanded/hidden model support; four paper palettes; label visibility
and size; view captions; grid visibility/spacing; optional grid-snap spacing;
Guided/Quiet/Technical presets; account-scoped device preferences; live preview,
Cancel/Escape and Reset workspace. Permitted teacher references require an
explicit choice. Student models fit their dock while retaining orbit direction
and user zoom. Dimensions stay readable on dark paper.

The Drawing method selector was restored after the initial delivery: Workspace
→ Drawing method → Draw menu / Shortcuts, with a visible toolbar entry. Shortcuts
supports direct point placement, Ctrl/Cmd-click banking for styled lines and
three-point circles, double-click rename, typed X/Y distances, Escape, model
preview Tab and slash commands. Method changes apply on Save preferences and
cancel only unfinished input. Preview/Cancel preserves the current gesture.
Method remapping and the later contextual-tool refinements remain planned.

An optional floating 3D window was added as a follow-up: Float/Dock in the model
header and Workspace → 3D placement; a separate move handle, resize corner,
minimize/restore, arrow-key movement/resizing and Shift acceleration. Dragging
or resizing the frame preserves the active drawing step and model camera.
Window position, size and minimized state are validated, saved per account on
the device, and recoverable through Reset window position & size. Position uses
bounded workspace-relative values; screens at 760 px or below dock the window
without erasing the saved floating choice. Focus hides it; Move model recovers
hidden/minimized controls. Empty previews stay compact and permitted references
remain explicitly reachable. Student model canvases now accept orbit, wheel/
pinch zoom, arrow keys, +/- and Home independently of frame handles.

Cancel/Escape now resolves preferences immediately, preventing an older dialog's
deferred close event from restoring stale settings. Drawing fingerprints use
the canonical saved entity representation, so undo to identical saved geometry
and successful saves clear draft status accurately.

Line-type choice is also delivered as a focused part of the contextual-tool
roadmap: a toolbar picker with stroke samples for A/B/E/G/K, remembered default,
matching live previews, and pointer/typed-length creation. Changing the type
retains the first endpoint and numeric input. Focus preserves the picker;
keyboard selection, Escape and outside dismissal preserve drawing state.
Shortcut confirmation has consistent names and stroke samples. Other contextual
tools and the remaining numbered stages still need their own delivery.

Validation passed:

- Nine focused browser workflow groups and 144 student canvas layouts across
  six app themes, six viewport sizes, left/right panels, Focus and hidden panels.
- Native pointer construction and snapping; active line-anchor and selection
  preservation; undo, geometry, zoom, drafts and saved drawing reopening.
- Palette-aware dimension text, retained dimensions when point labels are
  hidden, independent model/guide visibility, model bounds, explicit permitted
  references, model orbit/pose and immutable review.
- Account isolation, malformed/versioned preferences, unavailable device
  storage, reversible presets and ignored stale preference saves.
- Full classroom browser suite: 22 workflow groups and 96 existing workspace
  layouts, including actual save/check/submit/review and lessons in a disposable
  database; no uncaught browser errors in either suite.
- JavaScript syntax and exact live/local asset matches for the six changed
  frontend assets. Fixture tests do not write to the live API.
- Drawing-method follow-up: 14 workflow groups and 48 layouts; native point,
  bank, line, circle, rename and distance input; cancellation, persistence,
  field keyboard ownership and immutable review. Canvas/classroom suites were
  rerun successfully after the method restoration.
- Floating-window follow-up: nine focused workflow groups and 168 layouts
  through the T3 collaborative browser. Native clicks checked line construction
  and undo; native keys checked frame movement/resizing and model orbit. Frame
  drag, pinch and wheel handlers were tested with dispatched pointer events and
  temporary capture shims, rather than a native drag automation API. No live API
  writes occurred; the save check uses a local in-memory fixture. Six changed
  frontend assets matched their live bytes. Earlier classroom suites were not
  rerun in this follow-up; their recorded results remain separate.
- Line-type follow-up: seven isolated workflow groups and 30 layouts; all five
  codes in mouse and shortcut construction, actual preview strokes, exact typed
  length, unchanged circles, cancellation, saved work, immutable review and
  popover fallback. Native clicks and keys also verified selection and undo.

See [STUDENT_CANVAS_RESULTS.json](STUDENT_CANVAS_RESULTS.json) for the recorded
results. Steps 2–12 remain planned apart from the line-type follow-up above.
Explicit view roles, projector correspondence,
linked 2D/3D emphasis and accurate touch authoring need their own implementation
and acceptance checks; browser validation does not replace student observation.

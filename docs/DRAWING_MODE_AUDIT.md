# Drawing, Edit, View, and Pose audit

Reviewed and repaired on 2026-10-06 in the working tree, preserving the
existing unrelated edits. **All ten confirmed defects F01–F10 are fixed.**

## Fixes and current verification

- **F01:** gesture state detaches before rollback; history rejects restoration
  re-entry and preserves undo/redo stacks when restoration fails.
- **F02:** the entity table enforces Edit-only mutations. Mode transitions
  cancel previews before freezing the table and rebuild before entering Pose.
  Explicit sheet loads validate first, enter Edit, and discard the previous pose.
- **F03–F04:** commands and restored legacy metadata resolve stable IDs.
  Movement, coordinate editing, and deletion share endpoint ownership rules;
  declared owners take precedence, while legacy coincidence must be unique and
  compatible with the drawing view. Center-only circles/arcs follow their centers.
- **F05–F06:** entity arcs use degrees consistently in measurement, picking,
  and posed copies. Complete linked edits validate before one commit, including
  swaps, partial patches, locked dependencies, circle translations, and rename
  failures. Explicit unchanged coordinates constrain the final graph too.
- **F07–F09:** picking, snapping, and new-point reuse respect visible drawing
  geometry. Shared geometry handles infinite lines, directional rays, arc
  sweeps, and displaced dimensions. Profile ink follows actual connected 3D
  edge portions and splits coincident edges when a pose separates them.
- **F10:** analytic tolerance-capsule interval coverage replaces fixed samples.
  Curves use bounded chord error, and straight segments retain the full stated
  tolerance. Regression cases include gaps on spans up to `1e12` mm.

Verification:

- `npm test`: **1,150 passing checks**, including the new **48** generalized
  drawing regressions. `npm run test:drawing-audit` runs that subset.
- Mounted-app browser suite: **27 passed, 0 failed, 0 browser exceptions**.
  Covers drawing line/circle/polyline/dimension/projector, linked coordinate
  edits, undo/redo, all drag cancellation paths, View/Pose mutation guards,
  immediate Pose entry after editing, invalid loads, explicit replacement,
  hidden guides, and confirmed/cancelled pose gestures.
- Browser results: [DRAWING_MODE_AUDIT_RESULTS.json](DRAWING_MODE_AUDIT_RESULTS.json).

The shared T3 preview returned an explicit unavailable error during repair.
Browser verification used headless Chromium against the actual local app at
`http://127.0.0.1:8124/`, with a disposable guest session. It verifies mounted
client behavior and asset delivery; authenticated server saves, reload
persistence, touch gestures, and every browser/viewport combination are outside
this suite's scope.

To repeat mounted checks, start the app and run
`npm run test:drawing-browser -- http://127.0.0.1:8124/`. This optional runner
needs Playwright and Chromium; `EDUCAD_PLAYWRIGHT_MODULE` can select an existing
installation. Pass a second argument for a JSON output path. The expression
in `tools/test-drawing-audit-browser.js` can also run directly in an automated
preview on a disposable guest sheet with promise awaiting enabled. It replaces
the guest drawing and history and calls no save APIs.

## Historical findings before repair

The initial audit passed 1,102 existing checks but failed all ten new logic
regressions and eight mounted-app regressions. The observations and line
references below describe that pre-fix source snapshot; their reproduction
steps now pass the regression suites above.

P1 denotes crashes, broken geometry/dependencies, incorrect measurements, or
loss of the read-only guarantee. P2 denotes interaction and consistency faults.

| ID | Priority | Area | Confirmed failure |
| --- | --- | --- | --- |
| F01 | P1 | Edit / history | Cancelling a point drag recursively restores history and overflows the stack |
| F02 | P1 | View / Pose | Settings can clear a read-only sheet; Pose then retains stale geometry |
| F03 | P1 | Drawing / Edit | Command and menu tools store incompatible dependency references |
| F04 | P1 | Linked editing | Coordinate coincidence overrides explicit endpoint ownership |
| F05 | P1 | View / Pose | Arc degrees are treated as radians |
| F06 | P2 | Coordinate editor | Valid edits are rejected because intermediate positions collapse geometry |
| F07 | P2 | View selection | Hidden side-view geometry remains pickable |
| F08 | P2 | Edit / View picking | Hit testing disagrees with drawn line, ray, and arc geometry |
| F09 | P2 | Pose / side view | Profile copies join unrelated vertices and fail to split coincident edges |
| F10 | P2 | Three-view validation | Fixed samples miss extra geometry and report false agreement |

## F01 — drag cancellation re-enters its own restore

**Reproduce:** select an unlocked point, drag it more than four pixels, then
press Escape or send `pointercancel`. The browser audit uses `pointercancel`.
It records `Uncaught RangeError: Maximum call stack size exceeded`.

`public/lib/educad-drafting.js:243` calls `history.cancel()` before clearing
`drag`. The history restore callback at `public/index.html:762` calls
`drafting.cancel()`, which sees the same active drag and calls history again.
The pointer-cancel handler at `educad-drafting.js:587` has the same ordering.
`createHistory().cancel()` has no restoration re-entry guard at line 95.

The snapshot can be partially restored before the exception, but gesture
cleanup does not complete reliably. Mode changes and other cancellation paths
share this call chain. The isolated history tests do not use the real restore
callback and therefore miss it.

**General fix:** detach gesture state before restoring, distinguish restoring
geometry from cancelling tools, and make restoration reject re-entry. Check
Escape, pointer cancellation, mode changes, undo, and tool changes through the
same mounted-app callback. Verify that the next independent click works.

## F02 — read-only gates do not cover sheet replacement

**Reproduce:** enter View, open Settings, click Clear Sheet. The enabled control
deletes the table while the mode remains `view`. In Pose, load the 3-view prism
first, then perform the same action. The table becomes empty while the pose
overlay still has **18 edges** and `solidMm` still has **12 vertices**.

`public/index.html:3280` clears/replaces the table without a mode check.
The Clear button calls that loader directly at line 3348. Drawing commands
have a read-only gate, but this UI path bypasses it. Pose reconstruction at
line 3713 returns early, assuming the table cannot change, leaving the old
pose and solid attached to the empty sheet.

**General fix:** enforce authoring permissions at one mutation boundary used
by settings, commands, tutorials, loaders, and asynchronous responses. If
replacing a sheet is an intended action in View, explicitly transition to Edit
before changing it. Invalidate or exit Pose before any table replacement.
Review saved-drawing loading as another replacement path; its server flow was
not exercised here.

## F03 — dependency representation changes with the drawing entry point

**Reproduce:** run `/point c 0 30 elevation`, then `/circle c 10` and
`/arc c 10 0 90`. Moving `c` to `(5,35)` leaves the circle and arc at `(0,30)`.
Deleting `c` leaves both dependent curves behind.

Also create `/point a 0 30 elevation`, `/point b 30 30 elevation`, and
`/line a b`. Editing the line's first endpoint to `(5,35)` reports Updated,
but point `a` remains at `(0,30)`.

Command spans store **names** in `meta.refs` at
`public/lib/educad-command.js:1103`; menu tools store **IDs**. Command curves
store only `refs: [centerName]` at line 1156, while linked circle edits require
`centerRef` and `radiusRef` IDs at `educad-drafting.js:147`. The coordinate
editor resolves references only with `table.get()` at line 518. Cascade
deletion matches IDs at `public/lib/educad-entities.js:455`.

**General fix:** give all drawing entry points a shared stable-ID dependency
schema. A center-defined curve needs a center dependency even when no rim
point exists. Resolve names at command execution, preserve display names as
labels, and migrate saved legacy references. Route rename through the same
linked identity operation instead of the separate command-only update.

## F04 — unrelated coincident points can move explicitly owned edges

**Reproduce:** place two different points `a` and `q` at `(0,20)`, and a point
`b` at `(30,20)`. Create a segment whose explicit refs are `[q.id,b.id]`.
Move only `a` to `(5,25)`. The segment endpoint moves to `(5,25)` even though
`q`, its declared endpoint, remains at `(0,20)`.

`public/lib/educad-drafting.js:137` combines ID/name matching and coordinate
coincidence with `||`. The fallback still applies when explicit refs exist.

**General fix:** explicit dependencies take precedence. Use coordinate
matching only for legacy entities without declared endpoint ownership.
Exercise separate touching shapes, stacked corners, hidden points, locked
dependents, and geometry from different views.

## F05 — arc units disagree across creation, rendering, measurement, and pose

**Reproduce:** `/arc c 10 0 90` produces a correctly rendered quarter-circle.
Its View readout says **900.00 mm, 0.0° to 5156.6°**, instead of
**15.71 mm, 0.0° to 90.0°**. Applying an identity pose changes its stored-copy
end angle from **90** to **2.035405699485789**, which the renderer interprets
as degrees.

Commands and the renderer at `public/index.html:2273` use degrees.
`public/lib/educad-measure.js:136` uses radians for both arc length and angle
formatting. `public/lib/educad-pose.js:403` passes the degree value directly
to sine/cosine, and its output is stored back without conversion at line 585.
The existing measure test creates a radian-valued fixture, masking the mismatch.

**General fix:** establish one entity angle unit, with explicit conversions
at trigonometric boundaries. Use a normalized CCW sweep for wraparound arcs.
Test actual command-created 0→90°, 350→10°, negative-angle, mirrored, and
identity-posed arcs across creation, render copies, and inspection.

## F06 — final-valid edits are validated as sequential moves

**Reproduce:** edit a segment from `(0,20)→(10,20)` to
`(10,20)→(0,20)`. The editor rejects it as coincident. Translate a
center/rim circle from center `(0,30)`, rim `(10,30)`, radius 10 to center
`(10,30)`, rim `(20,30)`, radius 10. The editor reports that the radius is too
small, although the desired circle is valid.

`public/lib/educad-drafting.js:523` and line 531 move the first point in a
temporary table while the second point is still at its old location. The
temporary table prevents partial real-table edits, but incorrectly vetoes
the valid final graph.

**General fix:** collect all intended point positions, propagate dependencies,
then validate the completed graph before a single commit. Include endpoint
swaps, translated circles, and edits of shared endpoints.

## F07 — View picks from a different visibility set than rendering

**Reproduce:** create a side point, disable 3 views, enter View, and click its
former location. `drafting.isVisible(point)` is false, but `inspectId` becomes
that hidden point's ID. The automated test uses Alt-click to inspect the sheet
without interference from the 3D aura.

Rendering uses `drafting.isVisible()` at `public/index.html:2051`.
`liveEntities()` at line 1014 only excludes stored loci, and
`viewClickInspect()` at line 1779 passes that broader list into picking.

**General fix:** share the visible-entity predicate between rendering, picking,
snapping, inspection, and highlighting. Verify disabled side views and hidden
projection guides, in addition to `entity.visible === false`.

## F08 — selection geometry disagrees with rendering geometry

**Reproduce:** define LINE/RAY from `(0,20)` to `(10,20)`, then click `(50,20)`.
The visible extension is not selectable. For a 0→90° arc, clicking its absent
left-hand rim still selects it. Its empty center also selects it even when the
arc is large.

`public/lib/educad-measure.js:202` clamps every two-point entity to a segment.
Its round branch at line 218 treats arcs as full circles and always scores
the center, despite the comment describing this as a tiny-circle convenience.
The drafting layer delegates its primary hit test to this same function.

**General fix:** dispatch picking by entity geometry: unlimited parameter for
LINE, nonnegative parameter for RAY, bounded parameter for SEGMENT, and sweep
membership for arcs. Limit center picking to small round geometry. Use screen
tolerance consistently across zoom levels and include reversed endpoints.

## F09 — side-view pose copies ignore edge connectivity

**Reproduce:** load `/demo 3view`, apply a 30° Z rotation plus enough Y/Z
translation to clear the datum. Profile rider copies for `pf-b` and `pf-t`
do not match any projected real edge. `pf-R`, `pf-L`, and `pf-facet` each
represent two real edges at rest, but only produce one posed copy.

`public/lib/educad-drafting.js:777` chooses the first matching vertex for each
endpoint independently. Those vertices can belong to different edges. It
also emits only one segment when coincident projections separate under pose.
The exact overlay remains derived from real edges, so the faint rider ink can
contradict it.

**General fix:** bind side entities to real vertex/edge identities, generate
copies only from connected endpoint pairs, and split coincident edge readings
as needed. Use the same correspondence machinery for all enabled projections.
Preserve or split corner captions with those bindings.

## F10 — fixed samples can falsely certify profile agreement

**Reproduce:** expected profile edges cover horizontal intervals `[0,4.4]`
and `[4.8,10]`. Draw one full `[0,10]` segment. With the 100 mm profile
reference, the validator returns **ok**, even though the drawing bridges the
0.4 mm missing interval and exceeds the 0.15 mm tolerance there.

`public/lib/educad-drafting.js:168` checks just 13 fixed positions. The gap
falls between them, and the reverse coverage pass does not detect the extra ink.

**General fix:** compare interval coverage analytically for straight edges,
or use tolerance-bounded adaptive subdivision for curves. Check both missing
and extra coverage. Scale the sampling resolution to the geometric error
tolerance rather than the number of endpoints.

## Shared improvements and next test matrix

Prioritize F01–F05. The recurring architectural problem is that authoring,
rendering, picking, measurement, dependencies, and modes each own slightly
different representations of the same drawing.

1. Use stable IDs and a shared dependency graph across menu drawing, commands,
   scripts, demos, and saved sheets. Apply complete mutations atomically.
2. Define mode transitions centrally, including cancellation, table replacement,
   and invalidation of pose/reconstruction caches.
3. Share entity geometry and visibility rules across drawing, picking, bounds,
   validation, and measurement. State angle units in the entity contract.
4. Add mounted-app tests alongside pure geometry tests. Wiring/string-presence
   assertions cannot catch callback recursion or mismatched module contracts.

Extend coverage across these dimensions after the confirmed failures are fixed:

| Dimension | Cases |
| --- | --- |
| Drawing entry | Draw menu, typed distance, commands, demo, script, restored snapshot |
| Geometry | Point, segment, polyline, LINE, RAY, circle, wrapping arc, dimension |
| Correspondence | Front/top/side, multiple stacked corners, touching independent shapes |
| Gesture lifecycle | Confirm, Escape, pointercancel, right-click, mode change, undo/redo |
| Mutability | Locked point, locked dependent edge, hidden entity, hidden guide, disabled side |
| Viewport | Minimum/maximum zoom, resize, narrow viewport, high DPI, fit with distant geometry |
| Pose | Identity, translation, rotation, scale, mirrored/collapsed projection, coincident-edge split |

Touch/pointer capture, narrow layouts, and very large drawings remain follow-up
coverage; they were reviewed as risks, not presented as confirmed failures.

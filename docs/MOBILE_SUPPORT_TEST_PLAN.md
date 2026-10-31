# Mobile View/Pose support

Implemented in `public/lib/educad-mobile.js`, `public/css/educad-mobile.css`,
and the sheet's existing mode, rendering, loader, and input bridges.

## Behavior

Touch-only phones and tablets start in View. Pose is available when the sheet
reconstructs a model. Edit, drawing commands, rename, Clear, authoring tutorials,
save/delete, model attachment, grading, and submission remain guarded. Demos
and saved drawings are allowed and load into View, including when another drawing
is being posed. Invalid loads preserve the sheet. Pose is an ephemeral preview;
leaving it restores the original drawing without creating an undo entry.

The restriction is based on input capabilities at page load, independently of
screen size. A primary or secondary fine pointer keeps Edit available. Adding a
mouse during an inspection session requires a reload to change capabilities.
Narrow desktop windows use the compact layout while retaining Edit.

Portrait places 3D above the combined elevation/plan sheet; landscape places
panes side by side. The divider uses 8px of layout space and a 44px invisible drag area, with
keyboard arrow support. Plain text Fit/Expand actions overlay canvas edges
instead of allocating toolbar rows.
Each pane has Fit and Expand; expanded panes can switch or return to both.
Rotation and viewport resizing preserve drawing, mode, pose, the sheet's world
center, and camera navigation. Mode changes fit the drawing into the space left
by the Pose dock. Hidden canvases keep their last dimensions.

The compact header exposes View/Pose and More. Inspection details occupy a
collapsible bottom sheet. Pose keeps Move/Rotate, X/Y/Z, and slider/numeric entry in two rows. More
contains Snap, Reset pose, and a Scale disclosure under Pose options, plus
Reset 3D camera under Display. The docks scroll independently and
reserve canvas space when both are open. Fit padding adapts to small panes.
The layout uses viewport safe areas and visualViewport height.

Sheet gestures: one finger pans, two fingers pan/pinch, tap inspects, close
points offer a chooser. 3D gestures: one finger orbits, two fingers pan/pinch,
tap inspects. Pose gestures only navigate the camera; model transforms use
explicit controls and existing projection/datum clamp math. Gesture ownership
remains with its starting pane, including additional pointers. Drag, long press,
cancel, lost capture, and synthetic clicks cannot author ink.

## Run the automated checks

- `npm test`: full repository suite, including the zero-dependency mobile tests.
- `npm run test:mobile`: mode, pose/datum, camera, viewport, pick, history,
  input detection (including hybrid pointers), fit, layout, tracker, and
  Node-safe shell checks. Eighteen groups.
- `npm run test:login`, `npm run test:saves`, `npm run test:lab`: session,
  saved-drawing, and question-set integration checks.

The mounted-browser suite is `tools/test-mobile-browser.js`. Run its entire
trimmed expression through T3 `preview_evaluate` with `awaitPromise: true` on
a disposable guest sheet. It replaces drawing/history fixtures and makes no
server writes. Its 28 checks cover desktop compatibility, mobile restrictions,
loaders, menu, XY/projectors, divider/expand, touch inspection/navigation,
cancellation, Pose controls/clamping/restoration, dynamic dock sizing, and Fit.
Inapplicable checks report SKIP with their precondition; they are not passes.

T3 viewport presets resize the page without changing pointer capabilities.
For touch-only checks, first navigate a fresh guest page, resize it, then run
`tools/prepare-mobile-preview.js` once through `preview_evaluate`. Wait for
`#mobile-header button[aria-label='View mode'][aria-pressed='true']` before
running the suite. The preparation script simulates pointer media queries and
touch points and fetches fresh assets. It is confined to that browser tab.
Do not run preparation repeatedly without navigating again: document.open
retains old window listeners. Resize the prepared page normally for rotation.

An optional standalone Chromium runner is provided for CI/manual reuse:

```sh
npm run test:mobile-browser -- http://127.0.0.1:8124/ /tmp/mobile-results.json
```

It requires an independently installed Playwright and Chromium; neither is an
app dependency. `EDUCAD_PLAYWRIGHT_MODULE` can point to that installation.
The runner creates isolated guest contexts with native touch emulation for
six viewport scenarios. It was not used for the results below.

## Verified on 2026-10-07

T3 collaborative Chromium preview, with simulated touch capabilities and
synthetic PointerEvents on touch scenarios:

| Scenario | Viewport | Passed | Failed | Inapplicable |
| --- | --- | ---: | ---: | ---: |
| Desktop, fine pointer | 1280 × 800 | 8 | 0 | 20 |
| Narrow desktop, fine pointer | 390 × 844 | 21 | 0 | 7 |
| Phone portrait | 390 × 844 | 25 | 0 | 3 |
| Phone landscape | 844 × 390 | 25 | 0 | 3 |
| Small phone | 320 × 568 | 25 | 0 | 3 |
| Touch tablet | 1024 × 768 | 25 | 0 | 3 |

At 390 × 844, the two canvases occupy 746px (88.4%) of vertical space in
View and 657px (77.8%) in Pose. Pane actions reserve no toolbar rows; the
divider grip is 2px thick within an 8px layout strip. Its invisible 44px
drag area is checked with browser hit testing.

The existing desktop drawing browser audit also passed all 28 checks. A
separate portrait-to-landscape check with an active translation verified
unchanged table JSON, pose projections, mode, world center, and camera angles,
scale, and center offset. Detailed results are saved in
`docs/MOBILE_SUPPORT_BROWSER_RESULTS.json`.

## Physical-device checks still needed

These results do not establish Safari compatibility or physical-device UX.
On iOS Safari and Android Chrome, check:

1. Guest/login and opening a real saved drawing or question model land in View;
   permission-protected account actions still behave correctly.
2. Portrait/landscape, browser URL-bar changes, notch/home safe areas, and the
   numeric keyboard keep controls reachable. Open details and Scale together;
   scroll each dock and expand either pane on a short screen.
3. Use real fingers to pan, pinch, orbit, inspect overlapping points, cross the
   divider during a gesture, add a third finger, and interrupt by leaving the
   app. The next gesture should work without a stuck pointer or accidental tap.
4. Move/rotate on each axis, Snap, Scale, datum contact, Reset pose, and View
   restore accurate projections without changing saved geometry or history.
5. A touchscreen laptop or a tablet loaded with a mouse/trackpad retains Edit;
   an already open touch-only session stays restricted until reload.

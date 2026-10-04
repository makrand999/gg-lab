# EduCAD User Manual

Complete user manual for EduCAD, the first-angle Monge-projection teaching CAD.
Written for students, teachers, and self-learners of engineering drawing.
No prior CAD knowledge is assumed. Developers should read the main manual first,
then the [Appendix](#13-appendix-developer-reference).

> Scope: every label, key, number, and behavior below was traced to the app
> source or its tests. Anything that could not be verified is marked
> `[unverified]` with an explanation. There are no invented features here:
> things the app does *not* do are listed in
> [Limitations](#12-limitations--not-implemented).

## Contents

1. [What EduCAD is](#1-what-educad-is)
2. [Quick start: your first drawing in 5 minutes](#2-quick-start-your-first-drawing-in-5-minutes)
3. [Interface tour](#3-interface-tour)
4. [Drawing, tool by tool](#4-drawing-tool-by-tool)
5. [Editing and housekeeping](#5-editing-and-housekeeping)
6. [Precision: snapping, axis lock, zoom, line weights](#6-precision-snapping-axis-lock-zoom-line-weights)
7. [Views and planes](#7-views-and-planes)
8. [The 3D view](#8-the-3d-view)
9. [Demos and lessons](#9-demos-and-lessons)
10. [Reference tables](#10-reference-tables)
11. [Troubleshooting](#11-troubleshooting)
12. [Limitations / not implemented](#12-limitations--not-implemented)
13. [Appendix (developer reference)](#13-appendix-developer-reference)

### How do I …? (goal index)

| Goal | Go to |
|------|-------|
| Draw a point | [§4.1 place point](#41-place-point-click-empty-sheet) |
| Draw a line between two points | [§4.3 line tool](#43-line--segment-ctrlclick-p1-click-p2-pick-bis-type) |
| Delete a point | [§5.5 deleting](#55-deleting) |
| Draw a box from scratch | [§4.8 box recipe](#48-recipes-draw-a-box-and-a-pyramid-by-hand) |
| Draw a pyramid from scratch | [§4.8 pyramid recipe](#48-recipes-draw-a-box-and-a-pyramid-by-hand) |
| Make the 3D view work | [§8.6 live 3D rules](#86-how-the-3d-view-reads-your-drawing-user-language) |
| Read a 3D failure message | [§8.8 empty states](#88-empty-states-user-language) |
| Move or zoom the sheet view | [§6.4 zoom](#64-zoom-behavior) |
| Show the grid | [§3.4 sheet](#34-the-sheet-itself) |
| Rename a label | [§5.3 rename](#53-rename-double-click-then-keys) |
| Cancel a tool or selection | [§5.2 deselect](#52-deselect-right-click--escape) |
| Draw at an angle and distance | [§4.5 polar point](#45-polar-point-angle--distance-from-an-anchor) |
| Place a point measured off a line | [§4.6 plotting](#46-line-referenced-plotting-perpendicular-offset-point) |
| Load a demo lesson | [§9.1 demos](#91-demo-buttons-guided-walkthroughs) |
| Log in or continue as guest | [§3.8 login](#38-login-session-chip-and-desktop-gate) |
| Create a class (teacher) | [§3.10 classes](#310-classes-and-question-sets-teachers-post-students-submit) |
| Join a class (student) | [§3.10 classes](#310-classes-and-question-sets-teachers-post-students-submit) |
| Review a submitted sheet | [§3.10 inspect](#310-classes-and-question-sets-teachers-post-students-submit) |
| Grade my hidden verdicts | [§9.3b Check](#93b-competing-points-verdicts-and-check) |
| Replay a guided tutorial | [§9.4 square](#94-tutorial-square-scripted-user) · [§9.5 prism](#95-tutorial-prism-scripted-user) |
| Measure without editing anything | [§3.9 modes](#39-edit-and-view-modes) |
| Draw without the mouse | [§3.11 command line](#311-command-line--and-settings) |
| Describe a drawing in words | [§3.12 plain words](#312-plain-words---and-teacher-auto-draw) |
| Preview a part turned another way | [§3.13 pose mode](#313-pose-mode-blender-moves-live-2d-views) |

### Topic index (the whole manual on one screen)

First visit? Read §1, §2, then pick a goal above. Coming back? Jump straight
to the topic — every subsection is one click away:

- [1. What EduCAD is](#1-what-educad-is): [run](#how-to-run-the-app) ·
  [browsers](#browser-requirements)
- [2. Quick start](#2-quick-start-your-first-drawing-in-5-minutes) — first
  drawing in 5 minutes, no subsections
- [3. Interface tour](#3-interface-tour): [status](#31-status-hud-top-left) ·
  [demo bar](#32-demo-bar-top-right) · [zoom](#33-zoom-hud-bottom-right) ·
  [sheet](#34-the-sheet-itself) · [popups](#35-popups) · [3D
  overview](#36-the-3d-view-floating-ink-on-glass) · [layout
  diagram](#37-layout-diagram-from-the-real-domcss) · [login &
  desktop gate](#38-login-session-chip-and-desktop-gate) ·
  [modes](#39-edit-and-view-modes) ·
  [command line](#311-command-line--and-settings) ·
  [plain words](#312-plain-words---and-teacher-auto-draw) ·
  [pose mode](#313-pose-mode-blender-moves-live-2d-views)
- [4. Drawing](#4-drawing-tool-by-tool): [point](#41-place-point-click-empty-sheet) ·
  [select](#42-select-click-a-point) · [line](#43-line--segment-ctrlclick-p1-click-p2-pick-bis-type) ·
  [line-type popup](#44-line-type-bis-sp-46-popup) ·
  [polar](#45-polar-point-angle--distance-from-an-anchor) ·
  [plotting](#46-line-referenced-plotting-perpendicular-offset-point) ·
  [not in the UI](#47-not-reachable-from-the-ui-read-before-searching) ·
  [box & pyramid recipes](#48-recipes-draw-a-box-and-a-pyramid-by-hand) ·
  [circle](#49-circle-from-three-points-bank-two-click-third)
- [5. Editing](#5-editing-and-housekeeping): [selection](#51-selection) ·
  [deselect](#52-deselect-right-click--escape) ·
  [rename](#53-rename-double-click-then-keys) ·
  [auto-naming](#54-auto-naming-rules) · [deleting](#55-deleting) ·
  [hover](#56-hover-behavior) · [cannot do](#57-what-you-cannot-do-recap)
- [6. Precision](#6-precision-snapping-axis-lock-zoom-line-weights):
  [snapping](#61-object-snapping-always-on-no-toggles) ·
  [axis lock](#62-axis-locked-placement) ·
  [tolerances](#63-tolerances-that-matter) · [zoom](#64-zoom-behavior) ·
  [line weights](#65-cosmetic-zoom-invariant-line-weights)
- [7. Views and planes](#7-views-and-planes):
  [two views](#71-the-sheet-is-two-views-glued-at-xy) ·
  [invariant](#72-the-invariant-for-beginners) ·
  [quadrants](#73-quadrant-behavior-including-q3q4-negatives) ·
  [first angle](#74-what-first-angle-means-on-this-sheet) ·
  [view roles](#75-view-roles-under-the-hood-one-paragraph)
- [8. The 3D view](#8-the-3d-view): [where](#81-where-it-is) ·
  [orbit / zoom / pan](#82-orbit-zoom-pan-reset) ·
  [pen look](#83-pen-sketch-look-and-hidden-edges) ·
  [aura](#84-the-aura-pointer-routing) ·
  [live update](#85-live-update-behavior) ·
  [live 3D rules](#86-how-the-3d-view-reads-your-drawing-user-language) ·
  [curves](#87-curve-limitation-user-language) ·
  [empty states](#88-empty-states-user-language)
- [9. Demos and lessons](#9-demos-and-lessons):
  [demos](#91-demo-buttons-guided-walkthroughs) ·
  [console lessons](#92-curriculum-lessons-the-full-set) ·
  [teaching scripts](#93-teaching-scripts-follow-verbatim) ·
  [verdicts & Check](#93b-competing-points-verdicts-and-check) ·
  [tutorial square](#94-tutorial-square-scripted-user) ·
  [tutorial prism](#95-tutorial-prism-scripted-user)
- [10. Reference](#10-reference-tables): [mouse](#101-mouse-actions) ·
  [keyboard](#102-keyboard-shortcuts) · [tools](#103-tool-summary) ·
  [entities](#104-entity-types) · [messages](#105-status-and-message-strings) ·
  [snap tiers](#106-snappable-geometry)
- [11. Troubleshooting](#11-troubleshooting) ·
  [12. Limitations](#12-limitations--not-implemented) ·
  [13. Appendix](#13-appendix-developer-reference):
  [modules](#131-module-map) · [anchors](#132-behavior-anchors-fileline) ·
  [traceability](#133-traceability-table-manual-claim--anchor)

### Words you need (jargon, defined once)

| Term | Meaning in this manual |
|------|------------------------|
| VP | Vertical plane. The plane you face. Its drawing is the **elevation** (front view), normally drawn **above** the XY line. |
| HP | Horizontal plane. The floor. Its drawing is the **plan** (top view), normally drawn **below** the XY line. |
| XY (ground line) | The horizontal line across the sheet at `y = 0 mm` where VP meets HP. Everything is measured from it. |
| Elevation | Front view: a point `(x, h)` where `h` is height above HP. |
| Plan | Top view: a point `(x, -d)` where `d` is depth in front of VP. |
| Projector | A vertical line joining the plan and elevation of the *same* 3D point. It is vertical because of the invariant below. |
| Locus | A horizontal line on which a point is known to lie (e.g. "locus of b"). |
| TL | True length: the real 3D length of a line, as opposed to its shorter plan/elevation appearances. |
| First angle | The layout rule: the object sits between you and the planes, so the **plan goes below XY** and the **elevation goes above XY**. EduCAD always uses first angle. |
| BIS SP 46 | The Indian drafting standard for line types (continuous thick/thin, dashed, chain, …). EduCAD styles sheet lines with it. |
| Sheet | The whole drawing canvas. One millimetre on the sheet model is one `mm` in the app, at any zoom. |

---

## 1. What EduCAD is

EduCAD is a small teaching CAD for **first-angle Monge projection** — the classic
two-view engineering-drawing sheet with a front view (elevation) and a top view
(plan) of the same object, drawn together so you can read 3D shape off 2D views.

- **One sheet, two views.** The upper half of the sheet (above the XY ground
  line) is the VP elevation; the lower half (below XY) is the HP plan.
- **Millimetre world.** Every coordinate is stored in **mm**. Zooming never
  changes the stored geometry; screen pixels are only a temporary rendering.
- **The projector invariant.** The elevation and plan of the same point always
  share the same x-coordinate: **elevation.x == plan.x**. On the sheet this is
  why projectors are exactly vertical. The app checks this invariant with a
  tolerance of `1e-9` mm.
- **A live 3D sketch.** A transparent full-window 3D layer reconstructs a wireframe
  from your two views every time the drawing changes, or tells you plainly why
  it cannot (see [The 3D view](#8-the-3d-view)).
- **Zero npm dependencies, no frameworks.** The app is static files plus
  a C++ server (one CMake build; httplib/JSON/SQLite vendored, libsodium
  from the system). (The in-app manual page is a generated file:
  `mirror/manual.html` is built from `docs/MANUAL.md` with
  `npm run build:manual`.)

### How to run the app

1. Open a terminal in the repository root.
2. Start the server: `npm start` (first run compiles the C++ backend).
3. Open **http://127.0.0.1:8124/** in your browser.
4. Log in: pick the **Academics**, **Teacher**, or **Student** tab and enter
   its demo account (shown on the page), or choose **Continue as guest**
   (guest skips the server entirely). Without a session the app sends you
   back to this login page.

What to expect:

- The server prints `educad serve http://127.0.0.1:8124/ -> <repo>/mirror`.
- If port 8124 is busy, the server picks the next free port (up to 10 tries)
  and prints `educad serve: port 8124 busy, using <port>` — open the URL it
  prints instead. You can also force a port: `npm start -- <port>` or
  `PORT=<port> npm start`.
- The server binds to localhost only; it serves the `mirror/` folder plus
  the JSON API. Stop it with `Ctrl+C` when you are done.
- The **Manual** button in the demo bar (top-right) opens this guide in a
  new tab at `manual.html`.
- Touch-only phones and small tablets get a **Desktop required** overlay
  instead of the canvas, with a link to the tutorials sheet (§3.8).

Demo accounts (also printed on the login page itself):

| Role | Username | Password |
|------|----------|----------|
| Academics | `academics` | `admin123` |
| Teacher | `teacher` | `teach123` |
| Student | `student` | `learn123` |

### Browser requirements

The page needs JavaScript, Canvas 2D, Pointer Events, `requestAnimationFrame`,
and `localStorage` (for the login session); any recent desktop browser
provides these, and the sheet was smoke-tested in one via the project's
obscura harness. Touch/pen input on desktop, specific browser versions, and
the exact phone overlay behavior are `[unverified]` — the desktop gate
traced to source blocks touch-only small screens, but no phone was tested,
so teach from a desktop or laptop.

---

## 2. Quick start: your first drawing in 5 minutes

Once past the login page, the app opens with the **Line Rotation** demo
already loaded (or with a demo chosen by the page address — see
[Demos](#9-demos-and-lessons)). Do this:

1. **Look at the sheet.** The horizontal line across the middle is the XY
   ground line (`y = 0 mm`). Labels above it read `V.P. (Front View /
   Elevation)`; below it, `H.P. (Top View / Plan)`.
2. **Clear the sheet.** Click **Clear Sheet** (top-right demo bar). The sheet,
   the labels, and the 3D view all empty together.
3. **Draw a point.** Left-click anywhere on the empty sheet. A dot appears with
   the label `a`. Click again a little to the right (farther than 14 px from
   `a`, or the click just re-selects `a`): a second dot labelled `b`. Each
   click places one point, named automatically.
4. **Join them with a line.** Hold **Ctrl** and left-click point `a` (the
   cursor turns into a crosshair). Release **Ctrl**, then left-click point
   `b`. A small popup appears showing line-style previews. Click the first
   (solid thick) preview. A short animation draws the segment `a–b`.
5. **Rename a point.** Once the animation finishes, double-click point `a`,
   type `P1`, and press **Enter**. The label updates on the sheet.
6. **See it in 3D.** Look at the 3D wireframe floating over the sheet
   (it rests in the top-right). With two free clicks it shows
   `3D unavailable`: the dots are auto-named `a` and `b`, and different
   names never pair — and placing a point never selects it, so neither
   click was axis-locked either.
   For the guaranteed demo, click **Clear Sheet**, place one point above
   XY, click it to select it (amber ring), then move straight below it
   until the vertical axis-lock badge `ΔY: … mm` appears — the new point's
   x is now locked to the selection (`index.html:885-893`) — and click.
   Now double-click the lower dot and rename it to match the upper dot's
   caption (type the same letter, Enter). The 3D view shows the pair as
   one 3D point. Drag on the ink to orbit it.
7. **Pan and zoom.** Drag with the **middle mouse button** (or
   **Shift + left-drag**) to pan. With the cursor over the sheet, roll the
   **mouse wheel** to zoom at the cursor (on 3D ink the wheel zooms
   the solid instead; middle-drag on ink slides the solid around).
   Click **Home** (bottom-right) to reset the 2D view.

You now know the whole loop: click to place, Ctrl+click to connect,
double-click to rename, right-click or **Escape** to cancel anything.

---

## 3. Interface tour

There is **no toolbar or tool palette** — drawing actions are mouse
gestures directly on the sheet (see [Drawing](#4-drawing-tool-by-tool)),
or typed slash commands (see [§3.11](#311-command-line--and-settings)).
The visible chrome is: one status box, one demo bar, one command line, one
session chip, three zoom buttons, five popups, sheet watermarks, and the
floating 3D wireframe (plus the login page and the desktop-only gate in
front of it all, §3.8).

### 3.1 Status HUD (top-left)

A white rounded box showing, on two lines:

- Line 1: **EduCAD 2D Engine** • **1st Angle Monge Projection** • a plane pill.
- Line 2: the live cursor coordinates, e.g. `X: 12.34 mm • Y: -56.78 mm`.

The pill starts as `VP (Elevation)` and the coordinates start as
`X: 0.00 mm • Y: 0.00 mm (Ground Line XY)`. As soon as you move the mouse,
they switch to live values: the pill reads **`V.P. (Elevation / Front)`**
when the cursor is at or above XY (`y >= 0`) and **`H.P. (Plan / Top)`**
when it is below XY, with matching indigo/amber pill colors. The box ignores
mouse clicks (it never steals a drawing click).

### 3.2 Demo bar (top-right)

Eleven buttons plus the Edit/View/Pose mode trio (fourteen controls in one row):

| Button (exact label) | What it does |
|----------------------|--------------|
| `Line Rotation (TL=80, θ=30°, φ=45°)` | Loads the inclined-line lesson. Active (blue) on first load. |
| `Quadrant Points (1st & 3rd)` | Loads two quadrant-point lessons (Q1 + Q3). |
| `Hexagonal Prism (35mm)` | Loads the hexagonal-prism solid lesson. |
| `3-View Prism (35mm)` | Loads the three-view prism lesson (plan + elevation + profile side view with projectors and miter). |
| `Profile Square (40mm)` | Loads the edge-on square lesson (both views show lines; 3D lifts wire until claims face it). |
| `Tutorial: Square` | Replays the square lesson click by click, with narration (see §9.4). |
| `Tutorial: Prism` | Replays the hexagonal-prism lesson click by click, with narration (see §9.5). |
| `Clear Sheet` | Deletes every entity, cancels every tool, empties the 3D view. Never stays highlighted. |
| `Check hidden` | Grades your hidden verdicts and projector claims against the loaded demo. Never clears the sheet. |
| `Edit` | Drawing mode (default, blue on load): every click draws, selects, banks, or renames. |
| `View` | Read-only measure mode: clicks inspect one entity at a time instead of editing (see §3.9). |
| `Pose` | Pose mode: Blender-move the 3D model, watch 2D ghosts follow (see §3.13). |
| `Settings` | Opens Settings → Preferences: command preview, suggestions, history, demos, tutorials, coordinates (see §3.11). |
| `Manual` | Opens this guide in a new tab at `manual.html`. |

Clicking a demo also clears whatever you drew before it. See
[Demos](#9-demos-and-lessons) for guided walkthroughs. (`Manual` is a plain
link, not a demo: it never highlights and never clears the sheet.)

### 3.3 Zoom HUD (bottom-right)

Three small buttons pinned to the bottom-right corner of the sheet:

| Button | Effect |
|--------|--------|
| `+` | Zoom in ×1.25 about the sheet center. |
| `-` | Zoom out ÷1.25 about the sheet center. |
| `Home` | Reset to scale 2.0 px/mm centered on the sheet. |

### 3.4 The sheet itself

- **XY ground line.** A dark horizontal line at `y = 0 mm`, with a knockout
  `X` at the left edge and `Y` at the right edge.
- **Watermarks.** Dim grey text on the sheet: `V.P. (Front View / Elevation)`
  just above XY (starting 40 px from the left edge) and
  `H.P. (Top View / Plan)` just below XY.
- **Grid (optional, off by default).** Right-click empty sheet and choose
  `Box Mesh` to show a light grid; choose `Plain (No Mesh)` to hide it again.
- **Points** are filled dots (3 px) with italic serif labels (`a`, `a'`, …).
- **Segments/lines** draw in their BIS style; points also show a live snap
  ring and an amber selection ring — see [Precision](#6-precision-snapping-axis-lock-zoom-line-weights)
  and [Editing](#5-editing-and-housekeeping).

### 3.5 Popups

1. **Sheet menu.** Right-click empty sheet space (no selection, no active
   tool, cursor farther than 14 px from any snap target — endpoint, crossing,
   midpoint, or center): a two-option menu with `Plain (No Mesh)` and
   `Box Mesh`. The chosen option is recorded in the menu markup; the
   stylesheet draws no visible checkmark, so use the grid on the sheet itself
   as your confirmation. (Right-clicking near a bare edge mid-span, with no
   snap target within 14 px, still opens the menu.)
2. **Line-type popup.** After Ctrl+clicking point P1 and clicking point P2, a
   popup shows five rendered dash previews (no text in the rows). Hovering a
   row shows its tooltip: `Continuous Thick — Type A`, `Continuous Thin —
   Type B`, `Dashed Thin — Type E`, `Chain Thin — Type G`, `Double-Dash
   Chain — Type K`. Click a preview to draw that BIS line type. (Type H is
   not offered here.)
3. **Dot picker popup.** Ctrl+clicking a spot where two or more *distinct*
   dots coincide asks `Bank which dot?` — pick one (nearest first). Banking
   never asks which corner: correspondence is declared by drawn Type G
   projectors (§9.3b), graded by Check; anything but a pick dismisses it.
4. **Check report panel.** Pressing `Check hidden` grades the sheet and shows
   one row per verdict/claim: pass, fail naming the flipped member or
   mismatched foot, or *unverifiable* off-demo. Dismiss with × or by loading
   a demo.
5. **Tutorial stepper panel** (bottom-left). `Tutorial: Square` / `Tutorial:
   Prism` replay their lesson one real user action per **Next**, with one
   line of narration per step (32 / 88 steps). **Back** re-reads only,
   **Restart** replays from step 1, **Exit** (or any demo button) closes it
   and leaves the sheet yours.

### 3.6 The 3D view (floating ink on glass)

A transparent sheet over the whole window carries your drawing as a
pen-style 3D wireframe (resting in the top-right), or a two-line
`3D unavailable` message explains what to fix. There is no widget box:
the model only listens to the mouse in an *aura* hugging the drawn
lines — everywhere else the sheet works as if the 3D layer were not
there. Full details in [The 3D view](#8-the-3d-view).

### 3.7 Layout diagram (from the real DOM/CSS)

```
┌────────────────────────────────────────────────────────────────┐
│ Status HUD (top-left, above all)        Demo bar (top-right)   │
│ ┌────────────────────────────────────┐  ┌────────────────────┐  │
│ │ EduCAD 2D Engine • 1st Angle ...   │  │ Line Rotation ...  │  │
│ │ [V.P. (Elevation / Front)]         │  │ Quadrant Points... │  │
│ │ X: 12.34 mm • Y: -56.78 mm         │  │ Hexagonal Prism... │  │
│ └────────────────────────────────────┘  │ 3-View Prism...    │  │
│                                         │ Profile Square...  │  │
│                                         │ Tutorial: Square   │  │
│                                         │ Tutorial: Prism    │  │
│                                         │ Clear Sheet        │  │
│                                         │ Check hidden       │  │
│                                         │ Edit · View (mode)  │  │
│                                         │ Manual             │  │
│                                         └────────────────────┘  │
│  Sheet canvas (full window, two stacked layers)                 │
│   V.P. (Front View / Elevation)  ← watermark above XY          │
│  X────────────────────────────────────────────────────────Y    │
│   H.P. (Top View / Plan)  ← watermark below XY                 │
│                                                                │
│   entities · snap/selection rings · previews · labels          │
│                                                                │
│   3D Solid glass (full window, above sheet, below chrome):      │
│   floating wireframe / 3D unavailable, aura-only input         │
│                                                                │
│   Session chip (bottom-left):            Zoom HUD (bottom-right)│
│   ┌───────────────────┐                   ┌───────────────┐    │
│   │ Guest (guest)     │ right-click menu  │  +  │  -  │Home│    │
│   │ [Logout]          │ (at cursor)       └───────────────┘    │
│   └───────────────────┘ + tutorial stepper (above chip)        │
└────────────────────────────────────────────────────────────────┘
```

Positions: status HUD `top:12px left:12px`; demo bar `top:12px right:12px`;
session chip `left:12px bottom:12px`; zoom HUD `right:8px bottom:8px`;
3D glass covers the window (z-index 2, above the sheet layers, below HUD
chrome; `pointer-events:none` except the wireframe aura); the cursor popups
open near the pointer and are clamped inside the window; the mobile
`Desktop required` overlay (§3.8), when active, covers everything and
freezes the app behind it.

### 3.8 Login, session chip, and desktop gate

Three things stand around the sheet itself:

- **Login page.** Opening the app without a session redirects to
  `login.html` before any canvas loads. Pick a role tab (Academics /
  Teacher / Student), enter that tab's demo account, and the server checks
  it against its demo list; **Continue as guest** skips the server and
  signs you in as `Guest (guest)`. Each role lands on its own home:
  teachers (and academics) on the **Teacher studio** (`teacher.html`),
  students on the **Student workspace** (`student.html`), guests on the
  bare sheet. The session lives in the browser's `localStorage`, so
  closing the tab keeps you logged in — and so does a reload. Guests keep
  nothing else: reload and the sheet is gone. Logged-in users can **Save**
  the sheet to their account from the session chip and reopen it later
  from **Drawings** (the first save asks for a title, later saves update
  the same drawing); the C++ backend also records finished tutorials,
  which earn a ✓ on the lesson button next visit.
- **Session chip** (bottom-left). Shows who is logged in as `name (role)`
  plus **Save**, **Drawings**, **Sets**, a **Studio**/**Workspace** home
  link, and **Logout** buttons and a status line.
  Clicks here never draw (the chip swallows all pointer gestures).
  **Logout** clears the session and returns to the login page. It sits
  outside the demo bar, so `Manual` stays the bar's last child.
- **Desktop gate.** Touch-only devices with no fine pointer (phones, small
  tablets) get an opaque **Desktop required** overlay: the canvas needs a
  keyboard, mouse, and wide screen. The overlay offers one way out — a
  link to the tutorials sheet. There is no dismiss and no bypass;
  touchscreen laptops (fine pointer present) are let through, and if the
  input setup changes mid-session the page reloads itself cleanly.

### 3.9 Edit and View modes

The `Edit`/`View` pair switches what the sheet does with your clicks:

- **Edit** (default, blue on load) is the drawing mode: clicks place,
  select, bank, plot, and rename, exactly as §4–§6 describe.
- **View** is the read-only measure mode. View measures, never edits:
  click the entity to inspect — a point, segment, circle, or arc — and
  a badge reads it back. A point shows its coordinates with the
  Elevation/Plan tag; a segment shows its length with ΔX/ΔY and its
  angle from +X; a circle shows its center with radius and diameter.
  Clicking empty sheet clears the pick, Escape clears the readout, and
  so does a right-click.

Drafting style: a segment gets a true dimension — extension lines
off both ends, a parallel dimension line with arrow tips, and the bare
value centered (all values in mm). The dimension opens toward the click:
click above the span and it draws above it. Short spans park the value
past the far end with a leader. Circles and arcs get a radius leader
(arrow on the rim, `R` value on a shelf, diameter beneath), and points
keep their callout plus a witness to the XY fold labeled with the
height — the point's distance to its own plane.

Entering View parks every authoring gesture (selection, rename, line
menu, polar sweep, plotting, bank, typed buffer, popups), and while
View is on, double-click never renames and typing never stakes — there
is nothing to change by accident. Panning, zooming, the 3D glass, and
`Check hidden` all keep working, and starting a tutorial returns the
sheet to Edit. The readout lives on the overlay layer only: it is never
an entity, never saved, and never reconstructed.

### 3.10 Classes and question sets (teachers post, students submit)

The studio and workspace run the assignment loop around classes.
Teachers create classes and post coded sets to a class or as open sets;
students join classes, solve by drawing, and submit; teachers review
each submitted sheet in read-only View mode:

- **Create a class (teacher, in the studio).** Enter a class code
  (`be-a-2026`: 3–24 letters, digits, dashes; codes are unique) and a
  title. **Create class** publishes it; share the code with students.
  Opening a class shows its member list and the sets posted to it.
  Deleting a class drops its memberships and turns its sets into open
  sets (nothing submitted is lost).
- **Post (teacher).** Enter a set code (`geo-101`: same code rules,
  unique) and a title, pick a class or leave it an open set, then add
  questions one by one: a prompt and an optional hint. **Create set**
  publishes it. A class set is listed for that class only; an open set
  is solvable by any logged-in student with the code. Starters still
  attach from the sheet: open the **Sheet**, draw, then post via the
  session bar's **Sets** panel (**Attach current sheet as starter**).
- **Join (student, in the workspace).** Enter the class code the
  teacher shared. Joining lists the class and its sets; leaving drops
  them from your feed (your submissions stay).
- **Solve (student).** **Sets to solve** merges your class sets with
  open sets, or open any set by code. Each question shows its prompt
  with a **Hint** toggle where the teacher left one; **Solve on sheet**
  opens the sheet with the starter loaded (when the teacher attached
  one). Draw the answer, then **Submit my sheet** from the sheet's
  **Sets** panel with an optional note. **My submissions** lists what
  you sent, with **Reload in sheet** to load one back as an editable
  copy. **My drawings** reopens anything you **Save**d, and **Tutorial
  progress** ticks off finished lessons.
- **Inspect (teacher).** Opening a set shows every submission with the
  student's name, question number, note, and date. **View sheet** opens
  the submitted drawing on the sheet in read-only **View** mode
  (measure, never edit); deleting a set removes its submissions too.

Guests see none of this: the studio and workspace send guests back to
the login page, and no class, set, or submission call ever leaves the
browser without a session token. Classes, sets, and saves all run
against the single app server (`npm start`).

### 3.11 Command line (`/`) and Settings

The command line is a hidden bottom-center input bar: a Minecraft-style
slash prompt that draws the sheet with no mouse. It appears only when
`/` is pressed — a bare `/` on the sheet opens the bar with `/` ready —
then type a command and Enter. `/help` lists all twenty-three commands;
`/help line` shows one command's exact usage. Commands draw through the
same sheet as the mouse (same entities, same undo, same live 3D), so
agents and students can script a drawing by typing. Every figure type
is reachable — points, segments, rays, construction lines, circles,
arcs, open chains, ellipse rings, hatching, dimensions, text, and the
datum — with nothing mouse-only left:

| Command | What it draws |
|---------|---------------|
| `/point a 10 20` | Point `a` at X 10, Y 20 mm (optional view fourth: `/point a 10 20 profile`). |
| `/line a b` | Segment between points `a` and `b` (optional style and view: `/line a b E plan`). |
| `/ray a b` | Ray from `a` through `b` (same `[bis] [role]` tail as `/line`). |
| `/xline a b` | Construction line through `a` and `b` (same tail). |
| `/circle a 5` | Circle at point `a`, radius 5 mm (or `/circle x y r` raw; same tail). |
| `/arc a 5 0 90` | Arc at point `a`, radius 5 mm, 0° to 90° (or `/arc x y r a1 a2` raw; same tail). |
| `/text 0 0 hello` | Words `hello` at X 0, Y 0 mm. |
| `/dimension a b` | Measured span between `a` and `b` (same `[bis] [role]` tail as `/line`). |
| `/polygon a b c` | Closed chain through three or more points. |
| `/polyline a b c` | Open chain through two or more points (free curves). |
| `/ellipse a 60 40` | Ellipse ring at point `a`, 60 × 40 mm, 48 chords (or `/ellipse x y rx ry` raw; optional count: `/ellipse a 60 40 24`). |
| `/hatch -60 0 0 20 3` | Section hatching inside the rect, 3 mm apart at 45° (optional angle: `... 3 135`; same tail). |
| `/rename a a2` | Point `a` becomes `a2`. |
| `/delete a` | Point `a` plus its lines (locked datum holds). |
| `/style a E plan` | Entity `a` redrawn as hidden type `E` in plan view (any entity by letter or id). |
| `/datum` | The XY ground datum (optional span: `/datum -30 30`). |
| `/clear` | Empty the sheet. |
| `/undo` | Undo the last sheet change (same as `Ctrl+Z`). |
| `/demo prism` | Load a demo: `line`, `points`, `prism`, `3view`, `square`. |
| `/tutorial square` | Start a tutorial: `square`, `prism`. |
| `/check` | Grade hidden verdicts and claims. |
| `/mode view` | Switch `edit` / `view` mode. |

The `[bis] [role]` tail sets the BIS line style (`A B E G H K`) and the
view the figure belongs to (`plan`, `elevation`, `both`, `profile`); a
bare view works too (`/line a b plan`). Omitted roles default to the
sheet's own convention (points and rounds by height, spans shared).
`/ellipse` and `/hatch` take an optional number before the tail (chord
count 8–180, hatch angle in degrees). Three commands keep fixed styles
on purpose: `/text` is always a thin annotation, `/datum` is always
the shared ground axis, and `/polygon`/`/polyline` are plain multi-edge
macros — restyle any of their edges afterwards with `/style`. A zero-
sweep arc (angles a full turn apart) is refused: it would draw nothing,
so `/circle` is suggested for a full ring instead.

While typing, two assistants work above the bar: a preview line
narrates what Enter would do ("Place point `a` at (10, 20) mm") or
names the first problem ("Unknown point `z`"), and a suggestion list
completes command and argument names Minecraft-style. Point arguments
complete to the letters printed on the sheet, never engine ids, and each
BIS line-style suggestion draws its dash sample next to its letter. Tab (or click)
accepts the highlighted suggestion, Up/Down walks the list, and with
no list open Up/Down recalls past commands. Enter runs the line and
closes the bar; Escape closes it without running. Mistakes never draw:
the bar stays open, explains the usage, and keeps the line for fixing.
View mode stays read-only — drawing commands answer with a nudge to
`/mode edit` instead.

#### Script files (`.edc`)

The palette doubles as a file format — **EduCAD Script**. A script is
plain text: one slash command per line, `#` comments and blank lines
ignored, geometry commands only (`/demo`, `/tutorial`, `/check`,
`/mode` need the live page and are refused). Sample sheets live in
`tools/scripts/` (`ln1.edc`, `or2.edc`). Validate one without opening
a browser:

```sh
node tools/edc.js tools/scripts/ln1.edc
```

The runner executes every line headlessly and reports per-line errors
plus structural checks: entity counts by type, and the Monge projector
invariant (points sharing a base name, `a`/`a'`, must share x across
views — a mismatch fails validation). Exit code is 0 when clean, 1
otherwise, so scripts work as checkable drawing artifacts in
reviews and auto-grading.

The same script also represents the 3D model: the runner feeds the
sheet through the live reconstruction and prints one `solid:` line
(`ok — 4V 4E 0F`, or `unavailable` with the reason, e.g. a curves-only
sheet). Representation only — nothing edits the solid; the 2D ink
determines it. Corner pairs lift when a drawn Type G projector joins
their views (see `tools/scripts/quad3d.edc`), and
`node tools/edc.js --solid <file.edc>` dumps the full wireframe
(vertices in mm, edges, faces) as JSON for agents and graders.

### 3.12 Plain words (`/ ...`) and teacher auto-draw

The bar also understands plain language. Type `/` followed by a space
and describe the drawing — `/ draw a triangle 40 wide and 30 tall` —
and Enter interprets the words into slash commands and runs them. When
the words cannot become commands, the bar says why instead of drawing
anything ("tell me the shape or projection you have in mind"). Points
already on the sheet are offered to the interpreter by name, so `/ join
a to b` works after `/point a …`. Word drawing needs a logged-in
session and a server with a model key: guests stay local and see a
login nudge, and a keyless server answers that word drawing is off.

Teachers get `/auto <words>`, which drafts a full model answer from a
description instead of one gesture. The studio offers the same flow per
question: **Auto-draw model** (or **Auto-draw replacement**) opens the
model sheet and draws from the question prompt plus its hint. Review
the draft on the sheet, fix anything by hand or by command, then
re-attach it as the model from the Sets panel — auto-draw never
attaches by itself.

Both word paths run through `POST /api/interpret` on the app server,
which forwards one prompt to the local model gateway and returns
`commands` plus a `reply`. The gateway key (`OPENAI_API_KEY`) comes
from server environment, else straight from the manager's own
`~/.hermes/.env` — plain `npm start` just works wherever the manager
installed the key (see `antigravity-manager.md` on the host); browsers
never see it. Every
returned line still passes through the normal command runner, so a
wayward model line fails loudly per line instead of corrupting the
sheet, and View mode stays read-only for interpreted drawing too.

### 3.13 Pose mode (Blender moves, live 2D views)

Pose mode answers "what if this sat the other way": grab the 3D model
and the already-drawn 2D Monge views move with it in real time —
outlines, projectors, hidden lines, dimensions, and their names all
ride along, front view above the XY line and plan below it. Stacked
corners split live: a plan dot captioned `g,a` parts into two dots
each carrying its own corner's name (matched through the mate dot in
the other view), and rejoins into the full stack at rest. It is
visualization only — the committed sheet never changes, there is
nothing to undo, and exiting restores the exact rest pose. Enter with
the demo-bar **Pose** button or `Tab`; Pose needs one resolved 3D
point, so a sheet with nothing drawn in both views answers "Pose needs
a point" instead. Exit with `Tab`, `Escape`, the Pose button again, or
the panel's Exit.

Moves work Blender-style. `G` grabs (move), `R` rotates, `S` scales
(vertical mouse: up grows, down shrinks);
the bare mouse then drives the live transform, `Enter` or click
confirms, `Escape` or right-click cancels back to the gesture start.
`X`, `Y`, `Z` lock the gesture to one world axis (axes read X right,
Y up, Z toward you — see the panel legend), so `G` then `Y` lifts the
model straight up and the drawn elevation's distance from HP grows.
Holding `Ctrl` snaps (5 mm, 5°, 0.1 scale). `Alt+G`, `Alt+R`, `Alt+S`
clear translation, rotation, and scale separately; the Reset pose
button clears all three. Plain drags still orbit the camera and the
wheel still zooms; 1/3/7 jump to front/right/top views (`Ctrl` for
back/left/bottom). The HUD reads out live Location, Rotation, and
Scale plus the running gesture.

The datum line is the wall, and it is the only rule: VP geometry
never crosses below the XY line and HP geometry never crosses above
it — either view may sit exactly on the line, but never cross it —
so the two drawn views can never crash into each other. A gesture
that would push either across stops at the line instead (the HUD
flags "at view limit"). The clamp measures the exact 3D projections,
not the fitted views, so out-of-plane spins can neither sneak across
nor get stuck by a bad fit. Gain room for big rotations first: lift
in Y for in-plane spins, and sink the plan in Z as well before
out-of-plane spins that swing plan geometry upward. Views foreshorten
honestly while they move — a Y spin narrows the front view's width
while its height stays exact — and near edge-on spins compress a view
toward a line, exactly as the 3D glass shows. Geometry sitting on the
line itself (a shared base edge) reads in both views at once. The XY
DATUM line itself never moves — it is the fixed reference the clamp
measures against.

Over the riding ink, pose mode draws the exact live projection of the
posed solid in full ink while your ink fades back: visible edges solid,
hidden edges dashed, recomputed every frame from the 3D model. This is
the true stance — where a spin splits coincident geometry (a tipped
prism's top and bottom rings separating into two outlines in plan),
the overlay shows both branches even though the fitted views only ever
move the ink you drew. The overlay is ephemeral and needs no clamp of
its own: its endpoints are the clamped projections themselves.

- **Preview commands while typing** — the narration line above the bar.
- **Suggest commands while typing** — the completion list above the bar.
- **Show demos** — the demo picker, and `/demo` itself.
- **Show tutorials** — the tutorial picker, and `/tutorial` itself.
- **Remember command history (Up/Down)** — recall past lines.
- **Show coordinate readout** — the `X/Y` coordinates box.

**Reset to defaults** switches everything back on.

---

## 4. Drawing, tool by tool

Tools have no buttons: each one is a click sequence on the sheet. The tools
that exist in the UI are: **place point**, **select**, **line/segment**,
**BIS line-type popup**, **polar point**, **line-referenced plotting**, and
**three-point circle**. Everything else in this section is marked
**not reachable from the UI** where that is the case — read those notes
before hunting for a button that does not exist.

Conventions: "click" = left-click; "Ctrl+click" also works with Cmd on macOS;
a "point" is a sheet dot with a letter label.

### 4.1 Place point (click empty sheet)

Creates: one `POINT` entity (thin style, auto-named `a`…`z`, then `a1`…).

1. Make sure no tool is armed (right-click or **Escape** cancels everything).
2. Left-click empty sheet space (farther than 14 px from any point).
3. A dot appears with the next free letter. If another point is selected
   (amber ring), the new point is **axis-locked** to it — see
   [Precision](#6-precision-snapping-axis-lock-zoom-line-weights).

Placing a point never selects it and never clears an existing selection:
the amber ring stays exactly as it was.

Worked example (on a cleared sheet, nothing selected): click at sheet
position `X: -40.00 mm • Y: 20.00 mm` (above XY, so the point belongs to
the elevation), then at `X: 30.00 mm • Y: 20.00 mm`. You get points `a`
and `b` on one horizontal line in the VP half. (On a non-empty sheet the
same clicks land in the same places but take the next free letters.)

### 4.2 Select (click a point)

Creates nothing; it arms a reference used by placement, renaming, and the
axis lock.

1. Left-click within 14 px of a point.
2. An amber ring appears around it. Clicking another point moves the ring;
   clicking empty sheet places a new point (axis-locked to the ring);
   right-click or **Escape** clears the ring.

Selecting never moves, edits, or deletes anything by itself.

### 4.3 Line / segment (Ctrl+click P1, click P2, pick BIS type)

Creates: one `SEGMENT` entity spanning both views, drawn with a short
stroke animation.

1. **Ctrl+click** an existing point P1. Nothing arms: P1 joins the
   pick bank (amber ring + numeral `1`) and the cursor turns into a
   crosshair, which now means "banking in progress". Ctrl+clicking P1
   again unbanks it; Ctrl+clicking empty sheet places a point and
   banks it instead. A multi-caption P1 (§5.3) banks as-is, no questions:
   correspondence is declared by drawing a Type G projector through the
   pair (§9.3b), graded by Check along with your hidden verdicts.
2. **Click** a *different* point P2. The plain click finalizes the
   bank of one into a line: a grey P1–P2 preview appears, the bank
   empties, and the line-type popup opens at the cursor. Clicking P1
   itself does nothing; clicking empty sheet aborts the bank instead
   of drawing.
3. While the popup is open you may click a different P2 to re-aim
   (clicking P1 itself just selects it; the BIS popup stays open).
4. **Click a dash preview** in the popup. A 300 ms animation draws the
   stroke, then the segment is committed.
5. Right-click or **Escape** at any earlier step aborts with nothing
   created (and empties the bank).

Worked example: with `a = (-40, 20)` and `b = (30, 20)` from §4.1,
Ctrl+click `a`, click `b`, choose
`Continuous Thick — Type A`. The sheet gains a thick visible-outline
segment from `(-40, 20)` to `(30, 20)` — a 70 mm horizontal line in the
elevation.

When several *distinct* dots sit on the same spot (a geometric stack),
Ctrl+click offers a `Bank which dot?` popup listing every dot under the
cursor, nearest first; picking one banks exactly that dot (Ctrl+clicking
it again unbanks). The bank holds dots only — no corner is ever chosen
here. Correspondence is declared by drawing a Type G projector through
the stack (§9.3b): 2D→3D reconstruction pairs the same-letter corners
stacked on the line even where positional pairing is ambiguous (a second
same-named dot off the line no longer blocks the covered one). A line
that resolves nothing (wrong letters, doubled owners on the line) is
ignored and the pairing falls back to geometry, and claims never leak
into unrelated geometry.

Notes:

- P1 and P2 must be two *distinct* points: the tool refuses P1 == P2, and
  a P2 sitting on P1's spot (within 1e-6 mm) is refused too — a line *is*
  two distinct endpoints, so a one-point line can never be drawn, stored,
  or edited into existence anywhere in the engine (not via the API, XML,
  or coordinate edits either). Collapsed lesson traces are emitted as
  points instead (§9.2).
- Banking a second point before finalizing changes the verdict: the
  finalizer then draws a circle (§4.9), not a line. To re-pick P1
  instead, Ctrl+click P1 again (unbank) and bank the new first point.
- There is no cursor-following rubber band by design: the preview appears
  only after P2 is picked.
- New segments are visible in both views (`BOTH`) with no label.

### 4.4 Line-type (BIS SP 46) popup

Reached only from the line tool after P2 is picked (step 2). Five rows,
each showing only its rendered dash sample; hover for the tooltip:

| Tooltip (exact) | Code | Renders as |
|-----------------|------|-----------|
| `Continuous Thick — Type A` | A | Solid, thick (visible outlines) |
| `Continuous Thin — Type B` | B | Solid, thin (construction, labels) |
| `Dashed Thin — Type E` | E | Dashed, thin (hidden edges) |
| `Chain Thin — Type G` | G | Chain thin (center lines, projectors) |
| `Double-Dash Chain — Type K` | K | Double-dash chain (loci, alternate positions) |

Type H (chain with thick ends, for cutting planes) exists in the styling
engine but is **not offered in this popup**.

### 4.5 Polar point (angle + distance from an anchor)

Creates: one `POINT` placed at a chosen angle off an existing line and a
chosen distance along the locked ray. This is the protractor-and-scale tool.

1. **Ctrl+click** an existing point P0 to bank it (same banking
   gesture as the line tool; the bank is shared).
2. **Click a baseline segment** that passes through P0 (within 0.5 mm).
   A cyan ring marks P0 and the angle sweep begins.
   - If the clicked line misses P0, the tool parks in an invalid state and
     the next click drops it (nothing created).
3. **Sweep the angle**: move the mouse. A protractor arc and a badge
   `∠ 30.0°` follow the cursor, showing the unsigned 0–180° angle between
   the baseline and P0→cursor. Angles snap softly to 15°/30°/45°/60°/90°
   within ±2°.
4. **Click** to lock the angle. The badge changes to the distance sweep:
   a guideline ray plus `r mm (∠ θ° locked)`, e.g.
   `25.00 mm (∠ 30.0° locked)`.
5. **Move** to sweep the distance (the target point slides along the locked
   ray, clamped at P0) and **click** to commit the new point.
6. Right-click or **Escape** aborts at any step with nothing created.

Worked example: first place a point at `(0, 0)` and draw an X-axis
segment through it (place `(40, 0)` with the `ΔX` badge, join them).
Bank P0 = `a = (0, 0)`, baseline = that X-axis segment. Sweep to the
`∠ 30.0°` detent with the cursor above the baseline, click, sweep the
ray out to `25.00 mm (∠ 30.0° locked)`, click. The new point lands at
`(21.65, 12.50)` mm (25·cos30°, 25·sin30°), auto-named. (Below the
baseline the same sweep lands at `(21.65, -12.50)`.)

### 4.6 Line-referenced plotting (perpendicular offset point)

Creates: one `POINT` at your cursor's perpendicular offset from a datum
segment. This is the set-square tool: pick a line, then place a point
measured off it.

1. With no tool armed, **click a segment** (not a point). Plotting mode
   begins; the datum segment itself is never marked.
2. **Move** the mouse. A thin perpendicular guideline runs from the sliding
   foot on the datum to the candidate point, with a badge
   `⊥ Dist: 12.34 mm` showing the perpendicular distance. The foot sticks
   to the segment ends when you slide past them.
3. **Click** to commit the candidate as a new auto-named point.
4. Right-click or **Escape** aborts with nothing created.

Type the offset instead of eyeballing it: while plotting, type digits
at any time (`10`, `7.5`) — the badge switches to `⊥ 10 mm (Enter)`
and the guideline stretches to the staked target on the cursor's
side of the datum. Press Enter to commit, which ends plotting like a
click commit; Backspace edits and the first Escape clears the number.
While a line is focused the keyboard belongs to it: a selected
point's typed axis entry (§6.2) waits until plotting ends, and Enter
with the cursor on the datum only warns.

The VP/HP ground line (the fold at y = 0) focuses the same way even
though it is drawn decor, never an entity: **Alt+click** within 14 px
of the fold. The corridor never exceeds 20 mm: fully zoomed out,
Alt+clicks farther than that from the fold place normal points
instead of focusing the datum. A plain click there keeps placing
points, so the Alt key is what asks for the datum. The foot is your
cursor's x on the fold with nothing to clamp, the same `⊥` badge and
typed entry apply, and commit/Escape behave exactly like segment
plotting.

Worked example: first draw a datum segment from `(0, 0)` to `(40, 0)`
(place the two points, join them). With no tool armed, click the
segment's middle — away from its endpoint dots, or the click selects a
dot instead — then move the cursor above the datum until the badge reads
`⊥ Dist: 10.00 mm`, and click. The new point lands at `(x, 10.00)` where
`x` is the cursor's projection clamped to `[0, 40]`. (Below the datum
the same badge reading lands at `(x, -10.00)`.)

### 4.7 Not reachable from the UI (read before searching)

Each item below exists somewhere in the code (demos, file format, or
developer API) but **no mouse or keyboard gesture in the app creates,
edits, or toggles it**. They are listed here so you do not hunt for them.

| Capability | Status | Where it actually lives |
|------------|--------|-------------------------|
| Ray | Not reachable | Entity type exists; nothing draws or creates it in the app. |
| Circle | Bank two points, click the third (§4.9) | Ordered bank with numerals; the finalizer commits a Type A `CIRCLE`. |
| Arc | Not reachable | No creation gesture; arcs stay deferred in 3D. |
| Dimension | Not reachable | No dimension gesture; dimension geometry is not drawn by the sheet renderer even if present. |
| Text / free label | Not reachable | Labels come only from point captions (rename) and demo data. |
| Axis / datum line | Not reachable | Demos include datum/projector/axis lines; you cannot draw your own. |
| Projector lines | Not reachable | Demo-generated only (Type G verticals). |
| Virtual ruler | Not reachable | State machine exists in code but no gesture drives it. |
| Virtual compass | Not reachable | Same as ruler. |
| Constraint solver | Not reachable | Powers nothing on screen; demo geometry is computed by the lesson builders, not the solver. |
| Command line (`Point(…)`, …) | Not reachable | Developer API only; there is no input box. |
| Undo the last sheet change | Ctrl+Z / Cmd+Z key (Edit mode) | Reverses the last sheet change; see §5.7. |
| Save / export / print | Session-bar Save/Drawings | Logged-in users persist sheets to their account (§3.8); guests still lose the sheet on reload; no print pipeline. |
| Line thickness picker | Not reachable | Weights are fixed cosmetic 1 px / 2 px. |
| BIS Type H in popup | Not reachable | Engine supports it; the popup offers A/B/E/G/K only. |
| Snap on/off toggles | Not reachable | Snapping is always on; see §6. |
| Snap badge text | Not shown | Tier names exist in code but the sheet draws only the snap ring. |
| Pan by dragging empty sheet | Not reachable | Pan needs middle-drag or Shift+left-drag. |
| Drag-move of entities | Not reachable | Points cannot be moved after placement. |
| Delete key / erase tool | Not reachable | Only blank-rename delete and Clear Sheet (see §5). |

### 4.8 Recipes: draw a box and a pyramid by hand

Two copy-exact recipes for real wireframe solids. Both start from
**Clear Sheet**, use only place-point (§4.1), double-click rename (§5.3),
and the line tool (§4.3) with the `Continuous Thick — Type A` style,
and satisfy the pairing rules in §8.6. Read every target coordinate
from the status HUD (§3.1) before you click: shared x-stations must
agree within 0.5 mm, so place each mate with the axis lock (§6.2) —
click the reference point to select it (amber ring), move until the
`ΔX`/`ΔY` badge appears, check the HUD, click. (Placing never selects,
so re-select the reference before each locked mate.) Both recipes were
validated against the reconstruction engine: each reports `ok`.

#### Box: 8 vertices, 12 edges

Closed plan rectangle below XY plus closed elevation rectangle above XY
spanning the same x-stations. Eight corners project onto eight dots —
each dot carries two corners, so rename every dot with a two-part
caption (comma-separated bases, §8.6):

- Plan corners: `(-30, -40)` → `a,e`; `(30, -40)` → `c,g`;
  `(30, -10)` → `d,h`; `(-30, -10)` → `b,f`.
- Elevation corners: `(-30, 10)` → `a',b'`; `(30, 10)` → `c',d'`;
  `(30, 50)` → `g',h'`; `(-30, 50)` → `e',f'`.

1. Click **Clear Sheet**.
2. Place the four plan corners, watching the HUD. Lock each edge with
   the `ΔX`/`ΔY` badge so the rectangle stays square to the axes.
3. Join the four plan sides with Type A: Ctrl+click a corner, release
   Ctrl, click the next corner, pick the first (solid thick) preview —
   four times, until the loop is closed.
4. Place the four elevation corners, each vertically locked (the `ΔY`
   badge) to an already-placed point sharing its x — e.g. select
   `(-30, -10)` and click straight above it at `(-30, 10)` — until the
   HUD shows all four targets placed.
5. Join the four elevation sides with Type A, as in step 3.
6. Double-click each dot and rename it per the lists above (type the
   caption, Enter to commit). Watch the 3D view: corners pop in pair
   by pair as mates land.
7. The 3D view shows a box: 8 vertices, 12 edges. Orbit it. If a
   corner is missing (§8.6), a caption is mistyped (each half misses
   its mate), a dot drifted in x (blank-delete it and re-place with
   the lock), or one side is still open.

#### Square pyramid: 5 vertices, 8 edges

Closed plan square plus centre apex below XY; base line, apex, and two
slants above XY — paired across views per §8.6. The two elevation base
ends each carry two base corners, so they take two-part captions; and
unlike the box, the plan apex joins its corners (every slant needs its
plan projection drawn):

- Plan corners: `(-20, -50)` → `a`; `(20, -50)` → `b`;
  `(20, -10)` → `c`; `(-20, -10)` → `d`;
  plan apex `(0, -30)` → `s` (strictly inside the square; the centre is
  easiest).
- Elevation base ends: `(-20, 10)` → `a',d'`; `(20, 10)` → `b',c'`;
  elevation apex `(0, 50)` → `s'`.

1. Click **Clear Sheet**.
2. Place the four plan corners as in the box recipe, then the plan apex
   at `(0, -30)` (watch the HUD — no axis lock reaches the centre).
3. Join the four plan sides with Type A, then the four apex-to-corner
   edges (plan apex to each corner). Without them the slants have no
   plan projection and the 3D view shows the base only.
4. Place the three elevation points, each vertically locked (the `ΔY`
   badge) to its plan partner: the base ends off the plan corners, the
   apex `(0, 50)` off the plan apex `(0, -30)`.
5. Join three elevation lines with Type A: the base
   `(-20, 10)–(20, 10)`, the left slant `(-20, 10)–(0, 50)`, and the
   right slant `(20, 10)–(0, 50)`. A pyramid has no top line.
6. Double-click each dot and rename it per the lists above.
7. The 3D view shows a square pyramid: 5 vertices, 8 edges. If a
   corner is missing, a caption is mistyped or a dot drifted in x —
   same checks as the box recipe, step 7.

### 4.9 Circle from three points (bank two, click third)

Creates: one `CIRCLE` (Type A) through three picked points. No tool to arm.

1. **Ctrl+click** two points (existing dots, or empty sheet which
   places-and-banks). Each banked pick shows the amber ring plus a
   numeral (1/2), and the crosshair means banking is in progress.
   Re-clicking a banked point unbanks it; a third Ctrl+click only
   warns — the bank holds two.
2. **Click** the third point. The plain click finalizes: non-collinear
   triples give the circumcircle; collinear triples with an equidistant middle
   give the centered circle (middle as center, half the outer span); other
   collinear triples are rejected with a message and nothing is committed.
   Clicking a banked point again does nothing; clicking empty sheet
   aborts the bank instead of drawing.
3. The committed circle takes `ELEVATION` at/above XY and `PLAN` below it,
   `bisCode A`, radius at least 0.01 mm. The bank empties on commit,
   Escape, right-click, or any abort. A banked corner claim (scripted
   lessons only — hand banking attaches none) applies to lines only
   and evaporates if the bank commits a circle.

---

## 5. Editing and housekeeping

### 5.1 Selection

- Click a point to select it (amber ring, 7 px). Only points are selectable;
  segments are never selected — clicking a segment starts plotting (§4.6)
  or feeds the polar tool (§4.5) instead.
- Only one point is selected (amber ring) at a time; multi-select lives
  in the pick bank instead (Ctrl+click, §4.3).
- The selection is a *reference*: it drives the axis lock for the next
  placed point and marks which point a double-click will rename.

### 5.2 Deselect (right-click / Escape)

Right-click or **Escape** cancels, in one gesture, the selection, any
banked picks, any rename in progress (buffer discarded, original kept),
the line tool, the polar tool, the plot tool, and any open menu.
Right-click is handled before
the sheet menu, so with anything active, right-click always means "cancel",
never "menu". The browser's native right-click menu never appears anywhere
on the sheet.

### 5.3 Rename (double-click, then keys)

1. **Double-click** a point. (The two clicks of the double-click harmlessly
   re-select it first.) A blinking caret preview (500 ms on/off) appears at
   the point's label position, and the point's own label hides while you type.
2. Type the new name. Exactly these keys reach the buffer:
   - printable characters, **including Space**;
   - **Backspace** (deletes one character). Backspace and Space are captured
     so the browser never sees them.
   - Anything else (arrows, Shift/Ctrl/Alt words, function keys) is ignored.
3. **Enter** commits: leading/trailing spaces are trimmed first. If the
   trimmed name equals the original, nothing is written. If it is empty,
   the point is **deleted** (see §5.5).
4. **Escape** or right-click cancels: the buffer is discarded and the
   original name is kept. Clicking empty sheet while editing also cancels
   (and then places a point — beware).
5. While the line or polar tool is armed, double-click is ignored
   (this includes the 300 ms stroke animation after picking a line type —
   wait for the segment to finish drawing).

**Multi-captions.** One dot can carry several coincident corner names,
separated by commas: `a,b` labels one projection shared by corners `a`
and `b` (competing points — see §9.3b). The names render side by side,
placed apart automatically. Wrap one part in parentheses to record your
hidden verdict: `a,(b)` says corner `b` is hidden in this view. Type the
visible member first by convention. Empty parts (`a,,b`) are ignored, so
no error popup exists — what you type is what is stored.

### 5.4 Auto-naming rules

New points take the first free name in the sequence `a`…`z`, then `a1`…`z1`,
`a2`…, scanning the captions of points currently on the sheet. Consequences:

- Deleting a point frees its letter for reuse.
- Multi-caption parts each occupy their bare name: after `a,(b)` exists,
  neither `a` nor `b` is issued again.
- Demo labels (`a'`, `b'`, …) occupy their names too, so a fresh point
  after loading a demo may skip to a later letter. (Only *point* captions
  count; segment captions such as `h1h2` do not.)
- Renaming to an already-used name is allowed (no uniqueness check); the
  next auto-name still skips used captions.
- Auto-names are sequential, not paired: placing a plan dot (`a`) and then
  its elevation mate at the same x names the mate `b`, not `a'`. For 3D,
  rename the mate to the primed name yourself (§8.6) — `a` below with `b`
  above reads as two different points, each missing its mate.

### 5.5 Deleting

There is no erase tool and no Delete key. Exactly two deletions exist:

1. **Blank delete**: double-click a point, erase the whole name with
   Backspace (or leave only spaces), press **Enter**. The point is removed,
   and every line drawn from it goes with it: a line needs two points, so
   deleting one endpoint deletes the line (segments/lines that start, end,
   or reference the deleted point are removed; the surviving endpoint
   point stays).
2. **Clear Sheet** button: removes every entity, cancels every tool, closes
   menus, and empties the 3D view (which then shows `3D unavailable`).

### 5.6 Hover behavior

Moving the mouse (no buttons) updates the coordinates readout, the plane
pill, the turquoise snap ring, and any active tool preview. Hovering never
selects anything and never changes the cursor, except:

- crosshair while the pick bank is non-empty;
- grabbing hand while panning.

### 5.7 What you cannot do (recap)

No drag-move, no multi-select, no segment editing (endpoints are fixed once
drawn). If you misplace a point, press Ctrl+Z (Cmd+Z) to undo the last
change, or delete it (§5.5) and place it again; if you misdraw a segment,
delete either endpoint point to remove the segment (then re-place the
point), or **Clear Sheet** and redraw, or reload a demo.
See [Limitations](#12-limitations--not-implemented).

---

## 6. Precision: snapping, axis lock, zoom, line weights

### 6.1 Object snapping (always on, no toggles)

A turquoise ring (7 px) follows the best snap target near the cursor on
every mouse move. There are no snap mode switches: every wired tier is
always active, with fixed priority:

| Priority | Tier | Snaps to |
|----------|------|----------|
| 1 (highest) | ENDPOINT | Point dots; segment/arc ends; ray origins |
| 2 | INTERSECTION | Segment/line crossings near the cursor |
| 3 | MIDPOINT | Segment midpoints |
| 4 (lowest, wired) | CENTER | Circle/arc centers |
| — (not wired) | PROJECTOR | Needs a plan-x list the page never sends: never fires |
| — (not wired) | LOCUS | Needs a locus-y list the page never sends: never fires |

Rules that matter to your hand:

- A target **locks** when the cursor comes within **14 px** of it and
  **releases** only past **22 px** (hysteresis: the ring feels sticky on
  purpose).
- A strictly higher tier within 14 px steals the lock from a lower tier.
- Angle detents of 15° steps (majors 15°/30°/45°, ±2°) exist in the
  snapping engine, but the sheet's click-to-place path does not apply them;
  only the polar tool snaps angles (§4.5).
- Tier names (`Endpoint`, `Midpoint`, …) exist in code but are **never
  drawn** on the sheet — the ring is the only snap feedback.

### 6.2 Axis-locked placement

With a point selected (amber ring), clicking empty sheet places the new
point axis-locked to the selection:

- Within 14 px of the selection's horizontal axis: `y` locks to the
  selection's `y`, badge reads `ΔX: 80.00 mm` (the x distance).
- Within 14 px of the vertical axis: `x` locks, badge reads
  `ΔY: 80.00 mm`.
- Within 14 px of both: the nearer axis wins.
- Far from both: free placement, no badge.
- Clicking on the selection itself is treated as a re-select, not a place.

The same `ΔX`/`ΔY` badge follows your cursor live whenever a selection is
active, so you can read the distance before you click.

Type the distance instead of clicking it: with a point selected, type
digits at any time (`40`, `12.5`) — the badge switches to
`ΔX: 40 mm (Enter)` with a sky preview ring on the staked target. Aim
the cursor onto the wanted axis on the wanted side of the selection
and press Enter: the new point lands that exact distance along the
axis, zoom-proof, unlike eyeballing the cursor. Backspace edits, the
first Escape clears what you typed, the second deselects, and the
selection stays put for repeat entry. Typing needs the bare
selection: rename editing, banked picks, line/polar tools, and popups
keep the keyboard while they run, and Enter off-axis only warns.

### 6.3 Tolerances that matter

| # | Tolerance | Value | Effect you feel |
|---|-----------|-------|-----------------|
| 1 | Point/segment click radius | 14 px | How close a click must land to hit |
| 2 | Snap lock / release | 14 px / 22 px | Ring stickiness |
| 3 | Axis-lock grab | 14 px | How close to an axis to lock |
| 4 | Sheet-menu suppression | 14 px | Right-click nearer a snap target than this never opens the menu |
| 5 | Polar baseline fit | 0.5 mm | Clicked line must pass this close to the banked P0 |
| 6 | Polar angle detents | 15/30/45/60/90° ±2° | Soft protractor clicks |
| 7 | 3D x-station pairing | 0.5 mm (loose 2.5 mm) | How exactly plan/elevation x must agree for 3D |
| 8 | Projector invariant | 1e-9 mm | Code-level exactness of elev.x == plan.x |
| 9 | Ground-fold grab ceiling | 20 mm | Alt+click corridor never reaches past this, at any zoom |

### 6.4 Zoom behavior

| Gesture | Effect |
|---------|--------|
| Mouse wheel | Zoom ×1.15 per notch **about the cursor** (the mm point under the cursor stays put) |
| `+` / `-` buttons | Zoom ×1.25 / ÷1.25 **about the sheet center** |
| `Home` button | Reset to scale 2.0 px/mm, sheet centered |
| Middle-drag, or Shift+left-drag | Pan (view follows the pointer 1:1) |

Scale clamps to **0.05…50 px/mm**. Resizing the browser window keeps the
scale and re-centers nothing (the view origin stays fixed). The sheet grid
(step 50 mm below scale 1.0, 10 mm below 4.0, else 5 mm) redraws for the
new zoom automatically.

### 6.5 Cosmetic zoom-invariant line weights

On screen, line weight does **not** grow when you zoom in: thin BIS styles
(B, G, H, K — 0.20 mm) always draw **1 px**, thick/medium styles (A at
0.50 mm, E at 0.35 mm) always draw **2 px**, with dash cadences likewise
fixed on screen. This keeps nearby vertices readable at any zoom. The true
mm widths exist only for print/export-style scaling, which the app does not
currently offer.

---

## 7. Views and planes

### 7.1 The sheet is two views glued at XY

- **Above XY (`y > 0`)**: the VP elevation (front view). Height `h` reads
  directly as sheet `y`.
- **Below XY (`y < 0`)**: the HP plan (top view). Depth `d` reads as
  sheet `y = -d` (so deeper points sit lower).
- **On XY (`y = 0`)**: the ground line itself — the edge where VP meets HP.

The plane pill (§3.1) reports position only: `y >= 0` shows
`V.P. (Elevation / Front)`, `y < 0` shows `H.P. (Plan / Top)`.

### 7.2 The invariant, for beginners

Take any real point in front of the planes. Its front view and its top view
are drawn by dropping perpendiculars to VP and HP — and both perpendiculars
share the same left-right position. So on the sheet, **the elevation dot
and the plan dot of one 3D point always sit on one vertical line** (one
projector): `elevation.x == plan.x`, paired within 0.5 mm. If two dots you
meant as a pair do not share x, they are not a pair — each half stays
2D-only until the mate lands on its projector (see §8.6). Names are
absolute too: the two dots of one point must carry the same base name —
plan `a` with elevation `a'` — or they are two different points, each
missing its mate (see §8.6).

### 7.3 Quadrant behavior (including Q3/Q4 negatives)

Points can live in any of the four dihedral quadrants, and the signs in the
table below are exactly what the Quadrant Points demo draws:

| Quadrant | Space position | Elevation y | Plan y | Demo example |
|----------|---------------|-------------|--------|--------------|
| Q1 | above HP, in front of VP | `+distHP` (above XY) | `-distVP` (below XY) | `a=(-50,-25)`, `a'=(-50,+35)` |
| Q2 | above HP, behind VP | `+distHP` (above XY) | `+distVP` (above XY) | both dots above XY |
| Q3 | below HP, behind VP | `-distHP` (below XY) | `+distVP` (above XY) | `b=(+50,+35)`, `b'=(+50,-30)` |
| Q4 | below HP, in front of VP | `-distHP` (below XY) | `-distVP` (below XY) | both dots below XY |

Notes:

- Q2/Q4 place both views on one side of XY; the app handles this (labels
  get small anti-collision offsets when the pair sits within 6 mm).
- Negative heights/depths are legitimate everywhere, including the 3D
  mapping — nothing is clamped to positive.
- The plane pill stays purely positional: a Q2 plan dot above XY still
  lights the `V.P.` pill. Trust the dot's role (prime = elevation), not
  the pill, in Q2–Q4.

### 7.4 What "first angle" means on this sheet

First angle = the object is imagined between the observer and the planes,
which unfolds to **plan below, elevation above**. That is the only layout
EduCAD draws: the watermarks, the pill rule, the demo generator, and the 3D
mapping all assume it. A third-angle marker exists in the lesson code, but
the app never switches layouts — see [Limitations](#12-limitations--not-implemented).

### 7.5 View roles under the hood (one paragraph)

Every entity carries a view role (`PLAN`, `ELEVATION`, `BOTH`, or
`PROFILE`). Points you place get `ELEVATION` at/above XY and `PLAN` below
it; line-tool segments are `BOTH`; demo entities carry the role their
lesson assigns. The label layout uses roles to keep labels on the correct
side of XY; the 3D classifier trusts explicit roles (including `PROFILE`
for a side view) and falls back to geometry for `BOTH`: the y-sign rule
first, then — when an upper cluster sits clear of the plan's x-range with
matching depth and height — a side/profile split (§8.6).

---

## 8. The 3D view

### 8.1 Where it is

The 3D view is a transparent sheet covering the whole window, with the
model resting in the top-right drafting quadrant. The sheet is fully
transparent: the wireframe sits on the sheet paper like ink on glass,
with no background, floor, shadow, or frame. (The built-in default
geometry is a unit cube, but the app replaces it with your live
reconstruction — or the `3D unavailable` message — synchronously at
startup, so the bare cube is never visible in normal use.)

### 8.2 Orbit, zoom, pan, reset

All gestures below work **on the 3D ink only** — on or within a few
pixels of a drawn line (§8.4 explains the aura) — and never touch the
sheet. Any gesture that starts off the ink belongs to the sheet.

| Gesture | Effect |
|---------|--------|
| Left-drag on the ink | Orbit (turntable): horizontal drag spins yaw, vertical drag tilts pitch, 0.008 rad/px. Pitch clamps at ±1.45 rad so the solid never flips inside-out. |
| Mouse wheel on the ink | Smooth zoom (continuous exponential step, trackpad-friendly) anchored at the cursor, 0.08×…60×. The window edge is the only bound — zoom never hits a box wall. |
| Middle-drag on the ink | Pan: slide the model around the window (middle-drag off the ink pans the sheet instead). Clamped so the model always overlaps the screen: it can never get lost. |
| Double-click the ink | Reset to the isometric rest pose (yaw 45°, pitch ≈35.26°, scale 1×) at the rest center. |

Escape hatches: **Shift+left-drag** always pans the sheet, **Alt+click**
always clicks through to the sheet, and while a 2D construction gesture
is armed (line, polar, plot, circle picks, rename), clicks and wheel go
to the sheet even on ink — so points stay clickable through the glass
mid-task. Right-click and **Escape** always belong to the sheet.

The rest pose is an exact isometric projection, so the default cube reads
as a textbook 2D sketch until you orbit it.

### 8.3 Pen-sketch look and hidden edges

- Ink strokes only: solid edges draw 1.75 px in `#1e293b` with round caps;
  vertices draw as filled 3 px dots in `#0f172a`. No fills, shading,
  lights, or colors.
- **Hidden edges** (edges whose every adjacent face turns away from you)
  draw dashed `[4, 4]` at 45% opacity, underneath the solid edges. On the
  default cube geometry this yields exactly 9 solid + 3 dashed edges at the
  isometric rest pose, the dashed three meeting at the far corner.
- Faceless wireframes (§8.6) have no faces to hide behind, so all
  their edges draw solid. But when your wire provably closes into a
  solid — flat loops, every edge shared by two faces — the view infers
  those faces silently (nothing is painted) and dashes the edges that
  turn away, exactly like the demo solids. Open or warped wire keeps
  drawing all-solid.

### 8.4 The aura (pointer routing)

There is no rectangular hit box. The model owns the mouse only inside
its *aura*: on or within 12 px of a drawn wireframe stroke (hidden
dashed edges count as ink), or near a vertex dot when the geometry is
points. The aura is the silhouette plus a margin, so it reshapes itself
automatically as you orbit, zoom, and pan — it grows when the model
grows and follows it wherever it slides.

On the ink: drag orbits, wheel zooms, middle-drag pans, double-click
resets — none of these reach the sheet, and presses that start on ink
never place points or open sheet menus. Off the ink, the glass is fully
transparent to input: drawing, selecting, sheet pan/zoom, and menus work
exactly as if the 3D layer were not there. While the view shows
`3D unavailable` there is no ink, hence no aura: the whole sheet is
clickable.

### 8.5 Live update behavior

The 3D view rebuilds from the *current visible drawing* on **every table
change** (place, rename-commit, delete, demo load, clear), coalesced to one
rebuild per animation frame. There is no refresh button and no stale state:
what you see is always the latest drawing. Clearing the sheet immediately
shows `3D unavailable` (`nothing with both views drawn yet`). Nothing 3D
is ever stored on your drawing — the geometry is derived fresh each time
and discarded.

Derived geometry is centered and uniformly scaled into model space
with proportions preserved, so a 35×70 mm prism and a 350×700 mm one look
identical on the glass (only proportions survive; absolute mm do not show).

### 8.6 How the 3D view reads your drawing (user language)

The 3D view is a live wireframe: every point with a projection in both
views appears in space, every segment joining two such points appears as
an edge — whether or not anything closes into a solid. There are no
drawing classes and no solidity gate. Draw `a'` above XY and `a` below it
and the 3D dot is already there; join two resolved points and the 3D edge
follows within one frame. Lone dots, open chains, and partial sketches all
render as-is. Anything with only one view stays 2D-only, silently: no mate
yet, no 3D point — draw the missing projection and it pops in.

Pairing rules:

- Pairing tolerance is **0.5 mm** in x: mates must share a projector
  station. Dots drifted beyond that never meet.
- **Names pair; geometry confirms.** A plan `a`, an elevation `a'`, and
  multi-captions like `g,a` share the base `a` (prime ticks stripped;
  parentheses invisible): mates on one projector must share a base.
  Unlabeled dots pair automatically when exactly one candidate per side
  shares the station. Consequences: `a'` above with `d` below never forms
  a point (each half misses its mate); one letter on two dots pairs
  neither (no guessing); a shared x with no shared name and company
  stays 2D-only. Segment captions (edge names like `ab`) never name a
  vertex — only `POINT` labels count.
- Dots exactly on XY pair as either side by their mate; two same-name
  datum dots at one station read as an origin-line point.
- Drawn projector claims are declarations: a Type G vertical crossing
  XY pairs the same-letter corners stacked on it (§9.3b), even where a
  second same-named dot off the line would block positional pairing.
  Banked claims (profile-square lesson) still work and win ties. Three
  or more claims assert a lamina — one claim, one corner, face from the
  convex hull — and own the sheet, so malformed claims fail loudly by
  name instead of guessing. One or two claims cannot bound a face: the
  dots still lift as wire, but the claim lines themselves never draw
  as edges.
- A drawn segment becomes a 3D edge when it determines its endpoints:
  a lone pair emits directly; where coincident corners stack, the pair
  additionally needs its mate projection drawn (or degenerated to a
  point for view-perpendicular edges). Pairs whose both projections are
  covered by strictly shorter emitted pairs drop as face diagonals.
  Long lines are cut at every dot they pass over, but a cut is a guess:
  chopped pieces need their mate projection drawn, while the whole line
  keeps its edge — unless a jointed midpoint's both halves survived in
  both views (a T-joint voids its span; a merely crossed dot does not).
  Projector-shaped ink — a sheet-vertical strictly spanning both views —
  never evidences edges, tagged or not; a vertical ending exactly on XY
  still draws.
- Circles and arcs hypothesize a revolved solid (§8.7) instead of wire:
  when no revolved reading fits — a polygonal plan loop beside a stray
  circle, an arc-only sketch with dots elsewhere — the sheet reads as
  wire with the curves skipped.

Faces are never inferred: the glass shows wire, all solid, and the pose
overlay (§3.13) projects the same edges per view with occlusion.

### 8.7 Curve limitation (user language)

Full circles build vertical-axis solids through the revolved reader:
a plan `CIRCLE` with a matching elevation silhouette renders as a
cylinder or cone, tessellated to a 24-gon rim. Only vertical-axis solids
work: a plan circle plus a rectangle or triangle silhouette. A drawn cylinder or cone that
malforms fails named (`x-mismatch`, `unmatched-point`, and friends)
rather than guessing; arcs stay deferred — a sketch with curves but no
usable circle and nothing else resolved reports `curves not supported
yet`. Curveless sheets never see curve reasons.

### 8.8 Empty states (user language)

With no classes left to fail, the 3D view has one quiet state: when
nothing on the sheet has both views drawn, it clears the geometry and
shows **`3D unavailable`** with the subtitle `nothing with both views
drawn yet`. Draw the missing mate and the point appears; there is nothing
else to fix. (Sheets routed to the readers — three or more banked
claims, drawn curves — keep their named reasons: the five claim
reasons, the revolved-reader reasons, and `curves not supported yet`.
Curveless claimless sheets never see them.)

How to read it: the subtitle always names the situation. Fix the named
item on the sheet; the 3D view rebuilds within one frame.


---

## 9. Demos and lessons

### 9.1 Demo buttons (guided walkthroughs)

Each demo button clears the sheet first, then loads its lesson. The app
opens on the Line Rotation demo unless the page address ends with `#points`
(loads Quadrant Points), `#prism` (loads Hexagonal Prism), `#3view`
(loads 3-View Prism), `#square` (loads Profile Square), or `#mesh`
(loads Line Rotation with the grid on and the sheet menu open).

#### `Line Rotation (TL=80, θ=30°, φ=45°)` — the inclined line

Loads a straight-line lesson: true length 80 mm, inclined 30° to HP and
45° to VP, with end A fixed at plan `(-30, -20)` / elevation `(-30, 25)`.

- **What it loads.** A datum span on XY; points `a`, `b` (plan) and `a'`,
  `b'` (elevation); thick plan/elevation views `ab` / `a'b'`; two Type G
  projectors; two Type K locus lines (`locus of b`, `locus of b'`).
- **What to look at.** End B lands at x = 10 mm in both views (projector
  shift dx = 40 mm): plan `b = (10, -76.57)`, elevation
  `b' = (10, 65.00)`. Appearances: plan length 80·cos30° ≈ 69.28 mm,
  elevation length 80·cos45° ≈ 56.57 mm, both shorter than TL = 80 mm.
- **What it teaches.** The rotation method: apparent lengths are TL·cos of
  each inclination; B's loci sit TL·sin away from A's; the projector shift
  completes the right triangle TL² = dx² + dh² + dd². Angles here are
  feasible (sin²30° + sin²45° = 0.75 ≤ 1).
- **In 3D.** Renders as a live-wireframe edge at true 80 mm proportions.
  Orbit it and compare against the two foreshortened sheet views.

#### `Quadrant Points (1st & 3rd)` — projectors and signs

Loads two point lessons: Q1 (`a` at x = -50, 35 mm above HP, 25 mm in
front of VP) and Q3 (`b` at x = +50, 30 mm below HP, 35 mm behind VP).

- **What it loads.** Per lesson: a datum span; plan/elevation dots (`a` /
  `a'`, `b` / `b'`); one Type G projector joining each pair.
- **What to look at.** Q1: `a = (-50, -25)` below XY, `a' = (-50, +35)`
  above XY. Q3 (the surprise): `b = (50, +35)` *above* XY,
  `b' = (50, -30)` *below* XY — the views swap sides. Both projectors are
  exactly vertical (elev.x == plan.x).
- **What it teaches.** One 3D point = two sheet dots + one vertical
  projector; the four sign patterns (§7.3); prime notation (`a'` reads
  "a-prime", the elevation).
- **In 3D.** Renders as two live-wireframe points, one with positive
  height/depth, one negative.

#### `Hexagonal Prism (35mm)` — a true solid

Loads a regular-solid lesson: hexagonal prism, 35 mm across corners,
70 mm tall, centered at x = 0. Bottom corners run `a`–`f`, top corners
`g`–`l` around the hexagon.

- **What it loads.** Datum span; six plan edges forming a regular hexagon
  (corners at R = 17.5 mm about `(0, -25.5)`) with a station dot on each
  vertex pairing top+bottom (`g,a` …); elevation outline (35×70 mm
  rectangle over x ∈ [-17.5, 17.5]) with two interior facet verticals at
  x = ±8.75; four single-corner dots on the outer stations (`a'`, `g'`,
  `d'`, `j'`) and four front+back pair dots on the interior stations
  (`f',b'` …); Type G center axes in both views; four projectors; Type K
  loci through base (y = 0) and top (y = 70). No Type E is drawn: every
  hidden edge coincides with a visible one, so visible wins per ISO 128.
- **What to look at.** Each interior facet vertical stands for a coincident
  front/back edge pair of the hexagon; each interior station dot carries
  both corner names. Projectors at all four x-stations hold elev.x == plan.x.
- **What it teaches.** Reading a solid off two views: hexagon below +
  rectangle above = prism; competing points (one dot, two corners);
  hidden-vs-visible analysis, recorded as parens and graded by Check;
  center axes (Type G); loci marking levels.
- **In 3D.** Renders as a live-wireframe prism: 12 vertices, 18 edges,
  drawn 35:70 proportions. Orbit to inspect the wire from all sides.

#### `3-View Prism (35mm)` — plan, elevation, and profile

Loads the three-view prism lesson: the same 35 mm hexagonal prism, 70 mm
tall, at x = 0 — plus a first-angle `PROFILE` side view with the
conventional construction drawn around it.

- **What it loads.** Everything the Hexagonal Prism demo loads, plus a side
  view at `xRef` (Type A outline, same heights as the elevation, width
  equal to the plan's depth span); the X1Y1 reference axis (Type G);
  horizontal front↔side projectors; and the 45° miter line.
- **What to look at.** Each plan depth `d` reappears in the profile at
  `x' = xRef ± (d − d0)`; the horizontal projectors carry each height
  across from the elevation; the miter turns plan depths into profile
  widths. The side view validates depth: the solid must explain all three
  views at once.
- **What it teaches.** Three-view (first-angle) reading: plan + elevation +
  profile, the reference axis, and why the miter sits at 45°.
- **In 3D.** Renders as a live-wireframe prism: 12 vertices, 18 edges,
  drawn 35:70 proportions. The side view never moves the wire — it is
  there for your reading practice, and the same prism without it lifts
  the identical 12 vertices and 18 edges.

#### `Profile Square (40mm)` — wire now, face on claims

Loads a 40 mm square lamina standing on HP in the profile plane x = 0,
seen edge-on in both views: a vertical line in VP, a horizontal line in
HP. Corners: `a` near-top, `b` far-top, `c` far-bottom, `d` near-bottom.

- **What it loads.** Datum span; edge-on Type A outline in each view;
  four pair dots without verdicts (`b',a'` / `c',d'` in VP, `a,d` / `b,c`
  in HP); Type G axes; one shared projector; Type K loci at y = 0, 40.
- **What to look at.** Every corner shares x = 0, so the shared names do
  the pairing work — and that is the lesson: one x-station can hold four
  corners, and the captions say which VP station meets which HP foot.
- **What it teaches.** Pairing across views corner by corner (declare the
  member when banking, §4.3); competing-points visibility in both views;
  wire versus face: names lift the wire, claims add the face.
- **In 3D.** The four corners lift as wire (4 vertices, 4 edges) on
  load. Draw the four projector claims and the claims reader faces it —
  the lamina appears. A wrong foot fails loudly (`duplicate-corners`)
  instead of warping it.

#### `Clear Sheet`

Removes everything and shows `3D unavailable` in the 3D view. Use it
before freehand exercises so no demo geometry interferes (stray demo
dots would lift beside yours — §8.6).

### 9.2 Curriculum lessons (the full set)

Beyond the five demo buttons, the lesson engine contains more lessons.
They have **no buttons**: a teacher triggers them from the browser's
JavaScript console while the app is open (they are plain data builders on
the global `EduCADCurriculum` — call them as
`EduCADCurriculum.quadrantPoint({...})` and so on). Each returns
`{ entities, steps, loci, projectors, projectorOk }`; `steps` is a
printable construction script and `projectorOk` confirms the invariant.

| Lesson (call) | Objective | Key parameters |
|---------------|-----------|----------------|
| `quadrantPoint({quadrant, xMm, distHP, distVP, label})` | One point in Q1–Q4: signs, projector, prime notation | `quadrant` 1–4; `distHP`/`distVP` ≥ 0; `projection` first/third-angle marker |
| `quadrantSet({labels, xs, …})` | All four quadrants side by side | default labels a–d at x = -30/-10/10/30 |
| `straightLine({TL, thetaDeg, phiDeg, axMm, yaPlan, yaElev})` | Rotation method, loci, feasibility | TL > 0; warns when θ+φ > 90° (impossible); collapses 90° views to points |
| `planeSurface({xMm, sizeMm, tiltDeg})` | HT/VT traces meeting on XY plus tilt angle | default 40 mm, 30° |
| `regularSolid({solid:'PRISM', sizeMm, heightMm, xMm})` | Hexagonal prism (the demo) | 35 mm default |
| `regularSolid({solid:'PYRAMID', …})` | Square pyramid with apex `s`/`s'` and one hidden slant | base 35 mm |
| `regularSolid({solid:'CYLINDER', …})` | Cylinder: plan circle d = 35 mm + elevation rectangle | full circle reconstructs revolved (§8.6–§8.7) |
| `regularSolid({solid:'CONE', …})` | Cone: plan base circle + apex at center, elevation triangle | full circle reconstructs revolved (§8.6–§8.7) |
| `threeViewSheet({solid, sizeMm, heightMm, xMm, side, xRefMm})` | Solid plan + elevation + `PROFILE` side view with projectors, 45° miter, X1Y1 axis | `solid` PRISM/PYRAMID/CYLINDER/CONE; `side` +1 (right) / −1 (left) |
| `generateLesson(kind, opts)` | Dispatcher: `POINT`/`LINE`/`PLANE`/`SOLID` (+ aliases) | same options as above |
| `generateCurriculum(opts)` | Whole bundle: 4 quadrants + line + plane + 4 solids | teaching-ordered `steps` with `[Q1]`… tags |

Loading console-built lessons onto the sheet needs a few lines of glue
(create each returned spec in the app table) — a developer task; see the
appendix. The `steps` arrays work stand-alone as blackboard scripts.

### 9.3 Teaching scripts (follow verbatim)

**Script A — Projectors (10 min, needs: Quadrant Points demo).**
1. "Every 3D point becomes two dots. Find `a` below XY and `a'` above XY."
2. "The vertical join is the projector. Cover one dot: the other must sit
   at the same left-right position. That is elevation.x == plan.x."
3. "Now find `b` and `b'`. Which is above XY? Why?" (Q3 swaps the sides.)
4. Exercise: students place their own pair at one x and check a third dot
   appears in the 3D view; then blank-rename-delete the new elevation dot
   (dots cannot be dragged, §5.7), re-place it 2 mm off in x, and read
   the `… misses its mate beyond eps` detail in the 3D view.

**Script B — True length (15 min, needs: Line Rotation demo).**
1. "The sheet shows 69.28 mm and 56.57 mm, but the line is 80 mm. Both
   views lie; the 3D view shows the truth. Orbit it."
2. "Plan length = TL·cos θ, elevation = TL·cos φ. Verify with a calculator."
3. "Find the loci: B can only sit on its two horizontals. The projector
   shift dx = 40 mm completes TL² = dx² + dh² + dd²."
4. Exercise: predict EL for TL = 100, φ = 60° (answer: 50 mm), then check
   with `EduCADCurriculum.straightLine({TL:100, thetaDeg:0, phiDeg:60})` in
   the console and read back its `EL` field.

**Script C — Reading solids (15 min, needs: Hexagonal Prism demo).**
1. "Cover the bottom half: what 3D shape could the rectangle be? (Anything
   flat.) Now uncover the hexagon: only a hex prism fits both."
2. "Every hidden edge here coincides with a visible one, so the sheet shows
   no dashed lines — visible wins. Mark each hidden corner with parens and
   press Check; then orbit in 3D and watch the dashed edges move. Hidden
   depends on viewpoint; the sheet records your verdict instead."
3. "Trace each projector from a hexagon corner to its elevation station."
4. Exercise: students Clear the sheet, hand-draw plan+elevation rectangles
   at shared x-stations (axis lock, §6.2) leaving one plan edge open, and
   read the failure message; then they draw the missing edge and watch
   the box appear in 3D.

**Script D — Planes and traces (10 min, console lesson).**
1. Build `EduCADCurriculum.planeSurface({tiltDeg:30})` and read its `steps`
   aloud.
2. "HT and VT meet on XY — a plane's traces always meet on the ground
   line. The tilt angle lives only in the elevation."
3. Exercise: change `tiltDeg` to 45 and 60; predict the VT tip
   (`x + size·cos tilt`, `size·sin tilt`) before rebuilding.

**Script E — Why 3D sometimes refuses (10 min, any drawing).**
1. Clear the sheet, place two points above XY, join them with any line
   type: read `no plan view drawn`.
2. Clear, then place all eight rectangle corners at shared x-stations
   (axis lock, §6.2) and join the full elevation rectangle but only three
   of the four plan sides: read
   `plan loop edge <n> is not drawn (non-convex?)`.
3. Draw the missing edge: the box appears. "The 3D view never guesses —
   every refusal names the exact missing piece. Read the second line."

### 9.3b Competing points, verdicts, and Check

Corners that share one projection are *competing points*: one dot, two
corners, one of them hidden. The prism and square demos ship every station
as an unjudged pair (`f',b'`); the analysis is yours.

**Words that do not flip.** *Front*/*back* live in space; *upper*/*lower*
live in the drawing. Front = foremost in space = largest depth = the
*lowest* dot in plan (most negative y). Back = the plan dot nearest XY.
Top/bottom = largest/smallest height = upper/lower in elevation. Never say
bare "near/far" — it means opposite things in the two spaces.

**Verdicts.** Wrap the hidden member in parentheses: `a,(b)` says `b` is
hidden *in this view*. Judge from the *other* view: compare depths in plan
to call elevation (back hides), heights in elevation to call plan (bottom
hides). One view alone can never disqualify a competitor — that is the
whole lesson. Parentheses never affect 3D; they are your answer sheet.

**Claims.** Draw a Type G projector through the pair dot down to its mate
view: same-letter corners stacked on the line pair into 3D — no popup
asks, the ink declares (scripted lessons may still bank a member
explicitly). The declaration plus the feet form checkable claims. Claims
belong on projectors: a projector-shaped line that lands on no drawn
point fails Check, so draw shared edges
before naming (as the §9.4 tutorial does). Consistent claims do more
than pass Check — where geometry alone is ambiguous, the claims lift
them into 3D: one claim, one corner, face from the convex hull.
Contradictory claims fail by name (`hint-conflict`, `duplicate-corners`)
instead of guessing.

**Check hidden.** Grades the loaded demo sheet (prism, 3-view, square):
every flipped verdict and every mismatched projector foot is named in the
report panel (× or loading a demo dismisses it). A fresh demo fails on
purpose — add your parens first, then press Check. On hand drawings and
the line/points demos there is no reference sheet, so every verdict and
claim reports *unverifiable* instead of failing. Profile stations are not
checked in v1.

### 9.4 Tutorial: Square (scripted user)

`Tutorial: Square` replays the Profile Square lesson click by click in a
stepper panel (bottom-left): each **Next** performs exactly one real user
action — place, rename, anchor, lock, line-type pick — through the same
functions your clicks call, with one line of narration per step. 32 steps:
datum, four corner dots, shared edge-on outlines (drawn *before* naming,
so no member claim attaches to shared ink), neutral pair names, one
declared projector per corner, paren verdicts, then Check. Watch the 3D
widget: the lamina grows as claims land (triangle at three, square at four).

**Back** re-reads only — nothing undraws. **Restart** replays from step 1
(the sheet keeps what was drawn; step 1 clears it again). **Exit** closes
the panel and leaves the sheet yours. Loading any demo also closes it. If
you rename or delete a tutorial dot mid-run, the stepper says so instead
of guessing — press Restart.

### 9.5 Tutorial: Prism (scripted user)

`Tutorial: Prism` replays the hexagonal-prism lesson the same way, in
88 steps: datum, six plan dots around the flat-top hexagon (back edge
nearest XY, front edge deepest), eight elevation dots (four lone
silhouette corners, four stacked front+back pairs), twelve Type A ink
lines (hexagon + 35×70 rectangle + two facet verticals, drawn *before*
naming), four full-height Type G projectors (k'/l' reach
k/l), neutral pair names, paren
verdicts (plan bottoms hide under the top face; elevation backs hide
behind the front), then Check. No banked claims: here the drawn
projectors declare every correspondence, so the square's banked claims
would be ritual, not rescue.
Watch the 3D widget: the solid builds itself the moment the last name
lands (step 77), before a single verdict is judged. The finale grades
18/18 — 14 stations plus 4 projector wellformed checks.

---

## 10. Reference tables

### 10.1 Mouse actions

| Action | Context | Result |
|--------|---------|--------|
| Left-click empty sheet | No tool armed | Place point (axis-locked if a selection exists) |
| Left-click a point | No tool armed | Select it (amber ring) |
| Left-click empty sheet | Menu open / polar sweeping | Abort the tool, nothing created |
| Left-click empty sheet | Banking | Abort the bank, nothing created |
| Left-click a point P2 ≠ P1 | One point banked | Finalize the line: lock P2, open line-type popup |
| Left-click a banked point | Banking | No-op (Ctrl+click it again to unbank) |
| Ctrl/Cmd+click a point | Any | Toggle it in the two-slot bank (preempts menu/polar/plotting) |
| Ctrl/Cmd+click empty sheet | Any | Place a point and bank it (bank-full warns instead) |
| Left-click a segment | One point banked | Start polar from the bank (baseline must pass through P0) |
| Left-click anywhere | Polar angle sweep | Lock the angle |
| Left-click anywhere | Polar distance sweep | Commit the polar point |
| Left-click anywhere | Polar invalid | Drop the tool |
| Left-click a segment | Nothing armed | Begin line-referenced plotting |
| Alt+click near the VP/HP fold (within 14 px) | Nothing armed | Focus the ground line for plotting |
| Left-click anywhere | Plotting | Commit the plotted point |
| Left-click | During 300 ms line animation | Ignored |
| Left-click an entity | View mode | Inspect it: readout badge, nothing changed |
| Left-click empty sheet | View mode | Clear the readout |
| Right-click | View mode | Clear the readout (never opens the menu) |
| Double-click, typing | View mode | Ignored (read-only) |
| Double-click a point | Line/polar not armed | Begin rename |
| Double-click a point | Line/polar armed | Ignored |
| Double-click on 3D ink | — | Reset 3D to isometric rest pose |
| Right-click | Anything active/selected | Cancel all (never opens menu) |
| Right-click empty sheet (≥14 px from snap targets) | Idle | Open `Plain (No Mesh)` / `Box Mesh` menu |
| Right-click near snap target (<14 px) | Idle | Nothing (menu suppressed) |
| Wheel | Over sheet | Zoom ×1.15 about cursor |
| Wheel | On 3D ink | Zoom 3D, smooth, cursor-anchored (sheet untouched) |
| Middle-drag | On 3D ink | Pan 3D model (clamped: never lost) |
| Middle-drag, or Shift+left-drag | Off 3D ink | Pan sheet |
| Left-drag | On 3D ink | Orbit (Shift/Ctrl/Cmd/Alt held, or 2D tool armed: sheet instead) |

### 10.2 Keyboard shortcuts

| Key | Context | Result |
|-----|---------|--------|
| Printable character, Space | Renaming | Append to name buffer |
| Backspace | Renaming | Delete last buffer character |
| Enter | Renaming | Commit (trim; blank deletes the point; unchanged writes nothing) |
| Digits, dot | Point selected, nothing else armed | Append to the typed distance (§6.2) |
| Digits, dot | Line focused (plotting) | Append to the typed offset (§4.6); the line owns the keyboard |
| Backspace | Typed distance active | Delete the last distance character |
| Enter | Typed distance active, line focused | Stake the point at the typed perpendicular mm (ends plotting) |
| Enter | Typed distance active, point selected | Stake the point at the typed mm along the axis, toward the cursor |
| `/` | Sheet focused, not renaming | Open the command line with `/` ready (see §3.11) |
| Enter | Command line focused | Run the typed `/command`, close the bar |
| Tab | Command line, suggestions open | Accept the highlighted suggestion |
| Up / Down | Command line | Walk suggestions, else recall history |
| Escape | Command line focused | Close the bar without running |
| `Tab` | Sheet focused | Enter pose mode, or exit it (§3.13) |
| `G` / `R` / `S` | Pose mode, no gesture | Start move / rotate / scale |
| `X` / `Y` / `Z` | Pose gesture running | Lock the gesture to one world axis |
| `Ctrl` | Pose gesture running | Snap to 5 mm / 5° / 0.1 |
| `Enter` / click | Pose gesture running | Confirm the transform |
| `Escape` / right-click | Pose gesture running | Cancel back to the gesture start |
| `Alt+G` / `Alt+R` / `Alt+S` | Pose mode, no gesture | Clear move / rotate / scale |
| `1` / `3` / `7` | Pose mode | Front / right / top camera (`Ctrl`: back / left / bottom) |
| Escape | Any | Cancel selection/rename/tools/menus (a typed distance clears first; rename buffer discarded) |
| Escape | View mode | Clear the inspect readout |
| Any other key (arrows, Delete, Tab, …) | Renaming | Ignored |
| Ctrl/Cmd/Alt + any key | Renaming | Ignored (modifier combos never edit) |
| Any key | Not renaming (except Escape) | Nothing |

There are no tool hotkeys, no Delete shortcut, no zoom
keys. Drawing is mouse-driven or typed (`/` command line, §3.11).

### 10.3 Tool summary

| Tool | Reach | Creates | Cancel |
|------|-------|---------|--------|
| Place point | Click empty sheet | `POINT` (auto-named, role by y-sign) | — |
| Select | Click point | Reference only | Right-click / Escape |
| Typed distance | Point selected: type mm, aim axis, Enter | `POINT` at the exact axis distance | First Escape clears the buffer |
| Line/segment + BIS popup | Bank P1 (Ctrl+click), click P2, pick style | `SEGMENT` (`BOTH`, unlabeled) | Right-click / Escape / empty click |
| Polar point | Bank P0 (Ctrl+click), click baseline, click angle, click distance | `POINT` at polar target | Right-click / Escape / invalid-click |
| Line-referenced plotting | Click segment, click candidate (or type mm + Enter) | `POINT` at perpendicular offset | Right-click / Escape |
| Ground-line plotting | Alt+click the fold, click candidate (or type mm + Enter) | `POINT` at fold offset | Right-click / Escape |
| Sheet menu | Right-click empty sheet | Grid on/off only | Click option / right-click / Escape / pointer-down |
| View inspect | View mode: click an entity | Readout only (never an entity) | Empty click / right-click / Escape |
| Pan / zoom / Home | Middle- or Shift-drag / wheel / buttons | View only | — |
| 3D orbit / zoom / pan / reset | On-ink gestures (§8.2) | View only | — |
| Command line | `/`, type, Enter (§3.11) | All nine types (`POINT` `SEGMENT` `RAY` `LINE` `CIRCLE` `CIRCULAR_ARC` `TEXT` `DIMENSION` `DATUM_AXIS`) + demos/tutorials/check/mode | Escape clears the bar |
| Pose mode | Pose button / `Tab` (§3.13) | Ghosts only (visualization) | `Tab` exits, table untouched |
| Ray, arc, projector, ruler, compass, solver, save | **Not in UI** | — | — |

### 10.4 Entity types

Nine types exist in the data model; the sheet renderer draws five.

| Type | Drawn on sheet? | Created in UI? | Notes |
|------|-----------------|----------------|-------|
| `POINT` | Yes (3 px dot + label) | Yes | Auto-named; only selectable type |
| `SEGMENT` | Yes (BIS style) | Yes (line tool) | Unlabeled; spans `BOTH` views |
| `LINE` | Yes (BIS style, finite p1→p2 stroke) | No | Demo loci/axes only |
| `CIRCLE` | Yes (if present) | No | No creation gesture; defers 3D |
| `CIRCULAR_ARC` | Yes (if present, y-flip angle mapping) | No | No creation gesture; defers 3D |
| `DIMENSION` | **No** (renderer skips it) | No | No gesture; API-only |
| `TEXT` | **No** (label pass only) | No | No gesture; API-only |
| `RAY` | **No** | No | Nothing draws or creates it |
| `DATUM_AXIS` | **No** (only its X/Y end labels) | No | Demos only; locked against moves by default |

BIS styles: A solid 0.50 thick · B solid 0.20 thin · E dash `[8, 4]`
0.35 thin · G chain `[12, 3, 2, 3]` 0.20 thin · H same dashes as G with
0.50 thick ends · K double-dash `[12, 3, 2, 3, 2, 3]` 0.20 thin.
Dimension arrowheads are specified 3.5 × 1.167 mm (3:1) with outward flip
under 30 px, but no drawn dimension reaches that code from the UI.

### 10.5 Status and message strings

Sheet strings:

| String (exact) | Where |
|----------------|-------|
| `EduCAD 2D Engine` • `1st Angle Monge Projection` | Status HUD line 1 (static) |
| `VP (Elevation)` | Plane pill before first mouse move |
| `V.P. (Elevation / Front)` / `H.P. (Plan / Top)` | Plane pill live (`y >= 0` / `y < 0`) |
| `X: 0.00 mm • Y: 0.00 mm (Ground Line XY)` | Coordinates before first mouse move |
| `X: <n> mm • Y: <n> mm` (2 decimals) | Coordinates live |
| `V.P. (Front View / Elevation)` / `H.P. (Top View / Plan)` | Sheet watermarks |
| `X` / `Y` | XY end marks (sheet, or datum end labels when demos load) |
| `Plain (No Mesh)` / `Box Mesh` | Sheet right-click menu |
| `Continuous Thick — Type A` … `Double-Dash Chain — Type K` | Line-type popup tooltips (5 rows) |
| `+` / `-` / `Home` | Zoom HUD |
| `Line Rotation (TL=80, θ=30°, φ=45°)` etc. | Demo bar (6 buttons, §3.2) |
| `Manual` | Demo bar link: opens this guide in a new tab (`manual.html`) |
| `ΔX: <n> mm` / `ΔY: <n> mm` | Axis-lock badges |
| `∠ <n>°` / `<r> mm (∠ <θ>° locked)` / `⊥ Dist: <n> mm` | Polar / plot badges |
| `locus of <name>` | Locus line labels (`locus-` captions rewritten) |
| `3D unavailable` + reason subtitle | 3D failure state (§8.8) |

3D reason subtitles: see the complete list in §8.8 (11 reason codes + 3
empty-state wordings + detail templates — the 3D view shows details, not
canonical text, except `curves not supported yet`). No other error dialogs,
toasts, or status strings exist in the app.

### 10.6 Snappable geometry

Effective snap sources on the sheet (all tiers always on; first match in
priority order within 14 px wins):

| Tier | Source geometry on a default demo sheet |
|------|-----------------------------------------|
| ENDPOINT | Every point dot; every segment end |
| INTERSECTION | Segment/line crossings (e.g. projector × locus in the prism demo) |
| MIDPOINT | Every segment midpoint |
| CENTER | Nothing on the four demo sheets (no circles) |
| PROJECTOR / LOCUS | Never fire (page sends no station lists) |

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Click does nothing / no point appears | A tool is armed (clicks feed it), or you clicked within 14 px of a point (re-select), or during the 300 ms line animation (ignored) | Right-click or Escape to disarm, then click clearly empty sheet |
| Line-type popup never opens | You clicked empty sheet (aborts the bank), clicked P1 itself (no-op), banked two (third click circles), or never banked P1 | Ctrl+click P1 (crosshair + numeral appear), then click a *different* point |
| Popup shows dash samples but no text | By design: rows are preview-only | Hover a row for its `… — Type X` tooltip |
| Polar tool dies after baseline click | Clicked line misses P0 by > 0.5 mm → invalid state; next click drops it | Bank P0 again (Ctrl+click) and click a segment through P0 |
| `∠` badge stuck / no distance sweep | You have not locked the angle yet | Left-click once to lock the angle, then sweep distance |
| Plotted point lands at segment end | Foot clamps to [A, B] past the ends; offset is kept from the clamped foot | Aim the cursor between the ends for interior feet |
| Right-click opens no menu | Something is active (right-click cancels first), or cursor is within 14 px of a snap target | Right-click once to cancel, move to clearly empty sheet (away from dots, ends, midpoints, crossings), right-click again |
| Rename typing does nothing | Not in rename mode (double-click first), or line/polar tool armed (dblclick ignored), or key is non-printable | Disarm tools, double-click the point, type letters/digits/Space |
| Enter does nothing visible | Name unchanged (no write by design) | Change at least one character, or Escape out |
| Point vanished after rename | You committed a blank/whitespace-only name: that deletes the point | Re-place the point, or press Ctrl+Z to undo the rename |
| Segment stays after deleting its points | Segments store positions, not point references | Nothing to fix: redraw, or Clear Sheet and start over |
| Grid won't show / won't hide | Wrong menu option, or menu dismissed by pointer-down elsewhere | Right-click empty sheet → `Box Mesh` (show) / `Plain (No Mesh)` (hide); confirm on the sheet (no checkmark is drawn) |
| Sheet looks empty after demo click | Demo always clears first, then loads; a failed load would leave it empty | Click the demo button again; check the 3D message |
| 3D shows `3D unavailable` | Nothing with both views drawn (§8.8) | Draw the missing mate, or load a demo |
| 3D shows `no plan view drawn` / `no elevation view drawn` | Curve/claim sheet missing a view | Draw the missing view on the other side |
| 3D shows `curves not supported yet` | Curves but no usable circle and nothing else resolved | Trace a polygonal outline; see §8.7 |
| 3D corner missing though both dots exist | Dots differ in x beyond 0.5 mm, or names differ (§8.6) | Re-place at shared x (axis-lock); check captions |
| 3D shows `ambiguous…` | Two plan circles compete, or XY ink reads two ways | Keep one circle; delete duplicates |
| 3D shows a `hint-…` / `duplicate-…` reason | A banked claim contradicts the drawing (§8.6) | Fix or delete the named claim |
| 3D never updates / looks stale | `[unverified]` in normal use — rebuilds run every frame on change; a frozen 3D view suggests a script error | Reload the page (sheet is lost — there is no save) |
| Page address `#…` loads wrong demo | Only `#points`, `#prism`, `#3view`, `#square`, `#mesh` are recognized; anything else loads Line Rotation | Fix the hash or click the demo button |
| Check hidden fails on a fresh demo | Demos ship pairs without verdicts — that is the exercise, not a bug | Add parens (§5.3, §9.3b), then Check again |
| App opens on a login page, not the sheet | No session yet: the gate redirects before any canvas loads | Pick a role tab + its demo account, or Continue as guest (§3.8) |
| Login says `Invalid username or password` | Wrong pair for the active role tab | Match the tab to the account; the demo pairs print under the form |
| `Desktop required` overlay, no canvas | Touch-only small screen blocked by the desktop gate | Open on a desktop/laptop; the overlay links the tutorials sheet (§3.8) |
| Clicks won't draw anything | View mode is on: it measures, never edits | Switch back to Edit (§3.9) |
| Server prints `port 8124 busy, using N` | Port occupied (another server or runaway process) | Open the printed port; stop the other server if it is yours |
| `npm start` fails immediately | Build tools/libsodium missing, or port range exhausted | Install Node, CMake, a C++ compiler and libsodium-dev; free ports 8124–8133 |

---

## 12. Limitations / not implemented

Each item was verified absent: no gesture, button, key, or menu triggers
it, and (unless noted) no remnant wires it to the screen.

**Drawing & editing.**

1. No save, open, export, print, or persistence of any kind; reload loses
   the sheet. (An SVG exporter exists only in the developer API.)
2. No drag-move of points or segments; misplaced geometry must be deleted
   (points) or abandoned (segments) and redrawn.
3. No erase/delete tool and no Delete key; only blank-rename delete and
   Clear Sheet.
4. No segment selection at all; multi-select banks points only
   (two slots, §4.3).
5. No arc, ray, dimension, text, axis, datum, or projector creation
   gestures (circles bank two points plus a finalizer, §4.9). No virtual ruler/compass
   gestures (engines exist, unwired).
6. No line-thickness picker; on-screen weights are fixed 1 px / 2 px.
7. BIS Type H is not offered in the line-type popup.
8. No rubber-band preview before P2; no segment editing after commit.
9. No snap toggles, no snap badge text, no PROJECTOR/LOCUS snap tiers
   (engine supports six tiers; the page wires four and draws only the ring).

**Views, sheet, 3D.**

10. No sections, perspectives, shading, or 3D export;
    hidden-line rendering is the only 3D analysis. (A first-angle
    side/profile view is supported — §8.6.)
11. Arc-only sheets report `curves not supported yet`;
    full-circle cylinders and cones do reconstruct (revolved, §8.6–§8.7).
12. Faces are never inferred: the 3D view is wireframe only, concave and
    convex alike. Coincident same-name dots pair nothing; draw one corner
    per name per station.
13. Absolute mm do not survive into the 3D stage (uniform re-scaling);
    only proportions do.
14. 3D warnings (`curves-ignored`, `on-datum-placed`, `helpers-ignored`)
    are computed but never displayed.
15. No grid customization (fixed steps, fixed style); no layers panel; no
    background/paper options.

**Platform & workflow.**

16. No touch/pen input on desktop and no accessibility claims — untested
    (`[unverified]` if you need them: try before teaching with them).
    Touch-only small screens are blocked outright by the desktop gate
    (§3.8), so there is no mobile layout to claim.
17. No browser-driven tests inside `npm test` (Node plus a local
    throwaway C++ server only); browser behavior beyond one obscura
    smoke check is `[unverified]`, and no specific browser versions
    are claimed.
18. Demo-only accounts (three roles + guest, `localStorage` session, no
    real security — see §3.8). Demo passwords ship in `tools/users.json`
    and `educad-seed` hashes them into SQLite on first run. No sharing,
    printing pipeline, or print-accurate (mm-true) output; print/export
    scaling helpers exist only as code functions.

---

## 13. Appendix (developer reference)

### 13.1 Module map

App shell: [`mirror/index.html`](../mirror/index.html) (all UI wiring,
rendering, and event handling). Library modules in
[`mirror/files/www.geogebra.org/`](../mirror/files/www.geogebra.org/):

| File | Role | Wired to UI? |
|------|------|--------------|
| `educad-viewport.js` | mm↔px math, cursor-anchored zoom, projector check | Yes |
| `educad-canvas.js` | Menus, selection/rename, line/polar/plot/circle-pick state machines, label drawing primitives | Yes |
| `educad-entities.js` | Entity model, table, BIS styles, cosmetic weights | Yes |
| `educad-shim.js` | GeoGebra-compatible command API (39 methods, 14 commands) | **No** (applet created, never called by page) |
| `educad-solver.js` | Line rotation, loci, LM constraint solver | **No** (handle created, never used by page) |
| `edugraphics-snapping.js` | 6-tier snap engine | Partial (4 tiers; ring only, no badges) |
| `edugraphics-instruments.js` | Virtual ruler + compass state machines | **No** (created, never driven) |
| `educad-curriculum.js` | Lesson data builders (quadrant/line/plane/solids) | Partial (5 lesson demos via buttons; rest console-only) |
| `educad-tutorial.js` | Scripted tutorials (square 32 steps, prism 88) replayed through real user actions | Yes |
| `educad-verify.js` | `Check hidden` grading of verdicts and projector claims | Yes |
| `educad-labels.js` | 3-tier label layout + leader fallback | Yes |
| `educad-solid.js` | Full-screen 3D glass (orbit/zoom/pan/aura/render) | Yes |
| `educad-reconstruct.js` | Two/three-view → 3D live wireframe + claims/curves readers, named failures | Yes |
| `edugraphics-common.js` | Dual-layer mount, zoom HUD, 2-option menu | Yes |
| `educad-boot.js` | Cold-boot wiring of all modules | Yes |
| `educad-measure.js` | Edit/View mode state, single-click inspect readouts (coords, L/Δ/∠, r/Ø), View hit-testing | Yes |
| `edugraphics-hud.css` | HUD/menu/glass positioning | Yes |

Server: [`backend/src/main.cpp`](../backend/src/main.cpp) (`npm start`
builds and runs `educad-server`, 127.0.0.1:8124, static files plus the
JSON API).
Manual page: `tools/build-manual.js` (`npm run build:manual` renders
`docs/MANUAL.md` → `mirror/manual.html`, opened from the demo bar).
Tests: [`tools/test-*.js`](../tools/) (1013 checks, all green at writing
time — see the repo README for the per-phase list), including
`tools/test-phase11-manual.js` (manual build, in-app link, freshness),
`tools/test-phase12-reconstruct-3view.js` (side-view reconstruction),
`tools/test-phase13-curves.js` (revolved-reader cylinders/cones, circle gesture),
`tools/test-phase14-glass.js` (fullscreen 3D glass, aura, gestures),
`tools/test-phase15-demo-3view.js` (3-view demo button wiring),
`tools/test-phase16-line-circle.js` (bank + finalizer clicks),
`tools/test-phase17-point-cascade.js` (point-delete line cascade),
`tools/test-phase18-two-point-line.js` (two-point line property),
`tools/test-phase19-multi-caption.js` (competing captions),
`tools/test-phase20-claims-verify.js` (Check hidden grading),
`tools/test-phase21-tutorial.js` + `tools/test-phase23-prism-tutorial.js`
(scripted tutorials), `tools/test-phase22-claimed-lamina.js` (claimed corners),
`tools/test-phase24-typed-distance.js` /
`tools/test-phase25-plot-typed.js` / `tools/test-phase26-ground-plot.js`
(typed entry + ground-line datum), `tools/test-phase27-pick-bank.js`
(two-slot bank), `tools/test-phase28-view-measure.js` (Edit/View toggle,
select-and-measure inspect), and `tools/test-login.js` (demo roles +
guest gate).

### 13.2 Behavior anchors (file:line)

Key behaviors and where they live (line numbers at writing time;
older rows predate the tutorial / Check / login additions and may have
drifted — the demo-bar, gate, and session rows were re-verified for this
revision).

- Status HUD + demo bar (10 buttons, Manual last): `mirror/index.html:200-215`
- Login gate + mobile gate + session chip: `index.html:142-152`, `:160-199`,
  `:218-244`
- Boot + module wiring: `index.html:97-101`, `educad-boot.js:80-136`
- XY ground line + watermarks + X/Y marks: `index.html:351-378`
- Grid: `index.html:326-349` (steps), `educad-canvas.js:817-831` (toggle)
- Entity rendering (5 drawn types): `index.html:409-463`
- Snap ring draw: `index.html:488-498`; snap compute: `index.html:677-678`
- Selection ring + rename preview: `index.html:500-521`
- Axis-lock badge: `index.html:523-535`; math: `educad-canvas.js:379-405`
- Line preview: `index.html:537-554`; state machine:
  `educad-canvas.js:428-515`
- Polar previews + badges: `index.html:556-607`; math: `educad-canvas.js:517-709`
- Plot preview + badge: `index.html:609-628`; math: `educad-canvas.js:711-774`
- Pan / hover-HUD / wheel: `index.html:638-701`
- Right-click cancel + sheet menu: `index.html:703-769`
- Click dispatch (place/select/tools): `index.html:771-901`
- Double-click rename + keys: `index.html:903-959`; buffer rules:
  `educad-canvas.js:312-372`
- Auto-naming: `educad-canvas.js:340-359`
- Zoom buttons: `index.html:962-976`; HUD mount: `edugraphics-common.js:121-174`
- Demo loaders + hashes: `index.html:979-1035`; lessons:
  `educad-curriculum.js:130-470`
- 3D mount + live bridge: `index.html:1259-1300`; glass:
  `educad-solid.js:1080-1233`; render: `educad-solid.js:1005-1071`
- Reconstruction + reasons: `educad-reconstruct.js:40-55` (labels),
  `:101-186` (filter/classify), `:790-1607` (claims/curves readers),
  `:1609-1808` (reader shell), `:1810-1848` (router), `:1849+` (wire core)
- Label layout: `educad-labels.js:86-102` (filter), `:479-514` (resolve)
- BIS styles + cosmetic weights: `educad-entities.js:24-31`, `:157-175`

Console glue for loading a lesson onto the sheet (developer task):

```js
var lesson = EduCADCurriculum.planeSurface({ tiltDeg: 30 });
// handle.table is the app table only inside the page closure;
// from the console, rebuild via the visible demo path or extend the page.
lesson.steps.forEach(function (s) { console.log(s); });
```

Note: the page closure does not expose the table, so console-built lessons
currently serve as printed scripts unless the page is extended — the four
demo buttons remain the only in-app lesson loaders.

### 13.3 Traceability table (manual claim → anchor)

| # | Manual claim | Code / test anchor |
|---|--------------|--------------------|
| 1 | mm world; px ephemeral | `educad-viewport.js:9-11`; `test-phase2` #38–39 |
| 2 | elev.x == plan.x, eps 1e-9 | `educad-viewport.js:110-114`; `test-baseline` #28 |
| 3 | First-angle layout (plan below, elev above) | `index.html:375-376`; fixtures `layout: monge-first-angle` |
| 4 | `npm start` → 127.0.0.1:8124 | `backend/src/main.cpp:56,2596-2603`; `package.json` scripts |
| 5 | Port busy → next port + message | `backend/src/main.cpp:2619-2625`; `test-cpp-backend` #18 |
| 6 | HUD labels + pill rule y>=0 | `index.html:61-64`, `:659-666` |
| 7 | Demo-bar button labels (10, Manual last) | `index.html:205-215`; `test-phase11` #18, `test-phase20` #22 |
| 8 | Zoom labels `+ - Home`, ×1.25, home s=2 | `edugraphics-common.js:27`; `educad-canvas.js:143-151` |
| 9 | Menu labels + 14 px suppression | `educad-canvas.js:23-26`, `:62-68`; `test-phase1` 2-option/14px |
| 10 | No toolbar/palette exists | grep: zero matches for toolbar/palette/toolbox/ribbon |
| 11 | 5 BIS popup rows + tooltips; no H | `index.html:136-142`, `:155` |
| 12 | Watermarks + X/Y marks | `index.html:366-376` |
| 13 | Place/select click flows, 14 px | `index.html:771-901`; `educad-canvas.js:266-287` |
| 14 | Line tool 4-step + 300 ms + P1≠P2 | `index.html:246-292`, `:856-871`; `educad-canvas.js:428-503` |
| 15 | Polar 5-step, 0.5 mm, detents ±2° | `index.html:806-838`, `:556-607`; `educad-canvas.js:517-697` |
| 16 | Plot 3-step, ⊥ badge, clamped foot | `index.html:822-825`, `:848-855`, `:609-628`; `educad-canvas.js:737-764` |
| 17 | DIMENSION/TEXT/RAY/DATUM not drawn | `index.html:425-456` (only 5 branches); §10.4 |
| 18 | Ruler/compass/solver/shim unwired | grep: no page calls to `ruler*`, `compass*`, `solverHandle`, applet methods |
| 19 | Rename keys/trim/blank-delete | `index.html:922-959`; `educad-canvas.js:312-338`; `test-phase1` rename |
| 20 | Auto-naming a..z,a1.. + reuse | `educad-canvas.js:340-359`; `test-phase1` next point name |
| 21 | Right-click/Escape cancel-all; no native menu | `index.html:703-725`, `:922-939` |
| 22 | No move/drag/Delete/multi-select | grep: `table.move`/Delete-key absent from page |
| 23 | Snap 4 wired tiers, 14/22 px, ring only | `index.html:677-678`, `:488-498`; `edugraphics-snapping.js:19-23`, `:380-387` |
| 24 | PROJECTOR/LOCUS never fire in page | `index.html:677` passes no station lists; `edugraphics-snapping.js:365-377` needs them |
| 25 | Axis lock + Δ badges | `educad-canvas.js:379-405`; `index.html:525-535`, `:885-893` |
| 26 | Wheel ×1.15 cursor-anchored; clamp 0.05–50 | `index.html:690-701`; `educad-viewport.js:13-14`, `:65-77` |
| 27 | Cosmetic 1 px/2 px, cutoff 0.35 | `educad-entities.js:157-175`; `test-phase2` #47–51 |
| 28 | Quadrant signs incl. Q3 demo numbers | `educad-curriculum.js:141-144`; `index.html:999-1000` |
| 29 | Line demo numbers (dx=40, PL/EL, loci) | `index.html:991-994`; `educad-curriculum.js:207-214` |
| 30 | Prism demo (hex, 35×70, corners, facets, no seam) | `index.html:1006`; `educad-curriculum.js:348-389` |
| 31 | viewRole assignment rules | `index.html:220`, `:240`, `:284`, `:897` |
| 32 | 3D geometry (glass state, aura, iso pose, styles) | `educad-solid.js:21-58`, `:773-968`; `test-phase9` iso/hidden, `test-phase14` glass/aura |
| 33 | 3D gestures + aura routing | `index.html:673-748` route, `:840-859` wheel; `educad-solid.js:337-355`, `:819-863`, `:976-1000` tap; `test-phase9` legacy, `test-phase14` aura |
| 34 | Live rebuild per frame; derived-only | `index.html:1047-1070`; `educad-entities.js:247-255` subscribe |
| 35 | Classes A/B/C/D + tolerances + gate 0.999 | `educad-reconstruct.js:29-34`, `:555-1339`; `test-phase10`, `test-phase13` |
| 36 | Circles reconstruct (D), arcs deferred + hidden warnings | `educad-reconstruct.js:105-106`, `:1472-1515`; page ignores `warnings`; `test-phase13` |
| 37 | All 3D reason strings | `educad-reconstruct.js:41-53` + fail call sites; §8.8 |
| 38 | Console lessons + dispatcher kinds | `educad-curriculum.js:473-511` |
| 39 | Hashes #points/#prism/#3view/#square/#mesh; default line | `index.html:1019-1034` |
| 40 | Drawing saves (account) + tutorial progress | C++ `/api/drawings`, `/api/progress`; `educad-saves.js` snapshot/restore; session-bar Save/Drawings; `npm run test:cpp`, `npm run test:saves`; guests stay local-only |
| 41 | Hand recipes §4.8 (box 8v/12e, pyramid 5v/8e) | `EduCADReconstruct.reconstruct` validation (`ok`, full coverage, no warnings); cf. `test-phase10` hand-box/prism/pyramid cases |
| 42 | In-app Manual button + generated manual page | `index.html` demo bar (`btn-manual` → `manual.html`); `tools/build-manual.js`; `test-phase11` |
| 43 | 3-view demo button loads the prism sheet | `index.html` demo bar (`btn-demo-3view` → `threeViewSheet`); `tools/test-phase12-reconstruct-3view.js` (engine proof); `tools/test-phase15-demo-3view.js` (wiring proof) |
| 44 | Edit/View toggle + read-only measure readouts | `educad-measure.js` (mode state, hit test, readout numbers); `index.html` mode pair (`btn-mode-edit`/`btn-mode-view`), inspect/clear paths; `tools/test-phase28-view-measure.js` |

Line numbers refer to the files as of this writing; behavior (not line
numbers) is the contract. If a line drifts, search the file for the quoted
string — every quoted string in this manual appears verbatim in the code.

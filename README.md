# EduCAD

EduCAD is a zero-dependency teaching CAD for first-angle Monge projection
(engineering drawing): a millimetre-precise 2D sheet with elevation above
and plan below the XY ground line, plus a live pen-sketch 3D widget that
reconstructs the drawn views.

- **User manual:** [`docs/MANUAL.md`](docs/MANUAL.md) — the complete guide
  for students and teachers (drawing, editing, precision, 3D view, demos,
  lessons, reference, troubleshooting).
- The in-app manual page ([`mirror/manual.html`](mirror/manual.html),
  opened from the demo-bar **Manual** button) is generated from
  `docs/MANUAL.md` — run `npm run build:manual` after editing the Markdown.
- **Design note:** [`docs/2d3d-problem-statement.md`](docs/2d3d-problem-statement.md)
  — the locked 2D⇄3D reconstruction contract.

## Run

```sh
npm start      # build + seed + serve on http://127.0.0.1:8124/ (localhost only)
```

`npm start` compiles the C++ backend on first run (needs CMake, a C++17
compiler and libsodium headers — see Development below), seeds the demo
accounts into `backend/data/educad.db`, and serves `mirror/` plus the
JSON API. Open the printed URL in a browser. If port 8124 is busy the
server picks the next free port and prints it; `npm start -- <port>` or
`PORT=<port>` overrides the port.

The demo bar (top-right) has a **Manual** button that opens the in-app
user manual in a new tab. The manual page is generated from the Markdown
source: after editing `docs/MANUAL.md`, run `npm run build:manual`.

## Login

Opening the app redirects to [`mirror/login.html`](mirror/login.html):
pick the **Academics**, **Teacher**, or **Student** tab and log in, or
**Continue as guest** (guest skips the server entirely: no saves, the
sheet stays local). Each role lands on its own home: teachers and
academics on the **Teacher studio** ([`mirror/teacher.html`](mirror/teacher.html):
create classes, post question sets (single, bulk text, or file upload)
to a class or as open sets, attach model-answer drawings per question
with a strict auto-check toggle, review submissions grouped by question
in read-only View mode, and grade with remarks and pass/fail), students
on the **Student workspace** ([`mirror/student.html`](mirror/student.html):
join classes, solve sets, verify drawings against the hidden model
answer (pass/fail only, the model is never shown), manage drawings,
track submissions, grades and tutorial progress),
guests on the bare sheet. Demo credentials:

| Role | Username | Password |
|------|----------|----------|
| Academics | `academics` | `admin123` |
| Teacher | `teacher` | `teach123` |
| Student | `student` | `learn123` |

The server is the C++ backend (`backend/`, vendored httplib/JSON/SQLite
+ libsodium): `educad-seed` hashes the demo passwords from
`tools/users.json` (outside the served root, never sent to browsers)
into SQLite, sessions are server-side tokens with 24 h expiry, and
logged-in users get drawing saves plus tutorial progress.

The session chip (bottom-left) shows who is logged in; **Save** stores
the sheet to your account (first save asks for a title, later saves
update), **Drawings** lists/loads/deletes saved sheets, **Sets** runs
the teacher/student question loop (coded sets, drawing submissions),
**Studio**/**Workspace** returns to your home page, and **Logout**
clears the session and returns to the login page.
Finishing a tutorial records progress and earns its lesson button
a ✓ next visit.

## Test

```sh
npm test       # full suite: baseline + phases 1–46 (1047 checks), plus spatial inspection
```

| Command | Suite |
|---------|-------|
| `npm run test:baseline` | Baseline: affine/scale/zoom guards + golden fixtures (35) |
| `npm run test:phase1` | Canvas + viewport: menus, selection, rename, line/polar/plot tools (71) |
| `npm run test:phase2` | Entities: types, BIS SP 46 styles, table, cosmetic weights (51) |
| `npm run test:phase3` | GeoGebra shim API: 39 methods, 14 commands (56) |
| `npm run test:phase4` | Solver: line rotation, loci, traces, LM fallback (64) |
| `npm run test:phase5` | Instruments + snapping: ruler/compass, 6-tier snap (32) |
| `npm run test:phase6` | Curriculum: quadrant/line/plane/solid lessons (23) |
| `npm run test:phase7` | Production audit: boot, budgets, mount (27) |
| `npm run test:phase8` | Labels: 3-tier layout + leader fallback (28) |
| `npm run test:phase9` | Solid widget: iso render, orbit/zoom, hidden edges (55) |
| `npm run test:phase10` | Reconstruction: live wireframe, readers, failures, live sync (54) |
| `npm run test:spatial` | View-mode HP/VP coordinates, projections, picking, distances, angles, and wireframe rendering (14) |
| `npm run test:phase11` | Manual: Markdown→HTML build, in-app link, freshness guard (22) |
| `npm run test:phase12` | Reconstruction 3-view: PROFILE role, result shapes, ignored views (30) |
| `npm run test:phase13` | Curves: revolved cylinders/cones, K=24 tessellation (30) |
| `npm run test:phase14` | Glass overlay: fullscreen sheet, aura hit-test, orbit/zoom/pan (42) |
| `npm run test:phase15` | Demo 3-view: button wiring, `#3view` hash, prism wire proof (14) |
| `npm run test:phase16` | Line vs circle: shared Ctrl+click anchor, plain-click draws line (12) |
| `npm run test:phase17` | Point cascade: deleting a point deletes its lines, refs + coincident (12) |
| `npm run test:phase18` | Two-point line: core rejects one-point lines everywhere (12) |
| `npm run test:phase19` | Multi-caption: coincident pairs, parens verdicts, corner truth (24) |
| `npm run test:phase20` | Claims + verify: member chooser, checker, Check button (26) |
| `npm run test:phase21` | Tutorial: scripted user, square stepper, action funnel (24) |
| `npm run test:phase22` | Claims reader: corner-lift lamina, hint failures (20) |
| `npm run test:phase23` | Tutorial: hex-prism lesson, 88 steps, honest solid (20) |
| `npm run test:phase24` | Typed distance: select point, type mm, Enter stakes (12) |
| `npm run test:phase25` | Typed plot offset: focus line, type mm, Enter stakes (12) |
| `npm run test:phase26` | Ground-line plotting: Alt+click fold, type mm, Enter stakes (13) |
| `npm run test:phase27` | Pick bank: Ctrl banks, plain click finalizes (12) |
| `npm run test:phase28` | View mode: Edit/View toggle, select-and-measure inspect (12) |
| `npm run test:phase29` | View dimensions: drafting-style overlay (extension lines, leaders) (12) |
| `npm run test:phase30` | Model + grade: model answers, strict verify, remarks, pass/fail (18) |
| `npm run test:phase31` | Undo: Ctrl+Z sheet history, batch-atomic snapshots (12) |
| `npm run test:phase32` | Slash commands: Minecraft-style `/cmd` draw, autocomplete, Settings prefs (16) |
| `npm run test:phase33` | Words to drawing: student `/ words` NL, teacher auto-draw via local gateway (16) |
| `npm run test:phase34` | Pose mode: Blender-style 3D moves drag the drawn 2D views (19) |
| `npm run test:phase35` | Pose live views: exact 2D projections of the posed solid (10) |
| `npm run test:phase36` | Live wireframe: 2D entities with both views resolve to 3D (12) |
| `npm run test:phase37` | Claim-decided pairing: corner choices pair 3D, dot picker covers stacks (9) |
| `npm run test:phase38` | Logical faces: closed wire infers faces for hidden dashes (9) |
| `npm run test:phase39` | Projector-read claims: drawn Type G pairs stacks, menu retired (12) |
| `npm run test:phase40` | Split pieces need both-views proof; whole lines keep trust (4) |
| `npm run test:phase41` | Pose accuracy: Y-move/Z-rotate projection invariants on the hex prism (7) |
| `npm run test:phase42` | Pose ink rides exact: vertex dots, labels, projector feet track split views (7) |
| `npm run test:phase43` | True projector corners: spanning lines head every touched corner once (5) |
| `npm run test:phase44` | Cmd-only problem-bank drawing: /polyline /ellipse /hatch /style /undo, render fixes, EduCAD Script (18) |
| `npm run test:phase45` | Pose stack labels split across parted corners (8) |
| `npm run test:phase46` | Pose reference ink: pinned axes, datum seats, stack parts seat (8) |
| `npm run test:login` | Login: 3 roles + guest, `/api/login`, gate ships (15) |
| `npm run test:lab` | Lab: studio + workspace pages, role routing, deep links, class client, inline manual (18) |
| `npm run test:cpp` | C++ backend: static serving, auth, drawings/progress, question sets, classes (43) |
| `npm run test:saves` | Saves module: snapshot/restore, API client incl. sets, guest gate, UI ships (20) |

App entry point: [`mirror/index.html`](mirror/index.html).
Library modules: [`mirror/files/www.geogebra.org/`](mirror/files/www.geogebra.org/).

## Development

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor guide.
Short version:

- Prerequisites: Node.js 22 (`.nvmrc`), CMake ≥ 3.16, a C++17 compiler,
  and libsodium headers (`sudo apt-get install -y cmake g++ libsodium-dev`
  on Ubuntu). No `npm install` needed — zero npm dependencies.
- Layout: `mirror/` app, `tools/` tests, `backend/` C++ server, `docs/`
  manual source.
- `npm test` builds the backend, then runs baseline + phases 1–46
  (1047 checks); CI additionally runs the login/lab/saves/cpp suites on
  every PR.
- `mirror/manual.html` is generated — edit `docs/MANUAL.md` and run
  `npm run build:manual`.
- License: MIT — see [`LICENSE`](LICENSE).

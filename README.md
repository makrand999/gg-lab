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
npm start      # serve mirror/ on http://127.0.0.1:8124/ (localhost only)
```

Open the printed URL in a browser. If port 8124 is busy the server picks
the next free port and prints it; `npm start -- <port>` or `PORT=<port>`
overrides the port.

The demo bar (top-right) has a **Manual** button that opens the in-app
user manual in a new tab. The manual page is generated from the Markdown
source: after editing `docs/MANUAL.md`, run `npm run build:manual`.

## Login

Opening the app redirects to [`mirror/login.html`](mirror/login.html):
pick the **Academics**, **Teacher**, or **Student** tab and log in, or
**Continue as guest** (guest skips the server entirely: no saves, the
sheet stays local). Demo credentials:

| Role | Username | Password |
|------|----------|----------|
| Academics | `academics` | `admin123` |
| Teacher | `teacher` | `teach123` |
| Student | `student` | `learn123` |

Two servers implement the same `POST /api/login` contract (the login
page works against either):

- `npm start` — minimal Node demo server (`tools/serve.js`): checks
  plain-text demo users in `tools/users.json` (outside the served root,
  never sent to browsers). Login only, no saves.
- `npm run start:cpp` — C++ backend (`backend/`, vendored httplib/JSON/
  SQLite + libsodium): `educad-seed` hashes the demo passwords into
  SQLite once per database, sessions are server-side tokens with 24 h
  expiry, and logged-in users get drawing saves plus tutorial progress.

The session chip (bottom-left) shows who is logged in; **Save** stores
the sheet to your account (first save asks for a title, later saves
update), **Drawings** lists/loads/deletes saved sheets, and **Logout**
clears the session and returns to the login page. Finishing a tutorial
records progress and earns its lesson button a ✓ next visit.

## Test

```sh
npm test       # full suite: baseline + phases 1–29 (862 checks)
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
| `npm run test:phase7` | Production audit: boot, server, budgets, mount (33) |
| `npm run test:phase8` | Labels: 3-tier layout + leader fallback (28) |
| `npm run test:phase9` | Solid widget: iso render, orbit/zoom, hidden edges (55) |
| `npm run test:phase10` | Reconstruction: classes A/B/C, failures, live sync (53) |
| `npm run test:phase11` | Manual: Markdown→HTML build, in-app link, freshness guard (22) |
| `npm run test:phase12` | Reconstruction 3-view: PROFILE role, depth maps, triple gate (30) |
| `npm run test:phase13` | Curves: Class D cylinders/cones, K=24 tessellation (30) |
| `npm run test:phase14` | Glass overlay: fullscreen sheet, aura hit-test, orbit/zoom/pan (42) |
| `npm run test:phase15` | Demo 3-view: button wiring, `#3view` hash, class-A prism proof (14) |
| `npm run test:phase16` | Line vs circle: shared Ctrl+click anchor, plain-click draws line (12) |
| `npm run test:phase17` | Point cascade: deleting a point deletes its lines, refs + coincident (12) |
| `npm run test:phase18` | Two-point line: core rejects one-point lines everywhere (12) |
| `npm run test:phase19` | Multi-caption: coincident pairs, parens verdicts, corner truth (24) |
| `npm run test:phase20` | Claims + verify: member chooser, checker, Check button (26) |
| `npm run test:phase21` | Tutorial: scripted user, square stepper, action funnel (24) |
| `npm run test:phase22` | Class E: claimed corner-lift lamina, hint failures (20) |
| `npm run test:phase23` | Tutorial: hex-prism lesson, 88 steps, honest solid (20) |
| `npm run test:phase24` | Typed distance: select point, type mm, Enter stakes (12) |
| `npm run test:phase25` | Typed plot offset: focus line, type mm, Enter stakes (12) |
| `npm run test:phase26` | Ground-line plotting: Alt+click fold, type mm, Enter stakes (12) |
| `npm run test:phase27` | Pick bank: Ctrl banks, plain click finalizes (12) |
| `npm run test:phase28` | View mode: Edit/View toggle, select-and-measure inspect (12) |
| `npm run test:phase29` | View dimensions: drafting-style overlay (extension lines, leaders) (12) |
| `npm run test:login` | Login: 3 roles + guest, minimal `/api/login`, gate ships (15) |
| `npm run test:cpp` | C++ backend: static parity, auth, drawings/progress, restart proof (26) |
| `npm run test:saves` | Saves module: snapshot/restore, API client, guest gate, UI ships (16) |

App entry point: [`mirror/index.html`](mirror/index.html).
Library modules: [`mirror/files/www.geogebra.org/`](mirror/files/www.geogebra.org/).

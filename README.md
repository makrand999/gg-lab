# EduCAD

EduCAD is a zero-dependency teaching CAD for first-angle Monge projection
(engineering drawing): a millimetre-precise 2D sheet with elevation above
and plan below the XY ground line, plus a live pen-sketch 3D widget that
reconstructs the drawn views. A small Draw menu keeps the canvas clear; Settings
holds drawing preferences, including a switch to the earlier shortcut gestures.
Both drawing methods share the same sheet and history. Contextual tools provide linked editing,
gesture Undo/Redo, guided front/top/side projection, and three-view consistency
feedback. Pose previews update all enabled views. Touch-only phones and tablets
open in View/Pose with split 2D/3D panes, pan/pinch/orbit gestures, and explicit
Pose controls; authoring remains available on fine-pointer devices.

- **User manual:** [`docs/MANUAL.md`](docs/MANUAL.md) — the complete guide
  for students and teachers (drawing, editing, precision, 3D view, demos,
  lessons, reference, troubleshooting).
- The in-app manual page ([`public/manual.html`](public/manual.html),
  opened from the demo-bar **Manual** button) is generated from
  `docs/MANUAL.md` — run `npm run build:manual` after editing the Markdown.
- **Design note:** [`docs/2d3d-problem-statement.md`](docs/2d3d-problem-statement.md)
  — the locked 2D⇄3D reconstruction contract.

## Explicit reconstruction in Major

Major's live 3D view now uses the [explicit reconstruction contract](docs/RECONSTRUCTION_CONTRACT.md).
Stable member identities determine correspondence; exact stored-decimal constraints
must agree. Lines retain both endpoint identities, and surfaces require declared
triangles. Every valid closed surface automatically defines a solid, with exact
closure/intersection checks and an exact volume certificate. Missing information,
contradictions and unsupported primitives produce
diagnostics instead of a guessed model. Old drawings without these declarations
may remain unresolved; they are not silently migrated by geometric inference.

The contract includes the existence/uniqueness proof and its limits. V1 covers
vertices, straight edges, embedded triangular surfaces and the solids enclosed
by their closed shells. Arbitrary curved surfaces and cavity/Boolean grouping
remain outside the contract. Geometry is rendered approximately; the reconstruction result
also carries an exact rational certificate. The legacy recognition API remains
available for compatibility, separately from Major's strict live bridge.

Run `node tools/edc.js --solid <file.edc>` to inspect the reconstructed
wireframe from a drawn sheet. Sample sheets live in `tools/scripts/`.

## Run

```sh
npm start      # build + seed + serve on http://127.0.0.1:8124/ (localhost only)
```

`npm start` compiles the C++ backend on first run (needs CMake, a C++17
compiler, libsodium and libcurl headers — see Development below), seeds the demo
accounts into `backend/data/educad.db`, and serves `public/` plus the
JSON API. Open the printed URL in a browser. If port 8124 is busy the
server picks the next free port and prints it; `npm start -- <port>` or
`PORT=<port>` overrides the port.

The demo bar (top-right) has a **Manual** button that opens the in-app
user manual in a new tab. The manual page is generated from the Markdown
source: after editing `docs/MANUAL.md`, run `npm run build:manual`.

## Login

Opening the app redirects to [`public/login.html`](public/login.html):
pick the **Academics**, **Teacher**, or **Student** tab and log in, or
**Continue as guest** (guest skips the server entirely: no saves, the
sheet stays local). Each role lands on its own home: teachers and
academics on the **Teacher studio** ([`public/teacher.html`](public/teacher.html):
create classes, post question sets (single, bulk text, or file upload)
to a class or as open sets, attach model-answer drawings per question
with a strict auto-check toggle and a per-question 3D-preview toggle,
review submissions grouped by question
in read-only View mode, and grade with remarks and pass/fail), students
on the **Student workspace** ([`public/student.html`](public/student.html):
join classes, solve sets, verify drawings against the hidden model
answer (pass/fail only, the model is never shown), draw the views from
the shared 3D reference, manage drawings,
track submissions, grades and tutorial progress),
guests on the bare sheet.

Students sign in with their **@mit.asia college ERP email and password**.
The backend verifies them against `erp.mit.asia`, loads their name, class,
division and year, and creates or updates their lab account. ERP passwords
and cookies are never persisted. Student demo credentials work only with
`EDUCAD_STUDENT_AUTH=demo`; there is no fallback when ERP is unavailable.
See [ERP login and deployment](docs/ERP_LOGIN.md) for configuration and mapping.

Local staff/development credentials:

| Role | Username | Password |
|------|----------|----------|
| Academics | `academics` | `admin123` |
| Teacher | `teacher` | `teach123` |
| Student (explicit demo mode only) | `student` | `learn123` |

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

## Verification

EduCAD Script (`.edc`) is the drawing check: one slash command per line,
validated headlessly against the live reconstruction.

```sh
node tools/edc.js tools/scripts/ln1.edc
node tools/edc.js --solid tools/scripts/quad3d.edc
```

The runner reports per-line errors, entity counts, projector alignment and
the reconstructed `solid:` summary. Exit code is 0 clean / 1 with problems.
Sample sheets live in `tools/scripts/`.

App entry point: [`public/index.html`](public/index.html).
Library modules: [`public/files/www.geogebra.org/`](public/files/www.geogebra.org/).

## Development

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full contributor guide.
Short version:

- Prerequisites: Node.js 22 (`.nvmrc`), CMake ≥ 3.16, a C++17 compiler,
  and libsodium/libcurl headers (`sudo apt-get install -y cmake g++ libsodium-dev libcurl4-openssl-dev`
  on Ubuntu). No `npm install` needed — zero npm dependencies.
- Layout: `public/` app, `tools/` scripts and the C++ backend under
  `backend/`, `docs/` manual source.
- Drawing checks run through EduCAD Script with `node tools/edc.js <file.edc>`.
- `public/manual.html` is generated — edit `docs/MANUAL.md` and run
  `npm run build:manual`.
- License: MIT — see [`LICENSE`](LICENSE).

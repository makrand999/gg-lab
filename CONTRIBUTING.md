# Contributing to EduCAD

Thanks for helping with EduCAD. This guide covers setup, layout, verification,
and the pull-request workflow. The project is MIT-licensed; contributions are
accepted under the same license (see [LICENSE](LICENSE)).

## Prerequisites

- **Node.js 22** (see [`.nvmrc`](.nvmrc); `package.json` requires >= 18).
  With nvm: `nvm use`.
- **CMake >= 3.16, a C++17 compiler, and the libsodium/libcurl development
  headers** (the server builds from source on `npm start`):
  - Ubuntu/Debian: `sudo apt-get install -y cmake g++ libsodium-dev libcurl4-openssl-dev`
  - macOS: `brew install cmake libsodium curl`
- There are **zero npm dependencies**: no `npm install` step.

## Quick start

```sh
git clone https://github.com/makrand999/gg-lab.git
cd gg-lab
npm start      # build + seed + serve on http://127.0.0.1:8124/
```

The first run compiles the C++ backend and seeds the demo accounts, then
serves the app. Open the printed URL and log in with a demo account from
the README table (`teacher` / `teach123` etc.), or continue as guest.

## Layout

| Path | Contents |
|------|----------|
| `public/` | The app: static pages, library modules and assets. Entry point: `public/index.html`. |
| `tools/` | EduCAD Script runner (`edc.js`), manual builder (`build-manual.js`), demo users for seeding. |
| `backend/` | C++ server (CMake; httplib/JSON/SQLite vendored in `third_party/`; libsodium from the system). |
| `docs/` | `MANUAL.md` (source of truth for the in-app manual) and design notes. |

## Verification

Drawing output is checked with **EduCAD Script** (`.edc`): one slash command
per line, validated headlessly against the live reconstruction.

```sh
node tools/edc.js tools/scripts/ln1.edc
node tools/edc.js --solid tools/scripts/quad3d.edc
```

The runner reports per-line errors, entity counts, projector alignment and
the reconstructed `solid:` summary. Exit code is 0 clean / 1 with problems.
Sample sheets live in `tools/scripts/`.

For a behavior change, add or update an `.edc` sheet that draws the affected
figure and keep the report clean. `npm run edc -- <file.edc>` is the same
runner through package scripts.

## Generated files — don't hand-edit

- `public/manual.html` is generated from `docs/MANUAL.md`: edit the
  Markdown, then run `npm run build:manual`.
- The backend schema header is generated from `backend/schema.sql` by the
  CMake configure step; edit the `.sql` file only.

## Workflow

1. Branch from `main` (`feature/<topic>`, `fix/<topic>`).
2. Make small, focused commits; run the relevant `.edc` sheet as you go.
3. Open a pull request against `main`.
4. In the PR description, note user-visible changes and link the manual
   section when behavior changes.

## Reporting issues

Use the bug-report / feature-request templates. Include repro steps and
the browser used.

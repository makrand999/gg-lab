# Contributing to EduCAD

Thanks for helping with EduCAD. This guide covers setup, layout, tests, and
the pull-request workflow. The project is MIT-licensed; contributions are
accepted under the same license (see [LICENSE](LICENSE)).

## Prerequisites

- **Node.js 22** (see [`.nvmrc`](.nvmrc); `package.json` requires >= 18).
  With nvm: `nvm use`.
- **CMake >= 3.16, a C++17 compiler, and the libsodium development
  headers** (the server builds from source on `npm start`):
  - Ubuntu/Debian: `sudo apt-get install -y cmake g++ libsodium-dev`
  - macOS: `brew install cmake libsodium`
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
| `mirror/` | The app: static pages plus library modules under `mirror/files/www.geogebra.org/`. Entry point: `mirror/index.html`. |
| `tools/` | **All** Node test suites (`test-*.js`), the manual builder (`build-manual.js`), demo users for seeding. |
| `backend/` | C++ server (CMake; httplib/JSON/SQLite vendored in `third_party/`; libsodium from the system). |
| `docs/` | `MANUAL.md` (source of truth for the in-app manual) and design notes. |

## Tests

```sh
npm test                # baseline + phases 1-30 (874 checks; builds the backend first)
npm run test:login      # login roles + guest (extra suite)
npm run test:lab        # studio + workspace pages (extra suite)
npm run test:saves      # saves module (extra suite)
npm run test:cpp        # C++ backend suite (builds the backend first)
npm run build:cpp       # configure + compile the C++ backend only
npm run start:cpp       # same as npm start, spelled explicitly
```

Notes:

- `npm test` builds the C++ backend up front: several suites serve pages
  through a throwaway `educad-server` on ephemeral ports, so the backend
  prerequisites apply to the full run.
- Only `npm start` itself binds the fixed port 8124 (with busy-port
  retry); the test suites pick free ports and run fine alongside it.
- CI runs `npm test` plus the login/lab/saves/cpp suites on every push to
  `main` and every pull request (see [`.github/workflows/ci.yml`](.github/workflows/ci.yml)).
- Keep every suite green. When you change behavior, extend the matching
  suite (or add a `tools/test-<topic>.js` suite plus an `npm run` script
  and a README table row, following the existing phase suites).

## Generated files — don't hand-edit

- `mirror/manual.html` is generated from `docs/MANUAL.md`: edit the
  Markdown, then run `npm run build:manual`. (`test:phase11` fails if the
  generated page is stale.)
- The backend schema header is generated from `backend/schema.sql` by the
  CMake configure step; edit the `.sql` file only.

## Workflow

1. Branch from `main` (`feature/<topic>`, `fix/<topic>`).
2. Make small, focused commits; keep the test suites passing as you go.
3. Open a pull request against `main`. CI must be green before merge.
4. In the PR description, note user-visible changes and link the manual
   section when behavior changes.

## Reporting issues

Use the bug-report / feature-request templates. Include repro steps and
the browser used.

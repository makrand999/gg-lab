# Public API, build/packaging and licensing boundaries

Status: research/design report. Date: 2026-11-11. Scope: **Major** only
(`public/`, `tools/`, `backend/`, shared docs). Major2 was not inspected.

This report compares EduCAD's current API/build/licensing shape with mature
open-source CAD projects and proposes a kernel API/versioning policy, module
boundary, vendoring rules, and a safe way to add an optional native/WASM
geometry backend. It is engineering research, not legal advice; licence
conclusions should be reviewed by counsel before distribution.

## 1. Current shape of EduCAD

### 1.1 Public API surface

EduCAD's API is **de facto, not de jure**. There is no single entry point, no
package export map, and no published compatibility policy.

| Surface | Current form | Evidence |
|---|---|---|
| Browser modules | 35 UMD files in `public/lib/`, each attaching a `EduCAD*` global; 35 `<script>` tags in fixed order | `public/index.html:633-667`; e.g. `public/lib/educad-vec3.js`, `public/lib/educad-surfaces.js` |
| Node modules | The same files expose `module.exports` for `require()`; two use a slightly different wrapper spelling but the same UMD pattern | `tools/edc.js:8-16`; `public/lib/educad-parametric.js:1-4` |
| Script API | `EduCADCommand.parse` / `.execute`; one slash command per line; refusal returns `{ok:false,message}` and leaves the entity table unchanged | `public/lib/educad-command.js`; `tools/edc.js:57-81` |
| Verification API | `tools/edc.js` exports `runScript`, `checkProjectors`, `summarize`, `report`; it also evaluates `# expect:` and `# surface-query:` directives | `tools/edc.js:144-268,474-479` |
| Geometry model | `Surfaces` exposes `build`, `validate`, `certify`, `incidence`, `summarize`, `section`, `intersect`, `trim`, `split`, `splitDiagnostic`, `attachBoundary`, `shareBoundary`, `intersectionCurves`, plus helpers | `public/lib/educad-surfaces.js` (export block); `docs/SURFACE_MODEL.md` |
| Data contracts | `analytic-surface-v1`, `analytic-surface-certificate-v1`, `educad-explicit-v1`, `inferred-triangle-v1`, save `version:1` | `public/lib/educad-surfaces.js`; `public/lib/educad-strict.js`; `public/lib/educad-reconstruct.js`; `public/lib/educad-saves.js:12` |
| Compatibility shim | `getVersion()` returns `3.0.0-educad`; XML uses `version="1"` | `public/lib/educad-shim.js:42,1950-1985` |

The strongest existing versioning is in **data contracts**, not code. That is
the right foundation: the analytic-surface and explicit-reconstruction docs
already describe bounded guarantees and refusal diagnostics. What is missing is
a single exported namespace, one API version, and a rule for changing the
contracts.

The current global namespace is the real public API. `package.json` is
`"private": true` and version `"0.0.0"` (`package.json:3-4`), so there is no
published package and no tag-based release identity. Deep imports such as
`require('../public/lib/educad-surfaces.js')` are used by the runner, which
makes internal file paths part of the effective contract.

### 1.2 Build shape

| Area | Current state |
|---|---|
| Runtime dependencies | Zero npm dependencies; Node 22 in `.nvmrc`, `engines >= 18` in `package.json` |
| App build | None: static files and ordered `<script>` tags; manually maintained cache-busting query strings such as `?v=quiet-20261006-2` |
| Backend build | CMake 3.16+, C++17; `educad-server` and `educad-seed`; vendored `httplib.h` 0.58.0, `json.hpp` 3.12.0, SQLite 3.53.4; system `libsodium` and `libcurl` |
| Generated files | `public/manual.html` from `docs/MANUAL.md` via a deterministic Markdown subset builder; `schema.h` from `schema.sql` at CMake configure time |
| CI | No workflow directory; only issue/PR templates under `.github/` |
| Build entry | `npm start` -> `start:cpp` -> `prestart:cpp` -> `build:major2`, then CMake build, seed, server |

The `prestart:cpp` hook invokes `build:major2`. For a Major-only install this
is an unnecessary build dependency; verify whether it is intentional before
changing it. This report did not run the app or backend, so this observation is
from `package.json:8-13`, not from a build trace.

### 1.3 Backend boundary

The backend is **not only auth/saves**. `backend/src/main.cpp:1-21` documents:

- static file serving of `public/`;
- auth (`/api/login`, `/api/logout`, `/api/me`, `/api/auth/config`);
- saves and progress (`/api/drawings`, `/api/progress`);
- classroom workflows (`/api/sets`, `/api/classes`, `/api/submissions`,
  grading, verification);
- an optional natural-language command planner (`POST /api/interpret`) that
  calls an external OpenAI-compatible gateway and returns slash commands;
- ERP login through `erp.mit.asia` via libcurl.

Geometry reconstruction, surface inference, and certificates are **not** on the
server; they run in browser/Node JavaScript. So the accurate statement is:
"the backend has no geometry kernel; it serves the app and classroom/auth data,
plus an optional LLM planner." The HTTP API is unversioned (`/api/...`) and has
no OpenAPI/schema document.

### 1.4 Licensing shape

The project is MIT (`LICENSE`, `package.json:17`). Vendored code is compatible:

| Component | Version | Licence | Location |
|---|---|---|---|
| cpp-httplib | 0.58.0 | MIT | `backend/third_party/httplib.h` |
| nlohmann/json | 3.12.0 | MIT | `backend/third_party/json.hpp` |
| SQLite amalgamation | 3.53.4 | Public domain | `backend/third_party/sqlite3.c`, `sqlite3.h` |
| libsodium | system package | ISC | linked by CMake |
| libcurl | system package | curl licence (MIT-like) | linked by CMake |

There is no `THIRD_PARTY_NOTICES.md`, no project-wide SPDX header convention on
EduCAD's own files, and no CI check that the notice file matches
`backend/third_party/`. The optional ERP and LLM gateway are services, not
vendored code, but they create availability/privacy dependencies that should be
documented.

## 2. OSS patterns

### 2.1 OCCT 8.0.1: toolkit/module structure, CMake, LGPL exception

**Version and structure.** OCCT 8.0.1 was published 2026-07-30
([release V8_0_1](https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8_0_1)).
The library is grouped into packages -> toolkits (libraries) -> seven modules:
Foundation Classes, Modeling Data, Modeling Algorithms (including Mesh),
Visualization, Data Exchange, Application Framework, and the Draw test harness.
The official introduction describes this hierarchy and the toolkit boundary:
<https://dev.opencascade.org/doc/overview/html/index.html>. The source tree
groups package sources under toolkit directories; applications link individual
toolkits, not one monolithic library.

**CMake.** Top-level `CMakeLists.txt` requires CMake 3.10 (3.16+ recommended),
C++17 by default, and offers `BUILD_MODULE_*`, `BUILD_USE_VCPKG`, install
layouts, and optional dependencies. `BUILD_SOVERSION_NUMBERS` controls shared
library names and SONAME: `0` none, `1` major, `2` major.minor, `3`
major.minor.maintenance. On Unix the default is `2`; on Windows, Android, and
Emscripten it is `0` (`CMakeLists.txt:149-161`). This is explicit ABI
versioning, not semantic versioning.

**Versioning.** `adm/cmake/version.cmake` holds
`OCC_VERSION_MAJOR/MINOR/MAINTENANCE` plus an optional development suffix; the
current master is 8.1.0-dev1 after the 8.0.1 release. The 8.0.1 notes say the
"C++17 and core library API and ABI baseline established by 8.0.0.p1 remains
unchanged." OCCT therefore treats a maintenance line as an ABI baseline, while
minor releases can add API. There is no OCCT-wide SemVer promise. A forum
answer from Open Cascade also states that maintenance releases are not
universally binary-compatible
(<https://opencascade.org/content/open-cascade-starts-supporting-maintenance-releases-open-cascade-technology>);
the practical rule is: rebuild against the exact OCCT version unless the
release notes say otherwise.

**Licence.** OCCT is `LGPL-2.1-only WITH OCCT-exception-1.0` per SPDX
(<https://spdx.org/licenses/OCCT-exception-1.0.html>). The exception is narrow:
it lets object code that incorporates material from OCCT **header files** be
distributed under terms of your choice, provided there is a prominent notice
that the code uses OCCT. It is not a general linking exception. OCCT's own
documentation still calls out LGPL section 6 obligations: notice, a copy of the
licence, source availability, and the user's ability to run the application
with a modified OCCT (see the licence section of the introduction above). A
commercial licence is available as an alternative.

**Packaging.** Source snapshot, complete source archive, and platform binary
packages; CMake config and `env.sh`/`env.bat`; vcpkg integration; distro
packages; Homebrew/MacPorts. The project explicitly says binary compatibility
usually requires rebuilding on the target platform
(<https://github.com/Open-Cascade-SAS/OCCT/blob/master/README.md>).

**Lesson for EduCAD.** Module/toolkit boundaries plus an explicit SONAME are
useful even without OCCT's scale. Do not assume an LGPL exception makes static
or WASM linking safe; treat the exception as header-only relief.

### 2.2 FreeCAD 26.3: LGPL, modular apps, Python/C++ API, plugins

**Version.** At the time of writing, FreeCAD 26.3 is at RC2 (2026-10-18); 1.1
is the prior stable line. The 26.3 release notes explain the version change:
26.3 follows 1.1, and FreeCAD moved to three releases per year with
calendar-based version numbers, then 27.1/27.2/27.3
(<https://github.com/FreeCAD/FreeCAD/releases/tag/26.3rc2>).

**Licence.** LGPL-2.1-or-later: the top-level `LICENSE` is LGPL 2.1 and source
files carry `SPDX-License-Identifier: LGPL-2.1-or-later` (for example
`src/App/Application.cpp`). `CONTRIBUTING.md` says "LGPL2+" and requires
compatible contributions
(<https://github.com/FreeCAD/FreeCAD/blob/main/CONTRIBUTING.md>).

**Modular apps and plugin model.** Workbenches live under `src/Mod/<Name>`;
each is conditionally added by a `BUILD_*` option in `src/Mod/CMakeLists.txt`
(Part, PartDesign, Draft, BIM, FEM, CAM, Mesh, Import, etc.). A workbench can
have C++ `App`/`Gui` code and Python `Init.py`/`InitGui.py` entry points; for
example `src/Mod/Part/Init.py`, `src/Mod/Part/InitGui.py`,
`src/Mod/Draft/InitGui.py`. External addons are indexed separately; the legacy
`FreeCAD-addons` repository is retained only for pre-1.0 Addon Manager clients
and points new clients at `FreeCAD/Addons`
(<https://github.com/FreeCAD/FreeCAD-addons>). The practical extension boundary
is Python plus workbench packages; C++ modules are normally built in-tree.

**API layering.** FreeCAD exposes a broad Python API (`import FreeCAD`,
`FreeCADGui`, `Part`, etc.) and a C++ API used by the application and C++
workbenches. The Python layer is the practical automation surface; the C++ layer
is coupled to the release's build. This is a common pattern: one heavyweight
host, many optional modules, and a scripting API for extensions.

**Lesson for EduCAD.** A workbench-style plugin model is overkill for a
single-page teaching app. The transferable parts are: optional modules must be
able to fail to load without killing the host; extension points should be
documented and versioned; Python-style "drop-in" extensions need a stable
protocol, not raw access to internals.

### 2.3 Manifold 3.5.4: small C++/WASM library API, Apache-2.0, packaging

**Version and licence.** Manifold v3.5.4 was released 2026-09-25
(<https://github.com/elalish/manifold/releases/tag/v3.5.4>); npm `manifold-3d`
and PyPI `manifold3d` are both 3.5.4 at the time of writing. It is Apache-2.0.

**API.** Public headers live under `include/manifold/`; the core namespace is
`manifold`; `Manifold`, `CrossSection`, and `MeshGL` are the main types.
`include/manifold/manifold.h` exposes `Version()` returning `{major, minor,
patch}`. CMake exports `manifold::` targets and writes a
`manifoldConfigVersion.cmake` with `COMPATIBILITY SameMajorVersion`; it also
installs a pkg-config file. The project has no required dependencies; TBB,
nanobind, Emscripten, GTest, Assimp, and Tracy are optional
(<https://github.com/elalish/manifold/blob/v3.5.4/CMakeLists.txt>).

**WASM/native packaging.** The npm package ships `manifold.js`, `manifold.wasm`,
TypeScript declarations, and an `exports` map; the PyPI package ships wheels;
C++ users get CMake/vcpkg. The release checklist
(<https://github.com/elalish/manifold/blob/master/RELEASE_CHECKLIST.md>) bumps the version in CMake,
`pyproject.toml`, `flake.nix`, `package.json`, and tests before publishing, and
verifies npm (~1 MB) and PyPI (600 KB-1.1 MB) artifacts. The 3.5.4 release also
fixed WASM loading under a Content-Security-Policy without `unsafe-eval`, a
useful precedent for browser deployments.

**Lesson for EduCAD.** This is the best small-library model to copy: one
version source, a `Version()` call, a package config with a major-version
compatibility rule, optional dependencies, and separate C++/Python/JS
artifacts. The WASM artifact is an optional accelerator, not a second source of
truth.

### 2.4 CadQuery 2.8.0: Apache-2.0 Python API over OCCT, fluent design

**Version and dependencies.** CadQuery 2.8.0 is the current PyPI release at the
time of writing. Its own code is Apache-2.0, but it requires
`cadquery-ocp<8.0,>=7.9.3.1` plus `ezdxf`, `nlopt`, `casadi`, `trame`, `scipy`,
`numba`, and others (<https://pypi.org/project/cadquery/>). OCP is the OCCT
Python binding; the PyPI metadata for `cadquery-ocp` is Apache-2.0, but the
binary wheel distributes OCCT libraries, so OCCT's LGPL terms still apply to
the distributed binary. This distinction matters: "wrapper is Apache-2.0" does
not mean "the wheel contains only Apache-2.0 code."

**API design.** CadQuery documents four layers
(<https://cadquery.readthedocs.io/en/latest/primer.html>):

1. fluent API: `Workplane`, `Sketch`, `Assembly`;
2. free-function API: `Shape`, `Solid`, `Face`, `Wire`, etc.;
3. geometry API: `Vector`, `Plane`, `Location`;
4. the OCCT API via OCP.

The fluent chain is the teaching surface; the free-function layer underneath is
the escape hatch; the OCCT layer is the last resort. The docs explicitly show
how to move between layers (`Workplane.val()`, wrapping an OCCT shape in
`Solid(...)`). This layered design keeps the friendly API small while allowing
advanced users to reach the kernel.

**Lesson for EduCAD.** A fluent/command layer and a lower-level analytic layer
should be separately documented. Do not force every user through the lowest
level, and do not let the lowest level leak into the default API. CadQuery also
shows the cost of a heavyweight kernel dependency: install size, binary wheels,
and OCCT licence obligations.

### 2.5 build123d 0.13.0: Apache-2.0, two API modes

build123d 0.13.0 is current on PyPI; its own code is Apache-2.0 and it depends
on `cadquery-ocp-novtk >=8.0,<8.1` (OCCT 8.0.x) plus numpy, scipy, sympy, and
other packages (<https://github.com/gumyr/build123d/blob/dev/pyproject.toml>).
It supports two styles:

- **builder mode**: context managers such as `BuildPart`, `BuildSketch`,
  `BuildLine`, implicit state and pending objects;
- **algebra mode**: operator-driven composition such as `obj += sub_obj` and
  `Plane.XZ * Pos(...) * Rectangle(...)`.

The docs present both as first-class styles and explain how to combine them
(<https://build123d.readthedocs.io/en/latest/key_concepts_builder.html>,
<https://build123d.readthedocs.io/en/latest/key_concepts_algebra.html>).
Version 0.x signals that the API can still change; the kernel is inherited from
OCP/OCCT, so the wrapper's version does not describe the kernel ABI.

**Lesson for EduCAD.** Offering two authoring styles is viable if they share
one model and one contract. The version number must say which layer is stable;
a 0.x wrapper over a 7.x/8.x kernel is not a 1.0 promise.

### 2.6 BRL-CAD 7.46.0: BSD claim, librt/libged separation

**Correction to the common shorthand.** BRL-CAD is often described as "BSD",
but its `COPYING` says the **unified work is LGPL**, with BSD or public-domain
terms for distinct components such as build infrastructure, scripts, tests,
models, images, and documentation
(<https://github.com/BRL-CAD/brlcad/blob/main/COPYING>). The libraries,
including `librt`, are LGPL. "BSD" is accurate for parts, not for the whole
library stack.

**librt/libged separation.** `librt` holds the geometry primitives, CSG
evaluation, and ray-tracing core (its source list is dominated by
`primitives/<type>/...`). `libged` is the geometry-editing library: a CLI
command layer that can be invoked from C or scripting languages, with stateless
commands and stateful commands via a context structure. Its README describes a
consistent `{action} [args]` grammar, short/long flags, help generation, and
"command versioning" as a TODO
(<https://github.com/BRL-CAD/brlcad/blob/main/src/libged/README>). Its
CMakeLists says libged is "set up based on a plugin architecture, with common
functionality defined in a core library"; it supports a static core plus
dynamic command plugins (`LIBGED_STATIC_CORE`)
(<https://github.com/BRL-CAD/brlcad/blob/main/src/libged/CMakeLists.txt>).

**Build/packaging.** CMake with a large dependency graph; third-party code is
managed by the external `bext` repository and downloaded by default. Offline
builds use `BRLCAD_EXT_SOURCE_DIR`; subset builds use
`BRLCAD_COMPONENTS=librt` (<https://github.com/BRL-CAD/brlcad/blob/main/INSTALL>).
7.46.0 (November 2026) includes a new STEP AP242/AP214 pipeline, faster NMG ray
tracing, and many MGED fixes
(<https://github.com/BRL-CAD/brlcad/releases/tag/rel-7-46-0>).

**Lesson for EduCAD.** Separating the geometry core from the editing/command
layer is the right architecture. libged also shows that a command API can be
the public boundary; its explicit TODO for command versioning is a warning:
without a version field, commands become an accidental ABI.

## 3. Comparison matrix

Ratings are relative to EduCAD's situation. "API stability" means the strength
of the published compatibility promise, not code quality. "Licence
compatibility" means compatibility with a default MIT distribution without
additional compliance work; "conditional" means it can be compatible with
notices, dynamic linking, and source/relink obligations.

| Project (version) | API stability | Dependency risk | Licence compatibility with MIT | Build reproducibility | Distribution |
|---|---|---|---|---|---|
| **OCCT 8.0.1** | Medium-high: toolkit headers, SONAME major.minor on Unix, 8.0.x ABI baseline; no SemVer promise | Medium: many optional deps, but core can be built small | Conditional: LGPL-2.1-only + narrow header exception; section 6 obligations remain | Medium: CMake/vcpkg or prebuilt 3rd-party; platform-specific binaries | High: source/binary releases, distro packages, vcpkg, Homebrew/MacPorts |
| **FreeCAD 26.3** | Medium: broad Python API; C++ modules are release-coupled | High: Qt, Coin3D, Python, OCCT, many optional modules | Conditional: LGPL-2.1-or-later | Low-medium: large build, packaging-heavy | High: installers, AppImage, distro/conda packages |
| **Manifold 3.5.4** | High: SemVer tags, `Version()`, CMake `SameMajorVersion` | Low: no required deps; TBB/Python/WASM optional | High: Apache-2.0 (preserve NOTICE) | Medium-high: CMake; optional downloads; wheels/npm artifacts | High: npm, PyPI, vcpkg, C++ source |
| **CadQuery 2.8.0** | Medium: layered Python API; OCCT pinned through OCP | High: OCP + ~12 Python packages | Conditional: wrapper Apache-2.0, but OCP wheel typically bundles LGPL OCCT | Medium: wheels/conda; binary availability is the constraint | High: PyPI/conda |
| **build123d 0.13.0** | Low-medium: 0.x, two evolving API modes | High: OCP + numpy/scipy/sympy etc. | Conditional: same OCCT-binary issue | Medium: wheels; OCP pin | High: PyPI |
| **BRL-CAD 7.46.0** | Medium: libged command API; command versioning still TODO | High: very large; bext downloads by default | Conditional: unified work LGPL; BSD/public-domain parts | Low-medium: large build, offline mode exists | Medium: source and platform installers |
| **EduCAD current** | Low: global namespace, `0.0.0`, no policy, deep imports | Low-medium: zero npm; system libsodium/curl; optional ERP/LLM services | High for own code, but notices incomplete | Medium: vendored core and deterministic manual; no CI, no presets, unpinned system libs | Medium: local server + nginx; no package artifact |

### 3.1 What the matrix means

1. **API stability is a promise, not a version number.** Manifold's `3.5.4`
   means something because `SameMajorVersion` and `Version()` are part of the
   package. EduCAD's `0.0.0` means nothing, even though the geometry contracts
   are stronger than many 1.0 projects.
2. **Dependency risk is dominated by the kernel choice.** CadQuery/build123d
   are small Python APIs sitting on a very large binary dependency. EduCAD's
   zero-npm stance is a real advantage; adding OCCT would erase it.
3. **Licence compatibility is a distribution decision.** Apache-2.0 and MIT
   compose cleanly. LGPL can compose with MIT, but only with notices, source,
   and relink rights; the OCCT exception is narrower than it looks.
4. **Reproducibility is weakest at the environment boundary.** All projects
   build from source; the differences are pinned manifests, offline modes, and
   CI. EduCAD has the smallest dependency set but the least automation.
5. **Distribution follows the artifact boundary.** Manifold ships one small
   WASM/NPM artifact and one wheel; FreeCAD ships a desktop application;
   EduCAD ships source plus a local server. A kernel package would be a new
   distribution channel, not just a refactor.

## 4. Concrete improvements for EduCAD, ranked

### Must-have

**M1. Publish a kernel API manifest and one aggregate namespace.** Add
`public/lib/educad-kernel.js` (UMD) that re-exports the stable kernel modules as
`EduCADKernel`, with `apiVersion`, `contracts`, `capabilities`, and `version`.
Mark deep imports as internal. Add `public/lib/educad-api.json` as the
machine-readable manifest and a zero-dependency `tools/check-api.js` that
compares the manifest to the actual exports. This is the precondition for every
other API improvement.

**M2. Give the project a real release identity.** Set `package.json` to a
meaningful version (for example `0.1.0`), add `CHANGELOG.md`, create git tags,
and make `EduCADKernel.version` match the package version. Keep data-contract
IDs separate (`analytic-surface-v1`, etc.). Today `0.0.0` and the hand-written
`?v=` query strings are the only version signals.

**M3. Add `THIRD_PARTY_NOTICES.md` and a licence/provenance check.** Record
every vendored component (httplib MIT, nlohmann/json MIT, SQLite public domain)
and every system library (libsodium ISC, libcurl curl licence), with upstream
URL, version, and obligations. Add a CI check that no file under
`backend/third_party/` is missing from the notice table. This is cheap and
closes a real MIT-distribution gap.

**M4. Add CI for the existing verification story.** A workflow should:
build the backend; run a representative set of `.edc` scripts; rebuild
`public/manual.html` and fail on diff; `require()` every kernel module in Node;
and run the licence/API manifest checks. The project already has deterministic
verification primitives; it lacks the automation that makes them a gate.

**M5. Separate the kernel from the app shell in the manifest.** Define logical
layers now, without moving files:

| Layer | Modules (current names) | Rule |
|---|---|---|
| Kernel core | `educad-vec3`, `educad-parametric`, `educad-curve-reconstruct`, `educad-oblique-kernel`, `educad-surfaces`, `educad-reconstruct`, `educad-strict`, `educad-ref3d` | No DOM, no network, no `Date.now()`/random; deterministic input -> output |
| Authoring API | `educad-entities`, `educad-command`, `educad-drafting` | May use kernel; no DOM |
| App shell | `educad-boot`, `educad-canvas`, `educad-viewport`, `educad-mobile`, `educad-project`, `educad-tutorial`, `educad-settings`, `educad-labels`, `educad-saves`, `educad-auto`, `educad-measure`, `educad-verify`, `educad-orthographic`, `educad-pose`, `educad-spatial` | DOM/network allowed |

The exact split should follow real dependencies, not the names. The point is a
declared boundary and a test that kernel modules load in plain Node without a
browser shim.

**M6. Document the backend boundary and mark optional services.** State in
`docs/` that geometry is client-side; list `/api/interpret`, ERP login, and the
LLM gateway as optional, with their failure modes. Add `GET /api/version` (or a
version field in `/api/me`) so a client can detect a server mismatch. HTTP API
versioning can be additive for now; a `/api/v1/` prefix is optional because the
app and server ship together.

### Should-have

**S1. Make the build environment reproducible.** Add `CMakePresets.json` with
pinned generator/build type, document minimum libsodium/libcurl versions, and
add a container or CI image. Consider `SOURCE_DATE_EPOCH` for generated files.
Decouple `prestart:cpp` from `build:major2` if Major does not need it.

**S2. Replace hand-maintained cache-busting strings with a build stamp.** A
small `tools/stamp-assets.js` can derive a single build id from
`package.json`/git and update the `<script>` URLs deterministically. This turns
an ad hoc cache mechanism into a release artifact.

**S3. Add an HTTP API contract test.** The server has many routes; a small
Node test that logs in, saves a drawing, lists it, and deletes it would catch
route/schema drift without adding dependencies. Keep it out of the geometry
test suite; it tests the backend boundary, not reconstruction.

**S4. Record architecture decisions.** Add `docs/adr/` with short records for
the kernel boundary, the contract policy, and any backend decision. This is the
cheapest way to prevent future contributors from re-litigating the same
boundaries.

### Optional

**O1. Publish a standalone `@educad/kernel` package.** The UMD modules already
work in Node. A zero-dependency package with an `exports` map would let other
tools use the kernel without copying `public/lib/`. This is optional because
the app itself must remain script-tag based and dependency-free; publishing a
package does not require consuming npm packages.

**O2. Add a command-plugin protocol.** `.edc` is already a stable text format.
A `EduCADCommand.register(name, spec)` API with a versioned command schema
would let teachers add commands without editing `educad-command.js`. This is
the natural plugin boundary for this product, closer to libged than to FreeCAD
workbenches.

**O3. Add an optional WASM accelerator.** Only if profiling shows a real need.
Prefer an Apache-2.0 backend (Manifold for mesh booleans) over OCCT. Keep it a
separate, lazy-loaded artifact with a capability handshake and a JavaScript
fallback. See section 6.

**O4. Add a size/performance budget.** If a WASM artifact is added, record its
compressed size and load time in CI. Manifold's own ~1 MB npm package is a
useful order-of-magnitude reference, not a target.

## 5. Proposed kernel API/versioning policy

### 5.1 One namespace, three version axes

```
EduCADKernel
  apiVersion        SemVer of the exported JavaScript API
  version           product/build version, matching package.json
  contracts         { "analytic-surface": "v1", ... }
  capabilities      { surfaces: [...], operations: [...], diagnostics: [...] }
```

Do not collapse these into one number. A bug-fix release can keep the API and
contracts; a new surface kind is an API minor and a capability addition; a
change to a contract's required fields is a contract major.

### 5.2 SemVer rules for `apiVersion`

| Change | Version bump |
|---|---|
| Remove/rename a stable export; change a required argument; change a return shape incompatibly | MAJOR |
| Add an export, optional argument, surface kind, operation, or optional result field | MINOR |
| Bug fix with the same API and contract; numerical fix within documented tolerance | PATCH |
| Behaviour change that alters a certified result but keeps the API | MINOR, documented in `CHANGELOG.md` |
| Deprecation warning only | MINOR; removal no earlier than the next MAJOR |

Only the `EduCADKernel` aggregate is covered by this promise. Deep imports are
internal. This is the same pattern as Manifold's public headers plus package
config, scaled down.

### 5.3 Contract IDs

Keep the existing IDs and make their rules explicit:

- `analytic-surface-v1`: bounded analytic surface model (`plane`, `cylinder`,
  `cone`, `sphere`) with loops and boundary elements.
- `analytic-surface-certificate-v1`: read-only certificate over that model.
- `educad-explicit-v1`: explicit reconstruction certificate.
- `inferred-triangle-v1`: inferred display adapter.
- `save-v1`: saved drawing envelope (currently a numeric `version:1`; propose
  the `save-v1` label for the API manifest).

Rules:

1. A contract ID is immutable. Additive optional fields are allowed within the
   same major; required-field changes, renamed fields, or changed meaning need a
   new `-v2`.
2. Never silently reinterpret an old ID. Persisted saves and `.edc` files must
   keep loading, or fail with a specific diagnostic.
3. Each result that carries a contract also carries `status`, `issues`/
   `diagnostics`, and enough source evidence to explain a refusal. This is
   already the style of `Surfaces.validate`/`certify`.
4. Capability discovery is explicit: a caller should ask
   `EduCADKernel.capabilities()` rather than infer support from a version
   number.

### 5.4 Stability tiers

| Tier | Meaning | Initial members |
|---|---|---|
| `stable` | Covered by SemVer; documented; tested | `Vec3` core, `Parametric` core, `Surfaces.build/validate/certify/incidence`, `Command.parse/execute` documented commands, reconstruction result envelope |
| `experimental` | May change in a minor; documented as such | `Surfaces.split/trim/attachBoundary/shareBoundary/intersectionCurves` where the docs still list refusals or non-unified cases; recess/fillet inference; oblique-kernel helpers |
| `internal` | No compatibility promise | Deep module paths, app-shell helpers, shim internals |

The `docs/SURFACE_COMPLEX.md` "not yet unified" list is the source of truth for
what is experimental. Do not mark an operation stable just because it has a
function name.

### 5.5 Version negotiation for an optional backend

If a native/WASM backend is added, its handshake must return:

```
{ apiVersion, contractVersions, capabilities, backendId, backendVersion }
```

The loader refuses a different major `apiVersion`, warns on a different minor,
and falls back to the JavaScript kernel. It must never silently accept a
backend that cannot honour a requested contract. This is the same idea as
Manifold's `Version()` + `SameMajorVersion`, with a runtime fallback.

### 5.6 API documentation and checks

- `docs/KERNEL_API.md`: the stable surface, tiers, contracts, and examples.
- `public/lib/educad-api.json`: machine-readable export list and contract IDs.
- `tools/check-api.js`: compares the manifest with `EduCADKernel` keys and
  contract strings; fails CI on undocumented additions/removals.
- `CHANGELOG.md`: one entry per release, with the version bump and contract
  impact.

## 6. Module boundary and vendoring/licence checklist

### 6.1 Module boundary rules

1. **Kernel modules are pure.** No `window`, `document`, `localStorage`,
   `fetch`, timers, `Date.now()`, or `Math.random()`. Geometry must be a
   function of its inputs. `educad-saves.js` is app infrastructure, not kernel.
2. **One public pipeline.** The app, `tools/edc.js`, and saved previews all call
   the same reconstruction/surface functions. No second implementation for
   tests or previews. This is already a project requirement in `AGENTS.md`.
3. **UMD stays.** Keep the existing dual browser/Node pattern; it is the reason
   the runner works without a bundler. Add the aggregate rather than replacing
   the wrappers.
4. **No new globals.** New modules should attach only to `EduCADKernel` or a
   documented `EduCAD*` namespace. Avoid generic names such as `API` or `Kernel`.
5. **App shell may depend on kernel; kernel must not depend on app shell.**
   Enforce with a simple dependency allowlist in `tools/check-api.js`.
6. **Backend has no geometry.** If that ever changes, it becomes an optional
   backend under section 7, not a new route inside `educad-server`.

### 6.2 Vendoring and licence checklist

Use this for every new third-party file or library:

- [ ] Component name, exact version/tag, upstream URL, and retrieval date.
- [ ] SPDX identifier and full licence text in `THIRD_PARTY_NOTICES.md`.
- [ ] Local modifications documented (patch file or a note); do not silently
      fork.
- [ ] Licence is on the allowlist: MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0,
      ISC, Zlib, public domain. Apache-2.0 requires NOTICE preservation.
- [ ] No GPL, AGPL, SSPL, non-commercial, or "source-available" code in the
      default browser bundle or default server binary.
- [ ] No LGPL in the default MIT artifact unless the section 6.4 conditions are
      met and the artefact is clearly separated.
- [ ] System dependencies are documented with a minimum version (libsodium,
      libcurl) and a dynamic-link expectation.
- [ ] Optional services (ERP, LLM gateway) are documented as services, with
      data-flow and failure-mode notes; they are not vendored code.
- [ ] Generated files are marked with their source and generator; generated
      output is reproducible.
- [ ] A CI check compares the notice table to the actual vendored files and
      fails on an unmapped file.

Current mapping to add immediately:

| Component | Version | Licence | Obligation |
|---|---|---|---|
| `backend/third_party/httplib.h` | 0.58.0 | MIT | Keep copyright/permission notice |
| `backend/third_party/json.hpp` | 3.12.0 | MIT | Keep copyright/permission notice |
| `backend/third_party/sqlite3.c/.h` | 3.53.4 | Public domain | Keep provenance; no attribution required |
| libsodium (system) | document minimum | ISC | Keep notice; dynamic link |
| libcurl (system) | document minimum | curl licence | Keep notice; dynamic link |

### 6.3 Optional backend contract

If a native/WASM backend is ever added, use a narrow C ABI and JSON payloads,
not C++ types across the boundary:

- `educad_kernel_version()` returns a struct with API major/minor/patch and
  contract IDs.
- `educad_kernel_capabilities()` returns a JSON string.
- `educad_kernel_reconstruct(json_in)` returns a JSON string plus an owned
  buffer; `educad_kernel_free()` releases it.
- Errors are status codes plus JSON diagnostics; no exceptions cross the ABI.
- The JavaScript adapter owns marshalling, validation, and fallback.

This keeps the boundary stable even if the backend is replaced, and it keeps
the MIT app free of the backend's headers.

## 7. If a native/WASM geometry backend is ever added

### 7.1 Decision order

1. **Stay JavaScript by default.** The analytic surface model is the product's
   differentiator and already carries contracts/certificates. A backend should
   be justified by a measured limitation, not by "real CAD kernels are C++."
2. **If mesh booleans/robust tessellation are the gap, use Manifold
   (Apache-2.0).** It is a small, permissively licensed library with a WASM
   build and a versioned API. This keeps the MIT app MIT.
3. **If B-rep/STEP/OCCT-class operations are the gap, isolate OCCT as an LGPL
   component.** Do not link it into the default browser bundle or the default
   server binary. Treat it as an optional, separately distributed module.
4. **Do not use GPL/AGPL code.** It would force the combined distribution under
   GPL/AGPL and is incompatible with the project's MIT distribution goal.

### 7.2 Separation patterns

| Pattern | MIT app | Backend | When to use |
|---|---|---|---|
| Separate process | Unchanged | LGPL executable over JSON/HTTP | Native desktop/server; strongest practical separation |
| Dynamic library | Unchanged | LGPL `.so`/`.dll`/`.dylib` | Native plugin; user can replace the library |
| Separate WASM artifact | Unchanged | LGPL `.wasm` + glue, separately downloaded | Browser; treat static link as a combined work and provide source/relink |
| Statically linked binary | Becomes combined work | LGPL inside the same executable | Avoid for the default MIT artifact |

For LGPL compliance, the minimum is:

- prominent notice that the app uses the library and that the library is
  covered by LGPL;
- a copy of the licence;
- complete corresponding source for the exact library version, including
  modifications;
- the user's ability to run the app with a modified library (dynamic linking,
  or object files/relink instructions for static/WASM);
- a written offer valid for at least three years if source is not bundled;
- no additional restrictions that forbid reverse engineering for debugging
  modifications.

The OCCT exception only covers object code that incorporates **header**
material; it does not remove these obligations for the library itself. If the
backend is OCCT-based, assume full LGPL section 6 compliance is required.

### 7.3 Recommended build shape

```
public/ (MIT)                         optional backend/ (separate licence)
  educad-kernel.js  -- capability -->  manifold.wasm (Apache-2.0)
  app shell         -- fallback   -->  occt-kernel.wasm/.so (LGPL-2.1+exception)
```

- Default build: `EDUCAD_KERNEL_BACKEND=none`; app is pure JavaScript.
- Optional build: `EDUCAD_KERNEL_BACKEND=manifold`; lazy-load a separate
  `.wasm`; Apache NOTICE and source URL in `THIRD_PARTY_NOTICES.md`.
- Experimental build: `EDUCAD_KERNEL_BACKEND=occt`; separate CMake project,
  separate licence file, separate artifact, not fetched by `npm start`.
- CI builds `none` and `manifold`; `occt` is an opt-in job. The default
  `npm start` must never require network access or a C++ geometry build.
- The backend exposes `apiVersion`/`contracts`; the loader refuses a major
  mismatch and falls back to JavaScript with a diagnostic.

### 7.4 WASM-specific notes

- Avoid `eval`/`new Function` in the loader; Manifold 3.5.4 explicitly fixed a
  CSP issue caused by `unsafe-eval`, so treat CSP compatibility as a release
  criterion.
- Budget the artifact: Manifold's npm package is ~1 MB according to its release
  checklist; a teaching app that currently ships zero npm dependencies should
  not silently add a multi-megabyte download.
- Use `WebAssembly.instantiateStreaming` with a fallback; keep the `.wasm` out
  of the initial critical path.
- Do not share C++ objects across the boundary. JSON in/out is slower but
  stable and auditable.
- If the backend is LGPL, the `.wasm` is a separate artefact with its own
  licence/source page; the MIT app must remain functional without it.

## 8. Risks and verification

### 8.1 Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Licence contamination from copied OCCT/FreeCAD/BRL-CAD code | Medium | High | No copy-paste; API ideas only; provenance review; CI licence scan |
| OCCT exception read as a full linking exception | Medium | High | Treat as header-only relief; legal review before any OCCT backend |
| Silent API drift in global modules | High | Medium | `EduCADKernel` aggregate, manifest, CI check, SemVer |
| Deep-import coupling in `tools/edc.js` | High | Medium | Route the runner through the aggregate; keep deep imports internal |
| Build environment drift (Node/CMake/compiler/system libs) | Medium | Medium | `.nvmrc`, `CMakePresets.json`, CI container, documented minimums |
| Missing third-party notices | High | Medium | `THIRD_PARTY_NOTICES.md` + mapping check |
| `prestart:cpp` pulls in Major2 tooling | Medium | Low-medium | Verify; decouple if not required for Major |
| Optional ERP/LLM services become hidden requirements | Medium | Medium | Default off; document failure modes; no geometry dependency |
| WASM artifact inflates load time or breaks CSP | Medium | Medium | Lazy load, size budget, CSP test, JS fallback |
| Contract change breaks saved drawings | Low-medium | High | Immutable contract IDs, `save-v1` migration tests |
| Overclaiming geometric uniqueness in API docs | Medium | Medium | Link `RECONSTRUCTION_CONTRACT.md`; report diagnostics, not guesses |

### 8.2 Verification plan

This round did not execute the app or backend. Before merging the policy, run:

1. **Existing drawing checks.** Run every `.edc` sheet through
   `node tools/edc.js`; require exit 0 for the canonical set. Add a loop in CI
   so new sheets are picked up automatically.
2. **Manual reproducibility.** `npm run build:manual` then
   `git diff --exit-code public/manual.html`. The builder is documented as
   deterministic; make that a gate.
3. **Backend build.** Configure and build in a clean directory with
   `cmake -S backend -B /tmp/educad-build -DCMAKE_BUILD_TYPE=Release` and
   `cmake --build /tmp/educad-build -j`. Run `educad-seed` and a login/save
   smoke test against a temporary database.
4. **Kernel load test.** `require()` every kernel module in plain Node with no
   `window`/`document`; assert the aggregate exposes the manifest keys.
5. **Manifest drift.** Run `tools/check-api.js`; fail on an export or contract
   that is not in `educad-api.json`.
6. **Licence mapping.** Compare `THIRD_PARTY_NOTICES.md` to
   `backend/third_party/` and the CMake link libraries; fail on an unmapped
   component.
7. **Version identity.** Assert `package.json` version ==
   `EduCADKernel.version`; assert contract IDs are unchanged or bumped
   according to the policy.
8. **Optional backend tests.** If added: load with a compatible version, load
   with an incompatible major (must fall back), and load with the backend
   missing (must still work).
9. **Reproducibility.** Build twice in the same image and compare generated
   files and binary hashes where practical; set `SOURCE_DATE_EPOCH` if the
   toolchain supports it.

## Appendix A: source register

Local files read for this report:

- `AGENTS.md` (project instructions supplied with this session; the file is
  gitignored and absent from this worktree)
- `package.json`, `LICENSE`, `CONTRIBUTING.md`, `README.md`
- `backend/CMakeLists.txt`, `backend/src/main.cpp` (header and routes),
  `backend/schema.sql`
- `public/index.html:633-667`
- `public/lib/educad-vec3.js`, `educad-surfaces.js`, `educad-command.js`,
  `educad-saves.js`, `educad-strict.js`, `educad-reconstruct.js`,
  `educad-parametric.js`, `educad-parametric-reconstruct.js`,
  `educad-shim.js`
- `tools/edc.js`
- `docs/RECONSTRUCTION_CONTRACT.md`, `docs/SURFACE_MODEL.md`,
  `docs/SURFACE_COMPLEX.md`

Upstream sources checked on 2026-11-11:

- OCCT 8.0.1 release:
  <https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8_0_1>
- OCCT README:
  <https://github.com/Open-Cascade-SAS/OCCT/blob/master/README.md>
- OCCT LGPL text:
  <https://github.com/Open-Cascade-SAS/OCCT/blob/master/LICENSE_LGPL_21.txt>
- OCCT exception:
  <https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt>
- SPDX OCCT exception:
  <https://spdx.org/licenses/OCCT-exception-1.0.html>
- OCCT version file:
  <https://github.com/Open-Cascade-SAS/OCCT/blob/master/adm/cmake/version.cmake>
- OCCT CMake:
  <https://github.com/Open-Cascade-SAS/OCCT/blob/master/CMakeLists.txt>
- OCCT module introduction:
  <https://dev.opencascade.org/doc/overview/html/index.html>
- OCCT build guide:
  <https://dev.opencascade.org/doc/overview/html/build_upgrade__building_occt.html>
- Open Cascade maintenance-release forum answer:
  <https://opencascade.org/content/open-cascade-starts-supporting-maintenance-releases-open-cascade-technology>
- FreeCAD 26.3 RC2:
  <https://github.com/FreeCAD/FreeCAD/releases/tag/26.3rc2>
- FreeCAD licence:
  <https://github.com/FreeCAD/FreeCAD/blob/main/LICENSE>
- FreeCAD contribution/licence policy:
  <https://github.com/FreeCAD/FreeCAD/blob/main/CONTRIBUTING.md>
- FreeCAD module build list:
  <https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CMakeLists.txt>
- FreeCAD Part `Init.py`:
  <https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/Part/Init.py>
- FreeCAD Draft `InitGui.py`:
  <https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/Draft/InitGui.py>
- FreeCAD addon index:
  <https://github.com/FreeCAD/FreeCAD-addons>
- FreeCAD developer handbook:
  <https://freecad.github.io/DevelopersHandbook/>
- Manifold v3.5.4:
  <https://github.com/elalish/manifold/releases/tag/v3.5.4>
- Manifold CMake:
  <https://github.com/elalish/manifold/blob/v3.5.4/CMakeLists.txt>
- Manifold public header:
  <https://github.com/elalish/manifold/blob/v3.5.4/include/manifold/manifold.h>
- Manifold npm:
  <https://www.npmjs.com/package/manifold-3d>
- Manifold PyPI:
  <https://pypi.org/project/manifold3d/>
- CadQuery 2.8.0:
  <https://pypi.org/project/cadquery/>
- CadQuery concepts/API layers:
  <https://cadquery.readthedocs.io/en/latest/primer.html>
- CadQuery setup:
  <https://github.com/CadQuery/cadquery/blob/master/setup.py>
- OCP:
  <https://github.com/CadQuery/OCP>
- build123d 0.13.0:
  <https://pypi.org/project/build123d/>
- build123d project metadata:
  <https://github.com/gumyr/build123d/blob/dev/pyproject.toml>
- build123d docs:
  <https://build123d.readthedocs.io/en/latest/>
- build123d builder mode:
  <https://build123d.readthedocs.io/en/latest/key_concepts_builder.html>
- build123d algebra mode:
  <https://build123d.readthedocs.io/en/latest/key_concepts_algebra.html>
- BRL-CAD 7.46.0:
  <https://github.com/BRL-CAD/brlcad/releases/tag/rel-7-46-0>
- BRL-CAD licence:
  <https://github.com/BRL-CAD/brlcad/blob/main/COPYING>
- BRL-CAD INSTALL:
  <https://github.com/BRL-CAD/brlcad/blob/main/INSTALL>
- BRL-CAD libged README:
  <https://github.com/BRL-CAD/brlcad/blob/main/src/libged/README>
- BRL-CAD libged CMake:
  <https://github.com/BRL-CAD/brlcad/blob/main/src/libged/CMakeLists.txt>
- BRL-CAD documentation:
  <https://brl-cad.github.io/docs/index.html>

## Appendix B: unverified or qualified claims

1. **OCCT maintenance-release ABI.** The 8.0.1 notes say the 8.0.x API/ABI
   baseline is unchanged, while an Open Cascade forum answer says maintenance
   releases are not generally binary-compatible. The safe engineering rule is
   "rebuild against the exact version"; confirm the policy for each release.
2. **FreeCAD addon installation paths and Addon Manager behaviour.** The
   FreeCAD wiki is behind an Anubis bot check and could not be read. The report
   relies on the source tree (`src/Mod`), `Init.py`/`InitGui.py`, and the
   addon-index README. Exact per-user directories and manager behaviour were
   not verified.
3. **CadQuery/build123d formal compatibility policies.** Their version numbers
   were read from PyPI, but no published SemVer/compatibility promise was
   found. Do not treat `2.8.0` or `0.13.0` as a guarantee beyond the observed
   release. The exact contents of the OCP wheels were not audited; the report
   infers OCCT bundling from OCP's role as the OCCT binding.
4. **BRL-CAD "BSD" shorthand.** `COPYING` says the unified work is LGPL and
   BSD/public-domain terms apply to distinct components. Treat "BRL-CAD is
   BSD" as imprecise unless the specific component is named.
5. **OCCT exception and static/WASM linking.** The exception text was verified
   via SPDX, but its legal effect on a statically linked or WASM-compiled
   combined work was not adjudicated. Assume full LGPL section 6 compliance
   until counsel says otherwise.
6. **`prestart:cpp` Major2 coupling.** Observed in `package.json`; not tested.
   It may be intentional (shared generated assets) or an unnecessary build
   dependency. Verify before changing.
7. **Distribution channel completeness.** The report lists the principal
   channels for each project, not every distro/package manager.
8. **FreeCAD 26.3 final status.** At the time of writing, 26.3 was at RC2;
   1.1 was the prior stable line. The final release may have shipped after the
   check.
9. **Manifold artifact sizes.** The ~1 MB npm and 600 KB-1.1 MB wheel figures
   come from Manifold's release checklist, not independent measurement.
10. **No build execution.** This round did not run `npm start`, CMake, or the
    `.edc` suite. The verification plan is proposed, not executed.

## Ranked recommendation

1. **Adopt a single `EduCADKernel` namespace with `apiVersion`, contract IDs,
   and a machine-readable manifest** (M1, M5, section 5). This is the highest
   leverage change: it turns the existing global modules and contracts into a
   real API without touching geometry code.
2. **Add release identity and provenance** (M2, M3): a non-zero package
   version, tags/changelog, `THIRD_PARTY_NOTICES.md`, and a licence mapping
   check. This closes the most immediate distribution gap.
3. **Automate the verification that already exists** (M4): build the backend,
   run the `.edc` suite, rebuild the manual and diff, load every kernel module,
   check the manifest and notices. Do this before adding any new backend.
4. **Make the build environment reproducible** (S1, S2): CMake presets,
   documented system-library minimums, a CI image, and a single build stamp
   instead of hand-edited cache-busting strings.
5. **Document the backend boundary** (M6): geometry is client-side; ERP and
   the LLM gateway are optional services; add a version endpoint.
6. **Only then consider an optional WASM backend** (O3, section 7). Prefer
   Apache-2.0 Manifold; keep OCCT as a separately distributed LGPL artifact;
   never bundle LGPL/GPL code into the default MIT app.
7. **Publish the kernel package and command-plugin protocol later** (O1, O2),
   after the manifest, versions, and CI are stable.

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

## Test

```sh
npm test       # full suite: baseline + phases 1–14 (616 checks)
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
| `npm run test:phase10` | Reconstruction: classes A/B/C, failures, live sync (44) |
| `npm run test:phase11` | Manual: Markdown→HTML build, in-app link, freshness guard (22) |
| `npm run test:phase12` | Reconstruction 3-view: PROFILE role, depth maps, triple gate (30) |
| `npm run test:phase13` | Curves: Class D cylinders/cones, K=24 tessellation (30) |
| `npm run test:phase14` | Glass overlay: fullscreen sheet, aura hit-test, orbit/zoom/pan (42) |

App entry point: [`mirror/index.html`](mirror/index.html).
Library modules: [`mirror/files/www.geogebra.org/`](mirror/files/www.geogebra.org/).

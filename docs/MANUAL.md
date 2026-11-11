# EduCAD User Manual

EduCAD is a zero-dependency teaching CAD for first-angle Monge projection.
Draw orthographic views, and the sheet reconstructs a 3D wireframe from the
vertices, edges, curves, and surfaces that the drawing actually supplies.

This manual covers **Major**, the original EduCAD interface. The separate
Major2 redesign is not part of this guide.

## 1. Quick start

1. Open the app. The login page offers **Academics**, **Teacher**, **Student**,
   or **Continue as guest**.
2. A guest gets the drawing sheet with no server saves. A logged-in user also
   gets **Save**, **Drawings**, **Sets**, and the role home page.
3. Draw the views on the sheet. The 3D panel rebuilds continuously.
4. Use the command line or the Draw menu. One command per line is also the
   `.edc` file format used by the headless verifier.

```sh
npm start
# opens http://127.0.0.1:8124/
```

## 2. Sheet and views

The sheet is in millimetres. The XY ground line separates the two main views:

- **plan** — below the ground line; sheet `(x, y)` means model `(x, -y)` in
  depth;
- **elevation** — above the ground line; sheet `(x, y)` is model height;
- **profile** — an optional side view. Its frame is declared with
  `/profile <xRef> <dRef> [s]`, or inferred from the drawing.

First-angle projection is the default. An optional profile frame maps model
depth `d` to sheet x as `xRef + s * (d - dRef)`.

Points that share a base name and satisfy the projection equations name one
3D station. `a` (plan), `a'` (elevation), and `a''` (profile) are the same
corner. Hidden verdicts in parentheses, such as `(a')`, do not change identity.

## 3. Drawing commands

Commands are case-insensitive. Coordinates and distances are millimetres;
angles are degrees.

| Command | Purpose |
|---|---|
| `/point <name> <x> <y> [plan|elevation|profile]` | Place a named station |
| `/line <from> <to> [bis] [role]` | Straight segment |
| `/ray <from> <to> [bis] [role]` | Ray |
| `/xline <from> <to> [bis] [role]` | Construction line |
| `/circle <center> <r> [bis] [role]` | Circle |
| `/arc <center> <r> <a1> <a2> [bis] [role]` | Circular arc |
| `/curve-through <p1> <p2> ... [closed] [role]` | Interpolated cubic curve through ordered stations |
| `/circle-through <p1> <p2> <p3> [role]` | Exact circle through three stations |
| `/arc-through <start> <through> <end> [role]` | Exact oriented arc through three stations |
| `/polyline <p1> <p2> ...` | Open chain of segments |
| `/polygon <p1> <p2> <p3> ...` | Closed chain |
| `/ellipse <center> <rx> <ry> [n] [bis] [role]` | Ellipse ring as an n-segment chain |
| `/hatch <x1> <y1> <x2> <y2> <spacing> [angle] [role]` | Section hatch in a rectangle |
| `/dimension <from> <to> [bis] [role]` | Measured span |
| `/text <x> <y> <words...>` | Sheet text |
| `/profile <xRef> <dRef> [s]` | Declare the side-view frame |
| `/datum [x1] [x2]` | XY ground line |
| `/rename <point> <label> [local|linked|members]` | Label or identity edit |
| `/delete <name>` | Delete an entity |
| `/style <name> <bis> [role]` | Change BIS line type or view |
| `/clear`, `/undo` | Clear or undo the sheet |

The command line accepts one command per line. `/help` lists the palette and
`/help <command>` explains one command.

## 4. Editing and identity

- A point has a stable entity ID and one or more `meta.members` records.
- A member ID is the editing identity. Labels are presentation.
- The **Project** tool explicitly links stations; merely typing the same label
  on two new points does not merge them.
- Moving a linked station propagates through the member ID and checks the
  projection equations before committing.
- Detaching a station gives its member a new identity.
- Curves built by `/curve-through`, `/circle-through`, or `/arc-through` keep
  their defining stations. Edit a defining point to rebuild the curve; the
  control point fields are read-only.

Legacy drawings without member IDs are imported by an explicit compatibility
pass. It reads base names once and never silently migrates them again.

## 5. What the 3D view reconstructs

The public pipeline is `EduCADReconstruct.reconstruct(entities, options)`.
It does not require a solid name or a feature declaration.

1. Collect points, straight edges, curves, and explicit identities.
2. Pair observations across views.
3. Lift vertices, straight edges, and supported analytic curves.
4. Infer planar regions and bounded analytic surfaces.
5. Return geometry plus specific diagnostics for anything unresolved.

Supported analytic curves include circles, circular arcs, oblique circles,
elliptical arcs, and interpolated station curves (NURBS). Supported bounded
surfaces are **plane, cylinder, cone, and sphere**, with shared boundary loops.

A curved boundary alone does not determine its spanning surface. The pipeline
reports `curve-surface-unresolved` rather than inventing one. A closed shell is
inferred when the supplied boundaries and side surfaces close it.

## 6. Curves and surfaces

- A true-shape circle or arc seen in one principal view and edge-on in another
  is lifted directly.
- A circle in a general plane projects as an ellipse. Two ellipse views, an
  ellipse plus an edge-on run, or an ellipse plus linked point evidence recover
  the spatial circle.
- An open elliptical chain is fitted as an analytic oblique arc, including major
  arcs and sweeps across the angular origin.
- Two coaxial circular/elliptical boundaries plus matching generators define a
  cylinder, cone, or frustum. The same construction handles a collapsed
  boundary (an apex).
- A true-shape circle plus a slanted edge-on trace defines an inclined
  elliptical boundary; two silhouette generators bound the truncated cylinder.
- A circle in an inclined plane plus two tangent generator strokes can define a
  right cone whose apex lies on the base circle's plane normal.
- A full circular mouth in one principal view and a rim-to-rim silhouette arc in
  the other can define a spherical recess.
- A circular mouth plus a four-sided face frame and edge-on depth strokes can
  define a flat-bottomed cylindrical recess.

Surface records carry analytic parameters, ordered loops, source IDs, and
display faces. The surface model validates boundary incidence and closed shells,
and it can certify the stored analytic parameters separately from the display
triangles.

## 7. Verification with EduCAD Script

`.edc` and `.edu` files contain slash commands and comment directives. The
headless runner is the only test suite.

```sh
node tools/edc.js tools/scripts/quad3d.edc
node tools/edc.js --solid tools/scripts/truncated-cylinder.edu
node tools/edc.js --strict tools/scripts/ruled-chain.edu
```

`# expect:` asserts topology and reconstruction properties:

```text
# expect: 48V 72E 26F curves=2 surfaces=3 surfaceKinds=cylinder,plane \
  surfaceLoops=4 surfaceShells=1 surfaceOpen=0 surfaceBoundary=0 \
  surfaceModel=ok surfaceCertificate=ok surfaceValidation=ok \
  diagnostics=none unresolved=0 status=inferred
```

Useful properties include `curves`, `surfaces`, `surfaceKinds`,
`surfaceLoops`, `surfaceShells`, `surfaceOpen`, `surfaceBoundary`,
`surfaceModel`, `surfaceValidation`, `surfaceCertificate`, `recesses`,
`obliqueArcs`, `arcSweep`, `parametricCurves`, `diagnostics`, `unresolved`,
and `status`.

`# surface-query:` exercises the public surface API on the reconstructed model:

```text
# surface-query: {"operation":"section","surface":0,"plane":{"origin":{"x":20,"y":0,"z":30},"normal":{"x":0,"y":1,"z":0}},"expect":{"kind":"circle","radius":20}}
# surface-query: {"operation":"intersect","surfaces":[0,1],"expect":{"kind":"circle","relation":"transverse"}}
# surface-query: {"operation":"split","surface":0,"plane":{"origin":{"x":0,"y":0,"z":0},"normal":{"x":1,"y":0,"z":0}},"expect":{"refused":false}}
```

`# pose-check:` applies a declared pose and verifies the 3D-to-2D projection.
`# reject:` asserts that an invalid command leaves the sheet unchanged.

A missing-view or contradictory sheet may deliberately expect a diagnostic.
`unresolved` counts reported diagnostics. No separate unit-test files are used.

## 8. Diagnostics

Diagnostics name the unresolved observation rather than guessing:

| Code | Meaning |
|---|---|
| `curve-projection-missing` | No matching edge-on or elliptical projection |
| `curve-projection-conflict` | Supplied views disagree at the curve stations |
| `curve-correspondence-ambiguous` | More than one station ordering fits |
| `curve-surface-unresolved` | The 3D curve is known; its spanning surface is not |
| `oblique-curve-ambiguous` | Two depth mirrors remain for an oblique circle |
| `oblique-point-conflict` | Linked boundary points contradict every candidate plane |
| `oblique-line-conflict` | An edge-on run does not match the curve plane |
| `cone-apex-conflict` | Tangent generators do not meet on the base normal |
| `recess-mouth-unclosed` | The cavity is known but no mouth closure was drawn |
| `recess-depth-missing` | No depth evidence for a cylindrical recess |
| `surface-boundary-off-surface` | A boundary does not lie on its claimed surface |
| `surface-section-mismatch` | A cylinder boundary plane does not reproduce the boundary |

The 3D panel shows the reconstructed wire and reports these codes. A partial
result is still useful: resolved geometry remains visible while unresolved
entities are named.

## 9. Limits

- Arbitrary curved-surface intersection and Boolean subtraction are not
  implemented. Known special cases are exact; unsupported pairs return `null`.
- A curved analytic surface is not certified by its display mesh.
- A recess does not Boolean-subtract an independently drawn surrounding solid.
- A cylindrical fillet between two planar faces is not yet supported because
  curved-surface loops do not accept straight boundary elements.
- A loop crossing a cutting plane is not split; the cut is refused.
- Profile mouths and elliptical recess mouths are not inferred.
- Numeric tolerances are millimetre-scale; extreme coordinate ranges still need
  robustness work.

## 10. Developer reference

| Area | Files |
|---|---|
| App entry | `public/index.html` |
| Drawing/commands | `public/lib/educad-drafting.js`, `educad-command.js` |
| Entities and identity | `public/lib/educad-entities.js` |
| Primitive reconstruction | `public/lib/educad-reconstruct.js` |
| Curves and ruled surfaces | `public/lib/educad-curve-reconstruct.js`, `educad-oblique-kernel.js` |
| Parametric station curves | `public/lib/educad-parametric.js`, `educad-parametric-reconstruct.js` |
| Bounded analytic surfaces | `public/lib/educad-surfaces.js` |
| Reference previews | `public/lib/educad-ref3d.js` |
| Headless verification | `tools/edc.js`, `tools/scripts/` |
| Backend | `backend/` (C++17, SQLite, libsodium, libcurl) |

Design notes:

- [`docs/PRIMITIVE_RECONSTRUCTION.md`](PRIMITIVE_RECONSTRUCTION.md) — the
  primitive pipeline and supported curve/surface cases.
- [`docs/SURFACE_MODEL.md`](SURFACE_MODEL.md) — the bounded analytic model,
  sections, trims, intersections, and certificate.
- [`docs/SURFACE_COMPLEX.md`](SURFACE_COMPLEX.md) — how the surface and
  boundary operations fit together.
- [`docs/IDENTITY_RULES.md`](IDENTITY_RULES.md) — stable IDs and editing rules.
- [`docs/RECONSTRUCTION_CONTRACT.md`](RECONSTRUCTION_CONTRACT.md) — the exact
  declared-topology certificate.

The manual page served by the app is generated from this file:

```sh
npm run build:manual
```

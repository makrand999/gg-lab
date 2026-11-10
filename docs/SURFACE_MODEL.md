# Bounded analytic surface model

Major's primitive pipeline reconstructs curves and then infers surfaces. Curves
alone do not say how a surface is bounded, which side is material, or how two
patches share an edge. `public/lib/educad-surfaces.js` adds that layer next to
the display geometry. It is still an inferred model, not an exact certificate.

## Representation

`geometry.surfaces` is an array of bounded analytic surfaces. Each surface has:

- `kind`: `plane`, `cylinder`, `cone`, or `sphere`.
- Analytic parameters: a plane point and normal, a cylinder/cone origin, unit
  `axis` and `radius`, a cone `apex` and `halfAngle`, or a sphere `center` and
  `radius`.
- `loops`: ordered boundary loops. A loop is either
  `{kind:'outer'|'inner', vertices:[...]}` for a planar face,
  `{kind:'outer'|'inner', curves:[...]}` for an analytic boundary, or
  `{kind:'outer', section:{...}}` after an analytic trim.
- `sourceIds`: drawing entities that produced the surface.
- `displayFaceIndices`: the display faces that approximate it.
- `closed`: true only for a surface with no boundary, such as a complete sphere.

`geometry.surfaceModel` summarizes the model: surface count and kinds, boundary
loops, closed shells, open components and open boundary elements.
`geometry.analyticSurfaceValidation` records the model checks.

A boundary curve may be shared by two surfaces. That is the model's seam: the
same object is referenced by both loops, so a cap and a side surface cannot
drift apart silently. An unshared boundary makes the component open, which is
normal for a plate or an unfinished drawing.

## Construction from inferred patches

The model is built from the same patches used by the preview:

- a logical planar region becomes a `plane` with its `outer` and `holes`;
- a circular or elliptical end cap becomes a bounded `plane` whose loop is the
  analytic boundary curve;
- a ruled patch between coaxial/silhouette-matched boundaries becomes a
  `cylinder` or `cone`, with generators attached through `sourceIds`;
- a sphere silhouette pair becomes a `sphere`.

The straight-wire adapters expose `faceRegions` rather than `surfacePatches`;
the builder accepts either form. The app, saved previews and the `.edu` runner
therefore receive the same surface records from the same public pipeline.
`educad-ref3d.js` preserves the records in saved previews and accepts the new
`ellipse` analytic curve kind.

## Validation

`Surfaces.validate(model, geometry)` checks:

- finite analytic parameters and positive radii;
- sampled boundary points lie on their claimed surface;
- a cylinder boundary's own plane sections the cylinder back to that boundary;
- plane boundaries lie in their plane;
- every boundary is used by at most two surfaces;
- connected components are closed when every boundary is shared exactly twice.

The result is `ok`, `partial` (open but consistent), or `issues`. This is
separate from `surfaceValidation`, which checks only the display triangulation.
A curved analytic surface is not certified by a triangle mesh; the checks above
test the analytic definitions and their boundaries.

## Intersections and trimming

`Surfaces.section(surface, plane)` returns analytic section geometry:

- plane–plane: a line, or coplanar overlap;
- plane–sphere: a circle or tangent point;
- plane–cylinder: a circle, ellipse, one/two generator lines, or none;
- plane–cone: a circle, apex point, or an ellipse/parabola/hyperbola classification.

Sections describe the supporting analytic surface; boundary loops are not used
to clip section results. The cone support is a double cone, consistent with
boundary validation. Its axis sign does not select a nappe. A bounded cone
patch is selected by its boundary geometry.

`Surfaces.trim(surface, plane, keepPositive, geometry)` replaces the boundary
loops on the discarded side with the analytic section. It refuses loops that
cross the cutting plane instead of guessing a split. Curve side classification
uses analytic signed-distance extrema, including arc endpoints. Only closed
circle/ellipse sections can currently become trim boundaries; open line sets,
unparameterized conics, and tangent points are rejected. Inline section curves
participate in the same boundary validation and incidence analysis as drawing
curves. A trim is open until its new boundary is shared with another patch;
sharing an inline section requires referencing the same section object. This is the first trimming
operation; general surface–surface intersections and splitting of arbitrary
curved loops remain future work.

## End-to-end case: truncated cylinder

`truncated-cylinder.edu` draws a plan circle, a slanted elevation trace, and
the two silhouette generators. The pipeline:

1. pairs the circle with the base trace, producing a circular boundary;
2. pairs the same circle with the inclined trace, producing an analytic
   `ellipse` in the cutting plane;
3. joins the two boundaries with the two generator strokes, producing a
   bounded `cylinder` side surface;
4. adds a planar base cap and an inclined elliptical cap, sharing both
   boundary curves with the side surface.

No solid name is read from the drawing. The model reports one closed shell,
three surfaces (`cylinder`, `plane`, `plane`) and four boundary loops.

```sh
node tools/edc.js tools/scripts/truncated-cylinder.edu
node tools/edc.js tools/scripts/truncated-cylinder-opposite.edu
node tools/edc.js tools/scripts/truncated-cylinder-profile.edu
node tools/edc.js tools/scripts/truncated-cylinder-depth-axis.edu
node tools/edc.js tools/scripts/truncated-cylinder-mismatch.edu
node tools/edc.js tools/scripts/truncated-cylinder-missing-surface.edu
node tools/edc.js tools/scripts/truncated-cylinder-ambiguous.edu
```

The `.edu` properties are `surfaces`, `surfaceKinds`, `surfaceLoops`,
`surfaceShells`, `surfaceOpen`, `surfaceBoundary`, and `surfaceModel`. For
example:

```text
# expect: 48V 72E 26F curves=2 surfaces=3 surfaceKinds=cylinder,plane surfaceLoops=4 surfaceShells=1 surfaceOpen=0 surfaceBoundary=0 surfaceModel=ok surfaceValidation=ok unresolved=0 status=inferred
```

The mismatch case reports `curve-inclined-arc-unsupported`; the two-cut case
reports `curve-projection-ambiguous` and retains both candidate levels.

## Limits

- Only principal/oblique circles and the new inclined full-circle traces are
  lifted; inclined arcs are reported unsupported.
- Cone sections are classified but not yet returned as trimmed ellipse/hyperbola
  boundary curves.
- General cylinder–cylinder, cone–cylinder and curved-surface intersections are
  not implemented. Coaxial/parallel special cases can be added without changing
  the model shape.
- Trimming handles one cutting plane at a time and does not split a loop that
  crosses the plane.
- The model is inferred. It does not replace the exact declared-triangle
  certificate in `RECONSTRUCTION_CONTRACT.md`.

## Drawing-script surface queries

Drawing scripts can check the public section and trim APIs on their reconstructed
surfaces, without introducing a separate test suite:

```text
# surface-query: {"operation":"section","surface":0,"plane":{"origin":{"x":20,"y":0,"z":30},"normal":{"x":0,"y":1,"z":0}},"expect":{"kind":"circle","radius":20}}
# expect: surfaceChecks=1 surfaceQueries=ok
```

`expect` is a recursive subset of the result with numeric tolerance. A trim
query returns `{surface, validation}` (or `null` if unsupported); `save` names
the resulting surface for a subsequent query's `from` field. This allows a
later cut to verify earlier section boundaries. Queries do not change the
reconstructed drawing or its topology expectations.

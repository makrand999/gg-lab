# Bounded analytic surface model

Major's primitive pipeline reconstructs curves and then infers surfaces. Curves
alone do not say how a surface is bounded, which side is material, or how two
patches share an edge. `public/lib/educad-surfaces.js` adds that layer next to
the display geometry. The model is inferred; `Surfaces.certify` separately
records what can be checked analytically, without turning inferred surfaces
into declared ones. See [Toward a bounded analytic surface
complex](SURFACE_COMPLEX.md) for how cone, recess, intersection and certificate
operations share the same boundary vocabulary.

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
  A spherical patch with a boundary loop (a recess cap) is not closed.

A plane may carry both vertex loops and analytic inner loops; the recess mouth
closure uses an analytic outer loop. A sphere may carry one analytic boundary
loop. The complete-sphere silhouette case still has no loops.

`geometry.surfaceModel` summarizes the model: surface count and kinds, boundary
loops, closed shells, open components and open boundary elements.
`geometry.analyticSurfaceValidation` records the model checks.
`geometry.analyticCertificate` records the detailed analytic certificate
described below. It is separate from `geometry.surfaceValidation`, which is the
display-triangle certificate.

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
- a closed circle in a general plane becomes a bounded `plane` cap on its own,
  or a `cone` when tangent generator strokes support one apex on that circle's
  plane normal. The cap and cone share the analytic boundary curve;
- a sphere silhouette pair becomes a `sphere`.
- a spherical recess becomes an open `sphere` with the mouth circle as its
  outer loop; an edge-on mouth stroke adds a coplanar closure sharing that
  loop.

The straight-wire adapters expose `faceRegions` rather than `surfacePatches`;
the builder accepts either form. The app, saved previews and the `.edu` runner
therefore receive the same surface records from the same public pipeline.
`educad-ref3d.js` preserves the records and `analyticCertificate` in saved
previews and accepts the new `ellipse` analytic curve kind.

## Validation and analytic certificate

`Surfaces.validate(model, geometry)` is the lightweight consistency check:

- finite analytic parameters and positive radii;
- sampled boundary points lie on their claimed surface;
- a cylinder boundary's own plane sections the cylinder back to that boundary;
- plane boundaries lie in their plane;
- a spherical cap's pole, angle and mouth plane agree with its boundary loop
  (`R cos(angle)` along the pole, mouth radius `R sin(angle)`);
- every boundary is used by at most two surfaces;
- connected components are closed when every boundary is shared exactly twice.

The result is `ok`, `partial` (open but consistent), or `issues`. This is
separate from `surfaceValidation`, which checks only the display triangulation.
A curved analytic surface is not certified by a triangle mesh; the checks above
test the analytic definitions and their boundaries.

`Surfaces.certify(model, geometry)` returns the detailed
`analytic-surface-certificate-v1` certificate. It inspects only the bounded
surface model, never the display triangles, and it never changes the model.
Its status uses the same words:

- `ok`: every surface check passed and every shell is closed;
- `partial`: no failed check, but at least one open boundary or open component
  (or the model contains no analytic surfaces);
- `issues`: at least one failed check, invalid parameter, non-manifold or
  self-shared boundary, or build diagnostic.

The certificate shape is:

```js
{
  contract: 'analytic-surface-certificate-v1',
  modelContract: 'analytic-surface-v1',
  arithmetic: 'mixed-exact-rational-and-numeric',
  status: 'ok' | 'partial' | 'issues',
  surfaceCount, boundaryCount,
  counts: {
    surfaces, boundaryLoops, boundaries, sharedBoundaries, openBoundaries,
    nonmanifoldBoundaries, selfSharedBoundaries, closedShells, openComponents,
    checks, exactChecks, numericChecks, errors, warnings, issues
  },
  surfaces: [{
    id, kind, closed, sourceIds, displayFaceIndices, parameters,
    loops: [{
      id, kind, elements, sourceIds,
      incidence: {
        elements: [{id, useCount, surfaces}],
        shared, open, nonmanifold, selfShared
      },
      checks, status
    }],
    checks: [{
      id, check, status, arithmetic, method,
      residual, tolerance, samples, exactPass, exactReason, issue
    }],
    status
  }],
  boundaries: [{
    id, kind, sourceIds, useCount, surfaces, status,
    curveIndex, vertices, sectionType
  }],
  shells: [{
    id, surfaces, boundaryIds, boundaryCount, openBoundaryIds, closed,
    status, sourceIds
  }],
  issues: [{
    id, code, severity, message, sourceIds,
    surfaceId, boundaryId, surfaceIds, boundaryIds,
    check, arithmetic, residual, tolerance
  }]
}
```

`parameters` contains the analytic definition: plane origin/normal/frame;
cylinder origin/axis/radius; cone origin/axis/radius/apex/halfAngle; sphere
centre/radius. A `check.issue` field is the code that would be used if that
check failed; an `issues[]` entry is an actual finding. The order is
deterministic: model diagnostics, surfaces and loops in model order, boundary
records in element order, then shells.

### Exact versus numeric checks

Exact checks are evaluated by rational arithmetic on the exact decimal values
of the stored JavaScript numbers:

- stable ids, kind, boundedness, closed-flag consistency and boundary
  incidence/closure counts;
- finiteness;
- exactly positive radii and half-angle positivity;
- plane vertex coplanarity, using a homogeneous determinant rather than a
  normalized normal;
- cylinder boundary radius equality when the drawn radius is exactly the
  stored radius.

Numeric checks carry an explicit `tolerance` and usually a `residual`:

- unit normals, axes and plane frames;
- sampled boundary-on-surface residuals (33 samples per analytic curve);
- cylinder boundary section reproduction (centre and both radii);
- boundary-centre offsets from a cylinder or cone axis;
- cone apex-on-axis and half-angle/base-radius relations.

These are marked `arithmetic: 'numeric'` and `method: 'numeric-*'`. They are
tolerance checks, not rigorous interval enclosures. If exact plane coplanarity
fails because the stored decimal vertices carry floating-point construction
error, but the numeric residual is within tolerance, the certificate reports
the check as numeric with `exactPass: false` and `exactReason`; it does not
claim exact coplanarity.

Typical issue codes are `certificate-plane-normal-invalid`,
`certificate-plane-frame-invalid`, `certificate-cylinder-radius-invalid`,
`certificate-cylinder-axis-invalid`, `certificate-cylinder-radius-mismatch`,
`certificate-cylinder-section-mismatch`, `certificate-cone-apex-off-axis`,
`certificate-cone-half-angle-invalid`, `certificate-sphere-radius-invalid`,
`certificate-boundary-off-surface`, `certificate-boundary-nonmanifold`,
`certificate-boundary-self-shared`, `certificate-open-component` and
`certificate-empty-model`. Warnings (open components, empty models) produce
`partial`; all other listed codes produce `issues`.

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
sharing an inline section requires referencing the same section object. `trim`
remains the one-sided operation; `split` below performs the two-sided cut,
including a loop that crosses the plane. `cone.edu` exercises a cone trim
parallel to its base; an oblique conic cut is rejected rather than approximated.

### Splitting a surface and sharing a boundary

`Surfaces.split(surface, plane, geometry, diagnostics)` divides one bounded
curved surface at a plane. It returns `null` when it cannot do so soundly. On
success it returns:

```js
{
  kind: 'split',
  surfaceId,                    // the input surface id
  plane: {origin, normal},
  section,                      // one full analytic circle/ellipse record
  positive, negative,           // same objects as surfaces[0], surfaces[1]
  surfaces: [positive, negative],
  sectionArcs,                  // crossing cuts only: the shared sub-arcs
  sectionArcCount
}
```

`positive` is the side where the signed distance to the plane is positive.
When every loop stays wholly on one side, both pieces carry the exact same
full `section` object in their new outer loop, so the cut is already a shared
boundary with incidence 2. When a loop crosses the plane, the full section is
not a boundary of the bounded band: it is split at the same crossings and only
the section sub-arcs inside the patch are shared. `sectionArcs` lists those
sub-arcs; the pieces reference the same objects in their ordered loops, so
incidence is again 2 without a sampled seam. In both cases the result is a
valid two-patch model without a second construction step:

- splitting a complete sphere through its centre gives two spherical caps and
  one closed shell;
- splitting the truncated-cylinder side above its base gives two cylinder bands
  that share the new circle and retain one original end loop each;
- splitting a truncated-cylinder band obliquely through both end loops gives
  one patch per side, each bounded by one top sub-arc, one bottom sub-arc and
  the same two section arcs;
- splitting a spherical-recess cap through its mouth gives two open lunes,
  each bounded by one mouth sub-arc and the same section arc;
- splitting a cone between its apex and base gives a tip patch (bounded by the
  section and the apex) and a frustum band (bounded by the section and base).

The pieces keep the analytic kind and parameters, `sourceIds` (plus the
section's source ids), `displayFaceIndices`, and the input `patchIndex`. Their
ids are `<surface-id>/split:positive` and `<surface-id>/split:negative`; they
also record `parentSurfaceId` and `splitBy` (`sectionKind`, `side`, and for a
crossing cut `sectionArcCount` and `analyticLoops:true`). The advisory
`boundaryCurves` list and the single-cap metadata (`cap`, `recess`) are dropped
because the pieces no longer have one mouth loop. Display faces are inherited,
not re-tessellated; split is an analytic boundary operation.

#### Crossing-loop algorithm

For a loop that has points on both sides, `split` cuts the boundary itself
instead of refusing:

1. A circle, ellipse or arc is intersected with the plane analytically. With
   the curve parameter `c + r_u cos(t) u + r_v sin(t) v`, the signed distance is
   `A cos(t) + B sin(t) + C`; its roots split the curve into ordered sub-arcs.
   Each sub-arc keeps the parent centre, frame, radii, start angle and sweep
   direction. A same-side run that crosses the `0..2π` parameter origin is
   re-joined into one sub-arc rather than two boundary elements. A tangent root
   does not split the curve.
2. A vertex loop is walked edge by edge. An edge whose endpoints straddle the
   plane is cut at linear parameter `d0/(d0-d1)`. The cut point must lie on the
   analytic surface (otherwise `split-loop-crossing-off-surface`); a loop edge
   lying in the plane is refused with `split-loop-on-plane`.
3. The full section is split at the same crossing stations. Each section arc
   is classified against the bounded patch: a spherical cap uses its analytic
   pole/mouth half-space; a cylinder or cone patch tests the point's axial
   station against the station where the same generator meets each boundary
   loop. Only arcs strictly inside the patch become the shared section
   sub-arcs. An arc on the loop boundary or a patch test that cannot be decided
   is refused rather than guessed.
4. Each side keeps its own loop sub-arcs and the shared section sub-arcs.
   Endpoints are matched analytically and traced into closed cycles; a chain
   that does not close, a section-only cycle, or an unused chain is refused
   with `split-loop-assembly-failed`. Cycles become ordered `elements` loops:
   `{kind:'curve',curve}` for an analytic sub-arc and
   `{kind:'polyline',points}` for an inline straight piece. Loops that stay
   wholly on one side keep their original boundary identity and vertex or
   curve references.
5. A side is bounded when it receives at least one assembled or retained loop,
   or by the existing compact-sphere/cone-apex rules. Otherwise the split is
   refused with `split-patch-unbounded`.

The operation remains deliberately conservative:

- only `cylinder`, `cone` and `sphere` supports are split; a bounded planar
  face returns `split-plane-surface-unsupported`;
- the plane section must be a closed `circle` or `ellipse`. A line set,
  tangent point, classified conic, coplanar overlap or missing section is
  refused. In particular, the current cone classifier returns `conic` for every
  oblique plane, so a cone base crossed by an oblique cutting plane is still
  refused rather than approximated;
- a crossing cut needs a closed, single-valued patch boundary. A cylinder needs
  both end loops; a cone needs two loops or one loop plus its apex; a sphere
  patch needs recess `cap` metadata. Other crossing topologies return
  `split-patch-topology-unsupported`, `split-sphere-cap-unknown` or
  `split-loop-disconnected`;
- a loop lying in the plane is refused with `split-loop-on-plane`;
- `trim` still refuses crossing loops; only `split` cuts them.

`Surfaces.splitDiagnostic(surface, plane, geometry)` returns `null` when the
same call would succeed, otherwise a `{code, message, ...}` record with fields
such as `sectionKind`, `loopIndex`, `side` or `reason`. `split` also accepts an
optional fourth argument, an array that receives that same record, so a caller
can get the reason in one traversal. Refusal codes include
`split-surface-missing`, `split-plane-invalid`, `split-surface-kind-unsupported`,
`split-plane-surface-unsupported`, `split-section-missing`,
`split-section-not-closed`, `split-section-invalid`,
`split-section-degenerate`, `split-boundary-invalid`, `split-surface-unbounded`,
`split-loop-on-plane`, `split-loop-mixed-elements`,
`split-loop-unsupported-element`, `split-loop-disconnected`,
`split-loop-crossing-off-surface`, `split-loop-crossing-missing`,
`split-loop-assembly-failed`, `split-section-tangent`,
`split-section-intersection-mismatch`, `split-section-outside-patch`,
`split-sphere-cap-unknown`, `split-patch-topology-unsupported` and
`split-patch-unbounded`.

`Surfaces.attachBoundary(surface, boundary, geometry, diagnostics)` clones a
surface with one additional loop of the form `{kind:'outer', section:boundary}`.
The exact boundary object is preserved, so calling it on two surfaces promotes
that boundary from one use to two. `Surfaces.shareBoundary(a, b, boundary,
geometry)` is the two-surface convenience form and returns
`{boundary, surfaces:[a', b']}`. Attachment is a structural promotion, not a
clip:

- `boundary` must be a valid analytic circle or ellipse with a full closed
  sweep (an arc is refused with `attach-boundary-open`);
- its sampled points must lie on the target surface within
  `surfaceTolerance` (otherwise `attach-boundary-off-surface`);
- a surface cannot use the same boundary object twice
  (`attach-boundary-duplicate`);
- the clone sets `closed:false`, drops `cap`, records `parentSurfaceId` and
  `attachedBoundary`, and gets the id
  `<surface-id>/attach:<previous-loop-count>`;
- the target surface is not re-clipped. Attaching an equator circle to a plane
  square leaves the square loop in place; the model records both loops and the
  shared boundary, but the plane's outer material region is unchanged. A caller
  that needs a bounded cap must supply a surface whose loop is that cap.

`Surfaces.intersectionCurves(result)` promotes a closed intersection or section
result into one or more analytic boundary curve records. It accepts
`kind:'circle'`, `kind:'ellipse'`, and the `kind:'circles'` pair from
sphere/cylinder intersections. Each record is a full `0..2π` curve with
`closed:true`, `promoted:'intersection'` and an `intersection` field containing
the source `kind`, `relation`, `surfaceIds` and `surfaceKinds`. `line`,
`lines`, `point`, `conic`, `plane-overlap`, `coincident` and `none` results
return `null`; those do not bound a patch. The returned records are ordinary
`section` loop elements, so `attachBoundary`, `split`, `validate`, `certify`
and `incidence` consume them without a second curve vocabulary.

`Surfaces.intersect(a, b)` returns the intersection of two supporting analytic
surfaces. It does not sample the display mesh and does not clip the result to
either surface's boundary loops. A supported pair always returns a result;
`kind: 'none'` means the supporting surfaces do not meet. An unsupported pair
returns `null`, so a caller can distinguish "no intersection" from "not
implemented".

Every result carries:

- `kind`: `line`, `lines`, `circle`, `circles`, `ellipse`, `conic`, `point`,
  `plane-overlap`, `coincident`, or `none`;
- `surfaceIds` in the argument order and `surfaceKinds` in the same order;
- `relation`: `transverse`, `tangent`, `coincident`, `degenerate`, or `none`;
- `reason` for `none` (`parallel`, `separate`, `contained`, `concentric`,
  `coaxial`, or `no-section`);
- `tangent: 'external' | 'internal'` for the sphere and parallel-cylinder
  tangencies where that distinction is meaningful, and `degenerate: true` for
  a zero-dimensional point result.

Parameters use the same vocabulary as `section`: `origin`/`direction` for a
line, `lines` for a pair of lines, `center`/`u`/`v`/`radius` for a circle,
`circles` for two circles, `plane` for coplanar planes, and `point` for a
point. `ellipse` and `conic` reuse the section fields.

Supported exact families and formulas:

- **plane–plane**: non-parallel planes meet in the line through the planes with
  direction `n1 × n2`; parallel coincident planes return `plane-overlap` with
  `relation: 'coincident'`; distinct parallel planes return `none`.
- **plane–sphere, plane–cylinder, plane–cone**: these delegate to `section`,
  so the result is exactly the section kind: circle, ellipse, generator line
  set, tangent point, apex point, or classified cone conic. A plane
  perpendicular to the cone axis through its apex is a point result with
  `relation: 'degenerate'`; the pre-existing `section` classification limits
  still apply to oblique apex planes.
- **sphere–sphere**: with `d = |c2 - c1|`, `h = (d² + r1² - r2²) / (2d)` and
  `ρ = sqrt(r1² - h²)`, a transverse pair meets in the circle centred at
  `c1 + h(c2 - c1)/d` with radius `ρ`. Equal centres and radii are coincident;
  `d = r1 + r2` or `d = |r1 - r2|` is an external or internal tangent point;
  separated or nested spheres return `none`.
- **parallel/coaxial cylinder–cylinder**: with perpendicular axis distance `p`,
  `h = (p² + r1² - r2²) / (2p)` and `s = sqrt(r1² - h²)`, a transverse pair
  meets in the two lines through `o1 + h e ± s w` parallel to the common axis,
  where `e` is the unit offset between axes and `w = a × e`. `s = 0` gives one
  tangent line; coaxial equal-radius cylinders are coincident; coaxial or
  separated/nested cylinders return `none`.
- **sphere–cylinder**: supported when the cylinder axis passes through the
  sphere centre. With `h = sqrt(R² - r²)`, `R > r` gives two circles centred at
  `c ± h a` with the cylinder radius; `R = r` gives one tangent circle; `R < r`
  returns `none`. The reversed pair produces the same components. An offset
  axis is supported only for the clearly separate/nested `none` cases; a
  possible quartic intersection returns `null`.

Tolerances are relative (`1e-6` of the largest relevant radius or distance) so
that reconstructed drawings with small numeric noise still classify tangency
and coincidence correctly. Near-parallel planes are reported as parallel
rather than as a very distant line.

## End-to-end case: cone over an inclined circle

`cone-oblique-boundary.edu` draws a circle in a general plane as a closed
approximating polyline in plan and elevation, then two tangent generators in
elevation. The pipeline:

1. pairs the two projected ellipses and recovers the 3D base circle (centre,
   plane normal, and radius) without a solid name;
2. projects that circle back to each view and tests the straight strokes for
   tangency, deriving the two tangency stations and their common projected
   apex;
3. intersects the elevation projection ray with the base circle's plane
   normal, which fixes the 3D apex;
4. adds the 24-facet cone side and the planar base cap, both sharing the
   analytic circle boundary.

The model reports 25 vertices, 48 edges, 25 faces, one `cone` and one `plane`,
two boundary loops, and one closed shell. The extra section query checks the
analytic cone against the base plane.

```sh
node tools/edc.js tools/scripts/cone-oblique-boundary.edu
node tools/edc.js tools/scripts/cone-oblique-profile.edu
node tools/edc.js tools/scripts/cone-oblique-plan.edu
node tools/edc.js tools/scripts/cone-oblique-edge-on.edu
node tools/edc.js tools/scripts/cone-oblique-conflict.edu
```

`cone-oblique-profile.edu` uses a plan/profile pair with a mirrored frame.
`cone-oblique-plan.edu` supplies the generators in plan.
`cone-oblique-edge-on.edu` sees the base plane edge-on in elevation, so the
plan ellipse and the elevation line run recover the circle before the two
elevation tangents fix the apex. In
`cone-oblique-conflict.edu` the tangent generators meet off the base normal;
the pipeline reports `cone-apex-conflict` and leaves the boundary as a planar
cap rather than inferring an oblique cone.

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
`surfaceShells`, `surfaceOpen`, `surfaceBoundary`, `surfaceModel`,
`surfaceCertificate`, `surfaceCertificateIssues`, and
`surfaceCertificateChecks`. For example:

```text
# expect: 48V 72E 26F curves=2 surfaces=3 surfaceKinds=cylinder,plane surfaceLoops=4 surfaceShells=1 surfaceOpen=0 surfaceBoundary=0 surfaceModel=ok surfaceCertificate=ok surfaceCertificateIssues=none surfaceValidation=ok unresolved=0 status=inferred
```

`surfaceCertificateIssues` is the sorted, comma-separated set of certificate
issue codes (`none` when empty). A trim query result includes its own
`certificate` object, so an open trim can be checked directly:

```text
# surface-query: {"operation":"trim","surface":0,"plane":{"origin":{"x":0,"y":5,"z":0},"normal":{"x":0,"y":1,"z":0}},"expect":{"surface":{"closed":false},"validation":{"status":"partial","openBoundaries":2},"certificate":{"status":"partial","counts":{"surfaces":1,"openBoundaries":2}}}}
```

The mismatch case reports `curve-inclined-arc-unsupported`; the two-cut case
reports `curve-projection-ambiguous` and retains both candidate levels.

## End-to-end case: spherical recess

This is the first curved recess/fillet capability. It is a bounded spherical
recess, not a solid/feature-name reader and not general Boolean geometry.

The drawing supplies:

1. a full circular mouth in one principal view (by default PLAN);
2. a circular-arc silhouette in the other principal view (by default
   ELEVATION), running from one mouth rim through the cap apex to the other rim;
3. optionally, the edge-on mouth stroke covering the mouth diameter.

Let the mouth circle have centre `M`, outward normal `n`, and radius `a`. Lift
the silhouette arc centre into 3D on the mouth axis to get the sphere centre
`O`, and let its radius be `R`. The arc endpoints must be antipodal points of
the mouth circle. The candidate is accepted only when

```text
q = O - M
h = q . n
a^2 + h^2 = R^2
```

and the arc contains the pole direction `-n`, with its interior on the cavity
side `(p - M) . n <= 0`. These conditions are checked analytically from the
drawn primitives, not from display samples. The resulting patch is

```text
{ p : |p - O| = R,  (p - M) . n <= 0 }
```

with cap angle `acos(h/R)` and depth `R - h`. A hemisphere has `h = 0`; a
shallow cap has `h > 0`; a cap deeper than a hemisphere has `h < 0`.

The mouth circle is added as one analytic boundary curve. The sphere patch has
one outer loop referencing that curve. If an edge-on mouth stroke covers the
diameter, a coplanar plane closure shares the same curve, yielding one closed
cavity shell. The closure has no display face: the mouth is an opening, not a
material face. Without the stroke the sphere patch is retained open and
`recess-mouth-unclosed` is reported. A conflicting arc is not consumed; the
mouth circle stays an ordinary boundary and `recess-evidence-conflict` is
reported.

`geometry.recesses` records the analytic result:

```text
{kind:'spherical', center, radius,
 mouth:{center, normal, radius}, depth, capAngle,
 closure:'plane'|'open', sourceIds}
```

The public expectation is `recesses`. The analytic surface is the sphere patch;
the tessellated bowl is display geometry only.

```sh
node tools/edc.js tools/scripts/spherical-recess.edu
node tools/edc.js tools/scripts/spherical-recess-shallow.edu
node tools/edc.js tools/scripts/spherical-recess-elevation-mouth.edu
node tools/edc.js tools/scripts/spherical-recess-open.edu
node tools/edc.js tools/scripts/spherical-recess-conflict.edu
```

Examples:

```text
# expect: 73V 192E 120F recesses=1 surfaces=2 surfaceKinds=plane,sphere surfaceLoops=2 surfaceShells=1 surfaceOpen=0 surfaceBoundary=0 surfaceModel=ok surfaceValidation=ok unresolved=0 status=inferred
# expect: 73V 192E 120F recesses=1 surfaces=1 surfaceKinds=sphere surfaceLoops=1 surfaceShells=0 surfaceOpen=1 surfaceBoundary=1 surfaceModel=partial surfaceValidation=ok unresolved=1 diagnostics=recess-mouth-unclosed status=partial
# expect: recesses=0 surfaces=1 surfaceKinds=plane surfaceLoops=1 surfaceOpen=1 surfaceModel=partial diagnostics=curve-projection-missing,recess-evidence-conflict status=partial
```

## End-to-end case: cylindrical recess

`cylindrical-recess.edu` is the second curved recess capability: a bounded
blind cylindrical hole, not a solid/feature-name reader and not Boolean
geometry. The drawing supplies:

1. a full circular mouth in one principal view (PLAN or ELEVATION);
2. a straight four-sided frame around the mouth in that view, so the mouth is
   an opening in a drawn face rather than a bare circular end;
3. in the paired view, a face edge covering the mouth projection, two edge-on
   depth strokes at the mouth's lateral extremes, and an exact bottom edge
   spanning the mouth diameter.

Let the mouth have centre `M`, radius `a`, and let the paired view put the
bottom edge at signed depth `d`. With mouth-to-bottom unit direction `u` and
bottom centre `B = M + d u`, the inferred patch is

```text
{ p : radial_distance(p, line M + t u) = a,  0 <= (p - M) . u <= d }
```

The two depth strokes must join the mouth and bottom stations at both lateral
extremes; the bottom edge must be exactly the mouth diameter. The bottom loop
is the mouth circle translated by `d`, so it is analytic even when the drawing
only shows it edge-on. A planar bottom cap shares that loop. A single exact
mouth stroke spanning the mouth diameter shares the mouth loop and closes the
cavity; if only a longer face edge covers the mouth (or a face edge is split
around it), the cavity is retained open and `recess-mouth-unclosed` is
reported. The surrounding plate face is not merged or Boolean-subtracted.

`geometry.recesses` gains:

```text
{kind:'cylindrical',
 mouth:{center, normal, radius}, axis, depth,
 bottom:{center, radius}, closure:'plane'|'open',
 bottomClosure:'plane', sourceIds}
```

`mouth.normal` points out of the cavity; `axis` points from the mouth to the
bottom. The public expectation remains `recesses`. The cylinder side is
analytic; its 24-facet side mesh and one bottom-cap face are display geometry
only.

```sh
node tools/edc.js tools/scripts/cylindrical-recess.edu
node tools/edc.js tools/scripts/cylindrical-recess-shallow-open.edu
node tools/edc.js tools/scripts/cylindrical-recess-elevation-mouth.edu
node tools/edc.js tools/scripts/cylindrical-recess-missing-depth.edu
node tools/edc.js tools/scripts/cylindrical-recess-conflict.edu
```

Examples:

```text
# expect: 56V 84E 31F recesses=1 surfaces=9 surfaceKinds=cylinder,plane surfaceLoops=10 surfaceShells=2 surfaceOpen=0 surfaceBoundary=0 surfaceModel=ok surfaceCertificate=ok
# expect: 56V 84E 31F recesses=1 surfaces=8 surfaceKinds=cylinder,plane surfaceLoops=9 surfaceShells=1 surfaceOpen=1 surfaceBoundary=1 surfaceModel=partial surfaceCertificate=partial diagnostics=recess-mouth-unclosed status=partial
# expect: 8V 12E 6F recesses=0 surfaces=6 surfaceKinds=plane surfaceLoops=6 surfaceShells=1 surfaceModel=ok diagnostics=curve-projection-missing,recess-depth-missing status=partial
# expect: 8V 12E 6F recesses=0 surfaces=6 surfaceKinds=plane surfaceLoops=6 surfaceShells=1 surfaceModel=ok diagnostics=curve-projection-missing,point-correspondence-missing,recess-depth-conflict,unresolved-edge status=partial
```

The successful sheet reports `surfaceValidation=issues` because the
surrounding plate's display face still covers the mouth (the cavity is not
subtracted), so the separate triangle certificate sees the expected rim
overlap. The analytic certificate is `ok`: the cavity shell is closed and its
mouth/bottom loops are shared. The open sheet's analytic certificate is
`partial` with `certificate-open-component`.

## Limits

- Principal/oblique circles, inclined full-circle traces, and oblique arcs
  (including arc/line pairs) are lifted. A partial inclined trace of a full
  circular boundary still reports `curve-inclined-arc-unsupported`.
- A bounded cone requires a circular base. Its apex must lie on the base
  circle's plane normal; an oblique cone reports `cone-apex-conflict`, and a
  boundary with no agreeing tangent-pair evidence stays planar. Cones over a
  non-circular 3D ellipse, and frusta between two independently inclined
  boundaries, are not modelled.
- Two curved recesses are implemented: the spherical recess and the
  cylindrical blind recess described above. The spherical recess needs a full
  circular mouth in PLAN or ELEVATION and a rim-to-rim silhouette arc in the
  other of those two views. The cylindrical recess needs a full circular mouth
  in PLAN or ELEVATION, a four-sided straight frame around it in that view,
  two edge-on depth strokes at the mouth diameter, and an exact bottom edge in
  the paired view. Elliptical mouths, partial mouth arcs, partial silhouette
  arcs, full-circle silhouettes (which remain sphere or ambiguity candidates),
  PROFILE mouths, conical drill points, counterbores/stepped holes, torus
  fillets, and cylindrical fillets between planar faces are not inferred.
- The spherical recess is a single cap. It does not subtract material from an
  independently reconstructed surrounding face, and it does not merge the
  mouth circle into an inner loop of a drawn planar face. When no face is
  available the model closes the cavity with a plane closure, or leaves it
  open if no edge-on mouth stroke is drawn.
- The cylindrical recess is one flat-bottomed cylinder. It does not add a
  drill-point cone, a countersink/counterbore, or a mouth/bottom fillet. The
  bottom circle is derived from the mouth circle and the drawn depth; a
  separately drawn coaxial bottom circle is not needed, and a non-circular or
  non-flat bottom is unsupported. The inference does not check that the drawn
  depth fits inside the plate thickness.
- A cylindrical recess is inferred only when the mouth is framed by straight
  geometry in its own view, which reads as an opening in a drawn face. A bare
  cylinder with two circular end faces is left to the existing ruled-surface
  path. The operation does not distinguish a blind hole from a same-diameter
  boss, does not check material side, and does not subtract the cavity from the
  surrounding plate's display faces. That display overlap is why the
  successful plate sheets report `surfaceValidation=issues` while the
  analytic certificate is `ok`.
- The recess display meshes are inward-facing tessellations for viewing the
  cavity. The analytic patches are the sphere cap and the bounded cylinder;
  the meshes are not the source of truth.
- Cone sections are classified but not yet returned as trimmed ellipse/hyperbola
  boundary curves.
- Skew or intersecting-axis cylinder–cylinder intersections and
  cone–cylinder/cone–sphere pairs are not implemented; `intersect` returns
  `null` for them. An offset-axis sphere–cylinder is a quartic curve: clearly
  separate or nested cases return `none`, but when the two surfaces may meet
  the result is `null`. The parallel/coaxial cylinder and axis-through-centre
  sphere/cylinder cases above are exact.
- Intersection results describe the unbounded supporting surfaces. Boundary
  loops are not used to clip a line, circle, or conic to the bounded patches.
- Trimming handles one cutting plane at a time and does not split a loop that
  crosses the plane. `split` performs that two-sided cut for the crossing cases
  described above.
- `split` handles one cutting plane at a time. Planar faces, open line
  sections, tangent points and parabola/hyperbola sections are refused. A
  sphere patch with an existing loop needs recess `cap` metadata; a trimmed
  sphere does not carry enough material-side information to be split again.
  The cone `section` classifier still returns `conic` for every oblique plane,
  so a cone boundary crossed by such a plane is refused before loop splitting.
- A crossing cylinder or cone patch needs a closed loop that the generator-ray
  station test can intersect exactly once. Highly non-star-shaped or
  self-intersecting loops, non-closed loops, and more than two cylinder loops
  return `split-patch-topology-unsupported` or `split-loop-disconnected`
  instead of a possibly unsound split.
- Vertex loops are split at edge/plane intersections, but the intersection
  point must also lie on the analytic surface so it can meet the shared section
  sub-arc. A polygon chord that crosses the plane away from the surface is
  refused with `split-loop-crossing-off-surface`; the operation does not snap
  or project it onto the surface. A loop edge lying in the cutting plane is
  refused with `split-loop-on-plane`.
- A crossing cut's section sub-arcs are classified by a patch-interior test:
  a sphere uses its cap half-space; a cylinder or cone uses the axial stations
  of the same generator on each boundary loop. That test decides the accepted
  band, tip and frustum cases, but it is not a general point-in-patch test for
  an arbitrary curved patch with holes or several nested loops.
- `split` uses the full analytic section of the supporting surface as the
  `section` result, but the piece loops reference only the section sub-arcs
  inside the patch. It does not return the outside-patch section arcs.
- `attachBoundary`/`shareBoundary` only promote an existing boundary object
  into another loop. They do not clip either surface, orient material, merge
  coincident loops or remove an outer loop that the new loop should replace.
- The model is inferred. The analytic certificate checks consistency of the
  stored decimal parameters and sampled boundaries; it does not prove that an
  inferred radius, axis or apex equals the author's intended exact geometry,
  does not check material side or orientation, and does not replace the exact
  declared-triangle certificate in `RECONSTRUCTION_CONTRACT.md`.
- The display triangulation is certified separately as
  `inferred-triangle-v1` (`geometry.surfaceValidation`). Curved surfaces are
  not certified by that mesh certificate, and the analytic certificate never
  uses the mesh as evidence.
- Boundary incidence follows the ordered `loops`. A `surface.boundaryCurves`
  entry that is not part of a loop is advisory patch metadata and is not counted
  as a boundary element.

## Drawing-script surface queries

Drawing scripts can check the public section, trim, split, attachment and
intersection APIs on their reconstructed surfaces, without introducing a
separate test suite:

```text
# surface-query: {"operation":"section","surface":0,"plane":{"origin":{"x":20,"y":0,"z":30},"normal":{"x":0,"y":1,"z":0}},"expect":{"kind":"circle","radius":20}}
# surface-query: {"operation":"intersect","surfaces":[0,1],"expect":{"kind":"circle","relation":"transverse","radius":20}}
# surface-query: {"operation":"split","surface":0,"plane":{"origin":{"x":20,"y":30,"z":30},"normal":{"x":0,"y":1,"z":0}},"expect":{"refused":false,"section":{"kind":"circle","radius":20},"validation":{"closedShells":1}}}
# expect: surfaceChecks=3 surfaceQueries=ok
```

`expect` is a recursive subset of the result with numeric tolerance. An
intersection query names its two operands with `surfaces: [a, b]`, where each
entry is a reconstructed surface index or a saved name. `from` and `with` are
accepted as an alternative pair; `from` also selects the single surface for a
section, trim or split.

Query result shapes:

- **section** returns the analytic section record or `null`.
- **intersect** returns the tagged intersection result or `null`.
- **trim** returns `{surface, validation, certificate}` or `null`.
- **split** returns `{refused:false, section, sectionArcs, sectionArcCount,
  surfaces, positive, negative, validation, certificate}` on success, or
  `{refused:true, diagnostic}` when `Surfaces.split` returns `null`. The
  validation and certificate cover the two-piece model, so a split sphere is
  `ok` with one closed shell, a split cylinder band is `partial` with two open
  end loops and one shared section, and a crossing band reports the number of
  shared section sub-arcs.
- **attach** names one or more surfaces with `surfaces:[...]` (or one with
  `surface`/`from`) and a promoted curve with `curve`. It returns
  `{surfaces, boundary, validation, certificate}`, where `boundary` is the
  incidence record of the attached curve (`useCount`, `surfaceIds`). Attaching
  the same curve to two surfaces reports `useCount:2`.
- **intersectionCurves** promotes a circle/ellipse intersection and returns
  `{curves, count}` or `null`.

`save` stores the result for a later query: a string names one surface (trim,
attach, or the positive split piece), `{positive, negative}` names both split
pieces, and a string on `intersectionCurves` names the first promoted curve.
This allows a later split, attachment or validation to reuse earlier analytic
boundary objects. Queries do not change the reconstructed drawing or its
topology expectations.

New sheets exercise the split and promotion API:

- `surface-split-sphere.edu` splits a complete sphere into two caps sharing one
  equatorial circle, then proves that splitting the cap on its own edge is
  refused (`split-loop-on-plane`).
- `surface-split-cylinder.edu` splits the truncated-cylinder band below its
  inclined end and refuses a later cut outside the remaining band
  (`split-patch-unbounded`).
- `surface-split-crossing.edu` cuts the truncated-cylinder top loop with a
  horizontal plane. The top ellipse and the section are split at the same two
  stations; the positive sliver keeps one top sub-arc and the section arc, and
  the negative band keeps the other top sub-arc, the same section arc, and the
  untouched bottom loop. It also refuses a line section and a planar face.
- `surface-split-band-oblique.edu` cuts the same band obliquely through both
  end loops. Each piece is one loop with one top sub-arc, one bottom sub-arc
  and the same two section sub-arcs (`sectionArcCount:2`,
  `sharedBoundaries:2`).
- `surface-split-recess-cap.edu` cuts a spherical-recess cap through its mouth.
  The mouth circle and the sphere section are split at the same two crossings;
  each open lune shares the one section arc and keeps one mouth sub-arc.
- `surface-split-unsupported.edu` trims a complete sphere (removing its cap
  metadata) and shows that a later crossing cut is refused with
  `split-sphere-cap-unknown`; it also rechecks that the original complete
  sphere still splits.
- `surface-attach-shared.edu` promotes a sphere/plane intersection circle with
  `intersectionCurves`, attaches that exact object to both surfaces, and checks
  `boundary.useCount:2`.
- `cone.edu` also splits a cone between its apex and base, producing a tip patch
  and a frustum band that share the new circle.

The other intersection sheets are `surface-intersect-planes.edu`,
`surface-intersect-spheres.edu`, `surface-intersect-sphere-plane.edu`,
`surface-intersect-cylinders.edu`, and
`surface-intersect-sphere-cylinder.edu`.

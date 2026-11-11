# Expectation: construct a 3D point from matching elevation and plan names

Status: implemented for the live engine and the strict bridge's auto labels.
The edge gate now requires evidence in both plan and elevation.
The strict bridge's compatibility labels also link plan+profile, elevation+profile,
and consistent three-view stations through a declared side frame.
Scope: **Major** (the original interface) only. Major2 is out of scope.

## Core rule

The engine constructs one 3D point from an elevation point and a plan point
when **both** of these are true:

1. Their **base names match**.
2. Their **x coordinates match** within `1e-6 mm`.

Base name means the caption with view suffixes and hidden parentheses removed:

```text
a'   -> a
(a') -> a
a    -> a
a''  -> a       (profile suffix, for reference)
```

Only one point may come from `ELEVATION` and one from `PLAN`. A `BOTH` role is
resolved by its y sign: above XY is elevation, below XY is plan.

If the base name or `x` differs, they are **not** the same 3D point. Do not
average, snap, or guess a pairing.

## Coordinates

When a pair matches:

```text
X      = shared x
height = elevation.y
depth  = -plan.y
```

The reconstructed 3D point is:

```text
conceptual: (X, height, depth)
app tuple:  { x: X, y: height, z: depth }
```

Example: elevation `a' = (0, 40)` and plan `a = (0, -8)` produce the 3D point
`{ x: 0, y: 40, z: 8 }`.

Normally elevation `y >= 0` (above XY) and plan `y <= 0` (below XY). If a point
is on the wrong side, treat it according to its declared role, but surface a
diagnostic rather than silently flipping it.

## Worked example: Profile Square

The 40 mm profile square has:

```text
elevation b',a' at (0, 40)
elevation c',d' at (0, 0)
plan      a,d  at (0, -8)
plan      b,c  at (0, -48)
```

The engine pairs each base independently:

| Base | Elevation | Plan | 3D point |
|---|---|---|---|
| `a` | `a' (0, 40)` | `a (0, -8)` | `{ x: 0, y: 40, z: 8 }` |
| `b` | `b' (0, 40)` | `b (0, -48)` | `{ x: 0, y: 40, z: 48 }` |
| `c` | `c' (0, 0)` | `c (0, -48)` | `{ x: 0, y: 0, z: 48 }` |
| `d` | `d' (0, 0)` | `d (0, -8)` | `{ x: 0, y: 0, z: 8 }` |

That is the 40 × 40 square in the profile plane `x = 0`.

## Multi-caption stations

Split a station caption on commas and pair each base separately.

```text
b',a'  contributes bases b and a
a,d    contributes bases a and d
```

Do not pair `b',a'` with `a,d` as whole stations. Pair `a` with `a` and `b`
with its own plan point.

## Hidden verdicts

Parentheses are visibility verdicts, not identity:

```text
(a') still pairs with a
(a)  still pairs with a'
```

They do not change the 3D point and do not block construction.

## Relationship to the current identity model

The current editor has a stricter member-ID model:

- `point.meta.members[].id` is the editing/reconstruction identity.
- The Project tool and `linkPoints` declare relationships.
- Labels alone do not merge newly created points for editing or claims.
- Demos and legacy imports capture caption correspondences once.

This expectation is specifically about the **engine's 3D construction rule**:
name + x is enough to lift a 3D point. It does not create or change member IDs,
claims, or editing relationships. If explicit member IDs exist, they remain an
editor concern; the 3D lift must not require them.

## Projection lines are not part of this

Projection lines are decoration only. They are not used to construct 3D points,
and their presence or absence must not change the 3D result.

- The earlier idea for auto-showing projection lines in View mode is parked.
- Do not implement or rely on projection lines as part of this rule.
- A projection line may visually connect the same pair, but the engine must
  pair by name + x regardless of whether that line was drawn.

## Verification with EduCAD Script

The verification sheet is `tools/scripts/rule-a.edc`. It draws the four
Profile Square stations and the two edge-on outlines with **no projector
lines**.

```sh
node tools/edc.js --solid tools/scripts/rule-a.edc
```

Expected result:

```text
edc tools/scripts/rule-a.edc: 7 steps, 7 entities — CLEAN
  entities: DATUM_AXIS 1, POINT 4, SEGMENT 2
  solid: ok — 4V 4E 2F
```

The solid dump must contain:

```text
{ x: 0, y: 40, z: 8 }    a' + a
{ x: 0, y: 40, z: 48 }   b' + b
{ x: 0, y: 0,  z: 48 }   c' + c
{ x: 0, y: 0,  z: 8 }    d' + d
```

Change one point's `x` in a copy of the sheet and the pair must not lift.
Adding or removing a Type G projector line must not change the result.

## Implementation notes

- Pairing logic lives in `public/lib/educad-reconstruct.js`: live Pass A
  pairs by base + x; `autoMembersForStrict` prepares table-created auto
  labels for the strict bridge, including plan/profile, elevation/profile,
  and consistent three-view links through the resolved side frame.
- The profile compatibility rule needs `{xRef, s, dRef}`. The strict path
  uses only an explicitly declared frame; it never infers one.
- Base-name parsing is shared with `public/lib/educad-entities.js`
  (`parseMembers`, `memberCaption`).
- The tolerance constant is `1e-6 mm`; the comparison is inclusive.
- The app bridge uses strict reconstruction when explicit member
  declarations exist, and the live builder for command/plain-label sheets.
- Do not wire this into projector rendering or `projectionGuides`.

## Open questions

- Is base-name matching case-sensitive? Current `bases()` is.
- If two points in one view share a base name and `x`, should the engine skip,
  or should an explicit member ID disambiguate?
- If explicit member IDs disagree with name + `x`, which wins? Proposed: member
  ID wins for explicit claims; name + `x` is the fallback/minimal engine rule.
- Profile `a''` now joins the same compatibility rule through the declared side
  frame; it does not bypass explicit member IDs or resolve ambiguous/contradictory
  coordinates.
- Is the `1e-6 mm` bound inclusive? Proposed: yes.

## Edges: evidence and overlap

### Edge identity

An edge has no caption/name. Its identity is its unordered pair of 3D
endpoints:

```text
edge = {P, Q}
```

A drawn line is only a projection of an edge candidate. It does not name the
edge by itself.

### Existence rule

An edge `{P, Q}` is constructed only when both views provide evidence:

1. `P` and `Q` resolve to 3D points (the base-name + `x` rule above).
2. A drawn **plan** segment covers `P.plan → Q.plan`.
3. A drawn **elevation** segment covers `P.elev → Q.elev`.

If either view lacks coverage, no 3D edge is created — even when the edge is
geometrically obvious.

```text
elevation: a' —— b'      drawn
plan:      a  —— b       missing
=> 2 vertices, 0 edges
```

### Overlapping / collapsed projections

Multiple edges can collapse onto the same line in one view. The flat square is
the canonical case:

```text
plan:       a —— b
            |    |
            d —— c

elevation:  a',d' ————— b',c'    one line
```

Plan evidence: `a-b`, `b-c`, `c-d`, `d-a`.

Elevation evidence:
- `a-b` and `c-d` project onto the one elevation line.
- `b-c` and `d-a` are view-perpendicular and project onto the shared end
  stations.

The one elevation line is a **coverage declaration** for the edges whose plan
projections are independently drawn:

```text
elevation line covers {a-b, c-d}
shared end stations cover {b-c, d-a}
```

This is not an edge identity, and it does not merge endpoints. It only allows
one drawn line to stand for several collinear edge projections.

### Faces absorb interior edges

There is **no subsumption cleanup**. Candidate diagonals are allowed to exist
after the two-view evidence gate. They are removed by the face pass instead:

1. A convex planar four-cycle is a face candidate.
2. An edge that is a chord of that four-cycle is a face diagonal, not a solid
   edge. Remove it.
3. A triangle has no diagonal. Its three sides are kept.
4. Closed solids infer their faces from the remaining boundary edges.
5. An open planar plate — one closed degree-2 loop, all vertices coplanar —
   becomes a two-sided face (the loop and its reverse).

So the rule is:

> An edge may lie only on a face boundary or where two faces meet. It must not
> lie strictly inside a face.

This is why the wedge keeps `c-f` and `d-e` (triangle sides) while a rectangle
loses its diagonals.

### Limits

- Coverage requires the drawn segment or a chain of collinear segments to
  fully contain the candidate projection.
- Crossing lines at a point do not cover each other. Only collinear overlap
  counts.
- A view-perpendicular edge may use the shared endpoint station as its point
  projection in that view.
- Hidden lines are still evidence. Visibility style or parentheses change how
  the edge is drawn, not whether it exists.
- Overlap declarations are used only where projections coincide. Otherwise,
  one drawn line is one edge projection.
- The DCEL pass discovers faces from simple planar cycles up to 10 edges.
  Larger faces and plates with holes are a later extension.
- Manifold face selection is exact for up to 16 candidate faces; larger
  candidate sets use greedy overuse removal.

### Verification sheets

These are the only edge checks; no separate test suite is used.

```sh
node tools/edc.js --solid tools/scripts/edge-both-views.edc
node tools/edc.js --solid tools/scripts/edge-missing-plan.edc
node tools/edc.js --solid tools/scripts/flat-square.edc
node tools/edc.js --solid tools/scripts/wedge.edc
```

Expected:

```text
edge-both-views.edc    2V 1E 0F
edge-missing-plan.edc  2V 0E 0F
flat-square.edc        4V 4E 2F
wedge.edc              6V 9E 5F
```

### Implementation notes

- `public/lib/educad-reconstruct.js`: no subsumption pass. The live edge
  builder keeps two-view-covered candidates.
- `extractPlanarFaces`: groups candidates by plane, splits crossing edges
  locally, traces the outer half-edge/DCEL face, and keeps only boundary
  edges.
- `selectManifoldFaces`: chooses a surface where every used edge belongs to
  exactly two faces (closed) or exactly one face (open plate). This removes
  internal diagonal cross-sections.
- `inferClosedFaces` remains only as a fallback when no planar face is
  extracted.
- `tools/edc.js` remains the only runner; no JS test suite is used.

# Engineering Graphics Problem Bank (Topic-wise)

Purpose: test whether a user can draw a **variety of sheets** in the app
without facing problems. Each topic has diverse problem statements with
exact dimensions, so every statement below is directly drawable as one
test sheet / exercise. Every sheet below stays inside what the app
supports: point/segment/circle gestures, first-angle plan + elevation
(+ optional profile side view), and the Class A/B/C/D/E reconstruction
readers. Anything outside that (scales, conics, free curves, sections,
developments, intersections, isometric) is out of scope and has no
entries here.

Conventions used below:

- All dimensions in **mm** unless stated otherwise.
- HP = Horizontal Plane, VP = Vertical Plane, XY = ground line.
- FV = front view / elevation, TV = top view / plan, SV = side view.
- First-angle projection unless stated otherwise.
- `Tests:` = what to check in the app while drawing this sheet.

Sources consulted: GTU / Anna University / VTU / SPPU 1st-year EG question
papers, AMIE projection question bank, standard EG textbooks (ND Bhatt,
K.C. John). Statements below are rewritten as original test problems.

---

## 1. Projection of Points (PT)

- **PT-1 (All quadrants):** A: 20 above HP, 30 in front of VP. B: in HP,
  25 behind VP. C: 30 below HP, 20 behind VP. D: 25 above HP, in VP.
  E: in both HP and VP. Draw FV + TV with projectors. Tests: sign
  convention, labels a/a′, projector alignment x_FV = x_TV.
- **PT-2 (Mixed signs):** P: 35 above HP, 45 behind VP. Q: 40 below HP,
  30 in front of VP. Tests: Q2/Q4 placement, negative heights/depths.

## 2. Projection of Lines (LN) — most error-prone, test all

- **LN-1 (General, Q1):** AB 75 long, 30° to HP, 45° to VP. A is 12 above
  HP, 10 in front of VP. Draw FV, TV. Tests: locus lines, TL rotation
  method, apparent angles.
- **LN-2 (End in VP):** AB 100 long, A is 20 above HP and in VP; 30° to HP,
  45° to VP. Tests: locus from XY, steep line.
- **LN-3 (End in HP):** PQ 80 long, P in HP and 25 in front of VP; 45° HP,
  30° VP. Tests: mirrored construction.
- **LN-4 (Given TV length):** 75-long line, TV measures 60. A is 15 above
  HP, VT is 10 below XY, line 45° to VP. Draw projections; find
  inclination to HP. Tests: reverse construction, VT/HT location.
- **LN-5 (Far end):** PQ 65 long, 45° HP, 30° VP. P is 70 from both planes,
  Q toward VP. Tests: long projectors, locus far from XY.
- **LN-6 (Q2 line):** AB 75 long, 2nd quadrant, A in HP and 20 behind VP,
  25° HP, 45° VP. Tests: both projections above XY, dashed conventions.
- **LN-7 (Cross-quadrant + traces):** A: 30 above HP, 20 in front of VP;
  B: 25 below HP, 35 behind VP; draw FV/TV, mark HT and VT. Tests: line
  crossing XY, trace points on/behind planes.
- **LN-8 (Point-view lines):** Line perpendicular to HP, 40 long,
  20 in front of VP (point-view in TV). Plus: line perpendicular to VP,
  40 long, 25 above HP (point-view in FV). Tests: point projections,
  single-view degeneracy.
- **LN-9 (True length from views):** FV length 65 and TV length 85 given,
  A in HP and 15 in front of VP, FV inclined 60° to XY. Find TL and
  inclinations. Tests: TL triangle, measurement tools.

## 3. Projection of Planes / Laminae (PL)

- **PL-1 (Square, edge in HP):** Square 50 side, one edge in HP and
  perpendicular to VP, surface 45° to HP. Tests: two-stage (TL then tilt),
  edge-view in FV.
- **PL-2 (Hexagon, corner in HP):** Hexagon 30 side, one corner in HP,
  surface 45° to HP, diagonal through that corner 30° to VP. Tests:
  corner-hinge rotation, three-stage change of position.
- **PL-3 (Circle in VP):** Circular lamina dia 60, resting in VP on a rim
  point, surface 45° to VP. Tests: ellipse-as-projection, tangent point.
- **PL-4 (Pentagon, edge in VP):** Pentagon 35 side, one edge in VP, surface
  30° to VP, that edge 45° to HP. Tests: VP-side construction, auxiliary
  tilt.
- **PL-5 (Rectangle, both inclinations):** Rectangle 70×45, corner in HP,
  long edge 30° HP, surface 60° HP with top edge toward VP. Tests: auxiliary
  plane / side-view method.

## 4. Projection of Solids (SO) — upright axes only

- **SO-1 (Hex prism, base on HP):** Base 30 side, axis 70, base on HP, one
  base edge parallel to VP. Tests: hexagon TV + rectangular FV, hidden
  back edges.
- **SO-2 (Cube, face inclined):** Side 50, one edge on HP, face containing
  it 45° to HP. Tests: square degeneracies, hidden bottom edges.
- **SO-3 (Tetrahedron, apex up):** Edge 55, base on HP, one base edge
  perpendicular to VP. Tests: triangular faces, apex centering.
- **SO-4 (Hollow cylinder):** Outer dia 60, inner dia 40, axis 70, axis
  perpendicular to VP, resting on HP. Tests: concentric circles in SV/FV,
  dashed inner lines.

## 5. Orthographic Projections: Pictorial → Orthographic (OR)

> Figures are pictorial blocks; dimensions assumed in mm on the sheet
> image. Draw FV (arrow direction), TV, and LHSV/RHSV as asked.

- **OR-1 (Stepped block):** L-block 100×70×60 with a 50×30×30 step cut out.
  FV + TV + LHSV, all visible edges. Tests: basic 3-view alignment,
  hidden vs visible step edges.
- **OR-2 (Cylindrical part):** Shaft dia 40×100 with collar dia 60×20 and a
  keyway 10 wide. FV + LHSV. Tests: cylinder side view circles, keyway
  hidden lines.
- **OR-3 (Cover plate):** Rectangular flange 100×70×15 with 4 corner holes
  dia 12 on PCD 80×50 and central boss dia 40. FV + TV. Tests: PCD layout,
  repeated circles, pitch dimensioning.
- **OR-4 (Angle block, inclined face):** Block with 45° chamfered top face
  and a V-groove. FV + TV + SV. Tests: inclined-face foreshortening,
  mitre/45° projector between TV and SV.

## 6. Missing Views (MS)

- **MS-1 (Missing TV):** Given FV + LHSV of a stepped + grooved block, draw
  the missing TV. Tests: view-to-view projection, hidden-line inference.
- **MS-2 (Missing SV):** Given FV + TV of an L-block with an inclined face,
  draw the missing SV. Tests: 45° mitre transfer, inclined-face edge.

---

## Suggested minimal test plan (5 sheets)

| # | Pick | Why it stresses the app |
|---|------|--------------------------|
| 1 | LN-1 + LN-7 | locus method, traces, cross-quadrant |
| 2 | PL-2 | three-stage plane rotation |
| 3 | SO-1 | prism solid, hidden edges, 3D reader |
| 4 | OR-1 | 3-view alignment, step edges |
| 5 | MS-1 | view-to-view projection, hidden-line inference |

Stress set (known failure magnets): LN-4, LN-7, PL-2, MS-1.

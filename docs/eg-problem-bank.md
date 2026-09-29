# Engineering Graphics Problem Bank (Topic-wise)

Purpose: test whether a user can draw a **variety of sheets** in the app
without facing problems. Each topic has diverse problem statements with
exact dimensions, so every statement below is directly drawable as one
test sheet / exercise.

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

## 1. Drawing Scales (SC)

- **SC-1 (Plain scale):** Construct a plain scale with RF 1:50 to read up to
  5 m. Show 3.7 m on it. Tests: long divisions, dimension text, zero mark.
- **SC-2 (Diagonal scale, m/dm/cm):** RF 1:40, read up to 6 m in m, dm, cm.
  Show 4.56 m. Tests: diagonal principle, fine subdivisions.
- **SC-3 (Diagonal scale, mm):** RF 3:1, read up to 80 mm in mm and 0.1 mm.
  Show 54.6 mm. Tests: enlargement scale, small least count.
- **SC-4 (Vernier scale):** RF 1:25, read up to 2 m in m, dm, cm. Show
  1.23 m. Tests: vernier offset construction.
- **SC-5 (Isometric scale):** Draw an isometric scale long enough to measure
  up to 100 mm. Show a 52 mm isometric length on it. Tests: 0.8164×
  foreshortening, 15°/45° construction.
- **SC-6 (Comparative):** Plain scales in metres and yards side by side,
  RF 1:100, up to 10 m / 10 yards. Tests: dual units, alignment.

## 2. Conic Sections (CO)

- **CO-1 (Ellipse, arcs method):** Major axis 120, minor axis 80. Draw the
  ellipse; mark foci, directrices. Tests: large smooth curve, foci marking.
- **CO-2 (Ellipse, concentric circles):** Major 100, minor 60. Tests:
  12-division transfer, radial lines.
- **CO-3 (Parabola, rectangle method):** Base 100, axis 70. Tests: grid
  construction, tangent at vertex.
- **CO-4 (Hyperbola, eccentricity):** Transverse axis 60, e = 3/2, focus
  100 from directrix-side origin. Draw one branch + asymptote. Tests:
  long construction lines, asymptote.
- **CO-5 (Conic, general method):** Distance of vertex from focus 25,
  e = 1 (parabola), e = 3/4 (ellipse), e = 5/4 (hyperbola) — one plot each
  on the same sheet. Tests: switching e without redrawing frame.

## 3. Engineering Curves: Cycloids, Involutes, Spirals, Helix (CU)

- **CU-1 (Cycloid):** Rolling circle dia 50, one complete revolution on a
  straight path. Tests: circle division into 12, horizontal pitch = πD.
- **CU-2 (Epi-cycloid):** Rolling circle dia 50, directing circle dia 150,
  outside rolling, one arc. Tests: angle subtended = 360·r/R, radial layout.
- **CU-3 (Hypo-cycloid):** Rolling circle dia 50, directing circle dia 150,
  inside rolling. Tests: same layout, reversed curvature.
- **CU-4 (Trochoids):** Superior trochoid (point outside, radius 30 on a
  dia-50 circle) and inferior trochoid (point inside, radius 15), one
  revolution each. Tests: extended/shortened loops.
- **CU-5 (Involute of circle, full string):** Circle dia 50, string length =
  circumference πD. Tests: 12 tangents of increasing length, cusp at start.
- **CU-6 (Involute, short/long string):** Circle dia 50, string 0.75πD and
  1.25πD (two curves). Tests: partial involute, overlapping tangents.
- **CU-7 (Involute of polygon):** Equilateral triangle side 35; then regular
  hexagon side 20. Tests: straight-edge unwrapping, arc centres at vertices.
- **CU-8 (Archimedean spiral):** Two convolutions, outer minus inner radius
  = 60. Tests: angular + radial division sync, pole handling.
- **CU-9 (Logarithmic spiral):** One convolution, radius doubles every 90°.
  Tests: non-uniform growth, smooth free curve.
- **CU-10 (Cylindrical helix):** Cylinder dia 50, pitch 75, one turn,
  right-handed. Draw FV (sine-like curve) + TV (circle). Tests: phase
  alignment between views, hidden back half dashed.
- **CU-11 (Conical helix):** Cone base dia 60, height 70, pitch 35, two turns.
  Tests: shrinking radius per turn, FV+TV sync.

## 4. Projection of Points (PT)

- **PT-1 (All quadrants):** A: 20 above HP, 30 in front of VP. B: in HP,
  25 behind VP. C: 30 below HP, 20 behind VP. D: 25 above HP, in VP.
  E: in both HP and VP. Draw FV + TV with projectors. Tests: sign
  convention, labels a/a′, projector alignment x_FV = x_TV.
- **PT-2 (Mixed signs):** P: 35 above HP, 45 behind VP. Q: 40 below HP,
  30 in front of VP. Tests: Q2/Q4 placement, negative heights/depths.

## 5. Projection of Lines (LN) — most error-prone, test all

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
- **LN-8 (Profile line):** Line 60 long perpendicular to both HP and VP
  directions is impossible — instead: line perpendicular to HP, 40 long,
  20 in front of VP (point-view in TV). Plus: line perpendicular to VP,
  40 long, 25 above HP (point-view in FV). Tests: point projections,
  single-view degeneracy.
- **LN-9 (True length from views):** FV length 65 and TV length 85 given,
  A in HP and 15 in front of VP, FV inclined 60° to XY. Find TL and
  inclinations. Tests: TL triangle, measurement tools.

## 6. Projection of Planes / Laminae (PL)

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

## 7. Projection of Solids (SO)

- **SO-1 (Hex prism, base on HP):** Base 30 side, axis 70, base on HP, one
  base edge parallel to VP. Tests: hexagon TV + rectangular FV, hidden
  back edges.
- **SO-2 (Pentagonal pyramid, tilted):** Base 30 side, height 60, one base
  edge on HP, axis inclined 45° to HP, axis parallel to VP. Tests:
  apex projection, slant edges crossing.
- **SO-3 (Cone, generator on HP):** Base dia 50, axis 60, one generator on
  HP, axis parallel to VP. Tests: base ellipse in FV, tangent generators.
- **SO-4 (Cylinder, axis both-inclined):** Dia 50, axis 70, axis 45° HP and
  30° VP. Tests: three-stage construction, both base ellipses.
- **SO-5 (Cube, face inclined):** Side 50, one edge on HP, face containing
  it 45° to HP. Tests: square degeneracies, hidden bottom edges.
- **SO-6 (Tetrahedron, apex up):** Edge 55, base on HP, one base edge
  perpendicular to VP. Tests: triangular faces, apex centering.
- **SO-7 (Sphere + prism combo):** Hex prism SO-1 with a sphere dia 40
  centred on its axis, mid-height. Tests: circle in both views, tangency,
  hidden sphere arc.
- **SO-8 (Hollow cylinder):** Outer dia 60, inner dia 40, axis 70, axis
  perpendicular to VP, resting on HP. Tests: concentric circles in SV/FV,
  dashed inner lines, section-ready.

## 8. Sections of Solids (SE)

- **SE-1 (Hex prism, HP section):** SO-1 cut by a plane 45° to HP through
  mid-axis. Draw FV, sectional TV, true shape. Tests: cutting-plane line,
  hatching, true-shape auxiliary view.
- **SE-2 (Cone, parabola section):** Cone dia 50, axis 60, base on HP; plane
  parallel to a generator, 15 from axis at base level. Draw FV with
  section line, sectional TV, true shape (parabola). Tests: hyperbola/
  parabola recognition, curved section boundary.
- **SE-3 (Cylinder, VP section):** Cylinder dia 60, axis 70 (axis parallel
  VP, resting on HP); plane perpendicular to HP, 40° to VP, through a point
  40 from one end. Draw projections + true shape (ellipse). Tests:
  vertical cutting plane, sectional FV.
- **SE-4 (Pyramid, offset section):** Square pyramid base 50, height 65,
  base on HP; plane 30° HP, 20 above base on axis, top removed. Draw
  sectional FV + true shape (trapezoid-ish). Tests: section through slant
  edges, small true shape.
- **SE-5 (Cube, hexagon section):** Cube 50, cut so the true shape is a
  regular hexagon. Draw projections, find plane inclination. Tests: reverse
  problem, six-point section.
- **SE-6 (Composite):** Half-cone (r 30) + half-hex-pyramid (side 30),
  axis 70, sandwiched; plane 45° HP through mid-axis. Draw sectional views
  + true shape. Tests: two-material hatching angles, shared axis.

## 9. Development of Surfaces (DV)

- **DV-1 (Truncated prism):** Lateral development of the retained part of
  SE-1 as a single piece. Tests: stretch-out = perimeter, vertical edges,
  section curve transfer.
- **DV-2 (Truncated cylinder):** Cylinder dia 50, axis 70, cut 45° HP at
  mid-axis; develop retained lateral surface. Tests: stretch-out = πD,
  12-division sine curve.
- **DV-3 (Truncated cone):** Cone dia 60, axis 70, cut by plane 30° HP
  through mid-axis; radial development with section curve. Tests: sector
  angle = 360·r/R, generator transfer.
- **DV-4 (Pyramid + hole):** Square pyramid base 45, height 60, with a
  20×20 square through-hole centred on axis; develop lateral surface
  showing the hole. Tests: hole mapping across faces, hidden hole edges.
- **DV-5 (Transition piece):** Square (50 side) to round (dia 50), height
  60, develop lateral surface by triangulation. Tests: triangulation,
  alternating seam lengths.

## 10. Intersection of Surfaces (IT)

- **IT-1 (Prism–prism):** Vertical square prism 45 side + horizontal square
  prism 45 side, axes intersect at mid-height. Draw intersection curve
  (line of penetration). Tests: edge-to-face piercing points.
- **IT-2 (Cylinder–cylinder):** Vertical cylinder dia 60 + horizontal
  cylinder dia 40, axes intersect. Tests: curved penetration loop, hidden
  half.
- **IT-3 (Cone–cylinder):** Cone dia 70/height 80 on HP + horizontal
  cylinder dia 40 entering centrally. Tests: generator method, multiple
  loops.

## 11. Orthographic Projections: Pictorial → Orthographic (OR)

> Figures are pictorial blocks; dimensions assumed in mm on the sheet
> image. Draw FV (arrow direction), TV, and LHSV/RHSV as asked.

- **OR-1 (Stepped block):** L-block 100×70×60 with a 50×30×30 step cut out.
  FV + TV + LHSV, all visible edges. Tests: basic 3-view alignment,
  hidden vs visible step edges.
- **OR-2 (Block + rib + holes):** Base plate 120×80×20, central rib
  80×15×50, two through-holes dia 20. FV + TV + SV with centre lines.
  Tests: centre-line style, hidden hole arcs, rib in section vs full.
- **OR-3 (Cylindrical part):** Shaft dia 40×100 with collar dia 60×20 and a
  keyway 10 wide. FV + LHSV. Tests: cylinder side view circles, keyway
  hidden lines.
- **OR-4 (Cover plate):** Rectangular flange 100×70×15 with 4 corner holes
  dia 12 on PCD 80×50 and central boss dia 40. FV + TV. Tests: PCD layout,
  repeated circles, pitch dimensioning.
- **OR-5 (Angle block, inclined face):** Block with 45° chamfered top face
  and a V-groove. FV + TV + SV. Tests: inclined-face foreshortening,
  mitre/45° projector between TV and SV.

## 12. Isometric Projections: Orthographic → Isometric (ISO)

- **ISO-1 (Steps):** From OR-1 views, draw isometric projection (isometric
  scale) and isometric drawing (true scale) side by side. Tests: scale
  toggle, overall size difference ≈18%.
- **ISO-2 (Cylinder + holes):** From OR-2/OR-3 views, isometric with
  four-centre ellipse holes on top and side faces. Tests: ellipse orientation
  per face, hidden lower arcs.
- **ISO-3 (Isometric circles):** Cube 50 with an isometric circle (dia 50)
  on all three visible faces. Tests: three ellipse orientations, tangency
  at face mid-edges.
- **ISO-4 (Truncated cone + prism stack):** Hex prism 30 side × 40 + cone
  dia 50 × 60 stacked coaxially; draw combined isometric. Tests: stacked
  axes, base tangency, hidden base arcs.

## 13. Sectional Orthographic & Missing Views (MS)

- **MS-1 (Full section FV):** OR-2 block: sectional FV through the hole
  centres + TV + LHSV. Tests: cutting-plane arrows, hatching (no hatch on
  rib along its length), hidden-line cleanup behind section.
- **MS-2 (Offset section):** OR-4 flange: offset cutting plane through two
  staggered holes; sectional FV. Tests: cranked cutting-plane line, aligned
  section convention.
- **MS-3 (Half section):** Symmetric bearing housing: half-sectional FV
  (left half sectioned, right half outside) + TV. Tests: centre-line
  section boundary, mixed visible/hidden arcs.
- **MS-4 (Missing TV):** Given FV + LHSV of a stepped + grooved block, draw
  the missing TV. Tests: view-to-view projection, hidden-line inference.
- **MS-5 (Missing SV):** Given FV + TV of an L-block with an inclined face,
  draw the missing SV. Tests: 45° mitre transfer, inclined-face edge.

## 14. Dimensioning & Sheet Hygiene (applies to every sheet above)

- Use aligned dimensioning; arrowheads closed and filled; no crossing
  dimension lines; centre lines long-short chain; hidden lines medium
  dashed; cutting-plane line thick with arrows; hatch thin at 45° (adjacent
  parts 45°/135°); first/third-angle symbol on every OR/MS sheet.

---

## Suggested minimal test plan (7 sheets)

| # | Pick | Why it stresses the app |
|---|------|--------------------------|
| 1 | CU-5 or CU-10 | long smooth curves, tangent/hidden handling |
| 2 | LN-1 + LN-7 | locus method, traces, cross-quadrant |
| 3 | PL-2 | three-stage plane rotation |
| 4 | SO-4 | both-plane solid inclination |
| 5 | SE-2 + DV-3 | curved section + radial development |
| 6 | OR-2 | holes, ribs, centre lines, 3-view alignment |
| 7 | MS-1 or ISO-2 | hatching conventions / isometric ellipses |

Stress set (known failure magnets): LN-4, LN-7, SE-5, DV-4, IT-2, MS-2.

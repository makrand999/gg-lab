# EduCAD — Feature Requirements Specification

**Document Version:** 1.0.0  
**Target:** EduCAD (`/root/major/gg-lab`)  
**Status:** Draft / Proposed  
**Author:** MajorBot (EduCAD Project Team)

---

## 1. Overview & Scope

EduCAD is a zero-dependency teaching CAD for first-angle Monge projection (engineering drawing) compliant with BIS SP 46:2003. This document specifies requirements for two user-requested capabilities:
1. **Global Undo/Redo Engine (`Ctrl+Z` / `Ctrl+Y` / `Cmd+Z`)**: Fast, atomic reversal of drafting mistakes and entity plots on the 2D sheet.
2. **3D Viewport Hover Dimensions in View Mode**: Dynamic, non-destructive inspection of reconstructed 3D solid dimensions when hovering over parts of the 3D widget.

Both features must maintain zero runtime dependencies, work across standard desktop browsers, and uphold parity between client-side state and backend verification.

---

## 2. Feature 1: Undo / Redo System (`Ctrl+Z`)

### 2.1 Problem Statement
When students plot geometric entities (points, segments, projectors, tangents, dimension lines) on the 2D Monge drawing sheet, mistakes currently require manual entity selection and deletion. Point deletions can trigger point-cascade deletions across dependent lines and polygons. A reliable, intuitive undo mechanism is critical for classroom drawing workflows.

### 2.2 Functional Requirements
- **FR-1.1 Shortcut Binding:**
  - `Ctrl + Z` (Windows/Linux) and `Meta + Z` / `Cmd + Z` (macOS) triggers **Undo**.
  - `Ctrl + Y` or `Ctrl + Shift + Z` (and macOS `Cmd + Shift + Z`) triggers **Redo**.
  - The key listener must not intercept shortcut events when text input fields (e.g. prompt dialogs, title blocks, question remark fields) have active focus.
- **FR-1.2 Atomic Action History:**
  - Every user action that modifies `CadEntityTable` constitutes an atomic undoable transaction:
    - Entity creation (`create`)
    - Entity deletion (including cascading point deletes)
    - Entity property updates (`patch` / dimension value edit / layer switch)
    - Batch operations (e.g., polygon macro creation, guide grid generation)
- **FR-1.3 State Synchronization:**
  - Executing Undo or Redo must synchronously trigger:
    - Canvas redraw (`EduCADCanvas.render()`)
    - Snapping index refresh (`EduGraphicsSnapping`)
    - 2D⇄3D reconstruction solver update (`EduCADReconstruct.reconstruct()` and `EduCADSolid.mountWidget()`)
    - Selection clearance or restore of the previous active selection
- **FR-1.4 Stack Constraints & Performance:**
  - In-memory command/memento stack with a configurable history depth (default: 50 states).
  - Branching policy: Pushing a new action after an Undo discards the existing Redo forward-stack.
  - Zero memory leaks: State snapshots store lightweight delta records or serializable entity list snapshots without retaining detached DOM nodes.
  - Latency target: `< 16ms` execution time for stack rewind/replay (sub-frame budget).

---

## 3. Feature 2: 3D Object Hover Dimensions in View Mode

### 3.1 Problem Statement
In **View Mode** (e.g., student review, teacher grading, read-only exercise inspection), users inspect the reconstructed 3D solid widget to understand spatial topology. While the 2D sheet carries explicit BIS SP 46 dimension lines, reading corresponding spatial dimensions directly on the 3D solid requires mental cross-referencing. Hovering over the 3D solid should reveal dimensions in situ.

### 3.2 Functional Requirements
- **FR-2.1 View Mode Activation:**
  - Active in read-only / submission view mode (`mirror/student.html`, `mirror/teacher.html`, and `mirror/index.html?mode=view`).
  - Optional toggle to enable in standard interactive drawing mode.
- **FR-2.2 Hover Target Detection (Hit Testing):**
  - Integrate with `EduCADSolid.hitTestFrame()`:
    - **Edge Hover:** When cursor is within `AURA_PX` of an edge stroke, highlight the edge and display its real 3D Euclidean length in millimetres (e.g., `L: 35.0 mm`).
    - **Face Hover:** When cursor hovers inside a planar face, highlight the face boundary and show face dimensions (e.g., `35.0 × 70.0 mm` or `Area: 2450 mm²`).
    - **Solid / Bounding Box Hover:** When hovering general solid vertices/body, show overall bounding extents (`W: 35 mm × D: 35 mm × H: 70 mm`).
- **FR-2.3 HUD / Dimension Pill Rendering:**
  - Dimensions rendered either as:
    - Floating HUD badge/pill attached to the cursor or projected midpoint of the hovered edge.
    - Overlay dimension callout line aligned with the 3D perspective/isometric axes.
  - Numeric formatting: Millimetre precision formatted per engineering drawing convention (`NN.N mm`, trailing zero suppressed if whole).
- **FR-2.4 Performance & Redraw Constraints:**
  - Calculation must evaluate on projected 2D screen coordinates from cached 3D vertex buffers; no unneeded 3D re-solver passes on pointer move.
  - Clear highlight immediately on pointer leave (`pointerout` / `pointerleave`).
  - High-DPI canvas aware (scaled by `devicePixelRatio`).

---

## 4. Architectural Integration & Modules Affected

| Component | Files | Change Scope |
|---|---|---|
| **Undo/Redo Engine** | `mirror/files/www.geogebra.org/educad-entities.js` | Add `HistoryStack` / transaction manager to `CadEntityTable` (`record()`, `undo()`, `redo()`). |
| **Keyboard Dispatch** | `mirror/files/www.geogebra.org/educad-canvas.js`<br>`mirror/files/www.geogebra.org/educad-boot.js` | Capture `Ctrl+Z` / `Ctrl+Y` keydown handlers, guard focus, call entity table undo/redo. |
| **3D Edge Hit Testing** | `mirror/files/www.geogebra.org/educad-solid.js` | Enhance `hitTestFrame()` to return closest edge index and 3D endpoints. |
| **3D Dimension Overlay** | `mirror/files/www.geogebra.org/educad-solid.js` | Draw HUD badge or projected dimension leader on hover during View mode. |
| **Documentation** | `docs/MANUAL.md`<br>`mirror/manual.html` | Document `Ctrl+Z` shortcut and 3D hover dimension inspection. |
| **Test Verification** | `tools/test-phase31-undo.js`<br>`tools/test-phase32-solid-hover-dim.js` | Automated Node.js and Obscura headless browser tests. |

---

## 5. Non-Functional Requirements & Project Constraints

1. **Zero External Dependencies:** No npm libraries, no UI widget frameworks. Pure ES5 vanilla JavaScript for `mirror/files/**`.
2. **Deterministic & Reversible:** Consecutive undoing of N operations followed by N redos must restore the exact entity state and IDs.
3. **Monge & BIS SP 46 Parity:** Dimension representations adhere to Indian Standard BIS SP 46 engineering drawing standards.
4. **Test Suite Coverage:** All additions must pass the existing 880 baseline test suite (`npm test`) without regressions.

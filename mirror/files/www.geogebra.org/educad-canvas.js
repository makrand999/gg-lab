(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADCanvas = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // Dual-layer Canvas2D: Layer1 static + Layer2 dynamic. Zero deps.
  // World mm only inside entities/solvers; screen px ephemeral render only.
  var LAYER_STATIC = 'layer1';
  var LAYER_DYNAMIC = 'layer2';
  var SHOW_GRID_DEFAULT = false;
  var ENTITY_SUPPRESS_PX = 14;
  var ZOOM_STEP = 1.25;
  var SCALE_MIN = 0.05;
  var SCALE_MAX = 50;
  var DEFAULT_SCALE = 2.0;
  var BUTTON_IDS = ['zoom-in', 'zoom-out', 'zoom-home'];
  // Spec 1.1 + 4.4: the ONLY empty-canvas menu. Exactly two options:
  // 'Plain (No Mesh)' (default, checked when !showGrid) and 'Box Mesh'
  // (checked when showGrid).
  var MENU_OPTIONS = [
    { id: 'plain', label: 'Plain (No Mesh)' },
    { id: 'mesh', label: 'Box Mesh' }
  ];
  var CURSORS = {
    idle: 'default',
    panReady: 'grab',
    panning: 'grabbing',
    hoverEntity: 'pointer',
    draw: 'crosshair'
  };

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function clampScale(s) {
    assertFinite(s);
    if (s < SCALE_MIN) return SCALE_MIN;
    if (s > SCALE_MAX) return SCALE_MAX;
    return s;
  }

  // HiDPI: integer backing store from CSS px size and devicePixelRatio.
  function computeHiDPISize(cssW, cssH, dpr) {
    assertFinite(cssW, cssH, dpr);
    var w = Math.round(cssW);
    var h = Math.round(cssH);
    if (w < 1) w = 1;
    if (h < 1) h = 1;
    var ratio = dpr >= 1 ? dpr : 1;
    return { canvasW: Math.round(w * ratio), canvasH: Math.round(h * ratio), scale: ratio };
  }

  // 2-option menu shows on empty right-click only: suppress when an
  // entity is within 14px (hitDistPx < 14). null/undefined = empty.
  function shouldShowContextMenu(hitDistPx) {
    if (hitDistPx === null || hitDistPx === undefined) return true;
    assertFinite(hitDistPx);
    return hitDistPx >= ENTITY_SUPPRESS_PX;
  }

  // Clamp menu rect inside container; integer px.
  function clampMenuPosition(mx, my, menuW, menuH, containerW, containerH) {
    assertFinite(mx, my, menuW, menuH, containerW, containerH);
    var x = Math.round(mx);
    var y = Math.round(my);
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    var maxX = Math.round(containerW - menuW);
    var maxY = Math.round(containerH - menuH);
    if (maxX < 0) maxX = 0;
    if (maxY < 0) maxY = 0;
    if (x > maxX) x = maxX;
    if (y > maxY) y = maxY;
    return { x: x, y: y };
  }

  // Dismiss menu on pointerdown, Escape, or zoom; nothing else.
  function shouldDismissMenu(trigger) {
    var t = trigger;
    if (trigger !== null && typeof trigger === 'object' && trigger.type !== undefined) {
      t = trigger.type;
      if (t === 'keydown' && trigger.key !== undefined) t = trigger.key;
    }
    return t === 'pointerdown' || t === 'Escape' || t === 'zoom';
  }

  // Cursor cues per interaction state.
  function cursorForState(state) {
    if (state === 'panning') return CURSORS.panning;
    if (state === 'pan-ready') return CURSORS.panReady;
    if (state === 'hover-entity') return CURSORS.hoverEntity;
    if (state === 'draw') return CURSORS.draw;
    return CURSORS.idle;
  }

  function createCanvasState(opts) {
    opts = opts || {};
    var w = opts.w === undefined ? 800 : Math.max(1, Math.round(opts.w));
    var h = opts.h === undefined ? 600 : Math.max(1, Math.round(opts.h));
    return {
      showGrid: SHOW_GRID_DEFAULT,
      layers: [LAYER_STATIC, LAYER_DYNAMIC],
      view: {
        s: DEFAULT_SCALE,
        tx: (opts.tx === undefined) ? w / 2 : opts.tx,
        ty: (opts.ty === undefined) ? h / 2 : opts.ty,
        w: w, h: h
      },
      menu: { visible: false, x: 0, y: 0 }
    };
  }

  // Cursor-anchored zoom on a view {s,tx,ty,w,h} with y-flip model.
  function zoomViewAt(view, cursorPx, factor) {
    assertFinite(view.s, view.tx, view.ty, cursorPx.x, cursorPx.y, factor);
    if (factor <= 0) throw new Error('zoom factor must be > 0');
    var s0 = clampScale(view.s);
    var ns = clampScale(s0 * factor);
    var wx = (cursorPx.x - view.tx) / s0;
    var wy = (view.ty - cursorPx.y) / s0;
    return {
      s: ns, tx: cursorPx.x - wx * ns, ty: cursorPx.y + wy * ns,
      w: view.w, h: view.h
    };
  }

  function homeView(w, h) {
    assertFinite(w, h);
    var iw = Math.max(1, Math.round(w));
    var ih = Math.max(1, Math.round(h));
    return { s: DEFAULT_SCALE, tx: iw / 2, ty: ih / 2, w: iw, h: ih };
  }

  // Plus/minus/home buttons. centerPx anchors zoom buttons.
  function buttonAction(view, buttonId, centerPx) {
    assertFinite(view.s, view.tx, view.ty, view.w, view.h);
    var c = centerPx || { x: view.w / 2, y: view.h / 2 };
    if (buttonId === 'zoom-in') return zoomViewAt(view, c, ZOOM_STEP);
    if (buttonId === 'zoom-out') return zoomViewAt(view, c, 1 / ZOOM_STEP);
    if (buttonId === 'zoom-home') return homeView(view.w, view.h);
    throw new Error('unknown button: ' + String(buttonId));
  }

  // Right-click handler: show clamped 2-option menu only on empty space.
  function onEmptyRightClick(state, x, y, hitDistPx, container, menuSize) {
    assertFinite(x, y);
    var c = container || { w: state.view.w, h: state.view.h };
    var m = menuSize || { w: 160, h: 64 };
    if (!shouldShowContextMenu(hitDistPx)) {
      return { visible: false, x: 0, y: 0 };
    }
    var p = clampMenuPosition(x, y, m.w, m.h, c.w, c.h);
    return { visible: true, x: p.x, y: p.y };
  }

  // Label typography defaults (shared with the label layout module).
  var LABEL_FONT = 'italic 13px "Cambria", "Times New Roman", serif';
  var LABEL_HALO_WIDTH_PX = 3.5;
  var LABEL_HALO_STYLE = 'rgba(248, 250, 252, 0.95)';
  var LABEL_FILL_STYLE = '#0f172a';
  var LABEL_LEADER_WIDTH_PX = 1;
  var LABEL_LEADER_STYLE = '#475569';

  // Tier 3 knockout: halo stroke masks strokes behind the glyphs, then
  // crisp foreground text. No-op (false) without a 2d context.
  function drawKnockoutLabel(ctx, text, x, y, o) {
    if (!ctx || typeof ctx.fillText !== 'function') return false;
    o = o || {};
    var font = (o.font === undefined || o.font === null) ? LABEL_FONT : o.font;
    var haloW = (o.haloWidthPx === undefined || o.haloWidthPx === null) ?
      LABEL_HALO_WIDTH_PX : o.haloWidthPx;
    var halo = (o.haloStyle === undefined || o.haloStyle === null) ?
      LABEL_HALO_STYLE : o.haloStyle;
    var fill = (o.fillStyle === undefined || o.fillStyle === null) ?
      LABEL_FILL_STYLE : o.fillStyle;
    assertFinite(x, y, haloW);
    ctx.save();
    ctx.font = font;
    if (typeof ctx.strokeText === 'function' && haloW > 0) {
      ctx.lineWidth = haloW;
      ctx.strokeStyle = halo;
      ctx.lineJoin = 'round';
      ctx.strokeText(String(text), x, y);
    }
    ctx.fillStyle = fill;
    ctx.fillText(String(text), x, y);
    ctx.restore();
    return true;
  }

  // Tier 4 leader: thin BIS Type B line from the vertex to the parked
  // label, with a small dot at the vertex end.
  function drawLabelLeader(ctx, x1, y1, x2, y2, o) {
    if (!ctx || typeof ctx.beginPath !== 'function') return false;
    o = o || {};
    var w = (o.widthPx === undefined || o.widthPx === null) ?
      LABEL_LEADER_WIDTH_PX : o.widthPx;
    var color = (o.color === undefined || o.color === null) ?
      LABEL_LEADER_STYLE : o.color;
    var dotR = (o.dotRpx === undefined || o.dotRpx === null) ? 2 : o.dotRpx;
    assertFinite(x1, y1, x2, y2, w, dotR);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = w;
    if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    if (typeof ctx.arc === 'function' && dotR > 0) {
      ctx.beginPath();
      ctx.arc(x1, y1, dotR, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
    return true;
  }

  // Draw one label placement (leader first, then knockout text). The
  // leader endpoints are converted from mm via forward(view, ...).
  function drawLabelPlacement(ctx, view, placement, o) {
    if (!ctx || typeof ctx.fillText !== 'function') return false;
    if (!placement || typeof placement !== 'object') return false;
    o = o || {};
    if (placement.leader) {
      var L = placement.leader;
      var p1 = { x: L.x1Mm * view.s + view.tx, y: view.ty - L.y1Mm * view.s };
      var p2 = { x: L.x2Mm * view.s + view.tx, y: view.ty - L.y2Mm * view.s };
      drawLabelLeader(ctx, p1.x, p1.y, p2.x, p2.y, o.leader);
    }
    return drawKnockoutLabel(ctx, placement.text, placement.xPx, placement.yPx, o.label);
  }

  // In-canvas point selection + on-site rename. Table-agnostic state
  // machine: the page owns commits (Enter), cancels (Escape/empty click)
  // only touch this state, so the table is never dirtied by previews.
  var SELECT_TOL_PX = 14;
  var SELECT_RING_R_PX = 7;
  var SELECT_RING_WIDTH_PX = 2;
  var SELECT_RING_STYLE = '#f59e0b';
  var CARET_BLINK_MS = 500;
  var AXIS_TOL_PX = 14;
  var LINE_TOOL_PHASES = ['idle', 'anchored', 'menu', 'animating'];
  var LINE_BIS_CODES = ['A', 'B', 'E', 'G', 'K'];
  var LINE_STROKE_MS = 300;

  function createSelectionState() {
    return { selectedId: null, editing: null };
  }

  function isEditing(sel) {
    return !!(sel && sel.editing);
  }

  // Nearest visible POINT within tolPx of the cursor (px). First wins ties.
  function hitTestPoint(entities, cursorPx, view, tolPx) {
    assertFinite(cursorPx.x, cursorPx.y, view.s, view.tx, view.ty);
    if (!Array.isArray(entities)) throw new Error('entities must be an array');
    var tol = (tolPx === undefined || tolPx === null) ? SELECT_TOL_PX : tolPx;
    assertFinite(tol);
    var best = null;
    var bestD2 = tol * tol;
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e || e.type !== 'POINT' || e.visible === false) continue;
      assertFinite(e.x, e.y);
      var px = e.x * view.s + view.tx;
      var py = view.ty - e.y * view.s;
      var dx = px - cursorPx.x, dy = py - cursorPx.y;
      var d2 = dx * dx + dy * dy;
      if (d2 <= tol * tol && (best === null || d2 < bestD2)) {
        best = e.id;
        bestD2 = d2;
      }
    }
    return best;
  }

  function selectPoint(sel, id) {
    sel.selectedId = id;
    return sel;
  }

  function beginEdit(sel, id, currentName) {
    sel.selectedId = id;
    sel.editing = { id: id, original: String(currentName), buffer: String(currentName) };
    return sel;
  }

  // Discard the buffer; the table was never touched, so the original name
  // is preserved by construction. Keeps the selection.
  function cancelEdit(sel) {
    if (sel) sel.editing = null;
    return sel;
  }

  function deselect(sel) {
    if (sel) { sel.selectedId = null; sel.editing = null; }
    return sel;
  }

  // Pure key router. Returns 'commit' | 'cancel' | 'input' | 'noop' and
  // mutates only the buffer. The caller applies commit/cancel to the table.
  function handleRenameKey(sel, key) {
    if (!sel || !sel.editing) return 'noop';
    if (key === 'Enter') return 'commit';
    if (key === 'Escape') return 'cancel';
    if (!isRenameInputKey(key)) return 'noop';
    if (key === 'Backspace') {
      sel.editing.buffer = sel.editing.buffer.slice(0, -1);
    } else {
      sel.editing.buffer += key;
    }
    return 'input';
  }

  // Exit edit mode. Returns {id, name} to write, {id, delete: true} when
  // the buffer was emptied (blank + Enter removes the point), or null
  // when unchanged. Trims accidental padding before comparing.
  function commitRename(sel) {
    if (!sel || !sel.editing) return null;
    var ed = sel.editing;
    sel.editing = null;
    var name = ed.buffer.trim();
    if (name === '') return { id: ed.id, delete: true };
    if (name === ed.original) return null;
    return { id: ed.id, name: name };
  }

  // Next unused point letter: a..z, then a1..z1, a2.. Scans live POINT
  // captions, so deleted letters are re-used automatically. Terminates:
  // candidates are infinite, entities finite.
  function nextPointName(entities) {
    if (!Array.isArray(entities)) throw new Error('entities must be an array');
    var used = {};
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (e && e.type === 'POINT' && typeof e.caption === 'string' && e.caption !== '') {
        used[e.caption] = true;
      }
    }
    for (var n = 0; ; n++) {
      var suffix = (n === 0) ? '' : String(n);
      for (var l = 0; l < 26; l++) {
        var cand = String.fromCharCode(97 + l) + suffix;
        if (!used[cand]) return cand;
      }
    }
  }

  // Blinking caret phase: on for 500 ms, off for 500 ms.
  function caretOn(nowMs) {
    assertFinite(nowMs);
    return Math.floor(nowMs / CARET_BLINK_MS) % 2 === 0;
  }

  // True for keys that feed the rename buffer (printables + Backspace).
  // Enter/Escape/modifier words route elsewhere and must not start edits.
  function isRenameInputKey(key) {
    if (key === 'Backspace') return true;
    return typeof key === 'string' && key.length === 1 && key >= ' ';
  }

  // Axis-locked placement against a reference point (world mm). Near the
  // horizontal axis (|dy| <= tol) locks y to y_ref with a dX readout; near
  // the vertical axis locks x to x_ref with a dY readout; near both takes
  // the closer axis; far from both places freely with no readout.
  // Returns {lock: 'x'|'y'|null, xMm, yMm, readout: string|null}.
  function axisLockState(cursorPx, view, refMm, tolPx) {
    assertFinite(cursorPx.x, cursorPx.y, view.s, view.tx, view.ty,
      refMm.x, refMm.y);
    var tol = (tolPx === undefined || tolPx === null) ? AXIS_TOL_PX : tolPx;
    assertFinite(tol);
    var wx = (cursorPx.x - view.tx) / view.s;
    var wy = (view.ty - cursorPx.y) / view.s;
    var refPxX = refMm.x * view.s + view.tx;
    var refPxY = view.ty - refMm.y * view.s;
    var dxPx = Math.abs(cursorPx.x - refPxX);
    var dyPx = Math.abs(cursorPx.y - refPxY);
    var xNear = dxPx <= tol;
    var yNear = dyPx <= tol;
    var lock = null;
    if (xNear && yNear) lock = (dxPx <= dyPx) ? 'x' : 'y';
    else if (xNear) lock = 'x';
    else if (yNear) lock = 'y';
    if (lock === 'x') {
      return { lock: 'x', xMm: refMm.x, yMm: wy,
        readout: 'ΔY: ' + Math.abs(wy - refMm.y).toFixed(2) + ' mm' };
    }
    if (lock === 'y') {
      return { lock: 'y', xMm: wx, yMm: refMm.y,
        readout: 'ΔX: ' + Math.abs(wx - refMm.x).toFixed(2) + ' mm' };
    }
    return { lock: null, xMm: wx, yMm: wy, readout: null };
  }

  // Amber selection halo (snap ring owns cyan). No-op without a 2d context.
  function drawSelectionRing(ctx, x, y, o) {
    if (!ctx || typeof ctx.beginPath !== 'function') return false;
    o = o || {};
    var r = (o.radiusPx === undefined || o.radiusPx === null) ? SELECT_RING_R_PX : o.radiusPx;
    var w = (o.widthPx === undefined || o.widthPx === null) ? SELECT_RING_WIDTH_PX : o.widthPx;
    var color = (o.color === undefined || o.color === null) ? SELECT_RING_STYLE : o.color;
    assertFinite(x, y, r, w);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
    return true;
  }

  // Line construction task: idle -> anchored (Ctrl+click P1) -> menu
  // (click P2, pick BIS type) -> animating (300 ms stroke) -> commit.
  // Any empty click or Escape aborts back to idle with no creation.
  function createLineToolState() {
    return { phase: 'idle', p1Id: null, p1Mm: null,
      p2Id: null, p2Mm: null, bisCode: null };
  }

  function isLineToolActive(ls) {
    return !!ls && ls.phase !== 'idle';
  }

  function anchorLineTool(ls, id, xMm, yMm) {
    assertFinite(xMm, yMm);
    ls.phase = 'anchored';
    ls.p1Id = id;
    ls.p1Mm = { x: xMm, y: yMm };
    ls.p2Id = null;
    ls.p2Mm = null;
    ls.bisCode = null;
    return ls;
  }

  // Lock P2 (must differ from P1). False when not anchorable/selectable.
  function lockLineTarget(ls, id, xMm, yMm) {
    if (!ls || ls.phase !== 'anchored') return false;
    if (id === ls.p1Id) return false;
    assertFinite(xMm, yMm);
    ls.phase = 'menu';
    ls.p2Id = id;
    ls.p2Mm = { x: xMm, y: yMm };
    return true;
  }

  // Re-point P2 while the type menu is open. False unless in menu phase.
  function retargetLineTool(ls, id, xMm, yMm) {
    if (!ls || ls.phase !== 'menu') return false;
    if (id === ls.p1Id) return false;
    assertFinite(xMm, yMm);
    ls.p2Id = id;
    ls.p2Mm = { x: xMm, y: yMm };
    return true;
  }

  // Pick the BIS type; starts the stroke animation on true.
  function beginLineStroke(ls, bisCode) {
    if (!ls || ls.phase !== 'menu') return false;
    if (LINE_BIS_CODES.indexOf(bisCode) === -1) return false;
    ls.phase = 'animating';
    ls.bisCode = bisCode;
    return true;
  }

  // Animation progress t in [0,1] for p(t) = P1 + t*(P2-P1).
  function lineToolProgress(t0Ms, nowMs, durMs) {
    assertFinite(t0Ms, nowMs);
    var d = (durMs === undefined || durMs === null) ? LINE_STROKE_MS : durMs;
    assertFinite(d);
    if (!(d > 0)) return 1;
    var t = (nowMs - t0Ms) / d;
    if (t < 0) return 0;
    if (t > 1) return 1;
    return t;
  }

  function lerpPointMm(p1Mm, p2Mm, t) {
    assertFinite(p1Mm.x, p1Mm.y, p2Mm.x, p2Mm.y, t);
    return { x: p1Mm.x + (p2Mm.x - p1Mm.x) * t,
      y: p1Mm.y + (p2Mm.y - p1Mm.y) * t };
  }

  // Take the commit spec and reset to idle. Null unless animating.
  function finishLineStroke(ls) {
    if (!ls || ls.phase !== 'animating') return null;
    var spec = { x1: ls.p1Mm.x, y1: ls.p1Mm.y,
      x2: ls.p2Mm.x, y2: ls.p2Mm.y, bisCode: ls.bisCode };
    abortLineTool(ls);
    return spec;
  }

  function abortLineTool(ls) {
    if (ls) {
      ls.phase = 'idle';
      ls.p1Id = null;
      ls.p1Mm = null;
      ls.p2Id = null;
      ls.p2Mm = null;
      ls.bisCode = null;
    }
    return ls;
  }

  // Checked state of the 2-option menu for a given showGrid flag:
  // Plain is checked by default (no mesh), Box Mesh is checked when set.
  function menuCheckedState(showGrid) {
    return { plain: !showGrid, mesh: !!showGrid };
  }

  // Apply one of the 2 menu options. 'plain' selects Plain (No Mesh),
  // 'mesh' selects Box Mesh; anything else throws.
  function applyMenuAction(state, optionId) {
    if (optionId === 'plain') {
      state.showGrid = false;
      state.menu.visible = false;
      return state;
    }
    if (optionId === 'mesh') {
      state.showGrid = true;
      state.menu.visible = false;
      return state;
    }
    throw new Error('unknown menu option: ' + String(optionId));
  }

  return {
    LAYER_STATIC: LAYER_STATIC, LAYER_DYNAMIC: LAYER_DYNAMIC,
    SHOW_GRID_DEFAULT: SHOW_GRID_DEFAULT,
    ENTITY_SUPPRESS_PX: ENTITY_SUPPRESS_PX,
    ZOOM_STEP: ZOOM_STEP,
    SCALE_MIN: SCALE_MIN, SCALE_MAX: SCALE_MAX,
    DEFAULT_SCALE: DEFAULT_SCALE,
    BUTTON_IDS: BUTTON_IDS, MENU_OPTIONS: MENU_OPTIONS,
    CURSORS: CURSORS,
    assertFinite: assertFinite, clampScale: clampScale,
    computeHiDPISize: computeHiDPISize,
    shouldShowContextMenu: shouldShowContextMenu,
    clampMenuPosition: clampMenuPosition,
    shouldDismissMenu: shouldDismissMenu,
    cursorForState: cursorForState,
    createCanvasState: createCanvasState,
    zoomViewAt: zoomViewAt, homeView: homeView,
    buttonAction: buttonAction,
    onEmptyRightClick: onEmptyRightClick,
    menuCheckedState: menuCheckedState,
    LABEL_FONT: LABEL_FONT,
    LABEL_HALO_WIDTH_PX: LABEL_HALO_WIDTH_PX,
    LABEL_HALO_STYLE: LABEL_HALO_STYLE,
    LABEL_FILL_STYLE: LABEL_FILL_STYLE,
    LABEL_LEADER_WIDTH_PX: LABEL_LEADER_WIDTH_PX,
    LABEL_LEADER_STYLE: LABEL_LEADER_STYLE,
    drawKnockoutLabel: drawKnockoutLabel,
    drawLabelLeader: drawLabelLeader,
    drawLabelPlacement: drawLabelPlacement,
    SELECT_TOL_PX: SELECT_TOL_PX,
    SELECT_RING_R_PX: SELECT_RING_R_PX,
    SELECT_RING_WIDTH_PX: SELECT_RING_WIDTH_PX,
    SELECT_RING_STYLE: SELECT_RING_STYLE,
    CARET_BLINK_MS: CARET_BLINK_MS,
    createSelectionState: createSelectionState,
    isEditing: isEditing,
    hitTestPoint: hitTestPoint,
    selectPoint: selectPoint,
    beginEdit: beginEdit,
    cancelEdit: cancelEdit,
    deselect: deselect,
    handleRenameKey: handleRenameKey,
    commitRename: commitRename,
    caretOn: caretOn,
    isRenameInputKey: isRenameInputKey,
    nextPointName: nextPointName,
    axisLockState: axisLockState,
    AXIS_TOL_PX: AXIS_TOL_PX,
    LINE_TOOL_PHASES: LINE_TOOL_PHASES,
    LINE_BIS_CODES: LINE_BIS_CODES,
    LINE_STROKE_MS: LINE_STROKE_MS,
    createLineToolState: createLineToolState,
    isLineToolActive: isLineToolActive,
    anchorLineTool: anchorLineTool,
    lockLineTarget: lockLineTarget,
    retargetLineTool: retargetLineTool,
    beginLineStroke: beginLineStroke,
    lineToolProgress: lineToolProgress,
    lerpPointMm: lerpPointMm,
    finishLineStroke: finishLineStroke,
    abortLineTool: abortLineTool,
    drawSelectionRing: drawSelectionRing,
    applyMenuAction: applyMenuAction
  };
});

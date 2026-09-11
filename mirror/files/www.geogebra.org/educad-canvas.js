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
    applyMenuAction: applyMenuAction
  };
});

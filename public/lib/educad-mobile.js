(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADMobile = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD mobile inspection: View + Pose on touch-only devices and in
  // narrow windows. Phones and small tablets get a usable inspection
  // experience instead of the old "Desktop required" overlay: split
  // 2D/3D panes, pane-owned touch gestures, a compact header, a
  // collapsible bottom sheet, and touchscreen Pose controls. Edit and
  // all authoring stay centrally forbidden on inspection-only devices
  // (the page enforces it; this module only reports the verdict).
  //
  // Layout is responsive by SPACE (narrow windows split even with a
  // mouse); inspection-only is a verdict about INPUT (coarse pointer
  // with no fine pointer). Touch-only devices always split, so tablet
  // users inspect too; narrow desktop windows split but keep Edit.
  //
  // Zero deps. Dual-env: browser via window.EduCADMobile, plain Node
  // via module.exports. Node-safe: DOM is touched only inside mount()
  // when a document is present; every pure helper below runs headless.
  var VERSION = '1.0.0-educad';
  var WORLD_UNITS = 'mm';

  // Touch gesture tuning.
  var TAP_SLOP_PX = 10;
  var TAP_MAX_MS = 500;
  var TOUCH_TOL_PX = 24;
  var PINCH_MIN_DIST_PX = 8;
  var CLICK_SUPPRESS_MS = 800;

  // Split layout tuning.
  var SPLIT_NARROW_W = 920;
  var SPLIT_MIN_DIM = 640;
  var MIN_PANE_PX = 120;
  var DIVIDE_MIN = 0.2;
  var DIVIDE_MAX = 0.8;
  var FIT_PAD_PX = 48;
  var FIT_MIN_SPAN_MM = 40;
  var SCALE_MIN = 0.05;
  var SCALE_MAX = 50;

  function hasDOM() {
    return (typeof document !== 'undefined') && !!document &&
      (typeof document.createElement === 'function');
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function finite(n, fallback) {
    return (typeof n === 'number' && isFinite(n)) ? n : fallback;
  }

  // Inspection verdict, mirroring the retired blocker: coarse with no
  // fine pointer means touch-only (phones, tablets). With no pointer
  // information at all, fall back to touch + small screen. Touchscreen
  // laptops (fine pointer present) are never inspection-only.
  // info: {coarse, fine, touch, minDim}. Pure.
  function detectTouchOnly(info) {
    info = info || {};
    if (info.fine === true) return false;
    if (info.coarse === true) return true;
    var touch = info.touch === true;
    var dim = finite(info.minDim, Infinity);
    return touch && dim < 720;
  }

  // Read the verdict inputs from a window-like object. Pure w.r.t. the
  // passed object; defaults to the global window when present.
  function detectFromWindow(w) {
    var win = w || ((typeof window !== 'undefined') ? window : null);
    var coarse = false, fine = false, touch = false, minDim = Infinity;
    if (win) {
      try {
        if (win.matchMedia) {
          coarse = !!win.matchMedia('(pointer: coarse)').matches;
          fine = !!win.matchMedia('(pointer: fine)').matches ||
            !!win.matchMedia('(any-pointer: fine)').matches;
        }
      } catch (err) { /* media queries unavailable */ }
      try {
        touch = ('ontouchstart' in win) ||
          (win.navigator && win.navigator.maxTouchPoints > 0);
      } catch (err2) { /* navigator unavailable */ }
      var iw = Number(win.innerWidth), ih = Number(win.innerHeight);
      if (isFinite(iw) && isFinite(ih) && iw > 0 && ih > 0) {
        minDim = Math.min(iw, ih);
      }
    }
    return { coarse: coarse, fine: fine, touch: touch, minDim: minDim,
      touchOnly: detectTouchOnly({ coarse: coarse, fine: fine,
        touch: touch, minDim: minDim }) };
  }

  // Split when touch-only (tablets inspect too) or when space is tight.
  // Pure.
  function shouldSplitLayout(w, h, touchOnly) {
    if (touchOnly === true) return true;
    w = finite(w, Infinity);
    h = finite(h, Infinity);
    if (!(w > 0) || !(h > 0)) return false;
    return w < SPLIT_NARROW_W || Math.min(w, h) < SPLIT_MIN_DIM;
  }

  // 'portrait' when height wins (square counts as portrait: 3D above 2D).
  // Pure.
  function orientationOf(w, h) {
    return finite(h, 0) >= finite(w, 0) ? 'portrait' : 'landscape';
  }

  function clampFraction(f) {
    f = finite(f, 0.42);
    return clamp(f, DIVIDE_MIN, DIVIDE_MAX);
  }

  // Pane pixel split for a container box: portrait stacks 3D above 2D,
  // landscape puts 3D left of 2D. frac is the 3D share. Pure.
  function paneSplit(boxW, boxH, orientation, frac, dividerPx) {
    var f = clampFraction(frac);
    var dv = Math.max(0, finite(dividerPx, 0));
    var total = Math.max(0, finite(orientation === 'landscape' ? boxW : boxH, 0));
    var available = Math.max(0, total - dv);
    // Browser chrome or the keyboard may leave less than two nominal
    // pane minima. Share the actual space without overflowing it.
    var minimum = Math.min(MIN_PANE_PX, available / 2);
    var first = clamp(Math.round(total * f), minimum, available - minimum);
    var second = available - first;
    return { first: first, second: second, frac: f };
  }

  // World bbox of drawable entities (points, spans, round rims), in mm.
  // entities: [{type,x,y,x2,y2,radius,visible}]. Pure. Null when empty.
  function extentOf(entities) {
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    var n = 0;
    (entities || []).forEach(function (e) {
      if (!e || e.visible === false) return;
      var pts = [];
      if (typeof e.x === 'number' && typeof e.y === 'number') {
        pts.push([e.x, e.y]);
      }
      if (typeof e.x2 === 'number' && typeof e.y2 === 'number') {
        pts.push([e.x2, e.y2]);
      }
      if (pts.length === 0) return;
      if (typeof e.radius === 'number' && e.radius > 0 &&
          (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC')) {
        var c = pts[0];
        pts = [[c[0] - e.radius, c[1] - e.radius],
          [c[0] + e.radius, c[1] + e.radius]];
      }
      pts.forEach(function (p) {
        if (!isFinite(p[0]) || !isFinite(p[1])) return;
        n++;
        if (p[0] < x0) x0 = p[0];
        if (p[0] > x1) x1 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[1] > y1) y1 = p[1];
      });
    });
    if (n === 0) return null;
    return { x0: x0, x1: x1, y0: y0, y1: y1 };
  }

  // Fit a mm bbox into a pane: {s, tx, ty} in viewport convention
  // (px = x*s + tx, py = ty - y*s). Null/empty bbox centers the origin
  // with the XY datum across the middle, so empty sheets fit too.
  // Pure.
  function fitSheetView(paneW, paneH, bbox, opts) {
    opts = opts || {};
    var pad = Math.max(0, finite(opts.padPx, FIT_PAD_PX));
    var minSpan = Math.max(1, finite(opts.minSpanMm, FIT_MIN_SPAN_MM));
    var w = Math.max(1, finite(paneW, 300));
    var h = Math.max(1, finite(paneH, 300));
    pad = Math.min(pad, w * 0.15, h * 0.15);
    if (!bbox) {
      var s0 = 2;
      return { s: s0, tx: w / 2, ty: h / 2 };
    }
    var x0 = finite(bbox.x0, 0), x1 = finite(bbox.x1, 0);
    var y0 = Math.min(0, finite(bbox.y0, 0));
    var y1 = Math.max(0, finite(bbox.y1, 0));
    var spanX = Math.max(minSpan, x1 - x0);
    var spanY = Math.max(minSpan, y1 - y0);
    var s = clamp(Math.min((w - pad * 2) / spanX, (h - pad * 2) / spanY),
      SCALE_MIN, SCALE_MAX);
    if (!isFinite(s) || s <= 0) s = 2;
    var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    return { s: s, tx: w / 2 - cx * s, ty: h / 2 + cy * s };
  }

  // Keep the world point at pane center fixed across a resize: returns
  // the tx/ty that hold it. Pure.
  function preserveCenterTxTy(oldW, oldH, newW, newH, s, tx, ty) {
    oldW = finite(oldW, 1);
    oldH = finite(oldH, 1);
    newW = finite(newW, 1);
    newH = finite(newH, 1);
    s = finite(s, 2);
    if (!(s > 0)) s = 2;
    var wx = (oldW / 2 - finite(tx, 0)) / s;
    var wy = (finite(ty, 0) - oldH / 2) / s;
    return { tx: newW / 2 - wx * s, ty: newH / 2 + wy * s };
  }

  // ---- Pure pointer-gesture tracker ---------------------------------
  // Feeds pointer events (id, x, y, ms) and reports pane gestures:
  // single-finger drag (pan/orbit deltas), two-finger pinch (anchored
  // factor + centroid travel), and taps. Ownership is fixed from the
  // first contact; extra fingers beyond two are ignored; lifting one
  // finger of a pinch re-baselines the survivor so nothing jumps.
  // No DOM: the page wires real listeners onto the pane surfaces.
  function createGestureTracker(callbacks) {
    callbacks = callbacks || {};
    var pointers = {};
    var order = [];
    var mode = 'idle';
    var startX = 0, startY = 0, startT = 0;
    var lastX = 0, lastY = 0;
    var pinchDist = 0, pinchX = 0, pinchY = 0;
    var moved = false;

    function emit(name, arg) {
      if (typeof callbacks[name] === 'function') callbacks[name](arg);
    }
    function count() { return order.length; }
    function centroid() {
      var x = 0, y = 0;
      for (var i = 0; i < order.length; i++) {
        x += pointers[order[i]].x;
        y += pointers[order[i]].y;
      }
      return { x: x / order.length, y: y / order.length };
    }
    function span() {
      if (order.length < 2) return 0;
      var a = pointers[order[0]], b = pointers[order[1]];
      return Math.sqrt((a.x - b.x) * (a.x - b.x) +
        (a.y - b.y) * (a.y - b.y));
    }
    return {
      has: function (id) { return pointers[id] !== undefined; },
      state: function () {
        return { mode: mode, count: count(), moved: moved };
      },
      down: function (id, x, y, ms) {
        if (pointers[id] !== undefined) return;
        if (order.length >= 2) return;
        pointers[id] = { x: x, y: y };
        order.push(id);
        if (order.length === 1) {
          mode = 'single';
          startX = x;
          startY = y;
          lastX = x;
          lastY = y;
          startT = finite(ms, 0);
          moved = false;
        } else if (order.length === 2) {
          var c = centroid();
          mode = 'pinch';
          moved = true;
          pinchDist = Math.max(PINCH_MIN_DIST_PX, span());
          pinchX = c.x;
          pinchY = c.y;
          lastX = c.x;
          lastY = c.y;
          emit('onPinchStart', { x: c.x, y: c.y });
        }
      },
      move: function (id, x, y) {
        if (pointers[id] === undefined) return;
        pointers[id].x = x;
        pointers[id].y = y;
        if (mode === 'single' && order.length === 1) {
          if (!moved &&
              Math.sqrt((x - startX) * (x - startX) +
                (y - startY) * (y - startY)) > TAP_SLOP_PX) {
            moved = true;
            emit('onDragStart', { x: x, y: y });
          }
          if (moved) {
            emit('onDrag', { dx: x - lastX, dy: y - lastY, x: x, y: y });
            lastX = x;
            lastY = y;
          }
        } else if (mode === 'pinch' && order.length >= 2) {
          var c = centroid();
          var d = Math.max(PINCH_MIN_DIST_PX, span());
          var factor = pinchDist > 0 ? d / pinchDist : 1;
          if (isFinite(factor) && factor > 0) {
            emit('onPinch', { factor: factor, x: c.x, y: c.y,
              dx: c.x - pinchX, dy: c.y - pinchY });
          }
          pinchDist = d;
          pinchX = c.x;
          pinchY = c.y;
        }
      },
      up: function (id, ms) {
        if (pointers[id] === undefined) return;
        delete pointers[id];
        for (var i = 0; i < order.length; i++) {
          if (order[i] === id) { order.splice(i, 1); break; }
        }
        if (order.length === 0) {
          if (mode === 'single' && !moved) {
            var dt = finite(ms, 0) - startT;
            if (dt >= 0 && dt <= TAP_MAX_MS) {
              emit('onTap', { x: startX, y: startY, ms: finite(ms, 0) });
            }
          }
          mode = 'idle';
          moved = false;
          emit('onEnd', {});
        } else if (order.length === 1) {
          var p = pointers[order[0]];
          mode = 'single';
          startX = p.x;
          startY = p.y;
          lastX = p.x;
          lastY = p.y;
          moved = true;
          emit('onPinchEnd', { x: p.x, y: p.y });
        }
      },
      cancel: function () {
        pointers = {};
        order = [];
        mode = 'idle';
        moved = false;
        emit('onCancel', {});
      }
    };
  }

  // ---- Pose dock value helpers (pure) --------------------------------
  var POSE_MOVE_RANGE = { min: -120, max: 120, step: 1, snap: 5, unit: 'mm' };
  var POSE_ROT_RANGE = { min: -180, max: 180, step: 1, snap: 5, unit: '°' };
  var POSE_SCALE_RANGE = { min: 0.1, max: 3, step: 0.01, snap: 0.1, unit: '×' };

  function poseRangeFor(op) {
    if (op === 'rotate') return POSE_ROT_RANGE;
    if (op === 'scale') return POSE_SCALE_RANGE;
    return POSE_MOVE_RANGE;
  }

  function snapPoseValue(op, value) {
    var r = poseRangeFor(op);
    var v = finite(value, 0);
    return Math.round(v / r.snap) * r.snap;
  }

  function clampPoseValue(op, value) {
    var r = poseRangeFor(op);
    return clamp(finite(value, 0), r.min, r.max);
  }

  // ---- Browser shell --------------------------------------------------
  // mount(ctx) builds the mobile header, split panes, divider, pose
  // dock, bottom sheet, and overflow menu, then owns them: layout sync,
  // node moves, gestures, and control wiring. ctx carries the app
  // callbacks listed at the top of the mount function. Returns a shell
  // handle, or a null shell without DOM. Safe to call once.
  var shellSingleton = null;

  // Singleton probes for the page and sibling modules: false (never
  // throw) before mount or without DOM.
  function splitActive() {
    try {
      return !!(shellSingleton && shellSingleton.active());
    } catch (err) {
      return false;
    }
  }
  function clickSuppressed() {
    try {
      return !!(shellSingleton && shellSingleton.clickSuppressed());
    } catch (err) {
      return false;
    }
  }
  function shouldDesktopIgnore(e) {
    try {
      return !!(shellSingleton && shellSingleton.shouldDesktopIgnore(e));
    } catch (err) {
      return false;
    }
  }
  function flash(msg) {
    try {
      if (shellSingleton && shellSingleton.flash) shellSingleton.flash(msg);
    } catch (err) { /* toast is best-effort */ }
  }

  function nullShell() {
    return {
      active: function () { return false; },
      inspection: function () { return false; },
      sync: function () {},
      setMode: function () {},
      setTitle: function () {},
      setInspect: function () {},
      setSpatialNote: function () {},
      refreshPoseDock: function () {},
      updatePoseReadout: function () {},
      shouldDesktopIgnore: function () { return false; },
      clickSuppressed: function () { return false; },
      noteGestureEnd: function () {},
      flash: function () {}
    };
  }

  function mount(ctx) {
    if (!hasDOM() || typeof window === 'undefined') return nullShell();
    if (shellSingleton) return shellSingleton;
    ctx = ctx || {};
    function need(name) {
      if (typeof ctx[name] !== 'function') {
        throw new Error('educad-mobile: ctx.' + name + ' needed');
      }
      return ctx[name];
    }
    var getMode = need('getMode');
    var isInspection = need('isInspection');
    var canEdit = ctx.canEdit || function () { return !isInspection(); };
    var applySizes = need('applySizes');
    var setSheetMode = need('setSheetMode');
    var loadDemo = need('loadDemo');
    var runVerify = ctx.runVerify || function () {};
    var startTutorial = ctx.startTutorial || function () {};
    var clearSheet = ctx.clearSheet || function () {};
    var fitSheet = need('fitSheet');
    var fitGlass = ctx.fitGlass || function () {};
    var resetGlass = ctx.resetGlass || function () {};
    var tapSheet = need('tapSheet');
    var tapGlass = ctx.tapGlass || function () {};
    var panSheetBy = need('panSheetBy');
    var pinchSheet = need('pinchSheet');
    var orbitGlassBy = need('orbitGlassBy');
    var panGlassBy = need('panGlassBy');
    var pinchGlass = need('pinchGlass');
    var pressSheet = ctx.pressSheet || null;
    var poseSet = ctx.poseSet || function () { return null; };
    var poseReset = ctx.poseReset || function () {};
    var poseSyncAngles = ctx.poseSyncAngles || function () { return null; };
    var poseIsAvailable = ctx.poseIsAvailable || function () { return true; };
    var openDrawings = ctx.openDrawings || function () {};
    var openSets = ctx.openSets || function () {};
    var doLogout = ctx.doLogout || function () {};
    var toggleGrid = ctx.toggleGrid || function () {};
    var isGridOn = ctx.isGridOn || function () { return false; };
    var togglePlanes = ctx.togglePlanes || function () {};
    var planesOn = ctx.planesOn || function () { return true; };
    var toggleCoords = ctx.toggleCoords || function () {};
    var coordsOn = ctx.coordsOn || function () { return true; };
    var demosVisible = ctx.demosVisible || function () { return true; };
    var candidatesAt = ctx.candidatesAt || function () { return []; };
    var inspectChoice = ctx.inspectChoice || function () {};
    var openSettings = ctx.openSettings || function () {};

    var suppressUntil = 0;
    function nowMs() {
      return (window.performance && typeof window.performance.now === 'function') ?
        window.performance.now() : Date.now();
    }
    function noteGestureEnd() { suppressUntil = nowMs() + CLICK_SUPPRESS_MS; }
    function clickSuppressed() { return nowMs() < suppressUntil; }
    function shouldDesktopIgnore(e) {
      if (!shell.split) return false;
      var t = e && e.pointerType;
      return t !== undefined && t !== null && t !== '' && t !== 'mouse';
    }

    var body = document.body;
    var appContainer = document.getElementById('app-container');

    function button(label, aria, cls) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = cls || 'mobile-btn';
      b.textContent = label;
      if (aria) b.setAttribute('aria-label', aria);
      return b;
    }

    // -- Header ------------------------------------------------------
    var header = document.createElement('header');
    header.id = 'mobile-header';
    header.hidden = true;
    var titleEl = document.createElement('span');
    titleEl.id = 'mobile-title';
    titleEl.textContent = 'EduCAD';
    var modeGroup = document.createElement('div');
    modeGroup.className = 'mobile-seg';
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', 'Sheet mode');
    var btnEdit = button('Edit', 'Edit mode', 'mobile-seg-btn');
    var btnView = button('View', 'View mode', 'mobile-seg-btn');
    var btnPose = button('Pose', 'Pose mode', 'mobile-seg-btn');
    modeGroup.appendChild(btnEdit);
    modeGroup.appendChild(btnView);
    modeGroup.appendChild(btnPose);
    var btnOverflow = button('⋯', 'More actions', 'mobile-icon-btn');
    btnOverflow.setAttribute('aria-expanded', 'false');
    btnOverflow.setAttribute('aria-controls', 'mobile-menu');
    header.appendChild(titleEl);
    header.appendChild(modeGroup);
    header.appendChild(btnOverflow);
    appContainer.appendChild(header);

    btnEdit.addEventListener('click', function () { setSheetMode('edit'); });
    btnView.addEventListener('click', function () { setSheetMode('view'); });
    btnPose.addEventListener('click', function () {
      if (getMode() === 'pose') setSheetMode(isInspection() ? 'view' : 'edit');
      else setSheetMode('pose');
    });

    // -- Panes -------------------------------------------------------
    var panes = document.createElement('div');
    panes.id = 'mobile-panes';
    panes.hidden = true;
    var pane3d = document.createElement('section');
    pane3d.id = 'mobile-pane-3d';
    pane3d.setAttribute('aria-label', '3D view');
    var bar3d = document.createElement('div');
    bar3d.className = 'mobile-pane-bar';
    var lab3d = document.createElement('span');
    lab3d.className = 'mobile-pane-label';
    lab3d.textContent = '3D';
    var btnFit3d = button('Fit', 'Fit 3D view', 'mobile-btn');
    var btnReset3d = button('Reset', 'Reset 3D camera', 'mobile-btn');
    var btnExpand3d = button('Expand', 'Expand 3D pane', 'mobile-btn');
    bar3d.appendChild(lab3d);
    bar3d.appendChild(btnFit3d);
    bar3d.appendChild(btnExpand3d);
    var glassSlot = document.createElement('div');
    glassSlot.id = 'mobile-glass-slot';
    var glassEmpty = document.createElement('p');
    glassEmpty.className = 'mobile-pane-empty';
    glassEmpty.hidden = true;
    glassEmpty.textContent = '3D preview is off. Turn it on under ⋯ → Display.';
    pane3d.appendChild(bar3d);
    pane3d.appendChild(glassSlot);
    pane3d.appendChild(glassEmpty);
    var divider = document.createElement('div');
    divider.id = 'mobile-divider';
    divider.className = 'mobile-divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-label', 'Pane divider');
    divider.setAttribute('tabindex', '0');
    var grip = document.createElement('span');
    grip.className = 'mobile-divider-grip';
    grip.setAttribute('aria-hidden', 'true');
    divider.appendChild(grip);
    var pane2d = document.createElement('section');
    pane2d.id = 'mobile-pane-2d';
    pane2d.setAttribute('aria-label', '2D sheet');
    var bar2d = document.createElement('div');
    bar2d.className = 'mobile-pane-bar';
    var lab2d = document.createElement('span');
    lab2d.className = 'mobile-pane-label';
    lab2d.textContent = 'Sheet';
    var btnFit2d = button('Fit', 'Fit sheet to pane', 'mobile-btn');
    var btnExpand2d = button('Expand', 'Expand sheet pane', 'mobile-btn');
    bar2d.appendChild(lab2d);
    bar2d.appendChild(btnFit2d);
    bar2d.appendChild(btnExpand2d);
    var sheetSlot = document.createElement('div');
    sheetSlot.id = 'mobile-sheet-slot';
    pane2d.appendChild(bar2d);
    pane2d.appendChild(sheetSlot);
    panes.appendChild(pane3d);
    panes.appendChild(divider);
    panes.appendChild(pane2d);
    appContainer.appendChild(panes);

    btnFit2d.addEventListener('click', function () { fitSheet(); });
    btnFit3d.addEventListener('click', function () { fitGlass(); });
    btnReset3d.addEventListener('click', function () { resetGlass(); });
    btnExpand2d.addEventListener('click', function () { setExpand('2d'); });
    btnExpand3d.addEventListener('click', function () { setExpand('3d'); });

    var expandBar = document.createElement('div');
    expandBar.id = 'mobile-expandbar';
    expandBar.hidden = true;
    var btnBoth = button('Show both', 'Show both panes', 'mobile-btn');
    var btnSwitch = button('Switch', 'Switch pane', 'mobile-btn');
    expandBar.appendChild(btnBoth);
    expandBar.appendChild(btnSwitch);
    appContainer.appendChild(expandBar);
    btnBoth.addEventListener('click', function () { setExpand(null); });
    btnSwitch.addEventListener('click', function () {
      setExpand(shell.expand === '2d' ? '3d' : '2d');
    });

    // -- Pose dock ---------------------------------------------------
    var poseDock = document.createElement('section');
    poseDock.id = 'mobile-pose';
    poseDock.hidden = true;
    poseDock.setAttribute('aria-label', 'Pose controls');
    var poseReadout = document.createElement('p');
    poseReadout.id = 'mobile-pose-readout';
    poseReadout.setAttribute('aria-live', 'polite');
    var poseRow1 = document.createElement('div');
    poseRow1.className = 'mobile-pose-row';
    var opGroup = document.createElement('div');
    opGroup.className = 'mobile-seg';
    opGroup.setAttribute('role', 'group');
    opGroup.setAttribute('aria-label', 'Pose operation');
    var btnMove = button('Move', 'Move the model', 'mobile-seg-btn');
    var btnRotate = button('Rotate', 'Rotate the model', 'mobile-seg-btn');
    opGroup.appendChild(btnMove);
    opGroup.appendChild(btnRotate);
    var axisGroup = document.createElement('div');
    axisGroup.className = 'mobile-seg';
    axisGroup.setAttribute('role', 'group');
    axisGroup.setAttribute('aria-label', 'Pose axis');
    var axisBtns = {};
    ['X', 'Y', 'Z'].forEach(function (a) {
      var b = button(a, a + ' axis', 'mobile-seg-btn');
      b.setAttribute('aria-pressed', 'false');
      axisBtns[a] = b;
      axisGroup.appendChild(b);
    });
    poseRow1.appendChild(opGroup);
    poseRow1.appendChild(axisGroup);
    var poseRow2 = document.createElement('div');
    poseRow2.className = 'mobile-pose-row';
    var poseSlider = document.createElement('input');
    poseSlider.type = 'range';
    poseSlider.id = 'mobile-pose-slider';
    poseSlider.setAttribute('aria-label', 'Pose value');
    var poseNumber = document.createElement('input');
    poseNumber.type = 'number';
    poseNumber.id = 'mobile-pose-number';
    poseNumber.setAttribute('aria-label', 'Pose value, numeric');
    var poseUnit = document.createElement('span');
    poseUnit.id = 'mobile-pose-unit';
    poseUnit.className = 'mobile-pose-unit';
    poseRow2.appendChild(poseSlider);
    poseRow2.appendChild(poseNumber);
    poseRow2.appendChild(poseUnit);
    var poseRow3 = document.createElement('div');
    poseRow3.className = 'mobile-pose-row';
    var snapWrap = document.createElement('label');
    snapWrap.className = 'mobile-snap';
    var snapBox = document.createElement('input');
    snapBox.type = 'checkbox';
    snapBox.id = 'mobile-pose-snap';
    snapWrap.appendChild(snapBox);
    snapWrap.appendChild(document.createTextNode('Snap'));
    var btnPoseReset = button('Reset pose', 'Reset pose', 'mobile-btn');
    poseRow3.appendChild(snapWrap);
    poseRow3.appendChild(btnPoseReset);
    var poseAdvanced = document.createElement('details');
    poseAdvanced.className = 'mobile-advanced';
    var advSum = document.createElement('summary');
    advSum.textContent = 'Scale';
    advSum.title = 'Advanced: scale';
    poseAdvanced.appendChild(advSum);
    var scaleRow = document.createElement('div');
    scaleRow.className = 'mobile-pose-row';
    var scaleSlider = document.createElement('input');
    scaleSlider.type = 'range';
    scaleSlider.min = String(POSE_SCALE_RANGE.min);
    scaleSlider.max = String(POSE_SCALE_RANGE.max);
    scaleSlider.step = String(POSE_SCALE_RANGE.step);
    scaleSlider.value = '1';
    scaleSlider.setAttribute('aria-label', 'Pose scale');
    var scaleNumber = document.createElement('input');
    scaleNumber.type = 'number';
    scaleNumber.min = String(POSE_SCALE_RANGE.min);
    scaleNumber.max = String(POSE_SCALE_RANGE.max);
    scaleNumber.step = String(POSE_SCALE_RANGE.step);
    scaleNumber.value = '1';
    scaleNumber.setAttribute('aria-label', 'Pose scale, numeric');
    var scaleUnit = document.createElement('span');
    scaleUnit.className = 'mobile-pose-unit';
    scaleUnit.textContent = '×';
    scaleRow.appendChild(scaleSlider);
    scaleRow.appendChild(scaleNumber);
    scaleRow.appendChild(scaleUnit);
    poseAdvanced.appendChild(scaleRow);
    poseAdvanced.addEventListener('toggle', scheduleSync);
    var poseEmpty = document.createElement('p');
    poseEmpty.className = 'mobile-pose-empty';
    poseEmpty.hidden = true;
    poseDock.appendChild(poseReadout);
    poseDock.appendChild(poseRow1);
    poseDock.appendChild(poseRow2);
    poseRow3.appendChild(poseAdvanced);
    poseDock.appendChild(poseEmpty);
    appContainer.appendChild(poseDock);

    var poseUI = { op: 'move', axis: 'X', angles: { X: 0, Y: 0, Z: 0 } };
    function poseRange() { return poseRangeFor(poseUI.op); }
    function syncPoseRange() {
      var r = poseRange();
      poseSlider.min = String(r.min);
      poseSlider.max = String(r.max);
      poseSlider.step = String(r.step);
      poseNumber.min = String(r.min);
      poseNumber.max = String(r.max);
      poseNumber.step = String(r.step);
      poseUnit.textContent = r.unit;
      poseSlider.setAttribute('aria-label', (poseUI.op === 'move' ? 'Move ' : 'Rotate ') + poseUI.axis + ' (' + r.unit + ')');
      poseNumber.setAttribute('aria-label', poseSlider.getAttribute('aria-label') + ', numeric');
      btnMove.setAttribute('aria-pressed', String(poseUI.op === 'move'));
      btnRotate.setAttribute('aria-pressed', String(poseUI.op === 'rotate'));
      btnMove.classList.toggle('active', poseUI.op === 'move');
      btnRotate.classList.toggle('active', poseUI.op === 'rotate');
      Object.keys(axisBtns).forEach(function (a) {
        var on = a === poseUI.axis;
        axisBtns[a].setAttribute('aria-pressed', String(on));
        axisBtns[a].classList.toggle('active', on);
      });
    }
    function syncPoseValues() {
      var synced = poseSyncAngles();
      if (synced && synced.t && synced.s !== undefined) {
        var idx = { X: 0, Y: 1, Z: 2 }[poseUI.axis];
        if (poseUI.op === 'move') {
          var mv = clampPoseValue('move', synced.t[idx]);
          poseSlider.value = String(mv);
          poseNumber.value = String(Math.round(mv * 100) / 100);
        } else {
          var av = clampPoseValue('rotate', poseUI.angles[poseUI.axis]);
          poseSlider.value = String(av);
          poseNumber.value = String(Math.round(av * 100) / 100);
        }
        var sv = clampPoseValue('scale', synced.s);
        scaleSlider.value = String(sv);
        scaleNumber.value = String(Math.round(sv * 1000) / 1000);
      }
    }
    function poseSliderInput(raw, fromScale) {
      var op = fromScale ? 'scale' : poseUI.op;
      var value = Number(raw);
      if (!isFinite(value)) return;
      value = clampPoseValue(op, value);
      if (snapBox.checked) value = snapPoseValue(op, value);
      var res = poseSet(op, poseUI.axis, value, snapBox.checked,
        poseUI.angles[poseUI.axis]);
      if (!res) return;
      if (op === 'rotate' && isFinite(res.angle)) {
        poseUI.angles[poseUI.axis] = res.angle;
      }
      if (fromScale) {
        scaleSlider.value = String(res.value);
        scaleNumber.value = String(Math.round(res.value * 1000) / 1000);
      } else {
        poseSlider.value = String(res.value);
        poseNumber.value = String(Math.round(res.value * 100) / 100);
      }
    }
    btnMove.addEventListener('click', function () {
      poseUI.op = 'move';
      syncPoseRange();
      syncPoseValues();
    });
    btnRotate.addEventListener('click', function () {
      poseUI.op = 'rotate';
      syncPoseRange();
      syncPoseValues();
    });
    Object.keys(axisBtns).forEach(function (a) {
      axisBtns[a].addEventListener('click', function () {
        poseUI.axis = a;
        syncPoseRange();
        syncPoseValues();
      });
    });
    poseSlider.addEventListener('input', function () {
      poseSliderInput(poseSlider.value, false);
    });
    poseNumber.addEventListener('change', function () {
      poseSliderInput(poseNumber.value, false);
    });
    scaleSlider.addEventListener('input', function () {
      poseSliderInput(scaleSlider.value, true);
    });
    scaleNumber.addEventListener('change', function () {
      poseSliderInput(scaleNumber.value, true);
    });
    btnPoseReset.addEventListener('click', function () {
      poseReset();
      poseUI.angles = { X: 0, Y: 0, Z: 0 };
      syncPoseValues();
    });
    syncPoseRange();

    // -- Bottom sheet ------------------------------------------------
    var sheet = document.createElement('section');
    sheet.id = 'mobile-sheet';
    sheet.hidden = true;
    sheet.setAttribute('aria-label', 'Inspection details');
    var sheetHandle = document.createElement('button');
    sheetHandle.type = 'button';
    sheetHandle.id = 'mobile-sheet-handle';
    sheetHandle.setAttribute('aria-expanded', 'false');
    sheetHandle.setAttribute('aria-controls', 'mobile-sheet-body');
    var peekEl = document.createElement('span');
    peekEl.id = 'mobile-peek';
    peekEl.textContent = 'Inspection';
    var chev = document.createElement('span');
    chev.className = 'mobile-chev';
    chev.setAttribute('aria-hidden', 'true');
    chev.textContent = '▴';
    sheetHandle.appendChild(peekEl);
    sheetHandle.appendChild(chev);
    var sheetBody = document.createElement('div');
    sheetBody.id = 'mobile-sheet-body';
    sheetBody.hidden = true;
    var inspectCard = document.createElement('div');
    inspectCard.id = 'mobile-inspect-card';
    inspectCard.hidden = true;
    var spatialSlot = document.createElement('div');
    spatialSlot.id = 'mobile-spatial-slot';
    sheetBody.appendChild(inspectCard);
    sheetBody.appendChild(spatialSlot);
    sheet.appendChild(sheetHandle);
    sheet.appendChild(sheetBody);
    appContainer.appendChild(sheet);
    var sheetOpen = false;
    function setSheetOpen(open) {
      sheetOpen = !!open;
      sheetHandle.setAttribute('aria-expanded', String(sheetOpen));
      sheetBody.hidden = !sheetOpen;
      chev.textContent = sheetOpen ? '▾' : '▴';
      scheduleSync();
    }
    sheetHandle.addEventListener('click', function () {
      setSheetOpen(!sheetOpen);
    });

    // -- Overflow menu -----------------------------------------------
    var menuRoot = document.createElement('div');
    menuRoot.id = 'mobile-menu-root';
    menuRoot.hidden = true;
    body.appendChild(menuRoot);
    var menu = document.createElement('div');
    menu.id = 'mobile-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    menuRoot.appendChild(menu);
    function menuSection(title) {
      var s = document.createElement('div');
      s.className = 'mobile-menu-section';
      var h = document.createElement('h2');
      h.textContent = title;
      s.appendChild(h);
      return s;
    }
    function menuButton(label, fn, opts) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'mobile-menu-btn';
      b.setAttribute('role', 'menuitem');
      b.textContent = label;
      if (opts && opts.pressed !== undefined) {
        b.setAttribute('aria-pressed', String(!!opts.pressed));
      }
      b.addEventListener('click', function () {
        fn(b);
      });
      return b;
    }
    var demoSection = menuSection('Demos');
    var DEMOS = [
      ['line', 'Line Rotation'],
      ['points', 'Quadrant Points'],
      ['prism', 'Hex Prism'],
      ['3view', '3-View Prism'],
      ['square', 'Profile Square']
    ];
    DEMOS.forEach(function (d) {
      demoSection.appendChild(menuButton(d[1], function () {
        loadDemo(d[0]);
        closeMenu();
      }));
    });
    var sheetSection = menuSection('Sheet');
    var tutRow = document.createElement('div');
    tutRow.className = 'mobile-menu-rownote';
    var btnTutSquare = menuButton('Tutorial: Square', function () {
      startTutorial('square');
      closeMenu();
    });
    var btnTutPrism = menuButton('Tutorial: Prism', function () {
      startTutorial('prism');
      closeMenu();
    });
    var btnClear = menuButton('Clear sheet', function () {
      clearSheet();
      closeMenu();
    });
    var btnCheck = menuButton('Check hidden', function () {
      runVerify();
      closeMenu();
    });
    var btnSettings = menuButton('Settings', function () {
      openSettings();
      closeMenu();
    });
    sheetSection.appendChild(btnTutSquare);
    sheetSection.appendChild(btnTutPrism);
    sheetSection.appendChild(btnClear);
    sheetSection.appendChild(btnCheck);
    sheetSection.appendChild(btnSettings);
    var libSection = menuSection('Drawings & sets');
    libSection.appendChild(menuButton('Open drawings', function () {
      openDrawings();
      closeMenu();
    }));
    libSection.appendChild(menuButton('Question sets', function () {
      openSets();
      closeMenu();
    }));
    var displaySection = menuSection('Display');
    btnReset3d.textContent = 'Reset 3D camera';
    btnReset3d.className = 'mobile-menu-btn';
    displaySection.appendChild(btnReset3d);
    var btnGrid = menuButton('Grid', function (b) {
      toggleGrid();
      b.setAttribute('aria-pressed', String(isGridOn()));
    }, { pressed: false });
    var btnPlanes = menuButton('HP / VP planes', function (b) {
      togglePlanes();
      b.setAttribute('aria-pressed', String(planesOn()));
    }, { pressed: true });
    displaySection.appendChild(btnGrid);
    displaySection.appendChild(btnPlanes);
    var acctSection = menuSection('Account');
    var homeLink = document.createElement('a');
    homeLink.className = 'mobile-menu-btn mobile-menu-link';
    homeLink.setAttribute('role', 'menuitem');
    homeLink.textContent = 'Studio';
    homeLink.href = 'teacher.html';
    var manualLink = document.createElement('a');
    manualLink.className = 'mobile-menu-btn mobile-menu-link';
    manualLink.setAttribute('role', 'menuitem');
    manualLink.textContent = 'Manual';
    manualLink.href = 'manual.html';
    manualLink.target = '_blank';
    manualLink.rel = 'noopener';
    acctSection.appendChild(homeLink);
    acctSection.appendChild(manualLink);
    acctSection.appendChild(menuButton('Logout', function () {
      doLogout();
    }));
    menu.appendChild(demoSection);
    menu.appendChild(sheetSection);
    var poseMenuSection = menuSection('Pose options');
    poseMenuSection.id = 'mobile-pose-options';
    poseMenuSection.hidden = true;
    poseMenuSection.appendChild(poseRow3);
    menu.appendChild(poseMenuSection);
    menu.appendChild(libSection);
    menu.appendChild(displaySection);
    menu.appendChild(acctSection);
    function refreshMenu() {
      var edit = canEdit();
      poseMenuSection.hidden = getMode() !== 'pose';
      demoSection.style.display = demosVisible() ? '' : 'none';
      btnTutSquare.disabled = !edit;
      btnTutPrism.disabled = !edit;
      btnClear.disabled = !edit;
      btnTutSquare.title = edit ? '' : 'Tutorials draw, so they need a desktop.';
      btnTutPrism.title = edit ? '' : 'Tutorials draw, so they need a desktop.';
      btnClear.title = edit ? '' : 'Inspection-only: the sheet cannot be cleared here.';
      btnGrid.setAttribute('aria-pressed', String(isGridOn()));
      btnPlanes.setAttribute('aria-pressed', String(planesOn()));
      try {
        var raw = window.localStorage.getItem('educad_session');
        var s = raw ? JSON.parse(raw) : null;
        if (s && s.role === 'student') {
          homeLink.href = 'student.html';
          homeLink.textContent = 'Workspace';
        } else if (s && s.role !== 'guest') {
          homeLink.href = 'teacher.html';
          homeLink.textContent = 'Studio';
        } else {
          homeLink.href = 'login.html';
          homeLink.textContent = 'Login';
        }
      } catch (err) { /* keep defaults */ }
    }
    function closeMenu() {
      menu.hidden = true;
      menuRoot.hidden = true;
      btnOverflow.setAttribute('aria-expanded', 'false');
    }
    btnOverflow.addEventListener('click', function () {
      if (menu.hidden) {
        refreshMenu();
        menuRoot.hidden = false;
        menu.hidden = false;
        btnOverflow.setAttribute('aria-expanded', 'true');
      } else {
        closeMenu();
      }
    });
    menuRoot.addEventListener('pointerdown', function (e) {
      if (e.target === menuRoot) closeMenu();
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menu.hidden) {
        closeMenu();
        btnOverflow.focus();
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);

    // -- Candidate chooser -------------------------------------------
    var chooser = document.createElement('div');
    chooser.id = 'mobile-chooser';
    chooser.hidden = true;
    chooser.setAttribute('role', 'dialog');
    chooser.setAttribute('aria-label', 'Overlapping entities');
    body.appendChild(chooser);
    function closeChooser() {
      chooser.hidden = true;
      chooser.innerHTML = '';
    }
    function openChooser(cands, anchorClient) {
      closeChooser();
      var head = document.createElement('p');
      head.className = 'mobile-chooser-head';
      head.textContent = 'Which one?';
      chooser.appendChild(head);
      cands.forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'mobile-chooser-btn';
        b.textContent = c.label;
        b.addEventListener('click', function () {
          inspectChoice(c.id);
          closeChooser();
        });
        chooser.appendChild(b);
      });
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'mobile-chooser-btn mobile-chooser-close';
      x.textContent = 'Cancel';
      x.setAttribute('aria-label', 'Close chooser');
      x.addEventListener('click', closeChooser);
      chooser.appendChild(x);
      var px = anchorClient ? anchorClient.x : window.innerWidth / 2;
      var py = anchorClient ? anchorClient.y : window.innerHeight / 2;
      chooser.style.left = clamp(Math.round(px - 90),
        8, Math.max(8, window.innerWidth - 200)) + 'px';
      chooser.style.top = clamp(Math.round(py - 40),
        8, Math.max(8, window.innerHeight - 240)) + 'px';
      chooser.hidden = false;
      var first = chooser.querySelector('.mobile-chooser-btn');
      if (first) first.focus();
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !chooser.hidden) closeChooser();
    });

    // -- Toast -------------------------------------------------------
    var toast = document.createElement('p');
    toast.id = 'mobile-toast';
    toast.hidden = true;
    toast.setAttribute('role', 'status');
    body.appendChild(toast);
    var toastTimer = null;
    function flash(msg) {
      if (!msg) return;
      toast.textContent = String(msg);
      toast.hidden = false;
      if (toastTimer !== null) {
        try { clearTimeout(toastTimer); } catch (err) { /* noop */ }
      }
      toastTimer = setTimeout(function () {
        toast.hidden = true;
        toastTimer = null;
      }, 3200);
    }

    // -- Node moves ----------------------------------------------------
    var moved = [];
    function stashMove(node, parent, before) {
      if (!node || !node.parentNode) return;
      moved.push({ node: node, parent: node.parentNode,
        before: node.nextSibling || null });
      if (before !== undefined && before !== null) {
        parent.insertBefore(node, before);
      } else {
        parent.appendChild(node);
      }
    }
    function restoreMoves() {
      for (var i = moved.length - 1; i >= 0; i--) {
        var m = moved[i];
        try {
          if (m.before && m.before.parentNode === m.parent) {
            m.parent.insertBefore(m.node, m.before);
          } else {
            m.parent.appendChild(m.node);
          }
        } catch (err) { /* node already home */ }
      }
      moved = [];
    }

    // -- Layout --------------------------------------------------------
    var shell = null;
    var fracStore = { portrait: 0.42, landscape: 0.44 };
    try {
      var saved = window.localStorage.getItem('educad_mobile_split');
      if (saved) {
        var parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          if (isFinite(parsed.portrait)) {
            fracStore.portrait = clampFraction(parsed.portrait);
          }
          if (isFinite(parsed.landscape)) {
            fracStore.landscape = clampFraction(parsed.landscape);
          }
        }
      }
    } catch (err) { /* private mode: fractions stay session-only */ }
    function saveFrac() {
      try {
        window.localStorage.setItem('educad_mobile_split',
          JSON.stringify(fracStore));
      } catch (err) { /* session-only */ }
    }

    function viewportBox() {
      var w = window.innerWidth, h = window.innerHeight;
      try {
        if (window.visualViewport) {
          if (isFinite(window.visualViewport.width)) {
            w = window.visualViewport.width;
          }
          if (isFinite(window.visualViewport.height)) {
            h = window.visualViewport.height;
          }
        }
      } catch (err) { /* fall back to inner sizes */ }
      return { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    }

    function setExpand(which) {
      shell.expand = (which === '2d' || which === '3d') ? which : null;
      body.classList.toggle('mobile-expand-2d', shell.expand === '2d');
      body.classList.toggle('mobile-expand-3d', shell.expand === '3d');
      if (shell.expand === '2d') {
        btnSwitch.textContent = 'Switch to 3D';
        btnSwitch.setAttribute('aria-label', 'Switch to the 3D pane');
      } else if (shell.expand === '3d') {
        btnSwitch.textContent = 'Switch to sheet';
        btnSwitch.setAttribute('aria-label', 'Switch to the 2D sheet pane');
      }
      expandBar.hidden = shell.expand === null;
      scheduleSync();
    }

    var syncQueued = false;
    function scheduleSync() {
      if (syncQueued) return;
      syncQueued = true;
      var raf = (typeof window.requestAnimationFrame === 'function') ?
        window.requestAnimationFrame : null;
      if (!raf) {
        syncQueued = false;
        sync();
        return;
      }
      raf(function () {
        syncQueued = false;
        sync();
      });
    }

    function contentBox(el) {
      var r = { width: 0, height: 0 };
      try {
        if (el && typeof el.getBoundingClientRect === 'function') {
          r = el.getBoundingClientRect();
        }
      } catch (err) { /* measure failed */ }
      return { w: Math.max(1, Math.round(r.width || 0)),
        h: Math.max(1, Math.round(r.height || 0)) };
    }

    var didInitialFit = false;
    var lastLayoutMode = getMode();
    function sync() {
      // A removed shell (for example after document replacement in a
      // preview) must never move canvases belonging to the new document.
      if (!appContainer.isConnected) return;
      var box = viewportBox();
      var inspection = isInspection();
      var split = shouldSplitLayout(box.w, box.h, inspection);
      var orient = orientationOf(box.w, box.h);
      if ((orient !== shell.orientation || split !== shell.split) && gestureOwner) {
        gestureOwner.tracker.cancel();
        gestureOwner = null;
      }
      shell.split = split;
      shell.orientation = orient;
      shell.inspectionNow = inspection;
      body.classList.toggle('mobile-layout', split);
      body.classList.toggle('mobile-inspect', inspection);
      body.classList.toggle('mobile-portrait', split && orient === 'portrait');
      body.classList.toggle('mobile-landscape',
        split && orient === 'landscape');
      divider.setAttribute('aria-orientation',
        orient === 'landscape' ? 'vertical' : 'horizontal');
      divider.setAttribute('aria-valuemin', String(DIVIDE_MIN * 100));
      divider.setAttribute('aria-valuemax', String(DIVIDE_MAX * 100));
      divider.setAttribute('aria-valuenow', String(Math.round(fracStore[orient] * 100)));
      if (!split) {
        appContainer.style.height = '';
        if (shell.moved) {
          restoreMoves();
          shell.moved = false;
        }
        header.hidden = true;
        panes.hidden = true;
        poseDock.hidden = true;
        sheet.hidden = true;
        expandBar.hidden = true;
        closeMenu();
        closeChooser();
        applySizes(null);
        return;
      }
      header.hidden = false;
      appContainer.style.height = box.h + 'px';
      panes.hidden = false;
      sheet.hidden = false;
      expandBar.hidden = shell.expand === null;
      btnEdit.style.display = canEdit() ? '' : 'none';
      if (!shell.moved) {
        var c1 = document.querySelector('#app-container canvas[data-layer="layer1"]');
        var c2 = document.querySelector('#app-container canvas[data-layer="layer2"]');
        var hud = document.querySelector('#app-container .edugraphics-hud');
        var mm = document.querySelector('#app-container .edugraphics-menu');
        var glass = appContainer ?
          appContainer.querySelector('.educad-solid-glass') : null;
        if (!glass && appContainer) {
          glass = appContainer.querySelector('.educad-solid');
        }
        if (c1) stashMove(c1, sheetSlot);
        if (c2) stashMove(c2, sheetSlot);
        if (hud) stashMove(hud, sheetSlot);
        if (mm) stashMove(mm, sheetSlot);
        document.querySelectorAll('#app-container .edugraphics-menu').forEach(function (m) {
          stashMove(m, sheetSlot);
        });
        if (glass) stashMove(glass, glassSlot);
        var spatial = document.querySelector('.spatial-panel');
        if (spatial) stashMove(spatial, spatialSlot);
        var dp = document.getElementById('drawings-panel');
        if (dp) stashMove(dp, body);
        var sp = document.getElementById('sets-panel');
        if (sp) stashMove(sp, body);
        shell.moved = true;
      }
      // Late menus (line/dot popups are built on demand): keep them in
      // the sheet slot while split, so their pane-relative offsets land.
      document.querySelectorAll('#app-container .edugraphics-menu').forEach(function (m) {
        sheetSlot.appendChild(m);
      });
      refreshPoseDock();
      // Keep canvas space when the details sheet and Pose disclosure are
      // both open. Their content scrolls inside the remaining dock area.
      var reserved = contentBox(header).h;
      if (!poseDock.hidden) reserved += contentBox(poseDock).h;
      if (!expandBar.hidden) reserved += contentBox(expandBar).h;
      reserved += orient === 'portrait' && shell.expand === null ?
        8 + 2 * 80 : 80;
      var appStyle = window.getComputedStyle(appContainer);
      reserved += (parseFloat(appStyle.paddingTop) || 0) +
        (parseFloat(appStyle.paddingBottom) || 0);
      sheet.style.maxHeight = Math.max(44, Math.min(box.h * 0.46,
        box.h - reserved)) + 'px';
      var frac = fracStore[orient];
      var avail = contentBox(panes);
      var dvBox = contentBox(divider);
      var dvPx = orient === 'landscape' ? dvBox.w : dvBox.h;
      var ps = paneSplit(avail.w, avail.h, orient, frac, dvPx || 14);
      if (shell.expand === '2d') {
        pane3d.style.display = 'none';
        divider.style.display = 'none';
        pane2d.style.display = '';
        pane2d.style.width = '';
        pane2d.style.height = '';
      } else if (shell.expand === '3d') {
        pane2d.style.display = 'none';
        divider.style.display = 'none';
        pane3d.style.display = '';
        pane3d.style.width = '';
        pane3d.style.height = '';
      } else {
        pane3d.style.display = '';
        divider.style.display = '';
        pane2d.style.display = '';
        if (orient === 'landscape') {
          pane3d.style.width = ps.first + 'px';
          pane3d.style.height = '';
          pane2d.style.width = '';
          pane2d.style.height = '';
        } else {
          pane3d.style.height = ps.first + 'px';
          pane3d.style.width = '';
          pane2d.style.width = '';
          pane2d.style.height = '';
        }
      }
      var s2 = contentBox(sheetSlot);
      var g3 = contentBox(glassSlot);
      applySizes({ sheetW: s2.w, sheetH: s2.h,
        glassW: g3.w, glassH: g3.h, orientation: orient,
        sheetVisible: shell.expand !== '3d', glassVisible: shell.expand !== '2d' });
      // Glass empty-state: the preferences switch hides the canvas.
      try {
        var cv = glassSlot.querySelector('canvas');
        glassEmpty.hidden = !(cv && (cv.hidden || cv.style.display === 'none'));
      } catch (err) { /* leave the note as is */ }
      // Pose controls change the available canvas area. Frame the drawing
      // once at that mode boundary; subsequent resizes preserve navigation.
      if (!didInitialFit || lastLayoutMode !== getMode()) {
        didInitialFit = true;
        fitSheet();
        fitGlass();
      }
      lastLayoutMode = getMode();
    }

    // Divider drag + keyboard.
    var divDrag = null;
    divider.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      divDrag = { x: e.clientX, y: e.clientY,
        frac: fracStore[shell.orientation || 'portrait'] };
      try {
        divider.setPointerCapture(e.pointerId);
      } catch (err) { /* capture is best-effort */ }
      e.preventDefault();
      e.stopPropagation();
    });
    divider.addEventListener('pointermove', function (e) {
      if (!divDrag) return;
      var avail = contentBox(panes);
      var orient = shell.orientation || 'portrait';
      var total = orient === 'landscape' ? avail.w : avail.h;
      if (!(total > 0)) return;
      var d = orient === 'landscape' ?
        (e.clientX - divDrag.x) : (e.clientY - divDrag.y);
      fracStore[orient] = clampFraction(divDrag.frac + d / total);
      saveFrac();
      sync();
      e.stopPropagation();
    });
    function divEnd(e) {
      if (!divDrag) return;
      divDrag = null;
      if (e) e.stopPropagation();
    }
    divider.addEventListener('pointerup', divEnd);
    divider.addEventListener('pointercancel', divEnd);
    divider.addEventListener('keydown', function (e) {
      var orient = shell.orientation || 'portrait';
      var step = 0;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') step = -0.05;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') step = 0.05;
      else if (e.key === 'Home') {
        fracStore[orient] = DIVIDE_MIN;
        saveFrac();
        sync();
        e.preventDefault();
        return;
      } else if (e.key === 'End') {
        fracStore[orient] = DIVIDE_MAX;
        saveFrac();
        sync();
        e.preventDefault();
        return;
      } else {
        return;
      }
      fracStore[orient] = clampFraction(fracStore[orient] + step);
      saveFrac();
      sync();
      e.preventDefault();
    });

    // -- Gestures ------------------------------------------------------
    function relOf(el, x, y) {
      try {
        var r = el.getBoundingClientRect();
        return { x: x - r.left, y: y - r.top };
      } catch (err) {
        return { x: x, y: y };
      }
    }
    var lastTouchDownMs = -1e12;
    var gestureOwner = null;
    function attachSurface(el, tracker) {
      if (!el) return;
      el.addEventListener('pointerdown', function (e) {
        if (!shell.split) return;
        if (e.pointerType === 'mouse' || e.pointerType === '') return;
        if (e.target && typeof e.target.closest === 'function' &&
            e.target.closest('button, input, select, textarea, a, summary, .mobile-pane-bar')) {
          return;
        }
        lastTouchDownMs = nowMs();
        if (!gestureOwner) gestureOwner = { el: el, tracker: tracker };
        var owner = gestureOwner;
        try {
          owner.el.setPointerCapture(e.pointerId);
        } catch (err) { /* capture is best-effort */ }
        var p = relOf(owner.el, e.clientX, e.clientY);
        owner.tracker.down(String(e.pointerId), p.x, p.y, nowMs());
        e.preventDefault();
        e.stopPropagation();
      });
      // Long-press on touch does nothing (no clear, no menu); mouse
      // right-click still reaches the desktop handler.
      el.addEventListener('contextmenu', function (e) {
        if (!shell.split) return;
        if (nowMs() - lastTouchDownMs < 1500) {
          e.preventDefault();
          e.stopPropagation();
        }
      });
      el.addEventListener('pointermove', function (e) {
        if (!shell.split) return;
        if (e.pointerType === 'mouse' || e.pointerType === '') return;
        if (!gestureOwner) return;
        var p = relOf(gestureOwner.el, e.clientX, e.clientY);
        gestureOwner.tracker.move(String(e.pointerId), p.x, p.y);
        e.stopPropagation();
      });
      function end(e, cancel) {
        if (!shell.split) return;
        if (e.pointerType === 'mouse' || e.pointerType === '') return;
        if (!gestureOwner || !gestureOwner.tracker.has(String(e.pointerId))) return;
        var owner = gestureOwner;
        if (cancel) owner.tracker.cancel();
        else owner.tracker.up(String(e.pointerId), nowMs());
        if (!owner.tracker.state().count) gestureOwner = null;
        try { if (owner.el.hasPointerCapture(e.pointerId)) owner.el.releasePointerCapture(e.pointerId); }
        catch (err) { /* capture may already have been released */ }
        e.stopPropagation();
      }
      el.addEventListener('pointerup', function (e) { end(e, false); });
      el.addEventListener('pointercancel', function (e) { end(e, true); });
      el.addEventListener('lostpointercapture', function (e) {
        if (gestureOwner && gestureOwner.tracker.has(String(e.pointerId))) {
          gestureOwner.tracker.cancel();
          gestureOwner = null;
        }
      });
    }
    var sheetTracker = createGestureTracker({
      onDrag: function (g) { panSheetBy(g.dx, g.dy); },
      onPinch: function (g) {
        panSheetBy(g.dx, g.dy);
        pinchSheet(g.factor, g.x, g.y);
      },
      onTap: function (g) {
        noteGestureEnd();
        var box = contentBox(sheetSlot);
        var client = null;
        try {
          var r = sheetSlot.getBoundingClientRect();
          client = { x: r.left + g.x, y: r.top + g.y };
        } catch (err) { /* chooser centers on the pane */ }
        if (pressSheet) {
          var handled = pressSheet(g.x, g.y, box, client);
          if (handled === 'chooser') {
            var cands = candidatesAt(g.x, g.y);
            if (cands.length >= 2) openChooser(cands.slice(0, 6), client);
            else tapSheet(g.x, g.y);
          }
        } else {
          tapSheet(g.x, g.y);
        }
      },
      onEnd: function () { noteGestureEnd(); },
      onCancel: function () { noteGestureEnd(); }
    });
    var glassTracker = createGestureTracker({
      onDrag: function (g) { orbitGlassBy(g.dx, g.dy); },
      onPinch: function (g) {
        panGlassBy(g.dx, g.dy);
        pinchGlass(g.factor, g.x, g.y);
      },
      onTap: function (g) {
        noteGestureEnd();
        tapGlass(g.x, g.y);
      },
      onEnd: function () { noteGestureEnd(); },
      onCancel: function () { noteGestureEnd(); }
    });
    attachSurface(sheetSlot, sheetTracker);
    attachSurface(glassSlot, glassTracker);

    // -- Shell state ---------------------------------------------------
    var peekMode = 'view';
    var peekTitle = 'EduCAD';
    var peekInspect = '';
    var peekSpatial = '';
    function renderPeek() {
      var parts = [peekTitle, peekMode === 'pose' ? 'Pose' : 'View'];
      if (peekInspect) parts.push(peekInspect);
      if (peekSpatial) parts.push(peekSpatial);
      peekEl.textContent = parts.join(' · ');
    }

    shell = {
      split: false,
      orientation: 'portrait',
      expand: null,
      moved: false,
      inspectionNow: false,
      active: function () { return shell.split; },
      inspection: function () { return shell.inspectionNow; },
      sync: sync,
      scheduleSync: scheduleSync,
      setExpand: setExpand,
      shouldDesktopIgnore: shouldDesktopIgnore,
      clickSuppressed: clickSuppressed,
      noteGestureEnd: noteGestureEnd,
      flash: flash,
      setMode: function (mode) {
        peekMode = mode === 'pose' ? 'pose' : 'view';
        btnEdit.classList.toggle('active', mode === 'edit');
        btnView.classList.toggle('active', mode === 'view');
        btnPose.classList.toggle('active', mode === 'pose');
        btnEdit.setAttribute('aria-pressed', String(mode === 'edit'));
        btnView.setAttribute('aria-pressed', String(mode === 'view'));
        btnPose.setAttribute('aria-pressed', String(mode === 'pose'));
        if (mode !== 'pose') {
          poseUI.angles = { X: 0, Y: 0, Z: 0 };
        } else {
          syncPoseValues();
        }
        renderPeek();
        refreshPoseDock();
        scheduleSync();
      },
      setTitle: function (t) {
        peekTitle = String(t || 'EduCAD');
        titleEl.textContent = peekTitle;
        renderPeek();
      },
      setInspect: function (title, html) {
        peekInspect = title ? String(title) : '';
        renderPeek();
        while (inspectCard.firstChild) {
          inspectCard.removeChild(inspectCard.firstChild);
        }
        if (!html) {
          inspectCard.hidden = true;
          return;
        }
        inspectCard.hidden = false;
        var h = document.createElement('h2');
        h.textContent = 'Sheet';
        inspectCard.appendChild(h);
        var d = document.createElement('div');
        d.textContent = String(html);
        inspectCard.appendChild(d);
      },
      setSpatialNote: function (text) {
        peekSpatial = text ? String(text) : '';
        renderPeek();
      },
      refreshPoseDock: refreshPoseDock,
      updatePoseReadout: function (text) {
        poseReadout.hidden = !/at view limit/.test(text || '');
        poseReadout.textContent = /at view limit/.test(text || '') ?
          'At view limit — front and top stay on their sides of XY.' :
          'Pose preview · exiting restores the drawing';
        poseReadout.title = String(text || '');
      }
    };

    function refreshPoseDock() {
      var show = shell.split && getMode() === 'pose';
      poseDock.hidden = !show;
      if (!show) return;
      var ok = false;
      try {
        ok = poseIsAvailable();
      } catch (err) {
        ok = false;
      }
      poseEmpty.hidden = ok;
      poseRow1.style.display = ok ? '' : 'none';
      poseRow2.style.display = ok ? '' : 'none';
      poseRow3.style.display = ok ? '' : 'none';
      poseAdvanced.style.display = ok ? '' : 'none';
      poseReadout.style.display = ok ? '' : 'none';
      if (!ok) {
        poseEmpty.textContent = isInspection() ?
          'Pose needs a 3D model — open a demo or a saved drawing with matching front and top views, then try Pose again. The sheet stays in View.' :
          'Pose needs a point — draw a point in both views first.';
      } else {
        syncPoseValues();
      }
    }

    window.addEventListener('resize', scheduleSync);
    // Disclosure controls and the details sheet can change the flex height
    // without a window resize (including while a numeric keyboard is open).
    if (typeof window.ResizeObserver === 'function') {
      var paneObserver = new window.ResizeObserver(scheduleSync);
      paneObserver.observe(panes);
    }
    window.addEventListener('orientationchange', function () {
      setTimeout(scheduleSync, 150);
    });
    try {
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', scheduleSync);
      }
    } catch (err) { /* inner sizes already tracked */ }
    try {
      if (window.matchMedia) {
        var mq = window.matchMedia('(pointer: coarse)');
        var onPointer = function () { scheduleSync(); };
        if (typeof mq.addEventListener === 'function') {
          mq.addEventListener('change', onPointer);
        } else if (typeof mq.addListener === 'function') {
          mq.addListener(onPointer);
        }
        var mq2 = window.matchMedia('(pointer: fine)');
        if (typeof mq2.addEventListener === 'function') {
          mq2.addEventListener('change', onPointer);
        } else if (typeof mq2.addListener === 'function') {
          mq2.addListener(onPointer);
        }
      }
    } catch (err) { /* pointer verdict stays put */ }

    shellSingleton = shell;
    sync();
    return shell;
  }

  return {
    VERSION: VERSION,
    WORLD_UNITS: WORLD_UNITS,
    TAP_SLOP_PX: TAP_SLOP_PX,
    TAP_MAX_MS: TAP_MAX_MS,
    TOUCH_TOL_PX: TOUCH_TOL_PX,
    PINCH_MIN_DIST_PX: PINCH_MIN_DIST_PX,
    CLICK_SUPPRESS_MS: CLICK_SUPPRESS_MS,
    SPLIT_NARROW_W: SPLIT_NARROW_W,
    SPLIT_MIN_DIM: SPLIT_MIN_DIM,
    MIN_PANE_PX: MIN_PANE_PX,
    DIVIDE_MIN: DIVIDE_MIN,
    DIVIDE_MAX: DIVIDE_MAX,
    FIT_PAD_PX: FIT_PAD_PX,
    FIT_MIN_SPAN_MM: FIT_MIN_SPAN_MM,
    SCALE_MIN: SCALE_MIN,
    SCALE_MAX: SCALE_MAX,
    POSE_MOVE_RANGE: POSE_MOVE_RANGE,
    POSE_ROT_RANGE: POSE_ROT_RANGE,
    POSE_SCALE_RANGE: POSE_SCALE_RANGE,
    hasDOM: hasDOM,
    detectTouchOnly: detectTouchOnly,
    detectFromWindow: detectFromWindow,
    shouldSplitLayout: shouldSplitLayout,
    orientationOf: orientationOf,
    clampFraction: clampFraction,
    paneSplit: paneSplit,
    extentOf: extentOf,
    fitSheetView: fitSheetView,
    preserveCenterTxTy: preserveCenterTxTy,
    createGestureTracker: createGestureTracker,
    poseRangeFor: poseRangeFor,
    snapPoseValue: snapPoseValue,
    clampPoseValue: clampPoseValue,
    splitActive: splitActive,
    clickSuppressed: clickSuppressed,
    shouldDesktopIgnore: shouldDesktopIgnore,
    flash: flash,
    mount: mount
  };
});

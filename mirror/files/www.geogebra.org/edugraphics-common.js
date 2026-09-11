(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduGraphicsCommon = factory();
    root.EduCADCommon = root.EduGraphicsCommon;
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduGraphics minimal container mount bridge. Dual-layer Canvas2D mount:
  // layer1 static + layer2 dynamic, 3 zoom buttons (zoom-in, zoom-out,
  // zoom-home), one 2-option menu (Plain (No Mesh), Box Mesh). Nothing else.
  // World mm only; px is ephemeral render only. Elev x equals plan x.
  // Dual-env: browser via window.EduGraphicsCommon, Node via module.exports.
  // Zero deps. Node-safe: without DOM a headless stub is returned.
  var WORLD_UNITS = 'mm';
  var VERSION = '7.0.0-educad';
  var LAYERS = ['layer1', 'layer2'];
  var BUTTONS = ['zoom-in', 'zoom-out', 'zoom-home'];
  var MENU_ITEMS = ['plain', 'mesh'];
  var MOUNT_CLASS = 'edugraphics-mount';
  var LAYER_CLASS = 'edugraphics-layer';
  var HUD_CLASS = 'edugraphics-hud';
  var BTN_CLASS = 'edugraphics-btn';
  var MENU_CLASS = 'edugraphics-menu';
  var MENU_ITEM_CLASS = 'edugraphics-menu-item';
  var BUTTON_LABELS = { 'zoom-in': '+', 'zoom-out': '-', 'zoom-home': 'Home' };
  var MENU_LABELS = { plain: 'Plain (No Mesh)', mesh: 'Box Mesh' };

  // Checked state per spec 4.4: Plain checked iff !showGrid, Mesh iff showGrid.
  function menuChecked(showGrid) {
    return { plain: !showGrid, mesh: !!showGrid };
  }

  // Reflect checked state onto a mounted handle's menu items (data-checked).
  // No-op for headless stubs; returns the applied state.
  function syncMenuChecked(handle, showGrid) {
    var st = menuChecked(showGrid);
    if (handle && !handle.headless && handle.menuItems) {
      for (var i = 0; i < MENU_ITEMS.length; i++) {
        var el = handle.menuItems[MENU_ITEMS[i]];
        if (el && typeof el.setAttribute === 'function') {
          el.setAttribute('data-checked', st[MENU_ITEMS[i]] ? 'true' : 'false');
        }
      }
    }
    return st;
  }

  function hasDOM() {
    return (typeof document !== 'undefined') && !!document &&
      (typeof document.createElement === 'function');
  }

  // Device pixel ratio: explicit opt wins, else window.devicePixelRatio,
  // else 1. Node-safe (no window reference unless present).
  function resolveDpr(optsDpr) {
    if (optsDpr !== undefined && optsDpr !== null) {
      var o = Number(optsDpr);
      if (isFinite(o) && o >= 1) return o;
    }
    if (typeof window !== 'undefined' && window &&
        isFinite(Number(window.devicePixelRatio)) &&
        Number(window.devicePixelRatio) >= 1) {
      return Number(window.devicePixelRatio);
    }
    return 1;
  }

  // Backing-store size for crisp HiDPI linework: integer buffer scaled by
  // dpr, CSS box kept at CSS px. Pure (headless-testable).
  function hidpiBufferSize(w, h, dpr) {
    var cw = toIntSize(w, 800);
    var ch = toIntSize(h, 600);
    var r = (dpr === undefined || dpr === null) ? 1 : Number(dpr);
    if (!isFinite(r) || r < 1) r = 1;
    return {
      cssW: cw, cssH: ch, dpr: r,
      bufW: Math.max(1, Math.round(cw * r)),
      bufH: Math.max(1, Math.round(ch * r))
    };
  }

  // Size one canvas element: buffer = css * dpr, style box = css px, and
  // the 2d context pre-scaled so drawing code keeps using CSS px.
  function sizeCanvasForDpr(c, size) {
    c.width = size.bufW;
    c.height = size.bufH;
    if (c.style) {
      c.style.width = size.cssW + 'px';
      c.style.height = size.cssH + 'px';
    }
    try {
      if (typeof c.getContext === 'function') {
        var ctx = c.getContext('2d');
        if (ctx && typeof ctx.setTransform === 'function') {
          ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
        }
      }
    } catch (e) { /* headless/mock DOM: sizing stands without ctx */ }
    return c;
  }

  function toIntSize(v, fallback) {
    if (v === undefined || v === null) v = fallback;
    if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
      throw new Error('NaN guard: expected finite number, got ' + String(v));
    }
    var r = Math.round(v);
    return r < 1 ? 1 : r;
  }

  function headlessStub(w, h) {
    return {
      headless: true, container: null,
      layers: LAYERS.slice(), buttons: BUTTONS.slice(), menu: MENU_ITEMS.slice(),
      w: w, h: h, mounted: true
    };
  }

  // Mount into container (DOM node). opts {w,h}. Returns a handle.
  // Without DOM, or when container is null, returns a headless stub.
  function mountContainer(container, opts) {
    opts = opts || {};
    var w = toIntSize(opts.w, 800);
    var h = toIntSize(opts.h, 600);
    if (!hasDOM() || container === null || container === undefined) {
      return headlessStub(w, h);
    }
    if (typeof container.appendChild !== 'function') {
      return headlessStub(w, h);
    }
    function mk(tag, cls) {
      var n = document.createElement(tag);
      n.className = cls;
      return n;
    }
    var px = hidpiBufferSize(w, h, resolveDpr(opts.dpr));
    var c1 = sizeCanvasForDpr(mk('canvas', LAYER_CLASS + ' edugraphics-layer1'), px);
    c1.setAttribute('data-layer', 'layer1');
    var c2 = sizeCanvasForDpr(mk('canvas', LAYER_CLASS + ' edugraphics-layer2'), px);
    c2.setAttribute('data-layer', 'layer2');
    container.appendChild(c1);
    container.appendChild(c2);
    var hud = mk('div', HUD_CLASS);
    var btnMap = {};
    for (var i = 0; i < BUTTONS.length; i++) {
      var id = BUTTONS[i];
      var b = mk('button', BTN_CLASS);
      b.setAttribute('data-btn', id);
      b.textContent = BUTTON_LABELS[id];
      hud.appendChild(b);
      btnMap[id] = b;
    }
    container.appendChild(hud);
    var menu = mk('div', MENU_CLASS);
    var menuMap = {};
    for (var j = 0; j < MENU_ITEMS.length; j++) {
      var mid = MENU_ITEMS[j];
      var mi = mk('div', MENU_ITEM_CLASS);
      mi.setAttribute('data-menu', mid);
      mi.setAttribute('data-checked', mid === 'plain' ? 'true' : 'false');
      mi.textContent = MENU_LABELS[mid];
      menu.appendChild(mi);
      menuMap[mid] = mi;
    }
    container.appendChild(menu);
    return {
      headless: false, container: container,
      layer1: c1, layer2: c2, hud: hud, buttons: btnMap, menu: menu,
      menuItems: menuMap, w: w, h: h, mounted: true,
      dpr: px.dpr, bufW: px.bufW, bufH: px.bufH
    };
  }

  function rmNode(n) {
    if (n && n.parentNode && typeof n.parentNode.removeChild === 'function') {
      n.parentNode.removeChild(n);
    }
  }

  // Idempotent unmount: safe to call twice.
  function unmountContainer(handle) {
    if (!handle || typeof handle !== 'object') return null;
    if (handle.headless) {
      handle.mounted = false;
      return handle;
    }
    if (handle.mounted === false) return handle;
    rmNode(handle.layer1);
    rmNode(handle.layer2);
    rmNode(handle.hud);
    rmNode(handle.menu);
    handle.mounted = false;
    return handle;
  }

  function isMounted(handle) {
    return !!handle && handle.mounted === true;
  }

  return {
    WORLD_UNITS: WORLD_UNITS, VERSION: VERSION,
    LAYERS: LAYERS, BUTTONS: BUTTONS, MENU_ITEMS: MENU_ITEMS,
    MENU_LABELS: MENU_LABELS, menuChecked: menuChecked,
    syncMenuChecked: syncMenuChecked,
    MOUNT_CLASS: MOUNT_CLASS, LAYER_CLASS: LAYER_CLASS,
    HUD_CLASS: HUD_CLASS, BTN_CLASS: BTN_CLASS,
    MENU_CLASS: MENU_CLASS, MENU_ITEM_CLASS: MENU_ITEM_CLASS,
    hasDOM: hasDOM,
    resolveDpr: resolveDpr,
    hidpiBufferSize: hidpiBufferSize,
    sizeCanvasForDpr: sizeCanvasForDpr,
    mountContainer: mountContainer,
    unmountContainer: unmountContainer,
    isMounted: isMounted
  };
});

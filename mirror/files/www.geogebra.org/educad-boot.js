(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADBoot = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD Phase 7 cold boot + lifecycle. Wires viewport, canvas, entities,
  // shim, solver, snapping, instruments, curriculum, labels from injected
  // deps or window globals. Owns no deps. init is O(1) wiring only (no lesson
  // build) so cold boot stays under 3 ms. World mm only; px is ephemeral
  // render only. Elev x equals plan x. Node-safe: DOM is touched only via
  // the common mount bridge when a container is passed.
  var WORLD_UNITS = 'mm';
  var VERSION = '7.0.0-educad';
  var BOOT_BUDGET_MS = 3;
  var BUNDLE_BUDGET_KB = 80;
  var HEAP_BUDGET_MB = 35;
  var VERTICAL_EPS = 1e-9;
  var DEFAULT_W = 800;
  var DEFAULT_H = 600;
  var MODULE_FILES = [
    'educad-viewport.js', 'educad-canvas.js', 'educad-entities.js',
    'educad-shim.js', 'educad-solver.js', 'edugraphics-snapping.js',
    'edugraphics-instruments.js', 'educad-curriculum.js',
    'educad-labels.js', 'edugraphics-common.js', 'educad-boot.js'
  ];
  var MODULE_NAMES = [
    'viewport', 'canvas', 'entities', 'shim', 'solver',
    'snapping', 'instruments', 'curriculum', 'labels', 'common'
  ];

  function getGlobal(name) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) {
      return globalThis[name];
    }
    if (typeof window !== 'undefined' && window[name]) return window[name];
    return null;
  }

  function pick(explicit, names) {
    if (explicit !== undefined && explicit !== null) return explicit;
    if (typeof names === 'string') names = [names];
    for (var i = 0; i < names.length; i++) {
      var g = getGlobal(names[i]);
      if (g) return g;
    }
    return null;
  }

  function toInt(v, fallback) {
    if (v === undefined || v === null) v = fallback;
    if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
      throw new Error('NaN guard: expected finite number, got ' + String(v));
    }
    var r = Math.round(v);
    return r < 1 ? 1 : r;
  }

  function nowMs() {
    if (typeof performance !== 'undefined' && performance &&
        typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  function newTable(E) {
    if (E && typeof E.createTable === 'function') return E.createTable();
    if (E && typeof E.CadEntityTable === 'function') {
      return new E.CadEntityTable();
    }
    throw new Error('educad-boot: entities module has no table factory');
  }

  // init(opts): opts may carry {viewport, canvas, entities, shim, solver,
  // snapping, instruments, curriculum, labels, common, container, w, h}.
  // Core trio (viewport, canvas, entities) is required; rest is optional.
  function init(opts) {
    opts = opts || {};
    var V = pick(opts.viewport, 'EduCADViewport');
    var Cv = pick(opts.canvas, 'EduCADCanvas');
    var E = pick(opts.entities, 'EduCADEntities');
    if (!V) throw new Error('educad-boot: viewport module missing');
    if (!Cv) throw new Error('educad-boot: canvas module missing');
    if (!E) throw new Error('educad-boot: entities module missing');
    var Shim = pick(opts.shim, ['EduCadGgbShim', 'ggbApplet']);
    var Solver = pick(opts.solver, 'EduCADSolver');
    var Snap = pick(opts.snapping, ['EduGraphicsSnapping', 'EduCADSnapping']);
    var Instr = pick(opts.instruments,
      ['EduGraphicsInstruments', 'EduCADInstruments']);
    var Curr = pick(opts.curriculum, 'EduCADCurriculum');
    var Labels = pick(opts.labels, 'EduCADLabels');
    var Common = pick(opts.common, ['EduGraphicsCommon', 'EduCADCommon']);
    var w = toInt(opts.w, DEFAULT_W);
    var h = toInt(opts.h, DEFAULT_H);
    var s0 = (typeof V.DEFAULT_SCALE === 'number') ? V.DEFAULT_SCALE : 2.0;
    var view = V.createViewport({ s: s0, tx: w / 2, ty: h / 2, w: w, h: h });
    var canvasState = Cv.createCanvasState({ w: w, h: h });
    var table = newTable(E);
    var applet = null;
    var solverHandle = null;
    var ruler = null;
    var compass = null;
    if (Shim && typeof Shim.createApplet === 'function') {
      applet = Shim.createApplet({ entities: E, viewport: V });
    }
    if (Solver && typeof Solver.createSolver === 'function') {
      solverHandle = Solver.createSolver();
    }
    if (Instr) {
      if (typeof Instr.createRuler === 'function') ruler = Instr.createRuler();
      if (typeof Instr.createCompass === 'function') {
        compass = Instr.createCompass();
      }
    }
    var mount = null;
    if (opts.container !== undefined && opts.container !== null) {
      if (!Common) {
        throw new Error('educad-boot: common module missing for mount');
      }
      mount = Common.mountContainer(opts.container, { w: w, h: h });
    }
    return {
      modules: {
        viewport: V, canvas: Cv, entities: E, shim: Shim, solver: Solver,
        snapping: Snap, instruments: Instr, curriculum: Curr, labels: Labels,
        common: Common
      },
      view: view, canvasState: canvasState, table: table,
      applet: applet, solverHandle: solverHandle,
      ruler: ruler, compass: compass, snapCurrent: null,
      mount: mount, w: w, h: h, booted: true, disposed: false
    };
  }

  // dispose(handle): clears the table, unmounts, marks disposed. Idempotent.
  function dispose(handle) {
    if (!handle || typeof handle !== 'object') {
      throw new Error('educad-boot: dispose needs a boot handle');
    }
    if (handle.disposed) return handle;
    try {
      if (handle.table && typeof handle.table.clear === 'function') {
        handle.table.clear();
      }
    } catch (e) { /* clear faults never break dispose */ }
    try {
      var C = handle.modules && handle.modules.common;
      if (handle.mount && C && typeof C.unmountContainer === 'function') {
        C.unmountContainer(handle.mount);
      }
    } catch (e2) { /* unmount faults never break dispose */ }
    handle.mount = null;
    handle.disposed = true;
    return handle;
  }

  function statusOf(handle) {
    if (!handle || typeof handle !== 'object') {
      throw new Error('educad-boot: statusOf needs a boot handle');
    }
    var n = 0;
    if (handle.table && typeof handle.table.count === 'function') {
      n = handle.table.count();
    }
    return {
      booted: !!handle.booted, disposed: !!handle.disposed, entities: n,
      mounted: !!(handle.mount && handle.mount.mounted)
    };
  }

  // Time one headless init+dispose cycle in ms.
  function coldBootMs(opts) {
    var t0 = nowMs();
    var h = init(opts);
    dispose(h);
    var t1 = nowMs();
    return t1 - t0;
  }

  // Projector invariant: elevation x equals plan x (mm).
  function checkProjector(planMm, elevMm, eps) {
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  return {
    WORLD_UNITS: WORLD_UNITS, VERSION: VERSION,
    BOOT_BUDGET_MS: BOOT_BUDGET_MS,
    BUNDLE_BUDGET_KB: BUNDLE_BUDGET_KB, HEAP_BUDGET_MB: HEAP_BUDGET_MB,
    VERTICAL_EPS: VERTICAL_EPS,
    DEFAULT_W: DEFAULT_W, DEFAULT_H: DEFAULT_H,
    MODULE_FILES: MODULE_FILES, MODULE_NAMES: MODULE_NAMES,
    init: init, dispose: dispose, statusOf: statusOf,
    coldBootMs: coldBootMs, checkProjector: checkProjector
  };
});

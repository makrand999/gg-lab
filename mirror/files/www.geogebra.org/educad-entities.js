(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADEntities = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // World coordinates in mm only inside entities and solvers.
  // Screen px is ephemeral render only (never stored on entities).
  // Projector invariant: elevation x equals plan x (mm).
  var WORLD_UNITS = 'mm';
  var VERTICAL_EPS = 1e-9;
  var COINCIDENT_TOL_MM = 1e-6;
  var RADIUS_MIN_MM = 0.01;

  var ENTITY_TYPES = ['POINT', 'SEGMENT', 'LINE', 'RAY', 'CIRCLE', 'CIRCULAR_ARC', 'DIMENSION', 'TEXT', 'DATUM_AXIS'];
  var VIEW_ROLES = ['PLAN', 'ELEVATION', 'BOTH'];
  var BIS_CODES = ['A', 'B', 'E', 'G', 'H', 'K'];
  var LAYER_STATIC = 'layer1';
  var LAYER_DYNAMIC = 'layer2';

  // BIS SP 46 pipeline: pattern + width in mm. Dash arrays in mm.
  var BIS_STYLES = {
    A: { code: 'A', pattern: 'solid', dashMm: [], widthMm: 0.50, width: 'thick', use: 'visible outlines and edges' },
    B: { code: 'B', pattern: 'solid', dashMm: [], widthMm: 0.20, width: 'thin', use: 'dimension extension hatching leaders' },
    E: { code: 'E', pattern: 'dash', dashMm: [8, 4], widthMm: 0.35, width: 'thin', use: 'hidden outlines and edges' },
    G: { code: 'G', pattern: 'chain', dashMm: [12, 3, 2, 3], widthMm: 0.20, width: 'thin', use: 'centre lines axes pitch lines' },
    H: { code: 'H', pattern: 'chain', dashMm: [12, 3, 2, 3], widthMm: 0.20, width: 'thin', thickEnds: true, endWidthMm: 0.50, use: 'cutting planes special requirements' },
    K: { code: 'K', pattern: 'chain-double-dot', dashMm: [12, 3, 2, 3, 2, 3], widthMm: 0.20, width: 'thin', use: 'adjacent parts alternate positions centroids' }
  };

  // Dimension arrowheads: 3-to-1, 3.5mm long x 1.167mm wide; outward flip under 30px.
  var ARROW_LEN_MM = 3.5;
  var ARROW_WIDTH_MM = 1.167;
  var ARROW_RATIO = 3;
  var ARROW_FLIP_PX = 30;

  var _idCounter = 0;

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function resetIdCounter() { _idCounter = 0; }

  function nextId() {
    _idCounter += 1;
    return 'E' + _idCounter;
  }

  function isValidType(t) { return ENTITY_TYPES.indexOf(t) !== -1; }
  function isValidBis(code) { return BIS_CODES.indexOf(code) !== -1; }
  function isValidViewRole(r) { return VIEW_ROLES.indexOf(r) !== -1; }

  function clampRadius(rMm) {
    assertFinite(rMm);
    return rMm < RADIUS_MIN_MM ? RADIUS_MIN_MM : rMm;
  }

  // CadEntity: mm-only storage. Never stores px.
  function createEntity(type, opts) {
    opts = opts || {};
    if (!isValidType(type)) throw new Error('unknown entity type: ' + String(type));
    var bis = (opts.bisCode === undefined) ? 'B' : opts.bisCode;
    if (!isValidBis(bis)) throw new Error('unknown bisCode: ' + String(bis));
    var role = (opts.viewRole === undefined) ? 'BOTH' : opts.viewRole;
    if (!isValidViewRole(role)) throw new Error('unknown viewRole: ' + String(role));
    var x = (opts.x === undefined) ? 0 : opts.x;
    var y = (opts.y === undefined) ? 0 : opts.y;
    assertFinite(x, y);
    var x2 = (opts.x2 === undefined) ? 0 : opts.x2;
    var y2 = (opts.y2 === undefined) ? 0 : opts.y2;
    assertFinite(x2, y2);
    var radius = (opts.radius === undefined) ? 0 : opts.radius;
    assertFinite(radius);
    if (radius !== 0) radius = clampRadius(radius);
    var sa = (opts.startAngle === undefined) ? 0 : opts.startAngle;
    var ea = (opts.endAngle === undefined) ? 0 : opts.endAngle;
    assertFinite(sa, ea);
    var id = (opts.id === undefined || opts.id === null) ? nextId() : String(opts.id);
    if (id === '') throw new Error('entity id must be non-empty');
    var locked = (opts.locked === undefined) ? (type === 'DATUM_AXIS') : !!opts.locked;
    var thickness = (opts.thickness === undefined || opts.thickness === null) ? null : opts.thickness;
    if (thickness !== null) {
      assertFinite(thickness);
      if (thickness <= 0) throw new Error('thickness must be > 0');
    }
    return {
      id: id,
      name: (opts.name === undefined) ? id : String(opts.name),
      type: type,
      x: x, y: y, x2: x2, y2: y2,
      radius: radius,
      startAngle: sa, endAngle: ea,
      bisCode: bis,
      viewRole: role,
      visible: (opts.visible === undefined) ? true : !!opts.visible,
      locked: locked,
      layer: (opts.layer === undefined) ? LAYER_STATIC : String(opts.layer),
      color: (opts.color === undefined) ? null : opts.color,
      thickness: thickness,
      caption: (opts.caption === undefined) ? '' : String(opts.caption),
      showLabel: (opts.showLabel === undefined) ? false : !!opts.showLabel,
      meta: (opts.meta === undefined) ? {} : opts.meta
    };
  }

  function bisStyleFor(code) {
    if (!isValidBis(code)) throw new Error('unknown bisCode: ' + String(code));
    var s = BIS_STYLES[code];
    var out = { code: s.code, pattern: s.pattern, dashMm: s.dashMm.slice(), widthMm: s.widthMm, width: s.width, use: s.use };
    if (s.thickEnds) { out.thickEnds = true; out.endWidthMm = s.endWidthMm; }
    return out;
  }

  function dashMmFor(code) { return bisStyleFor(code).dashMm; }
  function widthMmFor(code) { return bisStyleFor(code).widthMm; }
  function patternFor(code) { return bisStyleFor(code).pattern; }

  // Resolve render style: entity.thickness overrides BIS width when set.
  function resolveStyle(entity) {
    var base = bisStyleFor(entity.bisCode);
    if (entity.thickness !== null && entity.thickness !== undefined) {
      assertFinite(entity.thickness);
      base.widthMm = entity.thickness;
    }
    return base;
  }

  function dashToPx(dashMm, scale) {
    assertFinite(scale);
    if (scale <= 0) throw new Error('scale must be > 0');
    var out = [];
    for (var i = 0; i < dashMm.length; i++) {
      assertFinite(dashMm[i]);
      out.push(dashMm[i] * scale);
    }
    return out;
  }

  function widthToPx(widthMm, scale) {
    assertFinite(widthMm, scale);
    if (scale <= 0) throw new Error('scale must be > 0');
    return widthMm * scale;
  }

  // Cosmetic screen weight: zoom-invariant so close vertices stay visible.
  // Thin (BIS B/G/H/K, 0.20 mm) renders 1 px; thick (A, 0.50 mm) and medium
  // (E, 0.35 mm, the series midpoint, breaking toward weight) render 2 px.
  // Physical mm widths apply only to print/export (widthToPx), never here.
  var COSMETIC_CUTOFF_MM = 0.35;

  function cosmeticWidthPx(widthMm) {
    assertFinite(widthMm);
    return widthMm >= COSMETIC_CUTOFF_MM ? 2 : 1;
  }

  // Cosmetic screen cadence: dash/gap lengths stay constant px at every
  // zoom (BIS SP 46 screen column: E [8,4], G/H [12,3,2,3],
  // K [12,3,2,3,2,3]). Scaled mm cadences are export-only (dashToPx).
  function cosmeticDashPx(dashMm) {
    if (!Array.isArray(dashMm)) throw new Error('dashMm must be an array');
    var out = [];
    for (var i = 0; i < dashMm.length; i++) {
      assertFinite(dashMm[i]);
      out.push(dashMm[i]);
    }
    return out;
  }

  function arrowheadMm() { return { lenMm: ARROW_LEN_MM, widthMm: ARROW_WIDTH_MM, ratio: ARROW_RATIO }; }

  // Outward flip when dimension screen length is under 30px.
  function arrowFlipNeeded(lenPx) {
    assertFinite(lenPx);
    return lenPx < ARROW_FLIP_PX;
  }

  function forwardPt(view, x, y) {
    assertFinite(view.s, view.tx, view.ty, x, y);
    return { x: x * view.s + view.tx, y: view.ty - y * view.s };
  }

  // Ephemeral px render job. Never mutates the entity (mm-only storage).
  function renderEntity(view, entity) {
    assertFinite(view.s, view.tx, view.ty);
    if (!isValidType(entity.type)) throw new Error('unknown entity type: ' + String(entity.type));
    var style = resolveStyle(entity);
    var p1 = forwardPt(view, entity.x, entity.y);
    var p2 = forwardPt(view, entity.x2, entity.y2);
    var dx = p2.x - p1.x, dy = p2.y - p1.y;
    var lenPx = Math.sqrt(dx * dx + dy * dy);
    var job = {
      id: entity.id, type: entity.type,
      p1Px: p1, p2Px: p2, lenPx: lenPx,
      dashPx: dashToPx(style.dashMm, view.s),
      widthPx: widthToPx(style.widthMm, view.s),
      pattern: style.pattern
    };
    if (entity.type === 'CIRCLE' || entity.type === 'CIRCULAR_ARC') {
      job.radiusPx = entity.radius * view.s;
      job.startAngle = entity.startAngle;
      job.endAngle = entity.endAngle;
    }
    if (entity.type === 'DIMENSION') {
      job.arrow = { lenMm: ARROW_LEN_MM, widthMm: ARROW_WIDTH_MM, flip: arrowFlipNeeded(lenPx) };
    }
    if (style.thickEnds) {
      job.thickEnds = true;
      job.endWidthPx = widthToPx(style.endWidthMm, view.s);
    }
    return job;
  }

  // Projector invariant: elevation x equals plan x (mm).
  function checkProjector(planMm, elevMm, eps) {
    assertFinite(planMm.x, planMm.y, elevMm.x, elevMm.y);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  function checkEntityProjector(planEntity, elevEntity, eps) {
    assertFinite(planEntity.x, elevEntity.x);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    return Math.abs(elevEntity.x - planEntity.x) <= e;
  }

  function CadEntityTable() {
    this._map = {};
    this._order = [];
  }

  CadEntityTable.prototype.add = function (entity) {
    if (!entity || typeof entity.id !== 'string' || entity.id === '') {
      throw new Error('entity must have a non-empty string id');
    }
    if (this._map[entity.id] !== undefined) throw new Error('duplicate entity id: ' + entity.id);
    if (!isValidType(entity.type)) throw new Error('unknown entity type: ' + String(entity.type));
    this._map[entity.id] = entity;
    this._order.push(entity.id);
    return entity;
  };

  CadEntityTable.prototype.create = function (type, opts) {
    var e = createEntity(type, opts);
    return this.add(e);
  };

  CadEntityTable.prototype.get = function (id) {
    return this._map[id] === undefined ? null : this._map[id];
  };

  CadEntityTable.prototype.has = function (id) { return this._map[id] !== undefined; };

  CadEntityTable.prototype.remove = function (id) {
    if (this._map[id] === undefined) return false;
    delete this._map[id];
    var idx = this._order.indexOf(id);
    if (idx !== -1) this._order.splice(idx, 1);
    return true;
  };

  CadEntityTable.prototype.count = function () { return this._order.length; };

  CadEntityTable.prototype.list = function () {
    var out = [];
    for (var i = 0; i < this._order.length; i++) out.push(this._map[this._order[i]]);
    return out;
  };
  CadEntityTable.prototype.getAll = CadEntityTable.prototype.list;

  CadEntityTable.prototype.clear = function () {
    this._map = {};
    this._order = [];
  };

  // Locked XY datum: locked entities reject x/y/x2/y2 changes.
  CadEntityTable.prototype.update = function (id, patch) {
    var e = this._map[id];
    if (e === undefined) throw new Error('unknown entity id: ' + String(id));
    patch = patch || {};
    var touchesXY = (patch.x !== undefined || patch.y !== undefined || patch.x2 !== undefined || patch.y2 !== undefined);
    if (e.locked && touchesXY) throw new Error('entity is locked (XY datum): ' + id);
    if (patch.type !== undefined && patch.type !== e.type) throw new Error('entity type is immutable');
    if (patch.id !== undefined && patch.id !== e.id) throw new Error('entity id is immutable');
    if (patch.bisCode !== undefined && !isValidBis(patch.bisCode)) throw new Error('unknown bisCode: ' + String(patch.bisCode));
    if (patch.viewRole !== undefined && !isValidViewRole(patch.viewRole)) throw new Error('unknown viewRole: ' + String(patch.viewRole));
    var numKeys = ['x', 'y', 'x2', 'y2', 'radius', 'startAngle', 'endAngle'];
    for (var i = 0; i < numKeys.length; i++) {
      var k = numKeys[i];
      if (patch[k] !== undefined) assertFinite(patch[k]);
    }
    if (patch.thickness !== undefined && patch.thickness !== null) {
      assertFinite(patch.thickness);
      if (patch.thickness <= 0) throw new Error('thickness must be > 0');
    }
    for (var key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && Object.prototype.hasOwnProperty.call(e, key)) {
        e[key] = patch[key];
      }
    }
    if (patch.radius !== undefined && e.radius !== 0) e.radius = clampRadius(e.radius);
    return e;
  };

  CadEntityTable.prototype.move = function (id, dxMm, dyMm) {
    var e = this._map[id];
    if (e === undefined) throw new Error('unknown entity id: ' + String(id));
    assertFinite(dxMm, dyMm);
    if (e.locked) throw new Error('entity is locked (XY datum): ' + id);
    e.x += dxMm; e.y += dyMm; e.x2 += dxMm; e.y2 += dyMm;
    return e;
  };

  CadEntityTable.prototype.lock = function (id) {
    var e = this._map[id];
    if (e === undefined) throw new Error('unknown entity id: ' + String(id));
    e.locked = true;
    return e;
  };

  CadEntityTable.prototype.unlock = function (id) {
    var e = this._map[id];
    if (e === undefined) throw new Error('unknown entity id: ' + String(id));
    e.locked = false;
    return e;
  };

  CadEntityTable.prototype.findByType = function (type) {
    return this.list().filter(function (e) { return e.type === type; });
  };

  CadEntityTable.prototype.findByBisCode = function (code) {
    return this.list().filter(function (e) { return e.bisCode === code; });
  };

  CadEntityTable.prototype.findByViewRole = function (role) {
    return this.list().filter(function (e) { return e.viewRole === role; });
  };

  CadEntityTable.prototype.findByLayer = function (layer) {
    return this.list().filter(function (e) { return e.layer === layer; });
  };

  CadEntityTable.prototype.visibleEntities = function () {
    return this.list().filter(function (e) { return e.visible; });
  };

  function createTable() { return new CadEntityTable(); }

  return {
    WORLD_UNITS: WORLD_UNITS,
    VERTICAL_EPS: VERTICAL_EPS,
    COINCIDENT_TOL_MM: COINCIDENT_TOL_MM,
    RADIUS_MIN_MM: RADIUS_MIN_MM,
    ENTITY_TYPES: ENTITY_TYPES, TYPES: ENTITY_TYPES,
    VIEW_ROLES: VIEW_ROLES,
    BIS_CODES: BIS_CODES,
    BIS_STYLES: BIS_STYLES,
    LAYER_STATIC: LAYER_STATIC, LAYER_DYNAMIC: LAYER_DYNAMIC,
    ARROW_LEN_MM: ARROW_LEN_MM, ARROW_LENGTH_MM: ARROW_LEN_MM,
    ARROW_WIDTH_MM: ARROW_WIDTH_MM, ARROW_W_MM: ARROW_WIDTH_MM,
    ARROW_RATIO: ARROW_RATIO, ARROW_FLIP_PX: ARROW_FLIP_PX,
    ARROW_FLIP_THRESHOLD_PX: ARROW_FLIP_PX,
    assertFinite: assertFinite,
    resetIdCounter: resetIdCounter, nextId: nextId,
    clampRadius: clampRadius,
    createEntity: createEntity, CadEntity: createEntity,
    CadEntityTable: CadEntityTable, createTable: createTable, createEntityTable: createTable,
    bisStyleFor: bisStyleFor, dashMmFor: dashMmFor, widthMmFor: widthMmFor, patternFor: patternFor,
    resolveStyle: resolveStyle, resolveEntityStyle: resolveStyle,
    dashToPx: dashToPx, widthToPx: widthToPx,
    cosmeticWidthPx: cosmeticWidthPx, COSMETIC_CUTOFF_MM: COSMETIC_CUTOFF_MM,
    cosmeticDashPx: cosmeticDashPx,
    arrowheadMm: arrowheadMm, arrowFlipNeeded: arrowFlipNeeded,
    renderEntity: renderEntity, renderJobFor: renderEntity, toRenderPx: renderEntity,
    checkProjector: checkProjector, checkEntityProjector: checkEntityProjector
  };
});

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADSettings = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD preferences: a tiny boolean store behind the sheet's Settings
  // panel. Sheet keys are boolean; inspection has its own typed defaults.
  // Zero dependencies. Dual-env: browser via window.EduCADSettings, plain
  // Node via module.exports. Node-safe: storage is injected, never global.
  //
  // Keys:
  //   commandPreview     show a live preview of what /<cmd> would do
  //   commandSuggestions show Minecraft-style completions while typing
  //   showDemos          demo picker visible and usable
  //   showTutorials      tutorial picker visible and usable
  //   commandHistory     Up/Down recalls past commands
  //   coordsHud          coordinate readout visible
  //   showLocusLines     Type K locus lines drawn on the sheet
  //   projectionGuides   centre axes and projection transfer guides
  //   solidPreview       show the linked 3D preview
  var VERSION = '1.0.0-educad';
  var STORAGE_KEY = 'educad_settings_v1';
  var DRAWING_MODES = ['menu', 'shortcuts'];
  function getDrawingMode(store) {
    checkStore(store);
    return DRAWING_MODES.indexOf(store.drawingMode) !== -1 ? store.drawingMode : 'menu';
  }
  function setDrawingMode(store, value) {
    checkStore(store);
    if (DRAWING_MODES.indexOf(value) === -1) throw new Error('educad-settings: invalid drawing method');
    store.drawingMode = value;
    return value;
  }

  var DEFAULTS = {
    commandPreview: true,
    commandSuggestions: true,
    showDemos: true,
    showTutorials: true,
    commandHistory: true,
    coordsHud: true,
    showLocusLines: true,
    projectionGuides: true,
    solidPreview: true
  };

  var KEYS = ['commandPreview', 'commandSuggestions', 'showDemos',
    'showTutorials', 'commandHistory', 'coordsHud', 'showLocusLines',
    'projectionGuides', 'solidPreview'];

  var LABELS = {
    commandPreview: 'Preview commands while typing',
    commandSuggestions: 'Suggest commands while typing',
    showDemos: 'Show demos',
    showTutorials: 'Show tutorials',
    commandHistory: 'Remember command history (Up/Down)',
    coordsHud: 'Show coordinate readout',
    showLocusLines: 'Show locus lines (L)',
    projectionGuides: 'Show projection guides',
    solidPreview: 'Show 3D preview'
  };

  var INSPECTION_FIELDS = {
    overlay: { label: 'Measurements on model', default: 'selected', options: ['selected', 'pinned', 'all'] },
    coordinates: { label: 'Point coordinates', default: true },
    planeDistances: { label: 'Distances to HP / VP', default: true },
    lengths: { label: 'True edge lengths', default: true },
    inclinations: { label: 'Edge inclinations to HP / VP', default: true },
    planes: { label: 'Reference planes (HP / VP)', default: true },
    guides: { label: 'Projection guides for selected / pinned points', default: true },
    labels: { label: 'Measurement labels on model', default: true },
    precision: { label: 'Decimal places', default: 2, options: [0, 1, 2, 3] },
    textSize: { label: 'Label size', default: 11, options: [11, 13, 15] }
  };
  var SHEET_INSPECTION_FIELDS = {
    overlay: { label: 'Measurements on sheet', default: 'selected', options: ['selected', 'pinned', 'all'] },
    view: { label: 'Views to inspect', default: 'all', options: ['all', 'elevation', 'plan', 'profile'] },
    points: { label: 'Points', default: true },
    lines: { label: 'Lines and dimensions', default: true },
    curves: { label: 'Circles and arcs', default: true },
    construction: { label: 'Include construction geometry', default: false },
    coordinates: { label: 'Coordinates and endpoints', default: true },
    offsets: { label: 'Distances from XY / side reference', default: true },
    lengths: { label: 'Projected lengths and component distances', default: true },
    angles: { label: 'Orientation and arc sweep', default: true },
    radii: { label: 'Radius and diameter', default: true },
    curveProperties: { label: 'Circumference, circle area and arc length', default: true },
    dimensions: { label: 'Dimension guides for selected / pinned items', default: true },
    links: { label: 'Highlight corresponding projections', default: true },
    labels: { label: 'Measurement labels on sheet', default: true },
    precision: { label: 'Decimal precision', default: 2, options: [0, 1, 2, 3] },
    textSize: { label: 'Label size', default: 11, options: [11, 13, 15] }
  };
  function validSheetInspectionValue(key, value) {
    if (!Object.prototype.hasOwnProperty.call(SHEET_INSPECTION_FIELDS, key)) return false;
    var field = SHEET_INSPECTION_FIELDS[key];
    return field.options ? field.options.indexOf(value) !== -1 : typeof value === 'boolean';
  }
  function normalizeSheetInspection(initial) {
    var out = {};
    Object.keys(SHEET_INSPECTION_FIELDS).forEach(function (key) {
      out[key] = initial && validSheetInspectionValue(key, initial[key]) ? initial[key] : SHEET_INSPECTION_FIELDS[key].default;
    });
    return out;
  }
  function getSheetInspection(store) { checkStore(store); return normalizeSheetInspection(store.sheetInspection); }
  function setSheetInspection(store, key, value) {
    checkStore(store);
    if (!validSheetInspectionValue(key, value)) throw new Error('educad-settings: invalid sheet inspection preference ' + key);
    store.sheetInspection = getSheetInspection(store); store.sheetInspection[key] = value;
    return value;
  }
  function validInspectionValue(key, value) {
    if (!Object.prototype.hasOwnProperty.call(INSPECTION_FIELDS, key)) return false;
    var field = INSPECTION_FIELDS[key];
    return !!field && (field.options ? field.options.indexOf(value) !== -1 : typeof value === 'boolean');
  }
  function normalizeInspection(initial) {
    var out = {};
    Object.keys(INSPECTION_FIELDS).forEach(function (key) {
      out[key] = initial && validInspectionValue(key, initial[key]) ? initial[key] : INSPECTION_FIELDS[key].default;
    });
    return out;
  }
  function getInspection(store) {
    checkStore(store);
    return normalizeInspection(store.inspection);
  }
  function setInspection(store, key, value) {
    checkStore(store);
    if (!validInspectionValue(key, value)) throw new Error('educad-settings: invalid inspection preference ' + key);
    store.inspection = getInspection(store);
    store.inspection[key] = value;
    return value;
  }

  function isValidKey(key) { return KEYS.indexOf(key) !== -1; }

  function checkStore(store) {
    if (!store || typeof store !== 'object' || !store.values ||
        typeof store.values !== 'object') {
      throw new Error('educad-settings: store needed');
    }
    return store;
  }

  function checkKey(key) {
    if (!isValidKey(key)) {
      throw new Error('educad-settings: unknown key ' + String(key));
    }
    return key;
  }

  function createStore(initial) {
    var values = {};
    for (var i = 0; i < KEYS.length; i++) values[KEYS[i]] = DEFAULTS[KEYS[i]];
    if (initial !== undefined && initial !== null) {
      if (typeof initial !== 'object') {
        throw new Error('educad-settings: initial must be an object');
      }
      var names = Object.keys(initial);
      for (var j = 0; j < names.length; j++) {
        checkKey(names[j]);
        if (typeof initial[names[j]] !== 'boolean') {
          throw new Error('educad-settings: ' + names[j] + ' must be boolean');
        }
        values[names[j]] = initial[names[j]];
      }
    }
    return { values: values, drawingMode: 'menu', inspection: normalizeInspection(), sheetInspection: normalizeSheetInspection() };
  }

  function get(store, key) {
    checkStore(store);
    checkKey(key);
    return store.values[key];
  }

  function set(store, key, value) {
    checkStore(store);
    checkKey(key);
    if (typeof value !== 'boolean') {
      throw new Error('educad-settings: ' + key + ' must be boolean');
    }
    store.values[key] = value;
    return value;
  }

  function toggle(store, key) {
    checkStore(store);
    checkKey(key);
    store.values[key] = !store.values[key];
    return store.values[key];
  }

  function reset(store) {
    checkStore(store);
    for (var i = 0; i < KEYS.length; i++) {
      store.values[KEYS[i]] = DEFAULTS[KEYS[i]];
    }
    store.inspection = normalizeInspection();
    store.sheetInspection = normalizeSheetInspection();
    store.drawingMode = 'menu';
    return store;
  }

  function serialize(store) {
    checkStore(store);
    var out = {};
    for (var i = 0; i < KEYS.length; i++) out[KEYS[i]] = !!store.values[KEYS[i]];
    out.inspection = getInspection(store);
    out.sheetInspection = getSheetInspection(store);
    out.drawingMode = getDrawingMode(store);
    return JSON.stringify(out);
  }

  // parse(text): tolerant reader. Bad JSON, missing keys, and non-boolean
  // values all fall back to defaults; unknown keys are ignored.
  function parse(text) {
    var store = createStore();
    if (typeof text !== 'string' || text === '') return store;
    var obj = null;
    try {
      obj = JSON.parse(text);
    } catch (err) {
      return store;
    }
    if (!obj || typeof obj !== 'object') return store;
    for (var i = 0; i < KEYS.length; i++) {
      if (typeof obj[KEYS[i]] === 'boolean') store.values[KEYS[i]] = obj[KEYS[i]];
    }
    store.inspection = normalizeInspection(obj.inspection);
    store.sheetInspection = normalizeSheetInspection(obj.sheetInspection);
    if (DRAWING_MODES.indexOf(obj.drawingMode) !== -1) store.drawingMode = obj.drawingMode;
    return store;
  }

  // load(storage): read from a localStorage-like {getItem}. Any failure
  // (missing storage, blocked access, corrupt value) yields defaults.
  function load(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') return createStore();
      return parse(storage.getItem(STORAGE_KEY));
    } catch (err) {
      return createStore();
    }
  }

  // save(storage, store): persist; returns true on success, false when the
  // write fails or storage is unusable. Never throws for storage faults.
  function save(storage, store) {
    checkStore(store);
    try {
      if (!storage || typeof storage.setItem !== 'function') return false;
      storage.setItem(STORAGE_KEY, serialize(store));
      return true;
    } catch (err) {
      return false;
    }
  }

  function labelFor(key) {
    checkKey(key);
    return LABELS[key];
  }

  return {
    VERSION: VERSION,
    STORAGE_KEY: STORAGE_KEY,
    DEFAULTS: DEFAULTS,
    KEYS: KEYS,
    LABELS: LABELS,
    DRAWING_MODES: DRAWING_MODES,
    getDrawingMode: getDrawingMode,
    setDrawingMode: setDrawingMode,
    INSPECTION_FIELDS: INSPECTION_FIELDS,
    normalizeInspection: normalizeInspection,
    getInspection: getInspection,
    setInspection: setInspection,
    SHEET_INSPECTION_FIELDS: SHEET_INSPECTION_FIELDS,
    normalizeSheetInspection: normalizeSheetInspection,
    getSheetInspection: getSheetInspection,
    setSheetInspection: setSheetInspection,
    isValidKey: isValidKey,
    createStore: createStore,
    get: get,
    set: set,
    toggle: toggle,
    reset: reset,
    serialize: serialize,
    parse: parse,
    load: load,
    save: save,
    labelFor: labelFor
  };
});

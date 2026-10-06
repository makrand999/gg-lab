(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADSettings = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD preferences: a tiny boolean store behind the sheet's Settings
  // panel. Every key is on/off, every default is true (full assistance).
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
    return { values: values };
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
    return store;
  }

  function serialize(store) {
    checkStore(store);
    var out = {};
    for (var i = 0; i < KEYS.length; i++) out[KEYS[i]] = !!store.values[KEYS[i]];
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

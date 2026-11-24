(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(typeof globalThis !== 'undefined' ? globalThis : null);
  } else {
    root.EduCADTheme = factory(root);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  var STORAGE_KEY = 'educad_appearance_v1';
  var doc = root && root.document ? root.document : null;
  var documentElement = doc ? doc.documentElement : null;
  var value = 'light';
  var listeners = [];

  var LIGHT = {
    ink: '#0f172a',
    inkSoft: '#1e293b',
    strong: '#334155',
    construction: '#475569',
    muted: '#64748b',
    faint: '#94a3b8',
    grid: '#e2e8f0',
    sampleLine: '#e2e8f0',
    accent: '#0284c7',
    accentAlt: '#06b6d4',
    select: '#f59e0b',
    warm: '#b45309',
    warmStrong: '#b7793a',
    draftingLine: '#58738c',
    viewMuted: '#7d8997',
    viewInspect: '#415c74',
    viewGuide: '#8a9dad',
    viewFrame: '#a8b8c7',
    spatialHpLabel: '#817a6c',
    spatialVpLabel: '#718399',
    spatialHpGuide: '#9a8c72',
    spatialVpGuide: '#7a91ab',
    spatialMarkFill: '#f8fafc',
    spatialHpFill: 'rgba(160, 147, 120, 0.065)',
    spatialHpStroke: 'rgba(142, 132, 110, 0.22)',
    spatialVpFill: 'rgba(120, 148, 175, 0.065)',
    spatialVpStroke: 'rgba(116, 140, 162, 0.22)',
    spatialFrame: 'rgba(90, 105, 123, 0.5)',
    spatialLeader: 'rgba(138, 157, 173, 0.45)',
    spatialLabelBg: 'rgba(248, 250, 252, 0.96)',
    viewLabelBg: 'rgba(248, 250, 252, 0.97)',
    labelHalo: 'rgba(248, 250, 252, 0.95)',
    labelFill: '#0f172a',
    labelLeader: '#475569',
    solidLine: '#1e293b',
    solidVertex: '#0f172a',
    solidSection: '#a64d0f'
  };

  var DARK = {
    ink: '#e8f0f9',
    inkSoft: '#dbe7f2',
    strong: '#c6d6e5',
    construction: '#9fb3c8',
    muted: '#8ea1b4',
    faint: '#7f93a8',
    grid: '#1f2b38',
    sampleLine: '#e2e8f0',
    accent: '#74ccff',
    accentAlt: '#5fd4e8',
    select: '#ffc857',
    warm: '#f7c96b',
    warmStrong: '#e0a35e',
    draftingLine: '#8fb6d9',
    viewMuted: '#a9bacb',
    viewInspect: '#d7e8f8',
    viewGuide: '#7d96ad',
    viewFrame: '#385064',
    spatialHpLabel: '#d8c08c',
    spatialVpLabel: '#8fb6d9',
    spatialHpGuide: '#c9ab78',
    spatialVpGuide: '#8fb6d9',
    spatialMarkFill: '#081018',
    spatialHpFill: 'rgba(214, 190, 140, 0.075)',
    spatialHpStroke: 'rgba(214, 190, 140, 0.3)',
    spatialVpFill: 'rgba(130, 175, 215, 0.075)',
    spatialVpStroke: 'rgba(130, 175, 215, 0.3)',
    spatialFrame: 'rgba(160, 190, 215, 0.5)',
    spatialLeader: 'rgba(126, 153, 176, 0.55)',
    spatialLabelBg: 'rgba(3, 9, 15, 0.94)',
    viewLabelBg: 'rgba(3, 9, 15, 0.94)',
    labelHalo: 'rgba(2, 7, 12, 0.92)',
    labelFill: '#eef5fc',
    labelLeader: '#9fb3c8',
    solidLine: '#e2ecf7',
    solidVertex: '#f2f7ff',
    solidSection: '#ffb36b'
  };

  var LIGHT_FACES = { hue: 349, sat: 46, base: 82, range: 13 };
  var DARK_FACES = { hue: 205, sat: 26, base: 17, range: 15 };

  function normalize(next) {
    return next === 'dark' ? 'dark' : 'light';
  }

  function palette() {
    return value === 'dark' ? DARK : LIGHT;
  }

  function color(name, fallback) {
    var table = palette();
    if (Object.prototype.hasOwnProperty.call(table, name)) return table[name];
    return fallback === undefined ? name : fallback;
  }

  function faceShading() {
    return value === 'dark' ? DARK_FACES : LIGHT_FACES;
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    return function () {
      var index = listeners.indexOf(fn);
      if (index !== -1) listeners.splice(index, 1);
    };
  }

  function notify(previous) {
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](value, previous);
      } catch (err) {}
    }
  }

  function readPreference() {
    try {
      return normalize(root.localStorage.getItem(STORAGE_KEY));
    } catch (err) {
      return 'light';
    }
  }

  function syncControls() {
    if (!doc) return;
    var group = doc.getElementById('settings-appearance');
    if (!group) return;
    var buttons = group.querySelectorAll('[data-appearance]');
    for (var i = 0; i < buttons.length; i++) {
      var pressed = buttons[i].getAttribute('data-appearance') === value;
      buttons[i].setAttribute('aria-pressed', pressed ? 'true' : 'false');
    }
  }

  function apply(next, persist) {
    var previous = value;
    value = normalize(next);
    if (documentElement) {
      documentElement.setAttribute('data-educad-theme', value);
    }
    if (persist) {
      try {
        root.localStorage.setItem(STORAGE_KEY, value);
      } catch (err) {}
    }
    syncControls();
    if (previous !== value) {
      notify(previous);
    }
    return value;
  }

  function init() {
    if (!doc) return;
    var group = doc.getElementById('settings-appearance');
    if (group) {
      group.addEventListener('click', function (event) {
        var target = event.target;
        var button = target && typeof target.closest === 'function' ?
          target.closest('[data-appearance]') : null;
        if (!button || !group.contains(button)) return;
        apply(button.getAttribute('data-appearance'), true);
      });
    }
    var reset = doc.getElementById('settings-reset');
    if (reset) reset.addEventListener('click', function () {
      apply('light', true);
    });
    syncControls();
  }

  apply(readPreference(), false);

  if (root && typeof root.addEventListener === 'function') {
    root.addEventListener('storage', function (event) {
      if (event.key === STORAGE_KEY) apply(normalize(event.newValue), false);
    });
  }

  if (doc && doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    color: color,
    faceShading: faceShading,
    onChange: onChange
  };
});

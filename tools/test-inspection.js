'use strict';
const assert = require('node:assert/strict');
const Settings = require('../public/lib/educad-settings.js');
const Spatial = require('../public/lib/educad-spatial.js');
const Solid = require('../public/lib/educad-solid.js');
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS ' + name); }
const geometry = Solid.createGeometry({
  vertices: [{ x: 0, y: -30, z: -20 }, { x: 30, y: 10, z: -20 }, { x: 60, y: 10, z: 30 }],
  edges: [[0, 1], [1, 2]], faces: []
});
const point = { kind: 'point', index: 0 }, edge = { kind: 'edge', index: 0 };
const defaults = Settings.normalizeInspection();

check('old settings migrate to quiet inspection defaults', () => {
  const store = Settings.parse('{"coordsHud":false}');
  assert.equal(store.values.coordsHud, false);
  assert.deepEqual(Settings.getInspection(store), defaults);
  assert.equal(defaults.overlay, 'selected');
});
check('inspection preferences round-trip independently of sheet flags', () => {
  const store = Settings.createStore({ solidPreview: false });
  Settings.setInspection(store, 'overlay', 'all');
  Settings.setInspection(store, 'precision', 3);
  Settings.setInspection(store, 'planes', false);
  const loaded = Settings.parse(Settings.serialize(store));
  assert.deepEqual(Settings.getInspection(loaded), Settings.getInspection(store));
  assert.equal(loaded.values.solidPreview, false);
  const copy = Settings.getInspection(loaded); copy.overlay = 'selected';
  assert.equal(Settings.getInspection(loaded).overlay, 'all');
  Settings.reset(loaded);
  assert.deepEqual(Settings.getInspection(loaded), defaults);
});
check('corrupt preferences and blocked storage fall back safely', () => {
  const store = Settings.parse('{"inspection":{"overlay":"everything","precision":99,"lengths":false,"textSize":"huge"}}');
  assert.equal(Settings.getInspection(store).overlay, 'selected');
  assert.equal(Settings.getInspection(store).precision, 2);
  assert.equal(Settings.getInspection(store).lengths, false);
  assert.equal(Settings.getInspection(store).textSize, 11);
  assert.throws(() => Settings.setInspection(store, 'precision', '2'));
  assert.throws(() => Settings.setInspection(store, '__proto__', true));
  assert.deepEqual(Settings.getInspection(Settings.load({ getItem() { throw Error('blocked'); } })), defaults);
});
check('pins toggle independently and never modify selected items', () => {
  let pins = Spatial.togglePin([], point);
  pins = Spatial.togglePin(pins, edge);
  assert.deepEqual(pins, [point, edge]);
  assert.deepEqual(Spatial.togglePin(pins, point), [edge]);
  point.index = 2;
  assert.equal(pins[0].index, 0);
  point.index = 0;
});
check('scope preserves active selection and deduplicates pins', () => {
  assert.deepEqual(Spatial.inspectionItems(geometry, point, [edge], defaults), [point]);
  assert.deepEqual(Spatial.inspectionItems(geometry, point, [point, edge], { ...defaults, overlay: 'pinned' }), [point, edge]);
  assert.deepEqual(Spatial.inspectionItems(geometry, null, [point, edge], { ...defaults, overlay: 'pinned' }), [point, edge]);
  assert.deepEqual(Spatial.inspectionItems(null, point, [edge], defaults), []);
  assert.deepEqual(Spatial.inspectionItems(geometry, { kind: 'point', index: 99 }, [], defaults), []);
});
check('all scope includes enabled measurement categories only', () => {
  const all = { ...defaults, overlay: 'all' };
  assert.equal(Spatial.inspectionItems(geometry, null, [], all).length, 5);
  assert.deepEqual(Spatial.inspectionItems(geometry, null, [], { ...all, coordinates: false, planeDistances: false }), [edge, { kind: 'edge', index: 1 }]);
  assert.deepEqual(Spatial.inspectionItems(geometry, null, [], { ...all, coordinates: false, planeDistances: false, lengths: false, inclinations: false }), []);
});
check('readouts preserve signed plane relations and true 3D lengths', () => {
  assert.deepEqual(Spatial.measurementRows(geometry, point, defaults), [
    ['X / Y / Z', '0 / -30 / -20 mm'], ['HP', '30 mm below'], ['VP', '20 mm behind']
  ]);
  assert.equal(Spatial.measurementRows(geometry, edge, defaults)[0][1], '50 mm');
  assert.deepEqual(Spatial.measurementRows(geometry, edge, { ...defaults, lengths: false, inclinations: false }), []);
  const rows = Spatial.measurementRows(geometry, edge, { ...defaults, precision: 0 });
  assert.equal(rows[1][1], '53°');
});
check('degenerate edges have no invented inclinations', () => {
  const g = { vertices: [{ x: 0, y: 0, z: 0 }], edges: [[0, 0]] };
  assert.deepEqual(Spatial.measurementRows(g, edge, defaults), [
    ['True length', '0 mm'], ['Inclination to HP', '—'], ['Inclination to VP', '—']
  ]);
});
check('labels avoid collisions, viewport edges, and panel coverage', () => {
  const occupied = [{ x0: 0, y0: 0, x1: 150, y1: 300 }];
  const viewport = { w: 600, h: 400 };
  const first = Spatial.placeLabel({ x: 250, y: 150 }, ['P1', '30 mm'], s => s.length * 7, defaults, viewport, occupied);
  const second = Spatial.placeLabel({ x: 250, y: 150 }, ['P2', '40 mm'], s => s.length * 7, defaults, viewport, occupied);
  assert.ok(first && second);
  assert.ok(first.rect.y1 <= second.rect.y0 || second.rect.y1 <= first.rect.y0 || first.rect.x1 <= second.rect.x0 || second.rect.x1 <= first.rect.x0);
  assert.equal(Spatial.placeLabel({ x: -100, y: -100 }, ['P1'], s => s.length * 7, defaults, viewport, []), null);
  assert.equal(Spatial.placeLabel({ x: 250, y: 150 }, ['P1'], s => s.length * 7, defaults, viewport, [{ x0: 0, y0: 0, x1: 600, y1: 400 }]), null);
});
check('all overlays keep guides focused and do not mutate geometry', () => {
  const before = JSON.stringify(geometry);
  const st = Solid.createGlassState({ w: 1280, h: 800 });
  Solid.setGeometry(st, geometry);
  const refs = Spatial.references(geometry), measure = s => s.length * 6;
  const prefs = { ...defaults, overlay: 'all', planes: false };
  const layout = Spatial.overlayLayout(st, Solid, refs, point, [edge], prefs, measure, []);
  assert.ok(layout.labels.some(label => label.lines[0].includes('50 mm')));
  assert.equal(layout.guides.length, 0);
  assert.equal(layout.marks.length, 2);
  const guided = Spatial.overlayLayout(st, Solid, refs, point, [edge], { ...prefs, planes: true }, measure, []);
  assert.equal(guided.guides.length, 2);
  const hidden = Spatial.overlayLayout(st, Solid, refs, point, [], { ...prefs, labels: false }, measure, []);
  assert.equal(hidden.labels.length, 0);
  assert.equal(hidden.marks.length, 1);
  assert.equal(JSON.stringify(geometry), before);
});
console.log('OK ' + checks + ' inspection checks passed');

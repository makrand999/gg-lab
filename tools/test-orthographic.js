'use strict';
const assert = require('node:assert/strict');
const O = require('../public/lib/educad-orthographic.js');
const Settings = require('../public/lib/educad-settings.js');
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS ' + name); }
const defaults = Settings.normalizeSheetInspection();
const a = { id: 'a', type: 'POINT', caption: "a'", x: 0, y: 10, viewRole: 'ELEVATION' };
const b = { id: 'b', type: 'POINT', caption: "b'", x: 30, y: 50, viewRole: 'ELEVATION' };
const top = { id: 'top', type: 'POINT', caption: 'a', x: 0, y: -20, viewRole: 'PLAN' };
const edge = { id: 'edge', type: 'SEGMENT', x: 0, y: 10, x2: 30, y2: 50, viewRole: 'ELEVATION', meta: { endpointRefs: ['a', 'b'] } };
const circle = { id: 'circle', type: 'CIRCLE', x: 50, y: -30, radius: 10, viewRole: 'PLAN' };
const arc = { id: 'arc', type: 'CIRCULAR_ARC', x: 0, y: 20, radius: 10, startAngle: 350, endAngle: 80, viewRole: 'ELEVATION' };
const entities = [a, b, top, edge, circle, arc];
function rows(e, prefs, map) { return Object.fromEntries(O.specs(e, entities, prefs, map).rows); }
check('2D preferences migrate, round-trip, reset and remain independent from 3D', () => {
  const store = Settings.parse('{"inspection":{"overlay":"all"}}');
  assert.deepEqual(Settings.getSheetInspection(store), defaults);
  assert.equal(defaults.overlay, 'selected'); assert.equal(defaults.construction, false);
  Settings.setSheetInspection(store, 'overlay', 'pinned'); Settings.setSheetInspection(store, 'precision', 3);
  Settings.setSheetInspection(store, 'view', 'profile'); Settings.setSheetInspection(store, 'links', false);
  const roundTrip = Settings.parse(Settings.serialize(store));
  assert.deepEqual(Settings.getSheetInspection(roundTrip), Settings.getSheetInspection(store));
  assert.equal(Settings.getInspection(roundTrip).overlay, 'all');
  assert.throws(() => Settings.setSheetInspection(store, '__proto__', true));
  assert.throws(() => Settings.setSheetInspection(store, 'view', 'sideways'));
  assert.equal(Settings.getSheetInspection(Settings.parse('{"sheetInspection":{"precision":99}}')).precision, 2);
  Settings.reset(roundTrip); assert.deepEqual(Settings.getSheetInspection(roundTrip), defaults);
});
check('explicit orthographic roles take precedence over sheet position', () => {
  assert.equal(O.role({ ...top, y: 20 }), 'PLAN');
  assert.equal(O.role({ ...a, y: -20 }), 'ELEVATION');
  assert.equal(O.role({ ...a, viewRole: 'BOTH', y: 0 }), 'SHARED');
  assert.equal(O.role({ ...edge, viewRole: 'BOTH', y: -10, y2: 20 }), 'SHARED');
  assert.equal(rows({ ...top, y: 20 })['Depth from VP'], '-20 mm · behind');
  assert.equal(rows({ ...a, y: -20 })['Height from HP'], '-20 mm · below');
});
check('side specs use the profile reference and respect left/right mapping', () => {
  const side = { ...a, x: 120, y: 35, viewRole: 'PROFILE' };
  const left = rows(side, defaults, { three: true, xRef: 100, dRef: 10, s: 1 });
  assert.equal(left['Depth from VP'], '30 mm'); assert.equal(left['Offset from X₁Y₁'], '20 mm');
  assert.equal(left['Height from HP'], '35 mm');
  const right = rows(side, defaults, { three: true, xRef: 150, dRef: 10, s: -1 });
  assert.equal(right['Depth from VP'], '40 mm');
  assert.equal(rows(side, defaults, { three: true, xRef: NaN, s: 1 })['Depth from VP'], undefined);
});
check('line specs expose projected length and endpoint identity', () => {
  assert.equal(O.title(edge, entities), "Segment a'–b'");
  assert.equal(rows(edge)['Projected length'], '50 mm');
  assert.equal(rows(edge)['ΔX / ΔY'], '30 mm / 40 mm');
  assert.equal(rows(edge)['Orientation from +X'], '53.13°');
  assert.equal(rows(edge)['Start'], '(0, 10) mm');
  assert.equal(rows({ ...edge, x2: 0, y2: 10 })['Orientation from +X'], '—');
});
check('infinite lines and rays never claim their defined span is a total length', () => {
  const line = rows({ ...edge, type: 'LINE' }); assert.equal(line['Defined span'], '50 mm');
  assert.equal(line['Projected length'], undefined); assert.equal(line.Extent, 'Infinite in both directions');
  assert.equal(rows({ ...edge, type: 'RAY' }).Extent, 'Infinite from its start');
});
check('circle specs include radius, diameter, circumference and circle area', () => {
  const spec = rows(circle);
  assert.equal(spec.Radius, '10 mm'); assert.equal(spec.Diameter, '20 mm');
  assert.equal(spec.Circumference, '62.83 mm'); assert.equal(spec['Circle area'], '314.16 mm²');
});
check('wrapped arc specs use the actual sweep, arc length and endpoints', () => {
  const spec = rows(arc);
  assert.equal(spec.Sweep, '90°'); assert.equal(spec['Arc length'], '15.71 mm');
  assert.equal(spec['Chord length'], '14.14 mm'); assert.equal(spec['Arc start'], '(9.85, 18.26) mm');
  assert.equal(spec['Arc end'], '(1.74, 29.85) mm'); assert.equal(spec['Circle area'], undefined);
});
check('spec filters remove numerical categories without dropping view identity', () => {
  const off = { ...defaults, coordinates: false, lengths: false, angles: false, offsets: false, radii: false, curveProperties: false };
  assert.deepEqual(O.specs(edge, entities, off).rows, [['View', 'Front · VP']]);
  assert.deepEqual(O.specs(circle, entities, off).rows, [['View', 'Top · HP']]);
  assert.equal(O.specs({ ...circle, radius: NaN }, entities), null);
  assert.equal(O.specs({ id: 'text', type: 'TEXT', x: 0, y: 0 }, entities), null);
});
check('inventory filters views, kinds, construction and captions', () => {
  const list = entities.concat([{ ...edge, id: 'guide', bisCode: 'G' }, { ...a, id: 'hidden', visible: false }]);
  assert.equal(O.inventory(list, defaults).length, 6);
  assert.equal(O.inventory(list, { ...defaults, construction: true }).length, 7);
  assert.deepEqual(O.inventory(list, { ...defaults, view: 'plan' }).map(e => e.id), ['top', 'circle']);
  assert.deepEqual(O.inventory(list, { ...defaults, points: false, lines: false }).map(e => e.id), ['circle', 'arc']);
  assert.deepEqual(O.inventory(list, defaults, "a'-b'").map(e => e.id), ['edge']);
});
check('pins retain side, scopes deduplicate selection and view filters respect active picks', () => {
  let pins = O.togglePin([], a.id, -1); pins = O.togglePin(pins, edge.id, 1);
  assert.equal(pins[0].side, -1); assert.equal(O.togglePin(pins, a.id).length, 1);
  assert.equal(O.overlayItems(entities, a.id, -1, pins, { ...defaults, overlay: 'pinned' }).length, 2);
  assert.equal(O.overlayItems(entities, null, null, pins, defaults).length, 0);
  assert.equal(O.overlayItems(entities, a.id, 1, pins, { ...defaults, overlay: 'all', view: 'plan' }).length, 3);
});
check('comparisons are projected and refuse measurements across different views', () => {
  const compare = Object.fromEntries(O.comparison(a, b, defaults).rows);
  assert.equal(compare['Projected distance'], '50 mm'); assert.equal(compare['ΔX / ΔY'], '30 / 40 mm');
  assert.deepEqual(O.comparison(a, top, defaults).rows, []);
  const perpendicular = { ...edge, x: 0, y: 0, x2: -40, y2: 30 };
  assert.equal(Object.fromEntries(O.comparison(edge, perpendicular, defaults).rows)['Smaller angle'], '90°');
  assert.equal(Object.fromEntries(O.comparison(edge, { ...edge, x2: 0, y2: 10 }, defaults).rows)['Smaller angle'], '—');
});
check('projection bounds are in pixels and exclude infinite construction guides', () => {
  const before = JSON.stringify(entities);
  const bounds = O.viewBounds(entities.concat([{ ...edge, id: 'guide', bisCode: 'G', x: -1000, x2: 1000 }]), { s: 2, tx: 100, ty: 300 });
  assert.equal(bounds.PLAN.x1, 230); assert.ok(bounds.ELEVATION.x0 > 0);
  assert.equal(JSON.stringify(entities), before);
});
console.log('OK ' + checks + ' orthographic checks passed');

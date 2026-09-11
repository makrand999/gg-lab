'use strict';
var assert = require('assert');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');

var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/51 ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

// 1 units mm-only
eq(E.WORLD_UNITS, 'mm'); pass('entities world units mm');
// 2 nine types
eq(E.ENTITY_TYPES.length, 9);
deep(E.ENTITY_TYPES.slice().sort(), ['CIRCLE', 'CIRCULAR_ARC', 'DATUM_AXIS', 'DIMENSION', 'LINE', 'POINT', 'RAY', 'SEGMENT', 'TEXT'].sort()); pass('entities 9 types');
// 3 BIS codes exactly A B E G H K
deep(E.BIS_CODES, ['A', 'B', 'E', 'G', 'H', 'K']); pass('entities BIS codes A B E G H K');
// 4 A solid 0.50
eq(E.patternFor('A'), 'solid'); eq(E.widthMmFor('A'), 0.50); deep(E.dashMmFor('A'), []); pass('entities BIS A solid 0.50');
// 5 B solid 0.20
eq(E.patternFor('B'), 'solid'); eq(E.widthMmFor('B'), 0.20); pass('entities BIS B solid 0.20');
// 6 E dash 8-4 0.35
eq(E.patternFor('E'), 'dash'); deep(E.dashMmFor('E'), [8, 4]); eq(E.widthMmFor('E'), 0.35); pass('entities BIS E dash 8-4 0.35');
// 7 G chain 12-3-2-3 0.20
eq(E.patternFor('G'), 'chain'); deep(E.dashMmFor('G'), [12, 3, 2, 3]); eq(E.widthMmFor('G'), 0.20); pass('entities BIS G chain 0.20');
// 8 H same dash as G with thick ends
deep(E.dashMmFor('H'), [12, 3, 2, 3]); eq(E.widthMmFor('H'), 0.20); eq(E.bisStyleFor('H').thickEnds, true); eq(E.bisStyleFor('H').endWidthMm, 0.50); pass('entities BIS H thick ends');
// 9 K double-dot chain 0.20
eq(E.patternFor('K'), 'chain-double-dot'); deep(E.dashMmFor('K'), [12, 3, 2, 3, 2, 3]); eq(E.widthMmFor('K'), 0.20); pass('entities BIS K double-dot chain');
// 10 arrowheads 3.5 x 1.167 ratio 3
eq(E.ARROW_LEN_MM, 3.5); eq(E.ARROW_WIDTH_MM, 1.167); eq(E.ARROW_RATIO, 3); near(E.ARROW_LEN_MM / E.ARROW_WIDTH_MM, 3, 0.001, 'ratio'); pass('entities arrow 3.5x1.167 3-to-1');
// 11 flip under 30px
eq(E.ARROW_FLIP_PX, 30); eq(E.arrowFlipNeeded(29.9), true); eq(E.arrowFlipNeeded(30), false); eq(E.arrowFlipNeeded(100), false); pass('entities arrow flip under 30px');
// 12 defaults
E.resetIdCounter();
var d = E.createEntity('SEGMENT', { x: 1, y: 2, x2: 3, y2: 4 });
eq(d.visible, true); eq(d.locked, false); eq(d.layer, 'layer1'); eq(d.viewRole, 'BOTH'); eq(d.showLabel, false); eq(d.bisCode, 'B'); pass('entities create defaults');
// 13 all fields present
var keys = ['id', 'name', 'type', 'x', 'y', 'x2', 'y2', 'radius', 'startAngle', 'endAngle', 'bisCode', 'viewRole', 'visible', 'locked', 'layer', 'color', 'thickness', 'caption', 'showLabel', 'meta'];
keys.forEach(function (k) { ok(Object.prototype.hasOwnProperty.call(d, k), 'field ' + k); });
pass('entities all fields present');
// 14 deterministic ids
E.resetIdCounter();
eq(E.createEntity('POINT', {}).id, 'E1'); eq(E.createEntity('POINT', {}).id, 'E2'); pass('entities deterministic ids');
// 15 custom id
eq(E.createEntity('POINT', { id: 'P7' }).id, 'P7'); pass('entities custom id');
// 16 invalid type throws
throws(function () { E.createEntity('POLYGON', {}); }); pass('entities invalid type throws');
// 17 invalid bisCode throws
throws(function () { E.createEntity('POINT', { bisCode: 'Z' }); }); pass('entities invalid bisCode throws');
// 18 NaN x throws
throws(function () { E.createEntity('POINT', { x: NaN }); }); pass('entities NaN x throws');
// 19 radius clamps to 0.01
eq(E.createEntity('CIRCLE', { radius: 0.001 }).radius, 0.01); pass('entities radius min 0.01');
// 20 DATUM_AXIS locked by default
eq(E.createEntity('DATUM_AXIS', {}).locked, true); pass('entities datum locked default');
// 21 locked move throws
var t1 = E.createTable(); E.resetIdCounter();
var lk = t1.create('SEGMENT', { x: 0, y: 0, x2: 10, y2: 0 });
t1.lock(lk.id);
throws(function () { t1.move(lk.id, 1, 1); }); pass('entities locked move throws');
// 22 locked xy update throws, caption ok
throws(function () { t1.update(lk.id, { x: 5 }); });
t1.update(lk.id, { caption: 'd1' }); eq(t1.get(lk.id).caption, 'd1'); pass('entities locked xy blocked caption ok');
// 23 unlock then move ok
t1.unlock(lk.id);
t1.move(lk.id, 1, 2); eq(t1.get(lk.id).x, 1); eq(t1.get(lk.id).y, 2); pass('entities unlock move ok');
// 24 add/get/has/count
var t2 = E.createTable();
t2.add(E.createEntity('POINT', { id: 'a', x: 1, y: 1 }));
ok(t2.has('a')); eq(t2.get('a').x, 1); eq(t2.count(), 1); pass('entities table add/get/count');
// 25 duplicate id throws
throws(function () { t2.add(E.createEntity('POINT', { id: 'a' })); }); pass('entities duplicate id throws');
// 26 remove
eq(t2.remove('a'), true); eq(t2.remove('a'), false); eq(t2.count(), 0); pass('entities table remove');
// 27 update
t2.add(E.createEntity('POINT', { id: 'b', x: 0, y: 0 }));
t2.update('b', { x: 4, y: 5 }); eq(t2.get('b').x, 4); pass('entities table update');
// 28 clear
t2.clear(); eq(t2.count(), 0); pass('entities table clear');
// 29 findByType
t2.add(E.createEntity('POINT', { id: 'p1' })); t2.add(E.createEntity('CIRCLE', { id: 'c1', radius: 5 }));
eq(t2.findByType('POINT').length, 1); pass('entities findByType');
// 30 findByBisCode
t2.add(E.createEntity('LINE', { id: 'l1', bisCode: 'A' }));
eq(t2.findByBisCode('A').length, 1); pass('entities findByBisCode');
// 31 findByViewRole
t2.add(E.createEntity('RAY', { id: 'r1', viewRole: 'PLAN' }));
eq(t2.findByViewRole('PLAN').length, 1); pass('entities findByViewRole');
// 32 findByLayer
t2.add(E.createEntity('TEXT', { id: 't1', layer: 'layer2' }));
eq(t2.findByLayer('layer2').length, 1); pass('entities findByLayer');
// 33 visible filter
t2.add(E.createEntity('POINT', { id: 'hid', visible: false }));
ok(t2.visibleEntities().every(function (e) { return e.visible; })); pass('entities visible filter');
// 34 resolveStyle thickness override else BIS
var eB = E.createEntity('SEGMENT', { bisCode: 'B' });
eq(E.resolveStyle(eB).widthMm, 0.20);
var eT = E.createEntity('SEGMENT', { bisCode: 'B', thickness: 0.7 });
eq(E.resolveStyle(eT).widthMm, 0.7); pass('entities resolveStyle thickness');
// 35 dashToPx
deep(E.dashToPx([8, 4], 2), [16, 8]); pass('entities dashToPx');
// 36 widthToPx
eq(E.widthToPx(0.5, 2), 1); pass('entities widthToPx');
// 37 render px formula y-flip
var view = { s: 2, tx: 100, ty: 200 };
var seg = E.createEntity('SEGMENT', { x: 3, y: 4, x2: 5, y2: 6 });
var job = E.renderEntity(view, seg);
eq(job.p1Px.x, 106); eq(job.p1Px.y, 192); pass('entities render y-flip');
// 38 render does not mutate (mm-only)
eq(seg.x, 3); ok(!('p1Px' in seg)); ok(!('dashPx' in seg)); pass('entities render no mutate');
// 39 entity has no px keys
Object.keys(seg).forEach(function (k) { ok(k.toLowerCase().indexOf('px') === -1, 'no px key ' + k); }); pass('entities mm-only no px keys');
// 40 projector true/false
ok(E.checkProjector({ x: 5, y: 1 }, { x: 5, y: 9 })); ok(!E.checkProjector({ x: 5, y: 1 }, { x: 6, y: 9 })); pass('entities projector');
// 41 entity projector pair
var pe = E.createEntity('POINT', { x: 7, y: 1, viewRole: 'PLAN' });
var ee = E.createEntity('POINT', { x: 7, y: 9, viewRole: 'ELEVATION' });
ok(E.checkEntityProjector(pe, ee)); pass('entities projector pair');
// 42 dimension arrows flip integration
var shortDim = E.createEntity('DIMENSION', { x: 0, y: 0, x2: 5, y2: 0 });
var sj = E.renderEntity({ s: 2, tx: 0, ty: 0 }, shortDim);
eq(sj.arrow.flip, true); eq(sj.arrow.lenMm, 3.5); eq(sj.arrow.widthMm, 1.167);
var longDim = E.createEntity('DIMENSION', { x: 0, y: 0, x2: 50, y2: 0 });
eq(E.renderEntity({ s: 2, tx: 0, ty: 0 }, longDim).arrow.flip, false); pass('entities dimension flip');
// 43 circle render radius px
var cir = E.createEntity('CIRCLE', { x: 1, y: 1, radius: 10 });
eq(E.renderEntity({ s: 2, tx: 0, ty: 0 }, cir).radiusPx, 20); pass('entities circle radiusPx');
// 44 arc preserves angles
var arc = E.createEntity('CIRCULAR_ARC', { x: 0, y: 0, radius: 5, startAngle: 0.5, endAngle: 1.5 });
var aj = E.renderEntity({ s: 1, tx: 0, ty: 0 }, arc);
eq(aj.startAngle, 0.5); eq(aj.endAngle, 1.5); pass('entities arc angles');

// 45 H render thick ends px
var hEnt = E.createEntity('DATUM_AXIS', { bisCode: 'H', x: 0, y: 0, x2: 20, y2: 0, locked: false });
var hj = E.renderEntity({ s: 2, tx: 0, ty: 0 }, hEnt);
eq(hj.thickEnds, true); eq(hj.endWidthPx, 1.0); pass('entities H thick ends px');
// 46 table create validates + list order deterministic
var t3 = E.createTable(); E.resetIdCounter();
t3.create('POINT', { x: 0, y: 0 }); t3.create('POINT', { x: 1, y: 1 });
deep(t3.list().map(function (e) { return e.id; }), ['E1', 'E2']); pass('entities list order deterministic');
// 47 cosmetic screen weights: thin 1px, thick/medium 2px
eq(E.cosmeticWidthPx(0.50), 2);
eq(E.cosmeticWidthPx(0.35), 2);
eq(E.cosmeticWidthPx(0.20), 1);
eq(E.cosmeticWidthPx(0.70), 2);
eq(E.cosmeticWidthPx(0.10), 1);
eq(E.COSMETIC_CUTOFF_MM, 0.35);
throws(function () { E.cosmeticWidthPx(NaN); }); pass('entities cosmetic weights');
// 48 cosmetic mapping per BIS code via resolveStyle
['A', 'E'].forEach(function (code) {
  var st = E.resolveStyle(E.createEntity('SEGMENT', { bisCode: code, x: 0, y: 0, x2: 1, y2: 1 }));
  eq(E.cosmeticWidthPx(st.widthMm), 2, code);
});
['B', 'G', 'H', 'K'].forEach(function (code) {
  var st = E.resolveStyle(E.createEntity('SEGMENT', { bisCode: code, x: 0, y: 0, x2: 1, y2: 1 }));
  eq(E.cosmeticWidthPx(st.widthMm), 1, code);
}); pass('entities cosmetic per BIS code');
// 49 screen constant while export scales with zoom
[0.05, 0.5, 2, 10, 50].forEach(function (s) {
  eq(E.cosmeticWidthPx(0.50), 2, 'thick s=' + s);
  eq(E.cosmeticWidthPx(0.20), 1, 'thin s=' + s);
});
eq(E.widthToPx(0.50, 50), 25);
eq(E.widthToPx(0.20, 50), 10); pass('entities screen constant export scales');
// 50 cosmetic dash cadence: raw pattern as px, defensive copy
deep(E.cosmeticDashPx([8, 4]), [8, 4]);
deep(E.cosmeticDashPx([12, 3, 2, 3]), [12, 3, 2, 3]);
deep(E.cosmeticDashPx([12, 3, 2, 3, 2, 3]), [12, 3, 2, 3, 2, 3]);
deep(E.cosmeticDashPx([]), []);
var src50 = [8, 4];
var out50 = E.cosmeticDashPx(src50);
out50[0] = 999;
eq(src50[0], 8);
throws(function () { E.cosmeticDashPx([8, NaN]); });
throws(function () { E.cosmeticDashPx('8,4'); }); pass('entities cosmetic dash');
// 51 dash constant on screen while export scales with zoom
[0.05, 0.5, 2, 10, 50].forEach(function (s) {
  deep(E.cosmeticDashPx([8, 4]), [8, 4], 'screen s=' + s);
});
deep(E.dashToPx([8, 4], 50), [400, 200]); pass('entities dash constant export scales');

assert.strictEqual(n, 51);
console.log('OK 51/51 phase2 tests passed');

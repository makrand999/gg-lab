'use strict';
var assert = require('assert');
var fs = require('fs');
var SN = require('../mirror/files/www.geogebra.org/edugraphics-snapping.js');
var IN = require('../mirror/files/www.geogebra.org/edugraphics-instruments.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');

var TOTAL = 32;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

function view() { return { s: 2, tx: 400, ty: 300, w: 800, h: 600 }; }
function table2() {
  E.resetIdCounter();
  var t = E.createTable();
  t.create('SEGMENT', { x: 0, y: 0, x2: 40, y2: 0 });
  t.create('SEGMENT', { x: 20, y: -20, x2: 20, y2: 20 });
  t.create('CIRCLE', { x: 60, y: 60, radius: 10 });
  return t;
}

// 1 modules load, mm units, versions 5.x
eq(SN.WORLD_UNITS, 'mm');
eq(IN.WORLD_UNITS, 'mm');
ok(/^5\./.test(SN.VERSION), 'snap version ' + SN.VERSION);
ok(/^5\./.test(IN.VERSION), 'inst version ' + IN.VERSION);
pass('phase5 loads mm v5');
// 2 zero deps + dual-env markers
var srcS = fs.readFileSync('mirror/files/www.geogebra.org/edugraphics-snapping.js', 'utf8');
var srcI = fs.readFileSync('mirror/files/www.geogebra.org/edugraphics-instruments.js', 'utf8');
eq(srcS.indexOf('require('), -1);
eq(srcI.indexOf('require('), -1);
ok(srcS.indexOf('EduGraphicsSnapping') !== -1, 'snap window global');
ok(srcI.indexOf('EduGraphicsInstruments') !== -1, 'inst window global');
ok(srcS.indexOf('module.exports') !== -1 && srcI.indexOf('module.exports') !== -1);
pass('phase5 zero deps dual-env');
// 3 six tiers in priority order
deep(SN.SNAP_TIERS, ['ENDPOINT', 'INTERSECTION', 'MIDPOINT', 'CENTER', 'PROJECTOR', 'LOCUS']);
eq(SN.tierRank('ENDPOINT'), 0);
eq(SN.tierRank('LOCUS'), 5);
throws(function () { SN.tierRank('BOGUS'); });
pass('phase5 six tiers order');
// 4 pickBest honours tier over distance
var cands4 = [
  { tier: 'LOCUS', key: 'a', distPx: 1, xMm: 0, yMm: 0 },
  { tier: 'ENDPOINT', key: 'b', distPx: 13, xMm: 1, yMm: 1 }
];
eq(SN.pickBest(cands4).tier, 'ENDPOINT');
eq(SN.pickBest([]), null);
ok(SN.isBetterTier('INTERSECTION', 'MIDPOINT'));
ok(!SN.isBetterTier('CENTER', 'MIDPOINT'));
pass('phase5 tier priority pick');
// 5 intersection beats midpoint beats center
var t5 = table2();
var v5 = view();
var cross = SN.forward(v5, { x: 20, y: 0 });
var r5 = SN.snapAt({ x: cross.x + 2, y: cross.y + 1 }, v5, { entities: t5.list() });
eq(r5.snap.tier, 'INTERSECTION');
near(r5.snap.xMm, 20, 1e-9, 'ix');
near(r5.snap.yMm, 0, 1e-9, 'iy');
pass('phase5 intersection snap numeric');
// 6 midpoint and center snaps
var mid = SN.forward(v5, { x: 20, y: 0 });
var r6a = SN.snapAt({ x: mid.x, y: mid.y }, v5, { entities: [t5.get('E1')] });
eq(r6a.snap.tier, 'MIDPOINT');
near(r6a.snap.xMm, 20, 1e-9, 'midx');
var ctr = SN.forward(v5, { x: 60, y: 60 });
var r6b = SN.snapAt(ctr, v5, { entities: t5.list() });
eq(r6b.snap.tier, 'CENTER');
pass('phase5 midpoint center');
// 7 lock 14 release 22 hysteresis
eq(SN.SNAP_LOCK_PX, 14);
eq(SN.SNAP_RELEASE_PX, 22);
ok(SN.shouldLock(14) && !SN.shouldLock(14.5));
ok(SN.shouldRelease(22.5) && !SN.shouldRelease(22));
var held = SN.updateSnap(null, [{ tier: 'ENDPOINT', key: 'k', distPx: 10, xMm: 0, yMm: 0 }]);
ok(held !== null, 'locks within 14');
var kept = SN.updateSnap(held, [{ tier: 'ENDPOINT', key: 'k', distPx: 20, xMm: 0, yMm: 0 }]);
ok(kept !== null && kept.distPx === 20, 'holds to 22');
var dropped = SN.updateSnap(held, [{ tier: 'ENDPOINT', key: 'k', distPx: 23, xMm: 0, yMm: 0 }]);
eq(dropped, null);
pass('phase5 hysteresis 14 22');
// 8 higher tier steals lock within 14
var cur8 = { tier: 'LOCUS', key: 'LOCUS:ly0', distPx: 8, xMm: 0, yMm: 0 };
var next8 = SN.updateSnap(cur8, [
  { tier: 'LOCUS', key: 'LOCUS:ly0', distPx: 8, xMm: 0, yMm: 0 },
  { tier: 'ENDPOINT', key: 'ENDPOINT:E1:p1', distPx: 12, xMm: 1, yMm: 1 }
]);
eq(next8.tier, 'ENDPOINT');
pass('phase5 higher tier steal');
// 9 endpoint dedup rebind within 1.0 mm
eq(SN.ENDPOINT_DEDUP_MM, 1.0);
var rb9a = SN.rebindEndpoint({ x: 10.5, y: 0 }, [{ x: 10, y: 0 }]);
eq(rb9a.rebound, true);
deep(rb9a.point, { x: 10, y: 0 });
var rb9b = SN.rebindEndpoint({ x: 11.5, y: 0 }, [{ x: 10, y: 0 }]);
eq(rb9b.rebound, false);
var dd9 = SN.dedupEndpoints([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 5, y: 5 }]);
eq(dd9.points.length, 2);
deep(dd9.map, [0, 0, 1]);
pass('phase5 endpoint dedup 1mm');
// 10 detents 15 30 45
deep(SN.DETENTS_DEG, [15, 30, 45]);
eq(SN.nearestDetent(16), 15);
eq(SN.nearestDetent(31), 30);
eq(SN.nearestDetent(44), 45);
var d10 = SN.detentSnap(16);
eq(d10.snapped, true);
eq(d10.detent, 15);
eq(SN.detentSnap(7).snapped, false);
ok(SN.isMajorDetent(30) && !SN.isMajorDetent(60));
pass('phase5 detents');
// 11 badge types + ring data Layer2
eq(SN.BADGE_TYPES.length, 7);
eq(SN.badgeForTier('MIDPOINT').label, 'Midpoint');
throws(function () { SN.badgeForTier('NOPE'); });
var ring11 = SN.ringForSnap({ x: 100, y: 200 }, 'ENDPOINT');
eq(ring11.layer, 'layer2');
eq(ring11.shape, 'ring');
eq(ring11.rPx, SN.RING_RADIUS_PX);
var r11 = SN.snapAt(ctr, v5, { entities: t5.list() });
eq(r11.badge.type, 'CENTER');
eq(r11.ring.layer, 'layer2');
eq(r11.ring.tier, 'CENTER');
pass('phase5 badge ring');
// 12 projector snap enforces elev.x equals plan.x
var pr12 = SN.projectorCandidates([25], { x: 452, y: 300 }, v5);
eq(pr12.length, 1);
eq(pr12[0].tier, 'PROJECTOR');
eq(pr12[0].xMm, 25);
ok(SN.checkProjector({ x: 25, y: 1 }, { x: pr12[0].xMm, y: 9 }));
var r12 = SN.snapAt({ x: 451, y: 300 }, v5, { entities: [], planXMmList: [25] });
eq(r12.snap.tier, 'PROJECTOR');
eq(r12.snap.xMm, 25);
pass('phase5 projector invariant');
// 13 locus snap horizontal
var lo13 = SN.locusCandidates([10], { x: 400, y: 279 }, v5);
eq(lo13[0].tier, 'LOCUS');
eq(lo13[0].yMm, 10);
near(lo13[0].distPx, 1, 1e-9, 'locus dist');
var r13 = SN.snapAt({ x: 400, y: 279 }, v5, { entities: [], locusYMmList: [10] });
eq(r13.snap.tier, 'LOCUS');
pass('phase5 locus snap');
// 14 snapAt empty -> null snap badge ring
var r14 = SN.snapAt({ x: 0, y: 0 }, v5, { entities: [] });
eq(r14.snap, null);
eq(r14.badge, null);
eq(r14.ring, null);
eq(r14.candidates.length, 0);
pass('phase5 empty snap null');
// 15 candidatesWithin + compareTiers + guards
var c15 = [{ tier: 'MIDPOINT', distPx: 5 }, { tier: 'MIDPOINT', distPx: 30 }];
eq(SN.candidatesWithin(c15, 14).length, 1);
eq(SN.compareTiers('ENDPOINT', 'LOCUS') < 0, true);
throws(function () { SN.assertFinite(NaN); });
throws(function () { SN.collectCandidates({}, null, v5); });
pass('phase5 candidate filters guards');
// 16 ruler state machine idle placing placed
var ru16 = IN.createRuler();
eq(IN.stateOf(ru16), 'idle');
IN.rulerDown(ru16, { x: 0, y: 0 });
eq(IN.stateOf(ru16), 'placing');
IN.rulerMove(ru16, { x: 30, y: 0 });
eq(IN.stateOf(ru16), 'placing');
IN.rulerUp(ru16, { x: 30, y: 0 });
eq(IN.stateOf(ru16), 'placed');
throws(function () { IN.rulerMove(ru16, { x: 1, y: 1 }); });
throws(function () { IN.rulerDown(ru16, { x: 0, y: 0 }); });
IN.rulerReset(ru16);
eq(IN.stateOf(ru16), 'idle');
pass('phase5 ruler states');
// 17 ruler length angle detent numeric
var ru17 = IN.createRuler();
IN.rulerDown(ru17, { x: 0, y: 0 });
IN.rulerMove(ru17, { x: 40, y: 0 });
IN.rulerUp(ru17);
near(ru17.lengthMm, 40, 1e-9, 'len');
near(ru17.angleDeg, 0, 1e-9, 'ang');
var ru17b = IN.createRuler();
IN.rulerDown(ru17b, { x: 0, y: 0 });
IN.rulerMove(ru17b, { x: 30, y: 30 });
near(ru17b.detent.detent, 45, 1e-9, 'det45');
eq(ru17b.detent.snapped, true);
pass('phase5 ruler measure detent');
// 18 ruler commits Type A or B segments, mm only
var ru18 = IN.createRuler();
IN.rulerDown(ru18, { x: 0, y: 0 });
IN.rulerMove(ru18, { x: 10, y: 0 });
IN.rulerUp(ru18);
var segB = IN.rulerCommit(ru18);
eq(segB.type, 'SEGMENT');
eq(segB.bisCode, 'B');
near(segB.x2, 10, 1e-9, 'x2');
Object.keys(segB).forEach(function (k) { ok(k.toLowerCase().indexOf('px') === -1, 'no px ' + k); });
var segA = IN.rulerCommit(ru18, { bisCode: 'A' });
eq(segA.bisCode, 'A');
throws(function () { IN.rulerCommit(ru18, { bisCode: 'K' }); });
throws(function () { IN.rulerCommit(IN.createRuler()); });
pass('phase5 ruler commit AB');
// 19 ruler mm ticks minor mid major
var tk19 = IN.rulerTicks(10);
eq(tk19.length, 11);
eq(tk19[0].kind, 'major');
eq(tk19[1].kind, 'minor');
eq(tk19[5].kind, 'mid');
eq(tk19[10].kind, 'major');
eq(IN.TICK_MINOR_MM, 1);
eq(IN.TICK_MAJOR_MM, 10);
throws(function () { IN.rulerTicks(-1); });
pass('phase5 ruler ticks');
// 20 ruler geometry Layer2 only
var g20 = IN.rulerGeometry(ru18);
ok(g20.length === 2, 'two geos');
g20.forEach(function (g) { eq(g.layer, 'layer2'); });
eq(g20[0].shape, 'ruler-edge');
eq(g20[1].shape, 'ruler-ticks');
deep(IN.rulerGeometry(IN.createRuler()), []);
pass('phase5 ruler layer2');
// 21 compass pin radius arc states
var co21 = IN.createCompass();
eq(IN.stateOf(co21), 'idle');
IN.compassSetPin(co21, { x: 50, y: 50 });
eq(IN.stateOf(co21), 'pin-set');
IN.compassSetRadius(co21, { x: 75, y: 50 });
eq(IN.stateOf(co21), 'radius-set');
near(co21.radiusMm, 25, 1e-9, 'radius');
IN.compassSetArc(co21, 0, 90);
eq(co21.endAngleDeg, 90);
throws(function () { IN.compassSetPin(co21, { x: 0, y: 0 }); });
throws(function () { IN.compassSetArc(IN.createCompass(), 0, 90); });
pass('phase5 compass states');
// 22 compass radius readout + direct drag
var rd22 = IN.compassRadiusReadout(co21);
eq(rd22.radiusMm, 25);
eq(rd22.text, '25.0 mm');
IN.compassMove(co21, 'pin', { x: 0, y: 0 });
eq(co21.pinMm.x, 0);
IN.compassMove(co21, 'radius', { x: 6, y: 8 });
near(co21.radiusMm, 10, 1e-9, 'drag radius');
throws(function () { IN.compassMove(co21, 'nope', { x: 0, y: 0 }); });
pass('phase5 compass readout drag');
// 23 compass commits Type B or K arcs, radius clamp
var co23 = IN.createCompass();
IN.compassSetPin(co23, { x: 0, y: 0 });
IN.compassSetRadius(co23, 12);
var cir23 = IN.compassCommit(co23);
eq(cir23.type, 'CIRCLE');
eq(cir23.bisCode, 'B');
IN.compassSetArc(co23, 0, 120);
var arc23 = IN.compassCommit(co23, { bisCode: 'K' });
eq(arc23.type, 'CIRCULAR_ARC');
eq(arc23.bisCode, 'K');
eq(arc23.startAngle, 0);
eq(arc23.endAngle, 120);
Object.keys(arc23).forEach(function (k) { ok(k.toLowerCase().indexOf('px') === -1, 'no px ' + k); });
throws(function () { IN.compassCommit(co23, { bisCode: 'A' }); });
var co23b = IN.createCompass();
IN.compassSetPin(co23b, { x: 0, y: 0 });
IN.compassSetRadius(co23b, 0);
eq(co23b.radiusMm, IN.RADIUS_MIN_MM);
pass('phase5 compass commit BK');
// 24 compass geometry Layer2 pin radius arc
var g24 = IN.compassGeometry(co23);
eq(g24.length, 3);
g24.forEach(function (g) { eq(g.layer, 'layer2'); });
eq(g24[0].shape, 'compass-pin');
eq(g24[2].shape, 'compass-arc');
deep(IN.compassGeometry(IN.createCompass()), []);
pass('phase5 compass layer2');
// 25 instrument detents mirror snapping
deep(IN.DETENTS_DEG, [15, 30, 45]);
eq(IN.nearestDetent(44), SN.nearestDetent(44));
eq(IN.detentSnap(31).detent, 30);
near(IN.angleDeg({ x: 0, y: 0 }, { x: 1, y: 1 }), 45, 1e-9, 'diag');
pass('phase5 inst detents');
// 26 committed specs insert into entity table
E.resetIdCounter();
var t26 = E.createTable();
var ru26 = IN.createRuler();
IN.rulerDown(ru26, { x: 5, y: 5 });
IN.rulerMove(ru26, { x: 15, y: 5 });
IN.rulerUp(ru26);
var s26 = IN.rulerCommit(ru26, { bisCode: 'A' });
var e26 = t26.create(s26.type, s26);
eq(e26.bisCode, 'A');
var co26 = IN.createCompass();
IN.compassSetPin(co26, { x: 0, y: 0 });
IN.compassSetRadius(co26, 20);
IN.compassSetArc(co26, 0, 180);
var a26 = IN.compassCommit(co26, { bisCode: 'K' });
var e26b = t26.create(a26.type, a26);
eq(e26b.bisCode, 'K');
eq(e26b.radius, 20);
pass('phase5 commit to table');
// 27 snapped endpoint inserts + projector holds
E.resetIdCounter();
var t27 = table2();
var ep27 = SN.forward(v5, { x: 0, y: 0 });
var r27 = SN.snapAt({ x: ep27.x + 3, y: ep27.y - 2 }, v5, { entities: t27.list() });
eq(r27.snap.tier, 'ENDPOINT');
var p27 = t27.create('POINT', { x: r27.snap.xMm, y: r27.snap.yMm, viewRole: 'PLAN' });
var q27 = t27.create('POINT', { x: r27.snap.xMm, y: 44, viewRole: 'ELEVATION' });
ok(SN.checkProjector(p27, q27));
ok(IN.checkProjector(p27, q27));
pass('phase5 snap insert projector');
// 28 guards: NaN, bad bis, bad handles
throws(function () { IN.assertFinite(Infinity); });
throws(function () { IN.rulerSetBis(IN.createRuler(), 'K'); });
throws(function () { IN.compassSetBis(IN.createCompass(), 'A'); });
throws(function () { IN.compassMove(IN.createCompass(), 'pin', { x: 0, y: 0 }); });
throws(function () { IN.rulerUp(IN.createRuler()); });
pass('phase5 inst guards');
// 29 determinism: same cursor same snap
var r29a = SN.snapAt({ x: cross.x + 2, y: cross.y + 1 }, v5, { entities: t5.list() });
var r29b = SN.snapAt({ x: cross.x + 2, y: cross.y + 1 }, v5, { entities: t5.list() });
deep(r29a.snap, r29b.snap);
deep(r29a.badge, r29b.badge);
deep(r29a.ring, r29b.ring);
pass('phase5 deterministic');
// 30 state lists + constants exported
deep(IN.RULER_STATES, ['idle', 'placing', 'placed']);
deep(IN.COMPASS_STATES, ['idle', 'pin-set', 'radius-set']);
deep(IN.RULER_BIS, ['A', 'B']);
deep(IN.COMPASS_BIS, ['B', 'K']);
eq(IN.LAYER, 'layer2');
eq(SN.LAYER_DYNAMIC, 'layer2');
eq(SN.RING_RADIUS_PX, 10);
pass('phase5 states constants');
// 31 AABB prefilter skips far segments, keeps near crossing
E.resetIdCounter();
var t31 = table2();
t31.create('SEGMENT', { x: 200, y: 200, x2: 240, y2: 200 });
t31.create('SEGMENT', { x: 220, y: 180, x2: 220, y2: 220 });
var far31 = SN.intersectionCandidates(t31.list(), { x: 0, y: 600 }, v5);
eq(far31.length, 0);
var near31 = SN.intersectionCandidates(t31.list(), { x: cross.x + 2, y: cross.y + 1 }, v5);
eq(near31.length, 1);
near(near31[0].xMm, 20, 1e-9, 'ix');
near(near31[0].yMm, 0, 1e-9, 'iy');
var r31 = SN.snapAt({ x: cross.x + 2, y: cross.y + 1 }, v5, { entities: t31.list() });
eq(r31.snap.tier, 'INTERSECTION');
pass('phase5 intersection prefilter');
// 32 infinite LINE uses point-line distance, not finite AABB
var w32 = SN.inverse(v5, { x: 400, y: 300 });
ok(SN.lineNearCursorMm({ x: -1000, y: 0, x2: -900, y2: 0 }, w32, 11), 'line on cursor row');
ok(!SN.lineNearCursorMm({ x: -1000, y: 500, x2: -900, y2: 500 }, w32, 11), 'far line dropped');
ok(!SN.segNearCursorMm({ x: 200, y: 200, x2: 240, y2: 200 }, w32, 11), 'far seg dropped');
ok(SN.segNearCursorMm({ x: 0, y: 0, x2: 40, y2: 0 }, w32, 11), 'near seg kept');
pass('phase5 line distance filter');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase5 tests passed');

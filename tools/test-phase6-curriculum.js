'use strict';
var assert = require('assert');
var fs = require('fs');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');

var TOTAL = 23;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }
function noPxKeys(objs) {
  objs.forEach(function (e) {
    Object.keys(e).forEach(function (k) { ok(k.toLowerCase().indexOf('px') === -1, 'no px key ' + k); });
  });
}

// 1 loads, mm units, version 6.x
eq(C.WORLD_UNITS, 'mm');
ok(/^6\./.test(C.VERSION), 'version ' + C.VERSION);
pass('phase6 loads mm v6');
// 2 zero deps + dual-env markers
var src = fs.readFileSync('mirror/files/www.geogebra.org/educad-curriculum.js', 'utf8');
eq(src.indexOf('require('), -1);
ok(src.indexOf('EduCADCurriculum') !== -1, 'window.EduCADCurriculum marker');
ok(src.indexOf('module.exports') !== -1, 'module.exports marker');
pass('phase6 zero deps dual-env');
// 3 exports present
['QUADRANTS', 'PROJECTIONS', 'SOLID_TYPES', 'SOLID_SIZE_MM', 'quadrantPoint', 'quadrantSet',
  'straightLine', 'planeSurface', 'regularSolid', 'generateLesson', 'generateCurriculum',
  'validateBundle', 'checkProjector', 'primeLabel', 'normalizeProjection'].forEach(function (k) {
  ok(C[k] !== undefined, 'export ' + k);
});
deep(C.QUADRANTS, [1, 2, 3, 4]);
deep(C.SOLID_TYPES, ['PRISM', 'PYRAMID', 'CYLINDER', 'CONE']);
eq(C.SOLID_SIZE_MM, 35);
pass('phase6 exports constants');
// 4 all 4 quadrant signs
var q1 = C.quadrantPoint({ quadrant: 1, distHP: 20, distVP: 15 });
var q2 = C.quadrantPoint({ quadrant: 2, distHP: 20, distVP: 15 });
var q3 = C.quadrantPoint({ quadrant: 3, distHP: 20, distVP: 15 });
var q4 = C.quadrantPoint({ quadrant: 4, distHP: 20, distVP: 15 });
eq(q1.elev.y, 20); eq(q1.plan.y, -15);
eq(q2.elev.y, 20); eq(q2.plan.y, 15);
eq(q3.elev.y, -20); eq(q3.plan.y, 15);
eq(q4.elev.y, -20); eq(q4.plan.y, -15);
eq(C.quadrantSet().length, 4);
deep(C.quadrantSet().map(function (q) { return q.quadrant; }), [1, 2, 3, 4]);
pass('phase6 four quadrants signs');
// 5 first-angle BIS vs third-angle ASME variants
var f = C.quadrantPoint({ quadrant: 1, projection: 'FIRST_ANGLE' });
var t = C.quadrantPoint({ quadrant: 1, projection: 'THIRD_ANGLE' });
eq(f.projection, 'FIRST_ANGLE');
eq(t.projection, 'THIRD_ANGLE');
eq(C.normalizeProjection('BIS'), 'FIRST_ANGLE');
eq(C.normalizeProjection('ASME'), 'THIRD_ANGLE');
ok(f.steps.join(' ').indexOf('BIS') !== -1, 'BIS note');
ok(t.steps.join(' ').indexOf('ASME') !== -1, 'ASME note');
pass('phase6 first third projection');
// 6 primed labels plan/elev
eq(q1.entities[1].caption, 'a');
eq(q1.entities[2].caption, "a'");
eq(C.primeLabel('b'), "b'");
ok(q1.entities[1].showLabel && q1.entities[2].showLabel);
eq(q1.entities[1].viewRole, 'PLAN');
eq(q1.entities[2].viewRole, 'ELEVATION');
pass('phase6 primed labels roles');
// 7 quadrant projector invariant
ok(q1.projectorOk);
ok(C.checkProjector(q1.plan, q1.elev));
eq(q1.projectors.length, 1);
eq(q1.projectors[0].xMm, q1.plan.x);
var projs = q1.entities.filter(function (e) { return e.meta && e.meta.kind === 'projector'; });
eq(projs.length, 1);
eq(projs[0].bisCode, 'G');
eq(projs[0].x, projs[0].x2);
pass('phase6 quadrant projector G');
// 8 quadrant entities insert into table, mm-only
E.resetIdCounter();
var t8 = E.createTable();
q1.entities.forEach(function (s) { t8.create(s.type, s); });
eq(t8.count(), q1.entities.length);
noPxKeys(t8.list());
eq(t8.findByViewRole('PLAN').length >= 1, true);
eq(t8.findByViewRole('ELEVATION').length >= 1, true);
eq(C.validateBundle(q1).ok, true);
pass('phase6 quadrant table mm-only');
// 9 straight line rotation PL EL numeric
var L9 = C.straightLine({ TL: 50, thetaDeg: 60, phiDeg: 60 });
near(L9.PL, 25, 1e-9, 'PL');
near(L9.EL, 25, 1e-9, 'EL');
var L9b = C.straightLine({ TL: 100, thetaDeg: 0, phiDeg: 0 });
eq(L9b.PL, 100); eq(L9b.EL, 100);
pass('phase6 line rotation cos');
// 10 line loci match solver formulas
var L10 = C.straightLine({ TL: 100, thetaDeg: 30, phiDeg: 30, yaPlan: 20, yaElev: 40 });
near(L10.locusPlanY, 20 - 100 * Math.sin(30 * Math.PI / 180), 1e-9, 'locusB');
near(L10.locusElevY, 40 + 100 * Math.sin(30 * Math.PI / 180), 1e-9, 'locusBp');
near(L10.dx, Math.sqrt(Math.max(0, 100 * 100 - 50 * 50 - 50 * 50)), 1e-9, 'dx');
near(L10.bPlan.x, L10.aPlan.x + L10.dx, 1e-12, 'bx');
pass('phase6 line loci dx');
// 11 line steps theta phi + projector
var steps11 = L10.steps.join(' ');
ok(steps11.indexOf('theta') !== -1 && steps11.indexOf('phi') !== -1, 'theta phi steps');
ok(steps11.indexOf('cos') !== -1, 'cos steps');
ok(steps11.indexOf('Locus') !== -1, 'locus steps');
eq(L10.projectorOk, true);
ok(C.checkProjector(L10.aPlan, L10.aElev) && C.checkProjector(L10.bPlan, L10.bElev));
pass('phase6 line steps projector');
// 12 line entities bis A/G/K + primed b
var bis12 = L10.entities.map(function (e) { return e.bisCode; });
ok(bis12.indexOf('A') !== -1, 'A outlines');
ok(bis12.indexOf('G') !== -1, 'G projectors');
ok(bis12.indexOf('K') !== -1, 'K loci');
var caps12 = L10.entities.map(function (e) { return e.caption; });
ok(caps12.indexOf('b') !== -1 && caps12.indexOf("b'") !== -1, 'b/bprime');
noPxKeys(L10.entities);
eq(C.validateBundle(L10).ok, true);
pass('phase6 line entities bis labels');
// 13 plane HT VT traces on XY + tilt numeric
var P13 = C.planeSurface({ xMm: 0, sizeMm: 40, tiltDeg: 30 });
eq(P13.HTplan.y1, 0); eq(P13.HTplan.y2, 0);
near(P13.VTelev.x2, 40 * Math.cos(30 * Math.PI / 180), 1e-9, 'vtx');
near(P13.VTelev.y2, 40 * Math.sin(30 * Math.PI / 180), 1e-9, 'vty');
eq(P13.HTelev.x1, P13.HTplan.x1);
eq(P13.VTplan.x2, P13.VTelev.x2);
eq(P13.projectorOk, true);
pass('phase6 plane traces tilt');
// 14 plane entities bis/roles + steps HT VT
var bis14 = P13.entities.map(function (e) { return e.bisCode; });
ok(bis14.indexOf('A') !== -1 && bis14.indexOf('G') !== -1, 'A+G');
var caps14 = P13.entities.map(function (e) { return e.caption; });
ok(caps14.indexOf('HT') !== -1 && caps14.indexOf("VT'") !== -1, 'HT VTp');
ok(P13.steps.join(' ').indexOf('tilt') !== -1, 'tilt step');
ok(P13.loci.length >= 2 && P13.projectors.length >= 3, 'loci+projectors');
eq(C.validateBundle(P13).ok, true);
pass('phase6 plane entities steps');
// 15 solids 35mm all four types
['PRISM', 'PYRAMID', 'CYLINDER', 'CONE'].forEach(function (s) {
  var b = C.regularSolid({ solid: s });
  eq(b.sizeMm, 35);
  eq(b.solid, s);
  ok(b.entities.length >= 10, s + ' entities');
});
var cyl = C.regularSolid({ solid: 'CYLINDER' });
var rim = cyl.entities.filter(function (e) { return e.type === 'CIRCLE'; })[0];
eq(rim.radius, 17.5);
var prism = C.regularSolid({ solid: 'PRISM' });
var edge = prism.entities.filter(function (e) { return e.viewRole === 'PLAN' && e.bisCode === 'A'; })[0];
near(Math.abs(edge.x2 - edge.x), 35, 1e-9, 'prism edge 35');
pass('phase6 solids 35mm');
// 16 solids hidden E + axis G + visible A
['PRISM', 'PYRAMID', 'CYLINDER', 'CONE'].forEach(function (s) {
  var b = C.regularSolid({ solid: s });
  var bis = b.entities.map(function (e) { return e.bisCode; });
  ok(bis.indexOf('A') !== -1, s + ' A');
  ok(bis.indexOf('E') !== -1, s + ' E hidden');
  ok(bis.indexOf('G') !== -1, s + ' G axis');
  ok(bis.indexOf('K') !== -1, s + ' K loci');
  var apex = b.entities.filter(function (e) { return e.caption === "s'"; });
  if (s === 'PYRAMID' || s === 'CONE') eq(apex.length, 1, s + ' apex prime');
});
pass('phase6 solids bis hidden apex');
// 17 solids projectors + table insert
E.resetIdCounter();
['PRISM', 'PYRAMID', 'CYLINDER', 'CONE'].forEach(function (s) {
  var b = C.regularSolid({ solid: s, xMm: 5 });
  eq(b.projectorOk, true, s + ' projectorOk');
  b.projectors.forEach(function (p) {
    ok(C.checkProjector({ x: p.xMm, y: p.planY }, { x: p.xMm, y: p.elevY }), s + ' invariant');
  });
  eq(C.validateBundle(b).ok, true, s + ' valid');
  noPxKeys(b.entities);
});
var t17 = E.createTable();
C.regularSolid({ solid: 'CONE' }).entities.forEach(function (sp) { t17.create(sp.type, sp); });
ok(t17.count() >= 10);
pass('phase6 solids projector table');
// 18 full curriculum bundle aggregates + valid
var G18 = C.generateCurriculum();
eq(G18.quadrants.length, 4);
eq(G18.solids.length, 4);
ok(G18.entities.length > 80, 'bulk entities ' + G18.entities.length);
ok(G18.steps.length > 30 && G18.loci.length >= 10 && G18.projectors.length >= 15, 'bulk steps/loci/proj');
eq(G18.projectorOk, true);
eq(C.validateBundle(G18).ok, true);
eq(C.generateLesson('LINE', { TL: 50 }).kind, 'straight-line');
eq(C.generateLesson('SOLID', { solid: 'PRISM' }).kind, 'regular-solid');
eq(C.generateLesson('POINT', { quadrant: 2 }).kind, 'quadrant-point');
eq(C.generateLesson('PLANE', {}).kind, 'plane-surface');
pass('phase6 curriculum bundle');
// 19 guards throw
throws(function () { C.quadrantPoint({ quadrant: 5 }); });
throws(function () { C.quadrantPoint({ quadrant: 1, projection: 'NOPE' }); });
throws(function () { C.regularSolid({ solid: 'TORUS' }); });
throws(function () { C.straightLine({ TL: 0 }); });
throws(function () { C.straightLine({ TL: NaN }); });
throws(function () { C.planeSurface({ sizeMm: -1 }); });
throws(function () { C.generateLesson('NOPE', {}); });
throws(function () { C.assertFinite(Infinity); });
pass('phase6 guards');
// 20 determinism + mm-only everywhere
var G20a = C.generateCurriculum();
var G20b = C.generateCurriculum();
deep(G20a, G20b);
deep(C.straightLine({ TL: 60 }), C.straightLine({ TL: 60 }));
noPxKeys(G20a.entities);
pass('phase6 deterministic mm-only');
// 21 impossible inclinations flagged, never silent
var L21 = C.straightLine({ TL: 50, thetaDeg: 60, phiDeg: 60 });
eq(L21.physicallyImpossible, true);
eq(L21.dx, 0);
ok(L21.steps.join(' ').indexOf('WARNING') !== -1, 'warn step');
eq(C.straightLine({ TL: 50, thetaDeg: 30, phiDeg: 30 }).physicallyImpossible, false);
pass('phase6 impossible flagged');
// 22 perpendicular line: collapsed plan emitted as POINT
var L22 = C.straightLine({ TL: 50, thetaDeg: 90, phiDeg: 0 });
deep(L22.degenerateViews, ['PLAN']);
var planViews = L22.entities.filter(function (e) {
  return e.viewRole === 'PLAN' && (e.caption === 'ab');
});
eq(planViews.length, 1);
eq(planViews[0].type, 'POINT');
var zeroSegs = L22.entities.filter(function (e) {
  if (e.type !== 'SEGMENT') return false;
  var dx = e.x2 - e.x, dy = e.y2 - e.y;
  return dx * dx + dy * dy < 1e-12;
});
eq(zeroSegs.length, 0);
pass('phase6 degenerate point');
// 23 Q2/Q4 close views get anti-collision label offsets
var Q23 = C.quadrantPoint({ quadrant: 2, distHP: 20, distVP: 20 });
var plan23 = Q23.entities.filter(function (e) { return e.viewRole === 'PLAN'; })[0];
var elev23 = Q23.entities.filter(function (e) { return e.viewRole === 'ELEVATION'; })[0];
eq(plan23.meta.labelDyMm, -3);
eq(elev23.meta.labelDyMm, 3);
eq(plan23.y, 20);
eq(elev23.y, 20);
var Q23b = C.quadrantPoint({ quadrant: 1, distHP: 20, distVP: 15 });
var plan23b = Q23b.entities.filter(function (e) { return e.viewRole === 'PLAN'; })[0];
eq(plan23b.meta.labelDyMm, undefined);
pass('phase6 label offsets');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase6 tests passed');

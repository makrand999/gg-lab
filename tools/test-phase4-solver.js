'use strict';
var assert = require('assert');
var fs = require('fs');
var S = require('../mirror/files/www.geogebra.org/educad-solver.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');

var TOTAL = 64;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

// 1 loads, mm units, version 4.x
eq(S.WORLD_UNITS, 'mm');
eq(typeof S.solveSystem, 'function');
ok(/^4\./.test(S.VERSION), 'version ' + S.VERSION);
pass('solver loads mm v4');
// 2 zero deps + dual-env markers
var src = fs.readFileSync('mirror/files/www.geogebra.org/educad-solver.js', 'utf8');
eq(src.indexOf('require('), -1);
ok(src.indexOf('EduCADSolver') !== -1, 'window.EduCADSolver marker');
ok(src.indexOf('module.exports') !== -1, 'module.exports marker');
pass('solver zero deps dual-env');
// 3 exports present
['MAX_ITERATIONS', 'RISING_LIMIT', 'LAMBDA_FACTOR', 'DELTA_CLAMP_MM', 'ANGLE_TOL_DEG',
  'deg2rad', 'rad2deg', 'clampDelta', 'checkProjector', 'projectorExactMm',
  'lineRotation', 'locusBPrimeY', 'locusBY', 'inclinationThetaDeg', 'inclinationPhiDeg',
  'alphaBeta', 'projectorDxFromTL', 'projectorDxFromViews', 'trueLengthFromPlan',
  'trueLengthFromElevation', 'rabattement', 'traces', 'dampingBoost', 'solveSystem',
  'createSolver', 'solveAnalytic', 'applySolveToTable', 'solveMongeLine'].forEach(function (k) {
  ok(S[k] !== undefined, 'export ' + k);
});
pass('solver exports present');
// 4 constants 50 / 5 / x10
eq(S.MAX_ITERATIONS, 50); eq(S.MAX_ITER, 50);
eq(S.RISING_LIMIT, 5); eq(S.RISING_RESIDUAL_LIMIT, 5);
eq(S.LAMBDA_FACTOR, 10); eq(S.LAMBDA_INITIAL, 0.01);
pass('solver damping constants');
// 5 clamp 50mm, angle tol 0.01
eq(S.DELTA_CLAMP_MM, 50); eq(S.DELTA_MAX_MM, 50);
eq(S.ANGLE_TOL_DEG, 0.01); eq(S.ANGLE_TOLERANCE_DEG, 0.01);
pass('solver clamp angle constants');
// 6 deg/rad round-trip
eq(S.deg2rad(180), Math.PI);
eq(S.rad2deg(Math.PI), 180);
near(S.rad2deg(S.deg2rad(36.87)), 36.87, 1e-12, 'roundtrip');
pass('solver deg rad');
// 7 assertFinite guards
throws(function () { S.assertFinite(NaN); });
throws(function () { S.assertFinite(Infinity); });
throws(function () { S.assertFinite('x'); });
S.assertFinite(0, -1.5, 42);
pass('solver assertFinite');
// 8 checkProjector
ok(S.checkProjector({ x: 5, y: 1 }, { x: 5, y: 9 }));
ok(!S.checkProjector({ x: 5, y: 1 }, { x: 6, y: 9 }));
ok(S.checkProjector({ x: 0, y: 0 }, { x: 1e-10, y: 0 }));
ok(!S.checkProjector({ x: 0, y: 0 }, { x: 1e-8, y: 0 }));
ok(S.checkProjector({ x: 0, y: 0 }, { x: 1e-8, y: 0 }, 1e-7));
pass('solver checkProjector');
// 9 projector exact 0.000 mm
eq(S.projectorExactMm({ x: 7, y: 1 }, { x: 7, y: 9 }), '0.000');
eq(S.projectorExactMm({ x: 0, y: 0 }, { x: 1.5, y: 0 }), '1.500');
eq(S.projectorDx({ x: 7, y: 1 }, { x: 7, y: 9 }), 0);
pass('solver projector exact');
// 10 EL = TL cos phi
near(S.elevationLength(50, 60), 25, 1e-9, 'EL');
pass('solver EL cos phi');
// 11 PL = TL cos theta
near(S.planLength(100, 60), 50, 1e-9, 'PL');
pass('solver PL cos theta');
// 12 zero angles identity
eq(S.planLength(100, 0), 100);
eq(S.elevationLength(100, 0), 100);
pass('solver zero angles identity');
// 13 90 deg -> 0
near(S.planLength(100, 90), 0, 1e-9, 'PL90');
near(S.elevationLength(100, 90), 0, 1e-9, 'EL90');
pass('solver 90deg zero');
// 14 TL guard throws
throws(function () { S.planLength(-1, 30); });
throws(function () { S.planLength(NaN, 30); });
pass('solver TL guards');
// 15 lineRotation object
var lr15 = S.lineRotation({ TL: 50, thetaDeg: 60, phiDeg: 60 });
near(lr15.PL, 25, 1e-9, 'pl'); near(lr15.EL, 25, 1e-9, 'el');
eq(lr15.TL, 50); eq(lr15.thetaDeg, 60); eq(lr15.phiDeg, 60);
pass('solver lineRotation');
// 16 3-4-5 rotation
near(S.planLength(50, S.rad2deg(Math.atan2(3, 4))), 40, 1e-9, '345PL');
near(S.elevationLength(50, S.rad2deg(Math.atan2(4, 3))), 30, 1e-9, '345EL');
pass('solver 345 rotation');
// 17 EL/PL symmetric
var lr17 = S.lineRotation({ TL: 80, thetaDeg: 45, phiDeg: 45 });
near(lr17.PL, lr17.EL, 1e-12, 'sym');
pass('solver rotation symmetric');
// 18 locus B-prime y = ya-prime + TL sin theta
near(S.locusBPrimeY(10, 100, 30), 60, 1e-9, 'bprime');
eq(S.locusElevationY(10, 100, 30), S.locusBPrimeY(10, 100, 30));
pass('solver locus Bprime');
// 19 locus B y = ya - TL sin phi
near(S.locusBY(20, 100, 30), -30, 1e-9, 'b');
eq(S.locusPlanY(20, 100, 30), S.locusBY(20, 100, 30));
pass('solver locus B');
// 20 zero-angle loci identity
eq(S.locusBPrimeY(10, 100, 0), 10);
eq(S.locusBY(20, 100, 0), 20);
pass('solver loci identity');
// 21 loci 3-4-5
near(S.locusBPrimeY(0, 50, S.rad2deg(Math.atan2(3, 4))), 30, 1e-9, 'l345');
near(S.locusBY(100, 50, S.rad2deg(Math.atan2(3, 4))), 70, 1e-9, 'l345b');
pass('solver loci 345');
// 22 inclination theta acos
near(S.inclinationThetaDeg(100, 80), 36.87, 0.01, 'theta');
pass('solver theta acos');
// 23 inclination phi acos
near(S.inclinationPhiDeg(100, 60), 53.13, 0.01, 'phi');
pass('solver phi acos');
// 24 alphaBeta tans match acos
var ab24 = S.alphaBeta({ TL: 100, PL: 80, EL: 60 });
near(ab24.alphaDeg, S.inclinationThetaDeg(100, 80), 1e-9, 'alpha');
near(ab24.betaDeg, S.inclinationPhiDeg(100, 60), 1e-9, 'beta');
pass('solver alphaBeta tans');
// 25 alphaBeta zero
var ab25 = S.alphaBeta({ TL: 100, PL: 100, EL: 100 });
eq(ab25.alphaDeg, 0); eq(ab25.betaDeg, 0);
pass('solver alphaBeta zero');
// 26 inclination TL guard
throws(function () { S.inclinationThetaDeg(0, 80); });
throws(function () { S.inclinationPhiDeg(-5, 60); });
pass('solver inclination guards');
// 27 angle round-trip under 0.01 deg
var lr27 = S.lineRotation({ TL: 100, thetaDeg: 36.87, phiDeg: 53.13 });
near(S.inclinationThetaDeg(100, lr27.PL), 36.87, 0.01, 'rt-theta');
near(S.inclinationPhiDeg(100, lr27.EL), 53.13, 0.01, 'rt-phi');
pass('solver angle roundtrip');
// 28 dx from TL sqrt
eq(S.projectorDxFromTL({ TL: 7, dh: 3, dd: 6 }), 2);
pass('solver dx from TL');
// 29 dx from views sqrt
var lr29 = S.lineRotation({ TL: 100, thetaDeg: 30, phiDeg: 30 });
near(S.projectorDxFromViews({ TL: 100, PL: lr29.PL, EL: lr29.EL }), 70.71067811865476, 1e-9, 'dxv');
pass('solver dx from views');
// 30 both dx agree
var dxA30 = S.projectorDxFromTL({ TL: 100, dh: 50, dd: 50 });
near(dxA30, S.projectorDxFromViews({ TL: 100, PL: lr29.PL, EL: lr29.EL }), 1e-9, 'dxagree');
pass('solver dx agree');
// 31 negative radicand -> 0
eq(S.projectorDxFromTL({ TL: 5, dh: 4, dd: 4 }), 0);
eq(S.projectorDxFromViews({ TL: 100, PL: 10, EL: 10 }), 0);
pass('solver dx clamp zero');
// 32 rabattement 3 steps
var rb32 = S.rabattement({ ax: 0, ay: 0, TL: 50 });
eq(rb32.steps.length, 3);
deep(rb32.steps.map(function (s) { return s.step; }), [1, 2, 3]);
pass('solver rabattement 3 steps');
// 33 rabattement radii TL, finite centers/angles
rb32.steps.forEach(function (s) {
  eq(s.radius, 50);
  S.assertFinite(s.center.x, s.center.y, s.startAngleDeg, s.endAngleDeg, s.end.x, s.end.y);
});
pass('solver rabattement arcs');
// 34 rabattement deterministic + chained
var rb34 = S.rabattement({ ax: 0, ay: 0, TL: 50 });
deep(rb34, rb32);
eq(rb32.steps[1].center.x, rb32.steps[0].end.x);
eq(rb32.steps[2].center.x, rb32.steps[1].end.x);
throws(function () { S.rabattement({ TL: 0 }); });
pass('solver rabattement chain');
// 35 HT trace on XY numeric
var tr35 = S.traces({
  planA: { x: 10, y: 10 }, planB: { x: 30, y: 20 },
  elevA: { x: 10, y: 5 }, elevB: { x: 30, y: 15 }
});
eq(tr35.HTplan.y, 0);
near(tr35.HTplan.x, -10, 1e-9, 'htx');
pass('solver HT trace');
// 36 VT + vertical projector mates
near(tr35.VTelev.x, 0, 1e-9, 'vtx');
eq(tr35.VTelev.y, 0);
eq(tr35.HTelev.x, tr35.HTplan.x);
eq(tr35.VTplan.x, tr35.VTelev.x);
eq(tr35.projectorOk, true);
eq(S.projectorExactMm(tr35.VTplan, tr35.VTelev), '0.000');
pass('solver VT projector');
// 37 parallel -> null, no throw
var tr37 = S.traces({
  planA: { x: 0, y: 5 }, planB: { x: 10, y: 5 },
  elevA: { x: 0, y: 5 }, elevB: { x: 10, y: 5 }
});
eq(tr37.HTplan, null); eq(tr37.VTelev, null);
eq(tr37.projectorOk, true);
eq(S.lineXYIntersection({ x: 0, y: 5 }, { x: 10, y: 5 }), null);
pass('solver traces parallel null');
// 38 traces mixed null ok
var tr38 = S.traces({
  planA: { x: 0, y: 5 }, planB: { x: 10, y: 5 },
  elevA: { x: 10, y: 5 }, elevB: { x: 30, y: 15 }
});
eq(tr38.HTplan, null);
ok(tr38.VTelev !== null);
eq(tr38.projectorOk, true);
pass('solver traces mixed');
// 39 TL from plan 3-4-5
eq(S.trueLengthFromPlan(30, 40), 50);
pass('solver TL from plan');
// 40 TL from elev
eq(S.trueLengthFromElevation(60, 80), 100);
pass('solver TL from elev');
// 41 rotation->trapezoid recovers TL
var lr41 = S.lineRotation({ TL: 100, thetaDeg: 36.86989764584402, phiDeg: 53.13010235415598 });
near(S.trueLengthFromPlan(lr41.PL, 60), 100, 1e-9, 'tlp');
near(S.trueLengthFromElevation(lr41.EL, 80), 100, 1e-9, 'tle');
pass('solver TL roundtrip');
// 42 dh=0 identity
eq(S.trueLengthFromPlan(25, 0), 25);
eq(S.trueLengthFromElevation(25, 0), 25);
pass('solver TL identity');
// 43 analytic fixed+distance O(1) exact
var r43 = S.solveAnalytic({ A: { x: 0, y: 0, locked: true }, B: { x: 3, y: 4 } },
  [{ type: 'DISTANCE', p1: 'A', p2: 'B', d: 10 }]);
eq(r43.ok, true); eq(r43.iters, 1); eq(r43.method, 'analytic');
eq(r43.values.B.x, 6); eq(r43.values.B.y, 8);
eq(r43.values.A.x, 0);
pass('solver analytic distance');
// 44 analytic coincident
var r44 = S.solveAnalytic({ A: { x: 1, y: 2 }, B: { x: 9, y: 9 } },
  [{ type: 'COINCIDENT', p1: 'A', p2: 'B' }]);
eq(r44.ok, true);
eq(r44.values.B.x, 1); eq(r44.values.B.y, 2);
pass('solver analytic coincident');
// 45 analytic horizontal/vertical
var r45 = S.solveAnalytic({ A: { x: 0, y: 5 }, B: { x: 9, y: 1 }, C: { x: 2, y: 2 } },
  [{ type: 'HORIZONTAL', p1: 'A', p2: 'B' }, { type: 'VERTICAL', p1: 'A', p2: 'C' }]);
eq(r45.ok, true);
eq(r45.values.B.y, 5); eq(r45.values.C.x, 0);
pass('solver analytic H V');
// 46 analytic locked respected
var st46 = { A: { x: 0, y: 0, locked: true }, B: { x: 3, y: 4, locked: true } };
var r46 = S.solveAnalytic(st46, [{ type: 'DISTANCE', p1: 'A', p2: 'B', d: 10 }]);
eq(r46.ok, false);
eq(st46.B.x, 3);
pass('solver analytic locked');
// 47 analytic conflict + unknown -> ok false
var r47a = S.solveAnalytic({ A: { x: 0, y: 0 } }, [{ type: 'FIXED', point: 'ZZ', x: 1, y: 1 }]);
eq(r47a.ok, false);
var r47b = S.solveAnalytic({ A: { x: 0, y: 0 } }, [{ type: 'BOGUS' }]);
eq(r47b.ok, false);
var r47c = S.solveAnalytic({ A: { x: 0, y: 0 } }, []);
eq(r47c.ok, true);
pass('solver analytic conflict');
// 48 analytic projector exact 0.000
var r48 = S.solveAnalytic({ P: { x: 7, y: 1 }, Q: { x: 9, y: 5 } },
  [{ type: 'PROJECTOR', plan: 'P', elev: 'Q' }]);
eq(r48.ok, true);
eq(r48.values.Q.x, 7);
eq(S.projectorExactMm(r48.values.P, r48.values.Q), '0.000');
pass('solver analytic projector');
// 49 LM solves x^2=4
var s49 = S.createSolver();
var fired49 = 0;
s49.on('solver:unresolved', function () { fired49++; });
var r49 = s49.solve([1], function (x) { return [x[0] * x[0] - 4]; });
eq(r49.ok, true); eq(r49.reverted, false);
near(r49.x[0], 2, 1e-6, 'sqrt4');
eq(fired49, 0);
pass('solver LM quadratic');
// 50 LM solves 2D linear
var r50 = S.solveSystem([0, 0], function (x) { return [x[0] + x[1] - 3, x[0] - x[1] - 1]; });
eq(r50.ok, true);
near(r50.x[0], 2, 1e-6, 'x'); near(r50.x[1], 1, 1e-6, 'y');
ok(r50.iterations <= 50);
pass('solver LM linear2d');
// 51 LM delta clamp 50mm
var r51 = S.solveSystem([0], function (x) { return [x[0] + 100]; }, { maxIterations: 1 });
eq(r51.ok, false);
deep(r51.lastDelta, [-50]);
eq(r51.clampedSteps >= 1, true);
pass('solver LM clamp');
// 52 LM 50 cap + snapshot revert
var r52 = S.solveSystem([3], function () { return [1]; });
eq(r52.ok, false);
eq(r52.iterations, 50);
deep(r52.x, [3]);
eq(r52.reverted, true);
eq(r52.lambdaTrace.length, 51);
pass('solver LM cap revert');
// 53 LM emits solver:unresolved
var s53 = S.createSolver();
var got53 = [];
s53.on('solver:unresolved', function (d) { got53.push(d); });
var r53 = s53.solve([3], function () { return [1]; });
eq(r53.ok, false);
eq(got53.length, 1);
eq(got53[0].residual, 1);
eq(got53[0].iterations, 50);
pass('solver LM event');
// 54 LM lambda x10 after 5 rising
var calls54 = 0;
var r54 = S.solveSystem([0], function () { calls54++; return [100 + calls54 * 10]; });
eq(r54.ok, false);
eq(r54.iterations, 50);
near(r54.lambda, 1e8, 1e-3, 'lambda');
near(r54.lambdaTrace[5], 0.1, 1e-12, 'trace5');
near(r54.lambdaTrace[10], 1, 1e-12, 'trace10');
pass('solver LM lambda x10');
// 55 dampingBoost pure
eq(S.dampingBoost(0.01, 5), 0.1);
eq(S.dampingBoost(0.01, 4), 0.01);
eq(S.dampingBoost(2, 9), 20);
pass('solver dampingBoost');
// 56 converging solve emits nothing (global)
var fired56 = 0;
function on56() { fired56++; }
S.on('solver:unresolved', on56);
var r56 = S.solveSystem([1], function (x) { return [x[0] - 7]; });
eq(r56.ok, true);
eq(fired56, 0);
S.off('solver:unresolved', on56);
pass('solver quiet converge');
// 57 on/off listeners
var s57 = S.createSolver();
eq(s57.on('solver:unresolved', 42), false);
var n57 = 0;
function on57() { n57++; }
eq(s57.on('solver:unresolved', on57), true);
eq(s57.off('solver:unresolved', on57), true);
eq(s57.off('solver:unresolved', on57), false);
s57.solve([3], function () { return [1]; });
eq(n57, 0);
pass('solver on off');
// 58 applySolveToTable mm-only, no px keys
E.resetIdCounter();
var t58 = E.createTable();
t58.create('POINT', { x: 0, y: 0 });
eq(S.applySolveToTable(t58, [12.5, 7.25], ['E1.x', 'E1.y']), 2);
eq(t58.get('E1').x, 12.5); eq(t58.get('E1').y, 7.25);
Object.keys(t58.get('E1')).forEach(function (k) {
  ok(k.toLowerCase().indexOf('px') === -1, 'no px key ' + k);
});
pass('solver apply table');
// 59 solveMongeLine end-to-end
var m59 = S.solveMongeLine({ TL: 100, thetaDeg: 30, phiDeg: 30, yaPlan: 20, yaElev: 40 });
near(m59.PL, 86.60254037844386, 1e-9, 'pl');
near(m59.EL, 86.60254037844386, 1e-9, 'el');
near(m59.locusPlanY, -30, 1e-9, 'lp');
near(m59.locusElevY, 90, 1e-9, 'le');
near(m59.dx, 70.71067811865476, 1e-9, 'dx');
eq(m59.projectorOk, true);
ok(m59.angleErrTheta < 0.01, 'eth');
ok(m59.angleErrPhi < 0.01, 'eph');
pass('solver monge line');
// 60 determinism
function fn60(x) { return [x[0] * x[0] + x[1] * x[1] - 25, x[0] - x[1] - 1]; }
var r60a = S.solveSystem([1, 0], fn60);
var r60b = S.solveSystem([1, 0], fn60);
deep(r60a.x, r60b.x);
eq(r60a.ok, r60b.ok);
pass('solver deterministic');
// 61 degenerate sweep never throws
var ab61 = S.alphaBeta({ TL: 100, PL: 120, EL: 0 });
S.assertFinite(ab61.alphaDeg, ab61.betaDeg);
eq(S.projectorDxFromTL({ TL: 1, dh: 5, dd: 5 }), 0);
var rb61 = S.rabattement({ TL: 10 });
eq(rb61.steps.length, 3);
var ok61 = S.solveAnalytic({ A: { x: 0, y: 0 } }, []);
eq(ok61.ok, true);
pass('solver degenerate sweep');
// 62 physical feasibility: theta + phi > 90 deg is impossible
var f62a = S.lineFeasibility({ thetaDeg: 30, phiDeg: 30 });
eq(f62a.possible, true);
var f62b = S.lineFeasibility({ thetaDeg: 60, phiDeg: 60 });
eq(f62b.possible, false);
near(f62b.sin2sum, 1.5, 1e-9, 'sin2');
eq(f62b.thetaPlusPhiDeg, 120);
eq(S.lineFeasibility({ thetaDeg: 45, phiDeg: 45 }).possible, true);
var m62 = S.solveMongeLine({ TL: 50, thetaDeg: 60, phiDeg: 60, yaPlan: 0, yaElev: 0 });
eq(m62.physicallyImpossible, true);
eq(m62.dx, 0);
var m62b = S.solveMongeLine({ TL: 50, thetaDeg: 30, phiDeg: 30, yaPlan: 0, yaElev: 0 });
eq(m62b.physicallyImpossible, false);
ok(m62b.dx > 0, 'dx positive');
pass('solver feasibility flag');
// 63 line on XY reports collinear midpoint instead of null
var c63 = S.lineXYIntersection({ x: 10, y: 0 }, { x: 30, y: 0 });
eq(c63.y, 0);
near(c63.x, 20, 1e-12, 'colx');
eq(c63.collinear, true);
eq(S.lineXYIntersection({ x: 0, y: 5 }, { x: 10, y: 5 }), null);
pass('solver collinear XY');
// 64 traces propagate collinear flags, projector still exact
var tr64 = S.traces({
  planA: { x: 0, y: 0 }, planB: { x: 40, y: 0 },
  elevA: { x: 10, y: 5 }, elevB: { x: 30, y: 15 }
});
eq(tr64.HTcollinear, true);
eq(tr64.VTcollinear, false);
eq(tr64.HTplan.y, 0);
eq(tr64.projectorOk, true);
eq(S.projectorExactMm(tr64.HTplan, tr64.HTelev), '0.000');
pass('solver traces collinear');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase4 tests passed');

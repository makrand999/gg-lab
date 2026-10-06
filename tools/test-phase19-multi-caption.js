'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var L = require('../public/lib/educad-labels.js');
var Cv = require('../public/lib/educad-canvas.js');
var R = require('../public/lib/educad-reconstruct.js');
var C = require('../public/lib/educad-curriculum.js');
var E = require('../public/lib/educad-entities.js');

var ROOT = path.join(__dirname, '..');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 24;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

function pt(id, x, y, caption, role) {
  return { id: id, type: 'POINT', x: x, y: y, x2: x, y2: y,
    bisCode: 'B', viewRole: role || 'BOTH', visible: true,
    caption: caption, showLabel: true, meta: {} };
}
var VIEW = { s: 4, tx: 400, ty: 300, w: 800, h: 600 };

// 1 loads, versions, new exports
ok(/^8\.1\./.test(L.VERSION), 'labels version ' + L.VERSION);
ok(/^6\.1\./.test(C.VERSION), 'curriculum version ' + C.VERSION);
['splitCaption', 'bareName', 'isHiddenMark'].forEach(function (f) {
  eq(typeof L[f], 'function', 'labels.' + f);
});
eq(typeof Cv.captionBareParts, 'function', 'canvas.captionBareParts');
eq(typeof R.captionBases, 'function', 'reconstruct.captionBases');
pass('phase19 loads versions exports');

// 2 splitCaption parts, trims, drops empties
deep(L.splitCaption('a,b'), ['a', 'b']);
deep(L.splitCaption('a, (b) ,,'), ['a', '(b)']);
deep(L.splitCaption('a'), ['a']);
deep(L.splitCaption(''), []);
deep(L.splitCaption('   '), []);
deep(L.splitCaption(null), []);
deep(L.splitCaption(undefined), []);
pass('phase19 splitCaption');

// 3 bareName strips one paren pair
eq(L.bareName('(b)'), 'b');
eq(L.bareName(" (b') "), "b'");
eq(L.bareName('b'), 'b');
eq(L.bareName(''), '');
eq(L.bareName('(x))'), 'x)');
eq(L.bareName('((x))'), '(x)');
pass('phase19 bareName');

// 4 isHiddenMark reads the verdict
ok(L.isHiddenMark('(b)') === true, 'paren marked');
ok(L.isHiddenMark(" (b') ") === true, 'primed paren marked');
ok(L.isHiddenMark('b') === false, 'plain unmarked');
ok(L.isHiddenMark('(b') === false, 'unbalanced unmarked');
ok(L.isHiddenMark('') === false, 'empty unmarked');
pass('phase19 isHiddenMark');

// 5 collectJobs: one job per part, typed order, shared anchor
var jobs = L.collectJobs([pt('p1', 10, 20, 'a,(b)')]);
eq(jobs.length, 2, 'two jobs');
eq(jobs[0].text, 'a');
eq(jobs[1].text, '(b)');
deep(jobs[0].anchorMm, { x: 10, y: 20 });
deep(jobs[1].anchorMm, { x: 10, y: 20 });
eq(L.collectJobs([pt('p2', 0, 0, 'a')]).length, 1, 'single unchanged');
eq(L.collectJobs([pt('p3', 0, 0, ',,')]).length, 0, 'empties yield no jobs');
pass('phase19 collectJobs parts');

// 6 resolve: two placements, same id, disjoint boxes, typed order
var r6 = L.resolve([pt('p1', 10, 20, 'a,(b)')], VIEW);
eq(r6.placements.length, 2, 'two placements');
eq(r6.placements[0].entityId, 'p1');
eq(r6.placements[1].entityId, 'p1');
eq(r6.placements[0].text, 'a');
eq(r6.placements[1].text, '(b)');
ok(!L.boxesOverlap(r6.placements[0].box, r6.placements[1].box, 1),
  'parts do not overlap');
pass('phase19 resolve splits pairs');

// 7 resolve is deterministic across runs
var r7a = L.resolve([pt('p1', 10, 20, 'a,(b)'), pt('p2', -30, 5, 'c')], VIEW);
var r7b = L.resolve([pt('p1', 10, 20, 'a,(b)'), pt('p2', -30, 5, 'c')], VIEW);
deep(r7a.placements, r7b.placements);
pass('phase19 resolve deterministic');

// 8 single captions resolve exactly as before (one placement)
var r8 = L.resolve([pt('p1', 10, 20, "a'")], VIEW);
eq(r8.placements.length, 1);
eq(r8.placements[0].text, "a'");
pass('phase19 single caption unchanged');

// 9 nextPointName blocks every bare part
var t9 = E.createTable();
t9.create('POINT', { x: 0, y: 0, caption: 'a,(b)', showLabel: true });
eq(Cv.nextPointName(t9.list()), 'c', 'a and b blocked');
var t9b = E.createTable();
t9b.create('POINT', { x: 0, y: 0, caption: ',,', showLabel: true });
eq(Cv.nextPointName(t9b.list()), 'a', 'empties block nothing');
pass('phase19 nextPointName parts');

// 10 canvas mirror matches the label owner part for part
deep(Cv.captionBareParts("g,(a'),x"), ['g', "a'", 'x']);
deep(L.splitCaption('g,(a\'),x').map(L.bareName), ['g', "a'", 'x']);
deep(Cv.captionBareParts(''), []);
pass('phase19 bare parts parity');

// 11 reconstruct captionBases: sets, parens stripped, primes stripped
deep(R.captionBases('h,(b\')'), ['h', 'b']);
deep(R.captionBases('a'), ['a']);
deep(R.captionBases('a,a'), ['a']);
deep(R.captionBases(''), []);
deep(R.captionBases('(z)'), ['z']);
pass('phase19 captionBases');

// 12 shared caption parts pair across views (prism stations lift)
var prism = C.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
var r12 = R.reconstructLive(prism.entities);
eq(r12.status, 'ok', 'pair stations lift');
eq(r12.geometry.vertices.length, 12);
eq(r12.geometry.edges.length, 18);
pass('phase19 shared parts pair');

// 13 parens are invisible to 3D: verdicts never break reconstruction
var pared = prism.entities.map(function (e) {
  if (e.type !== 'POINT') return e;
  var c = {};
  for (var k in e) c[k] = e[k];
  var parts = String(c.caption).split(',');
  if (parts.length === 2) c.caption = '(' + parts[0] + '),(' + parts[1] + ')';
  else c.caption = '(' + c.caption + ')';
  return c;
});
var r13 = R.reconstructLive(pared);
eq(r13.status, 'ok', 'fully parenthesized still ok');
deep(r13.geometry, r12.geometry, 'identical solid');
pass('phase19 verdicts invisible to 3D');

// 14 breaking a shared corner caption drops exactly its two vertices;
// the rest of the wire lifts on
var wrong = prism.entities.map(function (e) {
  if (e.type !== 'POINT' || e.caption !== 'g,a') return e;
  var c = {};
  for (var k in e) c[k] = e[k];
  c.caption = 'z,y';
  return c;
});
var r14 = R.reconstructLive(wrong);
eq(r14.status, 'ok');
eq(r14.geometry.vertices.length, 10);
eq(r14.geometry.edges.length, 13);
pass('phase19 broken caption drops two');

// 15 prism corner truth: 12 corners at exact stations
var corners = prism.corners;
eq(Object.keys(corners).length, 12, 'twelve corners');
deep(corners.a.plan, { x: 17.5, y: -25.5 });
deep(corners.a.elev, { x: 17.5, y: 0 });
deep(corners.g.plan, { x: 17.5, y: -25.5 });
deep(corners.g.elev, { x: 17.5, y: 70 });
deep(corners.d.elev, { x: -17.5, y: 0 });
pass('phase19 prism corner truth');

// 16 prism stations: 6 plan pairs, 4+4 elevation (singles + pairs)
var planPts = prism.entities.filter(function (e) {
  return e.type === 'POINT' && e.viewRole === 'PLAN';
});
eq(planPts.length, 6, 'six plan stations');
planPts.forEach(function (p) {
  eq(L.splitCaption(p.caption).length, 2, p.caption + ' pairs');
});
var elevPts = prism.entities.filter(function (e) {
  return e.type === 'POINT' && e.viewRole === 'ELEVATION';
});
eq(elevPts.length, 8, 'eight elevation stations');
var singles = elevPts.filter(function (p) { return p.caption.indexOf(',') === -1; });
eq(singles.length, 4, 'outer singles');
var got = {};
elevPts.forEach(function (p) { got[p.caption] = true; });
["a'", "g'", "d'", "j'", "f',b'", "l',h'", "e',c'", "k',i'"].forEach(function (c) {
  ok(got[c], 'station ' + c);
});
pass('phase19 prism stations');

// 17 no fictional ink: prism draws no Type E; steps teach verdicts
var eCount = prism.entities.filter(function (e) { return e.bisCode === 'E'; }).length;
eq(eCount, 0, 'no Type E drawn');
ok(prism.steps.join(' ').indexOf('parens') !== -1, 'steps teach parens');
ok(prism.steps.join(' ').indexOf('Check') !== -1, 'steps point at Check');
pass('phase19 no seam');

// 18 profileSquare bundle validates with loci, projector, truth
var sq = C.profileSquare({ sizeMm: 40, xMm: 0 });
eq(sq.kind, 'profile-square');
eq(C.validateBundle(sq).ok, true, 'validates');
eq(sq.loci.length, 2, 'two loci');
eq(sq.projectors.length, 1, 'one projector');
eq(sq.projectorOk, true);
eq(Object.keys(sq.corners).length, 4, 'four corners');
deep(sq.corners.a, { plan: { x: 0, y: -8 }, elev: { x: 0, y: 40 } });
deep(sq.corners.b, { plan: { x: 0, y: -48 }, elev: { x: 0, y: 40 } });
deep(sq.corners.c, { plan: { x: 0, y: -48 }, elev: { x: 0, y: 0 } });
deep(sq.corners.d, { plan: { x: 0, y: -8 }, elev: { x: 0, y: 0 } });
pass('phase19 profileSquare bundle');

// 19 profileSquare stations pair without verdicts
var sqPts = sq.entities.filter(function (e) { return e.type === 'POINT'; });
eq(sqPts.length, 4, 'four stations');
var sqGot = {};
sqPts.forEach(function (p) { sqGot[p.caption] = true; });
["b',a'", "c',d'", 'a,d', 'b,c'].forEach(function (c) {
  ok(sqGot[c], 'station ' + c);
});
pass('phase19 square stations');

// 20 the named square lifts as wire; banked claims add the face (phase22)
var r20 = R.reconstructLive(sq.entities);
eq(r20.status, 'ok');
eq(r20.geometry.vertices.length, 4);
eq(r20.geometry.edges.length, 4);
eq(r20.geometry.faces.length, 0);
pass('phase19 square lifts as wire');

// 21 square specs insert into a real table
var t21 = E.createTable();
sq.entities.forEach(function (sp) { t21.create(sp.type, sp); });
ok(t21.count() >= 10, 'table holds ' + t21.count());
pass('phase19 square table insert');

// 22 threeViewSheet passes corner truth through
var sheet22 = C.threeViewSheet({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
deep(sheet22.corners, prism.corners, 'same corners');
pass('phase19 3view truth passthrough');

// 23 README lists the phase19 suite and the grand total
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase19`') !== -1, 'phase19 row');
ok(readme.indexOf('baseline + phases 1–46 (1047 checks)') !== -1,
  'grand total 789');
pass('phase19 readme suite row');

// 24 package.json chains the phase19 file after phase18
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase19'], 'node tools/test-phase19-multi-caption.js',
  'test:phase19 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase18-two-point-line.js') <
  pkg.scripts.test.indexOf('node tools/test-phase19-multi-caption.js'),
  'phase19 after phase18');
pass('phase19 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase19 tests passed');

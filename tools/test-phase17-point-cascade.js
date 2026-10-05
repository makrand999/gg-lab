'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var E = require('../public/lib/educad-entities.js');
var G = require('../public/lib/educad-shim.js');
var V = require('../public/lib/educad-viewport.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'mirror', 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 12;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

function freshTable() {
  E.resetIdCounter();
  return E.createTable();
}

// 1 helper exported: collect + removeCascade + line types + tolerance
eq(typeof E.collectCascadeDeleteIds, 'function', 'collect exported');
eq(typeof E.createTable().removeCascade, 'function', 'removeCascade method');
ok(E.CASCADE_LINE_TYPES.indexOf('SEGMENT') !== -1, 'SEGMENT cascades');
ok(E.CASCADE_LINE_TYPES.indexOf('LINE') !== -1, 'LINE cascades');
eq(E.COINCIDENT_TOL_MM, 1e-6, 'coincident tol');
pass('phase17 cascade helper exported');

// 2 positional cascade: two points + user line, deleting one endpoint
// removes the line; the surviving point stays.
var t2 = freshTable();
t2.create('POINT', { id: 'A', x: 0, y: 0 });
t2.create('POINT', { id: 'B', x: 10, y: 0 });
t2.create('SEGMENT', { id: 'S1', x: 0, y: 0, x2: 10, y2: 0,
  meta: { kind: 'user-line' } });
deep(E.collectCascadeDeleteIds(t2.list(), 'A'), ['A', 'S1']);
var gone2 = t2.removeCascade('A');
deep(gone2, ['A', 'S1']);
ok(!t2.has('A') && !t2.has('S1'), 'point + line gone');
ok(t2.has('B'), 'survivor stays');
pass('phase17 positional endpoint cascade');

// 3 refs cascade: a segment referencing the point dies even when its
// stored coords sit elsewhere (refs win over position).
var t3 = freshTable();
t3.create('POINT', { id: 'A', x: 0, y: 0 });
t3.create('POINT', { id: 'B', x: 10, y: 0 });
t3.create('SEGMENT', { id: 'S1', x: 100, y: 100, x2: 110, y2: 100,
  meta: { refs: ['A', 'B'] } });
deep(E.collectCascadeDeleteIds(t3.list(), 'A'), ['A', 'S1']);
pass('phase17 refs cascade independent of position');

// 4 unrelated geometry survives: a distant segment and the other point
// are untouched by the cascade.
var t4 = freshTable();
t4.create('POINT', { id: 'A', x: 0, y: 0 });
t4.create('POINT', { id: 'B', x: 10, y: 0 });
t4.create('SEGMENT', { id: 'S1', x: 0, y: 0, x2: 10, y2: 0 });
t4.create('SEGMENT', { id: 'S2', x: 50, y: 50, x2: 60, y2: 50 });
var gone4 = t4.removeCascade('A');
deep(gone4, ['A', 'S1']);
ok(t4.has('B') && t4.has('S2'), 'unrelated survive');
pass('phase17 unrelated geometry survives');

// 5 datum and locked segments never auto-delete, even when coincident.
var t5 = freshTable();
t5.create('POINT', { id: 'A', x: 0, y: 0 });
t5.create('DATUM_AXIS', { id: 'D', x: 0, y: 0, x2: 10, y2: 0 });
var lk5 = t5.create('SEGMENT', { id: 'L', x: 0, y: 0, x2: 10, y2: 0 });
t5.lock('L');
deep(E.collectCascadeDeleteIds(t5.list(), 'A'), ['A']);
var gone5 = t5.removeCascade('A');
deep(gone5, ['A']);
ok(t5.has('D') && t5.has('L'), 'datum + locked survive');
pass('phase17 datum locked survive');

// 6 transitive cascade: midpoint M of A,B dies with A, and a segment
// built on M follows in the same pass.
var t6 = freshTable();
t6.create('POINT', { id: 'A', x: 0, y: 0 });
t6.create('POINT', { id: 'B', x: 10, y: 0 });
t6.create('POINT', { id: 'C', x: 10, y: 10 });
t6.create('POINT', { id: 'M', x: 5, y: 0, meta: { refs: ['A', 'B'] } });
t6.create('SEGMENT', { id: 'S2', x: 5, y: 0, x2: 10, y2: 10,
  meta: { refs: ['M', 'C'] } });
var gone6 = E.collectCascadeDeleteIds(t6.list(), 'A');
ok(gone6.indexOf('A') !== -1 && gone6.indexOf('M') !== -1 &&
  gone6.indexOf('S2') !== -1, 'transitive set ' + gone6.join(','));
eq(gone6[0], 'A');
t6.removeCascade('A');
ok(!t6.has('M') && !t6.has('S2'), 'transitives removed');
ok(t6.has('B') && t6.has('C'), 'roots survive');
pass('phase17 transitive refs cascade');

// 7 shim deleteObject cascades (injected deps + fallback store).
function freshApplet(deps) { return G.createApplet(deps); }
var a7 = freshApplet({ entities: E, viewport: V });
a7.evalCommand('A=Point(0,0)');
a7.evalCommand('B=Point(10,0)');
a7.evalCommand('S1=Segment(A,B)');
eq(a7.deleteObject('A'), true);
ok(!a7.exists('A') && !a7.exists('S1'), 'shim point+segment gone');
ok(a7.exists('B'), 'shim survivor stays');
var f7 = freshApplet();
f7.evalCommand('A=Point(0,0)');
f7.evalCommand('B=Point(10,0)');
f7.evalCommand('S1=Segment(A,B)');
eq(f7.deleteObject('A'), true);
ok(!f7.exists('S1') && f7.exists('B'), 'fallback cascades');
pass('phase17 shim deleteObject cascades');

// 8 UI blank-delete uses removeCascade + cleanup; new segments store refs.
var index = fs.readFileSync(INDEX_PATH, 'utf8');
ok(index.indexOf('handle.table.removeCascade(w.id)') !== -1,
  'blank delete cascades');
ok(index.indexOf('cleanupAfterPointDelete(goneIds)') !== -1,
  'cleanup wired');
ok(index.indexOf('p1Ref = handle.line.p1Id') !== -1, 'p1 ref kept');
ok(index.indexOf('p2Ref = handle.line.p2Id') !== -1, 'p2 ref kept');
ok(index.indexOf('segMeta.refs = [String(p1Ref), String(p2Ref)]') !== -1,
  'segment stores refs');
pass('phase17 ui wiring cascade refs');

// 9 cleanup helper drops picks and disarms dangling anchors.
var clIdx = index.indexOf('function cleanupAfterPointDelete(goneIds)');
ok(clIdx !== -1, 'helper defined');
var clBody = index.slice(clIdx, clIdx + 1200);
ok(clBody.indexOf('handle.circlePicks.picks') !== -1, 'picks filtered');
ok(clBody.indexOf('abortLineTask()') !== -1, 'line disarmed');
ok(clBody.indexOf('abortPolarTask()') !== -1, 'polar disarmed');
pass('phase17 ui cleanup helper');

// 10 manual documents the new rule; stale claim gone; HTML rebuilt.
var md = fs.readFileSync(MD_PATH, 'utf8');
ok(md.indexOf('deleting one endpoint deletes the line') !== -1,
  'manual states cascade');
eq(md.indexOf('never deletes a segment'), -1, 'stale claim gone');
var html = fs.readFileSync(HTML_PATH, 'utf8');
ok(html.indexOf('deleting one endpoint deletes the line') !== -1,
  'html rebuilt');
pass('phase17 manual documents cascade');

// 11 README lists the phase17 suite with the new grand total.
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase17`') !== -1, 'phase17 row');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 789');
pass('phase17 readme suite row');

// 12 package.json chains the phase17 file in the test script.
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase17'], 'node tools/test-phase17-point-cascade.js',
  'test:phase17 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase17-point-cascade.js') !== -1,
  'chained in test');
pass('phase17 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase17 tests passed');

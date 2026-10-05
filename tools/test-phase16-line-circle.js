'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Cv = require('../public/lib/educad-canvas.js');
var E = require('../public/lib/educad-entities.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 12;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }

var index = fs.readFileSync(INDEX_PATH, 'utf8');
var md = fs.readFileSync(MD_PATH, 'utf8');

function bodyOf(fnName) {
  var start = index.indexOf('function ' + fnName + '(');
  ok(start !== -1, fnName + ' found');
  var end = index.indexOf('\n      function ', start + 1);
  return index.slice(start, end === -1 ? index.length : end);
}

// 1 Ctrl banks without arming: the Ctrl branch preempts parked tools,
// then banks the point (or the placed dot). No line/polar call runs
// on the Ctrl path itself.
var ctrlIdx = index.indexOf('if (e.ctrlKey || e.metaKey) {');
ok(ctrlIdx !== -1, 'ctrl branch found');
var ctrlEnd = index.indexOf('\n        if (pendingMember !== null) {', ctrlIdx);
var ctrl = index.slice(ctrlIdx, ctrlEnd);
eq(ctrl.split('bankFromPick(').length - 1, 2, 'empty + point bank');
eq(ctrl.indexOf('anchorLineTool('), -1, 'no line arm on ctrl');
eq(ctrl.indexOf('anchorPolarTool('), -1, 'no polar arm on ctrl');
['abortLineTask()', 'abortPolarTask()', 'abortPlotTask()'].forEach(function (s) {
  ok(ctrl.indexOf(s) !== -1, 'preempts ' + s);
});
ok(ctrl.indexOf('bankOverflow(cursor)') !== -1, 'cap before placing');
pass('phase16 ctrl banks arms nothing');

// 2 bankFromPick toggles with a two-slot cap: re-click unbanks, a
// third banks warns once, adds carry the optional member claim.
var bank = bodyOf('bankFromPick');
ok(bank.indexOf('bankHas(pick.cid)') !== -1, 'toggle check');
ok(bank.indexOf('bankOverflow(pick.cursor)') !== -1, 'cap enforced');
var over = bodyOf('bankOverflow');
ok(over.indexOf('EduCAD bank: ') !== -1, 'warn wired');
ok(bank.indexOf('toggleCirclePick(handle.circlePicks, pick.cid,') !== -1,
  'toggle wired');
ok(bank.indexOf('member || null') !== -1, 'claim attaches');
ok(bank.indexOf('setLineCursor(true)') !== -1, 'crosshair on bank');
eq(index.split('EduCAD bank: ').length - 1, 1, 'single warn site');
pass('phase16 bank toggle cap member');

// 3 line finalizer: one banked pick plus a plain P2 click opens the
// BIS popup; a refused pair resets to idle (never parks anchored).
var lock = bodyOf('userLockTarget');
ok(lock.indexOf('bank.length !== 1') !== -1, 'one-bank gate');
ok(lock.indexOf('anchorLineTool(handle.line, bank[0].id, p1.x, p1.y,') !== -1,
  'banked P1 with claim');
ok(lock.indexOf('lockLineTarget(handle.line, id, ent.x, ent.y)') !== -1,
  'clicked P2 locks');
ok(lock.indexOf('abortLineTool(handle.line)') !== -1, 'refuse resets');
ok(lock.indexOf('clearBank()') !== -1, 'bank empties');
ok(lock.indexOf('showLineMenu(cursor)') !== -1, 'popup opens');
pass('phase16 line finalizer menu');

// 4 circle finalizer: two banked picks plus a plain third click draw
// the circle from live table coords; rejects warn and drop the bank.
var circ = bodyOf('userCommitCircle');
ok(circ.indexOf('bank.length !== 2') !== -1, 'two-bank gate');
ok(circ.indexOf("handle.table.get(bank[0].id)") !== -1, 'live P1');
ok(circ.indexOf('circleFromThreePoints(') !== -1, 'geometry shared');
ok(circ.indexOf("handle.table.create('CIRCLE'") !== -1, 'creates CIRCLE');
ok(circ.indexOf('EduCAD circle: ') !== -1, 'reject warns');
ok(circ.indexOf('clearBank()') !== -1, 'bank empties');
pass('phase16 circle finalizer live coords');

// 5 polar starts from bank+segment, and no click phase ever parks
// anchored or awaiting-line anymore.
ok(index.indexOf('anchorPolarTool(handle.polar, p0id, p0.x, p0.y)') !== -1,
  'polar P0 from bank');
ok(index.indexOf('acceptPolarBaseline(handle.polar,') !== -1,
  'baseline immediate');
eq(index.indexOf("phase === 'anchored'"), -1, 'never parks anchored');
eq(index.indexOf("phase === 'awaitLine'"), -1, 'never parks awaitLine');
pass('phase16 polar from bank phases idle');

// 6 dead single-anchor paths are gone; the tutorial banks through
// the same action the clicks use.
eq(index.indexOf('anchorFromPick'), -1, 'no anchor helper');
eq(index.indexOf('maybeCommitCircle'), -1, 'no auto-commit');
ok(index.indexOf('bankFromPick({ cid: ent.id, cursor: tutCursor(ent) }, a.member || null)') !== -1,
  'tutorial banks');
pass('phase16 dead paths gone tutorial banks');

// 7 crosshair means banking: set on bank, cleared with the bank, and
// pointer motion preserves it while the bank is non-empty.
ok(index.indexOf('handle.circlePicks.picks.length === 0') !== -1,
  'hover keeps bank crosshair');
var clear = bodyOf('clearBank');
ok(clear.indexOf('clearCirclePicks(handle.circlePicks)') !== -1, 'clears');
ok(clear.indexOf('setLineCursor(false)') !== -1, 'crosshair off');
var clears = index.split('clearBank();').length - 1;
ok(clears >= 10, 'at least 10 bank clears wired, got ' + clears);
pass('phase16 crosshair is banking');

// 8 headless line win: the finalizer sequence (anchor+lock from bank,
// BIS stroke, commit spec); P1==P2 refused and never parks.
var line = Cv.createLineToolState();
Cv.anchorLineTool(line, 'p1', 0, 0);
eq(Cv.lockLineTarget(line, 'p1', 0, 0), false);
Cv.abortLineTool(line);
eq(line.phase, 'idle', 'refuse resets to idle');
Cv.anchorLineTool(line, 'p1', 0, 0);
eq(Cv.lockLineTarget(line, 'p2', 10, 5), true);
eq(Cv.beginLineStroke(line, 'B'), true);
var spec = Cv.finishLineStroke(line);
assert.deepStrictEqual(spec, { x1: 0, y1: 0, x2: 10, y2: 5, bisCode: 'B' });
eq(line.phase, 'idle');
pass('phase16 headless line win');

// 9 headless circle win: two banked picks plus a live third point
// commit the circumcircle and empty the bank.
var picks = Cv.createCirclePickState();
Cv.toggleCirclePick(picks, 'a', 17.5, -25.5);
Cv.toggleCirclePick(picks, 'b', 0, -8);
eq(picks.picks.length, 2);
var g = Cv.circleFromThreePoints(picks.picks[0], picks.picks[1],
  { x: -17.5, y: -25.5 });
eq(g.ok, true);
var rr = g.r < E.RADIUS_MIN_MM ? E.RADIUS_MIN_MM : g.r;
eq(rr, 17.5);
Cv.clearCirclePicks(picks);
eq(picks.picks.length, 0);
pass('phase16 headless circle win');

// 10 animating guard unchanged: plain clicks during the 300 ms stroke
// are still swallowed, never finalizing anything.
ok(index.indexOf("if (handle.line.phase === 'animating') return;") !== -1,
  'animating guard present');
pass('phase16 animating guard kept');

// 11 manual documents the bank rule in §4.3 and §4.9.
ok(md.indexOf('banking in progress') !== -1, 'crosshair rule in manual');
ok(md.indexOf('bank two, click third') !== -1, 'circle rule in manual');
ok(md.indexOf('The plain click finalizes') !== -1, 'finalizer in manual');
pass('phase16 manual documents bank');

// 12 README lists the phase16 suite with the new grand total, and
// package.json still chains the file in the test script.
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase16`') !== -1, 'phase16 row');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 838');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
ok(pkg.scripts.test.indexOf('node tools/test-phase16-line-circle.js') !== -1,
  'chained in test');
pass('phase16 readme package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase16 tests passed');

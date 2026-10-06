'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Cv = require('../public/lib/educad-canvas.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'public', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'public', 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 12;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }

var index = fs.readFileSync(INDEX_PATH, 'utf8');

function bodyOf(fnName) {
  var start = index.indexOf('function ' + fnName + '(');
  ok(start !== -1, fnName + ' found');
  var end = index.indexOf('\n      function ', start + 1);
  return index.slice(start, end === -1 ? index.length : end);
}

// 1 banked picks carry an optional corner claim; unclaimed picks keep
// the exact old {id, x, y} shape.
var s1 = Cv.createCirclePickState();
Cv.toggleCirclePick(s1, 'a', 0, 40, 'a');
eq(s1.picks.length, 1);
assert.deepStrictEqual(Object.keys(s1.picks[0]).sort(), ['id', 'member', 'x', 'y']);
eq(s1.picks[0].member, 'a');
Cv.toggleCirclePick(s1, 'b', 0, -8);
assert.deepStrictEqual(Object.keys(s1.picks[1]).sort(), ['id', 'x', 'y']);
Cv.toggleCirclePick(s1, 'a', 0, 40);
eq(s1.picks.length, 1, 'toggle drops the claim with the pick');
eq(s1.picks[0].id, 'b');
pass('phase27 claim rides the banked pick');

// 2 the two-slot cap warns once and refuses before placing: a full
// bank never mints a stray dot.
eq(index.split('EduCAD bank: ').length - 1, 1, 'single warn site');
var ctrlIdx = index.indexOf('if (e.ctrlKey || e.metaKey) {');
var overflowUse = index.indexOf('if (bankOverflow(cursor)) return;', ctrlIdx);
var placeUse = index.indexOf("handle.table.create('POINT'", ctrlIdx);
ok(overflowUse !== -1 && placeUse !== -1 && overflowUse < placeUse,
  'cap checked before placing');
pass('phase27 cap warns before placing');

// 3 (phase39) single dots bank directly with no corner question:
// drawn projectors declare correspondence, the bank only holds dots.
eq(index.indexOf('if (mparts.length >= 2 && !bankHas(cid)) {'), -1,
  'chooser gate gone');
eq(index.indexOf('showMemberMenu'), -1, 'chooser gone');
ok(index.indexOf('var cid = cids[0];') !== -1, 'single dot banks');
pass('phase27 direct bank, no chooser');

// 4 re-clicking a banked pick never finalizes: the guards name both
// banked ids before either user action runs.
ok(index.indexOf('if (id === bank[0].id) return;') !== -1, 'single guard');
ok(index.indexOf('if (id !== null && id !== bank[0].id && id !== bank[1].id) {') !== -1,
  'double guard');
pass('phase27 banked reclicks no-op');

// 5 every non-finalizer click aborts the bank: empty and segment
// clicks with two banked, empty clicks with one.
var finIdx = index.indexOf('// Finalizer: a plain click resolves the bank by count.');
ok(finIdx !== -1, 'finalizer found');
var finEnd = index.indexOf('\n        if (id === null) {', finIdx);
var fin = index.slice(finIdx, finEnd);
eq(fin.split('clearBank();').length - 1, 3, 'polar entry + two aborts');
ok(fin.indexOf('userLockTarget(id, cursor)') !== -1, 'line finalizes');
ok(fin.indexOf('userCommitCircle(id, cursor)') !== -1, 'circle finalizes');
pass('phase27 finalizer aborts rest');

// 6 Ctrl preempts parked tools before banking, so the bank always
// grows from idle line/polar/plot.
var ctrlEnd = index.indexOf('\n        if (pendingMember !== null) {', ctrlIdx);
var ctrl = index.slice(ctrlIdx, ctrlEnd);
var iAbort = ctrl.indexOf('abortPlotTask();');
var iBank = ctrl.indexOf('bankFromPick(');
ok(iAbort !== -1 && iBank !== -1 && iAbort < iBank, 'preempt then bank');
ok(ctrl.indexOf('abortLineTask();') !== -1, 'menu preempted');
ok(ctrl.indexOf('abortPolarTask();') !== -1, 'sweep preempted');
pass('phase27 banking preempts tools');

// 7 the claim chain runs bank to line: member in at bank time, out at
// the BIS popup, and a refused pair resets without parking.
var bank = bodyOf('bankFromPick');
ok(bank.indexOf('member || null') !== -1, 'claim banked');
var lock = bodyOf('userLockTarget');
ok(lock.indexOf('bank[0].member || null') !== -1, 'claim consumed');
ok(lock.indexOf('abortLineTool(handle.line)') !== -1, 'refuse resets');
var preview = index.indexOf("'for ' + lt.p1Member");
ok(preview !== -1, 'popup previews claim');
pass('phase27 claim chain bank to line');

// 8 Escape and both right-click paths empty the bank through the one
// cursor-safe helper.
var escIdx = index.indexOf("if (e.key === 'Escape') {");
ok(escIdx !== -1, 'escape found');
var escEnd = index.indexOf('// Zoom Buttons Click Handlers', escIdx);
ok(index.slice(escIdx, escEnd).indexOf('clearBank();') !== -1,
  'escape clears bank');
var ctxCount = 0;
var at = 0;
while (true) {
  var next = index.indexOf("addEventListener('contextmenu'", at);
  if (next === -1) break;
  ctxCount++;
  ok(index.slice(next, next + 1200).indexOf('clearBank();') !== -1,
    'contextmenu clears bank');
  at = next + 1;
}
eq(ctxCount, 2, 'both right-click paths');
pass('phase27 cancels empty bank');

// 9 bank plus selection coexist without merging: selecting clears a
// stale bank, and typing stays gated on an empty bank.
var sel = bodyOf('userSelectPoint');
ok(sel.indexOf('clearBank();') !== -1, 'select clears stale bank');
var gate = bodyOf('typedDistRef');
ok(gate.indexOf('circlePicks') !== -1, 'typing gated on bank');
pass('phase27 selection typing coexist');

// 10 manual documents the cap, the aborts, and the line-only claims.
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
ok(md.indexOf('the bank holds two') !== -1, 'cap documented');
ok(md.indexOf('aborts the bank instead') !== -1, 'aborts documented');
ok(md.indexOf('evaporates if the bank commits a circle') !== -1,
  'claims scoped');
ok(html.indexOf('bank two, click third') !== -1, 'html rebuilt');
pass('phase27 manual documents bank');

// 11 README lists the phase27 suite with the new grand total.
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase27`') !== -1, 'phase27 row');
ok(readme.indexOf('Pick bank: Ctrl banks, plain click finalizes') !== -1,
  'phase27 label');
ok(readme.indexOf('baseline + phases 1–46 (1047 checks)') !== -1,
  'grand total 838');
pass('phase27 readme suite row');

// 12 package.json chains the phase27 file in the test script.
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase27'], 'node tools/test-phase27-pick-bank.js',
  'test:phase27 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase27-pick-bank.js') !== -1,
  'chained in test');
pass('phase27 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase27 tests passed');

'use strict';
// EduCAD phase 31: sheet undo. Ctrl+Z (Cmd+Z on macOS) reverses the
// last sheet change on public/index.html; undo only, no redo. The
// history lives on the sheet (a snapshot stack over the live entity
// table, one step per synchronous batch); this suite pins the wiring
// statically and proves the restore mechanism on the real modules.
// Run: `npm run test:phase31`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var E = require('../public/lib/educad-entities.js');
var S = require('../public/lib/educad-saves.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 12;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

var index = fs.readFileSync(INDEX_PATH, 'utf8');
var uzDef = index.indexOf('function userUndo()');
var uzEnd = index.indexOf('\n      function ', uzDef + 1);
var uzBody = index.slice(uzDef, uzEnd);
var uzAnchor = index.indexOf('// Ctrl+Z / Cmd+Z: undo the last sheet change');
var uzAfter = index.indexOf(
  'if (e.ctrlKey || e.metaKey || e.altKey) return;', uzAnchor);
var uzBranch = index.slice(uzAnchor, uzAfter);

// 1 the sheet defines userUndo and the keydown handler calls it
ok(uzDef !== -1, 'userUndo defined');
ok(uzBranch.indexOf('userUndo();') !== -1, 'keydown calls userUndo');
pass('phase31 undo entry exists');

// 2 Ctrl+Z / Cmd+Z binding (key + layout-independent code)
ok(uzBranch.indexOf('e.ctrlKey || e.metaKey') !== -1, 'ctrl or cmd');
ok(uzBranch.indexOf("e.key === 'z'") !== -1, 'z key');
ok(uzBranch.indexOf("e.code === 'KeyZ'") !== -1, 'layout-independent code');
pass('phase31 ctrl+z binding');

// 3 undo only: shift excluded, no redo entry
ok(uzBranch.indexOf('!e.shiftKey') !== -1, 'shift excluded');
ok(index.indexOf('userRedo') === -1, 'no redo entry');
pass('phase31 undo only');

// 4 real text fields keep their keystrokes
ok(uzBranch.indexOf('document.activeElement') !== -1, 'focus guard');
['INPUT', 'TEXTAREA', 'SELECT', 'isContentEditable'].forEach(function (k) {
  ok(uzBranch.indexOf(k) !== -1, k + ' guarded');
});
pass('phase31 text field guard');

// 5 mid-rename Ctrl+Z is ignored (Escape exits the editor first)
ok(uzBranch.indexOf('handle.sel.editing !== null') !== -1, 'editing guard');
pass('phase31 rename guard');

// 6 edit mode only: the view-mode guard returns before the undo branch
var kdStart = index.indexOf(
  "window.addEventListener('keydown', function (e) {");
var viewGuard = index.indexOf(
  'if (EduCADMeasure.isView(handle.measure)) {', kdStart);
ok(kdStart !== -1 && viewGuard !== -1 && viewGuard < uzAnchor,
  'undo after view guard');
pass('phase31 edit mode only');

// 7 snapshot history: depth 50, pre-batch record, capped stack
ok(index.indexOf('var UNDO_MAX = 50;') !== -1, 'depth 50');
ok(index.indexOf('undoStack.push(undoBase);') !== -1, 'records pre-batch');
ok(index.indexOf('if (undoStack.length > UNDO_MAX) undoStack.shift();') !== -1,
  'capped');
pass('phase31 history stack');

// 8 one step per synchronous batch (microtask finalize + timer fallback)
ok(index.indexOf(
  'window.Promise.resolve().then(finalizeUndoBatch, finalizeUndoBatch)') !== -1,
  'microtask finalize');
ok(index.indexOf('setTimeout(finalizeUndoBatch, 0);') !== -1, 'timer fallback');
pass('phase31 batch atomicity');

// 9 restore reuses the saves round-trip; restores never record
ok(uzBody.indexOf(
  'EduCADSaves.restoreTable(EduCADEntities, handle.table,') !== -1,
  'saves restore');
ok(uzBody.indexOf('undoRestoring = true;') !== -1, 'suppress flag set');
ok(index.indexOf('if (undoRestoring) return;') !== -1, 'restores skip record');
pass('phase31 restore path');

// 10 post-undo sync: dangling tools dropped, both layers redrawn
ok(uzBody.indexOf('cleanupAfterPointDelete(gone)') !== -1, 'dangling tools');
ok(uzBody.indexOf('EduCADCanvas.deselect(handle.sel);') !== -1,
  'stale selection');
ok(uzBody.indexOf('EduCADMeasure.clearInspect(handle.measure);') !== -1,
  'stale readout');
ok(uzBody.indexOf('renderLayer1();') !== -1, 'layer1 redraw');
ok(uzBody.indexOf('renderLayer2(null, null);') !== -1, 'layer2 redraw');
pass('phase31 post-undo sync');

// 11 the mechanism restores exact ids through a cascade delete
E.resetIdCounter();
var t = E.createTable();
var a = t.create('POINT', { x: 0, y: 10 });
var b = t.create('POINT', { x: 0, y: -10 });
var seg = t.create('SEGMENT', { x: 0, y: 10, x2: 0, y2: -10,
  bisCode: 'B', meta: { kind: 'user-line', refs: [a.id, b.id] } });
var ids = [a.id, b.id, seg.id];
var snap = JSON.parse(JSON.stringify(t.list()));
deep(t.removeCascade(a.id), [a.id, seg.id], 'cascade order');
eq(t.count(), 1);
S.restoreTable(E, t, { entities: snap });
eq(t.count(), 3);
deep(t.list().map(function (e) { return e.id; }), ids, 'exact ids + order');
deep(t.get(seg.id).meta, { kind: 'user-line', refs: [a.id, b.id] },
  'exact meta');
pass('phase31 exact-id restore');

// 12 suite wiring: README row + grand total, package chain
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase31`') !== -1, 'phase31 row');
ok(readme.indexOf('Undo: Ctrl+Z sheet history, batch-atomic snapshots') !== -1,
  'phase31 label');
ok(readme.indexOf('baseline + phases 1–46 (1047 checks)') !== -1,
  'grand total 960');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase31'], 'node tools/test-phase31-undo.js',
  'test:phase31 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase31-undo.js') !== -1,
  'chained in test');
pass('phase31 readme + package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase31 undo tests passed');

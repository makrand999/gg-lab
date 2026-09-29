'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Cv = require('../mirror/files/www.geogebra.org/educad-canvas.js');
var V = require('../mirror/files/www.geogebra.org/educad-viewport.js');

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
function throws(fn, msg) { assert.throws(fn, Error, msg); }

function bodyOf(src, fnName) {
  var start = src.indexOf('function ' + fnName + '(');
  ok(start !== -1, fnName + ' found');
  var end = src.indexOf('\n      function ', start + 1);
  return src.slice(start, end === -1 ? src.length : end);
}

// 1 key router: digits and one dot feed the buffer, anything else is
// ignored, Backspace edits, Enter/Escape never touch the buffer here.
var s1 = Cv.createTypedDistState();
eq(Cv.isTypedDistActive(s1), false, 'fresh state idle');
eq(Cv.handleTypedDistKey(s1, '4'), 'input');
eq(Cv.handleTypedDistKey(s1, '0'), 'input');
eq(s1.buffer, '40');
eq(Cv.isTypedDistActive(s1), true, 'digits arm');
eq(Cv.handleTypedDistKey(s1, '.'), 'input');
eq(Cv.handleTypedDistKey(s1, '.'), 'ignored', 'second dot refused');
eq(s1.buffer, '40.');
eq(Cv.handleTypedDistKey(s1, 'x'), 'ignored', 'letter refused');
eq(Cv.handleTypedDistKey(s1, ' '), 'ignored', 'space refused');
eq(Cv.handleTypedDistKey(s1, '-'), 'ignored', 'minus refused');
eq(Cv.handleTypedDistKey(s1, 'Enter'), 'ignored', 'enter page-level');
eq(Cv.handleTypedDistKey(s1, 'Escape'), 'ignored', 'escape page-level');
eq(Cv.handleTypedDistKey(s1, 'Backspace'), 'input');
eq(s1.buffer, '40');
eq(Cv.handleTypedDistKey(Cv.createTypedDistState(), 'Backspace'), 'ignored',
  'empty backspace ignored');
var s1b = Cv.createTypedDistState();
for (var i1 = 0; i1 < Cv.TYPED_DIST_MAX_CHARS + 2; i1++) {
  Cv.handleTypedDistKey(s1b, '9');
}
eq(s1b.buffer.length, Cv.TYPED_DIST_MAX_CHARS, 'length capped');
throws(function () { Cv.handleTypedDistKey(null, '1'); }, 'null state throws');
pass('phase24 key router feeds digits only');

// 2 strict parse: plain and decimal millimetres validate; empty,
// lone dot, zero, sign/exponent/junk, and over-max reject by name.
deep(Cv.parseTypedDist('40'), { ok: true, value: 40 });
deep(Cv.parseTypedDist('12.5'), { ok: true, value: 12.5 });
deep(Cv.parseTypedDist('40.'), { ok: true, value: 40 });
deep(Cv.parseTypedDist('.5'), { ok: true, value: 0.5 });
eq(Cv.parseTypedDist('').reason, 'empty');
eq(Cv.parseTypedDist('.').reason, 'not-a-number');
eq(Cv.parseTypedDist('0').reason, 'not-positive');
eq(Cv.parseTypedDist('0.0').reason, 'not-positive');
eq(Cv.parseTypedDist('-5').reason, 'not-a-number');
eq(Cv.parseTypedDist('1e3').reason, 'not-a-number');
eq(Cv.parseTypedDist('4a').reason, 'not-a-number');
eq(Cv.parseTypedDist('10000').ok, true, 'max accepted');
eq(Cv.parseTypedDist('10000.01').reason, 'too-large');
eq(Cv.TYPED_DIST_MAX_MM, 10000);
pass('phase24 strict millimetre parse');

// 3 buffer lifecycle: type to arm, clear to disarm, null-safe clear.
var s3 = Cv.createTypedDistState();
Cv.handleTypedDistKey(s3, '1');
Cv.handleTypedDistKey(s3, '2');
eq(Cv.isTypedDistActive(s3), true);
Cv.clearTypedDist(s3);
eq(s3.buffer, '');
eq(Cv.isTypedDistActive(s3), false);
eq(Cv.clearTypedDist(null), null, 'null clear safe');
eq(Cv.isTypedDistActive(null), false, 'null idle');
pass('phase24 buffer lifecycle');

// 4 direction sign in world mm: lock y walks X, lock x walks Y, and
// screen-above means world-plus (the y-flip). Exact-on-ref is 0.
var v4 = V.createViewport({ s: 2, tx: 400, ty: 300, w: 800, h: 600 });
var ref4 = { x: 0, y: 20 };
eq(Cv.typedDistSign('y', { x: 500, y: 260 }, v4, ref4), 1, '+x');
eq(Cv.typedDistSign('y', { x: 300, y: 260 }, v4, ref4), -1, '-x');
eq(Cv.typedDistSign('x', { x: 400, y: 200 }, v4, ref4), 1, 'up is +y');
eq(Cv.typedDistSign('x', { x: 400, y: 320 }, v4, ref4), -1, 'down is -y');
eq(Cv.typedDistSign('y', V.forward(v4, ref4), v4, ref4), 0, 'on ref');
eq(Cv.typedDistSign('x', V.forward(v4, ref4), v4, ref4), 0, 'on ref y');
eq(Cv.typedDistSign(null, { x: 500, y: 260 }, v4, ref4), 0, 'no lock');
eq(Cv.typedDistSign('z', { x: 500, y: 260 }, v4, ref4), 0, 'bad lock');
throws(function () {
  Cv.typedDistSign('y', { x: NaN, y: 0 }, v4, ref4);
}, 'nan guard');
pass('phase24 cursor side with y-flip');

// 5 target point: axis coordinate walks, off-axis locks to the ref;
// zero sign and bad locks return null instead of guessing.
deep(Cv.typedDistPoint({ x: 0, y: 20 }, 'y', 1, 40), { xMm: 40, yMm: 20 });
deep(Cv.typedDistPoint({ x: 0, y: 20 }, 'y', -1, 40), { xMm: -40, yMm: 20 });
deep(Cv.typedDistPoint({ x: 0, y: 20 }, 'x', 1, 40), { xMm: 0, yMm: 60 });
deep(Cv.typedDistPoint({ x: 0, y: 20 }, 'x', -1, 40), { xMm: 0, yMm: -20 });
eq(Cv.typedDistPoint({ x: 0, y: 20 }, 'y', 0, 40), null, 'no direction');
eq(Cv.typedDistPoint({ x: 0, y: 20 }, null, 1, 40), null, 'no axis');
eq(Cv.typedDistPoint({ x: 0, y: 20 }, 'z', 1, 40), null, 'bad axis');
throws(function () {
  Cv.typedDistPoint({ x: 0, y: NaN }, 'y', 1, 40);
}, 'nan guard');
pass('phase24 axis target points');

// 6 headless stake-out: lock + sign + parse agree on the exact mm,
// identical at every zoom for an exactly-aimed cursor.
function stake(cursorW, distBuf, view) {
  var cursor = V.forward(view, cursorW);
  var lock = Cv.axisLockState(cursor, view, ref4);
  ok(lock.lock !== null && lock.readout !== null, 'cursor locks ' + lock.lock);
  var sign = Cv.typedDistSign(lock.lock, cursor, view, ref4);
  var parsed = Cv.parseTypedDist(distBuf);
  ok(parsed.ok, 'buffer parses');
  return Cv.typedDistPoint(ref4, lock.lock, sign, parsed.value);
}
deep(stake({ x: 50, y: 20 }, '40', v4), { xMm: 40, yMm: 20 }, '+x stake');
deep(stake({ x: -50, y: 20 }, '40', v4), { xMm: -40, yMm: 20 }, '-x stake');
deep(stake({ x: 0, y: 90 }, '40', v4), { xMm: 0, yMm: 60 }, '+y stake');
deep(stake({ x: 0, y: -70 }, '40', v4), { xMm: 0, yMm: -20 }, '-y stake');
[1, 8].forEach(function (s) {
  var vz = V.createViewport({ s: s, tx: 400, ty: 300, w: 800, h: 600 });
  deep(stake({ x: 50, y: 20 }, '40', vz), { xMm: 40, yMm: 20 },
    'zoom-proof at s=' + s);
});
pass('phase24 headless stake-out zoom-proof');

// 7 arming: the bare-selection gate names every keyboard owner plus
// the point/visible checks, so typing never fights a live gesture.
var index = fs.readFileSync(INDEX_PATH, 'utf8');
var gate = bodyOf(index, 'typedDistRef');
['handle.sel.editing', 'handle.sel.selectedId', 'isLineToolActive',
  'isPolarToolActive', 'isPlotToolActive', 'pendingMember',
  'circlePicks', "ref.type !== 'POINT'", 'visible === false'
].forEach(function (needle) {
  ok(gate.indexOf(needle) !== -1, 'gate checks ' + needle);
});
pass('phase24 bare-selection arming gate');

// 8 keydown: rename keeps precedence, then Enter stakes, Backspace
// edits, digits feed; the first Escape clears only the buffer.
var kdIdx = index.indexOf("window.addEventListener('keydown'");
ok(kdIdx !== -1, 'keydown found');
var kdEnd = index.indexOf('// Zoom Buttons Click Handlers', kdIdx);
var kd = index.slice(kdIdx, kdEnd);
ok(kd.indexOf('handleRenameKey') !== -1, 'rename kept');
ok(kd.indexOf('commitTypedDistAt(lastCursor)') !== -1, 'enter stakes');
ok(kd.indexOf("handleTypedDistKey(handle.typedDist, 'Backspace')") !== -1,
  'backspace edits');
ok(kd.indexOf('handleTypedDistKey(handle.typedDist, e.key)') !== -1,
  'digits feed');
ok(kd.indexOf('handleRenameKey') < kd.indexOf('commitTypedDistAt'),
  'rename before typing');
var kdClear = kd.indexOf('clearTypedDist');
var kdDesel = kd.indexOf('deselect(handle.sel)');
ok(kdClear !== -1 && kdDesel !== -1 && kdClear < kdDesel,
  'buffer clears before any deselect');
pass('phase24 keydown precedence two-stage escape');

// 9 commit: one buffer clear before the place, five named warns, and
// every failure returns with the buffer kept for a retry.
var commit = bodyOf(index, 'commitTypedDistAt');
ok(commit.indexOf('userPlacePoint(tgt.xMm, tgt.yMm, cursorPx)') !== -1,
  'stakes via place');
eq(commit.split('clearTypedDist').length - 1, 1, 'single clear');
ok(commit.indexOf('clearTypedDist') < commit.indexOf('userPlacePoint'),
  'clear precedes place');
eq(commit.split('EduCAD distance: ').length - 1, 5, 'five warns');
['move the cursor onto', 'move off the point', 'aim onto the X or Y',
  'parsed.message'
].forEach(function (needle) {
  ok(commit.indexOf(needle) !== -1, 'warns ' + needle);
});
pass('phase24 commit warns keep buffer');

// 10 badge + preview render in layer 2, and every pivot/abort path
// drops the buffer so nothing stale survives.
ok(index.indexOf("taxis + tbuf + ' mm (Enter)'") !== -1, 'typing badge');
ok(index.indexOf('typedDistRef() !== null') !== -1, 'badge gated');
ok(index.indexOf('drawSelectionRing(ctx2, tpx.x, tpx.y') !== -1,
  'preview ring');
ok(index.indexOf("{ color: '#0284c7' }") !== -1, 'sky preview');
var clears = index.split('clearTypedDist(handle.typedDist)').length - 1;
ok(clears >= 12, 'at least 12 buffer clears wired, got ' + clears);
pass('phase24 badge preview clears');

// 11 manual documents the gesture in §6.2 plus the keyboard/tool
// tables, and the README lists the suite with the new grand total.
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
ok(md.indexOf('zoom-proof, unlike eyeballing the cursor') !== -1,
  'gesture in §6.2');
ok(html.indexOf('zoom-proof, unlike eyeballing the cursor') !== -1,
  'html rebuilt');
ok(md.indexOf('Typed distance active') !== -1, 'keyboard rows');
ok(md.indexOf('| Typed distance | Point selected: type mm, aim axis, Enter |') !== -1,
  'tool row');
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase24`') !== -1, 'phase24 row');
ok(readme.indexOf('Typed distance: select point, type mm, Enter stakes') !== -1,
  'phase24 label');
ok(readme.indexOf('baseline + phases 1–30 (880 checks)') !== -1,
  'grand total 801');
pass('phase24 manual readme suite row');

// 12 package.json chains the phase24 file in the test script.
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase24'], 'node tools/test-phase24-typed-distance.js',
  'test:phase24 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase24-typed-distance.js') !== -1,
  'chained in test');
pass('phase24 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase24 tests passed');

'use strict';
// EduCAD phase 36: live wireframe reconstruction. Every entity with a
// defined projection in both views resolves to 3D in realtime,
// whether or not anything closes into a solid — no classes, no
// gates. Run: `npm run test:phase36`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var R = require('../public/lib/educad-reconstruct.js');

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
function throws(fn, msg) { assert.throws(fn, Error, msg); }

var nextId = 0;
function dot(x, y, caption, role) {
  return { id: 'T' + (++nextId), type: 'POINT', x: x, y: y,
    caption: caption === undefined ? '' : caption,
    viewRole: role || 'BOTH', visible: true };
}
function seg(x, y, x2, y2) {
  return { id: 'T' + (++nextId), type: 'SEGMENT', x: x, y: y,
    x2: x2, y2: y2, viewRole: 'BOTH', visible: true };
}
function proj(x, y1, y2) {
  return { id: 'T' + (++nextId), type: 'SEGMENT', x: x, y: y1,
    x2: x, y2: y2, viewRole: 'BOTH', visible: true };
}
function edgeKeys(edges) {
  return edges.map(function (e) {
    return e[0] < e[1] ? e[0] + '_' + e[1] : e[1] + '_' + e[0];
  }).sort();
}

// 1 ships; empty sheets report empty-sketch, never throw
eq(typeof R.reconstructLive, 'function', 'ships reconstructLive');
var empty = R.reconstructLive([]);
eq(empty.status, 'unavailable', 'empty unavailable');
eq(empty.reason, 'empty-sketch', 'empty reason');
eq(empty.label, 'nothing with both views drawn yet', 'empty label');
eq(empty.geometry, null, 'empty no geometry');
var nil = R.reconstructLive(null);
eq(nil.status, 'unavailable', 'null unavailable');
var lone = R.reconstructLive([dot(10, 20, "a'")]);
eq(lone.status, 'unavailable', 'single view unavailable');
eq(lone.stats.paired, 0, 'single view no verts');
var claimSheet = [
  { id: 'S1', type: 'POINT', x: 0, y: -10, caption: 'a',
    viewRole: 'BOTH', visible: true },
  { id: 'S2', type: 'POINT', x: 0, y: 10, caption: "a'",
    viewRole: 'BOTH', visible: true },
  { id: 'P1', type: 'LINE', x: 0, y: -10, x2: 0, y2: 10,
    viewRole: 'BOTH', visible: true,
    meta: { kind: 'user-line', refs: ['S1', 'S2'], fromMember: 'a' } }
];
var oneClaim = R.reconstructLive(claimSheet);
eq(oneClaim.status, 'ok', 'one claim reads as wire');
eq(oneClaim.geometry.vertices.length, 1, 'claimed dots lift');
eq(oneClaim.geometry.edges.length, 0, 'claim line never draws');
var curveSheet = [dot(0, 10, "o'"), dot(0, -10, 'o'), proj(0, -10, 10),
  { id: 'T9', type: 'CIRCLE', x: 0, y: -10, radius: 5,
    viewRole: 'BOTH', visible: true }];
var strayCurve = R.reconstructLive(curveSheet);
eq(strayCurve.status, 'ok', 'stray circle reads as wire');
eq(strayCurve.geometry.vertices.length, 1, 'dots lift past the circle');
eq(strayCurve.warnings, undefined, 'wire carries no warnings');
eq(R.reconstruct, undefined, 'class entry deleted');
pass('phase36 live basics');

// 2 a named Monge pair on its projector resolves to an exact 3D
// vertex; the same two dots without the line stay 2D-only
var bare2 = R.reconstructLive([dot(10, 20, "a'"), dot(10, -30, 'a')]);
eq(bare2.stats.paired, 0, 'no line no pair');
eq(bare2.status, 'unavailable', 'no line unavailable');
var pair = R.reconstructLive(
  [dot(10, 20, "a'"), dot(10, -30, 'a'), proj(10, -30, 20)]);
eq(pair.status, 'ok', 'pair ok');
eq(pair.geometry.faces.length, 0, 'no faces');
deep(pair.geometry.vertices, [{ x: 10, y: 20, z: 30 }], 'vertex exact');
deep(pair.geometry.edges, [], 'no edges without segments');
pass('phase36 named pair');

// 3 mismatches stay 2D-only: names, stations, duplicates — even on a
// projector line (the line connects, the names still decide)
var nameMis = R.reconstructLive(
  [dot(10, 20, "a'"), dot(10, -30, 'b'), proj(10, -30, 20)]);
eq(nameMis.stats.paired, 0, 'name mismatch no pair');
var xMis = R.reconstructLive([dot(10, 20, "a'"), dot(50, -30, 'a'),
  proj(10, -30, 20), proj(50, -30, 20)]);
eq(xMis.stats.paired, 0, 'x mismatch no pair');
var dup = R.reconstructLive(
  [dot(10, 20, "a'"), dot(10, 25, "a'"), dot(10, -30, 'a'),
    proj(10, -30, 25)]);
eq(dup.stats.paired, 0, 'duplicate base no pair');
var noMate = R.reconstructLive([dot(10, 20, "a'"), dot(10, 30, "b'")]);
eq(noMate.stats.paired, 0, 'VP-only no pair');
pass('phase36 mismatch silence');

// 4 unnamed dots auto-pair iff unique per station AND on a projector
var autoBare = R.reconstructLive([dot(10, 20), dot(10, -30)]);
eq(autoBare.stats.paired, 0, 'unnamed without line stays out');
var auto = R.reconstructLive([dot(10, 20), dot(10, -30), proj(10, -30, 20)]);
eq(auto.stats.paired, 1, 'unique unnamed pairs');
deep(auto.geometry.vertices, [{ x: 10, y: 20, z: 30 }], 'auto vertex exact');
var crowd = R.reconstructLive(
  [dot(10, 20), dot(10, 25), dot(10, -30), proj(10, -30, 25)]);
eq(crowd.stats.paired, 0, 'crowded station no pair');
var twoSt = R.reconstructLive(
  [dot(10, 20), dot(30, 20), dot(10, -30), dot(30, -5),
    proj(10, -30, 20), proj(30, -5, 20)]);
eq(twoSt.stats.paired, 2, 'two stations pair');
pass('phase36 unnamed auto-pair');

// 5 datum dots pair as either side by their mate, on a projector
var twinsBare = R.reconstructLive([dot(5, 0, 'g'), dot(5, 0, 'g')]);
eq(twinsBare.stats.paired, 0, 'datum twins without line stay out');
var twins = R.reconstructLive(
  [dot(5, 0, 'g'), dot(5, 0, 'g'), proj(5, -10, 10)]);
deep(twins.geometry.vertices, [{ x: 5, y: 0, z: 0 }], 'twins to origin line');
var dVp = R.reconstructLive(
  [dot(7, 0, 'h'), dot(7, 40, "h'"), proj(7, -10, 40)]);
deep(dVp.geometry.vertices, [{ x: 7, y: 40, z: 0 }], 'datum serves HP side');
var dHp = R.reconstructLive(
  [dot(9, 0, 'k'), dot(9, -12, 'k'), proj(9, -12, 10)]);
deep(dHp.geometry.vertices, [{ x: 9, y: 0, z: 12 }], 'datum serves VP side');
var rolePin = R.reconstructLive(
  [dot(11, 0, 'm', 'ELEVATION'), dot(11, -3, 'm'), proj(11, -3, 10)]);
deep(rolePin.geometry.vertices, [{ x: 11, y: 0, z: 3 }], 'role pins side');
var dAmbig = R.reconstructLive(
  [dot(5, 0, 'g'), dot(5, 0, 'g'), dot(5, 0, 'g'), proj(5, -10, 10)]);
eq(dAmbig.stats.paired, 0, 'triple datum no pair');
pass('phase36 datum pairing');

// 6 segments between resolved dots become 3D edges, deduped
var sheet = [dot(10, 20, "a'"), dot(10, -30, 'a'),
  dot(30, 20, "c'"), dot(30, -5, 'c'),
  proj(10, -30, 20), proj(30, -5, 20),
  seg(10, 20, 30, 20)];
var oneView = R.reconstructLive(sheet);
deep(oneView.geometry.edges, [[0, 1]], 'VP-only connect emits');
var bothViews = R.reconstructLive(sheet.concat([seg(10, -30, 30, -5)]));
deep(bothViews.geometry.edges, [[0, 1]], 'VP+HP copies dedupe');
var dangling = R.reconstructLive(sheet.concat([seg(10, 20, 99, 20)]));
deep(dangling.geometry.edges, [[0, 1]], 'unresolved endpoint ignored');
var projector = R.reconstructLive(sheet.concat([seg(10, 20, 10, -30)]));
deep(projector.geometry.edges, [[0, 1]], 'projector yields nothing');
var loopDot = R.reconstructLive(sheet.concat([seg(10, 20, 10, 20)]));
deep(loopDot.geometry.edges, [[0, 1]], 'dot loop yields nothing');
pass('phase36 live edges');

// 7 resting box: 8 corners resolve, exactly the 12 box edges emit —
// coincident stacks admit face diagonals, subsumption drops them
var box = [
  dot(0, 0, "A'"), dot(0, 0, 'A'),
  dot(35, 0, "B'"), dot(35, 0, 'B'),
  dot(0, 60, "C'"), dot(0, 0, 'C'),
  dot(35, 60, "D'"), dot(35, 0, 'D'),
  dot(0, 0, "E'"), dot(0, -35, 'E'),
  dot(35, 0, "F'"), dot(35, -35, 'F'),
  dot(0, 60, "G'"), dot(0, -35, 'G'),
  dot(35, 60, "H'"), dot(35, -35, 'H'),
  proj(0, -35, 60), proj(35, -35, 60),
  seg(0, 0, 35, 0), seg(35, 0, 35, 60),
  seg(35, 60, 0, 60), seg(0, 60, 0, 0),
  seg(0, 0, 35, 0), seg(35, 0, 35, -35),
  seg(35, -35, 0, -35), seg(0, -35, 0, 0)
];
var boxRes = R.reconstructLive(box);
eq(boxRes.status, 'ok', 'box ok');
eq(boxRes.geometry.vertices.length, 8, 'box 8 corners');
deep(boxRes.geometry.vertices[2], { x: 0, y: 0, z: 0 }, 'corner A exact');
deep(boxRes.geometry.vertices[0], { x: 0, y: 60, z: 35 }, 'corner G exact');
deep(edgeKeys(boxRes.geometry.edges),
  ['0_1', '0_4', '0_6', '1_5', '1_7', '2_3',
    '2_4', '2_6', '3_5', '3_7', '4_5', '6_7'],
  'box 12 edges, no diagonals');
pass('phase36 box equivalence');

// 8 eps option and input validation
throws(function () { R.reconstructLive([], { eps: 0 }); }, 'eps positive');
throws(function () { R.reconstructLive([], { eps: -1 }); }, 'eps not negative');
throws(function () { R.reconstructLive([], { eps: 'x' }); }, 'eps finite');
var tight = R.reconstructLive(
  [dot(10, 20, "a'"), dot(10.2, -30, 'a'), proj(10, -30, 20)],
  { eps: 0.1 });
eq(tight.stats.paired, 0, 'tight eps rejects drift');
var loose = R.reconstructLive(
  [dot(10, 20, "a'"), dot(10.2, -30, 'a'), proj(10, -30, 20)]);
eq(loose.stats.paired, 1, 'default eps tolerates drift');
pass('phase36 live options');

// 9 stats report the defined subset honestly
var st = R.reconstructLive(
  [dot(10, 20, "a'"), dot(10, -30, 'a'), dot(50, 20, "b'"),
    proj(10, -30, 20)]);
deep(st.stats, { seen: 3, paired: 1, edges: 0 }, 'stats shape');
pass('phase36 live stats');

// 10 README lists phase36 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase36`') !== -1, 'phase36 row');
ok(readme.indexOf('Live wireframe: 2D entities with both views resolve to 3D') !== -1,
  'phase36 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 960');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase36'], 'node tools/test-phase36-wire.js',
  'test:phase36 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase36-wire.js') !== -1,
  'chained in test');
pass('phase36 package wiring');

// 11 the page builds 3D from the live wireframe, needing one point
var index = fs.readFileSync(INDEX_PATH, 'utf8');
ok(index.indexOf('EduCADReconstruct.reconstructLive') !== -1,
  'bridge calls live');
ok(index.indexOf('Pose needs a point') !== -1, 'pose gate message');
pass('phase36 page wiring');

// 12 projector-shaped ink never evidences edges: a sheet-vertical
// strictly crossing both views is a helper, even untagged and even
// with refs (the tutorial-prism chord bug). Datum-touching verticals
// (one end exactly on XY) still draw.
var xa12 = dot(0, -10, 'a'), xb12 = dot(0, -40, 'b');
var xab12 = dot(0, 0, "a',b'", 'ELEVATION');
var cross12 = seg(0, -40, 0, 70);
cross12.meta = { kind: 'user-line', refs: [xb12.id, xab12.id] };
var r12a = R.reconstructLive([xa12, xb12, xab12, cross12]);
eq(r12a.status, 'ok', 'corners lift');
eq(r12a.geometry.vertices.length, 2, 'two corners');
eq(r12a.geometry.edges.length, 0, 'crossing vertical evidences nothing');
var touch12 = seg(0, -40, 0, 0);
var r12b = R.reconstructLive([xa12, xb12, xab12, touch12]);
eq(r12b.geometry.edges.length, 1, 'datum-touching vertical still draws');
pass('phase36 crossing verticals excluded');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase36 tests passed');

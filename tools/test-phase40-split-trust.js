'use strict';
// EduCAD phase 40: split pieces must prove themselves. Cutting a drawn
// line at every dot it passes over is only a guess: a chopped piece
// becomes a 3D edge only with both-views confirmation, while whole
// drawn segments keep blind trust. Inclined sheets cross third dots,
// so without this rule the lean lifts phantom edges. Run: `npm run
// test:phase40`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var R = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');

var ROOT = path.join(__dirname, '..');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 4;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

var nextId = 0;
function dot(x, y, caption, role) {
  return { id: 'T' + (++nextId), type: 'POINT', x: x, y: y,
    caption: caption === undefined ? '' : caption,
    viewRole: role || 'BOTH', visible: true };
}
function projSeg(x, y1, y2) {
  return { id: 'T' + (++nextId), type: 'SEGMENT', x: x, y: y1,
    x2: x, y2: y2, viewRole: 'BOTH', visible: true, bisCode: 'G',
    meta: { kind: 'user-line' } };
}
function seg(x, y, x2, y2) {
  return { id: 'T' + (++nextId), type: 'SEGMENT', x: x, y: y,
    x2: x2, y2: y2, viewRole: 'BOTH', visible: true };
}
function pairKey(a, b) { return a < b ? a + '-' + b : b + '-' + a; }

// Tutorial prism corners, leaned 10 degrees about Z (phase39 §10).
var CORNERS = [
  { b: 'a', x: 17.5, y: 0, py: -25.5 },
  { b: 'b', x: 8.75, y: 0, py: -10.344555 },
  { b: 'c', x: -8.75, y: 0, py: -10.344555 },
  { b: 'd', x: -17.5, y: 0, py: -25.5 },
  { b: 'e', x: -8.75, y: 0, py: -40.655445 },
  { b: 'f', x: 8.75, y: 0, py: -40.655445 },
  { b: 'g', x: 17.5, y: 70, py: -25.5 },
  { b: 'h', x: 8.75, y: 70, py: -10.344555 },
  { b: 'i', x: -8.75, y: 70, py: -10.344555 },
  { b: 'j', x: -17.5, y: 70, py: -25.5 },
  { b: 'k', x: -8.75, y: 70, py: -40.655445 },
  { b: 'l', x: 8.75, y: 70, py: -40.655445 }
];
var TH = Math.PI / 18, COS = Math.cos(TH), SIN = Math.sin(TH);
var POSED = CORNERS.map(function (c) {
  return { b: c.b, x: c.x * COS - c.y * SIN,
    y: c.x * SIN + c.y * COS, z: -c.py };
});
function baseOf(v) {
  var best = null, bd = 1e18;
  POSED.forEach(function (p) {
    var d = Math.abs(v.x - p.x) + Math.abs(v.y - p.y) + Math.abs(v.z - p.z);
    if (d < bd) { bd = d; best = p.b; }
  });
  ok(bd < 1e-6, 'vertex on a corner, off by ' + bd);
  return best;
}

// 1 the inclined prism lifts exactly: 12 corners, 18 true edges, 8 faces
ok(/^10\.6\./.test(R.VERSION), 'version ' + R.VERSION);
var elevByPos = {}, leanEnts = [];
POSED.forEach(function (p) {
  var k = p.x.toFixed(9) + ',' + p.y.toFixed(9);
  if (!elevByPos[k]) elevByPos[k] = [];
  elevByPos[k].push(p);
  leanEnts.push(dot(p.x, -p.z, p.b, 'PLAN'));
});
Object.keys(elevByPos).forEach(function (k) {
  var ms = elevByPos[k];
  var cap = ms.map(function (m) { return m.b + "'"; }).sort().join(',');
  leanEnts.push(dot(ms[0].x, ms[0].y, cap, 'ELEVATION'));
});
var byStation = {};
POSED.forEach(function (p) {
  var k = p.x.toFixed(9);
  if (!byStation[k]) byStation[k] = [];
  byStation[k].push(p);
});
Object.keys(byStation).forEach(function (k) {
  var ys = [];
  byStation[k].forEach(function (p) { ys.push(p.y, -p.z); });
  var lo = Math.min(Math.min.apply(null, ys) - 1, -1);
  var hi = Math.max(Math.max.apply(null, ys) + 1, 1);
  leanEnts.push(projSeg(byStation[k][0].x, lo, hi));
});
var RING = [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'e'], ['e', 'f'],
  ['f', 'a'], ['g', 'h'], ['h', 'i'], ['i', 'j'], ['j', 'k'], ['k', 'l'],
  ['l', 'g'], ['a', 'g'], ['b', 'h'], ['c', 'i'], ['d', 'j'], ['e', 'k'],
  ['f', 'l']];
var byBase = {};
POSED.forEach(function (p) { byBase[p.b] = p; });
RING.forEach(function (pr) {
  var u = byBase[pr[0]], w = byBase[pr[1]];
  leanEnts.push(seg(u.x, u.y, w.x, w.y));
  leanEnts.push(seg(u.x, -u.z, w.x, -w.z));
});
var r1 = R.reconstructLive(leanEnts);
eq(r1.status, 'ok', 'inclined lifts');
eq(r1.geometry.vertices.length, 12, 'twelve corners');
eq(r1.geometry.edges.length, 18, 'eighteen edges, no more');
deep(r1.geometry.vertices.map(baseOf).sort(),
  'abcdefghijkl'.split(''), 'each corner once');
deep(r1.geometry.edges.map(function (e) {
  return pairKey(baseOf(r1.geometry.vertices[e[0]]),
    baseOf(r1.geometry.vertices[e[1]]));
}).sort(), RING.map(function (pr) { return pairKey(pr[0], pr[1]); }).sort(),
  'exactly the true edge set');
eq(r1.geometry.faces.length, 8, 'shell closes');
pass('phase40 inclined prism lifts exact');

// 2 a crossed single-view line stays silent: the split makes the
// reading ambiguous (a-b? a-c? c-b?) and no mate resolves it, so
// nothing emits rather than something wrong.
var r2 = R.reconstructLive([
  dot(0, 0, 'a', 'PLAN'), dot(0, 10, "a'", 'ELEVATION'),
  dot(10, 0, 'b', 'PLAN'), dot(10, 10, "b'", 'ELEVATION'),
  dot(5, 0, 'c', 'PLAN'), dot(5, 10, "c'", 'ELEVATION'),
  projSeg(0, -5, 10), projSeg(10, -5, 10), projSeg(5, -5, 10),
  seg(0, 0, 10, 0)]);
eq(r2.geometry.vertices.length, 3, 'three corners pair');
deep(r2.geometry.edges, [], 'ambiguous split emits nothing');
pass('phase40 crossed singles emit nothing');

// 3 T-junctions still work: split pieces with mates drawn in both
// views confirm into edges, same as before.
var r3 = R.reconstructLive([
  dot(0, 0, 'a', 'PLAN'), dot(0, 10, "a'", 'ELEVATION'),
  dot(10, 0, 'b', 'PLAN'), dot(10, 10, "b'", 'ELEVATION'),
  dot(5, 0, 'c', 'PLAN'), dot(5, 10, "c'", 'ELEVATION'),
  dot(5, -8, 'd', 'PLAN'), dot(5, 18, "d'", 'ELEVATION'),
  projSeg(0, -5, 10), projSeg(10, -5, 10), projSeg(5, -8, 18),
  seg(0, 0, 10, 0), seg(5, 0, 5, -8),
  seg(0, 10, 10, 10), seg(5, 10, 5, 18)]);
function base3(v) {
  var best = null, bd = 1e18;
  [{ b: 'a', x: 0, y: 10, z: 0 }, { b: 'b', x: 10, y: 10, z: 0 },
   { b: 'c', x: 5, y: 10, z: 0 }, { b: 'd', x: 5, y: 18, z: 8 }
  ].forEach(function (p) {
    var d = Math.abs(v.x - p.x) + Math.abs(v.y - p.y) + Math.abs(v.z - p.z);
    if (d < bd) { bd = d; best = p.b; }
  });
  ok(bd < 1e-6, 'T vertex exact');
  return best;
}
deep(r3.geometry.edges.map(function (e) {
  return pairKey(base3(r3.geometry.vertices[e[0]]),
    base3(r3.geometry.vertices[e[1]]));
}).sort(), ['a-c', 'b-c', 'c-d'], 'T pieces confirm');
pass('phase40 T-junctions confirm');

// 4 README lists phase40 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase40`') !== -1, 'phase40 row');
ok(readme.indexOf('Split pieces need both-views proof; whole lines keep trust') !== -1,
  'phase40 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 1039');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase40'], 'node tools/test-phase40-split-trust.js',
  'test:phase40 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase40-split-trust.js') !== -1,
  'chained in test');
pass('phase40 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase40 tests passed');

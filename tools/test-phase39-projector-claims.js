'use strict';
// EduCAD phase 39: drawn projectors declare correspondence. A Type G
// (or projector-kind) vertical crossing XY pairs the same-letter
// corners stacked on it — no banked claim, no popup question. The
// student draws; the sheet declares. Banked member claims still work
// (scripted lessons) and win ties; the "Draw for which corner?" menu
// is retired, the "Bank which dot?" picker stays. Run: `npm run
// test:phase39`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var R = require('../public/lib/educad-reconstruct.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'public', 'index.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 12;
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
function projSeg(x, y1, y2, kind) {
  return { id: 'T' + (++nextId), type: 'SEGMENT', x: x, y: y1,
    x2: x, y2: y2, viewRole: 'BOTH', visible: true, bisCode: 'G',
    meta: { kind: kind || 'user-line' } };
}

// One stacked station: plan carries g+a, elevation splits them.
function station() {
  return [dot(0, -25, 'g,a', 'PLAN'), dot(0, 0, "a'", 'ELEVATION'),
    dot(0, 70, "g'", 'ELEVATION')];
}

// 1 a drawn Type G projector pairs the stack: no banked claim anywhere.
// The off-line duplicate kills positional pairing for a, so only the
// projector's incidence can pair it.
ok(/^10\.6\./.test(R.VERSION), 'version ' + R.VERSION);
var dup1 = dot(5, -25, 'a', 'PLAN');
var r1 = R.reconstructLive(station().concat([dup1, projSeg(0, -25, 70)]));
eq(r1.status, 'ok', 'station ok');
eq(r1.stats.paired, 2, 'both corners pair');
deep(r1.geometry.vertices, [{ x: 0, y: 70, z: 25 }, { x: 0, y: 0, z: 25 }],
  'g positional first, a rescued after');
pass('phase39 drawn projector pairs stacks');

// 2 curriculum projector-kind ink claims identically (no bisCode needed)
var kindSeg = projSeg(0, -25, 70, 'projector');
delete kindSeg.bisCode;
var dup2 = dot(5, -25, 'a', 'PLAN');
var r2 = R.reconstructLive(station().concat([dup2, kindSeg]));
deep(r2.geometry.vertices, r1.geometry.vertices, 'same vertices');
pass('phase39 projector-kind ink claims');

// 3 same-letter rule: mismatched feet never pair, matched ones still do
var r3 = R.reconstructLive([dot(0, -25, 'a', 'PLAN'),
  dot(0, 70, "b'", 'ELEVATION'), projSeg(0, -25, 70)]);
eq(r3.stats.paired, 0, 'a to b never pairs');
var r3b = R.reconstructLive([dot(0, -25, 'a', 'PLAN'),
  dot(0, 70, "b'", 'ELEVATION'), dot(0, 40, "a'", 'ELEVATION'),
  projSeg(0, -25, 70)]);
eq(r3b.stats.paired, 1, 'a pairs past b');
deep(r3b.geometry.vertices, [{ x: 0, y: 40, z: 25 }], 'a exact');
pass('phase39 same-letter rule');

// 4 duplicates never guess: two elev owners void that base only
var r4 = R.reconstructLive([dot(0, -25, 'g,a', 'PLAN'),
  dot(0, 0, "a'", 'ELEVATION'), dot(0, 5, "a'", 'ELEVATION'),
  dot(0, 70, "g'", 'ELEVATION'), projSeg(0, -25, 70)]);
eq(r4.stats.paired, 1, 'g pairs, a stays 2D');
deep(r4.geometry.vertices, [{ x: 0, y: 70, z: 25 }], 'g exact');
pass('phase39 duplicates never guess');

// 5 hidden-mark corners pair separately: parens invisible to pairing
var r5 = R.reconstructLive([dot(0, -25, 'a,(b)', 'PLAN'),
  dot(0, 0, "a'", 'ELEVATION'), dot(0, 70, "b'", 'ELEVATION'),
  projSeg(0, -25, 70)]);
eq(r5.stats.paired, 2, 'hidden b pairs too');
deep(r5.geometry.vertices, [{ x: 0, y: 0, z: 25 }, { x: 0, y: 70, z: 25 }],
  'both exact');
pass('phase39 hidden marks pair');

// 6 shape gate: same-view, diagonal, axis-kind, and empty lines claim nothing
// (duplicated plan feet kill positional pairing, isolating the line)
function dupPair() {
  return [dot(0, -25, 'a', 'PLAN'), dot(0, -40, 'a', 'PLAN'),
    dot(0, 70, "a'", 'ELEVATION')];
}
var sameView = { id: 'T' + (++nextId), type: 'SEGMENT', x: 0, y: 60,
  x2: 0, y2: 70, viewRole: 'BOTH', visible: true, bisCode: 'G',
  meta: { kind: 'user-line' } };
var r6a = R.reconstructLive(dupPair().concat([sameView]));
eq(r6a.stats.paired, 0, 'short same-view line claims nothing');
var diag = { id: 'T' + (++nextId), type: 'SEGMENT', x: 0, y: -40,
  x2: 2, y2: 70, viewRole: 'BOTH', visible: true, bisCode: 'G',
  meta: { kind: 'user-line' } };
var r6b = R.reconstructLive(dupPair().concat([diag]));
eq(r6b.stats.paired, 0, 'diagonal claims nothing');
var axis = projSeg(0, -40, 70, 'axis');
var r6c = R.reconstructLive(dupPair().concat([axis]));
eq(r6c.stats.paired, 0, 'axis kind never claims');
var locus = projSeg(0, -40, 70, 'locus');
var r6e = R.reconstructLive(dupPair().concat([locus]));
eq(r6e.stats.paired, 0, 'locus kind never claims');
var r6d = R.reconstructLive([projSeg(0, -25, 70)]);
eq(r6d.status, 'unavailable', 'empty projector reads quiet');
pass('phase39 shape gate');

// 7 banked claims keep precedence: consumed dots never re-pair
var p7a = dot(0, -25, 'a', 'PLAN'), p7b = dot(0, -30, 'a', 'PLAN');
var e7 = dot(0, 70, "a'", 'ELEVATION');
var banked7 = { id: 'T' + (++nextId), type: 'SEGMENT', x: 0, y: -25,
  x2: 0, y2: 70, viewRole: 'BOTH', visible: true,
  meta: { kind: 'user-line', refs: [p7a.id, e7.id], fromMember: 'a' } };
var r7 = R.reconstructLive([p7a, p7b, e7, banked7, projSeg(0, -30, 70)]);
eq(r7.stats.paired, 1, 'exactly one vertex');
deep(r7.geometry.vertices, [{ x: 0, y: 70, z: 25 }], 'banked foot wins');
var q7a = dot(0, -25, 'a', 'PLAN'), q7b = dot(0, -40, 'a', 'PLAN');
var f7 = dot(0, 70, "a'", 'ELEVATION');
var r7b = R.reconstructLive([q7a, q7b, f7, projSeg(0, -30, 70)]);
eq(r7b.stats.paired, 1, 'span picks the covered duplicate');
deep(r7b.geometry.vertices, [{ x: 0, y: 70, z: 25 }], 'covered foot pairs');
pass('phase39 banked claims keep precedence');

// 8 span gate: dots beyond the drawn ends or off the line stay out
// (duplicates force the projector to choose by coverage, not names)
var r8 = R.reconstructLive([dot(0, -25, 'a', 'PLAN'),
  dot(0, -5, 'a', 'PLAN'), dot(0, 70, "a'", 'ELEVATION'),
  projSeg(0, -10, 70)]);
eq(r8.stats.paired, 1, 'only the covered foot pairs');
deep(r8.geometry.vertices, [{ x: 0, y: 70, z: 5 }], 'covered foot exact');
var r8b = R.reconstructLive([dot(5, -25, 'a', 'PLAN'),
  dot(0, 70, "a'", 'ELEVATION'), projSeg(0, -25, 70)]);
eq(r8b.stats.paired, 0, 'off-line foot stays 2D');
pass('phase39 span gate');

// 9 the page retires the member menu and keeps the dot picker
var index = fs.readFileSync(INDEX_PATH, 'utf8');
eq(index.indexOf('Draw for which corner?'), -1, 'member title gone');
eq(index.indexOf('showMemberMenu'), -1, 'member menu gone');
eq(index.indexOf('hideMemberMenu'), -1, 'member hide gone');
ok(index.indexOf('Bank which dot?') !== -1, 'dot menu kept');
ok(index.indexOf('showDotMenu') !== -1, 'dot menu ships');
ok(index.indexOf('hideDotMenu') !== -1, 'dot menu closes');
ok(index.indexOf('hitTestPointAll') !== -1, 'stack gather kept');
pass('phase39 member menu retired');

// 10 a 10-degree Z lean splits 4 stations into 8: the rest-pose
// projectors keep the bottom cap and lose the top cap. This pins the
// pose-mode gap as fact: inclined corners need new stations.
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
var TH10 = Math.PI / 18, COS10 = Math.cos(TH10), SIN10 = Math.sin(TH10);
var POSED = CORNERS.map(function (c) {
  return { b: c.b, x: c.x * COS10 - c.y * SIN10,
    y: c.x * SIN10 + c.y * COS10, z: -c.py };
});
var REST_PROJ = [
  { x: 17.5, lo: -25.5, hi: 70 }, { x: -17.5, lo: -25.5, hi: 70 },
  { x: 8.75, lo: -40.655445, hi: 70 }, { x: -8.75, lo: -40.655445, hi: 70 }
];
var stations10 = {};
POSED.forEach(function (p) { stations10[p.x.toFixed(9)] = 1; });
eq(Object.keys(stations10).length, 8, 'lean splits into 8 stations');
var covered10 = POSED.filter(function (p) {
  return REST_PROJ.some(function (r) {
    return Math.abs(p.x - r.x) <= 0.5 &&
      p.y >= r.lo - 0.5 && p.y <= r.hi + 0.5 &&
      -p.z >= r.lo - 0.5 && -p.z <= r.hi + 0.5;
  });
}).map(function (p) { return p.b; }).sort();
deep(covered10, ['a', 'b', 'c', 'd', 'e', 'f'],
  'rest projectors keep the bottom cap only');
pass('phase39 lean splits stations');

// 11 the inclined prism pairs whole on derived projectors: one line
// per new station, plus an off-station duplicate that only the
// projector's span can overrule. Pairing only — inclined outline
// edges cross third dots, a separate pre-existing edge-stage
// limitation left for the pose discussion.
var elevByPos = {}, planDots = [];
POSED.forEach(function (p) {
  var k = p.x.toFixed(9) + ',' + p.y.toFixed(9);
  if (!elevByPos[k]) elevByPos[k] = [];
  elevByPos[k].push(p);
  planDots.push(dot(p.x, -p.z, p.b, 'PLAN'));
});
planDots.push(dot(30, -25.5, 'a', 'PLAN'));
var leanEnts = planDots.slice();
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
var r11 = R.reconstructLive(leanEnts);
eq(r11.status, 'ok', 'inclined pairs');
eq(r11.geometry.vertices.length, 12, 'twelve corners pair');
function vkey(v) {
  return v.x.toFixed(6) + ',' + v.y.toFixed(6) + ',' + v.z.toFixed(6);
}
deep(r11.geometry.vertices.map(vkey).sort(),
  POSED.map(function (p) { return vkey({ x: p.x, y: p.y, z: p.z }); }).sort(),
  'vertices match the lean math');
pass('phase39 inclined prism pairs whole');

// 12 README lists phase39 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase39`') !== -1, 'phase39 row');
ok(readme.indexOf('Projector-read claims: drawn Type G pairs stacks, menu retired') !== -1,
  'phase39 label');
ok(readme.indexOf('baseline + phases 1–46 (1047 checks)') !== -1,
  'grand total 990');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase39'], 'node tools/test-phase39-projector-claims.js',
  'test:phase39 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase39-projector-claims.js') !== -1,
  'chained in test');
pass('phase39 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase39 tests passed');

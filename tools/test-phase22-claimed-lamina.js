'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var R = require('../public/lib/educad-reconstruct.js');
var C = require('../public/lib/educad-curriculum.js');

var ROOT = path.join(__dirname, '..');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var PS_PATH = path.join(ROOT, 'docs', '2d3d-problem-statement.md');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 20;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

function tutPt(id, x, y, caption, role) {
  return { id: id, type: 'POINT', x: x, y: y, x2: x, y2: y,
    bisCode: 'B', viewRole: role, visible: true,
    caption: caption, showLabel: true, meta: {} };
}
function tutLine(id, x1, y1, x2, y2, bis, refs, member) {
  var meta = { kind: 'user-line', refs: refs };
  if (member) meta.fromMember = member;
  return { id: id, type: 'SEGMENT', x: x1, y: y1, x2: x2, y2: y2,
    bisCode: bis, viewRole: 'BOTH', visible: true, caption: '',
    showLabel: false, meta: meta };
}
function datum(id) {
  return { id: id, type: 'DATUM_AXIS', x: -30, y: 0, x2: 30, y2: 0,
    bisCode: 'G', viewRole: 'BOTH', visible: true, caption: 'XY',
    showLabel: true, meta: { kind: 'XY' } };
}
function endState() {
  return [
    datum('XY'),
    tutPt('S1', 0, 40, "b',(a')", 'ELEVATION'),
    tutPt('S2', 0, 0, "c',(d')", 'ELEVATION'),
    tutPt('S3', 0, -8, 'a,(d)', 'PLAN'),
    tutPt('S4', 0, -48, 'b,(c)', 'PLAN'),
    tutLine('E1', 0, 40, 0, 0, 'A', ['S1', 'S2']),
    tutLine('E2', 0, -8, 0, -48, 'A', ['S3', 'S4']),
    tutLine('P1', 0, 40, 0, -8, 'G', ['S1', 'S3'], 'a'),
    tutLine('P2', 0, 40, 0, -48, 'G', ['S1', 'S4'], 'b'),
    tutLine('P3', 0, 0, 0, -48, 'G', ['S2', 'S4'], 'c'),
    tutLine('P4', 0, 0, 0, -8, 'G', ['S2', 'S3'], 'd')
  ];
}
// 1 version bump, zero deps kept
ok(/^10\.6\./.test(R.VERSION), 'version ' + R.VERSION);
var SRC = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'educad-reconstruct.js'), 'utf8');
ok(SRC.indexOf('require(') === -1, 'zero deps');
ok(SRC.indexOf('function tryClaimedCorners(') !== -1, 'claims reader kept');
pass('phase22 loads claims reader');

// 2 claimed square lifts: unclassified lamina, full coverage
var r2 = R.reconstructLive(endState());
eq(r2.status, 'ok');
eq(r2.class, null);
deep(r2.coverage, { plan: 1, elev: 1 });
eq(r2.geometry.vertices.length, 4);
eq(r2.geometry.edges.length, 4);
eq(r2.geometry.faces.length, 2, 'double-wound lamina');
pass('phase22 square lifts');

// 3 exact lifted geometry: member order, hull boundary, no diagonals
deep(r2.geometry.vertices, [
  { x: 0, y: 40, z: 8 }, { x: 0, y: 40, z: 48 },
  { x: 0, y: 0, z: 48 }, { x: 0, y: 0, z: 8 }
]);
deep(r2.geometry.edges, [[3, 2], [2, 1], [1, 0], [0, 3]]);
deep(r2.geometry.faces, [[3, 2, 1, 0], [0, 1, 2, 3]]);
pass('phase22 exact lamina');

// 4 bare square lifts as wire (claims add the face in test 2)
var sq = C.profileSquare({ sizeMm: 40, xMm: 0 });
var r4 = R.reconstructLive(sq.entities);
eq(r4.status, 'ok');
eq(r4.class, null);
eq(r4.geometry.vertices.length, 4);
eq(r4.geometry.edges.length, 4);
eq(r4.geometry.faces.length, 0);
pass('phase22 bare square lifts wire');

// 5 wrong foot duplicates a corner, named
var bad5 = endState();
bad5.forEach(function (e) {
  if (e.id === 'P1') { e.y2 = -48; e.meta.refs = ['S1', 'S4']; }
});
var r5 = R.reconstructLive(bad5);
eq(r5.status, 'unavailable');
eq(r5.reason, 'duplicate-corners');
ok(r5.label.indexOf('"a"') !== -1 && r5.label.indexOf('"b"') !== -1,
  'names both: ' + r5.label);
pass('phase22 duplicate corners');

// 6 one corner claimed two ways conflicts
var bad6 = endState();
bad6.push(tutLine('P5', 0, 40, 0, -48, 'G', ['S1', 'S4'], 'a'));
var r6 = R.reconstructLive(bad6);
eq(r6.reason, 'hint-conflict');
ok(r6.label.indexOf('pairs two ways') !== -1, r6.label);
pass('phase22 double pairing conflicts');

// 7 a renamed-away member is stale and surfaces as a stale claim;
// a fully renamed station reports the same breakage, never a guess
var bad7 = endState();
bad7.forEach(function (e) { if (e.id === 'S1') e.caption = "b',x'"; });
var r7 = R.reconstructLive(bad7);
eq(r7.reason, 'hint-conflict');
ok(r7.label.indexOf('left its station') !== -1, r7.label);
var bad7b = endState();
bad7b.forEach(function (e) { if (e.id === 'S1') e.caption = 'x,y'; });
var r7b = R.reconstructLive(bad7b);
eq(r7b.reason, 'hint-conflict', 'renamed member surfaces');
ok(r7b.label.indexOf('left its station') !== -1, r7b.label);
pass('phase22 stale claim surfaced');

// 8 unresolvable feet fail loose
var bad8 = endState();
bad8.forEach(function (e) {
  if (e.id === 'P1') e.meta.refs = ['S1', 'QX'];
});
var r8 = R.reconstructLive(bad8);
eq(r8.reason, 'hint-loose-foot');
pass('phase22 loose foot');

// 9 claims across x stations leave the profile plane
var bad9 = endState();
bad9.push(tutPt('S5', 10, 40, "e'", 'ELEVATION'));
bad9.push(tutPt('S6', 10, -8, 'e', 'PLAN'));
bad9.push(tutLine('P5', 10, 40, 10, -8, 'G', ['S5', 'S6'], 'e'));
var r9 = R.reconstructLive(bad9);
eq(r9.reason, 'corners-not-coplanar');
pass('phase22 non-coplanar');

// 10 interior corner breaks the hull, named
var bad10 = endState();
bad10.push(tutPt('S5', 0, 20, "e'", 'ELEVATION'));
bad10.push(tutPt('S6', 0, -20, 'e', 'PLAN'));
bad10.push(tutLine('P5', 0, 20, 0, -20, 'G', ['S5', 'S6'], 'e'));
var r10 = R.reconstructLive(bad10);
eq(r10.reason, 'non-convex-corners');
ok(r10.label.indexOf('"e"') !== -1, r10.label);
pass('phase22 interior corner');

// 11 two claims cannot bound a face: the corners lift as wire instead
var few11 = endState().filter(function (e) {
  return e.id !== 'P3' && e.id !== 'P4';
});
var r11 = R.reconstructLive(few11);
eq(r11.status, 'ok');
eq(r11.class, null);
eq(r11.geometry.vertices.length, 4);
eq(r11.geometry.edges.length, 4);
eq(r11.geometry.faces.length, 0);
pass('phase22 two claims lift wire');

// 12 three claims lift a triangle (lamina grows as claims land)
var tri12 = endState().filter(function (e) { return e.id !== 'P4'; });
var r12 = R.reconstructLive(tri12);
eq(r12.status, 'ok');
eq(r12.class, null);
eq(r12.geometry.vertices.length, 3);
eq(r12.geometry.edges.length, 3);
pass('phase22 triangle at three');

// 13 slanted lines are not claims: the dots lift as wire, claim-free
var flat13 = endState().filter(function (e) {
  return e.id !== 'P1' && e.id !== 'P2' && e.id !== 'P3' && e.id !== 'P4';
});
flat13.push(tutLine('P9', 0, 40, 5, -8, 'G', ['S1', 'S3'], 'a'));
flat13.push(tutLine('PJ', 0, -48, 0, 40, 'G', []));
var r13 = R.reconstructLive(flat13);
eq(r13.status, 'ok');
eq(r13.geometry.vertices.length, 4);
eq(r13.geometry.edges.length, 4);
eq(r13.geometry.faces.length, 0);
pass('phase22 slanted claims ignored');

// 14 prism success never consults hints
var prism = C.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
var withIds = prism.entities.map(function (e, i) {
  var c = {};
  for (var k in e) c[k] = e[k];
  c.id = 'D' + i;
  return c;
});
function prismPt(caption) {
  for (var i = 0; i < withIds.length; i++) {
    if (withIds[i].type === 'POINT' && withIds[i].caption === caption) return withIds[i];
  }
  return null;
}
var outer = prismPt("a'"), foot = prismPt('g,a');
withIds.push(tutLine('Q1', outer.x, outer.y, foot.x, foot.y, 'G',
  [outer.id, foot.id], 'a'));
withIds.push(tutLine('Q2', outer.x, outer.y, foot.x, foot.y, 'G',
  [outer.id, foot.id], 'g'));
var r14 = R.reconstructLive(withIds);
eq(r14.status, 'ok');
eq(r14.class, null);
eq(r14.geometry.vertices.length, 12);
eq(r14.geometry.edges.length, 18);
deep(r14.geometry, R.reconstructLive(prism.entities).geometry,
  'two stray claims change nothing');
pass('phase22 hints never perturb success');

// 15 legacy opts are retired: claims route to the reader regardless
var r15 = R.reconstructLive(endState(), { strictNames: false });
eq(r15.status, 'ok');
deep(r15.geometry, r2.geometry, 'identical lamina');
pass('phase22 legacy opts retired');

// 16 input order never moves the solid
var rev16 = endState().slice().reverse();
var r16 = R.reconstructLive(rev16);
eq(r16.status, 'ok');
deep(r16.geometry, r2.geometry, 'identical solid');
pass('phase22 deterministic');

// 17 new reasons read exactly
deep([R.REASON_LABELS['hint-conflict'], R.REASON_LABELS['hint-loose-foot'],
  R.REASON_LABELS['duplicate-corners'], R.REASON_LABELS['corners-not-coplanar'],
  R.REASON_LABELS['non-convex-corners']],
  ['projector claims contradict each other',
    'a claim foot lands off drawn vertices',
    'two corners lift to one 3D point',
    'claimed corners leave the profile plane',
    'claimed corners bound no convex face']);
pass('phase22 reason labels');

// 18 manual teaches the live wireframe (classes retired in phase36); contract keeps Class E
var md = fs.readFileSync(MD_PATH, 'utf8');
var ps = fs.readFileSync(PS_PATH, 'utf8');
ok(md.indexOf('live wireframe') !== -1, 'manual live wireframe');
ok(md.indexOf('nothing with both views') !== -1, 'manual quiet state');
ok(ps.indexOf('Class E') !== -1, 'contract Class E');
ok(ps.indexOf('M5 amendment') !== -1, 'contract M5');
pass('phase22 docs sync');

// 19 README lists the phase22 suite and the grand total
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase22`') !== -1, 'phase22 row');
ok(readme.indexOf('baseline + phases 1–46 (1047 checks)') !== -1,
  'grand total 789');
pass('phase22 readme suite row');

// 20 package.json chains the phase22 file after phase21
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase22'], 'node tools/test-phase22-claimed-lamina.js',
  'test:phase22 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase21-tutorial.js') <
  pkg.scripts.test.indexOf('node tools/test-phase22-claimed-lamina.js'),
  'phase22 after phase21');
pass('phase22 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase22 tests passed');

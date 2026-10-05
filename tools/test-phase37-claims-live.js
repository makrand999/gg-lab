'use strict';
// EduCAD phase 37: claims decide. A banked corner choice (meta.fromMember)
// is the student's explicit declaration, so the live wireframe pairs by
// the claimed corner instead of positional guessing: projector claims
// pair their feet even where names fail, and an outline line drawn for
// a chosen member resolves its stack end to that corner's vertex.
// Unclaimed sheets reconstruct exactly as before; unresolvable claims
// (renamed dots, dangling refs) fall back to geometry, never throw.
// Run: `npm run test:phase37`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var R = require('../public/lib/educad-reconstruct.js');
var C = require('../public/lib/educad-canvas.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 9;
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
function seg(x, y, x2, y2) {
  return { id: 'T' + (++nextId), type: 'SEGMENT', x: x, y: y,
    x2: x2, y2: y2, viewRole: 'BOTH', visible: true };
}
function proj(x, y1, y2) {
  return { id: 'T' + (++nextId), type: 'SEGMENT', x: x, y: y1,
    x2: x, y2: y2, viewRole: 'BOTH', visible: true };
}
function claimLine(a, b, member) {
  var s = seg(a.x, a.y, b.x, b.y);
  s.meta = { kind: 'user-line', refs: [a.id, b.id], fromMember: member };
  return s;
}
function edgeKeys(g) {
  function vk(v) { return v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.z.toFixed(2); }
  return g.edges.map(function (e) {
    var k1 = vk(g.vertices[e[0]]), k2 = vk(g.vertices[e[1]]);
    return k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
  }).sort();
}

// 1 a projector claim pairs its feet where names fail: mismatched
// captions stay 2D-only without the claim, lift exact with it
ok(/^10\.6\./.test(R.VERSION), 'version ' + R.VERSION);
var qE = dot(10, 20, "q'"), zP = dot(10, -30, 'z');
var noClaim = R.reconstructLive([qE, zP]);
eq(noClaim.stats.paired, 0, 'mismatched names stay 2D-only');
var cl1 = claimLine(qE, zP, 'q');
var withClaim = R.reconstructLive([qE, zP, cl1]);
eq(withClaim.status, 'ok', 'claimed pair ok');
eq(withClaim.stats.paired, 1, 'claim pairs one vertex');
deep(withClaim.geometry.vertices, [{ x: 10, y: 20, z: 30 }], 'vertex exact');
eq(withClaim.geometry.edges.length, 0, 'claim line itself never draws');
pass('phase37 claim pairs where names fail');

// 2 a claim disambiguates multi-owner feet: duplicate elevation base
// never pairs positionally, but the claimed feet lift exactly
var d1 = dot(10, 20, "a'"), d2 = dot(10, 25, "a'"), pA = dot(10, -30, 'a');
var dupBare = R.reconstructLive([d1, d2, pA]);
eq(dupBare.stats.paired, 0, 'duplicate base no pair');
var cl2 = claimLine(d1, pA, 'a');
var dupClaimed = R.reconstructLive([d1, d2, pA, cl2]);
eq(dupClaimed.stats.paired, 1, 'claimed feet pair');
deep(dupClaimed.geometry.vertices, [{ x: 10, y: 20, z: 30 }],
  'claimed feet lift, loser stays 2D');
pass('phase37 claim disambiguates multi-owner feet');

// 3 unresolvable claims are ignored: same-view feet, station
// disagreement, dangling or non-point refs all fall back to geometry
var e3 = dot(10, 20, "a'"), p3 = dot(10, -30, 'a');
var e3b = dot(30, 20, "b'");
var q3 = dot(50, -30, 'q');
var proj3 = proj(10, -30, 20);
var base3 = R.reconstructLive([e3, p3, proj3]);
eq(base3.geometry.vertices.length, 1, 'base pairs');
var sameView = claimLine(e3, e3b, 'zzz');
sameView.x2 = 30; sameView.y2 = 20;
deep(R.reconstructLive([e3, p3, proj3, sameView]).geometry, base3.geometry,
  'same-view claim ignored');
var offStation = claimLine(e3, q3, 'a');
deep(R.reconstructLive([e3, p3, q3, proj3, offStation]).geometry,
  R.reconstructLive([e3, p3, q3, proj3]).geometry, 'off-station claim ignored');
var dangling = seg(10, 20, 10, -30);
dangling.meta = { kind: 'user-line', refs: ['QX', 'QY'], fromMember: 'a' };
deep(R.reconstructLive([e3, p3, proj3, dangling]).geometry, base3.geometry,
  'dangling claim ignored');
var nonPoint = seg(10, 20, 30, 20);
nonPoint.meta = { kind: 'user-line', refs: [e3.id, nonPoint.id],
  fromMember: 'a' };
deep(R.reconstructLive([e3, e3b, p3, proj3, nonPoint]).geometry,
  R.reconstructLive([e3, e3b, p3, proj3]).geometry, 'non-point ref ignored');
pass('phase37 unresolvable claims ignored');

// 4 a line drawn for a chosen member resolves its stack end to that
// corner's vertex; the same ink unclaimed stays ambiguous and silent
var stD = dot(0, 40, "a',b'"), stA = dot(0, -8, 'a'), stB = dot(0, -48, 'b');
var stC = dot(30, 40, "c'"), stCP = dot(30, -8, 'c');
var dots4 = [stD, stA, stB, stC, stCP, proj(0, -48, 40), proj(30, -8, 40)];
var ink4 = R.reconstructLive(dots4);
eq(ink4.geometry.vertices.length, 3, 'coincident corners lift');
var bare4 = seg(0, 40, 30, 40);
bare4.meta = { kind: 'user-line', refs: [stD.id, stC.id] };
var r4bare = R.reconstructLive(dots4.concat([bare4]));
eq(r4bare.geometry.edges.length, 0, 'unclaimed stack end stays silent');
var forA = seg(0, 40, 30, 40);
forA.meta = { kind: 'user-line', refs: [stD.id, stC.id], fromMember: 'a' };
var r4a = R.reconstructLive(dots4.concat([forA]));
deep(edgeKeys(r4a.geometry), ['0.00,40.00,8.00|30.00,40.00,8.00'],
  'for-a resolves the a corner');
pass('phase37 claimed endpoint resolves the chosen corner');

// 5 stale claims fall back to geometry; a live second member resolves
// its own corner instead
var forZ = seg(0, 40, 30, 40);
forZ.meta = { kind: 'user-line', refs: [stD.id, stC.id], fromMember: 'zzz' };
var r5z = R.reconstructLive(dots4.concat([forZ]));
eq(r5z.geometry.edges.length, 0, 'stale member falls back silent');
var forB = seg(0, 40, 30, 40);
forB.meta = { kind: 'user-line', refs: [stD.id, stC.id], fromMember: 'b' };
var r5b = R.reconstructLive(dots4.concat([forB]));
deep(edgeKeys(r5b.geometry), ['0.00,40.00,48.00|30.00,40.00,8.00'],
  'for-b resolves the b corner');
pass('phase37 stale claims fall back to geometry');

// 6 claims never leak into unrelated geometry: a far-away dangling
// claim leaves a claimed sheet byte-identical
var far = seg(500, 500, 500, -500);
far.meta = { kind: 'user-line', refs: ['QX', 'QY'], fromMember: 'q' };
deep(R.reconstructLive(dots4.concat([forA, far])).geometry, r4a.geometry,
  'far claim changes nothing');
pass('phase37 claims never leak');

// 7 hitTestPointAll lists every dot in tolerance: nearest first,
// table order breaks ties, head always agrees with hitTestPoint
var view7 = { s: 2, tx: 100, ty: 200 };
function pt7(id, x, y, vis) {
  return { id: id, type: 'POINT', x: x, y: y, visible: vis !== false };
}
var a7 = pt7('A', 0, 0), b7 = pt7('B', 1, 0);
var all7 = C.hitTestPointAll([a7, b7], { x: 100, y: 200 }, view7);
deep(all7, ['A', 'B'], 'nearest first');
var tie7 = C.hitTestPointAll([b7, a7], { x: 101, y: 200 }, view7);
deep(tie7, ['B', 'A'], 'ties keep table order');
eq(C.hitTestPoint([a7, b7], { x: 100, y: 200 }, view7), all7[0],
  'head agrees with hitTestPoint');
eq(C.hitTestPoint([b7, a7], { x: 101, y: 200 }, view7), tie7[0],
  'head agrees on ties');
deep(C.hitTestPointAll([a7, b7], { x: 500, y: 500 }, view7), [],
  'clean miss is empty');
var hid7 = pt7('H', 0, 0, false);
deep(C.hitTestPointAll([hid7, a7], { x: 100, y: 200 }, view7), ['A'],
  'hidden dots skipped');
pass('phase37 hitTestPointAll lists the stack');

// 8 the page offers a dot choice on geometric stacks: every dot in
// tolerance is listed, the corner menu stays for multi-caption dots
var index = fs.readFileSync(INDEX_PATH, 'utf8');
ok(index.indexOf('hitTestPointAll') !== -1, 'picker gathers the stack');
ok(index.indexOf('showDotMenu') !== -1, 'dot menu ships');
ok(index.indexOf('hideDotMenu') !== -1, 'dot menu closes');
eq(index.indexOf('Draw for which corner?'), -1, 'corner menu retired (phase39)');
pass('phase37 page offers dot choice on stacks');

// 9 README lists phase37 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase37`') !== -1, 'phase37 row');
ok(readme.indexOf('Claim-decided pairing: corner choices pair 3D, dot picker covers stacks') !== -1,
  'phase37 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 969');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase37'], 'node tools/test-phase37-claims-live.js',
  'test:phase37 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase37-claims-live.js') !== -1,
  'chained in test');
pass('phase37 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase37 tests passed');

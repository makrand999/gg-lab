'use strict';
var assert = require('assert');
var fs = require('fs');
var L = require('../mirror/files/www.geogebra.org/educad-labels.js');
var Cv = require('../mirror/files/www.geogebra.org/educad-canvas.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');

var TOTAL = 28;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

function view() { return { s: 2, tx: 400, ty: 300, w: 800, h: 600 }; }
function pt(id, x, y, caption, role, meta) {
  return { id: id, type: 'POINT', x: x, y: y, caption: caption,
    showLabel: true, visible: true, viewRole: role || 'WORLD', meta: meta || {} };
}
function seg(id, x1, y1, x2, y2, kind) {
  return { id: id, type: 'SEGMENT', x: x1, y: y1, x2: x2, y2: y2,
    caption: id, showLabel: false, visible: true, viewRole: 'WORLD',
    meta: { kind: kind || 'test' } };
}
function mockCtx() {
  var calls = [];
  return {
    calls: calls,
    font: '', fillStyle: '', strokeStyle: '', lineWidth: 0, lineJoin: '',
    save: function () { calls.push('save'); },
    restore: function () { calls.push('restore'); },
    beginPath: function () { calls.push('beginPath'); },
    moveTo: function (x, y) { calls.push(['moveTo', x, y]); },
    lineTo: function (x, y) { calls.push(['lineTo', x, y]); },
    stroke: function () { calls.push('stroke'); },
    fill: function () { calls.push('fill'); },
    arc: function (x, y, r) { calls.push(['arc', x, y, r]); },
    fillText: function (t, x, y) { calls.push(['fillText', t, x, y]); },
    strokeText: function (t, x, y) { calls.push(['strokeText', t, x, y]); },
    setLineDash: function (d) { calls.push(['dash', d]); }
  };
}

// 1 loads, mm units, version 8.x
eq(L.WORLD_UNITS, 'mm');
ok(/^8\./.test(L.VERSION), 'version ' + L.VERSION);
pass('phase8 loads mm v8');
// 2 zero deps + dual-env markers
var src = fs.readFileSync('mirror/files/www.geogebra.org/educad-labels.js', 'utf8');
eq(src.indexOf('require('), -1);
ok(src.indexOf('EduCADLabels') !== -1, 'window.EduCADLabels marker');
ok(src.indexOf('module.exports') !== -1, 'module.exports marker');
pass('phase8 zero deps dual-env');
// 3 Tier 1: genuine points labeled, internal kinds skipped
eq(L.labelKind(pt('a', 0, 0, 'a')), 'point');
eq(L.labelKind(pt('ap', 0, 5, "a'")), 'point');
eq(L.labelKind(seg('s1', 0, 0, 1, 1, 'projector')), null);
eq(L.labelKind(seg('s2', 0, 0, 1, 1, 'axis')), null);
eq(L.labelKind(seg('s3', 0, 0, 1, 1, 'hidden')), null);
eq(L.labelKind(seg('s4', 0, 0, 1, 1, 'projector-mate')), null);
pass('phase8 tier1 taxonomy');
// 4 Tier 1: never-label shapes, flags, empty captions
eq(L.labelKind({ type: 'SEGMENT', caption: 'ab', showLabel: true, meta: {} }), null);
eq(L.labelKind({ type: 'CIRCLE', caption: 'c', showLabel: true, meta: {} }), null);
eq(L.labelKind({ type: 'POINT', caption: 'a', showLabel: false, meta: {} }), null);
eq(L.labelKind({ type: 'POINT', caption: '', showLabel: true, meta: {} }), null);
eq(L.labelKind({ type: 'POINT', caption: 'a', showLabel: true, visible: false, meta: {} }), null);
eq(L.labelKind(null), null);
pass('phase8 tier1 gates');
// 5 Tier 1: dimension, locus, datum, text kinds
eq(L.labelKind({ type: 'DIMENSION', caption: '35', showLabel: true, meta: {} }), 'dimension');
eq(L.labelKind({ type: 'LINE', caption: 'locus-b', showLabel: true, meta: { kind: 'locus' } }), 'locus');
eq(L.labelKind({ type: 'LINE', caption: 'axis', showLabel: true, meta: { kind: 'axis' } }), null);
eq(L.labelKind({ type: 'DATUM_AXIS', caption: 'XY', showLabel: true, meta: { kind: 'XY' } }), 'datum');
eq(L.labelKind({ type: 'TEXT', caption: 'note', showLabel: true, meta: {} }), 'text');
pass('phase8 tier1 kinds');
// 6 label text mapping
eq(L.labelText({ caption: "a'" }, 'point'), "a'");
eq(L.labelText({ caption: 'locus-b' }, 'locus'), 'locus of b');
eq(L.labelText({ caption: "locus-b'" }, 'locus'), "locus of b'");
eq(L.labelText({}, 'datum', 'left'), 'X');
eq(L.labelText({}, 'datum', 'right'), 'Y');
eq(L.labelText({ caption: '35' }, 'dimension'), '35');
pass('phase8 label text');
// 7 text size estimates scale with length
var s7a = L.estimateTextSize('a');
var s7b = L.estimateTextSize('locus of b');
ok(s7b.w > s7a.w, 'wider text wider box');
ok(s7a.w >= 8 && s7a.h > 0, 'sane box');
pass('phase8 text size');
// 8 anchors: locus outer end, datum ends
deep(L.locusOuterEnd({ x: 0, y: 1, x2: 40, y2: 1 }), { x: 40, y: 1 });
deep(L.locusOuterEnd({ x: 40, y: 1, x2: 0, y2: 1 }), { x: 40, y: 1 });
deep(L.datumEnds({ x: -25, y: 0, x2: 25, y2: 0 }),
  { left: { x: -25, y: 0 }, right: { x: 25, y: 0 } });
pass('phase8 anchors');
// 9 sectors: 45 deg reads up-right; near-corner boxes clear the vertex
var d9 = L.sectorDirPx(45);
ok(d9.x > 0 && d9.y < 0, 'up-right in screen px');
var b9 = L.candidateBox(400, 300, 45, 20, 14, 10);
ok(b9.x >= 400 && b9.y + b9.h <= 300, 'box sits up-right of anchor');
var b9s = L.candidateBox(400, 300, 270, 20, 14, 10);
near(b9s.x + b9s.w / 2, 400, 1e-9, 'cardinal centered');
ok(b9s.y >= 300, 'box below anchor');
throws(function () { L.sectorDirPx(30); });
pass('phase8 sectors boxes');
// 10 box overlap with pad
ok(L.boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }));
ok(!L.boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 10, h: 10 }));
ok(L.boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), 'edge touch with pad');
ok(!L.boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }, 0), 'no pad no touch');
pass('phase8 box overlap');
// 11 segment-box intersection
var bx11 = { x: 100, y: 100, w: 40, h: 40 };
ok(L.segBoxIntersect({ x: 0, y: 120 }, { x: 200, y: 120 }, bx11), 'cross');
ok(!L.segBoxIntersect({ x: 0, y: 0 }, { x: 50, y: 50 }, bx11), 'miss');
ok(L.segBoxIntersect({ x: 110, y: 110 }, { x: 300, y: 300 }, bx11), 'endpoint inside');
pass('phase8 seg box');
// 12 infinite line-box: far defining points still cross
var bx12 = { x: 400, y: 290, w: 20, h: 20 };
ok(L.lineBoxIntersect({ x: -1000, y: 300 }, { x: -900, y: 300 }, bx12), 'line through box');
ok(!L.lineBoxIntersect({ x: -1000, y: 0 }, { x: -900, y: 0 }, bx12), 'parallel miss');
pass('phase8 line box');
// 13 ray-box slab test
var bx13 = { x: 100, y: 100, w: 40, h: 40 };
ok(L.rayBoxIntersect({ x: 0, y: 120 }, { x: 1, y: 0 }, bx13), 'toward');
ok(!L.rayBoxIntersect({ x: 0, y: 120 }, { x: -1, y: 0 }, bx13), 'away');
ok(!L.rayBoxIntersect({ x: 0, y: 0 }, { x: 1, y: 0 }, bx13), 'offset miss');
pass('phase8 ray box');
// 14 circle-box intersection
var bx14 = { x: 100, y: 100, w: 40, h: 40 };
ok(L.circleBoxIntersect({ x: 120, y: 120 }, 30, bx14), 'overlap');
ok(!L.circleBoxIntersect({ x: 0, y: 0 }, 10, bx14), 'far');
pass('phase8 circle box');
// 15 incident directions: endpoint, mid-span, infinite line
var inc15 = L.incidentDirs({ x: 0, y: 0 }, [seg('e', 0, 0, 40, 0, 'test')], 'p');
eq(inc15.length, 1);
near(inc15[0].x, 1, 1e-9, 'east');
eq(inc15[0].both, false);
var inc15b = L.incidentDirs({ x: 20, y: 0 }, [seg('e', 0, 0, 40, 0, 'test')], 'p');
eq(inc15b.length, 1);
eq(inc15b[0].both, true);
var inc15c = L.incidentDirs({ x: 100, y: 0 },
  [{ id: 'ln', type: 'LINE', x: 0, y: 0, x2: 10, y2: 0 }], 'p');
eq(inc15c.length, 1);
eq(inc15c[0].both, true);
eq(L.incidentDirs({ x: 0, y: 50 }, [seg('e', 0, 0, 40, 0, 'test')], 'p').length, 0);
pass('phase8 incident dirs');
// 16 open wedge: label avoids the attached line, prefers 45 deg when free
var r16 = L.resolve([pt('a', 0, 0, 'a'), seg('e', 0, 0, 40, 0, 'test')], view());
eq(r16.placements.length, 1);
eq(r16.placements[0].sectorDeg, 135);
var r16b = L.resolve([pt('a', 0, 0, 'a')], view());
eq(r16b.placements[0].sectorDeg, 45);
eq(r16b.placements[0].cost, 0);
pass('phase8 open wedge pref');
// 17 coincident points take different sectors, boxes never overlap
var r17 = L.resolve([pt('a', 0, 0, 'a'), pt('b', 0, 0, 'b')], view());
eq(r17.placements.length, 2);
ok(r17.placements[0].sectorDeg !== r17.placements[1].sectorDeg, 'split sectors');
ok(!L.boxesOverlap(r17.placements[0].box, r17.placements[1].box, 0), 'disjoint');
pass('phase8 overlap split');
// 18 ground-line rule keeps elevation labels above XY
var r18 = L.resolve([pt('ap', 0, 2, "a'", 'ELEVATION')], view());
var wb18 = L.boxWorldBounds(r18.placements[0].box, view());
ok(wb18.minY >= 0, 'stays above XY');
ok([225, 270, 315].indexOf(r18.placements[0].sectorDeg) === -1, 'no down sector');
eq(L.groundRuleFor({ viewRole: 'PLAN' }, { x: 0, y: 20 }), null);
eq(L.groundRuleFor({ viewRole: 'PLAN' }, { x: 0, y: -20 }), 'below');
pass('phase8 ground rule');
// 19 edge-crossing candidate costs +50
var v19 = view();
var job19 = { incident: [], groundRule: null };
var crossBox = { x: 410, y: 280, w: 30, h: 40 };
var freeBox = { x: 100, y: 100, w: 30, h: 40 };
var wall = [seg('w', 12, -50, 12, 50, 'test')];
var dirE = { x: 1, y: 0 };
eq(L.costCandidate(crossBox, dirE, 0, job19, [], wall, v19, true), 50 + L.SECTOR_PREF[0]);
eq(L.costCandidate(freeBox, dirE, 0, job19, [], wall, v19, true), L.SECTOR_PREF[0]);
pass('phase8 edge cost');
// 20 resolve is deterministic, all outputs finite
var ents20 = [pt('a', 0, 0, 'a'), pt('b', 5, 1, 'b'), seg('e', 0, 0, 5, 1, 'test')];
var r20a = L.resolve(ents20, view());
var r20b = L.resolve(ents20, view());
deep(r20a.placements, r20b.placements);
r20a.placements.forEach(function (p) {
  assert.ok(isFinite(p.xPx) && isFinite(p.yPx) && isFinite(p.cost), 'finite placement');
  assert.ok(isFinite(p.box.x) && isFinite(p.box.y), 'finite box');
});
pass('phase8 deterministic finite');
// 21 crowded cluster falls back to 25 mm leaders with vertex dots
var cluster = [];
for (var c21 = 0; c21 < 10; c21++) {
  cluster.push(pt('p' + c21, 0, 0, 'vertex-label-' + c21));
}
var r21 = L.resolve(cluster, view());
ok(r21.stats.leaders >= 1, 'leaders used: ' + r21.stats.leaders);
var lead21 = r21.placements.filter(function (p) { return !!p.leader; })[0];
var tipDx = lead21.leader.x2Mm - lead21.leader.x1Mm;
var tipDy = lead21.leader.y2Mm - lead21.leader.y1Mm;
near(Math.sqrt(tipDx * tipDx + tipDy * tipDy), 25, 1e-9, 'leader 25mm');
eq(lead21.leader.dotRpx, 2);
r21.placements.forEach(function (p) { ok(isFinite(p.cost), 'finite leader cost'); });
pass('phase8 leader fallback');
// 22 locus labels render formatted text at the outer end
var sl22 = C.straightLine({ TL: 50, thetaDeg: 30, phiDeg: 30 });
var r22 = L.resolve(sl22.entities, view());
var loci22 = r22.placements.filter(function (p) { return p.kind === 'locus'; });
eq(loci22.length, 2);
eq(loci22[0].text, 'locus of b');
eq(loci22[1].text, "locus of b'");
ok(!loci22[0].leader && !loci22[1].leader, 'no leaders needed');
pass('phase8 locus labels');
// 23 datum ground line splits into ordered X/Y end labels
var q23 = C.quadrantPoint({ quadrant: 1, xMm: 10, distHP: 20, distVP: 15, label: 'a' });
var r23 = L.resolve(q23.entities, view());
var dat23 = r23.placements.filter(function (p) { return p.kind === 'datum'; });
eq(dat23.length, 2);
eq(dat23[0].text, 'X');
eq(dat23[1].text, 'Y');
ok(dat23[0].box.x + dat23[0].box.w <= dat23[1].box.x, 'X left of Y');
pass('phase8 datum ends');
// 24 Tier 3 knockout: halo stroke then crisp fill, guarded ctx
var m24 = mockCtx();
eq(Cv.drawKnockoutLabel(m24, "a'", 100, 200), true);
eq(m24.font, Cv.LABEL_FONT);
eq(m24.lineWidth, 3.5);
eq(m24.strokeStyle, 'rgba(248, 250, 252, 0.95)');
eq(m24.fillStyle, '#0f172a');
var kinds24 = m24.calls.map(function (c) { return Array.isArray(c) ? c[0] : c; });
deep(kinds24, ['save', 'strokeText', 'fillText', 'restore']);
deep(m24.calls[1], ['strokeText', "a'", 100, 200]);
deep(m24.calls[2], ['fillText', "a'", 100, 200]);
eq(Cv.drawKnockoutLabel(null, 'a', 0, 0), false);
throws(function () { Cv.drawKnockoutLabel(m24, 'a', NaN, 0); });
pass('phase8 knockout draw');
// 25 Tier 4 leader stroke: thin line plus vertex dot
var m25 = mockCtx();
eq(Cv.drawLabelLeader(m25, 10, 20, 60, 70), true);
eq(m25.lineWidth, 1);
eq(m25.strokeStyle, '#475569');
var kinds25 = m25.calls.map(function (c) { return Array.isArray(c) ? c[0] : c; });
ok(kinds25.indexOf('stroke') !== -1 && kinds25.indexOf('fill') !== -1, 'line + dot');
deep(m25.calls.filter(function (c) { return Array.isArray(c) && c[0] === 'arc'; })[0], ['arc', 10, 20, 2]);
eq(Cv.drawLabelLeader(null, 0, 0, 1, 1), false);
pass('phase8 leader draw');
// 26 placement draw: leader first, mm endpoints converted
var m26 = mockCtx();
var v26 = view();
var plc26 = { text: 'b', xPx: 450, yPx: 280,
  leader: { x1Mm: 10, y1Mm: 5, x2Mm: 22.5, y2Mm: 17.5, dotRpx: 2 } };
eq(Cv.drawLabelPlacement(m26, v26, plc26), true);
var moves26 = m26.calls.filter(function (c) { return Array.isArray(c) && c[0] === 'moveTo'; });
near(moves26[0][1], 10 * 2 + 400, 1e-9, 'leader x1 px');
near(moves26[0][2], 300 - 5 * 2, 1e-9, 'leader y1 px');
var texts26 = m26.calls.filter(function (c) { return Array.isArray(c) && c[0] === 'fillText'; });
eq(texts26.length, 1);
eq(Cv.drawLabelPlacement(m26, v26, { text: 'a', xPx: 1, yPx: 2, leader: null }), true);
eq(Cv.drawLabelPlacement(null, v26, plc26), false);
pass('phase8 placement draw');
// 27 fifty-entity scene resolves inside the frame budget
var big = [];
for (var b27 = 0; b27 < 25; b27++) {
  big.push(pt('p' + b27, b27 * 4 - 48, (b27 % 5) * 8 - 16, 'p' + b27));
  big.push(seg('e' + b27, b27 * 4 - 48, (b27 % 5) * 8 - 16, b27 * 4 - 44, (b27 % 5) * 8 - 12, 'test'));
}
var r27 = L.resolve(big, view());
eq(r27.stats.jobs, 25);
ok(r27.stats.ms < 100, 'fast: ' + r27.stats.ms.toFixed(2) + ' ms');
pass('phase8 perf budget');
// 28 Q2 coincident views both placed without overlap
var q28 = C.quadrantPoint({ quadrant: 2, distHP: 20, distVP: 20, label: 'a' });
var r28 = L.resolve(q28.entities, view());
var pts28 = r28.placements.filter(function (p) { return p.kind === 'point'; });
eq(pts28.length, 2);
ok(!L.boxesOverlap(pts28[0].box, pts28[1].box, 0), 'a/a-prime disjoint');
pass('phase8 quadrant overlap');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase8 tests passed');

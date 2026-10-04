'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var V = require('../mirror/files/www.geogebra.org/educad-verify.js');
var Cv = require('../mirror/files/www.geogebra.org/educad-canvas.js');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 26;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

function pt(id, x, y, caption, role) {
  return { id: id, type: 'POINT', x: x, y: y, x2: x, y2: y,
    bisCode: 'B', viewRole: role || 'BOTH', visible: true,
    caption: caption, showLabel: true, meta: {} };
}
function userLine(id, x1, y1, x2, y2, refs, member) {
  var meta = { kind: 'user-line' };
  if (refs) meta.refs = refs;
  if (member !== undefined && member !== null) meta.fromMember = member;
  return { id: id, type: 'SEGMENT', x: x1, y: y1, x2: x2, y2: y2,
    bisCode: 'B', viewRole: 'BOTH', visible: true,
    caption: '', showLabel: false, meta: meta };
}

var index = fs.readFileSync(INDEX_PATH, 'utf8');
var SRC = fs.readFileSync(path.join(ROOT, 'mirror', 'files',
  'www.geogebra.org', 'educad-verify.js'), 'utf8');

// 1 module loads: version, zero deps, dual env, exports, reasons
eq(V.VERSION, '1.0.0-educad');
ok(SRC.indexOf("require(") === -1, 'zero deps');
ok(SRC.indexOf('window.EduCADVerify') !== -1, 'browser global');
ok(SRC.indexOf('module.exports') !== -1, 'node export');
['verify', 'splitCaption', 'bareName', 'isHiddenMark', 'cornerOf',
  'isProjectorShaped'].forEach(function (f) {
  eq(typeof V[f], 'function', 'export ' + f);
});
deep(Object.keys(V.REASON_LABELS).sort(), ['claim-foot-mismatch',
  'claim-not-projector', 'projector-foot-loose', 'stale-claim',
  'unchecked-view', 'unknown-member',
  'unknown-point', 'unverifiable', 'verdict-flipped'].sort());
pass('phase20 loads exports reasons');

// 2 cornerOf strips view primes, not names
eq(V.cornerOf("a'"), 'a');
eq(V.cornerOf("s''"), 's');
eq(V.cornerOf('a'), 'a');
eq(V.cornerOf(''), '');
pass('phase20 cornerOf');

// 3 projector shape = vertical + crossing XY
ok(V.isProjectorShaped({ type: 'SEGMENT', x: 0, y: -8, x2: 0, y2: 40 }) === true);
ok(V.isProjectorShaped({ type: 'SEGMENT', x: 0, y: 5, x2: 0, y2: 40 }) === false);
ok(V.isProjectorShaped({ type: 'SEGMENT', x: 0, y: -8, x2: 3, y2: 40 }) === false);
ok(V.isProjectorShaped({ type: 'POINT', x: 0, y: 0, x2: 0, y2: 0 }) === false);
pass('phase20 projector shape');

// 4 well-formed projector passes
var feet4 = [pt('A', 0, -8, 'a', 'PLAN'), pt('B', 0, 40, "a'", 'ELEVATION')];
var line4 = userLine('L1', 0, -8, 0, 40, ['A', 'B']);
var r4 = V.verify(feet4.concat([line4]), null);
var row4 = r4.checks.filter(function (c) { return c.id === 'L1'; })[0];
eq(row4.kind, 'projector');
eq(row4.verdict, 'pass');
pass('phase20 wellformed pass');

// 5 loose foot fails named
var line5 = userLine('L1', 0, -8, 0, 41, ['A', 'B']);
var r5 = V.verify(feet4.concat([line5]), null);
var row5 = r5.checks.filter(function (c) { return c.id === 'L1'; })[0];
eq(row5.verdict, 'fail');
eq(row5.reason, 'projector-foot-loose');
ok(row5.label.indexOf('P2') !== -1, 'names the loose end');
eq(r5.pass, false);
pass('phase20 loose foot fails');

// 6 demo lines and plain lines are never judged
var demoLine = { id: 'D1', type: 'SEGMENT', x: 0, y: -8, x2: 0, y2: 40,
  bisCode: 'G', viewRole: 'BOTH', visible: true, caption: 'proj',
  showLabel: false, meta: { kind: 'projector' } };
var plainLine = userLine('L2', 0, 0, 10, 0, null);
var r6 = V.verify([demoLine, plainLine], null);
eq(r6.checks.length, 0, 'nothing judged');
eq(r6.pass, true);
pass('phase20 demo and plain lines skipped');

var sq = C.profileSquare({ sizeMm: 40, xMm: 0 });
function station(id, caption, x, y, role) {
  return pt(id, x, y, caption, role);
}

// 7 true claim passes: VP-top member a drawn to its HP foot
var ents7 = [
  station('S', "b',a'", 0, 40, 'ELEVATION'),
  station('F', 'a,d', 0, -8, 'PLAN'),
  userLine('L1', 0, 40, 0, -8, ['S', 'F'], 'a')
];
var r7 = V.verify(ents7, sq.corners);
var row7 = r7.checks.filter(function (c) { return c.kind === 'claim'; })[0];
eq(row7.verdict, 'pass');
pass('phase20 true claim passes');

// 8 wrong foot for the claimed member fails named
var ents8 = [
  station('S', "b',a'", 0, 40, 'ELEVATION'),
  station('F', 'b,c', 0, -48, 'PLAN'),
  userLine('L1', 0, 40, 0, -48, ['S', 'F'], 'a')
];
var r8 = V.verify(ents8, sq.corners);
var row8 = r8.checks.filter(function (c) { return c.kind === 'claim'; })[0];
eq(row8.verdict, 'fail');
eq(row8.reason, 'claim-foot-mismatch');
pass('phase20 foot mismatch fails');

// 9 renamed-away member reports stale, not wrong
var ents9 = [
  station('S', 'x,y', 0, 40, 'ELEVATION'),
  station('F', 'a,d', 0, -8, 'PLAN'),
  userLine('L1', 0, 40, 0, -8, ['S', 'F'], 'a')
];
var r9 = V.verify(ents9, sq.corners);
var row9 = r9.checks.filter(function (c) { return c.kind === 'claim'; })[0];
eq(row9.verdict, 'fail');
eq(row9.reason, 'stale-claim');
pass('phase20 stale claim');

// 10 unknown member names no corner
var ents10 = [
  station('S', "b',a'", 0, 40, 'ELEVATION'),
  station('F', 'a,d', 0, -8, 'PLAN'),
  userLine('L1', 0, 40, 0, -8, ['S', 'F'], 'z')
];
var r10 = V.verify(ents10, sq.corners);
eq(r10.checks.filter(function (c) { return c.kind === 'claim'; })[0].reason,
  'unknown-member');
pass('phase20 unknown member');

// 11 claims without truth are unverifiable, never failing
var r11 = V.verify(ents7, null);
var row11 = r11.checks.filter(function (c) { return c.kind === 'claim'; })[0];
eq(row11.verdict, 'unverifiable');
eq(row11.reason, 'unverifiable');
eq(r11.pass, true, 'unverifiable does not fail');
pass('phase20 claim unverifiable');

// 12 correct parens pass every square station
var judged = [
  station('V1', "b',(a')", 0, 40, 'ELEVATION'),
  station('V0', "c',(d')", 0, 0, 'ELEVATION'),
  station('Pn', 'a,(d)', 0, -8, 'PLAN'),
  station('Pf', 'b,(c)', 0, -48, 'PLAN')
];
var r12 = V.verify(judged, sq.corners);
eq(r12.pass, true);
eq(r12.counts.fail, 0);
pass('phase20 correct verdicts pass');

// 13 missing parens flip on a fresh square
var fresh = [
  station('V1', "b',a'", 0, 40, 'ELEVATION'),
  station('V0', "c',d'", 0, 0, 'ELEVATION'),
  station('Pn', 'a,d', 0, -8, 'PLAN'),
  station('Pf', 'b,c', 0, -48, 'PLAN')
];
var r13 = V.verify(fresh, sq.corners);
eq(r13.pass, false);
eq(r13.checks.filter(function (c) { return c.reason === 'verdict-flipped'; }).length, 4);
pass('phase20 fresh square flips');

// 14 unknown verdict names fail named
var r14 = V.verify([station('S', 'a,(z)', 0, -8, 'PLAN')], sq.corners);
eq(r14.checks[0].reason, 'unknown-point');
eq(r14.pass, false);
pass('phase20 unknown point');

// 15 profile stations are explicitly unchecked in v1
var r15 = V.verify([station('S', 'a,(b)', 99, 40, 'PROFILE')], sq.corners);
eq(r15.checks[0].verdict, 'unverifiable');
eq(r15.checks[0].reason, 'unchecked-view');
pass('phase20 profile unchecked');

// 16 on-datum BOTH points carry no verdict
var r16 = V.verify([station('S', 'a,b', 0, 0, 'BOTH')], sq.corners);
eq(r16.checks[0].verdict, 'unverifiable');
pass('phase20 datum unverifiable');

// 17 fresh prism demo: singles pass, pairs flip until judged
var prism = C.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
var r17 = V.verify(prism.entities, prism.corners);
eq(r17.pass, false, 'exercise ships unjudged');
eq(r17.counts.fail, 10, 'six bottoms + four backs flip');
eq(r17.counts.pass, 4, 'outer singles pass');
pass('phase20 fresh prism exercise');

// 18 judged prism passes wholesale
var done = prism.entities.map(function (e) {
  if (e.type !== 'POINT') return e;
  var c = {};
  for (var k in e) c[k] = e[k];
  var parts = String(c.caption).split(',');
  if (parts.length === 2) c.caption = parts[0] + ',(' + parts[1] + ')';
  return c;
});
var r18 = V.verify(done, prism.corners);
eq(r18.pass, true);
eq(r18.counts.fail, 0);
pass('phase20 judged prism passes');

// 19 line tool carries and clears the member claim
var ls = Cv.createLineToolState();
eq(ls.p1Member, null, 'fresh null');
Cv.anchorLineTool(ls, 'p1', 0, 40, 'a');
eq(ls.p1Member, 'a');
Cv.abortLineTool(ls);
eq(ls.p1Member, null, 'abort clears');
var ls2 = Cv.createLineToolState();
Cv.anchorLineTool(ls2, 'p1', 0, 40);
eq(ls2.p1Member, null, 'single anchor stays null');
pass('phase20 line member state');

// 20 page commits fromMember and previews the claim
ok(index.indexOf('segMeta.fromMember = String(p1Member)') !== -1,
  'commit writes fromMember');
ok(index.indexOf('anchorLineTool(handle.line, bank[0].id, p1.x, p1.y,') !== -1,
  'finalizer carries member');
ok(index.indexOf("'for ' + lt.p1Member") !== -1, 'preview tags the claim');
pass('phase20 claim commit wiring');

// 21 (phase39) the member chooser is retired: correspondence is
// declared by drawn Type G projectors, never by a bank-time popup.
eq(index.indexOf('showMemberMenu'), -1, 'no chooser');
eq(index.indexOf('Draw for which corner?'), -1, 'no chooser title');
eq(index.indexOf('data-member'), -1, 'no member rows');
ok(index.indexOf('showDotMenu(cursor, cids)') !== -1, 'dot picker kept');
pass('phase20 chooser retired');

// 22 demo bar: square button order, check button, manual still last
var bar = /<div class="demo-bar">([\s\S]*?)<\/div>/.exec(index);
ok(bar, 'demo bar found');
var BTN = '<button class="demo-btn" id="btn-demo-square">Profile Square (40mm)</button>';
ok(bar[1].indexOf(BTN) !== -1, 'exact square markup');
ok(bar[1].indexOf('id="btn-demo-3view"') < bar[1].indexOf('id="btn-demo-square"'),
  'square after 3view');
ok(bar[1].indexOf('id="btn-demo-square"') < bar[1].indexOf('id="btn-clear"'),
  'square before clear');
ok(bar[1].indexOf('id="btn-check"') !== -1, 'check button present');
ok(/<a class="demo-btn"[^>]*>Manual<\/a>\s*$/.test(bar[1]), 'manual last');
pass('phase20 demo bar buttons');

// 23 loadDemo branches carry corner truth
ok(index.indexOf("EduCADCurriculum.profileSquare({ sizeMm: 40, xMm: 0 })") !== -1,
  'square branch exact call');
ok(index.indexOf('demoTruth = sq.corners') !== -1, 'square truth kept');
ok(index.indexOf('demoTruth = prism.corners') !== -1, 'prism truth kept');
ok(index.indexOf('demoTruth = sheet.corners') !== -1, '3view truth kept');
ok(index.indexOf("hash === '#square'") !== -1, 'square hash');
pass('phase20 demo truth wiring');

// 24 Check button runs verify into a dismissible panel
ok(index.indexOf("getElementById('btn-check').addEventListener('click'") !== -1,
  'check listener');
ok(index.indexOf('EduCADVerify.verify(handle.table.list(), demoTruth)') !== -1,
  'verify call');
ok(index.indexOf("verifyPanel.innerHTML = html") !== -1, 'report panel');
ok(index.indexOf('id="verify-close"') !== -1, 'dismiss control');
pass('phase20 check panel wiring');

// 25 README lists the phase20 suite and the grand total
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase20`') !== -1, 'phase20 row');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 789');
pass('phase20 readme suite row');

// 26 package.json chains the phase20 file after phase19
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase20'], 'node tools/test-phase20-claims-verify.js',
  'test:phase20 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase19-multi-caption.js') <
  pkg.scripts.test.indexOf('node tools/test-phase20-claims-verify.js'),
  'phase20 after phase19');
pass('phase20 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase20 tests passed');

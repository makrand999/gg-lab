'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var T = require('../mirror/files/www.geogebra.org/educad-tutorial.js');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');
var V = require('../mirror/files/www.geogebra.org/educad-verify.js');
var R = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 24;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

var index = fs.readFileSync(INDEX_PATH, 'utf8');
var SRC = fs.readFileSync(path.join(ROOT, 'mirror', 'files',
  'www.geogebra.org', 'educad-tutorial.js'), 'utf8');

// 1 module loads: version, zero deps, dual env, exports
eq(T.VERSION, '1.1.0-educad');
ok(SRC.indexOf('require(') === -1, 'zero deps');
ok(SRC.indexOf('window.EduCADTutorial') !== -1, 'browser global');
ok(SRC.indexOf('module.exports') !== -1, 'node export');
['validateScript', 'createStepper', 'total', 'done', 'current',
  'advance', 'back', 'restart'].forEach(function (f) {
  eq(typeof T[f], 'function', 'export ' + f);
});
ok(Array.isArray(T.SQUARE_SCRIPT), 'script exported');
pass('phase21 loads exports');

// 2 op vocabulary and BIS mirror
deep(T.STEP_OPS.slice().sort(),
  ['anchor', 'check', 'lock', 'place', 'rename', 'setup', 'type'].sort());
deep(T.STEP_BIS_CODES, ['A', 'B', 'E', 'G', 'K']);
pass('phase21 op vocabulary');

// 3 the square script validates: 32 steps, refs resolve in order
var v3 = T.validateScript(T.SQUARE_SCRIPT);
eq(v3.ok, true, v3.errors.join('; '));
eq(T.SQUARE_SCRIPT.length, 32, 'thirty-two steps');
pass('phase21 square script valid');

// 4 validator rejects every malformed shape
function bad(script) {
  var v = T.validateScript(script);
  ok(v.ok === false, JSON.stringify(script));
  ok(v.errors.length >= 1, 'names the fault');
}
bad('nope');
bad([{ say: '', do: { op: 'setup' } }]);
bad([{ say: 'x', do: { op: 'dance' } }]);
bad([{ say: 'x', do: { op: 'place', x: 0, y: NaN } }]);
bad([{ say: 'x', do: { op: 'rename', ref: '@2', name: 'a' } }]);
bad([{ say: 'x', do: { op: 'rename', ref: '@1', name: '' } }]);
bad([{ say: 'x', do: { op: 'anchor', ref: 'p1', member: null } }]);
bad([{ say: 'x', do: { op: 'lock', ref: '@9' } }]);
bad([{ say: 'x', do: { op: 'type', bis: 'Z' } }]);
bad([{ say: 'x' }]);
pass('phase21 validator rejects');

// 5 stepper navigation clamps at both ends
var st = T.createStepper(T.SQUARE_SCRIPT);
eq(T.total(st), 32);
eq(T.done(st), false);
eq(T.current(st).do.op, 'setup');
T.advance(st); T.advance(st);
eq(T.current(st).do.op, 'place');
T.back(st);
eq(T.current(st).do.x, 0, 'back one');
T.restart(st);
eq(T.current(st).do.op, 'setup');
T.back(st);
eq(T.current(st).do.op, 'setup', 'back clamps at zero');
for (var i = 0; i < 40; i++) T.advance(st);
eq(T.done(st), true, 'advance clamps at end');
eq(T.current(st), null);
T.back(st);
eq(T.done(st), false);
eq(T.current(st).do.op, 'check', 'back from end');
pass('phase21 stepper navigation');

// 6 script shape: setup, dots, shared outlines, names, claims, verdicts, check
var ops = T.SQUARE_SCRIPT.map(function (s) { return s.do.op; });
deep(ops, ['setup',
  'place', 'place', 'place', 'place',
  'anchor', 'lock', 'type', 'anchor', 'lock', 'type',
  'rename', 'rename', 'rename', 'rename',
  'anchor', 'lock', 'type', 'anchor', 'lock', 'type',
  'anchor', 'lock', 'type', 'anchor', 'lock', 'type',
  'rename', 'rename', 'rename', 'rename',
  'check']);
pass('phase21 script shape');

// 7 placed dots land exactly on the square's corner projections
var sq = C.profileSquare({ sizeMm: 40, xMm: 0 });
var places = T.SQUARE_SCRIPT.filter(function (s) { return s.do.op === 'place'; })
  .map(function (s) { return { x: s.do.x, y: s.do.y }; });
deep(places, [{ x: 0, y: 40 }, { x: 0, y: 0 }, { x: 0, y: -8 }, { x: 0, y: -48 }]);
deep(places[0], sq.corners.a.elev);
deep(places[1], sq.corners.c.elev);
deep(places[2], sq.corners.a.plan);
deep(places[3], sq.corners.b.plan);
pass('phase21 dots match truth');

// 8 taught names match the demo station captions
var renames = T.SQUARE_SCRIPT.filter(function (s) { return s.do.op === 'rename'; })
  .map(function (s) { return s.do.name; });
var demoCaps = sq.entities.filter(function (e) { return e.type === 'POINT'; })
  .map(function (e) { return e.caption; });
renames.slice(0, 4).forEach(function (nm) {
  ok(demoCaps.indexOf(nm) !== -1, 'demo station ' + nm);
});
deep(renames.slice(4), ["b',(a')", "c',(d')", 'a,(d)', 'b,(c)']);
pass('phase21 names match demo');

// 9 every projector claim pairs the member's true feet
var claims = [];
for (var c9 = 0; c9 < T.SQUARE_SCRIPT.length; c9++) {
  var a = T.SQUARE_SCRIPT[c9].do;
  if (a.op === 'anchor' && a.member) {
    var lk = T.SQUARE_SCRIPT[c9 + 1].do;
    eq(lk.op, 'lock', 'claim anchor followed by lock');
    claims.push({ member: a.member, from: a.ref, to: lk.ref });
  }
}
eq(claims.length, 4, 'four claims');
var dots = { '@1': places[0], '@2': places[1], '@3': places[2], '@4': places[3] };
claims.forEach(function (cl) {
  var truth = sq.corners[cl.member];
  ok(truth, 'member ' + cl.member + ' known');
  var s = dots[cl.from], f = dots[cl.to];
  var okPair = (s.x === truth.elev.x && s.y === truth.elev.y &&
    f.x === truth.plan.x && f.y === truth.plan.y);
  ok(okPair, cl.member + ' ' + cl.from + '->' + cl.to + ' pairs truth');
});
pass('phase21 claims pair truth');

// 10 claimed non-projector lines fail named (shared ink stays claim-free)
var slanted = { id: 'L9', type: 'SEGMENT', x: 0, y: 40, x2: 5, y2: 0,
  bisCode: 'A', viewRole: 'BOTH', visible: true, caption: '',
  showLabel: false, meta: { kind: 'user-line', refs: ['S', 'F'], fromMember: 'a' } };
var r10 = V.verify([slanted], sq.corners);
eq(r10.checks.length, 1);
eq(r10.checks[0].reason, 'claim-not-projector');
eq(r10.pass, false);
pass('phase21 claim-not-projector');

// 11 tutorial end-state passes Check headless
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
var endState = [
  { id: 'XY', type: 'DATUM_AXIS', x: -30, y: 0, x2: 30, y2: 0,
    bisCode: 'G', viewRole: 'BOTH', visible: true, caption: 'XY',
    showLabel: true, meta: { kind: 'XY' } },
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
var r11 = V.verify(endState, sq.corners);
eq(r11.pass, true, JSON.stringify(r11.checks.filter(function (c) {
  return c.verdict !== 'pass';
})));
eq(r11.counts.fail, 0);
pass('phase21 end-state passes Check');

// 12 the claimed end-state lifts through the claims reader (M5); bare
// geometry without claims lifts as wire instead (pinned in phase22 test 4)
var r12 = R.reconstructLive(endState);
eq(r12.status, 'ok');
eq(r12.class, null);
eq(r12.geometry.vertices.length, 4);
eq(r12.geometry.edges.length, 4);
pass('phase21 end-state lifts to 3D');

// 13 page exposes one user-action function per gesture
['userPlacePoint', 'userSelectPoint', 'userRenamePoint', 'userCommitRename',
  'userLockTarget', 'userSetupSquare', 'waitTableRevision'].forEach(function (f) {
  ok(index.indexOf('function ' + f + '(') !== -1, f + ' defined');
});
pass('phase21 user actions exist');

// 14 handlers funnel through the actions (single implementation)
ok(index.indexOf('userPlacePoint(px, py, cursor)') !== -1, 'click places via action');
ok(index.indexOf('userSelectPoint(id, cursor)') !== -1, 'click selects via action');
ok(index.indexOf('userLockTarget(id, cursor)') !== -1, 'click locks via action');
ok(index.indexOf('userCommitRename();') !== -1, 'keys commit via action');
pass('phase21 handlers funnel');

// 15 stepper glue: refs, executor, panel, controls
ok(index.indexOf('function execTutorialStep(step, done)') !== -1, 'executor');
ok(index.indexOf('function renderTutorialPanel()') !== -1, 'panel render');
ok(index.indexOf('function startTutorial(which)') !== -1, 'starter takes a lesson');
ok(index.indexOf("getElementById('btn-tut-square').addEventListener('click', " +
  "function () { startTutorial('square'); });") !== -1, 'square starter wired');
ok(index.indexOf('id="tut-next"') !== -1, 'next control');
ok(index.indexOf('id="tut-back"') !== -1, 'back control');
ok(index.indexOf('id="tut-restart"') !== -1, 'restart control');
ok(index.indexOf('id="tut-exit"') !== -1, 'exit control');
ok(index.indexOf('Back re-reads only') !== -1, 'no-undo notice');
pass('phase21 stepper wiring');

// 16 executor routes every op to its user action
var exStart = index.indexOf('function execTutorialStep(step, done)');
var exBody = index.slice(exStart, exStart + 2600);
ok(exBody.indexOf('userSetupSquare()') !== -1, 'setup');
ok(exBody.indexOf('userPlacePoint(a.x, a.y') !== -1, 'place');
ok(exBody.indexOf('userRenamePoint(ent.id, a.name)') !== -1, 'rename');
ok(exBody.indexOf('bankFromPick(') !== -1, 'anchor');
ok(exBody.indexOf('userLockTarget(ent.id') !== -1, 'lock');
ok(exBody.indexOf('startLineStroke(a.bis)') !== -1, 'type');
ok(exBody.indexOf("handle.line.phase !== 'animating'") !== -1,
  'type verifies commit started (pick returns nothing)');
ok(exBody.indexOf('waitTableRevision(') !== -1, 'commit wait');
ok(exBody.indexOf('runVerify()') !== -1, 'check');
pass('phase21 executor routes ops');

// 17 meddling fails soft with guidance, never a guess
ok(index.indexOf('A tutorial dot is gone — press Restart.') !== -1, 'gone dot');
ok(index.indexOf('That station was renamed — press Restart or fix the name.') !== -1,
  'renamed station');
ok(index.indexOf('The line disarmed (a stray click?) — press Restart.') !== -1,
  'disarmed line');
pass('phase21 soft failures');

// 18 demo bar keeps its order with the tutorial button inside
var bar = /<div class="demo-bar">([\s\S]*?)<\/div>/.exec(index);
ok(bar, 'demo bar found');
var BTN = '<button class="demo-btn" id="btn-tut-square">Tutorial: Square</button>';
ok(bar[1].indexOf(BTN) !== -1, 'exact tutorial markup');
ok(bar[1].indexOf('id="btn-demo-prism"') < bar[1].indexOf('id="btn-demo-3view"'),
  'prism before 3view kept');
ok(bar[1].indexOf('id="btn-demo-3view"') < bar[1].indexOf('id="btn-demo-square"'),
  '3view before square kept');
ok(bar[1].indexOf('id="btn-demo-square"') < bar[1].indexOf('id="btn-tut-square"'),
  'square before tutorial');
ok(bar[1].indexOf('id="btn-tut-square"') < bar[1].indexOf('id="btn-clear"'),
  'tutorial before clear');
ok(/<a class="demo-btn"[^>]*>Manual<\/a>\s*$/.test(bar[1]), 'manual last');
pass('phase21 demo bar order');

// 19 tutorial owns no truth of its own: setup reuses the square corners
ok(index.indexOf('demoTruth = EduCADCurriculum.profileSquare({ sizeMm: 40, xMm: 0 }).corners') !== -1,
  'setup keeps square truth');
var ldStart = index.indexOf('function loadDemo(type)');
var ldEnd = index.indexOf("document.getElementById('btn-demo-line')", ldStart);
ok(index.slice(ldStart, ldEnd).indexOf('hideTutorialPanel();') !== -1,
  'demos close the stepper');
var suStart = index.indexOf('function userSetupSquare()');
var suBody = index.slice(suStart, suStart + 900);
var k1 = suBody.indexOf('var keepTut = tutStepper;');
var k2 = suBody.indexOf("loadDemo('clear');");
var k3 = suBody.indexOf('tutStepper = keepTut;');
ok(k1 !== -1 && k2 !== -1 && k3 !== -1 && k1 < k2 && k2 < k3,
  'setup preserves the stepper across its own clear (no vanish on Next)');
pass('phase21 truth and teardown');

// 20 touching-from-below counts as projector-shaped (base stations)
ok(V.isProjectorShaped({ type: 'SEGMENT', x: 0, y: 0, x2: 0, y2: -48 }) === true,
  'base to plan is a projector');
ok(V.isProjectorShaped({ type: 'SEGMENT', x: 0, y: 0, x2: 0, y2: 40 }) === false,
  'base to elevation stays geometry');
ok(V.isProjectorShaped({ type: 'SEGMENT', x: 0, y: -48, x2: 0, y2: -8 }) === false,
  'plan-internal stays geometry');
pass('phase21 touching rule');

// 21 claimed helpers route to the claims reader (M5, three claims own
// the sheet): refs dangling off id-less bundle specs fail loose-foot
var t21 = [];
sq.entities.forEach(function (e) { t21.push(e); });
t21.push({ id: 'U1', type: 'SEGMENT', x: 0, y: 0, x2: 0, y2: -8,
  bisCode: 'G', viewRole: 'BOTH', visible: true, caption: '',
  showLabel: false, meta: { kind: 'user-line', refs: ['S2', 'S3'], fromMember: 'd' } });
t21.push({ id: 'U2', type: 'SEGMENT', x: 0, y: 40, x2: 0, y2: -8,
  bisCode: 'G', viewRole: 'BOTH', visible: true, caption: '',
  showLabel: false, meta: { kind: 'user-line', refs: ['QX', 'QY'], fromMember: 'a' } });
t21.push({ id: 'U3', type: 'SEGMENT', x: 0, y: 40, x2: 0, y2: -48,
  bisCode: 'G', viewRole: 'BOTH', visible: true, caption: '',
  showLabel: false, meta: { kind: 'user-line', refs: ['QZ', 'QW'], fromMember: 'b' } });
var r21 = R.reconstructLive(t21);
eq(r21.status, 'unavailable');
eq(r21.reason, 'hint-loose-foot', 'dangling claim feet fail named');
pass('phase21 dangling claim feet');

// 22 manual documents the tutorial and the claim rule
var md = fs.readFileSync(MD_PATH, 'utf8');
ok(md.indexOf('Tutorial: Square') !== -1, 'tutorial named');
ok(md.indexOf('### 9.4') !== -1, 'section 9.4');
ok(md.indexOf('Back** re-reads only') !== -1, 'no-undo rule');
ok(md.indexOf('draw shared edges\nbefore naming') !== -1, 'claim rule');
pass('phase21 manual sync');

// 23 README lists the phase21 suite and the grand total
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase21`') !== -1, 'phase21 row');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 789');
pass('phase21 readme suite row');

// 24 package.json chains the phase21 file after phase20
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase21'], 'node tools/test-phase21-tutorial.js',
  'test:phase21 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase20-claims-verify.js') <
  pkg.scripts.test.indexOf('node tools/test-phase21-tutorial.js'),
  'phase21 after phase20');
pass('phase21 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase21 tests passed');

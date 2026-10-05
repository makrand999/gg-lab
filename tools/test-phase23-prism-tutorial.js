'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var T = require('../public/lib/educad-tutorial.js');
var C = require('../public/lib/educad-curriculum.js');
var R = require('../public/lib/educad-reconstruct.js');
var V = require('../public/lib/educad-verify.js');

var ROOT = path.join(__dirname, '..');
var INDEX = fs.readFileSync(path.join(ROOT, 'mirror', 'index.html'), 'utf8');
var MD = fs.readFileSync(path.join(ROOT, 'docs', 'MANUAL.md'), 'utf8');
var README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
var PKG = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');

var TOTAL = 20;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }

// Mini script-runner: replays a lesson script into user-style entities,
// mirroring the page (POINT roles by y sign, SEGMENT viewRole BOTH,
// refs + fromMember from anchor/lock/type). check steps are skipped.
function runScript(script) {
  var ents = [];
  var placed = [];
  var pending = null;
  var seq = 0;
  function datum() {
    ents.push({ id: 'XY', type: 'DATUM_AXIS', x: -35, y: 0, x2: 35, y2: 0,
      bisCode: 'G', viewRole: 'BOTH', visible: true, caption: 'XY',
      showLabel: true, meta: { kind: 'XY' } });
  }
  script.forEach(function (st, si) {
    var a = st.do;
    var tag = 'step ' + (si + 1);
    if (a.op === 'setup') { datum(); placed = []; pending = null; return; }
    if (a.op === 'place') {
      seq++;
      var p = { id: 'p' + seq, type: 'POINT', x: a.x, y: a.y, x2: a.x, y2: a.y,
        bisCode: 'B', viewRole: a.y >= 0 ? 'ELEVATION' : 'PLAN', visible: true,
        caption: 'p' + seq, name: 'p' + seq, showLabel: true, meta: {} };
      placed.push(p);
      ents.push(p);
      return;
    }
    if (a.op === 'rename') {
      var rp = placed[Number(a.ref.slice(1)) - 1];
      assert.ok(rp, tag + ': ref resolves');
      rp.caption = a.name;
      rp.name = a.name;
      return;
    }
    if (a.op === 'anchor') {
      var ap = placed[Number(a.ref.slice(1)) - 1];
      assert.ok(ap, tag + ': ref resolves');
      pending = { p1: ap, member: a.member || null };
      return;
    }
    if (a.op === 'lock') {
      var lp = placed[Number(a.ref.slice(1)) - 1];
      assert.ok(lp, tag + ': ref resolves');
      assert.ok(pending, tag + ': lock follows anchor');
      pending.p2 = lp;
      return;
    }
    if (a.op === 'type') {
      assert.ok(pending && pending.p2, tag + ': type follows lock');
      seq++;
      var meta = { kind: 'user-line', refs: [pending.p1.id, pending.p2.id] };
      if (pending.member) meta.fromMember = pending.member;
      ents.push({ id: 's' + seq, type: 'SEGMENT',
        x: pending.p1.x, y: pending.p1.y, x2: pending.p2.x, y2: pending.p2.y,
        bisCode: a.bis, viewRole: 'BOTH', visible: true, caption: '',
        showLabel: false, meta: meta });
      pending = null;
      return;
    }
    if (a.op === 'check') return;
    assert.ok(false, tag + ': unknown op');
  });
  return ents;
}
function near(a, b, eps) { return Math.abs(a - b) <= eps; }

// 1 module: version bump, prism script exported
ok(/^1\.1\./.test(T.VERSION), 'version ' + T.VERSION);
ok(Array.isArray(T.PRISM_SCRIPT), 'prism script exported');
pass('phase23 script exported');

// 2 script validates, eighty-eight steps
var v = T.validateScript(T.PRISM_SCRIPT);
ok(v.ok, 'valid: ' + v.errors.join('; '));
eq(T.PRISM_SCRIPT.length, 88, 'eighty-eight steps');
pass('phase23 script valid');

// 3 op census: 1 setup, 14 dots, 16 lines, 24 renames, check
var ops = {};
T.PRISM_SCRIPT.forEach(function (s) { ops[s.do.op] = (ops[s.do.op] || 0) + 1; });
deep(ops, { setup: 1, place: 14, anchor: 16, lock: 16, type: 16,
  rename: 24, check: 1 }, 'op census');
pass('phase23 op census');

// 4 every line is anchor-lock-type; 12 ink before 4 projectors, none claimed
var seq = T.PRISM_SCRIPT.map(function (s) { return s.do.op; });
var bis = [];
for (var i = 0; i < T.PRISM_SCRIPT.length; i++) {
  var a = T.PRISM_SCRIPT[i].do;
  if (a.op === 'anchor') {
    eq(seq[i + 1], 'lock', 'anchor->lock at ' + (i + 1));
    eq(seq[i + 2], 'type', 'lock->type at ' + (i + 1));
    eq(a.member, null, 'no claim at step ' + (i + 1));
    bis.push(T.PRISM_SCRIPT[i + 2].do.bis);
  }
  if (a.op === 'lock') eq(seq[i + 1], 'type', 'lock->type at ' + (i + 1));
}
eq(bis.length, 16, 'sixteen lines');
eq(bis.slice(0, 12).join(''), 'AAAAAAAAAAAA', 'ink first');
eq(bis.slice(12).join(''), 'GGGG', 'projectors last');
pass('phase23 line discipline');

// 5 dots land on the demo prism spots (0.01 mm)
var prism = C.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
var demoPts = prism.entities.filter(function (e) { return e.type === 'POINT'; });
eq(demoPts.length, 14, 'demo has 14 stations');
var places = T.PRISM_SCRIPT.filter(function (s) { return s.do.op === 'place'; });
eq(places.length, 14, 'script places 14');
places.forEach(function (s, k) {
  var hit = demoPts.some(function (d) {
    return near(d.x, s.do.x, 0.01) && near(d.y, s.do.y, 0.01);
  });
  ok(hit, 'dot @' + (k + 1) + ' on a demo spot');
});
pass('phase23 dots on demo spots');

// 6 first names match the demo captions exactly (visible-first order kept)
var demoCap = {};
demoPts.forEach(function (d) {
  demoCap[d.x.toFixed(2) + ',' + d.y.toFixed(2)] = d.caption;
});
var seen = {};
T.PRISM_SCRIPT.forEach(function (s) {
  if (s.do.op !== 'rename' || seen[s.do.ref]) return;
  seen[s.do.ref] = true;
  var pl = places[Number(s.do.ref.slice(1)) - 1].do;
  var key = pl.x.toFixed(2) + ',' + pl.y.toFixed(2);
  eq(s.do.name, demoCap[key], s.do.ref + ' names ' + demoCap[key]);
});
eq(Object.keys(seen).length, 14, 'all 14 named');
pass('phase23 names match demo');

// 7 verdict pass: 6 plan bottoms + 4 elev backs in parens, singles untouched
var verdicts = {};
T.PRISM_SCRIPT.forEach(function (s) {
  if (s.do.op !== 'rename') return;
  verdicts[s.do.ref] = s.do.name;
});
['@1', '@2', '@3', '@4', '@5', '@6', '@11', '@12', '@13', '@14'].forEach(
  function (r) {
    ok(/\(/.test(verdicts[r]), r + ' carries parens');
  });
deep([verdicts['@7'], verdicts['@8'], verdicts['@9'], verdicts['@10']],
  ["a'", "g'", "d'", "j'"], 'singles stay bare');
pass('phase23 verdicts');

// 8 replayed end-state lifts the 12-vertex, 18-edge prism wire. The old
// pin (22 edges: 4 projector-evidenced face chords on top of the 18)
// documented buggy behavior — crossing-vertical helpers are not edge
// evidence (phase36 test 12) — so the tutorial sheet now matches the
// demo wire edge for edge, projectors and all.
function edgeKeys23(g) {
  function vk(v) { return v.x.toFixed(2) + ',' + v.y.toFixed(2) + ',' + v.z.toFixed(2); }
  return g.edges.map(function (e) {
    var k1 = vk(g.vertices[e[0]]), k2 = vk(g.vertices[e[1]]);
    return k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
  }).sort();
}
var end = runScript(T.PRISM_SCRIPT);
var res = R.reconstructLive(end);
eq(res.status, 'ok', 'reconstructs: ' + (res.reason || 'ok'));
eq(res.geometry.vertices.length, 12, 'twelve vertices');
eq(res.geometry.faces.length, 8, 'closed prism infers faces (phase38)');
eq(res.geometry.edges.length, 18, 'eighteen true edges, no chords');
var demoKeys = edgeKeys23(R.reconstructLive(prism.entities).geometry);
eq(demoKeys.length, 18, 'demo has eighteen');
deep(edgeKeys23(res.geometry), demoKeys, 'tutorial matches demo wire');
pass('phase23 end-state constructs 3D');

// 9 replayed end-state checks 18/18 (14 stations + 4 projectors)
var chk = V.verify(end, prism.corners);
deep(chk.counts, { pass: 18, fail: 0, unverifiable: 0 }, 'checks');
ok(chk.pass, 'all pass');
pass('phase23 end-state checks 18/18');

// 10 loophole pin: neutral names still build 3D but fail 10 verdict checks
var neutral = T.PRISM_SCRIPT.filter(function (s) {
  if (s.do.op !== 'rename') return true;
  return ['@1', '@2', '@3', '@4', '@5', '@6', '@11', '@12',
    '@13', '@14'].indexOf(s.do.ref) === -1 ||
    s.do.name.indexOf('(') === -1;
});
var nEnd = runScript(neutral);
var nRes = R.reconstructLive(nEnd);
eq(nRes.status, 'ok', 'neutral names still construct');
var nChk = V.verify(nEnd, prism.corners);
eq(nChk.counts.fail, 10, 'ten verdicts fail');
ok(!nChk.pass, 'check red until verdicts');
pass('phase23 verdicts are check-only');

// 11 unnamed stations stay 2D-only: no station is uniquely pairable,
// so the sheet reads quiet until names resolve the shared stations
var unnamed = T.PRISM_SCRIPT.filter(function (s) { return s.do.op !== 'rename'; });
var uEnd = runScript(unnamed);
var uRes = R.reconstructLive(uEnd);
eq(uRes.status, 'unavailable', 'no 3D without names');
eq(uRes.reason, 'empty-sketch', 'crowded stations stay quiet');
eq(uRes.stats.paired, 0, 'nothing pairs');
pass('phase23 names resolve shared stations');

// 12 demo bar: prism button exact markup, order kept
var bar = /<div class="demo-bar">([\s\S]*?)<\/div>/.exec(INDEX);
ok(bar, 'demo bar found');
var BTN = '<button class="demo-btn" id="btn-tut-prism">Tutorial: Prism</button>';
ok(bar[1].indexOf(BTN) !== -1, 'exact prism markup');
ok(bar[1].indexOf('id="btn-tut-square"') < bar[1].indexOf('id="btn-tut-prism"'),
  'square lesson before prism lesson');
ok(bar[1].indexOf('id="btn-tut-prism"') < bar[1].indexOf('id="btn-clear"'),
  'prism lesson before clear');
pass('phase23 demo bar order');

// 13 starter routes the lesson; prism setup carries prism truth
ok(INDEX.indexOf("startTutorial('prism')") !== -1, 'prism wired');
ok(INDEX.indexOf('EduCADTutorial.PRISM_SCRIPT') !== -1, 'prism script used');
ok(INDEX.indexOf('tutLesson === ') !== -1, 'lesson tracked');
ok(INDEX.indexOf('function userSetupPrism()') !== -1, 'prism setup defined');
ok(INDEX.indexOf('regularSolid(') !== -1, 'setup reuses demo solid');
ok(INDEX.indexOf('Tutorial: Hex Prism') !== -1, 'prism title');
ok(INDEX.indexOf('userSetupPrism(); else userSetupSquare();') !== -1,
  'setup branches on lesson');
pass('phase23 lesson wiring');

// 14 projectors are true crossing helpers; facet verticals are not
var segs = end.filter(function (e) { return e.type === 'SEGMENT'; });
var proj = segs.filter(function (e) { return e.bisCode === 'G'; });
eq(proj.length, 4, 'four projectors');
proj.forEach(function (e, k) {
  eq(e.x, e.x2, 'projector ' + k + ' sheet-vertical');
  ok(Math.min(e.y, e.y2) < 0 && Math.max(e.y, e.y2) >= 0,
    'projector ' + k + ' crosses/touches XY');
  ok(!(e.meta && e.meta.fromMember), 'projector ' + k + ' unclaimed');
});
var ink = segs.filter(function (e) { return e.bisCode === 'A'; });
eq(ink.length, 12, 'twelve ink lines');
ink.forEach(function (e, k) {
  var lo = Math.min(e.y, e.y2), hi = Math.max(e.y, e.y2);
  ok(!(Math.abs(e.x2 - e.x) <= 0.001 && lo < 0 && hi >= 0),
    'ink ' + k + ' never a crossing vertical');
});
// No orphan corners: every dot sits on a full-height projector (k'/l'
// reach k/l), and the demo projectors run dot to dot the same way.
var dots = end.filter(function (e) { return e.type === 'POINT'; });
eq(dots.length, 14, 'fourteen dots');
dots.forEach(function (d) {
  var on = proj.some(function (e) {
    return Math.abs(e.x - d.x) <= 0.001 &&
      Math.min(e.y, e.y2) <= d.y + 0.001 && d.y <= Math.max(e.y, e.y2) + 0.001;
  });
  ok(on, 'dot (' + d.x + ',' + d.y + ') on a projector');
});
var demoProj = prism.entities.filter(function (e) {
  return e.meta && e.meta.kind === 'projector';
});
eq(demoProj.length, 4, 'demo keeps four projectors');
demoProj.forEach(function (e, k) {
  [[e.x, e.y], [e.x2, e.y2]].forEach(function (pt, j) {
    var hit = demoPts.some(function (d) {
      return near(d.x, pt[0], 0.01) && near(d.y, pt[1], 0.01);
    });
    ok(hit, 'demo projector ' + k + ' end ' + j + ' on a station dot');
  });
});
pass('phase23 helper geometry');

// 15 no claims anywhere: the honest solid pairs geometrically
var claimed = end.filter(function (e) {
  return e.meta && e.meta.fromMember;
});
eq(claimed.length, 0, 'zero fromMember');
pass('phase23 claim-free');

// 16 square lesson untouched: still 32 steps, still valid
eq(T.SQUARE_SCRIPT.length, 32, 'square stays 32');
ok(T.validateScript(T.SQUARE_SCRIPT).ok, 'square stays valid');
pass('phase23 square untouched');

// 17 manual documents the prism lesson
ok(MD.indexOf('Tutorial: Prism') !== -1, 'lesson named');
ok(MD.indexOf('88') !== -1, 'step count stated');
ok(MD.indexOf('18/18') !== -1, 'finale stated');
pass('phase23 manual');

// 18 readme + package pin the new suite
ok(README.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 789');
ok(PKG.indexOf('node tools/test-phase23-prism-tutorial.js') !== -1,
  'suite runs phase23');
pass('phase23 suite pinned');

// 19 tutorial source keeps its contract: zero deps, dual env
var SRC = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'educad-tutorial.js'), 'utf8');
ok(SRC.indexOf('require(') === -1, 'zero deps');
ok(SRC.indexOf('window.EduCADTutorial') !== -1, 'browser global');
ok(SRC.indexOf('module.exports') !== -1, 'node export');
pass('phase23 module contract');

// 20 every step says something (no silent clicks)
T.PRISM_SCRIPT.forEach(function (s, k) {
  ok(typeof s.say === 'string' && s.say.replace(/^\s+|\s+$/g, '') !== '',
    'step ' + (k + 1) + ' narrated');
});
pass('phase23 narrated');

assert.strictEqual(n, TOTAL, 'ran ' + TOTAL);
console.log('phase23: all ' + TOTAL + ' checks pass');

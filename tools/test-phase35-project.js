'use strict';
// EduCAD phase 35: exact 2D projection. Pose fits move existing ink and
// can never split coincident geometry; this module projects the posed
// solid itself (visible + hidden edges) so VP/HP show the true stance.
// Run: `npm run test:phase35`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var P = require('../public/lib/educad-project.js');
var Pose = require('../public/lib/educad-pose.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'mirror', 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 10;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }
function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, msg + ' (' + a + ' vs ' + b + ')');
}

function boxVerts(x0, x1, y0, y1, z0, z1) {
  var v = [];
  [x0, x1].forEach(function (x) {
    [y0, y1].forEach(function (y) {
      [z0, z1].forEach(function (z) { v.push({ x: x, y: y, z: z }); });
    });
  });
  return v;
}
var BOX_E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3],
  [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
var BOX_F = [[0, 2, 6, 4], [1, 5, 7, 3], [0, 4, 5, 1],
  [2, 3, 7, 6], [0, 1, 3, 2], [4, 6, 7, 5]];
var BOX_V = boxVerts(0, 1, 0, 1, 0, 1);

function hiddenSet(segs) {
  var out = [];
  for (var i = 0; i < segs.length; i++) {
    if (segs[i].hidden) out.push(i);
  }
  return out;
}

// 1 module ships; bad shapes throw with useful errors
eq(typeof P.projectSolid, 'function', 'ships projectSolid');
deep(P.VIEWS, ['front', 'top'], 'two Monge views');
eq(P.WORLD_UNITS, 'mm', 'mm units');
eq(P.HIT_EPS, 1e-7, 'hit epsilon');
throws(function () { P.projectSolid([], BOX_E, BOX_F, 'front'); }, 'empty verts');
throws(function () { P.projectSolid('nope', BOX_E, BOX_F, 'front'); }, 'verts array');
throws(function () { P.projectSolid(BOX_V, [[0, 9]], BOX_F, 'front'); }, 'edge range');
throws(function () { P.projectSolid(BOX_V, [[2, 2]], BOX_F, 'front'); }, 'edge loop');
throws(function () { P.projectSolid(BOX_V, BOX_E, [[0, 1]], 'front'); }, 'short face');
throws(function () { P.projectSolid(BOX_V, BOX_E, [[0, 1, 9]], 'front'); }, 'face range');
throws(function () { P.projectSolid(BOX_V, BOX_E, BOX_F, 'side'); }, 'view checked');
pass('phase35 project basics');

// 2 unit box, front rest: front loop solid, back loop + depth points hidden
var front = P.projectSolid(BOX_V, BOX_E, BOX_F, 'front');
eq(front.length, 12, 'one segment per edge');
deep(hiddenSet(front), [0, 1, 2, 3, 4, 6, 8, 10], 'back 4 hidden');
deep([front[5].ax, front[5].ay, front[5].bx, front[5].by], [0, 0, 0, 1],
  'front-left edge exact');
deep([front[9].ax, front[9].ay, front[9].bx, front[9].by], [0, 0, 1, 0],
  'front-bottom edge exact');
ok(!front[5].hidden && !front[9].hidden, 'front loop solid');
eq(front[0].ax, front[0].bx, 'depth edge collapses to a point x');
eq(front[0].ay, front[0].by, 'depth edge collapses to a point y');
pass('phase35 box front rest');

// 3 unit box, top rest: plan reads (x, -z), bottom loop hidden
var top = P.projectSolid(BOX_V, BOX_E, BOX_F, 'top');
eq(top.length, 12, 'one segment per edge');
deep(hiddenSet(top), [0, 2, 4, 5, 6, 7, 8, 9], 'bottom 4 hidden');
deep([top[1].ax, top[1].ay, top[1].bx, top[1].by], [0, -0, 0, -1],
  'top-left edge exact');
deep([top[10].ax, top[10].ay, top[10].bx, top[10].by], [0, -0, 1, -0],
  'top-front edge exact');
ok(!top[1].hidden && !top[10].hidden, 'top loop solid');
pass('phase35 box top rest');

// 4 spun box matches reprojected truth vertex-for-vertex, deterministically
var BOX_C = Pose.bboxCenter(BOX_V);
var spinPose = { t: [0, 0, 0],
  rm: Pose.axisAngleMatrix(0, 1, 0, Math.PI / 4), s: 1 };
var spunV = Pose.applyPose(BOX_V, spinPose, BOX_C);
var spunR = Pose.reproject(spunV, BOX_E);
var spunF = P.projectSolid(spunV, BOX_E, BOX_F, 'front');
var spunT = P.projectSolid(spunV, BOX_E, BOX_F, 'top');
BOX_E.forEach(function (e, i) {
  near(spunF[i].ax, spunR.elev.pts[e[0]].x, 1e-9, 'front ax ' + i);
  near(spunF[i].ay, spunR.elev.pts[e[0]].y, 1e-9, 'front ay ' + i);
  near(spunF[i].bx, spunR.elev.pts[e[1]].x, 1e-9, 'front bx ' + i);
  near(spunF[i].by, spunR.elev.pts[e[1]].y, 1e-9, 'front by ' + i);
  near(spunT[i].ax, spunR.plan.pts[e[0]].x, 1e-9, 'top ax ' + i);
  near(spunT[i].ay, spunR.plan.pts[e[0]].y, 1e-9, 'top ay ' + i);
  near(spunT[i].bx, spunR.plan.pts[e[1]].x, 1e-9, 'top bx ' + i);
  near(spunT[i].by, spunR.plan.pts[e[1]].y, 1e-9, 'top by ' + i);
});
var hnF = hiddenSet(spunF).length, hnT = hiddenSet(spunT).length;
ok(hnF > 0 && hnF < 12, 'spun front hides some (' + hnF + ')');
ok(hnT > 0 && hnT < 12, 'spun top hides some (' + hnT + ')');
deep(P.projectSolid(spunV, BOX_E, BOX_F, 'front'), spunF, 'front deterministic');
deep(P.projectSolid(spunV, BOX_E, BOX_F, 'top'), spunT, 'top deterministic');
pass('phase35 spun box exact');

// 5 the hexagon split: Z-45 tapered prism plan shows two offset rings
function hexPrism(rBot, rTop, h) {
  var verts = [], edges = [], faces = [];
  var i, a;
  for (i = 0; i < 6; i++) {
    a = i * Math.PI / 3;
    verts.push({ x: rBot * Math.cos(a), y: 0, z: rBot * Math.sin(a) });
  }
  for (i = 0; i < 6; i++) {
    a = i * Math.PI / 3;
    verts.push({ x: rTop * Math.cos(a), y: h, z: rTop * Math.sin(a) });
  }
  for (i = 0; i < 6; i++) {
    edges.push([i, (i + 1) % 6]);
    edges.push([6 + i, 6 + (i + 1) % 6]);
    edges.push([i, 6 + i]);
  }
  faces.push([0, 1, 2, 3, 4, 5]);
  faces.push([6, 7, 8, 9, 10, 11]);
  for (i = 0; i < 6; i++) {
    faces.push([i, (i + 1) % 6, 6 + (i + 1) % 6, 6 + i]);
  }
  return { verts: verts, edges: edges, faces: faces };
}
var HEX = hexPrism(9, 10, 70);
var HEX_C = Pose.bboxCenter(HEX.verts);
// at rest the tapered bottom ring sits strictly under the top face:
// bottom ring + slanted verticals hidden, top ring solid
var hexRest = P.projectSolid(HEX.verts, HEX.edges, HEX.faces, 'top');
for (var ri = 0; ri < 6; ri++) {
  ok(hexRest[ri * 3].hidden, 'rest bottom ring ' + ri + ' hidden');
  ok(!hexRest[ri * 3 + 1].hidden, 'rest top ring ' + ri + ' solid');
  ok(hexRest[ri * 3 + 2].hidden, 'rest wall edge ' + ri + ' hidden');
}
var hexPose = { t: [0, 0, 0],
  rm: Pose.axisAngleMatrix(0, 0, 1, Math.PI / 4), s: 1 };
var hexV = Pose.applyPose(HEX.verts, hexPose, HEX_C);
var hexTop = P.projectSolid(hexV, HEX.edges, HEX.faces, 'top');
eq(hexTop.length, 18, 'all solid edges project');
var botX = 0, topX = 0;
for (var hi = 0; hi < 6; hi++) {
  var bSeg = hexTop[hi * 3], tSeg = hexTop[hi * 3 + 1];
  botX += (bSeg.ax + bSeg.bx) / 2;
  topX += (tSeg.ax + tSeg.bx) / 2;
}
botX /= 6; topX /= 6;
near(botX, 35 * Math.SQRT1_2, 0.5, 'bottom ring sits right');
near(topX, -35 * Math.SQRT1_2, 0.5, 'top ring sits left');
ok(botX - topX > 40, 'rings separate (' + (botX - topX).toFixed(1) + 'mm)');
ok(hiddenSet(hexTop).length > 0, 'spun top hides some');
var hexR = Pose.reproject(hexV, HEX.edges);
HEX.edges.forEach(function (e, i) {
  near(hexTop[i].ax, hexR.plan.pts[e[0]].x, 1e-6, 'ring ax ' + i);
  near(hexTop[i].ay, hexR.plan.pts[e[0]].y, 1e-6, 'ring ay ' + i);
  near(hexTop[i].bx, hexR.plan.pts[e[1]].x, 1e-6, 'ring bx ' + i);
  near(hexTop[i].by, hexR.plan.pts[e[1]].y, 1e-6, 'ring by ' + i);
});
deep(P.projectSolid(hexV, HEX.edges, HEX.faces, 'top'), hexTop,
  'spun deterministic');
pass('phase35 hexagon split');

// 6 occlusion beats orientation: a front-facing edge hides behind a
// non-adjacent face (two overlapping boxes; winding-independent)
var AB = boxVerts(0, 1, 0, 1, 1, 2);
var BB = boxVerts(0, 1, 0, 0.5, 0, 1);
var soupV = AB.concat(BB.map(function (p) { return { x: p.x, y: p.y, z: p.z }; }));
function offsetEdges(de, off) {
  return de.map(function (e) { return [e[0] + off, e[1] + off]; });
}
function offsetFaces(df, off) {
  return df.map(function (f) {
    return f.map(function (v) { return v + off; });
  });
}
var soupE = BOX_E.concat(offsetEdges(BOX_E, 8));
var soupF = BOX_F.concat(offsetFaces(BOX_F, 8));
var soupFront = P.projectSolid(soupV, soupE, soupF, 'front');
// B box front-top edge: local BOX_E index 11 ([3,7]) + 8 = 19; its
// face looks at the viewer but box A stands in front of it.
ok(soupFront[8 + 11].hidden, 'occluded front-facing edge hidden');
// A box front-top edge (index 11) has nothing in front of it.
ok(!soupFront[11].hidden, 'unoccluded edge solid');
// flip every winding: verdicts must not move
var flipF = soupF.map(function (f) { return f.slice().reverse(); });
deep(P.projectSolid(soupV, soupE, flipF, 'front'), soupFront,
  'winding-independent');
pass('phase35 occlusion');

// 7 faceless wireframes read all-solid, like the glass
var wireF = P.projectSolid(spunV, BOX_E, [], 'front');
var wireT = P.projectSolid(spunV, BOX_E, [], 'top');
eq(hiddenSet(wireF).length, 0, 'wire front all solid');
eq(hiddenSet(wireT).length, 0, 'wire top all solid');
near(wireF[0].ax, spunR.elev.pts[0].x, 1e-9, 'wire still exact');
pass('phase35 wireframe');

// 8 overlay endpoints obey the datum rule, so the overlay needs no
// clamp of its own: front stays up, plan stays down
var liftPose = { t: [0, 100, 0],
  rm: Pose.axisAngleMatrix(0, 0, 1, 135 * Math.PI / 180), s: 1 };
var liftV = Pose.applyPose(BOX_V, liftPose, BOX_C);
var liftF = P.projectSolid(liftV, BOX_E, BOX_F, 'front');
var liftT = P.projectSolid(liftV, BOX_E, BOX_F, 'top');
liftF.forEach(function (s, i) {
  ok(Pose.holdsSide(1, s.ay, 'elev') && Pose.holdsSide(1, s.by, 'elev'),
    'front endpoint holds ' + i);
});
liftT.forEach(function (s, i) {
  ok(Pose.holdsSide(-1, s.ay, 'plan') && Pose.holdsSide(-1, s.by, 'plan'),
    'top endpoint holds ' + i);
});
pass('phase35 overlay datum invariant');

// 9 the page overlays exact edges over faded riding ink in pose mode
var index = fs.readFileSync(INDEX_PATH, 'utf8');
ok(index.indexOf('<script src="lib/educad-project.js"></script>') !== -1,
  'project module loaded');
['poseProjectedEdges', 'poseState.overlay', 'POSE_FADE',
  'window.educadPoseViews', 'overlay:'].forEach(function (str) {
  ok(index.indexOf(str) !== -1, 'ships ' + str);
});
pass('phase35 page wiring');

// 10 README lists phase35 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase35`') !== -1, 'phase35 row');
ok(readme.indexOf('Pose live views: exact 2D projections of the posed solid') !== -1,
  'phase35 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 960');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase35'], 'node tools/test-phase35-project.js',
  'test:phase35 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase35-project.js') !== -1,
  'chained in test');
pass('phase35 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase35 tests passed');

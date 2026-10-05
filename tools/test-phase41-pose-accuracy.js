'use strict';
// EduCAD phase 41: pose accuracy. Move the hex prism up in Y, rotate it in
// Z, and prove the VP/HP overlays track the 3D exactly: translation rules,
// rotation rules, the ring-split formula, live occlusion, and the datum
// wall. General invariants swept over poses and both prism builds, not
// per-case snapshots. Run: `npm run test:phase41`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Pose = require('../public/lib/educad-pose.js');
var Proj = require('../public/lib/educad-project.js');
var Curr = require('../public/lib/educad-curriculum.js');
var Rec = require('../public/lib/educad-reconstruct.js');
var Solid = require('../public/lib/educad-solid.js');

var ROOT = path.join(__dirname, '..');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 7;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= eps, msg + ' (' + a + ' vs ' + b + ')');
}

var I9 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function hexPrism(rBot, rTop, h) {
  var verts = [], edges = [], faces = [], i, a;
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

function hiddenSet(segs) {
  var out = [];
  for (var i = 0; i < segs.length; i++) {
    if (segs[i].hidden) out.push(i);
  }
  return out;
}

function maxSegDiff(a, b) {
  var m = 0;
  for (var i = 0; i < a.length; i++) {
    m = Math.max(m, Math.abs(a[i].ax - b[i].ax), Math.abs(a[i].ay - b[i].ay),
      Math.abs(a[i].bx - b[i].bx), Math.abs(a[i].by - b[i].by));
  }
  return m;
}

// Ring edges by cap height: an edge belongs to a ring iff both ends sit
// on the same cap plane. Works for any upright prism regardless of edge
// order (tapered test builder and reconstructed app prism alike).
function ringGroups(verts, edges) {
  var ys = verts.map(function (v) { return v.y; });
  var lo = Math.min.apply(null, ys), hi = Math.max.apply(null, ys);
  var bot = [], top = [];
  edges.forEach(function (e, i) {
    var ya = verts[e[0]].y, yb = verts[e[1]].y;
    if (Math.abs(ya - lo) < 1e-9 && Math.abs(yb - lo) < 1e-9) bot.push(i);
    else if (Math.abs(ya - hi) < 1e-9 && Math.abs(yb - hi) < 1e-9) top.push(i);
  });
  return { bot: bot, top: top, h: hi - lo };
}

function centroidX(segs, idxs) {
  var s = 0;
  idxs.forEach(function (i) { s += (segs[i].ax + segs[i].bx) / 2; });
  return s / idxs.length;
}

var APP_ENT = Curr.regularSolid({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
var APP_LIVE = Rec.reconstructLive(APP_ENT.entities);
ok(APP_LIVE.status === 'ok', 'app prism reconstructs, got ' + APP_LIVE.reason);
var TAP = hexPrism(9, 10, 70);
var PRISMS = [
  { name: 'app', verts: APP_LIVE.geometry.vertices,
    edges: APP_LIVE.geometry.edges, faces: APP_LIVE.geometry.faces },
  { name: 'tapered', verts: TAP.verts, edges: TAP.edges, faces: TAP.faces }
];
PRISMS.forEach(function (p) {
  p.center = Pose.bboxCenter(p.verts);
  p.rest2D = Pose.reproject(p.verts, p.edges);
});

// 1 the posed-test solids: reconstructed app prism plus the tapered
// builder share one shape (12 verts, 18 edges, 8 planar faces) with a
// measured rest occlusion signature
PRISMS.forEach(function (p) {
  eq(p.verts.length, 12, p.name + ' 12 verts');
  eq(p.edges.length, 18, p.name + ' 18 edges');
  eq(p.faces.length, 8, p.name + ' 8 faces');
  p.faces.forEach(function (loop, f) {
    var a = p.verts[loop[0]], b = p.verts[loop[1]], c = p.verts[loop[2]];
    var ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
    var vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    ok(len > 1e-9, p.name + ' face ' + f + ' non-degenerate');
    loop.forEach(function (vi) {
      var q = p.verts[vi];
      near((nx * (q.x - a.x) + ny * (q.y - a.y) + nz * (q.z - a.z)) / len,
        0, 1e-9, p.name + ' face ' + f + ' planar');
    });
  });
  var rf = Proj.projectSolid(p.verts, p.edges, p.faces, 'front');
  var rt = Proj.projectSolid(p.verts, p.edges, p.faces, 'top');
  p.restHidden = { front: hiddenSet(rf), top: hiddenSet(rt) };
  eq(rf.length, 18, p.name + ' front projects all edges');
  eq(rt.length, 18, p.name + ' top projects all edges');
});
deep(PRISMS[0].restHidden.front.length, 8, 'app rest front hides 8');
deep(PRISMS[0].restHidden.top.length, 12, 'app rest top hides 12');
PRISMS.forEach(function (p) {
  ok(p.restHidden.front.length > 0 && p.restHidden.front.length < 18,
    p.name + ' rest front mixed');
  ok(p.restHidden.top.length > 0 && p.restHidden.top.length < 18,
    p.name + ' rest top mixed');
});
pass('phase41 prism pipeline');

// 2 Y translation is occlusion- and plan-preserving: hidden sets stay
// identical, plan coords stay put, front shifts by exactly (0, dy),
// and the 3D glass classification does not move either
PRISMS.forEach(function (p) {
  [5, 25, 100, -10].forEach(function (dy) {
    var pose = { t: [0, dy, 0], rm: I9.slice(), s: 1 };
    var v = Pose.applyPose(p.verts, pose, p.center);
    var f = Proj.projectSolid(v, p.edges, p.faces, 'front');
    var t = Proj.projectSolid(v, p.edges, p.faces, 'top');
    deep(hiddenSet(f), p.restHidden.front, p.name + ' dy=' + dy + ' front hidden kept');
    deep(hiddenSet(t), p.restHidden.top, p.name + ' dy=' + dy + ' top hidden kept');
    var rf = Proj.projectSolid(p.verts, p.edges, p.faces, 'front');
    var rt = Proj.projectSolid(p.verts, p.edges, p.faces, 'top');
    for (var i = 0; i < p.edges.length; i++) {
      near(t[i].ax, rt[i].ax, 1e-9, p.name + ' plan ax kept ' + i);
      near(t[i].ay, rt[i].ay, 1e-9, p.name + ' plan ay kept ' + i);
      near(t[i].bx, rt[i].bx, 1e-9, p.name + ' plan bx kept ' + i);
      near(t[i].by, rt[i].by, 1e-9, p.name + ' plan by kept ' + i);
      near(f[i].ax, rf[i].ax, 1e-9, p.name + ' front ax kept ' + i);
      near(f[i].ay, rf[i].ay + dy, 1e-9, p.name + ' front ay shifts ' + i);
      near(f[i].bx, rf[i].bx, 1e-9, p.name + ' front bx kept ' + i);
      near(f[i].by, rf[i].by + dy, 1e-9, p.name + ' front by shifts ' + i);
    }
  });
  // glass side: the same Y shift restaged through the rest transform
  // keeps every edge verdict at a generic orbit angle
  var mm = { name: p.name, vertices: p.verts, edges: p.edges, faces: p.faces };
  var rest = Solid.normalizeGeometry(mm).transform;
  var moved = Pose.applyPose(p.verts, { t: [0, 25, 0], rm: I9.slice(), s: 1 }, p.center);
  var g0 = Solid.createGeometry({ name: 'r', vertices: Pose.stageWithRest(p.verts, rest),
    edges: p.edges, faces: p.faces });
  var g1 = Solid.createGeometry({ name: 'm', vertices: Pose.stageWithRest(moved, rest),
    edges: p.edges, faces: p.faces });
  deep(Solid.classifyEdges({ yaw: 0.7, pitch: 0.5, geometry: g1 }).map(function (e) {
    return e.hidden;
  }), Solid.classifyEdges({ yaw: 0.7, pitch: 0.5, geometry: g0 }).map(function (e) {
    return e.hidden;
  }), p.name + ' glass verdicts kept under Y');
});
pass('phase41 Y translation rules');

// 3 Z rotation projects exactly: overlay matches reproject vertex for
// vertex, plan rows keep their y, the front view stays rigid, and every
// projection is deterministic
PRISMS.forEach(function (p) {
  [15, 45, 90, 135, 180].forEach(function (deg) {
    var th = deg * Math.PI / 180;
    var pose = { t: [0, 40, 0], rm: Pose.axisAngleMatrix(0, 0, 1, th), s: 1 };
    var v = Pose.applyPose(p.verts, pose, p.center);
    var f = Proj.projectSolid(v, p.edges, p.faces, 'front');
    var t = Proj.projectSolid(v, p.edges, p.faces, 'top');
    var r = Pose.reproject(v, p.edges);
    var lifted = Pose.applyPose(p.verts,
      { t: [0, 40, 0], rm: I9.slice(), s: 1 }, p.center);
    var lf = Proj.projectSolid(lifted, p.edges, p.faces, 'front');
    var lt = Proj.projectSolid(lifted, p.edges, p.faces, 'top');
    p.edges.forEach(function (e, i) {
      near(f[i].ax, r.elev.pts[e[0]].x, 1e-9, p.name + ' Z' + deg + ' fax ' + i);
      near(f[i].ay, r.elev.pts[e[0]].y, 1e-9, p.name + ' Z' + deg + ' fay ' + i);
      near(f[i].bx, r.elev.pts[e[1]].x, 1e-9, p.name + ' Z' + deg + ' fbx ' + i);
      near(f[i].by, r.elev.pts[e[1]].y, 1e-9, p.name + ' Z' + deg + ' fby ' + i);
      near(t[i].ax, r.plan.pts[e[0]].x, 1e-9, p.name + ' Z' + deg + ' tax ' + i);
      near(t[i].ay, r.plan.pts[e[0]].y, 1e-9, p.name + ' Z' + deg + ' tay ' + i);
      near(t[i].bx, r.plan.pts[e[1]].x, 1e-9, p.name + ' Z' + deg + ' tbx ' + i);
      near(t[i].by, r.plan.pts[e[1]].y, 1e-9, p.name + ' Z' + deg + ' tby ' + i);
      near(t[i].ay, lt[i].ay, 1e-9, p.name + ' Z' + deg + ' plan ay kept ' + i);
      near(t[i].by, lt[i].by, 1e-9, p.name + ' Z' + deg + ' plan by kept ' + i);
    });
    var maxRigid = 0;
    var pf = [], qf = [];
    f.forEach(function (s) { pf.push([s.ax, s.ay]); pf.push([s.bx, s.by]); });
    lf.forEach(function (s) { qf.push([s.ax, s.ay]); qf.push([s.bx, s.by]); });
    for (var m = 0; m < pf.length; m++) {
      for (var k = m + 1; k < pf.length; k++) {
        var d1 = Math.hypot(pf[m][0] - pf[k][0], pf[m][1] - pf[k][1]);
        var d2 = Math.hypot(qf[m][0] - qf[k][0], qf[m][1] - qf[k][1]);
        if (Math.abs(d1 - d2) > maxRigid) maxRigid = Math.abs(d1 - d2);
      }
    }
    near(maxRigid, 0, 1e-9, p.name + ' Z' + deg + ' front rigid');
    deep(Proj.projectSolid(v, p.edges, p.faces, 'front'), f,
      p.name + ' Z' + deg + ' front deterministic');
    deep(Proj.projectSolid(v, p.edges, p.faces, 'top'), t,
      p.name + ' Z' + deg + ' top deterministic');
  });
});
pass('phase41 Z rotation exactness');

// 4 the ring-split formula: an upright prism spun about Z separates its
// plan rings by exactly height * sin(angle), both builds, whole sweep
PRISMS.forEach(function (p) {
  var rings = ringGroups(p.verts, p.edges);
  eq(rings.bot.length, 6, p.name + ' bottom ring edges');
  eq(rings.top.length, 6, p.name + ' top ring edges');
  [0, 15, 45, 90, 135, 180].forEach(function (deg) {
    var th = deg * Math.PI / 180;
    var v = Pose.applyPose(p.verts,
      { t: [0, 40, 0], rm: Pose.axisAngleMatrix(0, 0, 1, th), s: 1 }, p.center);
    var t = Proj.projectSolid(v, p.edges, p.faces, 'top');
    near(Math.abs(centroidX(t, rings.bot) - centroidX(t, rings.top)),
      rings.h * Math.sin(th), 1e-9, p.name + ' Z' + deg + ' split h*sin');
  });
});
pass('phase41 ring split formula');

// 5 occlusion stays live under Z: generic spins hide some edges but never
// all, verdicts move with the stance, and repeats agree bit for bit
PRISMS.forEach(function (p) {
  [15, 45].forEach(function (deg) {
    var v = Pose.applyPose(p.verts, { t: [0, 40, 0],
      rm: Pose.axisAngleMatrix(0, 0, 1, deg * Math.PI / 180), s: 1 }, p.center);
    ['front', 'top'].forEach(function (view) {
      var nHid = hiddenSet(Proj.projectSolid(v, p.edges, p.faces, view)).length;
      ok(nHid > 0 && nHid < 18,
        p.name + ' Z' + deg + ' ' + view + ' mixed (' + nHid + ')');
    });
  });
  var spun = Pose.applyPose(p.verts, { t: [0, 40, 0],
    rm: Pose.axisAngleMatrix(0, 0, 1, Math.PI / 4), s: 1 }, p.center);
  var moved = hiddenSet(Proj.projectSolid(spun, p.edges, p.faces, 'top'))
    .join(',') !== p.restHidden.top.join(',');
  ok(moved, p.name + ' spin moves top verdicts');
});
pass('phase41 occlusion stays live');

// 6 the datum wall: the lifted spin holds both views on-side, while the
// wall sits exactly at rest — down-Y and bare-Z gestures clamp to zero,
// the lifted spin runs full
(function () {
  var p = PRISMS[0];
  var v = Pose.applyPose(p.verts, { t: [0, 40, 0],
    rm: Pose.axisAngleMatrix(0, 0, 1, 0.8), s: 1 }, p.center);
  var f = Proj.projectSolid(v, p.edges, p.faces, 'front');
  var t = Proj.projectSolid(v, p.edges, p.faces, 'top');
  f.forEach(function (s, i) {
    ok(Pose.holdsSide(1, s.ay, 'elev') && Pose.holdsSide(1, s.by, 'elev'),
      'lifted front endpoint holds ' + i);
  });
  t.forEach(function (s, i) {
    ok(Pose.holdsSide(-1, s.ay, 'plan') && Pose.holdsSide(-1, s.by, 'plan'),
      'lifted top endpoint holds ' + i);
  });
  var now = Pose.reproject(v, p.edges);
  ok(Pose.projectionPairs(p.rest2D, now).every(function (pt) {
    return Pose.holdsSide(pt.ry, pt.py, pt.side);
  }), 'lifted spin holds exactly');
  var holds = function (pose) {
    var w = Pose.reproject(Pose.applyPose(p.verts, pose, p.center), p.edges);
    return Pose.projectionPairs(p.rest2D, w).every(function (pt) {
      return Pose.holdsSide(pt.ry, pt.py, pt.side);
    });
  };
  eq(Pose.limitFraction(function (fr) {
    return { t: [0, -30 * fr, 0], rm: I9.slice(), s: 1 };
  }, holds), 0, 'down-Y clamps to zero');
  eq(Pose.limitFraction(function (fr) {
    return { t: [0, 0, 0], rm: Pose.axisAngleMatrix(0, 0, 1, 0.8 * fr), s: 1 };
  }, holds), 0, 'bare-Z clamps to zero');
  eq(Pose.limitFraction(function (fr) {
    return { t: [0, 40 * fr, 0],
      rm: Pose.axisAngleMatrix(0, 0, 1, 0.8 * fr), s: 1 };
  }, holds), 1, 'lifted spin runs full');
})();
pass('phase41 datum wall');

// 7 README lists phase41 with the new grand total; package chains it
(function () {
  var readme = fs.readFileSync(README_PATH, 'utf8');
  ok(readme.indexOf('`npm run test:phase41`') !== -1, 'phase41 row');
  ok(readme.indexOf('Pose accuracy: Y-move/Z-rotate projection invariants on the hex prism') !== -1,
    'phase41 label');
  ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
    'grand total 1039');
  var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
  eq(pkg.scripts['test:phase41'], 'node tools/test-phase41-pose-accuracy.js',
    'test:phase41 script');
  ok(pkg.scripts.test.indexOf('node tools/test-phase41-pose-accuracy.js') !== -1,
    'chained in test');
})();
pass('phase41 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase41 tests passed');

'use strict';
// EduCAD phase 38: logical faces for hidden dashes. The 3D view already
// dashes an edge when every adjacent face turns away — but live wire
// from student ink ships faceless, so everything reads solid. The live
// core now infers faces for provably closed shells (strict proof:
// planar loops, every edge in exactly two faces, Euler V-E+F=2),
// purely so the existing classifier can dash hidden edges. No painted
// fill, no guessed faces: open, warped, or ambiguous wire stays
// faceless exactly as before. Run: `npm run test:phase38`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var R = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');
var S = require('../mirror/files/www.geogebra.org/educad-solid.js');

var ROOT = path.join(__dirname, '..');
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
function edgeUse(faces) {
  var use = {};
  faces.forEach(function (f) {
    for (var i = 0; i < f.length; i++) {
      var a = f[i], b = f[(i + 1) % f.length];
      var k = a < b ? a + '_' + b : b + '_' + a;
      use[k] = (use[k] || 0) + 1;
    }
  });
  return use;
}

// Resting box sheet (phase36 §7): 8 corners, exactly 12 box edges.
function boxSheet() {
  return [
    dot(0, 0, "A'"), dot(0, 0, 'A'),
    dot(35, 0, "B'"), dot(35, 0, 'B'),
    dot(0, 60, "C'"), dot(0, 0, 'C'),
    dot(35, 60, "D'"), dot(35, 0, 'D'),
    dot(0, 0, "E'"), dot(0, -35, 'E'),
    dot(35, 0, "F'"), dot(35, -35, 'F'),
    dot(0, 60, "G'"), dot(0, -35, 'G'),
    dot(35, 60, "H'"), dot(35, -35, 'H'),
    proj(0, -35, 60), proj(35, -35, 60),
    seg(0, 0, 35, 0), seg(35, 0, 35, 60),
    seg(35, 60, 0, 60), seg(0, 60, 0, 0),
    seg(0, 0, 35, 0), seg(35, 0, 35, -35),
    seg(35, -35, 0, -35), seg(0, -35, 0, 0)
  ];
}

// 1 a closed box infers six faces; stats shape untouched (additive only)
ok(/^10\.6\./.test(R.VERSION), 'version ' + R.VERSION);
eq(typeof R.inferClosedFaces, 'function', 'ships inferClosedFaces');
var boxRes = R.reconstructLive(boxSheet());
eq(boxRes.status, 'ok', 'box ok');
eq(boxRes.geometry.vertices.length, 8, 'box 8 corners');
eq(boxRes.geometry.edges.length, 12, 'box 12 edges');
eq(boxRes.geometry.faces.length, 6, 'box 6 faces');
eq(boxRes.geometry.vertices.length - boxRes.geometry.edges.length +
  boxRes.geometry.faces.length, 2, 'Euler V-E+F=2');
var use1 = edgeUse(boxRes.geometry.faces);
eq(Object.keys(use1).length, 12, 'faces cover 12 edges');
Object.keys(use1).forEach(function (k) {
  eq(use1[k], 2, 'edge ' + k + ' in exactly two faces');
});
deep(boxRes.stats, { seen: 16, paired: 8, edges: 12 }, 'stats unchanged');
pass('phase38 closed box infers six faces');

// 2 inferred faces orient outward: every normal points away from centroid
var vs2 = boxRes.geometry.vertices;
var cx2 = 0, cy2 = 0, cz2 = 0;
vs2.forEach(function (v) { cx2 += v.x; cy2 += v.y; cz2 += v.z; });
cx2 /= vs2.length; cy2 /= vs2.length; cz2 /= vs2.length;
function newell(verts, loop) {
  var nx = 0, ny = 0, nz = 0;
  for (var i = 0; i < loop.length; i++) {
    var p = verts[loop[i]], q = verts[loop[(i + 1) % loop.length]];
    nx += (p.y - q.y) * (p.z + q.z);
    ny += (p.z - q.z) * (p.x + q.x);
    nz += (p.x - q.x) * (p.y + q.y);
  }
  return { x: nx, y: ny, z: nz };
}
boxRes.geometry.faces.forEach(function (f, fi) {
  var fn = newell(vs2, f);
  var mx = 0, my = 0, mz = 0;
  f.forEach(function (vi) {
    mx += vs2[vi].x; my += vs2[vi].y; mz += vs2[vi].z;
  });
  mx = mx / f.length - cx2; my = my / f.length - cy2; mz = mz / f.length - cz2;
  ok(fn.x * mx + fn.y * my + fn.z * mz > 0, 'face ' + fi + ' outward');
});
pass('phase38 faces orient outward');

// 3 the existing classifier dashes exactly the hidden back edges at rest
var geom3 = S.createGeometry(boxRes.geometry);
var st3 = S.createSolidState({ geometry: geom3 });
var cls3 = S.classifyEdges(st3);
var hidden3 = cls3.filter(function (c) { return c.hidden; }).length;
eq(cls3.length, 12, '12 classified');
eq(hidden3, 3, '3 hidden at isometric rest');
eq(cls3.filter(function (c) { return !c.hidden; }).length, 9, '9 solid');
pass('phase38 hidden edges dash at rest');

// 4 open wire stays faceless: lone pair, open chain, empty loop set
var lone4 = R.reconstructLive(
  [dot(10, 20, "a'"), dot(10, -30, 'a'), proj(10, -30, 20)]);
eq(lone4.geometry.faces.length, 0, 'lone pair faceless');
var chain4 = R.reconstructLive([dot(10, 20, "a'"), dot(10, -30, 'a'),
  dot(30, 20, "c'"), dot(30, -5, 'c'),
  proj(10, -30, 20), proj(30, -5, 20),
  seg(10, 20, 30, 20), seg(10, -30, 30, -5)]);
eq(chain4.geometry.edges.length, 1, 'chain one edge');
eq(chain4.geometry.faces.length, 0, 'open chain faceless');
deep(R.inferClosedFaces([], []), [], 'empty in empty out');
deep(R.inferClosedFaces([{ x: 0, y: 0, z: 0 }], []), [], 'lone vertex out');
pass('phase38 open wire stays faceless');

// 5 warped shells fail the planarity proof: no partial faces, ever
var boxV = vs2.map(function (v) { return { x: v.x, y: v.y, z: v.z }; });
boxV[0] = { x: boxV[0].x, y: boxV[0].y, z: boxV[0].z + 1 };
deep(R.inferClosedFaces(boxV, boxRes.geometry.edges), [],
  'lifted corner voids every face');
pass('phase38 warped shells stay faceless');

// 6 a dangling spur voids closure: degree-1 vertices never bound a solid
var spurV = vs2.concat([{ x: 999, y: 999, z: 999 }]);
var spurE = boxRes.geometry.edges.concat([[0, 8]]);
deep(R.inferClosedFaces(spurV, spurE), [], 'spur voids closure');
pass('phase38 dangling spur voids closure');

// 7 dense open sheets terminate faceless (search is capped, never hangs)
var gridV = [], gi, gj;
for (gi = 0; gi < 6; gi++) {
  for (gj = 0; gj < 6; gj++) {
    gridV.push({ x: gi * 10, y: gj * 10, z: 0 });
  }
}
var gridE = [];
for (gi = 0; gi < 6; gi++) {
  for (gj = 0; gj < 6; gj++) {
    var here = gi * 6 + gj;
    if (gi < 5) gridE.push([here, here + 6]);
    if (gj < 5) gridE.push([here, here + 1]);
  }
}
deep(R.inferClosedFaces(gridV, gridE), [], 'flat grid faceless');
var longV = [];
for (gi = 0; gi < 200; gi++) longV.push({ x: gi, y: 0, z: 0 });
var longE = [];
for (gi = 0; gi < 199; gi++) longE.push([gi, gi + 1]);
deep(R.inferClosedFaces(longV, longE), [], 'long chain faceless');
pass('phase38 dense open sheets terminate faceless');

// 8 vertices and edges byte-identical: faces add, nothing else moves
deep(boxRes.geometry.vertices[2], { x: 0, y: 0, z: 0 }, 'corner A exact');
deep(boxRes.geometry.vertices[0], { x: 0, y: 60, z: 35 }, 'corner G exact');
deep(boxRes.geometry.edges.map(function (e) {
  return e[0] < e[1] ? e[0] + '_' + e[1] : e[1] + '_' + e[0];
}).sort(),
['0_1', '0_4', '0_6', '1_5', '1_7', '2_3',
  '2_4', '2_6', '3_5', '3_7', '4_5', '6_7'],
'box 12 edges, no diagonals');
pass('phase38 vertices and edges untouched');

// 9 README lists phase38 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase38`') !== -1, 'phase38 row');
ok(readme.indexOf('Logical faces: closed wire infers faces for hidden dashes') !== -1,
  'phase38 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 978');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase38'], 'node tools/test-phase38-closed-faces.js',
  'test:phase38 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase38-closed-faces.js') !== -1,
  'chained in test');
pass('phase38 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase38 tests passed');

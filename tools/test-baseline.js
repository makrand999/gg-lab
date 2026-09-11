(function (root) {
  'use strict';
  // Dual-env: Node runs tests now; browser exposes runner on window.
  // Zero dependencies: plain-Node assert/fs/path only.
  function defineTests(B, assert, fixtures) {
    var passed = 0;
    function t(n, name, fn) {
      fn();
      passed++;
      console.log('PASS ' + n + '/35 ' + name);
    }
    var q = fixtures.quadrant;
    var l = fixtures.line;
    var p = fixtures.prism;
    var b = fixtures.bis;

    // --- affine round-trip (2) ---
    t(1, 'affine round-trip err < 1e-9 mm', function () {
      var a = B.createAffine(2.5, 100, 50);
      var w = { x: 30, y: 15 };
      var back = a.screenToWorld(a.worldToScreen(w));
      var err = Math.hypot(back.x - w.x, back.y - w.y);
      assert.ok(err < 1e-9, 'err=' + err);
    });
    t(2, 'affine round-trip negative coords err < 1e-9 mm', function () {
      var a = B.createAffine(0.5, -200, 300);
      var w = { x: -123.456, y: 78.9 };
      var back = a.screenToWorld(a.worldToScreen(w));
      var err = Math.hypot(back.x - w.x, back.y - w.y);
      assert.ok(err < 1e-9, 'err=' + err);
    });
    // --- scale clamp (3) ---
    t(3, 'scale clamp low -> 0.05', function () {
      assert.strictEqual(B.clampScale(0.001), 0.05);
      assert.strictEqual(B.createAffine(0.001, 0, 0).scale, 0.05);
    });
    t(4, 'scale clamp high -> 50', function () {
      assert.strictEqual(B.clampScale(500), 50);
      assert.strictEqual(B.createAffine(500, 0, 0).scale, 50);
    });
    t(5, 'scale passthrough in range', function () {
      assert.strictEqual(B.clampScale(2.5), 2.5);
      assert.strictEqual(B.clampScale(0.05), 0.05);
      assert.strictEqual(B.clampScale(50), 50);
    });
    // --- cursor zoom (3) ---
    t(6, 'cursor-zoom invariance', function () {
      var v = { scale: 2, tx: 10, ty: 20 };
      var c = { x: 150, y: 90 };
      var before = { x: (c.x - v.tx) / v.scale, y: (c.y - v.ty) / v.scale };
      var nv = B.zoomAt(v, c, 2.5);
      var after = { x: (c.x - nv.tx) / nv.scale, y: (c.y - nv.ty) / nv.scale };
      assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-9);
    });
    t(7, 'zoom factor 1 is no-op', function () {
      var v = { scale: 3, tx: 7, ty: 9 };
      var nv = B.zoomAt(v, { x: 50, y: 60 }, 1);
      assert.ok(Math.abs(nv.scale - 3) < 1e-12);
      assert.ok(Math.abs(nv.tx - 7) < 1e-9 && Math.abs(nv.ty - 9) < 1e-9);
    });
    t(8, 'zoom clamps at 50 keeping cursor world', function () {
      var v = { scale: 10, tx: 0, ty: 0 };
      var c = { x: 200, y: 100 };
      var before = { x: (c.x - v.tx) / v.scale, y: (c.y - v.ty) / v.scale };
      var nv = B.zoomAt(v, c, 100);
      assert.strictEqual(nv.scale, 50);
      var after = { x: (c.x - nv.tx) / nv.scale, y: (c.y - nv.ty) / nv.scale };
      assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1e-9);
    });
    t(9, 'affine rejects NaN scale', function () {
      assert.throws(function () { B.createAffine(NaN, 0, 0); });
    });
    t(10, 'zoom rejects non-positive factor', function () {
      assert.throws(function () { B.zoomAt({ scale: 2, tx: 0, ty: 0 }, { x: 1, y: 1 }, 0); });
      assert.throws(function () { B.zoomAt({ scale: 2, tx: 0, ty: 0 }, { x: 1, y: 1 }, -2); });
    });
    // --- vertical eps (3) ---
    t(11, 'vertical eps 5e-10 -> true', function () {
      assert.strictEqual(B.isVerticalDx(5e-10), true);
    });
    t(12, 'vertical eps boundary 1e-9 -> false', function () {
      assert.strictEqual(B.isVerticalDx(1e-9), false);
    });
    t(13, 'vertical eps 2e-9 -> false', function () {
      assert.strictEqual(B.isVerticalDx(2e-9), false);
    });
    // --- coincident (3) ---
    t(14, 'coincident 5e-7 mm -> reject true', function () {
      assert.strictEqual(B.isCoincident({ x: 0, y: 0 }, { x: 5e-7, y: 0 }), true);
    });
    t(15, 'coincident boundary 1e-6 mm -> false', function () {
      assert.strictEqual(B.isCoincident({ x: 0, y: 0 }, { x: 1e-6, y: 0 }), false);
    });
    t(16, 'coincident 1e-3 mm -> false', function () {
      assert.strictEqual(B.isCoincident({ x: 0, y: 0 }, { x: 1e-3, y: 0 }), false);
    });
    // --- radius (3) ---
    t(17, 'radius min 0.005 -> 0.01', function () {
      assert.strictEqual(B.clampRadius(0.005), 0.01);
      assert.strictEqual(B.clampRadius(0), 0.01);
    });
    t(18, 'radius passthrough 2.5', function () {
      assert.strictEqual(B.clampRadius(2.5), 2.5);
    });
    t(19, 'radius NaN throws', function () {
      assert.throws(function () { B.clampRadius(NaN); });
    });
    // --- NaN guards (3) ---
    t(20, 'assertFinite throws on NaN', function () {
      assert.throws(function () { B.assertFinite(1, NaN); });
    });
    t(21, 'assertFinite throws on Infinity', function () {
      assert.throws(function () { B.assertFinite(Infinity); });
    });
    t(22, 'assertFinite passes on finite', function () {
      B.assertFinite(0, -1.5, 3.14);
    });
    // --- LM step clamp (5) ---
    t(23, 'LM scalar +80 -> 50', function () {
      assert.strictEqual(B.clampLMStep(80), 50);
    });
    t(24, 'LM scalar -80 -> -50', function () {
      assert.strictEqual(B.clampLMStep(-80), -50);
    });
    t(25, 'LM scalar passthrough 12.5', function () {
      assert.strictEqual(B.clampLMStep(12.5), 12.5);
    });
    t(26, 'LM vector norm 50 passthrough', function () {
      var r = B.clampLMStep({ dx: 30, dy: 40 });
      assert.ok(Math.abs(r.dx - 30) < 1e-12 && Math.abs(r.dy - 40) < 1e-12);
    });
    t(27, 'LM vector (60,80) -> (30,40)', function () {
      var r = B.clampLMStep({ dx: 60, dy: 80 });
      assert.ok(Math.abs(r.dx - 30) < 1e-9 && Math.abs(r.dy - 40) < 1e-9);
    });
    // --- fixtures (8) ---
    t(28, 'quadrant fixture monge + projector invariant', function () {
      assert.strictEqual(q.layout, 'monge-first-angle');
      assert.strictEqual(q.units, 'mm');
      assert.strictEqual(q.points.length, 4);
      assert.strictEqual(q.loci.length, 4);
      q.points.forEach(function (pt) {
        assert.ok(B.checkProjector(pt.planMm, pt.elevationMm),
          pt.id + ' projector violated');
      });
    });
    t(29, 'line fixture EL == TL cos phi', function () {
      var expect = l.trueLengthMm * Math.cos(l.phiDeg * Math.PI / 180);
      assert.ok(Math.abs(l.elevationLengthMm - expect) < 1e-9);
    });
    t(30, 'line fixture PL == TL cos theta', function () {
      var expect = l.trueLengthMm * Math.cos(l.thetaDeg * Math.PI / 180);
      assert.ok(Math.abs(l.planLengthMm - expect) < 1e-9);
    });
    t(31, 'line fixture projector + loci', function () {
      assert.ok(B.checkProjector(l.endpoints.A.planMm, l.endpoints.A.elevationMm));
      assert.ok(B.checkProjector(l.endpoints.B.planMm, l.endpoints.B.elevationMm));
      assert.ok(l.loci.length >= 2);
      assert.ok(l.loci.some(function (s) { return s.direction === 'vertical-projector'; }));
    });
    t(32, 'prism fixture 35mm + 8 vertices + projector', function () {
      assert.strictEqual(p.layout, 'monge-first-angle');
      assert.strictEqual(p.profileWidthMm, 35);
      assert.strictEqual(p.vertices.length, 8);
      assert.ok(p.loci.length >= 4);
      p.vertices.forEach(function (v) {
        assert.ok(B.checkProjector(v.planMm, v.elevationMm), v.id);
      });
    });
    t(33, 'prism elevation height 60 plan edge 35', function () {
      function byId(id) { return p.vertices.filter(function (v) { return v.id === id; })[0]; }
      var a1 = byId('A1'), b1 = byId('B1'), a2 = byId('A2');
      var h = Math.abs(a2.elevationMm.y - a1.elevationMm.y);
      var w = Math.abs(b1.elevationMm.x - a1.elevationMm.x);
      var pe = Math.abs(b1.planMm.x - a1.planMm.x);
      assert.ok(Math.abs(h - 60) < 1e-9);
      assert.ok(Math.abs(w - 35) < 1e-9);
      assert.ok(Math.abs(pe - 35) < 1e-9);
    });
    t(34, 'bis fixture codes exactly A B E G H K', function () {
      assert.deepStrictEqual(b.requiredCodes.slice().sort(), ['A', 'B', 'E', 'G', 'H', 'K']);
      b.requiredCodes.forEach(function (c) { assert.ok(b.codes[c], 'missing ' + c); });
      assert.strictEqual(Object.keys(b.codes).length, 6);
    });
    t(35, 'bis fixture A/B/G semantics', function () {
      assert.strictEqual(b.codes.A.pattern, 'continuous');
      assert.strictEqual(b.codes.A.width, 'thick');
      assert.strictEqual(b.codes.B.pattern, 'continuous');
      assert.strictEqual(b.codes.B.width, 'thin');
      assert.ok(/centre/i.test(b.codes.G.use));
    });
    console.log('OK ' + passed + '/35 baseline tests passed');
    return passed;
  }

  if (typeof module !== 'undefined' && typeof require === 'function') {
    var B = require('./educad-baseline.js');
    var assert = require('assert');
    var fs = require('fs');
    var path = require('path');
    function load(n) {
      return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8'));
    }
    var fixtures = {
      quadrant: load('quadrant_point_projection.json'),
      line: load('line_inclined_both_planes.json'),
      prism: load('prism_35mm_profile.json'),
      bis: load('bis_sp46_linestyles.json')
    };
    defineTests(B, assert, fixtures);
    module.exports = { defineTests: defineTests };
  } else {
    root.EduCADBaselineTests = { defineTests: defineTests, count: 35 };
  }
})(typeof window !== 'undefined' ? window : globalThis);

'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var zlib = require('zlib');
var http = require('http');

var MIRROR = path.join(__dirname, '..', 'mirror', 'files', 'www.geogebra.org');
var Boot = require('../mirror/files/www.geogebra.org/educad-boot.js');
var Common = require('../mirror/files/www.geogebra.org/edugraphics-common.js');
var Vp = require('../mirror/files/www.geogebra.org/educad-viewport.js');
var Cv = require('../mirror/files/www.geogebra.org/educad-canvas.js');
var Ent = require('../mirror/files/www.geogebra.org/educad-entities.js');
var Shim = require('../mirror/files/www.geogebra.org/educad-shim.js');
var Solver = require('../mirror/files/www.geogebra.org/educad-solver.js');
var Snap = require('../mirror/files/www.geogebra.org/edugraphics-snapping.js');
var Instr = require('../mirror/files/www.geogebra.org/edugraphics-instruments.js');
var Curr = require('../mirror/files/www.geogebra.org/educad-curriculum.js');
var Serve = require('./serve.js');

var TOTAL = 33;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

function deps() {
  return {
    viewport: Vp, canvas: Cv, entities: Ent, shim: Shim, solver: Solver,
    snapping: Snap, instruments: Instr, curriculum: Curr, common: Common
  };
}

function benchMs(fn, iters) {
  var ts = [];
  for (var i = 0; i < iters; i++) {
    var t0 = process.hrtime.bigint();
    fn();
    var t1 = process.hrtime.bigint();
    ts.push(Number(t1 - t0) / 1e6);
  }
  ts.sort(function (a, b) { return a - b; });
  return { median: ts[Math.floor(ts.length / 2)], min: ts[0], max: ts[ts.length - 1] };
}

function get(port, urlPath) {
  return new Promise(function (resolve, reject) {
    var req = http.get({ host: '127.0.0.1', port: port, path: urlPath }, function (res) {
      var body = '';
      res.on('data', function (c) { body += c; });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body: body });
      });
    });
    req.on('error', reject);
  });
}

function onceListening(srv) {
  return new Promise(function (resolve, reject) {
    srv.once('listening', resolve);
    srv.once('error', reject);
  });
}

function closeServer(srv) {
  return new Promise(function (resolve) { srv.close(function () { resolve(); }); });
}

async function main() {
  // 1 boot loads, mm units, version 7.x
  eq(Boot.WORLD_UNITS, 'mm');
  ok(/^7\./.test(Boot.VERSION), 'version ' + Boot.VERSION);
  pass('phase7 boot loads mm v7');

  // 2 zero deps + dual-env markers for new mirror js
  var bootSrc = fs.readFileSync(path.join(MIRROR, 'educad-boot.js'), 'utf8');
  var commonSrc = fs.readFileSync(path.join(MIRROR, 'edugraphics-common.js'), 'utf8');
  eq(bootSrc.indexOf('require('), -1);
  eq(commonSrc.indexOf('require('), -1);
  ok(bootSrc.indexOf('module.exports') !== -1, 'boot node marker');
  ok(commonSrc.indexOf('module.exports') !== -1, 'common node marker');
  ok(bootSrc.indexOf('EduCADBoot') !== -1, 'boot window marker');
  ok(commonSrc.indexOf('EduGraphicsCommon') !== -1, 'common window marker');
  pass('phase7 zero deps dual-env');

  // 3 boot exports + budgets
  ['init', 'dispose', 'statusOf', 'coldBootMs', 'checkProjector',
    'MODULE_FILES', 'MODULE_NAMES'].forEach(function (k) {
    ok(Boot[k] !== undefined, 'export ' + k);
  });
  eq(Boot.BOOT_BUDGET_MS, 3);
  eq(Boot.BUNDLE_BUDGET_KB, 80);
  eq(Boot.HEAP_BUDGET_MB, 35);
  eq(Boot.MODULE_FILES.length, 10);
  eq(Boot.MODULE_NAMES.length, 9);
  pass('phase7 boot exports budgets');

  // 4 common exports: 3 buttons + 2 menu options, no DOM in Node
  ['mountContainer', 'unmountContainer', 'isMounted', 'hasDOM'].forEach(function (k) {
    eq(typeof Common[k], 'function', 'common.' + k);
  });
  deep(Common.BUTTONS, ['zoom-in', 'zoom-out', 'zoom-home']);
  deep(Common.MENU_ITEMS, ['plain', 'mesh']);
  eq(Common.MENU_LABELS.plain, 'Plain (No Mesh)');
  eq(Common.MENU_LABELS.mesh, 'Box Mesh');
  eq(Common.menuChecked(false).plain, true);
  eq(Common.menuChecked(true).mesh, true);
  deep(Common.LAYERS, ['layer1', 'layer2']);
  eq(Common.hasDOM(), false);
  pass('phase7 common exports 3x2');

  // 5 cold boot under 3 ms (median of 11 init+dispose cycles)
  var b5 = benchMs(function () { Boot.dispose(Boot.init(deps())); }, 11);
  console.log('  boot median ms: ' + b5.median.toFixed(3) +
    ' min ' + b5.min.toFixed(3) + ' max ' + b5.max.toFixed(3));
  ok(b5.median < Boot.BOOT_BUDGET_MS, 'median ' + b5.median + ' < 3 ms');
  pass('phase7 cold boot under 3ms');

  // 6 coldBootMs helper agrees (best of 5 under 3 ms)
  var samples = [];
  for (var i6 = 0; i6 < 5; i6++) samples.push(Boot.coldBootMs(deps()));
  var best6 = Math.min.apply(null, samples);
  console.log('  coldBootMs best of 5: ' + best6.toFixed(3));
  samples.forEach(function (s) { ok(Number.isFinite(s), 'finite sample'); });
  ok(best6 < Boot.BOOT_BUDGET_MS, 'best ' + best6 + ' < 3 ms');
  pass('phase7 coldBootMs helper');

  // 7 init wires all modules
  var h7 = Boot.init(deps());
  ok(h7.view && h7.canvasState && h7.table, 'core trio');
  ok(h7.applet && h7.solverHandle, 'applet+solver');
  ok(h7.ruler && h7.compass, 'ruler+compass');
  var m7 = h7.modules;
  eq([m7.viewport, m7.canvas, m7.entities, m7.shim, m7.solver,
    m7.snapping, m7.instruments, m7.curriculum, m7.common]
    .filter(function (x) { return !!x; }).length, 9);
  eq(h7.booted, true);
  Boot.dispose(h7);
  pass('phase7 init wires all');

  // 8 headless Node-safe init (no container, no DOM)
  var h8 = Boot.init(deps());
  eq(h8.mount, null);
  eq(h8.view.s, 2.0);
  deep(h8.canvasState.layers, ['layer1', 'layer2']);
  deep(Boot.statusOf(h8), { booted: true, disposed: false, entities: 0, mounted: false });
  Boot.dispose(h8);
  pass('phase7 headless node-safe');

  // 9 missing core module throws
  throws(function () { Boot.init({}); });
  throws(function () { Boot.init({ viewport: Vp }); });
  throws(function () { Boot.init({ viewport: Vp, canvas: Cv }); });
  throws(function () { Boot.init({ viewport: Vp, canvas: Cv, entities: Ent, container: {} }); });
  pass('phase7 missing module throws');

  // 10 dispose clears table, idempotent, guards
  var h10 = Boot.init(deps());
  h10.table.create('POINT', { x: 1, y: 2 });
  eq(h10.table.count(), 1);
  Boot.dispose(h10);
  eq(h10.table.count(), 0);
  eq(h10.disposed, true);
  Boot.dispose(h10);
  eq(h10.disposed, true);
  throws(function () { Boot.dispose(null); });
  throws(function () { Boot.statusOf(null); });
  pass('phase7 dispose lifecycle');

  // 11 re-init after dispose works
  var h11 = Boot.init(deps());
  eq(h11.disposed, false);
  eq(Boot.statusOf(h11).booted, true);
  Boot.dispose(h11);
  pass('phase7 re-init works');

  // 12 projector invariant via boot
  ok(Boot.checkProjector({ x: 5, y: 1 }, { x: 5, y: 9 }));
  ok(!Boot.checkProjector({ x: 5, y: 1 }, { x: 6, y: 9 }));
  ok(Boot.checkProjector({ x: 5, y: 1 }, { x: 5.0005, y: 9 }, 0.001));
  pass('phase7 boot projector');

  // 13 mm-only entities, ephemeral px render
  var h13 = Boot.init(deps());
  var e13 = h13.table.create('SEGMENT', { x: 0, y: 0, x2: 10, y2: 0 });
  Object.keys(e13).forEach(function (k) {
    ok(k.toLowerCase().indexOf('px') === -1, 'no px key ' + k);
  });
  var job13 = Ent.renderEntity(h13.view, e13);
  ok(job13.lenPx > 0, 'ephemeral px job');
  eq(Object.keys(e13).filter(function (k) { return k.toLowerCase().indexOf('px') !== -1; }).length, 0);
  Boot.dispose(h13);
  pass('phase7 mm-only ephemeral px');

  // 14 applet pipeline smoke via boot handle
  var h14 = Boot.init(deps());
  eq(h14.applet.evalCommand('P7=Point(10,20)'), 'P7');
  eq(h14.applet.exists('P7'), true);
  eq(h14.applet.getXcoord('P7'), 10);
  eq(h14.applet.getYcoord('P7'), 20);
  ok(h14.applet.getAllObjectNames().indexOf('P7') !== -1, 'listed');
  Boot.dispose(h14);
  pass('phase7 applet pipeline');

  // 15 solver wired via boot handle
  var h15 = Boot.init(deps());
  var r15 = h15.modules.solver.solveMongeLine(
    { TL: 50, thetaDeg: 30, phiDeg: 45, yaPlan: -10, yaElev: 20 });
  ok(r15.angleErrTheta < 0.01 && r15.angleErrPhi < 0.01, 'angle err');
  eq(r15.projectorOk, true);
  eq(typeof h15.solverHandle.solve, 'function');
  Boot.dispose(h15);
  pass('phase7 solver wired');

  // 16 snapping wired via boot handle
  var h16 = Boot.init(deps());
  eq(h16.modules.snapping.tierRank('ENDPOINT'), 0);
  eq(h16.modules.snapping.SNAP_LOCK_PX, 14);
  var s16 = h16.modules.snapping.snapAt({ x: 400, y: 300 }, h16.view, { entities: [] }, null);
  eq(s16.snap, null);
  eq(s16.ring, null);
  Boot.dispose(h16);
  pass('phase7 snapping wired');

  // 17 instruments wired via boot handle
  var h17 = Boot.init(deps());
  Instr.rulerDown(h17.ruler, { x: 0, y: 0 });
  Instr.rulerMove(h17.ruler, { x: 30, y: 0 });
  Instr.rulerUp(h17.ruler);
  eq(h17.ruler.state, 'placed');
  eq(Instr.rulerCommit(h17.ruler).type, 'SEGMENT');
  Instr.compassSetPin(h17.compass, { x: 0, y: 0 });
  Instr.compassSetRadius(h17.compass, 25);
  eq(h17.compass.state, 'radius-set');
  eq(Instr.compassCommit(h17.compass).type, 'CIRCLE');
  Boot.dispose(h17);
  pass('phase7 instruments wired');

  // 18 curriculum available via boot, not built at boot
  var h18 = Boot.init(deps());
  eq(Boot.statusOf(h18).entities, 0);
  var q18 = h18.modules.curriculum.quadrantPoint({ quadrant: 1 });
  eq(q18.projectorOk, true);
  eq(h18.modules.curriculum.validateBundle(q18).ok, true);
  Boot.dispose(h18);
  pass('phase7 curriculum lazy');

  // 19 common headless mount stub shape
  var m19 = Common.mountContainer(null, { w: 640, h: 480 });
  eq(m19.headless, true);
  eq(m19.mounted, true);
  eq(m19.layers.length, 2);
  eq(m19.buttons.length, 3);
  eq(m19.menu.length, 2);
  eq(Common.isMounted(m19), true);
  Common.unmountContainer(m19);
  eq(Common.isMounted(m19), false);
  Common.unmountContainer(m19);
  eq(Common.isMounted(m19), false);
  eq(Common.mountContainer({}, {}).headless, true);
  eq(Common.unmountContainer(null), null);
  pass('phase7 common headless mount');

  // 20 css ships HUD + 2-option menu only, no extra chrome words
  var cssPath = path.join(MIRROR, 'edugraphics-hud.css');
  var css = fs.readFileSync(cssPath, 'utf8');
  ok(css.length > 100 && css.length < 10240, 'css size ' + css.length);
  ['.edugraphics-hud', '.edugraphics-menu', '.edugraphics-btn',
    '.edugraphics-layer1', '.edugraphics-layer2'].forEach(function (sel) {
    ok(css.indexOf(sel) !== -1, 'css ' + sel);
  });
  var cssLow = css.toLowerCase();
  ['toolbar', 'dialog', 'panel'].forEach(function (w) {
    eq(cssLow.indexOf(w), -1, 'css has no ' + w);
  });
  pass('phase7 hud css only');

  // 21 canvas chrome limits hold (3 buttons, 2 menu options)
  deep(Cv.BUTTON_IDS, ['zoom-in', 'zoom-out', 'zoom-home']);
  eq(Cv.MENU_OPTIONS.length, 2);
  deep(Cv.MENU_OPTIONS.map(function (o) { return o.id; }), ['plain', 'mesh']);
  deep(Cv.MENU_OPTIONS.map(function (o) { return o.label; }), ['Plain (No Mesh)', 'Box Mesh']);
  pass('phase7 chrome limits');

  // 22 dual-env exports present in every mirror js
  var jsFiles = fs.readdirSync(MIRROR).filter(function (f) { return /\.js$/.test(f); });
  ok(jsFiles.length >= 10, 'mirror js count ' + jsFiles.length);
  jsFiles.forEach(function (f) {
    var src = fs.readFileSync(path.join(MIRROR, f), 'utf8');
    ok(src.indexOf('module.exports') !== -1, f + ' node export');
    ok(src.indexOf('window') !== -1, f + ' window export');
  });
  pass('phase7 dual-env every module');

  // 23 no forbidden framework/chrome strings in mirror js
  var banned = ['react', 'vue', 'toolbar', 'dialog', 'webgl', 'tinkercad', 'three.js'];
  jsFiles.forEach(function (f) {
    var low = fs.readFileSync(path.join(MIRROR, f), 'utf8').toLowerCase();
    banned.forEach(function (w) {
      eq(low.indexOf(w), -1, f + ' has no ' + w);
    });
  });
  pass('phase7 no forbidden strings');

  // 24 gzipped bundle under 80 KB
  var bundle = '';
  Boot.MODULE_FILES.forEach(function (f) {
    bundle += fs.readFileSync(path.join(MIRROR, f), 'utf8') + '\n';
  });
  var gz = zlib.gzipSync(bundle);
  console.log('  bundle raw ' + bundle.length + ' B, gzip ' + gz.length +
    ' B (' + (gz.length / 1024).toFixed(1) + ' KB)');
  ok(gz.length < Boot.BUNDLE_BUDGET_KB * 1024, 'gzip ' + gz.length + ' < 80 KB');
  pass('phase7 gzip bundle under 80KB');

  // 25 heap under 35 MB smoke
  var h25 = Boot.init(deps());
  h25.table.create('POINT', { x: 1, y: 2 });
  var g25 = Curr.generateCurriculum();
  eq(Curr.validateBundle(g25).ok, true);
  var heapMB = process.memoryUsage().heapUsed / 1048576;
  console.log('  heapUsed ' + heapMB.toFixed(2) + ' MB');
  ok(heapMB < Boot.HEAP_BUDGET_MB, 'heap ' + heapMB + ' < 35 MB');
  Boot.dispose(h25);
  pass('phase7 heap under 35MB');

  // 26 serve.js loads: host/port/root, content types, core-only deps
  eq(Serve.HOST, '127.0.0.1');
  eq(Serve.PORT, 8124);
  eq(Serve.ROOT, path.join(__dirname, '..', 'mirror'));
  ok(Serve.contentTypeFor('a.js').indexOf('javascript') !== -1, 'js type');
  ok(Serve.contentTypeFor('a.css').indexOf('css') !== -1, 'css type');
  var serveSrc = fs.readFileSync(path.join(__dirname, 'serve.js'), 'utf8');
  var reqRe = /require\('([^']+)'\)/g;
  var mm;
  var allowedCore = ['http', 'fs', 'path'];
  var foundReq = [];
  while ((mm = reqRe.exec(serveSrc)) !== null) foundReq.push(mm[1]);
  ok(foundReq.length > 0, 'serve requires parsed');
  foundReq.forEach(function (r) {
    ok(allowedCore.indexOf(r) !== -1, 'core-only require ' + r);
  });
  pass('phase7 serve loads zero-dep');

  // 27-29 live server checks on 127.0.0.1:8124
  var srv = Serve.start(8124, '127.0.0.1');
  await onceListening(srv);
  try {
    // 27 root check
    var r27 = await get(8124, '/');
    eq(r27.status, 200);
    ok(r27.body.indexOf('files') !== -1, 'root lists files');
    pass('phase7 server root check');

    // 28 serves boot js with javascript type
    var r28 = await get(8124, '/files/www.geogebra.org/educad-boot.js');
    eq(r28.status, 200);
    ok(String(r28.headers['content-type']).indexOf('javascript') !== -1, 'js content-type');
    ok(r28.body.indexOf('EduCADBoot') !== -1, 'boot body');
    pass('phase7 server serves boot');

    // 29 serves css, 404s missing, blocks traversal
    var r29a = await get(8124, '/files/www.geogebra.org/edugraphics-hud.css');
    eq(r29a.status, 200);
    ok(String(r29a.headers['content-type']).indexOf('css') !== -1, 'css content-type');
    var r29b = await get(8124, '/__missing_educad_404__');
    eq(r29b.status, 404);
    var r29c = await get(8124, '/..%2F..%2Fpackage.json');
    ok(r29c.status === 404 || r29c.status === 400, 'traversal blocked ' + r29c.status);
    ok(r29c.body.indexOf('educad-phase0') === -1, 'no leak');
    pass('phase7 server css 404 traversal');
  } finally {
    await closeServer(srv);
  }

  // 30 bundle inventory: every module file on disk, non-empty
  var rawTotal = 0;
  Boot.MODULE_FILES.forEach(function (f) {
    var st = fs.statSync(path.join(MIRROR, f));
    ok(st.size > 500, f + ' size ' + st.size);
    rawTotal += st.size;
  });
  ok(fs.statSync(cssPath).size > 100, 'css on disk');
  console.log('  raw total ' + rawTotal + ' B across ' + Boot.MODULE_FILES.length + ' js files');
  pass('phase7 bundle inventory');

  // 31 hidpi buffer math + dpr-aware mount under mock DOM
  var hb31 = Common.hidpiBufferSize(800, 600, 2);
  eq(hb31.bufW, 1600);
  eq(hb31.bufH, 1200);
  eq(hb31.cssW, 800);
  eq(Common.hidpiBufferSize(800, 600, 0).bufW, 800);
  eq(Common.resolveDpr(3), 3);
  eq(Common.resolveDpr(undefined), 1);
  global.window = { devicePixelRatio: 2 };
  eq(Common.resolveDpr(undefined), 2);
  eq(Common.resolveDpr(1), 1);
  delete global.window;
  var seenTx = [];
  function fakeNode() {
    return {
      className: '', children: [], attrs: {}, style: {}, textContent: '',
      setAttribute: function (k, v) { this.attrs[k] = v; },
      appendChild: function (c) { this.children.push(c); return c; },
      getContext: function () {
        return { setTransform: function (a, b, c, d, e, f) { seenTx.push([a, b, c, d, e, f]); } };
      }
    };
  }
  global.document = { createElement: function () { return fakeNode(); } };
  try {
    var m31 = Common.mountContainer(fakeNode(), { w: 400, h: 300, dpr: 2 });
    eq(m31.headless, false);
    eq(m31.layer1.width, 800);
    eq(m31.layer1.height, 600);
    eq(m31.layer1.style.width, '400px');
    eq(m31.dpr, 2);
    eq(seenTx.length, 2);
    deep(seenTx[0], [2, 0, 0, 2, 0, 0]);
  } finally {
    delete global.document;
  }
  pass('phase7 hidpi mount');

  // 32 port precedence: argv, then $PORT, then 8124
  var oldPort = process.env.PORT;
  process.env.PORT = '9011';
  eq(Serve.resolvePort(undefined), 9011);
  eq(Serve.resolvePort('9022'), 9022);
  process.env.PORT = 'bogus';
  eq(Serve.resolvePort(undefined), 8124);
  eq(Serve.resolvePort('nope'), 8124);
  if (oldPort === undefined) delete process.env.PORT;
  else process.env.PORT = oldPort;
  pass('phase7 port precedence');

  // 33 EADDRINUSE falls forward to the next free port
  var occ33 = Serve.start(0, '127.0.0.1');
  await onceListening(occ33);
  var pOcc33 = occ33.address().port;
  var fb33 = await new Promise(function (resolve, reject) {
    Serve.startNextAvailable(pOcc33, '127.0.0.1', Serve.ROOT, 5, function (err, srv, actual) {
      if (err) reject(err);
      else resolve({ srv: srv, actual: actual });
    });
  });
  try {
    ok(fb33.actual !== pOcc33, 'moved to ' + fb33.actual);
    var r33 = await get(fb33.actual, '/');
    eq(r33.status, 200);
  } finally {
    await closeServer(fb33.srv);
    await closeServer(occ33);
  }
  pass('phase7 port fallback');

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' phase7 tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

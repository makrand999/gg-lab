'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var R = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');
var C = require('../mirror/files/www.geogebra.org/educad-curriculum.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 14;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }

var index = fs.readFileSync(INDEX_PATH, 'utf8');
var BTN = '<button class="demo-btn" id="btn-demo-3view">3-View Prism (35mm)</button>';

// 1 exact button label and id inside the demo bar
ok(index.indexOf(BTN) !== -1, 'exact button markup');
var bar = /<div class="demo-bar">([\s\S]*?)<\/div>/.exec(index);
ok(bar, 'demo bar found');
ok(bar[1].indexOf(BTN) !== -1, 'button inside demo bar');
pass('phase15 button label and id');

// 2 button order: after prism, before clear
var iPrism = bar[1].indexOf('id="btn-demo-prism"');
var i3view = bar[1].indexOf('id="btn-demo-3view"');
var iClear = bar[1].indexOf('id="btn-clear"');
ok(iPrism !== -1 && i3view !== -1 && iClear !== -1, 'all three ids present');
ok(iPrism < i3view, '3view after prism');
ok(i3view < iClear, '3view before clear');
pass('phase15 button order');

// 3 Manual stays the last demo-bar child
ok(bar[1].indexOf('id="btn-manual"') !== -1, 'manual id');
ok(bar[1].indexOf('id="btn-manual"') > bar[1].indexOf('id="btn-clear"'),
  'manual after clear');
ok(/<a class="demo-btn"[^>]*>Manual<\/a>\s*$/.test(bar[1]), 'manual last child');
pass('phase15 manual last');

// 4 loadDemo 3view branch calls threeViewSheet with the exact literals
var bi = index.indexOf("type === '3view'");
ok(bi !== -1, '3view branch');
var call = 'EduCADCurriculum.threeViewSheet({ solid: \'PRISM\', ' +
  'sizeMm: 35, heightMm: 70, xMm: 0 })';
var ci = index.indexOf(call);
ok(ci !== -1, 'exact threeViewSheet call');
ok(ci > bi, 'call inside 3view branch');
var ai = index.indexOf("getElementById('btn-demo-3view')");
ok(ai > bi && ai < ci, 'branch activates the button');
pass('phase15 loadDemo branch');

// 5 click listener wires the button to loadDemo('3view')
var li = index.indexOf("getElementById('btn-demo-3view').addEventListener('click', " +
  "function () { loadDemo('3view'); });");
ok(li !== -1, 'click listener');
ok(li > index.indexOf("loadDemo('prism'); });"), 'listener next to prism listener');
ok(li < index.indexOf("getElementById('btn-clear')"), 'listener before clear listener');
pass('phase15 click listener');

// 6 hash dispatch recognizes #3view before the default loadDemo('line')
var hi = index.indexOf("hash === '#3view'");
ok(hi !== -1, 'hash branch');
ok(hi > index.indexOf("hash === '#prism'"), 'hash branch after #prism');
ok(index.indexOf("loadDemo('3view');", hi) !== -1, 'hash branch loads 3view');
ok(hi < index.lastIndexOf("loadDemo('line')"), 'hash branch before default');
pass('phase15 hash dispatch');

// 7 active sweep still selects every .demo-btn
ok(index.indexOf("querySelectorAll('.demo-btn')") !== -1, 'active sweep kept');
ok(BTN.indexOf('class="demo-btn"') !== -1, 'new button joins the sweep');
pass('phase15 active sweep');

function buttonBundle() {
  return C.threeViewSheet({ solid: 'PRISM', sizeMm: 35, heightMm: 70, xMm: 0 });
}

// 8 the button's exact bundle validates
var bundle = buttonBundle();
eq(C.validateBundle(bundle).ok, true);
pass('phase15 bundle validates');

// 9 headless reconstruction: live wire, 12v / 18e / 8f (phase38 infers faces)
var r = R.reconstructLive(bundle.entities);
eq(r.status, 'ok');
eq(r.class, null);
eq(r.geometry.vertices.length, 12);
eq(r.geometry.edges.length, 18);
eq(r.geometry.faces.length, 8);
pass('phase15 reconstruct wire 12v 18e');

// 10 drawn proportions: 35 mm span, 70 mm height
var xs = r.geometry.vertices.map(function (v) { return v.x; });
var ys = r.geometry.vertices.map(function (v) { return v.y; });
ok(Math.abs(Math.max.apply(null, xs) - Math.min.apply(null, xs) - 35) < 1e-9,
  'x-span 35 mm');
ok(Math.abs(Math.max.apply(null, ys) - Math.min.apply(null, ys) - 70) < 1e-9,
  'height 70 mm');
pass('phase15 drawn proportions');

// 11 determinism: rebuild + reconstruct yields identical JSON geometry
var b2 = buttonBundle();
eq(JSON.stringify(b2.entities), JSON.stringify(bundle.entities));
var r2 = R.reconstructLive(b2.entities);
eq(JSON.stringify(r2.geometry), JSON.stringify(r.geometry));
pass('phase15 deterministic');

// 12 docs/MANUAL.md names the button label and the #3view hash
var md = fs.readFileSync(MD_PATH, 'utf8');
ok(md.indexOf('3-View Prism (35mm)') !== -1, 'manual names the button');
ok(md.indexOf('#3view') !== -1, 'manual names the hash');
pass('phase15 manual sync');

// 13 README.md lists the phase15 suite and the grand total
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('npm run test:phase15') !== -1, 'readme lists phase15');
ok(readme.indexOf('(1039 checks)') !== -1, 'readme grand total');
pass('phase15 readme sync');

// 14 package.json chains the phase15 suite after phase14
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase15'], 'node tools/test-phase15-demo-3view.js');
var chain = pkg.scripts.test;
ok(chain.indexOf('node tools/test-phase14-glass.js') !== -1, 'phase14 kept');
ok(chain.indexOf('node tools/test-phase14-glass.js') <
  chain.indexOf('node tools/test-phase15-demo-3view.js'), 'phase15 after phase14');
pass('phase15 package sync');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase15 tests passed');

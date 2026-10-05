'use strict';
var assert = require('assert');
var child = require('child_process');
var fs = require('fs');
var path = require('path');
var http = require('http');
var net = require('net');
var os = require('os');

var Build = require('./build-manual.js');

var ROOT = path.join(__dirname, '..');
var SERVER = path.join(ROOT, 'backend', 'build', 'educad-server');
var SEED = path.join(ROOT, 'backend', 'build', 'educad-seed');
var USERS = path.join(ROOT, 'tools', 'users.json');
var MIRROR = path.join(ROOT, 'mirror');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'mirror', 'manual.html');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');

var TOTAL = 22;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }

function count(hay, needle) {
  return hay.split(needle).length - 1;
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

function freePort() {
  return new Promise(function (resolve, reject) {
    var s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', function () {
      var p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

function waitReady(port, srv, timeoutMs) {
  var start = Date.now();
  return new Promise(function (resolve, reject) {
    (function poll() {
      get(port, '/manual.html').then(function (r) {
        if (r.status === 200) return resolve();
        if (Date.now() - start > timeoutMs) return reject(new Error('server not ready'));
        setTimeout(poll, 100);
      }, function () {
        if (srv.exitCode !== null) return reject(new Error('server exited early'));
        if (Date.now() - start > timeoutMs) return reject(new Error('server not ready'));
        setTimeout(poll, 100);
      });
    })();
  });
}

async function main() {
  var md = fs.readFileSync(MD_PATH, 'utf8');
  var html = fs.readFileSync(HTML_PATH, 'utf8');

  // 1 builder loads and exports the renderer/slugify functions
  eq(typeof Build.renderPage, 'function', 'renderPage export');
  eq(typeof Build.slugify, 'function', 'slugify export');
  eq(typeof Build.renderBody, 'function', 'renderBody export');
  eq(typeof Build.renderInline, 'function', 'renderInline export');
  pass('phase11 builder loads exports');

  // 2 slugify matches the limitations anchor
  eq(Build.slugify('12. Limitations / not implemented'),
    '12-limitations--not-implemented');
  pass('phase11 slug limitations');

  // 3 slugify matches the line-tool anchor
  eq(Build.slugify('4.3 Line / segment (Ctrl+click P1, click P2, pick BIS type)'),
    '43-line--segment-ctrlclick-p1-click-p2-pick-bis-type');
  pass('phase11 slug line tool');

  // 4 slugify matches the polar anchor; duplicates get -1, -2
  eq(Build.slugify('4.5 Polar point (angle + distance from an anchor)'),
    '45-polar-point-angle--distance-from-an-anchor');
  var dup = Build.renderBody('# Dup\n\n# Dup\n\n# Dup\n');
  ok(dup.indexOf('id="dup"') !== -1, 'first dup bare');
  ok(dup.indexOf('id="dup-1"') !== -1, 'second dup -1');
  ok(dup.indexOf('id="dup-2"') !== -1, 'third dup -2');
  pass('phase11 slug polar duplicates');

  // 5 rendering is deterministic: two calls byte-equal, no local paths leak
  var a5 = Build.renderPage(md);
  var b5 = Build.renderPage(md);
  eq(a5, b5);
  eq(a5.indexOf('/root/'), -1, 'no absolute paths');
  ok(a5.length > 50000, 'substantial page ' + a5.length);
  pass('phase11 deterministic render');

  // 6 committed page equals fresh output (staleness guard)
  ok(html === a5,
    'public/manual.html is stale: run npm run build:manual to regenerate it');
  pass('phase11 committed page fresh');

  // 7 no script of any kind, no inline handlers, no javascript: urls
  eq(html.toLowerCase().indexOf('<script'), -1, 'no script element');
  ok(!/ on[a-z]+=("|')/i.test(html), 'no on*= handlers');
  eq(html.indexOf('javascript:'), -1, 'no javascript: urls');
  pass('phase11 no script handlers');

  // 8 every href="#..." in the generated file resolves to an id in the file
  var ids8 = {};
  var m8;
  var idRe8 = / id="([^"]+)"/g;
  while ((m8 = idRe8.exec(html)) !== null) ids8[m8[1]] = true;
  var hrefRe8 = /href="(#[^"]*)"/g;
  var checked8 = 0;
  while ((m8 = hrefRe8.exec(html)) !== null) {
    checked8++;
    ok(ids8[m8[1].slice(1)], 'anchor resolves ' + m8[1]);
  }
  ok(checked8 > 20, 'checked ' + checked8 + ' in-page links');
  pass('phase11 generated anchors resolve');

  // 9 no dead repo-relative hrefs; mirror strip + plain-text rules hold
  ['../docs/', '../tools/', '../public/'].forEach(function (p) {
    eq(html.indexOf(p), -1, 'no ' + p + ' in output');
  });
  ok(html.indexOf('href="index.html"') !== -1, 'mirror prefix stripped');
  ok(html.indexOf('href="lib/"') !== -1, 'dir target kept');
  ok(html.indexOf('<code>backend/src/main.cpp</code>') !== -1, 'outside text kept');
  eq(html.indexOf('href="../backend/src/main.cpp"'), -1, 'outside target unlinked');
  pass('phase11 link rules served root');

  // 10 every Markdown heading produced a heading with an id
  var mdHead10 = (md.match(/^#{1,6} /gm) || []).length;
  var htmlHead10 = (html.match(/<h[1-6] id="/g) || []).length;
  ok(mdHead10 > 50, 'manual headings ' + mdHead10);
  eq(htmlHead10, mdHead10);
  pass('phase11 heading parity');

  // 11 every href="#..." in the Markdown source resolves in the output
  var ids11 = {};
  var m11;
  var idRe11 = / id="([^"]+)"/g;
  while ((m11 = idRe11.exec(html)) !== null) ids11[m11[1]] = true;
  var srcRe11 = /\]\((#[^)]+)\)/g;
  var checked11 = 0;
  while ((m11 = srcRe11.exec(md)) !== null) {
    checked11++;
    ok(ids11[m11[1].slice(1)], 'source anchor resolves ' + m11[1]);
  }
  ok(checked11 > 20, 'checked ' + checked11 + ' source links');
  pass('phase11 source anchors resolve');

  // 12 content spot-checks: troubleshooting, 3d, loci, standard
  ['Troubleshooting', '3D unavailable', 'locus of', 'BIS SP 46'].forEach(function (s) {
    ok(html.indexOf(s) !== -1, 'contains ' + s);
  });
  pass('phase11 content spot checks');

  // 13 exact-once strings survived exactly once
  eq(count(html, 'Box: 8 vertices, 12 edges'), 1, 'box recipe once');
  eq(count(html, 'Square pyramid: 5 vertices, 8 edges'), 1, 'pyramid once');
  eq(count(html, 'no classes left to fail'), 1, 'live-wireframe note once');
  pass('phase11 exact once strings');

  // 14 escaping: placeholders encoded in code, no raw markers left
  ok(html.indexOf('&lt;n&gt;') !== -1, 'encoded <n>');
  ok(html.indexOf('&lt;r&gt;') !== -1, 'encoded <r>');
  eq(html.indexOf('<n>'), -1, 'no raw <n>');
  eq(html.indexOf('<r>'), -1, 'no raw <r>');
  eq(html.indexOf('**'), -1, 'no raw ** markers');
  eq(html.indexOf('`'), -1, 'no raw backticks');
  pass('phase11 escaping no leaks');

  // 15 tables: one <table> per source table, headers present.
  // Each source table opens with a header row plus a |---| separator row,
  // so separator rows count the tables.
  var seps15 = 0;
  md.split('\n').forEach(function (line) {
    var t = line.replace(/ /g, '');
    if (t.length >= 3 && t.charAt(0) === '|' &&
        t.charAt(t.length - 1) === '|' && /^\|[:|\-]+$/.test(t) &&
        t.indexOf('-') !== -1) {
      seps15++;
    }
  });
  ok(seps15 > 10, 'source tables ' + seps15);
  eq(count(html, '<table>'), seps15);
  ok(html.indexOf('<th>') !== -1, 'headers rendered');
  pass('phase11 tables parity');

  // 16 fenced blocks verbatim: ascii diagram + js snippet + edc runner
  eq(count(html, '<pre><code>'), 3, 'three fenced blocks');
  var firstPre16 = html.slice(html.indexOf('<pre><code>'), html.indexOf('</code></pre>'));
  ok(firstPre16.indexOf('3D Solid') !== -1, 'diagram kept widget');
  ok(firstPre16.indexOf('Manual') !== -1, 'diagram kept manual row');
  ok(html.indexOf('lesson.steps.forEach') !== -1, 'js snippet kept');
  ok(html.indexOf('EduCADCurriculum.planeSurface') !== -1, 'snippet api kept');
  ok(html.indexOf('node tools/edc.js') !== -1, 'edc snippet kept');
  pass('phase11 fenced blocks verbatim');

  // 17 page shape: doctype, meta, title, css band, back link, footer
  ok(html.indexOf('<!doctype html>') === 0, 'doctype first');
  ok(html.indexOf('<meta charset="utf-8">') !== -1, 'charset meta');
  ok(html.indexOf('<meta name="viewport" content="width=device-width, initial-scale=1">') !== -1,
    'viewport meta');
  ok(html.indexOf('<title>EduCAD User Manual</title>') !== -1, 'title');
  var css17 = html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'));
  var cssBytes17 = Buffer.byteLength(css17, 'utf8');
  ok(cssBytes17 >= 2000 && cssBytes17 <= 5120, 'css bytes ' + cssBytes17);
  ok(html.indexOf('<a href="index.html">\u2190 Back to EduCAD</a>') !== -1, 'back link');
  ok(html.indexOf('Generated from docs/MANUAL.md by tools/build-manual.js') !== -1,
    'footer provenance');
  ok(html.indexOf('npm run build:manual') !== -1, 'footer rebuild hint');
  ok(html.indexOf('only public/ is served') !== -1, 'footer link rule');
  pass('phase11 page shape');

  // 18 index.html carries the Manual link as the last demo-bar child
  var index = fs.readFileSync(INDEX_PATH, 'utf8');
  var bar18 = /<div class="demo-bar">([\s\S]*?)<\/div>/.exec(index);
  ok(bar18, 'demo bar found');
  var inner18 = bar18[1];
  ok(inner18.indexOf('id="btn-manual"') !== -1, 'manual id');
  ok(inner18.indexOf('href="manual.html"') !== -1, 'manual href');
  ok(inner18.indexOf('target="_blank"') !== -1, 'manual target');
  ok(inner18.indexOf('rel="noopener"') !== -1, 'manual rel');
  ok(inner18.indexOf('>Manual</a>') !== -1, 'manual label');
  ok(inner18.indexOf('id="btn-manual"') > inner18.indexOf('id="btn-clear"'),
    'manual after clear');
  ok(/<a class="demo-btn"[^>]*>Manual<\/a>\s*$/.test(inner18), 'manual last child');
  pass('phase11 index manual link');

  // 19 demo-btn css fits anchors; existing button styling intact
  ok(index.indexOf('text-decoration: none') !== -1, 'anchor underline off');
  ok(index.indexOf('display: inline-flex') !== -1, 'anchor flex box');
  ok(index.indexOf('align-items: center') !== -1, 'anchor centered');
  ok(index.indexOf('.demo-btn.active') !== -1, 'active rule kept');
  ok(index.indexOf('background: #0284c7') !== -1, 'active color kept');
  pass('phase11 demo-btn css');

  // 20 no js changes: demo active logic kept, manual unwired
  ok(index.indexOf("querySelectorAll('.demo-btn')") !== -1, 'active sweep kept');
  ['btn-demo-line', 'btn-demo-points', 'btn-demo-prism', 'btn-clear'].forEach(function (id) {
    ok(index.indexOf("getElementById('" + id + "')") !== -1, 'handler kept ' + id);
  });
  eq(index.indexOf("getElementById('btn-manual')"), -1, 'no manual handler');
  eq(count(index, 'btn-manual'), 1, 'manual id mentioned once');
  pass('phase11 index js untouched');

  // 21 blockquote + horizontal rules survived
  eq(count(html, '<blockquote>'), 1, 'one blockquote');
  ok(html.indexOf('Limitations</a>') !== -1, 'quote link kept');
  var srcHr21 = md.split('\n').filter(function (l) { return l === '---'; }).length;
  eq(count(html, '<hr>'), srcHr21, 'hr parity ' + srcHr21);
  pass('phase11 quote rules');

  // 22 served check on an ephemeral port: manual.html 200 + text/html
  ok(fs.existsSync(SERVER), 'educad-server built');
  var tmp22 = fs.mkdtempSync(path.join(os.tmpdir(), 'educad-manual-'));
  var db22 = path.join(tmp22, 'educad.db');
  var seed22 = child.spawnSync(SEED, [USERS, db22], { encoding: 'utf8' });
  eq(seed22.status, 0, 'seed exit 0: ' + (seed22.stderr || ''));
  var port22 = await freePort();
  var srv = child.spawn(SERVER, [String(port22)], {
    env: Object.assign({}, process.env, { EDUCAD_DB: db22, EDUCAD_ROOT: MIRROR }),
    stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    await waitReady(port22, srv, 10000);
    var r22 = await get(port22, '/manual.html');
    eq(r22.status, 200);
    ok(String(r22.headers['content-type']).indexOf('text/html') !== -1, 'html type');
    ok(r22.body.indexOf('EduCAD User Manual') !== -1, 'served title');
  } finally {
    srv.kill('SIGTERM');
    await new Promise(function (resolve) { srv.on('exit', resolve); });
    fs.rmSync(tmp22, { recursive: true, force: true });
  }
  pass('phase11 served manual');

  assert.strictEqual(n, TOTAL);
  console.log('OK ' + TOTAL + '/' + TOTAL + ' phase11 tests passed');
}

main().then(null, function (err) {
  console.error((err && err.stack) || err);
  process.exit(1);
});

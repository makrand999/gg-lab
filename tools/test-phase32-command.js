'use strict';
// EduCAD phase 32: slash command line + Settings. Users and agents draw
// without the mouse via Minecraft-style /<cmd> with autocomplete
// (educad-command.js); Settings holds Preferences that tune the bar and
// the sheet (educad-settings.js). Run: `npm run test:phase32`
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var C = require('../mirror/files/www.geogebra.org/educad-command.js');
var S = require('../mirror/files/www.geogebra.org/educad-settings.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');

var ROOT = path.join(__dirname, '..');
var INDEX_PATH = path.join(ROOT, 'mirror', 'index.html');
var MD_PATH = path.join(ROOT, 'docs', 'MANUAL.md');
var HTML_PATH = path.join(ROOT, 'mirror', 'manual.html');
var README_PATH = path.join(ROOT, 'README.md');
var PKG_PATH = path.join(ROOT, 'package.json');

var TOTAL = 16;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function throws(fn, msg) { assert.throws(fn, Error, msg); }

function freshEnv(extra) {
  E.resetIdCounter();
  var env = { table: E.createTable() };
  if (extra) {
    Object.keys(extra).forEach(function (k) { env[k] = extra[k]; });
  }
  return env;
}

// 1 settings ship six on-by-default preferences with labels
eq(S.KEYS.length, 6, 'six keys');
deep(S.KEYS, ['commandPreview', 'commandSuggestions', 'showDemos',
  'showTutorials', 'commandHistory', 'coordsHud']);
Object.keys(S.DEFAULTS).forEach(function (k) {
  eq(S.DEFAULTS[k], true, k + ' defaults on');
});
eq(S.labelFor('commandPreview'), 'Preview commands while typing');
eq(S.labelFor('commandSuggestions'), 'Suggest commands while typing');
eq(S.labelFor('showDemos'), 'Show demos');
eq(S.labelFor('showTutorials'), 'Show tutorials');
ok(S.isValidKey('coordsHud') && !S.isValidKey('nope'), 'key check');
pass('phase32 settings defaults labels');

// 2 store get/set/toggle/reset; unknown keys and non-booleans throw
var st = S.createStore();
eq(S.get(st, 'showDemos'), true);
eq(S.set(st, 'showDemos', false), false);
eq(S.get(st, 'showDemos'), false);
eq(S.toggle(st, 'showDemos'), true);
S.set(st, 'coordsHud', false);
S.reset(st);
eq(S.get(st, 'coordsHud'), true, 'reset restores');
var seeded = S.createStore({ showTutorials: false });
eq(S.get(seeded, 'showTutorials'), false);
throws(function () { S.get(st, 'nope'); }, 'get unknown');
throws(function () { S.set(st, 'nope', true); }, 'set unknown');
throws(function () { S.set(st, 'showDemos', 1); }, 'set non-boolean');
throws(function () { S.toggle(st, 'nope'); }, 'toggle unknown');
throws(function () { S.createStore({ nope: true }); }, 'seed unknown');
throws(function () { S.createStore({ showDemos: 'yes' }); }, 'seed non-boolean');
throws(function () { S.get(null, 'showDemos'); }, 'null store');
pass('phase32 settings store ops');

// 3 persistence round-trips; corrupt or blocked storage falls back
var ser = S.serialize(S.createStore({ showDemos: false }));
eq(JSON.parse(ser).showDemos, false, 'serializes');
deep(S.parse(ser).values, S.createStore({ showDemos: false }).values,
  'round-trip');
deep(S.parse('not json').values, S.createStore().values, 'bad json');
deep(S.parse('').values, S.createStore().values, 'empty');
deep(S.parse('{"showDemos":false,"nope":true}').values,
  S.createStore({ showDemos: false }).values, 'unknown dropped');
deep(S.parse('{"showDemos":"yes"}').values, S.createStore().values,
  'non-boolean defaulted');
var mem = {};
var fakeStorage = {
  getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
  setItem: function (k, v) { mem[k] = String(v); }
};
var saved = S.createStore({ coordsHud: false });
eq(S.save(fakeStorage, saved), true, 'save ok');
eq(S.get(S.load(fakeStorage), 'coordsHud'), false, 'load back');
eq(S.load(null).values.commandPreview, true, 'null storage');
eq(S.load({}).values.commandPreview, true, 'shape-less storage');
eq(S.save(null, saved), false, 'save null fails soft');
var blocked = {
  getItem: function () { throw new Error('denied'); },
  setItem: function () { throw new Error('denied'); }
};
eq(S.load(blocked).values.showDemos, true, 'blocked load');
eq(S.save(blocked, saved), false, 'blocked save');
pass('phase32 settings persistence');

// 4 twenty-three documented slash commands, each with usage + hint
eq(C.COMMANDS.length, 23, 'twenty-three commands');
deep(C.COMMAND_NAMES, ['help', 'point', 'line', 'ray', 'xline', 'circle',
  'arc', 'text', 'dimension', 'polygon', 'polyline', 'ellipse', 'hatch',
  'rename', 'delete', 'style', 'datum', 'clear', 'undo', 'demo', 'tutorial',
  'check', 'mode']);
deep(C.ROLES, ['plan', 'elevation', 'both', 'profile']);
C.COMMANDS.forEach(function (spec) {
  ok(spec.usage.indexOf('/' + spec.name) === 0, spec.name + ' usage');
  ok(spec.hint.length > 5, spec.name + ' hint');
});
deep(C.DEMOS, ['line', 'points', 'prism', '3view', 'square']);
deep(C.TUTS, ['square', 'prism']);
deep(C.MODES, ['edit', 'view']);
deep(C.BIS_CODES, ['A', 'B', 'E', 'G', 'H', 'K']);
pass('phase32 command registry');

// 5 quoting: double quotes group words, single primes stay literal
deep(C.splitArgs('a 10 20'), ['a', '10', '20']);
deep(C.splitArgs('10 20 "hello world"'), ['10', '20', 'hello world']);
deep(C.splitArgs('"a b" c'), ['a b', 'c']);
deep(C.splitArgs("b' 1 2"), ["b'", '1', '2'], 'prime literal');
deep(C.splitArgs('  a   b  '), ['a', 'b'], 'runs collapse');
deep(C.splitArgs(''), [], 'empty');
pass('phase32 arg splitting');

// 6 parse results: ok lines plus the four failure shapes
var p1 = C.parse('/point a 10 20');
eq(p1.ok, true);
eq(p1.name, 'point');
deep(p1.args, ['a', '10', '20']);
eq(C.parse('  /LINE a b  ').name, 'line', 'case + trim');
eq(C.parse('').error, 'empty');
eq(C.parse('point a 1 2').error, 'missing-slash');
eq(C.parse('/').error, 'no-command');
eq(C.parse('/nope x').error, 'unknown-command');
eq(C.parse('/nope x').name, 'nope');
ok(C.parse('point a 1 2').message.indexOf('/help') !== -1, 'points at help');
throws(function () { C.parse(42); }, 'non-string throws');
pass('phase32 parse shapes');

// 7 Minecraft completions: / opens, prefixes filter, args complete
deep(C.suggest('', {}),
  [{ text: '/', display: '/', hint: 'Start a command', kind: 'command' }]);
deep(C.suggest('hello', {}), [], 'no slash, no help');
var all = C.suggest('/', {});
eq(all.length, 23, 'bare slash lists all');
eq(all[0].text, '/help ', 'command text carries a space');
var po = C.suggest('/po', {}).map(function (s) { return s.text; });
deep(po, ['/point ', '/polygon ', '/polyline '], 'prefix filters');
deep(C.suggest('/nope ', {}), [], 'unknown completes nothing');
var ctx = { points: ['a', 'b'] };
var toSlot = C.suggest('/line a ', ctx).map(function (s) { return s.text; });
deep(toSlot, ['/line a b '], 'from-point never its own target');
var demos = C.suggest('/demo p', {}).map(function (s) { return s.display; });
deep(demos, ['points', 'prism'], 'demo names');
var bis = C.suggest('/line a b ', ctx);
eq(bis.length, 10, 'six BIS codes plus four views');
eq(bis[0].text, '/line a b A ', 'tail seat keeps its space');
bis.slice(0, 6).forEach(function (entry) {
  eq(entry.kind, 'bis-code', entry.display + ' tagged for line art');
});
bis.slice(6).forEach(function (entry) {
  eq(entry.kind, 'role-name', entry.display + ' tagged as view');
});
var onlyRoles = C.suggest('/line a b E ', ctx).map(function (s) { return s.display; });
deep(onlyRoles, ['plan', 'elevation', 'both', 'profile'], 'role seat after bis');
deep(C.suggest('/line a b plan ', ctx), [], 'role completes the tail');
var rayTo = C.suggest('/ray a ', ctx).map(function (s) { return s.text; });
deep(rayTo, ['/ray a b '], 'ray skips its from-point');
var arcBis = C.suggest('/arc a 5 0 90 ', ctx).map(function (s) { return s.display; });
ok(arcBis.indexOf('E') !== -1 && arcBis.indexOf('profile') !== -1,
  'arc offers style and view');
eq(C.suggest('/po', {})[0].kind, 'command', 'commands tagged');
eq(C.suggest('/line ', ctx)[0].kind, 'point-name', 'points tagged');
deep(C.suggest('/point ', ctx), [], 'new names stay freeform');
deep(C.suggest('/circle a 5 x', ctx), [], 'numbers stay freeform');
// Display names: captions (the letters on the sheet) complete, never
// engine E-ids; uncaptioned dots fall back to their name.
eq(C.displayName({ name: 'E1', caption: 'a' }), 'a', 'caption wins');
eq(C.displayName({ name: 'E2', caption: '' }), 'E2', 'name fallback');
var demoLike = [
  { id: 'E1', name: 'E1', type: 'POINT', x: 1, y: 2, caption: 'a' },
  { id: 'E2', name: 'E2', type: 'POINT', x: 3, y: 4, caption: "b'" },
  { id: 'E3', name: 'E3', type: 'POINT', x: 5, y: 6, caption: '' },
  { id: 'E4', name: 'E4', type: 'POINT', x: 7, y: 8, caption: 'a' },
  { id: 'E5', name: 'E5', type: 'SEGMENT', x: 0, y: 0, caption: 's' }
];
var pmap2 = C.pointMap(demoLike);
deep(Object.keys(pmap2), ['a', "b'", 'E3'], 'letters first, id fallback');
deep(pmap2.a, { x: 1, y: 2 }, 'first label wins');
var letterSug = C.suggest('/line ', { points: pmap2 })
  .map(function (s) { return s.display; });
ok(letterSug.indexOf('E1') === -1 && letterSug.indexOf('a') !== -1,
  'no E-ids offered');
var quoted = C.suggest('/line ', { points: { 'a b': { x: 0, y: 0 } } });
eq(quoted[0].text, '/line "a b" ', 'spaced labels quoted');
throws(function () { C.displayName(null); }, 'displayName guards');
throws(function () { C.pointMap({}); }, 'pointMap guards');
pass('phase32 suggest completions');

// 8 preview narrates the pending line or names the first problem
eq(C.preview('', {}), '', 'blank stays blank');
ok(C.preview('hi', {}).indexOf('start with /') !== -1, 'slash nudge');
ok(C.preview('/', {}).indexOf('23') !== -1, 'counts commands');
ok(C.preview('/nope', {}).indexOf('Unknown command') !== -1, 'unknown');
eq(C.preview('/point a', {}), 'Usage: /point <name> <x> <y> [role]', 'short usage');
ok(C.preview('/point a 1 2 x y', {}).indexOf('Too many') !== -1, 'long usage');
eq(C.preview('/point a 10 20', {}), 'Place point "a" at (10, 20) mm.');
eq(C.preview('/point a x 20', {}),
  'x and y must be numbers (mm) — usage: /point <name> <x> <y> [role]');
eq(C.preview('/point a 10 20 profile', {}),
  'Place point "a" at (10, 20) mm in PROFILE view.');
eq(C.preview('/point a 10 20 sideways', {}),
  'Role must be one of plan elevation both profile.');
var pmap = { points: { a: { x: 0, y: 0 }, b: { x: 30, y: 40 } } };
eq(C.preview('/line a b', pmap), 'Draw segment a → b (L 50.00 mm).');
eq(C.preview('/line a z', pmap),
  'Unknown point "z" — place it first with /point.');
eq(C.preview('/line a b E plan', pmap),
  'Draw segment a → b (L 50.00 mm), type E, PLAN view.');
eq(C.preview('/ray a b', pmap), 'Draw ray a → b (L 50.00 mm).');
eq(C.preview('/xline a b G', pmap), 'Draw construction line a → b (L 50.00 mm), type G.');
eq(C.preview('/circle 0 0 5', {}), 'Draw circle at (0, 0) r 5 mm.');
eq(C.preview('/circle a 5 B profile', pmap),
  'Draw circle at "a" r 5 mm, type B, PROFILE view.');
eq(C.preview('/arc a 5 0 90', pmap),
  'Draw arc at "a" r 5 mm, 0° to 90°.');
eq(C.preview('/arc 1 2 3 0 180', {}),
  'Draw arc at (1, 2) r 3 mm, 0° to 180°.');
eq(C.preview('/arc a 5', pmap),
  'Usage: /arc <center> <r> <a1> <a2> [bis] [role]  |  /arc <x> <y> <r> <a1> <a2> [bis] [role]');
eq(C.preview('/demo prism', {}), 'Load the "prism" demo sheet.');
ok(C.preview('/demo nope', {}).indexOf('one of:') !== -1, 'demo list');
eq(C.preview('/mode view', {}), 'Switch to view mode.');
pass('phase32 preview narration');

// 9 execute draws: point, line, circle, text, dimension, polygon, datum
var env = freshEnv();
var r1 = C.execute('/point a 10 20', env);
eq(r1.ok, true);
eq(env.table.count(), 1);
var pa = env.table.get(r1.ids[0]);
eq(pa.type, 'POINT');
eq(pa.viewRole, 'ELEVATION', 'y>=0 reads elevation');
var r2 = C.execute('/point b -5 -8', env);
eq(env.table.get(r2.ids[0]).viewRole, 'PLAN', 'below XY reads plan');
var rl = C.execute('/line a b E', env);
eq(rl.ok, true);
eq(env.table.get(rl.ids[0]).bisCode, 'E');
var ry = C.execute('/ray a b', env);
eq(env.table.get(ry.ids[0]).type, 'RAY', 'ray draws');
var rx = C.execute('/xline a b G both', env);
var xe = env.table.get(rx.ids[0]);
eq(xe.type, 'LINE', 'xline draws');
eq(xe.bisCode, 'G', 'xline style');
eq(xe.viewRole, 'BOTH', 'xline view');
var rc = C.execute('/circle a 5', env);
eq(env.table.get(rc.ids[0]).radius, 5);
var rc2 = C.execute('/circle 1 2 3', env);
eq(rc2.ok, true, 'raw-coord circle');
var rc3 = C.execute('/circle a 4 B profile', env);
var c3 = env.table.get(rc3.ids[0]);
eq(c3.bisCode, 'B', 'circle style');
eq(c3.viewRole, 'PROFILE', 'circle view');
var ra = C.execute('/arc a 5 0 90', env);
var ae = env.table.get(ra.ids[0]);
eq(ae.type, 'CIRCULAR_ARC', 'arc draws');
eq(ae.startAngle, 0, 'arc start');
eq(ae.endAngle, 90, 'arc end');
var ra2 = C.execute('/arc 1 2 3 0 180 E plan', env);
eq(ra2.ok, true, 'raw-coord arc with style and view');
var rt = C.execute('/text 0 0 hello world', env);
eq(env.table.get(rt.ids[0]).caption, 'hello world');
var rd = C.execute('/dimension a b', env);
eq(env.table.get(rd.ids[0]).type, 'DIMENSION');
C.execute('/point c 0 30', env);
var rp = C.execute('/point d 1 1 profile', env);
eq(env.table.get(rp.ids[0]).viewRole, 'PROFILE', 'point view override');
var rg = C.execute('/polygon a b c', env);
eq(rg.ok, true);
eq(rg.ids.length, 3, 'triangle closes');
var rm = C.execute('/datum', env);
eq(env.table.get(rm.ids[0]).type, 'DATUM_AXIS');
// every entity type is now drawable: point segment ray line circle arc
// dimension text datum.
var have = {};
env.table.list().forEach(function (e) { have[e.type] = true; });
['POINT', 'SEGMENT', 'RAY', 'LINE', 'CIRCLE', 'CIRCULAR_ARC', 'DIMENSION',
  'TEXT', 'DATUM_AXIS'].forEach(function (t) {
  ok(have[t], t + ' drawable');
});
eq(env.table.count(), 18, 'sixteen draws bank eighteen');
pass('phase32 execute draws');

// 10 execute refuses bad lines without throwing or drawing
var bad = freshEnv();
C.execute('/point a 0 0', bad);
C.execute('/point b 10 0', bad);
var before = bad.table.count();
['/point a 1 1', '/point', '/point a x y', '/point z 1 2 sideways',
  '/point z 1 2 plan extra', '/line a', '/line a z',
  '/line a a', '/line a b Q', '/line a b E plan extra', '/line a b plan E',
  '/ray a', '/xline a b Q', '/circle', '/circle a 0', '/circle a b c',
  '/circle a 5 Q', '/arc', '/arc a', '/arc a 5 0', '/arc a 5 0 x',
  '/arc a 5 0 90 Q', '/text 1 2', '/dimension a', '/dimension a b Q',
  '/polygon a b', '/rename a', '/delete',
  '/datum 1', '/datum 5 5', '/clear x', '/demo', '/demo nope',
  '/tutorial nope', '/mode sideways', '/nope', 'point x 1 2', ''].forEach(
  function (line) {
    var r = C.execute(line, bad);
    eq(r.ok, false, line + ' refused');
    ok(r.message.length > 3, line + ' explains');
  });
eq(bad.table.count(), before, 'nothing drawn');
throws(function () { C.execute('/point a 1 1', null); }, 'missing table');
throws(function () { C.execute('/point a 1 1', {}); }, 'empty env');
pass('phase32 execute refusals');

// 11 rename and delete work; deletes cascade, locked entities hold
var ce = freshEnv();
C.execute('/point a 0 10', ce);
C.execute('/point b 0 -10', ce);
C.execute('/line a b', ce);
var rn = C.execute('/rename a a2', ce);
eq(rn.ok, true);
eq(ce.table.get(rn.ids[0]).caption, 'a2');
eq(C.execute('/rename a2 b', ce).ok, false, 'rename onto taken');
var del = C.execute('/delete a2', ce);
eq(del.ok, true);
eq(del.ids.length, 2, 'point plus its line');
eq(ce.table.count(), 1, 'only b survives');
C.execute('/datum', ce);
var datumName = ce.table.list().filter(function (e) {
  return e.type === 'DATUM_AXIS';
})[0].name;
eq(C.execute('/delete ' + datumName, ce).ok, false, 'locked holds');
pass('phase32 rename delete cascade');

// 12 hooks, gates, and read-only: page actions fire, prefs gate, View holds
var calls = [];
var hooked = freshEnv({
  clear: function () { calls.push('clear'); },
  loadDemo: function (n) { calls.push('demo:' + n); },
  startTutorial: function (n) { calls.push('tut:' + n); },
  runVerify: function () { calls.push('check'); },
  setMode: function (m) { calls.push('mode:' + m); }
});
C.execute('/point a 0 0', hooked);
C.execute('/clear', hooked);
deep(calls, ['clear'], 'clear hook');
C.execute('/demo prism', hooked);
C.execute('/tutorial square', hooked);
C.execute('/check', hooked);
C.execute('/mode view', hooked);
deep(calls, ['clear', 'demo:prism', 'tut:square', 'check', 'mode:view'],
  'hooks fire');
var gated = freshEnv({ loadDemo: function () { calls.push('demo!'); },
  startTutorial: function () { calls.push('tut!'); },
  allowDemo: false, allowTutorial: false });
eq(C.execute('/demo prism', gated).ok, false, 'hidden demos hold');
eq(C.execute('/tutorial square', gated).ok, false, 'hidden tuts hold');
ok(calls.indexOf('demo!') === -1 && calls.indexOf('tut!') === -1,
  'gated hooks never fire');
var bare = freshEnv();
eq(C.execute('/demo prism', bare).ok, false, 'demo hook missing');
eq(C.execute('/tutorial square', bare).ok, false, 'tut hook missing');
eq(C.execute('/check', bare).ok, false, 'check hook missing');
eq(C.execute('/mode view', bare).ok, false, 'mode hook missing');
var ro = freshEnv();
eq(C.execute('/point a 0 0', ro).ok, true, 'sanity draws');
var view = freshEnv({ readOnly: true, setMode: function () {} });
eq(C.execute('/point b 1 1', view).ok, false, 'view blocks draws');
eq(C.execute('/clear', view).ok, false, 'view blocks clear');
eq(C.execute('/help', view).ok, true, 'view allows help');
eq(C.execute('/mode edit', view).ok, true, 'view allows mode out');
pass('phase32 hooks gates readonly');

// 13 help lists all twenty-three and details one
var all13 = C.execute('/help', freshEnv());
eq(all13.ok, true);
C.COMMAND_NAMES.forEach(function (nm) {
  ok(all13.message.indexOf('/' + nm) !== -1, 'lists /' + nm);
});
var one = C.execute('/help line', freshEnv());
eq(one.ok, true);
ok(one.message.indexOf('/line <from> <to> [bis] [role]') !== -1, 'usage first');
eq(C.execute('/help nope', freshEnv()).ok, false, 'unknown help');
eq(C.helpText(''), all13.message, 'helpText matches');
pass('phase32 help text');

// 14 the page ships the bar, the panel, and the wiring
var index = fs.readFileSync(INDEX_PATH, 'utf8');
ok(index.indexOf('<script src="files/www.geogebra.org/educad-settings.js"></script>') !== -1,
  'settings loaded');
ok(index.indexOf('<script src="files/www.geogebra.org/educad-command.js"></script>') !== -1,
  'command loaded');
['id="cmd-bar"', 'id="cmd-input"', 'id="cmd-suggest"', 'id="cmd-preview"',
  'id="cmd-status"', 'id="settings-panel"', 'id="settings-rows"',
  'id="settings-close"', 'id="settings-reset"', 'id="cmd-styles"',
  'window.educadRunCommand', '(function commandLine() {',
  'refreshCmdAssist', 'applySettings', 'cmdEnv', 'openCmdBar',
  'closeCmdBar'].forEach(function (s) {
  ok(index.indexOf(s) !== -1, 'ships ' + s);
});
ok(index.indexOf('<div id="cmd-bar" hidden>') !== -1, 'bar hidden until /');
var bar = /<div class="demo-bar">([\s\S]*?)<\/div>/.exec(index);
ok(bar !== null, 'demo bar found');
ok(bar[1].indexOf('id="btn-settings"') !== -1, 'settings button');
ok(bar[1].indexOf('id="btn-settings"') < bar[1].indexOf('id="btn-manual"'),
  'settings ahead of manual');
ok(/<a class="demo-btn"[^>]*>Manual<\/a>\s*$/.test(bar[1]), 'manual still last');
var cmdBlock = index.slice(index.indexOf('(function commandLine() {'));
ok(cmdBlock.indexOf("e.key !== '/'") !== -1, 'slash opener');
ok(cmdBlock.indexOf('handle.sel.editing !== null') !== -1, 'opener yields');
ok(cmdBlock.indexOf("stopPropagation();") !== -1, 'bar shielded');
ok(cmdBlock.indexOf('EduCADCommand.pointMap(handle.table.list())') !== -1,
  'labels from captions');
ok(cmdBlock.indexOf("entry.kind === 'bis-code'") !== -1, 'bis rows branch');
ok(cmdBlock.indexOf('bisSampleCanvas(entry.display)') !== -1, 'bis line art');
ok(cmdBlock.indexOf('bisStyleName(entry.display)') !== -1, 'bis style name');
ok(cmdBlock.indexOf('Continuous Thick') !== -1, 'style names table');
ok(index.indexOf('cmd-sug-line') !== -1, 'sample canvas style');
ok(cmdBlock.indexOf('cleanupAfterPointDelete(res.ids)') !== -1, 'delete sync');
ok(cmdBlock.indexOf('renderLayer1();') !== -1, 'redraws');
pass('phase32 page wiring');

// 15 the manual documents the bar, every command, and the preferences
var md = fs.readFileSync(MD_PATH, 'utf8');
var html = fs.readFileSync(HTML_PATH, 'utf8');
['### 3.11 Command line', 'Settings', '/help', '/point', '/line', '/ray',
  '/xline', '/circle', '/arc', '/polygon', '/demo', '/tutorial', '/mode',
  'profile', 'Preview commands while typing',
  'Suggest commands while typing', 'Show demos', 'Show tutorials',
  'Remember command history', 'Minecraft-style'].forEach(function (s) {
  ok(md.indexOf(s) !== -1, 'manual has ' + s);
});
ok(md.indexOf('| `Settings` |') !== -1, 'demo-bar row');
ok(md.indexOf('It appears only when') !== -1, 'hidden-until-slash documented');
ok(html.indexOf('Command line') !== -1, 'html rebuilt');
pass('phase32 manual documents commands');

// 16 README lists phase32 with the new grand total; package chains it
var readme = fs.readFileSync(README_PATH, 'utf8');
ok(readme.indexOf('`npm run test:phase32`') !== -1, 'phase32 row');
ok(readme.indexOf('Slash commands: Minecraft-style `/cmd` draw, autocomplete, Settings prefs') !== -1,
  'phase32 label');
ok(readme.indexOf('baseline + phases 1–45 (1039 checks)') !== -1,
  'grand total 960');
var pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
eq(pkg.scripts['test:phase32'], 'node tools/test-phase32-command.js',
  'test:phase32 script');
ok(pkg.scripts.test.indexOf('node tools/test-phase32-command.js') !== -1,
  'chained in test');
pass('phase32 package wiring');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase32 tests passed');

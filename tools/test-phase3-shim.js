'use strict';
var assert = require('assert');
var fs = require('fs');
var G = require('../mirror/files/www.geogebra.org/educad-shim.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');
var V = require('../mirror/files/www.geogebra.org/educad-viewport.js');

var TOTAL = 56;
var n = 0;
function pass(name) { n++; console.log('PASS ' + n + '/' + TOTAL + ' ' + name); }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function deep(a, b, msg) { assert.deepStrictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' |' + a + '-' + b + '|>' + tol); }

function fresh() { return G.createApplet({ entities: E, viewport: V }); }

function mute(fn) {
  var orig = console.warn;
  console.warn = function () {};
  try { return fn(); } finally { console.warn = orig; }
}

function captureWarn(fn) {
  var msgs = [];
  var orig = console.warn;
  console.warn = function (m) { msgs.push(String(m)); };
  var result;
  try { result = fn(); } finally { console.warn = orig; }
  return { result: result, msgs: msgs };
}

function warnedWithOffset(cw) {
  ok(cw.msgs.length >= 1, 'expected console.warn');
  ok(/offset \d+/.test(cw.msgs.join(' ')), 'warn lacks char offset: ' + cw.msgs.join(' | '));
}

// 1 default export loads, ping/pong, mm units
eq(G.ping(), 'pong');
eq(G.WORLD_UNITS, 'mm');
eq(typeof G.createApplet, 'function');
pass('shim loads ping pong mm');
// 2 version string 3.x
eq(typeof G.getVersion(), 'string');
ok(/^3\./.test(G.getVersion()), 'version ' + G.getVersion());
pass('shim version 3.x');
// 3 all 39 API methods are functions on a fresh applet
var a3 = fresh();
G.API_METHODS.forEach(function (m) { eq(typeof a3[m], 'function', 'method ' + m); });
pass('shim 39 API methods are functions');
// 4 API_METHODS 39 + COMMANDS 14 documented lists
eq(G.API_METHODS.length, 39);
eq(G.COMMANDS.length, 14);
deep(G.COMMANDS, ['Point', 'Segment', 'Line', 'Circle', 'Arc', 'Perpendicular',
  'Parallel', 'Intersect', 'Midpoint', 'Distance', 'Angle', 'Polygon',
  'Text', 'Dimension']);
pass('shim API_METHODS 39 COMMANDS 14');
// 5 zero deps + dual-env markers; standalone fallback works
var src = fs.readFileSync('mirror/files/www.geogebra.org/educad-shim.js', 'utf8');
eq(src.indexOf('require('), -1);
ok(src.indexOf('ggbApplet') !== -1, 'window.ggbApplet marker');
ok(src.indexOf('module.exports') !== -1, 'module.exports marker');
var fb = mute(function () { return G.createApplet(); });
eq(fb.evalCommand('Point(4,5)'), 'E1');
eq(fb.getXcoord('E1'), 4);
pass('shim zero deps dual-env fallback');
// 6 Point with assignment, mm coords
var a6 = fresh();
eq(a6.evalCommand('P1=Point(10,20)'), 'P1');
eq(a6.getXcoord('P1'), 10);
eq(a6.getYcoord('P1'), 20);
pass('shim Point assign mm');
// 7 auto-name deterministic E1 E2
var a7 = fresh();
eq(a7.evalCommand('Point(1,2)'), 'E1');
eq(a7.evalCommand('Point(3,4)'), 'E2');
pass('shim auto names E1 E2');
// 8 Segment from refs
var a8 = fresh();
a8.evalCommand('A=Point(0,0)');
a8.evalCommand('B=Point(10,0)');
eq(a8.evalCommand('S1=Segment(A,B)'), 'S1');
eq(a8.getObjectType('S1'), 'segment');
eq(a8.getXcoord('S1'), 0);
pass('shim Segment refs');
// 9 Segment from coords
var a9 = fresh();
eq(a9.evalCommand('S1=Segment(1,2,3,4)'), 'S1');
var e9 = a9._table().get('S1');
eq(e9.x2, 3); eq(e9.y2, 4);
pass('shim Segment coords');
// 10 Line from refs
var a10 = fresh();
a10.evalCommand('A=Point(0,0)');
a10.evalCommand('B=Point(0,10)');
eq(a10.evalCommand('L1=Line(A,B)'), 'L1');
eq(a10.getObjectType('L1'), 'line');
pass('shim Line refs');
// 11 Circle both forms + radius value
var a11 = fresh();
a11.evalCommand('C=Point(5,5)');
eq(a11.evalCommand('K1=Circle(C,5)'), 'K1');
eq(a11.getValue('K1'), 5);
eq(a11.evalCommand('K2=Circle(0,0,2.5)'), 'K2');
eq(a11.getXcoord('K2'), 0);
eq(a11.getValue('K2'), 2.5);
pass('shim Circle forms');
// 12 Arc stores center radius angles
var a12 = fresh();
eq(a12.evalCommand('R1=Arc(0,0,10,0,90)'), 'R1');
eq(a12.getObjectType('R1'), 'arc');
var e12 = a12._table().get('R1');
eq(e12.radius, 10); eq(e12.startAngle, 0); eq(e12.endAngle, 90);
pass('shim Arc angles');
// 13 Perpendicular through point, dot ~0
var a13 = fresh();
a13.evalCommand('A=Point(0,0)');
a13.evalCommand('B=Point(10,0)');
a13.evalCommand('L=Line(A,B)');
a13.evalCommand('P=Point(5,5)');
eq(a13.evalCommand('N=Perpendicular(P,L)'), 'N');
var e13 = a13._table().get('N');
near((e13.x2 - e13.x) * 1 + (e13.y2 - e13.y) * 0, 0, 1e-9, 'perp dot');
eq(a13.getXcoord('N'), 5); eq(a13.getYcoord('N'), 5);
pass('shim Perpendicular dot0');
// 14 Parallel keeps direction, cross ~0
var a14 = fresh();
a14.evalCommand('A=Point(0,0)');
a14.evalCommand('B=Point(10,0)');
a14.evalCommand('L=Line(A,B)');
a14.evalCommand('P=Point(5,5)');
eq(a14.evalCommand('M=Parallel(P,L)'), 'M');
var e14 = a14._table().get('M');
near(1 * (e14.y2 - e14.y) - 0 * (e14.x2 - e14.x), 0, 1e-9, 'par cross');
eq(a14.getXcoord('M'), 5);
pass('shim Parallel cross0');
// 15 Intersect axes at origin; parallel pair fails
var a15 = fresh();
a15.evalCommand('A=Point(0,0)');
a15.evalCommand('B=Point(10,0)');
a15.evalCommand('C=Point(0,10)');
a15.evalCommand('L1=Line(A,B)');
a15.evalCommand('L2=Line(A,C)');
eq(a15.evalCommand('I=Intersect(L1,L2)'), 'I');
near(a15.getXcoord('I'), 0, 1e-9, 'ix');
near(a15.getYcoord('I'), 0, 1e-9, 'iy');
a15.evalCommand('Q1=Point(0,1)');
a15.evalCommand('Q2=Point(10,1)');
a15.evalCommand('L3=Line(Q1,Q2)');
var cw15 = captureWarn(function () { return a15.evalCommand('Intersect(L1,L3)'); });
eq(cw15.result, null);
warnedWithOffset(cw15);
pass('shim Intersect + parallel null');
// 16 Midpoint average
var a16 = fresh();
a16.evalCommand('A=Point(0,0)');
a16.evalCommand('B=Point(10,20)');
eq(a16.evalCommand('M=Midpoint(A,B)'), 'M');
eq(a16.getXcoord('M'), 5);
eq(a16.getYcoord('M'), 10);
pass('shim Midpoint avg');
// 17 Distance 3-4-5 value 5 numeric type
var a17 = fresh();
a17.evalCommand('A=Point(0,0)');
a17.evalCommand('B=Point(3,4)');
eq(a17.evalCommand('D1=Distance(A,B)'), 'D1');
eq(a17.getValue('D1'), 5);
eq(a17.getObjectType('D1'), 'numeric');
pass('shim Distance value');
// 18 Angle right angle 90 deg
var a18 = fresh();
a18.evalCommand('A=Point(1,0)');
a18.evalCommand('Vv=Point(0,0)');
a18.evalCommand('B=Point(0,1)');
eq(a18.evalCommand('G1=Angle(A,Vv,B)'), 'G1');
near(a18.getValue('G1'), 90, 1e-9, 'angle90');
eq(a18.getObjectType('G1'), 'angle');
pass('shim Angle 90deg');
// 19 Polygon head + 3 edges
var a19 = fresh();
a19.evalCommand('A=Point(0,0)');
a19.evalCommand('B=Point(10,0)');
a19.evalCommand('C=Point(0,10)');
eq(a19.evalCommand('H=Polygon(A,B,C)'), 'H');
eq(a19.getObjectType('H'), 'polygon');
ok(a19.exists('H_e1')); ok(a19.exists('H_e2')); ok(a19.exists('H_e3'));
eq(a19.getObjectType('H_e1'), 'segment');
pass('shim Polygon head+edges');
// 20 Text caption incl spaces
var a20 = fresh();
eq(a20.evalCommand('T1=Text(5,6,"hello")'), 'T1');
eq(a20._table().get('T1').caption, 'hello');
eq(a20.evalCommand('Text(1,2,"hi there")'), 'E1');
eq(a20._table().get('E1').caption, 'hi there');
pass('shim Text caption');
// 21 Dimension value + type, both forms
var a21 = fresh();
a21.evalCommand('A=Point(0,0)');
a21.evalCommand('B=Point(6,8)');
eq(a21.evalCommand('M1=Dimension(A,B)'), 'M1');
eq(a21.getObjectType('M1'), 'dimension');
eq(a21.getValue('M1'), 10);
eq(a21.evalCommand('Dimension(0,0,6,8)'), 'E1');
eq(a21.getValue('E1'), 10);
pass('shim Dimension value');
// 22 malformed garbage null + warn offset, never throws
var a22 = fresh();
var cw22a = captureWarn(function () { return a22.evalCommand(')))garbage((('); });
eq(cw22a.result, null);
warnedWithOffset(cw22a);
var cw22b = captureWarn(function () { return a22.evalCommand('Point(1,2'); });
eq(cw22b.result, null);
warnedWithOffset(cw22b);
eq(a22.getAllObjectNames().length, 0);
pass('shim malformed garbage null');
// 23 unknown command null + warn offset
var cw23 = captureWarn(function () { return fresh().evalCommand('Frobnicate(1,2)'); });
eq(cw23.result, null);
warnedWithOffset(cw23);
pass('shim unknown command null');
// 24 bad arity null + warn offset
var a24 = fresh();
var cw24a = captureWarn(function () { return a24.evalCommand('Point(1)'); });
eq(cw24a.result, null);
warnedWithOffset(cw24a);
var cw24b = captureWarn(function () { return a24.evalCommand('Point(1,2,3)'); });
eq(cw24b.result, null);
warnedWithOffset(cw24b);
pass('shim bad arity null');
// 25 unknown ref null + warn, table untouched
var a25 = fresh();
var cw25 = captureWarn(function () { return a25.evalCommand('Segment(ZZ1,ZZ2)'); });
eq(cw25.result, null);
warnedWithOffset(cw25);
eq(a25.getAllObjectNames().length, 0);
pass('shim unknown ref null');
// 26 non-string and empty input null + warn
var a26 = fresh();
var cw26a = captureWarn(function () { return a26.evalCommand(42); });
eq(cw26a.result, null);
warnedWithOffset(cw26a);
var cw26b = captureWarn(function () { return a26.evalCommand(''); });
eq(cw26b.result, null);
warnedWithOffset(cw26b);
pass('shim nonstring empty null');
// 27 duplicate name null + warn, original kept
var a27 = fresh();
a27.evalCommand('D1=Point(1,1)');
var cw27 = captureWarn(function () { return a27.evalCommand('D1=Point(2,2)'); });
eq(cw27.result, null);
warnedWithOffset(cw27);
eq(a27.getXcoord('D1'), 1);
pass('shim duplicate null kept');
// 28 getObjectType mapping across builders
var a28 = fresh();
a28.evalCommand('A=Point(0,0)');
a28.evalCommand('B=Point(4,0)');
a28.evalCommand('C=Point(0,3)');
a28.evalCommand('S=Segment(A,B)');
a28.evalCommand('L=Line(A,C)');
a28.evalCommand('K=Circle(A,2)');
a28.evalCommand('R=Arc(0,0,5,0,45)');
a28.evalCommand('Tx=Text(1,1,"t")');
a28.evalCommand('Dm=Dimension(A,B)');
a28.evalCommand('Py=Polygon(A,B,C)');
a28.evalCommand('An=Angle(B,A,C)');
a28.evalCommand('Ds=Distance(A,B)');
deep([a28.getObjectType('A'), a28.getObjectType('S'), a28.getObjectType('L'),
  a28.getObjectType('K'), a28.getObjectType('R'), a28.getObjectType('Tx'),
  a28.getObjectType('Dm'), a28.getObjectType('Py'), a28.getObjectType('An'),
  a28.getObjectType('Ds')],
  ['point', 'segment', 'line', 'circle', 'arc', 'text', 'dimension',
    'polygon', 'angle', 'numeric']);
pass('shim getObjectType map');
// 29 getObjectType unknown null + warn
var cw29 = captureWarn(function () { return fresh().getObjectType('NOPE'); });
eq(cw29.result, null);
ok(cw29.msgs.length >= 1, 'warn expected');
pass('shim getObjectType unknown');
// 30 setCoords round-trip; unknown coord null
var a30 = fresh();
a30.evalCommand('S=Point(1,2)');
eq(a30.setCoords('S', 7, 8), true);
eq(a30.getXcoord('S'), 7);
eq(a30.getYcoord('S'), 8);
var cw30 = captureWarn(function () { return a30.getXcoord('NOPE'); });
eq(cw30.result, null);
pass('shim setCoords roundtrip');
// 31 setCoords NaN/Infinity false, value kept
var a31 = fresh();
a31.evalCommand('S=Point(7,8)');
eq(mute(function () { return a31.setCoords('S', NaN, 0); }), false);
eq(mute(function () { return a31.setCoords('S', 0, Infinity); }), false);
eq(a31.getXcoord('S'), 7);
eq(a31.getYcoord('S'), 8);
pass('shim setCoords NaN false');
// 32 getValue/setValue round-trip; bare point null
var a32 = fresh();
a32.evalCommand('P=Point(0,0)');
eq(a32.setValue('P', 42), true);
eq(a32.getValue('P'), 42);
eq(mute(function () { return a32.setValue('P', NaN); }), false);
eq(a32.getValue('P'), 42);
a32.evalCommand('Q=Point(1,1)');
eq(mute(function () { return a32.getValue('Q'); }), null);
a32.evalCommand('K=Circle(0,0,9)');
eq(a32.getValue('K'), 9);
pass('shim getValue setValue');
// 33 visible toggle; unknown null/false
var a33 = fresh();
a33.evalCommand('P=Point(0,0)');
eq(a33.getVisible('P'), true);
eq(a33.setVisible('P', false), true);
eq(a33.getVisible('P'), false);
eq(a33.setVisible('P', true), true);
eq(mute(function () { return a33.getVisible('NOPE'); }), null);
eq(mute(function () { return a33.setVisible('NOPE', true); }), false);
pass('shim visible toggle');
// 34 color rgb + hex + default black; invalid false
var a34 = fresh();
a34.evalCommand('P=Point(0,0)');
eq(a34.getColor('P'), '#000000');
eq(a34.setColor('P', 255, 0, 0), true);
eq(a34.getColor('P'), '#ff0000');
eq(a34.setColor('P', '#0f0'), true);
eq(a34.getColor('P'), '#00ff00');
eq(a34.setColor('P', '#00FF00'), true);
eq(a34.getColor('P'), '#00ff00');
eq(mute(function () { return a34.setColor('P', 'red'); }), false);
eq(mute(function () { return a34.setColor('P', 300, 0, 0); }), false);
eq(mute(function () { return a34.setColor('P', 0, 0); }), false);
eq(mute(function () { return a34.getColor('NOPE'); }), null);
pass('shim color rgb hex');
// 35 line thickness ok + invalid false
var a35 = fresh();
a35.evalCommand('P=Point(0,0)');
eq(a35.setLineThickness('P', 0.7), true);
eq(a35._table().get('P').thickness, 0.7);
eq(mute(function () { return a35.setLineThickness('P', 0); }), false);
eq(mute(function () { return a35.setLineThickness('P', -1); }), false);
eq(mute(function () { return a35.setLineThickness('P', NaN); }), false);
eq(mute(function () { return a35.setLineThickness('NOPE', 1); }), false);
pass('shim thickness');
// 36 line style 0..5 maps BIS; invalid false
var a36 = fresh();
a36.evalCommand('P=Point(0,0)');
var bisExpect = ['A', 'B', 'E', 'G', 'H', 'K'];
for (var s36 = 0; s36 <= 5; s36++) {
  eq(a36.setLineStyle('P', s36), true, 'style ' + s36);
  eq(a36._table().get('P').bisCode, bisExpect[s36], 'bis ' + s36);
}
eq(mute(function () { return a36.setLineStyle('P', 6); }), false);
eq(mute(function () { return a36.setLineStyle('P', 1.5); }), false);
eq(mute(function () { return a36.setLineStyle('P', 'x'); }), false);
pass('shim linestyle BIS');
// 37 rename ok fixes refs; clashes rejected
var a37 = fresh();
a37.evalCommand('A=Point(1,2)');
a37.evalCommand('B=Point(3,4)');
a37.evalCommand('M=Midpoint(A,B)');
eq(a37.renameObject('A', 'A2'), true);
ok(a37.exists('A2'));
ok(!a37.exists('A'));
ok(a37._table().get('M').meta.refs.indexOf('A2') !== -1, 'refs fixed');
eq(mute(function () { return a37.renameObject('A2', 'B'); }), false);
eq(mute(function () { return a37.renameObject('NOPE', 'X'); }), false);
eq(mute(function () { return a37.renameObject('B', '9bad'); }), false);
pass('shim rename refs');
// 38 delete + exists + ordered names
var a38 = fresh();
a38.evalCommand('N1=Point(0,0)');
a38.evalCommand('N2=Point(1,1)');
a38.evalCommand('N3=Point(2,2)');
deep(a38.getAllObjectNames(), ['N1', 'N2', 'N3']);
eq(a38.exists('N2'), true);
eq(a38.exists('NOPE'), false);
eq(a38.deleteObject('N2'), true);
ok(!a38.exists('N2'));
deep(a38.getAllObjectNames(), ['N1', 'N3']);
eq(mute(function () { return a38.deleteObject('N2'); }), false);
pass('shim delete exists order');
// 39 getXML/setXML round-trip preserves construction
var a39 = fresh();
a39.evalCommand('A=Point(1.5,2.5)');
a39.evalCommand('B=Point(6,8)');
a39.evalCommand('S=Segment(A,B)');
a39.setColor('S', 0, 0, 255);
a39.setLineStyle('S', 2);
var xml39 = a39.getXML();
ok(xml39.indexOf('<educad') !== -1, 'xml head');
ok(xml39.indexOf('<object') !== -1, 'xml rows');
var b39 = fresh();
eq(b39.setXML(xml39), true);
deep(b39.getAllObjectNames(), ['A', 'B', 'S']);
eq(b39.getXcoord('A'), 1.5);
eq(b39.getYcoord('A'), 2.5);
eq(b39.getColor('S'), '#0000ff');
eq(b39._table().get('S').bisCode, 'E');
eq(b39.getObjectType('S'), 'segment');
pass('shim XML roundtrip');
// 40 setXML malformed false + warn, unchanged
var a40 = fresh();
a40.evalCommand('A=Point(1,1)');
var before40 = a40.getXML();
var cw40a = captureWarn(function () { return a40.setXML('not xml'); });
eq(cw40a.result, false);
warnedWithOffset(cw40a);
var cw40b = captureWarn(function () { return a40.setXML(42); });
eq(cw40b.result, false);
eq(a40.getXML(), before40);
pass('shim setXML malformed');
// 41 evalXML upsert returns last; malformed null
var a41 = fresh();
eq(a41.evalXML('<object name="X1" type="POINT" x="3" y="4"/>'), 'X1');
eq(a41.getXcoord('X1'), 3);
eq(a41.evalXML('<object name="X1" type="POINT" x="5" y="4"/>'), 'X1');
eq(a41.getXcoord('X1'), 5);
var cw41a = captureWarn(function () { return a41.evalXML('nothing here'); });
eq(cw41a.result, null);
warnedWithOffset(cw41a);
var cw41b = captureWarn(function () { return a41.evalXML(42); });
eq(cw41b.result, null);
pass('shim evalXML upsert');
// 42 listeners fire add/update/remove with names
var a42 = fresh();
var added42 = [];
var updated42 = [];
var removed42 = [];
eq(a42.registerAddListener(function (nm) { added42.push(nm); }), true);
eq(a42.registerUpdateListener(function (nm) { updated42.push(nm); }), true);
eq(a42.registerRemoveListener(function (nm) { removed42.push(nm); }), true);
a42.evalCommand('P1=Point(0,0)');
deep(added42, ['P1']);
a42.setCoords('P1', 1, 1);
deep(updated42, ['P1']);
a42.deleteObject('P1');
deep(removed42, ['P1']);
pass('shim listeners fire');
// 43 unregister stops fire; invalid register false
var a43 = fresh();
var added43 = [];
function onAdd43(nm) { added43.push(nm); }
a43.registerAddListener(onAdd43);
a43.evalCommand('P1=Point(0,0)');
eq(a43.unregisterAddListener(onAdd43), true);
a43.evalCommand('P2=Point(1,1)');
deep(added43, ['P1']);
eq(a43.unregisterAddListener(onAdd43), false);
eq(mute(function () { return a43.registerAddListener(42); }), false);
pass('shim unregister stops');
// 44 mode round-trip number + string; invalid false
var a44 = fresh();
eq(a44.getMode(), 0);
eq(a44.setMode(5), true);
eq(a44.getMode(), 5);
eq(a44.setMode('draw'), true);
eq(a44.getMode(), 'draw');
eq(mute(function () { return a44.setMode(null); }), false);
eq(mute(function () { return a44.setMode(''); }), false);
eq(a44.getMode(), 'draw');
pass('shim mode roundtrip');
// 45 undo/redo stack; empty false; new action clears redo
var a45 = fresh();
eq(a45.undo(), false);
eq(a45.redo(), false);
a45.evalCommand('A=Point(0,0)');
a45.evalCommand('B=Point(1,1)');
eq(a45.undo(), true);
ok(!a45.exists('B'));
ok(a45.exists('A'));
eq(a45.redo(), true);
ok(a45.exists('B'));
eq(a45.redo(), false);
eq(a45.undo(), true);
a45.evalCommand('C=Point(2,2)');
eq(a45.redo(), false);
ok(!a45.exists('B'));
ok(a45.exists('C'));
pass('shim undo redo');
// 46 clearConstruction empties + fires; undo restores
var a46 = fresh();
var removed46 = [];
a46.registerRemoveListener(function (nm) { removed46.push(nm); });
a46.evalCommand('A=Point(0,0)');
a46.evalCommand('B=Point(1,1)');
eq(a46.clearConstruction(), true);
deep(a46.getAllObjectNames(), []);
deep(removed46, ['A', 'B']);
eq(a46.undo(), true);
deep(a46.getAllObjectNames(), ['A', 'B']);
pass('shim clear undo');
// 47 grid default false + toggle
var a47 = fresh();
eq(a47.getGridVisible(), false);
eq(a47.setGridVisible(true), true);
eq(a47.getGridVisible(), true);
eq(a47.setGridVisible(false), true);
eq(a47.getGridVisible(), false);
pass('shim grid toggle');
// 48 zoom steps + clamp 0.05..50 + home reset s=2 centered
var a48 = fresh();
eq(a48._view().s, 2);
eq(a48.zoomIn(), true);
near(a48._view().s, 2.5, 1e-9, 'zin');
eq(a48.zoomOut(), true);
near(a48._view().s, 2, 1e-9, 'zout');
for (var zi = 0; zi < 60; zi++) a48.zoomIn();
eq(a48._view().s, 50);
for (var zo = 0; zo < 120; zo++) a48.zoomOut();
eq(a48._view().s, 0.05);
eq(a48.resetView(), true);
var v48 = a48._view();
eq(v48.s, 2);
eq(v48.tx, v48.w / 2);
eq(v48.ty, v48.h / 2);
pass('shim zoom clamp home');
// 49 exportSVG shapes + entities unmutated
var a49 = fresh();
a49.evalCommand('P=Point(10,20)');
a49.evalCommand('Q=Point(30,40)');
a49.evalCommand('S=Segment(P,Q)');
a49.evalCommand('T=Text(5,6,"hello")');
var snap49 = JSON.stringify(a49._table().list());
var svg49 = a49.exportSVG();
ok(svg49.indexOf('<svg') === 0, 'svg root');
ok(svg49.indexOf('<circle') !== -1, 'svg circle');
ok(svg49.indexOf('<line') !== -1, 'svg line');
ok(svg49.indexOf('<text') !== -1 && svg49.indexOf('hello') !== -1, 'svg text');
eq(JSON.stringify(a49._table().list()), snap49);
pass('shim exportSVG pure');
// 50 projector invariant elev.x == plan.x on shim pairs
var a50 = fresh();
a50.evalCommand('Plan1=Point(7,1)');
a50.evalCommand('Elev1=Point(7,9)');
ok(G.checkProjector({ x: 7, y: 1 }, { x: 7, y: 9 }));
ok(!G.checkProjector({ x: 7, y: 1 }, { x: 8, y: 9 }));
ok(E.checkEntityProjector(a50._table().get('Plan1'), a50._table().get('Elev1')));
pass('shim projector pair');
// 51 mm-only storage, exact coords, no px keys
var a51 = fresh();
a51.evalCommand('S=Segment(1.5,2.5,3.5,4.5)');
var e51 = a51._table().get('S');
eq(e51.x, 1.5); eq(e51.y, 2.5); eq(e51.x2, 3.5); eq(e51.y2, 4.5);
Object.keys(e51).forEach(function (k) {
  ok(k.toLowerCase().indexOf('px') === -1, 'no px key ' + k);
});
Object.keys(e51.meta || {}).forEach(function (k) {
  ok(k.toLowerCase().indexOf('px') === -1, 'no px meta ' + k);
});
pass('shim mm-only exact');
// 52 locked datum rejects setCoords, stays readable
var a52 = fresh();
eq(a52.evalXML('<object name="D1" type="DATUM_AXIS" x="0" y="0" ' +
  'x2="10" y2="0" lock="1"/>'), 'D1');
eq(a52._table().get('D1').locked, true);
var cw52 = captureWarn(function () { return a52.setCoords('D1', 5, 5); });
eq(cw52.result, false);
ok(/locked/.test(cw52.msgs.join(' ')), 'locked warn');
eq(a52.getXcoord('D1'), 0);
pass('shim locked datum');
// 53 isolation between applets + full never-throws sweep
var a53a = fresh();
var a53b = fresh();
a53a.evalCommand('Z1=Point(1,1)');
ok(a53a.exists('Z1'));
ok(!a53b.exists('Z1'));
var a53 = fresh();
mute(function () {
  a53.evalCommand(undefined);
  a53.evalCommand(42);
  a53.evalCommand('');
  a53.getValue();
  a53.getValue(null);
  a53.setValue();
  a53.setValue('x');
  a53.getXcoord();
  a53.getYcoord();
  a53.setCoords();
  a53.getObjectType();
  a53.setVisible();
  a53.getVisible();
  a53.setColor();
  a53.getColor();
  a53.setLineThickness();
  a53.setLineStyle();
  a53.renameObject();
  a53.renameObject('a');
  a53.deleteObject();
  a53.exists();
  a53.exists(null);
  a53.getAllObjectNames();
  a53.getXML();
  a53.setXML();
  a53.setXML(null);
  a53.evalXML();
  a53.evalXML(42);
  a53.registerAddListener();
  a53.registerAddListener(42);
  a53.registerUpdateListener({});
  a53.registerRemoveListener([]);
  a53.unregisterAddListener(function () {});
  a53.unregisterUpdateListener('nope');
  a53.unregisterRemoveListener(null);
  a53.setMode();
  a53.setMode(null);
  a53.getMode();
  a53.undo();
  a53.redo();
  a53.clearConstruction();
  a53.setGridVisible();
  a53.getGridVisible();
  a53.zoomIn();
  a53.zoomOut();
  a53.resetView();
  a53.exportSVG();
  a53.getVersion();
  a53.ping();
});
eq(a53.ping(), 'pong');
pass('shim isolation sweep');
// 54 primed identifiers (elevation notation a', b_1'')
var a54 = fresh();
eq(a54.evalCommand("a' = Point(20, 30)"), "a'");
eq(a54.evalCommand("b_1'' = Point(40, 10)"), "b_1''");
eq(a54.evalCommand("Segment(a', b_1'')") !== null, true);
eq(a54.getXcoord("a'"), 20);
eq(a54.getYcoord("b_1''"), 10);
eq(a54.renameObject("a'", "c'"), true);
eq(a54.exists("c'"), true);
eq(mute(function () { return a54.renameObject("c'", '9bad'); }), false);
pass('shim primed identifiers');
// 55 viewport Corner(1..4) queries in getValue/getXcoord/getYcoord
var a55 = fresh();
eq(a55.getXcoord('Corner(1)'), -200);
eq(a55.getYcoord('Corner(1)'), -150);
eq(a55.getXcoord('Corner(2)'), 200);
eq(a55.getYcoord('Corner(2)'), -150);
eq(a55.getXcoord('Corner(4)'), -200);
eq(a55.getYcoord('Corner(4)'), 150);
eq(a55.getValue('x(Corner(1))'), -200);
eq(a55.getValue('y(Corner(2))'), -150);
eq(a55.getValue('y(Corner(4))'), 150);
eq(mute(function () { return a55.getValue('Corner(1)'); }), null);
eq(mute(function () { return a55.getValue('Corner(5)'); }), null);
pass('shim corner queries');
// 56 quoted string args still parse after primed-name change
var a56 = fresh();
eq(a56.evalCommand('T1=Text(5,6,"hello")'), 'T1');
eq(a56.evalCommand("T2=Text(1,2,'quoted')"), 'T2');
eq(mute(function () { return a56.evalCommand('T3=Text(1,2,"oops)'); }), null);
pass('shim string args intact');

assert.strictEqual(n, TOTAL);
console.log('OK ' + TOTAL + '/' + TOTAL + ' phase3 tests passed');

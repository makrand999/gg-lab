(function (root, factory) {
  var instance = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = instance;
  } else {
    root.ggbApplet = instance;
    root.EduCadGgbShim = instance;
  }
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  // EduCAD Phase 3 GeoGebra shim (Class 4 Monge-first-angle CAD teaching aid).
  // World coordinates in mm only inside entities and solvers; screen px is
  // ephemeral render only (exportSVG). Projector invariant: elevation x
  // equals plan x (mm). Dual-layer Canvas2D model; no 3D, no DOM UI here.
  // Dual-env: browser via window.ggbApplet (alias window.EduCadGgbShim),
  // plain Node via module.exports. Zero dependencies (no outside loads).
  // Reuses window.EduCADEntities / window.EduCADViewport when present, or
  // injected deps via createApplet({ entities, viewport }); otherwise a small
  // internal fallback with identical mm-only semantics is used.
  //
  // API (39 applet methods, GeoGebra-compatible names, documented below):
  // evalCommand getValue setValue getXcoord getYcoord setCoords getObjectType
  // setVisible getVisible setColor getColor setLineThickness setLineStyle
  // renameObject deleteObject exists getAllObjectNames getXML setXML evalXML
  // registerAddListener registerUpdateListener registerRemoveListener
  // unregisterAddListener unregisterUpdateListener unregisterRemoveListener
  // setMode getMode undo redo clearConstruction setGridVisible getGridVisible
  // zoomIn zoomOut resetView exportSVG getVersion ping
  // NOTE: the Phase 3 brief says "36 methods" but enumerates 39 names; all 39
  // listed names are implemented (see API_METHODS).
  //
  // evalCommand grammar: [Name=]Command(arg, ...)  (regex parser, 14 commands)
  // Point(x,y) Segment(P,Q)|Segment(x1,y1,x2,y2) Line(P,Q)|Line(x1,y1,x2,y2)
  // Circle(C,r)|Circle(cx,cy,r) Arc(cx,cy,r,a1,a2) Perpendicular(P,L)
  // Parallel(P,L) Intersect(L1,L2) Midpoint(P,Q) Distance(P,Q)|Distance(coords)
  // Angle(A,V,B) Polygon(P,Q,R[,...]) Text(x,y,"cap") Dimension(P,Q)|Dim(coords)
  // Angles in degrees. Malformed input: console.warn with char offset and a
  // null (evalCommand/getters) or false (setters) return; never throws.
  // setLineStyle int->BIS: 0:A 1:B 2:E 3:G 4:H 5:K. getValue: meta value, else
  // radius (circle/arc), else |p2-p1| (segment/line/dimension), else null.
  var WORLD_UNITS = 'mm';
  var VERSION = '3.0.0-educad';
  var VERTICAL_EPS = 1e-9;
  var SCALE_MIN = 0.05;
  var SCALE_MAX = 50;
  var DEFAULT_SCALE = 2.0;
  var ZOOM_STEP = 1.25;
  var VIEW_W = 800;
  var VIEW_H = 600;
  var UNDO_MAX = 50;
  var NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
  var WORD_RE = /^[A-Za-z]+$/;
  var NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  var HEX6_RE = /^#([0-9a-fA-F]{6})$/;
  var HEX3_RE = /^#([0-9a-fA-F]{3})$/;
  var API_METHODS = ['evalCommand', 'getValue', 'setValue', 'getXcoord',
    'getYcoord', 'setCoords', 'getObjectType', 'setVisible', 'getVisible',
    'setColor', 'getColor', 'setLineThickness', 'setLineStyle', 'renameObject',
    'deleteObject', 'exists', 'getAllObjectNames', 'getXML', 'setXML',
    'evalXML', 'registerAddListener', 'registerUpdateListener',
    'registerRemoveListener', 'unregisterAddListener', 'unregisterUpdateListener',
    'unregisterRemoveListener', 'setMode', 'getMode', 'undo', 'redo',
    'clearConstruction', 'setGridVisible', 'getGridVisible', 'zoomIn', 'zoomOut',
    'resetView', 'exportSVG', 'getVersion', 'ping'];
  var COMMANDS = ['Point', 'Segment', 'Line', 'Circle', 'Arc', 'Perpendicular',
    'Parallel', 'Intersect', 'Midpoint', 'Distance', 'Angle', 'Polygon',
    'Text', 'Dimension'];
  var STYLE_TO_BIS = { 0: 'A', 1: 'B', 2: 'E', 3: 'G', 4: 'H', 5: 'K' };
  var GGB_TYPES = { POINT: 'point', SEGMENT: 'segment', LINE: 'line', RAY: 'ray',
    CIRCLE: 'circle', CIRCULAR_ARC: 'arc', DIMENSION: 'dimension', TEXT: 'text',
    DATUM_AXIS: 'axis' };
  var FALLBACK_DASH = { A: [], B: [], E: [8, 4], G: [12, 3, 2, 3],
    H: [12, 3, 2, 3], K: [12, 3, 2, 3, 2, 3] };
  var FALLBACK_WIDTH = { A: 0.50, B: 0.20, E: 0.35, G: 0.20, H: 0.20, K: 0.20 };

  function isFiniteNum(v) { return typeof v === 'number' && isFinite(v); }

  function warn(msg) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[EduCadGgbShim] ' + msg);
    }
  }

  function getGlobal(name) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) {
      return globalThis[name];
    }
    if (typeof window !== 'undefined' && window[name]) return window[name];
    if (root && root !== null && root[name]) return root[name];
    return null;
  }

  function escXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function unescXml(s) {
    return String(s).replace(/&quot;/g, '"').replace(/&gt;/g, '>')
      .replace(/&lt;/g, '<').replace(/&amp;/g, '&');
  }

  function canonCmd(word) {
    var low = String(word).toLowerCase();
    for (var i = 0; i < COMMANDS.length; i++) {
      if (COMMANDS[i].toLowerCase() === low) return COMMANDS[i];
    }
    return null;
  }

  function fmtNum(n) { return String(n); }

  // Minimal fallback entity store (mm-only, same field shape as the Phase 2
  // table). Used only when neither injected deps nor globals are present.
  var FALLBACK_TYPES = ['POINT', 'SEGMENT', 'LINE', 'RAY', 'CIRCLE',
    'CIRCULAR_ARC', 'DIMENSION', 'TEXT', 'DATUM_AXIS'];
  var FALLBACK_BIS = ['A', 'B', 'E', 'G', 'H', 'K'];
  var FALLBACK_ROLES = ['PLAN', 'ELEVATION', 'BOTH'];

  function fallbackValidType(t) { return FALLBACK_TYPES.indexOf(t) !== -1; }

  function FallbackTable() { this._map = {}; this._order = []; }
  FallbackTable.prototype.create = function (type, opts) {
    opts = opts || {};
    if (!fallbackValidType(type)) throw new Error('bad type ' + type);
    var id = String(opts.id || '');
    if (id === '') throw new Error('id needed');
    if (this._map[id] !== undefined) throw new Error('dup id ' + id);
    var e = {
      id: id, name: String(opts.name === undefined ? id : opts.name),
      type: type, x: opts.x || 0, y: opts.y || 0,
      x2: opts.x2 || 0, y2: opts.y2 || 0,
      radius: opts.radius || 0,
      startAngle: opts.startAngle || 0, endAngle: opts.endAngle || 0,
      bisCode: opts.bisCode || 'B', viewRole: opts.viewRole || 'BOTH',
      visible: opts.visible === undefined ? true : !!opts.visible,
      locked: opts.locked === undefined ? type === 'DATUM_AXIS' : !!opts.locked,
      layer: opts.layer || 'layer1',
      color: opts.color === undefined ? null : opts.color,
      thickness: opts.thickness === undefined ? null : opts.thickness,
      caption: String(opts.caption === undefined ? '' : opts.caption),
      showLabel: !!opts.showLabel, meta: opts.meta || {}
    };
    this._map[id] = e;
    this._order.push(id);
    return e;
  };
  FallbackTable.prototype.get = function (id) {
    return this._map[id] === undefined ? null : this._map[id];
  };
  FallbackTable.prototype.has = function (id) {
    return this._map[id] !== undefined;
  };
  FallbackTable.prototype.remove = function (id) {
    if (this._map[id] === undefined) return false;
    delete this._map[id];
    var i = this._order.indexOf(id);
    if (i !== -1) this._order.splice(i, 1);
    return true;
  };
  FallbackTable.prototype.count = function () { return this._order.length; };
  FallbackTable.prototype.list = function () {
    var out = [];
    for (var i = 0; i < this._order.length; i++) out.push(this._map[this._order[i]]);
    return out;
  };
  FallbackTable.prototype.clear = function () {
    this._map = {};
    this._order = [];
  };
  var FallbackEntities = {
    createTable: function () { return new FallbackTable(); },
    isValidType: fallbackValidType,
    BIS_CODES: FALLBACK_BIS
  };

  // Minimal fallback viewport math (same y-flip model as Phase 1).
  var FallbackViewport = {
    clampScale: function (s) {
      if (s < SCALE_MIN) return SCALE_MIN;
      if (s > SCALE_MAX) return SCALE_MAX;
      return s;
    },
    forward: function (view, x, y) {
      return { x: x * view.s + view.tx, y: view.ty - y * view.s };
    },
    zoomAt: function (view, c, f) {
      var s0 = view.s < SCALE_MIN ? SCALE_MIN : view.s;
      var ns = s0 * f;
      if (ns < SCALE_MIN) ns = SCALE_MIN;
      if (ns > SCALE_MAX) ns = SCALE_MAX;
      var wx = (c.x - view.tx) / s0;
      var wy = (view.ty - c.y) / s0;
      return { s: ns, tx: c.x - wx * ns, ty: c.y + wy * ns,
        w: view.w, h: view.h };
    },
    checkProjector: function (p, e) {
      return Math.abs(e.x - p.x) <= VERTICAL_EPS;
    }
  };

  function resolveDeps(deps) {
    deps = deps || {};
    var E = deps.entities || getGlobal('EduCADEntities') || FallbackEntities;
    var V = deps.viewport || getGlobal('EduCADViewport') || FallbackViewport;
    return { entities: E, viewport: V };
  }

  function newTable(E) {
    if (E && typeof E.createTable === 'function') return E.createTable();
    if (E && typeof E.CadEntityTable === 'function') {
      return new E.CadEntityTable();
    }
    return new FallbackTable();
  }

  function validEntityType(E, t) {
    if (E && typeof E.isValidType === 'function') return E.isValidType(t);
    if (E && E.ENTITY_TYPES && E.ENTITY_TYPES.indexOf) {
      return E.ENTITY_TYPES.indexOf(t) !== -1;
    }
    return fallbackValidType(t);
  }

  function validBis(E, code) {
    if (E && E.BIS_CODES && E.BIS_CODES.indexOf) {
      return E.BIS_CODES.indexOf(code) !== -1;
    }
    return FALLBACK_BIS.indexOf(code) !== -1;
  }

  function validRole(E, role) {
    if (E && E.VIEW_ROLES && E.VIEW_ROLES.indexOf) {
      return E.VIEW_ROLES.indexOf(role) !== -1;
    }
    return FALLBACK_ROLES.indexOf(role) !== -1;
  }

  function firstNonWs(t, from) {
    for (var i = from; i < t.length; i++) {
      if (t.charAt(i) !== ' ' && t.charAt(i) !== '\t') return i;
    }
    return t.length;
  }

  function classifyArg(text) {
    var t = text;
    if (t.length >= 2) {
      var q = t.charAt(0);
      var last = t.charAt(t.length - 1);
      if ((q === '"' || q === "'") && last === q) {
        var inner = t.slice(1, -1);
        var out = '';
        for (var i = 0; i < inner.length; i++) {
          var c = inner.charAt(i);
          if (c === '\\' && i + 1 < inner.length) {
            i++;
            out += inner.charAt(i);
          } else {
            out += c;
          }
        }
        return { kind: 'string', value: out };
      }
    }
    if (NUM_RE.test(t)) {
      var n = parseFloat(t);
      if (!isFiniteNum(n)) return { kind: 'badnum', value: t };
      return { kind: 'number', value: n };
    }
    if (NAME_RE.test(t)) return { kind: 'ref', value: t };
    return null;
  }

  // Regex command parser. Returns { name, nameOffset, cmd, cmdOffset, args }
  // or { error, offset }. Never throws.
  function parseCommand(input) {
    try {
      if (typeof input !== 'string') return { error: 'expected string', offset: 0 };
      var t = input;
      if (t.trim() === '') return { error: 'empty command', offset: 0 };
      var i1 = t.indexOf('(');
      var eq = t.indexOf('=');
      var name = null;
      var nameOffset = 0;
      var cmdOffset = 0;
      var cmdWord;
      if (eq !== -1 && (i1 === -1 || eq < i1)) {
        nameOffset = firstNonWs(t, 0);
        var left = t.slice(0, eq).trim();
        if (!NAME_RE.test(left)) {
          return { error: 'bad object name "' + left + '"', offset: nameOffset };
        }
        name = left;
        if (i1 === -1) return { error: "expected '('", offset: t.length };
        cmdOffset = firstNonWs(t, eq + 1);
        cmdWord = t.slice(eq + 1, i1).trim();
        if (!WORD_RE.test(cmdWord)) {
          return { error: 'bad command "' + cmdWord + '"', offset: cmdOffset };
        }
      } else {
        if (i1 === -1) return { error: "expected '('", offset: t.length };
        cmdOffset = firstNonWs(t, 0);
        cmdWord = t.slice(0, i1).trim();
        if (!WORD_RE.test(cmdWord)) {
          return { error: 'bad command "' + cmdWord + '"', offset: cmdOffset };
        }
      }
      var i2 = t.lastIndexOf(')');
      if (i2 === -1 || i2 < i1) return { error: "expected ')'", offset: t.length };
      var trail = t.slice(i2 + 1);
      if (trail.trim() !== '') {
        return { error: 'trailing text', offset: i2 + 1 + trail.search(/\S/) };
      }
      var cmd = canonCmd(cmdWord);
      if (cmd === null) return { error: 'unknown command', offset: cmdOffset };
      var inner = t.slice(i1 + 1, i2);
      if (inner.trim() === '') {
        return { error: 'missing arguments', offset: i1 + 1 };
      }
      var parts = [];
      var cur = '';
      var start = 0;
      var quote = null;
      for (var k = 0; k < inner.length; k++) {
        var ch = inner.charAt(k);
        if (quote !== null) {
          cur += ch;
          if (ch === '\\' && k + 1 < inner.length) {
            k++;
            cur += inner.charAt(k);
          } else if (ch === quote) {
            quote = null;
          }
        } else if (ch === '"' || ch === "'") {
          quote = ch;
          cur += ch;
        } else if (ch === ',' || ch === ';') {
          parts.push({ text: cur, local: start });
          cur = '';
          start = k + 1;
        } else if (ch === '(' || ch === ')') {
          return { error: "stray '" + ch + "'", offset: i1 + 1 + k };
        } else {
          cur += ch;
        }
      }
      if (quote !== null) {
        return { error: 'unterminated string', offset: i1 + 1 + start };
      }
      parts.push({ text: cur, local: start });
      var args = [];
      for (var a = 0; a < parts.length; a++) {
        var raw = parts[a].text;
        var trimmed = raw.trim();
        if (trimmed === '') {
          return { error: 'empty argument', offset: i1 + 1 + parts[a].local };
        }
        var leadWs = raw.length - raw.replace(/^\s+/, '').length;
        var absOff = i1 + 1 + parts[a].local + leadWs;
        var cls = classifyArg(trimmed);
        if (cls === null || cls.kind === 'badnum') {
          return { error: 'bad argument "' + trimmed + '"', offset: absOff };
        }
        args.push({ kind: cls.kind, value: cls.value, offset: absOff });
      }
      var arity = checkArity(cmd, args, i1 + 1);
      if (arity !== null) return arity;
      return { name: name, nameOffset: nameOffset, cmd: cmd,
        cmdOffset: cmdOffset, args: args };
    } catch (e) {
      return { error: 'parse fault', offset: 0 };
    }
  }

  function kinds(args) {
    var out = [];
    for (var i = 0; i < args.length; i++) out.push(args[i].kind);
    return out.join(',');
  }

  // Per-command arity + kind checks. Null when ok, else { error, offset }.
  function checkArity(cmd, args, innerOff) {
    var n = args.length;
    function bad(msg, i) {
      var off = (i === undefined) ? innerOff : args[i].offset;
      return { error: msg, offset: off };
    }
    function allKind(k) {
      for (var i = 0; i < n; i++) if (args[i].kind !== k) return false;
      return true;
    }
    if (cmd === 'Point') {
      if (n !== 2) return bad('Point needs (x,y)', undefined);
      if (!allKind('number')) return bad('Point needs numbers', undefined);
      return null;
    }
    if (cmd === 'Segment' || cmd === 'Line' || cmd === 'Distance' ||
        cmd === 'Dimension') {
      if (n === 2 && allKind('ref')) return null;
      if (n === 4 && allKind('number')) return null;
      return bad(cmd + ' needs (P,Q) or (x1,y1,x2,y2)', undefined);
    }
    if (cmd === 'Circle') {
      if (n === 2 && args[0].kind === 'ref' && args[1].kind === 'number') {
        return null;
      }
      if (n === 3 && allKind('number')) return null;
      return bad('Circle needs (C,r) or (cx,cy,r)', undefined);
    }
    if (cmd === 'Arc') {
      if (n !== 5) return bad('Arc needs (cx,cy,r,a1,a2)', undefined);
      if (!allKind('number')) return bad('Arc needs numbers', undefined);
      return null;
    }
    if (cmd === 'Perpendicular' || cmd === 'Parallel' || cmd === 'Intersect' ||
        cmd === 'Midpoint') {
      if (n !== 2) return bad(cmd + ' needs (A,B)', undefined);
      if (!allKind('ref')) return bad(cmd + ' needs object refs', undefined);
      return null;
    }
    if (cmd === 'Angle') {
      if (n !== 3) return bad('Angle needs (A,V,B)', undefined);
      if (!allKind('ref')) return bad('Angle needs object refs', undefined);
      return null;
    }
    if (cmd === 'Polygon') {
      if (n < 3) return bad('Polygon needs 3+ points', undefined);
      if (!allKind('ref')) return bad('Polygon needs point refs', undefined);
      return null;
    }
    if (cmd === 'Text') {
      if (n !== 3) return bad('Text needs (x,y,"cap")', undefined);
      if (args[0].kind !== 'number' || args[1].kind !== 'number' ||
          args[2].kind !== 'string') {
        return bad('Text needs (x,y,"cap")', undefined);
      }
      return null;
    }
    return bad('unknown command', undefined);
  }

  function distMm(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function norm2(dx, dy) {
    var m = Math.sqrt(dx * dx + dy * dy);
    if (m < 1e-12) return null;
    return { x: dx / m, y: dy / m, len: m };
  }

  // createApplet({ entities, viewport }): fresh GeoGebra-compatible applet.
  // Works standalone (fallback) or reusing the Phase 1/2 modules.
  function createApplet(deps) {
    var R = resolveDeps(deps);
    var E = R.entities;
    var V = R.viewport;
    var table = newTable(E);
    var view = { s: DEFAULT_SCALE, tx: VIEW_W / 2, ty: VIEW_H / 2,
      w: VIEW_W, h: VIEW_H };
    var gridVisible = false;
    var mode = 0;
    var seq = 0;
    var undoStack = [];
    var redoStack = [];
    var addL = [];
    var updL = [];
    var remL = [];

    function fire(list, name) {
      var copy = list.slice();
      for (var i = 0; i < copy.length; i++) {
        try {
          var cb = copy[i];
          if (typeof cb === 'function') {
            cb(name);
          } else if (typeof cb === 'string') {
            var g = getGlobal(cb);
            if (typeof g === 'function') g(name);
            else warn('listener "' + cb + '" not found');
          }
        } catch (e) {
          warn('listener fault for "' + name + '"');
        }
      }
    }

    function nextAuto() {
      for (;;) {
        seq++;
        var id = 'E' + seq;
        if (!table.has(id)) return id;
      }
    }

    function pushUndo() {
      try {
        undoStack.push(serialize(false));
      } catch (e) {
        undoStack.push('<educad version="1"></educad>');
      }
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack = [];
    }

    function clampView(v) {
      var s = v.s;
      if (!isFiniteNum(s)) s = DEFAULT_SCALE;
      if (typeof V.clampScale === 'function') {
        try { s = V.clampScale(s); } catch (e) { s = DEFAULT_SCALE; }
      } else {
        s = FallbackViewport.clampScale(s);
      }
      return { s: s, tx: v.tx, ty: v.ty, w: v.w, h: v.h };
    }

    function zoomStep(factor) {
      var c = { x: view.w / 2, y: view.h / 2 };
      var nv = null;
      if (V && typeof V.zoomAt === 'function') {
        try { nv = V.zoomAt(view, c, factor); } catch (e) { nv = null; }
      }
      if (nv === null) nv = FallbackViewport.zoomAt(view, c, factor);
      view = clampView(nv);
    }

    function fwdPx(x, y) {
      if (V && typeof V.forward === 'function') {
        try { return V.forward(view, { x: x, y: y }); } catch (e) { /* fall */ }
      }
      return FallbackViewport.forward(view, x, y);
    }

    function entPos(e) {
      if (e.type === 'POINT' || e.type === 'TEXT') return { x: e.x, y: e.y };
      return null;
    }

    function entLine(e) {
      if (e.type !== 'LINE' && e.type !== 'SEGMENT' && e.type !== 'RAY' &&
          e.type !== 'DIMENSION' && e.type !== 'DATUM_AXIS') {
        return null;
      }
      var d = norm2(e.x2 - e.x, e.y2 - e.y);
      if (d === null) return null;
      return { p: { x: e.x, y: e.y }, d: d };
    }

    function insertEntity(type, opts) {
      var created = null;
      try {
        created = table.create(type, opts);
      } catch (e) {
        return null;
      }
      return created;
    }

    function baseOpts(id, meta) {
      return { id: id, name: id, bisCode: 'B', viewRole: 'BOTH',
        visible: true, locked: false, layer: 'layer1', meta: meta || {} };
    }

    // Build entities for a parsed command. Returns { names:[...] } or
    // { fail, offset }. Pure checks run before any table insert.
    function buildParsed(p) {
      var a = p.args;
      var id = (p.name !== null) ? p.name : nextAuto();
      if (p.name !== null && table.has(p.name)) {
        return { fail: 'object "' + p.name + '" exists', offset: p.nameOffset };
      }
      var refs = [];
      var i;
      for (i = 0; i < a.length; i++) {
        if (a[i].kind === 'ref') {
          var ent = table.get(a[i].value);
          if (ent === null) {
            return { fail: 'unknown object "' + a[i].value + '"',
              offset: a[i].offset };
          }
          refs.push({ name: a[i].value, ent: ent, offset: a[i].offset });
        } else {
          refs.push(null);
        }
      }
      var nums = [];
      for (i = 0; i < a.length; i++) nums.push(a[i].value);
      switch (p.cmd) {
        case 'Point': return buildPoint(id, nums, p);
        case 'Segment': return buildSegLike(id, 'SEGMENT', a, nums, refs, p);
        case 'Line': return buildSegLike(id, 'LINE', a, nums, refs, p);
        case 'Circle': return buildCircle(id, a, nums, refs, p);
        case 'Arc': return buildArc(id, nums, p);
        case 'Perpendicular': return buildParallel(id, refs, p, true);
        case 'Parallel': return buildParallel(id, refs, p, false);
        case 'Intersect': return buildIntersect(id, refs, p);
        case 'Midpoint': return buildMidpoint(id, refs, p);
        case 'Distance': return buildMeasure(id, 'Distance', a, nums, refs, p);
        case 'Dimension': return buildMeasure(id, 'Dimension', a, nums, refs, p);
        case 'Angle': return buildAngle(id, refs, p);
        case 'Polygon': return buildPolygon(id, refs, p);
        case 'Text': return buildText(id, nums, p);
        default: return { fail: 'unknown command', offset: p.cmdOffset };
      }
    }

    function buildPoint(id, nums, p) {
      var o = baseOpts(id, { ggbType: 'point' });
      o.x = nums[0];
      o.y = nums[1];
      var e = insertEntity('POINT', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function segEnds(a, nums, refs) {
      if (a.length === 4) {
        return { x1: nums[0], y1: nums[1], x2: nums[2], y2: nums[3],
          dep: null, off: 0 };
      }
      var p1 = entPos(refs[0].ent);
      var p2 = entPos(refs[1].ent);
      if (p1 === null) {
        return { err: '"' + refs[0].name + '" is not a point',
          off: refs[0].offset };
      }
      if (p2 === null) {
        return { err: '"' + refs[1].name + '" is not a point',
          off: refs[1].offset };
      }
      return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        dep: [refs[0].name, refs[1].name], off: 0 };
    }

    function buildSegLike(id, type, a, nums, refs, p) {
      var ends = segEnds(a, nums, refs);
      if (ends.err) return { fail: ends.err, offset: ends.off };
      var o = baseOpts(id, { ggbType: type === 'LINE' ? 'line' : 'segment' });
      if (ends.dep !== null) o.meta.refs = ends.dep;
      o.x = ends.x1;
      o.y = ends.y1;
      o.x2 = ends.x2;
      o.y2 = ends.y2;
      o.bisCode = 'A';
      var e = insertEntity(type, o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function buildCircle(id, a, nums, refs, p) {
      var cx;
      var cy;
      var r;
      var dep = null;
      if (a.length === 2) {
        var c = entPos(refs[0].ent);
        if (c === null) {
          return { fail: '"' + refs[0].name + '" is not a point',
            offset: refs[0].offset };
        }
        cx = c.x;
        cy = c.y;
        r = nums[1];
        dep = [refs[0].name];
      } else {
        cx = nums[0];
        cy = nums[1];
        r = nums[2];
      }
      if (!(r > 0)) return { fail: 'radius must be > 0', offset: p.cmdOffset };
      var o = baseOpts(id, { ggbType: 'circle' });
      if (dep !== null) o.meta.refs = dep;
      o.x = cx;
      o.y = cy;
      o.radius = r;
      o.bisCode = 'A';
      var e = insertEntity('CIRCLE', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function buildArc(id, nums, p) {
      if (!(nums[2] > 0)) {
        return { fail: 'radius must be > 0', offset: p.cmdOffset };
      }
      var o = baseOpts(id, { ggbType: 'arc' });
      o.x = nums[0];
      o.y = nums[1];
      o.radius = nums[2];
      o.startAngle = nums[3];
      o.endAngle = nums[4];
      o.bisCode = 'A';
      var e = insertEntity('CIRCULAR_ARC', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function buildParallel(id, refs, p, perp) {
      var pt = entPos(refs[0].ent);
      if (pt === null) {
        return { fail: '"' + refs[0].name + '" is not a point',
          offset: refs[0].offset };
      }
      var g = entLine(refs[1].ent);
      if (g === null) {
        return { fail: '"' + refs[1].name + '" is not a line',
          offset: refs[1].offset };
      }
      var dx = g.d.x;
      var dy = g.d.y;
      if (perp) {
        var t = dx;
        dx = -dy;
        dy = t;
      }
      var o = baseOpts(id, { ggbType: 'line',
        refs: [refs[0].name, refs[1].name] });
      o.x = pt.x;
      o.y = pt.y;
      o.x2 = pt.x + dx * 10;
      o.y2 = pt.y + dy * 10;
      o.bisCode = 'A';
      var e = insertEntity('LINE', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function buildIntersect(id, refs, p) {
      var g1 = entLine(refs[0].ent);
      if (g1 === null) {
        return { fail: '"' + refs[0].name + '" is not a line',
          offset: refs[0].offset };
      }
      var g2 = entLine(refs[1].ent);
      if (g2 === null) {
        return { fail: '"' + refs[1].name + '" is not a line',
          offset: refs[1].offset };
      }
      var cross = g1.d.x * g2.d.y - g1.d.y * g2.d.x;
      if (Math.abs(cross) < 1e-9) {
        return { fail: 'lines are parallel', offset: refs[1].offset };
      }
      var t = ((g2.p.x - g1.p.x) * g2.d.y - (g2.p.y - g1.p.y) * g2.d.x) / cross;
      var o = baseOpts(id, { ggbType: 'point',
        refs: [refs[0].name, refs[1].name] });
      o.x = g1.p.x + t * g1.d.x;
      o.y = g1.p.y + t * g1.d.y;
      var e = insertEntity('POINT', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function buildMidpoint(id, refs, p) {
      var p1 = entPos(refs[0].ent);
      if (p1 === null) {
        return { fail: '"' + refs[0].name + '" is not a point',
          offset: refs[0].offset };
      }
      var p2 = entPos(refs[1].ent);
      if (p2 === null) {
        return { fail: '"' + refs[1].name + '" is not a point',
          offset: refs[1].offset };
      }
      var o = baseOpts(id, { ggbType: 'point',
        refs: [refs[0].name, refs[1].name] });
      o.x = (p1.x + p2.x) / 2;
      o.y = (p1.y + p2.y) / 2;
      var e = insertEntity('POINT', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function buildMeasure(id, which, a, nums, refs, p) {
      var ends = segEnds(a, nums, refs);
      if (ends.err) return { fail: ends.err, offset: ends.off };
      var len = distMm(ends.x1, ends.y1, ends.x2, ends.y2);
      var o = baseOpts(id, { ggbType: which === 'Distance' ? 'numeric' :
        'dimension', value: len });
      if (ends.dep !== null) o.meta.refs = ends.dep;
      o.x = ends.x1;
      o.y = ends.y1;
      o.x2 = ends.x2;
      o.y2 = ends.y2;
      o.caption = String(Math.round(len * 1000) / 1000);
      var e = insertEntity('DIMENSION', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function buildAngle(id, refs, p) {
      var pa = entPos(refs[0].ent);
      var pv = entPos(refs[1].ent);
      var pb = entPos(refs[2].ent);
      if (pa === null) {
        return { fail: '"' + refs[0].name + '" is not a point',
          offset: refs[0].offset };
      }
      if (pv === null) {
        return { fail: '"' + refs[1].name + '" is not a point',
          offset: refs[1].offset };
      }
      if (pb === null) {
        return { fail: '"' + refs[2].name + '" is not a point',
          offset: refs[2].offset };
      }
      var v1 = norm2(pa.x - pv.x, pa.y - pv.y);
      var v2 = norm2(pb.x - pv.x, pb.y - pv.y);
      if (v1 === null || v2 === null) {
        return { fail: 'angle degenerate', offset: refs[1].offset };
      }
      var dot = v1.x * v2.x + v1.y * v2.y;
      if (dot > 1) dot = 1;
      if (dot < -1) dot = -1;
      var deg = Math.acos(dot) * 180 / Math.PI;
      var o = baseOpts(id, { ggbType: 'angle', value: deg,
        refs: [refs[0].name, refs[1].name, refs[2].name] });
      o.x = pv.x;
      o.y = pv.y;
      o.caption = String(Math.round(deg * 1000) / 1000) + ' deg';
      o.showLabel = true;
      var e = insertEntity('TEXT', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function buildPolygon(id, refs, p) {
      var pts = [];
      var names = [];
      for (var i = 0; i < refs.length; i++) {
        var q = entPos(refs[i].ent);
        if (q === null) {
          return { fail: '"' + refs[i].name + '" is not a point',
            offset: refs[i].offset };
        }
        pts.push(q);
        names.push(refs[i].name);
      }
      var o = baseOpts(id, { ggbType: 'polygon', vertices: names.slice(),
        refs: names.slice() });
      o.x = pts[0].x;
      o.y = pts[0].y;
      o.caption = 'Polygon(' + names.join(',') + ')';
      o.showLabel = true;
      var head = insertEntity('TEXT', o);
      if (head === null) {
        return { fail: 'insert failed', offset: p.cmdOffset };
      }
      var made = [id];
      var okAll = true;
      for (var k = 0; k < pts.length; k++) {
        var eid = id + '_e' + (k + 1);
        if (table.has(eid)) {
          okAll = false;
          break;
        }
        var eo = baseOpts(eid, { ggbType: 'segment', polygon: id });
        eo.x = pts[k].x;
        eo.y = pts[k].y;
        eo.x2 = pts[(k + 1) % pts.length].x;
        eo.y2 = pts[(k + 1) % pts.length].y;
        eo.bisCode = 'A';
        if (insertEntity('SEGMENT', eo) === null) {
          okAll = false;
          break;
        }
        made.push(eid);
      }
      if (!okAll) {
        for (var r = 0; r < made.length; r++) table.remove(made[r]);
        return { fail: 'polygon edge clash', offset: p.cmdOffset };
      }
      return { names: made };
    }

    function buildText(id, nums, p) {
      var o = baseOpts(id, { ggbType: 'text' });
      o.x = nums[0];
      o.y = nums[1];
      o.caption = String(nums[2]);
      o.showLabel = true;
      var e = insertEntity('TEXT', o);
      if (e === null) return { fail: 'insert failed', offset: p.cmdOffset };
      return { names: [id] };
    }

    function metaVal(m, k) {
      if (m && m[k] !== undefined && m[k] !== null) return m[k];
      return null;
    }

    function serialize(includeView) {
      var head = '<educad version="1" seq="' + seq + '"';
      if (includeView) {
        head += ' grid="' + (gridVisible ? 1 : 0) + '" mode="' + escXml(mode) +
          '" s="' + fmtNum(view.s) + '" tx="' + fmtNum(view.tx) +
          '" ty="' + fmtNum(view.ty) + '" w="' + view.w + '" h="' + view.h + '"';
      }
      head += '>';
      var list = table.list();
      var parts = [head];
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        var m = e.meta || {};
        var gv = metaVal(m, 'ggbType');
        var vv = metaVal(m, 'value');
        parts.push('<object name="' + escXml(e.id) + '" type="' + e.type +
          '" x="' + fmtNum(e.x) + '" y="' + fmtNum(e.y) +
          '" x2="' + fmtNum(e.x2) + '" y2="' + fmtNum(e.y2) +
          '" radius="' + fmtNum(e.radius) + '" a1="' + fmtNum(e.startAngle) +
          '" a2="' + fmtNum(e.endAngle) + '" bis="' + e.bisCode +
          '" role="' + e.viewRole + '" vis="' + (e.visible ? 1 : 0) +
          '" lock="' + (e.locked ? 1 : 0) + '" layer="' + escXml(e.layer) +
          '" color="' + escXml(e.color === null ? '' : e.color) +
          '" thick="' + (e.thickness === null ? '' : fmtNum(e.thickness)) +
          '" caption="' + escXml(e.caption) + '" label="' +
          (e.showLabel ? 1 : 0) + '" ggb="' + escXml(gv === null ? '' : gv) +
          '" value="' + (isFiniteNum(vv) ? fmtNum(vv) : '') +
          '" refs="' + escXml((m.refs || []).join(',')) +
          '" vertices="' + escXml((m.vertices || []).join(',')) +
          '" polygon="' + escXml(m.polygon || '') + '"/>');
      }
      parts.push('</educad>');
      return parts.join('');
    }

    function parseAttrs(tag) {
      var attrs = {};
      var re = /(\w+)="([^"]*)"/g;
      var m;
      while ((m = re.exec(tag)) !== null) attrs[m[1]] = unescXml(m[2]);
      return attrs;
    }

    function numAttr(attrs, key, dflt) {
      if (attrs[key] === undefined || attrs[key] === '') return dflt;
      if (!NUM_RE.test(attrs[key])) return null;
      var n = parseFloat(attrs[key]);
      return isFiniteNum(n) ? n : null;
    }

    function parseObjects(xml) {
      var out = [];
      var re = /<object\b([^>]*?)\/>/g;
      var m;
      while ((m = re.exec(xml)) !== null) {
        var attrs = parseAttrs(m[1]);
        var id = attrs.name || '';
        var type = attrs.type || '';
        if (!NAME_RE.test(id) || !validEntityType(E, type)) {
          warn('setXML skips bad object tag');
          continue;
        }
        var x = numAttr(attrs, 'x', 0);
        var y = numAttr(attrs, 'y', 0);
        var x2 = numAttr(attrs, 'x2', 0);
        var y2 = numAttr(attrs, 'y2', 0);
        var radius = numAttr(attrs, 'radius', 0);
        var a1 = numAttr(attrs, 'a1', 0);
        var a2 = numAttr(attrs, 'a2', 0);
        if (x === null || y === null || x2 === null || y2 === null ||
            radius === null || a1 === null || a2 === null) {
          warn('setXML skips "' + id + '" (bad numbers)');
          continue;
        }
        var thick = (attrs.thick === undefined || attrs.thick === '') ? null :
          (NUM_RE.test(attrs.thick) ? parseFloat(attrs.thick) : NaN);
        if (thick !== null && !isFiniteNum(thick)) {
          warn('setXML skips "' + id + '" (bad thickness)');
          continue;
        }
        var meta = {};
        if (attrs.ggb) meta.ggbType = attrs.ggb;
        if (attrs.value !== undefined && attrs.value !== '' &&
            NUM_RE.test(attrs.value)) {
          meta.value = parseFloat(attrs.value);
        }
        if (attrs.refs) meta.refs = attrs.refs.split(',');
        if (attrs.vertices) meta.vertices = attrs.vertices.split(',');
        if (attrs.polygon) meta.polygon = attrs.polygon;
        var bis = validBis(E, attrs.bis) ? attrs.bis : 'B';
        var role = validRole(E, attrs.role) ? attrs.role : 'BOTH';
        out.push({ id: id, type: type, x: x, y: y, x2: x2, y2: y2,
          radius: radius, startAngle: a1, endAngle: a2, bisCode: bis,
          viewRole: role, visible: attrs.vis !== '0',
          locked: attrs.lock === '1', layer: attrs.layer || 'layer1',
          color: attrs.color || null, thickness: thick,
          caption: attrs.caption || '', showLabel: attrs.label === '1',
          meta: meta });
      }
      return out;
    }

    function parseHead(xml) {
      var m = /<educad\b([^>]*)>/.exec(xml);
      if (m === null) return null;
      return parseAttrs(m[1]);
    }

    function applyHead(head) {
      if (head === null) return;
      if (head.grid === '0' || head.grid === '1') {
        gridVisible = head.grid === '1';
      }
      if (head.mode !== undefined && head.mode !== '') {
        mode = NUM_RE.test(head.mode) ? parseFloat(head.mode) : head.mode;
      }
      var s = numAttr(head, 's', view.s);
      var tx = numAttr(head, 'tx', view.tx);
      var ty = numAttr(head, 'ty', view.ty);
      if (s !== null && tx !== null && ty !== null) {
        view = clampView({ s: s, tx: tx, ty: ty, w: view.w, h: view.h });
      }
      var w = numAttr(head, 'w', view.w);
      var h = numAttr(head, 'h', view.h);
      if (w !== null && h !== null && w >= 1 && h >= 1) {
        view.w = Math.round(w);
        view.h = Math.round(h);
      }
      var q = numAttr(head, 'seq', seq);
      if (q !== null && q >= 0) seq = Math.floor(q);
    }

    function restoreSnapshot(xml) {
      var objs = parseObjects(xml);
      table.clear();
      for (var i = 0; i < objs.length; i++) {
        var o = objs[i];
        insertEntity(o.type, o);
      }
      var head = parseHead(xml);
      if (head && head.seq !== undefined && NUM_RE.test(head.seq || '')) {
        seq = Math.floor(parseFloat(head.seq));
      } else {
        var max = 0;
        var list = table.list();
        for (var k = 0; k < list.length; k++) {
          var mm = /^E(\d+)$/.exec(list[k].id);
          if (mm && parseInt(mm[1], 10) > max) max = parseInt(mm[1], 10);
        }
        seq = max;
      }
    }

    function needObj(name) {
      if (typeof name !== 'string' || name === '') return null;
      return table.get(name);
    }

    var applet = {};

    // evalCommand(str): run one builder command. Returns the created object
    // name (polygon: head name), or null + warn(offset) when malformed.
    applet.evalCommand = function (cmdStr) {
      var p;
      try {
        p = parseCommand(cmdStr);
      } catch (e) {
        warn('evalCommand fault at offset 0');
        return null;
      }
      if (p.error) {
        warn('evalCommand ' + p.error + ' at offset ' + p.offset + ': ' +
          String(cmdStr).slice(0, 120));
        return null;
      }
      var seqBefore = seq;
      var snap;
      try {
        snap = serialize(false);
      } catch (e) {
        snap = '<educad version="1"></educad>';
      }
      var built;
      try {
        built = buildParsed(p);
      } catch (e) {
        seq = seqBefore;
        warn('evalCommand fault at offset ' + p.cmdOffset);
        return null;
      }
      if (built.fail) {
        seq = seqBefore;
        warn('evalCommand ' + built.fail + ' at offset ' + built.offset +
          ': ' + String(cmdStr).slice(0, 120));
        return null;
      }
      undoStack.push(snap);
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack = [];
      for (var i = 0; i < built.names.length; i++) fire(addL, built.names[i]);
      return built.names[0];
    };

    // getValue(name): numeric value (meta value, else radius, else |p2-p1|),
    // or null + warn when unknown / non-numeric.
    applet.getValue = function (name) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('getValue unknown object "' + name + '"');
          return null;
        }
        var m = e.meta || {};
        if (isFiniteNum(m.value)) return m.value;
        if (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') return e.radius;
        if (e.type === 'SEGMENT' || e.type === 'LINE' || e.type === 'RAY' ||
            e.type === 'DIMENSION' || e.type === 'DATUM_AXIS') {
          return distMm(e.x, e.y, e.x2, e.y2);
        }
        warn('getValue "' + name + '" has no numeric value');
        return null;
      } catch (err) {
        warn('getValue fault');
        return null;
      }
    };

    // setValue(name, v): store meta numeric value. True/false(+warn).
    applet.setValue = function (name, v) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('setValue unknown object "' + name + '"');
          return false;
        }
        if (!isFiniteNum(v)) {
          warn('setValue "' + name + '" needs finite number');
          return false;
        }
        pushUndo();
        if (!e.meta) e.meta = {};
        e.meta.value = v;
        fire(updL, name);
        return true;
      } catch (err) {
        warn('setValue fault');
        return false;
      }
    };

    // getXcoord/getYcoord(name): base point mm, or null + warn.
    applet.getXcoord = function (name) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('getXcoord unknown object "' + name + '"');
          return null;
        }
        return e.x;
      } catch (err) {
        warn('getXcoord fault');
        return null;
      }
    };

    applet.getYcoord = function (name) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('getYcoord unknown object "' + name + '"');
          return null;
        }
        return e.y;
      } catch (err) {
        warn('getYcoord fault');
        return null;
      }
    };

    // setCoords(name, x, y): move base point (mm). Locked XY datum rejects.
    applet.setCoords = function (name, x, y) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('setCoords unknown object "' + name + '"');
          return false;
        }
        if (!isFiniteNum(x) || !isFiniteNum(y)) {
          warn('setCoords "' + name + '" needs finite x/y in mm');
          return false;
        }
        if (e.locked) {
          warn('setCoords "' + name + '" is locked');
          return false;
        }
        pushUndo();
        e.x = x;
        e.y = y;
        fire(updL, name);
        return true;
      } catch (err) {
        warn('setCoords fault');
        return false;
      }
    };

    // getObjectType(name): GeoGebra type word, or null + warn.
    applet.getObjectType = function (name) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('getObjectType unknown object "' + name + '"');
          return null;
        }
        if (e.meta && e.meta.ggbType) return String(e.meta.ggbType);
        return GGB_TYPES[e.type] || String(e.type).toLowerCase();
      } catch (err) {
        warn('getObjectType fault');
        return null;
      }
    };

    // setVisible(name, v) / getVisible(name).
    applet.setVisible = function (name, v) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('setVisible unknown object "' + name + '"');
          return false;
        }
        pushUndo();
        e.visible = !!v;
        fire(updL, name);
        return true;
      } catch (err) {
        warn('setVisible fault');
        return false;
      }
    };

    applet.getVisible = function (name) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('getVisible unknown object "' + name + '"');
          return null;
        }
        return !!e.visible;
      } catch (err) {
        warn('getVisible fault');
        return null;
      }
    };

    function toHexByte(v) {
      if (!isFiniteNum(v)) return null;
      var b = Math.round(v);
      if (b < 0 || b > 255) return null;
      var h = b.toString(16);
      return h.length === 1 ? '0' + h : h;
    }

    // setColor(name, r, g, b) or setColor(name, "#rrggbb"/"#rgb").
    applet.setColor = function (name, r, g, b) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('setColor unknown object "' + name + '"');
          return false;
        }
        var hex = null;
        if (typeof r === 'string' && g === undefined && b === undefined) {
          var s = r.trim();
          if (HEX6_RE.test(s)) hex = '#' + s.slice(1).toLowerCase();
          else if (HEX3_RE.test(s)) {
            hex = '#' + s.charAt(1) + s.charAt(1) + s.charAt(2) + s.charAt(2) +
              s.charAt(3) + s.charAt(3);
            hex = hex.toLowerCase();
          }
        } else {
          var rh = toHexByte(r);
          var gh = toHexByte(g);
          var bh = toHexByte(b);
          if (rh !== null && gh !== null && bh !== null) {
            hex = '#' + rh + gh + bh;
          }
        }
        if (hex === null) {
          warn('setColor "' + name + '" needs r,g,b 0..255 or hex');
          return false;
        }
        pushUndo();
        e.color = hex;
        fire(updL, name);
        return true;
      } catch (err) {
        warn('setColor fault');
        return false;
      }
    };

    // getColor(name): "#rrggbb" (default black), or null + warn.
    applet.getColor = function (name) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('getColor unknown object "' + name + '"');
          return null;
        }
        return e.color === null ? '#000000' : String(e.color);
      } catch (err) {
        warn('getColor fault');
        return null;
      }
    };

    // setLineThickness(name, t): pen width in mm (> 0).
    applet.setLineThickness = function (name, t) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('setLineThickness unknown object "' + name + '"');
          return false;
        }
        if (!isFiniteNum(t) || !(t > 0)) {
          warn('setLineThickness "' + name + '" needs t > 0');
          return false;
        }
        pushUndo();
        e.thickness = t;
        fire(updL, name);
        return true;
      } catch (err) {
        warn('setLineThickness fault');
        return false;
      }
    };

    // setLineStyle(name, s): int 0..5 -> BIS A B E G H K.
    applet.setLineStyle = function (name, s) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('setLineStyle unknown object "' + name + '"');
          return false;
        }
        if (!isFiniteNum(s) || Math.floor(s) !== s ||
            STYLE_TO_BIS[s] === undefined) {
          warn('setLineStyle "' + name + '" needs int 0..5');
          return false;
        }
        pushUndo();
        e.bisCode = STYLE_TO_BIS[s];
        fire(updL, name);
        return true;
      } catch (err) {
        warn('setLineStyle fault');
        return false;
      }
    };

    // renameObject(oldName, newName): rename id (moves row to end, fixes
    // meta refs). True/false(+warn).
    applet.renameObject = function (oldName, newName) {
      try {
        var e = needObj(oldName);
        if (e === null) {
          warn('renameObject unknown object "' + oldName + '"');
          return false;
        }
        if (typeof newName !== 'string' || !NAME_RE.test(newName)) {
          warn('renameObject bad new name "' + newName + '"');
          return false;
        }
        if (table.has(newName)) {
          warn('renameObject "' + newName + '" exists');
          return false;
        }
        pushUndo();
        var clone = {
          id: newName, name: newName, x: e.x, y: e.y, x2: e.x2, y2: e.y2,
          radius: e.radius, startAngle: e.startAngle, endAngle: e.endAngle,
          bisCode: e.bisCode, viewRole: e.viewRole, visible: e.visible,
          locked: e.locked, layer: e.layer, color: e.color,
          thickness: e.thickness, caption: e.caption,
          showLabel: e.showLabel, meta: e.meta || {}
        };
        table.remove(oldName);
        var made = insertEntity(e.type, clone);
        if (made === null) {
          warn('renameObject fault for "' + oldName + '"');
          return false;
        }
        var list = table.list();
        for (var i = 0; i < list.length; i++) {
          var m = list[i].meta || {};
          var arrs = [m.refs, m.vertices];
          for (var k = 0; k < arrs.length; k++) {
            var arr = arrs[k];
            if (arr) {
              for (var j = 0; j < arr.length; j++) {
                if (arr[j] === oldName) arr[j] = newName;
              }
            }
          }
          if (m.polygon === oldName) m.polygon = newName;
        }
        fire(remL, oldName);
        fire(addL, newName);
        return true;
      } catch (err) {
        warn('renameObject fault');
        return false;
      }
    };

    // deleteObject(name): remove row (+ polygon edges). True/false(+warn).
    applet.deleteObject = function (name) {
      try {
        var e = needObj(name);
        if (e === null) {
          warn('deleteObject unknown object "' + name + '"');
          return false;
        }
        pushUndo();
        var gone = [name];
        var list = table.list();
        for (var i = 0; i < list.length; i++) {
          var m = list[i].meta || {};
          if (m.polygon === name && list[i].id !== name) gone.push(list[i].id);
        }
        for (var k = 0; k < gone.length; k++) table.remove(gone[k]);
        for (var r = 0; r < gone.length; r++) fire(remL, gone[r]);
        return true;
      } catch (err) {
        warn('deleteObject fault');
        return false;
      }
    };

    // exists(name): silent boolean (no warn; it is a query).
    applet.exists = function (name) {
      try {
        if (typeof name !== 'string' || name === '') return false;
        return table.has(name);
      } catch (err) {
        return false;
      }
    };

    // getAllObjectNames(): insertion-ordered id list (copy).
    applet.getAllObjectNames = function () {
      try {
        var list = table.list();
        var out = [];
        for (var i = 0; i < list.length; i++) out.push(list[i].id);
        return out;
      } catch (err) {
        warn('getAllObjectNames fault');
        return [];
      }
    };

    // getXML(): full construction XML (objects + view/grid/mode).
    applet.getXML = function () {
      try {
        return serialize(true);
      } catch (err) {
        warn('getXML fault');
        return '<educad version="1"></educad>';
      }
    };

    // setXML(str): replace construction from XML. True/false(+warn).
    applet.setXML = function (xml) {
      try {
        if (typeof xml !== 'string' || parseHead(xml) === null) {
          warn('setXML malformed at offset 0');
          return false;
        }
        var objs = parseObjects(xml);
        pushUndo();
        table.clear();
        var added = [];
        for (var i = 0; i < objs.length; i++) {
          var o = objs[i];
          if (insertEntity(o.type, o) !== null) added.push(o.id);
        }
        applyHead(parseHead(xml));
        for (var k = 0; k < added.length; k++) fire(addL, added[k]);
        return true;
      } catch (err) {
        warn('setXML fault');
        return false;
      }
    };

    // evalXML(str): upsert <object/> rows; returns last name or null(+warn).
    applet.evalXML = function (xml) {
      try {
        if (typeof xml !== 'string') {
          warn('evalXML malformed at offset 0');
          return null;
        }
        var objs = parseObjects(xml);
        if (objs.length === 0) {
          warn('evalXML no objects at offset 0');
          return null;
        }
        pushUndo();
        var last = null;
        for (var i = 0; i < objs.length; i++) {
          var o = objs[i];
          var isNew = !table.has(o.id);
          if (!isNew) table.remove(o.id);
          if (insertEntity(o.type, o) === null) continue;
          last = o.id;
          if (isNew) fire(addL, o.id);
          else fire(updL, o.id);
        }
        if (last === null) {
          warn('evalXML no objects applied at offset 0');
          return null;
        }
        return last;
      } catch (err) {
        warn('evalXML fault');
        return null;
      }
    };

    function regListener(list, cb, what) {
      if (typeof cb === 'function') {
        list.push(cb);
        return true;
      }
      if (typeof cb === 'string' && cb !== '') {
        list.push(cb);
        return true;
      }
      warn(what + ' needs function or global-name string');
      return false;
    }

    function unregListener(list, cb) {
      for (var i = 0; i < list.length; i++) {
        if (list[i] === cb) {
          list.splice(i, 1);
          return true;
        }
      }
      return false;
    }

    // Listener register/unregister (function or global-name string).
    applet.registerAddListener = function (cb) {
      try {
        return regListener(addL, cb, 'registerAddListener');
      } catch (err) {
        warn('registerAddListener fault');
        return false;
      }
    };
    applet.registerUpdateListener = function (cb) {
      try {
        return regListener(updL, cb, 'registerUpdateListener');
      } catch (err) {
        warn('registerUpdateListener fault');
        return false;
      }
    };
    applet.registerRemoveListener = function (cb) {
      try {
        return regListener(remL, cb, 'registerRemoveListener');
      } catch (err) {
        warn('registerRemoveListener fault');
        return false;
      }
    };
    applet.unregisterAddListener = function (cb) {
      try {
        return unregListener(addL, cb);
      } catch (err) {
        return false;
      }
    };
    applet.unregisterUpdateListener = function (cb) {
      try {
        return unregListener(updL, cb);
      } catch (err) {
        return false;
      }
    };
    applet.unregisterRemoveListener = function (cb) {
      try {
        return unregListener(remL, cb);
      } catch (err) {
        return false;
      }
    };

    // setMode(m)/getMode(): tool mode number (default 0) or label string.
    applet.setMode = function (m) {
      try {
        if (isFiniteNum(m)) {
          mode = m;
          return true;
        }
        if (typeof m === 'string' && m !== '') {
          mode = m;
          return true;
        }
        warn('setMode needs number or non-empty string');
        return false;
      } catch (err) {
        warn('setMode fault');
        return false;
      }
    };

    applet.getMode = function () {
      return mode;
    };

    function snapshotNow() {
      try {
        return serialize(false);
      } catch (err) {
        return '<educad version="1"></educad>';
      }
    }

    // undo()/redo(): object-history step (view/grid/mode untouched). Bool.
    applet.undo = function () {
      try {
        if (undoStack.length === 0) return false;
        redoStack.push(snapshotNow());
        var prev = undoStack.pop();
        restoreSnapshot(prev);
        return true;
      } catch (err) {
        warn('undo fault');
        return false;
      }
    };

    applet.redo = function () {
      try {
        if (redoStack.length === 0) return false;
        undoStack.push(snapshotNow());
        var next = redoStack.pop();
        restoreSnapshot(next);
        return true;
      } catch (err) {
        warn('redo fault');
        return false;
      }
    };

    // clearConstruction(): drop all objects (keeps view/mode/grid).
    applet.clearConstruction = function () {
      try {
        var list = table.list();
        if (list.length === 0) return true;
        pushUndo();
        var gone = [];
        for (var i = 0; i < list.length; i++) gone.push(list[i].id);
        table.clear();
        for (var k = 0; k < gone.length; k++) fire(remL, gone[k]);
        return true;
      } catch (err) {
        warn('clearConstruction fault');
        return false;
      }
    };

    // setGridVisible(v)/getGridVisible(): grid flag (default false).
    applet.setGridVisible = function (v) {
      try {
        gridVisible = !!v;
        return true;
      } catch (err) {
        warn('setGridVisible fault');
        return false;
      }
    };

    applet.getGridVisible = function () {
      return !!gridVisible;
    };

    // zoomIn()/zoomOut(): center-anchored x1.25 step, clamped 0.05..50.
    // resetView(): s=2 centered on kept w/h. All return true.
    applet.zoomIn = function () {
      try {
        zoomStep(ZOOM_STEP);
        return true;
      } catch (err) {
        warn('zoomIn fault');
        return false;
      }
    };

    applet.zoomOut = function () {
      try {
        zoomStep(1 / ZOOM_STEP);
        return true;
      } catch (err) {
        warn('zoomOut fault');
        return false;
      }
    };

    applet.resetView = function () {
      try {
        view = { s: DEFAULT_SCALE, tx: view.w / 2, ty: view.h / 2,
          w: view.w, h: view.h };
        return true;
      } catch (err) {
        warn('resetView fault');
        return false;
      }
    };

    function dashFor(e) {
      var dash = FALLBACK_DASH[e.bisCode] || [];
      var wmm = FALLBACK_WIDTH[e.bisCode];
      if (wmm === undefined) wmm = 0.20;
      if (E && typeof E.bisStyleFor === 'function') {
        try {
          var st = E.bisStyleFor(e.bisCode);
          dash = st.dashMm || [];
          wmm = st.widthMm;
        } catch (err) { /* keep fallback */ }
      }
      if (isFiniteNum(e.thickness) && e.thickness > 0) wmm = e.thickness;
      var dp = [];
      for (var i = 0; i < dash.length; i++) dp.push(dash[i] * view.s);
      return { dashPx: dp, widthPx: wmm * view.s };
    }

    function fmtPx(n) {
      return String(Math.round(n * 1000) / 1000);
    }

    // exportSVG(): ephemeral-px SVG snapshot (never mutates entities).
    applet.exportSVG = function () {
      try {
        var list = table.list();
        var out = ['<svg xmlns="http://www.w3.org/2000/svg" width="' +
          view.w + '" height="' + view.h + '" viewBox="0 0 ' + view.w + ' ' +
          view.h + '">'];
        for (var i = 0; i < list.length; i++) {
          var e = list[i];
          if (!e.visible) continue;
          var sty = dashFor(e);
          var col = e.color === null ? '#000000' : String(e.color);
          var dashAttr = sty.dashPx.length > 0 ?
            ' stroke-dasharray="' + sty.dashPx.join(' ') + '"' : '';
          var p1 = fwdPx(e.x, e.y);
          if (e.type === 'POINT') {
            out.push('<circle cx="' + fmtPx(p1.x) + '" cy="' + fmtPx(p1.y) +
              '" r="3" fill="' + escXml(col) + '"/>');
          } else if (e.type === 'CIRCLE') {
            out.push('<circle cx="' + fmtPx(p1.x) + '" cy="' + fmtPx(p1.y) +
              '" r="' + fmtPx(e.radius * view.s) + '" fill="none" stroke="' +
              escXml(col) + '" stroke-width="' + fmtPx(sty.widthPx) + '"' +
              dashAttr + '/>');
          } else if (e.type === 'CIRCULAR_ARC') {
            var rp = e.radius * view.s;
            var a0 = e.startAngle * Math.PI / 180;
            var a1 = e.endAngle * Math.PI / 180;
            var sx = p1.x + rp * Math.cos(a0);
            var sy = p1.y - rp * Math.sin(a0);
            var ex = p1.x + rp * Math.cos(a1);
            var ey = p1.y - rp * Math.sin(a1);
            var span = e.endAngle - e.startAngle;
            while (span < 0) span += 360;
            while (span >= 360) span -= 360;
            var large = span > 180 ? 1 : 0;
            out.push('<path d="M ' + fmtPx(sx) + ' ' + fmtPx(sy) + ' A ' +
              fmtPx(rp) + ' ' + fmtPx(rp) + ' 0 ' + large + ' 0 ' + fmtPx(ex) +
              ' ' + fmtPx(ey) + '" fill="none" stroke="' + escXml(col) +
              '" stroke-width="' + fmtPx(sty.widthPx) + '"' + dashAttr + '/>');
          } else if (e.type === 'TEXT') {
            out.push('<text x="' + fmtPx(p1.x) + '" y="' + fmtPx(p1.y) +
              '" font-size="12" fill="' + escXml(col) + '">' +
              escXml(e.caption) + '</text>');
          } else {
            var p2 = fwdPx(e.x2, e.y2);
            out.push('<line x1="' + fmtPx(p1.x) + '" y1="' + fmtPx(p1.y) +
              '" x2="' + fmtPx(p2.x) + '" y2="' + fmtPx(p2.y) +
              '" stroke="' + escXml(col) + '" stroke-width="' +
              fmtPx(sty.widthPx) + '"' + dashAttr + '/>');
          }
        }
        out.push('</svg>');
        return out.join('');
      } catch (err) {
        warn('exportSVG fault');
        return '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
      }
    };

    // getVersion(): shim version string. ping(): liveness ("pong").
    applet.getVersion = function () {
      return VERSION;
    };

    applet.ping = function () {
      return 'pong';
    };

    // Test-only introspection (not part of the 39-method API surface).
    applet._table = function () { return table; };
    applet._view = function () {
      return { s: view.s, tx: view.tx, ty: view.ty, w: view.w, h: view.h };
    };

    return applet;
  }

  function checkProjector(planMm, elevMm, eps) {
    var V = getGlobal('EduCADViewport');
    if (V && typeof V.checkProjector === 'function') {
      return V.checkProjector(planMm, elevMm, eps);
    }
    var E = getGlobal('EduCADEntities');
    if (E && typeof E.checkProjector === 'function') {
      return E.checkProjector(planMm, elevMm, eps);
    }
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  var defaultApplet = createApplet();
  defaultApplet.createApplet = createApplet;
  defaultApplet.API_METHODS = API_METHODS.slice();
  defaultApplet.COMMANDS = COMMANDS.slice();
  defaultApplet.VERSION = VERSION;
  defaultApplet.WORLD_UNITS = WORLD_UNITS;
  defaultApplet.checkProjector = checkProjector;

  return defaultApplet;
});

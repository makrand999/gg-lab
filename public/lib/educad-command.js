(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(function () { return require('./educad-drafting.js'); }, require('./educad-parametric.js'), require('./educad-view-frame.js'));
  } else {
    root.EduCADCommand = factory(function () { return root.EduCADDrafting; }, root.EduCADParametric, root.EduCADViewFrame);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (getDrafting, Parametric, ViewFrame) {
  'use strict';











  var VERSION = '1.0.0-educad';
  var WORLD_UNITS = 'mm';
  var NUM_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
  var SUGGEST_MAX = 12;
  var POINT_CONTEXT_KEY = typeof Symbol === 'function' ?
    Symbol('educadCommandPointContext') : '__educadCommandPointContext__';

  var DEMOS = ['line', 'points', 'prism', '3view', 'square'];
  var TUTS = ['square', 'prism', 'three-view-stepped-notch', 'three-view-inclined-block'];
  var MODES = ['edit', 'view'];
  var BIS_CODES = ['A', 'B', 'E', 'G', 'H', 'K'];
  var ROLES = ['plan', 'elevation', 'both', 'profile'];

  function normRole(word) {
    var low = String(word).toLowerCase();
    if (low === 'plan') return 'PLAN';
    if (low === 'elevation') return 'ELEVATION';
    if (low === 'both') return 'BOTH';
    if (low === 'profile') return 'PROFILE';
    return null;
  }

  function parseRoleSpec(word) {
    var raw = String(word || '').trim();
    var low = raw.toLowerCase();
    if (low === 'plan') return { viewRole: 'PLAN', frameId: null, key: 'PLAN' };
    if (low === 'elevation') return { viewRole: 'ELEVATION', frameId: null, key: 'ELEVATION' };
    if (low === 'both') return { viewRole: 'BOTH', frameId: null, key: 'BOTH' };
    if (low === 'profile') return { viewRole: 'PROFILE', frameId: null, key: 'PROFILE' };
    if (low.indexOf('aux:') === 0) {
      var id = raw.slice(4).trim();
      return id ? { viewRole: 'AUX', frameId: id, key: 'AUX:' + id } : null;
    }
    return null;
  }

  function isBis(word) {
    return BIS_CODES.indexOf(String(word).toUpperCase()) !== -1;
  }




  function parseBisRole(tail, allowAux) {
    var out = { bis: null, role: null, frameId: null, roleKey: null, error: '' };
    if (tail.length === 0) return out;
    if (tail.length > 2) {
      out.error = 'Too many arguments.';
      return out;
    }
    var first = tail[0], firstSpec = parseRoleSpec(first);
    if (isBis(first)) {
      out.bis = String(first).toUpperCase();
    } else if (firstSpec !== null) {
      if (firstSpec.viewRole === 'AUX' && !allowAux) {
        out.error = 'This command needs a principal view.';
        return out;
      }
      out.role = firstSpec.viewRole; out.frameId = firstSpec.frameId; out.roleKey = firstSpec.key;
    } else {
      out.error = '"' + first + '" is neither a BIS type (A B E G H K) nor a view (plan elevation both profile aux:<id>).';
      return out;
    }
    if (tail.length === 2) {
      if (out.role !== null) {
        out.error = 'Too many arguments.';
        return out;
      }
      var secondSpec = parseRoleSpec(tail[1]);
      if (secondSpec === null) {
        out.error = 'Role must be one of plan elevation both profile aux:<id>.';
        return out;
      }
      if (secondSpec.viewRole === 'AUX' && !allowAux) {
        out.error = 'This command needs a principal view.';
        return out;
      }
      out.role = secondSpec.viewRole; out.frameId = secondSpec.frameId; out.roleKey = secondSpec.key;
    }
    return out;
  }




  var COMMANDS = [
    { name: 'help', usage: '/help [command]',
      hint: 'List commands, or detail for one',
      args: [{ name: 'command', kind: 'command-name', optional: true }] },
    { name: 'point', usage: '/point <name> <x> <y> [role]',
      hint: 'Place a named point (mm)',
      args: [{ name: 'name', kind: 'point-new' },
        { name: 'x', kind: 'number' }, { name: 'y', kind: 'number' },
        { name: 'role', kind: 'role-name', optional: true }] },
    { name: 'line', usage: '/line <from> <to> [bis] [role]',
      hint: 'Segment between two named points',
      args: [{ name: 'from', kind: 'point-name' },
        { name: 'to', kind: 'point-name' },
        { name: 'bis', kind: 'bis-code', optional: true },
        { name: 'role', kind: 'role-name', optional: true }] },
    { name: 'ray', usage: '/ray <from> <to> [bis] [role]',
      hint: 'Ray from one named point through another',
      args: [{ name: 'from', kind: 'point-name' },
        { name: 'to', kind: 'point-name' },
        { name: 'bis', kind: 'bis-code', optional: true },
        { name: 'role', kind: 'role-name', optional: true }] },
    { name: 'xline', usage: '/xline <from> <to> [bis] [role]',
      hint: 'Construction line through two named points',
      args: [{ name: 'from', kind: 'point-name' },
        { name: 'to', kind: 'point-name' },
        { name: 'bis', kind: 'bis-code', optional: true },
        { name: 'role', kind: 'role-name', optional: true }] },
    { name: 'circle', usage: '/circle <center> <r> [bis] [role]  |  /circle <x> <y> <r> [bis] [role]',
      hint: 'Circle from a point or raw coords (mm)',
      args: [] },
    { name: 'arc', usage: '/arc <center> <r> <a1> <a2> [bis] [role]  |  /arc <x> <y> <r> <a1> <a2> [bis] [role]',
      hint: 'Circular arc from a point or raw coords (mm, degrees)',
      args: [] },
    { name: 'text', usage: '/text <x> <y> <words...>',
      hint: 'Write words at a spot (mm)',
      args: [{ name: 'x', kind: 'number' }, { name: 'y', kind: 'number' },
        { name: 'words', kind: 'words' }] },
    { name: 'dimension', usage: '/dimension <from> <to> [value [dx|dy|dz]] [bis] [role]',
      hint: 'Measured span, projected target, or signed world-axis offset',
      args: [{ name: 'from', kind: 'point-name' },
        { name: 'to', kind: 'point-name' },
        { name: 'value', kind: 'number', optional: true },
        { name: 'axis', kind: 'words', optional: true },
        { name: 'bis', kind: 'bis-code', optional: true },
        { name: 'role', kind: 'role-name', optional: true }] },
    { name: 'polygon', usage: '/polygon <p1> <p2> <p3> [p4 ...]',
      hint: 'Closed chain through named points',
      args: [{ name: 'p1', kind: 'point-name' },
        { name: 'p2', kind: 'point-name' },
        { name: 'p3', kind: 'point-name', variadic: true }] },
    { name: 'curve-through', usage: '/curve-through <p1> <p2> [p3 ...] [closed] [plan|elevation|profile|aux:<id>]',
      hint: 'Interpolate a natural or periodic cubic curve through ordered points',
      args: [{name:'points',kind:'point-name',variadic:true}] },
    { name: 'circle-through', usage: '/circle-through <p1> <p2> <p3> [plan|elevation|profile]',
      hint: 'Exact circle through three non-collinear points',
      args: [{name:'points',kind:'point-name',variadic:true}] },
    { name: 'arc-through', usage: '/arc-through <start> <through> <end> [plan|elevation|profile]',
      hint: 'Exact circular arc through three ordered points',
      args: [{name:'points',kind:'point-name',variadic:true}] },
    { name: 'polyline', usage: '/polyline <p1> <p2> [p3 ...]',
      hint: 'Open chain through named points (curves)',
      args: [{ name: 'p1', kind: 'point-name' },
        { name: 'p2', kind: 'point-name', variadic: true }] },
    { name: 'ellipse', usage: '/ellipse <center> <rx> <ry> [n] [bis] [role]  |  /ellipse <x> <y> <rx> <ry> [n] [bis] [role]',
      hint: 'Ellipse ring as an n-segment chain (mm)',
      args: [] },
    { name: 'conic', usage: '/conic <center> <ax> <ay> <bx> <by> [n] [bis] [role]  |  /conic <x> <y> <ax> <ay> <bx> <by> [n] [bis] [role]',
      hint: 'Exact ellipse from two view basis vectors (mm)',
      args: [] },
    { name: 'hatch', usage: '/hatch <x1> <y1> <x2> <y2> <spacing> [angle] [bis] [role]',
      hint: 'Section hatching clipped to a rectangle (mm)',
      args: [] },
    { name: 'rename', usage: '/rename <old-or-id> <new> [local|linked|members] [member-id]',
      hint: 'Change a display label, rename a linked member, or assign station members',
      args: [{ name: 'old', kind: 'point-name' },
        { name: 'new', kind: 'point-new' },
        { name: 'scope', kind: 'rename-scope', optional: true },
        { name: 'member-id', kind: 'point-new', optional: true }] },
    { name: 'delete', usage: '/delete <name>',
      hint: 'Delete an entity (cascades off its lines)',
      args: [{ name: 'name', kind: 'point-name' }] },
    { name: 'style', usage: '/style <name> <bis> [role]',
      hint: 'Restyle an entity (BIS type, view)',
      args: [{ name: 'name', kind: 'entity-name' },
        { name: 'bis', kind: 'bis-code' },
        { name: 'role', kind: 'role-name', optional: true }] },
    { name: 'section', usage: '/section <id> <view> <x1> <y1> <x2> <y2> [positive|negative] [retain]',
      hint: 'Mark a cutting-plane trace for a drawing section',
      args: [{ name: 'id', kind: 'words' },
        { name: 'view', kind: 'role-name' },
        { name: 'x1', kind: 'number' }, { name: 'y1', kind: 'number' },
        { name: 'x2', kind: 'number' }, { name: 'y2', kind: 'number' },
        { name: 'side', kind: 'words', optional: true },
        { name: 'retain', kind: 'words', optional: true }] },
    { name: 'section-boundary', usage: '/section-boundary <id> <view> <x1> <y1> <x2> <y2> [x3 y3 ...] | /section-boundary <id> <view> circle <x> <y> <r>',
      hint: 'Mark a closed drawn section-boundary loop',
      args: [{ name: 'id', kind: 'words' },
        { name: 'view', kind: 'role-name' },
        { name: 'x1', kind: 'number' }, { name: 'y1', kind: 'number' },
        { name: 'x2', kind: 'number' }, { name: 'y2', kind: 'number' },
        { name: 'more', kind: 'number', variadic: true }] },
    { name: 'profile', usage: '/profile <xRef> <dRef> [s]',
      hint: 'Set the side-view frame: sheet x = xRef + s * (depth - dRef)',
      args: [{name:'xRef',kind:'number'}, {name:'dRef',kind:'number'}, {name:'s',kind:'number',optional:true}] },
    { name: 'auxframe', usage: '/auxframe <id> <ox> <oy> <oz> <nx> <ny> <nz> <ux> <uy> <uz> [u0] [v0]',
      hint: 'Declare an orthonormal auxiliary view frame',
      args: [{name:'id',kind:'word'}, {name:'geometry',kind:'number',variadic:true}] },
    { name: 'datum', usage: '/datum [x1] [x2]',
      hint: 'XY ground datum (default -30 to 30)',
      args: [{ name: 'x1', kind: 'number', optional: true },
        { name: 'x2', kind: 'number', optional: true }] },
    { name: 'clear', usage: '/clear',
      hint: 'Empty the sheet',
      args: [] },
    { name: 'undo', usage: '/undo',
      hint: 'Undo the last sheet change',
      args: [] },
    { name: 'demo', usage: '/demo <name>',
      hint: 'Load a demo sheet',
      args: [{ name: 'name', kind: 'demo-name' }] },
    { name: 'tutorial', usage: '/tutorial <name>',
      hint: 'Start a scripted tutorial',
      args: [{ name: 'name', kind: 'tutorial-name' }] },
    { name: 'check', usage: '/check',
      hint: 'Grade hidden verdicts and claims',
      args: [] },
    { name: 'mode', usage: '/mode <edit|view>',
      hint: 'Switch Edit / View mode',
      args: [{ name: 'mode', kind: 'mode-name' }] }
  ];

  var COMMAND_NAMES = COMMANDS.map(function (c) { return c.name; });

  function specOf(name) {
    var low = String(name).toLowerCase();
    for (var i = 0; i < COMMANDS.length; i++) {
      if (COMMANDS[i].name === low) return COMMANDS[i];
    }
    return null;
  }

  function isNumTok(tok) {
    return NUM_RE.test(tok) && isFinite(parseFloat(tok));
  }

  function parseNum(tok) {
    if (!isNumTok(tok)) return null;
    var value = parseFloat(tok);
    return Math.abs(value) <= 1e6 ? value : null;
  }

  function parseDimensionTail(tail) {
    var value = null, axis = null;
    if (tail.length && parseNum(tail[0]) !== null) {
      value = parseNum(tail[0]);
      tail = tail.slice(1);
      if (tail.length && /^d[xyz]$/i.test(tail[0])) {
        axis = tail[0].toLowerCase().charAt(1);
        tail = tail.slice(1);
      }
      if (!axis && value < 0) return { error:'Dimension target must be >= 0 mm.' };
    }
    var br = parseBisRole(tail, true);
    br.value = value;
    br.axis = axis;
    return br;
  }



  function splitArgs(text) {
    var out = [];
    var cur = '';
    var inQ = false;
    var had = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (inQ) {
        if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
        had = true;
      } else if (ch === '"') {
        inQ = true;
        had = true;
      } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        if (had) {
          out.push(cur);
          cur = '';
          had = false;
        }
      } else {
        cur += ch;
        had = true;
      }
    }
    if (had) out.push(cur);
    return out;
  }

  function fail(message) { return { ok: false, message: message }; }




  function isNaturalRequest(line) {
    if (typeof line !== 'string') return false;
    return /^\/\s/.test(line.replace(/^\s+/, ''));
  }



  function parse(input) {
    if (typeof input !== 'string') throw new Error('educad-command: input must be a string');
    var line = input.replace(/^\s+|\s+$/g, '');
    if (line === '') {
      return { ok: false, slash: false, name: '', args: [], argText: '',
        error: 'empty', message: 'Type /help for the command list.' };
    }
    if (line.charAt(0) !== '/') {
      return { ok: false, slash: false, name: '', args: [], argText: line,
        error: 'missing-slash',
        message: 'Commands start with / — try /help.' };
    }
    var body = line.slice(1).replace(/^\s+|\s+$/g, '');
    if (body === '') {
      return { ok: false, slash: true, name: '', args: [], argText: '',
        error: 'no-command', message: 'Type a command — /help lists all ' +
          COMMANDS.length + '.' };
    }
    if ((body.match(/"/g) || []).length % 2) {
      return { ok: false, slash: true, name: '', args: [], argText: '',
        error: 'unclosed-quote', message: 'Close the double quote before running the command.' };
    }
    var toks = splitArgs(body);
    var spec = specOf(toks[0]);
    if (spec === null) {
      return { ok: false, slash: true, name: String(toks[0]), args: toks.slice(1),
        argText: toks.slice(1).join(' '), error: 'unknown-command',
        message: 'Unknown command "/' + toks[0] + '" — try /help.' };
    }
    return { ok: true, slash: true, name: spec.name, args: toks.slice(1),
      argText: toks.slice(1).join(' '), error: '', message: '' };
  }

  function pointNames(ctx) {
    if (!ctx) return [];
    if (Array.isArray(ctx.points)) return ctx.points.slice();
    if (ctx.points && typeof ctx.points === 'object') return Object.keys(ctx.points);
    return [];
  }

  function pointPos(ctx, name) {
    if (ctx && ctx.points && !Array.isArray(ctx.points) &&
        ctx.points[name] && typeof ctx.points[name] === 'object') {
      var p = ctx.points[name];
      if (typeof p.x === 'number' && typeof p.y === 'number' &&
          isFinite(p.x) && isFinite(p.y)) {
        return { x: p.x, y: p.y };
      }
    }
    return null;
  }

  function hasPoint(ctx, name) {
    if (ctx && ctx.points && !Array.isArray(ctx.points) &&
        Object.prototype.hasOwnProperty.call(ctx.points, name)) {
      return true;
    }
    return pointNames(ctx).indexOf(name) !== -1;
  }

  function entityNames(ctx) {
    if (!ctx) return [];
    if (Array.isArray(ctx.entities)) return ctx.entities.slice();
    if (ctx.entities && typeof ctx.entities === 'object') {
      return Object.keys(ctx.entities);
    }
    return [];
  }





  function hasEntity(ctx, name) {
    if (hasPoint(ctx, name)) return true;
    if (ctx && ctx.entities && !Array.isArray(ctx.entities) &&
        Object.prototype.hasOwnProperty.call(ctx.entities, name)) {
      return true;
    }
    if (ctx && ctx.entities && !Array.isArray(ctx.entities) && Object.keys(ctx.entities).some(function (key) { return ctx.entities[key] === name; })) return true;
    return entityNames(ctx).indexOf(name) !== -1;
  }

  function kindCandidates(kind, ctx) {
    if (kind === 'rename-scope') return ['local', 'linked', 'members'];
    if (kind === 'point-name') return pointNames(ctx);
    if (kind === 'entity-name') {
      var seen = Object.create(null);
      var out = [];
      var lists = [pointNames(ctx), entityNames(ctx)];
      for (var li = 0; li < lists.length; li++) {
        for (var i = 0; i < lists[li].length; i++) {
          if (!seen[lists[li][i]]) {
            seen[lists[li][i]] = true;
            out.push(lists[li][i]);
          }
        }
      }
      return out;
    }
    if (kind === 'command-name') return COMMAND_NAMES.slice();
    if (kind === 'demo-name') return DEMOS.slice();
    if (kind === 'tutorial-name') return TUTS.slice();
    if (kind === 'mode-name') return MODES.slice();
    if (kind === 'bis-code') return BIS_CODES.slice();
    if (kind === 'role-name') return ROLES.slice();
    return [];
  }

  function kindHint(kind) {
    if (kind === 'point-name') return 'named point';
    if (kind === 'entity-name') return 'entity';
    if (kind === 'command-name') return 'command';
    if (kind === 'demo-name') return 'demo sheet';
    if (kind === 'tutorial-name') return 'tutorial';
    if (kind === 'mode-name') return 'mode';
    if (kind === 'bis-code') return 'BIS type';
    if (kind === 'role-name') return 'view';
    return '';
  }



  function slotKind(spec, done) {
    if (spec.name === 'circle' || spec.name === 'arc' ||
        spec.name === 'ellipse' || spec.name === 'hatch') return '';
    var fixed = spec.args;
    if (done < fixed.length) return fixed[done].kind;
    if (fixed.length > 0 && fixed[fixed.length - 1].variadic) {
      return fixed[fixed.length - 1].kind;
    }
    return '';
  }

  function slotLast(spec, done) {
    var fixed = spec.args;
    if (fixed.length > 0 && fixed[fixed.length - 1].variadic) return false;
    return done >= fixed.length - 1;
  }





  function suggest(input, ctx) {
    if (typeof input !== 'string') throw new Error('educad-command: input must be a string');
    if (input === '') {
      return [{ text: '/', display: '/', hint: 'Start a command', kind: 'command' }];
    }
    if (input.charAt(0) !== '/') return [];
    var rest = input.slice(1);
    var sp = rest.search(/\s/);
    if (sp === -1) {
      var low = rest.toLowerCase();
      var out = [];
      for (var i = 0; i < COMMANDS.length; i++) {
        if (COMMANDS[i].name.slice(0, low.length) === low) {
          out.push({ text: '/' + COMMANDS[i].name + ' ',
            display: '/' + COMMANDS[i].name, hint: COMMANDS[i].hint,
            kind: 'command' });
        }
      }
      return out;
    }
    var spec = specOf(rest.slice(0, sp));
    if (spec === null) return [];
    var after = rest.slice(sp + 1);
    var trailing = /\s$/.test(after);
    var toks = splitArgs(after);
    var current = trailing ? '' : (toks.length > 0 ? toks[toks.length - 1] : '');
    var done = trailing ? toks.length : Math.max(0, toks.length - 1);





    if (spec.name === 'circle' || spec.name === 'arc' ||
        spec.name === 'ellipse') {
      var extra = spec.name === 'circle' ? 0 : (spec.name === 'arc' ? 2 : 1);
      var named = toks.length === 0 || !isNumTok(toks[0]);
      var base = (named ? 2 : 3) + extra;
      var cl = current.toLowerCase();
      var prefix = input.slice(0, input.length - current.length);
      var items = [];
      var cspace = false;
      if (done === 0 && named) {
        var centers = pointNames(ctx);
        for (var ci = 0; ci < centers.length; ci++) {
          items.push({ w: centers[ci], k: 'point-name', h: 'center point' });
        }
        cspace = true;
      } else if (done === base) {
        for (var bi = 0; bi < BIS_CODES.length; bi++) {
          items.push({ w: BIS_CODES[bi], k: 'bis-code', h: kindHint('bis-code') });
        }
        for (var ri = 0; ri < ROLES.length; ri++) {
          items.push({ w: ROLES[ri], k: 'role-name', h: kindHint('role-name') });
        }
        cspace = true;
      } else if (done === base + 1 && toks.length > base && isBis(toks[base])) {
        for (var rj = 0; rj < ROLES.length; rj++) {
          items.push({ w: ROLES[rj], k: 'role-name', h: kindHint('role-name') });
        }
      } else if (spec.name === 'ellipse' && done === base + 1 &&
          toks.length > base && isNumTok(toks[base])) {


        for (var eb = 0; eb < BIS_CODES.length; eb++) {
          items.push({ w: BIS_CODES[eb], k: 'bis-code', h: kindHint('bis-code') });
        }
        for (var er = 0; er < ROLES.length; er++) {
          items.push({ w: ROLES[er], k: 'role-name', h: kindHint('role-name') });
        }
        cspace = true;
      } else if (spec.name === 'ellipse' && done === base + 2 &&
          toks.length > base + 1 && isNumTok(toks[base]) &&
          isBis(toks[base + 1])) {
        for (var er2 = 0; er2 < ROLES.length; er2++) {
          items.push({ w: ROLES[er2], k: 'role-name', h: kindHint('role-name') });
        }
      } else {
        return [];
      }
      var hits = [];
      for (var c = 0; c < items.length; c++) {
        if (items[c].w.toLowerCase().slice(0, cl.length) === cl) {
          hits.push({ text: prefix + quoteIfNeeded(items[c].w) + (cspace ? ' ' : ''),
            display: items[c].w, hint: items[c].h, kind: items[c].k });
          if (hits.length >= SUGGEST_MAX) break;
        }
      }
      return hits;
    }



    if (spec.name === 'hatch') {
      var hcl = current.toLowerCase();
      var hprefix = input.slice(0, input.length - current.length);
      var hitems = [];
      var hspace = false;
      if (done < 5) {
        return [];
      } else if (done === 5) {
        for (var hb = 0; hb < BIS_CODES.length; hb++) {
          hitems.push({ w: BIS_CODES[hb], k: 'bis-code', h: kindHint('bis-code') });
        }
        for (var hr = 0; hr < ROLES.length; hr++) {
          hitems.push({ w: ROLES[hr], k: 'role-name', h: kindHint('role-name') });
        }
        hspace = true;
      } else if (done === 6 && toks.length > 5 && isBis(toks[5])) {
        for (var hr2 = 0; hr2 < ROLES.length; hr2++) {
          hitems.push({ w: ROLES[hr2], k: 'role-name', h: kindHint('role-name') });
        }
      } else if (done === 6 && toks.length > 5 && isNumTok(toks[5])) {
        for (var hb2 = 0; hb2 < BIS_CODES.length; hb2++) {
          hitems.push({ w: BIS_CODES[hb2], k: 'bis-code', h: kindHint('bis-code') });
        }
        for (var hr3 = 0; hr3 < ROLES.length; hr3++) {
          hitems.push({ w: ROLES[hr3], k: 'role-name', h: kindHint('role-name') });
        }
        hspace = true;
      } else if (done === 7 && toks.length > 6 && isNumTok(toks[5]) &&
          isBis(toks[6])) {
        for (var hr4 = 0; hr4 < ROLES.length; hr4++) {
          hitems.push({ w: ROLES[hr4], k: 'role-name', h: kindHint('role-name') });
        }
      } else {
        return [];
      }
      var hhits = [];
      for (var hc = 0; hc < hitems.length; hc++) {
        if (hitems[hc].w.toLowerCase().slice(0, hcl.length) === hcl) {
          hhits.push({ text: hprefix + quoteIfNeeded(hitems[hc].w) + (hspace ? ' ' : ''),
            display: hitems[hc].w, hint: hitems[hc].h, kind: hitems[hc].k });
          if (hhits.length >= SUGGEST_MAX) break;
        }
      }
      return hhits;
    }
    var kind = slotKind(spec, done);
    if (kind === '') return [];
    var cands = kindCandidates(kind, ctx);


    if ((spec.name === 'line' || spec.name === 'ray' ||
        spec.name === 'xline' || spec.name === 'dimension') && done === 1 &&
        toks.length > 0) {
      cands = cands.filter(function (c) { return c !== toks[0]; });
    }

    if (kind === 'role-name' && done > 0 && toks.length >= done &&
        normRole(toks[done - 1]) !== null) {
      return [];
    }
    var items = cands.map(function (c) {
      return { w: c, k: kind, h: kindHint(kind) };
    });


    if (kind === 'bis-code' && spec.args[done + 1] !== undefined &&
        spec.args[done + 1].kind === 'role-name') {
      var roles = kindCandidates('role-name', ctx);
      for (var ri = 0; ri < roles.length; ri++) {
        items.push({ w: roles[ri], k: 'role-name', h: kindHint('role-name') });
      }
    }
    if (items.length === 0) return [];
    var prefix = input.slice(0, input.length - current.length);
    var wantSpace = !slotLast(spec, done);
    var pl = current.toLowerCase();
    var res = [];
    for (var k = 0; k < items.length; k++) {
      if (items[k].w.toLowerCase().slice(0, pl.length) === pl) {
        res.push({ text: prefix + quoteIfNeeded(items[k].w) + (wantSpace ? ' ' : ''),
          display: items[k].w, hint: items[k].h, kind: items[k].k });
        if (res.length >= SUGGEST_MAX) break;
      }
    }
    return res;
  }

  function fmtPt(x, y) { return '(' + x + ', ' + y + ')'; }

  var ELLIPSE_SEGS_DEFAULT = 48;
  var ELLIPSE_SEGS_MIN = 8;
  var ELLIPSE_SEGS_MAX = 180;
  var HATCH_ANGLE_DEFAULT = 45;
  var HATCH_LINES_MAX = 200;




  function arcSweepDeg(a1, a2) {
    var span = (a2 - a1) % 360;
    if (span < 0) span += 360;
    if (span < 1e-9 || 360 - span < 1e-9) return 0;
    return span;
  }




  function ellipseRing(cx, cy, rx, ry, n) {
    var quads = [];
    for (var i = 0; i < n; i++) {
      var t0 = 2 * Math.PI * i / n;
      var t1 = 2 * Math.PI * (i + 1) / n;
      quads.push([cx + rx * Math.cos(t0), cy + ry * Math.sin(t0),
        cx + rx * Math.cos(t1), cy + ry * Math.sin(t1)]);
    }
    return quads;
  }

  function basisRing(cx, cy, a, b, n) {
    var quads = [];
    for (var i = 0; i < n; i++) {
      var t0 = 2 * Math.PI * i / n;
      var t1 = 2 * Math.PI * (i + 1) / n;
      quads.push([cx + a.x * Math.cos(t0) + b.x * Math.sin(t0),
        cy + a.y * Math.cos(t0) + b.y * Math.sin(t0),
        cx + a.x * Math.cos(t1) + b.x * Math.sin(t1),
        cy + a.y * Math.cos(t1) + b.y * Math.sin(t1)]);
    }
    return quads;
  }




  function hatchLines(x1, y1, x2, y2, spacing, angleDeg, limit) {
    limit = limit || 10000;
    var xa = Math.min(x1, x2), xb = Math.max(x1, x2);
    var ya = Math.min(y1, y2), yb = Math.max(y1, y2);
    var th = angleDeg * Math.PI / 180;
    var dx = Math.cos(th), dy = Math.sin(th);
    var nx = -dy, ny = dx;
    var corners = [xa * nx + ya * ny, xb * nx + ya * ny,
      xa * nx + yb * ny, xb * nx + yb * ny];
    var tmin = Math.min(corners[0], corners[1], corners[2], corners[3]);
    var tmax = Math.max(corners[0], corners[1], corners[2], corners[3]);
    var out = [];
    if (!(spacing > 0) || !isFinite(tmin) || !isFinite(tmax)) return out;
    var k0 = Math.floor(tmin / spacing) + 1;
    var k1 = Math.ceil(tmax / spacing) - 1;
    if (!Number.isSafeInteger(k0) || !Number.isSafeInteger(k1) || k1 - k0 + 1 > limit) {
      throw new Error('Hatch spacing needs too many lines (over ' + limit + ') — widen it or shrink the area.');
    }
    for (var k = k0; k <= k1; k++) {
      var t = k * spacing;
      var px = nx * t, py = ny * t;
      var lo = -Infinity, hi = Infinity;
      if (Math.abs(dx) < 1e-12) {
        if (px < xa || px > xb) continue;
      } else {
        var s1 = (xa - px) / dx, s2 = (xb - px) / dx;
        lo = Math.max(lo, Math.min(s1, s2));
        hi = Math.min(hi, Math.max(s1, s2));
      }
      if (Math.abs(dy) < 1e-12) {
        if (py < ya || py > yb) continue;
      } else {
        var u1 = (ya - py) / dy, u2 = (yb - py) / dy;
        lo = Math.max(lo, Math.min(u1, u2));
        hi = Math.min(hi, Math.max(u1, u2));
      }
      if (hi - lo > 1e-9) {


        var ax = px + dx * lo, ay = py + dy * lo;
        var bx = px + dx * hi, by = py + dy * hi;
        if (Math.abs(ax - xa) < 1e-9) ax = xa;
        if (Math.abs(ax - xb) < 1e-9) ax = xb;
        if (Math.abs(ay - ya) < 1e-9) ay = ya;
        if (Math.abs(ay - yb) < 1e-9) ay = yb;
        if (Math.abs(bx - xa) < 1e-9) bx = xa;
        if (Math.abs(bx - xb) < 1e-9) bx = xb;
        if (Math.abs(by - ya) < 1e-9) by = ya;
        if (Math.abs(by - yb) < 1e-9) by = yb;
        out.push([ax, ay, bx, by]);
      }
    }
    return out;
  }




  function splitCountTail(tail) {
    if (tail.length > 0 && parseNum(tail[0]) !== null) {
      return { num: parseNum(tail[0]), rest: tail.slice(1) };
    }
    return { num: null, rest: tail.slice() };
  }

  function fmtLen(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    return (Math.round(Math.sqrt(dx * dx + dy * dy) * 100) / 100).toFixed(2);
  }




  function preview(input, ctx) {
    if (typeof input !== 'string') throw new Error('educad-command: input must be a string');
    var line = input.replace(/^\s+|\s+$/g, '');
    if (line === '') return '';
    if (line.charAt(0) !== '/') return 'Commands start with / — try /help.';
    var p = parse(input);
    if (!p.ok) {
      if (p.error === 'no-command') {
        return 'Type a command — /help lists all ' + COMMANDS.length + '.';
      }
      return p.message;
    }
    var spec = specOf(p.name);
    var args = p.args;
    if (p.name === 'circle' || p.name === 'arc' || p.name === 'ellipse') {
      return previewRound(p.name, args, ctx);
    }
    if (p.name === 'conic') return previewConic(args, ctx, spec.usage);
    if (['curve-through','circle-through','arc-through'].indexOf(p.name)!==-1) {
      return previewThrough(p.name, args, ctx, spec);
    }
    if (p.name === 'hatch') return previewHatch(args, ctx);
    var fixed = spec.args;
    var need = 0;
    for (var i = 0; i < fixed.length; i++) {
      if (!fixed[i].optional && !fixed[i].variadic) need++;
    }
    var minNeed = need;
    var hasVariadic = fixed.length > 0 && fixed[fixed.length - 1].variadic;

    for (var v = 0; v < fixed.length; v++) {
      if (fixed[v].variadic) minNeed++;
    }
    if (args.length < minNeed) return 'Usage: ' + spec.usage;
    if (!hasVariadic && args.length > fixed.length) {
      return 'Too many arguments — usage: ' + spec.usage;
    }
    switch (p.name) {
      case 'help':
        if (args.length === 0) return 'List all ' + COMMANDS.length + ' commands.';
        return specOf(args[0]) !== null ?
          ('Detail for /' + args[0].toLowerCase() + '.') :
          ('Unknown command "/' + args[0] + '" — try /help.');
      case 'point': {
        if (!args[0].trim()) return 'Point name must not be empty.';
        var px = parseNum(args[1]), py = parseNum(args[2]);
        if (px === null || py === null) return 'x and y must be numbers (mm) — usage: ' + spec.usage;
        if (hasPoint(ctx, args[0])) return 'There is already a point "' + args[0] + '".';
        var pvSpec = args.length > 3 ? parseRoleSpec(args[3]) : null;
        if (args.length > 3 && pvSpec === null) {
          return 'Role must be one of plan elevation both profile aux:<id>.';
        }
        var prole = pvSpec ? ' in ' + pvSpec.key + ' view' : '';
        return 'Place point "' + args[0] + '" at ' + fmtPt(px, py) + ' mm' + prole + '.';
      }
      case 'line':
      case 'ray':
      case 'xline':
      case 'dimension': {
        var verbs = { line: 'Draw segment ', ray: 'Draw ray ',
          xline: 'Draw construction line ', dimension: 'Dimension ' };
        var dt = p.name === 'dimension' ? parseDimensionTail(args.slice(2)) : null;
        var br = dt || parseBisRole(args.slice(2), true);
        if (br.error !== '') return br.error + ' — usage: ' + spec.usage;
        var ptypes = { line: 'SEGMENT', ray: 'RAY', xline: 'LINE',
          dimension: 'DIMENSION' };
        var popts = isAnnotationStroke(ptypes[p.name],
          br.bis !== null ? br.bis : 'B', null) ? { annotation: true } : undefined;
        var la = previewNeedPoint(ctx, args[0], br.roleKey, popts);
        if (la.fail) return la.fail;
        var lb = previewNeedPoint(ctx, args[1], br.roleKey, popts);
        if (lb.fail) return lb.fail;
        var pa = (typeof la.ent.x === 'number' && typeof la.ent.y === 'number') ?
          { x: la.ent.x, y: la.ent.y } : null;
        var pb = (typeof lb.ent.x === 'number' && typeof lb.ent.y === 'number') ?
          { x: lb.ent.x, y: lb.ent.y } : null;
        var tail = (pa !== null && pb !== null) ? ' (L ' + fmtLen(pa, pb) + ' mm)' : '';
        var style = (dt && dt.value !== null ? ', target ' + dt.value + ' mm' : '') +
          (br.bis !== null ? ', type ' + br.bis : '') +
          (br.role !== null ? ', ' + br.role + ' view' : '');
        return verbs[p.name] + args[0] + ' → ' + args[1] + tail + style + '.';
      }
      case 'text': {
        var tx = parseNum(args[0]), ty = parseNum(args[1]);
        if (tx === null || ty === null) return 'x and y must be numbers (mm) — usage: ' + spec.usage;
        return 'Write "' + args.slice(2).join(' ') + '" at ' + fmtPt(tx, ty) + ' mm.';
      }
      case 'polygon':
        for (var g = 0; g < args.length; g++) {
          var gpv = previewNeedPoint(ctx, args[g]);
          if (gpv.fail) return gpv.fail;
        }
        return 'Draw ' + args.length + '-sided polygon (' + args.join(', ') + ').';
      case 'polyline':
        for (var pl = 0; pl < args.length; pl++) {
          var opv = previewNeedPoint(ctx, args[pl]);
          if (opv.fail) return opv.fail;
        }
        return 'Draw open chain (' + args.join(', ') + ').';
      case 'rename':
        if (!hasEntity(ctx, args[0])) return 'Unknown point "' + args[0] + '".';
        if (args[2] === 'members') return 'Assign station members "' + args[1] + '" to "' + args[0] + '".';
        if (args[2] === 'linked') return 'Rename the selected member across its linked stations to "' + args[1] + '".';
        if (args[2] && args[2] !== 'local') return 'Choose local, linked, or members.';
        if (args[0] !== args[1] && hasEntity(ctx, args[1])) return 'There is already a point "' + args[1] + '".';
        return 'Rename "' + args[0] + '" to "' + args[1] + '".';
      case 'delete':
        if (!hasEntity(ctx, args[0])) return 'Unknown point "' + args[0] + '".';
        return 'Delete "' + args[0] + '" and its lines.';
      case 'style': {
        if (!hasEntity(ctx, args[0])) return 'Unknown entity "' + args[0] + '".';
        if (!isBis(args[1])) {
          return '"' + args[1] + '" is not a BIS type (A B E G H K) — usage: ' + spec.usage;
        }
        if (args.length > 2 && normRole(args[2]) === null) {
          return 'Role must be one of plan elevation both profile.';
        }
        var srole = args.length > 2 ? ', ' + normRole(args[2]) + ' view' : '';
        return 'Restyle "' + args[0] + '" as type ' + String(args[1]).toUpperCase() + srole + '.';
      }
      case 'auxframe':
        return 'Declare auxiliary frame "' + args[0] + '" on the XY datum.';
      case 'profile':
        return 'Set the side-view coordinate frame on the XY datum.';
      case 'datum': {
        if (args.length === 1) return 'Usage: ' + spec.usage;
        if (args.length === 2) {
          var d1 = parseNum(args[0]), d2 = parseNum(args[1]);
          if (d1 === null || d2 === null) return 'x1 and x2 must be numbers (mm) — usage: ' + spec.usage;
          if (d1 === d2) return 'x1 and x2 must differ.';
          return 'Draw the XY datum from ' + d1 + ' to ' + d2 + ' mm.';
        }
        return 'Draw the XY datum from -30 to 30 mm.';
      }
      case 'clear':
        return 'Empty the sheet.';
      case 'undo':
        return 'Undo the last sheet change.';
      case 'demo':
        if (DEMOS.indexOf(args[0].toLowerCase()) === -1) {
          return 'Unknown demo "' + args[0] + '" — one of: ' + DEMOS.join(', ') + '.';
        }
        return 'Load the "' + args[0].toLowerCase() + '" demo sheet.';
      case 'tutorial':
        if (TUTS.indexOf(args[0].toLowerCase()) === -1) {
          return 'Unknown tutorial "' + args[0] + '" — one of: ' + TUTS.join(', ') + '.';
        }
        return 'Start the "' + args[0].toLowerCase() + '" tutorial.';
      case 'check':
        return 'Grade hidden verdicts and claims.';
      case 'mode':
        if (MODES.indexOf(args[0].toLowerCase()) === -1) {
          return 'Mode must be edit or view.';
        }
        return 'Switch to ' + args[0].toLowerCase() + ' mode.';
      default:
        return 'Usage: ' + spec.usage;
    }
  }

  function previewRound(name, args, ctx) {
    var usage = specOf(name).usage;
    if (name === 'ellipse') return previewEllipse(args, ctx, usage);
    var extra = name === 'circle' ? 0 : 2;
    if (args.length < 2 + extra) return 'Usage: ' + usage;
    var named = !isNumTok(args[0]);
    var need = named ? 2 + extra : 3 + extra;
    var br = parseBisRole(args.slice(need), name === 'circle');
    if (br.error !== '') return br.error + ' — usage: ' + usage;
    var style = (br.bis !== null ? ', type ' + br.bis : '') +
      (br.role !== null ? ', ' + br.role + ' view' : '');
    if (named) {
      var centre = previewNeedPoint(ctx, args[0], br.roleKey);
      if (centre.fail) return centre.fail;
      var r = parseNum(args[1]);
      if (r === null || r <= 0) return 'Radius must be a number above 0 (mm).';
      if (name === 'arc') {
        var aa1 = parseNum(args[2]), aa2 = parseNum(args[3]);
        if (aa1 === null || aa2 === null) return 'Angles must be numbers (degrees) — usage: ' + usage;
        if (arcSweepDeg(aa1, aa2) === 0) {
          return 'Angles differ by a full turn — a 0° arc draws nothing (use /circle for a full ring).';
        }
        return 'Draw arc at "' + args[0] + '" r ' + r + ' mm, ' + aa1 + '° to ' + aa2 + '°' + style + '.';
      }
      return 'Draw circle at "' + args[0] + '" r ' + r + ' mm' + style + '.';
    }
    var nums = [];
    for (var i = 0; i < 3 + extra; i++) {
      var n = parseNum(args[i]);
      if (n === null) return 'Usage: ' + usage;
      nums.push(n);
    }
    if (nums[2] <= 0) return 'Radius must be a number above 0 (mm).';
    if (name === 'arc') {
      if (arcSweepDeg(nums[3], nums[4]) === 0) {
        return 'Angles differ by a full turn — a 0° arc draws nothing (use /circle for a full ring).';
      }
      return 'Draw arc at ' + fmtPt(nums[0], nums[1]) + ' r ' + nums[2] +
        ' mm, ' + nums[3] + '° to ' + nums[4] + '°' + style + '.';
    }
    return 'Draw circle at ' + fmtPt(nums[0], nums[1]) + ' r ' + nums[2] + ' mm' + style + '.';
  }



  function previewEllipse(args, ctx, usage) {
    if (args.length < 3) return 'Usage: ' + usage;
    var named = !isNumTok(args[0]);
    var need = named ? 3 : 4;
    if (args.length < need) return 'Usage: ' + usage;
    var split = splitCountTail(args.slice(need));
    var segs = split.num === null ? ELLIPSE_SEGS_DEFAULT : split.num;
    if (split.num !== null &&
        (Math.floor(split.num) !== split.num || segs < ELLIPSE_SEGS_MIN ||
          segs > ELLIPSE_SEGS_MAX)) {
      return 'Segments must be a whole number from ' + ELLIPSE_SEGS_MIN +
        ' to ' + ELLIPSE_SEGS_MAX + ' — usage: ' + usage;
    }
    var br = parseBisRole(split.rest, true);
    if (br.error !== '') return br.error + ' — usage: ' + usage;
    var style = (br.bis !== null ? ', type ' + br.bis : '') +
      (br.role !== null ? ', ' + br.role + ' view' : '');
    var at, rx, ry;
    if (named) {
      var centre = previewNeedPoint(ctx, args[0], br.roleKey);
      if (centre.fail) return centre.fail;
      rx = parseNum(args[1]);
      ry = parseNum(args[2]);
      at = 'at "' + args[0] + '"';
    } else {
      var cx = parseNum(args[0]), cy = parseNum(args[1]);
      rx = parseNum(args[2]);
      ry = parseNum(args[3]);
      if (cx === null || cy === null) return 'Usage: ' + usage;
      at = 'at ' + fmtPt(cx, cy);
    }
    if (rx === null || ry === null || rx <= 0 || ry <= 0) {
      return 'rx and ry must be numbers above 0 (mm).';
    }
    return 'Draw ellipse ' + at + ' ' + rx + ' × ' + ry + ' mm (' + segs + ' segments)' + style + '.';
  }

  function previewConic(args, ctx, usage) {
    var named = !isNumTok(args[0]);
    var need = named ? 5 : 6;
    if (args.length < need) return 'Usage: ' + usage;
    var split = splitCountTail(args.slice(need));
    var segs = split.num === null ? ELLIPSE_SEGS_DEFAULT : split.num;
    if (split.num !== null &&
        (Math.floor(split.num) !== split.num || segs < ELLIPSE_SEGS_MIN ||
          segs > ELLIPSE_SEGS_MAX)) {
      return 'Segments must be a whole number from ' + ELLIPSE_SEGS_MIN +
        ' to ' + ELLIPSE_SEGS_MAX + ' — usage: ' + usage;
    }
    var br = parseBisRole(split.rest, true);
    if (br.error !== '') return br.error + ' — usage: ' + usage;
    var style = (br.bis !== null ? ', type ' + br.bis : '') +
      (br.role !== null ? ', ' + br.role + ' view' : '');
    var at;
    if (named) {
      var centre = previewNeedPoint(ctx, args[0], br.roleKey);
      if (centre.fail) return centre.fail;
      at = 'at "' + args[0] + '"';
    } else {
      var cx = parseNum(args[0]), cy = parseNum(args[1]);
      if (cx === null || cy === null) return 'Usage: ' + usage;
      at = 'at ' + fmtPt(cx, cy);
    }
    var base = named ? 1 : 2, ax = parseNum(args[base]), ay = parseNum(args[base+1]);
    var bx = parseNum(args[base+2]), by = parseNum(args[base+3]);
    if (ax === null || ay === null || bx === null || by === null)
      return 'Conic basis vectors must be numbers (mm) — usage: ' + usage;
    if (Math.abs(ax*by-ay*bx) <= 1e-12*Math.max(1, Math.hypot(ax,ay)*Math.hypot(bx,by)))
      return 'The two conic basis vectors must be independent.';
    return 'Draw analytic ellipse ' + at + ' (' + segs + ' segments)' + style + '.';
  }

  function previewThrough(name, args, ctx, spec) {
    var tokens = args.slice(), role = null, closed = false;
    var roleSpec = throughRole(name, tokens[tokens.length - 1]);
    if (roleSpec) {
      tokens.pop();
      role = roleSpec.key;
    }
    if (tokens[tokens.length - 1] === 'closed') { closed = true; tokens.pop(); }
    if (name !== 'curve-through' && (closed || tokens.length !== 3)) {
      return 'Usage: ' + spec.usage;
    }
    if (!tokens.length) return 'Usage: ' + spec.usage;
    for (var i = 0; i < tokens.length; i++) {
      var found = previewNeedPoint(ctx, tokens[i], role, { sameView: true });
      if (found.fail) return found.fail;
    }
    return spec.hint + ' — ' + spec.usage;
  }

  function previewHatch(args, ctx) {
    var usage = specOf('hatch').usage;
    if (args.length < 5) return 'Usage: ' + usage;
    var nums = [];
    for (var i = 0; i < 5; i++) {
      var n = parseNum(args[i]);
      if (n === null) return 'Usage: ' + usage;
      nums.push(n);
    }
    if (nums[0] === nums[2] || nums[1] === nums[3]) {
      return 'The hatch area needs width and height (x1 ≠ x2, y1 ≠ y2).';
    }
    if (nums[4] <= 0) return 'Spacing must be a number above 0 (mm).';
    var split = splitCountTail(args.slice(5));
    var angle = split.num === null ? HATCH_ANGLE_DEFAULT : split.num;
    var br = parseBisRole(split.rest);
    if (br.error !== '') return br.error + ' — usage: ' + usage;
    var style = (br.bis !== null ? ', type ' + br.bis : '') +
      (br.role !== null ? ', ' + br.role + ' view' : '');
    var lines;
    try { lines = hatchLines(nums[0], nums[1], nums[2], nums[3], nums[4], angle, HATCH_LINES_MAX); }
    catch (err) { return err.message; }
    if (lines.length === 0) {
      return 'That spacing leaves no lines inside the area — tighten the spacing.';
    }
    if (lines.length > HATCH_LINES_MAX) {
      return 'That spacing needs ' + lines.length + ' lines (over ' +
        HATCH_LINES_MAX + ') — widen the spacing or shrink the area.';
    }
    return 'Hatch ' + fmtPt(nums[0], nums[1]) + '–' + fmtPt(nums[2], nums[3]) +
      ' with ' + lines.length + ' lines at ' + angle + '°' + style + '.';
  }

  function helpText(name) {
    if (name === undefined || name === null || name === '') {
      var lines = ['Commands (' + COMMANDS.length + '):'];
      for (var i = 0; i < COMMANDS.length; i++) {
        lines.push('/' + COMMANDS[i].name + ' — ' + COMMANDS[i].hint + '.');
      }
      lines.push('Type /help <command> for exact usage.');
      lines.push("'/ <words>' — describe a drawing in plain words (needs login).");
      lines.push("'/auto <words>' — draw a model from words (teachers).");
      return lines.join('\n');
    }
    var spec = specOf(name);
    if (spec === null) return 'Unknown command "/' + name + '" — try /help.';
    return spec.usage + '\n' + spec.hint + '.';
  }

  function findEntity(table, name) {
    var list = table.list();
    var exact = list.find(function (e) { return e.id === name; });
    if (exact) return exact;
    var matches = list.filter(function (e) { return e.name === name || e.caption === name; });
    return matches.length === 1 ? matches[0] : null;
  }

  function viewOfPoint(p) {
    if (p.viewRole === 'AUX') return 'AUX:' + String((p.meta && p.meta.frameId) || '');
    if (p.viewRole === 'PLAN' || p.viewRole === 'ELEVATION' || p.viewRole === 'PROFILE') {
      return p.viewRole;
    }
    return roleForY(p.y);
  }

  function throughRole(name, token) {
    var role = parseRoleSpec(token);
    if (!role || role.viewRole === 'BOTH' ||
        (role.viewRole === 'AUX' && name !== 'curve-through')) return null;
    return role;
  }

  function pointInRole(p, role) {
    if (!role || role === 'BOTH') return true;
    if (p.viewRole === 'BOTH') return true;
    return viewOfPoint(p) === role;
  }

  function baseLabel(text) {
    return String(text === undefined || text === null ? '' : text)
      .replace(/['’′]+$/, '').trim();
  }

  function labelParts(text) {
    return String(text === undefined || text === null ? '' : text).split(',')
      .map(function (part) {
        var s = part.trim();
        if (/^\(.*\)$/.test(s)) s = s.slice(1, -1).trim();
        return s;
      }).filter(Boolean);
  }

  function pointBaseLabels(p) {
    var out = [];
    function add(value) {
      labelParts(value).forEach(function (part) {
        var b = baseLabel(part);
        if (b !== '' && out.indexOf(b) === -1) out.push(b);
      });
    }
    add(p.name);
    add(p.caption);
    ((p.meta && p.meta.members) || []).forEach(function (m) { add(m.name); });
    return out;
  }

  function pointExactLabels(p) {
    var out = [];
    function add(value) {
      if (value !== undefined && value !== null && String(value) !== '' &&
          out.indexOf(String(value)) === -1) out.push(String(value));
    }
    add(p.name);
    add(p.caption);
    return out;
  }

  function pointMemberLabels(p) {
    var out = [];
    ((p.meta && p.meta.members) || []).forEach(function (m) {
      if (m && typeof m.name === 'string' && out.indexOf(m.name) === -1) out.push(m.name);
    });
    return out;
  }

  function uniquePoints(points) {
    var seen = Object.create(null), out = [];
    points.forEach(function (p) {
      if (!p || seen[p.id]) return;
      seen[p.id] = true;
      out.push(p);
    });
    return out;
  }

  function isAnnotationStroke(type, bis, meta) {
    if (type === 'DIMENSION') return true;
    if (['G', 'H', 'K'].indexOf(bis) !== -1) return true;
    var kind = meta && meta.kind;
    if (kind && ['axis', 'locus', 'projector', 'construction'].indexOf(kind) !== -1) return true;
    return !!(meta && meta.reconstructionRole === 'construction');
  }

  function resolvePoint(table, name, role, options) {
    options = options || {};
    var annotation = options.annotation === true;
    var list = table.list();
    var points = list.filter(function (e) { return e.type === 'POINT'; });
    var byId = list.find(function (e) { return e.id === name; });
    if (byId) {
      if (byId.type !== 'POINT') return { fail: 'not-a-point' };
      if (!pointInRole(byId, role) && !annotation) {
        return { fail: 'view', view: viewOfPoint(byId) };
      }
      return { ent: byId };
    }
    var scoped = points.filter(function (p) { return pointInRole(p, role); });
    var scopedRole = role && role !== 'BOTH';
    var tiers = scopedRole ? [
      scoped.filter(function (p) {
        return pointExactLabels(p).indexOf(name) !== -1 ||
          pointMemberLabels(p).indexOf(name) !== -1;
      }),
      baseLabel(name) === String(name).trim() ?
        scoped.filter(function (p) {
          return pointBaseLabels(p).indexOf(baseLabel(name)) !== -1;
        }) : []
    ] : [
      scoped.filter(function (p) { return pointExactLabels(p).indexOf(name) !== -1; }),
      scoped.filter(function (p) { return pointMemberLabels(p).indexOf(name) !== -1; }),
      baseLabel(name) === String(name).trim() ?
        scoped.filter(function (p) {
          return pointBaseLabels(p).indexOf(baseLabel(name)) !== -1;
        }) : []
    ];
    var tier = [];
    for (var ti = 0; ti < tiers.length; ti++) {
      tier = uniquePoints(tiers[ti]);
      if (tier.length) break;
    }
    if (tier.length === 1) return { ent: tier[0] };
    if (tier.length > 1) return { fail: 'ambiguous' };
    if (scopedRole) {
      var elsewhere = uniquePoints(points.filter(function (p) {
        return pointExactLabels(p).indexOf(name) !== -1 ||
          pointMemberLabels(p).indexOf(name) !== -1 ||
          (baseLabel(name) === String(name).trim() &&
            pointBaseLabels(p).indexOf(baseLabel(name)) !== -1);
      }));
      if (annotation) {
        if (elsewhere.length === 1) return { ent: elsewhere[0] };
        if (elsewhere.length > 1) return { fail: 'ambiguous', sheet: true };
        return { fail: 'unknown' };
      }
      if (elsewhere.length) {
        var views = [];
        elsewhere.forEach(function (p) {
          var v = viewOfPoint(p);
          if (views.indexOf(v) === -1) views.push(v);
        });
        return { fail: 'view', view: views.join('/') };
      }
    }
    return { fail: 'unknown' };
  }

  function resolvePointFailure(result, name, role, options) {
    options = options || {};
    if (result.fail === 'not-a-point') {
      return fail('"' + name + '" is not a point.');
    }
    if (result.fail === 'ambiguous') {
      if (result.sheet === true) {
        return fail('"' + name + '" matches more than one sheet point — use an entity ID.');
      }
      return fail(role && role !== 'BOTH' ?
        ('"' + name + '" matches more than one point in the ' + role +
          ' view — use an entity ID.') :
        ('"' + name + '" matches more than one point — name a view or use an entity ID.'));
    }
    if (result.fail === 'view') {
      if (options.sameView === true) {
        return fail('"' + name + '" is in the ' + result.view + ' view, not ' +
          role + ' — all defining points must belong to the same declared view.');
      }
      return fail('"' + name + '" is in the ' + result.view + ' view, not ' +
        role + '.');
    }
    return fail('Unknown point "' + name + '" — place it first with /point.');
  }




  function displayName(ent) {
    if (!ent || typeof ent !== 'object') {
      throw new Error('educad-command: entity needed');
    }
    if (ent.caption !== undefined && ent.caption !== null &&
        String(ent.caption) !== '') {
      return String(ent.caption);
    }
    if (ent.name !== undefined && ent.name !== null) return String(ent.name);
    return '';
  }



  function pointMap(entities) {
    if (!Array.isArray(entities)) {
      throw new Error('educad-command: entities must be an array');
    }
    var map = {};
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e || e.type !== 'POINT') continue;
      var label = displayName(e);
      if (entities.filter(function (p) { return p && p.type === 'POINT' && displayName(p) === label; }).length > 1) label = e.id;
      if (label === '' || Object.prototype.hasOwnProperty.call(map, label)) continue;
      Object.defineProperty(map, label, { value: { x: e.x, y: e.y }, enumerable: true, writable: true, configurable: true });
    }
    if (!Object.prototype.hasOwnProperty.call(map, POINT_CONTEXT_KEY)) {
      Object.defineProperty(map, POINT_CONTEXT_KEY, {
        value: entities.filter(function (e) { return e && e.type === 'POINT'; }),
        enumerable: false, writable: false, configurable: true
      });
    }
    return map;
  }




  function previewCandidates(ctx) {
    if (!ctx) return [];
    var map = ctx.points;
    if (map && typeof map === 'object' && !Array.isArray(map) &&
        Array.isArray(map[POINT_CONTEXT_KEY])) {
      return map[POINT_CONTEXT_KEY].slice();
    }
    var out = [];
    function add(name, value) {
      if (value && typeof value === 'object' && value.type === 'POINT') {
        out.push(value);
        return;
      }
      var point = { type: 'POINT', id: String(name), name: String(name),
        caption: String(name), x: null, y: null, viewRole: 'BOTH', meta: {} };
      if (value && typeof value === 'object') {
        if (typeof value.x === 'number') point.x = value.x;
        if (typeof value.y === 'number') point.y = value.y;
        if (value.viewRole) point.viewRole = value.viewRole;
        if (value.meta) point.meta = value.meta;
        if (value.id) point.id = value.id;
        if (value.name) point.name = value.name;
        if (value.caption) point.caption = value.caption;
      }
      out.push(point);
    }
    if (Array.isArray(map)) {
      map.forEach(function (item) {
        if (item && typeof item === 'object') add(item.id || item.name, item);
        else add(item, null);
      });
    } else if (map && typeof map === 'object') {
      Object.keys(map).forEach(function (name) { add(name, map[name]); });
    }
    return out;
  }

  function previewNeedPoint(ctx, name, role, options) {
    var found = resolvePoint({ list: function () { return previewCandidates(ctx); } },
      name, role, options);
    if (found.fail) {
      return { fail: resolvePointFailure(found, name, role, options).message };
    }
    return { ent: found.ent };
  }

  function entityMap(entities) {
    if (!Array.isArray(entities)) {
      throw new Error('educad-command: entities must be an array');
    }
    var map = {};
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (!e || typeof e.id !== 'string') continue;
      var label = displayName(e);
      if (entities.filter(function (p) { return p && typeof p.id === 'string' && displayName(p) === label; }).length > 1) label = e.id;
      if (label === '' || Object.prototype.hasOwnProperty.call(map, label)) continue;
      Object.defineProperty(map, label, { value: e.id, enumerable: true, writable: true, configurable: true });
    }
    return map;
  }

  function quoteIfNeeded(word) {
    return /[\s"]/.test(word) ? '"' + word + '"' : word;
  }

  function roleForY(y) { return y >= 0 ? 'ELEVATION' : 'PLAN'; }




  function execute(input, env) {
    if (!env || typeof env !== 'object' || !env.table) {
      throw new Error('educad-command: env.table needed');
    }
    if (typeof input !== 'string') return fail('Type /help for the command list.');
    var table = env.table;
    var p = parse(input);
    if (!p.ok) return fail(p.message);
    var spec = specOf(p.name);
    var args = p.args;

    var readOnly = env.readOnly === true;
    var mutating = ['curve-through', 'circle-through', 'arc-through', 'point', 'line', 'ray', 'xline', 'circle', 'arc', 'text',
      'dimension', 'polygon', 'polyline', 'ellipse', 'conic', 'hatch', 'rename',
      'delete', 'style', 'section', 'section-boundary', 'datum', 'auxframe', 'clear', 'undo', 'demo',
      'tutorial'].indexOf(p.name) !== -1;


    if (readOnly && mutating) {
      return fail('View mode is read-only — /mode edit to draw.');
    }

    function arity(min, max) {
      if (args.length < min) return fail('Usage: ' + spec.usage);
      if (max !== -1 && args.length > max) {
        return fail('Too many arguments — usage: ' + spec.usage);
      }
      return null;
    }

    function needPoint(name, role, options) {
      var found = resolvePoint(table, name, role, options);
      if (found.fail) return { fail: resolvePointFailure(found, name, role, options) };
      return { ent: found.ent };
    }

    function create(type, opts) {
      try {
        return { ent: table.create(type, opts) };
      } catch (err) {
        return { fail: fail('Could not draw: ' + (err && err.message ? err.message : String(err))) };
      }
    }

    switch (p.name) {
      case 'help': {
        var bad = arity(0, 1);
        if (bad) return bad;
        if (args.length === 1 && specOf(args[0]) === null) {
          return fail('Unknown command "/' + args[0] + '" — try /help.');
        }
        return { ok: true, message: helpText(args[0] || ''), ids: [] };
      }
      case 'point': {
        var bp = arity(3, 4);
        if (bp) return bp;
        if (!args[0].trim()) return fail('Point name must not be empty.');
        var px = parseNum(args[1]), py = parseNum(args[2]);
        if (px === null || py === null) {
          return fail('x and y must be numbers (mm) — usage: ' + spec.usage);
        }
        if (findEntity(table, args[0]) !== null) {
          return fail('There is already a point "' + args[0] + '".');
        }
        var prole = roleForY(py), pframeId = null;
        if (args.length === 4) {
          var pspec = parseRoleSpec(args[3]);
          if (pspec === null) {
            return fail('Role must be one of plan elevation both profile aux:<id>.');
          }
          prole = pspec.viewRole;
          pframeId = pspec.frameId;
        }
        var pmeta = pframeId ? { frameId: pframeId } : {};
        var made = create('POINT', { x: px, y: py, name: args[0],
          caption: args[0], showLabel: true, bisCode: 'B',
          viewRole: prole, meta: pmeta });
        if (made.fail) return made.fail;
        return { ok: true,
          message: 'Placed point "' + args[0] + '" at ' + fmtPt(px, py) + ' mm.',
          ids: [made.ent.id] };
      }
      case 'line':
      case 'ray':
      case 'xline':
      case 'dimension': {
        var bl = arity(2, p.name === 'dimension' ? 6 : 4);
        if (bl) return bl;
        var xdt = p.name === 'dimension' ? parseDimensionTail(args.slice(2)) : null;
        var xbr = xdt || parseBisRole(args.slice(2), true);
        if (xbr.error !== '') return fail(xbr.error + ' — usage: ' + spec.usage);
        var bis = xbr.bis !== null ? xbr.bis : 'B';
        var xrole = xbr.role !== null ? xbr.role : 'BOTH';
        var xroleKey = xbr.roleKey !== null ? xbr.roleKey : 'BOTH';
        var xtypes = { line: 'SEGMENT', ray: 'RAY', xline: 'LINE',
          dimension: 'DIMENSION' };
        var xannotation = isAnnotationStroke(xtypes[p.name], bis, null);
        var xopts = xannotation ? { annotation: true } : undefined;
        var la = needPoint(args[0], xroleKey, xopts);
        if (la.fail) return la.fail;
        var lb = needPoint(args[1], xroleKey, xopts);
        if (lb.fail) return lb.fail;
        if (la.ent.id === lb.ent.id) {
          return fail('Two different points needed — "' + args[0] + '" twice is one point.');
        }
        var xverbs = { line: 'Drew segment ', ray: 'Drew ray ',
          xline: 'Drew construction line ', dimension: 'Drew dimension ' };
        var xmeta = { refs: [la.ent.id, lb.ent.id] };
        if (xbr.frameId) xmeta.frameId = xbr.frameId;
        var xcaption = p.name === 'dimension' ?
          String(Math.round(Math.sqrt(Math.pow(lb.ent.x - la.ent.x, 2) +
            Math.pow(lb.ent.y - la.ent.y, 2)) * 1000) / 1000) : '';
        if (p.name === 'dimension' && xdt && xdt.value !== null) {
          xmeta.valueMm = xdt.value;
          xmeta.dimensionMode = 'driving';
          if (xdt.axis) xmeta.dimensionAxis = xdt.axis;
          xcaption = String(xdt.value);
        }
        var seg = create(xtypes[p.name],
          { x: la.ent.x, y: la.ent.y, x2: lb.ent.x,
            y2: lb.ent.y, bisCode: bis, viewRole: xrole,
            caption: xcaption, showLabel: false, meta: xmeta });
        if (seg.fail) return seg.fail;
        return { ok: true,
          message: xverbs[p.name] + args[0] + ' → ' + args[1] + '.',
          ids: [seg.ent.id] };
      }
      case 'curve-through':
      case 'circle-through':
      case 'arc-through': {
        var tokens=args.slice(), closed=false;
        var curveView=throughRole(p.name,tokens[tokens.length-1]);
        if(curveView)tokens.pop();
        if(tokens[tokens.length-1]==='closed') {closed=true;tokens.pop();}
        if(p.name!=='curve-through' && (closed||tokens.length!==3)) return fail('Usage: '+spec.usage);
        var through=[];
        for(var ti=0;ti<tokens.length;ti++) {var found=needPoint(tokens[ti],curveView&&curveView.key,{sameView:true});if(found.fail)return found.fail;through.push(found.ent);}
        if(!through.length)return fail('Usage: '+spec.usage);
        curveView=curveView||throughRole(p.name,viewOfPoint(through[0]));
        if(!curveView || through.some(function(e){
          return e.viewRole!==curveView.viewRole||viewOfPoint(e)!==curveView.key;
        }))
          return fail('All defining points must belong to the same declared view.');
        try {
          var cm={refs:through.map(function(e){return e.id;}),throughRefs:through.map(function(e){return e.id;}),construction:p.name};
          if(curveView.frameId)cm.frameId=curveView.frameId;
          var options={bisCode:'A',viewRole:curveView.viewRole,meta:cm};
          if(p.name==='curve-through') {
            cm.curve=Parametric.interpolate(through,closed);
            options.x=through[0].x;options.y=through[0].y;
          } else {Object.assign(options,Parametric.throughCircle(through,p.name==='arc-through'));cm.throughDirection=options.throughDirection;}
          var made=create(p.name==='curve-through'?'CURVE':p.name==='circle-through'?'CIRCLE':'CIRCULAR_ARC',options);
          if(made.fail)return made.fail;
          return {ok:true,ids:[made.ent.id],message:p.name==='curve-through'?'Drew an interpolated '+(closed?'periodic':'natural')+' cubic curve through '+through.length+' points.':'Drew an exact '+(p.name==='circle-through'?'circle':'arc')+' through three points.'};
        } catch(error) {return fail(error.message);}
      }
      case 'circle':
      case 'arc': {
        var xextra = p.name === 'circle' ? 0 : 2;
        var xbad = arity(2 + xextra, 5 + xextra);
        if (xbad) return xbad;
        var xnoun = p.name === 'circle' ? 'CIRCLE' : 'CIRCULAR_ARC';
        var xnamed = !isNumTok(args[0]);
        var xneed = xnamed ? 2 + xextra : 3 + xextra;
        var xbr2 = parseBisRole(args.slice(xneed), p.name === 'circle');
        if (xbr2.error !== '') return fail(xbr2.error + ' — usage: ' + spec.usage);
        var xbis = xbr2.bis !== null ? xbr2.bis : 'A';
        var cx, cy, crr, crole, cref;
        if (xnamed) {
          var cc = needPoint(args[0], xbr2.roleKey);
          if (cc.fail) return cc.fail;
          crr = parseNum(args[1]);
          if (crr === null || crr <= 0) {
            return fail('Radius must be a number above 0 (mm).');
          }
          cx = cc.ent.x;
          cy = cc.ent.y;
          cref = cc.ent.id;
        } else {
          cx = parseNum(args[0]);
          cy = parseNum(args[1]);
          crr = parseNum(args[2]);
          if (cx === null || cy === null || crr === null || crr <= 0) {
            return fail('Usage: ' + spec.usage);
          }
          cref = null;
        }
        var aa1 = 0, aa2 = 0;
        if (p.name === 'arc') {
          var ai = xnamed ? 2 : 3;
          aa1 = parseNum(args[ai]);
          aa2 = parseNum(args[ai + 1]);
          if (aa1 === null || aa2 === null) {
            return fail('Angles must be numbers (degrees) — usage: ' + spec.usage);
          }
          if (arcSweepDeg(aa1, aa2) === 0) {
            return fail('Angles differ by a full turn — a 0° arc draws nothing (use /circle for a full ring).');
          }
        }
        var roundView = parseRoleSpec(xbr2.roleKey || (xnamed ? viewOfPoint(cc.ent) : roleForY(cy)));
        if (!roundView) return fail('Select a declared view for the curve.');
        if (roundView.viewRole === 'AUX' && p.name === 'arc')
          return fail('Use a principal view for circular arcs.');
        crole = roundView.viewRole;
        var roundMeta = cref !== null ? { refs: [cref], centerRef: cref } : {};
        if (roundView.frameId) roundMeta.frameId = roundView.frameId;
        var nc = create(xnoun, { x: cx, y: cy, radius: crr,
          startAngle: aa1, endAngle: aa2, bisCode: xbis, viewRole: crole,
          caption: '', showLabel: false,
          meta: roundMeta });
        if (nc.fail) return nc.fail;
        if (p.name === 'arc') {
          return { ok: true,
            message: xnamed ?
              ('Drew arc at "' + args[0] + '" r ' + crr + ' mm, ' + aa1 + '° to ' + aa2 + '°.') :
              ('Drew arc at ' + fmtPt(cx, cy) + ' r ' + crr + ' mm, ' + aa1 + '° to ' + aa2 + '°.'),
            ids: [nc.ent.id] };
        }
        return { ok: true,
          message: xnamed ?
            ('Drew circle at "' + args[0] + '" r ' + crr + ' mm.') :
            ('Drew circle at ' + fmtPt(cx, cy) + ' r ' + crr + ' mm.'),
          ids: [nc.ent.id] };
      }
      case 'text': {
        var bt = arity(3, -1);
        if (bt) return bt;
        var txx = parseNum(args[0]), tyy = parseNum(args[1]);
        if (txx === null || tyy === null) {
          return fail('x and y must be numbers (mm) — usage: ' + spec.usage);
        }
        var words = args.slice(2).join(' ');
        var te = create('TEXT', { x: txx, y: tyy, caption: words,
          showLabel: true, bisCode: 'B', viewRole: roleForY(tyy), meta: {} });
        if (te.fail) return te.fail;
        return { ok: true, message: 'Wrote "' + words + '".', ids: [te.ent.id] };
      }
      case 'polygon': {
        var bg = arity(3, -1);
        if (bg) return bg;
        var pts = [];
        for (var gi = 0; gi < args.length; gi++) {
          var gp = needPoint(args[gi]);
          if (gp.fail) return gp.fail;
          pts.push(gp.ent);
        }
        for (var di = 0; di < pts.length; di++) {
          var nx = pts[(di + 1) % pts.length];
          if (pts[di].id === nx.id || (pts[di].x === nx.x && pts[di].y === nx.y)) {
            return fail('Two different points needed — "' + args[di] + '" repeats.');
          }
        }
        var names = pts.map(function (e) { return e.id; });
        var ids = [];
        for (var ei = 0; ei < pts.length; ei++) {
          var a = pts[ei], b = pts[(ei + 1) % pts.length];
          var edge = create('SEGMENT', { x: a.x, y: a.y, x2: b.x, y2: b.y,
            bisCode: 'B', viewRole: 'BOTH', caption: '', showLabel: false,
            meta: { refs: [a.id, b.id], vertices: names.slice() } });
          if (edge.fail) return edge.fail;
          ids.push(edge.ent.id);
        }
        return { ok: true,
          message: 'Drew ' + pts.length + '-sided polygon (' + args.join(', ') + ').',
          ids: ids };
      }
      case 'polyline': {
        var bo = arity(2, -1);
        if (bo) return bo;
        var opts = [];
        for (var oi = 0; oi < args.length; oi++) {
          var op = needPoint(args[oi]);
          if (op.fail) return op.fail;
          opts.push(op.ent);
        }
        for (var oj = 0; oj + 1 < opts.length; oj++) {
          if (opts[oj].id === opts[oj + 1].id || (opts[oj].x === opts[oj + 1].x && opts[oj].y === opts[oj + 1].y)) {
            return fail('Two different points needed — "' + args[oj] + '" repeats.');
          }
        }
        var onames = opts.map(function (e) { return e.id; });
        var oids = [];
        for (var okk = 0; okk + 1 < opts.length; okk++) {
          var oa = opts[okk], ob = opts[okk + 1];
          var oedge = create('SEGMENT', { x: oa.x, y: oa.y, x2: ob.x, y2: ob.y,
            bisCode: 'B', viewRole: 'BOTH', caption: '', showLabel: false,
            meta: { refs: [oa.id, ob.id], vertices: onames.slice() } });
          if (oedge.fail) return oedge.fail;
          oids.push(oedge.ent.id);
        }
        return { ok: true,
          message: 'Drew open chain (' + args.join(', ') + ').',
          ids: oids };
      }
      case 'ellipse': {
        var be = arity(3, 7);
        if (be) return be;
        var enamed = !isNumTok(args[0]);
        var eneed = enamed ? 3 : 4;
        if (args.length < eneed) return fail('Usage: ' + spec.usage);
        var esplit = splitCountTail(args.slice(eneed));
        var esegs = esplit.num === null ? ELLIPSE_SEGS_DEFAULT : esplit.num;
        if (esplit.num !== null &&
            (Math.floor(esplit.num) !== esplit.num || esegs < ELLIPSE_SEGS_MIN ||
              esegs > ELLIPSE_SEGS_MAX)) {
          return fail('Segments must be a whole number from ' + ELLIPSE_SEGS_MIN +
            ' to ' + ELLIPSE_SEGS_MAX + ' — usage: ' + spec.usage);
        }
        var ebr = parseBisRole(esplit.rest, true);
        if (ebr.error !== '') return fail(ebr.error + ' — usage: ' + spec.usage);
        var ex, ey, erx, ery;
        if (enamed) {
          var ecc = needPoint(args[0], ebr.roleKey);
          if (ecc.fail) return ecc.fail;
          ex = ecc.ent.x;
          ey = ecc.ent.y;
          erx = parseNum(args[1]);
          ery = parseNum(args[2]);
        } else {
          ex = parseNum(args[0]);
          ey = parseNum(args[1]);
          erx = parseNum(args[2]);
          ery = parseNum(args[3]);
          if (ex === null || ey === null) return fail('Usage: ' + spec.usage);
        }
        if (erx === null || ery === null || erx <= 0 || ery <= 0) {
          return fail('rx and ry must be numbers above 0 (mm).');
        }
        var ebis = ebr.bis !== null ? ebr.bis : 'A';
        var ellipseView = parseRoleSpec(ebr.roleKey || (enamed ? viewOfPoint(ecc.ent) : roleForY(ey)));
        if (!ellipseView) return fail('Select a declared view for the ellipse.');
        var erole = ellipseView.viewRole;
        var ring = ellipseRing(ex, ey, erx, ery, esegs);
        var eids = [];
        for (var ei = 0; ei < ring.length; ei++) {
          var q = ring[ei];
          var qe = create('SEGMENT', { x: q[0], y: q[1], x2: q[2], y2: q[3],
            bisCode: ebis, viewRole: erole, caption: '', showLabel: false,
            meta: {} });
          if (qe.fail) return qe.fail;
          eids.push(qe.ent.id);
        }
        var egroup = eids[0];
        var ebatch = {};
        for (var ej = 0; ej < eids.length; ej++) {
          var edef = { group: egroup, kind: 'ellipse', exact: true,
            center: { x: ex, y: ey }, a: { x: erx, y: 0 }, b: { x: 0, y: ery },
            count: esegs, index: ej, role: erole,
            centerRef: enamed ? ecc.ent.id : null };
          var emeta = { ellipse: edef };
          if (ellipseView.frameId) emeta.frameId = ellipseView.frameId;
          if (enamed) emeta.centerRef = ecc.ent.id;
          ebatch[eids[ej]] = { meta: emeta };
        }
        table.updateMany(ebatch);
        return { ok: true,
          message: 'Drew ellipse ' + fmtPt(ex, ey) + ' ' + erx + ' × ' + ery +
            ' mm (' + esegs + ' segments).',
          ids: eids };
      }
      case 'conic': {
        var bc = arity(5, 10);
        if (bc) return bc;
        var cn = !isNumTok(args[0]);
        var cbase = cn ? 1 : 2;
        if (args.length < cbase + 4) return fail('Usage: ' + spec.usage);
        var csplit = splitCountTail(args.slice(cbase + 4));
        var csegs = csplit.num === null ? ELLIPSE_SEGS_DEFAULT : csplit.num;
        if (csplit.num !== null &&
            (Math.floor(csplit.num) !== csplit.num || csegs < ELLIPSE_SEGS_MIN ||
              csegs > ELLIPSE_SEGS_MAX)) {
          return fail('Segments must be a whole number from ' + ELLIPSE_SEGS_MIN +
            ' to ' + ELLIPSE_SEGS_MAX + ' — usage: ' + spec.usage);
        }
        var cbr = parseBisRole(csplit.rest, true);
        if (cbr.error !== '') return fail(cbr.error + ' — usage: ' + spec.usage);
        var cbx, cby, ccref = null, ccEnt = null;
        if (cn) {
          var cc = needPoint(args[0], cbr.roleKey);
          if (cc.fail) return cc.fail;
          cbx = cc.ent.x; cby = cc.ent.y; ccref = cc.ent.id; ccEnt = cc.ent;
        } else {
          cbx = parseNum(args[0]); cby = parseNum(args[1]);
          if (cbx === null || cby === null) return fail('Usage: ' + spec.usage);
        }
        var cax = parseNum(args[cbase]), cay = parseNum(args[cbase + 1]);
        var cbvx = parseNum(args[cbase + 2]), cbvy = parseNum(args[cbase + 3]);
        if (cax === null || cay === null || cbvx === null || cbvy === null)
          return fail('Conic basis vectors must be numbers (mm) — usage: ' + spec.usage);
        if (Math.abs(cax*cbvy - cay*cbvx) <=
            1e-12 * Math.max(1, Math.hypot(cax,cay) * Math.hypot(cbvx,cbvy))) {
          return fail('The two conic basis vectors must be independent.');
        }
        var cbis = cbr.bis !== null ? cbr.bis : 'A';
        var conicView = parseRoleSpec(cbr.roleKey || (cn ? viewOfPoint(ccEnt) : roleForY(cby)));
        if (!conicView) return fail('Select a declared view for the conic.');
        var crole = conicView.viewRole;
        var cring = basisRing(cbx, cby, {x:cax,y:cay}, {x:cbvx,y:cbvy}, csegs);
        var cids = [];
        for (var ci2 = 0; ci2 < cring.length; ci2++) {
          var cq = cring[ci2];
          var cqe = create('SEGMENT', { x: cq[0], y: cq[1], x2: cq[2], y2: cq[3],
            bisCode: cbis, viewRole: crole, caption: '', showLabel: false,
            meta: {} });
          if (cqe.fail) return cqe.fail;
          cids.push(cqe.ent.id);
        }
        var cgroup = cids[0], cbatch = {};
        for (var cj = 0; cj < cids.length; cj++) {
          var cdef = { group: cgroup, kind: 'ellipse', exact: true,
            center: { x: cbx, y: cby },
            a: { x: cax, y: cay }, b: { x: cbvx, y: cbvy },
            count: csegs, index: cj, role: crole, centerRef: ccref };
          var cmeta = { ellipse: cdef };
          if (conicView.frameId) cmeta.frameId = conicView.frameId;
          if (ccref) cmeta.centerRef = ccref;
          cbatch[cids[cj]] = { meta: cmeta };
        }
        table.updateMany(cbatch);
        return { ok: true,
          message: 'Drew analytic ellipse ' + fmtPt(cbx, cby) + ' (' +
            csegs + ' segments).',
          ids: cids };
      }
      case 'hatch': {
        var bh = arity(5, 8);
        if (bh) return bh;
        var hx1 = parseNum(args[0]), hy1 = parseNum(args[1]);
        var hx2 = parseNum(args[2]), hy2 = parseNum(args[3]);
        var hsp = parseNum(args[4]);
        if (hx1 === null || hy1 === null || hx2 === null || hy2 === null ||
            hsp === null) {
          return fail('Usage: ' + spec.usage);
        }
        if (hx1 === hx2 || hy1 === hy2) {
          return fail('The hatch area needs width and height (x1 ≠ x2, y1 ≠ y2).');
        }
        if (hsp <= 0) return fail('Spacing must be a number above 0 (mm).');
        var hsplit = splitCountTail(args.slice(5));
        var hang = hsplit.num === null ? HATCH_ANGLE_DEFAULT : hsplit.num;
        var hbr = parseBisRole(hsplit.rest);
        if (hbr.error !== '') return fail(hbr.error + ' — usage: ' + spec.usage);
        var hbis = hbr.bis !== null ? hbr.bis : 'B';
        var hrole = hbr.role !== null ? hbr.role : 'BOTH';
        var hlines;
        try { hlines = hatchLines(hx1, hy1, hx2, hy2, hsp, hang, HATCH_LINES_MAX); }
        catch (err) { return fail(err.message); }
        if (hlines.length === 0) {
          return fail('That spacing leaves no lines inside the area — tighten the spacing.');
        }
        if (hlines.length > HATCH_LINES_MAX) {
          return fail('That spacing needs ' + hlines.length + ' lines (over ' +
            HATCH_LINES_MAX + ') — widen the spacing or shrink the area.');
        }
        var hids = [];
        for (var hi = 0; hi < hlines.length; hi++) {
          var hl = hlines[hi];
          var he = create('SEGMENT', { x: hl[0], y: hl[1], x2: hl[2], y2: hl[3],
            bisCode: hbis, viewRole: hrole, caption: '', showLabel: false,
            meta: {} });
          if (he.fail) return he.fail;
          hids.push(he.ent.id);
        }
        return { ok: true,
          message: 'Hatched ' + fmtPt(hx1, hy1) + '–' + fmtPt(hx2, hy2) +
            ' with ' + hlines.length + ' lines at ' + hang + '°.',
          ids: hids };
      }
      case 'rename': {
        var br = arity(2, 4);
        if (br) return br;
        var scope = args[2] || 'local';
        if (['local', 'linked', 'members'].indexOf(scope) === -1) return fail('Choose local, linked, or members.');
        if (!args[1].trim()) return fail('New name must not be empty.');
        var ro = findEntity(table, args[0]);
        if (ro === null) return fail('Unknown point "' + args[0] + '".');
        if (scope === 'local' && table.list().some(function (e) { return e.id !== ro.id && (e.name === args[1] || e.caption === args[1]); })) {
          return fail('There is already a point "' + args[1] + '".');
        }
        try {
          if (ro.type === 'POINT' && getDrafting()) {
            if (scope === 'members') getDrafting().assignMembers(table, ro.id, args[1]);
            else getDrafting().renamePoint(table, ro.id, args[1], {renameScope: scope, memberId: args[3]});
          } else if (typeof table.update === 'function') {
            if (scope !== 'local') return fail('Member operations require a point station.');
            table.update(ro.id, { name: args[1], caption: args[1] });
          } else {
            ro.name = args[1];
            ro.caption = args[1];
          }
        } catch (err) {
          return fail('Could not rename: ' + (err && err.message ? err.message : String(err)));
        }
        return { ok: true,
          message: 'Renamed "' + args[0] + '" to "' + args[1] + '".',
          ids: [ro.id] };
      }
      case 'delete': {
        var bd = arity(1, 1);
        if (bd) return bd;
        var del = findEntity(table, args[0]);
        if (del === null) return fail('Unknown point "' + args[0] + '".');
        if (del.locked) return fail('"' + args[0] + '" is locked.');
        var gone;
        try {
          if (typeof table.removeCascade === 'function') {
            gone = table.removeCascade(del.id);
          } else {
            table.remove(del.id);
            gone = [del.id];
          }
        } catch (err) {
          return fail('Could not delete: ' + (err && err.message ? err.message : String(err)));
        }
        return { ok: true,
          message: gone.length > 1 ?
            ('Deleted "' + args[0] + '" and ' + (gone.length - 1) + ' dependent(s).') :
            ('Deleted "' + args[0] + '".'),
          ids: gone };
      }
      case 'style': {
        var bs = arity(2, 3);
        if (bs) return bs;
        var se = findEntity(table, args[0]);
        if (se === null) return fail('Unknown entity "' + args[0] + '".');
        if (!isBis(args[1])) {
          return fail('"' + args[1] + '" is not a BIS type (A B E G H K) — usage: ' + spec.usage);
        }
        var patch = { bisCode: String(args[1]).toUpperCase() };
        if (args.length === 3) {
          if (normRole(args[2]) === null) {
            return fail('Role must be one of plan elevation both profile.');
          }
          patch.viewRole = normRole(args[2]);
        }
        try {
          table.update(se.id, patch);
        } catch (err) {
          return fail('Could not restyle: ' + (err && err.message ? err.message : String(err)));
        }
        return { ok: true,
          message: patch.viewRole !== undefined ?
            ('Restyled "' + args[0] + '" as type ' + patch.bisCode + ', ' + patch.viewRole + ' view.') :
            ('Restyled "' + args[0] + '" as type ' + patch.bisCode + '.'),
          ids: [se.id] };
      }
      case 'auxframe': {
        var afArity = arity(10, 12);
        if (afArity) return afArity;
        if (!ViewFrame) return fail('Auxiliary frame support is unavailable.');
        var afNums = args.slice(1).map(parseNum);
        if (afNums.some(function (v) { return v === null; }))
          return fail('Auxiliary frame geometry must be numeric.');
        var afRaw = {
          id: args[0], origin: { x: afNums[0], y: afNums[1], z: afNums[2] },
          n: { x: afNums[3], y: afNums[4], z: afNums[5] },
          u: { x: afNums[6], y: afNums[7], z: afNums[8] },
          sheet: { x: afNums.length > 9 ? afNums[9] : 0, y: afNums.length > 10 ? afNums[10] : 0 }
        };
        var afFrame;
        try { afFrame = ViewFrame.declaration(afRaw); }
        catch (error) { return fail(error.message); }
        var afDatum = table.list().find(function (e) { return e.type === 'DATUM_AXIS'; });
        if (!afDatum) return fail('Draw /datum before declaring an auxiliary frame.');
        var afMeta = Object.assign({}, afDatum.meta || {});
        var afList = Array.isArray(afMeta.viewFrames) ? afMeta.viewFrames.slice() : [];
        var afIndex = afList.findIndex(function (f) { return f && f.id === afFrame.id; });
        if (afIndex === -1) afList.push(afFrame); else afList[afIndex] = afFrame;
        afMeta.viewFrames = afList;
        table.update(afDatum.id, { meta: afMeta });
        return { ok: true, message: 'Declared auxiliary frame ' + afFrame.id + '.', ids: [afDatum.id] };
      }
      case 'section': {
        var scArity = arity(6, 8);
        if (scArity) return scArity;
        var scId = args[0], scView = normRole(args[1]), scSide = null, scRetain = false;
        if (scView === null || scView === 'BOTH')
          return fail('Section needs a plan, elevation or profile view.');
        var scNums = [2,3,4,5].map(function (i) { return parseNum(args[i]); });
        if (scNums.some(function (v) { return v === null; }))
          return fail('Section trace needs four numeric coordinates — usage: ' + spec.usage);
        for (var sci = 6; sci < args.length; sci++) {
          var scToken = String(args[sci]).toLowerCase();
          if (scToken === 'positive' || scToken === 'negative') scSide = scToken;
          else if (scToken === 'none') scSide = null;
          else if (scToken === 'retain') scRetain = true;
          else return fail('Section needs positive/negative or retain — usage: ' + spec.usage);
        }
        var scMade = create('SEGMENT', {
          x: scNums[0], y: scNums[1], x2: scNums[2], y2: scNums[3],
          bisCode: 'H', viewRole: scView, caption: '', showLabel: false,
          meta: { kind: 'section-trace', reconstructionRole: 'construction',
            section: { contract: 'cutting-plane-evidence-v1', id: scId,
              role: 'cutting-plane', view: scView, side: scSide,
              retain: scRetain, full: scRetain } }
        });
        if (scMade.fail) return scMade.fail;
        return { ok: true,
          message: 'Marked section ' + scId + ' on the ' + scView + ' trace' +
            (scSide ? ', retaining the ' + scSide + ' side' : '') +
            (scRetain ? ', retained split requested' : '') + '.',
          ids: [scMade.ent.id] };
      }
      case 'section-boundary': {
        var sbArity = arity(6, -1);
        if (sbArity) return sbArity;
        var sbId = args[0], sbRole = parseRoleSpec(args[1]);
        if (!sbRole || sbRole.viewRole === 'BOTH')
          return fail('Section boundary needs a plan, elevation, profile or auxiliary view.');
        var sbView = sbRole.viewRole;
        var sbMeta = sbRole.frameId ? { frameId: sbRole.frameId } : {};
        if (String(args[2]).toLowerCase() === 'circle') {
          var sbcX = parseNum(args[3]), sbcY = parseNum(args[4]), sbcR = parseNum(args[5]);
          if (sbcX === null || sbcY === null || sbcR === null || sbcR <= 0 || args.length !== 6)
            return fail('Section boundary circle needs x, y and a positive radius — usage: ' + spec.usage);
          var sbCircle = create('CIRCLE', {
            x: sbcX, y: sbcY, radius: sbcR, bisCode: 'A', viewRole: sbView,
            caption: '', showLabel: false,
            meta: Object.assign({}, sbMeta, { kind: 'section-boundary', reconstructionRole: 'construction',
              sectionBoundary: { contract: 'section-boundary-evidence-v1',
                planeId: sbId, role: 'section-boundary', view: sbView,
                shape: 'circle',
                center: {x:sbcX, y:sbcY}, radius: sbcR } })
          });
          if (sbCircle.fail) return sbCircle.fail;
          return { ok: true,
            message: 'Marked a circle section boundary for ' + sbId + '.',
            ids: [sbCircle.ent.id] };
        }
        var sbNums = args.slice(2).map(parseNum);
        if (sbNums.some(function (v) { return v === null; }) || sbNums.length % 2 !== 0 || sbNums.length < 6)
          return fail('Section boundary needs an even list of at least three coordinates — usage: ' + spec.usage);
        var sbPoints = [], sbIds = [], sbMade = [];
        for (var sbi = 0; sbi < sbNums.length; sbi += 2) {
          var sbPoint = create('POINT', {
            x: sbNums[sbi], y: sbNums[sbi + 1], name: '', caption: '',
            showLabel: false, bisCode: 'B', viewRole: sbView,
            meta: Object.assign({}, sbMeta, { kind: 'section-boundary-point', reconstructionRole: 'construction' })
          });
          if (sbPoint.fail) return sbPoint.fail;
          sbPoints.push(sbPoint.ent);
          sbIds.push(sbPoint.ent.id);
        }
        for (var sbj = 0; sbj < sbPoints.length; sbj++) {
          var sbA = sbPoints[sbj], sbB = sbPoints[(sbj + 1) % sbPoints.length];
          var sbSeg = create('SEGMENT', {
            x: sbA.x, y: sbA.y, x2: sbB.x, y2: sbB.y,
            bisCode: 'A', viewRole: sbView, caption: '', showLabel: false,
            meta: Object.assign({}, sbMeta, { kind: 'section-boundary', reconstructionRole: 'construction',
              refs: [sbA.id, sbB.id],
              sectionBoundary: { contract: 'section-boundary-evidence-v1',
                planeId: sbId, role: 'section-boundary', view: sbView,
                loopId: 'boundary:' + sbId + ':' + sbIds[0], points: sbIds,
                order: sbj, count: sbPoints.length } })
          });
          if (sbSeg.fail) return sbSeg.fail;
          sbMade.push(sbSeg.ent.id);
        }
        return { ok: true,
          message: 'Marked a ' + sbPoints.length + '-point section boundary for ' + sbId + '.',
          ids: sbMade };
      }
      case 'profile': {
        var pfArity = arity(2, 3);
        if (pfArity) return pfArity;
        var pfX = parseNum(args[0]), pfD = parseNum(args[1]), pfS = args.length === 3 ? parseNum(args[2]) : 1;
        if (pfX === null || pfD === null || (pfS !== 1 && pfS !== -1)) return fail('Profile needs numeric xRef/dRef and direction +1 or -1.');
        var pfDatum = table.list().find(function(e) {return e.type === 'DATUM_AXIS';});
        if (!pfDatum) return fail('Draw /datum before setting its /profile frame.');
        var pfMeta = Object.assign({},pfDatum.meta || {});
        pfMeta.draftingLayout = Object.assign({},pfMeta.draftingLayout || {},{xRef:pfX,dRef:pfD,s:pfS,three:true,side:pfS===1?'left':'right'});
        table.update(pfDatum.id,{meta:pfMeta});
        return {ok:true,message:'Set the side-view coordinate frame.',ids:[pfDatum.id]};
      }
      case 'datum': {
        var bdd = arity(0, 2);
        if (bdd) return bdd;
        if (args.length === 1) return fail('Usage: ' + spec.usage);
        var x1 = -30, x2 = 30;
        if (args.length === 2) {
          x1 = parseNum(args[0]);
          x2 = parseNum(args[1]);
          if (x1 === null || x2 === null) {
            return fail('x1 and x2 must be numbers (mm) — usage: ' + spec.usage);
          }
          if (x1 === x2) return fail('x1 and x2 must differ.');
        }
        var dm = create('DATUM_AXIS', { x: x1, y: 0, x2: x2, y2: 0,
          bisCode: 'G', viewRole: 'BOTH', caption: 'XY', showLabel: true,
          meta: { kind: 'XY' } });
        if (dm.fail) return dm.fail;
        return { ok: true, message: 'Drew the XY datum.', ids: [dm.ent.id] };
      }
      case 'clear': {
        var bc = arity(0, 0);
        if (bc) return bc;
        if (typeof env.clear === 'function') {
          env.clear();
        } else {
          table.clear();
        }
        return { ok: true, message: 'Sheet cleared.', ids: [] };
      }
      case 'undo': {
        var bu = arity(0, 0);
        if (bu) return bu;
        if (typeof env.undo !== 'function') {
          return fail('Undo is unavailable here.');
        }
        var undone = false;
        try {
          undone = env.undo();
        } catch (err) {
          return fail('Could not undo: ' + (err && err.message ? err.message : String(err)));
        }
        if (!undone) return fail('Nothing to undo.');
        return { ok: true, message: 'Undid the last sheet change.', ids: [] };
      }
      case 'demo': {
        var bdm = arity(1, 1);
        if (bdm) return bdm;
        var dn = String(args[0]).toLowerCase();
        if (DEMOS.indexOf(dn) === -1) {
          return fail('Unknown demo "' + args[0] + '" — one of: ' + DEMOS.join(', ') + '.');
        }
        if (env.allowDemo === false) {
          return fail('Demos are hidden — enable them in Settings.');
        }
        if (typeof env.loadDemo !== 'function') {
          return fail('Demos are unavailable here.');
        }
        env.loadDemo(dn);
        return { ok: true, message: 'Loaded the "' + dn + '" demo.', ids: [] };
      }
      case 'tutorial': {
        var btu = arity(1, 1);
        if (btu) return btu;
        var tn = String(args[0]).toLowerCase();
        if (TUTS.indexOf(tn) === -1) {
          return fail('Unknown tutorial "' + args[0] + '" — one of: ' + TUTS.join(', ') + '.');
        }
        if (env.allowTutorial === false) {
          return fail('Tutorials are hidden — enable them in Settings.');
        }
        if (typeof env.startTutorial !== 'function') {
          return fail('Tutorials are unavailable here.');
        }
        env.startTutorial(tn);
        return { ok: true, message: 'Started the "' + tn + '" tutorial.', ids: [] };
      }
      case 'check': {
        var bch = arity(0, 0);
        if (bch) return bch;
        if (typeof env.runVerify !== 'function') {
          return fail('Checking is unavailable here.');
        }
        env.runVerify();
        return { ok: true, message: 'Checked hidden verdicts and claims.', ids: [] };
      }
      case 'mode': {
        var bm = arity(1, 1);
        if (bm) return bm;
        var mn = String(args[0]).toLowerCase();
        if (MODES.indexOf(mn) === -1) return fail('Mode must be edit or view.');
        if (typeof env.setMode !== 'function') {
          return fail('Modes are unavailable here.');
        }
        env.setMode(mn);
        return { ok: true, message: 'Switched to ' + mn + ' mode.', ids: [] };
      }
      default:
        return fail('Usage: ' + spec.usage);
    }
  }

  return {
    VERSION: VERSION,
    WORLD_UNITS: WORLD_UNITS,
    COMMANDS: COMMANDS,
    COMMAND_NAMES: COMMAND_NAMES,
    DEMOS: DEMOS,
    TUTS: TUTS,
    MODES: MODES,
    BIS_CODES: BIS_CODES,
    ROLES: ROLES,
    ELLIPSE_SEGS_DEFAULT: ELLIPSE_SEGS_DEFAULT,
    ELLIPSE_SEGS_MIN: ELLIPSE_SEGS_MIN,
    ELLIPSE_SEGS_MAX: ELLIPSE_SEGS_MAX,
    HATCH_ANGLE_DEFAULT: HATCH_ANGLE_DEFAULT,
    HATCH_LINES_MAX: HATCH_LINES_MAX,
    splitArgs: splitArgs,
    displayName: displayName,
    pointMap: pointMap,
    entityMap: entityMap,
    arcSweepDeg: arcSweepDeg,
    ellipseRing: ellipseRing,
    hatchLines: hatchLines,
    isNaturalRequest: isNaturalRequest,
    parse: parse,
    suggest: suggest,
    preview: preview,
    helpText: helpText,
    execute: execute
  };
});

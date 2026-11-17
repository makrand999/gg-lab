(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./educad-parametric.js'));
  } else {
    root.EduCADEntities = factory(root.EduCADParametric);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (Parametric) {
  'use strict';



  var WORLD_UNITS = 'mm';
  var VERTICAL_EPS = 1e-9;
  var COINCIDENT_TOL_MM = 1e-6;
  var RADIUS_MIN_MM = 0.01;

  var ENTITY_TYPES = ['POINT', 'SEGMENT', 'LINE', 'RAY', 'CIRCLE', 'CIRCULAR_ARC', 'CURVE', 'DIMENSION', 'TEXT', 'DATUM_AXIS'];




  var TWO_POINT_TYPES = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION', 'DATUM_AXIS'];
  var VIEW_ROLES = ['PLAN', 'ELEVATION', 'BOTH', 'PROFILE'];
  var BIS_CODES = ['A', 'B', 'E', 'G', 'H', 'K'];
  var LAYER_STATIC = 'layer1';
  var LAYER_DYNAMIC = 'layer2';


  var BIS_STYLES = {
    A: { code: 'A', pattern: 'solid', dashMm: [], widthMm: 0.50, width: 'thick', use: 'visible outlines and edges' },
    B: { code: 'B', pattern: 'solid', dashMm: [], widthMm: 0.20, width: 'thin', use: 'dimension extension hatching leaders' },
    E: { code: 'E', pattern: 'dash', dashMm: [8, 4], widthMm: 0.35, width: 'thin', use: 'hidden outlines and edges' },
    G: { code: 'G', pattern: 'chain', dashMm: [12, 3, 2, 3], widthMm: 0.20, width: 'thin', use: 'centre lines axes pitch lines' },
    H: { code: 'H', pattern: 'chain', dashMm: [12, 3, 2, 3], widthMm: 0.20, width: 'thin', thickEnds: true, endWidthMm: 0.50, use: 'cutting planes special requirements' },
    K: { code: 'K', pattern: 'chain-double-dot', dashMm: [12, 3, 2, 3, 2, 3], widthMm: 0.20, width: 'thin', use: 'adjacent parts alternate positions centroids' }
  };


  var ARROW_LEN_MM = 3.5;
  var ARROW_WIDTH_MM = 1.167;
  var ARROW_RATIO = 3;
  var ARROW_FLIP_PX = 30;

  var _idCounter = 0;

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function assertTwoPoints(type, x, y, x2, y2) {
    if (TWO_POINT_TYPES.indexOf(type) === -1) return;
    assertFinite(x, y, x2, y2);
    var dx = x2 - x, dy = y2 - y;
    if (Math.sqrt(dx * dx + dy * dy) <= COINCIDENT_TOL_MM) {
      throw new Error(String(type) + ' needs two distinct points ' +
        '(endpoints coincide within ' + COINCIDENT_TOL_MM + ' mm)');
    }
  }

  function resetIdCounter() { _idCounter = 0; }

  function nextId() {
    _idCounter += 1;
    return 'E' + _idCounter;
  }

  function isValidType(t) { return ENTITY_TYPES.indexOf(t) !== -1; }
  function isValidBis(code) { return BIS_CODES.indexOf(code) !== -1; }
  function isValidViewRole(r) { return VIEW_ROLES.indexOf(r) !== -1; }

  function clampRadius(rMm) {
    assertFinite(rMm);
    return rMm < RADIUS_MIN_MM ? RADIUS_MIN_MM : rMm;
  }



  function assertThroughRadius(type, radius, meta) {
    if ((type === 'CIRCLE' || type === 'CIRCULAR_ARC') && meta && meta.throughRefs && radius < RADIUS_MIN_MM) {
      throw new Error('A circle or arc through points needs a radius of at least ' + RADIUS_MIN_MM + ' mm.');
    }
  }


  function createEntity(type, opts) {
    opts = opts || {};
    if (!isValidType(type)) throw new Error('unknown entity type: ' + String(type));
    var bis = (opts.bisCode === undefined) ? 'B' : opts.bisCode;
    if (!isValidBis(bis)) throw new Error('unknown bisCode: ' + String(bis));
    var role = (opts.viewRole === undefined) ? 'BOTH' : opts.viewRole;
    if (!isValidViewRole(role)) throw new Error('unknown viewRole: ' + String(role));
    var x = (opts.x === undefined) ? 0 : opts.x;
    var y = (opts.y === undefined) ? 0 : opts.y;
    assertFinite(x, y);
    var x2 = (opts.x2 === undefined) ? 0 : opts.x2;
    var y2 = (opts.y2 === undefined) ? 0 : opts.y2;
    assertFinite(x2, y2);
    assertTwoPoints(type, x, y, x2, y2);
    var radius = (opts.radius === undefined) ? 0 : opts.radius;
    assertFinite(radius);
    assertThroughRadius(type, radius, opts.meta);
    if (radius !== 0) radius = clampRadius(radius);
    var sa = (opts.startAngle === undefined) ? 0 : opts.startAngle;
    var ea = (opts.endAngle === undefined) ? 0 : opts.endAngle;
    assertFinite(sa, ea);
    var id = (opts.id === undefined || opts.id === null) ? nextId() : String(opts.id);
    if (id === '') throw new Error('entity id must be non-empty');
    var locked = (opts.locked === undefined) ? (type === 'DATUM_AXIS') : !!opts.locked;
    var thickness = (opts.thickness === undefined || opts.thickness === null) ? null : opts.thickness;
    if (thickness !== null) {
      assertFinite(thickness);
      if (thickness <= 0) throw new Error('thickness must be > 0');
    }
    var entity = {
      id: id,
      name: (opts.name === undefined) ? id : String(opts.name),
      type: type,
      x: x, y: y, x2: x2, y2: y2,
      radius: radius,
      startAngle: sa, endAngle: ea,
      bisCode: bis,
      viewRole: role,
      visible: (opts.visible === undefined) ? true : !!opts.visible,
      locked: locked,
      layer: (opts.layer === undefined) ? LAYER_STATIC : String(opts.layer),
      color: (opts.color === undefined) ? null : opts.color,
      thickness: thickness,
      caption: (opts.caption === undefined) ? '' : String(opts.caption),
      showLabel: (opts.showLabel === undefined) ? false : !!opts.showLabel,
      meta: (opts.meta === undefined) ? {} : opts.meta
    };
    if(type==='CURVE' && !Parametric.validate(entity.meta.curve)) throw new Error('Invalid parametric curve definition.');
    validateMembers(entity);
    return entity;
  }

  function bisStyleFor(code) {
    if (!isValidBis(code)) throw new Error('unknown bisCode: ' + String(code));
    var s = BIS_STYLES[code];
    var out = { code: s.code, pattern: s.pattern, dashMm: s.dashMm.slice(), widthMm: s.widthMm, width: s.width, use: s.use };
    if (s.thickEnds) { out.thickEnds = true; out.endWidthMm = s.endWidthMm; }
    return out;
  }

  function dashMmFor(code) { return bisStyleFor(code).dashMm; }
  function widthMmFor(code) { return bisStyleFor(code).widthMm; }
  function patternFor(code) { return bisStyleFor(code).pattern; }


  function resolveStyle(entity) {
    var base = bisStyleFor(entity.bisCode);
    if (entity.thickness !== null && entity.thickness !== undefined) {
      assertFinite(entity.thickness);
      base.widthMm = entity.thickness;
    }
    return base;
  }

  function dashToPx(dashMm, scale) {
    assertFinite(scale);
    if (scale <= 0) throw new Error('scale must be > 0');
    var out = [];
    for (var i = 0; i < dashMm.length; i++) {
      assertFinite(dashMm[i]);
      out.push(dashMm[i] * scale);
    }
    return out;
  }

  function widthToPx(widthMm, scale) {
    assertFinite(widthMm, scale);
    if (scale <= 0) throw new Error('scale must be > 0');
    return widthMm * scale;
  }





  var COSMETIC_CUTOFF_MM = 0.35;

  function cosmeticWidthPx(widthMm) {
    assertFinite(widthMm);
    return widthMm >= COSMETIC_CUTOFF_MM ? 2 : 1;
  }




  function cosmeticDashPx(dashMm) {
    if (!Array.isArray(dashMm)) throw new Error('dashMm must be an array');
    var out = [];
    for (var i = 0; i < dashMm.length; i++) {
      assertFinite(dashMm[i]);
      out.push(dashMm[i]);
    }
    return out;
  }

  function arrowheadMm() { return { lenMm: ARROW_LEN_MM, widthMm: ARROW_WIDTH_MM, ratio: ARROW_RATIO }; }


  function arrowFlipNeeded(lenPx) {
    assertFinite(lenPx);
    return lenPx < ARROW_FLIP_PX;
  }

  function forwardPt(view, x, y) {
    assertFinite(view.s, view.tx, view.ty, x, y);
    return { x: x * view.s + view.tx, y: view.ty - y * view.s };
  }


  function renderEntity(view, entity) {
    assertFinite(view.s, view.tx, view.ty);
    if (!isValidType(entity.type)) throw new Error('unknown entity type: ' + String(entity.type));
    var style = resolveStyle(entity);
    var p1 = forwardPt(view, entity.x, entity.y);
    var p2 = forwardPt(view, entity.x2, entity.y2);
    var dx = p2.x - p1.x, dy = p2.y - p1.y;
    var lenPx = Math.sqrt(dx * dx + dy * dy);
    var job = {
      id: entity.id, type: entity.type,
      p1Px: p1, p2Px: p2, lenPx: lenPx,
      dashPx: dashToPx(style.dashMm, view.s),
      widthPx: widthToPx(style.widthMm, view.s),
      pattern: style.pattern
    };
    if (entity.type === 'CIRCLE' || entity.type === 'CIRCULAR_ARC') {
      job.radiusPx = entity.radius * view.s;
      job.startAngle = entity.startAngle;
      job.endAngle = entity.endAngle;
    }
    if (entity.type === 'DIMENSION') {
      job.arrow = { lenMm: ARROW_LEN_MM, widthMm: ARROW_WIDTH_MM, flip: arrowFlipNeeded(lenPx) };
    }
    if (style.thickEnds) {
      job.thickEnds = true;
      job.endWidthPx = widthToPx(style.endWidthMm, view.s);
    }
    return job;
  }


  function checkProjector(planMm, elevMm, eps) {
    assertFinite(planMm.x, planMm.y, elevMm.x, elevMm.y);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    return Math.abs(elevMm.x - planMm.x) <= e;
  }

  function checkEntityProjector(planEntity, elevEntity, eps) {
    assertFinite(planEntity.x, elevEntity.x);
    var e = (eps === undefined) ? VERTICAL_EPS : eps;
    return Math.abs(elevEntity.x - planEntity.x) <= e;
  }

  function CadEntityTable() {
    this._map = Object.create(null);
    this._order = [];
    this._rev = 0;
    this._listeners = [];
    this._mutationGuard = null;
  }



  function resolveReference(entities, ref, type) {
    var exact = entities.find(function (e) { return e.id === ref; });
    if (exact) return !type || exact.type === type ? exact : null;
    var matches = entities.filter(function (e) { return (!type || e.type === type) && (e.name === ref || e.caption === ref); });
    return matches.length === 1 ? matches[0] : null;
  }



  function parseMembers(caption) {
    return String(caption || '').split(',').map(function (part) {
      var token = part.trim(), hidden = /^\(.*\)$/.test(token);
      if (hidden) token = token.slice(1, -1).trim();
      return { name: token.replace(/['′’]+$/, ''), hidden: hidden };
    }).filter(function (m) { return m.name !== ''; });
  }
  function memberCaption(entity, ids) {
    var role = entity.viewRole === 'BOTH' ? (entity.y < 0 ? 'PLAN' : 'ELEVATION') : entity.viewRole;
    var suffix = role === 'ELEVATION' ? "'" : role === 'PROFILE' ? "''" : '';
    return entity.meta.members.map(function (m) {
      var token = (ids ? 'member_' + encodeURIComponent(m.id).replace(/'/g, '%27') : m.name) + suffix;
      return m.hidden ? '(' + token + ')' : token;
    }).join(',');
  }
  function validateMembers(entity) {
    var members = entity.meta && entity.meta.members;
    if (members === undefined) return;
    if (entity.type !== 'POINT' || !Array.isArray(members)) throw new Error('Members belong to point stations and must be an array.');
    var seen = Object.create(null);
    members.forEach(function (m) {
      if (!m || typeof m.id !== 'string' || !m.id || typeof m.name !== 'string' || !m.name.trim() || /[,()'′’]/.test(m.name) || typeof m.hidden !== 'boolean') throw new Error('Each member needs an ID, a base name and a hidden verdict.');
      if (seen[m.id]) throw new Error('A station cannot contain the same member twice.');
      seen[m.id] = true;
    });
  }





  function withDeclaredMembers(entities) {
    if (!Array.isArray(entities)) return entities;
    var owners = new Map(), declared = new Set(), queue = [];
    entities.forEach(function(e,i) {
      if (!e || e.type !== 'POINT') return;
      var meta=e.meta||{}, members=meta.members;
      if (meta.membersDeclared === true || members !== undefined &&
          (!Array.isArray(members) || !members.length || members.some(function(m,j) {return !m || m.id !== 'point:'+e.id+':'+j;}))) {
        declared.add(i); queue.push(i);
      }
      if (Array.isArray(members)) members.forEach(function(m) {
        if (!m || typeof m.id !== 'string') return;
        if (!owners.has(m.id)) owners.set(m.id,[]);
        owners.get(m.id).push(i);
      });
    });
    for (var q=0;q<queue.length;q++) {
      var members=(entities[queue[q]].meta||{}).members;
      if (!Array.isArray(members)) continue;
      members.forEach(function(m) {
        if (!m || !owners.has(m.id)) return;
        owners.get(m.id).forEach(function(i) {
          if (!declared.has(i)) {declared.add(i);queue.push(i);}
        });
      });
    }
    return entities.map(function(e,i) {
      return declared.has(i) ? Object.assign({},e,{meta:Object.assign({},e.meta,{membersDeclared:true})}) : e;
    });
  }
  function identitySnapshot(entities, namespace) {
    var list = JSON.parse(JSON.stringify(entities));
    var occurrences = Object.create(null);
    list.forEach(function (e) {
      if (e.type !== 'POINT' || Array.isArray(e.meta && e.meta.members)) return;
      var view = e.viewRole === 'BOTH' ? (e.y < 0 ? 'PLAN' : 'ELEVATION') : e.viewRole;
      parseMembers(e.caption).forEach(function (m) {
        var counts = occurrences[m.name] || (occurrences[m.name] = Object.create(null));
        counts[view] = (counts[view] || 0) + 1;
      });
    });


    list.forEach(function (e) {
      if (e.type === 'POINT' && !Array.isArray(e.meta && e.meta.members)) {
        e.meta = e.meta || {};
        e.meta.members = parseMembers(e.caption).map(function (m, i) {
          var counts = occurrences[m.name];
          var ambiguous = Object.keys(counts).some(function (view) { return counts[view] > 1; });
          return Object.assign({ id: (namespace || '') + (ambiguous ? 'legacy-point:' + e.id + ':' + i : 'legacy:' + m.name) }, m);
        });
        e.meta.labelOverride = true;
        e.meta.membersDeclared = true;
      }
    });
    list.forEach(function (e) {
      e.meta = normalizeMeta(list, e);
      validateMembers(e);
    });
    return list;
  }
  function validateIdentityGraph(entities) {
    var names = Object.create(null);
    entities.forEach(function (e) {
      validateMembers(e);
      var endpoints = e.meta && e.meta.endpointMemberIds;
      if (endpoints !== undefined && (!Array.isArray(endpoints) || endpoints.length !== 2 ||
          endpoints.some(function (id) { return id !== null && (typeof id !== 'string' || !id); }))) {
        throw new Error('Line endpoint member IDs must contain two IDs or null entries.');
      }
      if (e.type !== 'POINT' || !Array.isArray(e.meta && e.meta.members)) return;
      e.meta.members.forEach(function (m) {
        if (names[m.id] !== undefined && names[m.id] !== m.name) throw new Error('A member ID must have one shared base name.');
        names[m.id] = m.name;
      });
    });
  }


  function semanticEntities(entities, ids) {
    var list = identitySnapshot(entities), byId = Object.create(null);
    list.forEach(function (e) { byId[e.id] = e; });
    return list.map(function (e) {
      if (e.type === 'POINT') e.caption = memberCaption(e, ids);
      function memberToken(stationIndex, memberId) {
        var station = byId[(e.meta.refs || [])[stationIndex]];
        var member = station && station.meta.members && station.meta.members.find(function (m) { return m.id === memberId; });
        if (!member) return 'missing-member_' + encodeURIComponent(memberId);
        return ids ? 'member_' + encodeURIComponent(memberId).replace(/'/g, '%27') : member.name;
      }
      if (e.meta.fromMemberId) e.meta.fromMember = memberToken(0, e.meta.fromMemberId);
      if (e.meta.toMemberId) e.meta.toMember = memberToken(1, e.meta.toMemberId);
      if (Array.isArray(e.meta.endpointMemberIds)) {
        e.meta.endpointMembers = e.meta.endpointMemberIds.map(function (id, i) {
          return id ? memberToken(i, id) : null;
        });
      }
      return e;
    });
  }
  function normalizeMeta(entities, entity) {
    var m = JSON.parse(JSON.stringify(entity.meta || {}));
    function id(ref) { var e = resolveReference(entities, ref); return e ? e.id : ref; }
    ['refs', 'vertices', 'endpointRefs', 'throughRefs'].forEach(function (key) { if (Array.isArray(m[key])) m[key] = m[key].map(id); });
    ['centerRef', 'radiusRef', 'polygon'].forEach(function (key) { if (typeof m[key] === 'string') m[key] = id(m[key]); });
    if ((entity.type === 'CIRCLE' || entity.type === 'CIRCULAR_ARC') && !m.centerRef && m.refs && m.refs.length <= 2) {
      var c = resolveReference(entities, m.refs[0], 'POINT');
      if (c && pointsCoincideMm(c.x, c.y, entity.x, entity.y)) m.centerRef = c.id;
    }
    if (CASCADE_LINE_TYPES.indexOf(entity.type) !== -1 && m.refs && m.refs.length > 2 && !m.endpointRefs) {

      m.endpointRefs = [[entity.x, entity.y], [entity.x2, entity.y2]].map(function (xy) {
        var pts = m.refs.map(function (r) { return resolveReference(entities, r, 'POINT'); }).filter(function (p) { return p && pointsCoincideMm(p.x, p.y, xy[0], xy[1]); });
        return pts.length === 1 ? pts[0].id : null;
      });
    }
    if (m.fromMember && !m.fromMemberId && m.refs) {
      var source = entities.find(function (e) { return e.id === m.refs[0]; });
      var wanted = parseMembers(m.fromMember)[0];
      var matches = source && source.meta && source.meta.members && source.meta.members.filter(function (member) { return wanted && member.name === wanted.name; });
      if (matches && matches.length === 1) m.fromMemberId = matches[0].id;
    }
    return m;
  }
  function endpointReferences(entities, entity, tolMm) {
    var m = normalizeMeta(entities, entity), refs = m.endpointRefs || m.refs;
    if (refs && refs.length) return [resolveReference(entities, refs[0], 'POINT'), resolveReference(entities, refs[1], 'POINT')];
    if (m.endpointRefs) return [null, null];
    function role(e) { return e.viewRole && e.viewRole !== 'BOTH' ? e.viewRole : e.y < 0 ? 'PLAN' : 'ELEVATION'; }
    return [[entity.x, entity.y], [entity.x2, entity.y2]].map(function (xy) {
      var points = entities.filter(function (p) {
        return p.type === 'POINT' && (entity.viewRole === 'BOTH' || role(entity) === role(p) || m.kind === 'projector') && pointsCoincideMm(p.x, p.y, xy[0], xy[1], tolMm);
      });
      return points.length === 1 ? points[0] : null;
    });
  }
  CadEntityTable.prototype.setMutationGuard = function (fn) {
    if (fn !== null && typeof fn !== 'function') throw new Error('mutation guard must be a function');
    this._mutationGuard = fn;
  };
  CadEntityTable.prototype._assertWritable = function () {
    if (this._mutationGuard && !this._mutationGuard()) throw new Error('This mode is read-only. Switch to Edit to change the drawing.');
  };


  CadEntityTable.prototype.revision = function () { return this._rev; };




  CadEntityTable.prototype.subscribe = function (fn) {
    if (typeof fn !== 'function') throw new Error('listener must be a function');
    this._listeners.push(fn);
    var self = this;
    return function () {
      var i = self._listeners.indexOf(fn);
      if (i !== -1) self._listeners.splice(i, 1);
    };
  };

  CadEntityTable.prototype._emit = function (op, entity) {
    this._rev++;
    var ls = this._listeners.slice();
    for (var i = 0; i < ls.length; i++) ls[i](op, entity || null, this);
  };

  CadEntityTable.prototype.add = function (entity) {
    this._assertWritable();
    if (!entity || typeof entity.id !== 'string' || entity.id === '') {
      throw new Error('entity must have a non-empty string id');
    }
    if (this._map[entity.id] !== undefined) throw new Error('duplicate entity id: ' + entity.id);
    if (!isValidType(entity.type)) throw new Error('unknown entity type: ' + String(entity.type));
    assertTwoPoints(entity.type, entity.x, entity.y, entity.x2, entity.y2);
    validateMembers(entity);
    validateIdentityGraph(this.list().concat([entity]));
    entity.meta = normalizeMeta(this.list().concat([entity]), entity);
    this._map[entity.id] = entity;
    this._order.push(entity.id);
    this._emit('add', entity);
    return entity;
  };

  CadEntityTable.prototype.create = function (type, opts) {
    var e = createEntity(type, opts);
    while ((!opts || opts.id === undefined || opts.id === null) && this.has(e.id)) e = createEntity(type, opts);
    if (type === 'POINT' && e.meta.members === undefined) {
      e.meta = Object.assign({}, e.meta, { members: parseMembers(e.caption || e.name).map(function (m, i) {
        return Object.assign({ id: 'point:' + e.id + ':' + i }, m);
      }), labelOverride: true });
    }
    return this.add(e);
  };


  CadEntityTable.prototype.importEntities = function (entities) {
    this._assertWritable();
    var self = this, seen = Object.create(null);
    var prepared = entities.map(function (raw) { return createEntity(raw.type, JSON.parse(JSON.stringify(raw))); });
    var built = identitySnapshot(prepared, prepared.length ? 'import:' + prepared[0].id + ':' : '');
    built.forEach(function (e) {
      if (self.has(e.id) || seen[e.id]) throw new Error('duplicate entity id: ' + e.id);
      seen[e.id] = true;
    });
    validateIdentityGraph(self.list().concat(built));
    built.forEach(function (e) { self._map[e.id] = e; self._order.push(e.id); });
    built.forEach(function (e) { self._emit('add', e); });
    return built;
  };




  CadEntityTable.prototype.replace = function (entities) {
    this._assertWritable();
    if (!Array.isArray(entities)) throw new Error('replace needs an entity array');
    var seen = Object.create(null);
    var prepared = entities.map(function (entity, i) {
      if (!entity || typeof entity !== 'object' ||
          typeof entity.id !== 'string' || entity.id === '')
        throw new Error('replace: entity ' + i + ' has no id');
      if (!isValidType(entity.type))
        throw new Error('replace: entity ' + i + ' has unknown type ' + String(entity.type));
      if (seen[entity.id]) throw new Error('replace: duplicate entity id ' + entity.id);
      seen[entity.id] = true;
      assertTwoPoints(entity.type, entity.x, entity.y, entity.x2, entity.y2);
      validateMembers(entity);
      return entity;
    });
    validateIdentityGraph(prepared);
    this._map = Object.create(null);
    this._order = [];
    for (var i = 0; i < prepared.length; i++) {
      this._map[prepared[i].id] = prepared[i];
      this._order.push(prepared[i].id);
    }
    this._emit('replace', null);
    return prepared;
  };

  CadEntityTable.prototype.get = function (id) {
    return this._map[id] === undefined ? null : this._map[id];
  };

  CadEntityTable.prototype.has = function (id) { return this._map[id] !== undefined; };

  CadEntityTable.prototype.remove = function (id) {
    this._assertWritable();
    if (this._map[id] === undefined) return false;
    var gone = this._map[id];
    delete this._map[id];
    var idx = this._order.indexOf(id);
    if (idx !== -1) this._order.splice(idx, 1);
    this._emit('remove', gone);
    return true;
  };

  CadEntityTable.prototype.count = function () { return this._order.length; };

  CadEntityTable.prototype.list = function () {
    var out = [];
    for (var i = 0; i < this._order.length; i++) out.push(this._map[this._order[i]]);
    return out;
  };
  CadEntityTable.prototype.getAll = CadEntityTable.prototype.list;

  CadEntityTable.prototype.clear = function () {
    this._assertWritable();
    this._map = Object.create(null);
    this._order = [];
    this._emit('clear', null);
  };


  CadEntityTable.prototype.update = function (id, patch) {
    this._assertWritable();
    var e = this._map[id];
    if (e === undefined) throw new Error('unknown entity id: ' + String(id));
    patch = patch || {};
    var touchesXY = (patch.x !== undefined || patch.y !== undefined || patch.x2 !== undefined || patch.y2 !== undefined);
    if (e.locked && touchesXY) throw new Error('entity is locked (XY datum): ' + id);
    if (patch.type !== undefined && patch.type !== e.type) throw new Error('entity type is immutable');
    if (patch.id !== undefined && patch.id !== e.id) throw new Error('entity id is immutable');
    if (patch.bisCode !== undefined && !isValidBis(patch.bisCode)) throw new Error('unknown bisCode: ' + String(patch.bisCode));
    if (patch.viewRole !== undefined && !isValidViewRole(patch.viewRole)) throw new Error('unknown viewRole: ' + String(patch.viewRole));
    var numKeys = ['x', 'y', 'x2', 'y2', 'radius', 'startAngle', 'endAngle'];
    for (var i = 0; i < numKeys.length; i++) {
      var k = numKeys[i];
      if (patch[k] !== undefined) assertFinite(patch[k]);
    }
    assertThroughRadius(e.type, patch.radius === undefined ? e.radius : patch.radius,
      patch.meta === undefined ? e.meta : patch.meta);
    if (patch.thickness !== undefined && patch.thickness !== null) {
      assertFinite(patch.thickness);
      if (patch.thickness <= 0) throw new Error('thickness must be > 0');
    }
    if (touchesXY) {
      var nx = (patch.x !== undefined) ? patch.x : e.x;
      var ny = (patch.y !== undefined) ? patch.y : e.y;
      var nx2 = (patch.x2 !== undefined) ? patch.x2 : e.x2;
      var ny2 = (patch.y2 !== undefined) ? patch.y2 : e.y2;
      assertTwoPoints(e.type, nx, ny, nx2, ny2);
    }
    if(e.type==='CURVE' && !Parametric.validate((patch.meta||e.meta).curve)) throw new Error('Invalid parametric curve definition.');
    validateMembers(Object.assign({}, e, patch));
    if (!this._batchValidation) validateIdentityGraph(this.list().map(function (row) { return row.id === id ? Object.assign({}, row, patch) : row; }));
    for (var key in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && Object.prototype.hasOwnProperty.call(e, key)) {
        e[key] = patch[key];
      }
    }
    if (patch.radius !== undefined && e.radius !== 0) e.radius = clampRadius(e.radius);
    this._emit('update', e);
    return e;
  };

  CadEntityTable.prototype.move = function (id, dxMm, dyMm) {
    this._assertWritable();
    var e = this._map[id];
    if (e === undefined) throw new Error('unknown entity id: ' + String(id));
    assertFinite(dxMm, dyMm);
    if(e.meta&&e.meta.throughRefs) throw new Error('Move the defining points to change this curve.');
    if (e.locked) throw new Error('entity is locked (XY datum): ' + id);
    e.x += dxMm; e.y += dyMm; e.x2 += dxMm; e.y2 += dyMm;
    this._emit('move', e);
    return e;
  };

  CadEntityTable.prototype.lock = function (id) {
    this._assertWritable();
    var e = this._map[id];
    if (e === undefined) throw new Error('unknown entity id: ' + String(id));
    e.locked = true;
    return e;
  };

  CadEntityTable.prototype.unlock = function (id) {
    this._assertWritable();
    var e = this._map[id];
    if (e === undefined) throw new Error('unknown entity id: ' + String(id));
    e.locked = false;
    return e;
  };

  CadEntityTable.prototype.findByType = function (type) {
    return this.list().filter(function (e) { return e.type === type; });
  };

  CadEntityTable.prototype.findByBisCode = function (code) {
    return this.list().filter(function (e) { return e.bisCode === code; });
  };

  CadEntityTable.prototype.findByViewRole = function (role) {
    return this.list().filter(function (e) { return e.viewRole === role; });
  };

  CadEntityTable.prototype.findByLayer = function (layer) {
    return this.list().filter(function (e) { return e.layer === layer; });
  };

  CadEntityTable.prototype.visibleEntities = function () {
    return this.list().filter(function (e) { return e.visible; });
  };



  CadEntityTable.prototype.updateMany = function (patches) {
    this._assertWritable();
    var self = this, temp = createTable(), ids = Object.keys(patches);
    self.list().forEach(function (e) { temp.add(createEntity(e.type, JSON.parse(JSON.stringify(e)))); });
    temp._batchValidation = true;
    ids.forEach(function (id) {
      var e = self.get(id); if (!e) throw new Error('unknown entity id: ' + id);
      temp.update(id, patches[id]);
    });
    validateIdentityGraph(temp.list());
    ids.forEach(function (id) { Object.assign(self.get(id), temp.get(id)); });
    ids.forEach(function (id) { self._emit('update', self.get(id)); });
    return ids;
  };








  var CASCADE_LINE_TYPES = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION'];

  function pointsCoincideMm(ax, ay, bx, by, tolMm) {
    var tol = (tolMm === undefined || tolMm === null) ? COINCIDENT_TOL_MM : tolMm;
    assertFinite(ax, ay, bx, by, tol);
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy) <= tol;
  }

  function collectCascadeDeleteIds(entities, rootId, tolMm) {
    if (!Array.isArray(entities)) throw new Error('entities must be an array');
    var tol = (tolMm === undefined || tolMm === null) ? COINCIDENT_TOL_MM : tolMm;
    assertFinite(tol);
    var byId = Object.create(null);
    for (var i = 0; i < entities.length; i++) {
      var e = entities[i];
      if (e && typeof e.id === 'string') byId[e.id] = e;
    }
    if (!byId[rootId]) return [];
    var doomed = Object.create(null);
    doomed[rootId] = true;
    var order = [rootId];
    var deadPoints = [];
    if (byId[rootId].type === 'POINT') {
      deadPoints.push(byId[rootId]);
    }
    var changed = true;
    while (changed) {
      changed = false;
      for (var j = 0; j < entities.length; j++) {
        var c = entities[j];
        if (!c || doomed[c.id]) continue;
        if (c.locked) continue;
        if (c.type === 'DATUM_AXIS') continue;
        var m = normalizeMeta(entities, c);
        var hit = false;
        if (!hit && typeof m.polygon === 'string' && m.polygon !== '' &&
            doomed[m.polygon]) {
          hit = true;
        }
        if (!hit && Array.isArray(m.refs)) {
          for (var r = 0; r < m.refs.length; r++) {
            if (doomed[m.refs[r]]) { hit = true; break; }
          }
        }
        if (!hit && Array.isArray(m.vertices)) {
          for (var v = 0; v < m.vertices.length; v++) {
            if (doomed[m.vertices[v]]) { hit = true; break; }
          }
        }
        if (!hit && (doomed[m.centerRef] || doomed[m.radiusRef] || (m.endpointRefs || []).some(function (id) { return doomed[id]; }))) hit = true;
        if (!hit && deadPoints.length > 0 &&
            CASCADE_LINE_TYPES.indexOf(c.type) !== -1 && !(m.refs && m.refs.length) && !m.endpointRefs) {
          hit = endpointReferences(entities, c, tol).some(function (p) { return p && doomed[p.id]; });
        }
        if (hit) {
          doomed[c.id] = true;
          order.push(c.id);
          if (c.type === 'POINT') {
            deadPoints.push(c);
          }
          changed = true;
        }
      }
    }
    return order;
  }

  CadEntityTable.prototype.removeCascade = function (id, tolMm) {
    var ids = collectCascadeDeleteIds(this.list(), id, tolMm);
    for (var i = 0; i < ids.length; i++) this.remove(ids[i]);
    return ids;
  };

  function createTable() { return new CadEntityTable(); }

  return {
    WORLD_UNITS: WORLD_UNITS,
    VERTICAL_EPS: VERTICAL_EPS,
    COINCIDENT_TOL_MM: COINCIDENT_TOL_MM,
    RADIUS_MIN_MM: RADIUS_MIN_MM,
    ENTITY_TYPES: ENTITY_TYPES, TYPES: ENTITY_TYPES,
    VIEW_ROLES: VIEW_ROLES,
    BIS_CODES: BIS_CODES,
    BIS_STYLES: BIS_STYLES,
    LAYER_STATIC: LAYER_STATIC, LAYER_DYNAMIC: LAYER_DYNAMIC,
    ARROW_LEN_MM: ARROW_LEN_MM, ARROW_LENGTH_MM: ARROW_LEN_MM,
    ARROW_WIDTH_MM: ARROW_WIDTH_MM, ARROW_W_MM: ARROW_WIDTH_MM,
    ARROW_RATIO: ARROW_RATIO, ARROW_FLIP_PX: ARROW_FLIP_PX,
    ARROW_FLIP_THRESHOLD_PX: ARROW_FLIP_PX,
    assertFinite: assertFinite,
    parseMembers: parseMembers, memberCaption: memberCaption, validateMembers: validateMembers, validateIdentityGraph: validateIdentityGraph, identitySnapshot: identitySnapshot, semanticEntities: semanticEntities,
    withDeclaredMembers: withDeclaredMembers,
    resolveReference: resolveReference, normalizeMeta: normalizeMeta, endpointReferences: endpointReferences,
    resetIdCounter: resetIdCounter, nextId: nextId,
    clampRadius: clampRadius,
    createEntity: createEntity, CadEntity: createEntity,
    CadEntityTable: CadEntityTable, createTable: createTable, createEntityTable: createTable,
    bisStyleFor: bisStyleFor, dashMmFor: dashMmFor, widthMmFor: widthMmFor, patternFor: patternFor,
    resolveStyle: resolveStyle, resolveEntityStyle: resolveStyle,
    dashToPx: dashToPx, widthToPx: widthToPx,
    cosmeticWidthPx: cosmeticWidthPx, COSMETIC_CUTOFF_MM: COSMETIC_CUTOFF_MM,
    cosmeticDashPx: cosmeticDashPx,
    arrowheadMm: arrowheadMm, arrowFlipNeeded: arrowFlipNeeded,
    renderEntity: renderEntity, renderJobFor: renderEntity, toRenderPx: renderEntity,
    checkProjector: checkProjector, checkEntityProjector: checkEntityProjector,
    CASCADE_LINE_TYPES: CASCADE_LINE_TYPES,
    TWO_POINT_TYPES: TWO_POINT_TYPES,
    assertTwoPoints: assertTwoPoints,
    pointsCoincideMm: pointsCoincideMm,
    collectCascadeDeleteIds: collectCascadeDeleteIds
  };
});

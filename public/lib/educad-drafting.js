(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-geometry.js'), require('./educad-entities.js'));
  else root.EduCADDrafting = factory(root.EduCADGeometry, root.EduCADEntities);
})(typeof window !== 'undefined' ? window : globalThis, function (Geometry, Entities) {
  'use strict';
  var EPS = 1e-6;
  var LINE_TYPES = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION'];
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function near(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) < EPS; }
  function fmt(n) { return String(Number(n.toFixed(2))); }
  function bases(e) {
    return String(e.caption || e.name || '').split(',').map(function (s) {
      return s.trim().replace(/^\((.*)\)$/, '$1').trim().replace(/['′’]+$/, '');
    }).filter(Boolean);
  }
  function common(a, b) { return bases(a).some(function (n) { return bases(b).indexOf(n) !== -1; }); }
  function role(e) {
    return e.viewRole && e.viewRole !== 'BOTH' ? e.viewRole : (e.y < 0 ? 'PLAN' : 'ELEVATION');
  }
  function toView(v, r, map) {
    if (r === 'PLAN') return { x: v.x, y: -v.z };
    if (r === 'PROFILE') return { x: map.xRef + map.s * (v.z - map.dRef), y: v.y };
    return { x: v.x, y: v.y };
  }
  function renamePoint(table, id, caption) {
    var point = table.get(id);
    if (!point || point.locked) throw new Error('Select an unlocked point to rename.');
    var before = bases(point), after = bases({ caption: caption });
    var patches = {}, list = table.list();
    list.forEach(function (e) {
      var meta = Entities.normalizeMeta(list, e);
      if (JSON.stringify(meta) !== JSON.stringify(e.meta)) patches[e.id] = { meta: meta };
    });
    table.list().filter(function (e) { return e.type === 'POINT' && e.id !== id && common(point, e); }).forEach(function (e) {
      var renamed = String(e.caption).split(',').map(function (part) {
        var token = part.trim(), hidden = /^\(.*\)$/.test(token);
        if (hidden) token = token.slice(1, -1);
        var name = token.replace(/['′’]+$/, ''), index = before.indexOf(name);
        if (index < 0 || !after[index]) return part;
        var next = after[index] + (role(e) === 'ELEVATION' ? "'" : role(e) === 'PROFILE' ? "''" : '');
        return hidden ? '(' + next + ')' : next;
      }).join(',');
      if (e.locked && renamed !== e.caption) throw new Error('A linked point is locked.');
      patches[e.id] = Object.assign(patches[e.id] || {}, { caption: renamed, name: renamed });
    });
    patches[id] = Object.assign(patches[id] || {}, { caption: caption, name: caption });
    table.updateMany(patches);
  }
  function distance(p, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    var t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function extent(list) {
    var pts = [];
    list.forEach(function (e) {
      if (e.visible === false || e.type === 'DATUM_AXIS' || (e.meta && ['axis', 'locus', 'projector'].indexOf(e.meta.kind) !== -1)) return;
      pts.push({ x: e.x, y: e.y });
      if (LINE_TYPES.indexOf(e.type) !== -1) pts.push({ x: e.x2, y: e.y2 });
      if (e.radius) pts.push({ x: e.x - e.radius, y: e.y - e.radius }, { x: e.x + e.radius, y: e.y + e.radius });
    });
    if (!pts.length) return null;
    return { x0: Math.min.apply(null, pts.map(function (p) { return p.x; })), x1: Math.max.apply(null, pts.map(function (p) { return p.x; })),
      y0: Math.min.apply(null, pts.map(function (p) { return p.y; })), y1: Math.max.apply(null, pts.map(function (p) { return p.y; })) };
  }
  function layoutOf(list, geometry) {
    var axis = list.find(function (e) { return e.meta && e.meta.draftingLayout; });
    if (axis) return clone(axis.meta.draftingLayout);
    var profile = list.filter(function (e) { return e.viewRole === 'PROFILE' && e.visible !== false; });
    var pb = extent(profile), eb = extent(list.filter(function (e) { return role(e) === 'ELEVATION'; }));
    if (!pb) return { three: false, side: 'left', xRef: eb ? eb.x1 + 40 : 80, dRef: 0, s: 1 };
    var s = !eb || (pb.x0 + pb.x1) / 2 > (eb.x0 + eb.x1) / 2 ? 1 : -1;
    var ref = list.find(function (e) { return e.caption === 'ref-X1Y1' || (e.meta && e.meta.kind === 'axis' && Math.abs(e.x - e.x2) < EPS && e.x >= pb.x0 - EPS && e.x <= pb.x1 + EPS); });
    var zMin = geometry && geometry.vertices.length ? Math.min.apply(null, geometry.vertices.map(function (v) { return v.z; })) : 0;
    return { three: true, side: s === 1 ? 'left' : 'right', xRef: ref ? ref.x : (s === 1 ? pb.x0 : pb.x1), dRef: zMin, s: s };
  }
  // One history entry per completed gesture; drag previews stay in one transaction.
  function createHistory(table, restore, onChange) {
    var past = [], future = [], base = clone(table.list()), pending = false, restoring = false, depth = 0;
    function emit() { if (onChange) onChange(past.length, future.length); }
    function flush() {
      if (!pending || depth || restoring) return;
      pending = false;
      var now = clone(table.list());
      if (JSON.stringify(now) !== JSON.stringify(base)) {
        past.push(base); if (past.length > 50) past.shift(); future = []; base = now;
      }
      emit();
    }
    table.subscribe(function () {
      if (restoring) return;
      pending = true;
      Promise.resolve().then(flush);
    });
    function put(snapshot, silent) {
      if (restoring) return false;
      restoring = true;
      try { restore(snapshot); base = clone(table.list()); pending = false; }
      finally { restoring = false; }
      if (!silent) emit();
      return true;
    }
    return {
      begin: function () { flush(); depth++; },
      end: function () { depth = Math.max(0, depth - 1); flush(); },
      cancel: function () { if (restoring) return; depth = 0; put(base); },
      undo: function () {
        if (depth || restoring) return false; flush(); if (!past.length) return false;
        var current = clone(table.list());
        put(past[past.length - 1], true);
        past.pop(); future.push(current); emit(); return true;
      },
      redo: function () {
        if (depth || restoring) return false; flush(); if (!future.length) return false;
        var current = clone(table.list());
        put(future[future.length - 1], true);
        future.pop(); past.push(current); emit(); return true;
      },
      counts: function () { flush(); return { undo: past.length, redo: future.length }; }
    };
  }
  // Move the selected point, its declared counterparts, and attached endpoints.
  // Validate the complete patch before committing, including collapsed edges.
  function movePoints(table, E, targets, map, extra) {
    var list = clone(table.list()), points = list.filter(function (e) { return e.type === 'POINT'; });
    var changes = Object.create(null), constraints = Object.create(null), queue = [];
    function put(p, key, value) {
      E.assertFinite(value);
      var constraint = constraints[p.id] || (constraints[p.id] = {});
      if (constraint[key] !== undefined) {
        if (Math.abs(constraint[key] - value) > EPS) throw new Error('The requested positions disagree across linked views.');
        return;
      }
      // An explicitly unchanged coordinate still constrains the final graph.
      // Otherwise another target could move it and silently detach its edge.
      constraint[key] = value;
      if (Math.abs(value - p[key]) < EPS) return;
      if (p.locked) throw new Error('A linked point is locked.');
      var patch = changes[p.id] || (changes[p.id] = {});
      patch[key] = value; queue.push({ point: p, key: key, value: value });
    }
    Object.keys(targets).forEach(function (id) {
      var p = points.find(function (q) { return q.id === id; });
      if (!p || p.locked) throw new Error('Select an unlocked point to move.');
      E.assertFinite(targets[id].x, targets[id].y);
      put(p, 'x', targets[id].x); put(p, 'y', targets[id].y);
    });
    for (var qi = 0; qi < queue.length; qi++) {
      var task = queue[qi], p = task.point, r = role(p), k = task.key, value = task.value;
      points.forEach(function (q) {
        if (q.id === p.id || !common(p, q)) return;
        var qr = role(q);
        if (k === 'x' && ((r === 'PLAN' && qr === 'ELEVATION') || (r === 'ELEVATION' && qr === 'PLAN')) && Math.abs(q.x - p.x) < EPS) put(q, 'x', value);
        if (r === 'PLAN' && qr === 'PROFILE' && k === 'y') put(q, 'x', map.xRef + map.s * (-value - map.dRef));
        if (r === 'ELEVATION' && qr === 'PROFILE' && k === 'y') put(q, 'y', value);
        if (r === 'PROFILE' && qr === 'PLAN' && k === 'x') put(q, 'y', -(map.dRef + map.s * (value - map.xRef)));
        if (r === 'PROFILE' && qr === 'ELEVATION' && k === 'y') put(q, 'y', value);
      });
      if (r !== 'PROFILE' && k === 'x') {
        list.filter(function (e) { return e.meta && e.meta.kind === 'projector' && Math.abs(e.x - p.x) < EPS; }).forEach(function (line) {
          points.forEach(function (q) {
            if (role(q) !== 'PROFILE' && Math.abs(q.x - p.x) < EPS && q.y >= Math.min(line.y, line.y2) - EPS && q.y <= Math.max(line.y, line.y2) + EPS) put(q, 'x', value);
          });
        });
      }
    }
    function final(p) { return Object.assign({}, p, changes[p.id]); }
    list.forEach(function (e) {
      var meta = E.normalizeMeta(list, e), patch = {};
      if (JSON.stringify(meta) !== JSON.stringify(e.meta)) patch.meta = meta;
      if (LINE_TYPES.indexOf(e.type) !== -1) {
        var refs = E.endpointReferences(list, e);
        [0, 1].forEach(function (end) {
          var x = end ? 'x2' : 'x', y = end ? 'y2' : 'y', owner = refs[end];
          if (owner && changes[owner.id]) { var next = final(owner); patch[x] = next.x; patch[y] = next.y; }
        });
        if (meta.kind === 'projector' && meta.extended && refs[0] && refs[1] && (changes[refs[0].id] || changes[refs[1].id])) {
          var a = final(refs[0]), b = final(refs[1]);
          Object.assign(patch, { x: a.x, x2: a.x, y: Math.min(a.y, b.y) - 5, y2: Math.max(a.y, b.y) + 5 });
        }
      }
      if (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') {
        var center = E.resolveReference(list, meta.centerRef, 'POINT'), rim = E.resolveReference(list, meta.radiusRef, 'POINT');
        if (center && (changes[center.id] || (rim && changes[rim.id]))) {
          var c = final(center); patch.x = c.x; patch.y = c.y;
          if (rim) {
            var rr = final(rim), radius = Math.hypot(c.x - rr.x, c.y - rr.y);
            if (radius < E.RADIUS_MIN_MM) throw new Error('The circle radius must be at least 0.01 mm.');
            patch.radius = radius;
          }
        }
      }
      if (e.locked && Object.keys(patch).some(function (key) { return key !== 'meta' && patch[key] !== e[key]; })) throw new Error('A dependent entity is locked.');
      if (Object.keys(patch).length) changes[e.id] = Object.assign(changes[e.id] || {}, patch);
    });
    Object.keys(extra || {}).forEach(function (id) { changes[id] = Object.assign(changes[id] || {}, extra[id]); });
    return table.updateMany(changes);
  }
  function movePoint(table, E, id, target, map) {
    var targets = {}; targets[id] = target;
    return movePoints(table, E, targets, map);
  }
  function editEntity(table, E, id, patch, map) {
    var e = table.get(id); if (!e || e.locked) throw new Error('Select an unlocked entity to edit.');
    var requested = Object.assign({}, e, patch);
    E.createEntity(e.type, requested);
    if ((e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') && patch.radius !== undefined && patch.radius < E.RADIUS_MIN_MM) throw new Error('The radius must be at least 0.01 mm.');
    var list = table.list(), meta = E.normalizeMeta(list, e), targets = {}, extra = {};
    if (LINE_TYPES.indexOf(e.type) !== -1) {
      var ends = E.endpointReferences(list, e);
      if (ends[0]) targets[ends[0].id] = { x: requested.x, y: requested.y };
      if (ends[1]) targets[ends[1].id] = { x: requested.x2, y: requested.y2 };
    } else if (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') {
      var center = E.resolveReference(list, meta.centerRef, 'POINT'), rim = E.resolveReference(list, meta.radiusRef, 'POINT');
      if (center) targets[center.id] = { x: requested.x, y: requested.y };
      if (center && rim) {
        var angle = Math.atan2(rim.y - center.y, rim.x - center.x), radius = patch.radius === undefined ? e.radius : patch.radius;
        targets[rim.id] = { x: requested.x + Math.cos(angle) * radius, y: requested.y + Math.sin(angle) * radius };
      }
    }
    extra[e.id] = Object.assign({}, patch, { meta: meta });
    return movePoints(table, E, targets, map, extra);
  }
  function editPoint(table, E, id, target, caption, map) {
    var temp = E.createTable(), patches = {};
    table.list().forEach(function (e) { temp.add(E.createEntity(e.type, clone(e))); });
    movePoint(temp, E, id, target, map);
    if (caption) renamePoint(temp, id, caption);
    temp.list().forEach(function (e) {
      var real = table.get(e.id);
      if (JSON.stringify(real) !== JSON.stringify(e)) {
        var patch = {};
        Object.keys(e).forEach(function (key) { if (JSON.stringify(real[key]) !== JSON.stringify(e[key])) patch[key] = e[key]; });
        patches[e.id] = patch;
      }
    });
    return table.updateMany(patches);
  }
  // Compare projected wire coverage in both directions. Extra drawn edges are
  // disagreements; missing edges are unfinished work, never a reason to hide 3D.
  function validateProfile(list, geometry, map, Project) {
    if (!map.three || !geometry) return { status: 'idle', issues: [], missing: [] };
    var drawn = list.filter(function (e) { return e.visible !== false && e.viewRole === 'PROFILE' && ['DIMENSION', 'TEXT', 'DATUM_AXIS'].indexOf(e.type) === -1 && (!e.meta || ['axis', 'locus', 'projector'].indexOf(e.meta.kind) === -1); });
    var expected = Project.projectGeometry(geometry, map.side, map);
    var tolerance = 0.15, curveError = tolerance / 8;
    var expectedSegments = expected.map(function (s) { return { a: { x: s.ax, y: s.ay }, b: { x: s.bx, y: s.by } }; });
    var projectedPoints = geometry.vertices.map(function (v) { return toView(v, 'PROFILE', map); });
    function segmentsFor(e) {
      if (LINE_TYPES.indexOf(e.type) !== -1) return [{ a: e, b: { x: e.x2, y: e.y2 } }];
      if (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') return Geometry.roundSegments(e, curveError);
      return [];
    }
    var drawnSegments = [], issues = [];
    drawn.forEach(function (e) {
      if (e.type === 'POINT') {
        if (!Geometry.segmentCovered(e, e, expectedSegments, tolerance, projectedPoints)) issues.push(e.id);
        return;
      }
      var pieces = segmentsFor(e), curved = e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC';
      if (!pieces || e.type === 'LINE' || e.type === 'RAY' || !pieces.every(function (s) {
        return Geometry.segmentCovered(s.a, s.b, expectedSegments, tolerance - (curved ? curveError : 0), projectedPoints);
      })) issues.push(e.id);
      if (pieces) {
        if (curved) pieces.forEach(function (s) { s.error = curveError; });
        drawnSegments = drawnSegments.concat(pieces);
      }
    });
    var missing = expected.filter(function (s) {
      var a = { x: s.ax, y: s.ay }, b = { x: s.bx, y: s.by };
      return !near(a, b) && !Geometry.segmentCovered(a, b, drawnSegments, tolerance);
    });
    return { status: issues.length ? 'mismatch' : missing.length || !drawn.length ? 'incomplete' : 'ok', issues: issues, missing: missing };
  }
  // Project the actual connected edge portions represented by this ink.
  // Coincident readings split as their owning 3D edges separate under pose.
  function profileCopies(ent, geometry, posed, map) {
    if (ent.viewRole !== 'PROFILE' || !geometry) return null;
    var originals = geometry.vertices, out = [];
    function add(copy, riders) {
      copy.meta = Object.assign({}, ent.meta, { poseRiders: riders });
      if (!out.some(function (e) { return near(e, copy) && (ent.type === 'POINT' || near({ x: e.x2, y: e.y2 }, { x: copy.x2, y: copy.y2 })); })) out.push(copy);
    }
    if (ent.type === 'POINT') originals.forEach(function (v, i) {
      if (near(toView(v, 'PROFILE', map), ent)) add(Object.assign({}, ent, toView(posed[i], 'PROFILE', map)), [i]);
    });
    if (LINE_TYPES.indexOf(ent.type) !== -1) {
      var end = { x: ent.x2, y: ent.y2 }, dx = end.x - ent.x, dy = end.y - ent.y, l2 = dx * dx + dy * dy;
      (geometry.edges || []).forEach(function (edge) {
        var a = toView(originals[edge[0]], 'PROFILE', map), b = toView(originals[edge[1]], 'PROFILE', map);
        if (!l2 || near(a, b) || Geometry.spanDistance(a, ent, end, 'LINE') > EPS || Geometry.spanDistance(b, ent, end, 'LINE') > EPS) return;
        var ta = ((a.x - ent.x) * dx + (a.y - ent.y) * dy) / l2, tb = ((b.x - ent.x) * dx + (b.y - ent.y) * dy) / l2;
        var lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(1, Math.max(ta, tb));
        if (hi - lo <= EPS) return;
        function at(t) {
          var u = (t - ta) / (tb - ta), p = posed[edge[0]], q = posed[edge[1]];
          return toView({ x: p.x + u * (q.x - p.x), y: p.y + u * (q.y - p.y), z: p.z + u * (q.z - p.z) }, 'PROFILE', map);
        }
        var start = at(lo), finish = at(hi);
        add(Object.assign({}, ent, { x: start.x, y: start.y, x2: finish.x, y2: finish.y }), edge.slice());
      });
    }
    return out.length ? out : [ent];
  }
  function mount(options) {
    var h = options.handle, E = options.entities, V = options.viewport, C = options.canvas, P = options.project;
    var surface = h.mount.layer2, tool = 'select', activeRole = 'AUTO', style = 'A', anchor = null, dimensionEnd = null;
    var selected = null, solidSelection = null, cursor = null, drag = null, suppressClick = false, warning = '', validation = { issues: [], missing: [] };
    var root = document.createElement('div'); root.className = 'drafting-controls';
    root.innerHTML = '<button type="button" class="drafting-launch" aria-expanded="false" aria-controls="drafting-menu">Draw</button>' +
      '<div id="drafting-menu" class="drafting-menu" hidden><nav class="drafting-tools" aria-label="Drawing tools"></nav>' +
      '<div class="drafting-history"><button type="button" data-action="fit">Fit views</button><button type="button" data-action="undo">Undo</button><button type="button" data-action="redo">Redo</button></div></div>' +
      '<div class="drafting-options"><label>Draw in <select aria-label="Drawing view"><option value="AUTO">Auto view</option><option value="ELEVATION">Front</option><option value="PLAN">Top</option><option value="PROFILE">Side</option></select></label>' +
      '<label>Line style <select aria-label="Line style"><option value="A">Visible</option><option value="B">Thin</option><option value="E">Hidden</option><option value="G">Centre</option><option value="K">Construction</option></select></label>' +
      '<button type="button" data-action="layout" aria-pressed="false">3 views</button><select aria-label="Side view"><option value="left">Left side</option><option value="right">Right side</option></select></div>' +
      '<div class="drafting-selection" hidden><span class="drafting-selection-name"></span>' +
      '<span class="drafting-project-actions">Project to <button type="button" data-target="ELEVATION">Front</button><button type="button" data-target="PLAN">Top</button><button type="button" data-target="PROFILE">Side</button></span>' +
      '<button type="button" data-action="edit-selection" aria-expanded="false">Edit</button></div>' +
      '<form class="drafting-editor" hidden aria-label="Edit selection"><span class="drafting-kind"></span><label>Name <input name="caption" aria-label="Point name" autocomplete="off"></label>' +
      '<label>X <input name="x" aria-label="X coordinate" type="number" step="any" required></label><label>Y <input name="y" aria-label="Y coordinate" type="number" step="any" required></label>' +
      '<label>X₂ <input name="x2" aria-label="Endpoint X coordinate" type="number" step="any"></label><label>Y₂ <input name="y2" aria-label="Endpoint Y coordinate" type="number" step="any"></label>' +
      '<label>R <input name="radius" aria-label="Radius" type="number" min="0.01" step="any"></label><span>mm</span><button type="submit">Apply</button><button type="button" data-action="delete">Delete</button></form>';
    document.body.appendChild(root);
    var status = document.createElement('p'); status.className = 'drafting-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); document.body.appendChild(status);
    var nav = root.querySelector('nav'), editor = root.querySelector('form'), roleSelect = root.querySelector('[aria-label="Drawing view"]');
    var styleSelect = root.querySelector('[aria-label="Line style"]'), sideSelect = root.querySelector('[aria-label="Side view"]');
    var preferences = root.querySelector('.drafting-options');
    var settingsSlot = document.getElementById('settings-drafting');
    if (settingsSlot) { settingsSlot.classList.add('drafting-settings'); settingsSlot.appendChild(preferences); }
    function control(selector) { return root.querySelector(selector) || preferences.querySelector(selector); }
    var menu = root.querySelector('.drafting-menu'), launch = root.querySelector('.drafting-launch');
    var selectionRow = root.querySelector('.drafting-selection'), menuOpen = false, editorOpen = false, editorId = null;
    function closeMenu() { menuOpen = false; menu.hidden = true; launch.setAttribute('aria-expanded', 'false'); }
    var sheetSettings = document.getElementById('settings-sheet'), bar = document.querySelector('.demo-bar');
    if (sheetSettings && bar) {
      bar.querySelectorAll('.clean-select-wrap, #btn-clear, #btn-check').forEach(function (el) { sheetSettings.appendChild(el); });
      bar.querySelectorAll('.bar-divider').forEach(function (el) { el.remove(); });
      ['click', 'change'].forEach(function (name) {
        sheetSettings.addEventListener(name, function (event) {
          if ((name === 'change' && event.target.tagName === 'SELECT') || (name === 'click' && event.target.closest('button'))) document.getElementById('settings-panel').hidden = true;
        });
      });
    }
    var guides = true, solidVisible = true, projectTarget = null;
    var labels = { select: 'Select', point: 'Point', line: 'Line', polyline: 'Polyline', circle: 'Circle', projector: 'Projector', dimension: 'Dimension' };
    Object.keys(labels).forEach(function (key) {
      var button = document.createElement('button'); button.type = 'button'; button.dataset.tool = key; button.textContent = labels[key]; button.setAttribute('aria-pressed', String(key === tool)); nav.appendChild(button);
    });
    var cachedLayout = null, layoutRevision = -1, layoutGeometry = null;
    function map() {
      if (layoutRevision !== h.table.revision() || layoutGeometry !== h.solidMm) {
        cachedLayout = layoutOf(h.table.list(), h.solidMm); layoutRevision = h.table.revision(); layoutGeometry = h.solidMm;
      }
      return cachedLayout;
    }
    function editMode() { return h.measure.mode === 'edit'; }
    function redraw() { options.redraw(); options.redrawDynamic(cursor); if (h.solid) h.solid.scheduleDraw(); }
    function hint(text) { warning = text || ''; updateStatus(); }
    function transaction(fn) { options.history.begin(); try { fn(); } finally { options.history.end(); } }
    function entity() { return selected && h.table.get(selected); }
    function cancel() {
      anchor = null; dimensionEnd = null; projectTarget = null; typed = ''; warning = ''; suppressClick = false;
      var previous = drag; drag = null;
      if (previous && previous.moved) options.history.cancel();
      surface.style.cursor = '';
    }
    function setTool(value) {
      closeMenu(); editorOpen = false; cancel(); options.cancelLegacy(); tool = value; if (tool !== 'select') solidSelection = null;
      if (tool === 'projector' && entity() && entity().type === 'POINT') { anchor = clone(entity()); projectTarget = role(anchor) === 'PLAN' ? 'ELEVATION' : 'PLAN'; }
      if (tool !== 'select' && tool !== 'projector') selected = null;
      sync(); redraw();
    }
    function currentRole(pt) { return activeRole !== 'AUTO' ? activeRole : (map().three && ((map().s === 1 && pt.x >= map().xRef) || (map().s === -1 && pt.x <= map().xRef)) && pt.y >= 0 ? 'PROFILE' : pt.y < 0 ? 'PLAN' : 'ELEVATION'); }
    function hit(px) {
      var list = h.table.visibleEntities().filter(function (e) { return isVisible(e) && e.type !== 'DATUM_AXIS' && !(e.meta && ['axis', 'locus'].indexOf(e.meta.kind) !== -1); });
      return options.measure.hitTestAll(list, px, h.view, 10);
    }
    function snap(px, exclude, fixedRole) {
      var candidates = h.table.visibleEntities().filter(function (e) { return isVisible(e) && e.id !== exclude; });
      var m = map(), raw = V.inverse(h.view, px), r = fixedRole || currentRole(raw);
      candidates = candidates.filter(function (e) { return role(e) === r || e.viewRole === 'BOTH'; });
      var stations = h.table.visibleEntities().filter(function (e) { return isVisible(e) && e.type === 'POINT' && role(e) !== 'PROFILE' && e.id !== exclude; }).map(function (e) { return e.x; });
      var snapResult = options.snapping.snapAt(px, h.view, { entities: candidates, planXMmList: r === 'PROFILE' ? [] : stations });
      var result = { x: raw.x, y: raw.y, viewRole: r };
      if (snapResult.snap) {
        var axes = options.snapping.snapTierAxes(snapResult.snap.tier);
        if (axes.x) result.x = snapResult.snap.xMm;
        if (axes.y) result.y = snapResult.snap.yMm;
      }
      var point = candidates.find(function (e) { return e.type === 'POINT' && near(e, result); });
      if (point) { result.id = point.id; result.viewRole = role(point); }
      // Carry front heights horizontally and top depths through the miter.
      if (guides && r === 'PROFILE' && !point) {
        var xs = [], ys = [];
        h.table.visibleEntities().filter(function (e) { return isVisible(e) && e.type === 'POINT' && e.id !== exclude; }).forEach(function (e) {
          if (role(e) === 'ELEVATION') ys.push(e.y);
          if (role(e) === 'PLAN') xs.push(m.xRef + m.s * (-e.y - m.dRef));
        });
        function nearest(values, target) {
          values.sort(function (a, b) { return Math.abs(a - target) - Math.abs(b - target); });
          return values.length && Math.abs(values[0] - target) * h.view.s <= 8 ? values[0] : target;
        }
        result.x = nearest(xs, raw.x); result.y = nearest(ys, raw.y);
      }
      if (guides && anchor && !point && ['line', 'polyline', 'dimension'].indexOf(tool) !== -1) {
        if (Math.abs(raw.x - anchor.x) * h.view.s <= 8) result.x = anchor.x;
        if (Math.abs(raw.y - anchor.y) * h.view.s <= 8) result.y = anchor.y;
      }
      return result;
    }
    function ensurePoint(pt, caption) {
      var existing = pt.id && h.table.get(pt.id);
      if (!existing) existing = h.table.visibleEntities().find(function (e) { return isVisible(e) && e.type === 'POINT' && role(e) === pt.viewRole && near(e, pt); });
      if (existing) return existing;
      var name = caption || C.nextPointName(h.table.list());
      return h.table.create('POINT', { x: pt.x, y: pt.y, viewRole: pt.viewRole, name: name, caption: name, showLabel: true, bisCode: 'B' });
    }
    function choose(id) {
      selected = id; solidSelection = null;
      var e = entity();
      if (e && e.type !== 'POINT') { style = e.bisCode; styleSelect.value = style; }
      if (e && e.type === 'POINT') options.selectLegacy(e.id); else { h.sel.selectedId = null; h.sel.editing = null; }
      sync(); if (h.solid) h.solid.scheduleDraw();
    }
    function projectedCandidate(px) {
      if (!anchor) return null;
      var m = map(), a = anchor, from = role(a), target = projectTarget || (from === 'PLAN' ? 'ELEVATION' : 'PLAN');
      var raw = V.inverse(h.view, px), out = { x: a.x, y: raw.y, viewRole: target };
      if (target === from) return null;
      if (target === 'PROFILE') {
        var verts = h.solidMm && h.solidMm.vertices.filter(function (v) { return near(toView(v, from, m), a); });
        if (!verts || !verts.length) return null;
        var pts = verts.map(function (v) { return toView(v, 'PROFILE', m); });
        pts.sort(function (p, q) { return Math.hypot(p.x - raw.x, p.y - raw.y) - Math.hypot(q.x - raw.x, q.y - raw.y); });
        out.x = pts[0].x; out.y = pts[0].y;
      } else if (from === 'PROFILE') {
        var mate = h.table.list().find(function (e) { return e.type === 'POINT' && role(e) === target && common(a, e); });
        out.x = mate ? mate.x : raw.x;
        out.y = target === 'PLAN' ? -(m.dRef + m.s * (a.x - m.xRef)) : a.y;
      } else {
        var snapped = snap(px);
        out.y = snapped.y;
        if (target === 'PLAN' && out.y > 0 || target === 'ELEVATION' && out.y < 0) return null;
      }
      return out;
    }
    function commitProjection(pt) {
      var source = h.table.get(anchor.id); if (!source) { hint('Select an existing point first.'); return; }
      var caption = bases(source).map(function (n) { return n + (pt.viewRole === 'ELEVATION' ? "'" : pt.viewRole === 'PROFILE' ? "''" : ''); }).join(',');
      transaction(function () {
        var dest = ensurePoint(pt, caption), sourceRole = role(source), destRole = role(dest);
        if (!common(source, dest)) h.table.update(dest.id, { caption: [dest.caption, caption].filter(Boolean).join(',') });
        if (sourceRole !== 'PROFILE' && destRole !== 'PROFILE') {
          var extended = near(source, dest);
          h.table.create('SEGMENT', { x: source.x, y: source.y - (extended ? 5 : 0), x2: dest.x, y2: dest.y + (extended ? 5 : 0), bisCode: 'G', viewRole: 'BOTH', meta: { kind: 'projector', refs: [source.id, dest.id], extended: extended } });
        } else if (sourceRole === 'PROFILE' || destRole === 'PROFILE') {
          var front = sourceRole === 'ELEVATION' ? source : destRole === 'ELEVATION' ? dest : h.table.list().find(function (e) { return e.type === 'POINT' && role(e) === 'ELEVATION' && common(source, e); });
          var side = sourceRole === 'PROFILE' ? source : dest;
          if (front && !near(front, side)) h.table.create('SEGMENT', { x: front.x, y: front.y, x2: side.x, y2: side.y, bisCode: 'B', viewRole: 'BOTH', meta: { kind: 'projector', refs: [front.id, side.id] } });
        }
        selected = dest.id;
      });
      anchor = null; projectTarget = null; hint('Projection paired. Select another point or press Esc.'); sync(); redraw();
    }
    function click(px, forced) {
      warning = ''; var id = hit(px), e = id && h.table.get(id), pt = forced || snap(px);
      if (tool === 'select') { choose(id); redraw(); return; }
      if (tool === 'point') { transaction(function () { selected = ensurePoint(pt).id; }); sync(); redraw(); return; }
      if (tool === 'projector') {
        if (!anchor) {
          if (!e || e.type !== 'POINT') { hint('Select a point to project.'); return; }
          anchor = clone(e); projectTarget = role(e) === 'PLAN' ? 'ELEVATION' : 'PLAN';
        } else {
          var target = projectedCandidate(px);
          if (!target) { hint(projectTarget === 'PROFILE' ? 'Pair the front and top point before projecting to the side.' : 'Place the matching point in the other view.'); return; }
          commitProjection(target); return;
        }
        sync(); redraw(); return;
      }
      if (!anchor) { anchor = pt; sync(); redraw(); return; }
      if (pt.viewRole !== anchor.viewRole) { hint('Draw one view at a time. Use Projector to connect views.'); return; }
      if (near(anchor, pt)) { if (tool === 'polyline') { anchor = null; sync(); redraw(); } else hint('Choose a different point.'); return; }
      if (tool === 'dimension' && !dimensionEnd) { dimensionEnd = pt; sync(); redraw(); return; }
      transaction(function () {
        if (tool === 'circle') {
          var radius = Math.hypot(pt.x - anchor.x, pt.y - anchor.y);
          if (radius < E.RADIUS_MIN_MM) throw new Error('The circle radius must be at least 0.01 mm.');
          var center = ensurePoint(anchor), rim = ensurePoint(pt);
          selected = h.table.create('CIRCLE', { x: anchor.x, y: anchor.y, radius: radius, bisCode: style, viewRole: anchor.viewRole, meta: { centerRef: center.id, radiusRef: rim.id, refs: [center.id, rim.id] } }).id;
        } else {
          var end = dimensionEnd || pt, a = ensurePoint(anchor), b = ensurePoint(end), dx = end.x - anchor.x, dy = end.y - anchor.y, length = Math.hypot(dx, dy);
          var offset = dimensionEnd ? ((pt.x - anchor.x) * -dy + (pt.y - anchor.y) * dx) / length : 0;
          selected = h.table.create(tool === 'dimension' ? 'DIMENSION' : 'SEGMENT', { x: anchor.x, y: anchor.y, x2: end.x, y2: end.y, bisCode: tool === 'dimension' ? 'B' : style,
            viewRole: anchor.viewRole, meta: { kind: tool === 'dimension' ? 'user-dimension' : 'user-line', refs: [a.id, b.id], offsetMm: offset } }).id;
        }
      });
      anchor = tool === 'polyline' ? pt : null; dimensionEnd = null; sync(); redraw();
    }
    function deleteSelection() {
      var e = entity(); if (!e) return;
      if (e.locked) { hint('Reference axes are locked.'); return; }
      transaction(function () { if (e.type === 'POINT') h.table.removeCascade(e.id); else h.table.remove(e.id); });
      selected = null; solidSelection = null; cancel(); options.cancelLegacy(); sync(); redraw();
    }
    function setLayout(three, side) {
      var old = map(), eb = extent(h.table.list().filter(function (e) { return role(e) === 'ELEVATION'; }));
      var next = { three: three, side: side || old.side, s: (side || old.side) === 'right' ? -1 : 1, xRef: old.xRef, dRef: old.dRef };
      if (next.side !== old.side) next.xRef = next.s === 1 ? (eb ? eb.x1 : 40) + 40 : (eb ? eb.x0 : -40) - 40;
      transaction(function () {
        if (next.side !== old.side) {
          h.table.list().forEach(function (e) {
            if (e.viewRole !== 'PROFILE' || e.locked) return;
            var patch = { x: next.xRef + next.s * (old.dRef + old.s * (e.x - old.xRef) - next.dRef) };
            if (LINE_TYPES.indexOf(e.type) !== -1) patch.x2 = next.xRef + next.s * (old.dRef + old.s * (e.x2 - old.xRef) - next.dRef);
            h.table.update(e.id, patch);
          });
          // Keep assisted front-to-side helper endpoints attached after a layout flip.
          h.table.list().forEach(function (e) {
            if (!e.meta || e.meta.kind !== 'projector' || !e.meta.refs || e.locked) return;
            var a = h.table.get(e.meta.refs[0]), b = h.table.get(e.meta.refs[1]);
            if (a && b && (role(a) === 'PROFILE' || role(b) === 'PROFILE')) h.table.update(e.id, { x: a.x, y: a.y, x2: b.x, y2: b.y });
          });
        }
        var axis = h.table.list().find(function (e) { return e.meta && e.meta.draftingLayout; });
        if (axis) h.table.update(axis.id, { meta: { kind: 'axis', draftingLayout: next } });
        else h.table.create('DATUM_AXIS', { x: next.xRef, y: 0, x2: next.xRef, y2: 50, viewRole: 'PROFILE', caption: '', showLabel: false, meta: { kind: 'axis', draftingLayout: next } });
      });
      if (!three && activeRole === 'PROFILE') activeRole = 'AUTO';
      cancel(); refresh(); redraw();
    }
    function fit() {
      var b = extent(h.table.visibleEntities().filter(isVisible)); if (!b) { hint('Draw something to fit the views.'); return; }
      b.y0 = Math.min(0, b.y0); b.y1 = Math.max(0, b.y1);
      if (map().three) { b.x0 = Math.min(b.x0, map().xRef); b.x1 = Math.max(b.x1, map().xRef); b.y1 += 20; }
      var solidRoom = solidVisible && h.solidMm ? Math.min(330, h.view.w * 0.28) : 0;
      var usableW = h.view.w - solidRoom - 120, usableH = h.view.h - 230;
      h.view.s = V.clampScale(Math.min(usableW / Math.max(b.x1 - b.x0, 40), usableH / Math.max(b.y1 - b.y0, 40)));
      h.view.tx = 60 + usableW / 2 - (b.x0 + b.x1) / 2 * h.view.s;
      h.view.ty = 150 + usableH / 2 + (b.y0 + b.y1) / 2 * h.view.s;
      if (h.spatialView && h.measure.mode === 'view') h.spatialView.fit();
      redraw();
    }
    function isVisible(e) {
      // The bounded reference and miter drawn by drawSheet replace the demo's
      // infinite LINE, which otherwise cuts through the text controls.
      if (e.caption === 'ref-X1Y1' || e.caption === 'miter') return false;
      if (!guides && ((e.meta && ['axis', 'projector', 'locus'].indexOf(e.meta.kind) !== -1) || /^proj-/.test(e.caption || ''))) return false;
      if (map().three) return true;
      if (e.viewRole === 'PROFILE') return false;
      if (e.meta && e.meta.kind === 'projector' && e.meta.refs) return !e.meta.refs.some(function (id) { var p = h.table.get(id); return p && role(p) === 'PROFILE'; });
      return !e.caption || !/^proj-pf-|^miter$|^ref-X1Y1$/.test(e.caption);
    }
    function updateStatus() {
      var text = warning;
      if (!text && options.getPose()) text = 'Pose preview · stored drawing unchanged';
      var selectedPoint = entity();
      if (!text && selectedPoint && selectedPoint.type === 'POINT' && !linked().vertices.length && role(selectedPoint) !== 'PROFILE') {
        var targetRole = role(selectedPoint) === 'PLAN' ? 'ELEVATION' : 'PLAN';
        var mate = h.table.list().find(function (p) { return p.type === 'POINT' && role(p) === targetRole && common(selectedPoint, p); });
        text = mate ? 'Matching point needs an aligned projector · use Project to pair it' : 'Point needs a ' + (targetRole === 'PLAN' ? 'top' : 'front') + ' projection · use Project to pair it';
      }
      if (!text && validation.status === 'mismatch') text = 'Side view disagrees with front / top · ' + validation.issues.length + ' marked item' + (validation.issues.length === 1 ? '' : 's');
      if (!text && validation.status === 'incomplete') text = 'Side view incomplete · add the missing projections';
      if (!text && selected && validation.status === 'ok') text = 'Front · Top · Side agree';
      status.textContent = text; status.dataset.state = validation.status || '';
    }
    function sync() {
      var e = entity(), editing = editMode(), m = map();
      root.querySelectorAll('[data-tool]').forEach(function (button) { button.setAttribute('aria-pressed', String(button.dataset.tool === tool)); button.disabled = !editing; });
      nav.hidden = !editing;
      launch.textContent = !editing ? 'Views' : tool === 'select' ? 'Draw' : labels[tool];
      if (!editing) closeMenu();
      roleSelect.value = activeRole; roleSelect.disabled = !editing;
      styleSelect.value = style; styleSelect.disabled = !editing;
      control('[data-action="layout"]').setAttribute('aria-pressed', String(m.three));
      control('[data-action="layout"]').disabled = !editing;
      sideSelect.hidden = !m.three; sideSelect.value = m.side; sideSelect.disabled = !editing;
      roleSelect.querySelector('[value="PROFILE"]').disabled = !m.three;
      var counts = options.history.counts();
      root.querySelector('[data-action="undo"]').disabled = !editing || !counts.undo;
      root.querySelector('[data-action="redo"]').disabled = !editing || !counts.redo;
      root.querySelector('[data-action="undo"]').hidden = !editing;
      root.querySelector('[data-action="redo"]').hidden = !editing;
      if (!e || editorId !== e.id) { editorOpen = false; editorId = e && e.id; }
      selectionRow.hidden = !editing || !e;
      root.querySelector('.drafting-selection-name').textContent = e ? (e.caption || (e.type === 'POINT' ? 'Point' : e.type === 'CIRCLE' ? 'Circle' : 'Edge')) : '';
      root.querySelector('[data-action="edit-selection"]').setAttribute('aria-expanded', String(editorOpen));
      editor.hidden = !editing || !e || !editorOpen;
      if (e && !editor.contains(document.activeElement)) {
        root.querySelector('.drafting-kind').textContent = e.type === 'POINT' ? 'Point' : e.type === 'CIRCLE' ? 'Circle' : e.type === 'DIMENSION' ? 'Dimension' : 'Edge';
        ['caption', 'x', 'y', 'x2', 'y2', 'radius'].forEach(function (key) {
          var input = editor.elements[key], visible = key === 'caption' ? e.type === 'POINT' : key === 'radius' ? e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC' : key === 'x2' || key === 'y2' ? LINE_TYPES.indexOf(e.type) !== -1 : true;
          input.parentNode.hidden = !visible; input.disabled = !visible || e.locked;
          input.value = key === 'caption' ? e.caption : String(Number(e[key].toFixed(8)));
        });
        root.querySelector('.drafting-project-actions').hidden = e.type !== 'POINT';
        root.querySelector('[data-target="PROFILE"]').hidden = !m.three;
        root.querySelectorAll('[data-target]').forEach(function (button) { button.disabled = e.type !== 'POINT' || button.dataset.target === role(e); });
      }
      document.body.classList.toggle('drafting-readonly', !editing);
      surface.style.cursor = tool === 'select' ? '' : 'crosshair';
      updateStatus();
    }
    function refresh() {
      if (selected && !h.table.has(selected)) selected = null;
      validation = validateProfile(h.table.visibleEntities(), h.solidMm, map(), P);
      sync();
    }
    editor.addEventListener('submit', function (event) {
      event.preventDefault(); var e = entity(); if (!editMode() || !e || e.locked) return;
      try {
        transaction(function () {
          var x = Number(editor.elements.x.value), y = Number(editor.elements.y.value);
          if (e.type === 'POINT') {
            var name = editor.elements.caption.value.trim();
            editPoint(h.table, E, e.id, { x: x, y: y }, name, map());
          } else {
            var patch = { x: x, y: y };
            if (LINE_TYPES.indexOf(e.type) !== -1) { patch.x2 = Number(editor.elements.x2.value); patch.y2 = Number(editor.elements.y2.value); }
            if (e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') patch.radius = Number(editor.elements.radius.value);
            editEntity(h.table, E, e.id, patch, map());
          }
        });
        document.activeElement.blur(); editorOpen = false; hint('Updated.'); sync(); redraw();
      } catch (error) { hint(error.message); }
    });
    function onControlClick(event) {
      var button = event.target.closest('button'); if (!button) return;
      if (button === launch) { menuOpen = !menuOpen; menu.hidden = !menuOpen; launch.setAttribute('aria-expanded', String(menuOpen)); if (menuOpen) (editMode() ? nav.querySelector('[data-tool="' + tool + '"]') : root.querySelector('[data-action="fit"]')).focus(); return; }
      if (button.dataset.action === 'edit-selection') { editorOpen = !editorOpen; sync(); if (editorOpen) editor.elements.x.focus(); return; }
      if (button.dataset.tool) { setTool(button.dataset.tool); return; }
      if (button.dataset.target) {
        var e = entity(); if (!e || e.type !== 'POINT') return;
        setTool('projector'); anchor = clone(e); projectTarget = button.dataset.target; hint('Place the ' + (projectTarget === 'PROFILE' ? 'side' : projectTarget === 'PLAN' ? 'top' : 'front') + ' projection.'); redraw(); return;
      }
      if (button.dataset.action === 'delete') deleteSelection();
      if (button.dataset.action === 'layout') setLayout(!map().three);
      if (button.dataset.action === 'fit') { fit(); closeMenu(); }
      if (button.dataset.action === 'undo') { closeMenu(); cancel(); options.undo(); refresh(); redraw(); }
      if (button.dataset.action === 'redo') { closeMenu(); cancel(); options.redo(); refresh(); redraw(); }
    }
    root.addEventListener('click', onControlClick);
    preferences.addEventListener('click', onControlClick);
    window.addEventListener('pointerdown', function (event) { if (!root.contains(event.target)) closeMenu(); }, true);
    roleSelect.addEventListener('change', function () { cancel(); activeRole = roleSelect.value; sync(); redraw(); });
    styleSelect.addEventListener('change', function () {
      style = styleSelect.value; var e = entity();
      if (editMode() && tool === 'select' && e && e.type !== 'POINT' && !e.locked) transaction(function () { h.table.update(e.id, { bisCode: style }); });
      redraw();
    });
    sideSelect.addEventListener('change', function () { setLayout(true, sideSelect.value); });
    ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'wheel', 'contextmenu', 'keydown'].forEach(function (name) { root.addEventListener(name, function (event) { event.stopPropagation(); }); });
    window.addEventListener('pointerdown', function (event) {
      if (event.target === surface && event.button === 0) suppressClick = false;
      if (event.target !== surface || !editMode() || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || tool !== 'select') return;
      var px = { x: event.clientX, y: event.clientY };
      if (!event.altKey && solidVisible && options.solidAt(px)) return;
      var id = hit(px), e = id && h.table.get(id);
      choose(id);
      if (e && e.type === 'POINT' && !e.locked) drag = { id: e.id, start: px, moved: false, offset: { x: e.x - V.inverse(h.view, px).x, y: e.y - V.inverse(h.view, px).y } };
      event.stopImmediatePropagation(); redraw();
    }, true);
    window.addEventListener('pointermove', function (event) {
      cursor = { x: event.clientX, y: event.clientY };
      if (!drag) return;
      if (!drag.moved && Math.hypot(cursor.x - drag.start.x, cursor.y - drag.start.y) <= 4) return;
      if (!drag.moved) { options.history.begin(); drag.moved = true; }
      try {
        var pt = snap(cursor, drag.id, role(h.table.get(drag.id))); pt.x += drag.offset.x; pt.y += drag.offset.y;
        movePoint(h.table, E, drag.id, pt, map()); warning = '';
      } catch (error) { warning = error.message; }
      surface.style.cursor = 'grabbing'; event.stopImmediatePropagation(); redraw();
    }, true);
    window.addEventListener('pointerup', function (event) {
      if (!drag) return;
      if (drag.moved) { options.history.end(); suppressClick = true; }
      drag = null; event.stopImmediatePropagation(); sync(); redraw();
    }, true);
    window.addEventListener('pointercancel', function () { if (drag) { cancel(); sync(); redraw(); } }, true);
    surface.addEventListener('click', function (event) {
      if (event.shiftKey || event.ctrlKey || event.metaKey || !editMode() || options.legacyActive()) return;
      if (options.solidSuppressed()) return;
      event.stopImmediatePropagation();
      if (suppressClick) { suppressClick = false; return; }
      try { click({ x: event.clientX, y: event.clientY }); }
      catch (error) { hint(error.message); }
    }, true);
    surface.addEventListener('dblclick', function (event) {
      if (tool !== 'select') { event.stopImmediatePropagation(); anchor = null; dimensionEnd = null; sync(); redraw(); }
    }, true);
    surface.addEventListener('contextmenu', function (event) {
      if (!editMode() || (!anchor && !selected && !drag)) return;
      event.preventDefault(); event.stopImmediatePropagation(); cancel(); selected = null; options.cancelLegacy(); sync(); redraw();
    }, true);
    var typed = '';
    window.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && (menuOpen || editorOpen)) {
        closeMenu(); editorOpen = false; document.activeElement.blur(); sync();
        event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      var field = event.target && (['INPUT', 'TEXTAREA', 'SELECT'].indexOf(event.target.tagName) !== -1 || event.target.isContentEditable);
      if (field) return;
      // Preserve normal keyboard navigation; mode changes have explicit controls.
      if (event.key === 'Tab' && h.measure.mode !== 'pose') { event.stopImmediatePropagation(); return; }
      if (!editMode() || h.sel.editing) return;
      if (event.key === 'Escape') {
        closeMenu(); editorOpen = false; cancel(); typed = ''; selected = null; solidSelection = null; tool = 'select'; options.cancelLegacy();
        event.preventDefault(); event.stopImmediatePropagation(); sync(); redraw(); return;
      }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y')) {
        event.preventDefault(); event.stopImmediatePropagation(); cancel();
        if (event.shiftKey || event.key.toLowerCase() === 'y') options.redo(); else options.undo();
        refresh(); redraw(); return;
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selected && !anchor) { event.preventDefault(); event.stopImmediatePropagation(); deleteSelection(); return; }
      if (anchor && ['line', 'polyline', 'circle', 'projector', 'dimension'].indexOf(tool) !== -1) {
        if (/^[0-9.]$/.test(event.key) || event.key === 'Backspace') {
          typed = event.key === 'Backspace' ? typed.slice(0, -1) : typed + event.key;
          event.preventDefault(); event.stopImmediatePropagation(); redraw(); return;
        }
        if (event.key === 'Enter') {
          event.preventDefault(); event.stopImmediatePropagation();
          if (!typed) { if (tool === 'polyline') { anchor = null; sync(); redraw(); } return; }
          var value = Number(typed);
          if (!isFinite(value) || value <= 0) { hint('Enter a distance greater than zero.'); return; }
          if (!cursor) { hint('Move the cursor to choose a direction.'); return; }
          try {
            var raw = snap(cursor), dx = raw.x - anchor.x, dy = raw.y - anchor.y, length = Math.hypot(dx, dy);
            if (tool === 'projector') {
              if (projectTarget === 'PROFILE') { hint('Side coordinates come from the paired front and top point.'); return; }
              commitProjection({ x: anchor.x, y: projectTarget === 'PLAN' ? -value : value, viewRole: projectTarget });
            } else {
              if (length < EPS) { hint('Move the cursor to choose a direction.'); return; }
              var pt = { x: anchor.x + value * dx / length, y: anchor.y + value * dy / length, viewRole: anchor.viewRole };
              click(V.forward(h.view, pt), pt);
            }
            typed = '';
          } catch (error) { hint(error.message); }
          return;
        }
      }
    }, true);
    function linked() {
      var g = h.solidMm, m = map(), e = entity(), result = { vertices: [], edges: [] };
      if (!g) return result;
      if (solidSelection) {
        if (solidSelection.kind === 'point') result.vertices = [solidSelection.index];
        else { result.edges = [solidSelection.index]; result.vertices = g.edges[solidSelection.index] || []; }
        return result;
      }
      if (!e) return result;
      var r = role(e);
      g.vertices.forEach(function (v, i) {
        var p = toView(v, r, m);
        if (e.type === 'POINT' ? near(p, e) : LINE_TYPES.indexOf(e.type) !== -1 && distance(p, e, { x: e.x2, y: e.y2 }) < EPS) result.vertices.push(i);
      });
      if (LINE_TYPES.indexOf(e.type) !== -1) g.edges.forEach(function (edge, i) {
        var a = toView(g.vertices[edge[0]], r, m), b = toView(g.vertices[edge[1]], r, m);
        if (!near(a, b) && distance(a, e, { x: e.x2, y: e.y2 }) < EPS && distance(b, e, { x: e.x2, y: e.y2 }) < EPS) result.edges.push(i);
      });
      return result;
    }
    function stroke(ctx, a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    function ring(ctx, p, radius) { ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.stroke(); }
    function drawSheet(ctx, view) {
      var m = map(); if (!m.three) return;
      var eb = extent(h.table.visibleEntities().filter(function (e) { return role(e) === 'ELEVATION'; }));
      var pb = extent(h.table.visibleEntities().filter(function (e) { return role(e) === 'PLAN'; }));
      ctx.save(); ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 0.7; ctx.setLineDash([4, 5]);
      var top = eb ? Math.max(50, eb.y1 + 15) : 70, depth = pb ? Math.max(30, -pb.y0 - m.dRef) : 50;
      if (guides) {
        stroke(ctx, V.forward(view, { x: m.xRef, y: 0 }), V.forward(view, { x: m.xRef, y: top }));
        stroke(ctx, V.forward(view, { x: m.xRef, y: -m.dRef }), V.forward(view, { x: m.xRef + m.s * depth, y: -m.dRef - depth }));
        var label = V.forward(view, { x: m.xRef + m.s * depth / 2, y: -m.dRef - depth / 2 });
        C.drawKnockoutLabel(ctx, '45°', label.x + 6, label.y + 13, { font: '11px sans-serif', fillStyle: '#94a3b8' });
      }
      var pos = V.forward(view, { x: m.xRef + m.s * depth / 2, y: top });
      C.drawKnockoutLabel(ctx, m.side === 'left' ? 'Left side view' : 'Right side view', pos.x - 32, pos.y - 10, { font: '11px sans-serif', fillStyle: '#64748b' });
      ctx.restore();
    }
    function drawDimension(ctx, view, ent) {
      var a = V.forward(view, ent), b = V.forward(view, { x: ent.x2, y: ent.y2 });
      var dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); if (length < EPS) return;
      var nx = dy / length, ny = -dx / length, offset = (ent.meta && ent.meta.offsetMm !== undefined ? ent.meta.offsetMm : 10) * view.s;
      var p = { x: a.x + nx * offset, y: a.y + ny * offset }, q = { x: b.x + nx * offset, y: b.y + ny * offset };
      ctx.save(); ctx.strokeStyle = '#64748b'; ctx.lineWidth = 1; ctx.setLineDash([]);
      stroke(ctx, a, { x: p.x + nx * Math.sign(offset) * 4, y: p.y + ny * Math.sign(offset) * 4 });
      stroke(ctx, b, { x: q.x + nx * Math.sign(offset) * 4, y: q.y + ny * Math.sign(offset) * 4 }); stroke(ctx, p, q);
      [ [p, q], [q, p] ].forEach(function (pair) {
        var from = pair[0], to = pair[1], ux = (to.x - from.x) / length, uy = (to.y - from.y) / length;
        stroke(ctx, from, { x: from.x + ux * 7 - uy * 2.5, y: from.y + uy * 7 + ux * 2.5 });
        stroke(ctx, from, { x: from.x + ux * 7 + uy * 2.5, y: from.y + uy * 7 - ux * 2.5 });
      });
      C.drawKnockoutLabel(ctx, fmt(Math.hypot(ent.x2 - ent.x, ent.y2 - ent.y)) + ' mm', (p.x + q.x) / 2 + nx * 6, (p.y + q.y) / 2 + ny * 6, { font: '12px sans-serif', fillStyle: '#475569' });
      ctx.restore();
    }
    function drawDynamic(ctx, view) {
      var m = map(), g = h.solidMm, keys = linked(), rlist = m.three ? ['ELEVATION', 'PLAN', 'PROFILE'] : ['ELEVATION', 'PLAN'];
      ctx.save(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#58738c'; ctx.setLineDash([]);
      if (g) rlist.forEach(function (r) {
        keys.vertices.forEach(function (index) { ring(ctx, V.forward(view, toView(g.vertices[index], r, m)), 6); });
        keys.edges.forEach(function (index) { var edge = g.edges[index]; stroke(ctx, V.forward(view, toView(g.vertices[edge[0]], r, m)), V.forward(view, toView(g.vertices[edge[1]], r, m))); });
      });
      var e = entity();
      if (e && e.type !== 'POINT' && LINE_TYPES.indexOf(e.type) !== -1) stroke(ctx, V.forward(view, e), V.forward(view, { x: e.x2, y: e.y2 }));
      if (e && e.type === 'CIRCLE') ring(ctx, V.forward(view, e), e.radius * view.s);
      if (!options.getPose()) {
        ctx.strokeStyle = '#b7793a'; ctx.setLineDash([3, 5]);
        validation.issues.forEach(function (id) { var item = h.table.get(id); if (!item) return; if (item.type === 'POINT') ring(ctx, V.forward(view, item), 7); else if (LINE_TYPES.indexOf(item.type) !== -1) stroke(ctx, V.forward(view, item), V.forward(view, { x: item.x2, y: item.y2 })); });
        if (validation.status !== 'ok' && m.three && guides) validation.missing.forEach(function (s) { stroke(ctx, V.forward(view, { x: s.ax, y: s.ay }), V.forward(view, { x: s.bx, y: s.by })); });
      }
      if (editMode() && anchor && cursor) {
        var pt = tool === 'projector' ? projectedCandidate(cursor) : snap(cursor), start = V.forward(view, anchor);
        ctx.strokeStyle = '#58738c'; ctx.setLineDash([3, 4]); ring(ctx, start, 5);
        if (pt) {
          var end = V.forward(view, pt);
          if (tool === 'circle') ring(ctx, start, Math.hypot(end.x - start.x, end.y - start.y));
          else if (dimensionEnd) drawDimension(ctx, view, { x: anchor.x, y: anchor.y, x2: dimensionEnd.x, y2: dimensionEnd.y, meta: { offsetMm: ((pt.x - anchor.x) * -(dimensionEnd.y - anchor.y) + (pt.y - anchor.y) * (dimensionEnd.x - anchor.x)) / Math.hypot(dimensionEnd.x - anchor.x, dimensionEnd.y - anchor.y) } });
          else stroke(ctx, start, end);
          ring(ctx, end, 4);
          if (guides && tool === 'projector' && pt.viewRole === 'PROFILE') {
            var foot = V.forward(view, { x: pt.x, y: -(m.dRef + m.s * (pt.x - m.xRef)) });
            stroke(ctx, end, foot); stroke(ctx, foot, V.forward(view, { x: anchor.x, y: -(m.dRef + m.s * (pt.x - m.xRef)) }));
          }
        }
        var instruction = typed ? typed + ' mm · Enter' : tool === 'projector' ? 'Place matching projection · type distance' : tool === 'dimension' && dimensionEnd ? 'Place dimension' : tool === 'circle' ? 'Choose radius · type distance' : 'Choose endpoint · type length · Esc to finish';
        C.drawKnockoutLabel(ctx, instruction, Math.min(cursor.x + 14, view.w - 265), Math.max(140, cursor.y - 12), { font: '11px sans-serif', fillStyle: '#64748b' });
      }
      ctx.restore();
    }
    function drawSolid(ctx, st) {
      if (!solidVisible || !h.solidMm || !window.EduCADSpatial || options.getPose()) return;
      var keys = linked(), g = h.solidMm, Solid = window.EduCADSolid, Spatial = window.EduCADSpatial;
      ctx.save(); ctx.strokeStyle = '#58738c'; ctx.lineWidth = 2; ctx.setLineDash([]);
      keys.vertices.forEach(function (i) { ring(ctx, Spatial.projectMm(g.vertices[i], st, Solid), 6); });
      keys.edges.forEach(function (i) { var edge = g.edges[i]; stroke(ctx, Spatial.projectMm(g.vertices[edge[0]], st, Solid), Spatial.projectMm(g.vertices[edge[1]], st, Solid)); });
      ctx.restore();
    }
    var refreshQueued = false;
    h.table.subscribe(function (op) {
      if (op === 'clear') { editorOpen = false; closeMenu(); anchor = null; dimensionEnd = null; selected = null; solidSelection = null; typed = ''; projectTarget = null; }
      if (refreshQueued) return; refreshQueued = true;
      requestAnimationFrame(function () { refreshQueued = false; refresh(); redraw(); });
    });
    sync();
    return {
      preferences: function (values) {
        guides = !!values.guides; solidVisible = !!values.solid;
        if (h.solid && h.solid.canvas) { h.solid.canvas.hidden = !solidVisible; h.solid.canvas.style.display = solidVisible ? '' : 'none'; }
        if (h.spatialView) h.spatialView.panel.hidden = !solidVisible || h.measure.mode !== 'view';
        redraw();
      },
      root: root, refresh: refresh, cancel: function () { cancel(); selected = null; solidSelection = null; typed = ''; sync(); },
      layout: map, isVisible: isVisible, fit: fit, notify: hint, drawSheet: drawSheet, drawDynamic: drawDynamic, drawSolid: drawSolid, drawDimension: drawDimension,
      active: function () { return editMode() && (tool !== 'select' || !!drag); }, solidVisible: function () { return solidVisible; },
      setStyle: function (value) { style = value; styleSelect.value = value; },
      select: function (id) { selected = id; solidSelection = null; sync(); redraw(); },
      selectSolid: function (value) { selected = null; solidSelection = value; sync(); options.redrawDynamic(cursor); if (h.solid) h.solid.scheduleDraw(); },
      validation: function () { return validation; },
      modeChanged: function () { cancel(); selected = null; solidSelection = null; sync(); if (!solidVisible && h.spatialView) h.spatialView.panel.hidden = true; },
      projectCopies: function (ent, posed) { return profileCopies(ent, h.solidMm, posed, map()); }
    };
  }
  return { createHistory: createHistory, movePoint: movePoint, movePoints: movePoints, editPoint: editPoint, editEntity: editEntity, renamePoint: renamePoint, validateProfile: validateProfile, profileCopies: profileCopies, layoutOf: layoutOf, toView: toView, extent: extent, mount: mount };
});

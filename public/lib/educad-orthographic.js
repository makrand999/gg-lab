(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-measure.js'), require('./educad-geometry.js'), require('./educad-settings.js'));
  else root.EduCADOrthographic = factory(root.EduCADMeasure, root.EduCADGeometry, root.EduCADSettings);
})(typeof window !== 'undefined' ? window : globalThis, function (Measure, Geometry, Settings) {
  'use strict';
  var SPANS = ['SEGMENT', 'LINE', 'RAY', 'DIMENSION', 'DATUM_AXIS'];
  var TYPES = { POINT: 'Point', SEGMENT: 'Segment', LINE: 'Line', RAY: 'Ray', DIMENSION: 'Dimension', DATUM_AXIS: 'Datum', CIRCLE: 'Circle', CIRCULAR_ARC: 'Arc' };
  var VIEW_NAMES = { ELEVATION: 'Front · VP', PLAN: 'Top · HP', PROFILE: 'Side · profile', SHARED: 'Shared / XY' };
  function number(n, prefs) { return String(Number(n.toFixed(prefs.precision))); }
  function role(e) {
    if (['ELEVATION', 'PLAN', 'PROFILE'].indexOf(e.viewRole) !== -1) return e.viewRole;
    if (e.type === 'DATUM_AXIS' || (e.y === 0 && (e.y2 === undefined || e.y2 === 0)) ||
        (SPANS.indexOf(e.type) !== -1 && e.y * e.y2 < 0)) return 'SHARED';
    return e.y < 0 ? 'PLAN' : 'ELEVATION';
  }
  function category(e) { return e.type === 'POINT' ? 'points' : SPANS.indexOf(e.type) !== -1 ? 'lines' : 'curves'; }
  function construction(e) {
    return e.type === 'DATUM_AXIS' || ['G', 'H', 'K'].indexOf(e.bisCode) !== -1 ||
      !!(e.meta && ['axis', 'locus', 'projector', 'construction'].indexOf(e.meta.kind) !== -1);
  }
  function endpointName(e, entities, second) {
    var refs = e.meta && (e.meta.endpointRefs || e.meta.refs), p;
    if (refs && refs.length === 2) p = entities.find(function (item) { return item.type === 'POINT' && item.id === refs[second ? 1 : 0]; });
    if (!p) {
      var x = second ? e.x2 : e.x, y = second ? e.y2 : e.y;
      var candidates = entities.filter(function (item) { return item.type === 'POINT' && role(item) === role(e) && Math.hypot(item.x - x, item.y - y) < 1e-6; });
      if (candidates.length === 1) p = candidates[0];
    }
    return p ? String(p.caption || p.name || '') : '';
  }
  function title(e, entities) {
    entities = entities || [];
    if (e.type === 'POINT') return String(e.caption || e.name || 'Point');
    if (e.caption) return TYPES[e.type] + ' ' + e.caption;
    if (SPANS.indexOf(e.type) !== -1) {
      var a = endpointName(e, entities, false), b = endpointName(e, entities, true);
      if (a && b) return TYPES[e.type] + ' ' + a + '–' + b;
    }
    if (e.name && !/^E\d+$/.test(e.name)) return TYPES[e.type] + ' ' + e.name;
    var peers = entities.filter(function (item) { return item.type === e.type; });
    return TYPES[e.type] + (peers.length > 1 ? ' ' + (peers.findIndex(function (item) { return item.id === e.id; }) + 1) : '');
  }
  function specs(e, entities, preferences, map) {
    if (!Measure.inspectEntity(e)) return null;
    var prefs = Settings.normalizeSheetInspection(preferences), r = role(e), rows = [['View', VIEW_NAMES[r]]], dx, dy, length;
    function mm(n) { return number(n, prefs) + ' mm'; }
    function xy(x, y) { return '(' + number(x, prefs) + ', ' + number(y, prefs) + ') mm'; }
    if (e.type === 'POINT') {
      if (prefs.coordinates) rows.push(['Sheet X / Y', xy(e.x, e.y)]);
      if (prefs.offsets) {
        if (r === 'PROFILE' && map && map.three && Number.isFinite(map.xRef) && Number.isFinite(map.dRef) && (map.s === 1 || map.s === -1)) {
          rows.push(['Height from HP', mm(e.y)]);
          rows.push(['Depth from VP', mm(map.dRef + map.s * (e.x - map.xRef))]);
          rows.push(['Offset from X₁Y₁', mm(map.s * (e.x - map.xRef))]);
        } else if (r === 'ELEVATION') rows.push(['Height from HP', mm(e.y) + (e.y < 0 ? ' · below' : e.y > 0 ? ' · above' : ' · on HP')]);
        else if (r === 'PLAN') rows.push(['Depth from VP', mm(-e.y) + (e.y > 0 ? ' · behind' : e.y < 0 ? ' · in front' : ' · on VP')]);
        else rows.push(['Distance from XY', mm(Math.abs(e.y))]);
      }
    } else if (SPANS.indexOf(e.type) !== -1) {
      dx = e.x2 - e.x; dy = e.y2 - e.y; length = Math.hypot(dx, dy);
      if (prefs.coordinates) rows.push(['Start', xy(e.x, e.y)], ['End', xy(e.x2, e.y2)]);
      if (prefs.lengths) rows.push([e.type === 'LINE' || e.type === 'RAY' || e.type === 'DATUM_AXIS' ? 'Defined span' : 'Projected length', mm(length)], ['ΔX / ΔY', mm(dx) + ' / ' + mm(dy)]);
      if (prefs.angles) rows.push(['Orientation from +X', length > 1e-9 ? number(Measure.lineAngleDeg(dx, dy), prefs) + '°' : '—']);
      if (e.type === 'LINE') rows.push(['Extent', 'Infinite in both directions']);
      if (e.type === 'RAY') rows.push(['Extent', 'Infinite from its start']);
    } else {
      if (prefs.coordinates) rows.push(['Center', xy(e.x, e.y)]);
      if (prefs.radii) rows.push(['Radius', mm(e.radius)], ['Diameter', mm(2 * e.radius)]);
      if (e.type === 'CIRCLE' && prefs.curveProperties) rows.push(['Circumference', mm(2 * Math.PI * e.radius)], ['Circle area', number(Math.PI * e.radius * e.radius, prefs) + ' mm²']);
      if (e.type === 'CIRCULAR_ARC') {
        var sweep = Geometry.arcSweep(e.startAngle, e.endAngle);
        if (prefs.angles) rows.push(['Sweep', number(sweep, prefs) + '°'], ['Start / end angle', number(e.startAngle, prefs) + '° / ' + number(e.endAngle, prefs) + '°']);
        if (prefs.curveProperties) rows.push(['Arc length', mm(e.radius * sweep * Geometry.RAD)]);
        if (prefs.lengths) rows.push(['Chord length', mm(2 * e.radius * Math.abs(Math.sin(sweep * Geometry.RAD / 2)))]);
        if (prefs.coordinates) {
          [e.startAngle, e.endAngle].forEach(function (angle, i) {
            rows.push([i ? 'Arc end' : 'Arc start', xy(e.x + e.radius * Math.cos(angle * Geometry.RAD), e.y + e.radius * Math.sin(angle * Geometry.RAD))]);
          });
        }
      }
    }
    return { id: e.id, title: title(e, entities), role: r, kind: category(e), rows: rows };
  }
  function inventory(entities, preferences, query) {
    var prefs = Settings.normalizeSheetInspection(preferences), search = String(query || '').trim().toLowerCase().replace(/-/g, '–');
    return entities.filter(function (e) {
      if (!Measure.inspectEntity(e) || !prefs[category(e)] || (!prefs.construction && construction(e))) return false;
      if (prefs.view !== 'all' && role(e).toLowerCase() !== prefs.view) return false;
      return !search || (title(e, entities) + ' ' + VIEW_NAMES[role(e)] + ' ' + TYPES[e.type]).toLowerCase().indexOf(search) !== -1;
    });
  }
  function togglePin(pins, id, side) {
    if (pins.some(function (pin) { return pin.id === id; })) return pins.filter(function (pin) { return pin.id !== id; });
    return pins.concat([{ id: id, side: side === -1 ? -1 : 1 }]);
  }
  function overlayItems(entities, selectedId, side, pins, preferences) {
    var prefs = Settings.normalizeSheetInspection(preferences), out = [], seen = {};
    function add(id, itemSide, focused) {
      var e = entities.find(function (item) { return item.id === id; });
      if (!e || !Measure.inspectEntity(e) || seen[id]) return;
      if (id !== selectedId && prefs.view !== 'all' && role(e).toLowerCase() !== prefs.view) return;
      seen[id] = true; out.push({ entity: e, side: itemSide, focused: !!focused });
    }
    add(selectedId, side, true);
    if (prefs.overlay !== 'selected') pins.forEach(function (pin) { add(pin.id, pin.side, true); });
    if (prefs.overlay === 'all') inventory(entities, prefs).forEach(function (e) { add(e.id, 1, false); });
    return out;
  }
  function compactRows(spec, detailed) {
    var rows = spec.rows.filter(function (row) { return row[0] !== 'View' && row[0] !== 'Extent'; });
    if (detailed) return rows.slice(0, 3);
    var priority = spec.kind === 'points' ? ['Sheet X / Y', 'Height from HP', 'Depth from VP'] : spec.kind === 'lines' ? ['Projected length', 'Defined span', 'Orientation from +X'] : ['Radius', 'Arc length', 'Circumference', 'Sweep'];
    return priority.map(function (key) { return rows.find(function (row) { return row[0] === key; }); }).filter(Boolean).slice(0, 1);
  }
  function comparison(a, b, preferences) {
    var prefs = Settings.normalizeSheetInspection(preferences);
    if (!a || !b || !Measure.inspectEntity(a) || !Measure.inspectEntity(b)) return null;
    if (role(a) !== role(b)) return { note: 'Choose two items in the same orthographic view to compare.', rows: [] };
    var rows = [], dx, dy;
    if (a.type === 'POINT' && b.type === 'POINT') {
      dx = b.x - a.x; dy = b.y - a.y;
      if (prefs.lengths) rows.push(['Projected distance', number(Math.hypot(dx, dy), prefs) + ' mm'], ['ΔX / ΔY', number(dx, prefs) + ' / ' + number(dy, prefs) + ' mm']);
      return { note: 'Second point relative to first · ' + VIEW_NAMES[role(a)], rows: rows };
    }
    if (SPANS.indexOf(a.type) !== -1 && SPANS.indexOf(b.type) !== -1) {
      var ax = a.x2 - a.x, ay = a.y2 - a.y, bx = b.x2 - b.x, by = b.y2 - b.y;
      var al = Math.hypot(ax, ay), bl = Math.hypot(bx, by);
      if (prefs.lengths) rows.push(['Span difference (2 − 1)', number(bl - al, prefs) + ' mm']);
      if (prefs.angles) rows.push(['Smaller angle', al > 1e-9 && bl > 1e-9 ? number(Math.atan2(Math.abs(ax * by - ay * bx), Math.abs(ax * bx + ay * by)) / Geometry.RAD, prefs) + '°' : '—']);
      return { note: VIEW_NAMES[role(a)] + ' · projected spans', rows: rows };
    }
    return { note: 'Pin two points or two straight edges in one view to compare.', rows: [] };
  }
  function viewBounds(entities, view) {
    var out = {};
    entities.forEach(function (e) {
      if (!Measure.inspectEntity(e) || construction(e)) return;
      var r = role(e); if (r === 'SHARED') return;
      if (!out[r]) out[r] = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      var points = [{ x: e.x, y: e.y }];
      if (SPANS.indexOf(e.type) !== -1) points.push({ x: e.x2, y: e.y2 });
      if (e.radius) points.push({ x: e.x - e.radius, y: e.y - e.radius }, { x: e.x + e.radius, y: e.y + e.radius });
      points.forEach(function (point) {
        var x = point.x * view.s + view.tx, y = view.ty - point.y * view.s, b = out[r];
        b.x0 = Math.min(b.x0, x - 10); b.x1 = Math.max(b.x1, x + 10); b.y0 = Math.min(b.y0, y - 10); b.y1 = Math.max(b.y1, y + 10);
      });
    });
    return out;
  }
  function mount(handle, spatial, container, options) {
    options = options || {};
    var prefs = Settings.normalizeSheetInspection(), pins = [], query = '', tab = spatial ? 'solid' : 'sheet';
    var revision = -1, lastSelected, records = [], entities = [], map = null, expandedSpecs = false;
    var panel = spatial ? spatial.panel : document.createElement('aside');
    if (!spatial) { panel.className = 'spatial-panel'; panel.innerHTML = '<div class="spatial-head"><span>Orthographic view</span><div></div></div>'; container.appendChild(panel); }
    panel.setAttribute('aria-label', 'Drawing inspection');
    var head = panel.querySelector('.spatial-head'), heading = head.querySelector('span'), solidActions = head.querySelector('div');
    var solidBody = document.createElement('div'); solidBody.className = 'inspection-solid-body';
    Array.from(panel.children).forEach(function (node) { if (node !== head) solidBody.appendChild(node); });
    var switcher = document.createElement('div'); switcher.className = 'inspection-switch'; switcher.setAttribute('role', 'group'); switcher.setAttribute('aria-label', 'Inspection workspace');
    switcher.innerHTML = '<button type="button" data-inspect-tab="sheet">2D</button><button type="button" data-inspect-tab="solid">3D</button>';
    panel.appendChild(switcher); panel.appendChild(solidBody);
    var fit = document.createElement('button'); fit.type = 'button'; fit.textContent = 'Fit sheet'; fit.dataset.sheetAction = 'fit'; head.appendChild(fit);
    var sheet = document.createElement('div'); sheet.className = 'inspection-sheet-body';
    sheet.innerHTML = '<p class="sheet-summary spatial-summary"></p><p class="spatial-hint">Click geometry to inspect · Pin two points or edges to compare</p>' +
      '<div class="sheet-tools"><div role="group" aria-label="Sheet measurement overlays"><button type="button" data-sheet-overlay="selected">Selected</button><button type="button" data-sheet-overlay="pinned">Pinned</button><button type="button" data-sheet-overlay="all">All</button></div><select class="sheet-view-filter" aria-label="Orthographic view filter"><option value="all">All views</option><option value="elevation">Front · VP</option><option value="plan">Top · HP</option><option value="profile">Side</option></select></div>' +
      '<details class="sheet-filter"><summary>Filter measurements</summary><div class="sheet-filter-fields"></div></details>' +
      '<div class="sheet-selection spatial-selection" hidden aria-live="polite"></div><div class="sheet-pins spatial-pins" hidden></div><div class="sheet-comparison" hidden></div>' +
      '<p class="sheet-label-note spatial-note" hidden>Some labels are hidden to avoid overlap. All specs remain in Sheet details.</p>' +
      '<details class="sheet-details"><summary>Sheet details</summary><input class="sheet-search spatial-search" type="search" aria-label="Find sheet geometry" placeholder="Find a label, edge, circle or view"><div class="sheet-inventory-tools"><button type="button" data-sheet-action="expand-specs" aria-pressed="false">Expand specs</button></div><div class="sheet-inventory"></div></details>';
    panel.appendChild(sheet);
    var fields = sheet.querySelector('.sheet-filter-fields'), selectedEl = sheet.querySelector('.sheet-selection');
    var pinsEl = sheet.querySelector('.sheet-pins'), compareEl = sheet.querySelector('.sheet-comparison');
    var dataEl = sheet.querySelector('.sheet-inventory'), details = sheet.querySelector('.sheet-details');
    var labelNote = sheet.querySelector('.sheet-label-note');
    ['points', 'lines', 'curves', 'construction', 'coordinates', 'offsets', 'lengths', 'angles', 'radii', 'curveProperties'].forEach(function (key) {
      var row = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.dataset.sheetPreference = key;
      row.appendChild(input); row.appendChild(document.createTextNode(Settings.SHEET_INSPECTION_FIELDS[key].label)); fields.appendChild(row);
    });
    function table(parent, rows) {
      var wrap = document.createElement('div'); wrap.className = 'spatial-table-scroll';
      var tableEl = document.createElement('table'), body = document.createElement('tbody'); tableEl.appendChild(body); wrap.appendChild(tableEl); parent.appendChild(wrap);
      rows.forEach(function (values) { var tr = body.insertRow(); values.forEach(function (value) { var td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }); });
    }
    function button(parent, label, action, id) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.sheetAction = action;
      if (id !== undefined) b.dataset.sheetId = id; parent.appendChild(b); return b;
    }
    function record(id) { return records.find(function (entry) { return entry.id === id; }); }
    function renderSelection() {
      selectedEl.replaceChildren(); var spec = record(handle.measure.inspectId); selectedEl.hidden = !spec;
      if (spec) {
        var header = document.createElement('div'); header.className = 'spatial-selection-head';
        var name = document.createElement('strong'); name.textContent = spec.title; header.appendChild(name);
        var actions = document.createElement('div'); header.appendChild(actions);
        var pinned = pins.some(function (pin) { return pin.id === spec.id; });
        button(actions, pinned ? 'Unpin' : 'Pin', 'pin', spec.id).setAttribute('aria-pressed', String(pinned));
        button(actions, '×', 'clear').setAttribute('aria-label', 'Clear 2D selection'); selectedEl.appendChild(header);
        table(selectedEl, spec.rows);
      }
      dataEl.querySelectorAll('[data-sheet-action="select"]').forEach(function (b) {
        var active = b.dataset.sheetId === handle.measure.inspectId;
        b.setAttribute('aria-pressed', String(active)); b.closest('.sheet-record').classList.toggle('spatial-active-row', active);
      });
    }
    function renderPins() {
      pinsEl.replaceChildren(); pinsEl.hidden = !pins.length;
      if (pins.length) {
        var header = document.createElement('div'); header.className = 'spatial-selection-head';
        var name = document.createElement('span'); name.textContent = 'Pinned (' + pins.length + ')'; header.appendChild(name);
        button(header, 'Clear pins', 'clear-pins'); pinsEl.appendChild(header);
        pins.forEach(function (pin) {
          var spec = record(pin.id); if (!spec) return;
          var row = document.createElement('div'); row.className = 'spatial-pin-row';
          button(row, spec.title, 'select', pin.id);
          var value = document.createElement('span'); value.textContent = VIEW_NAMES[spec.role] + ' · ' + compactRows(spec, false).map(function (r) { return r[1]; }).join(' · '); row.appendChild(value);
          button(row, '×', 'unpin', pin.id).setAttribute('aria-label', 'Unpin ' + spec.title); pinsEl.appendChild(row);
        });
      }
      compareEl.replaceChildren(); compareEl.hidden = pins.length !== 2;
      if (pins.length === 2) {
        var a = entities.find(function (e) { return e.id === pins[0].id; }), b = entities.find(function (e) { return e.id === pins[1].id; });
        var compared = comparison(a, b, prefs);
        if (compared) {
          var name = document.createElement('div'); name.className = 'sheet-compare-title'; name.textContent = 'Compare · ' + title(a, entities) + ' / ' + title(b, entities); compareEl.appendChild(name);
          var note = document.createElement('p'); note.className = 'spatial-note'; note.textContent = compared.note; compareEl.appendChild(note); table(compareEl, compared.rows);
        }
      }
    }
    function renderInventory() {
      var open = {}; dataEl.querySelectorAll('details[data-sheet-group]').forEach(function (group) { open[group.dataset.sheetGroup] = group.open; });
      dataEl.replaceChildren(); var items = inventory(entities, prefs, query);
      ['ELEVATION', 'PLAN', 'PROFILE', 'SHARED'].forEach(function (r) {
        var list = items.filter(function (e) { return role(e) === r; }); if (!list.length) return;
        var group = document.createElement('details'); group.dataset.sheetGroup = r; group.open = !!query || prefs.overlay === 'all' || !!open[r];
        var summary = document.createElement('summary'); summary.textContent = VIEW_NAMES[r] + ' (' + list.length + ')'; group.appendChild(summary);
        list.forEach(function (e) {
          var spec = record(e.id), row = document.createElement('div'); row.className = 'sheet-record';
          var b = button(row, spec.title, 'select', e.id); b.title = 'Inspect ' + spec.title;
          if (pins.some(function (pin) { return pin.id === e.id; })) row.classList.add('spatial-pinned-row');
          var values = document.createElement('span'); values.textContent = compactRows(spec, false).map(function (entry) { return entry[0] + ' ' + entry[1]; }).join(' · ') || TYPES[e.type]; row.appendChild(values);
          var expanded = document.createElement('details'); expanded.className = 'sheet-full-specs'; expanded.open = expandedSpecs;
          var label = document.createElement('summary'); label.textContent = 'Specs'; expanded.appendChild(label); table(expanded, spec.rows); row.appendChild(expanded); group.appendChild(row);
        });
        dataEl.appendChild(group);
      });
      if (!items.length) { var empty = document.createElement('p'); empty.className = 'spatial-note'; empty.textContent = query ? 'No matching geometry.' : 'No geometry matches these filters.'; dataEl.appendChild(empty); }
      var counts = {};
      items.forEach(function (e) { counts[role(e)] = (counts[role(e)] || 0) + 1; });
      sheet.querySelector('.sheet-summary').textContent = Object.keys(counts).map(function (r) { return VIEW_NAMES[r].split(' · ')[0] + ' ' + counts[r]; }).join(' · ') || 'Draw or load a sheet to inspect.';
    }
    function sync() {
      var currentRevision = handle.table.revision();
      if (revision !== currentRevision) {
        pins = []; revision = currentRevision; entities = options.entities(); map = options.layout();
        records = entities.map(function (e) { return specs(e, entities, prefs, map); }).filter(Boolean);
        if (handle.measure.inspectId && !record(handle.measure.inspectId)) Measure.clearInspect(handle.measure);
        renderInventory(); renderPins(); lastSelected = undefined;
      }
      if (lastSelected !== handle.measure.inspectId) { lastSelected = handle.measure.inspectId; renderSelection(); }
      var available = !!spatial && !!handle.solid.state.geometryMm && (!handle.drafting || handle.drafting.solidVisible());
      if (tab === 'solid' && !available) tab = 'sheet';
      panel.hidden = handle.measure.mode !== 'view';
      solidBody.hidden = tab !== 'solid'; sheet.hidden = tab !== 'sheet'; solidActions.hidden = tab !== 'solid'; fit.hidden = tab !== 'sheet';
      heading.textContent = tab === 'sheet' ? 'Orthographic view' : 'Spatial view';
      switcher.querySelector('[data-inspect-tab="solid"]').disabled = !available;
      switcher.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.inspectTab === tab)); });
      if (typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive()) panel.style.maxHeight = 'none';
      else if (!panel.hidden) {
        panel.style.maxHeight = Math.max(90, window.innerHeight - panel.getBoundingClientRect().top - 24) + 'px';
      }
    }
    function activate(value) { tab = value === 'solid' ? 'solid' : 'sheet'; sync(); }
    function setPreferences(value) {
      var oldScope = prefs.overlay; prefs = Settings.normalizeSheetInspection(value);
      if (oldScope !== 'all' && prefs.overlay === 'all') details.open = true;
      fields.querySelectorAll('input').forEach(function (input) { input.checked = prefs[input.dataset.sheetPreference]; });
      sheet.querySelector('.sheet-view-filter').value = prefs.view;
      sheet.querySelectorAll('[data-sheet-overlay]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.sheetOverlay === prefs.overlay)); });
      entities = options.entities(); map = options.layout(); records = entities.map(function (e) { return specs(e, entities, prefs, map); }).filter(Boolean);
      renderInventory(); renderSelection(); renderPins(); sync();
    }
    function change(key, value) {
      var next = Object.assign({}, prefs); next[key] = value; setPreferences(next);
      if (options.onPreferencesChange) options.onPreferencesChange(Object.assign({}, prefs));
      options.redraw();
    }
    function choose(id) {
      sync(); var e = entities.find(function (item) { return item.id === id; }); if (!e) return;
      activate('sheet'); options.select(id, Measure.dimSideFor(e, handle.view, Measure.inspectAnchor(e, handle.view))); sync();
    }
    panel.addEventListener('click', function (event) {
      var b = event.target.closest('button'); if (!b) return;
      if (b.dataset.inspectTab) { activate(b.dataset.inspectTab); options.redraw(); }
      if (b.dataset.sheetOverlay) { change('overlay', b.dataset.sheetOverlay); return; }
      var action = b.dataset.sheetAction;
      if (action === 'fit') options.fit();
      else if (action === 'expand-specs') {
        expandedSpecs = !expandedSpecs; b.textContent = expandedSpecs ? 'Collapse specs' : 'Expand specs';
        b.setAttribute('aria-pressed', String(expandedSpecs));
        dataEl.querySelectorAll('.sheet-full-specs').forEach(function (spec) { spec.open = expandedSpecs; });
        options.redraw();
      }
      else if (action === 'select') choose(b.dataset.sheetId);
      else if (action === 'clear') { options.select(null, null); sync(); }
      else if (action === 'pin') {
        pins = togglePin(pins, b.dataset.sheetId, handle.measure.inspectSide);
        if (pins.length && prefs.overlay === 'selected') change('overlay', 'pinned');
        renderInventory(); renderSelection(); renderPins(); options.redraw();
      } else if (action === 'unpin') { pins = pins.filter(function (pin) { return pin.id !== b.dataset.sheetId; }); renderInventory(); renderSelection(); renderPins(); options.redraw(); }
      else if (action === 'clear-pins') { pins = []; renderInventory(); renderSelection(); renderPins(); options.redraw(); }
    });
    sheet.addEventListener('change', function (event) {
      if (event.target.dataset.sheetPreference) change(event.target.dataset.sheetPreference, event.target.checked);
      else if (event.target.classList.contains('sheet-view-filter')) change('view', event.target.value);
    });
    sheet.querySelector('.sheet-search').addEventListener('input', function (event) { query = event.target.value; renderInventory(); renderSelection(); options.redraw(); });
    panel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && tab === 'sheet') { options.select(null, null); sync(); }
      event.stopPropagation();
    });
    panel.addEventListener('toggle', function () { options.redraw(); }, true);
    ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'wheel', 'contextmenu'].forEach(function (type) { panel.addEventListener(type, function (event) { event.stopPropagation(); }); });
    setPreferences(prefs);
    function drawOverlay(ctx, view) {
      sync(); if (handle.measure.mode !== 'view') return;
      var items = overlayItems(entities, handle.measure.inspectId, handle.measure.inspectSide, pins, prefs);
      ctx.save(); ctx.font = prefs.textSize + 'px system-ui, sans-serif'; ctx.textBaseline = 'middle';
      var occupied = [], suppressed = 0;
      var bounds = viewBounds(entities, view);
      Object.keys(bounds).forEach(function (r) { occupied.push(bounds[r]); });
      var canvasBox = handle.mount.layer2.getBoundingClientRect(), panelBox = panel.getBoundingClientRect();
      if (!panel.hidden) occupied.push({ x0: panelBox.left - canvasBox.left, y0: panelBox.top - canvasBox.top, x1: panelBox.right - canvasBox.left, y1: panelBox.bottom - canvasBox.top });
      if (!(typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive())) {
        occupied.push({ x0: 0, y0: 0, x1: view.w, y1: 38 });
        if (handle.solid && handle.solid.state.geometryMm && handle.drafting.solidVisible()) {
          var points = handle.solid.state.geometryMm.vertices.map(function (p) { return EduCADSpatial.projectMm(p, handle.solid.state, EduCADSolid); });
          occupied.push({ x0: Math.min.apply(null, points.map(function (p) { return p.x; })) - 10, x1: Math.max.apply(null, points.map(function (p) { return p.x; })) + 10,
            y0: Math.min.apply(null, points.map(function (p) { return p.y; })) - 10, y1: Math.max.apply(null, points.map(function (p) { return p.y; })) + 10 });
        }
      }
      entities.forEach(function (e) {
        var anchor = Measure.inspectAnchor(e, view); if (!anchor) return;
        if (e.type === 'POINT') {
          occupied.push({ x0: anchor.x - 5, y0: anchor.y - 5, x1: anchor.x + 5, y1: anchor.y + 5 });
          if (e.showLabel !== false && e.caption) occupied.push({ x0: anchor.x - 8, y0: anchor.y - 24, x1: anchor.x + ctx.measureText(e.caption).width + 8, y1: anchor.y - 5 });
        }
      });
      function segment(a, b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      function arrow(a, b) {
        var dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy); if (!length) return;
        var ux = dx / length, uy = dy / length;
        segment(b, { x: b.x - ux * 7 + uy * 2.5, y: b.y - uy * 7 - ux * 2.5 });
        segment(b, { x: b.x - ux * 7 - uy * 2.5, y: b.y - uy * 7 + ux * 2.5 });
      }
      function overlap(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
      function label(anchor, lines, color, preferred, referenceBounds) {
        var width = Math.max.apply(null, lines.map(function (line) { return ctx.measureText(line).width; })) + 10;
        var height = lines.length * (prefs.textSize + 4) + 6;
        var candidates = preferred ? [[preferred.x, preferred.y - prefs.textSize - 3]] : [];
        [[12, -height - 10], [12, 12], [-width - 12, -height - 10], [-width - 12, 12], [-width / 2, -height - 28], [-width / 2, 28], [24, -height / 2], [-width - 24, -height / 2]].forEach(function (offset) { candidates.push([anchor.x + offset[0], anchor.y + offset[1]]); });
        if (referenceBounds) candidates = candidates.concat([
          [referenceBounds.x1 + 12, anchor.y - height / 2], [referenceBounds.x0 - width - 12, anchor.y - height / 2],
          [referenceBounds.x1 + 12, anchor.y - height - 10], [referenceBounds.x0 - width - 12, anchor.y - height - 10],
          [referenceBounds.x1 + 12, anchor.y + 12], [referenceBounds.x0 - width - 12, anchor.y + 12]
        ]);
        for (var i = 0; i < candidates.length; i++) {
          var x = candidates[i][0], y = candidates[i][1], rect = { x0: x - 3, y0: y - 3, x1: x + width + 3, y1: y + height + 3 };
          if (x < 6 || y < 6 || rect.x1 > view.w - 6 || rect.y1 > view.h - 6 || occupied.some(function (box) { return overlap(rect, box); })) continue;
          occupied.push(rect);
          ctx.strokeStyle = '#a8b8c7'; ctx.lineWidth = 0.6;
          segment(anchor, { x: Math.max(x, Math.min(x + width, anchor.x)), y: Math.max(y, Math.min(y + height, anchor.y)) });
          ctx.fillStyle = 'rgba(248, 250, 252, 0.97)'; ctx.fillRect(x, y, width, height); ctx.fillStyle = color; ctx.textAlign = 'left';
          lines.forEach(function (line, index) { ctx.fillText(line, x + 5, y + 3 + (prefs.textSize + 4) * (index + 0.5)); });
          return true;
        }
        suppressed++; return false;
      }
      items.forEach(function (item) {
        var e = item.entity, spec = record(e.id), anchor = Measure.inspectAnchor(e, view); if (!spec || !anchor) return;
        var color = e.id === handle.measure.inspectId ? '#415c74' : '#7d8997';
        ctx.strokeStyle = color; ctx.lineWidth = item.focused ? 1.5 : 0.75; ctx.setLineDash([]);
        if (item.focused) {
          if (SPANS.indexOf(e.type) !== -1) segment({ x: e.x * view.s + view.tx, y: view.ty - e.y * view.s }, { x: e.x2 * view.s + view.tx, y: view.ty - e.y2 * view.s });
          else { ctx.beginPath();
            if (e.type === 'POINT') ctx.arc(anchor.x, anchor.y, 6, 0, Math.PI * 2);
            else if (e.type === 'CIRCULAR_ARC') ctx.arc(anchor.x, anchor.y, e.radius * view.s, -e.startAngle * Geometry.RAD, -(e.startAngle + Geometry.arcSweep(e.startAngle, e.endAngle)) * Geometry.RAD, true);
            else ctx.arc(anchor.x, anchor.y, e.radius * view.s, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        if (item.focused && prefs.dimensions) {
          ctx.lineWidth = 0.8; ctx.strokeStyle = '#8a9dad';
          if (SPANS.indexOf(e.type) !== -1 && prefs.lengths && e.type !== 'LINE' && e.type !== 'RAY' && e.type !== 'DATUM_AXIS') {
            var linear = Measure.linearDimLayout(e, view, { side: item.side, measure: function (text) { return ctx.measureText(text).width; }, offsetMm: Math.max(10, 24 / view.s), lineH: prefs.textSize + 4 });
            if (linear) {
              var dimensionBox = { x0: Math.min(linear.d1.x, linear.d2.x) - 2, x1: Math.max(linear.d1.x, linear.d2.x) + 2,
                y0: Math.min(linear.d1.y, linear.d2.y) - 2, y1: Math.max(linear.d1.y, linear.d2.y) + 2 };
              if (!Object.keys(bounds).some(function (r) { return overlap(dimensionBox, bounds[r]); })) {
                linear.ext.forEach(function (pair) { segment(pair[0], pair[1]); }); segment(linear.d1, linear.d2);
                arrow(linear.d2, linear.d1); arrow(linear.d1, linear.d2);
                if (prefs.labels) label({ x: (linear.d1.x + linear.d2.x) / 2, y: (linear.d1.y + linear.d2.y) / 2 }, [number(linear.lenMm, prefs) + ' mm'], color, linear.textPos, bounds[spec.role]);
              }
            }
          } else if ((e.type === 'CIRCLE' || e.type === 'CIRCULAR_ARC') && prefs.radii) {
            var radial = Measure.radiusLeaderLayout(e, view, { measure: function (text) { return ctx.measureText(text).width; } });
            if (radial) { radial.centerMark.forEach(function (pair) { segment(pair[0], pair[1]); }); segment(radial.rim, radial.elbow); segment(radial.elbow, radial.shelfEnd); arrow(radial.elbow, radial.rim); }
          } else if (e.type === 'POINT' && prefs.offsets) {
            var witness = Measure.pointWitnessLayout(e, view, {});
            if (witness) { ctx.setLineDash([3, 5]); segment(witness.pt, witness.foot); ctx.setLineDash([]); }
            if (role(e) === 'PROFILE' && map && map.three) { ctx.setLineDash([3, 5]); segment(anchor, { x: map.xRef * view.s + view.tx, y: anchor.y }); ctx.setLineDash([]); }
          }
        }
        if (prefs.labels) {
          var lines = [spec.title + ' · ' + VIEW_NAMES[spec.role].split(' · ')[0]].concat(compactRows(spec, item.focused).map(function (row) { return row[0] + ' ' + row[1]; }));
          if (lines.length > 1) label(anchor, lines, color, null, bounds[spec.role]);
        }
      });
      ctx.restore(); labelNote.hidden = !prefs.labels || !suppressed;
    }
    return {
      panel: panel, sheet: sheet, sync: sync, activate: activate,
      modeChanged: sync, selectionChanged: function () { activate('sheet'); sync(); },
      setPreferences: setPreferences, preferences: function () { return Object.assign({}, prefs); },
      pins: function () { return pins.map(function (pin) { return Object.assign({}, pin); }); },
      linksEnabled: function () { return handle.measure.mode !== 'view' || prefs.links; },
      drawOverlay: drawOverlay
    };
  }
  return { role: role, title: title, specs: specs, inventory: inventory, togglePin: togglePin, overlayItems: overlayItems, comparison: comparison, viewBounds: viewBounds, mount: mount };
});

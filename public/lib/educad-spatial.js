(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.EduCADSpatial = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  // World coordinates are millimeters: X along XY, Y above HP, Z in front
  // of VP. Reference surfaces use exactly the object's display transform.
  var EPS = 1e-6;
  function fmt(n) { return String(Number(n.toFixed(2))); }
  function bounds(g) {
    if (!g || !g.vertices || !g.vertices.length) return null;
    var b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    g.vertices.forEach(function (p) {
      ['X', 'Y', 'Z'].forEach(function (a) {
        b['min' + a] = Math.min(b['min' + a], p[a.toLowerCase()]);
        b['max' + a] = Math.max(b['max' + a], p[a.toLowerCase()]);
      });
    });
    return b;
  }
  function references(g) {
    var b = bounds(g);
    if (!b) return null;
    var span = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, 20);
    var pad = span * 0.18;
    var x0 = b.minX - pad, x1 = b.maxX + pad;
    var y0 = Math.min(0, b.minY) - pad, y1 = Math.max(0, b.maxY) + pad;
    var z0 = Math.min(0, b.minZ) - pad, z1 = Math.max(0, b.maxZ) + pad;
    // Give a lone point or a vertical line enough sheet width to read.
    if (x1 - x0 < span * 0.75) {
      var mid = (x0 + x1) / 2;
      x0 = mid - span * 0.375; x1 = mid + span * 0.375;
    }
    return {
      hp: [{ x: x0, y: 0, z: z0 }, { x: x1, y: 0, z: z0 }, { x: x1, y: 0, z: z1 }, { x: x0, y: 0, z: z1 }],
      vp: [{ x: x0, y: y0, z: 0 }, { x: x1, y: y0, z: 0 }, { x: x1, y: y1, z: 0 }, { x: x0, y: y1, z: 0 }],
      xy: [{ x: x0, y: 0, z: 0 }, { x: x1, y: 0, z: 0 }],
      labels: [
        { text: 'HP · Top view', p: { x: (x0 + x1) / 2, y: 0, z: z1 }, color: '#817a6c' },
        { text: 'VP · Front view', p: { x: (x0 + x1) / 2, y: y1, z: 0 }, color: '#718399' },
        { text: 'XY', p: { x: x0, y: 0, z: 0 }, color: '#64748b' }
      ]
    };
  }
  function toStage(p, t) {
    return { x: (p.x - t.cx) * t.scale, y: (p.y - t.cy) * t.scale, z: (p.z - t.cz) * t.scale };
  }
  function projectMm(p, st, solid) {
    var q = toStage(p, st.geometryTransform);
    var r = solid.rotateDir(q.x, q.y, q.z, st.yaw, st.pitch);
    var radius = solid.projectionRadius(st);
    return { x: st.cx + r.x * radius, y: st.cy - r.y * radius, z: r.z };
  }
  function planeRelation(lo, hi, plane) {
    var positive = plane === 'HP' ? 'above' : 'in front of';
    var negative = plane === 'HP' ? 'below' : 'behind';
    if (Math.abs(lo) < EPS && Math.abs(hi) < EPS) return 'On ' + plane;
    if (lo < -EPS && hi > EPS) return 'Crosses ' + plane;
    if (Math.abs(lo) < EPS || Math.abs(hi) < EPS) return 'Touches ' + plane;
    return fmt(lo > 0 ? lo : -hi) + ' mm ' + (lo > 0 ? positive : negative) + ' ' + plane;
  }
  function summary(g) {
    var b = bounds(g);
    return b ? planeRelation(b.minY, b.maxY, 'HP') + ' · ' + planeRelation(b.minZ, b.maxZ, 'VP') : '';
  }
  function edgeInfo(g, index) {
    var e = g && g.edges && g.edges[index];
    if (!e) return null;
    var a = g.vertices[e[0]], b = g.vertices[e[1]];
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    var length = Math.hypot(dx, dy, dz);
    return { a: e[0], b: e[1], length: length,
      hp: length > EPS ? Math.asin(Math.min(1, Math.abs(dy) / length)) * 180 / Math.PI : null,
      vp: length > EPS ? Math.asin(Math.min(1, Math.abs(dz) / length)) * 180 / Math.PI : null };
  }
  // Vertex picks win near endpoints; frontmost wins when points overlap.
  function pick(st, x, y, solid) {
    if (!st.geometryMm || !solid.statusOf(st).available) return null;
    var pts = st.geometryMm.vertices.map(function (p) { return projectMm(p, st, solid); });
    var hit = null, dist = 10, depth = -Infinity;
    pts.forEach(function (p, i) {
      var d = Math.hypot(p.x - x, p.y - y);
      if (d <= 10 && (d < dist - 0.5 || (Math.abs(d - dist) <= 0.5 && p.z > depth))) {
        hit = { kind: 'point', index: i }; dist = d; depth = p.z;
      }
    });
    if (hit) return hit;
    dist = 9; depth = -Infinity;
    st.geometryMm.edges.forEach(function (e, i) {
      var a = pts[e[0]], b = pts[e[1]];
      var d = solid.distPointSeg(x, y, a.x, a.y, b.x, b.y);
      var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      var t = l2 > EPS ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      var z = a.z + (b.z - a.z) * t;
      if (d <= 9 && (d < dist - 0.5 || (Math.abs(d - dist) <= 0.5 && z > depth))) {
        hit = { kind: 'edge', index: i }; dist = d; depth = z;
      }
    });
    return hit;
  }
  function path(ctx, pts, close) {
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    if (close) ctx.closePath();
  }
  function underlay(ctx, st, solid, refs) {
    var planes = [{ points: refs.hp, fill: 'rgba(160, 147, 120, 0.065)', stroke: 'rgba(142, 132, 110, 0.22)' },
      { points: refs.vp, fill: 'rgba(120, 148, 175, 0.065)', stroke: 'rgba(116, 140, 162, 0.22)' }];
    // Paint back to front; the wireframe always renders over both surfaces.
    planes.forEach(function (p) {
      p.screen = p.points.map(function (v) { return projectMm(v, st, solid); });
      p.depth = p.screen.reduce(function (s, v) { return s + v.z; }, 0) / 4;
    });
    planes.sort(function (a, b) { return a.depth - b.depth; });
    ctx.save(); ctx.lineWidth = 0.75; ctx.setLineDash([]);
    planes.forEach(function (p) {
      path(ctx, p.screen, true); ctx.fillStyle = p.fill; ctx.fill();
      ctx.strokeStyle = p.stroke; ctx.stroke();
    });
    path(ctx, refs.xy.map(function (p) { return projectMm(p, st, solid); }));
    ctx.strokeStyle = 'rgba(90, 105, 123, 0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }
  function overlay(ctx, st, solid, refs, selection, planesVisible) {
    ctx.save(); ctx.font = '11px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    if (planesVisible) refs.labels.forEach(function (label) {
      var p = projectMm(label.p, st, solid);
      var width = ctx.measureText(label.text).width;
      ctx.fillStyle = 'rgba(248, 250, 252, 0.94)'; ctx.fillRect(p.x - width / 2 - 5, p.y + 6, width + 10, 18);
      ctx.fillStyle = label.color; ctx.textAlign = 'center'; ctx.fillText(label.text, p.x, p.y + 15);
    });
    if (selection && selection.kind === 'point') {
      var v = st.geometryMm.vertices[selection.index];
      if (v) {
        var point = projectMm(v, st, solid);
        if (planesVisible) [
          { p: { x: v.x, y: 0, z: v.z }, color: '#9a8c72', value: fmt(Math.abs(v.y)) + ' mm' },
          { p: { x: v.x, y: v.y, z: 0 }, color: '#7a91ab', value: fmt(Math.abs(v.z)) + ' mm' }
        ].forEach(function (guide) {
          var foot = projectMm(guide.p, st, solid);
          ctx.strokeStyle = guide.color; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
          path(ctx, [point, foot]); ctx.stroke(); ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(foot.x, foot.y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#f8fafc'; ctx.fill(); ctx.stroke();
          if (Math.hypot(foot.x - point.x, foot.y - point.y) > 45) {
            var mx = (point.x + foot.x) / 2, my = (point.y + foot.y) / 2;
            var tw = ctx.measureText(guide.value).width;
            ctx.fillStyle = 'rgba(248, 250, 252, 0.96)'; ctx.fillRect(mx - tw / 2 - 4, my - 9, tw + 8, 18);
            ctx.fillStyle = guide.color; ctx.textAlign = 'center'; ctx.fillText(guide.value, mx, my);
          }
        });
        ctx.strokeStyle = '#58738c'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(point.x, point.y, 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#58738c'; ctx.textAlign = 'left';
        ctx.fillText('P' + (selection.index + 1), point.x + 9, point.y - 9);
      }
    } else if (selection && selection.kind === 'edge') {
      var edge = st.geometryMm.edges[selection.index];
      if (edge) {
        path(ctx, edge.map(function (i) { return projectMm(st.geometryMm.vertices[i], st, solid); }));
        ctx.strokeStyle = '#58738c'; ctx.lineWidth = 2.5; ctx.setLineDash([]); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function mount(widget, container, solid, options) {
    options = options || {};
    var st = widget.state, enabled = false, planesVisible = true, geometry = null, refs = null, selection = null;
    var savedView = null;
    var panel = document.createElement('aside');
    panel.className = 'spatial-panel'; panel.hidden = true; panel.setAttribute('aria-label', '3D inspection');
    panel.innerHTML = '<div class="spatial-head"><span>Spatial view</span><div><button type="button" data-action="planes" aria-pressed="true" title="Show or hide reference planes">HP / VP</button><button type="button" data-action="fit" title="Fit model and reference planes">Fit</button></div></div>' +
      '<p class="spatial-summary"></p><p class="spatial-hint">Click a point or edge · Drag to orbit</p>' +
      '<div class="spatial-selection" hidden aria-live="polite"></div>' +
      '<details class="spatial-details"><summary>Geometry details</summary><div class="spatial-data"></div></details>';
    container.appendChild(panel);
    var summaryEl = panel.querySelector('.spatial-summary');
    var dataEl = panel.querySelector('.spatial-data');
    var selectionEl = panel.querySelector('.spatial-selection');
    var planesBtn = panel.querySelector('[data-action="planes"]');
    function cell(row, value, heading) {
      var el = document.createElement(heading ? 'th' : 'td'); el.textContent = value; row.appendChild(el); return el;
    }
    function table(parent, headers) {
      var el = document.createElement('table'), thead = document.createElement('thead'), row = document.createElement('tr');
      headers.forEach(function (text) { cell(row, text, true); }); thead.appendChild(row); el.appendChild(thead);
      var body = document.createElement('tbody'); el.appendChild(body); parent.appendChild(el); return body;
    }
    function detailGroup(title) {
      var details = document.createElement('details'), titleEl = document.createElement('summary');
      titleEl.textContent = title; details.appendChild(titleEl); dataEl.appendChild(details); return details;
    }
    function selectButton(parent, text, kind, index) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.dataset.kind = kind; button.dataset.index = index; parent.appendChild(button);
    }
    function populate() {
      dataEl.replaceChildren();
      if (!geometry) return;
      var b = bounds(geometry);
      var body = table(dataEl, ['Extent', 'mm']);
      [['Width along XY', b.maxX - b.minX], ['Height', b.maxY - b.minY], ['Depth', b.maxZ - b.minZ]].forEach(function (r) {
        var row = body.insertRow(); cell(row, r[0]); cell(row, fmt(r[1]));
      });
      body = table(dataEl, ['Position range', 'mm']);
      [['X along XY', b.minX, b.maxX], ['Height from HP', b.minY, b.maxY], ['Depth from VP', b.minZ, b.maxZ]].forEach(function (r) {
        var row = body.insertRow(); cell(row, r[0]); cell(row, fmt(r[1]) + ' … ' + fmt(r[2]));
      });
      var note = document.createElement('p'); note.className = 'spatial-note';
      note.textContent = 'Signed coordinates: + height is above HP; + depth is in front of VP. P1, P2… identify reconstructed vertices.'; dataEl.appendChild(note);
      body = table(detailGroup('Points (' + geometry.vertices.length + ')'), ['Point', 'X', 'Height', 'Depth']);
      geometry.vertices.forEach(function (p, i) {
        var row = body.insertRow(); selectButton(cell(row, ''), 'P' + (i + 1), 'point', i);
        cell(row, fmt(p.x)); cell(row, fmt(p.y)); cell(row, fmt(p.z));
      });
      if (geometry.edges.length) {
        body = table(detailGroup('Wire edges (' + geometry.edges.length + ')'), ['Edge', 'L (mm)', 'HP', 'VP']);
        geometry.edges.forEach(function (e, i) {
          var info = edgeInfo(geometry, i), row = body.insertRow();
          selectButton(cell(row, ''), 'P' + (e[0] + 1) + '–P' + (e[1] + 1), 'edge', i);
          cell(row, fmt(info.length)); cell(row, info.hp === null ? '—' : fmt(info.hp) + '°'); cell(row, info.vp === null ? '—' : fmt(info.vp) + '°');
        });
      }
    }
    function selectionReadout() {
      selectionEl.replaceChildren(); selectionEl.hidden = !selection;
      if (!selection || !geometry) return;
      var title = document.createElement('div'); title.className = 'spatial-selection-head';
      var label = document.createElement('strong'); title.appendChild(label);
      var clear = document.createElement('button'); clear.type = 'button'; clear.dataset.action = 'clear'; clear.textContent = '×'; clear.setAttribute('aria-label', 'Clear 3D selection'); title.appendChild(clear); selectionEl.appendChild(title);
      var body = table(selectionEl, ['Measure', 'Value']);
      var rows;
      if (selection.kind === 'point') {
        var p = geometry.vertices[selection.index]; label.textContent = 'Point P' + (selection.index + 1);
        rows = [['X along XY', fmt(p.x) + ' mm'], ['HP', Math.abs(p.y) < EPS ? 'On HP' : fmt(Math.abs(p.y)) + ' mm ' + (p.y > 0 ? 'above' : 'below')],
          ['VP', Math.abs(p.z) < EPS ? 'On VP' : fmt(Math.abs(p.z)) + ' mm ' + (p.z > 0 ? 'in front' : 'behind')]];
      } else {
        var info = edgeInfo(geometry, selection.index); label.textContent = 'Edge P' + (info.a + 1) + '–P' + (info.b + 1);
        rows = [['True length', fmt(info.length) + ' mm'], ['Inclination to HP', info.hp === null ? '—' : fmt(info.hp) + '°'], ['Inclination to VP', info.vp === null ? '—' : fmt(info.vp) + '°']];
      }
      rows.forEach(function (r) { var row = body.insertRow(); cell(row, r[0]); cell(row, r[1]); });
    }
    function positionPanel() {
      // The panel occupies its own space below the diagram; expanded details
      // scroll inside that space and never cover the wireframe.
      var top = Math.min(70 + sceneHeight() + 24, st.h - 170);
      panel.style.top = Math.max(90, top) + 'px';
      panel.style.maxHeight = Math.max(90, st.h - top - 70) + 'px';
    }
    function sceneHeight() { return Math.min(390, st.h * 0.5, Math.max(100, st.h - 300)); }
    function fit() {
      if (!geometry || !refs) return;
      var all = geometry.vertices.concat(refs.hp, refs.vp);
      var rotated = all.map(function (p) { var q = toStage(p, st.geometryTransform); return solid.rotateDir(q.x, q.y, q.z, st.yaw, st.pitch); });
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      rotated.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
      var width = Math.min(530, st.w * 0.46), height = sceneHeight();
      var radius = Math.min((width - 72) / Math.max(maxX - minX, EPS), (height - 65) / Math.max(maxY - minY, EPS));
      // A lone point can be far from both datum planes. Let inspection
      // zoom out far enough to include them; restore editing limits on exit.
      st.minScale = Math.min(solid.GLASS_ZOOM_MIN, radius / st.baseR);
      st.scale = Math.max(st.minScale, Math.min(st.maxScale, radius / st.baseR)); radius = solid.projectionRadius(st);
      st.cx = st.w - width / 2 - 24 - (minX + maxX) / 2 * radius;
      st.cy = 70 + height / 2 + (minY + maxY) / 2 * radius;
      positionPanel();
    }
    function refresh() {
      positionPanel();
      if (geometry === st.geometryMm) return;
      geometry = st.geometryMm; refs = references(geometry); selection = null;
      summaryEl.textContent = geometry ? summary(geometry) : 'Draw matching front and top views to inspect geometry.';
      panel.querySelector('.spatial-details').hidden = !geometry;
      panel.querySelector('.spatial-hint').hidden = !geometry;
      planesBtn.disabled = !geometry;
      panel.querySelector('[data-action="fit"]').disabled = !geometry;
      populate(); selectionReadout(); if (enabled) fit();
    }
    function choose(value) {
      selection = value;
      if (selection && options.onSelect) options.onSelect();
      selectionReadout(); widget.scheduleDraw();
    }
    panel.addEventListener('click', function (e) {
      var button = e.target.closest('button'); if (!button) return;
      if (button.dataset.action === 'planes') {
        planesVisible = !planesVisible; button.setAttribute('aria-pressed', String(planesVisible)); widget.scheduleDraw();
      } else if (button.dataset.action === 'fit') { fit(); widget.scheduleDraw(); }
      else if (button.dataset.action === 'clear') choose(null);
      else if (button.dataset.kind) choose({ kind: button.dataset.kind, index: Number(button.dataset.index) });
    });
    panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') choose(null);
      e.stopPropagation();
    });
    ['pointerdown', 'pointerup', 'pointermove', 'click', 'dblclick', 'wheel', 'contextmenu'].forEach(function (event) {
      panel.addEventListener(event, function (e) { e.stopPropagation(); });
    });
    return {
      panel: panel,
      setEnabled: function (value) {
        if (enabled === value) return;
        enabled = value; st.inspection = value; panel.hidden = !value;
        container.classList.toggle('spatial-inspection', value); selection = null; selectionReadout();
        if (value) { savedView = { cx: st.cx, cy: st.cy, scale: st.scale, minScale: st.minScale }; refresh(); fit(); }
        else if (savedView) { st.cx = savedView.cx; st.cy = savedView.cy; st.scale = savedView.scale; st.minScale = savedView.minScale; savedView = null; }
        widget.scheduleDraw();
      },
      underlay: function (ctx) { if (!enabled) return; refresh(); if (refs && planesVisible) underlay(ctx, st, solid, refs); },
      overlay: function (ctx) { if (enabled && refs) overlay(ctx, st, solid, refs, selection, planesVisible); },
      inspectAt: function (x, y) { if (!enabled) return false; var hit = pick(st, x, y, solid); if (!hit) return false; choose(hit); return true; },
      clear: function () { choose(null); },
      fit: function () { fit(); widget.scheduleDraw(); },
      selection: function () { return selection; }
    };
  }
  return { bounds: bounds, references: references, toStage: toStage, projectMm: projectMm,
    summary: summary, edgeInfo: edgeInfo, pick: pick, fmt: fmt, mount: mount };
});

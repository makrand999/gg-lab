(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./educad-settings.js'));
  else root.EduCADSpatial = factory(root.EduCADSettings);
})(typeof window !== 'undefined' ? window : globalThis, function (Settings) {
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
  function itemKey(item) { return item.kind + ':' + item.index; }
  function itemTitle(g, item) {
    if (item.kind === 'point') return 'P' + (item.index + 1);
    var edge = g.edges[item.index];
    return 'P' + (edge[0] + 1) + '–P' + (edge[1] + 1);
  }
  function numberText(value, prefs) {
    if (value === null) return '—';
    return String(Number(value.toFixed(prefs.precision)));
  }
  function measurementRows(g, item, prefs) {
    prefs = Settings.normalizeInspection(prefs);
    var rows = [], p, info;
    function mm(n) { return numberText(n, prefs) + ' mm'; }
    if (item.kind === 'point') {
      p = g.vertices[item.index];
      if (!p) return rows;
      if (prefs.coordinates) rows.push(['X / Y / Z', [p.x, p.y, p.z].map(function (v) { return numberText(v, prefs); }).join(' / ') + ' mm']);
      if (prefs.planeDistances) {
        rows.push(['HP', Math.abs(p.y) < EPS ? 'On HP' : mm(Math.abs(p.y)) + (p.y > 0 ? ' above' : ' below')]);
        rows.push(['VP', Math.abs(p.z) < EPS ? 'On VP' : mm(Math.abs(p.z)) + (p.z > 0 ? ' in front' : ' behind')]);
      }
    } else {
      info = edgeInfo(g, item.index);
      if (!info) return rows;
      if (prefs.lengths) rows.push(['True length', mm(info.length)]);
      if (prefs.inclinations) {
        rows.push(['Inclination to HP', info.hp === null ? '—' : numberText(info.hp, prefs) + '°']);
        rows.push(['Inclination to VP', info.vp === null ? '—' : numberText(info.vp, prefs) + '°']);
      }
    }
    return rows;
  }
  function inspectionItems(g, selection, pins, prefs) {
    if (!g) return [];
    var items = [], seen = {};
    function add(item) {
      if (!item || !Number.isInteger(item.index) || item.index < 0 ||
          !(item.kind === 'point' ? g.vertices[item.index] : item.kind === 'edge' && g.edges[item.index])) return;
      var key = itemKey(item);
      if (!seen[key]) { seen[key] = true; items.push({ kind: item.kind, index: item.index }); }
    }
    // The active selection stays visible in every scope and gets first
    // choice of label placement. Pins survive ordinary clear-selection.
    add(selection);
    if (prefs.overlay !== 'selected') (pins || []).forEach(add);
    if (prefs.overlay === 'all') {
      // Alternate points and edges so neither category uses every label slot.
      for (var i = 0; i < Math.max(g.vertices.length, g.edges.length); i++) {
        if (prefs.coordinates || prefs.planeDistances) add({ kind: 'point', index: i });
        if (prefs.lengths || prefs.inclinations) add({ kind: 'edge', index: i });
      }
    }
    return items;
  }
  function togglePin(pins, item) {
    var key = itemKey(item), found = pins.some(function (p) { return itemKey(p) === key; });
    return found ? pins.filter(function (p) { return itemKey(p) !== key; }) : pins.concat([{ kind: item.kind, index: item.index }]);
  }
  function overlaps(a, b) {
    return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  }
  function placeLabel(anchor, lines, measure, prefs, viewport, occupied, modelBounds) {
    var width = Math.max.apply(null, lines.map(measure)) + 12;
    var height = lines.length * (prefs.textSize + 4) + 8;
    var positions = [[12, -height - 8], [12, 10], [-width - 12, -height - 8], [-width - 12, 10], [-width / 2, -height - 18], [-width / 2, 20]];
    if (modelBounds) positions = positions.concat([
      [modelBounds.x1 - anchor.x + 10, -height / 2], [modelBounds.x0 - anchor.x - width - 10, -height / 2],
      [modelBounds.x1 - anchor.x + 10, -height - 8], [modelBounds.x0 - anchor.x - width - 10, -height - 8],
      [modelBounds.x1 - anchor.x + 10, 10], [modelBounds.x0 - anchor.x - width - 10, 10]
    ]);
    for (var i = 0; i < positions.length; i++) {
      var x = anchor.x + positions[i][0], y = anchor.y + positions[i][1];
      var rect = { x0: x, y0: y, x1: x + width, y1: y + height };
      if (x < 6 || y < 6 || rect.x1 > viewport.w - 6 || rect.y1 > viewport.h - 6) continue;
      var padded = { x0: x - 3, y0: y - 3, x1: rect.x1 + 3, y1: rect.y1 + 3 };
      if (occupied.some(function (r) { return overlaps(padded, r); })) continue;
      occupied.push(rect);
      return { rect: rect, lines: lines, anchor: anchor };
    }
    return null; // Values remain available in the panel when labels cannot fit.
  }
  function overlayLayout(st, solid, refs, selection, pins, prefs, measure, obstacles) {
    var g = st.geometryMm, items = inspectionItems(g, selection, pins, prefs);
    var layout = { labels: [], guides: [], marks: [], suppressed: 0 }, occupied = (obstacles || []).slice();
    if (!g || !st.geometryTransform || !refs) return layout;
    var points = g.vertices.map(function (p) { return projectMm(p, st, solid); });
    var modelBounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    points.forEach(function (p) {
      modelBounds.x0 = Math.min(modelBounds.x0, p.x - 8); modelBounds.x1 = Math.max(modelBounds.x1, p.x + 8);
      modelBounds.y0 = Math.min(modelBounds.y0, p.y - 8); modelBounds.y1 = Math.max(modelBounds.y1, p.y + 8);
    });
    occupied.push(modelBounds); // Labels stay beside the object, preserving its silhouette.
    function label(anchor, lines, color) {
      if (!prefs.labels) return;
      var placed = placeLabel(anchor, lines, measure, prefs, st, occupied, modelBounds);
      if (placed) { placed.color = color; layout.labels.push(placed); }
      else layout.suppressed++;
    }
    items.forEach(function (item) {
      var active = selection && itemKey(item) === itemKey(selection);
      var pinned = pins.some(function (p) { return itemKey(p) === itemKey(item); });
      var p, point, edge, ends, info, lines = [itemTitle(g, item)];
      if (item.kind === 'point') {
        p = g.vertices[item.index]; point = projectMm(p, st, solid);
        if (active || pinned) layout.marks.push({ kind: 'point', points: [point], active: active });
        if (prefs.coordinates) lines.push([p.x, p.y, p.z].map(function (v) { return numberText(v, prefs); }).join(', ') + ' mm');
        if (prefs.planeDistances) {
          lines.push(Math.abs(p.y) < EPS ? 'On HP' : 'HP ' + numberText(Math.abs(p.y), prefs) + ' mm ' + (p.y < 0 ? 'below' : 'above'));
          lines.push(Math.abs(p.z) < EPS ? 'On VP' : 'VP ' + numberText(Math.abs(p.z), prefs) + ' mm ' + (p.z < 0 ? 'behind' : 'in front'));
        }
        if (prefs.planes && prefs.guides && prefs.planeDistances && (active || pinned)) {
          [{ p: { x: p.x, y: 0, z: p.z }, color: '#9a8c72' },
            { p: { x: p.x, y: p.y, z: 0 }, color: '#7a91ab' }].forEach(function (guide) {
            layout.guides.push({ from: point, to: projectMm(guide.p, st, solid), color: guide.color });
          });
        }
      } else {
        edge = g.edges[item.index]; ends = edge.map(function (i) { return projectMm(g.vertices[i], st, solid); });
        point = { x: (ends[0].x + ends[1].x) / 2, y: (ends[0].y + ends[1].y) / 2 };
        if (active || pinned) layout.marks.push({ kind: 'edge', points: ends, active: active });
        info = edgeInfo(g, item.index);
        if (prefs.lengths) lines[0] += ' · ' + numberText(info.length, prefs) + ' mm';
        if (prefs.inclinations) lines.push('HP ' + (info.hp === null ? '—' : numberText(info.hp, prefs) + '°') +
          ' · VP ' + (info.vp === null ? '—' : numberText(info.vp, prefs) + '°'));
      }
      if (lines.length > 1 || (item.kind === 'edge' && prefs.lengths)) label(point, lines, active ? '#415c74' : '#64748b');
    });
    if (prefs.planes) refs.labels.forEach(function (entry) {
      label(projectMm(entry.p, st, solid), [entry.text], entry.color);
    });
    return layout;
  }
  // Vertex picks win near endpoints; frontmost wins when points overlap.
  // tolPx widens both thresholds for touch; omitted means desktop (10/9).
  function pick(st, x, y, solid, tolPx) {
    if (!st.geometryMm || !solid.statusOf(st).available) return null;
    var pointTol = (typeof tolPx === 'number' && tolPx > 0) ? tolPx : 10;
    var edgeTol = (typeof tolPx === 'number' && tolPx > 0) ?
      Math.max(9, tolPx - 2) : 9;
    var pts = st.geometryMm.vertices.map(function (p) { return projectMm(p, st, solid); });
    var hit = null, dist = pointTol, depth = -Infinity;
    pts.forEach(function (p, i) {
      var d = Math.hypot(p.x - x, p.y - y);
      if (d <= pointTol && (d < dist - 0.5 || (Math.abs(d - dist) <= 0.5 && p.z > depth))) {
        hit = { kind: 'point', index: i }; dist = d; depth = p.z;
      }
    });
    if (hit) return hit;
    dist = edgeTol; depth = -Infinity;
    st.geometryMm.edges.forEach(function (e, i) {
      var a = pts[e[0]], b = pts[e[1]];
      var d = solid.distPointSeg(x, y, a.x, a.y, b.x, b.y);
      var dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      var t = l2 > EPS ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / l2)) : 0;
      var z = a.z + (b.z - a.z) * t;
      if (d <= edgeTol && (d < dist - 0.5 || (Math.abs(d - dist) <= 0.5 && z > depth))) {
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
  // Scanline gaps: runs of a horizontal screen row covered by boxes
  // ({x0,y0,x1,y1} panels, label backings), quads (translucent plane
  // fills), segments ({ax,ay,bx,by,pad} wire and guide lines), and
  // dots ({x,y,pad} vertices). Returns merged [x0,x1] runs, sorted.
  function scanGaps(datumY, rects, quads, segs, dots) {
    var gaps = [];
    (rects || []).forEach(function (r) {
      if (datumY >= r.y0 && datumY <= r.y1 && r.x1 > r.x0) gaps.push([r.x0, r.x1]);
    });
    (quads || []).forEach(function (q) {
      var xs = [];
      for (var i = 0; i < q.length; i++) {
        var a = q[i], b = q[(i + 1) % q.length];
        if (Math.abs(b.y - a.y) > EPS) {
          if ((a.y - datumY) * (b.y - datumY) <= 0) {
            xs.push(a.x + (datumY - a.y) / (b.y - a.y) * (b.x - a.x));
          }
        } else if (Math.abs(a.y - datumY) <= 0.5) {
          xs.push(a.x, b.x);
        }
      }
      if (xs.length >= 2) {
        gaps.push([Math.min.apply(null, xs) - 1, Math.max.apply(null, xs) + 1]);
      }
    });
    (segs || []).forEach(function (s) {
      var pad = s.pad || 0;
      if (Math.abs(s.by - s.ay) <= EPS) {
        if (Math.abs(s.ay - datumY) <= 0.5 + pad) {
          gaps.push([Math.min(s.ax, s.bx) - pad, Math.max(s.ax, s.bx) + pad]);
        }
      } else if ((s.ay - datumY) * (s.by - datumY) <= 0) {
        var x = s.ax + (datumY - s.ay) / (s.by - s.ay) * (s.bx - s.ax);
        gaps.push([x - pad, x + pad]);
      }
    });
    (dots || []).forEach(function (d) {
      if (Math.abs(d.y - datumY) <= d.pad) gaps.push([d.x - d.pad, d.x + d.pad]);
    });
    gaps.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    gaps.forEach(function (g) {
      var last = merged[merged.length - 1];
      if (last && g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
      else merged.push([g[0], g[1]]);
    });
    return merged;
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
  function drawOverlay(ctx, layout, prefs) {
    ctx.save(); ctx.font = prefs.textSize + 'px system-ui, sans-serif'; ctx.textBaseline = 'middle';
    layout.guides.forEach(function (guide) {
      ctx.strokeStyle = guide.color; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      path(ctx, [guide.from, guide.to]); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(guide.to.x, guide.to.y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#f8fafc'; ctx.fill(); ctx.stroke();
    });
    layout.marks.forEach(function (mark) {
      ctx.strokeStyle = mark.active ? '#58738c' : '#8a9dad'; ctx.setLineDash([]);
      if (mark.kind === 'point') {
        ctx.lineWidth = mark.active ? 1.5 : 1;
        ctx.beginPath(); ctx.arc(mark.points[0].x, mark.points[0].y, mark.active ? 6 : 5, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.lineWidth = mark.active ? 2.5 : 1.75;
        path(ctx, mark.points); ctx.stroke();
      }
    });
    layout.labels.forEach(function (label) {
      var rect = label.rect;
      var nearX = Math.max(rect.x0, Math.min(rect.x1, label.anchor.x));
      var nearY = Math.max(rect.y0, Math.min(rect.y1, label.anchor.y));
      ctx.strokeStyle = 'rgba(138, 157, 173, 0.45)'; ctx.lineWidth = 0.6; ctx.setLineDash([]);
      path(ctx, [label.anchor, { x: nearX, y: nearY }]); ctx.stroke();
      ctx.fillStyle = 'rgba(248, 250, 252, 0.96)'; ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      ctx.fillStyle = label.color; ctx.textAlign = 'left';
      label.lines.forEach(function (line, i) {
        ctx.fillText(line, rect.x0 + 6, rect.y0 + 4 + (prefs.textSize + 4) * (i + 0.5));
      });
    });
    ctx.restore();
  }

  function mount(widget, container, solid, options) {
    options = options || {};
    var st = widget.state, enabled = false, geometry, refs = null, selection = null, pins = [];
    var prefs = Settings.normalizeInspection(options.preferences), search = '';
    var sourceRevision, geometryKey = '';
    var savedView = null;
    var panel = document.createElement('aside');
    panel.className = 'spatial-panel'; panel.hidden = true; panel.setAttribute('aria-label', '3D inspection');
    panel.innerHTML = '<div class="spatial-head"><span>Spatial view</span><div><button type="button" data-action="planes" aria-pressed="true" title="Show or hide reference planes">HP / VP</button><button type="button" data-action="fit" title="Fit model and reference planes">Fit</button></div></div>' +
      '<p class="spatial-summary"></p><p class="spatial-hint">Click a point or edge · Drag to orbit</p>' +
      '<div class="spatial-tools" role="group" aria-label="Measurement overlays"><button type="button" data-overlay="selected">Selected</button><button type="button" data-overlay="pinned">Pinned</button><button type="button" data-overlay="all">All</button><details class="spatial-filter"><summary>Filter</summary><div class="spatial-filter-fields"></div></details></div>' +
      '<div class="spatial-selection" hidden aria-live="polite"></div>' +
      '<div class="spatial-pins" hidden></div>' +
      '<p class="spatial-label-note spatial-note" hidden></p>' +
      '<details class="spatial-details"><summary>Geometry details</summary><input class="spatial-search" type="search" aria-label="Find a point or edge" placeholder="Find P1 or P1–P2"><div class="spatial-data"></div></details>';
    container.appendChild(panel);
    var summaryEl = panel.querySelector('.spatial-summary');
    var dataEl = panel.querySelector('.spatial-data');
    var selectionEl = panel.querySelector('.spatial-selection');
    var pinsEl = panel.querySelector('.spatial-pins');
    var planesBtn = panel.querySelector('[data-action="planes"]');
    var detailsEl = panel.querySelector('.spatial-details');
    var labelNote = panel.querySelector('.spatial-label-note');
    var filterEl = panel.querySelector('.spatial-filter-fields');
    ['coordinates', 'planeDistances', 'lengths', 'inclinations'].forEach(function (key) {
      var row = document.createElement('label'), box = document.createElement('input');
      box.type = 'checkbox'; box.dataset.inspectionKey = key;
      row.appendChild(box); row.appendChild(document.createTextNode(Settings.INSPECTION_FIELDS[key].label)); filterEl.appendChild(row);
    });
    function syncControls() {
      planesBtn.setAttribute('aria-pressed', String(prefs.planes));
      panel.querySelectorAll('[data-overlay]').forEach(function (button) {
        button.setAttribute('aria-pressed', String(prefs.overlay === button.dataset.overlay));
      });
      filterEl.querySelectorAll('input').forEach(function (box) { box.checked = prefs[box.dataset.inspectionKey]; });
    }
    function updatePreferences(key, value) {
      var next = Object.assign({}, prefs); next[key] = value;
      setPreferences(next);
      if (options.onPreferencesChange) options.onPreferencesChange(Object.assign({}, prefs));
    }
    function setPreferences(value) {
      var previousScope = prefs.overlay;
      prefs = Settings.normalizeInspection(value); syncControls();
      if (prefs.overlay === 'all' && previousScope !== 'all') detailsEl.open = true;
      populate(); selectionReadout(); pinReadout(); widget.scheduleDraw();
    }
    function cell(row, value, heading) {
      var el = document.createElement(heading ? 'th' : 'td'); el.textContent = value; row.appendChild(el); return el;
    }
    function table(parent, headers) {
      var el = document.createElement('table'), thead = document.createElement('thead'), row = document.createElement('tr');
      headers.forEach(function (text) { cell(row, text, true); }); thead.appendChild(row); el.appendChild(thead);
      var body = document.createElement('tbody'); el.appendChild(body);
      var scroll = document.createElement('div'); scroll.className = 'spatial-table-scroll'; scroll.appendChild(el); parent.appendChild(scroll); return body;
    }
    function detailGroup(title, kind) {
      var details = document.createElement('details'), titleEl = document.createElement('summary');
      details.dataset.group = kind; details.open = prefs.overlay === 'all' || !!search;
      titleEl.textContent = title; details.appendChild(titleEl); dataEl.appendChild(details); return details;
    }
    function selectButton(parent, text, kind, index) {
      var button = document.createElement('button'); button.type = 'button'; button.textContent = text;
      button.dataset.kind = kind; button.dataset.index = index; parent.appendChild(button);
    }
    function markRows() {
      dataEl.querySelectorAll('button[data-kind]').forEach(function (button) {
        var item = { kind: button.dataset.kind, index: Number(button.dataset.index) };
        var active = !!selection && itemKey(selection) === itemKey(item);
        var pinned = pins.some(function (p) { return itemKey(p) === itemKey(item); });
        button.setAttribute('aria-pressed', String(active));
        button.closest('tr').classList.toggle('spatial-active-row', active);
        button.closest('tr').classList.toggle('spatial-pinned-row', pinned);
        button.title = pinned ? 'Pinned measurement' : 'Inspect measurement';
      });
    }
    function populate() {
      var openGroups = {};
      dataEl.querySelectorAll('details[data-group]').forEach(function (group) { openGroups[group.dataset.group] = group.open; });
      dataEl.replaceChildren();
      if (!geometry) return;
      var b = bounds(geometry);
      var body = table(dataEl, ['Extent', 'mm']);
      [['Width along XY', b.maxX - b.minX], ['Height', b.maxY - b.minY], ['Depth', b.maxZ - b.minZ]].forEach(function (r) {
        var row = body.insertRow(); cell(row, r[0]); cell(row, numberText(r[1], prefs));
      });
      body = table(dataEl, ['Position range', 'mm']);
      [['X along XY', b.minX, b.maxX], ['Height from HP', b.minY, b.maxY], ['Depth from VP', b.minZ, b.maxZ]].forEach(function (r) {
        var row = body.insertRow(); cell(row, r[0]); cell(row, numberText(r[1], prefs) + ' … ' + numberText(r[2], prefs));
      });
      var note = document.createElement('p'); note.className = 'spatial-note';
      note.textContent = 'Coordinates in mm: X along XY, Y above HP, Z in front of VP. Negative HP / VP values mean below / behind. P1, P2… identify reconstructed vertices.'; dataEl.appendChild(note);
      var pointGroup = detailGroup('Points (' + geometry.vertices.length + ')', 'point');
      var pointHeaders = ['Point'];
      if (prefs.coordinates) pointHeaders = pointHeaders.concat(['X', 'Y', 'Z']);
      if (prefs.planeDistances) pointHeaders = pointHeaders.concat(['HP (mm)', 'VP (mm)']);
      body = table(pointGroup, pointHeaders);
      geometry.vertices.forEach(function (p, i) {
        var item = { kind: 'point', index: i };
        if (!itemTitle(geometry, item).toLowerCase().includes(search)) return;
        var row = body.insertRow(); selectButton(cell(row, ''), 'P' + (i + 1), 'point', i);
        if (prefs.coordinates) [p.x, p.y, p.z].forEach(function (v) { cell(row, numberText(v, prefs)); });
        if (prefs.planeDistances) { cell(row, numberText(p.y, prefs)); cell(row, numberText(p.z, prefs)); }
      });
      if (geometry.edges.length) {
        var edgeHeaders = ['Edge'];
        if (prefs.lengths) edgeHeaders.push('L (mm)');
        if (prefs.inclinations) edgeHeaders = edgeHeaders.concat(['HP', 'VP']);
        body = table(detailGroup('Wire edges (' + geometry.edges.length + ')', 'edge'), edgeHeaders);
        geometry.edges.forEach(function (e, i) {
          if (!itemTitle(geometry, { kind: 'edge', index: i }).toLowerCase().includes(search)) return;
          var info = edgeInfo(geometry, i), row = body.insertRow();
          selectButton(cell(row, ''), 'P' + (e[0] + 1) + '–P' + (e[1] + 1), 'edge', i);
          if (prefs.lengths) cell(row, numberText(info.length, prefs));
          if (prefs.inclinations) { cell(row, info.hp === null ? '—' : numberText(info.hp, prefs) + '°'); cell(row, info.vp === null ? '—' : numberText(info.vp, prefs) + '°'); }
        });
      }
      dataEl.querySelectorAll('details[data-group]').forEach(function (group) {
        if (search || prefs.overlay === 'all') group.open = true;
        else if (group.dataset.group in openGroups) group.open = openGroups[group.dataset.group];
      });
      var empty = document.createElement('p'); empty.className = 'spatial-note';
      empty.textContent = 'No matching points or edges.'; empty.hidden = !search || !!dataEl.querySelector('button[data-kind]'); dataEl.appendChild(empty);
      markRows();
    }
    function selectionReadout() {
      selectionEl.replaceChildren(); selectionEl.hidden = !selection;
      if (!selection || !geometry) return;
      var title = document.createElement('div'); title.className = 'spatial-selection-head';
      var label = document.createElement('strong'); label.textContent = (selection.kind === 'point' ? 'Point ' : 'Edge ') + itemTitle(geometry, selection); title.appendChild(label);
      var actions = document.createElement('div'); title.appendChild(actions);
      var pin = document.createElement('button'); pin.type = 'button'; pin.dataset.action = 'pin';
      var pinned = pins.some(function (p) { return itemKey(p) === itemKey(selection); });
      pin.textContent = pinned ? 'Unpin' : 'Pin'; pin.setAttribute('aria-pressed', String(pinned)); actions.appendChild(pin);
      var clear = document.createElement('button'); clear.type = 'button'; clear.dataset.action = 'clear'; clear.textContent = '×'; clear.setAttribute('aria-label', 'Clear 3D selection'); actions.appendChild(clear); selectionEl.appendChild(title);
      var rows = measurementRows(geometry, selection, prefs);
      if (rows.length) {
        var body = table(selectionEl, ['Measure', 'Value']);
        rows.forEach(function (r) { var row = body.insertRow(); cell(row, r[0]); cell(row, r[1]); });
      } else {
        var note = document.createElement('p'); note.className = 'spatial-note'; note.textContent = 'Enable measurements in Filter.'; selectionEl.appendChild(note);
      }
    }
    function pinReadout() {
      pinsEl.replaceChildren(); pinsEl.hidden = !pins.length;
      if (!pins.length || !geometry) return;
      var head = document.createElement('div'); head.className = 'spatial-selection-head';
      var title = document.createElement('span'); title.textContent = 'Pinned (' + pins.length + ')'; head.appendChild(title);
      var clear = document.createElement('button'); clear.type = 'button'; clear.dataset.action = 'clear-pins'; clear.textContent = 'Clear pins'; head.appendChild(clear); pinsEl.appendChild(head);
      pins.forEach(function (item) {
        var row = document.createElement('div'); row.className = 'spatial-pin-row';
        selectButton(row, itemTitle(geometry, item), item.kind, item.index);
        var value = document.createElement('span');
        value.textContent = measurementRows(geometry, item, prefs).map(function (r) { return r[0] + ' ' + r[1]; }).join(' · ');
        row.appendChild(value);
        var remove = document.createElement('button'); remove.type = 'button'; remove.dataset.removePin = itemKey(item); remove.textContent = '×';
        remove.setAttribute('aria-label', 'Unpin ' + itemTitle(geometry, item)); row.appendChild(remove); pinsEl.appendChild(row);
      });
    }
    function labelObstacles() {
      var rect = panel.getBoundingClientRect(), origin = container.getBoundingClientRect();
      return [{ x0: rect.left - origin.left, y0: rect.top - origin.top, x1: rect.right - origin.left, y1: rect.bottom - origin.top }];
    }
    function layoutWith(measure) {
      return overlayLayout(st, solid, refs, selection, pins, prefs, measure, labelObstacles());
    }
    function positionPanel() {
      // The panel lives in the top-left corner, the same corner as the
      // pose panel; the 3D diagram keeps the right side. Expanded details
      // scroll inside the panel and never cover the wireframe.
      var top = 44;
      panel.style.top = top + 'px';
      var mobile = typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive();
      panel.style.maxHeight = mobile ? 'none' : Math.max(90, Math.min(st.h - top - 24,
        window.innerHeight - panel.getBoundingClientRect().top - 24)) + 'px';
    }
    function sceneHeight() { return Math.min(390, st.h * 0.5, Math.max(100, st.h - 300)); }
    function fit() {
      if (!geometry || !refs) return;
      var mobile = typeof EduCADMobile !== 'undefined' && EduCADMobile.splitActive();
      var all = mobile && !enabled ? geometry.vertices : geometry.vertices.concat(refs.hp, refs.vp);
      var rotated = all.map(function (p) { var q = toStage(p, st.geometryTransform); return solid.rotateDir(q.x, q.y, q.z, st.yaw, st.pitch); });
      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      rotated.forEach(function (p) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
      var width = mobile ? st.w : Math.min(530, st.w * 0.46);
      var height = mobile ? st.h : sceneHeight();
      var padding = mobile ? Math.min(48, width * 0.3, height * 0.3) : 0;
      var radius = Math.min(Math.max(1, width - (mobile ? padding : 72)) / Math.max(maxX - minX, EPS), Math.max(1, height - (mobile ? padding : 65)) / Math.max(maxY - minY, EPS));
      // A lone point can be far from both datum planes. Let inspection
      // zoom out far enough to include them; restore editing limits on exit.
      st.minScale = Math.min(solid.GLASS_ZOOM_MIN, radius / st.baseR);
      st.scale = Math.max(st.minScale, Math.min(st.maxScale, radius / st.baseR)); radius = solid.projectionRadius(st);
      st.cx = (mobile ? st.w / 2 : st.w - width / 2 - 24) - (minX + maxX) / 2 * radius;
      st.cy = (mobile ? st.h / 2 : 70 + height / 2) + (minY + maxY) / 2 * radius;
      positionPanel();
    }
    function refresh() {
      positionPanel();
      var revision = options.sourceRevision ? options.sourceRevision() : null;
      if (geometry === st.geometryMm && sourceRevision === revision) return;
      var key = st.geometryMm ? JSON.stringify({ vertices: st.geometryMm.vertices, edges: st.geometryMm.edges }) : '';
      if (key !== geometryKey || sourceRevision !== revision) pins = [];
      sourceRevision = revision; geometryKey = key;
      geometry = st.geometryMm; refs = references(geometry); selection = null;
      labelNote.hidden = true;
      if (options.onSelect) options.onSelect(null);
      summaryEl.textContent = geometry ? summary(geometry) : 'Draw matching front and top views to inspect geometry.';
      detailsEl.hidden = !geometry;
      panel.querySelector('.spatial-tools').hidden = !geometry;
      panel.querySelector('.spatial-hint').hidden = !geometry;
      planesBtn.disabled = !geometry;
      panel.querySelector('[data-action="fit"]').disabled = !geometry;
      populate(); selectionReadout(); pinReadout(); if (enabled) fit();
    }
    function choose(value) {
      selection = value;
      if (options.onSelect) options.onSelect(selection);
      selectionReadout(); markRows(); widget.scheduleDraw();
    }
    panel.addEventListener('click', function (e) {
      var button = e.target.closest('button'); if (!button) return;
      if (button.dataset.action === 'planes') updatePreferences('planes', !prefs.planes);
      else if (button.dataset.action === 'fit') { fit(); widget.scheduleDraw(); }
      else if (button.dataset.action === 'clear') choose(null);
      else if (button.dataset.action === 'pin' && selection) {
        pins = togglePin(pins, selection);
        if (pins.length && prefs.overlay === 'selected') updatePreferences('overlay', 'pinned');
        selectionReadout(); pinReadout(); markRows(); widget.scheduleDraw();
      } else if (button.dataset.action === 'clear-pins') {
        pins = []; selectionReadout(); pinReadout(); markRows(); widget.scheduleDraw();
      } else if (button.dataset.removePin) {
        pins = pins.filter(function (p) { return itemKey(p) !== button.dataset.removePin; });
        selectionReadout(); pinReadout(); markRows(); widget.scheduleDraw();
      } else if (button.dataset.overlay) updatePreferences('overlay', button.dataset.overlay);
      else if (button.dataset.kind) choose({ kind: button.dataset.kind, index: Number(button.dataset.index) });
    });
    filterEl.addEventListener('change', function (e) {
      var key = e.target.dataset.inspectionKey;
      if (key) updatePreferences(key, e.target.checked);
    });
    panel.querySelector('.spatial-search').addEventListener('input', function (e) {
      search = e.target.value.trim().toLowerCase().replace(/-/g, '–'); populate(); widget.scheduleDraw();
    });
    panel.addEventListener('toggle', function () { widget.scheduleDraw(); }, true);
    syncControls();
    if (prefs.overlay === 'all') detailsEl.open = true;
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
        container.classList.toggle('spatial-inspection', value); selection = null; selectionReadout(); markRows();
        if (options.onSelect) options.onSelect(null);
        if (value) { savedView = { cx: st.cx, cy: st.cy, scale: st.scale, minScale: st.minScale }; refresh(); fit(); }
        else if (savedView) { st.cx = savedView.cx; st.cy = savedView.cy; st.scale = savedView.scale; st.minScale = savedView.minScale; savedView = null; }
        widget.scheduleDraw();
      },
      underlay: function (ctx) { if (!enabled) return; refresh(); if (refs && prefs.planes) underlay(ctx, st, solid, refs); },
      overlay: function (ctx) {
        if (!enabled || !refs) return;
        ctx.save(); ctx.font = prefs.textSize + 'px system-ui, sans-serif';
        var layout = layoutWith(function (text) { return ctx.measureText(text).width; }); ctx.restore();
        drawOverlay(ctx, layout, prefs);
        labelNote.hidden = !prefs.labels || !layout.suppressed;
        var note = 'Some labels are hidden to avoid overlap. All values remain in Geometry details.';
        if (labelNote.textContent !== note) labelNote.textContent = note;
      },
      inspectAt: function (x, y, tolPx) { if (!enabled) return false; var hit = pick(st, x, y, solid, tolPx); if (!hit) return false; choose(hit); return true; },
      clear: function () { choose(null); },
      datumGaps: function (datumY, measure) {
        if (!enabled) return [];
        var rects = [], quads = [], segs = [], dots = [];
        if (panel && !panel.hidden && typeof panel.getBoundingClientRect === 'function') {
          var box = panel.getBoundingClientRect();
          rects.push({ x0: box.left, y0: box.top, x1: box.right, y1: box.bottom });
        }
        var g = st.geometryMm, rf = (g && st.geometryTransform) ? references(g) : null;
        if (g && rf) {
          var pts = g.vertices.map(function (p) { return projectMm(p, st, solid); });
          pts.forEach(function (p, i) {
            var ring = selection && selection.kind === 'point' && selection.index === i;
            dots.push({ x: p.x, y: p.y, pad: ring ? 7 : 4 });
          });
          g.edges.forEach(function (e) {
            var a = pts[e[0]], b = pts[e[1]];
            if (a && b) segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y, pad: 3 });
          });
          if (prefs.planes) {
            quads.push(rf.hp.map(function (p) { return projectMm(p, st, solid); }));
            quads.push(rf.vp.map(function (p) { return projectMm(p, st, solid); }));
            var xyl = rf.xy.map(function (p) { return projectMm(p, st, solid); });
            segs.push({ ax: xyl[0].x, ay: xyl[0].y, bx: xyl[1].x, by: xyl[1].y, pad: 2 });
          }
          if (typeof measure === 'function') {
            // Canvas labels and datum exclusions use the same layout.
            var layout = layoutWith(measure);
            layout.labels.forEach(function (label) {
              rects.push(label.rect);
              segs.push({ ax: label.anchor.x, ay: label.anchor.y,
                bx: Math.max(label.rect.x0, Math.min(label.rect.x1, label.anchor.x)),
                by: Math.max(label.rect.y0, Math.min(label.rect.y1, label.anchor.y)), pad: 1 });
            });
            layout.guides.forEach(function (guide) {
              segs.push({ ax: guide.from.x, ay: guide.from.y, bx: guide.to.x, by: guide.to.y, pad: 2 });
              dots.push({ x: guide.to.x, y: guide.to.y, pad: 4 });
            });
          }
        }
        return scanGaps(datumY, rects, quads, segs, dots);
      },
      fit: function () { refresh(); fit(); widget.scheduleDraw(); },
      selection: function () { return selection && Object.assign({}, selection); },
      pins: function () { return pins.map(function (p) { return Object.assign({}, p); }); },
      preferences: function () { return Object.assign({}, prefs); },
      setPreferences: setPreferences
    };
  }
  return { bounds: bounds, references: references, toStage: toStage, projectMm: projectMm,
    summary: summary, edgeInfo: edgeInfo, pick: pick, fmt: fmt, scanGaps: scanGaps, mount: mount,
    measurementRows: measurementRows, inspectionItems: inspectionItems, togglePin: togglePin,
    overlayLayout: overlayLayout, placeLabel: placeLabel };
});

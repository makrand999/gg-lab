(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.EduCADSolid = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  // EduCAD floating 3D wireframe cube: pen-style vector sketch on the sheet.
  // Orthographic yaw/pitch projector ((X,Y,Z) -> 2D) drawn with plain
  // Canvas2D strokes. Ink lines and dots only: no fills, no shading,
  // no lights, no floor, no shadow, no extra scene dressing.
  // World cube in [-1,1]^3; screen px is ephemeral render only. Zero deps.
  // Dual-env: browser via window.EduCADSolid, Node via module.exports.
  // Node-safe: DOM is touched only inside mountSolidWidget when a container
  // element is passed; otherwise a headless stub is returned.
  //
  // Resting look: transparent stage, crisp ink strokes, isometric rest pose
  // (pitch atan(1/sqrt(2)) ~= 35.26 deg, yaw 45 deg) so the cube reads as a
  // 2D technical sketch until orbited.
  var SIZE_DEFAULT = 260;
  var SIZE_MIN = 120;
  var SIZE_MAX = 520;
  var LINE_COLOR = '#1e293b';
  var LINE_WIDTH_PX = 1.75;
  var VERTEX_FILL = '#0f172a';
  var VERTEX_R_PX = 3;
  var HIDDEN_DASH = [4, 4];
  var HIDDEN_OPACITY = 0.45;
  var ISO_YAW_RAD = Math.PI / 4;
  var ISO_PITCH_RAD = Math.atan(1 / Math.sqrt(2));
  var ORBIT_RAD_PER_PX = 0.008;
  var PITCH_LIMIT_RAD = 1.45;
  var ZOOM_MIN = 0.35;
  var ZOOM_MAX = 4;
  var ZOOM_STEP = 1.15;
  var RADIUS_FRAC = 0.28;
  var WIDGET_CLASS = 'educad-solid';
  var CANVAS_CLASS = 'educad-solid-canvas';
  var HANDLE_CLASS = 'educad-solid-handle';
  var HANDLE_TEXT = '⠿ 3D Solid';

  // Unit cube corners. Index map: bit0 -> +X, bit1 -> +Y, bit2 -> +Z.
  var VERTICES = [
    { x: -1, y: -1, z: -1 }, { x: 1, y: -1, z: -1 },
    { x: -1, y: 1, z: -1 }, { x: 1, y: 1, z: -1 },
    { x: -1, y: -1, z: 1 }, { x: 1, y: -1, z: 1 },
    { x: -1, y: 1, z: 1 }, { x: 1, y: 1, z: 1 }
  ];
  // 12 edges: 4 along each axis.
  var EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7]
  ];
  // Outward face normals, in -X/+X/-Y/+Y/-Z/+Z order. Faces are never
  // drawn; they only decide which edges read as hidden (dashed).
  var FACE_NORMALS = [
    { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 }
  ];
  // Adjacent face pair per edge (indices into FACE_NORMALS).
  var EDGE_FACES = [
    [2, 4], [3, 4], [2, 5], [3, 5],
    [0, 4], [1, 4], [0, 5], [1, 5],
    [0, 2], [1, 2], [0, 3], [1, 3]
  ];
  // Cube faces as index loops into VERTICES, wound so Newell normals come
  // out as FACE_NORMALS (-X/+X/-Y/+Y/-Z/+Z). Faces are never drawn; they
  // only decide which edges read as hidden (dashed).
  var CUBE_FACES = [
    [0, 4, 6, 2], [1, 3, 7, 5],
    [0, 1, 5, 4], [2, 6, 7, 3],
    [0, 2, 3, 1], [4, 5, 7, 6]
  ];
  var STATUS_FONT = '600 12px system-ui, -apple-system, sans-serif';
  var STATUS_SUB_FONT = '12px system-ui, -apple-system, sans-serif';

  function assertFinite() {
    for (var i = 0; i < arguments.length; i++) {
      var v = arguments[i];
      if (typeof v !== 'number' || Number.isNaN(v) || !Number.isFinite(v)) {
        throw new Error('NaN guard: expected finite number, got ' + String(v));
      }
    }
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  function clampSizePx(v) {
    assertFinite(v);
    return clamp(Math.round(v), SIZE_MIN, SIZE_MAX);
  }

  function assertIndex(v, hi, what) {
    if (typeof v !== 'number' || Math.floor(v) !== v || v < 0 || v >= hi) {
      throw new Error('bad ' + what + ': ' + String(v));
    }
  }

  // Newell normal (unit length) for one index loop. Degenerate loops keep
  // a zero normal and always read as facing away.
  function newellNormal(verts, loop) {
    var nx = 0, ny = 0, nz = 0;
    for (var i = 0; i < loop.length; i++) {
      var a = verts[loop[i]], b = verts[loop[(i + 1) % loop.length]];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(len > 1e-12)) return { x: 0, y: 0, z: 0 };
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  function edgeKey(a, b) { return a < b ? a + '_' + b : b + '_' + a; }

  // Generic 3D geometry container: vertices [{x,y,z}], edges [[a,b]],
  // faces [[idx...]...] (optional; wireframes pass []). Validates indices,
  // derives unit face normals + edge adjacency. Returned object is a fresh
  // copy the caller owns.
  function createGeometry(spec) {
    spec = spec || {};
    var vs = spec.vertices || spec.VERTICES;
    var es = spec.edges || spec.EDGES || [];
    var fs = spec.faces || spec.FACES || [];
    if (!Array.isArray(vs) || vs.length < 1) {
      throw new Error('geometry needs >= 1 vertex');
    }
    var verts = [];
    for (var i = 0; i < vs.length; i++) {
      assertFinite(vs[i].x, vs[i].y, vs[i].z);
      verts.push({ x: vs[i].x, y: vs[i].y, z: vs[i].z });
    }
    var edges = [];
    for (var j = 0; j < es.length; j++) {
      assertIndex(es[j][0], verts.length, 'edge a');
      assertIndex(es[j][1], verts.length, 'edge b');
      if (es[j][0] === es[j][1]) throw new Error('edge loop on ' + es[j][0]);
      edges.push([es[j][0], es[j][1]]);
    }
    var faces = [];
    for (var k = 0; k < fs.length; k++) {
      if (!Array.isArray(fs[k]) || fs[k].length < 3) {
        throw new Error('face ' + k + ' needs >= 3 indices');
      }
      var loop = [];
      for (var m = 0; m < fs[k].length; m++) {
        assertIndex(fs[k][m], verts.length, 'face index');
        loop.push(fs[k][m]);
      }
      faces.push(loop);
    }
    var normals = [];
    for (var f = 0; f < faces.length; f++) {
      normals.push(newellNormal(verts, faces[f]));
    }
    var adj = {};
    for (var g = 0; g < faces.length; g++) {
      var lp = faces[g];
      for (var h = 0; h < lp.length; h++) {
        var key = edgeKey(lp[h], lp[(h + 1) % lp.length]);
        if (!adj[key]) adj[key] = [];
        adj[key].push(g);
      }
    }
    var edgeFaces = [];
    for (var e = 0; e < edges.length; e++) {
      var ek = edgeKey(edges[e][0], edges[e][1]);
      edgeFaces.push(adj[ek] ? adj[ek].slice() : []);
    }
    return {
      name: String(spec.name === undefined ? 'custom' : spec.name),
      vertices: verts, edges: edges, faces: faces,
      faceNormals: normals, edgeFaces: edgeFaces
    };
  }

  var CUBE_GEOMETRY = createGeometry({
    name: 'cube', vertices: VERTICES, edges: EDGES, faces: CUBE_FACES
  });

  function defaultGeometry() { return CUBE_GEOMETRY; }

  function geometryOf(st) {
    return (st && st.geometry) ? st.geometry : CUBE_GEOMETRY;
  }

  // Center a geometry's bounding box on the origin and uniformly scale it
  // so the largest half-extent is 1 (cube stage space). Aspect preserved.
  // Returns {geometry, transform:{cx,cy,cz,scale}}. Single-point inputs
  // center to the origin with scale 1.
  function normalizeGeometry(geometry) {
    if (!geometry || !Array.isArray(geometry.vertices) ||
        geometry.vertices.length < 1) {
      throw new Error('cannot normalize empty geometry');
    }
    var vs = geometry.vertices;
    var minX = vs[0].x, maxX = vs[0].x;
    var minY = vs[0].y, maxY = vs[0].y;
    var minZ = vs[0].z, maxZ = vs[0].z;
    for (var i = 1; i < vs.length; i++) {
      assertFinite(vs[i].x, vs[i].y, vs[i].z);
      if (vs[i].x < minX) minX = vs[i].x;
      if (vs[i].x > maxX) maxX = vs[i].x;
      if (vs[i].y < minY) minY = vs[i].y;
      if (vs[i].y > maxY) maxY = vs[i].y;
      if (vs[i].z < minZ) minZ = vs[i].z;
      if (vs[i].z > maxZ) maxZ = vs[i].z;
    }
    var cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    var half = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    var scale = half > 1e-12 ? 1 / half : 1;
    var out = [];
    for (var j = 0; j < vs.length; j++) {
      out.push({
        x: (vs[j].x - cx) * scale,
        y: (vs[j].y - cy) * scale,
        z: (vs[j].z - cz) * scale
      });
    }
    return {
      geometry: createGeometry({
        name: geometry.name || 'custom',
        vertices: out,
        edges: geometry.edges || [],
        faces: geometry.faces || []
      }),
      transform: { cx: cx, cy: cy, cz: cz, scale: scale }
    };
  }

  function createSolidState(opts) {
    opts = opts || {};
    var size = (opts.size === undefined || opts.size === null) ?
      SIZE_DEFAULT : clampSizePx(opts.size);
    var yaw = (opts.yaw === undefined || opts.yaw === null) ?
      ISO_YAW_RAD : opts.yaw;
    var pitch = (opts.pitch === undefined || opts.pitch === null) ?
      ISO_PITCH_RAD : opts.pitch;
    var scale = (opts.scale === undefined || opts.scale === null) ?
      1 : opts.scale;
    assertFinite(yaw, pitch, scale);
    return {
      yaw: yaw,
      pitch: clamp(pitch, -PITCH_LIMIT_RAD, PITCH_LIMIT_RAD),
      scale: clamp(scale, ZOOM_MIN, ZOOM_MAX),
      size: size,
      geometry: (opts.geometry === undefined || opts.geometry === null) ?
        CUBE_GEOMETRY : opts.geometry,
      status: { available: true, reason: '', label: '' }
    };
  }

  function statusOf(st) {
    return (st && st.status) ? st.status : { available: true, reason: '', label: '' };
  }

  // Push a reconstructed geometry into a state or a mounted widget. The
  // geometry is normalized into stage space (uniform scale, aspect kept)
  // unless opts.normalize === false. A null geometry restores the default
  // cube. Widget targets redraw immediately and return the widget; state
  // targets return the state.
  function setGeometry(target, geometry, opts) {
    var st = (target && target.state) ? target.state : target;
    if (!st) throw new Error('setGeometry needs a state or widget');
    opts = opts || {};
    if (geometry === undefined || geometry === null) {
      st.geometry = CUBE_GEOMETRY;
    } else if (opts.normalize === false) {
      st.geometry = geometry;
    } else {
      st.geometry = normalizeGeometry(geometry).geometry;
    }
    st.status = { available: true, reason: '', label: '' };
    if (target && target.state && target.el &&
        typeof target.el.setAttribute === 'function') {
      target.el.setAttribute('data-solid', st.geometry.name || 'custom');
    }
    if (target && target.state && typeof target.draw === 'function') {
      target.draw();
      return target;
    }
    return st;
  }

  // Named "3D unavailable" state: render() draws the reason instead of
  // geometry until setGeometry restores an available geometry.
  function setUnavailable(target, reason, label) {
    var st = (target && target.state) ? target.state : target;
    if (!st) throw new Error('setUnavailable needs a state or widget');
    st.status = {
      available: false,
      reason: String(reason === undefined ? 'unknown' : reason),
      label: String(label === undefined ? '' : label)
    };
    if (target && target.state && typeof target.draw === 'function') {
      target.draw();
      return target;
    }
    return st;
  }

  // Rest pose: exact isometric projection.
  function resetView(st) {
    st.yaw = ISO_YAW_RAD;
    st.pitch = ISO_PITCH_RAD;
    st.scale = 1;
    return st;
  }

  // Turntable orbit: horizontal pointer travel spins yaw, vertical travel
  // tilts pitch (clamped so the cube never flips inside-out).
  function rotateBy(st, dxPx, dyPx) {
    assertFinite(dxPx, dyPx);
    st.yaw += dxPx * ORBIT_RAD_PER_PX;
    st.pitch = clamp(st.pitch + dyPx * ORBIT_RAD_PER_PX,
      -PITCH_LIMIT_RAD, PITCH_LIMIT_RAD);
    return st;
  }

  function zoomBy(st, factor) {
    assertFinite(factor);
    if (!(factor > 0)) throw new Error('zoom factor must be > 0');
    st.scale = clamp(st.scale * factor, ZOOM_MIN, ZOOM_MAX);
    return st;
  }

  function projectionRadius(st) {
    return st.scale * st.size * RADIUS_FRAC;
  }

  // Orthographic projector. Yaw spins about world Y, pitch tilts about the
  // viewer X axis; screen y grows downward. Depth z grows toward the viewer
  // (larger z renders in front). Projects the state's geometry (default
  // cube: 8 {x, y, z} points in CSS px).
  function project(st, cxPx, cyPx) {
    assertFinite(st.yaw, st.pitch, st.scale, cxPx, cyPx);
    var verts = geometryOf(st).vertices;
    var r = projectionRadius(st);
    var out = [];
    for (var i = 0; i < verts.length; i++) {
      var v = verts[i];
      var q = rotateDir(v.x, v.y, v.z, st.yaw, st.pitch);
      out.push({ x: cxPx + q.x * r, y: cyPx - q.y * r, z: q.z });
    }
    return out;
  }

  // Rotate one direction by the state's yaw/pitch. Shared by the vertex
  // projector and the face-visibility test so both always agree.
  function rotateDir(x, y, z, yaw, pitch) {
    var cy = Math.cos(yaw), sy = Math.sin(yaw);
    var cp = Math.cos(pitch), sp = Math.sin(pitch);
    var x1 = x * cy + z * sy;
    var z1 = -x * sy + z * cy;
    return { x: x1, y: y * cp - z1 * sp, z: y * sp + z1 * cp };
  }

  // Front/back verdict per normal: a face turns toward the viewer when
  // its rotated outward normal has positive depth.
  function faceVisibilityFor(normals, yaw, pitch) {
    assertFinite(yaw, pitch);
    var out = [];
    for (var i = 0; i < normals.length; i++) {
      var n = normals[i];
      out.push(rotateDir(n.x, n.y, n.z, yaw, pitch).z > 0);
    }
    return out;
  }

  // Front/back verdict per face: a face turns toward the viewer when its
  // rotated outward normal has positive depth. Returns 6 booleans.
  function faceVisibility(yaw, pitch) {
    return faceVisibilityFor(FACE_NORMALS, yaw, pitch);
  }

  // Split the state's edges into solid front strokes and dashed hidden
  // strokes. An edge reads as hidden only when it has adjacent faces and
  // every adjacent face turns away, so the default cube shows 9 solid + 3
  // dashed edges (exactly 3 hidden at the isometric rest pose). Faceless
  // wireframe edges always read as solid. Returns [{a, b, hidden}].
  function classifyEdges(st) {
    assertFinite(st.yaw, st.pitch);
    var g = geometryOf(st);
    var vis = faceVisibilityFor(g.faceNormals, st.yaw, st.pitch);
    var out = [];
    for (var i = 0; i < g.edges.length; i++) {
      var f = g.edgeFaces[i] || [];
      var hidden = false;
      if (f.length > 0) {
        hidden = true;
        for (var j = 0; j < f.length; j++) {
          if (vis[f[j]]) { hidden = false; break; }
        }
      }
      out.push({ a: g.edges[i][0], b: g.edges[i][1], hidden: hidden });
    }
    return out;
  }

  // Named "3D unavailable" stage: two centered ink lines, no geometry.
  // Returns {front:0, hidden:0, vertices:0, unavailable:reason}.
  function renderUnavailable(ctx, status, cx, cy) {
    var msg = status.label || status.reason || 'unavailable';
    ctx.save();
    try {
      ctx.fillStyle = LINE_COLOR;
      ctx.globalAlpha = 1;
      if (typeof ctx.textAlign !== 'undefined') ctx.textAlign = 'center';
      if (typeof ctx.textBaseline !== 'undefined') ctx.textBaseline = 'middle';
      if (typeof ctx.fillText === 'function') {
        ctx.font = STATUS_FONT;
        ctx.fillText('3D unavailable', cx, cy - 9);
        ctx.font = STATUS_SUB_FONT;
        ctx.globalAlpha = 0.75;
        ctx.fillText(String(msg), cx, cy + 9);
      }
    } finally {
      if (typeof ctx.restore === 'function') ctx.restore();
    }
    return { front: 0, hidden: 0, vertices: 0, unavailable: status.reason };
  }

  // Pen-style draw: hidden edges first (dashed, faint), then front edges
  // (solid ink), then filled vertex dots. Never fills a background: the
  // stage stays fully transparent so the cube sits on the sheet paper.
  // Returns {front, hidden, vertices} counts. No-op (null) without ctx.
  // When the state is unavailable, draws the named reason instead and
  // returns {front:0, hidden:0, vertices:0, unavailable}.
  function render(ctx, st, o) {
    if (!ctx || typeof ctx.beginPath !== 'function') return null;
    o = o || {};
    var size = st.size;
    var cx = (o.cxPx === undefined || o.cxPx === null) ? size / 2 : o.cxPx;
    var cy = (o.cyPx === undefined || o.cyPx === null) ? size / 2 : o.cyPx;
    assertFinite(cx, cy);
    var status = statusOf(st);
    if (!status.available) return renderUnavailable(ctx, status, cx, cy);
    var pts = project(st, cx, cy);
    var edges = classifyEdges(st);
    var counts = { front: 0, hidden: 0, vertices: pts.length };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    var pass, i, e, pa, pb;
    for (pass = 0; pass < 2; pass++) {
      var wantHidden = (pass === 0);
      for (i = 0; i < edges.length; i++) {
        e = edges[i];
        if ((e.hidden ? 1 : 0) !== (wantHidden ? 1 : 0)) continue;
        if (e.hidden) counts.hidden++;
        else counts.front++;
        pa = pts[e.a];
        pb = pts[e.b];
        ctx.save();
        ctx.strokeStyle = LINE_COLOR;
        ctx.globalAlpha = e.hidden ? HIDDEN_OPACITY : 1;
        ctx.lineWidth = LINE_WIDTH_PX;
        if (typeof ctx.setLineDash === 'function') {
          ctx.setLineDash(e.hidden ? HIDDEN_DASH : []);
        }
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.fillStyle = VERTEX_FILL;
    for (i = 0; i < pts.length; i++) {
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, VERTEX_R_PX, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
    return counts;
  }

  function hasDOM() {
    return (typeof document !== 'undefined') && !!document &&
      (typeof document.createElement === 'function');
  }

  function stopEvt(e) {
    if (!e) return;
    if (typeof e.stopPropagation === 'function') e.stopPropagation();
    if (typeof e.preventDefault === 'function') e.preventDefault();
  }

  function resolveDpr(optsDpr) {
    if (optsDpr !== undefined && optsDpr !== null) {
      var o = Number(optsDpr);
      if (isFinite(o) && o >= 1) return o;
    }
    if (typeof window !== 'undefined' && window &&
        isFinite(Number(window.devicePixelRatio)) &&
        Number(window.devicePixelRatio) >= 1) {
      return Number(window.devicePixelRatio);
    }
    return 1;
  }

  // Floating widget: transparent 2D stage, orbit on canvas drag, move via
  // the hover pill, wheel zoom, double-click reset. Redraws only while
  // interacting (one RAF per dirty frame); idle costs nothing.
  function mountSolidWidget(container, opts) {
    opts = opts || {};
    var st = createSolidState(opts);
    if (!hasDOM() || container === null || container === undefined ||
        typeof container.appendChild !== 'function') {
      return {
        headless: true, container: null, el: null, canvas: null,
        handle: null, state: st, mounted: true,
        draw: function () { return null; },
        dispose: function () { return null; }
      };
    }
    var dpr = resolveDpr(opts.dpr);
    var buf = Math.max(1, Math.round(st.size * dpr));

    var el = document.createElement('div');
    el.className = WIDGET_CLASS;
    el.setAttribute('data-solid', geometryOf(st).name || 'cube');
    el.style.width = st.size + 'px';
    el.style.height = st.size + 'px';
    if (opts.x !== undefined && opts.x !== null &&
        opts.y !== undefined && opts.y !== null) {
      assertFinite(opts.x, opts.y);
      el.style.left = Math.round(opts.x) + 'px';
      el.style.top = Math.round(opts.y) + 'px';
    } else {
      el.style.right = '24px';
      el.style.top = '64px';
    }

    var grip = document.createElement('div');
    grip.className = HANDLE_CLASS;
    grip.textContent = HANDLE_TEXT;
    el.appendChild(grip);

    var cv = document.createElement('canvas');
    cv.className = CANVAS_CLASS;
    cv.width = buf;
    cv.height = buf;
    cv.style.width = st.size + 'px';
    cv.style.height = st.size + 'px';
    el.appendChild(cv);
    container.appendChild(el);

    var ctx = null;
    try {
      if (typeof cv.getContext === 'function') ctx = cv.getContext('2d');
    } catch (e) { ctx = null; }

    function draw() {
      if (!ctx) return null;
      if (typeof ctx.setTransform === 'function') {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (typeof ctx.clearRect === 'function') {
        ctx.clearRect(0, 0, st.size, st.size);
      }
      return render(ctx, st);
    }

    // On-demand frames: a single RAF coalesces bursts of pointer events.
    var rafPending = false;
    function scheduleDraw() {
      if (rafPending) return;
      rafPending = true;
      var raf = (typeof window !== 'undefined' && window &&
        typeof window.requestAnimationFrame === 'function') ?
        window.requestAnimationFrame : null;
      if (!raf) {
        rafPending = false;
        draw();
        return;
      }
      raf(function () {
        rafPending = false;
        draw();
      });
    }

    function capture(el2, e) {
      try {
        if (el2 && typeof el2.setPointerCapture === 'function' &&
            e && e.pointerId !== undefined) {
          el2.setPointerCapture(e.pointerId);
        }
      } catch (err) { /* headless/mock pointer: capture is best-effort */ }
    }

    // --- Orbit: left-drag on the canvas spins the cube. ---
    var orbiting = false;
    var lastX = 0, lastY = 0;
    function onOrbitDown(e) {
      stopEvt(e);
      if (e && e.button !== undefined && e.button !== 0) return;
      if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) return;
      orbiting = true;
      lastX = e.clientX;
      lastY = e.clientY;
      cv.style.cursor = 'grabbing';
      capture(cv, e);
    }
    function onOrbitMove(e) {
      if (!orbiting) return;
      stopEvt(e);
      rotateBy(st, e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleDraw();
    }
    function onOrbitUp(e) {
      if (!orbiting) return;
      stopEvt(e);
      orbiting = false;
      cv.style.cursor = '';
    }

    // --- Move: drag the hover pill to reposition the widget on the sheet. ---
    var moving = false;
    var mStartX = 0, mStartY = 0, mBaseL = 0, mBaseT = 0;
    function onGripDown(e) {
      stopEvt(e);
      if (e && e.button !== undefined && e.button !== 0) return;
      moving = true;
      mStartX = e.clientX;
      mStartY = e.clientY;
      // Snapshot layout BEFORE clearing right: with left/right both auto
      // the box would fall back to its static position.
      mBaseL = el.offsetLeft || 0;
      mBaseT = el.offsetTop || 0;
      el.style.right = 'auto';
      el.style.left = mBaseL + 'px';
      el.style.top = mBaseT + 'px';
      capture(grip, e);
    }
    function onGripMove(e) {
      if (!moving) return;
      stopEvt(e);
      var w = (container && container.clientWidth) || window.innerWidth || st.size;
      var h = (container && container.clientHeight) || window.innerHeight || st.size;
      var nl = clamp(mBaseL + (e.clientX - mStartX), 0, Math.max(0, w - st.size));
      var nt = clamp(mBaseT + (e.clientY - mStartY), 0, Math.max(0, h - st.size));
      el.style.left = Math.round(nl) + 'px';
      el.style.top = Math.round(nt) + 'px';
    }
    function onGripUp(e) {
      if (!moving) return;
      stopEvt(e);
      moving = false;
    }

    function onWheel(e) {
      stopEvt(e);
      var f = (e && e.deltaY < 0) ? ZOOM_STEP : (1 / ZOOM_STEP);
      zoomBy(st, f);
      scheduleDraw();
    }
    function onDblClick(e) {
      stopEvt(e);
      resetView(st);
      scheduleDraw();
    }
    function onIsolate(e) {
      // Clicks and keys inside the widget must never reach sheet tools.
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    }

    cv.addEventListener('pointerdown', onOrbitDown);
    cv.addEventListener('pointermove', onOrbitMove);
    cv.addEventListener('pointerup', onOrbitUp);
    cv.addEventListener('pointercancel', onOrbitUp);
    grip.addEventListener('pointerdown', onGripDown);
    grip.addEventListener('pointermove', onGripMove);
    grip.addEventListener('pointerup', onGripUp);
    grip.addEventListener('pointercancel', onGripUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('click', onIsolate);
    el.addEventListener('contextmenu', onIsolate);

    draw();

    return {
      headless: false, container: container, el: el, canvas: cv,
      handle: grip, state: st, mounted: true, dpr: dpr,
      draw: draw,
      dispose: function () {
        cv.removeEventListener('pointerdown', onOrbitDown);
        cv.removeEventListener('pointermove', onOrbitMove);
        cv.removeEventListener('pointerup', onOrbitUp);
        cv.removeEventListener('pointercancel', onOrbitUp);
        grip.removeEventListener('pointerdown', onGripDown);
        grip.removeEventListener('pointermove', onGripMove);
        grip.removeEventListener('pointerup', onGripUp);
        grip.removeEventListener('pointercancel', onGripUp);
        el.removeEventListener('wheel', onWheel);
        el.removeEventListener('dblclick', onDblClick);
        el.removeEventListener('click', onIsolate);
        el.removeEventListener('contextmenu', onIsolate);
        if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
          el.parentNode.removeChild(el);
        }
        orbiting = false;
        moving = false;
        return null;
      }
    };
  }

  return {
    SIZE_DEFAULT: SIZE_DEFAULT, SIZE_MIN: SIZE_MIN, SIZE_MAX: SIZE_MAX,
    LINE_COLOR: LINE_COLOR, LINE_WIDTH_PX: LINE_WIDTH_PX,
    VERTEX_FILL: VERTEX_FILL, VERTEX_R_PX: VERTEX_R_PX,
    HIDDEN_DASH: HIDDEN_DASH, HIDDEN_OPACITY: HIDDEN_OPACITY,
    ISO_YAW_RAD: ISO_YAW_RAD, ISO_PITCH_RAD: ISO_PITCH_RAD,
    ORBIT_RAD_PER_PX: ORBIT_RAD_PER_PX,
    PITCH_LIMIT_RAD: PITCH_LIMIT_RAD,
    ZOOM_MIN: ZOOM_MIN, ZOOM_MAX: ZOOM_MAX, ZOOM_STEP: ZOOM_STEP,
    RADIUS_FRAC: RADIUS_FRAC,
    WIDGET_CLASS: WIDGET_CLASS, CANVAS_CLASS: CANVAS_CLASS,
    HANDLE_CLASS: HANDLE_CLASS, HANDLE_TEXT: HANDLE_TEXT,
    VERTICES: VERTICES, EDGES: EDGES,
    FACE_NORMALS: FACE_NORMALS, EDGE_FACES: EDGE_FACES,
    CUBE_FACES: CUBE_FACES,
    rotateDir: rotateDir, faceVisibility: faceVisibility,
    faceVisibilityFor: faceVisibilityFor,
    createSolidState: createSolidState,
    createGeometry: createGeometry, defaultGeometry: defaultGeometry,
    normalizeGeometry: normalizeGeometry,
    setGeometry: setGeometry, setUnavailable: setUnavailable,
    statusOf: statusOf,
    resetView: resetView,
    rotateBy: rotateBy, zoomBy: zoomBy,
    projectionRadius: projectionRadius,
    project: project, classifyEdges: classifyEdges,
    render: render,
    hasDOM: hasDOM,
    mountSolidWidget: mountSolidWidget
  };
});

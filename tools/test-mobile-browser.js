// Run this entire expression using T3 preview_evaluate, awaitPromise=true,
// on a disposable guest sheet (desktop, narrow, or phone viewport), or
// headless in the cached Chromium shell over CDP. Re-run at a second
// aspect to cover both portrait and landscape layout cases. It replaces
// the guest drawing and history. Does not call any server APIs.
//
// Mobile View/Pose behavior suite against the EduCADMobile split shell.
// Split layout and inspection-only are separate axes: narrow desktop
// windows split but keep Edit; touch-only devices split AND refuse
// authoring. Tests gate on the axis they need and SKIP otherwise, naming
// the missing precondition. See docs/MOBILE_SUPPORT_TEST_PLAN.md.
(async function mobileSupportAudit() {
  'use strict';
  var h = window.educadHandle;
  if (!h || !h.drafting) throw new Error('Open the EduCAD guest sheet first.');
  if (!window.EduCADSaves.isGuest(window.EduCADSaves.currentSession())) {
    throw new Error('Use a disposable guest sheet for this audit.');
  }
  var results = [], errors = [];
  function onError(event) { errors.push(event.message); }
  window.addEventListener('error', onError);
  var frame = function () { return new Promise(requestAnimationFrame); };
  function Skip(message) { this.skip = true; this.message = message; }
  function assert(condition, detail) { if (!condition) throw new Error(JSON.stringify(detail)); }
  async function test(name, fn) {
    try {
      var evidence = await fn();
      results.push({ name: name, status: 'PASS', evidence: evidence || null });
    } catch (error) {
      if (error && error.skip) results.push({ name: name, status: 'SKIP', evidence: error.message });
      else results.push({ name: name, status: 'FAIL', evidence: String(error && error.message || error) });
    }
  }

  // ---- discovery (snapshot before any test mutates modes) ----
  function media(query) {
    try { return !!(window.matchMedia && window.matchMedia(query).matches); }
    catch (err) { return false; }
  }
  var MB = window.EduCADMobile || null;
  var disc = {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    coarse: media('(pointer: coarse)'),
    fine: media('(pointer: fine)'),
    touchPoints: navigator.maxTouchPoints || (('ontouchstart' in window) ? 1 : 0),
    entryMode: h.measure.mode,
    mobileModule: !!MB
  };
  function splitOn() {
    if (MB && typeof MB.splitActive === 'function') {
      try { if (MB.splitActive()) return true; } catch (err) {}
    }
    if (document.body.classList.contains('mobile-layout')) return true;
    var panes = document.getElementById('mobile-panes');
    return !!(panes && !panes.hidden);
  }
  function inspectionOn() {
    if (document.body.classList.contains('mobile-inspect')) return true;
    return disc.coarse && !disc.fine;
  }
  function needSplit(hook) {
    if (splitOn()) return true;
    throw new Skip('split layout inactive at ' + disc.viewport.w + 'x' + disc.viewport.h +
      '; ' + hook + ' needs it (narrow the viewport or use a touch-only device).');
  }
  function needInspection(hook) {
    if (inspectionOn()) return true;
    throw new Skip('inspection-only verdict off (no coarse pointer); ' + hook +
      ' needs a touch-only device.');
  }
  function center(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
  }
  function byText(root, selector, text) {
    var found = null;
    root.querySelectorAll(selector).forEach(function (el) {
      if (found) return;
      if ((el.textContent || '').trim() === text) found = el;
    });
    return found;
  }

  // ---- shared drivers ----
  // Inspection devices refuse direct table writes (mutation guard), so
  // setup goes through the privileged loader there; desktop writes
  // directly in Edit. Both paths are the suite's own fixture loading,
  // not user authoring.
  async function reset() {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (h.drafting) h.drafting.cancel();
    if (inspectionOn()) {
      window.educadReplaceSheet({ entities: [] });
      window.educadSetSheetMode('view');
    } else {
      window.educadSetSheetMode('edit');
      h.table.clear();
    }
    h.drafting.preferences({ guides: true, solid: true });
    document.getElementById('cmd-bar').hidden = true;
    await frame();
  }
  function setupLine() {
    if (!inspectionOn()) {
      var a = h.table.create('POINT', { x: 0, y: 20, caption: 'a', viewRole: 'ELEVATION' });
      var b = h.table.create('POINT', { x: 10, y: 20, caption: 'b', viewRole: 'ELEVATION' });
      var line = h.table.create('SEGMENT', { x: a.x, y: a.y, x2: b.x, y2: b.y, viewRole: 'ELEVATION', meta: { refs: [a.id, b.id] } });
      return { a: a, b: b, line: line };
    }
    window.educadReplaceSheet({ entities: [
      { id: 'm1', type: 'POINT', x: 0, y: 20, caption: 'a', viewRole: 'ELEVATION' },
      { id: 'm2', type: 'POINT', x: 10, y: 20, caption: 'b', viewRole: 'ELEVATION' },
      { id: 'm3', type: 'SEGMENT', x: 0, y: 20, x2: 10, y2: 20, viewRole: 'ELEVATION', meta: { refs: ['m1', 'm2'] } }
    ] });
    var list = h.table.list();
    function byId(id) { return list.filter(function (e) { return e.id === id; })[0]; }
    return { a: byId('m1'), b: byId('m2'), line: byId('m3') };
  }
  function setupPoints(defs) {
    if (!inspectionOn()) {
      return defs.map(function (d) { return h.table.create('POINT', d); });
    }
    var entities = defs.map(function (d, i) {
      return { id: 's' + i, type: 'POINT', x: d.x, y: d.y,
        caption: d.caption, viewRole: d.viewRole || 'ELEVATION' };
    });
    window.educadReplaceSheet({ entities: entities });
    return h.table.list().slice();
  }
  function openMenu() {
    var ov = document.querySelector('#mobile-header .mobile-icon-btn');
    if (!ov) throw new Skip('mobile header hook missing (#mobile-header .mobile-icon-btn).');
    var menu = document.getElementById('mobile-menu');
    if (menu.hidden) ov.click();
    assert(!menu.hidden, 'menu did not open');
    return menu;
  }
  function menuItem(text) {
    var menu = openMenu();
    var b = byText(menu, '.mobile-menu-btn', text);
    assert(b, { item: text });
    return b;
  }
  function loadDemo3view() {
    if (inspectionOn()) {
      menuItem('3-View Prism').click();
    } else {
      window.educadRunCommand('/demo 3view');
    }
  }
  function exitToIdle() {
    window.educadSetSheetMode(inspectionOn() ? 'view' : 'edit');
  }
  function key(value, extra) {
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown',
      Object.assign({ key: value, bubbles: true, cancelable: true }, extra || {})));
  }
  function pointerOn(target, name, client, extra) {
    target.dispatchEvent(new PointerEvent(name,
      Object.assign({ bubbles: true, button: 0, pointerId: 1, clientX: client.x, clientY: client.y }, extra || {})));
  }
  function sheetPointer(name, worldMm, extra) {
    var px = EduCADViewport.forward(h.view, worldMm);
    pointerOn(h.mount.layer2, name, slotClient(h.mount.layer2, px.x, px.y), extra);
  }
  function sheetClick(worldMm) {
    var px = EduCADViewport.forward(h.view, worldMm);
    px = slotClient(h.mount.layer2, px.x, px.y);
    sheetPointer('pointerdown', worldMm);
    sheetPointer('pointerup', worldMm);
    h.mount.layer2.dispatchEvent(new MouseEvent('click',
      { bubbles: true, button: 0, clientX: px.x, clientY: px.y, altKey: true }));
  }
  function slotClient(slot, sx, sy) {
    var r = slot.getBoundingClientRect();
    return { x: r.left + sx, y: r.top + sy };
  }
  function slotTap(slot, sx, sy, pid) {
    var c = slotClient(slot, sx, sy);
    pointerOn(slot, 'pointerdown', c, { pointerType: 'touch', isPrimary: true, pointerId: pid });
    pointerOn(slot, 'pointerup', c, { pointerType: 'touch', isPrimary: true, pointerId: pid });
  }
  function counts() { return h.history ? h.history.counts() : { undo: -1, redo: -1 }; }
  function camState() {
    var st = h.solid && h.solid.state;
    return st ? { yaw: st.yaw, pitch: st.pitch, scale: st.scale, cx: st.cx, cy: st.cy } : null;
  }

  // ---- always-run: usability, desktop axes, in-browser foundations ----
  await test('sheet usable at this viewport', async function () {
    assert(h.mount.layer1.isConnected && h.mount.layer2.isConnected,
      'sheet canvases detached from the mounted page');
    assert(h.mount.layer2.getBoundingClientRect().height > 0,
      'sheet canvas has no visible area');
    var before = h.measure.mode;
    assert(window.educadSetSheetMode('view') === 'view', 'cannot enter view');
    var probe = null;
    try {
      if (inspectionOn()) {
        window.educadReplaceSheet({ entities: [{ id: 'probe', type: 'POINT', x: 1, y: 2, viewRole: 'ELEVATION' }] });
        probe = h.table.get('probe');
        window.educadReplaceSheet({ entities: [] });
      } else {
        window.educadSetSheetMode('edit');
        probe = h.table.create('POINT', { x: 1, y: 2, viewRole: 'ELEVATION' });
        h.table.clear();
      }
    } finally {
      exitToIdle();
    }
    assert(probe, 'fixture path broken');
    var legacy = document.getElementById('mobile-block');
    assert(!legacy || legacy.getAttribute('aria-hidden') === 'true' ||
      legacy.style.display === 'none', 'legacy blocker visible');
    return { mode: h.measure.mode, split: splitOn(), inspection: inspectionOn() };
  });

  await test('desktop unaffected: wide viewport keeps one pane and edit', async function () {
    if (splitOn()) throw new Skip('split active; wide-desktop check needs >=920px width and a 640px min dimension.');
    assert(!document.body.classList.contains('mobile-layout'), 'mobile layout on desktop');
    var header = document.getElementById('mobile-header');
    assert(!header || header.hidden, 'mobile header live on desktop');
    var be = document.getElementById('btn-mode-edit');
    assert(be && be.offsetParent !== null, 'edit button hidden');
    await reset();
    assert(window.educadSetSheetMode('edit') === 'edit', 'edit refused on desktop');
    return { mode: h.measure.mode };
  });

  await test('narrow desktop: split layout but edit stays', async function () {
    needSplit('narrow-desktop check');
    if (inspectionOn()) throw new Skip('inspection verdict on; narrow-desktop check needs a fine pointer.');
    await reset();
    assert(window.educadSetSheetMode('edit') === 'edit', 'edit refused in a narrow window');
    var editBtn = byText(document.getElementById('mobile-header'), '.mobile-seg-btn', 'Edit');
    assert(editBtn && editBtn.style.display !== 'none', 'mobile edit button hidden');
    var menu = openMenu();
    var tut = byText(menu, '.mobile-menu-btn', 'Tutorial: Square');
    assert(tut && !tut.disabled, 'tutorials disabled in a narrow window');
    document.querySelector('#mobile-header .mobile-icon-btn').click();
    return { editableSplit: true };
  });

  await test('foundation: view tap preserves the table', async function () {
    await reset();
    var s = setupLine();
    window.educadSetSheetMode('view');
    var before = JSON.stringify(h.table.list());
    sheetClick(s.a);
    assert(before === JSON.stringify(h.table.list()), 'view click mutated geometry');
    assert(h.measure.inspectId !== null, 'tap inspected nothing');
    exitToIdle();
    return { inspectId: h.measure.inspectId };
  });

  await test('foundation: pose gesture and Escape preserve table and history', async function () {
    await reset();
    loadDemo3view();
    await frame();
    var before = JSON.stringify(h.table.list());
    var c0 = counts();
    window.educadSetSheetMode('pose');
    key('g'); key('y');
    sheetPointer('pointermove', { x: -120, y: 130 });
    key('Escape');
    assert(before === JSON.stringify(h.table.list()), 'pose gesture mutated the table');
    assert(window.educadPoseViews() !== null, 'Escape should cancel the gesture, not exit pose');
    var c1 = counts();
    assert(c0.undo === c1.undo && c0.redo === c1.redo, { before: c0, after: c1 });
    exitToIdle();
    return { gestureCancelled: true, counts: c1 };
  });

  await test('foundation: exiting pose restores the sheet exactly', async function () {
    await reset();
    loadDemo3view();
    await frame();
    var before = JSON.stringify(h.table.list());
    var c0 = counts();
    window.educadSetSheetMode('pose');
    key('r'); key('z');
    sheetPointer('pointermove', { x: 60, y: -40 });
    sheetClick({ x: 60, y: -40 }); // click confirms the live transform
    key('Escape');
    exitToIdle();
    assert(before === JSON.stringify(h.table.list()), 'pose exit changed the table');
    var c1 = counts();
    assert(c0.undo === c1.undo && c0.redo === c1.redo, { before: c0, after: c1 });
    assert(window.educadPoseViews() === null, 'pose probe live after exit');
    return { restored: true };
  });

  await test('foundation: huge pose drag engages the datum clamp', async function () {
    await reset();
    loadDemo3view();
    await frame();
    window.educadSetSheetMode('pose');
    key('g');
    for (var i = 0; i < 5; i++) {
      h.mount.layer2.dispatchEvent(new PointerEvent('pointermove',
        { bubbles: true, button: 0, pointerId: 1, clientX: 4000, clientY: 4000 }));
    }
    var pv = window.educadPoseViews();
    assert(pv && pv.limited === true, { limited: pv && pv.limited });
    assert(isFinite(pv.clearanceMm), { clearance: pv.clearanceMm });
    key('Escape');
    exitToIdle();
    return { limited: true, clearanceMm: pv.clearanceMm };
  });

  await test('foundation: view stays read-only to commands', async function () {
    await reset();
    setupLine();
    window.educadSetSheetMode('view');
    var before = JSON.stringify(h.table.list());
    var res = window.educadRunCommand('/point z 0 30 elevation');
    assert(!res.ok && /read-only/.test(res.message), res);
    assert(before === JSON.stringify(h.table.list()), 'gated command mutated the table');
    exitToIdle();
    return { gated: true };
  });

  // ---- inspection entry and authoring bar (plan A) ----
  await test('mobile entry: boots into view', async function () {
    needInspection('entry mode');
    assert(disc.entryMode === 'view', { entryMode: disc.entryMode });
    return { entryMode: disc.entryMode };
  });

  await test('mobile: edit refused centrally, inputs barred', async function () {
    needInspection('authoring bar');
    await reset();
    setupLine();
    window.educadSetSheetMode('view');
    var before = JSON.stringify(h.table.list());
    var modeAfter = window.educadSetSheetMode('edit');
    assert(modeAfter !== 'edit' && h.measure.mode !== 'edit',
      { returned: modeAfter, mode: h.measure.mode });
    var editBtn = byText(document.getElementById('mobile-header'), '.mobile-seg-btn', 'Edit');
    assert(editBtn && editBtn.style.display === 'none', 'edit affordance live on mobile');
    [['/point z 0 30 elevation'], ['/clear'], ['/undo'], ['/redo'], ['/tutorial square'], ['/mode edit']].forEach(function (args) {
      var res = window.educadRunCommand(args[0]);
      assert(!res.ok, { line: args[0], res: res });
    });
    ['l', 'Backspace', 'Enter', ' '].forEach(function (k) { key(k); });
    h.mount.layer2.dispatchEvent(new PointerEvent('pointerdown',
      { bubbles: true, button: 0, pointerId: 1, clientX: 60, clientY: 60 }));
    h.mount.layer2.dispatchEvent(new PointerEvent('pointerup',
      { bubbles: true, button: 0, pointerId: 1, clientX: 60, clientY: 60 }));
    var threw = false;
    try {
      h.table.create('POINT', { x: 9, y: 9, viewRole: 'ELEVATION' });
    } catch (err) {
      threw = /read-only/.test(err.message);
    }
    assert(threw, 'mutation guard did not throw');
    assert(before === JSON.stringify(h.table.list()), 'barred input mutated the table');
    var demo = window.educadRunCommand('/demo 3view');
    assert(demo.ok && h.measure.mode === 'view' && h.table.count() > 0,
      { demo: demo, mode: h.measure.mode });
    var tut = byText(document.getElementById('sel-tut') || document, 'option', '__none__');
    assert(!tut, 'placeholder');
    assert(document.getElementById('sel-tut').disabled, 'tutorial select live');
    assert(document.getElementById('btn-clear').disabled, 'clear sheet live');
    // Demos are the sanctioned inspection path: they load into View.
    var selDemo = document.getElementById('sel-demo');
    assert(!selDemo.disabled, 'demo select barred');
    selDemo.value = 'square';
    selDemo.dispatchEvent(new Event('change', { bubbles: true }));
    await frame();
    assert(h.table.count() > 0, 'sanctioned demo loaded nothing');
    assert(h.measure.mode === 'view', { mode: h.measure.mode });
    assert(window.educadSetSheetMode('edit') !== 'edit', 'edit reachable after demo load');
    return { editRefused: true, demoLandsInView: true };
  });

  await test('mobile: drawing loads land in view, authoring stays barred', async function () {
    needInspection('drawing loads');
    await reset();
    var n = window.educadReplaceSheet({ entities: [
      { id: 'd1', type: 'POINT', x: 0, y: 25, caption: 'a', viewRole: 'ELEVATION' },
      { id: 'd2', type: 'POINT', x: 0, y: -25, caption: 'a', viewRole: 'PLAN' }
    ] });
    assert(n === 2, 'loader replaced nothing');
    assert(h.measure.mode === 'view', { mode: h.measure.mode });
    assert(window.educadSetSheetMode('edit') !== 'edit', 'edit reachable after load');
    var threw = false;
    try { h.table.create('POINT', { x: 1, y: 1 }); } catch (err) { threw = true; }
    assert(threw, 'guard opened after load');
    return { loaded: n, mode: h.measure.mode };
  });

  await test('mobile menu: opens, bars tutorials and clear, loads demos', async function () {
    needSplit('menu');
    var menu = openMenu();
    var sections = menu.querySelectorAll('.mobile-menu-section').length;
    assert(sections >= 4, { sections: sections });
    var demoBtns = menu.querySelector('.mobile-menu-section').querySelectorAll('.mobile-menu-btn').length;
    assert(demoBtns === 5, { demoBtns: demoBtns });
    var tut = byText(menu, '.mobile-menu-btn', 'Tutorial: Square');
    var clear = byText(menu, '.mobile-menu-btn', 'Clear sheet');
    assert(tut && clear, 'sheet actions missing');
    assert(tut.disabled === inspectionOn(), { disabled: tut.disabled });
    assert(clear.disabled === inspectionOn(), { disabled: clear.disabled });
    key('Escape');
    assert(menu.hidden, 'escape did not close the menu');
    var before = h.table.count();
    await reset();
    menuItem('Profile Square').click();
    await frame();
    assert(document.getElementById('mobile-menu').hidden, 'menu stayed open after load');
    assert(h.table.count() > 0 && h.table.count() !== before || h.table.count() > 0, 'demo loaded nothing');
    if (inspectionOn()) assert(h.measure.mode === 'view', { mode: h.measure.mode });
    return { sections: sections, loaded: h.table.count() };
  });

  // ---- split layout (plan B); re-run at a second aspect ----
  await test('mobile portrait: 3D top, 2D below, no page scroll', async function () {
    needSplit('portrait layout');
    if (!(disc.viewport.h > disc.viewport.w)) {
      throw new Skip('needs a portrait viewport; re-run at e.g. 390x844 (now ' +
        disc.viewport.w + 'x' + disc.viewport.h + ').');
    }
    assert(document.body.classList.contains('mobile-portrait'), 'portrait class missing');
    var r3 = center(document.getElementById('mobile-pane-3d')).rect;
    var r2 = center(document.getElementById('mobile-pane-2d')).rect;
    assert(r3.bottom <= r2.top + 2, { d3: r3.bottom, d2: r2.top });
    assert(r3.width > 0 && r3.height > 0 && r2.width > 0 && r2.height > 0, 'pane collapsed');
    var se = document.scrollingElement;
    assert(se.scrollHeight <= window.innerHeight + 1, { pageH: se.scrollHeight, winH: window.innerHeight });
    return { splitY: r2.top, ratio3d: r3.height / window.innerHeight };
  });

  await test('mobile landscape: panes side by side', async function () {
    needSplit('landscape layout');
    if (!(disc.viewport.w > disc.viewport.h)) {
      throw new Skip('needs a landscape viewport; re-run at e.g. 844x390 (now ' +
        disc.viewport.w + 'x' + disc.viewport.h + ').');
    }
    assert(document.body.classList.contains('mobile-landscape'), 'landscape class missing');
    var r3 = center(document.getElementById('mobile-pane-3d')).rect;
    var r2 = center(document.getElementById('mobile-pane-2d')).rect;
    var sideBySide = r3.right <= r2.left + 2 || r2.right <= r3.left + 2;
    assert(sideBySide, { d3: [r3.left, r3.right], d2: [r2.left, r2.right] });
    return { splitX: Math.min(r3.right, r2.right) };
  });

  await test('mobile 2D pane preserves XY, front, plan, and projectors', async function () {
    needSplit('sheet semantics');
    await reset();
    window.educadReplaceSheet({ entities: [
      { id: 'p1', type: 'POINT', x: 0, y: 25, caption: 'a', viewRole: 'ELEVATION' },
      { id: 'p2', type: 'POINT', x: 0, y: -25, caption: 'a', viewRole: 'PLAN' }
    ] });
    window.educadSetSheetMode('view');
    var slot = document.getElementById('mobile-sheet-slot');
    var sr = slot.getBoundingClientRect();
    function inside(pt, which) {
      var okBox = pt.x >= 0 && pt.x <= sr.width && pt.y >= 0 && pt.y <= sr.height;
      assert(okBox, { which: which, at: pt, slot: [sr.width, sr.height] });
    }
    var xy = EduCADViewport.forward(h.view, { x: 0, y: 0 });
    var front = EduCADViewport.forward(h.view, { x: 0, y: 25 });
    var plan = EduCADViewport.forward(h.view, { x: 0, y: -25 });
    inside(xy, 'XY'); inside(front, 'front'); inside(plan, 'plan');
    assert(front.y < xy.y && xy.y < plan.y, 'front/plan flipped around XY');
    assert(EduCADViewport.checkProjector({ x: 0, y: -25 }, { x: 0, y: 25 }), 'projector broken');
    return { xyY: xy.y, frontY: front.y, planY: plan.y };
  });

  await test('mobile split: divider drags, keyboard steps, expands and returns', async function () {
    needSplit('split interaction');
    var portrait = document.body.classList.contains('mobile-portrait');
    var divider = document.getElementById('mobile-divider');
    assert(divider && divider.getAttribute('role') === 'separator', 'divider hook missing');
    var pane3d = document.getElementById('mobile-pane-3d');
    var pane2d = document.getElementById('mobile-pane-2d');
    // Persisted user fractions can already be at the maximum. Start
    // this interaction check from an interior split, independent of it.
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    for (var step = 0; step < 4; step++) {
      divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }
    var h0 = pane3d.getBoundingClientRect()[portrait ? 'height' : 'width'];
    var c = center(divider);
    var d2 = portrait ? { x: c.x, y: c.y + 60 } : { x: c.x + 60, y: c.y };
    pointerOn(divider, 'pointerdown', c, { pointerId: 11 });
    pointerOn(divider, 'pointermove', d2, { pointerId: 11 });
    pointerOn(divider, 'pointerup', d2, { pointerId: 11 });
    var h1 = pane3d.getBoundingClientRect()[portrait ? 'height' : 'width'];
    assert(Math.abs(h1 - h0) > 4, { from: h0, to: h1 });
    assert(pane2d.getBoundingClientRect().height > 40, 'pane collapsed by split drag');
    divider.focus();
    divider.dispatchEvent(new KeyboardEvent('keydown', { key: portrait ? 'ArrowDown' : 'ArrowRight', bubbles: true }));
    var h2 = pane3d.getBoundingClientRect()[portrait ? 'height' : 'width'];
    assert(h2 > h1, { stepped: [h1, h2] });
    var cam0 = JSON.stringify(camState());
    var view0 = JSON.stringify({ s: h.view.s, tx: h.view.tx, ty: h.view.ty });
    function expandBtn(label) {
      var found = null;
      document.querySelectorAll('#mobile-panes .mobile-pane-bar button').forEach(function (b) {
        if (b.getAttribute('aria-label') === label) found = b;
      });
      assert(found, { expand: label });
      return found;
    }
    expandBtn('Expand 3D pane').click();
    await frame(); await frame();
    assert(document.body.classList.contains('mobile-expand-3d'), 'expand class missing');
    assert(getComputedStyle(pane2d).display === 'none', 'sibling pane visible in expand');
    var both = byText(document.getElementById('mobile-expandbar'), '.mobile-btn', 'Show both');
    assert(both && !document.getElementById('mobile-expandbar').hidden, 'return bar missing');
    both.click();
    await frame(); await frame();
    assert(!document.body.classList.contains('mobile-expand-3d'), 'expand stuck');
    assert(getComputedStyle(pane2d).display !== 'none', 'return did not restore the split');
    var cameraBefore = JSON.parse(cam0), cameraAfter = camState();
    Object.keys(cameraBefore).forEach(function (prop) {
      assert(Math.abs(cameraBefore[prop] - cameraAfter[prop]) < 1e-8,
        { cameraProperty: prop, before: cameraBefore, after: cameraAfter });
    });
    assert(JSON.stringify({ s: h.view.s, tx: h.view.tx, ty: h.view.ty }) === view0, 'expand moved the sheet');
    return { splitMoved: h1 - h0, stepped: h2 - h1 };
  });

  // ---- chrome and sheet (plan C) ----
  await test('mobile chrome: 44px header, sheet toggles, touch-action locked', async function () {
    needSplit('chrome');
    var header = document.getElementById('mobile-header');
    var small = [];
    header.querySelectorAll('.mobile-seg-btn, .mobile-icon-btn').forEach(function (el) {
      if (el.style.display === 'none') return;
      var r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) small.push((el.textContent || '').trim() + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    assert(!small.length, { small: small });
    var handle = document.getElementById('mobile-sheet-handle');
    var hr = handle.getBoundingClientRect();
    assert(hr.width >= 44 && hr.height >= 44, { handle: [hr.width, hr.height] });
    var body = document.getElementById('mobile-sheet-body');
    var wasHidden = body.hidden;
    handle.click();
    await frame();
    assert(body.hidden !== wasHidden, 'sheet toggle dead');
    var openH = document.getElementById('mobile-sheet').getBoundingClientRect().height;
    handle.click();
    await frame();
    assert(body.hidden === wasHidden, 'sheet toggle stuck');
    [['#mobile-sheet-slot canvas[data-layer="layer2"]', 'sheet'],
      ['#mobile-divider', 'divider']].forEach(function (pair) {
      var el = document.querySelector(pair[0]);
      assert(el, pair[0] + ' missing');
      assert(getComputedStyle(el).touchAction === 'none', { el: pair[1], touchAction: getComputedStyle(el).touchAction });
    });
    var compact = [];
    document.querySelectorAll('#mobile-panes .mobile-pane-bar .mobile-btn, #mobile-panes .mobile-pane-bar .mobile-icon-btn').forEach(function (el) {
      var r = el.getBoundingClientRect();
      compact.push((el.textContent || '').trim() + '=' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    var dv = document.getElementById('mobile-divider').getBoundingClientRect();
    var dividerEl = document.getElementById('mobile-divider');
    var dragArea = getComputedStyle(dividerEl, '::before');
    var portrait = document.body.classList.contains('mobile-portrait');
    var visualThickness = portrait ? dv.height : dv.width;
    var beforeInset = parseFloat(portrait ? dragArea.top : dragArea.left);
    var afterInset = parseFloat(portrait ? dragArea.bottom : dragArea.right);
    assert(visualThickness <= 8 && visualThickness - beforeInset - afterInset >= 44,
      { visualThickness: visualThickness, dragInsets: [beforeInset, afterInset] });
    var edgeX = portrait ? dv.left + dv.width / 2 : dv.left - 12;
    var edgeY = portrait ? dv.top - 12 : dv.top + dv.height / 2;
    assert(document.elementFromPoint(edgeX, edgeY) === dividerEl,
      'divider invisible drag area cannot receive input');
    ['3d', '2d'].forEach(function (part) {
      var pane = document.getElementById('mobile-pane-' + part).getBoundingClientRect();
      var slot = document.getElementById(part === '3d' ? 'mobile-glass-slot' : 'mobile-sheet-slot').getBoundingClientRect();
      assert(Math.abs(pane.height - slot.height) <= 1, 'pane toolbar consumed canvas height');
    });
    return { sheetDeltaH: openH, compactPaneBar: compact, dividerPx: [Math.round(dv.width), Math.round(dv.height)] };
  });

  // ---- touch gestures (plan D) ----
  await test('mobile 2D touch: pan, pinch, tap inspect', async function () {
    needSplit('2D touch');
    await reset();
    var pts = setupPoints([{ x: 0, y: 20, caption: 'a' }]);
    window.educadSetSheetMode('view');
    var slot = document.getElementById('mobile-sheet-slot');
    var box = slot.getBoundingClientRect();
    var c = { x: box.width / 2, y: box.height / 2 };
    var tx0 = h.view.tx, ty0 = h.view.ty;
    var d0 = slotClient(slot, c.x, c.y), d1 = slotClient(slot, c.x + 40, c.y + 30);
    pointerOn(slot, 'pointerdown', d0, { pointerType: 'touch', isPrimary: true, pointerId: 21 });
    pointerOn(slot, 'pointermove', d1, { pointerType: 'touch', isPrimary: true, pointerId: 21 });
    pointerOn(slot, 'pointerup', d1, { pointerType: 'touch', isPrimary: true, pointerId: 21 });
    assert(h.view.tx !== tx0 || h.view.ty !== ty0, { tx: [tx0, h.view.tx], ty: [ty0, h.view.ty] });
    var s0 = h.view.s;
    var p1 = slotClient(slot, c.x - 30, c.y), p2 = slotClient(slot, c.x + 30, c.y);
    var q1 = slotClient(slot, c.x - 60, c.y), q2 = slotClient(slot, c.x + 60, c.y);
    pointerOn(slot, 'pointerdown', p1, { pointerType: 'touch', isPrimary: true, pointerId: 22 });
    pointerOn(slot, 'pointerdown', p2, { pointerType: 'touch', isPrimary: false, pointerId: 23 });
    pointerOn(slot, 'pointermove', q1, { pointerType: 'touch', isPrimary: true, pointerId: 22 });
    pointerOn(slot, 'pointermove', q2, { pointerType: 'touch', isPrimary: false, pointerId: 23 });
    pointerOn(slot, 'pointerup', q1, { pointerType: 'touch', isPrimary: true, pointerId: 22 });
    pointerOn(slot, 'pointerup', q2, { pointerType: 'touch', isPrimary: false, pointerId: 23 });
    assert(h.view.s !== s0, { s: [s0, h.view.s] });
    // After checking pan and pinch, explicitly frame the fixture for
    // picking. A successful pan can intentionally take it off-screen.
    document.querySelector('#mobile-pane-2d .mobile-btn').click();
    var px = EduCADViewport.forward(h.view, pts[0]);
    assert(px.x >= 0 && px.x <= box.width && px.y >= 0 && px.y <= box.height, { tap: px, slot: [box.width, box.height] });
    slotTap(slot, px.x, px.y, 24);
    assert(h.measure.inspectId === pts[0].id, { inspectId: h.measure.inspectId, want: pts[0].id });
    return { inspectId: h.measure.inspectId };
  });

  await test('mobile 2D touch: close pair opens the chooser', async function () {
    needSplit('chooser');
    await reset();
    setupPoints([{ x: 0, y: 20, caption: 'a' }, { x: 1, y: 20, caption: 'b' }]);
    window.educadSetSheetMode('view');
    var slot = document.getElementById('mobile-sheet-slot');
    var mid = EduCADViewport.forward(h.view, { x: 0.5, y: 20 });
    slotTap(slot, mid.x, mid.y, 25);
    await frame();
    var chooser = document.getElementById('mobile-chooser');
    assert(!chooser.hidden, 'chooser did not open for a close pair');
    var options = chooser.querySelectorAll('.mobile-chooser-btn:not(.mobile-chooser-close)');
    assert(options.length >= 2, { options: options.length });
    options[0].click();
    await frame();
    assert(chooser.hidden, 'chooser stuck open');
    assert(h.measure.inspectId !== null, 'choice inspected nothing');
    return { inspectId: h.measure.inspectId, options: options.length };
  });

  await test('mobile 3D touch: orbit, two-finger pan/pinch, tap picks', async function () {
    needSplit('3D touch');
    await reset();
    loadDemo3view();
    window.educadSetSheetMode('view');
    assert(h.solid && h.solid.state && h.solidMm, 'solid missing');
    var glass = document.getElementById('mobile-glass-slot');
    var fit = null;
    document.querySelectorAll('#mobile-pane-3d .mobile-pane-bar button').forEach(function (b) {
      if (b.getAttribute('aria-label') === 'Fit 3D view') fit = b;
    });
    assert(fit, '3D fit hook missing');
    fit.click();
    await frame();
    var cam = h.solid.state, box = glass.getBoundingClientRect();
    var c = { x: box.width / 2, y: box.height / 2 };
    var yaw0 = cam.yaw, pitch0 = cam.pitch;
    var d0 = slotClient(glass, c.x, c.y), d1 = slotClient(glass, c.x + 50, c.y + 20);
    pointerOn(glass, 'pointerdown', d0, { pointerType: 'touch', isPrimary: true, pointerId: 31 });
    pointerOn(glass, 'pointermove', d1, { pointerType: 'touch', isPrimary: true, pointerId: 31 });
    pointerOn(glass, 'pointerup', d1, { pointerType: 'touch', isPrimary: true, pointerId: 31 });
    assert(cam.yaw !== yaw0 || cam.pitch !== pitch0, { yaw: [yaw0, cam.yaw], pitch: [pitch0, cam.pitch] });
    var cx0 = cam.cx, cy0 = cam.cy, sc0 = cam.scale;
    var p1 = slotClient(glass, c.x - 30, c.y), p2 = slotClient(glass, c.x + 30, c.y);
    var q1 = slotClient(glass, c.x - 60, c.y + 10), q2 = slotClient(glass, c.x + 60, c.y + 10);
    pointerOn(glass, 'pointerdown', p1, { pointerType: 'touch', isPrimary: true, pointerId: 32 });
    pointerOn(glass, 'pointerdown', p2, { pointerType: 'touch', isPrimary: false, pointerId: 33 });
    pointerOn(glass, 'pointermove', q1, { pointerType: 'touch', isPrimary: true, pointerId: 32 });
    pointerOn(glass, 'pointermove', q2, { pointerType: 'touch', isPrimary: false, pointerId: 33 });
    pointerOn(glass, 'pointerup', q1, { pointerType: 'touch', isPrimary: true, pointerId: 32 });
    pointerOn(glass, 'pointerup', q2, { pointerType: 'touch', isPrimary: false, pointerId: 33 });
    assert(cam.cx !== cx0 || cam.cy !== cy0 || cam.scale !== sc0,
      { pan: [[cx0, cam.cx], [cy0, cam.cy]], zoom: [sc0, cam.scale] });
    var v = h.solidMm.vertices[0];
    var gp = EduCADSpatial.projectMm(v, h.solid.state, EduCADSolid);
    assert(gp.x >= 0 && gp.x <= box.width && gp.y >= 0 && gp.y <= box.height, { vertexPx: gp });
    slotTap(glass, gp.x, gp.y, 34);
    await frame();
    var sel = document.querySelector('#mobile-spatial-slot .spatial-selection');
    assert(sel && !sel.hidden, 'tap on a vertex showed no 3D pick');
    slotTap(glass, -50, -50, 35);
    await frame();
    assert(sel.hidden, 'tap on empty space did not clear the 3D pick');
    return { orbited: true };
  });

  await test('mobile gestures: pane ownership, cancel recovery, drag never taps', async function () {
    needSplit('gesture ownership');
    await reset();
    var pts = setupPoints([{ x: 0, y: 20, caption: 'a' }]);
    window.educadSetSheetMode('view');
    var sheet = document.getElementById('mobile-sheet-slot');
    var glass = document.getElementById('mobile-glass-slot');
    var sb = sheet.getBoundingClientRect(), gb = glass.getBoundingClientRect();
    var tx0 = h.view.tx, ty0 = h.view.ty;
    var g0 = slotClient(glass, gb.width / 2, gb.height / 2);
    var cross = slotClient(sheet, sb.width / 2, sb.height / 2);
    pointerOn(glass, 'pointerdown', g0, { pointerType: 'touch', isPrimary: true, pointerId: 41 });
    pointerOn(glass, 'pointermove', cross, { pointerType: 'touch', isPrimary: true, pointerId: 41 });
    pointerOn(glass, 'pointerup', cross, { pointerType: 'touch', isPrimary: true, pointerId: 41 });
    assert(h.view.tx === tx0 && h.view.ty === ty0, '3D gesture leaked into the 2D pane');
    var cam0 = JSON.stringify(camState());
    var s0 = slotClient(sheet, sb.width / 2, sb.height / 2);
    pointerOn(sheet, 'pointerdown', s0, { pointerType: 'touch', isPrimary: true, pointerId: 42 });
    pointerOn(sheet, 'pointermove', g0, { pointerType: 'touch', isPrimary: true, pointerId: 42 });
    pointerOn(sheet, 'pointerup', g0, { pointerType: 'touch', isPrimary: true, pointerId: 42 });
    assert(JSON.stringify(camState()) === cam0, '2D gesture leaked into the 3D pane');
    pointerOn(sheet, 'pointerdown', s0, { pointerType: 'touch', isPrimary: true, pointerId: 43 });
    pointerOn(sheet, 'pointermove', slotClient(sheet, sb.width / 2 + 30, sb.height / 2), { pointerType: 'touch', isPrimary: true, pointerId: 43 });
    sheet.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 43, pointerType: 'touch' }));
    var txx = h.view.tx;
    pointerOn(sheet, 'pointerdown', s0, { pointerType: 'touch', isPrimary: true, pointerId: 44 });
    pointerOn(sheet, 'pointermove', slotClient(sheet, sb.width / 2 + 30, sb.height / 2), { pointerType: 'touch', isPrimary: true, pointerId: 44 });
    pointerOn(sheet, 'pointerup', slotClient(sheet, sb.width / 2 + 30, sb.height / 2), { pointerType: 'touch', isPrimary: true, pointerId: 44 });
    assert(h.view.tx !== txx, 'cancel stuck the pane');
    EduCADMeasure.clearInspect(h.measure);
    var px = EduCADViewport.forward(h.view, pts[0]);
    var from = slotClient(sheet, px.x - 60, px.y - 60), onto = slotClient(sheet, px.x, px.y);
    pointerOn(sheet, 'pointerdown', from, { pointerType: 'touch', isPrimary: true, pointerId: 45 });
    pointerOn(sheet, 'pointermove', onto, { pointerType: 'touch', isPrimary: true, pointerId: 45 });
    pointerOn(sheet, 'pointerup', onto, { pointerType: 'touch', isPrimary: true, pointerId: 45 });
    assert(h.measure.inspectId === null, 'drag inspected on release');
    h.mount.layer2.dispatchEvent(new MouseEvent('click',
      { bubbles: true, button: 0, clientX: onto.x, clientY: onto.y }));
    assert(h.measure.inspectId === null, 'trailing click inspected after a drag');
    return { ownership: true };
  });

  // ---- pose dock (plan E) ----
  function segButton(groupLabel, label) {
    var dock = document.getElementById('mobile-pose');
    var group = null;
    dock.querySelectorAll('[role="group"]').forEach(function (g) {
      if (g.getAttribute('aria-label') === groupLabel) group = g;
    });
    assert(group, { group: groupLabel });
    var b = byText(group, '.mobile-seg-btn', label);
    assert(b, { button: label });
    return b;
  }
  await test('mobile pose dock: 44px controls, op and axis switching', async function () {
    needSplit('pose dock');
    await reset();
    loadDemo3view();
    await frame();
    window.educadSetSheetMode('pose');
    var dock = document.getElementById('mobile-pose');
    assert(!dock.hidden, 'pose dock hidden with a model loaded');
    var small = [];
    dock.querySelectorAll('.mobile-seg-btn, #mobile-pose-slider, #mobile-pose-number, .mobile-snap, .mobile-btn, .mobile-advanced summary').forEach(function (el) {
      if (el.offsetParent === null) return;
      var r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) small.push((el.id || el.textContent || '').trim().slice(0, 24));
    });
    assert(!small.length, { small: small });
    segButton('Pose operation', 'Rotate').click();
    segButton('Pose axis', 'Z').click();
    var unit = document.getElementById('mobile-pose-unit').textContent;
    assert(unit === '°', { unit: unit });
    assert(document.getElementById('mobile-pose-slider').max === '180', 'rotate range missing');
    segButton('Pose operation', 'Move').click();
    segButton('Pose axis', 'X').click();
    assert(document.getElementById('mobile-pose-unit').textContent === 'mm', 'move unit missing');
    exitToIdle();
    return { dock44: true };
  });

  await test('mobile pose: sliders transform, snap grids, clamp holds, reset restores', async function () {
    needSplit('pose sliders');
    await reset();
    loadDemo3view();
    await frame();
    var before = JSON.stringify(h.table.list());
    var c0 = counts();
    window.educadSetSheetMode('pose');
    var rest = window.educadPoseViews();
    assert(rest, 'pose probe dead');
    var dock = document.getElementById('mobile-pose');
    assert(!dock.hidden, 'pose dock hidden');
    var slider = document.getElementById('mobile-pose-slider');
    var number = document.getElementById('mobile-pose-number');
    var snap = document.getElementById('mobile-pose-snap');
    segButton('Pose operation', 'Move').click();
    segButton('Pose axis', 'X').click();
    slider.value = '20';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    var moved = window.educadPoseViews();
    var shifted = moved.points.some(function (p) { return Math.abs(p.px - p.x) > 1e-6 || Math.abs(p.py - p.y) > 1e-6; });
    assert(shifted, 'X slider moved nothing');
    assert(before === JSON.stringify(h.table.list()), 'slider mutated the table');
    number.value = '21';
    number.dispatchEvent(new Event('change', { bubbles: true }));
    await frame();
    assert(slider.value === '21', { slider: slider.value });
    snap.checked = true;
    slider.value = '23';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    assert(slider.value === '25', { snapped: slider.value });
    snap.checked = false;
    segButton('Pose operation', 'Rotate').click();
    segButton('Pose axis', 'Z').click();
    slider.value = '30';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    var turned = JSON.stringify({ e: window.educadPoseViews().elev, p: window.educadPoseViews().plan });
    assert(turned !== JSON.stringify({ e: rest.elev, p: rest.plan }), 'rotate slider moved nothing');
    segButton('Pose operation', 'Move').click();
    segButton('Pose axis', 'Y').click();
    slider.value = '-120';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    var walled = window.educadPoseViews();
    assert(walled.limited === true, { limited: walled.limited });
    assert(walled.clearanceMm >= -1e-6, { clearance: walled.clearanceMm });
    assert(before === JSON.stringify(h.table.list()), 'clamped slider mutated the table');
    var options = openMenu();
    var adv = options.querySelector('.mobile-advanced summary');
    // Give both projections room before testing growth about the center.
    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    segButton('Pose axis', 'Z').click();
    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    adv.click();
    var scaleSlider = options.querySelector('[aria-label="Pose scale"]');
    scaleSlider.value = '1.2';
    scaleSlider.dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    assert(scaleSlider.value === '1.2', { scale: scaleSlider.value });
    var resetBtn = byText(options, '.mobile-btn', 'Reset pose');
    assert(resetBtn, 'reset hook missing');
    resetBtn.click();
    await frame();
    var idle = window.educadPoseViews();
    assert(Math.abs(idle.elev.angle) < 1e-9 && Math.abs(idle.elev.tx) < 1e-9 &&
      Math.abs(idle.plan.angle) < 1e-9, { elev: idle.elev, plan: idle.plan });
    key('Escape');
    exitToIdle();
    assert(before === JSON.stringify(h.table.list()), 'pose exit changed the table');
    var c1 = counts();
    assert(c0.undo === c1.undo && c0.redo === c1.redo, { before: c0, after: c1 });
    assert(window.educadPoseViews() === null, 'pose probe live after exit');
    return { sliders: true, snapped: true, clamped: true };
  });

  await test('mobile pose: gestures orbit the camera, never the model', async function () {
    needSplit('pose gestures');
    await reset();
    loadDemo3view();
    window.educadSetSheetMode('pose');
    var pv0 = JSON.stringify({ e: window.educadPoseViews().elev, p: window.educadPoseViews().plan });
    var cam = h.solid.state, yaw0 = cam.yaw, pitch0 = cam.pitch;
    var glass = document.getElementById('mobile-glass-slot');
    var sheet = document.getElementById('mobile-sheet-slot');
    var gb = glass.getBoundingClientRect();
    var g0 = slotClient(glass, gb.width / 2, gb.height / 2);
    var g1 = slotClient(glass, gb.width / 2 + 60, gb.height / 2 + 25);
    pointerOn(glass, 'pointerdown', g0, { pointerType: 'touch', isPrimary: true, pointerId: 51 });
    pointerOn(glass, 'pointermove', g1, { pointerType: 'touch', isPrimary: true, pointerId: 51 });
    pointerOn(glass, 'pointerup', g1, { pointerType: 'touch', isPrimary: true, pointerId: 51 });
    assert(cam.yaw !== yaw0 || cam.pitch !== pitch0, 'gesture orbited nothing');
    var pv1 = JSON.stringify({ e: window.educadPoseViews().elev, p: window.educadPoseViews().plan });
    assert(pv0 === pv1, 'gesture transformed the model');
    slotTap(glass, gb.width / 2, gb.height / 2, 52);
    var sb = sheet.getBoundingClientRect();
    slotTap(sheet, sb.width / 2, sb.height / 2, 53);
    assert(h.measure.inspectId === null, 'pose tap inspected the sheet');
    var pv2 = JSON.stringify({ e: window.educadPoseViews().elev, p: window.educadPoseViews().plan });
    assert(pv0 === pv2, 'tap transformed the model');
    exitToIdle();
    return { orbited: true };
  });

  // ---- robustness (plan F) ----
  await test('mobile pose: options preserve canvas space and Fit frames both views', async function () {
    needSplit('dynamic pose layout');
    await reset();
    loadDemo3view();
    window.educadSetSheetMode('pose');
    var advanced = document.querySelector('#mobile-pose-options .mobile-advanced');
    advanced.open = false;
    await frame(); await frame(); await frame();
    var before = JSON.stringify(h.table.list());
    var pose = JSON.stringify(window.educadPoseViews());
    var canvasH = document.getElementById('mobile-sheet-slot').getBoundingClientRect().height;
    var optionsMenu = openMenu();
    advanced.open = true;
    await frame(); await frame(); await frame();
    document.querySelectorAll('#mobile-pose-options input, #mobile-pose-options summary, #mobile-pose-options .mobile-btn').forEach(function (control) {
      var box = control.getBoundingClientRect(), menuBox = optionsMenu.getBoundingClientRect();
      if (control.id === 'mobile-pose-snap') return; // Its label supplies the tap area.
      assert(box.height >= 44 && box.left >= menuBox.left && box.right <= menuBox.right,
        { poseOption: control.getAttribute('aria-label') || control.textContent, width: box.width, height: box.height });
    });
    assert(document.getElementById('mobile-sheet-slot').getBoundingClientRect().height === canvasH,
      'Pose options consumed canvas layout space');
    key('Escape');
    var detailsBody = document.getElementById('mobile-sheet-body');
    var detailsHandle = document.getElementById('mobile-sheet-handle');
    var spacer = document.createElement('p');
    spacer.style.height = '300px';
    spacer.textContent = 'Inspection details with long content';
    detailsBody.appendChild(spacer);
    if (detailsBody.hidden) detailsHandle.click();
    await frame(); await frame(); await frame();
    assert(document.getElementById('mobile-sheet-slot').getBoundingClientRect().height >= 30 &&
      document.getElementById('mobile-glass-slot').getBoundingClientRect().height >= 30,
      'opening both docks collapsed the canvases');
    spacer.remove();
    detailsHandle.click();
    await frame(); await frame(); await frame();
    var sheet = document.getElementById('mobile-sheet-slot').getBoundingClientRect();
    var glass = document.getElementById('mobile-glass-slot').getBoundingClientRect();
    assert(sheet.height > 20 && glass.height > 20, { sheetH: sheet.height, glassH: glass.height });
    assert(Math.abs(h.view.h - sheet.height) <= 1 && Math.abs(h.solid.state.h - glass.height) <= 1,
      { sheetCanvasH: h.view.h, sheetH: sheet.height, glassCanvasH: h.solid.state.h, glassH: glass.height });
    document.querySelector('[aria-label="Fit sheet to pane"]').click();
    document.querySelector('[aria-label="Fit 3D view"]').click();
    var overlay = window.educadPoseViews().overlay;
    ['front', 'top', 'side'].forEach(function (view) {
      overlay[view].forEach(function (line) {
        [{ x: line.ax, y: line.ay }, { x: line.bx, y: line.by }].forEach(function (point) {
          var p = EduCADViewport.forward(h.view, point);
          assert(p.x >= -1 && p.x <= sheet.width + 1 && p.y >= -1 && p.y <= sheet.height + 1,
            { projection: view, point: p, size: [sheet.width, sheet.height] });
        });
      });
    });
    var st = h.solid.state;
    EduCADSolid.project(st, st.cx, st.cy).forEach(function (p) {
      assert(p.x >= -1 && p.x <= glass.width + 1 && p.y >= -1 && p.y <= glass.height + 1,
        { vertex: p, size: [glass.width, glass.height] });
    });
    assert(JSON.stringify(h.table.list()) === before && JSON.stringify(window.educadPoseViews()) === pose,
      'opening controls or fitting changed the drawing or pose');
    advanced.open = false;
    exitToIdle();
    return { sheetH: sheet.height, glassH: glass.height, fit: true };
  });

  await test('mobile: loading another drawing exits Pose safely', async function () {
    needInspection('loading from Pose');
    await reset();
    loadDemo3view();
    window.educadSetSheetMode('pose');
    assert(window.educadPoseViews(), 'Pose did not enter');
    loadDemo3view();
    assert(h.measure.mode === 'view' && window.educadPoseViews() === null, 'demo retained old Pose');
    window.educadSetSheetMode('pose');
    window.educadReplaceSheet({ entities: [{ id: 'loaded', type: 'POINT', x: 4, y: 20, viewRole: 'ELEVATION' }] });
    assert(h.measure.mode === 'view' && window.educadPoseViews() === null && h.table.count() === 1,
      'saved drawing retained old Pose');
    return { demoAndSavedLoad: true };
  });

  await test('mobile empty model: pose refused safely, taps stay safe', async function () {
    needInspection('empty model');
    var errs0 = errors.length;
    window.educadReplaceSheet({ entities: [] });
    assert(h.table.count() === 0, 'sheet not empty');
    var modeAfter = window.educadSetSheetMode('pose');
    assert(modeAfter !== 'pose' && h.measure.mode !== 'pose', { mode: modeAfter });
    assert(document.getElementById('mobile-pose').hidden, 'pose dock shown without a model');
    var sheet = document.getElementById('mobile-sheet-slot');
    var glass = document.getElementById('mobile-glass-slot');
    [sheet, glass].forEach(function (el, i) {
      var b = el.getBoundingClientRect();
      slotTap(el, b.width / 2, b.height / 2, 60 + i);
    });
    await frame();
    assert(errors.length === errs0, { errors: errors.slice(errs0) });
    menuItem('Line Rotation').click();
    await frame();
    return { emptySafe: true };
  });

  await test('robustness: no window errors, split chrome inside viewport', async function () {
    assert(!errors.length, { errors: errors });
    var evidence = { errors: 0, viewport: disc.viewport };
    if (splitOn()) {
      ['#mobile-header', '#mobile-pane-3d', '#mobile-pane-2d', '#mobile-sheet'].forEach(function (sel) {
        var el = document.querySelector(sel);
        if (!el || el.hidden) return;
        var r = el.getBoundingClientRect();
        assert(r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
          { sel: sel, rect: [r.left, r.top, r.right, r.bottom] });
      });
      evidence.panesInside = true;
    }
    exitToIdle();
    return evidence;
  });

  window.removeEventListener('error', onError);
  window.educadMobileAuditResults = results;
  var passed = results.filter(function (r) { return r.status === 'PASS'; }).length;
  var failed = results.filter(function (r) { return r.status === 'FAIL'; }).length;
  var skipped = results.filter(function (r) { return r.status === 'SKIP'; }).length;
  return { results: results, passed: passed, failed: failed, skipped: skipped,
    errors: errors, discovery: disc };
})();

// Evaluate on a disposable guest sheet; the fixture loader writes no server data.
(async function orthographicAudit() {
  'use strict';
  var h = window.educadHandle, results = [];
  if (!h || !h.orthographicView || !EduCADSaves.isGuest(EduCADSaves.currentSession())) throw Error('Use a guest sheet.');
  var inspector = h.orthographicView, sheet = inspector.sheet;
  function assert(condition, message) { if (!condition) throw Error(message); }
  async function frame() { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }
  async function test(name, run) {
    try { await run(); results.push({ name: name, status: 'PASS' }); }
    catch (error) { results.push({ name: name, status: 'FAIL', error: error.message }); }
  }
  function click(selector) { var b = sheet.querySelector(selector); assert(b, selector + ' missing'); b.click(); }
  function select(id) { click('.sheet-record [data-sheet-action="select"][data-sheet-id="' + id + '"]'); }
  function setting(key, value) {
    var input = document.querySelector('#settings-rows [data-sheet-inspection-key="' + key + '"]');
    if (input.type === 'checkbox') input.checked = value; else input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  var fixture = [
    { id: 'front-a', type: 'POINT', caption: "a'", x: 0, y: 10, viewRole: 'ELEVATION', bisCode: 'B' },
    { id: 'front-b', type: 'POINT', caption: "b'", x: 30, y: 50, viewRole: 'ELEVATION', bisCode: 'B' },
    { id: 'front-edge', type: 'SEGMENT', x: 0, y: 10, x2: 30, y2: 50, viewRole: 'ELEVATION', bisCode: 'A', meta: { endpointRefs: ['front-a', 'front-b'] } },
    { id: 'top-a', type: 'POINT', caption: 'a', x: 0, y: -20, viewRole: 'PLAN', bisCode: 'B' },
    { id: 'top-b', type: 'POINT', caption: 'b', x: 30, y: -60, viewRole: 'PLAN', bisCode: 'B' },
    { id: 'top-edge', type: 'SEGMENT', x: 0, y: -20, x2: 30, y2: -60, viewRole: 'PLAN', bisCode: 'A' },
    { id: 'side-a', type: 'POINT', caption: "a''", x: 100, y: 10, viewRole: 'PROFILE', bisCode: 'B' },
    { id: 'side-b', type: 'POINT', caption: "b''", x: 140, y: 50, viewRole: 'PROFILE', bisCode: 'B' },
    { id: 'side-edge', type: 'SEGMENT', x: 100, y: 10, x2: 140, y2: 50, viewRole: 'PROFILE', bisCode: 'A' },
    { id: 'circle', type: 'CIRCLE', x: 60, y: 30, radius: 10, viewRole: 'ELEVATION', bisCode: 'A' },
    { id: 'arc', type: 'CIRCULAR_ARC', x: 60, y: -40, radius: 10, startAngle: 350, endAngle: 80, viewRole: 'PLAN', bisCode: 'A' },
    { id: 'datum', type: 'DATUM_AXIS', x: 80, y: 0, x2: 80, y2: 80, bisCode: 'G', viewRole: 'BOTH', meta: { kind: 'axis', draftingLayout: { three: true, xRef: 80, dRef: 0, s: 1, side: 'left' } } }
  ];
  window.educadReplaceSheet({ entities: fixture }); window.educadSetSheetMode('view'); await frame(); inspector.activate('sheet');
  if (EduCADMobile.splitActive() && document.getElementById('mobile-sheet-body').hidden) document.getElementById('mobile-sheet-handle').click();
  var tableBefore = JSON.stringify(h.table.list()), geometryBefore = JSON.stringify(h.solid.state.geometryMm), historyBefore = JSON.stringify(h.history.counts());
  await test('quiet default and one inspector across 2D and 3D', async function () {
    assert(document.querySelectorAll('.spatial-panel').length === 1, 'duplicate inspection panels');
    assert(inspector.preferences().overlay === 'selected', 'default is not selected');
    assert(!sheet.querySelector('.sheet-details').open, 'spec inventory open by default');
    assert(sheet.querySelector('.sheet-selection').hidden, 'selection visible without a pick');
    assert(!inspector.panel.hidden && !sheet.hidden, '2D inspector unavailable');
  });
  await test('all specs include Front, Top and Side without construction clutter', async function () {
    click('[data-sheet-overlay="all"]'); await frame();
    assert(sheet.querySelector('.sheet-details').open, 'inventory did not expand');
    assert(sheet.querySelectorAll('.sheet-record').length === 11, 'inventory missing geometry or including datum');
    ['ELEVATION', 'PLAN', 'PROFILE'].forEach(function (r) { assert(sheet.querySelector('[data-sheet-group="' + r + '"]'), r + ' group missing'); });
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'horizontal page overflow');
    assert(document.documentElement.scrollHeight <= innerHeight + 1, 'vertical page overflow');
  });
  await test('source selection has projected specs and identifies endpoints', async function () {
    select('front-edge');
    assert(h.measure.inspectId === 'front-edge', 'row did not select source geometry');
    assert(sheet.querySelector('.sheet-selection').textContent.includes('Projected length50 mm'), 'projected length missing');
    assert(sheet.querySelector('.sheet-selection').textContent.includes("Segment a'–b'"), 'endpoint names missing');
    assert(sheet.querySelector('[data-sheet-id="front-edge"][aria-pressed="true"]'), 'active row not marked');
  });
  await test('multiple pins compare same-view points and survive Escape', async function () {
    select('front-a'); click('.sheet-selection [data-sheet-action="pin"]');
    select('front-b'); click('.sheet-selection [data-sheet-action="pin"]');
    assert(inspector.pins().length === 2, 'pins replaced each other');
    assert(sheet.querySelector('.sheet-comparison').textContent.includes('Projected distance50 mm'), 'point comparison incorrect');
    if (document.activeElement) document.activeElement.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await frame();
    assert(h.measure.inspectId === null && inspector.pins().length === 2, 'Escape removed pins');
    assert(sheet.querySelector('.sheet-selection').hidden, 'Escape left selection details visible');
    var copy = inspector.pins(); copy[0].side = 999; assert(inspector.pins()[0].side !== 999, 'pins expose mutable state');
  });
  await test('cross-view comparisons explain the mismatch instead of inventing a distance', async function () {
    click('[data-sheet-action="clear-pins"]');
    select('front-a'); click('.sheet-selection [data-sheet-action="pin"]'); select('top-a'); click('.sheet-selection [data-sheet-action="pin"]');
    assert(sheet.querySelector('.sheet-comparison').textContent.includes('same orthographic view'), 'cross-view comparison not guarded');
    assert(sheet.querySelector('.sheet-comparison tbody').rows.length === 0, 'cross-view comparison has numerical rows');
    click('[data-sheet-action="clear-pins"]');
  });
  await test('circles and wrapped arcs expose complete curve specs', async function () {
    select('circle'); var text = sheet.querySelector('.sheet-selection').textContent;
    assert(text.includes('Circumference62.83 mm') && text.includes('Circle area314.16 mm²'), 'circle properties incorrect');
    select('arc'); text = sheet.querySelector('.sheet-selection').textContent;
    assert(text.includes('Sweep90°') && text.includes('Arc length15.71 mm') && text.includes('Chord length14.14 mm'), 'arc properties incorrect');
    assert(!text.includes('Circle area'), 'arc claims a circle area');
    select('side-a'); assert(sheet.querySelector('.sheet-selection').textContent.includes('Depth from VP20 mm'), 'side depth uses sheet X instead of reference');
  });
  await test('view and measurement filters synchronize with Settings', async function () {
    var selectView = sheet.querySelector('.sheet-view-filter'); selectView.value = 'plan'; selectView.dispatchEvent(new Event('change', { bubbles: true }));
    assert(sheet.querySelectorAll('.sheet-record').length === 4, 'view filter includes other views');
    assert(document.querySelector('#settings-rows [data-sheet-inspection-key="view"]').value === 'plan', 'view filter not reflected in Settings');
    setting('view', 'all'); setting('coordinates', false); setting('angles', false);
    select('front-edge'); var text = sheet.querySelector('.sheet-selection').textContent;
    assert(!text.includes('Start') && !text.includes('Orientation'), 'spec categories not filtered');
    assert(text.includes('Projected length50 mm'), 'length lost with unrelated filters');
    setting('coordinates', true); setting('angles', true);
  });
  await test('search and expanded specs retain source identity', async function () {
    var input = sheet.querySelector('.sheet-search'); input.value = "a'-b'"; input.dispatchEvent(new Event('input', { bubbles: true }));
    assert(sheet.querySelectorAll('.sheet-record').length === 1, 'endpoint search did not isolate the edge');
    var expanded = sheet.querySelector('.sheet-full-specs'); expanded.open = true; assert(expanded.textContent.includes('Projected length50 mm'), 'full specs absent');
    input.value = 'missing'; input.dispatchEvent(new Event('input', { bubbles: true })); assert(!sheet.querySelector('.sheet-record'), 'empty search not empty');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    click('[data-sheet-action="expand-specs"]');
    assert(Array.from(sheet.querySelectorAll('.sheet-full-specs')).every(function (spec) { return spec.open; }), 'Expand specs did not open every record');
    click('[data-sheet-action="expand-specs"]');
  });
  await test('overview labels avoid all projections and each other', async function () {
    var ctx = document.createElement('canvas').getContext('2d'), boxes = [];
    var proxy = new Proxy(ctx, { get: function (target, key) {
      if (key === 'fillRect') return function (x, y, w, height) { boxes.push({ x0: x, y0: y, x1: x + w, y1: y + height }); };
      var value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
    }, set: function (target, key, value) { target[key] = value; return true; } });
    inspector.drawOverlay(proxy, h.view);
    var bounds = EduCADOrthographic.viewBounds(h.table.visibleEntities(), h.view);
    function overlaps(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
    boxes.forEach(function (box, i) {
      Object.keys(bounds).forEach(function (r) { assert(!overlaps(box, bounds[r]), 'label covers ' + r); });
      boxes.slice(i + 1).forEach(function (other) { assert(!overlaps(box, other), 'measurement labels overlap'); });
    });
  });
  await test('2D inspection works with the 3D preview hidden and fits the available space', async function () {
    window.educadSetSetting('solidPreview', false); await frame(); assert(!inspector.panel.hidden && !sheet.hidden, 'hiding 3D hid 2D inspection');
    inspector.panel.querySelector('[data-sheet-action="fit"]').click(); await frame();
    if (!EduCADMobile.splitActive()) {
      var box = inspector.panel.getBoundingClientRect(), bounds = EduCADOrthographic.viewBounds(h.table.visibleEntities(), h.view);
      assert(bounds.ELEVATION.x0 >= box.right, 'Fit placed sheet behind the inspector');
    }
    window.educadSetSetting('solidPreview', true);
  });
  await test('preferences are independent, saved and reset without editing ink', async function () {
    var solidPrefs = JSON.stringify(h.spatialView.preferences()); setting('precision', 3); setting('textSize', 15); setting('links', false); setting('dimensions', false);
    var saved = JSON.parse(localStorage.getItem(EduCADSettings.STORAGE_KEY)).sheetInspection;
    assert(saved.precision === 3 && saved.textSize === 15 && !saved.links, 'typed sheet preferences not saved');
    assert(JSON.stringify(h.spatialView.preferences()) === solidPrefs, 'sheet preferences changed 3D preferences');
    assert(!inspector.linksEnabled(), 'linked highlights ignore preference');
    window.educadRunCommand('/point shouldNotDraw 1 2');
    assert(JSON.stringify(h.table.list()) === tableBefore, 'inspection changed drawing');
    assert(JSON.stringify(h.solid.state.geometryMm) === geometryBefore, 'inspection changed 3D geometry');
    assert(JSON.stringify(h.history.counts()) === historyBefore, 'inspection changed history');
    document.getElementById('settings-reset').click();
    assert(inspector.preferences().overlay === 'selected' && inspector.preferences().textSize === 11, 'reset did not restore defaults');
    setting('overlay', 'all'); setting('precision', 3);
  });
  await test('pins survive mode switches and clear when the source drawing changes', async function () {
    select('front-a'); click('.sheet-selection [data-sheet-action="pin"]');
    if (!document.body.classList.contains('mobile-inspect')) {
      window.educadSetSheetMode('edit'); await frame(); assert(inspector.panel.hidden, 'inspector remains in Edit');
      window.educadSetSheetMode('view'); await frame(); assert(inspector.pins().length === 1, 'unchanged source lost pin');
    }
    if (!document.body.classList.contains('mobile-inspect')) window.educadSetSheetMode('edit');
    window.educadRunCommand('/demo prism'); await frame(); window.educadSetSheetMode('view'); await frame();
    assert(!inspector.pins().length, 'changed source retained pins');
    var st = h.solid.state, point = EduCADSpatial.projectMm(st.geometryMm.vertices[0], st, EduCADSolid);
    assert(h.spatialView.inspectAt(point.x, point.y), '3D pick failed');
    assert(sheet.hidden && !inspector.panel.querySelector('.inspection-solid-body').hidden, '3D pick did not switch workspace');
    inspector.activate('sheet'); assert(!sheet.hidden, 'cannot return to 2D inspector');
  });
  return { passed: results.filter(function (r) { return r.status === 'PASS'; }).length,
    failed: results.filter(function (r) { return r.status === 'FAIL'; }).length, results: results };
})()

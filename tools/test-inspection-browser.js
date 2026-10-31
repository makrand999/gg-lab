// Evaluate on a disposable guest sheet; exercises real controls without server writes.
(async function inspectionAudit() {
  'use strict';
  var h = window.educadHandle, results = [];
  if (!h || !h.spatialView || !EduCADSaves.isGuest(EduCADSaves.currentSession())) throw Error('Use a guest sheet.');
  var view = h.spatialView, panel = view.panel;
  function assert(condition, message) { if (!condition) throw Error(message); }
  async function frame() { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); }
  async function test(name, run) {
    try { await run(); results.push({ name: name, status: 'PASS' }); }
    catch (error) { results.push({ name: name, status: 'FAIL', error: error.message }); }
  }
  function click(selector) {
    var element = panel.querySelector(selector); assert(element, selector + ' missing'); element.click();
  }
  function choose(kind, index) { click('.spatial-data [data-kind="' + kind + '"][data-index="' + index + '"]'); }
  function filter(key, checked) {
    var box = panel.querySelector('[data-inspection-key="' + key + '"]');
    box.checked = checked; box.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function setting(key, value) {
    var input = document.querySelector('#settings-rows [data-inspection-key="' + key + '"]');
    if (input.type === 'checkbox') input.checked = value; else input.value = String(value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  window.educadRunCommand('/demo prism');
  window.educadSetSheetMode('view');
  await frame();
  var tableBefore = JSON.stringify(h.table.list()), geometryBefore = JSON.stringify(h.solid.state.geometryMm);
  var historyBefore = JSON.stringify(h.history.counts());
  var split = EduCADMobile.splitActive();
  if (split) document.getElementById('mobile-sheet-handle').click();

  await test('default inspection is quiet and retains the original layout', async function () {
    assert(view.preferences().overlay === 'selected', 'default scope is not selected');
    assert(!panel.querySelector('.spatial-details').open, 'details expanded by default');
    assert(panel.querySelector('.spatial-selection').hidden, 'selection visible without a pick');
    if (!split) {
      var box = panel.getBoundingClientRect(), origin = panel.parentElement.getBoundingClientRect();
      assert(Math.abs(box.left - origin.left - 12) < 2, 'panel moved horizontally');
      var refs = EduCADSpatial.references(h.solid.state.geometryMm);
      var scene = refs.hp.concat(refs.vp).map(function (p) { return EduCADSpatial.projectMm(p, h.solid.state, EduCADSolid); });
      assert(box.right < Math.min.apply(null, scene.map(function (p) { return p.x; })) + origin.left, 'panel overlaps model');
    }
    assert(document.documentElement.scrollWidth <= innerWidth + 1, 'page overflows horizontally');
  });
  await test('model picking and the details table share selection', async function () {
    var point = EduCADSpatial.projectMm(h.solid.state.geometryMm.vertices[0], h.solid.state, EduCADSolid);
    assert(view.inspectAt(point.x, point.y), 'vertex not picked');
    var selected = view.selection();
    assert(selected.kind === 'point', 'vertex selected an edge');
    assert(panel.querySelector('.spatial-data [data-kind="point"][data-index="' + selected.index + '"]').getAttribute('aria-pressed') === 'true', 'table not highlighted');
    choose('edge', 0);
    assert(view.selection().kind === 'edge', 'edge row not selected');
    assert(panel.querySelector('.spatial-selection').textContent.includes('True length'), 'edge measurements absent');
  });
  await test('multiple pins survive selection clearing and orbit', async function () {
    choose('point', 0); click('[data-action="pin"]');
    choose('edge', 0); click('[data-action="pin"]');
    assert(view.pins().length === 2, 'pins replaced each other');
    assert(view.preferences().overlay === 'pinned', 'pin scope not activated');
    view.clear(); h.solid.orbitBy(15, 7); await frame();
    assert(view.selection() === null, 'selection not cleared');
    assert(view.pins().length === 2, 'orbit or clear removed pins');
    assert(panel.querySelectorAll('.spatial-pin-row').length === 2, 'pinned list missing');
    var copy = view.pins(); copy[0].index = 999;
    assert(view.pins()[0].index === 0, 'pins expose mutable state');
  });
  await test('all scope exposes every point and edge with category filters', async function () {
    click('[data-overlay="all"]'); await frame();
    assert(panel.querySelector('.spatial-details').open, 'all values not expanded');
    var g = h.solid.state.geometryMm;
    assert(panel.querySelectorAll('.spatial-data [data-kind="point"]').length === g.vertices.length, 'points missing');
    assert(panel.querySelectorAll('.spatial-data [data-kind="edge"]').length === g.edges.length, 'edges missing');
    panel.querySelector('.spatial-filter').open = true;
    filter('coordinates', false); filter('planeDistances', false); filter('inclinations', false);
    var fields = panel.querySelector('[data-group="edge"] thead').textContent;
    assert(fields.includes('L (mm)') && !fields.includes('HP'), 'edge filter ignored');
    choose('edge', 0);
    assert(panel.querySelector('.spatial-selection tbody').rows.length === 1, 'selection filter ignored');
    assert(document.querySelector('#settings-rows [data-inspection-key="coordinates"]').checked === false, 'quick filter did not update Settings');
    filter('coordinates', true); filter('planeDistances', true); filter('inclinations', true);
  });
  await test('search finds points and edges without changing the model', async function () {
    var input = panel.querySelector('.spatial-search');
    input.value = 'P1-P2'; input.dispatchEvent(new Event('input', { bubbles: true }));
    assert(panel.querySelectorAll('.spatial-data [data-kind="point"]').length === 0, 'search did not filter points');
    assert(panel.querySelectorAll('.spatial-data [data-kind="edge"]').length > 0, 'hyphenated edge not found');
    input.value = 'missing'; input.dispatchEvent(new Event('input', { bubbles: true }));
    assert(panel.querySelectorAll('.spatial-data [data-kind]').length === 0, 'empty search not empty');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await test('Settings update the canvas controls and persist typed preferences', async function () {
    setting('planes', false); setting('guides', false); setting('precision', 3); setting('textSize', 15);
    assert(panel.querySelector('[data-action="planes"]').getAttribute('aria-pressed') === 'false', 'planes not synced');
    assert(view.preferences().precision === 3 && view.preferences().textSize === 15, 'typed values ignored');
    var saved = JSON.parse(localStorage.getItem(EduCADSettings.STORAGE_KEY)).inspection;
    assert(saved.overlay === 'all' && saved.precision === 3 && !saved.planes, 'preferences not saved');
    setting('planes', true); setting('guides', true); setting('textSize', 11);
  });
  await test('measurement labels never cover the model or each other', async function () {
    h.spatialView.fit(); await frame();
    var st = h.solid.state, prefs = view.preferences();
    var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'); ctx.font = prefs.textSize + 'px system-ui, sans-serif';
    var layout = EduCADSpatial.overlayLayout(st, EduCADSolid, EduCADSpatial.references(st.geometryMm), view.selection(), view.pins(), prefs,
      function (text) { return ctx.measureText(text).width; }, []);
    var pts = st.geometryMm.vertices.map(function (p) { return EduCADSpatial.projectMm(p, st, EduCADSolid); });
    var bounds = { x0: Math.min.apply(null, pts.map(function (p) { return p.x; })), x1: Math.max.apply(null, pts.map(function (p) { return p.x; })),
      y0: Math.min.apply(null, pts.map(function (p) { return p.y; })), y1: Math.max.apply(null, pts.map(function (p) { return p.y; })) };
    function overlap(a, b) { return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0; }
    layout.labels.forEach(function (label, i) {
      assert(!overlap(label.rect, bounds), 'label covers model');
      assert(label.rect.x0 >= 0 && label.rect.x1 <= st.w, 'label outside viewport');
      layout.labels.slice(i + 1).forEach(function (other) { assert(!overlap(label.rect, other.rect), 'labels overlap'); });
    });
  });
  await test('unpin and clear pins remain independent of active selection', async function () {
    click('[data-remove-pin="point:0"]'); assert(view.pins().length === 1, 'unpin did not remove one item');
    choose('edge', 0); click('[data-action="clear-pins"]');
    assert(view.pins().length === 0 && view.selection().kind === 'edge', 'clear pins altered selection');
    assert(panel.querySelector('.spatial-pins').hidden, 'empty pins area visible');
  });
  await test('inspection does not change drawing, history, or geometry', async function () {
    window.educadRunCommand('/point inspectShouldNotDraw 1 2');
    assert(JSON.stringify(h.table.list()) === tableBefore, 'inspection altered drawing');
    assert(JSON.stringify(h.solid.state.geometryMm) === geometryBefore, 'inspection altered 3D geometry');
    assert(JSON.stringify(h.history.counts()) === historyBefore, 'inspection added history');
  });
  await test('switching modes and loading another drawing discard stale selection and pins', async function () {
    choose('point', 0); click('[data-action="pin"]');
    if (!document.body.classList.contains('mobile-inspect')) {
      window.educadSetSheetMode('edit'); await frame(); assert(panel.hidden, 'inspection panel remains in Edit');
      window.educadSetSheetMode('view'); await frame(); assert(view.pins().length === 1, 'unchanged model lost pin');
    }
    window.educadSetSheetMode('pose'); await frame(); assert(panel.hidden, 'inspection panel remains in Pose');
    window.educadSetSheetMode('view'); await frame();
    if (!document.body.classList.contains('mobile-inspect')) window.educadSetSheetMode('edit');
    window.educadRunCommand('/demo line'); await frame(); window.educadSetSheetMode('view'); await frame();
    assert(view.pins().length === 0 && view.selection() === null, 'new model retained stale measurements');
  });
  return { passed: results.filter(function (r) { return r.status === 'PASS'; }).length,
    failed: results.filter(function (r) { return r.status === 'FAIL'; }).length, results: results };
})()

// Run this entire expression using T3 preview_evaluate, awaitPromise=true,
// on a disposable guest sheet. Exercises actual mounted app event handlers.
// It replaces the guest drawing and history. Does not call any server APIs.
// Regression and mode-transition checks; every entry must pass.
(async function drawingModeAudit() {
  'use strict';
  const h = window.educadHandle;
  if (!h || !h.drafting) throw new Error('Open the EduCAD guest sheet first.');
  if (!window.EduCADSaves.isGuest(window.EduCADSaves.currentSession())) {
    throw new Error('Use a disposable guest sheet for this audit.');
  }
  const results = [], errors = [];
  function onError(event) { errors.push(event.message); }
  window.addEventListener('error', onError);
  const frame = () => new Promise(requestAnimationFrame);
  function assert(condition, detail) { if (!condition) throw new Error(JSON.stringify(detail)); }
  async function test(name, fn) {
    try { const evidence = await fn(); results.push({ name, status: 'PASS', evidence }); }
    catch (error) { results.push({ name, status: 'FAIL', evidence: error.message }); }
  }
  async function reset() {
    document.activeElement.blur();
    window.educadSetSheetMode('edit');
    h.drafting.cancel();
    h.table.clear();
    h.drafting.preferences({ guides: true, solid: true });
    document.getElementById('cmd-bar').hidden = true;
    await frame();
  }
  function setupLine() {
    const a = h.table.create('POINT', { x: 0, y: 20, caption: 'a', viewRole: 'ELEVATION' });
    const b = h.table.create('POINT', { x: 10, y: 20, caption: 'b', viewRole: 'ELEVATION' });
    const line = h.table.create('SEGMENT', { x: a.x, y: a.y, x2: b.x, y2: b.y, viewRole: 'ELEVATION', meta: { refs: [a.id, b.id] } });
    return { a, b, line };
  }
  function applyEditor(entity, patch) {
    h.drafting.select(entity.id);
    document.querySelector('[data-action="edit-selection"]').click();
    const form = document.querySelector('.drafting-editor');
    Object.entries(patch).forEach(([key, value]) => { form.elements[key].value = String(value); });
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  }
  function tool(name) { document.querySelector('[data-tool="' + name + '"]').click(); }
  function key(value) { window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })); }
  function pointer(name, point, extra) {
    const px = EduCADViewport.forward(h.view, point);
    h.mount.layer2.dispatchEvent(new PointerEvent(name, Object.assign({ bubbles: true, button: 0, pointerId: 1, clientX: px.x, clientY: px.y }, extra)));
  }
  function sheetClick(point) {
    const px = EduCADViewport.forward(h.view, point);
    pointer('pointerdown', point); pointer('pointerup', point);
    h.mount.layer2.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, clientX: px.x, clientY: px.y, altKey: true }));
  }
  try {
    await test('Smoke: drawing a line and undo/redo is one gesture', async () => {
      await reset(); tool('line'); sheetClick({ x: -100, y: 50 }); sheetClick({ x: -70, y: 50 });
      const count = h.table.list().length;
      assert(count === 3, { count });
      h.history.undo(); assert(h.table.list().length === 0, { afterUndo: h.table.list().length });
      h.history.redo(); assert(h.table.list().length === 3, { afterRedo: h.table.list().length });
      return { drawn: count, afterUndo: 0, afterRedo: 3 };
    });
    await test('F06 valid endpoint swap is accepted', async () => {
      await reset(); const { line } = setupLine();
      applyEditor(line, { x: 10, y: 20, x2: 0, y2: 20 });
      assert(line.x === 10 && line.x2 === 0, { line: [line.x, line.x2], status: document.querySelector('.drafting-status').textContent });
    });
    await test('F06 circle can translate onto its old rim position', async () => {
      await reset();
      const a = h.table.create('POINT', { x: 0, y: 30, viewRole: 'ELEVATION' });
      const b = h.table.create('POINT', { x: 10, y: 30, viewRole: 'ELEVATION' });
      const c = h.table.create('CIRCLE', { x: 0, y: 30, radius: 10, viewRole: 'ELEVATION', meta: { centerRef: a.id, radiusRef: b.id, refs: [a.id, b.id] } });
      applyEditor(c, { x: 10, y: 30, radius: 10 });
      assert(c.x === 10 && b.x === 20, { circleX: c.x, rimX: b.x, status: document.querySelector('.drafting-status').textContent });
    });
    await test('F03 editing a command line moves its referenced endpoints', async () => {
      await reset();
      ['/point a 0 30 elevation', '/point b 30 30 elevation', '/line a b'].forEach(window.educadRunCommand);
      const line = h.table.list().find(e => e.type === 'SEGMENT');
      const a = h.table.list().find(e => e.caption === 'a');
      applyEditor(line, { x: 5, y: 35 });
      assert(a.x === 5 && a.y === 35, { line: [line.x, line.y], point: [a.x, a.y], refs: line.meta.refs });
    });
    await test('F07 disabled side view cannot be picked in View mode', async () => {
      await reset();
      h.table.create('DATUM_AXIS', { x: 100, y: 0, x2: 100, y2: 50, viewRole: 'PROFILE', meta: { kind: 'axis', draftingLayout: { three: false, side: 'left', xRef: 100, dRef: 0, s: 1 } } });
      const point = h.table.create('POINT', { x: 130, y: 20, viewRole: 'PROFILE', caption: "a''" });
      window.educadSetSheetMode('view'); sheetClick(point);
      assert(h.measure.inspectId === null, { visible: h.drafting.isVisible(point), inspectId: h.measure.inspectId });
    });
    await test('Smoke: ordinary View click preserves the table', async () => {
      await reset(); const { a } = setupLine(); window.educadSetSheetMode('view');
      const before = JSON.stringify(h.table.list()); sheetClick(a);
      assert(before === JSON.stringify(h.table.list()), 'View click mutated geometry');
      return { inspectId: h.measure.inspectId, tableUnchanged: true };
    });
    await test('F02 Settings Clear Sheet cannot mutate View mode', async () => {
      await reset(); setupLine(); window.educadSetSheetMode('view');
      const before = JSON.stringify(h.table.list());
      document.getElementById('btn-settings').click(); document.getElementById('btn-clear').click();
      assert(before === JSON.stringify(h.table.list()), { mode: h.measure.mode, remaining: h.table.list().length });
    });
    await test('F02 clearing in Pose cannot leave a stale solid', async () => {
      await reset(); window.educadRunCommand('/demo 3view'); await frame();
      window.educadSetSheetMode('pose');
      document.getElementById('btn-settings').click(); document.getElementById('btn-clear').click(); await frame();
      assert(h.table.list().length !== 0 || !h.solidMm || h.measure.mode !== 'pose', { mode: h.measure.mode, remaining: h.table.list().length, solidVertices: h.solidMm && h.solidMm.vertices.length, overlayEdges: window.educadPoseViews()?.overlay.front.length });
    });
    await test('Smoke: Pose G/Y motion and Escape preserve stored geometry', async () => {
      await reset(); window.educadRunCommand('/demo 3view'); await frame();
      const before = JSON.stringify(h.table.list()); window.educadSetSheetMode('pose');
      const key = value => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
      key('g'); key('y'); pointer('pointermove', { x: -120, y: 130 }); key('Escape');
      assert(before === JSON.stringify(h.table.list()), 'Pose gesture mutated the table');
      assert(window.educadPoseViews() !== null, 'Escape should cancel the gesture and retain Pose mode');
      return { tableUnchanged: true, gestureCancelled: true };
    });
    await test('F09 posed profile copies correspond to real projected edges', async () => {
      await reset(); window.educadRunCommand('/demo 3view'); await frame();
      const g = h.solidMm, map = h.drafting.layout(), pose = EduCADPose.createPose();
      pose.rm = EduCADPose.axisAngleMatrix(0, 0, 1, Math.PI / 6); pose.t = [0, 100, 100];
      const posed = EduCADPose.applyPose(g.vertices, pose, EduCADPose.bboxCenter(g.vertices));
      const expected = EduCADProject.projectSolid(posed, g.edges, g.faces, map.side, map);
      const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-5;
      const bad = [];
      for (const e of h.table.list().filter(e => e.type === 'SEGMENT' && e.viewRole === 'PROFILE')) {
        for (const c of h.drafting.projectCopies(e, posed)) {
          const end = { x: c.x2, y: c.y2 };
          if (!expected.some(s => (near(c, { x: s.ax, y: s.ay }) && near(end, { x: s.bx, y: s.by })) || (near(c, { x: s.bx, y: s.by }) && near(end, { x: s.ax, y: s.ay })))) bad.push(e.caption);
        }
      }
      assert(!bad.length, { inventedEdges: bad });
    });
    await test('F01 cancelling a drag restores once without an exception', async () => {
      await reset(); tool('select'); const { a } = setupLine(); await frame();
      const before = JSON.stringify(h.table.list()), errorStart = errors.length;
      pointer('pointerdown', a); pointer('pointermove', { x: -15, y: 35 });
      const moved = before !== JSON.stringify(h.table.list());
      try { pointer('pointercancel', { x: -15, y: 35 }); }
      finally { pointer('pointerup', { x: -15, y: 35 }); }
      assert(moved, 'The drag did not start');
      assert(errors.length === errorStart, { errors: errors.slice(errorStart) });
      assert(before === JSON.stringify(h.table.list()), 'Cancelled drag was not restored');
    });
    for (const action of ['Escape', 'pointercancel', 'tool', 'view', 'pose']) {
      await test('F01 drag cancellation through ' + action + ' permits the next gesture', async () => {
        await reset(); window.educadRunCommand('/demo 3view'); await frame(); tool('select');
        const a = h.table.list().find(e => e.type === 'POINT' && e.viewRole === 'ELEVATION');
        const before = JSON.stringify(h.table.list()), errorStart = errors.length;
        const target = { x: a.x - 15, y: a.y + 15 };
        pointer('pointerdown', a, { altKey: true }); pointer('pointermove', target, { altKey: true });
        assert(before !== JSON.stringify(h.table.list()), 'The linked drag did not start');
        if (action === 'Escape') key('Escape');
        else if (action === 'pointercancel') pointer('pointercancel', target);
        else if (action === 'tool') tool('point');
        else window.educadSetSheetMode(action);
        pointer('pointerup', target);
        assert(before === JSON.stringify(h.table.list()), 'Cancellation left changed geometry');
        assert(errors.length === errorStart, errors.slice(errorStart));
        if (action === 'pose') assert(h.measure.mode === 'pose', 'Pose transition failed');
        window.educadSetSheetMode('edit'); tool('point');
        const count = h.table.count(); sheetClick({ x: -200, y: 120 });
        assert(h.table.count() === count + 1, 'The next independent click was swallowed');
        return { restored: true, nextClickWorks: true };
      });
    }
    for (const mode of ['view', 'pose']) {
      await test('F02 mutation boundary blocks API bypasses in ' + mode, async () => {
        await reset(); window.educadRunCommand('/demo 3view'); await frame(); window.educadSetSheetMode(mode);
        const before = JSON.stringify(h.table.list()), first = h.table.list().find(e => !e.locked);
        for (const mutate of [() => h.table.clear(), () => h.table.remove(first.id), () => h.table.update(first.id, { x: 200 }), () => h.table.create('POINT', { x: 0, y: 20 })]) {
          let blocked = false; try { mutate(); } catch (error) { blocked = /read-only/.test(error.message); }
          assert(blocked, 'Mutation was not rejected');
          assert(before === JSON.stringify(h.table.list()), 'Rejected mutation changed the table');
        }
        return { mode, tableUnchanged: true };
      });
    }
    await test('F02 entering Pose immediately after an edit captures current geometry', async () => {
      await reset(); window.educadRunCommand('/demo 3view'); await frame();
      const p = h.table.list().find(e => e.type === 'POINT' && e.viewRole === 'ELEVATION');
      EduCADDrafting.movePoint(h.table, EduCADEntities, p.id, { x: p.x, y: p.y + 20 }, h.drafting.layout());
      const expected = EduCADReconstruct.reconstructLive(h.table.visibleEntities(), { ignoreProfile: true });
      assert(expected.status === 'ok', expected.status);
      window.educadSetSheetMode('pose');
      assert(h.measure.mode === 'pose', 'Mode transition failed');
      assert(JSON.stringify(h.solidMm.vertices) === JSON.stringify(expected.geometry.vertices), 'Pose captured stale vertices');
    });
    await test('F02 invalid mode and invalid load preserve the active pose', async () => {
      await reset(); window.educadRunCommand('/demo 3view'); await frame(); window.educadSetSheetMode('pose');
      const before = JSON.stringify(h.table.list()), views = JSON.stringify(window.educadPoseViews());
      assert(window.educadSetSheetMode('invalid') === 'pose', 'Invalid mode exited Pose');
      let rejected = false;
      try { window.educadReplaceSheet({ entities: [{ type: 'SEGMENT', x: 1, y: 1, x2: 1, y2: 1 }] }); } catch (error) { rejected = true; }
      assert(rejected && h.measure.mode === 'pose', 'Invalid replacement changed mode');
      assert(before === JSON.stringify(h.table.list()) && views === JSON.stringify(window.educadPoseViews()), 'Invalid replacement changed pose data');
    });
    await test('F02 explicit sheet replacement leaves Pose and removes old overlays', async () => {
      await reset(); window.educadRunCommand('/demo 3view'); await frame(); window.educadSetSheetMode('pose');
      const replacement = EduCADEntities.createEntity('POINT', { id: 'replacement', x: -100, y: 20 });
      assert(window.educadReplaceSheet({ entities: [replacement] }) === 1, 'Load count differs'); await frame();
      assert(h.measure.mode === 'edit' && window.educadPoseViews() === null, 'Old pose retained');
      assert(h.table.count() === 1 && h.table.has('replacement') && !h.solidMm, 'Old solid retained');
      return { mode: h.measure.mode, oldPoseRemoved: true };
    });
    await test('Smoke: confirmed rotation, translation, and scale preserve stored geometry', async () => {
      await reset(); window.educadRunCommand('/demo 3view'); await frame();
      const before = JSON.stringify(h.table.list()); window.educadSetSheetMode('pose');
      for (const op of ['r', 'g', 's']) {
        key(op); key('z'); pointer('pointermove', { x: 20, y: 100 }); key('Enter');
        assert(before === JSON.stringify(h.table.list()), op + ' modified stored geometry');
        assert(window.educadPoseViews() !== null, 'Confirm exited Pose');
      }
      key('Tab'); assert(h.measure.mode === 'edit', 'Tab did not return to Edit');
      assert(before === JSON.stringify(h.table.list()), 'Exiting Pose modified stored geometry');
    });
    for (const name of ['circle', 'polyline', 'dimension']) {
      await test('Smoke: Draw ' + name + ' keeps linked geometry through edit and history', async () => {
        await reset(); tool(name);
        sheetClick({ x: -200, y: 60 }); sheetClick({ x: -180, y: 60 });
        if (name !== 'circle') sheetClick({ x: -160, y: 80 });
        key('Escape');
        const type = name === 'circle' ? 'CIRCLE' : name === 'dimension' ? 'DIMENSION' : 'SEGMENT';
        const entity = h.table.list().filter(e => e.type === type).slice(-1)[0];
        assert(entity, 'No geometry was created');
        const before = JSON.stringify(h.table.list());
        applyEditor(entity, { x: entity.x + 5, y: entity.y + 5 });
        assert(before !== JSON.stringify(h.table.list()), 'Coordinate edit did not commit');
        for (const edge of h.table.list().filter(e => ['SEGMENT', 'DIMENSION'].includes(e.type))) {
          const owners = EduCADEntities.endpointReferences(h.table.list(), edge);
          assert(owners[0] && owners[1], 'Draw did not declare endpoint owners');
          assert(edge.x === owners[0].x && edge.y === owners[0].y && edge.x2 === owners[1].x && edge.y2 === owners[1].y, 'Edited endpoint detached');
        }
        if (name === 'circle') {
          const center = h.table.get(entity.meta.centerRef), rim = h.table.get(entity.meta.radiusRef);
          assert(entity.x === center.x && entity.y === center.y && Math.abs(entity.radius - Math.hypot(rim.x - center.x, rim.y - center.y)) < 1e-6, 'Circle detached');
        }
        const after = JSON.stringify(h.table.list());
        assert(h.history.undo(), 'Edit could not be undone');
        assert(before === JSON.stringify(h.table.list()), 'Undo did not restore the complete graph');
        assert(h.history.redo() && after === JSON.stringify(h.table.list()), 'Redo did not restore the complete graph');
      });
    }
    await test('Smoke: Draw Projector pairs points that stay linked during editing', async () => {
      await reset(); tool('point'); sheetClick({ x: -200, y: 60 }); tool('projector'); sheetClick({ x: -200, y: -40 });
      const points = h.table.list().filter(e => e.type === 'POINT'), projector = h.table.list().find(e => e.meta.kind === 'projector');
      assert(points.length === 2 && projector, { points: points.length, projector: !!projector });
      applyEditor(points[0], { x: -180 });
      assert(points.every(p => p.x === -180) && projector.x === -180 && projector.x2 === -180, 'Projector station detached');
    });
    await test('F07 hidden guides neither snap nor absorb newly drawn points', async () => {
      await reset();
      const guide = h.table.create('POINT', { x: -100, y: 30, viewRole: 'ELEVATION', meta: { kind: 'projector' } });
      h.drafting.preferences({ guides: false, solid: true }); tool('point');
      sheetClick({ x: -101, y: 70 });
      assert(h.table.list().some(e => e.type === 'POINT' && e.x === -101 && e.y === 70), 'Hidden guide snapped the station');
      const count = h.table.count(); sheetClick(guide);
      assert(h.table.count() === count + 1, 'Hidden guide absorbed a new point');
      window.educadSetSheetMode('view'); sheetClick(guide);
      assert(h.measure.inspectId !== guide.id, 'Hidden guide remained pickable');
    });
  } finally { window.removeEventListener('error', onError); }
  window.educadDrawingAuditResults = results;
  return { passed: results.filter(r => r.status === 'PASS').length, failed: results.filter(r => r.status === 'FAIL').length, results };
})()

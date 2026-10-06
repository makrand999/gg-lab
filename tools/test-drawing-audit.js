'use strict';
// Regression and generalized edge-case coverage for drawing and mode logic.
// Run: node tools/test-drawing-audit.js
const assert = require('node:assert/strict');
const E = require('../public/lib/educad-entities');
const D = require('../public/lib/educad-drafting');
const C = require('../public/lib/educad-command');
const M = require('../public/lib/educad-measure');
const Pose = require('../public/lib/educad-pose');
const Project = require('../public/lib/educad-project');
const Geometry = require('../public/lib/educad-geometry');
const Saves = require('../public/lib/educad-saves');
const Curriculum = require('../public/lib/educad-curriculum');
const Reconstruct = require('../public/lib/educad-reconstruct');
const map = { three: true, side: 'left', xRef: 100, dRef: 0, s: 1 };
const view = { s: 2, tx: 0, ty: 200 };
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.log('FAIL ' + name + '\n  ' + error.message.replace(/\n/g, '\n  ')); }
}
function commands(lines) {
  const table = E.createTable();
  for (const line of lines) assert.equal(C.execute(line, { table }).ok, true, line);
  return table;
}
function arc() {
  return commands(['/point c 0 30 elevation', '/arc c 10 0 90']).list().find(e => e.type === 'CIRCULAR_ARC');
}

check('F03 named command circle follows its center', () => {
  const t = commands(['/point c 0 30 elevation', '/circle c 10']);
  const center = t.list().find(e => e.type === 'POINT');
  const circle = t.list().find(e => e.type === 'CIRCLE');
  D.movePoint(t, E, center.id, { x: 5, y: 35 }, map);
  assert.deepEqual([circle.x, circle.y, circle.radius], [5, 35, 10]);
});
check('F03 deleting a named command center deletes its dependent circle', () => {
  const t = commands(['/point c 0 30 elevation', '/circle c 10']);
  const circle = t.list().find(e => e.type === 'CIRCLE');
  assert.equal(C.execute('/delete c', { table: t }).ok, true);
  assert.equal(t.has(circle.id), false);
});
check('F04 explicit endpoint IDs take precedence over unrelated coincident points', () => {
  const t = E.createTable();
  const a = t.create('POINT', { x: 0, y: 20, caption: 'a', viewRole: 'ELEVATION' });
  const q = t.create('POINT', { x: 0, y: 20, caption: 'q', viewRole: 'ELEVATION' });
  const b = t.create('POINT', { x: 30, y: 20, caption: 'b', viewRole: 'ELEVATION' });
  const line = t.create('SEGMENT', { x: q.x, y: q.y, x2: b.x, y2: b.y, viewRole: 'ELEVATION', meta: { refs: [q.id, b.id] } });
  D.movePoint(t, E, a.id, { x: 5, y: 25 }, map);
  assert.deepEqual([line.x, line.y], [q.x, q.y]);
});
check('F05 command arc measurements use stored degrees', () => {
  assert.equal(M.inspectEntity(arc()).rows[2], 'arc 15.71 mm, 0.0° to 90.0°');
});
check('F05 identity pose preserves a command arc sweep', () => {
  const a = arc(), identity = { angle: 0, scale: 1, tx: 0, ty: 0 };
  const posed = Pose.poseEntity(a, identity, identity);
  assert.ok(Math.abs(posed.endAngle - a.endAngle) < 1e-9, `90° became ${posed.endAngle}°`);
});
for (const type of ['LINE', 'RAY']) {
  check('F08 ' + type + ' can be picked beyond its defining endpoint', () => {
    const e = E.createEntity(type, { id: type, x: 0, y: 20, x2: 10, y2: 20 });
    assert.equal(M.hitTestAll([e], { x: 100, y: 160 }, view, 1), e.id);
  });
}
check('F08 absent part of an arc is not pickable', () => {
  const a = arc();
  assert.equal(M.hitTestAll([a], { x: -20, y: 140 }, view, 1), null);
});
check('F08 empty center of a large arc is not pickable', () => {
  const a = arc();
  assert.equal(M.hitTestAll([a], { x: 0, y: 140 }, view, 1), null);
});
check('F10 profile coverage rejects an extra span across a missing interval', () => {
  const geometry = { vertices: [0, 4.4, 4.8, 10].map(z => ({ x: 0, y: 10, z })), edges: [[0, 1], [2, 3]], faces: [] };
  const drawn = [{ id: 'extra-span', type: 'SEGMENT', x: 100, y: 10, x2: 110, y2: 10, viewRole: 'PROFILE' }];
  assert.equal(D.validateProfile(drawn, geometry, map, Project).status, 'mismatch');
});

check('F01 cancellation cannot recursively re-enter snapshot restoration', () => {
  const t = E.createTable(); t.create('POINT', { x: 0, y: 20 });
  let restores = 0;
  const h = D.createHistory(t, snapshot => {
    restores++; h.cancel(); Saves.restoreTable(E, t, { entities: snapshot });
  });
  h.begin(); t.update(t.list()[0].id, { x: 8 }); h.cancel();
  assert.equal(restores, 1); assert.equal(t.list()[0].x, 0);
  assert.deepEqual(h.counts(), { undo: 0, redo: 0 });
});
check('F02 table guard blocks all mutation APIs without changing geometry', () => {
  const t = commands(['/point a 0 20', '/point b 10 20', '/line a b']);
  const a = t.list()[0];
  const before = JSON.stringify(t.list()); t.setMutationGuard(() => false);
  for (const fn of [() => t.create('POINT', { x: 5, y: 6 }), () => t.add(E.createEntity('POINT')),
    () => t.update(a.id, { x: 5 }), () => t.updateMany({ [a.id]: { x: 5 } }),
    () => t.move(a.id, 1, 1), () => t.remove(a.id), () => t.removeCascade(a.id),
    () => t.clear(), () => t.lock(a.id), () => t.unlock(a.id), () => Saves.restoreTable(E, t, { entities: [] })]) {
    assert.throws(fn, /read-only/); assert.equal(JSON.stringify(t.list()), before);
  }
  t.setMutationGuard(() => true); t.update(a.id, { x: 5 }); assert.equal(a.x, 5);
});
check('F01 rejected and reentrant restores preserve the history stacks', () => {
  const t = E.createTable(), p = t.create('POINT', { x: 0, y: 20 });
  let h, allow = true;
  h = D.createHistory(t, snapshot => {
    assert.equal(h.undo(), false); assert.equal(h.redo(), false);
    Saves.restoreTable(E, t, { entities: snapshot });
  });
  t.update(p.id, { x: 10 }); assert.deepEqual(h.counts(), { undo: 1, redo: 0 });
  t.setMutationGuard(() => allow); allow = false;
  assert.throws(() => h.undo(), /read-only/);
  assert.deepEqual(h.counts(), { undo: 1, redo: 0 });
  assert.equal(t.get(p.id).x, 10);
  allow = true; assert.equal(h.undo(), true); assert.equal(t.get(p.id).x, 0);
  allow = false; assert.throws(() => h.redo(), /read-only/);
  assert.deepEqual(h.counts(), { undo: 0, redo: 1 });
  allow = true; assert.equal(h.redo(), true); assert.equal(t.get(p.id).x, 10);
});
check('F03 legacy forward references migrate on restore without changing input', () => {
  const raw = { entities: [
    { id: 'curve', type: 'CIRCULAR_ARC', x: 0, y: 30, radius: 10, startAngle: 350, endAngle: 10, meta: { refs: ['center'] } },
    { id: 'owner', type: 'POINT', x: 0, y: 30, name: 'center', caption: 'center', viewRole: 'ELEVATION' }
  ] };
  const before = JSON.stringify(raw), t = E.createTable(); Saves.restoreTable(E, t, raw);
  assert.equal(JSON.stringify(raw), before);
  assert.equal(t.get('curve').meta.centerRef, 'owner');
  assert.deepEqual(t.get('curve').meta.refs, ['owner']);
  assert.equal(C.execute('/rename center renamed', { table: t }).ok, true);
  D.movePoint(t, E, 'owner', { x: 5, y: 35 }, map);
  assert.deepEqual([t.get('curve').x, t.get('curve').y, t.get('curve').radius], [5, 35, 10]);
  t.removeCascade('owner'); assert.equal(t.count(), 0);
});
check('F03 command renaming preserves front/top/side identity and dependencies', () => {
  const t = commands(["/point a' 0 20 elevation", '/point a 0 -30 plan', "/point a'' 130 20 profile", "/circle a' 5"]);
  const front = t.list()[0], top = t.list()[1], side = t.list()[2], circle = t.list()[3];
  assert.equal(C.execute("/rename a' p'", { table: t }).ok, true);
  assert.deepEqual([front.caption, top.caption, side.caption], ["p'", 'p', "p''"]);
  D.movePoint(t, E, top.id, { x: 5, y: -40 }, map);
  assert.deepEqual([front.x, side.x, circle.x], [5, 140, 5]);
});
check('F03 chain edges keep their own endpoints after a rename and coordinate edit', () => {
  const t = commands(['/point a 0 20', '/point b 10 20', '/point c 10 30', '/polyline a b c']);
  const pts = t.list().filter(e => e.type === 'POINT'), edges = t.list().filter(e => e.type === 'SEGMENT');
  C.execute('/rename b middle', { table: t });
  D.editEntity(t, E, edges[1].id, { x: 15, y: 25, x2: 20, y2: 35 }, map);
  assert.deepEqual([pts[0].x, pts[1].x, pts[1].y, pts[2].x, pts[2].y], [0, 15, 25, 20, 35]);
  assert.deepEqual([edges[0].x2, edges[0].y2], [15, 25]);
});
check('F04 cascade also respects explicit ownership at a coincident point', () => {
  const t = commands(['/point a 0 20', '/point q 0 20', '/point b 10 20', '/line q b']);
  const line = t.list().find(e => e.type === 'SEGMENT');
  C.execute('/delete a', { table: t }); assert.ok(t.has(line.id));
});
check('F04 legacy endpoint ownership is shared by move, edit, and delete', () => {
  const t = E.createTable(), a = t.create('POINT', { x: 0, y: 20, viewRole: 'ELEVATION' }), b = t.create('POINT', { x: 20, y: 20, viewRole: 'ELEVATION' });
  const line = t.create('SEGMENT', { x: 0, y: 20, x2: 20, y2: 20, viewRole: 'ELEVATION' });
  D.editEntity(t, E, line.id, { x: 5 }, map);
  assert.equal(a.x, 5);
  const otherView = t.create('POINT', { x: 5, y: 20, viewRole: 'PROFILE' });
  assert.deepEqual(E.collectCascadeDeleteIds(t.list(), otherView.id), [otherView.id]);
  D.movePoint(t, E, a.id, { x: 10, y: 20 }, map);
  assert.equal(line.x, 10);
  assert.deepEqual(E.collectCascadeDeleteIds(t.list(), a.id), [a.id, line.id]);
  const q = t.create('POINT', { x: a.x, y: a.y, viewRole: 'ELEVATION' });
  assert.deepEqual(E.collectCascadeDeleteIds(t.list(), a.id), [a.id]);
  D.movePoint(t, E, q.id, { x: 15, y: 20 }, map);
  assert.equal(line.x, 10, 'Ambiguous coincident endpoints must not guess an owner');
});
check('F04 locked linked points reject the entire move', () => {
  const t = commands(["/point a' 0 20 elevation", '/point a 0 -30 plan']);
  const front = t.list()[0], top = t.list()[1]; t.lock(top.id);
  const before = JSON.stringify(t.list());
  assert.throws(() => D.movePoint(t, E, front.id, { x: 5, y: 25 }, map), /locked/);
  assert.equal(JSON.stringify(t.list()), before);
});
check('F04 locked dependent edges reject the entire move', () => {
  const t = commands(['/point a 0 20', '/point b 10 20', '/line a b']);
  const a = t.list()[0], line = t.list()[2]; t.lock(line.id);
  const before = JSON.stringify(t.list());
  assert.throws(() => D.movePoint(t, E, a.id, { x: 5, y: 25 }, map), /locked/);
  assert.equal(JSON.stringify(t.list()), before);
});
check('F06 final-valid swaps commit once and observers see complete geometry', () => {
  const t = commands(['/point a 0 20', '/point b 10 20', '/line a b']);
  const [a, b, line] = t.list(); let observed = 0;
  t.subscribe(() => { observed++; assert.deepEqual([a.x, b.x, line.x, line.x2], [10, 0, 10, 0]); });
  D.editEntity(t, E, line.id, { x: 10, y: 20, x2: 0, y2: 20 }, map);
  assert.equal(observed, 3);
});
check('F06 invalid final graph rejects without partial changes or events', () => {
  const t = commands(['/point a 0 20', '/point b 10 20', '/line a b']);
  const before = JSON.stringify(t.list()); let events = 0; t.subscribe(() => { events++; });
  assert.throws(() => D.movePoints(t, E, { [t.list()[0].id]: { x: 10, y: 20 } }, map));
  assert.equal(JSON.stringify(t.list()), before); assert.equal(events, 0);
});
check('F06 point coordinate/name form validates both actions before commit', () => {
  const t = commands(["/point a' 0 20 elevation", '/point a 0 -30 plan']);
  t.lock(t.list()[1].id); const before = JSON.stringify(t.list());
  assert.throws(() => D.editPoint(t, E, t.list()[0].id, { x: 0, y: 25 }, "p'", map), /locked/);
  assert.equal(JSON.stringify(t.list()), before);
});
check('F06 partial edits preserve unspecified linked coordinates', () => {
  const t = commands(['/point a 0 30 elevation', '/point b 20 30 elevation', '/line a b', '/circle a 10']);
  const line = t.list().find(e => e.type === 'SEGMENT'), circle = t.list().find(e => e.type === 'CIRCLE');
  D.editEntity(t, E, line.id, { x: 5 }, map);
  assert.deepEqual([line.x, line.y, line.x2, circle.x], [5, 30, 20, 5]);
  D.editEntity(t, E, circle.id, { radius: 15 }, map);
  assert.deepEqual([circle.x, circle.y, circle.radius], [5, 30, 15]);
});
check('F06 unchanged requested positions reject contradictory linked targets atomically', () => {
  const t = commands(["/point a' 0 20 elevation", '/point a 0 -30 plan']);
  const [front, top] = t.list(), before = JSON.stringify(t.list());
  assert.throws(() => D.movePoints(t, E, { [front.id]: { x: 0, y: 20 }, [top.id]: { x: 10, y: -30 } }, map), /disagree/);
  assert.equal(JSON.stringify(t.list()), before);
});
check('F06 center/rim circle translation and resizing validate the final radius', () => {
  const t = E.createTable(), c = t.create('POINT', { x: 0, y: 30 }), r = t.create('POINT', { x: 10, y: 30 });
  const circle = t.create('CIRCLE', { x: 0, y: 30, radius: 10, meta: { centerRef: c.id, radiusRef: r.id, refs: [c.id, r.id] } });
  D.editEntity(t, E, circle.id, { x: 10, y: 30, radius: 15 }, map);
  assert.deepEqual([c.x, r.x, circle.x, circle.radius], [10, 25, 10, 15]);
  const before = JSON.stringify(t.list());
  assert.throws(() => D.editEntity(t, E, circle.id, { x: 10, y: 30, radius: 0 }, map));
  assert.equal(JSON.stringify(t.list()), before);
});
for (const [start, end] of [[350, 10], [-90, 0], [180, 270], [10, 350], [720, 810]]) {
  check(`F05 wrapping arc ${start}→${end} preserves sweep under identity and mirror`, () => {
    const e = E.createEntity('CIRCULAR_ARC', { x: 0, y: 30, radius: 10, startAngle: start, endAngle: end });
    const sweep = Geometry.arcSweep(start, end), identity = { angle: 0, scale: 1, tx: 0, ty: 0 };
    assert.ok(M.inspectEntity(e).rows[2].startsWith('arc ' + (10 * sweep * Math.PI / 180).toFixed(2) + ' mm'));
    for (const sim of [identity, { angle: 0.7, sx: -1, sy: 1, scale: -1, tx: 0, ty: 0 }]) {
      const cp = Pose.poseEntity(e, sim, sim);
      assert.ok(Math.abs(Geometry.arcSweep(cp.startAngle, cp.endAngle) - sweep) < 1e-8);
    }
  });
}
for (const scale of [0.05, 2, 50]) {
  check('F08 geometry-aware picking at zoom ' + scale, () => {
    const v = { s: scale, tx: 100, ty: 200 }, px = (x, y) => ({ x: 100 + x * scale, y: 200 - y * scale });
    const line = E.createEntity('LINE', { id: 'l', x: 0, y: 20, x2: 10, y2: 20 });
    const ray = E.createEntity('RAY', { id: 'r', x: 10, y: 20, x2: 0, y2: 20 });
    const wrap = E.createEntity('CIRCULAR_ARC', { id: 'a', x: 0, y: 50, radius: 10, startAngle: 350, endAngle: 10 });
    assert.equal(M.hitTestAll([line], px(-100, 20), v, 0.1), 'l');
    assert.equal(M.hitTestAll([ray], px(-100, 20), v, 0.1), 'r');
    assert.equal(M.hitTestAll([ray], px(100, 20), v, 0.1), null);
    assert.equal(M.hitTestAll([wrap], px(10, 50), v, 0.1), 'a');
    assert.equal(M.hitTestAll([wrap], px(-10, 50), v, 0.1), null);
  });
}
check('F08 picking rejects invalid viewport scales and invalid arcs', () => {
  for (const s of [0, -1, NaN, Infinity]) assert.equal(M.hitTestAll([arc()], { x: 0, y: 0 }, { s, tx: 0, ty: 0 }), null);
  assert.equal(M.hitTestAll([{ ...arc(), startAngle: NaN }], { x: 20, y: 140 }, view), null);
});
check('F10 capsule coverage respects gaps, tolerances, overlap, and reversed segments', () => {
  const a = { x: 0, y: 0 }, b = { x: 10, y: 0 }, segment = (x, y) => ({ a: { x, y: 0 }, b: { x: y, y: 0 } });
  assert.equal(Geometry.segmentCovered(a, b, [segment(0, 4.4), segment(4.8, 10)], 0.15), false);
  assert.equal(Geometry.segmentCovered(a, b, [segment(0, 5), segment(5.2, 10)], 0.15), true);
  assert.equal(Geometry.segmentCovered(b, a, [segment(6, 0), segment(10, 4)], 0), true);
  assert.equal(Geometry.segmentCovered(a, b, [{ a: { x: 0, y: 0.2 }, b: { x: 10, y: 0.2 } }], 0.15), false);
  assert.equal(Geometry.segmentCovered(a, a, [], 0.15, [a]), true);
});
check('F10 coverage is independent of position, length, and old sample locations', () => {
  for (const length of [1, 10, 1000, 1e9, 1e12]) for (const station of [0.11, 0.37, 0.91]) {
    const lo = length * station, hi = lo + 0.4, segments = [{ a: { x: -1000, y: 12 }, b: { x: -1000 + lo, y: 12 } }, { a: { x: -1000 + hi, y: 12 }, b: { x: -1000 + length + 1, y: 12 } }];
    assert.equal(Geometry.segmentCovered({ x: -1000, y: 12 }, { x: -1000 + length + 1, y: 12 }, segments, 0.15), false);
  }
});
check('F10 straight coverage uses the full tolerance without a curve penalty', () => {
  const g = { vertices: [{ x: 0, y: 10, z: 0 }, { x: 0, y: 10, z: 10 }], edges: [[0, 1]], faces: [] };
  const line = E.createEntity('SEGMENT', { id: 'offset', x: 100, y: 10.14, x2: 110, y2: 10.14, viewRole: 'PROFILE' });
  assert.equal(D.validateProfile([line], g, map, Project).status, 'ok');
  line.y = line.y2 = 10.16;
  assert.equal(D.validateProfile([line], g, map, Project).status, 'mismatch');
  assert.equal(Geometry.segmentCovered({ x: 0, y: 0 }, { x: 10, y: 0 }, [{ a: { x: 0, y: 1e-6 }, b: { x: 10, y: 1e-6 } }], 0), false);
});
check('F03 saved stable IDs do not collide with object prototype keys', () => {
  const t = E.createTable();
  Saves.restoreTable(E, t, { entities: ['__proto__', 'constructor', 'toString'].map((id, i) => E.createEntity('POINT', { id, x: i, y: 20 })) });
  assert.equal(t.count(), 3);
  for (const id of ['__proto__', 'constructor', 'toString']) assert.equal(t.get(id).id, id);
});
for (const solid of ['PRISM', 'PYRAMID', 'CYLINDER', 'CONE']) for (const side of [1, -1]) {
  check(`F09 ${solid} side ${side} retains connected projected edges across poses`, () => {
    const sheet = Curriculum.threeViewSheet({ solid, sizeMm: 35, heightMm: 70, xMm: 0, side });
    const g = Reconstruct.reconstructLive(sheet.entities).geometry, layout = D.layoutOf(sheet.entities, g);
    const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-5;
    for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
      const pose = Pose.createPose(); pose.rm = Pose.axisAngleMatrix(...axis, 0.4); pose.t = [20, 100, 100];
      const posed = Pose.applyPose(g.vertices, pose, Pose.bboxCenter(g.vertices));
      const expected = Project.projectSolid(posed, g.edges, g.faces, layout.side, layout);
      for (const e of sheet.entities.filter(e => e.type === 'SEGMENT' && e.viewRole === 'PROFILE' && !(e.meta && e.meta.kind === 'projector'))) {
        for (const cp of D.profileCopies(e, g, posed, layout)) {
          // Rider metadata proves that the copy actually matched geometry.
          if (!cp.meta?.poseRiders) continue;
          assert.ok(expected.some(s => Geometry.spanDistance(cp, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by }, 'SEGMENT') < 1e-5 && Geometry.spanDistance({ x: cp.x2, y: cp.y2 }, { x: s.ax, y: s.ay }, { x: s.bx, y: s.by }, 'SEGMENT') < 1e-5), solid + ' invented an edge');
        }
      }
      for (const e of sheet.entities.filter(e => e.type === 'POINT' && e.viewRole === 'PROFILE')) {
        for (const cp of D.profileCopies(e, g, posed, layout)) if (cp.meta?.poseRiders) assert.ok(posed.some(v => near(cp, D.toView(v, 'PROFILE', layout))));
      }
    }
  });
}
check('F09 coincident side edges split instead of selecting the first corner', () => {
  const geometry = { vertices: [{ x: 0, y: 10, z: 20 }, { x: 30, y: 10, z: 20 }, { x: 0, y: 40, z: 50 }, { x: 30, y: 40, z: 50 }], edges: [[0, 2], [1, 3]], faces: [] };
  const e = E.createEntity('SEGMENT', { x: 120, y: 10, x2: 150, y2: 40, viewRole: 'PROFILE' });
  const pose = Pose.createPose(); pose.rm = Pose.axisAngleMatrix(0, 0, 1, 0.5);
  const copies = D.profileCopies(e, geometry, Pose.applyPose(geometry.vertices, pose, Pose.bboxCenter(geometry.vertices)), map);
  assert.equal(copies.length, 2);
  assert.deepEqual(copies.map(e => e.meta.poseRiders), [[0, 2], [1, 3]]);
});
console.log(`${passed} passed; ${failed} failed`);
process.exitCode = failed ? 1 : 0;

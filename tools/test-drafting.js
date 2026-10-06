'use strict';
const assert = require('assert');
const fs = require('fs');
const E = require('../public/lib/educad-entities.js');
const D = require('../public/lib/educad-drafting.js');
const P = require('../public/lib/educad-project.js');
const C = require('../public/lib/educad-curriculum.js');
const R = require('../public/lib/educad-reconstruct.js');
const S = require('../public/lib/educad-saves.js');
let checks = 0;
function check(name, fn) { fn(); console.log('PASS ' + (++checks) + ' ' + name); }
const map = { three: true, side: 'left', xRef: 100, dRef: 0, s: 1 };
const t = E.createTable();
const a = t.create('POINT', { x: 10, y: 20, caption: "a'", viewRole: 'ELEVATION' });
const ap = t.create('POINT', { x: 10, y: -30, caption: 'a', viewRole: 'PLAN' });
const as = t.create('POINT', { x: 130, y: 20, caption: "a''", viewRole: 'PROFILE' });
const b = t.create('POINT', { x: 30, y: 40, caption: "b'", viewRole: 'ELEVATION' });
const bp = t.create('POINT', { x: 30, y: -50, caption: 'b', viewRole: 'PLAN' });
const bs = t.create('POINT', { x: 150, y: 40, caption: "b''", viewRole: 'PROFILE' });
function line(p, q, role, kind) { return t.create('SEGMENT', { x: p.x, y: p.y, x2: q.x, y2: q.y, viewRole: role, meta: { kind: kind || 'user-line', refs: [p.id, q.id] } }); }
const front = line(a, b, 'ELEVATION'), top = line(ap, bp, 'PLAN'), side = line(as, bs, 'PROFILE'), proj = line(a, ap, 'BOTH', 'projector');
check('front point move updates top station, side height and all attached endpoints', () => {
  D.movePoint(t, E, a.id, { x: 15, y: 25 }, map);
  assert.deepStrictEqual([a.x, a.y, ap.x, ap.y, as.x, as.y], [15, 25, 15, -30, 130, 25]);
  assert.deepStrictEqual([front.x, front.y, top.x, side.y, proj.x, proj.x2, proj.y], [15, 25, 15, 25, 15, 15, 25]);
});
check('top depth move updates side depth and edge endpoints', () => {
  D.movePoint(t, E, ap.id, { x: 17, y: -35 }, map);
  assert.deepStrictEqual([a.x, ap.x, as.x, top.x, top.y, side.x, proj.x2, proj.y2], [17, 17, 135, 17, -35, 135, 17, -35]);
});
check('side move updates height and depth in front and top', () => {
  D.movePoint(t, E, as.id, { x: 140, y: 32 }, map);
  assert.deepStrictEqual([a.y, ap.y, as.x, front.y, top.y, side.x, side.y], [32, -40, 140, 32, -40, 140, 32]);
});
check('collapsed connected edge rejects the whole move', () => {
  const before = JSON.stringify(t.list());
  assert.throws(() => D.movePoint(t, E, a.id, { x: b.x, y: b.y }, map));
  assert.strictEqual(JSON.stringify(t.list()), before);
});
check('nonfinite moves reject without mutation', () => { const before = JSON.stringify(t.list()); assert.throws(() => D.movePoint(t, E, a.id, { x: NaN, y: 0 }, map)); assert.strictEqual(JSON.stringify(t.list()), before); });
check('locked point cannot be moved', () => { t.lock(a.id); assert.throws(() => D.movePoint(t, E, a.id, { x: 4, y: 5 }, map)); t.unlock(a.id); });
check('rename keeps corresponding projection identities', () => {
  D.renamePoint(t, a.id, "p'"); assert.deepStrictEqual([a.caption, ap.caption, as.caption], ["p'", 'p', "p''"]);
});
check('rename preserves hidden member verdicts', () => {
  t.update(ap.id, { caption: '(p)' }); D.renamePoint(t, a.id, "q'"); assert.strictEqual(ap.caption, '(q)');
});
check('centre and rim point moves update a dependent circle', () => {
  const center = t.create('POINT', { x: -50, y: 20, caption: 'c', viewRole: 'ELEVATION' });
  const rim = t.create('POINT', { x: -40, y: 20, caption: 'r', viewRole: 'ELEVATION' });
  const circle = t.create('CIRCLE', { x: -50, y: 20, radius: 10, meta: { centerRef: center.id, radiusRef: rim.id } });
  D.movePoint(t, E, rim.id, { x: -35, y: 20 }, map); assert.strictEqual(circle.radius, 15);
  D.movePoint(t, E, center.id, { x: -55, y: 20 }, map); assert.deepStrictEqual([circle.x, circle.radius], [-55, 20]);
});
check('circle collapse is rejected atomically', () => {
  const center = t.list().find(e => e.caption === 'c'), rim = t.list().find(e => e.caption === 'r');
  const before = JSON.stringify(t.list()); assert.throws(() => D.movePoint(t, E, rim.id, center, map)); assert.strictEqual(JSON.stringify(t.list()), before);
});
const vertices = [{x:0,y:10,z:20},{x:30,y:40,z:50}], geometry = {vertices,edges:[[0,1]],faces:[]};
check('left profile projection uses depth and height with a fixed reference', () => {
  assert.deepStrictEqual(P.projectSolid(vertices, geometry.edges, [], 'left', map), [{ax:120,ay:10,bx:150,by:40,hidden:false}]);
});
check('right profile is mirrored about its fixed reference', () => {
  assert.deepStrictEqual(P.projectSolid(vertices, geometry.edges, [], 'right', {...map, s:-1}), [{ax:80,ay:10,bx:50,by:40,hidden:false}]);
});
check('profile map honours depth datum offset', () => assert.strictEqual(P.projectSolid(vertices, geometry.edges, [], 'left', {...map,dRef:15})[0].ax,105));
check('invalid profile mapping is rejected', () => { assert.throws(() => P.projectSolid(vertices,geometry.edges,[],'left',{...map,s:0})); assert.throws(() => P.projectSolid(vertices,geometry.edges,[],'left',{...map,dRef:NaN})); });
const correct = [{id:'side-edge',type:'SEGMENT',x:120,y:10,x2:150,y2:40,viewRole:'PROFILE'}];
check('matching profile is confirmed', () => assert.strictEqual(D.validateProfile(correct,geometry,map,P).status,'ok'));
check('incorrect height is highlighted without vetoing geometry', () => {
  const result=D.validateProfile([{...correct[0],y2:45}],geometry,map,P); assert.strictEqual(result.status,'mismatch'); assert.deepStrictEqual(result.issues,['side-edge']);
});
check('incorrect depth is highlighted', () => assert.strictEqual(D.validateProfile([{...correct[0],x2:160}],geometry,map,P).status,'mismatch'));
check('missing side edge is incomplete', () => assert.strictEqual(D.validateProfile([],geometry,map,P).status,'incomplete'));
check('partial side coverage is incomplete', () => assert.strictEqual(D.validateProfile([{...correct[0],x2:135,y2:25}],geometry,map,P).status,'incomplete'));
check('construction helpers are excluded from consistency checks', () => assert.strictEqual(D.validateProfile(correct.concat([{...correct[0],id:'helper',y2:100,meta:{kind:'projector'}}]),geometry,map,P).status,'ok'));
check('two-view sheets have no side warning', () => assert.strictEqual(D.validateProfile([],geometry,{...map,three:false},P).status,'idle'));
check('point-only paired drawing supports profile validation', () => assert.strictEqual(D.validateProfile([{id:'p',type:'POINT',x:120,y:10,viewRole:'PROFILE'}],{vertices:[vertices[0]],edges:[],faces:[]},map,P).status,'ok'));
for (const solid of ['PRISM','PYRAMID','CYLINDER','CONE']) {
  for (const dir of [1,-1]) {
    check(solid+' demo side '+dir+' matches the reconstructed views', () => {
      const sheet=C.threeViewSheet({solid,sizeMm:35,heightMm:70,xMm:0,side:dir});
      const result=R.reconstructLive(sheet.entities); assert.strictEqual(result.status,'ok');
      const layout=D.layoutOf(sheet.entities,result.geometry);
      assert.strictEqual(layout.s,dir);
      assert.strictEqual(D.validateProfile(sheet.entities,result.geometry,layout,P).status,'ok');
    });
  }
}
for (const solid of ['PRISM','PYRAMID','CYLINDER','CONE']) {
  check(solid+' keeps its front/top preview when the side view is wrong', () => {
    const sheet=C.threeViewSheet({solid,sizeMm:35,heightMm:70,xMm:0,side:1});
    const side=sheet.entities.find(e => e.type==='SEGMENT' && e.viewRole==='PROFILE');
    assert(side); side.y2 += 10;
    const result=R.reconstructLive(sheet.entities,{ignoreProfile:true});
    assert.strictEqual(result.status,'ok');
    assert.strictEqual(D.validateProfile(sheet.entities,result.geometry,D.layoutOf(sheet.entities,result.geometry),P).status,'mismatch');
  });
}
check('dimension annotations do not count as solid edges', () => {
  assert.strictEqual(D.validateProfile(correct.concat([{...correct[0],id:'dim',type:'DIMENSION',y2:100}]),geometry,map,P).status,'ok');
});
check('saved sheet retains view layout and endpoint dependencies', () => {
  t.create('DATUM_AXIS',{x:100,y:0,x2:100,y2:50,viewRole:'PROFILE',meta:{kind:'axis',draftingLayout:map}});
  const snapshot=S.snapshotTable(t), restored=E.createTable(); S.restoreTable(E,restored,snapshot);
  assert.deepStrictEqual(D.layoutOf(restored.list(),geometry),map);
  assert.deepStrictEqual(restored.get(front.id).meta.refs,[a.id,b.id]);
});
check('side projection supports hidden-edge occlusion', () => {
  const vs=[]; for(const x of [0,10])for(const y of [0,10])for(const z of [0,10])vs.push({x,y,z});
  const edges=[[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]];
  const faces=[[0,2,6,4],[1,5,7,3],[0,4,5,1],[2,3,7,6],[0,1,3,2],[4,6,7,5]];
  const left=P.projectSolid(vs,edges,faces,'left',map),right=P.projectSolid(vs,edges,faces,'right',{...map,s:-1});
  assert(!left[0].hidden && left[2].hidden); assert(right[0].hidden && !right[2].hidden);
});
console.log('OK '+checks+' drafting checks passed');

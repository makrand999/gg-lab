'use strict';
// Gesture history over the real entity table and the persisted save format.
const assert = require('assert');
const fs = require('fs');
const E = require('../public/lib/educad-entities.js');
const S = require('../public/lib/educad-saves.js');
const D = require('../public/lib/educad-drafting.js');
let n = 0;
function pass(name) { console.log('PASS ' + (++n) + '/12 ' + name); }
async function main() {
  const t = E.createTable();
  const h = D.createHistory(t, snapshot => S.restoreTable(E, t, { entities: snapshot }));
  const a = t.create('POINT', { x: 0, y: 10 });
  const b = t.create('POINT', { x: 0, y: -10 });
  const edge = t.create('SEGMENT', { x: 0, y: 10, x2: 0, y2: -10, meta: { refs: [a.id, b.id] } });
  await Promise.resolve();
  assert.deepStrictEqual(h.counts(), { undo: 1, redo: 0 }); pass('synchronous changes form one gesture');
  const original = S.snapshotTable(t).entities;
  assert(h.undo()); assert.strictEqual(t.count(), 0); pass('undo restores pre-gesture sheet');
  assert(h.redo()); assert.deepStrictEqual(S.snapshotTable(t).entities, original); pass('redo restores IDs, order and references');
  t.removeCascade(a.id); await Promise.resolve(); h.undo();
  assert(t.has(a.id) && t.has(edge.id)); pass('cascade delete is reversible in one step');
  h.begin();
  for (let i = 1; i <= 5; i++) { t.update(a.id, { x: i }); await Promise.resolve(); }
  h.end(); h.undo(); assert.strictEqual(t.get(a.id).x, 0); pass('drag spanning frames is one undo entry');
  h.redo(); assert.strictEqual(t.get(a.id).x, 5); pass('drag redo preserves final position');
  const counts = h.counts();
  h.begin(); t.update(a.id, { x: 99 }); await Promise.resolve(); h.cancel();
  assert.strictEqual(t.get(a.id).x, 5); assert.deepStrictEqual(h.counts(), counts); pass('cancel rolls back preview without history');
  h.undo(); t.create('POINT', { x: 20, y: 30 }); await Promise.resolve();
  assert.strictEqual(h.counts().redo, 0); pass('new edits clear redo');
  h.begin(); h.begin(); t.update(a.id, { y: 15 }); h.end(); await Promise.resolve();
  assert(!h.undo()); h.end(); assert(h.undo()); assert.strictEqual(t.get(a.id).y, 10); pass('nested transactions finish atomically');
  for (let i = 0; i < 65; i++) { t.create('POINT', { x: i, y: 20 }); await Promise.resolve(); }
  assert.strictEqual(h.counts().undo, 50); pass('history retains 50 gestures');
  const before = JSON.stringify(t.list());
  for (let i = 0; i < 50; i++) assert(h.undo());
  assert(!h.undo()); for (let i = 0; i < 50; i++) assert(h.redo());
  assert.strictEqual(JSON.stringify(t.list()), before); pass('full history round trip');
  const index = fs.readFileSync('public/index.html', 'utf8');
  assert(index.includes('function userUndo()') && index.includes('function userRedo()') && index.includes('history: history'));
  pass('sheet and tools share history');
  console.log('OK 12/12 history tests passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

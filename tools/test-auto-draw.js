'use strict';
const assert = require('node:assert/strict');
const A = require('../public/lib/educad-auto.js');
const C = require('../public/lib/educad-command.js');
const E = require('../public/lib/educad-entities.js');
const S = require('../public/lib/educad-saves.js');
const D = require('../public/lib/educad-drafting.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }
const empty = { entities: [] };
const triangle = ['/point a 0 10', '/point b 20 10', '/point c 10 30', '/polygon a b c'];
test('valid script has referenced closed geometry', () => {
  const r = A.stage(triangle, empty, true);
  assert.equal(r.ok, true); assert.equal(r.entities.length, 6);
  assert.equal(r.entities.filter(e => e.type === 'SEGMENT').length, 3);
  const max=Array.from({length:128},(_,i)=>'/point p'+i+' '+i+' 10');
  assert.equal(A.stage(max,empty,false).ok,true,'128-command boundary accepted');
  assert.equal(A.stage(Array(24).fill('/ellipse 0 30 20 10 180'),empty,false).ok,false,'entity explosion rejected');
});
test('all drawing commands execute with named references and optional arguments', () => {
  const commands = triangle.slice(0, 3).concat([
    '/datum -30 30', '/line a b A elevation', '/ray a c B elevation',
    '/xline b c G elevation', '/circle a 5', '/circle 50 20 8 E elevation',
    '/arc b 5 30 100', '/arc 50 20 8 -45 90', '/text 0 40 "Quoted annotation"',
    '/dimension a b', '/polygon a b c', '/polyline a b c',
    '/ellipse a 5 3 12', '/ellipse 50 20 8 4 16 G elevation',
    '/hatch 0 10 20 30 4 45', '/rename c d', '/style d A elevation', '/delete d']);
  const r = A.stage(commands, empty, false);
  assert.equal(r.ok, true, r.message);
});
test('bad plans fail whole, including dependencies, duplicates, malformed quotes and geometry', () => {
  for (const bad of [null, [], Array(129).fill('/datum'),
    ['/point a 0 0', '/line a missing'], ['/point \"\" 0 10'], ['/point a 0 0', '/point a 1 1'],
    ['/circle 0 0 -1'], ['/ellipse 0 0 5 3 9999'], ['/point "a 0 0'],
    ['/point a NaN 10'], ['/point a 1e308 0'], ['/arc 0 0 10 0 360'],
    ['/point a 0 0\n/clear'], [7], ['/text 0 0 ' + 'x'.repeat(512)]]) {
    const before = JSON.stringify(empty);
    assert.equal(A.stage(bad, empty, true).ok, false, JSON.stringify(bad));
    assert.equal(JSON.stringify(empty), before);
  }
});
test('generated plans cannot invoke page controls or clear the sheet', () => {
  for (const command of ['clear', 'undo', 'mode edit', 'demo square', 'tutorial square', 'check', 'help', 'auto circle']) {
    assert.equal(A.stage(['/point a 0 10', '/' + command], empty, true).ok, false);
  }
});
test('Monge pairs must align, including case-normalized names', () => {
  assert.equal(A.stage(['/point a 10 -20', "/point A' 11 30"], empty, true).ok, false);
  assert.equal(A.stage(['/point a 10 -20', "/point A' 10 30"], empty, true).ok, true);
});
test('Unicode primes, duplicate aliases and independent profile coordinates', () => {
  assert.equal(A.stage(['/point a 10 -20', '/point A′ 11 30'],empty,true).ok,false);
  assert.equal(A.stage(['/point a 0 -20','/point A 10 -30',"/point a' 10 40"],empty,true).ok,false);
  const commands=['/point a 10 -20 plan',"/point a' 10 30 elevation","/point a'' 120 30 profile"];
  assert.equal(A.stage(commands,empty,true).ok,true);
  assert.equal(require('./edc.js').runScript(commands.join('\n')).ok,true);
});
test('hatching bounds are checked before iteration', () => {
  for (const spacing of ['1e-300', '0.000001']) {
    const t = E.createTable();
    const started = Date.now();
    assert.equal(C.execute('/hatch 0 0 100 100 ' + spacing, { table: t }).ok, false);
    assert.equal(t.count(), 0); assert.ok(Date.now() - started < 500);
  }
});
test('collapsed chains never leave partial edges', () => {
  for (const command of ['polygon', 'polyline']) {
    const t = E.createTable();
    ['/point a 0 10', '/point b 10 10', '/point c 10 10'].forEach(line => C.execute(line, { table: t }));
    assert.equal(C.execute('/' + command + ' a b c', { table: t }).ok, false);
    assert.equal(t.count(), 3);
  }
});
test('special point names are represented without prototype collisions', () => {
  const t = E.createTable();
  ['__proto__', 'constructor', 'toString'].forEach((name, i) => C.execute('/point ' + name + ' ' + i + ' 10', { table: t }));
  const points = C.pointMap(t.list());
  assert.equal(Object.keys(points).length, 3);
  assert.equal(points.__proto__.x, 0);
  assert.ok(C.suggest('/style ',{points,entities:C.entityMap(t.list())}).some(s=>s.display==='__proto__'));
  assert.equal(A.stage(['/line __proto__ constructor'], S.snapshotTable(t), false).ok, true);
});
test('seeded malformed-command matrix stays bounded and never throws', () => {
  const values = ['', '0', '-1', '1e-300', '1e308', 'NaN', 'Infinity', 'a', '"', '__proto__', '3.14', '1e6'];
  const t = E.createTable(); C.execute('/point a 0 10', {table:t}); C.execute('/point b 10 20', {table:t});
  let seed=4707; const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  const started=Date.now();
  for (let i=0;i<2000;i++) {
    const command=A.ALLOWED[random()%A.ALLOWED.length];
    const args=Array.from({length:random()%9},()=>values[random()%values.length]);
    const line='/'+command+' '+args.join(' ');
    assert.equal(typeof C.preview(line,{points:C.pointMap(t.list()),entities:C.entityMap(t.list())}),'string');
    const r=A.stage([line],S.snapshotTable(t),false);
    assert.equal(typeof r.ok,'boolean'); assert.equal(t.count(),2);
  }
  assert.ok(Date.now()-started<10000,'command validation is unexpectedly slow');
});
async function main() {
  const t = E.createTable();
  let session = { role: 'teacher', token: 'test' }, readOnly = false, resolve, reject, requests = 0, modeRevision = 0;
  const history = D.createHistory(t, entities => S.restoreTable(E, t, { entities }));
  const runner = A.createRunner({ table: t, session: () => session, readOnly: () => readOnly, modeRevision: () => modeRevision,
    interpret: () => { requests++; return new Promise((yes, no) => { resolve = yes; reject = no; }); },
    commit: data => { history.begin(); try { S.restoreTable(E, t, data); } finally { history.end(); } } });
  let p = runner('triangle', 'auto');
  assert.equal((await runner('triangle', 'auto')).ok, false); assert.equal(requests, 1);
  resolve({ commands: triangle }); assert.equal((await p).ok, true);
  assert.equal(t.count(), 6); assert.equal(history.counts().undo, 1);
  history.undo(); assert.equal(t.count(), 0); history.redo(); assert.equal(t.count(), 6);
  passed++; console.log('PASS concurrent requests refused and successful plan is one undo/redo');
  for (const scenario of ['edit', 'view', 'mode-roundtrip', 'session', 'logout']) {
    const before = t.count();
    p = runner('replacement', 'auto', true);
    if (scenario === 'edit') C.execute('/point extra 90 90', { table: t });
    if (scenario === 'view') readOnly = true;
    if (scenario === 'mode-roundtrip') modeRevision += 2;
    if (scenario === 'session') session = { role: 'teacher', token: 'other' };
    if (scenario === 'logout') session = null;
    resolve({ commands: triangle }); assert.equal((await p).ok, false);
    assert.equal(t.count(), before + (scenario === 'edit' ? 1 : 0));
    readOnly = false; session = { role: 'teacher', token: 'test' };
  }
  passed++; console.log('PASS stale sheet/mode/session responses cannot replace drawing');
  const before = JSON.stringify(t.list());
  p = runner('bad replacement', 'auto', true); resolve({ commands: ['/point a 0 0', '/line a z'] });
  assert.equal((await p).ok, false); assert.equal(JSON.stringify(t.list()), before);
  p = runner('refusal', 'auto', true); resolve({ commands: [], reply: 'Need dimensions.' });
  assert.equal((await p).message, 'Need dimensions.'); assert.equal(JSON.stringify(t.list()), before);
  p = runner('network failure', 'auto', true); reject(new Error('offline'));
  assert.equal((await p).ok, false); assert.equal(JSON.stringify(t.list()), before);
  p = runner('retry', 'auto', true); resolve({ commands: triangle }); assert.equal((await p).ok, true);
  passed++; console.log('PASS failed replacements preserve drawing and request can be retried');
  session = { role: 'student', token: 'student' };
  const count = requests;
  assert.equal((await runner('triangle', 'auto')).ok, false);
  session = { role: 'teacher', token: 'test' }; readOnly = true;
  assert.equal((await runner('triangle', 'auto')).ok, false);
  readOnly = false; assert.equal((await runner('  ', 'auto')).ok, false);
  assert.equal(requests, count);
  passed++; console.log('PASS bridge rejects students, read-only sheets and empty requests before fetch');
  let answer, timeoutCalls = 0;
  const timed = A.createRunner({ table: t, session: () => session, readOnly: () => false,
    timeoutMs: 10, interpret: () => { timeoutCalls++; return new Promise(r => { answer = r; }); },
    commit: () => { throw new Error('Late response must never commit'); } });
  assert.equal((await timed('hung gateway', 'auto')).message, 'interpret_timeout');
  answer({commands: triangle}); await Promise.resolve();
  assert.equal((await timed('retry gateway', 'auto')).message, 'interpret_timeout');
  assert.equal(timeoutCalls, 2);
  passed++; console.log('PASS hung gateway releases request lock; late results never commit');
  for (const scenario of ['schema', 'geometry', 'refusal', 'failed-repair']) {
    let attempts = 0, commits = 0, feedback = '';
    const stable = JSON.stringify(t.list());
    const repaired = A.createRunner({ table: t, session: () => session, readOnly: () => false,
      maxAttempts: 2, interpret: async (s, text, points, mode, context, hint) => {
        attempts++; feedback = hint;
        assert.equal(JSON.stringify(t.list()), stable, 'no changes before final validation');
        if (scenario === 'refusal') return { commands: [], reply: 'Need dimensions.' };
        if (attempts === 1 || scenario === 'failed-repair') {
          return scenario === 'geometry' ? {commands:['/point a 0 10','/line a z']} :
            {commands:[], invalid_plan:true, reply:'Invalid drawing plan.'};
        }
        return {commands:triangle};
      }, commit: data => {commits++; S.restoreTable(E,t,data);} });
    const result = await repaired('original question', 'auto', true);
    assert.equal(attempts, scenario === 'refusal' ? 1 : 2);
    assert.equal(result.ok, scenario === 'schema' || scenario === 'geometry');
    assert.equal(commits, result.ok ? 1 : 0);
    if (attempts === 2) assert.ok(feedback);
    if (!result.ok) assert.equal(JSON.stringify(t.list()),stable);
  }
  passed++; console.log('PASS one bounded repair handles invalid schemas/geometry; refusals and repeated failures preserve drawing');
  let gatewayAttempts=0;
  const gatewayRetry=A.createRunner({table:t,session:()=>session,readOnly:()=>false,maxAttempts:2,
    interpret:async ()=>{gatewayAttempts++;if(gatewayAttempts===1)throw new Error('interpret_failed');return {commands:triangle};},
    commit:plan=>S.restoreTable(E,t,plan)});
  assert.equal((await gatewayRetry('triangle','auto',true)).ok,true);assert.equal(gatewayAttempts,2);
  for(const error of ['interpret_unavailable','unauthorized','bad text']) {
    let attempts=0;
    const reject=A.createRunner({table:t,session:()=>session,readOnly:()=>false,maxAttempts:2,
      interpret:async ()=>{attempts++;throw new Error(error);},commit:()=>{throw new Error('Must not commit');}});
    assert.equal((await reject('triangle','auto')).ok,false);assert.equal(attempts,1);
  }
  passed++;console.log('PASS transient gateway failure retries once; missing keys, auth and invalid requests do not retry');
  console.log('OK ' + passed + ' auto-draw regression groups passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

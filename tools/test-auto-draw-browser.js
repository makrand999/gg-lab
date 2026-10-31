// Evaluate with T3 preview_evaluate on a disposable guest sheet.
(async function () {
  const S = window.EduCADSaves, h = window.educadHandle;
  if (!h || S.currentSession().role !== 'guest') throw new Error('Use a disposable guest sheet.');
  const saved = S.snapshotTable(h.table), oldSession = S.currentSession;
  const oldInterpret = S.interpretWords, oldGetSet = S.getSet, oldUrl = location.href;
  const results = [];
  const triangle = ['/point a 0 10', '/point b 30 10', '/point c 15 35', '/polygon a b c'];
  let session = { role: 'teacher', token: 'mock-teacher' }, resolve, calls = 0;
  S.currentSession = () => session;
  S.interpretWords = (...args) => { calls++; if (args[6]) return Promise.resolve({commands:[],invalid_plan:true,reply:'Still invalid'}); return new Promise(r => { resolve = r; }); };
  function assert(value, message) { if (!value) throw new Error(message); }
  async function test(name, fn) {
    try { await fn(); results.push({name, status:'PASS'}); }
    catch (error) { results.push({name, status:'FAIL', error:error.message}); }
  }
  function reset() { educadSetSheetMode('edit'); educadReplaceSheet({entities:[]}); }
  try {
    await test('mounted bridge applies whole plan with one undo/redo', async () => {
      reset(); const before = h.history.counts().undo;
      const p = educadAutoDraw('triangle'); resolve({commands:triangle,reply:'Drafted'});
      assert((await p).ok,'draw failed'); assert(h.table.count()===6,'missing geometry');
      assert(h.history.counts().undo===before+1,'not one undo');
      h.history.undo();assert(h.table.count()===0,'undo incomplete');
      h.history.redo();assert(h.table.count()===6,'redo incomplete');
    });
    await test('failed replacement keeps current drawing and undo history', async () => {
      const before=JSON.stringify(h.table.list()), count=h.history.counts().undo;
      const p=educadAutoDraw('replacement',true);resolve({commands:['/point a 0 0','/line a z']});
      assert(!(await p).ok,'bad plan succeeded');assert(JSON.stringify(h.table.list())===before,'sheet changed');
      assert(h.history.counts().undo===count,'history changed');
    });
    await test('mounted repair sends validation feedback and commits once', async () => {
      const previous=S.interpretWords, before=JSON.stringify(h.table.list()), count=h.history.counts().undo;
      let attempts=0;
      try {
        S.interpretWords=async (...args)=>{
          attempts++;assert(JSON.stringify(h.table.list())===before,'failed first plan changed sheet');
          if(attempts===1)return {commands:['/point a 0 10','/line a z']};
          assert(args[6].includes('Unknown point'),'repair feedback missing');return {commands:triangle};
        };
        assert((await educadAutoDraw('repair triangle',true)).ok,'repair failed');
        assert(attempts===2,'wrong retry count');assert(h.history.counts().undo===count+1,'repair made multiple undo entries');
        h.history.undo();assert(JSON.stringify(h.table.list())===before,'repair undo incomplete');h.history.redo();
      } finally {S.interpretWords=previous;}
    });
    await test('stale view-mode response cannot edit drawing', async () => {
      const before=JSON.stringify(h.table.list());const p=educadAutoDraw('replacement',true);
      educadSetSheetMode('view');resolve({commands:triangle});assert(!(await p).ok,'view response accepted');
      assert(JSON.stringify(h.table.list())===before,'view sheet changed');educadSetSheetMode('edit');
    });
    await test('edit-view-edit roundtrip invalidates pending response', async () => {
      const before=JSON.stringify(h.table.list());const p=educadAutoDraw('replacement',true);
      educadSetSheetMode('view');educadSetSheetMode('edit');
      resolve({commands:triangle});assert(!(await p).ok,'roundtrip response accepted');
      assert(JSON.stringify(h.table.list())===before,'roundtrip changed sheet');
    });
    await test('stale response cannot overwrite manual edits', async () => {
      const p=educadAutoDraw('replacement',true);educadRunCommand('/point added 80 80');
      const before=JSON.stringify(h.table.list());resolve({commands:triangle});assert(!(await p).ok,'stale response accepted');
      assert(JSON.stringify(h.table.list())===before,'edit lost');
    });
    await test('overlapping calls and student bridge rejected before fetch', async () => {
      const p=educadAutoDraw('replacement',true), before=calls;
      assert(!(await educadAutoDraw('second',true)).ok,'second accepted');assert(calls===before,'second fetched');
      resolve({commands:triangle});await p;session={role:'student',token:'mock-student'};
      assert(!(await educadAutoDraw('student')).ok,'student accepted');assert(calls===before,'student fetched');
      session={role:'teacher',token:'mock-teacher'};
    });
    await test('teacher deep-link refusal preserves sheet and reports failure', async () => {
      const before=JSON.stringify(h.table.list());
      S.getSet=()=>Promise.resolve({questions:[{prompt:'Draw replacement',hint:'Use exact lengths'}]});
      history.replaceState(null,'','?model=AUTO&q=0&autodraw=1');
      const source=Array.from(document.scripts).find(s=>s.textContent.includes('(function deepLink()')).textContent;
      (0,eval)(source);await Promise.resolve();
      assert(JSON.stringify(h.table.list())===before,'deep-link cleared before model answered');
      resolve({commands:[],reply:'Missing dimensions'});
      await new Promise(r=>setTimeout(r,20));
      assert(JSON.stringify(h.table.list())===before,'deep-link changed refused drawing');
      assert(document.getElementById('save-status').textContent.includes('could not finish'),'missing failure status');
    });
  } finally {
    S.currentSession=oldSession;S.interpretWords=oldInterpret;S.getSet=oldGetSet;
    history.replaceState(null,'',oldUrl);educadReplaceSheet(saved);
  }
  return {passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results};
})();

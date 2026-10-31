// Run with T3 preview_evaluate on tools/prepare-teacher-preview.js's fixture.
(async function () {
  const audit = window.__teacherAudit;
  if (!audit) throw new Error('Open the disposable teacher fixture first.');
  const results = [], oldUrl = location.href;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const buttons = (name, scope = document) => [...scope.querySelectorAll('button')].filter(b => b.textContent === name);
  const click = (name, scope) => { const b = buttons(name, scope)[0]; assert(b, 'Missing action: ' + name); b.click(); return b; };
  const homeForm = () => document.getElementById('sec-newset').nextElementSibling;
  const input = (label, scope = homeForm()) => {
    const lbl = [...scope.querySelectorAll('label')].find(l => l.textContent === label);
    assert(lbl, 'Missing label: ' + label); return document.getElementById(lbl.htmlFor);
  };
  const set = (label, value, scope) => { const field = input(label, scope); field.value = value; field.dispatchEvent(new Event('input',{bubbles:true})); field.dispatchEvent(new Event('change',{bubbles:true})); return field; };
  const count = name => audit.calls.filter(c => c.name === name).length;
  async function route(hash, ms = 70) {
    history.replaceState(null, '', oldUrl.split('#')[0] + hash);
    dispatchEvent(new HashChangeEvent('hashchange')); await wait(ms);
  }
  async function home() { await route(''); }
  async function clearDraft() { await home(); click('Discard draft'); await wait(50); }
  async function add(prompt) { set('Prompt',prompt); click('Add question'); await wait(10); }
  async function test(name, fn) {
    try { await fn(); results.push({name,status:'PASS'}); }
    catch (error) { results.push({name,status:'FAIL',error:error.message}); }
    Object.keys(audit.failures).forEach(k => delete audit.failures[k]);
    Object.keys(audit.delays).forEach(k => delete audit.delays[k]);
  }
  await clearDraft();
  await test('Labels associate with inputs and model-only controls explain availability', async () => {
    const form = homeForm();
    assert([...form.querySelectorAll('.lab-lbl')].every(l => document.getElementById(l.htmlFor)), 'Unassociated label');
    assert(document.getElementById('lab-check-new').disabled, 'Auto-check enabled without a model');
    set('Model','1'); assert(!document.getElementById('lab-check-new').disabled,'Model check stays disabled');
    set('Model','');
  });
  await test('Code and UTF-8 title validation prevents silent truncation', async () => {
    const form = document.getElementById('sec-newclass').nextElementSibling;
    const before = count('createClass'); set('Code','bad code',form); click('Create class',form);
    assert(count('createClass')===before,'Invalid code was posted');
    set('Code','valid-code',form); set('Title','🧑'.repeat(60),form); click('Create class',form);
    assert(count('createClass')===before,'Oversized Unicode title was posted');
  });
  await test('Draft metadata, questions, pending text and class survive navigation', async () => {
    set('Code','draft-01'); set('Title','Draft title'); set('Class','be-a-2026'); await add('Draw a cube.');
    set('Prompt','Pending second question'); set('Hint','Retain this hint'); set('Bulk','Pending bulk text');
    await route('#class/be-a-2026'); await home();
    assert(input('Code').value==='draft-01' && input('Title').value==='Draft title','Metadata lost');
    assert(input('Class').value==='be-a-2026','Class lost');
    assert(input('Prompt').value==='Pending second question' && input('Bulk').value==='Pending bulk text','Pending input lost');
    assert(homeForm().textContent.includes('Q1: Draw a cube.'),'Draft question lost');
    const stored = JSON.parse(sessionStorage.getItem('educad_teacher_draft_v1:teacher:__teacher_workflow_audit__'));
    assert(stored.questions.length===1 && stored.hint==='Retain this hint','Draft not persisted for reload');
  });
  await test('Editing and ordering questions preserves models and pending edit across navigation', async () => {
    await clearDraft(); set('Model','1'); await add('First question'); await add('Second question');
    const rows = [...homeForm().querySelectorAll('.lab-row')]; click('Move up',rows[1]);
    assert(homeForm().querySelector('.lab-title').textContent.includes('Second question'),'Reordering failed');
    click('Edit',homeForm().querySelector('.lab-row')); set('Prompt','Edited second question');
    await route('#class/be-a-2026'); await home();
    assert(input('Prompt').value==='Edited second question' && buttons('Save question changes').length===1,'Pending edit lost');
    click('Save question changes');
    assert(homeForm().querySelector('.lab-title').textContent.includes('Edited second question'),'Edit not saved');
    assert(homeForm().textContent.includes('Model: Cube'),'Model lost while reordering');
  });
  await test('Bulk import is atomic, enforces limits, and never silently reuses selected model', async () => {
    await clearDraft(); set('Model','1'); set('Bulk','One question\nHint: One hint\n\nTwo questions'); click('Add all from text');
    let stored=JSON.parse(sessionStorage.getItem('educad_teacher_draft_v1:teacher:__teacher_workflow_audit__'));
    assert(stored.questions.length===2 && stored.questions.every(q=>!q.modelDrawingId),'Bulk inherited model');
    set('Bulk',Array.from({length:49},(_,i)=>'Question '+i).join('\n\n')); click('Add all from text');
    stored=JSON.parse(sessionStorage.getItem('educad_teacher_draft_v1:teacher:__teacher_workflow_audit__'));
    assert(stored.questions.length===2,'Oversized batch partially imported');
    set('Bulk','Valid question\n\nHint: Missing prompt'); click('Add all from text');
    assert(homeForm().querySelectorAll('.lab-row').length===2,'Invalid block partially imported');
  });
  await test('Unavailable class list and deleted class fail closed instead of posting an open set', async () => {
    await clearDraft(); set('Code','closed-01'); set('Class','be-a-2026'); await add('Draw a cube.');
    audit.failures.listClasses=true; await home(); const before=count('createSet'); click('Create set');
    assert(count('createSet')===before,'Failed classes posted an open set');
    delete audit.failures.listClasses; const saved=audit.db.classes; audit.db.classes=[]; await home(); click('Create set');
    assert(count('createSet')===before,'Missing selected class posted an open set'); audit.db.classes=saved;
  });
  await test('Pending prompt and oversized Unicode hints are not silently dropped', async () => {
    await clearDraft(); set('Code','pending-01'); await add('Draw a cube.'); set('Prompt','Unadded question');
    const before=count('createSet'); click('Create set'); assert(count('createSet')===before,'Pending prompt dropped');
    set('Hint','🧑'.repeat(150)); click('Add question'); assert(homeForm().querySelectorAll('.lab-row').length===1,'Oversized hint accepted');
  });
  await test('Posting freezes draft, sends once and opens the created set', async () => {
    await clearDraft(); set('Code','posted-01'); set('Title','Posted title'); set('Class','be-a-2026'); await add('Draw a cube.');
    audit.delays.createSet=150; const before=count('createSet'); const create=click('Create set'); create.click();
    assert(create.disabled && input('Code').disabled && input('Prompt').disabled,'Draft not locked');
    await wait(250); assert(count('createSet')===before+1,'Duplicate create requests');
    assert(location.hash==='#set/posted-01' && document.body.textContent.includes('posted-01 — Posted title'),'Created set did not open');
    assert(audit.db.sets.find(s=>s.code==='posted-01').class_code==='be-a-2026','Class scope changed');
    assert(JSON.parse(sessionStorage.getItem('educad_teacher_draft_v1:teacher:__teacher_workflow_audit__')).questions.length===0,'Posted draft retained');
  });
  await test('Failed posting retains recoverable draft and unlocks controls', async () => {
    await clearDraft(); set('Code','retry-01'); await add('Keep this question.'); audit.failures.createSet=true; click('Create set'); await wait(70);
    assert(input('Code').value==='retry-01' && !input('Code').disabled,'Failed posting lost/locked metadata');
    assert(homeForm().textContent.includes('Keep this question.'),'Failed posting lost questions');
  });
  await test('Late set success and errors cannot overwrite another route', async () => {
    audit.delays.getSet=150; await route('#set/proj-01',10); await route('#class/be-a-2026',60); await wait(150);
    assert(!document.body.textContent.includes('Questions & model answers'),'Late set response replaced class page');
    audit.failures.getSet=true; await route('#set/proj-01',10); await route('#class/be-a-2026',60); await wait(150);
    assert(!document.getElementById('lab-flash').textContent,'Late error polluted active route');
  });
  await test('Grades save once in place and retain other teacher remarks', async () => {
    await route('#set/proj-01'); const gradeButtons=buttons('Grade'); gradeButtons[0].click(); gradeButtons[2].click();
    const forms=[...document.querySelectorAll('.lab-gradeform')];
    set('Verdict','pass',forms[0]); set('Remarks','Reviewed correctly',forms[0]); set('Remarks','Unsaved Casey remarks',forms[1]);
    audit.delays.gradeSubmission=100; const before=count('gradeSubmission'); const save=click('Save grade',forms[0]); save.click();
    await wait(160); assert(count('gradeSubmission')===before+1,'Duplicate grade requests');
    assert(document.querySelector('.lab-gradeform textarea').value==='Unsaved Casey remarks','Other grading draft lost');
    assert(document.body.textContent.includes('3 submissions · 1 need grading'),'Grading counts stale');
    assert(document.body.textContent.includes('Your remarks: Reviewed correctly'),'Saved remarks missing');
  });
  await test('Needs-grading filter updates live after grading', async () => {
    await route('#set/proj-01'); const show=input('Show',document.getElementById('lab-root')); show.value='ungraded'; show.dispatchEvent(new Event('change'));
    const visible=[...document.querySelectorAll('.lab-row:not([hidden])')].filter(row=>row.querySelector('.lab-grade-action'));
    assert(visible.length===1 && visible[0].textContent.includes('Casey'),'Ungraded filter incorrect');
    click('Grade',visible[0]); set('Verdict','fail',visible[0]); click('Save grade',visible[0]); await wait(50);
    assert(visible[0].hidden && document.body.textContent.includes('0 need grading'),'Queue not updated after grade');
  });
  await test('Model toggles preserve grading forms and duplicate clicks send once', async () => {
    await route('#set/proj-01'); buttons('Grade')[0].click(); const rem=document.querySelector('.lab-gradeform textarea'); rem.value='Keep me';
    audit.delays.setQuestionCheck=100; const before=count('setQuestionCheck'); const toggle=click('Auto-check: on — turn off'); toggle.click(); await wait(150);
    assert(count('setQuestionCheck')===before+1,'Duplicate toggle request'); assert(rem.isConnected && rem.value==='Keep me','Toggle discarded grading form');
    assert(buttons('Auto-check: off — turn on').length===1,'Toggle UI stale');
  });
  await test('Empty saved model refused and valid attachment preserves grading context', async () => {
    await route('#set/proj-01'); buttons('Grade')[0].click(); const form=document.querySelector('.lab-gradeform'); set('Remarks','Keep grading notes',form);
    const selects=[...document.querySelectorAll('select[aria-label="Saved drawing for model answer"]')]; const before=count('setQuestionModel');
    selects[1].value='2'; click('Attach model'); await wait(50); assert(count('setQuestionModel')===before,'Empty model attached');
    selects[1].value='1'; click('Attach model'); await wait(80);
    assert(count('setQuestionModel')===before+1,'Valid model not attached');
    assert(form.isConnected && form.querySelector('textarea').value==='Keep grading notes','Attachment reset grading context');
    assert(document.body.textContent.includes('2 model answers attached'),'Model summary stale');
  });
  await test('Upload rejects malformed rows atomically and supports retrying the same file', async () => {
    await clearDraft();
    async function upload(text, name) {
      const transfer = new DataTransfer(); transfer.items.add(new File([text],name,{type:'application/json'}));
      const file=homeForm().querySelector('input[type=file]'); file.files=transfer.files; file.dispatchEvent(new Event('change')); await wait(70);
      assert(file.value==='','File selection was not cleared for retry');
    }
    await upload(JSON.stringify([{prompt:'Valid question'}, {prompt:'Bad hint',hint:{bad:true}}]),'questions.json');
    assert(homeForm().querySelectorAll('.lab-row').length===0,'Partially imported invalid JSON');
    await upload(JSON.stringify([{prompt:'Valid question',hint:'Helpful hint'}]),'questions.json');
    assert(homeForm().querySelectorAll('.lab-row').length===1,'Could not retry valid JSON');
    await upload('question,hint','questions.csv');
    assert(homeForm().querySelectorAll('.lab-row').length===1,'Unsupported CSV silently parsed as a question');
  });
  await test('Oversized grading remarks retain text and never reach the API', async () => {
    await route('#set/proj-01'); buttons('Grade')[0].click(); const form=document.querySelector('.lab-gradeform');
    const oversized='🧑'.repeat(501); set('Remarks',oversized,form); const before=count('gradeSubmission'); click('Save grade',form);
    assert(count('gradeSubmission')===before && form.querySelector('textarea').value===oversized,'Remarks were truncated or posted');
  });
  await test('Replacing a model keeps the latest 3D-sharing choice', async () => {
    const q=audit.db.sets.find(s=>s.code==='proj-01').questions[0]; q.has_3d=true; q.show_3d=true;
    await route('#set/proj-01'); click('3D preview: on — turn off'); await wait(50);
    const row=[...document.querySelectorAll('.lab-row')].find(row=>row.textContent.includes('Q1: Draw the front'));
    row.querySelector('select').value='1'; click('Replace model',row); await wait(70);
    const call=audit.calls.filter(c=>c.name==='setQuestionModel').at(-1);
    assert(call.args[3].show_3d===false,'Attachment reset the current sharing choice');
  });
  await test('Navigating away during model lookup cancels attachment before mutation', async () => {
    await route('#set/proj-01'); const row=[...document.querySelectorAll('.lab-row')].find(row=>row.textContent.includes('Q1: Draw the front'));
    row.querySelector('select').value='1'; audit.delays.getDrawing=150; const before=count('setQuestionModel'); click('Replace model',row);
    await route('#class/be-a-2026'); await wait(150); assert(count('setQuestionModel')===before,'Stale drawing lookup mutated the model');
  });
  await test('Slow class lookup cannot expose a set as open', async () => {
    await clearDraft(); set('Code','slow-class'); set('Class','be-a-2026'); await add('One question');
    audit.delays.listClasses=150; await route('',10); const before=count('createSet'); click('Create set');
    assert(count('createSet')===before,'Posted before class access resolved'); await wait(170);
    assert(input('Class').value==='be-a-2026','Selected class lost during loading');
  });
  await test('Repeated model references resolve once per posted set', async () => {
    await clearDraft(); set('Code','shared-model'); set('Model','1'); await add('First question'); set('Model','1'); await add('Second question');
    const before=count('getDrawing'); click('Create set'); await wait(100);
    assert(count('getDrawing')===before+1,'Same saved model fetched repeatedly');
    assert(audit.db.sets.find(s=>s.code==='shared-model').questions.every(q=>q.model.entities.length),'Models missing from posted questions');
  });
  await test('A drawing list that resolves during failed posting remains usable', async () => {
    audit.delays.listDrawings=80; await clearDraft(); set('Code','busy-list'); await add('One question');
    audit.failures.createSet=true; audit.delays.createSet=150; click('Create set'); await wait(210);
    assert(!input('Model').disabled,'Finished drawing list stayed locked after posting failure');
    set('Model','1'); assert(!document.getElementById('lab-check-new').disabled,'Model flags not restored');
  });
  await test('Malformed route recovers to studio without exception', async () => {
    await route('#set/%E0%A4%A'); assert(document.getElementById('sec-newset'),'Invalid route crashed');
    assert(document.getElementById('lab-flash').textContent.includes('invalid'),'Invalid route has no explanation');
  });
  await clearDraft();
  return {passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results};
})();

// Run with T3 preview_evaluate on a disposable guest index.html?draw=1 sheet.
(async function () {
  const S=window.EduCADSaves, h=window.educadHandle;
  if (!h || S.currentSession().role!=='guest') throw new Error('Use a disposable guest sheet.');
  const methods=['currentSession','getSet','setQuestionModel','interpretWords'];
  const saved=Object.fromEntries(methods.map(k=>[k,S[k]])), sheet=S.snapshotTable(h.table), oldUrl=location.href;
  const home=document.getElementById('btn-home'), homeHref=home.href, homeTitle=home.title;
  const review=window.educadReviewModel, oldConfirm=window.confirm;
  const source=[...document.scripts].find(s=>s.textContent.includes('(function deepLink()')).textContent;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  const assert=(x,m)=>{if(!x)throw new Error(m);};
  const results=[]; let active={role:'teacher',username:'mock-teacher',token:'mock'}, requests=[], allow=true, fail=false, delay=0;
  let question={prompt:'Draw a triangle',has_model:false,show_3d:false};
  S.currentSession=()=>active;
  S.getSet=()=>new Promise(resolve=>setTimeout(()=>resolve({code:'review-01',questions:[question]}),delay));
  S.setQuestionModel=async (...args)=>{requests.push(args.slice(2));if(fail)throw new Error('Network request failed');question.has_model=true;question.model=args[4];return {ok:true};};
  S.interpretWords=async ()=>({commands:['/point a 0 10','/point b 30 10','/point c 15 35','/polygon a b c']});
  window.confirm=()=>allow;
  const button=()=>document.getElementById('btn-attach-reviewed-model');
  async function link(query){history.replaceState(null,'','?model=review-01&q=0'+query);(0,eval)(source);await wait(60);}
  async function test(name,fn){try{await fn();results.push({name,status:'PASS'});}catch(error){results.push({name,status:'FAIL',error:error.message});}}
  try {
    await test('Auto-draw produces a reviewed draft without automatically attaching it',async()=>{
      educadSetSheetMode('edit');educadReplaceSheet({entities:[]}); await link('&autodraw=1');
      assert(h.table.count()>0,'No drawing'); assert(requests.length===0,'Auto-draw auto-attached');
      assert(button()&&button().textContent==='Attach model to Q1','Missing contextual attach');
      assert(home.href.endsWith('teacher.html#set/review-01'),'Return link lost question set');
    });
    await test('Reviewed model attaches to the exact set and question once',async()=>{
      delay=80;button().click();button().click();await wait(130);
      assert(requests.length===1,'Duplicate attachments');
      assert(requests[0][0]==='review-01'&&requests[0][1]===0,'Wrong question attached');
      assert(requests[0][2].entities.length===h.table.count(),'Wrong snapshot');
      assert(requests[0][3].show_3d===false,'Sharing preference reset');
      delay=0;
    });
    await test('Empty drawing cannot replace a model',async()=>{
      educadReplaceSheet({entities:[]});const before=requests.length;button().click();await wait(20);
      assert(requests.length===before,'Empty model sent');assert(document.getElementById('save-status').textContent.includes('empty'),'Empty model not explained');
    });
    await test('Replacement cancellation preserves the previous model',async()=>{
      educadReplaceSheet(sheet.entities.length?sheet:question.model); allow=false;const before=requests.length;
      button().click();await wait(40);assert(requests.length===before,'Cancelled replacement sent');assert(!button().disabled,'Cancel left button disabled');allow=true;
    });
    await test('Failed attachment preserves the drawing and allows retry',async()=>{
      fail=true;const before=JSON.stringify(h.table.list());button().click();await wait(40);
      assert(JSON.stringify(h.table.list())===before,'Failure changed drawing');assert(!button().disabled,'Failure locked retry');
      assert(document.getElementById('save-status').textContent.includes('could not be attached'),'Failure missing');fail=false;
    });
    await test('Session changes during attachment preflight cancel the mutation',async()=>{
      delay=80;const before=requests.length;button().click();active={role:'student',token:'changed'};await wait(130);
      assert(requests.length===before,'Stale session attached model');active={role:'teacher',username:'mock-teacher',token:'mock'};delay=0;
    });
    await test('Mobile inspection cannot attach models',async()=>{
      const before=requests.length;document.body.classList.add('mobile-inspect');button().click();await wait(20);
      assert(requests.length===before,'Mobile write sent');document.body.classList.remove('mobile-inspect');
    });
    await test('Reviewing an existing model offers explicit attachment and preserves sharing settings',async()=>{
      question.has_model=true;await link('');assert(button(),'Existing model lacks attach action');
      button().click();await wait(40);assert(requests.at(-1)[3].show_3d===false,'Existing model reset preview sharing');
    });
    await test('Viewing a different question updates the attachment destination',async()=>{
      window.educadReviewModel({code:'different-set',questions:[{},{}]},1);
      assert(button().textContent==='Attach model to Q2','Attachment question not updated');
      assert(home.href.endsWith('teacher.html#set/different-set'),'Return set not updated');
    });
  } finally {
    methods.forEach(k=>S[k]=saved[k]);window.confirm=oldConfirm;window.educadReviewModel=review;
    document.body.classList.remove('mobile-inspect');
    if(button())button().remove();home.href=homeHref;home.title=homeTitle;
    history.replaceState(null,'',oldUrl);educadSetSheetMode('edit');educadReplaceSheet(sheet);
  }
  return {passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length,results};
})();

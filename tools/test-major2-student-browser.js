'use strict';
// Isolated browser fixtures: no live account or API mutation is used.
// Real classroom mutations are covered by test-major2-browser.js.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'major2-student-pages-'));
const chrome=spawn('/root/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell',['--no-sandbox','--disable-gpu','--remote-debugging-port=9354','--user-data-dir='+path.join(out,'profile'),'about:blank'],{stdio:'ignore'});
let ws,id=0;
const pending=new Map(),errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const rid=++id;const timer=setTimeout(()=>{pending.delete(rid);reject(Error('Timed out: '+method))},10000);pending.set(rid,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:err=>{clearTimeout(timer);reject(err)}});ws.send(JSON.stringify({id:rid,method,params}))});
const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
async function until(expression){for(let i=0;i<60;i++){if(await evaluate(expression))return;await delay(50)}throw Error('Not ready: '+expression)}
async function shot(name){const r=await rpc('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))}
(async()=>{
 try{
  let tabs;for(let i=0;i<60;i++){try{tabs=await(await fetch('http://127.0.0.1:9354/json')).json();break}catch{await delay(50)}}
  if(!tabs)throw Error('Chromium unavailable');
  ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.id){const p=pending.get(r.id);if(p){pending.delete(r.id);if(r.error)p.reject(Error(r.error.message));else p.resolve(r.result)}}else if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails.exception?.description||r.params.exceptionDetails.text)});
  await rpc('Page.enable');await rpc('Runtime.enable');
  await rpc('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await rpc('Page.navigate',{url:(process.env.MAJOR2_PREVIEW_URL||'https://mitasia.in/major2/')+'#/login/student'});
  await until("!!document.querySelector('.studio-shell')");

  const results=[];
  async function check(name,fn){await fn();results.push(name);console.log('PASS '+name)}
  async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)}
  async function values(selector,value){await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}))})()`)}
  async function submit(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`)}
  async function route(dest,ready){await evaluate(`if(location.hash!==${JSON.stringify('#/'+dest)})Major2.go(${JSON.stringify(dest)});else Major2.reload()`);await until(ready)}
  async function home(){await route('home',"!!document.querySelector('.student-focus')")}
  await evaluate(String.raw`(()=>{
    const now=Math.floor(Date.now()/1000),prism={entities:EduCADCurriculum.regularSolid({solid:'PRISM',sizeMm:45,heightMm:70}).entities};
    window.__studentFixture={
      classes:[{code:'graphics-1',title:'Engineering Graphics I',nsets:2},{code:'design-lab',title:'Design & Visualisation',nsets:2}],
      sets:[{code:'prism-views',title:'Prism projections',class_code:'graphics-1',class_title:'Engineering Graphics I',nquestions:3},{code:'plane-study',title:'A plane in space',class_code:'graphics-1',class_title:'Engineering Graphics I',nquestions:2},{code:'line-views',title:'Lines & their traces',class_code:'design-lab',class_title:'Design & Visualisation',nquestions:4},{code:'point-study',title:'Points in space',class_code:'design-lab',class_title:'Design & Visualisation',nquestions:1}],
      drawings:[{id:11,title:'Hexagonal prism',updated_at:now-200,data:prism},{id:12,title:'Construction study',updated_at:now-1500,data:prism}],
      submissions:[{id:41,set_code:'prism-views',question_index:0,verdict:'pass',remarks:'Good alignment of your two views.',created_at:now-1300},{id:42,set_code:'prism-views',question_index:1,verdict:'fail',remarks:'Align the front and top views before checking the height.',created_at:now-1000},{id:43,set_code:'plane-study',question_index:0,verdict:'',auto:{checked:true,pass:true},created_at:now-800},{id:44,set_code:'point-study',question_index:0,verdict:'pass',remarks:'Clear coordinates and labels.',created_at:now-1100}]
    };
    window.__studentApiCalls=[];window.__studentPreviewFlight=0;window.__studentPreviewPeak=0;window.__studentFailure=null;
    window.__studentApi=Major2.api;
    Major2.api=async(path,method='GET',body)=>{
      __studentApiCalls.push({path,method,body});const f=__studentFixture;
      if(method!=='GET')throw Error('This preview fixture does not write to the live API.');
      if(path===window.__studentFailure)throw Error('Connection unavailable.');
      if(window.__deferMetadata&&path==='sets')await new Promise(resolve=>window.__resumeMetadata=resolve);
      if(path==='classes')return {classes:f.classes};
      if(path==='sets')return {sets:f.sets};
      if(path==='drawings')return {drawings:f.drawings};
      if(path==='submissions/mine')return {submissions:f.submissions};
      if(path==='progress')return {progress:[]};
      if(/^classes\/.+\/sets$/.test(path))return {sets:f.sets.filter(set=>set.class_code===path.split('/')[1])};
      if(/^classes\/.+\/members$/.test(path))return {members:[]};
      if(/^sets\/.+\/submissions$/.test(path))return {submissions:[]};
      if(path.startsWith('classes/'))return f.classes.find(cls=>cls.code===path.split('/')[1]);
      if(path.startsWith('sets/')){const set=f.sets.find(set=>set.code===path.split('/')[1]);if(!set)throw Error('Unknown fixture set');return {...set,questions:Array.from({length:set.nquestions},(_,i)=>({prompt:i===0?'Draw the front and top views of a hexagonal prism, 45 mm base and 70 mm high.':'Construct drawing '+(i+1)+'. Include matching front and top views.',hint:i===0?'Align the corresponding points with projectors.':'',show_3d:i===0&&set.code==='prism-views',model3d:i===0&&set.code==='prism-views'?EduCADRef3d.buildPreview(prism.entities,EduCADReconstruct):undefined}))};}
      if(path.startsWith('submissions/')){const sub=f.submissions.find(sub=>String(sub.id)===path.split('/')[1]);return {...sub,data:prism};}
      if(path.startsWith('drawings/')){
        __studentPreviewFlight++;__studentPreviewPeak=Math.max(__studentPreviewPeak,__studentPreviewFlight);
        try{if(window.__deferPreviews)await new Promise(resolve=>(window.__previewResumes??=[]).push(resolve));else await new Promise(resolve=>setTimeout(resolve,35));return f.drawings.find(d=>String(d.id)===path.split('/')[1]);}finally{__studentPreviewFlight--;}
      }
      throw Error('Unexpected fixture API '+path+' '+method);
    };
    Major2.write('educad_session',{role:'student',username:'anaya-fixture',name:'Anaya Shah',token:'student-isolated-fixture'});
    window.__originalStudentData=JSON.parse(JSON.stringify(__studentFixture));
    Major2.applyTheme('warm');Major2.go('home');
  })()`);
  await until("!!document.querySelector('.student-focus')");
  await check('Every student destination shares navigation and the motion preference',async()=>{
    for(const [dest,ready,active]of [['assignments',"!!document.querySelector('#student-assignment-library')",'assignments'],['classes',"!!document.querySelector('#student-class-library')",'classes'],['drawings',"!!document.querySelector('#drawing-list')",'drawings'],['learn',"!!document.querySelector('.student-lesson-sheet')",'learn'],['review',"!!document.querySelector('#student-feedback-library')",'review']]){
      await route(dest,ready);assert.equal(await evaluate("document.querySelector('.student-nav [aria-current=page]').getAttribute('href')"),'#/'+active);assert.equal(await evaluate("document.querySelectorAll('.student-nav a').length"),6);
    }
    await click('[data-student-motion]');assert.equal(await evaluate("document.querySelector('.student-shell').dataset.motion"),'paused');await route('learn',"!!document.querySelector('.student-lesson-sheet')");assert.equal(await evaluate("getComputedStyle(document.querySelector('.student-lesson-art .study-projector')).animationName"),'none');
  });
  await check('Assignment search and filters use the latest attempt for each question',async()=>{
    await route('assignments',"!!document.querySelector('#student-assignment-library')");assert.equal(await evaluate("document.querySelector('.student-page-heading .student-primary').getAttribute('href')"),'#/solve/prism-views/1');assert.equal(await evaluate("document.querySelectorAll('[data-student-brief]').length"),4);assert.equal(await evaluate("document.querySelector('.student-brief progress').value"),2);
    await click('[data-student-filter=rework]');assert.equal(await evaluate("document.querySelectorAll('[data-student-brief]:not([hidden])').length"),1);
    await values('#student-assignment-search','no matching brief');assert.equal(await evaluate("document.querySelector('#student-assignment-no-results').hidden"),false);await click('[data-student-clear]');
    await values('#student-assignment-search','design-lab');assert.equal(await evaluate("document.querySelectorAll('[data-student-brief]:not([hidden])').length"),2);await values('#student-assignment-search','visualisation');assert.equal(await evaluate("document.querySelectorAll('[data-student-brief]:not([hidden])').length"),2);await click('[data-student-clear]');
    await evaluate("__studentFixture.submissions.unshift({id:45,set_code:'prism-views',question_index:1,verdict:'',auto:{checked:true,pass:true},created_at:Math.floor(Date.now()/1000)})");await route('assignments',"!!document.querySelector('#student-assignment-library')");await click('[data-student-filter=rework]');assert.equal(await evaluate("document.querySelectorAll('[data-student-brief]:not([hidden])').length"),0);await click('[data-student-filter=sent]');assert.equal(await evaluate("document.querySelectorAll('[data-student-brief]:not([hidden])').length"),2);
    await evaluate('__studentFixture=JSON.parse(JSON.stringify(__originalStudentData))');await route('assignments',"!!document.querySelector('#student-assignment-library')");await shot('student-assignments-desktop');
  });
  await check('Question actions, jump controls, hints and authorised 3D references remain usable',async()=>{
    await route('assignments/prism-views',"!!document.querySelector('.student-question-sheet')");assert.equal(await evaluate("document.querySelectorAll('.student-question-sheet').length"),3);assert.equal(await evaluate("document.querySelectorAll('[data-ref]').length"),1);assert.equal(await evaluate("document.querySelector('#question-2 .student-primary').getAttribute('href')"),'#/solve/prism-views/1');assert.equal(await evaluate("document.querySelector('#question-2 .student-primary').textContent.trim()"),'Rework drawing');
    await click('[data-student-question-target="3"]');assert.equal(await evaluate('location.hash'),'#/assignments/prism-views');assert.ok(await evaluate("document.querySelector('#question-3').getBoundingClientRect().top<innerHeight"));
    await click('.student-hint summary');assert.ok(await evaluate("document.querySelector('.student-hint').open"));await click('.student-question-reference summary');await until("document.querySelector('[data-ref] canvas')?.getBoundingClientRect().width>100");await click('[data-action=rotate-ref-0]');await shot('student-brief-reference');
    await evaluate("Major2.write('educad_major2_draft_'+Major2.accountKey()+'/solve/prism-views/2',{data:__studentFixture.drawings[0].data,updatedAt:Date.now()})");await route('assignments/prism-views',"!!document.querySelector('.student-question-sheet')");assert.equal(await evaluate("document.querySelector('#question-3 .student-primary').textContent.trim()"),'Continue draft');await evaluate("Major2.remove('educad_major2_draft_'+Major2.accountKey()+'/solve/prism-views/2')");
    await click('#question-2 .student-primary');await until("!!document.querySelector('.student-drawing-desk')");assert.equal(await evaluate('location.hash'),'#/solve/prism-views/1');assert.equal(await evaluate("document.querySelector('[data-action=submit]').disabled"),false);
  });
  await check('Class search, class briefs, join validation and leave cancellation retain their workflows',async()=>{
    await route('classes',"!!document.querySelector('#student-class-library')");await values('#student-class-search','graphics-1');assert.equal(await evaluate("document.querySelectorAll('[data-student-class]:not([hidden])').length"),1);await click('[data-student-class]:not([hidden])');await until("!!document.querySelector('.student-class-controls')");assert.equal(await evaluate("document.querySelectorAll('.student-brief').length"),2);
    await click('[data-action=remove-class]');await until("!!document.querySelector('dialog[open]')");await click('dialog [data-cancel]');assert.equal(await evaluate("__studentApiCalls.some(call=>call.method==='POST'&&call.path.endsWith('/leave'))"),false);
    await route('classes/join',"!!document.querySelector('#class-form')");await values('[name=code]','bad code');await submit('#class-form');await until("!document.querySelector('#class-form .form-error').hidden");assert.equal(await evaluate("__studentApiCalls.some(call=>call.method==='POST'&&call.path.endsWith('/join'))"),false);
  });
  await check('Saved drawings load actual previews, filter, retry errors and stay openable',async()=>{
    await route('drawings',"!!document.querySelector('#drawing-search')");await until("document.querySelector('[data-thumb="+'"11"'+"]')?.dataset.state==='ready'");assert.ok(await evaluate("!!document.querySelector('.drawing-thumb svg path')"));
    await values('#drawing-search','nothing');assert.equal(await evaluate("document.querySelector('#no-search-results').hidden"),false);await click('[data-student-clear]');await shot('student-drawings-desktop');
    await evaluate("__studentFailure='drawings/11'");await route('drawings',"!!document.querySelector('#drawing-search')");await until("document.querySelector('[data-thumb="+'"11"'+"]')?.dataset.state==='error'");assert.equal(await evaluate("document.querySelector('[data-drawing-id="+'"11"'+"] a').getAttribute('href')"),'#/drawings/11');await evaluate('__studentFailure=null');await click('[data-drawing-id="11"] [data-thumb-retry]');await until("document.querySelector('[data-thumb="+'"11"'+"]')?.dataset.state==='ready'");
    await click('[data-action=delete-drawing]');await until("!!document.querySelector('dialog[open]')");await click('dialog [data-cancel]');assert.equal(await evaluate("__studentApiCalls.some(call=>call.method==='DELETE')"),false);
    await click('[data-drawing-id="11"] a');await until("!!document.querySelector('.student-drawing-desk')");assert.ok(await evaluate('Major2.desk.table.count()>10'));
  });
  await check('Feedback preserves attempt history and separates automatic checks from teacher review',async()=>{
    await evaluate("__studentFixture.submissions.unshift({id:45,set_code:'prism-views',question_index:1,verdict:'',auto:{checked:true,pass:true},created_at:Math.floor(Date.now()/1000)})");await route('review',"!!document.querySelector('#student-feedback-library')");assert.equal(await evaluate("document.querySelectorAll('[data-student-review]').length"),5);assert.equal(await evaluate("document.querySelectorAll('.student-older-attempt').length"),1);await click('[data-student-filter=rework]');assert.equal(await evaluate("document.querySelectorAll('[data-student-review]:not([hidden])').length"),1);assert.equal(await evaluate("document.querySelector('[data-student-review].rework .student-primary')"),null);
    await click('[data-student-filter=sent]');assert.equal(await evaluate("document.querySelectorAll('[data-student-review]:not([hidden])').length"),2);assert.ok(await evaluate("document.querySelector('[data-student-review]:not([hidden])').innerText.includes('awaiting review')"));assert.ok(await evaluate("document.querySelector('[data-student-review]:not([hidden])').innerText.includes('Automatic check: Matched')"));
    await evaluate('__studentFixture=JSON.parse(JSON.stringify(__originalStudentData))');await route('review',"!!document.querySelector('#student-feedback-library')");await shot('student-feedback-desktop');await click('.student-review-sheet.rework .student-review-title');await until("!!document.querySelector('#review-panel .review-form')");assert.ok(await evaluate("document.querySelector('#review-panel').compareDocumentPosition(document.querySelector('.step-box'))&Node.DOCUMENT_POSITION_FOLLOWING"));assert.equal(await evaluate("document.querySelector('[data-tool=line]').disabled"),true);assert.equal(await evaluate("document.querySelector('[data-action=save]')"),null);assert.ok(await evaluate("document.querySelector('#review-panel').innerText.includes('Align the front and top views')"));
  });
  await check('Practice reflects real completion and leaves the drawing paper and tools working',async()=>{
    await route('learn',"!!document.querySelector('.student-lesson-sheet')");assert.equal(await evaluate("document.querySelectorAll('.student-lesson-sheet').length"),4);assert.equal(await evaluate("document.querySelectorAll('.student-lesson-done').length"),0);await shot('student-practice-desktop');await click('.student-lesson-sheet');await until("!!document.querySelector('#lesson-panel')");assert.equal(await evaluate("document.querySelector('[data-action=lesson-next]').disabled"),true);
    await values('#point-form [name=x]','0');await values('#point-form [name=y]','30');await values('#point-form [name=caption]',"p'");await submit('#point-form');await until("!document.querySelector('[data-action=lesson-next]').disabled");await click('[data-action=undo]');assert.equal(await evaluate('Major2.desk.table.count()'),0);await click('[data-action=redo]');assert.equal(await evaluate('Major2.desk.table.count()'),1);await shot('student-drawing-desk');
    assert.equal(await evaluate("document.querySelector('.student-drawing-desk').dataset.motion"),'paused');await route('learn',"!!document.querySelector('.student-lesson-sheet')");await click('[data-student-motion]');assert.equal(await evaluate("document.querySelector('.student-shell').dataset.motion"),'playing');await rpc('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await route('learn/solid',"!!document.querySelector('.student-drawing-desk')");assert.equal(await evaluate("document.querySelector('.student-drawing-desk').dataset.motion"),'paused');await rpc('Emulation.setEmulatedMedia',{features:[]});await evaluate("Major2.remove('educad_major2_draft_'+Major2.accountKey()+'/lesson/points')");
  });
  await check('Empty accounts, missing data and failed pages show honest actions and recovery',async()=>{
    await evaluate('__studentFixture={classes:[],sets:[],drawings:[],submissions:[]}');
    for(const dest of ['assignments','classes','drawings','review']){await route(dest,"!!document.querySelector('.student-empty-sheet')");assert.equal(await evaluate("document.querySelectorAll('.student-empty-sheet .student-primary').length"),1)}
    await route('assignments',"!!document.querySelector('.student-empty-sheet')");await click('[data-student-action=open-code]');await until("!!document.querySelector('dialog[open]')");await values('dialog [name=code]','  prism-views  ');await evaluate('__studentFixture=JSON.parse(JSON.stringify(__originalStudentData))');await submit('dialog form');await until("!!document.querySelector('.student-question-sheet')");assert.equal(await evaluate('location.hash'),'#/assignments/prism-views');
    await evaluate("__studentFailure='sets'");await route('assignments',"!!document.querySelector('[data-action=retry]')");assert.ok(await evaluate("!!document.querySelector('.student-shell')"));await evaluate('__studentFailure=null');await click('[data-action=retry]');await until("!!document.querySelector('#student-assignment-library')");
    await evaluate("__studentFailure='sets/prism-views'");await route('solve/prism-views/1',"!!document.querySelector('[data-action=retry]')");assert.ok(await evaluate("!!document.querySelector('.student-shell')"));await evaluate('__studentFailure=null');await click('[data-action=retry]');await until("!!document.querySelector('.student-drawing-desk')");
  });
  await check('Six themes across all student pages fit desktop, tablet and small phones',async()=>{
    let layouts=0;
    const pages=[['home','.student-focus'],['assignments','#student-assignment-library'],['assignments/prism-views','.student-question-sheet'],['classes','#student-class-library'],['classes/graphics-1','.student-class-controls'],['classes/join','#class-form'],['drawings','#drawing-search'],['learn','.student-lesson-sheet'],['review','#student-feedback-library'],['draw/new','.student-drawing-desk'],['solve/prism-views/1','.student-drawing-desk'],['learn/solid','#lesson-panel'],['review/42','#review-panel .review-form']];
    for(const width of [1280,980,760,390,320]){await rpc('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:false});for(const theme of ['warm','blueprint','forest','lilac','midnight','sunlit']){await evaluate(`Major2.applyTheme(${JSON.stringify(theme)})`);for(const [dest,ready]of pages){await route(dest,`!!document.querySelector(${JSON.stringify(ready)})`);await delay(20);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false,dest+' '+theme+' '+width);assert.equal(await evaluate("[...document.querySelectorAll('.student-nav a, .student-primary, .student-filters button, .student-search, .student-question-cell, .student-drawing-desk .desk-footer .button')].filter(el=>el.getBoundingClientRect().height>0).every(el=>el.getBoundingClientRect().height>=44)"),true,'Touch targets: '+dest+' '+width);if(await evaluate("!!document.querySelector('.student-drawing-desk')"))assert.ok(await evaluate("document.querySelector('.paper-area canvas').getBoundingClientRect().height>200"),'Drawing paper: '+dest+' '+width);layouts++;}}}
    results.push('Checked '+layouts+' layouts');console.log('Checked '+layouts+' layouts');await evaluate("Major2.applyTheme('warm')");await rpc('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});for(const [dest,ready]of pages.slice(1,9)){await route(dest,`!!document.querySelector(${JSON.stringify(ready)})`);await shot('student-'+dest.replaceAll('/','-')+'-mobile');}
  });
  await check('Escaped names, slow previews and navigation cannot leak into another screen',async()=>{
    await rpc('Emulation.setDeviceMetricsOverride',{width:1280,height:844,deviceScaleFactor:1,mobile:false});
    await evaluate("__studentFixture.drawings=Array.from({length:18},(_,i)=>({...__studentFixture.drawings[0],id:11+i,title:i===0?'<img src=x onerror=alert(1)> '+'Long title '.repeat(30):'Construction study '+i}));__studentPreviewPeak=0;__studentFixture.classes[0].title='<script>bad</script>';__deferPreviews=true");await route('drawings',"!!document.querySelector('#drawing-search')");await until('__studentPreviewFlight===4');await delay(80);assert.equal(await evaluate('__studentPreviewPeak'),4);assert.equal(await evaluate("document.querySelectorAll('.student-main img').length"),0);await route('classes',"!!document.querySelector('#student-class-library')");const before=await evaluate("document.querySelector('.student-main').innerHTML");await evaluate("__deferPreviews=false;(__previewResumes||[]).forEach(resume=>resume());__previewResumes=[]");await delay(100);assert.equal(await evaluate("document.querySelector('.student-main').innerHTML"),before);assert.equal(await evaluate("document.querySelectorAll('.student-main script').length"),0);await evaluate('__studentFixture=JSON.parse(JSON.stringify(__originalStudentData))');
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));console.log('Artifacts: '+out);
 }catch(error){console.error(error.stack);try{await shot('failure');fs.writeFileSync(path.join(out,'failure.txt'),await evaluate('document.body.innerText'))}catch{}console.error('Artifacts: '+out);process.exitCode=1}
 finally{ws?.close();chrome.kill('SIGTERM')}
})();

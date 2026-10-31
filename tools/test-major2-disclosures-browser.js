'use strict';
// Isolated browser fixtures: no live account or API mutation is used.
// Real classroom mutations are covered by test-major2-browser.js.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'major2-canvas-'));
const chrome=spawn(process.env.MAJOR2_CHROMIUM||path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'),['--no-sandbox','--disable-gpu','--remote-debugging-port=9360','--user-data-dir='+path.join(out,'profile'),'about:blank'],{stdio:'ignore'});
let ws,id=0;
const pending=new Map(),errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const rid=++id;const timer=setTimeout(()=>{pending.delete(rid);reject(Error('Timed out: '+method))},10000);pending.set(rid,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:err=>{clearTimeout(timer);reject(err)}});ws.send(JSON.stringify({id:rid,method,params}))});
const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
async function until(expression){for(let i=0;i<60;i++){if(await evaluate(expression))return;await delay(50)}throw Error('Not ready: '+expression)}
async function shot(name){const r=await rpc('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))}
(async()=>{
 try{
  let tabs;for(let i=0;i<60;i++){try{tabs=await(await fetch('http://127.0.0.1:9360/json')).json();break}catch{await delay(50)}}
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
    const now=Math.floor(Date.now()/1000),fixtureTable=EduCADEntities.createTable();
    // Saved API drawings have stable entity IDs, unlike raw curriculum recipes.
    EduCADSaves.restoreTable(EduCADEntities,fixtureTable,{entities:EduCADCurriculum.regularSolid({solid:'PRISM',sizeMm:45,heightMm:70}).entities});
    const prism=EduCADSaves.snapshotTable(fixtureTable);
    window.__studentFixture={
      classes:[{code:'graphics-1',title:'Engineering Graphics I',nsets:2},{code:'design-lab',title:'Design & Visualisation',nsets:2}],
      sets:[{code:'prism-views',title:'Prism projections',class_code:'graphics-1',class_title:'Engineering Graphics I',nquestions:3},{code:'plane-study',title:'A plane in space',class_code:'graphics-1',class_title:'Engineering Graphics I',nquestions:2},{code:'line-views',title:'Lines & their traces',class_code:'design-lab',class_title:'Design & Visualisation',nquestions:4},{code:'point-study',title:'Points in space',class_code:'design-lab',class_title:'Design & Visualisation',nquestions:1}],
      drawings:[{id:11,title:'Hexagonal prism',updated_at:now-200,data:prism},{id:12,title:'Construction study',updated_at:now-1500,data:prism}],
      submissions:[{id:41,set_code:'prism-views',question_index:0,verdict:'pass',remarks:'Good alignment of your two views.',created_at:now-1300},{id:42,set_code:'prism-views',question_index:1,verdict:'fail',remarks:'Align the front and top views before checking the height.',created_at:now-1000},{id:43,set_code:'plane-study',question_index:0,verdict:'',auto:{checked:true,pass:true},created_at:now-800},{id:44,set_code:'point-study',question_index:0,verdict:'pass',remarks:'Clear coordinates and labels.',created_at:now-1100}]
    };
    window.__studentApiCalls=[];window.__studentPreviewFlight=0;window.__studentPreviewPeak=0;window.__studentFailure=null;
    window.__studentApi=Major2.api;
    window.__canvasMountSolid=Major2.solid;Major2.solid=(host,...args)=>{const widget=__canvasMountSolid(host,...args);if(host.id==='desk-solid')window.__canvasModel=widget;return widget;};
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
        try{if(window.__deferPreviews)await new Promise(resolve=>(window.__previewResumes??=[]).push(resolve));else await new Promise(resolve=>setTimeout(resolve,35));return JSON.parse(JSON.stringify(f.drawings.find(d=>String(d.id)===path.split('/')[1])));}finally{__studentPreviewFlight--;}
      }
      throw Error('Unexpected fixture API '+path+' '+method);
    };
    Major2.write('educad_session',{role:'student',username:'anaya-fixture',name:'Anaya Shah',token:'student-isolated-fixture'});
    window.__originalStudentData=JSON.parse(JSON.stringify(__studentFixture));
    Major2.applyTheme('warm');Major2.go('home');
  })()`);
  await until("!!document.querySelector('.student-focus')");
  async function draw(dest='draw/new'){await route(dest,"!!document.querySelector('.student-canvas')");await delay(50)}
  async function change(name,value){await evaluate(`(()=>{const field=document.querySelector('dialog[open] [name='+${JSON.stringify(name)}+']');if(field.type==='checkbox')field.checked=${JSON.stringify(value)};else field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(50)}
  async function settings(){await click('[data-canvas-customize]');await until("!!document.querySelector('.student-canvas-dialog[open]')")}
  async function savePrefs(){await submit('.student-canvas-dialog form');await until("!document.querySelector('dialog[open]')");await delay(60)}
  async function reset(){await settings();await click('[data-canvas-reset]');await savePrefs()}
  async function world(x,y){await delay(80);const p=await evaluate(`(()=>{const v=Major2.desk.view(),r=document.querySelector('.paper-area canvas').getBoundingClientRect();return{x:r.left+(${x})*v.s+v.tx,y:r.top+v.ty-(${y})*v.s}})()`);await rpc('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});await delay(80)}
  async function commands(value){await values('#command-form [name=commands]',value);await submit('#command-form');await until("document.querySelector('#command-form .form-error').hidden");await delay(70)}
  await check('A new drawing starts with optional panels collapsed',async()=>{
    await draw();
    assert.equal(await evaluate("document.querySelector('.desk-guide').hidden"),true);
    assert.equal(await evaluate("document.querySelector('.student-spatial-dock').hidden"),true);
    assert.equal(await evaluate("document.querySelector('.desk-precision-menu').open"),false);
    assert.equal(await evaluate("document.querySelector('.desk-view-menu').open"),false);
    assert.equal(await evaluate("document.querySelector('#tool-instruction').checkVisibility()"),true);
    assert.equal(await evaluate("document.querySelector('#point-form').checkVisibility()"),false);
    await shot('collapsed-drawing-desktop');
  });
  await check('Blank-sheet guidance and floating menus preserve drawing flow',async()=>{
    assert.equal(await evaluate("document.querySelector('.desk-starter').checkVisibility()"),true);
    await click('[data-action=start-point]');
    assert.equal(await evaluate("document.activeElement===document.querySelector('.paper-area canvas')"),true);
    assert.equal(await evaluate("document.querySelector('.desk-starter').hidden"),true);
    await click('[data-tool=line]');await world(0,30);
    const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');
    const bounds=await evaluate("JSON.stringify(document.querySelector('.paper-area').getBoundingClientRect().toJSON())");
    await click('.desk-view-menu > summary');await delay(80);
    assert.equal(await evaluate("JSON.stringify(document.querySelector('.paper-area').getBoundingClientRect().toJSON())"),bounds);
    await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    assert.equal(await evaluate("document.querySelector('.desk-view-menu').open"),false);
    assert.equal(await evaluate("document.querySelector('[data-action=cancel]').hidden"),false);
    assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);
    await click('[data-action=cancel]');await click('[data-tool=point]');
    await click('[data-action=start-coordinates]');
    assert.equal(await evaluate("document.activeElement===document.querySelector('#point-form [name=x]')"),true);
    await click('[data-action=show-tool-options]');
  });
  await check('Coordinates open on demand and placing points does not expose property forms',async()=>{
    await click('[data-action=show-tool-options]');
    assert.equal(await evaluate("document.querySelector('#point-form').checkVisibility()"),true);
    await values('#point-form [name=x]',0);await values('#point-form [name=y]',30);await submit('#point-form');
    await until('Major2.desk.table.count()===1');
    assert.equal(await evaluate("document.querySelector('#properties').checkVisibility()"),false);
    await click('[data-action=show-tool-options]');
    assert.equal(await evaluate("document.querySelector('#point-form').checkVisibility()"),false);
    await click('[data-action=toggle-guide]');
  });
  await check('Exact length and radius follow the active drawing step and cancel without edits',async()=>{
    await click('[data-tool=line]');await world(0,30);
    assert.equal(await evaluate("document.querySelector('[data-action=show-tool-options]').textContent"),'Exact length');
    assert.equal(await evaluate("document.querySelector('#length-form').checkVisibility()"),false);
    await click('[data-action=show-tool-options]');await values('#length-form [name=length]',40);await submit('#length-form');
    await until("Major2.desk.table.list().some(e=>e.type==='SEGMENT')");
    await click('[data-tool=circle]');await world(0,30);await click('[data-action=show-tool-options]');
    assert.equal(await evaluate("document.querySelector('#radius-form').checkVisibility()"),true);
    const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');await click('[data-action=cancel]');
    assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);
    assert.equal(await evaluate("document.querySelector('[data-action=show-tool-options]').hidden"),true);
  });
  await check('Selecting opens collapsible properties; inspection hides drawing tools',async()=>{
    await click('[data-action=toggle-guide]');await click('[data-tool=select]');await world(0,30);
    assert.equal(await evaluate("document.querySelector('#properties-form').checkVisibility()"),true);
    await click('[data-action=show-properties]');assert.equal(await evaluate("document.querySelector('#properties-form').checkVisibility()"),false);
    await click('[data-mode=inspect]');
    assert.equal(await evaluate("document.querySelector('[data-tool=point]').hidden"),true);
    assert.equal(await evaluate("document.querySelector('[data-tool=measure]').checkVisibility()"),true);
    await click('[data-mode=draw]');assert.equal(await evaluate("document.querySelector('[data-tool=point]').hidden"),false);
  });
  await check('Precision, view and 3D controls remain reachable without changing geometry',async()=>{
    const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');
    await click('.desk-precision-menu > summary');assert.equal(await evaluate("document.querySelector('[data-action=quick-snap]').checkVisibility()"),true);await click('[data-action=quick-snap]');await click('[data-action=quick-grid]');
    assert.equal(await evaluate('Major2.canvasPreferences.read().snap'),true);
    await click('.desk-precision-menu > summary');await click('.desk-view-menu > summary');assert.equal(await evaluate("document.querySelector('[data-action=zoom-in]').checkVisibility()"),true);await click('[data-action=zoom-in]');await click('.desk-view-menu > summary');
    await click('[data-canvas-spatial]');assert.equal(await evaluate("document.querySelector('#solid-panel').checkVisibility()"),true);
    await click('[data-canvas-spatial]');assert.equal(await evaluate("document.querySelector('#solid-panel').checkVisibility()"),false);
    assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);
  });
  await check('Questions, teacher reference, review and practice are accessible',async()=>{
    await draw('solve/prism-views/0');
    await click('[data-action=show-question]');assert.equal(await evaluate("document.querySelector('#task-panel .prompt').checkVisibility()"),true);
    await click('[data-action=show-question]');assert.equal(await evaluate("document.querySelector('#task-panel .prompt').checkVisibility()"),false);
    await click('[data-canvas-spatial]');await click('[name=show-reference]');await until("Major2.desk.spatial().source==='teacher'");
    await draw('review/42');assert.equal(await evaluate("document.querySelector('#review-panel').checkVisibility()"),true);
    assert.equal(await evaluate("document.querySelector('#task-panel').checkVisibility()"),true);
    await draw('learn/solid');assert.equal(await evaluate("document.querySelector('#solid-panel').checkVisibility()"),true);
    assert.equal(await evaluate("document.querySelector('#lesson-panel').checkVisibility()"),true);
  });
  await check('Collapsed and expanded desks fit desktop and mobile layouts',async()=>{
    await evaluate("Major2.canvasPreferences.write({...Major2.canvasPreferences.defaults})");await draw('drawings/11');
    for(const [width,height]of [[1280,800],[980,720],[760,844],[390,844],[320,740]]){
      await rpc('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      for(const theme of ['warm','midnight']){
        await evaluate(`Major2.applyTheme(${JSON.stringify(theme)})`);
        for(const expanded of [true,false]){
          await click('[data-action=toggle-guide]');await delay(60);
          assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);
          assert.ok(await evaluate("document.querySelector('.paper-area').getBoundingClientRect().width")>=200);
          assert.equal(await evaluate("document.querySelector('#tool-instruction').checkVisibility()"),true);
        }
      }
    }
    await rpc('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await evaluate("Major2.applyTheme('warm')");await delay(4500);await shot('collapsed-drawing-desktop');
    await rpc('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await shot('collapsed-drawing-mobile');
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));console.log('Artifacts: '+out);
 }catch(error){console.error(error.stack);try{await shot('failure');fs.writeFileSync(path.join(out,'failure.txt'),await evaluate('document.body.innerText'))}catch{}console.error('Artifacts: '+out);process.exitCode=1}
 finally{ws?.close();chrome.kill('SIGTERM')}
})();

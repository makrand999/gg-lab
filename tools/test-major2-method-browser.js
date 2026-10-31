'use strict';
// Isolated browser fixtures: no live account or API mutation is used.
// Real classroom mutations are covered by test-major2-browser.js.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'major2-methods-'));
const chrome=spawn(process.env.MAJOR2_CHROMIUM||path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'),['--no-sandbox','--disable-gpu','--remote-debugging-port=9361','--user-data-dir='+path.join(out,'profile'),'about:blank'],{stdio:'ignore'});
let ws,id=0;
const pending=new Map(),errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const rid=++id;const timer=setTimeout(()=>{pending.delete(rid);reject(Error('Timed out: '+method))},10000);pending.set(rid,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:err=>{clearTimeout(timer);reject(err)}});ws.send(JSON.stringify({id:rid,method,params}))});
const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
async function until(expression){for(let i=0;i<60;i++){if(await evaluate(expression))return;await delay(50)}throw Error('Not ready: '+expression)}
async function shot(name){const r=await rpc('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))}
(async()=>{
 try{
  let tabs;for(let i=0;i<60;i++){try{tabs=await(await fetch('http://127.0.0.1:9361/json')).json();break}catch{await delay(50)}}
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
    Major2.write('educad_session',{role:'student',username:'method-fixture',name:'Anaya Shah',token:'student-isolated-fixture'});
    window.__originalStudentData=JSON.parse(JSON.stringify(__studentFixture));
    Major2.applyTheme('warm');Major2.go('home');
  })()`);
  await until("!!document.querySelector('.student-focus')");
  async function draw(dest='draw/new'){await route(dest,"!!document.querySelector('.student-canvas')");await delay(50)}
  async function change(name,value){await evaluate(`(()=>{const field=document.querySelector('dialog[open] [name='+${JSON.stringify(name)}+']');if(field.type==='checkbox')field.checked=${JSON.stringify(value)};else field.value=${JSON.stringify(value)};field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}))})()`);await delay(50)}
  async function settings(){await click('[data-canvas-customize]');await until("!!document.querySelector('.student-canvas-dialog[open]')")}
  async function savePrefs(){await submit('.student-canvas-dialog form');await until("!document.querySelector('dialog[open]')");await delay(60)}
  async function reset(){await settings();await click('[data-canvas-reset]');await savePrefs()}
  async function world(x,y,modifiers=0,count=1){const p=await evaluate(`(()=>{const v=Major2.desk.view(),r=document.querySelector('.paper-area canvas').getBoundingClientRect();return{x:r.left+(${x})*v.s+v.tx,y:r.top+v.ty-(${y})*v.s}})()`);await rpc('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:count,modifiers});await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:count,modifiers});await delay(80)}
  async function commands(value){await values('#command-form [name=commands]',value);await submit('#command-form');await until("document.querySelector('#command-form .form-error').hidden");await delay(70)}

  async function key(key,modifiers=0){await rpc('Input.dispatchKeyEvent',{type:'keyDown',key,modifiers,text:key==='Enter'?'\r':!modifiers&&key.length===1?key:undefined,windowsVirtualKeyCode:key==='Enter'?13:key==='Escape'?27:key==='Tab'?9:undefined});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key,modifiers});await delay(60)}
  async function method(value,save=true){await settings();await change('drawingMode',value);if(save)await savePrefs();}
  async function move(x,y){const p=await evaluate(`(()=>{const v=Major2.desk.view(),r=document.querySelector('.paper-area canvas').getBoundingClientRect();return{x:r.left+(${x})*v.s+v.tx,y:r.top+v.ty-(${y})*v.s}})()`);await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});await delay(50)}
  const ink=()=>evaluate('JSON.stringify(Major2.desk.snapshot().entities)');
  await draw();
  await check('Draw menu is the default and invalid method preferences are rejected',async()=>{
    assert.equal(await evaluate('Major2.desk.presentation().drawingMode'),'menu');assert.equal(await evaluate("Major2.canvasPreferences.normalize({drawingMode:'unsupported'}).drawingMode"),'menu');assert.equal(await evaluate("document.querySelector('[data-canvas-method]').innerText"),'Draw menu ▾');
    await click('[data-tool=select]');await world(-60,60);assert.equal(await evaluate('Major2.desk.table.count()'),0);
  });
  await check('Preview and Cancel retain an active menu line; saving a method switch cancels only unfinished input',async()=>{
    await click('[data-tool=line]');await world(-50,50);const before=await ink();await method('shortcuts',false);assert.equal(await evaluate('Major2.desk.presentation().drawingMode'),'menu');await click('[data-canvas-cancel]');assert.ok(await evaluate("document.querySelector('#tool-instruction').innerText.includes('second point')"));assert.equal(await ink(),before);
    await method('shortcuts');assert.equal(await ink(),before);assert.equal(await evaluate('Major2.desk.presentation().drawingMode'),'shortcuts');assert.equal(await evaluate("document.querySelector('[data-tool=line]').hidden"),true);assert.ok(await evaluate("document.querySelector('#tool-title').innerText==='Shortcuts'"));
  });
  await check('Native plain shortcut clicks place points without choosing a tool',async()=>{
    await world(-60,60);await world(0,60);await world(-60,20);assert.equal(await evaluate("Major2.desk.table.findByType('POINT').length"),3);assert.equal(await evaluate("Major2.desk.table.findByType('SEGMENT').length"),0);
  });
  await check('Ctrl-click banks a point; the second point previews a line and commits its chosen style',async()=>{
    const before=await ink();await world(-60,60,2);await world(0,60);assert.equal(await ink(),before);assert.equal(await evaluate("document.querySelector('[data-shortcut-style=A]').innerText"),'Visible');await click('[data-shortcut-style=E]');assert.equal(await evaluate("Major2.desk.table.findByType('SEGMENT')[0].bisCode"),'E');assert.equal(await evaluate("Major2.desk.table.findByType('POINT').length"),3);
  });
  await check('Native shortcut undo and redo preserve geometry and dependencies',async()=>{
    const before=await ink();await evaluate("document.querySelector('.paper-area canvas').focus()");await key('z',2);assert.equal(await evaluate("Major2.desk.table.findByType('SEGMENT').length"),0);await key('z',10);assert.equal(await ink(),before);
  });
  await check('Two banked points and a third create the original three-point circle',async()=>{
    await world(-60,60,2);await world(0,60,2);await world(-60,20);const c=await evaluate("Major2.desk.table.findByType('CIRCLE')[0]");assert.ok(Math.abs(c.x+30)<1e-4);assert.ok(Math.abs(c.y-40)<1e-4);assert.ok(Math.abs(c.radius-Math.sqrt(1300))<1e-4);
  });
  await check('Double-click renaming is editable, undoable and has a safe Escape path',async()=>{
    await world(0,60,0,2);await until("!!document.querySelector('.student-shortcut-rename')");await values('.student-shortcut-rename input','p');await key('Enter');await until("Major2.desk.table.findByType('POINT').some(p=>p.caption==='p')");const before=await ink();await world(0,60,0,2);await values('.student-shortcut-rename input','cancelled');await key('Escape');assert.equal(await ink(),before);assert.equal(await evaluate("!!document.querySelector('.student-shortcut-rename')"),false);
  });
  await check('Aim, type a distance and Enter places an exact axis projection; invalid input does not mutate work',async()=>{
    await world(-60,20);await move(-60,-10);await key('3');await key('0');await key('Enter');assert.ok(await evaluate("Major2.desk.table.findByType('POINT').some(p=>Math.abs(p.x+60)<1e-4&&Math.abs(p.y+10)<1e-4)"));const before=await ink();await key('0');await key('Enter');assert.equal(await ink(),before);await key('Escape');assert.equal(await evaluate("document.querySelector('.student-shortcut-hud').hidden"),true);
  });
  await check('Ctrl/Cmd banks toggle, Escape cancels, and method switching preserves committed entities',async()=>{
    const before=await ink();await world(-60,60,4);assert.ok(await evaluate("document.querySelector('.student-shortcut-hud').innerText.includes('1 / 2')"));await world(-60,60,4);assert.equal(await evaluate("document.querySelector('.student-shortcut-hud').hidden"),true);await world(-60,60,2);await key('Escape');assert.equal(await ink(),before);
    await world(-60,60,2);await method('menu');assert.equal(await ink(),before);await world(10,80);assert.equal(await ink(),before);assert.equal(await evaluate("document.querySelector('[data-tool=line]').hidden"),false);
  });
  await check('Slash opens commands from Focus and text fields keep their own keyboard input',async()=>{
    await method('shortcuts');await click('.student-focus-toggle');await world(-60,20);const before=await ink();await key('/');assert.equal(await evaluate("document.querySelector('.student-canvas').dataset.canvasFocus"),'false');assert.equal(await evaluate("document.activeElement.name"),'commands');await key('3');await key('0');await key('Tab');assert.equal(await ink(),before);assert.equal(await evaluate("document.querySelector('[data-mode=draw]').getAttribute('aria-pressed')"),'true');
  });
  await check('The chosen method survives navigation and saved drawings reopen without false drafts',async()=>{
    await home();await draw('drawings/11');assert.equal(await evaluate('Major2.desk.presentation().drawingMode'),'shortcuts');assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),false);
    const before=await ink();await evaluate("document.querySelector('.paper-area canvas').focus()");await key('Tab');assert.equal(await evaluate('Major2.desk.spatial().mode'),'pose');await key('Tab');assert.equal(await evaluate('Major2.desk.spatial().mode'),'draw');assert.equal(await ink(),before);
  });
  await check('Both methods preserve immutable reviews and model inspection cannot edit submitted geometry',async()=>{
    await draw('review/42');const before=await ink();await world(0,0);await world(20,20,2);await world(0,0,0,2);await key('3');await key('0');await key('Enter');assert.equal(await ink(),before);assert.equal(await evaluate("!!document.querySelector('.student-shortcut-rename')"),false);await key('Tab');assert.equal(await evaluate('Major2.desk.spatial().mode'),'pose');await key('Tab');assert.equal(await evaluate('Major2.desk.spatial().mode'),'inspect');await method('menu');await world(10,10);assert.equal(await ink(),before);await method('shortcuts');assert.equal(await ink(),before);
  });
  await check('Reset restores Draw menu without erasing the drawing',async()=>{
    const before=await ink();await reset();assert.equal(await evaluate('Major2.desk.presentation().drawingMode'),'menu');assert.equal(await ink(),before);
  });
  await check('Drawing methods, help and controls remain usable across themes and small screens',async()=>{
    // Method controls are intentionally hidden in the read-only viewer used above.
    await draw('drawings/11');
    let count=0;for(const [width,height]of [[1280,800],[980,720],[390,844],[320,740]]){await rpc('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});for(const theme of ['warm','blueprint','forest','lilac','midnight','sunlit']){await evaluate(`Major2.applyTheme(${JSON.stringify(theme)})`);for(const value of ['menu','shortcuts']){await method(value);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);assert.equal(await evaluate("document.querySelector('[data-canvas-method]').getBoundingClientRect().height>=44"),true);await settings();await click('.student-shortcut-help summary');assert.equal(await evaluate("document.querySelector('dialog[open]').scrollWidth>document.querySelector('dialog[open]').clientWidth+1"),false);await click('[data-canvas-cancel]');count++;}}}console.log('Checked '+count+' method layouts');
    await rpc('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await evaluate("Major2.applyTheme('warm')");await draw('drawings/11');await method('shortcuts');await shot('student-canvas-shortcuts');await settings();await click('.student-shortcut-help summary');await shot('drawing-method-settings');
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));console.log('Artifacts: '+out);
 }catch(error){console.error(error.stack);try{await shot('failure');fs.writeFileSync(path.join(out,'failure.txt'),await evaluate('document.body.innerText'))}catch{}console.error('Artifacts: '+out);process.exitCode=1}
 finally{ws?.close();chrome.kill('SIGTERM')}
})();

'use strict';
// Isolated browser fixtures: no live account or API mutation is used.
// Real classroom mutations are covered by test-major2-browser.js.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const out=fs.mkdtempSync(path.join(os.tmpdir(),'major2-canvas-'));
const chrome=spawn(process.env.MAJOR2_CHROMIUM||path.join(os.homedir(),'.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell'),['--no-sandbox','--disable-gpu','--remote-debugging-port=9363','--user-data-dir='+path.join(out,'profile'),'about:blank'],{stdio:'ignore'});
let ws,id=0;
const pending=new Map(),errors=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const rpc=(method,params={})=>new Promise((resolve,reject)=>{const rid=++id;const timer=setTimeout(()=>{pending.delete(rid);reject(Error('Timed out: '+method))},10000);pending.set(rid,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:err=>{clearTimeout(timer);reject(err)}});ws.send(JSON.stringify({id:rid,method,params}))});
const evaluate=async expression=>{const r=await rpc('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value};
async function until(expression){for(let i=0;i<60;i++){if(await evaluate(expression))return;await delay(50)}throw Error('Not ready: '+expression)}
async function shot(name){const r=await rpc('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'))}
(async()=>{
 try{
  let tabs;for(let i=0;i<60;i++){try{tabs=await(await fetch('http://127.0.0.1:9363/json')).json();break}catch{await delay(50)}}
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
  const stamp=()=>evaluate('JSON.stringify(Major2.desk.snapshot().entities)');
  const key=async(key,code=key,extra={})=>{await rpc('Input.dispatchKeyEvent',{type:'keyDown',key,code,...extra});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key,code,...extra});};
  async function close(){await click('.assist-dialog [data-dismiss]');}
  async function prefs(patch){await settings();for(const [name,value] of Object.entries(patch))await change(name,value);await savePrefs();}
  await check('Preferences preview, cancel and account persistence do not edit geometry',async()=>{
    await draw();const before=await stamp();await settings();
    for(const name of ['cursorDimensions','smartGuides','linkedHighlight','commandPalette','selectionActions','drawingLayers','checkpoints','sheetReview','assignmentFlow'])assert.equal(await evaluate(`!!document.querySelector('dialog [name=${name}]')`),true);
    await change('commandPalette',false);assert.equal(await evaluate("document.querySelector('[data-action=assist-search]').hidden"),true);
    await click('[data-canvas-cancel]');assert.equal(await evaluate("document.querySelector('[data-action=assist-search]').hidden"),false);
    await prefs({drawingLayers:true});assert.equal(await evaluate('Major2.canvasPreferences.read().drawingLayers'),true);assert.equal(await stamp(),before);
    await route('home',"!!document.querySelector('.student-focus')");await draw();assert.equal(await evaluate("document.querySelector('[data-action=assist-layers]').hidden"),false);
  });
  await check('Cursor length and angle create exact geometry with one undo; radius works',async()=>{
    await click('[data-tool=line]');await world(0,30);
    assert.equal(await evaluate("document.querySelector('.assist-dimensions').hidden"),false);
    await key('4','Digit4');await key('0','Digit0');
    // CDP key events do not insert printable text unless supplied explicitly.
    await values('.assist-dimensions [name=length]',40);await key('Tab','Tab', {windowsVirtualKeyCode:9});
    assert.equal(await evaluate("document.activeElement.name"),'angle');
    await values('.assist-dimensions [name=angle]',30);await key('Enter','Enter',{windowsVirtualKeyCode:13});await delay(100);
    const line=await evaluate("Major2.desk.table.list().find(e=>e.type==='SEGMENT')");assert.ok(Math.abs(Math.hypot(line.x2-line.x,line.y2-line.y)-40)<.0001);assert.ok(Math.abs(line.y2-50)<.0001);
    await click('[data-action=undo]');assert.equal(await evaluate('Major2.desk.table.count()'),0);
    await click('[data-tool=circle]');await world(0,30);await values('.assist-dimensions [name=length]',12.5);await submit('.assist-dimensions');await delay(100);
    assert.equal(await evaluate("Major2.desk.table.list().find(e=>e.type==='CIRCLE').radius"),12.5);
    await click('[data-action=undo]');
  });
  await check('Smart guides snap matching views and switch off without changing points',async()=>{
    await click('[data-tool=point]');await world(0,30);await world(1,-30);
    assert.equal(await evaluate("Major2.desk.table.list().filter(e=>e.type==='POINT')[1].x"),0);
    await prefs({smartGuides:false});await click('[data-tool=point]');await world(31,-30);
    assert.ok(Math.abs(await evaluate("Major2.desk.table.list().filter(e=>e.type==='POINT')[2].x")-31)<.001);
  });
  await check('Find tool supports keyboard search and respects feature toggles',async()=>{
    await evaluate("document.querySelector('.paper-area canvas').focus()");await key('k','KeyK',{modifiers:2});
    assert.equal(await evaluate("!!document.querySelector('.assist-dialog[open]')"),true);
    await values('.assist-dialog input[type=search]','circle');await key('Enter','Enter',{windowsVirtualKeyCode:13});
    assert.equal(await evaluate("document.querySelector('[data-tool=circle]').getAttribute('aria-pressed')"),'true');
    await prefs({commandPalette:false});await evaluate("document.querySelector('.paper-area canvas').focus()");await key('k','KeyK',{modifiers:2});assert.equal(await evaluate("!!document.querySelector('.assist-dialog[open]')"),false);await prefs({commandPalette:true});
  });
  await check('Layer locks reject edits atomically; hidden layers cannot be picked',async()=>{
    await click('[data-action=assist-layers]');await click('[data-layer=geometry][data-property=lock]');await close();
    const before=await stamp();await click('[data-tool=point]');await world(60,60);await delay(100);assert.equal(await stamp(),before);
    await click('[data-action=assist-layers]');await click('[data-layer=geometry][data-property=show]');await close();
    assert.equal(await evaluate('Major2.desk.assist().shown(Major2.desk.table.list()[0])'),false);
    await click('[data-tool=select]');await world(0,30);assert.equal(await evaluate("document.querySelector('.assist-selection').hidden"),true);
    await click('[data-action=assist-layers]');await click('[data-layer=geometry][data-property=show]');await click('[data-layer=geometry][data-property=lock]');await close();assert.equal(await stamp(),before);
    await click('[data-tool=point]');await world(60,60);await delay(80);assert.notEqual(await stamp(),before);
  });
  await check('A locked construction layer protects connected edges during point edits',async()=>{
    await evaluate("(()=>{const p=Major2.desk.table.list().filter(e=>e.type==='POINT');Major2.desk.table.create('SEGMENT',{id:'locked-link',x:p[0].x,y:p[0].y,x2:p[2].x,y2:p[2].y,bisCode:'B',viewRole:'BOTH',meta:{refs:[p[0].id,p[2].id],endpointRefs:[p[0].id,p[2].id]}})})()");await delay(80);
    await click('[data-action=assist-layers]');await click('[data-layer=construction][data-property=lock]');await close();
    await click('[data-tool=select]');await world(0,30);const before=await stamp();await values('#properties-form [name=x]',10);await submit('#properties-form');await delay(80);
    assert.equal(await stamp(),before);assert.match(await evaluate("document.querySelector('#properties-form .form-error').textContent"),/Unlock/);
    await click('[data-action=assist-layers]');await click('[data-layer=construction][data-property=lock]');await close();
  });
  await check('Checkpoint create and restore is local, named and undoable',async()=>{
    const original=await stamp();await click('[data-action=assist-checkpoints]');await values('.assist-checkpoint-form [name=name]','Before edges');await submit('.assist-checkpoint-form');await until("document.querySelector('.assist-checkpoint-list').textContent.includes('Before edges')");await close();
    await click('[data-tool=point]');await world(-50,50);const changed=await stamp();assert.notEqual(changed,original);
    await click('[data-action=assist-checkpoints]');await click('[data-restore="0"]');await until("!!document.querySelector('dialog[open] form')");await submit('dialog[open] form');await until("!!document.querySelector('.assist-dialog[open]')");await close();assert.equal(await stamp(),original);
    await click('[data-action=undo]');assert.equal(await stamp(),changed);
    assert.equal(await evaluate("__studentApiCalls.some(call=>call.method!=='GET')"),false);
  });
  await check('Selection actions, review locations and permission-safe viewers',async()=>{
    await click('[data-tool=select]');await world(-50,50);assert.equal(await evaluate("document.querySelector('.assist-selection').hidden"),false);
    await click('[data-action=assist-properties]');assert.equal(await evaluate("document.activeElement.name"),'caption');
    await evaluate("(()=>{const p=Major2.desk.table.list().find(e=>e.type==='POINT');Major2.desk.table.update(p.id,{showLabel:false})})()");await delay(60);
    await click('[data-action=assist-review]');assert.match(await evaluate("document.querySelector('.assist-dialog').textContent"),/not a grade/);await click('[data-issue="0"]');assert.equal(await evaluate("document.querySelector('.assist-selection').hidden"),false);
    await draw('review/42');assert.equal(await evaluate("document.querySelector('.assist-dimensions').hidden"),true);await click('[data-action=assist-checkpoints]');assert.equal(await evaluate("!!document.querySelector('.assist-checkpoint-form')"),false);await close();
  });
  await check('Linked highlighting follows true model vertices and ignores teacher references',async()=>{
    await draw('drawings/11');await click('[data-canvas-spatial]');
    const point=await evaluate("Major2.desk.table.list().find(e=>e.type==='POINT'&&e.viewRole==='ELEVATION')");await click('[data-tool=select]');await world(point.x,point.y);
    assert.ok((await evaluate('Major2.desk.assist().linked().vertices')).length>0);
    await prefs({linkedHighlight:false});assert.equal((await evaluate('Major2.desk.assist().linked().vertices')).length,0);await prefs({linkedHighlight:true});
    await click('[data-tool=pan]');
    const vertex=await evaluate("(()=>{const w=__canvasModel,p=EduCADSolid.project(w.state,w.state.cx,w.state.cy)[0],r=w.canvas.getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y}})()");
    await rpc('Input.dispatchMouseEvent',{type:'mouseMoved',x:vertex.x,y:vertex.y});await delay(80);
    assert.ok((await evaluate('Major2.desk.assist().linked().vertices')).includes(0));
    await draw('solve/prism-views/0');await click('[data-canvas-spatial]');await click('[name=show-reference]');await until("Major2.desk.spatial().source==='teacher'");assert.equal((await evaluate('Major2.desk.assist().linked().vertices')).length,0);
    assert.equal(await evaluate("document.querySelector('.assist-brief').hidden"),false);await click('.assist-brief summary');assert.match(await evaluate("document.querySelector('.assist-brief p').textContent"),/hexagonal prism/);
    await click('[data-action=flow-inspect]');assert.equal(await evaluate("document.querySelector('[data-mode=inspect]').getAttribute('aria-pressed')"),'true');
  });
  await check('All aids can be disabled; responsive layouts preserve usable paper',async()=>{
    await draw('drawings/11');await settings();for(const name of ['cursorDimensions','smartGuides','linkedHighlight','commandPalette','selectionActions','drawingLayers','checkpoints','sheetReview','assignmentFlow'])await change(name,false);await savePrefs();assert.equal(await evaluate("document.querySelector('.assist-tools').hidden"),true);
    await prefs({cursorDimensions:true,smartGuides:true,linkedHighlight:true,commandPalette:true,selectionActions:true,drawingLayers:true,checkpoints:true,sheetReview:true,assignmentFlow:true});
    for(const [width,height]of [[1280,800],[980,720],[760,844],[390,844],[320,740]]){
      await rpc('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      for(const theme of ['warm','midnight']){await evaluate(`Major2.applyTheme(${JSON.stringify(theme)})`);await delay(50);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false);assert.ok(await evaluate("document.querySelector('.paper-area').getBoundingClientRect().width")>=200);}
    }
    await rpc('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});await evaluate("Major2.applyTheme('warm')");await click('[data-tool=line]');await world(-50,40);await delay(4500);await shot('cursor-dimensions-desktop');
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));console.log('Artifacts: '+out);
 }catch(error){console.error(error.stack);try{await shot('failure');fs.writeFileSync(path.join(out,'failure.txt'),await evaluate('document.body.innerText'))}catch{}console.error('Artifacts: '+out);process.exitCode=1}
 finally{ws?.close();chrome.kill('SIGTERM')}
})();

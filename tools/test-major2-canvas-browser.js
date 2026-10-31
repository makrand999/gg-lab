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
  async function reset(){await settings();await click('[data-canvas-reset]');await change('guide',true);await change('model','compact');await savePrefs()}
  async function world(x,y){const p=await evaluate(`(()=>{const v=Major2.desk.view(),r=document.querySelector('.paper-area canvas').getBoundingClientRect();return{x:r.left+(${x})*v.s+v.tx,y:r.top+v.ty-(${y})*v.s}})()`);await rpc('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});await rpc('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});await delay(80)}
  async function commands(value){await values('#command-form [name=commands]',value);await submit('#command-form');await until("document.querySelector('#command-form .form-error').hidden");await delay(70)}
  await check('Workspace preferences validate, isolate accounts, and do not contain drawing entities',async()=>{
    assert.equal(await evaluate("Major2.canvasPreferences.normalize({width:999,side:'elsewhere',grid:'false',labelSize:88,model:'floating',entities:[1]}).width"),420);assert.equal(await evaluate("Major2.canvasPreferences.normalize({grid:'false'}).grid"),true);assert.equal(await evaluate("Object.hasOwn(Major2.canvasPreferences.normalize({entities:[1]}),'entities')"),false);assert.equal(await evaluate("Major2.canvasPreferences.normalize({version:999,paper:'midnight'}).paper"),'white');
    const first=await evaluate('Major2.canvasPreferences.key()');await evaluate("Major2.write('educad_session',{...Major2.session(),username:'different-student'});Major2.canvasPreferences.write({paper:'midnight'})");assert.notEqual(await evaluate('Major2.canvasPreferences.key()'),first);await evaluate("Major2.write('educad_session',{...Major2.session(),username:'anaya-fixture'})");assert.equal(await evaluate('Major2.canvasPreferences.read().paper'),'white');
    await draw();assert.equal(await evaluate("Major2.desk.presentation().paper"),'white');assert.equal(await evaluate("document.querySelector('#solid-panel').hidden"),true);
  });
  await check('Guide and 3D visibility are independent, and Focus is always recoverable',async()=>{
    await reset();
    await commands('/point a 0 -30\n/point a\' 0 30\n/point b 40 -30\n/point b\' 40 30\n/line a b\n/line a\' b\'\n/line a a\' B\n/line b b\' B');await until('Major2.desk.spatial().available');assert.equal(await evaluate("document.querySelector('#solid-panel').hidden"),false);
    const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');const width=await evaluate("document.querySelector('.paper-area').getBoundingClientRect().width");await click('[data-action=toggle-guide]');assert.equal(await evaluate("document.querySelector('.desk-guide').hidden"),true);assert.equal(await evaluate("document.querySelector('.student-spatial-dock').hidden"),false);await click('.student-focus-toggle');assert.equal(await evaluate("document.querySelector('.student-spatial-dock').hidden"),true);assert.ok(await evaluate("document.querySelector('.paper-area').getBoundingClientRect().width")>width);assert.equal(await evaluate("document.querySelector('.student-focus-toggle').innerText"),'Exit focus');await click('.student-focus-toggle');assert.equal(await evaluate("document.querySelector('.student-spatial-dock').hidden"),false);await click('[data-action=toggle-guide]');assert.equal(await evaluate("document.querySelector('.desk-guide').hidden"),false);assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);
    await click('.student-model-toggle');assert.equal(await evaluate("document.querySelector('#solid-panel').hidden"),true);await click('[data-action=toggle-guide]');assert.equal(await evaluate("document.querySelector('.student-canvas').dataset.canvasPanels"),'hidden');await click('[data-action=toggle-guide]');await click('.student-model-toggle');
  });
  await check('Drawing instructions survive Focus; quick precision controls persist without editing geometry',async()=>{
    const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');
    await click('[data-tool=line]');await world(0,30);await click('.student-focus-toggle');
    assert.equal(await evaluate("document.querySelector('.desk-guide').hidden"),true);
    assert.ok(await evaluate("document.querySelector('.desk-context #tool-instruction').getBoundingClientRect().height>0"));
    assert.ok(await evaluate("document.querySelector('#tool-instruction').textContent.includes('second point')"));
    await click('[data-action=quick-grid]');await click('[data-action=quick-snap]');
    assert.equal(await evaluate('Major2.canvasPreferences.read().grid'),false);
    assert.equal(await evaluate('Major2.canvasPreferences.read().snap'),true);
    assert.equal(await evaluate("document.querySelector('[data-action=quick-snap]').getAttribute('aria-pressed')"),'true');
    assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);
    await click('[data-action=cancel]');
    assert.ok(await evaluate("document.querySelector('#tool-instruction').textContent.includes('first point')"));
    await click('[data-mode=inspect]');assert.equal(await evaluate("document.querySelector('[data-action=quick-snap]').disabled"),true);
    await click('[data-mode=draw]');await click('.student-focus-toggle');await reset();
  });
  await check('Live layout preview and Cancel preserve geometry, pan, zoom, selection and the active line step',async()=>{
    await click('[data-tool=line]');await world(0,30);assert.ok(await evaluate("document.querySelector('#tool-instruction').innerText.includes('second point')"));
    const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),scale=await evaluate('Major2.desk.view().s');await settings();await change('side','left');await change('width',420);await change('density','compact');await change('paper','midnight');await change('labelSize',18);assert.equal(await evaluate("document.querySelector('.student-canvas').dataset.canvasSide"),'left');assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);assert.equal(await evaluate('Major2.desk.view().s'),scale);await click('[data-canvas-cancel]');await delay(70);assert.equal(await evaluate('Major2.desk.presentation().side'),'right');assert.equal(await evaluate('Major2.desk.presentation().paper'),'white');assert.ok(await evaluate("document.querySelector('#tool-instruction').innerText.includes('second point')"));await world(30,40);await until("Major2.desk.table.list().some(entity=>entity.type==='SEGMENT')");assert.ok(Math.abs(await evaluate("Major2.desk.table.list().filter(entity=>entity.type==='SEGMENT').at(-1).x2")-30)<0.0001);await click('[data-action=undo]');assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);
    await click('[data-tool=select]');await world(0,30);const selected=await evaluate("document.querySelector('#properties-form [name=caption]').value");await settings();await change('density','compact');await change('side','left');await click('[data-canvas-cancel]');assert.equal(await evaluate("document.querySelector('#properties-form [name=caption]').value"),selected);
  });
  await check('Saved paper, label, grid, snap and layout choices survive navigation; Reset does not erase work',async()=>{
    const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');await settings();await change('side','left');await change('width',380);await change('paper','midnight');await change('grid',false);await change('labels',false);await change('labelSize',18);await change('viewCaptions',false);await change('snap',true);await change('snapSpacing',10);await change('gridSpacing',20);await change('model','large');await savePrefs();
    assert.equal(await evaluate('Major2.canvasPreferences.read().paper'),'midnight');assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);await delay(80);assert.deepEqual(await evaluate("[...document.querySelector('.paper-area canvas').getContext('2d').getImageData(2,2,1,1).data]"),[23,31,42,255]);
    await evaluate("window.__canvasLabelFn=EduCADCanvas.drawKnockoutLabel;window.__canvasLabelCalls=[];EduCADCanvas.drawKnockoutLabel=(ctx,text,x,y,options)=>{__canvasLabelCalls.push({text,options});return __canvasLabelFn(ctx,text,x,y,options)}");
    await click('[data-tool=measure]');await world(0,-30);await world(40,-30);await click('[data-action=add-dimension]');await until("__canvasLabelCalls.some(call=>call.text==='40.0 mm')");assert.equal(await evaluate("__canvasLabelCalls.find(call=>call.text==='40.0 mm').options.fillStyle"),'#eaf1fb');await click('[data-action=undo]');assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);await evaluate('EduCADCanvas.drawKnockoutLabel=__canvasLabelFn');

    await route('home',"!!document.querySelector('.student-focus')");await draw();await until("!!document.querySelector('dialog[open]')");await submit('dialog form');await until('Major2.desk.table.count()===8');assert.equal(await evaluate('Major2.desk.presentation().snapSpacing'),10);assert.equal(await evaluate("document.querySelector('.student-canvas').dataset.canvasSide"),'left');
    const restored=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');await reset();assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),restored);assert.equal(await evaluate('Major2.desk.presentation().paper'),'white');assert.equal(await evaluate('Major2.desk.presentation().snap'),false);
  });
  await check('Grid snapping acts on new pointer placements without moving existing geometry',async()=>{
    await settings();await change('snap',true);await change('snapSpacing',10);await savePrefs();await click('[data-tool=point]');await world(13,17);await until("Major2.desk.table.list().some(entity=>entity.type==='POINT'&&entity.x===10&&entity.y===20)");await click('[data-action=undo]');assert.equal(await evaluate("Major2.desk.table.list().some(entity=>entity.x===10&&entity.y===20)"),false);await reset();
  });
  await check('3D uses the student construction; permitted references require an explicit choice',async()=>{
    await draw('solve/prism-views/0');assert.equal(await evaluate('Major2.desk.spatial().source'),'unavailable');assert.equal(await evaluate("document.querySelector('[name=show-reference]').checked"),false);assert.equal(await evaluate("document.querySelector('#reference-switch').hidden"),false);
    const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');await click('[name=show-reference]');await until("Major2.desk.spatial().source==='teacher'");assert.equal(await evaluate("document.querySelector('.student-spatial-source').textContent"),'Teacher reference');assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);await click('[name=show-reference]');assert.equal(await evaluate('Major2.desk.spatial().source'),'unavailable');await draw('drawings/11');await until("Major2.desk.spatial().source==='student'");assert.equal(await evaluate("document.querySelector('.student-spatial-source').textContent"),'From your drawing');const sketch=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');await click('[data-action=orbit-left]');assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),sketch);await home();await draw('drawings/11');assert.equal(await evaluate("!!document.querySelector('dialog[open]')"),false);assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),sketch);assert.equal(await evaluate('Major2.desk.dirty()'),false);
  });
  await check('Hidden 3D remains recoverable for deliberate pose inspection and read-only review',async()=>{
    await click('.student-model-toggle');await click('.student-focus-toggle');await click('[data-mode=pose]');assert.equal(await evaluate("document.querySelector('.student-canvas').dataset.canvasFocus"),'false');assert.equal(await evaluate("document.querySelector('#solid-panel').hidden"),false);assert.equal(await evaluate("document.querySelector('#pose-panel').hidden"),false);
    await draw('review/42');const before=await evaluate('JSON.stringify(Major2.desk.snapshot().entities)');await settings();await change('paper','blueprint');await change('focus',true);await savePrefs();assert.equal(await evaluate("document.querySelector('[data-tool=line]').disabled"),true);assert.equal(await evaluate("document.querySelector('[data-action=save]')"),null);assert.equal(await evaluate('JSON.stringify(Major2.desk.snapshot().entities)'),before);await click('.student-focus-toggle');await reset();
  });
  await check('Workspace presets, Escape and unavailable device storage have reversible behavior',async()=>{
    await settings();await click('[data-canvas-preset=quiet]');assert.equal(await evaluate('Major2.desk.presentation().focus'),true);await rpc('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await rpc('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await until("!document.querySelector('dialog[open]')");assert.equal(await evaluate('Major2.desk.presentation().focus'),false);
    await evaluate("window.__canvasWrite=Major2.write;Major2.write=(key,value)=>key.startsWith('educad_major2_canvas_')?false:__canvasWrite(key,value)");await settings();await change('paper','warm');await savePrefs();assert.equal(await evaluate('Major2.desk.presentation().paper'),'warm');assert.ok(await evaluate("document.querySelector('#toast').innerText.includes('this session')"));await evaluate('Major2.write=__canvasWrite');await reset();
    await settings();await change('paper','midnight');await evaluate("window.__canvasSession=Major2.session();Major2.write('educad_session',{...__canvasSession,username:'new-scope',token:'changed-token'})");await savePrefs();assert.equal(await evaluate('Major2.canvasPreferences.read().paper'),'white');await evaluate("Major2.write('educad_session',__canvasSession)");await draw('review/42');
  });
  await check('All layouts preserve paper, accessible controls and non-overlapping 3D across themes',async()=>{
    let layouts=0;for(const [width,height]of [[1280,844],[980,720],[760,844],[390,844],[320,740],[1366,600]]){await rpc('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});for(const theme of ['warm','blueprint','forest','lilac','midnight','sunlit']){await evaluate(`Major2.applyTheme(${JSON.stringify(theme)})`);await draw('drawings/11');for(const [side,focus,guide,model]of [['right',false,true,'compact'],['left',false,true,'large'],['left',true,true,'compact'],['left',false,false,'hidden']]){
      await settings();await change('side',side);await change('focus',focus);await change('guide',guide);await change('model',model);await savePrefs();await delay(30);assert.equal(await evaluate('document.documentElement.scrollWidth>innerWidth+1'),false,`${width} ${height} ${theme} ${side} ${focus}`);const layout=await evaluate("(()=>{const p=document.querySelector('.paper-area').getBoundingClientRect(),d=document.querySelector('.student-spatial-dock').getBoundingClientRect();return {paper:p.width,height:p.height,overlap:d.width>0&&p.left<d.right&&p.right>d.left&&p.top<d.bottom&&p.bottom>d.top,buttons:[...document.querySelectorAll('.desk-header .button,.desk-footer .button')].filter(el=>el.getBoundingClientRect().height>0).every(el=>el.getBoundingClientRect().height>=44)}})()");assert.ok(layout.paper>=200,'Paper width '+JSON.stringify(layout));assert.ok(layout.height>=200,'Paper height '+JSON.stringify(layout));assert.equal(layout.overlap,false,'3D covers paper');assert.equal(layout.buttons,true);if(!focus&&model!=='hidden')assert.equal(await evaluate("(()=>{const b=__canvasModel.frameOf()?.bbox,s=__canvasModel.state;return !!b&&b.minX>=4&&b.minY>=4&&b.maxX<=s.w-4&&b.maxY<=s.h-4})()"),true,'Resting 3D is clipped by its dock');layouts++;}
    }}console.log('Checked '+layouts+' canvas layouts');results.push('Checked '+layouts+' canvas layouts');
    await rpc('Emulation.setDeviceMetricsOverride',{width:1280,height:844,deviceScaleFactor:1,mobile:false});await evaluate("Major2.applyTheme('warm')");await draw('drawings/11');await reset();await shot('student-canvas-step-1-desktop');await settings();await shot('student-canvas-customization');await click('[data-canvas-cancel]');await click('.student-focus-toggle');await shot('student-canvas-focus');await click('.student-focus-toggle');await rpc('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await shot('student-canvas-step-1-mobile');
  });
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));console.log('Artifacts: '+out);
 }catch(error){console.error(error.stack);try{await shot('failure');fs.writeFileSync(path.join(out,'failure.txt'),await evaluate('document.body.innerText'))}catch{}console.error('Artifacts: '+out);process.exitCode=1}
 finally{ws?.close();chrome.kill('SIGTERM')}
})();

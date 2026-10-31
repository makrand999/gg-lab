// Run in a Major 2 preview page. Uses isolated, read-only fixtures.
// Pointer checks dispatch events with temporary capture shims; native keyboard
// and viewport checks are also exercised through the collaborative preview.
(function(){
  const M=Major2,$=selector=>document.querySelector(selector),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const results=[],errors=[];addEventListener('error',event=>errors.push(event.message));
  addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const equal=(a,b,message)=>assert(JSON.stringify(a)===JSON.stringify(b),message);
  const rect=selector=>$(selector).getBoundingClientRect().toJSON();
  const entities=()=>JSON.stringify(M.desk.snapshot().entities),key=(target,value,shift=false)=>target.dispatchEvent(new KeyboardEvent('keydown',{key:value,shiftKey:shift,bubbles:true,cancelable:true}));
  const click=selector=>$(selector).click();
  const pointer=(target,type,x,y,id=1)=>target.dispatchEvent(new PointerEvent(type,{clientX:x,clientY:y,pointerId:id,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,bubbles:true,cancelable:true}));
  async function capture(target,fn){
    const names=['setPointerCapture','hasPointerCapture','releasePointerCapture'],original=names.map(name=>Object.getOwnPropertyDescriptor(target,name)),ids=new Set();
    target.setPointerCapture=id=>ids.add(id);target.hasPointerCapture=id=>ids.has(id);target.releasePointerCapture=id=>ids.delete(id);
    try{await fn();}finally{names.forEach((name,i)=>{if(original[i])Object.defineProperty(target,name,original[i]);else delete target[name];});}
  }
  async function drag(selector,dx,dy,cancel=false){const target=$(selector),r=target.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;await capture(target,async()=>{pointer(target,'pointerdown',x,y);pointer(target,'pointermove',x+dx,y+dy);if(cancel)key(target,'Escape');pointer(target,'pointerup',x+dx,y+dy);});await sleep(70);}
  async function paperPoint(x,y){const target=$('.paper-area canvas'),r=target.getBoundingClientRect(),v=M.desk.view();await capture(target,async()=>{pointer(target,'pointerdown',r.left+x*v.s+v.tx,r.top+v.ty-y*v.s);pointer(target,'pointerup',r.left+x*v.s+v.tx,r.top+v.ty-y*v.s);});await sleep(60);}
  async function ready(predicate){for(let i=0;i<70;i++){if(predicate())return;await sleep(40);}throw Error('Fixture route did not finish.');}
  async function route(path){if(location.hash==='#/'+path)M.reload();else M.go(path);await ready(()=>!!$('.student-canvas')&&M.desk);await sleep(90);}
  async function change(name,value){const field=$('dialog[open] [name='+name+']');if(field.type==='checkbox')field.checked=value;else field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));await sleep(30);}
  async function settings(){click('[data-canvas-customize]');await ready(()=>!!$('dialog[open]'));}
  async function save(){ $('.student-canvas-dialog form').requestSubmit();await ready(()=>!$('dialog[open]'));await sleep(60);}
  async function prefs(value){await settings();for(const [name,v]of Object.entries(value))await change(name,v);await save();}
  function bounded(){const d=rect('.student-spatial-dock'),b=rect('.desk-body');assert(d.left>=b.left+7&&d.top>=b.top+7&&d.right<=b.right-7&&d.bottom<=b.bottom-7,'Floating window escaped the drawing workspace.');return d;}
  const setup=async()=>{
    const table=EduCADEntities.createTable();EduCADSaves.restoreTable(EduCADEntities,table,{entities:EduCADCurriculum.regularSolid({solid:'PRISM',sizeMm:45,heightMm:70}).entities});
    window.__windowPrism=EduCADSaves.snapshotTable(table);window.__windowOriginalApi=M.api;window.__windowOriginalSession=M.session();
    const mount=M.solid;M.solid=(host,...args)=>{const widget=mount(host,...args);if(host.id==='desk-solid')window.__windowModel=widget;return widget;};
    window.__windowApiCalls=[];M.api=async(path,method='GET')=>{
      __windowApiCalls.push({path,method});if(method!=='GET')throw Error('Window fixture never writes to the API.');
      if(path==='drawings/11')return {id:11,title:'Prism · window study',data:JSON.parse(JSON.stringify(__windowPrism))};
      if(path==='sets/window-study')return {code:'window-study',title:'Window study',class_code:'graphics',questions:[{prompt:'Draw matching views of the prism.',show_3d:true,model3d:EduCADRef3d.buildPreview(__windowPrism.entities,EduCADReconstruct)},{prompt:'Draw without a reference.',show_3d:false}]};
      if(path==='submissions/42')return {id:42,set_code:'window-study',question_index:0,data:JSON.parse(JSON.stringify(__windowPrism)),verdict:'pass',remarks:'Good alignment.'};
      if(path==='drawings')return {drawings:[]};if(path==='sets')return {sets:[]};if(path==='classes')return {classes:[]};if(path==='progress')return {progress:[]};if(path==='submissions/mine')return {submissions:[]};throw Error('Unexpected fixture API '+path);
    };
    M.write('educad_session',{role:'student',username:'window-check-fixture',name:'Anaya',token:'isolated-window-check-'+Date.now()});
    Object.keys(localStorage).filter(key=>key.startsWith('educad_major2_draft_'+M.accountKey()+'/')).forEach(key=>M.remove(key));
    M.canvasPreferences.write(M.canvasPreferences.defaults);await route('drawings/11');
  };
  const checks={
    preferences:async()=>{
      equal(M.desk.presentation().modelPlacement,'docked','The default must remain docked.');
      const n=M.canvasPreferences.normalize({floatWidth:999,floatHeight:-10,floatX:Infinity,floatY:-4,floatMinimized:'yes',modelPlacement:'invalid',entities:[1]});
      equal([n.floatWidth,n.floatHeight,n.floatX,n.floatY,n.floatMinimized,n.modelPlacement],[560,260,1,0,false,'docked'],'Malformed preferences were not bounded.');assert(!Object.hasOwn(n,'entities'),'Geometry leaked into window preferences.');
      const first=M.session();M.write('educad_session',{...first,username:'other-window-student'});M.canvasPreferences.write({modelPlacement:'floating',floatX:.3});M.write('educad_session',first);equal(M.canvasPreferences.read().modelPlacement,'docked','Frame preferences leaked across students.');
    },
    moveResize:async()=>{
      const before=entities();click('[data-tool=line]');await paperPoint(-35,-20);assert($('#tool-instruction').innerText.includes('second point'),'No active line anchor.');
      const scale=M.desk.view().s,undo=$('[data-action=undo]').disabled;click('.student-window-placement');await sleep(60);equal(M.desk.presentation().modelPlacement,'floating','Float did not activate.');
      const start=bounded();await drag('.student-window-move',-350,-130);let d=bounded();assert(d.left<start.left-300&&d.top<start.top-100,'Moving the handle did not move the frame.');
      const camera=[__windowModel.state.yaw,__windowModel.state.pitch,__windowModel.state.scale];await drag('.student-window-resize',100,80);d=bounded();assert(d.width>start.width+90&&d.height>start.height+70,'Resize changed only the model.');
      equal(camera,[__windowModel.state.yaw,__windowModel.state.pitch,__windowModel.state.scale],'Resizing lost the model view.');equal(entities(),before,'Moving/resizing edited geometry.');equal(M.desk.view().s,scale,'Moving/resizing zoomed the paper.');equal(M.desk.dirty(),false,'Layout created a drawing draft.');equal($('[data-action=undo]').disabled,undo,'Layout created an undo unit.');assert($('#tool-instruction').innerText.includes('second point'),'Frame gestures cancelled the active line anchor.');
      const p=M.desk.presentation();await drag('.student-window-move',-70,-30,true);equal(M.desk.presentation(),p,'Escape did not restore the window gesture.');assert($('#tool-instruction').innerText.includes('second point'),'Window Escape cancelled paper input.');
    },
    keyboardPersistence:async()=>{
      let d=bounded();key($('.student-window-move'),'ArrowRight');await sleep(40);assert(bounded().left>d.left+9,'Arrow key did not move the frame.');d=bounded();key($('.student-window-resize'),'ArrowLeft',true);await sleep(40);assert(bounded().width<d.width-39,'Shift-arrow did not resize the frame.');
      const p=M.desk.presentation();await route('drawings/11');equal(M.desk.presentation(),p,'Frame preferences did not survive navigation.');equal(M.desk.dirty(),false,'Reopening created a false drawing draft.');bounded();
    },
    modelGestures:async()=>{
      const before=entities(),frame=rect('.student-spatial-dock'),s=__windowModel.state,yaw=s.yaw,scale=s.scale;
      await drag('#desk-solid canvas',35,15);assert(s.yaw!==yaw,'Dragging inside the model did not orbit it.');equal(rect('.student-spatial-dock'),frame,'Model orbit moved the frame.');
      const target=$('#desk-solid canvas'),r=target.getBoundingClientRect();target.dispatchEvent(new WheelEvent('wheel',{clientX:r.left+r.width/2,clientY:r.top+r.height/2,deltaY:-100,bubbles:true,cancelable:true}));await sleep(40);assert(s.scale>scale,'Scrolling did not zoom the model.');
      const pinchScale=s.scale;await capture(target,async()=>{pointer(target,'pointerdown',r.left+80,r.top+60,1);pointer(target,'pointerdown',r.left+140,r.top+60,2);pointer(target,'pointermove',r.left+180,r.top+60,2);pointer(target,'pointerup',r.left+80,r.top+60,1);pointer(target,'pointerup',r.left+180,r.top+60,2);});await sleep(40);assert(s.scale>pinchScale,'Two-pointer pinch did not zoom.');
      key(target,'Home');equal(s.scale,1,'Home did not reset the model view.');equal(s.cx,s.w/2,'Reset did not recenter the model.');key(target,'+');assert(s.scale>1,'Model keyboard zoom did not work.');key(target,'Home');
      equal(entities(),before,'Orbit or zoom edited the drawing.');equal(M.desk.dirty(),false,'Model gestures created a draft.');click('.student-window-placement');await drag('#desk-solid canvas',-20,5);assert(s.yaw!==yaw,'Docked model orbit did not work.');click('[data-action=orbit-reset]');
    },
    minimizeFocus:async()=>{
      click('.student-window-placement');const original=M.desk.presentation();click('.student-window-minimize');await sleep(40);assert(rect('.student-spatial-dock').height<=81&&$('.student-spatial-content').hidden,'Minimize left a large blank frame.');click('.student-window-minimize');await sleep(40);equal(M.desk.presentation().floatWidth,original.floatWidth,'Restore lost the frame size.');
      click('.student-focus-toggle');assert($('.student-spatial-dock').hidden,'Focus did not hide the floating frame.');click('.student-focus-toggle');assert(!$('.student-spatial-dock').hidden,'Exit Focus did not recover the frame.');
      click('[data-action=toggle-guide]');await sleep(50);equal($('.student-canvas').dataset.canvasPanels,'hidden','Floating without the guide reserved a blank sidebar.');bounded();click('[data-action=toggle-guide]');
      click('.student-window-minimize');click('[data-mode=pose]');assert(!M.desk.presentation().floatMinimized&&!$('#pose-panel').hidden,'Move model did not recover the minimized frame.');click('[data-mode=draw]');
    },
    settings:async()=>{
      const before=entities(),original=M.desk.presentation();await settings();await change('modelPlacement','docked');await change('floatWidth',280);await change('floatHeight',300);click('[data-canvas-cancel]');await sleep(50);equal(M.desk.presentation(),original,'Cancel did not restore the floating workspace.');
      await prefs({floatWidth:400,floatHeight:420,side:'left'});bounded();await settings();click('.student-window-settings summary');click('[data-window-reset]');await save();equal([M.desk.presentation().floatWidth,M.desk.presentation().floatHeight,M.desk.presentation().floatX,M.desk.presentation().floatY],[320,360,1,1],'Reset window did not reset size and position.');equal(entities(),before,'Workspace controls edited geometry.');
    },
    unavailableReferenceReview:async()=>{
      await route('draw/new');assert(!M.desk.spatial().available,'Blank paper unexpectedly has a model.');assert(rect('.student-spatial-dock').height<=81,'Unavailable compact model kept a large blank frame.');
      await route('solve/window-study/0');await sleep(80);assert(M.desk.spatial().referenceAllowed&&!M.desk.spatial().available,'Reference was selected automatically.');assert(!$('.student-spatial-content').hidden&&!$('#reference-switch').hidden,'Floating collapsed the permitted reference control.');assert(rect('.student-spatial-dock').height<=167,'Unselected reference reserved a large blank model.');click('#reference-switch input');await sleep(180);assert(M.desk.spatial().available&&M.desk.spatial().source==='teacher','Explicit reference did not display.');bounded();
      await route('solve/window-study/1');assert($('#reference-switch').hidden&&!M.desk.spatial().available,'Private reference leaked into another question.');
      await route('review/42');const before=entities();await drag('.student-window-move',-250,-90);await drag('#desk-solid canvas',20,15);equal(entities(),before,'Window/model interaction edited a submission.');assert($('[data-tool=line]').disabled&&!$('[data-action=save]'),'Review became editable.');
      await route('drawings/11');
    },
    drawingHistory:async()=>{
      const before=entities(),recipe=__windowPrism;click('[data-tool=line]');await paperPoint(-45,40);await paperPoint(-35,40);assert(M.desk.dirty(),'Drawing a line did not mark changed work.');click('[data-action=undo]');equal(entities(),before,'Undo did not restore geometry.');equal(M.desk.dirty(),false,'Undo to the saved drawing left a false draft.');
      click('[data-tool=line]');await paperPoint(-45,40);await paperPoint(-35,40);const saved=entities(),api=M.api;
      M.api=async(path,method='GET',body)=>{if(path==='drawings/11'&&method==='PUT'){window.__windowPrism=JSON.parse(JSON.stringify(body.data));return {id:11};}return api(path,method,body);};
      try{click('[data-action=save]');await ready(()=>!M.desk.dirty()&&!$('[data-action=save]').disabled);await drag('.student-window-resize',37,41);await settings();await change('paper','warm');await save();equal(M.desk.dirty(),false,'Frame and preferences made the saved drawing dirty.');await route('drawings/11');equal(entities(),saved,'Saved fixture did not reopen accurately.');assert(!$('dialog[open]'),'Saved work reopened with a false draft prompt.');}
      finally{M.api=api;window.__windowPrism=recipe;M.remove('educad_major2_draft_'+M.accountKey()+'/drawing/11');}
      await route('drawings/11');
    },
    lessonOrbit:async()=>{
      await route('learn/solid');const next=$('[data-action=lesson-next]'),before=entities(),target=$('#desk-solid canvas'),r=target.getBoundingClientRect();assert(next.disabled,'Lesson completed without exploration.');
      await capture(target,async()=>{pointer(target,'pointerdown',r.left+r.width/2,r.top+r.height/2);pointer(target,'pointerup',r.left+r.width/2,r.top+r.height/2);});assert(next.disabled,'A click alone completed orbit exploration.');
      await drag('.student-window-move',-50,-20);assert(next.disabled,'Moving the frame completed model exploration.');key(target,'ArrowRight');assert(!$('[data-action=lesson-next]').disabled,'Keyboard orbit did not count as actual exploration.');equal(entities(),before,'Lesson orbit edited the paper.');await route('drawings/11');
    },
    layout:async()=>{
      const p=M.desk.presentation(),small=innerWidth<=760;equal($('.student-canvas').dataset.canvasPlacement,small?'docked':'floating','Responsive placement did not adapt.');assert(document.documentElement.scrollWidth<=innerWidth+1,'Page overflowed horizontally.');
      if(small){assert($('.student-window-placement').hidden&&$('.student-window-resize').hidden,'Small screen kept floating handles.');const d=rect('.student-spatial-dock'),paper=rect('.paper-area');assert(d.top>=paper.bottom-1,'Docked mobile frame covered the paper.');}
      else{bounded();const c=rect('#desk-solid'),b=__windowModel.frameOf()?.bbox;assert(c.width>80&&c.height>40,'3D stage disappeared.');assert(b&&b.minX>=-1&&b.minY>=-1&&b.maxX<=__windowModel.state.w+1&&b.maxY<=__windowModel.state.h+1,'Resting model clipped in the frame.');}
      assert(p.modelPlacement==='floating','Responsive fallback erased the student choice.');
      for(const el of document.querySelectorAll('.student-spatial-heading button,.student-window-resize'))if(el.getBoundingClientRect().height>0)assert(el.getBoundingClientRect().height>=44,'Window control is too small.');
    }
  };
  window.__windowChecks={setup,results,errors,checks,run:async name=>{await checks[name]();results.push(name);return {passed:name,errors};},layout:async()=>checks.layout(),restore:()=>{M.api=__windowOriginalApi;M.write('educad_session',__windowOriginalSession);M.go('welcome');}};
})();

window.__windowCheckLayouts=async function(){
  let count=0;
  for(const theme of ['warm','blueprint','forest','lilac','midnight','sunlit']){
    Major2.applyTheme(theme);
    for(const side of ['left','right'])for(const [floatWidth,floatHeight]of [[260,260],[560,640]]){
      document.querySelector('.student-canvas').dispatchEvent(new CustomEvent('student-canvas-preferences',{detail:{...Major2.desk.presentation(),side,floatWidth,floatHeight,floatX:1,floatY:1,focus:false,guide:true,modelPlacement:'floating',floatMinimized:false}}));
      await new Promise(resolve=>setTimeout(resolve,70));await __windowChecks.layout();count++;
    }
  }
  return {width:innerWidth,height:innerHeight,layouts:count,errors:__windowChecks.errors};
};

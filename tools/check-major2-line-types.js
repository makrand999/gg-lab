// Install in a Major 2 collaborative preview. Fixtures never write to the live API.
(function(){
  const M=Major2,E=EduCADEntities,S=EduCADSaves,$=selector=>document.querySelector(selector),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const results=[],errors=[];addEventListener('error',event=>errors.push(event.message));addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
  const assert=(condition,message)=>{if(!condition)throw Error(message);},equal=(a,b,message)=>assert(JSON.stringify(a)===JSON.stringify(b),message);
  const ink=()=>JSON.stringify(M.desk.snapshot().entities),click=selector=>$(selector).click();
  const opened=()=>{const popup=$('#student-line-type-options');return popup.hasAttribute('popover')?popup.matches(':popover-open'):!popup.hidden;};
  async function ready(fn){for(let i=0;i<75;i++){if(fn())return;await sleep(40);}throw Error('Fixture did not become ready.');}
  async function route(path){if(location.hash==='#/'+path)M.reload();else M.go(path);await ready(()=>!!$('.student-canvas')&&M.desk);await sleep(70);}
  async function change(name,value){const el=$('dialog[open] [name='+name+']');if(el.type==='checkbox')el.checked=value;else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));await sleep(30);}
  async function prefs(values){click('[data-canvas-customize]');for(const [name,value]of Object.entries(values))await change(name,value);$('.student-canvas-dialog form').requestSubmit();await sleep(50);}
  async function choose(code){click('.student-line-type-toggle');assert(opened(),'Line types did not open.');click('[data-line-type='+code+']');await sleep(35);assert(!opened(),'Line selection did not close.');}
  async function paper(x,y,ctrl=false,hover=false){
    const canvas=$('.paper-area canvas'),r=canvas.getBoundingClientRect(),v=M.desk.view(),px=r.left+x*v.s+v.tx,py=r.top+v.ty-y*v.s;
    if(hover){canvas.dispatchEvent(new PointerEvent('pointermove',{clientX:px,clientY:py,pointerId:1,bubbles:true}));return;}
    const names=['setPointerCapture','releasePointerCapture','hasPointerCapture'],previous=names.map(name=>Object.getOwnPropertyDescriptor(canvas,name)),ids=new Set();canvas.setPointerCapture=id=>ids.add(id);canvas.releasePointerCapture=id=>ids.delete(id);canvas.hasPointerCapture=id=>ids.has(id);
    try{for(const type of ['pointerdown','pointerup'])canvas.dispatchEvent(new PointerEvent(type,{clientX:px,clientY:py,ctrlKey:ctrl,pointerId:1,pointerType:'mouse',button:0,buttons:type==='pointerdown'?1:0,bubbles:true,cancelable:true}));}
    finally{names.forEach((name,i)=>{if(previous[i])Object.defineProperty(canvas,name,previous[i]);else delete canvas[name];});}await sleep(40);
  }
  async function commands(text){const el=$('#command-form [name=commands]');el.value=text;$('#command-form').requestSubmit();await sleep(50);assert($('#command-form .form-error').hidden,'Fixture commands failed.');}
  const setup=async()=>{
    const t=E.createTable();S.restoreTable(E,t,{entities:EduCADCurriculum.regularSolid({solid:'PRISM',sizeMm:45,heightMm:70}).entities});window.__linePrism=S.snapshotTable(t);window.__lineSaved={version:1,entities:[]};window.__lineCalls=[];window.__lineOriginalSession=M.session();
    M.api=async(path,method='GET',body)=>{
      __lineCalls.push({path,method});
      if(path==='drawings/11'&&method==='PUT'){__lineSaved=JSON.parse(JSON.stringify(body.data));return{id:11};}
      if(method!=='GET')throw Error('Unexpected fixture mutation.');
      if(path==='drawings/11')return{id:11,title:'Line study',data:JSON.parse(JSON.stringify(__lineSaved))};
      if(path==='submissions/42')return{id:42,set_code:'line-types',question_index:0,data:__linePrism,verdict:'pass',remarks:'Good alignment.'};
      if(path==='sets/line-types')return{code:'line-types',title:'Line types',questions:[{prompt:'Draw matching views.',show_3d:false}]};
      if(path==='classes')return{classes:[]};if(path==='sets')return{sets:[]};if(path==='drawings')return{drawings:[]};if(path==='submissions/mine')return{submissions:[]};if(path==='progress')return{progress:[]};throw Error('Unexpected fixture API '+path);
    };
    M.write('educad_session',{role:'student',username:'line-type-fixture',name:'Anaya',token:'isolated-line-check-'+Date.now()});Object.keys(localStorage).filter(key=>key.startsWith('educad_major2_draft_'+M.accountKey()+'/')).forEach(key=>M.remove(key));M.canvasPreferences.write(M.canvasPreferences.defaults);await route('draw/new');
  };
  const checks={
    menuTypes:async()=>{
      equal(M.canvasPreferences.normalize({lineType:'H'}).lineType,'A','Unsupported default was accepted.');click('[data-tool=line]');const before=ink();
      for(const code of ['A','B','E','G','K']){await choose(code);equal(ink(),before,'Selecting a line type edited geometry.');equal(M.desk.dirty(),false,'Selecting a line type created a draft.');await paper(-40,40);await paper(20,40);const entity=M.desk.table.findByType('SEGMENT')[0];equal(entity.bisCode,code,'Line ignored its chosen type.');assert(entity.meta.endpointRefs.length===2,'Line lost endpoint dependencies.');click('[data-action=undo]');equal(ink(),before,'Undo did not restore the drawing.');equal(M.desk.dirty(),false,'Undo left a false draft.');}
    },
    activeAnchorAndLength:async()=>{
      await choose('E');await paper(-40,40);$('#length-form [name=length]').value=25;$('#length-form [name=angle]').value=30;const before=ink(),scale=M.desk.view().s;
      await choose('G');assert($('#tool-instruction').innerText.includes('second point'),'Changing type lost the first endpoint.');equal($('#length-form [name=length]').value,'25','Changing type erased typed length.');equal($('#length-form [name=angle]').value,'30','Changing type erased typed angle.');equal(ink(),before,'Changing type committed unfinished work.');equal(M.desk.view().s,scale,'Changing type changed paper zoom.');
      click('.student-line-type-toggle');$('#student-line-type-options').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert(!opened(),'Escape left the type selector open.');assert($('#tool-instruction').innerText.includes('second point'),'Selector Escape cancelled drawing input.');
      $('#length-form').requestSubmit();await sleep(50);const line=M.desk.table.findByType('SEGMENT')[0];equal(line.bisCode,'G','Typed-length line ignored its type.');assert(Math.abs(Math.hypot(line.x2-line.x,line.y2-line.y)-25)<1e-8,'Typed length changed.');click('[data-action=undo]');
    },
    previewPatterns:async()=>{
      const context=$('.paper-area canvas').getContext('2d'),names=['beginPath','moveTo','lineTo','stroke'],descriptors=names.map(name=>Object.getOwnPropertyDescriptor(context,name)),original=names.map(name=>context[name]);let path=[],strokes=[];
      context.beginPath=function(...args){path=[];return original[0].apply(this,args);};context.moveTo=function(...args){path.push('M');return original[1].apply(this,args);};context.lineTo=function(...args){path.push('L');return original[2].apply(this,args);};context.stroke=function(...args){if(path.join('')==='ML'&&this.strokeStyle.toLowerCase()===M.canvasPreferences.palettes[M.desk.presentation().paper].accent.toLowerCase())strokes.push({dash:this.getLineDash(),width:this.lineWidth});return original[3].apply(this,args);};
      try{await paper(-40,40);for(const code of ['A','B','E','G','K']){strokes=[];await choose(code);await paper(20,40,false,true);await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));const style=E.bisStyleFor(code);assert(strokes.some(s=>JSON.stringify(s.dash)===JSON.stringify(E.cosmeticDashPx(style.dashMm))&&s.width===E.cosmeticWidthPx(style.widthMm)),'Preview did not use '+code+' stroke pattern.');}click('[data-action=cancel]');}
      finally{names.forEach((name,i)=>{if(descriptors[i])Object.defineProperty(context,name,descriptors[i]);else delete context[name];});}
    },
    focusAndCircle:async()=>{
      click('.student-focus-toggle');await choose('K');assert(!$('.student-line-type-toggle').hidden,'Focus removed line selection.');await paper(-40,40);await paper(20,40);equal(M.desk.table.findByType('SEGMENT')[0].bisCode,'K','Focus line ignored type.');click('[data-action=undo]');click('[data-tool=circle]');assert($('.student-line-type-toggle').hidden,'Line choices leaked into Circle.');await paper(-40,40);await paper(-20,40);equal(M.desk.table.findByType('CIRCLE')[0].bisCode,'A','Line choice unexpectedly changed circles.');click('[data-action=undo]');click('.student-focus-toggle');
    },
    shortcuts:async()=>{
      await prefs({drawingMode:'shortcuts'});await commands('/point a -40 40\n/point b 20 40\n/point c -10 70');const before=ink();
      for(const code of ['A','B','E','G','K']){await paper(-40,40,true);await paper(20,40);equal(ink(),before,'Shortcut committed before type selection.');equal(document.querySelectorAll('[data-shortcut-style] svg').length,5,'Shortcut choices lack stroke samples.');click('[data-shortcut-style='+code+']');await sleep(50);equal(M.desk.table.findByType('SEGMENT')[0].bisCode,code,'Shortcut line ignored its type.');equal(M.desk.presentation().lineType,code,'Shortcut choice was not remembered.');click('[data-action=undo]');equal(ink(),before,'Shortcut undo did not restore banked points.');}
      await paper(-40,40,true);await paper(20,40,true);await paper(-10,70);equal(M.desk.table.findByType('CIRCLE')[0].bisCode,'A','Shortcut circle inherited a line type.');click('[data-action=undo]');await prefs({drawingMode:'menu'});click('[data-tool=line]');assert($('.student-line-type-toggle').innerText.includes('Alternate'),'Draw menu lost the shortcut choice.');
    },
    preferencesSaveReview:async()=>{
      const before=ink();click('[data-canvas-customize]');await change('lineType','E');click('[data-canvas-cancel]');equal(M.desk.presentation().lineType,'K','Cancel failed to restore line type.');equal(ink(),before,'Workspace type preview edited geometry.');
      await prefs({lineType:'E'});await route('drawings/11');click('[data-tool=line]');await paper(-40,40);await paper(20,40);const saved=ink();click('[data-action=save]');await ready(()=>!M.desk.dirty()&&!$('[data-action=save]').disabled);await route('drawings/11');equal(ink(),saved,'Saved line did not reopen accurately.');equal(M.desk.table.findByType('SEGMENT')[0].bisCode,'E','Saved line lost its type.');assert(!$('dialog[open]'),'Reopening created a false draft.');
      const account=M.session();M.write('educad_session',{...account,username:'different-line-fixture',token:'different-line-token'});equal(M.canvasPreferences.read().lineType,'A','Line preference crossed accounts.');M.write('educad_session',account);await route('review/42');const review=ink();assert($('.student-line-type-toggle').hidden&&$('[data-tool=line]').disabled,'Review exposed line authoring.');click('[data-line-type=K]');equal(ink(),review,'Hidden type controls edited a submission.');await route('drawings/11');click('[data-tool=line]');
    },
    fallback:async()=>{
      const descriptor=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'showPopover');Object.defineProperty(HTMLElement.prototype,'showPopover',{value:undefined,configurable:true});
      try{await route('drawings/11');click('[data-tool=line]');assert(!$('#student-line-type-options').hasAttribute('popover'),'Legacy fallback was not selected.');const before=ink();await choose('G');equal(ink(),before,'Fallback selection edited geometry.');click('.student-line-type-toggle');document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));assert(!opened(),'Fallback did not dismiss outside clicks.');click('.student-line-type-toggle');$('#student-line-type-options').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert(!opened(),'Fallback did not dismiss Escape.');}
      finally{if(descriptor)Object.defineProperty(HTMLElement.prototype,'showPopover',descriptor);else delete HTMLElement.prototype.showPopover;}await route('drawings/11');click('[data-tool=line]');
    },
    layout:async()=>{
      let count=0;for(const theme of ['warm','blueprint','forest','lilac','midnight','sunlit']){M.applyTheme(theme);await choose('B');$('.student-line-type-toggle').scrollIntoView({block:'nearest'});click('.student-line-type-toggle');const popup=$('#student-line-type-options'),r=popup.getBoundingClientRect(),paperBox=$('.paper-area').getBoundingClientRect();assert(opened(),'Popup did not open after responsive layout.');assert(r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1,'Popup escaped the viewport.');assert([...popup.querySelectorAll('button')].every(button=>button.getBoundingClientRect().height>=44),'Type targets are too small.');assert(paperBox.height>=200&&paperBox.width>=200,'Line choices crowded out the paper.');assert(document.documentElement.scrollWidth<=innerWidth+1,'Page overflowed.');click('[data-line-type=E]');count++;}return{width:innerWidth,height:innerHeight,layouts:count,errors};
    }
  };
  window.__lineTypeChecks={setup,checks,results,errors,run:async name=>{await checks[name]();results.push(name);return{passed:name,errors};},layout:checks.layout};
})();

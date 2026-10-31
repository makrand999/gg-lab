(function(){
  'use strict';
  const M=window.Major2,e=M.escape;
  const defaults=Object.freeze({version:1,cursorDimensions:true,smartGuides:true,linkedHighlight:true,commandPalette:true,selectionActions:true,drawingLayers:false,checkpoints:true,sheetReview:true,assignmentFlow:true,drawingMode:'menu',lineType:'A',side:'right',width:320,density:'comfortable',guide:false,model:'hidden',modelPlacement:'docked',floatWidth:320,floatHeight:360,floatX:1,floatY:1,floatMinimized:false,focus:false,paper:'white',grid:true,gridSpacing:10,snap:false,snapSpacing:5,labels:true,labelSize:15,viewCaptions:true});
  const choices={drawingMode:['menu','shortcuts'],lineType:['A','B','E','G','K'],side:['right','left'],density:['comfortable','compact'],model:['compact','large','hidden'],modelPlacement:['docked','floating'],paper:['white','warm','blueprint','midnight'],gridSpacing:[5,10,20],snapSpacing:[1,2,5,10],labelSize:[12,15,18]};
  function normalize(value){
    const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{},result={...defaults};
    if(Object.hasOwn(source,'version')&&source.version!==1)return result;
    Object.keys(choices).forEach(key=>{if(Object.hasOwn(source,key)&&choices[key].includes(source[key]))result[key]=source[key];});
    ['cursorDimensions','smartGuides','linkedHighlight','commandPalette','selectionActions','drawingLayers','checkpoints','sheetReview','assignmentFlow','guide','focus','grid','snap','labels','viewCaptions','floatMinimized'].forEach(key=>{if(Object.hasOwn(source,key)&&typeof source[key]==='boolean')result[key]=source[key];});
    if(Object.hasOwn(source,'width')&&typeof source.width==='number'&&Number.isFinite(source.width))result.width=Math.round(Math.max(260,Math.min(420,source.width))/10)*10;
    [['floatWidth',260,560],['floatHeight',260,640],['floatX',0,1],['floatY',0,1]].forEach(([name,min,max])=>{if(Object.hasOwn(source,name)&&typeof source[name]==='number'&&Number.isFinite(source[name]))result[name]=name==='floatWidth'||name==='floatHeight'?Math.round(Math.max(min,Math.min(max,source[name]))):Math.max(min,Math.min(max,source[name]));});
    return result;
  }
  const key=()=> 'educad_major2_canvas_'+M.accountKey();
  const palettes={white:{bg:'#FDFEFC',ink:'#293F35',grid:'#E7EDE7',axis:'#617468',text:'#4D6155',accent:'#A8442E'},warm:{bg:'#FCF5E8',ink:'#3F3528',grid:'#EAE0CE',axis:'#71644E',text:'#3F3528',accent:'#A8442E'},blueprint:{bg:'#F4F8FF',ink:'#243B5A',grid:'#DFE8F5',axis:'#5B7193',text:'#243B5A',accent:'#2457C5'},midnight:{bg:'#171F2A',ink:'#EAF1FB',grid:'#2B3543',axis:'#8194AE',text:'#BFCBDD',accent:'#FFBDA5'}};
  M.canvasPreferences={defaults,palettes,normalize,key,read:()=>normalize(M.read(key(),defaults)),write:values=>M.write(key(),normalize(values))};
  const select=(name,label,items,value)=>`<label class="field"><span>${e(label)}</span><select name="${name}">${items.map(([id,text])=>`<option value="${id}" ${id===value?'selected':''}>${e(text)}</option>`).join('')}</select></label>`;
  const check=(name,label,value)=>`<label class="check-field"><input type="checkbox" name="${name}" ${value?'checked':''}><span>${e(label)}</span></label>`;
  M.mountStudentCanvas=function(screen,desk){
    const abort=new AbortController(),token=M.session()?.token,active=()=>screen.isConnected&&!abort.signal.aborted&&M.session()?.token===token;
    const listen=(host,event,fn)=>host.addEventListener(event,fn,{signal:abort.signal});
    const guide=M.$('.desk-guide',screen),body=M.$('.desk-body',screen),solid=M.$('#solid-panel',screen),pose=M.$('#pose-panel',screen);
    screen.classList.add('student-canvas');
    const dock=document.createElement('aside');dock.className='student-spatial-dock';dock.setAttribute('aria-label','3D support');dock.id='student-spatial-dock';
    const heading=document.createElement('div');heading.className='student-spatial-heading';
    const modelButton=document.createElement('button');modelButton.type='button';modelButton.className='button student-model-toggle';modelButton.innerHTML=M.icon('model')+'<span>3D</span>';modelButton.setAttribute('aria-controls','solid-panel');
    const source=document.createElement('span');source.className='student-spatial-source';source.setAttribute('role','status');
    heading.append(modelButton,source);dock.append(heading,M.$('#reference-switch',screen),solid,pose);body.append(dock);
    const header=M.$('.desk-header',screen),more=M.$('[data-action=desk-more]',header);
    const focus=document.createElement('button');focus.type='button';focus.className='button compact student-focus-toggle';focus.textContent='Focus';focus.setAttribute('aria-controls','student-spatial-dock');
    const customize=document.createElement('button');customize.type='button';customize.className='button compact';customize.dataset.canvasCustomize='';customize.innerHTML=M.icon('palette')+'<span>Workspace</span>';
    const spatialToggle=document.createElement('button');spatialToggle.type='button';spatialToggle.className='button compact';spatialToggle.dataset.canvasSpatial='';spatialToggle.textContent='3D';spatialToggle.setAttribute('aria-controls','student-spatial-dock');
    more.before(spatialToggle,focus,customize);
    // Keep these secondary controls compact without removing their accessible names.
    ['help','appearance'].forEach(name=>{const button=M.$('[data-action='+name+']',header);button.setAttribute('aria-label',name==='help'?'Help':'Appearance');button.title=button.getAttribute('aria-label');button.classList.add('student-header-icon');button.innerHTML=M.icon(name==='help'?'help':'palette');});
    [['fit','Fit view',M.icon('fit')],['zoom-in','Zoom in','<span aria-hidden="true">+</span>'],['zoom-out','Zoom out','<span aria-hidden="true">−</span>']].forEach(([action,label,html])=>{const button=M.$('[data-action='+action+']',screen);button.setAttribute('aria-label',label);button.title=label;button.classList.add('student-toolbar-icon');button.innerHTML=html;});
    const guideButton=M.$('[data-action=toggle-guide]',screen);
    const method=document.createElement('button');method.type='button';method.className='button student-method-switch';method.dataset.canvasMethod='';method.title='Choose drawing method';M.$('.desk-toolbar',screen).prepend(method);
    let prefs=desk.presentation(),spatial=desk.spatial(),settings=null,windowControls=null;
    function apply(value){
      if(!active())return;prefs=normalize(value);desk.setPresentation(prefs);
      screen.dataset.drawingMethod=prefs.drawingMode;method.textContent=prefs.drawingMode==='shortcuts'?'Shortcuts ▾':'Draw menu ▾';method.setAttribute('aria-label','Drawing method: '+(prefs.drawingMode==='shortcuts'?'Shortcuts':'Draw menu'));M.$$('[data-tool=point],[data-tool=line],[data-tool=circle]',screen).forEach(button=>button.hidden=button.disabled||prefs.drawingMode==='shortcuts');screen.dataset.canvasSide=prefs.side;screen.dataset.canvasDensity=prefs.density;screen.dataset.canvasFocus=String(prefs.focus);screen.dataset.canvasModel=prefs.model;screen.dataset.canvasPaper=prefs.paper;
      screen.style.setProperty('--student-panel-width',prefs.width+'px');
      guide.hidden=prefs.focus||!prefs.guide;body.classList.toggle('guide-hidden',guide.hidden);
      const floating=windowControls?.floating()||false,panelsHidden=prefs.focus||(!prefs.guide&&(prefs.model==='hidden'||floating));screen.dataset.canvasPanels=panelsHidden?'hidden':'visible';dock.hidden=prefs.focus||(!prefs.guide&&prefs.model==='hidden')||(floating&&prefs.model==='hidden');dock.dataset.modelHidden=String(prefs.model==='hidden');
      guideButton.setAttribute('aria-expanded',String(!guide.hidden));guideButton.textContent=guide.hidden?'Show guide':'Hide guide';
      focus.setAttribute('aria-pressed',String(prefs.focus));focus.textContent=prefs.focus?'Exit focus':'Focus';
      const colors=M.canvasPreferences.palettes[prefs.paper];Object.entries(colors).forEach(([name,color])=>screen.style.setProperty('--student-paper-'+name,color));
      updateSpatial();
    }
    function remember(){if(!active())return;if(!M.canvasPreferences.write(prefs))M.toast('Workspace preferences apply for this session. Device storage is unavailable.',true);}
    function updateSpatial(){
      if(!active())return;spatial=desk.spatial();dock.dataset.available=String(spatial.available);
      const open=prefs.model!=='hidden'&&(spatial.available||prefs.model==='large');
      solid.hidden=!open;pose.hidden=!open;spatialToggle.setAttribute('aria-expanded',String(open&&!prefs.focus));
      modelButton.setAttribute('aria-expanded',String(open));
      modelButton.setAttribute('aria-label',open?'Hide 3D support':'Show 3D support');
      const text=spatial.source==='teacher'?'Teacher reference':spatial.available?'From your drawing':'3D not available yet';if(source.textContent!==text)source.textContent=text;
      // A permitted reference remains reachable even while the student's model is incomplete.
      const reference=M.$('#reference-switch',screen);
      if(reference)reference.hidden=!spatial.referenceAllowed||prefs.model==='hidden';windowControls?.update();
    }
    listen(focus,'click',()=>{apply({...prefs,focus:!prefs.focus});remember();});
    listen(guideButton,'click',()=>{apply({...prefs,focus:false,guide:guide.hidden});remember();});
    listen(spatialToggle,'click',()=>{apply({...prefs,focus:false,model:prefs.model==='hidden'||prefs.focus?(spatial.available?'compact':'large'):'hidden'});remember();});
    listen(modelButton,'click',()=>{apply({...prefs,model:prefs.model==='hidden'?(spatial.available?'compact':'large'):prefs.model==='compact'&&!spatial.available?'large':'hidden'});remember();});
    listen(screen,'student-spatial-change',()=>{const next=desk.spatial();if(next.mode==='pose'&&(prefs.focus||prefs.model==='hidden'||prefs.floatMinimized))apply({...prefs,focus:false,model:'compact',floatMinimized:false});else updateSpatial();});
    listen(screen,'student-canvas-preferences',event=>apply(event.detail));
    function openSettings(methodFocus=false){
      if(!active()||settings?.open)return;
      const original={...prefs},dialog=document.createElement('dialog');settings=dialog;dialog.className='dialog student-canvas-dialog';
      dialog.innerHTML=`<form><div class="student-settings-heading"><h2>Your drawing desk.</h2><p>Preview your workspace. Your drawing stays intact.</p></div><div class="student-settings-presets" role="group" aria-label="Workspace presets"><button type="button" data-canvas-preset="guided">Guided</button><button type="button" data-canvas-preset="quiet">Quiet</button><button type="button" data-canvas-preset="technical">Technical</button></div><fieldset><legend>Drawing</legend>${select('drawingMode','Drawing method',[['menu','Draw menu'],['shortcuts','Shortcuts']],prefs.drawingMode)}${select('lineType','Default line type',M.lineTypes.items.map(item=>[item.code,item.name]),prefs.lineType)}<p class="student-method-help">Choose a tool, then draw on the paper.</p><details class="student-shortcut-help"><summary>Shortcut gestures</summary><dl><dt>Click</dt><dd>Place a point or select an existing point</dd><dt>Ctrl/Cmd + click</dt><dd>Bank a point · one + another point: line · two + a third: circle</dd><dt>Double-click</dt><dd>Rename a point</dd><dt>Aim + type + Enter</dt><dd>Place an exact distance on X or Y from the selected point</dd><dt>Escape</dt><dd>Cancel the current gesture</dd><dt>Tab on paper</dt><dd>Enter or exit the model preview</dd><dt>/</dt><dd>Open precise commands</dd></dl></details></fieldset><fieldset><legend>Drafting aids</legend><p class="small muted">Choose the tools you want on your desk. Preferences are saved for your account on this device.</p><div class="student-settings-checks">${check('cursorDimensions','Dimensions beside the cursor',prefs.cursorDimensions)}${check('smartGuides','Smart alignment & object snaps',prefs.smartGuides)}${check('linkedHighlight','Linked 2D / 3D highlighting',prefs.linkedHighlight)}${check('commandPalette','Find tool · Ctrl/Cmd+K',prefs.commandPalette)}${check('selectionActions','Selection action bar',prefs.selectionActions)}${check('drawingLayers','Drawing layers · show / lock',prefs.drawingLayers)}${check('checkpoints','Named device checkpoints',prefs.checkpoints)}${check('sheetReview','Sheet review suggestions',prefs.sheetReview)}${check('assignmentFlow','Pinned brief & assignment steps',prefs.assignmentFlow)}</div></fieldset><fieldset><legend>Layout</legend><div class="form-grid">${select('side','Panel side',[['right','Right'],['left','Left']],prefs.side)}${select('model','3D support',[['compact','Compact'],['large','Expanded'],['hidden','Hidden']],prefs.model)}${select('modelPlacement','3D placement',[['docked','Docked'],['floating','Floating · desktop']],prefs.modelPlacement)}${select('density','UI density',[['comfortable','Comfortable'],['compact','Compact']],prefs.density)}<label class="field"><span>Panel width <output data-panel-width>${prefs.width} px</output></span><input name="width" type="range" min="260" max="420" step="10" value="${prefs.width}"></label></div><div class="student-settings-checks">${check('guide','Show task & tools',prefs.guide)}${check('focus','Focus on paper',prefs.focus)}</div><details class="student-window-settings"><summary>Floating window</summary><div class="form-grid"><label class="field"><span>Window width (px)</span><input name="floatWidth" type="number" min="260" max="560" step="1" value="${prefs.floatWidth}"></label><label class="field"><span>Window height (px)</span><input name="floatHeight" type="number" min="260" max="640" step="1" value="${prefs.floatHeight}"></label></div>${check('floatMinimized','Start minimized',prefs.floatMinimized)}<button type="button" class="button compact" data-window-reset>Reset window position & size</button></details></fieldset><fieldset><legend>Paper & labels</legend><div class="form-grid">${select('paper','Paper palette',[['white','Clear white'],['warm','Warm ivory'],['blueprint','Cool blue'],['midnight','Dark paper']],prefs.paper)}${select('labelSize','Label size',[[12,'Small · 12 px'],[15,'Medium · 15 px'],[18,'Large · 18 px']],prefs.labelSize)}</div><div class="student-settings-checks">${check('labels','Point labels',prefs.labels)}${check('viewCaptions','View captions',prefs.viewCaptions)}</div></fieldset><fieldset><legend>Grid & precision</legend><div class="form-grid">${select('gridSpacing','Grid spacing',[[5,'5 mm'],[10,'10 mm'],[20,'20 mm']],prefs.gridSpacing)}${select('snapSpacing','Snap spacing',[[1,'1 mm'],[2,'2 mm'],[5,'5 mm'],[10,'10 mm']],prefs.snapSpacing)}</div><div class="student-settings-checks">${check('grid','Show grid',prefs.grid)}${check('snap','Snap new placements to grid',prefs.snap)}</div></fieldset><div class="student-settings-actions"><button type="button" class="student-link" data-canvas-reset>Reset workspace</button><div class="actions"><button type="button" class="button" data-canvas-cancel>Cancel</button><button type="submit" class="button primary">Save preferences</button></div></div></form>`;
      let saved=false,settled=false;
      function finish(){if(settled)return;settled=true;if(!saved&&active())apply(original);dialog.remove();if(settings===dialog)settings=null;}
      function populate(value){Object.keys(defaults).forEach(name=>{const field=dialog.querySelector('[name='+name+']');if(!field)return;if(field.type==='checkbox')field.checked=value[name];else field.value=value[name];});M.$('[data-panel-width]',dialog).textContent=value.width+' px';}
      function help(){M.$('.student-method-help',dialog).textContent=M.$('[name=drawingMode]',dialog).value==='shortcuts'?'Click to place. Ctrl/Cmd-click to bank points.':'Choose a tool, then draw on the paper.';}
      function preview(){const values={...prefs};M.$$('input,select',dialog).forEach(field=>{values[field.name]=field.type==='checkbox'?field.checked:['width','labelSize','gridSpacing','snapSpacing','floatWidth','floatHeight'].includes(field.name)?Number(field.value):field.value;});apply({...values,drawingMode:original.drawingMode});M.$('[data-panel-width]',dialog).textContent=prefs.width+' px';help();}
      dialog.addEventListener('input',preview);dialog.addEventListener('change',preview);
      M.$$('[data-canvas-preset]',dialog).forEach(button=>button.onclick=()=>{const preset=button.dataset.canvasPreset;const value=preset==='quiet'?{...defaults,focus:true,grid:false,cursorDimensions:false,smartGuides:false,linkedHighlight:false,selectionActions:false,checkpoints:false,sheetReview:false,assignmentFlow:false}:preset==='technical'?{...defaults,density:'compact',gridSpacing:5,snap:true}:{...defaults,guide:true,model:'compact'};apply({...value,drawingMode:original.drawingMode});populate(value);help();});
      M.$('[data-canvas-reset]',dialog).onclick=()=>{apply({...defaults,drawingMode:original.drawingMode});populate(defaults);help();};
      M.$('[data-window-reset]',dialog).onclick=()=>{apply({...prefs,floatWidth:defaults.floatWidth,floatHeight:defaults.floatHeight,floatX:defaults.floatX,floatY:defaults.floatY,floatMinimized:false});populate({...prefs,drawingMode:M.$('[name=drawingMode]',dialog).value});};
      M.$('[data-canvas-cancel]',dialog).onclick=()=>{dialog.close();finish();};
      dialog.oncancel=event=>{event.preventDefault();dialog.close();finish();};
      M.$('form',dialog).onsubmit=event=>{event.preventDefault();preview();apply({...prefs,drawingMode:M.$('[name=drawingMode]',dialog).value});saved=true;remember();dialog.close();finish();};
      dialog.onclose=finish;
      M.$('#dialogs').append(dialog);dialog.showModal();help();if(methodFocus)M.$('[name=drawingMode]',dialog).focus();
    }
    listen(customize,'click',()=>openSettings());listen(method,'click',()=>openSettings(true));
    windowControls=M.mountCanvasWindow(screen,dock,{get:()=>prefs,spatial:()=>spatial,set:patch=>apply({...prefs,...patch}),remember,onLayout:()=>apply(prefs)});
    if(['practice','feedback'].includes(screen.dataset.studentDesk))prefs={...prefs,guide:true,focus:false};
    if(screen.dataset.studentDesk==='practice'&&spatial.available)prefs={...prefs,model:'compact'};
    apply(prefs);
    return {dispose:()=>{windowControls.dispose();abort.abort();if(settings){settings.close();settings.remove();settings=null;}}};
  };
})();

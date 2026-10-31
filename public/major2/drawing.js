(function () {
  'use strict';
  const M = window.Major2, E = window.EduCADEntities, D = window.EduCADDrafting, S = window.EduCADSaves;
  const esc = M.escape;
  const clone = value => JSON.parse(JSON.stringify(value));
  const number = (value, label = 'Value') => { const n = Number(value); if (value === '' || !Number.isFinite(n) || Math.abs(n) > 100000) throw new Error(label + ' must be a number between −100,000 and 100,000.'); return n; };
  const numeric = (name, label, value = 0, attrs = '') => M.field(name,label,value,{type:'number',required:true,attrs:'step="any" ' + attrs});
  const role = y => y < 0 ? 'PLAN' : 'ELEVATION';
  const nameOf = entity => entity.caption || entity.name || entity.id;
  const tools = { select:['Select','Choose an object to inspect or edit it.','select'], point:['Point','Click on the paper to place a point.','point'], line:['Line','Click the first point of your line.','line'], circle:['Circle','Click the center of your circle.','circle'], measure:['Measure','Click the first point to measure from.','measure'], pan:['Move paper','Drag the paper to move your view.','pan'] };

  M.openDrawing = function (root, options) {
    const opts = {...options}, table = E.createTable(), account = M.accountKey();
    const mobile = EduCADMobile.detectFromWindow(window).touchOnly;
    const locked = !!opts.readOnly || mobile || opts.lesson === 'solid';
    let assist=null;
    let disposed = false, tool = locked ? 'select' : 'point', mode = locked ? 'inspect' : 'draw';
    let presentation=M.session()?.role==='student'?M.canvasPreferences.read():null;
    let shortcutBank=[],shortcutLine=null,shortcutTyped=EduCADCanvas.createTypedDistState(),shortcutReturnMode='draw';
    let anchor = null, cursor = null, selected = null, snapGrid = presentation?.snap??false, showGrid = presentation?.grid??true, dragging = null;
    const palette=()=>presentation?M.canvasPreferences.palettes[presentation.paper]:{bg:'#FDFEFC',ink:'#293F35',grid:'#E7EDE7',axis:'#617468',text:'#4D6155',accent:'#A8442E'};
    const labelSize=()=>presentation?.labelSize||15;
    let view, widget, geometry = null, pose = EduCADPose.createPose(), posed = null;
    let hasOrbit = false, measured = false, lessonStep = 0, lessonDone = false, version = 0, savePending = false;
    let baseline, localFailure = false, persistTimer, updateTimer, frame;
    let draftKey = opts.draftKey ? 'educad_major2_draft_' + account + '/' + opts.draftKey : null;
    const sessionToken = M.session()?.token;
    const alive = () => !disposed && root.isConnected && M.session()?.token === sessionToken;
    const snapshot = () => S.snapshotTable(table);
    const fingerprint = () => JSON.stringify(snapshot().entities);
    const editable = () => !locked && mode === 'draw' && alive();
    const assertEditable = () => { if (!editable()) throw new Error(mobile ? 'Open this drawing on a computer with a mouse or trackpad to edit it.' : 'Choose Draw to edit your drawing.'); };
    function restore(data) { S.restoreTable(E,table,{version:1,entities:data?.entities || []}); }
    if (opts.lesson === 'solid') opts.data = {entities:EduCADCurriculum.regularSolid({solid:'PRISM',sizeMm:45,heightMm:70}).entities};
    restore(opts.data);
    baseline = fingerprint();
    const history = D.createHistory(table,entities=>restore({entities}),()=>{if(alive()) updateUndo();});
    function commit(work) { assertEditable(); const before=assist?snapshot().entities:null; history.begin(); try { work(); if(assist)assist.guard(before,snapshot().entities); history.end(); } catch(error) { history.cancel(); throw error; } }
    function make(type, values) { return table.create(type,{id:'M2-' + crypto.randomUUID(),...values}); }
    function pointAt(p, label) {
      if(p.id && table.get(p.id)?.type==='POINT') return table.get(p.id);
      const r=role(p.y), caption=label || EduCADCanvas.nextPointName(table.list().filter(e=>e.viewRole===r).map(e=>({...e,caption:e.caption.replace(/['’′]/g,'')})))+(r==='ELEVATION'?"'":'');
      if(table.list().some(e=>e.type==='POINT'&&nameOf(e)===caption))throw new Error('That point name is already used. Choose another name.');
      return make('POINT',{x:p.x,y:p.y,caption,name:caption,showLabel:true,viewRole:r});
    }
    const primary = opts.model ? M.button('Save model answer','save-model','primary','save') : opts.setCode ? M.button('Submit drawing','submit','primary','arrow') : '';
    root.innerHTML = `<main class="drawing-screen" id="main-content" tabindex="-1"><header class="desk-header">${M.button('Back','desk-back','compact','back')}<div class="desk-title"><strong id="desk-title">${esc(opts.title)}</strong><span>${opts.model?'Private model answer':opts.readOnly?'Submitted drawing · inspection':opts.lesson?'Guided practice':'Your drawing workspace'}</span></div>${M.button('Help','help','compact','help')}${M.button('Appearance','appearance','compact','palette')}${M.button('Guide','toggle-guide','compact')}${M.button('More','desk-more','compact')}</header><div class="desk-toolbar" role="group" aria-label="Drawing tools">${Object.entries(tools).map(([key,[label,,icon]])=>`<button type="button" class="button ${tool===key?'active':''}" data-tool="${key}" aria-pressed="${tool===key}" ${locked&&!['select','measure','pan'].includes(key)?'disabled':''}>${M.icon(icon)}${label}</button>`).join('')}<span class="toolbar-spacer"></span>${M.button('Undo','undo','','undo')}${M.button('Redo','redo','','redo')}${M.button('Fit view','fit','','fit')}${M.button('Zoom in','zoom-in','')}${M.button('Zoom out','zoom-out','')}</div><div class="desk-body"><div class="paper-area"><span class="paper-caption">Drawing paper · all distances in mm</span><canvas tabindex="0" aria-label="Engineering drawing paper. Use Point, Line, Circle, or the coordinates form to draw."></canvas><span class="coords">X 0.0 · Y 0.0 mm</span></div><aside class="desk-guide" aria-label="Drawing instructions"><div id="task-panel"></div><section class="step-box" aria-live="polite"><strong id="tool-title"></strong><p id="tool-instruction"></p>${M.button('Cancel current step','cancel','compact')}</section><div id="tool-options"></div><div id="properties" class="properties"></div><section id="solid-panel"><h3 id="solid-title">Your 3D view</h3><div class="reference-host" id="desk-solid"></div><p id="solid-message" class="muted small"></p><div class="actions">${M.button('Reset view','orbit-reset','compact')}${M.button('Rotate left','orbit-left','compact')}</div><label class="check-field" id="reference-switch" hidden><input type="checkbox" name="show-reference">Show teacher's reference</label></section><div id="pose-panel"></div><details class="page-section"><summary>Objects on the paper</summary><div id="object-list" class="object-list"></div></details>${!locked?`<details class="command-box"><summary>Precise drawing tools</summary><p class="small muted">Commands are optional. Try <code>/point a 0 -30</code>, then <code>/point b 40 -30</code> and <code>/line a b</code>.</p><form id="command-form">${M.field('commands','Commands','',{textarea:true,max:12000})}<div class="notice error form-error" tabindex="-1" hidden></div><button class="button full" type="submit">Apply commands</button></form><p class="small" id="command-result" role="status"></p></details>`:''}<div id="review-panel"></div></aside></div><footer class="desk-footer"><div class="mode-switch" role="group" aria-label="Workspace mode">${[['draw','Draw'],['inspect','Inspect'],['pose','Move model']].map(([key,label])=>`<button type="button" class="button ${mode===key?'active':''}" data-mode="${key}" aria-pressed="${mode===key}" ${key==='draw'&&locked?'disabled':''}>${label}</button>`).join('')}</div><span class="save-indicator" id="save-state" role="status"></span><div class="actions">${!opts.readOnly?M.button(M.guest()?'Download drawing':'Save drawing','save','', 'save'):''}${opts.setCode&&!opts.model&&opts.question?.check_enabled?M.button('Check drawing','verify',''):''}${primary}</div></footer></main>`;
    const screen=M.$('.drawing-screen',root), canvas=M.$('canvas',root), paper=M.$('.paper-area',root), ctx=canvas.getContext('2d');
    const starter=document.createElement('section');starter.className='desk-starter';starter.setAttribute('aria-label','Start your drawing');
    starter.innerHTML='<span class="kicker">A blank sheet. A clear start.</span><h2>Build your first view.</h2><p>Place points above XY for the front view, or below it for the top view. Then connect them with lines.</p><div class="actions">'+M.button('Place a point','start-point','compact primary','point')+M.button('Use coordinates','start-coordinates','compact')+'</div>';
    paper.append(starter);
    function updateStarter(){starter.hidden=locked||!!opts.question||!!opts.lesson||mode!=='draw'||!!anchor||table.count()>0||tool!=='point'||presentation?.drawingMode==='shortcuts';}
    // Keep the current drawing step visible even when the guide is closed.
    const context=document.createElement('div');context.className='desk-context';
    const step=M.$('.step-box',screen);step.classList.add('desk-current-step');
    context.append(step);
    const precision=document.createElement('div');precision.className='desk-precision';
    precision.setAttribute('role','group');precision.setAttribute('aria-label','Grid and snapping');
    precision.innerHTML=M.button('Grid','quick-grid','compact')+M.button('Snap off','quick-snap','compact');
    const precisionMenu=document.createElement('details');precisionMenu.className='desk-precision-menu';
    precisionMenu.innerHTML='<summary>Precision</summary>';precisionMenu.append(precision);
    context.insertAdjacentHTML('beforeend',M.button('Tool options','show-tool-options','compact')+M.button('Properties','show-properties','compact'));
    context.append(precisionMenu);M.$('.desk-toolbar',screen).after(context);
    if(opts.question)context.insertAdjacentHTML('beforeend',M.button('Question','show-question','compact'));
    canvas.setAttribute('aria-describedby','tool-instruction');
    M.$('[data-action=cancel]',screen).textContent='Cancel · Esc';
    function disclosure(host,label,open=false){
      const section=document.createElement('details');section.className='desk-disclosure';section.open=open;
      const summary=document.createElement('summary');summary.textContent=label;section.append(summary);
      host.before(section);section.append(host);return section;
    }
    const taskDisclosure=disclosure(M.$('#task-panel',screen),opts.lesson?'Practice steps':opts.question?'Question':'Drawing guide',!!opts.lesson);
    const propertiesDisclosure=disclosure(M.$('#properties',screen),'Selected object',true);
    const solidDisclosure=!presentation?disclosure(M.$('#solid-panel',screen),'3D view',opts.lesson==='solid'):null;
    const toolsDisclosure=disclosure(M.$('#tool-options',screen),'Tool options');
    function revealGuide(section){
      if(M.$('.desk-guide',screen).hidden)M.$('[data-action=toggle-guide]',screen).click();
      section.open=true;section.scrollIntoView({block:'nearest'});
    }
    function updateContext(){
      const hasTools=!!M.$('#tool-options',screen).childElementCount;
      toolsDisclosure.hidden=!hasTools;
      propertiesDisclosure.hidden=!M.$('#properties',screen).childElementCount||tool!=='select';
      const optionsButton=M.$('[data-action=show-tool-options]',screen),propertiesButton=M.$('[data-action=show-properties]',screen);
      optionsButton.setAttribute('aria-controls','tool-options');propertiesButton.setAttribute('aria-controls','properties');
      const questionButton=M.$('[data-action=show-question]',screen);if(questionButton){questionButton.setAttribute('aria-controls','task-panel');questionButton.setAttribute('aria-expanded',String(taskDisclosure.open&&!M.$('.desk-guide',screen).hidden));}
      optionsButton.hidden=!hasTools;propertiesButton.hidden=propertiesDisclosure.hidden;
      optionsButton.textContent=tool==='point'?'Coordinates':tool==='line'?'Exact length':tool==='circle'?'Exact radius':'Tool options';
      optionsButton.setAttribute('aria-expanded',String(toolsDisclosure.open&&!M.$('.desk-guide',screen).hidden));
      propertiesButton.setAttribute('aria-expanded',String(propertiesDisclosure.open&&!M.$('.desk-guide',screen).hidden));
    }
    const toolbar=M.$('.desk-toolbar',screen);
    function groupControls(label,selectors){
      const group=document.createElement('div');group.className='desk-tool-group';
      group.setAttribute('role','group');group.setAttribute('aria-label',label);
      const buttons=selectors.map(selector=>M.$(selector,toolbar));buttons[0].before(group);group.append(...buttons);
    }
    groupControls('Drawing tools',Object.keys(tools).map(key=>'[data-tool='+key+']'));
    groupControls('Drawing history',['[data-action=undo]','[data-action=redo]']);
    groupControls('Paper view',['[data-action=fit]','[data-action=zoom-in]','[data-action=zoom-out]']);
    const viewMenu=disclosure(M.$('[aria-label="Paper view"]',toolbar),'View');viewMenu.classList.add('desk-view-menu');
    function updatePrecision(){
      const grid=M.$('[data-action=quick-grid]',screen),snap=M.$('[data-action=quick-snap]',screen);
      grid.setAttribute('aria-pressed',String(showGrid));grid.title='Show or hide the drawing grid';
      snap.setAttribute('aria-pressed',String(snapGrid));snap.textContent=snapGrid?'Snap '+(presentation?.snapSpacing||5)+' mm':'Snap off';
      snap.title='Snap new placements to the grid';snap.disabled=locked||mode!=='draw';snap.hidden=snap.disabled;
    }
    widget=M.solid(M.$('#desk-solid',root),null,{fitToHost:!!presentation,interactive:!!presentation,drawOverlay:(ctx,st)=>assist?.drawSolid(ctx,st),onOrbit:()=>{hasOrbit=true;updateLesson();}});
    EduCADSolid.setUnavailable(widget,'Draw matching front and top views to build a 3D view.','No 3D view yet');
    const bind = (action, work) => M.bind(screen,action,work);
    const abort = new AbortController();
    const listen = (target,event,fn,extra={}) => target.addEventListener(event,fn,{...extra,signal:abort.signal});
    bind('start-point',()=>{starter.hidden=true;canvas.focus({preventScroll:true});});
    bind('start-coordinates',()=>{revealGuide(toolsDisclosure);M.$('#point-form [name=x]',screen)?.focus();});
    const deskMenus=[viewMenu,precisionMenu];
    function positionMenu(menu){
      const panel=menu.querySelector(':scope > div'),rect=menu.querySelector('summary').getBoundingClientRect();
      panel.style.left=Math.max(8,Math.min(rect.right-panel.offsetWidth,innerWidth-panel.offsetWidth-8))+'px';
      panel.style.top=rect.bottom+4+'px';
    }
    deskMenus.forEach(menu=>listen(menu,'toggle',()=>{if(menu.open){deskMenus.filter(other=>other!==menu).forEach(other=>other.open=false);positionMenu(menu);}}));
    listen(window,'resize',()=>deskMenus.forEach(menu=>{if(menu.open)positionMenu(menu);}));
    listen(document,'pointerdown',event=>deskMenus.forEach(menu=>{if(menu.open&&!menu.contains(event.target))menu.open=false;}));
    listen(screen,'keydown',event=>{if(event.key==='Escape'){const menu=deskMenus.find(menu=>menu.open);if(menu){event.preventDefault();event.stopPropagation();menu.open=false;menu.querySelector('summary').focus();}}});
    const contextObserver=new MutationObserver(updateContext);
    [M.$('#tool-options',screen),M.$('#properties',screen)].forEach(host=>contextObserver.observe(host,{childList:true}));
    contextObserver.observe(M.$('.desk-guide',screen),{attributes:true,attributeFilter:['hidden']});
    [toolsDisclosure,propertiesDisclosure,taskDisclosure].forEach(section=>listen(section,'toggle',updateContext));
    bind('show-question',()=>{if(taskDisclosure.open&&!M.$('.desk-guide',screen).hidden)taskDisclosure.open=false;else revealGuide(taskDisclosure);});
    bind('show-tool-options',()=>{if(toolsDisclosure.open&&!M.$('.desk-guide',screen).hidden)toolsDisclosure.open=false;else{revealGuide(toolsDisclosure);const inner=M.$('details',toolsDisclosure);if(inner)inner.open=true;}updateContext();});
    bind('show-properties',()=>{if(propertiesDisclosure.open&&!M.$('.desk-guide',screen).hidden)propertiesDisclosure.open=false;else revealGuide(propertiesDisclosure);updateContext();});
    function safely(fn) { try { fn(); } catch(error) { M.toast(M.errorText(error),true); } }
    function paintSoon() { if(!frame&&!disposed)frame=requestAnimationFrame(()=>{frame=null;if(alive())paint();}); }
    function persist() {
      if(!draftKey || locked || !alive())return;
      localFailure=!M.write(draftKey,{data:snapshot(),title:opts.title,id:opts.id||null,updatedAt:Date.now(),base:baseline,lessonStep});
      updateSave();
    }
    function updateSave() {
      const dirty=fingerprint()!==baseline;
      M.$('#save-state',screen).dataset.state=savePending?'saving':localFailure?'error':dirty?'draft':'saved';
      M.$('#save-state',screen).textContent=savePending?'Saving…':localFailure?'Device draft unavailable':dirty?(M.guest()?'Guest draft on this device':'Draft on this device · save to account'):opts.readOnly?'Submitted copy':opts.id?'Saved to your account':'Ready to draw';
    }
    function updateUndo() {
      const counts=history.counts();
      M.$('[data-action=undo]',screen).disabled=!editable()||!counts.undo;
      M.$('[data-action=redo]',screen).disabled=!editable()||!counts.redo;
    }
    function recompute() {
      if(!alive())return;
      let result;try{result=EduCADReconstruct.reconstructLive(table.list());}catch(error){result={status:'unavailable',reason:error.message};}
      geometry=result.status==='ok'?result.geometry:null;
      if(!geometry)pose=EduCADPose.createPose();
      updateStarter();updateSolid();updateObjects();updateSave();updateUndo();updateLesson();assist?.update();paintSoon();
    }
    const unsubscribe=table.subscribe(()=>{version++;pose=EduCADPose.createPose();clearTimeout(persistTimer);persistTimer=setTimeout(persist,250);clearTimeout(updateTimer);updateTimer=setTimeout(recompute,30);paintSoon();});
    function spatialState(){const referenceAllowed=!!(opts.question?.show_3d&&opts.question.model3d?.status==='ok'),ref=mode!=='pose'&&referenceAllowed&&!!M.$('[name=show-reference]',screen)?.checked;return {available:ref||!!geometry,source:ref?'teacher':geometry?'student':'unavailable',referenceAllowed,mode};}
    function setPresentation(value){if(!presentation||!alive())return;const previous=presentation.drawingMode;presentation=M.canvasPreferences.normalize(value);showGrid=presentation.grid;snapGrid=presentation.snap;if(previous!==presentation.drawingMode){cancelShortcut();anchor=null;selected=null;tool=mode==='draw'&&presentation.drawingMode==='shortcuts'?'point':'select';updateTool();updateProperties();updateObjects();}lineTypeControls?.update();updatePrecision();assist?.update();widget?.draw();paintSoon();}
    function rememberPresentation(patch){if(!presentation)return;setPresentation({...presentation,...patch});if(!M.canvasPreferences.write(presentation))M.toast('Workspace preferences apply for this session. Device storage is unavailable.',true);screen.dispatchEvent(new CustomEvent('student-canvas-preferences',{detail:{...presentation}}));}
    function updateSolid() {
      const ref=mode!=='pose'&&M.$('[name=show-reference]',screen)?.checked&&opts.question?.show_3d&&opts.question?.model3d?.status==='ok'?opts.question.model3d.geometry:null;
      posed=geometry?{...geometry,vertices:EduCADPose.applyPose(geometry.vertices,mode==='pose'?pose:EduCADPose.createPose(),EduCADPose.bboxCenter(geometry.vertices))}:null;
      M.$('#solid-title',screen).textContent=ref?"Teacher's 3D reference":'Your 3D view';
      if(ref||posed){if(ref)EduCADSolid.setGeometry(widget,ref);else{const rest=EduCADSolid.normalizeGeometry(geometry);const stage=EduCADSolid.createGeometry({...posed,vertices:EduCADPose.stageWithRest(posed.vertices,rest.transform)});EduCADSolid.setGeometry(widget,stage,{normalize:false});widget.state.geometryMm=posed;widget.state.geometryTransform=rest.transform;}M.$('#solid-message',screen).textContent=presentation?(ref?'Teacher reference. Drag to look around.':mode==='pose'?'Moving the preview. Your drawing stays unchanged.':'Drag to look around.'):(ref?'Drag to look around. The model answer stays private.':'Drag to look around. Move model changes the preview; your drawing stays saved in its original position.');}
      else{EduCADSolid.setUnavailable(widget,presentation?'Connect corresponding front and top points.':'Add matching named points in the front and top views.','No 3D view yet');M.$('#solid-message',screen).textContent=presentation?'Matching views need drawn projectors. Some constructions have no 3D preview.':'A 3D view needs matching front and top information. A single view is not enough.';}
      M.$('[data-mode=pose]',screen).disabled=!geometry;
      M.$('[data-action=orbit-left]',screen).disabled=!(ref||geometry);
      M.$('[data-action=orbit-reset]',screen).disabled=!(ref||geometry);
      if(opts.question?.show_3d&&opts.question.model3d?.status==='ok')M.$('#reference-switch',screen).hidden=false;M.$('[name=show-reference]',screen).disabled=mode==='pose';
      if(mode==='pose'&&!geometry)setMode('inspect');
      if(presentation)screen.dispatchEvent(new CustomEvent('student-spatial-change',{detail:spatialState()}));
    }
    function transform(x,y){return{x:x*view.s+view.tx,y:view.ty-y*view.s};}
    function inverse(p){return{x:(p.x-view.tx)/view.s,y:(view.ty-p.y)/view.s};}
    function line(a,b){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    function renderEntity(entity, color) {
      if(entity.visible===false||assist&&!assist.shown(entity))return;
      const a=transform(entity.x,entity.y),b=transform(entity.x2,entity.y2),style=E.resolveStyle(entity);
      ctx.save();ctx.strokeStyle=color||entity.color||palette().ink;ctx.fillStyle=ctx.strokeStyle;ctx.lineWidth=E.cosmeticWidthPx(style.widthMm);ctx.setLineDash(E.cosmeticDashPx(style.dashMm));
      if(entity.type==='POINT'){ctx.setLineDash([]);ctx.beginPath();ctx.arc(a.x,a.y,3.2,0,Math.PI*2);ctx.fill();}
      else if(entity.type==='CIRCLE'||entity.type==='CIRCULAR_ARC'){ctx.beginPath();ctx.arc(a.x,a.y,Math.abs(entity.radius*view.s),entity.type==='CIRCLE'?0:-entity.startAngle*Math.PI/180,entity.type==='CIRCLE'?Math.PI*2:-entity.endAngle*Math.PI/180,entity.type!=='CIRCLE');ctx.stroke();}
      else if(entity.type==='TEXT')EduCADCanvas.drawKnockoutLabel(ctx,entity.caption||entity.meta?.text||'',a.x,a.y,{font:'15px system-ui',haloStyle:palette().bg,fillStyle:ctx.fillStyle});
      else if(entity.type==='DIMENSION'){
        const len=Math.hypot(b.x-a.x,b.y-a.y);if(len>0){const ux=(b.x-a.x)/len,uy=(b.y-a.y)/len,offset=(entity.meta?.offsetMm??10)*view.s,nx=-uy*offset,ny=ux*offset,aa={x:a.x+nx,y:a.y+ny},bb={x:b.x+nx,y:b.y+ny};line(a,aa);line(b,bb);line(aa,bb);[ [aa,1],[bb,-1] ].forEach(([p,s])=>{line(p,{x:p.x+ux*7*s-uy*3,y:p.y+uy*7*s+ux*3});line(p,{x:p.x+ux*7*s+uy*3,y:p.y+uy*7*s-ux*3});});EduCADCanvas.drawKnockoutLabel(ctx,entity.caption||((len/view.s).toFixed(1)+' mm'),(aa.x+bb.x)/2+4,(aa.y+bb.y)/2-6,{font:'14px system-ui',haloStyle:palette().bg,fillStyle:presentation?ctx.fillStyle:undefined});}
      }
      else {
        let aa=a,bb=b;
        if(['LINE','RAY'].includes(entity.type)&&entity.meta?.kind!=='axis') {const d=Math.hypot(b.x-a.x,b.y-a.y);if(d>0){const u={x:(b.x-a.x)/d,y:(b.y-a.y)/d},reach=Math.max(view.w,view.h)*4;bb={x:a.x+u.x*reach,y:a.y+u.y*reach};if(entity.type==='LINE')aa={x:a.x-u.x*reach,y:a.y-u.y*reach};}}
        line(aa,bb);
      }
      if(entity.id===selected){ctx.setLineDash([]);ctx.strokeStyle=palette().accent;ctx.lineWidth=2;if(entity.type==='POINT'){ctx.beginPath();ctx.arc(a.x,a.y,9,0,2*Math.PI);ctx.stroke();}else{ctx.globalAlpha=.6;ctx.lineWidth=5;if(['CIRCLE','CIRCULAR_ARC'].includes(entity.type)){ctx.beginPath();ctx.arc(a.x,a.y,Math.abs(entity.radius*view.s),0,Math.PI*2);ctx.stroke();}else line(a,b);}}
      ctx.restore();
    }
    function paint() {
      if(!view)return;
      ctx.clearRect(0,0,view.w,view.h);ctx.fillStyle=palette().bg;ctx.fillRect(0,0,view.w,view.h);
      if(showGrid){let step=presentation?.gridSpacing||10;while(step*view.s<20)step*=2;ctx.strokeStyle=palette().grid;ctx.lineWidth=1;ctx.setLineDash([]);for(let x=((view.tx%(step*view.s))+step*view.s)%(step*view.s);x<view.w;x+=step*view.s)line({x,y:0},{x,y:view.h});for(let y=((view.ty%(step*view.s))+step*view.s)%(step*view.s);y<view.h;y+=step*view.s)line({x:0,y},{x:view.w,y});}
      ctx.strokeStyle=palette().axis;ctx.lineWidth=1;ctx.setLineDash([12,3,2,3]);line({x:0,y:view.ty},{x:view.w,y:view.ty});ctx.setLineDash([]);ctx.font='13px system-ui';ctx.fillStyle=palette().text;if((presentation?.viewCaptions??true)&&view.ty>32&&view.ty<view.h-26){ctx.fillText('Front view · VP',12,view.ty-12);ctx.fillText('Top view · HP',12,view.ty+25);ctx.fillText('XY',view.w-36,view.ty-9);}
      const list=table.list().filter(e=>e.type!=='DATUM_AXIS'&&(!assist||assist.shown(e)));
      if(mode==='pose'&&posed){ctx.globalAlpha=.18;list.forEach(entity=>renderEntity(entity));ctx.globalAlpha=1;const map=D.layoutOf(list,geometry);['front','top',...(map.three?[map.side]:[])].forEach(v=>{EduCADProject.projectGeometry(posed,v,map).forEach(seg=>{ctx.strokeStyle=palette().accent;ctx.lineWidth=seg.hidden?1:2;ctx.setLineDash(seg.hidden?[8,4]:[]);line(transform(seg.ax,seg.ay),transform(seg.bx,seg.by));});});ctx.setLineDash([]);const points=posedPoints(list);points.forEach(point=>renderEntity(point,palette().accent));if(presentation?.labels??true)EduCADLabels.resolve(points,view,{fontPx:labelSize()}).placements.forEach(label=>EduCADCanvas.drawLabelPlacement(ctx,view,label,{label:{font:'italic '+labelSize()+'px Cambria,serif',haloStyle:palette().bg,fillStyle:palette().accent}}));}
      else{
        list.forEach(entity=>renderEntity(entity));
        const labels=EduCADLabels.resolve(list.filter(e=>e.visible!==false&&e.type!=='DIMENSION'&&e.type!=='TEXT'),view,{fontPx:labelSize()});
        if(presentation?.labels??true)labels.placements.forEach(label=>EduCADCanvas.drawLabelPlacement(ctx,view,label,{label:{font:'italic '+labelSize()+'px Cambria,serif',haloStyle:palette().bg,fillStyle:presentation?palette().ink:'#243B30'}}));
      }
      if(opts.lesson==='square'&&!lessonDone){ctx.save();ctx.setLineDash([4,4]);ctx.strokeStyle=palette().accent;ctx.globalAlpha=.45;ctx.lineWidth=1;const pts=[[-40,40],[0,40],[0,80],[-40,80]];pts.forEach(([x,y],i)=>{const a=transform(x,y),b=transform(...pts[(i+1)%4]);line(a,b);ctx.beginPath();ctx.arc(a.x,a.y,6,0,Math.PI*2);ctx.stroke();});ctx.restore();}
      if(anchor){const p=transform(anchor.x,anchor.y);ctx.strokeStyle=palette().accent;ctx.lineWidth=2;ctx.setLineDash([5,4]);ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.stroke();if(cursor){const q=transform(cursor.x,cursor.y);if(tool==='circle'){ctx.beginPath();ctx.arc(p.x,p.y,Math.hypot(q.x-p.x,q.y-p.y),0,Math.PI*2);ctx.stroke();}else{if(tool==='line'&&presentation){const style=E.bisStyleFor(presentation.lineType);ctx.lineWidth=E.cosmeticWidthPx(style.widthMm);ctx.setLineDash(E.cosmeticDashPx(style.dashMm));}line(p,q);}}ctx.setLineDash([]);}
      if(shortcutActive()){
        const picks=shortcutBank.map(id=>table.get(id)).filter(Boolean);ctx.strokeStyle=palette().accent;ctx.fillStyle=palette().accent;ctx.lineWidth=2;ctx.setLineDash([]);
        picks.forEach((point,i)=>{const p=transform(point.x,point.y);ctx.beginPath();ctx.arc(p.x,p.y,10,0,Math.PI*2);ctx.stroke();ctx.font='11px system-ui';ctx.fillText(String(i+1),p.x+12,p.y-10);});
        if(shortcutLine){const [a,b]=shortcutLine.map(id=>table.get(id));if(a&&b){const style=E.bisStyleFor(presentation.lineType);ctx.lineWidth=E.cosmeticWidthPx(style.widthMm);ctx.setLineDash(E.cosmeticDashPx(style.dashMm));line(transform(a.x,a.y),transform(b.x,b.y));ctx.setLineDash([]);}}
      }
      if(cursor?.id){const p=transform(cursor.x,cursor.y);ctx.strokeStyle=palette().accent;ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.stroke();}
      assist?.drawPaper(ctx);
    }
    function fit() {
      if(!view)return;const ext=D.extent(table.list());
      if(!ext){view=EduCADCanvas.homeView(view.w,view.h);view.s=Math.min(3,view.w/180);}
      else{const x0=Math.min(ext.x0,-20),x1=Math.max(ext.x1,20),y0=Math.min(ext.y0,-35),y1=Math.max(ext.y1,35),s=Math.max(.05,Math.min(12,(view.w-100)/Math.max(35,x1-x0),(view.h-100)/Math.max(35,y1-y0)));view={...view,s,tx:view.w/2-(x0+x1)*s/2,ty:view.h/2+(y0+y1)*s/2};}paintSoon();
    }
    function resize() {const box=paper.getBoundingClientRect(),w=Math.max(1,box.width-2),h=Math.max(1,box.height-2),dpr=window.devicePixelRatio||1;canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);if(!view){view=EduCADCanvas.homeView(w,h);fit();}else view={...view,tx:view.tx+(w-view.w)/2,ty:view.ty+(h-view.h)/2,w,h};paintSoon();}
    const observer=new ResizeObserver(resize);observer.observe(paper);resize();
    function hit(p,pointsOnly=false) {
      let best=null,d=14/view.s;table.list().filter(e=>e.visible!==false&&(!assist||assist.shown(e))&&(!pointsOnly||e.type==='POINT')).forEach(e=>{let distance;if(e.type==='POINT')distance=Math.hypot(p.x-e.x,p.y-e.y);else if(['CIRCLE','CIRCULAR_ARC'].includes(e.type))distance=Math.abs(Math.hypot(p.x-e.x,p.y-e.y)-e.radius);else {const dx=e.x2-e.x,dy=e.y2-e.y,len=dx*dx+dy*dy,t=len?Math.max(0,Math.min(1,((p.x-e.x)*dx+(p.y-e.y)*dy)/len)):0;distance=Math.hypot(p.x-e.x-t*dx,p.y-e.y-t*dy);}if(distance<d && e.type!=='DATUM_AXIS'){best=e;d=distance;}});return best;
    }
    function eventPoint(event,snap=false) {const r=canvas.getBoundingClientRect(),p=inverse({x:event.clientX-r.left,y:event.clientY-r.top});if(snap){const guided=assist?.snap(p,anchor,8/view.s);if(guided)return guided;const existing=hit(p,true);if(existing)return{x:existing.x,y:existing.y,id:existing.id};if(snapGrid){const step=presentation?.snapSpacing||5;return{x:Math.round(p.x/step)*step,y:Math.round(p.y/step)*step};}}return p;}
    function chooseTool(next) {toolsDisclosure.open=false;cancelShortcut();tool=next;anchor=null;selected=null;updateTool();updateProperties();updateObjects();paintSoon();}
    function setMode(next) {if(next==='draw'&&locked)return;if(next==='pose'&&!geometry)return;cancelShortcut();mode=next;if(next==='pose'&&solidDisclosure)revealGuide(solidDisclosure);anchor=null;version++;if(next==='pose')selected=null;M.$$('[data-mode]',screen).forEach(b=>{b.classList.toggle('active',b.dataset.mode===mode);b.setAttribute('aria-pressed',String(b.dataset.mode===mode));});if(mode!=='draw'&&!['select','measure','pan'].includes(tool))tool='select';if(mode==='draw'&&presentation?.drawingMode==='shortcuts')tool='point';M.$$('[data-tool]',screen).forEach(b=>{b.disabled=mode!=='draw'&&!['select','measure','pan'].includes(b.dataset.tool);});updateTool();updateProperties();updateUndo();updateSolid();updatePose();updateLesson();paintSoon();}
    const shortcutHud=document.createElement('div');shortcutHud.className='student-shortcut-hud';shortcutHud.hidden=true;
    if(presentation)M.$('.desk-toolbar',screen).append(shortcutHud);
    const lineTypeControls=presentation?M.mountLineTypes(screen,{signal:abort.signal,type:()=>presentation.lineType,visible:()=>tool==='line',canChoose:editable,choose:code=>rememberPresentation({lineType:code})}):null;
    const shortcutActive=()=>presentation?.drawingMode==='shortcuts'&&editable()&&tool==='point';
    function cancelShortcut(){shortcutBank=[];shortcutLine=null;EduCADCanvas.clearTypedDist(shortcutTyped);shortcutHud.hidden=true;shortcutHud.replaceChildren();paintSoon();}
    function shortcutStatus(){
      shortcutHud.hidden=!shortcutBank.length&&!shortcutLine&&!shortcutTyped.buffer;
      if(shortcutLine)return;
      shortcutHud.innerHTML=`<span role="status">${shortcutTyped.buffer?esc(shortcutTyped.buffer)+' mm · Enter':shortcutBank.length+' / 2 points banked'}</span>${M.button('Cancel gesture','cancel-shortcut','compact')}`;
      M.bind(shortcutHud,'cancel-shortcut',()=>{cancelShortcut();updateTool();});paintSoon();
    }
    function shortcutTap(p,event){
      const existing=p.id&&table.get(p.id),point=existing?.type==='POINT'?existing:null;
      if(event.ctrlKey||event.metaKey){
        shortcutLine=null;EduCADCanvas.clearTypedDist(shortcutTyped);selected=null;
        if(point&&shortcutBank.includes(point.id))shortcutBank=shortcutBank.filter(id=>id!==point.id);
        else{if(shortcutBank.length===2)throw new Error('Two points are banked. Click a third point without Ctrl/Cmd, or cancel.');let chosen=point;if(!chosen)commit(()=>{chosen=pointAt(p);});shortcutBank.push(chosen.id);}
        updateProperties();shortcutStatus();return;
      }
      if(shortcutLine)return;
      if(shortcutBank.length){
        if(!point)throw new Error('Choose an existing point to finish, or cancel the gesture.');
        if(shortcutBank.includes(point.id))return;
        const points=shortcutBank.map(id=>table.get(id));if(points.some(item=>!item)){cancelShortcut();return;}
        if(points.length===1){
          shortcutLine=[points[0].id,point.id];shortcutBank=[];shortcutHud.hidden=false;
          shortcutHud.innerHTML=`<span>Line type</span>${M.lineTypes.items.map(({code,label,name})=>`<button type="button" class="button compact ${code===presentation.lineType?'active':''}" data-shortcut-style="${code}" title="Draw ${name.toLowerCase()}">${M.lineTypes.sample(code)}<span>${label}</span></button>`).join('')}${M.button('Cancel','cancel-shortcut','compact')}`;
          shortcutHud.setAttribute('aria-label','Choose line type');
          M.$$('[data-shortcut-style]',shortcutHud).forEach(button=>button.onclick=()=>safely(()=>{const [a,b]=shortcutLine.map(id=>table.get(id));commit(()=>make('SEGMENT',{x:a.x,y:a.y,x2:b.x,y2:b.y,viewRole:a.viewRole===b.viewRole?a.viewRole:'BOTH',bisCode:button.dataset.shortcutStyle,meta:{refs:[a.id,b.id],endpointRefs:[a.id,b.id]}}));rememberPresentation({lineType:button.dataset.shortcutStyle});cancelShortcut();updateTool();}));
          M.bind(shortcutHud,'cancel-shortcut',()=>{cancelShortcut();updateTool();});paintSoon();return;
        }
        const result=EduCADCanvas.circleFromThreePoints(...points,point);cancelShortcut();if(!result.ok)throw new Error(result.message);
        commit(()=>make('CIRCLE',{x:result.x,y:result.y,radius:Math.max(E.RADIUS_MIN_MM,result.r),viewRole:role(result.y),bisCode:'A',caption:'',showLabel:false,meta:{kind:'user-circle'}}));updateTool();return;
      }
      if(point){selected=point.id;updateProperties();updateObjects();paintSoon();return;}
      const reference=table.get(selected);let target=p;
      if(reference?.type==='POINT'){const lock=EduCADCanvas.axisLockState(transform(p.x,p.y),view,reference);if(lock.lock)target={x:lock.xMm,y:lock.yMm};}
      commit(()=>{selected=pointAt(target).id;});updateProperties();updateObjects();paintSoon();
    }
    function shortcutRename(event){
      if(!shortcutActive())return;const p=eventPoint(event),point=hit(p,true);if(!point||point.locked)return;
      cancelShortcut();selected=point.id;shortcutHud.hidden=false;
      shortcutHud.innerHTML=`<form class="student-shortcut-rename">${M.field('caption','Point name',point.caption,{required:true,max:80})}<div class="notice error form-error" hidden tabindex="-1"></div><button type="submit" class="button primary compact">Rename</button>${M.button('Cancel','cancel-shortcut','compact')}</form>`;
      M.form(M.$('form',shortcutHud),values=>{commit(()=>D.editPoint(table,E,point.id,{x:point.x,y:point.y},M.limitText(values.caption,80,'Point name'),D.layoutOf(table.list(),geometry)));cancelShortcut();updateProperties();canvas.focus({preventScroll:true});});
      M.bind(shortcutHud,'cancel-shortcut',()=>{cancelShortcut();canvas.focus({preventScroll:true});});updateProperties();const field=M.$('input',shortcutHud);field.focus();field.select();
    }
    function shortcutDistance(){
      const ref=table.get(selected);if(!ref||!cursor)throw new Error('Select a point, then aim along its X or Y axis.');
      const parsed=EduCADCanvas.parseTypedDist(shortcutTyped.buffer);if(!parsed.ok)throw new Error(parsed.message);
      const px=transform(cursor.x,cursor.y),lock=EduCADCanvas.axisLockState(px,view,ref),sign=EduCADCanvas.typedDistSign(lock.lock,px,view,ref),target=EduCADCanvas.typedDistPoint(ref,lock.lock,sign,parsed.value);
      if(!target)throw new Error('Aim along the selected point’s X or Y axis before pressing Enter.');
      commit(()=>pointAt({x:target.xMm,y:target.yMm}));EduCADCanvas.clearTypedDist(shortcutTyped);shortcutStatus();
    }
    function updateTool() {
      screen.dataset.workspaceMode=mode;
      updateStarter();
      updatePrecision();
      lineTypeControls?.update();
      M.$$('[data-tool]',screen).forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-pressed',String(b.dataset.tool===tool));if(['point','line','circle'].includes(b.dataset.tool))b.hidden=mode!=='draw'||locked||presentation?.drawingMode==='shortcuts';});
      const instruction=shortcutActive()?'Click to place · Ctrl/Cmd-click to bank points.':mode==='pose'?'Use the 3D controls to rotate, move, or scale your model preview.':anchor?(tool==='circle'?'Click the edge to choose the radius.':'Click the second point.'):tools[tool][1];
      step.dataset.pending=String(!!anchor);
      M.$('#tool-title',screen).textContent=mode==='pose'?'Move model':shortcutActive()?'Shortcuts':tools[tool][0];M.$('#tool-instruction',screen).textContent=instruction;M.$('[data-action=cancel]',screen).hidden=!anchor;
      assist?.update();
      canvas.style.cursor=tool==='pan'?'grab':mode==='draw'&&tool!=='select'?'crosshair':'default';
      const host=M.$('#tool-options',screen);host.innerHTML='';
      if(tool==='point'&&editable()) {
        host.innerHTML=`<details open><summary>Place by coordinates</summary><form id="point-form" class="properties">${M.field('caption','Point name (optional)','',{max:40,hint:"Names such as a and a′ link top and front views."})}<div class="form-grid">${numeric('x','X (mm)',0)}${numeric('y','Y (mm)',30)}</div><div class="notice error form-error" hidden tabindex="-1"></div><button class="button full" type="submit" style="margin-top:14px">Place point</button></form></details>`;
        M.form(M.$('#point-form',host),values=>{commit(()=>pointAt({x:number(values.x,'X'),y:number(values.y,'Y')},values.caption.trim()));M.$('[name=caption]',host).value='';M.toast('Point placed.');});
      }
      if(tool==='line'&&editable()&&anchor){host.innerHTML=`<form id="length-form" class="properties"><h3>Or use a length</h3>${numeric('length','Length (mm)',40,'min="0.01"')}${numeric('angle','Angle (degrees)',0)}<div class="notice error form-error" hidden tabindex="-1"></div><button class="button full" type="submit">Draw line</button></form>`;M.form(M.$('#length-form',host),values=>{const l=number(values.length,'Length'),a=number(values.angle,'Angle')*Math.PI/180;if(l<=0)throw new Error('Length must be greater than zero.');tap({x:anchor.x+l*Math.cos(a),y:anchor.y+l*Math.sin(a)});});}
      if(tool==='circle'&&editable()&&anchor){host.innerHTML=`<form id="radius-form" class="properties">${numeric('radius','Radius (mm)',20,'min="0.01"')}<div class="notice error form-error" hidden tabindex="-1"></div><button class="button full" type="submit">Draw circle</button></form>`;M.form(M.$('#radius-form',host),values=>{const r=number(values.radius,'Radius');if(r<=0)throw new Error('Radius must be greater than zero.');tap({x:anchor.x+r,y:anchor.y});});}
    }
    function tap(p) {
      if(mode==='pose')return;
      if(tool==='select'){selected=hit(p)?.id||null;updateProperties();updateObjects();updateLesson();paintSoon();return;}
      if(tool==='pan')return;
      if(tool==='point'){commit(()=>{selected=pointAt(p).id;});updateProperties();return;}
      if(!anchor){if(tool!=='measure')assertEditable();anchor=p;updateTool();paintSoon();return;}
      const a=anchor,dist=Math.hypot(p.x-a.x,p.y-a.y);if(dist<1e-6)throw new Error('Choose a different second point.');
      if(tool==='measure') {measured=true;M.$('#tool-instruction',screen).textContent='Distance: '+dist.toFixed(2)+' mm · angle '+(Math.atan2(p.y-a.y,p.x-a.x)*180/Math.PI).toFixed(1)+'°';anchor=null;M.$('[data-action=cancel]',screen).hidden=true;M.$('#tool-options',screen).innerHTML=editable()?M.button('Add dimension','add-dimension','compact'):'';bind('add-dimension',()=>{commit(()=>{const pa=pointAt(a),pb=pointAt(p);make('DIMENSION',{x:a.x,y:a.y,x2:p.x,y2:p.y,viewRole:role(a.y),bisCode:'B',meta:{refs:[pa.id,pb.id],offsetMm:10}});});M.$('#tool-options',screen).innerHTML='';});updateLesson();paintSoon();return;}
      commit(()=>{const pa=pointAt(a),pb=tool==='line'?pointAt(p):null;selected=make(tool==='line'?'SEGMENT':'CIRCLE',{x:a.x,y:a.y,x2:p.x,y2:p.y,radius:tool==='circle'?dist:0,viewRole:role(a.y),bisCode:tool==='line'&&presentation?presentation.lineType:'A',meta:tool==='line'?{refs:[pa.id,pb.id],endpointRefs:[pa.id,pb.id]}:{centerRef:pa.id,...(p.id?{radiusRef:p.id}:{})}}).id;});
      anchor=null;updateTool();updateProperties();paintSoon();
    }
    function updateObjects() {
      M.$('#object-list',screen).innerHTML=table.list().filter(e=>e.type!=='DATUM_AXIS').map(entity=>`<button class="button ${entity.id===selected?'active':''}" type="button" data-object="${esc(entity.id)}">${esc(nameOf(entity))} <span class="muted">· ${esc(entity.type.toLowerCase().replace('_',' '))}</span></button>`).join('')||'<p class="muted small">Your objects will appear here.</p>';
    }
    function updateProperties() {
      const host=M.$('#properties',screen), entity=table.get(selected);host.innerHTML='';assist?.update();if(!entity)return;
      if(tool==='select')revealGuide(propertiesDisclosure);
      const write=editable()&&!assist?.locked(entity);host.innerHTML=`<h3>${esc(entity.type==='POINT'?'Selected point':'Selected object')}</h3><form id="properties-form">${M.field('caption','Name or label',entity.caption,{max:80})}<div class="form-grid">${numeric('x','X (mm)',entity.x)}${numeric('y','Y (mm)',entity.y)}</div>${entity.type!=='POINT'&& !['CIRCLE','CIRCULAR_ARC','TEXT'].includes(entity.type)?`<div class="form-grid" style="margin-top:12px">${numeric('x2','End X (mm)',entity.x2)}${numeric('y2','End Y (mm)',entity.y2)}</div>`:''}${['CIRCLE','CIRCULAR_ARC'].includes(entity.type)?numeric('radius','Radius (mm)',entity.radius,'min="0.01"'):''}<label class="field"><span>View</span><select name="viewRole">${[['ELEVATION','Front view (VP)'],['PLAN','Top view (HP)'],['PROFILE','Side view'],['BOTH','Both views']].map(([key,label])=>`<option value="${key}" ${entity.viewRole===key?'selected':''}>${label}</option>`).join('')}</select></label><label class="field"><span>Line style</span><select name="bisCode">${[['A','Visible edge'],['B','Construction'],['E','Hidden edge'],['G','Center line'],['K','Alternate position']].map(([key,label])=>`<option value="${key}" ${entity.bisCode===key?'selected':''}>${label}</option>`).join('')}</select></label>${write?`<div class="notice error form-error" hidden tabindex="-1"></div><div class="actions"><button class="button" type="submit">Apply changes</button>${M.button('Delete','delete-object','danger compact','trash')}</div>`:'<p class="small muted">Inspection only. Your original drawing stays unchanged.</p>'}</form>`;
      if(!write)M.$$('input,select',host).forEach(input=>input.disabled=true);
      else{M.form(M.$('#properties-form',host),values=>{commit(()=>{const map=D.layoutOf(table.list(),geometry);if(entity.type==='POINT'){D.editPoint(table,E,entity.id,{x:number(values.x,'X'),y:number(values.y,'Y')},values.caption.trim(),map);table.update(entity.id,{bisCode:values.bisCode,viewRole:values.viewRole});}else{const patch={caption:values.caption.trim(),x:number(values.x,'X'),y:number(values.y,'Y'),viewRole:values.viewRole,bisCode:values.bisCode};if(values.x2!==undefined){patch.x2=number(values.x2,'End X');patch.y2=number(values.y2,'End Y');}if(values.radius!==undefined){patch.radius=number(values.radius,'Radius');if(patch.radius<=0)throw new Error('Radius must be greater than zero.');}D.editEntity(table,E,entity.id,patch,map);}});M.toast('Changes applied.');updateProperties();});bind('delete-object',async()=>{const ids=E.collectCascadeDeleteIds(table.list(),entity.id);if(await M.dialog('Delete this object?',ids.length>1?'Its connected objects will also be removed. Undo can restore them.':'Undo can restore this object.','','Delete',true)){commit(()=>table.deleteCascade(entity.id));selected=null;updateProperties();}});}
    }
    function validPose(p) { if(!geometry)return false;if(geometry.vertices.some(v=>v.y<-.001||v.z<-.001))return true;return EduCADPose.applyPose(geometry.vertices,p,EduCADPose.bboxCenter(geometry.vertices)).every(v=>v.y>=-.001&&v.z>=-.001); }
    function posedPoints(list) {const rest=EduCADPose.reproject(geometry.vertices,geometry.edges),sims=EduCADPose.simsForPose(geometry.vertices,geometry.edges,pose,EduCADPose.bboxCenter(geometry.vertices),rest),index=EduCADPose.exactIndex(rest,sims.now,geometry.edges),points=list.filter(e=>e.type==='POINT'&&e.visible!==false&&e.viewRole!=='PROFILE');return points.flatMap(entity=>EduCADPose.routeCopies(entity).flatMap(force=>{const copies=EduCADPose.poseCopies(entity,sims.elev,sims.plan,force,index);EduCADPose.splitStackCaption(entity,copies,force,{index,restPoints:points,splitCaption:EduCADLabels.splitCaption,bareName:EduCADLabels.bareName,cornerOf:name=>String(name).replace(/['’′]+$/,'')});return copies;}));}
    function updatePose() {
      const host=M.$('#pose-panel',screen);host.innerHTML='';if(mode!=='pose'||!geometry)return;
      host.innerHTML=`<section class="pose-controls"><h3>Move the model preview</h3><p class="small muted">Change its position and see the true front and top projections. Drawing coordinates stay unchanged.</p><form id="pose-form"><div class="form-grid">${numeric('tx','X (mm)',pose.t[0])}${numeric('ty','Y (mm)',pose.t[1])}${numeric('tz','Z (mm)',pose.t[2])}</div>${numeric('scale','Scale',pose.s,'min="0.1" max="10"')}<div class="notice error form-error" hidden tabindex="-1"></div><button class="button full" type="submit">Apply position</button></form><div class="actions" style="margin-top:12px">${M.button('Rotate X +15°','pose-x','compact')}${M.button('Rotate Y +15°','pose-y','compact')}${M.button('Rotate Z +15°','pose-z','compact')}${M.button('Reset model','pose-reset','compact')}</div></section>`;
      M.form(M.$('#pose-form',host),values=>{const p=EduCADPose.clonePose(pose);p.t=[number(values.tx,'X'),number(values.ty,'Y'),number(values.tz,'Z')];p.s=number(values.scale,'Scale');if(p.s<.1||p.s>10)throw new Error('Use a scale between 0.1 and 10.');if(!validPose(p))throw new Error('Keep the front view above XY and the top view below it. Move or scale the model within those bounds.');pose=p;updateSolid();paintSoon();});
      ['x','y','z'].forEach((axis,i)=>bind('pose-'+axis,()=>{const a=[0,0,0];a[i]=1;const start=EduCADPose.clonePose(pose),at=f=>({...start,rm:EduCADPose.rotateAboutAxis(start.rm,a,f*15*Math.PI/180)}),fraction=EduCADPose.limitFraction(at,validPose);pose=at(fraction);if(fraction<.999)M.toast('The model reached XY. Move it away from the line to turn it further.');updateSolid();paintSoon();}));bind('pose-reset',()=>{pose=EduCADPose.createPose();updateSolid();updatePose();paintSoon();});
    }
    function taskPanel() {
      const host=M.$('#task-panel',screen);
      host.innerHTML=(mobile?'<div class="notice mobile-view-note">You can inspect and move models here. Use a computer with a mouse or trackpad to create or edit your drawing.</div>':'')+(opts.question?`<p class="kicker">${opts.model?'Model answer · Question '+(opts.qi+1):opts.readOnly?'Submitted work':'Your task · Question '+(opts.qi+1)}</p><h2>${opts.model?'Make the answer clear.':opts.readOnly?'Look through the drawing.':'One step at a time.'}</h2><p class="prompt">${esc(opts.question.prompt||opts.question)}</p>${opts.question.hint?`<details><summary>Show a hint</summary><p>${esc(opts.question.hint)}</p></details>`:''}`:opts.lesson?'<div id="lesson-panel"></div>':'<p class="kicker">Start simple.</p><h2>What would you like to draw?</h2><p class="muted">Choose a tool above. This panel helps you with each step.</p>');
    }
    const lessons={
      points:[['Place a point above XY.','Choose Point. Click above the XY line, or use Y = 30 mm.'],['Place a point below XY.','Use Y = −30 mm to place a point in the top view.'],['Inspect your points.','Choose Inspect, then select a point to read its coordinates.']],
      line:[['Place the first point.','Choose Point and place a point anywhere on the paper.'],['Connect a line.','Choose Line, click your point, then click a different place.'],['Measure your line.','Choose Measure, then click the two endpoints. Read the distance in mm.']],
      square:[['Place four corners.','Use coordinates: (−40, 40), (0, 40), (0, 80), (−40, 80). The dotted guide shows your target.'],['Connect all four sides.','Choose Line and connect each corner to the next. Finish by connecting back to the first corner.'],['Inspect your square.','Choose Inspect and measure a side. Each side should be 40 mm.']],
      solid:[['Look around the prism.','Drag the 3D view, or choose Rotate left, to explore its shape.'],['Find its front view.','Which view is above the XY line in first-angle projection?'],['Find its top view.','Which view is below the XY line in first-angle projection?']]
    };
    function lessonReady() {
      const pts=table.list().filter(e=>e.type==='POINT'),segs=table.list().filter(e=>e.type==='SEGMENT');
      if(opts.lesson==='points')return lessonStep===0?pts.some(p=>p.y>0):lessonStep===1?pts.some(p=>p.y<0):mode==='inspect'&&!!selected;
      if(opts.lesson==='line')return lessonStep===0?pts.length>0:lessonStep===1?segs.length>0:measured;
      if(opts.lesson==='square'){const target=[[-40,40],[0,40],[0,80],[-40,80]],match=(p,t)=>Math.hypot(p.x-t[0],p.y-t[1])<.15;const found=target.every(t=>pts.some(p=>match(p,t)));if(lessonStep===0)return found;if(lessonStep===1)return found&&target.every((a,i)=>segs.some(s=>(match(s,a)&&match({x:s.x2,y:s.y2},target[(i+1)%4]))||(match(s,target[(i+1)%4])&&match({x:s.x2,y:s.y2},a))));return measured&&mode==='inspect';}
      return opts.lesson==='solid'&&lessonStep===0&&hasOrbit;
    }
    function updateLesson() {
      if(!opts.lesson||!lessons[opts.lesson])return;const host=M.$('#lesson-panel',screen);if(!host)return;
      if(lessonDone){host.innerHTML=`<span class="badge good">Lesson completed</span><h2>That’s a good start.</h2><p>Keep practising, or choose another lesson.</p>${M.link('Back to practice','learn','primary')}`;return;}
      const steps=lessons[opts.lesson], [title,text]=steps[Math.min(lessonStep,steps.length-1)];
      host.innerHTML=`<div class="learn-progress"><span>Guided practice</span><span>Step ${lessonStep+1} of ${steps.length}</span></div><h2>${esc(title)}</h2><p class="learn-step">${esc(text)}</p>${opts.lesson==='solid'&&lessonStep>0?`<div class="actions">${M.button('Front view (VP)','quiz-front','compact')}${M.button('Top view (HP)','quiz-top','compact')}</div>`:`<button type="button" class="button primary full" data-action="lesson-next" ${!lessonReady()?'disabled':''}>${lessonStep===steps.length-1?'Finish lesson':'Next step'}</button>`}<p id="lesson-feedback" class="small muted" role="status">${lessonReady()?'You’re ready for the next step.':'Try the step above to continue.'}</p>`;
      bind('lesson-next',()=>advanceLesson());['front','top'].forEach(answer=>bind('quiz-'+answer,()=>{if(answer===(lessonStep===1?'front':'top'))return advanceLesson();else M.$('#lesson-feedback',screen).textContent='Try again. The front view is above XY; the top view is below it.';}));
    }
    async function advanceLesson() {
      if(!alive()||lessonDone)return;
      if(lessonStep===lessons[opts.lesson].length-1){const state={done:true,completedAt:Date.now()};if(M.guest()){const all=M.read('educad_major2_guest_progress',{});if(!M.write('educad_major2_guest_progress',{...all,['major2-'+opts.lesson]:true}))throw new Error('Your browser could not save progress. Enable local storage and retry.');}else await M.api('progress/major2-'+opts.lesson,'PUT',{state});if(!alive())return;lessonDone=true;M.toast('Lesson completed.');}
      else lessonStep++;persist();updateLesson();
    }
    function download(format='json') {
      const name=(opts.title||'drawing').replace(/[^a-z0-9 _-]/gi,'').slice(0,80)||'drawing';
      const link=document.createElement('a');link.download=name+(format==='png'?'.png':'.json');link.href=format==='png'?canvas.toDataURL('image/png'):URL.createObjectURL(new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'}));link.click();if(format!=='png')setTimeout(()=>URL.revokeObjectURL(link.href),1000);
    }
    function historyURL(id) { window.history.replaceState(null,'','#/drawings/'+id); }
    async function save(button,asNew=false) {
      if(opts.readOnly)return;if(M.guest()){download();M.toast('Drawing downloaded. Sign in to save to an account.');return;}
      let title=opts.title;
      if(!opts.id||asNew){const answer=await M.dialog('Save your drawing','Choose a name that helps you find it later.',M.field('title','Drawing name',opts.title,{required:true,max:200}),'Save drawing');if(!answer||!alive())return;title=M.limitText(answer.title,200,'Drawing name');if(!title)throw new Error('Give your drawing a name.');}
      await M.busy(button,async()=>{savePending=true;updateSave();const data=snapshot(),captured=JSON.stringify(data.entities);try{const response=await M.api(!opts.id||asNew?'drawings':'drawings/'+opts.id,!opts.id||asNew?'POST':'PUT',{title,data});if(!alive())return;opts.id=response.id||opts.id;opts.title=title;baseline=captured;if(opts.draftKey==='draw/new'&&!asNew){M.remove(draftKey);opts.draftKey='drawing/'+opts.id;draftKey='educad_major2_draft_'+account+'/'+opts.draftKey;historyURL(opts.id);}M.$('#desk-title',screen).textContent=title;persist();assist?.saved();M.toast('Drawing saved to your account.');}finally{savePending=false;if(alive())updateSave();}});
    }
    async function saveModel(button) {
      if(!opts.model||!M.teacher()||!alive())return;if(!table.count())throw new Error('Draw a model answer first.');
      const data=snapshot(),stamp=JSON.stringify(data.entities),preview=EduCADRef3d.buildPreview(data.entities,EduCADReconstruct);
      const answer=await M.dialog('Save this model answer?',preview.status==='ok'?'Your model will stay private. Choose whether students may see its 3D reference.':'This drawing has no complete 3D reconstruction. It can still be used as a private model answer.',preview.status==='ok'?`<label class="check-field"><input type="checkbox" name="show" ${opts.question.show_3d?'checked':''}>Show the 3D reference to students</label>`:'','Save model');
      if(!answer||!alive())return;
      await M.busy(button,async()=>{await M.api('sets/'+M.code(opts.setCode)+'/questions/'+opts.qi+'/model','PUT',{data,model3d:preview.status==='ok'?preview:null,show_3d:!!answer.show});if(!alive())return;baseline=stamp;opts.question.show_3d=!!answer.show;persist();updateSave();M.toast('Model answer saved.');});
    }
    async function submit(button) {
      if(!opts.setCode||opts.model||!alive())return;if(!table.count())throw new Error('Draw your answer before submitting.');
      const answer=await M.dialog('Ready to send your drawing?','Your teacher receives a copy of the drawing. You can make another attempt later.',M.field('note','A note to your teacher (optional)','',{textarea:true,max:500}),'Submit drawing');if(!answer||!alive())return;
      await M.busy(button,async()=>{const response=await M.api('sets/'+M.code(opts.setCode)+'/submissions','POST',{question_index:opts.qi,data:snapshot(),note:M.limitText(answer.note,500,'Note')});if(alive()){persist();M.go('review/'+response.id);M.toast('Drawing submitted to your teacher.');}});
    }
    async function verify(button) {
      if(!opts.question?.check_enabled||!alive())return;
      await M.busy(button,async()=>{const before=version,result=await M.api('sets/'+M.code(opts.setCode)+'/verify','POST',{question_index:opts.qi,data:snapshot()});if(!alive())return;if(before!==version){M.toast('Your drawing changed while checking. Check it again.');return;}await M.dialog('Automatic drawing check',result.checked?(result.pass?'Your drawing matches the model answer. Your teacher’s review is separate.':'Your drawing does not match yet. '+(result.details?.missing??0)+' items missing, '+(result.details?.extra??0)+' extra. Read the question, check sizes and views, then try again.'):'A check is not available for this question. You can still submit to your teacher.','','Done');});
    }
    function reviewPanel() {
      const host=M.$('#review-panel',screen),sub=opts.submission;if(!sub)return;
      host.innerHTML=`<section class="review-form"><h3>${M.teacher()?'Teacher review':'Your result'}</h3><div class="actions">${M.status(sub)}${M.autoStatus(sub)}</div>${sub.note?`<h3>Student note</h3><p>${esc(sub.note)}</p>`:''}${M.teacher()?`<form id="grade-form" style="margin-top:20px"><label class="field"><span>Teacher verdict</span><select name="verdict">${[['','Awaiting review'],['pass','Pass'],['fail','Needs work']].map(([key,label])=>`<option value="${key}" ${sub.verdict===key?'selected':''}>${label}</option>`).join('')}</select></label>${M.field('remarks','Feedback',sub.remarks,{textarea:true,max:2000})}<div class="notice error form-error" hidden tabindex="-1"></div><button class="button primary full" type="submit">Save review</button></form>`:`<h3>Teacher feedback</h3><p>${esc(sub.remarks||'Your teacher has not added feedback yet.')}</p>`}</section>`;
      if(M.teacher())M.form(M.$('#grade-form',host),async values=>{await M.api('submissions/'+sub.id+'/grade','PUT',{verdict:values.verdict,remarks:M.limitText(values.remarks,2000,'Feedback')});if(alive()){sub.verdict=values.verdict;sub.remarks=values.remarks;reviewPanel();M.toast('Review saved. The student can see your feedback.');}});
    }
    async function more() {
      const dialog=document.createElement('dialog');dialog.className='dialog';dialog.innerHTML=`<h2>Your drawing tools</h2><p>Choose an extra tool or save a copy.</p><div class="actions">${M.button('Download JSON','export-json')}${M.button('Download image','export-png')}${!locked?M.button('Import drawing','import'):''}${!locked&&!M.guest()?M.button('Save as a new drawing','save-as'):''}</div><div class="actions page-section">${!locked?M.button('Add text','add-text')+M.button('Add an arc','add-arc')+M.button('Add a projector','add-projector')+M.button('Load an example','example'):''}${M.teacher()&&!locked?M.button('Generate a drawing','generate'):''}</div><label class="check-field"><input type="checkbox" name="grid" ${showGrid?'checked':''}>Show grid</label><label class="check-field"><input type="checkbox" name="snap" ${snapGrid?'checked':''}>Snap new points to a ${presentation?.snapSpacing||5} mm grid</label>${!locked?M.button('Clear paper','clear','danger'):''}<div class="actions right"><button class="button primary" type="button" data-close>Done</button></div>`;
      M.$('#dialogs').append(dialog);dialog.onclose=()=>dialog.remove();M.$('[data-close]',dialog).onclick=()=>dialog.close();dialog.showModal();
      M.$('[name=grid]',dialog).onchange=event=>{showGrid=event.target.checked;rememberPresentation({grid:showGrid});updatePrecision();paintSoon();};M.$('[name=snap]',dialog).onchange=event=>{snapGrid=event.target.checked;rememberPresentation({snap:snapGrid});updatePrecision();};
      const action=(key,fn)=>M.bind(dialog,key,async button=>{dialog.close();if(alive())await fn(button);});
      action('export-json',()=>download());action('export-png',()=>download('png'));action('save-as',button=>save(button,true));
      action('import',async()=>{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.hidden=true;input.className='major2-import';document.body.append(input);input.oncancel=()=>input.remove();input.onchange=async()=>{try{const file=input.files[0];input.remove();if(!file)return;if(file.size>2000000)throw new Error('Choose a drawing smaller than 2 MB.');const data=JSON.parse(await file.text()),test=E.createTable();S.restoreTable(E,test,data);if(!alive())return;if(!await M.dialog('Replace the paper?','The imported drawing replaces your current paper. Undo can restore it.','','Import drawing'))return;commit(()=>restore(data));anchor=null;selected=null;updateTool();updateProperties();fit();M.toast('Drawing imported.');}catch(error){M.toast(M.errorText(error),true);}};input.click();});
      action('clear',async()=>{if(await M.dialog('Clear the paper?','All drawing objects will be removed. Undo can restore them.','','Clear paper',true)){commit(()=>table.clear());selected=null;anchor=null;updateProperties();updateTool();}});
      action('add-text',async()=>{const values=await M.dialog('Add a note to the paper','Use a short label or note.',M.field('text','Text','',{required:true,max:400})+numeric('x','X (mm)',0)+numeric('y','Y (mm)',20),'Add text');if(values)commit(()=>make('TEXT',{x:number(values.x,'X'),y:number(values.y,'Y'),caption:values.text,meta:{text:values.text}}));});
      action('add-arc',async()=>{const values=await M.dialog('Draw an arc','Angles are measured counterclockwise from the positive X direction.',numeric('x','Center X (mm)',0)+numeric('y','Center Y (mm)',30)+numeric('radius','Radius (mm)',20,'min="0.01"')+numeric('start','Start angle (degrees)',0)+numeric('end','End angle (degrees)',90),'Draw arc');if(values)commit(()=>{const x=number(values.x,'X'),y=number(values.y,'Y'),radius=number(values.radius,'Radius');if(radius<=0)throw new Error('Radius must be greater than zero.');make('CIRCULAR_ARC',{x,y,radius,startAngle:number(values.start,'Start angle'),endAngle:number(values.end,'End angle'),viewRole:role(y),bisCode:'A'});});});
      action('add-projector',async()=>{const values=await M.dialog('Add a projector','A vertical construction line joins the two views at the same X coordinate.',numeric('x','X (mm)',0)+numeric('top','Front Y (mm)',40)+numeric('bottom','Top Y (mm)',-30),'Add projector');if(values)commit(()=>{const x=number(values.x,'X');make('SEGMENT',{x,y:number(values.top,'Front Y'),x2:x,y2:number(values.bottom,'Top Y'),bisCode:'B',viewRole:'BOTH',meta:{kind:'projector'}});});});
      action('example',async()=>{const values=await M.dialog('Learn from an example','This replaces the paper. Undo can restore your drawing.',`<label class="field"><span>Example</span><select name="example"><option value="PRISM">Prism</option><option value="PYRAMID">Pyramid</option><option value="CYLINDER">Cylinder</option><option value="CONE">Cone</option><option value="line">Inclined line</option></select></label>`,'Load example');if(values){commit(()=>restore({entities:values.example==='line'?EduCADCurriculum.straightLine({TL:80,thetaDeg:30,phiDeg:45,axMm:-30,yaPlan:-20,yaElev:25}).entities:EduCADCurriculum.regularSolid({solid:values.example,sizeMm:45,heightMm:70}).entities}));pose=EduCADPose.createPose();anchor=null;selected=null;fit();updateTool();updateProperties();}});
      action('generate',async()=>{const values=await M.dialog('Generate a drawing','Describe the shape and dimensions. Review the generated drawing before saving a model answer. It replaces the paper when complete.',M.field('description','Drawing description',opts.question?.prompt||'',{textarea:true,required:true,max:8000}),'Generate drawing');if(!values)return;assertEditable();M.toast('Generating your drawing. You can continue inspecting it.');const result=await generate(values.description,'auto',true);if(!result.ok)throw new Error(result.message);if(alive()){fit();M.toast(result.message);}});
    }
    const generate=EduCADAuto.createRunner({table,session:M.session,readOnly:()=>!editable(),modeRevision:()=>version,maxAttempts:2,timeoutMs:90000,interpret:(_session,text,points,mode,pointData,feedback)=>M.api('interpret','POST',{text,points,mode,pointData,feedback}),commit:data=>commit(()=>restore(data)),friendly:M.errorText});
    if(!locked)M.form(M.$('#command-form',screen),values=>{assertEditable();const lines=values.commands.split(/\n/).map(s=>s.trim()).filter(Boolean);if(!lines.length)throw new Error('Type a command first.');if(lines.length===1&&/^\/(undo|clear|mode)\b/i.test(lines[0]))throw new Error('Use the visible Undo, Clear paper, and mode buttons for these actions.');const result=EduCADAuto.stage(lines,snapshot(),false);if(!result.ok)throw new Error(result.message);commit(()=>restore({entities:result.entities}));M.$('#command-result',screen).textContent=lines.length+' commands applied. Undo restores the previous drawing.';fit();});
    listen(screen,'click',event=>{const toolButton=event.target.closest('[data-tool]'),modeButton=event.target.closest('[data-mode]'),objectButton=event.target.closest('[data-object]');if(toolButton&&!toolButton.disabled)safely(()=>chooseTool(toolButton.dataset.tool));if(modeButton&&!modeButton.disabled)safely(()=>setMode(modeButton.dataset.mode));if(objectButton){selected=objectButton.dataset.object;tool='select';updateTool();updateProperties();updateObjects();updateLesson();paintSoon();}});
    bind('cancel',()=>{cancelShortcut();anchor=null;updateTool();paintSoon();});bind('undo',()=>{assertEditable();cancelShortcut();anchor=null;history.undo();selected=null;updateTool();updateProperties();});bind('redo',()=>{assertEditable();cancelShortcut();history.redo();selected=null;updateProperties();});bind('fit',fit);
    ['zoom-in','zoom-out'].forEach(action=>bind(action,()=>{view=EduCADCanvas.zoomViewAt(view,{x:view.w/2,y:view.h/2},action==='zoom-in'?1.25:.8);paintSoon();}));
    bind('toggle-guide',button=>{if(presentation)return;const body=M.$('.desk-body',screen),hidden=body.classList.toggle('guide-hidden');M.$('.desk-guide',screen).hidden=hidden;button.setAttribute('aria-expanded',String(!hidden));button.textContent=hidden?'Show guide':'Hide guide';});
    M.$('[data-action=toggle-guide]',screen).setAttribute('aria-expanded','true');
    if(!presentation&&!opts.lesson&&!opts.readOnly)M.$('[data-action=toggle-guide]',screen).click();
    bind('quick-grid',()=>{showGrid=!showGrid;rememberPresentation({grid:showGrid});updatePrecision();paintSoon();});
    bind('quick-snap',()=>{snapGrid=!snapGrid;rememberPresentation({snap:snapGrid});updatePrecision();});
    bind('save',button=>save(button));bind('save-model',saveModel);bind('submit',submit);bind('verify',verify);bind('desk-more',more);
    bind('desk-back',()=>{persist();M.go(opts.back);});
    bind('orbit-left',()=>{EduCADSolid.rotateBy(widget.state,30,0);widget.draw();hasOrbit=true;updateLesson();});bind('orbit-reset',()=>{if(presentation)widget.resetView();else{EduCADSolid.resetView(widget.state);widget.draw();}});
    if(!presentation)listen(widget.canvas,'pointerup',()=>{hasOrbit=true;updateLesson();});
    listen(M.$('[name=show-reference]',screen),'change',updateSolid);
    const pointers=new Map();let pinch=null;
    listen(canvas,'pointerdown',event=>safely(()=>{if(event.button===2||event.button===1||event.altKey){event.preventDefault();dragging={kind:'pan',start:{x:event.clientX,y:event.clientY},view:{...view}};canvas.setPointerCapture(event.pointerId);return;}if(event.button!==0)return;canvas.focus({preventScroll:true});pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);if(pointers.size===2){const [a,b]=[...pointers.values()],r=canvas.getBoundingClientRect();pinch={distance:Math.hypot(a.x-b.x,a.y-b.y),center:{x:(a.x+b.x)/2-r.left,y:(a.y+b.y)/2-r.top},view:{...view}};dragging=null;return;}const p=eventPoint(event,true),entity=hit(p);dragging={kind:tool==='pan'||mobile?'pan':tool==='select'&&editable()&&entity?.type==='POINT'&&!entity.locked?'point':'tap',start:{x:event.clientX,y:event.clientY},point:p,view:{...view},id:entity?.id,moved:false};}));
    listen(canvas,'pointermove',event=>safely(()=>{if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(pinch&&pointers.size===2){const [a,b]=[...pointers.values()],r=canvas.getBoundingClientRect(),center={x:(a.x+b.x)/2-r.left,y:(a.y+b.y)/2-r.top},distance=Math.hypot(a.x-b.x,a.y-b.y);view=EduCADCanvas.zoomViewAt(pinch.view,pinch.center,distance/Math.max(1,pinch.distance));view.tx+=center.x-pinch.center.x;view.ty+=center.y-pinch.center.y;paintSoon();return;}cursor=eventPoint(event,!dragging||dragging.kind==='tap');M.$('.coords',screen).textContent='X '+cursor.x.toFixed(1)+' · Y '+cursor.y.toFixed(1)+' mm';if(dragging){const dx=event.clientX-dragging.start.x,dy=event.clientY-dragging.start.y;dragging.moved=Math.hypot(dx,dy)>5;if(dragging.kind==='pan'){view={...dragging.view,tx:dragging.view.tx+dx,ty:dragging.view.ty+dy};}if(dragging.kind==='point'&&dragging.moved){cursor=eventPoint(event,snapGrid);selected=dragging.id;}}paintSoon();}));
    listen(canvas,'pointerup',event=>safely(()=>{pointers.delete(event.pointerId);if(pinch){if(pointers.size<2)pinch=null;dragging=null;return;}const drag=dragging;dragging=null;if(!drag)return;if(drag.kind==='point'&&drag.moved){const target=eventPoint(event,snapGrid);commit(()=>D.editPoint(table,E,drag.id,target,null,D.layoutOf(table.list(),geometry)));selected=drag.id;updateProperties();}else if(!drag.moved&&drag.kind!=='pan'){if(shortcutActive())shortcutTap(eventPoint(event,true),event);else tap(eventPoint(event,true));}else if(!drag.moved&&mobile){selected=hit(eventPoint(event))?.id||null;updateProperties();updateLesson();}paintSoon();}));
    listen(canvas,'pointercancel',event=>{pointers.delete(event.pointerId);dragging=null;pinch=null;});listen(canvas,'contextmenu',event=>event.preventDefault());
    listen(canvas,'wheel',event=>{event.preventDefault();const r=canvas.getBoundingClientRect();view=EduCADCanvas.zoomViewAt(view,{x:event.clientX-r.left,y:event.clientY-r.top},Math.exp(-Math.max(-150,Math.min(150,event.deltaY))*.002));paintSoon();},{passive:false});
    listen(canvas,'dblclick',event=>safely(()=>shortcutRename(event)));
    listen(shortcutHud,'keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelShortcut();canvas.focus({preventScroll:true});}});
    listen(window,'keydown',event=>{if(!alive()||M.$('dialog[open]')||event.target.closest('input,textarea,select,[contenteditable]'))return;
      if(presentation?.drawingMode==='shortcuts'&&event.target===canvas){
        if(event.key==='Tab'&&geometry){event.preventDefault();if(mode==='pose')setMode(shortcutReturnMode);else{shortcutReturnMode=mode;setMode('pose');}return;}
        if(shortcutActive()&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
          if(event.key==='/'){event.preventDefault();cancelShortcut();screen.dispatchEvent(new CustomEvent('student-canvas-preferences',{detail:{...presentation,focus:false,guide:true}}));const commands=M.$('#command-form [name=commands]',screen);commands.closest('details').open=true;commands.focus();return;}
          if(!shortcutBank.length&&!shortcutLine&&table.get(selected)?.type==='POINT'&&(event.key==='Backspace'||/^[0-9.]$/.test(event.key))){event.preventDefault();EduCADCanvas.handleTypedDistKey(shortcutTyped,event.key);shortcutStatus();return;}
          if(event.key==='Enter'&&shortcutTyped.buffer){event.preventDefault();safely(shortcutDistance);return;}
        }
      }
      if(event.key==='Escape'){cancelShortcut();anchor=null;updateTool();paintSoon();} if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&editable()){event.preventDefault();cancelShortcut();anchor=null;event.shiftKey?history.redo():history.undo();selected=null;updateTool();updateProperties();}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'&&!opts.readOnly){event.preventDefault();save(M.$('[data-action=save]',screen)).catch(error=>M.toast(M.errorText(error),true));}if(event.key.toLowerCase()==='f'){event.preventDefault();fit();}});
    if(presentation)assist=M.mountDrawingAssist(screen,{
      signal:abort.signal,alive,account,options:opts,canDraw:!locked,editable,widget,snapshot,
      state:()=>({prefs:presentation,entities:table.list(),selected,anchor,cursor,tool,mode,view,geometry,source:spatialState().source,accent:palette().accent,background:palette().bg}),
      point:event=>eventPoint(event),hit,
      refresh:()=>{assist?.update();paintSoon();widget.draw();},
      place:p=>{tap(p);paintSoon();},
      select:id=>{selected=id;tool='select';updateTool();updateProperties();updateObjects();paintSoon();},
      properties:()=>revealGuide(propertiesDisclosure),
      center:id=>{const entity=table.get(id);if(entity){view={...view,tx:view.w/2-entity.x*view.s,ty:view.h/2+entity.y*view.s};paintSoon();}},
      restore:data=>{commit(()=>restore(data));anchor=null;selected=null;cancelShortcut();updateTool();updateProperties();fit();}
    });
    taskPanel();reviewPanel();if(opts.readOnly)taskDisclosure.open=true;if(!presentation&&opts.setCode&&!opts.model&&opts.question?.show_3d&&opts.question.model3d?.status==='ok')M.$('[name=show-reference]',screen).checked=true;updateTool();updateProperties();recompute();updatePose();
    const draft=draftKey&&!locked?M.read(draftKey):null;
    if(draft?.data?.entities&&JSON.stringify(draft.data.entities)!==baseline){const initialRevision=version;Promise.resolve().then(async()=>{const answer=await M.dialog('Continue your unfinished drawing?','An unfinished draft for this task is kept on this device. Choose Continue draft to restore it.','','Continue draft');if(!alive()||version!==initialRevision)return;if(answer){commit(()=>restore(draft.data));if(draft.id)opts.id=draft.id;if(draft.title){opts.title=draft.title;M.$('#desk-title',screen).textContent=draft.title;}lessonStep=Math.min(Math.max(0,draft.lessonStep||0),(lessons[opts.lesson]?.length||1)-1);fit();updateLesson();M.toast('Your draft is ready.');}else M.remove(draftKey);}).catch(error=>M.toast(M.errorText(error),true));}
    return {table,snapshot,assist:()=>assist,presentation:()=>presentation?{...presentation}:null,setPresentation,spatial:spatialState,view:()=>({...view}),pose:()=>clone(pose),dirty:()=>!locked&&fingerprint()!==baseline,dispose:()=>{if(disposed)return;persist();disposed=true;clearTimeout(persistTimer);clearTimeout(updateTimer);cancelAnimationFrame(frame);abort.abort();observer.disconnect();contextObserver.disconnect();unsubscribe();lineTypeControls?.dispose();widget.dispose();}};
  };
})();

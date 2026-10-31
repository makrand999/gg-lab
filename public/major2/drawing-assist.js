(function(root){
  'use strict';
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const segmentTypes=['SEGMENT','LINE','RAY'];
  const layerOf=e=>e.type==='DATUM_AXIS'?'datum':e.type==='POINT'?'geometry':e.type==='DIMENSION'?'dimensions':e.type==='TEXT'?'notes':['B','G','K'].includes(e.bisCode)?'construction':'geometry';
  function nearestOn(p,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy);return Number.isFinite(t)?{x:a.x+t*dx,y:a.y+t*dy,t}:null;}
  function snap(p,list,anchor,tolerance){
    const candidates=[];
    const add=(q,label,priority=1)=>{if(q&&distance(p,q)<=tolerance)candidates.push({...q,label,priority,d:distance(p,q)});};
    list.forEach(e=>{
      if(e.type==='POINT')add({x:e.x,y:e.y,id:e.id},'Endpoint',0);
      if(segmentTypes.includes(e.type)){
        const a={x:e.x,y:e.y},b={x:e.x2,y:e.y2};add(a,'Endpoint',0);add(b,'Endpoint',0);add({x:(a.x+b.x)/2,y:(a.y+b.y)/2},'Midpoint');
        if(anchor){const foot=nearestOn(anchor,a,b);if(foot&&foot.t>=0&&foot.t<=1)add(foot,'Perpendicular');}
      }
      if(e.type==='CIRCLE')add({x:e.x,y:e.y},'Centre');
    });
    candidates.sort((a,b)=>a.priority-b.priority||a.d-b.d);
    if(candidates.length)return candidates[0];
    const points=list.filter(e=>e.type==='POINT');if(anchor)points.unshift(anchor);
    let x=null,y=null;
    points.forEach(q=>{if(Math.abs(q.x-p.x)<=tolerance&&(!x||Math.abs(q.x-p.x)<Math.abs(x.x-p.x)))x=q;if(Math.abs(q.y-p.y)<=tolerance&&(!y||Math.abs(q.y-p.y)<Math.abs(y.y-p.y)))y=q;});
    if(x||y)return {x:x?x.x:p.x,y:y?y.y:p.y,label:x&&y?'Aligned in X & Y':x?'Aligned in X':'Aligned in Y',guides:[...(x?[{a:x,b:{x:x.x,y:y?y.y:p.y}}]:[]),...(y?[{a:y,b:{x:x?x.x:p.x,y:y.y}}]:[])]};
    return null;
  }
  function review(list){
    const visible=list.filter(e=>e.visible!==false&&e.type!=='DATUM_AXIS'),points=visible.filter(e=>e.type==='POINT'),issues=[];
    if(!visible.length)return [{text:'The sheet is empty. Start with a point or line.',id:null}];
    points.filter(e=>!String(e.caption||'').trim()||e.showLabel===false).forEach(e=>issues.push({id:e.id,text:'This point has no visible label.'}));
    const edges=visible.filter(e=>e.type==='SEGMENT'&&layerOf(e)==='geometry');
    edges.forEach(e=>{
      const open=[{x:e.x,y:e.y},{x:e.x2,y:e.y2}].some(p=>!edges.some(other=>{if(other.id===e.id)return false;const q=nearestOn(p,other,{x:other.x2,y:other.y2});return q&&q.t>=0&&q.t<=1&&distance(p,q)<.01;}));
      if(open)issues.push({id:e.id,text:'This edge has an open endpoint. Check whether it should connect to another edge.'});
    });
    const roles=new Set(visible.filter(e=>['POINT','SEGMENT','CIRCLE'].includes(e.type)).map(e=>e.viewRole));
    if(!roles.has('ELEVATION')||!roles.has('PLAN'))issues.push({id:null,text:'Only one principal view is present. Check whether your question asks for front and top views.'});
    return issues;
  }
  const helpers={snap,review,layerOf,nearestOn};
  if(typeof module==='object'&&module.exports){module.exports=helpers;return;}
  const M=root.Major2,esc=M.escape;
  M.drawingAssistMath=helpers;
  M.mountDrawingAssist=function(screen,desk){
    const signal=desk.signal,canvas=M.$('.paper-area > canvas',screen),paper=M.$('.paper-area',screen);
    const listen=(host,event,fn,options={})=>host.addEventListener(event,fn,{...options,signal});
    const on=(key)=>desk.state().prefs?.[key]===true;
    const layers={geometry:{name:'Points & visible / hidden edges',show:true,lock:false},construction:{name:'Construction & centre lines',show:true,lock:false},dimensions:{name:'Dimensions',show:true,lock:false},notes:{name:'Annotations',show:true,lock:false}};
    let hover=null,solidPick=null,snapInfo=null,dialog=null,dimensionAnchor=null,dimensionEditing=false;
    const shown=e=>e.visible!==false&&(!on('drawingLayers')||layers[layerOf(e)]?.show!==false);
    const locked=e=>on('drawingLayers')&&!!layers[layerOf(e)]?.lock;
    const tools=document.createElement('div');tools.className='assist-tools';tools.setAttribute('role','group');tools.setAttribute('aria-label','Drafting aids');
    tools.innerHTML=M.button('Find tool','assist-search','compact')+M.button('Layers','assist-layers','compact')+M.button('Checkpoints','assist-checkpoints','compact')+M.button('Review sheet','assist-review','compact');
    M.$('.desk-context',screen).after(tools);
    const brief=document.createElement('details');brief.className='assist-brief';brief.innerHTML='<summary>Question '+((desk.options.qi||0)+1)+' · drawing brief</summary><p>'+esc(desk.options.question?.prompt||'')+'</p><div class="assist-flow" aria-label="Assignment workflow">'+M.button('1 · Draw','flow-draw','compact')+M.button('2 · Inspect','flow-inspect','compact')+M.button('3 · Review','flow-review','compact')+M.button('4 · Submit','flow-submit','compact')+'</div>';tools.after(brief);
    const dims=document.createElement('form');dims.className='assist-dimensions';dims.hidden=true;
    dims.innerHTML='<label><span data-length-label>Length · mm</span><input name="length" type="number" min="0.001" max="100000" step="any" required aria-label="Cursor length in millimetres"></label><label data-angle-field><span>Angle · °</span><input name="angle" type="number" min="-36000" max="36000" step="any" required aria-label="Cursor angle in degrees"></label><button class="button compact" type="submit" aria-label="Apply cursor dimensions">'+M.icon('check')+'</button><span class="assist-dimension-hint">Type a length · Tab for angle · Enter</span><span class="assist-input-error" role="alert"></span>';
    paper.append(dims);
    const contextual=document.createElement('div');contextual.className='assist-selection';contextual.hidden=true;
    contextual.innerHTML='<span></span>'+M.button('Properties','assist-properties','compact')+M.button('Delete','assist-delete','compact');paper.append(contextual);
    function safe(fn){Promise.resolve().then(fn).catch(error=>{if(desk.alive())M.toast(M.errorText(error),true);});}
    function focusPaper(){canvas.focus({preventScroll:true});}
    function closeDialog(){if(dialog){dialog.close();dialog.remove();dialog=null;}focusPaper();}
    function openDialog(title,content){
      closeDialog();dialog=document.createElement('dialog');dialog.className='dialog assist-dialog';dialog.innerHTML='<div class="assist-dialog-heading"><h2>'+esc(title)+'</h2><button type="button" class="button compact" data-dismiss aria-label="Close">'+M.icon('close')+'</button></div>'+content;
      M.$('#dialogs').append(dialog);dialog.showModal();M.$('[data-dismiss]',dialog).onclick=closeDialog;dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});return dialog;
    }
    function invoke(selector){const button=M.$(selector,screen);if(button&&!button.disabled){button.click();return true;}return false;}
    function selectObject(id){desk.select(id);desk.center(id);}
    function openPalette(){
      if(!on('commandPalette'))return;
      const entries=[...M.$$('[data-tool]',screen).filter(b=>!b.hidden&&!b.disabled).map(b=>({label:b.textContent.trim(),detail:'Drawing tool',run:()=>b.click()})),...[
        ['Fit view','[data-action=fit]'],['Undo','[data-action=undo]'],['Redo','[data-action=redo]'],['Save drawing','[data-action=save]'],['Inspect drawing','[data-mode=inspect]'],['Draw mode','[data-mode=draw]'],['3D preview','[data-canvas-spatial]'],['Workspace preferences','[data-canvas-customize]'],['Submit drawing','[data-action=submit]']
      ].filter(([,selector])=>M.$(selector,screen)&&!M.$(selector,screen).disabled).map(([label,selector])=>({label,detail:'Workspace action',run:()=>invoke(selector)}))];
      [['drawingLayers','Drawing layers',openLayers],['checkpoints','Named checkpoints',openCheckpoints],['sheetReview','Review sheet',openReview]].forEach(([key,label,run])=>{if(on(key))entries.push({label,detail:'Drafting aid',run});});
      const host=openDialog('Find a tool','<input type="search" aria-label="Search drawing tools" placeholder="Try line, fit, layers…" autocomplete="off"><div class="assist-search-results"></div><p class="muted small">↑ ↓ to choose · Enter to run · Esc to close</p>'),input=M.$('input',host),results=M.$('.assist-search-results',host);let filtered=[],index=0;
      function render(){filtered=entries.filter(entry=>entry.label.toLowerCase().includes(input.value.trim().toLowerCase()));index=Math.min(index,Math.max(0,filtered.length-1));results.innerHTML=filtered.map((entry,i)=>'<button type="button" class="button '+(i===index?'active':'')+'" data-result="'+i+'"><span>'+esc(entry.label)+'</span><small>'+esc(entry.detail)+'</small></button>').join('')||'<p class="muted">No matching tools. Try another word.</p>';}
      function run(i){const entry=filtered[i];if(!entry)return;closeDialog();entry.run();}
      input.oninput=()=>{index=0;render();};input.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();index=(index+(event.key==='ArrowDown'?1:-1)+filtered.length)%Math.max(1,filtered.length);render();M.$('[data-result="'+index+'"]',results)?.scrollIntoView({block:'nearest'});}if(event.key==='Enter'){event.preventDefault();run(index);}};
      results.onclick=event=>{const b=event.target.closest('[data-result]');if(b)run(Number(b.dataset.result));};render();input.focus();
    }
    function openLayers(){
      if(!on('drawingLayers'))return;
      const host=openDialog('Drawing layers','<p class="muted small">Grouped by line type and object type. Visibility and locks apply to this workspace session. Saving includes every layer.</p><div class="assist-layer-list">'+Object.entries(layers).map(([key,value])=>'<section><strong>'+esc(value.name)+'</strong><label><input type="checkbox" data-layer="'+key+'" data-property="show" '+(value.show?'checked':'')+'> Show</label><label><input type="checkbox" data-layer="'+key+'" data-property="lock" '+(value.lock?'checked':'')+'> Lock</label></section>').join('')+'</div><p class="small muted">Locked layers reject changes to their objects and connected geometry. Undo and redo remain available.</p>');
      host.onchange=event=>{const {layer,property}=event.target.dataset;if(!layers[layer]||!['show','lock'].includes(property))return;layers[layer][property]=event.target.checked;hover=null;snapInfo=null;desk.refresh();};
    }
    const checkpointKey=()=> 'educad_major2_checkpoints_'+desk.account+'/'+(desk.options.draftKey||(desk.options.readOnly?'review/'+desk.options.submission?.id:desk.options.id)||'draw/new');
    let previousCheckpointKey=checkpointKey();
    function checkpoints(){const value=M.read(checkpointKey(),[]);return Array.isArray(value)?value.filter(item=>item&&typeof item.name==='string'&&Array.isArray(item.data?.entities)).slice(0,12):[];}
    function openCheckpoints(){
      if(!on('checkpoints'))return;
      const items=checkpoints(),host=openDialog('Named checkpoints','<p class="muted small">Stored on this device for this sheet. Keep up to 12 checkpoints. Save to your account separately.</p>'+(desk.editable()?'<form class="assist-checkpoint-form"><label class="field"><span>Checkpoint name</span><input name="name" maxlength="80" required placeholder="Construction complete"></label><button class="button primary" type="submit">Create checkpoint</button></form>':'')+'<div class="assist-checkpoint-list">'+items.map((item,i)=>'<section><div><strong>'+esc(item.name)+'</strong><small>'+esc(new Date(item.at).toLocaleString())+'</small></div>'+(desk.editable()?'<button type="button" class="button compact" data-restore="'+i+'">Restore</button>':'')+'<button type="button" class="button compact" data-remove="'+i+'" aria-label="Delete checkpoint '+esc(item.name)+'">'+M.icon('trash')+'</button></section>').join('')+(items.length?'':'<p class="muted">No checkpoints yet.</p>')+'</div>');
      const form=M.$('form',host);if(form)form.onsubmit=event=>{event.preventDefault();safe(()=>{if(!desk.alive()||!desk.editable())return;const name=form.elements.name.value.trim();if(!name)throw Error('Give your checkpoint a name.');if(items.length>=12)throw Error('Delete an old checkpoint before creating another.');if(!M.write(checkpointKey(),[{name,at:Date.now(),data:desk.snapshot()},...items]))throw Error('Device storage is unavailable or full. Your checkpoint was not saved.');openCheckpoints();});};
      host.onclick=event=>{const restore=event.target.closest('[data-restore]'),remove=event.target.closest('[data-remove]');if(!restore&&!remove)return;const item=items[Number((restore||remove).dataset[restore?'restore':'remove'])];safe(async()=>{closeDialog();const yes=await M.dialog(restore?'Restore checkpoint?':'Delete checkpoint?',restore?'This replaces your sheet. Undo can restore your current work.':'This removes only this device checkpoint. Your drawing stays intact.','',''+(restore?'Restore':'Delete'),!restore);if(!yes||!desk.alive())return;if(restore)desk.restore(item.data);else if(!M.write(checkpointKey(),items.filter(value=>value!==item)))throw Error('Could not delete this checkpoint.');openCheckpoints();});};
    }
    function openReview(){
      if(!on('sheetReview'))return;
      const issues=review(desk.state().entities),host=openDialog('Review your sheet','<p class="muted small">Drafting suggestions, not a grade. Some tasks intentionally use a single view or open edges. Hidden layers are included.</p><div class="assist-review-list">'+(issues.length?issues.map((issue,i)=>'<button type="button" class="button" data-issue="'+i+'" '+(!issue.id?'disabled':'')+'>'+esc(issue.text)+(issue.id?' <span>Locate →</span>':'')+'</button>').join(''):'<p>No issues found by these basic checks. Compare the drawing with your question before submitting.</p>')+'</div><div class="actions">'+(desk.options.question?.check_enabled?M.button('Check against teacher criteria','review-verify','compact'):'')+(desk.options.setCode&&!desk.options.model&&!desk.options.readOnly?M.button('Continue to submit','review-submit','primary'):'')+'</div>');
      host.onclick=event=>{const button=event.target.closest('[data-issue]');if(button){const issue=issues[Number(button.dataset.issue)];if(issue.id){closeDialog();selectObject(issue.id);}}};
      M.bind(host,'review-verify',()=>{closeDialog();invoke('[data-action=verify]');});M.bind(host,'review-submit',()=>{closeDialog();invoke('[data-action=submit]');});
    }
    M.bind(tools,'assist-search',openPalette);M.bind(tools,'assist-layers',openLayers);M.bind(tools,'assist-checkpoints',openCheckpoints);M.bind(tools,'assist-review',openReview);
    M.bind(brief,'flow-draw',()=>invoke('[data-mode=draw]'));M.bind(brief,'flow-inspect',()=>invoke('[data-mode=inspect]'));M.bind(brief,'flow-review',openReview);M.bind(brief,'flow-submit',()=>invoke('[data-action=submit]'));
    M.bind(contextual,'assist-properties',()=>{desk.properties();M.$('#properties-form input',screen)?.focus();});M.bind(contextual,'assist-delete',()=>invoke('[data-action=delete-object]'));
    function updateDimensions(){
      const state=desk.state(),allowed=on('cursorDimensions')&&desk.editable()&&state.anchor&&['line','circle'].includes(state.tool)&&state.prefs.drawingMode==='menu';
      dims.hidden=!allowed;if(!allowed){dimensionAnchor=null;dimensionEditing=false;return;}
      const {anchor,cursor,tool,view}=state,newAnchor=dimensionAnchor!==anchor;
      if(newAnchor){dimensionAnchor=anchor;dimensionEditing=false;M.$('.assist-input-error',dims).textContent='';}
      M.$('[data-angle-field]',dims).hidden=tool==='circle';dims.elements.angle.required=tool!=='circle';M.$('[data-length-label]',dims).textContent=tool==='circle'?'Radius · mm':'Length · mm';
      dims.elements.namedItem('length').setAttribute('aria-label',tool==='circle'?'Cursor radius in millimetres':'Cursor length in millimetres');
      if(!dimensionEditing){const point=cursor||anchor;dims.elements.namedItem('length').value=distance(anchor,point).toFixed(2);dims.elements.angle.value=(Math.atan2(point.y-anchor.y,point.x-anchor.x)*180/Math.PI).toFixed(1);}
      if(!dimensionEditing||newAnchor){const point=cursor||anchor,x=point.x*view.s+view.tx,y=view.ty-point.y*view.s;dims.style.left=Math.max(8,Math.min(view.w-dims.offsetWidth-8,x+20))+'px';dims.style.top=Math.max(30,Math.min(view.h-dims.offsetHeight-8,y+20))+'px';}
    }
    listen(dims,'focusin',()=>dimensionEditing=true);
    listen(dims,'keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();dimensionEditing=false;focusPaper();updateDimensions();}if(event.key==='Enter'){event.preventDefault();dims.requestSubmit();}});
    listen(dims,'submit',event=>{event.preventDefault();safe(()=>{const length=Number(dims.elements.namedItem('length').value),angle=Number(dims.elements.angle.value);if(!Number.isFinite(length)||length<=0||length>100000||!Number.isFinite(angle))throw Error('Enter a positive dimension up to 100,000 mm.');const {anchor,tool}=desk.state();if(!anchor||!desk.editable())return;const radians=(tool==='circle'?0:angle)*Math.PI/180;try{desk.place({x:anchor.x+length*Math.cos(radians),y:anchor.y+length*Math.sin(radians)});focusPaper();}catch(error){M.$('.assist-input-error',dims).textContent=error.message;}update();});});
    listen(window,'keydown',event=>{
      if(!desk.alive()||M.$('dialog[open]'))return;
      if(on('commandPalette')&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();openPalette();return;}
      if(event.target===canvas&&!dims.hidden&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&/^[0-9.]$/.test(event.key)){event.preventDefault();dims.elements.namedItem('length').value=event.key==='.'?'0.':event.key;dims.elements.namedItem('length').focus();}
    });
    function update(){
      if(!desk.alive())return;
      [['assist-search','commandPalette'],['assist-layers','drawingLayers'],['assist-checkpoints','checkpoints'],['assist-review','sheetReview']].forEach(([action,key])=>M.$('[data-action='+action+']',tools).hidden=!on(key));
      tools.hidden=!['commandPalette','drawingLayers','checkpoints','sheetReview'].some(on);
      brief.hidden=!on('assignmentFlow')||!desk.options.question||!desk.options.setCode||!!desk.options.readOnly||!!desk.options.model;
      M.$('[data-action=flow-review]',brief).hidden=!on('sheetReview');
      const state=desk.state();M.$('[data-action=flow-draw]',brief).disabled=!desk.canDraw;
      ['draw','inspect'].forEach(mode=>M.$('[data-action=flow-'+mode+']',brief).setAttribute('aria-pressed',String(state.mode===mode)));
      const entity=state.entities.find(e=>e.id===state.selected);
      contextual.hidden=!on('selectionActions')||!entity||state.tool!=='select'||!shown(entity)||state.mode==='pose';
      if(!contextual.hidden){M.$('span',contextual).textContent=entity.caption||entity.type.toLowerCase();M.$('[data-action=assist-delete]',contextual).hidden=!desk.editable()||locked(entity);}
      updateDimensions();
    }
    function linked(){
      const s=desk.state(),g=s.geometry,result={vertices:[],edges:[]};
      if(!on('linkedHighlight')||!g||s.mode==='pose'||s.source!=='student')return result;
      if(solidPick)return solidPick;
      const entity=s.entities.find(e=>e.id===(hover||s.selected));if(!entity||!shown(entity))return result;
      const map=EduCADDrafting.layoutOf(s.entities,g),role=entity.viewRole|| (entity.y<0?'PLAN':'ELEVATION');
      if(!['PLAN','ELEVATION','PROFILE'].includes(role))return result;
      const projected=g.vertices.map(v=>EduCADDrafting.toView(v,role,map));
      function matches(p){if(entity.type==='POINT')return distance(p,entity)<.02;if(!segmentTypes.includes(entity.type))return false;const q=nearestOn(p,entity,{x:entity.x2,y:entity.y2});return q&&q.t>=-.001&&q.t<=1.001&&distance(p,q)<.02;}
      projected.forEach((p,i)=>{if(matches(p))result.vertices.push(i);});
      if(segmentTypes.includes(entity.type))g.edges.forEach(([a,b],i)=>{if(matches(projected[a])&&matches(projected[b])&&distance(projected[a],projected[b])>.02)result.edges.push(i);});return result;
    }
    function ring(ctx,p){ctx.beginPath();ctx.arc(p.x,p.y,7,0,Math.PI*2);ctx.stroke();}
    function stroke(ctx,a,b){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
    function drawPaper(ctx){
      const s=desk.state(),v=s.view;if(!v)return;const project=p=>({x:p.x*v.s+v.tx,y:v.ty-p.y*v.s});
      ctx.save();ctx.strokeStyle=s.accent;ctx.fillStyle=s.accent;ctx.lineWidth=1.5;ctx.setLineDash([4,4]);
      if(on('smartGuides')&&snapInfo&&desk.editable()&&s.cursor){(snapInfo.guides||[]).forEach(g=>stroke(ctx,project(g.a),project(g.b)));const p=project(snapInfo);ctx.setLineDash([]);ctx.strokeRect(p.x-5,p.y-5,10,10);EduCADCanvas.drawKnockoutLabel(ctx,snapInfo.label,Math.min(v.w-130,p.x+12),Math.max(20,p.y-12),{font:'11px system-ui',haloStyle:s.background,fillStyle:s.accent});}
      const keys=linked();ctx.setLineDash([]);ctx.lineWidth=2.5;
      if(s.geometry&&(keys.vertices.length||keys.edges.length)){const map=EduCADDrafting.layoutOf(s.entities,s.geometry);['ELEVATION','PLAN',...(map.three?['PROFILE']:[])].forEach(role=>{const points=s.geometry.vertices.map(vertex=>project(EduCADDrafting.toView(vertex,role,map)));keys.vertices.forEach(i=>ring(ctx,points[i]));keys.edges.forEach(i=>{const [a,b]=s.geometry.edges[i];stroke(ctx,points[a],points[b]);});});}ctx.restore();updateDimensions();
    }
    function drawSolid(ctx,st){const keys=linked();if(!keys.vertices.length&&!keys.edges.length)return;const points=EduCADSolid.project(st,st.cx,st.cy);ctx.save();ctx.strokeStyle=desk.state().accent;ctx.lineWidth=2.5;ctx.setLineDash([]);keys.vertices.forEach(i=>{if(points[i])ring(ctx,points[i]);});keys.edges.forEach(i=>{const edge=desk.state().geometry.edges[i];if(points[edge[0]]&&points[edge[1]])stroke(ctx,points[edge[0]],points[edge[1]]);});ctx.restore();}
    listen(canvas,'pointermove',event=>{if(event.buttons)return;const point=desk.point(event);hover=desk.hit(point)?.id||null;solidPick=null;desk.refresh();});
    listen(canvas,'pointerleave',()=>{hover=null;snapInfo=null;desk.refresh();});
    listen(desk.widget.canvas,'pointermove',event=>{if(event.buttons||!on('linkedHighlight')){solidPick=null;return;}const s=desk.state();if(!s.geometry||s.source!=='student'||s.mode==='pose')return;const rect=desk.widget.canvas.getBoundingClientRect(),p={x:event.clientX-rect.left,y:event.clientY-rect.top},st=desk.widget.state,points=EduCADSolid.project(st,st.cx,st.cy);let best=12,index=-1;points.forEach((q,i)=>{const d=distance(p,q);if(d<best){best=d;index=i;}});solidPick=index>=0?{vertices:[index],edges:[]}:null;
      if(!solidPick){best=7;s.geometry.edges.forEach(([a,b],i)=>{const q=nearestOn(p,points[a],points[b]);if(q&&q.t>=0&&q.t<=1&&distance(p,q)<best){best=distance(p,q);solidPick={vertices:[a,b],edges:[i]};}});}desk.refresh();});
    listen(desk.widget.canvas,'pointerleave',()=>{solidPick=null;desk.refresh();});
    signal.addEventListener('abort',()=>{dialog?.remove();},{once:true});update();
    return {update,shown,locked,drawPaper,drawSolid,linked,
      saved:()=>{const next=checkpointKey();if(next===previousCheckpointKey)return;const previous=M.read(previousCheckpointKey,[]);if(Array.isArray(previous)&&previous.length){const merged=[...previous,...checkpoints()].slice(0,12);if(!M.write(next,merged)){M.toast('Drawing saved. Device checkpoints could not be moved to the saved sheet.',true);return;}M.remove(previousCheckpointKey);}previousCheckpointKey=next;},
      snap:(p,anchor,tolerance)=>{snapInfo=on('smartGuides')&&desk.editable()&&['point','line','circle'].includes(desk.state().tool)?snap(p,desk.state().entities.filter(shown),anchor,tolerance):null;return snapInfo;},
      guard:(before,after)=>{if(!on('drawingLayers'))return;const previous=new Map(before.map(e=>[e.id,e])),next=new Map(after.map(e=>[e.id,e]));for(const e of before)if(locked(e)&&JSON.stringify(e)!==JSON.stringify(next.get(e.id)))throw Error('Unlock the '+layers[layerOf(e)].name.toLowerCase()+' layer before changing connected objects.');for(const e of after)if(locked(e)&&JSON.stringify(e)!==JSON.stringify(previous.get(e.id)))throw Error('Unlock the '+layers[layerOf(e)].name.toLowerCase()+' layer before drawing on it.');}
    };
  };
})(typeof window==='undefined'?globalThis:window);

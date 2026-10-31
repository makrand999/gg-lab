(function(){
  'use strict';
  const M=window.Major2,clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  M.mountCanvasWindow=function(screen,dock,options){
    const abort=new AbortController(),account=M.accountKey(),token=M.session()?.token;
    const active=()=>screen.isConnected&&!abort.signal.aborted&&M.accountKey()===account&&M.session()?.token===token;
    const listen=(target,event,fn)=>target.addEventListener(event,fn,{signal:abort.signal});
    const body=M.$('.desk-body',screen),heading=M.$('.student-spatial-heading',dock),small=matchMedia('(max-width: 760px)');
    const content=document.createElement('div');content.className='student-spatial-content';[...dock.children].filter(el=>el!==heading).forEach(el=>content.append(el));dock.append(content);
    function button(className,label,html){const el=document.createElement('button');el.type='button';el.className='button '+className;el.setAttribute('aria-label',label);el.title=label;el.innerHTML=html;return el;}
    const move=button('student-window-move','Move 3D window. Arrow keys move; Shift moves faster.',M.icon('pan'));
    const placement=button('student-window-placement','Float 3D window','Float');
    const minimize=button('student-window-minimize','Minimize 3D window','−');
    const resize=button('student-window-resize','Resize 3D window. Arrow keys resize; Shift changes faster.','<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 20 13-13M13 20l7-7M19 20l1-1"/></svg>');
    heading.prepend(move);heading.append(placement,minimize);dock.append(resize);
    let gesture=null;
    const floating=()=>options.get().modelPlacement==='floating'&&!small.matches;
    function bounds(){const rect=body.getBoundingClientRect();return {width:body.clientWidth,height:body.clientHeight,left:rect.left,top:rect.top};}
    function layout(){
      const prefs=options.get(),box=bounds(),empty=!options.spatial().available&&prefs.model==='compact',collapsed=prefs.floatMinimized||(empty&&!options.spatial().referenceAllowed);
      const width=Math.min(prefs.floatWidth,Math.max(1,box.width-16)),height=Math.min(collapsed?80:empty?166:prefs.floatHeight,Math.max(1,box.height-16));
      const roomX=Math.max(0,box.width-width-16),roomY=Math.max(0,box.height-height-16);
      return {box,width,height,roomX,roomY,left:8+prefs.floatX*roomX,top:8+prefs.floatY*roomY,collapsed};
    }
    function update(){
      if(!active())return;const float=floating(),prefs=options.get();screen.dataset.canvasPlacement=float?'floating':'docked';dock.dataset.placement=float?'floating':'docked';
      placement.hidden=small.matches;placement.textContent=float?'Dock':'Float';placement.setAttribute('aria-label',float?'Dock 3D window':'Float 3D window');placement.title=placement.getAttribute('aria-label');
      move.hidden=!float;minimize.hidden=!float;resize.hidden=!float||prefs.floatMinimized||(!options.spatial().available&&prefs.model==='compact');
      minimize.textContent=prefs.floatMinimized?'□':'−';minimize.setAttribute('aria-label',prefs.floatMinimized?'Restore 3D window':'Minimize 3D window');minimize.title=minimize.getAttribute('aria-label');
      dock.dataset.minimized=String(float&&prefs.floatMinimized);dock.style.removeProperty('left');dock.style.removeProperty('top');dock.style.removeProperty('width');dock.style.removeProperty('height');
      if(float){const frame=layout();content.hidden=frame.collapsed;dock.style.left=frame.left+'px';dock.style.top=frame.top+'px';dock.style.width=frame.width+'px';dock.style.height=frame.height+'px';}
      else content.hidden=false;
    }
    function patchPosition(left,top,frame){return {floatX:frame.roomX?clamp((left-8)/frame.roomX,0,1):0,floatY:frame.roomY?clamp((top-8)/frame.roomY,0,1):0};}
    function end(cancel=false){
      if(!gesture)return;const old=gesture;gesture=null;dock.removeAttribute('data-gesturing');
      if(old.target.hasPointerCapture?.(old.id))old.target.releasePointerCapture(old.id);
      if(cancel)options.set(old.original);else if(active())options.remember();
    }
    function start(event,kind){
      if(!active()||!floating()||event.button!==0||gesture)return;
      event.preventDefault();event.stopPropagation();const frame=layout();
      gesture={kind,target:event.currentTarget,id:event.pointerId,x:event.clientX,y:event.clientY,frame,original:{...options.get()}};
      gesture.target.setPointerCapture(event.pointerId);gesture.target.focus({preventScroll:true});dock.dataset.gesturing=kind;
    }
    function drag(event){
      if(!gesture||event.pointerId!==gesture.id||!active())return;event.preventDefault();event.stopPropagation();const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;
      if(gesture.kind==='move')options.set(patchPosition(gesture.frame.left+dx,gesture.frame.top+dy,gesture.frame));
      else{
        const width=clamp(gesture.frame.width+dx,Math.min(260,gesture.frame.box.width-16),Math.min(560,gesture.frame.box.width-16));
        const height=clamp(gesture.frame.height+dy,Math.min(260,gesture.frame.box.height-16),Math.min(640,gesture.frame.box.height-16));
        const frame={...gesture.frame,roomX:Math.max(0,gesture.frame.box.width-width-16),roomY:Math.max(0,gesture.frame.box.height-height-16)};
        options.set({floatWidth:width,floatHeight:height,...patchPosition(gesture.frame.left,gesture.frame.top,frame)});
      }
    }
    [move,resize].forEach((target,i)=>{
      listen(target,'pointerdown',event=>start(event,i?'resize':'move'));listen(target,'pointermove',drag);
      listen(target,'pointerup',event=>{if(gesture?.id===event.pointerId){event.stopPropagation();end();}});
      listen(target,'pointercancel',event=>{if(gesture?.id===event.pointerId)end(true);});
      listen(target,'lostpointercapture',event=>{if(gesture?.id===event.pointerId)end(true);});
      listen(target,'keydown',event=>{
        if(!active()||!floating())return;if(event.key==='Escape'&&gesture){event.preventDefault();event.stopPropagation();end(true);return;}
        if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const step=event.shiftKey?40:10,frame=layout(),dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
        if(i)options.set({floatWidth:options.get().floatWidth+dx,floatHeight:options.get().floatHeight+dy});else options.set(patchPosition(frame.left+dx,frame.top+dy,frame));options.remember();
      });
    });
    listen(placement,'click',()=>{end(true);options.set({modelPlacement:floating()?'docked':'floating',floatMinimized:false});options.remember();});
    listen(minimize,'click',()=>{end(true);options.set({floatMinimized:!options.get().floatMinimized});options.remember();});
    listen(small,'change',()=>{end(true);options.onLayout();});
    const observer=new ResizeObserver(()=>{if(active())update();});observer.observe(body);
    return {floating,update,dispose:()=>{end(true);abort.abort();observer.disconnect();}};
  };
})();

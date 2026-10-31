(function(){
  'use strict';
  const M=window.Major2,E=window.EduCADEntities;
  const items=Object.freeze([
    {code:'A',label:'Visible',name:'Visible edge'},
    {code:'B',label:'Construction',name:'Construction line'},
    {code:'E',label:'Hidden',name:'Hidden edge'},
    {code:'G',label:'Centre',name:'Centre line'},
    {code:'K',label:'Alternate',name:'Alternate position'}
  ].map(Object.freeze));
  function sample(code){const style=E.bisStyleFor(code);return `<svg class="student-line-sample" viewBox="0 0 64 16" aria-hidden="true"><path d="M2 8H62" fill="none" stroke="currentColor" stroke-width="${E.cosmeticWidthPx(style.widthMm)}" stroke-dasharray="${E.cosmeticDashPx(style.dashMm).join(' ')}"/></svg>`;}
  M.lineTypes={items,sample};
  M.mountLineTypes=function(screen,options){
    const listen=(host,event,fn)=>host.addEventListener(event,fn,{signal:options.signal});
    const trigger=document.createElement('button');trigger.type='button';trigger.className='button student-line-type-toggle';trigger.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','student-line-type-options');
    M.$('[data-tool=line]',screen).after(trigger);
    const popup=document.createElement('div');popup.id='student-line-type-options';popup.className='student-line-type-options';popup.setAttribute('role','group');popup.setAttribute('aria-label','Choose line type');
    const native=typeof popup.showPopover==='function';if(native)popup.setAttribute('popover','auto');else popup.hidden=true;
    popup.innerHTML='<span class="student-line-type-title">Line type</span>'+items.map(item=>`<button type="button" class="button" data-line-type="${item.code}" aria-label="${item.name}">${sample(item.code)}<span>${item.label}</span></button>`).join('');screen.append(popup);
    const buttons=M.$$('[data-line-type]',popup),opened=()=>native?popup.matches(':popover-open'):!popup.hidden;
    function close(focus=false){if(opened()){if(native)popup.hidePopover();else popup.hidden=true;}trigger.setAttribute('aria-expanded','false');if(focus&&!trigger.hidden)trigger.focus({preventScroll:true});}
    function position(){const r=trigger.getBoundingClientRect(),width=Math.min(260,innerWidth-16),height=popup.getBoundingClientRect().height;popup.style.left=Math.max(8,Math.min(r.left,innerWidth-width-8))+'px';popup.style.top=(r.bottom+height+16<=innerHeight?r.bottom+8:Math.max(8,r.top-height-8))+'px';}
    function update(){
      const item=items.find(item=>item.code===options.type())||items[0];trigger.hidden=!options.visible()||!options.canChoose();
      trigger.innerHTML=sample(item.code)+`<span>${item.label}</span><span aria-hidden="true">▾</span>`;trigger.setAttribute('aria-label','Line type: '+item.name);trigger.title='Choose line type';
      buttons.forEach(button=>{const chosen=button.dataset.lineType===item.code;button.classList.toggle('active',chosen);button.setAttribute('aria-pressed',String(chosen));});if(trigger.hidden)close();
    }
    listen(trigger,'click',()=>{if(!options.canChoose())return;if(opened()){close();return;}if(native)popup.showPopover();else popup.hidden=false;position();trigger.setAttribute('aria-expanded','true');(buttons.find(button=>button.dataset.lineType===options.type())||buttons[0]).focus({preventScroll:true});});
    buttons.forEach(button=>listen(button,'click',()=>{if(!options.canChoose())return;options.choose(button.dataset.lineType);update();close(true);}));
    listen(popup,'keydown',event=>{
      event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close(true);return;}
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const current=buttons.indexOf(document.activeElement),index=event.key==='Home'?0:event.key==='End'?buttons.length-1:(current+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[index].focus();
    });
    if(native)listen(popup,'toggle',()=>trigger.setAttribute('aria-expanded',String(opened())));
    else listen(document,'pointerdown',event=>{if(opened()&&!popup.contains(event.target)&&!trigger.contains(event.target))close();});
    listen(window,'resize',()=>close());listen(M.$('.desk-toolbar',screen),'scroll',()=>close());
    update();return {update,dispose:()=>close()};
  };
})();

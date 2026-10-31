(function(){
  'use strict';
  const M=window.Major2,e=M.escape,c=M.code;
  const link=(label,route,icon='arrow',kind='')=>`<a class="teacher-link ${kind}" href="#/${route}">${M.icon(icon)}<span>${e(label)}</span></a>`;
  const searchIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg>';
  const search=(id,label)=>`<label class="teacher-library-search">${searchIcon}<span class="studio-sr-only">${e(label)}</span><input type="search" id="${id}" placeholder="${e(label)}" aria-label="${e(label)}" autocomplete="off"></label>`;
  function lifecycle(root){
    const abort=new AbortController(),token=M.session()?.token;
    const active=()=>root.isConnected&&!abort.signal.aborted&&token===M.session()?.token;
    return {active,dispose:()=>abort.abort(),listen:(host,event,fn)=>host.addEventListener(event,fn,{signal:abort.signal})};
  }
  function study(model='step',controls=false){
    return `<figure class="teacher-studio-study" data-study-model="${model}"><div class="teacher-studio-study-drawing">${M.projectionStudy(model)}</div>${controls?`<div class="teacher-view-controls" role="group" aria-label="Projection study view">${[['iso','3D'],['front','Front'],['top','Top'],['side','Side']].map(([view,label])=>`<button type="button" data-studio-view="${view}" aria-label="${view==='iso'?'Isometric':label} study view" aria-pressed="${view==='iso'}">${M.projectionThumbnail(model,view)}<span>${label}</span></button>`).join('')}</div>`:''}<figcaption>Projection study · not to scale</figcaption></figure>`;
  }
  function bindStudies(root,life){
    M.$$('[data-studio-view]',root).forEach(button=>life.listen(button,'click',()=>{
      const figure=button.closest('[data-study-model]');
      M.$('.teacher-studio-study-drawing',figure).innerHTML=M.projectionStudy(figure.dataset.studyModel,button.dataset.studioView);
      M.$$('[data-studio-view]',figure).forEach(control=>control.setAttribute('aria-pressed',String(control===button)));
    }));
  }
  M.teacherStudioFooter=function(){
    return `<div class="teacher-studio-etching" aria-hidden="true"><span>EG / STUDIO</span><div>${['front','top','side'].map(view=>M.projectionThumbnail('prism',view)).join('')}</div><span>01 — 03</span></div>`;
  };
  M.teacherStudioEmptyArt=model=>`<div class="teacher-empty-study" aria-hidden="true">${M.projectionThumbnail(model,'iso')}</div>`;
  M.teacherRecoverySheet=content=>`<div class="teacher-form-spread"><div>${content}</div>${M.teacherVisualPanel('assignment',{title:'A fresh perspective.'})}</div>${M.teacherStudioFooter()}`;
  M.teacherVisualPanel=function(kind,values={}){
    const classroom=kind==='class',model=classroom?'prism':values.step===2?'step':'pyramid';
    return `<aside class="teacher-form-art" aria-label="${classroom?'Class sheet':'Assignment sheet'} preview"><div class="teacher-form-art-index"><span>${classroom?'CLASS SHEET':'DRAWING BRIEF'}</span><span>${classroom?'EG / CLASS':'0'+(values.step||1)+' / 03'}</span></div>${study(model)}<div class="teacher-form-art-caption"><h2 data-studio-title data-fallback="${classroom?'Your next class.':'Your next challenge.'}">${e(values.title|| (classroom?'Your next class.':'Your next challenge.'))}</h2><code data-studio-code>${e(values.code||'— — —')}</code>${classroom?'':`<div class="teacher-form-art-questions" aria-label="${values.questions?.length||0} questions">${(values.questions||[]).slice(0,12).map((q,i)=>`<span>${String(i+1).padStart(2,'0')}</span>`).join('')}${values.questions?.length>12?`<span>+${values.questions.length-12}</span>`:''}</div>`}</div></aside>`;
  };
  M.updateTeacherVisual=function(root,values){
    const title=M.$('[data-studio-title]',root),code=M.$('[data-studio-code]',root);
    if(title)title.textContent=values.title||title.dataset.fallback;
    if(code)code.textContent=values.code||'— — —';
  };
  M.teacherClassFormSheet=function(form){
    return `<div class="teacher-studio-page-heading"><p class="teacher-overline">YOUR CLASSROOMS</p><h1>New <em>class.</em></h1></div><div class="teacher-form-spread">${form}${M.teacherVisualPanel('class')}</div>${M.teacherStudioFooter()}`;
  };
  M.teacherDrawings=function(root,list){
    const life=lifecycle(root);if(!life.active())return life;
    root.innerHTML=`<section class="teacher-hero teacher-drawings-hero"><div class="teacher-hero-intro"><p class="teacher-overline">YOUR DRAWING CABINET</p><h1>Ideas on<br> <em>paper.</em></h1><p class="teacher-library-total">${list.length} saved ${list.length===1?'drawing':'drawings'}</p>${link('Blank drawing','draw/new','plus','teacher-primary')}</div>${study('step',true)}</section><section aria-label="Saved drawings">${list.length?`<div class="teacher-library-toolbar">${search('drawing-search','Find a drawing')}</div><div class="teacher-drawing-gallery" id="drawing-list">${list.map((d,i)=>`<article class="card teacher-drawing-sheet" data-drawing-id="${e(d.id)}" data-title="${e(String(d.title).toLowerCase())}"><a href="#/drawings/${c(d.id)}" class="teacher-drawing-open" aria-label="Open drawing: ${e(d.title)}"><div class="teacher-drawing-preview-wrap"><span class="teacher-drawing-sheet-index" aria-hidden="true">${String(i+1).padStart(2,'0')}</span><div class="drawing-thumb" data-thumb="${e(d.id)}" data-state="idle" role="img" aria-label="Preview of ${e(d.title)}" aria-busy="true">${M.icon('drawing')}</div></div><div class="teacher-drawing-title"><h3>${e(d.title)}</h3>${M.icon('arrow')}</div><p class="teacher-drawing-date">${e(M.date(d.updated_at))}</p></a><div class="teacher-drawing-actions"><button type="button" class="teacher-link" data-action="rename-drawing" data-id="${e(d.id)}" aria-label="Rename ${e(d.title)}">${M.icon('drawing')}<span>Rename</span></button><button type="button" class="teacher-link teacher-drawing-delete" data-action="delete-drawing" data-id="${e(d.id)}" aria-label="Delete ${e(d.title)}">${M.icon('trash')}<span>Delete</span></button><button type="button" class="teacher-link" data-thumb-retry hidden>${M.icon('redo')}<span>Retry preview</span></button></div></article>`).join('')}</div><div id="no-search-results" class="teacher-library-no-results" role="status" hidden><p>No drawings match.</p><button type="button" class="teacher-link" id="teacher-drawing-clear">${M.icon('redo')}<span>Clear search</span></button></div><p class="teacher-class-result-count" id="teacher-drawing-result-count" aria-live="polite">${list.length} drawings</p>`:`<div class="teacher-studio-empty"><div><p class="teacher-overline">A FRESH SHEET</p><h2>Your first <em>drawing.</em></h2>${link('Start drawing','draw/new','drawing','teacher-primary')}</div><div aria-hidden="true">${M.projectionThumbnail('pyramid','iso')}</div></div>`}</section>${M.teacherStudioFooter()}`;
    bindStudies(root,life);
    if(!list.length)return life;
    const queue=[],cards=M.$$('[data-drawing-id]',root);let inFlight=0;
    const pump=()=>{
      while(life.active()&&inFlight<4&&queue.length){
        const host=queue.shift(),card=host.closest('[data-drawing-id]');
        if(card.hidden){host.dataset.state='idle';continue;}
        host.dataset.state='loading';inFlight++;
        M.api('drawings/'+c(host.dataset.thumb)).then(result=>{
          if(!life.active()||!host.isConnected)return;
          if(!Array.isArray(result.data?.entities))throw new Error('Preview unavailable');
          host.innerHTML=result.data.entities.length?M.thumbnail(result.data):M.icon('drawing')+'<span>Empty drawing</span>';host.dataset.state='ready';
        }).catch(()=>{
          if(!life.active()||!host.isConnected)return;
          host.innerHTML=M.icon('drawing')+'<span>Preview unavailable</span>';host.dataset.state='error';M.$('[data-thumb-retry]',card).hidden=false;
        }).finally(()=>{inFlight--;if(life.active())host.setAttribute('aria-busy','false');pump();});
      }
    };
    const observer=new IntersectionObserver(entries=>{
      entries.filter(entry=>entry.isIntersecting).forEach(({target})=>{
        observer.unobserve(target);
        if(!life.active()||target.closest('[data-drawing-id]').hidden||target.dataset.state!=='idle')return;
        target.dataset.state='queued';queue.push(target);
      });pump();
    },{rootMargin:'100px'});
    const input=M.$('#drawing-search',root);
    const filter=()=>{
      const query=input.value.trim().toLowerCase();let visible=0;
      cards.forEach(card=>{card.hidden=!card.dataset.title.includes(query);if(!card.hidden)visible++;const host=M.$('[data-thumb]',card);if(card.hidden)observer.unobserve(host);else if(host.dataset.state==='idle')observer.observe(host);});
      M.$('#no-search-results',root).hidden=visible>0;
      M.$('#teacher-drawing-result-count',root).textContent=visible+' '+(visible===1?'drawing':'drawings');
    };
    life.listen(input,'input',filter);life.listen(M.$('#teacher-drawing-clear',root),'click',()=>{input.value='';filter();input.focus();});
    cards.forEach(card=>{
      life.listen(M.$('[data-thumb-retry]',card),'click',event=>{event.currentTarget.hidden=true;const host=M.$('[data-thumb]',card);host.dataset.state='idle';host.setAttribute('aria-busy','true');host.innerHTML=M.icon('drawing');observer.observe(host);});
      life.listen(M.$('[data-action=rename-drawing]',card),'click',async event=>{
        const button=event.currentTarget,d=list.find(d=>String(d.id)===button.dataset.id);
        const answer=await M.dialog('Rename drawing','Choose a title.',M.field('title','Drawing title',d.title,{required:true}),'Save title');
        if(answer&&life.active())M.busy(button,async()=>{await M.api('drawings/'+c(d.id),'PUT',{title:M.limitText(answer.title,200,'Drawing title')});if(life.active())M.reload();}).catch(error=>{if(life.active())M.toast(M.errorText(error),true);});
      });
      life.listen(M.$('[data-action=delete-drawing]',card),'click',async event=>{
        const button=event.currentTarget,d=list.find(d=>String(d.id)===button.dataset.id);
        if(await M.dialog('Delete '+d.title+'?','This removes the saved drawing from your account. This action cannot be undone.','','Delete drawing',true)&&life.active())M.busy(button,async()=>{await M.api('drawings/'+c(d.id),'DELETE');if(life.active())M.reload();}).catch(error=>{if(life.active())M.toast(M.errorText(error),true);});
      });
    });filter();
    return {dispose:()=>{life.dispose();observer.disconnect();queue.length=0;}};
  };
  function practiceArt(key){
    if(key==='solid')return M.projectionThumbnail('prism','iso');
    const content=key==='points'?'<path class="study-projector" d="M82 36v127M202 52v94"/><circle cx="82" cy="36" r="4"/><circle cx="82" cy="163" r="4"/><circle cx="202" cy="52" r="4"/><circle cx="202" cy="146" r="4"/><text x="89" y="32">a′</text><text x="89" y="178">a</text><text x="210" y="47">b′</text><text x="210" y="160">b</text>':key==='line'?'<path class="study-projector" d="M69 58v105M219 35v146"/><path d="M69 58 219 35M69 105 219 146"/><circle cx="69" cy="58" r="3"/><circle cx="219" cy="35" r="3"/><circle cx="69" cy="105" r="3"/><circle cx="219" cy="146" r="3"/><path class="study-projector" d="M69 163h150M69 158v10M219 158v10"/><text x="133" y="181">AB</text>':'<path class="study-projector" d="M93 32v151M187 32v151"/><path d="M93 43h94M93 104h94v47H93Z"/><circle cx="93" cy="104" r="3"/><circle cx="187" cy="151" r="3"/><path class="study-projector" d="M207 104v47m-5-47h10m-10 47h10"/><text x="219" y="132">40</text>';
    return `<svg viewBox="0 0 280 195" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2"><path class="study-projector" d="M30 13v168M13 13h254M13 181h254"/><path class="study-axis" d="M15 83h250"/>${content}</g><g class="study-label"><text x="16" y="77">X</text><text x="258" y="77">Y</text></g></svg>`;
  }
  M.teacherPractice=function(root,progress){
    const life=lifecycle(root);if(!life.active())return life;
    const lessons=[['points','Points','Coordinates','point'],['line','Lines','Connect & measure','line'],['square','Planes','Construct a square','drawing'],['solid','Solids','Front & top views','model']];
    const done=lessons.filter(([key])=>progress['major2-'+key]).length;
    root.innerHTML=`<section class="teacher-hero teacher-practice-hero"><div class="teacher-hero-intro"><p class="teacher-overline">THE PRACTICE STUDIO</p><h1>Explore by<br> <em>drawing.</em></h1><div class="teacher-practice-progress" aria-label="${done} of 4 lessons completed">${lessons.map(([key],i)=>`<span class="${progress['major2-'+key]?'done':''}">${progress['major2-'+key]?M.icon('check'):String(i+1).padStart(2,'0')}</span>`).join('')}<span>${done} / 4</span></div></div>${study('prism',true)}</section><section class="teacher-practice-gallery" aria-label="Practice lessons">${lessons.map(([key,title,caption,icon],i)=>`<a class="teacher-practice-sheet" href="#/learn/${key}" aria-label="${progress['major2-'+key]?'Practice again':'Start lesson'}: ${e(title)}"><div class="teacher-practice-sheet-art"><span class="teacher-overline">STUDY / ${String(i+1).padStart(2,'0')}</span>${practiceArt(key)}</div><div class="teacher-practice-sheet-body"><div><h2>${title}</h2><p>${caption}</p></div>${M.icon(icon)}</div><div class="teacher-practice-sheet-action"><span>${progress['major2-'+key]?'Practice again':'Start lesson'}</span>${progress['major2-'+key]?'<span class="teacher-practice-done">'+M.icon('check')+' Completed</span>':M.icon('arrow')}</div></a>`).join('')}</section>${M.teacherStudioFooter()}`;
    bindStudies(root,life);return life;
  };
  M.teacherAssignmentSheet=function(set,submissions,submissionRow){
    return `<section class="teacher-studio-detail-heading"><div><p class="teacher-overline">DRAWING BRIEF / ${e(set.code)}</p><h1>${e(set.title)}</h1><p class="teacher-library-total">${e(set.class_title||'Open assignment')} <span>·</span> ${set.questions.length} ${set.questions.length===1?'question':'questions'}</p></div>${M.button('Copy code','copy-code','compact','classes')}</section><div class="row-list">${set.questions.map((q,qi)=>{
      const data=q.model,actual=Array.isArray(data?.entities)&&data.entities.length>0;
      return `<article class="card question-card teacher-question-sheet"><div class="teacher-question-content"><div class="question-heading"><span class="question-number">${String(qi+1).padStart(2,'0')}</span><strong>Question ${qi+1}</strong><span class="badge">${q.has_model?'Model attached':'No model'}</span></div><p class="prompt">${e(typeof q==='string'?q:q.prompt)}</p>${q.hint?`<details><summary>Hint</summary><p>${e(q.hint)}</p></details>`:''}<div class="actions">${link(q.has_model?'Edit model':'Draw model','model/'+c(set.code)+'/'+qi,'drawing','teacher-primary')}${M.button('Attach saved drawing','attach-'+qi,'compact')}</div><div class="model-box"><p class="small">Private model · student controls</p><label class="check-field"><input type="checkbox" data-check="${qi}" ${q.check_enabled?'checked':''} ${!q.has_model?'disabled':''}>Allow drawing checks</label><label class="check-field"><input type="checkbox" data-show3d="${qi}" ${q.show_3d?'checked':''} ${!q.has_3d?'disabled':''}>Show 3D reference</label>${q.has_model?M.button('Remove model','remove-model-'+qi,'danger compact'):''}</div></div><div class="teacher-question-art">${q.show_3d&&q.model3d?.status==='ok'?`<span class="teacher-overline">STUDENT 3D REFERENCE</span><div class="reference-host" data-ref="${qi}"></div><div class="actions">${M.button('Reset view','reset-ref-'+qi,'compact')}${M.button('Rotate left','rotate-ref-'+qi,'compact')}</div>`:actual?`<span class="teacher-overline">PRIVATE MODEL</span><div class="teacher-question-model">${M.thumbnail(data)}</div>`:`<span class="teacher-overline">PROJECTION STUDY</span>${M.projectionThumbnail(['step','prism','pyramid'][qi%3],'iso')}<span class="teacher-question-art-note">Not to scale</span>`}</div></article>`;
    }).join('')}</div><section class="page-section"><div class="teacher-section-heading"><h2>Student work <span>${submissions.length}</span></h2>${M.button('Delete assignment','delete-set','danger compact')}</div>${submissions.length?`<div class="row-list">${submissions.map(submissionRow).join('')}</div>`:`<div class="teacher-studio-empty teacher-studio-empty-small"><div><h2>Ready for <em>student work.</em></h2><code>${e(set.code)}</code></div><div aria-hidden="true">${M.projectionThumbnail('step','front')}</div></div>`}</section>${M.teacherStudioFooter()}`;
  };
  M.teacherDrawingDesk=function(screen){
    screen.classList.add('teacher-drawing-desk','studio-shell');
    const life=lifecycle(screen),guide=M.$('.desk-guide',screen);
    guide.insertAdjacentHTML('beforeend',`<section class="teacher-desk-study"><p class="teacher-overline">STUDIO STUDY</p>${study('step',true)}</section>`);
    bindStudies(screen,life);return life;
  };
})();

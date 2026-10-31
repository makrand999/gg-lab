(function(){
  'use strict';
  const M=window.Major2,e=M.escape,c=M.code,U=M.studentUI;
  const {amount,link,latestWork,brief,monoNumber,newest}=U;
  function lifecycle(root){
    const abort=new AbortController(),token=M.session()?.token;
    return {active:()=>root.isConnected&&!abort.signal.aborted&&M.session()?.token===token,dispose:()=>abort.abort(),listen:(host,event,fn)=>host.addEventListener(event,fn,{signal:abort.signal})};
  }
  function arrays(...values){if(!values.every(Array.isArray))throw new Error('Your workspace data is unavailable. Please retry.');}
  const action=(label,key,icon='plus',kind='')=>`<button type="button" class="student-link ${kind}" data-student-action="${key}">${M.icon(icon)}<span>${e(label)}</span></button>`;
  function heading(title,emphasis,meta='',actions=''){
    return `<header class="student-page-heading"><div><h1>${e(title)}${emphasis?' <em>'+e(emphasis)+'</em>':''}</h1>${meta?`<p>${e(meta)}</p>`:''}</div><div class="student-page-actions">${actions}</div></header>`;
  }
  function footer(){return `<footer class="student-page-footer"><div aria-hidden="true">${['front','top','side'].map(view=>M.projectionThumbnail('prism',view)).join('')}</div><span>EG / STUDENT STUDIO</span><button type="button" class="student-link" data-action="help">${M.icon('help')}<span>Help</span></button></footer>`;}
  function empty(title,route,label,model='step',extra=''){
    return `<section class="student-empty-sheet"><div><h2>${e(title)}</h2><div class="student-page-actions">${link(label,route,'arrow','student-primary')}${extra}</div></div>${U.art(model,'student-ambient')}</section>`;
  }
  function search(id,label){return `<label class="student-search"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><span class="studio-sr-only">${e(label)}</span><input id="${id}" type="search" aria-label="${e(label)}" placeholder="${e(label)}" autocomplete="off"></label>`;}
  function filters(items,key){return `<div class="student-filters" role="group" aria-label="${e(key==='work'?'Submission status':'Assignment status')}">${items.map(([value,label,count],i)=>`<button type="button" data-student-filter="${value}" aria-pressed="${i===0}">${e(label)}${count===undefined?'':`<span>${count}</span>`}</button>`).join('')}</div>`;}
  function noResults(id){return `<div class="student-no-results" id="${id}" role="status" hidden><p>No matches.</p><button type="button" class="student-link" data-student-clear>${M.icon('redo')}<span>Clear filters</span></button></div>`;}
  function bindFilter(root,life,inputId,cardSelector,match,outputId){
    const input=M.$('#'+inputId,root),cards=M.$$(cardSelector,root);let filter='all';
    function paint(){
      let visible=0;const query=input.value.trim().toLowerCase();
      cards.forEach(card=>{card.hidden=!match(card,query,filter);if(!card.hidden)visible++;});
      M.$('#'+outputId,root).hidden=visible>0;
      const count=M.$('[data-student-result-count]',root);if(count)count.textContent=visible+' shown';
    }
    life.listen(input,'input',paint);
    M.$$('[data-student-filter]',root).forEach(button=>life.listen(button,'click',()=>{filter=button.dataset.studentFilter;M.$$('[data-student-filter]',root).forEach(item=>item.setAttribute('aria-pressed',String(item===button)));paint();}));
    life.listen(M.$('[data-student-clear]',root),'click',()=>{input.value='';filter='all';M.$$('[data-student-filter]',root).forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.studentFilter==='all')));paint();input.focus();});paint();
  }
  function bindCode(root,life){M.$$('[data-student-action=open-code]',root).forEach(button=>life.listen(button,'click',async()=>{
    const answer=await M.dialog('Open a brief','Enter your assignment code.',M.field('code','Assignment code','',{required:true,max:24,attrs:'autocapitalize="none" spellcheck="false"'}),'Open assignment');
    if(answer&&life.active())M.go('assignments/'+c(answer.code.trim()));
  }));}
  function setStates(set,latest){
    const states=new Set();for(let qi=0;qi<amount(set.nquestions);qi++){
      const sub=latest.get(String(set.code)+'/'+qi);states.add(!sub?'open':sub.verdict==='fail'?'rework':sub.verdict==='pass'?'passed':'sent');
    }return [...states].join(' ');
  }
  function gallery(sets,latest){return `<div class="student-brief-gallery student-library-gallery">${sets.map((set,i)=>`<div class="student-brief-wrap" data-student-brief data-search="${e([set.title,set.code,set.class_title,set.class_code].join(' ').toLowerCase())}" data-states="${setStates(set,latest)}">${brief(set,i,latest)}</div>`).join('')}</div>`;}
  const legend='<div class="student-question-legend"><span><i class="open"></i>To draw</span><span><i class="sent"></i>Sent</span><span><i class="passed"></i>Pass</span><span><i class="rework"></i>Needs work</span></div>';
  M.studentAssignments=function(root,{sets,submissions}){
    arrays(sets,submissions);const life=lifecycle(root);if(!life.active())return life;
    const latest=latestWork(submissions),counts=state=>sets.filter(set=>setStates(set,latest).split(' ').includes(state)).length;
    const next=U.nextWork(sets,latest),nextAction=next?link((next.kind==='rework'?'Rework':next.kind==='continue'?'Continue':'Start')+' Q'+monoNumber(next.qi+1),'solve/'+c(next.set.code)+'/'+next.qi,'drawing','student-primary','aria-label="'+e((next.kind==='rework'?'Rework':next.kind==='continue'?'Continue':'Start')+' question '+(next.qi+1)+' of '+next.set.title)+'"'):'';
    root.innerHTML=heading('Your drawing','briefs.',sets.length+' assignments',nextAction+action('Open with code','open-code','plus',next?'':'student-primary'))+
      (sets.length?`<section aria-label="Assignments" id="student-assignment-library"><div class="student-library-toolbar">${search('student-assignment-search','Find an assignment')}${filters([['all','All',sets.length],['open','To draw',counts('open')],['rework','Needs work',counts('rework')],['sent','Awaiting review',counts('sent')]],'brief')}</div>${gallery(sets,latest)}${noResults('student-assignment-no-results')}${legend}<p class="student-result-count" data-student-result-count aria-live="polite"></p></section>`:empty('Your first brief starts here.','classes/join','Join class','step',action('Assignment code','open-code','learn')))+footer();
    bindCode(root,life);
    if(sets.length)bindFilter(root,life,'student-assignment-search','[data-student-brief]',(card,query,filter)=>card.dataset.search.includes(query)&&(filter==='all'||card.dataset.states.split(' ').includes(filter)),'student-assignment-no-results');
    return life;
  };
  M.studentClasses=function(root,classes){
    arrays(classes);const life=lifecycle(root);if(!life.active())return life;
    root.innerHTML=heading('Your','classes.',classes.length+' classrooms',link('Join class','classes/join','plus','student-primary'))+
      (classes.length?`<section id="student-class-library" aria-label="My classes"><div class="student-library-toolbar">${search('student-class-search','Find a class')}</div><div class="student-class-gallery">${classes.map((cls,i)=>`<a class="student-class-paper" href="#/classes/${c(cls.code)}" data-student-class data-search="${e([cls.title,cls.code].join(' ').toLowerCase())}"><div class="student-brief-index"><span>CLASS / ${monoNumber(i+1)}</span><code>${e(cls.code)}</code></div><div class="student-class-paper-title"><h2>${e(cls.title)}</h2>${M.icon('arrow')}</div><div class="student-class-paper-bottom"><span>${amount(cls.nsets)} ${amount(cls.nsets)===1?'assignment':'assignments'}</span><span class="student-class-paper-views" aria-hidden="true">${['front','top'].map(view=>M.projectionThumbnail(['prism','step','pyramid'][i%3],view)).join('')}</span></div></a>`).join('')}</div>${noResults('student-class-no-results')}<p class="student-result-count" data-student-result-count aria-live="polite"></p></section>`:empty('A place for your next drawing.','classes/join','Join class','prism'))+footer();
    if(classes.length)bindFilter(root,life,'student-class-search','[data-student-class]',(card,query)=>card.dataset.search.includes(query),'student-class-no-results');return life;
  };
  M.studentClass=function(root,{cls,sets,submissions}){
    arrays(sets,submissions);const life=lifecycle(root);if(!life.active())return life;
    root.innerHTML=`<a class="student-link student-breadcrumb" href="#/classes">${M.icon('back')}<span>Classes</span></a>`+heading(cls.title,'','Class / '+cls.code,M.button('Copy code','copy-code','compact','classes'))+
      `<section aria-label="Class assignments"><div class="student-section-heading"><h2>Assignments <span>${sets.length}</span></h2></div>${sets.length?gallery(sets,latestWork(submissions))+legend:empty('No briefs yet.','learn','Try a practice drawing','step')}</section><div class="student-class-controls">${M.button('Leave class','remove-class','danger compact')}</div>`+footer();
    life.listen(M.$('[data-action=copy-code]',root),'click',async()=>{try{await navigator.clipboard.writeText(cls.code);if(life.active())M.toast('Class code copied.');}catch(_){if(life.active())await M.dialog('Class code','Copy your class code.',M.field('code','Class code',cls.code),'Done');}});
    life.listen(M.$('[data-action=remove-class]',root),'click',async event=>{
      const button=event.currentTarget;
      if(await M.dialog('Leave this class?','You will no longer see its assignments in your class list.','','Leave class',true)&&life.active())M.busy(button,async()=>{await M.api('classes/'+c(cls.code)+'/leave','POST',{});if(life.active())M.go('classes');}).catch(error=>{if(life.active())M.toast(M.errorText(error),true);});
    });return life;
  };
  M.studentJoinSheet=form=>heading('Join your','class.','Use the code from your teacher.')+`<div class="student-join-sheet">${form}<div class="student-join-watermark" aria-hidden="true">${M.projectionThumbnail('prism','iso')}</div></div>`+footer();
  M.studentAssignmentSheet=function(set,submissions){
    arrays(set.questions,submissions);const latest=latestWork(submissions),drafts=U.draftWork([{...set,nquestions:set.questions.length}],latest),sent=set.questions.filter((q,qi)=>latest.has(String(set.code)+'/'+qi)).length;
    return `<a class="student-link student-breadcrumb" href="#/assignments">${M.icon('back')}<span>Assignments</span></a>`+heading(set.title,'',(set.class_title||'Open assignment')+' / '+set.code,M.button('Copy code','copy-code','compact','classes'))+
      `<div class="student-assignment-progress"><span>${sent} / ${set.questions.length} questions sent</span><div class="student-question-map">${set.questions.map((q,qi)=>`<button type="button" class="student-question-cell" data-student-question-target="${qi+1}" aria-label="Jump to question ${qi+1}">${monoNumber(qi+1)}</button>`).join('')}</div></div><section class="student-question-stack" aria-label="Assignment questions">${set.questions.length?set.questions.map((q,qi)=>{
        const sub=latest.get(String(set.code)+'/'+qi),draft=drafts.some(d=>d.qi===qi),rework=sub?.verdict==='fail';
        const label=rework?'Rework drawing':sub?'Draw another attempt':draft?'Continue draft':'Start drawing';
        return `<article class="card question-card student-question-sheet" id="question-${qi+1}"><div class="question-heading"><span class="question-number">${monoNumber(qi+1)}</span><strong>Question ${qi+1}</strong>${M.status(sub)}</div><p class="prompt">${e(typeof q==='string'?q:q.prompt)}</p><div class="student-question-actions">${link(label,'solve/'+c(set.code)+'/'+qi,'drawing','student-primary')}${sub?link('View result','review/'+c(sub.id),'review'):''}</div>${q.hint?`<details class="student-hint"><summary>Hint</summary><p>${e(q.hint)}</p></details>`:''}${q.show_3d&&q.model3d?.status==='ok'?`<details class="student-question-reference"><summary>${M.icon('model')}3D reference</summary><div class="reference-host" data-ref="${qi}"></div><div class="actions">${M.button('Reset view','reset-ref-'+qi,'compact')}${M.button('Rotate left','rotate-ref-'+qi,'compact')}</div><p class="small muted">Drag to look around.</p></details>`:''}<span class="student-question-registration" aria-hidden="true"></span></article>`;
      }).join(''):empty('No questions posted yet.','assignments','All assignments','step')}</section>`+footer();
  };
  M.studentDrawings=function(root,list){
    arrays(list);const life=lifecycle(root);if(!life.active())return life;
    root.innerHTML=heading('Your saved','work.',list.length+' drawings',link('Blank drawing','draw/new','plus','student-primary'))+
      (list.length?`<section aria-label="Saved drawings"><div class="student-library-toolbar">${search('drawing-search','Find a drawing')}</div><div class="student-drawing-gallery grid" id="drawing-list">${list.map((d,i)=>`<article class="student-drawing-sheet" data-drawing-id="${e(d.id)}" data-title="${e(String(d.title).toLowerCase())}"><a href="#/drawings/${c(d.id)}" class="student-drawing-open" aria-label="Open drawing: ${e(d.title)}"><div class="student-drawing-preview"><span aria-hidden="true">${monoNumber(i+1)}</span><div class="drawing-thumb" data-thumb="${e(d.id)}" data-state="idle" role="img" aria-label="Preview of ${e(d.title)}" aria-busy="true">${M.icon('drawing')}</div></div><div class="student-drawing-title"><h3>${e(d.title)}</h3>${M.icon('arrow')}</div><p>${e(M.date(d.updated_at))}</p></a><div class="student-drawing-controls"><button type="button" class="student-link" data-action="rename-drawing" data-id="${e(d.id)}" aria-label="Rename ${e(d.title)}">${M.icon('drawing')}<span>Rename</span></button><button type="button" class="student-link student-delete" data-action="delete-drawing" data-id="${e(d.id)}" aria-label="Delete ${e(d.title)}">${M.icon('trash')}<span>Delete</span></button><button type="button" class="student-link" data-thumb-retry hidden>${M.icon('redo')}<span>Retry preview</span></button></div></article>`).join('')}</div>${noResults('no-search-results')}<p class="student-result-count" data-student-result-count aria-live="polite"></p></section>`:`<div id="drawing-list">${empty('A fresh sheet is waiting.','draw/new','Start drawing','pyramid')}</div>`)+footer();
    if(!list.length)return life;
    const queue=[],cards=M.$$('[data-drawing-id]',root);let inFlight=0;
    const pump=()=>{
      while(life.active()&&inFlight<4&&queue.length){
        const host=queue.shift(),card=host.closest('[data-drawing-id]');if(card.hidden){host.dataset.state='idle';continue;}
        host.dataset.state='loading';inFlight++;
        M.api('drawings/'+c(host.dataset.thumb)).then(result=>{
          if(!life.active()||!host.isConnected)return;if(!Array.isArray(result.data?.entities))throw new Error('Preview unavailable');
          host.innerHTML=result.data.entities.length?M.thumbnail(result.data):M.icon('drawing')+'<span>Empty drawing</span>';host.dataset.state='ready';
        }).catch(()=>{if(life.active()&&host.isConnected){host.innerHTML=M.icon('drawing')+'<span>Preview unavailable</span>';host.dataset.state='error';M.$('[data-thumb-retry]',card).hidden=false;}}).finally(()=>{inFlight--;if(life.active())host.setAttribute('aria-busy','false');pump();});
      }
    };
    const observer=new IntersectionObserver(entries=>{
      entries.filter(entry=>entry.isIntersecting).forEach(({target})=>{observer.unobserve(target);if(!life.active()||target.closest('[data-drawing-id]').hidden||target.dataset.state!=='idle')return;target.dataset.state='queued';queue.push(target);});pump();
    },{rootMargin:'100px'});
    const input=M.$('#drawing-search',root);
    function filter(){let visible=0;const query=input.value.trim().toLowerCase();cards.forEach(card=>{card.hidden=!card.dataset.title.includes(query);if(!card.hidden)visible++;const host=M.$('[data-thumb]',card);if(card.hidden)observer.unobserve(host);else if(host.dataset.state==='idle')observer.observe(host);});M.$('#no-search-results',root).hidden=visible>0;M.$('[data-student-result-count]',root).textContent=visible+' shown';}
    life.listen(input,'input',filter);life.listen(M.$('[data-student-clear]',root),'click',()=>{input.value='';filter();input.focus();});
    cards.forEach(card=>{
      life.listen(M.$('[data-thumb-retry]',card),'click',event=>{event.currentTarget.hidden=true;const host=M.$('[data-thumb]',card);host.dataset.state='idle';host.setAttribute('aria-busy','true');observer.observe(host);});
      life.listen(M.$('[data-action=rename-drawing]',card),'click',async event=>{const button=event.currentTarget,d=list.find(d=>String(d.id)===button.dataset.id),answer=await M.dialog('Rename drawing','Choose a title.',M.field('title','Drawing title',d.title,{required:true,max:200}),'Save title');if(answer&&life.active())M.busy(button,async()=>{await M.api('drawings/'+c(d.id),'PUT',{title:M.limitText(answer.title,200,'Drawing title')});if(life.active())M.reload();}).catch(error=>{if(life.active())M.toast(M.errorText(error),true);});});
      life.listen(M.$('[data-action=delete-drawing]',card),'click',async event=>{const button=event.currentTarget,d=list.find(d=>String(d.id)===button.dataset.id);if(await M.dialog('Delete '+d.title+'?','This removes the saved drawing from your account. This action cannot be undone.','','Delete drawing',true)&&life.active())M.busy(button,async()=>{await M.api('drawings/'+c(d.id),'DELETE');if(life.active())M.reload();}).catch(error=>{if(life.active())M.toast(M.errorText(error),true);});});
    });filter();return {dispose:()=>{life.dispose();observer.disconnect();queue.length=0;}};
  };
  function lessonArt(key){
    if(key==='solid')return M.projectionThumbnail('prism','iso');
    const shape=key==='points'?'<path class="study-projector" d="M75 28v112M203 43v112"/><circle cx="75" cy="28" r="4"/><circle cx="75" cy="140" r="4"/><circle cx="203" cy="43" r="4"/><circle cx="203" cy="155" r="4"/>':key==='line'?'<path class="study-projector" d="M65 49v81M215 28v126"/><path d="M65 49 215 28M65 130 215 154"/><circle cx="65" cy="49" r="3"/><circle cx="215" cy="28" r="3"/><circle cx="65" cy="130" r="3"/><circle cx="215" cy="154" r="3"/>':'<path class="study-projector" d="M91 24v142M188 24v142"/><path d="M91 39h97M91 107h97v55H91Z"/><path class="study-projector" d="M211 107v55m-5-55h10m-10 55h10"/>';
    return `<svg viewBox="0 0 280 185" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.2"><path class="study-axis" d="M15 83h250"/>${shape}</g><g class="study-label"><text x="16" y="76">X</text><text x="258" y="76">Y</text></g></svg>`;
  }
  M.studentPractice=function(root,progress){
    const life=lifecycle(root);if(!life.active())return life;
    const lessons=[['points','Points','Place & inspect'],['line','Lines','Connect & measure'],['square','Planes','Build a square'],['solid','Solids','Front & top views']],done=lessons.filter(([key])=>progress['major2-'+key]).length;
    root.innerHTML=heading('Explore by','drawing.',done+' / 4 lessons completed')+`<section class="student-practice-gallery grid" aria-label="Practice lessons">${lessons.map(([key,title,caption],i)=>`<a class="student-lesson-sheet" href="#/learn/${key}" aria-label="${progress['major2-'+key]?'Practice again':'Start lesson'}: ${title}"><div class="student-lesson-label"><span>STUDY / ${monoNumber(i+1)}</span>${progress['major2-'+key]?'<span class="student-lesson-done">'+M.icon('check')+' Completed</span>':''}</div><div class="student-lesson-heading"><h2>${title}</h2>${M.icon('arrow')}</div><p>${caption}</p><div class="student-lesson-art" aria-hidden="true">${lessonArt(key)}</div><span class="student-lesson-action">${progress['major2-'+key]?'Practice again':'Start lesson'} ${M.icon('arrow')}</span></a>`).join('')}</section>`+footer();return life;
  };
  M.studentReviews=function(root,{submissions,sets}){
    arrays(submissions,sets);const life=lifecycle(root);if(!life.active())return life;
    const list=[...submissions].sort(newest),latest=latestWork(list),titles=new Map(sets.map(set=>[String(set.code),set.title]));
    const state=sub=>sub.verdict==='fail'?'rework':sub.verdict==='pass'?'passed':'sent',count=value=>list.filter(sub=>state(sub)===value).length;
    root.innerHTML=heading('Your work &','feedback.',list.length+' submitted attempts',link('Assignments','assignments','learn'))+
      (list.length?`<section id="student-feedback-library" aria-label="Submitted work"><div class="student-library-toolbar">${search('student-feedback-search','Find submitted work')}${filters([['all','All',list.length],['rework','Needs work',count('rework')],['sent','Awaiting review',count('sent')],['passed','Pass',count('passed')]],'work')}</div><div class="student-review-gallery">${list.map(sub=>{
        const title=titles.get(String(sub.set_code))||sub.set_code||'Submitted drawing',current=String(latest.get(String(sub.set_code)+'/'+sub.question_index)?.id)===String(sub.id);
        return `<article class="student-review-sheet ${state(sub)}" data-student-review data-state="${state(sub)}" data-search="${e([title,sub.set_code,sub.remarks,'question '+(amount(sub.question_index)+1)].join(' ').toLowerCase())}"><div class="student-review-heading"><span>Q${monoNumber(amount(sub.question_index)+1)}</span>${M.status(sub)}${!current?'<span class="student-older-attempt">Earlier attempt</span>':''}</div><a class="student-review-title" href="#/review/${c(sub.id)}"><h2>${e(title)}</h2>${M.icon('arrow')}</a><p class="student-review-date">${e(M.date(sub.created_at))}</p>${sub.remarks?`<p class="student-review-remarks">${e(sub.remarks)}</p>`:''}<div class="student-review-check">${M.autoStatus(sub)}</div><div class="student-review-actions">${link('View drawing & feedback','review/'+c(sub.id),'review')}${current&&sub.verdict==='fail'?link('Rework drawing','solve/'+c(sub.set_code)+'/'+amount(sub.question_index),'drawing','student-primary'):''}</div></article>`;
      }).join('')}</div>${noResults('student-feedback-no-results')}<p class="student-result-count" data-student-result-count aria-live="polite"></p></section>`:empty('Send your first drawing.','assignments','Open assignments','step'))+footer();
    if(list.length)bindFilter(root,life,'student-feedback-search','[data-student-review]',(card,query,filter)=>card.dataset.search.includes(query)&&(filter==='all'||card.dataset.state===filter),'student-feedback-no-results');return life;
  };
  M.studentRecoverySheet=content=>`<div class="student-recovery-sheet">${content}<div class="student-recovery-mark" aria-hidden="true">${M.projectionThumbnail('step','iso')}</div></div>`+footer();
  M.studentDrawingDesk=function(screen,opts){
    screen.classList.add('student-drawing-desk','studio-shell');screen.dataset.studentDesk=opts.readOnly?'feedback':opts.lesson?'practice':opts.setCode?'assignment':'drawing';
    const life=lifecycle(screen),guide=M.$('.desk-guide',screen),review=M.$('#review-panel',screen),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    // Results belong next to the prompt, before secondary inspection tools.
    if(opts.readOnly)M.$('#task-panel',screen).after(review);
    screen.dataset.motion=reduced.matches||M.read('educad_major2_student_motion',false)?'paused':'playing';
    life.listen(reduced,'change',()=>{screen.dataset.motion=reduced.matches||M.read('educad_major2_student_motion',false)?'paused':'playing';});
    const task=M.$('#task-panel',screen),title=M.$('h2',task);
    if(title&&!opts.lesson)title.textContent=opts.readOnly?'Your submitted drawing.':opts.setCode?'Question '+(opts.qi+1):'Drawing guide';
    if(!opts.question&&!opts.lesson){const description=M.$('p.muted',task);if(description)description.textContent='Front view above XY. Top view below XY. Use the paper or enter exact coordinates below.';}
    guide.classList.add('student-guide-paper');
    const canvas=M.mountStudentCanvas(screen,M.desk);
    return {dispose:()=>{canvas.dispose();life.dispose();}};
  };
})();

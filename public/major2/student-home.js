(function(){
  'use strict';
  const M=window.Major2,e=M.escape,c=M.code;
  const amount=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
  const link=(label,route,icon='arrow',kind='',attrs='')=>`<a class="student-link ${kind}" href="#/${route}" ${attrs}>${M.icon(icon)}<span>${e(label)}</span></a>`;
  const cube='<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 15 9v17L20 38 5 29V12Z M5 12l15 9 15-9 M20 21v17"/><path d="M20 3v18M5 29l15-8 15 8" stroke-dasharray="2 3" opacity=".4"/></svg>';
  const motionIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14M4 9v6M20 9v6"/></svg>';
  const monoNumber=value=>String(value).padStart(2,'0');
  const newest=(a,b)=>Number(b.created_at)-Number(a.created_at)||Number(b.id)-Number(a.id);
  function latestWork(submissions){
    const latest=new Map();
    [...submissions].sort(newest).forEach(sub=>{
      const qi=Number(sub.question_index);if(!Number.isInteger(qi)||qi<0)return;
      const key=String(sub.set_code)+'/'+qi;if(!latest.has(key))latest.set(key,sub);
    });return latest;
  }
  function draftWork(sets,latest){
    const drafts=[],byCode=new Map(sets.map(set=>[String(set.code),set]));
    const prefix='educad_major2_draft_'+M.accountKey()+'/solve/';
    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);if(!key?.startsWith(prefix))continue;
        const path=key.slice(prefix.length),split=path.lastIndexOf('/'),code=path.slice(0,split),qi=Number(path.slice(split+1)),set=byCode.get(code);
        if(split<0||!set||!Number.isInteger(qi)||qi<0||qi>=amount(set.nquestions)||latest.has(code+'/'+qi))continue;
        const draft=M.read(key);if(Array.isArray(draft?.data?.entities)&&draft.data.entities.length)drafts.push({set,qi,draft});
      }
    }catch(error){}return drafts.sort((a,b)=>Number(b.draft.updatedAt)-Number(a.draft.updatedAt));
  }
  function nextWork(sets,latest){
    let first=null;
    for(const set of sets){
      for(let qi=0;qi<amount(set.nquestions);qi++){
        const sub=latest.get(String(set.code)+'/'+qi);
        if(sub?.verdict==='fail')return {kind:'rework',set,qi,sub};
        if(!sub&&!first)first={kind:'start',set,qi};
      }
    }
    const draft=draftWork(sets,latest)[0];return draft?{kind:'continue',...draft}:first;
  }
  function heading(title,count,action=''){
    return `<div class="student-section-heading"><h2>${e(title)}${count===undefined?'':`<span>${amount(count)}</span>`}</h2>${action}</div>`;
  }
  function art(model,kind=''){
    return `<div class="student-art ${kind}" aria-hidden="true">${M.projectionThumbnail(model,'iso')}</div>`;
  }
  function questionCell(set,qi,latest){
    const sub=latest.get(String(set.code)+'/'+qi),state=sub?.verdict==='fail'?'rework':sub?.verdict==='pass'?'passed':sub?'sent':'open';
    const description=state==='rework'?'Needs work':state==='passed'?'Reviewed, pass':state==='sent'?'Awaiting review':'Not submitted';
    const route=sub&&state!=='rework'?'review/'+c(sub.id):'solve/'+c(set.code)+'/'+qi;
    return `<a class="student-question-cell ${state}" href="#/${route}" aria-label="${e(set.title)}, question ${qi+1}, ${description}. ${sub&&state!=='rework'?'View submission':'Open drawing'}"><span>${monoNumber(qi+1)}</span>${state==='passed'?M.icon('check'):state==='rework'?'<span class="student-question-symbol" aria-hidden="true">!</span>':state==='sent'?'<span class="student-question-dot" aria-hidden="true"></span>':''}</a>`;
  }
  function brief(set,index,latest){
    const total=amount(set.nquestions),sent=Array.from({length:total},(_,qi)=>latest.has(String(set.code)+'/'+qi)).filter(Boolean).length;
    return `<article class="student-brief"><div class="student-brief-index"><span>BRIEF / ${monoNumber(index+1)}</span><code>${e(set.code)}</code></div><a class="student-brief-title" href="#/assignments/${c(set.code)}"><h3>${e(set.title)}</h3>${M.icon('arrow')}</a><p class="student-brief-class">${e(set.class_title||'Open assignment')}</p><div class="student-question-map">${Array.from({length:Math.min(8,total)},(_,qi)=>questionCell(set,qi,latest)).join('')}${total>8?`<a class="student-question-cell student-question-more" href="#/assignments/${c(set.code)}" aria-label="Open all ${total} questions for ${e(set.title)}">+${total-8}</a>`:''}</div><div class="student-brief-progress"><span>${sent} / ${total} sent</span><progress value="${sent}" max="${total||1}" aria-label="${e(set.title)}: ${sent} of ${total} questions submitted"></progress></div></article>`;
  }
  function focus(data,latest){
    const {sets,classes}=data,next=nextWork(sets,latest);
    let title,overline,detail,action,secondary,kind;
    if(next){
      kind=next.kind;title=next.set.title;overline=kind==='rework'?'NEEDS YOUR ATTENTION':kind==='continue'?'PICK UP YOUR DRAFT':'YOUR NEXT QUESTION';
      detail=`<span>Q${monoNumber(next.qi+1)}</span><span>${e(next.set.class_title||'Open assignment')}</span>`;
      action=link((kind==='rework'?'Rework':kind==='continue'?'Continue':'Start')+' Q'+monoNumber(next.qi+1),'solve/'+c(next.set.code)+'/'+next.qi,'drawing','student-primary','id="student-next-action" aria-label="'+e((kind==='rework'?'Rework':kind==='continue'?'Continue':'Start')+' question '+(next.qi+1)+' of '+next.set.title)+'"');
      secondary=next.sub?link('Read feedback','review/'+c(next.sub.id),'review'):link('Open brief','assignments/'+c(next.set.code),'learn');
    }else if(sets.length){
      const pending=[...latest.values()].filter(sub=>!sub.verdict).sort(newest)[0];
      const anyQuestions=sets.some(set=>amount(set.nquestions)>0);
      kind=pending?'waiting':anyQuestions?'complete':'brief';
      title=pending?'Your work is sent.':anyQuestions?'Ready for the next challenge.':'Open your drawing brief.';
      overline=pending?'WITH YOUR TEACHER':anyQuestions?'ALL QUESTIONS SENT':'YOUR ASSIGNMENT';
      detail=`<span>${pending?'Awaiting review':anyQuestions?'Explore a practice drawing.':e(sets[0].title)}</span>`;
      action=pending?link('View submission','review/'+c(pending.id),'review','student-primary','id="student-next-action"'):anyQuestions?link('Practice drawing','learn','point','student-primary','id="student-next-action"'):link('Open brief','assignments/'+c(sets[0].code),'learn','student-primary','id="student-next-action"');
      secondary=link('All assignments','assignments','learn');
    }else{
      kind=classes.length?'class':'join';title=classes.length?'Your class is ready.':'Join your class.';
      overline=classes.length?'YOUR CLASSROOM':'A PLACE TO START';detail=`<span>${classes.length?e(classes[0].title):'Use the code from your teacher.'}</span>`;
      action=classes.length?link('Open class','classes/'+c(classes[0].code),'classes','student-primary','id="student-next-action"'):link('Join class','classes/join','plus','student-primary','id="student-next-action"');
      secondary='<button type="button" class="student-link" data-student-action="open-code">'+M.icon('learn')+'<span>Assignment code</span></button>';
    }
    return `<section class="student-focus hero-card" aria-labelledby="student-focus-title" data-next-kind="${kind}"><div class="student-focus-content"><p class="student-overline">${overline}</p><h2 id="student-focus-title" title="${e(title)}">${e(title)}</h2><div class="student-focus-meta">${detail}</div><div class="student-focus-actions">${action}${secondary}</div></div>${art(kind==='rework'?'step':kind==='join'?'pyramid':'prism','student-focus-art')}<span class="student-focus-registration" aria-hidden="true"></span></section>`;
  }
  function feedback(data,latest){
    const reviewed=[...latest.values()].filter(sub=>sub.verdict).sort(newest),pending=[...latest.values()].filter(sub=>!sub.verdict).length;
    const sets=new Map(data.sets.map(set=>[String(set.code),set]));
    return `<section class="student-feedback" aria-labelledby="student-feedback-title"><div class="student-section-heading"><h2 id="student-feedback-title">Feedback <span>${reviewed.length}</span></h2>${link('All work','review','arrow')}</div>${reviewed.length?`<div class="student-feedback-list">${reviewed.slice(0,3).map(sub=>`<a href="#/review/${c(sub.id)}" class="student-feedback-item ${sub.verdict==='fail'?'rework':'passed'}"><div class="student-feedback-item-heading"><span class="student-verdict">${M.icon(sub.verdict==='fail'?'review':'check')}${sub.verdict==='fail'?'Needs work':'Pass'}</span><span>Q${monoNumber(amount(sub.question_index)+1)}</span></div><h3>${e(sets.get(String(sub.set_code))?.title||sub.set_code||'Drawing feedback')}</h3>${sub.remarks?`<p>${e(sub.remarks)}</p>`:'<p>Open your review.</p>'}<span class="student-feedback-open">View feedback ${M.icon('arrow')}</span></a>`).join('')}</div>`:`<div class="student-feedback-empty">${M.icon('review')}<p>${pending?'Your teacher is reviewing your work.':'Feedback will land here.'}</p></div>`}${pending?`<a class="student-waiting" href="#/review"><span class="student-question-dot" aria-hidden="true"></span><span>${pending} awaiting review</span>${M.icon('arrow')}</a>`:''}</section>`;
  }
  M.studentHomeShell=function(app,active='home'){
    const session=M.session(),name=session.name||session.username||'Student';
    const initials=String(name).trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]||'').join('').toUpperCase();
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches,paused=reduced||M.read('educad_major2_student_motion',false);
    const nav=[['home','Home','home'],['assignments','Assignments','learn'],['classes','Classes','classes'],['drawings','Drawings','drawing'],['learn','Practice','point'],['review','Feedback','review']];
    app.innerHTML=`<div class="student-shell studio-shell" data-motion="${paused?'paused':'playing'}"><div class="studio-paper" aria-hidden="true"></div><div class="student-background-study" aria-hidden="true">${M.projectionStudy('step')}</div><aside class="student-rail"><a class="student-rail-brand" href="#/home" aria-label="EduCAD home">${cube}</a><nav class="student-nav" aria-label="Main navigation">${nav.map(([route,label,icon])=>`<a href="#/${route}" ${route===active?'aria-current="page"':''} aria-label="${label}">${M.icon(icon)}<span>${label}</span></a>`).join('')}</nav><div class="student-rail-tools"><button type="button" data-action="help" aria-label="Help" title="Help">${M.icon('help')}</button><button type="button" data-action="signout" aria-label="Sign out" title="Sign out">${M.icon('logout')}</button></div></aside><div class="student-body"><header class="student-header"><a class="student-brand" href="#/home"><strong>EduCAD</strong><span>Student studio</span></a><div class="student-header-actions"><button type="button" class="student-motion" data-student-motion aria-pressed="${paused}" aria-label="${reduced?'Motion reduced by device settings':paused?'Resume background motion':'Pause background motion'}" title="${reduced?'Motion reduced by device settings':paused?'Resume background motion':'Pause background motion'}" ${reduced?'disabled':''}>${motionIcon}</button><button type="button" data-action="appearance" aria-label="Appearance" title="Appearance">${M.icon('palette')}</button><button type="button" class="student-account" data-action="account" aria-label="Account for ${e(name)}" title="${e(name)}">${e(initials)}</button></div></header><main class="student-main" id="main-content" tabindex="-1"><div class="student-loading" role="status">${M.icon('drawing')}<span>Opening your desk…</span></div></main></div></div>`;
    const shell=M.$('.student-shell',app),button=M.$('[data-student-motion]',shell);
    button.onclick=()=>{
      const paused=shell.dataset.motion!=='paused';shell.dataset.motion=paused?'paused':'playing';M.write('educad_major2_student_motion',paused);
      button.setAttribute('aria-pressed',String(paused));button.setAttribute('aria-label',paused?'Resume background motion':'Pause background motion');button.title=button.getAttribute('aria-label');
    };
    return M.$('#main-content',app);
  };
  M.studentUI={amount,link,latestWork,draftWork,nextWork,brief,questionCell,art,monoNumber,newest,motionIcon};
  M.studentHome=function(root,data){
    const abort=new AbortController(),token=M.session()?.token;
    const active=()=>root.isConnected&&!abort.signal.aborted&&M.session()?.token===token;
    if(!active())return {dispose:()=>abort.abort()};
    const listen=(host,event,fn)=>host.addEventListener(event,fn,{signal:abort.signal});
    const latest=latestWork(data.submissions),name=M.session()?.name||M.session()?.username||'Student';
    const drawings=[...data.drawings].sort((a,b)=>Number(b.updated_at)-Number(a.updated_at)||Number(b.id)-Number(a.id)).slice(0,2);
    root.innerHTML=`<div class="student-home-heading"><h1>Your next <em>move.</em></h1><span>Hi, ${e(String(name).trim().split(/\s+/)[0])}</span></div><div class="student-home-grid"><div class="student-home-main-lane">${focus(data,latest)}<section class="student-assignments" aria-label="Assignments">${heading('Assignments',data.sets.length,link('View all','assignments'))}${data.sets.length?`<div class="student-brief-gallery">${data.sets.slice(0,6).map((set,i)=>brief(set,i,latest)).join('')}</div><div class="student-question-legend"><span><i class="open"></i>To draw</span><span><i class="sent"></i>Sent</span><span><i class="passed"></i>Pass</span><span><i class="rework"></i>Needs work</span></div>`:`<div class="student-assignment-empty"><div><h3>${data.classes.length?'No briefs yet.':'Have an assignment code?'}</h3><button type="button" class="student-link" data-student-action="open-code">${M.icon('learn')}<span>Open with code</span></button></div>${art('step')}</div>`}</section></div><aside class="student-home-side-lane">${feedback(data,latest)}<div class="student-secondary"><section aria-label="Saved drawings">${heading('Saved work',data.drawings.length,link('All drawings','drawings'))}${drawings.length?`<div class="student-saved-list">${drawings.map(d=>`<a class="student-saved-item" href="#/drawings/${c(d.id)}"><span class="student-saved-preview" data-student-preview="${e(d.id)}" data-state="loading" aria-busy="true">${M.icon('drawing')}</span><span><strong>${e(d.title)}</strong><small>${e(M.date(d.updated_at))}</small></span>${M.icon('arrow')}</a>`).join('')}</div>`:`<a class="student-saved-empty" href="#/draw/new">${M.icon('drawing')}<span>Start a blank drawing</span>${M.icon('plus')}</a>`}</section><section class="student-class-shelf" aria-label="My classes">${heading('Classes',data.classes.length,link('Join','classes/join','plus'))}${data.classes.length?data.classes.slice(0,3).map((cls,i)=>`<a class="student-class-item" href="#/classes/${c(cls.code)}"><span class="student-class-mark" aria-hidden="true">${monoNumber(i+1)}</span><span><strong>${e(cls.title)}</strong><code>${e(cls.code)}</code></span>${M.icon('arrow')}</a>`).join(''):'<p class="student-muted">Your classes will appear here.</p>'}</section><a class="student-practice-card" href="#/learn"><div><p class="student-overline">TRY A CONSTRUCTION</p><h3>A little <em>practice.</em></h3><span>Points → planes → solids ${M.icon('arrow')}</span></div>${art('prism','student-ambient')}</a></div></aside></div><footer class="student-home-footer"><div class="student-margin-art" aria-hidden="true"><svg viewBox="0 0 720 75"><g fill="none" stroke="currentColor" stroke-width=".8"><path d="M4 38h712" opacity=".35"/><path class="student-animated-projector" d="M43 16h75v43H43ZM72 16V59M139 38h103M272 14l35 23-35 24-35-24ZM308 37h103M441 16h75v43h-75ZM471 16v43M525 38h142"/><path d="M22 10v54M691 10v54M18 10h8M687 64h8" opacity=".35"/></g></svg></div><button type="button" class="student-link" data-action="help">${M.icon('help')}<span>Help</span></button></footer>`;
    M.$$('[data-student-action=open-code]',root).forEach(button=>listen(button,'click',async()=>{
      const answer=await M.dialog('Open a brief','Enter your assignment code.',M.field('code','Assignment code','',{required:true,max:24,attrs:'autocapitalize="none" spellcheck="false"'}),'Open assignment');
      if(answer&&active())M.go('assignments/'+c(answer.code.trim()));
    }));
    M.$$('[data-student-preview]',root).forEach(host=>{
      M.api('drawings/'+c(host.dataset.studentPreview)).then(drawing=>{
        if(!active()||!host.isConnected)return;
        if(!Array.isArray(drawing.data?.entities))throw new Error('Preview unavailable');
        host.innerHTML=M.thumbnail(drawing.data);host.dataset.state='ready';
      }).catch(()=>{if(active()&&host.isConnected){host.innerHTML=M.icon('drawing');host.dataset.state='unavailable';host.setAttribute('aria-label','Preview unavailable. Open saved drawing.');}}).finally(()=>{if(active())host.setAttribute('aria-busy','false');});
    });
    return {dispose:()=>abort.abort()};
  };
})();

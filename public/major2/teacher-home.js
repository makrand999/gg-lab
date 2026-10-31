(function () {
  'use strict';
  const M=window.Major2,e=M.escape,c=M.code;
  const cube='<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 15 9v17L20 38 5 29V12Z M5 12l15 9 15-9 M20 21v17"/><path d="M20 3v18M5 29l15-8 15 8" stroke-dasharray="2 3" opacity=".4"/></svg>';
  const arrow=M.icon('arrow');
  const copyIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h11v14H9zM5 7H3v14h11v-2"/></svg>';
  const studioLink=(label,route,icon='arrow',className='')=>`<a class="teacher-link ${className}" href="#/${route}">${icon?M.icon(icon):''}<span>${e(label)}</span></a>`;
  const initials=name=>Array.from(String(name||'Teacher').trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]||'').join('')).slice(0,2).join('').toUpperCase();
  const amount=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
  const countLabel=(value,label)=>amount(value)+' '+label+(amount(value)===1?'':'s');

  M.teacherStudioShell=function(app,active='home'){
    const session=M.session(),name=session.name||session.username||'Teacher';
    const nav=[['home','Home','home'],['classes','Classes','classes'],['assignments','Assignments','learn'],['review','Review','review'],['drawings','Drawings','drawing'],['learn','Practice','point']];
    app.innerHTML=`<div class="teacher-shell studio-shell">
      <div class="studio-paper" aria-hidden="true"></div>
      <aside class="teacher-rail">
        <a class="teacher-rail-brand" href="#/home" aria-label="EduCAD home">${cube}</a>
        <nav class="teacher-nav" aria-label="Main navigation">${nav.map(([route,label,icon])=>`<a href="#/${route}" ${route===active?'aria-current="page"':''} aria-label="${label}">${M.icon(icon)}<span>${label}</span></a>`).join('')}</nav>
        <div class="teacher-rail-tools"><button type="button" data-action="help" aria-label="Help" title="Help">${M.icon('help')}</button><button type="button" data-action="appearance" aria-label="Appearance" title="Appearance">${M.icon('palette')}</button><button type="button" data-action="signout" aria-label="Sign out" title="Sign out">${M.icon('logout')}</button></div>
      </aside>
      <div class="teacher-body">
        <header class="teacher-header"><a href="#/home" class="teacher-brand"><strong>EduCAD</strong><span>${session.role==='academics'?'Academics':'Teacher'} studio</span></a><div class="teacher-header-actions"><button type="button" class="teacher-mobile-help" data-action="help" aria-label="Help" title="Help">${M.icon('help')}</button><button type="button" class="teacher-mobile-appearance" data-action="appearance" aria-label="Appearance" title="Appearance">${M.icon('palette')}</button><button type="button" class="teacher-account" data-action="account" aria-label="Account for ${e(name)}" title="${e(name)}"><span>${e(initials(name))}</span></button></div></header>
        <main class="teacher-main teacher-main-${active}" id="main-content" tabindex="-1"><div class="teacher-loading" role="status">${M.icon('model')}<span>Opening your studio…</span></div></main>
      </div>
    </div>`;
    return M.$('#main-content',app);
  };

  function classPaper(cls,index){
    return `<article class="teacher-class-paper"><a class="teacher-class-main" href="#/classes/${c(cls.code)}" aria-label="Open class: ${e(cls.title)}"><div class="teacher-class-diagram" aria-hidden="true"><svg viewBox="0 0 190 90"><path class="teacher-class-grid" d="M15 15h160M15 45h160M15 75h160M35 5v80M65 5v80M95 5v80M125 5v80M155 5v80"/><path class="teacher-class-wire" d="m70 30 25-15 25 15v30l-25 15-25-15Z M70 30l25 15 25-15M95 45v30"/><path class="teacher-class-hidden" d="M95 15v30M70 60l25-15 25 15"/><circle cx="70" cy="30" r="2"/><circle cx="120" cy="60" r="2"/><text x="13" y="25">${String(index+1).padStart(2,'0')}</text></svg>${arrow}</div><h3>${e(cls.title)}</h3><p>${countLabel(cls.nmembers,'student')} <span aria-hidden="true">·</span> ${countLabel(cls.nsets,'assignment')}</p></a><div class="teacher-class-code"><code>${e(cls.code)}</code><button type="button" data-copy-class="${e(cls.code)}" aria-label="Copy code for ${e(cls.title)}" title="Copy class code">${copyIcon}</button></div></article>`;
  }
  M.classSheet=classPaper;
  M.copyStudioClassCode=async function(code,active){
    try{await navigator.clipboard.writeText(code);if(active())M.toast('Class code copied.');}
    catch(error){if(active())await M.dialog('Class code','Copy this code.',M.field('code','Class code',code,{attrs:'readonly'}),'Done');}
  };
  function assignmentStrip(set,index){
    const questions=amount(set.nquestions),number=String(index+1).padStart(2,'0');
    return `<a class="teacher-assignment teacher-assessment" href="#/assignments/${c(set.code)}">
      <div class="teacher-assessment-plan" aria-hidden="true"><svg viewBox="0 0 112 122"><path class="teacher-assessment-guides" d="M8 17h96M8 47h96M8 77h96M8 107h96M23 7v108M53 7v108M83 7v108"/><path class="teacher-assessment-page" d="M21 13h61l16 16v76H21Z M82 13v16h16"/><path class="teacher-assessment-guide" d="M12 89h92M39 7v105"/><text x="55" y="76" text-anchor="middle">${number}</text><path class="teacher-assessment-dimension" d="M21 113h77M21 109v8M98 109v8m-73-6-4 2 4 2m69-4 4 2-4 2"/></svg></div>
      <div class="teacher-assessment-body"><div class="teacher-assessment-meta"><code>${e(set.code)}</code><span class="teacher-assessment-review" data-assessment-code="${e(set.code)}" hidden></span></div><h3>${e(set.title)}</h3><p>${e(set.class_title||'Open assignment')}</p><div class="teacher-question-map"><span class="teacher-question-cells" aria-hidden="true">${Array.from({length:Math.min(5,questions)},(_,qi)=>`<span>${String(qi+1).padStart(2,'0')}</span>`).join('')}${questions>5?`<span class="teacher-question-more">+${questions-5}</span>`:''}</span><span>${countLabel(questions,'question')}</span></div></div>
      <span class="teacher-assessment-arrow" aria-hidden="true">${arrow}</span>
    </a>`;
  }
  M.assessmentBrief=assignmentStrip;
  M.teacherReviewGroups=async function(sets,active){
    const groups=new Array(sets.length);let next=0,failure=null;
    const worker=async()=>{
      while(active()&&!failure){
        const index=next++;if(index>=sets.length)return;
        try{
          const result=await M.api('sets/'+c(sets[index].code)+'/submissions');
          if(!Array.isArray(result.submissions))throw new Error('Review data unavailable.');
          groups[index]={set:sets[index],submissions:result.submissions};
        }catch(error){failure=error;}
      }
    };
    await Promise.all(Array.from({length:Math.min(4,sets.length)},worker));
    if(!active())return null;
    if(failure)throw failure;
    return groups;
  };
  M.updateAssessmentReviews=function(root,groups){
    const counts=new Map(groups.map(group=>[String(group.set.code),group.submissions.filter(sub=>!sub.verdict).length]));
    M.$$('[data-assessment-code]',root).forEach(marker=>{
      const count=counts.get(marker.dataset.assessmentCode)||0;
      marker.textContent=count+' to review';marker.hidden=count===0;
    });
    return counts;
  };
  function emptyPanel(title,route,label,icon){
    return `<div class="teacher-empty">${M.icon(icon)}<p>${e(title)}</p>${studioLink(label,route,'plus')}</div>`;
  }

  M.teacherHome=function(root,data){
    const classes=data.classes,sets=data.sets,drawings=data.drawings;
    const abort=new AbortController(),token=M.session()?.token;
    const active=()=>root.isConnected&&!abort.signal.aborted&&M.session()?.token===token;
    if(!active())return {dispose:()=>abort.abort()};
    root.innerHTML=`<section class="teacher-hero hero-card" aria-labelledby="teacher-home-title">
      <div class="teacher-hero-intro"><p class="teacher-overline">YOUR TEACHING DESK</p><h1 id="teacher-home-title">Set the next<br> <em>challenge.</em></h1><div class="teacher-hero-actions">${studioLink('New assignment','assignments/new','plus','teacher-primary')}${studioLink('Blank drawing','draw/new','drawing')}</div></div>
      <figure class="teacher-hero-study"><div class="teacher-projection-sheet">${M.projectionStudy('prism')}</div><div class="teacher-view-controls" role="group" aria-label="Projection view">${[['iso','3D'],['front','Front'],['top','Top'],['side','Side']].map(([view,label])=>`<button type="button" data-teacher-view="${view}" aria-label="${view==='iso'?'Isometric':label} view" aria-pressed="${view==='iso'}">${M.projectionThumbnail('prism',view)}<span>${label}</span></button>`).join('')}</div><figcaption>Not to scale</figcaption></figure>
    </section>
    <div class="teacher-workbench">
      <div class="teacher-board">
        <section aria-labelledby="teacher-classes-title"><div class="teacher-section-heading"><h2 id="teacher-classes-title">Classes <span>${classes.length}</span></h2>${studioLink('New class','classes/new','plus')}</div>${classes.length?`<div class="teacher-class-grid-list">${classes.slice(0,3).map(classPaper).join('')}</div>${classes.length>3?studioLink('All '+classes.length+' classes','classes','arrow','teacher-all-link'):''}`:emptyPanel('Your first class starts here.','classes/new','New class','classes')}</section>
        <section class="teacher-assignments" aria-labelledby="teacher-assignments-title"><div class="teacher-section-heading"><h2 id="teacher-assignments-title">Assignments <span>${sets.length}</span></h2>${studioLink('View all','assignments')}</div>${sets.length?`<div class="teacher-assignment-list">${sets.slice(0,3).map(assignmentStrip).join('')}</div>`:emptyPanel('No assignments yet.','assignments/new','New assignment','learn')}</section>
      </div>
      <aside class="teacher-review-side" aria-labelledby="teacher-review-title"><div class="teacher-section-heading"><h2 id="teacher-review-title">To review</h2><a class="teacher-icon-link" href="#/review" aria-label="Open review queue">${arrow}</a></div><div id="teacher-review-summary" aria-live="polite" aria-busy="true"><span class="teacher-review-count">—</span><p class="teacher-review-state" role="status">Loading student work…</p></div><a class="teacher-drawing-shelf" href="#/drawings">${M.icon('drawing')}<span>My drawings</span><strong>${drawings.length}</strong>${arrow}</a>${studioLink('Practice','learn','point','teacher-practice-link')}</aside>
    </div>`;
    const listen=(target,event,fn)=>target.addEventListener(event,fn,{signal:abort.signal});
    M.$$('[data-teacher-view]',root).forEach(button=>listen(button,'click',()=>{
      M.$('.teacher-projection-sheet',root).innerHTML=M.projectionStudy('prism',button.dataset.teacherView);
      M.$$('[data-teacher-view]',root).forEach(control=>control.setAttribute('aria-pressed',String(control===button)));
    }));
    M.$$('[data-copy-class]',root).forEach(button=>listen(button,'click',()=>M.copyStudioClassCode(button.dataset.copyClass,active)));
    const host=M.$('#teacher-review-summary',root);
    let loading=false;
    async function loadReview(){
      if(loading||!active())return;
      loading=true;host.setAttribute('aria-busy','true');
      host.innerHTML='<span class="teacher-review-count">—</span><p class="teacher-review-state" role="status">Loading student work…</p>';
      let groups;
      try{groups=await M.teacherReviewGroups(sets,active);}
      catch(error){
        loading=false;if(!active())return;
        host.setAttribute('aria-busy','false');
        host.innerHTML='<span class="teacher-review-count">—</span><p class="teacher-review-state" role="status">Review queue unavailable.</p><button type="button" class="teacher-review-retry">Retry '+M.icon('redo')+'</button>';
        listen(M.$('.teacher-review-retry',host),'click',()=>loadReview().catch(showReviewError));return;
      }
      loading=false;if(!active()||!groups)return;
      host.setAttribute('aria-busy','false');
      const pending=groups.flatMap(group=>group.submissions.filter(sub=>!sub.verdict).map(sub=>({...sub,set:group.set}))).sort((a,b)=>Number(b.created_at)-Number(a.created_at));
      M.updateAssessmentReviews(root,groups);
      host.innerHTML=`<span class="teacher-review-count">${pending.length}</span><p class="teacher-review-state">${pending.length===1?'Drawing waiting':pending.length?'Drawings waiting':'No work waiting.'}</p>${pending.length?`<div class="teacher-review-list">${pending.slice(0,3).map(sub=>`<a class="teacher-review-item" href="#/review/${c(sub.id)}"><span class="teacher-student-mark" aria-hidden="true">${e(initials(sub.name||sub.username||'Student'))}</span><div><strong>${e(sub.name||sub.username||'Student')}</strong><span>${e(sub.set.title)} · Q${amount(sub.question_index)+1}</span></div>${arrow}</a>`).join('')}</div>${studioLink('Review work','review','arrow','teacher-review-action')}`:`<div class="teacher-review-clear" aria-hidden="true">${M.icon('review')}</div>`}`;
    }
    function showReviewError(){
      loading=false;if(!active())return;host.setAttribute('aria-busy','false');host.innerHTML='<p class="teacher-review-state" role="status">Review queue unavailable.</p><a class="teacher-link" href="#/review">Open review queue</a>';
    }
    loadReview().catch(showReviewError);
    return {dispose:()=>abort.abort()};
  };
})();

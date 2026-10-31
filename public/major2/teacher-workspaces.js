(function(){
  'use strict';
  const M=window.Major2,e=M.escape,c=M.code;
  const searchIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg>';
  const amount=value=>Number.isFinite(Number(value))?Math.max(0,Math.floor(Number(value))):0;
  const initials=name=>String(name||'Student').trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]||'').join('').toUpperCase();
  const countLabel=(count,label)=>count+' '+(count===1?label:label==='class'?'classes':label+'s');
  const link=(label,route,icon='arrow',kind='')=>`<a class="teacher-link ${kind}" href="#/${route}">${M.icon(icon)}<span>${e(label)}</span></a>`;
  const folio=(caption,model,index)=>`<div class="teacher-library-folio" aria-hidden="true"><span></span><span></span><div class="teacher-folio-cover"><span class="teacher-folio-index">${e(index)}</span>${M.projectionThumbnail(model,'iso')}<span class="teacher-folio-caption">${e(caption)}</span></div></div>`;
  const searchField=(id,placeholder,label)=>`<label class="teacher-library-search">${searchIcon}<span class="studio-sr-only">${e(label)}</span><input type="search" id="${id}" placeholder="${e(placeholder)}" aria-label="${e(label)}" autocomplete="off"></label>`;
  function lifecycle(root){
    const abort=new AbortController(),token=M.session()?.token;
    const active=()=>root.isConnected&&!abort.signal.aborted&&M.session()?.token===token;
    return {active,dispose:()=>abort.abort(),listen:(target,event,fn)=>target.addEventListener(event,fn,{signal:abort.signal})};
  }
  function classCopies(root,life){
    M.$$('[data-copy-class]',root).forEach(button=>life.listen(button,'click',()=>M.copyStudioClassCode(button.dataset.copyClass,life.active)));
  }

  M.teacherClasses=function(root,classes){
    const life=lifecycle(root);if(!life.active())return life;
    const assignments=classes.reduce((total,cls)=>total+amount(cls.nsets),0);
    root.innerHTML=`<section class="teacher-library-hero" aria-labelledby="teacher-classes-page-title"><div class="teacher-library-intro"><p class="teacher-overline">YOUR CLASSROOMS</p><h1 id="teacher-classes-page-title">My <em>classes.</em></h1><p class="teacher-library-total"><span>${countLabel(classes.length,'class')}</span><span>${countLabel(assignments,'brief')}</span></p>${link('New class','classes/new','plus','teacher-primary')}</div>${folio('CLASS SHEETS','prism','EG / '+String(classes.length).padStart(2,'0'))}</section>
    ${classes.length?`<section aria-label="Class library"><div class="teacher-library-toolbar">${searchField('teacher-class-search','Find a class','Find a class by name or code')}</div><div class="teacher-class-library" id="teacher-class-library">${classes.map(M.classSheet).join('')}</div><div class="teacher-library-no-results" id="teacher-class-no-results" role="status" hidden><p>No classes match.</p><button type="button" class="teacher-link" id="teacher-class-clear">${M.icon('redo')}<span>Clear search</span></button></div><p class="teacher-class-result-count" id="teacher-class-result-count" aria-live="polite" aria-atomic="true">${classes.length} ${classes.length===1?'class':'classes'}</p></section>`:`<section class="teacher-library-empty">${M.teacherStudioEmptyArt('prism')}<h2>Your first class.</h2>${link('New class','classes/new','plus')}</section>`}`;
    classCopies(root,life);
    if(classes.length){
      const search=M.$('#teacher-class-search',root),cards=M.$$('.teacher-class-paper',root);
      const filter=()=>{
        const query=search.value.trim().toLowerCase();let visible=0;
        classes.forEach((cls,index)=>{cards[index].hidden=!([cls.title,cls.code].join(' ').toLowerCase().includes(query));if(!cards[index].hidden)visible++;});
        M.$('#teacher-class-no-results',root).hidden=visible>0;
        M.$('#teacher-class-result-count',root).textContent=visible===classes.length?visible+' '+(visible===1?'class':'classes'):visible+' of '+classes.length;
      };
      life.listen(search,'input',filter);life.listen(M.$('#teacher-class-clear',root),'click',()=>{search.value='';filter();search.focus();});
    }
    return life;
  };

  M.teacherClass=function(root,{cls,sets,members}){
    const life=lifecycle(root);if(!life.active())return life;
    root.innerHTML=`<section class="teacher-library-hero teacher-class-hero" aria-labelledby="teacher-class-page-title"><div class="teacher-library-intro"><p class="teacher-overline"><a href="#/classes">MY CLASSES</a></p><h1 id="teacher-class-page-title">${e(cls.title)}</h1><div class="teacher-class-share"><code>${e(cls.code)}</code><button type="button" class="teacher-link" data-action="copy-code" data-copy-class="${e(cls.code)}" aria-label="Copy class code">${M.icon('classes')}<span>Copy code</span></button></div><p class="teacher-library-total"><span>${countLabel(members.length,'student')}</span><span>${countLabel(sets.length,'brief')}</span></p><div class="teacher-class-actions">${link('New assignment','assignments/new/'+c(cls.code),'plus','teacher-primary')}<button type="button" class="teacher-class-remove" data-action="remove-class">${M.icon('trash')}<span>Delete class</span></button></div></div>${folio('CLASS SHEET','prism',cls.code)}</section>
    <section aria-labelledby="teacher-class-briefs-title"><div class="teacher-section-heading"><h2 id="teacher-class-briefs-title">Assignments <span>${sets.length}</span></h2>${link('View all','assignments')}</div><div class="teacher-class-review-state" id="teacher-class-review-state" role="status" aria-live="polite"></div>${sets.length?`<div class="teacher-library-grid teacher-class-briefs">${sets.map(M.assessmentBrief).join('')}</div>`:`<div class="teacher-empty">${M.icon('learn')}<p>No assignments yet.</p>${link('New assignment','assignments/new/'+c(cls.code),'plus')}</div>`}</section>
    <section class="teacher-class-roster" aria-labelledby="teacher-class-students-title"><div class="teacher-section-heading"><h2 id="teacher-class-students-title">Students <span>${members.length}</span></h2></div>${members.length?`${searchField('teacher-member-search','Find a student','Find a student by name or username')}<div class="teacher-member-grid">${members.map(member=>`<article class="teacher-member-sheet item-row"><span class="teacher-member-mark" aria-hidden="true">${e(initials(member.name||member.username))}</span><div><h3>${e(member.name||member.username)}</h3><p>${e(member.username)}</p></div></article>`).join('')}</div><p class="teacher-member-empty" id="teacher-member-empty" role="status" hidden>No students match.</p>`:`<div class="teacher-empty">${M.icon('classes')}<p>Nobody has joined yet.</p><button type="button" class="teacher-link" data-copy-class="${e(cls.code)}">${M.icon('classes')}<span>Copy code</span></button></div>`}</section>`;
    classCopies(root,life);
    life.listen(M.$('[data-action=remove-class]',root),'click',async event=>{
      const button=event.currentTarget;
      const answer=await M.dialog('Delete this class?','The class memberships will be removed. Its assignments become open assignments.','','Delete class',true);
      if(answer&&life.active())M.busy(button,async()=>{await M.api('classes/'+c(cls.code),'DELETE');if(life.active())M.go('classes');}).catch(error=>M.toast(M.errorText(error),true));
    });
    if(members.length){
      const search=M.$('#teacher-member-search',root),cards=M.$$('.teacher-member-sheet',root);
      life.listen(search,'input',()=>{
        const query=search.value.trim().toLowerCase();let visible=0;
        members.forEach((member,index)=>{cards[index].hidden=!([member.name,member.username].join(' ').toLowerCase().includes(query));if(!cards[index].hidden)visible++;});
        M.$('#teacher-member-empty',root).hidden=visible>0;
      });
    }
    if(sets.length){
      const status=M.$('#teacher-class-review-state',root);let loading=false;
      const load=async()=>{
        if(loading||!life.active())return;loading=true;status.setAttribute('aria-busy','true');status.textContent='Loading reviews…';
        try{const groups=await M.teacherReviewGroups(sets,life.active);if(groups&&life.active()){M.updateAssessmentReviews(root,groups);status.textContent='';}}
        catch(error){if(life.active()){status.innerHTML='<span>Review status unavailable.</span><button type="button" class="teacher-link" data-class-review-retry>'+M.icon('redo')+'<span>Retry</span></button>';life.listen(M.$('[data-class-review-retry]',status),'click',load);}}
        finally{loading=false;if(life.active())status.setAttribute('aria-busy','false');}
      };load();
    }
    return life;
  };

  function reviewSheet(sub){
    const name=sub.name||sub.username||'Student',qi=amount(sub.question_index)+1;
    const verdict=!sub.verdict?'To review':sub.verdict==='pass'?'Pass':'Needs work';
    const state=!sub.verdict?'pending':sub.verdict==='pass'?'good':'bad';
    const auto=sub.auto?.checked?(sub.auto.pass?'Auto matched':'Auto not matched'):'Auto —';
    return `<article class="teacher-review-sheet" data-verdict="${e(sub.verdict||'')}"><a class="teacher-review-open" href="#/review/${c(sub.id)}" aria-label="Review ${e(name)}’s drawing, question ${qi}, ${e(sub.set.title)}"><div class="teacher-review-preview-wrap"><div class="teacher-review-preview" data-review-preview="${e(sub.id)}" data-state="idle" role="img" aria-label="Drawing preview for ${e(name)}" aria-busy="true">${M.icon('drawing')}</div><span class="teacher-review-sheet-number">Q${String(qi).padStart(2,'0')}</span><span class="teacher-review-verdict ${state}">${verdict}</span></div><div class="teacher-review-sheet-info"><span class="teacher-member-mark" aria-hidden="true">${e(initials(name))}</span><div><h3>${e(name)}</h3><p>${e(sub.set.title)}</p><span>${e(sub.set.class_title||'Open assignment')}</span></div>${M.icon('arrow')}</div><div class="teacher-review-sheet-meta"><span>${e(M.date(sub.created_at))}</span><span aria-label="${sub.auto?.checked?'Automatic check: '+(sub.auto.pass?'matched':'not matched'):'Automatic check unavailable'}">${auto}</span></div></a><button type="button" class="teacher-preview-retry teacher-link" hidden>${M.icon('redo')}<span>Retry preview</span></button>${sub.remarks?`<details class="teacher-review-feedback"><summary>Feedback</summary><p>${e(sub.remarks)}</p></details>`:''}</article>`;
  }

  M.teacherReviews=function(root,sets){
    const life=lifecycle(root);if(!life.active())return life;
    let observer=null,loading=false,inFlight=0;
    const previewQueue=[];
    root.innerHTML=`<section class="teacher-library-hero" aria-labelledby="teacher-review-page-title"><div class="teacher-library-intro"><p class="teacher-overline">STUDENT WORK</p><h1 id="teacher-review-page-title">Review <em>work.</em></h1><div class="teacher-review-totals"><div><strong id="teacher-review-pending-total">—</strong><span>to review</span></div><div><strong id="teacher-review-done-total">—</strong><span>reviewed</span></div></div></div>${folio('REVIEW DESK','pyramid','EG / REVIEW')}</section><div id="teacher-review-board-status" class="teacher-review-board-status" role="status" aria-live="polite" aria-busy="true" data-state="loading">Loading student work…</div><div id="teacher-review-board-body"></div>`;
    const status=M.$('#teacher-review-board-status',root),body=M.$('#teacher-review-board-body',root);
    const pump=()=>{
      while(life.active()&&inFlight<4&&previewQueue.length){
        const host=previewQueue.shift(),card=host.closest('.teacher-review-sheet');
        if(card.hidden){host.dataset.state='idle';continue;}
        inFlight++;host.dataset.state='loading';host.setAttribute('aria-busy','true');
        M.api('submissions/'+c(host.dataset.reviewPreview)).then(sub=>{
          if(!life.active()||!host.isConnected)return;
          if(!Array.isArray(sub.data?.entities))throw new Error('Preview unavailable.');
          host.innerHTML=sub.data?.entities?.length?M.thumbnail(sub.data):M.icon('drawing')+'<span>Empty drawing</span>';
          host.dataset.state='ready';
        }).catch(()=>{
          if(!life.active()||!host.isConnected)return;
          host.innerHTML=M.icon('drawing')+'<span>Preview unavailable</span>';host.dataset.state='error';
          M.$('.teacher-preview-retry',card).hidden=false;
        }).finally(()=>{inFlight--;if(life.active())host.setAttribute('aria-busy','false');pump();});
      }
    };
    function renderBoard(groups){
      const work=groups.flatMap(group=>group.submissions.map(sub=>({...sub,set:group.set}))).sort((a,b)=>Number(b.created_at)-Number(a.created_at)||Number(b.id)-Number(a.id));
      const pending=work.filter(sub=>!sub.verdict).length;
      M.$('#teacher-review-pending-total',root).textContent=pending;M.$('#teacher-review-done-total',root).textContent=work.length-pending;
      const usedSets=new Map(work.map(sub=>[String(sub.set.code),sub.set.title]));
      body.innerHTML=`<div class="teacher-library-toolbar">${searchField('teacher-review-search','Find student work','Find work by student, assignment or class')}<label class="teacher-library-class"><span class="studio-sr-only">Filter by assignment</span><select id="teacher-review-assignment" aria-label="Filter work by assignment"><option value="all">All assignments</option>${Array.from(usedSets,([code,title])=>`<option value="code:${e(code)}">${e(title)}</option>`).join('')}</select></label></div><div class="teacher-library-index"><div class="teacher-library-filters" role="group" aria-label="Submission filter"><button type="button" data-action="needs-review" aria-pressed="true">Needs review <span>${pending}</span></button><button type="button" data-action="all-work" aria-pressed="false">All work <span>${work.length}</span></button></div><span id="teacher-review-result-count" aria-live="polite" aria-atomic="true"></span></div><div class="teacher-review-board" id="review-queue">${work.map(reviewSheet).join('')}</div><div id="review-empty" class="teacher-library-empty" hidden>${M.teacherStudioEmptyArt('pyramid')}<h2></h2></div>`;
      const search=M.$('#teacher-review-search',root),select=M.$('#teacher-review-assignment',root),cards=M.$$('.teacher-review-sheet',root);
      let pendingOnly=true;
      observer=new IntersectionObserver(entries=>{
        entries.filter(entry=>entry.isIntersecting).forEach(({target})=>{
          observer.unobserve(target);
          if(!life.active()||target.closest('.teacher-review-sheet').hidden||target.dataset.state!=='idle')return;
          target.dataset.state='queued';previewQueue.push(target);
        });pump();
      },{rootMargin:'100px'});
      const filter=()=>{
        const query=search.value.trim().toLowerCase();let visible=0;
        work.forEach((sub,index)=>{
          const matches=(!pendingOnly||!sub.verdict)&&(select.value==='all'||select.value==='code:'+sub.set.code)&&[sub.name,sub.username,sub.set.title,sub.set.code,sub.set.class_title].join(' ').toLowerCase().includes(query);
          cards[index].hidden=!matches;if(matches)visible++;
          const host=M.$('[data-review-preview]',cards[index]);
          if(matches&&host.dataset.state==='idle')observer.observe(host);else if(!matches)observer.unobserve(host);
        });
        const empty=M.$('#review-empty',root);empty.hidden=visible>0;
        M.$('h2',empty).textContent=query||select.value!=='all'?'No work matches.':work.length?'All caught up.':'No work yet.';
        M.$('#teacher-review-result-count',root).textContent=countLabel(visible,'drawing');
        M.$('[data-action=needs-review]',root).setAttribute('aria-pressed',String(pendingOnly));M.$('[data-action=all-work]',root).setAttribute('aria-pressed',String(!pendingOnly));
      };
      life.listen(search,'input',filter);life.listen(select,'change',filter);
      life.listen(M.$('[data-action=needs-review]',root),'click',()=>{pendingOnly=true;filter();});life.listen(M.$('[data-action=all-work]',root),'click',()=>{pendingOnly=false;filter();});
      cards.forEach(card=>life.listen(M.$('.teacher-preview-retry',card),'click',event=>{
        event.currentTarget.hidden=true;const host=M.$('[data-review-preview]',card);host.dataset.state='idle';host.innerHTML=M.icon('drawing');host.setAttribute('aria-busy','true');observer.observe(host);
      }));
      filter();
    }
    async function load(){
      if(loading||!life.active())return;loading=true;status.dataset.state='loading';status.setAttribute('aria-busy','true');status.textContent='Loading student work…';
      try{const groups=await M.teacherReviewGroups(sets,life.active);if(groups&&life.active()){renderBoard(groups);status.dataset.state='ready';status.textContent='';}}
      catch(error){if(life.active()){status.dataset.state='error';status.innerHTML='<span>Review queue unavailable.</span><button type="button" class="teacher-link" id="teacher-review-board-retry">'+M.icon('redo')+'<span>Retry</span></button>';life.listen(M.$('#teacher-review-board-retry',root),'click',load);}}
      finally{loading=false;if(life.active())status.setAttribute('aria-busy','false');}
    }
    load();
    return {dispose:()=>{life.dispose();observer?.disconnect();previewQueue.length=0;}};
  };
})();

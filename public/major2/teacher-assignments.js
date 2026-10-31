(function(){
  'use strict';
  const M=window.Major2,e=M.escape;
  const searchIcon='<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg>';
  const classKey=set=>set.class_code?'code:'+set.class_code:set.class_title?'title:'+set.class_title:'open';

  M.teacherAssignments=function(root,sets){
    const abort=new AbortController(),token=M.session()?.token;
    const active=()=>root.isConnected&&!abort.signal.aborted&&M.session()?.token===token;
    if(!active())return {dispose:()=>abort.abort()};
    const questionCount=sets.reduce((total,set)=>total+Math.max(0,Math.floor(Number(set.nquestions)||0)),0);
    const classOptions=new Map();
    sets.forEach(set=>classOptions.set(classKey(set),set.class_title||set.class_code||'Open assignments'));
    root.innerHTML=`<section class="teacher-library-hero" aria-labelledby="teacher-library-title">
      <div class="teacher-library-intro"><p class="teacher-overline">ASSIGNMENTS</p><h1 id="teacher-library-title">Drawing <em>briefs.</em></h1><p class="teacher-library-total"><span>${sets.length} ${sets.length===1?'brief':'briefs'}</span><span>${questionCount} ${questionCount===1?'question':'questions'}</span></p><a class="teacher-link teacher-primary" href="#/assignments/new">${M.icon('plus')}<span>New assignment</span></a></div>
      <div class="teacher-library-folio" aria-hidden="true"><span></span><span></span><div class="teacher-folio-cover"><span class="teacher-folio-index">EG / ${String(sets.length).padStart(2,'0')}</span>${M.projectionThumbnail('step','iso')}<span class="teacher-folio-caption">DRAWING BRIEFS</span></div></div>
    </section>
    ${sets.length?`<section class="teacher-library" aria-label="Assignment library">
      <div class="teacher-library-toolbar"><label class="teacher-library-search">${searchIcon}<span class="studio-sr-only">Find an assignment</span><input id="teacher-assignment-search" type="search" placeholder="Find a brief" aria-label="Find an assignment by title, code or class" autocomplete="off"></label><label class="teacher-library-class"><span class="studio-sr-only">Filter by class</span><select id="teacher-assignment-class" aria-label="Filter assignments by class"><option value="all">All classes</option>${Array.from(classOptions,([key,label])=>`<option value="${e(key)}">${e(label)}</option>`).join('')}</select></label></div>
      <div class="teacher-library-index"><div class="teacher-library-filters" role="group" aria-label="Assignment filter"><button type="button" data-brief-filter="all" aria-pressed="true">All <span>${sets.length}</span></button><button type="button" data-brief-filter="pending" aria-pressed="false" disabled>Needs review <span id="teacher-brief-review-count"></span></button></div><span id="teacher-assignment-result-count" aria-live="polite" aria-atomic="true">${sets.length} ${sets.length===1?'brief':'briefs'}</span></div>
      <div class="teacher-library-review-status" id="teacher-library-review-status" role="status" aria-live="polite" aria-busy="true" data-state="loading">Loading reviews…</div>
      <div class="teacher-library-grid" id="teacher-assignment-library">${sets.map(M.assessmentBrief).join('')}</div>
      <div class="teacher-library-no-results" id="teacher-assignment-no-results" hidden><p>No briefs match.</p><button type="button" class="teacher-link" id="teacher-assignment-clear">${M.icon('redo')}<span>Clear filters</span></button></div>
    </section>`:`<section class="teacher-library-empty">${M.teacherStudioEmptyArt('step')}<h2>Your first brief.</h2><a class="teacher-link" href="#/assignments/new">${M.icon('plus')}<span>New assignment</span></a></section>`}`;
    const dispose=()=>abort.abort();
    if(!sets.length)return {dispose};
    const listen=(target,event,fn)=>target.addEventListener(event,fn,{signal:abort.signal});
    const search=M.$('#teacher-assignment-search',root),select=M.$('#teacher-assignment-class',root),cards=M.$$('.teacher-assessment',root);
    const status=M.$('#teacher-library-review-status',root),pendingButton=M.$('[data-brief-filter="pending"]',root);
    let filter='all',counts=new Map(),loading=false;
    function applyFilters(){
      const query=search.value.trim().toLowerCase(),selectedClass=select.value;
      let visible=0;
      sets.forEach((set,index)=>{
        const matches=(!query||[set.title,set.code,set.class_title].join(' ').toLowerCase().includes(query))&&(selectedClass==='all'||classKey(set)===selectedClass)&&(filter!=='pending'||counts.get(String(set.code))>0);
        cards[index].hidden=!matches;if(matches)visible++;
      });
      M.$('#teacher-assignment-result-count',root).textContent=visible===sets.length?visible+' '+(visible===1?'brief':'briefs'):visible+' of '+sets.length;
      M.$('#teacher-assignment-no-results',root).hidden=visible>0;
      M.$$('[data-brief-filter]',root).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.briefFilter===filter)));
    }
    listen(search,'input',applyFilters);listen(select,'change',applyFilters);
    M.$$('[data-brief-filter]',root).forEach(button=>listen(button,'click',()=>{if(button.disabled)return;filter=button.dataset.briefFilter;applyFilters();}));
    listen(M.$('#teacher-assignment-clear',root),'click',()=>{search.value='';select.value='all';filter='all';applyFilters();search.focus();});
    async function loadReviews(){
      if(loading||!active())return;
      loading=true;status.setAttribute('aria-busy','true');status.dataset.state='loading';status.textContent='Loading reviews…';
      try{
        const groups=await M.teacherReviewGroups(sets,active);
        if(!active()||!groups)return;
        counts=M.updateAssessmentReviews(root,groups);
        M.$('#teacher-brief-review-count',root).textContent=Array.from(counts.values()).filter(count=>count>0).length;
        pendingButton.disabled=false;status.dataset.state='ready';status.textContent='';
        applyFilters();
      }catch(error){
        if(!active())return;
        status.dataset.state='error';status.innerHTML='<span>Review status unavailable.</span><button type="button" id="teacher-assignment-retry" class="teacher-link">'+M.icon('redo')+'<span>Retry</span></button>';
        listen(M.$('#teacher-assignment-retry',root),'click',loadReviews);
      }finally{loading=false;if(active())status.setAttribute('aria-busy','false');}
    }
    loadReviews();
    return {dispose};
  };
})();

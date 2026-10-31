(function () {
  'use strict';
  const M = window.Major2;
  const mono = 'studio-svg-note';
  const views = {iso:'Isometric', front:'Front', top:'Top', side:'Side'};
  const cube = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 15 9v17L20 38 5 29V12Z M5 12l15 9 15-9 M20 21v17"/><path d="M20 3v18M5 29l15-8 15 8" stroke-dasharray="2 3" opacity=".4"/></svg>';
  const arrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6"/></svg>';

  // Every illustration is projected from the same mesh; changing the object
  // updates its three orthographic studies and the large selected view together.
  function extrude(profile, depth) {
    const vertices = [-depth/2,depth/2].flatMap(y => profile.map(([x,z]) => [x,y,z]));
    const n = profile.length;
    const faces = [Array.from({length:n},(_,i)=>i), Array.from({length:n},(_,i)=>2*n-1-i)];
    for (let i=0;i<n;i++) { const next=(i+1)%n; faces.push([i,i+n,next+n,next]); }
    return {vertices,faces};
  }
  const models = {
    step:{name:'Step block',size:'120 × 90 × 100 mm', mesh:extrude([[-60,0],[60,0],[60,45],[0,45],[0,100],[-60,100]],90)},
    prism:{name:'Hex prism',size:'120 across corners · 100 mm high',mesh:(()=>{
      const ring=Array.from({length:6},(_,i)=>[60*Math.cos(i*Math.PI/3),60*Math.sin(i*Math.PI/3)]);
      return {vertices:[0,100].flatMap(z=>ring.map(([x,y])=>[x,y,z])),faces:[[5,4,3,2,1,0],[6,7,8,9,10,11],...ring.map((_,i)=>[i,(i+1)%6,(i+1)%6+6,i+6])]};
    })()},
    pyramid:{name:'Pyramid',size:'120 × 90 mm base · 110 mm high',mesh:{vertices:[[-60,-45,0],[60,-45,0],[60,45,0],[-60,45,0],[0,0,110]],faces:[[3,2,1,0],[0,1,4],[1,2,4],[2,3,4],[3,0,4]]}}
  };
  const cameras = {iso:[1,1,.9],front:[0,1,0],top:[0,0,1],side:[1,0,0]};
  function normal(mesh, face) {
    const [a,b,c]=face.slice(0,3).map(i=>mesh.vertices[i]);
    const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
    return [u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  }
  const dot = (a,b) => a.reduce((sum,v,i)=>sum+v*b[i],0);
  function projected([x,y,z], view) {
    if(view==='front')return [x,50-z];
    if(view==='top')return [x,-y];
    if(view==='side')return [-y,50-z];
    return [(x-y)*.866,(x+y)*.43-(z-50)*.94];
  }
  function drawMesh(mesh, view, cx, cy, scale, className='') {
    const points=mesh.vertices.map(p=>projected(p,view).map((v,i)=>(i?cy:cx)+v*scale));
    const visible=mesh.faces.map(face=>dot(normal(mesh,face),cameras[view])>.001);
    const edges=new Map();
    mesh.faces.forEach((face,fi)=>face.forEach((a,i)=>{
      const b=face[(i+1)%face.length],key=[a,b].sort((a,b)=>a-b).join(':');
      const edge=edges.get(key)||{a,b,visible:false};edge.visible ||= visible[fi];edges.set(key,edge);
    }));
    const polygon = face=>face.map(i=>points[i].map(n=>n.toFixed(2)).join(',')).join(' ');
    const fills=mesh.faces.map((face,i)=>({face,i,depth:face.reduce((sum,vi)=>sum+dot(mesh.vertices[vi],cameras[view]),0)/face.length}))
      .filter(({i})=>visible[i]).sort((a,b)=>a.depth-b.depth).map(({face,i})=>{
        const n=normal(mesh,face),shade=n[2]>0?'top':n[0]>0?'side':'front';
        return `<polygon class="studio-face studio-face-${shade}" points="${polygon(face)}"/>`;
      }).join('');
    // Collapse coincident projected edges, prioritizing visible edges. This
    // keeps rear edges from overdrawing an orthographic silhouette with dashes.
    const projectedEdges=new Map();
    edges.forEach(edge=>{
      const a=points[edge.a].map(n=>n.toFixed(2)),b=points[edge.b].map(n=>n.toFixed(2));
      if(a.join(',')===b.join(','))return;
      const key=[a.join(','),b.join(',')].sort().join('|'),old=projectedEdges.get(key);
      if(!old||edge.visible)projectedEdges.set(key,{a,b,visible:edge.visible});
    });
    const lines=[...projectedEdges.values()].sort((a,b)=>Number(a.visible)-Number(b.visible)).map(({a,b,visible})=>
      `<path class="${visible?'studio-edge':'studio-hidden'}" d="M${a.join(',')}L${b.join(',')}"/>`).join('');
    return `<g class="studio-object ${className}">${fills}${lines}</g>`;
  }
  function registration(x,y) {
    return `<path class="studio-registration" d="M${x-7} ${y}h14M${x} ${y-7}v14"/><circle class="studio-registration" cx="${x}" cy="${y}" r="3"/>`;
  }
  function dimension(x1,x2,y,label) {
    return `<g class="studio-dimension"><path d="M${x1} ${y-9}v18M${x2} ${y-9}v18M${x1} ${y}h${x2-x1}m${x1-x2-4} 4 8-8m${x2-x1-8} 8 8-8"/><text class="${mono}" x="${(x1+x2)/2}" y="${y-7}" text-anchor="middle">${label}</text></g>`;
  }
  function sheet(modelKey, selected) {
    const model=models[modelKey],mesh=model.mesh;
    const study=(view,x,y)=>`<g class="studio-study ${selected===view?'is-selected':''}">${drawMesh(mesh,view,x,y,.65)}<text class="${mono}" x="${x}" y="${y+52}" text-anchor="middle">${views[view].toUpperCase()}</text></g>`;
    return `<svg class="studio-drawing" viewBox="0 0 720 438" role="img" aria-labelledby="studio-drawing-title studio-drawing-description">
      <title id="studio-drawing-title">${model.name}: ${views[selected].toLowerCase()} view and orthographic projections</title>
      <desc id="studio-drawing-description">One ${model.name.toLowerCase()} shown in ${views[selected].toLowerCase()} and first-angle projection. Its top view is below the front view. Its right-side view is to the left of the front view. Dashed lines indicate hidden edges. Dimensions are illustrative; the study is not to scale.</desc>
      <g class="studio-construction"><path d="M31 20v367M275 20v367M31 199h244M31 66h244M174 49v284M213 49v284M252 49v284"/><path d="M31 20h244M275 199l-83 83M192 282H31" stroke-dasharray="3 5"/></g>
      ${study('side',83,119)}${study('front',213,119)}${study('top',213,266)}
      <path class="studio-datum" d="M25 199h265"/><text class="${mono}" x="16" y="203">X</text><text class="${mono}" x="300" y="203">Y</text>
      ${dimension(174,252,343,'120 mm')}
      <g class="studio-projection-symbol" aria-hidden="true"><path d="M38 371v20l27-4v-12Z M38 381h27"/><circle cx="84" cy="381" r="10"/><circle cx="84" cy="381" r="5"/><path d="M71 381h26M84 368v26"/></g>
      <g class="studio-main-guides"><path d="M350 76H682M350 335H682M362 58v299M667 58v299"/>${registration(362,76)}${registration(667,335)}</g>
      <g class="studio-main-object" data-view="${selected}">${drawMesh(mesh,selected,512,200,selected==='iso'?1.94:2.14)}</g>
      <g class="studio-axis"><path d="M629 378h37M629 378v-35${selected==='iso'?'M629 378l-22 18':''}"/><text x="670" y="382">${selected==='side'?'y':'x'}</text><text x="626" y="337">${selected==='top'?'y':'z'}</text>${selected==='iso'?'<text x="596" y="404">y</text>':''}</g>
    </svg>`;
  }

  M.projectionStudy = (model='step',view='iso') => sheet(models[model]?model:'step',views[view]?view:'iso');
  M.projectionThumbnail = (model='step',view='iso') => `<svg viewBox="0 0 70 65" aria-hidden="true">${drawMesh((models[model]||models.step).mesh,views[view]?view:'iso',35,32,.3)}</svg>`;

  M.welcome = function (root) {
    let model='step',view='iso';
    root.innerHTML = `<div class="studio-shell">
      <div class="studio-paper" aria-hidden="true"></div>
      <header class="studio-header">
        <a class="studio-brand" href="#/welcome" aria-label="EduCAD home"><span class="studio-brand-mark">${cube}</span><strong>EduCAD</strong></a>
        <button type="button" class="studio-appearance" data-action="appearance" aria-label="Appearance" title="Appearance">${M.icon('palette')}</button>
      </header>
      <main class="studio-main" id="main-content" tabindex="-1">
        <section class="studio-hero" aria-labelledby="studio-title">
          <div class="studio-intro">
            <h1 id="studio-title">Explore<br> <em>every view.</em></h1>
            <a class="studio-start" href="#studio-entry"><span>Get started</span><span class="studio-down" aria-hidden="true">↓</span></a>
          </div>
          <div class="studio-explorer">
            <div class="studio-view-controls" role="group" aria-label="Viewing direction">${Object.entries(views).map(([key,label])=>`<button type="button" data-studio-view="${key}" aria-label="${label} view" aria-pressed="${key===view}"><svg viewBox="0 0 70 65" aria-hidden="true">${drawMesh(models[model].mesh,key,35,32,.3)}</svg><span>${key==='iso'?'3D':label}</span></button>`).join('')}</div>
            <figure class="studio-figure"><div id="studio-sheet">${sheet(model,view)}</div><figcaption>Not to scale</figcaption></figure>
            <div class="studio-model-controls" role="group" aria-label="Choose a solid">${Object.entries(models).map(([key,item])=>`<button type="button" data-studio-model="${key}" aria-label="${item.name}" title="${item.name}" aria-pressed="${key===model}"><svg viewBox="0 0 70 65" aria-hidden="true">${drawMesh(item.mesh,'iso',35,32,.32)}</svg></button>`).join('')}</div>
            <p class="studio-live-status" role="status" aria-live="polite" aria-atomic="true">Step block · Isometric view</p>
          </div>
        </section>
        <section class="studio-entry" id="studio-entry" aria-labelledby="studio-entry-title" tabindex="-1">
          <h2 id="studio-entry-title" class="studio-sr-only">Choose your workspace</h2>
          <div class="studio-workspaces">
            <a class="studio-workspace" href="#/login/student" aria-label="Student sign-in">${M.icon('learn')}<span>Student</span>${arrow}</a>
            <a class="studio-workspace" href="#/login/teacher" aria-label="Teacher sign-in">${M.icon('classes')}<span>Teacher</span>${arrow}</a>
            <button type="button" class="studio-workspace studio-workspace-guest" data-action="guest" aria-label="Continue as guest">${M.icon('drawing')}<span>Guest</span>${arrow}</button>
          </div>
        </section>
      </main>
      <footer class="studio-footer"><span>Guest work isn’t saved.</span><div><a href="#/login/academics" aria-label="Academics sign-in">Academics ${arrow}</a><a href="/major/">Original version ${arrow}</a></div></footer>
    </div>`;
    const abort=new AbortController();
    const listen=(el,event,fn)=>el.addEventListener(event,fn,{signal:abort.signal});
    const redraw=()=>{
      M.$('#studio-sheet',root).innerHTML=sheet(model,view);
      M.$$('[data-studio-view]',root).forEach(button=>{
        button.setAttribute('aria-pressed',String(button.dataset.studioView===view));
        M.$('svg',button).innerHTML=drawMesh(models[model].mesh,button.dataset.studioView,35,32,.3);
      });
      M.$$('[data-studio-model]',root).forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.studioModel===model)));
      M.$('.studio-live-status',root).textContent=models[model].name+' · '+views[view]+' view';
    };
    M.$$('[data-studio-view]',root).forEach(button=>listen(button,'click',()=>{view=button.dataset.studioView;redraw();}));
    M.$$('[data-studio-model]',root).forEach(button=>listen(button,'click',()=>{model=button.dataset.studioModel;redraw();}));
    listen(M.$('.studio-start',root),'click',event=>{
      event.preventDefault();const entry=M.$('#studio-entry',root);
      entry.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});
      entry.focus({preventScroll:true});
    });
    window.scrollTo(0,0);
    return {dispose:()=>abort.abort()};
  };
})();

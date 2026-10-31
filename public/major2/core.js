(function () {
  'use strict';
  const M = window.Major2 = {};
  M.$ = (selector, root = document) => root.querySelector(selector);
  M.$$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  M.escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  M.code = value => encodeURIComponent(String(value));
  M.read = (key, fallback = null) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  M.write = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; } };
  M.remove = key => { try { localStorage.removeItem(key); } catch (_) {} };
  M.session = () => { const s = M.read('educad_session'); return s && ['student','teacher','academics','guest'].includes(s.role) && typeof s.token === 'string' ? s : null; };
  M.teacher = () => ['teacher','academics'].includes(M.session()?.role);
  M.guest = () => M.session()?.role === 'guest';
  M.profileDetails = profile => profile?.source==='erp' ? '<dl>'+[['email','College ERP email'],['class','Class'],['division','Division'],['year','Year'],['roll_no','Roll number']].map(([key,label])=>'<dt>'+label+'</dt><dd>'+M.escape(profile[key] ?? 'Not provided by ERP')+'</dd>').join('')+'</dl>' : '';
  M.accountKey = () => (M.session()?.role || 'guest') + '_' + (M.session()?.username || 'guest');
  M.limitText = (value, bytes, label) => { const text=String(value).trim(); if(new TextEncoder().encode(text).length>bytes)throw new Error(label+' is too long. Use up to '+bytes+' bytes (English letters count as one each).'); return text; };
  M.go = path => { location.hash = '/' + path.replace(/^\//, ''); };
  M.date = seconds => Number.isFinite(Number(seconds)) ? new Date(Number(seconds) * 1000).toLocaleDateString(undefined, { day:'numeric', month:'short', year:'numeric' }) : '';
  const icons = {
    home:'M3 10l9-7 9 7M5 9v11h5v-6h4v6h5V9', classes:'M4 4h16v16H4zM4 9h16M9 4v16M15 4v16',
    drawing:'M4 20h16M6 16l2-6 8-8 4 4-8 8-6 2z', learn:'M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4zM12 6v15',
    review:'M7 3h10v4H7zM5 5H3v16h18V5h-2M7 14l3 3 7-7', arrow:'M4 12h16M14 6l6 6-6 6', back:'M20 12H4M10 6l-6 6 6 6',
    help:'M9 8a3 3 0 0 1 6 0c0 3-3 2-3 5M12 17h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
    palette:'M12 3a9 9 0 0 0 0 18c2 0 3-1 3-2 0-2-2-2-2-3s1-2 3-2h2c3 0 3-3 3-4a9 9 0 0 0-9-7M7 8h.01M12 6h.01M17 8h.01M6 13h.01',
    plus:'M12 5v14M5 12h14', point:'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', line:'M4 20 20 4M3 18h3v3H3zM18 3h3v3h-3z',
    circle:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', measure:'M4 7h16v10H4zM8 7v4M12 7v6M16 7v4',
    undo:'M8 5 3 10l5 5M3 10h10a7 7 0 0 1 7 7', redo:'M16 5l5 5-5 5M21 10H11a7 7 0 0 0-7 7',
    fit:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 12h8', select:'M5 3v17l5-5 4 6 3-2-4-6h7L5 3z',
    pan:'M7 12V5a2 2 0 0 1 4 0v6M11 5a2 2 0 0 1 4 0v6M15 7a2 2 0 0 1 4 0v8c0 5-2 7-6 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-2l1 1',
    save:'M4 3h13l4 4v14H3V3h1M7 3v6h10V3M7 21v-8h10v8', logout:'M9 4H3v16h6M9 12h12M16 7l5 5-5 5',
    model:'m12 2 10 5v10l-10 5-10-5V7l10-5zM2 7l10 5 10-5M12 12v10', check:'M5 12l4 4L19 6', trash:'M4 6h16M9 6V3h6v3M6 6v15h12V6M10 10v7M14 10v7', close:'M5 5l14 14M19 5 5 19'
  };
  M.icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.drawing}"/></svg>`;
  M.art = `<svg viewBox="0 0 180 150" aria-hidden="true"><path d="M40 43 64 28H112L136 43 112 58H64Z M40 43V103L64 124H112L136 103V43M64 58V124M112 58V124"/><path d="M40 103 64 88H112L136 103M64 28V88M112 28V88" stroke-dasharray="5 4"/></svg>`;
  M.brand = '<a class="brand" href="#/home"><span class="brand-mark">E</span><span>EduCAD<small>Learn. Draw. Understand.</small></span></a>';
  M.link = (label, path, kind = '', icon = '') => `<a class="button ${kind}" href="#/${path}">${icon ? M.icon(icon) : ''}${M.escape(label)}</a>`;
  M.button = (label, action, kind = '', icon = '') => `<button type="button" class="button ${kind}" data-action="${M.escape(action)}">${icon ? M.icon(icon) : ''}${M.escape(label)}</button>`;
  M.heading = (title, description = '', action = '') => `<div class="page-heading"><div><h1>${M.escape(title)}</h1><p>${M.escape(description)}</p></div>${action}</div>`;
  M.empty = (title, text, action = '', icon = 'drawing') => `<div class="empty">${M.icon(icon)}<h2>${M.escape(title)}</h2><p>${M.escape(text)}</p>${action}</div>`;
  M.field = (name, label, value = '', options = {}) => `<label class="field"><span>${M.escape(label)}</span>${options.textarea ? `<textarea name="${name}" ${options.required ? 'required' : ''} maxlength="${options.max || 8000}">${M.escape(value)}</textarea>` : `<input name="${name}" type="${options.type || 'text'}" value="${M.escape(value)}" ${options.required ? 'required' : ''} ${options.attrs || ''} maxlength="${options.max || 200}">`}${options.hint ? `<small>${M.escape(options.hint)}</small>` : ''}</label>`;
  M.status = sub => !sub ? '<span class="badge">Not submitted</span>' : `<span class="badge ${sub.verdict === 'pass' ? 'good' : sub.verdict === 'fail' ? 'bad' : ''}">${sub.verdict ? 'Teacher reviewed · ' + (sub.verdict === 'pass' ? 'Pass' : 'Needs work') : 'Submitted · awaiting review'}</span>`;
  M.autoStatus = sub => sub?.auto?.checked ? `<span class="badge ${sub.auto.pass ? 'good' : 'warning'}">Automatic check: ${sub.auto.pass ? 'Matched' : 'Not matched'}</span>` : '<span class="badge">Automatic check unavailable</span>';
  let toastTimer;
  M.toast = (text, error = false) => { const el = M.$('#toast'); clearTimeout(toastTimer); el.textContent = text; el.classList.toggle('error', error); el.hidden = false; toastTimer = setTimeout(() => { el.hidden = true; }, error ? 15000 : 7000); };
  M.errorText = err => ({ unauthorized:'Your sign-in has expired. Sign in again; your open drawing is kept on this device.', 'not found':'That item could not be found. Check the code or return to your home.', 'code taken':'That code is already in use. Choose another code.', 'bad code':'Use 3–24 letters, numbers, or dashes for the code.', 'not a member':'Join this class to open its assignments.', teacher_only:'This action is available to teachers.', interpret_unavailable:'Drawing generation is unavailable. You can draw a model or attach a saved drawing instead.' }[err.message] || err.message || 'Something went wrong. Your work is still here. Please retry.');
  M.api = async (path, method = 'GET', body) => {
    const session = M.session();
    if (session?.role === 'guest' && !['login','auth/config'].includes(path)) throw new Error('Sign in to use your classes and saved drawings.');
    const base = new URL(window.MAJOR2_CONFIG?.apiBase || 'api/', new URL('.', location.href));
    let response;
    try { response = await fetch(new URL(path, base), { method, headers: { 'Content-Type':'application/json', ...(session?.token && session.role !== 'guest' ? { Authorization:'Bearer ' + session.token } : {}) }, ...(body === undefined ? {} : { body:JSON.stringify(body) }) }); }
    catch (_) { throw new Error('We could not reach the server. Check your connection and retry. Your work is still here.'); }
    let data;
    try { data = await response.json(); } catch (_) { throw new Error('The app connection is not ready. Check the Major 2 API proxy and retry.'); }
    if (!response.ok || !data.ok) { const error = new Error(data.error || 'Request failed. Please retry.'); error.status = response.status; throw error; }
    if (path !== 'login' && session?.token !== M.session()?.token) throw new Error('Your account changed. Reopen this screen from your home.');
    return data;
  };
  M.busy = async (button, work) => { if (button?.disabled) return; const old = button?.textContent; if (button) { button.disabled = true; button.textContent = 'Please wait…'; } try { return await work(); } finally { if (button?.isConnected) { button.disabled = false; button.textContent = old; } } };
  M.bind = (root, action, fn) => M.$$(`[data-action="${action}"]`, root).forEach(el => el.addEventListener('click', () => Promise.resolve(fn(el)).catch(error => M.toast(M.errorText(error), true))));
  M.form = (form, work) => form.addEventListener('submit', event => {
    event.preventDefault(); const button = form.querySelector('[type=submit]'); const errorBox = form.querySelector('.form-error');
    if (errorBox) errorBox.hidden = true;
    M.busy(button, () => work(Object.fromEntries(new FormData(form)), form)).catch(error => { if (errorBox) { errorBox.textContent = M.errorText(error); errorBox.hidden = false; errorBox.focus(); } else M.toast(M.errorText(error), true); });
  });
  M.dialog = (title, text, fields = '', confirm = 'Continue', dangerous = false) => new Promise(resolve => {
    const dialog = document.createElement('dialog'); dialog.className = 'dialog';
    dialog.innerHTML = `<form><h2>${M.escape(title)}</h2><p>${M.escape(text)}</p>${fields}<div class="notice error form-error" tabindex="-1" hidden></div><div class="actions right"><button class="button" type="button" data-cancel>Cancel</button><button class="button ${dangerous ? 'danger' : 'primary'}" type="submit">${M.escape(confirm)}</button></div></form>`;
    M.$('#dialogs').append(dialog); let settled = false;
    const finish = value => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.addEventListener('close', () => finish(null));
    M.$('[data-cancel]', dialog).onclick = () => finish(null);
    M.$('form', dialog).onsubmit = event => { event.preventDefault(); finish(Object.fromEntries(new FormData(event.target))); };
    dialog.showModal();
  });
  M.help = () => {
    const dialog = document.createElement('dialog'); dialog.className = 'dialog';
    dialog.innerHTML = `<h2>${M.teacher()?'Studio guide.':'A little help, right here.'}</h2><p>${M.teacher()?'Choose a task.':'Choose what you are trying to do.'}</p><div class="help-articles">${(M.teacher()?[
      ['Create a class','Open Classes, choose New class, and share its code with students.'],
      ['Publish a brief','Open Assignments, choose New assignment, add your questions, and review before publishing.'],
      ['Add a model answer','Open a question and choose Draw model or Attach saved drawing. Model answers stay private. Drawing checks and 3D references have separate controls.'],
      ['Review student work','Open Review, choose a drawing sheet, then set your verdict and feedback. The submitted drawing stays unchanged.'],
      ['Draw with precision','Choose Point to place coordinates in millimetres. Choose Line to connect two points. Undo restores the previous step.'],
      ['Read the projections','Front view is above XY; top view is below it. Matching information in both views builds the 3D model.'],
      ['Save a drawing','Save drawing keeps your work in your account. A device draft is kept separately until you save.'],
      ['Use a phone or tablet','Read briefs, manage classes, review work, and move models. Drawing authoring uses a computer with a mouse or trackpad.']
    ]:[
      ['Join my class','Open My classes and choose Join a class. Enter the code your teacher gave you, then select Join class.'],
      ['Draw a line','Choose Line. Click the first point on the paper, then the second point. Existing points are selected automatically when you click close to them.'],
      ['Place a precise point','Choose Point and use Place by coordinates in the side panel. Values are in millimetres. Positive Y is above the XY line; negative Y is below it.'],
      ['Understand the views','The front view (VP) is above the XY line and the top view (HP) is below it for first-angle projection. The 3D view needs matching information in both views.'],
      ['Save or submit my drawing','Save keeps the drawing in your account. Submit sends a copy to your teacher for the current question. They are separate actions.'],
      ['Undo a mistake','Select Undo in the drawing toolbar. Redo brings back an action you undid. Cancel stops an unfinished line or circle.'],
      ['Use a phone or tablet','You can join classes, read assignments, inspect drawings, and move models. Open the drawing on a computer with a mouse or trackpad to create or edit it.'],
      ['Make a model answer','Publish your assignment first, then choose Draw model or Attach saved drawing for a question. Your model stays private; the 3D reference is controlled separately.']
    ]).map(([title, body]) => `<details><summary>${M.escape(title)}</summary><p>${M.escape(body)}</p></details>`).join('')}</div><div class="actions right"><button class="button primary" type="button">Got it</button></div>`;
    M.$('#dialogs').append(dialog); M.$('button', dialog).onclick = () => dialog.close(); dialog.onclose = () => dialog.remove(); dialog.showModal();
  };
  M.themes = {
    warm:{ name:'Warm Studio',detail:'Ivory + terracotta',bg:'#F6F2EA',surface:'#FFFFFF',soft:'#FBEDE7',text:'#252B32',muted:'#62675F',border:'#D7D5CD',primary:'#A8442E','on-primary':'#FFFFFF' },
    blueprint:{name:'Blueprint',detail:'Cool white + cobalt',bg:'#F3F6FB',surface:'#FFFFFF',soft:'#EAF0FF',text:'#202C42',muted:'#5D697D',border:'#D5DDE9',primary:'#2457C5','on-primary':'#FFFFFF'},
    forest:{name:'Forest Classroom',detail:'Sage + deep green',bg:'#F1F6F2',surface:'#FFFFFF',soft:'#E4F2E9',text:'#23382E',muted:'#5D6C63',border:'#CDDCD2',primary:'#1F6B52','on-primary':'#FFFFFF'},
    lilac:{name:'Soft Lilac',detail:'Lavender + violet',bg:'#F6F3FB',surface:'#FFFFFF',soft:'#EEE7FA',text:'#312741',muted:'#6D617B',border:'#DCD3E8',primary:'#6841BB','on-primary':'#FFFFFF'},
    midnight:{name:'Midnight Lab',detail:'Charcoal + lavender',bg:'#151923',surface:'#202633',soft:'#302B46',text:'#F5F5F7',muted:'#B2B8C7',border:'#434C60',primary:'#C1ABFF','on-primary':'#211B37'},
    sunlit:{name:'Sunlit Paper',detail:'Cream + ochre',bg:'#FFF8EB',surface:'#FFFFFF',soft:'#FAEFD4',text:'#382E1D',muted:'#756748',border:'#E1D5BC',primary:'#8F5708','on-primary':'#FFFFFF'}
  };
  M.applyTheme = key => { if (!M.themes[key]) key = 'warm'; const theme = M.themes[key]; Object.entries(theme).forEach(([token,value]) => { if (!['name','detail'].includes(token)) document.documentElement.style.setProperty('--' + token,value); }); document.documentElement.style.colorScheme = key === 'midnight' ? 'dark' : 'light'; document.documentElement.style.setProperty('--danger',key==='midnight'?'#FFAAA1':'#AE3030'); M.write('educad_major2_theme', key); document.querySelector('meta[name=theme-color]').content = theme.bg; };
  M.appearance = () => {
    const dialog = document.createElement('dialog'); dialog.className = 'dialog'; const selected = M.read('educad_major2_theme','warm');
    dialog.innerHTML = `<h2>${M.teacher()?'Studio palette.':'Make yourself comfortable.'}</h2><p>${M.teacher()?'Choose your paper and ink.':'Choose the colors you like. Your drawing paper stays clear and readable.'}</p><div class="theme-options">${Object.entries(M.themes).map(([key,theme]) => `<label class="theme-option-app"><input type="radio" name="appearance" value="${key}" ${selected === key ? 'checked' : ''}><span class="theme-dot" style="background:${theme.primary}"></span><span><strong>${theme.name}</strong><small>${theme.detail}</small></span></label>`).join('')}</div><div class="actions right"><button class="button primary" type="button">Done</button></div>`;
    M.$('#dialogs').append(dialog); M.$$('input',dialog).forEach(radio => { radio.onchange = () => M.applyTheme(radio.value); }); M.$('button',dialog).onclick = () => dialog.close(); dialog.onclose = () => dialog.remove(); dialog.showModal();
  };
  M.solid = (host, geometry, options = {}) => {
    const widget = EduCADSolid.mountSolidGlass(host, { w:host.clientWidth||240,h:host.clientHeight||190,drawOverlay:options.drawOverlay });
    if(options.fitToHost)widget.state.baseR=Math.min(widget.state.w,widget.state.h)*.25;
    if (geometry) EduCADSolid.setGeometry(widget, geometry);
    const input=new AbortController(),pointers=new Map();
    if(options.interactive){
      const canvas=widget.canvas,listen=(event,fn,extra={})=>canvas.addEventListener(event,fn,{...extra,signal:input.signal});
      widget.el.style.pointerEvents='auto';canvas.style.pointerEvents='auto';canvas.tabIndex=0;
      canvas.setAttribute('aria-label','3D model. Drag to orbit; scroll or pinch to zoom. Arrow keys orbit, plus and minus zoom, Home resets.');
      widget.resetView=()=>{EduCADSolid.resetView(widget.state);widget.state.cx=widget.state.w/2;widget.state.cy=widget.state.h/2;widget.draw();};
      const orbit=(dx,dy)=>{const {yaw,pitch}=widget.state;widget.orbitBy(dx,dy);if(widget.state.yaw!==yaw||widget.state.pitch!==pitch)options.onOrbit?.();};
      const pair=()=>{const [a,b]=[...pointers.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)};};
      listen('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();canvas.focus({preventScroll:true});pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});canvas.setPointerCapture(event.pointerId);canvas.dataset.orbiting='';});
      listen('pointermove',event=>{
        const previous=pointers.get(event.pointerId);if(!previous)return;event.preventDefault();event.stopPropagation();const before=pointers.size===2?pair():null;
        pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        if(before){const after=pair();if(before.distance>1){widget.draw();widget.zoomAt(after.x,after.y,after.distance/before.distance);}}
        else if(pointers.size===1)orbit(event.clientX-previous.x,event.clientY-previous.y);
      });
      const release=event=>{pointers.delete(event.pointerId);if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);if(!pointers.size)delete canvas.dataset.orbiting;};
      listen('pointerup',release);listen('pointercancel',release);listen('lostpointercapture',release);
      listen('wheel',event=>{event.preventDefault();event.stopPropagation();widget.draw();widget.zoomAt(event.clientX,event.clientY,Math.exp(-Math.max(-300,Math.min(300,event.deltaY))*0.002));},{passive:false});
      listen('dblclick',event=>{event.preventDefault();event.stopPropagation();widget.resetView();});
      listen('keydown',event=>{
        const keys=['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-','_','Home'];if(!keys.includes(event.key))return;event.preventDefault();event.stopPropagation();
        if(event.key==='Home')widget.resetView();
        else if(event.key.startsWith('Arrow')){const step=event.shiftKey?40:15;orbit(event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0);}
        else{const rect=canvas.getBoundingClientRect();widget.draw();widget.zoomAt(rect.left+rect.width/2,rect.top+rect.height/2,event.key==='-'||event.key==='_'?1/1.15:1.15);}
      });
    }
    const resize = new ResizeObserver(() => { if(host.clientWidth>0&&host.clientHeight>0){widget.resize(host.clientWidth,host.clientHeight);if(options.fitToHost)widget.state.baseR=Math.min(host.clientWidth,host.clientHeight)*.25;widget.state.cx=host.clientWidth/2;widget.state.cy=host.clientHeight/2;widget.draw();} });
    resize.observe(host); const dispose=widget.dispose.bind(widget);widget.dispose=()=>{input.abort();pointers.clear();resize.disconnect();dispose();};
    return widget;
  };
  M.thumbnail = data => {
    const entities = data?.entities || [];
    const extent = EduCADDrafting.extent(entities); if (!extent) return M.icon('drawing');
    const scale = Math.min(260 / Math.max(20,extent.x1-extent.x0),120 / Math.max(20,extent.y1-extent.y0));
    const project = (x,y) => ({x:150+(x-(extent.x0+extent.x1)/2)*scale,y:75-(y-(extent.y0+extent.y1)/2)*scale});
    let shapes = '';
    entities.filter(e => e.visible !== false).forEach(e => { const p=project(e.x,e.y),q=project(e.x2,e.y2); if(e.type==='POINT')shapes+=`<circle cx="${p.x}" cy="${p.y}" r="2.5" fill="#314858"/>`; else if(e.type==='CIRCLE')shapes+=`<circle cx="${p.x}" cy="${p.y}" r="${e.radius*scale}"/>`; else if(['SEGMENT','LINE','RAY','DATUM_AXIS','DIMENSION'].includes(e.type))shapes+=`<path d="M${p.x} ${p.y}L${q.x} ${q.y}" ${e.bisCode==='E'?'stroke-dasharray="4 3"':''}/>`; });
    return `<svg viewBox="0 0 300 150" role="img" aria-label="Saved drawing preview"><g fill="none" stroke="#314858" stroke-width="1.5">${shapes}</g></svg>`;
  };
  M.applyTheme(M.read('educad_major2_theme','warm'));
})();

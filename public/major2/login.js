(function () {
  'use strict';
  const M = window.Major2;
  const usernames = new Map();
  const roles = {student:'Student', teacher:'Teacher', academics:'Academics'};
  const demoPasswords = {student:'learn123', teacher:'teach123', academics:'admin123'};
  const eye = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/><path class="auth-eye-slash" d="m4 3 16 18"/></svg>';
  const logo = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 15 9v17L20 38 5 29V12Z M5 12l15 9 15-9 M20 21v17"/><path d="M20 3v18M5 29l15-8 15 8" stroke-dasharray="2 3" opacity=".4"/></svg>';
  const roleModels = {student:'step',teacher:'prism',academics:'pyramid'};

  M.login = function (root, requestedRole, config = {}) {
    const role = roles[requestedRole] ? requestedRole : 'student';
    const title = roles[role];
    const erp = role==='student' && config.student_auth !== 'demo';
    const demo = !erp;
    const accountHelp = role==='student' ? 'Use your college ERP email and password. Your name and class details are loaded from ERP. Reset your password through the college ERP if needed.' : role==='teacher' ? 'Ask your academic office for your account details.' : 'Ask your EduCAD administrator for your account details.';
    document.title = title+' sign-in · EduCAD';
    root.innerHTML = `<div class="auth-shell studio-shell">
      <div class="studio-paper" aria-hidden="true"></div>
      <header class="auth-header studio-header">
        <a class="auth-brand studio-brand" href="#/welcome" aria-label="EduCAD home"><span class="auth-brand-symbol studio-brand-mark">${logo}</span><strong>EduCAD</strong></a>
        <nav class="auth-header-actions" aria-label="Sign-in navigation"><a class="auth-back" href="#/welcome" aria-label="Back to welcome" title="Back to welcome">${M.icon('back')}</a><button type="button" class="auth-appearance studio-appearance" data-action="appearance" aria-label="Appearance" title="Appearance">${M.icon('palette')}</button></nav>
      </header>
      <main class="auth-stage" id="main-content" tabindex="-1">
        <section class="auth-access" aria-labelledby="auth-title">
          <h1 id="auth-title">Sign <em>in.</em></h1>
          <nav class="auth-roles" aria-label="Account type">${Object.entries(roles).map(([key,label])=>`<a href="#/login/${key}" ${key===role?'aria-current="page"':''} data-login-role="${key}" aria-label="${label} sign-in">${M.icon(key==='student'?'learn':key==='teacher'?'classes':'review')}<span>${label}</span></a>`).join('')}</nav>
          <form id="login-form" class="auth-form" novalidate aria-label="${title} sign-in">
            <div class="auth-field">
              <label for="auth-username">${erp?'College ERP email':'Username'}</label>
              <input id="auth-username" name="${erp?'email':'username'}" type="${erp?'email':'text'}" value="${M.escape(usernames.get(role)||'')}" required maxlength="${erp?254:64}" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" aria-describedby="auth-username-error">
              <p class="auth-field-error" id="auth-username-error" hidden></p>
            </div>
            <div class="auth-field">
              <label for="auth-password">${erp?'ERP password':'Password'}</label>
              <div class="auth-password-control"><input id="auth-password" name="password" type="password" required maxlength="1024" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" aria-describedby="auth-password-error auth-caps-lock"><button type="button" class="auth-show-password" data-action="show-password" aria-controls="auth-password" aria-label="Show password" aria-pressed="false">${eye}<span class="studio-sr-only">Show</span></button></div>
              <p class="auth-field-error" id="auth-password-error" hidden></p>
              <p class="auth-caps-lock" id="auth-caps-lock" role="status" hidden><span aria-hidden="true">⇧</span>Caps Lock is on</p>
            </div>
            <div class="auth-request-error form-error" id="auth-request-error" role="alert" tabindex="-1" hidden><strong>Sign-in unsuccessful</strong><p></p></div>
            <button class="auth-submit" type="submit"><span class="auth-submit-label">Sign in</span>${M.icon('arrow')}<span class="auth-spinner" aria-hidden="true" hidden></span></button>
            <p class="auth-submit-status" role="status" aria-live="polite" hidden>Signing in…</p>
          </form>
          <div class="auth-assistance">
            <details class="auth-help"><summary>Account help<span aria-hidden="true">+</span></summary><p>${accountHelp}</p></details>
            ${demo?`<details class="auth-demo"><summary>Demo<span aria-hidden="true">+</span></summary><div class="auth-demo-body"><dl><div><dt>Username</dt><dd>${role}</dd></div><div><dt>Password</dt><dd>${demoPasswords[role]}</dd></div></dl><button type="button" class="auth-demo-fill">Use demo ${M.icon('arrow')}</button></div></details>`:''}
          </div>
          <div class="auth-guest"><button type="button" class="auth-guest-button" aria-label="Continue as guest">${M.icon('drawing')}<span>Guest</span>${M.icon('arrow')}</button></div>
        </section>
        <figure class="auth-study">${M.projectionStudy(roleModels[role])}<figcaption>Not to scale</figcaption></figure>
      </main>
      <footer class="auth-footer studio-footer"><span>Guest work isn’t saved.</span><a href="/major/">Original version ${M.icon('arrow')}</a></footer>
    </div>`;
    window.scrollTo(0,0);

    const form=M.$('#login-form',root), username=M.$('#auth-username',root), password=M.$('#auth-password',root);
    const submit=M.$('.auth-submit',root), reveal=M.$('.auth-show-password',root), errorBox=M.$('#auth-request-error',root);
    const abort=new AbortController();
    let busy=false;
    const listen=(target,event,work)=>target?.addEventListener(event,work,{signal:abort.signal});
    const active=()=>form.isConnected&&!abort.signal.aborted;
    function fieldError(input,text) {
      const error=M.$('#'+input.id+'-error',root);
      input.setAttribute('aria-invalid',text?'true':'false');
      if(text)input.setAttribute('aria-errormessage',error.id);else input.removeAttribute('aria-errormessage');
      error.textContent=text;error.hidden=!text;
    }
    function clearErrors() {errorBox.hidden=true;fieldError(username,'');fieldError(password,'');}
    function requestError(text,credentials=false) {
      M.$('p',errorBox).textContent=text;errorBox.hidden=false;
      if(credentials){[username,password].forEach(input=>{input.setAttribute('aria-invalid','true');input.setAttribute('aria-errormessage',errorBox.id);});}
      errorBox.focus({preventScroll:true});errorBox.scrollIntoView({block:'nearest',behavior:'auto'});
    }
    function setBusy(value) {
      busy=value;form.setAttribute('aria-busy',String(value));submit.disabled=value;
      username.readOnly=value;password.readOnly=value;reveal.disabled=value;
      if(demo)M.$('.auth-demo-fill',root).disabled=value;M.$('.auth-guest-button',root).disabled=value;
      M.$$('[data-login-role]',root).forEach(link=>{if(value)link.setAttribute('aria-disabled','true');else link.removeAttribute('aria-disabled');});
      M.$('.auth-submit-label',submit).textContent=value?'Signing in…':'Sign in';
      M.$('.auth-spinner',submit).hidden=!value;M.$('.icon',submit).hidden=value;M.$('.auth-submit-status',root).hidden=!value;
    }
    listen(username,'input',()=>{usernames.set(role,username.value);clearErrors();});
    listen(password,'input',clearErrors);
    listen(reveal,'click',()=>{
      const show=password.type==='password';password.type=show?'text':'password';
      reveal.setAttribute('aria-pressed',String(show));reveal.setAttribute('aria-label',show?'Hide password':'Show password');
      M.$('span',reveal).textContent=show?'Hide':'Show';reveal.classList.toggle('is-visible',show);
    });
    function caps(event) {M.$('#auth-caps-lock',root).hidden=!event.getModifierState?.('CapsLock');}
    listen(password,'keydown',caps);listen(password,'keyup',caps);listen(password,'blur',()=>{M.$('#auth-caps-lock',root).hidden=true;});
    M.$$('[data-login-role]',root).forEach(link=>listen(link,'click',event=>{if(busy)event.preventDefault();else usernames.set(role,username.value);}));
    listen(M.$('.auth-demo-fill',root),'click',()=>{
      username.value=role;password.value=demoPasswords[role];usernames.set(role,role);clearErrors();
      password.type='password';reveal.classList.remove('is-visible');reveal.setAttribute('aria-pressed','false');reveal.setAttribute('aria-label','Show password');M.$('span',reveal).textContent='Show';
      M.$('#auth-caps-lock',root).hidden=true;M.$('.auth-demo',root).open=false;submit.focus({preventScroll:true});
    });
    listen(M.$('.auth-guest-button',root),'click',()=>{
      if(!M.write('educad_session',{role:'guest',name:'Guest',username:'guest',token:'guest'})){requestError('Allow browser storage to open a guest workspace, then try again.');return;}
      M.go('home');
    });
    listen(form,'submit',async event=>{
      event.preventDefault();if(busy)return;clearErrors();
      if(!username.value.trim())fieldError(username,erp?'Enter your college ERP email.':'Enter your username.');
      if(!password.value)fieldError(password,'Enter your password.');
      if(!username.value.trim()||!password.value){(!username.value.trim()?username:password).focus();return;}
      if(erp && (!username.validity.valid || (config.email_domains?.length && !config.email_domains.includes(username.value.trim().split('@')[1]?.toLowerCase())))){fieldError(username,'Use your college ERP email address.');username.focus();return;}
      const values={role,[erp?'email':'username']:username.value.trim(),password:password.value};
      usernames.set(role,username.value);setBusy(true);
      try {
        const result=await M.api('login','POST',values);if(!active())return;
        if(!M.write('educad_session',{role:result.role,username:result.username,name:result.name,token:result.token,profile:result.profile}))throw new Error('Allow browser storage to keep your sign-in, then try again.');
        password.value='';
        M.go('home');
      } catch(error) {
        if(!active())return;
        const invalid=error.status===401;
        const text=invalid&&erp?'Invalid college ERP email or password.':erp&&[400,502,503,429].includes(error.status)?error.message:invalid?'These details don’t match a '+title.toLowerCase()+' account. Check your username, password, and account type.':/reach the server|network|fetch|connection/i.test(error.message)?'Could not connect. Check your internet connection and try again.':/browser storage/.test(error.message)?error.message:'Sign-in is temporarily unavailable. Please try again.';
        requestError(text,invalid);
      } finally {if(active())setBusy(false);}
    });
    return {dispose:()=>abort.abort()};
  };
})();

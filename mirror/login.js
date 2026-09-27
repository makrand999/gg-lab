'use strict';
/* EduCAD minimal login: pick a role, POST /api/login, keep the session
   in localStorage. Guest skips the server entirely. */
(function () {
  var KEY = 'educad_session';
  var DEMO = {
    academics: { username: 'academics', password: 'admin123' },
    teacher: { username: 'teacher', password: 'teach123' },
    student: { username: 'student', password: 'learn123' }
  };
  var role = 'academics';

  function $(id) { return document.getElementById(id); }

  function load() {
    try { return JSON.parse(window.localStorage.getItem(KEY) || 'null'); }
    catch (err) { return null; }
  }
  function save(s) {
    try { window.localStorage.setItem(KEY, JSON.stringify(s)); return true; }
    catch (err) { return false; }
  }
  function goApp() { window.location.replace('index.html'); }

  if (load()) { goApp(); return; }

  var hint = $('demo-hint');
  var error = $('login-error');
  var form = $('login-form');
  var userInput = $('username');
  var passInput = $('password');
  var submitBtn = form ? form.querySelector('button[type="submit"]') : null;

  function showError(msg) {
    if (!error) return;
    if (!msg) { error.hidden = true; error.textContent = ''; return; }
    error.textContent = msg;
    error.hidden = false;
  }

  function renderHint() {
    if (!hint) return;
    var d = DEMO[role];
    hint.innerHTML = '';
    hint.appendChild(document.createTextNode('Demo ' + role + ' account: '));
    var c1 = document.createElement('code');
    c1.textContent = d.username;
    hint.appendChild(c1);
    hint.appendChild(document.createTextNode(' / '));
    var c2 = document.createElement('code');
    c2.textContent = d.password;
    hint.appendChild(c2);
  }

  var tabs = document.querySelectorAll('.cf-tabs button');
  Array.prototype.forEach.call(tabs, function (btn) {
    btn.addEventListener('click', function () {
      role = btn.getAttribute('data-role') || 'academics';
      Array.prototype.forEach.call(tabs, function (b) {
        if (b === btn) b.classList.add('active');
        else b.classList.remove('active');
      });
      showError(null);
      renderHint();
      if (userInput) userInput.focus();
    });
  });
  renderHint();

  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    showError(null);
    var username = userInput ? userInput.value : '';
    var password = passInput ? passInput.value : '';
    if (!String(username).trim() || !password) {
      showError('Enter username and password.');
      return;
    }
    if (submitBtn) submitBtn.disabled = true;
    // Relative path: resolves under a sub-path mount (/major/api/…)
    // as well as a root-mounted dev server (/api/…).
    window.fetch('api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: role, username: username, password: password })
    }).then(function (res) {
      return res.json().then(function (data) { return { res: res, data: data }; });
    }).then(function (out) {
      if (!out.res.ok || !out.data || !out.data.ok) {
        var msg = (out.data && out.data.error) || 'Login failed.';
        if (out.res.status === 401) msg = 'Invalid username or password.';
        showError(msg);
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      save({ role: out.data.role, username: out.data.username,
        name: out.data.name, token: out.data.token });
      goApp();
    }).catch(function () {
      showError('Server unreachable. Is `npm start` running?');
      if (submitBtn) submitBtn.disabled = false;
    });
  });

  var guest = $('guest-link');
  if (guest) guest.addEventListener('click', function (e) {
    e.preventDefault();
    save({ role: 'guest', username: 'guest', name: 'Guest', token: 'guest' });
    goApp();
  });
})();

'use strict';
/* EduCAD teacher studio: classes, class-scoped question sets, model
   answers, submission review with remarks and pass/fail. Codeforces-clean,
   link actions only. Teachers (and academics) land here after login; the
   drawing sheet opens in view mode to inspect a submission
   (index.html?submission=<id>). Model answers open as editable copies
   for review (index.html?model=<code>).
   Model drawings are never sent to students: the auto-check toggle only
   switches strict checking on or off, while a separate toggle serves the
   model's 3D preview as a drawing reference. */
(function () {
  var Saves = window.EduCADSaves;
  if (!Saves) return;

  function $(id) { return document.getElementById(id); }
  function fi() { return window.fetch.bind(window); }
  function session() { return Saves.currentSession(); }

  // Gate: teachers and academics only.
  var s0 = session();
  if (!s0 || Saves.isGuest(s0)) { window.location.replace('login.html'); return; }
  if (s0.role === 'student') { window.location.replace('student.html'); return; }
  if (s0.role !== 'teacher' && s0.role !== 'academics') {
    window.location.replace('login.html'); return;
  }

  var who = $('lab-who');
  if (who) who.textContent = s0.name + ' (' + s0.role + ')';
  var out = $('lab-logout');
  if (out) out.addEventListener('click', function (e) {
    e.preventDefault();
    try { window.localStorage.removeItem(Saves.SESSION_KEY); } catch (err) {}
    window.location.replace('login.html');
  });

  var flashEl = $('lab-flash');
  var root = $('lab-root');
  function flash(msg, kind) {
    if (!flashEl) return;
    flashEl.textContent = msg || '';
    flashEl.className = 'lab-flash ' + (kind === 'error' ? 'lab-error' :
      (kind === 'ok' ? 'lab-ok' : 'lab-muted'));
  }
  function apiError(err, what) {
    var msg = (err && err.message) || 'request failed';
    if (err && err.status === 401) {
      try { window.localStorage.removeItem(Saves.SESSION_KEY); } catch (e) {}
      window.location.replace('login.html');
      return;
    }
    // Without the app server there is no lab API at all.
    if (/failed to fetch|load failed/i.test(msg) || !(err && err.status)) {
      flash(what + ': ' + (/failed to fetch|load failed|request failed/i.test(msg) ? 'Could not reach the server. Your work is kept here; try again.' : msg), 'error');
      return;
    }
    var explanations = {
      'code taken': 'That code is already in use. Choose another code.',
      'no such class': 'That class is no longer available. Refresh and choose a class again.',
      'not your class': 'You do not have permission to post to that class.',
      'not your set': 'You do not have permission to change this set.',
      'bad code': 'Use a code with 3–24 letters, digits or dashes.',
      'not found': 'This item is no longer available. Refresh the studio.'
    };
    flash(what + ': ' + (explanations[msg] || msg), 'error');
  }
  function fmtDate(ts) {
    try { return new Date(ts * 1000).toLocaleString(); }
    catch (err) { return ''; }
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function disableControls(container) {
    var controls = Array.from(container.querySelectorAll('button, input, textarea, select'));
    var states = controls.map(function (control) { return control.disabled; });
    controls.forEach(function (control) { control.disabled = true; });
    container.setAttribute('aria-busy', 'true');
    return function () {
      controls.forEach(function (control, i) { control.disabled = states[i]; });
      container.removeAttribute('aria-busy');
      // A drawing lookup may finish while this form is busy. Restore its
      // current loading state instead of the state before the request.
      controls.forEach(function (control) {
        if (control.dataset.modelsReady !== undefined) {
          control.disabled = control.dataset.modelsReady !== 'true';
          control.dispatchEvent(new Event('modelsloaded'));
        }
      });
    };
  }
  function act(label, fn, cls) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lab-act' + (cls ? ' ' + cls : ''); b.textContent = label;
    b.addEventListener('click', function (event) {
      if (b.disabled) return;
      var pending;
      try { pending = fn(event); } catch (err) { apiError(err, 'Action failed'); return; }
      if (pending && typeof pending.then === 'function') {
        var unlock = disableControls(b.closest('.lab-row') || b.closest('.lab-form') || b.parentNode);
        Promise.resolve(pending).then(unlock, function (err) { unlock(); if (b.isConnected) apiError(err, 'Action failed'); });
      }
    });
    return b;
  }
  function link(label, href, cls) {
    var a = document.createElement('a');
    a.className = 'lab-act' + (cls ? ' ' + cls : '');
    a.textContent = label;
    a.href = href;
    return a;
  }
  function copyCode(code) {
    return act('Copy code', function () {
      if (!navigator.clipboard || !navigator.clipboard.writeText) { flash('Share this code: ' + code); return; }
      return navigator.clipboard.writeText(code).then(function () { flash('Copied ' + code + '.', 'ok'); }, function () { flash('Share this code: ' + code); });
    });
  }
  function h2(text) { return el('h2', text); }
  var fieldId = 0;
  function field(label, input) {
    var wrap = el('div', null, 'lab-field');
    if (label) {
      if (!input.id) input.id = 'lab-field-' + (++fieldId);
      var lbl = el('label', label, 'lab-lbl'); lbl.htmlFor = input.id; wrap.appendChild(lbl);
    }
    wrap.appendChild(input);
    return wrap;
  }
  function textInput(placeholder, value) {
    var i = document.createElement('input');
    i.type = 'text';
    i.placeholder = placeholder || '';
    i.value = value || '';
    return i;
  }
  function verdictLabel(v) {
    if (v === 'pass') return 'PASS';
    if (v === 'fail') return 'FAIL';
    return 'ungraded';
  }
  function autoLabel(a) {
    if (!a || !a.checked) return 'auto: off';
    return a.pass ? 'auto: PASS' : 'auto: FAIL';
  }
  // Bulk format: questions separated by a blank line. Within a block,
  // a line starting with "Hint:" (case-insensitive) becomes the hint.
  function parseBulk(text) {
    var out = [];
    var blocks = String(text || '').split(/\n\s*\n/);
    blocks.forEach(function (b) {
      var lines = b.split('\n').map(function (l) { return l.trim(); })
        .filter(function (l) { return l !== ''; });
      if (!lines.length) return;
      var prompt = [];
      var hint = '';
      lines.forEach(function (l) {
        var m = l.match(/^hint\s*:\s*(.*)$/i);
        if (m) hint = (hint ? hint + ' ' : '') + m[1].trim();
        else prompt.push(l);
      });
      var p = prompt.join(' ').trim();
      if (!p) throw new Error('Each question block needs a prompt before its Hint: line.');
      var q = { prompt: p };
      if (hint) q.hint = hint;
      out.push(q);
    });
    return out;
  }
  // Derive the student-visible 3D preview from model-ink rows. Null
  // when the libs are unavailable — the question is stored without one.
  function buildModelPreview(entities) {
    try {
      if (!window.EduCADRef3d) return null;
      return window.EduCADRef3d.buildPreview(entities,
        window.EduCADReconstruct);
    } catch (err) {
      return null;
    }
  }

  // Cached drawing list for "model from drawing" selects.
  var drawingCache = null;
  var drawingRequest = null;
  function loadDrawings() {
    if (drawingCache) return Promise.resolve(drawingCache);
    if (drawingRequest) return drawingRequest;
    drawingRequest = Saves.listDrawings(fi(), session()).then(function (data) {
      drawingCache = data.drawings || [];
      drawingRequest = null; return drawingCache;
    }, function (err) { drawingRequest = null; throw err; });
    return drawingRequest;
  }
  function modelSelect(selectedId) {
    var sel = document.createElement('select');
    var none = document.createElement('option');
    none.value = '';
    none.textContent = 'No model answer';
    sel.appendChild(none);
    sel.setAttribute('aria-label', 'Saved drawing for model answer');
    sel.dataset.modelsReady = drawingCache ? 'true' : 'false';
    function fill(items) {
      items.forEach(function (d) {
        var o = document.createElement('option');
        o.value = String(d.id);
        o.textContent = 'Model: ' + (d.title || 'Untitled') +
          ' (#' + d.id + ')';
        if (selectedId && String(d.id) === String(selectedId)) o.selected = true;
        sel.appendChild(o);
      });
      if (selectedId && !items.some(function (d) { return String(d.id) === String(selectedId); })) {
        var missing = el('option', 'Drawing #' + selectedId + ' — unavailable'); missing.value = String(selectedId); sel.appendChild(missing); sel.value = String(selectedId);
      }
    }
    if (drawingCache) fill(drawingCache);
    else {
      var loading = document.createElement('option');
      loading.value = '';
      loading.textContent = 'Loading drawings…';
      sel.appendChild(loading); sel.disabled = true;
      loadDrawings().then(function (items) {
        sel.removeChild(loading);
        fill(items);
        if (selectedId) {
          sel.value = String(selectedId);
          if (!sel.value) { var missing = el('option', 'Drawing #' + selectedId + ' — unavailable'); missing.value = String(selectedId); sel.appendChild(missing); sel.value = String(selectedId); }
        }
        sel.dataset.modelsReady = 'true';
        sel.disabled = !!sel.closest('[aria-busy="true"]'); sel.dispatchEvent(new Event('modelsloaded'));
      }, function () {
        loading.textContent = 'Drawings unavailable — Refresh to retry';
        if (selectedId) {
          var missing = el('option', 'Drawing #' + selectedId + ' — unavailable');
          missing.value = String(selectedId); sel.appendChild(missing); sel.value = String(selectedId);
        }
        sel.dataset.modelsReady = 'true';
        sel.disabled = !!sel.closest('[aria-busy="true"]'); sel.dispatchEvent(new Event('modelsloaded'));
      });
    }
    return sel;
  }

  function setRow(it, onOpen) {
    var row = el('div', null, 'lab-row');
    var title = el('div', null, 'lab-title');
    var open = link(it.code + ' — ' + (it.title || 'Untitled'), '#set/' + it.code);
    open.addEventListener('click', function (e) {
      if (onOpen) { e.preventDefault(); onOpen(it.code); }
    });
    title.appendChild(open);
    if (it.class_code) title.appendChild(el('span', it.class_code, 'lab-tag'));
    else title.appendChild(el('span', 'open', 'lab-tag'));
    row.appendChild(title);
    row.appendChild(el('div',
      it.nquestions + ' question(s) · ' + fmtDate(it.created_at), 'lab-meta'));
    return row;
  }

  // Drafts survive navigation and reloads in this tab, scoped to the teacher.
  var draftKey = 'educad_teacher_draft_v1:' + s0.role + ':' + s0.username;
  var draftState = { questions: [], code: '', title: '', classCode: '', prompt: '', hint: '', bulk: '', modelId: '', check: true, show3d: true, editIndex: -1 };
  try {
    var restored = JSON.parse(window.sessionStorage.getItem(draftKey));
    if (restored && Array.isArray(restored.questions)) {
      Object.keys(draftState).forEach(function (k) {
        if (typeof restored[k] === typeof draftState[k]) draftState[k] = restored[k];
      });
    }
  } catch (err) {}
  var draft = draftState.questions;
  var presetClass = '';
  var draftPosting = false;
  function keepDraft() {
    draftState.questions = draft;
    try { window.sessionStorage.setItem(draftKey, JSON.stringify(draftState)); } catch (err) {}
  }
  function validCode(code) { return /^[A-Za-z0-9-]{3,24}$/.test(code); }
  function bytes(text) { return new TextEncoder().encode(text).length; }
  function questionsError(qs, existing) {
    if (!qs.length) return 'Add at least one question first.';
    if (qs.length + (existing || 0) > 50) return 'A set can contain at most 50 questions.';
    for (var i = 0; i < qs.length; i++) {
      if (!qs[i].prompt || bytes(qs[i].prompt) > 2000) return 'Q' + (i + 1) + ': use a nonempty prompt of at most 2,000 bytes.';
      if (bytes(qs[i].hint || '') > 500) return 'Q' + (i + 1) + ': shorten the hint to at most 500 bytes.';
    }
    return '';
  }

  function renderHome() {
    drawingCache = null;
    clear(root);
    flash('');
    var s = session();
    if (!s) { window.location.replace('login.html'); return; }
    var jumps = el('div', null, 'lab-acts lab-jumps');
    [['My classes', 'sec-classes'], ['My sets', 'sec-sets'], ['New class', 'sec-newclass'], ['New question set', 'sec-newset']].forEach(function (item) {
      jumps.appendChild(act(item[0], function () { $(item[1]).scrollIntoView({ block: 'start' }); }));
    });
    root.appendChild(jumps);

    var classHeading = h2('My classes'); classHeading.id = 'sec-classes'; root.appendChild(classHeading);
    var clsBox = el('div', 'Loading classes…', 'lab-muted'); root.appendChild(clsBox);
    Saves.listClasses(fi(), s).then(function (data) {
      if (!clsBox.isConnected) return;
      clear(clsBox); clsBox.className = 'lab-list';
      var items = data.classes || [];
      if (!items.length) clsBox.appendChild(el('p', 'No classes yet. Create one below and share its code.', 'lab-muted'));
      items.forEach(function (it) {
        var row = el('div', null, 'lab-row');
        var title = el('div', null, 'lab-title');
        title.appendChild(link(it.code + ' — ' + (it.title || 'Untitled'), '#class/' + it.code)); row.appendChild(title);
        row.appendChild(el('div', it.nmembers + ' member(s) · ' + it.nsets + ' set(s) · ' + fmtDate(it.created_at), 'lab-meta'));
        var acts = el('div', null, 'lab-acts');
        acts.appendChild(link('Open', '#class/' + it.code));
        acts.appendChild(link('Post a set here', '#newset:' + it.code));
        acts.appendChild(act('Delete', function () {
          if (!window.confirm('Delete class "' + it.code + '"? Its sets become open sets; memberships are dropped.')) return;
          return Saves.deleteClass(fi(), session(), it.code).then(function () {
            if (!row.isConnected) return;
            renderHome(); flash('Class ' + it.code + ' deleted.', 'ok');
          }, function (err) { if (row.isConnected) apiError(err, 'Delete failed'); });
        }, 'lab-danger'));
        row.appendChild(acts); clsBox.appendChild(row);
      });
    }, function (err) {
      if (!clsBox.isConnected) return;
      clsBox.textContent = 'Classes could not be loaded. Use Refresh to try again.'; apiError(err, 'Classes failed to load');
    });

    var setHeading = h2('My sets'); setHeading.id = 'sec-sets'; root.appendChild(setHeading);
    var setBox = el('div', 'Loading sets…', 'lab-muted'); root.appendChild(setBox);
    Saves.listSets(fi(), s).then(function (data) {
      if (!setBox.isConnected) return;
      clear(setBox); setBox.className = 'lab-list';
      var items = data.sets || [];
      if (!items.length) setBox.appendChild(el('p', 'No sets yet. Add questions below to post your first set.', 'lab-muted'));
      items.forEach(function (it) {
        var row = setRow(it); var acts = el('div', null, 'lab-acts');
        acts.appendChild(link('Open', '#set/' + it.code));
        acts.appendChild(act('Delete', function () {
          if (!window.confirm('Delete set "' + it.code + '" and all its submissions?')) return;
          return Saves.deleteSet(fi(), session(), it.code).then(function () {
            if (!row.isConnected) return;
            renderHome(); flash('Set ' + it.code + ' deleted.', 'ok');
          }, function (err) { if (row.isConnected) apiError(err, 'Delete failed'); });
        }, 'lab-danger'));
        row.appendChild(acts); setBox.appendChild(row);
      });
    }, function (err) {
      if (!setBox.isConnected) return;
      setBox.textContent = 'Sets could not be loaded. Use Refresh to try again.'; apiError(err, 'Sets failed to load');
    });
    root.appendChild(act('Refresh classes and sets', function () { drawingCache = null; renderHome(); }));

    var newClassHeading = h2('New class'); newClassHeading.id = 'sec-newclass'; root.appendChild(newClassHeading);
    var form = el('div', null, 'lab-form');
    var codeIn = textInput('Class code, e.g. be-a-2026'); var titleIn = textInput('Title, e.g. BE-A Engineering Graphics');
    form.appendChild(field('Code', codeIn)); form.appendChild(field('Title', titleIn));
    var submit = el('div', null, 'lab-submit');
    submit.appendChild(act('Create class', function () {
      var code = codeIn.value.trim(); var title = titleIn.value.trim() || 'Untitled class';
      if (!validCode(code)) { flash('Class code must be 3–24 letters, digits or dashes.', 'error'); codeIn.focus(); return; }
      if (bytes(title) > 200) { flash('Shorten the class title to at most 200 bytes.', 'error'); titleIn.focus(); return; }
      return Saves.createClass(fi(), session(), code, title).then(function (data) {
        if (!form.isConnected) return;
        renderHome(); flash('Class ' + data.code + ' created. Share the code with students.', 'ok');
      }, function (err) { if (form.isConnected) apiError(err, 'Create failed'); });
    }, 'lab-primary'));
    form.appendChild(submit);
    form.appendChild(el('p', 'Codes are 3–24 letters, digits and dashes. Students join with the code; only you see the member list.', 'lab-hint'));
    root.appendChild(form);

    var secSet = h2('New question set'); secSet.id = 'sec-newset'; root.appendChild(secSet);
    var sform = el('div', null, 'lab-form'); root.appendChild(sform);
    var draftNote = el('p', 'Draft kept in this tab while you work. Up to 50 questions per set.', 'lab-hint'); sform.appendChild(draftNote);
    var scode = textInput('Set code, e.g. proj-01', draftState.code);
    var stitle = textInput('Title, e.g. Projections 1', draftState.title);
    var sclass = document.createElement('select'); sclass.disabled = true;
    sclass.appendChild(el('option', 'Loading classes…'));
    sform.appendChild(field('Code', scode)); sform.appendChild(field('Title', stitle)); sform.appendChild(field('Class', sclass));
    var classesReady = false;
    var chosenClass = presetClass || draftState.classCode;
    if (presetClass) { draftState.classCode = presetClass; keepDraft(); }
    Saves.listClasses(fi(), s).then(function (data) {
      if (!sform.isConnected) return;
      clear(sclass);
      var open = el('option', 'Open set (any student with the code)'); open.value = ''; sclass.appendChild(open);
      (data.classes || []).forEach(function (it) {
        var o = el('option', it.code + ' — ' + (it.title || 'Untitled')); o.value = it.code; sclass.appendChild(o);
      });
      if (chosenClass && !Array.from(sclass.options).some(function (o) { return o.value === chosenClass; })) {
        var missing = el('option', chosenClass + ' — unavailable; choose a class'); missing.value = chosenClass; missing.disabled = true; sclass.appendChild(missing);
        flash('The draft’s class is unavailable. Choose another class or explicitly choose an open set.', 'error');
      }
      sclass.value = chosenClass;
      classesReady = true; sclass.disabled = draftPosting;
    }, function (err) {
      if (!sform.isConnected) return;
      clear(sclass); sclass.appendChild(el('option', 'Classes unavailable — use Refresh to retry'));
      apiError(err, 'Class selection failed to load');
    });
    var draftBox = el('div'); sform.appendChild(draftBox);
    var editing = draftState.editIndex >= 0 && draftState.editIndex < draft.length ? draftState.editIndex : -1;
    var promptIn = document.createElement('textarea'); promptIn.rows = 2; promptIn.value = draftState.prompt;
    promptIn.placeholder = 'Question prompt, e.g. Draw the front and top views of a 40mm cube.';
    var hintIn = textInput('Hint (optional)', draftState.hint);
    var modelIn = modelSelect(draftState.modelId);
    var checkBox = document.createElement('input'); checkBox.type = 'checkbox'; checkBox.checked = draftState.check; checkBox.id = 'lab-check-new';
    var showBox = document.createElement('input'); showBox.type = 'checkbox'; showBox.checked = draftState.show3d; showBox.id = 'lab-show3d-new';
    function toggleField(box, text) {
      var wrap = el('div', null, 'lab-field'); var label = el('label', text); label.htmlFor = box.id;
      wrap.appendChild(box); wrap.appendChild(label); return wrap;
    }
    sform.appendChild(field('Prompt', promptIn)); sform.appendChild(field('Hint', hintIn)); sform.appendChild(field('Model', modelIn));
    sform.appendChild(toggleField(checkBox, ' Auto-check against the selected model (strict)'));
    sform.appendChild(toggleField(showBox, ' Show 3D preview to students, when available'));
    function modelFlags() { checkBox.disabled = showBox.disabled = !modelIn.value || draftPosting; }
    modelIn.addEventListener('change', modelFlags); modelIn.addEventListener('modelsloaded', modelFlags); modelFlags();
    function capture() {
      draftState.code = scode.value; draftState.title = stitle.value;
      if (classesReady) draftState.classCode = sclass.value;
      // Keep pending edits separately; posting requires explicit Save changes.
      draftState.editIndex = editing;
      draftState.prompt = promptIn.value; draftState.hint = hintIn.value;
      if (!modelIn.disabled) draftState.modelId = modelIn.value;
      draftState.check = checkBox.checked; draftState.show3d = showBox.checked;
      draftState.bulk = bulkIn.value; keepDraft();
    }
    sform.addEventListener('input', capture); sform.addEventListener('change', capture);
    function resetEditor() {
      editing = -1; promptIn.value = ''; hintIn.value = ''; modelIn.value = '';
      checkBox.checked = showBox.checked = true; addButton.textContent = 'Add question'; cancelEdit.hidden = true; modelFlags(); capture();
    }
    function renderDraft() {
      clear(draftBox);
      draftNote.textContent = 'Draft kept in this tab · ' + draft.length + '/50 questions.';
      draft.forEach(function (q, i) {
        var row = el('div', null, 'lab-row'); row.appendChild(el('div', 'Q' + (i + 1) + ': ' + q.prompt, 'lab-title'));
        if (q.hint) row.appendChild(el('div', 'Hint: ' + q.hint, 'lab-meta'));
        row.appendChild(el('div', q.modelDrawingId ? 'Model: ' + (q.modelTitle || 'drawing #' + q.modelDrawingId) + ' · auto-check ' + (q.check_enabled === false ? 'off' : 'on') : 'No model answer', 'lab-meta'));
        var acts = el('div', null, 'lab-acts');
        acts.appendChild(act('Edit', function () {
          if (editing >= 0 && editing !== i) { flash('Save or cancel the current question edit first.', 'error'); return; }
          if (editing < 0 && (promptIn.value.trim() || hintIn.value.trim())) { flash('Add the pending question before editing another one.', 'error'); return; }
          editing = i; promptIn.value = q.prompt; hintIn.value = q.hint || ''; modelIn.value = q.modelDrawingId || '';
          if (q.modelDrawingId && !modelIn.value) {
            var unavailable = el('option', 'Drawing #' + q.modelDrawingId + ' — unavailable'); unavailable.value = q.modelDrawingId; modelIn.appendChild(unavailable); modelIn.value = q.modelDrawingId;
          }
          checkBox.checked = q.check_enabled !== false; showBox.checked = q.show_3d !== false;
          addButton.textContent = 'Save question changes'; cancelEdit.hidden = false; modelFlags(); capture(); promptIn.focus();
        }));
        if (i > 0) acts.appendChild(act('Move up', function () {
          if (editing >= 0) { flash('Save or cancel the question edit before reordering.', 'error'); return; }
          var prev = draft[i - 1]; draft[i - 1] = draft[i]; draft[i] = prev; keepDraft(); renderDraft();
        }));
        acts.appendChild(act('Remove', function () {
          if (editing >= 0) { flash('Save or cancel the question edit before removing a question.', 'error'); return; }
          draft.splice(i, 1); keepDraft(); renderDraft();
        }, 'lab-danger'));
        row.appendChild(acts); draftBox.appendChild(row);
      });
      if (draftPosting) disableControls(sform);
    }
    var srow = el('div', null, 'lab-submit');
    var addButton = act('Add question', function () {
      var q = { prompt: promptIn.value.trim() }; if (hintIn.value.trim()) q.hint = hintIn.value.trim();
      var error = questionsError([q], editing < 0 ? draft.length : 0);
      if (error) { flash(error, 'error'); promptIn.focus(); return; }
      if (modelIn.value) {
        q.modelDrawingId = modelIn.value; var opt = modelIn.options[modelIn.selectedIndex]; q.modelTitle = opt ? opt.textContent.replace(/^Model:\s*/, '') : '';
        q.check_enabled = checkBox.checked; q.show_3d = showBox.checked;
      }
      if (editing >= 0) draft[editing] = q; else draft.push(q);
      resetEditor(); renderDraft(); flash(''); promptIn.focus();
    });
    var cancelEdit = act('Cancel edit', function () { resetEditor(); }); cancelEdit.hidden = editing < 0;
    if (editing >= 0) addButton.textContent = 'Save question changes';
    srow.appendChild(addButton); srow.appendChild(cancelEdit); sform.appendChild(srow);
    var bulkIn = document.createElement('textarea'); bulkIn.rows = 4; bulkIn.value = draftState.bulk;
    bulkIn.placeholder = 'One question per block, with a blank line between. Optional Hint: line.';
    sform.appendChild(field('Bulk', bulkIn));
    var brow = el('div', null, 'lab-submit');
    function addMany(qs, message) {
      var error = questionsError(qs, draft.length);
      if (error) { flash(error, 'error'); return false; }
      draft = draft.concat(qs); keepDraft(); renderDraft(); flash(message, 'ok'); return true;
    }
    brow.appendChild(act('Add all from text', function () {
      var qs;
      try { qs = parseBulk(bulkIn.value); } catch (err) { flash(err.message, 'error'); return; }
      if (addMany(qs, qs.length + ' questions added without models. Attach a model to each question as needed.')) { bulkIn.value = ''; capture(); }
    }));
    var fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = '.txt,.json,text/plain,application/json'; fileIn.hidden = true;
    var uploadPending = false;
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0]; fileIn.value = ''; if (!f) return;
      if (f.size > 1024 * 1024) { flash('Use a TXT or JSON file smaller than 1 MB.', 'error'); return; }
      if (!/\.(txt|json)$/i.test(f.name)) { flash('Upload a TXT or JSON file.', 'error'); return; }
      var rd = new FileReader(); uploadPending = true;
      rd.onerror = function () { uploadPending = false; if (sform.isConnected) flash('The file could not be read. Try uploading it again.', 'error'); };
      rd.onload = function () {
        uploadPending = false; if (!sform.isConnected || draftPosting) return;
        try {
          var text = String(rd.result || ''); var qs;
          if (/\.json$/i.test(f.name)) {
            var parsed = JSON.parse(text); var arr = Array.isArray(parsed) ? parsed : parsed && parsed.questions;
            if (!Array.isArray(arr)) throw new Error('JSON must contain an array of questions.');
            qs = arr.map(function (q) {
              if (typeof q === 'string') return { prompt: q.trim() };
              if (!q || typeof q.prompt !== 'string' || (q.hint !== undefined && typeof q.hint !== 'string')) throw new Error('Each question must contain a prompt and an optional text hint.');
              return { prompt: q.prompt.trim(), hint: (q.hint || '').trim() };
            });
          } else qs = parseBulk(text);
          addMany(qs, qs.length + ' questions uploaded from ' + f.name + '.');
        } catch (err) { flash('Upload failed: ' + err.message, 'error'); }
      };
      rd.readAsText(f);
    });
    brow.appendChild(act('Upload TXT or JSON…', function () { if (!uploadPending) fileIn.click(); })); brow.appendChild(fileIn); sform.appendChild(brow);
    var srow2 = el('div', null, 'lab-submit');
    srow2.appendChild(act('Create set', function () {
      if (draftPosting) return;
      if (!classesReady || (sclass.selectedOptions[0] && sclass.selectedOptions[0].disabled)) { flash('Choose an available class, or Refresh if classes could not load.', 'error'); return; }
      if (editing >= 0 || promptIn.value.trim() || hintIn.value.trim() || bulkIn.value.trim() || uploadPending) {
        flash('Add the pending question or bulk text, or finish the current edit before posting.', 'error'); promptIn.focus(); return;
      }
      var code = scode.value.trim(); var title = stitle.value.trim() || 'Untitled set';
      if (!validCode(code)) { flash('Set code must be 3–24 letters, digits or dashes.', 'error'); scode.focus(); return; }
      if (bytes(title) > 200) { flash('Shorten the set title to at most 200 bytes.', 'error'); stitle.focus(); return; }
      var error = questionsError(draft); if (error) { flash(error, 'error'); return; }
      capture(); var postedClass = sclass.value; draftPosting = true;
      flash('Posting set…');
      var drawings = Object.create(null);
      var jobs = draft.map(function (q) {
        var nq = { prompt: q.prompt }; if (q.hint) nq.hint = q.hint;
        if (!q.modelDrawingId) return Promise.resolve(nq);
        if (!drawings[q.modelDrawingId]) drawings[q.modelDrawingId] = Saves.getDrawing(fi(), session(), q.modelDrawingId);
        return drawings[q.modelDrawingId].then(function (d) {
          if (!d.data || !Array.isArray(d.data.entities) || !d.data.entities.length) throw new Error('The model drawing is empty. Choose another drawing.');
          nq.model = d.data; nq.check_enabled = q.check_enabled !== false; nq.show_3d = q.show_3d !== false;
          var pv = buildModelPreview(d.data.entities); if (pv) nq.model3d = pv; return nq;
        });
      });
      return Promise.all(jobs).then(function (questions) {
        return Saves.createSet(fi(), s, code, title, questions, postedClass || undefined);
      }).then(function (data) {
        draftPosting = false; draft = [];
        Object.assign(draftState, { code: '', title: '', classCode: '', prompt: '', hint: '', bulk: '', modelId: '', check: true, show3d: true, editIndex: -1 }); keepDraft();
        // Only navigate if the teacher is still on the posting screen.
        if (sform.isConnected) { window.history.replaceState(null, '', '#set/' + encodeURIComponent(data.code)); renderSet(data.code); window.scrollTo(0, 0); flash('Set ' + data.code + ' posted. Add or review its model answers below.', 'ok'); }
        else if (!window.location.hash) renderHome();
      }, function (err) {
        draftPosting = false;
        if (sform.isConnected) apiError(err, 'Create failed');
        else if (!window.location.hash) { renderHome(); apiError(err, 'Create failed'); }
      });
    }, 'lab-primary'));
    srow2.appendChild(act('Discard draft', function () {
      if (!window.confirm('Discard the question set draft and its pending text?')) return;
      draft = []; Object.assign(draftState, { code: '', title: '', classCode: '', prompt: '', hint: '', bulk: '', modelId: '', check: true, show3d: true, editIndex: -1 }); keepDraft(); renderHome();
    }, 'lab-danger'));
    sform.appendChild(srow2);
    sform.appendChild(el('p', 'A class set is available to that class. An open set is available to any logged-in student with the code. Bulk imports add questions without models. After posting, auto-draw a model or attach a saved drawing to each question.', 'lab-hint'));
    renderDraft();
    if (presetClass) { secSet.scrollIntoView({ block: 'start' }); presetClass = ''; }
  }

  // ---- class detail ----
  function renderClass(code) {
    clear(root);
    flash('');
    var s = session();
    if (!s) { window.location.replace('login.html'); return; }
    var back = link('‹ My classes', '#');
    back.className = 'lab-act lab-back';
    root.appendChild(back);
    var head = el('p', 'Loading…', 'lab-muted');
    root.appendChild(head);
    Saves.getClass(fi(), s, code).then(function (c) {
      if (!head.isConnected) return;
      clear(head);
      head.className = '';
      root.insertBefore(h2(c.code + ' — ' + (c.title || 'Untitled')), head.nextSibling);
      var meta = el('p', c.nmembers + ' member(s) · ' + c.nsets +
        ' set(s) · created ' + fmtDate(c.created_at), 'lab-muted');
      root.appendChild(meta);
      var classActions = el('div', null, 'lab-acts');
      classActions.appendChild(link('Post a set here', '#newset:' + encodeURIComponent(code)));
      classActions.appendChild(copyCode(code)); root.appendChild(classActions);

      root.appendChild(h2('Members'));
      var mbox = el('div', 'Loading…', 'lab-muted');
      root.appendChild(mbox);
      Saves.listMembers(fi(), session(), code).then(function (data) {
        if (!mbox.isConnected) return;
        clear(mbox);
        mbox.className = 'lab-list';
        var items = data.members || [];
        if (!items.length) {
          mbox.appendChild(el('p',
            'Nobody joined yet. Share the class code with students.', 'lab-muted'));
          return;
        }
        items.forEach(function (m) {
          var row = el('div', null, 'lab-row');
          row.appendChild(el('div', (m.name || m.username) + ' (' +
            m.username + ')', 'lab-title'));
          row.appendChild(el('div', 'joined ' + fmtDate(m.joined_at), 'lab-meta'));
          mbox.appendChild(row);
        });
      }, function (err) {
        if (!mbox.isConnected) return;
        mbox.textContent = 'Members could not be loaded.';
        apiError(err, 'Members failed to load');
      });

      root.appendChild(h2('Sets in this class'));
      var sobox = el('div', 'Loading…', 'lab-muted');
      root.appendChild(sobox);
      Saves.listClassSets(fi(), session(), code).then(function (data) {
        if (!sobox.isConnected) return;
        clear(sobox);
        sobox.className = 'lab-list';
        var items = data.sets || [];
        if (!items.length) {
          sobox.appendChild(el('p', 'No sets posted here yet.', 'lab-muted'));
          return;
        }
        items.forEach(function (it) {
          var row = setRow(it);
          var acts = el('div', null, 'lab-acts');
          acts.appendChild(link('Open', '#set/' + it.code));
          row.appendChild(acts);
          sobox.appendChild(row);
        });
      }, function (err) {
        if (!sobox.isConnected) return;
        sobox.textContent = 'Sets could not be loaded.';
        apiError(err, 'Sets failed to load');
      });
    }, function (err) {
      if (!head.isConnected) return;
      head.textContent = 'This page could not be loaded. Return to the studio and try again.';
      apiError(err, 'Class failed to load');
    });
  }

  // Inline grading form under a submission row.
  function renderGradeForm(row, sub, onGraded) {
    var old = row.querySelector('.lab-gradeform');
    if (old) { old.querySelector('select').focus(); return; }
    var form = el('div', null, 'lab-gradeform lab-form');
    var sel = document.createElement('select');
    [['', 'Ungraded'], ['pass', 'Pass'], ['fail', 'Fail']].forEach(function (o) {
      var op = document.createElement('option');
      op.value = o[0];
      op.textContent = o[1];
      if ((sub.verdict || '') === o[0]) op.selected = true;
      sel.appendChild(op);
    });
    var rem = document.createElement('textarea');
    rem.rows = 2;
    rem.placeholder = 'Remarks for the student (optional)';
    rem.value = sub.remarks || '';
    rem.style.display = 'block';
    rem.style.width = '100%';
    rem.style.maxWidth = '560px';
    rem.style.marginTop = '4px';
    form.appendChild(field('Verdict', sel));
    form.appendChild(field('Remarks', rem));
    var brow = el('div', null, 'lab-submit');
    brow.appendChild(act('Save grade', function () {
      var verdict = sel.value; var remarks = rem.value.trim();
      if (bytes(remarks) > 2000) { flash('Shorten the remarks to at most 2,000 bytes before saving.', 'error'); rem.focus(); return; }
      return Saves.gradeSubmission(fi(), session(), sub.id, verdict, remarks).then(function () {
        if (!row.isConnected) return;
        sub.verdict = verdict; sub.remarks = remarks;
        row.querySelector('.lab-verdict').textContent = verdictLabel(verdict);
        var remarksEl = row.querySelector('.lab-remarks');
        remarksEl.textContent = remarks ? 'Your remarks: ' + remarks : ''; remarksEl.hidden = !remarks;
        row.removeChild(form); onGraded();
        flash('Submission #' + sub.id + (verdict ? ' marked ' + verdict + '.' : ' marked ungraded.'), 'ok');
        var next = row.hidden ? row.parentNode.querySelector('.lab-row:not([hidden]) .lab-grade-action') : row.querySelector('.lab-grade-action');
        if (next) next.focus();
      }, function (err) { if (row.isConnected) apiError(err, 'Grade failed'); });
    }, 'lab-primary'));
    brow.appendChild(act('Cancel', function () { row.removeChild(form); }));
    form.appendChild(brow);
    row.appendChild(form); sel.focus();
  }

  // ---- set detail + submissions ----
  function renderSet(code) {
    drawingCache = null;
    clear(root);
    flash('');
    var s = session();
    if (!s) { window.location.replace('login.html'); return; }
    var back = link('‹ My sets', '#');
    back.className = 'lab-act lab-back';
    root.appendChild(back);
    var head = el('p', 'Loading…', 'lab-muted');
    root.appendChild(head);
    Saves.getSet(fi(), s, code).then(function (data) {
      if (!head.isConnected) return;
      clear(head);
      head.className = '';
      root.insertBefore(h2(data.code + ' — ' + (data.title || 'Untitled')),
        head.nextSibling);
      var where = data.class_code
        ? ('Posted to class ' + data.class_code +
          (data.class_title ? ' (' + data.class_title + ')' : ''))
        : 'Open set: any logged-in student with the code can solve it.';
      root.appendChild(el('p', where, 'lab-muted'));
      var qs = data.questions || [];
      var setActions = el('div', null, 'lab-acts');
      setActions.appendChild(copyCode(data.code));
      setActions.appendChild(act('Refresh set', function () {
        if (root.querySelector('.lab-gradeform') && !window.confirm('Refresh and discard unsaved grading changes?')) return;
        renderSet(code);
      }));
      if (data.class_code) setActions.appendChild(link('Open class', '#class/' + encodeURIComponent(data.class_code)));
      root.appendChild(setActions);
      var modelSummary = el('p', '', 'lab-meta'); root.appendChild(modelSummary);
      function updateSummary() { modelSummary.textContent = qs.length + ' questions · ' + qs.filter(function (q) { return q.has_model; }).length + ' model answers attached'; }
      updateSummary();
      root.appendChild(h2('Questions & model answers'));
      var qbox = el('div', null, 'lab-list');
      root.appendChild(qbox);
      function questionRow(q, i) {
        var row = el('div', null, 'lab-row');
        row.appendChild(el('div', 'Q' + (i + 1) + ': ' + q.prompt, 'lab-title'));
        if (q.hint) row.appendChild(el('div', 'Hint: ' + q.hint, 'lab-meta'));
        var has = !!q.has_model;
        var has3d = !!q.has_3d;
        var modelMeta = has
          ? ('Model answer attached · auto-check ' + (q.check_enabled === false ? 'OFF' : 'ON') +
            (has3d ? ' · 3D preview ' + (q.show_3d === false ? 'OFF' : 'ON')
              : ' · no 3D preview'))
          : 'No model answer · auto-check unavailable';
        var modelStatus = el('div', modelMeta, 'lab-meta'); row.appendChild(modelStatus);
        var acts = el('div', null, 'lab-acts');
        if (has) {
          var vm = link('Review / edit model',
            'index.html?model=' + encodeURIComponent(data.code) + '&q=' + i);
          vm.target = '_blank';
          vm.rel = 'noopener';
          acts.appendChild(vm);
          var checkAction = act('Auto-check: ' + (q.check_enabled === false ? 'off — turn on' : 'on — turn off'), function () {
            var enabled = q.check_enabled === false;
            return Saves.setQuestionCheck(fi(), session(), data.code, i, enabled).then(function () {
              if (!row.isConnected) return;
              q.check_enabled = enabled; updateModelStatus(); flash('Q' + (i + 1) + ' auto-check ' + (enabled ? 'enabled.' : 'disabled.'), 'ok');
            }, function (err) { if (row.isConnected) apiError(err, 'Toggle failed'); });
          }); acts.appendChild(checkAction);
          var showAction;
          if (has3d) {
            showAction = act('3D preview: ' + (q.show_3d === false ? 'off — turn on' : 'on — turn off'), function () {
              var enabled = q.show_3d === false;
              return Saves.setQuestionShow3d(fi(), session(), data.code, i, enabled).then(function () {
                if (!row.isConnected) return;
                q.show_3d = enabled; updateModelStatus(); flash('Q' + (i + 1) + ' 3D preview ' + (enabled ? 'enabled.' : 'disabled.'), 'ok');
              }, function (err) { if (row.isConnected) apiError(err, 'Toggle failed'); });
            }); acts.appendChild(showAction);
          }
          function updateModelStatus() {
            modelStatus.textContent = 'Model answer attached · auto-check ' + (q.check_enabled === false ? 'OFF' : 'ON') + (has3d ? ' · 3D preview ' + (q.show_3d === false ? 'OFF' : 'ON') : ' · no 3D preview');
            checkAction.textContent = 'Auto-check: ' + (q.check_enabled === false ? 'off — turn on' : 'on — turn off');
            if (showAction) showAction.textContent = '3D preview: ' + (q.show_3d === false ? 'off — turn on' : 'on — turn off');
          }
          acts.appendChild(act('Clear model', (function (idx) {
            return function () {
              if (!window.confirm('Remove the model answer for Q' + (idx + 1) + '?')) return;
              return Saves.clearQuestionModel(fi(), session(), data.code, idx).then(function () {
                if (!row.isConnected) return;
                q.has_model = false; q.has_3d = false; delete q.model; delete q.model3d;
                row.replaceWith(questionRow(q, i)); updateSummary();
                flash('Q' + (idx + 1) + ' model cleared.', 'ok');
              }, function (err) { if (row.isConnected) apiError(err, 'Clear failed'); });
            };
          })(i), 'lab-danger'));
        }
        // Auto-draw the model from the question words on the sheet.
        var auto = link(has ? 'Auto-draw replacement' : 'Auto-draw model',
          'index.html?model=' + encodeURIComponent(data.code) + '&q=' + i +
          '&autodraw=1');
        auto.target = '_blank';
        auto.rel = 'noopener';
        acts.appendChild(auto);
        // Attach / replace the model from a saved drawing.
        var sel = modelSelect('');
        sel.style.maxWidth = '220px';
        acts.appendChild(sel);
        acts.appendChild(act(has ? 'Replace model' : 'Attach model', (function (idx, select) {
          return function () {
            if (!select.value) { flash('Pick a saved drawing first.', 'error'); return; }
            if (has && !window.confirm('Replace the model answer for Q' + (idx + 1) + '?')) return;
            flash('Attaching model…');
            var rebuilt = false; var snapshot; var preview;
            return Saves.getDrawing(fi(), session(), select.value).then(function (d) {
              if (!row.isConnected) return;
              if (!d.data || !Array.isArray(d.data.entities) || !d.data.entities.length) throw new Error('The saved model drawing is empty. Choose another drawing.');
              var pv = buildModelPreview(d.data.entities);
              rebuilt = !!pv; snapshot = d.data; preview = pv;
              var extra = { show_3d: q.show_3d !== false };
              if (pv) extra.model3d = pv;
              return Saves.setQuestionModel(fi(), session(), data.code, idx, d.data, extra);
            }).then(function () {
              if (!row.isConnected) return;
              q.has_model = true; q.model = snapshot; q.has_3d = !!preview; q.model3d = preview; q.check_enabled = true;
              row.replaceWith(questionRow(q, i)); updateSummary();
              flash('Q' + (idx + 1) + ' model attached. Auto-check is on.' +
                (rebuilt ? ' 3D preview rebuilt.' : ' No 3D preview built.'), 'ok');
            }, function (err) { if (row.isConnected) apiError(err, 'Attach failed'); });
          };
        })(i, sel)));
        row.appendChild(acts);
        return row;
      }
      qs.forEach(function (q, i) { qbox.appendChild(questionRow(q, i)); });
      root.appendChild(el('p', 'Draw the model on the Sheet and Save it, ' +
        'then attach it here — or attach the current sheet from the Sheet’s ' +
        'Sets panel. Auto-draw drafts it from the question words instead. ' +
        'Students never see the model drawing; the auto-check toggle only ' +
        'switches strict pass/fail checking on or off, while the 3D preview ' +
        'toggle controls whether they see its 3D shape while solving. ' +
        'Re-attaching a model rebuilds its preview.', 'lab-hint'));

      root.appendChild(h2('Submissions by question'));
      var sub = el('div', 'Loading…', 'lab-muted');
      root.appendChild(sub);
      Saves.listSubmissions(fi(), session(), code).then(function (sd) {
        if (!sub.isConnected) return;
        clear(sub);
        sub.className = 'lab-list';
        var items = sd.submissions || [];
        if (!items.length) {
          sub.appendChild(el('p', 'No submissions yet.', 'lab-muted'));
          return;
        }
        var filter = document.createElement('select');
        [['all', 'All submissions'], ['ungraded', 'Needs grading'], ['auto-fail', 'Auto-check failed']].forEach(function (item) {
          var opt = el('option', item[1]); opt.value = item[0]; filter.appendChild(opt);
        });
        sub.appendChild(field('Show', filter));
        var queueSummary = el('p', '', 'lab-meta'); sub.appendChild(queueSummary);
        var queue = []; var groupHeads = [];
        var emptyFilter = el('p', 'No submissions match this filter.', 'lab-muted');
        function updateQueue() {
          var remaining = items.filter(function (it) { return !it.verdict; }).length;
          queueSummary.textContent = items.length + ' submissions · ' + remaining + ' need grading';
          queue.forEach(function (item) {
            item.row.hidden = filter.value === 'ungraded' ? !!item.sub.verdict : filter.value === 'auto-fail' ? !(item.sub.auto && item.sub.auto.checked && !item.sub.auto.pass) : false;
          });
          groupHeads.forEach(function (group) {
            var list = group.items;
            group.head.textContent = 'Q' + (group.qi + 1) + ' — ' + list.length + ' submission(s) · ' + list.filter(function (it) { return !it.verdict; }).length + ' need grading · ' + list.filter(function (it) { return it.verdict === 'pass'; }).length + ' passed · ' + list.filter(function (it) { return it.verdict === 'fail'; }).length + ' failed · ' + list.filter(function (it) { return it.auto && it.auto.checked && !it.auto.pass; }).length + ' auto-fail';
            group.head.hidden = !queue.some(function (item) { return item.sub.question_index === group.qi && !item.row.hidden; });
          });
          emptyFilter.hidden = queue.some(function (item) { return !item.row.hidden; });
        }
        filter.addEventListener('change', function () {
          if (sub.querySelector('.lab-gradeform') && !window.confirm('Change the filter and discard unsaved grading changes?')) { filter.value = filter.dataset.previous || 'all'; return; }
          sub.querySelectorAll('.lab-gradeform').forEach(function (form) { form.remove(); });
          filter.dataset.previous = filter.value; updateQueue();
        });
        // Group by question index, in question order.
        var groups = {};
        items.forEach(function (it) {
          var k = it.question_index;
          if (!groups[k]) groups[k] = [];
          groups[k].push(it);
        });
        Object.keys(groups).map(Number).sort(function (a, b) { return a - b; })
          .forEach(function (qi) {
            var list = groups[qi];
            var gh = el('h2');
            sub.appendChild(gh); groupHeads.push({ head: gh, qi: qi, items: list });
            list.forEach(function (it) {
              var row = el('div', null, 'lab-row');
              var title = el('div', null, 'lab-title');
              title.appendChild(document.createTextNode(
                (it.name || it.username) + ' · ' + fmtDate(it.created_at) + '  '));
              title.appendChild(el('span', verdictLabel(it.verdict), 'lab-tag lab-verdict'));
              title.appendChild(el('span', autoLabel(it.auto), 'lab-tag'));
              row.appendChild(title);
              if (it.note) row.appendChild(el('div', 'Student note: ' + it.note));
              var remarksEl = el('div', it.remarks ? 'Your remarks: ' + it.remarks : '', 'lab-remarks'); remarksEl.hidden = !it.remarks; row.appendChild(remarksEl);
              if (it.auto && it.auto.checked && it.auto.details) {
                var d = it.auto.details;
                row.appendChild(el('div', 'Auto: ' +
                  (d.matched !== undefined ? d.matched + '/' + d.model_count + ' matched' : '') +
                  (d.missing ? ' · ' + d.missing + ' missing' : '') +
                  (d.extra ? ' · ' + d.extra + ' extra' : '') +
                  (typeof it.auto.score === 'number'
                    ? ' · score ' + Math.round(it.auto.score * 100) + '%' : ''),
                  'lab-meta'));
              }
              var acts = el('div', null, 'lab-acts');
              var view = link('View sheet', 'index.html?submission=' + it.id);
              view.target = '_blank';
              view.rel = 'noopener';
              acts.appendChild(view);
              acts.appendChild(act('Grade', (function (sub) {
                return function () { renderGradeForm(row, sub, updateQueue); };
              })(it), 'lab-grade-action'));
              row.appendChild(acts);
              sub.appendChild(row); queue.push({ row: row, sub: it });
            });
          });
        sub.appendChild(emptyFilter); updateQueue();
      }, function (err) {
        if (!sub.isConnected) return;
        sub.textContent = 'Submissions could not be loaded. Use Refresh set to try again.';
        apiError(err, 'Submissions failed to load');
      });
    }, function (err) {
      if (!head.isConnected) return;
      head.textContent = 'This page could not be loaded. Return to the studio and try again.';
      apiError(err, 'Set failed to load');
    });
  }

  // ---- manual (inline, teacher slice) ----
  function renderManual() {
    clear(root);
    flash('');
    var s = session();
    if (!s) { window.location.replace('login.html'); return; }
    if (!window.EduCADLabManual) {
      window.location.href = 'manual.html';
      return;
    }
    window.EduCADLabManual.show(root, 'teacher');
  }

  // ---- routing ----
  function route() {
    window.scrollTo(0, 0);
    var h = String(window.location.hash || '').replace(/^#/, '');
    try { h = decodeURIComponent(h); } catch (err) { renderHome(); flash('That studio link is invalid. Choose a class or set below.', 'error'); return; }
    if (h === 'manual') {
      renderManual();
      return;
    }
    if (h.indexOf('class/') === 0 && h.length > 6) {
      renderClass(h.slice(6));
      return;
    }
    if (h.indexOf('set/') === 0 && h.length > 4) {
      renderSet(h.slice(4));
      return;
    }
    if (h.indexOf('newset:') === 0) {
      presetClass = h.slice(7);
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, '', 'teacher.html');
      } else {
        window.location.hash = '';
        return;
      }
    }
    renderHome();
  }
  window.addEventListener('hashchange', route);
  if (window.EduCADLabManual) window.EduCADLabManual.wireNav();
  route();
})();

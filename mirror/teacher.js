'use strict';
/* EduCAD teacher studio: classes, class-scoped question sets, model
   answers, submission review with remarks and pass/fail. Codeforces-clean,
   link actions only. Teachers (and academics) land here after login; the
   drawing sheet opens in view mode to inspect a submission
   (index.html?submission=<id>) or a model answer (index.html?model=<code>).
   Model drawings are never sent to students: the per-question toggle only
   switches strict auto-checking on or off. */
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
    // The minimal Node demo server has no lab API at all.
    if (/failed to fetch|load failed|not found/i.test(msg) || !err.status) {
      flash(what + ': lab server unreachable. Run `npm run start:cpp` ' +
        'for classes, sets and saves.', 'error');
      return;
    }
    flash(what + ': ' + msg, 'error');
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
  function act(label, fn, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'lab-act' + (cls ? ' ' + cls : '');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  }
  function link(label, href, cls) {
    var a = document.createElement('a');
    a.className = 'lab-act' + (cls ? ' ' + cls : '');
    a.textContent = label;
    a.href = href;
    return a;
  }
  function h2(text) { return el('h2', text); }
  function field(label, input) {
    var wrap = el('div', null, 'lab-field');
    if (label) wrap.appendChild(el('label', label, 'lab-lbl'));
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
      if (!p) return;
      var q = { prompt: p };
      if (hint) q.hint = hint;
      out.push(q);
    });
    return out;
  }
  // Cached drawing list for "model from drawing" selects.
  var drawingCache = null;
  function loadDrawings() {
    if (drawingCache) return Promise.resolve(drawingCache);
    return Saves.listDrawings(fi(), session()).then(function (data) {
      drawingCache = data.drawings || [];
      return drawingCache;
    });
  }
  function modelSelect(selectedId) {
    var sel = document.createElement('select');
    var none = document.createElement('option');
    none.value = '';
    none.textContent = 'No model answer';
    sel.appendChild(none);
    function fill(items) {
      items.forEach(function (d) {
        var o = document.createElement('option');
        o.value = String(d.id);
        o.textContent = 'Model: ' + (d.title || 'Untitled') +
          ' (#' + d.id + ')';
        if (selectedId && String(d.id) === String(selectedId)) o.selected = true;
        sel.appendChild(o);
      });
    }
    if (drawingCache) fill(drawingCache);
    else {
      var loading = document.createElement('option');
      loading.value = '';
      loading.textContent = 'Loading drawings…';
      sel.appendChild(loading);
      loadDrawings().then(function (items) {
        sel.removeChild(loading);
        fill(items);
        if (selectedId) sel.value = String(selectedId);
      }, function () {
        loading.textContent = 'Drawings unavailable';
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

  // ---- home: classes + sets ----
  var draft = [];
  var presetClass = '';

  function renderHome() {
    clear(root);
    flash('');
    var s = session();
    if (!s) { window.location.replace('login.html'); return; }

    // New class.
    root.appendChild(h2('New class'));
    var form = el('div', null, 'lab-form');
    var codeIn = textInput('Class code, e.g. be-a-2026');
    var titleIn = textInput('Title, e.g. BE-A Engineering Graphics');
    form.appendChild(field('Code', codeIn));
    form.appendChild(field('Title', titleIn));
    var submit = el('div', null, 'lab-submit');
    submit.appendChild(act('Create class', function () {
      var code = codeIn.value.trim();
      var title = titleIn.value.trim() || 'Untitled class';
      if (!code) { flash('Class code cannot be empty.', 'error'); return; }
      Saves.createClass(fi(), session(), code, title).then(function (data) {
        codeIn.value = '';
        titleIn.value = '';
        renderHome();
        flash('Class ' + data.code + ' created. Share the code with students.', 'ok');
      }, function (err) { apiError(err, 'Create failed'); });
    }, 'lab-primary'));
    form.appendChild(submit);
    form.appendChild(el('p', 'Codes are 3–24 letters, digits and dashes. ' +
      'Students join with the code; only you see the member list.', 'lab-hint'));
    root.appendChild(form);

    // My classes.
    root.appendChild(h2('My classes'));
    var clsBox = el('div', 'Loading…', 'lab-muted');
    root.appendChild(clsBox);
    Saves.listClasses(fi(), s).then(function (data) {
      clear(clsBox);
      clsBox.className = 'lab-list';
      var items = data.classes || [];
      if (!items.length) {
        clsBox.appendChild(el('p', 'No classes yet. Create one above.', 'lab-muted'));
        return;
      }
      items.forEach(function (it) {
        var row = el('div', null, 'lab-row');
        var title = el('div', null, 'lab-title');
        title.appendChild(link(it.code + ' — ' + (it.title || 'Untitled'),
          '#class/' + it.code));
        row.appendChild(title);
        row.appendChild(el('div', it.nmembers + ' member(s) · ' + it.nsets +
          ' set(s) · ' + fmtDate(it.created_at), 'lab-meta'));
        var acts = el('div', null, 'lab-acts');
        acts.appendChild(link('Open', '#class/' + it.code));
        acts.appendChild(link('Post a set here', '#newset:' + it.code));
        var del = act('Delete', function () {
          if (!window.confirm('Delete class "' + it.code + '"? Its sets ' +
              'become open sets; memberships are dropped.')) return;
          Saves.deleteClass(fi(), session(), it.code).then(function () {
            renderHome();
            flash('Class ' + it.code + ' deleted.', 'ok');
          }, function (err) { apiError(err, 'Delete failed'); });
        }, 'lab-danger');
        acts.appendChild(del);
        row.appendChild(acts);
        clsBox.appendChild(row);
      });
    }, function (err) {
      clsBox.textContent = '';
      apiError(err, 'Classes failed to load');
    });

    // New set.
    var secSet = h2('New question set');
    secSet.id = 'sec-newset';
    root.appendChild(secSet);
    var sform = el('div', null, 'lab-form');
    var scode = textInput('Set code, e.g. proj-01');
    var stitle = textInput('Title, e.g. Projections 1');
    var sclass = document.createElement('select');
    sform.appendChild(field('Code', scode));
    sform.appendChild(field('Title', stitle));
    sform.appendChild(field('Class', sclass));
    function fillClasses(selected) {
      Saves.listClasses(fi(), session()).then(function (data) {
        clear(sclass);
        var open = document.createElement('option');
        open.value = '';
        open.textContent = 'Open set (any student with the code)';
        sclass.appendChild(open);
        (data.classes || []).forEach(function (it) {
          var o = document.createElement('option');
          o.value = it.code;
          o.textContent = it.code + ' — ' + (it.title || 'Untitled');
          if (it.code === selected) o.selected = true;
          sclass.appendChild(o);
        });
      }, function () {
        clear(sclass);
        var o = document.createElement('option');
        o.value = '';
        o.textContent = 'Open set (any student with the code)';
        sclass.appendChild(o);
      });
    }
    fillClasses(presetClass);
    var draftBox = el('div');
    sform.appendChild(draftBox);
    function draftModelText(q) {
      if (!q.modelDrawingId) return 'No model answer';
      var t = 'Model from drawing #' + q.modelDrawingId;
      if (q.modelTitle) t += ' (' + q.modelTitle + ')';
      return t + (q.check_enabled === false ? ' · auto-check off' : ' · auto-check on');
    }
    function renderDraft() {
      clear(draftBox);
      draft.forEach(function (q, i) {
        var row = el('div', null, 'lab-row');
        row.appendChild(el('div', 'Q' + (i + 1) + ': ' + q.prompt, 'lab-title'));
        if (q.hint) row.appendChild(el('div', 'Hint: ' + q.hint, 'lab-meta'));
        row.appendChild(el('div', draftModelText(q), 'lab-meta'));
        var rm = act('Remove', function () {
          draft.splice(i, 1);
          renderDraft();
        }, 'lab-danger');
        var acts = el('div', null, 'lab-acts');
        acts.appendChild(rm);
        row.appendChild(acts);
        draftBox.appendChild(row);
      });
    }
    renderDraft();
    var promptIn = document.createElement('textarea');
    promptIn.placeholder = 'Question prompt, e.g. Draw the front and top views of a 40mm cube.';
    promptIn.rows = 2;
    var hintIn = textInput('Hint (optional)');
    var modelIn = modelSelect('');
    var checkWrap = el('div', null, 'lab-field');
    var checkBox = document.createElement('input');
    checkBox.type = 'checkbox';
    checkBox.checked = true;
    checkBox.id = 'lab-check-new';
    var checkLbl = document.createElement('label');
    checkLbl.htmlFor = 'lab-check-new';
    checkLbl.textContent = ' Auto-check student drawings against the model (strict)';
    checkWrap.appendChild(checkBox);
    checkWrap.appendChild(checkLbl);
    sform.appendChild(field('Prompt', promptIn));
    sform.appendChild(field('Hint', hintIn));
    sform.appendChild(field('Model', modelIn));
    sform.appendChild(checkWrap);
    var srow = el('div', null, 'lab-submit');
    srow.appendChild(act('Add question', function () {
      var prompt = promptIn.value.trim();
      if (!prompt) { flash('Question prompt cannot be empty.', 'error'); return; }
      var q = { prompt: prompt };
      if (hintIn.value.trim()) q.hint = hintIn.value.trim();
      if (modelIn.value) {
        q.modelDrawingId = modelIn.value;
        var opt = modelIn.options[modelIn.selectedIndex];
        q.modelTitle = opt ? opt.textContent.replace(/^Model:\s*/, '') : '';
        q.check_enabled = checkBox.checked;
      }
      draft.push(q);
      promptIn.value = '';
      hintIn.value = '';
      modelIn.value = '';
      checkBox.checked = true;
      flash('');
      renderDraft();
    }));
    sform.appendChild(srow);
    // Bulk upload: many questions at once, blank-line separated.
    var bulkIn = document.createElement('textarea');
    bulkIn.placeholder = 'Bulk add: one question per block, blank line between. ' +
      'A line starting with "Hint:" becomes the hint.';
    bulkIn.rows = 4;
    sform.appendChild(field('Bulk', bulkIn));
    var brow = el('div', null, 'lab-submit');
    brow.appendChild(act('Add all from text', function () {
      var qs = parseBulk(bulkIn.value);
      if (!qs.length) { flash('No questions found in the text.', 'error'); return; }
      if (modelIn.value) {
        var opt = modelIn.options[modelIn.selectedIndex];
        qs.forEach(function (q) {
          q.modelDrawingId = modelIn.value;
          q.modelTitle = opt ? opt.textContent.replace(/^Model:\s*/, '') : '';
          q.check_enabled = checkBox.checked;
        });
      }
      draft = draft.concat(qs);
      bulkIn.value = '';
      flash(qs.length + ' question(s) added to the draft.', 'ok');
      renderDraft();
    }));
    var fileIn = document.createElement('input');
    fileIn.type = 'file';
    fileIn.accept = '.txt,.json,.csv,text/plain,application/json';
    fileIn.style.display = 'none';
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var text = String(rd.result || '');
        var qs = [];
        if (/\.json$/i.test(f.name)) {
          try {
            var parsed = JSON.parse(text);
            var arr = Array.isArray(parsed) ? parsed : parsed.questions;
            (Array.isArray(arr) ? arr : []).forEach(function (e) {
              if (typeof e === 'string' && e.trim()) qs.push({ prompt: e.trim() });
              else if (e && typeof e.prompt === 'string' && e.prompt.trim()) {
                var q = { prompt: e.prompt.trim() };
                if (typeof e.hint === 'string' && e.hint.trim()) q.hint = e.hint.trim();
                qs.push(q);
              }
            });
          } catch (err) { qs = []; }
        } else {
          qs = parseBulk(text);
        }
        if (!qs.length) { flash('No questions found in ' + f.name + '.', 'error'); return; }
        draft = draft.concat(qs);
        fileIn.value = '';
        flash(qs.length + ' question(s) uploaded from ' + f.name + '.', 'ok');
        renderDraft();
      };
      rd.readAsText(f);
    });
    brow.appendChild(act('Upload file…', function () { fileIn.click(); }));
    brow.appendChild(fileIn);
    sform.appendChild(brow);
    var srow2 = el('div', null, 'lab-submit');
    srow2.appendChild(act('Create set', function () {
      var code = scode.value.trim();
      var title = stitle.value.trim() || 'Untitled set';
      if (!draft.length) {
        flash('Add at least one question first.', 'error');
        return;
      }
      flash('Posting set… (resolving model drawings)');
      // Resolve modelDrawingId -> snapshot via saved drawings.
      var jobs = draft.map(function (q) {
        var nq = { prompt: q.prompt };
        if (q.hint) nq.hint = q.hint;
        if (q.check_enabled !== undefined) nq.check_enabled = q.check_enabled;
        if (!q.modelDrawingId) return Promise.resolve(nq);
        return Saves.getDrawing(fi(), session(), q.modelDrawingId).then(function (d) {
          nq.model = d.data;
          nq.check_enabled = q.check_enabled !== false;
          return nq;
        });
      });
      Promise.all(jobs).then(function (questions) {
        return Saves.createSet(fi(), session(), code, title, questions,
          sclass.value || undefined);
      }).then(function (data) {
        draft = [];
        scode.value = '';
        stitle.value = '';
        presetClass = '';
        renderHome();
        flash('Set ' + data.code + ' posted.', 'ok');
      }, function (err) { apiError(err, 'Create failed'); });
    }, 'lab-primary'));
    sform.appendChild(srow2);
    sform.appendChild(el('p', 'A class set is listed for that class only; ' +
      'an open set is solvable by any logged-in student with the code. ' +
      'Draw the model answer on the Sheet, Save it, then attach the saved ' +
      'drawing above — or attach the current sheet from the Sheet’s Sets panel. ' +
      'Students never see the model; the toggle only switches strict ' +
      'auto-checking on or off.', 'lab-hint'));
    root.appendChild(sform);

    // My sets.
    root.appendChild(h2('My sets'));
    var setBox = el('div', 'Loading…', 'lab-muted');
    root.appendChild(setBox);
    Saves.listSets(fi(), s).then(function (data) {
      clear(setBox);
      setBox.className = 'lab-list';
      var items = data.sets || [];
      if (!items.length) {
        setBox.appendChild(el('p', 'No sets yet.', 'lab-muted'));
        return;
      }
      items.forEach(function (it) {
        var row = setRow(it);
        var acts = el('div', null, 'lab-acts');
        acts.appendChild(link('Open', '#set/' + it.code));
        var del = act('Delete', function () {
          if (!window.confirm('Delete set "' + it.code +
              '" and all its submissions?')) return;
          Saves.deleteSet(fi(), session(), it.code).then(function () {
            renderHome();
            flash('Set ' + it.code + ' deleted.', 'ok');
          }, function (err) { apiError(err, 'Delete failed'); });
        }, 'lab-danger');
        acts.appendChild(del);
        row.appendChild(acts);
        setBox.appendChild(row);
      });
    }, function (err) {
      setBox.textContent = '';
      apiError(err, 'Sets failed to load');
    });

    if (presetClass) {
      var target = $('sec-newset');
      if (target && target.scrollIntoView) target.scrollIntoView();
      presetClass = '';
    }
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
      clear(head);
      head.className = '';
      root.insertBefore(h2(c.code + ' — ' + (c.title || 'Untitled')), head.nextSibling);
      var meta = el('p', c.nmembers + ' member(s) · ' + c.nsets +
        ' set(s) · created ' + fmtDate(c.created_at), 'lab-muted');
      root.appendChild(meta);

      root.appendChild(h2('Members'));
      var mbox = el('div', 'Loading…', 'lab-muted');
      root.appendChild(mbox);
      Saves.listMembers(fi(), session(), code).then(function (data) {
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
        mbox.textContent = '';
        apiError(err, 'Members failed to load');
      });

      root.appendChild(h2('Sets in this class'));
      var sobox = el('div', 'Loading…', 'lab-muted');
      root.appendChild(sobox);
      Saves.listClassSets(fi(), session(), code).then(function (data) {
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
        sobox.textContent = '';
        apiError(err, 'Sets failed to load');
      });
    }, function (err) {
      head.textContent = '';
      apiError(err, 'Class failed to load');
    });
  }

  // Inline grading form under a submission row.
  function renderGradeForm(row, sub, setCode) {
    var old = row.querySelector('.lab-gradeform');
    if (old) { row.removeChild(old); return; }
    var form = el('div', null, 'lab-gradeform');
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
    form.appendChild(rem);
    var brow = el('div', null, 'lab-submit');
    brow.appendChild(act('Save grade', function () {
      Saves.gradeSubmission(fi(), session(), sub.id, sel.value, rem.value.trim())
        .then(function () {
          renderSet(setCode);
          flash('Submission #' + sub.id + ' graded.', 'ok');
        }, function (err) { apiError(err, 'Grade failed'); });
    }, 'lab-primary'));
    brow.appendChild(act('Cancel', function () { row.removeChild(form); }));
    form.appendChild(brow);
    row.appendChild(form);
  }

  // ---- set detail + submissions ----
  function renderSet(code) {
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
      root.appendChild(h2('Questions & model answers'));
      var qbox = el('div', null, 'lab-list');
      root.appendChild(qbox);
      qs.forEach(function (q, i) {
        var row = el('div', null, 'lab-row');
        row.appendChild(el('div', 'Q' + (i + 1) + ': ' + q.prompt, 'lab-title'));
        if (q.hint) row.appendChild(el('div', 'Hint: ' + q.hint, 'lab-meta'));
        var has = !!q.has_model;
        var modelMeta = has
          ? ('Model answer attached · auto-check ' + (q.check_enabled === false ? 'OFF' : 'ON'))
          : 'No model answer · auto-check unavailable';
        row.appendChild(el('div', modelMeta, 'lab-meta'));
        var acts = el('div', null, 'lab-acts');
        if (has) {
          var vm = link('View model on sheet',
            'index.html?model=' + encodeURIComponent(data.code) + '&q=' + i);
          vm.target = '_blank';
          vm.rel = 'noopener';
          acts.appendChild(vm);
          acts.appendChild(act('Auto-check: ' + (q.check_enabled === false ? 'off — turn on' : 'on — turn off'),
            (function (idx, cur) {
              return function () {
                Saves.setQuestionCheck(fi(), session(), data.code, idx, cur === false)
                  .then(function () {
                    renderSet(data.code);
                    flash('Q' + (idx + 1) + ' auto-check ' +
                      (cur === false ? 'enabled.' : 'disabled.'), 'ok');
                  }, function (err) { apiError(err, 'Toggle failed'); });
              };
            })(i, q.check_enabled)));
          acts.appendChild(act('Clear model', (function (idx) {
            return function () {
              if (!window.confirm('Remove the model answer for Q' + (idx + 1) + '?')) return;
              Saves.clearQuestionModel(fi(), session(), data.code, idx).then(function () {
                renderSet(data.code);
                flash('Q' + (idx + 1) + ' model cleared.', 'ok');
              }, function (err) { apiError(err, 'Clear failed'); });
            };
          })(i), 'lab-danger'));
        }
        // Attach / replace the model from a saved drawing.
        var sel = modelSelect('');
        sel.style.maxWidth = '220px';
        acts.appendChild(sel);
        acts.appendChild(act(has ? 'Replace model' : 'Attach model', (function (idx, select) {
          return function () {
            if (!select.value) { flash('Pick a saved drawing first.', 'error'); return; }
            flash('Attaching model…');
            Saves.getDrawing(fi(), session(), select.value).then(function (d) {
              return Saves.setQuestionModel(fi(), session(), data.code, idx, d.data);
            }).then(function () {
              renderSet(data.code);
              flash('Q' + (idx + 1) + ' model attached. Auto-check is on.', 'ok');
            }, function (err) { apiError(err, 'Attach failed'); });
          };
        })(i, sel)));
        row.appendChild(acts);
        qbox.appendChild(row);
      });
      root.appendChild(el('p', 'Draw the model on the Sheet and Save it, ' +
        'then attach it here — or attach the current sheet from the Sheet’s ' +
        'Sets panel. Students never see the model drawing; the toggle only ' +
        'switches strict auto pass/fail checking on or off.', 'lab-hint'));

      root.appendChild(h2('Submissions by question'));
      var sub = el('div', 'Loading…', 'lab-muted');
      root.appendChild(sub);
      Saves.listSubmissions(fi(), session(), code).then(function (sd) {
        clear(sub);
        sub.className = 'lab-list';
        var items = sd.submissions || [];
        if (!items.length) {
          sub.appendChild(el('p', 'No submissions yet.', 'lab-muted'));
          return;
        }
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
            var npass = list.filter(function (x) { return x.verdict === 'pass'; }).length;
            var nfail = list.filter(function (x) { return x.verdict === 'fail'; }).length;
            var nauto = list.filter(function (x) {
              return x.auto && x.auto.checked && !x.auto.pass;
            }).length;
            var gh = el('h2', 'Q' + (qi + 1) + ' — ' + list.length +
              ' submission(s) · ' + npass + ' passed · ' + nfail +
              ' failed · ' + nauto + ' auto-fail');
            sub.appendChild(gh);
            list.forEach(function (it) {
              var row = el('div', null, 'lab-row');
              var title = el('div', null, 'lab-title');
              title.appendChild(document.createTextNode(
                (it.name || it.username) + ' · ' + fmtDate(it.created_at) + '  '));
              title.appendChild(el('span', verdictLabel(it.verdict), 'lab-tag'));
              title.appendChild(el('span', autoLabel(it.auto), 'lab-tag'));
              row.appendChild(title);
              if (it.note) row.appendChild(el('div', 'Student note: ' + it.note));
              if (it.remarks) row.appendChild(el('div', 'Your remarks: ' + it.remarks));
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
                return function () { renderGradeForm(row, sub, code); };
              })(it)));
              row.appendChild(acts);
              sub.appendChild(row);
            });
          });
      }, function (err) {
        sub.textContent = '';
        apiError(err, 'Submissions failed to load');
      });
    }, function (err) {
      head.textContent = '';
      apiError(err, 'Set failed to load');
    });
  }

  // ---- routing ----
  function route() {
    var h = String(window.location.hash || '').replace(/^#/, '');
    if (h.indexOf('class/') === 0 && h.length > 6) {
      renderClass(decodeURIComponent(h.slice(6)));
      return;
    }
    if (h.indexOf('set/') === 0 && h.length > 4) {
      renderSet(decodeURIComponent(h.slice(4)));
      return;
    }
    if (h.indexOf('newset:') === 0) {
      presetClass = decodeURIComponent(h.slice(7));
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
  route();
})();

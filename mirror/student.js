'use strict';
/* EduCAD student workspace: join classes, solve sets, manage drawings,
   track submissions, grades and auto-check results. Codeforces-clean,
   link actions only. Students land here after login; the drawing sheet
   (index.html) opens for solving via ?solve=, ?drawing= and ?submission=
   deep links. Verify on the sheet checks against the teacher's model
   answer (strict pass/fail) without ever showing the model drawing. */
(function () {
  var Saves = window.EduCADSaves;
  if (!Saves) return;

  function $(id) { return document.getElementById(id); }
  function fi() { return window.fetch.bind(window); }
  function session() { return Saves.currentSession(); }

  // Gate: students only.
  var s0 = session();
  if (!s0 || Saves.isGuest(s0)) { window.location.replace('login.html'); return; }
  if (s0.role === 'teacher' || s0.role === 'academics') {
    window.location.replace('teacher.html'); return;
  }
  if (s0.role !== 'student') { window.location.replace('login.html'); return; }

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
    if (/failed to fetch|load failed|not found/i.test(msg) || !err.status) {
      flash(what + ': lab server unreachable. Run `npm start` ' +
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
  function verdictLabel(v) {
    if (v === 'pass') return 'PASS';
    if (v === 'fail') return 'FAIL';
    return 'ungraded';
  }
  function autoLabel(a) {
    if (!a || !a.checked) return 'auto: off';
    return a.pass ? 'auto: PASS' : 'auto: FAIL';
  }
  function statusRow(it) {
    var row = el('div', null, 'lab-meta');
    row.appendChild(document.createTextNode(fmtDate(it.created_at) + '  '));
    row.appendChild(el('span', verdictLabel(it.verdict), 'lab-tag'));
    row.appendChild(el('span', autoLabel(it.auto), 'lab-tag'));
    return row;
  }

  function solveLinks(code, nquestions) {
    var acts = el('div', null, 'lab-acts');
    for (var i = 0; i < nquestions; i++) {
      var a = link(nquestions > 1 ? 'Solve Q' + (i + 1) : 'Solve',
        'index.html?solve=' + encodeURIComponent(code) + '&q=' + i);
      a.target = '_blank';
      a.rel = 'noopener';
      acts.appendChild(a);
    }
    return acts;
  }

  function setRow(it) {
    var row = el('div', null, 'lab-row');
    var title = el('div', null, 'lab-title');
    title.appendChild(link(it.code + ' — ' + (it.title || 'Untitled'),
      '#set/' + it.code));
    if (it.class_code) title.appendChild(el('span', it.class_code, 'lab-tag'));
    else title.appendChild(el('span', 'open', 'lab-tag'));
    row.appendChild(title);
    row.appendChild(el('div', it.nquestions + ' question(s) · by ' +
      (it.owner || '?') + ' · ' + fmtDate(it.created_at), 'lab-meta'));
    row.appendChild(solveLinks(it.code, it.nquestions));
    return row;
  }

  // ---- home: join, classes, feed, drawings, submissions, progress ----
  function renderHome() {
    clear(root);
    flash('');
    var s = session();
    if (!s) { window.location.replace('login.html'); return; }

    // Join a class.
    root.appendChild(h2('Join a class'));
    var form = el('div', null, 'lab-form');
    var codeIn = document.createElement('input');
    codeIn.type = 'text';
    codeIn.placeholder = 'Class code, e.g. be-a-2026';
    var frow = el('div', null, 'lab-field');
    frow.appendChild(codeIn);
    form.appendChild(frow);
    var submit = el('div', null, 'lab-submit');
    submit.appendChild(act('Join class', function () {
      var code = codeIn.value.trim();
      if (!code) { flash('Enter a class code first.', 'error'); return; }
      Saves.joinClass(fi(), session(), code).then(function (data) {
        codeIn.value = '';
        renderHome();
        flash(data.joined ? 'Joined class ' + code + '.' :
          'Already a member of ' + code + '.', 'ok');
      }, function (err) {
        if (err && err.status === 404) {
          flash('No class with that code.', 'error');
          return;
        }
        apiError(err, 'Join failed');
      });
    }, 'lab-primary'));
    form.appendChild(submit);
    form.appendChild(el('p', 'Ask your teacher for the class code. ' +
      'Joining lists the class sets below.', 'lab-hint'));
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
        clsBox.appendChild(el('p',
          'No classes yet. Join one with its code above.', 'lab-muted'));
        return;
      }
      items.forEach(function (it) {
        var row = el('div', null, 'lab-row');
        var title = el('div', null, 'lab-title');
        title.appendChild(link(it.code + ' — ' + (it.title || 'Untitled'),
          '#class/' + it.code));
        row.appendChild(title);
        row.appendChild(el('div', 'by ' + (it.owner || '?') + ' · ' +
          it.nsets + ' set(s)', 'lab-meta'));
        var acts = el('div', null, 'lab-acts');
        acts.appendChild(link('Open', '#class/' + it.code));
        var leave = act('Leave', function () {
          if (!window.confirm('Leave class "' + it.code + '"?')) return;
          Saves.leaveClass(fi(), session(), it.code).then(function () {
            renderHome();
            flash('Left class ' + it.code + '.', 'ok');
          }, function (err) { apiError(err, 'Leave failed'); });
        }, 'lab-danger');
        acts.appendChild(leave);
        row.appendChild(acts);
        clsBox.appendChild(row);
      });
    }, function (err) {
      clsBox.textContent = '';
      apiError(err, 'Classes failed to load');
    });

    // Sets to solve.
    root.appendChild(h2('Sets to solve'));
    var open = el('div', null, 'lab-form');
    var openIn = document.createElement('input');
    openIn.type = 'text';
    openIn.placeholder = 'Open set by code, e.g. proj-01';
    var orow = el('div', null, 'lab-field');
    orow.appendChild(openIn);
    open.appendChild(orow);
    var osub = el('div', null, 'lab-submit');
    osub.appendChild(act('Open set', function () {
      var code = openIn.value.trim();
      if (!code) { flash('Enter a set code first.', 'error'); return; }
      window.location.hash = '#set/' + code;
    }));
    open.appendChild(osub);
    root.appendChild(open);
    var feedBox = el('div', 'Loading…', 'lab-muted');
    root.appendChild(feedBox);
    Saves.listSets(fi(), s).then(function (data) {
      clear(feedBox);
      feedBox.className = 'lab-list';
      var items = data.sets || [];
      if (!items.length) {
        feedBox.appendChild(el('p',
          'Nothing to solve yet. Join a class or open a set by code.', 'lab-muted'));
        return;
      }
      items.forEach(function (it) { feedBox.appendChild(setRow(it)); });
    }, function (err) {
      feedBox.textContent = '';
      apiError(err, 'Sets failed to load');
    });

    // My drawings.
    root.appendChild(h2('My drawings'));
    var drawBox = el('div', 'Loading…', 'lab-muted');
    root.appendChild(drawBox);
    Saves.listDrawings(fi(), s).then(function (data) {
      clear(drawBox);
      drawBox.className = 'lab-list';
      var items = data.drawings || [];
      if (!items.length) {
        drawBox.appendChild(el('p',
          'No saved drawings yet. Draw on the sheet, then Save.', 'lab-muted'));
        return;
      }
      items.forEach(function (it) {
        var row = el('div', null, 'lab-row');
        row.appendChild(el('div', it.title || 'Untitled', 'lab-title'));
        row.appendChild(el('div', fmtDate(it.updated_at), 'lab-meta'));
        var acts = el('div', null, 'lab-acts');
        var edit = link('Open in sheet', 'index.html?drawing=' + it.id);
        edit.target = '_blank';
        edit.rel = 'noopener';
        acts.appendChild(edit);
        var del = act('Delete', function () {
          if (!window.confirm('Delete "' + (it.title || 'Untitled') + '"?')) return;
          Saves.deleteDrawing(fi(), session(), it.id).then(function () {
            renderHome();
            flash('Drawing deleted.', 'ok');
          }, function (err) { apiError(err, 'Delete failed'); });
        }, 'lab-danger');
        acts.appendChild(del);
        row.appendChild(acts);
        drawBox.appendChild(row);
      });
    }, function (err) {
      drawBox.textContent = '';
      apiError(err, 'Drawings failed to load');
    });

    // My submissions.
    root.appendChild(h2('My submissions'));
    var mineBox = el('div', 'Loading…', 'lab-muted');
    root.appendChild(mineBox);
    Saves.listMySubmissions(fi(), s).then(function (data) {
      clear(mineBox);
      mineBox.className = 'lab-list';
      var items = data.submissions || [];
      if (!items.length) {
        mineBox.appendChild(el('p', 'Nothing submitted yet.', 'lab-muted'));
        return;
      }
      items.forEach(function (it) {
        var row = el('div', null, 'lab-row');
        row.appendChild(el('div', it.set_code + ' · Q' +
          (it.question_index + 1), 'lab-title'));
        row.appendChild(statusRow(it));
        if (it.remarks) row.appendChild(el('div', 'Teacher remarks: ' + it.remarks));
        if (it.auto && it.auto.checked && it.auto.details) {
          var d = it.auto.details;
          row.appendChild(el('div', 'Auto-check: ' +
            (it.auto.pass ? 'PASS' : 'FAIL') +
            (d.matched !== undefined ? ' · ' + d.matched + '/' + d.model_count + ' matched' : '') +
            (d.missing ? ' · ' + d.missing + ' missing' : '') +
            (d.extra ? ' · ' + d.extra + ' extra' : ''),
            'lab-meta'));
        }
        var acts = el('div', null, 'lab-acts');
        acts.appendChild(link('Open set', '#set/' + it.set_code));
        var rel = link('Reload in sheet', 'index.html?submission=' + it.id);
        rel.target = '_blank';
        rel.rel = 'noopener';
        acts.appendChild(rel);
        row.appendChild(acts);
        mineBox.appendChild(row);
      });
    }, function (err) {
      mineBox.textContent = '';
      apiError(err, 'Submissions failed to load');
    });

    // Progress.
    root.appendChild(h2('Tutorial progress'));
    var progBox = el('div', 'Loading…', 'lab-muted');
    root.appendChild(progBox);
    Saves.fetchProgress().then(function (r) {
      clear(progBox);
      var done = {};
      if (!r.skipped) {
        (r.progress || []).forEach(function (p) {
          if (p && p.state && p.state.done === true) done[p.lesson] = true;
        });
      }
      var lessons = [
        { key: 'square', label: 'Square construction' },
        { key: 'prism', label: 'Hexagonal prism' }
      ];
      var list = el('div', null, 'lab-list');
      lessons.forEach(function (L) {
        var row = el('div', null, 'lab-row');
        row.appendChild(el('div', (done[L.key] ? '✓ ' : '· ') + L.label,
          'lab-title'));
        var acts = el('div', null, 'lab-acts');
        var tut = link('Open tutorial', 'tutorials.html');
        tut.target = '_blank';
        tut.rel = 'noopener';
        acts.appendChild(tut);
        row.appendChild(acts);
        list.appendChild(row);
      });
      progBox.appendChild(list);
    }, function () {
      progBox.textContent = '';
    });
  }

  // ---- class detail: sets to solve ----
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
      root.insertBefore(h2(c.code + ' — ' + (c.title || 'Untitled')),
        head.nextSibling);
      root.appendChild(el('p', 'by ' + (c.owner || '?') + ' · ' + c.nsets +
        ' set(s)', 'lab-muted'));
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
        items.forEach(function (it) { sobox.appendChild(setRow(it)); });
      }, function (err) {
        sobox.textContent = '';
        apiError(err, 'Sets failed to load');
      });
    }, function (err) {
      head.textContent = '';
      if (err && err.status === 403) {
        flash('You are not a member of ' + code + '. Join it first.', 'error');
        return;
      }
      apiError(err, 'Class failed to load');
    });
  }

  // ---- set detail: questions with solve links ----
  function renderSet(code) {
    clear(root);
    flash('');
    var s = session();
    if (!s) { window.location.replace('login.html'); return; }
    var back = link('‹ Sets to solve', '#');
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
        ? ('Class set · ' + data.class_code +
          (data.class_title ? ' (' + data.class_title + ')' : ''))
        : 'Open set';
      root.appendChild(el('p', where + ' · by ' + (data.owner || '?'),
        'lab-muted'));
      var qs = data.questions || [];
      var rows = [];
      qs.forEach(function (q, i) {
        var row = el('div', null, 'lab-row');
        row.appendChild(el('div', 'Q' + (i + 1) + ': ' + q.prompt, 'lab-title'));
        if (q.has_model && q.check_enabled !== false) {
          row.appendChild(el('div',
            'Strict auto-check is on: Verify on the sheet tells you pass/fail ' +
            'without showing the model answer.', 'lab-meta'));
        } else if (q.has_model) {
          row.appendChild(el('div', 'Auto-check is off for this question.', 'lab-meta'));
        }
        var mine = el('div', null, 'lab-meta');
        row.appendChild(mine);
        rows.push(mine);
        var acts = el('div', null, 'lab-acts');
        if (q.hint) {
          var hintText = el('div', q.hint, 'lab-meta');
          hintText.hidden = true;
          row.appendChild(hintText);
          acts.appendChild(act('Hint', (function (t) {
            return function () { t.hidden = !t.hidden; };
          })(hintText)));
        }
        var a = link('Solve on sheet',
          'index.html?solve=' + encodeURIComponent(data.code) + '&q=' + i);
        a.target = '_blank';
        a.rel = 'noopener';
        acts.appendChild(a);
        row.appendChild(acts);
        root.appendChild(row);
      });
      root.appendChild(el('p', 'Solving opens the sheet with the starter ' +
        'loaded (when the teacher attached one). Verify checks your drawing ' +
        'against the model answer (pass/fail only, the model stays hidden); ' +
        'Submit sends it to your teacher from the sheet\'s Sets panel.', 'lab-hint'));
      // Overlay my latest status per question.
      Saves.listMySubmissions(fi(), session()).then(function (md) {
        var latest = {};
        (md.submissions || []).forEach(function (it) {
          if (it.set_code !== data.code) return;
          var k = it.question_index;
          if (!latest[k]) latest[k] = it;
        });
        Object.keys(latest).forEach(function (k) {
          var box = rows[Number(k)];
          var it = latest[k];
          if (!box || !it) return;
          box.appendChild(document.createTextNode('My latest: '));
          box.appendChild(el('span', verdictLabel(it.verdict), 'lab-tag'));
          box.appendChild(el('span', autoLabel(it.auto), 'lab-tag'));
          if (it.remarks) {
            var r = el('div', 'Teacher remarks: ' + it.remarks, 'lab-meta');
            box.parentNode.insertBefore(r, box.nextSibling);
          }
        });
      }, function () { /* status overlay is best-effort */ });
    }, function (err) {
      head.textContent = '';
      if (err && err.status === 404) {
        flash('No set with that code.', 'error');
        return;
      }
      apiError(err, 'Set failed to load');
    });
  }

  // ---- manual (inline, student slice) ----
  function renderManual() {
    clear(root);
    flash('');
    var s = session();
    if (!s) { window.location.replace('login.html'); return; }
    if (!window.EduCADLabManual) {
      window.location.href = 'manual.html';
      return;
    }
    window.EduCADLabManual.show(root, 'student');
  }

  // ---- routing ----
  function route() {
    var h = String(window.location.hash || '').replace(/^#/, '');
    if (h === 'manual') {
      renderManual();
      return;
    }
    if (h.indexOf('class/') === 0 && h.length > 6) {
      renderClass(decodeURIComponent(h.slice(6)));
      return;
    }
    if (h.indexOf('set/') === 0 && h.length > 4) {
      renderSet(decodeURIComponent(h.slice(4)));
      return;
    }
    renderHome();
  }
  window.addEventListener('hashchange', route);
  if (window.EduCADLabManual) window.EduCADLabManual.wireNav();
  route();
})();

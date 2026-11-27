    (function setsUI() {
      if (!window.educadClassroom) return;
      if (typeof window.EduCADSaves === 'undefined') return;
      var Saves = window.EduCADSaves;
      function $(id) { return document.getElementById(id); }
      function table() {
        var h = window.educadHandle;
        return (h && h.table) || null;
      }
      function fi() { return window.fetch.bind(window); }
      var statusEl = $('save-status');
      function status(msg) { if (statusEl) statusEl.textContent = msg || ''; }
      function stamp() {
        var d = new Date();
        function p(x) { return (x < 10 ? '0' : '') + x; }
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      }
      function fail(msg) {
        return function (err) {
          status(msg + (err && err.message ? ': ' + err.message : ''));
        };
      }

      var panel = $('sets-panel');
      if (!panel) return;
      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        panel.addEventListener(t, function (e) { e.stopPropagation(); });
      });
      function hidePanel() { panel.hidden = true; }
      function hideDrawings() {
        var d = $('drawings-panel');
        if (d) d.hidden = true;
      }

      function el(tag, text, css, cls) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined && text !== null) e.textContent = text;
        if (css) {
          var st = e.style;
          Object.keys(css).forEach(function (k) { st[k] = css[k]; });
        }
        return e;
      }
      function btn(label, fn, opt) {
        var b = document.createElement('button');
        b.className = (opt && opt.link) ? 'cf-link' : 'demo-btn';
        b.type = 'button';
        b.textContent = label;
        if (opt && opt.marginRight) b.style.marginRight = opt.marginRight;
        b.addEventListener('click', fn);
        return b;
      }
      function textInput(placeholder, value) {
        var i = document.createElement('input');
        i.type = 'text';
        i.placeholder = placeholder || '';
        i.value = value || '';
        return i;
      }
      function areaInput(placeholder, rows) {
        var a = document.createElement('textarea');
        a.placeholder = placeholder || '';
        a.rows = rows || 2;
        return a;
      }
      function clearPanel() {
        while (panel.firstChild) panel.removeChild(panel.firstChild);
      }
      function header(titleText) {
        var head = el('div', null, null, 'cf-title');
        head.appendChild(document.createTextNode(titleText + ' '));
        head.appendChild(btn('×', hidePanel, { link: true }));
        panel.appendChild(head);
      }
      function fmtDate(ts) {
        try {
          return new Date(ts * 1000).toLocaleString();
        } catch (err) {
          return '';
        }
      }
      function deselectAll() {
        var h = window.educadHandle;
        if (h && h.sel && window.EduCADCanvas &&
            typeof window.EduCADCanvas.deselect === 'function') {
          try { window.EduCADCanvas.deselect(h.sel); } catch (err) {}
        }
      }

      function loadOntoSheet(data, what) {
        var t = table();
        if (!t || !window.EduCADEntities) {
          status('Sheet not ready.');
          return 0;
        }
        var count = window.educadReplaceSheet(data);
        if (typeof window.educadNoteDrawing === 'function') {
          window.educadNoteDrawing(null, '');
        }
        deselectAll();
        status(what + ' (' + count + ' entities) ' + stamp());
        return count;
      }

      var draft = [];
      function isTeacherRole(s) {
        return s && (s.role === 'teacher' || s.role === 'academics');
      }


      function teacherHome(s) {
        clearPanel();
        header('Question sets');
        panel.appendChild(el('div', 'New open set', { marginTop: '6px' }, 'cf-section'));
        panel.appendChild(el('div', 'Open sets are available to any student with the code.', null, 'cf-muted'));
        var studioLink = document.createElement('a');
        studioLink.href = 'teacher.html'; studioLink.className = 'cf-link';
        studioLink.textContent = 'Create a class set in Studio'; panel.appendChild(studioLink);
        var codeIn = textInput('Set code, e.g. geo-101');
        var titleIn = textInput('Title, e.g. Projections 1');
        panel.appendChild(codeIn);
        panel.appendChild(titleIn);
        var draftBox = el('div');
        panel.appendChild(draftBox);
        function renderDraft() {
          while (draftBox.firstChild) draftBox.removeChild(draftBox.firstChild);
          draft.forEach(function (q, i) {
            var row = el('div', null,
              null, 'cf-row');
            row.appendChild(el('div', 'Q' + (i + 1) + ': ' + q.prompt));
            if (q.hint) {
              row.appendChild(el('div', 'Hint: ' + q.hint,
                null, 'cf-muted'));
            }
            if (q.starter) {
              row.appendChild(el('div',
                'Starter: ' + (q.starter.entities || []).length + ' entities',
                null, 'cf-muted'));
            }
            if (q.model) {
              row.appendChild(el('div',
                'Model: ' + (q.model.entities || []).length + ' entities · auto-check ' +
                (q.check_enabled === false ? 'off' : 'on') +
                (q.model3d ? ' · 3D preview ' + (q.show_3d === false ? 'off' : 'on')
                  : ' · no 3D preview'),
                null, 'cf-muted'));
            }
            var rm = btn('Remove', function () {
              draft.splice(i, 1);
              renderDraft();
            });
            rm.style.marginTop = '4px';
            row.appendChild(rm);
            draftBox.appendChild(row);
          });
        }
        renderDraft();
        var promptIn = areaInput('Question prompt', 2);
        var hintIn = textInput('Hint (optional)');
        panel.appendChild(promptIn);
        panel.appendChild(hintIn);
        var starterWrap = el('label', null, { display: 'block', marginTop: '4px' });
        var starterBox = document.createElement('input');
        starterBox.type = 'checkbox';
        starterWrap.appendChild(starterBox);
        starterWrap.appendChild(
          document.createTextNode(' Attach current sheet as starter'));
        panel.appendChild(starterWrap);
        var modelWrap = el('label', null, { display: 'block', marginTop: '4px' });
        var modelBox = document.createElement('input');
        modelBox.type = 'checkbox';
        modelWrap.appendChild(modelBox);
        modelWrap.appendChild(
          document.createTextNode(' Attach current sheet as model answer (2D never shown to students)'));
        panel.appendChild(modelWrap);
        var checkWrap = el('label', null, { display: 'block', marginTop: '4px' });
        var checkBox = document.createElement('input');
        checkBox.type = 'checkbox';
        checkBox.checked = true;
        checkWrap.appendChild(checkBox);
        checkWrap.appendChild(
          document.createTextNode(' Auto-check against the model (strict pass/fail)'));
        panel.appendChild(checkWrap);
        var showWrap = el('label', null, { display: 'block', marginTop: '4px' });
        var showBox = document.createElement('input');
        showBox.type = 'checkbox';
        showBox.checked = true;
        showWrap.appendChild(showBox);
        showWrap.appendChild(
          document.createTextNode(' Show 3D preview to students (reference for drawing the views)'));
        panel.appendChild(showWrap);
        var bulkIn = areaInput('Bulk: one question per block, blank line between. "Hint:" lines become hints.', 3);
        panel.appendChild(bulkIn);
        function parseBulk(text) {
          var out = [];
          String(text || '').split(/\n\s*\n/).forEach(function (b) {
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
        var addRow = el('div', null, { marginTop: '6px' });
        addRow.appendChild(btn('Add all', function () {
          var qs = parseBulk(bulkIn.value);
          if (!qs.length) {
            status('No questions found in the bulk text.');
            return;
          }
          qs.forEach(function (q) { draft.push(q); });
          bulkIn.value = '';
          status(qs.length + ' question(s) added to the draft.');
          renderDraft();
        }, { marginRight: '6px' }));
        addRow.appendChild(btn('Add question', function () {
          var prompt = promptIn.value.trim();
          if (!prompt) {
            status('Question prompt cannot be empty.');
            return;
          }
          var q = { prompt: prompt };
          if (hintIn.value.trim()) q.hint = hintIn.value.trim();
          if (starterBox.checked) {
            var t = table();
            if (!t) {
              status('Sheet not ready.');
              return;
            }
            try {
              q.starter = Saves.snapshotTable(t);
            } catch (err) {
              status('Starter snapshot failed.');
              return;
            }
          }
          if (modelBox.checked) {
            var mt = table();
            if (!mt) {
              status('Sheet not ready.');
              return;
            }
            try {
              q.model = Saves.snapshotTable(mt);
              q.check_enabled = checkBox.checked;
              q.show_3d = showBox.checked;
              if (typeof EduCADRef3d !== 'undefined' &&
                  typeof EduCADReconstruct !== 'undefined') {
                var pv = EduCADRef3d.buildPreview((q.model.entities || []),
                  EduCADReconstruct);
                if (pv) q.model3d = pv;
              }
            } catch (err) {
              status('Model snapshot failed.');
              return;
            }
          }
          draft.push(q);
          promptIn.value = '';
          hintIn.value = '';
          starterBox.checked = false;
          modelBox.checked = false;
          renderDraft();
        }, { marginRight: '6px' }));
        addRow.appendChild(btn('Create set', function () {
          var code = codeIn.value.trim();
          var title = titleIn.value.trim() || 'Untitled set';
          if (!draft.length) {
            status('Add at least one question first.');
            return;
          }
          Saves.createSet(fi(), s, code, title, draft).then(function (data) {
            draft = [];
            codeIn.value = '';
            titleIn.value = '';
            status('Set ' + data.code + ' posted ' + stamp());
            teacherHome(s);
          }, fail('Create failed'));
        }));
        panel.appendChild(addRow);
        panel.appendChild(el('div', 'My sets', null, 'cf-section'));
        var listBox = el('div', 'Loading…');
        panel.appendChild(listBox);
        Saves.listSets(fi(), s).then(function (data) {
          while (listBox.firstChild) listBox.removeChild(listBox.firstChild);
          var sets = data.sets || [];
          if (!sets.length) {
            listBox.appendChild(el('div', 'No sets yet.'));
            return;
          }
          sets.forEach(function (it) {
            var row = el('div', null,
              null, 'cf-row');
            row.appendChild(el('div', it.code + ' — ' + (it.title || 'Untitled'),
              null, 'cf-name'));
            row.appendChild(el('div',
              it.nquestions + ' question(s) · ' + fmtDate(it.created_at),
              null, 'cf-muted'));
            var br = el('div', null, { marginTop: '4px' });
            br.appendChild(btn('Open', function () {
              teacherSetDetail(s, it.code);
            }, { marginRight: '6px' }));
            br.appendChild(btn('Delete', function () {
              if (!window.confirm('Delete set "' + it.code +
                  '" and all its submissions?')) {
                return;
              }
              Saves.deleteSet(fi(), s, it.code).then(function () {
                status('Set ' + it.code + ' deleted.');
                teacherHome(s);
              }, fail('Delete failed'));
            }));
            row.appendChild(br);
            listBox.appendChild(row);
          });
        }, function (err) {
          listBox.textContent = 'Load failed' +
            (err && err.message ? ': ' + err.message : '');
        });
      }

      function teacherSetDetail(s, code) {
        clearPanel();
        header('Set ' + code);
        var back = btn('Back', function () { teacherHome(s); });
        back.style.margin = '6px 0';
        panel.appendChild(back);
        var body = el('div', 'Loading…');
        panel.appendChild(body);
        function verdictTag(v) {
          if (v === 'pass') return ' [PASS]';
          if (v === 'fail') return ' [FAIL]';
          return ' [ungraded]';
        }
        function autoTag(a) {
          if (!a || !a.checked) return ' auto: off';
          return a.pass ? ' auto: PASS' : ' auto: FAIL';
        }
        function gradeForm(row, sub, setCode) {
          var old = row.querySelector('.cf-gradeform');
          if (old) { row.removeChild(old); return; }
          var form = el('div', null, null, 'cf-gradeform');
          var sel = document.createElement('select');
          [['', 'Ungraded'], ['pass', 'Pass'], ['fail', 'Fail']].forEach(function (o) {
            var op = document.createElement('option');
            op.value = o[0];
            op.textContent = o[1];
            if ((sub.verdict || '') === o[0]) op.selected = true;
            sel.appendChild(op);
          });
          var rem = areaInput('Remarks for the student (optional)', 2);
          rem.value = sub.remarks || '';
          form.appendChild(sel);
          form.appendChild(rem);
          var brow = el('div', null, { marginTop: '4px' });
          brow.appendChild(btn('Save grade', function () {
            Saves.gradeSubmission(fi(), s, sub.id, sel.value, rem.value.trim())
              .then(function () {
                status('Submission #' + sub.id + ' graded ' + stamp());
                teacherSetDetail(s, setCode);
              }, fail('Grade failed'));
          }, { marginRight: '6px' }));
          brow.appendChild(btn('Cancel', function () { row.removeChild(form); }));
          form.appendChild(brow);
          row.appendChild(form);
        }
        Saves.getSet(fi(), s, code).then(function (data) {
          while (body.firstChild) body.removeChild(body.firstChild);
          body.appendChild(el('div', data.title || 'Untitled', null, 'cf-name'));
          (data.questions || []).forEach(function (q, i) {
            var qrow = el('div', null, null, 'cf-row');
            qrow.appendChild(el('div', 'Q' + (i + 1) + ': ' + q.prompt, null, 'cf-name'));
            var has = !!q.has_model;
            var has3d = !!q.has_3d;
            qrow.appendChild(el('div', has
              ? ('Model attached · auto-check ' + (q.check_enabled === false ? 'OFF' : 'ON') +
                (has3d ? ' · 3D preview ' + (q.show_3d === false ? 'OFF' : 'ON')
                  : ' · no 3D preview'))
              : 'No model answer', null, 'cf-muted'));
            var qr = el('div', null, { marginTop: '4px' });
            qr.appendChild(btn('Attach sheet as model', function (event) {
              var attachButton = event.currentTarget;
              if (attachButton.disabled) return;
              var t = table();
              if (!t) { status('Sheet not ready.'); return; }
              var snap;
              try { snap = Saves.snapshotTable(t); } catch (err) {
                status('Snapshot failed.');
                return;
              }
              if (!snap.entities.length) { status('Draw a model first. The sheet is empty.'); return; }
              if (has && !window.confirm('Replace the model for Q' + (i + 1) + ' with the current sheet?')) return;
              var extra = { show_3d: q.show_3d !== false };
              if (typeof EduCADRef3d !== 'undefined' &&
                  typeof EduCADReconstruct !== 'undefined') {
                try {
                  var pv = EduCADRef3d.buildPreview((snap.entities || []),
                    EduCADReconstruct);
                  if (pv) extra.model3d = pv;
                } catch (err) {                                }
              }
              attachButton.disabled = true;
              Saves.setQuestionModel(fi(), s, code, i, snap, extra).then(function () {
                attachButton.disabled = false;
                status('Q' + (i + 1) + ' model attached ' + stamp());
                if (body.isConnected) teacherSetDetail(s, code);
              }, function (err) { attachButton.disabled = false; fail('Attach failed')(err); });
            }, { marginRight: '6px' }));
            if (has) {
              qr.appendChild(btn('View model', function () {
                try {
                  loadOntoSheet(q.model, 'Model loaded');
                  if (typeof window.educadReviewModel === 'function') window.educadReviewModel(data, i);
                  hidePanel();
                } catch (err) {
                  status('Model data is malformed.');
                }
              }, { marginRight: '6px' }));
              qr.appendChild(btn(q.check_enabled === false ? 'Check on' : 'Check off',
                (function (idx, cur) {
                  return function () {
                    Saves.setQuestionCheck(fi(), s, code, idx, cur === false)
                      .then(function () {
                        status('Q' + (idx + 1) + ' auto-check ' +
                          (cur === false ? 'on' : 'off') + ' ' + stamp());
                        teacherSetDetail(s, code);
                      }, fail('Toggle failed'));
                  };
                })(i, q.check_enabled), { marginRight: '6px' }));
              if (has3d) {
                qr.appendChild(btn(q.show_3d === false ? '3D on' : '3D off',
                  (function (idx, cur) {
                    return function () {
                      Saves.setQuestionShow3d(fi(), s, code, idx, cur === false)
                        .then(function () {
                          status('Q' + (idx + 1) + ' 3D preview ' +
                            (cur === false ? 'on' : 'off') + ' ' + stamp());
                          teacherSetDetail(s, code);
                        }, fail('Toggle failed'));
                    };
                  })(i, q.show_3d), { marginRight: '6px' }));
              }
              qr.appendChild(btn('Clear model', (function (idx) {
                return function () {
                  if (!window.confirm('Remove the model for Q' + (idx + 1) + '?')) return;
                  Saves.clearQuestionModel(fi(), s, code, idx).then(function () {
                    status('Q' + (idx + 1) + ' model cleared.');
                    teacherSetDetail(s, code);
                  }, fail('Clear failed'));
                };
              })(i)));
            }
            qrow.appendChild(qr);
            body.appendChild(qrow);
          });
          body.appendChild(el('div', 'Submissions by question', { marginTop: '8px' }, 'cf-section'));
          var sub = el('div', 'Loading…');
          body.appendChild(sub);
          Saves.listSubmissions(fi(), s, code).then(function (sd) {
            while (sub.firstChild) sub.removeChild(sub.firstChild);
            var items = sd.submissions || [];
            if (!items.length) {
              sub.appendChild(el('div', 'No submissions yet.'));
              return;
            }
            var groups = {};
            items.forEach(function (it) {
              var k = it.question_index;
              if (!groups[k]) groups[k] = [];
              groups[k].push(it);
            });
            Object.keys(groups).map(Number).sort(function (a, b) { return a - b; })
              .forEach(function (qi) {
                var list = groups[qi];
                sub.appendChild(el('div', 'Q' + (qi + 1) + ' — ' + list.length +
                  ' submission(s)', { marginTop: '6px' }, 'cf-section'));
                list.forEach(function (it) {
                  var row = el('div', null, null, 'cf-row');
                  row.appendChild(el('div',
                    (it.name || it.username) + verdictTag(it.verdict) + autoTag(it.auto),
                    null, 'cf-name'));
                  if (it.note) row.appendChild(el('div', 'Student note: ' + it.note));
                  if (it.remarks) row.appendChild(el('div', 'Remarks: ' + it.remarks));
                  row.appendChild(el('div', fmtDate(it.created_at), null, 'cf-muted'));
                  var br = el('div', null, { marginTop: '4px' });
                  br.appendChild(btn('Inspect on sheet', function () {
                    if (!window.confirm('Load this submission onto the sheet? ' +
                        'The current sheet will be replaced.')) {
                      return;
                    }
                    Saves.getSubmission(fi(), s, it.id).then(function (full) {
                      try {
                        loadOntoSheet(full.data, 'Submission loaded');
                        hidePanel();
                      } catch (err) {
                        status('Submission data is malformed.');
                      }
                    }, fail('Inspect failed'));
                  }, { marginRight: '6px' }));
                  br.appendChild(btn('Grade', function () {
                    gradeForm(row, it, code);
                  }));
                  row.appendChild(br);
                  sub.appendChild(row);
                });
              });
          }, function (err) {
            sub.textContent = 'Load failed' +
              (err && err.message ? ': ' + err.message : '');
          });
        }, fail('Load failed'));
      }


      function studentHome(s) {
        clearPanel();
        header('Question sets');
        panel.appendChild(el('div', 'Open a set by code', { marginTop: '6px' }, 'cf-section'));
        var codeIn = textInput('Set code, e.g. geo-101');
        panel.appendChild(codeIn);
        var open = btn('Open', function () {
          var code = codeIn.value.trim();
          if (!code) {
            status('Enter a set code first.');
            return;
          }
          studentSetDetail(s, code);
        });
        open.style.marginTop = '6px';
        panel.appendChild(open);
        panel.appendChild(el('div', 'My submissions', null, 'cf-section'));
        var mine = el('div', 'Loading…');
        panel.appendChild(mine);
        Saves.listMySubmissions(fi(), s).then(function (data) {
          while (mine.firstChild) mine.removeChild(mine.firstChild);
          var items = data.submissions || [];
          if (!items.length) {
            mine.appendChild(el('div', 'Nothing submitted yet.'));
            return;
          }
          items.forEach(function (it) {
            var row = el('div', null,
              null, 'cf-row');
            var tag = '';
            if (it.verdict === 'pass') tag = ' [PASS]';
            else if (it.verdict === 'fail') tag = ' [FAIL]';
            if (it.auto && it.auto.checked) tag += it.auto.pass ? ' auto: PASS' : ' auto: FAIL';
            row.appendChild(el('div',
              it.set_code + ' · Q' + (it.question_index + 1) + tag,
              null, 'cf-name'));
            if (it.remarks) row.appendChild(el('div', 'Teacher: ' + it.remarks));
            row.appendChild(el('div', fmtDate(it.created_at),
              null, 'cf-muted'));
            var rel = btn('Reload', function () {
              if (!window.confirm('Load your submission onto the sheet? ' +
                  'The current sheet will be replaced.')) {
                return;
              }
              Saves.getSubmission(fi(), s, it.id).then(function (full) {
                try {
                  loadOntoSheet(full.data, 'Submission loaded');
                  hidePanel();
                } catch (err) {
                  status('Submission data is malformed.');
                }
              }, fail('Reload failed'));
            });
            rel.style.marginTop = '4px';
            row.appendChild(rel);
            mine.appendChild(row);
          });
        }, function (err) {
          mine.textContent = 'Load failed' +
            (err && err.message ? ': ' + err.message : '');
        });
      }

      function studentSetDetail(s, code) {
        clearPanel();
        header('Set ' + code);
        var back = btn('Back', function () { studentHome(s); });
        back.style.margin = '6px 0';
        panel.appendChild(back);
        var body = el('div', 'Loading…');
        panel.appendChild(body);
        Saves.getSet(fi(), s, code).then(function (data) {
          while (body.firstChild) body.removeChild(body.firstChild);
          body.appendChild(el('div', data.title || 'Untitled', null, 'cf-name'));
          if (data.owner) {
            body.appendChild(el('div', 'By ' + data.owner,
              null, 'cf-muted'));
          }
          (data.questions || []).forEach(function (q, i) {
            var row = el('div', null,
              null, 'cf-row');
            row.appendChild(el('div', 'Q' + (i + 1) + ': ' + q.prompt,
              null, 'cf-name'));
            var checkNote = el('div', null, { marginTop: '2px' }, 'cf-muted');
            if (q.has_model && q.check_enabled !== false) {
              checkNote.textContent = 'Strict auto-check is on: Verify tells pass/fail only.';
            } else if (q.has_model) {
              checkNote.textContent = 'Auto-check is off for this question.';
            } else {
              checkNote.textContent = 'No auto-check for this question.';
            }
            row.appendChild(checkNote);
            if (q.model3d) {
              row.appendChild(el('div',
                '3D reference available: it appears beside the sheet while solving.',
                { marginTop: '2px' }, 'cf-muted'));
            }
            var verdictLine = el('div', null, { marginTop: '2px' });
            verdictLine.hidden = true;
            row.appendChild(verdictLine);
            function showAuto(auto) {
              verdictLine.hidden = false;
              while (verdictLine.firstChild) verdictLine.removeChild(verdictLine.firstChild);
              if (!auto || !auto.checked) {
                verdictLine.textContent = 'Auto-check unavailable for this question.';
                return;
              }
              var d = auto.details || {};
              var msg = auto.pass ? 'AUTO-CHECK: PASS ✓' : 'AUTO-CHECK: FAIL ✗';
              if (d.matched !== undefined) {
                msg += ' — ' + d.matched + '/' + d.model_count + ' matched';
                if (d.missing) msg += ', ' + d.missing + ' missing';
                if (d.extra) msg += ', ' + d.extra + ' extra';
              }
              if (typeof auto.score === 'number') {
                msg += ' (score ' + Math.round(auto.score * 100) + '%)';
              }
              verdictLine.textContent = msg;
            }
            if (q.hint) {
              var hintBtn = btn('Hint', function () {
                hintText.hidden = !hintText.hidden;
              }, { link: true });
              hintBtn.style.marginTop = '4px';
              row.appendChild(hintBtn);
              var hintText = el('div', q.hint,
                { marginTop: '2px' }, 'cf-muted');
              hintText.hidden = true;
              row.appendChild(hintText);
            }
            var br = el('div', null, { marginTop: '4px' });
            if (q.starter) {
              br.appendChild(btn('Load starter', function () {
                if (!window.confirm('Load the starter onto the sheet? ' +
                    'The current sheet will be replaced.')) {
                  return;
                }
                try {
                  loadOntoSheet(q.starter, 'Starter loaded');
                } catch (err) {
                  status('Starter data is malformed.');
                }
              }, { marginRight: '6px' }));
            }
            if (q.has_model && q.check_enabled !== false) {
              br.appendChild(btn('Verify my sheet', function () {
                var t = table();
                if (!t) {
                  status('Sheet not ready.');
                  return;
                }
                var snap;
                try {
                  snap = Saves.snapshotTable(t);
                } catch (err) {
                  status('Snapshot failed.');
                  return;
                }
                status('Verifying Q' + (i + 1) + '…');
                Saves.verifySolution(fi(), s, code, i, snap).then(function (r) {
                  showAuto(r);
                  if (!r.checked) {
                    status('Q' + (i + 1) + ': auto-check unavailable.');
                  } else if (r.pass) {
                    status('Q' + (i + 1) + ': AUTO-CHECK PASS ✓ ' + stamp());
                  } else {
                    status('Q' + (i + 1) + ': AUTO-CHECK FAIL ✗ — ' +
                      'the model stays hidden; fix your drawing and verify again. ' +
                      stamp());
                  }
                }, fail('Verify failed'));
              }, { marginRight: '6px' }));
            }
            if (q.model3d) {
              br.appendChild(btn('Reference 3D', (function (qq, idx) {
                return function () {
                  if (window.educadRef3d) {
                    window.educadRef3d.show(code, idx, qq.model3d);
                  } else {
                    status('Reference 3D is unavailable.');
                  }
                };
              })(q, i), { marginRight: '6px' }));
            }
            br.appendChild(btn('Submit my sheet', function () {
              var t = table();
              if (!t) {
                status('Sheet not ready.');
                return;
              }
              var snap;
              try {
                snap = Saves.snapshotTable(t);
              } catch (err) {
                status('Snapshot failed.');
                return;
              }
              var note = window.prompt('Note for your teacher (optional):', '');
              if (note === null) return;
              Saves.submitSolution(fi(), s, code, i, snap, note || '').then(function (r) {
                showAuto(r && r.auto);
                if (r && r.auto && r.auto.checked && !r.auto.pass) {
                  status('Submitted Q' + (i + 1) + ' — AUTO-CHECK FAIL ✗ ' + stamp());
                } else if (r && r.auto && r.auto.checked) {
                  status('Submitted Q' + (i + 1) + ' — AUTO-CHECK PASS ✓ ' + stamp());
                } else {
                  status('Submitted Q' + (i + 1) + ' ' + stamp());
                }
              }, fail('Submit failed'));
            }));
            row.appendChild(br);
            body.appendChild(row);
          });
        }, function (err) {
          body.textContent = (err && err.status === 404)
            ? 'No set with that code.'
            : 'Load failed' + (err && err.message ? ': ' + err.message : '');
        });
      }

      var setsBtn = $('btn-sets');
      if (setsBtn) setsBtn.addEventListener('click', function () {
        var s = Saves.currentSession();
        if (Saves.isGuest(s)) {
          status('Log in to use question sets (guest is local-only).');
          return;
        }
        if (!panel.hidden) {
          hidePanel();
          return;
        }
        hideDrawings();
        panel.hidden = false;
        if (isTeacherRole(s)) teacherHome(s);
        else studentHome(s);
      });
    })();

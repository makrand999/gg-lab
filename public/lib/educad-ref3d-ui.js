    (function ref3dCard() {
      var CARD_ID = 'ref3d-card';
      var SIZE = 220;
      var widget = null;

      function hide() {
        if (widget && typeof widget.dispose === 'function') {
          try { widget.dispose(); } catch (err) {                    }
        }
        widget = null;
        var card = document.getElementById(CARD_ID);
        if (card && card.parentNode) card.parentNode.removeChild(card);
      }

      function show(code, qi, preview) {
        hide();
        if (typeof EduCADSolid === 'undefined' ||
            typeof EduCADSolid.mountSolidWidget !== 'function' ||
            typeof EduCADSolid.setGeometry !== 'function' ||
            typeof EduCADSolid.setUnavailable !== 'function') {
          return false;
        }
        var okPreview = !!(preview && preview.status === 'ok');
        if (typeof EduCADRef3d !== 'undefined' &&
            !EduCADRef3d.validPreview(preview)) {
          okPreview = false;
          preview = { status: 'unavailable', reason: 'preview-failed',
            label: 'Reference 3D data is unreadable.' };
        }
        var card = document.createElement('div');
        card.id = CARD_ID;
        card.style.position = 'fixed';
        card.style.right = '12px';
        card.style.bottom = '12px';
        card.style.zIndex = '55';
        card.style.background = '#fff';
        card.style.border = '1px solid #b9b9b9';
        card.style.borderRadius = '6px';
        card.style.boxShadow = '0 4px 16px rgba(0,0,0,0.12)';
        card.style.padding = '8px 10px 10px';
        card.style.fontFamily = 'Verdana, Geneva, Tahoma, sans-serif';
        card.style.fontSize = '12px';
        card.style.color = '#222';
        var head = document.createElement('div');
        head.style.display = 'flex';
        head.style.justifyContent = 'space-between';
        head.style.alignItems = 'center';
        head.style.fontWeight = 'bold';
        head.style.marginBottom = '6px';
        var title = document.createElement('span');
        title.textContent = 'Reference 3D · ' + code + ' Q' + (qi + 1);
        var x = document.createElement('button');
        x.type = 'button';
        x.textContent = '\u00d7';
        x.title = 'Hide reference 3D';
        x.style.border = 'none';
        x.style.background = 'none';
        x.style.cursor = 'pointer';
        x.style.fontSize = '16px';
        x.style.color = '#222';
        x.addEventListener('click', hide);
        head.appendChild(title);
        head.appendChild(x);
        card.appendChild(head);
        if (okPreview && (preview.determination === 'partial' || preview.geometry.topologyStatus === 'partial')) {
          var note = document.createElement('div');
          note.setAttribute('role', 'status');
          note.style.maxWidth = SIZE + 'px';
          note.style.marginBottom = '6px';
          note.style.fontSize = '11px';
          note.style.color = '#795000';
          note.textContent = 'Partial reference: ' + (preview.label || 'Some drawing geometry remains unresolved.');
          card.appendChild(note);
        }
        var host = document.createElement('div');
        host.style.position = 'relative';
        host.style.width = SIZE + 'px';
        host.style.height = SIZE + 'px';
        card.appendChild(host);
        var foot = document.createElement('div');
        foot.style.color = '#777';
        foot.style.fontSize = '11px';
        foot.style.marginTop = '6px';
        foot.textContent =
          'Draw the 2D views from this shape · drag orbits · wheel zooms';
        card.appendChild(foot);
        document.body.appendChild(card);
        try {
          widget = EduCADSolid.mountSolidWidget(host, { size: SIZE, x: 0, y: 0 });
          if (widget && widget.el && widget.el.style) {



            widget.el.style.position = 'absolute';
            widget.el.style.left = '0px';
            widget.el.style.top = '0px';
          }
          if (widget && widget.handle && widget.handle.style) {
            widget.handle.style.display = 'none';
          }
          if (okPreview) EduCADSolid.setGeometry(widget, preview.geometry);
          else EduCADSolid.setUnavailable(widget, preview.reason, preview.label);
        } catch (err) {
          hide();
          return false;
        }
        return true;
      }

      window.educadRef3d = { show: show, hide: hide };
    })();

    (function deepLink() {
      if (!window.educadClassroom) return;
      if (typeof window.EduCADSaves === 'undefined') return;
      var Saves = window.EduCADSaves;
      function $(id) { return document.getElementById(id); }
      function params() {
        var out = {};
        var q = String(window.location.search || '').replace(/^\?/, '');
        q.split('&').forEach(function (kv) {
          if (!kv) return;
          var i = kv.indexOf('=');
          var k = i === -1 ? kv : kv.slice(0, i);
          var v = i === -1 ? '' : kv.slice(i + 1);
          try {
            out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
          } catch (err) {                                 }
        });
        return out;
      }
      function table() {
        var h = window.educadHandle;
        return (h && h.table) || null;
      }
      function setMode(mode) {
        if (typeof window.educadSetSheetMode === 'function') {
          window.educadSetSheetMode(mode);
          return;
        }
        var b = $(mode === 'view' ? 'btn-mode-view' : 'btn-mode-edit');
        if (b && b.click) b.click();
      }
      var statusEl = $('save-status');
      function status(msg) { if (statusEl) statusEl.textContent = msg || ''; }
      function mobileTitle(t) {
        if (typeof window.educadMobileTitle === 'function') window.educadMobileTitle(t);
      }
      function fmtDate(ts) {
        try { return new Date(ts * 1000).toLocaleString(); }
        catch (err) { return ''; }
      }
      function loadOntoSheet(data) {
        var t = table();
        if (!t || !window.EduCADEntities) {
          status('Sheet not ready.');
          return -1;
        }
        var count = window.educadReplaceSheet(data);
        if (typeof window.educadNoteDrawing === 'function') {
          window.educadNoteDrawing(null, '');
        }
        var h = window.educadHandle;
        if (h && h.sel && window.EduCADCanvas &&
            typeof window.EduCADCanvas.deselect === 'function') {
          try { window.EduCADCanvas.deselect(h.sel); } catch (err) {}
        }
        return count;
      }



      function modelReviewActions(data, index) {
        var home = $('btn-home');
        if (home) {
          home.href = 'teacher.html#set/' + encodeURIComponent(data.code);
          home.title = 'Return to ' + data.code + ' Q' + (index + 1);
        }
        var old = $('btn-attach-reviewed-model');
        if (old) old.remove();
        var button = document.createElement('button');
        button.type = 'button'; button.id = 'btn-attach-reviewed-model'; button.className = 'demo-btn';
        button.textContent = 'Attach model to Q' + (index + 1);
        button.title = 'Attach the reviewed sheet to ' + data.code + ' Q' + (index + 1);
        button.addEventListener('click', function () {
          if (button.disabled) return;
          var active = Saves.currentSession();
          if (!active || active.token !== s.token || (active.role !== 'teacher' && active.role !== 'academics')) {
            status('Your session changed. Reopen this question from the studio.'); return;
          }
          var snapshot;
          try { snapshot = Saves.snapshotTable(table()); } catch (err) { status('Sheet not ready.'); return; }
          if (!snapshot.entities.length) { status('Draw a model before attaching it. The sheet is empty.'); return; }
          button.disabled = true;
          Saves.getSet(fi, active, data.code).then(function (latest) {
            var question = (latest.questions || [])[index];
            if (!question) throw new Error('This question is no longer available.');
            if (question.has_model && !window.confirm('Replace the model for ' + data.code + ' Q' + (index + 1) + ' with the reviewed sheet?')) return false;
            var current = Saves.currentSession();
            if (!current || current.token !== active.token || current.role !== active.role) throw new Error('Your session changed. Reopen the question from the studio.');
            var extra = { show_3d: question.show_3d !== false };
            if (window.EduCADRef3d && window.EduCADReconstruct) {
              try {
                var preview = window.EduCADRef3d.buildPreview(snapshot.entities, window.EduCADReconstruct);
                if (preview) extra.model3d = preview;
              } catch (err) {                                                      }
            }
            status('Attaching model to ' + data.code + ' Q' + (index + 1) + '…');
            return Saves.setQuestionModel(fi, active, data.code, index, snapshot, extra).then(function () { return true; });
          }).then(function (attached) {
            button.disabled = false;
            if (attached) status('Model attached to ' + data.code + ' Q' + (index + 1) + '. Auto-check is on. Return to Studio to review.');
          }, function (err) {
            button.disabled = false; status('Model could not be attached: ' + err.message + '. Your drawing is kept on the sheet.');
          });
        });
        var sets = $('btn-sets');
        if (sets && sets.parentNode) sets.parentNode.insertBefore(button, sets);
      }

      var p = params();
      var s = Saves.currentSession();
      if (s && (s.role === 'teacher' || s.role === 'academics')) window.educadReviewModel = modelReviewActions;
      if (Saves.isGuest(s)) {
        if (p.submission || p.solve || p.drawing || p.model) {
          status('Log in to open shared sheets (guest is local-only).');
        }
        return;
      }
      var fi = window.fetch.bind(window);
      if (p.submission) {
        var id = parseInt(p.submission, 10);
        if (!(id > 0)) { status('Bad submission link.'); return; }
        Saves.getSubmission(fi, s, id).then(function (full) {
          var count;
          try {
            count = loadOntoSheet(full.data);
          } catch (err) {
            status('Submission data is malformed.');
            return;
          }
          if (count < 0) return;
          var label = (full.name || full.username || 'Submission') + ' · ' +
            (full.set_code || 'set') + ' Q' + ((full.question_index || 0) + 1);
          if (s.role === 'teacher' || s.role === 'academics') {
            setMode('view');
            status(label + ' · ' + fmtDate(full.created_at) + ' (view only)');
          } else {
            setMode('edit');
            status(label + ' loaded as an editable copy.');
          }
          mobileTitle(label);
        }, function (err) {
          status('Submission failed to load' +
            (err && err.message ? ': ' + err.message : ''));
        });
        return;
      }
      if (p.solve) {
        var qi = parseInt(p.q || '0', 10);
        if (!(qi >= 0)) qi = 0;
        Saves.getSet(fi, s, p.solve).then(function (data) {
          var qs = data.questions || [];
          if (qi >= qs.length) { status('No such question.'); return; }
          var q = qs[qi];
          setMode('edit');
          if (q.starter) {
            var count;
            try {
              count = loadOntoSheet(q.starter);
            } catch (err) {
              status('Starter data is malformed.');
              return;
            }
            if (count < 0) return;
          }
          var solveNote = q.starter ? ' (starter loaded)' : '';
          if (q.model3d && window.educadRef3d &&
              window.educadRef3d.show(p.solve, qi, q.model3d)) {
            solveNote += ' · reference 3D shown — draw the views from it';
          }
          status('Q' + (qi + 1) + ': ' + q.prompt + solveNote);
        }, function (err) {
          status('Set failed to load' +
            (err && err.message ? ': ' + err.message : ''));
        });
        return;
      }
      if (p.model) {
        if (s.role !== 'teacher' && s.role !== 'academics') {
          status('Model answers are hidden from students.');
          return;
        }
        var mqi = parseInt(p.q || '0', 10);
        if (!(mqi >= 0)) mqi = 0;
        Saves.getSet(fi, s, p.model).then(function (data) {
          var qs = data.questions || [];
          if (mqi >= qs.length || (!qs[mqi].model && !p.autodraw)) {
            status('No model answer for that question.');
            return;
          }
          if (p.autodraw) {
            var aq = qs[mqi];
            var words = aq.prompt + (aq.hint ? ' Hint: ' + aq.hint : '');
            setMode('edit');
            status('Auto-drawing the model for ' + p.model + ' Q' + (mqi + 1) + '…');
            if (typeof window.educadAutoDraw !== 'function') {
              status('Auto-draw is unavailable (command line did not load).');
              return;
            }
            window.educadAutoDraw(words, true).then(function (res) {
              if (res.ok) modelReviewActions(data, mqi);
              status(res.ok ?
                ('Model drafted for ' + p.model + ' Q' + (mqi + 1) +
                  ' — review it, then use Attach model to Q' + (mqi + 1) + '.') :
                ('Auto-draw could not finish: ' + res.message));
            });
            return;
          }
          var count;
          try {
            count = loadOntoSheet(qs[mqi].model);
          } catch (err) {
            status('Model data is malformed.');
            return;
          }
          if (count < 0) return;
          setMode('edit');
          modelReviewActions(data, mqi);
          status('Model for ' + p.model + ' Q' + (mqi + 1) +
            ' loaded as an editable copy (' + count + ' entities). ' +
            'Review your changes, then use Attach model to Q' + (mqi + 1) + '.');
          mobileTitle('Model ' + p.model + ' Q' + (mqi + 1));
        }, function (err) {
          status('Set failed to load' +
            (err && err.message ? ': ' + err.message : ''));
        });
        return;
      }
      if (p.drawing) {
        var did = parseInt(p.drawing, 10);
        if (!(did > 0)) { status('Bad drawing link.'); return; }
        Saves.getDrawing(fi, s, did).then(function (data) {
          var count;
          try {
            count = loadOntoSheet(data.data);
          } catch (err) {
            status('Drawing data is malformed.');
            return;
          }
          if (count < 0) return;
          if (typeof window.educadNoteDrawing === 'function') {
            window.educadNoteDrawing(data.id, data.title);
          }
          setMode('edit');
          status('Opened "' + (data.title || 'Untitled') + '" (' +
            count + ' entities)');
        }, function (err) {
          status('Drawing failed to load' +
            (err && err.message ? ': ' + err.message : ''));
        });
      }
    })();

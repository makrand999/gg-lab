    (function savesUI() {
      if (typeof window.EduCADSaves === 'undefined') return;
      var Saves = window.EduCADSaves;
      var Local = window.EduCADLocalDrawings || null;
      var classroom = !!window.educadClassroom;
      function $(id) { return document.getElementById(id); }
      function table() {
        var h = window.educadHandle;
        return (h && h.table) || null;
      }
      function storeMessage(err) {
        return (err && err.message) || 'Browser drawing storage is unavailable.';
      }
      function fail(msg) {
        return function (err) {
          status(msg + (err && err.message ? ': ' + err.message : ''));
        };
      }
      function localFail(msg) {
        return function (err) { status(msg + ': ' + storeMessage(err)); };
      }

      var current = { id: null, title: '' };
      var sheetGeneration = 0;
      var localWriteInFlight = false;
      function noteSheetChange() { sheetGeneration++; }

      function deselectSheet() {
        var h = window.educadHandle;
        if (h && h.sel && window.EduCADCanvas &&
            typeof window.EduCADCanvas.deselect === 'function') {
          try { window.EduCADCanvas.deselect(h.sel); } catch (err) {}
        }
      }
      function mobileTitle(title) {
        if (typeof window.educadMobileTitle === 'function') {
          window.educadMobileTitle(title || 'Drawing');
        }
      }


      window.educadNoteDrawing = function (id, title) {
        noteSheetChange();
        current.id = id;
        current.title = title || '';
        mobileTitle(current.title || 'Drawing');
      };
      var statusEl = $('save-status');
      function status(msg) { if (statusEl) statusEl.textContent = msg || ''; }
      if (statusEl) {
        statusEl.style.fontSize = '12px';
        statusEl.style.color = '#777';
        statusEl.style.marginLeft = '6px';
      }
      function stamp() {
        var d = new Date();
        function p(x) { return (x < 10 ? '0' : '') + x; }
        return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
      }


      var t0 = table();
      if (t0 && typeof t0.subscribe === 'function') {
        t0.subscribe(function (op) {
          if (op === 'clear') {
            current.id = null;
            current.title = '';
            noteSheetChange();
          }
        });
      }

      function sheetSnapshot() {
        var t = table();
        if (!t) { status('Sheet not ready.'); return null; }
        try {
          return Saves.snapshotTable(t);
        } catch (err) {
          status('Could not read the sheet: ' + (err && err.message ? err.message : 'snapshot failed') + '.');
          return null;
        }
      }

      function saveLocal(asNew) {
        if (!Local) { status('Browser drawing storage is unavailable in this browser.'); return; }
        if (localWriteInFlight) { status('A save is already in progress.'); return; }
        var snap = sheetSnapshot();
        if (!snap) return;
        var gen = sheetGeneration;
        function associate(rec) {
          if (gen !== sheetGeneration) return;
          current.id = rec.id;
          current.title = rec.title;
          mobileTitle(rec.title);
        }
        function createNew(defaultTitle) {
          localWriteInFlight = true;
          var title = window.prompt('Drawing name:', defaultTitle || 'Untitled');
          if (title === null) { localWriteInFlight = false; return; }
          Local.create(title, snap).then(function (rec) {
            localWriteInFlight = false;
            associate(rec);
            noteSheetChange();
            status('Saved "' + rec.title + '" in this browser ' + stamp());
            if (panel && !panel.hidden) refreshPanel();
          }, function (err) {
            localWriteInFlight = false;
            localFail('Save failed')(err);
          });
        }
        if (asNew || current.id === null) {
          createNew(current.title || 'Untitled');
          return;
        }
        var id = current.id;
        localWriteInFlight = true;
        Local.update(id, { data: snap }).then(function (rec) {
          localWriteInFlight = false;
          if (gen === sheetGeneration) {
            current.title = rec.title;
            mobileTitle(rec.title);
          }
          status('Saved "' + rec.title + '" in this browser ' + stamp());
          if (panel && !panel.hidden) refreshPanel();
        }, function (err) {
          localWriteInFlight = false;
          localFail('Save failed')(err);
        });
      }

      function saveClassroom() {
        var s = Saves.currentSession();
        if (Saves.isGuest(s)) {
          status('Log in to save drawings (guest is local-only).');
          return;
        }
        var snap = sheetSnapshot();
        if (!snap) return;
        var fi = window.fetch.bind(window);
        if (current.id) {
          Saves.updateDrawing(fi, s, current.id, { data: snap }).then(function () {
            status('Saved ' + stamp());
          }, fail('Save failed'));
          return;
        }
        var title = window.prompt('Drawing title:', current.title || 'Untitled');
        if (title === null) return;
        Saves.createDrawing(fi, s, title || 'Untitled', snap).then(function (data) {
          current.id = data.id;
          current.title = title || 'Untitled';
          status('Saved ' + stamp());
        }, fail('Save failed'));
      }

      var saveBtn = $('btn-save');
      if (saveBtn) saveBtn.addEventListener('click', function () {
        if (classroom) saveClassroom();
        else saveLocal(false);
      });

      var panel = $('drawings-panel');
      function hidePanel() { if (panel) panel.hidden = true; }
      function fmtDate(ts) {
        var value = Number(ts);
        if (!isFinite(value) || value <= 0) return '';
        if (value < 1e12) value *= 1000;
        try {
          return new Date(value).toLocaleString();
        } catch (err) {
          return '';
        }
      }
      function panelHeader() {
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        var head = document.createElement('div');
        head.className = 'cf-title';
        head.appendChild(document.createTextNode('My drawings '));
        var x = document.createElement('button');
        x.className = 'cf-link';
        x.type = 'button';
        x.textContent = '×';
        x.addEventListener('click', hidePanel);
        head.appendChild(x);
        panel.appendChild(head);
      }
      function renderList(items) {
        panelHeader();
        if (!classroom) {
          var hint = document.createElement('div');
          hint.className = 'cf-muted';
          hint.textContent = 'Saved in this browser only.';
          panel.appendChild(hint);
          var actions = document.createElement('div');
          actions.className = 'cf-row';
          var saveAs = document.createElement('button');
          saveAs.className = 'demo-btn';
          saveAs.type = 'button';
          saveAs.textContent = 'Save as new...';
          saveAs.addEventListener('click', function () { saveLocal(true); });
          actions.appendChild(saveAs);
          panel.appendChild(actions);
        }
        if (!items.length) {
          var empty = document.createElement('div');
          empty.textContent = classroom ? 'No saved drawings yet.' :
            'No saved drawings in this browser yet.';
          empty.style.marginTop = '6px';
          panel.appendChild(empty);
          return;
        }
        items.forEach(function (it) {
          var row = document.createElement('div');
          row.className = 'cf-row';
          var name = document.createElement('div');
          name.textContent = it.title || 'Untitled';
          name.className = 'cf-name';
          row.appendChild(name);
          var when = document.createElement('div');
          when.textContent = (it.when || fmtDate(it.updatedAt || it.updated_at)) +
            (it.entities ? ' · ' + it.entities + ' entities' : '');
          when.className = 'cf-muted';
          row.appendChild(when);
          var load = document.createElement('button');
          load.className = 'demo-btn';
          load.type = 'button';
          load.textContent = classroom ? 'Load' : 'Open';
          load.style.marginRight = '6px';
          load.addEventListener('click', function () { onLoad(it); });
          row.appendChild(load);
          var del = document.createElement('button');
          del.className = 'demo-btn';
          del.type = 'button';
          del.textContent = 'Delete';
          del.addEventListener('click', function () { onDelete(it); });
          row.appendChild(del);
          panel.appendChild(row);
        });
      }
      function onLocalLoad(it) {
        Local.get(it.id).then(function (rec) {
          var count;
          try {
            count = window.educadReplaceSheet(rec.data);
          } catch (err) {
            status('That drawing could not be opened: ' +
              (err && err.message ? err.message : 'unreadable data') +
              '. The sheet was not changed.');
            return;
          }
          noteSheetChange();
          current.id = rec.id;
          current.title = rec.title;
          mobileTitle(rec.title);
          deselectSheet();
          hidePanel();
          status('Opened "' + rec.title + '" (' + count + ' entities) ' + stamp());
        }, localFail('Open failed'));
      }
      function onServerLoad(it) {
        var s = Saves.currentSession();
        if (Saves.isGuest(s)) { hidePanel(); return; }
        var t = table();
        if (!t || !window.EduCADEntities) { status('Sheet not ready.'); return; }
        Saves.getDrawing(window.fetch.bind(window), s, it.id).then(function (data) {
          var count = window.educadReplaceSheet(data.data);
          noteSheetChange();
          current.id = it.id;
          current.title = data.title || '';
          mobileTitle(current.title || 'Drawing');
          deselectSheet();
          hidePanel();
          status('Loaded ' + count + ' entities ' + stamp());
        }, fail('Load failed'));
      }
      function onLoad(it) {
        if (classroom) onServerLoad(it);
        else onLocalLoad(it);
      }
      function onDelete(it) {
        if (!window.confirm('Delete "' + (it.title || 'Untitled') + '"?')) return;
        if (classroom) {
          var s = Saves.currentSession();
          if (Saves.isGuest(s)) return;
          Saves.deleteDrawing(window.fetch.bind(window), s, it.id).then(function () {
            if (current.id === it.id) { current.id = null; current.title = ''; }
            refreshPanel();
          }, fail('Delete failed'));
          return;
        }
        if (!Local) { status('Browser drawing storage is unavailable in this browser.'); return; }
        Local.remove(it.id).then(function () {
          if (current.id === it.id) { current.id = null; current.title = ''; }
          refreshPanel();
        }, localFail('Delete failed'));
      }
      function refreshPanel() {
        if (classroom) {
          var s = Saves.currentSession();
          if (Saves.isGuest(s)) {
            status('Log in to open drawings (guest is local-only).');
            return;
          }
          panel.hidden = false;
          panel.textContent = 'Loading…';
          Saves.listDrawings(window.fetch.bind(window), s).then(function (data) {
            renderList(data.drawings || []);
          }, function (err) {
            panel.textContent = 'Load failed' +
              (err && err.message ? ': ' + err.message : '');
          });
          return;
        }
        panel.hidden = false;
        if (!Local) {
          panel.textContent = 'Browser drawing storage is unavailable in this browser.';
          return;
        }
        panel.textContent = 'Loading…';
        Local.list().then(function (items) {
          renderList(items);
        }, function (err) {
          panel.textContent = 'Saved drawings are unavailable: ' + storeMessage(err);
        });
      }
      var drawingsBtn = $('btn-drawings');
      if (drawingsBtn) drawingsBtn.addEventListener('click', function () {
        if (!panel) return;
        if (panel.hidden) refreshPanel();
        else hidePanel();
      });

      var fileInput = $('drawing-file');
      function importDrawing() {
        if (!fileInput) return;
        fileInput.value = '';
        fileInput.click();
      }
      function exportDrawing() {
        var snap = sheetSnapshot();
        if (!snap) return;
        var base = String(current.title || 'EduCAD drawing')
          .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim() ||
          'EduCAD drawing';
        var url;
        try {
          url = URL.createObjectURL(new Blob([JSON.stringify(snap, null, 2)],
            { type: 'application/json' }));
        } catch (err) {
          status('Export failed: this browser cannot create the file.');
          return;
        }
        var a = document.createElement('a');
        a.href = url;
        a.download = base + '.educad.json';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        window.setTimeout(function () {
          try {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } catch (err) {}
        }, 0);
        status('Exported "' + base + '" as a drawing file ' + stamp());
      }
      if (fileInput) fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        var name = String(file.name || '')
          .replace(/\.educad\.json$/i, '').replace(/\.json$/i, '') ||
          'Imported drawing';
        file.text().then(function (text) {
          var data;
          try {
            data = JSON.parse(text);
          } catch (err) {
            throw new Error('that file is not valid JSON');
          }
          var snapshot = Saves.migrateSnapshot(data);
          var count;
          try {
            count = window.educadReplaceSheet(snapshot);
          } catch (err) {
            throw new Error((err && err.message) || 'the drawing data is unreadable');
          }
          noteSheetChange();
          current.id = null;
          current.title = name;
          mobileTitle(name);
          deselectSheet();
          status('Imported "' + name + '" (' + count + ' entities) ' + stamp());
        }).catch(function (err) {
          status('Import failed: ' +
            (err && err.message ? err.message : 'the file could not be read') +
            '. The sheet was not changed.');
        }).then(function () {
          fileInput.value = '';
        });
      });
      var importBtn = $('btn-import');
      if (importBtn) importBtn.addEventListener('click', importDrawing);
      var exportBtn = $('btn-export');
      if (exportBtn) exportBtn.addEventListener('click', exportDrawing);

      if (classroom) {
        Saves.fetchProgress().then(function (r) {
          if (r.skipped) return;
          var buttons = {
            square: 'btn-tut-square', prism: 'btn-tut-prism',
            'three-view-prism': 'btn-tut-3v-prism',
            'three-view-pyramid': 'btn-tut-3v-pyramid',
            'three-view-cylinder': 'btn-tut-3v-cylinder',
            'three-view-cone': 'btn-tut-3v-cone',
            'three-view-stepped-notch': 'btn-tut-3v-step',
            'three-view-inclined-block': 'btn-tut-3v-inclined'
          };
          (r.progress || []).forEach(function (p) {
            if (!p || !p.state || p.state.done !== true) return;
            var b = buttons[p.lesson] ? $(buttons[p.lesson]) : null;
            if (b && b.textContent.indexOf('✓') === -1) b.textContent += ' ✓';
          });
        }, function () {});
      }
    })();

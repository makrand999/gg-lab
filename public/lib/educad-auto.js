(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./educad-command.js'), require('./educad-entities.js'), require('./educad-saves.js'));
  } else root.EduCADAuto = factory(root.EduCADCommand, root.EduCADEntities, root.EduCADSaves);
})(typeof window !== 'undefined' ? window : globalThis, function (C, E, S) {
  'use strict';
  var MAX_COMMANDS = 128, MAX_ENTITIES = 4096;
  var ALLOWED = ['point', 'line', 'ray', 'xline', 'circle', 'arc', 'text',
    'dimension', 'polygon', 'polyline', 'ellipse', 'hatch', 'rename', 'delete', 'style', 'datum'];
  function fail(message) { return { ok: false, message: message, ids: [] }; }
  // Execute on a detached table. A malformed or incomplete plan never reaches the sheet.
  function stage(commands, snapshot, autoMode) {
    if (!Array.isArray(commands) || !commands.length || commands.length > MAX_COMMANDS) {
      return fail('The drawing needs 1–' + MAX_COMMANDS + ' commands.');
    }
    var table = E.createTable();
    try {
      S.restoreTable(E, table, snapshot);
      for (var i = 0; i < commands.length; i++) {
        var line = commands[i];
        if (typeof line !== 'string' || line.length > 512 || /[\x00-\x1f\x7f]/.test(line)) {
          return fail('Invalid command at step ' + (i + 1) + '.');
        }
        var parsed = C.parse(line);
        if (!parsed.ok || ALLOWED.indexOf(parsed.name) < 0) {
          return fail('Step ' + (i + 1) + ': ' + (parsed.ok ? 'This command is unavailable in generated drawings.' : parsed.message));
        }
        var result = C.execute(line, { table: table });
        if (!result.ok) return fail('Step ' + (i + 1) + ' (' + line + '): ' + result.message);
        if (table.count() > MAX_ENTITIES) return fail('The drawing exceeds ' + MAX_ENTITIES + ' entities.');
      }
      if (autoMode) {
        var pairs = Object.create(null);
        table.list().forEach(function (p) {
          if (p.type !== 'POINT' || ['PLAN', 'ELEVATION'].indexOf(p.viewRole) < 0) return;
          var base = C.displayName(p).replace(/['’′]+$/, '').toLowerCase();
          var group = pairs[base] || (pairs[base] = []);
          group.push(p);
        });
        var keys = Object.keys(pairs);
        for (var j = 0; j < keys.length; j++) {
          var group = pairs[keys[j]];
          for (var a = 0; a < group.length; a++) {
            for (var b = a + 1; b < group.length; b++) {
              if (group[a].viewRole !== group[b].viewRole && Math.abs(group[a].x - group[b].x) > 1e-6) {
                return fail('Projector "' + keys[j] + '" is misaligned: plan and elevation x must match.');
              }
            }
          }
        }
      }
      if (JSON.stringify(table.list()) === JSON.stringify(snapshot.entities)) return fail('The model made no drawing changes.');
      return { ok: true, entities: S.snapshotTable(table).entities, steps: commands.length, commands: commands.slice() };
    } catch (err) { return fail('Could not validate drawing: ' + err.message); }
  }
  // One request at a time; responses are applicable only to the unchanged editable sheet/session.
  function createRunner(options) {
    var busy = false;
    return async function (text, mode, replace) {
      if (busy) return fail('A drawing request is already running.');
      var session = options.session(), table = options.table;
      if (mode === 'auto' && (!session || ['teacher', 'academics'].indexOf(session.role) < 0)) {
        return fail('Auto-draw is a teacher tool — log in as a teacher or academic.');
      }
      if (options.readOnly()) return fail('View mode is read-only — /mode edit to draw.');
      if (typeof text !== 'string' || !text.trim()) return fail('Describe the drawing in words.');
      var token = session && session.token, role = session && session.role;
      var revision = table.revision(), before = S.snapshotTable(table);
      var modeRevision = options.modeRevision ? options.modeRevision() : 0;
      var points = replace ? {} : C.pointMap(before.entities);
      var timer;
      busy = true;
      try {
        var feedback = '', result, data;
        var deadline = Date.now() + (options.timeoutMs || 120000);
        var attempts = options.maxAttempts === 2 ? 2 : 1;
        for (var attempt = 0; attempt < attempts; attempt++) {
          try {
            data = await Promise.race([
              options.interpret(session, text, Object.keys(points), mode, points, feedback),
              new Promise(function (_, reject) {
                timer = setTimeout(function () { reject(new Error('interpret_timeout')); }, Math.max(1, deadline - Date.now()));
              })
            ]);
          } catch (err) {
            clearTimeout(timer);
            var active = options.session();
            if (attempt + 1 < attempts && err.message === 'interpret_failed' &&
                Date.now() < deadline && !options.readOnly() && revision === table.revision() &&
                (!options.modeRevision || options.modeRevision() === modeRevision) &&
                active && active.token === token && active.role === role) {
              feedback = 'The gateway did not return a complete usable response. Return a concise complete drawing plan.';
              continue;
            }
            throw err;
          }
          clearTimeout(timer);
          var current = options.session();
          if (options.readOnly() || revision !== table.revision() ||
              (options.modeRevision && options.modeRevision() !== modeRevision) ||
              !current || !session || current.token !== token || current.role !== role) {
            return fail('The sheet, mode, or session changed while drawing. Run the request again.');
          }
          if (!data || !Array.isArray(data.commands)) result = fail('The model gave an unusable drawing plan.');
          else if (!data.commands.length) {
            result = fail(data.reply || 'The model could not produce drawing steps.');
            if (!data.invalid_plan) return result; // An honest refusal needs input, not a retry.
          } else result = stage(data.commands, replace ? { entities: [] } : before, mode === 'auto');
          if (result.ok) break;
          if (attempt + 1 === attempts) return result;
          feedback = result.message.slice(0, 1000);
        }
        options.commit({ entities: result.entities });
        return { ok: true, ids: [], commands: result.commands,
          message: (mode === 'auto' ? 'Model drawn' : 'Drawn') + ' (' + result.steps + ' steps)' +
            (typeof data.reply === 'string' && data.reply ? ': ' + data.reply : '.') };
      } catch (err) { return fail(options.friendly ? options.friendly(err) : err.message); }
      finally { clearTimeout(timer); busy = false; }
    };
  }
  return { stage: stage, createRunner: createRunner, MAX_COMMANDS: MAX_COMMANDS, ALLOWED: ALLOWED };
});

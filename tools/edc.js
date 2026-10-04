'use strict';
// EduCAD Script (.edc): the command palette as a file format. One slash
// command per line, `#` comments and blank lines ignored, geometry only
// (/demo /tutorial /check /mode need the live page and are refused).
// CLI: `node tools/edc.js <file.edc>` prints a validation report and
// exits 0 (clean) or 1 (any bad line or misaligned projector).
// Module: require('./edc.js').runScript(text) for tests and agents.
var fs = require('fs');
var path = require('path');
var C = require('../mirror/files/www.geogebra.org/educad-command.js');
var E = require('../mirror/files/www.geogebra.org/educad-entities.js');
var R = require('../mirror/files/www.geogebra.org/educad-reconstruct.js');

function baseName(caption) {
  return String(caption).replace(/'+$/, '');
}

// checkProjectors(table): points sharing a base name (a/a', b/b') are
// one 3D point, so their x must match across views (Monge invariant).
function checkProjectors(table) {
  var groups = {};
  table.list().forEach(function (e) {
    if (e.type !== 'POINT') return;
    var b = baseName(e.caption || e.name);
    if (!groups[b]) groups[b] = [];
    groups[b].push(e);
  });
  var aligned = [];
  var misaligned = [];
  Object.keys(groups).forEach(function (b) {
    var g = groups[b];
    if (g.length < 2) return;
    var x0 = g[0].x;
    var bad = g.some(function (p) { return Math.abs(p.x - x0) > 1e-9; });
    if (bad) misaligned.push(b);
    else aligned.push(b);
  });
  return { aligned: aligned, misaligned: misaligned };
}

function summarize(table) {
  var byType = {};
  var roles = {};
  var hasDatum = false;
  table.list().forEach(function (e) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    roles[e.viewRole] = (roles[e.viewRole] || 0) + 1;
    if (e.type === 'DATUM_AXIS') hasDatum = true;
  });
  return { count: table.count(), byType: byType, roles: roles, hasDatum: hasDatum };
}

function runScript(text) {
  E.resetIdCounter();
  var table = E.createTable();
  var env = { table: table };
  var lines = String(text).split(/\r?\n/);
  var steps = [];
  var errors = [];
  lines.forEach(function (raw, i) {
    var line = raw.replace(/^\s+|\s+$/g, '');
    if (line === '' || line.charAt(0) === '#') return;
    var r = C.execute(line, env);
    steps.push({ n: i + 1, line: line, ok: r.ok, message: r.message });
    if (!r.ok) errors.push({ n: i + 1, line: line, message: r.message });
  });
  var proj = checkProjectors(table);
  proj.misaligned.forEach(function (b) {
    errors.push({ n: 0, line: '', message: 'Projector "' + b + '" misaligned: x differs across views.' });
  });
  var summary = summarize(table);
  // The 3D model is a pure function of the sheet: the same live
  // reconstruction the glass widget runs, headless. Representation
  // only — a script never edits the solid, it determines it.
  var solid = R.reconstructLive(table.visibleEntities());
  return {
    ok: errors.length === 0,
    steps: steps,
    errors: errors,
    projectors: proj,
    summary: summary,
    solid: solid
  };
}

function solidLine(solid) {
  if (!solid || solid.status !== 'ok' || !solid.geometry) {
    return 'solid: unavailable (' + ((solid && solid.reason) || 'unknown') + ')';
  }
  var g = solid.geometry;
  var f = Array.isArray(g.faces) ? g.faces.length : 0;
  return 'solid: ok — ' + g.vertices.length + 'V ' + g.edges.length + 'E ' + f + 'F';
}

function report(file, res) {
  var out = [];
  out.push('edc ' + file + ': ' + res.steps.length + ' steps, ' +
    res.summary.count + ' entities' + (res.ok ? ' — CLEAN' : ' — ' + res.errors.length + ' PROBLEM(S)'));
  res.errors.forEach(function (e) {
    out.push('  line ' + (e.n > 0 ? e.n : '-') + ': ' + (e.line !== '' ? e.line + ' => ' : '') + e.message);
  });
  if (!res.summary.hasDatum) out.push('  note: no XY datum on the sheet.');
  if (res.projectors.aligned.length > 0) {
    out.push('  projectors aligned: ' + res.projectors.aligned.join(', '));
  }
  var types = Object.keys(res.summary.byType).map(function (t) {
    return t + ' ' + res.summary.byType[t];
  });
  out.push('  entities: ' + (types.join(', ') || 'none'));
  out.push('  ' + solidLine(res.solid));
  return out.join('\n');
}

function main(argv) {
  var args = argv.slice(2).filter(function (a) { return a !== '--solid'; });
  var wantSolid = argv.indexOf('--solid') !== -1;
  var file = args[0];
  if (!file) {
    console.error('Usage: node tools/edc.js [--solid] <file.edc>');
    return 2;
  }
  var text;
  try {
    text = fs.readFileSync(path.resolve(file), 'utf8');
  } catch (err) {
    console.error('edc: cannot read ' + file);
    return 2;
  }
  var res = runScript(text);
  console.log(report(file, res));
  if (wantSolid) console.log(JSON.stringify(res.solid));
  return res.ok ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = {
  runScript: runScript,
  checkProjectors: checkProjectors,
  summarize: summarize,
  report: report
};

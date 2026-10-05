'use strict';
// EduCAD manual builder: docs/MANUAL.md -> public/manual.html, zero deps.
// Deterministic Markdown subset renderer for exactly the constructs used in
// the user manual: ATX headings, paragraphs, bullet/ordered lists (nested),
// tables, fenced code blocks, blockquotes, horizontal rules, and inline
// `code` / **bold** / *italic* / [text](href).
//
// Served-context link rule (only public/ is served, both by educad-server
// and by the nginx /major/ alias, so every href must stay relative):
//   - "#anchor"        -> kept unchanged (in-page navigation).
//   - "../public/..."   -> the "../public/" prefix is stripped, because the
//                          generated page lives inside public/ already.
//   - anything else starting with "../" (e.g. ../docs/..., ../tools/...) ->
//                          the target is outside the served root and would be
//                          a dead link, so the exact visible text is rendered
//                          as non-link text/code with no <a> element.
//   - anything else     -> kept unchanged.
// This rule is also stated in the generated page footer. Output is fully
// deterministic: no timestamps, no absolute paths, stable heading ids.
var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, '..', 'docs', 'MANUAL.md');
var DEST = path.join(__dirname, '..', 'public', 'manual.html');

// Inline <style>: app palette (#f8fafc / #1e293b / #0284c7), bordered
// tables, horizontally scrollable pre, ~900px max-width. No external CSS
// and no <script> anywhere: the page must work as a static file.
var CSS = [
  'body{margin:0;background:#f8fafc;color:#1e293b;',
  'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;',
  'line-height:1.6;font-size:16px}',
  '.topbar{max-width:900px;margin:0 auto;padding:16px 20px 0}',
  '.topbar a{display:inline-block;background:#fff;border:1px solid #cbd5e1;border-radius:6px;',
  'padding:6px 12px;font-size:13px;font-weight:500;color:#334155;text-decoration:none}',
  '.topbar a:hover{background:#f1f5f9;border-color:#94a3b8;color:#0f172a}',
  'main{max-width:900px;margin:16px auto 0;padding:8px 20px 40px}',
  'h1{font-size:30px;margin:8px 0 16px}',
  'h2{font-size:24px;margin:36px 0 12px;padding-bottom:6px;border-bottom:1px solid #e2e8f0}',
  'h3{font-size:19px;margin:28px 0 10px}',
  'h4{font-size:16px;margin:22px 0 8px}',
  'p{margin:10px 0}',
  'a{color:#0284c7;text-decoration:none}',
  'a:hover{text-decoration:underline}',
  'ul,ol{margin:10px 0;padding-left:28px}',
  'li{margin:4px 0}',
  'li>p{margin:6px 0}',
  'table{border-collapse:collapse;margin:12px 0;max-width:100%;font-size:14px}',
  'th,td{border:1px solid #cbd5e1;padding:6px 10px;text-align:left;vertical-align:top}',
  'th{background:#f1f5f9;color:#0f172a}',
  'tbody tr:nth-child(even){background:#f8fafc}',
  'code{font-family:"SF Mono",Menlo,Consolas,monospace;font-size:13px;',
  'background:#f1f5f9;border:1px solid #e2e8f0;border-radius:3px;padding:0 4px}',
  'pre{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;',
  'padding:12px 14px;overflow-x:auto;font-size:13px;line-height:1.5}',
  'pre code{background:none;border:none;border-radius:0;padding:0;font-size:inherit}',
  'blockquote{margin:12px 0;padding:8px 16px;background:#f0f9ff;',
  'border-left:3px solid #0284c7;color:#334155}',
  'blockquote p{margin:6px 0}',
  'hr{border:none;border-top:1px solid #cbd5e1;margin:28px 0}',
  'footer{max-width:900px;margin:0 auto;padding:16px 20px 32px;font-size:13px;color:#64748b}',
  'footer p{margin:6px 0;border-top:1px solid #e2e8f0;padding-top:12px}',
  'li li{margin:2px 0}',
  'blockquote code{background:#e0f2fe;border-color:#bae6fd}',
  ':focus-visible{outline:2px solid #0284c7;outline-offset:2px}',
  '@media (max-width:640px){main{padding:8px 14px 32px}.topbar{padding:12px 14px 0}',
  'h1{font-size:25px}h2{font-size:20px}table{font-size:13px}th,td{padding:5px 8px}}'
].join('\n');

function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// GitHub-style heading slug: lowercase; strip inline markers (code ticks,
// emphasis, links -> their text); drop every character except unicode
// letters/digits, spaces, hyphens, underscores; each space -> one hyphen.
// (\p{L} / \p{N} need a modern RegExp engine; plain Node provides it.)
function slugify(headingText) {
  var s = String(headingText);
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  s = s.replace(/[`*]/g, '');
  s = s.toLowerCase();
  s = s.replace(/[^\p{L}\p{N} _-]+/gu, '');
  s = s.replace(/ /g, '-');
  return s;
}

// Rewrite one Markdown href for the served public/ context. Returns either
// { href: '...' } to render an <a>, or { text: true } to render the visible
// text with no link (dead repo-relative targets outside the served root).
function rewriteHref(href) {
  var h = String(href);
  if (h.charAt(0) === '#') return { href: h };
  if (h.indexOf('../public/') === 0) return { href: h.slice('../public/'.length) };
  if (h.indexOf('../') === 0) return { text: true };
  return { href: h };
}

function applyEmphasis(s) {
  s = String(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  return s;
}

// Inline renderer: `code`, [text](href), **bold**, *italic*, HTML-escaped.
// Code spans and links hide behind placeholders while emphasis runs so that
// markers inside code/links can never pair across element boundaries.
function renderInline(src) {
  var codes = [];
  var links = [];
  var s = String(src);
  s = s.replace(/`([^`\n]+)`/g, function (m, inner) {
    codes.push('<code>' + escText(inner) + '</code>');
    return '\x00CODE' + (codes.length - 1) + '\x00';
  });
  s = escText(s);
  s = s.replace(/\[([^\]\n]*)\]\(([^)\n]*)\)/g, function (m, text, href) {
    var inner = applyEmphasis(text);
    var rw = rewriteHref(href);
    if (rw.text) {
      links.push(inner);
    } else {
      links.push('<a href="' + escAttr(rw.href) + '">' + inner + '</a>');
    }
    return '\x00LINK' + (links.length - 1) + '\x00';
  });
  s = applyEmphasis(s);
  s = s.replace(/\x00LINK(\d+)\x00/g, function (m, k) { return links[+k]; });
  s = s.replace(/\x00CODE(\d+)\x00/g, function (m, k) { return codes[+k]; });
  return s;
}

function indentOf(line) {
  var m = /^[ ]*/.exec(line);
  return m ? m[0].length : 0;
}

// Match "- item" or "N. item" at any indent. Returns null when the line is
// not a list item. Marker width matters: item content starts after it.
function matchListItem(line) {
  var m = /^([ ]*)(- |\d+\. )(.*)$/.exec(line);
  if (!m) return null;
  return {
    indent: m[1].length,
    ordered: m[2].charAt(0) !== '-',
    width: m[2].length,
    content: m[3]
  };
}

function isHeading(line) {
  return /^#{1,6} /.test(line);
}

function isFence(line) {
  return line.indexOf('```') === 0;
}

function isHr(line) {
  return /^ {0,3}-{3,} *$/.test(line);
}

function isQuote(line) {
  return line.charAt(0) === '>';
}

function isTableSeparator(line) {
  var t = line.replace(/ /g, '');
  if (t.length < 3 || t.charAt(0) !== '|' || t.charAt(t.length - 1) !== '|') {
    return false;
  }
  var cells = t.slice(1, -1).split('|');
  if (!cells.length) return false;
  for (var i = 0; i < cells.length; i++) {
    if (!/^:?-+:?$/.test(cells[i])) return false;
  }
  return true;
}

function splitRow(line) {
  var t = line;
  if (t.charAt(0) === '|') t = t.slice(1);
  if (t.charAt(t.length - 1) === '|') t = t.slice(0, -1);
  return t.split('|').map(function (c) {
    return c.replace(/\\\|/g, '|').replace(/^ *| *$/g, '');
  });
}

function renderTable(lines, i) {
  var head = splitRow(lines[i]);
  var rows = [];
  var j = i + 2;
  while (j < lines.length && lines[j].charAt(0) === '|') {
    rows.push(splitRow(lines[j]));
    j++;
  }
  var h = '<table>\n<thead>\n<tr>';
  head.forEach(function (c) { h += '<th>' + renderInline(c) + '</th>'; });
  h += '</tr>\n</thead>\n';
  if (rows.length) {
    h += '<tbody>\n';
    rows.forEach(function (cells) {
      h += '<tr>';
      for (var k = 0; k < head.length; k++) {
        h += '<td>' + renderInline(cells[k] === undefined ? '' : cells[k]) + '</td>';
      }
      h += '</tr>\n';
    });
    h += '</tbody>\n';
  }
  h += '</table>';
  return { html: h, next: j };
}

// Recursive list parser over the shared line array. lines[pos] is an item
// at baseIndent; consumes sibling items plus each item's indented body
// (nested lists and continuation paragraphs), and stops at the first line
// that belongs to an outer level (blank, dedent, or different list type).
function parseList(lines, pos, baseIndent) {
  var first = matchListItem(lines[pos]);
  var ordered = first.ordered;
  var tag = ordered ? 'ol' : 'ul';
  var out = '<' + tag + '>\n';
  var i = pos;
  while (i < lines.length) {
    var m = matchListItem(lines[i]);
    if (!m || m.indent !== baseIndent || m.ordered !== ordered) break;
    var contentIndent = baseIndent + m.width;
    var body = [];
    var j = i + 1;
    while (j < lines.length) {
      var line = lines[j];
      if (line.replace(/ /g, '') === '') break;
      var lm = matchListItem(line);
      if (lm && lm.indent <= baseIndent) break;
      if (indentOf(line) < contentIndent) break;
      body.push(line);
      j++;
    }
    out += renderItem(m.content, body, contentIndent);
    i = j;
  }
  out += '</' + tag + '>';
  return { html: out, next: i };
}

// One <li>: the first content line plus body lines grouped in order into
// paragraph chunks (indented continuation lines joined with spaces) and
// nested lists (marker runs at deeper indent, parsed recursively).
function renderItem(firstContent, body, contentIndent) {
  var chunks = [];
  var textRun = [firstContent.replace(/^ *| *$/g, '')];
  var k = 0;
  function flushText() {
    var t = textRun.filter(function (x) { return x !== ''; }).join(' ');
    if (t !== '') chunks.push({ t: 'p', text: t });
    textRun = [];
  }
  while (k < body.length) {
    var lm = matchListItem(body[k]);
    if (lm && lm.indent >= contentIndent) {
      flushText();
      var sub = parseList(body, k, lm.indent);
      chunks.push({ t: 'list', html: sub.html });
      k = sub.next;
    } else {
      textRun.push(body[k].replace(/^ *| *$/g, ''));
      k++;
    }
  }
  flushText();
  // Tight single-paragraph items render bare; the first chunk of a complex
  // item stays bare too and later paragraphs get <p> wrappers.
  var h = '<li>' + renderInline(chunks[0].text);
  for (var c = 1; c < chunks.length; c++) {
    if (chunks[c].t === 'p') h += '\n<p>' + renderInline(chunks[c].text) + '</p>';
    else h += '\n' + chunks[c].html;
  }
  h += '</li>\n';
  return h;
}

function renderHeading(line, uniqueSlug) {
  var m = /^(#{1,6}) (.*)$/.exec(line);
  var level = m[1].length;
  var text = m[2].replace(/ +#+$/, '').replace(/^ *| *$/g, '');
  return '<h' + level + ' id="' + escAttr(uniqueSlug(text)) + '">' +
    renderInline(text) + '</h' + level + '>';
}

function renderBlocks(lines, uniqueSlug) {
  var parts = [];
  var i = 0;
  while (i < lines.length) {
    var line = lines[i];
    if (line.replace(/ /g, '') === '') { i++; continue; }
    if (isFence(line)) {
      var code = [];
      var j = i + 1;
      while (j < lines.length && !isFence(lines[j])) { code.push(lines[j]); j++; }
      parts.push('<pre><code>' + escText(code.join('\n')) + '</code></pre>');
      i = (j < lines.length) ? j + 1 : j;
      continue;
    }
    if (isHeading(line)) {
      parts.push(renderHeading(line, uniqueSlug));
      i++;
      continue;
    }
    if (isHr(line)) {
      parts.push('<hr>');
      i++;
      continue;
    }
    if (isQuote(line)) {
      var q = [];
      while (i < lines.length && isQuote(lines[i])) {
        q.push(lines[i].replace(/^> ?/, ''));
        i++;
      }
      parts.push('<blockquote>\n' + renderBlocks(q, uniqueSlug) + '\n</blockquote>');
      continue;
    }
    if (line.charAt(0) === '|' && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      var t = renderTable(lines, i);
      parts.push(t.html);
      i = t.next;
      continue;
    }
    if (matchListItem(line)) {
      var l = parseList(lines, i, matchListItem(line).indent);
      parts.push(l.html);
      i = l.next;
      continue;
    }
    var para = [line.replace(/^ *| *$/g, '')];
    i++;
    while (i < lines.length) {
      var p = lines[i];
      if (p.replace(/ /g, '') === '') break;
      if (isFence(p) || isHeading(p) || isHr(p) || isQuote(p)) break;
      if (matchListItem(p)) break;
      if (p.charAt(0) === '|' && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
      para.push(p.replace(/^ *| *$/g, ''));
      i++;
    }
    parts.push('<p>' + renderInline(para.join(' ')) + '</p>');
  }
  return parts.join('\n');
}

// Fresh slug scope per page: duplicate heading texts get -1, -2, ... suffixes.
function makeSlugger() {
  var seen = {};
  return function (text) {
    var base = slugify(text);
    var count = seen[base] || 0;
    seen[base] = count + 1;
    return count === 0 ? base : base + '-' + count;
  };
}

// Pure: Markdown source -> <main> body HTML (no <html> wrapper).
function renderBody(markdown) {
  return renderBlocks(String(markdown).split('\n'), makeSlugger());
}

// Pure: Markdown source -> complete deterministic HTML document.
function renderPage(markdown) {
  var body = renderBlocks(String(markdown).split('\n'), makeSlugger());
  var doc = '<!doctype html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>EduCAD User Manual</title>\n' +
    '<style>\n' + CSS + '\n</style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<p class="topbar"><a href="index.html">\u2190 Back to EduCAD</a></p>\n' +
    '<main>\n' + body + '\n</main>\n' +
    '<footer>\n' +
    '<p>Generated from docs/MANUAL.md by tools/build-manual.js ' +
    '\u2014 edit the Markdown and run npm run build:manual. ' +
    'Links that point outside the served public/ folder (for example into ' +
    'docs/ or tools/) are shown as plain text, not links, because only ' +
    'public/ is served.</p>\n' +
    '</footer>\n' +
    '</body>\n' +
    '</html>\n';
  return doc;
}

function build(srcPath, destPath) {
  var from = srcPath || SRC;
  var to = destPath || DEST;
  var markdown = fs.readFileSync(from, 'utf8');
  var html = renderPage(markdown);
  fs.writeFileSync(to, html, 'utf8');
  return { src: from, dest: to, bytes: Buffer.byteLength(html, 'utf8') };
}

if (require.main === module) {
  var r = build();
  console.log('educad manual: ' + r.src + ' -> ' + r.dest + ' (' + r.bytes + ' bytes)');
}

module.exports = {
  slugify: slugify,
  renderInline: renderInline,
  renderBody: renderBody,
  renderPage: renderPage,
  rewriteHref: rewriteHref,
  build: build,
  CSS: CSS,
  SRC: SRC,
  DEST: DEST
};

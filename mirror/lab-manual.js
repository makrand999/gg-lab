'use strict';
/* EduCAD inline manual for the lab home pages. The Manual nav item on
   teacher.html / student.html renders here instead of leaving the page:
   this lib fetches the generated mirror/manual.html once, parses it,
   and clones the role's sections into #lab-root. Content is adjusted
   per home page: teachers get studio workflows (classes, sets, models,
   review, teaching scripts) plus the model-drawing reference; students
   get drawing-first guidance (quick start, tools, precision, 3D,
   tutorials, solving). Both keep reference tables, troubleshooting,
   and limitations; the developer appendix stays in the full manual.
   Parsed nodes are cloned, never injected as markup, so the lab
   no-html-injection rule holds. Same-tab fallback: without fetch or
   DOMParser (or when the manual fails to load) the view offers the
   plain manual.html link instead. */
(function () {
  var MANUAL_URL = 'manual.html';
  var MANUAL_MARKER = 'educad-user-manual';

  // Section heading ids in mirror/manual.html, in reading order.
  // Missing ids are skipped, so manual edits degrade to a shorter
  // view plus the full-manual link rather than a broken page.
  var SECTIONS = {
    teacher: [
      '1-what-educad-is',
      '38-login-session-chip-and-desktop-gate',
      '39-edit-and-view-modes',
      '310-classes-and-question-sets-teachers-post-students-submit',
      '311-command-line--and-settings',
      '4-drawing-tool-by-tool',
      '5-editing-and-housekeeping',
      '91-demo-buttons-guided-walkthroughs',
      '93-teaching-scripts-follow-verbatim',
      '93b-competing-points-verdicts-and-check',
      '10-reference-tables',
      '11-troubleshooting',
      '12-limitations--not-implemented'
    ],
    student: [
      '1-what-educad-is',
      '2-quick-start-your-first-drawing-in-5-minutes',
      '3-interface-tour',
      '4-drawing-tool-by-tool',
      '5-editing-and-housekeeping',
      '6-precision-snapping-axis-lock-zoom-line-weights',
      '7-views-and-planes',
      '8-the-3d-view',
      '91-demo-buttons-guided-walkthroughs',
      '92-curriculum-lessons-the-full-set',
      '93b-competing-points-verdicts-and-check',
      '94-tutorial-square-scripted-user',
      '95-tutorial-prism-scripted-user',
      '10-reference-tables',
      '11-troubleshooting',
      '12-limitations--not-implemented'
    ]
  };
  var TITLES = {
    teacher: 'Manual — Teacher studio',
    student: 'Manual — Student workspace'
  };
  var BACKS = { teacher: '‹ Studio', student: '‹ Workspace' };
  var AUDIENCE = { teacher: 'teachers', student: 'students' };

  var cachedDoc = null;
  var pendingFetch = null;

  function loadManual() {
    if (cachedDoc) return Promise.resolve(cachedDoc);
    if (pendingFetch) return pendingFetch;
    if (typeof window.fetch !== 'function' ||
        typeof window.DOMParser !== 'function') {
      return Promise.reject(new Error('manual needs fetch and DOMParser'));
    }
    pendingFetch = window.fetch(MANUAL_URL).then(function (res) {
      if (!res.ok) throw new Error('manual unavailable (' + res.status + ')');
      return res.text();
    }).then(function (text) {
      var doc = new window.DOMParser().parseFromString(text, 'text/html');
      if (!doc || !doc.getElementById(MANUAL_MARKER)) {
        throw new Error('manual failed to parse');
      }
      cachedDoc = doc;
      return doc;
    });
    pendingFetch.then(null, function () { pendingFetch = null; });
    return pendingFetch;
  }

  function headingLevel(tagName) {
    var m = /^H([1-6])$/.exec(String(tagName || ''));
    return m ? Number(m[1]) : 0;
  }

  // Clone-plan per whitelisted heading: the heading plus following
  // siblings up to (not including) the next heading of equal or
  // higher level. Unknown ids are skipped.
  function extract(doc, ids) {
    var main = doc.querySelector('main');
    if (!main) return [];
    var out = [];
    ids.forEach(function (id) {
      var head = doc.getElementById(id);
      if (!head || !main.contains(head)) return;
      var level = headingLevel(head.tagName);
      if (!level) return;
      var nodes = [head];
      var sib = head.nextSibling;
      while (sib) {
        if (sib.nodeType === 1) {
          var hl = headingLevel(sib.tagName);
          if (hl > 0 && hl <= level) break;
        }
        nodes.push(sib);
        sib = sib.nextSibling;
      }
      out.push({ id: id, head: head, nodes: nodes });
    });
    return out;
  }

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function scrollToId(id) {
    var t = document.getElementById(id);
    if (t && t.scrollIntoView) t.scrollIntoView();
  }

  function jumpLink(id, text) {
    var a = el('a', text, 'lab-act');
    a.href = '#' + id;
    a.addEventListener('click', function (e) {
      // Never touch the hash: the lab router would leave this view.
      e.preventDefault();
      scrollToId(id);
    });
    return a;
  }

  // In-extract links: included targets scroll in place; anything else
  // (sections outside this role's slice) opens the full manual.
  function wireAnchors(container) {
    var included = {};
    var tagged = container.querySelectorAll('[id]');
    for (var i = 0; i < tagged.length; i++) {
      included[tagged[i].id] = true;
    }
    var links = container.querySelectorAll('a[href]');
    for (var j = 0; j < links.length; j++) {
      (function (a) {
        var href = a.getAttribute('href') || '';
        if (href.charAt(0) !== '#') return;
        var id = href.slice(1);
        if (included[id]) {
          a.addEventListener('click', function (e) {
            e.preventDefault();
            scrollToId(id);
          });
        } else {
          a.setAttribute('href', MANUAL_URL + href);
        }
      })(links[j]);
    }
  }

  function fullManualLink() {
    var a = el('a', 'Full manual', 'lab-act');
    a.href = MANUAL_URL;
    return a;
  }

  function show(root, role) {
    var ids = SECTIONS[role] || SECTIONS.student;
    var title = TITLES[role] || TITLES.student;
    var back = el('a', BACKS[role] || BACKS.student, 'lab-act lab-back');
    back.href = '#';
    root.appendChild(back);
    root.appendChild(el('h2', title));
    var meta = el('p', null, 'lab-meta');
    meta.appendChild(document.createTextNode(
      ids.length + ' sections · tailored for ' +
      (AUDIENCE[role] || AUDIENCE.student) + ' · '));
    meta.appendChild(fullManualLink());
    root.appendChild(meta);
    var jump = el('div', null, 'lab-manual-jump lab-meta');
    jump.appendChild(document.createTextNode('On this page: '));
    root.appendChild(jump);
    var body = el('div', null, 'lab-manual');
    body.appendChild(el('p', 'Loading manual…', 'lab-muted'));
    root.appendChild(body);

    loadManual().then(function (doc) {
      var sections = extract(doc, ids);
      while (jump.firstChild) jump.removeChild(jump.firstChild);
      jump.appendChild(document.createTextNode('On this page: '));
      while (body.firstChild) body.removeChild(body.firstChild);
      if (!sections.length) {
        body.appendChild(el('p',
          'No manual sections matched this view. ', 'lab-muted'));
        body.appendChild(fullManualLink());
        return;
      }
      sections.forEach(function (sec, i) {
        if (i > 0) jump.appendChild(document.createTextNode(' · '));
        jump.appendChild(jumpLink(sec.id, sec.head.textContent));
        sec.nodes.forEach(function (n) {
          body.appendChild(document.importNode(n, true));
        });
      });
      wireAnchors(body);
    }, function () {
      while (body.firstChild) body.removeChild(body.firstChild);
      body.appendChild(el('p',
        'The manual failed to load. You can still read it in full: ',
        'lab-error'));
      body.appendChild(fullManualLink());
    });
  }

  // The nav Manual link keeps its manual.html href as a no-JS
  // fallback; with JS it renders the inline view instead.
  function wireNav() {
    var nav = document.getElementById('nav-manual');
    if (!nav) return;
    nav.addEventListener('click', function (e) {
      e.preventDefault();
      window.location.hash = '#manual';
    });
  }

  window.EduCADLabManual = {
    show: show, wireNav: wireNav, SECTIONS: SECTIONS
  };
})();

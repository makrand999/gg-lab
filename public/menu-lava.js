'use strict';
/* Codeforces menu animation, ported as-is to vanilla JS:
   jquery.lavaLamp (blob follows hover, returns to current on leave)
   + jquery.easing easeOutBack (s = 1.70158, 700 ms), with jQuery
   .stop() semantics: a new hover retargets mid-flight, no queue. */
(function () {
  var SPEED = 700;
  var S = 1.70158; /* CF easeOutBack constant */

  /* Exact CF easeOutBack, normalized: p in [0,1] -> eased progress. */
  function easeOutBack(p) {
    var t = p - 1;
    return t * t * ((S + 1) * t + S) + 1;
  }

  function init() {
    var list = document.querySelector('.menu-list');
    if (!list) return;
    var items = [];
    Array.prototype.forEach.call(list.querySelectorAll('li'), function (li) {
      if (!li.classList.contains('backLava')) items.push(li);
    });
    if (!items.length) return;

    var current = list.querySelector('li.current') || items[0];
    /* CF lavalamp blob markup: backLava caps the right, inner leftLava
       stretches. (CF also emits bottomLava/cornerLava divs, but its CSS
       leaves them unstyled, so they render nothing — omitted.) */
    var blob = document.createElement('li');
    blob.className = 'backLava';
    blob.setAttribute('aria-hidden', 'true');
    var stretch = document.createElement('div');
    stretch.className = 'leftLava';
    blob.appendChild(stretch);
    list.insertBefore(blob, list.firstChild);

    var raf = 0;
    var reduced = false;
    try {
      reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (err) { /* keep animated */ }

    /* CF submenu geometry: the 20px pill covers the link plus its
       8px side margins, so it floats as a jelly pill, not a tight box. */
    function targetOf(li) {
      return {
        left: li.offsetLeft - 8,
        top: Math.round(li.offsetTop +
          (li.offsetHeight - blob.offsetHeight) / 2),
        width: li.offsetWidth + 16
      };
    }

    function render(v) {
      blob.style.left = v.left + 'px';
      blob.style.top = v.top + 'px';
      blob.style.width = v.width + 'px';
    }

    function nowBox() {
      var cs = window.getComputedStyle(blob);
      return {
        left: parseFloat(cs.left) || 0,
        top: parseFloat(cs.top) || 0,
        width: parseFloat(cs.width) || 0
      };
    }

    function move(li, instant) {
      if (!li) return;
      if (raf) { cancelAnimationFrame(raf); raf = 0; } /* jQuery .stop() */
      var to = targetOf(li);
      if (instant || reduced || !window.requestAnimationFrame) {
        render(to);
        return;
      }
      var from = nowBox();
      var t0 = performance.now();
      function frame(now) {
        var p = (now - t0) / SPEED;
        if (p >= 1) { render(to); raf = 0; return; }
        var e = easeOutBack(p);
        render({
          left: from.left + (to.left - from.left) * e,
          top: from.top + (to.top - from.top) * e,
          width: from.width + (to.width - from.width) * e
        });
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
    }

    move(current, true);

    items.forEach(function (li) {
      li.addEventListener('mouseenter', function () { move(li, false); });
      var link = li.querySelector('a');
      if (link) {
        link.addEventListener('focus', function () { move(li, false); });
        link.addEventListener('blur', function () { move(current, false); });
        link.addEventListener('click', function () { move(li, true); });
      }
    });
    list.addEventListener('mouseleave', function () { move(current, false); });
    window.addEventListener('resize', function () { move(current, true); });
    /* Webfont loads shift item widths: re-seat the blob once ready. */
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { move(current, true); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

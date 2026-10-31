// Run this expression with T3 preview_evaluate (awaitPromise=true) on a
// freshly navigated disposable guest sheet AFTER resizing the preview. Run
// it only once per navigation, since document.open retains window listeners.
// T3 viewport presets
// resize layout but retain desktop pointer capabilities. Simulate those
// capabilities before reinitializing the app to exercise phone-only guards.
// This changes only this browser tab; it does not add a production override.
(async function prepareMobilePreview() {
  if (!window.EduCADSaves || EduCADSaves.currentSession().role !== 'guest') {
    throw new Error('Use a disposable EduCAD guest sheet.');
  }
  var html = await (await fetch('index.html?mobile-audit=' + Date.now(), { cache: 'no-store' })).text();
  var nativeMedia = window.matchMedia.bind(window);
  window.matchMedia = function (query) {
    if (/pointer: (coarse|fine)/.test(query)) {
      return { matches: query.indexOf('coarse') !== -1, media: query, onchange: null,
        addEventListener: function () {}, removeEventListener: function () {},
        addListener: function () {}, removeListener: function () {} };
    }
    return nativeMedia(query);
  };
  Object.defineProperty(navigator, 'maxTouchPoints', { get: function () { return 5; }, configurable: true });
  // Fetch the current working files instead of reusing an old preview cache.
  var stamp = Date.now();
  html = html.replace(/(<(?:script|link)\b[^>]*(?:src|href)=")([^"]+)"/g, function (_, start, url) {
    return start + url + (url.indexOf('?') === -1 ? '?' : '&') + 'mobile-audit=' + stamp + '"';
  });
  delete window.educadHandle;
  document.open(); document.write(html); document.close();
  return 'Guest page reinitialized with simulated touch-only capabilities.';
})();

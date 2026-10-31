(function () {
  'use strict';
  var themes = {
    warm: { name: 'Warm Studio', description: 'Ivory paper, terracotta actions, and a welcoming studio feel.', background: '#F6F2EA', surface: '#FFFFFF', soft: '#FBEDE7', text: '#252B32', muted: '#62675F', border: '#D7D5CD', primary: '#A8442E', 'on-primary': '#FFFFFF' },
    blueprint: { name: 'Blueprint', description: 'Cool white and cobalt for a crisp, precise academic workspace.', background: '#F3F6FB', surface: '#FFFFFF', soft: '#EAF0FF', text: '#202C42', muted: '#5D697D', border: '#D5DDE9', primary: '#2457C5', 'on-primary': '#FFFFFF' },
    forest: { name: 'Forest Classroom', description: 'Sage surroundings and deep green actions for a calm learning space.', background: '#F1F6F2', surface: '#FFFFFF', soft: '#E4F2E9', text: '#23382E', muted: '#5D6C63', border: '#CDDCD2', primary: '#1F6B52', 'on-primary': '#FFFFFF' },
    lilac: { name: 'Soft Lilac', description: 'Pale lavender surfaces and strong violet actions, with a gentle contemporary feel.', background: '#F6F3FB', surface: '#FFFFFF', soft: '#EEE7FA', text: '#312741', muted: '#6D617B', border: '#DCD3E8', primary: '#6841BB', 'on-primary': '#FFFFFF' },
    midnight: { name: 'Midnight Lab', description: 'Charcoal chrome and lavender actions. Engineering paper stays light and readable.', background: '#151923', surface: '#202633', soft: '#302B46', text: '#F5F5F7', muted: '#B2B8C7', border: '#434C60', primary: '#C1ABFF', 'on-primary': '#211B37' },
    sunlit: { name: 'Sunlit Paper', description: 'Cream surfaces and readable ochre actions for a bright, welcoming classroom.', background: '#FFF8EB', surface: '#FFFFFF', soft: '#FAEFD4', text: '#382E1D', muted: '#756748', border: '#E1D5BC', primary: '#8F5708', 'on-primary': '#FFFFFF' }
  };
  var preview = document.getElementById('concept-preview');
  var home = document.getElementById('mock-home');
  var drawing = document.getElementById('mock-drawing');
  var message = document.getElementById('demo-message');
  var homeButton = document.getElementById('show-home');
  var drawingButton = document.getElementById('show-drawing');
  var storageKey = 'educad_major2_theme_preview';

  function luminance(hex) {
    var rgb = hex.slice(1).match(/../g).map(function (pair) {
      var channel = parseInt(pair, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  }
  function contrast(first, second) {
    var a = luminance(first), b = luminance(second);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }
  function applyTheme(key) {
    if (!Object.prototype.hasOwnProperty.call(themes, key)) key = 'warm';
    var theme = themes[key];
    ['background', 'surface', 'soft', 'text', 'muted', 'border', 'primary', 'on-primary'].forEach(function (token) {
      preview.style.setProperty('--ui-' + token, theme[token]);
    });
    preview.dataset.theme = key;
    document.getElementById('theme-name').textContent = theme.name;
    document.getElementById('theme-description').textContent = theme.description;
    document.querySelector('input[name="theme"][value="' + key + '"]').checked = true;
    var palette = document.getElementById('palette-values');
    palette.replaceChildren();
    [['background', 'Background'], ['surface', 'Surface'], ['primary', 'Main action'], ['text', 'Text'], ['muted', 'Secondary text']].forEach(function (pair) {
      var group = document.createElement('div'); group.className = 'palette-item';
      var label = document.createElement('dt');
      var dot = document.createElement('span'); dot.className = 'palette-dot'; dot.style.backgroundColor = theme[pair[0]]; dot.setAttribute('aria-hidden', 'true');
      label.append(dot, document.createTextNode(pair[1]));
      var value = document.createElement('dd'); value.textContent = theme[pair[0]];
      group.append(label, value); palette.append(group);
    });
    document.getElementById('contrast-note').textContent = 'Text / surface: ' + contrast(theme.text, theme.surface).toFixed(2) + ':1 · Secondary text / background: ' + contrast(theme.muted, theme.background).toFixed(2) + ':1 · Button text / action: ' + contrast(theme['on-primary'], theme.primary).toFixed(2) + ':1';
    try { localStorage.setItem(storageKey, key); } catch (_) { /* Theme selection still works without storage. */ }
  }
  function showScreen(which) {
    var draw = which === 'drawing';
    home.hidden = draw;
    drawing.hidden = !draw;
    homeButton.setAttribute('aria-pressed', String(!draw));
    drawingButton.setAttribute('aria-pressed', String(draw));
    message.hidden = true;
  }
  document.querySelectorAll('input[name="theme"]').forEach(function (radio) {
    radio.addEventListener('change', function () { if (radio.checked) applyTheme(radio.value); });
  });
  homeButton.addEventListener('click', function () { showScreen('home'); });
  drawingButton.addEventListener('click', function () { showScreen('drawing'); });
  document.getElementById('continue-drawing').addEventListener('click', function () { showScreen('drawing'); drawingButton.focus(); });
  preview.querySelectorAll('[data-home]').forEach(function (button) {
    button.addEventListener('click', function () { showScreen('home'); homeButton.focus(); });
  });
  preview.querySelectorAll('[data-demo]').forEach(function (button) {
    button.addEventListener('click', function () { message.textContent = button.dataset.demo; message.hidden = false; });
  });
  var instructions = { point: 'Choose where to place your point.', line: 'Choose the first point of your line.', circle: 'Choose the center of your circle.', measure: 'Choose a point or line to measure.' };
  preview.querySelectorAll('[data-tool]').forEach(function (button) {
    button.addEventListener('click', function () {
      preview.querySelectorAll('[data-tool]').forEach(function (tool) {
        var active = tool === button;
        tool.classList.toggle('selected', active); tool.setAttribute('aria-pressed', String(active));
      });
      document.getElementById('tool-instruction').textContent = instructions[button.dataset.tool];
    });
  });
  var storedTheme;
  try { storedTheme = localStorage.getItem(storageKey); } catch (_) { /* Use the recommended theme. */ }
  applyTheme(storedTheme || 'warm');
})();

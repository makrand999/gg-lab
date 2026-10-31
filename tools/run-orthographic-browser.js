'use strict';
// Optional browser runner; Playwright is not an application dependency.
const fs = require('node:fs');
const path = require('node:path');
async function main() {
  const { chromium } = require(process.env.EDUCAD_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const suite = fs.readFileSync(path.join(__dirname, 'test-orthographic-browser.js'), 'utf8');
  let failures = 0;
  try {
    for (const size of [
      { width: 1280, height: 800 }, { width: 1920, height: 1080 },
      { width: 1024, height: 600 }, { width: 390, height: 844, touch: true },
      { width: 844, height: 390, touch: true }
    ]) {
      const context = await browser.newContext({ viewport: size, hasTouch: !!size.touch, isMobile: !!size.touch });
      try {
        await context.addInitScript(() => localStorage.setItem('educad_session', JSON.stringify({ role: 'guest', name: 'Inspection test', token: 'guest' })));
        const page = await context.newPage(), errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(process.argv[2] || 'http://127.0.0.1:8124/index.html', { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.educadHandle && window.educadHandle.spatialView);
        const result = await page.evaluate(suite);
        failures += result.failed + errors.length;
        console.log(`${size.width}x${size.height}: ${result.passed} passed, ${result.failed} failed, ${errors.length} browser errors`);
        result.results.filter(r => r.status === 'FAIL').forEach(r => console.error(`${r.name}: ${r.error}`));
        errors.forEach(e => console.error(e));
        await page.reload({ waitUntil: 'networkidle' });
        const restored = await page.evaluate(() => ({ prefs: educadHandle.orthographicView.preferences(), pins: educadHandle.orthographicView.pins() }));
        if (restored.prefs.precision !== 3 || restored.prefs.overlay !== 'all' || restored.pins.length) {
          console.error('Preference persistence / ephemeral pins failed on reload'); failures++;
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  process.exitCode = failures ? 1 : 0;
}
main().catch(e => { console.error(e); process.exitCode = 1; });

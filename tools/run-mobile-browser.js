'use strict';
// Optional Chromium runner. The behavior suite also runs directly in
// T3's collaborative preview; Playwright is not an app dependency.
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  let chromium;
  try {
    ({ chromium } = require(process.env.EDUCAD_PLAYWRIGHT_MODULE || 'playwright'));
  } catch (_) {
    throw new Error('Install Playwright/Chromium, set EDUCAD_PLAYWRIGHT_MODULE, or run tools/test-mobile-browser.js in T3 preview.');
  }
  const url = process.argv[2] || 'http://127.0.0.1:8124/';
  const suite = fs.readFileSync(path.join(__dirname, 'test-mobile-browser.js'), 'utf8').trim();
  const scenarios = [
    { name: 'desktop', width: 1280, height: 800, touch: false },
    { name: 'narrow desktop', width: 390, height: 844, touch: false },
    { name: 'phone portrait', width: 390, height: 844, touch: true },
    { name: 'phone landscape', width: 844, height: 390, touch: true },
    { name: 'short phone', width: 320, height: 568, touch: true },
    { name: 'tablet', width: 1024, height: 768, touch: true }
  ];
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const reports = [];
  try {
    for (const scenario of scenarios) {
      const context = await browser.newContext({
        viewport: { width: scenario.width, height: scenario.height },
        hasTouch: scenario.touch, isMobile: scenario.touch, deviceScaleFactor: 1
      });
      try {
        await context.addInitScript(() => {
          localStorage.setItem('educad_session', JSON.stringify({ role: 'guest', name: 'Mobile audit guest', token: 'guest' }));
          localStorage.removeItem('educad_mobile_split');
        });
        const page = await context.newPage();
        const exceptions = [];
        page.on('pageerror', error => exceptions.push(error.message));
        await page.goto(url, { waitUntil: 'networkidle' });
        await page.waitForFunction(() => window.educadHandle && window.EduCADMobile);
        const result = await page.evaluate(suite);
        result.exceptions = exceptions;
        reports.push({ scenario: scenario.name, ...result });
        console.log(`${scenario.name}: ${result.passed} passed; ${result.failed} failed; ${result.skipped} inapplicable; ${exceptions.length} browser exceptions`);
        for (const entry of result.results.filter(entry => entry.status === 'FAIL')) {
          console.error(`FAIL ${entry.name}: ${entry.evidence}`);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(reports, null, 2) + '\n');
  process.exitCode = reports.some(report => report.failed || report.exceptions.length) ? 1 : 0;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

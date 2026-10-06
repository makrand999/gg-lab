'use strict';
// Optional headless runner. The same browser suite can be evaluated directly
// in T3 preview on a disposable guest sheet, without installing Playwright.
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  let chromium;
  try {
    ({ chromium } = require(process.env.EDUCAD_PLAYWRIGHT_MODULE || 'playwright'));
  } catch (error) {
    throw new Error('Install Playwright and its Chromium browser, or set EDUCAD_PLAYWRIGHT_MODULE to an existing Playwright installation.');
  }
  const url = process.argv[2] || 'http://127.0.0.1:8124/';
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.addInitScript(() => localStorage.setItem('educad_session', JSON.stringify({ role: 'guest', name: 'Audit guest', token: 'guest' })));
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.educadHandle && window.educadHandle.drafting);
    const result = await page.evaluate(fs.readFileSync(path.join(__dirname, 'test-drawing-audit-browser.js'), 'utf8'));
    result.pageErrors = pageErrors;
    if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n');
    for (const entry of result.results) console.log(entry.status + ' ' + entry.name + (entry.status === 'FAIL' ? ': ' + entry.evidence : ''));
    for (const error of pageErrors) console.error('BROWSER ERROR ' + error);
    console.log(`${result.passed} passed; ${result.failed} failed; ${pageErrors.length} browser exceptions`);
    process.exitCode = result.failed || pageErrors.length ? 1 : 0;
  } finally {
    await browser.close();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

'use strict';
// Optional browser regression suite for Settings → Drawing method.
// Run with the same Playwright installation used by the other browser suites.
const assert = require('node:assert/strict');

async function main() {
  const { chromium } = require(process.env.EDUCAD_PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let checks = 0;
  const pass = name => console.log('PASS ' + (++checks) + ' ' + name);
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const settings = async () => { if (await page.locator('#settings-panel').isHidden()) await page.click('#btn-settings'); };
  const method = async value => {
    await settings(); await page.selectOption('#settings-drawing-mode', value);
    await page.click('#settings-close'); await settle();
  };
  const clear = async () => {
    await settings(); await page.click('#btn-clear'); await settle();
    await page.evaluate(() => Object.assign(educadHandle.view, { s: 2, tx: 640, ty: 400 }));
  };
  const ink = () => page.evaluate(() => JSON.stringify(educadHandle.table.list()));
  const pointPx = (x, y) => page.evaluate(([x, y]) => {
    const p = EduCADViewport.forward(educadHandle.view, { x, y });
    const r = educadHandle.mount.layer2.getBoundingClientRect();
    return { x: p.x + r.left, y: p.y + r.top };
  }, [x, y]);
  const clickPoint = async (x, y, bank) => {
    const p = await pointPx(x, y);
    if (bank) await page.keyboard.down('Control');
    try { await page.mouse.click(p.x, p.y); }
    finally { if (bank) await page.keyboard.up('Control'); }
    await settle();
  };
  const tool = async value => { await page.click('.drafting-launch'); await page.click('[data-tool="' + value + '"]'); };
  try {
    await page.addInitScript(() => localStorage.setItem('educad_session', JSON.stringify({ role: 'guest', name: 'Drawing method test', token: 'guest' })));
    await page.goto(process.argv[2] || 'http://127.0.0.1:8124/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.educadHandle && educadHandle.drafting);
    assert.equal(await page.evaluate(() => educadHandle.drafting.drawingMode()), 'menu');
    pass('Draw menu remains the default');
    await clear();
    await clickPoint(-100, 70);
    assert.equal(await page.evaluate(() => educadHandle.table.count()), 0);
    pass('menu Select keeps empty clicks from drawing');
    await method('shortcuts');
    assert.equal(await page.evaluate(() => educadHandle.drafting.drawingMode()), 'shortcuts');
    assert.equal(await page.locator('.drafting-launch').innerText(), 'Sheet');
    await page.click('.drafting-launch');
    assert.equal(await page.locator('.drafting-tools').isHidden(), true);
    await page.keyboard.press('Escape');
    pass('shortcut mode keeps tool choices off the canvas');
    await clickPoint(-100, 70); await clickPoint(-40, 70); await clickPoint(-100, 20);
    assert.equal(await page.evaluate(() => educadHandle.table.findByType('POINT').length), 3);
    pass('plain shortcut clicks place points without choosing a tool');
    await clickPoint(-100, 70, true); await clickPoint(-40, 70);
    assert.equal(await page.evaluate(() => educadHandle.line.phase), 'menu');
    await page.click('[data-bis="A"]');
    await page.waitForFunction(() => educadHandle.table.findByType('SEGMENT').length === 1);
    pass('Ctrl-click and a second point draw the earlier styled line');
    await page.keyboard.press('Control+z');
    assert.equal(await page.evaluate(() => educadHandle.table.findByType('SEGMENT').length), 0);
    await page.keyboard.press('Control+Shift+z');
    assert.equal(await page.evaluate(() => educadHandle.table.findByType('SEGMENT').length), 1);
    pass('undo and redo work in shortcut mode');
    await clickPoint(-100, 70, true); await clickPoint(-40, 70, true); await clickPoint(-100, 20);
    assert.equal(await page.evaluate(() => educadHandle.table.findByType('CIRCLE').length), 1);
    pass('banking two points and clicking the third draws a circle');
    const rp = await pointPx(-40, 70); await page.mouse.dblclick(rp.x, rp.y);
    assert.notEqual(await page.evaluate(() => educadHandle.sel.editing), null);
    await page.keyboard.press('Backspace'); await page.keyboard.type('p'); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => educadHandle.table.findByType('POINT').find(e => e.x === -40).caption), 'p');
    pass('double-click renaming and typing remain available');
    await page.keyboard.press('Escape'); await clickPoint(-100, 20);
    const aim = await pointPx(-100, -10); await page.mouse.move(aim.x, aim.y);
    await page.keyboard.type('30'); await page.keyboard.press('Enter'); await settle();
    assert(await page.evaluate(() => educadHandle.table.findByType('POINT').some(e => Math.abs(e.x + 100) < 1e-6 && Math.abs(e.y + 10) < 1e-6)));
    pass('aiming and typing a distance still places an exact projection');
    await page.keyboard.press('Escape'); await clickPoint(-100, 70, true);
    assert.equal(await page.evaluate(() => educadHandle.circlePicks.picks.length), 1);
    const beforeSwitch = await ink(); await method('menu');
    assert.equal(await ink(), beforeSwitch);
    assert.equal(await page.evaluate(() => educadHandle.circlePicks.picks.length), 0);
    pass('switching preserves geometry and cancels the earlier bank');
    await tool('line'); await clickPoint(-140, 110); await clickPoint(-110, 110);
    assert.equal(await page.evaluate(() => educadHandle.table.findByType('SEGMENT').length), 2);
    pass('menu tools draw on the same sheet after switching');
    await tool('select'); await clickPoint(-140, 110);
    assert.equal(await page.locator('.drafting-selection').isVisible(), true);
    await page.click('[data-target="PLAN"]'); await clickPoint(-140, -40);
    assert(await page.evaluate(() => educadHandle.table.findByType('POINT').some(e => e.viewRole === 'PLAN' && e.x === -140 && e.y === -40)));
    pass('menu projection controls still pair points');
    await tool('line'); await clickPoint(-170, 95);
    const lineCountBeforeSwitch = await page.evaluate(() => educadHandle.table.findByType('SEGMENT').length);
    const beforePreviewSwitch = await ink(); await method('shortcuts'); await clickPoint(-150, 95);
    assert.equal(await page.evaluate(() => educadHandle.table.findByType('SEGMENT').length), lineCountBeforeSwitch);
    assert.equal(JSON.parse(await ink()).length, JSON.parse(beforePreviewSwitch).length + 1);
    pass('switching cancels an unfinished menu line before the next shortcut click');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.educadHandle && educadHandle.drafting);
    assert.equal(await page.evaluate(() => educadHandle.drafting.drawingMode()), 'shortcuts');
    await settings(); assert.equal(await page.locator('#settings-drawing-mode').inputValue(), 'shortcuts');
    await page.click('#settings-close');
    pass('the chosen method survives reload');
    // Reload uses the normal guest demo; read-only tests compare its own ink.
    await page.click('#btn-mode-view'); const readonly = await ink();
    await method('menu'); await method('shortcuts'); await clickPoint(-100, 70);
    assert.equal(await ink(), readonly);
    assert.equal(await page.evaluate(() => educadHandle.measure.mode), 'view');
    pass('both methods respect read-only View mode');
    await settings(); await page.locator('#settings-drawing-mode').focus(); await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => educadHandle.measure.mode), 'view');
    await page.click('#settings-close'); await clickPoint(-100, 70); await page.keyboard.press('Tab');
    await page.waitForFunction(() => educadHandle.measure.mode === 'pose', null, { timeout: 5000 }).catch(async error => {
      console.error(await page.evaluate(() => ({ mode: educadHandle.measure.mode, method: educadHandle.drafting.drawingMode(), focused: document.activeElement.outerHTML, solid: !!educadHandle.solidMm, status: document.querySelector('.drafting-status').textContent })));
      throw error;
    });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => educadHandle.measure.mode), 'view');
    pass('shortcut Tab enters and exits Pose while Settings keeps native navigation');
    await page.click('#btn-mode-edit'); await clear();
    await page.keyboard.press('/'); await page.locator('#cmd-input').fill('/point q -90 55'); await page.keyboard.press('Enter');
    assert(await page.evaluate(() => educadHandle.table.findByType('POINT').some(e => e.caption === 'q')));
    pass('slash commands remain available in shortcut mode');
    await settings(); await page.click('#settings-reset');
    assert.equal(await page.locator('#settings-drawing-mode').inputValue(), 'menu');
    assert.equal(await page.evaluate(() => educadHandle.drafting.drawingMode()), 'menu');
    pass('reset synchronizes the saved method and drawing controls');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('OK ' + checks + ' drawing-method browser checks; no browser exceptions');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

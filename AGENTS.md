# AGENTS.md

## Browser testing — priority 1: obscura (only option)

Do not use any other browser tooling (no Playwright, no system-Chromium
one-liners, no puppeteer-chromium, no manual-only flows as substitutes).

- Binary: `/root/dumb/mtype/bin/obscura` (0.2.3, `serve` = CDP server)
- Start it: `obscura serve --port 9222 --allow-private-network`
  (`--allow-private-network` is required for localhost targets)
- Ready check: poll `http://127.0.0.1:9222/json/version` until 200
- Drive it: `puppeteer-core` via
  `puppeteer.connect({ browserURL: 'http://127.0.0.1:9222' })`
- Working example: `/root/dumb/mtype/test-obscura.js`
- App under test: `npm start` in this repo (serves `mirror/` on
  `http://127.0.0.1:8124/`), then `page.goto()` that URL from obscura

Node suite (`npm test`, 880 plain-Node checks) stays as-is for
non-browser coverage; anything needing a real browser goes through
obscura.

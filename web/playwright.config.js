// SPDX-License-Identifier: AGPL-3.0-or-later
// Browser tests (real Chrome, real layout, real pointer events). jsdom cannot test any of that.
// Default: serves ./web with e2e/serve.js. GTM_BASE_URL=http://127.0.0.1:8080 runs the same specs
// against a running container instead. Uses the installed Google Chrome (no browser download).
// Three viewports (PROMPT.md 2.2): desktop 1280x800, tablet 768x1024, phone 390x844 with touch and DPR 2.
// Mouse and keyboard specs (input.spec.js) run on desktop and tablet, touch specs (touch.spec.js) on the phone.
const { defineConfig } = require('@playwright/test');

const external = process.env.GTM_BASE_URL;

/* Firefox and WebKit (Safari's engine), only when GTM_OTHER_BROWSERS is set (`make other-browsers`, the "Firefox and WebKit" CI job): they
 * are downloads (`npx playwright install firefox webkit`), and the Chrome run above stays what `make ci` does. Desktop size for both,
 * and WebKit again with a touch phone (the closest thing to Safari on an iPhone that runs without one). */
function otherBrowsers() {
  return [
    { name: 'firefox', testIgnore: /touch\.spec/, use: { browserName: 'firefox', channel: undefined, viewport: { width: 1280, height: 800 } } },
    { name: 'webkit', testIgnore: /touch\.spec/, use: { browserName: 'webkit', channel: undefined, viewport: { width: 1280, height: 800 } } },
    {
      name: 'webkit-phone', testIgnore: /input\.spec/,
      use: { browserName: 'webkit', channel: undefined, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    },
  ];
}

module.exports = defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { baseURL: external || 'http://127.0.0.1:8765', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: external ? undefined : {
    command: 'node e2e/serve.js 8765',
    url: 'http://127.0.0.1:8765/index.html',
    reuseExistingServer: true,
  },
  projects: [
    ...(process.env.GTM_OTHER_BROWSERS ? otherBrowsers() : []),
    { name: 'desktop', testIgnore: /touch\.spec/, use: { viewport: { width: 1280, height: 800 } } },
    { name: 'tablet', testIgnore: /touch\.spec/, use: { viewport: { width: 768, height: 1024 } } },
    {
      name: 'phone', testIgnore: /input\.spec/,
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    },
  ],
});

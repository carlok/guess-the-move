// Browser tests (real Chrome, real layout, real pointer events). jsdom cannot test any of that.
// Default: serves ./web with e2e/serve.js. GTM_BASE_URL=http://127.0.0.1:8080 runs the same specs
// against a running container instead. Uses the installed Google Chrome (no browser download).
// Three viewports (PROMPT.md 2.2): desktop 1280x800, tablet 768x1024, phone 390x844 with touch and DPR 2.
// Mouse and keyboard specs (input.spec.js) run on desktop and tablet, touch specs (touch.spec.js) on the phone.
const { defineConfig } = require('@playwright/test');

const external = process.env.GTM_BASE_URL;

module.exports = defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  // On CI a failed test is retried twice and, if a retry passes, reported as FLAKY (not green): one phone touch test failed once on
  // the GitHub runner (the tap on Confirm after a CDP touch drag was delivered but the page got no click) and could not be
  // reproduced locally in 200 runs under load. Locally there are no retries, so a flake still shows.
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: { baseURL: external || 'http://127.0.0.1:8765', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: external ? undefined : {
    command: 'node e2e/serve.js 8765',
    url: 'http://127.0.0.1:8765/index.html',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'desktop', testIgnore: /touch\.spec/, use: { viewport: { width: 1280, height: 800 } } },
    { name: 'tablet', testIgnore: /touch\.spec/, use: { viewport: { width: 768, height: 1024 } } },
    {
      name: 'phone', testIgnore: /input\.spec/,
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    },
  ],
});

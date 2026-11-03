// Browser tests (real Chrome, real layout, real pointer events). jsdom cannot test any of that.
// Default: serves ./web with python's http.server. GTM_BASE_URL=http://127.0.0.1:8080 runs the same specs
// against a running container instead. Uses the installed Google Chrome (no browser download).
const { defineConfig } = require('@playwright/test');

const external = process.env.GTM_BASE_URL;

module.exports = defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: external || 'http://127.0.0.1:8765', channel: 'chrome', trace: 'retain-on-failure' },
  webServer: external ? undefined : {
    command: 'python3 -m http.server -d . -b 127.0.0.1 8765',
    url: 'http://127.0.0.1:8765/index.html',
    reuseExistingServer: true,
  },
  projects: [{ name: 'desktop', use: { viewport: { width: 1280, height: 800 } } }],
});

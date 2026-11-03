'use strict';
const G = require('../scoring.js');

/* Serve only the positions that `pick` selects from the real data file (still fetched through whatever
 * serves the page, so a container's headers, compression and CSP are exercised). Returns the chosen list. */
async function serveSubset(page, pick = (positions) => positions.slice(0, 1)) {
  const chosen = [];
  await page.route('**/data/positions.json', async (route) => {
    const res = await route.fetch();
    const data = await res.json();
    data.positions = pick(data.positions);
    chosen.splice(0, chosen.length, ...data.positions);
    await route.fulfill({ response: res, json: data });
  });
  return chosen;
}

/* Console errors, warnings, page errors and CSP violations seen so far. */
function watchProblems(page) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp = (window.__csp || []).concat(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return { problems, csp: () => page.evaluate(() => window.__csp || []) };
}

const bestMove = (pos) => G.bestMove(pos.evals);
const square = (page, name) => page.locator(`[data-sq="${name}"]`);

/* Click source then destination (the board is re-rendered after every click, so locators are re-resolved). */
async function clickMove(page, uci) {
  await square(page, uci.slice(0, 2)).click();
  await square(page, uci.slice(2, 4)).click();
}

module.exports = { serveSubset, watchProblems, bestMove, square, clickMove };

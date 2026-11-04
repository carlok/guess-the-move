// SPDX-License-Identifier: AGPL-3.0-or-later
'use strict';
/* What the move tiers (web/classify.js) do on the shipped dataset: how many legal moves fall in each tier, in how many
 * positions a Brilliant or Great move exists, how Great compares with the dataset's own only_move tag, and a sample of the
 * Brilliant candidates to read by eye.   node tools/tier_report.js [--data web/data/positions.json] [--out file.json] */
const fs = require('node:fs');
const C = require('../web/classify.js');

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : d; };
const data = JSON.parse(fs.readFileSync(arg('data', 'web/data/positions.json'), 'utf8'));
const moves = Object.fromEntries(C.TIERS.map((t) => [t, 0])), positions = Object.fromEntries(C.TIERS.map((t) => [t, 0]));
let legal = 0, onlyMove = 0, greatAndOnly = 0, greatNoTag = 0;
const brilliant = [];
for (const p of data.positions) {
  const all = C.classifyAll(p), seen = new Set();
  for (const [m, r] of Object.entries(all)) {
    moves[r.tier]++; legal++; seen.add(r.tier);
    if (r.tier === 'brilliant') brilliant.push({ id: p.id, fen: p.fen, san: p.san[m], cost: +r.cost.toFixed(2), cp: p.evals[m], real: p.real === m, tags: p.tags });
  }
  seen.forEach((t) => { positions[t]++; });
  const tagged = (p.tags || []).includes('only_move'), great = seen.has('great');
  if (tagged) onlyMove++;
  if (great && tagged) greatAndOnly++;
  if (great && !tagged) greatNoTag++;
}
const report = {
  positions: data.positions.length, legal_moves: legal,
  moves_by_tier_percent: Object.fromEntries(C.TIERS.map((t) => [t, +(100 * moves[t] / legal).toFixed(2)])),
  positions_with_tier: positions, only_move_tag: onlyMove, great_and_only_move: greatAndOnly, great_without_tag: greatNoTag,
  brilliant_moves: brilliant.length, brilliant_positions_percent: +(100 * positions.brilliant / data.positions.length).toFixed(2),
  brilliant_sample: brilliant.slice(0, 40)
};
if (arg('out')) fs.writeFileSync(arg('out'), JSON.stringify(report, null, 1) + '\n');
console.log(JSON.stringify({ ...report, brilliant_sample: undefined }, null, 1));
brilliant.slice(0, 25).forEach((b) => console.log(b.san.padEnd(8), String(b.cp).padStart(5), 'cost', b.cost, b.real ? 'REAL' : '    ', b.fen));

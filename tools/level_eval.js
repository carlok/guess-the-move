'use strict';
/* How good is the in-browser level estimate (web/level.js)? Runs the shipped code, not a copy of it.
 *
 *   node tools/level_eval.js --data web/data/positions.json --out docs/research/level-eval.json [--interp probe.json]
 *
 * 1. Real players. Every position carries a real move by a player of known rating. For a target rating R, draw N
 *    positions whose players are rated within 50 of R, treat their real moves as "guesses", and estimate. The truth is
 *    the mean rating of the drawn players. Reported per R and N: how often the 80% interval contains the truth
 *    (should be about 80%), mean absolute error, bias, interval width, and the same for the constant guess "1600".
 * 2. Position choice (model-consistent simulation). A synthetic player of rating R picks moves from the model's own
 *    distribution at R. Compare drawing positions at random with drawing the one `suggest` ranks highest. This says what
 *    choosing positions is worth IF the model is right; it says nothing about real people.
 * 3. Interpolation. With --interp (made by tools/anchor_probe.py): how far the log-linear interpolation between anchors is
 *    from the model's own probabilities at ratings that are not anchors.
 * Reproducible: fixed seed. */
const fs = require('node:fs');
const path = require('node:path');
const L = require('../web/level.js');

function arg(name, dflt) { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; }

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
function sample(list, n, rand) {
  const idx = list.map((_, i) => i);
  for (let i = 0; i < n; i++) { const j = i + Math.floor(rand() * (idx.length - i)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return idx.slice(0, n).map((i) => list[i]);
}

function realPlayers(positions, rand, temperature) {
  const usable = positions.filter((p) => L.anchorsOf(p) && p.player_elo);
  const rows = [];
  for (const R of [1300, 1400, 1500, 1600, 1700, 1800, 1900]) {
    const pool = usable.filter((p) => Math.abs(p.player_elo - R) <= 50);
    for (const N of [5, 10, 20, 40]) {
      if (pool.length < N * 3) continue;
      let covered = 0, abs = [], bias = [], width = [], base = [];
      const B = 400;
      for (let b = 0; b < B; b++) {
        const draw = sample(pool, N, rand), truth = mean(draw.map((p) => p.player_elo));
        const s = L.summary(L.posterior(draw.map((p) => ({ pos: p, uci: p.real })), undefined, temperature));
        if (truth >= s.lo && truth <= s.hi) covered++;
        abs.push(Math.abs(s.mean - truth)); bias.push(s.mean - truth); width.push(s.hi - s.lo); base.push(Math.abs(1600 - truth));
      }
      rows.push({ temperature: temperature || L.TEMPERATURE, rating: R, n: N, pool: pool.length, coverage: round(100 * covered / B), mae: round(mean(abs)), bias: round(mean(bias)), width: round(mean(width)), baseline_mae: round(mean(base)) });
    }
  }
  return rows;
}

/* The synthetic player's move: one of the listed moves, or "something else", drawn from the interpolated distribution. */
function drawMove(pos, r, rand) {
  const list = L.anchorsOf(pos), moves = new Set();
  list.forEach((a) => Object.keys(a.probs).forEach((m) => moves.add(m)));
  const names = [...moves], probs = names.map((m) => L.moveProb(pos, m, r));
  const rest = Math.max(0, 1 - probs.reduce((a, b) => a + b, 0));
  let u = rand() * (probs.reduce((a, b) => a + b, 0) + rest);
  for (let i = 0; i < names.length; i++) { u -= probs[i]; if (u <= 0) return names[i]; }
  return '__other__';
}

function selection(positions, rand) {
  const usable = positions.filter((p) => L.anchorsOf(p));
  const checkpoints = [5, 10, 20, 30], out = [];
  for (const R of [1300, 1600, 1900]) {
    const acc = { random: {}, adaptive: {} };
    for (const k of Object.keys(acc)) for (const c of checkpoints) acc[k][c] = { err: [], sd: [], cover: 0 };
    const T = 60;
    for (let t = 0; t < T; t++) {
      for (const strategy of ['random', 'adaptive']) {
        const used = new Set(), obs = [];
        let post = L.posterior([]);
        for (let step = 1; step <= checkpoints[checkpoints.length - 1]; step++) {
          let pos;
          if (strategy === 'random') { do { pos = usable[Math.floor(rand() * usable.length)]; } while (used.has(pos.id)); }
          else { const cand = sample(usable.filter((p) => !used.has(p.id)), 300, rand); pos = L.suggest(cand, post, rand, 5).pos; }
          used.add(pos.id);
          obs.push({ pos, uci: drawMove(pos, R, rand) });
          post = L.posterior(obs);
          if (checkpoints.includes(step)) {
            const s = L.summary(post), cell = acc[strategy][step];
            cell.err.push(Math.abs(s.mean - R)); cell.sd.push(s.sd); if (R >= s.lo && R <= s.hi) cell.cover++;
          }
        }
      }
    }
    for (const c of checkpoints) {
      out.push({ rating: R, n: c, random_mae: round(mean(acc.random[c].err)), adaptive_mae: round(mean(acc.adaptive[c].err)),
        random_sd: round(mean(acc.random[c].sd)), adaptive_sd: round(mean(acc.adaptive[c].sd)),
        random_coverage: round(100 * acc.random[c].cover / T), adaptive_coverage: round(100 * acc.adaptive[c].cover / T) });
    }
  }
  return out;
}

/* probe: [{by_elo: anchors computed the same way as the dataset's, exact: {rating: {uci: p}}}] */
function interpolation(probe) {
  const errs = [], rel = [];
  for (const row of probe) {
    const pos = { maia: { by_elo: row.by_elo } };
    for (const [r, dist] of Object.entries(row.exact)) {
      for (const [m, p] of Object.entries(dist)) {
        if (p < 0.01) continue; // the moves that matter for the estimate; small ones sit near the floor anyway
        const q = L.moveProb(pos, m, Number(r));
        errs.push(Math.abs(q - p)); rel.push(Math.abs(Math.log(q / p)));
      }
    }
  }
  errs.sort((a, b) => a - b); rel.sort((a, b) => a - b);
  const pct = (a, q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  return { positions: probe.length, moves: errs.length, mean_abs_error: round(mean(errs), 4), p95_abs_error: round(pct(errs, 0.95), 4), max_abs_error: round(errs[errs.length - 1], 4),
    median_log_ratio: round(pct(rel, 0.5), 3), p95_log_ratio: round(pct(rel, 0.95), 3) };
}

function main() {
  const data = JSON.parse(fs.readFileSync(arg('data', 'web/data/positions.json'), 'utf8'));
  const rand = rng(Number(arg('seed', '20261104')));
  const withAnchors = data.positions.filter((p) => L.anchorsOf(p)).length;
  if (!withAnchors) { console.error('no position carries maia.by_elo'); process.exit(1); }
  const report = {
    generated: new Date().toISOString().slice(0, 10), seed: Number(arg('seed', '20261104')), positions: data.positions.length, with_anchors: withAnchors,
    anchors: data.meta && data.meta.provenance && data.meta.provenance.maia_anchors,
    temperature: L.TEMPERATURE,
    real_players: realPlayers(data.positions, rand, L.TEMPERATURE), real_players_untempered: realPlayers(data.positions, rand, 1),
    selection: selection(data.positions, rand)
  };
  if (arg('interp')) report.interpolation = interpolation(JSON.parse(fs.readFileSync(arg('interp'), 'utf8')));
  const out = arg('out');
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, JSON.stringify(report, null, 1) + '\n'); }
  console.log(JSON.stringify(report, null, 1));
}

if (require.main === module) main();
module.exports = { realPlayers, selection, interpolation, drawMove, rng, sample };

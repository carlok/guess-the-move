// SPDX-License-Identifier: AGPL-3.0-or-later
/* Every piece of user-facing text lives here (English). A translation replaces this one file (roadmap v4).
 * Functions take the values they need; none of them touch the DOM. Text is escaped by the caller. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_STRINGS = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var side = function (stm) { return stm === 'w' ? 'White' : 'Black'; };
  var plural = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };

  return {
    roles: { you: 'Your move', best: 'Stockfish', real: 'Real player', maia: 'Maia' },
    letters: { you: 'Y', best: 'S', real: 'R', maia: 'M', preview: '·' },
    promoNames: { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' },
    tags: {
      real_blunder: 'Real player blundered', real_mistake: 'Real player erred',
      real_is_best: 'Real player found the best move', only_move: 'Only one good move',
      maia_miss: 'Surprising for that level', maia_error: 'Typical human error',
      hard_find: 'Hard-to-find best move', trivial: 'Trivial'
    },
    anyOption: 'Any',
    boardLabel: 'Chess board. Arrow keys move the cursor, Enter selects a piece and then a square.',
    demoBanner: 'Demo data: three public-domain 19th-century games, no ratings, so no human-model (Maia) data. ' +
      'Build a real set with the pipeline (see README).',
    posInfo: function (p) {
      return side(p.stm) + ' to move · move ' + p.move_no + ' · ' + p.phase +
        (p.player_elo ? ' · played by a ~' + p.player_elo + ' player' : '');
    },
    matchCount: function (n) { return n + ' position' + (n === 1 ? '' : 's') + ' match'; },
    prompt: {
      best: function (stm) { return 'Find the best move for ' + side(stm) + '. Tap or drag a piece, then drop it on its destination.'; },
      predict: 'What did the real player do here? Tap or drag a piece, then drop it on its destination.',
      noneUnseen: 'No unseen positions match. Untick "Unseen only" or change the filters.',
      none: 'No positions match these filters.',
      loadError: function (url, msg) {
        return 'Could not load ' + url + ' (' + msg + '). Serve this folder over HTTP, e.g. "python3 -m http.server -d web", ' +
          'and make sure data/positions.json exists (see README).';
      },
      offline: function (url) { return 'Could not load ' + url + ': you appear to be offline. Reconnect and try again.'; },
      retry: 'Try again'
    },
    confirm: 'Confirm move',
    back: 'Previous (p)',
    retry: 'Try again',
    review: {
      chip: 'Review',
      announce: function (san, verdict) { return 'Reviewing an earlier position. You played ' + san + '. ' + verdict + ' The timer is stopped.'; }
    },
    next: 'Next position (n)',
    skip: 'Skip',
    toggleThemeToDark: 'Switch to the dark theme',
    toggleThemeToLight: 'Switch to the light theme',
    noMaia: 'No human-model data for this position (unknown rating), so plausibility is not shown.',
    sourceGame: 'See the original game',
    stats: {
      none: 'No guesses yet.', guesses: 'Guesses', bestMean: 'Best-move mode: mean quality',
      predictMean: 'Predict mode: mean closeness', foundBest: 'Found a best-eval move',
      matchedReal: 'Matched the real move', matchedMaia: 'Matched Maia\'s move'
    },
    result: {
      exact: 'Exact match with the real move!',
      closeness: function (n) { return 'Closeness to the real move: <span class="big">' + n + '</span>/100'; },
      quality: function (n) { return 'Move quality: <span class="big">' + n + '</span>/100'; },
      exactDetail: function (elo) { return 'You played what the ' + (elo ? '~' + elo + ' player' : 'real player') + ' played.'; },
      realDiffers: function (san, d) { return 'Real move ' + san + ' differs from yours by ' + d + ' win-% points.'; },
      lost: function (c, rank, n) { return 'You lost ' + c + ' win-% points versus the best move; yours ranks ' + rank + ' of ' + n + '.'; },
      cols: { move: 'Move', cost: 'Cost', plausible: 'Plausible', closeness: 'Your closeness' },
      sameMove: 'same move',
      maiaAt: function (elo) { return 'Maia ' + elo; },
      realAt: function (elo) { return 'Real player ' + elo; },
      help: 'Cost is the win-probability points a move gives up against the best move (lower is better). ' +
        'Plausible is how often a player of the real player\'s rating chooses it. Closeness compares your move with ' +
        'each reference, 100 meaning the same.'
    },
    verdict: {
      foundBest: 'You found Stockfish\'s choice.',
      likeMaia: function (elo) { return 'You played what a ' + (elo ? '~' + elo : 'typical') + ' player typically plays.'; },
      likeReal: 'You played the same move as the real player.',
      exactReal: 'You predicted the real move.',
      lost: function (c) { return 'Your move gave up ' + c + ' win-% points against the best move.'; },
      near: function (n) { return 'Your move is ' + n + '/100 close to the real move.'; }
    },
    live: {
      cursor: function (sq, piece) { return sq + ', ' + (piece || 'empty'); },
      selected: function (sq, n) { return sq + ' selected, ' + plural(n, 'legal move', 'legal moves'); },
      noPiece: function (sq) { return 'No movable piece on ' + sq; },
      cancelled: 'Selection cancelled',
      pending: function (from, to) { return from + ' to ' + to + ' chosen. Use Confirm move to reveal the result.'; },
      promo: 'Choose the piece to promote to.',
      played: function (from, to, verdict) { return from + ' to ' + to + ' played. ' + verdict; },
      dragCancelled: 'Move cancelled'
    },
    api: {
      title: 'Analyse any position', fen: 'FEN', elo: 'Rating for the Maia column (optional)', analyse: 'Analyse',
      needFen: 'Paste a FEN first.', working: 'Analysing…',
      failed: function (m) { return 'The analysis failed: ' + m; },
      estimate: 'Estimate my level', estimating: 'Estimating…',
      estimateNeeds: function (n) { return 'Play ' + n + ' more positions in best-move mode to estimate your level.'; },
      estimated: function (mean, lo, hi, n) {
        return 'About ' + mean + ' (80% range ' + lo + ' to ' + hi + '), from your last ' + n + ' guesses. Lichess-equivalent rating, not FIDE.';
      }
    },
    settings: { confirm: 'Confirm moves before revealing', confirmHelp: 'Useful on touch screens, where a slip of the finger would reveal the answer.' },
    backup: {
      exported: function (n) { return 'Downloaded ' + n + ' guesses. Keep the file; "Load stats from a file" brings them back, here or in another browser.'; },
      imported: function (added, dups, skipped) {
        return 'Loaded ' + added + ' new guesses' + (dups ? ', ' + dups + ' were already here' : '') + (skipped ? ', ' + skipped + ' entries in the file were not usable and were skipped' : '') + '.';
      },
      errors: {
        size: 'That file is too large to be a stats file.', json: 'That file is not valid JSON.',
        app: 'That file is not a Guess the Move stats file.', format: 'That stats file is from a version this page does not understand.',
        empty: 'That stats file has no guess history.', read: 'The file could not be read.'
      }
    },
    timer: { label: 'Time on this position', show: 'Show the timer', showHelp: 'Your time is still recorded for the stats when the timer is hidden.' },
    sound: { off: 'Turn sounds on', on: 'Mute sounds', setting: 'Sounds' },
    session: {
      start: 'Start a 10-position session', chip: function (i, n) { return 'Session ' + i + '/' + n; }, end: 'End', seeReport: 'See report',
      title: 'Session report', back: 'Back to the board', again: 'New session', copy: 'Copy summary', copied: 'Summary copied.',
      quality: 'Average move quality', found: 'Best move found', time: 'Time', avg: 'Per position', moves: 'Your moves',
      partial: function (n) { return 'A shorter session: ' + n + ' position' + (n === 1 ? '' : 's') + ' answered.'; },
      worst: function (list) { return 'Tap a move to review it. The weakest were move' + (list.length === 1 ? ' ' : 's ') + list.join(', ') + '.'; },
      noWorst: 'Tap a move to review it. Nothing gave up 5 or more win-% points.',
      summaryText: function (n, quality, found, avg, tiers) { return 'Guess the Move, ' + n + ' positions: average move quality ' + quality + ', best move found ' + found + ' of ' + n + ', ' + avg + ' per position. ' + tiers + '.'; },
      lastTitle: 'Last session',
      lastLine: function (n, quality, found) { return n + ' positions, average move quality ' + quality + ', best move found ' + found + ' times.'; }
    },
    progress: {
      line: function (streak, today, goal) { return 'Streak ' + streak + ' · Today ' + today + (goal ? '/' + goal : ''); },
      reached: function (n) { return 'Daily goal reached: ' + n + ' guesses today.'; }
    },
    issue: { link: 'Report a problem with this position' },
    openingLine: function (name, eco) { return 'Opening: ' + name + (eco ? ' (' + eco + ')' : ''); },
    srs: {
      chip: 'Retry', cardTitle: 'Mistakes to retry',
      cardNone: 'Nothing to retry. A position where you give up 10 or more win-% points in "Find the best move" mode comes back here.',
      cardCounts: function (due, total) { return due + ' due now, ' + total + ' in the queue. A retry comes back after 5, then 15, then 40 positions, and leaves the queue after four good ones.'; },
      retryNow: 'Retry one now'
    },
    link: {
      copyPos: 'Copy a link to this position', copyAnswer: 'Copy a link to my answer', copied: 'Link copied.', copiedAnswer: 'Link to your answer copied.',
      manual: function (url) { return 'Copy this link: ' + url; },
      missing: 'That position is not in this dataset, so here is another one.',
      sharedChip: 'Shared answer'
    },
    tiers: {
      brilliant: { name: 'Brilliant', sym: '!!', desc: 'A best or nearly best move that gives up material.' },
      great: { name: 'Great', sym: '!', desc: 'The only move that holds the position: every alternative gives up at least 15 win-% points.' },
      best: { name: 'Best', sym: '★', desc: 'The engine\'s first choice.' },
      excellent: { name: 'Excellent', sym: '✓', desc: 'Within 2 win-% points of the best move.' },
      good: { name: 'Good', sym: '=', desc: 'Within 5 win-% points of the best move.' },
      inaccuracy: { name: 'Inaccuracy', sym: '?!', desc: 'Gives up 5 to 10 win-% points.' },
      mistake: { name: 'Mistake', sym: '?', desc: 'Gives up 10 to 20 win-% points.' },
      blunder: { name: 'Blunder', sym: '??', desc: 'Gives up 20 or more win-% points.' },
      better: function (pct) { return 'Your move beats ' + pct + '% of the other legal moves.'; },
      barAlt: function (n, parts, yours, pct) { return 'The ' + n + ' legal moves by tier: ' + parts.join(', ') + '. Yours is ' + yours.toLowerCase() + ', better than ' + pct + '% of the others.'; },
      listTitle: function (n) { return 'All ' + n + ' legal moves, best to worst'; },
      listHint: 'Tap a move to draw it on the board. Each tier compares a move with the best one in this position, so it is relative: in a lost position the best move is still Best.',
      scale: 'Move tiers',
      preview: 'Preview'
    },
    level: {
      title: 'Your level',
      unavailable: 'This dataset carries no rating data for the models, so no level estimate is made.',
      need: function (k) { return 'Play ' + k + ' more position' + (k === 1 ? '' : 's') + ' in "Find the best move" mode to get an estimate. Positions you have already seen, and repeats, do not count.'; },
      headline: function (mean) { return 'About ' + mean; },
      range: function (lo, hi, n) { return '80% range ' + lo + ' to ' + hi + ', from your last ' + n + ' first-time guesses.'; },
      caption: 'Each of your moves is compared with how often players of every rating choose it, according to Maia-3. Moves that players of all ratings agree on say nothing; the ones they disagree on say a lot. A rough guide, not a rating.',
      reliability: 'How reliable is this?',
      reliabilityText: 'It assumes you choose like a player of your rating does in a game. Tested on real players of known rating (1300 to 1800), the 80% range held the true rating about 80% of the time, but it was wide: roughly 400 to 700 points after 10 to 40 guesses. The estimates ran lower than the players\' Lichess Rapid ratings, and players rated near 1900 came out near 1650, so do not trust the top of the scale. Details: docs/research/level-eval.json in the source.',
      densityAlt: function (mean, lo, hi) { return 'How likely each rating is, given your moves: most likely around ' + mean + ', 80% between ' + lo + ' and ' + hi + '.'; },
      trendTitle: 'Estimate as you play',
      trendAlt: function (n) { return 'Your estimated rating and its 80% range after each of your ' + n + ' counted guesses.'; },
      suggest: 'Suggest a position that sharpens my estimate',
      picked: 'Chosen to sharpen your estimate',
      pickedBits: function (b) { return 'Chosen to sharpen your estimate (' + b.toFixed(2) + ' bits)'; },
      adaptive: 'Pick positions that sharpen my level estimate',
      adaptiveHelp: 'Chooses positions where players of different ratings disagree most, so fewer guesses are needed. It makes your set of positions less random.'
    },
    statsView: {
      title: 'Your stats', open: 'Open the full stats', back: 'Back to the board', btn: 'Your stats',
      empty: 'Play a few positions and your charts appear here. Everything stays in this browser.',
      need: function (n, mode) { return 'Needs at least ' + n + ' guesses in "' + mode + '" mode.'; },
      modes: { best: 'Find the best move', predict: 'Predict the real move' },
      kpi: { streak: 'Streak', bestStreak: 'Best streak', today: 'Today', guesses: 'Guesses', quality: 'Mean move quality', closeness: 'Mean closeness', found: 'Found a best move', real: 'Matched the real move', maia: 'Matched Maia', time: 'Median time' },
      quality: {
        title: 'Move quality over time',
        caption: function (n, k, a, b) { return n + ' guesses. Your first ' + k + ' averaged ' + a + ', your last ' + k + ' averaged ' + b + '. The line is a 10-guess moving average.'; },
        alt: function (n) { return 'Move quality, 0 to 100, for each of your last ' + n + ' guesses, with a moving average.'; }
      },
      closeness: {
        title: 'Closeness to the real move over time',
        caption: function (n, k, a, b) { return n + ' guesses. Your first ' + k + ' averaged ' + a + ', your last ' + k + ' averaged ' + b + '.'; },
        alt: function (n) { return 'Closeness to the real move, 0 to 100, for each of your last ' + n + ' guesses, with a moving average.'; }
      },
      cost: {
        title: 'How much each guess gave up',
        caption: function (pct) { return pct + '% of your guesses gave up less than 2 win-% points compared with the best move.'; },
        buckets: ['About the best', 'Under 2 points', '2 to 5', '5 to 10', '10 to 20', '20 or more'],
        alt: 'Number of guesses by how many win-percentage points they gave up against the best move.'
      },
      tiers: {
        title: 'Your moves by tier',
        caption: function (pct, n) { return pct + '% of your ' + n + ' best-move guesses were Excellent or better (Brilliant, Great, Best, Excellent).'; },
        alt: 'Number of your best-move guesses in each tier, from Brilliant to Blunder.'
      },
      phases: { opening: 'Opening', middlegame: 'Middlegame', endgame: 'Endgame' },
      phase: {
        title: 'Move quality by phase',
        caption: function (best, worst) { return 'Your best phase is the ' + best.toLowerCase() + ', your weakest the ' + worst.toLowerCase() + '.'; },
        single: 'Play positions from other phases to compare them.',
        alt: 'Mean move quality in each game phase.'
      },
      agree: {
        title: 'Who you agree with', best: 'Stockfish', real: 'The real player', maia: 'Maia',
        caption: 'How often your move was the same as each reference.',
        alt: 'Share of your guesses that matched Stockfish, the real player and Maia.'
      },
      time: {
        title: 'Time and quality',
        caption: 'Each dot is a guess: time spent against move quality.',
        split: function (at, fast, slow) { return 'Guesses taking ' + at + ' or less averaged ' + fast + '; slower ones averaged ' + slow + '.'; },
        alt: function (n) { return 'Time spent against move quality for ' + n + ' guesses.'; }
      }
    },
    menu: { open: 'Menu: how it works, about the data, credits' , close: 'Close the menu' },
    about: {
      loading: 'Loading…',
      positions: function (n, dates) { return n + ' positions from real Lichess games' + (dates ? ', ' + dates : '') + '.'; },
      dates: function (a, b) { return a === b ? 'played on ' + a : 'played between ' + a + ' and ' + b; },
      engine: function (name, nodes) {
        return name + ' scored every legal move of every position' + (nodes ? ' with a fixed budget of ' + Number(nodes).toLocaleString('en-US') + ' nodes' : '') + ', so the scores are reproducible.';
      },
      maia: function (model, plies) {
        return model + ' gave the probability that a player of the real player\'s rating would choose each move' +
          (plies ? ', seeing the last ' + plies + ' positions of the game' : '') + '.';
      },
      noMaia: 'This dataset has no human-model (Maia) data.',
      source: function (file) { return 'Source file: ' + file + ' (CC0).'; },
      built: function (iso) { return 'Built on ' + String(iso).slice(0, 10) + '.'; },
      names: 'Player names are not stored. Each result links to the original game on Lichess.',
      namesStored: 'This dataset also stores the players\' Lichess usernames.'
    },
    onboarding: { title: 'How it works', close: 'Got it' }
  };
}));

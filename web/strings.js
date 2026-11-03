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
    letters: { you: 'Y', best: 'S', real: 'R', maia: 'M' },
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
    next: 'Next position (n)',
    skip: 'Skip',
    toggleThemeToDark: 'Switch to the dark theme',
    toggleThemeToLight: 'Switch to the light theme',
    noMaia: 'No human-model data for this position (unknown rating), so plausibility is not shown.',
    sourceGame: 'Source game',
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
    settings: { confirm: 'Confirm moves before revealing', confirmHelp: 'Useful on touch screens, where a slip of the finger would reveal the answer.' },
    onboarding: { title: 'How it works', close: 'Got it' }
  };
}));

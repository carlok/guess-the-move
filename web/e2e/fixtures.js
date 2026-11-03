'use strict';
/* SYNTHETIC positions (hand-written evals) for exercising the UI. Not chess data, never shipped.
 * Only the listed moves are "legal" as far as the app is concerned (it takes them from `evals`). */
const ROOK = {
  id: 'rook', fen: '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', ply: 0, move_no: 1, stm: 'w', phase: 'endgame',
  player_elo: 1500, opp_elo: 1500, real: 'g1g2',
  evals: { a1a8: 9999, a1a7: 300, a1a2: 120, g1g2: 0, g1f1: -5 },
  san: { a1a8: 'Ra8#', a1a7: 'Ra7', a1a2: 'Ra2', g1g2: 'Kg2', g1f1: 'Kf1' },
  maia: { elo: 1500, probs: { g1g2: 0.5, g1f1: 0.3, a1a7: 0.2 } }, tags: ['real_mistake', 'hard_find'], site: null,
};
const PROMO = {
  id: 'promo', fen: '8/P7/8/8/8/8/k6K/8 w - - 0 1', ply: 40, move_no: 21, stm: 'w', phase: 'middlegame',
  player_elo: null, opp_elo: null, real: 'a7a8q',
  evals: { a7a8q: 900, a7a8r: 500, a7a8b: 200, a7a8n: 200, h2h3: 0 },
  san: { a7a8q: 'a8=Q', a7a8r: 'a8=R', a7a8b: 'a8=B', a7a8n: 'a8=N', h2h3: 'Kh3' },
  maia: null, tags: ['real_is_best'], site: null,
};
const BLACK = {
  id: 'black', fen: '6k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', ply: 41, move_no: 22, stm: 'b', phase: 'opening',
  player_elo: null, opp_elo: null, real: 'g8f8', evals: { g8f8: 0, h7h6: 10, g8h8: -3 },
  san: { g8f8: 'Kf8', h7h6: 'h6', g8h8: 'Kh8' }, maia: null, tags: [], site: null,
};
module.exports = { ROOK, PROMO, BLACK };

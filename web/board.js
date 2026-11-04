// SPDX-License-Identifier: AGPL-3.0-or-later
/* Board geometry and the drag gesture state machine. Pure functions, no DOM: unit-tested in node.
 * Squares are named "a1".."h8". The board is drawn in an 800x800 viewBox, one square = 100 units.
 * `flipped` means Black is at the bottom. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GTM_BOARD = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FILES = 'abcdefgh';
  var DRAG_THRESHOLD = 4; // px of pointer travel before a press becomes a drag; below it, a press is a tap
  var PIECE_NAME = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };

  function parseFen(fen) {
    var parts = fen.split(' '), board = new Array(64).fill(null);
    parts[0].split('/').forEach(function (row, i) {
      var rank = 7 - i, file = 0;
      row.split('').forEach(function (ch) {
        if (/\d/.test(ch)) file += Number(ch); else { board[rank * 8 + file] = ch; file++; }
      });
    });
    return { board: board, stm: parts[1] };
  }

  function sqName(i) { return FILES[i % 8] + (Math.floor(i / 8) + 1); }
  function sqIndex(n) { return (Number(n[1]) - 1) * 8 + FILES.indexOf(n[0]); }

  /* Column and row (0..7, from the top-left of the drawn board) of square index i. */
  function xy(i, flipped) {
    var f = i % 8, r = Math.floor(i / 8);
    return flipped ? [7 - f, r] : [f, 7 - r];
  }

  function center(name, flipped) {
    var p = xy(sqIndex(name), flipped);
    return [p[0] * 100 + 50, p[1] * 100 + 50];
  }

  /* The square under a client point, or null when the point is outside the board rectangle. */
  function squareFromPoint(x, y, rect, flipped) {
    var col = Math.floor(((x - rect.left) / rect.width) * 8);
    var row = Math.floor(((y - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return null;
    return sqName(flipped ? (row * 8 + (7 - col)) : ((7 - row) * 8 + col));
  }

  /* Client point to viewBox units (for placing the drag ghost). */
  function toViewBox(x, y, rect) {
    return [((x - rect.left) / rect.width) * 800, ((y - rect.top) / rect.height) * 800];
  }

  /* Square the player sees at the bottom-left: a1 for White, h8 for Black. */
  function homeSquare(flipped) { return flipped ? 'h8' : 'a1'; }

  /* Move a keyboard cursor one square in screen direction; stays put at the edge. */
  function step(sq, key, flipped) {
    if (key === 'Home') return homeSquare(flipped);
    var f = FILES.indexOf(sq[0]), r = Number(sq[1]) - 1;
    var sign = flipped ? -1 : 1;
    if (key === 'ArrowUp') r += sign;
    else if (key === 'ArrowDown') r -= sign;
    else if (key === 'ArrowRight') f += sign;
    else if (key === 'ArrowLeft') f -= sign;
    f = Math.max(0, Math.min(7, f)); r = Math.max(0, Math.min(7, r));
    return FILES[f] + (r + 1);
  }

  /* "white rook", or null for an empty square. */
  function pieceName(ch) {
    return ch ? (ch === ch.toUpperCase() ? 'white ' : 'black ') + PIECE_NAME[ch.toLowerCase()] : null;
  }

  /* Sprite id of a FEN piece letter: "N" -> "wN", "p" -> "bP". */
  function spriteId(ch) { return (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase(); }

  /* Line for an arrow from one square to another. Returns the shaft (start and end short of the squares' centres), the
   * arrow head triangle and a label anchor on the shaft. */
  function arrowGeometry(fromSq, toSq, flipped) {
    var c1 = center(fromSq, flipped), c2 = center(toSq, flipped);
    var dx = c2[0] - c1[0], dy = c2[1] - c1[1], len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    var x1 = c1[0] + ux * 20, y1 = c1[1] + uy * 20;
    var tx = c2[0] - ux * 14, ty = c2[1] - uy * 14; // arrow tip
    var bx = tx - ux * 28, by = ty - uy * 28;                  // head base, where the shaft ends
    var head = [[tx, ty], [bx - uy * 16, by + ux * 16], [bx + uy * 16, by - ux * 16]];
    return { x1: x1, y1: y1, x2: bx, y2: by, head: head, lx: x1 + (bx - x1) * 0.4, ly: y1 + (by - y1) * 0.4 };
  }

  /* One press-move-release by a single pointer. Decides tap vs drag; owns no DOM.
   *   down(sq, x, y, own, wasSelected) -> true when the pressed own piece should be selected right away
   *   move(x, y)                       -> 'start' (drag just began), 'drag', or null
   *   up()                             -> {type: 'tap', sq, selectedOnDown} | {type: 'drop', from} | {type: 'none'}
   *   cancel()                         -> true if a drag was in progress; later up()/move() do nothing */
  function gesture() {
    var g = { sq: null, x: 0, y: 0, own: false, selectedOnDown: false, dragging: false, dead: true };
    return {
      down: function (sq, x, y, own, wasSelected) {
        g = { sq: sq, x: x, y: y, own: own, selectedOnDown: own && !wasSelected, dragging: false, dead: false };
        return g.selectedOnDown;
      },
      move: function (x, y) {
        if (g.dead || !g.own) return null;
        if (g.dragging) return 'drag';
        if (Math.hypot(x - g.x, y - g.y) < DRAG_THRESHOLD) return null;
        g.dragging = true;
        return 'start';
      },
      up: function () {
        if (g.dead) return { type: 'none' };
        g.dead = true;
        return g.dragging ? { type: 'drop', from: g.sq } : { type: 'tap', sq: g.sq, selectedOnDown: g.selectedOnDown };
      },
      cancel: function () { var was = !g.dead && g.dragging; g.dead = true; return was; },
      active: function () { return !g.dead; },
      dragging: function () { return !g.dead && g.dragging; },
      from: function () { return g.sq; }
    };
  }

  return {
    FILES: FILES, DRAG_THRESHOLD: DRAG_THRESHOLD, parseFen: parseFen, sqName: sqName, sqIndex: sqIndex, xy: xy,
    center: center, squareFromPoint: squareFromPoint, toViewBox: toViewBox, homeSquare: homeSquare, step: step,
    pieceName: pieceName, spriteId: spriteId, arrowGeometry: arrowGeometry, gesture: gesture
  };
}));

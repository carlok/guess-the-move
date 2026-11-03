'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../board.js');

const RECT = { left: 100, top: 50, width: 400, height: 400 }; // a board drawn 400px wide at (100, 50)

test('FEN parsing places pieces by rank and file', () => {
  const p = B.parseFen('r3k3/8/8/8/8/8/P7/4K2R b Kq - 0 1');
  assert.equal(p.stm, 'b');
  assert.equal(p.board[B.sqIndex('a8')], 'r');
  assert.equal(p.board[B.sqIndex('e8')], 'k');
  assert.equal(p.board[B.sqIndex('a2')], 'P');
  assert.equal(p.board[B.sqIndex('h1')], 'R');
  assert.equal(p.board.filter(Boolean).length, 5);
});

test('square names and indices round-trip', () => {
  for (let i = 0; i < 64; i++) assert.equal(B.sqIndex(B.sqName(i)), i);
  assert.equal(B.sqName(0), 'a1'); assert.equal(B.sqName(63), 'h8');
});

test('xy and center draw White at the bottom, or Black when flipped', () => {
  assert.deepEqual(B.xy(B.sqIndex('a1'), false), [0, 7]);
  assert.deepEqual(B.xy(B.sqIndex('a1'), true), [7, 0]);
  assert.deepEqual(B.center('a1', false), [50, 750]);
  assert.deepEqual(B.center('h8', true), [50, 750]);
});

test('squareFromPoint maps a client point to a square, honouring orientation and the board edges', () => {
  assert.equal(B.squareFromPoint(110, 440, RECT, false), 'a1');
  assert.equal(B.squareFromPoint(490, 60, RECT, false), 'h8');
  assert.equal(B.squareFromPoint(110, 440, RECT, true), 'h8');
  assert.equal(B.squareFromPoint(490, 60, RECT, true), 'a1');
  assert.equal(B.squareFromPoint(300, 250, RECT, false), 'e4'); // centre: column 4 (e), row 4 from the top (rank 4)
  assert.equal(B.squareFromPoint(99, 250, RECT, false), null);
  assert.equal(B.squareFromPoint(500, 250, RECT, false), null);
  assert.equal(B.squareFromPoint(300, 49, RECT, false), null);
  assert.equal(B.squareFromPoint(300, 450, RECT, false), null);
});

test('toViewBox scales client pixels to the 800-unit board', () => {
  assert.deepEqual(B.toViewBox(300, 250, RECT), [400, 400]);
  assert.deepEqual(B.toViewBox(100, 50, RECT), [0, 0]);
});

test('the keyboard cursor moves in screen directions and stops at the edges', () => {
  assert.equal(B.homeSquare(false), 'a1'); assert.equal(B.homeSquare(true), 'h8');
  assert.equal(B.step('e4', 'ArrowUp', false), 'e5');
  assert.equal(B.step('e4', 'ArrowDown', false), 'e3');
  assert.equal(B.step('e4', 'ArrowRight', false), 'f4');
  assert.equal(B.step('e4', 'ArrowLeft', false), 'd4');
  assert.equal(B.step('e4', 'ArrowUp', true), 'e3', 'up on screen is down the ranks when Black is at the bottom');
  assert.equal(B.step('e4', 'ArrowRight', true), 'd4');
  assert.equal(B.step('a1', 'ArrowLeft', false), 'a1');
  assert.equal(B.step('h8', 'ArrowUp', false), 'h8');
  assert.equal(B.step('h8', 'ArrowRight', false), 'h8');
  assert.equal(B.step('a1', 'ArrowDown', false), 'a1');
  assert.equal(B.step('e4', 'Home', true), 'h8');
  assert.equal(B.step('e4', 'x', false), 'e4', 'other keys leave the cursor alone');
});

test('piece names and sprite ids', () => {
  assert.equal(B.pieceName('N'), 'white knight');
  assert.equal(B.pieceName('q'), 'black queen');
  assert.equal(B.pieceName(null), null);
  assert.equal(B.spriteId('N'), 'wN'); assert.equal(B.spriteId('p'), 'bP');
});

test('arrow geometry: the shaft stops short of the target and the head points at it', () => {
  const g = B.arrowGeometry('a1', 'a8', false); // straight up the a-file
  assert.ok(g.y1 < 750 && g.y1 > g.y2, 'drawn upwards');
  assert.equal(g.x1, 50); assert.equal(g.x2, 50);
  assert.ok(g.head[0][1] < g.y2 && g.head[0][1] > 50, 'the tip is beyond the shaft end but inside the target square');
  assert.equal(g.head.length, 3);
  assert.ok(g.lx === 50 && g.ly < g.y1 && g.ly > g.y2, 'label sits on the shaft');
  const flipped = B.arrowGeometry('a1', 'a8', true);
  assert.ok(flipped.y1 > 0 && flipped.y1 < flipped.y2, 'drawn downwards when Black is at the bottom');
  const same = B.arrowGeometry('c3', 'c3', false); // degenerate: must not divide by zero
  assert.ok(Number.isFinite(same.x1) && Number.isFinite(same.head[0][0]));
});

test('gesture: a press that never moves is a tap on the pressed square', () => {
  const g = B.gesture();
  assert.equal(g.down('e2', 10, 10, true, false), true, 'an own piece pressed while not selected is selected right away');
  assert.equal(g.move(12, 11), null, 'under the threshold');
  assert.deepEqual(g.up(), { type: 'tap', sq: 'e2', selectedOnDown: true });
  assert.deepEqual(g.up(), { type: 'none' }, 'a finished gesture ignores further events');
});

test('gesture: travel past the threshold starts a drag, and release is a drop from the pressed square', () => {
  const g = B.gesture();
  g.down('e2', 0, 0, true, true);
  assert.equal(g.active(), true); assert.equal(g.dragging(), false); assert.equal(g.from(), 'e2');
  assert.equal(g.move(B.DRAG_THRESHOLD - 1, 0), null);
  assert.equal(g.move(3, 3), 'start');
  assert.equal(g.dragging(), true);
  assert.equal(g.move(50, 50), 'drag');
  assert.deepEqual(g.up(), { type: 'drop', from: 'e2' });
  assert.equal(g.active(), false);
});

test('gesture: an already selected piece is not re-selected, and a press on a non-own square never drags', () => {
  const g = B.gesture();
  assert.equal(g.down('e2', 0, 0, true, true), false);
  assert.equal(g.up().selectedOnDown, false);
  g.down('e4', 0, 0, false, false);
  assert.equal(g.move(100, 100), null);
  assert.deepEqual(g.up(), { type: 'tap', sq: 'e4', selectedOnDown: false });
});

test('gesture: cancel reports whether a drag was running and silences the rest of the sequence', () => {
  const g = B.gesture();
  g.down('e2', 0, 0, true, false); g.move(30, 0);
  assert.equal(g.cancel(), true);
  assert.equal(g.move(60, 0), null);
  assert.deepEqual(g.up(), { type: 'none' });
  g.down('e2', 0, 0, true, false);
  assert.equal(g.cancel(), false, 'cancelling a plain press is not a cancelled drag');
  assert.equal(B.gesture().cancel(), false);
});

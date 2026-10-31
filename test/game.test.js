import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLOCKED,
  blockedCount,
  claimCell,
  createGame,
  currentPlayerId,
  emptyCells,
  findGroups,
  scoreGame,
} from '../server/game.js';

const SIX = { cols: 6, rows: 6 };

// Fills the board with the given owners, ignoring turn order, then scores the last move.
function finishWith(ids, owners) {
  const game = createGame(ids, SIX);
  game.board = [...owners];
  const last = owners.length - 1;
  game.board[last] = null;
  game.moves = owners.length - 1;
  game.turnIndex = ids.indexOf(owners[last]);
  assert.equal(claimCell(game, owners[last], last), null);
  return game;
}

test('every allowed board and player count leaves equal turns', () => {
  for (let cols = 4; cols <= 12; cols += 1) {
    for (let rows = 4; rows <= 16; rows += 1) {
      for (let count = 2; count <= 6; count += 1) {
        const leftover = blockedCount(cols, rows, count);
        assert.equal((cols * rows - leftover) % count, 0);
        assert.ok(cols * rows - leftover >= count);
      }
    }
  }
});

test('unsupported setups are refused', () => {
  assert.throws(() => createGame([1], SIX));
  assert.throws(() => createGame([1, 2, 3, 4, 5, 6, 7], SIX));
  assert.throws(() => createGame([1, 2], { cols: 3, rows: 6 }));
  assert.throws(() => createGame([1, 2], { cols: 13, rows: 6 }));
  assert.throws(() => createGame([1, 2], { cols: 6, rows: 17 }));
  assert.throws(() => createGame([1, 2], { cols: 6.5, rows: 6 }));
  assert.throws(() => createGame([1, 2, 3, 4], { cols: 5, rows: 5 }), 'needs 1 blocked square');
});

test('blocked squares cannot be claimed, split groups, and end the game early', () => {
  const game = createGame([1, 2, 3], { cols: 4, rows: 4, blocked: [1] });
  assert.equal(game.board[1], BLOCKED);
  assert.equal(claimCell(game, 1, 1), 'cell_taken');
  assert.equal(claimCell(game, 1, 0), null);
  assert.equal(claimCell(game, 2, 4), null);
  assert.equal(claimCell(game, 3, 8), null);
  assert.equal(claimCell(game, 1, 2), null);
  assert.deepEqual(findGroups(game, 1).map((group) => group.length), [1, 1]);

  while (emptyCells(game).length > 0) {
    assert.equal(game.result, null);
    assert.equal(claimCell(game, currentPlayerId(game), emptyCells(game)[0]), null);
  }
  assert.ok(game.result);
  const totals = scoreGame(game);
  assert.deepEqual([1, 2, 3].map((id) => totals[id].total), [5, 5, 5]);
});

test('turns rotate and moves are validated', () => {
  const game = createGame([1, 2], SIX);
  assert.equal(claimCell(game, 2, 0), 'not_your_turn');
  assert.equal(claimCell(game, 1, 0), null);
  assert.equal(currentPlayerId(game), 2);
  assert.equal(claimCell(game, 2, 0), 'cell_taken');
  for (const bad of [-1, 36, 1.5, '1', null, undefined]) {
    assert.equal(claimCell(game, 2, bad), 'invalid_cell');
  }
  assert.equal(game.moves, 1);
});

test('firstIndex chooses who starts', () => {
  assert.equal(currentPlayerId(createGame([1, 2, 3], { ...SIX, firstIndex: 4 })), 2);
});

test('groups connect by sides only, never by corners or board wrap', () => {
  const sizes = (cells) => {
    const game = createGame([1, 2], SIX);
    for (const cell of cells) game.board[cell] = 1;
    return findGroups(game, 1).map((group) => group.length);
  };
  assert.deepEqual(sizes([0, 7]), [1, 1], 'corners do not connect');
  // Cells 5 and 6 are neighbours by index only: end of row 1 and start of row 2.
  assert.deepEqual(sizes([5, 6]), [1, 1], 'rows do not wrap');
  assert.deepEqual(sizes([0, 1, 7]), [3], 'sides connect');
  assert.deepEqual(sizes([0, 6, 20]), [2, 1], 'columns connect');
});

test('scores report the largest group and total', () => {
  const game = createGame([1, 2], SIX);
  for (const cell of [0, 1, 2, 20]) game.board[cell] = 1;
  const score = scoreGame(game);
  assert.equal(score[1].largest, 3);
  assert.equal(score[1].total, 4);
  assert.deepEqual([...score[1].cells].sort((a, b) => a - b), [0, 1, 2]);
  assert.equal(score[2].largest, 0);
});

test('biggest group wins when the board fills', () => {
  // Player 1 holds the top three rows and player 2 the bottom three, then they swap one square.
  // Player 2's new square touches their area (18), but player 1's is isolated (17 + 1).
  const owners = new Array(36).fill(0).map((_, i) => (i < 18 ? 1 : 2));
  owners[17] = 2;
  owners[35] = 1;
  const game = finishWith([1, 2], owners);
  assert.deepEqual(game.result, { winnerIds: [2], reason: 'largest' });
});

test('second-biggest group breaks a tie on the largest', () => {
  // Both largest groups are 6. Player 1's next group is 5, and player 2's next group is 6.
  const owners = [
    1, 1, 2, 2, 1, 1,
    2, 1, 1, 2, 1, 1,
    1, 2, 1, 2, 1, 1,
    2, 1, 2, 1, 2, 2,
    2, 2, 2, 1, 2, 1,
    1, 2, 1, 2, 2, 2,
  ];
  const game = finishWith([1, 2], owners);
  const sizes = (id) => findGroups(game, id).map((group) => group.length);
  assert.deepEqual(sizes(1).slice(0, 2), [6, 5]);
  assert.deepEqual(sizes(2).slice(0, 2), [6, 6]);
  assert.deepEqual(game.result, { winnerIds: [2], reason: 'tiebreak' });
});

test('identical group sizes share the win', () => {
  // Checkerboard: everyone has 18 single squares.
  const owners = new Array(36).fill(0).map((_, i) => {
    const row = Math.floor(i / 6);
    return (i + row) % 2 === 0 ? 1 : 2;
  });
  const game = finishWith([1, 2], owners);
  assert.deepEqual(game.result, { winnerIds: [1, 2], reason: 'draw' });
});

test('a finished game refuses more moves', () => {
  const game = createGame([1, 2], SIX);
  while (emptyCells(game).length > 0) {
    assert.equal(claimCell(game, currentPlayerId(game), emptyCells(game)[0]), null);
  }
  assert.ok(game.result);
  assert.equal(claimCell(game, currentPlayerId(game), 0), 'game_over');
});

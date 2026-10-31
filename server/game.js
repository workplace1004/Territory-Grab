// Pure game rules. No timers, sockets or randomness, so every rule is easy to test.

export const MIN_BOARD_SIDE = 4;
export const MAX_BOARD_WIDTH = 12;
export const MAX_BOARD_HEIGHT = 16;
export const DEFAULT_BOARD = { cols: 8, rows: 8 };

// A board value for squares nobody can claim. Player ids are always positive.
export const BLOCKED = -1;

export function isValidBoardSize(cols, rows) {
  return (
    Number.isInteger(cols) &&
    Number.isInteger(rows) &&
    cols >= MIN_BOARD_SIDE &&
    cols <= MAX_BOARD_WIDTH &&
    rows >= MIN_BOARD_SIDE &&
    rows <= MAX_BOARD_HEIGHT
  );
}

// Leftover squares are blocked, so every player always gets the same number of turns.
export function blockedCount(cols, rows, playerCount) {
  return (cols * rows) % playerCount;
}

export function createGame(playerIds, { cols, rows, firstIndex = 0, blocked = [] }) {
  if (playerIds.length < 2 || playerIds.length > 6) {
    throw new Error(`Unsupported player count: ${playerIds.length}`);
  }
  if (!isValidBoardSize(cols, rows)) throw new Error(`Unsupported board: ${cols} x ${rows}`);
  if (blocked.length !== blockedCount(cols, rows, playerIds.length)) {
    throw new Error('Blocked squares must leave equal turns');
  }
  const board = new Array(cols * rows).fill(null);
  for (const cell of blocked) board[cell] = BLOCKED;
  return {
    cols,
    rows,
    board,
    playable: board.length - blocked.length,
    playerIds: [...playerIds],
    turnIndex: firstIndex % playerIds.length,
    lastCell: null,
    moves: 0,
    result: null,
  };
}

export function currentPlayerId(game) {
  return game.playerIds[game.turnIndex];
}

export function emptyCells(game) {
  const cells = [];
  game.board.forEach((owner, cell) => {
    if (owner === null) cells.push(cell);
  });
  return cells;
}

// Returns an error code, or null when the claim was applied.
export function claimCell(game, playerId, cell) {
  if (game.result) return 'game_over';
  if (playerId !== currentPlayerId(game)) return 'not_your_turn';
  if (!Number.isInteger(cell) || cell < 0 || cell >= game.board.length) return 'invalid_cell';
  if (game.board[cell] !== null) return 'cell_taken';

  game.board[cell] = playerId;
  game.lastCell = cell;
  game.moves += 1;
  if (game.moves === game.playable) {
    game.result = decideResult(game);
  } else {
    game.turnIndex = (game.turnIndex + 1) % game.playerIds.length;
  }
  return null;
}

// Connected groups for one player, biggest first. Each group is a list of cells.
export function findGroups(game, playerId) {
  const { board, cols, rows } = game;
  const seen = new Set();
  const groups = [];

  board.forEach((owner, start) => {
    if (owner !== playerId || seen.has(start)) return;
    const group = [];
    const stack = [start];
    seen.add(start);
    while (stack.length > 0) {
      const cell = stack.pop();
      group.push(cell);
      const col = cell % cols;
      const row = Math.floor(cell / cols);
      const neighbours = [];
      if (col > 0) neighbours.push(cell - 1);
      if (col < cols - 1) neighbours.push(cell + 1);
      if (row > 0) neighbours.push(cell - cols);
      if (row < rows - 1) neighbours.push(cell + cols);
      for (const next of neighbours) {
        if (board[next] === playerId && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    groups.push(group);
  });

  return groups.sort((a, b) => b.length - a.length);
}

export function scoreGame(game) {
  const scores = {};
  for (const id of game.playerIds) {
    const groups = findGroups(game, id);
    scores[id] = {
      largest: groups[0]?.length ?? 0,
      total: groups.reduce((sum, group) => sum + group.length, 0),
      cells: groups[0] ?? [],
    };
  }
  return scores;
}

// Compares group sizes from biggest to smallest. Positive means a is ahead.
function compareSizes(a, b) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function decideResult(game) {
  const sizes = new Map(
    game.playerIds.map((id) => [id, findGroups(game, id).map((group) => group.length)]),
  );
  let best = sizes.get(game.playerIds[0]);
  for (const size of sizes.values()) {
    if (compareSizes(size, best) > 0) best = size;
  }

  const winnerIds = game.playerIds.filter((id) => compareSizes(sizes.get(id), best) === 0);
  const sameLargest = game.playerIds.filter((id) => sizes.get(id)[0] === best[0]);
  let reason = 'largest';
  if (winnerIds.length > 1) reason = 'draw';
  else if (sameLargest.length > 1) reason = 'tiebreak';
  return { winnerIds, reason };
}

// The small board on the home screen that plays itself as a preview of the game.
import { linkClasses, prefersReducedMotion, SYMBOLS } from './shared.js';

const COLS = 5;
const SIZE = COLS * COLS;
const MOVE_MS = 650;
const HOLD_MS = 2600;
// [square, player]. Three players take turns and each builds one connected group.
const MOVES = [
  [6, 0], [2, 1], [10, 2],
  [7, 0], [3, 1], [15, 2],
  [12, 0], [4, 1], [20, 2],
  [13, 0], [9, 1], [21, 2],
  [18, 0], [14, 1], [16, 2],
];

const home = document.getElementById('home');
const board = document.getElementById('hero-board');
const cells = Array.from({ length: SIZE }, () => {
  const cell = document.createElement('div');
  cell.className = 'cell open';
  return cell;
});
board.replaceChildren(...cells);

function draw(moveCount) {
  const owners = new Array(SIZE).fill(null);
  for (const [cell, slot] of MOVES.slice(0, moveCount)) owners[cell] = slot;
  const newest = moveCount > 0 ? MOVES[moveCount - 1][0] : -1;
  owners.forEach((slot, index) => {
    const cell = cells[index];
    if (slot === null) {
      cell.className = 'cell open';
      cell.textContent = '';
      return;
    }
    const links = linkClasses(owners, index, COLS, (owner) => owner !== null);
    cell.className = ['cell', 'owned', 'core', `slot-${slot}`, ...links].join(' ');
    if (index === newest) cell.classList.add('fresh');
    cell.textContent = SYMBOLS[slot];
  });
}

function play(moveCount) {
  // The loop rests while another screen is showing.
  if (home.hidden) {
    setTimeout(() => play(moveCount), MOVE_MS);
    return;
  }
  draw(moveCount);
  if (moveCount === MOVES.length) setTimeout(() => play(0), HOLD_MS);
  else setTimeout(() => play(moveCount + 1), MOVE_MS);
}

if (prefersReducedMotion()) draw(MOVES.length);
else play(0);

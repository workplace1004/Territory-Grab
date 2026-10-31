// The "How to play" lesson: short animated scenes that loop like a video.
// Board frames are rows of text: A/B are bright (biggest group), a/b are dim, and . is empty.
// `tap` is [row, col] for the square being tapped. `win` makes Red's bright squares pulse.

import { linkClasses, SYMBOLS } from './shared.js';

const FRAME_MS = 2400;
const SYMBOL_BY_MARK = { a: SYMBOLS[0], b: SYMBOLS[1] };

const STEPS = [
  {
    title: 'Start a game with friends',
    text: 'One player creates a room. Everyone else joins with its 4-letter code.',
    cards: [
      { heading: 'Enter your name', detail: 'Then tap Create a room.' },
      { heading: 'Share the code', detail: 'Send friends the code ABCD or the invite link.' },
      { heading: 'Friends join', detail: 'They enter the code and tap Join.' },
      { heading: 'Start the game', detail: 'The host sets the board size and taps Start game. You need 2 to 6 players.' },
    ],
  },
  {
    title: 'Take turns claiming squares',
    text: 'When it is your turn, tap any empty square. You have 20 seconds, or the game picks a random square for you.',
    frames: [
      { rows: ['....', '....', '....', '....'], tap: [1, 1], note: 'Red taps any empty square.' },
      { rows: ['....', '.A..', '....', '....'], note: 'That square now belongs to Red.' },
      { rows: ['....', '.A..', '....', '....'], tap: [2, 2], note: "Now it is Blue's turn." },
      { rows: ['....', '.A..', '..B.', '....'], note: 'Blue claims a square too.' },
      { rows: ['....', '.A..', '..B.', '....'], tap: [1, 2], note: "Back to Red's turn." },
      { rows: ['....', '.AA.', '..B.', '....'], note: 'Squares that are taken cannot be changed.' },
    ],
  },
  {
    title: 'Connect your squares by their sides',
    text: 'Squares that touch by a side form a group. Corners do not connect. Your biggest group is shown bright.',
    frames: [
      { rows: ['....', '.A..', '....', '....'], note: 'One square is a group of 1.' },
      { rows: ['....', '.A..', '..a.', '....'], note: 'These only touch at a corner, so the biggest group is still 1.' },
      { rows: ['....', '.A..', '..a.', '....'], tap: [1, 2], note: 'Red taps the square that touches both.' },
      { rows: ['....', '.AA.', '..A.', '....'], note: 'Now they connect: a group of 3!' },
    ],
  },
  {
    title: 'Block your opponent',
    text: 'Your squares can also cut off other players, so watch where they are growing.',
    frames: [
      { rows: ['....', 'AAA.', '....', 'B...'], note: 'Red is building a long line.' },
      { rows: ['....', 'AAA.', '....', 'B...'], tap: [1, 3], note: 'Blue taps the square in the way.' },
      { rows: ['....', 'AAAB', '....', 'b...'], note: 'Red is blocked on that side.' },
      { rows: ['....', 'AAAB', '..A.', 'b...'], note: 'Red must grow in another direction.' },
    ],
  },
  {
    title: 'The biggest group wins',
    text: 'When the board is full, the player with the biggest connected group wins. On a tie, the next biggest group decides.',
    frames: [
      { rows: ['AAAB', 'ABBB', 'AAA.', 'bbbb'], tap: [2, 3], note: 'Red claims the last square.' },
      { rows: ['AAAB', 'ABBB', 'AAAA', 'bbbb'], win: true, note: 'Red has a group of 8. Blue has only 4. Red wins!' },
    ],
  },
];

const $ = (id) => document.getElementById(id);
const dialog = $('learn');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

let stepIndex = 0;
let frameIndex = 0;
let timer = null;
let paused = false;

function frameCount(step) {
  return (step.frames ?? step.cards).length;
}

function drawBoard(frame, previous) {
  const cols = frame.rows[0].length;
  const owners = frame.rows.join('').toLowerCase().split('');
  const before = previous?.rows.join('');
  const board = document.createElement('div');
  board.className = 'demo-board';
  board.style.setProperty('--cols', cols);
  board.setAttribute('aria-hidden', 'true');
  frame.rows.forEach((row, rowIndex) => {
    [...row].forEach((mark, colIndex) => {
      const cell = document.createElement('div');
      const tapped = frame.tap?.[0] === rowIndex && frame.tap?.[1] === colIndex;
      if (mark === '.') {
        cell.className = tapped ? 'cell open tapped' : 'cell open';
        if (tapped) cell.textContent = '👆';
      } else {
        const lower = mark.toLowerCase();
        const bright = mark !== lower;
        const index = rowIndex * cols + colIndex;
        cell.className = `cell owned slot-${lower === 'a' ? 0 : 1}`;
        cell.classList.add(...linkClasses(owners, index, cols, (owner) => owner !== '.'));
        if (bright) cell.classList.add('core');
        if (mark === 'A' && frame.win) cell.classList.add('win');
        if (before?.[index] === '.') cell.classList.add('fresh');
        cell.textContent = SYMBOL_BY_MARK[lower];
      }
      board.append(cell);
    });
  });
  return board;
}

function drawCards(step, active) {
  const list = document.createElement('ol');
  list.className = 'demo-cards';
  step.cards.forEach((card, index) => {
    const item = document.createElement('li');
    item.className = index === active ? 'active' : '';
    const heading = document.createElement('strong');
    heading.textContent = card.heading;
    const detail = document.createElement('span');
    detail.textContent = card.detail;
    item.append(heading, detail);
    list.append(item);
  });
  return list;
}

function drawFrame() {
  const step = STEPS[stepIndex];
  if (step.cards) {
    $('learn-scene').replaceChildren(drawCards(step, frameIndex));
    $('learn-note').textContent = '';
    $('learn-note').hidden = true;
    return;
  }
  const frame = step.frames[frameIndex];
  $('learn-scene').replaceChildren(drawBoard(frame, step.frames[frameIndex - 1]));
  $('learn-note').textContent = frame.note;
  $('learn-note').hidden = false;
}

function schedule() {
  clearTimeout(timer);
  if (paused || !dialog.open) return;
  timer = setTimeout(() => {
    frameIndex = (frameIndex + 1) % frameCount(STEPS[stepIndex]);
    drawFrame();
    schedule();
  }, FRAME_MS);
}

function setPaused(value) {
  paused = value;
  $('learn-pause').textContent = paused ? '▶ Play' : '⏸ Pause';
  $('learn-pause').setAttribute('aria-pressed', String(paused));
  schedule();
}

function showStep(index) {
  stepIndex = index;
  // With reduced motion, start on the final frame, which shows the outcome.
  frameIndex = paused ? frameCount(STEPS[index]) - 1 : 0;
  const step = STEPS[index];
  $('learn-progress').textContent = `Step ${index + 1} of ${STEPS.length}`;
  $('learn-title').textContent = step.title;
  $('learn-text').textContent = step.text;
  $('learn-back').disabled = index === 0;
  $('learn-next').textContent = index === STEPS.length - 1 ? 'Got it!' : 'Next';
  drawFrame();
  if (!reducedMotion.matches) {
    const keyframes = [{ opacity: 0, transform: 'translateX(14px)' }, { opacity: 1, transform: 'none' }];
    for (const id of ['learn-body', 'learn-scene']) {
      $(id).animate(keyframes, { duration: 260, easing: 'ease-out' });
    }
  }
  schedule();
}

function open() {
  paused = reducedMotion.matches;
  dialog.showModal();
  setPaused(paused);
  showStep(0);
}

for (const button of document.querySelectorAll('.learn-open')) {
  button.addEventListener('click', open);
}
$('learn-close').addEventListener('click', () => dialog.close());
$('learn-pause').addEventListener('click', () => setPaused(!paused));
$('learn-back').addEventListener('click', () => showStep(stepIndex - 1));
$('learn-next').addEventListener('click', () => {
  if (stepIndex === STEPS.length - 1) dialog.close();
  else showStep(stepIndex + 1);
});
dialog.addEventListener('close', () => clearTimeout(timer));

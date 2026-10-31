// Browser client. It shows snapshots from the server and sends player intent.
// The server makes every game decision.
import { linkClasses, prefersReducedMotion, SYMBOLS } from './shared.js';

const SESSION_KEY = 'territory-grab-session';
const NAME_KEY = 'territory-grab-name';
const LOW_TIME_MS = 5000;
const BLOCKED = -1;
const MIN_BOARD_SIDE = 4;
const MAX_BOARD_WIDTH = 12;
const MAX_BOARD_HEIGHT = 16;
const MAX_RECONNECT_MS = 8000;
const RIPPLE_STEP_MS = 45;
const DEAL_STEP_MS = 16;
const CONFETTI_MS = 3200;

const $ = (id) => document.getElementById(id);

let socket = null;
let reconnectMs = 500;
let allowReconnect = true;
let state = null;
let cells = [];
let deadline = 0;
let wasMyTurn = false;
let toastTimer = null;
let previousBoard = null;
let previousPhase = null;
let knownPlayers = new Set();
let shownCode = null;
let shownSize = null;
const scoreRows = new Map();

// Storage can be unavailable in private windows, and the game must still work.
function storageGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(storage, key, value) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  } catch {
    // Without storage, the player only loses automatic rejoin after a refresh.
  }
}

function getSession() {
  try {
    return JSON.parse(storageGet(sessionStorage, SESSION_KEY));
  } catch {
    return null;
  }
}

function setSession(session) {
  storageSet(sessionStorage, SESSION_KEY, session ? JSON.stringify(session) : null);
}

function connect() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(`${scheme}//${location.host}/ws`);
  showConnection(state || getSession() ? 'Reconnecting…' : 'Connecting to the server…');
  updateHomeButtons();

  socket.addEventListener('open', () => {
    reconnectMs = 500;
    showConnection(null);
    updateHomeButtons();
    const session = getSession();
    if (session) send({ type: 'resume', code: session.code, token: session.token });
  });

  socket.addEventListener('message', (event) => {
    handleMessage(JSON.parse(event.data));
  });

  socket.addEventListener('close', () => {
    updateHomeButtons();
    if (!allowReconnect) return;
    showConnection(state || getSession() ? 'Reconnecting…' : 'Connecting to the server…');
    setTimeout(connect, reconnectMs);
    reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
  });
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
    return true;
  }
  toast('Not connected yet. Try again in a moment.');
  return false;
}

function handleMessage(message) {
  switch (message.type) {
    case 'joined':
      setSession({ code: message.code, token: message.token });
      history.replaceState(null, '', location.pathname);
      break;
    case 'state':
      render(message);
      break;
    case 'error':
      if (message.code === 'session_expired') {
        endSeat('That game has ended.');
      } else {
        toast(message.message);
      }
      break;
    case 'left':
      endSeat(null);
      break;
    case 'room_closed':
      endSeat('The room closed.');
      break;
    case 'replaced':
      allowReconnect = false;
      state = null;
      showConnection('This game is now open in another tab. Refresh to play here.');
      break;
    default:
      break;
  }
}

function resetRoomVisuals() {
  cells = [];
  previousBoard = null;
  scoreRows.clear();
  $('scores').replaceChildren();
}

function endSeat(notice) {
  setSession(null);
  state = null;
  wasMyTurn = false;
  previousPhase = null;
  knownPlayers = new Set();
  shownCode = null;
  shownSize = null;
  resetRoomVisuals();
  document.title = 'Territory Grab';
  showScreen('home');
  if (notice) toast(notice);
}

function showScreen(name) {
  for (const id of ['home', 'lobby', 'game']) $(id).hidden = id !== name;
}

function showConnection(text) {
  $('connection').hidden = !text;
  $('connection').textContent = text ?? '';
}

function updateHomeButtons() {
  const open = socket?.readyState === WebSocket.OPEN;
  $('create').disabled = !open;
  $('join').disabled = !open;
}

function toast(text) {
  $('toast').hidden = true;
  $('toast').textContent = text;
  // Hiding and showing again replays the entrance for a repeated message.
  requestAnimationFrame(() => {
    $('toast').hidden = false;
  });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 3500);
}

// Plays a one-off effect, unless the player has asked for less motion.
function animate(element, keyframes, options) {
  if (prefersReducedMotion()) return;
  element.animate(keyframes, options);
}

function bump(element) {
  animate(element, [{ transform: 'scale(1)' }, { transform: 'scale(1.3)' }, { transform: 'scale(1)' }], {
    duration: 280,
    easing: 'ease-out',
  });
}

function makeBadge(player) {
  const badge = document.createElement('span');
  badge.className = `badge slot-${player.slot}`;
  badge.textContent = SYMBOLS[player.slot];
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

function render(next) {
  state = next;
  if (next.phase === 'lobby') renderLobby(next);
  else renderGame(next);
  previousPhase = next.phase;
}

function renderCode(code) {
  if (shownCode === code) return;
  shownCode = code;
  const letters = [...code].map((letter, index) => {
    const span = document.createElement('span');
    span.textContent = letter;
    span.style.setProperty('--d', `${index * 70}ms`);
    span.setAttribute('aria-hidden', 'true');
    return span;
  });
  $('lobby-code').replaceChildren(...letters);
  $('lobby-code').setAttribute('aria-label', `Room code ${[...code].join(' ')}`);
}

function renderLobby(s) {
  showScreen('lobby');
  wasMyTurn = false;
  document.title = 'Territory Grab';
  resetRoomVisuals();
  renderCode(s.code);
  $('player-count').textContent = `(${s.players.length} of 6)`;

  const items = s.players.map((player) => {
    const item = document.createElement('li');
    if (!knownPlayers.has(player.id)) item.className = 'enter';
    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.name;
    item.append(makeBadge(player), name);
    const tags = [];
    if (player.id === s.you) tags.push('you');
    if (player.id === s.hostId) tags.push('host');
    if (!player.connected) tags.push('offline');
    if (tags.length > 0) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tags.join(', ');
      item.append(tag);
    }
    return item;
  });
  $('lobby-players').replaceChildren(...items);
  knownPlayers = new Set(s.players.map((player) => player.id));

  const isHost = s.hostId === s.you;
  renderBoardSize(s, isHost);
  const enough = s.players.length >= 2;
  $('start').hidden = !isHost;
  $('start').disabled = !enough;
  $('start').classList.toggle('ready', enough);
  $('start').textContent = enough ? 'Start game' : 'Waiting for one more player…';
  $('lobby-wait').hidden = isHost;
  const host = s.players.find((player) => player.id === s.hostId);
  $('lobby-wait').textContent = `Waiting for ${host?.name ?? 'the host'} to start the game.`;
}

function renderBoardSize(s, isHost) {
  const { cols, rows } = s.board;
  if (shownSize && shownSize.cols !== cols) bump($('width-value'));
  if (shownSize && shownSize.rows !== rows) bump($('height-value'));
  if (!shownSize || shownSize.cols !== cols || shownSize.rows !== rows) renderPreview(cols, rows);
  shownSize = { cols, rows };

  $('width-value').textContent = cols;
  $('height-value').textContent = rows;
  for (const button of document.querySelectorAll('.size-button')) button.hidden = !isHost;
  $('width-less').disabled = cols <= MIN_BOARD_SIDE;
  $('width-more').disabled = cols >= MAX_BOARD_WIDTH;
  $('height-less').disabled = rows <= MIN_BOARD_SIDE;
  $('height-more').disabled = rows >= MAX_BOARD_HEIGHT;

  const squares = cols * rows;
  const count = s.players.length;
  const blocked = squares % count;
  let summary = `${squares} squares`;
  if (count >= 2) {
    summary += `: ${Math.floor(squares / count)} turns each for ${count} players.`;
    if (blocked > 0) {
      const noun = blocked === 1 ? '1 random square is' : `${blocked} random squares are`;
      summary += ` ${noun} blocked to keep turns equal.`;
    }
  } else {
    summary += '.';
  }
  if (!isHost) summary += ' The host chooses the size.';
  $('size-summary').textContent = summary;
}

function renderPreview(cols, rows) {
  const preview = $('size-preview');
  preview.style.setProperty('--cols', cols);
  const dots = Array.from({ length: cols * rows }, () => document.createElement('i'));
  preview.replaceChildren(...dots);
}

function changeBoard(colsChange, rowsChange) {
  send({
    type: 'setBoard',
    cols: state.board.cols + colsChange,
    rows: state.board.rows + rowsChange,
  });
}

function buildBoard(game) {
  const board = $('board');
  const frame = $('board-frame');
  frame.style.setProperty('--cols', game.cols);
  frame.style.setProperty('--rows', game.rows);
  board.classList.toggle('dense', game.cols > 9 || game.rows > 12);
  cells = game.board.map((_, index) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.addEventListener('click', () => send({ type: 'claim', cell: index }));
    return cell;
  });
  board.replaceChildren(...cells);
}

function distance(a, b, cols) {
  const rowGap = Math.abs(Math.floor(a / cols) - Math.floor(b / cols));
  return rowGap + Math.abs((a % cols) - (b % cols));
}

function renderGame(s) {
  showScreen('game');
  $('game-code').textContent = s.code;
  const { game } = s;
  const isNewBoard = cells.length !== game.board.length;
  if (isNewBoard) buildBoard(game);

  // After a refresh there is nothing to compare with, so nothing replays.
  const dealing = isNewBoard && game.moves === 0;
  const claimed =
    previousBoard && game.lastCell !== null && previousBoard[game.lastCell] === null
      ? game.lastCell
      : null;

  const bySlot = new Map(s.players.map((player) => [player.id, player]));
  const myTurn = s.phase === 'playing' && game.turnPlayerId === s.you;
  const finished = s.phase === 'finished';
  const justFinished = finished && previousPhase === 'playing';
  const core = new Set();
  for (const score of Object.values(game.scores)) {
    for (const cell of score.cells) core.add(cell);
  }
  const winners = new Set(game.result?.winnerIds ?? []);
  const isOwner = (owner) => owner !== null && owner !== BLOCKED;

  game.board.forEach((ownerId, index) => {
    const cell = cells[index];
    const row = Math.floor(index / game.cols) + 1;
    const col = (index % game.cols) + 1;
    if (dealing) cell.style.setProperty('--d', `${(row + col) * DEAL_STEP_MS}ms`);
    const deal = dealing ? ['deal'] : [];
    if (ownerId === BLOCKED) {
      cell.className = ['cell', 'blocked', ...deal].join(' ');
      cell.textContent = '✕';
      cell.disabled = true;
      cell.setAttribute('aria-label', `Row ${row}, column ${col}, blocked`);
      return;
    }
    if (ownerId === null) {
      cell.className = ['cell', 'open', ...deal].join(' ');
      cell.textContent = '';
      cell.disabled = !myTurn;
      cell.setAttribute('aria-label', `Row ${row}, column ${col}, empty`);
      return;
    }
    const owner = bySlot.get(ownerId);
    const classes = ['cell', 'owned', `slot-${owner.slot}`];
    classes.push(...linkClasses(game.board, index, game.cols, isOwner));
    if (core.has(index)) classes.push('core');
    if (index === game.lastCell && !finished) classes.push('last');

    if (index === claimed) {
      classes.push('fresh');
    } else if (
      claimed !== null &&
      ownerId === game.board[claimed] &&
      core.has(index) &&
      core.has(claimed)
    ) {
      // The biggest group just changed, so a ripple spreads from the new square.
      cell.style.setProperty('--d', `${distance(index, claimed, game.cols) * RIPPLE_STEP_MS}ms`);
      classes.push('ripple');
    }

    if (finished && winners.has(ownerId) && core.has(index)) {
      const start = game.scores[ownerId].cells[0];
      cell.style.setProperty('--d', `${distance(index, start, game.cols) * 70}ms`);
      classes.push('win');
    }
    cell.className = classes.join(' ');
    cell.textContent = SYMBOLS[owner.slot];
    cell.disabled = true;
    cell.setAttribute('aria-label', `Row ${row}, column ${col}, ${owner.name}`);
  });

  renderStatus(s, myTurn, bySlot);
  renderScores(s);
  renderFrame(s, myTurn, bySlot);

  const isHost = s.hostId === s.you;
  $('again').hidden = !(finished && isHost);
  $('again-wait').hidden = !(finished && !isHost);

  deadline = performance.now() + game.turnMsLeft;
  updateTimer();

  // Browsers block vibration until the player has tapped the page.
  if (myTurn && !wasMyTurn && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
  wasMyTurn = myTurn;
  document.title = myTurn ? '● Your turn - Territory Grab' : 'Territory Grab';
  previousBoard = [...game.board];

  if (justFinished) launchConfetti(game.result.winnerIds.map((id) => bySlot.get(id).slot));
}

// The frame around the board glows in the color of whoever is acting or has won.
function renderFrame(s, myTurn, players) {
  const { game } = s;
  const focusId = s.phase === 'finished' ? game.result.winnerIds[0] : game.turnPlayerId;
  const frame = $('board-frame');
  frame.className = `board-frame slot-${players.get(focusId).slot}`;
  frame.classList.toggle('mine', myTurn);
  frame.classList.toggle('finished', s.phase === 'finished');
}

function renderStatus(s, myTurn, players) {
  const status = $('status');
  const { game } = s;
  const finished = s.phase === 'finished';
  let text;
  if (finished) text = resultText(s, players);
  else if (myTurn) text = 'Your turn: tap any empty square';
  else text = `${players.get(game.turnPlayerId).name} is choosing…`;

  const focus = players.get(finished ? game.result.winnerIds[0] : game.turnPlayerId);
  $('status-badge').replaceChildren(makeBadge(focus));
  $('status-bar').classList.toggle('mine', myTurn);
  $('status-bar').classList.toggle('won', finished && game.result.winnerIds.includes(s.you));
  $('status-bar').classList.toggle('result', finished);

  if (status.textContent !== text) {
    status.textContent = text;
    animate($('status-bar'), [{ opacity: 0.35, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], {
      duration: 240,
      easing: 'ease-out',
    });
  }
}

function resultText(s, players) {
  const { result, scores } = s.game;
  const size = scores[result.winnerIds[0]].largest;
  const squares = `${size} ${size === 1 ? 'square' : 'squares'}`;
  const iWon = result.winnerIds.includes(s.you);
  if (result.reason === 'draw') {
    const names = result.winnerIds.map((id) => players.get(id).name).join(' and ');
    return `It's a tie! ${names} share the win with ${squares}.`;
  }
  const winner = iWon ? 'You win' : `${players.get(result.winnerIds[0]).name} wins`;
  if (result.reason === 'tiebreak') {
    return `${winner}! Tied at ${squares}, decided by the next biggest group.`;
  }
  return `${winner} with a group of ${squares}!`;
}

function makeScoreRow(player) {
  const item = document.createElement('li');
  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('span');
  name.className = 'player-name';
  const tag = document.createElement('span');
  tag.className = 'tag';
  info.append(name, tag);
  const big = document.createElement('span');
  big.className = 'big';
  big.title = 'Biggest group';
  item.append(makeBadge(player), info, big);
  return { item, name, tag, big };
}

function renderScores(s) {
  const { game } = s;
  const list = $('scores');
  const winners = new Set(game.result?.winnerIds ?? []);
  const before = new Map(
    [...scoreRows].map(([id, row]) => [id, row.item.getBoundingClientRect().top]),
  );

  const ordered = [...s.players].sort(
    (a, b) => game.scores[b.id].largest - game.scores[a.id].largest || a.slot - b.slot,
  );
  for (const player of ordered) {
    let row = scoreRows.get(player.id);
    if (!row) {
      row = makeScoreRow(player);
      scoreRows.set(player.id, row);
    }
    const score = game.scores[player.id];
    row.item.className = `score slot-${player.slot}`;
    row.item.classList.toggle('turn', player.id === game.turnPlayerId);
    row.item.classList.toggle('winner', winners.has(player.id));
    row.name.textContent = player.id === s.you ? `${player.name} (you)` : player.name;

    let detail = `${score.total} ${score.total === 1 ? 'square' : 'squares'}`;
    if (player.gone) detail = 'Left: auto-playing';
    else if (!player.connected) detail = 'Offline';
    row.tag.textContent = detail;

    if (row.big.textContent !== String(score.largest)) {
      if (row.big.textContent !== '') bump(row.big);
      row.big.textContent = score.largest;
      row.big.setAttribute('aria-label', `Biggest group ${score.largest}`);
    }
    list.append(row.item);
  }

  // Rows glide from their old position to their new rank.
  for (const [id, top] of before) {
    const moved = top - scoreRows.get(id).item.getBoundingClientRect().top;
    if (moved !== 0) {
      animate(scoreRows.get(id).item, [{ transform: `translateY(${moved}px)` }, { transform: 'none' }], {
        duration: 320,
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      });
    }
  }
}

function updateTimer() {
  const fill = $('timer-fill');
  const seconds = $('seconds');
  if (!state?.game || state.phase !== 'playing') {
    fill.style.transform = 'scaleX(0)';
    seconds.hidden = true;
    return;
  }
  const { game } = state;
  const left = Math.max(0, deadline - performance.now());
  const total = Math.max(game.turnMsTotal, 1);
  fill.style.transform = `scaleX(${Math.min(1, left / total)})`;
  const mine = game.turnPlayerId === state.you;
  const low = mine && left <= LOW_TIME_MS;
  fill.classList.toggle('mine', mine);
  fill.classList.toggle('low', low);

  seconds.hidden = false;
  seconds.classList.toggle('low', low);
  const text = `${Math.ceil(left / 1000)}s`;
  if (seconds.textContent !== text) {
    seconds.textContent = text;
    if (low) bump(seconds);
  }
}

// A short burst of paper in the winners' colors, drawn on a temporary canvas.
function launchConfetti(slots) {
  if (prefersReducedMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  document.body.append(canvas);

  const styles = getComputedStyle(document.documentElement);
  const colors = [...slots.map((slot) => styles.getPropertyValue(`--p${slot}`)), styles.getPropertyValue('--accent')];
  const pieces = Array.from({ length: Math.min(170, Math.floor(innerWidth / 6)) }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    size: 6 + Math.random() * 7,
    speed: 2.6 + Math.random() * 3.4,
    drift: -1.2 + Math.random() * 2.4,
    spin: Math.random() * Math.PI,
    spinSpeed: -0.15 + Math.random() * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));

  const context = canvas.getContext('2d');
  const started = performance.now();
  function frame(now) {
    const elapsed = now - started;
    if (elapsed > CONFETTI_MS) {
      canvas.remove();
      return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.globalAlpha = Math.min(1, (CONFETTI_MS - elapsed) / 800);
    for (const piece of pieces) {
      piece.y += piece.speed;
      piece.x += piece.drift + Math.sin(piece.spin) * 0.8;
      piece.spin += piece.spinSpeed;
      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.spin);
      context.scale(1, Math.cos(piece.spin * 1.4));
      context.fillStyle = piece.color;
      context.fillRect(-piece.size / 2, -piece.size / 2, piece.size, piece.size * 0.62);
      context.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function currentName() {
  const name = $('name').value.trim();
  if (!name) {
    toast('Enter your name first.');
    $('name').focus();
    return null;
  }
  storageSet(localStorage, NAME_KEY, name);
  return name;
}

async function shareInvite() {
  const url = `${location.origin}${location.pathname}?room=${state.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied.');
  } catch {
    toast(`Share this link: ${url}`);
  }
}

$('create').addEventListener('click', () => {
  const name = currentName();
  if (name) send({ type: 'create', name });
});

function joinRoom() {
  const name = currentName();
  if (!name) return;
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) {
    toast('Enter the 4-letter room code.');
    $('code').focus();
    return;
  }
  send({ type: 'join', code, name });
}

$('join').addEventListener('click', joinRoom);
$('code').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom();
});
$('name').addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  if ($('code').value.trim()) joinRoom();
  else $('create').click();
});
$('share').addEventListener('click', shareInvite);
$('width-less').addEventListener('click', () => changeBoard(-1, 0));
$('width-more').addEventListener('click', () => changeBoard(1, 0));
$('height-less').addEventListener('click', () => changeBoard(0, -1));
$('height-more').addEventListener('click', () => changeBoard(0, 1));
$('start').addEventListener('click', () => send({ type: 'start' }));
$('again').addEventListener('click', () => send({ type: 'playAgain' }));
$('lobby-leave').addEventListener('click', () => send({ type: 'leave' }));
$('game-leave').addEventListener('click', () => {
  const running = state?.phase === 'playing';
  if (!running || confirm('Leave this game? You will not be able to return.')) {
    send({ type: 'leave' });
  }
});

$('name').value = storageGet(localStorage, NAME_KEY) ?? '';
const invitedCode = new URLSearchParams(location.search).get('room');
if (invitedCode) {
  $('code').value = invitedCode.slice(0, 4).toUpperCase();
  $($('name').value ? 'join' : 'name').focus();
}

setInterval(updateTimer, 100);
updateHomeButtons();
connect();

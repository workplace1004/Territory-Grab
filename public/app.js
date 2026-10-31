// Browser client. It shows snapshots from the server and sends player intent.
// The server makes every game decision.

const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚'];
const SESSION_KEY = 'territory-grab-session';
const NAME_KEY = 'territory-grab-name';
const LOW_TIME_MS = 5000;
const BLOCKED = -1;
const MIN_BOARD_SIDE = 4;
const MAX_BOARD_WIDTH = 12;
const MAX_BOARD_HEIGHT = 16;
const MAX_RECONNECT_MS = 8000;

const $ = (id) => document.getElementById(id);

let socket = null;
let reconnectMs = 500;
let allowReconnect = true;
let state = null;
let cells = [];
let deadline = 0;
let wasMyTurn = false;
let toastTimer = null;

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

function endSeat(notice) {
  setSession(null);
  state = null;
  wasMyTurn = false;
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
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $('toast').hidden = true;
  }, 3500);
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
}

function renderLobby(s) {
  showScreen('lobby');
  wasMyTurn = false;
  document.title = 'Territory Grab';
  cells = [];
  $('lobby-code').textContent = s.code;
  $('player-count').textContent = `(${s.players.length} of 6)`;

  const items = s.players.map((player) => {
    const item = document.createElement('li');
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

  const isHost = s.hostId === s.you;
  renderBoardSize(s, isHost);
  const enough = s.players.length >= 2;
  $('start').hidden = !isHost;
  $('start').disabled = !enough;
  $('start').textContent = enough ? 'Start game' : 'Waiting for one more player…';
  $('lobby-wait').hidden = isHost;
  const host = s.players.find((player) => player.id === s.hostId);
  $('lobby-wait').textContent = `Waiting for ${host?.name ?? 'the host'} to start the game.`;
}

function renderBoardSize(s, isHost) {
  const { cols, rows } = s.board;
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

function changeBoard(colsChange, rowsChange) {
  send({
    type: 'setBoard',
    cols: state.board.cols + colsChange,
    rows: state.board.rows + rowsChange,
  });
}

function buildBoard(game) {
  const board = $('board');
  board.style.setProperty('--cols', game.cols);
  board.style.setProperty('--rows', game.rows);
  cells = game.board.map((_, index) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.addEventListener('click', () => send({ type: 'claim', cell: index }));
    return cell;
  });
  board.replaceChildren(...cells);
}

function renderGame(s) {
  showScreen('game');
  const { game } = s;
  if (cells.length !== game.board.length) buildBoard(game);

  const bySlot = new Map(s.players.map((player) => [player.id, player]));
  const myTurn = s.phase === 'playing' && game.turnPlayerId === s.you;
  const finished = s.phase === 'finished';
  const core = new Set();
  for (const score of Object.values(game.scores)) {
    for (const cell of score.cells) core.add(cell);
  }
  const winners = new Set(game.result?.winnerIds ?? []);

  game.board.forEach((ownerId, index) => {
    const cell = cells[index];
    const row = Math.floor(index / game.cols) + 1;
    const col = (index % game.cols) + 1;
    if (ownerId === BLOCKED) {
      cell.className = 'cell blocked';
      cell.textContent = '✕';
      cell.disabled = true;
      cell.setAttribute('aria-label', `Row ${row}, column ${col}, blocked`);
      return;
    }
    if (ownerId === null) {
      cell.className = 'cell open';
      cell.textContent = '';
      cell.disabled = !myTurn;
      cell.setAttribute('aria-label', `Row ${row}, column ${col}, empty`);
      return;
    }
    const owner = bySlot.get(ownerId);
    const classes = ['cell', 'owned', `slot-${owner.slot}`];
    if (core.has(index)) classes.push('core');
    if (index === game.lastCell && !finished) classes.push('last');
    if (finished && winners.has(ownerId) && core.has(index)) classes.push('win');
    cell.className = classes.join(' ');
    cell.textContent = SYMBOLS[owner.slot];
    cell.disabled = true;
    cell.setAttribute('aria-label', `Row ${row}, column ${col}, ${owner.name}`);
  });

  renderStatus(s, myTurn, bySlot);
  renderScores(s);

  const isHost = s.hostId === s.you;
  $('again').hidden = !(finished && isHost);
  $('again-wait').hidden = !(finished && !isHost);

  deadline = performance.now() + game.turnMsLeft;
  updateTimer();

  // Browsers block vibration until the player has tapped the page.
  if (myTurn && !wasMyTurn && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(40);
  wasMyTurn = myTurn;
  document.title = myTurn ? '● Your turn - Territory Grab' : 'Territory Grab';
}

function renderStatus(s, myTurn, players) {
  const status = $('status');
  const { game } = s;
  status.classList.toggle('mine', myTurn);
  if (s.phase === 'finished') {
    status.textContent = resultText(s, players);
    status.classList.toggle('mine', game.result.winnerIds.includes(s.you));
  } else if (myTurn) {
    status.textContent = 'Your turn: tap any empty square';
  } else {
    status.textContent = `${players.get(game.turnPlayerId).name} is choosing…`;
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

function renderScores(s) {
  const { game } = s;
  const rows = [...s.players]
    .sort((a, b) => game.scores[b.id].largest - game.scores[a.id].largest || a.slot - b.slot)
    .map((player) => {
      const item = document.createElement('li');
      item.className = `score slot-${player.slot}`;
      if (player.id === game.turnPlayerId) item.classList.add('turn');

      const info = document.createElement('div');
      info.className = 'info';
      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = player.id === s.you ? `${player.name} (you)` : player.name;
      const tag = document.createElement('span');
      tag.className = 'tag';
      const total = game.scores[player.id].total;
      let detail = `${total} ${total === 1 ? 'square' : 'squares'} claimed`;
      if (player.gone) detail = 'Left: auto-playing';
      else if (!player.connected) detail = 'Offline';
      tag.textContent = detail;
      info.append(name, tag);

      const big = document.createElement('span');
      big.className = 'big';
      big.textContent = game.scores[player.id].largest;
      big.title = 'Biggest group';
      big.setAttribute('aria-label', `Biggest group ${game.scores[player.id].largest}`);

      item.append(makeBadge(player), info, big);
      return item;
    });
  $('scores').replaceChildren(...rows);
}

function updateTimer() {
  const fill = $('timer-fill');
  if (!state?.game || state.phase !== 'playing') {
    fill.style.transform = 'scaleX(0)';
    return;
  }
  const { game } = state;
  const left = Math.max(0, deadline - performance.now());
  const total = Math.max(game.turnMsTotal, 1);
  fill.style.transform = `scaleX(${Math.min(1, left / total)})`;
  const mine = game.turnPlayerId === state.you;
  fill.classList.toggle('mine', mine);
  fill.classList.toggle('low', mine && left <= LOW_TIME_MS);

  if (mine) {
    // Only write on change, so screen readers do not re-announce it ten times a second.
    const text = `Your turn: tap any empty square (${Math.ceil(left / 1000)}s)`;
    if ($('status').textContent !== text) $('status').textContent = text;
  }
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

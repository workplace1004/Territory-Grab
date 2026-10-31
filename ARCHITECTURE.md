# Territory Grab: Architecture and Workflow

## 1. Game rules

Goal: **own the biggest connected group of squares.**

1. Players take turns claiming **any** empty square.
2. Squares connect up, down, left and right. Diagonals do not connect.
3. When the board is full, the player with the biggest group wins.
4. Tie: compare second-biggest groups, then third, and so on. If everything matches, the winners share the win.
5. Each turn lasts 20 seconds. If time runs out, the game claims a random square for you.

The host sets the board size in the lobby: width 4 to 12, height 4 to 16, default 8 x 8. The server checks the size, so a modified browser cannot go outside these limits.

Every player gets the same number of turns. If the squares do not divide evenly by the player count, the leftover squares are blocked at random when the game starts. For example, 8 x 8 with 3 players has 64 squares, so 1 is blocked and each player gets 21 turns. Blocked squares cannot be claimed and do not connect groups.

The first player changes each round, so nobody always has the first-move advantage.

## 2. System overview

```
 Phone / laptop browsers                 Node.js server (one process)
+------------------------+              +-------------------------------+
| public/app.js          |   WebSocket  | server/index.js               |
|  - shows the snapshot  | <----------> |  HTTP files, sockets, limits  |
|  - sends player intent |              |             |                 |
+------------------------+              | server/rooms.js               |
                                        |  rooms, seats, timers         |
                                        |             |                 |
                                        | server/game.js                |
                                        |  pure rules, no I/O           |
                                        +-------------------------------+
```

### Key decisions

| Decision | Reason |
|---|---|
| **The server decides everything** | Clients only ask ("claim square 12"), so a modified browser cannot cheat. |
| **Full snapshot after every change** | There is no sync logic to get wrong. A reconnecting player just gets the latest snapshot. |
| **Layers: `game` -> `rooms` -> `index`** | Each layer can be tested alone, and when something breaks the failing layer shows where to look. |
| **Plain JavaScript with no build step, and one dependency (`ws`)** | Few moving parts to deploy or debug. |
| **Rooms stay in memory** | Games are short, so no database is needed. The trade-offs are one server process only, and a restart ends running games. |
| **Remaining time is sent, not a clock time** | Wrong clocks on players' devices cannot affect the countdown. |

## 3. Files

```
server/game.js      Rules: board sizes, claim, groups, scoring, winner
server/rooms.js     Room codes, players, host, turn timers, reconnects
server/index.js     Static files, WebSocket, rate limits, heartbeat
public/index.html   Screens: home, lobby, game
public/style.css    Responsive layout and player colors
public/app.js       Connection, reconnect, drawing, input
public/tutorial.js  "How to play" animated lesson (no server involved)
public/hero.js      Self-playing preview board on the home screen
public/shared.js    Symbols, bridge classes and the motion preference check
test/               Rules, room and real-socket tests
render.yaml         Deployment settings for Render
```

## 4. Room lifecycle

```
          create / join             host starts            board full
 (none) ----------------> LOBBY ----------------> PLAYING ------------> FINISHED
                            ^                                               |
                            +------------------ host: play again -----------+
```

Joining is only allowed in the lobby, and a room holds up to 6 players.

## 5. Workflows

### Create and join
1. The host enters a name and creates a room. The server returns a 4-letter code and a secret seat token.
2. Friends use the code or the shared link (`/?room=ABCD`).
3. The host sets the board size, and everyone sees it update.
4. The host starts the game once at least 2 players are present.

### A turn
1. The client sends `{type:"claim", cell}`.
2. The server checks that the game is running, it is that player's turn, and the square is valid and empty.
3. If it fails, only that player gets an error, and the game state does not change.
4. If it passes, the server applies the move, then either starts the next turn timer or finishes the game.
5. Everyone receives a new snapshot.

### Connection loss
| Situation | What happens |
|---|---|
| Connection drops | The seat is kept, and the token lets the browser tab return automatically. |
| Offline on their turn | The turn shortens to 5 seconds at most, then a random square is claimed. |
| Offline over 30 seconds, in the lobby | The player is removed. |
| Offline over 30 seconds, in a game | The player is marked gone, and their turns are played in under a second. They can still return. |
| Player presses Leave | Same as above, but they cannot return. |
| Host offline or gone | The next connected player becomes host. |
| Everybody gone | The room is deleted. |
| No player action for 1 hour | The room is deleted. |

## 6. Messages

Client to server:

| Type | Fields |
|---|---|
| `create` | `name` |
| `join` | `code`, `name` |
| `resume` | `code`, `token` |
| `setBoard` | `cols`, `rows` |
| `start`, `playAgain`, `leave` | none |
| `claim` | `cell` |

Server to client:

| Type | Meaning |
|---|---|
| `joined` | Seat details: `code`, `token`, `playerId` |
| `state` | The full room snapshot, personalized with `you` |
| `error` | `code` and a readable `message` |
| `left`, `room_closed`, `replaced` | The seat ended, for the reason in the name |

## 7. Security and limits

- All input is validated on the server, and names are cleaned and limited to 16 characters.
- Names are drawn with `textContent`, so they cannot inject HTML.
- Seat tokens are random, go only to their owner, and never appear in snapshots.
- Messages are limited to 1 KB, with a per-connection rate limit, a join attempt limit and a cap on rooms.
- Sockets from other websites are refused by an Origin check.
- Only a fixed list of files is served, which prevents path traversal.

## 8. Testing

| Level | What it proves |
|---|---|
| `test/game.test.js` | Rules: groups, ties, turn order, illegal moves, fair boards |
| `test/rooms.test.js` | Lobby, host handover, timers and reconnects, using a fake clock |
| `test/server.test.js` | A full game over real WebSockets, plus limits and file serving |
| Browser check | Real browser sessions, including phone size |

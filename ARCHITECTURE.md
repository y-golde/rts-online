# Architecture

## High-Level Data Flow

```
Client (React Lobby)                    Server
─────────────────────                   ──────
  MainMenu
    → RoomBrowser ──── createRoom ────→ LobbyManager
    → RoomView   ──── joinRoom ──────→   (rooms in memory)
    → ReadyUp    ──── playerReady ───→   (player state)
    → StartGame  ──── startGame ─────→ GameEngine created
                                          │
Client (Canvas2D Game)                    │
──────────────────────                    ▼
  InputHandler                        GameEngine.tick() @ 20Hz
    → moveUnits ─────────────────────→  1. processEconomy()
    → attackTarget ──────────────────→  2. processMovement()
    → buildStructure ────────────────→  3. processCombat()
    → trainUnit ─────────────────────→  4. broadcastState()
    → gatherResource ────────────────→      │
                                            ▼
  Interpolator ←──── gameState ──────── Socket.io broadcast
    → Renderer.draw() @ 60fps
    → Camera (viewport)
    → HUD (gold, supply, minimap)
```

## File Index

### `shared/src/`
| File | Purpose |
|---|---|
| `types.ts` | All TypeScript interfaces and type unions (GameState, Entity, Player, etc.) |
| `constants.ts` | Game balance: tick rate, unit stats, costs, map size. Single source of truth for numbers. |
| `pathfinding.ts` | A* pathfinding on a 2D tile grid. Pure function, no side effects. |
| `index.ts` | Barrel export for the shared package. |

### `server/src/`
| File | Purpose |
|---|---|
| `index.ts` | Express + Socket.io server bootstrap. Listens on port, wires up lobby + game events. |
| `db.ts` | SQLite database setup (better-sqlite3). Creates tables, exposes query helpers. |
| `lobby.ts` | Room CRUD: create, join, leave, ready, start. Manages room state in memory. |
| `game/GameEngine.ts` | Core game loop. Holds GameState, processes commands, runs systems, broadcasts. |
| `game/systems/movement.ts` | Moves entities along their A* paths each tick. |
| `game/systems/combat.ts` | Resolves attacks: range checks, damage, unit death/removal. |
| `game/systems/economy.ts` | Worker gathering cycle, building construction, unit training queues. |
| `game/mapGenerator.ts` | Generates the tile grid, places gold mines, sets spawn points. |

### `client/src/`
| File | Purpose |
|---|---|
| `main.tsx` | React entry point, renders App. |
| `App.tsx` | Top-level router: shows lobby screens or mounts game canvas. |
| `socket.ts` | Socket.io client singleton with typed event helpers. |
| `lobby/MainMenu.tsx` | Landing page: "Single Player" and "Multiplayer" buttons. |
| `lobby/RoomBrowser.tsx` | Lists available rooms, create room button. |
| `lobby/RoomView.tsx` | In-room: player slots, color picker, faction, ready, start. |
| `game/GameManager.ts` | Owns the canvas element. Connects socket events to renderer. Runs the 60fps render loop. |
| `game/Renderer.ts` | Canvas2D drawing: terrain tiles, buildings (rectangles+emoji), units (circles+emoji), selection box. |
| `game/Camera.ts` | Viewport transform: pan (WASD/edge scroll), zoom (scroll wheel), world↔screen coordinate conversion. |
| `game/InputHandler.ts` | Translates mouse clicks, drags, keyboard into game commands sent to server. |
| `game/HUD.ts` | Draws overlay UI: top resource bar, bottom action panel, minimap. |
| `game/Interpolator.ts` | Buffers last two server snapshots, lerps entity positions for smooth 60fps rendering. |

## Game Loop Detail (Server)

Each tick (every 50ms = 20 ticks/sec):
1. **Dequeue commands** received from clients since last tick.
2. **Validate commands** (does the player own that unit? can they afford it? is placement legal?).
3. **processEconomy** — advance build timers, training queues, worker gather/deposit cycles.
4. **processMovement** — step each moving entity one tile along its path.
5. **processCombat** — check attack ranges, apply damage, remove dead entities.
6. **broadcastState** — serialize GameState and emit to all players in the game room.

## Networking Protocol

### Lobby Events
| Event | Direction | Payload |
|---|---|---|
| `createRoom` | client → server | `{ playerName }` |
| `joinRoom` | client → server | `{ roomId, playerName }` |
| `leaveRoom` | client → server | `{}` |
| `roomList` | server → client | `Room[]` |
| `roomUpdate` | server → client | `Room` |
| `playerReady` | client → server | `{ ready: boolean }` |
| `startGame` | client → server | `{}` (host only) |
| `gameStart` | server → client | `{ gameState }` |

### Game Events
| Event | Direction | Payload |
|---|---|---|
| `moveUnits` | client → server | `{ unitIds, targetX, targetY }` |
| `attackTarget` | client → server | `{ unitIds, targetId }` |
| `buildStructure` | client → server | `{ workerId, buildingType, x, y }` |
| `trainUnit` | client → server | `{ buildingId, unitType }` |
| `gatherResource` | client → server | `{ workerId, mineId }` |
| `gameState` | server → client | `GameState` (full snapshot each tick) |
| `gameOver` | server → client | `{ winnerId, reason }` |

## Testing

Regression tests live in `server/tests/` and use [Vitest](https://vitest.dev/).

```bash
pnpm test        # single run
pnpm test:watch  # re-run on file changes
```

Tests exercise the server-side game systems directly (no socket/HTTP needed):
- `processEconomy` + `processMovement` tick loop
- `handleGatherResource`, `handleBuildStructure`, `handleTrainUnit`
- Supply recalculation on construction completion
- Depot selection logic (nearest completed depot)

**Always run `pnpm test` before pushing** to catch regressions in mining, building, and economy.

## Database Schema (SQLite)

Three tables for persistence:
- `players` — id, name, wins, losses, created_at.
- `matches` — id, winner_id, duration_secs, played_at.
- `match_players` — match_id, player_id, color, faction (join table).

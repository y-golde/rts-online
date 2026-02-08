# RTS Online

A web-based multiplayer real-time strategy game built with TypeScript, React, Canvas2D, Socket.io, and SQLite.

## Features

- **Multiplayer Lobby**: Create/join rooms, color selection, ready system
- **Real-time Strategy Gameplay**: 
  - Workers gather gold from mines
  - Build houses (increase supply), barracks (train infantry), resource depots
  - Train infantry units for combat
  - 1v1 matches (expandable to 2v2, FFA)
- **Server-authoritative**: All game logic runs on the server at 20 ticks/sec
- **Smooth Client Rendering**: 60fps Canvas2D rendering with interpolation between server ticks
- **Persistent Stats**: SQLite database tracks player wins/losses and match history

## Tech Stack

- **Monorepo**: pnpm workspaces (`shared/`, `server/`, `client/`)
- **Client**: Vite + React (lobby) + raw Canvas2D (game)
- **Server**: Node.js + Express + Socket.io
- **Database**: SQLite (better-sqlite3)
- **Language**: TypeScript everywhere

## Getting Started

### Prerequisites

- Node.js 20+ 
- pnpm (`npm install -g pnpm`)

### Installation

```bash
# Install dependencies
pnpm install

# Build the shared package (required for TypeScript project references)
pnpm --filter shared build
```

### Running

```bash
# Start both client and server concurrently
pnpm dev

# Or run separately:
pnpm --filter server dev   # Server on http://localhost:3000
pnpm --filter client dev    # Client on http://localhost:5173
```

The client will automatically proxy Socket.io connections to the server.

### Playing

1. Open http://localhost:5173 in your browser
2. Enter your name and click "Multiplayer"
3. Create a room or join an existing one
4. Select your color and click "Ready Up"
5. Host clicks "Start Game" to begin

## Game Controls

- **WASD / Arrow Keys**: Pan camera
- **Mouse Edge Scroll**: Pan camera
- **Scroll Wheel**: Zoom in/out
- **Left Click**: Select unit(s)
- **Left Click + Drag**: Box select multiple units
- **Right Click**: Move selected units / Attack target / Gather resource
- **Q/W/E**: Keyboard shortcuts for building/training actions (shown in HUD)
- **Escape**: Cancel build mode or clear selection

## Game Mechanics

### Units & Buildings

- **Home Base** 🏰: Trains workers, provides +10 supply, drop-off point for gold
- **Worker** 👷: Gathers gold, builds structures (costs 50 gold, 1 supply)
- **House** 🏠: +10 supply, max 5 per player (costs 100 gold)
- **Barracks** 🛡️: Trains infantry (costs 200 gold)
- **Resource Depot** 📦: Alternative drop-off point for gold (costs 150 gold)
- **Infantry** ⚔️: Combat unit, auto-aggro on nearby enemies (costs 100 gold, 2 supply)

### Economy

- Workers mine gold from gold mines (⛏️) scattered around the map
- Each mine has 2000 gold and supports 1 worker at a time (Warcraft-style)
- Workers carry 10 gold per trip back to the **nearest completed** base/depot
- Starting gold: 300
- Workers must walk to a build site before placing a building

### Victory Condition

Destroy the enemy's home base to win!

## Project Structure

```
rts-online/
  shared/          # Shared types, constants, pathfinding
  server/          # Express + Socket.io backend, game engine
  client/          # React lobby + Canvas2D game renderer
```

See `ARCHITECTURE.md` for detailed documentation.

## Testing

Run the regression test suite before pushing changes:

```bash
# Run all tests
pnpm test

# Run in watch mode during development
pnpm test:watch
```

Tests live in `server/tests/` and cover:

- **Mining cycle**: move → mine → return → deposit → auto-repeat
- **Mining edge cases**: idle+targetId race condition, worker already adjacent
- **Building placement**: proximity check, walk-to-build, multiple buildings, collision
- **Supply recalculation**: maxSupply updates when construction finishes
- **Nearest depot**: workers use closest completed depot, ignore under-construction

## Development

- All game balance numbers are in `shared/src/constants.ts` (no magic numbers)
- Type definitions are in `shared/src/types.ts`
- Server game loop runs at 20 ticks/sec (see `server/src/game/GameEngine.ts`)
- Client renders at 60fps with interpolation (see `client/src/game/Interpolator.ts`)

## Future Enhancements

- [ ] Single-player mode with bot AI (Phase 9)
- [ ] 2v2 and FFA game modes
- [ ] Additional factions (Cyborgs, Orcs, Bugs)
- [ ] More unit types and buildings
- [ ] Replay system
- [ ] Spectator mode

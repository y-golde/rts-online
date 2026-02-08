/**
 * @file index.ts
 * @description Express + Socket.io server entry point.
 * Boots the HTTP server, wires up Socket.io event handlers for lobby and game.
 *
 * @see lobby.ts for room management
 * @see game/GameEngine.ts for game loop
 */

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ClientToServerEvents, ServerToClientEvents } from '@rts/shared';
import { registerLobbyEvents, registerGameEvents } from './lobby.js';

// Initialize database asynchronously (don't block server startup)
// Database will be initialized on first use if this fails
import('./db/index.js').then(() => {
  console.log('[DB] Database initialized successfully');
}).catch((err) => {
  console.error('[DB] Warning: Database initialization failed (will retry on first use):', err.message);
});

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const app = express();
const httpServer = createServer(app);

// In production, allow any origin (served from same host).
// In dev, allow the Vite dev server.
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: IS_PROD ? true : ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST'],
  },
});

// ─── Serve static client build in production ────────────────────────────────
if (IS_PROD) {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  // SPA fallback — all non-API routes serve index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[Server] Serving static client from ${clientDist}`);
}

// ─── Socket.io Connection Handler ───────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  registerLobbyEvents(io, socket);
  registerGameEvents(socket);

  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
  });
});

// ─── Start Server ───────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[Server] RTS Online server running on http://localhost:${PORT}`);
});

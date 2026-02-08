/**
 * @file socket.ts
 * @description Socket.io client singleton with typed events.
 * All socket communication goes through this module.
 *
 * @see shared/src/types.ts for event type definitions
 */

import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@rts/shared';

/**
 * Server URL — in production the client is served by the same Express server,
 * so we connect to the current origin. In dev, Vite's proxy handles it.
 * Override with VITE_SERVER_URL if the server is on a different host.
 */
const SERVER_URL: string | undefined = import.meta.env.VITE_SERVER_URL || undefined;

/** Typed Socket.io client instance. */
export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(SERVER_URL as string, {
  autoConnect: true,
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5,
  transports: ['websocket', 'polling'],
});

// Log connection events for debugging
socket.on('connect', () => {
  console.log('[Socket] Connected to server');
});

socket.on('disconnect', () => {
  console.log('[Socket] Disconnected from server');
});

socket.on('connect_error', (error) => {
  console.error('[Socket] Connection error:', error.message);
});

export default socket;

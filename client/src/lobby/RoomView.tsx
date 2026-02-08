/**
 * @file RoomView.tsx
 * @description In-room view: shows player slots, color picker, faction display,
 * ready toggle, and start button (host only).
 */

import React from 'react';
import type { Room } from '@rts/shared';
import { PLAYER_COLORS } from '@rts/shared';
import socket from '../socket.js';

interface RoomViewProps {
  room: Room;
  playerId: string;
  onBack: () => void;
}

const RoomView: React.FC<RoomViewProps> = ({ room, playerId, onBack }) => {
  const me = room.players.find((p) => p.id === playerId);
  const isHost = room.hostId === playerId;

  const handleColorChange = (color: string) => {
    socket.emit('setColor', { color });
  };

  const handleReady = () => {
    if (me) {
      socket.emit('playerReady', { ready: !me.ready });
    }
  };

  const handleStart = () => {
    socket.emit('startGame');
  };

  const handleLeave = () => {
    socket.emit('leaveRoom');
    onBack();
  };

  const usedColors = new Set(room.players.map((p) => p.color));

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={handleLeave} style={styles.backButton}>Leave</button>
        <h2 style={styles.title}>{room.name}</h2>
        <div style={styles.roomId}>ID: {room.id.slice(0, 8)}</div>
      </div>

      <div style={styles.playerList}>
        {Array.from({ length: room.maxPlayers }).map((_, i) => {
          const player = room.players[i];
          return (
            <div key={i} style={styles.playerSlot}>
              {player ? (
                <>
                  <div
                    style={{
                      ...styles.colorDot,
                      background: player.color,
                    }}
                  />
                  <div style={styles.playerInfo}>
                    <div style={styles.playerName}>
                      {player.name}
                      {player.id === room.hostId && (
                        <span style={styles.hostBadge}>HOST</span>
                      )}
                    </div>
                    <div style={styles.faction}>Humans</div>
                  </div>
                  <div style={{
                    ...styles.readyBadge,
                    background: player.ready || player.id === room.hostId
                      ? 'rgba(46,204,113,0.2)'
                      : 'rgba(255,255,255,0.05)',
                    color: player.ready || player.id === room.hostId
                      ? '#2ecc71'
                      : '#667',
                  }}>
                    {player.id === room.hostId ? 'HOST' : player.ready ? 'READY' : 'NOT READY'}
                  </div>
                </>
              ) : (
                <div style={styles.emptySlot}>Waiting for player...</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Color picker */}
      <div style={styles.section}>
        <div style={styles.sectionLabel}>Your Color</div>
        <div style={styles.colorPicker}>
          {PLAYER_COLORS.map((color) => {
            const isUsed = usedColors.has(color) && me?.color !== color;
            const isSelected = me?.color === color;
            return (
              <button
                key={color}
                onClick={() => !isUsed && handleColorChange(color)}
                style={{
                  ...styles.colorButton,
                  background: color,
                  opacity: isUsed ? 0.3 : 1,
                  border: isSelected ? '3px solid #fff' : '3px solid transparent',
                  cursor: isUsed ? 'not-allowed' : 'pointer',
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        {!isHost && (
          <button onClick={handleReady} style={{
            ...styles.button,
            background: me?.ready
              ? 'rgba(231,76,60,0.8)'
              : 'rgba(46,204,113,0.8)',
          }}>
            {me?.ready ? 'Cancel Ready' : 'Ready Up'}
          </button>
        )}
        {isHost && (
          <button
            onClick={handleStart}
            style={{
              ...styles.button,
              background: 'linear-gradient(135deg, #e94560, #c0392b)',
            }}
          >
            Start Game
          </button>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', height: '100%', padding: 32,
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 32,
  },
  title: { fontSize: 28, fontWeight: 700, margin: 0 },
  roomId: { fontSize: 12, color: '#667', fontFamily: 'monospace' },
  backButton: {
    padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
    background: 'transparent', color: '#ccc', fontSize: 14, cursor: 'pointer',
  },
  playerList: {
    display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32,
  },
  playerSlot: {
    display: 'flex', alignItems: 'center', gap: 16,
    background: 'rgba(255,255,255,0.05)', padding: '16px 20px', borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)', minHeight: 64,
  },
  colorDot: {
    width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
  },
  playerInfo: { flex: 1 },
  playerName: { fontSize: 16, fontWeight: 600 },
  faction: { fontSize: 13, color: '#8899aa', marginTop: 2 },
  hostBadge: {
    marginLeft: 10, fontSize: 11, fontWeight: 700, color: '#f39c12',
    background: 'rgba(243,156,18,0.15)', padding: '2px 8px', borderRadius: 4,
  },
  readyBadge: {
    padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
  },
  emptySlot: { color: '#445', fontSize: 14, fontStyle: 'italic' },
  section: { marginBottom: 24 },
  sectionLabel: { fontSize: 13, color: '#8899aa', marginBottom: 10, fontWeight: 600 },
  colorPicker: { display: 'flex', gap: 10 },
  colorButton: {
    width: 40, height: 40, borderRadius: '50%', border: 'none',
  },
  actions: {
    marginTop: 'auto', display: 'flex', justifyContent: 'center',
  },
  button: {
    padding: '14px 48px', borderRadius: 10, border: 'none',
    color: '#fff', fontSize: 18, fontWeight: 700, cursor: 'pointer',
  },
};

export default RoomView;

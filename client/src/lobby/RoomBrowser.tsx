/**
 * @file RoomBrowser.tsx
 * @description Displays a list of available rooms and a "Create Room" button.
 * Fetches room list from server via socket events.
 */

import React, { useEffect, useState } from 'react';
import type { Room } from '@rts/shared';
import socket from '../socket.js';

interface RoomBrowserProps {
  playerName: string;
  onBack: () => void;
}

const RoomBrowser: React.FC<RoomBrowserProps> = ({ playerName, onBack }) => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState('');

  useEffect(() => {
    const onRoomList = (list: Room[]) => setRooms(list);
    socket.on('roomList', onRoomList);
    socket.emit('requestRoomList');

    // Refresh every 3 seconds
    const interval = setInterval(() => socket.emit('requestRoomList'), 3000);

    return () => {
      socket.off('roomList', onRoomList);
      clearInterval(interval);
    };
  }, []);

  const handleCreate = () => {
    const name = roomName.trim() || `${playerName}'s Room`;
    socket.emit('createRoom', { playerName, roomName: name });
    setCreating(false);
    setRoomName('');
  };

  const handleJoin = (roomId: string) => {
    socket.emit('joinRoom', { roomId, playerName });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <button onClick={onBack} style={styles.backButton}>Back</button>
        <h2 style={styles.title}>Game Rooms</h2>
        <button
          onClick={() => setCreating(true)}
          style={styles.createButton}
        >
          + Create Room
        </button>
      </div>

      {creating && (
        <div style={styles.createForm}>
          <input
            type="text"
            placeholder="Room name..."
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            style={styles.input}
            maxLength={30}
            autoFocus
          />
          <button onClick={handleCreate} style={styles.confirmButton}>Create</button>
          <button onClick={() => setCreating(false)} style={styles.cancelButton}>Cancel</button>
        </div>
      )}

      <div style={styles.roomList}>
        {rooms.length === 0 ? (
          <div style={styles.empty}>
            No rooms available. Create one to get started!
          </div>
        ) : (
          rooms.map((room) => (
            <div key={room.id} style={styles.roomCard}>
              <div>
                <div style={styles.roomName}>{room.name}</div>
                <div style={styles.roomInfo}>
                  {room.players.length}/{room.maxPlayers} players
                </div>
              </div>
              <button
                onClick={() => handleJoin(room.id)}
                style={styles.joinButton}
                disabled={room.players.length >= room.maxPlayers}
              >
                {room.players.length >= room.maxPlayers ? 'Full' : 'Join'}
              </button>
            </div>
          ))
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
    marginBottom: 24,
  },
  title: { fontSize: 28, fontWeight: 700, margin: 0 },
  backButton: {
    padding: '8px 20px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
    background: 'transparent', color: '#ccc', fontSize: 14, cursor: 'pointer',
  },
  createButton: {
    padding: '10px 24px', borderRadius: 8, border: 'none',
    background: 'linear-gradient(135deg, #e94560, #c0392b)',
    color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  },
  createForm: {
    display: 'flex', gap: 12, marginBottom: 20,
    background: 'rgba(255,255,255,0.05)', padding: 16, borderRadius: 12,
  },
  input: {
    flex: 1, padding: '10px 14px', borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(0,0,0,0.3)', color: '#eee', fontSize: 14, outline: 'none',
  },
  confirmButton: {
    padding: '10px 20px', borderRadius: 8, border: 'none',
    background: '#2ecc71', color: '#fff', fontWeight: 700, cursor: 'pointer',
  },
  cancelButton: {
    padding: '10px 20px', borderRadius: 8, border: 'none',
    background: 'rgba(255,255,255,0.1)', color: '#ccc', cursor: 'pointer',
  },
  roomList: {
    flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8,
  },
  roomCard: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    background: 'rgba(255,255,255,0.05)', padding: '16px 20px', borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.08)',
  },
  roomName: { fontSize: 16, fontWeight: 600 },
  roomInfo: { fontSize: 13, color: '#8899aa', marginTop: 4 },
  joinButton: {
    padding: '8px 24px', borderRadius: 8, border: 'none',
    background: '#3498db', color: '#fff', fontWeight: 700, cursor: 'pointer',
  },
  empty: {
    textAlign: 'center', color: '#667', marginTop: 60, fontSize: 16,
  },
};

export default RoomBrowser;

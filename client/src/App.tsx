/**
 * @file App.tsx
 * @description Top-level application component.
 * Routes between lobby screens (React) and the game canvas (raw Canvas2D).
 *
 * State machine: 'menu' → 'rooms' → 'room' → 'game'
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { Room, GameState } from '@rts/shared';
import socket from './socket.js';
import MainMenu from './lobby/MainMenu.js';
import RoomBrowser from './lobby/RoomBrowser.js';
import RoomView from './lobby/RoomView.js';
import { GameManager } from './game/GameManager.js';

type Screen = 'menu' | 'rooms' | 'room' | 'game';

const App: React.FC = () => {
  const [screen, setScreen] = useState<Screen>('menu');
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [playerId, setPlayerId] = useState<string>('');
  const [playerName, setPlayerName] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [isInitializingGame, setIsInitializingGame] = useState(false);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const gameManagerRef = useRef<GameManager | null>(null);

  // Ensure component is mounted
  useEffect(() => {
    setIsMounted(true);
    console.log('[App] Component mounted');
  }, []);

  // Safety: If screen is 'game' but gameManager doesn't exist after 3 seconds, reset to menu
  useEffect(() => {
    if (screen === 'game' && !gameManagerRef.current && !isInitializingGame) {
      const timeout = setTimeout(() => {
        if (!gameManagerRef.current && !isInitializingGame) {
          console.warn('[App] Game screen active but GameManager not initialized after 3s, resetting to menu');
          setScreen('menu');
          setErrorMsg('Game failed to initialize. Please try again.');
        }
      }, 3000);
      return () => clearTimeout(timeout);
    }
  }, [screen, isInitializingGame]);

  // ─── Socket event listeners ────────────────────────────────────
  useEffect(() => {
    // Handle connection errors
    const onConnectError = () => {
      setErrorMsg('Failed to connect to server. Make sure the server is running on port 3000.');
      setTimeout(() => setErrorMsg(''), 5000);
    };

    const onJoinedRoom = (data: { room: Room; playerId: string }) => {
      setCurrentRoom(data.room);
      setPlayerId(data.playerId);
      setScreen('room');
      setErrorMsg('');
    };

    const onRoomUpdate = (room: Room) => {
      setCurrentRoom(room);
    };

    const onLeftRoom = () => {
      setCurrentRoom(null);
      setPlayerId('');
      setScreen('rooms');
    };

    const onError = (data: { message: string }) => {
      setErrorMsg(data.message);
      setTimeout(() => setErrorMsg(''), 3000);
    };

    socket.on('connect_error', onConnectError);

    const onGameStart = (data: { gameState: GameState; playerId: string }) => {
      const eventPlayerId = data.playerId;
      console.log('[App] Game starting, eventPlayerId:', eventPlayerId, 'statePlayerId:', playerId, 'gameState:', data.gameState);
      
      // Use playerId from event (more reliable) or fall back to state
      const finalPlayerId = eventPlayerId || playerId;
      
      if (!finalPlayerId) {
        console.error('[App] No playerId in gameStart event or state!');
        setErrorMsg('Error: Player ID not set. Please try again.');
        setScreen('menu');
        setIsInitializingGame(false);
        return;
      }
      
      // Update playerId if it came from the event
      if (eventPlayerId && eventPlayerId !== playerId) {
        setPlayerId(eventPlayerId);
      }
      
      setIsConnecting(false);
      setIsInitializingGame(true);
      setErrorMsg('');
      setScreen('game');
      
      // GameManager will be mounted when screen switches to 'game'
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (!gameContainerRef.current) {
            console.error('[App] gameContainerRef.current is null after timeout!');
            setErrorMsg('Failed to initialize game canvas. Please refresh the page.');
            setScreen('menu');
            setIsInitializingGame(false);
            return;
          }
          
          try {
            console.log('[App] Creating GameManager with container:', gameContainerRef.current, 'playerId:', finalPlayerId);
            const gm = new GameManager(
              gameContainerRef.current,
              socket,
              finalPlayerId,
              data.gameState
            );
            gameManagerRef.current = gm;
            gm.start();
            setIsInitializingGame(false);
            console.log('[App] GameManager started successfully');
          } catch (error) {
            console.error('[App] Failed to create GameManager:', error);
            setErrorMsg(`Failed to start game: ${error instanceof Error ? error.message : 'Unknown error'}`);
            setScreen('menu');
            setIsInitializingGame(false);
            gameManagerRef.current = null;
          }
        }, 50);
      });
    };

    const onGameOver = (data: { winnerId: string; reason: string }) => {
      if (gameManagerRef.current) {
        gameManagerRef.current.stop();
        gameManagerRef.current = null;
      }
      alert(data.reason);
      setScreen('rooms');
    };

    socket.on('joinedRoom', onJoinedRoom);
    socket.on('roomUpdate', onRoomUpdate);
    socket.on('leftRoom', onLeftRoom);
    socket.on('error', onError);
    socket.on('gameStart', onGameStart);
    socket.on('gameOver', onGameOver);

    return () => {
      socket.off('connect_error', onConnectError);
      socket.off('joinedRoom', onJoinedRoom);
      socket.off('roomUpdate', onRoomUpdate);
      socket.off('leftRoom', onLeftRoom);
      socket.off('error', onError);
      socket.off('gameStart', onGameStart);
      socket.off('gameOver', onGameOver);
    };
  }, [playerId]);

  // Cleanup game on unmount
  useEffect(() => {
    return () => {
      if (gameManagerRef.current) {
        gameManagerRef.current.stop();
      }
    };
  }, []);

  const handlePlay = useCallback((name: string, mode: 'singleplayer' | 'singleplayer-ffa' | 'multiplayer') => {
    const trimmedName = name.trim() || `Player${Math.floor(Math.random() * 9999)}`;
    setPlayerName(trimmedName);
    
    if (mode === 'multiplayer') {
      setScreen('rooms');
    } else {
      // Single player — create a game with bot(s) immediately
      const maxPlayers = mode === 'singleplayer-ffa' ? 4 : 2;
      setIsConnecting(true);
      setErrorMsg('');
      
      try {
        // Ensure socket is connected first
        if (!socket.connected) {
          socket.connect();
          const onConnect = () => {
            setIsConnecting(false);
            socket.emit('createSinglePlayerGame', { playerName: trimmedName, maxPlayers });
            socket.off('connect', onConnect);
            socket.off('connect_error', onConnectError);
          };
          const onConnectError = () => {
            setIsConnecting(false);
            setErrorMsg('Failed to connect to server. Make sure the server is running on port 3000.');
            socket.off('connect', onConnect);
            socket.off('connect_error', onConnectError);
          };
          socket.once('connect', onConnect);
          socket.once('connect_error', onConnectError);
        } else {
          setIsConnecting(false);
          socket.emit('createSinglePlayerGame', { playerName: trimmedName, maxPlayers });
        }
      } catch (error) {
        setIsConnecting(false);
        console.error('Error creating single player game:', error);
        setErrorMsg('Failed to create single player game. Check console for details.');
      }
    }
  }, []);

  const handleBack = useCallback(() => {
    if (screen === 'rooms') setScreen('menu');
    else if (screen === 'room') {
      socket.emit('leaveRoom');
    }
  }, [screen]);

  if (!isMounted) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        color: '#eee',
      }}>
        <div style={{ fontSize: 18 }}>Loading...</div>
      </div>
    );
  }

  // Debug: Log current screen state
  console.log('[App] Render - screen:', screen, 'playerId:', playerId, 'gameManager:', !!gameManagerRef.current);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', minHeight: '100vh' }}>
      {errorMsg && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#e74c3c', color: '#fff', padding: '10px 24px', borderRadius: 8,
          zIndex: 9999, fontSize: 14, fontWeight: 600,
        }}>
          {errorMsg}
        </div>
      )}
      {isConnecting && (
        <div style={{
          position: 'fixed', top: 20, left: '50%', transform: 'translateX(-50%)',
          background: '#3498db', color: '#fff', padding: '10px 24px', borderRadius: 8,
          zIndex: 9999, fontSize: 14, fontWeight: 600,
        }}>
          Connecting to server...
        </div>
      )}

      {screen === 'menu' && <MainMenu onPlay={handlePlay} />}
      {screen === 'rooms' && (
        <RoomBrowser playerName={playerName} onBack={handleBack} />
      )}
      {screen === 'room' && currentRoom && (
        <RoomView room={currentRoom} playerId={playerId} onBack={handleBack} />
      )}
      {screen === 'game' && (
        <div
          ref={gameContainerRef}
          style={{
            width: '100%',
            height: '100%',
            background: '#1a1a2e',
            position: 'relative',
          }}
        >
          {!gameManagerRef.current && isInitializingGame && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#eee',
              fontSize: 18,
              textAlign: 'center',
            }}>
              <div>Initializing game...</div>
            </div>
          )}
          {!gameManagerRef.current && !isInitializingGame && (
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              color: '#eee',
              fontSize: 18,
              textAlign: 'center',
            }}>
              <div>Game failed to initialize</div>
              <button
                onClick={() => {
                  setScreen('menu');
                  setIsInitializingGame(false);
                  if (gameManagerRef.current) {
                    gameManagerRef.current.stop();
                    gameManagerRef.current = null;
                  }
                }}
                style={{
                  marginTop: 20,
                  padding: '10px 20px',
                  background: '#e94560',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                }}
              >
                Return to Menu
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default App;

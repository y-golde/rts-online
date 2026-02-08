/**
 * @file MainMenu.tsx
 * @description Landing page with "Single Player" and "Multiplayer" buttons.
 * Player enters their name before proceeding.
 */

import React, { useState } from 'react';

interface MainMenuProps {
  onPlay: (name: string, mode: 'singleplayer' | 'multiplayer') => void;
}

const MainMenu: React.FC<MainMenuProps> = ({ onPlay }) => {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>('');

  /**
   * Validates the username input.
   * Returns error message if invalid, empty string if valid.
   */
  const validateUsername = (username: string): string => {
    const trimmed = username.trim();

    if (trimmed.length === 0) {
      return 'Username cannot be empty';
    }

    if (trimmed.length < 2) {
      return 'Username must be at least 2 characters';
    }

    if (trimmed.length > 20) {
      return 'Username must be 20 characters or less';
    }

    // Allow alphanumeric, spaces, hyphens, underscores
    // Disallow special characters that could cause issues
    const validPattern = /^[a-zA-Z0-9 _-]+$/;
    if (!validPattern.test(trimmed)) {
      return 'Username can only contain letters, numbers, spaces, hyphens, and underscores';
    }

    // Disallow usernames that start/end with spaces or special chars
    if (trimmed !== trimmed.trim()) {
      return 'Username cannot start or end with spaces';
    }

    // Disallow reserved names (like bot names)
    if (trimmed.toLowerCase().startsWith('[bot]')) {
      return 'Username cannot start with "[BOT]"';
    }

    return '';
  };

  const handlePlay = (mode: 'singleplayer' | 'multiplayer') => {
    try {
      const trimmed = name.trim();
      
      // Validate username
      const validationError = validateUsername(trimmed);
      if (validationError) {
        setError(validationError);
        return;
      }

      // Clear any previous errors
      setError('');
      console.log('MainMenu: handlePlay called', { mode, name: trimmed });
      onPlay(trimmed, mode);
    } catch (error) {
      console.error('Error in handlePlay:', error);
      setError('An error occurred. Please try again.');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setName(newValue);
    
    // Clear error when user starts typing
    if (error) {
      setError('');
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>RTS Online</h1>
      <p style={styles.subtitle}>A browser-based real-time strategy game</p>

      <div style={styles.card}>
        <div style={styles.inputContainer}>
          <input
            type="text"
            placeholder="Enter your name..."
            value={name}
            onChange={handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handlePlay('multiplayer');
              }
            }}
            style={{
              ...styles.input,
              ...(error ? {
                border: '2px solid #e74c3c',
              } : {}),
            }}
            maxLength={20}
            autoFocus
          />
          {error && (
            <div style={styles.errorMessage}>{error}</div>
          )}
        </div>

        <div style={styles.buttonRow}>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              console.log('Single Player button clicked');
              handlePlay('singleplayer');
            }}
            disabled={!!error}
            style={{
              ...styles.button,
              ...styles.buttonSecondary,
              ...(error ? styles.buttonDisabled : {}),
            }}
          >
            Single Player
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              handlePlay('multiplayer');
            }}
            disabled={!!error}
            style={{
              ...styles.button,
              ...styles.buttonPrimary,
              ...(error ? styles.buttonDisabled : {}),
            }}
          >
            Multiplayer
          </button>
        </div>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%',
    background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  },
  title: {
    fontSize: 64, fontWeight: 800, margin: 0,
    background: 'linear-gradient(90deg, #e94560, #f39c12)',
    WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: 18, color: '#8899aa', marginTop: 8, marginBottom: 40,
  },
  card: {
    background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: '32px 40px',
    backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)',
    display: 'flex', flexDirection: 'column', gap: 20, minWidth: 360,
  },
  inputContainer: {
    display: 'flex', flexDirection: 'column', gap: 8, width: '100%',
  },
  input: {
    padding: '12px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(0,0,0,0.3)', color: '#eee', fontSize: 16,
    outline: 'none', width: '100%', transition: 'border-color 0.2s',
  },
  inputError: {
    borderColor: '#e74c3c',
    borderWidth: '2px',
  },
  errorMessage: {
    fontSize: 13, color: '#e74c3c', fontWeight: 500,
    paddingLeft: 4,
  },
  buttonRow: {
    display: 'flex', gap: 12,
  },
  button: {
    flex: 1, padding: '14px 20px', borderRadius: 8, border: 'none',
    fontSize: 16, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
  },
  buttonDisabled: {
    opacity: 0.5, cursor: 'not-allowed',
  },
  buttonPrimary: {
    background: 'linear-gradient(135deg, #e94560, #c0392b)',
    color: '#fff',
  },
  buttonSecondary: {
    background: 'rgba(255,255,255,0.1)', color: '#ccc',
    border: '1px solid rgba(255,255,255,0.15)',
  },
};

export default MainMenu;

/**
 * @file GameManager.ts
 * @description Orchestrates the game canvas, input, renderer, and socket events.
 * Owns the 60fps render loop. Connects server state updates to the interpolator
 * and renderer.
 *
 * @see Renderer.ts for Canvas2D drawing
 * @see Camera.ts for viewport
 * @see InputHandler.ts for user interaction
 * @see Interpolator.ts for smooth rendering between server ticks
 */

import type { Socket } from 'socket.io-client';
import type { GameState, ClientToServerEvents, ServerToClientEvents } from '@rts/shared';
import { Camera } from './Camera.js';
import { Renderer } from './Renderer.js';
import { Interpolator } from './Interpolator.js';
import { InputHandler } from './InputHandler.js';
import { HUD } from './HUD.js';
import { ErrorToast } from './ErrorToast.js';

/**
 * The top-level game controller. Created when a game starts.
 * Manages the render loop, input, and socket state synchronization.
 */
export class GameManager {
  private canvas: HTMLCanvasElement;
  private camera: Camera;
  private renderer: Renderer;
  private interpolator: Interpolator;
  private inputHandler: InputHandler;
  private hud: HUD;
  private errorToast: ErrorToast;
  private animFrameId: number | null = null;
  private latestState: GameState;
  private socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  private playerId: string;
  /** Timestamp when game started (for home base highlight animation). */
  private gameStartTime = 0;

  constructor(
    container: HTMLDivElement,
    socket: Socket<ServerToClientEvents, ClientToServerEvents>,
    playerId: string,
    initialState: GameState
  ) {
    console.log('[GameManager] Constructor called', { playerId, container: !!container });
    
    if (!container) {
      throw new Error('Container element is required');
    }
    if (!playerId) {
      throw new Error('Player ID is required');
    }

    this.socket = socket;
    this.playerId = playerId;
    this.latestState = initialState;

    // Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    container.appendChild(this.canvas);
    
    console.log('[GameManager] Canvas created and appended');

    // Initialize subsystems
    this.camera = new Camera();
    this.renderer = new Renderer(this.canvas);
    this.interpolator = new Interpolator();
    this.hud = new HUD(this.canvas);
    this.errorToast = new ErrorToast();
    this.inputHandler = new InputHandler(
      this.canvas,
      this.camera,
      this.hud,
      socket,
      playerId,
      this // Pass GameManager reference for centerOnHomeBase
    );
    this.inputHandler.setErrorToast(this.errorToast);

    // Push initial state
    this.interpolator.pushState(initialState);
    this.inputHandler.setState(initialState);

    // Set camera map dimensions from initial state
    this.camera.setMapSize(initialState.mapWidth, initialState.mapHeight);

    // Listen for state updates
    this.onGameState = this.onGameState.bind(this);
    socket.on('gameState', this.onGameState);

    // Size canvas and center camera on player's home base
    try {
      this.resize();
      window.addEventListener('resize', this.onResize);
      // Ensure viewport is set before centering
      if (this.camera.viewportWidth > 0 && this.camera.viewportHeight > 0) {
        this.centerOnBase(initialState);
      } else {
        // Retry after a short delay if viewport not ready
        setTimeout(() => {
          this.resize();
          this.centerOnBase(initialState);
        }, 100);
      }
      this.gameStartTime = performance.now();
      console.log('[GameManager] Initialization complete');
    } catch (error) {
      console.error('[GameManager] Error during initialization:', error);
      throw error;
    }
  }

  /** Starts the 60fps render loop. */
  start(): void {
    const loop = () => {
      this.update();
      this.render();
      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  /** Stops the render loop and cleans up. */
  stop(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.socket.off('gameState', this.onGameState);
    this.inputHandler.destroy();
    window.removeEventListener('resize', this.onResize);
  }

  /** Called every server tick with the new game state. */
  private onGameState(state: GameState): void {
    this.latestState = state;
    this.interpolator.pushState(state);
    this.inputHandler.setState(state);
    // Update camera map dimensions if they changed (shouldn't happen, but be safe)
    this.camera.setMapSize(state.mapWidth, state.mapHeight);
  }

  /** Per-frame update (input, camera). */
  private update(): void {
    this.camera.update();
    this.inputHandler.updateHUD(this.latestState);
  }

  /** Per-frame render. */
  private render(): void {
    // Ensure canvas has valid dimensions
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      this.resize();
      if (this.canvas.width === 0 || this.canvas.height === 0) {
        return; // Skip render if still invalid
      }
    }

    const now = performance.now();
    const interpolatedPositions = this.interpolator.getInterpolatedPositions(now);
    const selectedEntities = this.inputHandler.getSelectedEntities(this.latestState);

    // Build ghost for building placement preview
    let buildGhost: { type: string; x: number; y: number; w: number; h: number; valid?: boolean } | null = null;
    if (this.inputHandler.buildMode && this.inputHandler.buildGhostPos) {
      buildGhost = {
        type: this.inputHandler.buildMode.type,
        x: this.inputHandler.buildGhostPos.x,
        y: this.inputHandler.buildGhostPos.y,
        w: this.inputHandler.buildMode.w,
        h: this.inputHandler.buildMode.h,
        valid: this.inputHandler.buildGhostValid,
      };
    }

    // Main render
    this.renderer.render(
      this.latestState,
      this.camera,
      interpolatedPositions,
      this.inputHandler.selectedIds,
      this.inputHandler.selectionBox,
      this.playerId,
      buildGhost,
      this.gameStartTime
    );

    // HUD (render first to get bottom panel height)
    this.hud.render(this.latestState, this.playerId, selectedEntities);

    // Minimap (positioned above HUD panel)
    this.renderer.renderMinimap(
      this.latestState,
      this.camera,
      this.playerId,
      this.hud.getBottomPanelHeight()
    );

    // Error toasts (rendered last so they're on top of everything)
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      this.errorToast.render(ctx, this.canvas.width);
    }
  }

  /** Resizes the canvas to fill its container. */
  private resize(): void {
    const parent = this.canvas.parentElement;
    if (!parent) {
      console.warn('[GameManager] No parent element for canvas resize');
      return;
    }
    const width = parent.clientWidth || window.innerWidth;
    const height = parent.clientHeight || window.innerHeight;
    
    if (width <= 0 || height <= 0) {
      console.warn('[GameManager] Invalid dimensions:', { width, height });
      return;
    }

    const wasInitialized = this.camera.viewportWidth > 0 && this.camera.viewportHeight > 0;
    this.canvas.width = width;
    this.canvas.height = height;
    this.camera.viewportWidth = width;
    this.camera.viewportHeight = height;
    console.log('[GameManager] Canvas resized to', width, 'x', height);
    
    // Re-center on base after resize if we had a previous state
    if (wasInitialized && this.latestState) {
      this.centerOnBase(this.latestState);
    }
  }

  private onResize = (): void => {
    this.resize();
  };

  /** Centers camera on the player's home base. */
  private centerOnBase(state: GameState): void {
    for (const entity of Object.values(state.entities)) {
      if (entity.type === 'homeBase' && entity.ownerId === this.playerId) {
        const centerX = entity.x + (entity.tileWidth ?? 3) / 2;
        const centerY = entity.y + (entity.tileHeight ?? 3) / 2;
        console.log('[GameManager] Centering camera on home base at', centerX, centerY);
        this.camera.centerOnTile(centerX, centerY);
        return;
      }
    }
    console.warn('[GameManager] Could not find home base to center on');
  }

  /** Public method to center camera on home base (called by hotkey). */
  centerOnHomeBase(): void {
    this.centerOnBase(this.latestState);
  }
}

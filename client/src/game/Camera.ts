/**
 * @file Camera.ts
 * @description Viewport transform: pan (WASD / arrow keys / edge scroll), zoom (scroll wheel),
 * and world-to-screen / screen-to-world coordinate conversion.
 *
 * @see constants.ts for TILE_SIZE, MAP_WIDTH, MAP_HEIGHT
 */

import { TILE_SIZE } from '@rts/shared';

/** Margin in pixels from the screen edge to trigger edge-scroll. */
const EDGE_SCROLL_MARGIN = 20;
/** Pan speed in pixels per frame. */
const PAN_SPEED = 12;
/** Zoom limits. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2.0;

export class Camera {
  /** Camera position in world pixels (top-left corner of viewport). */
  x = 0;
  y = 0;
  /** Zoom level (1 = default, 2 = zoomed in, 0.5 = zoomed out). */
  zoom = 1;
  /** Viewport dimensions in screen pixels. */
  viewportWidth = 0;
  viewportHeight = 0;
  /** Map dimensions in tiles (set from game state). */
  mapWidth = 60;
  mapHeight = 60;

  /** Currently held keys (for WASD / arrow panning). */
  private keys = new Set<string>();
  /** Mouse position in screen pixels (for edge scroll). */
  private mouseX = 0;
  private mouseY = 0;

  /**
   * Centers the camera on a world-pixel coordinate.
   */
  centerOn(worldX: number, worldY: number): void {
    this.x = worldX - this.viewportWidth / (2 * this.zoom);
    this.y = worldY - this.viewportHeight / (2 * this.zoom);
    this.clamp();
  }

  /**
   * Centers the camera on a tile coordinate.
   */
  centerOnTile(tileX: number, tileY: number): void {
    this.centerOn(tileX * TILE_SIZE + TILE_SIZE / 2, tileY * TILE_SIZE + TILE_SIZE / 2);
  }

  /**
   * Updates camera position based on keyboard and edge-scroll input.
   * Called once per frame in the render loop.
   */
  update(): void {
    let dx = 0;
    let dy = 0;

    // Keyboard pan
    if (this.keys.has('w') || this.keys.has('arrowup')) dy -= PAN_SPEED;
    if (this.keys.has('s') || this.keys.has('arrowdown')) dy += PAN_SPEED;
    if (this.keys.has('a') || this.keys.has('arrowleft')) dx -= PAN_SPEED;
    if (this.keys.has('d') || this.keys.has('arrowright')) dx += PAN_SPEED;

    // Edge scroll (only if mouse is in the viewport)
    if (this.mouseX < EDGE_SCROLL_MARGIN) dx -= PAN_SPEED;
    if (this.mouseX > this.viewportWidth - EDGE_SCROLL_MARGIN) dx += PAN_SPEED;
    if (this.mouseY < EDGE_SCROLL_MARGIN) dy -= PAN_SPEED;
    if (this.mouseY > this.viewportHeight - EDGE_SCROLL_MARGIN) dy += PAN_SPEED;

    this.x += dx / this.zoom;
    this.y += dy / this.zoom;
    this.clamp();
  }

  /** Constrains camera to map bounds. */
  private clamp(): void {
    const worldWidth = this.mapWidth * TILE_SIZE;
    const worldHeight = this.mapHeight * TILE_SIZE;
    const viewW = this.viewportWidth / this.zoom;
    const viewH = this.viewportHeight / this.zoom;

    this.x = Math.max(0, Math.min(this.x, worldWidth - viewW));
    this.y = Math.max(0, Math.min(this.y, worldHeight - viewH));
  }

  /** Updates map dimensions (called when game state changes). */
  setMapSize(width: number, height: number): void {
    this.mapWidth = width;
    this.mapHeight = height;
    this.clamp(); // Re-clamp camera to new bounds
  }

  /**
   * Converts screen pixel coordinates to world pixel coordinates.
   */
  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: screenX / this.zoom + this.x,
      y: screenY / this.zoom + this.y,
    };
  }

  /**
   * Converts world pixel coordinates to screen pixel coordinates.
   */
  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: (worldX - this.x) * this.zoom,
      y: (worldY - this.y) * this.zoom,
    };
  }

  /**
   * Converts a tile coordinate to screen pixel coordinates.
   */
  tileToScreen(tileX: number, tileY: number): { x: number; y: number } {
    return this.worldToScreen(tileX * TILE_SIZE, tileY * TILE_SIZE);
  }

  /**
   * Converts screen pixel coordinates to tile coordinates.
   */
  screenToTile(screenX: number, screenY: number): { x: number; y: number } {
    const world = this.screenToWorld(screenX, screenY);
    return {
      x: Math.floor(world.x / TILE_SIZE),
      y: Math.floor(world.y / TILE_SIZE),
    };
  }

  // ─── Event Handlers (called by InputHandler) ─────────────────────

  onKeyDown(key: string): void {
    this.keys.add(key.toLowerCase());
  }

  onKeyUp(key: string): void {
    this.keys.delete(key.toLowerCase());
  }

  onMouseMove(screenX: number, screenY: number): void {
    this.mouseX = screenX;
    this.mouseY = screenY;
  }

  onWheel(delta: number): void {
    const zoomFactor = delta > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom * zoomFactor));

    // Zoom toward mouse position
    const worldBefore = this.screenToWorld(this.mouseX, this.mouseY);
    this.zoom = newZoom;
    const worldAfter = this.screenToWorld(this.mouseX, this.mouseY);
    this.x += worldBefore.x - worldAfter.x;
    this.y += worldBefore.y - worldAfter.y;
    this.clamp();
  }
}

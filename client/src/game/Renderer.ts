/**
 * @file Renderer.ts
 * @description Canvas2D rendering: terrain tiles, buildings (rectangles + emoji),
 * units (circles + emoji), selection box, health bars, and gold mines.
 *
 * Performance: only renders tiles visible in the viewport.
 *
 * @see Camera.ts for viewport transform
 * @see constants.ts for TILE_SIZE, ENTITY_VISUALS
 */

import type { GameState, Entity, GoldMine } from '@rts/shared';
import { TILE_SIZE, ENTITY_VISUALS, GOLD_MINE_TILE_WIDTH, GOLD_MINE_TILE_HEIGHT, WORKER_TRAIN_TICKS, INFANTRY_TRAIN_TICKS, ARCHER_TRAIN_TICKS, CAVALRY_TRAIN_TICKS, BALLISTA_TRAIN_TICKS, TOWER_RANGE, HOME_BASE_RANGE } from '@rts/shared';
import type { Camera } from './Camera.js';

/** Tile color mapping. */
const TILE_COLORS: Record<string, string> = {
  grass: '#4a7c3f',
  water: '#2980b9',
  rock: '#7f8c8d',
  trees: '#2d6b2d',
};

/**
 * Handles all Canvas2D drawing for the game.
 */
export class Renderer {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get 2D rendering context from canvas');
    }
    this.ctx = ctx;
    console.log('[Renderer] Canvas context initialized', { width: canvas.width, height: canvas.height });
  }

  /**
   * Renders a full frame: terrain, buildings, units, selection, HUD.
   *
   * @param state - Latest game state
   * @param camera - Current camera (for viewport transform)
   * @param interpolatedPositions - Smoothed entity positions
   * @param selectedIds - Set of currently selected entity IDs
   * @param selectionBox - Drag-selection rectangle in screen coords (or null)
   * @param playerId - Current player's ID (to distinguish own/enemy entities)
   * @param buildGhost - Building placement preview (or null)
   */
  render(
    state: GameState,
    camera: Camera,
    interpolatedPositions: Map<string, { x: number; y: number }> | null,
    selectedIds: Set<string>,
    selectionBox: { x1: number; y1: number; x2: number; y2: number } | null,
    playerId: string,
    buildGhost: { type: string; x: number; y: number; w: number; h: number; valid?: boolean } | null,
    gameStartTime: number = 0
  ): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    if (w === 0 || h === 0) {
      console.warn('[Renderer] Canvas has zero dimensions, skipping render');
      return;
    }

    // Clear with a visible color to verify rendering works
    ctx.fillStyle = '#1a1a2e'; // Dark blue background instead of black
    ctx.fillRect(0, 0, w, h);

    // Save and apply camera transform
    ctx.save();
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // ─── Terrain ─────────────────────────────────────────────────
    this.renderTerrain(state, camera);

    // ─── Gold Mines ──────────────────────────────────────────────
    for (const mine of state.goldMines) {
      this.renderGoldMine(mine);
    }

    // ─── Buildings ───────────────────────────────────────────────
    const entities = Object.values(state.entities);
    const buildings = entities.filter((e) => e.tileWidth && e.tileHeight);
    const units = entities.filter((e) => !e.tileWidth || !e.tileHeight);

    for (const building of buildings) {
      const pos = interpolatedPositions?.get(building.id) ?? building;
      const isHomeBase = building.type === 'homeBase' && building.ownerId === playerId;
      const highlightHomeBase = isHomeBase && gameStartTime > 0 && (performance.now() - gameStartTime) < 3000; // Highlight for 3 seconds
      this.renderBuilding(building, pos, state.players[building.ownerId]?.color ?? '#888', selectedIds.has(building.id), highlightHomeBase);
    }

    // ─── Rally Points (for selected buildings) ─────────────────────
    for (const building of buildings) {
      if (!selectedIds.has(building.id)) continue;
      if (!building.rallyPoint) continue;
      if (building.ownerId !== playerId) continue;

      const bx = building.x + (building.tileWidth ?? 2) / 2;
      const by = building.y + (building.tileHeight ?? 2) / 2;
      const rx = building.rallyPoint.x + 0.5;
      const ry = building.rallyPoint.y + 0.5;

      // Dashed line from building center to rally point
      ctx.strokeStyle = 'rgba(46, 204, 113, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(bx * TILE_SIZE, by * TILE_SIZE);
      ctx.lineTo(rx * TILE_SIZE, ry * TILE_SIZE);
      ctx.stroke();
      ctx.setLineDash([]);

      // Flag emoji at rally point
      ctx.font = `${TILE_SIZE * 0.5}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚩', rx * TILE_SIZE, ry * TILE_SIZE);
    }

    // ─── Build Ghost ─────────────────────────────────────────────
    if (buildGhost) {
      const valid = buildGhost.valid !== false; // default true if not specified
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = valid ? '#2ecc71' : '#e74c3c';
      ctx.fillRect(
        buildGhost.x * TILE_SIZE,
        buildGhost.y * TILE_SIZE,
        buildGhost.w * TILE_SIZE,
        buildGhost.h * TILE_SIZE
      );
      // Draw X marks when invalid
      if (!valid) {
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        const gx = buildGhost.x * TILE_SIZE;
        const gy = buildGhost.y * TILE_SIZE;
        const gw = buildGhost.w * TILE_SIZE;
        const gh = buildGhost.h * TILE_SIZE;
        ctx.beginPath();
        ctx.moveTo(gx + 4, gy + 4);
        ctx.lineTo(gx + gw - 4, gy + gh - 4);
        ctx.moveTo(gx + gw - 4, gy + 4);
        ctx.lineTo(gx + 4, gy + gh - 4);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ─── Units ───────────────────────────────────────────────────
    // Group units by tile position to detect stacking
    const unitsByTile = new Map<string, Entity[]>();
    for (const unit of units) {
      const pos = interpolatedPositions?.get(unit.id) ?? unit;
      const tileX = Math.floor(pos.x);
      const tileY = Math.floor(pos.y);
      const tileKey = `${tileX},${tileY}`;
      if (!unitsByTile.has(tileKey)) {
        unitsByTile.set(tileKey, []);
      }
      unitsByTile.get(tileKey)!.push(unit);
    }

    // Render units, showing stack count if multiple units on same tile
    for (const [tileKey, stackedUnits] of unitsByTile) {
      for (const unit of stackedUnits) {
        const pos = interpolatedPositions?.get(unit.id) ?? unit;
        const stackCount = stackedUnits.length;
        this.renderUnit(unit, pos, state.players[unit.ownerId]?.color ?? '#888', selectedIds.has(unit.id), stackCount > 1 ? stackCount : undefined);
      }
    }

    ctx.restore();

    // ─── Selection Box (screen coords) ──────────────────────────
    if (selectionBox) {
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      const sx = Math.min(selectionBox.x1, selectionBox.x2);
      const sy = Math.min(selectionBox.y1, selectionBox.y2);
      const sw = Math.abs(selectionBox.x2 - selectionBox.x1);
      const sh = Math.abs(selectionBox.y2 - selectionBox.y1);
      ctx.strokeRect(sx, sy, sw, sh);
      ctx.setLineDash([]);
    }
  }

  /** Renders only the visible terrain tiles. */
  private renderTerrain(state: GameState, camera: Camera): void {
    const ctx = this.ctx;
    const startTileX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
    const startTileY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
    const endTileX = Math.min(
      state.mapWidth,
      Math.ceil((camera.x + camera.viewportWidth / camera.zoom) / TILE_SIZE) + 1
    );
    const endTileY = Math.min(
      state.mapHeight,
      Math.ceil((camera.y + camera.viewportHeight / camera.zoom) / TILE_SIZE) + 1
    );

    for (let y = startTileY; y < endTileY; y++) {
      for (let x = startTileX; x < endTileX; x++) {
        const tile = state.tiles[y]?.[x];
        ctx.fillStyle = TILE_COLORS[tile] ?? '#333';
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }

    // Grid lines (subtle)
    ctx.strokeStyle = 'rgba(0,0,0,0.1)';
    ctx.lineWidth = 0.5;
    for (let y = startTileY; y <= endTileY; y++) {
      ctx.beginPath();
      ctx.moveTo(startTileX * TILE_SIZE, y * TILE_SIZE);
      ctx.lineTo(endTileX * TILE_SIZE, y * TILE_SIZE);
      ctx.stroke();
    }
    for (let x = startTileX; x <= endTileX; x++) {
      ctx.beginPath();
      ctx.moveTo(x * TILE_SIZE, startTileY * TILE_SIZE);
      ctx.lineTo(x * TILE_SIZE, endTileY * TILE_SIZE);
      ctx.stroke();
    }
  }

  /** Renders a building as a colored rectangle with emoji. */
  private renderBuilding(
    entity: Entity,
    pos: { x: number; y: number },
    color: string,
    selected: boolean,
    highlight: boolean = false
  ): void {
    const ctx = this.ctx;
    const tw = (entity.tileWidth ?? 2) * TILE_SIZE;
    const th = (entity.tileHeight ?? 2) * TILE_SIZE;
    const px = pos.x * TILE_SIZE;
    const py = pos.y * TILE_SIZE;

    // Building rectangle
    ctx.fillStyle = color;
    ctx.globalAlpha = entity.buildProgress !== undefined && entity.buildProgress < 1 ? 0.5 : 0.85;
    ctx.fillRect(px, py, tw, th);
    ctx.globalAlpha = 1;

    // Highlight pulse effect (for home base at game start)
    if (highlight) {
      const pulse = 0.5 + 0.5 * Math.sin((performance.now() / 200) % (Math.PI * 2));
      ctx.strokeStyle = `rgba(46, 204, 113, ${0.6 + pulse * 0.4})`; // Green pulse
      ctx.lineWidth = 4;
      ctx.strokeRect(px - 2, py - 2, tw + 4, th + 4);
    }

    // Border
    ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.5)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(px, py, tw, th);

    // Emoji - show scaffolding icon when building
    const isBuilding = entity.buildProgress !== undefined && entity.buildProgress < 1;
    const visual = ENTITY_VISUALS[entity.type];
    if (visual) {
      ctx.font = `${Math.min(tw, th) * 0.6}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Show scaffolding icon (🏗️) when building, otherwise normal emoji
      const emoji = isBuilding ? '🏗️' : visual.emoji;
      ctx.fillText(emoji, px + tw / 2, py + th / 2);
    }

    // Health bar (only show if not building or if damaged)
    if (!isBuilding || entity.hp < entity.maxHp) {
      this.renderHealthBar(ctx, px, py - 6, tw, entity.hp, entity.maxHp);
    }

    // Build progress bar (above building, more visible)
    if (isBuilding) {
      const barHeight = 6;
      const barY = py - barHeight - 8;
      const barWidth = tw;
      
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(px, barY, barWidth, barHeight);
      
      // Progress fill
      const progress = entity.buildProgress ?? 0;
      ctx.fillStyle = '#2ecc71'; // Green for construction
      ctx.fillRect(px, barY, barWidth * progress, barHeight);
      
      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px, barY, barWidth, barHeight);
      
      // Percentage text
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(progress * 100)}%`, px + barWidth / 2, barY + barHeight / 2);
    }

    // Training queue progress bar (below building)
    if (entity.trainingQueue && entity.trainingQueue.length > 0 && !isBuilding) {
      const firstOrder = entity.trainingQueue[0];
      const barHeight = 6;
      const barY = py + th + 2;
      const barWidth = tw;
      
      // Calculate progress based on unit type
      const totalTicks = firstOrder.unitType === 'worker' ? WORKER_TRAIN_TICKS
        : firstOrder.unitType === 'archer' ? ARCHER_TRAIN_TICKS
        : firstOrder.unitType === 'cavalry' ? CAVALRY_TRAIN_TICKS
        : firstOrder.unitType === 'ballista' ? BALLISTA_TRAIN_TICKS
        : INFANTRY_TRAIN_TICKS;
      const progress = Math.max(0, Math.min(1, 1 - (firstOrder.ticksRemaining / totalTicks)));
      
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(px, barY, barWidth, barHeight);
      
      // Progress fill (blue for training)
      ctx.fillStyle = '#3498db';
      ctx.fillRect(px, barY, barWidth * progress, barHeight);
      
      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px, barY, barWidth, barHeight);
      
      // Unit emoji and queue count
      const unitVisual = ENTITY_VISUALS[firstOrder.unitType];
      const queueText = entity.trainingQueue.length > 1 
        ? `${unitVisual?.emoji ?? ''} x${entity.trainingQueue.length}`
        : unitVisual?.emoji ?? '';
      
      ctx.fillStyle = '#fff';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(queueText, px + barWidth / 2, barY + barHeight / 2);
    }

    // Tower / Home Base range circle (shown when selected)
    if ((entity.type === 'tower' || entity.type === 'homeBase') && selected && !isBuilding) {
      const rangePx = (entity.type === 'homeBase' ? HOME_BASE_RANGE : TOWER_RANGE) * TILE_SIZE;
      ctx.strokeStyle = 'rgba(231, 76, 60, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(px + tw / 2, py + th / 2, rangePx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

  }

  /** Renders a gold mine. */
  private renderGoldMine(mine: GoldMine): void {
    const ctx = this.ctx;
    const tw = GOLD_MINE_TILE_WIDTH * TILE_SIZE;
    const th = GOLD_MINE_TILE_HEIGHT * TILE_SIZE;
    const px = mine.x * TILE_SIZE;
    const py = mine.y * TILE_SIZE;

    ctx.fillStyle = '#c9a33c';
    ctx.globalAlpha = 0.9;
    ctx.fillRect(px, py, tw, th);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = '#8b6914';
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, tw, th);

    const visual = ENTITY_VISUALS['goldMine'];
    if (visual) {
      ctx.font = `${Math.min(tw, th) * 0.6}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(visual.emoji, px + tw / 2, py + th / 2);
    }

    // Gold remaining indicator
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(`${mine.goldRemaining}`, px + tw / 2, py + th + 12);
  }

  /** Renders a unit as a colored circle with emoji. */
  private renderUnit(
    entity: Entity,
    pos: { x: number; y: number },
    color: string,
    selected: boolean,
    stackCount?: number
  ): void {
    const ctx = this.ctx;
    const cx = pos.x * TILE_SIZE + TILE_SIZE / 2;
    const cy = pos.y * TILE_SIZE + TILE_SIZE / 2;
    const radius = TILE_SIZE * 0.4;

    // Circle
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Border
    ctx.strokeStyle = selected ? '#fff' : 'rgba(0,0,0,0.4)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.stroke();

    // Selection ring
    if (selected) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = '#2ecc71';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Emoji
    const visual = ENTITY_VISUALS[entity.type];
    if (visual) {
      ctx.font = `${TILE_SIZE * 0.5}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(visual.emoji, cx, cy);
    }

    // Health bar (above unit, only if damaged)
    if (entity.hp < entity.maxHp) {
      this.renderHealthBar(ctx, cx - radius, cy - radius - 8, radius * 2, entity.hp, entity.maxHp);
    }

    // Action progress bar (for mining)
    const barY = cy - radius - 12;
    if (entity.state === 'gathering' && entity.miningProgress !== undefined) {
      const barWidth = radius * 2;
      const barHeight = 4;
      
      // Background
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx - barWidth / 2, barY, barWidth, barHeight);
      
      // Progress fill (mining = orange/yellow)
      const progress = Math.max(0, Math.min(1, entity.miningProgress));
      ctx.fillStyle = '#f39c12';
      ctx.fillRect(cx - barWidth / 2, barY, barWidth * progress, barHeight);
      
      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - barWidth / 2, barY, barWidth, barHeight);
    }

    // Stack count indicator (if multiple units on same tile)
    if (stackCount && stackCount > 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(cx + radius - 12, cy - radius - 2, 16, 12);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx + radius - 12, cy - radius - 2, 16, 12);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`x${stackCount}`, cx + radius - 4, cy - radius + 4);
    }

    // Carried gold indicator
    if (entity.carriedGold && entity.carriedGold > 0) {
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#f1c40f';
      ctx.textAlign = 'center';
      ctx.fillText(`+${entity.carriedGold}`, cx, cy + radius + 12);
    }
  }

  /** Renders a small health bar. */
  private renderHealthBar(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    hp: number,
    maxHp: number
  ): void {
    if (hp >= maxHp) return; // Don't show full health bars

    const ratio = hp / maxHp;
    const barHeight = 3;

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x, y, width, barHeight);

    ctx.fillStyle = ratio > 0.6 ? '#2ecc71' : ratio > 0.3 ? '#f39c12' : '#e74c3c';
    ctx.fillRect(x, y, width * ratio, barHeight);
  }

  /**
   * Renders the minimap in the bottom-left corner.
   * Responsive sizing for small screens.
   */
  renderMinimap(
    state: GameState,
    camera: Camera,
    playerId: string,
    bottomPanelHeight: number = 0
  ): void {
    const ctx = this.ctx;
    // Responsive minimap size - smaller on small screens
    const mmSize = Math.min(160, Math.max(100, Math.min(this.canvas.width, this.canvas.height) * 0.15));
    const mmX = 10;
    // Position above bottom HUD panel, with padding
    const bottomMargin = bottomPanelHeight > 0 ? bottomPanelHeight + 10 : 10;
    const mmY = Math.max(46, this.canvas.height - mmSize - bottomMargin); // 46 = top bar (36) + padding (10)
    const scale = mmSize / Math.max(state.mapWidth, state.mapHeight);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(mmX, mmY, mmSize, mmSize * (state.mapHeight / state.mapWidth));

    // Entities as dots
    for (const entity of Object.values(state.entities)) {
      const color = state.players[entity.ownerId]?.color ?? '#888';
      ctx.fillStyle = color;
      const ex = mmX + entity.x * scale;
      const ey = mmY + entity.y * scale;
      const size = (entity.tileWidth ?? 1) > 1 ? 3 : 2;
      ctx.fillRect(ex, ey, size, size);
    }

    // Gold mines
    ctx.fillStyle = '#f1c40f';
    for (const mine of state.goldMines) {
      ctx.fillRect(mmX + mine.x * scale, mmY + mine.y * scale, 2, 2);
    }

    // Camera viewport indicator
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    const vx = mmX + camera.x / TILE_SIZE * scale;
    const vy = mmY + camera.y / TILE_SIZE * scale;
    const vw = (camera.viewportWidth / camera.zoom) / TILE_SIZE * scale;
    const vh = (camera.viewportHeight / camera.zoom) / TILE_SIZE * scale;
    ctx.strokeRect(vx, vy, vw, vh);

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.strokeRect(mmX, mmY, mmSize, mmSize * (state.mapHeight / state.mapWidth));
  }
}

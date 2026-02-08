/**
 * @file InputHandler.ts
 * @description Translates mouse clicks, drags, and keyboard input into game commands
 * sent to the server via socket. Handles unit selection, move commands, attack commands,
 * building placement, and resource gathering.
 *
 * @see Camera.ts for coordinate conversion
 * @see HUD.ts for action button click detection
 */

import type { Socket } from 'socket.io-client';
import type {
  GameState,
  Entity,
  ClientToServerEvents,
  ServerToClientEvents,
  BuildingType,
  EntityType,
} from '@rts/shared';
import {
  TILE_SIZE,
  GOLD_MINE_TILE_WIDTH,
  GOLD_MINE_TILE_HEIGHT,
  HOUSE_TILE_WIDTH,
  HOUSE_TILE_HEIGHT,
  BARRACKS_TILE_WIDTH,
  BARRACKS_TILE_HEIGHT,
  RESOURCE_DEPOT_TILE_WIDTH,
  RESOURCE_DEPOT_TILE_HEIGHT,
  TOWER_TILE_WIDTH,
  TOWER_TILE_HEIGHT,
  ARMORY_TILE_WIDTH,
  ARMORY_TILE_HEIGHT,
} from '@rts/shared';
import type { Camera } from './Camera.js';
import { HUD, getActionsForSelection } from './HUD.js';
import type { ErrorToast } from './ErrorToast.js';

/** Drag selection box in screen coordinates. */
export interface SelectionBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Manages all user input and translates it to game commands.
 */
export class InputHandler {
  /** Currently selected entity IDs. */
  selectedIds = new Set<string>();
  /** Drag-selection box (null if not dragging). */
  selectionBox: SelectionBox | null = null;
  /** Building placement mode (null if not placing). */
  buildMode: { type: BuildingType; w: number; h: number } | null = null;
  /** Current build ghost position (tile coords). */
  buildGhostPos: { x: number; y: number } | null = null;
  /** Whether the current build ghost position is valid. */
  buildGhostValid = true;

  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;

  /** Error toast for showing in-game messages. */
  private errorToast: ErrorToast | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private camera: Camera,
    private hud: HUD,
    private socket: Socket<ServerToClientEvents, ClientToServerEvents>,
    private playerId: string,
    private gameManager?: { centerOnHomeBase: () => void }
  ) {
    this.bindEvents();
  }

  /** Sets the error toast reference (called by GameManager after construction). */
  setErrorToast(toast: ErrorToast): void {
    this.errorToast = toast;
  }

  /** Returns selected entities from the current game state. */
  getSelectedEntities(state: GameState): Entity[] {
    return Array.from(this.selectedIds)
      .map((id) => state.entities[id])
      .filter(Boolean);
  }

  /**
   * Updates HUD actions based on current selection.
   * Called each frame by GameManager.
   */
  updateHUD(state: GameState): void {
    const selected = this.getSelectedEntities(state);
    const actions = getActionsForSelection(
      selected,
      this.playerId,
      state,
      (buildingId, unitType) => this.trainUnit(buildingId, unitType),
      (buildingType) => this.enterBuildMode(buildingType),
      (armoryId, unitType) => this.upgradeUnit(armoryId, unitType),
      (msg) => this.errorToast?.show(msg)
    );
    this.hud.setActions(actions);
  }

  /** Cleans up event listeners. */
  destroy(): void {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  private bindEvents(): void {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.canvas.addEventListener('wheel', this.onWheel);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  // ─── Mouse Events ──────────────────────────────────────────────

  private onMouseDown = (e: MouseEvent): void => {
    if (e.button === 0) {
      // Left click

      // Check HUD click first
      const hudAction = this.hud.handleClick(e.offsetX, e.offsetY);
      if (hudAction) {
        hudAction.action();
        return;
      }

      // Building placement
      if (this.buildMode && this.buildGhostPos) {
        this.placeBuilding();
        return;
      }

      // Start drag selection
      this.isDragging = true;
      this.dragStartX = e.offsetX;
      this.dragStartY = e.offsetY;
      this.selectionBox = {
        x1: e.offsetX,
        y1: e.offsetY,
        x2: e.offsetX,
        y2: e.offsetY,
      };
    }
  };

  private onMouseMove = (e: MouseEvent): void => {
    this.camera.onMouseMove(e.offsetX, e.offsetY);

    if (this.isDragging && this.selectionBox) {
      this.selectionBox.x2 = e.offsetX;
      this.selectionBox.y2 = e.offsetY;
    }

    // Update build ghost + validity check
    if (this.buildMode) {
      const tile = this.camera.screenToTile(e.offsetX, e.offsetY);
      this.buildGhostPos = { x: tile.x, y: tile.y };
      this.buildGhostValid = this.checkPlacementValid(tile.x, tile.y, this.buildMode.w, this.buildMode.h);
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0 && this.isDragging) {
      this.isDragging = false;
      this.finalizeSelection(e.offsetX, e.offsetY);
      this.selectionBox = null;
    }
  };

  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();

    // Cancel build mode on right click
    if (this.buildMode) {
      this.buildMode = null;
      this.buildGhostPos = null;
      return;
    }

    // Right click = move or attack or gather or set rally point
    if (this.selectedIds.size === 0) return;

    // Check if selected entity is a building that can have a rally point
    if (this.currentState && this.selectedIds.size === 1) {
      const selectedId = Array.from(this.selectedIds)[0];
      const entity = this.currentState.entities[selectedId];
      if (entity && entity.ownerId === this.playerId &&
          (entity.type === 'homeBase' || entity.type === 'barracks')) {
        const tile = this.camera.screenToTile(e.offsetX, e.offsetY);
        this.socket.emit('setRallyPoint', { buildingId: entity.id, x: tile.x, y: tile.y });
        return;
      }
    }

    this.issueCommand(e.offsetX, e.offsetY);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.camera.onWheel(e.deltaY);
  };

  // ─── Keyboard Events ──────────────────────────────────────────

  private onKeyDown = (e: KeyboardEvent): void => {
    // Don't handle keys if typing in an input
    if (e.target instanceof HTMLInputElement) return;

    // Escape cancels build mode or selection
    if (e.key === 'Escape') {
      if (this.buildMode) {
        this.buildMode = null;
        this.buildGhostPos = null;
      } else {
        this.selectedIds.clear();
      }
      return;
    }

    // Spacebar or Home key: center camera on home base
    if (e.key === ' ' || e.key === 'Home') {
      e.preventDefault();
      if (this.gameManager) {
        this.gameManager.centerOnHomeBase();
      }
      return;
    }

    // HUD keyboard shortcuts take priority over camera pan.
    // Check if this key matches a HUD action — if so, execute it and
    // do NOT forward the key to the camera (prevents W/E/Q/R/T from panning).
    const hudAction = this.hud.handleKey(e.key);
    if (hudAction) {
      hudAction.action();
      return; // Don't forward to camera
    }

    // No HUD action matched — forward to camera for WASD / arrow panning
    this.camera.onKeyDown(e.key);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.camera.onKeyUp(e.key);
  };

  // ─── Selection Logic ──────────────────────────────────────────

  private currentState: GameState | null = null;

  /** Called by GameManager to provide latest state for hit-testing. */
  setState(state: GameState): void {
    this.currentState = state;
  }

  private finalizeSelection(endX: number, endY: number): void {
    if (!this.currentState) return;

    const dragDist = Math.sqrt(
      Math.pow(endX - this.dragStartX, 2) + Math.pow(endY - this.dragStartY, 2)
    );

    if (dragDist < 5) {
      // Click selection (single entity)
      this.clickSelect(endX, endY);
    } else {
      // Box selection
      this.boxSelect();
    }
  }

  private clickSelect(screenX: number, screenY: number): void {
    if (!this.currentState) return;

    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const tileX = worldPos.x / TILE_SIZE;
    const tileY = worldPos.y / TILE_SIZE;

    let closest: Entity | null = null;
    let closestDist = 2; // Max click distance in tiles

    for (const entity of Object.values(this.currentState.entities)) {
      const ex = entity.x + (entity.tileWidth ? entity.tileWidth / 2 : 0.5);
      const ey = entity.y + (entity.tileHeight ? entity.tileHeight / 2 : 0.5);
      const dist = Math.sqrt(Math.pow(tileX - ex, 2) + Math.pow(tileY - ey, 2));
      if (dist < closestDist) {
        closestDist = dist;
        closest = entity;
      }
    }

    this.selectedIds.clear();
    if (closest) {
      this.selectedIds.add(closest.id);
    }
  }

  private boxSelect(): void {
    if (!this.currentState || !this.selectionBox) return;

    const box = this.selectionBox;
    const topLeft = this.camera.screenToWorld(
      Math.min(box.x1, box.x2),
      Math.min(box.y1, box.y2)
    );
    const bottomRight = this.camera.screenToWorld(
      Math.max(box.x1, box.x2),
      Math.max(box.y1, box.y2)
    );

    this.selectedIds.clear();

    for (const entity of Object.values(this.currentState.entities)) {
      if (entity.ownerId !== this.playerId) continue;
      // Only select own units (not buildings) in box select
      if (entity.tileWidth && entity.tileHeight) continue;

      const worldX = entity.x * TILE_SIZE + TILE_SIZE / 2;
      const worldY = entity.y * TILE_SIZE + TILE_SIZE / 2;

      if (
        worldX >= topLeft.x && worldX <= bottomRight.x &&
        worldY >= topLeft.y && worldY <= bottomRight.y
      ) {
        this.selectedIds.add(entity.id);
      }
    }
  }

  // ─── Command Issuance ─────────────────────────────────────────

  private issueCommand(screenX: number, screenY: number): void {
    if (!this.currentState) return;

    const worldPos = this.camera.screenToWorld(screenX, screenY);
    const tileX = worldPos.x / TILE_SIZE;
    const tileY = worldPos.y / TILE_SIZE;
    const unitIds = Array.from(this.selectedIds);

    // Check if right-clicked on a gold mine → gather
    for (const mine of this.currentState.goldMines) {
      if (
        tileX >= mine.x && tileX < mine.x + GOLD_MINE_TILE_WIDTH &&
        tileY >= mine.y && tileY < mine.y + GOLD_MINE_TILE_HEIGHT
      ) {
        const workerIds = unitIds.filter((id) => {
          const e = this.currentState!.entities[id];
          return e && e.type === 'worker' && e.ownerId === this.playerId;
        });
        if (workerIds.length > 0) {
          this.socket.emit('gatherResource', { workerIds, mineId: mine.id });
          return;
        }
      }
    }

    // Check if right-clicked on own depot/homeBase with gold-carrying worker → deposit
    for (const entity of Object.values(this.currentState.entities)) {
      if (entity.ownerId !== this.playerId) continue;
      if (entity.type !== 'homeBase' && entity.type !== 'resourceDepot') continue;
      if (entity.hp <= 0) continue;

      let dist: number;
      if (entity.tileWidth && entity.tileHeight) {
        const cx = Math.max(entity.x, Math.min(entity.x + entity.tileWidth, tileX));
        const cy = Math.max(entity.y, Math.min(entity.y + entity.tileHeight, tileY));
        dist = Math.sqrt(Math.pow(tileX - cx, 2) + Math.pow(tileY - cy, 2));
      } else {
        dist = 99;
      }

      if (dist < 1.5) {
        const goldWorkers = unitIds.filter((id) => {
          const e = this.currentState!.entities[id];
          return e && e.type === 'worker' && e.ownerId === this.playerId && e.carriedGold && e.carriedGold > 0;
        });
        if (goldWorkers.length > 0) {
          this.socket.emit('depositGold', { workerIds: goldWorkers, depotId: entity.id });
          return;
        }
      }
    }

    // Check if right-clicked on an enemy entity → attack
    // Use edge-distance for buildings so clicks anywhere on/near the footprint register.
    for (const entity of Object.values(this.currentState.entities)) {
      if (entity.ownerId === this.playerId) continue;

      let dist: number;
      if (entity.tileWidth && entity.tileHeight) {
        // Building: distance from click to nearest edge of footprint
        const cx = Math.max(entity.x, Math.min(entity.x + entity.tileWidth, tileX));
        const cy = Math.max(entity.y, Math.min(entity.y + entity.tileHeight, tileY));
        dist = Math.sqrt(Math.pow(tileX - cx, 2) + Math.pow(tileY - cy, 2));
      } else {
        // Unit: distance from click to unit center
        const ex = entity.x + 0.5;
        const ey = entity.y + 0.5;
        dist = Math.sqrt(Math.pow(tileX - ex, 2) + Math.pow(tileY - ey, 2));
      }

      if (dist < 1.5) {
        const combatUnits = unitIds.filter((id) => {
          const e = this.currentState!.entities[id];
          return e && (e.type === 'infantry' || e.type === 'archer' || e.type === 'cavalry' || e.type === 'ballista') && e.ownerId === this.playerId;
        });
        if (combatUnits.length > 0) {
          this.socket.emit('attackTarget', { unitIds: combatUnits, targetId: entity.id });
          return;
        }
      }
    }

    // Default: move command
    const ownUnits = unitIds.filter((id) => {
      const e = this.currentState!.entities[id];
      return e && (e.type === 'worker' || e.type === 'infantry' || e.type === 'archer' || e.type === 'cavalry' || e.type === 'ballista') && e.ownerId === this.playerId;
    });
    if (ownUnits.length > 0) {
      this.socket.emit('moveUnits', {
        unitIds: ownUnits,
        targetX: Math.floor(tileX),
        targetY: Math.floor(tileY),
      });
    }
  }

  // ─── Build Mode ───────────────────────────────────────────────

  private enterBuildMode(buildingType: BuildingType): void {
    const dims = getBuildingDimensions(buildingType);
    this.buildMode = { type: buildingType, ...dims };
  }

  private placeBuilding(): void {
    if (!this.buildMode || !this.buildGhostPos) return;

    // Check placement validity and show specific error
    const reason = this.getPlacementError(
      this.buildGhostPos.x, this.buildGhostPos.y,
      this.buildMode.w, this.buildMode.h
    );
    if (reason) {
      this.errorToast?.show(reason);
      return; // Don't exit build mode — let them try another spot
    }

    // Find a selected worker
    const workerId = Array.from(this.selectedIds).find((id) => {
      const e = this.currentState?.entities[id];
      return e && e.type === 'worker' && e.ownerId === this.playerId;
    });

    if (workerId) {
      this.socket.emit('buildStructure', {
        workerId,
        buildingType: this.buildMode.type,
        x: this.buildGhostPos.x,
        y: this.buildGhostPos.y,
      });
    }

    this.buildMode = null;
    this.buildGhostPos = null;
    this.buildGhostValid = true;
  }

  private trainUnit(buildingId: string, unitType: EntityType): void {
    this.socket.emit('trainUnit', { buildingId, unitType });
  }

  private upgradeUnit(armoryId: string, unitType: 'infantry' | 'archer' | 'cavalry'): void {
    this.socket.emit('upgradeUnit', { armoryId, unitType });
  }

  // ─── Placement Validation (client-side preview) ─────────────────

  /**
   * Returns true if every tile in the footprint is a walkable grass tile with
   * no buildings or gold mines on it. Used for the ghost color.
   */
  private checkPlacementValid(tx: number, ty: number, tw: number, th: number): boolean {
    return this.getPlacementError(tx, ty, tw, th) === null;
  }

  /**
   * Returns a human-readable reason if placement is invalid, or null if valid.
   */
  private getPlacementError(tx: number, ty: number, tw: number, th: number): string | null {
    const state = this.currentState;
    if (!state) return 'No game state';

    // Bounds check
    if (tx < 0 || ty < 0 || tx + tw > state.mapWidth || ty + th > state.mapHeight) {
      return 'Out of map bounds!';
    }

    // Check each tile in the footprint
    for (let dy = 0; dy < th; dy++) {
      for (let dx = 0; dx < tw; dx++) {
        const tileType = state.tiles[ty + dy]?.[tx + dx];
        if (!tileType) return 'Out of map bounds!';
        if (tileType === 'rock') return "Can't build on rocks!";
        if (tileType === 'water') return "Can't build on water!";
        if (tileType === 'trees') return "Can't build on trees!";
      }
    }

    // Check overlap with existing buildings
    for (const entity of Object.values(state.entities)) {
      if (!entity.tileWidth || !entity.tileHeight) continue;
      if (entity.hp <= 0) continue;

      const ex = entity.x;
      const ey = entity.y;
      const ew = entity.tileWidth;
      const eh = entity.tileHeight;

      // AABB overlap check
      if (tx < ex + ew && tx + tw > ex && ty < ey + eh && ty + th > ey) {
        return 'Blocked by another building!';
      }
    }

    // Check overlap with gold mines
    for (const mine of state.goldMines) {
      const mx = mine.x;
      const my = mine.y;
      const mw = GOLD_MINE_TILE_WIDTH;
      const mh = GOLD_MINE_TILE_HEIGHT;

      if (tx < mx + mw && tx + tw > mx && ty < my + mh && ty + th > my) {
        return "Can't build on a gold mine!";
      }
    }

    return null; // Valid
  }
}

/** Returns tile dimensions for a building type. */
function getBuildingDimensions(type: BuildingType): { w: number; h: number } {
  switch (type) {
    case 'house': return { w: HOUSE_TILE_WIDTH, h: HOUSE_TILE_HEIGHT };
    case 'barracks': return { w: BARRACKS_TILE_WIDTH, h: BARRACKS_TILE_HEIGHT };
    case 'resourceDepot': return { w: RESOURCE_DEPOT_TILE_WIDTH, h: RESOURCE_DEPOT_TILE_HEIGHT };
    case 'tower': return { w: TOWER_TILE_WIDTH, h: TOWER_TILE_HEIGHT };
    case 'armory': return { w: ARMORY_TILE_WIDTH, h: ARMORY_TILE_HEIGHT };
  }
}

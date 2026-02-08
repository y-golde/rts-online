/**
 * @file HUD.ts
 * @description Draws the overlay UI: top resource bar, bottom action panel for
 * selected entities. All drawn directly to the game canvas.
 *
 * @see Renderer.ts for the main render pipeline
 * @see constants.ts for ENTITY_VISUALS
 */

import type { GameState, Entity, EntityType, BuildingType } from '@rts/shared';
import {
  ENTITY_VISUALS,
  WORKER_COST, WORKER_SUPPLY,
  INFANTRY_COST, INFANTRY_SUPPLY,
  ARCHER_COST, ARCHER_SUPPLY,
  CAVALRY_COST, CAVALRY_SUPPLY,
  BALLISTA_COST, BALLISTA_SUPPLY,
  HOUSE_COST, HOUSE_MAX_PER_PLAYER,
  BARRACKS_COST,
  RESOURCE_DEPOT_COST,
  TOWER_COST,
  ARMORY_COST,
  getUpgradeCost,
} from '@rts/shared';

/** An action button displayed in the HUD. */
export interface HUDAction {
  label: string;
  emoji: string;
  cost: number;
  key: string; // keyboard shortcut
  action: () => void;
}

/**
 * Draws the HUD overlay (resource bar + action panel) on top of the game canvas.
 */
export class HUD {
  private ctx: CanvasRenderingContext2D;
  private actions: HUDAction[] = [];
  /** Screen rectangles of action buttons for click detection. */
  private actionRects: Array<{ x: number; y: number; w: number; h: number; action: HUDAction }> = [];
  /** Current bottom panel height (for minimap positioning). */
  private bottomPanelHeight = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** Returns the current bottom panel height in pixels. */
  getBottomPanelHeight(): number {
    return this.bottomPanelHeight;
  }

  /**
   * Sets the available actions for the currently selected entity/entities.
   */
  setActions(actions: HUDAction[]): void {
    this.actions = actions;
  }

  /**
   * Checks if a click at screen coordinates hits an action button.
   * Returns the action if hit, null otherwise.
   */
  handleClick(screenX: number, screenY: number): HUDAction | null {
    for (const rect of this.actionRects) {
      if (
        screenX >= rect.x && screenX <= rect.x + rect.w &&
        screenY >= rect.y && screenY <= rect.y + rect.h
      ) {
        return rect.action;
      }
    }
    return null;
  }

  /**
   * Handles keyboard shortcut for actions.
   */
  handleKey(key: string): HUDAction | null {
    const action = this.actions.find((a) => a.key.toLowerCase() === key.toLowerCase());
    return action ?? null;
  }

  /**
   * Renders the HUD overlay.
   */
  /** Current player gold — set during render for button styling. */
  private playerGold = 0;

  render(state: GameState, playerId: string, selectedEntities: Entity[]): void {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const player = state.players[playerId];
    if (!player) return;
    this.playerGold = player.gold;

    // ─── Top Resource Bar ──────────────────────────────────────────
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, w, 36);

    ctx.font = '14px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // Gold
    ctx.fillStyle = '#f1c40f';
    ctx.fillText(`Gold: ${player.gold}`, 16, 18);

    // Supply
    ctx.fillStyle = player.supply >= player.maxSupply ? '#e74c3c' : '#2ecc71';
    ctx.fillText(`Supply: ${player.supply} / ${player.maxSupply}`, 160, 18);

    // Player identity (name + colored dot)
    const nameLabel = `● ${player.name}`;
    ctx.font = 'bold 14px sans-serif';
    const nameWidth = ctx.measureText(nameLabel).width;
    const nameX = w / 2 - nameWidth / 2;
    ctx.fillStyle = player.color;
    ctx.fillText(nameLabel, nameX, 18);
    ctx.font = '14px sans-serif';

    // Tick
    ctx.fillStyle = '#667';
    ctx.fillText(`Tick: ${state.tick}`, w - 120, 18);

    // ─── Bottom Action Panel ───────────────────────────────────────
    if (selectedEntities.length === 0 || this.actions.length === 0) {
      this.actionRects = [];
      this.bottomPanelHeight = 0;
      return;
    }

    // Responsive panel height - ensure it fits on screen
    // Reserve space: top bar (36px) + minimap (~120px) + padding
    const availableHeight = this.canvas.height - 36; // Top bar
    const minPanelHeight = 50;
    const maxPanelHeight = Math.min(80, availableHeight * 0.25);
    const panelHeight = Math.max(minPanelHeight, Math.min(maxPanelHeight, this.canvas.height * 0.12));
    const panelY = Math.max(36, this.canvas.height - panelHeight); // Don't overlap top bar
    
    // Store for minimap positioning
    this.bottomPanelHeight = panelHeight;
    
    // Ensure panel doesn't exceed canvas bounds
    if (panelY + panelHeight > this.canvas.height) {
      this.bottomPanelHeight = 0;
      return; // Skip rendering if it would be clipped
    }
    
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, panelY, w, panelHeight);

    // Selected entity info
    const first = selectedEntities[0];
    const visual = ENTITY_VISUALS[first.type];
    ctx.fillStyle = '#eee';
    
    // Responsive font size
    const fontSize = Math.min(13, Math.max(11, this.canvas.height * 0.018));
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'left';
    
    const infoText = `${visual?.emoji ?? ''} ${visual?.label ?? first.type} (x${selectedEntities.length}) — HP: ${first.hp}/${first.maxHp}`;
    ctx.fillText(infoText, 16, panelY + fontSize + 4);

    // Action buttons - responsive sizing
    this.actionRects = [];
    const btnW = Math.min(100, Math.max(80, w / Math.max(this.actions.length, 4)));
    const btnH = Math.min(30, Math.max(24, panelHeight * 0.4));
    const btnY = panelY + fontSize + 16;
    const startX = 16;
    const btnGap = 8;

    // Limit number of visible buttons to prevent overflow
    const maxButtons = Math.floor((w - startX * 2) / (btnW + btnGap));
    const visibleActions = this.actions.slice(0, maxButtons);
    const btnFontSize = Math.min(12, Math.max(10, fontSize * 0.9));
    const costFontSize = Math.min(10, Math.max(8, fontSize * 0.75));
    
    for (let i = 0; i < visibleActions.length; i++) {
      const act = visibleActions[i];
      const btnX = startX + i * (btnW + btnGap);
      
      // Check if button would overflow
      if (btnX + btnW > w - 16) break;

      const canAfford = this.playerGold >= act.cost;
      ctx.fillStyle = canAfford ? 'rgba(255,255,255,0.1)' : 'rgba(255,80,80,0.08)';
      ctx.fillRect(btnX, btnY, btnW, btnH);
      ctx.strokeStyle = canAfford ? 'rgba(255,255,255,0.2)' : 'rgba(255,80,80,0.25)';
      ctx.strokeRect(btnX, btnY, btnW, btnH);
      
      ctx.globalAlpha = canAfford ? 1 : 0.45;
      ctx.fillStyle = canAfford ? '#eee' : '#999';
      ctx.font = `${btnFontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${act.emoji} ${act.label}`, btnX + btnW / 2, btnY + btnH * 0.35);
      ctx.fillStyle = canAfford ? '#f1c40f' : '#c0392b';
      ctx.font = `${costFontSize}px sans-serif`;
      ctx.fillText(`${act.cost}g [${act.key.toUpperCase()}]`, btnX + btnW / 2, btnY + btnH * 0.75);
      ctx.globalAlpha = 1;

      this.actionRects.push({ x: btnX, y: btnY, w: btnW, h: btnH, action: act });
    }
    
    // Show indicator if more actions are available
    if (this.actions.length > maxButtons) {
      ctx.fillStyle = '#888';
      ctx.font = `${costFontSize}px sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(`+${this.actions.length - maxButtons} more`, w - 16, btnY + btnH / 2);
    }
  }
}

/**
 * Returns the supply cost for a trainable unit type.
 */
function getUnitSupplyCost(unitType: EntityType): number {
  switch (unitType) {
    case 'worker': return WORKER_SUPPLY;
    case 'infantry': return INFANTRY_SUPPLY;
    case 'archer': return ARCHER_SUPPLY;
    case 'cavalry': return CAVALRY_SUPPLY;
    case 'ballista': return BALLISTA_SUPPLY;
    default: return 0;
  }
}

/**
 * Returns the gold cost for a building type.
 */
function getBuildingCost(type: BuildingType): number {
  switch (type) {
    case 'house': return HOUSE_COST;
    case 'barracks': return BARRACKS_COST;
    case 'resourceDepot': return RESOURCE_DEPOT_COST;
    case 'tower': return TOWER_COST;
    case 'armory': return ARMORY_COST;
  }
}

/**
 * Builds the list of available actions based on selected entities.
 * Actions include client-side validation — if the player can't afford
 * something or is supply-capped, clicking the button shows an error
 * toast instead of sending the command.
 */
export function getActionsForSelection(
  selectedEntities: Entity[],
  playerId: string,
  state: GameState,
  onTrain: (buildingId: string, unitType: EntityType) => void,
  onBuild: (buildingType: BuildingType) => void,
  onUpgrade: (armoryId: string, unitType: 'infantry' | 'archer' | 'cavalry') => void,
  showError: (msg: string) => void
): HUDAction[] {
  if (selectedEntities.length === 0) return [];

  const first = selectedEntities[0];
  if (first.ownerId !== playerId) return []; // Can't command enemy entities

  const player = state.players[playerId];
  if (!player) return [];

  const actions: HUDAction[] = [];

  /** Wraps a train action with gold + supply validation. */
  const guardedTrain = (buildingId: string, unitType: EntityType, cost: number) => {
    const supply = getUnitSupplyCost(unitType);
    if (player.gold < cost) {
      showError(`Not enough gold! Need ${cost}g (have ${player.gold}g)`);
      return;
    }
    if (player.supply + supply > player.maxSupply) {
      showError(`Not enough supply! Need ${supply} (${player.supply}/${player.maxSupply}) — build more houses`);
      return;
    }
    onTrain(buildingId, unitType);
  };

  /** Wraps a build action with gold validation. */
  const guardedBuild = (buildingType: BuildingType) => {
    const cost = getBuildingCost(buildingType);
    if (player.gold < cost) {
      showError(`Not enough gold! Need ${cost}g (have ${player.gold}g)`);
      return;
    }
    // Check house limit
    if (buildingType === 'house') {
      const houseCount = Object.values(state.entities).filter(
        (e) => e.type === 'house' && e.ownerId === playerId
      ).length;
      if (houseCount >= HOUSE_MAX_PER_PLAYER) {
        showError(`House limit reached! (${HOUSE_MAX_PER_PLAYER} max)`);
        return;
      }
    }
    onBuild(buildingType);
  };

  if (first.type === 'homeBase') {
    actions.push({
      label: 'Worker',
      emoji: '👷',
      cost: WORKER_COST,
      key: 'q',
      action: () => guardedTrain(first.id, 'worker', WORKER_COST),
    });
  }

  if (first.type === 'barracks') {
    actions.push(
      {
        label: 'Infantry',
        emoji: '⚔️',
        cost: INFANTRY_COST,
        key: 'q',
        action: () => guardedTrain(first.id, 'infantry', INFANTRY_COST),
      },
      {
        label: 'Archer',
        emoji: '🏹',
        cost: ARCHER_COST,
        key: 'w',
        action: () => guardedTrain(first.id, 'archer', ARCHER_COST),
      },
      {
        label: 'Cavalry',
        emoji: '🐴',
        cost: CAVALRY_COST,
        key: 'e',
        action: () => guardedTrain(first.id, 'cavalry', CAVALRY_COST),
      },
      {
        label: 'Ballista',
        emoji: '🎯',
        cost: BALLISTA_COST,
        key: 'r',
        action: () => guardedTrain(first.id, 'ballista', BALLISTA_COST),
      },
    );
  }

  if (first.type === 'worker') {
    actions.push(
      {
        label: 'House',
        emoji: '🏠',
        cost: HOUSE_COST,
        key: 'q',
        action: () => guardedBuild('house'),
      },
      {
        label: 'Barracks',
        emoji: '🛡️',
        cost: BARRACKS_COST,
        key: 'w',
        action: () => guardedBuild('barracks'),
      },
      {
        label: 'Depot',
        emoji: '📦',
        cost: RESOURCE_DEPOT_COST,
        key: 'e',
        action: () => guardedBuild('resourceDepot'),
      },
      {
        label: 'Tower',
        emoji: '🗼',
        cost: TOWER_COST,
        key: 'r',
        action: () => guardedBuild('tower'),
      },
      {
        label: 'Armory',
        emoji: '🔨',
        cost: ARMORY_COST,
        key: 't',
        action: () => guardedBuild('armory'),
      }
    );
  }

  // Armory: show upgrade buttons for each combat unit type
  if (first.type === 'armory' && (first.buildProgress === undefined || first.buildProgress >= 1)) {
    const upgrades = player.upgrades ?? { infantry: 0, archer: 0, cavalry: 0 };

    const makeUpgradeAction = (
      unitType: 'infantry' | 'archer' | 'cavalry',
      label: string,
      emoji: string,
      key: string
    ): HUDAction => {
      const level = upgrades[unitType];
      const cost = getUpgradeCost(level);
      return {
        label: `${label} Lv${level + 1}`,
        emoji,
        cost,
        key,
        action: () => {
          if (player.gold < cost) {
            showError(`Not enough gold! Need ${cost}g (have ${player.gold}g)`);
            return;
          }
          onUpgrade(first.id, unitType);
        },
      };
    };

    actions.push(
      makeUpgradeAction('infantry', 'Infantry', '⚔️', 'q'),
      makeUpgradeAction('archer', 'Archer', '🏹', 'w'),
      makeUpgradeAction('cavalry', 'Cavalry', '🐴', 'e'),
    );
  }

  return actions;
}

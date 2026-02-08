/**
 * @file ErrorToast.ts
 * @description Lightweight on-screen error/notification system drawn directly
 * onto the game canvas. Messages auto-fade after a short duration.
 *
 * Usage:
 *   ErrorToast.show('Not enough gold!');
 *   // In the render loop:
 *   errorToast.render(ctx, canvasWidth);
 */

interface Toast {
  message: string;
  /** Timestamp (ms) when the toast was created. */
  createdAt: number;
  /** Duration in ms before the toast fades. */
  duration: number;
}

const DEFAULT_DURATION = 2000; // 2 seconds

/**
 * Manages and renders temporary on-screen error/notification messages.
 * Draws directly to the Canvas2D context.
 */
export class ErrorToast {
  private toasts: Toast[] = [];

  /** Show a new error message. Deduplicates rapid identical messages. */
  show(message: string, duration = DEFAULT_DURATION): void {
    const now = performance.now();

    // Deduplicate: skip if the same message was shown within the last 500ms
    const recent = this.toasts.find(
      (t) => t.message === message && now - t.createdAt < 500
    );
    if (recent) return;

    this.toasts.push({ message, createdAt: now, duration });

    // Cap at 5 visible toasts
    if (this.toasts.length > 5) {
      this.toasts.shift();
    }
  }

  /**
   * Renders all active toasts. Call once per frame after all other rendering.
   * Draws at the top-center of the canvas, below the resource bar.
   */
  render(ctx: CanvasRenderingContext2D, canvasWidth: number): void {
    const now = performance.now();

    // Prune expired toasts
    this.toasts = this.toasts.filter((t) => now - t.createdAt < t.duration);

    if (this.toasts.length === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const startY = 52; // Below the top resource bar (36px + padding)

    for (let i = 0; i < this.toasts.length; i++) {
      const toast = this.toasts[i];
      const age = now - toast.createdAt;
      const fadeStart = toast.duration * 0.7; // Start fading at 70% of duration
      const alpha = age > fadeStart
        ? 1 - (age - fadeStart) / (toast.duration - fadeStart)
        : 1;

      const y = startY + i * 28;

      // Background pill
      ctx.font = 'bold 13px sans-serif';
      const textWidth = ctx.measureText(toast.message).width;
      const pillW = textWidth + 24;
      const pillH = 22;
      const pillX = canvasWidth / 2 - pillW / 2;

      ctx.globalAlpha = alpha * 0.85;
      ctx.fillStyle = '#c0392b'; // Red background
      ctx.beginPath();
      // Rounded rect
      const r = 6;
      ctx.moveTo(pillX + r, y - pillH / 2);
      ctx.lineTo(pillX + pillW - r, y - pillH / 2);
      ctx.quadraticCurveTo(pillX + pillW, y - pillH / 2, pillX + pillW, y - pillH / 2 + r);
      ctx.lineTo(pillX + pillW, y + pillH / 2 - r);
      ctx.quadraticCurveTo(pillX + pillW, y + pillH / 2, pillX + pillW - r, y + pillH / 2);
      ctx.lineTo(pillX + r, y + pillH / 2);
      ctx.quadraticCurveTo(pillX, y + pillH / 2, pillX, y + pillH / 2 - r);
      ctx.lineTo(pillX, y - pillH / 2 + r);
      ctx.quadraticCurveTo(pillX, y - pillH / 2, pillX + r, y - pillH / 2);
      ctx.closePath();
      ctx.fill();

      // Text
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#fff';
      ctx.fillText(toast.message, canvasWidth / 2, y);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

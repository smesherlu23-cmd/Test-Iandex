import { TUNING } from '../data/tuning';
import type { BattleState } from '../sim/Battle';
import { SHARD_VOLLEY_SHAPE } from '../sim/Boss';

const COLORS = {
  page: '#07070c',
  arena: '#12121c',
  arenaEdge: '#262636',
  cover: '#333349',
  boss: '#6b3fa0',
  bossVulnerable: '#9c6ad6',
  hero: '#4fd1c5',
  heroDead: '#4a4a58',
  projectile: '#ff9f43',
  /** ТЗ §10: телеграф всегда один и тот же красный, без палитры по типам. */
  telegraph: '224, 49, 49',
  active: '255, 138, 128',
  hud: '#8a8aa0',
  hudStrong: '#e8e8f2',
} as const;

/**
 * Рендер читает снимок состояния и ничего в нём не меняет.
 * Арена вписывается в экран целиком с сохранением пропорций 16×24.
 */
export class BattleView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private cssW = 0;
  private cssH = 0;
  private scale = 1;
  private ox = 0;
  private oy = 0;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D недоступен');
    this.canvas = canvas;
    this.ctx = ctx;
    this.resize();

    new ResizeObserver(() => this.resize()).observe(canvas);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => this.resize());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pw = Math.max(1, Math.round(w * dpr));
    const ph = Math.max(1, Math.round(h * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }

    this.cssW = w;
    this.cssH = h;
    // Сброс размера обнуляет состояние контекста, поэтому трансформ ставим здесь.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.scale = Math.min(w / TUNING.ARENA.w, h / TUNING.ARENA.h);
    this.ox = (w - TUNING.ARENA.w * this.scale) / 2;
    this.oy = (h - TUNING.ARENA.h * this.scale) / 2;
  }

  draw(state: BattleState, fps: number): void {
    const c = this.ctx;
    c.fillStyle = COLORS.page;
    c.fillRect(0, 0, this.cssW, this.cssH);

    this.drawArena();
    this.drawCovers(state);
    this.drawTelegraph(state);
    this.drawProjectiles(state);
    this.drawBoss(state);
    this.drawHero(state);
    this.drawHud(state, fps);
  }

  private sx(x: number): number {
    return this.ox + x * this.scale;
  }

  private sy(y: number): number {
    return this.oy + y * this.scale;
  }

  private drawArena(): void {
    const c = this.ctx;
    const x = this.sx(0);
    const y = this.sy(0);
    const w = TUNING.ARENA.w * this.scale;
    const h = TUNING.ARENA.h * this.scale;
    c.fillStyle = COLORS.arena;
    c.fillRect(x, y, w, h);
    c.strokeStyle = COLORS.arenaEdge;
    c.lineWidth = 2;
    c.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  private drawCovers(state: BattleState): void {
    const c = this.ctx;
    c.fillStyle = COLORS.cover;
    for (const cover of state.covers) {
      c.fillRect(this.sx(cover.x), this.sy(cover.y), cover.w * this.scale, cover.h * this.scale);
    }
  }

  /** Заливка будущей зоны поражения с растущей непрозрачностью (ТЗ §10). */
  private drawTelegraph(state: BattleState): void {
    const boss = state.boss;
    if (boss.phase !== 'telegraph' && boss.phase !== 'active') return;

    const shape = SHARD_VOLLEY_SHAPE;
    const telegraphing = boss.phase === 'telegraph';
    const rgb = telegraphing ? COLORS.telegraph : COLORS.active;
    const alpha = telegraphing ? 0.06 + boss.phaseProgress * 0.26 : 0.45;

    const c = this.ctx;
    c.fillStyle = `rgba(${rgb}, ${alpha})`;
    c.beginPath();
    c.moveTo(this.sx(boss.x), this.sy(boss.y));
    c.arc(
      this.sx(boss.x),
      this.sy(boss.y),
      shape.range * this.scale,
      boss.aim - shape.spread / 2,
      boss.aim + shape.spread / 2,
    );
    c.closePath();
    c.fill();
  }

  private drawProjectiles(state: BattleState): void {
    const c = this.ctx;
    c.fillStyle = COLORS.projectile;
    for (const p of state.projectiles) {
      c.beginPath();
      c.arc(this.sx(p.x), this.sy(p.y), p.r * this.scale, 0, Math.PI * 2);
      c.fill();
    }
  }

  private drawBoss(state: BattleState): void {
    const c = this.ctx;
    const boss = state.boss;
    c.fillStyle = boss.vulnerable ? COLORS.bossVulnerable : COLORS.boss;
    c.beginPath();
    c.arc(this.sx(boss.x), this.sy(boss.y), boss.r * this.scale, 0, Math.PI * 2);
    c.fill();
  }

  private drawHero(state: BattleState): void {
    const c = this.ctx;
    const hero = state.hero;
    c.fillStyle = hero.alive ? COLORS.hero : COLORS.heroDead;
    c.beginPath();
    c.arc(this.sx(hero.x), this.sy(hero.y), hero.r * this.scale, 0, Math.PI * 2);
    c.fill();

    if (!hero.alive) return;

    // Полоска здоровья над героем, а не в углу экрана (ТЗ §10).
    const barW = 1.6 * this.scale;
    const barH = 0.22 * this.scale;
    const barX = this.sx(hero.x) - barW / 2;
    const barY = this.sy(hero.y - hero.r) - barH * 2;
    const ratio = hero.maxHp > 0 ? Math.max(0, hero.hp / hero.maxHp) : 0;
    c.fillStyle = 'rgba(0, 0, 0, 0.55)';
    c.fillRect(barX, barY, barW, barH);
    c.fillStyle = ratio > 0.4 ? '#4fd1c5' : ratio > 0.2 ? '#ffd166' : '#ef476f';
    c.fillRect(barX, barY, barW * ratio, barH);
  }

  private drawHud(state: BattleState, fps: number): void {
    const c = this.ctx;
    const pad = 10;
    c.textAlign = 'left';
    c.textBaseline = 'top';
    c.font = '600 13px ui-monospace, Menlo, Consolas, monospace';

    c.fillStyle = COLORS.hudStrong;
    c.fillText(`FPS ${fps.toFixed(0)}`, pad, pad);
    c.fillStyle = COLORS.hud;
    c.fillText(`t ${state.time.toFixed(1)}s`, pad, pad + 16);
    c.fillText(`слот ${state.boss.slot + 1}/${TUNING.TIMELINE_SLOTS}`, pad, pad + 32);
    c.fillText(`энергия ${state.boss.energy}`, pad, pad + 48);
    c.fillText(`hp ${Math.ceil(state.hero.hp)}`, pad, pad + 64);

    if (!state.finished) return;

    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = COLORS.hudStrong;
    c.font = '700 24px system-ui, -apple-system, sans-serif';
    const title = state.outcome === 'boss_win' ? 'ГЕРОЙ ПОГИБ' : 'ГЕРОЙ ВЫЖИЛ';
    c.fillText(title, this.cssW / 2, this.cssH / 2 - 14);
    c.fillStyle = COLORS.hud;
    c.font = '500 14px system-ui, -apple-system, sans-serif';
    c.fillText('тап — следующий сид', this.cssW / 2, this.cssH / 2 + 16);
  }
}

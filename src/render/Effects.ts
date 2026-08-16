import { FX } from '../data/tuning';
import type { BattleEvent } from '../sim/events';
import { Rng } from '../sim/Rng';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  size: number;
  color: string;
}

interface Label {
  text: string;
  x: number;
  y: number;
  life: number;
}

interface Flash {
  x: number;
  y: number;
  r: number;
  life: number;
}

/** Приоритет подписи: когда за тик случилось многое, показываем главное. */
const LABEL_RANK: Readonly<Record<string, number>> = {
  'второе дыхание': 5,
  парировал: 4,
  зелье: 3,
  блок: 2,
  уклонился: 1,
};

/**
 * Слой подачи: частицы, вспышки, тряска и всплывающие подписи. Читает лог
 * событий боя и ничего в нём не меняет.
 */
export class Effects {
  private readonly particles: Particle[] = [];
  private readonly labels: Label[] = [];
  private readonly flashes: Flash[] = [];
  /** Своё зерно вместо Math.random: одинаковый бой выглядит одинаково. */
  private readonly rng = new Rng(0x5eed);

  private shakeValue = 0;
  private sinceLabel: number = FX.LABEL_INTERVAL;
  private pending: { text: string; x: number; y: number; rank: number } | null = null;

  get shake(): number {
    return this.shakeValue;
  }

  clear(): void {
    this.particles.length = 0;
    this.labels.length = 0;
    this.flashes.length = 0;
    this.shakeValue = 0;
    this.pending = null;
    this.sinceLabel = FX.LABEL_INTERVAL;
  }

  /**
   * Разобрать свежие события боя. Позиции берутся из состояния: события несут
   * не всё, а подпись должна всплыть над героем.
   */
  consume(events: readonly BattleEvent[], heroX: number, heroY: number): void {
    for (const e of events) {
      switch (e.type) {
        case 'hero_hit':
          this.burst(heroX, heroY, 7, '#ef476f');
          this.shakeValue = Math.min(FX.SHAKE_MAX, this.shakeValue + 0.12);
          break;

        case 'hero_parry':
          this.queueLabel('парировал', heroX, heroY);
          this.burst(heroX, heroY, 10, '#ffd166');
          break;

        case 'hero_block':
          this.queueLabel('блок', heroX, heroY);
          this.burst(heroX, heroY, 5, '#8ecae6');
          break;

        case 'hero_potion':
          this.queueLabel('зелье', heroX, heroY);
          this.burst(heroX, heroY, 8, '#4fd1c5');
          break;

        case 'hero_second_wind':
          this.queueLabel('второе дыхание', heroX, heroY);
          this.burst(heroX, heroY, 14, '#ffd166');
          break;

        case 'hero_dodge_dash':
          this.queueLabel('уклонился', heroX, heroY);
          break;

        case 'hero_died':
          this.burst(e.x, e.y, 26, '#ef476f');
          this.flashes.push({ x: e.x, y: e.y, r: 1, life: FX.FLASH_LIFE * 4 });
          this.shakeValue = FX.SHAKE_MAX;
          break;

        case 'projectile_blocked':
          this.shakeValue = Math.min(FX.SHAKE_MAX, this.shakeValue + 0.02);
          break;

        case 'pattern_start':
          // Резкая вспышка на переходе телеграфа в удар (ТЗ §10).
          this.flashes.push({ x: 8, y: 4.5, r: 2, life: FX.FLASH_LIFE });
          this.shakeValue = Math.min(FX.SHAKE_MAX, this.shakeValue + 0.06);
          break;

        case 'cover_destroyed':
          this.shakeValue = Math.min(FX.SHAKE_MAX, this.shakeValue + 0.2);
          break;

        default:
          break;
      }
    }
  }

  update(dt: number): void {
    this.shakeValue = Math.max(0, this.shakeValue - FX.SHAKE_DECAY * dt * this.shakeValue);
    this.sinceLabel += dt;

    // Подписи выпускаются по одной и не чаще четырёх в секунду (ТЗ §10).
    if (this.pending && this.sinceLabel >= FX.LABEL_INTERVAL) {
      this.labels.push({ text: this.pending.text, x: this.pending.x, y: this.pending.y, life: FX.LABEL_LIFE });
      this.pending = null;
      this.sinceLabel = 0;
    }

    compact(this.particles, (p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      return p.life > 0;
    });

    compact(this.labels, (l) => {
      l.life -= dt;
      l.y -= FX.LABEL_RISE * dt;
      return l.life > 0;
    });

    compact(this.flashes, (f) => {
      f.life -= dt;
      return f.life > 0;
    });
  }

  /** Рисование в координатах арены: проекция приходит от вида. */
  draw(
    ctx: CanvasRenderingContext2D,
    sx: (x: number) => number,
    sy: (y: number) => number,
    scale: number,
  ): void {
    for (const f of this.flashes) {
      const t = Math.max(0, f.life / (FX.FLASH_LIFE * 4));
      ctx.fillStyle = `rgba(255, 240, 220, ${0.35 * t})`;
      ctx.beginPath();
      ctx.arc(sx(f.x), sy(f.y), f.r * (2 - t) * scale, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const p of this.particles) {
      const t = Math.max(0, p.life / FX.PARTICLE_LIFE);
      ctx.globalAlpha = t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(sx(p.x), sy(p.y), p.size * t * scale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.labels.length === 0) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = '700 13px system-ui, -apple-system, sans-serif';
    for (const l of this.labels) {
      const t = Math.max(0, Math.min(1, l.life / FX.LABEL_LIFE));
      ctx.globalAlpha = t;
      ctx.fillStyle = '#e8e8f2';
      ctx.fillText(l.text, sx(l.x), sy(l.y) - 14 * scale * 0.06);
    }
    ctx.globalAlpha = 1;
  }

  /** Сколько подписей сейчас на экране — для тестов темпа. */
  get labelCount(): number {
    return this.labels.length;
  }

  private queueLabel(text: string, x: number, y: number): void {
    const rank = LABEL_RANK[text] ?? 0;
    if (this.pending && this.pending.rank >= rank) return;
    this.pending = { text, x, y, rank };
  }

  private burst(x: number, y: number, count: number, color: string): void {
    for (let i = 0; i < count; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const speed = this.rng.range(1.5, 6);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: FX.PARTICLE_LIFE * this.rng.range(0.6, 1),
        size: this.rng.range(0.06, 0.16),
        color,
      });
    }
  }
}

/** Обновить и выбросить отжившее, не создавая новых массивов. */
function compact<T>(arr: T[], step: (item: T) => boolean): void {
  let write = 0;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]!;
    if (step(item)) arr[write++] = item;
  }
  arr.length = write;
}

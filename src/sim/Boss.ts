import { TICK_RATE, TUNING } from '../data/tuning';
import type { Arena } from './Arena';
import { BOSS_ANCHOR } from './Arena';
import { clamp } from './Collision';
import type { BattleEventBody } from './events';
import type { ProjectileSpawn } from './Projectile';
import type { Rng } from './Rng';

export type PatternTag = 'aoe' | 'projectile' | 'melee' | 'zone' | 'summon' | 'trap';

/** Всё, что паттерн видит и может сделать. Детерминированный срез боя. */
export interface BattleCtx {
  readonly time: number;
  readonly rng: Rng;
  readonly arena: Arena;
  readonly boss: { readonly x: number; readonly y: number; readonly r: number; readonly aim: number };
  readonly hero: { readonly x: number; readonly y: number; readonly r: number; readonly alive: boolean };
  spawnProjectile(p: ProjectileSpawn): number;
  emit(e: BattleEventBody): void;
}

export interface PatternCard {
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  /** Сек. предупреждающей фазы: герой обязан иметь шанс среагировать. */
  readonly telegraph: number;
  /** Сек. активной фазы. */
  readonly duration: number;
  readonly tags: readonly PatternTag[];
  execute(ctx: BattleCtx): void;
}

/**
 * Геометрия единственного паттерна Этапа 1. Вынесена наружу, потому что
 * телеграф рисуется по этим же числам (render читает sim, не наоборот).
 */
export const SHARD_VOLLEY_SHAPE = {
  count: 8,
  spread: Math.PI / 2,
  speed: 9,
  radius: 0.35,
  damage: 12,
  life: 3,
  /** Дальность прорисовки телеграфа, ед. */
  range: 22,
} as const;

/** Захардкоженный паттерн Этапа 1: веер осколков, блокируется укрытиями. */
export const SHARD_VOLLEY: PatternCard = {
  id: 'shard_volley',
  name: 'Град осколков',
  cost: 3,
  telegraph: 0.8,
  duration: 0.3,
  tags: ['projectile'],
  execute(ctx: BattleCtx): void {
    const s = SHARD_VOLLEY_SHAPE;
    const step = s.count > 1 ? s.spread / (s.count - 1) : 0;
    const first = ctx.boss.aim - s.spread / 2;
    for (let i = 0; i < s.count; i++) {
      const a = first + step * i;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.spawnProjectile({
        x: ctx.boss.x + dx * (ctx.boss.r + s.radius),
        y: ctx.boss.y + dy * (ctx.boss.r + s.radius),
        vx: dx * s.speed,
        vy: dy * s.speed,
        r: s.radius,
        damage: s.damage,
        life: s.life,
        source: 'shard_volley',
      });
    }
  },
};

export type BossPhase = 'idle' | 'telegraph' | 'active' | 'recover';

/**
 * Босс не двигается свободно, а исполняет таймлайн: 8 слотов по 5 с.
 * Пустой слот (или нехватка энергии) — фаза восстановления: +5 энергии,
 * босс уязвим.
 */
export class Boss {
  readonly x = BOSS_ANCHOR.x;
  readonly y = BOSS_ANCHOR.y;
  readonly r = BOSS_ANCHOR.r;

  energy = TUNING.BOSS_ENERGY_START;
  phase: BossPhase = 'idle';
  /** Направление паттерна, зафиксированное в момент начала телеграфа. */
  aim = Math.PI / 2;
  slot = -1;
  card: PatternCard | null = null;
  vulnerable = false;

  private readonly timeline: readonly (PatternCard | null)[];
  /**
   * Возраст фазы в тиках, а не в секундах: накопление dt = 1/60 даёт
   * 48 * dt === 0.7999999999999999, и телеграф на 0.8 с срабатывал бы тиком позже.
   */
  private phaseTicks = 0;

  constructor(timeline: readonly (PatternCard | null)[]) {
    this.timeline = timeline;
  }

  /** Возраст текущей фазы в секундах. */
  get phaseTime(): number {
    return this.phaseTicks / TICK_RATE;
  }

  /** 0..1 внутри текущей фазы — для отрисовки телеграфа. */
  get phaseProgress(): number {
    const card = this.card;
    if (!card) return 0;
    if (this.phase === 'telegraph') {
      return card.telegraph > 0 ? clamp(this.phaseTime / card.telegraph, 0, 1) : 1;
    }
    if (this.phase === 'active') {
      return card.duration > 0 ? clamp(this.phaseTime / card.duration, 0, 1) : 1;
    }
    return 0;
  }

  update(ctx: BattleCtx): void {
    // Время фазы наращиваем до смены слота: на тике, где фаза началась,
    // её возраст обязан быть нулевым, иначе телеграф короче обещанного.
    this.phaseTicks++;

    const slot = Math.min(
      Math.floor(ctx.time / TUNING.SLOT_DURATION),
      this.timeline.length - 1,
    );
    if (slot !== this.slot) {
      this.slot = slot;
      this.beginSlot(slot, ctx);
    }

    const card = this.card;
    if (!card) return;

    const elapsed = this.phaseTime;
    if (this.phase === 'telegraph' && elapsed >= card.telegraph) {
      this.phase = 'active';
      this.phaseTicks = 0;
      ctx.emit({ type: 'pattern_start', slot: this.slot, card: card.id });
      card.execute(ctx);
    } else if (this.phase === 'active' && elapsed >= card.duration) {
      this.phase = 'idle';
      this.phaseTicks = 0;
      this.card = null;
      ctx.emit({ type: 'pattern_end', slot: this.slot, card: card.id });
    }
  }

  private beginSlot(slot: number, ctx: BattleCtx): void {
    const card = this.timeline[slot] ?? null;
    this.phaseTicks = 0;

    if (card && this.energy >= card.cost) {
      this.energy -= card.cost;
      this.card = card;
      this.phase = 'telegraph';
      this.vulnerable = false;
      // Прицел фиксируется здесь: за время телеграфа герой может уйти.
      this.aim = Math.atan2(ctx.hero.y - this.y, ctx.hero.x - this.x);
      ctx.emit({ type: 'slot_start', slot, card: card.id, energy: this.energy });
      ctx.emit({ type: 'telegraph', slot, card: card.id, duration: card.telegraph });
      return;
    }

    this.energy += TUNING.BOSS_ENERGY_REGEN;
    this.card = null;
    this.phase = 'recover';
    this.vulnerable = true;
    ctx.emit({ type: 'slot_start', slot, card: null, energy: this.energy });
  }
}

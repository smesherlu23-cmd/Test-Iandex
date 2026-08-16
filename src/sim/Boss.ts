import { TICK_RATE, TUNING } from '../data/tuning';
import type { Arena } from './Arena';
import { BOSS_ANCHOR } from './Arena';
import { clamp } from './Collision';
import type { BattleEventBody } from './events';
import type { HazardSpec } from './Hazard';
import type { ProjectileSpawn } from './Projectile';
import type { Rng } from './Rng';

export type PatternTag = 'aoe' | 'projectile' | 'melee' | 'zone' | 'summon' | 'trap';

/** Всё, что паттерн видит и может сделать. Детерминированный срез боя. */
export interface BattleCtx {
  readonly time: number;
  readonly rng: Rng;
  readonly arena: Arena;
  readonly boss: { readonly x: number; readonly y: number; readonly r: number; readonly aim: number };
  readonly hero: {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly vx: number;
    readonly vy: number;
    readonly alive: boolean;
  };
  spawnProjectile(p: ProjectileSpawn): number;
  addHazard(h: HazardSpec): number;
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
  /**
   * Начало телеграфа: паттерн объявляет свои будущие зоны. Это единственный
   * канал, через который герой узнаёт об атаке (ТЗ §6), и ровно то же самое
   * рисуется игроку.
   */
  prepare(ctx: BattleCtx): void;
  /**
   * Начало активной фазы: мгновенный эффект. Зонным паттернам он не нужен —
   * объявленная зона оживает сама по своему расписанию.
   */
  execute?(ctx: BattleCtx): void;
}

// --- Град осколков ---

export const SHARDS = {
  count: 8,
  spread: Math.PI / 2,
  speed: 9,
  radius: 0.35,
  damage: 12,
  life: 3,
  range: 24,
} as const;

/** Угол i-го осколка веера. Один и тот же расчёт для прогноза и для выстрела. */
function shardAngle(aim: number, i: number): number {
  const step = SHARDS.count > 1 ? SHARDS.spread / (SHARDS.count - 1) : 0;
  return aim - SHARDS.spread / 2 + step * i;
}

export const SHARD_VOLLEY: PatternCard = {
  id: 'shard_volley',
  name: 'Град осколков',
  cost: 3,
  telegraph: 0.8,
  duration: 0.3,
  tags: ['projectile'],

  prepare(ctx: BattleCtx): void {
    const fires = ctx.time + this.telegraph;
    for (let i = 0; i < SHARDS.count; i++) {
      ctx.addHazard({
        source: this.id,
        shape: {
          kind: 'ray',
          x: ctx.boss.x,
          y: ctx.boss.y,
          angle: shardAngle(ctx.boss.aim, i),
          length: SHARDS.range,
          // Ширина с запасом на габарит героя: прогноз должен совпасть с попаданием.
          width: (SHARDS.radius + ctx.hero.r) * 2,
        },
        // Предупреждение живёт ровно до залпа, дальше опасны сами осколки.
        activeFrom: fires,
        expiresAt: fires,
        impact: 0,
        dps: 0,
        danger: SHARDS.damage,
      });
    }
  },

  execute(ctx: BattleCtx): void {
    for (let i = 0; i < SHARDS.count; i++) {
      const a = shardAngle(ctx.boss.aim, i);
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      ctx.spawnProjectile({
        x: ctx.boss.x + dx * (ctx.boss.r + SHARDS.radius),
        y: ctx.boss.y + dy * (ctx.boss.r + SHARDS.radius),
        vx: dx * SHARDS.speed,
        vy: dy * SHARDS.speed,
        r: SHARDS.radius,
        damage: SHARDS.damage,
        life: SHARDS.life,
        source: 'shard_volley',
      });
    }
  },
};

// --- Зона отравления ---

/**
 * «Круг 4 ед.» из таблицы §8 прочитан как диаметр: радиус обязан быть таким,
 * чтобы герой успевал выйти за телеграф, иначе предупреждение декоративно.
 */
export const POISON = { radius: 2, dps: 9, linger: 6 } as const;

export const POISON_ZONE: PatternCard = {
  id: 'poison_zone',
  name: 'Зона отравления',
  cost: 3,
  telegraph: 0.9,
  duration: 0.4,
  tags: ['zone'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + this.telegraph;
    // Круг ложится туда, где герой стоит сейчас: за телеграф он успевает уйти,
    // но местность оказывается отравлена на 6 секунд.
    ctx.addHazard({
      source: this.id,
      shape: { kind: 'circle', x: ctx.hero.x, y: ctx.hero.y, r: POISON.radius },
      activeFrom: lands,
      expiresAt: lands + POISON.linger,
      impact: 0,
      dps: POISON.dps,
      // Ожидаемый урон за секунду, проведённую в облаке.
      danger: POISON.dps,
    });
  },
};

// --- Обвал ---

export const COLLAPSE = { radius: 1.7, impact: 18, linger: 0.4, spreadOffset: 2.4 } as const;

export const COLLAPSE_PATTERN: PatternCard = {
  id: 'collapse',
  name: 'Обвал',
  cost: 5,
  telegraph: 1.5,
  duration: 0.4,
  tags: ['aoe', 'zone'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + this.telegraph;
    const arena = ctx.arena;

    // Прогноз по текущей скорости героя: тот, кто бежит по прямой, будет накрыт.
    const px = clamp(ctx.hero.x + ctx.hero.vx * this.telegraph, 0, arena.w);
    const py = clamp(ctx.hero.y + ctx.hero.vy * this.telegraph, 0, arena.h);
    const speed = Math.hypot(ctx.hero.vx, ctx.hero.vy);
    // Перпендикуляр к бегу героя, чтобы боковой уход тоже был перекрыт.
    const nx = speed > 1e-6 ? -ctx.hero.vy / speed : 1;
    const ny = speed > 1e-6 ? ctx.hero.vx / speed : 0;
    const off = COLLAPSE.spreadOffset;

    const spots: readonly (readonly [number, number])[] = [
      [ctx.hero.x, ctx.hero.y], // остановиться тоже не выход
      [px, py],
      [px + nx * off, py + ny * off],
      [px - nx * off, py - ny * off],
    ];

    for (const [x, y] of spots) {
      ctx.addHazard({
        source: this.id,
        shape: {
          kind: 'circle',
          x: clamp(x, 0, arena.w),
          y: clamp(y, 0, arena.h),
          r: COLLAPSE.radius,
        },
        activeFrom: lands,
        expiresAt: lands + COLLAPSE.linger,
        impact: COLLAPSE.impact,
        dps: 0,
        danger: COLLAPSE.impact,
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
  /** Сколько урона герой успел нанести за бой (исход волны от этого не зависит). */
  damageTaken = 0;

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
      card.execute?.(ctx);
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
      card.prepare(ctx);
      return;
    }

    this.energy += TUNING.BOSS_ENERGY_REGEN;
    this.card = null;
    this.phase = 'recover';
    this.vulnerable = true;
    ctx.emit({ type: 'slot_start', slot, card: null, energy: this.energy });
  }
}

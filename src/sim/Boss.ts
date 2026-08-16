import { TICK_RATE, TUNING } from '../data/tuning';
import type { Arena } from './Arena';
import { BOSS_ANCHOR } from './Arena';
import { clamp } from './Collision';
import type { BattleEventBody } from './events';
import type { HazardSpec } from './Hazard';
import type { MinionSpawn } from './Minion';
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
  /**
   * Действующая длительность телеграфа текущей карты. Может быть короче
   * заявленной: «Ярость» ускоряет паттерны, и объявленные зоны обязаны
   * оживать вместе с укороченным предупреждением.
   */
  readonly telegraph: number;
  spawnProjectile(p: ProjectileSpawn): number;
  addHazard(h: HazardSpec): number;
  spawnMinion(m: MinionSpawn): number;
  /** Разогнать босса по прямой: он проносится и возвращается на место. */
  chargeBoss(angle: number, distance: number, duration: number): void;
  /** Ускорить все последующие паттерны на заданное время. */
  hasteBoss(duration: number, factor: number): void;
  /** Снести укрытия, ближайшие к точке. */
  destroyCovers(x: number, y: number, count: number): number;
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

export type BossPhase = 'idle' | 'telegraph' | 'active' | 'recover';

/**
 * Босс не двигается свободно, а исполняет таймлайн: 8 слотов по 5 с.
 * Пустой слот (или нехватка энергии) — фаза восстановления: +5 энергии,
 * босс уязвим.
 */
export class Boss {
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

  /** Разгон по прямой: смещение от якоря туда и обратно. */
  chargeAngle = 0;
  private chargeDist = 0;
  private chargeTicks = 0;
  private chargeTotal = 0;
  private chargeOffset = 0;
  /** До какого времени паттерны идут ускоренно и во сколько раз. */
  private hasteUntil = 0;
  private hasteFactor = 1;
  /** Действующие длительности текущей карты с учётом ускорения. */
  private cardTelegraph = 0;
  private cardDuration = 0;

  get x(): number {
    return BOSS_ANCHOR.x + Math.cos(this.chargeAngle) * this.chargeOffset;
  }

  get y(): number {
    return BOSS_ANCHOR.y + Math.sin(this.chargeAngle) * this.chargeOffset;
  }

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

  /** Телеграф текущей карты с учётом ускорения. */
  get telegraph(): number {
    return this.cardTelegraph;
  }

  /** Во сколько раз паттерны сейчас быстрее. */
  hasteAt(time: number): number {
    return time < this.hasteUntil ? this.hasteFactor : 1;
  }

  /** «Ярость»: следующие duration секунд все паттерны идут быстрее. */
  haste(time: number, duration: number, factor: number): void {
    this.hasteUntil = time + duration;
    this.hasteFactor = factor;
  }

  /** «Рывок»: босс проносится по прямой и возвращается на место. */
  charge(angle: number, distance: number, duration: number): void {
    this.chargeAngle = angle;
    this.chargeDist = distance;
    this.chargeTotal = Math.max(1, Math.round(duration * TICK_RATE));
    this.chargeTicks = 0;
  }

  /** 0..1 внутри текущей фазы — для отрисовки телеграфа. */
  get phaseProgress(): number {
    const card = this.card;
    if (!card) return 0;
    if (this.phase === 'telegraph') {
      return this.cardTelegraph > 0 ? clamp(this.phaseTime / this.cardTelegraph, 0, 1) : 1;
    }
    if (this.phase === 'active') {
      return this.cardDuration > 0 ? clamp(this.phaseTime / this.cardDuration, 0, 1) : 1;
    }
    return 0;
  }

  update(ctx: BattleCtx): void {
    // Время фазы наращиваем до смены слота: на тике, где фаза началась,
    // её возраст обязан быть нулевым, иначе телеграф короче обещанного.
    this.phaseTicks++;
    this.advanceCharge();

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
    if (this.phase === 'telegraph' && elapsed >= this.cardTelegraph) {
      this.phase = 'active';
      this.phaseTicks = 0;
      ctx.emit({ type: 'pattern_start', slot: this.slot, card: card.id });
      card.execute?.(ctx);
    } else if (this.phase === 'active' && elapsed >= this.cardDuration) {
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
      const haste = this.hasteAt(ctx.time);
      this.cardTelegraph = card.telegraph * haste;
      this.cardDuration = card.duration * haste;
      this.energy -= card.cost;
      this.card = card;
      this.phase = 'telegraph';
      this.vulnerable = false;
      // Прицел фиксируется здесь: за время телеграфа герой может уйти.
      this.aim = Math.atan2(ctx.hero.y - this.y, ctx.hero.x - this.x);
      ctx.emit({ type: 'slot_start', slot, card: card.id, energy: this.energy });
      ctx.emit({ type: 'telegraph', slot, card: card.id, duration: this.cardTelegraph });
      card.prepare(ctx);
      return;
    }

    this.energy += TUNING.BOSS_ENERGY_REGEN;
    this.card = null;
    this.phase = 'recover';
    this.vulnerable = true;
    ctx.emit({ type: 'slot_start', slot, card: null, energy: this.energy });
  }

  /** Смещение разгона идёт по синусу: туда и обратно за отведённое время. */
  private advanceCharge(): void {
    if (this.chargeTotal <= 0) return;
    this.chargeTicks++;
    const p = Math.min(1, this.chargeTicks / this.chargeTotal);
    this.chargeOffset = this.chargeDist * Math.sin(Math.PI * p);
    if (p >= 1) {
      this.chargeTotal = 0;
      this.chargeOffset = 0;
    }
  }
}

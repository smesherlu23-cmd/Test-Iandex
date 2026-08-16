import { HERO_AI, TICK_RATE, TUNING } from '../data/tuning';
import type { Cover } from './Arena';
import { Arena } from './Arena';
import type { BattleCtx, BossPhase, PatternCard } from './Boss';
import { Boss } from './Boss';
import { circleCircle } from './Collision';
import { DangerMap } from './DangerMap';
import type { BattleEvent, BattleEventBody } from './events';
import type { Hazard, HazardSpec } from './Hazard';
import { HAZARD_TICK, hazardContains, hazardDistance, stampHazard } from './Hazard';
import type { HeroActionKind, HeroSenses } from './Hero';
import { Hero } from './Hero';
import type { Projectile, ProjectileSpawn } from './Projectile';
import { advance } from './Projectile';
import { Rng } from './Rng';

/** Карта опасности обновляется 10 раз в секунду, а не каждый кадр (ТЗ §6). */
const DANGER_PERIOD_TICKS = Math.round(TICK_RATE / TUNING.DANGER_MAP_HZ);

export interface BattleConfig {
  /** 8 слотов по 5 с; null — восстановление энергии. */
  readonly timeline: readonly (PatternCard | null)[];
  readonly heroHp?: number;
  readonly heroSpeed?: number;
  readonly maxTime?: number;
}

/** Победа босса — герой погиб за отведённое время; иначе выжил. */
export type BattleOutcome = 'boss_win' | 'hero_win';

export interface BossView {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly energy: number;
  readonly phase: BossPhase;
  readonly phaseProgress: number;
  readonly aim: number;
  readonly slot: number;
  readonly card: string | null;
  readonly vulnerable: boolean;
  readonly damageTaken: number;
}

export interface HeroView {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
  readonly potions: number;
  readonly action: HeroActionKind;
}

export interface BattleState {
  readonly tick: number;
  readonly time: number;
  readonly finished: boolean;
  readonly outcome: BattleOutcome | null;
  readonly boss: BossView;
  readonly hero: HeroView;
  readonly projectiles: readonly Readonly<Projectile>[];
  readonly hazards: readonly Readonly<Hazard>[];
  readonly covers: readonly Readonly<Cover>[];
}

/**
 * Чистая детерминированная симуляция с фиксированным шагом.
 * Ни Date.now(), ни Math.random(): один и тот же {config, seed} обязан
 * давать идентичный лог событий.
 */
export class Battle implements BattleCtx {
  readonly rng: Rng;
  readonly arena: Arena;
  readonly boss: Boss;
  readonly hero: Hero;
  readonly danger = new DangerMap();

  private readonly projectiles: Projectile[] = [];
  private readonly hazards: Hazard[] = [];
  private readonly log: BattleEvent[] = [];
  private readonly maxTicks: number;

  private tickCount = 0;
  private timeSec = 0;
  private nextProjectileId = 0;
  private nextHazardId = 0;
  private outcomeValue: BattleOutcome | null = null;

  /** Отладка баланса: сколько угроз герой видел на последней пересборке карты. */
  visibleThreats = 0;

  /** Счётчик угроз: всё, что паттерн породил за один тик, — одна угроза. */
  private threatGroup = -1;
  private groupTick = -1;
  private groupSource = '';

  constructor(config: BattleConfig, seed: number) {
    this.rng = new Rng(seed);
    this.arena = new Arena();
    this.boss = new Boss(config.timeline);
    this.hero = new Hero({
      hp: config.heroHp ?? TUNING.HERO_BASE_HP,
      speed: config.heroSpeed ?? TUNING.HERO_BASE_SPEED,
      rng: this.rng,
    });
    this.maxTicks = Math.round((config.maxTime ?? TUNING.BATTLE_MAX_TIME) * TICK_RATE);
    this.emit({ type: 'battle_start', seed: seed >>> 0 });
  }

  get time(): number {
    return this.timeSec;
  }

  get tick(): number {
    return this.tickCount;
  }

  get finished(): boolean {
    return this.outcomeValue !== null;
  }

  get outcome(): BattleOutcome | null {
    return this.outcomeValue;
  }

  get events(): readonly BattleEvent[] {
    return this.log;
  }

  /** Ровно 1/60 с симуляции. */
  step(): void {
    if (this.finished) return;

    this.tickCount++;
    this.timeSec = this.tickCount / TICK_RATE;

    const dt = TUNING.FIXED_DT;
    this.boss.update(this);
    this.expireHazards();

    if ((this.tickCount - 1) % DANGER_PERIOD_TICKS === 0) this.rebuildDanger();

    const outcome = this.hero.update(dt, this.senses());
    if (outcome.actionChanged) this.emit({ type: 'hero_action', kind: this.hero.action });
    if (outcome.drankPotion) {
      this.emit({ type: 'hero_potion', hp: this.hero.hp, left: this.hero.potions });
    }
    if (outcome.attacked) {
      this.boss.damageTaken += HERO_AI.ATTACK_DAMAGE;
      this.emit({ type: 'boss_hit', damage: HERO_AI.ATTACK_DAMAGE, total: this.boss.damageTaken });
    }

    this.stepHazards();
    this.stepProjectiles(dt);
    this.checkEnd();
  }

  /** Readonly-снимок для рендера. */
  get state(): BattleState {
    return {
      tick: this.tickCount,
      time: this.timeSec,
      finished: this.finished,
      outcome: this.outcomeValue,
      boss: {
        x: this.boss.x,
        y: this.boss.y,
        r: this.boss.r,
        energy: this.boss.energy,
        phase: this.boss.phase,
        phaseProgress: this.boss.phaseProgress,
        aim: this.boss.aim,
        slot: this.boss.slot,
        card: this.boss.card?.id ?? null,
        vulnerable: this.boss.vulnerable,
        damageTaken: this.boss.damageTaken,
      },
      hero: {
        x: this.hero.x,
        y: this.hero.y,
        r: this.hero.r,
        hp: this.hero.hp,
        maxHp: this.hero.maxHp,
        alive: this.hero.alive,
        potions: this.hero.potions,
        action: this.hero.action,
      },
      projectiles: this.projectiles,
      hazards: this.hazards,
      covers: this.arena.covers,
    };
  }

  // --- BattleCtx ---

  spawnProjectile(p: ProjectileSpawn): number {
    const id = this.nextProjectileId++;
    this.projectiles.push({ id, group: this.groupFor(p.source), ...p });
    this.emit({ type: 'projectile_spawn', id, source: p.source, x: p.x, y: p.y });
    return id;
  }

  addHazard(spec: HazardSpec): number {
    const id = this.nextHazardId++;
    this.hazards.push({
      ...spec,
      id,
      group: this.groupFor(spec.source),
      // Герой замечает объявленную зону не мгновенно, а спустя время реакции.
      visibleAt: this.timeSec + this.hero.reaction,
      struck: false,
      nextTick: spec.activeFrom,
    });
    this.emit({
      type: 'hazard_spawn',
      id,
      source: spec.source,
      x: spec.shape.x,
      y: spec.shape.y,
    });
    return id;
  }

  emit(body: BattleEventBody): void {
    this.log.push({ t: this.timeSec, ...body });
  }

  // --- внутреннее ---

  /** Зоны и снаряды, созданные одним паттерном за один тик, — одна угроза. */
  private groupFor(source: string): number {
    if (this.tickCount !== this.groupTick || source !== this.groupSource) {
      this.threatGroup++;
      this.groupTick = this.tickCount;
      this.groupSource = source;
    }
    return this.threatGroup;
  }

  private senses(): HeroSenses {
    return {
      arena: this.arena,
      danger: this.danger,
      boss: {
        x: this.boss.x,
        y: this.boss.y,
        r: this.boss.r,
        vulnerable: this.boss.vulnerable,
      },
      projectiles: this.projectiles,
    };
  }

  /**
   * Пересборка прогноза: каждая зона и каждый снаряд сами вписывают в сетку
   * свой будущий урон. Ничего, кроме этой карты, герой об атаках не знает.
   */
  private rebuildDanger(): void {
    this.danger.clear();
    const tracked = this.trackedThreats();

    for (const h of this.hazards) {
      if (!tracked.has(h.group)) continue;
      this.danger.begin();
      stampHazard(this.danger, h.shape, h.danger, this.arena);
      this.danger.commit();
    }

    for (const p of this.projectiles) {
      if (!tracked.has(p.group)) continue;
      const speed = Math.hypot(p.vx, p.vy);
      if (speed < 1e-6) continue;
      this.danger.begin();
      this.danger.ray(
        p.x,
        p.y,
        Math.atan2(p.vy, p.vx),
        speed * HERO_AI.DANGER_HORIZON,
        (p.r + this.hero.r) * 2,
        p.damage,
        this.arena,
      );
      this.danger.commit();
    }
  }

  /**
   * Внимание героя ограничено: он ведёт лишь несколько самых срочных угроз.
   * Срочность — «через сколько это меня достанет»: время до удара плюс время,
   * за которое угроза может добраться до героя. Одну атаку герой читает
   * идеально, но наложение нескольких перестаёт помещаться в голову — отсюда
   * и берётся смертельность грамотной расстановки.
   */
  private trackedThreats(): Set<number> {
    const horizon = this.timeSec + HERO_AI.DANGER_HORIZON;
    const groups: number[] = [];
    const urgency: number[] = [];

    const note = (group: number, at: number): void => {
      const i = groups.indexOf(group);
      if (i < 0) {
        groups.push(group);
        urgency.push(at);
      } else if (at < urgency[i]!) {
        urgency[i] = at;
      }
    };

    for (const h of this.hazards) {
      if (this.timeSec < h.visibleAt) continue; // ещё не заметил
      if (h.activeFrom > horizon) continue; // слишком далеко в будущем
      const wait = Math.max(0, h.activeFrom - this.timeSec);
      const reach = hazardDistance(h.shape, this.hero.x, this.hero.y) / this.hero.speed;
      note(h.group, wait + reach);
    }

    for (const p of this.projectiles) {
      const dx = this.hero.x - p.x;
      const dy = this.hero.y - p.y;
      const closing = dx * p.vx + dy * p.vy;
      // Снаряд, летящий мимо, внимания не занимает.
      if (closing <= 0) continue;
      const speed = Math.hypot(p.vx, p.vy);
      note(p.group, speed > 1e-6 ? Math.sqrt(dx * dx + dy * dy) / speed : 0);
    }

    // Срочнее — важнее; при равенстве побеждает угроза постарше.
    const order = groups.map((_, i) => i);
    order.sort((a, b) => urgency[a]! - urgency[b]! || groups[a]! - groups[b]!);

    this.visibleThreats = groups.length;
    const tracked = new Set<number>();
    for (const i of order.slice(0, HERO_AI.ATTENTION)) tracked.add(groups[i]!);
    return tracked;
  }

  private expireHazards(): void {
    const arr = this.hazards;
    let write = 0;
    for (let i = 0; i < arr.length; i++) {
      const h = arr[i]!;
      if (this.timeSec > h.expiresAt) continue;
      arr[write++] = h;
    }
    arr.length = write;
  }

  private stepHazards(): void {
    if (!this.hero.alive) return;

    for (const h of this.hazards) {
      if (this.timeSec < h.activeFrom) continue;
      const inside = hazardContains(h.shape, this.hero.x, this.hero.y, this.hero.r);

      if (!h.struck) {
        h.struck = true;
        if (h.impact > 0 && inside) this.damageHero(h.impact, h.source);
      }

      if (h.dps > 0 && this.timeSec >= h.nextTick) {
        h.nextTick += HAZARD_TICK;
        if (inside) this.damageHero(h.dps * HAZARD_TICK, h.source);
      }

      if (!this.hero.alive) return;
    }
  }

  private stepProjectiles(dt: number): void {
    const arr = this.projectiles;
    let write = 0;

    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]!;
      advance(p, dt);

      if (this.hero.alive && circleCircle(p, this.hero)) {
        this.damageHero(p.damage, p.source);
        continue;
      }

      const cover = this.arena.coverAt(p);
      if (cover) {
        this.emit({ type: 'projectile_blocked', id: p.id, cover: cover.id });
        continue;
      }

      if (p.life <= 0 || !this.arena.containsPoint(p.x, p.y)) {
        this.emit({ type: 'projectile_expired', id: p.id });
        continue;
      }

      arr[write++] = p;
    }

    arr.length = write;
  }

  private damageHero(amount: number, source: string): void {
    this.hero.takeDamage(amount);
    this.emit({ type: 'hero_hit', source, damage: amount, hp: this.hero.hp });
    if (!this.hero.alive) {
      this.emit({ type: 'hero_died', x: this.hero.x, y: this.hero.y });
    }
  }

  private checkEnd(): void {
    if (!this.hero.alive) {
      this.finish('boss_win');
      return;
    }
    if (this.tickCount >= this.maxTicks) {
      this.finish('hero_win');
    }
  }

  private finish(outcome: BattleOutcome): void {
    this.outcomeValue = outcome;
    this.emit({ type: 'battle_end', outcome, duration: this.timeSec });
  }
}

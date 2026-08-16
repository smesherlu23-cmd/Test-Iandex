import { TICK_RATE, TUNING } from '../data/tuning';
import type { Cover } from './Arena';
import { Arena } from './Arena';
import type { BattleCtx, BossPhase, PatternCard } from './Boss';
import { Boss } from './Boss';
import { circleCircle } from './Collision';
import type { BattleEvent, BattleEventBody } from './events';
import { Hero } from './Hero';
import type { Projectile, ProjectileSpawn } from './Projectile';
import { advance } from './Projectile';
import { Rng } from './Rng';

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
}

export interface HeroView {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly alive: boolean;
}

export interface BattleState {
  readonly tick: number;
  readonly time: number;
  readonly finished: boolean;
  readonly outcome: BattleOutcome | null;
  readonly boss: BossView;
  readonly hero: HeroView;
  readonly projectiles: readonly Readonly<Projectile>[];
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

  private readonly projectiles: Projectile[] = [];
  private readonly log: BattleEvent[] = [];
  private readonly maxTicks: number;

  private tickCount = 0;
  private timeSec = 0;
  private nextProjectileId = 0;
  private outcomeValue: BattleOutcome | null = null;

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
    this.hero.update(dt);
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
      },
      hero: {
        x: this.hero.x,
        y: this.hero.y,
        r: this.hero.r,
        hp: this.hero.hp,
        maxHp: this.hero.maxHp,
        alive: this.hero.alive,
      },
      projectiles: this.projectiles,
      covers: this.arena.covers,
    };
  }

  // --- BattleCtx ---

  spawnProjectile(p: ProjectileSpawn): number {
    const id = this.nextProjectileId++;
    this.projectiles.push({ id, ...p });
    this.emit({ type: 'projectile_spawn', id, source: p.source, x: p.x, y: p.y });
    return id;
  }

  emit(body: BattleEventBody): void {
    this.log.push({ t: this.timeSec, ...body });
  }

  // --- внутреннее ---

  private stepProjectiles(dt: number): void {
    const arr = this.projectiles;
    let write = 0;

    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]!;
      advance(p, dt);

      if (this.hero.alive && circleCircle(p, this.hero)) {
        this.hero.takeDamage(p.damage);
        this.emit({ type: 'hero_hit', source: p.source, damage: p.damage, hp: this.hero.hp });
        if (!this.hero.alive) {
          this.emit({ type: 'hero_died', x: this.hero.x, y: this.hero.y });
        }
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

import { HERO_AI, TUNING } from '../data/tuning';
import type { Arena } from './Arena';
import { clamp, segmentRect } from './Collision';
import type { DangerMap } from './DangerMap';
import type { Projectile } from './Projectile';
import type { Rng } from './Rng';

const TAU = Math.PI * 2;

/** Направления обзора считаются один раз: они не меняются от боя к бою. */
const DIRS: readonly { readonly dx: number; readonly dy: number }[] = Array.from(
  { length: HERO_AI.DIRECTIONS },
  (_, i) => {
    const a = (TAU * i) / HERO_AI.DIRECTIONS;
    return { dx: Math.cos(a), dy: Math.sin(a) };
  },
);

export type HeroActionKind = 'dodge' | 'attack' | 'hide' | 'potion' | 'wait';

/** Всё, что герой знает о бое. Атаки видны только через карту опасности. */
export interface HeroSenses {
  readonly arena: Arena;
  readonly danger: DangerMap;
  readonly boss: {
    readonly x: number;
    readonly y: number;
    readonly r: number;
    readonly vulnerable: boolean;
  };
  readonly projectiles: readonly Projectile[];
}

/** Что герой сделал за тик — Battle превращает это в события и урон. */
export interface HeroOutcome {
  readonly attacked: boolean;
  readonly drankPotion: boolean;
  readonly actionChanged: boolean;
}

export interface HeroConfig {
  readonly hp: number;
  readonly speed: number;
  readonly rng: Rng;
}

interface Spot {
  x: number;
  y: number;
  danger: number;
}

interface Choice {
  kind: HeroActionKind;
  x: number;
  y: number;
}

const IDLE: HeroOutcome = { attacked: false, drankPotion: false, actionChanged: false };

/**
 * Utility-ИИ: каждый кадр герой оценивает набор действий и берёт лучшее.
 * Никакого рандома в решениях — непредсказуемость обязана расти из сложности
 * ситуации, а не из броска кубика (ТЗ §12).
 */
export class Hero {
  readonly r = 0.45;
  readonly maxHp: number;
  readonly speed: number;
  /** Базовая задержка, с которой герой замечает телеграф. Familiarity умножит её на Этапе 4. */
  readonly baseReaction = TUNING.HERO_BASE_REACTION;

  x: number;
  y: number;
  vx = 0;
  vy = 0;
  hp: number;
  alive = true;
  potions = TUNING.HERO_POTIONS;
  attackCd = 0;
  action: HeroActionKind = 'wait';
  /** Сколько секунд подряд вокруг тихо — условие для зелья. */
  calm = 0;
  /** Остаток замаха: пока идёт, герой прикован к месту. */
  strikeLock = 0;

  /** Точки обзора переиспользуются: 33 объекта на кадр — это 79 тысяч за бой. */
  private readonly spots: Spot[] = Array.from(
    { length: 1 + HERO_AI.DIRECTIONS * HERO_AI.LOOKAHEAD.length },
    () => ({ x: 0, y: 0, danger: 0 }),
  );
  private readonly choice: Choice = { kind: 'wait', x: 0, y: 0 };

  /** Загнанный герой хуже соображает: это и есть «паниковать» из ТЗ §6. */
  get panicking(): boolean {
    return this.hp < this.maxHp * HERO_AI.PANIC_HP;
  }

  /** Текущее время реакции на телеграф. */
  get reaction(): number {
    return this.panicking ? this.baseReaction * HERO_AI.PANIC_REACTION : this.baseReaction;
  }

  constructor(config: HeroConfig) {
    this.maxHp = config.hp;
    this.hp = config.hp;
    this.speed = config.speed;
    // От сида зависит только точка старта в нижней части арены.
    this.x = config.rng.range(3.5, 12.5);
    this.y = config.rng.range(14.5, 18.5);
  }

  update(dt: number, senses: HeroSenses): HeroOutcome {
    if (!this.alive) return IDLE;

    if (this.attackCd > 0) this.attackCd = Math.max(0, this.attackCd - dt);

    const dangerHere = senses.danger.at(this.x, this.y);
    this.calm = dangerHere <= HERO_AI.SAFE_DANGER ? this.calm + dt : 0;

    if (this.strikeLock > 0) {
      // Замах уже начат: увернуться в этот момент герой не может.
      this.strikeLock = Math.max(0, this.strikeLock - dt);
      this.vx = 0;
      this.vy = 0;
      return IDLE;
    }

    const choice = this.decide(senses, dangerHere);
    const actionChanged = choice.kind !== this.action;
    this.action = choice.kind;

    if (choice.kind === 'potion') {
      this.hp = Math.min(this.maxHp, this.hp + TUNING.HERO_POTION_HEAL);
      this.potions--;
      this.calm = 0;
      this.vx = 0;
      this.vy = 0;
      return { attacked: false, drankPotion: true, actionChanged };
    }

    this.moveTowards(choice.x, choice.y, dt, senses.arena);

    let attacked = false;
    if (choice.kind === 'attack' && this.attackCd <= 0 && this.inStrikeRange(senses)) {
      attacked = true;
      this.attackCd = TUNING.HERO_ATTACK_CD;
      this.strikeLock = HERO_AI.ATTACK_LOCK;
    }

    return { attacked, drankPotion: false, actionChanged };
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.calm = 0;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }

  private inStrikeRange(senses: HeroSenses): boolean {
    const dx = senses.boss.x - this.x;
    const dy = senses.boss.y - this.y;
    const reach = senses.boss.r + this.r + HERO_AI.ATTACK_RANGE;
    return dx * dx + dy * dy <= reach * reach;
  }

  // --- оценка действий ---

  private decide(senses: HeroSenses, dangerHere: number): Choice {
    const spots = this.spots;
    const n = this.buildCandidates(senses);

    let safest = spots[0]!;
    for (let i = 1; i < n; i++) {
      if (spots[i]!.danger < safest.danger) safest = spots[i]!;
    }

    // Уклониться: текущая точка под ударом, а рядом есть чистое место.
    const relief = (dangerHere - safest.danger) / HERO_AI.DANGER_REF;
    const dodge = HERO_AI.W_DODGE * clamp(relief, 0, 2);

    // Атаковать: босс в восстановлении, дистанция подходящая, кулдаун готов.
    const toBoss = dist(this.x, this.y, senses.boss.x, senses.boss.y);
    const gap = Math.max(0, toBoss - senses.boss.r - this.r);
    const strikeX = this.strikeX(senses, toBoss);
    const strikeY = this.strikeY(senses, toBoss);
    const attack =
      this.attackCd > 0
        ? 0
        : HERO_AI.W_ATTACK *
          (senses.boss.vulnerable ? 1 : HERO_AI.ATTACK_TIMID) *
          clamp(1 - gap / HERO_AI.ATTACK_APPROACH_MAX, 0, 1) *
          clamp(1 - senses.danger.at(strikeX, strikeY) / HERO_AI.DANGER_REF, 0, 1) *
          clamp(1 - dangerHere / HERO_AI.DANGER_REF, 0, 1);

    // Спрятаться: летят снаряды, здоровье просело, есть точка в тени укрытия.
    // Тени считаем только когда что-то летит: это самая дорогая проверка кадра.
    let hide = 0;
    let shelter: Spot | null = null;
    if (this.incoming(senses) > 0) {
      for (let i = 0; i < n; i++) {
        const s = spots[i]!;
        if (!this.shadowed(senses, s.x, s.y)) continue;
        if (!shelter || s.danger < shelter.danger) shelter = s;
      }
      if (shelter) {
        hide =
          HERO_AI.W_HIDE *
          (this.hp < this.maxHp * 0.4 ? 1 : HERO_AI.HIDE_HEALTHY) *
          clamp(1 - shelter.danger / HERO_AI.DANGER_REF, 0, 1);
      }
    }

    // Зелье: здоровье ниже 30%, есть заряд, вокруг тихо целую секунду.
    const potion =
      this.hp < this.maxHp * 0.3 && this.potions > 0 && this.calm >= HERO_AI.POTION_CALM
        ? HERO_AI.W_POTION
        : 0;

    // Отступить и подождать: опасно везде и бить всё равно нечем.
    const retreat = this.retreatSpot(senses, n, safest.danger);
    const wait =
      HERO_AI.W_WAIT *
      (safest.danger > HERO_AI.SAFE_DANGER ? 1 : 0.15) *
      (this.attackCd > 0 ? 1 : 0.4);

    const choice = this.choice;
    choice.kind = 'wait';
    choice.x = retreat.x;
    choice.y = retreat.y;
    let bestScore = this.weigh('wait', wait);

    const consider = (kind: HeroActionKind, score: number, x: number, y: number): void => {
      const weighted = this.weigh(kind, score);
      if (weighted <= bestScore) return;
      bestScore = weighted;
      choice.kind = kind;
      choice.x = x;
      choice.y = y;
    };

    consider('dodge', dodge, safest.x, safest.y);
    if (shelter) consider('hide', hide, shelter.x, shelter.y);
    consider('attack', attack, strikeX, strikeY);
    consider('potion', potion, this.x, this.y);

    return choice;
  }

  /** Небольшая инерция решения: без неё герой дрожит между равными вариантами. */
  private weigh(kind: HeroActionKind, score: number): number {
    return kind === this.action ? score * HERO_AI.COMMITMENT : score;
  }

  /** Заполняет this.spots и возвращает число заполненных точек. */
  private buildCandidates(senses: HeroSenses): number {
    const arena = senses.arena;
    const spots = this.spots;
    let n = 0;

    const here = spots[n++]!;
    here.x = this.x;
    here.y = this.y;
    here.danger = senses.danger.at(this.x, this.y);

    // В панике обзор сужается — далёкий безопасный угол просто не рассматривается.
    const vision = this.panicking ? HERO_AI.PANIC_VISION : 1;

    for (const dir of DIRS) {
      for (const step of HERO_AI.LOOKAHEAD) {
        const dist = step * vision;
        const x = clamp(this.x + dir.dx * dist, this.r, arena.w - this.r);
        const y = clamp(this.y + dir.dy * dist, this.r, arena.h - this.r);
        if (arena.coverAtXY(x, y, this.r)) continue;
        const spot = spots[n++]!;
        spot.x = x;
        spot.y = y;
        spot.danger = senses.danger.at(x, y);
      }
    }
    return n;
  }

  /** Точка, с которой достаёт удар: подходим к боссу, но не влезаем в него. */
  private strikeX(senses: HeroSenses, toBoss: number): number {
    const k = this.strikeFactor(senses, toBoss);
    return this.x + (senses.boss.x - this.x) * k;
  }

  private strikeY(senses: HeroSenses, toBoss: number): number {
    const k = this.strikeFactor(senses, toBoss);
    return this.y + (senses.boss.y - this.y) * k;
  }

  private strikeFactor(senses: HeroSenses, toBoss: number): number {
    const reach = senses.boss.r + this.r + HERO_AI.ATTACK_RANGE * 0.6;
    if (toBoss <= reach || toBoss < 1e-6) return 0;
    return (toBoss - reach) / toBoss;
  }

  /** Самая дальняя от босса точка среди почти безопасных. */
  private retreatSpot(senses: HeroSenses, n: number, floor: number): Spot {
    const spots = this.spots;
    let best = spots[0]!;
    let bestDist = -Infinity;
    for (let i = 0; i < n; i++) {
      const s = spots[i]!;
      if (s.danger > floor + HERO_AI.SAFE_DANGER) continue;
      const d = dist(s.x, s.y, senses.boss.x, senses.boss.y);
      if (d > bestDist) {
        bestDist = d;
        best = s;
      }
    }
    return best;
  }

  private shadowed(senses: HeroSenses, x: number, y: number): boolean {
    for (const cover of senses.arena.covers) {
      if (segmentRect(senses.boss.x, senses.boss.y, x, y, cover)) return true;
    }
    return false;
  }

  private incoming(senses: HeroSenses): number {
    let n = 0;
    for (const p of senses.projectiles) {
      if ((this.x - p.x) * p.vx + (this.y - p.y) * p.vy > 0) n++;
    }
    return n;
  }

  // --- движение ---

  /**
   * Разгон ограничен: живой игрок не разворачивается мгновенно. Именно эта
   * инерция делает предсказание «Обвала» осмысленным, а героя — ошибающимся.
   *
   * Смещение применяется покоординатно: шаг, упирающийся в укрытие, просто не
   * делается, и герой скользит вдоль стенки. Выталкивание из уже случившегося
   * пересечения не годилось — у боковой стены между укрытием и краем арены
   * нет места, куда выталкивать, и героя выносило за границу.
   */
  private moveTowards(tx: number, ty: number, dt: number, arena: Arena): void {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    let wantVx = 0;
    let wantVy = 0;
    if (len > 0.05) {
      const want = Math.min(this.speed, len / dt);
      wantVx = (dx / len) * want;
      wantVy = (dy / len) * want;
    }

    const dvx = wantVx - this.vx;
    const dvy = wantVy - this.vy;
    const dv = Math.sqrt(dvx * dvx + dvy * dvy);
    const maxDv = HERO_AI.ACCEL * dt;
    if (dv > maxDv) {
      this.vx += (dvx / dv) * maxDv;
      this.vy += (dvy / dv) * maxDv;
    } else {
      this.vx = wantVx;
      this.vy = wantVy;
    }

    const prevX = this.x;
    const prevY = this.y;

    const nx = clamp(this.x + this.vx * dt, this.r, arena.w - this.r);
    if (!arena.coverAtXY(nx, this.y, this.r)) this.x = nx;

    const ny = clamp(this.y + this.vy * dt, this.r, arena.h - this.r);
    if (!arena.coverAtXY(this.x, ny, this.r)) this.y = ny;

    // Реальная скорость после упоров в стены и укрытия — её же читает «Обвал».
    this.vx = (this.x - prevX) / dt;
    this.vy = (this.y - prevY) / dt;
  }
}


function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

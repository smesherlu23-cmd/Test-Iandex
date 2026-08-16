import type { BattleCtx, PatternCard } from '../sim/Boss';
import { clamp } from '../sim/Collision';

/**
 * Пул паттернов. Карты живут здесь, а не в sim/: симуляция знает только
 * интерфейс PatternCard и исполняет тот таймлайн, который ей передали.
 *
 * Числа урона в ТЗ не заданы — в таблице §8 есть только стоимость и телеграф,
 * остальное подобрано балансным прогоном Этапа 2.
 */

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

// --- Пул ---

/** Запись пула: карта и волна, с которой она может выпасть в драфте. */
export interface PoolEntry {
  readonly card: PatternCard;
  readonly minWave: number;
}

/**
 * Пока в пуле три карты — полный стартовый набор из двенадцати собирается на
 * Этапе 5. Из-за этого предложение драфта почти не случайно: доступных карт
 * едва хватает на три позиции.
 */
export const CARD_POOL: readonly PoolEntry[] = [
  { card: SHARD_VOLLEY, minWave: 1 },
  { card: POISON_ZONE, minWave: 1 },
  { card: COLLAPSE_PATTERN, minWave: 2 },
];

/** Карты, которые могут выпасть на этой волне. */
export function availableCards(
  wave: number,
  pool: readonly PoolEntry[] = CARD_POOL,
): PatternCard[] {
  return pool.filter((entry) => entry.minWave <= wave).map((entry) => entry.card);
}

export function cardById(
  id: string,
  pool: readonly PoolEntry[] = CARD_POOL,
): PatternCard | null {
  return pool.find((entry) => entry.card.id === id)?.card ?? null;
}

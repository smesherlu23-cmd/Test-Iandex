import { TUNING } from '../data/tuning';
import type { BattleCtx, PatternCard } from '../sim/Boss';
import { clamp } from '../sim/Collision';

/**
 * Стартовый пул из ТЗ §8. Карты живут здесь, а не в sim/: симуляция знает
 * только интерфейс PatternCard и исполняет тот таймлайн, который ей передали.
 *
 * Стоимость и телеграф взяты из таблицы дословно. Урона в ТЗ нет вовсе —
 * эти числа подобраны балансным прогоном (npm run balance).
 */

// --- Град осколков ---

export const SHARDS = {
  count: 8,
  spread: Math.PI / 2,
  speed: 9,
  radius: 0.35,
  damage: 18,
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
    const fires = ctx.time + ctx.telegraph;
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
export const POISON = { radius: 2, dps: 16, linger: 6 } as const;

export const POISON_ZONE: PatternCard = {
  id: 'poison_zone',
  name: 'Зона отравления',
  cost: 3,
  telegraph: 0.9,
  duration: 0.4,
  tags: ['zone'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + ctx.telegraph;
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

export const COLLAPSE = { radius: 2.4, impact: 44, linger: 0.4, spreadOffset: 3.4 } as const;

export const COLLAPSE_PATTERN: PatternCard = {
  id: 'collapse',
  name: 'Обвал',
  cost: 5,
  telegraph: 1.5,
  duration: 0.4,
  tags: ['aoe', 'zone'],

  prepare(ctx: BattleCtx): void {
    const lead = ctx.telegraph;
    const lands = ctx.time + lead;
    const arena = ctx.arena;

    // Прогноз по текущей скорости героя: тот, кто бежит по прямой, будет накрыт.
    // Замедленный «Стоном ужаса» герой уйти уже не успевает — это и есть синергия.
    const px = clamp(ctx.hero.x + ctx.hero.vx * lead, 0, arena.w);
    const py = clamp(ctx.hero.y + ctx.hero.vy * lead, 0, arena.h);
    const speed = Math.hypot(ctx.hero.vx, ctx.hero.vy);
    // Перпендикуляр к бегу героя, чтобы боковой уход тоже был перекрыт.
    const nx = speed > 1e-6 ? -ctx.hero.vy / speed : 1;
    const ny = speed > 1e-6 ? ctx.hero.vx / speed : 0;
    const off = COLLAPSE.spreadOffset;

    // Четыре зоны ромбом вокруг прогноза перекрывают все варианты ухода:
    // бежать дальше, свернуть вбок и затормозить назад. Просто накрыть точку
    // прогноза мало — герой из неё выходит за время телеграфа.
    const fx = speed > 1e-6 ? ctx.hero.vx / speed : 0;
    const fy = speed > 1e-6 ? ctx.hero.vy / speed : 1;
    const spots: readonly (readonly [number, number])[] = [
      [px, py],
      [px + nx * off, py + ny * off],
      [px - nx * off, py - ny * off],
      [px - fx * off, py - fy * off],
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

// --- Удар лапой ---

export const CLAW = { spread: Math.PI / 2, radius: 5.5, impact: 36, linger: 0.25 } as const;

export const CLAW_STRIKE: PatternCard = {
  id: 'claw',
  name: 'Удар лапой',
  cost: 2,
  telegraph: 0.4,
  duration: 0.25,
  tags: ['melee'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + ctx.telegraph;
    // Конус достаёт недалеко: это наказание за то, что герой подошёл бить.
    ctx.addHazard({
      source: this.id,
      shape: {
        kind: 'wedge',
        x: ctx.boss.x,
        y: ctx.boss.y,
        angle: ctx.boss.aim,
        spread: CLAW.spread,
        radius: CLAW.radius,
      },
      activeFrom: lands,
      expiresAt: lands + CLAW.linger,
      impact: CLAW.impact,
      dps: 0,
      danger: CLAW.impact,
    });
  },
};

// --- Волна огня ---

export const FIRE_WAVE = { height: 4.5, impact: 26, dps: 9, linger: 3 } as const;

export const FIRE_WAVE_PATTERN: PatternCard = {
  id: 'fire_wave',
  name: 'Волна огня',
  cost: 4,
  telegraph: 1,
  duration: 0.4,
  tags: ['aoe', 'zone'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + ctx.telegraph;
    const arena = ctx.arena;
    const top = clamp(ctx.hero.y - FIRE_WAVE.height / 2, 0, arena.h - FIRE_WAVE.height);

    // Полоса через всю арену: уходить надо вверх или вниз, вбок бесполезно.
    ctx.addHazard({
      source: this.id,
      shape: { kind: 'rect', x: 0, y: top, w: arena.w, h: FIRE_WAVE.height },
      activeFrom: lands,
      expiresAt: lands + FIRE_WAVE.linger,
      impact: FIRE_WAVE.impact,
      dps: FIRE_WAVE.dps,
      danger: FIRE_WAVE.impact,
    });
  },
};

// --- Призыв прислужников ---

/** «Слабые юниты» из §8: первый прогон показал 49% винрейта, пришлось ослабить втрое. */
export const MINIONS = { count: 2, hp: 8, speed: 2.2, damage: 4, life: 10, radius: 0.5 } as const;

export const SUMMON_MINIONS: PatternCard = {
  id: 'summon',
  name: 'Призыв прислужников',
  cost: 4,
  telegraph: 0.6,
  duration: 0.3,
  tags: ['summon'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + ctx.telegraph;
    // Предупреждение — круги у босса, откуда полезут прислужники.
    for (let i = 0; i < MINIONS.count; i++) {
      const a = ctx.boss.aim + (i === 0 ? -0.5 : 0.5);
      ctx.addHazard({
        source: this.id,
        shape: {
          kind: 'circle',
          x: ctx.boss.x + Math.cos(a) * (ctx.boss.r + 1),
          y: ctx.boss.y + Math.sin(a) * (ctx.boss.r + 1),
          r: 1,
        },
        activeFrom: lands,
        expiresAt: lands,
        impact: 0,
        dps: 0,
        danger: MINIONS.damage,
      });
    }
  },

  execute(ctx: BattleCtx): void {
    for (let i = 0; i < MINIONS.count; i++) {
      const a = ctx.boss.aim + (i === 0 ? -0.5 : 0.5);
      ctx.spawnMinion({
        source: this.id,
        x: ctx.boss.x + Math.cos(a) * (ctx.boss.r + 1),
        y: ctx.boss.y + Math.sin(a) * (ctx.boss.r + 1),
        r: MINIONS.radius,
        hp: MINIONS.hp,
        speed: MINIONS.speed,
        damage: MINIONS.damage,
        life: MINIONS.life,
      });
    }
  },
};

// --- Ловушка ---

export const TRAP = {
  radius: 1.6,
  impact: 18,
  root: 1.4,
  lead: 1.6,
  /** Минимальный отступ от героя: ловушка под ногами — не ловушка. */
  minLead: 2.6,
  /** Взведение: зона не срабатывает мгновенно под тем, кто уже на ней стоит. */
  arm: 0.5,
  life: 20,
} as const;

export const TRAP_PATTERN: PatternCard = {
  id: 'trap',
  name: 'Ловушка',
  cost: 2,
  telegraph: 0,
  duration: 0.2,
  tags: ['trap'],

  prepare(ctx: BattleCtx): void {
    const arena = ctx.arena;
    // Единственная карта без телеграфа (ТЗ §8): зона невидима и ждёт, пока
    // герой сам на неё наступит. Кладётся туда, куда он бежит, но не ближе
    // minLead — иначе она сработала бы прямо под ним и ничего не поймала.
    const speed = Math.hypot(ctx.hero.vx, ctx.hero.vy);
    // Неподвижный герой рано или поздно пойдёт бить босса — туда и кладём.
    const toBoss = Math.atan2(ctx.boss.y - ctx.hero.y, ctx.boss.x - ctx.hero.x);
    const dx = speed > 0.5 ? ctx.hero.vx / speed : Math.cos(toBoss);
    const dy = speed > 0.5 ? ctx.hero.vy / speed : Math.sin(toBoss);
    const reach = Math.max(TRAP.minLead, speed * TRAP.lead);

    ctx.addHazard({
      source: this.id,
      shape: {
        kind: 'circle',
        x: clamp(ctx.hero.x + dx * reach, 0, arena.w),
        y: clamp(ctx.hero.y + dy * reach, 0, arena.h),
        r: TRAP.radius,
      },
      activeFrom: ctx.time + TRAP.arm,
      expiresAt: ctx.time + TRAP.life,
      impact: TRAP.impact,
      dps: 0,
      danger: 0,
      hidden: true,
      onEnter: true,
      root: TRAP.root,
    });
  },
};

// --- Рывок босса ---

export const CHARGE = { length: 15, width: 3, impact: 26, linger: 0.5, travel: 0.45 } as const;

export const BOSS_CHARGE: PatternCard = {
  id: 'boss_charge',
  name: 'Рывок',
  cost: 3,
  telegraph: 0.7,
  duration: 0.5,
  tags: ['melee'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + ctx.telegraph;
    ctx.addHazard({
      source: this.id,
      shape: {
        kind: 'ray',
        x: ctx.boss.x,
        y: ctx.boss.y,
        angle: ctx.boss.aim,
        length: CHARGE.length,
        width: CHARGE.width,
      },
      activeFrom: lands,
      expiresAt: lands + CHARGE.linger,
      impact: CHARGE.impact,
      dps: 0,
      danger: CHARGE.impact,
    });
  },

  execute(ctx: BattleCtx): void {
    // Босс действительно проносится по прямой и возвращается на место:
    // свободно перемещаться он не должен (ТЗ §6).
    ctx.chargeBoss(ctx.boss.aim, CHARGE.length * 0.6, CHARGE.travel);
  },
};

// --- Стон ужаса ---

/**
 * Замедление держится 6 с, а не 3 с из таблицы §8. При слотах по 5 секунд
 * трёхсекундный эффект гаснет раньше, чем начнётся следующая атака, и связка
 * «Стон ужаса» → «Обвал», которую ТЗ приводит как пример синергии, физически
 * не может сработать. Шесть секунд как раз дотягиваются до удара соседнего слота.
 */
export const MOAN = { radius: 13, slow: 0.6, slowFor: 6, linger: 0.3 } as const;

export const HORROR_MOAN: PatternCard = {
  id: 'horror_moan',
  name: 'Стон ужаса',
  cost: 2,
  telegraph: 0.5,
  duration: 0.3,
  tags: ['aoe'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + ctx.telegraph;
    // Урона нет, поэтому danger нулевой: герой не станет тратить на крик
    // внимание, а замедление всё равно его настигнет. Отсюда и связка
    // «Стон ужаса» → «Обвал».
    ctx.addHazard({
      source: this.id,
      shape: { kind: 'circle', x: ctx.boss.x, y: ctx.boss.y, r: MOAN.radius },
      activeFrom: lands,
      expiresAt: lands + MOAN.linger,
      impact: 0,
      dps: 0,
      danger: 0,
      slow: MOAN.slow,
      slowFor: MOAN.slowFor,
    });
  },
};

// --- Разрушение укрытий ---

export const SHATTER = { count: 2 } as const;

export const SHATTER_COVERS: PatternCard = {
  id: 'shatter_covers',
  name: 'Разрушение укрытий',
  cost: 3,
  telegraph: 1.2,
  duration: 0.3,
  tags: ['zone'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + ctx.telegraph;
    // Предупреждение рисуется на самих укрытиях, которые сейчас рухнут.
    const doomed = [...ctx.arena.covers]
      .sort(
        (a, b) =>
          (a.x - ctx.hero.x) ** 2 + (a.y - ctx.hero.y) ** 2 -
          ((b.x - ctx.hero.x) ** 2 + (b.y - ctx.hero.y) ** 2),
      )
      .slice(0, SHATTER.count);

    for (const cover of doomed) {
      ctx.addHazard({
        source: this.id,
        shape: { kind: 'rect', x: cover.x, y: cover.y, w: cover.w, h: cover.h },
        activeFrom: lands,
        expiresAt: lands,
        impact: 0,
        dps: 0,
        danger: 0,
      });
    }
  },

  execute(ctx: BattleCtx): void {
    // Снимает защиту оттуда, где герой прячется: связка с «Градом осколков».
    ctx.destroyCovers(ctx.hero.x, ctx.hero.y, SHATTER.count);
  },
};

// --- Ярость ---

export const FURY = { duration: 10, factor: 0.7 } as const;

export const FURY_PATTERN: PatternCard = {
  id: 'fury',
  name: 'Ярость',
  cost: 6,
  telegraph: 1,
  duration: 0.3,
  tags: ['aoe'],

  prepare(ctx: BattleCtx): void {
    const lands = ctx.time + ctx.telegraph;
    // Сама по себе «Ярость» не бьёт — это разгон для следующих слотов.
    ctx.addHazard({
      source: this.id,
      shape: { kind: 'circle', x: ctx.boss.x, y: ctx.boss.y, r: ctx.boss.r + 1.5 },
      activeFrom: lands,
      expiresAt: lands + 0.3,
      impact: 0,
      dps: 0,
      danger: 0,
    });
  },

  execute(ctx: BattleCtx): void {
    ctx.hasteBoss(FURY.duration, FURY.factor);
  },
};

// --- Пул ---

/** Запись пула: карта и волна, с которой она может выпасть в драфте. */
export interface PoolEntry {
  readonly card: PatternCard;
  readonly minWave: number;
}

/**
 * Полный стартовый набор из ТЗ §8. «Восстановление» карты не имеет: это
 * пустой слот таймлайна, дающий +5 энергии и делающий босса уязвимым.
 *
 * Волны открытия расставлены так, чтобы дешёвые и понятные карты приходили
 * первыми, а связки — когда игроку есть что с ними связывать.
 */
export const CARD_POOL: readonly PoolEntry[] = [
  { card: CLAW_STRIKE, minWave: 1 },
  { card: SHARD_VOLLEY, minWave: 1 },
  { card: POISON_ZONE, minWave: 1 },
  { card: TRAP_PATTERN, minWave: 2 },
  { card: BOSS_CHARGE, minWave: 2 },
  { card: HORROR_MOAN, minWave: 3 },
  { card: COLLAPSE_PATTERN, minWave: 3 },
  { card: FIRE_WAVE_PATTERN, minWave: 4 },
  { card: SUMMON_MINIONS, minWave: 4 },
  { card: SHATTER_COVERS, minWave: 5 },
  { card: FURY_PATTERN, minWave: 6 },
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

/** Стоимость самого дешёвого паттерна — нужна планировщику расстановки. */
export const CHEAPEST_COST = Math.min(...CARD_POOL.map((e) => e.card.cost));

/** Восстановление — не карта, а пустой слот (ТЗ §8). */
export const RECOVERY_ENERGY = TUNING.BOSS_ENERGY_REGEN;

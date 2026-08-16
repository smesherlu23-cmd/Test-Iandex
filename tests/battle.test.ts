import { describe, expect, it } from 'vitest';
import { TUNING } from '../src/data/tuning';
import { Arena } from '../src/sim/Arena';
import { SHARDS } from '../src/draft/CardPool';
import {
  circleCircle,
  circleInsideBounds,
  circleRect,
  segmentRect,
} from '../src/sim/Collision';
import { DEMO, S, SHARDS_ONLY, runToEnd } from './helpers';

describe('геометрия', () => {
  it('круг с кругом', () => {
    expect(circleCircle({ x: 0, y: 0, r: 1 }, { x: 1.5, y: 0, r: 1 })).toBe(true);
    expect(circleCircle({ x: 0, y: 0, r: 1 }, { x: 2.5, y: 0, r: 1 })).toBe(false);
    // Касание считается столкновением.
    expect(circleCircle({ x: 0, y: 0, r: 1 }, { x: 2, y: 0, r: 1 })).toBe(true);
  });

  it('круг с прямоугольником', () => {
    const rect = { x: 0, y: 0, w: 4, h: 2 };
    expect(circleRect({ x: 2, y: 1, r: 0.5 }, rect)).toBe(true); // центр внутри
    expect(circleRect({ x: 4.4, y: 1, r: 0.5 }, rect)).toBe(true); // сбоку
    expect(circleRect({ x: 4.6, y: 1, r: 0.5 }, rect)).toBe(false);
    // Угол: расстояние до (0,0) ≈ 0.566 — радиуса 0.6 хватает, 0.5 нет.
    expect(circleRect({ x: -0.4, y: -0.4, r: 0.6 }, rect)).toBe(true);
    expect(circleRect({ x: -0.4, y: -0.4, r: 0.5 }, rect)).toBe(false);
  });

  it('отрезок с прямоугольником', () => {
    const rect = { x: 4, y: 4, w: 2, h: 2 };
    expect(segmentRect(0, 5, 10, 5, rect)).toBe(true); // насквозь
    expect(segmentRect(0, 0, 5, 5, rect)).toBe(true); // упирается в угол
    expect(segmentRect(0, 0, 3, 3, rect)).toBe(false); // не дотягивается
    expect(segmentRect(0, 10, 10, 10, rect)).toBe(false); // мимо
  });

  it('круг внутри границ', () => {
    expect(circleInsideBounds({ x: 8, y: 12, r: 1 }, 16, 24)).toBe(true);
    expect(circleInsideBounds({ x: 0.5, y: 12, r: 1 }, 16, 24)).toBe(false);
  });

  it('арена находит укрытие под кругом', () => {
    const arena = new Arena();
    expect(arena.covers).toHaveLength(4);
    const cover = arena.covers[0]!;
    expect(arena.coverAt({ x: cover.x + cover.w / 2, y: cover.y + cover.h / 2, r: 0.3 })).toBe(
      cover,
    );
    expect(arena.coverAt({ x: 8, y: 15, r: 0.4 })).toBeNull();
    expect(arena.containsPoint(8, 12)).toBe(true);
    expect(arena.containsPoint(-0.1, 12)).toBe(false);
  });
});

describe('исполнение таймлайна', () => {
  it('слот открывается каждые 5 секунд', () => {
    const battle = runToEnd({ timeline: SHARDS_ONLY }, 11);
    const slots = battle.events.filter((e) => e.type === 'slot_start');
    expect(slots).toHaveLength(TUNING.TIMELINE_SLOTS);
    slots.forEach((e, i) => {
      expect(e.t).toBeCloseTo(i === 0 ? TUNING.FIXED_DT : i * TUNING.SLOT_DURATION, 5);
    });
  });

  it('платный слот списывает энергию, пустой возвращает 5', () => {
    const battle = runToEnd({ timeline: SHARDS_ONLY }, 11);
    const energy = battle.events
      .filter((e) => e.type === 'slot_start')
      .map((e) => (e.type === 'slot_start' ? e.energy : -1));
    // старт 10, стоимость веера 3, пустые слоты 3 и 5 дают +5
    expect(energy).toEqual([7, 4, 1, 6, 3, 8, 5, 2]);
  });

  it('при нехватке энергии слот уходит в восстановление', () => {
    const battle = runToEnd({ timeline: [S, S, S, S, S, S, S, S] }, 11);
    const cards = battle.events
      .filter((e) => e.type === 'slot_start')
      .map((e) => (e.type === 'slot_start' ? e.card : ''));
    // 10 → 7 → 4 → 1: на четвёртый веер энергии нет, босс восстанавливается
    expect(cards).toEqual([
      'shard_volley',
      'shard_volley',
      'shard_volley',
      null,
      'shard_volley',
      'shard_volley',
      null,
      'shard_volley',
    ]);
  });

  it('телеграф всегда предшествует активной фазе', () => {
    const battle = runToEnd({ timeline: SHARDS_ONLY }, 11);
    const telegraphs = battle.events.filter((e) => e.type === 'telegraph');
    const starts = battle.events.filter((e) => e.type === 'pattern_start');
    expect(telegraphs).toHaveLength(starts.length);
    expect(starts.length).toBeGreaterThan(0);

    telegraphs.forEach((tel, i) => {
      const delay = starts[i]!.t - tel.t;
      expect(delay).toBeGreaterThanOrEqual(S.telegraph - 1e-9);
      // Задержка не больше телеграфа плюс квантование в один тик.
      expect(delay).toBeLessThanOrEqual(S.telegraph + TUNING.FIXED_DT * 2);
    });
  });

  it('снаряды появляются только в активной фазе', () => {
    const battle = runToEnd({ timeline: SHARDS_ONLY }, 11);
    const spawns = battle.events.filter((e) => e.type === 'projectile_spawn');
    const starts = battle.events.filter((e) => e.type === 'pattern_start');
    expect(spawns).toHaveLength(starts.length * SHARDS.count);
    for (const spawn of spawns) {
      expect(starts.some((s) => s.t === spawn.t)).toBe(true);
    }
  });
});

describe('столкновения и урон', () => {
  it('здоровье героя сходится с логом попаданий', () => {
    const battle = runToEnd(DEMO, 2);
    const hits = battle.events.filter((e) => e.type === 'hero_hit');
    const sips = battle.events.filter((e) => e.type === 'hero_potion');
    expect(hits.length).toBeGreaterThan(0);

    // Сверяем цепочку: каждое событие несёт здоровье после удара.
    let hp: number = TUNING.HERO_BASE_HP;
    for (const e of battle.events) {
      if (e.type === 'hero_hit') {
        hp = Math.max(0, hp - e.damage);
        expect(e.hp).toBeCloseTo(hp, 6);
      } else if (e.type === 'hero_potion') {
        hp = Math.min(TUNING.HERO_BASE_HP, hp + TUNING.HERO_POTION_HEAL);
        expect(e.hp).toBeCloseTo(hp, 6);
      }
    }
    expect(battle.hero.hp).toBeCloseTo(hp, 6);
    expect(sips.length).toBeLessThanOrEqual(TUNING.HERO_POTIONS);
  });

  it('укрытия блокируют снаряды', () => {
    const battle = runToEnd({ timeline: SHARDS_ONLY }, 1);
    const blocked = battle.events.filter((e) => e.type === 'projectile_blocked');
    expect(blocked.length).toBeGreaterThan(0);
    for (const e of blocked) {
      if (e.type !== 'projectile_blocked') continue;
      expect(e.cover).toBeGreaterThanOrEqual(0);
      expect(e.cover).toBeLessThan(4);
    }
  });

  it('снаряд живёт до попадания, укрытия или края арены', () => {
    const battle = runToEnd({ timeline: SHARDS_ONLY }, 1);
    const spawned = battle.events.filter((e) => e.type === 'projectile_spawn').length;
    const gone =
      battle.events.filter((e) => e.type === 'projectile_blocked').length +
      battle.events.filter((e) => e.type === 'projectile_expired').length +
      battle.events.filter((e) => e.type === 'hero_hit' && e.source === 'shard_volley').length;
    // Остаться в воздухе к концу боя может только то, что ещё летит.
    expect(gone + battle.state.projectiles.length).toBe(spawned);
  });
});

describe('конец боя', () => {
  it('герой пережил 40 секунд — победа героя', () => {
    const battle = runToEnd({ timeline: SHARDS_ONLY }, 1);
    expect(battle.outcome).toBe('hero_win');
    expect(battle.state.time).toBeCloseTo(TUNING.BATTLE_MAX_TIME, 5);
    expect(battle.hero.alive).toBe(true);
    expect(battle.events.at(-1)!.type).toBe('battle_end');
  });

  it('герой погиб — победа босса, бой обрывается сразу', () => {
    const battle = runToEnd({ ...DEMO, heroHp: 30 }, 1);
    expect(battle.outcome).toBe('boss_win');
    expect(battle.hero.alive).toBe(false);
    expect(battle.hero.hp).toBe(0);
    expect(battle.state.time).toBeLessThan(TUNING.BATTLE_MAX_TIME);

    const died = battle.events.findIndex((e) => e.type === 'hero_died');
    expect(died).toBeGreaterThanOrEqual(0);
    // После смерти героя пишется только battle_end.
    expect(battle.events.slice(died + 1).map((e) => e.type)).toEqual(['battle_end']);
  });

  it('бой без паттернов герой переживает всегда', () => {
    const battle = runToEnd({ timeline: [null, null, null, null, null, null, null, null] }, 3);
    expect(battle.outcome).toBe('hero_win');
    expect(battle.hero.hp).toBe(TUNING.HERO_BASE_HP);
    // Восемь пустых слотов: стартовые 10 плюс 8 × 5.
    expect(battle.boss.energy).toBe(TUNING.BOSS_ENERGY_START + 8 * TUNING.BOSS_ENERGY_REGEN);
  });
});

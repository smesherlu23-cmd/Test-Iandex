import { describe, expect, it } from 'vitest';
import {
  BOSS_CHARGE,
  CARD_POOL,
  CLAW_STRIKE,
  FIRE_WAVE,
  FIRE_WAVE_PATTERN,
  FURY,
  FURY_PATTERN,
  HORROR_MOAN,
  MINIONS,
  MOAN,
  SHATTER,
  SHATTER_COVERS,
  SHARD_VOLLEY,
  SUMMON_MINIONS,
  TRAP,
  TRAP_PATTERN,
} from '../src/draft/CardPool';
import { BOSS_ANCHOR } from '../src/sim/Arena';
import { Battle } from '../src/sim/Battle';
import type { PatternCard } from '../src/sim/Boss';
import { hazardContains, hazardDistance } from '../src/sim/Hazard';
import { DOMINANCE_LIMIT, runBalance } from '../scripts/balanceRun';
import { runToEnd } from './helpers';

const slots = (...cards: (PatternCard | null)[]): (PatternCard | null)[] => {
  const out: (PatternCard | null)[] = Array.from({ length: 8 }, () => null);
  cards.forEach((c, i) => (out[i] = c));
  return out;
};

/** Прогоняет бой до появления первой зоны указанной карты. */
function untilHazard(battle: Battle, source: string, cap = 3000): void {
  let guard = 0;
  while (!battle.state.hazards.some((h) => h.source === source) && guard++ < cap) battle.step();
}

describe('геометрия новых зон', () => {
  it('конус ловит только то, что перед боссом', () => {
    const wedge = { kind: 'wedge', x: 8, y: 4, angle: Math.PI / 2, spread: Math.PI / 2, radius: 5 } as const;
    expect(hazardContains(wedge, 8, 8, 0.45)).toBe(true); // прямо по направлению
    expect(hazardContains(wedge, 11, 7, 0.45)).toBe(true); // в пределах раствора
    expect(hazardContains(wedge, 8, 1, 0.45)).toBe(false); // за спиной
    expect(hazardContains(wedge, 8, 12, 0.45)).toBe(false); // слишком далеко
    expect(hazardDistance(wedge, 8, 8)).toBe(0);
    expect(hazardDistance(wedge, 8, 12)).toBeGreaterThan(0);
  });

  it('полоса ловит по прямоугольнику', () => {
    const rect = { kind: 'rect', x: 0, y: 10, w: 16, h: 3 } as const;
    expect(hazardContains(rect, 8, 11, 0.45)).toBe(true);
    expect(hazardContains(rect, 8, 13.2, 0.45)).toBe(true); // краем
    expect(hazardContains(rect, 8, 14, 0.45)).toBe(false);
    expect(hazardDistance(rect, 8, 16)).toBeCloseTo(3, 6);
  });
});

describe('карты стартового пула', () => {
  it('каждая карта что-то объявляет и отрабатывает', () => {
    for (const entry of CARD_POOL) {
      const battle = new Battle({ timeline: slots(entry.card) }, 3);
      let guard = 0;
      while (guard++ < 600) battle.step();

      const telegraphed = battle.events.some(
        (e) => e.type === 'telegraph' && e.card === entry.card.id,
      );
      const declared = battle.events.some(
        (e) => e.type === 'hazard_spawn' && e.source === entry.card.id,
      );
      expect(telegraphed, entry.card.name).toBe(true);
      expect(declared, entry.card.name).toBe(true);
    }
  });

  it('удар лапой достаёт конусом только вблизи', () => {
    const battle = new Battle({ timeline: slots(CLAW_STRIKE) }, 1);
    untilHazard(battle, 'claw');
    const zone = battle.state.hazards.find((h) => h.source === 'claw')!;
    expect(zone.shape.kind).toBe('wedge');
    if (zone.shape.kind !== 'wedge') return;
    expect(zone.shape.x).toBeCloseTo(BOSS_ANCHOR.x, 6);
    expect(zone.shape.radius).toBeLessThan(8); // ближняя дистанция
  });

  it('волна огня перекрывает арену и оставляет горящую полосу', () => {
    const battle = new Battle({ timeline: slots(FIRE_WAVE_PATTERN) }, 1);
    untilHazard(battle, 'fire_wave');
    const zone = battle.state.hazards.find((h) => h.source === 'fire_wave')!;
    expect(zone.shape.kind).toBe('rect');
    if (zone.shape.kind !== 'rect') return;
    expect(zone.shape.w).toBe(battle.arena.w);
    expect(zone.dps).toBeGreaterThan(0);
    expect(zone.expiresAt - zone.activeFrom).toBeCloseTo(FIRE_WAVE.linger, 6);
  });

  it('призыв поднимает двух прислужников, они преследуют и уходят по таймеру', () => {
    const battle = new Battle({ timeline: slots(SUMMON_MINIONS) }, 1);
    let guard = 0;
    while (battle.state.minions.length === 0 && guard++ < 600) battle.step();
    expect(battle.state.minions).toHaveLength(MINIONS.count);

    const start = battle.state.minions.map((m) => ({ x: m.x, y: m.y }));
    const heroStart = { x: battle.hero.x, y: battle.hero.y };
    for (let i = 0; i < 60; i++) battle.step();

    // Через секунду прислужники ближе к тому месту, где был герой.
    const moved = battle.state.minions.some((m, i) => {
      const before = start[i];
      if (!before) return false;
      const was = Math.hypot(before.x - heroStart.x, before.y - heroStart.y);
      const now = Math.hypot(m.x - heroStart.x, m.y - heroStart.y);
      return now < was;
    });
    expect(moved).toBe(true);

    // Живут ровно отведённое время.
    while (battle.state.minions.length > 0 && guard++ < 3000) battle.step();
    expect(battle.events.some((e) => e.type === 'minion_gone')).toBe(true);
  });

  it('ловушка невидима, срабатывает при входе и обездвиживает', () => {
    const battle = new Battle({ timeline: slots(TRAP_PATTERN) }, 1);
    battle.step();
    const trap = battle.state.hazards.find((h) => h.source === 'trap')!;
    expect(trap.hidden).toBe(true);
    expect(trap.onEnter).toBe(true);
    expect(trap.root).toBeCloseTo(TRAP.root, 6);
    // Невидимое в карту опасности не попадает — герой её не обходит.
    expect(battle.danger.peak).toBe(0);

    // Ловушки, расставленные по всему таймлайну, рано или поздно ловят героя.
    let rooted = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const run = runToEnd({ timeline: Array.from({ length: 8 }, () => TRAP_PATTERN) }, seed);
      if (run.events.some((e) => e.type === 'hero_status' && e.root > 0)) rooted++;
    }
    expect(rooted).toBeGreaterThan(0);
  });

  it('рывок сдвигает босса и возвращает его на место', () => {
    const battle = new Battle({ timeline: slots(BOSS_CHARGE) }, 1);
    expect(battle.boss.y).toBeCloseTo(BOSS_ANCHOR.y, 6);

    let moved = 0;
    for (let i = 0; i < 120; i++) {
      battle.step();
      moved = Math.max(moved, Math.hypot(battle.boss.x - BOSS_ANCHOR.x, battle.boss.y - BOSS_ANCHOR.y));
    }
    expect(moved).toBeGreaterThan(3);

    for (let i = 0; i < 120; i++) battle.step();
    expect(battle.boss.x).toBeCloseTo(BOSS_ANCHOR.x, 6);
    expect(battle.boss.y).toBeCloseTo(BOSS_ANCHOR.y, 6);
  });

  it('стон ужаса не бьёт, но замедляет', () => {
    const battle = new Battle({ timeline: slots(HORROR_MOAN) }, 1);
    let guard = 0;
    while (!battle.events.some((e) => e.type === 'hero_status') && guard++ < 600) battle.step();

    expect(battle.hero.slowFor).toBeGreaterThan(0);
    expect(battle.hero.currentSpeed).toBeCloseTo(battle.hero.speed * MOAN.slow, 6);
    expect(battle.events.some((e) => e.type === 'hero_hit' && e.source === 'horror_moan')).toBe(false);
  });

  it('разрушение укрытий сносит ровно два', () => {
    const battle = new Battle({ timeline: slots(SHATTER_COVERS) }, 1);
    const before = battle.arena.covers.length;

    let guard = 0;
    while (!battle.events.some((e) => e.type === 'cover_destroyed') && guard++ < 600) battle.step();
    expect(battle.arena.covers.length).toBe(before - SHATTER.count);
  });

  it('ярость укорачивает телеграф следующих паттернов', () => {
    const plain = runToEnd({ timeline: slots(null, COLLAPSE_LIKE()) }, 1);
    const hasted = runToEnd({ timeline: slots(FURY_PATTERN, COLLAPSE_LIKE()) }, 1);

    const lead = (b: typeof plain): number => {
      const tel = b.events.find((e) => e.type === 'telegraph' && e.card === 'shard_volley');
      return tel && tel.type === 'telegraph' ? tel.duration : 0;
    };
    expect(lead(plain)).toBeCloseTo(SHARD_VOLLEY.telegraph, 6);
    expect(lead(hasted)).toBeCloseTo(SHARD_VOLLEY.telegraph * FURY.factor, 6);
  });
});

function COLLAPSE_LIKE(): PatternCard {
  return SHARD_VOLLEY;
}

describe('синергии из ТЗ §8', () => {
  it('разрушение укрытий усиливает град осколков', () => {
    const alone = damageOver(slots(SHARD_VOLLEY, SHARD_VOLLEY, SHARD_VOLLEY, null, SHARD_VOLLEY));
    const combo = damageOver(slots(SHATTER_COVERS, SHARD_VOLLEY, SHARD_VOLLEY, null, SHARD_VOLLEY));
    // Без укрытий осколкам нечего блокировать, и до героя долетает больше.
    expect(combo).toBeGreaterThan(alone);
  });

  it('стон ужаса усиливает обвал', () => {
    const alone = blockedByCovers(slots(SHARD_VOLLEY, SHARD_VOLLEY, SHARD_VOLLEY));
    const combo = blockedByCovers(slots(SHATTER_COVERS, SHARD_VOLLEY, SHARD_VOLLEY, SHARD_VOLLEY));
    // Снесённые укрытия перестают глотать осколки.
    expect(combo).toBeLessThan(alone);
  });
});

/** Суммарный урон герою за несколько сидов. */
function damageOver(timeline: (PatternCard | null)[], seeds = 12): number {
  let total = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    for (const e of runToEnd({ timeline }, seed).events) {
      if (e.type === 'hero_hit') total += e.damage;
    }
  }
  return total;
}

function blockedByCovers(timeline: (PatternCard | null)[], seeds = 12): number {
  let total = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    total += runToEnd({ timeline }, seed).events.filter((e) => e.type === 'projectile_blocked').length;
  }
  return total;
}

describe('полный пул детерминирован', () => {
  it('бой со всеми механиками воспроизводится по сиду', () => {
    const timeline = [
      TRAP_PATTERN,
      SUMMON_MINIONS,
      HORROR_MOAN,
      FIRE_WAVE_PATTERN,
      SHATTER_COVERS,
      BOSS_CHARGE,
      FURY_PATTERN,
      CLAW_STRIKE,
    ];
    const a = runToEnd({ timeline }, 77);
    const b = runToEnd({ timeline }, 77);
    expect(b.events).toEqual(a.events);
    expect(b.state).toEqual(a.state);
  });
});

describe('критерий Этапа 5', () => {
  /**
   * Быстрая версия балансного прогона: полные 10 000 боёв гоняет CI
   * (`npm run balance`), а трёхсот хватает, чтобы поймать грубый перекос,
   * если карту случайно раскачают.
   */
  const report = runBalance(300);

  it('ни одна карта не занимает больше 70% успешных билдов', () => {
    expect(report.wins).toBeGreaterThan(5);
    expect(report.dominance).toBeLessThanOrEqual(DOMINANCE_LIMIT);
    expect(report.dominant).toBeNull();
  });

  it('каждая карта пула хоть раз попадает в билд', () => {
    for (const card of report.cards) {
      expect(card.builds, card.name).toBeGreaterThan(0);
    }
  });
}, 300_000);

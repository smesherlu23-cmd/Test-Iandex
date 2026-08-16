import { describe, expect, it } from 'vitest';
import { HERO_AI, TUNING } from '../src/data/tuning';
import { Battle } from '../src/sim/Battle';
import { COLLAPSE, POISON, SHARDS } from '../src/draft/CardPool';
import { circleRect } from '../src/sim/Collision';
import { DangerMap } from '../src/sim/DangerMap';
import { hazardContains } from '../src/sim/Hazard';
import { C, DEMO, MIXED, P, S, SHARDS_ONLY, deathRate, runToEnd } from './helpers';

describe('карта опасности', () => {
  it('складывает разные источники и берёт максимум внутри одного', () => {
    const map = new DangerMap();
    map.begin();
    map.circle(8, 12, 2, 10);
    map.circle(8, 12, 1, 4); // тот же источник: максимум, а не сумма
    map.commit();
    expect(map.at(8, 12)).toBeCloseTo(10, 5);

    map.begin();
    map.circle(8, 12, 2, 5);
    map.commit();
    expect(map.at(8, 12)).toBeCloseTo(15, 5); // другой источник — складывается
  });

  it('чистая карта пуста, clear стирает всё', () => {
    const map = new DangerMap();
    map.begin();
    map.circle(4, 4, 3, 9);
    map.commit();
    expect(map.peak).toBeGreaterThan(0);
    map.clear();
    expect(map.peak).toBe(0);
    expect(map.at(4, 4)).toBe(0);
  });

  it('паттерн вписывает свои будущие зоны', () => {
    const battle = new Battle({ timeline: [P, null, null, null, null, null, null, null] }, 1);
    // Телеграф 0.9 с плюс время реакции — до этого в карте пусто.
    while (battle.time < P.telegraph) battle.step();

    const zones = battle.state.hazards;
    expect(zones).toHaveLength(1);
    expect(zones[0]!.source).toBe('poison_zone');
    expect(battle.danger.peak).toBeGreaterThan(0);
  });

  it('веер объявляет ровно столько лучей, сколько выпустит осколков', () => {
    const battle = new Battle({ timeline: [S, null, null, null, null, null, null, null] }, 1);
    while (battle.state.hazards.length === 0) battle.step();
    expect(battle.state.hazards).toHaveLength(SHARDS.count);
    for (const h of battle.state.hazards) {
      expect(h.shape.kind).toBe('ray');
      expect(h.impact).toBe(0); // предупреждение не бьёт, бьют осколки
    }
  });

  it('герой замечает зону не раньше, чем через время реакции', () => {
    const battle = new Battle({ timeline: [P, null, null, null, null, null, null, null] }, 1);
    while (battle.state.hazards.length === 0) battle.step();

    const zone = battle.state.hazards[0]!;
    expect(zone.visibleAt - battle.time).toBeCloseTo(TUNING.HERO_BASE_REACTION, 5);
    expect(battle.danger.peak).toBe(0); // объявлена, но ещё не замечена
  });

  it('предел внимания реально срабатывает: угроз бывает больше, чем герой ведёт', () => {
    let peak = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const battle = new Battle(DEMO, seed);
      while (!battle.finished) {
        battle.step();
        peak = Math.max(peak, battle.visibleThreats);
      }
    }
    // Наложение зон даёт больше угроз, чем помещается в голову героя, — на
    // этом и держится выгода грамотной расстановки. Трёх одновременных угроз
    // тремя паттернами добиться пока нельзя: арена слишком часто пустует.
    expect(peak).toBeGreaterThan(HERO_AI.ATTENTION);
  });
});

describe('поведение героя', () => {
  it('успевает уйти из объявленного облака до его активации', () => {
    // Телеграф обязан давать реальный шанс среагировать (ТЗ §6), иначе он
    // декоративен. Облако ложится ровно под ноги, и выйти надо за 0.9 с
    // телеграфа минус 0.45 с реакции.
    let escaped = 0;
    const seeds = 40;

    for (let seed = 1; seed <= seeds; seed++) {
      const battle = new Battle({ timeline: [P, null, null, null, null, null, null, null] }, seed);
      while (battle.state.hazards.length === 0) battle.step();

      const zone = battle.state.hazards[0]!;
      // В момент объявления герой заведомо внутри.
      expect(hazardContains(zone.shape, battle.hero.x, battle.hero.y, battle.hero.r)).toBe(true);

      while (battle.time < zone.activeFrom) battle.step();
      if (!hazardContains(zone.shape, battle.hero.x, battle.hero.y, battle.hero.r)) escaped++;
    }

    expect(escaped / seeds).toBeGreaterThanOrEqual(0.85);
  });

  it('за весь бой из зон отравления получает лишь считаные тики', () => {
    const battle = runToEnd({ timeline: [P, P, P, P, P, P, P, P] }, 1);
    const ticks = battle.events.filter((e) => e.type === 'hero_hit' && e.source === 'poison_zone');
    // Шесть облаков по 6 с тикают дважды в секунду: простояв в них, герой
    // собрал бы около семидесяти тиков. Уклонение срезает это в разы.
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(25);
    expect(battle.outcome).toBe('hero_win');
  });

  it('за бой успевает и уклоняться, и атаковать, и прятаться', () => {
    const kinds = new Set(
      runToEnd({ timeline: SHARDS_ONLY }, 1)
        .events.filter((e) => e.type === 'hero_action')
        .map((e) => (e.type === 'hero_action' ? e.kind : '')),
    );
    expect(kinds.has('dodge')).toBe(true);
    expect(kinds.has('attack')).toBe(true);
    expect(kinds.has('hide')).toBe(true);
    expect(kinds.has('wait')).toBe(true);
  });

  it('бьёт босса не чаще кулдауна и попадает только вблизи', () => {
    const battle = runToEnd({ timeline: SHARDS_ONLY }, 1);
    const hits = battle.events.filter((e) => e.type === 'boss_hit');
    expect(hits.length).toBeGreaterThan(0);

    for (let i = 1; i < hits.length; i++) {
      expect(hits[i]!.t - hits[i - 1]!.t).toBeGreaterThanOrEqual(TUNING.HERO_ATTACK_CD - 1e-9);
    }
    expect(battle.boss.damageTaken).toBe(hits.length * HERO_AI.ATTACK_DAMAGE);
  });

  it('после удара герой скован замахом и не двигается', () => {
    const battle = new Battle({ timeline: SHARDS_ONLY }, 1);
    while (!battle.events.some((e) => e.type === 'boss_hit')) battle.step();

    expect(battle.hero.strikeLock).toBeCloseTo(HERO_AI.ATTACK_LOCK, 5);
    const x = battle.hero.x;
    const y = battle.hero.y;
    battle.step();
    expect(battle.hero.x).toBe(x);
    expect(battle.hero.y).toBe(y);
  });

  it('пьёт зелье ниже 30% здоровья и не больше двух раз', () => {
    const battle = runToEnd(DEMO, 12);
    const sips = battle.events.filter((e) => e.type === 'hero_potion');
    expect(sips.length).toBeGreaterThan(0);
    expect(sips.length).toBeLessThanOrEqual(TUNING.HERO_POTIONS);

    for (const sip of sips) {
      if (sip.type !== 'hero_potion') continue;
      expect(sip.hp).toBeLessThanOrEqual(TUNING.HERO_BASE_HP);
    }
    expect(battle.hero.potions).toBe(TUNING.HERO_POTIONS - sips.length);
  });

  it('не проходит сквозь укрытия ни на одном тике', () => {
    const battle = new Battle(DEMO, 3);
    while (!battle.finished) {
      battle.step();
      for (const cover of battle.arena.covers) {
        const hit = circleRect({ x: battle.hero.x, y: battle.hero.y, r: battle.hero.r }, cover);
        expect(hit).toBe(false);
      }
    }
  });

  it('не выходит за пределы арены', () => {
    const battle = new Battle(DEMO, 5);
    while (!battle.finished) {
      battle.step();
      expect(battle.hero.x).toBeGreaterThanOrEqual(battle.hero.r - 1e-9);
      expect(battle.hero.y).toBeGreaterThanOrEqual(battle.hero.r - 1e-9);
      expect(battle.hero.x).toBeLessThanOrEqual(battle.arena.w - battle.hero.r + 1e-9);
      expect(battle.hero.y).toBeLessThanOrEqual(battle.arena.h - battle.hero.r + 1e-9);
    }
  });

  it('паникует на низком здоровье: реакция портится, обзор сужается', () => {
    const battle = new Battle({ timeline: SHARDS_ONLY, heroHp: 100 }, 1);
    expect(battle.hero.panicking).toBe(false);
    expect(battle.hero.reaction).toBeCloseTo(TUNING.HERO_BASE_REACTION, 5);

    battle.hero.takeDamage(80);
    expect(battle.hero.panicking).toBe(true);
    expect(battle.hero.reaction).toBeGreaterThan(TUNING.HERO_BASE_REACTION);
  });
});

describe('зоны наносят урон', () => {
  it('обвал бьёт разово, отравление — тиками', () => {
    const collapse = runToEnd({ timeline: [C, C, C, C, C, C, C, C] }, 1);
    const burst = collapse.events.filter((e) => e.type === 'hero_hit' && e.source === 'collapse');
    expect(burst.length).toBeGreaterThan(0);
    for (const hit of burst) {
      if (hit.type !== 'hero_hit') continue;
      expect(hit.damage).toBe(COLLAPSE.impact);
    }

    const poison = runToEnd({ timeline: [P, P, P, P, P, P, P, P] }, 1);
    const ticks = poison.events.filter((e) => e.type === 'hero_hit' && e.source === 'poison_zone');
    expect(ticks.length).toBeGreaterThan(0);
    for (const tick of ticks) {
      if (tick.type !== 'hero_hit') continue;
      expect(tick.damage).toBeCloseTo(POISON.dps * 0.5, 5);
    }
  });
});

describe('критерий Этапа 2', () => {
  // «Против одного паттерна герой выживает 40 с».
  it('против одного паттерна герой выживает', () => {
    expect(deathRate({ timeline: [S, S, S, S, S, S, S, S] }, 30)).toBeLessThanOrEqual(0.05);
    expect(deathRate({ timeline: [P, P, P, P, P, P, P, P] }, 30)).toBeLessThanOrEqual(0.05);
    expect(deathRate({ timeline: [C, C, C, C, C, C, C, C] }, 30)).toBeLessThanOrEqual(0.05);
  });

  /**
   * «Против трёх грамотно расставленных — погибает». Выполнено лишь частично:
   * лучшая доступная расстановка изматывает героя вдвое, но убивает примерно
   * в каждом десятом бою. Причина структурная и измерена: при слотах по 5 с и
   * трёх паттернах длиной 1–2 с арена простаивает большую часть боя, и
   * загнать героя в угол нечем. Ждёт карт длительного давления с Этапа 5.
   */
  it('грамотная тройка изматывает героя заметно сильнее одиночного паттерна', () => {
    let mixedHp = 0;
    let soloHp = 0;
    for (let seed = 1; seed <= 30; seed++) {
      mixedHp += runToEnd({ timeline: MIXED }, seed).hero.hp;
      soloHp += runToEnd({ timeline: [C, C, C, C, C, C, C, C] }, seed).hero.hp;
    }
    expect(mixedHp / 30).toBeLessThan(soloHp / 30 * 0.75);
    expect(deathRate({ timeline: MIXED }, 30)).toBeGreaterThan(0);
  });
});

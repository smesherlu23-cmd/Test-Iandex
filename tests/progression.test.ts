import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { Run } from '../src/core/Run';
import { ABILITY_SCHEDULE, abilitiesGainedAt, heroTier } from '../src/data/heroTiers';
import { HERO_AI, TUNING } from '../src/data/tuning';
import { place } from '../src/draft/Timeline';
import { Battle } from '../src/sim/Battle';
import type { BattleEvent } from '../src/sim/events';
import type { HeroConfig } from '../src/sim/Hero';
import { Hero } from '../src/sim/Hero';
import { Rng } from '../src/sim/Rng';
import { C, MIXED, P, S, SHARDS_ONLY, runToEnd } from './helpers';

/** Герой вне боя: удобно проверять приём урона в отрыве от арены. */
function hero(over: Omit<Partial<HeroConfig>, 'hp' | 'speed' | 'rng'> = {}): Hero {
  return new Hero({ hp: 100, speed: TUNING.HERO_BASE_SPEED, rng: new Rng(1), ...over });
}

describe('уровни героя', () => {
  it('каждая волна: +8% здоровья, +5% урона, −4% реакции', () => {
    const first = heroTier(1);
    expect(first.hp).toBeCloseTo(TUNING.HERO_BASE_HP, 6);
    expect(first.damage).toBeCloseTo(HERO_AI.ATTACK_DAMAGE, 6);
    expect(first.reaction).toBeCloseTo(TUNING.HERO_BASE_REACTION, 6);

    const second = heroTier(2);
    expect(second.hp / first.hp).toBeCloseTo(TUNING.WAVE_HP_SCALE, 6);
    expect(second.damage / first.damage).toBeCloseTo(TUNING.WAVE_DMG_SCALE, 6);
    expect(second.reaction / first.reaction).toBeCloseTo(TUNING.WAVE_REACTION_SCALE, 6);

    // Через десять волн герой заметно крепче и заметно быстрее реагирует.
    const tenth = heroTier(10);
    expect(tenth.hp).toBeGreaterThan(first.hp * 1.9);
    expect(tenth.reaction).toBeLessThan(first.reaction * 0.72);
  });

  it('новая способность каждые три волны', () => {
    expect(ABILITY_SCHEDULE.map((a) => a.id)).toEqual(['dash', 'block', 'parry', 'second_wind']);
    expect(ABILITY_SCHEDULE.map((a) => a.wave)).toEqual([3, 6, 9, 12]);

    expect(heroTier(2).abilities).toEqual([]);
    expect(heroTier(3).abilities).toEqual(['dash']);
    expect(heroTier(8).abilities).toEqual(['dash', 'block']);
    expect(heroTier(12).abilities).toEqual(['dash', 'block', 'parry', 'second_wind']);
  });

  it('анонс выдаётся ровно на волне открытия', () => {
    expect(abilitiesGainedAt(3).map((a) => a.name)).toEqual(['рывок']);
    expect(abilitiesGainedAt(4)).toEqual([]);
    expect(abilitiesGainedAt(9).map((a) => a.id)).toEqual(['parry']);
  });

  it('бой получает уровень волны', () => {
    const run = new Run(1);
    run.wave = 6;
    const config = run.battleConfig();
    expect(config.heroHp).toBeCloseTo(heroTier(6).hp, 6);
    expect(config.heroAbilities).toEqual(['dash', 'block']);

    const battle = new Battle(config, 1);
    expect(battle.hero.maxHp).toBeCloseTo(heroTier(6).hp, 6);
    expect(battle.hero.has('block')).toBe(true);
    expect(battle.hero.has('parry')).toBe(false);
  });
});

describe('знакомство с картами', () => {
  it('растёт за волну, в которой карта сыграла, и упирается в единицу', () => {
    const run = new Run(1);
    const played: BattleEvent[] = [
      { t: 0, type: 'telegraph', slot: 0, card: 'poison_zone', duration: 0.9 },
      { t: 5, type: 'telegraph', slot: 1, card: 'poison_zone', duration: 0.9 },
    ];

    // Две постановки за волну дают один прирост, а не два.
    const result = run.finishWave(played, 'boss_win');
    expect(result.learned).toEqual([{ card: 'poison_zone', familiarity: TUNING.FAMILIARITY_GAIN }]);

    for (let i = 0; i < 20; i++) run.finishWave(played, 'boss_win');
    expect(run.familiarity.poison_zone).toBe(1);
  });

  it('несыгранная карта не запоминается', () => {
    const run = new Run(1);
    run.finishWave([{ t: 0, type: 'telegraph', slot: 0, card: 'collapse', duration: 1.5 }], 'boss_win');
    expect(run.familiarity.collapse).toBeCloseTo(TUNING.FAMILIARITY_GAIN, 6);
    expect(run.familiarity.shard_volley).toBeUndefined();
  });

  it('знакомая карта замечается раньше', () => {
    const fresh = hero();
    expect(fresh.reactionTo('poison_zone')).toBeCloseTo(TUNING.HERO_BASE_REACTION, 6);

    const known = hero({ familiarity: { poison_zone: 0.5 } });
    expect(known.reactionTo('poison_zone')).toBeCloseTo(
      TUNING.HERO_BASE_REACTION * (1 - 0.5 * TUNING.FAMILIARITY_REACTION_FACTOR),
      6,
    );
    // Незнакомая карта по-прежнему застаёт врасплох.
    expect(known.reactionTo('collapse')).toBeCloseTo(TUNING.HERO_BASE_REACTION, 6);
  });

  it('выше порога герой читает атаку сразу по объявлению', () => {
    const veteran = hero({ familiarity: { poison_zone: 0.9 } });
    expect(TUNING.FAMILIARITY_PREDICT_THRESHOLD).toBeLessThan(0.9);
    expect(veteran.reactionTo('poison_zone')).toBe(0);
  });

  it('в бою зона знакомой карты видна без задержки', () => {
    const config = { timeline: [P, null, null, null, null, null, null, null] };
    const naive = new Battle(config, 1);
    while (naive.state.hazards.length === 0) naive.step();

    const veteran = new Battle({ ...config, familiarity: { poison_zone: 1 } }, 1);
    while (veteran.state.hazards.length === 0) veteran.step();

    expect(naive.state.hazards[0]!.visibleAt).toBeGreaterThan(naive.time);
    expect(veteran.state.hazards[0]!.visibleAt).toBeCloseTo(veteran.time, 6);
  });
});

describe('способности героя', () => {
  it('блок срезает половину урона не чаще кулдауна', () => {
    const withBlock = hero({ abilities: ['block'] });
    const first = withBlock.takeDamage(20);
    expect(first.blocked).toBe(true);
    expect(first.amount).toBeCloseTo(20 * (1 - HERO_AI.BLOCK_REDUCTION), 6);

    // Второй удар подряд блокировать нечем.
    const second = withBlock.takeDamage(20);
    expect(second.blocked).toBe(false);
    expect(second.amount).toBe(20);
  });

  it('без способности блока урон проходит целиком', () => {
    const plain = hero();
    const hit = plain.takeDamage(20);
    expect(hit.blocked).toBe(false);
    expect(hit.amount).toBe(20);
    expect(plain.hp).toBe(80);
  });

  it('второе дыхание один раз за бой не даёт умереть', () => {
    const tough = hero({ abilities: ['second_wind'] });
    const lethal = tough.takeDamage(200);
    expect(lethal.secondWind).toBe(true);
    expect(tough.alive).toBe(true);
    expect(tough.hp).toBe(HERO_AI.SECOND_WIND_HP);

    // Второй раз спасать нечем.
    const final = tough.takeDamage(200);
    expect(final.secondWind).toBe(false);
    expect(tough.alive).toBe(false);
  });

  it('парирование гасит удар целиком, но только замеченный', () => {
    // Ничего не видя в карте опасности, герой парировать не может.
    const blind = hero({ abilities: ['parry'] });
    expect(blind.takeDamage(20).parried).toBe(false);

    const battle = new Battle(
      { timeline: MIXED, heroAbilities: ['parry'], heroHp: 400 },
      3,
    );
    while (!battle.finished) battle.step();
    const parries = battle.events.filter((e) => e.type === 'hero_parry');
    expect(parries.length).toBeGreaterThan(0);
  });

  it('рывок уходит в кулдаун, когда герой уклоняется под ударом', () => {
    const battle = new Battle({ timeline: SHARDS_ONLY, heroAbilities: ['dash'] }, 1);
    let dashed = false;
    while (!battle.finished && !dashed) {
      battle.step();
      if (battle.hero.dashCd > 0) dashed = true;
    }
    expect(dashed).toBe(true);
  });

  it('способности не меняют детерминизм', () => {
    const config = { timeline: MIXED, heroAbilities: ['dash', 'block', 'parry'] as const };
    const a = runToEnd(config, 4);
    const b = runToEnd(config, 4);
    expect(b.events).toEqual(a.events);
  });
});

describe('жизни босса и итог волны', () => {
  it('герой выжил — босс теряет жизнь; погиб — не теряет', () => {
    const run = new Run(1);
    expect(run.lives).toBe(TUNING.BOSS_LIVES);

    run.finishWave([], 'boss_win');
    expect(run.lives).toBe(TUNING.BOSS_LIVES);

    run.finishWave([], 'hero_win');
    expect(run.lives).toBe(TUNING.BOSS_LIVES - 1);
    expect(run.over).toBe(false);
  });

  it('три поражения — забег окончен', () => {
    const run = new Run(1);
    for (let i = 0; i < TUNING.BOSS_LIVES; i++) run.finishWave([], 'hero_win');
    expect(run.lives).toBe(0);
    expect(run.over).toBe(true);
  });

  it('итог волны считает урон и лучшую карту', () => {
    const run = new Run(1);
    const events: BattleEvent[] = [
      { t: 1, type: 'telegraph', slot: 0, card: 'poison_zone', duration: 0.9 },
      { t: 2, type: 'telegraph', slot: 1, card: 'collapse', duration: 1.5 },
      { t: 3, type: 'hero_hit', source: 'poison_zone', damage: 4.5, hp: 95 },
      { t: 4, type: 'hero_hit', source: 'collapse', damage: 18, hp: 77 },
      { t: 5, type: 'hero_hit', source: 'collapse', damage: 18, hp: 59 },
    ];

    const result = run.finishWave(events, 'boss_win');
    expect(result.damage).toBeCloseTo(40.5, 6);
    expect(result.bestCard).toBe('collapse');
    expect(result.learned.map((l) => l.card)).toEqual(['collapse', 'poison_zone']);
    expect(result.livesLeft).toBe(TUNING.BOSS_LIVES);
  });

  it('бой без единого попадания даёт пустой итог', () => {
    const result = new Run(1).finishWave([], 'hero_win');
    expect(result.damage).toBe(0);
    expect(result.bestCard).toBeNull();
    expect(result.learned).toEqual([]);
  });
});

describe('цикл с итогом волны', () => {
  it('после боя открывается итог, потом драфт следующей волны', () => {
    const game = new Game(11);
    game.run.take(game.run.offer[0]!);
    place(game.run.timeline, 0, game.run.hand[0]!);

    game.startBattle();
    while (!game.battleFinished) game.step();

    game.closeBattle();
    expect(game.phase === 'result' || game.phase === 'over').toBe(true);
    expect(game.result!.wave).toBe(1);

    if (game.phase === 'result') {
      game.nextWave();
      expect(game.phase).toBe('draft');
      expect(game.run.wave).toBe(2);
      expect(game.battle).toBeNull();
    }
  });

  it('после третьего поражения забег закрывается', () => {
    const game = new Game(12);
    // Пустой таймлайн: герою нечего бояться, босс теряет жизнь каждую волну.
    for (let i = 0; i < TUNING.BOSS_LIVES; i++) {
      game.startBattle();
      while (!game.battleFinished) game.step();
      game.closeBattle();
      if (game.phase === 'result') game.nextWave();
    }

    expect(game.phase).toBe('over');
    expect(game.run.over).toBe(true);
    expect(game.wavesSurvived).toBe(TUNING.BOSS_LIVES);
    // Из закрытого забега шагать некуда.
    game.nextWave();
    expect(game.phase).toBe('over');
  });
});

describe('критерий Этапа 4', () => {
  /**
   * «Средний забег заканчивается на 8–14 волне» не выполняется: измерено 3.1
   * волны. Босс почти никогда не успевает убить героя за 40 с, поэтому теряет
   * три жизни подряд. Причина та же, что и у половины критерия Этапа 2, и она
   * структурная: в пуле три самых уклоняемых паттерна из двенадцати, а карт
   * длительного давления — ловушки, замедления, прислужников — ещё нет.
   * Тест фиксирует замер, чтобы регресс был виден.
   */
  it('забег пока укладывается в три-пять волн', () => {
    const lengths: number[] = [];

    for (let seed = 1; seed <= 12; seed++) {
      const game = new Game(seed);
      let guard = 0;
      while (!game.run.over && guard++ < 40) {
        if (game.run.offer.length > 0) game.run.take(game.run.offer[0]!);
        for (let slot = 0; slot < 8; slot++) {
          place(game.run.timeline, slot, game.run.hand[slot % game.run.hand.length] ?? null);
        }
        game.startBattle();
        let ticks = 0;
        while (!game.battleFinished && ticks++ < 5000) game.step();
        game.closeBattle();
        if (game.phase === 'result') game.nextWave();
      }
      lengths.push(game.wavesSurvived);
    }

    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    expect(avg).toBeGreaterThanOrEqual(TUNING.BOSS_LIVES);
    expect(avg).toBeLessThan(6);
  });

  it('герой растёт быстрее, чем колода из трёх карт', () => {
    // Тот же бой на первой и на десятой волне: к десятой герой уходит целее.
    const build = { timeline: MIXED };
    let early = 0;
    let late = 0;

    for (let seed = 1; seed <= 10; seed++) {
      const t1 = heroTier(1);
      const t10 = heroTier(10);
      const a = runToEnd({ ...build, heroHp: t1.hp, heroReaction: t1.reaction }, seed);
      const b = runToEnd(
        { ...build, heroHp: t10.hp, heroReaction: t10.reaction, heroAbilities: t10.abilities },
        seed,
      );
      early += a.hero.hp / a.hero.maxHp;
      late += b.hero.hp / b.hero.maxHp;
    }

    expect(late).toBeGreaterThan(early);
  });
});

describe('карты уровня', () => {
  it('весь пул отыгрывается на любой волне', () => {
    for (const card of [S, P, C]) {
      const tier = heroTier(9);
      const battle = runToEnd(
        {
          timeline: [card, card, null, card, null, card, card, null],
          heroHp: tier.hp,
          heroReaction: tier.reaction,
          heroAbilities: tier.abilities,
        },
        5,
      );
      expect(battle.finished).toBe(true);
      expect(battle.events.some((e) => e.type === 'telegraph')).toBe(true);
    }
  });
});

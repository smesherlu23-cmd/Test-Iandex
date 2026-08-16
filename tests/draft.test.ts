import { describe, expect, it } from 'vitest';
import { Game } from '../src/core/Game';
import { Run } from '../src/core/Run';
import { TUNING } from '../src/data/tuning';
import type { PoolEntry } from '../src/draft/CardPool';
import { CARD_POOL, availableCards, cardById } from '../src/draft/CardPool';
import { OFFER_SIZE, makeOffer } from '../src/draft/Draft';
import {
  SLOT_COUNT,
  emptyTimeline,
  firedCount,
  isAffordable,
  place,
  planTimeline,
} from '../src/draft/Timeline';
import { Rng } from '../src/sim/Rng';
import { C, P, S, runToEnd } from './helpers';

/** Синтетический пул: с тремя боевыми картами драфт вырожден. */
const BIG_POOL: readonly PoolEntry[] = [
  { card: S, minWave: 1 },
  { card: P, minWave: 1 },
  { card: C, minWave: 2 },
  { card: { ...S, id: 'a', name: 'A' }, minWave: 1 },
  { card: { ...S, id: 'b', name: 'B' }, minWave: 1 },
  { card: { ...S, id: 'c', name: 'C' }, minWave: 5 },
];

describe('пул карт', () => {
  it('карта открывается со своей волны', () => {
    expect(availableCards(1, BIG_POOL).map((c) => c.id)).toEqual(['shard_volley', 'poison_zone', 'a', 'b']);
    expect(availableCards(2, BIG_POOL).map((c) => c.id)).toContain('collapse');
    expect(availableCards(4, BIG_POOL).map((c) => c.id)).not.toContain('c');
    expect(availableCards(5, BIG_POOL).map((c) => c.id)).toContain('c');
  });

  it('карта ищется по id', () => {
    expect(cardById('poison_zone')).toBe(P);
    expect(cardById('нет такой')).toBeNull();
  });

  it('у всех карт пула есть телеграф', () => {
    // ТЗ §6: атака без предупреждения нечестна.
    for (const entry of CARD_POOL) {
      expect(entry.card.telegraph).toBeGreaterThan(0);
      expect(entry.card.cost).toBeGreaterThan(0);
    }
  });
});

describe('драфт', () => {
  it('предлагает три доступные карты', () => {
    const offer = makeOffer(5, [], new Rng(1), { pool: BIG_POOL });
    expect(offer).toHaveLength(OFFER_SIZE);
    expect(new Set(offer.map((c) => c.id)).size).toBe(OFFER_SIZE);
  });

  it('один сид — одно предложение', () => {
    const a = makeOffer(5, [], new Rng(42), { pool: BIG_POOL }).map((c) => c.id);
    const b = makeOffer(5, [], new Rng(42), { pool: BIG_POOL }).map((c) => c.id);
    expect(b).toEqual(a);
  });

  it('разные сиды дают разные предложения', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      seen.add(makeOffer(5, [], new Rng(seed), { pool: BIG_POOL }).map((c) => c.id).join());
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('не предлагает то, что уже в руке', () => {
    const offer = makeOffer(5, [S, P], new Rng(3), { pool: BIG_POOL });
    expect(offer.map((c) => c.id)).not.toContain('shard_volley');
    expect(offer.map((c) => c.id)).not.toContain('poison_zone');
  });

  it('исчерпанный пул даёт короткое или пустое предложение', () => {
    const all = availableCards(1, BIG_POOL);
    expect(makeOffer(1, all.slice(0, 3), new Rng(1), { pool: BIG_POOL })).toHaveLength(1);
    expect(makeOffer(1, all, new Rng(1), { pool: BIG_POOL })).toHaveLength(0);
  });
});

describe('таймлайн', () => {
  it('пустой таймлайн — восемь слотов восстановления', () => {
    const plan = planTimeline(emptyTimeline());
    expect(plan).toHaveLength(SLOT_COUNT);
    expect(plan.every((slot) => slot.card === null)).toBe(true);
    expect(plan.at(-1)!.energyAfter).toBe(
      TUNING.BOSS_ENERGY_START + SLOT_COUNT * TUNING.BOSS_ENERGY_REGEN,
    );
  });

  it('считает энергию по слотам', () => {
    const timeline = emptyTimeline();
    place(timeline, 0, S);
    place(timeline, 1, S);
    const plan = planTimeline(timeline);
    expect(plan.map((s) => s.energyAfter)).toEqual([7, 4, 9, 14, 19, 24, 29, 34]);
    expect(isAffordable(timeline)).toBe(true);
  });

  it('помечает слот, которому не хватит энергии', () => {
    const timeline = emptyTimeline();
    for (let i = 0; i < SLOT_COUNT; i++) place(timeline, i, S);

    const plan = planTimeline(timeline);
    expect(plan.map((s) => s.starved)).toEqual([
      false, false, false, true, false, false, true, false,
    ]);
    expect(isAffordable(timeline)).toBe(false);
    expect(firedCount(timeline)).toBe(6);
  });

  /**
   * Ключевая проверка Этапа 3: экран драфта обязан показывать ровно то, что
   * произойдёт в бою. Прогон энергии в draft/ и правило в sim/Boss — разные
   * реализации, и они не должны разойтись.
   */
  it('прогноз энергии совпадает с боем тик в тик', () => {
    const builds = [
      [S, S, S, S, S, S, S, S],
      [P, P, P, C, null, P, P, C],
      [C, C, C, C, C, C, C, C],
      [S, null, C, P, S, null, P, C],
      emptyTimeline(),
    ];

    for (const timeline of builds) {
      const plan = planTimeline(timeline);
      const battle = runToEnd({ timeline }, 7);
      const slots = battle.events.filter((e) => e.type === 'slot_start');

      expect(slots).toHaveLength(SLOT_COUNT);
      slots.forEach((e, i) => {
        if (e.type !== 'slot_start') return;
        const predicted = plan[i]!;
        expect(e.energy).toBe(predicted.energyAfter);
        expect(e.card).toBe(predicted.starved ? null : (predicted.card?.id ?? null));
      });
    }
  });

  it('за границы таймлайна класть нельзя', () => {
    const timeline = emptyTimeline();
    expect(() => place(timeline, SLOT_COUNT, S)).toThrow(RangeError);
    expect(() => place(timeline, -1, S)).toThrow(RangeError);
  });
});

describe('забег', () => {
  it('карта из предложения уходит в руку', () => {
    const run = new Run(1, BIG_POOL);
    expect(run.offer).toHaveLength(OFFER_SIZE);

    const card = run.offer[0]!;
    run.take(card);
    expect(run.hand).toEqual([card]);
    expect(run.offer).toHaveLength(0);
    expect(() => run.take(card)).toThrow();
  });

  it('рука переживает волну, предложение обновляется', () => {
    const run = new Run(2, BIG_POOL);
    const first = run.offer[0]!;
    run.take(first);
    place(run.timeline, 0, first);

    run.nextWave();
    expect(run.wave).toBe(2);
    expect(run.hand).toEqual([first]);
    // Расстановка остаётся заготовкой на следующую волну.
    expect(run.timeline[0]).toBe(first);
    expect(run.offer.map((c) => c.id)).not.toContain(first.id);
  });

  it('сид боя зависит от волны и воспроизводим', () => {
    const a = new Run(123, BIG_POOL);
    const b = new Run(123, BIG_POOL);
    expect(b.battleSeed()).toBe(a.battleSeed());

    const first = a.battleSeed();
    a.nextWave();
    expect(a.battleSeed()).not.toBe(first);
  });
});

describe('цикл забега', () => {
  it('драфт → бой → драфт крутится без перезапуска', () => {
    const game = new Game(99, BIG_POOL);
    const waves = 4;

    for (let wave = 1; wave <= waves; wave++) {
      expect(game.phase).toBe('draft');
      expect(game.run.wave).toBe(wave);

      if (game.run.offer.length > 0) game.run.take(game.run.offer[0]!);
      const card = game.run.hand[0]!;
      place(game.run.timeline, wave % SLOT_COUNT, card);

      game.startBattle();
      expect(game.phase).toBe('battle');

      let guard = 0;
      while (!game.battleFinished && guard++ < 10_000) game.step();
      expect(game.battleFinished).toBe(true);
      expect(game.battle!.outcome).not.toBeNull();

      game.nextWave();
      expect(game.battle).toBeNull();
      expect(game.lastWave).toBe(wave);
    }

    expect(game.run.wave).toBe(waves + 1);
    expect(game.run.hand.length).toBeGreaterThan(0);
  });

  it('бой идёт по той расстановке, что собрана в драфте', () => {
    const game = new Game(5);
    place(game.run.timeline, 0, P);
    place(game.run.timeline, 3, C);
    game.startBattle();

    while (!game.battleFinished) game.step();
    const cards = game
      .battle!.events.filter((e) => e.type === 'slot_start')
      .map((e) => (e.type === 'slot_start' ? e.card : ''));
    expect(cards[0]).toBe('poison_zone');
    expect(cards[3]).toBe('collapse');
    expect(cards[1]).toBeNull();
  });

  it('в драфте симуляция стоит на месте', () => {
    const game = new Game(7);
    for (let i = 0; i < 100; i++) game.step();
    expect(game.battle).toBeNull();
    expect(game.phase).toBe('draft');
  });
});

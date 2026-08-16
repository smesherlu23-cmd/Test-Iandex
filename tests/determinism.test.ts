import { describe, expect, it } from 'vitest';
import { TICK_RATE, TUNING } from '../src/data/tuning';
import { Battle } from '../src/sim/Battle';
import { hashEvents } from '../src/sim/events';
import { Rng } from '../src/sim/Rng';
import { DEMO, runToEnd } from './helpers';

describe('Rng', () => {
  it('один сид — одна последовательность', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    const seqA = Array.from({ length: 64 }, () => a.next());
    const seqB = Array.from({ length: 64 }, () => b.next());
    expect(seqA).toEqual(seqB);
    expect(a.state).toBe(b.state);
  });

  it('значения лежат в [0, 1)', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('разные сиды расходятся', () => {
    const rngA = new Rng(1);
    const rngB = new Rng(2);
    const a = Array.from({ length: 16 }, () => rngA.next());
    const b = Array.from({ length: 16 }, () => rngB.next());
    expect(a).not.toEqual(b);
  });
});

describe('детерминизм боя', () => {
  // Этап 1, обязательное условие перехода дальше.
  it('два прогона с одним сидом дают идентичный лог событий', () => {
    const first = runToEnd(DEMO, 1337);
    const second = runToEnd(DEMO, 1337);

    expect(second.events).toEqual(first.events);
    expect(hashEvents(second.events)).toBe(hashEvents(first.events));
    expect(second.events.length).toBeGreaterThan(10);
  });

  it('совпадает и финальное состояние, а не только лог', () => {
    const first = runToEnd(DEMO, 4242);
    const second = runToEnd(DEMO, 4242);

    expect(second.state).toEqual(first.state);
    expect(second.rng.state).toBe(first.rng.state);
  });

  // ТЗ §14: 1000 прогонов с одним сидом дают идентичный хеш лога событий.
  // Бой укорочен до 10 с: полные 40 с с ИИ героя стоят ~25 мс на прогон,
  // и тысяча таких растянула бы обычный запуск тестов на полминуты.
  it('1000 прогонов с одним сидом дают один хеш', () => {
    const short = { ...DEMO, maxTime: 10 };
    const expected = hashEvents(runToEnd(short, 99).events);
    for (let i = 0; i < 1000; i++) {
      expect(hashEvents(runToEnd(short, 99).events)).toBe(expected);
    }
  }, 60_000);

  it('разные сиды дают разные бои', () => {
    const hashes = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      hashes.add(hashEvents(runToEnd(DEMO, seed).events));
    }
    expect(hashes.size).toBeGreaterThan(1);
  });

  it('шаг не зависит от размера пачки вызовов', () => {
    const a = new Battle(DEMO, 777);
    const b = new Battle(DEMO, 777);
    while (!a.finished) a.step();
    // Тот же бой, но «досмотренный» рывками — результат обязан совпасть.
    while (!b.finished) {
      for (let i = 0; i < 7 && !b.finished; i++) b.step();
    }
    expect(b.events).toEqual(a.events);
  });

  it('step() после конца боя ничего не меняет', () => {
    const battle = runToEnd(DEMO, 5);
    const snapshot = hashEvents(battle.events);
    const tick = battle.tick;
    for (let i = 0; i < 100; i++) battle.step();
    expect(battle.tick).toBe(tick);
    expect(hashEvents(battle.events)).toBe(snapshot);
  });

  it('бой всегда завершается в пределах отведённого времени', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const battle = runToEnd(DEMO, seed);
      expect(battle.tick).toBeLessThanOrEqual(TUNING.BATTLE_MAX_TIME * TICK_RATE);
      expect(battle.outcome).not.toBeNull();
    }
  });
});

import { describe, expect, it } from 'vitest';
import { BattlePlayer } from '../src/core/BattlePlayer';
import { Game } from '../src/core/Game';
import { FX, TICK_RATE, TUNING } from '../src/data/tuning';
import { place } from '../src/draft/Timeline';
import { Effects } from '../src/render/Effects';
import { Battle } from '../src/sim/Battle';
import type { BattleEvent } from '../src/sim/events';
import { MIXED, P, S, SHARDS_ONLY, runToEnd } from './helpers';

/** Таймлайн, на котором герой заведомо погибает. */
const LETHAL = { timeline: MIXED, heroHp: 26 };
/** Таймлайн, который герой заведомо переживает. */
const SAFE = { timeline: SHARDS_ONLY };

function playToEnd(player: BattlePlayer, cap = 20_000): number {
  let frames = 0;
  while (!player.done && frames++ < cap) player.tick();
  expect(player.done).toBe(true);
  return frames;
}

describe('проигрыватель боя', () => {
  it('на ×1 кадр просмотра равен шагу симуляции', () => {
    const player = new BattlePlayer(SAFE, 1);
    for (let i = 0; i < 60; i++) player.tick();
    expect(player.battle.tick).toBe(60);
  });

  it('скорость ускоряет просмотр, не трогая сам бой', () => {
    const fast = new BattlePlayer(SAFE, 1);
    fast.setSpeed(4);
    for (let i = 0; i < 60; i++) fast.tick();
    expect(fast.battle.tick).toBe(240);

    // Ускорение — это только темп подачи: лог событий обязан совпасть.
    const plain = runToEnd(SAFE, 1);
    const played = new BattlePlayer(SAFE, 1);
    played.setSpeed(4);
    playToEnd(played);
    expect(played.battle.events).toEqual(plain.events);
  });

  it('знает тик смерти заранее по теневому прогону', () => {
    const player = new BattlePlayer(LETHAL, 1);
    expect(player.deathTick).toBeGreaterThan(0);

    const shadow = runToEnd(LETHAL, 1);
    const died = shadow.events.find((e) => e.type === 'hero_died')!;
    expect(player.deathTick).toBe(Math.round(died.t * TICK_RATE));
  });

  it('в бою без смерти замедления нет', () => {
    const player = new BattlePlayer(SAFE, 1);
    expect(player.deathTick).toBe(-1);
    playToEnd(player);
    expect(player.slowMotion).toBe(false);
  });

  it('последние доли секунды перед смертью идут замедленно', () => {
    const player = new BattlePlayer(LETHAL, 1);
    const lead = Math.round(FX.DEATH_SLOWMO_LEAD * TICK_RATE);

    // Доходим до окна замедления.
    while (player.battle.tick < player.deathTick - lead) player.tick();
    expect(player.slowMotion).toBe(false);

    player.tick();
    expect(player.slowMotion).toBe(true);

    // За четыре кадра в замедлении симуляция продвигается на один шаг.
    const before = player.battle.tick;
    for (let i = 0; i < 4; i++) player.tick();
    expect(player.battle.tick - before).toBe(1);
  });

  it('замедление перебивает ×4: смерть не проматывается', () => {
    const player = new BattlePlayer(LETHAL, 1);
    player.setSpeed(4);
    const lead = Math.round(FX.DEATH_SLOWMO_LEAD * TICK_RATE);
    while (player.battle.tick < player.deathTick - lead) player.tick();

    const before = player.battle.tick;
    for (let i = 0; i < 4; i++) player.tick();
    expect(player.battle.tick - before).toBe(1);
  });

  it('после смерти держится пауза, потом просмотр завершается', () => {
    const player = new BattlePlayer(LETHAL, 1);
    while (!player.battle.finished) player.tick();
    expect(player.phase).toBe('pause');
    expect(player.done).toBe(false);

    const pauseFrames = Math.round(TUNING.DEATH_PAUSE * TICK_RATE);
    for (let i = 0; i < pauseFrames - 1; i++) player.tick();
    expect(player.done).toBe(false);
    player.tick();
    expect(player.done).toBe(true);
  });

  it('«пропустить» доматывает бой, но останавливается перед смертью', () => {
    const player = new BattlePlayer(LETHAL, 1);
    player.skip();

    const lead = Math.round(FX.DEATH_SLOWMO_LEAD * TICK_RATE);
    expect(player.battle.finished).toBe(false);
    expect(player.battle.tick).toBe(player.deathTick - lead);
    // Дальше смерть досматривается вживую.
    expect(playToEnd(player)).toBeGreaterThan(lead);
  });

  it('«пропустить» в бою без смерти доматывает до конца', () => {
    const player = new BattlePlayer(SAFE, 1);
    player.skip();
    expect(player.battle.finished).toBe(true);
    expect(player.battle.tick).toBe(TUNING.BATTLE_MAX_TIME * TICK_RATE);
  });

  it('просмотр на любой скорости даёт один и тот же итог', () => {
    for (const speed of [1, 2, 4] as const) {
      const player = new BattlePlayer(LETHAL, 3);
      player.setSpeed(speed);
      playToEnd(player);
      expect(player.battle.outcome).toBe('boss_win');
    }
  });
});

describe('цикл с проигрывателем', () => {
  it('волна закрывается только после паузы', () => {
    const game = new Game(11);
    game.run.take(game.run.offer[0]!);
    place(game.run.timeline, 0, game.run.hand[0]!);
    game.startBattle();

    while (!game.battle!.finished) game.step();
    // Бой кончился, но досмотр ещё идёт.
    expect(game.battleFinished).toBe(false);
    game.closeBattle();
    expect(game.phase).toBe('battle');

    let guard = 0;
    while (!game.battleFinished && guard++ < 600) game.step();
    game.closeBattle();
    expect(game.phase === 'result' || game.phase === 'over').toBe(true);
  });
});

describe('подача', () => {
  const hit: BattleEvent = { t: 1, type: 'hero_hit', source: 'claw', damage: 10, hp: 90 };

  it('подписи выходят по одной и не чаще четырёх в секунду', () => {
    const fx = new Effects();
    // Четыре повода для подписи в один тик.
    fx.consume(
      [
        { t: 1, type: 'hero_parry', source: 'claw' },
        { t: 1, type: 'hero_block', source: 'claw', damage: 5 },
        { t: 1, type: 'hero_potion', hp: 60, left: 1 },
        { t: 1, type: 'hero_second_wind', hp: 25 },
      ],
      8,
      12,
    );

    fx.update(TUNING.FIXED_DT);
    expect(fx.labelCount).toBe(1);

    // Следующая подпись не выйдет раньше интервала.
    fx.consume([{ t: 2, type: 'hero_potion', hp: 60, left: 0 }], 8, 12);
    fx.update(FX.LABEL_INTERVAL / 2);
    expect(fx.labelCount).toBe(1);
    fx.update(FX.LABEL_INTERVAL);
    expect(fx.labelCount).toBe(2);
  });

  it('тряска нарастает от попаданий и затухает', () => {
    const fx = new Effects();
    expect(fx.shake).toBe(0);

    fx.consume([hit], 8, 12);
    const peak = fx.shake;
    expect(peak).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) fx.update(TUNING.FIXED_DT);
    expect(fx.shake).toBeLessThan(peak * 0.5);
  });

  it('смерть героя трясёт экран сильнее всего', () => {
    const fx = new Effects();
    fx.consume([{ t: 5, type: 'hero_died', x: 8, y: 12 }], 8, 12);
    expect(fx.shake).toBe(FX.SHAKE_MAX);
  });

  it('clear возвращает слой в исходное состояние', () => {
    const fx = new Effects();
    fx.consume([hit, { t: 5, type: 'hero_died', x: 8, y: 12 }], 8, 12);
    fx.update(TUNING.FIXED_DT);
    expect(fx.shake).toBeGreaterThan(0);

    fx.clear();
    expect(fx.shake).toBe(0);
    expect(fx.labelCount).toBe(0);
  });

  it('одинаковый бой даёт одинаковую картинку', () => {
    // Частицы берут собственный seeded-генератор, а не Math.random.
    const battle = runToEnd({ timeline: [P, S, null, P, S, null, P, S] }, 9);
    const render = (): number => {
      const fx = new Effects();
      fx.consume(battle.events, 8, 12);
      for (let i = 0; i < 30; i++) fx.update(TUNING.FIXED_DT);
      return fx.shake;
    };
    expect(render()).toBe(render());
  });
});

describe('симуляция не знает о подаче', () => {
  it('лог боя не зависит от того, смотрят его или нет', () => {
    const direct = new Battle(LETHAL, 5);
    while (!direct.finished) direct.step();

    const watched = new BattlePlayer(LETHAL, 5);
    watched.setSpeed(2);
    playToEnd(watched);

    expect(watched.battle.events).toEqual(direct.events);
  });
});

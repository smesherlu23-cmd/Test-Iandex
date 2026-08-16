import type { BattleConfig } from '../src/sim/Battle';
import { Battle } from '../src/sim/Battle';
import { SHARD_VOLLEY } from '../src/sim/Boss';

/** Потолок на случай, если бой перестанет завершаться: тест должен падать, а не висеть. */
const TICK_GUARD = 10_000;

export const P = SHARD_VOLLEY;

/** Таймлайн демо-боя: паттерны вперемешку с восстановлением энергии. */
export const DEMO_TIMELINE = [P, P, P, null, P, null, P, P] as const;

export const DEMO: BattleConfig = { timeline: DEMO_TIMELINE };

export function runToEnd(config: BattleConfig, seed: number): Battle {
  const battle = new Battle(config, seed);
  let guard = 0;
  while (!battle.finished && guard++ < TICK_GUARD) battle.step();
  if (!battle.finished) throw new Error(`Бой не завершился за ${TICK_GUARD} тиков`);
  return battle;
}

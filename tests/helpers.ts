import type { BattleConfig } from '../src/sim/Battle';
import { Battle } from '../src/sim/Battle';
import { COLLAPSE_PATTERN, POISON_ZONE, SHARD_VOLLEY } from '../src/sim/Boss';

/** Потолок на случай, если бой перестанет завершаться: тест должен падать, а не висеть. */
const TICK_GUARD = 10_000;

export const S = SHARD_VOLLEY;
export const P = POISON_ZONE;
export const C = COLLAPSE_PATTERN;

/** Один паттерн на весь таймлайн: по ТЗ §11 такое герой обязан пережить. */
export const SHARDS_ONLY = [S, S, S, null, S, null, S, S] as const;

/** Три паттерна с наложением зон — самая опасная расстановка из доступных. */
export const MIXED = [P, P, P, C, null, P, P, C] as const;

export const DEMO: BattleConfig = { timeline: MIXED };

export function runToEnd(config: BattleConfig, seed: number): Battle {
  const battle = new Battle(config, seed);
  let guard = 0;
  while (!battle.finished && guard++ < TICK_GUARD) battle.step();
  if (!battle.finished) throw new Error(`Бой не завершился за ${TICK_GUARD} тиков`);
  return battle;
}

/** Прогоняет диапазон сидов и считает, сколько раз герой погиб. */
export function deathRate(config: BattleConfig, seeds: number): number {
  let deaths = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    if (runToEnd(config, seed).outcome === 'boss_win') deaths++;
  }
  return deaths / seeds;
}

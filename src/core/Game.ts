import type { PoolEntry } from '../draft/CardPool';
import type { BattleOutcome } from '../sim/Battle';
import { Battle } from '../sim/Battle';
import { Run } from './Run';

/**
 * Автомат забега. Мета-меню, итог волны и экран забега появятся на Этапах 4 и 7;
 * пока цикл состоит из двух состояний: драфт и бой.
 */
export type GamePhase = 'draft' | 'battle';

export class Game {
  readonly run: Run;
  phase: GamePhase = 'draft';
  battle: Battle | null = null;
  /** Исход прошлой волны — показывается в шапке драфта. */
  lastOutcome: BattleOutcome | null = null;
  lastWave = 0;

  constructor(seed: number, pool?: readonly PoolEntry[]) {
    this.run = pool ? new Run(seed, pool) : new Run(seed);
  }

  /** Запустить бой по текущей расстановке. */
  startBattle(): void {
    if (this.phase === 'battle') return;
    this.battle = new Battle({ timeline: this.run.timeline }, this.run.battleSeed());
    this.phase = 'battle';
  }

  /** Один шаг симуляции; в драфте ничего не делает. */
  step(): void {
    if (this.phase === 'battle') this.battle?.step();
  }

  get battleFinished(): boolean {
    return this.phase === 'battle' && (this.battle?.finished ?? false);
  }

  /** Итог волны просмотрен: следующая волна и новый драфт. */
  nextWave(): void {
    if (!this.battleFinished) return;
    this.lastOutcome = this.battle?.outcome ?? null;
    this.lastWave = this.run.wave;
    this.battle = null;
    this.phase = 'draft';
    this.run.nextWave();
  }
}

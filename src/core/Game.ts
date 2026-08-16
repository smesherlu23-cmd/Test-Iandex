import type { PoolEntry } from '../draft/CardPool';
import { Battle } from '../sim/Battle';
import type { WaveResult } from './Run';
import { Run } from './Run';

/**
 * Автомат забега: драфт → бой → итог волны → драфт, и так до потери третьей
 * жизни босса. Мета-меню и экран забега появятся на Этапе 7.
 */
export type GamePhase = 'draft' | 'battle' | 'result' | 'over';

export class Game {
  readonly run: Run;
  phase: GamePhase = 'draft';
  battle: Battle | null = null;
  /** Итог последней волны — его показывает ResultScreen. */
  result: WaveResult | null = null;

  constructor(seed: number, pool?: readonly PoolEntry[]) {
    this.run = pool ? new Run(seed, pool) : new Run(seed);
  }

  /** Запустить бой по текущей расстановке. */
  startBattle(): void {
    if (this.phase !== 'draft') return;
    this.battle = new Battle(this.run.battleConfig(), this.run.battleSeed());
    this.phase = 'battle';
  }

  /** Один шаг симуляции; вне боя ничего не делает. */
  step(): void {
    if (this.phase === 'battle') this.battle?.step();
  }

  get battleFinished(): boolean {
    return this.phase === 'battle' && (this.battle?.finished ?? false);
  }

  /** Бой досмотрен: свести итог волны и решить, продолжается ли забег. */
  closeBattle(): void {
    const battle = this.battle;
    if (!this.battleFinished || !battle || !battle.outcome) return;

    this.result = this.run.finishWave(battle.events, battle.outcome);
    this.phase = this.run.over ? 'over' : 'result';
  }

  /** Итог волны прочитан: следующая волна и новый драфт. */
  nextWave(): void {
    if (this.phase !== 'result') return;
    this.battle = null;
    this.run.nextWave();
    this.phase = 'draft';
  }

  /** Сколько волн босс выдержал — метрика забега для лидерборда (ТЗ §7). */
  get wavesSurvived(): number {
    return this.result ? this.result.wave : 0;
  }
}

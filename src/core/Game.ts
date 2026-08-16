import type { PoolEntry } from '../draft/CardPool';
import type { Battle } from '../sim/Battle';
import type { PlaybackSpeed } from './BattlePlayer';
import { BattlePlayer } from './BattlePlayer';
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
  /** Проигрыватель боя: скорость просмотра и замедление смерти. */
  player: BattlePlayer | null = null;
  /** Итог последней волны — его показывает ResultScreen. */
  result: WaveResult | null = null;

  constructor(seed: number, pool?: readonly PoolEntry[]) {
    this.run = pool ? new Run(seed, pool) : new Run(seed);
  }

  /** Бой текущей волны, пока он идёт. */
  get battle(): Battle | null {
    return this.player?.battle ?? null;
  }

  /** Запустить бой по текущей расстановке. */
  startBattle(): void {
    if (this.phase !== 'draft') return;
    this.player = new BattlePlayer(this.run.battleConfig(), this.run.battleSeed());
    this.phase = 'battle';
  }

  /** Один кадр просмотра; вне боя ничего не делает. */
  step(): void {
    if (this.phase === 'battle') this.player?.tick();
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.player?.setSpeed(speed);
  }

  /** «Пропустить до конца»: смерть героя всё равно досматривается. */
  skipBattle(): void {
    this.player?.skip();
  }

  /** Бой досмотрен целиком — вместе с замедлением и паузой. */
  get battleFinished(): boolean {
    return this.phase === 'battle' && (this.player?.done ?? false);
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
    this.player = null;
    this.run.nextWave();
    this.phase = 'draft';
  }

  /** Сколько волн босс выдержал — метрика забега для лидерборда (ТЗ §7). */
  get wavesSurvived(): number {
    return this.result ? this.result.wave : 0;
  }
}

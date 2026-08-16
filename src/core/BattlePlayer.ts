import { FX, TICK_RATE, TUNING } from '../data/tuning';
import type { BattleConfig } from '../sim/Battle';
import { Battle } from '../sim/Battle';

/** Скорость просмотра боя (ТЗ §7). */
export type PlaybackSpeed = 1 | 2 | 4;

export type PlaybackPhase = 'playing' | 'slowmo' | 'pause' | 'done';

/**
 * Проигрыватель боя: сам бой идёт фиксированным шагом, а этот слой решает,
 * сколько шагов сделать за кадр. Игрок управляет только скоростью просмотра и
 * кнопкой «пропустить до конца» (ТЗ §7).
 *
 * Момент смерти известен заранее: симуляция детерминирована, поэтому теневой
 * прогон того же {config, seed} до начала просмотра говорит точный тик гибели.
 * Благодаря этому последние доли секунды перед смертью играются замедленно —
 * иначе замедлять было бы уже нечего, бой к этому моменту закончен.
 */
export class BattlePlayer {
  readonly battle: Battle;
  /** Тик, на котором погибнет герой; -1, если он выживет. */
  readonly deathTick: number;

  speed: PlaybackSpeed = 1;
  phase: PlaybackPhase = 'playing';

  /** Дробный остаток шагов симуляции — скорость может быть меньше единицы. */
  private carry = 0;
  private pauseLeft = 0;

  constructor(config: BattleConfig, seed: number) {
    this.battle = new Battle(config, seed);
    this.deathTick = findDeathTick(config, seed);
  }

  get done(): boolean {
    return this.phase === 'done';
  }

  /** Идёт ли сейчас замедление перед смертью — рендер подсвечивает этот момент. */
  get slowMotion(): boolean {
    return this.phase === 'slowmo';
  }

  /** Один кадр реального времени: 1/60 с. */
  tick(): void {
    if (this.phase === 'done') return;

    if (this.phase === 'pause') {
      this.pauseLeft -= TUNING.FIXED_DT;
      if (this.pauseLeft <= 0) this.phase = 'done';
      return;
    }

    this.phase = this.inDeathWindow() ? 'slowmo' : 'playing';
    // Замедление перебивает выбранную скорость: на ×4 таймлайн ускоряется,
    // а момент смерти всё равно проигрывается медленно (ТЗ §10).
    this.carry += this.phase === 'slowmo' ? TUNING.DEATH_SLOWMO : this.speed;

    while (this.carry >= 1 && !this.battle.finished) {
      this.battle.step();
      this.carry -= 1;
    }
    if (this.battle.finished) this.finish();
  }

  /** «Пропустить до конца»: доматывает бой, но смерть досматривается вживую. */
  skip(): void {
    if (this.phase === 'done') return;
    const stopAt = this.deathTick >= 0 ? this.deathTick - this.leadTicks() : Number.POSITIVE_INFINITY;

    while (!this.battle.finished && this.battle.tick < stopAt) this.battle.step();

    this.carry = 0;
    this.speed = 1;
    if (this.battle.finished) this.finish();
  }

  setSpeed(speed: PlaybackSpeed): void {
    this.speed = speed;
  }

  private finish(): void {
    if (this.phase === 'pause' || this.phase === 'done') return;
    // Пауза перед экраном итога — награда игрока, она есть и при победе героя.
    this.pauseLeft = this.battle.outcome === 'boss_win' ? TUNING.DEATH_PAUSE : FX.WIN_PAUSE;
    this.phase = 'pause';
  }

  private leadTicks(): number {
    return Math.round(FX.DEATH_SLOWMO_LEAD * TICK_RATE);
  }

  private inDeathWindow(): boolean {
    if (this.deathTick < 0) return false;
    return this.battle.tick >= this.deathTick - this.leadTicks();
  }
}

/** Теневой прогон: узнаём тик смерти, ничего не показывая. */
function findDeathTick(config: BattleConfig, seed: number): number {
  const shadow = new Battle(config, seed);
  while (!shadow.finished) shadow.step();
  if (shadow.outcome !== 'boss_win') return -1;

  const died = shadow.events.find((e) => e.type === 'hero_died');
  return died ? Math.round(died.t * TICK_RATE) : -1;
}

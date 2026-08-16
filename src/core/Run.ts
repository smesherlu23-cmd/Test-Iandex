import type { PoolEntry } from '../draft/CardPool';
import { CARD_POOL } from '../draft/CardPool';
import { makeOffer } from '../draft/Draft';
import type { Timeline } from '../draft/Timeline';
import { emptyTimeline } from '../draft/Timeline';
import type { PatternCard } from '../sim/Boss';
import { Rng } from '../sim/Rng';

/**
 * Состояние забега: волна, рука и расстановка. Жизни босса, реликвии и
 * мета-прогрессия появятся на Этапах 4 и 7.
 */
export class Run {
  readonly seed: number;
  wave = 1;
  /** Карты в руке переиспользуемы: одну можно положить хоть во все слоты. */
  readonly hand: PatternCard[] = [];
  timeline: Timeline = emptyTimeline();
  /** Текущее предложение драфта; пустое, когда пул исчерпан. */
  offer: readonly PatternCard[] = [];

  private readonly rng: Rng;
  private readonly pool: readonly PoolEntry[];

  constructor(seed: number, pool: readonly PoolEntry[] = CARD_POOL) {
    this.seed = seed >>> 0;
    this.pool = pool;
    this.rng = new Rng(this.seed);
    this.rollOffer();
  }

  /** Сформировать предложение для текущей волны. */
  rollOffer(): void {
    this.offer = makeOffer(this.wave, this.hand, this.rng, { pool: this.pool });
  }

  /** Взять карту из предложения в руку. */
  take(card: PatternCard): void {
    if (!this.offer.includes(card)) throw new Error(`Карты ${card.id} нет в предложении`);
    this.hand.push(card);
    this.offer = [];
  }

  /**
   * Сид боя выводится из сида забега и номера волны: бой воспроизводим, и при
   * этом драфт не сдвигает его своими бросками.
   */
  battleSeed(): number {
    return (this.seed ^ Math.imul(this.wave, 0x9e3779b1)) >>> 0;
  }

  /**
   * Следующая волна. Расстановка сохраняется как заготовка — переставить её
   * игрок волен каждую волну, но начинать каждый раз с нуля незачем.
   */
  nextWave(): void {
    this.wave++;
    this.rollOffer();
  }
}

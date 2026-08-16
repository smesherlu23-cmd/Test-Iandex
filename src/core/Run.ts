import type { HeroTier } from '../data/heroTiers';
import { abilitiesGainedAt, heroTier } from '../data/heroTiers';
import type { HeroAbilityInfo } from '../data/heroTiers';
import { TUNING } from '../data/tuning';
import type { PoolEntry } from '../draft/CardPool';
import { CARD_POOL } from '../draft/CardPool';
import { makeOffer } from '../draft/Draft';
import type { Timeline } from '../draft/Timeline';
import { emptyTimeline } from '../draft/Timeline';
import type { BattleConfig, BattleOutcome } from '../sim/Battle';
import type { PatternCard } from '../sim/Boss';
import type { BattleEvent } from '../sim/events';
import { Rng } from '../sim/Rng';

/** Итог волны: сколько урона, какая карта сработала лучше, что герой выучил. */
export interface WaveResult {
  readonly wave: number;
  readonly outcome: BattleOutcome;
  /** Урон, нанесённый герою за волну. */
  readonly damage: number;
  /** Карта, снявшая больше всех здоровья. */
  readonly bestCard: string | null;
  /** Карты, знакомство с которыми выросло, и их новое значение. */
  readonly learned: readonly { readonly card: string; readonly familiarity: number }[];
  readonly livesLeft: number;
}

/**
 * Состояние забега: волна, жизни босса, рука, расстановка и то, что герой
 * успел выучить. Реликвии и мета-прогрессия появятся на Этапе 7.
 */
export class Run {
  readonly seed: number;
  wave = 1;
  /** Три поражения — забег окончен (ТЗ §7). */
  lives = TUNING.BOSS_LIVES;
  /** Карты в руке переиспользуемы: одну можно положить хоть во все слоты. */
  readonly hand: PatternCard[] = [];
  timeline: Timeline = emptyTimeline();
  /** Текущее предложение драфта; пустое, когда пул исчерпан. */
  offer: readonly PatternCard[] = [];
  /** Знакомство героя с картами, 0..1 (ТЗ §6). */
  readonly familiarity: Record<string, number> = {};

  private readonly rng: Rng;
  private readonly pool: readonly PoolEntry[];

  constructor(seed: number, pool: readonly PoolEntry[] = CARD_POOL) {
    this.seed = seed >>> 0;
    this.pool = pool;
    this.rng = new Rng(this.seed);
    this.rollOffer();
  }

  get over(): boolean {
    return this.lives <= 0;
  }

  /** Уровень героя на текущей волне. */
  get tier(): HeroTier {
    return heroTier(this.wave);
  }

  /** Способности, открывшиеся именно на этой волне — для анонса в драфте. */
  get newAbilities(): readonly HeroAbilityInfo[] {
    return abilitiesGainedAt(this.wave);
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

  /** Настройки боя текущей волны: расстановка плюс уровень и память героя. */
  battleConfig(): BattleConfig {
    const tier = this.tier;
    return {
      timeline: this.timeline,
      heroHp: tier.hp,
      heroReaction: tier.reaction,
      heroDamage: tier.damage,
      heroAbilities: tier.abilities,
      familiarity: this.familiarity,
    };
  }

  /**
   * Сид боя выводится из сида забега и номера волны: бой воспроизводим, и при
   * этом драфт не сдвигает его своими бросками.
   */
  battleSeed(): number {
    return (this.seed ^ Math.imul(this.wave, 0x9e3779b1)) >>> 0;
  }

  /**
   * Свести итог волны: посчитать урон, поднять знакомство с сыгранными картами
   * и списать жизнь босса, если герой выжил.
   */
  finishWave(events: readonly BattleEvent[], outcome: BattleOutcome): WaveResult {
    const damageByCard = new Map<string, number>();
    const played = new Set<string>();

    for (const e of events) {
      if (e.type === 'hero_hit') {
        damageByCard.set(e.source, (damageByCard.get(e.source) ?? 0) + e.damage);
      } else if (e.type === 'telegraph') {
        played.add(e.card);
      }
    }

    let bestCard: string | null = null;
    let bestDamage = 0;
    for (const [card, damage] of damageByCard) {
      if (damage > bestDamage) {
        bestDamage = damage;
        bestCard = card;
      }
    }

    // Знакомство растёт за волну, в которой карта сыграла, а не за каждый
    // её запуск: иначе спам одной картой упёрся бы в потолок за один бой и
    // давление на ротацию билда исчезло бы.
    const learned = [...played].sort().map((card) => {
      const next = Math.min(1, (this.familiarity[card] ?? 0) + TUNING.FAMILIARITY_GAIN);
      this.familiarity[card] = next;
      return { card, familiarity: next };
    });

    if (outcome === 'hero_win') this.lives--;

    return {
      wave: this.wave,
      outcome,
      damage: [...damageByCard.values()].reduce((a, b) => a + b, 0),
      bestCard,
      learned,
      livesLeft: this.lives,
    };
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

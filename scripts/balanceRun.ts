import { heroTier } from '../src/data/heroTiers';
import { TUNING } from '../src/data/tuning';
import type { PoolEntry } from '../src/draft/CardPool';
import { CARD_POOL } from '../src/draft/CardPool';
import { SLOT_COUNT, emptyTimeline } from '../src/draft/Timeline';
import { Battle } from '../src/sim/Battle';
import type { PatternCard } from '../src/sim/Boss';
import { Rng } from '../src/sim/Rng';

/** Доля успешных билдов, выше которой карта считается обязательной (ТЗ §11). */
export const DOMINANCE_LIMIT = 0.7;
/** Разброс винрейта, за который выходить не следует (ТЗ §14). */
export const SPREAD_LIMIT = 0.25;

export interface CardStat {
  readonly id: string;
  readonly name: string;
  builds: number;
  wins: number;
  damage: number;
}

export interface BalanceReport {
  readonly battles: number;
  readonly wins: number;
  readonly cards: readonly CardStat[];
  /** Максимальная доля успешных билдов, занятая одной картой. */
  readonly dominance: number;
  readonly dominant: CardStat | null;
  readonly spread: number;
  readonly perWave: readonly { readonly wave: number; readonly battles: number; readonly wins: number }[];
}

/** Случайный билд: рука из нескольких карт и плотная расстановка. */
function randomBuild(rng: Rng, wave: number): (PatternCard | null)[] {
  const available = CARD_POOL.filter((e: PoolEntry) => e.minWave <= wave).map((e) => e.card);
  const handSize = 2 + rng.int(3); // 2..4 карты в руке, как к середине забега
  const hand: PatternCard[] = [];
  const bag = [...available];
  for (let i = 0; i < handSize && bag.length > 0; i++) {
    hand.push(bag.splice(rng.int(bag.length), 1)[0]!);
  }

  const timeline = emptyTimeline();
  let energy = TUNING.BOSS_ENERGY_START;
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const affordable = hand.filter((c) => c.cost <= energy);
    // Пустой слот тоже вариант: он копит энергию на что-то дорогое.
    if (affordable.length === 0 || rng.next() < 0.15) {
      energy += TUNING.BOSS_ENERGY_REGEN;
      continue;
    }
    const card = affordable[rng.int(affordable.length)]!;
    timeline[slot] = card;
    energy -= card.cost;
  }
  return timeline;
}

/** Прогон случайных билдов по случайным волнам. Полностью детерминирован по сиду. */
export function runBalance(battles: number, seed = 20240517, maxWave = 12): BalanceReport {
  const stats = new Map<string, CardStat>();
  for (const entry of CARD_POOL) {
    stats.set(entry.card.id, { id: entry.card.id, name: entry.card.name, builds: 0, wins: 0, damage: 0 });
  }

  const rng = new Rng(seed);
  const waves = new Map<number, { wave: number; battles: number; wins: number }>();
  let wins = 0;

  for (let i = 0; i < battles; i++) {
    const wave = 1 + rng.int(maxWave);
    const tier = heroTier(wave);
    const battle = new Battle(
      {
        timeline: randomBuild(rng, wave),
        heroHp: tier.hp,
        heroReaction: tier.reaction,
        heroDamage: tier.damage,
        heroAbilities: tier.abilities,
      },
      rng.int(0x7fffffff),
    );
    while (!battle.finished) battle.step();

    const won = battle.outcome === 'boss_win';
    if (won) wins++;

    const waveStat = waves.get(wave) ?? { wave, battles: 0, wins: 0 };
    waveStat.battles++;
    if (won) waveStat.wins++;
    waves.set(wave, waveStat);

    // Карта считается участником билда, если реально сыграла хоть раз.
    const played = new Set<string>();
    const damageBy = new Map<string, number>();
    for (const e of battle.events) {
      if (e.type === 'telegraph') played.add(e.card);
      else if (e.type === 'hero_hit') damageBy.set(e.source, (damageBy.get(e.source) ?? 0) + e.damage);
    }
    for (const id of played) {
      const stat = stats.get(id);
      if (!stat) continue;
      stat.builds++;
      if (won) stat.wins++;
      stat.damage += damageBy.get(id) ?? 0;
    }
  }

  const cards = [...stats.values()].sort(
    (a, b) => b.wins / Math.max(1, b.builds) - a.wins / Math.max(1, a.builds),
  );

  let dominance = 0;
  let dominant: CardStat | null = null;
  for (const card of cards) {
    const share = wins > 0 ? card.wins / wins : 0;
    if (share > dominance) {
      dominance = share;
      dominant = card;
    }
  }

  const rates = cards.filter((c) => c.builds > 50).map((c) => c.wins / c.builds);
  const spread = rates.length > 0 ? Math.max(...rates) - Math.min(...rates) : 0;

  return {
    battles,
    wins,
    cards,
    dominance,
    dominant: dominance > DOMINANCE_LIMIT ? dominant : null,
    spread,
    perWave: [...waves.values()].sort((a, b) => a.wave - b.wave),
  };
}

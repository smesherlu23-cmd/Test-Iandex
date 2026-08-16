import type { PatternCard } from '../sim/Boss';
import type { Rng } from '../sim/Rng';
import type { PoolEntry } from './CardPool';
import { CARD_POOL, availableCards } from './CardPool';

/** Сколько карт показывается игроку за раз (ТЗ §7). */
export const OFFER_SIZE = 3;

export interface DraftOptions {
  readonly size?: number;
  readonly pool?: readonly PoolEntry[];
}

/**
 * Предложение драфта: случайные карты из пула, доступного по текущей волне.
 *
 * Уже взятые карты не предлагаются повторно: карта в руке переиспользуема и
 * её можно положить хоть во все восемь слотов, поэтому второй экземпляр не
 * дал бы игроку ничего. Если пул исчерпан, предложение окажется коротким или
 * пустым — с тремя картами это наступает уже к третьей волне.
 */
export function makeOffer(
  wave: number,
  owned: readonly PatternCard[],
  rng: Rng,
  options: DraftOptions = {},
): PatternCard[] {
  const size = options.size ?? OFFER_SIZE;
  const pool = options.pool ?? CARD_POOL;
  const ownedIds = new Set(owned.map((card) => card.id));
  const candidates = availableCards(wave, pool).filter((card) => !ownedIds.has(card.id));

  shuffle(candidates, rng);
  return candidates.slice(0, size);
}

/** Тасование Фишера—Йетса на seeded-RNG: одинаковый сид даёт одинаковый драфт. */
function shuffle(cards: PatternCard[], rng: Rng): void {
  for (let i = cards.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const a = cards[i]!;
    cards[i] = cards[j]!;
    cards[j] = a;
  }
}

import { TUNING } from '../data/tuning';
import type { PatternCard } from '../sim/Boss';

export const SLOT_COUNT = TUNING.TIMELINE_SLOTS;

/** Восемь слотов по 5 с; null — босс восстанавливает энергию и уязвим. */
export type Timeline = (PatternCard | null)[];

export function emptyTimeline(): Timeline {
  return Array.from({ length: SLOT_COUNT }, () => null);
}

export interface SlotPlan {
  readonly slot: number;
  readonly card: PatternCard | null;
  readonly energyBefore: number;
  readonly energyAfter: number;
  /** Карта положена, но энергии не хватит — слот выродится в восстановление. */
  readonly starved: boolean;
}

/**
 * Прогон энергии по слотам по тем же правилам, что и Boss.beginSlot: карта
 * исполняется, если энергии хватает, иначе слот превращается в восстановление.
 * Правило продублировано здесь намеренно — драфт обязан показать игроку ровно
 * то, что произойдёт в бою, и тест сверяет обе реализации между собой.
 */
export function planTimeline(
  timeline: readonly (PatternCard | null)[],
  startEnergy: number = TUNING.BOSS_ENERGY_START,
): SlotPlan[] {
  const plan: SlotPlan[] = [];
  let energy = startEnergy;

  for (let slot = 0; slot < timeline.length; slot++) {
    const card = timeline[slot] ?? null;
    const energyBefore = energy;

    if (card && energy >= card.cost) {
      energy -= card.cost;
      plan.push({ slot, card, energyBefore, energyAfter: energy, starved: false });
      continue;
    }

    energy += TUNING.BOSS_ENERGY_REGEN;
    plan.push({ slot, card, energyBefore, energyAfter: energy, starved: card !== null });
  }

  return plan;
}

/** Ни одна положенная карта не останется без энергии. */
export function isAffordable(
  timeline: readonly (PatternCard | null)[],
  startEnergy: number = TUNING.BOSS_ENERGY_START,
): boolean {
  return planTimeline(timeline, startEnergy).every((slot) => !slot.starved);
}

/** Сколько карт реально сработает. */
export function firedCount(
  timeline: readonly (PatternCard | null)[],
  startEnergy: number = TUNING.BOSS_ENERGY_START,
): number {
  return planTimeline(timeline, startEnergy).filter((slot) => slot.card && !slot.starved).length;
}

export function place(timeline: Timeline, slot: number, card: PatternCard | null): void {
  if (slot < 0 || slot >= timeline.length) throw new RangeError(`Нет слота ${slot}`);
  timeline[slot] = card;
}

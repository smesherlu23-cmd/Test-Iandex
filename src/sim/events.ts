import type { BattleOutcome } from './Battle';

/**
 * Тело события без времени: время проставляет Battle при записи в лог.
 * Порядок ключей в литералах фиксирован — от него зависит хеш лога.
 */
export type BattleEventBody =
  | { type: 'battle_start'; seed: number }
  | { type: 'slot_start'; slot: number; card: string | null; energy: number }
  | { type: 'telegraph'; slot: number; card: string; duration: number }
  | { type: 'pattern_start'; slot: number; card: string }
  | { type: 'pattern_end'; slot: number; card: string }
  | { type: 'projectile_spawn'; id: number; source: string; x: number; y: number }
  | { type: 'projectile_blocked'; id: number; cover: number }
  | { type: 'projectile_expired'; id: number }
  | { type: 'hero_hit'; source: string; damage: number; hp: number }
  | { type: 'hero_died'; x: number; y: number }
  | { type: 'battle_end'; outcome: BattleOutcome; duration: number };

export type BattleEvent = BattleEventBody & { t: number };

/**
 * FNV-1a по сериализованному логу. Нужен для проверки детерминизма и для
 * баг-репортов вида {seed, buildJSON, hash}.
 */
export function hashEvents(events: readonly BattleEvent[]): string {
  const s = JSON.stringify(events);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

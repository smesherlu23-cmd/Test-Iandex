import { HERO_AI, TUNING } from './tuning';
import raw from './heroTiers.json';

export type HeroAbility = 'dash' | 'block' | 'parry' | 'second_wind';

export interface HeroAbilityInfo {
  readonly wave: number;
  readonly id: HeroAbility;
  /** Как способность называется в анонсе на экране драфта. */
  readonly name: string;
}

/**
 * Расписание из heroTiers.json. ТЗ §6 говорит «каждые 3 волны — новая
 * способность», поэтому волны 3, 6, 9 и 12; пример «Волна 7» в тексте ТЗ этому
 * правилу не соответствует, и выбрано правило, а не пример.
 */
export const ABILITY_SCHEDULE: readonly HeroAbilityInfo[] = raw.abilities.map((a) => ({
  wave: a.wave,
  id: a.id as HeroAbility,
  name: a.name,
}));

export interface HeroTier {
  readonly wave: number;
  readonly hp: number;
  /** Урон героя по боссу. */
  readonly damage: number;
  readonly reaction: number;
  readonly abilities: readonly HeroAbility[];
}

/** Каждая волна: +8% здоровья, +5% урона, −4% времени реакции (ТЗ §6). */
export function heroTier(wave: number): HeroTier {
  const steps = Math.max(0, wave - 1);
  return {
    wave,
    hp: TUNING.HERO_BASE_HP * TUNING.WAVE_HP_SCALE ** steps,
    damage: HERO_AI.ATTACK_DAMAGE * TUNING.WAVE_DMG_SCALE ** steps,
    reaction: TUNING.HERO_BASE_REACTION * TUNING.WAVE_REACTION_SCALE ** steps,
    abilities: ABILITY_SCHEDULE.filter((a) => a.wave <= wave).map((a) => a.id),
  };
}

/** Способности, которые открываются именно на этой волне — для анонса. */
export function abilitiesGainedAt(wave: number): readonly HeroAbilityInfo[] {
  return ABILITY_SCHEDULE.filter((a) => a.wave === wave);
}

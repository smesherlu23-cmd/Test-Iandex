export const TUNING = {
  FIXED_DT: 1 / 60,
  ARENA: { w: 16, h: 24 },
  BATTLE_MAX_TIME: 40,
  TIMELINE_SLOTS: 8,
  SLOT_DURATION: 5,

  BOSS_LIVES: 3,
  BOSS_ENERGY_START: 10,
  BOSS_ENERGY_REGEN: 5, // за пустой слот

  HERO_BASE_HP: 100,
  HERO_BASE_SPEED: 4.5, // ед/с
  HERO_BASE_REACTION: 0.45, // с
  HERO_ATTACK_CD: 1.2,
  HERO_POTIONS: 2,
  HERO_POTION_HEAL: 30,

  FAMILIARITY_GAIN: 0.15,
  FAMILIARITY_REACTION_FACTOR: 0.6,
  FAMILIARITY_PREDICT_THRESHOLD: 0.7,

  WAVE_HP_SCALE: 1.08,
  WAVE_DMG_SCALE: 1.05,
  WAVE_REACTION_SCALE: 0.96,

  DANGER_MAP_HZ: 10,
  DEATH_SLOWMO: 0.25,
  DEATH_PAUSE: 0.8,
} as const;

/**
 * Тиков в секунде. Время боя считается как tick / TICK_RATE, а не накоплением
 * FIXED_DT: целочисленное деление даёт точные границы слотов (300 / 60 === 5),
 * тогда как 300 * (1/60) === 4.999999999999999 и слот открывался бы на тик позже.
 */
export const TICK_RATE = Math.round(1 / TUNING.FIXED_DT);

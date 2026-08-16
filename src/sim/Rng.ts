/**
 * Seeded RNG (mulberry32). Единственный источник случайности внутри sim/.
 * Инстанс живёт внутри Battle: один и тот же сид обязан давать один и тот же бой.
 */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Следующее число в [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Число в [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Целое в [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Внутреннее состояние — для сравнения прогонов и баг-репортов. */
  get state(): number {
    return this.s;
  }
}

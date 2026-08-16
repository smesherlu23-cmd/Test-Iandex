import type { Rng } from './Rng';

const TAU = Math.PI * 2;

/**
 * Траектория примитивного героя Этапа 1. Круг подобран так, чтобы не задевать
 * укрытия: обходить препятствия герой научится на Этапе 2 вместе с utility-ИИ.
 */
export const HERO_PATH = { cx: 8, cy: 15, r: 4.5 } as const;

export interface HeroConfig {
  readonly hp: number;
  readonly speed: number;
  readonly rng: Rng;
}

/** Этап 1: герой просто бежит по кругу. Вся его логика — заглушка под ИИ. */
export class Hero {
  readonly r = 0.45;
  readonly maxHp: number;
  readonly speed: number;

  x: number;
  y: number;
  hp: number;
  alive = true;

  private angle: number;

  constructor(config: HeroConfig) {
    this.maxHp = config.hp;
    this.hp = config.hp;
    this.speed = config.speed;
    // Единственное, что герой берёт от сида, — точка старта на круге.
    this.angle = config.rng.next() * TAU;
    this.x = HERO_PATH.cx + Math.cos(this.angle) * HERO_PATH.r;
    this.y = HERO_PATH.cy + Math.sin(this.angle) * HERO_PATH.r;
  }

  update(dt: number): void {
    if (!this.alive) return;
    this.angle += (this.speed / HERO_PATH.r) * dt;
    // Угол держим в [0, TAU): иначе он растёт весь бой и теряет точность.
    if (this.angle >= TAU) this.angle -= TAU;
    this.x = HERO_PATH.cx + Math.cos(this.angle) * HERO_PATH.r;
    this.y = HERO_PATH.cy + Math.sin(this.angle) * HERO_PATH.r;
  }

  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
    }
  }
}

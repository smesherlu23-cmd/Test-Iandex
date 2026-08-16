export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  /** Остаток жизни в секундах. */
  life: number;
  /** id паттерна-источника — для событий и будущей аналитики. */
  source: string;
}

/** Данные для спавна: id выдаёт Battle. */
export type ProjectileSpawn = Omit<Projectile, 'id'>;

export function advance(p: Projectile, dt: number): void {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.life -= dt;
}

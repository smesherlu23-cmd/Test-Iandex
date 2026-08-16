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
  /** Номер угрозы: один залп — одна угроза для внимания героя. */
  group: number;
}

/** Данные для спавна: id и группу выдаёт Battle. */
export type ProjectileSpawn = Omit<Projectile, 'id' | 'group'>;

export function advance(p: Projectile, dt: number): void {
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.life -= dt;
}

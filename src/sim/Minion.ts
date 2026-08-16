/** Прислужник: слабый юнит, который просто преследует героя (ТЗ §8). */
export interface Minion {
  id: number;
  /** Номер угрозы: оба прислужника одного призыва — одна угроза для внимания. */
  group: number;
  source: string;
  x: number;
  y: number;
  r: number;
  hp: number;
  speed: number;
  damage: number;
  /** Остаток жизни, сек. */
  life: number;
  /** Кулдаун контактного удара, сек. */
  cd: number;
}

export type MinionSpawn = Omit<Minion, 'id' | 'group' | 'cd'>;

/** Кулдаун контактного удара прислужника, сек. */
export const MINION_HIT_CD = 1;

export function chase(m: Minion, tx: number, ty: number, dt: number): void {
  const dx = tx - m.x;
  const dy = ty - m.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  m.life -= dt;
  m.cd = Math.max(0, m.cd - dt);
  if (dist < 1e-6) return;

  const step = Math.min(m.speed * dt, dist);
  m.x += (dx / dist) * step;
  m.y += (dy / dist) * step;
}

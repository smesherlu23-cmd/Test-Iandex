import { TUNING } from '../data/tuning';
import type { Circle, Rect } from './Collision';
import { clamp } from './Collision';

export interface Cover extends Rect {
  readonly id: number;
}

/** Босс стоит в верхней трети арены и в Этапе 1 неподвижен. */
export const BOSS_ANCHOR = { x: 8, y: 4.5, r: 1.6 } as const;

/**
 * Четыре укрытия у боковых стен. Расставлены так, чтобы не пересекать круговую
 * траекторию героя (см. Hero): примитивный герой Этапа 1 не умеет обходить
 * препятствия, укрытия здесь блокируют только снаряды.
 */
const COVER_LAYOUT: readonly Rect[] = [
  { x: 0.5, y: 9.5, w: 2.5, h: 1 },
  { x: 13.0, y: 9.5, w: 2.5, h: 1 },
  { x: 0.5, y: 19.0, w: 2.5, h: 1 },
  { x: 13.0, y: 19.0, w: 2.5, h: 1 },
];

export class Arena {
  readonly w = TUNING.ARENA.w;
  readonly h = TUNING.ARENA.h;
  readonly covers: Cover[];

  constructor() {
    this.covers = COVER_LAYOUT.map((r, i) => ({ id: i, x: r.x, y: r.y, w: r.w, h: r.h }));
  }

  /** Центр круга внутри арены (снаряд считается вышедшим, когда центр за краем). */
  containsPoint(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x <= this.w && y <= this.h;
  }

  /** Укрытие, которое перекрывает круг, либо null. */
  coverAt(c: Circle): Cover | null {
    return this.coverAtXY(c.x, c.y, c.r);
  }

  /** То же без создания объекта: вызывается десятки раз за кадр из ИИ героя. */
  coverAtXY(x: number, y: number, r: number): Cover | null {
    for (const cover of this.covers) {
      const nx = clamp(x, cover.x, cover.x + cover.w);
      const ny = clamp(y, cover.y, cover.y + cover.h);
      const dx = x - nx;
      const dy = y - ny;
      if (dx * dx + dy * dy <= r * r) return cover;
    }
    return null;
  }
}

import type { Arena } from './Arena';
import { circleCircle } from './Collision';
import type { DangerMap } from './DangerMap';

/** Урон зоны наносится дискретными тиками, иначе лог боя распухнет до 60 записей в секунду. */
export const HAZARD_TICK = 0.5;

export type HazardShape =
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number }
  | {
      readonly kind: 'ray';
      readonly x: number;
      readonly y: number;
      readonly angle: number;
      readonly length: number;
      readonly width: number;
    };

/**
 * Объявленная паттерном зона. Живёт двумя фазами: до activeFrom это только
 * предупреждение, после — источник урона. В карту опасности попадает уже с
 * visibleAt, то есть с задержкой на время реакции героя.
 */
export interface Hazard {
  readonly id: number;
  readonly source: string;
  /** Номер угрозы: все зоны одного паттерна отслеживаются как одна. */
  readonly group: number;
  readonly shape: HazardShape;
  /** Момент, когда зона начинает бить. */
  readonly activeFrom: number;
  /** Момент, когда зона исчезает. */
  readonly expiresAt: number;
  /** Момент, с которого герой её замечает. */
  readonly visibleAt: number;
  /** Разовый урон в момент активации. */
  readonly impact: number;
  /** Урон в секунду, пока зона активна. */
  readonly dps: number;
  /** Сколько урона тут стоит ожидать — значение для карты опасности. */
  readonly danger: number;
  /** Разовый урон уже нанесён. */
  struck: boolean;
  /** Время следующего тика периодического урона. */
  nextTick: number;
}

/** Описание зоны без служебных полей: их проставляет Battle при регистрации. */
export type HazardSpec = Omit<Hazard, 'id' | 'group' | 'visibleAt' | 'struck' | 'nextTick'>;

export function hazardContains(shape: HazardShape, x: number, y: number, r: number): boolean {
  if (shape.kind === 'circle') {
    return circleCircle({ x, y, r }, { x: shape.x, y: shape.y, r: shape.r });
  }
  // Луч: проекция точки на отрезок, затем расстояние до неё.
  const dx = Math.cos(shape.angle);
  const dy = Math.sin(shape.angle);
  const t = Math.max(0, Math.min(shape.length, (x - shape.x) * dx + (y - shape.y) * dy));
  const px = shape.x + dx * t;
  const py = shape.y + dy * t;
  const ddx = x - px;
  const ddy = y - py;
  const reach = r + shape.width / 2;
  return ddx * ddx + ddy * ddy <= reach * reach;
}

/** Расстояние от точки до края зоны; 0, если точка внутри. */
export function hazardDistance(shape: HazardShape, x: number, y: number): number {
  if (shape.kind === 'circle') {
    const dx = x - shape.x;
    const dy = y - shape.y;
    return Math.max(0, Math.sqrt(dx * dx + dy * dy) - shape.r);
  }
  const dx = Math.cos(shape.angle);
  const dy = Math.sin(shape.angle);
  const t = Math.max(0, Math.min(shape.length, (x - shape.x) * dx + (y - shape.y) * dy));
  const ddx = x - (shape.x + dx * t);
  const ddy = y - (shape.y + dy * t);
  return Math.max(0, Math.sqrt(ddx * ddx + ddy * ddy) - shape.width / 2);
}

/** Ширина «ореола» вокруг зоны и его доля от урона. */
const HALO = 1.6;
const HALO_FACTOR = 0.45;

/**
 * Зона размечается с ореолом: у самого края опасность ниже, но не ноль.
 * Без него герой прижимается вплотную к границе облака и попадает под
 * следующую зону, легшую рядом.
 */
export function stampHazard(map: DangerMap, shape: HazardShape, value: number, arena: Arena): void {
  if (shape.kind === 'circle') {
    map.circle(shape.x, shape.y, shape.r + HALO, value * HALO_FACTOR);
    map.circle(shape.x, shape.y, shape.r, value);
    return;
  }
  map.ray(shape.x, shape.y, shape.angle, shape.length, shape.width + HALO, value * HALO_FACTOR, arena);
  map.ray(shape.x, shape.y, shape.angle, shape.length, shape.width, value, arena);
}

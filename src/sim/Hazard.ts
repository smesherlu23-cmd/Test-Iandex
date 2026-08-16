import type { Arena } from './Arena';
import { circleCircle, circleRect, clamp } from './Collision';
import type { DangerMap } from './DangerMap';

/** Урон зоны наносится дискретными тиками, иначе лог боя распухнет до 60 записей в секунду. */
export const HAZARD_TICK = 0.5;

/** Сколько лучей рисует конус при разметке карты опасности. */
const WEDGE_RAYS = 9;

export type HazardShape =
  | { readonly kind: 'circle'; readonly x: number; readonly y: number; readonly r: number }
  | {
      readonly kind: 'ray';
      readonly x: number;
      readonly y: number;
      readonly angle: number;
      readonly length: number;
      readonly width: number;
    }
  | {
      readonly kind: 'wedge';
      readonly x: number;
      readonly y: number;
      readonly angle: number;
      /** Полный раствор конуса, рад. */
      readonly spread: number;
      readonly radius: number;
    }
  /** Прямоугольник задаётся левым верхним углом. */
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
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
  /**
   * Невидимая зона: не попадает ни в карту опасности, ни в отрисовку, пока не
   * сработает. Так устроена «Ловушка» (ТЗ §8) — единственное исключение из
   * правила об обязательном телеграфе.
   */
  readonly hidden: boolean;
  /** Множитель скорости героя при попадании и его длительность, сек. */
  readonly slow: number;
  readonly slowFor: number;
  /** Обездвиживание при попадании, сек. */
  readonly root: number;
  /** Срабатывает при входе, а не в момент активации. */
  readonly onEnter: boolean;
  /** Разовый урон уже нанесён. */
  struck: boolean;
  /** Время следующего тика периодического урона. */
  nextTick: number;
}

/** Поля, которые проставляет Battle; остальное задаёт паттерн. */
type HazardCore = Omit<Hazard, 'id' | 'group' | 'visibleAt' | 'struck' | 'nextTick'>;
type HazardOptional = 'hidden' | 'slow' | 'slowFor' | 'root' | 'onEnter';

/** Описание зоны: необязательные поля получают безопасные значения по умолчанию. */
export type HazardSpec = Omit<HazardCore, HazardOptional> &
  Partial<Pick<HazardCore, HazardOptional>>;

export function hazardContains(shape: HazardShape, x: number, y: number, r: number): boolean {
  switch (shape.kind) {
    case 'circle':
      return circleCircle({ x, y, r }, { x: shape.x, y: shape.y, r: shape.r });

    case 'rect':
      return circleRect({ x, y, r }, shape);

    case 'wedge': {
      const dx = x - shape.x;
      const dy = y - shape.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > shape.radius + r) return false;
      if (dist < 1e-6) return true;
      // Габарит героя расширяет конус тем сильнее, чем ближе он к вершине.
      const slack = Math.atan2(r, Math.max(dist, 0.001));
      return Math.abs(angleDelta(Math.atan2(dy, dx), shape.angle)) <= shape.spread / 2 + slack;
    }

    case 'ray': {
      const dx = Math.cos(shape.angle);
      const dy = Math.sin(shape.angle);
      const t = clamp((x - shape.x) * dx + (y - shape.y) * dy, 0, shape.length);
      const ddx = x - (shape.x + dx * t);
      const ddy = y - (shape.y + dy * t);
      const reach = r + shape.width / 2;
      return ddx * ddx + ddy * ddy <= reach * reach;
    }
  }
}

/** Расстояние от точки до края зоны; 0, если точка внутри. */
export function hazardDistance(shape: HazardShape, x: number, y: number): number {
  switch (shape.kind) {
    case 'circle': {
      const dx = x - shape.x;
      const dy = y - shape.y;
      return Math.max(0, Math.sqrt(dx * dx + dy * dy) - shape.r);
    }

    case 'rect': {
      const dx = x - clamp(x, shape.x, shape.x + shape.w);
      const dy = y - clamp(y, shape.y, shape.y + shape.h);
      return Math.sqrt(dx * dx + dy * dy);
    }

    case 'wedge': {
      const dx = x - shape.x;
      const dy = y - shape.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const off = Math.abs(angleDelta(Math.atan2(dy, dx), shape.angle));
      // Вне раствора расстояние считаем по хорде до ближайшей грани конуса.
      const radial = Math.max(0, dist - shape.radius);
      if (off <= shape.spread / 2) return radial;
      return Math.max(radial, dist * Math.sin(Math.min(off - shape.spread / 2, Math.PI / 2)));
    }

    case 'ray': {
      const dx = Math.cos(shape.angle);
      const dy = Math.sin(shape.angle);
      const t = clamp((x - shape.x) * dx + (y - shape.y) * dy, 0, shape.length);
      const ddx = x - (shape.x + dx * t);
      const ddy = y - (shape.y + dy * t);
      return Math.max(0, Math.sqrt(ddx * ddx + ddy * ddy) - shape.width / 2);
    }
  }
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
  switch (shape.kind) {
    case 'circle':
      map.circle(shape.x, shape.y, shape.r + HALO, value * HALO_FACTOR);
      map.circle(shape.x, shape.y, shape.r, value);
      return;

    case 'rect':
      map.rect(shape.x - HALO, shape.y - HALO, shape.w + HALO * 2, shape.h + HALO * 2, value * HALO_FACTOR);
      map.rect(shape.x, shape.y, shape.w, shape.h, value);
      return;

    case 'wedge': {
      // Конус размечается веером лучей: отдельная растеризация не окупается.
      const first = shape.angle - shape.spread / 2;
      const step = shape.spread / (WEDGE_RAYS - 1);
      const width = (2 * shape.radius * Math.sin(step / 2)) + HALO;
      for (let i = 0; i < WEDGE_RAYS; i++) {
        map.ray(shape.x, shape.y, first + step * i, shape.radius, width, value, arena);
      }
      return;
    }

    case 'ray':
      map.ray(shape.x, shape.y, shape.angle, shape.length, shape.width + HALO, value * HALO_FACTOR, arena);
      map.ray(shape.x, shape.y, shape.angle, shape.length, shape.width, value, arena);
      return;
  }
}

/** Разница углов, приведённая к [-π, π]. */
function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** Прямоугольник задаётся левым верхним углом. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function circleCircle(a: Circle, b: Circle): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rr = a.r + b.r;
  return dx * dx + dy * dy <= rr * rr;
}

export function circleRect(c: Circle, r: Rect): boolean {
  const nx = clamp(c.x, r.x, r.x + r.w);
  const ny = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - nx;
  const dy = c.y - ny;
  return dx * dx + dy * dy <= c.r * c.r;
}

/**
 * Пересекает ли отрезок прямоугольник (Лианг—Барски).
 * Нужен, чтобы понять, закрывает ли укрытие точку от босса.
 */
export function segmentRect(x0: number, y0: number, x1: number, y1: number, r: Rect): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - r.x, r.x + r.w - x0, y0 - r.y, r.y + r.h - y0];
  let t0 = 0;
  let t1 = 1;

  for (let i = 0; i < 4; i++) {
    const pi = p[i]!;
    const qi = q[i]!;
    if (pi === 0) {
      if (qi < 0) return false; // параллельно стороне и снаружи
      continue;
    }
    const t = qi / pi;
    if (pi < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** Круг целиком внутри прямоугольника [0,0,w,h]. */
export function circleInsideBounds(c: Circle, w: number, h: number): boolean {
  return c.x - c.r >= 0 && c.y - c.r >= 0 && c.x + c.r <= w && c.y + c.r <= h;
}

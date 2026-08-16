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

/** Круг целиком внутри прямоугольника [0,0,w,h]. */
export function circleInsideBounds(c: Circle, w: number, h: number): boolean {
  return c.x - c.r >= 0 && c.y - c.r >= 0 && c.x + c.r <= w && c.y + c.r <= h;
}

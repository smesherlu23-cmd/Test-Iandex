import { TUNING } from '../data/tuning';
import type { Arena } from './Arena';
import { clamp } from './Collision';

/** Шаг обхода луча при разметке, ед. */
const RAY_STEP = 0.5;

/**
 * Прогноз урона по клеткам арены — единственный канал, через который герой
 * «видит» атаки (ТЗ §6). Сетка 16×24, пересобирается 10 раз в секунду.
 *
 * Источники накладываются так: внутри одного источника берётся максимум
 * (иначе обход луча насчитал бы одной клетке урон десять раз), а разные
 * источники складываются — два веера, накрывшие одну точку, вдвое опаснее.
 */
export class DangerMap {
  readonly w = TUNING.ARENA.w;
  readonly h = TUNING.ARENA.h;

  private readonly cells: Float64Array;
  private readonly scratch: Float64Array;
  /** Индексы клеток, задетых текущим источником: обход всей сетки на каждый луч слишком дорог. */
  private readonly touched: Int32Array;
  private touchedCount = 0;

  constructor() {
    this.cells = new Float64Array(this.w * this.h);
    this.scratch = new Float64Array(this.w * this.h);
    this.touched = new Int32Array(this.w * this.h);
  }

  clear(): void {
    this.cells.fill(0);
  }

  /** Начать новый источник опасности. */
  begin(): void {
    this.touchedCount = 0;
  }

  /** Влить накопленный источник в общую карту и обнулить черновик. */
  commit(): void {
    for (let i = 0; i < this.touchedCount; i++) {
      const k = this.touched[i]!;
      this.cells[k] = this.cells[k]! + this.scratch[k]!;
      this.scratch[k] = 0;
    }
    this.touchedCount = 0;
  }

  circle(cx: number, cy: number, r: number, value: number): void {
    if (value <= 0) return;
    const i0 = Math.max(0, Math.floor(cx - r - 0.5));
    const i1 = Math.min(this.w - 1, Math.floor(cx + r + 0.5));
    const j0 = Math.max(0, Math.floor(cy - r - 0.5));
    const j1 = Math.min(this.h - 1, Math.floor(cy + r + 0.5));
    // Клетка задета, если её центр ближе r к центру круга с поправкой на полклетки.
    const reach = (r + 0.5) * (r + 0.5);

    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        if (dx * dx + dy * dy > reach) continue;
        const k = j * this.w + i;
        if (this.scratch[k] === 0) this.touched[this.touchedCount++] = k;
        if (this.scratch[k]! < value) this.scratch[k] = value;
      }
    }
  }

  rect(x: number, y: number, w: number, h: number, value: number): void {
    if (value <= 0) return;
    const i0 = Math.max(0, Math.floor(x - 0.5));
    const i1 = Math.min(this.w - 1, Math.floor(x + w + 0.5));
    const j0 = Math.max(0, Math.floor(y - 0.5));
    const j1 = Math.min(this.h - 1, Math.floor(y + h + 0.5));

    for (let j = j0; j <= j1; j++) {
      const cy = j + 0.5;
      if (cy < y - 0.5 || cy > y + h + 0.5) continue;
      for (let i = i0; i <= i1; i++) {
        const cx = i + 0.5;
        if (cx < x - 0.5 || cx > x + w + 0.5) continue;
        const k = j * this.w + i;
        if (this.scratch[k] === 0) this.touched[this.touchedCount++] = k;
        if (this.scratch[k]! < value) this.scratch[k] = value;
      }
    }
  }

  /**
   * Луч от (x, y) длиной length. Обрывается о первое укрытие: место за
   * укрытием само собой оказывается безопасным, и герой это видит.
   */
  ray(
    x: number,
    y: number,
    angle: number,
    length: number,
    width: number,
    value: number,
    arena: Arena,
  ): void {
    if (value <= 0 || length <= 0) return;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const r = width / 2;

    for (let d = 0; d <= length; d += RAY_STEP) {
      const px = x + dx * d;
      const py = y + dy * d;
      if (!arena.containsPoint(px, py)) break;
      if (arena.coverAt({ x: px, y: py, r })) break;
      this.circle(px, py, r, value);
    }
  }

  /** Билинейная выборка: герою нужен градиент, а не ступеньки клеток. */
  at(x: number, y: number): number {
    const fx = clamp(x - 0.5, 0, this.w - 1);
    const fy = clamp(y - 0.5, 0, this.h - 1);
    const i0 = Math.floor(fx);
    const j0 = Math.floor(fy);
    const i1 = Math.min(i0 + 1, this.w - 1);
    const j1 = Math.min(j0 + 1, this.h - 1);
    const tx = fx - i0;
    const ty = fy - j0;

    const top = this.cells[j0 * this.w + i0]! * (1 - tx) + this.cells[j0 * this.w + i1]! * tx;
    const bottom = this.cells[j1 * this.w + i0]! * (1 - tx) + this.cells[j1 * this.w + i1]! * tx;
    return top * (1 - ty) + bottom * ty;
  }

  /** Максимум по карте — для тестов и отладки. */
  get peak(): number {
    let m = 0;
    for (const v of this.cells) if (v > m) m = v;
    return m;
  }
}

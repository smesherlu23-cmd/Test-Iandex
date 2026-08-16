import { TUNING } from '../data/tuning';

export interface LoopCallbacks {
  /** Ровно один шаг симуляции на 1/60 с. */
  step: () => void;
  /** Кадр отрисовки; fps — сглаженное значение за последние 0.5 с. */
  render: (fps: number) => void;
}

/** Кламп на случай ухода вкладки в фон: не отыгрываем накопившийся час. */
const MAX_FRAME_DELTA = 0.25;
/** Потолок шагов за кадр — защита от спирали смерти на слабом железе. */
const MAX_STEPS_PER_FRAME = 5;

export class Loop {
  private readonly cb: LoopCallbacks;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private running = false;

  private fpsFrames = 0;
  private fpsElapsed = 0;
  private fps = 0;

  constructor(cb: LoopCallbacks) {
    this.cb = cb;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);

    const delta = Math.min((now - this.last) / 1000, MAX_FRAME_DELTA);
    this.last = now;
    this.acc += delta;

    let steps = 0;
    while (this.acc >= TUNING.FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.cb.step();
      this.acc -= TUNING.FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;

    this.fpsFrames++;
    this.fpsElapsed += delta;
    if (this.fpsElapsed >= 0.5) {
      this.fps = this.fpsFrames / this.fpsElapsed;
      this.fpsFrames = 0;
      this.fpsElapsed = 0;
    }

    this.cb.render(this.fps);
  };
}

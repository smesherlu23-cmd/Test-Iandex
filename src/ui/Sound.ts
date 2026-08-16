import type { BattleEvent } from '../sim/events';

/**
 * Звук синтезируется на лету через WebAudio: ни одного файла, ни одного
 * байта в бандле и никакой загрузки. Для геометрической графики этого хватает.
 */
type Voice = 'telegraph' | 'impact' | 'hit' | 'dodge' | 'potion' | 'parry' | 'death' | 'summon';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  /** Не чаще одного звука на голос за это время, сек. */
  private readonly lastAt = new Map<Voice, number>();

  /**
   * Браузер не даёт играть до жеста пользователя, поэтому контекст создаётся
   * при первом касании и потом только просыпается.
   */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Глушение перед показом рекламы (ТЗ §9) и по желанию игрока. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.22;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  consume(events: readonly BattleEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'telegraph':
          this.play('telegraph');
          break;
        case 'pattern_start':
          this.play('impact');
          break;
        case 'hero_hit':
          this.play('hit');
          break;
        case 'hero_parry':
          this.play('parry');
          break;
        case 'hero_potion':
          this.play('potion');
          break;
        case 'hero_second_wind':
          this.play('potion');
          break;
        case 'minion_spawn':
          this.play('summon');
          break;
        case 'hero_died':
          this.play('death');
          break;
        default:
          break;
      }
    }
  }

  private play(voice: Voice): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.muted) return;

    // Один голос не звучит чаще, чем раз в 60 мс: залп из восьми осколков не
    // должен превращаться в треск.
    const now = ctx.currentTime;
    if (now - (this.lastAt.get(voice) ?? -1) < 0.06) return;
    this.lastAt.set(voice, now);

    switch (voice) {
      case 'telegraph':
        this.tone(220, 0.09, 'sine', 0.5);
        break;
      case 'impact':
        this.noise(0.12, 0.7);
        break;
      case 'hit':
        this.sweep(420, 140, 0.16, 'square', 0.5);
        break;
      case 'dodge':
        this.tone(880, 0.05, 'sine', 0.3);
        break;
      case 'potion':
        this.sweep(320, 720, 0.22, 'sine', 0.5);
        break;
      case 'parry':
        this.tone(1400, 0.08, 'triangle', 0.5);
        this.tone(2100, 0.06, 'triangle', 0.3);
        break;
      case 'summon':
        this.sweep(160, 90, 0.25, 'sawtooth', 0.35);
        break;
      case 'death':
        this.sweep(300, 60, 0.7, 'sawtooth', 0.8);
        this.noise(0.4, 0.5);
        break;
    }
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(env).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  private sweep(from: number, to: number, dur: number, type: OscillatorType, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + dur);
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    osc.connect(env).connect(master);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  }

  private noise(dur: number, gain: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < frames; i++) {
      // Свой генератор вместо Math.random: шум одинаков от запуска к запуску.
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }

    const src = ctx.createBufferSource();
    const env = ctx.createGain();
    src.buffer = buffer;
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    src.connect(env).connect(master);
    src.start();
  }
}

/** Вибрация на значимых событиях; там, где её нет, вызов молча пропускается. */
export function vibrate(events: readonly BattleEvent[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;

  for (const e of events) {
    if (e.type === 'hero_died') navigator.vibrate([40, 40, 90]);
    else if (e.type === 'hero_parry') navigator.vibrate(25);
    else if (e.type === 'hero_hit') navigator.vibrate(12);
  }
}

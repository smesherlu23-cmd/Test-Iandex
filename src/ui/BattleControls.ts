import type { PlaybackSpeed } from '../core/BattlePlayer';
import './controls.css';

const SPEEDS: readonly PlaybackSpeed[] = [1, 2, 4];

const TEXT = {
  skip: 'Пропустить',
  speed: (s: PlaybackSpeed) => `×${s}`,
  sound: (muted: boolean) => (muted ? '🔇' : '🔊'),
} as const;

export interface BattleControlsOptions {
  readonly onSpeed: (speed: PlaybackSpeed) => void;
  readonly onSkip: () => void;
  readonly onToggleSound: () => void;
}

/**
 * Единственное, чем игрок управляет во время боя: скорость просмотра и
 * «пропустить до конца» (ТЗ §7). Управлять боссом в реальном времени нельзя.
 */
export class BattleControls {
  private readonly root: HTMLElement;
  private readonly buttons = new Map<PlaybackSpeed, HTMLButtonElement>();
  private readonly soundButton: HTMLButtonElement;

  constructor(options: BattleControlsOptions) {
    this.root = document.createElement('div');
    this.root.className = 'controls';
    this.root.hidden = true;

    const speeds = document.createElement('div');
    speeds.className = 'controls-speeds';
    for (const speed of SPEEDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'controls-button';
      button.textContent = TEXT.speed(speed);
      button.addEventListener('click', () => {
        this.setSpeed(speed);
        options.onSpeed(speed);
      });
      this.buttons.set(speed, button);
      speeds.appendChild(button);
    }

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'controls-button controls-skip';
    skip.textContent = TEXT.skip;
    skip.addEventListener('click', () => options.onSkip());

    this.soundButton = document.createElement('button');
    this.soundButton.type = 'button';
    this.soundButton.className = 'controls-button controls-sound';
    this.soundButton.textContent = TEXT.sound(false);
    this.soundButton.addEventListener('click', () => options.onToggleSound());

    this.root.append(speeds, skip, this.soundButton);
    document.body.appendChild(this.root);
    this.setSpeed(1);
  }

  show(): void {
    this.setSpeed(1);
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  setSpeed(speed: PlaybackSpeed): void {
    for (const [value, button] of this.buttons) {
      button.classList.toggle('active', value === speed);
    }
  }

  setMuted(muted: boolean): void {
    this.soundButton.textContent = TEXT.sound(muted);
  }
}

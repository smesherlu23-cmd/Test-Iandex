import type { WaveResult } from '../core/Run';
import { cardById } from '../draft/CardPool';
import './result.css';

const TEXT = {
  killed: 'Герой мёртв',
  survived: 'Герой выстоял',
  killedNote: 'Волна за боссом',
  survivedNote: 'Босс теряет жизнь',
  damage: 'Урона герою',
  best: 'Лучшая карта',
  none: '—',
  learned: 'Герой запомнил',
  lives: 'Жизни босса',
  next: 'Дальше',
  over: 'Забег окончен',
  overNote: (waves: number) => `Волн выдержано: ${waves}`,
  again: 'Заново',
} as const;

export interface ResultScreenOptions {
  readonly onNext: () => void;
  readonly onRestart: () => void;
}

/** Экран итога волны и, когда жизни кончились, итога забега. */
export class ResultScreen {
  private readonly root: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly buttonEl: HTMLButtonElement;
  private readonly options: ResultScreenOptions;
  private runOver = false;

  constructor(options: ResultScreenOptions) {
    this.options = options;

    this.root = document.createElement('div');
    this.root.className = 'result';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="result-card">
        <div class="result-title"></div>
        <div class="result-note"></div>
        <dl class="result-stats"></dl>
        <button class="result-next" type="button"></button>
      </div>
    `;
    document.body.appendChild(this.root);

    this.titleEl = this.query('.result-title');
    this.noteEl = this.query('.result-note');
    this.statsEl = this.query('.result-stats');
    const button = this.query('.result-next');
    if (!(button instanceof HTMLButtonElement)) throw new Error('Нет кнопки итога');
    this.buttonEl = button;
    this.buttonEl.addEventListener('click', () => {
      if (this.runOver) this.options.onRestart();
      else this.options.onNext();
    });
  }

  show(result: WaveResult, runOver: boolean): void {
    this.runOver = runOver;
    const killed = result.outcome === 'boss_win';

    this.titleEl.textContent = runOver ? TEXT.over : killed ? TEXT.killed : TEXT.survived;
    this.noteEl.textContent = runOver
      ? TEXT.overNote(result.wave)
      : killed
        ? TEXT.killedNote
        : TEXT.survivedNote;

    this.statsEl.replaceChildren(
      ...this.row(TEXT.damage, `${Math.round(result.damage)}`),
      ...this.row(TEXT.best, result.bestCard ? (cardById(result.bestCard)?.name ?? result.bestCard) : TEXT.none),
      ...this.row(TEXT.learned, this.learnedText(result)),
      ...this.row(TEXT.lives, '●'.repeat(result.livesLeft) || TEXT.none),
    );

    this.buttonEl.textContent = runOver ? TEXT.again : TEXT.next;
    this.root.hidden = false;
  }

  hide(): void {
    this.root.hidden = true;
  }

  /** Что герой выучил за волну: карта и её знакомство в процентах. */
  private learnedText(result: WaveResult): string {
    if (result.learned.length === 0) return TEXT.none;
    return result.learned
      .map((l) => `${cardById(l.card)?.name ?? l.card} ${Math.round(l.familiarity * 100)}%`)
      .join(', ');
  }

  private row(label: string, value: string): [HTMLElement, HTMLElement] {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    return [dt, dd];
  }

  private query(selector: string): HTMLElement {
    const el = this.root.querySelector(selector);
    if (!(el instanceof HTMLElement)) throw new Error(`Нет элемента ${selector}`);
    return el;
  }
}

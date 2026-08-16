import type { Run } from '../core/Run';
import type { SlotPlan } from '../draft/Timeline';
import { SLOT_COUNT, place, planTimeline } from '../draft/Timeline';
import type { PatternCard } from '../sim/Boss';
import './draft.css';

/** Строки собраны в одном месте: словарь ru/en появится на Этапе 7. */
const TEXT = {
  wave: (n: number) => `Волна ${n}`,
  lives: (n: number) => `${'●'.repeat(Math.max(0, n))} жизни`,
  /** Способности вводятся с явным анонсом на экране драфта (ТЗ §6). */
  learned: (wave: number, name: string) => `Волна ${wave}: герой освоил ${name}`,
  known: (percent: number) => `знакомство ${percent}%`,
  offer: 'Возьми карту',
  offerEmpty: 'Новых карт пока нет',
  hand: 'Рука',
  handEmpty: 'Рука пуста',
  timeline: 'Таймлайн',
  fight: 'Бой',
  recover: 'Восстановление',
  hint: 'Перетащи карту в слот. Тап по слоту — очистить.',
  starved: 'не хватит энергии',
  energy: (before: number, after: number) => `${before} → ${after}`,
  cost: (card: PatternCard) => `${card.cost} эн · телеграф ${card.telegraph}с`,
} as const;

/** Порог в пикселях, ниже которого движение считается тапом, а не перетаскиванием. */
const TAP_SLOP = 8;

export interface DraftScreenOptions {
  readonly onFight: () => void;
}

/**
 * Экран драфта: DOM поверх канваса, без фреймворков (ТЗ §3).
 * Ввод — тап по предложенной карте и drag руки на слоты (ТЗ §2).
 */
export class DraftScreen {
  private readonly root: HTMLElement;
  private readonly waveEl: HTMLElement;
  private readonly noteEl: HTMLElement;
  private readonly learnedEl: HTMLElement;
  private readonly offerTitle: HTMLElement;
  private readonly offerEl: HTMLElement;
  private readonly handTitle: HTMLElement;
  private readonly handEl: HTMLElement;
  private readonly slotsEl: HTMLElement;
  private readonly onFight: () => void;

  private run: Run | null = null;

  private dragCard: PatternCard | null = null;
  private dragFrom: number | null = null;
  private ghost: HTMLElement | null = null;
  private hovered: HTMLElement | null = null;
  private dragMoved = false;
  private dragStartX = 0;
  private dragStartY = 0;

  constructor(options: DraftScreenOptions) {
    this.onFight = options.onFight;

    this.root = document.createElement('div');
    this.root.className = 'draft';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="draft-head">
        <div class="draft-wave"></div>
        <div class="draft-note"></div>
      </div>
      <div class="draft-learned" hidden></div>
      <section>
        <h2 class="draft-offer-title"></h2>
        <div class="draft-cards draft-offer"></div>
      </section>
      <section>
        <h2 class="draft-hand-title"></h2>
        <div class="draft-cards draft-hand"></div>
      </section>
      <section>
        <h2>${TEXT.timeline}</h2>
        <ol class="draft-slots"></ol>
        <p class="draft-hint">${TEXT.hint}</p>
      </section>
      <button class="draft-fight" type="button">${TEXT.fight}</button>
    `;
    document.body.appendChild(this.root);

    this.waveEl = this.query('.draft-wave');
    this.noteEl = this.query('.draft-note');
    this.learnedEl = this.query('.draft-learned');
    this.offerTitle = this.query('.draft-offer-title');
    this.offerEl = this.query('.draft-offer');
    this.handTitle = this.query('.draft-hand-title');
    this.handEl = this.query('.draft-hand');
    this.slotsEl = this.query('.draft-slots');

    this.query('.draft-fight').addEventListener('click', () => this.onFight());
    this.buildSlots();
  }

  /** Показать экран для текущего состояния забега. */
  show(run: Run): void {
    this.run = run;
    this.root.hidden = false;
    this.render();
  }

  hide(): void {
    this.root.hidden = true;
  }

  // --- отрисовка ---

  private render(): void {
    const run = this.run;
    if (!run) return;

    this.waveEl.textContent = TEXT.wave(run.wave);
    this.noteEl.textContent = TEXT.lives(run.lives);

    const gained = run.newAbilities;
    this.learnedEl.hidden = gained.length === 0;
    this.learnedEl.textContent = gained
      .map((a) => TEXT.learned(run.wave, a.name))
      .join(' · ');

    this.offerTitle.textContent = run.offer.length > 0 ? TEXT.offer : TEXT.offerEmpty;
    this.offerEl.replaceChildren(
      ...run.offer.map((card) => this.cardEl(card, () => this.takeCard(card))),
    );

    this.handTitle.textContent = run.hand.length > 0 ? TEXT.hand : TEXT.handEmpty;
    this.handEl.replaceChildren(
      ...run.hand.map((card) => this.handCardEl(card, run.familiarity[card.id] ?? 0)),
    );

    this.renderSlots(planTimeline(run.timeline));
  }

  private renderSlots(plan: readonly SlotPlan[]): void {
    plan.forEach((slot) => {
      const el = this.slotsEl.children[slot.slot];
      if (!(el instanceof HTMLElement)) return;

      el.classList.toggle('filled', slot.card !== null);
      el.classList.toggle('starved', slot.starved);
      this.text(el, '.slot-name', slot.card ? slot.card.name : TEXT.recover);
      this.text(
        el,
        '.slot-energy',
        slot.starved ? TEXT.starved : TEXT.energy(slot.energyBefore, slot.energyAfter),
      );
    });
  }

  private buildSlots(): void {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const li = document.createElement('li');
      li.className = 'slot';
      li.dataset.slot = String(i);
      li.innerHTML = `
        <div class="slot-index">${i + 1}</div>
        <div class="slot-name"></div>
        <div class="slot-energy"></div>
      `;
      li.addEventListener('pointerdown', (ev) => this.onSlotPointerDown(ev, i));
      this.slotsEl.appendChild(li);
    }
  }

  private cardEl(card: PatternCard, onTap: () => void): HTMLElement {
    const el = document.createElement('div');
    el.className = 'card';
    el.innerHTML = `<div class="card-name"></div><div class="card-meta"></div>`;
    this.text(el, '.card-name', card.name);
    this.text(el, '.card-meta', TEXT.cost(card));
    el.addEventListener('click', onTap);
    return el;
  }

  private handCardEl(card: PatternCard, familiarity: number): HTMLElement {
    const el = this.cardEl(card, () => {});
    if (familiarity > 0) {
      // Игрок должен видеть, что герой к карте привыкает (ТЗ §6).
      const known = document.createElement('div');
      known.className = 'card-known';
      known.textContent = TEXT.known(Math.round(familiarity * 100));
      el.appendChild(known);
    }
    el.addEventListener('pointerdown', (ev) => this.beginDrag(ev, card, null));
    return el;
  }

  // --- действия ---

  private takeCard(card: PatternCard): void {
    if (!this.run) return;
    this.run.take(card);
    this.render();
  }

  /** Тап по слоту очищает его, перетаскивание — переносит карту в другой слот. */
  private onSlotPointerDown(ev: PointerEvent, slot: number): void {
    const card = this.run?.timeline[slot] ?? null;
    if (!card) return;
    this.beginDrag(ev, card, slot);
  }

  // --- перетаскивание ---

  private beginDrag(ev: PointerEvent, card: PatternCard, from: number | null): void {
    ev.preventDefault();
    this.dragCard = card;
    this.dragFrom = from;
    this.dragMoved = false;
    this.dragStartX = ev.clientX;
    this.dragStartY = ev.clientY;

    const ghost = document.createElement('div');
    ghost.className = 'card ghost';
    ghost.innerHTML = `<div class="card-name"></div><div class="card-meta"></div>`;
    this.text(ghost, '.card-name', card.name);
    this.text(ghost, '.card-meta', TEXT.cost(card));
    document.body.appendChild(ghost);
    this.ghost = ghost;
    this.moveGhost(ev.clientX, ev.clientY);

    window.addEventListener('pointermove', this.onDragMove);
    window.addEventListener('pointerup', this.onDragEnd);
    window.addEventListener('pointercancel', this.onDragEnd);
  }

  private readonly onDragMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - this.dragStartX;
    const dy = ev.clientY - this.dragStartY;
    if (dx * dx + dy * dy > TAP_SLOP * TAP_SLOP) this.dragMoved = true;
    this.moveGhost(ev.clientX, ev.clientY);
    this.highlight(this.slotUnder(ev.clientX, ev.clientY));
  };

  private readonly onDragEnd = (ev: PointerEvent): void => {
    const target = this.slotUnder(ev.clientX, ev.clientY);
    const to = target ? Number(target.dataset.slot) : null;
    const card = this.dragCard;
    const from = this.dragFrom;
    const moved = this.dragMoved;
    this.endDrag();

    const run = this.run;
    if (!run || !card) return;

    const tappedOwnSlot = from !== null && to === from && !moved;
    const droppedOutside = from !== null && to === null;

    if (tappedOwnSlot || droppedOutside) {
      // Тап по слоту или сброс мимо таймлайна освобождает слот.
      place(run.timeline, from, null);
    } else if (to !== null) {
      // Перенос из слота в слот меняет карты местами, из руки — просто кладёт.
      if (from !== null && from !== to) place(run.timeline, from, run.timeline[to] ?? null);
      place(run.timeline, to, card);
    }

    this.render();
  };

  private endDrag(): void {
    window.removeEventListener('pointermove', this.onDragMove);
    window.removeEventListener('pointerup', this.onDragEnd);
    window.removeEventListener('pointercancel', this.onDragEnd);
    this.ghost?.remove();
    this.ghost = null;
    this.dragCard = null;
    this.dragFrom = null;
    this.highlight(null);
  }

  private moveGhost(x: number, y: number): void {
    if (!this.ghost) return;
    this.ghost.style.left = `${x}px`;
    this.ghost.style.top = `${y}px`;
  }

  private slotUnder(x: number, y: number): HTMLElement | null {
    // Призрак не перехватывает попадания: у него pointer-events: none.
    const el = document.elementFromPoint(x, y);
    const slot = el instanceof Element ? el.closest('.slot') : null;
    return slot instanceof HTMLElement ? slot : null;
  }

  private highlight(slot: HTMLElement | null): void {
    if (this.hovered === slot) return;
    this.hovered?.classList.remove('drop');
    slot?.classList.add('drop');
    this.hovered = slot;
  }

  // --- мелочи ---

  private query(selector: string): HTMLElement {
    const el = this.root.querySelector(selector);
    if (!(el instanceof HTMLElement)) throw new Error(`Нет элемента ${selector}`);
    return el;
  }

  private text(root: HTMLElement, selector: string, value: string): void {
    const el = root.querySelector(selector);
    if (el) el.textContent = value;
  }
}

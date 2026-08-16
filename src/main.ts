import { Loop } from './core/Loop';
import { BattleView } from './render/BattleView';
import type { BattleConfig } from './sim/Battle';
import { Battle } from './sim/Battle';
import { SHARD_VOLLEY } from './sim/Boss';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Канвас #game не найден');

const P = SHARD_VOLLEY;
/** Демо-таймлайн Этапа 1: пустые слоты дают энергию на оставшиеся паттерны. */
const DEMO: BattleConfig = { timeline: [P, P, P, null, P, null, P, P] };

/** Сид фиксирован: демонстрационный бой воспроизводим от запуска к запуску. */
let seed = 1337;
let battle = new Battle(DEMO, seed);

const view = new BattleView(canvas);
const loop = new Loop({
  step: () => battle.step(),
  render: (fps) => view.draw(battle.state, fps),
});

canvas.addEventListener('pointerdown', () => {
  if (battle.finished) battle = new Battle(DEMO, ++seed);
});

loop.start();

import { Loop } from './core/Loop';
import { BattleView } from './render/BattleView';
import type { BattleConfig } from './sim/Battle';
import { Battle } from './sim/Battle';
import { COLLAPSE_PATTERN, POISON_ZONE, SHARD_VOLLEY } from './sim/Boss';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Канвас #game не найден');

/**
 * Демо-таймлайн: облака подряд отжимают героя к краю, обвал ловит бегущего,
 * веер показывает работу укрытий. Близко к самой опасной расстановке из
 * доступных трёх паттернов.
 */
const DEMO: BattleConfig = {
  timeline: [
    POISON_ZONE,
    POISON_ZONE,
    POISON_ZONE,
    COLLAPSE_PATTERN,
    null,
    POISON_ZONE,
    SHARD_VOLLEY,
    COLLAPSE_PATTERN,
  ],
};

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

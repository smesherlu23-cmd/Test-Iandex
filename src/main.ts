import { Game } from './core/Game';
import { Loop } from './core/Loop';
import { BattleView } from './render/BattleView';
import { DraftScreen } from './ui/DraftScreen';
import { ResultScreen } from './ui/ResultScreen';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Канвас #game не найден');

// Сид забега берётся из часов: sim/ остаётся детерминированной, а каждый
// забег получает свою последовательность драфтов. Забег целиком
// воспроизводится по этому числу.
let game = new Game(Date.now() >>> 0);

const view = new BattleView(canvas);

const draft = new DraftScreen({
  onFight: () => {
    game.startBattle();
    draft.hide();
  },
});

const result = new ResultScreen({
  onNext: () => {
    game.nextWave();
    result.hide();
    draft.show(game.run);
  },
  onRestart: () => {
    game = new Game(Date.now() >>> 0);
    result.hide();
    draft.show(game.run);
  },
});

const loop = new Loop({
  step: () => game.step(),
  render: (fps) => {
    const battle = game.battle;
    if (battle) view.draw(battle.state, fps);
    else view.drawIdle(fps);
  },
});

// Бой досмотрен — тап открывает итог волны.
canvas.addEventListener('pointerdown', () => {
  if (!game.battleFinished) return;
  game.closeBattle();
  if (game.result) result.show(game.result, game.phase === 'over');
});

draft.show(game.run);
loop.start();

import { Game } from './core/Game';
import { Loop } from './core/Loop';
import { BattleView } from './render/BattleView';
import { DraftScreen } from './ui/DraftScreen';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Канвас #game не найден');

// Сид забега берётся из часов: sim/ остаётся детерминированной, а каждый
// забег получает свою последовательность драфтов. Забег целиком
// воспроизводится по этому числу.
const game = new Game(Date.now() >>> 0);

const view = new BattleView(canvas);
const draft = new DraftScreen({
  onFight: () => {
    game.startBattle();
    draft.hide();
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

// Бой закончился — тап возвращает в драфт следующей волны.
canvas.addEventListener('pointerdown', () => {
  if (!game.battleFinished) return;
  game.nextWave();
  draft.show(game.run, game.lastOutcome);
});

draft.show(game.run);
loop.start();

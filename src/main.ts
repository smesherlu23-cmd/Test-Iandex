import { Game } from './core/Game';
import { Loop } from './core/Loop';
import { TUNING } from './data/tuning';
import { BattleView } from './render/BattleView';
import { BattleControls } from './ui/BattleControls';
import { DraftScreen } from './ui/DraftScreen';
import { ResultScreen } from './ui/ResultScreen';
import { Sound, vibrate } from './ui/Sound';

const canvas = document.getElementById('game');
if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Канвас #game не найден');

// Сид забега берётся из часов: sim/ остаётся детерминированной, а каждый
// забег получает свою последовательность драфтов. Забег целиком
// воспроизводится по этому числу.
let game = new Game(Date.now() >>> 0);
/** Сколько событий боя уже отыграно подачей. */
let seen = 0;

const view = new BattleView(canvas);
const sound = new Sound();

const controls = new BattleControls({
  onSpeed: (speed) => game.setSpeed(speed),
  onSkip: () => game.skipBattle(),
  onToggleSound: () => {
    sound.setMuted(!sound.isMuted);
    controls.setMuted(sound.isMuted);
  },
});

const draft = new DraftScreen({
  onFight: () => {
    seen = 0;
    view.effects.clear();
    game.startBattle();
    draft.hide();
    controls.show();
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
    if (!battle) {
      view.drawIdle(fps);
      return;
    }

    // Свежие события боя превращаются в частицы, подписи, звук и вибрацию.
    if (battle.events.length > seen) {
      const fresh = battle.events.slice(seen);
      seen = battle.events.length;
      view.effects.consume(fresh, battle.hero.x, battle.hero.y);
      sound.consume(fresh);
      vibrate(fresh);
    }

    view.effects.update(TUNING.FIXED_DT);
    view.draw(battle.state, fps, game.player?.slowMotion ?? false);

    // Бой досмотрен вместе с замедлением и паузой — открываем итог волны.
    if (game.battleFinished) {
      controls.hide();
      game.closeBattle();
      if (game.result) result.show(game.result, game.phase === 'over');
    }
  },
});

// Звук в браузере не заводится без жеста пользователя.
window.addEventListener('pointerdown', () => sound.unlock(), { once: false });

draft.show(game.run);
loop.start();

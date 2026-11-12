import './style.css';
import { initI18n, t } from './i18n';
import { Game } from './game/Game';

initI18n();

const app = document.getElementById('app')!;

// Let the loading screen paint before the scenery is generated.
requestAnimationFrame(() =>
  setTimeout(() => {
    try {
      const game = new Game(app);
      (window as unknown as { airways: Game }).airways = game;
    } catch (err) {
      console.error(err);
      const loading = document.getElementById('loading');
      if (loading) loading.innerHTML = `<span>${t('boot.webgl', { msg: (err as Error).message })}</span>`;
    }
  }, 30),
);

import './style.css';
import { Game } from './game/Game';

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
      if (loading) loading.innerHTML = `<span>Could not start WebGL: ${(err as Error).message}</span>`;
    }
  }, 30),
);

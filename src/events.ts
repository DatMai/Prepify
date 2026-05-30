import { render } from './render/content';
import { showQuizLauncher } from './quiz/launcher';
import { favoritesState } from './state/favorites';

export function bindEvents(): void {
  document.getElementById('search')?.addEventListener('input', () => render());

  document.getElementById('quizToggle')?.addEventListener('click', () => {
    showQuizLauncher();
  });

  document.getElementById('menuBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('show');
  });

  document.getElementById('favFilterBtn')?.addEventListener('click', (e) => {
    favoritesState.filterActive = !favoritesState.filterActive;
    (e.currentTarget as HTMLElement).classList.toggle('active', favoritesState.filterActive);
    render();
  });
}

import { render } from './render/content';
import { showQuizLauncher } from './quiz/launcher';
import { favoritesState } from './state/favorites';
import { loadTopic, ORDER } from './data/loader';
import { t } from './i18n';
import { showToast } from './ui/toast';

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
    if (favoritesState.filterActive) {
      void Promise.all(ORDER.map((key) => loadTopic(key)))
        .then(render)
        .catch((error) => {
          console.error('[favorites] topics loading failed', error);
          favoritesState.filterActive = false;
          (e.currentTarget as HTMLElement).classList.remove('active');
          showToast(t('library.loadError'), 'error');
        });
      return;
    }
    render();
  });
}

import { render } from './render/content';
import { showQuizLauncher } from './quiz/launcher';

export function bindEvents(): void {
  document.getElementById('search')?.addEventListener('input', () => render());

  document.getElementById('quizToggle')?.addEventListener('click', () => {
    showQuizLauncher();
  });

  document.getElementById('menuBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('show');
  });
}

import { render } from './render/content';
import { state } from './state/progress';

export function bindEvents(): void {
  document.getElementById('search')?.addEventListener('input', () => render());

  const quizToggle = document.getElementById('quizToggle');
  quizToggle?.addEventListener('click', () => {
    state.quiz = !state.quiz;
    quizToggle.classList.toggle('on', state.quiz);
    document.getElementById('content')?.classList.toggle('quiz-mode', state.quiz);
    quizToggle.textContent = state.quiz ? '🎯 Quiz: ON' : '🎯 Quiz mode';
  });

  document.getElementById('menuBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('show');
  });
}

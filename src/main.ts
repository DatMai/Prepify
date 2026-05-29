import './styles/main.css';
import { bindEvents } from './events';
import { render } from './render/content';
import { loadProgress } from './state/progress';
import { restoreSession } from './state/auth';
import { initAuthModal, bindAuthBtn } from './ui/authModal';

async function init(): Promise<void> {
  initAuthModal(() => render());
  bindAuthBtn();
  await restoreSession();
  await loadProgress();
  bindEvents();
  render();
}

void init();

let toastEl: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function getEl(): HTMLElement {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  return toastEl;
}

export function showToast(message: string, type: 'success' | 'ok' | 'error' | 'info' = 'info'): void {
  const el = getEl();
  el.textContent = message;
  el.className = `toast toast-${type} show`;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), 3500);
}

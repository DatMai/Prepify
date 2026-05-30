export function renderStreakBadge(current: number): void {
  const btn = document.getElementById('authBtn');
  if (!btn) return;

  let span = btn.querySelector<HTMLElement>('.auth-streak');

  if (current <= 0) {
    span?.remove();
    return;
  }

  if (!span) {
    span = document.createElement('span');
    span.className = 'auth-streak';
    btn.appendChild(span);
  }
  span.textContent = `🔥 ${current}`;
}

export function animateStreakIncrease(): void {
  const span = document.querySelector('#authBtn .auth-streak');
  if (!span) return;
  span.classList.remove('streak-bump');
  void (span as HTMLElement).offsetWidth;
  span.classList.add('streak-bump');
}

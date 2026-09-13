import { beforeEach, describe, expect, it } from 'vitest';
import { renderStreakBadge } from './streakBadge';

describe('renderStreakBadge', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button id="authBtn">Dat Mai</button>';
  });

  it('renders the streak with a decorative SVG icon instead of an emoji glyph', () => {
    renderStreakBadge(3);

    const badge = document.querySelector('.auth-streak');
    const icon = badge?.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    expect(icon?.classList.contains('app-icon')).toBe(true);
    expect(badge?.textContent).toContain('3');
  });
});

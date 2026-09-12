import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewSchedule } from './scheduler';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

const topic = {
  title: 'JavaScript',
  subtitle: '',
  label: 'JS',
  color: '#fff',
  sections: [
    {
      name: 'S',
      questions: [{ q: '<img src=x>', blocks: [{ type: 'text', text: 'Answer text' }] }],
    },
  ],
};

function dueSchedule(overrides: Partial<ReviewSchedule> = {}): ReviewSchedule {
  return {
    topic: 'javascript',
    sectionIdx: 0,
    questionIdx: 0,
    intervalDays: 1,
    ease: 2.5,
    reviewCount: 1,
    dueAt: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
}

describe('reviewView', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
  });

  it('shows the due question escaped and reveals the answer on demand', async () => {
    const { DATA } = await import('../data/loader');
    DATA['javascript'] = topic as never;
    const { reviewState } = await import('../state/review');
    reviewState.schedules = { k: dueSchedule() };
    const { openReviewOverlay } = await import('./reviewView');
    const grade = vi.fn().mockResolvedValue(null);

    await openReviewOverlay({ t: (key) => key, grade });

    expect(document.querySelector('.review-overlay.show')).not.toBeNull();
    expect(document.body.innerHTML).toContain('&lt;img');
    expect(document.body.textContent).not.toContain('Answer text');

    document.querySelector<HTMLButtonElement>('.review-reveal')!.click();
    expect(document.body.textContent).toContain('Answer text');
    expect(document.querySelectorAll('.review-grade-btn').length).toBe(3);
  });

  it('grades a card, advances, and shows a summary', async () => {
    const { DATA } = await import('../data/loader');
    DATA['javascript'] = topic as never;
    const { reviewState } = await import('../state/review');
    reviewState.schedules = { k: dueSchedule() };
    const { openReviewOverlay } = await import('./reviewView');
    const grade = vi.fn().mockResolvedValue(null);

    await openReviewOverlay({ t: (key) => key, grade });
    document.querySelector<HTMLButtonElement>('.review-reveal')!.click();
    document.querySelector<HTMLButtonElement>('.review-grade-btn[data-grade="again"]')!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(grade).toHaveBeenCalledWith('javascript', 0, 0, 'again');
    expect(document.body.textContent).toContain('review.summary');
  });

  it('shows the empty state when nothing is due', async () => {
    const { reviewState } = await import('../state/review');
    reviewState.schedules = {};
    const { openReviewOverlay } = await import('./reviewView');

    await openReviewOverlay({ t: (key) => key, grade: vi.fn() });

    expect(document.body.textContent).toContain('review.empty');
  });

  it('renders the due-count badge', async () => {
    const { reviewState } = await import('../state/review');
    reviewState.schedules = { a: dueSchedule(), b: dueSchedule() };
    const { renderReviewBadge } = await import('./reviewView');

    document.body.innerHTML = '<button id="reviewBtn"><span id="reviewCount">—</span></button>';
    renderReviewBadge();

    expect(document.getElementById('reviewCount')?.textContent).toBe('2');
  });
});

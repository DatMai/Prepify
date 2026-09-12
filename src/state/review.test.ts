import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('review state', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
  });

  it('computes and persists guest schedules', async () => {
    vi.doMock('./auth', () => ({ isLoggedIn: () => false }));
    const { gradeQuestion, keyOfReview, reviewState } = await import('./review');

    await gradeQuestion('javascript', 0, 1, 'good');

    const key = keyOfReview('javascript', 0, 1);
    expect(reviewState.schedules[key]).toMatchObject({ intervalDays: 7, reviewCount: 1 });
    const raw = JSON.parse(localStorage.getItem('quiz:review') ?? '{}');
    expect(raw[key].intervalDays).toBe(7);
  });

  it('delegates to the API when logged in', async () => {
    vi.doMock('./auth', () => ({ isLoggedIn: () => true }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          schedule: {
            topic: 'javascript',
            sectionIdx: 0,
            questionIdx: 1,
            intervalDays: 7,
            ease: 2.55,
            reviewCount: 1,
            dueAt: '2026-09-19T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const { gradeQuestion } = await import('./review');

    await gradeQuestion('javascript', 0, 1, 'good');

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:3001/api/v1/review/grade');
    expect(JSON.parse(String(init?.body))).toEqual({
      topic: 'javascript',
      sectionIdx: 0,
      questionIdx: 1,
      quality: 'good',
    });
  });

  it('counts only schedules due by now', async () => {
    vi.doMock('./auth', () => ({ isLoggedIn: () => false }));
    const { dueCount, reviewState } = await import('./review');

    reviewState.schedules = {
      a: {
        topic: 'javascript',
        sectionIdx: 0,
        questionIdx: 0,
        intervalDays: 1,
        ease: 2.5,
        reviewCount: 1,
        dueAt: new Date(Date.now() - 1000).toISOString(),
      },
      b: {
        topic: 'javascript',
        sectionIdx: 0,
        questionIdx: 1,
        intervalDays: 7,
        ease: 2.5,
        reviewCount: 1,
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    };

    expect(dueCount()).toBe(1);
  });
});

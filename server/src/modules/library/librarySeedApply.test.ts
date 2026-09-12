import { describe, expect, it, vi } from 'vitest';
import { applySeedPlan } from './librarySeed';
import type { SeedPlan } from './librarySeed';
import type { LibraryQuery } from './libraryRepository';

const plan: SeedPlan = {
  locale: 'vi',
  warnings: [],
  topics: [
    {
      key: 'js',
      locale: 'vi',
      label: 'JS',
      title: 'JS',
      subtitle: null,
      color: '#111111',
      position: 0,
      sections: [
        {
          position: 0,
          name: 'S1',
          questions: [
            { position: 0, code: 'Q1', prompt: 'one', blocks: [{ type: 'text', text: 'a' }] },
            { position: 1, code: 'Q2', prompt: 'two', blocks: [{ type: 'text', text: 'b' }] },
          ],
        },
      ],
    },
  ],
  daily: [
    {
      entryId: 'd-mcq-001',
      locale: 'vi',
      type: 'mcq',
      difficulty: 1,
      topicKey: 'js',
      ref: { topicKey: 'js', sectionIdx: 0, questionIdx: 1 },
      prompt: null,
      blanks: null,
      hint: null,
      position: 0,
    },
  ],
};

function memoryStore() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const topics: Array<{ key: string; locale: string; id: string }> = [];
  const sections: Array<{ id: string; topicId: string; position: number }> = [];
  const questions: Array<{ id: string; sectionId: string; position: number }> = [];
  const dailyEntries: string[] = [];
  let counter = 0;

  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] };

    if (text.startsWith('INSERT INTO library_topics')) {
      const [key, locale] = values as [string, string];
      if (topics.some((topic) => topic.key === key && topic.locale === locale)) return { rows: [] };
      const row = { key, locale, id: `topic-${++counter}` };
      topics.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith('INSERT INTO library_sections')) {
      const row = {
        id: `section-${++counter}`,
        topicId: values[0] as string,
        position: values[1] as number,
      };
      sections.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith('INSERT INTO library_questions')) {
      const row = {
        id: `question-${++counter}`,
        sectionId: values[0] as string,
        position: values[1] as number,
      };
      questions.push(row);
      return { rows: [{ id: row.id }] };
    }

    if (text.startsWith('INSERT INTO library_daily_entries')) {
      const entryId = values[0] as string;
      if (dailyEntries.includes(entryId)) return { rows: [] };
      dailyEntries.push(entryId);
      return { rows: [{ id: `daily-${++counter}` }] };
    }

    if (text.includes('AS question_position')) {
      const locale = values[0] as string;
      const rows = questions.flatMap((question) => {
        const section = sections.find((candidate) => candidate.id === question.sectionId);
        const topic = section && topics.find((candidate) => candidate.id === section.topicId);
        if (!section || !topic || topic.locale !== locale) return [];
        return [
          {
            key: topic.key,
            section_position: section.position,
            question_position: question.position,
            id: question.id,
          },
        ];
      });
      return { rows };
    }

    throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
  });

  function questionIdAt(
    topicKey: string,
    sectionPosition: number,
    questionPosition: number,
  ): string | undefined {
    const topic = topics.find((candidate) => candidate.key === topicKey);
    if (!topic) return undefined;
    const section = sections.find(
      (candidate) => candidate.topicId === topic.id && candidate.position === sectionPosition,
    );
    if (!section) return undefined;
    return questions.find(
      (candidate) => candidate.sectionId === section.id && candidate.position === questionPosition,
    )?.id;
  }

  return { query: query as unknown as LibraryQuery, calls, questionIdAt };
}

describe('applySeedPlan', () => {
  it('wraps everything in one transaction and resolves refs to question ids', async () => {
    const store = memoryStore();

    const summary = await applySeedPlan(store.query, plan);

    expect(store.calls[0]?.text).toBe('BEGIN');
    expect(store.calls.at(-1)?.text).toBe('COMMIT');
    expect(summary).toEqual({
      topics: 1,
      sections: 1,
      questions: 2,
      daily: 1,
      skippedTopics: 0,
      skippedDaily: 0,
    });
    const dailyInsert = store.calls.find((call) =>
      call.text.startsWith('INSERT INTO library_daily_entries'),
    );
    expect(dailyInsert?.values[4]).toBe(store.questionIdAt('js', 0, 1));
    expect(store.questionIdAt('js', 0, 1)).toBeTruthy();
  });

  it('is a no-op on a second run', async () => {
    const store = memoryStore();

    await applySeedPlan(store.query, plan);
    const second = await applySeedPlan(store.query, plan);

    expect(second).toEqual({
      topics: 0,
      sections: 0,
      questions: 0,
      daily: 0,
      skippedTopics: 1,
      skippedDaily: 1,
    });
  });

  it('rolls back and rethrows when a write fails', async () => {
    const store = memoryStore();
    const failing = vi.fn(async (text: string, values: unknown[] = []) => {
      if (text.startsWith('INSERT INTO library_sections')) throw new Error('boom');
      return store.query(text, values);
    });

    await expect(applySeedPlan(failing as unknown as LibraryQuery, plan)).rejects.toThrow('boom');
    expect(failing.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
  });

  it('throws when a Daily ref cannot be resolved', async () => {
    const store = memoryStore();
    const broken: SeedPlan = {
      ...plan,
      daily: [{ ...plan.daily[0]!, ref: { topicKey: 'js', sectionIdx: 9, questionIdx: 9 } }],
    };

    await expect(applySeedPlan(store.query, broken)).rejects.toThrow(/d-mcq-001/);
    expect(store.calls.at(-1)?.text).toBe('ROLLBACK');
  });
});

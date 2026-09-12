import { describe, expect, it } from 'vitest';
import { createLibraryAuthoring, LibraryConflictError } from './libraryAuthoring';
import type { LibraryQuery } from './libraryRepository';
import type { ImportDocument } from './libraryValidation';

type Responder = (text: string, values: unknown[]) => { rows: unknown[] } | undefined;

function harness(responder?: Responder) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const query = async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    const custom = responder?.(text, values);
    if (custom) return custom;
    if (text.includes('RETURNING id')) return { rows: [{ id: 'row-1' }] };
    return { rows: [] };
  };
  const withTransaction = async (fn: (tx: LibraryQuery) => Promise<unknown>) =>
    fn(query as unknown as LibraryQuery);
  return {
    calls,
    authoring: createLibraryAuthoring({
      query: query as unknown as LibraryQuery,
      withTransaction: withTransaction as never,
    }),
  };
}

const document: ImportDocument = {
  title: 'T',
  subtitle: null,
  label: 'L',
  color: '#000000',
  sections: [
    {
      name: 'S1',
      questions: [
        { code: 'Q1', prompt: 'one', level: 'basic', blocks: [{ type: 'text', text: 'a' }] },
      ],
    },
    {
      name: 'S2',
      questions: [
        { code: null, prompt: 'two', level: null, blocks: [] },
        { code: 'Q3', prompt: 'three', level: null, blocks: [] },
      ],
    },
  ],
};

describe('authoring repository — import', () => {
  it('updates metadata, appends every section and question, and reports the counts', async () => {
    const { authoring, calls } = harness();

    const summary = await authoring.importTopic({ topicId: 't-1', document, mode: 'append' });

    const metadata = calls.find((call) => call.text.includes('UPDATE library_topics'));
    expect(metadata?.text).toContain('title = $2');
    expect(metadata?.values).toEqual(['t-1', 'T', null, 'L', '#000000']);
    expect(calls.filter((call) => call.text.includes('INSERT INTO library_sections'))).toHaveLength(
      2,
    );
    expect(
      calls.filter((call) => call.text.includes('INSERT INTO library_questions')),
    ).toHaveLength(3);
    expect(summary).toEqual({ sections: 2, questions: 3 });
  });

  it('keeps the level of each imported question and stores blocks as jsonb', async () => {
    const { authoring, calls } = harness();

    await authoring.importTopic({ topicId: 't-1', document, mode: 'append' });

    const inserts = calls.filter((call) => call.text.includes('INSERT INTO library_questions'));
    expect(inserts[0]?.values.slice(1)).toEqual([
      'Q1',
      'one',
      'basic',
      JSON.stringify([{ type: 'text', text: 'a' }]),
    ]);
    expect(inserts[1]?.values.slice(1)).toEqual([null, 'two', null, '[]']);
    expect(inserts[2]?.values.slice(1)).toEqual(['Q3', 'three', null, '[]']);
  });

  it('clears the existing sections before appending when replacing', async () => {
    const { authoring, calls } = harness();

    await authoring.importTopic({ topicId: 't-1', document, mode: 'replace' });

    const deleteIndex = calls.findIndex((call) =>
      call.text.includes('DELETE FROM library_sections WHERE topic_id = $1'),
    );
    const insertIndex = calls.findIndex((call) =>
      call.text.includes('INSERT INTO library_sections'),
    );
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(deleteIndex);
  });

  it('refuses to replace while the Daily pool still points into the topic', async () => {
    const { authoring, calls } = harness((text) => {
      if (text.includes('FROM library_daily_entries d')) {
        return { rows: [{ entry_id: 'd-mcq-001' }] };
      }
      return undefined;
    });

    await expect(
      authoring.importTopic({ topicId: 't-1', document, mode: 'replace' }),
    ).rejects.toMatchObject({ code: 'library_in_use', entryIds: ['d-mcq-001'] });

    expect(calls.some((call) => call.text.includes('DELETE FROM library_sections'))).toBe(false);
  });

  it('appends without consulting the Daily pool', async () => {
    const { authoring, calls } = harness();

    await authoring.importTopic({ topicId: 't-1', document, mode: 'append' });

    expect(calls.some((call) => call.text.includes('FROM library_daily_entries'))).toBe(false);
  });

  it('fails as not found when the topic disappeared mid-import', async () => {
    const { authoring } = harness((text) => {
      if (text.includes('UPDATE library_topics')) return { rows: [] };
      return undefined;
    });

    await expect(
      authoring.importTopic({ topicId: 't-1', document, mode: 'append' }),
    ).rejects.toMatchObject({ code: 'library_not_found' });
  });
});

describe('authoring repository — Daily pool', () => {
  it('appends an entry at the end of its locale and stores blanks as jsonb', async () => {
    const { authoring, calls } = harness();

    const created = await authoring.createDailyEntry({
      entryId: 'd-fib-100',
      locale: 'vi',
      type: 'fib',
      difficulty: 2,
      prompt: 'A ___ resolves later.',
      blanks: ['promise'],
    });

    const insert = calls.find((call) => call.text.includes('INSERT INTO library_daily_entries'));
    expect(insert?.text).toContain('$8::jsonb');
    expect(insert?.text).toContain('COALESCE((SELECT MAX(position) + 1');
    expect(insert?.values).toContain(JSON.stringify(['promise']));
    expect(created).toEqual({ id: 'row-1' });
  });

  it('defaults every optional field to null', async () => {
    const { authoring, calls } = harness();

    await authoring.createDailyEntry({
      entryId: 'd-fib-101',
      locale: 'vi',
      type: 'fib',
      difficulty: 1,
      prompt: 'x',
      blanks: ['y'],
    });

    const insert = calls.find((call) => call.text.includes('INSERT INTO library_daily_entries'));
    // order is entryId, locale, type, difficulty, questionId, topicKey, prompt, blanks, hint, position
    expect(insert?.values.slice(4)).toEqual([null, null, 'x', JSON.stringify(['y']), null]);
  });

  it('reports a duplicate entry as a conflict', async () => {
    const { authoring } = harness(() => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });

    await expect(
      authoring.createDailyEntry({
        entryId: 'd-fib-100',
        locale: 'vi',
        type: 'fib',
        difficulty: 1,
        prompt: 'x',
        blanks: ['y'],
      }),
    ).rejects.toBeInstanceOf(LibraryConflictError);
  });

  it('reports a missing referenced question as not found', async () => {
    const { authoring } = harness(() => {
      throw Object.assign(new Error('fk violation'), { code: '23503' });
    });

    await expect(
      authoring.createDailyEntry({
        entryId: 'd-mcq-900',
        locale: 'vi',
        type: 'mcq',
        difficulty: 1,
        questionId: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      }),
    ).rejects.toMatchObject({ code: 'library_not_found' });
  });

  it('updates only the provided fields and 404s a missing entry', async () => {
    const { authoring, calls } = harness();

    await authoring.updateDailyEntry('d-1', { difficulty: 3 });

    const update = calls.find((call) => call.text.includes('UPDATE library_daily_entries'));
    expect(update?.text).toContain('difficulty = $1');
    expect(update?.values).toEqual([3, 'd-1']);

    const missing = harness((text) => {
      if (text.includes('UPDATE library_daily_entries')) return { rows: [] };
      return undefined;
    });
    await expect(
      missing.authoring.updateDailyEntry('gone', { difficulty: 3 }),
    ).rejects.toMatchObject({ code: 'library_not_found' });
  });

  it('clears blanks back to null', async () => {
    const { authoring, calls } = harness();

    await authoring.updateDailyEntry('d-1', { blanks: null });

    const update = calls.find((call) => call.text.includes('UPDATE library_daily_entries'));
    expect(update?.text).toContain('blanks = $1::jsonb');
    expect(update?.values).toEqual([null, 'd-1']);
  });

  it('lists entries for one locale, sorted and coerced', async () => {
    const { authoring, calls } = harness((text) => {
      if (text.includes('FROM library_daily_entries')) {
        return {
          rows: [
            {
              id: 'd-1',
              entry_id: 'd-mcq-001',
              locale: 'vi',
              type: 'mcq',
              difficulty: '1',
              question_id: 'q-1',
              topic_key: null,
              prompt: null,
              blanks: null,
              hint: null,
              position: '0',
            },
          ],
        };
      }
      return undefined;
    });

    const items = await authoring.listDailyEntries({ locale: 'vi' });

    expect(calls[0]?.values).toEqual(['vi']);
    expect(items[0]).toMatchObject({ id: 'd-1', difficulty: 1, position: 0, type: 'mcq' });
  });

  it('deletes an entry and 404s a missing one', async () => {
    const { authoring, calls } = harness();

    await authoring.deleteDailyEntry('d-1');
    expect(calls.at(-1)?.text).toContain('DELETE FROM library_daily_entries WHERE id = $1');

    const missing = harness((text) => {
      if (text.includes('DELETE FROM library_daily_entries')) return { rows: [] };
      return undefined;
    });
    await expect(missing.authoring.deleteDailyEntry('gone')).rejects.toMatchObject({
      code: 'library_not_found',
    });
  });
});

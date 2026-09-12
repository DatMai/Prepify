import { describe, expect, it, vi } from 'vitest';
import { createLibraryAuthoring, LibraryConflictError } from './libraryAuthoring';
import type { LibraryQuery } from './libraryRepository';

type Responder = (text: string, values: unknown[]) => { rows: unknown[] } | undefined;

/** Records every statement and answers inserts with a generated id. */
function harness(responder?: Responder) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
    const custom = responder?.(text, values);
    if (custom) return custom;
    if (text.includes('RETURNING id')) return { rows: [{ id: 'row-1' }] };
    return { rows: [] };
  });
  const withTransaction = vi.fn(async (fn: (tx: LibraryQuery) => Promise<unknown>) =>
    fn(query as unknown as LibraryQuery),
  );
  return {
    calls,
    withTransaction,
    authoring: createLibraryAuthoring({
      query: query as unknown as LibraryQuery,
      withTransaction: withTransaction as never,
    }),
  };
}

const newTopic = {
  key: 'system-design',
  locale: 'vi' as const,
  label: 'System Design',
  title: 'System Design',
  subtitle: null,
  color: '#123456',
};

describe('authoring repository — topics', () => {
  it('appends a new topic at the end of its locale', async () => {
    const { authoring, calls } = harness();

    const created = await authoring.createTopic(newTopic);

    const insert = calls.find((call) => call.text.includes('INSERT INTO library_topics'));
    expect(insert?.text).toContain('COALESCE((SELECT MAX(position) + 1');
    expect(insert?.values).toEqual([
      'system-design',
      'vi',
      'System Design',
      'System Design',
      null,
      '#123456',
    ]);
    expect(created).toEqual({ id: 'row-1' });
  });

  it('reports a duplicate topic as library_key_in_use', async () => {
    const { authoring } = harness(() => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    });

    await expect(authoring.createTopic(newTopic)).rejects.toBeInstanceOf(LibraryConflictError);
  });

  it('hides archived topics unless they are asked for', async () => {
    const { authoring, calls } = harness();

    await authoring.listTopics({ locale: 'vi' });
    await authoring.listTopics({ locale: 'vi', includeArchived: true });

    expect(calls[0]?.text).toContain('archived_at IS NULL');
    expect(calls[0]?.values).toEqual(['vi', false]);
    expect(calls[1]?.values).toEqual(['vi', true]);
  });

  it('maps the archived flag for an existing topic', async () => {
    const { authoring, calls } = harness((text) => {
      if (text.includes('FROM library_topics WHERE id = $1')) {
        return { rows: [{ id: 't-1', archived: true }] };
      }
      return undefined;
    });

    expect(await authoring.findTopicStatus('t-1')).toEqual({ id: 't-1', archived: true });
    expect(calls[0]?.text).toContain('archived_at IS NOT NULL');
  });

  it('returns null for an unknown topic', async () => {
    const { authoring } = harness();

    expect(await authoring.findTopicStatus('missing')).toBeNull();
  });

  it('reorders topics inside their locale and renumbers every row', async () => {
    const { authoring, calls, withTransaction } = harness((text) => {
      if (text.includes('SELECT locale FROM library_topics')) return { rows: [{ locale: 'vi' }] };
      if (text.startsWith('SELECT id FROM library_topics')) {
        return { rows: [{ id: 't-2' }, { id: 't-3' }, { id: 't-1' }] };
      }
      return undefined;
    });

    await authoring.updateTopic('t-1', { position: 0 });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    const writes = calls.filter((call) => call.text.includes('SET position'));
    expect(writes.map((call) => call.values)).toEqual([
      ['t-1', 0],
      ['t-2', 1],
      ['t-3', 2],
    ]);
  });

  it('updates only the provided metadata fields', async () => {
    const { authoring, calls } = harness((text) => {
      if (text.includes('SELECT locale FROM library_topics')) return { rows: [{ locale: 'vi' }] };
      return undefined;
    });

    await authoring.updateTopic('t-1', { title: 'New title' });

    const update = calls.find((call) => call.text.includes('UPDATE library_topics'));
    expect(update?.text).toContain('title = $1');
    expect(update?.text).not.toContain('label =');
    expect(update?.values).toEqual(['New title', 't-1']);
  });

  it('refuses to patch an unknown topic', async () => {
    const { authoring } = harness();

    await expect(authoring.updateTopic('missing', { title: 'x' })).rejects.toMatchObject({
      code: 'library_not_found',
    });
  });

  it('archives without passing a timestamp from JavaScript', async () => {
    const { authoring, calls } = harness();

    await authoring.setTopicArchived('t-1', true);

    const update = calls.at(-1);
    expect(update?.text).toContain('CASE WHEN $2::boolean THEN now() ELSE NULL END');
    expect(update?.values).toEqual(['t-1', true]);
  });

  it('exports the topic as an importable document', async () => {
    const { authoring } = harness((text) => {
      if (text.startsWith('SELECT id, key, locale, label, title, subtitle, color, position')) {
        return {
          rows: [
            {
              id: 't-1',
              key: 'dsa',
              locale: 'vi',
              label: 'DSA',
              title: 'Data Structures',
              subtitle: '*sub*',
              color: '#B71C1C',
              position: 0,
              archived: false,
            },
          ],
        };
      }
      if (text.includes('AS section_id')) {
        return {
          rows: [
            {
              section_id: 's-1',
              section_position: 0,
              section_name: 'Phần I',
              question_id: 'q-1',
              question_position: 0,
              code: 'Q1',
              prompt: 'Array là gì?',
              level: 'basic',
              blocks: [{ type: 'text', text: 'a' }],
            },
            {
              section_id: 's-2',
              section_position: 1,
              section_name: 'Phần II',
              question_id: null,
              question_position: null,
              code: null,
              prompt: null,
              level: null,
              blocks: null,
            },
          ],
        };
      }
      return undefined;
    });

    const document = await authoring.exportTopicDocument('t-1');

    expect(document).toEqual({
      title: 'Data Structures',
      subtitle: '*sub*',
      label: 'DSA',
      color: '#B71C1C',
      sections: [
        {
          name: 'Phần I',
          questions: [
            {
              code: 'Q1',
              prompt: 'Array là gì?',
              level: 'basic',
              blocks: [{ type: 'text', text: 'a' }],
            },
          ],
        },
        { name: 'Phần II', questions: [] },
      ],
    });
  });

  it('exports null for an unknown topic', async () => {
    const { authoring } = harness();

    expect(await authoring.exportTopicDocument('missing')).toBeNull();
  });
});

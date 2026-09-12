import { describe, expect, it } from 'vitest';
import { createLibraryAuthoring } from './libraryAuthoring';
import type { LibraryQuery } from './libraryRepository';

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

function reorderResponder(scope: 'section' | 'question', storedOrder: string[]): Responder {
  return (text) => {
    if (scope === 'question') {
      if (text.includes('SELECT section_id FROM library_questions')) {
        return { rows: [{ section_id: 's-1' }] };
      }
      if (text.startsWith('SELECT id FROM library_questions')) {
        return { rows: storedOrder.map((id) => ({ id })) };
      }
    }
    if (scope === 'section') {
      if (text.includes('SELECT topic_id FROM library_sections')) {
        return { rows: [{ topic_id: 't-1' }] };
      }
      if (text.startsWith('SELECT id FROM library_sections')) {
        return { rows: storedOrder.map((id) => ({ id })) };
      }
    }
    return undefined;
  };
}

describe('authoring repository — sections', () => {
  it('appends a section at the end of its topic', async () => {
    const { authoring, calls } = harness();

    const created = await authoring.createSection({ topicId: 't-1', name: 'Phần II' });

    const insert = calls.find((call) => call.text.includes('INSERT INTO library_sections'));
    expect(insert?.text).toContain('COALESCE((SELECT MAX(position) + 1');
    expect(insert?.values).toEqual(['t-1', 'Phần II']);
    expect(created).toEqual({ id: 'row-1' });
  });

  it('renames a section without rewriting positions', async () => {
    const { authoring, calls } = harness(reorderResponder('section', ['s-1']));

    await authoring.updateSection('s-1', { name: 'Phần I (mới)' });

    const update = calls.find((call) => call.text.includes('UPDATE library_sections'));
    expect(update?.text).toContain('name = $1');
    expect(update?.values).toEqual(['Phần I (mới)', 's-1']);
    expect(calls.some((call) => call.text.includes('SET position'))).toBe(false);
  });

  it('renumbers sections when one moves to the front', async () => {
    const { authoring, calls } = harness(reorderResponder('section', ['s-2', 's-3', 's-1']));

    await authoring.updateSection('s-1', { position: 0 });

    const writes = calls.filter((call) => call.text.includes('SET position'));
    expect(writes.map((call) => call.values)).toEqual([
      ['s-1', 0],
      ['s-2', 1],
      ['s-3', 2],
    ]);
  });

  it('refuses to patch an unknown section', async () => {
    const { authoring } = harness();

    await expect(authoring.updateSection('missing', { name: 'x' })).rejects.toMatchObject({
      code: 'library_not_found',
    });
  });

  it('deletes a section and all sections of a topic with one statement each', async () => {
    const { authoring, calls } = harness();

    await authoring.deleteSection('s-1');
    expect(calls.at(-1)?.text).toContain('DELETE FROM library_sections WHERE id = $1');
    expect(calls.at(-1)?.values).toEqual(['s-1']);

    await authoring.deleteSectionsForTopic('t-1');
    expect(calls.at(-1)?.text).toContain('DELETE FROM library_sections WHERE topic_id = $1');
    expect(calls.at(-1)?.values).toEqual(['t-1']);
  });
});

describe('authoring repository — questions', () => {
  it('appends a question at the end of its section, keeping level null when omitted', async () => {
    const { authoring, calls } = harness();

    const created = await authoring.createQuestion({
      sectionId: 's-1',
      code: 'Q9',
      prompt: 'Câu mới',
      level: null,
      blocks: [{ type: 'text', text: 'x' }],
    });

    const insert = calls.find((call) => call.text.includes('INSERT INTO library_questions'));
    expect(insert?.text).toContain('COALESCE((SELECT MAX(position) + 1');
    expect(insert?.values).toEqual([
      's-1',
      'Q9',
      'Câu mới',
      null,
      JSON.stringify([{ type: 'text', text: 'x' }]),
    ]);
    expect(created).toEqual({ id: 'row-1' });
  });

  it('casts blocks to jsonb when they are replaced', async () => {
    const { authoring, calls } = harness(reorderResponder('question', ['q-1']));

    await authoring.updateQuestion('q-1', { blocks: [{ type: 'text', text: 'z' }] });

    const update = calls.find((call) => call.text.includes('UPDATE library_questions'));
    expect(update?.text).toContain('blocks = $1::jsonb');
    expect(update?.values).toEqual([JSON.stringify([{ type: 'text', text: 'z' }]), 'q-1']);
  });

  it('clears a level back to null, because null is a real value here', async () => {
    const { authoring, calls } = harness(reorderResponder('question', ['q-1']));

    await authoring.updateQuestion('q-1', { level: null });

    const update = calls.find((call) => call.text.includes('UPDATE library_questions'));
    expect(update?.text).toContain('level = $1');
    expect(update?.values).toEqual([null, 'q-1']);
  });

  it('renumbers every sibling position when a question moves to the front', async () => {
    const { authoring, calls } = harness(reorderResponder('question', ['q-2', 'q-3', 'q-1']));

    await authoring.updateQuestion('q-1', { position: 0 });

    const writes = calls.filter((call) => call.text.includes('SET position'));
    expect(writes.map((call) => call.values)).toEqual([
      ['q-1', 0],
      ['q-2', 1],
      ['q-3', 2],
    ]);
  });

  it('clamps a position past the end instead of leaving a gap', async () => {
    const { authoring, calls } = harness(reorderResponder('question', ['q-2', 'q-3', 'q-1']));

    await authoring.updateQuestion('q-1', { position: 99 });

    const writes = calls.filter((call) => call.text.includes('SET position'));
    expect(writes.map((call) => call.values)).toEqual([
      ['q-2', 0],
      ['q-3', 1],
      ['q-1', 2],
    ]);
  });

  it('refuses to patch an unknown question', async () => {
    const { authoring } = harness();

    await expect(authoring.updateQuestion('missing', { prompt: 'x' })).rejects.toMatchObject({
      code: 'library_not_found',
    });
  });

  it('deletes a question with one statement', async () => {
    const { authoring, calls } = harness();

    await authoring.deleteQuestion('q-1');

    expect(calls.at(-1)?.text).toContain('DELETE FROM library_questions WHERE id = $1');
    expect(calls.at(-1)?.values).toEqual(['q-1']);
  });
});

describe('authoring repository — reference guards', () => {
  it('lists the Daily entries that still point at a question, a section or a topic', async () => {
    const { authoring, calls } = harness((text) => {
      if (text.includes('SELECT entry_id FROM library_daily_entries')) {
        return { rows: [{ entry_id: 'd-mcq-001' }] };
      }
      if (text.includes('WHERE q.section_id = $1')) {
        return { rows: [{ entry_id: 'd-mcq-002' }] };
      }
      if (text.includes('FROM library_daily_entries d')) {
        return { rows: [{ entry_id: 'd-mcq-003' }] };
      }
      return undefined;
    });

    expect(await authoring.listDailyReferencesForQuestion('q-1')).toEqual(['d-mcq-001']);
    expect(await authoring.listDailyReferencesForSection('s-1')).toEqual(['d-mcq-002']);
    expect(await authoring.listDailyReferencesForTopic('t-1')).toEqual(['d-mcq-003']);
    expect(calls).toHaveLength(3);
  });

  it('resolves the owning topic for a section and for a question', async () => {
    const { authoring } = harness((text) => {
      if (text.startsWith('SELECT topic_id FROM library_sections')) {
        return { rows: [{ topic_id: 't-1' }] };
      }
      if (text.includes('SELECT s.topic_id FROM library_questions q')) {
        return { rows: [{ topic_id: 't-2' }] };
      }
      return undefined;
    });

    expect(await authoring.findTopicIdForSection('s-1')).toBe('t-1');
    expect(await authoring.findTopicIdForQuestion('q-1')).toBe('t-2');
  });

  it('returns null when the row is gone', async () => {
    const { authoring } = harness();

    expect(await authoring.findTopicIdForSection('missing')).toBeNull();
    expect(await authoring.findTopicIdForQuestion('missing')).toBeNull();
  });
});

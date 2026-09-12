import { describe, expect, it, vi } from 'vitest';
import { createLibraryRepository } from './libraryRepository';

describe('createLibraryRepository', () => {
  it('projects the topic index with question counts and hides archived topics', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          key: 'dsa',
          label: 'DSA',
          title: 'Data Structures & Algorithms',
          subtitle: 'sub',
          color: '#B71C1C',
          question_count: 58,
        },
      ],
    });
    const repo = createLibraryRepository({ query });

    const topics = await repo.listTopics({ locale: 'vi' });

    expect(query.mock.calls[0]?.[0]).toContain('archived_at IS NULL');
    expect(topics).toEqual([
      {
        key: 'dsa',
        label: 'DSA',
        title: 'Data Structures & Algorithms',
        subtitle: 'sub',
        color: '#B71C1C',
        questionCount: 58,
      },
    ]);
  });

  it('projects a topic with its sections and maps code back into id', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'T', subtitle: null, label: 'L', color: '#000000' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            section_id: 's1',
            section_name: 'Phần I',
            question_id: 'q1',
            code: 'Q1',
            prompt: 'Array là gì?',
            blocks: [{ type: 'text', text: 'a' }],
          },
          {
            section_id: 's1',
            section_name: 'Phần I',
            question_id: 'q2',
            code: null,
            prompt: 'Câu 2',
            blocks: [{ type: 'text', text: 'b' }],
          },
        ],
      });
    const repo = createLibraryRepository({ query });

    const topic = await repo.getTopic({ key: 'dsa', locale: 'vi' });

    expect(topic).toEqual({
      title: 'T',
      label: 'L',
      color: '#000000',
      sections: [
        {
          name: 'Phần I',
          questions: [
            { id: 'Q1', q: 'Array là gì?', blocks: [{ type: 'text', text: 'a' }] },
            { id: null, q: 'Câu 2', blocks: [{ type: 'text', text: 'b' }] },
          ],
        },
      ],
    });
  });

  it('splits sections by id, not by name, so duplicate names stay separate', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'T', subtitle: null, label: 'L', color: '#000000' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            section_id: 's1',
            section_name: 'Ôn tập',
            question_id: 'q1',
            code: 'Q1',
            prompt: 'one',
            blocks: [],
          },
          {
            section_id: 's2',
            section_name: 'Ôn tập',
            question_id: 'q2',
            code: 'Q2',
            prompt: 'two',
            blocks: [],
          },
        ],
      });
    const repo = createLibraryRepository({ query });

    const topic = await repo.getTopic({ key: 'dsa', locale: 'vi' });

    expect(topic?.sections).toHaveLength(2);
    expect(topic?.sections.map((section) => section.questions[0]?.id)).toEqual(['Q1', 'Q2']);
  });

  it('returns null for an unknown topic', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = createLibraryRepository({ query });

    expect(await repo.getTopic({ key: 'missing', locale: 'vi' })).toBeNull();
  });

  it('omits subtitle when it is null, matching the corpus files', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'T', subtitle: null, label: 'L', color: '#000000' }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const repo = createLibraryRepository({ query });

    const topic = await repo.getTopic({ key: 'dsa', locale: 'vi' });

    expect(topic).not.toBeNull();
    expect(Object.keys(topic ?? {})).not.toContain('subtitle');
  });

  it('keeps empty sections and maps Daily entries', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'T', subtitle: null, label: 'L', color: '#000000' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            section_id: 's1',
            section_name: 'Empty',
            question_id: null,
            code: null,
            prompt: null,
            blocks: null,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            entry_id: 'd-mcq-001',
            type: 'mcq',
            difficulty: 1,
            question_id: 'q1',
            topic_key: null,
            prompt: null,
            blanks: null,
            hint: null,
          },
        ],
      });
    const repo = createLibraryRepository({ query });

    const topic = await repo.getTopic({ key: 'dsa', locale: 'vi' });
    const entries = await repo.listDailyEntries({ locale: 'vi' });

    expect(topic?.sections).toEqual([{ name: 'Empty', questions: [] }]);
    expect(entries).toEqual([
      {
        entryId: 'd-mcq-001',
        type: 'mcq',
        difficulty: 1,
        questionId: 'q1',
        topicKey: null,
        prompt: null,
        blanks: null,
        hint: null,
      },
    ]);
  });

  it('resolves a question and its sibling answer blocks', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ blocks: [{ type: 'text', text: 'answer' }], prompt: 'Closure là gì?' }],
      })
      .mockResolvedValueOnce({
        rows: [{ blocks: [{ type: 'text', text: 'sibling' }] }],
      });
    const repo = createLibraryRepository({ query });

    const question = await repo.getQuestion({ questionId: 'q1' });
    const siblings = await repo.listSiblingBlocks({
      topicKey: 'javascript',
      locale: 'vi',
      excludeQuestionId: 'q1',
    });

    expect(question).toEqual({
      blocks: [{ type: 'text', text: 'answer' }],
      questionText: 'Closure là gì?',
    });
    expect(siblings).toEqual([[{ type: 'text', text: 'sibling' }]]);
  });

  it('returns null when the referenced question is gone', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = createLibraryRepository({ query });

    expect(await repo.getQuestion({ questionId: 'missing' })).toBeNull();
  });
});

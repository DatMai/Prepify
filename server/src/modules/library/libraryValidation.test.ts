import { describe, expect, it } from 'vitest';
import {
  dailyEntryCreateSchema,
  formatValidationIssue,
  importRequestSchema,
  normalizeImportDocument,
  questionPatchSchema,
  topicCreateSchema,
  topicPatchSchema,
} from './libraryValidation';

describe('topic contracts', () => {
  it('accepts a valid create and rejects a bad key, locale or colour', () => {
    const valid = {
      key: 'system-design',
      locale: 'vi',
      label: 'System Design',
      title: 'System Design',
      color: '#123abc',
    };
    expect(topicCreateSchema.safeParse(valid).success).toBe(true);
    expect(topicCreateSchema.safeParse({ ...valid, key: 'Bad_Key' }).success).toBe(false);
    expect(topicCreateSchema.safeParse({ ...valid, locale: 'fr' }).success).toBe(false);
    expect(topicCreateSchema.safeParse({ ...valid, color: 'red' }).success).toBe(false);
    expect(topicCreateSchema.safeParse({ ...valid, key: 'a' }).success).toBe(false);
  });

  it('never accepts a key change on patch', () => {
    expect(topicPatchSchema.safeParse({ title: 'New' }).success).toBe(true);
    expect(topicPatchSchema.safeParse({ key: 'renamed' }).success).toBe(false);
    expect(topicPatchSchema.safeParse({}).success).toBe(false);
  });
});

describe('question contracts', () => {
  it('accepts a partial patch but rejects an empty one', () => {
    expect(questionPatchSchema.safeParse({ level: 'basic' }).success).toBe(true);
    expect(questionPatchSchema.safeParse({ level: null }).success).toBe(true);
    expect(questionPatchSchema.safeParse({ position: 0 }).success).toBe(true);
    expect(questionPatchSchema.safeParse({}).success).toBe(false);
    expect(questionPatchSchema.safeParse({ level: 'expert' }).success).toBe(false);
  });
});

describe('daily entry contracts', () => {
  const questionId = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

  it('requires a question for mcq and prompt plus blanks for fib', () => {
    const mcq = { entryId: 'd-1', locale: 'vi', type: 'mcq', difficulty: 1, questionId };
    expect(dailyEntryCreateSchema.safeParse(mcq).success).toBe(true);
    expect(dailyEntryCreateSchema.safeParse({ ...mcq, questionId: null }).success).toBe(false);
    expect(dailyEntryCreateSchema.safeParse({ ...mcq, questionId: 'q-1' }).success).toBe(false);

    const fib = {
      entryId: 'd-2',
      locale: 'vi',
      type: 'fib',
      difficulty: 2,
      prompt: 'A ___ is a promise.',
      blanks: ['future'],
    };
    expect(dailyEntryCreateSchema.safeParse(fib).success).toBe(true);
    expect(dailyEntryCreateSchema.safeParse({ ...fib, blanks: null }).success).toBe(false);
  });

  it('rejects a difficulty outside 1..3', () => {
    const entry = { entryId: 'd-1', locale: 'vi', type: 'mcq', difficulty: 4, questionId };
    expect(dailyEntryCreateSchema.safeParse(entry).success).toBe(false);
  });
});

describe('import document', () => {
  it('accepts the corpus shape, including id instead of code, and normalizes it', () => {
    const parsed = importRequestSchema.safeParse({
      mode: 'replace',
      document: {
        title: 'DSA',
        subtitle: '*sub*',
        label: 'DSA',
        color: '#B71C1C',
        sections: [
          {
            name: 'Phần I',
            questions: [
              { id: 'Q1', q: 'Array là gì?', blocks: [{ type: 'text', text: 'a' }] },
              {
                code: 'Q2',
                level: 'basic',
                q: 'Linked list?',
                blocks: [{ type: 'text', text: 'b' }],
              },
            ],
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);

    const normalized = normalizeImportDocument(
      parsed.success ? parsed.data.document : ({} as never),
    );

    expect(normalized.sections[0]?.questions).toEqual([
      { code: 'Q1', prompt: 'Array là gì?', level: null, blocks: [{ type: 'text', text: 'a' }] },
      { code: 'Q2', prompt: 'Linked list?', level: 'basic', blocks: [{ type: 'text', text: 'b' }] },
    ]);
    expect(normalized.subtitle).toBe('*sub*');
  });

  it('prefers code over id and defaults subtitle to null', () => {
    const parsed = importRequestSchema.safeParse({
      mode: 'append',
      document: {
        title: 'T',
        label: 'L',
        color: '#000000',
        sections: [
          {
            name: 'S',
            questions: [{ id: 'OLD', code: 'NEW', q: 'q', blocks: [{ type: 'text', text: 'x' }] }],
          },
        ],
      },
    });

    const normalized = normalizeImportDocument(
      parsed.success ? parsed.data.document : ({} as never),
    );

    expect(normalized.sections[0]?.questions[0]?.code).toBe('NEW');
    expect(normalized.subtitle).toBeNull();
  });

  it('reports the failing path with array indices', () => {
    const parsed = importRequestSchema.safeParse({
      mode: 'replace',
      document: {
        title: 'T',
        label: 'L',
        color: '#000000',
        sections: [
          {
            name: 'S',
            questions: [
              { code: 'Q1', q: 'ok', blocks: [] },
              { code: 'Q2', q: 'bad', blocks: [{ type: 'image', src: 'nope' }] },
            ],
          },
        ],
      },
    });

    expect(parsed.success).toBe(false);
    const issue = formatValidationIssue(parsed.success ? ({} as never) : parsed.error);
    // the path is relative to the request body, so it names the nested document
    expect(issue.path).toBe('document.sections[0].questions[1].blocks[0].type');
  });
});

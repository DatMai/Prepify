import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLibraryRepository, type LibraryQuery } from './libraryRepository';
import { applySeedPlan, buildSeedPlan } from './librarySeed';

const CORPUS = path.resolve(__dirname, '../../../../server/test-fixtures/content');

interface TopicRow {
  id: string;
  key: string;
  locale: string;
  label: string;
  title: string;
  subtitle: string | null;
  color: string;
  position: number;
  archived_at: null;
}

interface SectionRow {
  id: string;
  topic_id: string;
  position: number;
  name: string;
}

interface QuestionRow {
  id: string;
  section_id: string;
  position: number;
  code: string | null;
  prompt: string;
  blocks: unknown[];
}

interface DailyRow {
  id: string;
  entry_id: string;
  locale: string;
  type: string;
  difficulty: number;
  question_id: string | null;
  topic_key: string | null;
  prompt: string | null;
  blanks: unknown;
  hint: string | null;
  position: number;
}

/** In-memory stand-in for the four tables: no database, so CI can run this. */
function memoryLibrary() {
  const topics: TopicRow[] = [];
  const sections: SectionRow[] = [];
  const questions: QuestionRow[] = [];
  const daily: DailyRow[] = [];
  let counter = 0;

  const query = (async <Row>(text: string, values: unknown[] = []) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] as Row[] };

    if (text.startsWith('INSERT INTO library_topics')) {
      const [key, locale] = values as [string, string];
      if (topics.some((topic) => topic.key === key && topic.locale === locale)) {
        return { rows: [] as Row[] };
      }
      const row: TopicRow = {
        id: `topic-${++counter}`,
        key,
        locale,
        label: values[2] as string,
        title: values[3] as string,
        subtitle: (values[4] as string | null) ?? null,
        color: values[5] as string,
        position: values[6] as number,
        archived_at: null,
      };
      topics.push(row);
      return { rows: [{ id: row.id }] as Row[] };
    }

    if (text.startsWith('INSERT INTO library_sections')) {
      const row: SectionRow = {
        id: `section-${++counter}`,
        topic_id: values[0] as string,
        position: values[1] as number,
        name: values[2] as string,
      };
      sections.push(row);
      return { rows: [{ id: row.id }] as Row[] };
    }

    if (text.startsWith('INSERT INTO library_questions')) {
      const row: QuestionRow = {
        id: `question-${++counter}`,
        section_id: values[0] as string,
        position: values[1] as number,
        code: (values[2] as string | null) ?? null,
        prompt: values[3] as string,
        blocks: JSON.parse(String(values[4])) as unknown[],
      };
      questions.push(row);
      return { rows: [{ id: row.id }] as Row[] };
    }

    if (text.startsWith('INSERT INTO library_daily_entries')) {
      const entryId = values[0] as string;
      const locale = values[1] as string;
      if (daily.some((row) => row.entry_id === entryId && row.locale === locale)) {
        return { rows: [] as Row[] };
      }
      const row: DailyRow = {
        id: `daily-${++counter}`,
        entry_id: entryId,
        locale,
        type: values[2] as string,
        difficulty: values[3] as number,
        question_id: (values[4] as string | null) ?? null,
        topic_key: (values[5] as string | null) ?? null,
        prompt: (values[6] as string | null) ?? null,
        blanks: values[7] ? (JSON.parse(String(values[7])) as unknown) : null,
        hint: (values[8] as string | null) ?? null,
        position: values[9] as number,
      };
      daily.push(row);
      return { rows: [{ id: row.id }] as Row[] };
    }

    if (text.includes('SELECT entry_id, type, difficulty')) {
      const locale = values[0] as string;
      const rows = daily
        .filter((row) => row.locale === locale)
        .sort((a, b) => a.position - b.position || a.entry_id.localeCompare(b.entry_id))
        .map((row) => ({
          entry_id: row.entry_id,
          type: row.type,
          difficulty: row.difficulty,
          question_id: row.question_id,
          topic_key: row.topic_key,
          prompt: row.prompt,
          blanks: row.blanks,
          hint: row.hint,
        }));
      return { rows: rows as Row[] };
    }

    if (text.includes('AS question_position')) {
      const locale = values[0] as string;
      const rows = questions.flatMap((question) => {
        const section = sections.find((candidate) => candidate.id === question.section_id);
        const topic = section && topics.find((candidate) => candidate.id === section.topic_id);
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
      return { rows: rows as Row[] };
    }

    if (text.includes('AS question_count')) {
      const locale = values[0] as string;
      const rows = topics
        .filter((topic) => topic.locale === locale && topic.archived_at === null)
        .sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
        .map((topic) => ({
          key: topic.key,
          label: topic.label,
          title: topic.title,
          subtitle: topic.subtitle,
          color: topic.color,
          question_count: questions.filter((question) =>
            sections.some(
              (section) => section.id === question.section_id && section.topic_id === topic.id,
            ),
          ).length,
        }));
      return { rows: rows as Row[] };
    }

    if (text.includes('SELECT id, title, subtitle, label, color')) {
      const [key, locale] = values as [string, string];
      const topic = topics.find(
        (candidate) =>
          candidate.key === key && candidate.locale === locale && candidate.archived_at === null,
      );
      return {
        rows: (topic
          ? [
              {
                id: topic.id,
                title: topic.title,
                subtitle: topic.subtitle,
                label: topic.label,
                color: topic.color,
              },
            ]
          : []) as Row[],
      };
    }

    if (text.includes('AS section_id')) {
      const topicId = values[0] as string;
      const rows: Array<{
        section_id: string;
        section_name: string;
        question_id: string | null;
        code: string | null;
        prompt: string | null;
        blocks: unknown[] | null;
      }> = [];
      const orderedSections = sections
        .filter((section) => section.topic_id === topicId)
        .sort((a, b) => a.position - b.position);
      for (const section of orderedSections) {
        const items = questions
          .filter((question) => question.section_id === section.id)
          .sort((a, b) => a.position - b.position);
        if (items.length === 0) {
          rows.push({
            section_id: section.id,
            section_name: section.name,
            question_id: null,
            code: null,
            prompt: null,
            blocks: null,
          });
          continue;
        }
        for (const question of items) {
          rows.push({
            section_id: section.id,
            section_name: section.name,
            question_id: question.id,
            code: question.code,
            prompt: question.prompt,
            blocks: question.blocks,
          });
        }
      }
      return { rows: rows as Row[] };
    }

    throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
  }) as LibraryQuery;

  return { query, topics, sections, questions, daily };
}

interface IndexFileEntry {
  key: string;
  label: string;
  title: string;
  subtitle?: string;
  color: string;
  questionCount?: number;
}

interface TopicFileShape {
  title: string;
  subtitle?: string;
  label: string;
  color: string;
  sections: Array<{
    name: string;
    questions: Array<{ id?: string; q: string; blocks: unknown[] }>;
  }>;
}

describe('seed → projection fidelity for the synthetic vi fixture corpus', () => {
  const store = memoryLibrary();
  const repo = createLibraryRepository({ query: store.query });
  const plan = buildSeedPlan(CORPUS, 'vi');

  it('seeds the corpus exactly once', async () => {
    const first = await applySeedPlan(store.query, plan);

    expect(first.topics).toBe(1);
    expect(first.questions).toBe(1);
    expect(first.daily).toBe(2);
    expect(store.sections).toHaveLength(1);

    const second = await applySeedPlan(store.query, plan);
    expect(second.topics).toBe(0);
    expect(second.questions).toBe(0);
    expect(second.skippedTopics).toBe(1);
    expect(second.skippedDaily).toBe(2);
    expect(store.topics).toHaveLength(1);
    expect(store.questions).toHaveLength(1);
    expect(store.daily).toHaveLength(2);
  });

  it('reproduces the index file exactly', async () => {
    const expected = JSON.parse(
      fs.readFileSync(path.join(CORPUS, 'index.json'), 'utf8'),
    ) as IndexFileEntry[];

    const actual = await repo.listTopics({ locale: 'vi' });

    expect(actual).toEqual(
      expected.map((entry) => ({
        key: entry.key,
        label: entry.label,
        title: entry.title,
        subtitle: entry.subtitle ?? null,
        color: entry.color,
        questionCount: 1,
      })),
    );
  });

  it('reproduces every topic file exactly', async () => {
    const index = JSON.parse(
      fs.readFileSync(path.join(CORPUS, 'index.json'), 'utf8'),
    ) as IndexFileEntry[];

    for (const { key } of index) {
      const file = JSON.parse(
        fs.readFileSync(path.join(CORPUS, `${key}.json`), 'utf8'),
      ) as TopicFileShape;

      const projected = await repo.getTopic({ key, locale: 'vi' });

      expect(projected, key).toEqual({
        title: file.title,
        ...(file.subtitle === undefined ? {} : { subtitle: file.subtitle }),
        label: file.label,
        color: file.color,
        sections: file.sections.map((section) => ({
          name: section.name,
          questions: section.questions.map((question) => ({
            id: question.id ?? null,
            q: question.q,
            blocks: question.blocks,
          })),
        })),
      });
    }
  });

  it('reproduces the Daily pool metadata', async () => {
    const expected = JSON.parse(fs.readFileSync(path.join(CORPUS, 'daily.json'), 'utf8')) as {
      pool: Array<{
        id: string;
        type: string;
        difficulty: number;
        ref?: { topicKey: string; sectionIdx: number; questionIdx: number };
        topic?: string;
        prompt?: string;
        blanks?: string[];
        hint?: string;
      }>;
    };

    const entries = await repo.listDailyEntries({ locale: 'vi' });

    expect(entries).toHaveLength(expected.pool.length);
    expect(
      entries.map((entry) => ({
        entryId: entry.entryId,
        type: entry.type,
        difficulty: entry.difficulty,
        topicKey: entry.topicKey,
        prompt: entry.prompt,
        blanks: entry.blanks,
        hint: entry.hint,
      })),
    ).toEqual(
      expected.pool.map((entry) => ({
        entryId: entry.id,
        type: entry.type === 'fib' ? 'fib' : 'mcq',
        difficulty: entry.difficulty,
        topicKey: entry.ref?.topicKey ?? entry.topic ?? null,
        prompt: entry.prompt ?? null,
        blanks: entry.blanks ?? null,
        hint: entry.hint ?? null,
      })),
    );

    expect(entries.find((entry) => entry.entryId === 'fixture-fib-1')).toMatchObject({
      type: 'fib',
      prompt: 'A test-only ___ exercises fill-in-the-blank seeding.',
      blanks: ['fixture'],
      hint: 'Synthetic data',
    });
  });

  it('resolves every mcq Daily entry to the question the file pointed at', async () => {
    const expected = JSON.parse(fs.readFileSync(path.join(CORPUS, 'daily.json'), 'utf8')) as {
      pool: Array<{
        id: string;
        type: string;
        ref?: { topicKey: string; sectionIdx: number; questionIdx: number };
      }>;
    };

    for (const entry of expected.pool.filter((candidate) => candidate.ref)) {
      const ref = entry.ref!;
      const file = JSON.parse(
        fs.readFileSync(path.join(CORPUS, `${ref.topicKey}.json`), 'utf8'),
      ) as TopicFileShape;
      const expectedPrompt = file.sections[ref.sectionIdx]?.questions[ref.questionIdx]?.q;

      const topic = await repo.getTopic({ key: ref.topicKey, locale: 'vi' });
      const actualPrompt = topic?.sections[ref.sectionIdx]?.questions[ref.questionIdx]?.q;

      expect(
        actualPrompt,
        `${entry.id} -> ${ref.topicKey}[${ref.sectionIdx}][${ref.questionIdx}]`,
      ).toBe(expectedPrompt);
    }
  });
});

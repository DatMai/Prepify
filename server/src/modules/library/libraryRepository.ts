import type { Block } from './libraryBlocks';

export type Locale = 'vi' | 'en';

export interface LibraryQuery {
  <Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface TopicIndexEntry {
  key: string;
  label: string;
  title: string;
  subtitle: string | null;
  color: string;
  questionCount: number;
}

export interface ProjectedQuestion {
  id: string | null;
  q: string;
  blocks: Block[];
}

export interface ProjectedSection {
  name: string;
  questions: ProjectedQuestion[];
}

export interface ProjectedTopic {
  title: string;
  subtitle?: string;
  label: string;
  color: string;
  sections: ProjectedSection[];
}

export interface DailyEntryRecord {
  entryId: string;
  type: 'mcq' | 'fib';
  difficulty: number;
  questionId: string | null;
  topicKey: string | null;
  prompt: string | null;
  blanks: string[] | null;
  hint: string | null;
}

interface TopicRow extends Record<string, unknown> {
  id: string;
  title: string;
  subtitle: string | null;
  label: string;
  color: string;
}

interface TopicIndexRow extends Record<string, unknown> {
  key: string;
  label: string;
  title: string;
  subtitle: string | null;
  color: string;
  question_count: number;
}

interface SectionQuestionRow extends Record<string, unknown> {
  section_id: string;
  section_name: string;
  question_id: string | null;
  code: string | null;
  prompt: string | null;
  blocks: Block[] | null;
}

interface DailyEntryRow extends Record<string, unknown> {
  entry_id: string;
  type: 'mcq' | 'fib';
  difficulty: number;
  question_id: string | null;
  topic_key: string | null;
  prompt: string | null;
  blanks: string[] | null;
  hint: string | null;
}

export function createLibraryRepository(deps: { query: LibraryQuery }) {
  return {
    async listTopics(input: {
      locale: Locale;
      includeArchived?: boolean;
    }): Promise<TopicIndexEntry[]> {
      const { rows } = await deps.query<TopicIndexRow>(
        `SELECT t.key, t.label, t.title, t.subtitle, t.color,
                (SELECT COUNT(*)::int FROM library_questions q
                   JOIN library_sections s ON s.id = q.section_id
                  WHERE s.topic_id = t.id) AS question_count
           FROM library_topics t
          WHERE t.locale = $1 AND ($2::boolean OR t.archived_at IS NULL)
          ORDER BY t.position, t.key`,
        [input.locale, input.includeArchived ?? false],
      );
      return rows.map((row) => ({
        key: row.key,
        label: row.label,
        title: row.title,
        subtitle: row.subtitle,
        color: row.color,
        questionCount: Number(row.question_count),
      }));
    },

    async getTopic(input: { key: string; locale: Locale }): Promise<ProjectedTopic | null> {
      const topicResult = await deps.query<TopicRow>(
        `SELECT id, title, subtitle, label, color
           FROM library_topics
          WHERE key = $1 AND locale = $2 AND archived_at IS NULL`,
        [input.key, input.locale],
      );
      const topic = topicResult.rows[0];
      if (!topic) return null;

      const contentResult = await deps.query<SectionQuestionRow>(
        `SELECT s.id AS section_id, s.name AS section_name,
                q.id AS question_id, q.code, q.prompt, q.blocks
           FROM library_sections s
           LEFT JOIN library_questions q ON q.section_id = s.id
          WHERE s.topic_id = $1
          ORDER BY s.position, q.position`,
        [topic.id],
      );

      const sections: ProjectedSection[] = [];
      let currentSectionId: string | null = null;
      let currentSection: ProjectedSection | null = null;
      for (const row of contentResult.rows) {
        if (!currentSection || currentSectionId !== row.section_id) {
          currentSection = { name: row.section_name, questions: [] };
          currentSectionId = row.section_id;
          sections.push(currentSection);
        }
        if (!row.question_id) continue;
        currentSection.questions.push({
          id: row.code,
          q: row.prompt ?? '',
          blocks: row.blocks ?? [],
        });
      }

      return {
        title: topic.title,
        ...(topic.subtitle === null ? {} : { subtitle: topic.subtitle }),
        label: topic.label,
        color: topic.color,
        sections,
      };
    },

    async listDailyEntries(input: { locale: Locale }): Promise<DailyEntryRecord[]> {
      const { rows } = await deps.query<DailyEntryRow>(
        `SELECT entry_id, type, difficulty, question_id, topic_key, prompt, blanks, hint
           FROM library_daily_entries
          WHERE locale = $1
          ORDER BY position, entry_id`,
        [input.locale],
      );
      return rows.map((row) => ({
        entryId: row.entry_id,
        type: row.type,
        difficulty: Number(row.difficulty),
        questionId: row.question_id,
        topicKey: row.topic_key,
        prompt: row.prompt,
        blanks: row.blanks,
        hint: row.hint,
      }));
    },

    async getQuestion(input: {
      questionId: string;
    }): Promise<{ blocks: Block[]; questionText: string } | null> {
      const { rows } = await deps.query<{ blocks: Block[]; prompt: string }>(
        `SELECT blocks, prompt FROM library_questions WHERE id = $1`,
        [input.questionId],
      );
      const row = rows[0];
      if (!row) return null;
      return { blocks: row.blocks, questionText: row.prompt };
    },

    async listSiblingBlocks(input: {
      topicKey: string;
      locale: Locale;
      excludeQuestionId: string;
    }): Promise<Block[][]> {
      const { rows } = await deps.query<{ blocks: Block[] }>(
        `SELECT q.blocks
           FROM library_questions q
           JOIN library_sections s ON s.id = q.section_id
           JOIN library_topics t ON t.id = s.topic_id
          WHERE t.key = $1 AND t.locale = $2 AND q.id <> $3
          ORDER BY s.position, q.position`,
        [input.topicKey, input.locale, input.excludeQuestionId],
      );
      return rows.map((row) => row.blocks);
    },
  };
}

export type LibraryRepository = ReturnType<typeof createLibraryRepository>;

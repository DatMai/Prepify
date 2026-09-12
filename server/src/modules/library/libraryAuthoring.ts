import type { Block } from './libraryBlocks';
import type { LibraryQuery, Locale } from './libraryRepository';
import type { ImportDocument, Level } from './libraryValidation';

export class LibraryNotFoundError extends Error {
  readonly code = 'library_not_found';
}

export class LibraryConflictError extends Error {
  constructor(
    readonly code: 'library_key_in_use' | 'library_in_use' | 'library_archived',
    readonly entryIds: string[] = [],
  ) {
    super(code);
  }
}

export interface AdminTopicListEntry {
  id: string;
  key: string;
  label: string;
  title: string;
  subtitle: string | null;
  color: string;
  position: number;
  archived: boolean;
  questionCount: number;
}

export interface AdminQuestion {
  id: string;
  position: number;
  code: string | null;
  prompt: string;
  level: Level | null;
  blocks: Block[];
}

export interface AdminSection {
  id: string;
  position: number;
  name: string;
  questions: AdminQuestion[];
}

export interface AdminTopicDetail {
  id: string;
  key: string;
  locale: Locale;
  label: string;
  title: string;
  subtitle: string | null;
  color: string;
  position: number;
  archived: boolean;
  sections: AdminSection[];
}

export interface AdminDailyEntry {
  id: string;
  entryId: string;
  locale: Locale;
  type: 'mcq' | 'fib';
  difficulty: number;
  questionId: string | null;
  topicKey: string | null;
  prompt: string | null;
  blanks: string[] | null;
  hint: string | null;
  position: number;
}

export interface TopicPatch {
  label?: string;
  title?: string;
  subtitle?: string | null;
  color?: string;
  position?: number;
}

/** The parent scope a row's `position` is unique within. */
interface ReorderScope {
  table: 'library_topics' | 'library_sections' | 'library_questions';
  scopeColumn: 'locale' | 'topic_id' | 'section_id';
  scopeValue: string;
}

type Tx = <T>(fn: (tx: LibraryQuery) => Promise<T>) => Promise<T>;

interface PatchBuilder {
  readonly sql: string;
  readonly values: unknown[];
  set(column: string, value: unknown, cast?: string): void;
}

/** Collects `column = $n` fragments so no value is ever interpolated. */
function patchBuilder(): PatchBuilder {
  const assignments: string[] = [];
  const values: unknown[] = [];
  return {
    values,
    get sql() {
      return assignments.join(', ');
    },
    set(column, value, cast) {
      values.push(value);
      assignments.push(`${column} = $${values.length}${cast ?? ''}`);
    },
  };
}

/**
 * Maps Postgres write failures onto the API's error vocabulary, so a caller
 * sees 409/404 instead of a raw 500. `23503` is a foreign key violation: the
 * parent or referenced row does not exist.
 */
function translateWriteError(error: unknown): unknown {
  const code = (error as { code?: string }).code;
  if (code === '23505') return new LibraryConflictError('library_key_in_use');
  if (code === '23503') return new LibraryNotFoundError('library_not_found');
  return error;
}

export function createLibraryAuthoring(deps: { query: LibraryQuery; withTransaction: Tx }) {
  /**
   * Moves one row to `targetIndex` within its parent scope and rewrites
   * `position` for every sibling, so the stored order stays gap-free.
   */
  async function renumber(
    tx: LibraryQuery,
    scope: ReorderScope,
    rowId: string,
    targetIndex: number,
  ): Promise<void> {
    const { rows } = await tx<{ id: string }>(
      `SELECT id FROM ${scope.table} WHERE ${scope.scopeColumn} = $1 ORDER BY position, id`,
      [scope.scopeValue],
    );
    const ids = rows.map((row) => row.id).filter((id) => id !== rowId);
    const clamped = Math.max(0, Math.min(targetIndex, ids.length));
    ids.splice(clamped, 0, rowId);
    for (const [index, id] of ids.entries()) {
      await tx(
        `UPDATE ${scope.table} SET position = $2 WHERE id = $1 AND position IS DISTINCT FROM $2`,
        [id, index],
      );
    }
  }

  async function getTopicDetail(input: { topicId: string }): Promise<AdminTopicDetail | null> {
    const topicResult = await deps.query<{
      id: string;
      key: string;
      locale: Locale;
      label: string;
      title: string;
      subtitle: string | null;
      color: string;
      position: number;
      archived: boolean;
    }>(
      `SELECT id, key, locale, label, title, subtitle, color, position,
              (archived_at IS NOT NULL) AS archived
         FROM library_topics WHERE id = $1`,
      [input.topicId],
    );
    const topic = topicResult.rows[0];
    if (!topic) return null;

    const content = await deps.query<{
      section_id: string;
      section_position: number;
      section_name: string;
      question_id: string | null;
      question_position: number | null;
      code: string | null;
      prompt: string | null;
      level: Level | null;
      blocks: Block[] | null;
    }>(
      `SELECT s.id AS section_id, s.position AS section_position, s.name AS section_name,
              q.id AS question_id, q.position AS question_position, q.code, q.prompt,
              q.level, q.blocks
         FROM library_sections s
         LEFT JOIN library_questions q ON q.section_id = s.id
        WHERE s.topic_id = $1
        ORDER BY s.position, q.position`,
      [topic.id],
    );

    const sections: AdminSection[] = [];
    let currentSectionId: string | null = null;
    let currentSection: AdminSection | null = null;
    for (const row of content.rows) {
      if (!currentSection || currentSectionId !== row.section_id) {
        currentSection = {
          id: row.section_id,
          position: Number(row.section_position),
          name: row.section_name,
          questions: [],
        };
        currentSectionId = row.section_id;
        sections.push(currentSection);
      }
      if (!row.question_id) continue;
      currentSection.questions.push({
        id: row.question_id,
        position: Number(row.question_position ?? 0),
        code: row.code,
        prompt: row.prompt ?? '',
        level: row.level,
        blocks: row.blocks ?? [],
      });
    }

    return {
      id: topic.id,
      key: topic.key,
      locale: topic.locale,
      label: topic.label,
      title: topic.title,
      subtitle: topic.subtitle,
      color: topic.color,
      position: Number(topic.position),
      archived: topic.archived,
      sections,
    };
  }

  /** Shared by the public method and the in-transaction import guard. */
  async function listDailyReferencesForTopicWith(
    tx: LibraryQuery,
    topicId: string,
  ): Promise<string[]> {
    const { rows } = await tx<{ entry_id: string }>(
      `SELECT d.entry_id FROM library_daily_entries d
         JOIN library_questions q ON q.id = d.question_id
         JOIN library_sections s ON s.id = q.section_id
        WHERE s.topic_id = $1
        ORDER BY d.entry_id`,
      [topicId],
    );
    return rows.map((row) => row.entry_id);
  }

  return {
    async listTopics(input: { locale: Locale; includeArchived?: boolean }) {
      const { rows } = await deps.query<{
        id: string;
        key: string;
        label: string;
        title: string;
        subtitle: string | null;
        color: string;
        position: number;
        archived: boolean;
        question_count: number;
      }>(
        `SELECT t.id, t.key, t.label, t.title, t.subtitle, t.color, t.position,
                (t.archived_at IS NOT NULL) AS archived,
                (SELECT COUNT(*)::int FROM library_questions q
                   JOIN library_sections s ON s.id = q.section_id
                  WHERE s.topic_id = t.id) AS question_count
           FROM library_topics t
          WHERE t.locale = $1 AND ($2::boolean OR t.archived_at IS NULL)
          ORDER BY t.position, t.key`,
        [input.locale, input.includeArchived ?? false],
      );
      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        label: row.label,
        title: row.title,
        subtitle: row.subtitle,
        color: row.color,
        position: Number(row.position),
        archived: row.archived,
        questionCount: Number(row.question_count),
      })) satisfies AdminTopicListEntry[];
    },

    getTopicDetail,

    async findTopicStatus(topicId: string) {
      const { rows } = await deps.query<{ id: string; archived: boolean }>(
        `SELECT id, (archived_at IS NOT NULL) AS archived FROM library_topics WHERE id = $1`,
        [topicId],
      );
      const row = rows[0];
      return row ? { id: row.id, archived: row.archived } : null;
    },

    async createTopic(input: {
      key: string;
      locale: Locale;
      label: string;
      title: string;
      subtitle: string | null;
      color: string;
    }): Promise<{ id: string }> {
      try {
        const { rows } = await deps.query<{ id: string }>(
          `INSERT INTO library_topics (key, locale, label, title, subtitle, color, position)
           VALUES ($1, $2, $3, $4, $5, $6,
                   COALESCE((SELECT MAX(position) + 1 FROM library_topics WHERE locale = $2), 0))
           RETURNING id`,
          [input.key, input.locale, input.label, input.title, input.subtitle, input.color],
        );
        return { id: rows[0]!.id };
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new LibraryConflictError('library_key_in_use');
        }
        throw error;
      }
    },

    async updateTopic(topicId: string, patch: TopicPatch): Promise<void> {
      await deps.withTransaction(async (tx) => {
        const { rows } = await tx<{ locale: Locale }>(
          `SELECT locale FROM library_topics WHERE id = $1`,
          [topicId],
        );
        const locale = rows[0]?.locale;
        if (!locale) throw new LibraryNotFoundError('library_not_found');

        const builder = patchBuilder();
        if (patch.label !== undefined) builder.set('label', patch.label);
        if (patch.title !== undefined) builder.set('title', patch.title);
        if (patch.subtitle !== undefined) builder.set('subtitle', patch.subtitle);
        if (patch.color !== undefined) builder.set('color', patch.color);
        if (builder.sql.length > 0) {
          await tx(
            `UPDATE library_topics SET ${builder.sql}, updated_at = now() WHERE id = $${builder.values.length + 1}`,
            [...builder.values, topicId],
          );
        }
        if (patch.position !== undefined) {
          await renumber(
            tx,
            { table: 'library_topics', scopeColumn: 'locale', scopeValue: locale },
            topicId,
            patch.position,
          );
        }
      });
    },

    async setTopicArchived(topicId: string, archived: boolean): Promise<void> {
      await deps.query(
        `UPDATE library_topics
            SET archived_at = CASE WHEN $2::boolean THEN now() ELSE NULL END,
                updated_at = now()
          WHERE id = $1`,
        [topicId, archived],
      );
    },

    async listDailyReferencesForTopic(topicId: string): Promise<string[]> {
      return listDailyReferencesForTopicWith(deps.query, topicId);
    },

    async listDailyReferencesForSection(sectionId: string): Promise<string[]> {
      const { rows } = await deps.query<{ entry_id: string }>(
        `SELECT d.entry_id FROM library_daily_entries d
           JOIN library_questions q ON q.id = d.question_id
          WHERE q.section_id = $1
          ORDER BY d.entry_id`,
        [sectionId],
      );
      return rows.map((row) => row.entry_id);
    },

    async listDailyReferencesForQuestion(questionId: string): Promise<string[]> {
      const { rows } = await deps.query<{ entry_id: string }>(
        `SELECT entry_id FROM library_daily_entries WHERE question_id = $1 ORDER BY entry_id`,
        [questionId],
      );
      return rows.map((row) => row.entry_id);
    },

    async findTopicIdForSection(sectionId: string): Promise<string | null> {
      const { rows } = await deps.query<{ topic_id: string }>(
        `SELECT topic_id FROM library_sections WHERE id = $1`,
        [sectionId],
      );
      return rows[0]?.topic_id ?? null;
    },

    async findTopicIdForQuestion(questionId: string): Promise<string | null> {
      const { rows } = await deps.query<{ topic_id: string }>(
        `SELECT s.topic_id FROM library_questions q
           JOIN library_sections s ON s.id = q.section_id
          WHERE q.id = $1`,
        [questionId],
      );
      return rows[0]?.topic_id ?? null;
    },

    async createSection(input: { topicId: string; name: string }): Promise<{ id: string }> {
      try {
        const { rows } = await deps.query<{ id: string }>(
          `INSERT INTO library_sections (topic_id, position, name)
           VALUES ($1, COALESCE((SELECT MAX(position) + 1 FROM library_sections WHERE topic_id = $1), 0), $2)
           RETURNING id`,
          [input.topicId, input.name],
        );
        return { id: rows[0]!.id };
      } catch (error) {
        throw translateWriteError(error);
      }
    },

    async updateSection(
      sectionId: string,
      patch: { name?: string; position?: number },
    ): Promise<void> {
      await deps.withTransaction(async (tx) => {
        const { rows } = await tx<{ topic_id: string }>(
          `SELECT topic_id FROM library_sections WHERE id = $1`,
          [sectionId],
        );
        const topicId = rows[0]?.topic_id;
        if (!topicId) throw new LibraryNotFoundError('library_not_found');

        const builder = patchBuilder();
        if (patch.name !== undefined) builder.set('name', patch.name);
        if (builder.sql.length > 0) {
          await tx(
            `UPDATE library_sections SET ${builder.sql} WHERE id = $${builder.values.length + 1}`,
            [...builder.values, sectionId],
          );
        }
        if (patch.position !== undefined) {
          await renumber(
            tx,
            { table: 'library_sections', scopeColumn: 'topic_id', scopeValue: topicId },
            sectionId,
            patch.position,
          );
        }
      });
    },

    async deleteSection(sectionId: string): Promise<void> {
      await deps.query(`DELETE FROM library_sections WHERE id = $1`, [sectionId]);
    },

    async deleteSectionsForTopic(topicId: string): Promise<void> {
      await deps.query(`DELETE FROM library_sections WHERE topic_id = $1`, [topicId]);
    },

    async createQuestion(input: {
      sectionId: string;
      code: string | null;
      prompt: string;
      level: Level | null;
      blocks: Block[];
    }): Promise<{ id: string }> {
      try {
        const { rows } = await deps.query<{ id: string }>(
          `INSERT INTO library_questions (section_id, position, code, prompt, level, blocks)
           VALUES ($1, COALESCE((SELECT MAX(position) + 1 FROM library_questions WHERE section_id = $1), 0), $2, $3, $4, $5::jsonb)
           RETURNING id`,
          [input.sectionId, input.code, input.prompt, input.level, JSON.stringify(input.blocks)],
        );
        return { id: rows[0]!.id };
      } catch (error) {
        throw translateWriteError(error);
      }
    },

    async updateQuestion(
      questionId: string,
      patch: {
        code?: string | null;
        prompt?: string;
        level?: Level | null;
        blocks?: Block[];
        position?: number;
      },
    ): Promise<void> {
      await deps.withTransaction(async (tx) => {
        const { rows } = await tx<{ section_id: string }>(
          `SELECT section_id FROM library_questions WHERE id = $1`,
          [questionId],
        );
        const sectionId = rows[0]?.section_id;
        if (!sectionId) throw new LibraryNotFoundError('library_not_found');

        const builder = patchBuilder();
        if (patch.code !== undefined) builder.set('code', patch.code);
        if (patch.prompt !== undefined) builder.set('prompt', patch.prompt);
        if (patch.level !== undefined) builder.set('level', patch.level);
        if (patch.blocks !== undefined)
          builder.set('blocks', JSON.stringify(patch.blocks), '::jsonb');
        if (builder.sql.length > 0) {
          await tx(
            `UPDATE library_questions SET ${builder.sql} WHERE id = $${builder.values.length + 1}`,
            [...builder.values, questionId],
          );
        }
        if (patch.position !== undefined) {
          await renumber(
            tx,
            { table: 'library_questions', scopeColumn: 'section_id', scopeValue: sectionId },
            questionId,
            patch.position,
          );
        }
      });
    },

    async deleteQuestion(questionId: string): Promise<void> {
      await deps.query(`DELETE FROM library_questions WHERE id = $1`, [questionId]);
    },

    async exportTopicDocument(topicId: string): Promise<ImportDocument | null> {
      const detail = await getTopicDetail({ topicId });
      if (!detail) return null;
      return {
        title: detail.title,
        subtitle: detail.subtitle,
        label: detail.label,
        color: detail.color,
        sections: detail.sections.map((section) => ({
          name: section.name,
          questions: section.questions.map((question) => ({
            code: question.code,
            prompt: question.prompt,
            level: question.level,
            blocks: question.blocks,
          })),
        })),
      };
    },
  };
}

export type LibraryAuthoring = ReturnType<typeof createLibraryAuthoring>;

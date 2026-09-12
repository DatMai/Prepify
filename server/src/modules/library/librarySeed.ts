import fs from 'node:fs';
import path from 'node:path';
import { blockListSchema, type Block } from './libraryBlocks';
import type { Locale } from './libraryRepository';

export interface SeedQuestion {
  position: number;
  code: string | null;
  prompt: string;
  blocks: Block[];
}

export interface SeedSection {
  position: number;
  name: string;
  questions: SeedQuestion[];
}

export interface SeedTopic {
  key: string;
  locale: Locale;
  label: string;
  title: string;
  subtitle: string | null;
  color: string;
  position: number;
  sections: SeedSection[];
}

export interface SeedDailyEntry {
  entryId: string;
  locale: Locale;
  type: 'mcq' | 'fib';
  difficulty: number;
  topicKey: string | null;
  ref: { topicKey: string; sectionIdx: number; questionIdx: number } | null;
  prompt: string | null;
  blanks: string[] | null;
  hint: string | null;
  position: number;
}

export interface SeedPlan {
  locale: Locale;
  topics: SeedTopic[];
  daily: SeedDailyEntry[];
  warnings: string[];
}

interface IndexEntry {
  key: string;
  label?: string;
  title?: string;
  subtitle?: string;
  color?: string;
}

interface TopicFile {
  label?: string;
  title?: string;
  subtitle?: string;
  color?: string;
  sections?: Array<{
    name?: string;
    questions?: Array<{ id?: string; q?: string; blocks?: unknown }>;
  }>;
}

interface DailyFile {
  pool?: Array<{
    id: string;
    type: string;
    difficulty: number;
    ref?: { topicKey: string; sectionIdx: number; questionIdx: number };
    topic?: string;
    prompt?: string;
    blanks?: string[];
    hint?: string;
  }>;
}

const METADATA_FIELDS = ['label', 'title', 'subtitle', 'color'] as const;

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function readTopicSections(topicKey: string, file: TopicFile): SeedSection[] {
  return (file.sections ?? []).map((section, sectionIdx) => ({
    position: sectionIdx,
    name: section.name ?? '',
    questions: (section.questions ?? []).map((question, questionIdx) => {
      const parsed = blockListSchema.safeParse(question.blocks ?? []);
      if (!parsed.success) {
        throw new Error(
          `Seed aborted: ${topicKey} section ${sectionIdx} question ${questionIdx} has invalid blocks`,
        );
      }
      return {
        position: questionIdx,
        code: question.id ?? null,
        prompt: question.q ?? '',
        blocks: parsed.data,
      };
    }),
  }));
}

export function buildSeedPlan(corpusDir: string, locale: Locale): SeedPlan {
  const warnings: string[] = [];
  const index = readJson<IndexEntry[]>(path.join(corpusDir, 'index.json'));
  const dailyFile = readJson<DailyFile>(path.join(corpusDir, 'daily.json'));

  const topicKeys = fs
    .readdirSync(corpusDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((key) => key !== 'index' && key !== 'daily')
    .sort();

  const indexedKeys = index.map((entry) => entry.key).filter((key) => topicKeys.includes(key));
  const unindexedKeys = topicKeys.filter((key) => !indexedKeys.includes(key));
  for (const key of unindexedKeys) {
    warnings.push(`Topic "${key}" is not in index.json; appended last.`);
  }
  for (const key of index.map((entry) => entry.key).filter((key) => !topicKeys.includes(key))) {
    warnings.push(`Topic "${key}" is listed in index.json but has no topic file; skipped.`);
  }

  const orderedKeys = [...indexedKeys, ...unindexedKeys];

  const topics = orderedKeys.map((key, position) => {
    const file = readJson<TopicFile>(path.join(corpusDir, `${key}.json`));
    const entry = index.find((candidate) => candidate.key === key);
    for (const field of METADATA_FIELDS) {
      const fromIndex = entry?.[field];
      const fromFile = file[field];
      if (fromIndex !== undefined && fromFile !== undefined && fromIndex !== fromFile) {
        warnings.push(`Topic "${key}": index.json ${field} differs from ${key}.json; index wins.`);
      }
    }
    return {
      key,
      locale,
      label: entry?.label ?? file.label ?? key,
      title: entry?.title ?? file.title ?? key,
      subtitle: entry?.subtitle ?? file.subtitle ?? null,
      color: entry?.color ?? file.color ?? '#888888',
      position,
      sections: readTopicSections(key, file),
    };
  });

  const daily: SeedDailyEntry[] = (dailyFile.pool ?? []).map((entry, position) => ({
    entryId: entry.id,
    locale,
    type: entry.type === 'fib' ? 'fib' : 'mcq',
    difficulty: entry.difficulty,
    topicKey: entry.ref?.topicKey ?? entry.topic ?? null,
    ref: entry.ref ?? null,
    prompt: entry.prompt ?? null,
    blanks: entry.blanks ?? null,
    hint: entry.hint ?? null,
    position,
  }));

  return { locale, topics, daily, warnings };
}

export interface SeedSummary {
  topics: number;
  sections: number;
  questions: number;
  daily: number;
  skippedTopics: number;
  skippedDaily: number;
}

export async function applySeedPlan(
  query: import('./libraryRepository').LibraryQuery,
  plan: SeedPlan,
): Promise<SeedSummary> {
  const summary: SeedSummary = {
    topics: 0,
    sections: 0,
    questions: 0,
    daily: 0,
    skippedTopics: 0,
    skippedDaily: 0,
  };
  await query('BEGIN');
  try {
    for (const topic of plan.topics) {
      const inserted = await query<{ id: string }>(
        `INSERT INTO library_topics (key, locale, label, title, subtitle, color, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (key, locale) DO NOTHING
         RETURNING id`,
        [
          topic.key,
          topic.locale,
          topic.label,
          topic.title,
          topic.subtitle,
          topic.color,
          topic.position,
        ],
      );
      const topicId = inserted.rows[0]?.id;
      if (!topicId) {
        summary.skippedTopics += 1;
        continue;
      }
      summary.topics += 1;
      for (const section of topic.sections) {
        const sectionRow = await query<{ id: string }>(
          `INSERT INTO library_sections (topic_id, position, name) VALUES ($1, $2, $3) RETURNING id`,
          [topicId, section.position, section.name],
        );
        summary.sections += 1;
        for (const question of section.questions) {
          await query(
            `INSERT INTO library_questions (section_id, position, code, prompt, level, blocks)
             VALUES ($1, $2, $3, $4, NULL, $5::jsonb)`,
            [
              sectionRow.rows[0]!.id,
              question.position,
              question.code,
              question.prompt,
              JSON.stringify(question.blocks),
            ],
          );
          summary.questions += 1;
        }
      }
    }

    // Resolve positional Daily refs against what is actually stored, so a
    // second run (where every topic is skipped) still finds its questions.
    const mapped = await query<{
      key: string;
      section_position: number;
      question_position: number;
      id: string;
    }>(
      `SELECT t.key, s.position AS section_position, q.position AS question_position, q.id
         FROM library_questions q
         JOIN library_sections s ON s.id = q.section_id
         JOIN library_topics t ON t.id = s.topic_id
        WHERE t.locale = $1`,
      [plan.locale],
    );
    const questionIds = new Map(
      mapped.rows.map((row) => [
        `${row.key}:${row.section_position}:${row.question_position}`,
        row.id,
      ]),
    );

    for (const entry of plan.daily) {
      let questionId: string | null = null;
      if (entry.ref) {
        questionId =
          questionIds.get(
            `${entry.ref.topicKey}:${entry.ref.sectionIdx}:${entry.ref.questionIdx}`,
          ) ?? null;
        if (!questionId) {
          throw new Error(
            `Seed aborted: Daily entry ${entry.entryId} references ${entry.ref.topicKey} section ${entry.ref.sectionIdx} question ${entry.ref.questionIdx}, which is not in the database`,
          );
        }
      }
      const inserted = await query<{ id: string }>(
        `INSERT INTO library_daily_entries
           (entry_id, locale, type, difficulty, question_id, topic_key, prompt, blanks, hint, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         ON CONFLICT (entry_id, locale) DO NOTHING
         RETURNING id`,
        [
          entry.entryId,
          entry.locale,
          entry.type,
          entry.difficulty,
          questionId,
          entry.topicKey,
          entry.prompt,
          entry.blanks ? JSON.stringify(entry.blanks) : null,
          entry.hint,
          entry.position,
        ],
      );
      if (inserted.rows.length > 0) summary.daily += 1;
      else summary.skippedDaily += 1;
    }
    await query('COMMIT');
    return summary;
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
}

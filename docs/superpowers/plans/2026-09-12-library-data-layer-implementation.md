# Library Data Layer Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Library corpus and the Daily pool from read-only JSON files into PostgreSQL, so the API reads the database while the app behaves exactly as it does today.

**Architecture:** Four new tables hold topics, sections, questions and Daily pool entries. A one-time idempotent seed script imports `content/**` into them, resolving each positional Daily `ref` into a real `library_questions` foreign key. The reader route and the Daily route keep their current paths and response shapes; only their data source changes.

**Tech Stack:** Express 5 + TypeScript (CommonJS), PostgreSQL via `pg`, Zod validation, Vitest with `supertest`, `tsx` for scripts.

**Spec:** `docs/superpowers/specs/2026-09-12-library-content-management-design.md`

**This plan is phase 1 of 3.** Phase 2 (admin write API) and phase 3 (authoring UI) follow in a separate plan; nothing in this plan adds a write endpoint.

## Global Constraints

- Migrations are append-only: never edit an applied migration. New file is `011_add_library_tables.sql`, using `CREATE TABLE IF NOT EXISTS` and `UUID PRIMARY KEY DEFAULT gen_random_uuid()` like the existing migrations.
- `content/*.json` (vi, 11 files) is tracked in git; `content/en/` is gitignored. Tests may read the vi corpus but must never require `content/en/`.
- Never log question or answer text. Logs carry `id`, `key` and the action only.
- The private corpus must never enter the frontend bundle: `npm run check:bundle` must keep passing.
- Reader paths and success response shapes are frozen: `GET /api/v1/library/index?lang=`, `GET /api/v1/library/topics/:key?lang=`, `GET /api/v1/daily`, `GET /api/v1/daily/status`, `POST /api/v1/daily/complete`. This plan must not change them.
- `npm run check` is the single definition of green.
- Server is CommonJS. Commit after every task.

## File Structure

```text
server/migrations/011_add_library_tables.sql        new  — the four tables
server/src/modules/library/libraryBlocks.ts         new  — block schema, size ceilings, blocksToText
server/src/modules/library/libraryRepository.ts     new  — all read queries + reader projection
server/src/modules/library/librarySeed.ts           new  — corpus → seed plan → insert (pure + apply)
server/src/scripts/seedLibrary.ts                   new  — thin CLI wrapper around the seed
server/src/routes/library.ts                        mod  — read from the repository
server/src/routes/daily.ts                          mod  — pool from the repository
server/src/index.ts                                 mod  — wire the repository
server/package.json                                 mod  — add the seed:library script
docs/ADR-004-library-corpus-in-postgresql.md        new  — record the source-of-truth change
AGENTS.md, README.md                                mod  — point at the new ADR and source
```

---

### Task 1: Block schema and text extraction

**Files:**

- Create: `server/src/modules/library/libraryBlocks.ts`
- Test: `server/src/modules/library/libraryBlocks.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `MAX_BLOCKS_PER_QUESTION`, `MAX_TEXT_LENGTH`, `MAX_TABLE_ROWS`, `MAX_TABLE_COLUMNS` (numbers); `blockSchema` (Zod); `blockListSchema` (Zod, array of blocks with ceilings); `blocksToText(blocks: unknown): string` (concatenates `text` blocks with a space, ignoring every other type); types `Block`, `TextBlock`, `NoteBlock`, `CodeBlock`, `TableBlock`.

- [ ] **Step 1: Write the failing test**

`server/src/modules/library/libraryBlocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { blockListSchema, blocksToText, MAX_TABLE_COLUMNS } from './libraryBlocks';

describe('libraryBlocks', () => {
  it('accepts every corpus block shape, including table flags', () => {
    const parsed = blockListSchema.safeParse([
      { type: 'text', text: 'hello' },
      { type: 'note', text: 'note' },
      { type: 'code', lang: 'js', text: 'const a = 1;' },
      { type: 'table', rows: [['A', 'B']], headerDone: true, closed: true },
    ]);

    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown block type and an oversized table', () => {
    expect(blockListSchema.safeParse([{ type: 'image', src: 'x' }]).success).toBe(false);
    expect(
      blockListSchema.safeParse([
        {
          type: 'table',
          rows: Array.from({ length: 2 }, () =>
            Array.from({ length: MAX_TABLE_COLUMNS + 1 }, () => 'x'),
          ),
        },
      ]).success,
    ).toBe(false);
  });

  it('concatenates only text blocks and tolerates junk input', () => {
    expect(
      blocksToText([
        { type: 'text', text: 'a' },
        { type: 'code', lang: 'js', text: 'ignored' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a b');
    expect(blocksToText(null)).toBe('');
    expect(blocksToText('nope')).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix server test -- src/modules/library/libraryBlocks.test.ts`
Expected: FAIL — cannot resolve `./libraryBlocks`.

- [ ] **Step 3: Write the implementation**

`server/src/modules/library/libraryBlocks.ts`:

```ts
import { z } from 'zod';

export const MAX_BLOCKS_PER_QUESTION = 100;
export const MAX_TEXT_LENGTH = 20_000;
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 10;

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(MAX_TEXT_LENGTH),
});

const noteBlockSchema = z.object({
  type: z.literal('note'),
  text: z.string().max(MAX_TEXT_LENGTH),
});

const codeBlockSchema = z.object({
  type: z.literal('code'),
  lang: z.string().max(32),
  text: z.string().max(MAX_TEXT_LENGTH),
});

const tableBlockSchema = z.object({
  type: z.literal('table'),
  rows: z
    .array(z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_TABLE_COLUMNS))
    .max(MAX_TABLE_ROWS),
  headerDone: z.boolean().optional(),
  closed: z.boolean().optional(),
});

export const blockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  noteBlockSchema,
  codeBlockSchema,
  tableBlockSchema,
]);

export const blockListSchema = z.array(blockSchema).max(MAX_BLOCKS_PER_QUESTION);

export type TextBlock = z.infer<typeof textBlockSchema>;
export type NoteBlock = z.infer<typeof noteBlockSchema>;
export type CodeBlock = z.infer<typeof codeBlockSchema>;
export type TableBlock = z.infer<typeof tableBlockSchema>;
export type Block = z.infer<typeof blockSchema>;

/** Concatenates the text-block content of a question, the way the Daily
 *  challenge builds MCQ options. Non-text blocks and junk input are ignored. */
export function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block): block is TextBlock => {
      if (typeof block !== 'object' || block === null) return false;
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === 'text' && typeof candidate.text === 'string';
    })
    .map((block) => block.text)
    .join(' ');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/libraryBlocks.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/library/libraryBlocks.ts server/src/modules/library/libraryBlocks.test.ts
git commit -m "feat(server): block schema cho nội dung Library"
```

---

### Task 2: Migration for the four Library tables

**Files:**

- Create: `server/migrations/011_add_library_tables.sql`

**Interfaces:**

- Consumes: nothing.
- Produces: tables `library_topics`, `library_sections`, `library_questions`, `library_daily_entries` consumed by every later task.

- [ ] **Step 1: Write the migration**

`server/migrations/011_add_library_tables.sql`:

```sql
-- Library corpus: PostgreSQL becomes the source of truth for topics, sections,
-- questions and the Daily pool. See docs/ADR-004.

CREATE TABLE IF NOT EXISTS library_topics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         TEXT NOT NULL,
  locale      TEXT NOT NULL CHECK (locale IN ('vi', 'en')),
  label       TEXT NOT NULL,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  color       TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  archived_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (key, locale)
);

CREATE TABLE IF NOT EXISTS library_sections (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id UUID NOT NULL REFERENCES library_topics(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS library_questions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id UUID NOT NULL REFERENCES library_sections(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  code       TEXT,
  prompt     TEXT NOT NULL,
  level      TEXT CHECK (level IN ('basic', 'intermediate', 'advanced')),
  blocks     JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS library_daily_entries (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id    TEXT NOT NULL,
  locale      TEXT NOT NULL CHECK (locale IN ('vi', 'en')),
  type        TEXT NOT NULL CHECK (type IN ('mcq', 'fib')),
  difficulty  SMALLINT NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  question_id UUID REFERENCES library_questions(id) ON DELETE RESTRICT,
  topic_key   TEXT,
  prompt      TEXT,
  blanks      JSONB,
  hint        TEXT,
  position    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (entry_id, locale),
  CHECK (
    (type = 'mcq' AND question_id IS NOT NULL)
    OR (type = 'fib' AND prompt IS NOT NULL AND blanks IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS library_topics_locale_position_idx
  ON library_topics (locale, position) WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS library_questions_section_position_idx
  ON library_questions (section_id, position);
```

- [ ] **Step 2: Apply the migration**

Run: `npm --prefix server run migrate`
Expected: the logged `migrations` array ends with `011_add_library_tables.sql`.

- [ ] **Step 3: Verify the tables exist**

Run: `psql "$DATABASE_URL" -c '\dt library_*'` (or the equivalent client you use)
Expected: four `library_*` tables, plus the two indexes.

- [ ] **Step 4: Commit**

```bash
git add server/migrations/011_add_library_tables.sql
git commit -m "feat(db): bảng Library trong PostgreSQL"
```

---

### Task 3: Library repository (read side)

**Files:**

- Create: `server/src/modules/library/libraryRepository.ts`
- Test: `server/src/modules/library/libraryRepository.test.ts`

**Interfaces:**

- Consumes: `Block` from Task 1.
- Produces:
  - `type Locale = 'vi' | 'en'`
  - `createLibraryRepository({ query })` returning:
    - `listTopics(input: { locale: Locale; includeArchived?: boolean }): Promise<TopicIndexEntry[]>`
    - `getTopic(input: { key: string; locale: Locale }): Promise<ProjectedTopic | null>`
    - `listDailyEntries(input: { locale: Locale }): Promise<DailyEntryRecord[]>`
    - `getQuestion(input: { questionId: string }): Promise<{ blocks: Block[]; questionText: string } | null>`
    - `listSiblingBlocks(input: { topicKey: string; locale: Locale; excludeQuestionId: string }): Promise<Block[][]>`
  - `TopicIndexEntry = { key; label; title; subtitle: string | null; color; questionCount: number }`
  - `ProjectedTopic = { title; subtitle?: string; label; color; sections: [{ name; questions: [{ id: string | null; q: string; blocks: Block[] }] }] }`
  - `DailyEntryRecord = { entryId; type: 'mcq' | 'fib'; difficulty: number; questionId: string | null; topicKey: string | null; prompt: string | null; blanks: string[] | null; hint: string | null }`
  - `type LibraryRepository = ReturnType<typeof createLibraryRepository>`

- [ ] **Step 1: Write the failing test**

`server/src/modules/library/libraryRepository.test.ts`:

```ts
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
            section_position: 0,
            section_name: 'Phần I',
            question_id: 'q1',
            question_position: 0,
            code: 'Q1',
            prompt: 'Array là gì?',
            blocks: [{ type: 'text', text: 'a' }],
          },
          {
            section_id: 's1',
            section_position: 0,
            section_name: 'Phần I',
            question_id: 'q2',
            question_position: 1,
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

  it('returns null for an unknown topic', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = createLibraryRepository({ query });

    expect(await repo.getTopic({ key: 'missing', locale: 'vi' })).toBeNull();
  });

  it('keeps empty sections and orders Daily entries by position', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ id: 't1', title: 'T', subtitle: null, label: 'L', color: '#000000' }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            section_id: 's1',
            section_position: 0,
            section_name: 'Empty',
            question_id: null,
            question_position: null,
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
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix server test -- src/modules/library/libraryRepository.test.ts`
Expected: FAIL — cannot resolve `./libraryRepository`.

- [ ] **Step 3: Write the implementation**

`server/src/modules/library/libraryRepository.ts`:

```ts
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
      for (const row of contentResult.rows) {
        let section = sections[sections.length - 1];
        if (!section || section.name !== row.section_name) {
          section = { name: row.section_name, questions: [] };
          sections.push(section);
        }
        if (!row.question_id) continue;
        section.questions.push({
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/libraryRepository.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Typecheck**

Run: `npm --prefix server run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/library/libraryRepository.ts server/src/modules/library/libraryRepository.test.ts
git commit -m "feat(server): repository đọc nội dung Library"
```

---

### Task 4: Corpus reader and seed plan builder

**Files:**

- Create: `server/src/modules/library/librarySeed.ts`
- Test: `server/src/modules/library/librarySeed.test.ts`

**Interfaces:**

- Consumes: `Block`, `blockListSchema` from Task 1; `Locale` from Task 3.
- Produces:
  - `buildSeedPlan(corpusDir: string, locale: Locale): SeedPlan` where
    `SeedPlan = { locale: Locale; topics: SeedTopic[]; daily: SeedDailyEntry[]; warnings: string[] }`
  - `SeedTopic = { key; locale; label; title; subtitle: string | null; color; position; sections: SeedSection[] }`
  - `SeedSection = { position; name; questions: SeedQuestion[] }`
  - `SeedQuestion = { position; code: string | null; prompt: string; blocks: Block[] }`
  - `SeedDailyEntry = { entryId; locale; type: 'mcq' | 'fib'; difficulty; topicKey: string | null; ref: { topicKey; sectionIdx; questionIdx } | null; prompt: string | null; blanks: string[] | null; hint: string | null; position }`

**Rules locked by the spec:** `content/index.json` is authoritative for `label`, `title`, `subtitle`, `color` and topic order; the topic file supplies sections and questions. `index.json` and `daily.json` are skipped as topics. A topic file missing from `index.json` is appended after the indexed ones using its own metadata, with a warning. A topic file failing `blockListSchema` throws, naming the topic, section and question — a bad corpus must fail loudly, not seed half a topic. `content/en/` may be absent; the caller decides, so `buildSeedPlan` itself throws only when the locale directory has no `index.json`.

- [ ] **Step 1: Write the failing test**

`server/src/modules/library/librarySeed.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSeedPlan } from './librarySeed';

const REPO_CORPUS = path.resolve(__dirname, '../../../../content');

describe('buildSeedPlan against the real corpus', () => {
  it('reads every indexed topic with sections and questions in file order', () => {
    const plan = buildSeedPlan(REPO_CORPUS, 'vi');

    expect(plan.topics.map((topic) => topic.key)).toEqual([
      'javascript',
      'typescript',
      'nodejs',
      'dsa',
      'oop',
      'os',
      'networking',
      'dbms',
      'system',
    ]);
    const dsa = plan.topics.find((topic) => topic.key === 'dsa');
    expect(dsa?.label).toBe('DSA');
    expect(dsa?.color).toBe('#B71C1C');
    expect(dsa?.position).toBe(3);
    expect(dsa?.sections.reduce((sum, section) => sum + section.questions.length, 0)).toBe(58);
    expect(dsa?.sections[0]?.questions[0]?.code).toBe('Q1');
    expect(dsa?.sections[0]?.questions[0]?.prompt).toBe('Array là gì? Ưu và nhược điểm?');
    expect(plan.warnings).toEqual([]);
  });

  it('carries the Daily pool with positional refs and no level guessing', () => {
    const plan = buildSeedPlan(REPO_CORPUS, 'vi');

    expect(plan.daily).toHaveLength(35);
    expect(plan.daily.filter((entry) => entry.type === 'mcq')).toHaveLength(20);
    expect(plan.daily.filter((entry) => entry.type === 'fib')).toHaveLength(15);
    const first = plan.daily.find((entry) => entry.entryId === 'd-mcq-001');
    expect(first?.ref).toEqual({ topicKey: 'javascript', sectionIdx: 0, questionIdx: 0 });
    const fib = plan.daily.find((entry) => entry.type === 'fib');
    expect(fib?.prompt).toBeTruthy();
    expect(fib?.blanks?.length).toBeGreaterThan(0);
    // Questions never carry a level: the corpus has none, and the seed must not guess.
    expect(plan.topics.flatMap((topic) => topic.sections).flatMap((s) => s.questions)).toHaveLength(
      524,
    );
  });

  it('fails loudly when a topic file breaks the block schema', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepify-seed-'));
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify([{ key: 'broken', label: 'B', title: 'B', color: '#000000' }]),
    );
    fs.writeFileSync(
      path.join(dir, 'broken.json'),
      JSON.stringify({
        title: 'B',
        sections: [
          {
            name: 'S',
            questions: [{ id: 'Q1', q: 'x', blocks: [{ type: 'image', src: 'nope' }] }],
          },
        ],
      }),
    );

    expect(() => buildSeedPlan(dir, 'vi')).toThrow(/broken.*section 0.*question 0/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildSeedPlan warnings', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepify-seed-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeCorpus(index: unknown[], topic: unknown, daily: unknown): void {
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
    fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify(topic));
    fs.writeFileSync(path.join(dir, 'daily.json'), JSON.stringify(daily));
  }

  it('warns when metadata disagrees and lets the index win', () => {
    writeCorpus(
      [{ key: 'x', label: 'IndexLabel', title: 'IndexTitle', color: '#111111' }],
      { label: 'FileLabel', color: '#222222', title: 'FileTitle', sections: [] },
      { version: 1, pool: [] },
    );

    const plan = buildSeedPlan(dir, 'vi');

    expect(plan.topics[0]?.label).toBe('IndexLabel');
    expect(plan.warnings.join(' ')).toMatch(/label|color|title/);
  });

  it('appends a topic that is missing from the index, with a warning', () => {
    writeCorpus(
      [],
      { label: 'L', color: '#333333', title: 'T', sections: [] },
      { version: 1, pool: [] },
    );

    const plan = buildSeedPlan(dir, 'vi');

    expect(plan.topics.map((topic) => topic.key)).toEqual(['x']);
    expect(plan.warnings.join(' ')).toMatch(/not in index/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix server test -- src/modules/library/librarySeed.test.ts`
Expected: FAIL — cannot resolve `./librarySeed`.

- [ ] **Step 3: Write the implementation**

`server/src/modules/library/librarySeed.ts`:

```ts
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
  const indexPath = path.join(corpusDir, 'index.json');
  const index = readJson<IndexEntry[]>(indexPath);
  const dailyFile = readJson<DailyFile>(path.join(corpusDir, 'daily.json'));

  const topicKeys = fs
    .readdirSync(corpusDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter((key) => key !== 'index' && key !== 'daily')
    .sort();

  const indexedKeys = index.map((entry) => entry.key);
  for (const key of topicKeys) {
    if (!indexedKeys.includes(key))
      warnings.push(`Topic "${key}" is not in index.json; appended last.`);
  }

  const orderedKeys = [
    ...indexedKeys.filter((key) => topicKeys.includes(key)),
    ...topicKeys.filter((key) => !indexedKeys.includes(key)),
  ];

  const topics = orderedKeys.map((key, position) => {
    const file = readJson<TopicFile>(path.join(corpusDir, `${key}.json`));
    const entry = index.find((candidate) => candidate.key === key);
    for (const field of ['label', 'title', 'subtitle', 'color'] as const) {
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/librarySeed.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/library/librarySeed.ts server/src/modules/library/librarySeed.test.ts
git commit -m "feat(server): dựng seed plan từ corpus"
```

---

### Task 5: Seed application and CLI

**Files:**

- Modify: `server/src/modules/library/librarySeed.ts` (add `applySeedPlan`)
- Test: `server/src/modules/library/librarySeedApply.test.ts`
- Create: `server/src/scripts/seedLibrary.ts`
- Modify: `server/package.json`

**Interfaces:**

- Consumes: `buildSeedPlan`, `SeedPlan` from Task 4; `LibraryQuery` from Task 3.
- Produces: `applySeedPlan(query: LibraryQuery, plan: SeedPlan): Promise<{ topics: number; sections: number; questions: number; daily: number; skippedTopics: number }>`. It resolves each `ref` to the inserted question id, uses `ON CONFLICT (key, locale) DO NOTHING` for topics, skips a topic that already exists **whole**, and runs everything inside one transaction.

- [ ] **Step 1: Write the failing test**

`server/src/modules/library/librarySeedApply.test.ts`:

```ts
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
```

`questionIdAt` returns undefined until the store has inserted the section, so claiming the seed resolved a ref before the questions existed is impossible.

**Note on the fake:** it is an in-memory stand-in for the four tables. Inserts append to arrays and honour `ON CONFLICT ... DO NOTHING` by returning zero rows, which is exactly how the real database reports "already there". A second `applySeedPlan` run therefore reports every topic as skipped without inserting anything, and the same store also answers the question-id lookup the ref resolution needs. Any unexpected SQL throws, so a query drift fails the test loudly.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix server test -- src/modules/library/librarySeedApply.test.ts`
Expected: FAIL — `applySeedPlan` is not exported.

- [ ] **Step 3: Implement `applySeedPlan`**

Append to `server/src/modules/library/librarySeed.ts`:

```ts
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
    // second run (everything skipped) still finds its questions.
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
```

An unresolved `ref` deliberately throws so a partially seeded database never leaves the Daily pool pointing at nothing.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/librarySeedApply.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the CLI script**

`server/src/scripts/seedLibrary.ts`:

```ts
import path from 'node:path';
import dotenv from 'dotenv';
import pino from 'pino';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local'), override: true, quiet: true });

import { loadConfig } from '../config/env';
import { createPool } from '../db/client';
import { applySeedPlan, buildSeedPlan } from '../modules/library/librarySeed';
import type { LibraryQuery, Locale } from '../modules/library/libraryRepository';

const LOCALES: Locale[] = ['vi', 'en'];

async function seed(): Promise<void> {
  const config = loadConfig(process.env);
  const logger = pino({ level: config.nodeEnv === 'development' ? 'debug' : 'info' });
  const pool = createPool(config.databaseUrl, logger);
  const corpusDir = path.resolve(__dirname, '../../../content');
  try {
    for (const locale of LOCALES) {
      const dir = locale === 'vi' ? corpusDir : path.join(corpusDir, 'en');
      try {
        const plan = buildSeedPlan(dir, locale);
        for (const warning of plan.warnings) logger.warn(warning);
        const summary = await applySeedPlan(pool.query.bind(pool) as unknown as LibraryQuery, plan);
        logger.info({ locale, ...summary }, 'library seed complete');
      } catch (error: unknown) {
        // content/en/ is gitignored; a missing locale is expected, not fatal.
        if (locale !== 'vi' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          logger.warn({ locale }, 'corpus missing for locale; skipped');
          continue;
        }
        throw error;
      }
    }
  } finally {
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  pino().fatal({ err: error }, 'library seed failed');
  process.exit(1);
});
```

Add to `server/package.json` scripts, after `"migrate"`:

```json
"seed:library": "tsx src/scripts/seedLibrary.ts",
```

- [ ] **Step 6: Run the seed twice and confirm idempotency**

Run: `npm --prefix server run seed:library && npm --prefix server run seed:library`
Expected: first run reports `topics: 9, sections: 24, questions: 524, daily: 35` for `vi`; the second run reports `topics: 0, skippedTopics: 9, daily: 0, skippedDaily: 35` and inserts nothing. Section counts follow the corpus headings, so read the real numbers from the first run rather than treating them as fixed.

- [ ] **Step 7: Verify the row counts**

Run: `psql "$DATABASE_URL" -c 'SELECT locale, count(*) FROM library_topics GROUP BY locale' -c 'SELECT locale, count(*) FROM library_daily_entries GROUP BY locale'`
Expected: `vi` has 9 topics and 35 Daily entries; no duplicate `(key, locale)`.

- [ ] **Step 8: Commit**

```bash
git add server/src/modules/library/librarySeed.ts server/src/modules/library/librarySeedApply.test.ts server/src/scripts/seedLibrary.ts server/package.json
git commit -m "feat(server): seed corpus vào PostgreSQL"
```

---

### Task 6: Reader route reads the database

**Files:**

- Modify: `server/src/routes/library.ts`
- Create: `server/src/routes/library.test.ts`
- Modify: `server/src/index.ts` (import only, wiring lands in Task 8)

**Interfaces:**

- Consumes: `createLibraryRepository` / `LibraryRepository` from Task 3.
- Produces: `createLibraryRouter({ repo }: { repo: LibraryRepository }): Router`, replacing the current default export.

- [ ] **Step 1: Write the failing test**

`server/src/routes/library.test.ts`:

```ts
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryRepository } from '../modules/library/libraryRepository';
import { createLibraryRouter } from './library';

function appWith(repo: Partial<LibraryRepository>) {
  const instance = express();
  instance.use('/library', createLibraryRouter({ repo: repo as LibraryRepository }));
  return instance;
}

describe('library routes', () => {
  it('serves the index for a locale and hides archived topics', async () => {
    const listTopics = vi.fn().mockResolvedValue([
      {
        key: 'dsa',
        label: 'DSA',
        title: 'T',
        subtitle: null,
        color: '#B71C1C',
        questionCount: 58,
      },
    ]);

    const res = await request(appWith({ listTopics })).get('/library/index?lang=vi').expect(200);

    expect(listTopics).toHaveBeenCalledWith({ locale: 'vi' });
    expect(res.body).toEqual([
      { key: 'dsa', label: 'DSA', title: 'T', subtitle: null, color: '#B71C1C', questionCount: 58 },
    ]);
  });

  it('rejects an unsupported locale', async () => {
    const listTopics = vi.fn();

    await request(appWith({ listTopics })).get('/library/index?lang=fr').expect(400);
    expect(listTopics).not.toHaveBeenCalled();
  });

  it('serves a topic and 404s an unknown key', async () => {
    const getTopic = vi
      .fn()
      .mockResolvedValueOnce({ title: 'T', label: 'L', color: '#000000', sections: [] })
      .mockResolvedValueOnce(null);

    await request(appWith({ getTopic })).get('/library/topics/dsa?lang=vi').expect(200);
    const missing = await request(appWith({ getTopic }))
      .get('/library/topics/nope?lang=vi')
      .expect(404);
    expect(missing.body.code).toBe('library_not_found');
  });

  it('rejects a malformed topic key before touching the repository', async () => {
    const getTopic = vi.fn();

    await request(appWith({ getTopic })).get('/library/topics/Bad_Key?lang=vi').expect(400);
    expect(getTopic).not.toHaveBeenCalled();
  });

  it('defaults to vi when lang is absent', async () => {
    const listTopics = vi.fn().mockResolvedValue([]);

    await request(appWith({ listTopics })).get('/library/index').expect(200);
    expect(listTopics).toHaveBeenCalledWith({ locale: 'vi' });
  });

  it('runs the auth guard before touching the repository', async () => {
    const listTopics = vi.fn();

    // requireAuth forwards an error when the session middleware was never
    // initialized, which is exactly the state a test process is in.
    await request(appWith({ listTopics })).get('/library/index').expect(500);

    expect(listTopics).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix server test -- src/routes/library.test.ts`
Expected: FAIL — `createLibraryRouter` is not exported.

- [ ] **Step 3: Rewrite the route**

`server/src/routes/library.ts` becomes:

```ts
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import type { LibraryRepository, Locale } from '../modules/library/libraryRepository';

const topicKeyPattern = /^[a-z0-9-]+$/;

function resolveLocale(value: unknown): Locale | null {
  if (value === undefined || value === 'vi') return 'vi';
  if (value === 'en') return 'en';
  return null;
}

export function createLibraryRouter(deps: { repo: LibraryRepository }): Router {
  const router = Router();

  router.use(requireAuth, requireAdmin);

  router.get('/index', async (req, res, next) => {
    try {
      const locale = resolveLocale(req.query.lang);
      if (!locale) {
        res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
        return;
      }
      res.json(await deps.repo.listTopics({ locale }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/topics/:key', async (req, res, next) => {
    try {
      const key = req.params.key;
      if (typeof key !== 'string' || !topicKeyPattern.test(key)) {
        res.status(400).json({ error: 'Invalid topic key', code: 'invalid_topic_key' });
        return;
      }
      const locale = resolveLocale(req.query.lang);
      if (!locale) {
        res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
        return;
      }
      const topic = await deps.repo.getTopic({ key, locale });
      if (!topic) {
        res.status(404).json({ error: 'Topic not found', code: 'library_not_found' });
        return;
      }
      res.json(topic);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

Remove the now-unused `fs`, `path`, `contentRoot` and the `export default router`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/routes/library.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/library.ts server/src/routes/library.test.ts
git commit -m "feat(server): Library đọc từ PostgreSQL"
```

---

### Task 7: Daily route reads the pool from the database

**Files:**

- Modify: `server/src/routes/daily.ts`
- Modify: `server/src/routes/daily.test.ts`

**Interfaces:**

- Consumes: `LibraryRepository` from Task 3; `blocksToText` from Task 1.
- Produces: `createDailyRouter` dependencies change from `{ query, requireAuth, requireAdmin, secret, timeZone, contentDir, recordStudyDay }` to `{ query, repo, requireAuth, requireAdmin, secret, timeZone, recordStudyDay }` — `contentDir` is removed. The response shape of every Daily route is unchanged.

- [ ] **Step 1: Update the test to drive the pool through the repository**

`server/src/routes/daily.test.ts` currently writes a `daily.json` into a temp directory and passes `contentDir`. Delete the `fs`, `os`, `path` imports, the `contentDir` variable, the `beforeEach` that creates the fixture, the `afterEach` that removes it, and the `contentDir` option. The head of the file becomes:

```ts
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryRepository } from '../modules/library/libraryRepository';
import { createDailyRouter } from './daily';

const auth: RequestHandler = (req, _res, next) => {
  req.user = { userId: 'user-1', email: 'owner@example.com', role: 'admin' };
  next();
};

/** The single fib entry the fixture used to write to content/daily.json. */
const fibEntry = {
  entryId: 'fib-1',
  type: 'fib' as const,
  difficulty: 1,
  questionId: null,
  topicKey: null,
  prompt: 'A ___ stores key-value pairs.',
  blanks: ['hash table'],
  hint: null,
};

describe('daily routes', () => {
  const query = vi.fn();
  const repo = {
    listDailyEntries: vi.fn(),
    getQuestion: vi.fn(),
    listSiblingBlocks: vi.fn(),
  };

  beforeEach(() => {
    query.mockReset();
    repo.listDailyEntries.mockReset().mockResolvedValue([fibEntry]);
    repo.getQuestion.mockReset();
    repo.listSiblingBlocks.mockReset();
  });

  function app() {
    const instance = express();
    instance.use(express.json());
    instance.use(
      '/daily',
      createDailyRouter({
        query,
        repo: repo as unknown as LibraryRepository,
        requireAuth: auth,
        requireAdmin: auth,
        secret: '0123456789abcdef0123456789abcdef',
        timeZone: 'Asia/Ho_Chi_Minh',
        recordStudyDay: vi.fn().mockResolvedValue(undefined),
      }),
    );
    return instance;
  }

  // the two existing tests continue here, unchanged except that they no longer
  // need the temp-directory setup
```

Then append one test that proves the pool comes from the repository:

```ts
it('reads the Daily pool from the repository for the requested locale', async () => {
  const challenge = await request(app()).get('/daily').expect(200);

  expect(repo.listDailyEntries).toHaveBeenCalledWith({ locale: 'vi' });
  expect(challenge.body.questions).toHaveLength(1);
});
```

Add a second new test that proves an MCQ entry is resolved through the foreign key and builds options from sibling questions:

```ts
it('builds an MCQ from the referenced question and its siblings', async () => {
  repo.listDailyEntries.mockResolvedValue([
    {
      entryId: 'mcq-1',
      type: 'mcq',
      difficulty: 1,
      questionId: 'q1',
      topicKey: 'javascript',
      prompt: null,
      blanks: null,
      hint: null,
    },
  ]);
  repo.getQuestion.mockResolvedValue({
    blocks: [{ type: 'text', text: 'Closures capture the enclosing scope.' }],
    questionText: 'Closure là gì?',
  });
  repo.listSiblingBlocks.mockResolvedValue([
    [{ type: 'text', text: 'A promise represents a future value that may resolve.' }],
    [{ type: 'text', text: 'An event loop schedules callbacks onto the task queue.' }],
    [{ type: 'text', text: 'A module caches its exports after the first evaluation.' }],
  ]);

  const challenge = await request(app()).get('/daily').expect(200);

  const question = challenge.body.questions[0];
  expect(question).toMatchObject({ id: 'mcq-1', type: 'mcq', q: 'Closure là gì?' });
  expect(question.options).toHaveLength(4);
  expect(
    question.options.some((option: { text: string }) => option.text.startsWith('Closures capture')),
  ).toBe(true);
  expect(question).not.toHaveProperty('correctIdx');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm --prefix server test -- src/routes/daily.test.ts`
Expected: FAIL — `createDailyRouter` does not accept `repo` yet.

- [ ] **Step 3: Rewrite the Daily data access**

In `server/src/routes/daily.ts`:

1. Add to the dependencies interface and delete `contentDir`:

```ts
interface DailyRouterDependencies {
  query: DailyQuery;
  repo: LibraryRepository;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  secret: string;
  timeZone: string;
  recordStudyDay: (userId: string) => Promise<void>;
}
```

2. Delete `localizedContentDir`, `loadTopic`, `resolveQuestion`, `extractTextFromBlocks` and the `fs`/`path` imports. `extractTextFromBlocks` is replaced by `blocksToText`, and `generateMcqOptions` needs the `Block` type, so add:

```ts
import { blocksToText, type Block } from '../modules/library/libraryBlocks';
import type { LibraryRepository } from '../modules/library/libraryRepository';
```

3. Replace the pool read in `router.get('/')` with the repository:

```ts
const entries = await deps.repo.listDailyEntries({ locale });
const chosen = pickDaily(
  entries.filter((entry) => entry.type === 'mcq' || entry.type === 'fib'),
  date,
);
```

4. Build MCQ questions through the repository, keeping the existing option algorithm byte-for-byte:

```ts
for (const entry of chosen) {
  if (entry.type === 'fib' && entry.prompt && entry.blanks) {
    answerKeys.push({ id: entry.entryId, type: 'fib', blanks: entry.blanks });
    questions.push({
      id: entry.entryId,
      type: 'fib',
      prompt: entry.prompt,
      blankCount: entry.blanks.length,
      ...(entry.hint ? { hint: entry.hint } : {}),
      ...(entry.topicKey ? { topic: entry.topicKey } : {}),
    });
    continue;
  }
  if (entry.type !== 'mcq' || !entry.questionId || !entry.topicKey) continue;
  const question = await deps.repo.getQuestion({ questionId: entry.questionId });
  if (!question) continue;
  const correctText = blocksToText(question.blocks);
  if (!correctText) continue;
  const siblingBlocks = await deps.repo.listSiblingBlocks({
    topicKey: entry.topicKey,
    locale,
    excludeQuestionId: entry.questionId,
  });
  const { options, correctIdx } = generateMcqOptions(correctText, siblingBlocks);
  answerKeys.push({ id: entry.entryId, type: 'mcq', correctIdx });
  questions.push({ id: entry.entryId, type: 'mcq', q: question.questionText, options });
}
```

5. Change `generateMcqOptions` to take `(correctText: string, siblingBlocks: Block[][])`, keeping the current filtering rules exactly:

```ts
function generateMcqOptions(correctText: string, siblingBlocks: Block[][]) {
  const distractors: string[] = [];
  for (const blocks of siblingBlocks) {
    const text = blocksToText(blocks);
    if (text && text !== correctText && text.length >= 20) distractors.push(text.slice(0, 120));
    if (distractors.length >= 6) break;
  }
  const candidates = [
    { text: correctText.slice(0, 120), correct: true },
    ...distractors
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map((text) => ({ text, correct: false })),
  ].sort(() => 0.5 - Math.random());
  return {
    options: candidates.map(({ text }, idx) => ({ text, idx })),
    correctIdx: candidates.findIndex((option) => option.correct),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm --prefix server test -- src/routes/daily.test.ts`
Expected: PASS, including the new locale test.

- [ ] **Step 5: Typecheck**

Run: `npm --prefix server run typecheck`
Expected: no errors; `contentDir` no longer appears in the Daily dependencies.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/daily.ts server/src/routes/daily.test.ts
git commit -m "feat(server): Daily pool đọc từ PostgreSQL"
```

---

### Task 8: Composition root wiring

**Files:**

- Modify: `server/src/index.ts`

**Interfaces:**

- Consumes: `createLibraryRepository` (Task 3), `createLibraryRouter` (Task 6), the new `createDailyRouter` signature (Task 7).
- Produces: a running server whose Library and Daily routes use PostgreSQL; `contentDir` disappears from `index.ts`.

- [ ] **Step 1: Wire the repository**

In `server/src/index.ts`:

```ts
import { createLibraryRepository, type LibraryQuery } from './modules/library/libraryRepository';
import { createLibraryRouter } from './routes/library';
```

Replace the `libraryRouter` default import and its mounting:

```ts
const libraryRepository = createLibraryRepository({
  query: pool.query.bind(pool) as unknown as LibraryQuery,
});
```

```ts
app.use('/api/v1/library', createLibraryRouter({ repo: libraryRepository }));
```

Pass it to the Daily router and drop `contentDir`:

```ts
const dailyRoutes = createDailyRouter({
  query: pool.query.bind(pool) as unknown as DailyQuery,
  repo: libraryRepository,
  requireAuth,
  requireAdmin,
  secret: config.sessionSecret,
  timeZone: config.timeZone,
  recordStudyDay: async (userId) => recordStudyDay(userId, pool, config.timeZone),
});
```

- [ ] **Step 2: Typecheck and run the server tests**

Run: `npm --prefix server run typecheck && npm --prefix server test`
Expected: no type errors; every server test passes.

- [ ] **Step 3: Smoke the live routes**

Run: `npm run dev` in one terminal, then:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/v1/library/index
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/api/v1/daily
```

Expected: both `401` without a session cookie, proving the routes still exist and stay behind auth. With an admin session, `/api/v1/library/index` returns 9 topics and `/api/v1/library/topics/dsa?lang=vi` returns 58 questions.

- [ ] **Step 4: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): wire Library repository vào composition root"
```

---

### Task 9: Round-trip fidelity test

**Files:**

- Create: `server/src/modules/library/libraryFidelity.test.ts`

**Interfaces:**

- Consumes: `buildSeedPlan` (Task 4), `applySeedPlan` (Task 5), `createLibraryRepository` (Task 3).
- Produces: proof that seeding the tracked corpus and reading it back through the reader projection reproduces the original JSON exactly.

- [ ] **Step 1: Write the failing test**

`server/src/modules/library/libraryFidelity.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createLibraryRepository, type LibraryQuery } from './libraryRepository';
import { applySeedPlan, buildSeedPlan } from './librarySeed';

const CORPUS = path.resolve(__dirname, '../../../../content');

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

/** In-memory stand-in for the four tables: no database, so CI can run this. */
function memoryLibrary() {
  const topics: TopicRow[] = [];
  const sections: SectionRow[] = [];
  const questions: QuestionRow[] = [];
  const daily: string[] = [];
  let counter = 0;

  const query = (async <Row>(text: string, values: unknown[] = []) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return { rows: [] as Row[] };

    if (text.startsWith('INSERT INTO library_topics')) {
      const [key, locale] = values as [string, string];
      if (topics.some((topic) => topic.key === key && topic.locale === locale))
        return { rows: [] as Row[] };
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
      if (daily.includes(entryId)) return { rows: [] as Row[] };
      daily.push(entryId);
      return { rows: [{ id: `daily-${++counter}` }] as Row[] };
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
      const rows = sections
        .filter((section) => section.topic_id === topicId)
        .sort((a, b) => a.position - b.position)
        .flatMap((section) => {
          const items = questions
            .filter((question) => question.section_id === section.id)
            .sort((a, b) => a.position - b.position);
          if (items.length === 0) {
            return [
              {
                section_id: section.id,
                section_name: section.name,
                question_id: null,
                code: null,
                prompt: null,
                blocks: null,
              },
            ];
          }
          return items.map((question) => ({
            section_id: section.id,
            section_name: section.name,
            question_id: question.id,
            code: question.code,
            prompt: question.prompt,
            blocks: question.blocks,
          }));
        });
      return { rows: rows as Row[] };
    }

    throw new Error(`unexpected SQL: ${text.slice(0, 60)}`);
  }) as LibraryQuery;

  return { query };
}

describe('seed → projection fidelity for the tracked vi corpus', () => {
  const store = memoryLibrary();
  const repo = createLibraryRepository({ query: store.query });
  const plan = buildSeedPlan(CORPUS, 'vi');

  it('seeds the corpus exactly once', async () => {
    const first = await applySeedPlan(store.query, plan);

    expect(first.topics).toBe(9);
    expect(first.questions).toBe(524);
    expect(first.daily).toBe(35);

    const second = await applySeedPlan(store.query, plan);
    expect(second.topics).toBe(0);
    expect(second.questions).toBe(0);
    expect(second.skippedTopics).toBe(9);
    expect(second.skippedDaily).toBe(35);
  });

  it('reproduces the index file exactly', async () => {
    const expected = JSON.parse(fs.readFileSync(path.join(CORPUS, 'index.json'), 'utf8')) as Array<{
      key: string;
      label: string;
      title: string;
      subtitle?: string;
      color: string;
      questionCount: number;
    }>;

    const actual = await repo.listTopics({ locale: 'vi' });

    expect(actual).toEqual(
      expected.map((entry) => ({
        key: entry.key,
        label: entry.label,
        title: entry.title,
        subtitle: entry.subtitle ?? null,
        color: entry.color,
        questionCount: entry.questionCount,
      })),
    );
  });

  it('reproduces every topic file exactly', async () => {
    const index = JSON.parse(fs.readFileSync(path.join(CORPUS, 'index.json'), 'utf8')) as Array<{
      key: string;
    }>;

    for (const { key } of index) {
      const file = JSON.parse(fs.readFileSync(path.join(CORPUS, `${key}.json`), 'utf8')) as {
        title: string;
        subtitle?: string;
        label: string;
        color: string;
        sections: Array<{
          name: string;
          questions: Array<{ id?: string; q: string; blocks: unknown[] }>;
        }>;
      };

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
});
```

`jsonb` does not preserve object key order, so this compares values with `toEqual` rather than comparing serialized bytes. That is the honest definition of "the same data".

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix server test -- src/modules/library/libraryFidelity.test.ts`
Expected: FAIL until the fake store answers both the seed inserts and the projection selects.

- [ ] **Step 3: Fix the fake store**

If a branch does not match, the fake throws `unexpected SQL: …` with the first 60 characters of the statement. Read the repository's SQL and align the branch matcher; never loosen the throw into a silent empty result, because a silent empty result is exactly the data loss this test exists to catch.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/libraryFidelity.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole gate**

Run: `npm run check`
Expected: format, lint, both typechecks, both test suites, both builds, the private-bundle scan and the audit all pass.

- [ ] **Step 6: Commit**

```bash
git add server/src/modules/library/libraryFidelity.test.ts
git commit -m "test(server): đối chiếu projection với corpus gốc"
```

---

### Task 10: Record the decision and update the docs

**Files:**

- Create: `docs/ADR-004-library-corpus-in-postgresql.md`
- Modify: `AGENTS.md`, `README.md`

**Interfaces:**

- Consumes: nothing.
- Produces: documentation that matches the new source of truth.

- [ ] **Step 1: Write ADR-004**

Follow the shape of `docs/ADR-001` and `docs/ADR-002`: Context, Decision, Options considered, Consequences. Record that:

- PostgreSQL is the source of truth for topics, sections, questions and the Daily pool; the reader API projects the database back to the previous JSON shapes.
- `content/*.json` stays in the repository as the import snapshot and the seed input, and `content/en/` stays gitignored.
- The seed resolves positional Daily refs into real foreign keys, so reordering or deleting a question can no longer silently mis-target the pool.
- Consequently, ADR-002's statement that `content/*.json` is the corpus is superseded for the Library; the privacy rules there still hold.
- Consequence to keep visible: the owner must run `npm --prefix server run seed:library` when standing up a fresh database, and `level` is `null` for every seeded question because the corpus has no levels.

- [ ] **Step 2: Update `AGENTS.md`**

In the source-of-truth section, replace the corpus line with one that names PostgreSQL as the owner of the Library corpus and the Daily pool, keeps Obsidian as the owner of Daily/Journey/knowledge Markdown, and adds `npm --prefix server run seed:library` to the canonical commands. Add ADR-004 to the architecture references.

- [ ] **Step 3: Update `README.md`**

In the privacy and authorization section, note that the Library corpus lives in PostgreSQL, that `content/*.json` is the seed snapshot, and that a fresh database needs `npm --prefix server run seed:library` after `migrate`. Add the ADR-004 link.

- [ ] **Step 4: Run the gate and commit**

Run: `npm run check`
Expected: green.

```bash
git add docs/ADR-004-library-corpus-in-postgresql.md AGENTS.md README.md
git commit -m "docs: ADR-004 Library corpus trong PostgreSQL"
```

---

## Verification

Phase 1 is done when all of the following hold:

- [ ] `npm --prefix server run migrate` lists `011_add_library_tables.sql`.
- [ ] `npm --prefix server run seed:library` fills 9 topics, 524 questions and 35 Daily entries for `vi`, and a second run inserts nothing new.
- [ ] `npm run check` is green, including the fidelity test and `check:bundle`.
- [ ] An admin session returns the same index and topic JSON as before the switch, including `id`, `q` and `blocks` on every question.
- [ ] `/api/v1/daily` still returns 5 questions with the same shape, and the answer key never reaches the client.
- [ ] `content/*.json` is unmodified (`git status` clean for `content/`).

## Notes for the executor

- Do not add write endpoints here; they are phase 2.
- If the fidelity test surfaces a mismatch, fix the seed or the projection — never the JSON files.
- Keep `content/en/` optional everywhere; CI does not have it.

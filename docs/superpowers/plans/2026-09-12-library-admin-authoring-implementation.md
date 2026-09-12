# Library Admin Authoring Implementation Plan (Phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the server-enforced write surface for Library authoring: create and edit topics, sections and questions (with a level per question), archive/restore topics, import and export a topic as JSON, and manage the Daily pool.

**Architecture:** A Zod validation module owns every request contract and the JSON import document format. A new `libraryAuthoring` repository owns every mutation plus the admin-shaped reads (ids, positions, levels, archived flags) that the editor needs — deliberately separate from the frozen reader projection. A new `libraryAdmin` router mounts all of it under `/api/v1/library/admin` behind the existing `requireAuth` + `requireAdmin` guards.

**Tech Stack:** Express 5 + TypeScript (CommonJS), PostgreSQL via `pg`, Zod, Vitest with `supertest`.

**Spec:** `docs/superpowers/specs/2026-09-12-library-content-management-design.md` (sections "Admin API", "Validation", "Safety")

**Phase 1 is done and merged** (`docs/superpowers/plans/2026-09-12-library-data-layer-implementation.md`, PR #6). Phase 3 (the authoring UI) is a later plan; nothing here adds frontend code.

## Global Constraints

- Every route is behind `requireAuth` + `requireAdmin`. Authorization is enforced on the server, never assumed from the client.
- `key` of a topic is **immutable after creation**. `key` appears in URLs, in the positional progress key `topic:section:question`, and in Daily pool references, so renaming it would silently discard learned progress. No endpoint accepts a `key` change; `PATCH /topics/:id` rejects it as an unknown field via `.strict()`.
- Never log question or answer text. Logs carry `id`, `key` and the action only.
- No new migration: phase 1's `011_add_library_tables.sql` already provides every table and constraint this phase needs.
- Every write runs inside one transaction. Reordering renumbers siblings so `position` stays gap-free.
- `npm run check` is the single definition of green. Commit after every task.
- Server is CommonJS. Follow the existing `createX({ deps })` factory style with an injected `query`.

## Post-implementation audit

Audit performed on 2026-09-12 against commit `b53f735eecfa67ef0d16716140bccbe787d1b110`. The implementation commits below are reachable through PR #7's merged topology; the listed focused commands were rerun during this audit. A checked audit outcome means only that the commit proves the implementation exists and/or the current command passed. It does not reconstruct the original implementation sequence.

| Task                                     | Audit outcome                                                     | Implementation commit(s) | Current matching test file                                    | Verification command                                                               |
| ---------------------------------------- | ----------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1. Validation/import contract            | [x] Implemented; current regression verified                      | `c84cb40`, `c023d4c`     | `server/src/modules/library/libraryValidation.test.ts`        | `npm --prefix server test -- src/modules/library/libraryValidation.test.ts`        |
| 2. Topic authoring repository            | [x] Implemented; current regression verified                      | `80759a7`                | `server/src/modules/library/libraryAuthoring.test.ts`         | `npm --prefix server test -- src/modules/library/libraryAuthoring.test.ts`         |
| 3. Section/question authoring and guards | [x] Implemented; current regression verified                      | `a912ddf`                | `server/src/modules/library/libraryAuthoringSections.test.ts` | `npm --prefix server test -- src/modules/library/libraryAuthoringSections.test.ts` |
| 4. Import and Daily pool                 | [x] Implemented; current regression verified                      | `75a10a3`, `c023d4c`     | `server/src/modules/library/libraryAuthoringImport.test.ts`   | `npm --prefix server test -- src/modules/library/libraryAuthoringImport.test.ts`   |
| 5. Admin router                          | [x] Implemented; current regression verified                      | `4270d68`, `c023d4c`     | `server/src/routes/libraryAdmin.test.ts`                      | `npm --prefix server test -- src/routes/libraryAdmin.test.ts`                      |
| 6. Wiring and documentation              | [x] Implemented; [ ] current gate blocked by unrelated formatting | `869c539`                | — (wiring/documentation task)                                 | `npm run check`                                                                    |

The original unchecked RED steps mean **not reconstructable**, not implementation missing. Historical RED evidence unavailable; current regression test verified. No saved reviewer artifact was found, so no historical reviewer action is marked complete. The original live smoke-test checkbox remains unchecked because there is no saved smoke-test artifact.

## Error contract

| HTTP | Code                       | When                                                                                                 |
| ---- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| 400  | `library_invalid_document` | Body fails Zod. Response carries `path`, e.g. `sections[2].questions[5].blocks[1].type`.             |
| 403  | `admin_required`           | Existing `requireAdmin` guard.                                                                       |
| 404  | `library_not_found`        | Unknown topic/section/question/daily id.                                                             |
| 409  | `library_key_in_use`       | `(key, locale)` already exists.                                                                      |
| 409  | `library_in_use`           | Daily entries still reference the question/section/topic being removed. Response carries `entryIds`. |
| 409  | `library_archived`         | Mutating the children of an archived topic; restore it first.                                        |

## Endpoint contract

| Method | Path                                                   | Success                                |
| ------ | ------------------------------------------------------ | -------------------------------------- |
| GET    | `/api/v1/library/admin/topics?lang=&includeArchived=1` | 200 `{ items: AdminTopicListEntry[] }` |
| GET    | `/api/v1/library/admin/topics/:id`                     | 200 `AdminTopicDetail`                 |
| POST   | `/api/v1/library/admin/topics`                         | 201 `{ id }`                           |
| PATCH  | `/api/v1/library/admin/topics/:id`                     | 204                                    |
| POST   | `/api/v1/library/admin/topics/:id/archive`             | 200 `{ snapshot: ImportDocument }`     |
| POST   | `/api/v1/library/admin/topics/:id/restore`             | 204                                    |
| POST   | `/api/v1/library/admin/topics/:id/sections`            | 201 `{ id }`                           |
| PATCH  | `/api/v1/library/admin/sections/:id`                   | 204                                    |
| DELETE | `/api/v1/library/admin/sections/:id`                   | 200 `{ snapshot }`                     |
| POST   | `/api/v1/library/admin/sections/:id/questions`         | 201 `{ id }`                           |
| PATCH  | `/api/v1/library/admin/questions/:id`                  | 204                                    |
| DELETE | `/api/v1/library/admin/questions/:id`                  | 200 `{ snapshot }`                     |
| POST   | `/api/v1/library/admin/topics/:id/import`              | 200 `{ sections, questions }`          |
| GET    | `/api/v1/library/admin/topics/:id/export`              | 200 `ImportDocument`                   |
| GET    | `/api/v1/library/admin/daily-entries?locale=`          | 200 `{ items: AdminDailyEntry[] }`     |
| POST   | `/api/v1/library/admin/daily-entries`                  | 201 `{ id }`                           |
| PATCH  | `/api/v1/library/admin/daily-entries/:id`              | 204                                    |
| DELETE | `/api/v1/library/admin/daily-entries/:id`              | 204                                    |

`snapshot` is always the topic document **as it was before the mutation**, which is exactly the import format — so a delete is undoable by importing the snapshot back.

## File Structure

```text
server/src/modules/library/libraryValidation.ts   new — write contracts + import document + helpers
server/src/modules/library/libraryAuthoring.ts    new — every mutation + admin-shaped reads
server/src/routes/libraryAdmin.ts                 new — the admin router (thin handlers)
server/src/index.ts                               mod — build and mount the admin router
README.md                                         mod — document the authoring endpoints
```

---

### Task 1: Validation contracts and the import document

**Files:**

- Create: `server/src/modules/library/libraryValidation.ts`
- Test: `server/src/modules/library/libraryValidation.test.ts`

**Interfaces:**

- Consumes: `blockListSchema`, `MAX_TEXT_LENGTH`, `Block` from `libraryBlocks.ts`; `Locale` from `libraryRepository.ts`.
- Produces:
  - `Level = 'basic' | 'intermediate' | 'advanced'`
  - `topicCreateSchema`, `topicPatchSchema`, `sectionCreateSchema`, `sectionPatchSchema`, `questionCreateSchema`, `questionPatchSchema`, `importRequestSchema`, `dailyEntryCreateSchema`, `dailyEntryPatchSchema`
  - `ImportQuestion = { code: string | null; prompt: string; level: Level | null; blocks: Block[] }`
  - `ImportSection = { name: string; questions: ImportQuestion[] }`
  - `ImportDocument = { title: string; subtitle: string | null; label: string; color: string; sections: ImportSection[] }`
  - `normalizeImportDocument(input: z.infer<typeof importRequestSchema>['document']): ImportDocument`
  - `formatValidationIssue(error: z.ZodError): { path: string; message: string }`

**Rules locked by the spec:** the import document is the corpus file format with `level` optional; both `code` and the corpus's `id` are accepted as the question label (`code` wins). Size ceilings come from `libraryBlocks.ts` and are not duplicated here.

- [ ] **Step 1: Write the failing test**

`server/src/modules/library/libraryValidation.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails** — Historical RED evidence unavailable; current regression test verified.

Run: `npm --prefix server test -- src/modules/library/libraryValidation.test.ts`
Expected: FAIL — cannot resolve `./libraryValidation`.

- [ ] **Step 3: Write the implementation**

`server/src/modules/library/libraryValidation.ts`:

```ts
import { z } from 'zod';
import { blockListSchema, MAX_TEXT_LENGTH, type Block } from './libraryBlocks';
import type { Locale } from './libraryRepository';

export type Level = 'basic' | 'intermediate' | 'advanced';

export const LEVELS: Level[] = ['basic', 'intermediate', 'advanced'];

const localeSchema = z.enum(['vi', 'en']);
const levelSchema = z.enum(['basic', 'intermediate', 'advanced']);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #B71C1C');
const positionSchema = z.number().int().min(0).max(10_000);
const topicKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, digits and dashes')
  .min(2)
  .max(40);

function atLeastOneField<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field is required',
    });
}

export const topicCreateSchema = z
  .object({
    key: topicKeySchema,
    locale: localeSchema,
    label: z.string().trim().min(1).max(60),
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(300).nullable().optional(),
    color: colorSchema,
  })
  .strict();

export const topicPatchSchema = atLeastOneField({
  label: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).nullable(),
  color: colorSchema,
  position: positionSchema,
});

export const sectionCreateSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

export const sectionPatchSchema = atLeastOneField({
  name: z.string().trim().min(1).max(200),
  position: positionSchema,
});

export const questionCreateSchema = z
  .object({
    code: z.string().trim().max(20).nullable().optional(),
    prompt: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    level: levelSchema.nullable().optional(),
    blocks: blockListSchema,
  })
  .strict();

export const questionPatchSchema = atLeastOneField({
  code: z.string().trim().max(20).nullable(),
  prompt: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  level: levelSchema.nullable(),
  blocks: blockListSchema,
  position: positionSchema,
});

const importQuestionSchema = z
  .object({
    code: z.string().trim().max(20).optional(),
    id: z.string().trim().max(20).optional(),
    level: levelSchema.nullable().optional(),
    q: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    blocks: blockListSchema,
  })
  .strict();

const importSectionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    questions: z.array(importQuestionSchema).min(1).max(500),
  })
  .strict();

const importDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(300).optional(),
    label: z.string().trim().min(1).max(60),
    color: colorSchema,
    sections: z.array(importSectionSchema).min(1).max(50),
  })
  .strict();

export const importRequestSchema = z
  .object({ mode: z.enum(['replace', 'append']), document: importDocumentSchema })
  .strict();

const dailyEntryBase = {
  entryId: z.string().trim().min(1).max(60),
  locale: localeSchema,
  difficulty: z.number().int().min(1).max(3),
  topicKey: z.string().trim().max(40).nullable().optional(),
  hint: z.string().trim().max(300).nullable().optional(),
};

export const dailyEntryCreateSchema = z.discriminatedUnion('type', [
  z.object({ ...dailyEntryBase, type: z.literal('mcq'), questionId: z.string().uuid() }).strict(),
  z
    .object({
      ...dailyEntryBase,
      type: z.literal('fib'),
      prompt: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
      blanks: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
    })
    .strict(),
]);

export const dailyEntryPatchSchema = atLeastOneField({
  difficulty: z.number().int().min(1).max(3),
  questionId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  blanks: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  hint: z.string().trim().max(300).nullable(),
  position: positionSchema,
});

export interface ImportQuestion {
  code: string | null;
  prompt: string;
  level: Level | null;
  blocks: Block[];
}

export interface ImportSection {
  name: string;
  questions: ImportQuestion[];
}

export interface ImportDocument {
  title: string;
  subtitle: string | null;
  label: string;
  color: string;
  sections: ImportSection[];
}

type ImportDocumentInput = z.infer<typeof importDocumentSchema>;

export function normalizeImportDocument(input: ImportDocumentInput): ImportDocument {
  return {
    title: input.title,
    subtitle: input.subtitle ?? null,
    label: input.label,
    color: input.color,
    sections: input.sections.map((section) => ({
      name: section.name,
      questions: section.questions.map((question) => ({
        code: question.code ?? question.id ?? null,
        prompt: question.q,
        level: question.level ?? null,
        blocks: question.blocks,
      })),
    })),
  };
}

/** Turns a Zod failure into the exact path an author needs to fix. */
export function formatValidationIssue(error: z.ZodError): { path: string; message: string } {
  const issue = error.issues[0];
  if (!issue) return { path: '', message: 'Invalid document' };
  const path = issue.path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      const text = String(segment);
      return index === 0 ? text : `.${text}`;
    })
    .join('');
  return { path, message: issue.message };
}

export type { Locale };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/libraryValidation.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/library/libraryValidation.ts server/src/modules/library/libraryValidation.test.ts
git commit -m "feat(server): hợp đồng validate cho soạn nội dung Library"
```

---

### Task 2: Authoring repository — topics

**Files:**

- Create: `server/src/modules/library/libraryAuthoring.ts`
- Test: `server/src/modules/library/libraryAuthoring.test.ts`

**Interfaces:**

- Consumes: `LibraryQuery`, `Locale` from `libraryRepository.ts`; `Block` from `libraryBlocks.ts`; `Level`, `ImportDocument` from `libraryValidation.ts`.
- Produces:
  - `createLibraryAuthoring({ query, withTransaction })` where `withTransaction: <T>(fn: (tx: LibraryQuery) => Promise<T>) => Promise<T>`
  - `type LibraryAuthoring = ReturnType<typeof createLibraryAuthoring>`
  - Types: `AdminTopicListEntry`, `AdminQuestion`, `AdminSection`, `AdminTopicDetail`, `AdminDailyEntry`
  - `class LibraryConflictError extends Error { code: 'library_key_in_use' | 'library_in_use' | 'library_archived'; entryIds?: string[] }` and `class LibraryNotFoundError extends Error { code: 'library_not_found' }`

**Method signatures this task produces (all later tasks use these exact names):**

```ts
listTopics(input: { locale: Locale; includeArchived?: boolean }): Promise<AdminTopicListEntry[]>
getTopicDetail(input: { topicId: string }): Promise<AdminTopicDetail | null>
findTopicStatus(topicId: string): Promise<{ id: string; archived: boolean } | null>
createTopic(input: { key; locale; label; title; subtitle: string | null; color }): Promise<{ id: string }>
updateTopic(topicId: string, patch: { label?; title?; subtitle?: string | null; color?; position?: number }): Promise<void>
setTopicArchived(topicId: string, archived: boolean): Promise<void>
exportTopicDocument(topicId: string): Promise<ImportDocument | null>
```

**Positions append:** `position` is `COALESCE(MAX(position) + 1, 0)` inside the parent scope, computed in SQL so two concurrent creates cannot collide:

```sql
INSERT INTO library_sections (topic_id, position, name)
VALUES ($1, COALESCE((SELECT MAX(position) + 1 FROM library_sections WHERE topic_id = $1), 0), $2)
RETURNING id
```

**Reorder renumbers inside one transaction:** read the ordered ids of the siblings, remove the moved row, splice it back at the requested index, then `UPDATE ... SET position = $2 WHERE id = $1` for each row whose position changed. Only changed rows are written.

- [ ] **Step 1: Write the failing test**

`server/src/modules/library/libraryAuthoring.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLibraryAuthoring, LibraryConflictError } from './libraryAuthoring';
import type { LibraryQuery } from './libraryRepository';

function harness() {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    calls.push({ text, values });
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

describe('authoring repository — topics', () => {
  it('appends a new topic at the end of its locale', async () => {
    const { authoring, calls } = harness();

    await authoring.createTopic({
      key: 'system-design',
      locale: 'vi',
      label: 'System Design',
      title: 'System Design',
      subtitle: null,
      color: '#123456',
    });

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
  });

  it('reports a duplicate topic as library_key_in_use', async () => {
    const authoring = createLibraryAuthoring({
      query: (async () => {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }) as unknown as LibraryQuery,
      withTransaction: (async (fn) => fn({} as LibraryQuery)) as never,
    });

    await expect(
      authoring.createTopic({
        key: 'dsa',
        locale: 'vi',
        label: 'DSA',
        title: 'DSA',
        subtitle: null,
        color: '#123456',
      }),
    ).rejects.toBeInstanceOf(LibraryConflictError);
  });

  it('hides archived topics unless they are asked for', async () => {
    const { authoring, calls } = harness();

    await authoring.listTopics({ locale: 'vi' });
    await authoring.listTopics({ locale: 'vi', includeArchived: true });

    expect(calls[0]?.text).toContain('archived_at IS NULL');
    expect(calls[1]?.values).toEqual(['vi', true]);
  });

  it('maps the archived flag and returns null for an unknown topic', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 't-1', archived: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const authoring = createLibraryAuthoring({
      query: query as unknown as LibraryQuery,
      withTransaction: (async (fn) => fn(query as unknown as LibraryQuery)) as never,
    });

    expect(await authoring.findTopicStatus('t-1')).toEqual({ id: 't-1', archived: true });
    expect(await authoring.findTopicStatus('missing')).toBeNull();
    expect(query.mock.calls[0]?.[0]).toContain('archived_at IS NOT NULL');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails** — Historical RED evidence unavailable; current regression test verified.

Run: `npm --prefix server test -- src/modules/library/libraryAuthoring.test.ts`
Expected: FAIL — cannot resolve `./libraryAuthoring`.

- [ ] **Step 3: Write the implementation**

Create `server/src/modules/library/libraryAuthoring.ts` with the error classes, the admin types, and the topic methods:

```ts
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

type Tx = <T>(fn: (tx: LibraryQuery) => Promise<T>) => Promise<T>;

export function createLibraryAuthoring(deps: { query: LibraryQuery; withTransaction: Tx }) {
  async function reorder(
    tx: LibraryQuery,
    table: 'library_sections' | 'library_questions',
    scopeColumn: 'topic_id' | 'section_id',
    scopeId: string,
    rowId: string,
    targetIndex: number,
  ): Promise<void> {
    const { rows } = await tx<{ id: string }>(
      `SELECT id FROM ${table} WHERE ${scopeColumn} = $1 ORDER BY position, id`,
      [scopeId],
    );
    const ids = rows.map((row) => row.id).filter((id) => id !== rowId);
    const clamped = Math.max(0, Math.min(targetIndex, ids.length));
    ids.splice(clamped, 0, rowId);
    for (const [index, id] of ids.entries()) {
      await tx(`UPDATE ${table} SET position = $2 WHERE id = $1 AND position IS DISTINCT FROM $2`, [
        id,
        index,
      ]);
    }
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
      }));
    },

    async getTopicDetail(input: { topicId: string }): Promise<AdminTopicDetail | null> {
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
      let currentId: string | null = null;
      let current: AdminSection | null = null;
      for (const row of content.rows) {
        if (!current || currentId !== row.section_id) {
          current = {
            id: row.section_id,
            position: Number(row.section_position),
            name: row.section_name,
            questions: [],
          };
          currentId = row.section_id;
          sections.push(current);
        }
        if (!row.question_id) continue;
        current.questions.push({
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
    },

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

    async updateTopic(
      topicId: string,
      patch: {
        label?: string;
        title?: string;
        subtitle?: string | null;
        color?: string;
        position?: number;
      },
    ): Promise<void> {
      const assignments: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };
      if (patch.label !== undefined) set('label', patch.label);
      if (patch.title !== undefined) set('title', patch.title);
      if (patch.subtitle !== undefined) set('subtitle', patch.subtitle);
      if (patch.color !== undefined) set('color', patch.color);
      if (assignments.length > 0) {
        assignments.push('updated_at = now()');
        await deps.query(
          `UPDATE library_topics SET ${assignments.join(', ')} WHERE id = $${values.length + 1}`,
          [...values, topicId],
        );
      }
      if (patch.position === undefined) return;
      await deps.withTransaction(async (tx) => {
        const { rows } = await tx<{ locale: Locale }>(
          `SELECT locale FROM library_topics WHERE id = $1`,
          [topicId],
        );
        const locale = rows[0]?.locale;
        if (!locale) throw new LibraryNotFoundError('library_not_found');
        const siblings = await tx<{ id: string }>(
          `SELECT id FROM library_topics WHERE locale = $1 ORDER BY position, id`,
          [locale],
        );
        const ids = siblings.rows.map((row) => row.id).filter((id) => id !== topicId);
        const clamped = Math.max(0, Math.min(patch.position, ids.length));
        ids.splice(clamped, 0, topicId);
        for (const [index, id] of ids.entries()) {
          await tx(
            `UPDATE library_topics SET position = $2 WHERE id = $1 AND position IS DISTINCT FROM $2`,
            [id, index],
          );
        }
      });
    },

    async setTopicArchived(topicId: string, archived: boolean): Promise<void> {
      await deps.query(
        `UPDATE library_topics SET archived_at = $2, updated_at = now() WHERE id = $1`,
        [topicId, archived ? new Date().toISOString() : null],
      );
    },

    async exportTopicDocument(topicId: string): Promise<ImportDocument | null> {
      const detail = await this.getTopicDetail({ topicId });
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
```

**Why topics reorder inline instead of through the shared `reorder` helper:** a topic's sibling scope is a `locale`, not a parent id, so its query and its `scopeColumn` differ from sections and questions. Sections and questions call the helper because their scope is a single parent column.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/libraryAuthoring.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/library/libraryAuthoring.ts server/src/modules/library/libraryAuthoring.test.ts
git commit -m "feat(server): repository soạn thảo — topic"
```

---

### Task 3: Authoring repository — sections, questions and reference guards

**Files:**

- Modify: `server/src/modules/library/libraryAuthoring.ts`
- Modify: `server/src/modules/library/libraryAuthoring.test.ts`

**Interfaces:**

- Consumes: everything from Task 2.
- Produces these additional methods on the same object:

```ts
listDailyReferencesForTopic(topicId: string): Promise<string[]>
listDailyReferencesForSection(sectionId: string): Promise<string[]>
listDailyReferencesForQuestion(questionId: string): Promise<string[]>
createSection(input: { topicId: string; name: string }): Promise<{ id: string }>
updateSection(sectionId: string, patch: { name?: string; position?: number }): Promise<void>
deleteSection(sectionId: string): Promise<void>
createQuestion(input: { sectionId: string; code: string | null; prompt: string; level: Level | null; blocks: Block[] }): Promise<{ id: string }>
updateQuestion(questionId: string, patch: { code?: string | null; prompt?: string; level?: Level | null; blocks?: Block[]; position?: number }): Promise<void>
deleteQuestion(questionId: string): Promise<void>
deleteSectionsForTopic(topicId: string): Promise<void>
```

**Reference guards:** before deleting a section or question, ask the Daily pool whether it still points there. The `ON DELETE RESTRICT` foreign key is the final guard; these queries exist so the API can answer 409 with the offending `entry_id` values instead of a raw SQL error.

```sql
-- topic scope
SELECT d.entry_id FROM library_daily_entries d
  JOIN library_questions q ON q.id = d.question_id
  JOIN library_sections s ON s.id = q.section_id
 WHERE s.topic_id = $1 ORDER BY d.entry_id
-- section scope
SELECT d.entry_id FROM library_daily_entries d
  JOIN library_questions q ON q.id = d.question_id
 WHERE q.section_id = $1 ORDER BY d.entry_id
-- question scope
SELECT entry_id FROM library_daily_entries WHERE question_id = $1 ORDER BY entry_id
```

- [ ] **Step 1: Write the failing test**

Append to `server/src/modules/library/libraryAuthoring.test.ts`:

```ts
describe('authoring repository — sections and questions', () => {
  it('appends a section at the end of its topic', async () => {
    const { authoring, calls } = harness();

    await authoring.createSection({ topicId: 't-1', name: 'Phần II' });

    const insert = calls.find((call) => call.text.includes('INSERT INTO library_sections'));
    expect(insert?.text).toContain('COALESCE((SELECT MAX(position) + 1');
    expect(insert?.values).toEqual(['t-1', 'Phần II']);
  });

  it('appends a question at the end of its section and keeps level null when omitted', async () => {
    const { authoring, calls } = harness();

    await authoring.createQuestion({
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
  });

  function reorderHarness() {
    const calls: Array<{ text: string; values: unknown[] }> = [];
    const query = vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      if (text.includes('SELECT section_id FROM library_questions')) {
        return { rows: [{ section_id: 's-1' }] };
      }
      if (text.startsWith('SELECT id FROM library_questions')) {
        return { rows: [{ id: 'q-2' }, { id: 'q-3' }, { id: 'q-1' }] };
      }
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

  it('renumbers every sibling position when a question moves to the front', async () => {
    const { authoring, calls, withTransaction } = reorderHarness();

    await authoring.updateQuestion('q-1', { position: 0 });

    // stored order was q-2, q-3, q-1; moving q-1 to index 0 rewrites all three
    expect(withTransaction).toHaveBeenCalledTimes(1);
    const writes = calls.filter((call) => call.text.includes('SET position'));
    expect(writes.map((call) => call.values)).toEqual([
      ['q-1', 0],
      ['q-2', 1],
      ['q-3', 2],
    ]);
  });

  it('clamps a position past the end instead of leaving a gap', async () => {
    const { authoring, calls } = reorderHarness();

    await authoring.updateQuestion('q-1', { position: 99 });

    const writes = calls.filter((call) => call.text.includes('SET position'));
    expect(writes.map((call) => call.values)).toEqual([
      ['q-2', 0],
      ['q-3', 1],
      ['q-1', 2],
    ]);
  });

  it('asks the Daily pool whether a question is still referenced', async () => {
    const { authoring, calls } = harness();

    expect(await authoring.listDailyReferencesForQuestion('q-1')).toEqual([]);
    expect(calls.at(-1)?.text).toContain('question_id = $1');
    expect(calls.at(-1)?.values).toEqual(['q-1']);
  });

  it('deletes a section with one statement', async () => {
    const { authoring, calls } = harness();

    await authoring.deleteSection('s-1');

    expect(calls.at(-1)?.text).toContain('DELETE FROM library_sections WHERE id = $1');
    expect(calls.at(-1)?.values).toEqual(['s-1']);
  });

  it('deletes every section of a topic in one statement', async () => {
    const { authoring, calls } = harness();

    await authoring.deleteSectionsForTopic('t-1');

    expect(calls.at(-1)?.text).toContain('DELETE FROM library_sections WHERE topic_id = $1');
  });
});
```

The two reorder tests pin the exact renumber sequence: the helper reads the stored order, moves one id, and writes `position = index` for every id, so the list can never drift out of sync with `position`.

- [ ] **Step 2: Run the test to verify it fails** — Historical RED evidence unavailable; current regression test verified.

Run: `npm --prefix server test -- src/modules/library/libraryAuthoring.test.ts`
Expected: FAIL — the new methods are not exported.

- [ ] **Step 3: Write the implementation**

Add to the returned object in `libraryAuthoring.ts`:

```ts
    async listDailyReferencesForTopic(topicId: string): Promise<string[]> {
      const { rows } = await deps.query<{ entry_id: string }>(
        `SELECT d.entry_id FROM library_daily_entries d
           JOIN library_questions q ON q.id = d.question_id
           JOIN library_sections s ON s.id = q.section_id
          WHERE s.topic_id = $1
          ORDER BY d.entry_id`,
        [topicId],
      );
      return rows.map((row) => row.entry_id);
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

    async createSection(input: { topicId: string; name: string }): Promise<{ id: string }> {
      const { rows } = await deps.query<{ id: string }>(
        `INSERT INTO library_sections (topic_id, position, name)
         VALUES ($1, COALESCE((SELECT MAX(position) + 1 FROM library_sections WHERE topic_id = $1), 0), $2)
         RETURNING id`,
        [input.topicId, input.name],
      );
      return { id: rows[0]!.id };
    },

    async updateSection(
      sectionId: string,
      patch: { name?: string; position?: number },
    ): Promise<void> {
      if (patch.name !== undefined) {
        await deps.query(`UPDATE library_sections SET name = $2 WHERE id = $1`, [
          sectionId,
          patch.name,
        ]);
      }
      if (patch.position === undefined) return;
      await deps.withTransaction(async (tx) => {
        const { rows } = await tx<{ topic_id: string }>(
          `SELECT topic_id FROM library_sections WHERE id = $1`,
          [sectionId],
        );
        const topicId = rows[0]?.topic_id;
        if (!topicId) throw new LibraryNotFoundError('library_not_found');
        await reorder(tx, 'library_sections', 'topic_id', topicId, sectionId, patch.position!);
      });
    },

    async deleteSection(sectionId: string): Promise<void> {
      await deps.query(`DELETE FROM library_sections WHERE id = $1`, [sectionId]);
    },

    async createQuestion(input: {
      sectionId: string;
      code: string | null;
      prompt: string;
      level: Level | null;
      blocks: Block[];
    }): Promise<{ id: string }> {
      const { rows } = await deps.query<{ id: string }>(
        `INSERT INTO library_questions (section_id, position, code, prompt, level, blocks)
         VALUES ($1, COALESCE((SELECT MAX(position) + 1 FROM library_questions WHERE section_id = $1), 0), $2, $3, $4, $5::jsonb)
         RETURNING id`,
        [input.sectionId, input.code, input.prompt, input.level, JSON.stringify(input.blocks)],
      );
      return { id: rows[0]!.id };
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
      const assignments: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };
      if (patch.code !== undefined) set('code', patch.code);
      if (patch.prompt !== undefined) set('prompt', patch.prompt);
      if (patch.level !== undefined) set('level', patch.level);
      if (patch.blocks !== undefined) set('blocks', JSON.stringify(patch.blocks) + '::jsonb');
      if (assignments.length > 0) {
        await deps.query(
          `UPDATE library_questions SET ${assignments.join(', ')} WHERE id = $${values.length + 1}`,
          [...values, questionId],
        );
      }
      if (patch.position === undefined) return;
      await deps.withTransaction(async (tx) => {
        const { rows } = await tx<{ section_id: string }>(
          `SELECT section_id FROM library_questions WHERE id = $1`,
          [questionId],
        );
        const sectionId = rows[0]?.section_id;
        if (!sectionId) throw new LibraryNotFoundError('library_not_found');
        await reorder(tx, 'library_questions', 'section_id', sectionId, questionId, patch.position!);
      });
    },

    async deleteQuestion(questionId: string): Promise<void> {
      await deps.query(`DELETE FROM library_questions WHERE id = $1`, [questionId]);
    },

    async deleteSectionsForTopic(topicId: string): Promise<void> {
      await deps.query(`DELETE FROM library_sections WHERE topic_id = $1`, [topicId]);
    },
```

**Careful with `blocks` in the dynamic UPDATE:** `set('blocks', JSON.stringify(patch.blocks) + '::jsonb')` produces `blocks = $n::jsonb`, which is correct. Do not JSON-stringify in the driver — pass the string with the explicit cast, like the INSERT above.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/libraryAuthoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/library/libraryAuthoring.ts server/src/modules/library/libraryAuthoring.test.ts
git commit -m "feat(server): repository soạn thảo — section, question và guard tham chiếu"
```

---

### Task 4: Authoring repository — import and the Daily pool

**Files:**

- Modify: `server/src/modules/library/libraryAuthoring.ts`
- Modify: `server/src/modules/library/libraryAuthoring.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 2-3, plus `ImportDocument` from `libraryValidation.ts`.
- Produces:

```ts
importTopic(input: {
  topicId: string;
  document: ImportDocument;
  mode: 'replace' | 'append';
}): Promise<{ sections: number; questions: number }>
listDailyEntries(input: { locale: Locale }): Promise<AdminDailyEntry[]>
createDailyEntry(input: { entryId; locale; type: 'mcq' | 'fib'; difficulty; questionId?: string | null; topicKey?: string | null; prompt?: string | null; blanks?: string[] | null; hint?: string | null }): Promise<{ id: string }>
updateDailyEntry(entryId: string, patch: { difficulty?; questionId?; prompt?; blanks?; hint?; position? }): Promise<void>
deleteDailyEntry(entryId: string): Promise<void>
```

**`importTopic` runs in one transaction:** it updates the topic metadata from the document (never `key` or `locale`), optionally deletes every existing section, then inserts the document's sections and questions with appended positions. `replace` refuses to run when Daily references exist anywhere in the topic.

- [ ] **Step 1: Write the failing test**

Append to `server/src/modules/library/libraryAuthoring.test.ts`:

```ts
describe('authoring repository — import', () => {
  const document = {
    title: 'T',
    subtitle: null,
    label: 'L',
    color: '#000000',
    sections: [
      {
        name: 'S1',
        questions: [{ code: 'Q1', prompt: 'one', level: 'basic' as const, blocks: [] }],
      },
    ],
  };

  it('updates metadata, appends sections and reports counts', async () => {
    const { authoring, calls, withTransaction } = harness();

    const summary = await authoring.importTopic({ topicId: 't-1', document, mode: 'append' });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.text.includes('UPDATE library_topics SET title'))).toBe(true);
    expect(calls.some((call) => call.text.includes('INSERT INTO library_sections'))).toBe(true);
    expect(summary).toEqual({ sections: 1, questions: 1 });
  });

  it('clears existing sections first when replacing', async () => {
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

  it('refuses to replace when the Daily pool still points into the topic', async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes('JOIN library_sections s ON s.id = q.section_id')) {
        return { rows: [{ entry_id: 'd-mcq-001' }] };
      }
      return { rows: [] };
    });
    const authoring = createLibraryAuthoring({
      query: query as unknown as LibraryQuery,
      withTransaction: (async (fn) => fn(query as unknown as LibraryQuery)) as never,
    });

    await expect(
      authoring.importTopic({ topicId: 't-1', document, mode: 'replace' }),
    ).rejects.toMatchObject({ code: 'library_in_use', entryIds: ['d-mcq-001'] });
  });
});

describe('authoring repository — daily pool', () => {
  it('appends a daily entry and keeps blanks as json', async () => {
    const { authoring, calls } = harness();

    await authoring.createDailyEntry({
      entryId: 'd-fib-100',
      locale: 'vi',
      type: 'fib',
      difficulty: 2,
      prompt: 'A ___ resolves later.',
      blanks: ['promise'],
    });

    const insert = calls.find((call) => call.text.includes('INSERT INTO library_daily_entries'));
    expect(insert?.text).toContain('$8::jsonb');
    expect(insert?.values).toContain(JSON.stringify(['promise']));
  });

  it('updates only the provided fields', async () => {
    const { authoring, calls } = harness();

    await authoring.updateDailyEntry('d-1', { difficulty: 3 });

    const update = calls.find((call) => call.text.includes('UPDATE library_daily_entries'));
    expect(update?.text).toContain('difficulty = $1');
    expect(update?.values).toEqual([3, 'd-1']);
  });

  it('deletes a daily entry', async () => {
    const { authoring, calls } = harness();

    await authoring.deleteDailyEntry('d-1');

    expect(calls.at(-1)?.text).toContain('DELETE FROM library_daily_entries WHERE id = $1');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails** — Historical RED evidence unavailable; current regression test verified.

Run: `npm --prefix server test -- src/modules/library/libraryAuthoring.test.ts`
Expected: FAIL — `importTopic` and the Daily methods are not exported.

- [ ] **Step 3: Write the implementation**

```ts
    async importTopic(input: {
      topicId: string;
      document: ImportDocument;
      mode: 'replace' | 'append';
    }): Promise<{ sections: number; questions: number }> {
      return deps.withTransaction(async (tx) => {
        if (input.mode === 'replace') {
          const entryIds = await listDailyReferencesForTopicWith(tx, input.topicId);
          if (entryIds.length > 0) throw new LibraryConflictError('library_in_use', entryIds);
        }
        const updated = await tx(
          `UPDATE library_topics
              SET title = $2, subtitle = $3, label = $4, color = $5, updated_at = now()
            WHERE id = $1
            RETURNING id`,
          [
            input.topicId,
            input.document.title,
            input.document.subtitle,
            input.document.label,
            input.document.color,
          ],
        );
        if (updated.rows.length === 0) throw new LibraryNotFoundError('library_not_found');
        if (input.mode === 'replace') {
          await tx(`DELETE FROM library_sections WHERE topic_id = $1`, [input.topicId]);
        }

        let sections = 0;
        let questions = 0;
        for (const section of input.document.sections) {
          const sectionRow = await tx<{ id: string }>(
            `INSERT INTO library_sections (topic_id, position, name)
             VALUES ($1, COALESCE((SELECT MAX(position) + 1 FROM library_sections WHERE topic_id = $1), 0), $2)
             RETURNING id`,
            [input.topicId, section.name],
          );
          sections += 1;
          for (const question of section.questions) {
            await tx(
              `INSERT INTO library_questions (section_id, position, code, prompt, level, blocks)
               VALUES ($1, COALESCE((SELECT MAX(position) + 1 FROM library_questions WHERE section_id = $1), 0), $2, $3, $4, $5::jsonb)`,
              [
                sectionRow.rows[0]!.id,
                question.code,
                question.prompt,
                question.level,
                JSON.stringify(question.blocks),
              ],
            );
            questions += 1;
          }
        }
        return { sections, questions };
      });
    },

    async listDailyEntries(input: { locale: Locale }): Promise<AdminDailyEntry[]> {
      const { rows } = await deps.query<{
        id: string;
        entry_id: string;
        locale: Locale;
        type: 'mcq' | 'fib';
        difficulty: number;
        question_id: string | null;
        topic_key: string | null;
        prompt: string | null;
        blanks: string[] | null;
        hint: string | null;
        position: number;
      }>(
        `SELECT id, entry_id, locale, type, difficulty, question_id, topic_key, prompt, blanks, hint, position
           FROM library_daily_entries WHERE locale = $1 ORDER BY position, entry_id`,
        [input.locale],
      );
      return rows.map((row) => ({ ...row, difficulty: Number(row.difficulty), position: Number(row.position) }));
    },

    async createDailyEntry(input: {
      entryId: string;
      locale: Locale;
      type: 'mcq' | 'fib';
      difficulty: number;
      questionId?: string | null;
      topicKey?: string | null;
      prompt?: string | null;
      blanks?: string[] | null;
      hint?: string | null;
    }): Promise<{ id: string }> {
      const { rows } = await deps.query<{ id: string }>(
        `INSERT INTO library_daily_entries
           (entry_id, locale, type, difficulty, question_id, topic_key, prompt, blanks, hint, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9,
                 COALESCE((SELECT MAX(position) + 1 FROM library_daily_entries WHERE locale = $2), 0))
         RETURNING id`,
        [
          input.entryId,
          input.locale,
          input.type,
          input.difficulty,
          input.questionId ?? null,
          input.topicKey ?? null,
          input.prompt ?? null,
          input.blanks ? JSON.stringify(input.blanks) : null,
          input.hint ?? null,
        ],
      );
      return { id: rows[0]!.id };
    },

    async updateDailyEntry(
      entryId: string,
      patch: {
        difficulty?: number;
        questionId?: string | null;
        prompt?: string | null;
        blanks?: string[] | null;
        hint?: string | null;
        position?: number;
      },
    ): Promise<void> {
      const assignments: string[] = [];
      const values: unknown[] = [];
      const set = (column: string, value: unknown): void => {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      };
      if (patch.difficulty !== undefined) set('difficulty', patch.difficulty);
      if (patch.questionId !== undefined) set('question_id', patch.questionId);
      if (patch.prompt !== undefined) set('prompt', patch.prompt);
      if (patch.blanks !== undefined) set('blanks', patch.blanks ? JSON.stringify(patch.blanks) + '::jsonb' : null);
      if (patch.hint !== undefined) set('hint', patch.hint);
      if (patch.position !== undefined) set('position', patch.position);
      if (assignments.length === 0) return;
      await deps.query(
        `UPDATE library_daily_entries SET ${assignments.join(', ')} WHERE id = $${values.length + 1}`,
        [...values, entryId],
      );
    },

    async deleteDailyEntry(entryId: string): Promise<void> {
      await deps.query(`DELETE FROM library_daily_entries WHERE id = $1`, [entryId]);
    },
```

Add the private helper next to `reorder`:

```ts
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
```

Then make the public method from Task 3 delegate to it, so the guard the import uses and the endpoint the UI calls can never drift apart:

```ts
    async listDailyReferencesForTopic(topicId: string): Promise<string[]> {
      return listDailyReferencesForTopicWith(deps.query, topicId);
    },
```

Replace Task 3's body for that method with exactly the three lines above. The other two reference queries stay as written.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/modules/library/libraryAuthoring.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/modules/library/libraryAuthoring.ts server/src/modules/library/libraryAuthoring.test.ts
git commit -m "feat(server): repository soạn thảo — import và Daily pool"
```

---

### Task 5: The admin router

**Files:**

- Create: `server/src/routes/libraryAdmin.ts`
- Test: `server/src/routes/libraryAdmin.test.ts`

**Interfaces:**

- Consumes: `LibraryAuthoring` and the error classes from Tasks 2-4; the schemas and `formatValidationIssue` from Task 1.
- Produces: `createLibraryAdminRouter({ authoring, requireAuth, requireAdmin }): Router`.

**Every handler is thin:** validate → guard → call the repository → respond. The guards are injected so tests can drive them, exactly like `createDailyRouter` does.

- [ ] **Step 1: Write the failing test**

`server/src/routes/libraryAdmin.test.ts`:

```ts
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryConflictError, LibraryNotFoundError } from '../modules/library/libraryAuthoring';
import { createLibraryAdminRouter } from './libraryAdmin';

type TestUser = { userId: string; email: string; role: 'user' | 'admin' };

const allow: RequestHandler = (_req, _res, next) => next();

function appWith(authoring: Record<string, unknown>, role: TestUser['role'] = 'admin') {
  const instance = express();
  instance.use(express.json());
  const requireAuth: RequestHandler = (req, _res, next) => {
    req.user = { userId: 'admin-1', email: 'a@b.c', role };
    next();
  };
  const requireAdmin: RequestHandler = (req, res, next) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required', code: 'admin_required' });
      return;
    }
    next();
  };
  instance.use(
    '/admin',
    createLibraryAdminRouter({
      authoring: authoring as never,
      requireAuth,
      requireAdmin,
    }),
  );
  return instance;
}

describe('library admin routes', () => {
  it('rejects a non-admin before touching the repository', async () => {
    const createTopic = vi.fn();

    await request(appWith({ createTopic }, 'user')).post('/admin/topics').send({}).expect(403);

    expect(createTopic).not.toHaveBeenCalled();
  });

  it('creates a topic and refuses a duplicate key', async () => {
    const createTopic = vi
      .fn()
      .mockResolvedValueOnce({ id: 't-1' })
      .mockRejectedValueOnce(new LibraryConflictError('library_key_in_use'));

    const body = {
      key: 'system-design',
      locale: 'vi',
      label: 'System Design',
      title: 'System Design',
      color: '#123456',
    };

    const created = await request(appWith({ createTopic }))
      .post('/admin/topics')
      .send(body)
      .expect(201);
    expect(created.body).toEqual({ id: 't-1' });

    const conflict = await request(appWith({ createTopic }))
      .post('/admin/topics')
      .send(body)
      .expect(409);
    expect(conflict.body.code).toBe('library_key_in_use');
  });

  it('reports a validation failure with its path', async () => {
    const createTopic = vi.fn();

    const res = await request(appWith({ createTopic }))
      .post('/admin/topics')
      .send({ key: 'Bad_Key', locale: 'vi', label: 'L', title: 'T', color: 'red' })
      .expect(400);

    expect(res.body.code).toBe('library_invalid_document');
    expect(res.body.path).toBe('key');
    expect(createTopic).not.toHaveBeenCalled();
  });

  it('never lets a key change through patch', async () => {
    const updateTopic = vi.fn();

    const res = await request(appWith({ updateTopic }))
      .patch('/admin/topics/t-1')
      .send({ key: 'renamed' })
      .expect(400);

    expect(res.body.code).toBe('library_invalid_document');
    expect(updateTopic).not.toHaveBeenCalled();
  });

  it('returns the pre-delete snapshot so a delete is undoable', async () => {
    const snapshot = { title: 'T', subtitle: null, label: 'L', color: '#000000', sections: [] };
    const exportTopicDocument = vi.fn().mockResolvedValue(snapshot);
    const deleteQuestion = vi.fn().mockResolvedValue(undefined);
    const findTopicIdForQuestion = vi.fn().mockResolvedValue('t-1');

    const res = await request(
      appWith({
        exportTopicDocument,
        deleteQuestion,
        findTopicIdForQuestion,
        listDailyReferencesForQuestion: vi.fn().mockResolvedValue([]),
      }),
    )
      .delete('/admin/questions/q-1')
      .expect(200);

    expect(deleteQuestion).toHaveBeenCalledWith('q-1');
    expect(res.body).toEqual({ snapshot });
  });

  it('refuses to delete a question the Daily pool uses, before deleting anything', async () => {
    const deleteQuestion = vi.fn();
    const listDailyReferencesForQuestion = vi.fn().mockResolvedValue(['d-mcq-001']);

    const res = await request(appWith({ deleteQuestion, listDailyReferencesForQuestion }))
      .delete('/admin/questions/q-1')
      .expect(409);

    expect(res.body).toMatchObject({ code: 'library_in_use', entryIds: ['d-mcq-001'] });
    expect(deleteQuestion).not.toHaveBeenCalled();
  });

  it('404s an unknown topic', async () => {
    const getTopicDetail = vi.fn().mockResolvedValue(null);

    const res = await request(appWith({ getTopicDetail })).get('/admin/topics/missing').expect(404);

    expect(res.body.code).toBe('library_not_found');
  });

  it('imports a document and reports the counts', async () => {
    const importTopic = vi.fn().mockResolvedValue({ sections: 2, questions: 9 });

    const res = await request(appWith({ importTopic }))
      .post('/admin/topics/t-1/import')
      .send({
        mode: 'append',
        document: {
          title: 'T',
          label: 'L',
          color: '#000000',
          sections: [{ name: 'S', questions: [{ q: 'q', blocks: [] }] }],
        },
      })
      .expect(200);

    expect(importTopic).toHaveBeenCalledWith({
      topicId: 't-1',
      mode: 'append',
      document: {
        title: 'T',
        subtitle: null,
        label: 'L',
        color: '#000000',
        sections: [
          { name: 'S', questions: [{ code: null, prompt: 'q', level: null, blocks: [] }] },
        ],
      },
    });
    expect(res.body).toEqual({ sections: 2, questions: 9 });
  });

  it('creates a fib daily entry and rejects an mcq without a question', async () => {
    const createDailyEntry = vi.fn().mockResolvedValue({ id: 'd-1' });

    await request(appWith({ createDailyEntry }))
      .post('/admin/daily-entries')
      .send({
        entryId: 'd-fib-9',
        locale: 'vi',
        type: 'fib',
        difficulty: 1,
        prompt: 'A ___ resolves.',
        blanks: ['promise'],
      })
      .expect(201);

    const res = await request(appWith({ createDailyEntry }))
      .post('/admin/daily-entries')
      .send({ entryId: 'd-x', locale: 'vi', type: 'mcq', difficulty: 1 })
      .expect(400);

    expect(res.body.code).toBe('library_invalid_document');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails** — Historical RED evidence unavailable; current regression test verified.

Run: `npm --prefix server test -- src/routes/libraryAdmin.test.ts`
Expected: FAIL — cannot resolve `./libraryAdmin`.

- [ ] **Step 3: Write the implementation**

`server/src/routes/libraryAdmin.ts`:

```ts
import { Router, type NextFunction, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import {
  LibraryConflictError,
  LibraryNotFoundError,
  type LibraryAuthoring,
} from '../modules/library/libraryAuthoring';
import type { Locale } from '../modules/library/libraryRepository';
import {
  dailyEntryCreateSchema,
  dailyEntryPatchSchema,
  formatValidationIssue,
  importRequestSchema,
  normalizeImportDocument,
  questionCreateSchema,
  questionPatchSchema,
  sectionCreateSchema,
  sectionPatchSchema,
  topicCreateSchema,
  topicPatchSchema,
} from '../modules/library/libraryValidation';

interface LibraryAdminDeps {
  authoring: LibraryAuthoring;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

function resolveLocale(value: unknown): Locale | null {
  if (value === undefined || value === 'vi') return 'vi';
  if (value === 'en') return 'en';
  return null;
}

function sendInvalid(res: Response, error: z.ZodError): void {
  const issue = formatValidationIssue(error);
  res.status(400).json({
    error: 'Invalid document',
    code: 'library_invalid_document',
    path: issue.path,
    message: issue.message,
  });
}

function sendError(res: Response, error: unknown, next: NextFunction): void {
  if (error instanceof LibraryNotFoundError) {
    res.status(404).json({ error: 'Not found', code: error.code });
    return;
  }
  if (error instanceof LibraryConflictError) {
    res.status(409).json({
      error: error.code === 'library_archived' ? 'Topic is archived' : 'Resource is in use',
      code: error.code,
      ...(error.entryIds.length > 0 ? { entryIds: error.entryIds } : {}),
    });
    return;
  }
  next(error);
}

export function createLibraryAdminRouter(deps: LibraryAdminDeps): Router {
  const router = Router();

  router.use(deps.requireAuth, deps.requireAdmin);

  async function ensureEditable(topicId: string): Promise<void> {
    const status = await deps.authoring.findTopicStatus(topicId);
    if (!status) throw new LibraryNotFoundError('library_not_found');
    if (status.archived) throw new LibraryConflictError('library_archived');
  }

  router.get('/topics', async (req, res, next) => {
    try {
      const locale = resolveLocale(req.query.lang);
      if (!locale) {
        res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
        return;
      }
      const includeArchived = req.query.includeArchived === '1';
      res.json({ items: await deps.authoring.listTopics({ locale, includeArchived }) });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.get('/topics/:id', async (req, res, next) => {
    try {
      const detail = await deps.authoring.getTopicDetail({ topicId: req.params.id as string });
      if (!detail) {
        res.status(404).json({ error: 'Topic not found', code: 'library_not_found' });
        return;
      }
      res.json(detail);
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics', async (req, res, next) => {
    const parsed = topicCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      const created = await deps.authoring.createTopic({
        ...parsed.data,
        subtitle: parsed.data.subtitle ?? null,
      });
      res.status(201).json(created);
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.patch('/topics/:id', async (req, res, next) => {
    const parsed = topicPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      await deps.authoring.updateTopic(req.params.id as string, parsed.data);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics/:id/archive', async (req, res, next) => {
    try {
      const topicId = req.params.id as string;
      const snapshot = await deps.authoring.exportTopicDocument(topicId);
      if (!snapshot) throw new LibraryNotFoundError('library_not_found');
      await deps.authoring.setTopicArchived(topicId, true);
      res.json({ snapshot });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics/:id/restore', async (req, res, next) => {
    try {
      const topicId = req.params.id as string;
      const status = await deps.authoring.findTopicStatus(topicId);
      if (!status) throw new LibraryNotFoundError('library_not_found');
      await deps.authoring.setTopicArchived(topicId, false);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.get('/topics/:id/export', async (req, res, next) => {
    try {
      const snapshot = await deps.authoring.exportTopicDocument(req.params.id as string);
      if (!snapshot) throw new LibraryNotFoundError('library_not_found');
      res.json(snapshot);
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics/:id/import', async (req, res, next) => {
    const parsed = importRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      const topicId = req.params.id as string;
      await ensureEditable(topicId);
      const summary = await deps.authoring.importTopic({
        topicId,
        mode: parsed.data.mode,
        document: normalizeImportDocument(parsed.data.document),
      });
      res.json(summary);
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics/:id/sections', async (req, res, next) => {
    const parsed = sectionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      const topicId = req.params.id as string;
      await ensureEditable(topicId);
      res.status(201).json(await deps.authoring.createSection({ topicId, name: parsed.data.name }));
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.patch('/sections/:id', async (req, res, next) => {
    const parsed = sectionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      await deps.authoring.updateSection(req.params.id as string, parsed.data);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.delete('/sections/:id', async (req, res, next) => {
    try {
      const sectionId = req.params.id as string;
      const entryIds = await deps.authoring.listDailyReferencesForSection(sectionId);
      if (entryIds.length > 0) throw new LibraryConflictError('library_in_use', entryIds);
      const snapshot = await snapshotForSection(deps.authoring, sectionId);
      await deps.authoring.deleteSection(sectionId);
      res.json({ snapshot });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/sections/:id/questions', async (req, res, next) => {
    const parsed = questionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      const created = await deps.authoring.createQuestion({
        sectionId: req.params.id as string,
        code: parsed.data.code ?? null,
        prompt: parsed.data.prompt,
        level: parsed.data.level ?? null,
        blocks: parsed.data.blocks,
      });
      res.status(201).json(created);
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.patch('/questions/:id', async (req, res, next) => {
    const parsed = questionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      await deps.authoring.updateQuestion(req.params.id as string, parsed.data);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.delete('/questions/:id', async (req, res, next) => {
    try {
      const questionId = req.params.id as string;
      const entryIds = await deps.authoring.listDailyReferencesForQuestion(questionId);
      if (entryIds.length > 0) throw new LibraryConflictError('library_in_use', entryIds);
      const snapshot = await snapshotForQuestion(deps.authoring, questionId);
      await deps.authoring.deleteQuestion(questionId);
      res.json({ snapshot });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.get('/daily-entries', async (req, res, next) => {
    try {
      const locale = resolveLocale(req.query.locale);
      if (!locale) {
        res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
        return;
      }
      res.json({ items: await deps.authoring.listDailyEntries({ locale }) });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/daily-entries', async (req, res, next) => {
    const parsed = dailyEntryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      res.status(201).json(await deps.authoring.createDailyEntry(parsed.data));
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.patch('/daily-entries/:id', async (req, res, next) => {
    const parsed = dailyEntryPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      await deps.authoring.updateDailyEntry(req.params.id as string, parsed.data);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.delete('/daily-entries/:id', async (req, res, next) => {
    try {
      await deps.authoring.deleteDailyEntry(req.params.id as string);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  return router;
}
```

**The two snapshot helpers** need to know which topic a section or question belongs to before it is deleted. Add them at module level:

```ts
async function snapshotForQuestion(
  authoring: LibraryAuthoring,
  questionId: string,
): Promise<ImportDocument | null> {
  const topicId = await authoring.findTopicIdForQuestion(questionId);
  return topicId ? authoring.exportTopicDocument(topicId) : null;
}

async function snapshotForSection(
  authoring: LibraryAuthoring,
  sectionId: string,
): Promise<ImportDocument | null> {
  const topicId = await authoring.findTopicIdForSection(sectionId);
  return topicId ? authoring.exportTopicDocument(topicId) : null;
}
```

So Task 3 also needs two more small lookups, added here:

```ts
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
```

and import `type ImportDocument` in the router.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --prefix server test -- src/routes/libraryAdmin.test.ts`
Expected: PASS, 9 tests. Add the missing `findTopicIdForSection` / `findTopicIdForQuestion` mocks to the delete tests where the fake authoring object needs them.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/libraryAdmin.ts server/src/routes/libraryAdmin.test.ts server/src/modules/library/libraryAuthoring.ts
git commit -m "feat(server): router admin cho soạn nội dung Library"
```

---

### Task 6: Wiring, live smoke test and documentation

**Files:**

- Modify: `server/src/index.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `createLibraryAuthoring` from Tasks 2-4 and `createLibraryAdminRouter` from Task 5.
- Produces: a running server where `/api/v1/library/admin/*` works behind the admin session.

- [ ] **Step 1: Add the transaction helper to the composition root**

In `server/src/index.ts`:

```ts
import { createLibraryAuthoring, type LibraryAuthoring } from './modules/library/libraryAuthoring';
import { createLibraryAdminRouter } from './routes/libraryAdmin';
```

```ts
const withTransaction = async <T>(fn: (tx: LibraryQuery) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client.query.bind(client) as unknown as LibraryQuery);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
```

```ts
const libraryAuthoring: LibraryAuthoring = createLibraryAuthoring({
  query: pool.query.bind(pool) as unknown as LibraryQuery,
  withTransaction,
});
const libraryAdminRoutes = createLibraryAdminRouter({
  authoring: libraryAuthoring,
  requireAuth,
  requireAdmin,
});
```

Add `libraryAdminRoutes: ReturnType<typeof createLibraryAdminRouter>;` to the `registerRoutes` parameter type, pass it in the `createApp` call, and mount it **before** the reader router so the more specific prefix wins:

```ts
app.use('/api/v1/library/admin', identity.libraryAdminRoutes);
app.use('/api/v1/library', identity.libraryRoutes);
```

- [ ] **Step 2: Typecheck and run every test**

Run: `npm --prefix server run typecheck && npm --prefix server test && npm run check`
Expected: all green.

- [ ] **Step 3: Live smoke test against the real database**

With `npm run dev` running, use an admin session (the browser page already has one) to walk the whole surface. Verify, in order:

1. `GET /api/v1/library/admin/topics?lang=vi` → 9 items with `questionCount`.
2. `POST /api/v1/library/admin/topics` with a throwaway key → 201 `{ id }`; repeat → 409 `library_key_in_use`.
3. `POST /api/v1/library/admin/topics/:id/import` with `mode: 'replace'` and a two-section document → 200 `{ sections: 2, questions: n }`.
4. `GET /api/v1/library/admin/topics/:id/export` → the same document, with `level` and `code` present.
5. `PATCH /api/v1/library/admin/questions/:questionId` with `{ position: 0 }` → 204, then `GET` the topic and confirm the question moved and every position is gap-free.
6. `DELETE /api/v1/library/admin/questions/:questionId` on a question the Daily pool uses → 409 `library_in_use` with `entryIds`.
7. `POST /api/v1/library/admin/topics/:id/archive` → 200 with a snapshot; confirm the topic disappears from `GET /api/v1/library/index?lang=vi` and from `GET /admin/topics?lang=vi`; `POST .../restore` → 204 and it comes back.
8. `DELETE /api/v1/library/admin/topics/:id` is not an endpoint — confirm 404, because topics are archived, never deleted.
9. `POST /api/v1/library/admin/daily-entries` for a new fib entry → 201; `GET /daily-entries?locale=vi` shows it; `DELETE` it → 204 and the count returns to 35.
10. Clean up: delete the throwaway topic's sections and questions, or archive it; confirm `content/*.json` is untouched (`git status` clean for `content/`).

- [ ] **Step 4: Document the endpoints**

Add a short "Authoring endpoints" subsection under the existing Admin panel section in `README.md`: the `/api/v1/library/admin/*` prefix, that everything is admin-only, that `key` is immutable, that topics archive instead of delete, that deletes return an undoable snapshot, and that questions used by the Daily pool are protected by a 409.

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts README.md
git commit -m "feat(server): mount router admin Library và ghi docs"
```

---

## Verification

Phase 2 is done when all of the following hold:

- [ ] `npm run check` is green.
- [ ] Every endpoint in the contract table answers with the documented status, including the 400 path report, the 403 for a non-admin, the 404 for a missing id, the 409 `library_key_in_use`, the 409 `library_in_use` with `entryIds`, and the 409 `library_archived`.
- [ ] `key` cannot change through any endpoint.
- [ ] Reordering leaves `position` gap-free across the whole sibling list, and only changed rows are written.
- [ ] `import` with `mode: 'replace'` on a Daily-referenced topic is refused; with `mode: 'append'` it appends.
- [ ] Export → import round-trips a topic without loss, including `level` and `code`.
- [ ] Delete and archive responses carry a snapshot that imports back cleanly.
- [ ] The read API and the Daily API still answer exactly as in phase 1.
- [ ] `content/*.json` is unmodified.

## Post-implementation corrections

Executing this plan surfaced defects in the plan itself. They are fixed in the
code and recorded here so nobody re-introduces them.

1. **`atLeastOneField` must call `.partial()`** before `.strict()`. Without it
   every patch field is required, so `PATCH { level: 'basic' }` and
   `PATCH { title: 'New' }` are rejected with 400.
2. **`formatValidationIssue` must coerce path segments with `String()`**,
   because Zod path segments can be symbols and a template literal over a symbol
   is a TypeScript error.
3. **Export must emit the import wire format.** Exporting the internal
   `ImportDocument` produced `prompt`, `code: null` and `subtitle: null`, none of
   which `importRequestSchema` accepted — so a snapshot could not be re-imported
   and the round-trip guarantee was false. There are now two types:
   `ImportDocument` (internal, `prompt`) and `ImportDocumentJson` (wire, `q`),
   with `toDocumentJson` bridging them; `code` and `subtitle` are
   `.nullable().optional()` in the schema.
4. **`router.param('id')` must validate a UUID.** A non-UUID id previously
   reached Postgres and answered 500 (`invalid input syntax for type uuid`)
   instead of 400.
5. **`renumber` covers topics too** (scope `locale`), instead of a second inline
   copy, so the helper is never dead code under `noUnusedLocals`.
6. **`updateTopic`, `updateSection` and `updateQuestion` run metadata and
   position changes in one transaction**, so a reorder cannot half-apply.
7. **Sections and questions are refused on an archived topic for every mutation,
   including deletes**, and existence is checked before a patch so an unknown id
   answers 404 rather than a silent 204.

## Notes for the executor

- The reader projection in `libraryRepository.ts` must not change in this phase; the editor reads a different shape on purpose.
- Any place where SQL is built dynamically must keep values parameterised. No string interpolation of user input, ever.
- If a test needs a repository method that does not exist yet, that is a missing interface — add it to the task's interface block rather than inventing a name inline.

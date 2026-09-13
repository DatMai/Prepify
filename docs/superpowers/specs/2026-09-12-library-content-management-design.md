# Library Content Management Design

**Date:** 2026-09-12
**Status:** Approved
**Complements:** `docs/superpowers/specs/2026-09-12-prepify-full-overhaul-design.md`
("PostgreSQL owns operational state; real corpus lives outside the bundle"),
`docs/ADR-002-private-library-and-obsidian-projection.md` (Library stays
server-enforced and private)

## Goal

Let the owner author and curate Library lessons from inside the admin panel:
create a new subject, write its questions with a level per question, edit the
existing subjects, and keep the Daily pool pointed at the right questions.

To make that possible the Library corpus moves from read-only JSON files into
PostgreSQL, which becomes the single source of truth for topics, sections,
questions and the Daily pool.

## Non-goals

- No automatic translation between locales; `vi` and `en` are separate records.
- No quiz or Daily filtering by level in this slice.
- No drag-and-drop reordering; explicit move up/down buttons only.
- No detailed audit trail (the overhaul plan's `audit_events` table is the home
  for that, in a later slice).
- No deletion of `content/*.json` from the repository, and no DB-to-file sync.
- No change to the position-based progress keys (see Progress keys below).

## Approved decisions

| Question               | Decision                                                                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source of truth        | PostgreSQL. The Library API reads the database, not the filesystem.                                                                                                 |
| Existing corpus        | Seed once from `content/**` into the database, then the database is the only source. Files stay in the repo as the import snapshot.                                 |
| `level`                | Enum per question: `basic` \| `intermediate` \| `advanced`, or `null` for the seeded legacy questions. Sections keep their current grouping role.                   |
| Locale                 | A topic carries one `locale` (`vi` or `en`); both locales are seeded.                                                                                               |
| Daily pool             | Also migrated to PostgreSQL in this slice.                                                                                                                          |
| Editing fidelity       | Full block editor for all four block types, plus a JSON import as a fast template path.                                                                             |
| Destructive operations | Topics are archived (`archived_at`), never hard-deleted. Sections and questions are hard-deleted after confirmation, with a JSON snapshot offered before the write. |
| Progress keys          | Unchanged, still positional. The UI warns that reordering or deleting questions makes learned progress point at different questions.                                |

## Architecture

```text
Admin UI (tab "Nội dung")
   |  validation + explicit confirmation
   v
/api/v1/library/admin/*   (requireAuth + requireAdmin)
   |  Zod at the boundary, one transaction per write
   v
library module: repository + projection + validation
   v
PostgreSQL: library_topics / library_sections / library_questions / library_daily_entries

/api/v1/library/index, /api/v1/library/topics/:key   (unchanged paths)
   |  projects the database back to the exact existing JSON shapes
   v
existing frontend Library, Quiz, Daily and progress flows (unchanged)
```

The reader endpoints keep their current paths and response shapes, so the
frontend Library, Quiz and progress code is not rewritten. Only the data source
changes.

`content/*.json` is still read once by the seed script. `content/en/` is
gitignored, so a missing English corpus only logs a warning.

## Data model

Migration `011_add_library_tables.sql` (append-only, following existing
conventions):

```sql
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

`library_daily_entries.question_id` uses `ON DELETE RESTRICT`: deleting a
question that the Daily pool uses is refused by the database. This replaces the
current positional `ref: { topicKey, sectionIdx, questionIdx }`, which would
silently point at the wrong question after any reorder or delete.

`library_questions.level` is nullable so the seeded legacy questions are
honestly marked as unclassified instead of guessed.

`blocks` keeps the existing corpus block shapes: `text`, `note`, `code`
(with `lang`), `table` (with `rows`, optional `headerDone`, optional `closed`).

## Seed

`server/src/scripts/seedLibrary.ts`, run with
`npm --prefix server run seed:library`.

- Reads `content/*.json` and `content/en/*.json`, inserts everything inside a
  single transaction.
- Idempotent: topics insert with `ON CONFLICT (key, locale) DO NOTHING`, and a
  topic that already exists is skipped whole, so a rerun never duplicates.
- `index.json` is not imported; the index is derived from the topics table.
- `daily.json` is imported into `library_daily_entries`, and each positional
  `ref` is resolved to a `library_questions.id` during the seed. An unresolved
  `ref` fails the seed loudly instead of dropping a Daily question silently.
- A missing `content/en/` logs a warning and continues.
- `content/*.json` is never modified or deleted.

## Read API (unchanged paths)

The browser first requests only the topic index. It requests a topic body on
selection and caches it for the active locale; changing locale clears that body
cache. Features that span topics must opt in explicitly: Favorites loads all
topics when its aggregate filter is activated, Review loads the distinct topics
present in the due queue, and the Quiz launcher loads the selected topic before
deriving question sets or eligibility.

`server/src/routes/library.ts` keeps `requireAuth` + `requireAdmin` and reads
from the repository instead of the filesystem:

- `GET /api/v1/library/index?lang=` → array of
  `{ key, label, title, subtitle, color, questionCount }`, ordered by
  `position`, archived topics excluded.
- `GET /api/v1/library/topics/:key?lang=` →
  `{ title, subtitle, label, color, sections: [{ name, questions: [{ id, q, blocks }] }] }`,
  with sections and questions ordered by `position`. The projection maps the
  `code` column back into the `id` field so the corpus's `"id": "Q1"` keeps
  working; a question created without a code emits `id: null`, which the
  frontend already treats as optional.
- Unknown locale still returns 400; unknown key still returns 404 with the
  message `Topic not found`, now carrying the stable code `library_not_found`.
  Stable error codes are a small addition on top of today's bodies; the success
  shapes carry the same values as before (`jsonb` does not preserve object key
  order, so comparison is by value, not by serialized bytes).

`server/src/routes/daily.ts` changes source only; its response shape is
unchanged:

- The pool is read from `library_daily_entries` for the requested locale.
- MCQ entries resolve their question through the foreign key; the distractor
  generator queries the database for sibling questions instead of reading topic
  files.
- The unused `type: 'match'` branch is removed (the corpus has no `match`
  entries and the constraint no longer allows them).
- `contentDir` leaves the Daily router dependencies; only the seed script knows
  about the corpus folder.

## Admin API

The Content UI treats its tab body as an ephemeral render host. Leaving and
re-entering the tab closes any editor bound to the detached host and reloads the
topic list. Topic-detail responses are applied only while their topic remains
active, so Back/navigation cannot resurrect a stale editor. Network-backed
loading states emit scoped `started`, `completed`, `failed`, and `settled` logs
to make stuck-loading investigations traceable.

`server/src/routes/libraryAdmin.ts`, mounted at `/api/v1/library/admin`, all
behind `requireAuth` + `requireAdmin`.

| Group         | Endpoints                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Topics        | `GET /topics?lang=&includeArchived=1`, `GET /topics/:id`, `POST /topics`, `PATCH /topics/:id`, `POST /topics/:id/archive`, `POST /topics/:id/restore` |
| Sections      | `POST /topics/:id/sections`, `PATCH /sections/:id`, `DELETE /sections/:id`                                                                            |
| Questions     | `POST /sections/:id/questions`, `PATCH /questions/:id`, `DELETE /questions/:id`                                                                       |
| Import/Export | `POST /topics/:id/import`, `GET /topics/:id/export`                                                                                                   |
| Daily pool    | `GET /daily-entries?locale=`, `POST /daily-entries`, `PATCH /daily-entries/:id`, `DELETE /daily-entries/:id`                                          |

**`key` is immutable after creation.** It appears in URLs, in the positional
progress key (`topic:section:question`) and in Daily pool references, so a
rename would silently discard users' learned progress. Only `label`, `title`,
`subtitle`, `color` and `position` are editable.

### Shape and ordering rules

- `GET /topics/:id` is the editor's read: topic metadata plus
  `sections: [{ id, position, name, questions: [{ id, position, code, prompt, level, blocks }] }]`,
  ordered by `position`.
- `GET /topics?lang=` returns `{ items: [{ id, key, label, title, subtitle, color, position, archived, questionCount }] }`
  for that locale; archived topics appear only with `includeArchived=1`.
- New topics, sections and questions append at the end: `position` is
  `max(position) + 1` within its parent. `PATCH` accepts an explicit `position`
  and the server renumbers the affected siblings inside the same transaction, so
  order stays gap-free.
- Archiving hides a topic from the Library index only. Daily entries that
  reference its questions keep working, because every Daily entry is an explicit
  reference and the pool is managed separately.
- `POST /topics/:id/import` also updates the topic's `label`, `title`,
  `subtitle` and `color` from the document, but never `key` or `locale`.
  `append` adds the document's sections after the existing ones without
  deduplicating names; `replace` removes all existing sections first.

### Validation

`server/src/modules/library/libraryValidation.ts`, Zod at the boundary:

- Block discriminated union over the four types, with size ceilings: block text
  and code at most 20,000 characters, tables at most 50 rows by 10 columns, at
  most 100 blocks per question.
- `key` matches `/^[a-z0-9-]+$/` (the same rule as the existing
  `topicKeyPattern`) and is 2–40 characters.
- `locale` is `vi` or `en`; `color` matches `/^#[0-9a-fA-F]{6}$/`; `level` is
  `basic`, `intermediate`, `advanced` or omitted.
- Import validates the whole document before writing anything and reports the
  failing path, for example `sections[2].questions[5].blocks[1].type`.
- Every write runs in a single transaction and updates `updated_at`.

### Safety

- Deleting a section or question that the Daily pool references returns
  **409 `library_in_use`** with the offending `entry_id` values; the
  `ON DELETE RESTRICT` foreign key is the final guard.
- `POST /topics/:id/import` takes `mode: 'replace' | 'append'`. `replace`
  refuses to run when Daily references would be destroyed, then deletes and
  rewrites inside one transaction.
- Every delete and archive response includes a `snapshot` of the affected topic;
  `GET /topics/:id/export` produces the same snapshot at any time.
- Question text is never logged. Logs carry `id`, `key` and the action only.
- Deliberately no idempotency key in this slice: one admin, and the UI disables
  the submit control while a request is in flight.
- Error codes: `library_not_found`, `library_key_in_use`,
  `library_invalid_document`, `library_in_use`, `library_archived`.

## Admin UI

The existing admin panel grows a third tab: `Tổng quan | Người dùng | Nội dung`.

- `src/admin/adminView.ts` becomes the tab shell (dashboard and users move
  behind tabs without behaviour change).
- `src/admin/libraryAdminView.ts` — locale switch, topic list (label, key,
  question count, "archived" badge), and actions: create topic, import JSON,
  export, archive/restore, open editor.
- `src/admin/questionEditor.ts` — prompt, level select (unclassified / basic /
  intermediate / advanced), and the block editor: per-block type select, up/down
  and remove, plus "add block". Text and note blocks are textareas, code blocks
  add a `lang` field, table blocks render a small grid.
- `src/admin/importJsonModal.ts` — paste or choose a JSON file, preview the
  section and question counts **and validation errors before writing**, choose
  `replace` or `append`, and load a sample template.
- `src/styles/admin.css` grows the Library styles; `vi`/`en` gain `libAdmin.*`
  keys.
- Reordering or deleting a section or question shows an explicit warning that
  learned progress is positional and will point at different questions, and
  requires confirmation.

### Import template

Identical to the current corpus file, with `level` optional:

```json
{
  "title": "...",
  "subtitle": "...",
  "label": "...",
  "color": "#B71C1C",
  "sections": [
    {
      "name": "Phần I",
      "questions": [
        {
          "code": "Q1",
          "level": "basic",
          "q": "...",
          "blocks": [{ "type": "text", "text": "..." }]
        }
      ]
    }
  ]
}
```

Both `code` and the corpus's `id` are accepted as the question label, so
importing an existing `content/*.json` works as-is. Export emits this exact
shape, so export → import round-trips without loss.

## Progress keys

Unchanged: `keyOf(topic, sectionIdx, questionIdx)` still keys `progress`,
`favorites` and the local storage maps. This slice therefore warns before
reordering or deleting and does not touch user data. Moving progress to
question UUIDs is a separate future spec, listed under follow-ups.

## Testing

`npm run check` stays the single definition of green.

- Repository: projection returns the exact reader shapes; reorder updates
  positions; topic delete cascades; `RESTRICT` blocks a question that the Daily
  pool uses; archive hides a topic from the index.
- Routes: 403 for non-admins, 400 with a failing path for invalid JSON,
  `key` immutable, 409 `library_in_use`, archive/restore round-trip.
- Seed: idempotent across two runs, one transaction, unresolved Daily `ref`
  fails loudly.
- Fidelity: a test compares the database projection against the original
  `content/*.json` for every topic and locale, proving the source switch lost
  nothing. It runs where the corpus exists and skips with a warning otherwise.
- Frontend: topic list rendering, create-topic payload, block add/remove,
  import showing validation errors before submit.

## Rollout

Three phases, each independently verifiable:

1. **Data layer** — migration, seed script, repository, reader endpoints and the
   Daily route read from the database. The app behaves exactly as before; the
   fidelity test is the gate.
2. **Write API** — `libraryAdmin.ts`, validation, safety rules, tests.
3. **Admin UI** — the "Nội dung" tab, block editor, import/export modal, i18n.

Phase 1 also lands `docs/ADR-004-library-corpus-in-postgresql.md`, recording
that the Library corpus now lives in PostgreSQL and superseding the
`content/*.json`-as-corpus statement in ADR-002, plus the corresponding
`AGENTS.md` reference update.

## Risks

| Risk                                        | Mitigation                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------- |
| Reader switch silently changes data         | Fidelity test compares DB projection to `content/*.json` per topic and locale.        |
| Positional Daily refs break on reorder      | Seed resolves refs to a real foreign key; the new API never stores positions.         |
| Destructive edit loses content              | Topics archive instead of delete; snapshot in every delete response; export any time. |
| Users lose learned progress after a reorder | Explicit confirmation warning; a dedicated follow-up spec moves keys to UUIDs.        |
| A large import payload                      | Size ceilings per block, table and question, validated before writing.                |

## Follow-ups (not in this slice)

- Move progress and favourites to question UUIDs.
- Filter Quiz and Daily by level.
- Audit trail in `audit_events`.
- Remove `content/*.json` from the repository once the database is the settled
  source, and retire `scripts/translate-content.swift`.

## Verification

- `npm run check` green.
- Seed twice, confirm no duplicates and identical reader output.
- Manual: create a topic, add a section and questions with levels, edit a
  question with a table block, export and re-import it, archive and restore a
  topic, and confirm a Daily-referenced question cannot be deleted.
- Confirm a disabled or non-admin account still receives 401/403 from both the
  reader and the admin Library endpoints.

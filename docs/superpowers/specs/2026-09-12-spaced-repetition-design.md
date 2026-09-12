# Spaced Repetition Design

**Date:** 2026-09-12
**Status:** Approved
**Complements:** `docs/superpowers/specs/2026-09-12-prepify-full-overhaul-design.md` (server-owned learning results)

## Goal

Give every quiz interaction a memory schedule so Prepify becomes a retention
system, not just a question browser. Users review what is due today; their
review activity feeds the existing streak.

## Non-goals

- No SRS statistics, heatmaps, or per-topic due badges in the sidebar.
- No user-configurable intervals or custom decks.
- No cross-device real-time sync beyond the existing request/response API.
- No changes to the Daily challenge flow.

## Approved decisions

| Question | Decision |
| --- | --- |
| How is a review session graded? | Self-graded after revealing the answer, with three levels: **Again / Hard / Good** (Anki style). |
| What feeds the scheduler while studying normally? | MCQ in quiz mode: correct → Good, wrong → Again. Flashcards: existing grades 1/2/3 map to Again/Hard/Good. |
| Scheduling algorithm | Simplified SM-2 (exact values below). |
| Where is schedule state stored? | Server table `review_schedules` for logged-in users (new append-only migration); `localStorage` for guests, mirroring the existing `progress` pattern. |
| Does reviewing count toward the streak? | Yes — each grade records a study day with the configured time zone, reusing the existing `study_days` insert. |

## Algorithm (simplified SM-2)

State per (user, topic, sectionIdx, questionIdx): `intervalDays` (start 1),
`ease` (start 2.5), `dueAt`, `reviewCount`. A card is **new** when
`reviewCount === 0`; otherwise it is **known**.

Grades and their effect:

| Grade | New card | Known card | Ease change |
| --- | --- | --- | --- |
| Again | interval = 1 | interval = 1 | ease − 0.2 |
| Hard | interval = 3 | interval = interval × 1.5 | ease − 0.15 |
| Good | interval = 7 | interval = interval × ease | ease + 0.05 |

Rules applied after computing the interval and ease:

- Round the interval to the nearest integer number of days, minimum 1.
- Cap the interval at 180 days.
- Clamp ease into `[1.3, 3.0]`.
- `dueAt = now + interval days` in the configured time zone boundary
  (calendar days, using the same `dateInTimeZone` convention as the streak
  module); the due card is eligible from the start of its due day.
- `reviewCount` increments on every grade.

## Data model

Migration `009_add_review_schedules.sql` (append-only):

```sql
CREATE TABLE IF NOT EXISTS review_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic         TEXT NOT NULL,
  section_idx   INTEGER NOT NULL,
  question_idx  INTEGER NOT NULL,
  interval_days INTEGER NOT NULL DEFAULT 1,
  ease          DOUBLE PRECISION NOT NULL DEFAULT 2.5,
  due_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  review_count  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, topic, section_idx, question_idx)
);

CREATE INDEX IF NOT EXISTS idx_review_due
  ON review_schedules (user_id, due_at);
```

## API

- `GET /api/v1/review/due` (requireAuth) →
  `{ count: number, items: [{ topic, sectionIdx, questionIdx, dueAt, intervalDays, reviewCount }] }`
  for schedules with `due_at <= now`, ordered by `due_at`.
- `POST /api/v1/review/grade` (requireAuth), body
  `{ topic, sectionIdx, questionIdx, quality: 'again' | 'hard' | 'good' }` →
  `{ schedule: { topic, sectionIdx, questionIdx, dueAt, intervalDays, ease, reviewCount } }`.
  Upserts the schedule and, in the same request, records a study day for the
  configured time zone (idempotent insert into `study_days`).

Guests use `localStorage` key `quiz:review` with the same schedule shape keyed
by `topic:sectionIdx:questionIdx`; no streak for guests (unchanged behavior).

## Frontend integration

- `src/review/scheduler.ts` — pure functions: `newSchedule()` and
  `applyGrade(schedule, quality, nowIso)` implementing the algorithm above.
- `src/state/review.ts` — load/save schedules and the due queue (API for
  logged-in users, `localStorage` for guests), mirroring `src/state/progress.ts`.
- Hooks in the existing quiz flow:
  - `src/quiz/quizView.ts` MCQ answer: correct → grade `good`, wrong → `again`.
  - `src/quiz/quizView.ts` flashcard grades 3/2/1 → good/hard/again.
- Topbar button **Ôn tập** with a due-count badge (mirrors the Daily button).
- Review overlay (`src/review/reviewView.ts`): shows one due question at a
  time → reveal answer → three grade buttons (keyboard 1/2/3) → after the
  last card, a summary ("đã ôn N câu, còn M câu").
- Every rendered string is escaped; all copy lives in `src/i18n/{vi,en}.ts`.

## Testing

TDD for every unit:

- `scheduler.test.ts` — interval/ease math for all three grades, new vs known
  cards, rounding, 180-day cap, ease clamping.
- Migration and repository tests — upsert uniqueness, due filtering, ordering.
- Route tests — auth required, `due` payload shape, `grade` upsert + study-day
  side effect (timezone-aware date).
- `reviewView.test.ts` — due queue rendering, grade buttons, summary, escaping.
- Client tests — `api.review.due()` and `api.review.grade()` paths.

## Verification

- `npm test`, `npm --prefix server test`, both typechecks, both builds,
  `format:check`, `lint`, `check:bundle`.
- Manual smoke: study two questions in quiz mode, open Ôn tập, grade them,
  confirm due dates move and the streak advances.

## Follow-ups (new design when needed)

- Review statistics and per-topic due badges.
- Mistake log and "recently failed" queue.
- Configurable intervals; import/export schedules.

# Final-fix evidence — Learning Result Integrity

## TDD evidence

### RED (before production changes)

```text
$ npm --prefix server test -- src/routes/quizSessions.test.ts
Test Files  1 failed (1)
Tests  5 failed | 5 passed (10)

expected 400 "Bad Request", got 201 "Created"
- rejects a fractional total before querying
- rejects an unsafe total before querying
- rejects a topic key longer than the VARCHAR(50) storage bound before querying
- rejects a blank topic key before querying

does not expose legacy scored MCQ sessions in history
Expected only the flashcard session; received the scored legacy MCQ session as well.
```

### GREEN

```text
$ npm --prefix server test -- src/routes/quizSessions.test.ts
Test Files  1 passed (1)
Tests  10 passed (10)
```

## Exact validation rule

Scored payloads and every non-`flashcard` mode continue to return `422`
`scored_attempt_required` before ordinary validation. A non-scored flashcard
payload returns `400` without a database query when `topicKey` is non-string,
blank after trimming, longer than 50 characters, or `total` is not a safe
integer in `1..2_147_483_647` inclusive. The bounds derive from migration 002:
`topic_key VARCHAR(50)` and signed PostgreSQL `INT` respectively.

History SQL restricts rows to `mode = 'flashcard'`; the response projection
also filters to `flashcard` as a defensive guarantee against an invalid query
dependency result.

## Checks

```text
$ npm --prefix server run typecheck && git diff --check
> tsc --noEmit

$ npm run check
format:check, lint, root typecheck, server typecheck, root tests (105),
server tests (230), root build, server build, private bundle scan, and both
production dependency audits passed; both audits found 0 vulnerabilities.
```

## Commit and files

Implementation commit: `28392bf116da5caf2617af295a592126b5fcbaeb`

- `server/src/routes/quizSessions.ts`
- `server/src/routes/quizSessions.test.ts`
- `.superpowers/sdd/2026-09-12-learning-result-integrity/final-fix-report.md`

## Concerns

None. No migration was required; the application validation matches the
existing storage types, and legacy MCQ rows remain stored but are never exposed
by this history endpoint.

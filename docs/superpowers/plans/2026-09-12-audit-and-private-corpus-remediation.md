# Audit and Private Corpus Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconcile completed historical plans without inventing evidence and remove the real Library corpus from Git while preserving it locally.

**Architecture:** A repository test enforces that `content/` is never tracked, synthetic fixtures replace tests that currently depend on the owner's corpus, and `CONTENT_ROOT` explicitly configures the seed CLI. Historical plans receive evidence tables that distinguish currently verified outcomes from RED/review steps that cannot be reconstructed.

**Tech Stack:** TypeScript, Vitest, Node.js child processes, Git

**Spec:** `docs/superpowers/specs/2026-09-12-deployment-obsidian-on-demand-sync-design.md`

## Global Constraints

- Preserve every local file under `content/`; remove only Git tracking.
- Never print corpus contents.
- Stage only files owned by the current task.
- Do not claim historical RED or reviewer evidence unless a saved artifact proves it.
- Do not push.

---

### Task 1: Repository privacy contract

**Files:**

- Create: `src/security/privateRepositoryScan.test.ts`
- Modify: `.gitignore`

**Interfaces:**

- Consumes: `git ls-files content`.
- Produces: a failing CI test while any real corpus path remains tracked.

- [ ] **Step 1: Write the failing test**

```ts
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('private repository boundary', () => {
  it('does not track the owner corpus', () => {
    const tracked = execFileSync('git', ['ls-files', 'content'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    expect(tracked).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

Run: `npm test -- src/security/privateRepositoryScan.test.ts`

Expected: FAIL and report tracked paths without reading their contents.

- [ ] **Step 3: Ignore the complete private corpus root**

Replace `/content/en/` in `.gitignore` with:

```gitignore
/content/
```

- [ ] **Step 4: Remove only the corpus from the Git index**

First record the exact paths with `git ls-files content`. Then run
`git rm --cached -- <each exact recorded path>`. Confirm each file still exists
on disk with `test -f` and never use a recursive filesystem deletion command.

- [ ] **Step 5: Run the test to verify GREEN**

Run: `npm test -- src/security/privateRepositoryScan.test.ts`

Expected: PASS with zero paths returned by `git ls-files content`.

- [ ] **Step 6: Commit**

```bash
git add .gitignore src/security/privateRepositoryScan.test.ts
git add -u -- content
git commit -m "security: tách corpus cá nhân khỏi git"
```

### Task 2: Synthetic seed fixtures and explicit content root

**Files:**

- Create: `server/test-fixtures/content/index.json`
- Create: `server/test-fixtures/content/sample.json`
- Create: `server/test-fixtures/content/daily.json`
- Modify: `server/src/config/env.ts`
- Modify: `server/src/config/env.test.ts`
- Modify: `server/src/scripts/seedLibrary.ts`
- Modify: `server/src/modules/library/librarySeed.test.ts`
- Modify: `server/src/modules/library/libraryFidelity.test.ts`
- Modify: `server/.env.example`
- Modify: `README.md`

**Interfaces:**

- Consumes: `AppConfig.contentRoot: string | undefined`.
- Produces: `seedLibrary(config.contentRoot)` with an actionable error when the local corpus is not configured; committed tests read only `server/test-fixtures/content`.

- [ ] **Step 1: Add failing configuration tests**

```ts
it('normalizes an explicit content root', () => {
  expect(loadConfig({ ...valid, CONTENT_ROOT: '/tmp/prepify-content' }).contentRoot).toBe(
    '/tmp/prepify-content',
  );
});

it('treats a blank content root as unset', () => {
  expect(loadConfig({ ...valid, CONTENT_ROOT: '' }).contentRoot).toBeUndefined();
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `npm --prefix server test -- src/config/env.test.ts`

Expected: FAIL because `contentRoot` does not exist.

- [ ] **Step 3: Add the validated configuration field**

Add `CONTENT_ROOT: z.string().trim().min(1).optional()` and map it to
`AppConfig.contentRoot?: string`. In `seedLibrary.ts`, replace the repository
relative path with:

```ts
if (!config.contentRoot) throw new Error('CONTENT_ROOT is required to seed the Library corpus');
const corpusDir = path.resolve(config.contentRoot);
```

- [ ] **Step 4: Create minimal synthetic fixtures**

Use these exact invented fixtures; copy no text from the private corpus.

`index.json`:

```json
[{ "key": "sample", "label": "Sample", "title": "Synthetic Topic", "color": "#123456" }]
```

`sample.json`:

```json
{
  "label": "Sample",
  "title": "Synthetic Topic",
  "color": "#123456",
  "sections": [
    {
      "name": "Synthetic Section",
      "questions": [
        {
          "id": "Q1",
          "q": "What is this fixture?",
          "blocks": [{ "type": "text", "text": "Test-only content." }]
        }
      ]
    }
  ]
}
```

`daily.json`:

```json
{
  "version": 1,
  "pool": [
    {
      "id": "fixture-mcq-1",
      "type": "mcq",
      "difficulty": 1,
      "ref": { "topicKey": "sample", "sectionIdx": 0, "questionIdx": 0 }
    },
    {
      "id": "fixture-fib-1",
      "type": "fib",
      "difficulty": 2,
      "prompt": "A test-only ___ exercises fill-in-the-blank seeding.",
      "blanks": ["fixture"],
      "hint": "Synthetic data"
    }
  ]
}
```

- [ ] **Step 5: Point seed and fidelity tests at fixtures**

Set their corpus constant to:

```ts
const CORPUS = path.resolve(__dirname, '../../../../server/test-fixtures/content');
```

Update expected counts to the exact synthetic fixture counts: one topic, one section,
one question, and two Daily entries (one MCQ and one FIB).

- [ ] **Step 6: Verify focused tests and typecheck**

Run:

```bash
npm --prefix server test -- src/config/env.test.ts src/modules/library/librarySeed.test.ts src/modules/library/libraryFidelity.test.ts
npm --prefix server run typecheck
```

Expected: all selected tests and typecheck pass.

- [ ] **Step 7: Document local setup and commit**

Add `CONTENT_ROOT=../content` to `server/.env.example` and explain that it points
to an ignored owner-controlled directory.

```bash
git add server/test-fixtures/content server/src/config/env.ts server/src/config/env.test.ts server/src/scripts/seedLibrary.ts server/src/modules/library/librarySeed.test.ts server/src/modules/library/libraryFidelity.test.ts server/.env.example README.md
git commit -m "refactor: cấu hình nguồn seed corpus riêng tư"
```

### Task 3: Historical plan reconciliation

**Files:**

- Modify: `docs/superpowers/plans/2026-09-12-admin-panel-implementation.md`
- Modify: `docs/superpowers/plans/2026-09-12-library-data-layer-implementation.md`
- Modify: `docs/superpowers/plans/2026-09-12-library-admin-authoring-implementation.md`

**Interfaces:**

- Consumes: current files, commit history, focused tests, and full verification.
- Produces: truthful plan status with no retroactive process claims.

- [ ] **Step 1: Build an evidence table for each plan**

For every task record the implementation commit(s), current matching test file,
and verification command. Add a `Post-implementation audit` section explaining
that unchecked historical RED/reviewer steps mean “not reconstructable”, not
“implementation missing”.

- [ ] **Step 2: Verify implementation outcomes**

Run the focused Admin, Library repository, authoring, route, client, and view
tests named in each plan. Mark only implementation and current GREEN outcomes
that those commands and commits prove.

- [ ] **Step 3: Preserve unknown historical evidence honestly**

Do not change a RED step to `[x]` unless Git history or a saved artifact proves
the failing run occurred before implementation. Annotate such steps with
`Historical RED evidence unavailable; current regression test verified`.

- [ ] **Step 4: Run the full gate and commit**

Run: `npm run check`

Expected: exit 0.

```bash
git add docs/superpowers/plans/2026-09-12-admin-panel-implementation.md docs/superpowers/plans/2026-09-12-library-data-layer-implementation.md docs/superpowers/plans/2026-09-12-library-admin-authoring-implementation.md
git commit -m "docs: đối soát bằng chứng các plan đã triển khai"
```

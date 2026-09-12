import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  appendEvidence,
  parseDaily,
  replaceJournal,
  setTaskCompleted,
  touchUpdated,
} from './obsidianMarkdown';
import {
  addTodayEvidence,
  dateInTimeZone,
  getTodayJourney,
  updateTodayTask,
} from './obsidianVault';

const SAMPLE = `---
type: daily
date: 2026-09-10
updated: 2026-09-08
stage: S0
---
# 2026-09-10

## Study
- [ ] #az104 21:00 — recall Unit 2
- [x] #english #journal 21:45 — close day

## Journal (English only)

- **Done:** first line
  second line
- **Blocked:**
- **Next:** continue tomorrow

### Bản sửa

> keep this untouched

## Email

- private content
`;

it('parses only the journey fields from a Daily note', () => {
  const parsed = parseDaily(SAMPLE);

  expect(parsed.stage).toBe('S0');
  expect(parsed.tasks).toHaveLength(2);
  expect(parsed.tasks[0].checked).toBe(false);
  expect(parsed.tasks[0].tags).toEqual(['#az104']);
  expect(parsed.journal.done).toBe('first line\nsecond line');
  expect(parsed.journal.blocked).toBe('');
  expect(parsed.evidence).toHaveLength(0);
  expect(JSON.stringify(parsed)).not.toContain('private content');
});

it('updates one checkbox and preserves every unrelated byte', () => {
  const task = parseDaily(SAMPLE).tasks[0];
  const updated = setTaskCompleted(SAMPLE, task.id, true);

  expect(updated).toBe(
    SAMPLE.replace(
      '- [ ] #az104 21:00 — recall Unit 2',
      '- [x] #az104 21:00 — recall Unit 2',
    ),
  );
});

it('replaces journal fields but preserves the correction and later sections', () => {
  const updated = replaceJournal(SAMPLE, {
    done: 'I finished the recall.\nI recorded the score.',
    blocked: 'Nothing.',
    next: 'I will review the mistakes.',
  });

  expect(updated).toMatch(/- \*\*Done:\*\* I finished the recall\.\n  I recorded the score\./);
  expect(updated).toMatch(/> keep this untouched/);
  expect(updated).toMatch(/- private content/);
});

it('appends evidence once and creates a dedicated section before Study', () => {
  const once = appendEvidence(SAMPLE, '#az104 #recall — Unit 2 — 3/5', 'event_12345678');
  const twice = appendEvidence(once, '#az104 #recall — Unit 2 — 3/5', 'event_12345678');

  expect(once).toBe(twice);
  expect(once.indexOf('## Bằng chứng từ Prepify')).toBeLessThan(once.indexOf('## Study'));
  expect(once.match(/prepify:event/g) ?? []).toHaveLength(1);
});

it('touches only the updated frontmatter field', () => {
  const updated = touchUpdated(SAMPLE, '2026-09-10');
  expect(updated).toBe(SAMPLE.replace('updated: 2026-09-08', 'updated: 2026-09-10'));
});

it('uses the configured timezone instead of UTC for the journey date', () => {
  const nearMidnightInVietnam = new Date('2026-09-09T18:30:00.000Z');
  expect(dateInTimeZone(nearMidnightInVietnam, 'Asia/Ho_Chi_Minh')).toBe('2026-09-10');
  expect(dateInTimeZone(nearMidnightInVietnam, 'UTC')).toBe('2026-09-09');
});

it('updates a temporary vault atomically and rejects a stale revision', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-vault-'));
  const dailyDir = path.join(root, 'Daily');
  const date = dateInTimeZone();
  const dailyPath = path.join(dailyDir, `${date}.md`);
  const previousEnabled = process.env.OBSIDIAN_SYNC_ENABLED;
  const previousPath = process.env.OBSIDIAN_VAULT_PATH;

  try {
    await fs.mkdir(dailyDir);
    await fs.writeFile(dailyPath, SAMPLE.replaceAll('2026-09-10', date), 'utf8');
    process.env.OBSIDIAN_SYNC_ENABLED = 'true';
    process.env.OBSIDIAN_VAULT_PATH = root;

    const before = await getTodayJourney();
    expect(before.obsidianUri).toContain('Daily%2F');
    const after = await updateTodayTask({
      taskId: before.tasks[0].id,
      completed: true,
      evidence: '#az104 #recall — Unit 2 — 3/3 độc lập',
      expectedRevision: before.revision,
      eventId: 'event_integration_123',
    });

    expect(after.tasks[0].checked).toBe(true);
    expect(after.evidence.at(-1)).toBe('#az104 #recall — Unit 2 — 3/3 độc lập');
    const stored = await fs.readFile(dailyPath, 'utf8');
    expect(stored).toMatch(/- \[x\] #az104/);
    expect(stored).toMatch(/> keep this untouched/);
    expect(stored).toMatch(/- private content/);

    const retried = await updateTodayTask({
      taskId: before.tasks[0].id,
      completed: true,
      evidence: '#az104 #recall — Unit 2 — 3/3 độc lập',
      expectedRevision: before.revision,
      eventId: 'event_integration_123',
    });
    expect(retried.revision).toBe(after.revision);
    expect(stored.match(/prepify:event/g) ?? []).toHaveLength(1);

    await expect(
      addTodayEvidence({
        evidence: '#partial — stale write',
        expectedRevision: before.revision,
        eventId: 'event_stale_12345',
      }),
    ).rejects.toMatchObject({ status: 412 });
  } finally {
    if (previousEnabled === undefined) delete process.env.OBSIDIAN_SYNC_ENABLED;
    else process.env.OBSIDIAN_SYNC_ENABLED = previousEnabled;
    if (previousPath === undefined) delete process.env.OBSIDIAN_VAULT_PATH;
    else process.env.OBSIDIAN_VAULT_PATH = previousPath;
    await fs.rm(root, { recursive: true, force: true });
  }
});

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  appendEvidence,
  parseDaily,
  parseDailyBlocks,
  replaceJournal,
  setTaskCompleted,
  touchUpdated,
} from './obsidianMarkdown';
import { createObsidianVault, dateInTimeZone } from './obsidianVault';

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

const RICH = `---
type: daily
date: 2026-09-13
stage: S0
---
# 2026-09-13

## Study
Đóng vở, tự recall trước khi mở tài liệu.

- [ ] #az104 21:00 — recall Unit 2
  > [!question]- Recall Unit 2
  > Entra ID là gì?
  > Khác gì AD DS?
- [x] #english 21:45 — close day, không ghi bù giả.

## Journal (English only)

- **Done:** first line
  second line
- **Blocked:**
- **Next:**

### Bản sửa câu sai

> sửa tối đa 10 phút
dòng nhắc ngoài quote

## Email

- private content
`;

it('projects every Study and Journal block, including collapsed callouts', () => {
  const blocks = parseDailyBlocks(RICH);

  expect(blocks[0]).toEqual({ kind: 'heading', level: 2, text: 'Study' });
  expect(blocks).toContainEqual({
    kind: 'quote',
    label: 'question',
    title: 'Recall Unit 2',
    lines: ['Entra ID là gì?', 'Khác gì AD DS?'],
    collapsed: true,
  });
  expect(blocks).toContainEqual({ kind: 'heading', level: 3, text: 'Bản sửa câu sai' });
  expect(blocks).toContainEqual({
    kind: 'quote',
    label: '',
    title: '',
    lines: ['sửa tối đa 10 phút'],
    collapsed: false,
  });
  expect(blocks[blocks.length - 1]).toEqual({
    kind: 'paragraph',
    text: 'dòng nhắc ngoài quote',
  });
  expect(JSON.stringify(blocks)).not.toContain('private content');
});

it('keeps block order and folds list continuations into their item', () => {
  const blocks = parseDailyBlocks(RICH);
  const kinds = blocks.map((block) => block.kind);

  expect(kinds).toEqual([
    'heading',
    'paragraph',
    'list',
    'quote',
    'list',
    'heading',
    'list',
    'heading',
    'quote',
    'paragraph',
  ]);
  expect(blocks[2]).toEqual({
    kind: 'list',
    ordered: false,
    items: [{ text: '#az104 21:00 — recall Unit 2', checked: false }],
  });
  expect(blocks[4]).toEqual({
    kind: 'list',
    ordered: false,
    items: [{ text: '#english 21:45 — close day, không ghi bù giả.', checked: true }],
  });
  expect(blocks[6]).toEqual({
    kind: 'list',
    ordered: false,
    items: [
      { text: '**Done:** first line second line', checked: null },
      { text: '**Blocked:**', checked: null },
      { text: '**Next:**', checked: null },
    ],
  });
});

it('ignores sections the Journey protocol does not own', () => {
  const blocks = parseDailyBlocks(`---
date: 2026-09-13
---
# 2026-09-13

## Email

- secret draft

## Tài chính

- secret number
`);

  expect(blocks).toEqual([]);
});

it('updates one checkbox and preserves every unrelated byte', () => {
  const task = parseDaily(SAMPLE).tasks[0];
  const updated = setTaskCompleted(SAMPLE, task.id, true);

  expect(updated).toBe(
    SAMPLE.replace('- [ ] #az104 21:00 — recall Unit 2', '- [x] #az104 21:00 — recall Unit 2'),
  );
});

it('replaces journal fields but preserves the correction and later sections', () => {
  const updated = replaceJournal(SAMPLE, {
    done: 'I finished the recall.\nI recorded the score.',
    blocked: 'Nothing.',
    next: 'I will review the mistakes.',
  });

  expect(updated).toMatch(/- \*\*Done:\*\* I finished the recall\.\n {2}I recorded the score\./);
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

  try {
    await fs.mkdir(dailyDir);
    await fs.writeFile(dailyPath, SAMPLE.replaceAll('2026-09-10', date), 'utf8');
    const vault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });

    const before = await vault.getTodayJourney();
    expect(before.obsidianUri).toContain('Daily%2F');
    const after = await vault.updateTodayTask({
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

    const retried = await vault.updateTodayTask({
      taskId: before.tasks[0].id,
      completed: true,
      evidence: '#az104 #recall — Unit 2 — 3/3 độc lập',
      expectedRevision: before.revision,
      eventId: 'event_integration_123',
    });
    expect(retried.revision).toBe(after.revision);
    expect(stored.match(/prepify:event/g) ?? []).toHaveLength(1);

    await expect(
      vault.addTodayEvidence({
        evidence: '#partial — stale write',
        expectedRevision: before.revision,
        eventId: 'event_stale_12345',
      }),
    ).rejects.toMatchObject({ status: 412 });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

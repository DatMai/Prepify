import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { revisionFor } from './obsidianMarkdown';
import { createObsidianVault } from './obsidianVault';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

function sampleNote(date: string): string {
  return `---
type: daily
date: ${date}
updated: 2026-09-08
stage: S0
---
# ${date}

## Study
- [ ] #az104 21:00 — recall Unit 2
- [x] #english #journal 21:45 — close day

## Journal (English only)

- **Done:** first line
- **Blocked:**
- **Next:** continue tomorrow

### Bản sửa

> keep this untouched

## Email

- private content
`;
}

async function makeVault(date = '2026-09-13') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-vault-boundary-'));
  tempRoots.push(root);
  const dailyDir = path.join(root, 'Daily');
  await fs.mkdir(dailyDir);
  const notePath = path.join(dailyDir, `${date}.md`);
  await fs.writeFile(notePath, sampleNote(date), 'utf8');
  return { root, dailyDir, notePath };
}

describe('createObsidianVault allowlist boundary', () => {
  it('reads the structured snapshot for an explicit date', async () => {
    const { root } = await makeVault();
    const vault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });

    const snapshot = await vault.getJourney('2026-09-13');

    expect(snapshot.date).toBe('2026-09-13');
    expect(snapshot.stage).toBe('S0');
    expect(snapshot.tasks).toHaveLength(2);
    expect(snapshot.journal.done).toBe('first line');
    expect(snapshot.revision).toBe(revisionFor(sampleNote('2026-09-13')));
  });

  it('rejects a date that could traverse outside the Daily directory', async () => {
    const { root } = await makeVault();
    const vault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });

    for (const bad of ['../etc/passwd', '2026-09-13/../../outside', '2026-13-01', '13-09-2026']) {
      await expect(vault.getJourney(bad)).rejects.toMatchObject({
        status: 400,
        code: 'date_invalid',
      });
    }
  });

  it('rejects a Daily directory that is a symlink escaping the vault', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-vault-dir-escape-'));
    tempRoots.push(root);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-outside-'));
    tempRoots.push(outside);
    await fs.writeFile(path.join(outside, '2026-09-13.md'), sampleNote('2026-09-13'), 'utf8');
    await fs.symlink(outside, path.join(root, 'Daily'));

    const vault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });

    await expect(vault.getJourney('2026-09-13')).rejects.toMatchObject({
      status: 403,
      code: 'vault_scope_invalid',
    });
  });

  it('rejects a Daily note that is itself a symlink', async () => {
    const { root, dailyDir } = await makeVault();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'prepify-note-outside-'));
    tempRoots.push(outside);
    const target = path.join(outside, 'real.md');
    await fs.writeFile(target, sampleNote('2026-09-13'), 'utf8');
    await fs.rm(path.join(dailyDir, '2026-09-13.md'));
    await fs.symlink(target, path.join(dailyDir, '2026-09-13.md'));

    const vault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });

    await expect(vault.getJourney('2026-09-13')).rejects.toMatchObject({
      status: 403,
      code: 'vault_scope_invalid',
    });
  });

  it('never serves an interrupted partial write and completes a later atomic write', async () => {
    const { root, dailyDir, notePath } = await makeVault();
    const vault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });

    // A crashed writer left a partial sibling temp file behind.
    const staleTemp = path.join(dailyDir, `.2026-09-13.md.${process.pid}.crashed.tmp`);
    await fs.writeFile(staleTemp, '## Journal (English only)\n- **Done:** PARTIAL', 'utf8');

    const before = await vault.getJourney('2026-09-13');
    expect(before.journal.done).toBe('first line');
    expect(before.revision).toBe(revisionFor(sampleNote('2026-09-13')));

    const after = await vault.updateTask({
      date: '2026-09-13',
      taskId: before.tasks[0].id,
      completed: true,
      evidence: '#e2e — finished',
      expectedRevision: before.revision,
      eventId: 'event_interrupted_123',
    });

    expect(after.tasks[0].checked).toBe(true);
    const stored = await fs.readFile(notePath, 'utf8');
    expect(stored).toMatch(/- \[x\] #az104/);
    expect(stored).not.toContain('PARTIAL');
  });

  it('rejects a stale revision instead of overwriting the note', async () => {
    const { root, notePath } = await makeVault();
    const vault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });
    const stale = `sha256:${'a'.repeat(64)}`;

    const before = await vault.getJourney('2026-09-13');
    await expect(
      vault.updateTask({
        date: '2026-09-13',
        taskId: before.tasks[0].id,
        completed: true,
        evidence: '#stale — write',
        expectedRevision: stale,
        eventId: 'event_stale_12345',
      }),
    ).rejects.toMatchObject({ status: 412, code: 'vault_conflict' });

    expect(await fs.readFile(notePath, 'utf8')).toBe(sampleNote('2026-09-13'));
  });

  it('appends a daily summary once and is idempotent', async () => {
    const { root, notePath } = await makeVault();
    const vault = createObsidianVault({ enabled: true, vaultPath: root, timeZone: 'UTC' });

    const once = await vault.addDailySummary({
      date: '2026-09-13',
      score: 3,
      total: 5,
      eventId: 'daily_2026-09-13_owner',
    });
    const twice = await vault.addDailySummary({
      date: '2026-09-13',
      score: 3,
      total: 5,
      eventId: 'daily_2026-09-13_owner',
    });

    expect(once.revision).toBe(twice.revision);
    const stored = await fs.readFile(notePath, 'utf8');
    expect(stored).toContain('Daily quiz — 3/5');
    expect(stored.match(/prepify:event/g) ?? []).toHaveLength(1);
  });
});

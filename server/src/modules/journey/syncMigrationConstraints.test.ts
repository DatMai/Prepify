import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';
import { parseDaily } from '../../services/obsidianMarkdown';

const databaseUrl = process.env.PREPIFY_MIGRATION_TEST_DATABASE_URL;
const databaseIt = databaseUrl ? it : it.skip;
const ownerId = '00000000-0000-0000-0000-000000000001';
const jobId = '00000000-0000-0000-0000-000000000002';
const revision = 'a'.repeat(64);

let client: Client | undefined;
let schemaName: string | undefined;

afterEach(async () => {
  if (!client) return;
  try {
    if (schemaName) await client.query(`DROP SCHEMA ${schemaName} CASCADE`);
  } finally {
    await client.end();
    client = undefined;
    schemaName = undefined;
  }
});

async function migrationClient(): Promise<Client> {
  const connected = new Client({ connectionString: databaseUrl });
  await connected.connect();
  const schema = `journey_constraint_${randomUUID().replaceAll('-', '')}`;
  await connected.query(`CREATE SCHEMA ${schema}`);
  await connected.query(`SET search_path TO ${schema}`);
  await connected.query('CREATE TABLE users (id UUID PRIMARY KEY)');
  const migrationsDir = path.resolve(__dirname, '../../../migrations');
  for (const file of ['013_add_journey_sync.sql', '014_add_journey_daily_blocks.sql']) {
    await connected.query(await readFile(path.join(migrationsDir, file), 'utf8'));
  }
  await connected.query('INSERT INTO users (id) VALUES ($1)', [ownerId]);
  client = connected;
  schemaName = schema;
  return connected;
}

describe('journey sync migration constraints', () => {
  databaseIt.each([
    'file:///Users/lisan/Daily/private.md',
    'obsidian://open?vault=private&file=Daily%2Fprivate.md',
    'Daily%2Fprivate.md',
    'Daily%252fprivate.md',
    'file%3A%2F%2F%2FUsers%2Flisan%2FDaily%2Fprivate.md',
  ])(
    'rejects vault URI or encoded path %s in projection and mutation plaintext',
    async (unsafeText) => {
      const db = await migrationClient();
      await expect(
        db.query(
          `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
         VALUES ($1, $2, $3, $4::jsonb)`,
          [
            ownerId,
            'vault-main',
            revision,
            JSON.stringify({
              daily: {
                date: '2026-09-12',
                stage: unsafeText,
                tasks: [],
                evidence: [],
                journal: { done: '', blocked: '', next: '' },
              },
            }),
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        db.query(
          `INSERT INTO journey_sync_jobs (id, owner_id, vault_id, job_type, payload, idempotency_key)
         VALUES ($1, $2, $3, 'mutation', $4::jsonb, $5)`,
          [
            jobId,
            ownerId,
            'vault-main',
            JSON.stringify({
              operation: 'journey_mutation',
              payload: {
                kind: 'journal',
                date: '2026-09-12',
                done: unsafeText,
                blocked: '',
                next: '',
              },
            }),
            'event_12345678',
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );

  databaseIt.each(['#az104', '#mạng', '#网络', '#１２', '#_recall', '#-recall'])(
    'persists actual Daily parser task and evidence text with tag %s',
    async (tag) => {
      const db = await migrationClient();
      const daily = parseDaily(`---
stage: AZ-104
---
## Study
- [ ] ${tag} 21:00 — recall Unit 2
## Bằng chứng từ Prepify
- ${tag} Completed recall
## Journal (English only)
- **Done:** Finished recall.
- **Blocked:**
- **Next:** Practice tomorrow.
`);
      expect(daily.tasks[0].tags).toEqual([tag]);
      const result = await db.query(
        `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING projection`,
        [
          ownerId,
          'vault-main',
          revision,
          JSON.stringify({ daily: { date: '2026-09-12', ...daily } }),
        ],
      );
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].projection.daily.tasks[0].text).toBe(`${tag} 21:00 — recall Unit 2`);
      expect(result.rows[0].projection.daily.tasks[0].tags).toEqual([tag]);
      expect(result.rows[0].projection.daily.evidence).toEqual([`${tag} Completed recall`]);
    },
  );

  databaseIt(
    'rejects forbidden nested vault body keys in projections, mutations, and audit details',
    async () => {
      const db = await migrationClient();
      const baseProjection = {
        daily: {
          date: '2026-09-12',
          stage: 'AZ-104',
          tasks: [
            {
              id: 'task-1',
              checked: true,
              text: 'Review virtual networks',
              tags: ['#az104'],
              filePath: 'Daily/private.md',
            },
          ],
          evidence: [],
          journal: { done: '', blocked: '', next: '' },
        },
      };

      await expect(
        db.query(
          `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
         VALUES ($1, $2, $3, $4::jsonb)`,
          [ownerId, 'vault-main', revision, JSON.stringify(baseProjection)],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        db.query(
          `INSERT INTO journey_sync_jobs (id, owner_id, vault_id, job_type, payload, idempotency_key)
         VALUES ($1, $2, $3, 'mutation', $4::jsonb, $5)`,
          [
            jobId,
            ownerId,
            'vault-main',
            JSON.stringify({
              operation: 'daily_summary',
              payload: { date: '2026-09-12', score: 3, total: 5, content: '## Private vault body' },
            }),
            'event_12345678',
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await db.query(
        `INSERT INTO journey_sync_jobs (id, owner_id, vault_id, job_type, payload, idempotency_key)
       VALUES ($1, $2, $3, 'mutation', $4::jsonb, $5)`,
        [
          jobId,
          ownerId,
          'vault-main',
          JSON.stringify({
            operation: 'daily_summary',
            payload: { date: '2026-09-12', score: 3, total: 5 },
          }),
          'event_12345679',
        ],
      );

      await expect(
        db.query(
          `INSERT INTO journey_audit_events (owner_id, job_id, event_type, details)
         VALUES ($1, $2, 'requested', $3::jsonb)`,
          [ownerId, jobId, JSON.stringify({ jobId: 'job-1', state: 'pending', content: 'secret' })],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    },
  );

  databaseIt(
    'rejects raw Markdown and vault paths in legal plaintext fields while accepting compact structured text',
    async () => {
      const db = await migrationClient();
      const rawVaultPath = 'Daily/private.md';
      const rawMarkdown = '## private vault body\nDaily/private.md';
      const projection = {
        daily: {
          date: '2026-09-12',
          stage: rawVaultPath,
          tasks: [
            { id: 'task-1', checked: true, text: 'Review virtual networks', tags: ['#az104'] },
          ],
          evidence: ['Completed virtual network lab'],
          journal: { done: 'Reviewed module.', blocked: '', next: 'Practice firewall rules.' },
        },
      };

      await expect(
        db.query(
          `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
         VALUES ($1, $2, $3, $4::jsonb)`,
          [ownerId, 'vault-main', revision, JSON.stringify(projection)],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        db.query(
          `INSERT INTO journey_sync_jobs (id, owner_id, vault_id, job_type, payload, idempotency_key)
         VALUES ($1, $2, $3, 'mutation', $4::jsonb, $5)`,
          [
            jobId,
            ownerId,
            'vault-main',
            JSON.stringify({
              operation: 'journey_mutation',
              payload: {
                kind: 'journal',
                date: '2026-09-12',
                done: rawMarkdown,
                blocked: '',
                next: 'Practice firewall rules.',
              },
            }),
            'event_12345678',
          ],
        ),
      ).rejects.toMatchObject({ code: '23514' });

      await expect(
        db.query(
          `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
         VALUES ($1, $2, $3, $4::jsonb)`,
          [
            ownerId,
            'vault-main',
            revision,
            JSON.stringify({
              daily: {
                date: '2026-09-12',
                stage: 'AZ-104',
                tasks: [{ id: 'task-1', checked: true, text: 'Review networks', tags: ['#az104'] }],
                evidence: ['Completed lab'],
                journal: {
                  done: 'Reviewed module.',
                  blocked: '',
                  next: 'Practice firewall rules.',
                },
                blocks: [],
              },
            }),
          ],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });

      await expect(
        db.query(
          `INSERT INTO journey_sync_jobs (id, owner_id, vault_id, job_type, payload, idempotency_key)
         VALUES ($1, $2, $3, 'mutation', $4::jsonb, $5)`,
          [
            jobId,
            ownerId,
            'vault-main',
            JSON.stringify({
              operation: 'journey_mutation',
              payload: {
                kind: 'journal',
                date: '2026-09-12',
                done: 'Reviewed module.',
                blocked: '',
                next: 'Practice firewall rules.',
              },
            }),
            'event_12345679',
          ],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    },
  );

  databaseIt('persists the full Daily block projection, including collapsed callouts', async () => {
    const db = await migrationClient();
    const daily = parseDaily(`---
stage: AZ-104
---
## Study
- [ ] #az104 21:00 — recall Unit 2
  > [!question]- Recall Unit 2
  > What is Entra ID?
### Bản sửa câu sai

> sửa tối đa 10 phút
## Journal (English only)
- **Done:** Finished recall.
- **Blocked:**
- **Next:** Practice tomorrow.
`);

    expect(daily.blocks.map((block) => block.kind)).toEqual([
      'heading',
      'list',
      'quote',
      'heading',
      'quote',
      'heading',
      'list',
    ]);

    const result = await db.query(
      `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
         VALUES ($1, $2, $3, $4::jsonb) RETURNING projection`,
      [
        ownerId,
        'vault-main',
        revision,
        JSON.stringify({ daily: { date: '2026-09-12', ...daily } }),
      ],
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].projection.daily.blocks).toEqual(daily.blocks);
    expect(result.rows[0].projection.daily.blocks[2]).toEqual({
      kind: 'quote',
      label: 'question',
      title: 'Recall Unit 2',
      lines: ['What is Entra ID?'],
      collapsed: true,
    });
    expect(result.rows[0].projection.daily.blocks[3]).toEqual({
      kind: 'heading',
      level: 3,
      text: 'Bản sửa câu sai',
    });
  });

  databaseIt.each([
    ['an unknown block kind', [{ kind: 'chart', text: 'nope' }]],
    ['a block with an unexpected key', [{ kind: 'paragraph', text: 'ok', path: 'Daily/x.md' }]],
    ['a block with a control character', [{ kind: 'paragraph', text: 'a\r\nb' }]],
    ['a heading without its level', [{ kind: 'heading', text: 'Study' }]],
    ['a quote without its collapse flag', [{ kind: 'quote', label: '', title: '', lines: [] }]],
  ])('rejects %s in the block projection', async (_name, blocks) => {
    const db = await migrationClient();
    await expect(
      db.query(
        `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          ownerId,
          'vault-main',
          revision,
          JSON.stringify({
            daily: {
              date: '2026-09-12',
              stage: 'AZ-104',
              tasks: [],
              evidence: [],
              journal: { done: '', blocked: '', next: '' },
              blocks,
            },
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  databaseIt('requires the block projection key', async () => {
    const db = await migrationClient();
    await expect(
      db.query(
        `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [
          ownerId,
          'vault-main',
          revision,
          JSON.stringify({
            daily: {
              date: '2026-09-12',
              stage: 'AZ-104',
              tasks: [],
              evidence: [],
              journal: { done: '', blocked: '', next: '' },
            },
          }),
        ],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  databaseIt.each([
    'đóng vở từ 08/09. #leetcode',
    'Unit 3 recall, Array/Hash Table /7',
    'sửa tối đa 10p câu recall sai',
  ])('accepts display-only task text %s', async (text) => {
    const db = await migrationClient();
    const result = await db.query(
      `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
       VALUES ($1, $2, $3, $4::jsonb) RETURNING projection`,
      [
        ownerId,
        'vault-main',
        revision,
        JSON.stringify({
          daily: {
            date: '2026-09-12',
            stage: 'AZ-104',
            tasks: [{ id: 'task-1', checked: false, text, tags: [] }],
            evidence: [],
            journal: { done: '', blocked: '', next: '' },
            blocks: [],
          },
        }),
      ],
    );

    expect(result.rowCount).toBe(1);
    expect(result.rows[0].projection.daily.tasks[0].text).toBe(text);
  });

  databaseIt('still rejects vault paths in the evidence and journal fields', async () => {
    const db = await migrationClient();
    for (const field of ['evidence', 'journal'] as const) {
      const daily = {
        date: '2026-09-12',
        stage: 'AZ-104',
        tasks: [],
        evidence: field === 'evidence' ? ['Daily/private.md'] : [],
        journal:
          field === 'journal'
            ? { done: 'Daily/private.md', blocked: '', next: '' }
            : { done: '', blocked: '', next: '' },
        blocks: [],
      };

      await expect(
        db.query(
          `INSERT INTO journey_projections (owner_id, vault_id, revision, projection)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [ownerId, 'vault-main', revision, JSON.stringify({ daily })],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    }
  });
});

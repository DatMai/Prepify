import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { afterEach, describe, expect, it } from 'vitest';

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
  const migration = await readFile(
    path.resolve(__dirname, '../../../migrations/013_add_journey_sync.sql'),
    'utf8',
  );
  await connected.query(migration);
  await connected.query('INSERT INTO users (id) VALUES ($1)', [ownerId]);
  client = connected;
  schemaName = schema;
  return connected;
}

describe('journey sync migration constraints', () => {
  databaseIt('rejects forbidden nested vault body keys in projections, mutations, and audit details', async () => {
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
        JSON.stringify({ operation: 'daily_summary', payload: { date: '2026-09-12', score: 3, total: 5 } }),
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
  });
});

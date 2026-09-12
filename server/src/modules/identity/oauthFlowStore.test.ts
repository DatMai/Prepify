import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createOAuthFlowStore } from './oauthFlowStore';
import type { SessionQuery } from './sessionRepository';

describe('OAuth PKCE state store', () => {
  it('stores a hash of state and returns the verifier exactly once', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ code_verifier: 'pkce-verifier' }] })
      .mockResolvedValueOnce({ rows: [] });
    const flow = createOAuthFlowStore(
      { query } as unknown as SessionQuery,
      'google',
      () => 'raw-state',
      () => new Date('2026-09-12T00:00:00Z'),
    );

    const state = await flow.create('pkce-verifier', '/');
    const first = await flow.consume(state);
    const replay = await flow.consume(state);

    expect(state).toBe('raw-state');
    expect(first).toBe('pkce-verifier');
    expect(replay).toBeNull();
    const insertValues = query.mock.calls[0]?.[1] as unknown[];
    expect(insertValues).toContain(createHash('sha256').update('raw-state').digest('hex'));
    expect(insertValues).not.toContain('raw-state');
  });
});

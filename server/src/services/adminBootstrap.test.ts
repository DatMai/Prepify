import { describe, expect, it, vi } from 'vitest';
import { syncConfiguredAdmins } from './adminBootstrap';

describe('syncConfiguredAdmins', () => {
  it('uses only normalized emails supplied by validated configuration', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await syncConfiguredAdmins(query, ['OWNER@Example.com', 'admin@example.com']);

    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[1]).toEqual([['owner@example.com', 'admin@example.com']]);
  });
});

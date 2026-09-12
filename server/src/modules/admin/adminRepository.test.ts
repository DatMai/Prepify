import { describe, expect, it, vi } from 'vitest';
import { createAdminRepository } from './adminRepository';

describe('createAdminRepository', () => {
  it('computes admin stats in one round-trip', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          total_users: '10',
          total_admins: '2',
          active_sessions: '5',
          daily_completions: '3',
        },
      ],
    });
    const repo = createAdminRepository({ query });

    const stats = await repo.stats();

    expect(query).toHaveBeenCalledWith(expect.stringContaining('COUNT'), expect.any(Array));
    expect(stats).toEqual({
      totalUsers: 10,
      totalAdmins: 2,
      activeSessions: 5,
      dailyCompletionsToday: 3,
    });
  });

  it('lists users with search and provider aggregation', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ total: '7' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'u1',
            email: 'a@b.c',
            display_name: 'A',
            role: 'admin',
            disabled: false,
            email_verified_at: null,
            last_seen_at: '2026-09-12T00:00:00.000Z',
            providers: 'google,facebook',
          },
        ],
      });
    const repo = createAdminRepository({ query });

    const result = await repo.listUsers({ search: 'a@b', limit: 50, offset: 0 });

    expect(result.total).toBe(7);
    expect(result.items[0]).toMatchObject({
      id: 'u1',
      email: 'a@b.c',
      role: 'admin',
      providers: ['google', 'facebook'],
    });
  });

  it('disables a user and revokes their sessions', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = createAdminRepository({ query });

    await repo.setDisabled('u1', true);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), ['u1', true]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM sessions'), ['u1']);
  });

  it('enables a user without touching sessions', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repo = createAdminRepository({ query });

    await repo.setDisabled('u1', false);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('UPDATE users'), ['u1', false]);
  });
});

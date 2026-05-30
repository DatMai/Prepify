import { Router } from 'express';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../db/client';
import type { AuthPayload } from '../middleware/auth';

const router = Router();

// Simple in-memory cache (60s TTL)
let cache: { rows: RawRow[]; expiresAt: number } | null = null;

interface RawRow {
  user_id: string;
  display_name: string | null;
  email: string;
  learned_count: number;
  streak_days: number;
}

export interface LeaderboardEntry {
  rank: number;
  displayName: string;
  learnedCount: number;
  streakDays: number;
}

/**
 * @swagger
 * /leaderboard:
 *   get:
 *     summary: Bảng xếp hạng theo số câu đã học
 *     tags: [Leaderboard]
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 50 }
 *     responses:
 *       200:
 *         description: Leaderboard entries
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entries:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       rank:         { type: integer }
 *                       displayName:  { type: string }
 *                       learnedCount: { type: integer }
 *                       streakDays:   { type: integer }
 *                 myRank: { type: integer, nullable: true }
 */
router.get('/', async (req: Request, res) => {
  const limitRaw = Number(req.query['limit'] ?? 20);
  const limit = Math.min(Math.max(1, isNaN(limitRaw) ? 20 : limitRaw), 50);

  let rows: RawRow[];

  if (cache && Date.now() < cache.expiresAt) {
    rows = cache.rows;
  } else {
    const result = await db.query<{
      user_id: string;
      display_name: string | null;
      email: string;
      learned_count: string;
      streak_days: string;
    }>(
      `WITH learned AS (
         SELECT user_id,
                (SELECT COUNT(*) FROM jsonb_each_text(data) WHERE value = 'true')::int AS learned_count
         FROM progress
       ),
       streaks AS (
         SELECT user_id, COUNT(*)::int AS streak_days
         FROM study_days
         WHERE activity_date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY user_id
       )
       SELECT u.id AS user_id,
              u.display_name,
              u.email,
              COALESCE(l.learned_count, 0) AS learned_count,
              COALESCE(s.streak_days, 0)   AS streak_days
       FROM users u
       LEFT JOIN learned l ON l.user_id = u.id
       LEFT JOIN streaks s ON s.user_id = u.id
       ORDER BY COALESCE(l.learned_count, 0) DESC, u.created_at ASC`,
    );
    rows = result.rows.map((r) => ({
      user_id: r.user_id,
      display_name: r.display_name,
      email: r.email,
      learned_count: Number(r.learned_count),
      streak_days: Number(r.streak_days),
    }));
    cache = { rows, expiresAt: Date.now() + 60_000 };
  }

  const sliced = rows.slice(0, limit);
  const entries: LeaderboardEntry[] = sliced.map((r, i) => ({
    rank: i + 1,
    displayName: r.display_name ?? r.email.split('@')[0],
    learnedCount: r.learned_count,
    streakDays: r.streak_days,
  }));

  const myRank = resolveMyRank(req, rows);
  res.json({ entries, myRank });
});

function resolveMyRank(req: Request, rows: RawRow[]): number | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = jwt.verify(header.slice(7), process.env.JWT_SECRET!) as AuthPayload;
    const idx = rows.findIndex((r) => r.user_id === payload.userId);
    return idx === -1 ? null : idx + 1;
  } catch {
    return null;
  }
}

export function invalidateLeaderboardCache(): void {
  cache = null;
}

export default router;

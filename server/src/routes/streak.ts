import { Router } from 'express';
import type { Pool } from 'pg';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /streak:
 *   get:
 *     summary: Lấy thông tin streak của user đang đăng nhập
 *     tags: [Streak]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Streak info
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 current:          { type: integer }
 *                 longest:          { type: integer }
 *                 studiedToday:     { type: boolean }
 *                 lastActivityDate: { type: string, nullable: true }
 *       401: { description: Chưa đăng nhập }
 */
router.get('/', requireAuth, async (req, res) => {
  const info = await getStreakInfo(req.user!.userId, db as unknown as Pool);
  res.json(info);
});

export default router;

// ─── helpers ─────────────────────────────────────────────────────────────────

export async function recordStudyDay(userId: string, pool: Pool): Promise<void> {
  // Pass UTC date explicitly so storage and computation always agree
  const today = new Date().toISOString().slice(0, 10);
  await pool.query(
    `INSERT INTO study_days (user_id, activity_date)
     VALUES ($1, $2::date)
     ON CONFLICT DO NOTHING`,
    [userId, today],
  );
}

interface StreakInfo {
  current: number;
  longest: number;
  studiedToday: boolean;
  lastActivityDate: string | null;
}

async function getStreakInfo(userId: string, pool: Pool): Promise<StreakInfo> {
  // Cast to text in SQL to avoid Node.js timezone conversion on DATE columns
  const { rows } = await pool.query<{ activity_date: string }>(
    `SELECT activity_date::text FROM study_days
     WHERE user_id = $1
     ORDER BY activity_date DESC`,
    [userId],
  );

  if (rows.length === 0) {
    return { current: 0, longest: 0, studiedToday: false, lastActivityDate: null };
  }

  // Parse YYYY-MM-DD strings to midnight UTC timestamps for comparison
  const msPerDay = 86400000;
  const toUtcTs = (s: string) => Date.UTC(
    parseInt(s.slice(0, 4), 10),
    parseInt(s.slice(5, 7), 10) - 1,
    parseInt(s.slice(8, 10), 10),
  );

  const dateTs = rows.map((r) => toUtcTs(r.activity_date));
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayTs = toUtcTs(todayStr);
  const yesterdayTs = todayTs - msPerDay;

  const latestTs = dateTs[0];
  const studiedToday = latestTs === todayTs;
  const lastActivityDate = rows[0].activity_date;

  // current streak: consecutive days from latest activity
  let current = 0;
  if (latestTs === todayTs || latestTs === yesterdayTs) {
    let expected = latestTs;
    for (const ts of dateTs) {
      if (ts === expected) {
        current++;
        expected -= msPerDay;
      } else {
        break;
      }
    }
  }

  // longest streak
  let longest = 0;
  let run = 0;
  for (let i = 0; i < dateTs.length; i++) {
    if (i === 0) { run = 1; continue; }
    const diff = (dateTs[i - 1] - dateTs[i]) / msPerDay;
    run = diff === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  longest = Math.max(longest, run);

  return { current, longest, studiedToday, lastActivityDate };
}

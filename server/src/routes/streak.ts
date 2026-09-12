import { Router } from 'express';
import type { Pool } from 'pg';
import { requireAuth } from '../middleware/auth';
import { computeStreak, dateInTimeZone } from '../modules/learning/streak';

interface StreakDependencies {
  pool: Pool;
  timeZone: string;
}

export function createStreakRouter(deps: StreakDependencies): Router {
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
    const { rows } = await deps.pool.query<{ activity_date: string }>(
      `SELECT activity_date::text FROM study_days
       WHERE user_id = $1
       ORDER BY activity_date DESC`,
      [req.user!.userId],
    );

    res.json(
      computeStreak(
        rows.map((row) => row.activity_date),
        dateInTimeZone(new Date(), deps.timeZone),
      ),
    );
  });

  return router;
}

/**
 * Records a study day using the configured time zone boundary, so the
 * stored date agrees with the `today` used everywhere else in the app.
 */
export async function recordStudyDay(
  userId: string,
  pool: Pool,
  timeZone: string,
): Promise<void> {
  const today = dateInTimeZone(new Date(), timeZone);
  await pool.query(
    `INSERT INTO study_days (user_id, activity_date)
     VALUES ($1, $2::date)
     ON CONFLICT DO NOTHING`,
    [userId, today],
  );
}

import { type RequestHandler, Router } from 'express';

export type QuizSessionQuery = <T>(
  text: string,
  values: readonly unknown[],
) => Promise<{ rows: T[] }>;

export function createQuizSessionsRouter(deps: {
  query: QuizSessionQuery;
  requireAuth: RequestHandler;
}): Router {
  const router = Router();

  router.use(deps.requireAuth);

  router.post('/', async (req, res) => {
    const body = req.body as Record<string, unknown> | null;
    const hasScore = body !== null && typeof body === 'object' && Object.hasOwn(body, 'score');
    const { topicKey, mode, total } = body ?? {};

    if (mode !== 'flashcard' || hasScore) {
      res.status(422).json({ code: 'scored_attempt_required' });
      return;
    }

    if (typeof topicKey !== 'string' || !topicKey || typeof total !== 'number' || total < 1) {
      res.status(400).json({ error: 'topicKey, mode (flashcard), total là bắt buộc và hợp lệ' });
      return;
    }

    const result = await deps.query<{ id: string; completed_at: string }>(
      `INSERT INTO quiz_sessions (user_id, topic_key, mode, total)
       VALUES ($1, $2, $3, $4)
       RETURNING id, completed_at`,
      [req.user!.userId, topicKey, mode, total],
    );

    const row = result.rows[0];
    res.status(201).json({ id: row.id, completedAt: row.completed_at });
  });

  router.get('/my', async (req, res) => {
    const result = await deps.query<{
      id: string;
      topic_key: string;
      mode: string;
      total: number;
      score: number | null;
      completed_at: string;
    }>(
      `SELECT id, topic_key, mode, total, score, completed_at
       FROM quiz_sessions
       WHERE user_id = $1
       ORDER BY completed_at DESC
       LIMIT 10`,
      [req.user!.userId],
    );

    res.json({
      sessions: result.rows.map((row) => ({
        id: row.id,
        topicKey: row.topic_key,
        mode: row.mode,
        total: row.total,
        score: row.score,
        completedAt: row.completed_at,
      })),
    });
  });

  return router;
}

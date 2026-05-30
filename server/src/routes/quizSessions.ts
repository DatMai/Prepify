import { Router } from 'express';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

/**
 * @swagger
 * /quiz-sessions:
 *   post:
 *     summary: Lưu kết quả một quiz session
 *     tags: [QuizSessions]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [topicKey, mode, total, score]
 *             properties:
 *               topicKey: { type: string, example: javascript }
 *               mode:     { type: string, enum: [flashcard, mcq] }
 *               total:    { type: integer }
 *               score:    { type: integer }
 *     responses:
 *       201:
 *         description: Session đã lưu
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:          { type: string, format: uuid }
 *                 completedAt: { type: string, format: date-time }
 *       400: { description: Dữ liệu không hợp lệ }
 *       401: { description: Chưa đăng nhập }
 */
router.post('/', async (req, res) => {
  const { topicKey, mode, total, score } = req.body as {
    topicKey?: string;
    mode?: string;
    total?: number;
    score?: number;
  };

  if (
    typeof topicKey !== 'string' || !topicKey ||
    (mode !== 'flashcard' && mode !== 'mcq') ||
    typeof total !== 'number' || total < 1 ||
    typeof score !== 'number' || score < 0 || score > total
  ) {
    res.status(400).json({ error: 'topicKey, mode (flashcard|mcq), total, score là bắt buộc và hợp lệ' });
    return;
  }

  const result = await db.query<{ id: string; completed_at: string }>(
    `INSERT INTO quiz_sessions (user_id, topic_key, mode, total, score)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, completed_at`,
    [req.user!.userId, topicKey, mode, total, score],
  );

  const row = result.rows[0];
  res.status(201).json({ id: row.id, completedAt: row.completed_at });
});

/**
 * @swagger
 * /quiz-sessions/my:
 *   get:
 *     summary: Lấy 10 quiz session gần nhất của user
 *     tags: [QuizSessions]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Danh sách sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 sessions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:          { type: string }
 *                       topicKey:    { type: string }
 *                       mode:        { type: string }
 *                       total:       { type: integer }
 *                       score:       { type: integer }
 *                       completedAt: { type: string }
 *       401: { description: Chưa đăng nhập }
 */
router.get('/my', async (req, res) => {
  const result = await db.query<{
    id: string;
    topic_key: string;
    mode: string;
    total: number;
    score: number;
    completed_at: string;
  }>(
    `SELECT id, topic_key, mode, total, score, completed_at
     FROM quiz_sessions
     WHERE user_id = $1
     ORDER BY completed_at DESC
     LIMIT 10`,
    [req.user!.userId],
  );

  const sessions = result.rows.map((r) => ({
    id: r.id,
    topicKey: r.topic_key,
    mode: r.mode,
    total: r.total,
    score: r.score,
    completedAt: r.completed_at,
  }));

  res.json({ sessions });
});

export default router;

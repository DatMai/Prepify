import { Router } from 'express';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

router.use(requireAuth);

/**
 * @swagger
 * /progress:
 *   get:
 *     summary: Lấy toàn bộ progress của user
 *     tags: [Progress]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Progress map
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { $ref: '#/components/schemas/ProgressData' }
 *       401: { description: Chưa đăng nhập }
 *   put:
 *     summary: Ghi đè toàn bộ progress
 *     tags: [Progress]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [data]
 *             properties:
 *               data: { $ref: '#/components/schemas/ProgressData' }
 *     responses:
 *       200: { description: Lưu thành công }
 *       401: { description: Chưa đăng nhập }
 *   patch:
 *     summary: Cập nhật 1 key trong progress (toggle câu hỏi)
 *     tags: [Progress]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key, value]
 *             properties:
 *               key:   { type: string, example: 'javascript:0:0' }
 *               value: { type: boolean }
 *     responses:
 *       200: { description: Cập nhật thành công }
 *       400: { description: Thiếu key hoặc value }
 *       401: { description: Chưa đăng nhập }
 */

// GET /progress — trả về progress map của user
router.get('/', async (req, res) => {
  const result = await db.query<{ data: Record<string, boolean> }>(
    'SELECT data FROM progress WHERE user_id = $1',
    [req.user!.userId],
  );
  res.json({ data: result.rows[0]?.data ?? {} });
});

// PUT /progress — upsert toàn bộ progress map
router.put('/', async (req, res) => {
  const { data } = req.body as { data?: unknown };
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    res.status(400).json({ error: 'data phải là object' });
    return;
  }

  await db.query(
    `INSERT INTO progress (user_id, data)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET data = $2`,
    [req.user!.userId, JSON.stringify(data)],
  );
  res.json({ ok: true });
});

// PATCH /progress — cập nhật từng key (toggle 1 câu)
router.patch('/', async (req, res) => {
  const { key, value } = req.body as { key?: string; value?: boolean };
  if (typeof key !== 'string' || typeof value !== 'boolean') {
    res.status(400).json({ error: 'key (string) và value (boolean) là bắt buộc' });
    return;
  }

  await db.query(
    `INSERT INTO progress (user_id, data)
     VALUES ($1, jsonb_build_object($2::text, $3::boolean))
     ON CONFLICT (user_id) DO UPDATE
       SET data = progress.data || jsonb_build_object($2::text, $3::boolean)`,
    [req.user!.userId, key, value],
  );
  res.json({ ok: true });
});

export default router;

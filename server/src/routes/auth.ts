import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';

const router = Router();

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: Đăng ký tài khoản mới
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, format: email }
 *               password: { type: string, minLength: 6 }
 *               displayName: { type: string }
 *     responses:
 *       201: { description: Đăng ký thành công, content: { application/json: { schema: { $ref: '#/components/schemas/AuthResponse' } } } }
 *       400: { description: Thiếu field hoặc password quá ngắn }
 *       409: { description: Email đã tồn tại }
 */

router.post('/register', async (req, res) => {
  const { email, password, displayName } = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
  };

  if (!email || !password) {
    res.status(400).json({ error: 'email và password là bắt buộc' });
    return;
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Password phải ít nhất 6 ký tự' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const result = await db.query<{ id: string; email: string; display_name: string | null }>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING id, email, display_name`,
      [email.toLowerCase().trim(), passwordHash, displayName?.trim() || null],
    );
    const user = result.rows[0];
    const token = signToken(user.id, user.email);
    res.status(201).json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'Email đã được sử dụng' });
      return;
    }
    throw err;
  }
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: Đăng nhập
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:    { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200: { description: Login thành công, content: { application/json: { schema: { $ref: '#/components/schemas/AuthResponse' } } } }
 *       401: { description: Sai email hoặc password }
 */
router.post('/login', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    res.status(400).json({ error: 'email và password là bắt buộc' });
    return;
  }

  const result = await db.query<{
    id: string;
    email: string;
    password_hash: string;
    display_name: string | null;
  }>(
    'SELECT id, email, password_hash, display_name FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );

  const user = result.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Email hoặc password không đúng' });
    return;
  }

  const token = signToken(user.id, user.email);
  res.json({ token, user: { id: user.id, email: user.email, displayName: user.display_name } });
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Lấy thông tin user đang đăng nhập
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Thông tin user, content: { application/json: { schema: { $ref: '#/components/schemas/User' } } } }
 *       401: { description: Token không hợp lệ }
 */
router.get('/me', requireAuth, async (req, res) => {
  const result = await db.query<{ id: string; email: string; display_name: string | null }>(
    'SELECT id, email, display_name FROM users WHERE id = $1',
    [req.user!.userId],
  );
  const user = result.rows[0];
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ id: user.id, email: user.email, displayName: user.display_name });
});

function signToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });
}

export default router;

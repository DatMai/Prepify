import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { checkPasswordStrength } from '../utils/passwordStrength';
import { sendVerificationEmail } from '../utils/email';

const router = Router();

export const SECURITY_QUESTIONS = [
  'Tên thú cưng đầu tiên của bạn?',
  'Tên trường tiểu học của bạn?',
  'Tên thành phố bạn sinh ra?',
  'Tên thầy/cô giáo yêu thích thời nhỏ?',
  'Tên nhân vật phim yêu thích thời nhỏ?',
  'Món ăn yêu thích của bạn?',
] as const;

const FRONTEND_URL = () => process.env.FRONTEND_URL ?? 'http://localhost:5173';

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
 *               password: { type: string, minLength: 8 }
 *               displayName: { type: string }
 *     responses:
 *       201: { description: Đăng ký thành công }
 *       400: { description: Thiếu field hoặc password yếu }
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

  const strength = checkPasswordStrength(password);
  if (!strength.valid) {
    res.status(400).json({ error: strength.errors.join(' · ') });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const avatarId = Math.floor(Math.random() * 20) + 1;

  try {
    const result = await db.query<{
      id: string; email: string; display_name: string | null; avatar_id: number; email_verified_at: Date | null;
    }>(
      `INSERT INTO users (email, password_hash, display_name, avatar_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, avatar_id, email_verified_at`,
      [email.toLowerCase().trim(), passwordHash, displayName?.trim() || null, avatarId],
    );
    const user = result.rows[0];

    // Send verification email (non-blocking)
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.query(
      'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
      [user.id, tokenHash, expiresAt],
    );
    const verifyUrl = `${process.env.OAUTH_CALLBACK_BASE ?? 'http://localhost:3001'}/auth/verify-email/${rawToken}`;
    void sendVerificationEmail(user.email, verifyUrl).catch(() => {});

    const token = signToken(user.id, user.email);
    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        avatarId: user.avatar_id,
        emailVerifiedAt: user.email_verified_at?.toISOString() ?? null,
      },
    });
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
 *       200: { description: Login thành công }
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
    password_hash: string | null;
    display_name: string | null;
    avatar_id: number;
    location: string | null;
    email_verified_at: Date | null;
  }>(
    'SELECT id, email, password_hash, display_name, avatar_id, location, email_verified_at FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );

  const user = result.rows[0];
  if (!user) {
    res.status(401).json({ error: 'Email hoặc password không đúng' });
    return;
  }
  if (!user.password_hash) {
    res.status(401).json({ error: 'Tài khoản này được đăng nhập qua Google hoặc Facebook.' });
    return;
  }
  if (!(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Email hoặc password không đúng' });
    return;
  }

  const token = signToken(user.id, user.email);
  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarId: user.avatar_id,
      location: user.location,
      emailVerifiedAt: user.email_verified_at?.toISOString() ?? null,
    },
  });
});

/**
 * @swagger
 * /auth/me:
 *   get:
 *     summary: Lấy thông tin user đang đăng nhập
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Thông tin user }
 *       401: { description: Token không hợp lệ }
 */
router.get('/me', requireAuth, async (req, res) => {
  const result = await db.query<{
    id: string; email: string; display_name: string | null; avatar_id: number;
    location: string | null; email_verified_at: Date | null;
  }>(
    'SELECT id, email, display_name, avatar_id, location, email_verified_at FROM users WHERE id = $1',
    [req.user!.userId],
  );
  const user = result.rows[0];
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    avatarId: user.avatar_id,
    location: user.location,
    emailVerifiedAt: user.email_verified_at?.toISOString() ?? null,
  });
});

/**
 * @swagger
 * /auth/verify-email/{token}:
 *   get:
 *     summary: Xác minh email qua link trong mail
 *     tags: [Auth]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       302: { description: Redirect về frontend }
 */
router.get('/verify-email/:token', async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(req.params.token).digest('hex');
  const result = await db.query<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM email_verification_tokens WHERE token_hash = $1 AND expires_at > NOW()',
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) {
    res.redirect(`${FRONTEND_URL()}/?email_verified=0`);
    return;
  }
  await db.query('UPDATE users SET email_verified_at = NOW() WHERE id = $1', [row.user_id]);
  await db.query('DELETE FROM email_verification_tokens WHERE id = $1', [row.id]);
  res.redirect(`${FRONTEND_URL()}/?email_verified=1`);
});

/**
 * @swagger
 * /auth/resend-verification:
 *   post:
 *     summary: Gửi lại email xác minh
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Đã gửi lại }
 *       400: { description: Email đã được xác minh }
 *       429: { description: Đợi 5 phút trước khi gửi lại }
 */
router.post('/resend-verification', requireAuth, async (req, res) => {
  const userResult = await db.query<{ email: string; email_verified_at: Date | null }>(
    'SELECT email, email_verified_at FROM users WHERE id = $1',
    [req.user!.userId],
  );
  const user = userResult.rows[0];
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.email_verified_at) {
    res.status(400).json({ error: 'Email đã được xác minh' });
    return;
  }

  const recent = await db.query<{ created_at: Date }>(
    'SELECT created_at FROM email_verification_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [req.user!.userId],
  );
  if (recent.rows[0]) {
    const ageMs = Date.now() - recent.rows[0].created_at.getTime();
    if (ageMs < 5 * 60 * 1000) {
      res.status(429).json({ error: 'Vui lòng đợi 5 phút trước khi gửi lại' });
      return;
    }
  }

  await db.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [req.user!.userId]);
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.query(
    'INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [req.user!.userId, tokenHash, expiresAt],
  );
  const verifyUrl = `${process.env.OAUTH_CALLBACK_BASE ?? 'http://localhost:3001'}/auth/verify-email/${rawToken}`;
  void sendVerificationEmail(user.email, verifyUrl).catch(() => {});
  res.json({ ok: true });
});

/**
 * @swagger
 * /auth/security-question/set:
 *   post:
 *     summary: Đặt câu hỏi bí mật
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [question, answer]
 *             properties:
 *               question: { type: string }
 *               answer:   { type: string }
 *     responses:
 *       200: { description: Đã lưu câu hỏi bí mật }
 *       400: { description: Câu hỏi không hợp lệ }
 */
router.post('/security-question/set', requireAuth, async (req, res) => {
  const { question, answer } = req.body as { question?: string; answer?: string };
  if (!question || !answer) {
    res.status(400).json({ error: 'question và answer là bắt buộc' });
    return;
  }
  if (!(SECURITY_QUESTIONS as readonly string[]).includes(question)) {
    res.status(400).json({ error: 'Câu hỏi không hợp lệ' });
    return;
  }
  const answerHash = await bcrypt.hash(answer.trim().toLowerCase(), 10);
  await db.query(
    'UPDATE users SET security_question = $1, security_answer_hash = $2 WHERE id = $3',
    [question, answerHash, req.user!.userId],
  );
  res.json({ ok: true });
});

/**
 * @swagger
 * /auth/profile:
 *   patch:
 *     summary: Cập nhật profile (display name, location, avatar)
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               displayName: { type: string, maxLength: 50 }
 *               location:    { type: string, maxLength: 100 }
 *               avatarId:    { type: integer, minimum: 1, maximum: 20 }
 *     responses:
 *       200: { description: Profile đã được cập nhật }
 *       400: { description: Dữ liệu không hợp lệ }
 *       401: { description: Chưa đăng nhập }
 */
router.patch('/profile', requireAuth, async (req, res) => {
  const { displayName, location, avatarId } = req.body as {
    displayName?: string;
    location?: string;
    avatarId?: number;
  };

  if (displayName !== undefined && displayName.trim().length > 50) {
    res.status(400).json({ error: 'Tên hiển thị không được quá 50 ký tự' });
    return;
  }
  if (location !== undefined && location.trim().length > 100) {
    res.status(400).json({ error: 'Địa điểm không được quá 100 ký tự' });
    return;
  }
  if (avatarId !== undefined && (avatarId < 1 || avatarId > 20 || !Number.isInteger(avatarId))) {
    res.status(400).json({ error: 'avatarId phải là số nguyên từ 1 đến 20' });
    return;
  }

  const result = await db.query<{ display_name: string | null; location: string | null; avatar_id: number }>(
    `UPDATE users
     SET display_name = COALESCE($1, display_name),
         location     = COALESCE($2, location),
         avatar_id    = COALESCE($3, avatar_id)
     WHERE id = $4
     RETURNING display_name, location, avatar_id`,
    [
      displayName !== undefined ? (displayName.trim() || null) : null,
      location !== undefined ? (location.trim() || null) : null,
      avatarId ?? null,
      req.user!.userId,
    ],
  );

  const u = result.rows[0];
  res.json({ displayName: u.display_name, location: u.location, avatarId: u.avatar_id });
});

function signToken(userId: string, email: string): string {
  return jwt.sign({ userId, email }, process.env.JWT_SECRET!, {
    expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as jwt.SignOptions['expiresIn'],
  });
}

export default router;

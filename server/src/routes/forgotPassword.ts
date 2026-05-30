import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { db } from '../db/client';
import { sendPasswordResetEmail } from '../utils/email';
import { checkPasswordStrength } from '../utils/passwordStrength';

const router = Router();

const FRONTEND_URL = () => process.env.FRONTEND_URL ?? 'http://localhost:5173';

async function createResetToken(userId: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [userId, tokenHash],
  );
  return rawToken;
}

/**
 * @swagger
 * /auth/forgot/email:
 *   post:
 *     summary: Gửi link đặt lại mật khẩu qua email
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Luôn trả 200 dù email tồn tại hay không }
 *       429: { description: Vui lòng đợi 5 phút }
 */
router.post('/forgot/email', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'email là bắt buộc' });
    return;
  }

  const result = await db.query<{ id: string; email: string }>(
    'SELECT id, email FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  const user = result.rows[0];

  if (user) {
    const existing = await db.query<{ created_at: Date }>(
      'SELECT created_at FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1',
      [user.id],
    );
    if (existing.rows[0]) {
      const ageMs = Date.now() - existing.rows[0].created_at.getTime();
      if (ageMs < 5 * 60 * 1000) {
        res.status(429).json({ error: 'Vui lòng đợi 5 phút trước khi gửi lại.' });
        return;
      }
    }

    const rawToken = await createResetToken(user.id);
    const resetUrl = `${FRONTEND_URL()}/?reset_token=${rawToken}`;
    void sendPasswordResetEmail(user.email, resetUrl).catch(() => {});
  }

  res.json({ ok: true, message: 'Nếu email tồn tại, chúng tôi đã gửi link đặt lại.' });
});

/**
 * @swagger
 * /auth/forgot/question:
 *   post:
 *     summary: Lấy câu hỏi bí mật của tài khoản
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200: { description: Trả câu hỏi bí mật }
 *       404: { description: Email không tồn tại hoặc không có câu hỏi bí mật }
 */
router.post('/forgot/question', async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'email là bắt buộc' });
    return;
  }

  const result = await db.query<{ security_question: string | null }>(
    'SELECT security_question FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  const user = result.rows[0];
  if (!user || !user.security_question) {
    res.status(404).json({ error: 'Tài khoản không có câu hỏi bí mật.' });
    return;
  }

  res.json({ question: user.security_question });
});

/**
 * @swagger
 * /auth/forgot/question/verify:
 *   post:
 *     summary: Xác minh câu trả lời bí mật để lấy reset token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, answer]
 *             properties:
 *               email:  { type: string, format: email }
 *               answer: { type: string }
 *     responses:
 *       200: { description: Trả resetToken để đặt lại mật khẩu }
 *       401: { description: Câu trả lời không đúng }
 *       404: { description: Tài khoản không tồn tại }
 */
router.post('/forgot/question/verify', async (req, res) => {
  const { email, answer } = req.body as { email?: string; answer?: string };
  if (!email || !answer) {
    res.status(400).json({ error: 'email và answer là bắt buộc' });
    return;
  }

  const result = await db.query<{ id: string; security_answer_hash: string | null }>(
    'SELECT id, security_answer_hash FROM users WHERE email = $1',
    [email.toLowerCase().trim()],
  );
  const user = result.rows[0];
  if (!user || !user.security_answer_hash) {
    res.status(404).json({ error: 'Tài khoản không tồn tại hoặc không có câu hỏi bí mật.' });
    return;
  }

  const match = await bcrypt.compare(answer.trim().toLowerCase(), user.security_answer_hash);
  if (!match) {
    res.status(401).json({ error: 'Câu trả lời không đúng.' });
    return;
  }

  const rawToken = await createResetToken(user.id);
  res.json({ resetToken: rawToken });
});

/**
 * @swagger
 * /auth/reset-password:
 *   post:
 *     summary: Đặt lại mật khẩu bằng reset token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, newPassword]
 *             properties:
 *               token:       { type: string }
 *               newPassword: { type: string }
 *     responses:
 *       200: { description: Mật khẩu đã được đặt lại }
 *       400: { description: Token không hợp lệ hoặc mật khẩu yếu }
 */
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword) {
    res.status(400).json({ error: 'token và newPassword là bắt buộc' });
    return;
  }

  const strength = checkPasswordStrength(newPassword);
  if (!strength.valid) {
    res.status(400).json({ error: strength.errors.join(' · ') });
    return;
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const result = await db.query<{ id: string; user_id: string; used_at: Date | null }>(
    `SELECT id, user_id, used_at FROM password_reset_tokens
     WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) {
    res.status(400).json({ error: 'Link đã hết hạn hoặc đã được sử dụng. Vui lòng thực hiện lại.' });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, row.user_id]);
  await db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [row.id]);

  res.json({ ok: true });
});

export default router;

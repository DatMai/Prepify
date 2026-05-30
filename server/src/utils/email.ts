import nodemailer from 'nodemailer';

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT ?? 587),
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });
}

const FROM = process.env.EMAIL_FROM ?? 'Prepify <noreply@prepify.dev>';

export async function sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
  await getTransporter().sendMail({
    from: FROM,
    to,
    subject: '[Prepify] Xác minh email của bạn',
    html: `
      <p>Cảm ơn bạn đã đăng ký Prepify!</p>
      <p><a href="${verifyUrl}">Xác minh email ngay</a></p>
      <p>Link hết hạn sau <strong>24 giờ</strong>.</p>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
  await getTransporter().sendMail({
    from: FROM,
    to,
    subject: '[Prepify] Đặt lại mật khẩu',
    html: `
      <p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Prepify.</p>
      <p><a href="${resetUrl}">Đặt lại mật khẩu</a></p>
      <p>Link hết hạn sau <strong>30 phút</strong>. Nếu không phải bạn yêu cầu, bỏ qua email này.</p>
    `,
  });
}

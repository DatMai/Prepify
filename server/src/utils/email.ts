import nodemailer from 'nodemailer';

interface MailConfig {
  enabled: boolean;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  from?: string;
}

interface MailTransport {
  sendMail(message: Record<string, unknown>): Promise<unknown>;
}

type TransportFactory = (options: Record<string, unknown>) => MailTransport;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createMailer(
  config: MailConfig,
  createTransport: TransportFactory = (options) => nodemailer.createTransport(options),
) {
  if (!config.enabled) {
    return {
      sendVerification: async (_to: string, _url: string) => undefined,
      sendPasswordReset: async (_to: string, _url: string) => undefined,
    };
  }
  if (!config.host || !config.user || !config.password) {
    throw new Error('Enabled email delivery requires complete SMTP configuration');
  }
  const transport = createTransport({
    host: config.host,
    port: config.port ?? 587,
    secure: config.secure ?? false,
    auth: { user: config.user, pass: config.password },
  });
  const from = config.from ?? 'Prepify <noreply@prepify.dev>';

  return {
    sendVerification: async (to: string, verifyUrl: string): Promise<void> => {
      await transport.sendMail({
        from,
        to,
        subject: '[Prepify] Xác minh email của bạn',
        html: `<p>Cảm ơn bạn đã đăng ký Prepify!</p><p><a href="${escapeHtml(verifyUrl)}">Xác minh email ngay</a></p><p>Link hết hạn sau <strong>24 giờ</strong>.</p>`,
      });
    },
    sendPasswordReset: async (to: string, resetUrl: string): Promise<void> => {
      await transport.sendMail({
        from,
        to,
        subject: '[Prepify] Đặt lại mật khẩu',
        html: `<p>Bạn vừa yêu cầu đặt lại mật khẩu cho tài khoản Prepify.</p><p><a href="${escapeHtml(resetUrl)}">Đặt lại mật khẩu</a></p><p>Link hết hạn sau <strong>30 phút</strong>.</p>`,
      });
    },
  };
}

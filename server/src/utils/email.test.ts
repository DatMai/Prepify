import { describe, expect, it, vi } from 'vitest';
import { createMailer } from './email';

describe('createMailer', () => {
  it('does not create a transport when delivery is disabled', async () => {
    const transportFactory = vi.fn();
    const mailer = createMailer({ enabled: false }, transportFactory);

    await mailer.sendVerification('user@example.com', 'https://prepify.example/verify');

    expect(transportFactory).not.toHaveBeenCalled();
  });

  it('uses only injected SMTP configuration', async () => {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    const transportFactory = vi.fn().mockReturnValue({ sendMail });
    const mailer = createMailer(
      {
        enabled: true,
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        user: 'mailer',
        password: 'secret',
        from: 'Prepify <noreply@example.com>',
      },
      transportFactory,
    );

    await mailer.sendPasswordReset('user@example.com', 'https://prepify.example/reset');

    expect(transportFactory).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      auth: { user: 'mailer', pass: 'secret' },
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Prepify <noreply@example.com>', to: 'user@example.com' }),
    );
  });
});

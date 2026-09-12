import { db } from '../db/client';

export async function syncConfiguredAdmins(): Promise<void> {
  const configured = process.env.ADMIN_EMAILS ?? process.env.OBSIDIAN_OWNER_EMAIL ?? '';
  const emails = configured
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (emails.length === 0) return;
  await db.query("UPDATE users SET role = 'admin' WHERE lower(email) = ANY($1::text[])", [emails]);
}

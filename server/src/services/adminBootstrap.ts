interface AdminQuery {
  (text: string, values?: unknown[]): Promise<unknown>;
}

export async function syncConfiguredAdmins(query: AdminQuery, configured: string[]): Promise<void> {
  const emails = [
    ...new Set(configured.map((email) => email.trim().toLowerCase()).filter(Boolean)),
  ];
  if (emails.length === 0) return;
  await query("UPDATE users SET role = 'admin' WHERE lower(email) = ANY($1::text[])", [emails]);
}

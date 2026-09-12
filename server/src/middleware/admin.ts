import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/client';

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Missing token' });
    return;
  }

  try {
    const result = await db.query<{ role: 'user' | 'admin' }>(
      'SELECT role FROM users WHERE id = $1',
      [req.user.userId],
    );
    if (result.rows[0]?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required', code: 'admin_required' });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

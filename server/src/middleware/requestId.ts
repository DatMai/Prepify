import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const supplied = req.get('x-request-id');
  const value = supplied && UUID_PATTERN.test(supplied) ? supplied : randomUUID();

  res.locals.requestId = value;
  res.setHeader('x-request-id', value);
  next();
}

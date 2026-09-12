import type { CookieOptions, Request, Response } from 'express';

export function sessionCookieOptions(secure: boolean, maxAge?: number): CookieOptions {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge }),
  };
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    if (key !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function setSessionCookie(
  res: Response,
  name: string,
  token: string,
  secure: boolean,
  maxAge: number,
): void {
  res.cookie(name, token, sessionCookieOptions(secure, maxAge));
}

export function clearSessionCookie(res: Response, name: string, secure: boolean): void {
  res.clearCookie(name, sessionCookieOptions(secure));
}

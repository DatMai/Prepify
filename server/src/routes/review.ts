import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { dateInTimeZone } from '../modules/learning/streak';
import {
  applyGrade,
  type ReviewQuality,
  type ReviewSchedule,
} from '../modules/review/scheduler';
import type { ReviewRepository } from '../modules/review/reviewRepository';

interface ReviewRouterDeps {
  repo: ReviewRepository;
  requireAuth: RequestHandler;
  timeZone: string;
  recordStudyDay: (userId: string) => Promise<void>;
  now?: () => Date;
}

const gradeSchema = z.object({
  topic: z.string().trim().min(1).max(50),
  sectionIdx: z.number().int().min(0).max(10_000),
  questionIdx: z.number().int().min(0).max(10_000),
  quality: z.enum(['again', 'hard', 'good']),
});

function addDaysIso(todayIso: string, days: number): string {
  const [year, month, day] = todayIso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function localMidnightUtc(dayIso: string, timeZone: string): string {
  const [year, month, day] = dayIso.split('-').map(Number);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const partsOf = (ms: number): Record<string, string> =>
    Object.fromEntries(
      dtf
        .formatToParts(ms)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    );
  const target = Date.UTC(year, month - 1, day);
  let probe = target;
  for (let i = 0; i < 2; i++) {
    const p = partsOf(probe);
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    probe += target - asUtc;
  }
  return new Date(probe).toISOString();
}

export function createReviewRouter(deps: ReviewRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());
  router.use(deps.requireAuth);

  router.get('/due', async (req, res, next) => {
    try {
      const nowIso = now().toISOString();
      const items = await deps.repo.listDue(req.user!.userId, nowIso);
      res.json({ count: items.length, items });
    } catch (error) {
      next(error);
    }
  });

  router.post('/grade', async (req, res, next) => {
    const parsed = gradeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid review grade', code: 'invalid_request' });
      return;
    }
    try {
      const { topic, sectionIdx, questionIdx, quality } = parsed.data;
      const userId = req.user!.userId;

      const current = await deps.repo.find(userId, topic, sectionIdx, questionIdx);
      const today = dateInTimeZone(now(), deps.timeZone);
      const next = applyGrade(current, quality, today);
      const dueAt = localMidnightUtc(addDaysIso(today, next.intervalDays), deps.timeZone);
      const saved = await deps.repo.upsert({ userId, ...next, dueAt });
      await deps.recordStudyDay(userId);

      res.json({ schedule: saved });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export type { ReviewQuality, ReviewSchedule };

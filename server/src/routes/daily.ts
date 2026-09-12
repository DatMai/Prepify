import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  createDailyChallengeCodec,
  type DailyAnswerKey,
  type DailySubmission,
} from '../modules/daily/dailyChallenge';
import { computeStreak, dateInTimeZone } from '../modules/learning/streak';
import { blocksToText, type Block } from '../modules/library/libraryBlocks';
import type { LibraryRepository, Locale } from '../modules/library/libraryRepository';

interface QueryResult<Row> {
  rows: Row[];
}
type PublicDailyQuestion =
  | { id: string; type: 'mcq'; q: string; options: Array<{ text: string; idx: number }> }
  | { id: string; type: 'fib'; prompt: string; blankCount: number; hint?: string; topic?: string };

export interface DailyQuery {
  <Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<QueryResult<Row>>;
}

interface DailyRouterDependencies {
  query: DailyQuery;
  repo: LibraryRepository;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  secret: string;
  timeZone: string;
  recordStudyDay: (userId: string) => Promise<void>;
}

const completionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  challenge: z.string().min(1).max(20_000),
  answers: z
    .array(
      z.union([
        z.object({ questionId: z.string().min(1), selectedIdx: z.number().int().min(0).max(20) }),
        z.object({ questionId: z.string().min(1), blanks: z.array(z.string().max(500)).max(20) }),
      ]),
    )
    .max(20),
});

function dailySeed(date: string): number {
  let hash = 0;
  for (const character of date) hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function pickDaily<T>(pool: T[], date: string, count = 5): T[] {
  const shuffled = [...pool];
  let seed = dailySeed(date);
  for (let index = shuffled.length - 1; index > 0; index--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const selected = seed % (index + 1);
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function resolveLocale(value: unknown): Locale | null {
  if (value === undefined || value === 'vi') return 'vi';
  if (value === 'en') return 'en';
  return null;
}

function generateMcqOptions(correctText: string, siblingBlocks: Block[][]) {
  const distractors: string[] = [];
  for (const blocks of siblingBlocks) {
    const text = blocksToText(blocks);
    if (text && text !== correctText && text.length >= 20) distractors.push(text.slice(0, 120));
    if (distractors.length >= 6) break;
  }
  const candidates = [
    { text: correctText.slice(0, 120), correct: true },
    ...distractors
      .sort(() => 0.5 - Math.random())
      .slice(0, 3)
      .map((text) => ({ text, correct: false })),
  ].sort(() => 0.5 - Math.random());
  return {
    options: candidates.map(({ text }, idx) => ({ text, idx })),
    correctIdx: candidates.findIndex((option) => option.correct),
  };
}

function streakSummary(rows: Array<{ activity_date: string }>, today: string) {
  const streak = computeStreak(
    rows.map((row) => row.activity_date),
    today,
  );
  return { current: streak.current, longest: streak.longest };
}

export function createDailyRouter(deps: DailyRouterDependencies): Router {
  const router = Router();
  const codec = createDailyChallengeCodec(deps.secret);

  router.get('/', deps.requireAuth, deps.requireAdmin, async (req, res) => {
    const date = dateInTimeZone(new Date(), deps.timeZone);
    const locale = resolveLocale(req.query.lang);
    if (!locale) {
      res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
      return;
    }

    const entries = await deps.repo.listDailyEntries({ locale });
    const answerKeys: DailyAnswerKey[] = [];
    const questions: PublicDailyQuestion[] = [];

    for (const entry of pickDaily(entries, date)) {
      if (entry.type === 'fib') {
        if (!entry.prompt || !entry.blanks) continue;
        answerKeys.push({ id: entry.entryId, type: 'fib', blanks: entry.blanks });
        questions.push({
          id: entry.entryId,
          type: 'fib',
          prompt: entry.prompt,
          blankCount: entry.blanks.length,
          hint: entry.hint ?? undefined,
          topic: entry.topicKey ?? undefined,
        });
        continue;
      }
      if (!entry.questionId || !entry.topicKey) continue;
      const question = await deps.repo.getQuestion({ questionId: entry.questionId });
      if (!question) continue;
      const correctText = blocksToText(question.blocks);
      if (!correctText) continue;
      const siblingBlocks = await deps.repo.listSiblingBlocks({
        topicKey: entry.topicKey,
        locale,
        excludeQuestionId: entry.questionId,
      });
      const { options, correctIdx } = generateMcqOptions(correctText, siblingBlocks);
      answerKeys.push({ id: entry.entryId, type: 'mcq', correctIdx });
      questions.push({ id: entry.entryId, type: 'mcq', q: question.questionText, options });
    }

    const challenge = codec.seal({ userId: req.user!.userId, date, answers: answerKeys });
    res.json({ date, challenge, questions });
  });

  router.get('/status', deps.requireAuth, async (req, res) => {
    const date = dateInTimeZone(new Date(), deps.timeZone);
    const userId = req.user!.userId;
    const completion = await deps.query<{ score: number; total: number; completed_at: string }>(
      'SELECT score, total, completed_at FROM daily_completions WHERE user_id = $1 AND challenge_date = $2::date',
      [userId, date],
    );
    if (completion.rows.length === 0) {
      res.json({ completedToday: false });
      return;
    }
    const studyDays = await deps.query<{ activity_date: string }>(
      'SELECT activity_date::text FROM study_days WHERE user_id = $1 ORDER BY activity_date DESC',
      [userId],
    );
    res.json({
      completedToday: true,
      score: completion.rows[0].score,
      total: completion.rows[0].total,
      completedAt: completion.rows[0].completed_at,
      currentStreak: streakSummary(studyDays.rows, date).current,
    });
  });

  router.post('/complete', deps.requireAuth, async (req, res) => {
    const parsed = completionSchema.safeParse(req.body);
    const today = dateInTimeZone(new Date(), deps.timeZone);
    if (!parsed.success || parsed.data.date !== today) {
      res.status(400).json({ error: 'Invalid daily submission', code: 'invalid_submission' });
      return;
    }
    let grade: { score: number; total: number };
    try {
      grade = codec.grade(
        parsed.data.challenge,
        req.user!.userId,
        today,
        parsed.data.answers as DailySubmission[],
      );
    } catch {
      res.status(400).json({ error: 'Invalid daily challenge', code: 'invalid_challenge' });
      return;
    }
    if (grade.total === 0 || grade.total > 5) {
      res.status(400).json({ error: 'Invalid daily challenge', code: 'invalid_challenge' });
      return;
    }
    try {
      await deps.query(
        'INSERT INTO daily_completions (user_id, challenge_date, score, total) VALUES ($1, $2::date, $3, $4)',
        [req.user!.userId, today, grade.score, grade.total],
      );
    } catch (error: unknown) {
      if ((error as { code?: string }).code === '23505') {
        res
          .status(409)
          .json({ error: 'Daily challenge already completed', code: 'already_completed' });
        return;
      }
      throw error;
    }
    await deps.recordStudyDay(req.user!.userId);
    const studyDays = await deps.query<{ activity_date: string }>(
      'SELECT activity_date::text FROM study_days WHERE user_id = $1 ORDER BY activity_date DESC',
      [req.user!.userId],
    );
    const streak = streakSummary(studyDays.rows, today);
    res.json({ ok: true, ...grade, streak });
  });

  return router;
}

import fs from 'node:fs';
import path from 'node:path';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  createDailyChallengeCodec,
  type DailyAnswerKey,
  type DailySubmission,
} from '../modules/daily/dailyChallenge';

interface McqRef {
  topicKey: string;
  sectionIdx: number;
  questionIdx: number;
}
interface PoolEntry {
  id: string;
  type: 'mcq' | 'fib' | 'match';
  difficulty: number;
  ref?: McqRef;
  topic?: string;
  prompt?: string;
  blanks?: string[];
  hint?: string;
}
interface DailyPool {
  version: number;
  pool: PoolEntry[];
}
interface QuestionBlock {
  type: string;
  text?: string;
}
interface QuizQuestion {
  q: string;
  blocks: QuestionBlock[];
}
interface QuizTopic {
  sections: Array<{ questions: QuizQuestion[] }>;
}
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
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
  secret: string;
  timeZone: string;
  contentDir: string;
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

function dateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function dailySeed(date: string): number {
  let hash = 0;
  for (const character of date) hash = (Math.imul(31, hash) + character.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function pickDaily(pool: PoolEntry[], date: string, count = 5): PoolEntry[] {
  const shuffled = [...pool];
  let seed = dailySeed(date);
  for (let index = shuffled.length - 1; index > 0; index--) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const selected = seed % (index + 1);
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function localizedContentDir(contentDir: string, lang: unknown): string | null {
  if (lang === undefined || lang === 'vi') return contentDir;
  if (lang === 'en') return path.join(contentDir, 'en');
  return null;
}

function loadTopic(topicKey: string, root: string): QuizTopic | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, `${topicKey}.json`), 'utf8')) as QuizTopic;
  } catch {
    return null;
  }
}

function resolveQuestion(ref: McqRef, root: string): QuizQuestion | null {
  return (
    loadTopic(ref.topicKey, root)?.sections[ref.sectionIdx]?.questions[ref.questionIdx] ?? null
  );
}

function extractTextFromBlocks(blocks: QuestionBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text ?? '')
    .join(' ');
}

function generateMcqOptions(correctText: string, topicKey: string, root: string) {
  const distractors: string[] = [];
  const topic = loadTopic(topicKey, root);
  if (topic) {
    for (const section of topic.sections) {
      for (const question of section.questions) {
        const text = extractTextFromBlocks(question.blocks);
        if (text && text !== correctText && text.length >= 20) distractors.push(text.slice(0, 120));
        if (distractors.length >= 6) break;
      }
      if (distractors.length >= 6) break;
    }
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
  const dayMs = 86_400_000;
  const toUtc = (value: string) =>
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10)));
  const dates = rows.map((row) => toUtc(row.activity_date));
  const todayTs = toUtc(today);
  let current = 0;
  if (dates.length > 0 && (dates[0] === todayTs || dates[0] === todayTs - dayMs)) {
    let expected = dates[0];
    for (const value of dates) {
      if (value !== expected) break;
      current++;
      expected -= dayMs;
    }
  }
  let longest = 0;
  let run = 0;
  for (let index = 0; index < dates.length; index++) {
    run = index > 0 && dates[index - 1] - dates[index] === dayMs ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  return { current, longest };
}

export function createDailyRouter(deps: DailyRouterDependencies): Router {
  const router = Router();
  const codec = createDailyChallengeCodec(deps.secret);

  router.get('/', deps.requireAuth, deps.requireAdmin, (req, res) => {
    const date = dateInTimeZone(new Date(), deps.timeZone);
    const localizedDir = localizedContentDir(deps.contentDir, req.query.lang);
    if (!localizedDir) {
      res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
      return;
    }
    let pool: DailyPool;
    try {
      pool = JSON.parse(
        fs.readFileSync(path.join(localizedDir, 'daily.json'), 'utf8'),
      ) as DailyPool;
    } catch {
      res.status(500).json({ error: 'Daily pool not found', code: 'daily_pool_missing' });
      return;
    }

    const answerKeys: DailyAnswerKey[] = [];
    const questions = pickDaily(
      pool.pool.filter((entry) => entry.type !== 'match'),
      date,
    ).flatMap<PublicDailyQuestion>((entry) => {
      if (entry.type === 'fib' && entry.prompt && entry.blanks) {
        answerKeys.push({ id: entry.id, type: 'fib', blanks: entry.blanks });
        return [
          {
            id: entry.id,
            type: 'fib' as const,
            prompt: entry.prompt,
            blankCount: entry.blanks.length,
            hint: entry.hint,
            topic: entry.topic,
          },
        ];
      }
      if (entry.type !== 'mcq' || !entry.ref) return [];
      const question = resolveQuestion(entry.ref, localizedDir);
      if (!question) return [];
      const correctText = extractTextFromBlocks(question.blocks);
      if (!correctText) return [];
      const { options, correctIdx } = generateMcqOptions(
        correctText,
        entry.ref.topicKey,
        localizedDir,
      );
      answerKeys.push({ id: entry.id, type: 'mcq', correctIdx });
      return [{ id: entry.id, type: 'mcq' as const, q: question.q, options }];
    });

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

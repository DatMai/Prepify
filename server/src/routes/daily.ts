import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { Pool } from 'pg';
import { db } from '../db/client';
import { requireAuth } from '../middleware/auth';
import { recordStudyDay } from './streak';

const router = Router();

// ─── Types ───────────────────────────────────────────────────────────────────

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

interface QuizSection {
  questions: QuizQuestion[];
}

interface QuizTopic {
  sections: QuizSection[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dailySeed(dateStr: string): number {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) {
    h = Math.imul(31, h) + dateStr.charCodeAt(i) | 0;
  }
  return Math.abs(h);
}

function pickDaily(pool: PoolEntry[], dateStr: string, count = 5): PoolEntry[] {
  const seed = dailySeed(dateStr);
  const shuffled = [...pool];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

const contentDir = path.resolve(__dirname, '../../..', 'content');

function loadTopic(topicKey: string): QuizTopic | null {
  try {
    const filePath = path.join(contentDir, `${topicKey}.json`);
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as QuizTopic;
  } catch {
    return null;
  }
}

function resolveQuestion(ref: McqRef): QuizQuestion | null {
  const topic = loadTopic(ref.topicKey);
  if (!topic) return null;
  const section = topic.sections[ref.sectionIdx];
  if (!section) return null;
  const question = section.questions[ref.questionIdx];
  return question ?? null;
}

function extractTextFromBlocks(blocks: QuestionBlock[]): string {
  return blocks
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join(' ');
}

function generateMcqOptions(
  correctText: string,
  topicKey: string,
): Array<{ text: string; idx: number }> {
  const topic = loadTopic(topicKey);
  const distractors: string[] = [];

  if (topic) {
    for (let si = 0; si < topic.sections.length && distractors.length < 6; si++) {
      const section = topic.sections[si];
      for (let qi = 0; qi < section.questions.length && distractors.length < 6; qi++) {
        const q = section.questions[qi];
        const txt = extractTextFromBlocks(q.blocks);
        if (txt && txt !== correctText && txt.length >= 20) {
          distractors.push(txt.slice(0, 120));
        }
      }
    }
  }

  const shuffledDistractors = distractors.sort(() => 0.5 - Math.random()).slice(0, 3);
  const options = [
    { text: correctText.slice(0, 120), isCorrect: true },
    ...shuffledDistractors.map((t) => ({ text: t, isCorrect: false })),
  ].sort(() => 0.5 - Math.random());

  const correctIdx = options.findIndex((o) => o.isCorrect);
  return options.map((o, i) => ({ text: o.text, idx: i, _correct: i === correctIdx })) as Array<{ text: string; idx: number }>;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /daily:
 *   get:
 *     summary: Lấy 5 câu hỏi daily challenge hôm nay
 *     tags: [Daily]
 *     responses:
 *       200:
 *         description: Daily questions
 */
router.get('/', (_req, res) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  const poolPath = path.join(contentDir, 'daily.json');

  let dailyPool: DailyPool;
  try {
    dailyPool = JSON.parse(fs.readFileSync(poolPath, 'utf8')) as DailyPool;
  } catch {
    res.status(500).json({ error: 'daily pool not found' });
    return;
  }

  // Filter to only mcq and fib (skip match for MVP)
  const eligible = dailyPool.pool.filter((e) => e.type === 'mcq' || e.type === 'fib');
  const picked = pickDaily(eligible, dateStr, 5);

  type DailyQ =
    | { id: string; type: 'fib'; prompt: string; blankCount: number; blanks: string[]; hint: string | undefined; topic: string | undefined }
    | { id: string; type: 'mcq'; q: string; options: { text: string; idx: number }[]; correctIdx: number };

  const questions: DailyQ[] = picked.flatMap((entry): DailyQ[] => {
    if (entry.type === 'fib') {
      return [{
        id: entry.id,
        type: 'fib' as const,
        prompt: entry.prompt!,
        blankCount: entry.blanks!.length,
        blanks: entry.blanks!,
        hint: entry.hint,
        topic: entry.topic,
      }];
    }

    // MCQ: resolve ref
    if (!entry.ref) return [];
    const question = resolveQuestion(entry.ref);
    if (!question) return [];

    const correctText = extractTextFromBlocks(question.blocks);
    if (!correctText) return [];

    const options = generateMcqOptions(correctText, entry.ref.topicKey);
    const correctIdx = options.findIndex((o) => (o as { text: string; idx: number; _correct?: boolean })._correct);
    const cleanOptions = options.map(({ text, idx }) => ({ text, idx }));

    return [{
      id: entry.id,
      type: 'mcq' as const,
      q: question.q,
      options: cleanOptions,
      correctIdx: correctIdx >= 0 ? correctIdx : 0,
    }];
  });

  res.json({ date: dateStr, questions });
});

/**
 * @swagger
 * /daily/status:
 *   get:
 *     summary: Kiểm tra trạng thái daily challenge hôm nay (auth required)
 *     tags: [Daily]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: Daily status
 *       401:
 *         description: Chưa đăng nhập
 */
router.get('/status', requireAuth, async (req, res) => {
  const dateStr = new Date().toISOString().slice(0, 10);
  const userId = req.user!.userId;

  const { rows } = await db.query<{
    score: number;
    total: number;
    completed_at: string;
  }>(
    `SELECT score, total, completed_at FROM daily_completions
     WHERE user_id = $1 AND challenge_date = $2::date`,
    [userId, dateStr],
  );

  if (rows.length === 0) {
    res.json({ completedToday: false });
    return;
  }

  const { rows: streakRows } = await db.query<{ activity_date: string }>(
    `SELECT activity_date::text FROM study_days WHERE user_id = $1 ORDER BY activity_date DESC`,
    [userId],
  );

  const msPerDay = 86400000;
  const toUtcTs = (s: string) => Date.UTC(
    parseInt(s.slice(0, 4), 10),
    parseInt(s.slice(5, 7), 10) - 1,
    parseInt(s.slice(8, 10), 10),
  );
  const todayTs = toUtcTs(dateStr);
  const dateTs = streakRows.map((r) => toUtcTs(r.activity_date));

  let current = 0;
  if (dateTs.length > 0 && (dateTs[0] === todayTs || dateTs[0] === todayTs - msPerDay)) {
    let expected = dateTs[0];
    for (const ts of dateTs) {
      if (ts === expected) { current++; expected -= msPerDay; } else break;
    }
  }

  res.json({
    completedToday: true,
    score: rows[0].score,
    total: rows[0].total,
    completedAt: rows[0].completed_at,
    currentStreak: current,
  });
});

/**
 * @swagger
 * /daily/complete:
 *   post:
 *     summary: Submit kết quả daily challenge (auth required)
 *     tags: [Daily]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [date, score, total]
 *             properties:
 *               date:  { type: string, example: "2026-05-30" }
 *               score: { type: integer }
 *               total: { type: integer }
 *     responses:
 *       200:
 *         description: Lưu thành công
 *       400:
 *         description: Validation error
 *       401:
 *         description: Chưa đăng nhập
 *       409:
 *         description: Đã hoàn thành hôm nay
 */
router.post('/complete', requireAuth, async (req, res) => {
  const { date, score, total } = req.body as { date?: string; score?: number; total?: number };
  const todayStr = new Date().toISOString().slice(0, 10);
  const userId = req.user!.userId;

  if (typeof date !== 'string' || date !== todayStr) {
    res.status(400).json({ error: 'date phải là ngày hôm nay (UTC)' });
    return;
  }
  if (typeof score !== 'number' || typeof total !== 'number' || score < 0 || total <= 0 || score > total || total > 5) {
    res.status(400).json({ error: 'score/total không hợp lệ' });
    return;
  }

  try {
    await db.query(
      `INSERT INTO daily_completions (user_id, challenge_date, score, total)
       VALUES ($1, $2::date, $3, $4)`,
      [userId, todayStr, score, total],
    );
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      res.status(409).json({ error: 'Đã hoàn thành daily challenge hôm nay' });
      return;
    }
    throw err;
  }

  await recordStudyDay(userId, db as unknown as Pool);

  // Compute streak for response
  const { rows } = await db.query<{ activity_date: string }>(
    `SELECT activity_date::text FROM study_days WHERE user_id = $1 ORDER BY activity_date DESC`,
    [userId],
  );

  const msPerDay = 86400000;
  const toUtcTs = (s: string) => Date.UTC(
    parseInt(s.slice(0, 4), 10), parseInt(s.slice(5, 7), 10) - 1, parseInt(s.slice(8, 10), 10),
  );
  const dateTs = rows.map((r) => toUtcTs(r.activity_date));
  const todayTs = toUtcTs(todayStr);

  let current = 0;
  let longest = 0;
  if (dateTs.length > 0 && (dateTs[0] === todayTs || dateTs[0] === todayTs - msPerDay)) {
    let expected = dateTs[0];
    for (const ts of dateTs) {
      if (ts === expected) { current++; expected -= msPerDay; } else break;
    }
  }
  let run = 0;
  for (let i = 0; i < dateTs.length; i++) {
    if (i === 0) { run = 1; continue; }
    const diff = (dateTs[i - 1] - dateTs[i]) / msPerDay;
    run = diff === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  longest = Math.max(longest, run);

  res.json({ ok: true, streak: { current, longest } });
});

export default router;

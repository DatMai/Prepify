interface ReviewQuery {
  <Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

export interface ReviewScheduleRow {
  topic: string;
  sectionIdx: number;
  questionIdx: number;
  intervalDays: number;
  ease: number;
  reviewCount: number;
  dueAt: string;
}

export interface ReviewScheduleInput extends ReviewScheduleRow {
  userId: string;
}

interface ReviewScheduleRecord extends Record<string, unknown> {
  topic: string;
  section_idx: number;
  question_idx: number;
  interval_days: number;
  ease: number;
  review_count: number;
  due_at: string;
}

function mapRow(row: ReviewScheduleRecord): ReviewScheduleRow {
  return {
    topic: row.topic,
    sectionIdx: row.section_idx,
    questionIdx: row.question_idx,
    intervalDays: row.interval_days,
    ease: row.ease,
    reviewCount: row.review_count,
    dueAt: row.due_at,
  };
}

const SELECT_COLUMNS = `
  topic,
  section_idx,
  question_idx,
  interval_days,
  ease,
  review_count,
  due_at`;

export function createReviewRepository(deps: { query: ReviewQuery }) {
  return {
    async find(
      userId: string,
      topic: string,
      sectionIdx: number,
      questionIdx: number,
    ): Promise<ReviewScheduleRow | null> {
      const { rows } = await deps.query<ReviewScheduleRecord>(
        `SELECT ${SELECT_COLUMNS} FROM review_schedules
         WHERE user_id = $1 AND topic = $2 AND section_idx = $3 AND question_idx = $4`,
        [userId, topic, sectionIdx, questionIdx],
      );
      return rows.length > 0 ? mapRow(rows[0]) : null;
    },

    async upsert(input: ReviewScheduleInput): Promise<ReviewScheduleRow> {
      const { rows } = await deps.query<ReviewScheduleRecord>(
        `INSERT INTO review_schedules
           (user_id, topic, section_idx, question_idx, interval_days, ease, due_at, review_count, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, NOW())
         ON CONFLICT (user_id, topic, section_idx, question_idx)
         DO UPDATE SET
           interval_days = EXCLUDED.interval_days,
           ease = EXCLUDED.ease,
           due_at = EXCLUDED.due_at,
           review_count = EXCLUDED.review_count,
           updated_at = NOW()
         RETURNING ${SELECT_COLUMNS}`,
        [
          input.userId,
          input.topic,
          input.sectionIdx,
          input.questionIdx,
          input.intervalDays,
          input.ease,
          input.dueAt,
          input.reviewCount,
        ],
      );
      return mapRow(rows[0]);
    },

    async listDue(userId: string, nowIso: string): Promise<ReviewScheduleRow[]> {
      const { rows } = await deps.query<ReviewScheduleRecord>(
        `SELECT ${SELECT_COLUMNS} FROM review_schedules
         WHERE user_id = $1 AND due_at <= $2
         ORDER BY due_at ASC`,
        [userId, nowIso],
      );
      return rows.map(mapRow);
    },
  };
}

export type ReviewRepository = ReturnType<typeof createReviewRepository>;

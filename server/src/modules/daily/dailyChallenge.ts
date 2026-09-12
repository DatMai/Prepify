import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export type DailyAnswerKey =
  { id: string; type: 'mcq'; correctIdx: number } | { id: string; type: 'fib'; blanks: string[] };

export type DailySubmission =
  { questionId: string; selectedIdx: number } | { questionId: string; blanks: string[] };

interface ChallengePayload {
  userId: string;
  date: string;
  answers: DailyAnswerKey[];
}

function normalizeAnswer(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

function invalidChallenge(): Error {
  return new Error('Invalid challenge');
}

function isPayload(value: unknown): value is ChallengePayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<ChallengePayload>;
  return (
    typeof payload.userId === 'string' &&
    typeof payload.date === 'string' &&
    Array.isArray(payload.answers) &&
    payload.answers.every((answer) => {
      if (!answer || typeof answer !== 'object') return false;
      if (typeof answer.id !== 'string') return false;
      if (answer.type === 'mcq') return Number.isInteger(answer.correctIdx);
      return answer.type === 'fib' && answer.blanks.every((blank) => typeof blank === 'string');
    })
  );
}

export function createDailyChallengeCodec(
  secret: string,
  createIv: () => Buffer = () => randomBytes(12),
) {
  const key = createHash('sha256').update(secret).digest();

  return {
    seal(payload: ChallengePayload): string {
      const iv = createIv();
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
      ]);
      return [iv, cipher.getAuthTag(), encrypted]
        .map((part) => part.toString('base64url'))
        .join('.');
    },

    grade(
      token: string,
      userId: string,
      date: string,
      submissions: DailySubmission[],
    ): { score: number; total: number } {
      try {
        const parts = token.split('.');
        if (parts.length !== 3) throw invalidChallenge();
        const [ivEncoded, tagEncoded, encryptedEncoded] = parts;
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64url'));
        decipher.setAuthTag(Buffer.from(tagEncoded, 'base64url'));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(encryptedEncoded, 'base64url')),
          decipher.final(),
        ]).toString('utf8');
        const payload: unknown = JSON.parse(plaintext);
        if (!isPayload(payload) || payload.userId !== userId || payload.date !== date) {
          throw invalidChallenge();
        }

        const submittedById = new Map(submissions.map((answer) => [answer.questionId, answer]));
        const score = payload.answers.reduce((total, expected) => {
          const actual = submittedById.get(expected.id);
          if (!actual) return total;
          if (expected.type === 'mcq' && 'selectedIdx' in actual) {
            return total + Number(actual.selectedIdx === expected.correctIdx);
          }
          if (expected.type === 'fib' && 'blanks' in actual) {
            const correct =
              actual.blanks.length === expected.blanks.length &&
              expected.blanks.every(
                (blank, index) =>
                  normalizeAnswer(actual.blanks[index] ?? '') === normalizeAnswer(blank),
              );
            return total + Number(correct);
          }
          return total;
        }, 0);

        return { score, total: payload.answers.length };
      } catch {
        throw invalidChallenge();
      }
    },
  };
}

export interface McqOption {
  text: string;
  idx: number;
}

export interface McqDailyQuestion {
  id: string;
  type: 'mcq';
  q: string;
  options: McqOption[];
}

export interface FibDailyQuestion {
  id: string;
  type: 'fib';
  prompt: string;
  blankCount: number;
  hint?: string;
  topic?: string;
}

export type DailyQuestion = McqDailyQuestion | FibDailyQuestion;

export interface DailyResponse {
  date: string;
  challenge: string;
  questions: DailyQuestion[];
}

export type DailyAnswer =
  { questionId: string; selectedIdx: number } | { questionId: string; blanks: string[] };

export interface DailySession {
  date: string;
  challenge: string;
  questions: DailyQuestion[];
  answers: DailyAnswer[];
  currentIdx: number;
}

export interface DailyStatus {
  completedToday: boolean;
  score?: number;
  total?: number;
  completedAt?: string;
  currentStreak?: number;
}

export interface DailyCompleteResponse {
  ok: boolean;
  score: number;
  total: number;
  streak: { current: number; longest: number };
}

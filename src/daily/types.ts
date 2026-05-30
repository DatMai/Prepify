export interface McqOption {
  text: string;
  idx: number;
}

export interface McqDailyQuestion {
  id: string;
  type: 'mcq';
  q: string;
  options: McqOption[];
  correctIdx: number;
}

export interface FibDailyQuestion {
  id: string;
  type: 'fib';
  prompt: string;
  blankCount: number;
  blanks: string[];
  hint?: string;
  topic?: string;
}

export type DailyQuestion = McqDailyQuestion | FibDailyQuestion;

export interface DailyResponse {
  date: string;
  questions: DailyQuestion[];
}

export interface DailyAnswer {
  questionId: string;
  correct: boolean;
}

export interface DailySession {
  date: string;
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
  streak: { current: number; longest: number };
}

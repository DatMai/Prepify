export type QuizMode = 'flashcard' | 'mcq';
export type QuestionSet = 'all' | 'unlearned' | 'random';
export type FlashcardGrade = 1 | 2 | 3;

export interface QuizConfig {
  topicKey: string;
  mode: QuizMode;
  questionSet: QuestionSet;
  randomCount: number;
}

export interface SessionQuestion {
  topicKey: string;
  sectionIdx: number;
  questionIdx: number;
  progressKey: string;
}

export interface SessionAnswer {
  grade?: FlashcardGrade;
  selectedIdx?: number;
  correctIdx?: number;
  isCorrect?: boolean;
}

export interface QuizSession {
  config: QuizConfig;
  questions: SessionQuestion[];
  currentIdx: number;
  answers: Record<string, SessionAnswer>;
  startedAt: number;
}

export interface McqOption {
  text: string;
  fullText: string;
}

export interface McqData {
  options: McqOption[];
  correctIdx: number;
}

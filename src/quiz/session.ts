import type { TextBlock } from '../types/quiz';
import { DATA } from '../data/loader';
import { keyOf, state } from '../state/progress';

export type QuizMode = 'flashcard' | 'mcq';
export type QuestionSet = 'all' | 'unlearned' | 'random20';
export type FlashcardResult = 'know' | 'unsure' | 'nope';
export type McqResult = 'correct' | 'wrong';
export type QuizResult = FlashcardResult | McqResult | null;

export interface QuizItem {
  topicKey: string;
  sIdx: number;
  qIdx: number;
  question: import('../types/quiz').Question;
  progressKey: string;
  hasMcq: boolean;
}

export interface McqOption {
  text: string;
  correct: boolean;
}

export interface QuizSession {
  topic: string;
  mode: QuizMode;
  items: QuizItem[];
  currentIdx: number;
  results: QuizResult[];
}

export function buildSession(topic: string, mode: QuizMode, set: QuestionSet): QuizSession {
  const t = DATA[topic];
  if (!t) throw new Error('Unknown topic: ' + topic);

  const allItems: QuizItem[] = [];
  t.sections.forEach((sec, si) => {
    sec.questions.forEach((q, qi) => {
      const hasMcq = q.blocks.some(
        b => b.type === 'text' && (b as TextBlock).text.length >= 20,
      );
      allItems.push({
        topicKey: topic,
        sIdx: si,
        qIdx: qi,
        question: q,
        progressKey: keyOf(topic, si, qi),
        hasMcq,
      });
    });
  });

  let filtered: QuizItem[];
  if (set === 'unlearned') {
    const unlearned = allItems.filter(item => !state.progress[item.progressKey]);
    filtered = unlearned.length > 0 ? unlearned : allItems;
  } else {
    filtered = allItems;
  }

  const shuffled = [...filtered].sort(() => Math.random() - 0.5);
  const items = set === 'random20' ? shuffled.slice(0, Math.min(20, shuffled.length)) : shuffled;

  return {
    topic,
    mode,
    items,
    currentIdx: 0,
    results: new Array(items.length).fill(null) as QuizResult[],
  };
}

export function getMcqOptions(item: QuizItem): McqOption[] {
  const t = DATA[item.topicKey];
  if (!t) return [];

  const correctBlock = item.question.blocks.find(b => b.type === 'text') as TextBlock | undefined;
  if (!correctBlock) return [];

  const distractors: string[] = [];
  t.sections.forEach((sec, si) => {
    sec.questions.forEach((q, qi) => {
      if (si === item.sIdx && qi === item.qIdx) return;
      const tb = q.blocks.find(b => b.type === 'text') as TextBlock | undefined;
      if (tb && tb.text.length >= 20) distractors.push(tb.text);
    });
  });

  if (distractors.length < 3) return [];

  const shuffledD = [...distractors].sort(() => Math.random() - 0.5).slice(0, 3);
  return [
    { text: correctBlock.text, correct: true },
    ...shuffledD.map(text => ({ text, correct: false })),
  ].sort(() => Math.random() - 0.5);
}

export function countItems(topic: string, set: QuestionSet): number {
  const t = DATA[topic];
  if (!t) return 0;
  if (set === 'all' || set === 'random20') {
    return t.sections.reduce((a, s) => a + s.questions.length, 0);
  }
  let count = 0;
  t.sections.forEach((sec, si) => {
    sec.questions.forEach((_q, qi) => {
      if (!state.progress[keyOf(topic, si, qi)]) count++;
    });
  });
  return count;
}

import { DATA } from '../data/loader';
import { keyOf } from '../state/progress';
import { isMcqEligible } from './mcq';
import type { ProgressMap } from '../types/quiz';
import type { QuizConfig, QuizSession, SessionQuestion } from './types';

export function buildSession(config: QuizConfig, progress: ProgressMap): QuizSession {
  const topic = DATA[config.topicKey];
  let questions: SessionQuestion[] = [];

  topic.sections.forEach((sec, si) => {
    sec.questions.forEach((q, qi) => {
      if (config.mode === 'mcq' && !isMcqEligible(q)) return;
      const key = keyOf(config.topicKey, si, qi);
      questions.push({ topicKey: config.topicKey, sectionIdx: si, questionIdx: qi, progressKey: key });
    });
  });

  if (config.questionSet === 'unlearned') {
    questions = questions.filter(q => !progress[q.progressKey]);
  }

  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }

  if (config.questionSet === 'random') {
    questions = questions.slice(0, config.randomCount);
  }

  return { config, questions, currentIdx: 0, answers: {}, startedAt: Date.now() };
}

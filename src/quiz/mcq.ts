import type { Question } from '../types/quiz';
import type { McqData } from './types';
import { DATA } from '../data/loader';
import { esc } from '../render/escape';
import { blockHTML } from '../render/block';

export function isMcqEligible(q: Question): boolean {
  const t = q.blocks.find(b => b.type === 'text');
  return !!t && t.type === 'text' && t.text.length >= 30;
}

export function generateMcqData(q: Question, topicKey: string): McqData {
  const topic = DATA[topicKey];
  const correctText = (q.blocks.find(b => b.type === 'text')!).text as string;

  const candidates: string[] = [];
  topic.sections.forEach(sec => {
    sec.questions.forEach(candidate => {
      if (candidate === q) return;
      const t = candidate.blocks.find(b => b.type === 'text');
      if (t && t.type === 'text' && t.text.length >= 30) candidates.push(t.text);
    });
  });

  const shuffled = candidates.sort(() => Math.random() - 0.5);
  const distractors = shuffled.slice(0, 3);

  const truncate = (s: string) => s.length > 110 ? s.slice(0, 110) + '…' : s;

  const all = [correctText, ...distractors].map(t => ({ text: truncate(t), fullText: t }));
  all.sort(() => Math.random() - 0.5);
  const correctIdx = all.findIndex(o => o.fullText === correctText);

  return { options: all, correctIdx };
}

export function renderMcq(
  q: Question,
  mcqData: McqData,
  answered: boolean,
  selectedIdx: number,
): string {
  const labels = ['A', 'B', 'C', 'D'];

  const optionsHTML = mcqData.options.map((opt, i) => {
    let cls = 'mcq-option';
    if (answered) {
      if (i === mcqData.correctIdx) cls += ' correct';
      else if (i === selectedIdx) cls += ' wrong';
    }
    return `<button class="${cls}" data-idx="${i}" ${answered ? 'disabled' : ''}>
      <span class="opt-label">${labels[i]}</span>
      <span class="opt-text">${esc(opt.text)}</span>
    </button>`;
  }).join('');

  let resultHTML = '';
  let explanationHTML = '';

  if (answered) {
    const isCorrect = selectedIdx === mcqData.correctIdx;
    resultHTML = `<div class="mcq-result ${isCorrect ? 'ok' : 'bad'}">${isCorrect ? '✓ Đúng rồi!' : '✗ Sai rồi!'}</div>`;
    explanationHTML = `<div class="mcq-explanation">
      ${q.blocks.map((b, bi) => blockHTML(b, 'mcq', bi)).join('')}
    </div>`;
  }

  return `<div class="mcq-view">
    <div class="mcq-question">${esc(q.q)}</div>
    <div class="mcq-options">${optionsHTML}</div>
    ${resultHTML}
    ${explanationHTML}
  </div>`;
}

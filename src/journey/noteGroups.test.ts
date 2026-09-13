import { describe, expect, it } from 'vitest';
import { groupTaskNotes } from './noteGroups';
import type { JourneyBlock, JourneyTask } from './types';

const task = (id: string, text: string): JourneyTask => ({ id, checked: false, text, tags: [] });

const taskLine = (text: string, ordered = false): JourneyBlock => ({
  kind: 'list',
  ordered,
  items: [{ text, checked: false }],
});

const bullets = (texts: string[], ordered = false): JourneyBlock => ({
  kind: 'list',
  ordered,
  items: texts.map((text) => ({ text, checked: null })),
});

const heading = (level: number, text: string): JourneyBlock => ({ kind: 'heading', level, text });

const paragraph = (text: string): JourneyBlock => ({ kind: 'paragraph', text });

describe('groupTaskNotes', () => {
  it('attaches every block between two task lines to the first task', () => {
    const tasks = [task('t1', 'recall array'), task('t2', 'recall unit 2')];
    const blocks: JourneyBlock[] = [
      heading(2, 'Study'),
      paragraph('intro'),
      taskLine('recall array'),
      paragraph('**Array recall**'),
      bullets(['Q1', 'Q2']),
      paragraph('**Hash table recall**'),
      bullets(['Q3']),
      taskLine('recall unit 2'),
      bullets(['Q4']),
      heading(2, 'Journal (English only)'),
      bullets(['private note line']),
    ];

    const groups = groupTaskNotes(blocks, tasks);

    expect(groups.get('t1')).toEqual([
      paragraph('**Array recall**'),
      bullets(['Q1', 'Q2']),
      paragraph('**Hash table recall**'),
      bullets(['Q3']),
    ]);
    expect(groups.get('t2')).toEqual([bullets(['Q4'])]);
  });

  it('drops leading content and everything after the last task section', () => {
    const tasks = [task('t1', 'only task')];
    const blocks: JourneyBlock[] = [
      heading(2, 'Study'),
      paragraph('intro'),
      taskLine('only task'),
      heading(2, 'Bằng chứng'),
      bullets(['evidence line']),
    ];

    const groups = groupTaskNotes(blocks, tasks);

    expect(groups.get('t1')).toBeUndefined();
  });

  it('moves to the next task when one list block carries several task lines', () => {
    const tasks = [task('t1', 'first'), task('t2', 'second')];
    const blocks: JourneyBlock[] = [
      heading(2, 'Study'),
      taskLine('first'),
      {
        kind: 'list',
        ordered: false,
        items: [
          { text: 'recall for the first task', checked: null },
          { text: 'second', checked: true },
          { text: 'recall for the second task', checked: null },
        ],
      },
    ];

    const groups = groupTaskNotes(blocks, tasks);

    expect(groups.get('t1')).toEqual([bullets(['recall for the first task'])]);
    expect(groups.get('t2')).toEqual([bullets(['recall for the second task'])]);
  });

  it('keeps ordered recall lists ordered and does not mutate the source blocks', () => {
    const tasks = [task('t1', 'task')];
    const source = bullets(['one'], true);
    const before = JSON.parse(JSON.stringify(source));

    const groups = groupTaskNotes(
      [heading(2, 'Study'), taskLine('task'), source, bullets(['two'], false)],
      tasks,
    );

    expect(groups.get('t1')).toEqual([bullets(['one'], true), bullets(['two'], false)]);
    expect(source).toEqual(before);
  });
});

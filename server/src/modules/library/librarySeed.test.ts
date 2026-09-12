import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSeedPlan } from './librarySeed';

const REPO_CORPUS = path.resolve(__dirname, '../../../../content');

describe('buildSeedPlan against the real corpus', () => {
  it('reads every indexed topic with sections and questions in file order', () => {
    const plan = buildSeedPlan(REPO_CORPUS, 'vi');

    expect(plan.topics.map((topic) => topic.key)).toEqual([
      'javascript',
      'typescript',
      'nodejs',
      'dsa',
      'oop',
      'os',
      'networking',
      'dbms',
      'system',
    ]);
    const dsa = plan.topics.find((topic) => topic.key === 'dsa');
    expect(dsa?.label).toBe('DSA');
    expect(dsa?.color).toBe('#B71C1C');
    expect(dsa?.position).toBe(3);
    expect(dsa?.sections.reduce((sum, section) => sum + section.questions.length, 0)).toBe(58);
    expect(dsa?.sections[0]?.questions[0]?.code).toBe('Q1');
    expect(dsa?.sections[0]?.questions[0]?.prompt).toBe('Array là gì? Ưu và nhược điểm?');
    expect(plan.warnings).toEqual([]);
  });

  it('carries the Daily pool with positional refs and no level guessing', () => {
    const plan = buildSeedPlan(REPO_CORPUS, 'vi');

    expect(plan.locale).toBe('vi');
    expect(plan.daily).toHaveLength(35);
    expect(plan.daily.filter((entry) => entry.type === 'mcq')).toHaveLength(20);
    expect(plan.daily.filter((entry) => entry.type === 'fib')).toHaveLength(15);
    const first = plan.daily.find((entry) => entry.entryId === 'd-mcq-001');
    expect(first?.ref).toEqual({ topicKey: 'javascript', sectionIdx: 0, questionIdx: 0 });
    const fib = plan.daily.find((entry) => entry.type === 'fib');
    expect(fib?.prompt).toBeTruthy();
    expect(fib?.blanks?.length).toBeGreaterThan(0);
    // Questions never carry a level: the corpus has none, and the seed must not guess.
    expect(
      plan.topics.flatMap((topic) => topic.sections).flatMap((section) => section.questions),
    ).toHaveLength(524);
  });

  it('fails loudly when a topic file breaks the block schema', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepify-seed-'));
    fs.writeFileSync(
      path.join(dir, 'index.json'),
      JSON.stringify([{ key: 'broken', label: 'B', title: 'B', color: '#000000' }]),
    );
    fs.writeFileSync(
      path.join(dir, 'broken.json'),
      JSON.stringify({
        title: 'B',
        sections: [
          {
            name: 'S',
            questions: [{ id: 'Q1', q: 'x', blocks: [{ type: 'image', src: 'nope' }] }],
          },
        ],
      }),
    );
    fs.writeFileSync(path.join(dir, 'daily.json'), JSON.stringify({ version: 1, pool: [] }));

    expect(() => buildSeedPlan(dir, 'vi')).toThrow(/broken.*section 0.*question 0/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('buildSeedPlan warnings', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepify-seed-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function writeCorpus(index: unknown[], topic: unknown, daily: unknown): void {
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
    fs.writeFileSync(path.join(dir, 'x.json'), JSON.stringify(topic));
    fs.writeFileSync(path.join(dir, 'daily.json'), JSON.stringify(daily));
  }

  it('warns when metadata disagrees and lets the index win', () => {
    writeCorpus(
      [{ key: 'x', label: 'IndexLabel', title: 'IndexTitle', color: '#111111' }],
      { label: 'FileLabel', color: '#222222', title: 'FileTitle', sections: [] },
      { version: 1, pool: [] },
    );

    const plan = buildSeedPlan(dir, 'vi');

    expect(plan.topics[0]?.label).toBe('IndexLabel');
    expect(plan.warnings.join(' ')).toMatch(/label|color|title/);
  });

  it('appends a topic that is missing from the index, with a warning', () => {
    writeCorpus(
      [],
      { label: 'L', color: '#333333', title: 'T', sections: [] },
      { version: 1, pool: [] },
    );

    const plan = buildSeedPlan(dir, 'vi');

    expect(plan.topics.map((topic) => topic.key)).toEqual(['x']);
    expect(plan.warnings.join(' ')).toMatch(/not in index/i);
  });
});

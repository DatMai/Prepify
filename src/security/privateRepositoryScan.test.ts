import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('private repository boundary', () => {
  it('does not track the owner corpus', () => {
    const tracked = execFileSync('git', ['ls-files', 'content'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .filter(Boolean);

    expect(tracked).toEqual([]);
  });
});

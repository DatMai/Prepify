import { describe, expect, it } from 'vitest';
import { blockListSchema, blocksToText, MAX_TABLE_COLUMNS } from './libraryBlocks';

describe('libraryBlocks', () => {
  it('accepts every corpus block shape, including table flags', () => {
    const parsed = blockListSchema.safeParse([
      { type: 'text', text: 'hello' },
      { type: 'note', text: 'note' },
      { type: 'code', lang: 'js', text: 'const a = 1;' },
      { type: 'table', rows: [['A', 'B']], headerDone: true, closed: true },
    ]);

    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown block type and an oversized table', () => {
    expect(blockListSchema.safeParse([{ type: 'image', src: 'x' }]).success).toBe(false);
    expect(
      blockListSchema.safeParse([
        {
          type: 'table',
          rows: Array.from({ length: 2 }, () =>
            Array.from({ length: MAX_TABLE_COLUMNS + 1 }, () => 'x'),
          ),
        },
      ]).success,
    ).toBe(false);
  });

  it('concatenates only text blocks and tolerates junk input', () => {
    expect(
      blocksToText([
        { type: 'text', text: 'a' },
        { type: 'code', lang: 'js', text: 'ignored' },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('a b');
    expect(blocksToText(null)).toBe('');
    expect(blocksToText('nope')).toBe('');
  });
});

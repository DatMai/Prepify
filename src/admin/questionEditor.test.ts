import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminBlock } from '../api/client';
import {
  addBlock,
  addTableColumn,
  addTableRow,
  moveBlock,
  removeBlock,
  removeTableColumn,
  removeTableRow,
  setBlockLang,
  setBlockText,
  setTableCell,
} from './blockOps';

vi.mock('../api/client', () => ({
  api: {
    libraryAdmin: {
      createQuestion: vi.fn(),
      updateQuestion: vi.fn(),
    },
  },
}));

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

const text: AdminBlock = { type: 'text', text: 'a' };
const code: AdminBlock = { type: 'code', lang: 'js', text: 'b' };
const table: AdminBlock = { type: 'table', rows: [['A', 'B']] };

describe('block operations', () => {
  it('appends a new block of the requested type with a usable default', () => {
    expect(addBlock([], 'text')).toEqual([{ type: 'text', text: '' }]);
    expect(addBlock([], 'note')).toEqual([{ type: 'note', text: '' }]);
    expect(addBlock([], 'code')).toEqual([{ type: 'code', lang: 'js', text: '' }]);
    // a new table starts as a 2x1 grid so the first cell is typeable straight away
    expect(addBlock([], 'table')).toEqual([{ type: 'table', rows: [['', '']], headerDone: true }]);
  });

  it('never mutates the input array', () => {
    const blocks = [text];
    const next = setBlockText(blocks, 0, 'changed');

    expect(blocks).toEqual([{ type: 'text', text: 'a' }]);
    expect(next).toEqual([{ type: 'text', text: 'changed' }]);
  });

  it('removes and reorders blocks without leaving holes', () => {
    const blocks = [text, code, table];

    expect(removeBlock(blocks, 1)).toEqual([text, table]);
    expect(moveBlock(blocks, 2, -1)).toEqual([text, table, code]);
    expect(moveBlock(blocks, 0, 1)).toEqual([code, text, table]);
  });

  it('ignores an out-of-range move instead of corrupting the list', () => {
    const blocks = [text, code];

    expect(moveBlock(blocks, 0, -1)).toEqual(blocks);
    expect(moveBlock(blocks, 1, 1)).toEqual(blocks);
    expect(moveBlock(blocks, 9, 1)).toEqual(blocks);
  });

  it('edits only the targeted block field', () => {
    expect(setBlockText([text, code], 1, 'z')).toEqual([text, { ...code, text: 'z' }]);
    expect(setBlockLang([code], 0, 'python')).toEqual([{ ...code, lang: 'python' }]);
  });

  it('writes a single table cell', () => {
    const blocks = [table];

    expect(setTableCell(blocks, 0, 0, 1, 'X')).toEqual([{ type: 'table', rows: [['A', 'X']] }]);
  });

  it('grows a table with an empty row or column', () => {
    expect(addTableRow([table], 0)).toEqual([
      {
        type: 'table',
        rows: [
          ['A', 'B'],
          ['', ''],
        ],
      },
    ]);
    expect(addTableColumn([table], 0)).toEqual([{ type: 'table', rows: [['A', 'B', '']] }]);
  });

  it('shrinks a table but never below one row and one column', () => {
    const twoByTwo: AdminBlock = {
      type: 'table',
      rows: [
        ['A', 'B'],
        ['C', 'D'],
      ],
    };

    expect(removeTableRow([twoByTwo], 0)).toEqual([{ type: 'table', rows: [['A', 'B']] }]);
    expect(removeTableColumn([twoByTwo], 0)).toEqual([{ type: 'table', rows: [['A'], ['C']] }]);
    expect(removeTableRow([table], 0)).toEqual([table]);
    expect(removeTableColumn([{ type: 'table', rows: [['A']] }], 0)).toEqual([
      { type: 'table', rows: [['A']] },
    ]);
  });

  it('refuses to grow a table past the server ceilings', () => {
    const wide: AdminBlock = { type: 'table', rows: [Array.from({ length: 10 }, () => 'x')] };
    const tall: AdminBlock = { type: 'table', rows: Array.from({ length: 50 }, () => ['x']) };

    expect(addTableColumn([wide], 0)).toEqual([wide]);
    expect(addTableRow([tall], 0)).toEqual([tall]);
  });

  it('leaves non-table blocks alone when a table operation is applied to them', () => {
    expect(setTableCell([text], 0, 0, 0, 'X')).toEqual([text]);
    expect(addTableRow([text], 0)).toEqual([text]);
  });
});

describe('question editor panel', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = '';
  });

  it('renders one editor row per block and reports the level', async () => {
    const { openQuestionEditor } = await import('./questionEditor');

    openQuestionEditor({
      question: {
        id: 'q-1',
        position: 0,
        code: 'Q1',
        prompt: 'Array là gì?',
        level: 'basic',
        blocks: [{ type: 'text', text: 'answer' }],
      },
      sectionId: 's-1',
      onSaved: vi.fn(),
      onCancel: vi.fn(),
    });

    expect(document.querySelector('[name="prompt"]')).toHaveProperty('value', 'Array là gì?');
    expect(document.querySelector('.qe-level')).toHaveProperty('value', 'basic');
    expect(document.querySelectorAll('.qe-block')).toHaveLength(1);
    expect(document.querySelector('.qe-block-text')).toHaveProperty('value', 'answer');
  });

  it('adds a table block through the toolbar', async () => {
    const { openQuestionEditor } = await import('./questionEditor');

    openQuestionEditor({
      question: null,
      sectionId: 's-1',
      onSaved: vi.fn(),
      onCancel: vi.fn(),
    });
    (document.querySelector('.qe-add-block') as HTMLSelectElement).value = 'table';
    (document.querySelector('.qe-add-block-button') as HTMLButtonElement).click();

    expect(document.querySelectorAll('.qe-block')).toHaveLength(1);
    expect(document.querySelectorAll('.qe-cell')).toHaveLength(2);
  });

  it('creates a question in the given section and reloads through onSaved', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.createQuestion).mockResolvedValue({ id: 'q-9' });
    const { openQuestionEditor } = await import('./questionEditor');
    const onSaved = vi.fn();
    const onCancel = vi.fn();

    openQuestionEditor({ question: null, sectionId: 's-1', onSaved, onCancel });
    (document.querySelector('[name="prompt"]') as HTMLTextAreaElement).value = 'Câu mới';
    (document.querySelector('.qe-save') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(api.libraryAdmin.createQuestion).toHaveBeenCalledWith('s-1', {
      code: null,
      prompt: 'Câu mới',
      level: null,
      blocks: [],
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('keeps the panel open and reports the failure when the save is rejected', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.createQuestion).mockRejectedValue(new Error('boom'));
    const { openQuestionEditor } = await import('./questionEditor');
    const onSaved = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    openQuestionEditor({ question: null, sectionId: 's-1', onSaved, onCancel: vi.fn() });
    (document.querySelector('[name="prompt"]') as HTMLTextAreaElement).value = 'Câu mới';
    (document.querySelector('.qe-save') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(onSaved).not.toHaveBeenCalled();
    expect(document.querySelector('.qe-panel')).not.toBeNull();
    expect(document.querySelector('.toast')?.textContent).toBeTruthy();
  });
});

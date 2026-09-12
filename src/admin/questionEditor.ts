import { api, type AdminBlock, type AdminLevel, type AdminQuestion } from '../api/client';
import { t } from '../i18n';
import { showToast } from '../ui/toast';
import { button, element } from './adminUi';
import {
  addBlock,
  addTableColumn,
  addTableRow,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  moveBlock,
  removeBlock,
  removeTableColumn,
  removeTableRow,
  setBlockLang,
  setBlockText,
  setTableCell,
} from './blockOps';

export interface OpenQuestionEditorInput {
  question: AdminQuestion | null;
  sectionId: string;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}

type TableBlock = Extract<AdminBlock, { type: 'table' }>;

const BLOCK_LABEL_KEY: Record<AdminBlock['type'], string> = {
  text: 'libAdmin.blockText',
  note: 'libAdmin.blockNote',
  code: 'libAdmin.blockCode',
  table: 'libAdmin.blockTable',
};

interface EditorState {
  blocks: AdminBlock[];
}

function levelSelect(
  value: AdminLevel | null,
  onChange: (next: AdminLevel | null) => void,
): HTMLSelectElement {
  const select = element('select', 'qe-level');

  const options: Array<[string, string]> = [
    ['', t('libAdmin.levelNone')],
    ['basic', t('libAdmin.levelBasic')],
    ['intermediate', t('libAdmin.levelIntermediate')],
    ['advanced', t('libAdmin.levelAdvanced')],
  ];
  for (const [raw, label] of options) {
    const option = element('option', 'qe-level-option', label);
    option.value = raw;
    select.appendChild(option);
  }
  select.value = value ?? '';
  select.addEventListener('change', () => {
    onChange((select.value || null) as AdminLevel | null);
  });

  return select;
}

function textArea(
  className: string,
  value: string,
  onInput: (next: string) => void,
): HTMLTextAreaElement {
  const node = element('textarea', className);
  node.value = value;
  node.addEventListener('input', () => onInput(node.value));
  return node;
}

function labeled(label: string, control: HTMLElement): HTMLLabelElement {
  const wrapper = element('label', 'qe-field');
  wrapper.appendChild(element('span', 'qe-field-label', label));
  wrapper.appendChild(control);
  return wrapper;
}

/** Opens the modal editor. `question: null` creates a new question in `sectionId`. */
export function openQuestionEditor(input: OpenQuestionEditorInput): void {
  const state: EditorState = {
    blocks: input.question?.blocks ?? [],
  };

  const overlay = element('div', 'qe-overlay');
  const panel = element('section', 'qe-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('libAdmin.newQuestion'));

  const close = (): void => {
    overlay.remove();
  };

  const head = element('header', 'qe-head');
  head.appendChild(
    element('h3', 'qe-title', input.question ? t('libAdmin.edit') : t('libAdmin.newQuestion')),
  );
  head.appendChild(
    button('qe-close', '✕', () => {
      close();
      input.onCancel();
    }),
  );
  panel.appendChild(head);

  const codeInput = element('input', 'qe-input');
  codeInput.name = 'code';
  codeInput.value = input.question?.code ?? '';
  codeInput.placeholder = t('libAdmin.questionCode');
  panel.appendChild(labeled(t('libAdmin.questionCode'), codeInput));

  const promptInput = textArea('qe-prompt', input.question?.prompt ?? '', () => undefined);
  promptInput.name = 'prompt';
  panel.appendChild(labeled(t('libAdmin.questionPrompt'), promptInput));

  panel.appendChild(
    labeled(
      t('libAdmin.level'),
      levelSelect(input.question?.level ?? null, () => undefined),
    ),
  );

  const blocksTitle = element('h4', 'qe-blocks-title', t('libAdmin.blocksTitle'));
  panel.appendChild(blocksTitle);

  const blocksHost = element('div', 'qe-blocks');
  panel.appendChild(blocksHost);

  const toolbar = element('div', 'qe-toolbar');
  const typePicker = element('select', 'qe-add-block');
  for (const [value, label] of [
    ['text', t('libAdmin.blockText')],
    ['note', t('libAdmin.blockNote')],
    ['code', t('libAdmin.blockCode')],
    ['table', t('libAdmin.blockTable')],
  ] as Array<[AdminBlock['type'], string]>) {
    const option = element('option', 'qe-add-block-option', label);
    option.value = value;
    typePicker.appendChild(option);
  }
  toolbar.appendChild(typePicker);
  toolbar.appendChild(
    button('qe-add-block-button', t('libAdmin.addBlock'), () => {
      state.blocks = addBlock(state.blocks, typePicker.value as AdminBlock['type']);
      renderBlocks();
    }),
  );
  panel.appendChild(toolbar);

  const error = element('p', 'qe-error');
  panel.appendChild(error);

  const footer = element('div', 'qe-footer');
  footer.appendChild(button('qe-save', t('libAdmin.save'), () => void save()));
  footer.appendChild(
    button('qe-cancel', t('libAdmin.cancel'), () => {
      close();
      input.onCancel();
    }),
  );
  panel.appendChild(footer);

  function renderBlocks(): void {
    blocksHost.textContent = '';
    state.blocks.forEach((block, index) => {
      blocksHost.appendChild(renderBlockRow(block, index));
    });
  }

  function renderBlockRow(block: AdminBlock, index: number): HTMLElement {
    const row = element('article', 'qe-block');
    row.dataset.block = String(index);
    row.dataset.type = block.type;

    const header = element('div', 'qe-block-header');
    header.appendChild(element('span', 'qe-block-type', t(BLOCK_LABEL_KEY[block.type])));
    const up = button('qe-block-up', '↑', () => {
      state.blocks = moveBlock(state.blocks, index, -1);
      renderBlocks();
    });
    up.disabled = index === 0;
    const down = button('qe-block-down', '↓', () => {
      state.blocks = moveBlock(state.blocks, index, 1);
      renderBlocks();
    });
    down.disabled = index === state.blocks.length - 1;
    header.append(
      up,
      down,
      button('qe-block-remove', t('libAdmin.remove'), () => {
        state.blocks = removeBlock(state.blocks, index);
        renderBlocks();
      }),
    );
    row.appendChild(header);

    if (block.type === 'table') {
      row.appendChild(renderTable(block, index));
      return row;
    }

    if (block.type === 'code') {
      const lang = element('input', 'qe-input qe-block-lang');
      lang.value = block.lang;
      lang.placeholder = t('libAdmin.blockLang');
      lang.addEventListener('input', () => {
        state.blocks = setBlockLang(state.blocks, index, lang.value);
      });
      row.appendChild(lang);
    }

    row.appendChild(
      textArea('qe-block-text', block.text, (next) => {
        state.blocks = setBlockText(state.blocks, index, next);
      }),
    );
    return row;
  }

  function renderTable(block: TableBlock, index: number): HTMLElement {
    const host = element('div', 'qe-table');
    const width = block.rows[0]?.length ?? 1;
    const head = block.rows[0] ?? [];

    const headRow = element('div', 'qe-table-row');
    head.forEach((cell, column) => {
      const input = element('input', 'qe-input qe-cell');
      input.value = cell;
      input.dataset.row = '0';
      input.dataset.column = String(column);
      input.addEventListener('input', () => {
        state.blocks = setTableCell(state.blocks, index, 0, column, input.value);
      });
      headRow.appendChild(input);
    });
    host.appendChild(headRow);

    block.rows.slice(1).forEach((cells, offset) => {
      const rowIndex = offset + 1;
      const row = element('div', 'qe-table-row');
      for (let column = 0; column < width; column += 1) {
        const input = element('input', 'qe-input qe-cell');
        input.value = cells[column] ?? '';
        input.dataset.row = String(rowIndex);
        input.dataset.column = String(column);
        input.addEventListener('input', () => {
          state.blocks = setTableCell(state.blocks, index, rowIndex, column, input.value);
        });
        row.appendChild(input);
      }
      host.appendChild(row);
    });

    const controls = element('div', 'qe-table-controls');
    const addRow = button('qe-add-row', t('libAdmin.addRow'), () => {
      state.blocks = addTableRow(state.blocks, index);
      renderBlocks();
    });
    addRow.disabled = block.rows.length >= MAX_TABLE_ROWS;
    const removeRow = button('qe-remove-row', t('libAdmin.removeRow'), () => {
      state.blocks = removeTableRow(state.blocks, index);
      renderBlocks();
    });
    removeRow.disabled = block.rows.length <= 1;
    const addColumn = button('qe-add-column', t('libAdmin.addColumn'), () => {
      state.blocks = addTableColumn(state.blocks, index);
      renderBlocks();
    });
    addColumn.disabled = width >= MAX_TABLE_COLUMNS;
    const removeColumn = button('qe-remove-column', t('libAdmin.removeColumn'), () => {
      state.blocks = removeTableColumn(state.blocks, index);
      renderBlocks();
    });
    removeColumn.disabled = width <= 1;
    controls.append(addRow, removeRow, addColumn, removeColumn);
    host.appendChild(controls);

    return host;
  }

  /**
   * Block content lives in `state` because structural edits re-render the list,
   * but the scalar fields are read straight from the DOM at save time so a value
   * that never fired `input` (a paste, an autofill, a programmatic change) is
   * still saved instead of silently submitted empty.
   */
  function collect(): { code: string; prompt: string; level: AdminLevel | null } {
    const codeNode = panel.querySelector('[name="code"]');
    const promptNode = panel.querySelector('[name="prompt"]');
    const levelNode = panel.querySelector('.qe-level');

    return {
      code: codeNode instanceof HTMLInputElement ? codeNode.value : '',
      prompt: promptNode instanceof HTMLTextAreaElement ? promptNode.value : '',
      level:
        levelNode instanceof HTMLSelectElement && levelNode.value
          ? (levelNode.value as AdminLevel)
          : null,
    };
  }

  async function save(): Promise<void> {
    const fields = collect();
    const prompt = fields.prompt.trim();
    if (!prompt) {
      error.textContent = t('libAdmin.questionRequired');
      return;
    }
    error.textContent = '';

    const payload = {
      code: fields.code.trim() || null,
      prompt,
      level: fields.level,
      blocks: state.blocks,
    };

    try {
      if (input.question) await api.libraryAdmin.updateQuestion(input.question.id, payload);
      else await api.libraryAdmin.createQuestion(input.sectionId, payload);
    } catch (caught) {
      console.error(caught);
      showToast(t('libAdmin.saveFailed'), 'error');
      return;
    }

    close();
    showToast(t('libAdmin.saved'), 'ok');
    await input.onSaved();
  }

  renderBlocks();
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

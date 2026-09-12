import { ApiError, api, type AdminDocument, type AdminLevel } from '../api/client';
import { t } from '../i18n';
import { showToast } from '../ui/toast';

export type ImportParseResult =
  | { ok: true; document: AdminDocument; sections: number; questions: number }
  | { ok: false; message: string };

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const BLOCK_TYPES = ['text', 'note', 'code', 'table'] as const;
const LEVELS: AdminLevel[] = ['basic', 'intermediate', 'advanced'];

/** A minimal but complete document, used as the dialog's starting template. */
export const SAMPLE_DOCUMENT: AdminDocument = {
  title: 'Tiêu đề môn học',
  subtitle: 'Mô tả ngắn',
  label: 'Nhãn ngắn',
  color: '#6366f1',
  sections: [
    {
      name: 'Phần I',
      questions: [
        {
          code: 'Q1',
          level: 'basic',
          q: 'Câu hỏi đầu tiên?',
          blocks: [
            { type: 'text', text: 'Câu trả lời.' },
            { type: 'code', lang: 'ts', text: 'const a = 1;' },
          ],
        },
      ],
    },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateBlock(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path}: mỗi block phải là một object`;
  if (!BLOCK_TYPES.includes(value.type as (typeof BLOCK_TYPES)[number])) {
    return `${path}.type: "${String(value.type)}" không phải loại block hợp lệ`;
  }

  if (value.type === 'table') {
    if (!Array.isArray(value.rows) || value.rows.length === 0) {
      return `${path}.rows: bảng cần ít nhất một dòng`;
    }
    for (const [rowIndex, row] of value.rows.entries()) {
      if (!Array.isArray(row) || row.some((cell) => typeof cell !== 'string')) {
        return `${path}.rows[${rowIndex}]: mỗi dòng phải là mảng chuỗi`;
      }
    }
    return null;
  }

  if (typeof value.text !== 'string') return `${path}.text: phải là chuỗi`;
  if (value.type === 'code' && typeof value.lang !== 'string') {
    return `${path}.lang: block code cần trường lang`;
  }
  return null;
}

function validateQuestion(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path}: mỗi câu hỏi phải là một object`;
  if (typeof value.q !== 'string' || !value.q.trim()) return `${path}.q: câu hỏi không được rỗng`;

  if (value.code !== undefined && value.code !== null && typeof value.code !== 'string') {
    return `${path}.code: phải là chuỗi hoặc null`;
  }
  if (
    value.level !== undefined &&
    value.level !== null &&
    !LEVELS.includes(value.level as AdminLevel)
  ) {
    return `${path}.level: level không hợp lệ`;
  }
  if (value.blocks !== undefined) {
    if (!Array.isArray(value.blocks)) return `${path}.blocks: phải là mảng`;
    for (const [index, block] of value.blocks.entries()) {
      const issue = validateBlock(block, `${path}.blocks[${index}]`);
      if (issue) return issue;
    }
  }
  return null;
}

function validateDocument(value: unknown): { document: AdminDocument } | { message: string } {
  if (!isRecord(value)) return { message: 'Nội dung phải là một object JSON' };

  if (typeof value.title !== 'string' || !value.title.trim()) {
    return { message: 'Thiếu trường title' };
  }
  if (typeof value.label !== 'string' || !value.label.trim()) {
    return { message: 'Thiếu trường label' };
  }
  if (
    value.subtitle !== undefined &&
    value.subtitle !== null &&
    typeof value.subtitle !== 'string'
  ) {
    return { message: 'Trường subtitle phải là chuỗi hoặc null' };
  }
  if (typeof value.color !== 'string' || !COLOR_PATTERN.test(value.color)) {
    return { message: 'Trường color phải có dạng #rrggbb' };
  }
  if (!Array.isArray(value.sections) || value.sections.length === 0) {
    return { message: 'Cần ít nhất một phần trong sections' };
  }

  for (const [index, section] of value.sections.entries()) {
    const path = `sections[${index}]`;
    if (!isRecord(section)) return { message: `${path}: mỗi phần phải là một object` };
    if (typeof section.name !== 'string' || !section.name.trim()) {
      return { message: `${path}.name: tên phần không được rỗng` };
    }
    if (!Array.isArray(section.questions) || section.questions.length === 0) {
      return { message: `${path}.questions: cần ít nhất một câu hỏi` };
    }
    for (const [questionIndex, question] of section.questions.entries()) {
      const issue = validateQuestion(question, `${path}.questions[${questionIndex}]`);
      if (issue) return { message: issue };
    }
  }

  return { document: value as unknown as AdminDocument };
}

/**
 * Validates a pasted document against the shape the server accepts. The server
 * stays the authority; this only avoids a round trip that is certain to fail.
 */
export function parseImportDocument(raw: string): ImportParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }

  const checked = validateDocument(parsed);
  if ('message' in checked) return { ok: false, message: checked.message };

  const sections = checked.document.sections.length;
  const questions = checked.document.sections.reduce(
    (total, section) => total + section.questions.length,
    0,
  );
  return { ok: true, document: checked.document, sections, questions };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** Opens the import dialog. Nothing is written until Import is pressed. */
export function openImportDialog(topicId: string, onDone: () => Promise<void> | void): void {
  const overlay = element('div', 'la-import-overlay');
  const panel = element('section', 'la-import-panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('libAdmin.importTitle'));
  panel.appendChild(element('h3', 'la-import-title', t('libAdmin.importTitle')));

  const textarea = element('textarea', 'la-import-text');
  textarea.placeholder = t('libAdmin.importPaste');
  panel.appendChild(textarea);

  const fileInput = element('input', 'la-import-file');
  fileInput.type = 'file';
  fileInput.accept = '.json,application/json';
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    void file.text().then((content) => {
      textarea.value = content;
      refresh();
    });
  });
  panel.appendChild(fileInput);

  panel.appendChild(
    button('la-import-template', t('libAdmin.importTemplate'), () => {
      textarea.value = JSON.stringify(SAMPLE_DOCUMENT, null, 2);
      refresh();
    }),
  );

  const modeLabel = element('label', 'la-import-mode-label');
  modeLabel.appendChild(element('span', 'la-field-label', t('libAdmin.importMode')));
  const mode = element('select', 'la-import-mode');
  for (const [value, label] of [
    ['replace', t('libAdmin.importModeReplace')],
    ['append', t('libAdmin.importModeAppend')],
  ] as Array<[string, string]>) {
    const option = element('option', 'la-import-mode-option', label);
    option.value = value;
    mode.appendChild(option);
  }
  modeLabel.appendChild(mode);
  panel.appendChild(modeLabel);

  const preview = element('p', 'la-import-preview');
  const error = element('p', 'la-import-error');
  panel.append(preview, error);

  const footer = element('div', 'la-import-footer');
  const submit = button('la-import-submit', t('libAdmin.import'), () => void submitImport());
  submit.disabled = true;
  footer.appendChild(submit);
  footer.appendChild(button('la-import-cancel', t('libAdmin.cancel'), () => overlay.remove()));
  panel.appendChild(footer);

  let current: { document: AdminDocument; sections: number; questions: number } | null = null;

  function refresh(): void {
    const result = parseImportDocument(textarea.value);
    if (!result.ok) {
      current = null;
      preview.textContent = '';
      error.textContent = result.message;
      submit.disabled = true;
      return;
    }

    current = result;
    preview.textContent = t('libAdmin.importPreview', {
      sections: result.sections,
      questions: result.questions,
    });
    error.textContent = '';
    submit.disabled = false;
  }

  async function submitImport(): Promise<void> {
    if (!current) return;

    try {
      await api.libraryAdmin.importTopic(
        topicId,
        mode.value as 'replace' | 'append',
        current.document,
      );
    } catch (caught) {
      console.error(caught);
      if (caught instanceof ApiError) {
        error.textContent = caught.path ? `${caught.message} (${caught.path})` : caught.message;
        return;
      }
      showToast(t('libAdmin.saveFailed'), 'error');
      return;
    }

    const done = current;
    overlay.remove();
    showToast(
      t('libAdmin.importDone', { sections: done.sections, questions: done.questions }),
      'ok',
    );
    await onDone();
  }

  textarea.addEventListener('input', refresh);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
}

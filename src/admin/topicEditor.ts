/**
 * The topic editor: metadata, sections and the question rows of one subject.
 * It is opened with a context object because it renders inside the Content tab,
 * which owns the surrounding shell and the topic list.
 */
import {
  api,
  type AdminLevel,
  type AdminQuestion,
  type AdminSection,
  type AdminTopicDetail,
} from '../api/client';
import { t } from '../i18n';
import { showToast } from '../ui/toast';
import {
  button,
  element,
  field,
  inputValue,
  runAction,
  saveSnapshot,
  setFormError,
} from './adminUi';
import { openImportDialog } from './importDocument';
import { openQuestionEditor } from './questionEditor';

export interface TopicEditorContext {
  /** The Content tab body; the editor swaps the list out of it. */
  host: HTMLElement;
  /** Called when the editor closes itself, so the caller can show the list again. */
  onExit: () => void;
}

let topicId: string | null = null;
let detail: AdminTopicDetail | null = null;
let host: HTMLElement | null = null;
let onExit: () => void = () => undefined;

export function isTopicEditorOpen(): boolean {
  return topicId !== null;
}

export async function openTopicEditor(id: string, context: TopicEditorContext): Promise<void> {
  topicId = id;
  host = context.host;
  onExit = context.onExit;
  detail = null;
  renderEditor();

  await reloadTopicDetail();
}

/** Re-renders the open editor against fresh data; used after a language switch. */
export async function repaintTopicEditor(): Promise<void> {
  if (!topicId) return;
  renderEditor();

  await reloadTopicDetail();
}

/** Drops the editor state and its DOM. The caller decides what to show instead. */
export function closeTopicEditor(): void {
  topicId = null;
  detail = null;
  host?.querySelector('.la-editor')?.remove();
}

export async function reloadTopicDetail(): Promise<void> {
  const id = topicId;
  if (!id) return;

  console.debug('[admin-content] topic loading', { topicId: id });
  await runAction(async () => {
    const loaded = await api.libraryAdmin.getTopic(id);
    // The editor may have been closed while the request was in flight. Do not
    // let a stale response resurrect the editor or overwrite a newer topic.
    if (topicId !== id) return;
    detail = loaded;
    renderEditor();
    console.debug('[admin-content] topic loaded', {
      topicId: id,
      sections: loaded.sections.length,
    });
  }).finally(() => {
    console.debug('[admin-content] topic loading settled', { topicId: id });
  });
}

function renderEditor(): void {
  if (!host || !topicId) return;

  let node = host.querySelector('.la-editor');
  if (!node) {
    node = element('div', 'la-editor');
    const list = host.querySelector('.la-topics');
    if (list) list.replaceWith(node);
    else host.appendChild(node);
  }
  node.textContent = '';

  if (!detail) {
    node.appendChild(element('p', 'la-empty admin-loading', t('admin.loading')));
    return;
  }

  node.appendChild(button('la-back', t('libAdmin.back'), onExit));
  node.appendChild(element('h3', 'la-editor-title', detail.label));
  node.appendChild(element('code', 'la-editor-key', detail.key));
  node.appendChild(renderMetaForm(detail));
  node.appendChild(renderEditorActions());

  const sections = element('div', 'la-sections');
  detail.sections.forEach((section, index) => {
    sections.appendChild(renderSectionBlock(section, index));
  });
  node.appendChild(sections);

  node.appendChild(button('la-new-section', t('libAdmin.newSection'), openSectionForm));
}

function renderMetaForm(topic: AdminTopicDetail): HTMLElement {
  const form = element('form', 'la-meta-form');
  form.addEventListener('submit', (event) => event.preventDefault());
  form.appendChild(field('metaLabel', t('libAdmin.fieldLabel'), { value: topic.label }));
  form.appendChild(field('metaTitle', t('libAdmin.fieldTitle'), { value: topic.title }));
  form.appendChild(
    field('metaSubtitle', t('libAdmin.fieldSubtitle'), { value: topic.subtitle ?? '' }),
  );
  form.appendChild(
    field('metaColor', t('libAdmin.fieldColor'), { type: 'color', value: topic.color }),
  );
  form.appendChild(button('la-save-meta', t('libAdmin.save'), () => void saveMeta()));
  return form;
}

function renderEditorActions(): HTMLElement {
  const actions = element('div', 'la-editor-actions');
  actions.appendChild(button('la-export', t('libAdmin.export'), () => void exportCurrentTopic()));
  actions.appendChild(
    button('la-import', t('libAdmin.import'), () => {
      if (topicId) openImportDialog(topicId, reloadTopicDetail);
    }),
  );
  actions.appendChild(
    button('la-archive', t('libAdmin.archive'), () => void archiveCurrentTopic()),
  );
  return actions;
}

function openSectionForm(): void {
  const sections = host?.querySelector('.la-sections');
  if (!sections) return;

  const existing = sections.parentElement?.querySelector('.la-new-section-form');
  if (existing) {
    existing.remove();
    return;
  }

  const form = element('form', 'la-new-section-form');
  form.addEventListener('submit', (event) => event.preventDefault());
  form.appendChild(field('sectionName', t('libAdmin.sectionName')));
  form.appendChild(element('p', 'la-form-error'));

  const actions = element('div', 'la-form-actions');
  actions.appendChild(
    button('la-section-submit', t('libAdmin.create'), () => void createSection()),
  );
  actions.appendChild(button('la-section-cancel', t('libAdmin.cancel'), () => form.remove()));
  form.appendChild(actions);

  sections.insertAdjacentElement('afterend', form);
}

function renderSectionBlock(section: AdminSection, index: number): HTMLElement {
  const block = element('section', 'la-section');
  block.dataset.section = section.id;

  const head = element('div', 'la-section-head');
  head.appendChild(element('h4', 'la-section-name', section.name));

  const rename = element('input', 'la-input la-section-rename-input');
  rename.value = section.name;
  rename.dataset.role = 'section-rename';
  head.appendChild(rename);
  head.appendChild(
    button(
      'la-section-rename',
      t('libAdmin.save'),
      () => void renameSection(section, rename.value),
    ),
  );
  block.appendChild(head);

  const last = (detail?.sections.length ?? 0) - 1;
  const actions = element('div', 'la-section-actions');
  const up = button('la-section-up', '↑', () => void moveSection(section, index - 1));
  up.disabled = index === 0;
  const down = button('la-section-down', '↓', () => void moveSection(section, index + 1));
  down.disabled = index === last;
  actions.append(
    up,
    down,
    button('la-section-delete', t('libAdmin.remove'), () => void deleteSection(section)),
  );
  block.appendChild(actions);

  const questions = element('div', 'la-questions');
  section.questions.forEach((question, questionIndex) => {
    questions.appendChild(renderQuestionRow(question, section, questionIndex));
  });
  block.appendChild(questions);

  block.appendChild(
    button('la-new-question', t('libAdmin.newQuestion'), () => {
      editQuestion(null, section.id);
    }),
  );

  return block;
}

function renderLevelSelect(
  value: AdminLevel | null,
  onChange: (next: AdminLevel | null) => void,
): HTMLSelectElement {
  const select = element('select', 'la-level');

  const options: Array<[string, string]> = [
    ['', t('libAdmin.levelNone')],
    ['basic', t('libAdmin.levelBasic')],
    ['intermediate', t('libAdmin.levelIntermediate')],
    ['advanced', t('libAdmin.levelAdvanced')],
  ];
  for (const [raw, label] of options) {
    const option = element('option', 'la-level-option', label);
    option.value = raw;
    select.appendChild(option);
  }
  select.value = value ?? '';
  select.addEventListener('change', () => {
    onChange((select.value || null) as AdminLevel | null);
  });

  return select;
}

function renderQuestionRow(
  question: AdminQuestion,
  section: AdminSection,
  index: number,
): HTMLElement {
  const row = element('article', 'la-question');
  row.dataset.question = question.id;

  const prompt = element('div', 'la-question-prompt');
  if (question.code) prompt.appendChild(element('code', 'la-question-code', question.code));
  prompt.appendChild(element('p', 'la-question-text', question.prompt));
  row.appendChild(prompt);

  row.appendChild(
    renderLevelSelect(question.level, (level) => void setQuestionLevel(question, level)),
  );

  const actions = element('div', 'la-question-actions');
  const up = button('la-move-up', '↑', () => void moveQuestion(section, index, index - 1));
  up.disabled = index === 0;
  const down = button('la-move-down', '↓', () => void moveQuestion(section, index, index + 1));
  down.disabled = index === section.questions.length - 1;
  actions.append(
    up,
    down,
    button('la-edit-question', t('libAdmin.edit'), () => editQuestion(question, section.id)),
    button('la-delete', t('libAdmin.remove'), () => void deleteQuestion(question)),
  );
  row.appendChild(actions);

  return row;
}

function editQuestion(question: AdminQuestion | null, sectionId: string): void {
  openQuestionEditor({
    question,
    sectionId,
    onSaved: reloadTopicDetail,
    onCancel: () => undefined,
  });
}

/** Runs a mutation, reports it, then re-reads the topic so the UI matches the database. */
async function mutate(action: () => Promise<void>): Promise<void> {
  let ok = false;
  await runAction(async () => {
    await action();
    ok = true;
  });
  if (!ok) return;

  showToast(t('libAdmin.saved'), 'ok');
  await reloadTopicDetail();
}

function topicFileName(): string {
  return `${detail?.key ?? 'topic'}.json`;
}

/** Deletes something, so the snapshot the server returned must be kept first. */
async function deleteAndDownload(action: () => Promise<{ snapshot: unknown }>): Promise<void> {
  await runAction(async () => {
    const { snapshot } = await action();
    saveSnapshot(topicFileName(), snapshot);
    showToast(t('libAdmin.saved'), 'ok');
    await reloadTopicDetail();
  });
}

async function saveMeta(): Promise<void> {
  const id = topicId;
  if (!id) return;

  await mutate(async () => {
    await api.libraryAdmin.updateTopic(id, {
      label: inputValue('metaLabel'),
      title: inputValue('metaTitle'),
      subtitle: inputValue('metaSubtitle') || null,
      color: inputValue('metaColor'),
    });
  });
}

async function exportCurrentTopic(): Promise<void> {
  const id = topicId;
  if (!id) return;

  await runAction(async () => {
    saveSnapshot(topicFileName(), await api.libraryAdmin.exportTopic(id));
  });
}

async function archiveCurrentTopic(): Promise<void> {
  const id = topicId;
  if (!id || !window.confirm(t('libAdmin.deleteWarning'))) return;

  await runAction(async () => {
    const { snapshot } = await api.libraryAdmin.archiveTopic(id);
    saveSnapshot(topicFileName(), snapshot);
    onExit();
  });
}

async function createSection(): Promise<void> {
  const id = topicId;
  const name = inputValue('sectionName');
  if (!id) return;
  if (!name) {
    setFormError(t('libAdmin.formInvalid'));
    return;
  }

  await mutate(async () => {
    await api.libraryAdmin.createSection(id, name);
  });
}

async function renameSection(section: AdminSection, name: string): Promise<void> {
  if (!name.trim() || name.trim() === section.name) return;

  await mutate(async () => {
    await api.libraryAdmin.updateSection(section.id, { name: name.trim() });
  });
}

async function moveSection(section: AdminSection, to: number): Promise<void> {
  const target = detail?.sections[to];
  if (!target || !window.confirm(t('libAdmin.reorderWarning'))) return;

  await mutate(async () => {
    await api.libraryAdmin.updateSection(section.id, { position: target.position });
  });
}

async function deleteSection(section: AdminSection): Promise<void> {
  if (!window.confirm(t('libAdmin.deleteWarning'))) return;
  await deleteAndDownload(() => api.libraryAdmin.deleteSection(section.id));
}

async function setQuestionLevel(question: AdminQuestion, level: AdminLevel | null): Promise<void> {
  await mutate(async () => {
    await api.libraryAdmin.updateQuestion(question.id, { level });
  });
}

async function moveQuestion(section: AdminSection, from: number, to: number): Promise<void> {
  const moved = section.questions[from];
  const target = section.questions[to];
  if (!moved || !target || !window.confirm(t('libAdmin.reorderWarning'))) return;

  await mutate(async () => {
    await api.libraryAdmin.updateQuestion(moved.id, { position: target.position });
  });
}

async function deleteQuestion(question: AdminQuestion): Promise<void> {
  if (!window.confirm(t('libAdmin.deleteWarning'))) return;
  await deleteAndDownload(() => api.libraryAdmin.deleteQuestion(question.id));
}

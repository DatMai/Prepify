import {
  api,
  type AdminLevel,
  type AdminLocale,
  type AdminQuestion,
  type AdminSection,
  type AdminTopicDetail,
  type AdminTopicListItem,
} from '../api/client';
import { t } from '../i18n';
import { showToast } from '../ui/toast';
import { openImportDialog } from './importDocument';
import { openQuestionEditor } from './questionEditor';

export { SAMPLE_DOCUMENT, parseImportDocument } from './importDocument';

let locale: AdminLocale = 'vi';
let topics: AdminTopicListItem[] = [];
let body: HTMLElement | null = null;
let editorTopicId: string | null = null;
let detail: AdminTopicDetail | null = null;

const KEY_PATTERN = /^[a-z0-9-]{2,40}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

let snapshotDownloader: (name: string, snapshot: unknown) => void = downloadJson;

/** Serialises a snapshot and hands it to the browser as a file download. */
export function downloadJson(name: string, snapshot: unknown): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * Replaces the file download with a plain callback. Tests use this instead of
 * exercising `URL.createObjectURL`, which jsdom does not implement.
 */
export function setSnapshotDownloader(fn: (name: string, snapshot: unknown) => void): void {
  snapshotDownloader = fn;
}

export function setContentLocale(next: AdminLocale): void {
  if (locale === next) return;
  locale = next;
  editorTopicId = null;
  if (body) renderContentTab(body);
}

export function currentContentLocale(): AdminLocale {
  return locale;
}

export function renderContentTab(target: HTMLElement): void {
  body = target;
  body.innerHTML = '';
  body.appendChild(renderToolbar());

  if (editorTopicId) void openTopicEditor(editorTopicId);
  else void reloadTopics();
}

export function closeTopicEditor(): void {
  editorTopicId = null;
  detail = null;
  body?.querySelector('.la-editor')?.remove();
  if (body) void reloadTopics();
}

export async function reloadTopics(): Promise<void> {
  if (!body || editorTopicId) return;
  renderTopicList(null);

  await run(async () => {
    const result = await api.libraryAdmin.listTopics(locale, true);
    topics = result.items;
    renderTopicList(topics);
  });
}

export async function openTopicEditor(topicId: string): Promise<void> {
  if (!body) return;
  editorTopicId = topicId;
  detail = null;
  renderEditor();

  await reloadTopicDetail();
}

export async function reloadTopicDetail(): Promise<void> {
  const topicId = editorTopicId;
  if (!topicId) return;

  await run(async () => {
    detail = await api.libraryAdmin.getTopic(topicId);
    renderEditor();
  });
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

function field(
  name: string,
  label: string,
  options: { type?: string; value?: string; placeholder?: string } = {},
): HTMLLabelElement {
  const wrapper = element('label', 'la-field');
  wrapper.appendChild(element('span', 'la-field-label', label));

  const input = element('input', 'la-input');
  input.type = options.type ?? 'text';
  input.name = name;
  input.value = options.value ?? '';
  if (options.placeholder) input.placeholder = options.placeholder;
  wrapper.appendChild(input);

  return wrapper;
}

function inputValue(name: string): string {
  const node = document.querySelector(`[name="${name}"]`);
  return node instanceof HTMLInputElement ? node.value.trim() : '';
}

function setFormError(message: string): void {
  const node = document.querySelector('.la-form-error');
  if (node) node.textContent = message;
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error);
    showToast(t('libAdmin.saveFailed'), 'error');
  }
}

function renderToolbar(): HTMLElement {
  const bar = element('div', 'la-toolbar');

  const group = element('div', 'la-locale');
  group.appendChild(element('span', 'la-locale-label', t('libAdmin.locale')));
  for (const value of ['vi', 'en'] as const) {
    const node = button(
      `la-locale-btn${locale === value ? ' is-active' : ''}`,
      value.toUpperCase(),
      () => setContentLocale(value),
    );
    node.dataset.locale = value;
    group.appendChild(node);
  }
  bar.appendChild(group);

  const actions = element('div', 'la-toolbar-actions');
  actions.appendChild(button('la-new-topic', t('libAdmin.newTopic'), openNewTopicForm));
  bar.appendChild(actions);

  return bar;
}

/** `null` renders the loading placeholder. */
function renderTopicList(loaded: AdminTopicListItem[] | null): void {
  if (!body) return;

  const list = element('div', 'la-topics');
  if (loaded === null) {
    list.appendChild(element('p', 'la-empty', '…'));
  } else if (loaded.length === 0) {
    list.appendChild(element('p', 'la-empty', t('libAdmin.topicsEmpty')));
  } else {
    for (const topic of loaded) list.appendChild(renderTopicRow(topic));
  }

  const previous = body.querySelector('.la-topics');
  if (previous) previous.replaceWith(list);
  else body.appendChild(list);
}

function renderTopicRow(topic: AdminTopicListItem): HTMLElement {
  const row = element('article', `la-topic${topic.archived ? ' is-archived' : ''}`);

  const head = element('div', 'la-topic-head');
  head.appendChild(element('h3', 'la-topic-label', topic.label));
  head.appendChild(element('code', 'la-topic-key', topic.key));
  if (topic.archived) {
    head.appendChild(element('span', 'la-badge-archived', t('libAdmin.archived')));
  }
  row.appendChild(head);

  if (topic.title) row.appendChild(element('p', 'la-topic-title', topic.title));
  const count = t('libAdmin.questionCount', { n: topic.questionCount });
  row.appendChild(element('p', 'la-topic-count', count));

  const actions = element('div', 'la-topic-actions');
  actions.appendChild(button('la-edit', t('libAdmin.edit'), () => void openTopicEditor(topic.id)));
  actions.appendChild(button('la-export', t('libAdmin.export'), () => void exportTopic(topic)));
  if (topic.archived) {
    actions.appendChild(
      button('la-restore', t('libAdmin.restore'), () => void restoreTopic(topic)),
    );
  } else {
    actions.appendChild(
      button('la-archive', t('libAdmin.archive'), () => void archiveTopic(topic)),
    );
  }
  row.appendChild(actions);

  return row;
}

function openNewTopicForm(): void {
  if (!body) return;

  const existing = body.querySelector('.la-new-topic-form');
  if (existing) {
    existing.remove();
    return;
  }

  const form = element('form', 'la-new-topic-form');
  form.addEventListener('submit', (event) => event.preventDefault());
  form.appendChild(field('key', t('libAdmin.fieldKey'), { placeholder: 'system-design' }));
  form.appendChild(field('label', t('libAdmin.fieldLabel')));
  form.appendChild(field('title', t('libAdmin.fieldTitle')));
  form.appendChild(field('subtitle', t('libAdmin.fieldSubtitle')));
  form.appendChild(field('color', t('libAdmin.fieldColor'), { type: 'color', value: '#6366f1' }));
  form.appendChild(element('p', 'la-form-error'));

  const actions = element('div', 'la-form-actions');
  actions.appendChild(button('la-create-submit', t('libAdmin.create'), () => void createTopic()));
  actions.appendChild(button('la-create-cancel', t('libAdmin.cancel'), () => form.remove()));
  form.appendChild(actions);

  const list = body.querySelector('.la-topics');
  if (list) body.insertBefore(form, list);
  else body.appendChild(form);
}

async function createTopic(): Promise<void> {
  const key = inputValue('key');
  const label = inputValue('label');
  const title = inputValue('title');
  const subtitle = inputValue('subtitle');
  const color = inputValue('color');

  if (!KEY_PATTERN.test(key) || !label || !title || !COLOR_PATTERN.test(color)) {
    setFormError(t('libAdmin.formInvalid'));
    return;
  }

  let created = false;
  await run(async () => {
    await api.libraryAdmin.createTopic({
      key,
      locale,
      label,
      title,
      subtitle: subtitle || null,
      color,
    });
    created = true;
  });
  if (!created) return;

  setFormError('');
  openNewTopicForm();
  await reloadTopics();
}

async function archiveTopic(topic: AdminTopicListItem): Promise<void> {
  if (!window.confirm(t('libAdmin.deleteWarning'))) return;

  await run(async () => {
    const { snapshot } = await api.libraryAdmin.archiveTopic(topic.id);
    snapshotDownloader(`${topic.key}.json`, snapshot);
    await reloadTopics();
  });
}

async function restoreTopic(topic: AdminTopicListItem): Promise<void> {
  await run(async () => {
    await api.libraryAdmin.restoreTopic(topic.id);
    await reloadTopics();
  });
}

async function exportTopic(topic: AdminTopicListItem): Promise<void> {
  await run(async () => {
    const documentJson = await api.libraryAdmin.exportTopic(topic.id);
    snapshotDownloader(`${topic.key}.json`, documentJson);
  });
}

function renderEditor(): void {
  if (!body) return;

  let node = body.querySelector('.la-editor');
  if (!node) {
    node = element('div', 'la-editor');
    const list = body.querySelector('.la-topics');
    if (list) list.replaceWith(node);
    else body.appendChild(node);
  }
  node.textContent = '';

  if (!detail) {
    node.appendChild(element('p', 'la-empty', t('admin.loading')));
    return;
  }

  node.appendChild(button('la-back', t('libAdmin.back'), closeTopicEditor));
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
      const topicId = editorTopicId;
      if (topicId) openImportDialog(topicId, reloadTopicDetail);
    }),
  );
  actions.appendChild(
    button('la-archive', t('libAdmin.archive'), () => void archiveCurrentTopic()),
  );
  return actions;
}

function openSectionForm(): void {
  const sections = body?.querySelector('.la-sections');
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
      openQuestionEditor({
        question: null,
        sectionId: section.id,
        onSaved: reloadTopicDetail,
        onCancel: () => undefined,
      });
    }),
  );

  return block;
}

export function renderLevelSelect(
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
    button('la-edit-question', t('libAdmin.edit'), () => {
      openQuestionEditor({
        question,
        sectionId: section.id,
        onSaved: reloadTopicDetail,
        onCancel: () => undefined,
      });
    }),
    button('la-delete', t('libAdmin.remove'), () => void deleteQuestion(question)),
  );
  row.appendChild(actions);

  return row;
}

/** Runs a mutation, reports it, then re-reads the topic so the UI matches the database. */
async function mutate(action: () => Promise<void>): Promise<void> {
  let ok = false;
  await run(async () => {
    await action();
    ok = true;
  });
  if (!ok) return;

  showToast(t('libAdmin.saved'), 'ok');
  await reloadTopicDetail();
}

async function saveMeta(): Promise<void> {
  const topicId = editorTopicId;
  if (!topicId) return;

  await mutate(async () => {
    await api.libraryAdmin.updateTopic(topicId, {
      label: inputValue('metaLabel'),
      title: inputValue('metaTitle'),
      subtitle: inputValue('metaSubtitle') || null,
      color: inputValue('metaColor'),
    });
  });
}

async function exportCurrentTopic(): Promise<void> {
  const topicId = editorTopicId;
  if (!topicId) return;

  await run(async () => {
    const documentJson = await api.libraryAdmin.exportTopic(topicId);
    snapshotDownloader(`${detail?.key ?? 'topic'}.json`, documentJson);
  });
}

async function archiveCurrentTopic(): Promise<void> {
  const topicId = editorTopicId;
  if (!topicId || !window.confirm(t('libAdmin.deleteWarning'))) return;

  await run(async () => {
    const { snapshot } = await api.libraryAdmin.archiveTopic(topicId);
    snapshotDownloader(`${detail?.key ?? 'topic'}.json`, snapshot);
    closeTopicEditor();
  });
}

async function createSection(): Promise<void> {
  const topicId = editorTopicId;
  const name = inputValue('sectionName');
  if (!topicId) return;
  if (!name) {
    setFormError(t('libAdmin.formInvalid'));
    return;
  }

  await mutate(async () => {
    await api.libraryAdmin.createSection(topicId, name);
  });
}

async function renameSection(section: AdminSection, name: string): Promise<void> {
  if (!name.trim() || name.trim() === section.name) return;

  await mutate(async () => {
    await api.libraryAdmin.updateSection(section.id, { name: name.trim() });
  });
}

async function moveSection(section: AdminSection, to: number): Promise<void> {
  const sections = detail?.sections ?? [];
  const target = sections[to];
  if (!target || !window.confirm(t('libAdmin.reorderWarning'))) return;

  await mutate(async () => {
    await api.libraryAdmin.updateSection(section.id, { position: target.position });
  });
}

async function deleteSection(section: AdminSection): Promise<void> {
  if (!window.confirm(t('libAdmin.deleteWarning'))) return;

  await run(async () => {
    const { snapshot } = await api.libraryAdmin.deleteSection(section.id);
    snapshotDownloader(`${detail?.key ?? 'topic'}.json`, snapshot);
    showToast(t('libAdmin.saved'), 'ok');
    await reloadTopicDetail();
  });
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

  await run(async () => {
    const { snapshot } = await api.libraryAdmin.deleteQuestion(question.id);
    snapshotDownloader(`${detail?.key ?? 'topic'}.json`, snapshot);
    showToast(t('libAdmin.saved'), 'ok');
    await reloadTopicDetail();
  });
}

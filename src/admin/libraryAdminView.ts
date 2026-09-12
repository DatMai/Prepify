import {
  api,
  type AdminLocale,
  type AdminTopicDetail,
  type AdminTopicListItem,
} from '../api/client';
import { t } from '../i18n';
import { showToast } from '../ui/toast';

let locale: AdminLocale = 'vi';
let topics: AdminTopicListItem[] = [];
let body: HTMLElement | null = null;
let editorTopicId: string | null = null;

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
  renderTopicEditor(null);

  await run(async () => {
    const topic = await api.libraryAdmin.getTopic(topicId);
    renderTopicEditor(topic);
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

/** Task 4 replaces this placeholder with the full topic editor. */
function renderTopicEditor(topic: AdminTopicDetail | null): void {
  if (!body) return;

  let node = body.querySelector('.la-editor');
  if (!node) {
    node = element('div', 'la-editor');
    const list = body.querySelector('.la-topics');
    if (list) list.replaceWith(node);
    else body.appendChild(node);
  }
  node.textContent = '';

  if (!topic) {
    node.appendChild(element('p', 'la-empty', '…'));
    return;
  }

  node.appendChild(element('h3', 'la-editor-title', topic.label));
  node.appendChild(element('code', 'la-editor-key', topic.key));
  node.appendChild(button('la-editor-back', t('libAdmin.back'), closeTopicEditor));
}

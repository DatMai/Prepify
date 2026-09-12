/**
 * The Content tab: locale switch, the subject list, and the inline form that
 * creates a subject. Opening a subject hands the body over to `topicEditor`.
 */
import { api, type AdminLocale, type AdminTopicListItem } from '../api/client';
import { t } from '../i18n';
import {
  button,
  element,
  field,
  inputValue,
  runAction,
  saveSnapshot,
  setFormError,
} from './adminUi';
import {
  closeTopicEditor,
  isTopicEditorOpen,
  openTopicEditor,
  repaintTopicEditor,
} from './topicEditor';

export { parseImportDocument, SAMPLE_DOCUMENT } from './importDocument';
export { setSnapshotDownloader } from './adminUi';

let locale: AdminLocale = 'vi';
let topics: AdminTopicListItem[] = [];
let body: HTMLElement | null = null;

const KEY_PATTERN = /^[a-z0-9-]{2,40}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function setContentLocale(next: AdminLocale): void {
  if (locale === next) return;
  locale = next;
  if (body) renderContentTab(body);
}

export function currentContentLocale(): AdminLocale {
  return locale;
}

export function renderContentTab(target: HTMLElement): void {
  body = target;
  body.innerHTML = '';
  body.appendChild(renderToolbar());

  if (isTopicEditorOpen()) void repaintTopicEditor();
  else void reloadTopics();
}

export async function reloadTopics(): Promise<void> {
  if (!body || isTopicEditorOpen()) return;
  renderTopicList(null);

  await runAction(async () => {
    const result = await api.libraryAdmin.listTopics(locale, true);
    topics = result.items;
    renderTopicList(topics);
  });
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
  actions.appendChild(button('la-edit', t('libAdmin.edit'), () => editTopic(topic.id)));
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

function editTopic(topicId: string): void {
  if (!body) return;
  void openTopicEditor(topicId, { host: body, onExit: exitTopicEditor });
}

/** Back from the editor: drop it and show the list again. */
function exitTopicEditor(): void {
  closeTopicEditor();
  void reloadTopics();
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
  await runAction(async () => {
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

function topicFileName(topic: AdminTopicListItem): string {
  return `${topic.key}.json`;
}

async function archiveTopic(topic: AdminTopicListItem): Promise<void> {
  if (!window.confirm(t('libAdmin.deleteWarning'))) return;

  await runAction(async () => {
    const { snapshot } = await api.libraryAdmin.archiveTopic(topic.id);
    saveSnapshot(topicFileName(topic), snapshot);
    await reloadTopics();
  });
}

async function restoreTopic(topic: AdminTopicListItem): Promise<void> {
  await runAction(async () => {
    await api.libraryAdmin.restoreTopic(topic.id);
    await reloadTopics();
  });
}

async function exportTopic(topic: AdminTopicListItem): Promise<void> {
  await runAction(async () => {
    saveSnapshot(topicFileName(topic), await api.libraryAdmin.exportTopic(topic.id));
  });
}

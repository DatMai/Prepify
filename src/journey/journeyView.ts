import { api, ApiError, type JourneyTodayResponse } from '../api/client';
import { isLoggedIn } from '../state/auth';
import { t } from '../i18n';
import { showToast } from '../ui/toast';
import type { JourneyBlock, JourneyJournal, JourneySnapshot, JourneyTask } from './types';
import {
  SYNC_STATE_KEYS,
  canMutate,
  isRetryable,
  lastSyncedLabel,
  newSyncEventId,
  readLastSyncedAt,
  runSyncJob,
  syncHintLabel,
  writeLastSyncedAt,
  type SyncUiStatus,
} from './syncState';

type StatusTone = 'info' | 'ok' | 'error';
type JourneyMode = 'focus' | 'review';

/**
 * The Journey surface after normalizing either transport: the local vault
 * `JourneySnapshot` or the hosted PostgreSQL projection. Hosted mode has no
 * Obsidian URI and no file mtime, so those are nullable.
 */
export interface JourneyViewModel {
  date: string;
  revision: string;
  stage: string;
  tasks: JourneyTask[];
  evidence: string[];
  journal: JourneyJournal;
  blocks: JourneyBlock[];
  obsidianUri: string | null;
  mtimeMs: number | null;
  /** True when the data came from the hosted projection rather than the local vault. */
  hosted: boolean;
  /**
   * Whether vault-backed writes can land. Hosted mode depends on the bridge
   * being online; local mode writes to the vault directly, so it is always
   * writable and has no sync concept at all.
   */
  writable: boolean;
  /** ISO timestamp the hosted projection was last refreshed, when known. */
  projectionUpdatedAt: string | null;
}

export function normalizeJourneyToday(response: JourneyTodayResponse): JourneyViewModel | null {
  if ('synced' in response) {
    if (!response.synced) return null;
    const daily = response.projection.daily;
    return {
      date: daily.date || response.date,
      revision: response.revision,
      stage: daily.stage,
      tasks: daily.tasks,
      evidence: daily.evidence,
      journal: daily.journal,
      blocks: daily.blocks ?? [],
      obsidianUri: null,
      mtimeMs: null,
      hosted: true,
      writable: response.bridgeConnected ?? false,
      projectionUpdatedAt: response.updatedAt ?? null,
    };
  }

  return {
    date: response.date,
    revision: response.revision,
    stage: response.stage,
    tasks: response.tasks,
    evidence: response.evidence,
    journal: response.journal,
    blocks: response.blocks ?? [],
    obsidianUri: response.obsidianUri,
    mtimeMs: response.mtimeMs,
    hosted: false,
    writable: true,
    projectionUpdatedAt: null,
  };
}

/** A local-vault snapshot: the API already wrote it, so it is never stale. */
function fromVaultSnapshot(snapshot: JourneySnapshot): JourneyViewModel {
  return {
    ...snapshot,
    blocks: snapshot.blocks ?? [],
    hosted: false,
    writable: true,
    projectionUpdatedAt: null,
  };
}

interface JourneyDrafts {
  taskEvidence: Record<string, string>;
  quickEvidence: string;
  journal: JourneyJournal | null;
}
let overlay: HTMLDivElement | null = null;
let current: JourneyViewModel | null = null;
let lastError: ApiError | null = null;
let loading = false;
let viewMode: JourneyMode = 'focus';
let expandedTaskId: string | null = null;
let syncStatus: SyncUiStatus = { state: 'pending', jobId: null, lastSyncedAt: null };
let syncing = false;
let syncTimedOut = false;
let drafts: JourneyDrafts = {
  taskEvidence: {},
  quickEvidence: '',
  journal: null,
};
const pendingEventIds = new Map<string, string>();

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

function actionButton(label: string, className = 'journey-btn-secondary'): HTMLButtonElement {
  const button = element('button', className, label);
  button.type = 'button';
  return button;
}

function nextEventId(key: string): string {
  const existing = pendingEventIds.get(key);
  if (existing) return existing;

  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}_${crypto.getRandomValues(new Uint32Array(2)).join('_')}`;
  pendingEventIds.set(key, id);
  return id;
}

function finishEvent(key: string): void {
  pendingEventIds.delete(key);
}

export function initJourneyView(): void {
  if (overlay) return;

  overlay = element('div', 'journey-page');
  overlay.id = 'journeyOverlay';
  overlay.hidden = true;
  document.body.appendChild(overlay);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay && !overlay.hidden) closeJourney();
  });
  window.addEventListener('popstate', () => {
    if (window.location.hash === '#journey') void openJourney(false);
    else hideJourney();
  });
}

export async function openJourney(updateHistory = true): Promise<void> {
  if (!overlay) initJourneyView();
  captureDrafts();
  overlay!.hidden = false;
  document.body.classList.add('journey-page-open');
  syncStatus = { ...syncStatus, lastSyncedAt: readLastSyncedAt(window.localStorage) };

  if (updateHistory && window.location.hash !== '#journey') {
    window.history.pushState({ journey: true }, '', '#journey');
  }

  if (!isLoggedIn()) {
    current = null;
    lastError = null;
    renderGuest();
    return;
  }

  await loadJourney();
}

export function closeJourney(): void {
  captureDrafts();
  hideJourney();
  if (window.location.hash === '#journey') window.history.back();
}

function hideJourney(): void {
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('journey-page-open');
}

export function repaintJourney(): void {
  if (!overlay || overlay.hidden) return;
  captureDrafts();

  if (!isLoggedIn()) renderGuest();
  else if (loading) renderLoading();
  else if (current) renderJourney(current);
  else if (lastError) renderError(lastError);
  else renderEmpty();
}

async function loadJourney(): Promise<void> {
  loading = true;
  lastError = null;
  renderLoading();

  try {
    const previousDate = current?.date;
    const loaded = normalizeJourneyToday(await api.journey.today());

    if (!loaded) {
      current = null;
      expandedTaskId = null;
      syncTimedOut = false;
      // Nothing has been synchronized yet, so the next step is the Sync button.
      // Whether the bridge is reachable is reported once that job exists.
      syncStatus = {
        state: 'pending',
        jobId: null,
        lastSyncedAt: syncStatus.lastSyncedAt,
      };
      setAvailability('idle');
      renderEmpty();
      return;
    }
    if (previousDate && previousDate !== loaded.date) {
      drafts = { taskEvidence: {}, quickEvidence: '', journal: null };
      pendingEventIds.clear();
    }
    current = loaded;
    if (
      !expandedTaskId ||
      !loaded.tasks.some((task) => task.id === expandedTaskId && !task.checked)
    ) {
      expandedTaskId = loaded.tasks.find((task) => !task.checked)?.id ?? null;
    }
    syncTimedOut = false;
    // Reconcile with the server instead of assuming the bridge is away: a
    // projection that is already current is `synced`, so entering the page
    // never locks the controls the user can actually use. A durable conflict
    // or failure survives the reload — it is not a connectivity problem.
    const durable = syncStatus.state === 'conflict' || syncStatus.state === 'failed';
    syncStatus = {
      state: durable ? syncStatus.state : loaded.writable ? 'synced' : 'bridge_offline',
      jobId: null,
      lastSyncedAt: loaded.projectionUpdatedAt ?? syncStatus.lastSyncedAt,
    };
    setAvailability('ok');
    renderJourney(current);
  } catch (error: unknown) {
    current = null;
    lastError = asApiError(error);
    setAvailability('error');
    renderError(lastError);
  } finally {
    loading = false;
  }
}

function shell(title: string, subtitle?: string): { panel: HTMLElement; body: HTMLElement } {
  const panel = element('section', 'journey-panel');
  panel.setAttribute('role', 'main');
  panel.setAttribute('aria-label', title);

  const nav = element('nav', 'journey-nav');
  const close = actionButton('←', 'journey-back-btn');
  close.setAttribute('aria-label', t('journey.back'));
  close.addEventListener('click', closeJourney);
  nav.appendChild(close);

  const brand = element('div', 'journey-brand');
  brand.appendChild(element('span', '', t('journey.focusLabel')));
  nav.appendChild(brand);
  const language = actionButton(t('topbar.langSwitch'), 'journey-lang-btn');
  language.setAttribute('aria-label', t('topbar.langSwitch'));
  language.addEventListener('click', () =>
    window.dispatchEvent(new Event('prepify:toggle-language')),
  );
  const source = element('div', 'journey-nav-source');
  source.appendChild(element('span', 'journey-nav-sync'));
  source.appendChild(element('span', '', t('journey.source')));
  const navActions = element('div', 'journey-nav-actions');
  navActions.append(language, source);
  nav.appendChild(navActions);
  panel.appendChild(nav);

  const header = element('header', 'journey-header');
  const heading = element('div', 'journey-heading');
  heading.appendChild(element('p', 'journey-eyebrow', t('journey.focusEyebrow')));
  heading.appendChild(element('h1', '', title));
  if (subtitle) heading.appendChild(element('p', 'journey-subtitle', subtitle));
  header.appendChild(heading);
  panel.appendChild(header);

  const body = element('div', 'journey-body');
  panel.appendChild(body);
  overlay!.replaceChildren(panel);
  return { panel, body };
}

function renderLoading(): void {
  const { body } = shell(t('journey.title'));
  body.appendChild(element('div', 'journey-state', t('journey.loading')));
}

function renderGuest(): void {
  setAvailability('idle');
  const { body } = shell(t('journey.title'));
  const state = element('div', 'journey-state');
  state.appendChild(element('div', 'journey-state-icon', '🔒'));
  state.appendChild(element('h3', '', t('journey.loginTitle')));
  state.appendChild(element('p', '', t('journey.loginBody')));
  const login = actionButton(t('journey.login'), 'journey-btn-primary');
  login.addEventListener('click', () => {
    closeJourney();
    document.getElementById('authBtn')?.click();
  });
  state.appendChild(login);
  body.appendChild(state);
}

function renderError(error: ApiError): void {
  const { body } = shell(t('journey.title'));
  const state = element('div', 'journey-state journey-state-error');
  state.appendChild(element('div', 'journey-state-icon', '⚠'));
  state.appendChild(element('h3', '', errorTitle(error)));
  state.appendChild(element('p', '', errorMessage(error)));
  const retry = actionButton(t('journey.retry'), 'journey-btn-primary');
  retry.addEventListener('click', () => void loadJourney());
  state.appendChild(retry);
  body.appendChild(state);
}

/**
 * Nothing has been synchronized into PostgreSQL yet. Entering Journey never
 * scans the vault; the user starts the first synchronization explicitly.
 */
function renderEmpty(): void {
  const { body } = shell(t('journey.title'));
  const state = element('div', 'journey-state journey-empty-state');
  state.appendChild(element('div', 'journey-state-icon', '☁'));
  state.appendChild(element('h3', '', t('journey.emptyTitle')));
  state.appendChild(element('p', '', t('journey.emptyBody')));
  state.appendChild(renderSyncControl());
  body.appendChild(state);
  applySyncGating();
}

function renderSyncControl(): HTMLElement {
  // Local vault mode writes through the API itself, so there is nothing to
  // synchronize and the control would only offer a request the server 404s.
  if (current && !current.hosted) {
    const local = element('div', 'journey-sync-control is-local');
    local.hidden = true;
    return local;
  }

  const control = element('div', 'journey-sync-control');
  control.dataset.state = syncStatus.state;

  const button = actionButton(t('sync.button'), 'journey-sync-btn');
  button.id = 'journeySyncBtn';
  button.addEventListener('click', () => void runSync());

  const meta = element('div', 'journey-sync-meta');
  const state = element('span', 'journey-sync-state', t(SYNC_STATE_KEYS[syncStatus.state]));
  state.id = 'journeySyncState';
  state.setAttribute('role', 'status');
  state.setAttribute('aria-live', 'polite');
  meta.append(
    state,
    element('span', 'journey-sync-last', lastSyncedLabel(syncStatus.lastSyncedAt, t)),
  );

  const retry = actionButton(t('sync.retry'), 'journey-sync-retry');
  retry.id = 'journeySyncRetry';
  retry.hidden = !isRetryable(syncStatus.state);
  retry.addEventListener('click', () => void runSync());

  const hint = element('p', 'journey-sync-hint', syncHintLabel(syncStatus, syncTimedOut, t));
  control.append(button, meta, retry, hint);
  return control;
}

function updateSyncControl(): void {
  const control = overlay?.querySelector<HTMLElement>('.journey-sync-control');
  if (!control) return;
  control.dataset.state = syncStatus.state;

  const state = control.querySelector<HTMLElement>('.journey-sync-state');
  if (state) state.textContent = t(SYNC_STATE_KEYS[syncStatus.state]);
  const last = control.querySelector<HTMLElement>('.journey-sync-last');
  if (last) last.textContent = lastSyncedLabel(syncStatus.lastSyncedAt, t);
  const hint = control.querySelector<HTMLElement>('.journey-sync-hint');
  if (hint) hint.textContent = syncHintLabel(syncStatus, syncTimedOut, t);
  const retry = control.querySelector<HTMLButtonElement>('#journeySyncRetry');
  if (retry) retry.hidden = !isRetryable(syncStatus.state);
  const button = control.querySelector<HTMLButtonElement>('#journeySyncBtn');
  if (button) button.disabled = syncing;

  applySyncGating();
}

/** Vault-backed mutations are the only thing gated; projected content stays readable. */
function applySyncGating(): void {
  const disabled = !canMutate(syncStatus);
  overlay?.querySelectorAll<HTMLButtonElement>('[data-requires-sync]').forEach((node) => {
    node.disabled = disabled;
  });
}

async function runSync(): Promise<void> {
  if (syncing) return;
  syncing = true;
  syncTimedOut = false;
  syncStatus = { state: 'pending', jobId: null, lastSyncedAt: syncStatus.lastSyncedAt };
  updateSyncControl();

  try {
    const result = await runSyncJob({
      requestSync: () => api.journey.requestSync(newSyncEventId()),
      fetchStatus: (jobId) => api.journey.syncStatus(jobId),
      onStatus: (status) => {
        syncStatus = status;
        updateSyncControl();
      },
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => window.setTimeout(resolve, ms)),
      lastSyncedAt: syncStatus.lastSyncedAt,
    });

    syncTimedOut = result.state === 'pending' && result.jobId !== null;
    syncStatus = result;
    if (result.state === 'synced') {
      if (result.lastSyncedAt) writeLastSyncedAt(window.localStorage, result.lastSyncedAt);
      await loadJourney();
    }
  } finally {
    syncing = false;
    updateSyncControl();
  }
}

function renderJourney(data: JourneyViewModel): void {
  const { panel, body } = shell(t('journey.title'), formatDate(data.date));

  const summary = element('section', 'journey-summary');
  const stage = element('span', 'journey-stage', data.stage || '—');
  summary.appendChild(stage);

  const completed = data.tasks.filter((task) => task.checked).length;
  const progress = element('div', 'journey-progress-copy');
  progress.appendChild(
    element('strong', '', t('journey.progress', { done: completed, total: data.tasks.length })),
  );
  if (data.mtimeMs !== null) {
    progress.appendChild(
      element('span', '', t('journey.savedAt', { time: formatTime(data.mtimeMs) })),
    );
  }
  summary.appendChild(progress);

  const reload = actionButton(t('journey.reload'), 'journey-icon-btn journey-reload-btn');
  reload.addEventListener('click', () => {
    captureDrafts();
    void loadJourney();
  });
  summary.appendChild(reload);
  body.appendChild(summary);

  const track = element('div', 'journey-progress-track');
  const fill = element('div', 'journey-progress-fill');
  fill.style.width =
    data.tasks.length === 0 ? '0%' : `${Math.round((completed / data.tasks.length) * 100)}%`;
  track.appendChild(fill);
  body.appendChild(track);
  body.appendChild(renderViewBar(data));
  body.appendChild(renderSyncControl());

  const status = element('div', 'journey-status');
  status.id = 'journeyStatus';
  status.setAttribute('aria-live', 'polite');
  body.appendChild(status);

  if (viewMode === 'review') {
    body.appendChild(renderReview(data));
    panel.classList.remove('is-saving');
    applySyncGating();
    return;
  }

  body.appendChild(sectionTitle(t('journey.studyTitle'), t('journey.studyHint')));
  const tasks = element('div', 'journey-tasks');
  data.tasks.forEach((task, index) => tasks.appendChild(renderTask(task, index)));
  if (data.tasks.length === 0)
    tasks.appendChild(element('p', 'journey-empty', t('journey.noTasks')));
  body.appendChild(tasks);

  body.appendChild(sectionTitle(t('journey.evidenceTitle'), t('journey.evidenceHint')));
  body.appendChild(renderEvidence(data));

  body.appendChild(sectionTitle(t('journey.journalTitle'), t('journey.journalHint')));
  body.appendChild(renderJournal(data));

  body.appendChild(sectionTitle(t('journey.noteTitle'), t('journey.noteHint')));
  body.appendChild(renderNote(data));

  panel.classList.remove('is-saving');
  applySyncGating();
}

function renderViewBar(data: JourneyViewModel): HTMLElement {
  const bar = element('div', 'journey-view-bar');
  const switcher = element('div', 'journey-view-switch');
  switcher.setAttribute('aria-label', t('journey.viewLabel'));

  const focus = actionButton(
    t('journey.focusView'),
    `journey-view-btn${viewMode === 'focus' ? ' is-active' : ''}`,
  );
  focus.addEventListener('click', () => setViewMode('focus'));
  const review = actionButton(
    t('journey.reviewView'),
    `journey-view-btn${viewMode === 'review' ? ' is-active' : ''}`,
  );
  review.addEventListener('click', () => setViewMode('review'));
  switcher.append(focus, review);
  bar.appendChild(switcher);

  // Hosted mode has no vault path, so there is nothing to deep-link to.
  if (data.obsidianUri) {
    const open = element('a', 'journey-obsidian-link', t('journey.openObsidian'));
    open.href = data.obsidianUri;
    open.setAttribute('aria-label', t('journey.openObsidian'));
    bar.appendChild(open);
  }
  return bar;
}

function setViewMode(mode: JourneyMode): void {
  if (!current || viewMode === mode) return;
  captureDrafts();
  viewMode = mode;
  if (mode === 'review') {
    void loadJourney();
    return;
  }
  renderJourney(current);
  overlay?.scrollTo({ top: 0, behavior: 'smooth' });
}

function sectionTitle(title: string, hint: string): HTMLElement {
  const wrapper = element('div', 'journey-section-title');
  wrapper.appendChild(element('h3', '', title));
  wrapper.appendChild(element('p', '', hint));
  return wrapper;
}

function renderTask(task: JourneyTask, index: number): HTMLElement {
  const isExpanded = expandedTaskId === task.id;
  const card = element(
    'article',
    `journey-task${task.checked ? ' is-done' : ''}${isExpanded ? ' is-expanded' : ''}`,
  );
  const top = element('div', 'journey-task-top');
  top.dataset.taskToggle = task.id;
  top.tabIndex = 0;
  top.setAttribute('role', 'button');
  top.setAttribute('aria-expanded', String(isExpanded));
  top.appendChild(element('span', 'journey-task-check', task.checked ? '✓' : String(index + 1)));

  const copy = element('div', 'journey-task-copy');
  const presentation = taskPresentation(task);
  const meta = element('div', 'journey-task-meta');
  meta.appendChild(
    element('span', 'journey-task-label', t('journey.taskLabel', { index: index + 1 })),
  );
  if (presentation.time) meta.appendChild(element('time', '', presentation.time));
  copy.appendChild(meta);

  const title = element('h4');
  appendInlineContent(title, presentation.title);
  copy.appendChild(title);

  if (task.tags.length > 0) {
    const tags = element('div', 'journey-tags');
    task.tags.forEach((tag) => tags.appendChild(element('span', '', tag)));
    copy.appendChild(tags);
  }
  top.appendChild(copy);
  const state = element('div', 'journey-task-state-wrap');
  state.appendChild(
    element(
      'span',
      `journey-task-state${task.checked ? ' is-done' : ''}`,
      task.checked ? t('journey.statusDone') : t('journey.statusOpen'),
    ),
  );
  state.appendChild(element('span', 'journey-task-chevron', '⌄'));
  top.appendChild(state);
  const toggle = (): void => {
    captureDrafts();
    expandedTaskId = isExpanded ? null : task.id;
    if (current) renderJourney(current);
    overlay?.querySelector<HTMLElement>(`[data-task-toggle="${task.id}"]`)?.focus();
  };
  top.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) return;
    toggle();
  });
  top.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
  card.appendChild(top);

  if (!isExpanded) return card;

  const taskBody = element('div', 'journey-task-body');
  if (presentation.steps.length > 0) {
    const steps = element('ol', 'journey-task-steps');
    presentation.steps.forEach((step) => {
      const item = element('li');
      appendInlineContent(item, step);
      steps.appendChild(item);
    });
    taskBody.appendChild(steps);
  }

  if (task.checked) {
    const reopen = actionButton(t('journey.reopen'), 'journey-link-btn');
    reopen.dataset.requiresSync = 'true';
    reopen.addEventListener('click', () => void reopenTask(task));
    const actions = element('div', 'journey-actions');
    actions.appendChild(reopen);
    taskBody.appendChild(actions);
    card.appendChild(taskBody);
    return card;
  }

  const evidenceLabel = element('label', 'journey-evidence-label', t('journey.evidenceField'));
  const evidence = element('textarea', 'journey-textarea journey-task-evidence');
  evidence.rows = 7;
  evidence.dataset.taskEvidence = task.id;
  evidence.placeholder = t('journey.taskEvidencePlaceholder');
  evidence.value = drafts.taskEvidence[task.id] ?? '';
  evidenceLabel.appendChild(evidence);
  taskBody.appendChild(evidenceLabel);

  const actions = element('div', 'journey-actions');
  const partial = actionButton(t('journey.partial'));
  partial.dataset.requiresSync = 'true';
  partial.addEventListener('click', () => void recordTask(task, evidence, true));
  const complete = actionButton(t('journey.complete'), 'journey-btn-primary');
  complete.dataset.requiresSync = 'true';
  complete.addEventListener('click', () => void recordTask(task, evidence, false));
  actions.append(partial, complete);
  taskBody.appendChild(actions);
  card.appendChild(taskBody);
  return card;
}

interface TaskPresentation {
  time: string;
  title: string;
  steps: string[];
}

function taskPresentation(task: JourneyTask): TaskPresentation {
  let text = task.text;
  task.tags.forEach((tag) => {
    text = text.replaceAll(tag, '');
  });
  text = text.replace(/\s+/g, ' ').trim();

  const timeMatch = text.match(/\b\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\b/);
  const time = timeMatch?.[0] ?? '';
  if (timeMatch) text = text.replace(timeMatch[0], '').trim();
  text = text.replace(/^[-—–:\s]+|[-—–:\s]+$/g, '');

  const parts = text
    .split(/\s*→\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    time,
    title: parts[0] ?? t('journey.untitledTask'),
    steps: parts.slice(1),
  };
}

function appendInlineContent(target: HTMLElement, value: string): void {
  const tokenPattern = /(\[[^\]]+\]\(https?:\/\/[^)]+\)|\[\[[^\]]+\]\]|`[^`]+`)/g;
  let cursor = 0;

  for (const match of value.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) target.appendChild(document.createTextNode(value.slice(cursor, index)));
    const token = match[0];

    const markdownLink = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (markdownLink) {
      const link = element('a', 'journey-inline-link', markdownLink[1]);
      link.href = markdownLink[2];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      target.appendChild(link);
    } else if (token.startsWith('[[')) {
      target.appendChild(element('span', 'journey-wikilink', token.slice(2, -2)));
    } else {
      target.appendChild(element('code', '', token.slice(1, -1)));
    }
    cursor = index + token.length;
  }

  if (cursor < value.length) target.appendChild(document.createTextNode(value.slice(cursor)));
}

function renderReview(data: JourneyViewModel): HTMLElement {
  const review = element('div', 'journey-review');
  const intro = element('header', 'journey-review-intro');
  intro.appendChild(element('p', 'journey-review-kicker', t('journey.reviewKicker')));
  intro.appendChild(element('h2', '', t('journey.reviewTitle')));
  intro.appendChild(element('p', '', t('journey.reviewHint')));
  review.appendChild(intro);

  const taskSection = reviewSection(t('journey.reviewTasks'));
  const taskList = element('div', 'journey-review-tasks');
  data.tasks.forEach((task, index) => {
    const presentation = taskPresentation(task);
    const item = element('article', `journey-review-task${task.checked ? ' is-done' : ''}`);
    const meta = element('div', 'journey-review-meta');
    meta.appendChild(element('span', 'journey-review-index', String(index + 1).padStart(2, '0')));
    meta.appendChild(
      element(
        'span',
        `journey-review-status${task.checked ? ' is-done' : ''}`,
        task.checked ? t('journey.statusDone') : t('journey.statusOpen'),
      ),
    );
    if (presentation.time) meta.appendChild(element('time', '', presentation.time));
    item.appendChild(meta);
    const title = element('h4');
    appendInlineContent(title, presentation.title);
    item.appendChild(title);
    if (presentation.steps.length > 0) {
      const steps = element('ol', 'journey-task-steps');
      presentation.steps.forEach((step) => {
        const row = element('li');
        appendInlineContent(row, step);
        steps.appendChild(row);
      });
      item.appendChild(steps);
    }
    if (task.tags.length > 0) {
      const tags = element('div', 'journey-tags');
      task.tags.forEach((tag) => tags.appendChild(element('span', '', tag)));
      item.appendChild(tags);
    }
    taskList.appendChild(item);
  });
  if (data.tasks.length === 0)
    taskList.appendChild(element('p', 'journey-empty', t('journey.noTasks')));
  taskSection.appendChild(taskList);
  review.appendChild(taskSection);

  const evidenceSection = reviewSection(t('journey.reviewEvidence'));
  const evidenceList = element('div', 'journey-review-evidence');
  if (data.evidence.length === 0) {
    evidenceList.appendChild(element('p', 'journey-review-empty', t('journey.noEvidence')));
  } else {
    data.evidence.forEach((value) => {
      const row = element('div', 'journey-review-evidence-row');
      row.appendChild(element('span', '', '✓'));
      row.appendChild(element('p', '', value));
      evidenceList.appendChild(row);
    });
  }
  evidenceSection.appendChild(evidenceList);
  review.appendChild(evidenceSection);

  const journalSection = reviewSection(t('journey.reviewJournal'));
  const journal = element('div', 'journey-review-journal');
  (['done', 'blocked', 'next'] as const).forEach((field) => {
    const block = element('section', 'journey-review-journal-block');
    block.appendChild(element('h4', '', field[0].toUpperCase() + field.slice(1)));
    block.appendChild(element('p', '', data.journal[field] || t('journey.noJournal')));
    journal.appendChild(block);
  });
  journalSection.appendChild(journal);
  review.appendChild(journalSection);

  const noteSection = reviewSection(t('journey.noteTitle'));
  noteSection.appendChild(renderNote(data));
  review.appendChild(noteSection);

  if (data.obsidianUri) {
    const footer = element('footer', 'journey-review-footer');
    const open = element(
      'a',
      'journey-btn-primary journey-review-open',
      t('journey.openObsidianCta'),
    );
    open.href = data.obsidianUri;
    footer.appendChild(open);
    review.appendChild(footer);
  }
  return review;
}

function reviewSection(title: string): HTMLElement {
  const section = element('section', 'journey-review-section');
  section.appendChild(element('h3', '', title));
  return section;
}

function renderEvidence(data: JourneyViewModel): HTMLElement {
  const wrapper = element('div', 'journey-evidence');
  const list = element('div', 'journey-evidence-list');

  if (data.evidence.length === 0) {
    list.appendChild(element('p', 'journey-empty', t('journey.noEvidence')));
  } else {
    data.evidence
      .slice()
      .reverse()
      .forEach((item) => {
        const row = element('div', 'journey-evidence-row');
        row.appendChild(element('span', '', '↳'));
        row.appendChild(element('p', '', item));
        list.appendChild(row);
      });
  }
  wrapper.appendChild(list);

  const quick = element('textarea', 'journey-textarea');
  quick.id = 'journeyQuickEvidence';
  quick.rows = 4;
  quick.placeholder = t('journey.quickEvidencePlaceholder');
  quick.value = drafts.quickEvidence;
  wrapper.appendChild(quick);

  const actions = element('div', 'journey-actions');
  const save = actionButton(t('journey.addEvidence'), 'journey-btn-primary');
  save.dataset.requiresSync = 'true';
  save.addEventListener('click', () => void addQuickEvidence(quick));
  actions.appendChild(save);
  wrapper.appendChild(actions);
  return wrapper;
}

function renderJournal(data: JourneyViewModel): HTMLElement {
  const journal = drafts.journal ?? data.journal;
  const form = element('div', 'journey-journal');

  (['done', 'blocked', 'next'] as const).forEach((field) => {
    const label = element('label', 'journey-field');
    label.appendChild(element('span', '', field[0].toUpperCase() + field.slice(1)));
    const textarea = element('textarea', 'journey-textarea');
    textarea.rows = 7;
    textarea.dataset.journalField = field;
    textarea.value = journal[field];
    textarea.placeholder = t(`journey.journal.${field}`);
    label.appendChild(textarea);
    form.appendChild(label);
  });

  const actions = element('div', 'journey-actions');
  const save = actionButton(t('journey.saveJournal'), 'journey-btn-primary');
  save.dataset.requiresSync = 'true';
  save.addEventListener('click', () => void saveJournal());
  actions.appendChild(save);
  form.appendChild(actions);
  return form;
}

const HEADING_TAGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

/**
 * The whole Journey-owned note of the day, read-only and exactly as the vault
 * holds it. The structured task/journal fields cannot carry recall callouts or
 * `###` sub-sections, so this is what makes the page match Obsidian.
 */
function renderNote(data: JourneyViewModel): HTMLElement {
  const wrapper = element('div', 'journey-note');

  if (data.blocks.length === 0) {
    wrapper.appendChild(element('p', 'journey-empty', t('journey.noNote')));
    return wrapper;
  }

  data.blocks.forEach((block) => wrapper.appendChild(renderNoteBlock(block)));
  return wrapper;
}

function renderNoteBlock(block: JourneyBlock): HTMLElement {
  if (block.kind === 'heading') {
    const level = Math.min(Math.max(block.level, 1), 6);
    const heading = element(HEADING_TAGS[level - 1], `journey-note-heading is-level-${level}`);
    heading.textContent = block.text;
    return heading;
  }

  if (block.kind === 'paragraph') {
    return element('p', 'journey-note-paragraph', block.text);
  }

  if (block.kind === 'list') {
    const list = element(block.ordered ? 'ol' : 'ul', 'journey-note-list');
    block.items.forEach((item) => {
      const row = element('li', 'journey-note-list-item');
      if (item.checked !== null) {
        const box = element('span', 'journey-note-checkbox', item.checked ? '✓' : '');
        box.setAttribute('aria-hidden', 'true');
        row.appendChild(box);
      }
      row.appendChild(element('span', '', item.text));
      list.appendChild(row);
    });
    return list;
  }

  const quote = element('blockquote', `journey-note-quote${block.label ? ' is-callout' : ''}`);
  const body = element('div', 'journey-note-quote-body');
  block.lines.forEach((line) => body.appendChild(element('p', '', line)));

  if (block.label) {
    const header = element('div', 'journey-note-callout-header');
    header.appendChild(element('span', 'journey-note-callout-label', block.label));
    if (block.title) header.appendChild(element('span', 'journey-note-callout-title', block.title));

    const toggle = element('button', 'journey-note-toggle', '⌄');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', t('journey.noteToggle'));
    let expanded = !block.collapsed;
    const apply = (): void => {
      body.hidden = !expanded;
      toggle.textContent = expanded ? '⌃' : '⌄';
      toggle.setAttribute('aria-expanded', String(expanded));
    };
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      apply();
    });
    header.appendChild(toggle);
    quote.appendChild(header);
    apply();
  }

  quote.appendChild(body);
  return quote;
}

async function recordTask(
  task: JourneyTask,
  input: HTMLTextAreaElement,
  partial: boolean,
): Promise<void> {
  const detail = input.value.trim();
  if (detail.length < 3) {
    setStatus(t('journey.evidenceRequired'), 'error');
    input.focus();
    return;
  }

  const key = `${partial ? 'partial' : 'complete'}:${task.id}`;
  const evidence = formatTaskEvidence(task, detail, partial);
  await runMutation(
    async () => {
      if (!current) return;
      const updated = partial
        ? await api.journey.addEvidence(evidence, current.revision, nextEventId(key))
        : await api.journey.updateTask(task.id, true, evidence, current.revision, nextEventId(key));
      current = fromVaultSnapshot(updated);
      delete drafts.taskEvidence[task.id];
      finishEvent(key);
    },
    partial ? t('journey.partialSaved') : t('journey.taskSaved'),
  );
}

async function reopenTask(task: JourneyTask): Promise<void> {
  const key = `reopen:${task.id}`;
  await runMutation(async () => {
    if (!current) return;
    current = fromVaultSnapshot(
      await api.journey.updateTask(task.id, false, undefined, current.revision, nextEventId(key)),
    );
    finishEvent(key);
  }, t('journey.taskReopened'));
}

async function addQuickEvidence(input: HTMLTextAreaElement): Promise<void> {
  const evidence = input.value.trim();
  if (evidence.length < 3) {
    setStatus(t('journey.evidenceRequired'), 'error');
    input.focus();
    return;
  }

  const key = 'quick-evidence';
  await runMutation(async () => {
    if (!current) return;
    current = fromVaultSnapshot(
      await api.journey.addEvidence(evidence, current.revision, nextEventId(key)),
    );
    drafts.quickEvidence = '';
    finishEvent(key);
  }, t('journey.evidenceSaved'));
}

async function saveJournal(): Promise<void> {
  const journal = readJournalDraft();
  if (!journal.done.trim() && !journal.blocked.trim() && !journal.next.trim()) {
    setStatus(t('journey.journalRequired'), 'error');
    return;
  }

  await runMutation(async () => {
    if (!current) return;
    current = fromVaultSnapshot(await api.journey.saveJournal(journal, current.revision));
    drafts.journal = null;
  }, t('journey.journalSaved'));
}

export async function runMutation(
  work: () => Promise<void>,
  successMessage: string,
): Promise<void> {
  if (!current || !canMutate(syncStatus)) return;
  captureDrafts();
  const panel = overlay?.querySelector('.journey-panel');
  panel?.classList.add('is-saving');
  setStatus(t('journey.saving'), 'info');

  try {
    await work();
    if (current) renderJourney(current);
    showToast(successMessage, 'ok');
  } catch (error: unknown) {
    const apiError = asApiError(error);
    panel?.classList.remove('is-saving');
    if (apiError.status === 412) {
      setStatus(t('journey.conflict'), 'error');
    } else {
      setStatus(apiError.message || t('journey.saveError'), 'error');
    }
  }
}

function captureDrafts(): void {
  if (!overlay || overlay.hidden) return;

  overlay.querySelectorAll<HTMLTextAreaElement>('[data-task-evidence]').forEach((input) => {
    const taskId = input.dataset.taskEvidence;
    if (taskId) drafts.taskEvidence[taskId] = input.value;
  });

  const quick = overlay.querySelector<HTMLTextAreaElement>('#journeyQuickEvidence');
  if (quick) drafts.quickEvidence = quick.value;

  const journalInputs = overlay.querySelectorAll<HTMLTextAreaElement>('[data-journal-field]');
  if (journalInputs.length > 0) drafts.journal = readJournalDraft();
}

function readJournalDraft(): JourneyJournal {
  const value = (field: keyof JourneyJournal): string =>
    overlay?.querySelector<HTMLTextAreaElement>(`[data-journal-field="${field}"]`)?.value ?? '';
  return { done: value('done'), blocked: value('blocked'), next: value('next') };
}

function formatTaskEvidence(task: JourneyTask, detail: string, partial: boolean): string {
  const tags = [...task.tags];
  if (partial) tags.push('#partial');
  const prefix = [...new Set(tags)].join(' ');
  return `${prefix}${prefix ? ' — ' : ''}${detail}`;
}

function setStatus(message: string, tone: StatusTone): void {
  const status = overlay?.querySelector<HTMLElement>('#journeyStatus');
  if (!status) return;
  status.textContent = message;
  status.className = `journey-status is-${tone}`;
}

function setAvailability(state: 'idle' | 'ok' | 'error'): void {
  const dot = document.getElementById('journeySyncDot');
  if (dot) dot.className = `journey-sync-dot is-${state}`;
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(error instanceof Error ? error.message : t('journey.loadError'), 0);
}

function errorTitle(error: ApiError): string {
  if (error.code === 'daily_not_prepared') return t('journey.noDailyTitle');
  if (
    error.code === 'vault_disabled' ||
    error.code === 'vault_not_configured' ||
    error.code === 'vault_owner_not_configured'
  ) {
    return t('journey.notConfiguredTitle');
  }
  if (error.code === 'daily_structure_invalid') return t('journey.invalidDailyTitle');
  return t('journey.loadErrorTitle');
}

function errorMessage(error: ApiError): string {
  if (error.code === 'daily_not_prepared') return t('journey.noDailyBody');
  if (
    error.code === 'vault_disabled' ||
    error.code === 'vault_not_configured' ||
    error.code === 'vault_owner_not_configured'
  ) {
    return t('journey.notConfiguredBody');
  }
  if (error.code === 'daily_structure_invalid') return t('journey.invalidDailyBody');
  if (error.status === 401) return t('journey.sessionExpired');
  return error.message || t('journey.loadError');
}

function formatDate(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

function formatTime(mtimeMs: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(mtimeMs));
}

import { api, type AdminStats, type AdminUserItem } from '../api/client';
import { t } from '../i18n';
import { showToast } from '../ui/toast';
import { renderContentTab } from './libraryAdminView';

export type AdminTab = 'dashboard' | 'users' | 'content';

let overlay: HTMLElement | null = null;
let stats: AdminStats | null = null;
let users: AdminUserItem[] = [];
let totalUsers = 0;
let search = '';
let offset = 0;
let loadingUsers = false;
let loadingStats = false;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let activeTab: AdminTab = 'dashboard';
let contentTabRenderer: ((body: HTMLElement) => void) | null = null;

const PAGE_SIZE = 25;

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

/**
 * The content tab lives in its own module and registers here, so the shell does
 * not have to import the whole authoring UI eagerly.
 */
export function setContentTabRenderer(renderer: ((body: HTMLElement) => void) | null): void {
  contentTabRenderer = renderer;
}

export function initAdminView(): void {
  if (overlay) return;

  overlay = element('section', 'admin-page');
  overlay.id = 'adminOverlay';
  overlay.hidden = true;
  document.body.appendChild(overlay);

  setContentTabRenderer(renderContentTab);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay && !overlay.hidden) closeAdmin();
  });
  window.addEventListener('popstate', () => {
    if (window.location.hash === '#admin') void openAdmin(false);
    else hideAdmin();
  });
}

export async function openAdmin(updateHistory = true): Promise<void> {
  if (!overlay) initAdminView();
  overlay!.hidden = false;
  document.body.classList.add('admin-page-open');

  if (updateHistory && window.location.hash !== '#admin') {
    window.history.pushState({ admin: true }, '', '#admin');
  }

  renderShell();
}

export function closeAdmin(updateHistory = true): void {
  hideAdmin();
  if (updateHistory && window.location.hash === '#admin') window.history.back();
}

function hideAdmin(): void {
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('admin-page-open');
}

/** Re-renders the shell and the active tab; used after a language switch. */
export function repaintAdmin(): void {
  if (!overlay || overlay.hidden) return;
  renderShell();
}

export function setAdminTab(tab: AdminTab): void {
  if (activeTab === tab) return;
  activeTab = tab;
  syncTabHighlight();
  renderActiveTab();
}

/**
 * Keeps the nav buttons alive across a tab switch, so focus and node identity
 * survive. Rebuilding the whole shell here would also restart the stats fetch.
 */
function syncTabHighlight(): void {
  for (const node of document.querySelectorAll('.admin-tab')) {
    const button = node as HTMLElement;
    button.classList.toggle('is-active', button.dataset.tab === activeTab);
  }
}

function renderShell(): void {
  if (!overlay) return;
  overlay.innerHTML = '';

  const panel = element('div', 'admin-panel');
  panel.setAttribute('role', 'main');
  panel.setAttribute('aria-label', t('admin.title'));

  const nav = element('nav', 'admin-nav');
  const back = element('button', 'admin-back', t('admin.back'));
  back.type = 'button';
  back.addEventListener('click', () => closeAdmin());
  nav.appendChild(back);
  panel.appendChild(nav);

  const head = element('header', 'admin-header');
  const kicker = element('p', 'admin-kicker', 'PREPIFY · ADMIN');
  const title = element('h1', 'admin-title', t('admin.title'));
  const subtitle = element('p', 'admin-subtitle', t('admin.subtitle'));
  head.append(kicker, title, subtitle);
  panel.appendChild(head);

  panel.appendChild(renderTabs());

  const body = element('div', 'admin-tab-body');
  body.id = 'adminTabBody';
  panel.appendChild(body);

  overlay.appendChild(panel);
  renderActiveTab();
}

function renderTabs(): HTMLElement {
  const tabs = element('div', 'admin-tabs');

  const entries: Array<[AdminTab, string]> = [
    ['dashboard', t('admin.tabDashboard')],
    ['users', t('admin.tabUsers')],
    ['content', t('admin.tabContent')],
  ];

  for (const [tab, label] of entries) {
    const button = element('button', `admin-tab${activeTab === tab ? ' is-active' : ''}`, label);
    button.type = 'button';
    button.dataset.tab = tab;
    button.addEventListener('click', () => setAdminTab(tab));
    tabs.appendChild(button);
  }

  return tabs;
}

function renderActiveTab(): void {
  const body = document.getElementById('adminTabBody');
  if (!body) return;
  body.innerHTML = '';

  if (activeTab === 'dashboard') renderDashboardTab(body);
  else if (activeTab === 'users') renderUsersTab(body);
  else contentTabRenderer?.(body);
}

function renderDashboardTab(body: HTMLElement): void {
  const statsRoot = element('div', 'admin-stats');
  statsRoot.id = 'adminStats';
  body.appendChild(statsRoot);
  void loadStats();
}

async function loadStats(): Promise<void> {
  if (loadingStats) return;
  loadingStats = true;
  console.debug('[admin] stats loading started');
  try {
    stats = await api.admin.stats();
    console.debug('[admin] stats loading completed');
  } catch (error) {
    console.error('[admin] stats loading failed', error);
    stats = null;
  } finally {
    loadingStats = false;
    console.debug('[admin] stats loading settled');
  }
  renderStats();
}

function renderStats(): void {
  const root = document.getElementById('adminStats');
  if (!root) return;
  root.innerHTML = '';

  if (!stats) {
    root.appendChild(element('p', 'admin-error', t('admin.loadError')));
    return;
  }

  const cards: Array<[string, string]> = [
    [t('admin.statUsers'), String(stats.totalUsers)],
    [t('admin.statAdmins'), String(stats.totalAdmins)],
    [t('admin.statSessions'), String(stats.activeSessions)],
    [t('admin.statDaily'), String(stats.dailyCompletionsToday)],
  ];
  for (const [label, value] of cards) {
    const card = element('div', 'admin-stat-card');
    card.appendChild(element('span', 'admin-stat-value', value));
    card.appendChild(element('span', 'admin-stat-label', label));
    root.appendChild(card);
  }
}

function renderUsersTab(body: HTMLElement): void {
  const usersHead = element('div', 'admin-users-head');
  const usersTitle = element('h2', 'admin-users-title', t('admin.usersTitle'));
  const searchBox = element('input', 'admin-search') as HTMLInputElement;
  searchBox.type = 'search';
  searchBox.placeholder = t('admin.searchPlaceholder');
  searchBox.value = search;
  searchBox.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      search = searchBox.value.trim();
      void loadUsers(true);
    }, 300);
  });
  usersHead.append(usersTitle, searchBox);
  body.appendChild(usersHead);

  const usersRoot = element('div', 'admin-users');
  usersRoot.id = 'adminUsers';
  body.appendChild(usersRoot);

  void loadUsers(true);
}

async function loadUsers(reset: boolean): Promise<void> {
  if (loadingUsers) return;
  loadingUsers = true;
  console.debug('[admin] users loading started', { reset, search });
  const root = document.getElementById('adminUsers');
  if (reset) {
    offset = 0;
    users = [];
  }
  if (root && reset) root.innerHTML = '<p class="admin-loading">' + t('admin.loading') + '</p>';

  try {
    const result = await api.admin.listUsers(search, PAGE_SIZE, offset);
    totalUsers = result.total;
    users = reset ? result.items : [...users, ...result.items];
    offset += result.items.length;
    renderUsers();
    console.debug('[admin] users loading completed', { count: result.items.length });
  } catch (error) {
    console.error('[admin] users loading failed', error);
    if (root) root.innerHTML = '<p class="admin-error">' + t('admin.loadError') + '</p>';
  } finally {
    loadingUsers = false;
    console.debug('[admin] users loading settled');
  }
}

function renderUsers(): void {
  const root = document.getElementById('adminUsers');
  if (!root) return;
  root.innerHTML = '';

  if (users.length === 0) {
    root.appendChild(element('p', 'admin-empty', t('admin.noUsers')));
    return;
  }

  const table = element('div', 'admin-table');
  const header = element('div', 'admin-row admin-row-head');
  header.appendChild(element('div', 'admin-cell admin-cell-user', t('admin.colUser')));
  header.appendChild(element('div', 'admin-cell admin-cell-role', t('admin.colRole')));
  header.appendChild(element('div', 'admin-cell admin-cell-status', t('admin.colStatus')));
  header.appendChild(element('div', 'admin-cell admin-cell-last', t('admin.colLastSeen')));
  header.appendChild(element('div', 'admin-cell admin-cell-actions', ''));
  table.appendChild(header);

  for (const user of users) table.appendChild(renderUserRow(user));

  root.appendChild(table);

  if (users.length < totalUsers) {
    const more = element('button', 'admin-load-more', t('admin.loadMore'));
    more.type = 'button';
    more.addEventListener('click', () => void loadUsers(false));
    root.appendChild(more);
  }
}

function renderUserRow(user: AdminUserItem): HTMLElement {
  const row = element('div', 'admin-row');

  const userCell = element('div', 'admin-cell admin-cell-user');
  const name = user.displayName || user.email;
  const email = element('div', 'admin-user-name', name);
  const emailLine = element('div', 'admin-user-email', user.email);
  userCell.append(email, emailLine);
  if (user.providers.length > 0) {
    userCell.appendChild(
      element(
        'div',
        'admin-user-oauth',
        t('admin.oauth', { providers: user.providers.join(', ') }),
      ),
    );
  }

  const roleCell = element('div', 'admin-cell admin-cell-role');
  roleCell.appendChild(
    element(
      'span',
      `admin-badge ${user.role === 'admin' ? 'admin-badge-admin' : 'admin-badge-user'}`,
      user.role === 'admin' ? t('admin.roleAdmin') : t('admin.roleUser'),
    ),
  );

  const statusCell = element('div', 'admin-cell admin-cell-status');
  const statusParts: string[] = [];
  statusParts.push(user.disabled ? t('admin.disabled') : t('admin.active'));
  statusParts.push(user.emailVerifiedAt ? t('admin.verified') : t('admin.unverified'));
  statusCell.appendChild(
    element(
      'span',
      `admin-badge ${user.disabled ? 'admin-badge-disabled' : 'admin-badge-active'}`,
      statusParts.join(' · '),
    ),
  );

  const lastCell = element('div', 'admin-cell admin-cell-last');
  lastCell.textContent = user.lastSeenAt
    ? new Date(user.lastSeenAt).toLocaleString()
    : t('admin.never');

  const actionsCell = element('div', 'admin-cell admin-cell-actions');
  const roleBtn = element(
    'button',
    'admin-action',
    user.role === 'admin' ? t('admin.makeUser') : t('admin.makeAdmin'),
  );
  roleBtn.type = 'button';
  roleBtn.addEventListener(
    'click',
    () => void patchUser(user.id, { role: user.role === 'admin' ? 'user' : 'admin' }),
  );

  const toggleBtn = element(
    'button',
    `admin-action ${user.disabled ? 'admin-action-enable' : 'admin-action-danger'}`,
    user.disabled ? t('admin.enable') : t('admin.disable'),
  );
  toggleBtn.type = 'button';
  toggleBtn.addEventListener('click', () => void patchUser(user.id, { disabled: !user.disabled }));

  actionsCell.append(roleBtn, toggleBtn);
  row.append(userCell, roleCell, statusCell, lastCell, actionsCell);
  return row;
}

async function patchUser(
  id: string,
  patch: { role?: 'user' | 'admin'; disabled?: boolean },
): Promise<void> {
  try {
    await api.admin.patchUser(id, patch);
    showToast(t('admin.updateOk'), 'ok');
    await loadUsers(true);
  } catch {
    showToast(t('admin.updateFailed'), 'error');
  }
}

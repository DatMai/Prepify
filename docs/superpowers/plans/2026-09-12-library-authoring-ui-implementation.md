# Library Authoring UI Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a UI to author Library content: browse subjects, create one, edit its sections and questions (with a level per question and a full block editor), import and export JSON, and archive or restore a subject.

**Architecture:** The admin overlay becomes a tab shell (Dashboard / Users / Content). A new content tab owns the subject list and the topic editor, a separate question editor owns block editing with pure array operations underneath, and an import modal owns JSON paste/file handling. Everything talks to `/api/v1/library/admin/*` through new `api.libraryAdmin.*` client methods.

**Tech Stack:** Vite 7 + vanilla TypeScript, DOM built with `document.createElement` (no innerHTML for user data), Vitest with jsdom, existing `showToast` for feedback and `esc()` where a string must be interpolated.

**Spec:** `docs/superpowers/specs/2026-09-12-library-content-management-design.md` (section "Admin UI")

**Phase 1 and 2 are merged** (PR #6 and PR #7). The server already exposes every endpoint this phase needs; nothing in this plan changes the server.

## Global Constraints

- No server change in this phase. If something seems to need one, stop and report rather than editing the API.
- Never build DOM for user data with `innerHTML`; use `createElement` and `textContent`. The only `innerHTML` allowed is for static markup with no interpolation.
- Every user-visible string goes through `t()` with a key from the copy table below. No hardcoded Vietnamese or English in the TS files.
- Authorization is the server's job; the UI only hides what is pointless to show. Never gate a mutation on a client-side role check alone.
- Reordering or deleting a section or question **must** warn first: learned progress is keyed positionally (`topic:section:question`), so a reorder makes progress point at different questions.
- `key` is immutable: the UI never sends it after creation. Do not render a key input in the editor.
- Commits after every task. `npm run check` is the single definition of green.

## Copy table

Add these to `src/i18n/vi.ts` and `src/i18n/en.ts`. Keys are grouped by area; each task below uses only the keys it needs.

| Key                          | vi                                                                                        | en                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `admin.tabDashboard`         | Tổng quan                                                                                 | Dashboard                                                                                                          |
| `admin.tabUsers`             | Người dùng                                                                                | Users                                                                                                              |
| `admin.tabContent`           | Nội dung                                                                                  | Content                                                                                                            |
| `libAdmin.locale`            | Ngôn ngữ                                                                                  | Locale                                                                                                             |
| `libAdmin.topicsTitle`       | Môn học                                                                                   | Subjects                                                                                                           |
| `libAdmin.newTopic`          | + Môn mới                                                                                 | + New subject                                                                                                      |
| `libAdmin.fieldKey`          | Key (a-z, 0-9, dấu -)                                                                     | Key (a-z, 0-9, dash)                                                                                               |
| `libAdmin.fieldLabel`        | Nhãn                                                                                      | Label                                                                                                              |
| `libAdmin.fieldTitle`        | Tiêu đề                                                                                   | Title                                                                                                              |
| `libAdmin.fieldSubtitle`     | Mô tả                                                                                     | Subtitle                                                                                                           |
| `libAdmin.fieldColor`        | Màu                                                                                       | Colour                                                                                                             |
| `libAdmin.create`            | Tạo                                                                                       | Create                                                                                                             |
| `libAdmin.cancel`            | Huỷ                                                                                       | Cancel                                                                                                             |
| `libAdmin.save`              | Lưu                                                                                       | Save                                                                                                               |
| `libAdmin.edit`              | Sửa                                                                                       | Edit                                                                                                               |
| `libAdmin.back`              | ← Danh sách môn                                                                           | ← Subject list                                                                                                     |
| `libAdmin.export`            | Xuất JSON                                                                                 | Export JSON                                                                                                        |
| `libAdmin.import`            | Nhập JSON                                                                                 | Import JSON                                                                                                        |
| `libAdmin.archive`           | Lưu trữ                                                                                   | Archive                                                                                                            |
| `libAdmin.restore`           | Bỏ lưu trữ                                                                                | Restore                                                                                                            |
| `libAdmin.archived`          | Đã lưu trữ                                                                                | Archived                                                                                                           |
| `libAdmin.questionCount`     | {n} câu                                                                                   | {n} questions                                                                                                      |
| `libAdmin.sectionsTitle`     | Các phần                                                                                  | Sections                                                                                                           |
| `libAdmin.newSection`        | + Phần mới                                                                                | + New section                                                                                                      |
| `libAdmin.sectionName`       | Tên phần                                                                                  | Section name                                                                                                       |
| `libAdmin.newQuestion`       | + Câu mới                                                                                 | + New question                                                                                                     |
| `libAdmin.questionPrompt`    | Câu hỏi                                                                                   | Question                                                                                                           |
| `libAdmin.questionCode`      | Mã (vd Q1)                                                                                | Code (e.g. Q1)                                                                                                     |
| `libAdmin.level`             | Level                                                                                     | Level                                                                                                              |
| `libAdmin.levelNone`         | Chưa xếp level                                                                            | Unclassified                                                                                                       |
| `libAdmin.levelBasic`        | Cơ bản                                                                                    | Basic                                                                                                              |
| `libAdmin.levelIntermediate` | Trung bình                                                                                | Intermediate                                                                                                       |
| `libAdmin.levelAdvanced`     | Nâng cao                                                                                  | Advanced                                                                                                           |
| `libAdmin.blocksTitle`       | Nội dung trả lời                                                                          | Answer blocks                                                                                                      |
| `libAdmin.addBlock`          | + Thêm block                                                                              | + Add block                                                                                                        |
| `libAdmin.blockText`         | Văn bản                                                                                   | Text                                                                                                               |
| `libAdmin.blockNote`         | Ghi chú                                                                                   | Note                                                                                                               |
| `libAdmin.blockCode`         | Code                                                                                      | Code                                                                                                               |
| `libAdmin.blockTable`        | Bảng                                                                                      | Table                                                                                                              |
| `libAdmin.blockLang`         | Ngôn ngữ code                                                                             | Code language                                                                                                      |
| `libAdmin.addRow`            | + Dòng                                                                                    | + Row                                                                                                              |
| `libAdmin.addColumn`         | + Cột                                                                                     | + Column                                                                                                           |
| `libAdmin.removeRow`         | − Dòng                                                                                    | − Row                                                                                                              |
| `libAdmin.removeColumn`      | − Cột                                                                                     | − Column                                                                                                           |
| `libAdmin.moveUp`            | Chuyển lên                                                                                | Move up                                                                                                            |
| `libAdmin.moveDown`          | Chuyển xuống                                                                              | Move down                                                                                                          |
| `libAdmin.remove`            | Xoá                                                                                       | Remove                                                                                                             |
| `libAdmin.reorderWarning`    | Thứ tự câu gắn với tiến độ đã học. Đổi thứ tự sẽ làm tiến độ trỏ sang câu khác. Tiếp tục? | Question order is tied to learned progress. Reordering makes that progress point at different questions. Continue? |
| `libAdmin.deleteWarning`     | Xoá vĩnh viễn mục này? Bạn sẽ nhận được một snapshot để khôi phục nếu cần.                | Permanently delete this item? You will get a snapshot you can restore from.                                        |
| `libAdmin.downloadSnapshot`  | Tải snapshot                                                                              | Download snapshot                                                                                                  |
| `libAdmin.importTitle`       | Nhập JSON vào môn này                                                                     | Import JSON into this subject                                                                                      |
| `libAdmin.importPaste`       | Dán JSON                                                                                  | Paste JSON                                                                                                         |
| `libAdmin.importFile`        | Chọn file .json                                                                           | Choose a .json file                                                                                                |
| `libAdmin.importTemplate`    | Chèn template mẫu                                                                         | Insert sample template                                                                                             |
| `libAdmin.importMode`        | Cách nhập                                                                                 | Mode                                                                                                               |
| `libAdmin.importModeReplace` | Thay thế toàn bộ nội dung                                                                 | Replace everything                                                                                                 |
| `libAdmin.importModeAppend`  | Thêm vào cuối                                                                             | Append                                                                                                             |
| `libAdmin.importPreview`     | Đọc được {sections} phần · {questions} câu                                                | Parsed {sections} sections · {questions} questions                                                                 |
| `libAdmin.importInvalidJson` | JSON không hợp lệ: {message}                                                              | Invalid JSON: {message}                                                                                            |
| `libAdmin.importDone`        | Đã nhập {sections} phần, {questions} câu                                                  | Imported {sections} sections, {questions} questions                                                                |
| `libAdmin.saveFailed`        | Không lưu được thay đổi.                                                                  | Could not save the change.                                                                                         |
| `libAdmin.saved`             | Đã lưu.                                                                                   | Saved.                                                                                                             |

## Test strategy

- Pure functions (block operations, import parsing, payload building) get real unit tests. This is where TDD pays off.
- DOM views get jsdom tests that mock `api.libraryAdmin` and assert on rendered text, class names and the payloads sent. Follow `src/admin/adminView.test.ts`, which already mocks `../api/client` with `vi.mock`.
- Every view test ends by asserting nothing was sent when validation fails.
- The live browser smoke in Task 7 is the phase gate: it must exercise the whole surface against the real database, then clean up.

---

### Task 1: Client methods for the authoring API

**Files:**

- Modify: `src/api/client.ts`
- Test: `src/api/client.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces `api.libraryAdmin.*`:

```ts
type AdminTopicListItem = {
  id: string; key: string; label: string; title: string; subtitle: string | null;
  color: string; position: number; archived: boolean; questionCount: number;
};
type AdminLevel = 'basic' | 'intermediate' | 'advanced';
type AdminBlock =
  | { type: 'text'; text: string }
  | { type: 'note'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'table'; rows: string[][]; headerDone?: boolean; closed?: boolean };
type AdminQuestion = { id: string; position: number; code: string | null; prompt: string; level: AdminLevel | null; blocks: AdminBlock[] };
type AdminSection = { id: string; position: number; name: string; questions: AdminQuestion[] };
type AdminTopicDetail = {
  id: string; key: string; locale: 'vi' | 'en'; label: string; title: string;
  subtitle: string | null; color: string; position: number; archived: boolean; sections: AdminSection[];
};
type AdminDailyEntry = {
  id: string; entryId: string; locale: 'vi' | 'en'; type: 'mcq' | 'fib'; difficulty: number;
  questionId: string | null; topicKey: string | null; prompt: string | null;
  blanks: string[] | null; hint: string | null; position: number;
};
type AdminDocument = {
  title: string; subtitle: string | null; label: string; color: string;
  sections: Array<{ name: string; questions: Array<{ code: string | null; level: AdminLevel | null; q: string; blocks: AdminBlock[] }> }>;
};

api.libraryAdmin = {
  listTopics(locale, includeArchived?): Promise<{ items: AdminTopicListItem[] }>,
  getTopic(id): Promise<AdminTopicDetail>,
  createTopic(input: { key; locale; label; title; subtitle; color }): Promise<{ id: string }>,
  updateTopic(id, patch: { label?; title?; subtitle?: string | null; color?; position? }): Promise<void>,
  archiveTopic(id): Promise<{ snapshot: AdminDocument }>,
  restoreTopic(id): Promise<void>,
  exportTopic(id): Promise<AdminDocument>,
  importTopic(id, mode: 'replace' | 'append', document: AdminDocument): Promise<{ sections: number; questions: number }>,
  createSection(topicId, name): Promise<{ id: string }>,
  updateSection(id, patch: { name?; position? }): Promise<void>,
  deleteSection(id): Promise<{ snapshot: AdminDocument }>,
  createQuestion(sectionId, input: { code: string | null; prompt; level: AdminLevel | null; blocks: AdminBlock[] }): Promise<{ id: string }>,
  updateQuestion(id, patch: { code?: string | null; prompt?; level?: AdminLevel | null; blocks?: AdminBlock[]; position? }): Promise<void>,
  deleteQuestion(id): Promise<{ snapshot: AdminDocument }>,
};
```

- [ ] **Step 1: Write the failing tests**

Append to `src/api/client.test.ts`:

```ts
it('requests the admin topic list for a locale', async () => {
  const { api } = await import('./client');
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  await api.libraryAdmin.listTopics('en', true);

  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'http://localhost:3001/api/v1/library/admin/topics?lang=en&includeArchived=1',
  );
});

it('patches a question with a level change', async () => {
  const { api } = await import('./client');
  const fetchMock = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 204 }));

  await api.libraryAdmin.updateQuestion('q-1', { level: 'advanced' });

  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'http://localhost:3001/api/v1/library/admin/questions/q-1',
  );
  expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('PATCH');
  expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ level: 'advanced' }));
});

it('imports a document with an explicit mode', async () => {
  const { api } = await import('./client');
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ sections: 1, questions: 2 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  await api.libraryAdmin.importTopic('t-1', 'replace', {
    title: 'T',
    subtitle: null,
    label: 'L',
    color: '#000000',
    sections: [],
  });

  expect(fetchMock.mock.calls[0]?.[0]).toBe(
    'http://localhost:3001/api/v1/library/admin/topics/t-1/import',
  );
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ mode: 'replace' });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL — `api.libraryAdmin` is undefined.

- [ ] **Step 3: Implement**

Add the types and the `libraryAdmin` group to the `api` object in `src/api/client.ts`, next to the existing `admin` group, using `apiRequest` for every call (it already handles credentials, timeouts and error-code translation). `createTopic` and `importTopic` send JSON bodies; `updateQuestion`/`updateSection`/`updateTopic` send `PATCH`; delete calls return the `{ snapshot }` body.

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test -- src/api/client.test.ts && npm run typecheck`
Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api/client.ts src/api/client.test.ts
git commit -m "feat(client): API soạn nội dung Library"
```

---

### Task 2: Admin tab shell

**Files:**

- Modify: `src/admin/adminView.ts`
- Modify: `src/admin/adminView.test.ts`
- Modify: `src/i18n/vi.ts`, `src/i18n/en.ts` (tab keys and `libAdmin.*` copy table)

**Interfaces:**

- Consumes: nothing new.
- Produces: `type AdminTab = 'dashboard' | 'users' | 'content'`; `setAdminTab(tab: AdminTab): void` (used by tests and by the content tab to come back); `renderShell()` now draws a tab bar and one `#adminTabBody` container that holds the active tab. `repaintAdmin()` re-renders the active tab only, so a language switch does not reset the shell's scroll or the content tab's state.

- [ ] **Step 1: Write the failing tests**

Replace the body of `src/admin/adminView.test.ts` with tests that cover the tabs:

```ts
it('opens on the dashboard tab and shows the stat cards', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.admin.stats).mockResolvedValue(stats);

  const { openAdmin } = await import('./adminView');
  await openAdmin(false);
  await settled();

  expect(document.querySelector('.admin-tab.is-active')?.textContent).toBe(t('admin.tabDashboard'));
  expect(document.querySelector('.admin-stat-value')?.textContent).toBe('10');
  expect(api.admin.listUsers).not.toHaveBeenCalled();
});

it('loads users only when the users tab is opened', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.admin.stats).mockResolvedValue(stats);
  vi.mocked(api.admin.listUsers).mockResolvedValue({ total: 1, items: [user] });

  const { openAdmin, setAdminTab } = await import('./adminView');
  await openAdmin(false);
  setAdminTab('users');
  await settled();

  expect(api.admin.listUsers).toHaveBeenCalledTimes(1);
  expect(document.body.textContent).toContain('User One');
});

it('sanitises a user email in the users tab', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.admin.stats).mockResolvedValue(stats);
  vi.mocked(api.admin.listUsers).mockResolvedValue({ total: 1, items: [user] });

  const { openAdmin, setAdminTab } = await import('./adminView');
  await openAdmin(false);
  setAdminTab('users');
  await settled();

  expect(document.querySelector('.admin-user-email img')).toBeNull();
  expect(document.querySelector('.admin-user-email')?.textContent).toContain('<img');
});

it('keeps the dashboard as the tab that opens by default after a repaint', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.admin.stats).mockResolvedValue(stats);

  const { openAdmin, repaintAdmin } = await import('./adminView');
  await openAdmin(false);
  repaintAdmin();
  await settled();

  expect(document.querySelectorAll('.admin-tab')).toHaveLength(3);
  expect(document.querySelector('.admin-stat-value')?.textContent).toBe('10');
});
```

Keep the existing fixture constants (`stats`, `user`) and the `memoryStorage`/`settled` helpers; add `import { t } from '../i18n';` for the tab-label assertion. The `loadUsers` call must move out of `openAdmin` — that is the behaviour change these tests pin.

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/admin/adminView.test.ts`
Expected: FAIL — `.admin-tab` does not exist and `setAdminTab` is not exported.

- [ ] **Step 3: Implement the shell**

In `src/admin/adminView.ts`:

```ts
export type AdminTab = 'dashboard' | 'users' | 'content';

let activeTab: AdminTab = 'dashboard';

let onTabRender: ((body: HTMLElement) => void) | null = null;

/** The content tab registers here so the shell does not import it eagerly. */
export function setContentTabRenderer(render: ((body: HTMLElement) => void) | null): void {
  onTabRender = render;
}

export function setAdminTab(tab: AdminTab): void {
  activeTab = tab;
  renderActiveTab();
}

function tabButton(tab: AdminTab, label: string): HTMLButtonElement {
  const button = element('button', `admin-tab${activeTab === tab ? ' is-active' : ''}`, label);
  button.type = 'button';
  button.dataset.tab = tab;
  button.addEventListener('click', () => setAdminTab(tab));
  return button;
}
```

`renderShell()` keeps the existing nav and header, then appends the tab bar and the body container:

```ts
const tabs = element('div', 'admin-tabs');
tabs.append(
  tabButton('dashboard', t('admin.tabDashboard')),
  tabButton('users', t('admin.tabUsers')),
  tabButton('content', t('admin.tabContent')),
);
panel.appendChild(tabs);

const body = element('div', 'admin-tab-body');
body.id = 'adminTabBody';
panel.appendChild(body);
```

`renderActiveTab()` clears `#adminTabBody` and dispatches:

```ts
function renderActiveTab(): void {
  const body = document.getElementById('adminTabBody');
  if (!body) return;
  body.innerHTML = '';
  if (activeTab === 'dashboard') void loadStats(body);
  else if (activeTab === 'users') void renderUsersTab(body);
  else onTabRender?.(body);
}
```

`loadStats`/`renderStats` take the body element instead of looking up `#adminStats`. `renderUsersTab(body)` builds the search input and the users container inside `body`, then calls `loadUsers(true)`. `openAdmin` becomes:

```ts
overlay!.hidden = false;
document.body.classList.add('admin-page-open');
if (updateHistory && window.location.hash !== '#admin') {
  window.history.pushState({ admin: true }, '', '#admin');
}
renderShell();
```

`repaintAdmin()` becomes `renderShell()`, which already re-renders the active tab.

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test -- src/admin/adminView.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Add the copy table keys**

Add every key from the copy table to both i18n files. Run `npm run typecheck` afterwards; a missing key in one locale is not a type error, so also run the check in Step 6.

- [ ] **Step 6: Verify the key sets match**

Add this test to `src/i18n/index.test.ts` (create the file if it does not exist):

```ts
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { vi } from './vi';

describe('i18n dictionaries', () => {
  it('expose exactly the same keys in both locales', () => {
    const viKeys = Object.keys(vi).sort();
    const enKeys = Object.keys(en).sort();

    expect(enKeys.filter((key) => !viKeys.includes(key))).toEqual([]);
    expect(viKeys.filter((key) => !enKeys.includes(key))).toEqual([]);
  });
});
```

Run: `npm test -- src/i18n/index.test.ts`
Expected: PASS. This test is the guard that stops a future key landing in only one locale.

- [ ] **Step 7: Commit**

```bash
git add src/admin/adminView.ts src/admin/adminView.test.ts src/i18n src/i18n/index.test.ts
git commit -m "feat(admin): tách admin panel thành 3 tab"
```

---

### Task 3: Content tab — subject list

**Files:**

- Create: `src/admin/libraryAdminView.ts`
- Test: `src/admin/libraryAdminView.test.ts`

**Interfaces:**

- Consumes: `api.libraryAdmin.*` (Task 1), `setContentTabRenderer` (Task 2).
- Produces: `registerContentTab(): void` — the shell's entry point, called once from `src/admin/adminView.ts`'s `initAdminView` via `setContentTabRenderer`; `renderContentTab(body: HTMLElement): void`; and these exported helpers used by Task 4:

```ts
export function setContentLocale(locale: 'vi' | 'en'): void;
export function currentContentLocale(): 'vi' | 'en';
export function reloadTopics(): Promise<void>;
export function openTopicEditor(topicId: string): Promise<void>;
export function closeTopicEditor(): void;
```

**Behaviour:** the list shows one row per subject: label, key, question count, an "archived" badge, and the actions Edit, Export, Archive/Restore. A locale switch (vi/en) reloads the list. `+ New subject` opens an inline form with key, label, title, subtitle and colour, and does **not** send `key` anywhere else. Archive asks for confirmation, then downloads the snapshot via `downloadJson` and reloads.

- [ ] **Step 1: Write the failing tests**

`src/admin/libraryAdminView.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminTopicDetail, AdminTopicListItem } from '../api/client';

vi.mock('../api/client', () => ({
  api: {
    libraryAdmin: {
      listTopics: vi.fn(),
      getTopic: vi.fn(),
      createTopic: vi.fn(),
      archiveTopic: vi.fn(),
      restoreTopic: vi.fn(),
      exportTopic: vi.fn(),
      importTopic: vi.fn(),
      createSection: vi.fn(),
      updateSection: vi.fn(),
      deleteSection: vi.fn(),
      createQuestion: vi.fn(),
      updateQuestion: vi.fn(),
      deleteQuestion: vi.fn(),
    },
  },
}));

const topic: AdminTopicListItem = {
  id: 't-1',
  key: 'dsa',
  label: 'DSA',
  title: 'Data Structures',
  subtitle: null,
  color: '#B71C1C',
  position: 0,
  archived: false,
  questionCount: 58,
};

function mount(): HTMLElement {
  const body = document.createElement('div');
  document.body.appendChild(body);
  return body;
}

function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('content tab', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '';
  });

  it('lists subjects with their question count and requests the active locale', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    await settled();

    expect(api.libraryAdmin.listTopics).toHaveBeenCalledWith('vi', true);
    expect(document.querySelector('.la-topic-key')?.textContent).toBe('dsa');
    expect(document.body.textContent).toContain('58');
  });

  it('reloads the list when the locale switches', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [] });
    const { renderContentTab, setContentLocale } = await import('./libraryAdminView');

    renderContentTab(mount());
    setContentLocale('en');
    await settled();

    expect(api.libraryAdmin.listTopics).toHaveBeenLastCalledWith('en', true);
  });

  it('creates a subject with the form values and then reloads', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [] });
    vi.mocked(api.libraryAdmin.createTopic).mockResolvedValue({ id: 't-2' });
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    (document.querySelector('.la-new-topic') as HTMLButtonElement).click();
    await settled();

    (document.querySelector('[name="key"]') as HTMLInputElement).value = 'system-design';
    (document.querySelector('[name="label"]') as HTMLInputElement).value = 'System Design';
    (document.querySelector('[name="title"]') as HTMLInputElement).value = 'System Design';
    (document.querySelector('[name="color"]') as HTMLInputElement).value = '#123456';
    (document.querySelector('.la-create-submit') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.libraryAdmin.createTopic).toHaveBeenCalledWith({
      key: 'system-design',
      locale: 'vi',
      label: 'System Design',
      title: 'System Design',
      subtitle: null,
      color: '#123456',
    });
    expect(api.libraryAdmin.listTopics).toHaveBeenCalledTimes(2);
  });

  it('does not create anything when the form is incomplete', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [] });
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    (document.querySelector('.la-new-topic') as HTMLButtonElement).click();
    await settled();
    (document.querySelector('.la-create-submit') as HTMLButtonElement).click();
    await settled();

    expect(api.libraryAdmin.createTopic).not.toHaveBeenCalled();
    expect(document.querySelector('.la-form-error')?.textContent).toBeTruthy();
  });

  it('archives after confirmation and downloads the snapshot', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
    vi.mocked(api.libraryAdmin.archiveTopic).mockResolvedValue({
      snapshot: { title: 'T', subtitle: null, label: 'L', color: '#000000', sections: [] },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { renderContentTab, setSnapshotDownloader } = await import('./libraryAdminView');
    const download = vi.fn();
    setSnapshotDownloader(download);

    renderContentTab(mount());
    await settled();
    await settled();
    (document.querySelector('.la-archive') as HTMLButtonElement).click();
    await settled();
    await settled();

    expect(api.libraryAdmin.archiveTopic).toHaveBeenCalledWith('t-1');
    expect(download).toHaveBeenCalledWith('dsa.json', expect.any(Object));
  });

  it('does nothing when the confirmation is declined', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    await settled();
    (document.querySelector('.la-archive') as HTMLButtonElement).click();
    await settled();

    expect(api.libraryAdmin.archiveTopic).not.toHaveBeenCalled();
  });

  it('marks an archived subject and offers restore instead', async () => {
    const { api } = await import('../api/client');
    vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({
      items: [{ ...topic, archived: true }],
    });
    const { renderContentTab } = await import('./libraryAdminView');

    renderContentTab(mount());
    await settled();
    await settled();

    expect(document.querySelector('.la-badge-archived')?.textContent).toBeTruthy();
    expect(document.querySelector('.la-restore')).not.toBeNull();
    expect(document.querySelector('.la-archive')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/admin/libraryAdminView.test.ts`
Expected: FAIL — cannot resolve `./libraryAdminView`.

- [ ] **Step 3: Implement**

Create `src/admin/libraryAdminView.ts` with:

- Module state: `let locale: 'vi' | 'en' = 'vi'`, `let topics: AdminTopicListItem[] = []`, `let body: HTMLElement | null = null`, `let editorTopicId: string | null = null`, `let snapshotDownloader: (name: string, document: unknown) => void = downloadJson`.
- `setSnapshotDownloader(fn)` — the seam the test uses instead of touching the DOM download path. `downloadJson(name, document)` creates a `Blob` of `JSON.stringify(document, null, 2)`, an object URL, a temporary anchor and clicks it, then revokes the URL.
- `renderContentTab(target)`: stores `body = target`, renders the toolbar (locale switch, `+ New subject`) and the list container, then calls `reloadTopics()`.
- `reloadTopics()`: `const { items } = await api.libraryAdmin.listTopics(locale, true)`, store, `renderTopicList()`.
- `renderTopicList()`: for each topic a `.la-topic` row containing `.la-topic-label`, `.la-topic-key`, a `.la-topic-count` with `t('libAdmin.questionCount', { n })`, `.la-badge-archived` when archived, and the action buttons `.la-edit`, `.la-export`, `.la-archive`/`.la-restore`.
- `renderNewTopicForm()`: inline form with `name="key"`, `name="label"`, `name="title"`, `name="subtitle"`, `name="color"` (type `color`), `.la-form-error` for the message, `.la-create-submit`. Client-side check: `key` matches `/^[a-z0-9-]{2,40}$/`, `label`, `title` non-empty, `color` matches `/^#[0-9a-fA-F]{6}$/`; on failure set `.la-form-error` and return without calling the API.
- Archive: `if (!window.confirm(t('libAdmin.deleteWarning'))) return;` → `const { snapshot } = await api.libraryAdmin.archiveTopic(id)` → `snapshotDownloader(\`${topic.key}.json\`, snapshot)`→`reloadTopics()`. Show `showToast(t('libAdmin.saveFailed'), 'error')` on a thrown error.
- Any thrown API error is caught and reported with `showToast`; never let a rejection escape as an unhandled promise.

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test -- src/admin/libraryAdminView.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Register the tab**

In `src/admin/adminView.ts`'s `initAdminView`, wire the content tab once:

```ts
setContentTabRenderer(renderContentTab);
```

with `import { renderContentTab } from './libraryAdminView';`. Add a test in `adminView.test.ts` asserting that switching to the content tab calls `api.libraryAdmin.listTopics` once.

- [ ] **Step 6: Commit**

```bash
git add src/admin/libraryAdminView.ts src/admin/libraryAdminView.test.ts src/admin/adminView.ts src/admin/adminView.test.ts
git commit -m "feat(admin): tab Nội dung — danh sách môn, tạo môn, archive/restore"
```

---

### Task 4: Topic editor — sections and questions list

**Files:**

- Modify: `src/admin/libraryAdminView.ts`
- Test: `src/admin/libraryAdminView.test.ts`

**Interfaces:**

- Consumes: Task 3's state and helpers, Task 5's question editor.
- Produces: `openTopicEditor(topicId)`, `closeTopicEditor()`, `reloadTopicDetail()`, `renderEditor()`. The editor replaces the list inside `#adminTabBody` and shows: a back button, the topic metadata form, the sections list, and per section the question rows.

**Behaviour:** each question row shows `code`, a level `<select>` (unclassified / basic / intermediate / advanced), the prompt, and buttons: Edit (opens the question editor), up, down, delete. Each section row shows its name, a rename input, a move up/down pair, and delete. Moving or deleting asks for confirmation with `t('libAdmin.reorderWarning')` / `t('libAdmin.deleteWarning')` first; deletes download the returned snapshot.

- [ ] **Step 1: Write the failing tests**

Append to `src/admin/libraryAdminView.test.ts`:

```ts
const detail: AdminTopicDetail = {
  id: 't-1',
  key: 'dsa',
  locale: 'vi',
  label: 'DSA',
  title: 'Data Structures',
  subtitle: null,
  color: '#B71C1C',
  position: 0,
  archived: false,
  sections: [
    {
      id: 's-1',
      position: 0,
      name: 'Phần I',
      questions: [
        { id: 'q-1', position: 0, code: 'Q1', prompt: 'Array là gì?', level: 'basic', blocks: [] },
        { id: 'q-2', position: 1, code: 'Q2', prompt: 'Linked list?', level: null, blocks: [] },
      ],
    },
  ],
};

it('opens the editor pinned to one topic and renders its sections and questions', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  const { renderContentTab } = await import('./libraryAdminView');

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();

  expect(api.libraryAdmin.getTopic).toHaveBeenCalledWith('t-1');
  expect(document.querySelector('.la-section-name')?.textContent).toBe('Phần I');
  expect(document.querySelectorAll('.la-question')).toHaveLength(2);
  expect(document.body.textContent).toContain('Array là gì?');
});

it('sends a level change for one question only', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  vi.mocked(api.libraryAdmin.updateQuestion).mockResolvedValue(undefined);
  const { renderContentTab } = await import('./libraryAdminView');

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();

  const select = document.querySelector(
    '.la-question[data-question="q-2"] .la-level',
  ) as HTMLSelectElement;
  select.value = 'intermediate';
  select.dispatchEvent(new Event('change'));
  await settled();

  expect(api.libraryAdmin.updateQuestion).toHaveBeenCalledWith('q-2', { level: 'intermediate' });
});

it('never renumbers a question unless the move is confirmed', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const { renderContentTab } = await import('./libraryAdminView');

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();
  (
    document.querySelector('.la-question[data-question="q-2"] .la-move-up') as HTMLButtonElement
  ).click();
  await settled();

  expect(api.libraryAdmin.updateQuestion).not.toHaveBeenCalled();
});

it('moves a question to the previous index when confirmed', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  vi.mocked(api.libraryAdmin.updateQuestion).mockResolvedValue(undefined);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { renderContentTab } = await import('./libraryAdminView');

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();
  (
    document.querySelector('.la-question[data-question="q-2"] .la-move-up') as HTMLButtonElement
  ).click();
  await settled();

  expect(api.libraryAdmin.updateQuestion).toHaveBeenCalledWith('q-2', { position: 0 });
});

it('deletes a question and downloads the snapshot, but only after confirmation', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  vi.mocked(api.libraryAdmin.deleteQuestion).mockResolvedValue({
    snapshot: { title: 'T', subtitle: null, label: 'L', color: '#000000', sections: [] },
  });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const { renderContentTab, setSnapshotDownloader } = await import('./libraryAdminView');
  const download = vi.fn();
  setSnapshotDownloader(download);

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();
  (
    document.querySelector('.la-question[data-question="q-1"] .la-delete') as HTMLButtonElement
  ).click();
  await settled();
  await settled();

  expect(api.libraryAdmin.deleteQuestion).toHaveBeenCalledWith('q-1');
  expect(download).toHaveBeenCalledWith('dsa.json', expect.any(Object));
});

it('adds a section through the API and reloads the editor', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  vi.mocked(api.libraryAdmin.createSection).mockResolvedValue({ id: 's-2' });
  const { renderContentTab } = await import('./libraryAdminView');

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();
  (document.querySelector('.la-new-section') as HTMLButtonElement).click();
  await settled();
  (document.querySelector('[name="sectionName"]') as HTMLInputElement).value = 'Phần II';
  (document.querySelector('.la-section-submit') as HTMLButtonElement).click();
  await settled();
  await settled();

  expect(api.libraryAdmin.createSection).toHaveBeenCalledWith('t-1', 'Phần II');
  expect(api.libraryAdmin.getTopic).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/admin/libraryAdminView.test.ts`
Expected: FAIL — `.la-section-name` and the editor actions do not exist.

- [ ] **Step 3: Implement**

- `openTopicEditor(topicId)`: set `editorTopicId`, `renderEditor()`, then `await reloadTopicDetail()`.
- `reloadTopicDetail()`: `detail = await api.libraryAdmin.getTopic(editorTopicId)`; `renderEditor()`.
- `renderEditor()`: when `detail` is null show `t('admin.loading')`; otherwise render, in order, the back button (`.la-back` → `closeTopicEditor()`), the metadata form (label, title, subtitle, colour + `.la-save-meta`), the actions row (`.la-export`, `.la-import`, `.la-archive`), the sections container, and `.la-new-section`.
- Every mutation follows the same shape: confirm when needed, call the API, `showToast(t('libAdmin.saved'), 'ok')`, then `await reloadTopicDetail()`. On error `showToast(t('libAdmin.saveFailed'), 'error')` and leave the UI as it was.
- Row data attributes: `.la-question[data-question="<id>"]`, `.la-section[data-section="<id>"]`, so tests and the DOM stay addressable without CSS classes that encode ids.
- Level select options come from a single helper `renderLevelSelect(value, onChange)` shared with Task 5, with `t('libAdmin.levelNone')` for the empty option.
- The move-up button is disabled on the first row and move-down on the last, so the UI cannot send a no-op move.

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test -- src/admin/libraryAdminView.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/admin/libraryAdminView.ts src/admin/libraryAdminView.test.ts
git commit -m "feat(admin): editor môn — phần và câu hỏi"
```

---

### Task 5: Question editor and block editor

**Files:**

- Create: `src/admin/questionEditor.ts`
- Test: `src/admin/questionEditor.test.ts`
- Modify: `src/admin/libraryAdminView.ts` (open the editor from a question row)

**Interfaces:**

- Consumes: `AdminBlock`, `AdminLevel`, `AdminQuestion` from `../api/client`.
- Produces pure functions (fully unit tested, no DOM):

```ts
export function addBlock(blocks: AdminBlock[], type: AdminBlock['type']): AdminBlock[];
export function removeBlock(blocks: AdminBlock[], index: number): AdminBlock[];
export function moveBlock(blocks: AdminBlock[], index: number, delta: -1 | 1): AdminBlock[];
export function setBlockText(blocks: AdminBlock[], index: number, text: string): AdminBlock[];
export function setBlockLang(blocks: AdminBlock[], index: number, lang: string): AdminBlock[];
export function setTableCell(
  blocks: AdminBlock[],
  index: number,
  row: number,
  column: number,
  value: string,
): AdminBlock[];
export function addTableRow(blocks: AdminBlock[], index: number): AdminBlock[];
export function removeTableRow(blocks: AdminBlock[], index: number): AdminBlock[];
export function addTableColumn(blocks: AdminBlock[], index: number): AdminBlock[];
export function removeTableColumn(blocks: AdminBlock[], index: number): AdminBlock[];
```

and one DOM entry point:

```ts
export function openQuestionEditor(input: {
  question: AdminQuestion | null;
  sectionId: string;
  onSaved: () => Promise<void> | void;
  onCancel: () => void;
}): void;
```

`question: null` means "create a new question in this section".

**Rules:** a table is always at least 1×1 and at most 50×10 — the remove buttons disable at the floor and the add buttons at the ceiling, matching the server's `MAX_TABLE_ROWS`/`MAX_TABLE_COLUMNS`. Every operation returns a **new** array (no in-place mutation), because the caller keeps the previous value for cancel.

- [ ] **Step 1: Write the failing tests**

`src/admin/questionEditor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
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
} from './questionEditor';

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
    const tall: AdminBlock = {
      type: 'table',
      rows: Array.from({ length: 50 }, () => ['x']),
    };

    expect(addTableColumn([wide], 0)).toEqual([wide]);
    expect(addTableRow([tall], 0)).toEqual([tall]);
  });

  it('leaves non-table blocks alone when a table operation is applied to them', () => {
    expect(setTableCell([text], 0, 0, 0, 'X')).toEqual([text]);
    expect(addTableRow([text], 0)).toEqual([text]);
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/admin/questionEditor.test.ts`
Expected: FAIL — cannot resolve `./questionEditor`.

- [ ] **Step 3: Implement the pure operations**

Implement each function with immutable updates (`blocks.map((block, i) => i === index ? { ...block, ... } : block)`), a `replaceAt` helper, and `MAX_TABLE_ROWS = 50` / `MAX_TABLE_COLUMNS = 10` constants that mirror the server's ceilings. Guard every table operation with a type check so a wrong index or a non-table block is a no-op rather than a crash. A new table starts with `rows: [['', '']]` and `headerDone: true`, matching the corpus shape.

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test -- src/admin/questionEditor.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing DOM test**

Append to `src/admin/questionEditor.test.ts`:

```ts
it('renders one editor row per block and reports the level', async () => {
  document.body.innerHTML = '';
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
  document.body.innerHTML = '';
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
```

- [ ] **Step 6: Run to verify RED, then implement the DOM layer**

Implement `openQuestionEditor` as an overlay panel rendered into `document.body` (class `qe-panel`), with `.qe-close` → `onCancel`, a `.qe-save` button, `[name="prompt"]`, `[name="code"]`, `.qe-level`, the block list, and the add-block toolbar (`.qe-add-block` select + `.qe-add-block-button`). Save builds the payload (`{ code: code || null, prompt, level: level || null, blocks }`) and calls `api.libraryAdmin.createQuestion` or `updateQuestion`, then `await onSaved()` and closes; errors show `showToast(t('libAdmin.saveFailed'), 'error')` and keep the panel open so nothing the author typed is lost.

- [ ] **Step 7: Run to verify GREEN and commit**

Run: `npm test -- src/admin/questionEditor.test.ts && npm run typecheck`

```bash
git add src/admin/questionEditor.ts src/admin/questionEditor.test.ts src/admin/libraryAdminView.ts
git commit -m "feat(admin): editor câu hỏi và block"
```

---

### Task 6: Import and export JSON

**Files:**

- Modify: `src/admin/libraryAdminView.ts`
- Test: `src/admin/libraryAdminView.test.ts`

**Interfaces:**

- Consumes: `api.libraryAdmin.importTopic`, `exportTopic`, and a new pure helper.
- Produces: `parseImportDocument(raw: string): { ok: true; document: AdminDocument; sections: number; questions: number } | { ok: false; message: string }` — exported for the unit tests — plus `openImportDialog(topicId: string, onDone: () => Promise<void> | void): void` and the sample template constant `SAMPLE_DOCUMENT`.

**Behaviour:** the dialog has a textarea, a file input, a "insert sample template" button, a mode select (`replace` / `append`), a live preview line, and an Import button. Typing or choosing a file re-parses; a parse failure or a structurally invalid document shows the reason and disables Import. **Nothing is written until Import is pressed**, and if the server rejects the document the returned `path` is shown — no write happens on a rejection, so showing the server error still satisfies "validate before writing".

- [ ] **Step 1: Write the failing tests**

Append to `src/admin/libraryAdminView.test.ts`:

```ts
import { parseImportDocument, SAMPLE_DOCUMENT } from './libraryAdminView';

describe('parseImportDocument', () => {
  const valid = {
    title: 'T',
    subtitle: null,
    label: 'L',
    color: '#000000',
    sections: [
      {
        name: 'S',
        questions: [
          { code: 'Q1', level: 'basic', q: 'one', blocks: [{ type: 'text', text: 'a' }] },
        ],
      },
    ],
  };

  it('accepts a document and counts its content', () => {
    const result = parseImportDocument(JSON.stringify(valid));

    expect(result).toMatchObject({ ok: true, sections: 1, questions: 1 });
  });

  it('reports invalid JSON with the parser message', () => {
    const result = parseImportDocument('{ not json');

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('message');
  });

  it('rejects a document that is missing required fields', () => {
    expect(parseImportDocument(JSON.stringify({ title: 'T' })).ok).toBe(false);
    expect(parseImportDocument(JSON.stringify({ ...valid, color: 'red' })).ok).toBe(false);
    expect(parseImportDocument(JSON.stringify({ ...valid, sections: [] })).ok).toBe(false);
  });

  it('rejects a question with an unknown block type', () => {
    const broken = {
      ...valid,
      sections: [{ name: 'S', questions: [{ q: 'x', blocks: [{ type: 'image' }] }] }],
    };

    expect(parseImportDocument(JSON.stringify(broken)).ok).toBe(false);
  });

  it('ships a sample template that parses', () => {
    const result = parseImportDocument(JSON.stringify(SAMPLE_DOCUMENT));

    expect(result.ok).toBe(true);
  });
});

it('imports a pasted document with the chosen mode and reloads', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  vi.mocked(api.libraryAdmin.importTopic).mockResolvedValue({ sections: 1, questions: 1 });
  const { renderContentTab, SAMPLE_DOCUMENT: sample } = await import('./libraryAdminView');

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();
  (document.querySelector('.la-import') as HTMLButtonElement).click();
  await settled();

  const textarea = document.querySelector('.la-import-text') as HTMLTextAreaElement;
  textarea.value = JSON.stringify(sample);
  textarea.dispatchEvent(new Event('input'));
  await settled();
  expect(document.querySelector('.la-import-preview')?.textContent).toContain('1');

  (document.querySelector('.la-import-mode') as HTMLSelectElement).value = 'append';
  (document.querySelector('.la-import-submit') as HTMLButtonElement).click();
  await settled();
  await settled();

  expect(api.libraryAdmin.importTopic).toHaveBeenCalledWith('t-1', 'append', sample);
});

it('keeps the import button disabled while the document is invalid', async () => {
  const { api } = await import('../api/client');
  vi.mocked(api.libraryAdmin.listTopics).mockResolvedValue({ items: [topic] });
  vi.mocked(api.libraryAdmin.getTopic).mockResolvedValue(detail);
  const { renderContentTab } = await import('./libraryAdminView');

  renderContentTab(mount());
  await settled();
  await settled();
  (document.querySelector('.la-edit') as HTMLButtonElement).click();
  await settled();
  await settled();
  (document.querySelector('.la-import') as HTMLButtonElement).click();
  await settled();

  const textarea = document.querySelector('.la-import-text') as HTMLTextAreaElement;
  textarea.value = '{ broken';
  textarea.dispatchEvent(new Event('input'));
  await settled();

  expect(document.querySelector('.la-import-error')?.textContent).toBeTruthy();
  expect((document.querySelector('.la-import-submit') as HTMLButtonElement).disabled).toBe(true);
  expect(api.libraryAdmin.importTopic).not.toHaveBeenCalled();
});
```

Add `parseImportDocument` and `SAMPLE_DOCUMENT` to the import block at the top of the file rather than to the bottom:

```ts
import { parseImportDocument, SAMPLE_DOCUMENT } from './libraryAdminView';
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test -- src/admin/libraryAdminView.test.ts`
Expected: FAIL — `parseImportDocument` is not exported.

- [ ] **Step 3: Implement**

`parseImportDocument` validates the shape the server accepts — `title` and `label` non-empty strings, `color` matching `/^#[0-9a-fA-F]{6}$/`, `sections` a non-empty array, each section with a non-empty `name` and a non-empty `questions` array, each question with a non-empty `q`, an optional `code`/`level`, and `blocks` where every entry has a `type` of `text`, `note`, `code` or `table` with the fields that type needs. It returns counts on success and a human-readable message on failure. Keep it a small hand-written validator rather than pulling Zod into the frontend bundle; the server remains the authority, this is only to avoid a pointless round trip.

- [ ] **Step 4: Run to verify GREEN, then add the dialog**

The dialog renders into the editor body: `.la-import-text` (textarea), `.la-import-file` (file input, reads with `file.text()`), `.la-import-template` (fills the textarea with `JSON.stringify(SAMPLE_DOCUMENT, null, 2)`), `.la-import-mode` (select), `.la-import-preview`, `.la-import-error`, `.la-import-submit`, `.la-import-cancel`. Import calls `api.libraryAdmin.importTopic(topicId, mode, document)`, toasts `t('libAdmin.importDone', { sections, questions })` and reloads the detail; a thrown `ApiError` with `code === 'library_invalid_document'` shows its `message` and any `path` in `.la-import-error` and keeps the dialog open.

- [ ] **Step 5: Run to verify GREEN and commit**

Run: `npm test -- src/admin/libraryAdminView.test.ts && npm run typecheck`

```bash
git add src/admin/libraryAdminView.ts src/admin/libraryAdminView.test.ts
git commit -m "feat(admin): nhập và xuất JSON cho môn học"
```

---

### Task 7: Styles, live smoke and documentation

**Files:**

- Modify: `src/styles/admin.css`
- Modify: `README.md`

**Interfaces:** none new.

- [ ] **Step 1: Style the new surface**

Extend `src/styles/admin.css` using the existing tokens (`--bg`, `--txt`, `--muted`, `--border`, `--accent2`, `--font` stacks already in use). Add: `.admin-tabs`/`.admin-tab`/`.is-active`, `.admin-tab-body`, `.la-toolbar`, `.la-topic` grid with label/key/count/badge/actions, `.la-badge-archived`, `.la-form` field grid, `.la-section`/`.la-question` rows, `.la-level`, `.la-move-up`/`.la-move-down` (dimmed when `disabled`), `.qe-panel`, `.qe-block`, `.qe-cell`, `.qe-table-toolbar`, `.la-import-*`. Add a `@media (max-width: 720px)` block collapsing the rows to one column, matching the existing responsive block in that file.

- [ ] **Step 2: Run the whole gate**

Run: `npm run check`
Expected: green, including the new i18n key-parity test.

- [ ] **Step 3: Live smoke in the browser**

With `npm run dev` running, open the admin panel and walk the whole surface. Record each result:

1. The panel opens on Dashboard; the Users tab is unchanged; the Content tab lists 9 subjects with counts.
2. Switch locale to EN: the list reloads and labels are English; switch back to VI.
3. Create a subject with key `ui-smoke`, label, title and colour → it appears in the list.
4. Duplicate the same key → the error is shown and no second row appears.
5. Open the subject, add a section, add a question with `level = basic` and a text block, then a second question with a table block (edit a cell) and a code block (set `lang`).
6. Change a question's level to `advanced` → the toast confirms and the value survives a reload.
7. Move the second question up → the confirmation appears first; cancelling leaves the order unchanged, confirming swaps them.
8. Export the subject → a JSON file downloads whose `sections` match what is on screen.
9. Import that same file back with `replace` → counts reported match, the editor reloads identical content (this also proves the round trip through the UI).
10. Try importing `{ broken` → the error shows and Import stays disabled.
11. Delete the first question → confirmation, snapshot downloads, the row disappears.
12. Archive the subject → it leaves the active list and the snapshot downloads; because the list always requests `includeArchived=true`, the row stays visible with an "archived" badge and a Restore button → Restore brings it back to normal.
13. Delete the throwaway subject's sections and remove the subject row from the database directly, because the API deliberately has no topic delete.
14. Confirm `content/*.json` is untouched (`git status` clean for `content/`) and the Library page still renders 9 subjects with questions and tables intact.

- [ ] **Step 4: Document it**

Add a short paragraph under the existing "Library authoring endpoints" section in `README.md`: the Content tab is where authoring happens, it is admin-only, it warns before reordering or deleting because progress is positional, and it can import/export the JSON format the seed uses.

- [ ] **Step 5: Commit**

```bash
git add src/styles/admin.css README.md
git commit -m "feat(admin): style và docs cho tab Nội dung"
```

---

## Verification

Phase 3 is done when all of the following hold:

- [ ] `npm run check` is green.
- [ ] The admin panel has three working tabs and the Dashboard/Users behaviour is unchanged.
- [ ] A subject can be created, edited (metadata, sections, questions, levels, blocks), archived, restored, exported and imported entirely from the UI.
- [ ] A table block and a code block survive a full round trip through the editor, the export, and the import.
- [ ] An invalid import never reaches the API.
- [ ] Reordering or deleting always asks first, and a declined confirmation sends nothing.
- [ ] Every mutation failure surfaces as a toast and never as an unhandled rejection.
- [ ] `npm test` counts increase for the new files and the i18n parity test passes.
- [ ] The Library reader page still renders correctly after all the authoring.

## Notes for the executor

- Do not add server endpoints in this phase; if a UI need seems to require one, stop and report it.
- If a test needs a seam (a downloader, a renderer), add an exported setter rather than reaching into the DOM or stubbing globals — `setSnapshotDownloader` is the pattern.
- Keep `libraryAdminView.ts` from growing past roughly 400 lines; if it does, move the editor into its own file the way the question editor already is.

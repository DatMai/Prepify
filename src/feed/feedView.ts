import { t as defaultT } from '../i18n';
import { esc } from '../render/escape';
import type { FeedArticle } from './types';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface FeedViewDeps {
  container: HTMLElement;
  load: () => Promise<FeedArticle[]>;
  t?: Translate;
  formatTime?: (publishedAt: string) => string;
}

export function timeAgoLabel(publishedAt: string, now: number): { key: string; n: number } {
  const timestamp = Date.parse(publishedAt);
  const diffMs = Math.max(0, now - (Number.isNaN(timestamp) ? now : timestamp));
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return { key: 'feed.justNow', n: 0 };
  if (minutes < 60) return { key: 'feed.minutes', n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { key: 'feed.hours', n: hours };
  return { key: 'feed.days', n: Math.floor(hours / 24) };
}

function defaultFormatTime(publishedAt: string): string {
  const { key, n } = timeAgoLabel(publishedAt, Date.now());
  return n === 0 ? defaultT(key) : defaultT(key, { n });
}

interface FeedState {
  items: FeedArticle[];
  filter: string | null;
  status: 'loading' | 'ready' | 'error';
}

let state: FeedState = { items: [], filter: null, status: 'loading' };
let activeDeps: FeedViewDeps | null = null;

const SKELETON_HTML = `
  <div class="feed-skeleton" aria-hidden="true">
    <div class="feed-skeleton-line wide"></div>
    <div class="feed-skeleton-grid">
      <div class="feed-skeleton-card"></div>
      <div class="feed-skeleton-card"></div>
      <div class="feed-skeleton-card"></div>
    </div>
  </div>`;

function render(deps: FeedViewDeps): void {
  const t = deps.t ?? defaultT;
  const formatTime = deps.formatTime ?? defaultFormatTime;
  const { container } = deps;

  if (state.status === 'loading') {
    container.innerHTML = SKELETON_HTML;
    return;
  }

  if (state.status === 'error') {
    container.innerHTML = `
      <div class="feed-error">
        <p>${esc(t('feed.error'))}</p>
        <button class="feed-retry" type="button">${esc(t('feed.retry'))}</button>
      </div>`;
    container.querySelector('.feed-retry')?.addEventListener('click', () => void load(deps));
    return;
  }

  const sources = [...new Set(state.items.map((item) => item.source))];
  const chips = sources
    .map(
      (source) =>
        `<button class="feed-chip${source === state.filter ? ' active' : ''}" data-source="${esc(source)}" type="button">${esc(source)}</button>`,
    )
    .join('');
  const cards = state.items
    .map((item) => {
      const hidden = state.filter !== null && item.source !== state.filter ? ' hidden' : '';
      return `
        <article class="feed-card" data-source="${esc(item.source)}"${hidden}>
          <div class="feed-card-top">
            <span class="feed-source">${esc(item.source)}</span>
            <time class="feed-time">${esc(formatTime(item.publishedAt))}</time>
          </div>
          <h3 class="feed-card-title">
            <a class="feed-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.title)}</a>
          </h3>
          <p class="feed-summary">${esc(item.summary)}</p>
        </article>`;
    })
    .join('');

  container.innerHTML = `
    <div class="feed-head">
      <p class="feed-kicker">${esc(t('feed.kicker'))}</p>
      <h2 class="feed-title">${esc(t('feed.title'))}</h2>
    </div>
    ${
      state.items.length > 0
        ? `<div class="feed-chips">
            <button class="feed-chip${state.filter === null ? ' active' : ''}" data-source="" type="button">${esc(t('feed.all'))}</button>
            ${chips}
          </div>`
        : ''
    }
    <div class="feed-grid">
      ${state.items.length === 0 ? `<p class="feed-empty">${esc(t('feed.empty'))}</p>` : cards}
    </div>`;

  container.querySelectorAll<HTMLButtonElement>('.feed-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.source || null;
      render(deps);
    });
  });
}

async function load(deps: FeedViewDeps): Promise<void> {
  state.status = 'loading';
  render(deps);
  try {
    state.items = await deps.load();
    state.status = 'ready';
  } catch {
    state.items = [];
    state.status = 'error';
  }
  render(deps);
}

export function initFeed(deps: FeedViewDeps): void {
  state = { items: [], filter: null, status: 'loading' };
  activeDeps = deps;
  void load(deps);
}

export function repaintFeed(): void {
  if (activeDeps) render(activeDeps);
}

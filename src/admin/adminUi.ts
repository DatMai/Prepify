/**
 * Builders and small utilities shared by the admin surface. The Content tab,
 * the topic editor, the question editor and the import dialog all render the
 * same kind of row, field and button, so the shape lives here once instead of
 * four times.
 */
import { t } from '../i18n';
import { showToast } from '../ui/toast';

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** A labelled text-like input inside a `.la-field` wrapper. */
export function field(
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

export function inputValue(name: string): string {
  const node = document.querySelector(`[name="${name}"]`);
  return node instanceof HTMLInputElement ? node.value.trim() : '';
}

export function setFormError(message: string): void {
  const node = document.querySelector('.la-form-error');
  if (node) node.textContent = message;
}

/** Runs a mutation and reports a failure as a toast, never as a rejection. */
export async function runAction(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    console.error(error);
    showToast(t('libAdmin.saveFailed'), 'error');
  }
}

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

let downloader: (name: string, snapshot: unknown) => void = downloadJson;

export function saveSnapshot(name: string, snapshot: unknown): void {
  downloader(name, snapshot);
}

/**
 * Replaces the file download with a plain callback. Tests use this instead of
 * exercising `URL.createObjectURL`, which jsdom does not implement.
 */
export function setSnapshotDownloader(fn: (name: string, snapshot: unknown) => void): void {
  downloader = fn;
}

import { createHash } from 'node:crypto';

export interface JourneyTask {
  id: string;
  checked: boolean;
  text: string;
  tags: string[];
}

export interface JourneyJournal {
  done: string;
  blocked: string;
  next: string;
}

export interface ParsedDaily {
  stage: string;
  tasks: JourneyTask[];
  evidence: string[];
  journal: JourneyJournal;
  blocks: DailyBlock[];
}

interface SectionRange {
  start: number;
  end: number;
}

interface TaskRecord extends JourneyTask {
  line: number;
}

interface SplitDocument {
  lines: string[];
  eol: '\n' | '\r\n';
}

type JournalField = 'Done' | 'Blocked' | 'Next';

export class DailyFormatError extends Error {}

function splitDocument(content: string): SplitDocument {
  return {
    lines: content.split(/\r?\n/),
    eol: content.includes('\r\n') ? '\r\n' : '\n',
  };
}

function joinDocument(document: SplitDocument): string {
  return document.lines.join(document.eol);
}

function sectionRange(lines: string[], heading: string): SectionRange {
  const starts = lines
    .map((line, index) => (line === heading ? index : -1))
    .filter((index) => index >= 0);

  if (starts.length !== 1) {
    throw new DailyFormatError(`Expected exactly one ${heading} section`);
  }

  const start = starts[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^##\s/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return { start, end };
}

function optionalSectionRange(lines: string[], heading: string): SectionRange | null {
  const starts = lines
    .map((line, index) => (line === heading ? index : -1))
    .filter((index) => index >= 0);

  if (starts.length > 1) {
    throw new DailyFormatError(`Expected at most one ${heading} section`);
  }
  if (starts.length === 0) return null;

  const start = starts[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^##\s/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { start, end };
}

function taskId(position: number, text: string): string {
  return createHash('sha256').update(`${position}\0${text}`).digest('hex').slice(0, 16);
}

function taskRecords(lines: string[]): TaskRecord[] {
  const range = sectionRange(lines, '## Study');
  const records: TaskRecord[] = [];

  for (let line = range.start + 1; line < range.end; line++) {
    const match = lines[line].match(/^- \[([ xX])\] (.+)$/);
    if (!match) continue;

    const text = match[2];
    records.push({
      id: taskId(records.length, text),
      checked: match[1].toLowerCase() === 'x',
      text,
      tags: text.match(/#[\p{L}\p{N}_-]+/gu) ?? [],
      line,
    });
  }

  return records;
}

function journalEditableEnd(lines: string[], range: SectionRange): number {
  for (let index = range.start + 1; index < range.end; index++) {
    if (/^###\s/.test(lines[index])) return index;
  }
  return range.end;
}

function journalFieldRange(
  lines: string[],
  section: SectionRange,
  field: JournalField,
): { start: number; end: number; firstValue: string } {
  const editableEnd = journalEditableEnd(lines, section);
  const pattern = new RegExp(`^- \\*\\*${field}:\\*\\*\\s?(.*)$`);
  const matches: Array<{ index: number; firstValue: string }> = [];

  for (let index = section.start + 1; index < editableEnd; index++) {
    const match = lines[index].match(pattern);
    if (match) matches.push({ index, firstValue: match[1] });
  }

  if (matches.length !== 1) {
    throw new DailyFormatError(`Expected exactly one ${field} journal field`);
  }

  const start = matches[0].index;
  let end = editableEnd;
  for (let index = start + 1; index < editableEnd; index++) {
    if (/^- \*\*(Done|Blocked|Next):\*\*/.test(lines[index])) {
      end = index;
      break;
    }
  }

  return { start, end, firstValue: matches[0].firstValue };
}

function readJournalField(lines: string[], section: SectionRange, field: JournalField): string {
  const range = journalFieldRange(lines, section, field);
  const continuation = lines
    .slice(range.start + 1, range.end)
    .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
    .join('\n')
    .trim();

  return [range.firstValue.trim(), continuation].filter(Boolean).join('\n');
}

function readStage(lines: string[]): string {
  if (lines[0] !== '---') return '';
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new DailyFormatError('Frontmatter is not closed');

  const stageLine = lines.slice(1, end).find((line) => line.startsWith('stage:'));
  return stageLine?.slice('stage:'.length).trim() ?? '';
}

function readEvidence(lines: string[]): string[] {
  const evidence: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    if (!/^## Bằng chứng(?:\s|$)/.test(lines[index])) continue;

    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      if (/^##\s/.test(lines[cursor])) break;
      const match = lines[cursor].match(/^- (.+)$/);
      if (match) {
        evidence.push(match[1].replace(/\s*<!-- prepify:event id="[^"]+" -->\s*$/, ''));
      }
    }
  }

  return evidence;
}

export function revisionFor(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

export interface DailyListItem {
  text: string;
  checked: boolean | null;
}

/**
 * A faithful, non-Markdown projection of one Journey-owned Daily section. The
 * bridge uploads these so the app can show the day's recall blocks and `###`
 * sub-sections, which the structured task/journal fields alone would drop.
 */
export type DailyBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: DailyListItem[] }
  | { kind: 'quote'; label: string; title: string; lines: string[]; collapsed: boolean };

/**
 * Only the sections the Journey protocol owns are ever projected. Project,
 * Email, finance and system sections stay inside the vault (ADR-001).
 */
const JOURNEY_SECTION_MATCHERS: ReadonlyArray<(heading: string) => boolean> = [
  (heading) => heading === '## Study',
  (heading) => /^## Bằng chứng(?:\s|$)/.test(heading),
  (heading) => heading === '## Journal (English only)',
];

const CALLOUT = /^\[!([A-Za-z][A-Za-z0-9-]*)\]([+-]?)\s*(.*)$/;
const LIST_ITEM = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/;

function bodyStart(lines: string[]): number {
  if (lines[0] !== '---') return 0;
  const end = lines.indexOf('---', 1);
  return end < 0 ? 0 : end + 1;
}

function journeySectionRanges(lines: string[]): SectionRange[] {
  const ranges: SectionRange[] = [];

  for (let index = bodyStart(lines); index < lines.length; index++) {
    const heading = lines[index];
    if (!JOURNEY_SECTION_MATCHERS.some((matches) => matches(heading))) continue;

    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      if (/^##\s/.test(lines[cursor])) {
        end = cursor;
        break;
      }
    }
    ranges.push({ start: index, end });
    index = end - 1;
  }

  return ranges;
}

function listItem(text: string): DailyListItem {
  const checked = text.match(/^\[([ xX])\]\s*(.*)$/);
  if (!checked) return { text, checked: null };
  return { text: checked[2].trim(), checked: checked[1].toLowerCase() === 'x' };
}

function withCalloutLabel(block: Extract<DailyBlock, { kind: 'quote' }>): DailyBlock {
  const match = CALLOUT.exec(block.lines[0] ?? '');
  if (!match) return block;
  return {
    kind: 'quote',
    label: match[1].toLowerCase(),
    title: match[3].trim(),
    lines: block.lines.slice(1),
    // `> [!note]-` is collapsed by default; `> [!note]+` starts expanded.
    collapsed: match[2] === '-',
  };
}

function blocksInRange(lines: string[], range: SectionRange): DailyBlock[] {
  const blocks: DailyBlock[] = [];
  let current: DailyBlock | null = null;

  const flush = (): void => {
    if (current === null) return;
    blocks.push(current.kind === 'quote' ? withCalloutLabel(current) : current);
    current = null;
  };

  for (let index = range.start; index < range.end; index++) {
    const raw = lines[index];
    const line = raw.trim();
    if (line === '') {
      flush();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2].trim() });
      continue;
    }

    const quote = raw.match(/^\s*>\s?(.*)$/);
    if (quote) {
      const text = quote[1].trimEnd();
      if (current !== null && current.kind === 'quote') current.lines.push(text);
      else {
        flush();
        current = { kind: 'quote', label: '', title: '', lines: [text], collapsed: false };
      }
      continue;
    }

    const item = LIST_ITEM.exec(raw);
    if (item) {
      const ordered = item[1] !== undefined;
      const next = listItem(item[2].trim());
      if (current !== null && current.kind === 'list' && current.ordered === ordered) {
        current.items.push(next);
      } else {
        flush();
        current = { kind: 'list', ordered, items: [next] };
      }
      continue;
    }

    // An indented line with no marker is a lazy continuation of the last item.
    if (current !== null && current.kind === 'list' && /^\s{2,}\S/.test(raw)) {
      const last = current.items[current.items.length - 1];
      last.text = `${last.text} ${line}`.trim();
      continue;
    }

    if (current !== null && current.kind === 'paragraph') {
      current.text = `${current.text} ${line}`.trim();
      continue;
    }

    flush();
    current = { kind: 'paragraph', text: line };
  }

  flush();
  return blocks;
}

/** Every block of the Journey-owned Daily sections, in file order. */
export function parseDailyBlocks(content: string): DailyBlock[] {
  const { lines } = splitDocument(content);
  return journeySectionRanges(lines).flatMap((range) => blocksInRange(lines, range));
}

export function parseDaily(content: string): ParsedDaily {
  const { lines } = splitDocument(content);
  const journalSection = sectionRange(lines, '## Journal (English only)');

  return {
    stage: readStage(lines),
    tasks: taskRecords(lines).map(({ line: _line, ...task }) => task),
    evidence: readEvidence(lines),
    journal: {
      done: readJournalField(lines, journalSection, 'Done'),
      blocked: readJournalField(lines, journalSection, 'Blocked'),
      next: readJournalField(lines, journalSection, 'Next'),
    },
    blocks: parseDailyBlocks(content),
  };
}

function normalizedJournalLines(value: string): string[] {
  if (value.length > 5000) throw new DailyFormatError('Journal field is too long');
  return value
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split('\n')
    .map((line) => line.trim());
}

function replaceJournalField(lines: string[], field: JournalField, value: string): void {
  const section = sectionRange(lines, '## Journal (English only)');
  const range = journalFieldRange(lines, section, field);
  const values = normalizedJournalLines(value);
  const first = values.shift() ?? '';
  const replacement = [
    `- **${field}:**${first ? ` ${first}` : ''}`,
    ...values.map((line) => `  ${line}`),
  ];
  lines.splice(range.start, range.end - range.start, ...replacement);
}

export function replaceJournal(content: string, journal: JourneyJournal): string {
  const document = splitDocument(content);
  replaceJournalField(document.lines, 'Next', journal.next);
  replaceJournalField(document.lines, 'Blocked', journal.blocked);
  replaceJournalField(document.lines, 'Done', journal.done);
  return joinDocument(document);
}

export function setTaskCompleted(content: string, id: string, checked: boolean): string {
  const document = splitDocument(content);
  const task = taskRecords(document.lines).find((record) => record.id === id);
  if (!task) throw new DailyFormatError('Study task was not found');

  document.lines[task.line] = document.lines[task.line].replace(
    /^- \[[ xX]\]/,
    `- [${checked ? 'x' : ' '}]`,
  );
  return joinDocument(document);
}

function normalizeEvidence(value: string): string {
  const normalized = value.replace(/\0/g, '').replace(/\s+/g, ' ').trim();
  if (normalized.length < 3 || normalized.length > 1000) {
    throw new DailyFormatError('Evidence must contain 3–1000 characters');
  }
  if (/prepify:event/i.test(normalized)) {
    throw new DailyFormatError('Evidence contains a reserved marker');
  }
  return normalized;
}

export function appendEvidence(content: string, value: string, eventId: string): string {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(eventId)) {
    throw new DailyFormatError('Invalid idempotency key');
  }

  const marker = `<!-- prepify:event id="${eventId}" -->`;
  if (content.includes(marker)) return content;

  const document = splitDocument(content);
  const line = `- ${normalizeEvidence(value)} ${marker}`;
  const existing = optionalSectionRange(document.lines, '## Bằng chứng từ Prepify');

  if (existing) {
    let insertAt = existing.end;
    while (insertAt > existing.start + 1 && document.lines[insertAt - 1] === '') {
      insertAt--;
    }
    document.lines.splice(insertAt, 0, line);
  } else {
    const study = sectionRange(document.lines, '## Study');
    document.lines.splice(study.start, 0, '## Bằng chứng từ Prepify', '', line, '');
  }

  return joinDocument(document);
}

export function touchUpdated(content: string, date: string): string {
  const document = splitDocument(content);
  if (document.lines[0] !== '---') throw new DailyFormatError('Missing frontmatter');
  const end = document.lines.indexOf('---', 1);
  if (end < 0) throw new DailyFormatError('Frontmatter is not closed');

  const indexes = document.lines
    .slice(1, end)
    .map((line, offset) => (line.startsWith('updated:') ? offset + 1 : -1))
    .filter((index) => index >= 0);

  if (indexes.length !== 1) {
    throw new DailyFormatError('Expected exactly one updated field');
  }
  document.lines[indexes[0]] = `updated: ${date}`;
  return joinDocument(document);
}

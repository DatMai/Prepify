/**
 * Pure block operations for the question editor. No DOM and no API here: every
 * function returns a new array so the caller can keep the previous value for a
 * cancel, and the table limits mirror the server's.
 */
import type { AdminBlock } from '../api/client';

/** Mirrors the server's `MAX_TABLE_ROWS` / `MAX_TABLE_COLUMNS`. */
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 10;

const DEFAULT_CODE_LANG = 'js';

type TableBlock = Extract<AdminBlock, { type: 'table' }>;

function replaceAt<T>(list: T[], index: number, next: T): T[] {
  return list.map((entry, current) => (current === index ? next : entry));
}

function tableAt(blocks: AdminBlock[], index: number): TableBlock | null {
  const block = blocks[index];
  return block && block.type === 'table' ? block : null;
}

export function addBlock(blocks: AdminBlock[], type: AdminBlock['type']): AdminBlock[] {
  if (type === 'note') return [...blocks, { type: 'note', text: '' }];
  if (type === 'code') return [...blocks, { type: 'code', lang: DEFAULT_CODE_LANG, text: '' }];
  if (type === 'table') {
    return [...blocks, { type: 'table', rows: [['', '']], headerDone: true }];
  }
  return [...blocks, { type: 'text', text: '' }];
}

export function removeBlock(blocks: AdminBlock[], index: number): AdminBlock[] {
  return blocks.filter((_, current) => current !== index);
}

export function moveBlock(blocks: AdminBlock[], index: number, delta: -1 | 1): AdminBlock[] {
  const target = index + delta;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return blocks;

  const next = [...blocks];
  const moved = next[index]!;
  next[index] = next[target]!;
  next[target] = moved;
  return next;
}

export function setBlockText(blocks: AdminBlock[], index: number, text: string): AdminBlock[] {
  const block = blocks[index];
  if (!block || block.type === 'table') return blocks;
  return replaceAt(blocks, index, { ...block, text });
}

export function setBlockLang(blocks: AdminBlock[], index: number, lang: string): AdminBlock[] {
  const block = blocks[index];
  if (!block || block.type !== 'code') return blocks;
  return replaceAt(blocks, index, { ...block, lang });
}

export function setTableCell(
  blocks: AdminBlock[],
  index: number,
  row: number,
  column: number,
  value: string,
): AdminBlock[] {
  const table = tableAt(blocks, index);
  if (!table) return blocks;

  const rows = table.rows.map((cells, currentRow) =>
    currentRow === row
      ? cells.map((cell, currentColumn) => (currentColumn === column ? value : cell))
      : cells,
  );
  return replaceAt(blocks, index, { ...table, rows });
}

export function addTableRow(blocks: AdminBlock[], index: number): AdminBlock[] {
  const table = tableAt(blocks, index);
  if (!table || table.rows.length >= MAX_TABLE_ROWS) return blocks;

  const width = table.rows[0]?.length ?? 1;
  const empty = Array.from({ length: width }, () => '');
  return replaceAt(blocks, index, { ...table, rows: [...table.rows, empty] });
}

export function removeTableRow(blocks: AdminBlock[], index: number): AdminBlock[] {
  const table = tableAt(blocks, index);
  if (!table || table.rows.length <= 1) return blocks;
  return replaceAt(blocks, index, { ...table, rows: table.rows.slice(0, -1) });
}

export function addTableColumn(blocks: AdminBlock[], index: number): AdminBlock[] {
  const table = tableAt(blocks, index);
  const width = table?.rows[0]?.length ?? 0;
  if (!table || width >= MAX_TABLE_COLUMNS) return blocks;

  const rows = table.rows.map((cells) => [...cells, '']);
  return replaceAt(blocks, index, { ...table, rows });
}

export function removeTableColumn(blocks: AdminBlock[], index: number): AdminBlock[] {
  const table = tableAt(blocks, index);
  const width = table?.rows[0]?.length ?? 0;
  if (!table || width <= 1) return blocks;

  const rows = table.rows.map((cells) => cells.slice(0, -1));
  return replaceAt(blocks, index, { ...table, rows });
}

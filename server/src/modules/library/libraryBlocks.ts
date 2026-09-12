import { z } from 'zod';

export const MAX_BLOCKS_PER_QUESTION = 100;
export const MAX_TEXT_LENGTH = 20_000;
export const MAX_TABLE_ROWS = 50;
export const MAX_TABLE_COLUMNS = 10;

const textBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string().max(MAX_TEXT_LENGTH),
});

const noteBlockSchema = z.object({
  type: z.literal('note'),
  text: z.string().max(MAX_TEXT_LENGTH),
});

const codeBlockSchema = z.object({
  type: z.literal('code'),
  lang: z.string().max(32),
  text: z.string().max(MAX_TEXT_LENGTH),
});

const tableBlockSchema = z.object({
  type: z.literal('table'),
  rows: z
    .array(z.array(z.string().max(MAX_TEXT_LENGTH)).max(MAX_TABLE_COLUMNS))
    .max(MAX_TABLE_ROWS),
  headerDone: z.boolean().optional(),
  closed: z.boolean().optional(),
});

export const blockSchema = z.discriminatedUnion('type', [
  textBlockSchema,
  noteBlockSchema,
  codeBlockSchema,
  tableBlockSchema,
]);

export const blockListSchema = z.array(blockSchema).max(MAX_BLOCKS_PER_QUESTION);

export type TextBlock = z.infer<typeof textBlockSchema>;
export type NoteBlock = z.infer<typeof noteBlockSchema>;
export type CodeBlock = z.infer<typeof codeBlockSchema>;
export type TableBlock = z.infer<typeof tableBlockSchema>;
export type Block = z.infer<typeof blockSchema>;

/**
 * Concatenates the text-block content of a question, the way the Daily
 * challenge builds MCQ options. Non-text blocks and junk input are ignored.
 */
export function blocksToText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .filter((block): block is TextBlock => {
      if (typeof block !== 'object' || block === null) return false;
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === 'text' && typeof candidate.text === 'string';
    })
    .map((block) => block.text)
    .join(' ');
}

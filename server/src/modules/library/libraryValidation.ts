import { z } from 'zod';
import { blockListSchema, MAX_TEXT_LENGTH, type Block } from './libraryBlocks';

export type Level = 'basic' | 'intermediate' | 'advanced';

export const LEVELS: Level[] = ['basic', 'intermediate', 'advanced'];

const localeSchema = z.enum(['vi', 'en']);
const levelSchema = z.enum(['basic', 'intermediate', 'advanced']);
const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a hex colour like #B71C1C');
const positionSchema = z.number().int().min(0).max(10_000);
const topicKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, digits and dashes')
  .min(2)
  .max(40);

function atLeastOneField<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(shape)
    .partial()
    .strict()
    .refine((value) => Object.keys(value).length > 0, {
      message: 'At least one field is required',
    });
}

export const topicCreateSchema = z
  .object({
    key: topicKeySchema,
    locale: localeSchema,
    label: z.string().trim().min(1).max(60),
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(300).nullable().optional(),
    color: colorSchema,
  })
  .strict();

export const topicPatchSchema = atLeastOneField({
  label: z.string().trim().min(1).max(60),
  title: z.string().trim().min(1).max(200),
  subtitle: z.string().trim().max(300).nullable(),
  color: colorSchema,
  position: positionSchema,
});

export const sectionCreateSchema = z.object({ name: z.string().trim().min(1).max(200) }).strict();

export const sectionPatchSchema = atLeastOneField({
  name: z.string().trim().min(1).max(200),
  position: positionSchema,
});

export const questionCreateSchema = z
  .object({
    code: z.string().trim().max(20).nullable().optional(),
    prompt: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    level: levelSchema.nullable().optional(),
    blocks: blockListSchema,
  })
  .strict();

export const questionPatchSchema = atLeastOneField({
  code: z.string().trim().max(20).nullable(),
  prompt: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  level: levelSchema.nullable(),
  blocks: blockListSchema,
  position: positionSchema,
});

const importQuestionSchema = z
  .object({
    code: z.string().trim().max(20).nullable().optional(),
    id: z.string().trim().max(20).nullable().optional(),
    level: levelSchema.nullable().optional(),
    q: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
    blocks: blockListSchema,
  })
  .strict();

const importSectionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    questions: z.array(importQuestionSchema).min(1).max(500),
  })
  .strict();

const importDocumentSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    subtitle: z.string().trim().max(300).nullable().optional(),
    label: z.string().trim().min(1).max(60),
    color: colorSchema,
    sections: z.array(importSectionSchema).min(1).max(50),
  })
  .strict();

export const importRequestSchema = z
  .object({ mode: z.enum(['replace', 'append']), document: importDocumentSchema })
  .strict();

const dailyEntryBase = {
  entryId: z.string().trim().min(1).max(60),
  locale: localeSchema,
  difficulty: z.number().int().min(1).max(3),
  topicKey: z.string().trim().max(40).nullable().optional(),
  hint: z.string().trim().max(300).nullable().optional(),
};

export const dailyEntryCreateSchema = z.discriminatedUnion('type', [
  z.object({ ...dailyEntryBase, type: z.literal('mcq'), questionId: z.string().uuid() }).strict(),
  z
    .object({
      ...dailyEntryBase,
      type: z.literal('fib'),
      prompt: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
      blanks: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
    })
    .strict(),
]);

export const dailyEntryPatchSchema = atLeastOneField({
  difficulty: z.number().int().min(1).max(3),
  questionId: z.string().uuid(),
  prompt: z.string().trim().min(1).max(MAX_TEXT_LENGTH),
  blanks: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  hint: z.string().trim().max(300).nullable(),
  position: positionSchema,
});

export interface ImportQuestion {
  code: string | null;
  prompt: string;
  level: Level | null;
  blocks: Block[];
}

export interface ImportSection {
  name: string;
  questions: ImportQuestion[];
}

/** The shape `importTopic` works with internally. */
export interface ImportDocument {
  title: string;
  subtitle: string | null;
  label: string;
  color: string;
  sections: ImportSection[];
}

/**
 * The wire format: exactly what `import` accepts and what `export` emits, so a
 * topic can be exported and imported back without loss.
 */
export interface ImportDocumentJson {
  title: string;
  subtitle: string | null;
  label: string;
  color: string;
  sections: Array<{
    name: string;
    questions: Array<{
      code: string | null;
      level: Level | null;
      q: string;
      blocks: Block[];
    }>;
  }>;
}

type ImportDocumentInput = z.infer<typeof importDocumentSchema>;

export function normalizeImportDocument(input: ImportDocumentInput): ImportDocument {
  return {
    title: input.title,
    subtitle: input.subtitle ?? null,
    label: input.label,
    color: input.color,
    sections: input.sections.map((section) => ({
      name: section.name,
      questions: section.questions.map((question) => ({
        code: question.code ?? question.id ?? null,
        prompt: question.q,
        level: question.level ?? null,
        blocks: question.blocks,
      })),
    })),
  };
}

/** Projects the internal document back onto the import format. */
export function toDocumentJson(document: ImportDocument): ImportDocumentJson {
  return {
    title: document.title,
    subtitle: document.subtitle,
    label: document.label,
    color: document.color,
    sections: document.sections.map((section) => ({
      name: section.name,
      questions: section.questions.map((question) => ({
        code: question.code,
        level: question.level,
        q: question.prompt,
        blocks: question.blocks,
      })),
    })),
  };
}

/** Turns a Zod failure into the exact path an author needs to fix. */
export function formatValidationIssue(error: z.ZodError): { path: string; message: string } {
  const issue = error.issues[0];
  if (!issue) return { path: '', message: 'Invalid document' };
  const path = issue.path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      const text = String(segment);
      return index === 0 ? text : `.${text}`;
    })
    .join('');
  return { path, message: issue.message };
}

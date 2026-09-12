import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { z } from 'zod';
import {
  LibraryConflictError,
  LibraryNotFoundError,
  type LibraryAuthoring,
} from '../modules/library/libraryAuthoring';
import type { Locale } from '../modules/library/libraryRepository';
import type { ImportDocumentJson } from '../modules/library/libraryValidation';
import {
  dailyEntryCreateSchema,
  dailyEntryPatchSchema,
  formatValidationIssue,
  importRequestSchema,
  normalizeImportDocument,
  questionCreateSchema,
  questionPatchSchema,
  sectionCreateSchema,
  sectionPatchSchema,
  topicCreateSchema,
  topicPatchSchema,
} from '../modules/library/libraryValidation';

interface LibraryAdminDeps {
  authoring: LibraryAuthoring;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveLocale(value: unknown): Locale | null {
  if (value === undefined || value === 'vi') return 'vi';
  if (value === 'en') return 'en';
  return null;
}

/** Safe because `router.param('id')` rejects anything that is not a string. */
function idOf(req: Request): string {
  const value = req.params.id;
  return typeof value === 'string' ? value : '';
}

function sendInvalid(res: Response, error: z.ZodError): void {
  const issue = formatValidationIssue(error);
  res.status(400).json({
    error: 'Invalid document',
    code: 'library_invalid_document',
    path: issue.path,
    message: issue.message,
  });
}

function sendError(res: Response, error: unknown, next: NextFunction): void {
  if (error instanceof LibraryNotFoundError) {
    res.status(404).json({ error: 'Not found', code: error.code });
    return;
  }
  if (error instanceof LibraryConflictError) {
    res.status(409).json({
      error: error.code === 'library_archived' ? 'Topic is archived' : 'Resource is in use',
      code: error.code,
      ...(error.entryIds.length > 0 ? { entryIds: error.entryIds } : {}),
    });
    return;
  }
  next(error);
}

async function snapshotForQuestion(
  authoring: LibraryAuthoring,
  questionId: string,
): Promise<ImportDocumentJson> {
  const topicId = await authoring.findTopicIdForQuestion(questionId);
  if (!topicId) throw new LibraryNotFoundError('library_not_found');
  const snapshot = await authoring.exportTopicDocument(topicId);
  if (!snapshot) throw new LibraryNotFoundError('library_not_found');
  return snapshot;
}

async function snapshotForSection(
  authoring: LibraryAuthoring,
  sectionId: string,
): Promise<ImportDocumentJson> {
  const topicId = await authoring.findTopicIdForSection(sectionId);
  if (!topicId) throw new LibraryNotFoundError('library_not_found');
  const snapshot = await authoring.exportTopicDocument(topicId);
  if (!snapshot) throw new LibraryNotFoundError('library_not_found');
  return snapshot;
}

export function createLibraryAdminRouter(deps: LibraryAdminDeps): Router {
  const router = Router();

  router.use(deps.requireAuth, deps.requireAdmin);

  /**
   * Every id in this API is a UUID. Rejecting anything else here keeps a
   * malformed id from reaching Postgres, which would answer with a 500.
   */
  router.param('id', (_req, res, next, value) => {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      res.status(400).json({ error: 'Invalid id', code: 'invalid_id' });
      return;
    }
    next();
  });

  /** Refuses to touch the children of an archived topic. */
  async function ensureEditable(topicId: string): Promise<void> {
    const status = await deps.authoring.findTopicStatus(topicId);
    if (!status) throw new LibraryNotFoundError('library_not_found');
    if (status.archived) throw new LibraryConflictError('library_archived');
  }

  async function ensureEditableSection(sectionId: string): Promise<void> {
    const topicId = await deps.authoring.findTopicIdForSection(sectionId);
    if (!topicId) throw new LibraryNotFoundError('library_not_found');
    await ensureEditable(topicId);
  }

  async function ensureEditableQuestion(questionId: string): Promise<void> {
    const topicId = await deps.authoring.findTopicIdForQuestion(questionId);
    if (!topicId) throw new LibraryNotFoundError('library_not_found');
    await ensureEditable(topicId);
  }

  router.get('/topics', async (req, res, next) => {
    try {
      const locale = resolveLocale(req.query.lang);
      if (!locale) {
        res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
        return;
      }
      const includeArchived = req.query.includeArchived === '1';
      res.json({ items: await deps.authoring.listTopics({ locale, includeArchived }) });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.get('/topics/:id', async (req, res, next) => {
    try {
      const detail = await deps.authoring.getTopicDetail({ topicId: idOf(req) });
      if (!detail) throw new LibraryNotFoundError('library_not_found');
      res.json(detail);
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics', async (req, res, next) => {
    const parsed = topicCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      res.status(201).json(
        await deps.authoring.createTopic({
          ...parsed.data,
          subtitle: parsed.data.subtitle ?? null,
        }),
      );
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.patch('/topics/:id', async (req, res, next) => {
    const parsed = topicPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      await deps.authoring.updateTopic(idOf(req), parsed.data);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics/:id/archive', async (req, res, next) => {
    try {
      const topicId = idOf(req);
      const snapshot = await deps.authoring.exportTopicDocument(topicId);
      if (!snapshot) throw new LibraryNotFoundError('library_not_found');
      await deps.authoring.setTopicArchived(topicId, true);
      res.json({ snapshot });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics/:id/restore', async (req, res, next) => {
    try {
      const topicId = idOf(req);
      const status = await deps.authoring.findTopicStatus(topicId);
      if (!status) throw new LibraryNotFoundError('library_not_found');
      await deps.authoring.setTopicArchived(topicId, false);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.get('/topics/:id/export', async (req, res, next) => {
    try {
      const snapshot = await deps.authoring.exportTopicDocument(idOf(req));
      if (!snapshot) throw new LibraryNotFoundError('library_not_found');
      res.json(snapshot);
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics/:id/import', async (req, res, next) => {
    const parsed = importRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      const topicId = idOf(req);
      await ensureEditable(topicId);
      res.json(
        await deps.authoring.importTopic({
          topicId,
          mode: parsed.data.mode,
          document: normalizeImportDocument(parsed.data.document),
        }),
      );
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/topics/:id/sections', async (req, res, next) => {
    const parsed = sectionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      const topicId = idOf(req);
      await ensureEditable(topicId);
      res.status(201).json(await deps.authoring.createSection({ topicId, name: parsed.data.name }));
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.patch('/sections/:id', async (req, res, next) => {
    const parsed = sectionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      await ensureEditableSection(idOf(req));
      await deps.authoring.updateSection(idOf(req), parsed.data);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.delete('/sections/:id', async (req, res, next) => {
    try {
      const sectionId = idOf(req);
      await ensureEditableSection(sectionId);
      const entryIds = await deps.authoring.listDailyReferencesForSection(sectionId);
      if (entryIds.length > 0) throw new LibraryConflictError('library_in_use', entryIds);
      const snapshot = await snapshotForSection(deps.authoring, sectionId);
      await deps.authoring.deleteSection(sectionId);
      res.json({ snapshot });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/sections/:id/questions', async (req, res, next) => {
    const parsed = questionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      const sectionId = idOf(req);
      await ensureEditableSection(sectionId);
      res.status(201).json(
        await deps.authoring.createQuestion({
          sectionId,
          code: parsed.data.code ?? null,
          prompt: parsed.data.prompt,
          level: parsed.data.level ?? null,
          blocks: parsed.data.blocks,
        }),
      );
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.patch('/questions/:id', async (req, res, next) => {
    const parsed = questionPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      await ensureEditableQuestion(idOf(req));
      await deps.authoring.updateQuestion(idOf(req), parsed.data);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.delete('/questions/:id', async (req, res, next) => {
    try {
      const questionId = idOf(req);
      await ensureEditableQuestion(questionId);
      const entryIds = await deps.authoring.listDailyReferencesForQuestion(questionId);
      if (entryIds.length > 0) throw new LibraryConflictError('library_in_use', entryIds);
      const snapshot = await snapshotForQuestion(deps.authoring, questionId);
      await deps.authoring.deleteQuestion(questionId);
      res.json({ snapshot });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.get('/daily-entries', async (req, res, next) => {
    try {
      const locale = resolveLocale(req.query.locale);
      if (!locale) {
        res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
        return;
      }
      res.json({ items: await deps.authoring.listDailyEntries({ locale }) });
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.post('/daily-entries', async (req, res, next) => {
    const parsed = dailyEntryCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      res.status(201).json(await deps.authoring.createDailyEntry(parsed.data));
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.patch('/daily-entries/:id', async (req, res, next) => {
    const parsed = dailyEntryPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      sendInvalid(res, parsed.error);
      return;
    }
    try {
      await deps.authoring.updateDailyEntry(idOf(req), parsed.data);
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  router.delete('/daily-entries/:id', async (req, res, next) => {
    try {
      await deps.authoring.deleteDailyEntry(idOf(req));
      res.status(204).end();
    } catch (error) {
      sendError(res, error, next);
    }
  });

  return router;
}

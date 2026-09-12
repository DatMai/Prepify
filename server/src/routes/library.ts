import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import type { LibraryRepository, Locale } from '../modules/library/libraryRepository';

const topicKeyPattern = /^[a-z0-9-]+$/;

function resolveLocale(value: unknown): Locale | null {
  if (value === undefined || value === 'vi') return 'vi';
  if (value === 'en') return 'en';
  return null;
}

export function createLibraryRouter(deps: { repo: LibraryRepository }): Router {
  const router = Router();

  router.use(requireAuth, requireAdmin);

  router.get('/index', async (req, res, next) => {
    try {
      const locale = resolveLocale(req.query.lang);
      if (!locale) {
        res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
        return;
      }
      res.json(await deps.repo.listTopics({ locale }));
    } catch (error) {
      next(error);
    }
  });

  router.get('/topics/:key', async (req, res, next) => {
    try {
      const key = req.params.key;
      if (typeof key !== 'string' || !topicKeyPattern.test(key)) {
        res.status(400).json({ error: 'Invalid topic key', code: 'invalid_topic_key' });
        return;
      }
      const locale = resolveLocale(req.query.lang);
      if (!locale) {
        res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
        return;
      }
      const topic = await deps.repo.getTopic({ key, locale });
      if (!topic) {
        res.status(404).json({ error: 'Topic not found', code: 'library_not_found' });
        return;
      }
      res.json(topic);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

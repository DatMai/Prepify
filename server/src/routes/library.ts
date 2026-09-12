import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';

const router = Router();
const contentRoot = path.resolve(__dirname, '../../../content');
const topicKeyPattern = /^[a-z0-9-]+$/;

function localizedContentRoot(lang: unknown): string | null {
  if (lang === undefined || lang === 'vi') return contentRoot;
  if (lang === 'en') return path.join(contentRoot, 'en');
  return null;
}

router.use(requireAuth, requireAdmin);

router.get('/index', async (req, res, next) => {
  try {
    const root = localizedContentRoot(req.query.lang);
    if (!root) {
      res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
      return;
    }
    const raw = await fs.readFile(path.join(root, 'index.json'), 'utf8');
    res.type('json').send(raw);
  } catch (error) {
    next(error);
  }
});

router.get('/topics/:key', async (req, res, next) => {
  try {
    const key = req.params.key;
    if (typeof key !== 'string' || !topicKeyPattern.test(key)) {
      res.status(400).json({ error: 'Invalid topic key' });
      return;
    }
    const root = localizedContentRoot(req.query.lang);
    if (!root) {
      res.status(400).json({ error: 'Unsupported language', code: 'unsupported_language' });
      return;
    }
    const raw = await fs.readFile(path.join(root, `${key}.json`), 'utf8');
    res.type('json').send(raw);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      res.status(404).json({ error: 'Topic not found' });
      return;
    }
    next(error);
  }
});

export default router;

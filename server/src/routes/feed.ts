import { Router } from 'express';
import type { FeedArticle } from '../modules/feed/parser';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

interface FeedRouterDeps {
  service: { getFeed(): Promise<FeedArticle[]> };
}

export function createFeedRouter(deps: FeedRouterDeps): Router {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const items = await deps.service.getFeed();
      const requested = Number(req.query.limit);
      const limit =
        Number.isInteger(requested) && requested > 0 && requested <= MAX_LIMIT
          ? requested
          : DEFAULT_LIMIT;
      res.json({ items: items.slice(0, limit) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AdminRepository } from '../modules/admin/adminRepository';

interface AdminRouterDeps {
  repo: AdminRepository;
  requireAuth: RequestHandler;
  requireAdmin: RequestHandler;
}

const patchSchema = z
  .object({
    role: z.enum(['user', 'admin']),
    disabled: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

const listQuerySchema = z.object({
  search: z.string().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();

  router.get('/stats', deps.requireAuth, deps.requireAdmin, async (_req, res, next) => {
    try {
      res.json(await deps.repo.stats());
    } catch (error) {
      next(error);
    }
  });

  router.get('/users', deps.requireAuth, deps.requireAdmin, async (req, res, next) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid query', code: 'invalid_query' });
        return;
      }
      res.json(await deps.repo.listUsers(parsed.data));
    } catch (error) {
      next(error);
    }
  });

  router.patch('/users/:id', deps.requireAuth, deps.requireAdmin, async (req, res, next) => {
    try {
      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid patch', code: 'invalid_patch' });
        return;
      }
      const targetId = req.params.id;
      if (typeof targetId !== 'string') {
        res.status(400).json({ error: 'Invalid user id', code: 'invalid_user_id' });
        return;
      }
      if (targetId === req.user!.userId) {
        res
          .status(400)
          .json({ error: 'Cannot modify your own account', code: 'cannot_modify_self' });
        return;
      }
      const target = await deps.repo.findById(targetId);
      if (!target) {
        res.status(404).json({ error: 'User not found', code: 'user_not_found' });
        return;
      }
      if (parsed.data.role !== undefined) await deps.repo.setRole(targetId, parsed.data.role);
      if (parsed.data.disabled !== undefined) {
        await deps.repo.setDisabled(targetId, parsed.data.disabled);
      }
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  return router;
}

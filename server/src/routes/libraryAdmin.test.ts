import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { LibraryConflictError, LibraryNotFoundError } from '../modules/library/libraryAuthoring';
import { createLibraryAdminRouter } from './libraryAdmin';

type Role = 'user' | 'admin';

function appWith(
  authoring: Record<string, unknown>,
  role: Role = 'admin',
  options?: { archived?: boolean },
) {
  const instance = express();
  instance.use(express.json());
  const requireAuth: RequestHandler = (req, _res, next) => {
    req.user = { userId: 'admin-1', email: 'admin@example.com', role };
    next();
  };
  const requireAdmin: RequestHandler = (req, res, next) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required', code: 'admin_required' });
      return;
    }
    next();
  };
  const authoringWithDefaults = {
    findTopicStatus: vi.fn().mockResolvedValue({ id: 't-1', archived: options?.archived ?? false }),
    findTopicIdForSection: vi.fn().mockResolvedValue('t-1'),
    findTopicIdForQuestion: vi.fn().mockResolvedValue('t-1'),
    listDailyReferencesForTopic: vi.fn().mockResolvedValue([]),
    listDailyReferencesForSection: vi.fn().mockResolvedValue([]),
    listDailyReferencesForQuestion: vi.fn().mockResolvedValue([]),
    exportTopicDocument: vi.fn().mockResolvedValue({
      title: 'T',
      subtitle: null,
      label: 'L',
      color: '#000000',
      sections: [],
    }),
    ...authoring,
  };
  instance.use(
    '/admin',
    createLibraryAdminRouter({
      authoring: authoringWithDefaults as never,
      requireAuth,
      requireAdmin,
    }),
  );
  return instance;
}

describe('library admin routes — guards', () => {
  it('rejects a non-admin before touching the repository', async () => {
    const createTopic = vi.fn();

    const res = await request(appWith({ createTopic }, 'user')).post('/admin/topics').send({});

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('admin_required');
    expect(createTopic).not.toHaveBeenCalled();
  });

  it('rejects an over-long id before any repository call', async () => {
    const updateTopic = vi.fn();

    const res = await request(appWith({ updateTopic }))
      .patch(`/admin/topics/${'x'.repeat(150)}`)
      .send({ title: 'x' })
      .expect(400);

    expect(res.body.code).toBe('invalid_id');
    expect(updateTopic).not.toHaveBeenCalled();
  });
});

describe('library admin routes — topics', () => {
  it('lists topics for a locale, including archived ones on request', async () => {
    const listTopics = vi.fn().mockResolvedValue([]);

    await request(appWith({ listTopics }))
      .get('/admin/topics?lang=vi&includeArchived=1')
      .expect(200);

    expect(listTopics).toHaveBeenCalledWith({ locale: 'vi', includeArchived: true });
  });

  it('creates a topic and refuses a duplicate key', async () => {
    const createTopic = vi
      .fn()
      .mockResolvedValueOnce({ id: 't-1' })
      .mockRejectedValueOnce(new LibraryConflictError('library_key_in_use'));
    const body = {
      key: 'system-design',
      locale: 'vi',
      label: 'System Design',
      title: 'System Design',
      color: '#123456',
    };

    const created = await request(appWith({ createTopic }))
      .post('/admin/topics')
      .send(body)
      .expect(201);
    expect(created.body).toEqual({ id: 't-1' });

    const conflict = await request(appWith({ createTopic }))
      .post('/admin/topics')
      .send(body)
      .expect(409);
    expect(conflict.body.code).toBe('library_key_in_use');
  });

  it('reports a validation failure with its path and never calls the repository', async () => {
    const createTopic = vi.fn();

    const res = await request(appWith({ createTopic }))
      .post('/admin/topics')
      .send({ key: 'Bad_Key', locale: 'vi', label: 'L', title: 'T', color: 'red' })
      .expect(400);

    expect(res.body.code).toBe('library_invalid_document');
    expect(res.body.path).toBe('key');
    expect(createTopic).not.toHaveBeenCalled();
  });

  it('never lets a key change through patch', async () => {
    const updateTopic = vi.fn();

    const res = await request(appWith({ updateTopic }))
      .patch('/admin/topics/t-1')
      .send({ key: 'renamed' })
      .expect(400);

    expect(res.body.code).toBe('library_invalid_document');
    expect(updateTopic).not.toHaveBeenCalled();
  });

  it('404s an unknown topic', async () => {
    const getTopicDetail = vi.fn().mockResolvedValue(null);

    const res = await request(appWith({ getTopicDetail })).get('/admin/topics/t-1').expect(404);

    expect(res.body.code).toBe('library_not_found');
  });

  it('returns a snapshot when archiving', async () => {
    const setTopicArchived = vi.fn().mockResolvedValue(undefined);

    const res = await request(appWith({ setTopicArchived }))
      .post('/admin/topics/t-1/archive')
      .expect(200);

    expect(setTopicArchived).toHaveBeenCalledWith('t-1', true);
    expect(res.body.snapshot).toMatchObject({ title: 'T' });
  });

  it('refuses to touch the children of an archived topic', async () => {
    const createSection = vi.fn();

    const res = await request(appWith({ createSection }, 'admin', { archived: true }))
      .post('/admin/topics/t-1/sections')
      .send({ name: 'Phần II' })
      .expect(409);

    expect(res.body.code).toBe('library_archived');
    expect(createSection).not.toHaveBeenCalled();
  });
});

describe('library admin routes — sections and questions', () => {
  it('creates a section and a question', async () => {
    const createSection = vi.fn().mockResolvedValue({ id: 's-1' });
    const createQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const section = await request(appWith({ createSection }))
      .post('/admin/topics/t-1/sections')
      .send({ name: 'Phần II' })
      .expect(201);
    expect(section.body).toEqual({ id: 's-1' });
    expect(createSection).toHaveBeenCalledWith({ topicId: 't-1', name: 'Phần II' });

    const question = await request(appWith({ createQuestion }))
      .post('/admin/sections/s-1/questions')
      .send({ prompt: 'Câu mới', blocks: [{ type: 'text', text: 'x' }] })
      .expect(201);
    expect(question.body).toEqual({ id: 'q-1' });
    expect(createQuestion).toHaveBeenCalledWith({
      sectionId: 's-1',
      code: null,
      prompt: 'Câu mới',
      level: null,
      blocks: [{ type: 'text', text: 'x' }],
    });
  });

  it('rejects a question without any block field of the right shape', async () => {
    const createQuestion = vi.fn();

    const res = await request(appWith({ createQuestion }))
      .post('/admin/sections/s-1/questions')
      .send({ prompt: 'x', blocks: [{ type: 'image', src: 'y' }] })
      .expect(400);

    expect(res.body.path).toBe('blocks[0].type');
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it('passes a level change straight through, including null', async () => {
    const updateQuestion = vi.fn().mockResolvedValue(undefined);

    await request(appWith({ updateQuestion }))
      .patch('/admin/questions/q-1')
      .send({ level: 'advanced' })
      .expect(204);
    expect(updateQuestion).toHaveBeenCalledWith('q-1', { level: 'advanced' });

    await request(appWith({ updateQuestion }))
      .patch('/admin/questions/q-1')
      .send({ level: null })
      .expect(204);
    expect(updateQuestion).toHaveBeenLastCalledWith('q-1', { level: null });
  });

  it('returns the pre-delete snapshot so a delete is undoable', async () => {
    const deleteQuestion = vi.fn().mockResolvedValue(undefined);

    const res = await request(appWith({ deleteQuestion }))
      .delete('/admin/questions/q-1')
      .expect(200);

    expect(deleteQuestion).toHaveBeenCalledWith('q-1');
    expect(res.body.snapshot).toMatchObject({ title: 'T' });
  });

  it('refuses to delete a question the Daily pool uses, before deleting anything', async () => {
    const deleteQuestion = vi.fn();
    const listDailyReferencesForQuestion = vi.fn().mockResolvedValue(['d-mcq-001']);

    const res = await request(appWith({ deleteQuestion, listDailyReferencesForQuestion }))
      .delete('/admin/questions/q-1')
      .expect(409);

    expect(res.body).toMatchObject({ code: 'library_in_use', entryIds: ['d-mcq-001'] });
    expect(deleteQuestion).not.toHaveBeenCalled();
  });

  it('refuses to delete a section the Daily pool uses', async () => {
    const deleteSection = vi.fn();
    const listDailyReferencesForSection = vi.fn().mockResolvedValue(['d-mcq-002']);

    const res = await request(appWith({ deleteSection, listDailyReferencesForSection }))
      .delete('/admin/sections/s-1')
      .expect(409);

    expect(res.body.entryIds).toEqual(['d-mcq-002']);
    expect(deleteSection).not.toHaveBeenCalled();
  });
});

describe('library admin routes — import and export', () => {
  it('normalizes the document before importing it', async () => {
    const importTopic = vi.fn().mockResolvedValue({ sections: 2, questions: 9 });

    const res = await request(appWith({ importTopic }))
      .post('/admin/topics/t-1/import')
      .send({
        mode: 'append',
        document: {
          title: 'T',
          label: 'L',
          color: '#000000',
          sections: [
            {
              name: 'S',
              questions: [
                { id: 'Q1', q: 'one', blocks: [] },
                { code: 'Q2', level: 'basic', q: 'two', blocks: [] },
              ],
            },
          ],
        },
      })
      .expect(200);

    expect(importTopic).toHaveBeenCalledWith({
      topicId: 't-1',
      mode: 'append',
      document: {
        title: 'T',
        subtitle: null,
        label: 'L',
        color: '#000000',
        sections: [
          {
            name: 'S',
            questions: [
              { code: 'Q1', prompt: 'one', level: null, blocks: [] },
              { code: 'Q2', prompt: 'two', level: 'basic', blocks: [] },
            ],
          },
        ],
      },
    });
    expect(res.body).toEqual({ sections: 2, questions: 9 });
  });

  it('reports the nested path of a broken import', async () => {
    const importTopic = vi.fn();

    const res = await request(appWith({ importTopic }))
      .post('/admin/topics/t-1/import')
      .send({
        mode: 'replace',
        document: {
          title: 'T',
          label: 'L',
          color: '#000000',
          sections: [{ name: 'S', questions: [{ q: 'bad', blocks: [{ type: 'image' }] }] }],
        },
      })
      .expect(400);

    expect(res.body.path).toBe('document.sections[0].questions[0].blocks[0].type');
    expect(importTopic).not.toHaveBeenCalled();
  });

  it('exports a topic document', async () => {
    const res = await request(appWith({})).get('/admin/topics/t-1/export').expect(200);

    expect(res.body).toEqual({
      title: 'T',
      subtitle: null,
      label: 'L',
      color: '#000000',
      sections: [],
    });
  });
});

describe('library admin routes — daily pool', () => {
  it('creates a fib entry and rejects an mcq without a question id', async () => {
    const createDailyEntry = vi.fn().mockResolvedValue({ id: 'd-1' });

    await request(appWith({ createDailyEntry }))
      .post('/admin/daily-entries')
      .send({
        entryId: 'd-fib-9',
        locale: 'vi',
        type: 'fib',
        difficulty: 1,
        prompt: 'A ___ resolves.',
        blanks: ['promise'],
      })
      .expect(201);

    const res = await request(appWith({ createDailyEntry }))
      .post('/admin/daily-entries')
      .send({ entryId: 'd-x', locale: 'vi', type: 'mcq', difficulty: 1 })
      .expect(400);

    expect(res.body.code).toBe('library_invalid_document');
    expect(createDailyEntry).toHaveBeenCalledTimes(1);
  });

  it('lists entries for a locale', async () => {
    const listDailyEntries = vi.fn().mockResolvedValue([]);

    await request(appWith({ listDailyEntries })).get('/admin/daily-entries?locale=en').expect(200);

    expect(listDailyEntries).toHaveBeenCalledWith({ locale: 'en' });
  });

  it('reports a conflict when the same entry id is created twice', async () => {
    const createDailyEntry = vi
      .fn()
      .mockRejectedValue(new LibraryConflictError('library_key_in_use'));

    const res = await request(appWith({ createDailyEntry }))
      .post('/admin/daily-entries')
      .send({
        entryId: 'd-fib-9',
        locale: 'vi',
        type: 'fib',
        difficulty: 1,
        prompt: 'x',
        blanks: ['y'],
      })
      .expect(409);

    expect(res.body.code).toBe('library_key_in_use');
  });

  it('deletes an entry and 404s an unknown one', async () => {
    const deleteDailyEntry = vi.fn().mockResolvedValue(undefined);

    await request(appWith({ deleteDailyEntry })).delete('/admin/daily-entries/d-1').expect(204);
    expect(deleteDailyEntry).toHaveBeenCalledWith('d-1');

    const missing = vi.fn().mockRejectedValue(new LibraryNotFoundError('library_not_found'));
    const res = await request(appWith({ deleteDailyEntry: missing }))
      .delete('/admin/daily-entries/gone')
      .expect(404);

    expect(res.body.code).toBe('library_not_found');
  });
});

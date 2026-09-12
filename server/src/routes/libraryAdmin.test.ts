import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { LibraryConflictError, LibraryNotFoundError } from '../modules/library/libraryAuthoring';
import { createLibraryAdminRouter } from './libraryAdmin';

type Role = 'user' | 'admin';

/** Every id in this API is a UUID; the router rejects anything else with 400. */
const TOPIC_ID = '11111111-1111-4111-8111-111111111111';
const SECTION_ID = '22222222-2222-4222-8222-222222222222';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';
const DAILY_ID = '44444444-4444-4444-8444-444444444444';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

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
    findTopicStatus: vi
      .fn()
      .mockResolvedValue({ id: TOPIC_ID, archived: options?.archived ?? false }),
    findTopicIdForSection: vi.fn().mockResolvedValue(TOPIC_ID),
    findTopicIdForQuestion: vi.fn().mockResolvedValue(TOPIC_ID),
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

  it('rejects an id that is not a UUID before any repository call', async () => {
    const updateTopic = vi.fn();

    const res = await request(appWith({ updateTopic }))
      .patch('/admin/topics/not-a-uuid')
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
      .mockResolvedValueOnce({ id: TOPIC_ID })
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
    expect(created.body).toEqual({ id: TOPIC_ID });

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
      .patch(`/admin/topics/${TOPIC_ID}`)
      .send({ key: 'renamed' })
      .expect(400);

    expect(res.body.code).toBe('library_invalid_document');
    expect(updateTopic).not.toHaveBeenCalled();
  });

  it('404s an unknown topic', async () => {
    const getTopicDetail = vi.fn().mockResolvedValue(null);

    const res = await request(appWith({ getTopicDetail }))
      .get(`/admin/topics/${UNKNOWN_ID}`)
      .expect(404);

    expect(res.body.code).toBe('library_not_found');
  });

  it('returns a snapshot when archiving', async () => {
    const setTopicArchived = vi.fn().mockResolvedValue(undefined);

    const res = await request(appWith({ setTopicArchived }))
      .post(`/admin/topics/${TOPIC_ID}/archive`)
      .expect(200);

    expect(setTopicArchived).toHaveBeenCalledWith(TOPIC_ID, true);
    expect(res.body.snapshot).toMatchObject({ title: 'T' });
  });

  it('refuses to touch the children of an archived topic', async () => {
    const createSection = vi.fn();

    const res = await request(appWith({ createSection }, 'admin', { archived: true }))
      .post(`/admin/topics/${TOPIC_ID}/sections`)
      .send({ name: 'Phần II' })
      .expect(409);

    expect(res.body.code).toBe('library_archived');
    expect(createSection).not.toHaveBeenCalled();
  });
});

describe('library admin routes — sections and questions', () => {
  it('creates a section and a question', async () => {
    const createSection = vi.fn().mockResolvedValue({ id: SECTION_ID });
    const createQuestion = vi.fn().mockResolvedValue({ id: QUESTION_ID });

    const section = await request(appWith({ createSection }))
      .post(`/admin/topics/${TOPIC_ID}/sections`)
      .send({ name: 'Phần II' })
      .expect(201);
    expect(section.body).toEqual({ id: SECTION_ID });
    expect(createSection).toHaveBeenCalledWith({ topicId: TOPIC_ID, name: 'Phần II' });

    const question = await request(appWith({ createQuestion }))
      .post(`/admin/sections/${SECTION_ID}/questions`)
      .send({ prompt: 'Câu mới', blocks: [{ type: 'text', text: 'x' }] })
      .expect(201);
    expect(question.body).toEqual({ id: QUESTION_ID });
    expect(createQuestion).toHaveBeenCalledWith({
      sectionId: SECTION_ID,
      code: null,
      prompt: 'Câu mới',
      level: null,
      blocks: [{ type: 'text', text: 'x' }],
    });
  });

  it('rejects a question whose blocks do not match the contract', async () => {
    const createQuestion = vi.fn();

    const res = await request(appWith({ createQuestion }))
      .post(`/admin/sections/${SECTION_ID}/questions`)
      .send({ prompt: 'x', blocks: [{ type: 'image', src: 'y' }] })
      .expect(400);

    expect(res.body.path).toBe('blocks[0].type');
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it('passes a level change straight through, including null', async () => {
    const updateQuestion = vi.fn().mockResolvedValue(undefined);

    await request(appWith({ updateQuestion }))
      .patch(`/admin/questions/${QUESTION_ID}`)
      .send({ level: 'advanced' })
      .expect(204);
    expect(updateQuestion).toHaveBeenCalledWith(QUESTION_ID, { level: 'advanced' });

    await request(appWith({ updateQuestion }))
      .patch(`/admin/questions/${QUESTION_ID}`)
      .send({ level: null })
      .expect(204);
    expect(updateQuestion).toHaveBeenLastCalledWith(QUESTION_ID, { level: null });
  });

  it('returns the pre-delete snapshot so a delete is undoable', async () => {
    const deleteQuestion = vi.fn().mockResolvedValue(undefined);

    const res = await request(appWith({ deleteQuestion }))
      .delete(`/admin/questions/${QUESTION_ID}`)
      .expect(200);

    expect(deleteQuestion).toHaveBeenCalledWith(QUESTION_ID);
    expect(res.body.snapshot).toMatchObject({ title: 'T' });
  });

  it('refuses to delete a question the Daily pool uses, before deleting anything', async () => {
    const deleteQuestion = vi.fn();
    const listDailyReferencesForQuestion = vi.fn().mockResolvedValue(['d-mcq-001']);

    const res = await request(appWith({ deleteQuestion, listDailyReferencesForQuestion }))
      .delete(`/admin/questions/${QUESTION_ID}`)
      .expect(409);

    expect(res.body).toMatchObject({ code: 'library_in_use', entryIds: ['d-mcq-001'] });
    expect(deleteQuestion).not.toHaveBeenCalled();
  });

  it('refuses to delete a section the Daily pool uses', async () => {
    const deleteSection = vi.fn();
    const listDailyReferencesForSection = vi.fn().mockResolvedValue(['d-mcq-002']);

    const res = await request(appWith({ deleteSection, listDailyReferencesForSection }))
      .delete(`/admin/sections/${SECTION_ID}`)
      .expect(409);

    expect(res.body.entryIds).toEqual(['d-mcq-002']);
    expect(deleteSection).not.toHaveBeenCalled();
  });
});

describe('library admin routes — import and export', () => {
  it('normalizes the document before importing it', async () => {
    const importTopic = vi.fn().mockResolvedValue({ sections: 2, questions: 9 });

    const res = await request(appWith({ importTopic }))
      .post(`/admin/topics/${TOPIC_ID}/import`)
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
      topicId: TOPIC_ID,
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

  it('accepts an exported document back, including null code and subtitle', async () => {
    const importTopic = vi.fn().mockResolvedValue({ sections: 1, questions: 1 });

    await request(appWith({ importTopic }))
      .post(`/admin/topics/${TOPIC_ID}/import`)
      .send({
        mode: 'replace',
        document: {
          title: 'T',
          subtitle: null,
          label: 'L',
          color: '#000000',
          sections: [{ name: 'S', questions: [{ code: null, level: null, q: 'one', blocks: [] }] }],
        },
      })
      .expect(200);

    expect(importTopic).toHaveBeenCalledWith({
      topicId: TOPIC_ID,
      mode: 'replace',
      document: {
        title: 'T',
        subtitle: null,
        label: 'L',
        color: '#000000',
        sections: [
          { name: 'S', questions: [{ code: null, prompt: 'one', level: null, blocks: [] }] },
        ],
      },
    });
  });

  it('reports the nested path of a broken import', async () => {
    const importTopic = vi.fn();

    const res = await request(appWith({ importTopic }))
      .post(`/admin/topics/${TOPIC_ID}/import`)
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
    const res = await request(appWith({})).get(`/admin/topics/${TOPIC_ID}/export`).expect(200);

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
    const createDailyEntry = vi.fn().mockResolvedValue({ id: DAILY_ID });

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

    await request(appWith({ deleteDailyEntry }))
      .delete(`/admin/daily-entries/${DAILY_ID}`)
      .expect(204);
    expect(deleteDailyEntry).toHaveBeenCalledWith(DAILY_ID);

    const missing = vi.fn().mockRejectedValue(new LibraryNotFoundError('library_not_found'));
    const res = await request(appWith({ deleteDailyEntry: missing }))
      .delete(`/admin/daily-entries/${UNKNOWN_ID}`)
      .expect(404);

    expect(res.body.code).toBe('library_not_found');
  });
});

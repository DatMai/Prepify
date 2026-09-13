import { beforeEach, describe, expect, it, vi } from 'vitest';

const { indexMock, topicMock } = vi.hoisted(() => ({
  indexMock: vi.fn(),
  topicMock: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: { library: { index: indexMock, topic: topicMock } },
}));

const index = [
  {
    key: 'javascript',
    label: 'JavaScript',
    title: null,
    subtitle: null,
    color: '#f5a623',
    questionCount: 2,
  },
  {
    key: 'typescript',
    label: 'TypeScript',
    title: null,
    subtitle: null,
    color: '#4aa3ff',
    questionCount: 1,
  },
];

const topic = (key: string) => ({
  key,
  label: key,
  title: null,
  subtitle: null,
  color: '#fff',
  sections: [],
});

describe('library loader', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
    indexMock.mockReset().mockResolvedValue(index);
    topicMock.mockReset().mockImplementation(async (key: string) => topic(key));
  });

  it('loads the topic index without fetching every topic', async () => {
    const loader = await import('./loader');

    await loader.loadLibrary('vi');

    expect(indexMock).toHaveBeenCalledWith('vi');
    expect(topicMock).not.toHaveBeenCalled();
    expect(loader.ORDER).toEqual(['javascript', 'typescript']);
    expect(loader.DATA).toEqual({});
  });

  it('fetches a selected topic once and reuses its locale cache', async () => {
    const loader = await import('./loader');
    await loader.loadLibrary('vi');

    await loader.loadTopic('javascript', 'vi');
    await loader.loadTopic('javascript', 'vi');

    expect(topicMock).toHaveBeenCalledTimes(1);
    expect(loader.DATA.javascript).toEqual(topic('javascript'));
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe('topic header', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    document.body.innerHTML = `
      <h2 id="tTitle"></h2>
      <span id="tSub"></span>
      <input id="search" />
      <div id="inner"></div>`;
  });

  it('does not print a subtitle line under the topic title', async () => {
    const { DATA } = await import('../data/loader');
    DATA['javascript'] = {
      title: 'JavaScript',
      subtitle: '*Top 58 interview questions JavaScript*',
      label: 'JS',
      color: '#fff',
      sections: [
        { name: 'S', questions: [{ q: 'Question?', blocks: [{ type: 'text', text: 'Answer' }] }] },
      ],
    } as never;
    const { state } = await import('../state/progress');
    state.topic = 'javascript';
    const { render } = await import('./content');

    render();

    expect(document.getElementById('tTitle')?.textContent).toBe('JS');
    expect(document.getElementById('tSub')?.textContent).toBe('');
    expect(document.getElementById('inner')?.textContent).toContain('Question?');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { executeCode, type IsolatedWorker } from './codeRunner';

class FakeWorker implements IsolatedWorker {
  onmessage: ((event: MessageEvent<{ logs: string[]; error?: string }>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;
  posted = '';

  postMessage(source: string): void {
    this.posted = source;
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('isolated code runner', () => {
  it('returns worker output and terminates the worker', async () => {
    const worker = new FakeWorker();
    const resultPromise = executeCode('console.log(42)', {
      createWorker: () => worker,
      timeoutMs: 100,
    });

    worker.onmessage?.(new MessageEvent('message', { data: { logs: ['42'] } }));

    await expect(resultPromise).resolves.toEqual({ logs: ['42'] });
    expect(worker.posted).toBe('console.log(42)');
    expect(worker.terminated).toBe(true);
  });

  it('terminates code that exceeds the hard timeout', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const resultPromise = executeCode('while (true) {}', {
      createWorker: () => worker,
      timeoutMs: 50,
    });

    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toEqual({
      logs: [],
      error: 'Execution timed out',
    });
    expect(worker.terminated).toBe(true);
    vi.useRealTimers();
  });
});

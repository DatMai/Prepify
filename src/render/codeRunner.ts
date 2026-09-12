export interface CodeExecutionResult {
  logs: string[];
  error?: string;
}

export interface IsolatedWorker {
  onmessage: ((event: MessageEvent<CodeExecutionResult>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(source: string): void;
  terminate(): void;
}

interface RunnerOptions {
  createWorker?: () => IsolatedWorker;
  timeoutMs?: number;
}

const WORKER_SOURCE = `
self.onmessage = (event) => {
  const logs = [];
  const format = (value) => {
    try { return typeof value === 'object' ? JSON.stringify(value) : String(value); }
    catch { return String(value); }
  };
  const capture = (...values) => logs.push(values.map(format).join(' '));
  const safeConsole = { log: capture, error: capture, warn: capture, info: capture };
  try {
    self.fetch = undefined;
    self.XMLHttpRequest = undefined;
    self.WebSocket = undefined;
    self.EventSource = undefined;
    self.importScripts = undefined;
    const execute = new Function('console', '"use strict";\\n' + event.data);
    execute(safeConsole);
    self.postMessage({ logs });
  } catch (error) {
    self.postMessage({ logs, error: error instanceof Error ? error.message : String(error) });
  }
};`;

function createBrowserWorker(): IsolatedWorker {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  return worker;
}

export function executeCode(
  source: string,
  { createWorker = createBrowserWorker, timeoutMs = 1_500 }: RunnerOptions = {},
): Promise<CodeExecutionResult> {
  return new Promise((resolve) => {
    const worker = createWorker();
    let settled = false;
    const finish = (result: CodeExecutionResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ logs: [], error: 'Execution timed out' }), timeoutMs);

    worker.onmessage = (event) => {
      const logs = Array.isArray(event.data?.logs)
        ? event.data.logs.filter((item): item is string => typeof item === 'string')
        : [];
      finish({ logs, ...(event.data?.error ? { error: String(event.data.error) } : {}) });
    };
    worker.onerror = (event) => finish({ logs: [], error: event.message || 'Worker failed' });
    worker.postMessage(source);
  });
}

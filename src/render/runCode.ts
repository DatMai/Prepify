function fmt(v: unknown): string {
  try {
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  } catch {
    return String(v);
  }
}

export function runCode(cid: string): void {
  const codeEl = document.getElementById('code_' + cid);
  const outEl = document.getElementById('out_' + cid);
  if (!codeEl || !outEl) return;

  const src = codeEl.textContent || '';
  const logs: string[] = [];
  const fakeConsole = {
    log: (...a: unknown[]) => logs.push(a.map(fmt).join(' ')),
    error: (...a: unknown[]) => logs.push(a.map(fmt).join(' ')),
    warn: (...a: unknown[]) => logs.push(a.map(fmt).join(' ')),
    info: (...a: unknown[]) => logs.push(a.map(fmt).join(' ')),
  };

  outEl.classList.remove('err');
  try {
    const fn = new Function('console', src);
    fn(fakeConsole);
    outEl.textContent = logs.length
      ? logs.join('\n')
      : '✓ chạy xong (không có console.log nào in ra)';
    outEl.classList.add('show');
  } catch (err) {
    outEl.textContent = '✗ ' + (err instanceof Error ? err.message : String(err));
    outEl.classList.add('show', 'err');
  }
}

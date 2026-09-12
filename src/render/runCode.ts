import { t } from '../i18n';
import { executeCode } from './codeRunner';

export async function runCode(cid: string): Promise<void> {
  const codeEl = document.getElementById('code_' + cid);
  const outEl = document.getElementById('out_' + cid);
  if (!codeEl || !outEl) return;

  const src = codeEl.textContent || '';
  outEl.classList.remove('err');
  outEl.textContent = '…';
  outEl.classList.add('show');
  const result = await executeCode(src);
  outEl.textContent = result.error
    ? `✗ ${result.error}`
    : result.logs.length
      ? result.logs.join('\n')
      : t('runtime.noLogs');
  outEl.classList.toggle('err', Boolean(result.error));
}

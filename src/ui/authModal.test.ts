// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../state/auth';

let auth: AuthState;
let updateAuthBtn: () => void;

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

describe('updateAuthBtn', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.stubGlobal('localStorage', memoryStorage());
    ({ auth } = await import('../state/auth'));
    ({ updateAuthBtn } = await import('./authModal'));
  });

  afterEach(() => {
    auth.user = null;
    document.body.innerHTML = '';
  });

  it('renders profile data as text instead of executable markup', () => {
    document.body.innerHTML = '<main class="main"></main><button id="authBtn"></button>';
    auth.user = {
      id: 'user-1',
      email: 'owner+<img src=x>@example.com',
      displayName: '<img src=x onerror=alert(1)>',
      role: 'admin',
      emailVerifiedAt: null,
    };

    updateAuthBtn();

    expect(document.querySelector('.auth-name')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelectorAll('#authBtn img')).toHaveLength(1);
    expect(document.querySelector('#verifyBanner')?.querySelector('img')).toBeNull();
    expect(document.querySelector('#verifyBanner strong')?.textContent).toBe(
      'owner+<img src=x>@example.com',
    );
  });
});

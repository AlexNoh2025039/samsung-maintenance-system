const SESSION_TOKEN_KEY = 'samsung-maintenance.session-token';

export const sessionStorageToken = {
  get(): string | null {
    return window.sessionStorage.getItem(SESSION_TOKEN_KEY);
  },
  set(token: string): void {
    window.sessionStorage.setItem(SESSION_TOKEN_KEY, token);
  },
  clear(): void {
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
  },
};

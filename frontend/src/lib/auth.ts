const TOKEN_KEY = 'exam_scheduler_token';

export const getToken = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
};

export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
  document.cookie = `exam_scheduler_token=${token}; path=/; SameSite=Lax`;
};

export const clearToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
  document.cookie = 'exam_scheduler_token=; path=/; max-age=0';
};

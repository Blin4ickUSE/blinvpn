// ==========================================
// 0. ENV & API HELPERS
// ==========================================

declare const importMetaMini: any | undefined;

const rawEnvMini: any =
  (typeof importMetaMini !== 'undefined' && importMetaMini.env) ||
  (typeof (window as any) !== 'undefined' && (window as any).__ENV__) ||
  {};

const API_BASE_URL_MINI: string = rawEnvMini.VITE_API_URL || rawEnvMini.REACT_APP_API_URL || '/api';
const SUPPORT_URL: string = rawEnvMini.VITE_SUPPORT_URL || rawEnvMini.REACT_APP_SUPPORT_URL || 'https://t.me/blinteambot';
const BOT_USERNAME_MINI: string = rawEnvMini.VITE_BOT_USERNAME || rawEnvMini.REACT_APP_BOT_USERNAME || 'blinvpn_bot';
export async function miniApiFetch(path: string, options: RequestInit = {}): Promise<any> {
  // Всегда используем относительный путь /api - nginx проксирует на backend
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `/api${cleanPath}`;
  
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  
  // Обработка бана (статус 403)
  if (res.status === 403) {
    try {
      const data = await res.json();
      if (data.required_subscription) {
        return {
          _needsSubscription: true,
          channel_link: data.channel_link || 'https://t.me',
          channel_id: data.channel_id
        };
      }
      if (data.banned) {
        return { _banned: true, reason: data.reason || 'Аккаунт заблокирован' };
      }
    } catch {}
    throw new Error('Access denied');
  }
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export { SUPPORT_URL, BOT_USERNAME_MINI, API_BASE_URL_MINI };

// ==========================================
// Panel API
// ==========================================

declare const importMetaPanel: any | undefined;

const rawEnvPanel: any =
  (typeof importMetaPanel !== 'undefined' && importMetaPanel.env) ||
  (typeof (window as any) !== 'undefined' && (window as any).__ENV__) ||
  {};

export const API_BASE_URL_PANEL: string =
  rawEnvPanel.VITE_API_URL || rawEnvPanel.REACT_APP_API_URL || '/api';
export const BOT_USERNAME: string =
  rawEnvPanel.VITE_BOT_USERNAME || rawEnvPanel.REACT_APP_BOT_USERNAME || 'blinvpn_bot';

export function getPanelToken(): string {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('panel_token') || '';
  }
  return '';
}

export function setPanelToken(token: string): void {
  if (typeof window !== 'undefined') {
    localStorage.setItem('panel_token', token);
  }
}

export function clearPanelToken(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('panel_token');
  }
}

export async function panelApiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const url = `/api${cleanPath}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (cleanPath.startsWith('/panel')) {
    const token = getPanelToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) {
      clearPanelToken();
      window.location.reload();
    }
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const TOKEN_KEY = 'sf-access-token';
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function apiUrl(path: string): string {
  return `${BASE_URL}${path}`;
}

export class ApiError extends Error {
  status: number;
  /** 解析后的 JSON 错误体（如 409 冲突附带的 currentVersion、code）；非 JSON 时为 undefined */
  body?: Record<string, unknown>;
  constructor(status: number, message: string, body?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function parseError(res: Response): Promise<{ message: string; body?: Record<string, unknown> }> {
  const text = await res.text().catch(() => '');
  if (!text) return { message: `请求失败（HTTP ${res.status}）` };
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const detail = json.detail ?? json.message ?? json.error;
    if (typeof detail === 'string' && detail.trim()) return { message: detail, body: json };
    return { message: text.slice(0, 160), body: json };
  } catch {
    /* 非 JSON 响应直接返回截断文本 */
  }
  return { message: text.slice(0, 160) };
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) {
    const { message, body } = await parseError(res);
    throw new ApiError(res.status, message, body);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

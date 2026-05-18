import { useState, useEffect, useCallback } from "react";
import { getToken } from "./auth";

const BASE = "/api";

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Token ${token}` } : {}),
    ...extra,
  };
}

function handleUnauthorized(res: Response) {
  if (res.status === 401 && typeof window !== "undefined") {
    localStorage.removeItem("auth_token");
    localStorage.removeItem("auth_username");
    window.location.href = "/login";
  }
}

export const api = {
  get: async (path: string) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      handleUnauthorized(res);
      throw new Error(`GET ${path} → ${res.status}`);
    }
    return res.json();
  },
  post: async (path: string, body: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      handleUnauthorized(res);
      const e = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`${res.status}`), { data: e });
    }
    return res.json();
  },
  patch: async (path: string, body: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      handleUnauthorized(res);
      const e = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`${res.status}`), { data: e });
    }
    return res.json();
  },
  put: async (path: string, body: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      handleUnauthorized(res);
      const e = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`${res.status}`), { data: e });
    }
    return res.json();
  },
  upload: async (path: string, fd: FormData) => {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Token ${token}` } : {},
      body: fd,
    });
    if (!res.ok) {
      handleUnauthorized(res);
      const e = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`${res.status}`), { data: e });
    }
    return res.json();
  },
  downloadPost: async (path: string, body: unknown, filename: string) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      handleUnauthorized(res);
      const e = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`${res.status}`), { data: e });
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
  delete: async (path: string) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    if (!res.ok) {
      handleUnauthorized(res);
      const e = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`${res.status}`), { data: e });
    }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  },
};

export function useFetch(path: string, extraDeps: unknown[] = []) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback((opts?: { silent?: boolean }) => {
    if (!path) { setLoading(false); return; }
    const silent = opts?.silent ?? false;
    if (!silent) setLoading(true);
    api.get(path)
      .then(d => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, [path]);

  useEffect(() => { refetch(); }, [refetch, ...extraDeps]);

  return { data, loading, error, refetch };
}

import { useState, useEffect, useCallback } from "react";

const BASE = "/api";

export const api = {
  get: async (path: string) => {
    const res = await fetch(`${BASE}${path}`, { 
      headers: { "Content-Type": "application/json" },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  },
  post: async (path: string, body: any) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(`${res.status}`), { data: e }); }
    return res.json();
  },
  patch: async (path: string, body: any) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(`${res.status}`), { data: e }); }
    return res.json();
  },
  put: async (path: string, body: any) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(`${res.status}`), { data: e }); }
    return res.json();
  },
  upload: async (path: string, fd: FormData) => {
    const res = await fetch(`${BASE}${path}`, { method: "POST", body: fd });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(`${res.status}`), { data: e }); }
    return res.json();
  },
  downloadPost: async (path: string, body: any, filename: string) => {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(`${res.status}`), { data: e }); }
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
    const res = await fetch(`${BASE}${path}`, { method: "DELETE" });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(`${res.status}`), { data: e }); }
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  },
};

export function useFetch(path: string, extraDeps: any[] = []) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    if (!path) { setLoading(false); return; }
    setLoading(true);
    api.get(path)
      .then(d => { setData(d); setError(null); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(() => { refetch(); }, [refetch, ...extraDeps]);
  
  return { data, loading, error, refetch };
}

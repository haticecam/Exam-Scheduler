"use client";
import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/token/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.non_field_errors?.[0] || "Kullanıcı adı veya şifre hatalı.");
        return;
      }
      const data = await res.json();
      login(data.token, username);
      router.push("/");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ width: 400, ...mono }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
          Exam Scheduler
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6 }}>Hesabınıza giriş yapın</div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 36px" }}>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", marginBottom: 8 }}>
              KULLANICI ADI
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
              autoFocus
              style={{
                width: "100%", boxSizing: "border-box",
                background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "10px 14px", color: C.text, fontSize: 13, outline: "none",
                ...mono
              }}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", marginBottom: 8 }}>
              ŞİFRE
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                width: "100%", boxSizing: "border-box",
                background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "10px 14px", color: C.text, fontSize: 13, outline: "none",
                ...mono
              }}
            />
          </div>

          {error && (
            <div style={{ background: C.redSoft, border: `1px solid color-mix(in srgb, ${C.red} 40%, transparent)`, borderRadius: 8, padding: "10px 14px", color: C.red, fontSize: 12, marginBottom: 16 }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%", padding: "11px", background: loading ? C.accentSoft : C.accent,
              color: loading ? C.textMuted : "#fff", border: "none", borderRadius: 8,
              fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer",
              ...mono
            }}
          >
            {loading ? "Giriş yapılıyor…" : "Giriş Yap"}
          </button>
        </form>

        <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: C.textMuted }}>
          <Link href="/forgot-password" style={{ color: C.accent, textDecoration: "none" }}>
            Şifremi unuttum
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: C.textMuted }}>
        Hesabınız yok mu?{" "}
        <Link href="/signup" style={{ color: C.accent, textDecoration: "none" }}>
          Kayıt ol
        </Link>
      </div>
    </div>
  );
}

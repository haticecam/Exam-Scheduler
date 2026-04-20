"use client";
import React, { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { C, mono } from "@/lib/colors";

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ username: "", email: "", password: "", password2: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function set(field: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (form.password !== form.password2) {
      setError("Şifreler eşleşmiyor.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const firstError = Object.values(data).flat()[0] as string;
        setError(firstError || "Kayıt başarısız.");
        return;
      }
      router.push("/login");
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 8,
    padding: "10px 14px", color: C.text, fontSize: 13, outline: "none",
    ...mono,
  };

  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", marginBottom: 8,
  };

  return (
    <div style={{ width: 400, ...mono }}>
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <Image src="/aybu-logo.png" alt="AYBU Logo" width={80} height={80} style={{ margin: "0 auto 16px", display: "block" }} />
        <div style={{ fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>
          Exam Scheduler
        </div>
        <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6 }}>Yeni hesap oluşturun</div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 36px" }}>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>KULLANICI ADI</label>
            <input type="text" value={form.username} onChange={set("username")} required autoFocus style={inputStyle} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>E-POSTA</label>
            <input type="email" value={form.email} onChange={set("email")} required style={inputStyle} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>ŞİFRE</label>
            <input type="password" value={form.password} onChange={set("password")} required minLength={8} style={inputStyle} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 5 }}>En az 8 karakter</div>
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>ŞİFRE TEKRAR</label>
            <input type="password" value={form.password2} onChange={set("password2")} required style={inputStyle} />
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
              ...mono,
            }}
          >
            {loading ? "Kaydediliyor…" : "Kayıt Ol"}
          </button>
        </form>
      </div>

      <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: C.textMuted }}>
        Zaten hesabınız var mı?{" "}
        <Link href="/login" style={{ color: C.accent, textDecoration: "none" }}>
          Giriş yap
        </Link>
      </div>
    </div>
  );
}

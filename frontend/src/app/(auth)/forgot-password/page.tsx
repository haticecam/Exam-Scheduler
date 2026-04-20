"use client";
import React, { useState } from "react";
import Link from "next/link";
import { C, mono } from "@/lib/colors";

type Step = "request" | "confirm" | "done";

export default function ForgotPasswordPage() {
  const [step, setStep] = useState<Step>("request");
  const [email, setEmail] = useState("");
  const [uid, setUid] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box",
    background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 8,
    padding: "10px 14px", color: C.text, fontSize: 13, outline: "none",
    ...mono,
  };
  const labelStyle: React.CSSProperties = {
    display: "block", fontSize: 11, color: C.textMuted, letterSpacing: "0.08em", marginBottom: 8,
  };

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.uid && data.token) {
        setUid(data.uid);
        setToken(data.token);
        setStep("confirm");
      } else {
        setError("Bu e-posta adresi sistemde kayıtlı değil.");
      }
    } catch {
      setError("Bağlantı hatası. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== newPassword2) {
      setError("Şifreler eşleşmiyor.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, token, new_password: newPassword }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.detail || "Şifre sıfırlama başarısız.");
        return;
      }
      setStep("done");
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
        <div style={{ fontSize: 13, color: C.textMuted, marginTop: 6 }}>Şifre sıfırlama</div>
      </div>

      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "32px 36px" }}>
        {step === "request" && (
          <form onSubmit={handleRequest}>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>E-POSTA ADRESİNİZ</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                required autoFocus style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ background: C.redSoft, border: `1px solid color-mix(in srgb, ${C.red} 40%, transparent)`, borderRadius: 8, padding: "10px 14px", color: C.red, fontSize: 12, marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                width: "100%", padding: "11px", background: loading ? C.accentSoft : C.accent,
                color: loading ? C.textMuted : "#fff", border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", ...mono,
              }}
            >
              {loading ? "Kontrol ediliyor…" : "Devam Et"}
            </button>
          </form>
        )}

        {step === "confirm" && (
          <form onSubmit={handleConfirm}>
            <div style={{ marginBottom: 20 }}>
              <label style={labelStyle}>YENİ ŞİFRE</label>
              <input
                type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                required minLength={8} autoFocus style={inputStyle}
              />
              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 5 }}>En az 8 karakter</div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={labelStyle}>YENİ ŞİFRE TEKRAR</label>
              <input
                type="password" value={newPassword2} onChange={e => setNewPassword2(e.target.value)}
                required style={inputStyle}
              />
            </div>

            {error && (
              <div style={{ background: C.redSoft, border: `1px solid color-mix(in srgb, ${C.red} 40%, transparent)`, borderRadius: 8, padding: "10px 14px", color: C.red, fontSize: 12, marginBottom: 16 }}>
                {error}
              </div>
            )}

            <button
              type="submit" disabled={loading}
              style={{
                width: "100%", padding: "11px", background: loading ? C.accentSoft : C.accent,
                color: loading ? C.textMuted : "#fff", border: "none", borderRadius: 8,
                fontSize: 13, fontWeight: 700, cursor: loading ? "not-allowed" : "pointer", ...mono,
              }}
            >
              {loading ? "Kaydediliyor…" : "Şifreyi Sıfırla"}
            </button>
          </form>
        )}

        {step === "done" && (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            <div style={{ color: C.green, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
              Şifreniz başarıyla güncellendi
            </div>
            <div style={{ color: C.textMuted, fontSize: 12 }}>
              Artık yeni şifrenizle giriş yapabilirsiniz.
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 20, textAlign: "center", fontSize: 12, color: C.textMuted }}>
        <Link href="/login" style={{ color: C.accent, textDecoration: "none" }}>
          ← Giriş sayfasına dön
        </Link>
      </div>
    </div>
  );
}

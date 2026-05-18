"use client";
import React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { useAuth } from "@/lib/auth";

const NAV_FLAT = [
  { id: "/",              label: "Genel Bakış" },
  { id: "/terms",         label: "Dönem Yönetimi" },
  { id: "/courses",       label: "Ders Bölümleri" },
  { id: "/rooms",         label: "Sınav Odaları" },
  { id: "/students",      label: "Öğrenci & Kayıt" },
  { id: "/exam-calendar", label: "Sınav Takvimi" },
  { id: "/optimizer",     label: "Çalıştır" },
  { id: "/solutions",     label: "Çözümler" },
  { id: "/schedule",      label: "Takvim Görünümü" },
];

const SUB_TABS: Record<string, Record<string, string>> = {
  "/exam-calendar": {
    optimization: "Ders Seçimi",
    simultaneous: "Eş Zamanlı Sınavlar",
  },
};

export default function Topbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { username, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();

  const currentLabel = NAV_FLAT.find(n => n.id === pathname)?.label ?? "Bilinmeyen Sayfa";
  const tab = searchParams.get("tab") ?? "";
  const subLabel = SUB_TABS[pathname]?.[tab] ?? null;

  return (
    <div style={{
      padding: "12px 32px",
      borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      background: "var(--surface-container-low)",
      flexShrink: 0,
    }}>
      <div style={{ fontSize: "0.75rem", color: "var(--on-surface-variant)" }}>
        Dashboard{" "}
        <span style={{ opacity: 0.5 }}>›</span>{" "}
        {subLabel ? (
          <>
            <span style={{ color: "var(--on-surface-variant)" }}>{currentLabel}</span>
            {" "}
            <span style={{ opacity: 0.5 }}>›</span>{" "}
            <span style={{ color: "var(--on-surface)" }}>{subLabel}</span>
          </>
        ) : (
          <span style={{ color: "var(--on-surface)" }}>{currentLabel}</span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {username && (
          <span style={{ fontSize: "0.75rem", color: "var(--on-surface-variant)" }}>
            {username}
          </span>
        )}
        <button
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          title={resolvedTheme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}
          style={{
            background: "transparent",
            color: "var(--on-surface-variant)",
            border: "1px solid color-mix(in srgb, var(--outline-variant) 80%, transparent)",
            borderRadius: 8,
            padding: "5px 8px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            transition: "background 140ms ease-out",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-bright)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        >
          {resolvedTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          onClick={logout}
          style={{
            background: "transparent",
            color: "var(--on-surface-variant)",
            border: "1px solid color-mix(in srgb, var(--outline-variant) 80%, transparent)",
            borderRadius: 8,
            padding: "5px 14px",
            cursor: "pointer",
            fontSize: "0.75rem",
            transition: "background 140ms ease-out",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-bright)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        >
          Çıkış
        </button>
      </div>
    </div>
  );
}

"use client";
import React from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth";

const NAV_FLAT = [
  { id: "/",          label: "Genel Bakış" },
  { id: "/terms",     label: "Dönem Yönetimi" },
  { id: "/courses",   label: "Ders Bölümleri" },
  { id: "/rooms",     label: "Sınav Odaları" },
  { id: "/students",  label: "Öğrenci & Kayıt" },
  { id: "/optimizer", label: "Çalıştır" },
  { id: "/solutions", label: "Çözümler" },
  { id: "/schedule",  label: "Takvim Görünümü" },
];

export default function Topbar() {
  const pathname = usePathname();
  const { username, logout } = useAuth();
  const currentLabel = NAV_FLAT.find(n => n.id === pathname)?.label ?? "Bilinmeyen Sayfa";

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
        <span style={{ color: "var(--on-surface)" }}>{currentLabel}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {username && (
          <span style={{ fontSize: "0.75rem", color: "var(--on-surface-variant)" }}>
            {username}
          </span>
        )}
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

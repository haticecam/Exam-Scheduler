"use client";
import React from "react";
import { usePathname } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useAuth } from "@/lib/auth";

const NAV_FLAT = [
  { id: "/", label: "Genel Bakış" },
  { id: "/terms", label: "Dönem Yönetimi" },
  { id: "/courses", label: "Ders Bölümleri" },
  { id: "/rooms", label: "Sınav Odaları" },
  { id: "/students", label: "Öğrenci & Kayıt" },
  { id: "/optimizer", label: "Çalıştır" },
  { id: "/solutions", label: "Çözümler" },
  { id: "/schedule", label: "Takvim Görünümü" },
];

export default function Topbar() {
  const pathname = usePathname();
  const { username, logout } = useAuth();
  const currentLabel = NAV_FLAT.find(n => n.id === pathname)?.label || "Bilinmeyen Sayfa";

  return (
    <div style={{ padding: "14px 32px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.surface, flexShrink: 0 }}>
      <div style={{ fontSize: 12, color: C.textMuted, ...mono }}>
        Dashboard  ›  <span style={{ color: C.text }}>{currentLabel}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        {username && (
          <span style={{ fontSize: 12, color: C.textSub, ...mono }}>{username}</span>
        )}
        <button
          onClick={logout}
          style={{
            background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`,
            borderRadius: 6, padding: "6px 14px", cursor: "pointer", ...mono, fontSize: 12,
          }}
        >
          Çıkış
        </button>
      </div>
    </div>
  );
}

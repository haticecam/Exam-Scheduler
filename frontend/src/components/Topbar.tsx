"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { NAV } from "./page"; // Just for label lookup

const NAV_FLAT = [
  { id: "/", label: "Genel Bakış" },
  { id: "/terms", label: "Dönem Yönetimi" },
  { id: "/courses", label: "Ders Bölümleri" },
  { id: "/rooms", label: "Sınav Odaları" },
  { id: "/students", label: "Öğrenci & Kayıt" },
  { id: "/periods", label: "Sınav Dönemleri" },
  { id: "/exams", label: "Sınav Tanımları" },
  { id: "/constraints", label: "Kısıtlar" },
  { id: "/optimizer", label: "Çalıştır" },
  { id: "/solutions", label: "Çözümler" },
  { id: "/schedule", label: "Takvim Görünümü" },
];

export default function Topbar() {
  const pathname = usePathname();
  const currentLabel = NAV_FLAT.find(n => n.id === pathname)?.label || "Bilinmeyen Sayfa";

  return (
    <div style={{ padding: "14px 32px", borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center", background: C.surface, flexShrink: 0 }}>
      <div style={{ fontSize: 12, color: C.textMuted, ...mono }}>
        Dashboard  ›  <span style={{ color: C.text }}>{currentLabel}</span>
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        {[{ id: "/", label: "Dashboard" }].map(b => (
          <Link
            key={b.id}
            href={b.id}
            style={{ textDecoration: "none", background: C.accent, color: "#fff", border: `1px solid ${C.accent}`, borderRadius: 6, padding: "6px 14px", cursor: "pointer", ...mono, fontSize: 12 }}
          >
            {b.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

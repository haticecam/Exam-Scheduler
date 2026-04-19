"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useFetch } from "@/lib/api";
import { Badge } from "@/components/ui";
import { useAuth } from "@/lib/auth";

const NAV = [
  {
    label: "1 — VERİ GİRİŞİ", items: [
      { id: "/terms", label: "Dönem Yönetimi" },
      { id: "/courses", label: "Ders Kataloğu" },
      { id: "/students", label: "Öğrenci & Kayıt" },
      { id: "/rooms", label: "Oda Yönetimi" },
    ]
  },
  {
    label: "2 — OPTİMİZASYON", items: [
      { id: "/optimizer", label: "Çalıştır" },
      { id: "/solutions", label: "Çözümler" },
    ]
  },
  {
    label: "3 — SONUÇ", items: [
      { id: "/schedule", label: "Takvim Görünümü" },
    ]
  },
];

const NavItem = ({ id, label, active }: { id: string; label: string; active: string }) => (
  <Link
    href={id}
    style={{ display: "block", textDecoration: "none", padding: "8px 20px", cursor: "pointer", background: active === id ? C.accentSoft : "transparent", borderLeft: active === id ? `2px solid ${C.accent}` : "2px solid transparent", transition: "background 0.12s" }}
    onMouseEnter={e => { if (active !== id) e.currentTarget.style.background = "#ffffff08"; }}
    onMouseLeave={e => { if (active !== id) e.currentTarget.style.background = "transparent"; }}
  >
    <span style={{ fontSize: 13, color: active === id ? C.accent : C.textSub }}>{label}</span>
  </Link>
);

export default function Sidebar() {
  const pathname = usePathname();
  const { data: termData } = useFetch("/terms/?status=Active");
  const activeTerm = termData?.results?.[0] || termData?.[0];
  const { username, logout } = useAuth();

  return (
    <div style={{ width: 262, background: C.surface, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0, overflowY: "auto" }}>
      <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ ...mono, fontWeight: 700, fontSize: 20, color: C.text }}>Exam Scheduler</div>
      </div>

      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 6 }}>AKTİF DÖNEM</div>
        <div style={{ background: "#0d0e1a", border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: C.text, ...mono }}>{activeTerm?.name ?? "Yükleniyor…"}</span>
          {activeTerm && <Badge status={activeTerm.status} />}
        </div>
      </div>

      <div style={{ padding: "10px 0 20px", flex: 1 }}>
        <div style={{ padding: "12px 16px 6px", fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.1em" }}>NAVİGASYON</div>
        <NavItem id="/" label="Genel Bakış" active={pathname} />
        {NAV.map(sec => (
          <div key={sec.label}>
            <div style={{ padding: "14px 20px 6px", fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em" }}>{sec.label}</div>
            {sec.items.map(item => <NavItem key={item.id} id={item.id} label={item.label} active={pathname} />)}
          </div>
        ))}
      </div>

      <div style={{ padding: "16px 20px", borderTop: `1px solid ${C.border}` }}>
        {username && (
          <div style={{ fontSize: 11, color: C.textMuted, ...mono, marginBottom: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {username}
          </div>
        )}
        <button
          onClick={logout}
          style={{ width: "100%", background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", fontSize: 12, ...mono, textAlign: "left" }}
        >
          Çıkış Yap
        </button>
      </div>
    </div>
  );
}

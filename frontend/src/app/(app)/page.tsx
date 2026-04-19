"use client";
import React from "react";
import { useRouter } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useFetch } from "@/lib/api";
import { Card, Spinner } from "@/components/ui";

export const NAV = []; // Placeholder export for topbar

export default function OverviewPage() {
  const router = useRouter();
  const { data: termData, loading: tL } = useFetch("/terms/?status=Active");
  const { data: statsData, loading: sL } = useFetch("/dashboard/stats/");
  const term = termData?.results?.[0] || termData?.[0];
  const stats = statsData || {};

  const displayStats = [
    { label: "Toplam Ders", value: stats.course_count ?? "—", sub: "aktif bölüm", color: C.accent },
    { label: "Kayıtlı Öğrenci", value: stats.student_count ?? "—", sub: "kayıtlı öğrenci", color: C.cyan },
    { label: "Sınav Odası", value: stats.room_count ?? "—", sub: "aktif oda", color: C.green },
  ];
  const cards = [
    { section: "VERİ GİRİŞİ", id: "/courses", title: "Ders Bölümleri", sub: "CSV yükle · bölüm yönetimi" },
    { section: "VERİ GİRİŞİ", id: "/students", title: "Öğrenci & Kayıt", sub: "Enrollment CSV · simülasyon" },
    { section: "SINAV PLANI", id: "/terms", title: "Dönem Yönetimi", sub: "Dönem oluştur · aktif dönem" },
    { section: "OPTİMİZASYON", id: "/optimizer", title: "Optimizer Çalıştır", sub: "Gurobi MIP · parametreler" },
    { section: "OPTİMİZASYON", id: "/solutions", title: "Çözüm Geçmişi", sub: "Tüm run'lar · metrikler" },
    { section: "SONUÇ", id: "/schedule", title: "Takvim Görünümü", sub: "Günlük sınav takvimi" },
  ];

  return (
    <div>
      <div style={{ fontSize: 12, color: C.textMuted, ...mono, marginBottom: 6 }}>● AKTİF DÖNEM</div>
      {tL
        ? <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 28 }}><Spinner /><span style={{ color: C.textMuted }}>Dönem yükleniyor…</span></div>
        : <h1 style={{ fontSize: 28, fontWeight: 700, color: C.text, margin: "0 0 4px", ...mono, letterSpacing: "-0.5px" }}>{term?.name ?? "Aktif dönem bulunamadı"}</h1>
      }
      <p style={{ color: C.textMuted, fontSize: 14, margin: "0 0 28px" }}>Sınav programlama sistemine hoş geldiniz. Herhangi bir modüle geçmek için kartlara tıklayın.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 32 }}>
        {displayStats.map(s => (
          <Card key={s.label} style={{ padding: "18px 20px" }}>
            <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>{s.label.toUpperCase()}</div>
            {sL ? <Spinner size={20} color={s.color} /> : <div style={{ fontSize: 26, fontWeight: 700, color: s.color, ...mono }}>{s.value}</div>}
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {cards.map(card => (
          <div key={card.id} onClick={() => router.push(card.id)}
            style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: "20px 22px", cursor: "pointer", transition: "border-color 0.15s, background 0.15s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.borderLight; e.currentTarget.style.background = C.surfaceHover; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.background = C.surface; }}
          >
            <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>{card.section}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 8, ...mono }}>{card.title}</div>
            <div style={{ height: 2, width: 32, background: C.border, borderRadius: 2, marginBottom: 10 }} />
            <div style={{ fontSize: 12, color: C.textMuted }}>{card.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

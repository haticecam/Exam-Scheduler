"use client";
import React from "react";
import { COLORS } from "@/lib/colors";
import { MOCK } from "@/lib/mockData";
import { useRouter } from "next/navigation";

export default function DashboardOverviewPage() {
  const router = useRouter();

  return (
    <div>
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: COLORS.textMuted, fontFamily: "monospace" }}>● AKTİF DÖNEM</span>
      </div>
      <h1 style={{ fontSize: 32, fontWeight: 700, color: COLORS.text, margin: "0 0 4px", fontFamily: "monospace", letterSpacing: "-0.5px" }}>
        {MOCK.term.name}
      </h1>
      <p style={{ color: COLORS.textMuted, fontSize: 14, margin: "0 0 28px" }}>
        Sınav programlama sistemine hoş geldiniz. Aşağıdan herhangi bir modüle geçiş yapabilirsiniz.
      </p>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 32 }}>
        {MOCK.stats.map((s) => (
          <div key={s.label} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "18px 20px" }}>
            <div style={{ fontSize: 11, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: 8 }}>{s.label.toUpperCase()}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color, fontFamily: "monospace", lineHeight: 1 }}>{s.value.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 6 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 }}>
        {[
          { section: "1 — VERİ GİRİŞİ", id: "/courses", title: "Ders Bölümleri", sub: "142 aktif bölüm · 3 fakülte" },
          { section: "1 — VERİ GİRİŞİ", id: "/rooms", title: "Sınav Odaları", sub: "34 oda · toplam 4,200 kapasite" },
          { section: "2 — SINAV PLANI", id: "/periods", title: "Sınav Dönemleri", sub: "3 dönem · 38 sınav tanımı" },
          { section: "2 — SINAV PLANI", id: "/constraints", title: "Kısıtlar", sub: "12 aktif kural" },
          { section: "3 — OPTİMİZASYON", id: "/optimizer", title: "Optimizer Çalıştır", sub: "Gurobi · MIP tabanlı çözücü" },
          { section: "3 — OPTİMİZASYON", id: "/solutions", title: "Çözüm Geçmişi", sub: "4 çözüm · en iyi skor 94.2" },
          { section: "4 — SONUÇ", id: "/schedule", title: "Takvim Görünümü", sub: "3 günlük önizleme" },
        ].map((card) => (
          <div
            key={card.id}
            onClick={() => router.push(card.id)}
            style={{ 
              background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, 
              padding: "20px 22px", cursor: "pointer" 
            }}
          >
            <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: 10 }}>{card.section}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text, marginBottom: 6, fontFamily: "monospace" }}>{card.title}</div>
            <div style={{ height: 2, width: 36, background: COLORS.border, borderRadius: 2, marginBottom: 10 }} />
            <div style={{ fontSize: 12, color: COLORS.textMuted }}>{card.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

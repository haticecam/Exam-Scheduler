"use client";
import React from "react";
import { COLORS } from "@/lib/colors";
import { MOCK } from "@/lib/mockData";
import Badge from "@/components/ui/Badge";
import ExamTypeTag from "@/components/ui/ExamTypeTag";

export default function PeriodsPage() {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: COLORS.text, margin: "0 0 6px", fontFamily: "monospace" }}>Sınav Dönemleri</h2>
      <p style={{ color: COLORS.textMuted, fontSize: 14, marginBottom: 24 }}>Dönem içindeki sınav periyotlarını yönetin.</p>
      
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {MOCK.examPeriods.map((p) => (
          <div key={p.name} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              <ExamTypeTag type={p.type} />
              <div>
                <div style={{ fontWeight: 600, color: COLORS.text, fontFamily: "monospace", fontSize: 15 }}>{p.name}</div>
                <div style={{ fontSize: 12, color: COLORS.textMuted, marginTop: 3 }}>{p.start} — {p.end}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 28, alignItems: "center" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: COLORS.text, fontFamily: "monospace" }}>{p.exams}</div>
                <div style={{ fontSize: 11, color: COLORS.textMuted }}>sınav</div>
              </div>
              <Badge status={p.status} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <button style={{ background: COLORS.accentSoft, color: COLORS.accent, border: `1px solid ${COLORS.accent}33`, borderRadius: 8, padding: "10px 20px", cursor: "pointer", fontFamily: "monospace", fontSize: 13 }}>
          + Yeni Dönem Ekle
        </button>
      </div>
    </div>
  );
}

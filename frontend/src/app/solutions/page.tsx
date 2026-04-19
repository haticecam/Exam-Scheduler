"use client";
import React from "react";
import { COLORS } from "@/lib/colors";
import { MOCK } from "@/lib/mockData";
import Badge from "@/components/ui/Badge";

export default function SolutionsPage() {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: COLORS.text, margin: "0 0 6px", fontFamily: "monospace" }}>Çözüm Geçmişi</h2>
      <p style={{ color: COLORS.textMuted, fontSize: 14, marginBottom: 24 }}>Üretilen tüm çizelgeleme çözümleri ve metrikleri.</p>
      
      <div style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
              {["ÇÖZÜM ADI", "TARİH", "DURUM", "SKOR", "ÇAKIŞMA", "SÜRE", ""].map(h => (
                <th key={h} style={{ padding: "12px 16px", fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.08em", textAlign: "left", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK.solutions.map((s) => (
              <tr key={s.id} style={{ borderBottom: `1px solid ${COLORS.border}33` }}>
                <td style={{ padding: "14px 16px", color: COLORS.text, fontFamily: "monospace", fontSize: 13, fontWeight: 600 }}>{s.name}</td>
                <td style={{ padding: "14px 16px", color: COLORS.textMuted, fontSize: 12 }}>{s.date}</td>
                <td style={{ padding: "14px 16px" }}><Badge status={s.status} /></td>
                <td style={{ padding: "14px 16px", fontFamily: "monospace", fontSize: 14, color: s.score ? COLORS.green : COLORS.textMuted, fontWeight: s.score ? 700 : 400 }}>
                  {s.score ? `${s.score}` : "—"}
                </td>
                <td style={{ padding: "14px 16px", fontFamily: "monospace", fontSize: 13, color: s.conflicts === 0 ? COLORS.green : s.conflicts ? COLORS.amber : COLORS.textMuted }}>
                  {s.conflicts !== null ? s.conflicts : "—"}
                </td>
                <td style={{ padding: "14px 16px", color: COLORS.textMuted, fontSize: 12, fontFamily: "monospace" }}>{s.time}</td>
                <td style={{ padding: "14px 16px" }}>
                  {s.status === "COMPLETED" && (
                    <span style={{ fontSize: 11, color: COLORS.accent, fontFamily: "monospace", cursor: "pointer", border: `1px solid ${COLORS.accent}44`, borderRadius: 4, padding: "3px 8px" }}>Görüntüle</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

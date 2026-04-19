"use client";
import React from "react";
import { COLORS } from "@/lib/colors";
import { MOCK } from "@/lib/mockData";
import DeptDot from "@/components/ui/DeptDot";

export default function SchedulePage() {
  return (
    <div>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: COLORS.text, margin: "0 0 6px", fontFamily: "monospace" }}>Takvim Görünümü</h2>
      <p style={{ color: COLORS.textMuted, fontSize: 14, marginBottom: 24 }}>Vize Sınavları · 14–16 Nisan 2025 · En iyi çözüm (skor: 94.2)</p>
      
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
        {MOCK.schedule.map((day) => (
          <div key={day.day} style={{ background: COLORS.surface, border: `1px solid ${COLORS.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}`, background: "#0f1020" }}>
              <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: COLORS.text }}>{day.day}</span>
              <span style={{ fontFamily: "monospace", fontSize: 11, color: COLORS.textMuted, marginLeft: 10 }}>{day.slots.length} sınav</span>
            </div>
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {day.slots.map(slot => (
                <div key={slot.course} style={{ background: "#0d0e1a", border: `1px solid ${COLORS.border}`, borderRadius: 7, padding: "10px 12px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: COLORS.text }}>{slot.course}</span>
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: COLORS.cyan }}>{slot.time}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 11, color: COLORS.textMuted, display: "flex", alignItems: "center" }}>
                      <DeptDot dept={slot.dept} />{slot.dept}
                    </span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.textSub, background: COLORS.border, borderRadius: 3, padding: "2px 6px" }}>{slot.room}</span>
                      <span style={{ fontFamily: "monospace", fontSize: 10, color: COLORS.textSub, background: COLORS.border, borderRadius: 3, padding: "2px 6px" }}>{slot.students}↑</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

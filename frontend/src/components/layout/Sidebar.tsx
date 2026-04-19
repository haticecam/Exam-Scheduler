"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { COLORS } from "@/lib/colors";
import { MOCK } from "@/lib/mockData";
import Badge from "@/components/ui/Badge";

export default function Sidebar() {
  const pathname = usePathname();

  const getLinkStyle = (path: string) => ({
    display: "flex", 
    justifyContent: "space-between", 
    alignItems: "center", 
    padding: "9px 20px", 
    cursor: "pointer", 
    background: pathname === path ? COLORS.accentSoft : "transparent", 
    borderLeft: pathname === path ? `2px solid ${COLORS.accent}` : "2px solid transparent", 
    textDecoration: "none", 
    transition: "background 0.12s"
  });

  return (
    <aside style={{ 
      width: 260, background: COLORS.surface, 
      borderRight: `1px solid ${COLORS.border}`, display: "flex", 
      flexDirection: "column", flexShrink: 0, overflowY: "auto" 
    }}>
      {/* Logo */}
      <div style={{ padding: "20px 20px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.1em", marginBottom: 4 }}>FRAMEWORK</div>
        <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 16, color: COLORS.text, letterSpacing: "-0.3px" }}>ExamScheduler</div>
        <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 2 }}>Gurobi / Django / PostgreSQL</div>
      </div>

      {/* Term selector */}
      <div style={{ padding: "12px 16px", borderBottom: `1px solid ${COLORS.border}` }}>
        <div style={{ fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: 6 }}>AKTİF DÖNEM</div>
        <div style={{ background: "#0d0e1a", border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: COLORS.text, fontFamily: "monospace" }}>{MOCK.term.name}</span>
          <Badge status={MOCK.term.status} />
        </div>
      </div>

      {/* Nav */}
      <nav style={{ padding: "10px 0 20px", flex: 1 }}>
        <div style={{ padding: "12px 16px 6px", fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.1em" }}>NAVİGASYON</div>
        
        {MOCK.navSections.map(sec => (
          <div key={sec.label}>
            <div style={{ padding: "14px 20px 6px", fontSize: 10, color: COLORS.textMuted, fontFamily: "monospace", letterSpacing: "0.08em" }}>{sec.label}</div>
            {sec.items.map(item => (
              <Link 
                key={item.id} 
                href={item.id} 
                style={getLinkStyle(item.id)}
              >
                <span style={{ fontSize: 13, color: pathname === item.id ? COLORS.accent : COLORS.textSub }}>
                  {item.label}
                </span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div style={{ borderTop: `1px solid ${COLORS.border}`, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
        <Link
          href="/export"
          style={{ background: "transparent", color: COLORS.textMuted, border: `1px solid ${COLORS.border}`, borderRadius: 6, padding: "8px", cursor: "pointer", fontFamily: "monospace", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}
        >
          ↓ Dışa Aktar
        </Link>
      </div>
    </aside>
  );
}

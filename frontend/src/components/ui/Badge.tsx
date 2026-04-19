import React from "react";
import { COLORS } from "@/lib/colors";

interface BadgeProps {
  status: string;
}

export default function Badge({ status }: BadgeProps) {
  const map: Record<string, { bg: string; color: string; label: string }> = {
    COMPLETED: { bg: COLORS.greenSoft, color: COLORS.green, label: "Tamamlandı" },
    PROCESSING: { bg: COLORS.accentSoft, color: COLORS.accent, label: "İşleniyor" },
    FAILED: { bg: COLORS.redSoft, color: COLORS.red, label: "Başarısız" },
    PENDING: { bg: COLORS.amberSoft, color: COLORS.amber, label: "Bekliyor" },
    Active: { bg: COLORS.greenSoft, color: COLORS.green, label: "Aktif" },
    Planning: { bg: COLORS.accentSoft, color: COLORS.accent, label: "Planlama" },
    Archived: { bg: "#111", color: COLORS.textMuted, label: "Arşiv" },
  };
  
  const cfg = map[status] || map.PENDING;
  
  return (
    <span style={{ 
      background: cfg.bg, color: cfg.color, 
      fontSize: 11, fontFamily: "monospace", 
      padding: "3px 9px", borderRadius: 4, letterSpacing: "0.04em" 
    }}>
      {cfg.label}
    </span>
  );
}

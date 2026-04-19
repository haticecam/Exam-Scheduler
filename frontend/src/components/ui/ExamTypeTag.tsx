import React from "react";
import { COLORS } from "@/lib/colors";

interface ExamTypeTagProps {
  type: string;
}

export default function ExamTypeTag({ type }: ExamTypeTagProps) {
  const map: Record<string, { color: string; bg: string }> = {
    MIDTERM: { color: COLORS.cyan, bg: COLORS.cyanSoft },
    FINAL: { color: COLORS.purple, bg: COLORS.purpleSoft },
    MAKEUP: { color: COLORS.amber, bg: COLORS.amberSoft },
  };
  const cfg = map[type] || map.MIDTERM;
  return (
    <span style={{ 
      background: cfg.bg, color: cfg.color, 
      fontSize: 10, fontFamily: "monospace", 
      padding: "2px 8px", borderRadius: 3, letterSpacing: "0.06em", fontWeight: 600 
    }}>
      {type}
    </span>
  );
}

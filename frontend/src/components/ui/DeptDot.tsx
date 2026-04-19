import React from "react";
import { COLORS } from "@/lib/colors";

interface DeptDotProps {
  dept: string;
}

export default function DeptDot({ dept }: DeptDotProps) {
  const colors: Record<string, string> = { 
    Matematik: COLORS.accent, 
    Fizik: COLORS.cyan, 
    Bilgisayar: COLORS.green, 
    Kimya: COLORS.amber, 
    Endüstri: COLORS.purple, 
    Ekonomi: COLORS.red, 
    "Yabancı Dil": COLORS.textMuted 
  };
  
  return (
    <span style={{ 
      display: "inline-block", width: 7, height: 7, borderRadius: "50%", 
      background: colors[dept] || COLORS.textMuted, marginRight: 6 
    }} />
  );
}

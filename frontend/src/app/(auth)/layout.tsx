"use client";
import React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <div style={{
      minHeight: "100vh",
      background: "var(--surface)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    }}>
      <button
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        title={resolvedTheme === "dark" ? "Açık temaya geç" : "Koyu temaya geç"}
        style={{
          position: "fixed",
          top: 16,
          right: 20,
          background: "transparent",
          color: "var(--on-surface-variant)",
          border: "1px solid color-mix(in srgb, var(--outline-variant) 80%, transparent)",
          borderRadius: 8,
          padding: "6px 8px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          transition: "background 140ms ease-out",
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-bright)"; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
      >
        {resolvedTheme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
      </button>

      {children}
    </div>
  );
}

"use client";
import React, { useState, useRef } from "react";
import { C, mono } from "@/lib/colors";
import { api } from "@/lib/api";

export const Badge = ({ status }: { status: string }) => {
  const MAP: Record<string, any> = {
    COMPLETED: { bg: "#0d1f17", color: "#2fc97e", label: "Tamamlandı" },
    OPTIMAL: { bg: "#0d1f17", color: "#2fc97e", label: "Optimal" },
    FEASIBLE: { bg: "#0d1f17", color: "#2fc97e", label: "Çözüldü" },
    "FEASIBLE (TIME LIMIT)": { bg: "#0d1f17", color: "#2fc97e", label: "Çözüldü (Limit)" },
    PROCESSING: { bg: "#1e2147", color: "#5b6af5", label: "İşleniyor" },
    FAILED: { bg: "#1f0f0f", color: "#e05555", label: "Başarısız" },
    INFEASIBLE: { bg: "#1f0f0f", color: "#e05555", label: "Çözümsüz" },
    PENDING: { bg: "#1f1708", color: "#f0a94a", label: "Bekliyor" },
    Active: { bg: "#0d1f17", color: "#2fc97e", label: "Aktif" },
    Planning: { bg: "#1e2147", color: "#5b6af5", label: "Planlama" },
    Archived: { bg: "#111", color: "#6b6f8e", label: "Aktif Değil" },
  };
  const cfg = MAP[status] || MAP.PENDING;
  return (
    <span style={{ background: cfg.bg, color: cfg.color, fontSize: 11, ...mono, padding: "3px 9px", borderRadius: 4, letterSpacing: "0.04em", whiteSpace: "nowrap" }}>
      {cfg.label}
    </span>
  );
};

export const Spinner = ({ size = 16, color = "#5b6af5" }) => (
  <span style={{ display: "inline-block", width: size, height: size, border: `2px solid ${color}33`, borderTop: `2px solid ${color}`, borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
);

export const ErrorBox = ({ msg }: { msg: string }) => (
  <div style={{ background: "#1f0f0f", border: "1px solid #e0555544", borderRadius: 8, padding: "12px 16px", color: "#e05555", fontSize: 13, ...mono }}>
    ✕  {msg}
  </div>
);

export const InfoBox = ({ msg, color = "#22d4c8" }: { msg: string; color?: string }) => (
  <div style={{ background: `${color}11`, border: `1px solid ${color}44`, borderRadius: 8, padding: "12px 16px", color, fontSize: 13, ...mono }}>
    ℹ  {msg}
  </div>
);

export const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, ...style }}>
    {children}
  </div>
);

export const SL = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.1em", marginBottom: 14 }}>{children}</div>
);

// --- NEW CLEANUP COMPONENTS ---

export const PageContainer = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ padding: "32px 40px", maxWidth: 1400, margin: "0 auto", ...style }}>
    {children}
  </div>
);

export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32 }}>
    <div>
      <SL>{subtitle}</SL>
      <h1 style={{ fontSize: 32, fontWeight: 800, color: C.text, margin: 0, letterSpacing: "-0.02em" }}>{title}</h1>
    </div>
    {actions && <div style={{ display: "flex", gap: 12 }}>{actions}</div>}
  </div>
);

export const DataTable = ({ headers, children }: { headers: string[]; children: React.ReactNode }) => (
  <Card style={{ overflow: "hidden" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{ background: "#11142d55", borderBottom: `1px solid ${C.border}` }}>
          {headers.map((h, i) => (
            <th key={i} style={{ padding: "14px 20px", textAlign: "left", fontSize: 11, color: C.accent, fontWeight: 700, ...mono, letterSpacing: "0.05em" }}>
              {h.toUpperCase()}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </Card>
);

export const DataRow = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <tr style={{ borderBottom: `1px solid ${C.border}`, ...style }}>
    {children}
  </tr>
);

export const DataCell = ({ children, style = {}, colSpan }: { children: React.ReactNode; style?: React.CSSProperties; colSpan?: number }) => (
  <td colSpan={colSpan} style={{ padding: "16px 20px", color: C.text, fontSize: 14, ...style }}>
    {children}
  </td>
);

export const ActionButton = ({ onClick, children, variant = "primary", disabled = false, icon }: { onClick?: () => void; children: React.ReactNode; variant?: "primary" | "secondary" | "danger"; disabled?: boolean; icon?: string }) => {
  const styles: Record<string, any> = {
    primary: { bg: C.accent, color: "#fff", border: "none" },
    secondary: { bg: "transparent", color: C.text, border: `1px solid ${C.border}` },
    danger: { bg: "#1f0f0f", color: "#e05555", border: "1px solid #e0555544" }
  };
  const s = styles[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? C.accentSoft : s.bg,
        color: disabled ? C.textMuted : s.color,
        border: s.border,
        borderRadius: 8,
        padding: "10px 18px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        gap: 8,
        ...mono,
        transition: "all 0.2s"
      }}
    >
      {icon && <span>{icon}</span>}
      {children}
    </button>
  );
};

export function CSVUploader({ title, endpoint, templateCols, onSuccess, extraData }: { 
  title: string; 
  endpoint: string; 
  templateCols: string[]; 
  onSuccess?: () => void;
  extraData?: Record<string, string>;
}) {
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [st, setSt] = useState("idle");
  const [result, setResult] = useState<any>(null);
  const [errMsg, setErrMsg] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    if (!f) return;
    if (!f.name.match(/\.(csv|xlsx)$/i)) { setErrMsg("Sadece .csv veya .xlsx dosyası kabul edilir."); setSt("error"); return; }
    setFile(f); setSt("idle"); setErrMsg("");
  };

  const upload = async () => {
    if (!file) return;
    setSt("uploading");
    const fd = new FormData(); fd.append("file", file);
    if (extraData) {
      for (const [k, v] of Object.entries(extraData)) fd.append(k, v);
    }
    try {
      const res = await api.upload(endpoint, fd);
      setResult(res); setSt("success"); onSuccess?.();
    } catch (e: any) { setErrMsg(e.data?.detail || e.data?.error || e.message); setSt("error"); }
  };

  const reset = () => { setFile(null); setSt("idle"); setResult(null); setErrMsg(""); };

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, ...mono, marginBottom: 16 }}>{title}</div>

      <div style={{ background: "#1e214711", border: "1px solid #5b6af533", borderRadius: 8, padding: "10px 14px", marginBottom: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 10, color: C.accent, ...mono }}>BEKLENEN SÜTUNLAR</span>
        {templateCols.map(c => (
          <span key={c} style={{ fontSize: 10, color: C.textSub, background: "#0d0e1a", border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 7px", ...mono }}>{c}</span>
        ))}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] || null); }}
        onClick={() => ref.current?.click()}
        style={{ border: `2px dashed ${drag ? C.accent : C.border}`, borderRadius: 12, padding: "44px 24px", textAlign: "center", cursor: "pointer", background: "#0d0e1a", transition: "border-color 0.2s, background 0.2s", position: "relative" }}
      >
        <input ref={ref} type="file" accept=".csv,.xlsx" style={{ display: "none" }} onChange={e => pick(e.target.files?.[0] || null)} />
        {file && <div style={{ color: C.cyan, ...mono, fontSize: 14, fontWeight: 600 }}>{file.name} <span style={{ color: C.textMuted, fontWeight: 400 }}>({(file.size / 1024).toFixed(1)} KB)</span></div>}
        {!file && (
          <>
            <div style={{ fontSize: 28, marginBottom: 10, color: C.textMuted }}>↑</div>
            <div style={{ color: C.text, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Dosyayı sürükleyip bırakın veya tıklayın</div>
            <div style={{ color: C.textMuted, fontSize: 12 }}>CSV veya XLSX · Maks 50 MB</div>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button
          disabled={!file || st === "uploading"} onClick={upload}
          style={{ background: file && st !== "uploading" ? C.accent : C.accentSoft, color: file ? "#fff" : C.textMuted, border: "none", borderRadius: 8, padding: "10px 22px", cursor: file ? "pointer" : "not-allowed", ...mono, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}
        >
          {st === "uploading" ? <><Spinner size={13} color="#fff" /> Yükleniyor…</> : "↑  Yükle"}
        </button>
        {(file || st !== "idle") && (
          <button onClick={reset} style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", cursor: "pointer", ...mono, fontSize: 13 }}>Temizle</button>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        {st === "error" && <ErrorBox msg={errMsg} />}
        {st === "success" && (
          <div style={{ background: C.greenSoft, border: "1px solid #2fc97e44", borderRadius: 8, padding: "14px 16px" }}>
            <div style={{ color: C.green, ...mono, fontSize: 13, fontWeight: 700, marginBottom: 8 }}>✓  Yükleme başarılı</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {result && Object.entries(result).map(([k, v]) => (
                <div key={k} style={{ fontSize: 12 }}>
                  <span style={{ color: C.textMuted, ...mono }}>{k}: </span>
                  <span style={{ color: C.green, fontWeight: 700 }}>{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

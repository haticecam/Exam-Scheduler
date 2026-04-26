"use client";
import React, { useState, useRef } from "react";
import { api } from "@/lib/api";

/* ── Badge ────────────────────────────────────────────────────────────────── */
export const Badge = ({ status }: { status: string }) => {
  const MAP: Record<string, { bg: string; color: string; label: string }> = {
    COMPLETED:              { bg: "color-mix(in srgb, var(--status-success) 12%, transparent)",  color: "var(--status-success)",  label: "Tamamlandı" },
    OPTIMAL:                { bg: "color-mix(in srgb, var(--status-success) 12%, transparent)",  color: "var(--status-success)",  label: "Optimal" },
    FEASIBLE:               { bg: "color-mix(in srgb, var(--status-success) 12%, transparent)",  color: "var(--status-success)",  label: "Çözüldü" },
    "FEASIBLE (TIME LIMIT)":{ bg: "color-mix(in srgb, var(--status-success) 12%, transparent)",  color: "var(--status-success)",  label: "Çözüldü (Limit)" },
    "FEASIBLE_TIME_LIMIT":  { bg: "color-mix(in srgb, var(--status-success) 12%, transparent)",  color: "var(--status-success)",  label: "Çözüldü (Limit)" },
    PROCESSING:             { bg: "color-mix(in srgb, var(--primary) 12%, transparent)",          color: "var(--primary)",         label: "İşleniyor" },
    FAILED:                 { bg: "color-mix(in srgb, var(--status-danger) 12%, transparent)",    color: "var(--status-danger)",   label: "Başarısız" },
    INFEASIBLE:             { bg: "color-mix(in srgb, var(--status-danger) 12%, transparent)",    color: "var(--status-danger)",   label: "Çözümsüz" },
    PENDING:                { bg: "color-mix(in srgb, var(--status-warning) 12%, transparent)",   color: "var(--status-warning)",  label: "Bekliyor" },
    Active:                 { bg: "color-mix(in srgb, var(--status-success) 12%, transparent)",  color: "var(--status-success)",  label: "Aktif" },
    Planning:               { bg: "color-mix(in srgb, var(--status-planning) 12%, transparent)", color: "var(--status-planning)", label: "Planlama" },
    Archived:               { bg: "color-mix(in srgb, var(--on-surface-variant) 12%, transparent)", color: "var(--on-surface-variant)", label: "Aktif Değil" },
  };
  const cfg = MAP[status] ?? MAP.PENDING;
  return (
    <span style={{
      background: cfg.bg,
      color: cfg.color,
      fontSize: "0.6875rem",
      fontWeight: 600,
      padding: "3px 9px",
      borderRadius: 8,
      letterSpacing: "0.04em",
      whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
};

/* ── Spinner ──────────────────────────────────────────────────────────────── */
export const Spinner = ({ size = 16 }: { size?: number; color?: string }) => (
  <span style={{
    display: "inline-block",
    width: size,
    height: size,
    border: "2px solid color-mix(in srgb, var(--primary) 25%, transparent)",
    borderTop: "2px solid var(--primary)",
    borderRadius: "50%",
    animation: "spin 0.7s linear infinite",
  }} />
);

/* ── ErrorBox / InfoBox ───────────────────────────────────────────────────── */
export const ErrorBox = ({ msg }: { msg: string }) => (
  <div style={{
    background: "color-mix(in srgb, var(--status-danger) 10%, transparent)",
    border: "1px solid color-mix(in srgb, var(--status-danger) 40%, transparent)",
    borderRadius: 8,
    padding: "12px 16px",
    color: "var(--status-danger)",
    fontSize: "0.875rem",
  }}>
    ✕  {msg}
  </div>
);

export const InfoBox = ({ msg, color = "var(--status-info)" }: { msg: string; color?: string }) => (
  <div style={{
    background: `color-mix(in srgb, ${color} 10%, transparent)`,
    border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
    borderRadius: 8,
    padding: "12px 16px",
    color,
    fontSize: "0.875rem",
  }}>
    ℹ  {msg}
  </div>
);

/* ── Card ─────────────────────────────────────────────────────────────────── */
export const Card = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{
    background: "var(--surface-container)",
    border: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
    borderRadius: 12,
    ...style,
  }}>
    {children}
  </div>
);

/* ── SL — section label ───────────────────────────────────────────────────── */
export const SL = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{
    fontSize: "0.6875rem",
    fontWeight: 600,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "var(--on-surface-variant)",
    marginBottom: 14,
    ...style,
  }}>
    {children}
  </div>
);

/* ── PageContainer ────────────────────────────────────────────────────────── */
export const PageContainer = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div style={{ padding: "32px 40px", maxWidth: 1400, margin: "0 auto", ...style }}>
    {children}
  </div>
);

/* ── PageHeader ───────────────────────────────────────────────────────────── */
export const PageHeader = ({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 32 }}>
    <div>
      {subtitle && (
        <p style={{ fontSize: "0.875rem", color: "var(--on-surface-variant)", margin: "0 0 6px" }}>
          {subtitle}
        </p>
      )}
      <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "var(--on-surface)", margin: 0, letterSpacing: "-0.04em" }}>
        {title}
      </h1>
    </div>
    {actions && <div style={{ display: "flex", gap: 12 }}>{actions}</div>}
  </div>
);

/* ── DataTable ────────────────────────────────────────────────────────────── */
export const DataTable = ({ headers, children }: { headers: string[]; children: React.ReactNode }) => (
  <Card style={{ overflow: "hidden" }}>
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr style={{
          background: "var(--surface-container-low)",
          borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
        }}>
          {headers.map((h, i) => (
            <th key={i} style={{
              padding: "12px 20px",
              textAlign: "left",
              fontSize: "0.6875rem",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--on-surface-variant)",
            }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  </Card>
);

/* ── DataRow ──────────────────────────────────────────────────────────────── */
export const DataRow = ({ children, style = {} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <tr
    style={{
      borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent)",
      transition: "background 140ms ease-out",
      ...style,
    }}
    onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--surface-container-high)"; }}
    onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
  >
    {children}
  </tr>
);

/* ── DataCell ─────────────────────────────────────────────────────────────── */
export const DataCell = ({ children, style = {}, colSpan }: { children: React.ReactNode; style?: React.CSSProperties; colSpan?: number }) => (
  <td colSpan={colSpan} style={{
    padding: "14px 20px",
    color: "var(--on-surface)",
    fontSize: "0.875rem",
    ...style,
  }}>
    {children}
  </td>
);

/* ── ActionButton ─────────────────────────────────────────────────────────── */
export const ActionButton = ({
  onClick,
  children,
  variant = "primary",
  disabled = false,
  icon,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  icon?: string;
}) => {
  const styles: Record<string, React.CSSProperties> = {
    primary:   { background: "var(--primary)",   color: "var(--primary-foreground)", border: "none" },
    secondary: { background: "transparent",      color: "var(--on-surface)",         border: "1px solid color-mix(in srgb, var(--outline-variant) 80%, transparent)" },
    danger:    { background: "color-mix(in srgb, var(--status-danger) 12%, transparent)", color: "var(--status-danger)", border: "1px solid color-mix(in srgb, var(--status-danger) 40%, transparent)" },
  };
  const s = styles[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...s,
        opacity: disabled ? 0.45 : 1,
        borderRadius: 8,
        padding: "8px 16px",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: "0.8125rem",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        transition: "all 140ms ease-out",
        outline: "none",
      }}
    >
      {icon && <span>{icon}</span>}
      {children}
    </button>
  );
};

/* ── CSVUploader ──────────────────────────────────────────────────────────── */
export function CSVUploader({
  title,
  endpoint,
  templateCols,
  onSuccess,
  extraData,
}: {
  title: string;
  endpoint: string;
  templateCols: string[];
  onSuccess?: () => void;
  extraData?: Record<string, string>;
}) {
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [st, setSt] = useState("idle");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    if (!f) return;
    if (!f.name.match(/\.(csv|xlsx)$/i)) {
      setErrMsg("Sadece .csv veya .xlsx dosyası kabul edilir.");
      setSt("error");
      return;
    }
    setFile(f); setSt("idle"); setErrMsg("");
  };

  const upload = async () => {
    if (!file) return;
    setSt("uploading");
    const fd = new FormData();
    fd.append("file", file);
    if (extraData) {
      for (const [k, v] of Object.entries(extraData)) fd.append(k, v);
    }
    try {
      const res = await api.upload(endpoint, fd);
      setResult(res as Record<string, unknown>);
      setSt("success");
      onSuccess?.();
    } catch (e: unknown) {
      const err = e as { data?: { detail?: string; error?: string }; message?: string };
      setErrMsg(err.data?.detail ?? err.data?.error ?? err.message ?? "Yükleme başarısız.");
      setSt("error");
    }
  };

  const reset = () => { setFile(null); setSt("idle"); setResult(null); setErrMsg(""); };

  return (
    <div>
      <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--on-surface)", marginBottom: 16 }}>
        {title}
      </div>

      <div style={{
        background: "color-mix(in srgb, var(--primary) 6%, transparent)",
        border: "1px solid color-mix(in srgb, var(--primary) 20%, transparent)",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 14,
        display: "flex",
        gap: 10,
        alignItems: "center",
        flexWrap: "wrap",
      }}>
        <span style={{ fontSize: "0.6875rem", color: "var(--primary)", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Beklenen Sütunlar</span>
        {templateCols.map(c => (
          <span key={c} style={{
            fontSize: "0.6875rem",
            color: "var(--on-surface-variant)",
            background: "var(--surface-container-high)",
            border: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
            borderRadius: 4,
            padding: "2px 7px",
          }}>{c}</span>
        ))}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0] ?? null); }}
        onClick={() => ref.current?.click()}
        style={{
          border: `2px dashed ${drag ? "var(--primary)" : "color-mix(in srgb, var(--outline-variant) 60%, transparent)"}`,
          borderRadius: 12,
          padding: "40px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: "var(--surface-container)",
          transition: "border-color 140ms ease-out",
        }}
      >
        <input ref={ref} type="file" accept=".csv,.xlsx" style={{ display: "none" }} onChange={e => pick(e.target.files?.[0] ?? null)} />
        {file
          ? (
            <div style={{ color: "var(--primary)", fontSize: "0.875rem", fontWeight: 600 }}>
              {file.name}{" "}
              <span style={{ color: "var(--on-surface-variant)", fontWeight: 400 }}>({(file.size / 1024).toFixed(1)} KB)</span>
            </div>
          )
          : (
            <>
              <div style={{ fontSize: 28, marginBottom: 10, color: "var(--on-surface-variant)" }}>↑</div>
              <div style={{ color: "var(--on-surface)", fontSize: "0.875rem", fontWeight: 600, marginBottom: 4 }}>Dosyayı sürükleyip bırakın veya tıklayın</div>
              <div style={{ color: "var(--on-surface-variant)", fontSize: "0.75rem" }}>CSV veya XLSX · Maks 50 MB</div>
            </>
          )
        }
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <ActionButton disabled={!file || st === "uploading"} onClick={upload} variant="primary">
          {st === "uploading" ? <><Spinner size={13} /> Yükleniyor…</> : "↑  Yükle"}
        </ActionButton>
        {(file || st !== "idle") && (
          <ActionButton onClick={reset} variant="secondary">Temizle</ActionButton>
        )}
      </div>

      <div style={{ marginTop: 14 }}>
        {st === "error" && <ErrorBox msg={errMsg} />}
        {st === "success" && (
          <div style={{
            background: "color-mix(in srgb, var(--status-success) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--status-success) 30%, transparent)",
            borderRadius: 8,
            padding: "14px 16px",
          }}>
            <div style={{ color: "var(--status-success)", fontSize: "0.8125rem", fontWeight: 700, marginBottom: 8 }}>✓  Yükleme başarılı</div>
            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {result && Object.entries(result).map(([k, v]) => (
                <div key={k} style={{ fontSize: "0.75rem" }}>
                  <span style={{ color: "var(--on-surface-variant)" }}>{k}: </span>
                  <span style={{ color: "var(--status-success)", fontWeight: 700 }}>{String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

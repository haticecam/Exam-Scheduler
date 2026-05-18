"use client";
import React, { useState, useRef, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import { useFetch, api } from "@/lib/api";
import { Badge, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useTermVersion } from "@/lib/term-context";

const NAV = [
  {
    label: "1 — VERİ GİRİŞİ",
    items: [
      { id: "/terms",         label: "Dönem Yönetimi" },
      { id: "/courses",       label: "Ders Kataloğu" },
      { id: "/students",      label: "Öğrenci & Kayıt" },
      { id: "/rooms",         label: "Oda Yönetimi" },
      { id: "/exam-calendar", label: "Sınav Takvimi" },
    ],
  },
  {
    label: "2 — OPTİMİZASYON",
    items: [
      { id: "/optimizer", label: "Çalıştır" },
      { id: "/solutions", label: "Çözümler" },
    ],
  },
  {
    label: "3 — SONUÇ",
    items: [
      { id: "/schedule", label: "Takvim Görünümü" },
    ],
  },
];

interface NavItemProps {
  id: string;
  label: string;
  active: string;
}

const NavItem = ({ id, label, active }: NavItemProps) => {
  const isActive = active === id;
  return (
    <Link
      href={id}
      style={{
        display: "block",
        textDecoration: "none",
        padding: "7px 20px",
        cursor: "pointer",
        borderLeft: isActive
          ? "2px solid var(--primary)"
          : "2px solid transparent",
        transition: "background 140ms ease-out, border-color 140ms ease-out",
      }}
      onMouseEnter={e => {
        if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = "var(--surface-bright)";
      }}
      onMouseLeave={e => {
        if (!isActive) (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
      }}
    >
      <span style={{
        fontSize: "0.8125rem",
        color: isActive ? "var(--primary)" : "var(--on-surface-variant)",
        fontWeight: isActive ? 600 : 400,
        transition: "color 140ms ease-out",
      }}>
        {label}
      </span>
    </Link>
  );
};

/* ── Term switcher ───────────────────────────────────────────────────────── */
function TermSwitcher() {
  const { data, refetch } = useFetch("/terms/");
  const terms: any[] = data?.results ?? data ?? [];
  const activeTerm = terms.find((t: any) => t.status === "Active") ?? terms[0];
  const { bumpTermVersion } = useTermVersion();

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const activate = async (term: any) => {
    if (term.status === "Active" || switching) return;
    setSwitching(term.id);
    setOpen(false);
    try {
      await api.patch(`/terms/${term.id}/`, { status: "Active" });
      refetch();
      bumpTermVersion();
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)", position: "relative" }} ref={ref}>
      <div style={{
        fontSize: "0.6875rem",
        fontWeight: 600,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color: "var(--on-surface-variant)",
        marginBottom: 6,
      }}>
        Aktif Dönem
      </div>

      {/* Trigger */}
      <button
        onClick={() => terms.length > 1 && setOpen(o => !o)}
        style={{
          width: "100%",
          background: open
            ? "var(--surface-container-high)"
            : "var(--surface-container)",
          border: `1px solid ${open ? "color-mix(in srgb, var(--primary) 50%, transparent)" : "color-mix(in srgb, var(--outline-variant) 60%, transparent)"}`,
          borderRadius: 8,
          padding: "8px 10px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: terms.length > 1 ? "pointer" : "default",
          transition: "all 140ms ease-out",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {switching ? (
            <Spinner size={13} />
          ) : (
            activeTerm && <Badge status={activeTerm.status} />
          )}
          <span style={{
            fontSize: "0.75rem",
            color: "var(--on-surface)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {switching
              ? "Geçiliyor…"
              : activeTerm?.name ?? "Dönem yok"}
          </span>
        </div>
        {terms.length > 1 && (
          <ChevronDown
            size={14}
            style={{
              color: "var(--on-surface-variant)",
              flexShrink: 0,
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 140ms ease-out",
            }}
          />
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% - 4px)",
          left: 16,
          right: 16,
          background: "var(--surface-container)",
          border: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
          zIndex: 50,
          overflow: "hidden",
        }}>
          {terms.map((t: any) => {
            const isActive = t.status === "Active";
            return (
              <button
                key={t.id}
                onClick={() => activate(t)}
                style={{
                  width: "100%",
                  background: isActive ? "color-mix(in srgb, var(--primary) 8%, transparent)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 40%, transparent)",
                  padding: "10px 12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  cursor: isActive ? "default" : "pointer",
                  textAlign: "left",
                  transition: "background 100ms ease-out",
                }}
                onMouseEnter={e => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-container-high)";
                }}
                onMouseLeave={e => {
                  if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: "0.8125rem",
                    fontWeight: isActive ? 600 : 400,
                    color: isActive ? "var(--primary)" : "var(--on-surface)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {t.name}
                  </div>
                  {t.date_range && (
                    <div style={{ fontSize: "0.6875rem", color: "var(--on-surface-variant)", marginTop: 2 }}>
                      {t.date_range}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <Badge status={t.status} />
                  {isActive && <Check size={13} style={{ color: "var(--primary)" }} />}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────────────── */
export default function Sidebar() {
  const pathname = usePathname();
  const { username, logout } = useAuth();

  return (
    <div style={{
      width: 262,
      background: "var(--surface-container-low)",
      display: "flex",
      flexDirection: "column",
      flexShrink: 0,
      overflowY: "auto",
    }}>
      {/* Logo */}
      <div style={{
        padding: "16px 20px",
        borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        <Image src="/aybu-logo.png" alt="AYBU Logo" width={36} height={36} style={{ flexShrink: 0 }} />
        <div style={{
          fontWeight: 700,
          fontSize: "1rem",
          color: "var(--on-surface)",
          letterSpacing: "-0.02em",
          lineHeight: 1.2,
        }}>
          Exam Scheduler
        </div>
      </div>

      {/* Term switcher */}
      <TermSwitcher />

      {/* Navigation */}
      <div style={{ padding: "10px 0 20px", flex: 1 }}>
        <div style={{
          padding: "12px 16px 6px",
          fontSize: "0.6875rem",
          fontWeight: 600,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--on-surface-variant)",
        }}>
          Navigasyon
        </div>
        <NavItem id="/" label="Genel Bakış" active={pathname} />

        {NAV.map(sec => (
          <div key={sec.label}>
            <div style={{
              padding: "14px 20px 6px",
              fontSize: "0.6875rem",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--on-surface-variant)",
            }}>
              {sec.label}
            </div>
            {sec.items.map(item => (
              <NavItem key={item.id} id={item.id} label={item.label} active={pathname} />
            ))}
          </div>
        ))}
      </div>

      {/* User footer */}
      <div style={{
        padding: "16px 20px",
        borderTop: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
      }}>
        {username && (
          <div style={{
            fontSize: "0.6875rem",
            color: "var(--on-surface-variant)",
            marginBottom: 10,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {username}
          </div>
        )}
        <button
          onClick={logout}
          style={{
            width: "100%",
            background: "transparent",
            color: "var(--on-surface-variant)",
            border: "1px solid color-mix(in srgb, var(--outline-variant) 80%, transparent)",
            borderRadius: 8,
            padding: "7px 12px",
            cursor: "pointer",
            fontSize: "0.75rem",
            textAlign: "left",
            transition: "background 140ms ease-out",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-bright)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
        >
          Çıkış Yap
        </button>
      </div>
    </div>
  );
}

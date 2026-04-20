"use client";
import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFetch } from "@/lib/api";
import { Badge } from "@/components/ui";
import { useAuth } from "@/lib/auth";

const NAV = [
  {
    label: "1 — VERİ GİRİŞİ",
    items: [
      { id: "/terms",    label: "Dönem Yönetimi" },
      { id: "/courses",  label: "Ders Kataloğu" },
      { id: "/students", label: "Öğrenci & Kayıt" },
      { id: "/rooms",    label: "Oda Yönetimi" },
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

export default function Sidebar() {
  const pathname = usePathname();
  const { data: termData } = useFetch("/terms/?status=Active");
  const activeTerm = termData?.results?.[0] ?? termData?.[0];
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

      {/* Active term */}
      <div style={{
        padding: "12px 16px",
        borderBottom: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
      }}>
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
        <div style={{
          background: "var(--surface-container)",
          border: "1px solid color-mix(in srgb, var(--outline-variant) 60%, transparent)",
          borderRadius: 8,
          padding: "8px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <span style={{ fontSize: "0.75rem", color: "var(--on-surface)" }}>
            {activeTerm?.name ?? "Yükleniyor…"}
          </span>
          {activeTerm && <Badge status={activeTerm.status} />}
        </div>
      </div>

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

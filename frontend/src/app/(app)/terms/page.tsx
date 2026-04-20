"use client";
import React, { useState } from "react";
import { format } from "date-fns";
import { tr } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, Badge, Spinner, PageContainer, PageHeader, ActionButton } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/* ── Date range → API string ─────────────────────────────────────────────── */
function rangeToString(range: DateRange | undefined): string {
  if (!range?.from) return "";
  if (!range.to) return format(range.from, "yyyy-MM-dd");
  return `${format(range.from, "yyyy-MM-dd")} / ${format(range.to, "yyyy-MM-dd")}`;
}

function stringToRange(s: string | null | undefined): DateRange | undefined {
  if (!s) return undefined;
  const parts = s.split(" / ");
  const from = parts[0] ? new Date(parts[0]) : undefined;
  const to = parts[1] ? new Date(parts[1]) : undefined;
  if (!from || isNaN(from.getTime())) return undefined;
  return { from, to: to && !isNaN(to.getTime()) ? to : undefined };
}

function formatRangeDisplay(s: string | null | undefined): string {
  const range = stringToRange(s);
  if (!range?.from) return "—";
  const from = format(range.from, "d MMM yyyy", { locale: tr });
  if (!range.to) return from;
  return `${from} – ${format(range.to, "d MMM yyyy", { locale: tr })}`;
}

/* ── Date range picker ───────────────────────────────────────────────────── */
function DateRangePicker({
  value,
  onChange,
}: {
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
}) {
  const [open, setOpen] = useState(false);

  const label = value?.from
    ? value.to
      ? `${format(value.from, "d MMM yyyy", { locale: tr })} – ${format(value.to, "d MMM yyyy", { locale: tr })}`
      : format(value.from, "d MMM yyyy", { locale: tr })
    : "Tarih aralığı seçin";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !value?.from && "text-muted-foreground"
        )}
      >
        <CalendarIcon className="size-4 shrink-0 opacity-60" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          onSelect={r => { onChange(r); if (r?.from && r?.to) setOpen(false); }}
          numberOfMonths={2}
          captionLayout="dropdown"
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */
export default function TermsPage() {
  const { data, error, loading: isLoading, refetch: mutate } = useFetch("/terms/");
  const terms = data?.results || data || [];

  // Add dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRange, setAddRange] = useState<DateRange | undefined>(undefined);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit dialog
  const [editTerm, setEditTerm] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editRange, setEditRange] = useState<DateRange | undefined>(undefined);
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete / Activate confirms
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [activateTarget, setActivateTarget] = useState<any>(null);
  const [activateLoading, setActivateLoading] = useState(false);

  const handleAdd = async () => {
    if (!addName.trim()) return;
    setAddLoading(true);
    setAddError("");
    try {
      const orgs = await api.get("/organizations/");
      const orgList = orgs?.results || orgs || [];
      let org_id;
      if (orgList.length === 0) {
        const newOrg = await api.post("/organizations/", { name: "Varsayılan Üniversite" });
        org_id = newOrg.id;
      } else {
        org_id = orgList[0].id;
      }
      await api.post("/terms/", {
        name: addName.trim(),
        status: "Active",
        organization: org_id,
        date_range: rangeToString(addRange) || null,
      });
      mutate();
      setAddOpen(false);
      setAddName("");
      setAddRange(undefined);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setAddError(e.message || "Dönem eklenemedi.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editName.trim() || !editTerm) return;
    setEditLoading(true);
    setEditError("");
    try {
      await api.patch(`/terms/${editTerm.id}/`, {
        name: editName.trim(),
        date_range: rangeToString(editRange) || null,
      });
      mutate();
      setEditTerm(null);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setEditError(e.message || "Dönem güncellenemedi.");
    } finally {
      setEditLoading(false);
    }
  };

  const handleActivate = async () => {
    if (!activateTarget) return;
    setActivateLoading(true);
    try {
      await api.patch(`/terms/${activateTarget.id}/`, { status: "Active" });
      mutate();
      setActivateTarget(null);
    } catch {
      setActivateTarget(null);
    } finally {
      setActivateLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/terms/${deleteTarget.id}/`);
      mutate();
      setDeleteTarget(null);
    } catch {
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const openEdit = (t: any) => {
    setEditTerm(t);
    setEditName(t.name);
    setEditRange(stringToRange(t.date_range));
    setEditError("");
  };

  if (isLoading) return <PageContainer><Spinner /></PageContainer>;
  if (error) return <PageContainer>Hata: {error}</PageContainer>;

  return (
    <PageContainer>
      <PageHeader
        title="Dönem Yönetimi"
        subtitle="Akademik dönemleri görüntüleyin ve yönetin."
        actions={
          <ActionButton
            onClick={() => { setAddName(""); setAddRange(undefined); setAddError(""); setAddOpen(true); }}
            icon="+"
          >
            YENİ DÖNEM EKLE
          </ActionButton>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
        {terms.length === 0 ? (
          <div style={{ color: C.textMuted, ...mono }}>Sistemde kayıtlı dönem bulunamadı.</div>
        ) : (
          terms.map((t: any) => (
            <Card key={t.id} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{t.name}</div>
                <Badge status={t.status} />
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.textMuted, fontSize: 13 }}>
                <CalendarIcon size={13} style={{ opacity: 0.5, flexShrink: 0 }} />
                <span style={{ ...mono }}>{formatRangeDisplay(t.date_range)}</span>
              </div>

              <div style={{ marginTop: 4, paddingTop: 14, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <ActionButton variant="secondary" onClick={() => openEdit(t)}>
                  Düzenle
                </ActionButton>
                {t.status !== "Active" && (
                  <ActionButton variant="secondary" onClick={() => setActivateTarget(t)}>
                    Aktif Yap
                  </ActionButton>
                )}
                <ActionButton variant="danger" onClick={() => setDeleteTarget(t)}>
                  Sil
                </ActionButton>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Add dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yeni Dönem Ekle</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-term-name">Dönem Adı</Label>
              <Input
                id="add-term-name"
                placeholder="Örn: 2024-2025 Güz"
                value={addName}
                onChange={e => setAddName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tarih Aralığı</Label>
              <DateRangePicker value={addRange} onChange={setAddRange} />
            </div>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={addLoading}>İptal</Button>
            <Button onClick={handleAdd} disabled={addLoading || !addName.trim()}>
              {addLoading ? "Ekleniyor…" : "Ekle"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTerm} onOpenChange={open => { if (!open) setEditTerm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dönemi Düzenle</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-term-name">Dönem Adı</Label>
              <Input
                id="edit-term-name"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleEdit()}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tarih Aralığı</Label>
              <DateRangePicker value={editRange} onChange={setEditRange} />
            </div>
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTerm(null)} disabled={editLoading}>İptal</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editName.trim()}>
              {editLoading ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Activate confirm */}
      <ConfirmDialog
        open={!!activateTarget}
        onOpenChange={open => { if (!open) setActivateTarget(null); }}
        title="Dönemi Aktif Yap"
        description={`"${activateTarget?.name}" dönemi aktif yapılacak. Diğer dönemler Planlama moduna alınacak.`}
        confirmLabel="Aktif Yap"
        variant="default"
        onConfirm={handleActivate}
        loading={activateLoading}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Dönemi Sil"
        description={`"${deleteTarget?.name}" dönemi kalıcı olarak silinecek. Bu işlem geri alınamaz.`}
        confirmLabel="Sil"
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </PageContainer>
  );
}

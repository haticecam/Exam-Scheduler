"use client";
import React, { useState, useEffect } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, Spinner, InfoBox, PageContainer, PageHeader, DataTable, DataRow, DataCell, ActionButton } from "@/components/ui";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROOM_TYPES = [
  { value: "CLASSROOM", label: "Derslik" },
  { value: "LAB", label: "Laboratuvar" },
  { value: "AMPHITHEATER", label: "Amfi" },
];

function defaultExamCapacity(type: string, capacity: string): string {
  const cap = parseInt(capacity);
  if (isNaN(cap) || cap <= 0) return "";
  if (type === "CLASSROOM") return String(Math.floor(cap / 2));
  if (type === "AMPHITHEATER") return String(Math.floor(cap / 3));
  return "";
}

const DAYS = [
  { key: "Mon", label: "Pzt" },
  { key: "Tue", label: "Sal" },
  { key: "Wed", label: "Çar" },
  { key: "Thu", label: "Per" },
  { key: "Fri", label: "Cum" },
  { key: "Sat", label: "Cmt" },
  { key: "Sun", label: "Paz" },
];

function toggleItem(key: string, current: string[]): string[] {
  return current.includes(key) ? current.filter(d => d !== key) : [...current, key];
}

export default function RoomsPage() {
  const { data, loading, refetch } = useFetch("/resources/");
  const rooms = data?.results || data || [];

  // Academic units for availability selector
  const { data: unitsData } = useFetch("/academic-units/");
  const academicUnits: { id: string; name: string }[] = unitsData?.results || unitsData || [];

  // Add form
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [type, setType] = useState("CLASSROOM");
  const [examCapacity, setExamCapacity] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Availability state — create form
  const [allowedDays, setAllowedDays] = useState<string[]>([]);
  const [allowedUnitIds, setAllowedUnitIds] = useState<string[]>([]);

  // Auto-calculate examCapacity when type or capacity changes in create form
  useEffect(() => {
    setExamCapacity(defaultExamCapacity(type, capacity));
  }, [type, capacity]);

  // Edit dialog
  const [editRoom, setEditRoom] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [editType, setEditType] = useState("CLASSROOM");
  const [editExamCapacity, setEditExamCapacity] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");
  const [editAllowedDays, setEditAllowedDays] = useState<string[]>([]);
  const [editAllowedUnitIds, setEditAllowedUnitIds] = useState<string[]>([]);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !capacity) return;
    setSaving(true);
    setSaveError("");
    try {
      const orgData = await api.get("/organizations/");
      const orgId = orgData?.[0]?.id || orgData?.results?.[0]?.id;
      const payload: Record<string, unknown> = {
        name,
        capacity: parseInt(capacity),
        type,
        organization: orgId,
        availability: {
          allowed_days: allowedDays.length > 0 ? allowedDays : null,
          allowed_unit_ids: allowedUnitIds.length > 0 ? allowedUnitIds : null,
        },
      };
      if (examCapacity !== "") payload.exam_capacity = parseInt(examCapacity);
      await api.post("/resources/", payload);
      setName("");
      setCapacity("");
      setExamCapacity("");
      setAllowedDays([]);
      setAllowedUnitIds([]);
      refetch();
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : "Oda eklenemedi.");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (room: any) => {
    setEditRoom(room);
    setEditName(room.name);
    setEditCapacity(String(room.capacity ?? ""));
    setEditType(room.type);
    setEditExamCapacity(room.exam_capacity != null ? String(room.exam_capacity) : "");
    setEditAllowedDays(room.availability?.allowed_days ?? []);
    setEditAllowedUnitIds(room.availability?.allowed_unit_ids ?? []);
    setEditError("");
  };

  const handleEdit = async () => {
    if (!editRoom || !editName || !editCapacity) return;
    setEditLoading(true);
    setEditError("");
    try {
      const payload: Record<string, unknown> = {
        name: editName,
        capacity: parseInt(editCapacity),
        type: editType,
        availability: {
          allowed_days: editAllowedDays.length > 0 ? editAllowedDays : null,
          allowed_unit_ids: editAllowedUnitIds.length > 0 ? editAllowedUnitIds : null,
        },
      };
      if (editExamCapacity !== "") payload.exam_capacity = parseInt(editExamCapacity);
      await api.patch(`/resources/${editRoom.id}/`, payload);
      refetch();
      setEditRoom(null);
    } catch (err: unknown) {
      setEditError(err instanceof Error ? err.message : "Güncelleme başarısız.");
    } finally {
      setEditLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      await api.delete(`/resources/${deleteTarget.id}/`);
      refetch();
      setDeleteTarget(null);
    } catch {
      setDeleteTarget(null);
    } finally {
      setDeleteLoading(false);
    }
  };

  const inputStyle = { width: "100%", background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.text, outline: "none", fontSize: 13 };

  return (
    <PageContainer>
      <PageHeader
        title="Oda Yönetimi"
        subtitle="Sınavların gerçekleştirileceği fiziksel mekanlar ve kapasiteleri."
        actions={<ActionButton onClick={refetch} variant="secondary" icon="↻">Yenile</ActionButton>}
      />

      <div style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: 24, alignItems: "start" }}>
        <Card style={{ padding: 24 }}>
          <SL>YENİ ODA EKLE</SL>
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>ODA ADI / KODU</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Örn: B101" style={inputStyle} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>KAPASİTE</label>
                <input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="30" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>TÜR</label>
                <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                  {ROOM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>SINAV KAPASİTESİ</label>
              <input
                type="number"
                value={examCapacity}
                onChange={e => setExamCapacity(e.target.value)}
                placeholder="Otomatik hesaplanır"
                style={inputStyle}
              />
              <p style={{ fontSize: 11, color: C.textMuted, marginTop: 4, marginBottom: 0 }}>
                Derslik: kapasite / 2 · Amfi: kapasite / 3 (değiştirilebilir)
              </p>
            </div>
            {/* Day restriction */}
            <div>
              <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>MÜSAİT GÜNLER (boş = her gün)</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DAYS.map(d => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setAllowedDays(toggleItem(d.key, allowedDays))}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: `1px solid ${allowedDays.includes(d.key) ? C.cyan : C.border}`,
                      background: allowedDays.includes(d.key) ? C.cyanSoft : "transparent",
                      color: allowedDays.includes(d.key) ? C.cyan : C.textMuted,
                      fontSize: 11,
                      cursor: "pointer",
                      ...mono,
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Unit restriction */}
            {academicUnits.length > 0 && (
              <div>
                <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>YETKİLİ BİRİMLER (boş = tümü)</label>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 8px" }}>
                  {academicUnits.map((u) => (
                    <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12, color: C.text }}>
                      <input
                        type="checkbox"
                        checked={allowedUnitIds.includes(u.id)}
                        onChange={() => setAllowedUnitIds(toggleItem(u.id, allowedUnitIds))}
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {saveError && <p style={{ color: C.red, fontSize: 12, margin: 0 }}>{saveError}</p>}
            <ActionButton disabled={saving || !name || !capacity} icon="+">
              {saving ? "Ekleniyor..." : "Odayı Kaydet"}
            </ActionButton>
          </form>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <DataTable headers={["Oda Adı", "Tür", "Kapasite", "Sınav Kap.", "Müsaitlik", "İşlemler"]}>
            {loading && <DataRow><DataCell colSpan={5} style={{ textAlign: "center", padding: 40 }}><Spinner size={20} /></DataCell></DataRow>}
            {!loading && rooms.length === 0 && <DataRow><DataCell colSpan={5}><InfoBox msg="Henüz hiç oda eklenmemiş." /></DataCell></DataRow>}
            {rooms.map((room: any) => (
              <DataRow key={room.id}>
                <DataCell style={{ fontWeight: 600 }}>{room.name}</DataCell>
                <DataCell>
                  <span style={{ fontSize: 11, background: C.cyanSoft, color: C.cyan, padding: "4px 8px", borderRadius: 4, ...mono }}>{room.type}</span>
                </DataCell>
                <DataCell style={{ color: C.textSub, ...mono }}>{room.capacity} Kişi</DataCell>
                <DataCell style={{ color: C.textSub, ...mono }}>
                  {room.exam_capacity != null ? `${room.exam_capacity} Kişi` : "—"}
                </DataCell>
                <DataCell style={{ color: C.textSub, fontSize: 11, ...mono }}>
                  {(() => {
                    const days = room.availability?.allowed_days;
                    const units = room.availability?.allowed_unit_ids;
                    const parts: string[] = [];
                    if (days && days.length > 0) parts.push(days.join("/"));
                    if (units && units.length > 0) parts.push(`${units.length} birim`);
                    return parts.length > 0 ? parts.join(" · ") : "—";
                  })()}
                </DataCell>
                <DataCell>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <ActionButton onClick={() => openEdit(room)} variant="secondary">Düzenle</ActionButton>
                    <ActionButton onClick={() => setDeleteTarget(room)} variant="danger">Sil</ActionButton>
                  </div>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editRoom} onOpenChange={open => { if (!open) setEditRoom(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Odayı Düzenle</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-room-name">Oda Adı / Kodu</Label>
              <Input
                id="edit-room-name"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-room-cap">Kapasite</Label>
                <Input
                  id="edit-room-cap"
                  type="number"
                  value={editCapacity}
                  onChange={e => setEditCapacity(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-room-type">Tür</Label>
                <select
                  id="edit-room-type"
                  value={editType}
                  onChange={e => setEditType(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {ROOM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="edit-room-exam-cap">Sınav Kapasitesi</Label>
              <Input
                id="edit-room-exam-cap"
                type="number"
                value={editExamCapacity}
                onChange={e => setEditExamCapacity(e.target.value)}
                placeholder="Sınav kapasitesi"
              />
            </div>

            {/* Day restriction */}
            <div className="flex flex-col gap-1.5">
              <Label>Müsait Günler (boş = her gün)</Label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {DAYS.map(d => (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setEditAllowedDays(toggleItem(d.key, editAllowedDays))}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 4,
                      border: `1px solid ${editAllowedDays.includes(d.key) ? "hsl(var(--primary))" : "hsl(var(--border))"}`,
                      background: editAllowedDays.includes(d.key) ? "hsl(var(--primary) / 0.1)" : "transparent",
                      color: editAllowedDays.includes(d.key) ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                      fontSize: 11,
                      cursor: "pointer",
                      fontFamily: "monospace",
                    }}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Unit restriction */}
            {academicUnits.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>Yetkili Birimler (boş = tümü)</Label>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto", border: "1px solid hsl(var(--border))", borderRadius: 6, padding: "6px 8px" }}>
                  {academicUnits.map((u) => (
                    <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={editAllowedUnitIds.includes(u.id)}
                        onChange={() => setEditAllowedUnitIds(toggleItem(u.id, editAllowedUnitIds))}
                      />
                      {u.name}
                    </label>
                  ))}
                </div>
              </div>
            )}

            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRoom(null)} disabled={editLoading}>İptal</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editName || !editCapacity}>
              {editLoading ? "Kaydediliyor…" : "Kaydet"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => { if (!open) setDeleteTarget(null); }}
        title="Odayı Sil"
        description={`"${deleteTarget?.name}" odası kalıcı olarak silinecek.`}
        confirmLabel="Sil"
        onConfirm={handleDelete}
        loading={deleteLoading}
      />
    </PageContainer>
  );
}

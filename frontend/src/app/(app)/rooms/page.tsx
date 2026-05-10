"use client";
import React, { useState } from "react";
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
import {
  TermResourceDialog,
  type Resource,
  type TermResource,
  type AcademicUnit,
} from "./TermResourceDialog";

const ROOM_TYPES = [
  { value: "CLASSROOM", label: "Derslik" },
  { value: "LAB", label: "Laboratuvar" },
  { value: "AMPHITHEATER", label: "Amfi" },
];

export default function RoomsPage() {
  const { data, loading, refetch } = useFetch("/resources/");
  const rooms = data?.results || data || [];

  // Add form
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [examCapacity, setExamCapacity] = useState("");
  const [type, setType] = useState("CLASSROOM");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  // Edit dialog
  const [editRoom, setEditRoom] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editCapacity, setEditCapacity] = useState("");
  const [editExamCapacity, setEditExamCapacity] = useState("");
  const [editType, setEditType] = useState("CLASSROOM");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Term-resource config dialog
  const [configRoom, setConfigRoom] = useState<Resource | null>(null);

  // Active term + term-specific room configs
  const { data: termsData } = useFetch("/terms/");
  const terms: any[] = termsData?.results ?? termsData ?? [];
  const activeTerm = terms.find((t: any) => t.status === "Active") ?? null;

  const { data: trData, refetch: refetchTR } = useFetch(
    activeTerm ? `/term-resources/?term=${activeTerm.id}` : "",
    [activeTerm?.id]
  );
  const termResources: TermResource[] = trData?.results ?? trData ?? [];
  const termResourceMap: Record<string, TermResource> = Object.fromEntries(
    termResources.map((tr) => [tr.resource, tr])
  );

  // Academic units for the unit-restriction checkboxes
  const { data: unitsData } = useFetch("/academic-units/");
  const academicUnits: AcademicUnit[] = unitsData?.results ?? unitsData ?? [];

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !capacity) return;
    setSaving(true);
    setSaveError("");
    try {
      const orgData = await api.get("/organizations/");
      const orgId = orgData?.[0]?.id || orgData?.results?.[0]?.id;
      await api.post("/resources/", {
        name,
        full_capacity: parseInt(capacity),
        exam_capacity: parseInt(examCapacity),
        type,
        organization: orgId,
      });
      setName("");
      setCapacity("");
      setExamCapacity("");
      refetch();
    } catch (err: any) {
      setSaveError(err.message || "Oda eklenemedi.");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (room: any) => {
    setEditRoom(room);
    setEditName(room.name);
    setEditCapacity(String(room.full_capacity ?? ""));
    setEditExamCapacity(String(room.exam_capacity ?? ""));
    setEditType(room.type);
    setEditError("");
  };

  const handleEdit = async () => {
    if (!editRoom || !editName || !editCapacity) return;
    setEditLoading(true);
    setEditError("");
    try {
      await api.patch(`/resources/${editRoom.id}/`, {
        name: editName,
        full_capacity: parseInt(editCapacity),
        exam_capacity: parseInt(editExamCapacity),
        type: editType,
      });
      refetch();
      setEditRoom(null);
    } catch (err: any) {
      setEditError(err.message || "Güncelleme başarısız.");
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
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>TAM KAPASİTE</label>
                <input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="90" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>SINAV KAP.</label>
                <input type="number" value={examCapacity} onChange={e => setExamCapacity(e.target.value)} placeholder="30" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>TÜR</label>
                <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                  {ROOM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            {saveError && <p style={{ color: C.red, fontSize: 12, margin: 0 }}>{saveError}</p>}
            <ActionButton disabled={saving || !name || !capacity || !examCapacity} icon="+">
              {saving ? "Ekleniyor..." : "Odayı Kaydet"}
            </ActionButton>
          </form>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <DataTable headers={["Oda Adı", "Tür", "Tam Kapasite", "Sınav Kapasitesi", "İşlemler"]}>
            {loading && <DataRow><DataCell colSpan={4} style={{ textAlign: "center", padding: 40 }}><Spinner size={20} /></DataCell></DataRow>}
            {!loading && rooms.length === 0 && <DataRow><DataCell colSpan={4}><InfoBox msg="Henüz hiç oda eklenmemiş." /></DataCell></DataRow>}
            {rooms.map((room: any) => (
              <DataRow key={room.id}>
                <DataCell style={{ fontWeight: 600 }}>{room.name}</DataCell>
                <DataCell>
                  <span style={{ fontSize: 11, background: C.cyanSoft, color: C.cyan, padding: "4px 8px", borderRadius: 4, ...mono }}>{room.type}</span>
                </DataCell>
                <DataCell style={{ color: C.textSub, ...mono }}>{room.full_capacity ?? '—'} Kişi</DataCell>
                <DataCell style={{ color: C.textSub, ...mono }}>{room.exam_capacity ?? '—'} Kişi</DataCell>
                <DataCell>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
                    {termResourceMap[room.id] && (
                      <span style={{ fontSize: 11, background: C.cyanSoft, color: C.cyan, padding: "3px 8px", borderRadius: 4, ...mono }}>
                        Yapılandırıldı
                      </span>
                    )}
                    <span title={!activeTerm ? "Önce aktif bir dönem seçin" : undefined}>
                      <ActionButton
                        onClick={() => setConfigRoom(room as Resource)}
                        variant="secondary"
                        disabled={!activeTerm}
                      >
                        {termResourceMap[room.id] ? "Düzenle (Dönem)" : "Yapılandır"}
                      </ActionButton>
                    </span>
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
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-room-cap">Tam Kapasite</Label>
                <Input
                  id="edit-room-cap"
                  type="number"
                  value={editCapacity}
                  onChange={e => setEditCapacity(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="edit-room-exam-cap">Sınav Kapasitesi</Label>
                <Input
                  id="edit-room-exam-cap"
                  type="number"
                  value={editExamCapacity}
                  onChange={e => setEditExamCapacity(e.target.value)}
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
            {editError && <p className="text-sm text-destructive">{editError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRoom(null)} disabled={editLoading}>İptal</Button>
            <Button onClick={handleEdit} disabled={editLoading || !editName || !editCapacity || !editExamCapacity}>
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

      {/* Term-resource config dialog */}
      {configRoom && activeTerm && (
        <TermResourceDialog
          open={!!configRoom}
          onClose={() => setConfigRoom(null)}
          onSaved={refetchTR}
          room={configRoom}
          termId={activeTerm.id}
          existingConfig={termResourceMap[configRoom.id] ?? null}
          academicUnits={academicUnits}
        />
      )}
    </PageContainer>
  );
}

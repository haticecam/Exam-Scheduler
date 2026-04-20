"use client";
import React, { useState } from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, Badge, Spinner, PageContainer, PageHeader, ActionButton } from "@/components/ui";
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

export default function TermsPage() {
  const { data, error, loading: isLoading, refetch: mutate } = useFetch("/terms/");
  const terms = data?.results || data || [];

  // Add term dialog
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");

  // Edit term dialog
  const [editTerm, setEditTerm] = useState<any>(null);
  const [editName, setEditName] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Activate confirm
  const [activateTarget, setActivateTarget] = useState<any>(null);
  const [activateLoading, setActivateLoading] = useState(false);

  const handleAdd = async () => {
    if (!addName.trim()) return;
    setAddLoading(true);
    setAddError("");
    try {
      let orgs = await api.get("/organizations/");
      let orgList = orgs?.results || orgs || [];
      let org_id;
      if (orgList.length === 0) {
        const newOrg = await api.post("/organizations/", { name: "Varsayılan Üniversite" });
        org_id = newOrg.id;
      } else {
        org_id = orgList[0].id;
      }
      await api.post("/terms/", { name: addName.trim(), status: "Active", organization: org_id });
      mutate();
      setAddOpen(false);
      setAddName("");
    } catch (err: any) {
      setAddError(err.message || "Dönem eklenemedi.");
    } finally {
      setAddLoading(false);
    }
  };

  const handleEdit = async () => {
    if (!editName.trim() || !editTerm) return;
    setEditLoading(true);
    setEditError("");
    try {
      await api.patch(`/terms/${editTerm.id}/`, { name: editName.trim() });
      mutate();
      setEditTerm(null);
    } catch (err: any) {
      setEditError(err.message || "Dönem güncellenemedi.");
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

  if (isLoading) return <PageContainer><Spinner /></PageContainer>;
  if (error) return <PageContainer>Hata: {error}</PageContainer>;

  return (
    <PageContainer>
      <PageHeader
        title="Dönem Yönetimi"
        subtitle="Akademik dönemleri görüntüleyin ve yönetin."
        actions={
          <ActionButton onClick={() => { setAddName(""); setAddError(""); setAddOpen(true); }} icon="+">
            YENİ DÖNEM EKLE
          </ActionButton>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 24 }}>
        {terms.length === 0 ? (
          <div style={{ color: C.textMuted, ...mono }}>Sistemde kayıtlı dönem bulunamadı.</div>
        ) : (
          terms.map((t: any) => (
            <Card key={t.id} style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>{t.name}</div>
                <Badge status={t.status} />
              </div>

              <div style={{ marginTop: 8, paddingTop: 16, borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <ActionButton
                  variant="secondary"
                  onClick={() => { setEditTerm(t); setEditName(t.name); setEditError(""); }}
                >
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
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="add-term-name">Dönem Adı</Label>
            <Input
              id="add-term-name"
              placeholder="Örn: 2024-2025 Güz"
              value={addName}
              onChange={e => setAddName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              autoFocus
            />
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
          <div className="flex flex-col gap-3 py-2">
            <Label htmlFor="edit-term-name">Dönem Adı</Label>
            <Input
              id="edit-term-name"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleEdit()}
              autoFocus
            />
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

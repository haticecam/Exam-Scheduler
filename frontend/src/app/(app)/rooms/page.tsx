"use client";
import React from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, Spinner, InfoBox, Badge, PageContainer, PageHeader, DataTable, DataRow, DataCell, ActionButton } from "@/components/ui";

export default function RoomsPage() {
  const { data, loading, refetch } = useFetch("/resources/");
  const rooms = data?.results || data || [];

  const [name, setName] = React.useState("");
  const [capacity, setCapacity] = React.useState("");
  const [type, setType] = React.useState("CLASSROOM");
  const [saving, setSaving] = React.useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !capacity) return;
    setSaving(true);
    try {
      const orgData = await api.get("/organizations/");
      const orgId = orgData?.[0]?.id || orgData?.results?.[0]?.id;

      await api.post("/resources/", {
        name,
        capacity: parseInt(capacity),
        type,
        organization: orgId
      });
      setName("");
      setCapacity("");
      refetch();
    } catch (err: any) {
      alert(err.message || "Oda eklenemedi.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Bu odayı silmek istediğine emin misin?")) return;
    try {
      await api.delete(`/resources/${id}/`);
      refetch();
    } catch (err: any) {
      alert("Silme başarısız.");
    }
  };

  const inputStyle = { width: "100%", background: "#0d0e1a", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px", color: C.text, outline: "none", fontSize: 13 };

  return (
    <PageContainer>
      <PageHeader
        title="Oda Yönetimi"
        subtitle="Sınavların gerçekleştirileceği fiziksel mekanlar ve kapasiteleri."
        actions={
          <ActionButton onClick={refetch} variant="secondary" icon="↻">Yenile</ActionButton>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "350px 1fr", gap: 24, alignItems: "start" }}>
        <Card style={{ padding: 24 }}>
          <SL>YENİ ODA EKLE</SL>
          <form onSubmit={handleCreate} style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>ODA ADI / KODU</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Örn: B101, Merkez Lab vb." style={inputStyle} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>KAPASİTE</label>
                <input type="number" value={capacity} onChange={e => setCapacity(e.target.value)} placeholder="30" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 11, color: C.textMuted, marginBottom: 6, ...mono }}>TÜR</label>
                <select value={type} onChange={e => setType(e.target.value)} style={inputStyle}>
                  <option value="CLASSROOM">Derslik</option>
                  <option value="LAB">Laboratuvar</option>
                  <option value="AMPHITHEATER">Amfi</option>
                </select>
              </div>
            </div>
            <ActionButton disabled={saving || !name || !capacity} icon="+">
              {saving ? "Ekleniyor..." : "Odayı Kaydet"}
            </ActionButton>
          </form>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <DataTable headers={["Oda Adı", "Tür", "Kapasite", "İşlemler"]}>
            {loading && <DataRow><DataCell colSpan={4} style={{ textAlign: "center", padding: 40 }}><Spinner size={20} /></DataCell></DataRow>}
            {!loading && rooms.length === 0 && <DataRow><DataCell colSpan={4}><InfoBox msg="Henüz hiç oda eklenmemiş." /></DataCell></DataRow>}
            {rooms.map((room: any) => (
              <DataRow key={room.id}>
                <DataCell style={{ fontWeight: 600 }}>{room.name}</DataCell>
                <DataCell>
                  <span style={{ fontSize: 11, background: "#1a1b2e", color: C.cyan, padding: "4px 8px", borderRadius: 4, ...mono }}>{room.type}</span>
                </DataCell>
                <DataCell style={{ color: C.textSub, ...mono }}>{room.capacity} Kişi</DataCell>
                <DataCell style={{ textAlign: "right" }}>
                  <ActionButton onClick={() => handleDelete(room.id)} variant="danger">Sil</ActionButton>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </div>
      </div>
    </PageContainer>
  );
}

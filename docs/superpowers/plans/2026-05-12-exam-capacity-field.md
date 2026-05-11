# Exam Capacity Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `exam_capacity` to the `Resource` model with type-based defaults on creation (CLASSROOM → capacity//2, AMPHITHEATER → capacity//3), make it editable, and have the optimizer use it directly instead of hardcoding `capacity // 3`.

**Architecture:** Add a nullable `exam_capacity` IntegerField to `Resource`, auto-set in `ResourceSerializer.create()` when not explicitly provided, backfill existing rows via migration RunPython. The optimizer `load_rooms()` queries `exam_capacity` directly and expands filtering to include AMPHITHEATER rooms. Frontend shows exam capacity in the table and the edit dialog.

**Tech Stack:** Django (models, migrations, serializers), Python (optimizer service), Next.js/React (rooms page TSX)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `core/models.py` | Modify | Add `exam_capacity` field to `Resource` |
| `core/migrations/0002_resource_exam_capacity.py` | Create | Migration + RunPython backfill |
| `core/serializers.py` | Modify | Override `create()` to auto-calc `exam_capacity` |
| `core/services/optimizer.py` | Modify | Use `exam_capacity` field directly; expand filter |
| `core/management/commands/seed_rooms.py` | Modify | Set `exam_capacity = capacity // 2` in defaults |
| `core/views.py` | Modify | Update seed-rooms API action to include `exam_capacity` |
| `core/admin.py` | Modify | Show `exam_capacity` in `ResourceAdmin.list_display` |
| `core/tests/test_rooms.py` | Modify | Add new tests; update stale assertions |
| `frontend/src/app/(app)/rooms/page.tsx` | Modify | Show exam capacity column; add editable exam capacity in create + edit forms |

---

## Task 1: Write Failing Tests for exam_capacity

**Files:**
- Modify: `core/tests/test_rooms.py`

- [ ] **Step 1: Add new failing tests to `test_rooms.py`**

Add these tests after the existing ones (the model doesn't have `exam_capacity` yet, so all will fail):

```python
# ── Exam Capacity: model defaults ──────────────────────────────────────

@pytest.mark.django_db
def test_seed_rooms_sets_exam_capacity_classroom(org):
    """seed_rooms must set exam_capacity = capacity // 2 for CLASSROOM rooms."""
    call_command('seed_rooms', org_id=str(org.id))
    room = Resource.objects.get(organization=org, name='CZ08-09', type='CLASSROOM')
    assert room.exam_capacity == 66  # 132 // 2


@pytest.mark.django_db
def test_seed_rooms_correct_capacity_unchanged(org):
    """seed_rooms must not change the raw capacity field."""
    call_command('seed_rooms', org_id=str(org.id))
    room = Resource.objects.get(organization=org, name='CZ08-09', type='CLASSROOM')
    assert room.capacity == 132


# ── Exam Capacity: serializer auto-calc ────────────────────────────────

from rest_framework.test import APIRequestFactory
from core.serializers import ResourceSerializer


@pytest.mark.django_db
def test_serializer_auto_calc_exam_capacity_classroom(org):
    """ResourceSerializer.create() must set exam_capacity = capacity // 2 for CLASSROOM."""
    data = {
        'organization': str(org.id),
        'name': 'TEST-CLASS',
        'type': 'CLASSROOM',
        'capacity': 100,
    }
    serializer = ResourceSerializer(data=data)
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save()
    assert instance.exam_capacity == 50  # 100 // 2


@pytest.mark.django_db
def test_serializer_auto_calc_exam_capacity_amphitheater(org):
    """ResourceSerializer.create() must set exam_capacity = capacity // 3 for AMPHITHEATER."""
    data = {
        'organization': str(org.id),
        'name': 'TEST-AMFI',
        'type': 'AMPHITHEATER',
        'capacity': 120,
    }
    serializer = ResourceSerializer(data=data)
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save()
    assert instance.exam_capacity == 40  # 120 // 3


@pytest.mark.django_db
def test_serializer_explicit_exam_capacity_overrides_default(org):
    """Explicitly providing exam_capacity must bypass the auto-calculation."""
    data = {
        'organization': str(org.id),
        'name': 'TEST-OVERRIDE',
        'type': 'CLASSROOM',
        'capacity': 100,
        'exam_capacity': 99,
    }
    serializer = ResourceSerializer(data=data)
    assert serializer.is_valid(), serializer.errors
    instance = serializer.save()
    assert instance.exam_capacity == 99


# ── Exam Capacity: optimizer ────────────────────────────────────────────

@pytest.mark.django_db
def test_optimizer_uses_exam_capacity_field(org):
    """OptimizerService.load_rooms() must return exam_capacity values, not capacity // 3."""
    term = Term.objects.create(organization=org, name='Fall 2025', status='Active')
    call_command('seed_rooms', org_id=str(org.id))

    svc = OptimizerService(term_id=str(term.id))
    rooms = svc.load_rooms()

    # CZ08-09 has capacity=132; exam_capacity should be 132 // 2 = 66, NOT 132 // 3 = 44
    assert rooms['CZ08-09'] == 66
```

- [ ] **Step 2: Run tests to confirm they all fail (field doesn't exist yet)**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/test_rooms.py -v 2>&1 | tail -30
```

Expected: `AttributeError: 'Resource' object has no attribute 'exam_capacity'` or similar — all new tests fail.

- [ ] **Step 3: Commit the failing tests**

```bash
git add core/tests/test_rooms.py
git commit -m "test: add failing tests for exam_capacity field and auto-calculation"
```

---

## Task 2: Add exam_capacity to Resource Model + Migration

**Files:**
- Modify: `core/models.py:172`
- Create: `core/migrations/0002_resource_exam_capacity.py`

- [ ] **Step 1: Add the field to the model**

In `core/models.py`, after line 172 (`capacity = models.IntegerField(null=True, blank=True)`), add:

```python
    exam_capacity = models.IntegerField(null=True, blank=True)
```

Result (lines 167–178 after edit):
```python
class Resource(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name='resources')
    name = models.CharField(max_length=255)
    type = models.CharField(max_length=50)
    capacity = models.IntegerField(null=True, blank=True)
    exam_capacity = models.IntegerField(null=True, blank=True)
    attributes = models.JSONField(default=dict, blank=True)
    availability = models.JSONField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
```

- [ ] **Step 2: Create migration with backfill RunPython**

Create `core/migrations/0002_resource_exam_capacity.py`:

```python
from django.db import migrations, models


def backfill_exam_capacity(apps, schema_editor):
    Resource = apps.get_model('core', 'Resource')
    for resource in Resource.objects.filter(capacity__isnull=False, exam_capacity__isnull=True):
        if resource.type == 'CLASSROOM':
            resource.exam_capacity = resource.capacity // 2
        elif resource.type == 'AMPHITHEATER':
            resource.exam_capacity = resource.capacity // 3
        else:
            continue
        resource.save(update_fields=['exam_capacity'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='resource',
            name='exam_capacity',
            field=models.IntegerField(blank=True, null=True),
        ),
        migrations.RunPython(backfill_exam_capacity, migrations.RunPython.noop),
    ]
```

- [ ] **Step 3: Run the migration**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
python manage.py migrate
```

Expected: `Applying core.0002_resource_exam_capacity... OK`

- [ ] **Step 4: Commit**

```bash
git add core/models.py core/migrations/0002_resource_exam_capacity.py
git commit -m "feat: add exam_capacity field to Resource model with backfill migration"
```

---

## Task 3: Auto-Calculate exam_capacity in ResourceSerializer

**Files:**
- Modify: `core/serializers.py:10-14`

- [ ] **Step 1: Override `create()` in ResourceSerializer**

Replace the current `ResourceSerializer` class (lines 10–14):

```python
class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = '__all__'
        read_only_fields = ['id']
```

With:

```python
class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = '__all__'
        read_only_fields = ['id']

    def create(self, validated_data):
        if validated_data.get('exam_capacity') is None:
            capacity = validated_data.get('capacity')
            room_type = validated_data.get('type', '')
            if capacity is not None:
                if room_type == 'CLASSROOM':
                    validated_data['exam_capacity'] = capacity // 2
                elif room_type == 'AMPHITHEATER':
                    validated_data['exam_capacity'] = capacity // 3
        return super().create(validated_data)
```

- [ ] **Step 2: Run the serializer tests**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/test_rooms.py::test_serializer_auto_calc_exam_capacity_classroom \
       core/tests/test_rooms.py::test_serializer_auto_calc_exam_capacity_amphitheater \
       core/tests/test_rooms.py::test_serializer_explicit_exam_capacity_overrides_default \
       -v
```

Expected: All 3 PASS.

- [ ] **Step 3: Commit**

```bash
git add core/serializers.py
git commit -m "feat: auto-calculate exam_capacity in ResourceSerializer.create()"
```

---

## Task 4: Update seed_rooms Command + View Action

**Files:**
- Modify: `core/management/commands/seed_rooms.py:30-36`
- Modify: `core/views.py:222-228`

- [ ] **Step 1: Update seed_rooms management command**

In `core/management/commands/seed_rooms.py`, replace the `get_or_create` call (lines 30–36):

```python
        for name, capacity in EXAM_ROOMS.items():
            _, was_created = Resource.objects.get_or_create(
                organization=org,
                name=name,
                type='CLASSROOM',
                defaults={'capacity': capacity, 'is_active': True}
            )
```

With:

```python
        for name, capacity in EXAM_ROOMS.items():
            _, was_created = Resource.objects.get_or_create(
                organization=org,
                name=name,
                type='CLASSROOM',
                defaults={
                    'capacity': capacity,
                    'exam_capacity': capacity // 2,
                    'is_active': True,
                }
            )
```

- [ ] **Step 2: Update the seed-rooms API action in views.py**

In `core/views.py`, find the `seed_rooms` action (lines ~222–228). Replace the `get_or_create` defaults:

```python
        for name, capacity in EXAM_ROOMS.items():
            _, was_created = Resource.objects.get_or_create(
                organization=org,
                name=name,
                type='CLASSROOM',
                defaults={'capacity': capacity, 'is_active': True}
            )
```

With:

```python
        for name, capacity in EXAM_ROOMS.items():
            _, was_created = Resource.objects.get_or_create(
                organization=org,
                name=name,
                type='CLASSROOM',
                defaults={
                    'capacity': capacity,
                    'exam_capacity': capacity // 2,
                    'is_active': True,
                }
            )
```

- [ ] **Step 3: Run seed_rooms tests**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/test_rooms.py::test_seed_rooms_sets_exam_capacity_classroom \
       core/tests/test_rooms.py::test_seed_rooms_correct_capacity_unchanged \
       core/tests/test_rooms.py::test_seed_rooms_creates_24_resources \
       core/tests/test_rooms.py::test_seed_rooms_is_idempotent \
       core/tests/test_rooms.py::test_seed_rooms_missing_org_raises \
       -v
```

Expected: All 5 PASS.

- [ ] **Step 4: Commit**

```bash
git add core/management/commands/seed_rooms.py core/views.py
git commit -m "feat: set exam_capacity = capacity // 2 in seed_rooms for CLASSROOM rooms"
```

---

## Task 5: Update Optimizer to Use exam_capacity

**Files:**
- Modify: `core/services/optimizer.py:80-93`

- [ ] **Step 1: Update load_rooms() to query exam_capacity directly**

In `core/services/optimizer.py`, replace the `load_rooms` method body (lines 80–93):

```python
        resources = Resource.objects.filter(
            organization=term.organization,
            type='CLASSROOM',
            is_active=True,
            capacity__isnull=False
        ).values('name', 'capacity')

        # Divide by 3: rooms are used in exam shifts, so effective capacity per shift is capacity // 3
        rooms = {r['name']: r['capacity'] // 3 for r in resources}
        if not rooms:
            raise ValueError(
                f"No active CLASSROOM resources found for organization '{term.organization.name}'. "
                f"Run: python manage.py seed_rooms --org_id {term.organization.id}"
            )
        return rooms
```

With:

```python
        resources = Resource.objects.filter(
            organization=term.organization,
            type__in=['CLASSROOM', 'AMPHITHEATER'],
            is_active=True,
            exam_capacity__isnull=False
        ).values('name', 'exam_capacity')

        rooms = {r['name']: r['exam_capacity'] for r in resources}
        if not rooms:
            raise ValueError(
                f"No active exam rooms found for organization '{term.organization.name}'. "
                f"Run: python manage.py seed_rooms --org_id {term.organization.id}"
            )
        return rooms
```

- [ ] **Step 2: Run optimizer-related tests**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/test_rooms.py::test_optimizer_loads_rooms_from_db \
       core/tests/test_rooms.py::test_optimizer_raises_when_no_rooms \
       core/tests/test_rooms.py::test_optimizer_uses_exam_capacity_field \
       -v
```

Expected: All 3 PASS. Notably `rooms['CZ08-09'] == 66` (was 44 before).

- [ ] **Step 3: Run all room tests**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/test_rooms.py -v
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add core/services/optimizer.py
git commit -m "feat: optimizer uses exam_capacity field directly instead of capacity // 3"
```

---

## Task 6: Update Admin to Show exam_capacity

**Files:**
- Modify: `core/admin.py:71`

- [ ] **Step 1: Add exam_capacity to ResourceAdmin list_display**

In `core/admin.py`, replace line 71:

```python
    list_display = ['name', 'type', 'capacity', 'is_active', 'organization']
```

With:

```python
    list_display = ['name', 'type', 'capacity', 'exam_capacity', 'is_active', 'organization']
```

- [ ] **Step 2: Verify Django starts without errors**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Commit**

```bash
git add core/admin.py
git commit -m "chore: show exam_capacity in ResourceAdmin list"
```

---

## Task 7: Update the Existing Optimizer Capacity Test

**Files:**
- Modify: `core/tests/test_rooms.py`

The existing test `test_optimizer_loads_rooms_from_db` at line 60 still asserts `44` (the old `capacity // 3` value). Now it should be `66` (exam_capacity = `132 // 2`).

- [ ] **Step 1: Update the stale assertion**

In `core/tests/test_rooms.py`, find:

```python
    assert rooms['CZ08-09'] == 44  # 132 // 3 (shift capacity)
```

Replace with:

```python
    assert rooms['CZ08-09'] == 66  # 132 // 2 (exam_capacity for CLASSROOM)
```

- [ ] **Step 2: Run full test suite to confirm everything is green**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/ -v 2>&1 | tail -40
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add core/tests/test_rooms.py
git commit -m "test: update optimizer room capacity assertion from 44 to 66 after exam_capacity change"
```

---

## Task 8: Update Frontend Rooms Page

**Files:**
- Modify: `frontend/src/app/(app)/rooms/page.tsx`

Changes needed:
1. Add `examCapacity` state in the create form; auto-calculate when `type` or `capacity` changes, but keep it editable
2. Send `exam_capacity` in the POST payload
3. Add "Sınav Kap." column to the table showing `room.exam_capacity`
4. Add editable `exam_capacity` input to the edit dialog, pre-filled from `room.exam_capacity`
5. Send `exam_capacity` in the PATCH payload

- [ ] **Step 1: Replace rooms/page.tsx with the updated version**

Replace the entire content of `frontend/src/app/(app)/rooms/page.tsx` with:

```tsx
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

export default function RoomsPage() {
  const { data, loading, refetch } = useFetch("/resources/");
  const rooms = data?.results || data || [];

  // Add form
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [type, setType] = useState("CLASSROOM");
  const [examCapacity, setExamCapacity] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

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
      };
      if (examCapacity !== "") payload.exam_capacity = parseInt(examCapacity);
      await api.post("/resources/", payload);
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
    setEditCapacity(String(room.capacity ?? ""));
    setEditType(room.type);
    setEditExamCapacity(room.exam_capacity != null ? String(room.exam_capacity) : "");
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
      };
      if (editExamCapacity !== "") payload.exam_capacity = parseInt(editExamCapacity);
      await api.patch(`/resources/${editRoom.id}/`, payload);
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
            {saveError && <p style={{ color: C.red, fontSize: 12, margin: 0 }}>{saveError}</p>}
            <ActionButton disabled={saving || !name || !capacity} icon="+">
              {saving ? "Ekleniyor..." : "Odayı Kaydet"}
            </ActionButton>
          </form>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <DataTable headers={["Oda Adı", "Tür", "Kapasite", "Sınav Kap.", "İşlemler"]}>
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
```

- [ ] **Step 2: Verify TypeScript compiles without errors**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler/frontend
npx tsc --noEmit 2>&1 | head -30
```

Expected: No output (clean compile).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/(app)/rooms/page.tsx
git commit -m "feat: add exam_capacity field to room create/edit forms and table display"
```

---

## Task 9: Final Full Test Run

- [ ] **Step 1: Run the entire test suite**

```bash
cd /Users/haticecam/Desktop/Exam-Scheduler
pytest core/tests/ -v 2>&1 | tail -50
```

Expected: All tests pass. No failures.

- [ ] **Step 2: Run Django system check**

```bash
python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Verify migration state**

```bash
python manage.py showmigrations core
```

Expected:
```
core
 [X] 0001_initial
 [X] 0002_resource_exam_capacity
```

---

## Self-Review

**Spec coverage:**
- ✅ `exam_capacity` field added to Resource model
- ✅ CLASSROOM default: `capacity // 2`
- ✅ AMPHITHEATER default: `capacity // 3`
- ✅ exam_capacity is editable after creation (serializer does not override on update; field is mutable via PATCH)
- ✅ Optimizer uses `exam_capacity` directly
- ✅ Backfill migration for existing rows
- ✅ Frontend shows exam_capacity in create form (auto-filled, editable), table, and edit dialog

**Placeholder scan:** None found. All steps include actual code.

**Type consistency:**
- `exam_capacity` field name used consistently across model, migration, serializer, seed_rooms, optimizer, admin, and frontend
- `exam_capacity` (snake_case) on Python side; `exam_capacity` (snake_case, serialized from DRF) on frontend as `room.exam_capacity`

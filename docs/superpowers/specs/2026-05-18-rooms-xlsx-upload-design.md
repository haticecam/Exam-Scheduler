# Rooms XLSX Bulk Upload — Design Spec

**Date:** 2026-05-18
**Branch:** iso-fixo
**Page affected:** Oda Yönetimi (`/rooms`)

## Problem

Users starting the application without a database volume must add every room individually through the "YENİ ODA EKLE" form. For a typical university with dozens or hundreds of rooms, this is impractical. They need a bulk-import path.

## Goal

Add an Excel-based bulk-upload box to the Oda Yönetimi page so users can create many rooms at once from a simple `.xlsx` template, while preventing name collisions with rooms already in the system.

## Out of scope

- Bulk-edit or bulk-delete of existing rooms.
- Importing day/unit availability via Excel (intentionally left to the per-row UI dialog).
- CSV upload (only `.xlsx` is supported in this feature; the existing courses CSV flow is untouched).
- Frontend pre-parsing of the file — all validation is server-side.

## Excel file format

Single sheet. Row 1 = headers (any order, case-insensitive match). Required columns:

| Header | Type | Required | Notes |
|---|---|---|---|
| `Oda Adı` | text | yes | Room name / code, e.g. `B101`. Trimmed. Cannot be empty. |
| `Kapasite` | integer | yes | Physical capacity, positive integer. |
| `Tür` | text | yes | One of `derslik`, `laboratuvar`, `amfi` (case-insensitive). |
| `Sınav Kapasitesi` | integer | no | If blank, auto-calculated by type. |

Extra columns are ignored. Empty rows (all cells blank) are skipped.

### Type value mapping

| Excel value (case-insensitive) | Stored `type` |
|---|---|
| `derslik` | `CLASSROOM` |
| `laboratuvar` | `LAB` |
| `amfi` | `AMPHITHEATER` |

### Exam capacity auto-calculation (when blank)

Mirrors the existing UI logic in `defaultExamCapacity` (`rooms/page.tsx:24`):

| Type | Auto-calc rule |
|---|---|
| `CLASSROOM` (Derslik) | `capacity // 2` |
| `AMPHITHEATER` (Amfi) | `capacity // 3` |
| `LAB` (Laboratuvar) | `NULL` (no auto-calc) |

If `Sınav Kapasitesi` is provided, it must be a positive integer and overrides the auto-calc.

### Availability defaults

All uploaded rooms get `availability = {"allowed_days": null, "allowed_unit_ids": null}` (= every day, every academic unit). Users can restrict via the existing "Düzenle" dialog after upload.

## UI changes (`frontend/src/app/(app)/rooms/page.tsx`)

The left column currently holds a single `Card` with the "YENİ ODA EKLE" form. Replace with a vertical stack of two cards:

```
┌─────────────────────────┬────────────────────────────┐
│  EXCEL DOSYASINDAN      │                            │
│  TOPLU EKLE             │                            │
│  [CSVUploader, .xlsx]   │                            │
├─────────────────────────┤   <existing rooms table>   │
│  YENİ ODA EKLE          │                            │
│  [existing form]        │                            │
└─────────────────────────┴────────────────────────────┘
```

- Grid stays `350px 1fr`.
- Right column (table + dialogs) unchanged.
- Vertical gap between the two cards: `16px` (matches existing right-column spacing on line 269).

### Uploader usage

```tsx
<Card style={{ padding: 24 }}>
  <CSVUploader
    title="Excel Dosyasından Toplu Oda Ekle"
    endpoint="/resources/upload/"
    templateCols={["Oda Adı", "Kapasite", "Tür", "Sınav Kapasitesi"]}
    accept=".xlsx"
    onSuccess={refetch}
  />
</Card>
```

On `onSuccess`, the rooms table refetches automatically.

## Component change (`frontend/src/components/ui.tsx`)

Add an optional `accept` prop to `CSVUploader` to allow restricting accepted file types (default preserves current behaviour):

```tsx
export function CSVUploader({
  title, endpoint, templateCols, onSuccess, extraData,
  accept = ".csv,.xlsx",
}: {
  // ... existing types
  accept?: string;
}) {
```

- The hidden `<input accept=...>` (line 328) uses the new prop.
- The internal validation regex in `pick()` (line 253) is derived from `accept` — split on `,`, build `/\.(ext1|ext2)$/i`.
- The hint text on line 340 (`"CSV veya XLSX · Maks 50 MB"`) is rendered conditionally: if `accept === ".xlsx"` show `"XLSX · Maks 50 MB"`, else keep current text.

No callers besides Rooms need to set the prop; Courses/Students keep working unchanged.

## Backend: `/resources/upload/` action

Add a new action on `ResourceViewSet` (`core/views/resource.py`):

```python
@action(detail=False, methods=['post'],
        parser_classes=[MultiPartParser, FormParser],
        url_path='upload')
def upload_xlsx(self, request):
    ...
```

URL: `POST /api/resources/upload/`. Request body: `multipart/form-data` with a single field `file` (the `.xlsx`).

### Processing pipeline

1. **File present check.** Missing `file` → 400 `{"error": "Lütfen bir Excel dosyası yükleyin."}`
2. **Parse with `openpyxl`.** `load_workbook(io.BytesIO(file.read()), data_only=True, read_only=True)`. Any parse exception → 400 `{"error": "Geçersiz Excel dosyası."}`
3. **Header validation.** Row 1 must contain (case-insensitive, trimmed) all four required headers. Build a column-index map. Missing any → 400 `{"error": "Eksik sütun(lar): <list>"}`.
4. **Row validation.** Iterate rows 2..N. Skip rows where every cell is empty. For each non-empty row, collect errors:
   - `Oda Adı` empty after `.strip()` → `Satır N: Oda adı boş olamaz`
   - `Kapasite` not a positive int → `Satır N: Kapasite geçerli bir sayı olmalı`
   - `Tür` not in `{derslik, laboratuvar, amfi}` after `.lower().strip()` → `Satır N: Geçersiz tür: <value>`
   - `Sınav Kapasitesi` present but not a positive int → `Satır N: Sınav kapasitesi geçerli bir sayı olmalı`
   - If errors → 400 `{"error": "Dosyada hata bulundu:\n• <each error on its own line>"}`. **No rows are written.**
5. **Empty file guard.** If 0 non-empty rows → 400 `{"error": "Dosyada hiçbir veri satırı bulunamadı."}`
6. **Duplicate-name check.** After all rows pass validation:
   - Compute organization (`Organization.objects.first()` — matches existing patterns in `catalog.py` and `optimizer.py`).
   - `existing = set(Resource.objects.filter(organization=org).values_list('name', flat=True))`
   - Build `in_file_names = [row.name for row in parsed]`; check for both *within-file* duplicates and *against-existing* duplicates.
   - If any → 400 `{"error": "Aşağıdaki oda adları sistemde zaten mevcut: <comma-list> — yükleme iptal edildi.", "duplicate_names": [...]}`. **No rows are written.**
7. **Auto-calc exam capacity** for rows where `Sınav Kapasitesi` was blank, per the table above.
8. **Bulk insert.** Single `transaction.atomic()` block, `Resource.objects.bulk_create([Resource(...), ...])`. Each new room gets `organization=org`, `is_active=True`, `attributes={}`, `availability={"allowed_days": None, "allowed_unit_ids": None}`.
9. **Success response.** 200 `{"created": N, "rooms": [<names>]}`.

### Error message reference

| Condition | HTTP | Message |
|---|---|---|
| No file in request | 400 | `Lütfen bir Excel dosyası yükleyin.` |
| Not a valid `.xlsx` | 400 | `Geçersiz Excel dosyası.` |
| Missing required column(s) | 400 | `Eksik sütun(lar): Oda Adı, Tür` (example) |
| Any row validation error | 400 | `Dosyada hata bulundu:\n• Satır 3: Geçersiz tür: kantin\n• Satır 7: Kapasite geçerli bir sayı olmalı` |
| No data rows | 400 | `Dosyada hiçbir veri satırı bulunamadı.` |
| Duplicate names | 400 | `Aşağıdaki oda adları sistemde zaten mevcut: B101, B102 — yükleme iptal edildi.` |

The frontend `CSVUploader` already extracts `err.data?.error` and renders it in its error box. Multi-line messages with `\n` need `whiteSpace: pre-line` on the error `<p>` — implementation will add this if not already present.

## Testing

New file: `core/tests/test_resource_upload.py`. Pytest fixtures mirror `test_xlsx_upload.py` (token-authenticated client, `make_xlsx` helper).

Cases:

| # | Description | Expected |
|---|---|---|
| 1 | Happy path: 3 valid rows (one of each type) | 200, 3 rooms in DB, exam_capacity auto-calc correct: Derslik=cap//2, Lab=NULL, Amfi=cap//3 |
| 2 | Sınav Kapasitesi provided explicitly | 200, exam_capacity = provided value (no auto-calc) |
| 3 | Missing column header (`Tür`) | 400, message names the missing column, 0 rooms created |
| 4 | Row with invalid `Tür` value | 400, error references row number and bad value, 0 rooms |
| 5 | Row with non-numeric `Kapasite` | 400, 0 rooms |
| 6 | Row with empty `Oda Adı` | 400, 0 rooms |
| 7 | Duplicate against existing room in DB | 400, `duplicate_names` includes it, 0 rooms |
| 8 | Two rows in file with the same name | 400, 0 rooms |
| 9 | All-empty file (just headers) | 400 with `Dosyada hiçbir veri satırı bulunamadı.` |
| 10 | Empty rows mixed with valid rows | 200, empty rows skipped, valid rows created |
| 11 | Headers in mixed case (`oda adı`, `TÜR`) | 200, parsed normally |

No frontend tests are added — no existing `.test.tsx` files for any page; coverage relies on backend tests + manual smoke in the dev server.

## Files changed

| File | Change | Approximate size |
|---|---|---|
| `core/views/resource.py` | Add `upload_xlsx` action | +~120 lines |
| `core/services/resource_loader.py` | New service module: parse + validate XLSX (keeps the view thin, mirrors `course_loader.py` pattern) | +~150 lines |
| `frontend/src/components/ui.tsx` | Add `accept` prop to `CSVUploader`, derive validation regex from it | ~10 lines changed |
| `frontend/src/app/(app)/rooms/page.tsx` | Stack new upload Card above existing form Card | ~15 lines changed |
| `core/tests/test_resource_upload.py` | New test file | +~250 lines |

## Open questions / risks

- **Organization scoping.** `ResourceViewSet.get_queryset` already filters by `organization__isnull=False`, and the existing room create flow uses `Organization.objects.first()` (`rooms/page.tsx:92`). The upload endpoint follows the same single-org assumption — multi-org support is out of scope and consistent with the rest of the codebase.
- **File size.** No explicit limit is enforced server-side beyond Django's default `DATA_UPLOAD_MAX_MEMORY_SIZE` (2.5 MB). For thousands of rooms this is fine; if needed later, add an explicit cap.

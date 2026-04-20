# API ↔ Frontend Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all mismatches between backend API endpoints and frontend API calls so every page works correctly end-to-end.

**Architecture:** Django REST backend with token auth; Next.js 16 frontend calling `/api/*` proxied to `localhost:8000`. Four confirmed runtime bugs cause silent 400/500 failures; one field-name mismatch hides infeasibility details in the optimizer.

**Tech Stack:** Django DRF, Next.js 16, React, TypeScript

---

## Full Endpoint Audit

### ✅ Correctly wired (no changes needed)

| Frontend call | Backend endpoint |
|---|---|
| `useFetch("/terms/")` | `GET /api/terms/` |
| `useFetch("/terms/?status=Active")` | `GET /api/terms/?status=Active` |
| `api.post("/terms/", {...})` | `POST /api/terms/` |
| `api.patch("/terms/{id}/", {...})` | `PATCH /api/terms/{id}/` |
| `api.delete("/terms/{id}/")` | `DELETE /api/terms/{id}/` |
| `useFetch("/courses/?...")` | `GET /api/courses/` (with filters) |
| `CSVUploader endpoint="/courses/upload/"` | `POST /api/courses/upload/` |
| `CSVUploader endpoint="/academic-units/update-estimates/"` | `POST /api/academic-units/update-estimates/` |
| `useFetch("/academic-units/")` | `GET /api/academic-units/` |
| `useFetch("/resources/")` | `GET /api/resources/` |
| `api.post("/resources/", {...})` | `POST /api/resources/` |
| `api.delete("/resources/{id}/")` | `DELETE /api/resources/{id}/` |
| `api.get("/organizations/")` | `GET /api/organizations/` |
| `api.post("/organizations/", {...})` | `POST /api/organizations/` |
| `useFetch("/dashboard/stats/")` | `GET /api/dashboard/stats/` |
| `api.post("/optimize/run/", payload)` | `POST /api/optimize/run/` |
| `useFetch("/optimize/history/")` | `GET /api/optimize/history/` |
| `api.get("/optimize/history/")` | `GET /api/optimize/history/` |
| `api.get("/optimize/{id}/result/")` | `GET /api/optimize/{id}/result/` |
| `api.delete("/optimize/{id}/")` | `DELETE /api/optimize/{id}/` |

### ❌ Bugs (runtime failures)

| # | Frontend call | Problem | File |
|---|---|---|---|
| 1 | `api.delete("/students/deleteAll/")` | Backend requires `?org_id=<uuid>`, none sent → 400 | `students/page.tsx:18` |
| 2 | `api.downloadPost("/simulateStudents/", {}, ...)` | Backend requires `term_id` in body, `{}` sent → 400 | `students/page.tsx:31` |
| 3 | `CSVUploader endpoint="/students/"` | Backend requires `term_id` in multipart data, not passed → 400 | `students/page.tsx:71-76` |
| 4 | `sol?.solver_metadata?.infeasibility_reasons` | Backend `/result/` returns field as `stats`, not `solver_metadata` → always undefined | `optimizer/page.tsx:47` |

### ⚪ Backend endpoints with no frontend UI (not bugs, but documented)

- `POST /api/organizations/{id}/seed-rooms/` — seeds classroom list for an org
- `DELETE /api/courses/deleteAll/?org_id=` — wipes all courses for an org
- `POST /api/students/upload-xlsx/` — alternative to CSV for student enrollment
- `GET /api/students/getConflicts/` — returns paginated course conflict matrix
- `GET /api/optimize/{id}/departments/` — department breakdown of a solution
- `GET /api/optimize/{id}/by-department/?dept=` — per-department schedule view

---

## File Map

| File | Change |
|---|---|
| `frontend/src/app/(app)/students/page.tsx` | Fix bugs 1, 2, 3: fetch active term, pass term_id and org_id |

| File | Change |
|---|---|
| `frontend/src/app/(app)/optimizer/page.tsx` | Fix bug 4: use `stats` instead of `solver_metadata` |

---

## Task 1 — Fix students/page.tsx (Bugs 1, 2, 3)

**Files:**
- Modify: `frontend/src/app/(app)/students/page.tsx`

The page needs the active term to pass `term_id` to simulate and CSV upload, and the org ID to pass to `deleteAll`.

- [ ] **Step 1: Add term + org fetch at the top of `StudentsPage`**

Replace lines 7–12 in `students/page.tsx`:

```tsx
export default function StudentsPage() {
  const { data, loading, refetch } = useFetch("/students/");
  const { data: termData } = useFetch("/terms/?status=Active");
  const { data: orgData } = useFetch("/organizations/");

  const count = data?.count ?? (Array.isArray(data) ? data.length : 0);
  const term = termData?.results?.[0] || termData?.[0];
  const orgId = orgData?.[0]?.id || orgData?.results?.[0]?.id;

  const [deleting, setDeleting] = React.useState(false);
  const [simulating, setSimulating] = React.useState(false);
  const [showSuccess, setShowSuccess] = React.useState(false);
```

- [ ] **Step 2: Fix `handleDeleteAll` — pass `?org_id`**

Replace the `handleDeleteAll` function (lines 14–25):

```tsx
const handleDeleteAll = async () => {
  if (!orgId) { alert("Organizasyon bilgisi yüklenemedi."); return; }
  if (!confirm("Tüm öğrenciler ve kayıtlar silinecek. Emin misin?")) return;
  setDeleting(true);
  try {
    await api.delete(`/students/deleteAll/?org_id=${orgId}`);
    refetch();
  } catch (e: any) {
    alert(e.message || "Silme işlemi başarısız.");
  } finally {
    setDeleting(false);
  }
};
```

- [ ] **Step 3: Fix `handleSimulate` — pass `term_id` in body**

Replace the `handleSimulate` function (lines 27–39):

```tsx
const handleSimulate = async () => {
  if (!term?.id) { alert("Aktif dönem bulunamadı."); return; }
  setSimulating(true);
  setShowSuccess(false);
  try {
    await api.downloadPost("/simulateStudents/", { term_id: term.id }, "simile_ogrenciler.csv");
    refetch();
    setShowSuccess(true);
  } catch (e: any) {
    alert(e.message);
  } finally {
    setSimulating(false);
  }
};
```

- [ ] **Step 4: Fix CSVUploader — pass `term_id` as `extraData`**

Replace the `CSVUploader` block (lines 71–77):

```tsx
<CSVUploader
  title="Yükleme Aracı"
  endpoint="/students/"
  templateCols={["Student Identifier", "Program Name", "Year Level", "Course Code", "Section Label"]}
  extraData={term ? { term_id: term.id } : undefined}
  onSuccess={refetch}
/>
```

- [ ] **Step 5: Add guard when term is not available**

Add below the `orgId` line (after the state declarations):

```tsx
const noTerm = !term?.id;
```

Update the Simulate button to warn if no term:

```tsx
<ActionButton onClick={handleSimulate} disabled={simulating || noTerm}>
  {noTerm ? "Aktif dönem yok" : simulating ? "Simüle ediliyor…" : "Öğrenci Simülasyonu Başlat"}
</ActionButton>
```

- [ ] **Step 6: Verify in browser**

1. Navigate to `/students`
2. Open browser DevTools → Network tab
3. Click "Tüm Veriyi Sil" → confirm the DELETE request URL contains `?org_id=<uuid>` and returns 200
4. Click "Öğrenci Simülasyonu Başlat" → confirm the POST body contains `term_id` and returns a CSV download
5. Upload a CSV via the uploader → confirm the POST includes `term_id` in multipart form data

- [ ] **Step 7: Commit**

```bash
git add frontend/src/app/\(app\)/students/page.tsx
git commit -m "fix: pass org_id and term_id to students API endpoints"
```

---

## Task 2 — Fix optimizer/page.tsx (Bug 4)

**Files:**
- Modify: `frontend/src/app/(app)/optimizer/page.tsx:47`

The backend `/optimize/{id}/result/` returns `{ stats: {...} }` but the frontend reads `sol?.solver_metadata?.infeasibility_reasons`. This means infeasibility reasons are always empty when the solver fails.

- [ ] **Step 1: Fix the field name in the polling callback**

In `optimizer/page.tsx`, in the `startPolling` function, change line 47:

```tsx
// Before
setIis(sol?.solver_metadata?.infeasibility_reasons || []);

// After
setIis(sol?.stats?.infeasibility_reasons || []);
```

- [ ] **Step 2: Verify the fix**

Run the optimizer on a term with no courses loaded (or with params that make it infeasible). When it fails as INFEASIBLE, the "IIS TANI RAPORU" section should now show actual reasons from `stats.infeasibility_reasons` instead of the generic fallback message.

If you can't trigger INFEASIBLE easily, check via DevTools: the `/result/` response should have a `stats` key, not `solver_metadata`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/\(app\)/optimizer/page.tsx
git commit -m "fix: use stats field instead of solver_metadata in optimizer result polling"
```

---

## Self-Review

**Spec coverage:**
- Bug 1 (deleteAll missing org_id) → Task 1 Step 2 ✅
- Bug 2 (simulate missing term_id) → Task 1 Step 3 ✅
- Bug 3 (CSV upload missing term_id) → Task 1 Step 4 ✅
- Bug 4 (solver_metadata vs stats) → Task 2 Step 1 ✅

**Placeholder scan:** No TBDs, all code is complete.

**Type consistency:** `term.id` is a string UUID throughout; `orgId` is derived the same way as in `rooms/page.tsx` which already works.

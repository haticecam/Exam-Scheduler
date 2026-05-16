# LLM Apply Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the silent "Forma Uygula" apply with an interactive checklist panel just above "Optimizasyonu Başlat" where the user can review and deselect individual LLM-suggested changes before optimization runs.

**Architecture:** All changes are confined to `frontend/src/app/(app)/optimizer/page.tsx`. Two new state variables (`appliedChanges`, `pendingKwargs`) replace `pendingProposedParams`. Clicking "Forma Uygula" closes the AI panel and populates the checklist. `submit()` reads the checklist inline to build the payload — no async state concerns.

**Tech Stack:** React (Next.js), TypeScript, inline styles with project `C` color tokens and `mono` font helper.

---

## File Map

| File | Action |
|------|--------|
| `frontend/src/app/(app)/optimizer/page.tsx` | Modify — all changes in this one file |

---

### Task 1: Add new state, replace applyToForm with stageChanges

**Files:**
- Modify: `frontend/src/app/(app)/optimizer/page.tsx`

This task swaps the state variables and replaces the function that fires when "Forma Uygula" is clicked. No UI changes yet — the button wiring comes here.

- [ ] **Step 1: Add `AppliedChange` type after the existing `LLMChange` type (line 15)**

Find this line:
```ts
type LLMChange = { code: string; value: unknown; reason: string };
```
Add immediately after it:
```ts
type AppliedChange = LLMChange & { checked: boolean };
```

- [ ] **Step 2: Replace `pendingProposedParams` state with two new state variables**

Find and remove:
```ts
const [pendingProposedParams, setPendingProposedParams] = useState<Record<string, unknown> | null>(null);
```
Replace with:
```ts
const [appliedChanges, setAppliedChanges] = useState<AppliedChange[] | null>(null);
const [pendingKwargs, setPendingKwargs] = useState<{
  optimizer_kwargs: Record<string, unknown>;
  proposed_params: Record<string, unknown> | null;
} | null>(null);
```

- [ ] **Step 3: Replace the `applyToForm` function with `stageChanges`**

Find and remove the entire `applyToForm` function (lines 142–160):
```ts
// LLM: apply proposed params to the form
const applyToForm = () => {
  if (!llmResult?.optimizer_kwargs) return;
  setPendingProposedParams(llmResult.proposed_params ?? null);
  setExamPeriodId("");  // LLM config uses manual params
  const kw = llmResult.optimizer_kwargs as any;
  setParams(p => ({
    ...p,
    ...(kw.hard_threshold !== undefined  && { hard_threshold: kw.hard_threshold }),
    ...(kw.exam_days      !== undefined  && { exam_days: kw.exam_days }),
    ...(kw.slots_per_day  !== undefined  && { slots_per_day: kw.slots_per_day }),
    ...(kw.start_hour     !== undefined  && { start_hour: kw.start_hour }),
    ...(kw.time_limit     !== undefined  && { time_limit: kw.time_limit }),
    ...(kw.mip_gap        !== undefined  && { mip_gap: kw.mip_gap }),
    ...(kw.no_back_to_back  !== undefined && { no_back_to_back: kw.no_back_to_back }),
    ...(kw.year_order_weight  !== undefined && { year_order_weight: kw.year_order_weight }),
    ...(kw.year_order_sequence !== undefined && { year_order_sequence: kw.year_order_sequence }),
    ...(kw.year_order_weights  !== undefined && { year_order_weights: kw.year_order_weights }),
  }));
};
```
Replace with:
```ts
// LLM: stage changes into checklist (nothing written to params yet)
const stageChanges = () => {
  if (!llmResult?.optimizer_kwargs) return;
  setAppliedChanges(llmResult.changes.map(ch => ({ ...ch, checked: true })));
  setPendingKwargs({
    optimizer_kwargs: llmResult.optimizer_kwargs,
    proposed_params: llmResult.proposed_params ?? null,
  });
  setExamPeriodId("");
  setLlmSt("idle");
  setLlmResult(null);
};
```

- [ ] **Step 4: Update the "Forma Uygula" button to call stageChanges**

Find:
```tsx
onClick={applyToForm}
```
Replace with:
```tsx
onClick={stageChanges}
```

- [ ] **Step 5: Verify the file compiles (no TypeScript errors)**

Run:
```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors referencing `applyToForm`, `pendingProposedParams`, or type mismatches.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/app/(app)/optimizer/page.tsx
git commit -m "refactor: replace applyToForm with stageChanges, add AppliedChange state"
```

---

### Task 2: Update submit() and reset() to use new state

**Files:**
- Modify: `frontend/src/app/(app)/optimizer/page.tsx`

`submit()` currently reads `pendingProposedParams` to build the payload. Replace that with inline logic that reads `appliedChanges` + `pendingKwargs`, filters to checked items only, then clears both before the `await`.

- [ ] **Step 1: Replace the payload construction block inside submit()**

Find this block inside `submit()`:
```ts
const { name, ...rest } = params;
const payload = name ? { ...rest, name } : rest;
const finalPayload = {
  ...(pendingProposedParams ? { ...payload, proposed_params: pendingProposedParams } : payload),
  ...(examPeriodId ? { exam_period_id: examPeriodId } : {}),
};
```
Replace with:
```ts
// Build extra params from checklist (only checked items)
let extraParams: Partial<typeof params> = {};
let resolvedProposedParams: Record<string, unknown> | null = null;

if (appliedChanges && pendingKwargs) {
  const checkedCodes = new Set(appliedChanges.filter(c => c.checked).map(c => c.code));
  const kw = pendingKwargs.optimizer_kwargs as any;

  if (checkedCodes.has("PARAM_EXAM_DAYS")          && kw.exam_days          !== undefined) extraParams.exam_days          = kw.exam_days;
  if (checkedCodes.has("PARAM_SLOTS_PER_DAY")      && kw.slots_per_day      !== undefined) extraParams.slots_per_day      = kw.slots_per_day;
  if (checkedCodes.has("PARAM_START_HOUR")         && kw.start_hour         !== undefined) extraParams.start_hour         = kw.start_hour;
  if (checkedCodes.has("PARAM_HARD_THRESHOLD")     && kw.hard_threshold     !== undefined) extraParams.hard_threshold     = kw.hard_threshold;
  if (checkedCodes.has("PARAM_TIME_LIMIT")         && kw.time_limit         !== undefined) extraParams.time_limit         = kw.time_limit;
  if (checkedCodes.has("PARAM_MIP_GAP")            && kw.mip_gap            !== undefined) extraParams.mip_gap            = kw.mip_gap;
  if (checkedCodes.has("PARAM_NO_BACK_TO_BACK")    && kw.no_back_to_back    !== undefined) extraParams.no_back_to_back    = kw.no_back_to_back;
  if (checkedCodes.has("PARAM_YEAR_ORDER_WEIGHT")  && kw.year_order_weight  !== undefined) extraParams.year_order_weight  = kw.year_order_weight;
  if (checkedCodes.has("PARAM_YEAR_ORDER_SEQUENCE") && kw.year_order_sequence !== undefined) extraParams.year_order_sequence = kw.year_order_sequence;
  if (checkedCodes.has("PARAM_YEAR_ORDER_WEIGHTS") && kw.year_order_weights  !== undefined) extraParams.year_order_weights  = kw.year_order_weights;

  const rawProposed = pendingKwargs.proposed_params ?? {};
  const filteredProposed = Object.fromEntries(
    Object.entries(rawProposed).filter(([key]) => checkedCodes.has(key))
  );
  resolvedProposedParams = Object.keys(filteredProposed).length > 0 ? filteredProposed : null;
}

// Clear checklist before await — UI doesn't show stale state during polling
setAppliedChanges(null);
setPendingKwargs(null);

const { name, ...rest } = { ...params, ...extraParams };
const payload = name ? { ...rest, name } : rest;
const finalPayload = {
  ...(resolvedProposedParams ? { ...payload, proposed_params: resolvedProposedParams } : payload),
  ...(examPeriodId ? { exam_period_id: examPeriodId } : {}),
};
```

- [ ] **Step 2: Update reset() to clear new state**

Find:
```ts
const reset = () => {
  stopPoll(); setRunSt("idle"); setSolId(null); setPollSnap(null);
  setIis([]); setSubErr(""); setDiagSt("idle"); setDiagResult(null);
};
```
Replace with:
```ts
const reset = () => {
  stopPoll(); setRunSt("idle"); setSolId(null); setPollSnap(null);
  setIis([]); setSubErr(""); setDiagSt("idle"); setDiagResult(null);
  setAppliedChanges(null); setPendingKwargs(null);
};
```

- [ ] **Step 3: Verify no remaining references to pendingProposedParams**

Run:
```bash
grep -n "pendingProposedParams" "frontend/src/app/(app)/optimizer/page.tsx"
```
Expected: no output.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/(app)/optimizer/page.tsx
git commit -m "feat: read appliedChanges in submit(), update reset() to clear checklist state"
```

---

### Task 3: Render the checklist panel

**Files:**
- Modify: `frontend/src/app/(app)/optimizer/page.tsx`

Add the checklist JSX between the parameter form grid and the "Optimizasyonu Başlat" button. Visible only when `appliedChanges !== null`.

- [ ] **Step 1: Add the checklist panel**

Find this comment + div in the JSX (the parameter form ends and the start button begins):
```tsx
      <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={submit} disabled={isRunning}
```
Insert the following **immediately before** that `<div>`:
```tsx
      {/* ── LLM changes checklist ─────────────────────────────── */}
      {appliedChanges && (
        <div style={{ marginTop: 20, border: `1px solid color-mix(in srgb, ${C.cyan} 30%, transparent)`, borderRadius: 8, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: C.cyanSoft, borderBottom: `1px solid color-mix(in srgb, ${C.cyan} 20%, transparent)` }}>
            <span style={{ fontSize: 10, color: C.cyan, ...mono, letterSpacing: "0.08em", fontWeight: 700 }}>UYGULANACAK DEĞİŞİKLİKLER</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, color: C.textMuted, ...mono }}>
                {appliedChanges.filter(c => c.checked).length}/{appliedChanges.length} seçili
              </span>
              <button
                type="button"
                onClick={() => { setAppliedChanges(null); setPendingKwargs(null); }}
                style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "4px 10px", cursor: "pointer", ...mono, fontSize: 11 }}
              >
                İptal
              </button>
            </div>
          </div>
          {/* Rows */}
          {appliedChanges.map((ch, i) => (
            <div
              key={i}
              onClick={() => setAppliedChanges(prev => prev!.map((c, j) => j === i ? { ...c, checked: !c.checked } : c))}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "14px 16px",
                borderLeft: `4px solid ${ch.checked ? C.cyan : C.border}`,
                borderBottom: i < appliedChanges.length - 1 ? `1px solid ${C.border}` : "none",
                background: "var(--surface)",
                opacity: ch.checked ? 1 : 0.4,
                cursor: "pointer",
                transition: "opacity 140ms ease-out, border-color 140ms ease-out",
              }}
            >
              <input
                type="checkbox"
                checked={ch.checked}
                onChange={() => setAppliedChanges(prev => prev!.map((c, j) => j === i ? { ...c, checked: !c.checked } : c))}
                onClick={e => e.stopPropagation()}
                style={{ marginTop: 3, accentColor: C.cyan, flexShrink: 0, width: 16, height: 16, cursor: "pointer" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ ...mono, fontSize: 11, color: C.cyan, background: `color-mix(in srgb, ${C.cyan} 12%, transparent)`, padding: "2px 6px", borderRadius: 4 }}>
                    {ch.code}
                  </span>
                  <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
                    → {typeof ch.value === "object" && ch.value !== null ? JSON.stringify(ch.value) : String(ch.value)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>{ch.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}

```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 3: Start the dev server and manually verify the flow**

```bash
cd frontend && npm run dev
```

Open the optimizer page. Follow this test script:

1. **Happy path — all changes applied:**
   - Type a message like "Sınavları 10 güne yay" and click "✦ Yapılandır"
   - Wait for the AI result to appear with "Forma Uygula"
   - Click "Forma Uygula" → AI panel should close, checklist should appear just above "Optimizasyonu Başlat"
   - Checklist shows all changes pre-checked with thick left cyan border
   - Count reads "N/N seçili"
   - Click "▶ Optimizasyonu Başlat" → optimization runs (checklist disappears)

2. **Partial apply — uncheck one item:**
   - Repeat steps above, but before clicking start, click one row to uncheck it
   - Row dims to 40% opacity, border turns gray, count reads "(N-1)/N seçili"
   - Click "▶ Optimizasyonu Başlat" — only checked changes go to the backend

3. **İptal:**
   - Repeat steps above, but click "İptal" in the checklist header
   - Checklist disappears; no changes applied; optimizer runs with default form params

4. **Sıfırla:**
   - Stage changes (click "Forma Uygula")
   - Then click "Sıfırla" (reset button in status bar after a run, or trigger an error)
   - Checklist should disappear

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/(app)/optimizer/page.tsx
git commit -m "feat: add LLM apply checklist panel above Optimizasyonu Başlat button"
```

---

## Self-Review

**Spec coverage:**
- ✅ "Forma Uygula" closes AI panel → Task 1 `stageChanges()` calls `setLlmSt("idle")` + `setLlmResult(null)`
- ✅ Checklist appears just above start button → Task 3 inserts JSX before the start button div
- ✅ All changes pre-checked → Task 1 maps with `checked: true`
- ✅ User can uncheck rows → Task 3 row `onClick` toggles `checked`
- ✅ Thick bars (4px left border) → Task 3 `borderLeft: "4px solid ..."`
- ✅ Unchecked row dims → Task 3 `opacity: ch.checked ? 1 : 0.4`
- ✅ Only checked items applied on start → Task 2 `submit()` filters by `checkedCodes`
- ✅ İptal clears checklist → Task 3 header button
- ✅ `reset()` clears checklist → Task 2
- ✅ `proposed_params` filtered for SCOPE_ changes → Task 2 `filteredProposed`

**Placeholder scan:** No TBDs or incomplete steps. All code blocks are complete.

**Type consistency:**
- `AppliedChange` defined in Task 1, used in Task 3 (state type matches).
- `stageChanges` defined in Task 1, wired to button in Task 1.
- `appliedChanges` / `pendingKwargs` / `setAppliedChanges` / `setPendingKwargs` defined in Task 1, used in Tasks 2 and 3 — consistent names throughout.

# LLM Apply Checklist — Design Spec

**Date:** 2026-05-15  
**Branch:** llm-exam_calendar-fix  
**File:** `frontend/src/app/(app)/optimizer/page.tsx`

## Problem

When the user clicks "Forma Uygula" after the LLM returns changes, the changes are applied to the form silently. There is no confirmation step — the user cannot see what was applied or selectively exclude individual changes.

## Goal

Replace the silent apply with an interactive checklist panel that appears just above "Optimizasyonu Başlat". The user reviews the changes, unchecks any they don't want, and only checked items are applied when optimization starts.

## Chosen Approach

**Approach C — AI panel closes, checklist takes over.**

Clicking "Forma Uygula" closes the AI assistant panel entirely and renders a checklist panel just above the start button. No duplication — each change appears exactly once, as a checkable row. The per-row reason text preserves the LLM's explanation.

## State Changes

Remove `pendingProposedParams`. Add two new state variables:

```ts
type AppliedChange = LLMChange & { checked: boolean };

const [appliedChanges, setAppliedChanges] = useState<AppliedChange[] | null>(null);
const [pendingKwargs, setPendingKwargs] = useState<{
  optimizer_kwargs: Record<string, unknown>;
  proposed_params: Record<string, unknown> | null;
} | null>(null);
```

## "Forma Uygula" Button Behavior

Replace `applyToForm()` with `stageChanges()`:

1. Map `llmResult.changes` → `AppliedChange[]` with `checked: true` for each item.
2. Save `llmResult.optimizer_kwargs` and `llmResult.proposed_params` into `pendingKwargs`.
3. Close the AI panel: `setLlmSt("idle")`, `setLlmResult(null)`.
4. Do **not** write anything to `params` yet.

## Checklist Panel UI

Rendered between the parameter form cards and the "Optimizasyonu Başlat" button. Visible only when `appliedChanges !== null`.

### Layout

```
┌──────────────────────────────────────────────────────┐
│ UYGULANACAK DEĞİŞİKLİKLER        2/2 seçili   İptal  │
├──────────────────────────────────────────────────────┤
│ ☑  ▌  PARAM_EXAM_DAYS  →  10                         │
│        Sınavların on güne yayılması istendiği için.   │
├──────────────────────────────────────────────────────┤
│ ☑  ▌  SCOPE_DEPT_NO_BACK_TO_BACK  →  {...}           │
│        Bilgisayar Mühendisliği öğrencileri için.      │
└──────────────────────────────────────────────────────┘
▶  Optimizasyonu Başlat
```

### Row styling

- Background: `var(--surface)`
- Left border: 3px solid cyan (`C.cyan`) when checked; 3px solid `C.border` when unchecked
- Padding: 12px 16px vertically, 16px horizontally
- Unchecked row: 40% opacity, left border color `C.border`
- Rows separated by a 1px `C.border` divider

### Row contents (left → right)

1. Native `<input type="checkbox">` — styled with accent color
2. Code badge: `...mono`, 11px, cyan background pill (same style as existing change list)
3. `→ value` text: 12px, `C.text`, bold
4. Reason text: 11px, `C.textMuted`, below the badge line

### Header

- Left: section label "UYGULANACAK DEĞİŞİKLİKLER" (`SL` component style)
- Right: `{checked}/{total} seçili` count in 11px `C.textMuted`, and "İptal" button
- "İptal": clears both `appliedChanges` and `pendingKwargs`

### Edge cases

- All items unchecked: start button still enabled, but submits with no LLM changes (same as default params).
- Zero changes from LLM: "Forma Uygula" button is disabled (already true — `optimizer_kwargs` would be empty).

## "Optimizasyonu Başlat" Behavior Changes

Changes split into two categories by code prefix:

- **`PARAM_*`** codes map to `optimizer_kwargs` keys → written to `params` state before submit.
- **`SCOPE_*`** codes map to entries in `proposed_params` → sent as `proposed_params` field in the API payload.

In `submit()`, replace the `pendingProposedParams` reference with:

```ts
if (appliedChanges && pendingKwargs) {
  const checkedCodes = new Set(appliedChanges.filter(c => c.checked).map(c => c.code));
  const kw = pendingKwargs.optimizer_kwargs as any;

  // 1. Apply PARAM_* changes to form state
  setParams(p => ({
    ...p,
    ...(checkedCodes.has("PARAM_EXAM_DAYS")         && kw.exam_days          !== undefined && { exam_days: kw.exam_days }),
    ...(checkedCodes.has("PARAM_SLOTS_PER_DAY")     && kw.slots_per_day      !== undefined && { slots_per_day: kw.slots_per_day }),
    ...(checkedCodes.has("PARAM_START_HOUR")        && kw.start_hour         !== undefined && { start_hour: kw.start_hour }),
    ...(checkedCodes.has("PARAM_HARD_THRESHOLD")    && kw.hard_threshold      !== undefined && { hard_threshold: kw.hard_threshold }),
    ...(checkedCodes.has("PARAM_TIME_LIMIT")        && kw.time_limit         !== undefined && { time_limit: kw.time_limit }),
    ...(checkedCodes.has("PARAM_MIP_GAP")           && kw.mip_gap            !== undefined && { mip_gap: kw.mip_gap }),
    ...(checkedCodes.has("PARAM_NO_BACK_TO_BACK")   && kw.no_back_to_back    !== undefined && { no_back_to_back: kw.no_back_to_back }),
    ...(checkedCodes.has("PARAM_YEAR_ORDER_WEIGHT") && kw.year_order_weight  !== undefined && { year_order_weight: kw.year_order_weight }),
    ...(checkedCodes.has("PARAM_YEAR_ORDER_SEQUENCE") && kw.year_order_sequence !== undefined && { year_order_sequence: kw.year_order_sequence }),
    ...(checkedCodes.has("PARAM_YEAR_ORDER_WEIGHTS")  && kw.year_order_weights  !== undefined && { year_order_weights: kw.year_order_weights }),
  }));

  // 2. Filter proposed_params to only checked SCOPE_* changes
  const rawProposed = pendingKwargs.proposed_params ?? {};
  const filteredProposed = Object.fromEntries(
    Object.entries(rawProposed).filter(([key]) => checkedCodes.has(key))
  );
  setPendingProposedParams(Object.keys(filteredProposed).length > 0 ? filteredProposed : null);
}
setAppliedChanges(null);
setPendingKwargs(null);
```

Note: `setParams` and `setPendingProposedParams` calls inside `submit()` must be applied to local variables (not relying on re-render) since React state updates are asynchronous — build the final payload inline from the computed values rather than reading `params` after `setParams`.

## Reset Behavior

`reset()` must also clear `appliedChanges` and `pendingKwargs`.

## Files Changed

- `frontend/src/app/(app)/optimizer/page.tsx` — only file touched.

## Out of Scope

- No backend changes.
- No changes to the LLM API response shape.
- No new components — checklist is inline JSX in `page.tsx`.

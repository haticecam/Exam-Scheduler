# LLM Hallucination Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent the LLM configure endpoint from inventing scheduling parameter changes when the user's input is incoherent or unrelated to exam scheduling.

**Architecture:** Add `is_scheduling_request` (boolean) and `rejection_reason` (string) fields to the existing OpenAI function schema. The LLM sets `is_scheduling_request=false` for irrelevant inputs and provides a human-readable explanation. The backend detects this and returns a structured "soft rejection" response (HTTP 200, `success: true`, empty changes, clear message). The frontend renders this rejection message distinctly — no action buttons, amber/warning styling — instead of the generic error box it currently shows for API failures.

**Tech Stack:** Python/Django REST Framework (backend), OpenAI function calling, Next.js/React/TypeScript (frontend)

---

## File Map

| File | Change |
|------|--------|
| `core/services/llm_mapper.py` | Add `is_scheduling_request` + `rejection_reason` to function schema; update system prompt rule; handle rejection in `map_preferences` |
| `frontend/src/app/(app)/optimizer/page.tsx` | Update `LLMResult` type; render rejection panel with amber styling and no action buttons |

---

### Task 1: Extend the OpenAI function schema with rejection fields

**Files:**
- Modify: `core/services/llm_mapper.py`

- [ ] **Step 1: Add `is_scheduling_request` and `rejection_reason` to `PARAMETER_MAPPING_FUNCTION`**

Open `core/services/llm_mapper.py`. Replace the existing `PARAMETER_MAPPING_FUNCTION` definition with:

```python
PARAMETER_MAPPING_FUNCTION = {
    "name": "set_scheduling_parameters",
    "description": (
        "Map the administrator's natural language preferences to concrete "
        "scheduling parameters from the constraint library. Only set parameters "
        "that the user explicitly or implicitly requested to change. "
        "Do NOT set parameters the user didn't mention. "
        "If the input is not related to exam scheduling at all, set "
        "is_scheduling_request=false and explain why in rejection_reason."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "is_scheduling_request": {
                "type": "boolean",
                "description": (
                    "Set to false if the user's input has nothing to do with "
                    "exam scheduling (e.g. random text, unrelated questions, "
                    "incoherent sentences). Set to true for any scheduling-related "
                    "request, even vague ones like 'make it better'."
                ),
            },
            "rejection_reason": {
                "type": "string",
                "description": (
                    "Required when is_scheduling_request=false. A 1-2 sentence "
                    "explanation in the same language as the user's input, telling "
                    "them their message wasn't about scheduling and what kind of "
                    "input is expected."
                ),
            },
            "changes": {
                "type": "array",
                "description": "List of parameter changes to apply. Empty when is_scheduling_request=false.",
                "items": {
                    "type": "object",
                    "properties": {
                        "code": {
                            "type": "string",
                            "description": "The blueprint code from the constraint library (e.g., PARAM_HARD_THRESHOLD).",
                        },
                        "value": {
                            "description": "The new value for this parameter. Must match the type and range defined in the library.",
                        },
                        "reason": {
                            "type": "string",
                            "description": "Brief explanation of why this parameter was changed based on the user's input.",
                        },
                    },
                    "required": ["code", "value", "reason"],
                },
            },
            "summary": {
                "type": "string",
                "description": (
                    "A 1-3 sentence human-readable summary of all proposed changes, "
                    "written for a non-technical administrator. "
                    "Empty string when is_scheduling_request=false."
                ),
            },
            "warnings": {
                "type": "array",
                "description": "Any warnings about potential issues (e.g., infeasibility risk).",
                "items": {"type": "string"},
            },
        },
        "required": ["is_scheduling_request", "changes", "summary"],
    },
}
```

- [ ] **Step 2: Add rule 7 to the system prompt in `_build_system_prompt`**

In `_build_system_prompt`, update the `CRITICAL RULES` block in the return string. Replace:

```python
    return f"""You are an AI assistant for a university exam scheduling system.
Your job is to translate natural language administrator preferences into
concrete scheduling parameters.

CRITICAL RULES:
1. You can ONLY use parameter codes from the constraint library below.
2. You MUST respect the type, minimum, and maximum for each parameter.
3. Only change parameters the user explicitly or implicitly asks to change.
4. If the user's request is ambiguous, pick a reasonable middle-ground value
   and explain your reasoning.
5. If the user asks for something impossible (e.g., "schedule all exams in 1 day"
   when minimum exam_days is 3), set the closest valid value and warn them.
6. Never invent new parameter codes or constraint types.

{library_context}
{current_state}

When the user gives you their preferences, call the set_scheduling_parameters
function with the appropriate changes."""
```

with:

```python
    return f"""You are an AI assistant for a university exam scheduling system.
Your job is to translate natural language administrator preferences into
concrete scheduling parameters.

CRITICAL RULES:
1. You can ONLY use parameter codes from the constraint library below.
2. You MUST respect the type, minimum, and maximum for each parameter.
3. Only change parameters the user explicitly or implicitly asks to change.
4. If the user's request is ambiguous, pick a reasonable middle-ground value
   and explain your reasoning.
5. If the user asks for something impossible (e.g., "schedule all exams in 1 day"
   when minimum exam_days is 3), set the closest valid value and warn them.
6. Never invent new parameter codes or constraint types.
7. If the user's input is completely unrelated to exam scheduling (random text,
   questions about unrelated topics, greetings with no scheduling content,
   or incoherent sentences), set is_scheduling_request=false and provide a
   helpful rejection_reason in the same language as the user. Do NOT set any
   changes in this case — return an empty changes array.

{library_context}
{current_state}

When the user gives you their preferences, call the set_scheduling_parameters
function with the appropriate changes."""
```

- [ ] **Step 3: Handle the rejection case in `map_preferences`**

In `map_preferences`, after `llm_output = json.loads(message.function_call.arguments)`, add a rejection check **before** the existing `changes = llm_output.get("changes", [])` line:

```python
        llm_output = json.loads(message.function_call.arguments)

        # Rejection: input was not scheduling-related
        if not llm_output.get("is_scheduling_request", True):
            rejection_reason = llm_output.get(
                "rejection_reason",
                "Bu mesaj sınav çizelgeleme ile ilgili görünmüyor. "
                "Lütfen optimizer parametrelerini açıklayan bir mesaj girin.",
            )
            return {
                "success": True,
                "is_scheduling_request": False,
                "changes": [],
                "summary": rejection_reason,
                "warnings": [],
                "proposed_params": {},
                "optimizer_kwargs": {},
                "weight_config": {},
                "error": None,
            }

        changes = llm_output.get("changes", [])
```

- [ ] **Step 4: Add `is_scheduling_request: True` to the normal success return**

At the bottom of `map_preferences`, update the final success `return` statement to include `"is_scheduling_request": True`:

```python
        return {
            "success": True,
            "is_scheduling_request": True,
            "changes": changes,
            "summary": summary,
            "warnings": warnings,
            "proposed_params": proposed_params,
            "optimizer_kwargs": optimizer_kwargs,
            "weight_config": weight_config,
            "error": None,
        }
```

- [ ] **Step 5: Commit backend changes**

```bash
git add core/services/llm_mapper.py
git commit -m "feat: add hallucination guard to LLM mapper — reject non-scheduling inputs"
```

---

### Task 2: Update the frontend to render rejection responses gracefully

**Files:**
- Modify: `frontend/src/app/(app)/optimizer/page.tsx`

- [ ] **Step 1: Add `is_scheduling_request` to the `LLMResult` type**

Find the `LLMResult` type near the top of the file:

```typescript
type LLMResult = {
  success: boolean;
  summary: string;
  changes: LLMChange[];
  warnings: string[];
  proposed_params: Record<string, unknown>;
  optimizer_kwargs: Record<string, unknown>;
  weight_config: Record<string, unknown>;
  error?: string;
};
```

Replace it with:

```typescript
type LLMResult = {
  success: boolean;
  is_scheduling_request?: boolean;
  summary: string;
  changes: LLMChange[];
  warnings: string[];
  proposed_params: Record<string, unknown>;
  optimizer_kwargs: Record<string, unknown>;
  weight_config: Record<string, unknown>;
  error?: string;
};
```

- [ ] **Step 2: Replace the LLM result rendering block with rejection-aware rendering**

Find this block in the JSX (around line 328):

```tsx
        {/* LLM result */}
        {llmSt === "done" && llmResult?.success && (
          <div style={{
            marginTop: 16,
            background: C.cyanSoft,
            border: `1px solid color-mix(in srgb, ${C.cyan} 30%, transparent)`,
            borderRadius: 8,
            padding: "14px 16px",
          }}>
            <div style={{ fontSize: 10, color: C.cyan, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>AI ÖNERİSİ</div>
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 12 }}>{llmResult.summary}</p>

            {/* Change list */}
            {llmResult.changes.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>YAPILACAK DEĞİŞİKLİKLER</div>
                {llmResult.changes.map((ch, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                    <span style={{ color: C.cyan, fontSize: 12, flexShrink: 0, marginTop: 1 }}>▸</span>
                    <div>
                      <span style={{ ...mono, fontSize: 11, color: C.cyan, background: `color-mix(in srgb, ${C.cyan} 12%, transparent)`, padding: "2px 6px", borderRadius: 4 }}>{ch.code}</span>
                      <span style={{ fontSize: 12, color: C.text, marginLeft: 8, fontWeight: 600 }}>{String(ch.value)}</span>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{ch.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            {llmResult.warnings && llmResult.warnings.length > 0 && (
              <div style={{ marginBottom: 14, background: C.amberSoft, borderRadius: 6, padding: "10px 12px" }}>
                {llmResult.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: C.amber }}>⚠ {w}</div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={applyToForm}
                style={{ background: "var(--surface)", color: C.cyan, border: `1px solid color-mix(in srgb, ${C.cyan} 40%, transparent)`, borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 600 }}
              >
                Forma Uygula
              </button>
              <button
                onClick={applyAndRun}
                disabled={isRunning || !params.term_id}
                style={{ background: C.cyan, color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: isRunning || !params.term_id ? "not-allowed" : "pointer", ...mono, fontSize: 12, fontWeight: 700 }}
              >
                {isRunning ? "Çalışıyor…" : "Uygula & Çalıştır"}
              </button>
              <button
                onClick={() => { setLlmSt("idle"); setLlmResult(null); setLlmMessage(""); }}
                style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", ...mono, fontSize: 12 }}
              >
                Kapat
              </button>
            </div>
            {!params.term_id && (
              <div style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>⚠ "Uygula & Çalıştır" için önce bir dönem seçin.</div>
            )}
          </div>
        )}
```

Replace the entire block with:

```tsx
        {/* LLM result — rejection (not a scheduling request) */}
        {llmSt === "done" && llmResult?.success && llmResult.is_scheduling_request === false && (
          <div style={{
            marginTop: 16,
            background: C.amberSoft,
            border: `1px solid color-mix(in srgb, ${C.amber} 40%, transparent)`,
            borderRadius: 8,
            padding: "14px 16px",
            display: "flex",
            gap: 12,
            alignItems: "flex-start",
          }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>⚠</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: C.amber, ...mono, letterSpacing: "0.08em", marginBottom: 6 }}>GEÇERSİZ İSTEK</div>
              <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, margin: 0 }}>{llmResult.summary}</p>
            </div>
            <button
              onClick={() => { setLlmSt("idle"); setLlmResult(null); setLlmMessage(""); }}
              style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "6px 10px", cursor: "pointer", ...mono, fontSize: 11, flexShrink: 0 }}
            >
              Kapat
            </button>
          </div>
        )}

        {/* LLM result — normal scheduling response */}
        {llmSt === "done" && llmResult?.success && llmResult.is_scheduling_request !== false && (
          <div style={{
            marginTop: 16,
            background: C.cyanSoft,
            border: `1px solid color-mix(in srgb, ${C.cyan} 30%, transparent)`,
            borderRadius: 8,
            padding: "14px 16px",
          }}>
            <div style={{ fontSize: 10, color: C.cyan, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>AI ÖNERİSİ</div>
            <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 12 }}>{llmResult.summary}</p>

            {/* Change list */}
            {llmResult.changes.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>YAPILACAK DEĞİŞİKLİKLER</div>
                {llmResult.changes.map((ch, i) => (
                  <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                    <span style={{ color: C.cyan, fontSize: 12, flexShrink: 0, marginTop: 1 }}>▸</span>
                    <div>
                      <span style={{ ...mono, fontSize: 11, color: C.cyan, background: `color-mix(in srgb, ${C.cyan} 12%, transparent)`, padding: "2px 6px", borderRadius: 4 }}>{ch.code}</span>
                      <span style={{ fontSize: 12, color: C.text, marginLeft: 8, fontWeight: 600 }}>{String(ch.value)}</span>
                      <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{ch.reason}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Warnings */}
            {llmResult.warnings && llmResult.warnings.length > 0 && (
              <div style={{ marginBottom: 14, background: C.amberSoft, borderRadius: 6, padding: "10px 12px" }}>
                {llmResult.warnings.map((w, i) => (
                  <div key={i} style={{ fontSize: 12, color: C.amber }}>⚠ {w}</div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={applyToForm}
                style={{ background: "var(--surface)", color: C.cyan, border: `1px solid color-mix(in srgb, ${C.cyan} 40%, transparent)`, borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 600 }}
              >
                Forma Uygula
              </button>
              <button
                onClick={applyAndRun}
                disabled={isRunning || !params.term_id}
                style={{ background: C.cyan, color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", cursor: isRunning || !params.term_id ? "not-allowed" : "pointer", ...mono, fontSize: 12, fontWeight: 700 }}
              >
                {isRunning ? "Çalışıyor…" : "Uygula & Çalıştır"}
              </button>
              <button
                onClick={() => { setLlmSt("idle"); setLlmResult(null); setLlmMessage(""); }}
                style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", ...mono, fontSize: 12 }}
              >
                Kapat
              </button>
            </div>
            {!params.term_id && (
              <div style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>⚠ "Uygula & Çalıştır" için önce bir dönem seçin.</div>
            )}
          </div>
        )}
```

- [ ] **Step 3: Commit frontend changes**

```bash
git add frontend/src/app/\(app\)/optimizer/page.tsx
git commit -m "feat: show amber rejection panel for non-scheduling LLM inputs"
```

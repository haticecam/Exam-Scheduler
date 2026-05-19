"use client";
import React, { useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { Card, SL, Spinner, Badge, ErrorBox } from "@/components/ui";
import { useTermVersion } from "@/lib/term-context";

const IIS_LABELS: Record<string, string> = {
  no_feasible_slot: "Hiçbir sınav için uygun zaman dilimi bulunamadı.",
  room_capacity_exceeded: "Oda kapasitesi yetersiz — daha büyük sınav odası ekleyin.",
  instructor_conflict: "Eğitmen çakışması çözülemedi.",
  too_many_hard_conflicts: "Hard conflict sayısı hard_threshold eşiğini aştı.",
};

type LLMChange = { code: string; value: unknown; reason: string };
type AppliedChange = LLMChange & { checked: boolean };
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
type DiagnoseResult = {
  success: boolean;
  explanation: string;
  root_causes: { cause: string; constraint_type: string; severity: string }[];
  suggestions: { code: string; suggested_value: unknown; reason: string; impact: string; priority: number }[];
  combined_recommendation: string;
  error?: string;
};

const CALENDAR_OVERRIDDEN_CODES = new Set([
  "PARAM_EXAM_DAYS",
  "PARAM_SLOTS_PER_DAY",
  "PARAM_START_HOUR",
]);

const FIELD_LABELS_TR: Record<string, string> = {
  term_id: "Dönem",
  name: "Çözüm adı",
  exam_days: "Sınav günü sayısı",
  slots_per_day: "Gün başı slot",
  start_hour: "Başlangıç saati",
  hard_threshold: "Çakışma eşiği",
  time_limit: "Zaman limiti",
  mip_gap: "MIP gap toleransı",
  no_back_to_back: "Arka arkaya sınav engeli",
  year_order_weight: "Yıl sırası ağırlığı",
  year_order_sequence: "Yıl sırası",
  year_order_weights: "Yıl ağırlıkları",
  exam_period_id: "Sınav takvimi",
  proposed_params: "Önerilen parametreler",
};

function getFriendlyParamLabel(code: string): string {
  const cleanCode = code.replace(/^PARAM_/, "").toLowerCase();
  if (cleanCode === "no_back_to_back_depts" || cleanCode === "scope_dept_no_back_to_back") {
    return "Bölüm bazlı arka arkaya sınav engeli";
  }
  return FIELD_LABELS_TR[cleanCode] || code;
}

function translateDrfMessage(msg: string): string {
  let m = msg.match(/^Ensure this value is greater than or equal to (\S+?)\.?$/);
  if (m) return `${m[1]} veya daha büyük bir değer girin.`;
  m = msg.match(/^Ensure this value is less than or equal to (\S+?)\.?$/);
  if (m) return `${m[1]} veya daha küçük bir değer girin.`;
  m = msg.match(/^Ensure this field has no more than (\d+) characters\.?$/);
  if (m) return `Bu alan en fazla ${m[1]} karakter olabilir.`;
  if (msg === "This field is required.") return "Bu alan zorunludur.";
  if (msg === "This field may not be null.") return "Bu alan boş bırakılamaz.";
  if (msg === "This field may not be blank.") return "Bu alan boş bırakılamaz.";
  if (msg === "A valid integer is required.") return "Geçerli bir tam sayı girin.";
  if (msg === "A valid number is required.") return "Geçerli bir sayı girin.";
  if (msg.includes("is not a valid UUID")) return "Geçerli bir kimlik (UUID) değil.";
  return msg;
}

function NumberInput({
  value, onChange, min, step, style,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: string | number;
  style?: React.CSSProperties;
}) {
  const [draft, setDraft] = useState<string>(String(value));
  const lastEmittedRef = useRef<number>(value);

  // Sync draft when value changes from outside (LLM applied params, reset, etc.),
  // but ignore round-trips from our own emit so we don't clobber mid-edit text.
  useEffect(() => {
    if (value !== lastEmittedRef.current) {
      setDraft(String(value));
      lastEmittedRef.current = value;
    }
  }, [value]);

  const emit = (n: number) => {
    lastEmittedRef.current = n;
    onChange(n);
  };

  return (
    <input
      type="number"
      min={min}
      step={step}
      style={style}
      value={draft}
      onChange={e => {
        const s = e.target.value;
        setDraft(s);
        if (s === "" || s === "-" || s.endsWith(".")) return;
        const n = parseFloat(s);
        if (!Number.isNaN(n)) emit(n);
      }}
      onBlur={() => {
        if (draft === "") { setDraft(String(value)); return; }
        const n = parseFloat(draft);
        if (Number.isNaN(n)) { setDraft(String(value)); return; }
        if (min !== undefined && n < min) {
          emit(min);
          setDraft(String(min));
        }
      }}
    />
  );
}

function computeSlotParams(start: string, end: string, slotDuration: number): { start_hour: number; slots_per_day: number } {
  const startHour = parseInt(start.split(":")[0], 10);
  const [endH, endM] = end.split(":").map(Number);
  const endMin = endH * 60 + endM;
  const availableMin = endMin - (startHour * 60 + 30);
  const slotsPerUnit = Math.round(slotDuration / 30);
  const slots_per_day = Math.max(1, Math.floor(availableMin / slotDuration) * slotsPerUnit);
  return { start_hour: startHour, slots_per_day };
}

export default function OptimizerPage() {
  const router = useRouter();
  const { termVersion } = useTermVersion();
  const { data: termsData } = useFetch("/terms/", [termVersion]);
  const terms = termsData?.results || termsData || [];
  const activeTerm = terms.find((t: any) => t.status === "Active") ?? null;

  const [params, setParams] = useState({
    term_id: "", name: "", hard_threshold: 5, time_limit: 300,
    mip_gap: 0.10, no_back_to_back: false, exam_days: 5, slots_per_day: 20, start_hour: 8,
    year_order_weight: 100.0, year_order_sequence: null as number[] | null,
    year_order_weights: null as Record<string, number> | null,
  });

  const [examPeriodId, setExamPeriodId] = useState<string>("");
  const [manualStart, setManualStart] = useState("08:30");
  const [manualEnd, setManualEnd] = useState("18:30");
  const [manualSlotDuration, setManualSlotDuration] = useState(30);

  const [isRestored, setIsRestored] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    if (!activeTerm || !isRestored) return;
    const id = String(activeTerm.id);
    setParams(prev => {
      if (prev.term_id === id) return prev;
      setExamPeriodId("");
      return { ...prev, term_id: id };
    });
  }, [activeTerm?.id, isRestored]);
  const { data: periodsData } = useFetch(
    params.term_id ? `/exam-periods/?term_id=${params.term_id}` : "",
    [params.term_id]
  );
  const examPeriods: { id: string; name: string; start_date: string; end_date: string }[] = periodsData || [];

  const [runSt, setRunSt] = useState("idle");
  const [solId, setSolId] = useState<string | null>(null);
  const [submitErr, setSubErr] = useState("");
  const [iis, setIis] = useState<string[]>([]);
  const [pollSnap, setPollSnap] = useState<any>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // LLM state
  const [llmMessage, setLlmMessage] = useState("");
  const [llmSt, setLlmSt] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [llmResult, setLlmResult] = useState<LLMResult | null>(null);
  const [llmErr, setLlmErr] = useState("");
  const [diagSt, setDiagSt] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [diagResult, setDiagResult] = useState<DiagnoseResult | null>(null);
  const [showParams, setShowParams] = useState(false);
  const [appliedChanges, setAppliedChanges] = useState<AppliedChange[] | null>(null);
  const [pendingKwargs, setPendingKwargs] = useState<{
    optimizer_kwargs: Record<string, unknown>;
    proposed_params: Record<string, unknown> | null;
  } | null>(null);

  const isCalendarOverridden = useCallback(
    (code: string) => Boolean(examPeriodId) && CALENDAR_OVERRIDDEN_CODES.has(code),
    [examPeriodId],
  );

  const stopPoll = () => { if (timerRef.current) clearInterval(timerRef.current); };

  const startPolling = useCallback((id: string) => {
    setRunSt("polling");
    const tick = async () => {
      try {
        const res = await api.get(`/optimize/${id}/result/`);
        const DONE_STATUSES = ["COMPLETED", "OPTIMAL", "FEASIBLE", "FEASIBLE (TIME LIMIT)", "FEASIBLE_TIME_LIMIT"];
        const FAIL_STATUSES = ["FAILED", "INFEASIBLE", "ERROR"];
        const sol = res?.id ? res : res?.results?.[0] || res?.[0] || res;
        setPollSnap(sol);
        if (DONE_STATUSES.includes(sol?.status)) {
          stopPoll(); setRunSt("done");
        } else if (FAIL_STATUSES.includes(sol?.status)) {
          stopPoll();
          setIis(sol?.stats?.infeasibility_reasons || []);
          setRunSt(sol.status === "INFEASIBLE" ? "infeasible" : "error");
        }
      } catch { /* ignore transient */ }
    };
    tick();
    timerRef.current = setInterval(tick, 5000);
  }, []);

  useEffect(() => () => stopPoll(), []);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const savedParams = localStorage.getItem("opt_params");
      if (savedParams) setParams(JSON.parse(savedParams));

      const savedPeriodId = localStorage.getItem("opt_examPeriodId");
      if (savedPeriodId) setExamPeriodId(savedPeriodId);

      const savedManualStart = localStorage.getItem("opt_manualStart");
      if (savedManualStart) setManualStart(savedManualStart);

      const savedManualEnd = localStorage.getItem("opt_manualEnd");
      if (savedManualEnd) setManualEnd(savedManualEnd);

      const savedManualSlotDuration = localStorage.getItem("opt_manualSlotDuration");
      if (savedManualSlotDuration) setManualSlotDuration(Number(savedManualSlotDuration));

      const savedAppliedChanges = localStorage.getItem("opt_appliedChanges");
      if (savedAppliedChanges) setAppliedChanges(JSON.parse(savedAppliedChanges));

      const savedPendingKwargs = localStorage.getItem("opt_pendingKwargs");
      if (savedPendingKwargs) setPendingKwargs(JSON.parse(savedPendingKwargs));

      const savedRunSt = localStorage.getItem("opt_runSt");
      const savedSolId = localStorage.getItem("opt_solId");
      const savedPollSnap = localStorage.getItem("opt_pollSnap");
      const savedIis = localStorage.getItem("opt_iis");

      if (savedRunSt) setRunSt(savedRunSt);
      if (savedSolId) setSolId(savedSolId);
      if (savedPollSnap) setPollSnap(JSON.parse(savedPollSnap));
      if (savedIis) setIis(JSON.parse(savedIis));

      if (savedRunSt === "polling" && savedSolId) {
        startPolling(savedSolId);
      }
    } catch (e) {
      console.error("Failed to load settings from localStorage", e);
    } finally {
      setIsRestored(true);
    }
  }, [startPolling]);

  // Sync to localStorage
  useEffect(() => {
    if (!isRestored) return;
    localStorage.setItem("opt_params", JSON.stringify(params));
  }, [params, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    localStorage.setItem("opt_examPeriodId", examPeriodId);
  }, [examPeriodId, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    localStorage.setItem("opt_manualStart", manualStart);
  }, [manualStart, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    localStorage.setItem("opt_manualEnd", manualEnd);
  }, [manualEnd, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    localStorage.setItem("opt_manualSlotDuration", String(manualSlotDuration));
  }, [manualSlotDuration, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    if (appliedChanges) {
      localStorage.setItem("opt_appliedChanges", JSON.stringify(appliedChanges));
    } else {
      localStorage.removeItem("opt_appliedChanges");
    }
  }, [appliedChanges, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    if (pendingKwargs) {
      localStorage.setItem("opt_pendingKwargs", JSON.stringify(pendingKwargs));
    } else {
      localStorage.removeItem("opt_pendingKwargs");
    }
  }, [pendingKwargs, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    localStorage.setItem("opt_runSt", runSt);
  }, [runSt, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    if (solId) {
      localStorage.setItem("opt_solId", solId);
    } else {
      localStorage.removeItem("opt_solId");
    }
  }, [solId, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    if (pollSnap) {
      localStorage.setItem("opt_pollSnap", JSON.stringify(pollSnap));
    } else {
      localStorage.removeItem("opt_pollSnap");
    }
  }, [pollSnap, isRestored]);

  useEffect(() => {
    if (!isRestored) return;
    localStorage.setItem("opt_iis", JSON.stringify(iis));
  }, [iis, isRestored]);

  const submit = async () => {
    if (!params.term_id) { setSubErr("Lütfen bir dönem seçin."); return; }
    setRunSt("submitting"); setSubErr(""); setIis([]); setPollSnap(null);
    try {
      // Build extra params from checklist (only checked items)
      const extraParams: Partial<typeof params> = {};
      let resolvedProposedParams: Record<string, unknown> | null = null;

      if (appliedChanges && pendingKwargs) {
        const checkedCodes = new Set(
          appliedChanges
            .filter(c => c.checked && !isCalendarOverridden(c.code))
            .map(c => c.code)
        );
        const kw = pendingKwargs.optimizer_kwargs as any;

        if (checkedCodes.has("PARAM_EXAM_DAYS")           && kw.exam_days           !== undefined) extraParams.exam_days           = kw.exam_days;
        if (checkedCodes.has("PARAM_SLOTS_PER_DAY")       && kw.slots_per_day       !== undefined) extraParams.slots_per_day       = kw.slots_per_day;
        if (checkedCodes.has("PARAM_START_HOUR")          && kw.start_hour          !== undefined) extraParams.start_hour          = kw.start_hour;
        if (checkedCodes.has("PARAM_HARD_THRESHOLD")      && kw.hard_threshold      !== undefined) extraParams.hard_threshold      = kw.hard_threshold;
        if (checkedCodes.has("PARAM_TIME_LIMIT")          && kw.time_limit          !== undefined) extraParams.time_limit          = kw.time_limit;
        if (checkedCodes.has("PARAM_MIP_GAP")             && kw.mip_gap             !== undefined) extraParams.mip_gap             = kw.mip_gap;
        if (checkedCodes.has("PARAM_NO_BACK_TO_BACK")     && kw.no_back_to_back     !== undefined) extraParams.no_back_to_back     = kw.no_back_to_back;
        if (checkedCodes.has("PARAM_YEAR_ORDER_WEIGHT")   && kw.year_order_weight   !== undefined) extraParams.year_order_weight   = kw.year_order_weight;
        if (checkedCodes.has("PARAM_YEAR_ORDER_SEQUENCE") && kw.year_order_sequence !== undefined) extraParams.year_order_sequence = kw.year_order_sequence;
        if (checkedCodes.has("PARAM_YEAR_ORDER_WEIGHTS")  && kw.year_order_weights  !== undefined) extraParams.year_order_weights  = kw.year_order_weights;

        const rawProposed = pendingKwargs.proposed_params ?? {};
        const filteredProposed = Object.fromEntries(
          Object.entries(rawProposed).filter(([key]) => checkedCodes.has(key))
        );
        resolvedProposedParams = Object.keys(filteredProposed).length > 0 ? filteredProposed : null;
      }

      setAppliedChanges(null);
      setPendingKwargs(null);

      const baseSlotParams = examPeriodId ? {} : computeSlotParams(manualStart, manualEnd, manualSlotDuration);
      const { name, ...rest } = { ...params, ...baseSlotParams, ...extraParams };
      const payload: Record<string, unknown> = name ? { ...rest, name } : { ...rest };
      // Calendar provides exam_days/slots_per_day/start_hour — sending them would
      // re-validate form values that the backend will ignore anyway.
      if (examPeriodId) {
        delete payload.exam_days;
        delete payload.slots_per_day;
        delete payload.start_hour;
      }
      const finalPayload = {
        ...(resolvedProposedParams ? { ...payload, proposed_params: resolvedProposedParams } : payload),
        ...(examPeriodId ? { exam_period_id: examPeriodId } : {}),
      };
      const res = await api.post("/optimize/run/", finalPayload);
      const id = res?.task_id || res?.solution_id || res?.id;
      if (!id) throw new Error("Backend'den geçerli bir task/solution ID alınamadı.");
      setSolId(id);
      startPolling(id);
    } catch (e: any) {
      const d = e.data || {};
      const msg =
        (d.detail && translateDrfMessage(String(d.detail))) ||
        (d.error && translateDrfMessage(String(d.error))) ||
        Object.entries(d)
          .map(([k, v]) => {
            const label = FIELD_LABELS_TR[k] || k;
            const text = Array.isArray(v)
              ? v.map(x => translateDrfMessage(String(x))).join(", ")
              : translateDrfMessage(String(v));
            return `${label}: ${text}`;
          })
          .join(" | ") ||
        e.message;
      setSubErr(msg);
      setRunSt("error");
    }
  };

  const reset = () => {
    stopPoll(); setRunSt("idle"); setSolId(null); setPollSnap(null);
    setIis([]); setSubErr(""); setDiagSt("idle"); setDiagResult(null);
    setAppliedChanges(null); setPendingKwargs(null); setShowParams(false);
  };

  const handleResetToDefaults = () => {
    setShowResetConfirm(true);
  };

  const confirmReset = () => {
    setShowResetConfirm(false);
    stopPoll();
    setParams({
      term_id: activeTerm ? String(activeTerm.id) : "",
      name: "",
      hard_threshold: 5,
      time_limit: 300,
      mip_gap: 0.10,
      no_back_to_back: false,
      exam_days: 5,
      slots_per_day: 20,
      start_hour: 8,
      year_order_weight: 100.0,
      year_order_sequence: null,
      year_order_weights: null,
    });
    setExamPeriodId("");
    setManualStart("08:30");
    setManualEnd("18:30");
    setManualSlotDuration(30);
    setAppliedChanges(null);
    setPendingKwargs(null);
    setRunSt("idle");
    setSolId(null);
    setPollSnap(null);
    setIis([]);
    setSubErr("");
    setLlmMessage("");
    setLlmSt("idle");
    setLlmResult(null);
    setLlmErr("");
    setDiagSt("idle");
    setDiagResult(null);
    setShowParams(false);

    localStorage.removeItem("opt_params");
    localStorage.removeItem("opt_examPeriodId");
    localStorage.removeItem("opt_manualStart");
    localStorage.removeItem("opt_manualEnd");
    localStorage.removeItem("opt_manualSlotDuration");
    localStorage.removeItem("opt_appliedChanges");
    localStorage.removeItem("opt_pendingKwargs");
    localStorage.removeItem("opt_runSt");
    localStorage.removeItem("opt_solId");
    localStorage.removeItem("opt_pollSnap");
    localStorage.removeItem("opt_iis");
  };

  // LLM: configure
  const askLlm = async () => {
    if (!llmMessage.trim()) return;
    setLlmSt("loading"); setLlmErr(""); setLlmResult(null);
    try {
      const res = await api.post("/llm/configure/", { message: llmMessage });
      setLlmResult(res);
      setLlmSt("done");
    } catch (e: any) {
      setLlmErr(e.data?.error || e.message || "LLM isteği başarısız.");
      setLlmSt("error");
    }
  };

  // LLM: stage changes into checklist (nothing written to params yet)
  const stageChanges = () => {
    if (!llmResult?.optimizer_kwargs) return;
    const newChanges = llmResult.changes.map(ch => ({ ...ch, checked: true }));
    setAppliedChanges(prev => {
      if (!prev) return newChanges;
      const codesInNew = new Set(newChanges.map(c => c.code));
      const filteredPrev = prev.filter(c => !codesInNew.has(c.code));
      return [...filteredPrev, ...newChanges];
    });
    setPendingKwargs(prev => {
      const nextKwargs = llmResult.optimizer_kwargs;
      const nextProposed = llmResult.proposed_params ?? {};
      if (!prev) {
        return {
          optimizer_kwargs: nextKwargs,
          proposed_params: nextProposed,
        };
      }
      return {
        optimizer_kwargs: {
          ...prev.optimizer_kwargs,
          ...nextKwargs,
        },
        proposed_params: {
          ...(prev.proposed_params ?? {}),
          ...nextProposed,
        },
      };
    });
    setLlmSt("idle");
    setLlmResult(null);
  };


  // LLM: diagnose infeasible
  const diagnose = async () => {
    if (!solId) return;
    setDiagSt("loading"); setDiagResult(null);
    try {
      const res = await api.post("/llm/diagnose/", { solution_id: solId });
      setDiagResult(res);
      setDiagSt("done");
    } catch (e: any) {
      setDiagSt("error");
    }
  };

  const isRunning = runSt === "submitting" || runSt === "polling";
  const barColor = runSt === "done" ? C.green : runSt === "error" || runSt === "infeasible" ? C.red : C.accent;

  const iStyle = { background: "var(--surface)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "9px 12px", color: C.text, ...mono, fontSize: 13, width: "100%", boxSizing: "border-box" as const };
  const lStyle = { fontSize: 11, color: C.textMuted, ...mono, letterSpacing: "0.06em", display: "block", marginBottom: 6 };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: "0 0 6px", ...mono }}>Optimizer Çalıştır</h2>
          <p style={{ color: C.textMuted, fontSize: 14, margin: 0 }}>Gurobi MIP tabanlı sınav çizelgeleme motorunu yapılandırın ve çalıştırın.</p>
        </div>
        <button
          type="button"
          onClick={handleResetToDefaults}
          style={{
            background: "transparent",
            color: C.red,
            border: `1px solid color-mix(in srgb, ${C.red} 40%, transparent)`,
            borderRadius: 6,
            padding: "8px 14px",
            cursor: "pointer",
            ...mono,
            fontSize: 12,
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            gap: 6,
            transition: "all 140ms ease-out",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = `color-mix(in srgb, ${C.red} 8%, transparent)`;
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          ↺  Varsayılana Sıfırla
        </button>
      </div>

      {/* ── Status bar ───────────────────────────────────────────── */}
      {runSt !== "idle" && (
        <Card style={{ padding: "16px 20px", marginBottom: 20, borderColor: `${barColor}55` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isRunning && <Spinner color={barColor} />}
            <div style={{ flex: 1 }}>
              <div style={{ ...mono, fontSize: 13, fontWeight: 700, color: barColor }}>
                {runSt === "submitting" && "İstek gönderiliyor…"}
                {runSt === "polling" && `Gurobi çalışıyor`}
                {runSt === "done" && `✓  ${["FEASIBLE_TIME_LIMIT", "FEASIBLE (TIME LIMIT)"].includes(pollSnap?.status) ? "Zaman limitinde çözüm bulundu." : "Optimizasyon tamamlandı."}`}
                {runSt === "error" && `✕  Hata: ${submitErr || pollSnap?.error_message}`}
                {runSt === "infeasible" && "✕  INFEASIBLE — Bu parametrelerle çözüm bulunamadı"}
              </div>
              {runSt === "polling" && pollSnap && (
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, ...mono, display: "flex", gap: 10, alignItems: "center" }}>
                  Durum: <Badge status={pollSnap.status} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              {runSt === "done" && (
                <button type="button" onClick={() => router.push("/schedule")} style={{ background: C.green, color: "#000", border: "none", borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 700 }}>
                  Takvimi Görüntüle →
                </button>
              )}
              <button type="button" onClick={reset} style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", ...mono, fontSize: 12 }}>Sıfırla</button>
            </div>
          </div>

          {/* IIS report */}
          {runSt === "infeasible" && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.red}33`, paddingTop: 14 }}>
              <div style={{ fontSize: 10, color: C.red, ...mono, letterSpacing: "0.08em", marginBottom: 10 }}>IIS TANI RAPORU</div>
              {(iis.length ? iis : ["solver_metadata alanında detaylı tanı bilgisi mevcuttur."]).map((d, i) => (
                <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8 }}>
                  <span style={{ color: C.red }}>▸</span>
                  <span style={{ fontSize: 13, color: C.textSub }}>{IIS_LABELS[d] || d}</span>
                </div>
              ))}

              {/* AI Diagnose button */}
              <div style={{ marginTop: 14 }}>
                {diagSt === "idle" && (
                  <button
                    type="button"
                    onClick={diagnose}
                    style={{ background: C.purpleSoft, color: C.purple, border: `1px solid color-mix(in srgb, ${C.purple} 35%, transparent)`, borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 600 }}
                  >
                    ✦  AI ile Tanı Koy
                  </button>
                )}
                {diagSt === "loading" && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: C.purple, fontSize: 13, ...mono }}>
                    <Spinner /> AI analiz ediyor…
                  </div>
                )}
                {diagSt === "done" && diagResult && (
                  <div style={{ background: C.purpleSoft, border: `1px solid color-mix(in srgb, ${C.purple} 30%, transparent)`, borderRadius: 8, padding: "14px 16px", marginTop: 4 }}>
                    <div style={{ fontSize: 10, color: C.purple, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>AI TANISı</div>
                    <p style={{ fontSize: 13, color: C.text, lineHeight: 1.7, marginBottom: 12 }}>{diagResult.explanation}</p>
                    {diagResult.suggestions.length > 0 && (
                      <>
                        <div style={{ fontSize: 10, color: C.textMuted, ...mono, letterSpacing: "0.08em", marginBottom: 8 }}>ÖNERİLEN DEĞİŞİKLİKLER</div>
                        {diagResult.suggestions.slice(0, 4).map((s, i) => (
                          <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                            <span style={{ color: C.purple, fontSize: 11, marginTop: 2, flexShrink: 0 }}>{s.priority}.</span>
                            <div>
                              <span style={{ ...mono, fontSize: 11, color: C.purple, background: `color-mix(in srgb, ${C.purple} 12%, transparent)`, padding: "2px 6px", borderRadius: 4 }}>{s.code}</span>
                              <span style={{ fontSize: 12, color: C.textSub, marginLeft: 8 }}>→ {typeof s.suggested_value === "object" && s.suggested_value !== null ? JSON.stringify(s.suggested_value) : String(s.suggested_value)}</span>
                              <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{s.reason}</div>
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                    {diagResult.combined_recommendation && (
                      <div style={{ fontSize: 12, color: C.text, borderTop: `1px solid color-mix(in srgb, ${C.purple} 20%, transparent)`, paddingTop: 10, marginTop: 10 }}>
                        <b>Öneri:</b> {diagResult.combined_recommendation}
                      </div>
                    )}
                  </div>
                )}
                {diagSt === "error" && (
                  <div style={{ fontSize: 12, color: C.red }}>AI tanısı başarısız. OPENAI_API_KEY ayarlandı mı?</div>
                )}
              </div>
            </div>
          )}

          {/* Parameters used panel — shown on done */}
          {runSt === "done" && pollSnap?.parameters && (
            <div style={{ marginTop: 14, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
              <button
                type="button"
                onClick={() => setShowParams(v => !v)}
                style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, color: C.textMuted, fontSize: 11, ...mono, letterSpacing: "0.06em" }}
              >
                <span style={{ fontSize: 10, display: "inline-block", transform: showParams ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>▶</span>
                KULLANILAN PARAMETRELER
              </button>
              {showParams && (() => {
                const p = pollSnap.parameters;
                const llmCodes = new Set(Object.keys(p.llm_proposed_params || {}));
                const calendarActive = Boolean(p.exam_period_id);
                const CALENDAR_KEYS = new Set(["exam_days", "slots_per_day", "start_hour"]);

                const rows: { key: string; label: string; value: unknown; fromLlm: boolean; fromCalendar: boolean }[] = [
                  { key: "exam_period_id",      label: "Sınav Takvimi",       value: p.exam_period_id ?? "—",    fromLlm: false, fromCalendar: false },
                  { key: "hard_threshold",       label: "Hard Threshold",      value: p.hard_threshold,           fromLlm: llmCodes.has("PARAM_HARD_THRESHOLD"),      fromCalendar: false },
                  { key: "exam_days",            label: "Sınav Günü",          value: p.exam_days,                fromLlm: llmCodes.has("PARAM_EXAM_DAYS"),            fromCalendar: calendarActive },
                  { key: "slots_per_day",        label: "Slot/Gün",            value: p.slots_per_day,            fromLlm: llmCodes.has("PARAM_SLOTS_PER_DAY"),        fromCalendar: calendarActive },
                  { key: "start_hour",           label: "Başlangıç Saati",     value: p.start_hour,               fromLlm: llmCodes.has("PARAM_START_HOUR"),           fromCalendar: calendarActive },
                  { key: "no_back_to_back",      label: "Ardışık Yasak",       value: String(p.no_back_to_back),  fromLlm: llmCodes.has("PARAM_NO_BACK_TO_BACK"),      fromCalendar: false },
                  { key: "time_limit",           label: "Zaman Limiti (s)",    value: p.time_limit ?? "—",        fromLlm: llmCodes.has("PARAM_TIME_LIMIT"),           fromCalendar: false },
                  { key: "mip_gap",              label: "MIP Gap",             value: p.mip_gap,                  fromLlm: llmCodes.has("PARAM_MIP_GAP"),              fromCalendar: false },
                  { key: "year_order_weight",    label: "Yıl Sırası Ağırlığı", value: p.year_order_weight,        fromLlm: llmCodes.has("PARAM_YEAR_ORDER_WEIGHT"),    fromCalendar: false },
                  { key: "year_order_sequence",  label: "Yıl Sırası",          value: p.year_order_sequence ? JSON.stringify(p.year_order_sequence) : "—", fromLlm: llmCodes.has("PARAM_YEAR_ORDER_SEQUENCE"), fromCalendar: false },
                  { key: "no_back_to_back_depts",label: "Ardışık Yasak Bölüm", value: p.no_back_to_back_depts ? JSON.stringify(p.no_back_to_back_depts) : "—", fromLlm: llmCodes.has("SCOPE_DEPT_NO_BACK_TO_BACK"), fromCalendar: false },
                ];

                return (
                  <div style={{ marginTop: 10 }}>
                    {calendarActive && (
                      <div style={{ fontSize: 11, color: C.green, marginBottom: 8, display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ fontWeight: 700 }}>✓ TAKVİM AKTİF</span>
                        <span style={{ color: C.textMuted }}>— gün sayısı, saatler ve slotlar takvimden alındı</span>
                      </div>
                    )}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "6px 12px" }}>
                      {rows.map(r => (
                        <div key={r.key} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 11, ...mono }}>
                          <span style={{ color: C.textMuted, flexShrink: 0 }}>{r.label}:</span>
                          <span style={{
                            color: r.fromCalendar ? C.green : r.fromLlm ? C.cyan : C.text,
                            fontWeight: (r.fromCalendar || r.fromLlm) ? 700 : 400,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {String(r.value)}
                            {r.fromCalendar && <span style={{ fontSize: 9, color: C.green, marginLeft: 4 }}>TAKVİM</span>}
                            {!r.fromCalendar && r.fromLlm && <span style={{ fontSize: 9, color: C.cyan, marginLeft: 4 }}>AI</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                    {p.llm_proposed_params && Object.keys(p.llm_proposed_params).length > 0 && (
                      <div style={{ marginTop: 10, padding: "8px 10px", background: `color-mix(in srgb, ${C.cyan} 7%, transparent)`, borderRadius: 6, border: `1px solid color-mix(in srgb, ${C.cyan} 20%, transparent)` }}>
                        <div style={{ fontSize: 9, color: C.cyan, ...mono, letterSpacing: "0.08em", marginBottom: 5 }}>AI ÖNERDİ</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
                          {Object.entries(p.llm_proposed_params).map(([k, v]) => (
                            <span key={k} style={{ fontSize: 11, ...mono, color: C.cyan }}>
                              {k}: <span style={{ color: C.text }}>{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </Card>
      )}

      {/* ── AI Assistant panel ───────────────────────────────────── */}
      <Card style={{ padding: "20px 24px", marginBottom: 20, borderColor: `color-mix(in srgb, ${C.cyan} 30%, transparent)` }}>
        <SL>✦ AI ASISTAN — DOĞAL DİL İLE YAPILANDIRMA</SL>
        <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 14, lineHeight: 1.6 }}>
          Parametreleri doğal dilde tanımlayın. AI, istediğinizi anlayıp optimizer ayarlarına dönüştürür.
        </p>

        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <textarea
              rows={3}
              placeholder={"Örn: Sınavları 10 güne yay, arka arkaya sınav olmasın, başlangıç saati 09:00 olsun"}
              value={llmMessage}
              onChange={e => setLlmMessage(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) askLlm(); }}
              style={{
                ...iStyle,
                resize: "vertical",
                minHeight: 72,
                lineHeight: 1.6,
              }}
            />
          </div>
          <button
            type="button"
            onClick={askLlm}
            suppressHydrationWarning
            disabled={llmSt === "loading" || !llmMessage.trim()}
            style={{
              background: llmSt === "loading" ? C.cyanSoft : C.cyan,
              color: llmSt === "loading" ? C.cyan : "#fff",
              border: "none",
              borderRadius: 8,
              padding: "12px 20px",
              cursor: llmSt === "loading" || !llmMessage.trim() ? "not-allowed" : "pointer",
              ...mono,
              fontSize: 13,
              fontWeight: 700,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexShrink: 0,
            }}
          >
            {llmSt === "loading" ? <><Spinner size={13} /> Analiz ediliyor…</> : "✦  Yapılandır"}
          </button>
        </div>
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>Ctrl+Enter ile gönder</div>

        {/* LLM error */}
        {llmSt === "error" && (
          <div style={{ marginTop: 12 }}>
            <ErrorBox msg={llmErr || "LLM isteği başarısız. OPENAI_API_KEY ayarlandı mı?"} />
          </div>
        )}

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
              type="button"
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
                      <span style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>
                        {ch.reason || `${getFriendlyParamLabel(ch.code)} → ${typeof ch.value === "object" && ch.value !== null ? JSON.stringify(ch.value) : String(ch.value)}`}
                      </span>
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
                type="button"
                onClick={stageChanges}
                style={{ background: "var(--surface)", color: C.cyan, border: `1px solid color-mix(in srgb, ${C.cyan} 40%, transparent)`, borderRadius: 6, padding: "8px 16px", cursor: "pointer", ...mono, fontSize: 12, fontWeight: 600 }}
              >
                Forma Uygula
              </button>
              <button
                type="button"
                onClick={() => { setLlmSt("idle"); setLlmResult(null); setLlmMessage(""); }}
                style={{ background: "transparent", color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px", cursor: "pointer", ...mono, fontSize: 12 }}
              >
                Kapat
              </button>
            </div>
          </div>
        )}
      </Card>

      {/* ── Parameter form ───────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <Card style={{ padding: "24px" }}>
          <SL>TEMEL PARAMETRELER</SL>
          <div style={{ marginBottom: 16 }}>
            <label style={lStyle}>AKTİF DÖNEM</label>
            <div style={{ ...iStyle, cursor: "default", display: "flex", alignItems: "center", minHeight: 38 }}>
              {activeTerm
                ? activeTerm.name
                : <span style={{ color: C.textMuted }}>Aktif dönem bulunamadı — Dönem Yönetimi&apos;nden bir dönem aktifleştirin.</span>}
            </div>
          </div>

          {/* Exam calendar selector — shown whenever a term is selected */}
          {params.term_id && (
            <div style={{ marginBottom: 16 }}>
              <label style={lStyle}>SINAV TAKVİMİ</label>
              {examPeriods.length > 0 ? (
                <select
                  style={{ ...iStyle, cursor: "pointer", borderColor: examPeriodId ? C.green : C.border }}
                  value={examPeriodId}
                  onChange={e => setExamPeriodId(e.target.value)}
                >
                  <option value="">— Manuel parametreler kullan —</option>
                  {examPeriods.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.start_date} → {p.end_date})
                    </option>
                  ))}
                </select>
              ) : (
                <div style={{ fontSize: 12, color: C.textMuted, padding: "9px 12px", border: `1px dashed ${C.border}`, borderRadius: 6 }}>
                  Bu dönem için henüz sınav takvimi yok — önce{" "}
                  <a href="/exam-calendar" style={{ color: C.accent }}>Sınav Takvimi</a>{" "}
                  sayfasından oluşturun.
                </div>
              )}
              {examPeriodId && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: C.green, fontWeight: 700 }}>✓ TAKVİM AKTİF</span>
                  <span style={{ fontSize: 11, color: C.textMuted }}>— gün sayısı, saatler ve engellenen slotlar takvimden alınır</span>
                </div>
              )}
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={lStyle}>ÇÖZÜM ADI <span style={{ color: C.textMuted }}>(opsiyonel)</span></label>
            <input style={iStyle} placeholder="Örn: Güz 2025 Test 3" value={params.name} onChange={e => setParams({ ...params, name: e.target.value })} />
          </div>

          {/* Hide time-grid fields when calendar is active — it provides these values */}
          {!examPeriodId && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={lStyle}>SINAV GÜN SAYISI</label>
                  <NumberInput style={iStyle} min={1} value={params.exam_days} onChange={n => setParams({ ...params, exam_days: n })} />
                </div>
                <div>
                  <label style={lStyle}>BAŞLANGIÇ ZAMANI</label>
                  <input
                    type="time"
                    style={iStyle}
                    value={manualStart}
                    onChange={e => setManualStart(e.target.value)}
                  />
                </div>
                <div>
                  <label style={lStyle}>BİTİŞ ZAMANI</label>
                  <input
                    type="time"
                    style={iStyle}
                    value={manualEnd}
                    onChange={e => setManualEnd(e.target.value)}
                  />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 12 }}>
                <div>
                  <label style={lStyle}>SLOT SÜRESİ (DAKİKA)</label>
                  <input
                    type="number"
                    min={30}
                    max={480}
                    step={30}
                    style={iStyle}
                    value={manualSlotDuration}
                    onChange={e => setManualSlotDuration(Math.max(30, Number(e.target.value)))}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
                  {(() => {
                    const { start_hour, slots_per_day } = computeSlotParams(manualStart, manualEnd, manualSlotDuration);
                    const examCapacity = Math.floor(slots_per_day / Math.round(manualSlotDuration / 30));
                    const startEffective = `${String(start_hour).padStart(2, "0")}:30`;
                    return (
                      <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.7 }}>
                        <span style={{ color: C.text, fontWeight: 600 }}>{slots_per_day}</span> slot/gün
                        <span style={{ margin: "0 6px", color: C.border }}>·</span>
                        {startEffective} başlangıç
                        <span style={{ margin: "0 6px", color: C.border }}>·</span>
                        günde <span style={{ color: C.text, fontWeight: 600 }}>{examCapacity}</span> sınav kapasitesi
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}

          <div>
            <label style={lStyle}>ÇAKIŞMA EŞİĞİ (HARD THRESHOLD)</label>
            <NumberInput style={iStyle} min={0} value={params.hard_threshold} onChange={n => setParams({ ...params, hard_threshold: n })} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 5, lineHeight: 1.6 }}>
              Aynı anda iki sınava girecek öğrenci çakışmalarının <b>izin verilen maksimum sayısı</b>. <br />
              <span style={{ color: C.textSub }}>0 → hiçbir çakışmaya izin verme (en katı, çözüm uzar) · yüksek değer çözümü hızlandırır ancak bazı öğrenciler çakışmalı sınava girebilir.</span>
            </div>
          </div>
        </Card>

        <Card style={{ padding: "24px", display: "flex", flexDirection: "column", gap: 16 }}>
          <SL>SOLVER AYARLARI (GUROBI)</SL>
          <div>
            <label style={lStyle}>ZAMAN LİMİTİ (saniye)</label>
            <NumberInput style={iStyle} min={1} value={params.time_limit} onChange={n => setParams({ ...params, time_limit: n })} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{"Gurobi'nin maksimum çalışma süresi · varsayılan 300s (5 dk)"}</div>
          </div>
          <div>
            <label style={lStyle}>MIP GAP TOLERANSI</label>
            <NumberInput style={iStyle} step="0.01" min={0} value={params.mip_gap} onChange={n => setParams({ ...params, mip_gap: n })} />
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>0.10 = %10 tolerans · düşüldükçe çözüm daha optimal ama daha yavaş</div>
          </div>

          {/* No back-to-back toggle */}
          <button
            type="button"
            onClick={() => setParams(p => ({ ...p, no_back_to_back: !p.no_back_to_back }))}
            style={{
              background: params.no_back_to_back
                ? `color-mix(in srgb, ${C.accent} 8%, transparent)`
                : "var(--surface)",
              border: `1px solid ${params.no_back_to_back ? C.accent + "66" : C.border}`,
              borderRadius: 8,
              padding: "14px 16px",
              display: "flex",
              gap: 14,
              alignItems: "flex-start",
              cursor: "pointer",
              textAlign: "left",
              width: "100%",
              transition: "all 140ms ease-out",
            }}
          >
            <span style={{
              flexShrink: 0,
              marginTop: 2,
              width: 36,
              height: 20,
              borderRadius: 10,
              background: params.no_back_to_back ? C.accent : C.border,
              position: "relative",
              display: "inline-block",
              transition: "background 140ms ease-out",
            }}>
              <span style={{
                position: "absolute",
                top: 3,
                left: params.no_back_to_back ? 19 : 3,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: "#fff",
                display: "inline-block",
                transition: "left 140ms ease-out",
              }} />
            </span>
            <span style={{ display: "inline-block" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>Arka Arkaya Sınav Engeli</span>
                {params.no_back_to_back && (
                  <span style={{
                    fontSize: "0.6rem",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    padding: "2px 7px",
                    borderRadius: 4,
                    background: `color-mix(in srgb, ${C.red} 14%, transparent)`,
                    color: C.red,
                    border: `1px solid color-mix(in srgb, ${C.red} 35%, transparent)`,
                  }}>
                    HARD KISIT
                  </span>
                )}
              </span>
              <span style={{ display: "block", fontSize: 12, color: C.textMuted, lineHeight: 1.65 }}>
                Aynı bölüm öğrencilerinin iki sınavının ardışık slotlara denk gelmesini engeller.
                Öğrenci dostu çizelgeler üretir; ancak hard kısıt olarak uygulandığından
                <span style={{ color: params.no_back_to_back ? C.amber : C.textMuted }}> çözüm süresi önemli ölçüde uzayabilir.</span>
              </span>
            </span>
          </button>

          {submitErr && !isRunning && <ErrorBox msg={submitErr} />}
        </Card>
      </div>

      {/* ── LLM changes checklist ─────────────────────────────── */}
      {appliedChanges && (
        <div style={{ marginTop: 20, border: `1px solid color-mix(in srgb, ${C.cyan} 30%, transparent)`, borderRadius: 8, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", background: C.cyanSoft, borderBottom: `1px solid color-mix(in srgb, ${C.cyan} 20%, transparent)` }}>
            <span style={{ fontSize: 10, color: C.cyan, ...mono, letterSpacing: "0.08em", fontWeight: 700 }}>UYGULANACAK DEĞİŞİKLİKLER</span>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontSize: 11, color: C.textMuted, ...mono }}>
                {appliedChanges.filter(c => c.checked && !isCalendarOverridden(c.code)).length}/{appliedChanges.filter(c => !isCalendarOverridden(c.code)).length} seçili
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
          {appliedChanges.map((ch, i) => {
            const ignored = isCalendarOverridden(ch.code);
            return (
            <div
              key={i}
              onClick={ignored ? undefined : () => setAppliedChanges(prev => prev!.map((c, j) => j === i ? { ...c, checked: !c.checked } : c))}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 14,
                padding: "14px 16px",
                borderLeft: `4px solid ${ignored ? C.border : (ch.checked ? C.cyan : C.border)}`,
                borderBottom: i < appliedChanges.length - 1 ? `1px solid ${C.border}` : "none",
                background: "var(--surface)",
                opacity: ignored ? 0.5 : (ch.checked ? 1 : 0.4),
                cursor: ignored ? "not-allowed" : "pointer",
                transition: "opacity 140ms ease-out, border-color 140ms ease-out",
              }}
            >
              <input
                type="checkbox"
                checked={ignored ? false : ch.checked}
                disabled={ignored}
                onChange={() => setAppliedChanges(prev => prev!.map((c, j) => j === i ? { ...c, checked: !c.checked } : c))}
                onClick={e => e.stopPropagation()}
                style={{ marginTop: 3, accentColor: C.cyan, flexShrink: 0, width: 16, height: 16, cursor: ignored ? "not-allowed" : "pointer" }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: C.text, fontWeight: 600, textDecoration: ignored ? "line-through" : "none" }}>
                    {ch.reason || `${getFriendlyParamLabel(ch.code)} → ${typeof ch.value === "object" && ch.value !== null ? JSON.stringify(ch.value) : String(ch.value)}`}
                  </span>
                  {ignored && (
                    <span style={{ ...mono, fontSize: 10, color: C.amber, background: `color-mix(in srgb, ${C.amber} 12%, transparent)`, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.04em" }}>
                      Takvimden alınıyor — yok sayılır
                    </span>
                  )}
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 20, display: "flex", gap: 12, alignItems: "center" }}>
        <button
          type="button"
          onClick={submit} disabled={isRunning}
          style={{ background: isRunning ? C.accentSoft : C.accent, color: isRunning ? C.accent : "#fff", border: "none", borderRadius: 8, padding: "13px 32px", cursor: isRunning ? "not-allowed" : "pointer", ...mono, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 10, transition: "background 0.2s" }}
        >
          {isRunning ? <><Spinner size={14} color={C.accent} /> Çalışıyor…</> : "▶  Optimizasyonu Başlat"}
        </button>
      </div>

      {/* ── Custom Reset Confirmation Modal ────────────────────── */}
      {showResetConfirm && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          background: "rgba(0, 0, 0, 0.65)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
        }}>
          <div style={{
            background: "var(--surface)",
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: "24px",
            maxWidth: 420,
            width: "90%",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2)",
            textAlign: "center"
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              background: `color-mix(in srgb, ${C.red} 10%, transparent)`,
              color: C.red,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              margin: "0 auto 16px"
            }}>
              ↺
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: C.text, margin: "0 0 10px", ...mono }}>Varsayılana Sıfırla</h3>
            <p style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.6, margin: "0 0 20px" }}>
              Tüm optimizer ayarlarını, el ile belirlediğiniz parametreleri ve yapılmış olan AI değişikliklerini sıfırlamak istediğinize emin misiniz? Bu işlem geri alınamaz.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => setShowResetConfirm(false)}
                style={{
                  background: "transparent",
                  color: C.text,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  ...mono,
                  transition: "background 0.15s"
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "var(--surface-hover)"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={confirmReset}
                style={{
                  background: C.red,
                  color: "#fff",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 20px",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  ...mono,
                  transition: "background 0.15s"
                }}
                onMouseEnter={e => { e.currentTarget.style.background = `color-mix(in srgb, ${C.red} 85%, #000)`; }}
                onMouseLeave={e => { e.currentTarget.style.background = C.red; }}
              >
                Evet, Sıfırla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

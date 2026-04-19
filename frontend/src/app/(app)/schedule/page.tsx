"use client";
import React from "react";
import { C, mono } from "@/lib/colors";
import { useFetch, api } from "@/lib/api";
import { useSearchParams } from "next/navigation";
import { Spinner, InfoBox, Badge, PageContainer, PageHeader, ActionButton } from "@/components/ui";
import { Suspense } from "react";

function ScheduleContent() {
// ... (existing state and logic remains the same)
  const searchParams = useSearchParams();
  const solId = searchParams.get("id");
  const [bestSol, setBestSol] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);
  const [deptFilter, setDeptFilter] = React.useState<string>("");
  const [showConflicts, setShowConflicts] = React.useState(false);

  React.useEffect(() => {
    const fetchSol = async () => {
      try {
        if (solId) {
          const res = await api.get(`/optimize/${solId}/result/`);
          setBestSol(res);
        } else {
          const historyRes = await api.get("/optimize/history/");
          const histories = historyRes.results || historyRes || [];
          const DONE = ["COMPLETED","OPTIMAL","FEASIBLE","FEASIBLE (TIME LIMIT)"];
          const latestCompleted = histories.find((h: any) => DONE.includes(h.status));
          if (latestCompleted && latestCompleted.id) {
            const res = await api.get(`/optimize/${latestCompleted.id}/result/`);
            setBestSol(res);
          }
        }
      } catch (e) {
        console.error("Fetch error:", e);
      } finally {
        setLoading(false);
      }
    };
    fetchSol();
  }, [solId]);

  const allAssignments = (bestSol?.schedule || bestSol?.detailed_schedule || []) as any[];
  const depts = Array.from(new Set(allAssignments.map((a: any) => a.department || a.dept || "").filter(Boolean))).sort() as string[];
  const assignments = deptFilter ? allAssignments.filter((a: any) => (a.department || a.dept || "") === deptFilter) : allAssignments;
  const penalties = (bestSol?.penalties || []) as any[];

  const grouped: any = {};
  assignments.forEach((a: any) => {
    const d = a.day || a.date || "Unknown Day";
    const t = a.time || a.start_time || "—";
    const name = a.course_name || a.name || "Unknown Course";
    const code = a.code || a.course_code || "";
    if (!grouped[d]) grouped[d] = {};
    if (!grouped[d][t]) grouped[d][t] = {};
    const cKey = `${code}_${name}`;
    if (!grouped[d][t][cKey]) {
      grouped[d][t][cKey] = { code, name, rooms: [] };
    }
    const rLabel = a.room || a.resource_name || "—";
    if (!grouped[d][t][cKey].rooms.includes(rLabel)) grouped[d][t][cKey].rooms.push(rLabel);
  });

  const sortedDays = Object.keys(grouped).sort((a: string, b: string) => {
    const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const idxA = order.findIndex(o => a.includes(o));
    const idxB = order.findIndex(o => b.includes(o));
    return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
  });

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    let tableHtml = `<html><head><style>body{font-family:'Times New Roman',serif;padding:40px;color:#000;background:#fff;} h1{text-align:center;text-decoration:underline;margin-bottom:30px;} table{width:100%;border-collapse:collapse;margin-top:10px;} th,td{border:1px solid #333;padding:10px;text-align:center;} th{background:#fdfdfd;font-size:14px;font-weight:bold;} .course-name-main{font-weight:900;font-size:15px;margin-bottom:2px;} .course-code-sub{font-size:11px;color:#666;font-weight:bold;} @media print{body{padding:0;}}</style></head><body><h1>Exam Schedule</h1><table><thead><tr><th style="width:20%">Date</th><th style="width:15%">Time</th><th style="width:35%">Course Name</th><th style="width:30%">Place</th></tr></thead><tbody>`;
    sortedDays.forEach(day => {
      const times = Object.keys(grouped[day]).sort();
      let totalRows = 0; times.forEach(t => { totalRows += Object.keys(grouped[day][t]).length; });
      times.forEach((time, tIdx) => {
        const courses = Object.keys(grouped[day][time]);
        courses.forEach((cKey, cIdx) => {
          const course = grouped[day][time][cKey];
          tableHtml += `<tr>`;
          if (tIdx === 0 && cIdx === 0) tableHtml += `<td rowspan="${totalRows}">${day}</td>`;
          if (cIdx === 0) tableHtml += `<td rowspan="${courses.length}">${time}</td>`;
          tableHtml += `<td style="text-align:left;padding:10px 15px;"><div class="course-name-main">${course.name.toUpperCase()}</div><div class="course-code-sub">${course.code}</div></td><td>${course.rooms.join(", ")}</td></tr>`;
        });
      });
    });
    tableHtml += `</tbody></table><script>window.print();</script></body></html>`;
    printWindow.document.write(tableHtml); printWindow.document.close();
  };

  return (
    <PageContainer>
      <PageHeader
        title="Sınav Çizelgesi"
        subtitle={bestSol ? `${bestSol.name} • ${bestSol.status}` : "Yükleniyor..."}
        actions={
          <>
            {bestSol && (
              <ActionButton 
                onClick={() => setShowConflicts(!showConflicts)} 
                variant={showConflicts ? "danger" : "secondary"}
                icon={showConflicts ? "✕" : "🚩"}
              >
                {showConflicts ? "Kapat" : `Çakışmalar (${penalties.length})`}
              </ActionButton>
            )}
            {assignments.length > 0 && (
              <ActionButton onClick={handlePrint} icon="📥">
                Yazdır / PDF
              </ActionButton>
            )}
            {depts.length > 0 && (
              <select 
                value={deptFilter} 
                onChange={e => setDeptFilter(e.target.value)} 
                style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 16px", color: C.text, ...mono, fontSize: 13, outline: "none" }}
              >
                <option value="">TÜM BÖLÜMLER</option>
                {depts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            )}
          </>
        }
      />

      {showConflicts && (
        <div style={{ background: "#1a0b0b", border: `1px solid #e0555544`, borderRadius: 12, padding: 24, marginBottom: 32 }}>
          <h3 style={{ margin: "0 0 16px", fontSize: 18, color: "#e05555", fontWeight: 800, ...mono }}>Çakışma ve Dağılım Detayları</h3>
          {penalties.length === 0 ? (
            <p style={{ color: C.green, fontSize: 14 }}>Mükemmel! Bu senaryoda herhangi bir çakışma veya öğrenci yükü uyarısı bulunmamaktadır.</p>
          ) : (
            <div style={{ maxHeight: 300, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {penalties.map((p, i) => (
                <div key={i} style={{ background: "#ffffff04", padding: "10px 16px", borderRadius: 6, borderLeft: `3px solid #e0555588`, fontSize: 13, color: C.text }}>
                  {p.desc}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", minHeight: 400, justifyContent: "center" }}><Spinner size={32} /></div>}
      {!loading && !bestSol && <InfoBox msg="Henüz tamamlanmış bir çözüm yok." />}

      {!loading && bestSol && assignments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          {sortedDays.map(day => (
            <div key={day} style={{ display: "flex", flexDirection: "column", border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", background: "#0d0e1a" }}>
              <div style={{ background: "#1a1c35", padding: "14px 24px", borderBottom: `1px solid ${C.border}` }}>
                <h3 style={{ margin: 0, fontSize: 18, color: "#fff", fontWeight: 800, ...mono }}>{day.toUpperCase()}</h3>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr style={{ background: "#ffffff04" }}>
                  <th style={{ textAlign: "left", padding: "12px 24px", fontSize: 11, ...mono, color: C.textMuted, borderBottom: `1px solid ${C.border}`, width: "20%" }}>ZAMAN</th>
                  <th style={{ textAlign: "left", padding: "12px 24px", fontSize: 11, ...mono, color: C.textMuted, borderBottom: `1px solid ${C.border}`, width: "45%" }}>DERS ADI / BİLGİSİ</th>
                  <th style={{ textAlign: "left", padding: "12px 24px", fontSize: 11, ...mono, color: C.textMuted, borderBottom: `1px solid ${C.border}`, width: "35%" }}>SINAV YERİ</th>
                </tr></thead>
                <tbody>{Object.keys(grouped[day]).sort().map(time => (
                  <React.Fragment key={time}>{Object.keys(grouped[day][time]).map((cKey, cIdx) => {
                    const course = grouped[day][time][cKey];
                    return (
                      <tr key={cKey} style={{ borderBottom: `1px solid ${C.border}44`, background: cIdx % 2 === 0 ? "transparent" : "#ffffff01" }}>
                        {cIdx === 0 && <td rowSpan={Object.keys(grouped[day][time]).length} style={{ padding: "16px 24px", verticalAlign: "top", borderRight: `1px solid ${C.border}22`, color: C.cyan, fontWeight: 700, fontSize: 14 }}>{time}</td>}
                        <td style={{ padding: "16px 24px" }}>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{course.name.toUpperCase()}</div>
                          <div style={{ fontSize: 11, color: C.accent, fontWeight: 700, ...mono }}>{course.code}</div>
                        </td>
                        <td style={{ padding: "16px 24px" }}>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            {course.rooms.map((room: string) => <span key={room} style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, fontSize: 12, fontWeight: 700, padding: "6px 12px", borderRadius: 6 }}>{room}</span>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}</React.Fragment>
                ))}</tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}

export default function SchedulePage() {
  return (
    <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400 }}><Spinner size={32} /></div>}>
      <ScheduleContent />
    </Suspense>
  );
}

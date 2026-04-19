from collections import defaultdict
from django.db import connection
import logging
import os
import datetime
from core.models import Resource, Organization

logger = logging.getLogger(__name__)

DEFAULT_ROOMS: dict[str, int] = {
    "CZ08-09":   132 // 3, "C111-112":  135 // 3, "A222-224":  77 // 3,
    "A218-219":  80 // 3,  "A203-204":  72 // 3,  "A207-208":  72 // 3,
    "A319-320":  72 // 3,  "A315-316":  80 // 3,  "A303-304":  68 // 3,
    "B310":      35 // 3,  "A307-308":  108 // 3, "C406":      48 // 3,
    "B413-414":  108 // 3, "C403-404":  84 // 3,  "A422-423":  96 // 3,
    "A414-415":  100 // 3, "C510":      56 // 3,  "C507":      48 // 3,
    "C506":      48 // 3,  "C501":      56 // 3,  "C502":      56 // 3,
    "C503-504":  84 // 3,  "B515-516":  125 // 3, "DB412":     156 // 3,
}

BASE_W_MM = 50.0
BASE_W_ME = 30.0
BASE_W_EE = 15.0
YEAR_DIFF_FACTOR = {0: 20.0, 1: 10.0, 2: 3.0, 3: 1.0}


class OptimizerService:
    """
    Planlama birimi: (ders × öğrencinin bölümü).
    Örn: PHYSICS I dersi Bilgisayar Müh. için ayrı, Yazılım Müh. için ayrı planlanır.
    Çakışmalar da aynı bölüm öğrencilerinin ortak aldığı dersler üzerinden hesaplanır.
    """

    def __init__(self, term_id: str):
        self.term_id = str(term_id)

    @staticmethod
    def get_dynamic_rooms() -> dict[str, int]:
        """
        Veritabanından odaları (Resources) yükler. 
        Eğer tablo boşsa DEFAULT_ROOMS ile doldurur.
        """
        org = Organization.objects.first()
        resources = Resource.objects.filter(organization=org) if org else Resource.objects.all()
        
        if not resources.exists():
            logger.info("Resource tablosu boş, DEFAULT_ROOMS ile dolduruluyor...")
            if not org:
                # Organizasyon yoksa oluştur (fallback)
                org = Organization.objects.create(name="Default Organization")
            
            new_resources = []
            for name, cap in DEFAULT_ROOMS.items():
                new_resources.append(Resource(
                    organization=org,
                    name=name,
                    capacity=cap,
                    type='CLASSROOM'
                ))
            Resource.objects.bulk_create(new_resources)
            return DEFAULT_ROOMS
            
        return {r.name: r.capacity for r in resources}

    def _dictfetchall(self, cursor):
        desc = cursor.description
        return [dict(zip([col[0] for col in desc], row)) for row in cursor.fetchall()]

    def load_courses(self) -> list[dict]:
        """
        Her (ders, öğrenci_bölümü) çifti için bir satır döner.
        enrolled_count = o bölümden o derse kayıtlı öğrenci sayısı.
        """
        with connection.cursor() as cur:
            cur.execute("""
                SELECT
                    cc.id::text                   AS course_id,
                    cc.code,
                    cc.name,
                    cc.requirement::text          AS requirement,
                    cc.year_level,
                    cc.weekly_hours_lecture       AS weekly_hours,
                    au_course.name                AS course_dept,
                    sg.academic_unit_id::text     AS student_dept_id,
                    au_student.name               AS student_dept,
                    COUNT(DISTINCT e.student_id)  AS enrolled_count
                FROM enrollment e
                JOIN course_section cs      ON e.section_id = cs.id
                JOIN course_catalog cc      ON cs.course_id = cc.id
                JOIN student st            ON e.student_id = st.id
                JOIN student_group sg       ON st.student_group_id = sg.id
                JOIN academic_unit au_student ON sg.academic_unit_id = au_student.id
                JOIN academic_unit au_course  ON cc.academic_unit_id = au_course.id
                WHERE cc.year_level IS NOT NULL
                  AND cc.requirement IS NOT NULL
                  AND cc.name NOT ILIKE '%%graduation%%'
                GROUP BY cc.id, cc.code, cc.name, cc.requirement, cc.year_level,
                         cc.weekly_hours_lecture, au_course.name,
                         sg.academic_unit_id, au_student.name
                HAVING COUNT(DISTINCT e.student_id) > 0
                ORDER BY au_student.name, cc.year_level, cc.name
            """)
            rows = self._dictfetchall(cur)
            # Her satıra benzersiz birim anahtarı ekle
            for r in rows:
                r["unit_key"] = f"{r['course_id']}|{r['student_dept_id']}"
            return rows

    def load_conflict_matrix(self) -> dict:
        """
        Aynı bölüm öğrencilerinin ortak aldığı ders çiftlerini bulur.
        Anahtar: (unit_key_a, unit_key_b)  —  unit_key = course_id|dept_id
        """
        with connection.cursor() as cur:
            cur.execute("""
                SELECT
                    sa.course_id::text            AS ca,
                    sb.course_id::text            AS cb,
                    sg.academic_unit_id::text     AS dept_id,
                    COUNT(DISTINCT e1.student_id) AS shared
                FROM enrollment e1
                JOIN enrollment e2          ON e1.student_id = e2.student_id
                JOIN course_section sa       ON e1.section_id = sa.id
                JOIN course_section sb       ON e2.section_id = sb.id
                JOIN student st             ON e1.student_id = st.id
                JOIN student_group sg        ON st.student_group_id = sg.id
                WHERE sa.course_id <> sb.course_id
                GROUP BY sa.course_id, sb.course_id, sg.academic_unit_id
                HAVING COUNT(DISTINCT e1.student_id) > 0
            """)
            conflict_dict = {}
            for r in self._dictfetchall(cur):
                key_a = f"{r['ca']}|{r['dept_id']}"
                key_b = f"{r['cb']}|{r['dept_id']}"
                pair = (min(key_a, key_b), max(key_a, key_b))
                # Aynı çift birden fazla satırda gelebilir, en büyüğünü al
                conflict_dict[pair] = max(conflict_dict.get(pair, 0), int(r["shared"]))
            return conflict_dict

    def solve(self, hard_threshold: int = 5, time_limit: int = 300, mip_gap: float = 0.10,
              no_back_to_back: bool = False, exam_days: int = 5, slots_per_day: int = 10,
              start_hour: int = 8) -> dict:
        try:
            import gurobipy as gp
            from gurobipy import GRB, quicksum
        except ImportError:
            raise Exception("Gurobipy module not found. Please install gurobipy and configure licenses.")

        rooms = self.get_dynamic_rooms()
        courses = self.load_courses()
        conflicts = self.load_conflict_matrix()

        n_slots = exam_days * slots_per_day
        slot_starts = [f"{start_hour+i:02d}:30" for i in range(slots_per_day)]
        slot_ends   = [f"{start_hour+1+i:02d}:30" for i in range(slots_per_day)]
        default_days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        day_labels = [default_days[i % 7] if exam_days <= 7 else f"Day {i+1}" for i in range(exam_days)]

        # info dict: unit_key -> row data
        info = {r["unit_key"]: r for r in courses}
        C = list(info.keys())

        logger.info(f"Optimizer: {len(C)} scheduling units (course×dept), {len(conflicts)} conflict pairs")

        # Determine Durations (1-hour blocks)
        for c in C:
            hours = info[c].get("weekly_hours") or 0
            dur = 3 if hours >= 4 else (1 if 0 < hours <= 2 else 2)
            info[c]["duration"] = dur

        def valid_starts(c):
            dur = info[c]["duration"]
            return [s for s in range(n_slots) if (s % slots_per_day) + dur <= slots_per_day]

        # Group by (student_dept, year_level) for no-back-to-back
        groups = defaultdict(list)
        for c in C:
            groups[(info[c]["student_dept"], info[c]["year_level"])].append(c)

        # Short label for constraint naming (avoid 100-char UUID names)
        short = {}
        for i, c in enumerate(C):
            short[c] = f"{info[c]['code']}_{info[c]['student_dept'][:6]}_{i}"

        # --- Gurobi Environment ---
        env = gp.Env(empty=True)
        wls_access = os.getenv("GRB_WLSACCESSID")
        wls_secret = os.getenv("GRB_WLSSECRET")
        license_id = os.getenv("GRB_LICENSEID")

        if wls_access and wls_secret and license_id:
            env.setParam("WLSACCESSID", wls_access)
            env.setParam("WLSSECRET", wls_secret)
            env.setParam("LICENSEID", int(license_id))

        env.setParam("OutputFlag", 0)
        env.start()
        m = gp.Model("exam_scheduling", env=env)

        # Variables
        y = {}
        for c in C:
            for s in valid_starts(c):
                y[(c, s)] = m.addVar(vtype=GRB.BINARY, name=f"y[{short[c]},{s}]")

        x_start = {}
        for c in C:
            for r in rooms:
                for s in valid_starts(c):
                    x_start[(c, r, s)] = m.addVar(vtype=GRB.BINARY, name=f"x[{short[c]},{r},{s}]")

        m.update()

        # === Hard Constraints ===

        # 1. Every unit must be assigned exactly one start slot
        for c in C:
            m.addConstr(quicksum(y[(c, s)] for s in valid_starts(c)) == 1,
                        name=f"one_start[{short[c]}]")

        # 2. Room capacity must cover enrolled students
        for c in C:
            enrolled = info[c]["enrolled_count"]
            for s in valid_starts(c):
                m.addConstr(
                    quicksum(x_start[(c, r, s)] * rooms[r] for r in rooms) >= enrolled * y[(c, s)],
                    name=f"cap[{short[c]},{s}]")
                for r in rooms:
                    m.addConstr(x_start[(c, r, s)] <= y[(c, s)],
                                name=f"link[{short[c]},{r},{s}]")

        # 3. One exam per room per time unit
        def v_expr(c, t):
            dur = info[c]["duration"]
            return quicksum(y[(c, s)] for s in valid_starts(c) if s <= t < s + dur)

        for r in rooms:
            for t in range(n_slots):
                occupied = quicksum(
                    x_start[(c, r, s)] for c in C
                    for s in valid_starts(c) if s <= t < s + info[c]["duration"])
                m.addConstr(occupied <= 1, name=f"room_busy[{r},{t}]")

        minimize_rooms_used = quicksum(x_start.values()) * 0.01

        # 4. Hard conflict: courses sharing > threshold students can't overlap
        hard_pairs = set()
        for (ua, ub), shared in conflicts.items():
            if ua not in info or ub not in info:
                continue
            if shared <= hard_threshold:
                continue
            pair = (min(ua, ub), max(ua, ub))
            hard_pairs.add(pair)
            for t in range(n_slots):
                m.addConstr(v_expr(ua, t) + v_expr(ub, t) <= 1,
                            name=f"hard[{short[ua]}_{short[ub]}_{t}]")

        # 5. No back-to-back (optional)
        if no_back_to_back:
            for (dept, year), group_courses in groups.items():
                for t in range(1, n_slots):
                    if t % slots_per_day == 0:
                        continue
                    ending = [y[(c, t - info[c]["duration"])]
                              for c in group_courses if (c, t - info[c]["duration"]) in y]
                    starting = [y[(c, t)]
                                for c in group_courses if (c, t) in y]
                    if ending and starting:
                        m.addConstr(quicksum(ending) + quicksum(starting) <= 1,
                                    name=f"no_btb[{dept[:8]},{year},{t}]")

        # === Soft Constraints ===
        conflict_vars = []
        # A. Student Overlap Penalty (Same slot overlap)
        for (ua, ub), shared in conflicts.items():
            if shared > hard_threshold or ua not in info or ub not in info:
                continue

            req_a, req_b = info[ua]["requirement"], info[ub]["requirement"]
            yr_a, yr_b = info[ua]["year_level"], info[ub]["year_level"]

            # Base weight for overlap
            base = (BASE_W_MM if req_a == req_b == "COMPULSORY"
                    else (BASE_W_ME if "COMPULSORY" in (req_a, req_b) else BASE_W_EE))
            w = base * YEAR_DIFF_FACTOR.get(abs(yr_a - yr_b), 0.5) * (shared / hard_threshold)

            for t in range(n_slots):
                z = m.addVar(vtype=GRB.BINARY, name=f"z[{short[ua]},{short[ub]},{t}]")
                m.addConstr(z >= v_expr(ua, t) + v_expr(ub, t) - 1)
                desc = f"{info[ua]['code']} ve {info[ub]['code']} dersleri çakışıyor ({shared} ortak öğrenci)."
                conflict_vars.append({
                    "var": z, "weight": w, "ua": ua, "ub": ub, "t": t, 
                    "shared": shared, "desc": desc, "type": "OVERLAP"
                })

        # B. Daily Spread Penalty (Same day penalty)
        # Groups: (dept, year) -> students having multiple exams in a single day
        SAME_DAY_W = 200.0
        daily_spread_vars = []
        for (dept, year), group_courses in groups.items():
            if len(group_courses) < 2: continue
            for d in range(exam_days):
                # z_day is 1 if >1 exam in day d for this group
                active_days = [quicksum(y[(c, s)] for s in valid_starts(c) if s // slots_per_day == d)
                              for c in group_courses]
                if not active_days: continue
                
                z_day = m.addVar(vtype=GRB.INTEGER, name=f"z_day[{dept[:5]},{year},{d}]")
                m.addConstr(z_day >= quicksum(active_days) - 1)
                m.addConstr(z_day >= 0)
                
                desc = f"{dept} {year}. Sınıf öğrencilerinin aynı gün ({day_labels[d]}) birden fazla sınavı var."
                daily_spread_vars.append({
                    "var": z_day, "weight": SAME_DAY_W, "d": d, "dept": dept, "year": year, "desc": desc
                })

        # === Objective ===
        m.setObjective(
            quicksum(cv["weight"] * cv["var"] for cv in conflict_vars) +
            quicksum(dv["weight"] * dv["var"] for dv in daily_spread_vars) +
            minimize_rooms_used,
            GRB.MINIMIZE)
        m.Params.MIPGap = mip_gap
        m.Params.MIPFocus = 1
        m.Params.NoRelHeurTime = 120
        m.Params.TimeLimit = time_limit

        m.optimize()

        # === Build Output ===
        if m.SolCount == 0:
            return self._build_infeasible_result(m, C, info, conflicts, hard_pairs, n_slots, short)

        schedule = []
        for c in info:
            dur = info[c]["duration"]
            slots_valid = [s for s in range(n_slots) if (c, s) in y and y[(c, s)].X > 0.5]
            if not slots_valid:
                continue
            start_s = slots_valid[0]
            day, session = start_s // slots_per_day, start_s % slots_per_day

            for r in rooms:
                if (c, r, start_s) in x_start and x_start[(c, r, start_s)].X > 0.5:
                    schedule.append({
                        "start_slot": start_s, "duration": dur,
                        "day": day_labels[day],
                        "time": f"{slot_starts[session]}-{slot_ends[session + dur - 1]}",
                        "room": r, "room_cap": rooms[r],
                        "enrolled": info[c]["enrolled_count"],
                        "course_id": info[c]["course_id"],
                        "code": info[c]["code"],
                        "course_name": info[c]["name"],
                        "dept": info[c]["student_dept"],
                        "year": info[c]["year_level"],
                        "requirement": info[c]["requirement"],
                    })

        schedule.sort(key=lambda x: (x["start_slot"], x["room"]))

        penalties = []
        total_penalty = 0.0
        # Add Overlap Penalties
        for cv in conflict_vars:
            if cv["var"].X > 0.5:
                total_penalty += cv["weight"] * cv["var"].X
                day, session = cv["t"] // slots_per_day, cv["t"] % slots_per_day
                penalties.append({
                    "desc": cv["desc"],
                    "penalty": round(cv["weight"] * cv["var"].X, 1),
                    "day": day_labels[day],
                    "type": "ÇAKIŞMA"
                })
        
        # Add Daily Spread Penalties
        for dv in daily_spread_vars:
            if dv["var"].X > 0.5:
                # Find which specific courses from this group are on this specific day
                day_courses = [s["code"] for s in schedule 
                               if s["dept"] == dv["dept"] and s["year"] == dv["year"] and s["day"] == day_labels[dv["d"]]]
                
                # can be 1 (double exam), 2 (triple exam) etc.
                val = round(dv["var"].X)
                total_penalty += dv["weight"] * val
                
                course_str = " ve ".join(day_courses) if day_courses else dv["dept"]
                refined_desc = f"{course_str} dersleri aynı güne ({day_labels[dv['d']]}) planlandı."
                
                penalties.append({
                    "desc": refined_desc,
                    "penalty": round(dv["weight"] * val, 1),
                    "day": day_labels[dv["d"]],
                    "type": "YAYILIM"
                })

        status_map = {
            GRB.OPTIMAL: "optimal",
            GRB.SUBOPTIMAL: "feasible",
            GRB.TIME_LIMIT: "feasible (time limit)",
            GRB.INFEASIBLE: "infeasible",
        }

        return {
            "schedule": schedule,
            "penalties": penalties,
            "stats": {
                "scheduling_units": len(info),
                "conflicts_total": len(conflicts),
                "hard_conflict_pairs": len(hard_pairs),
                "obj_value": round(m.objVal, 2),
                "total_penalty": round(total_penalty, 2),
                "mip_gap": round(m.MIPGap * 100, 2) if hasattr(m, "MIPGap") else None,
                "runtime_s": round(m.Runtime, 1) if hasattr(m, "Runtime") else None,
            },
            "status": status_map.get(m.Status, f"status_{m.Status}"),
        }

    # --------------- IIS Diagnostics ---------------
    def _build_infeasible_result(self, m, C, info, conflicts, hard_pairs, n_slots, short):
        diagnostics = {
            "summary": "Model çözümsüz (infeasible). Aşağıda çelişen kısıtların analizi verilmiştir.",
            "model_stats": {
                "total_scheduling_units": len(C),
                "total_conflicts": len(conflicts),
                "hard_conflict_pairs": len(hard_pairs),
                "total_slots": n_slots,
                "total_rooms": len(rooms),
                "total_room_capacity_per_slot": sum(rooms.values()),
                "max_enrolled_unit": max((info[c]["enrolled_count"], info[c]["code"], info[c]["student_dept"]) for c in C) if C else None,
            },
            "iis_constraints": [],
            "recommendations": []
        }

        try:
            m.computeIIS()
            iis_groups = {"hard": [], "cap": [], "room_busy": [], "one_start": [], "no_btb": [], "other": []}

            for constr in m.getConstrs():
                if constr.IISConstr:
                    name = constr.ConstrName
                    if name.startswith("hard["):
                        iis_groups["hard"].append(name)
                    elif name.startswith("cap["):
                        iis_groups["cap"].append(name)
                    elif name.startswith("room_busy["):
                        iis_groups["room_busy"].append(name)
                    elif name.startswith("one_start["):
                        iis_groups["one_start"].append(name)
                    elif name.startswith("no_btb["):
                        iis_groups["no_btb"].append(name)
                    else:
                        iis_groups["other"].append(name)

            for group_name, constraints in iis_groups.items():
                if constraints:
                    diagnostics["iis_constraints"].append({
                        "type": group_name,
                        "count": len(constraints),
                        "samples": constraints[:20]
                    })

            if iis_groups["hard"]:
                diagnostics["recommendations"].append(
                    f"{len(iis_groups['hard'])} adet Hard Conflict kısıtı çelişiyor. "
                    f"'hard_threshold' değerini artırmayı (örn: 10 veya 20) deneyin.")
            if iis_groups["room_busy"]:
                diagnostics["recommendations"].append(
                    f"{len(iis_groups['room_busy'])} adet oda meşguliyet kısıtı çelişiyor. "
                    f"'exam_days' sayısını artırmayı (örn: 7 veya 10) veya 'slots_per_day' yükseltmeyi deneyin.")
            if iis_groups["cap"]:
                diagnostics["recommendations"].append(
                    f"{len(iis_groups['cap'])} adet kapasite kısıtı çelişiyor. "
                    f"Oda kapasiteleri toplam kayıtlı öğrenci sayısı için yetersiz olabilir.")
            if iis_groups["no_btb"]:
                diagnostics["recommendations"].append(
                    f"{len(iis_groups['no_btb'])} adet arka-arkaya-sınav-yok kısıtı çelişiyor. "
                    f"'no_back_to_back' seçeneğini kapatmayı veya gün sayısını artırmayı deneyin.")
            if not diagnostics["recommendations"]:
                diagnostics["recommendations"].append(
                    "IIS analizi tamamlandı ancak spesifik bir öneri üretilemedi. Parametre kombinasyonunu gevşetmeyi deneyin.")

        except Exception as iis_err:
            diagnostics["iis_error"] = f"IIS hesaplanamadı: {str(iis_err)}"
            diagnostics["recommendations"].append(
                "IIS analizi başarısız. hard_threshold artırın, exam_days yükseltin veya no_back_to_back kapatın.")

        return {
            "schedule": [], "penalties": [],
            "stats": {"scheduling_units": len(info), "conflicts": len(conflicts), "obj_value": None, "total_penalty": 0},
            "diagnostics": diagnostics,
            "status": "infeasible"
        }

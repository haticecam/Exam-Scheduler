from collections import defaultdict
from django.db import connection
import logging
import os
import datetime
import time
from core.models import Resource, Organization

logger = logging.getLogger(__name__)

BASE_W_MM = 50.0
BASE_W_ME = 30.0
BASE_W_EE = 15.0
YEAR_DIFF_FACTOR = {0: 20.0, 1: 10.0, 2: 3.0, 3: 1.0}


def compute_year_bands(year_levels: list, exam_days: int, ordered_sequence: list = None) -> dict:
    """
    Divide exam_days into equal-width bands, one per distinct year level.
    Returns {year_level: (day_start_inclusive, day_end_exclusive)}.
    Returns empty dict if fewer than 2 distinct year levels.

    If ordered_sequence is given, assigns bands in that explicit order (first item
    gets the earliest band). Year levels present in year_levels but absent from
    ordered_sequence are appended in ascending order after the listed ones.
    """
    all_levels = set(year_levels)
    if ordered_sequence:
        # Only pin listed years to specific bands. Unlisted years get no band
        # entry and are left completely free for the optimizer to place optimally.
        # Band size is derived from the total year count so widths stay proportional.
        listed = [yr for yr in ordered_sequence if yr in all_levels]
        if not listed:
            return {}
        n_total = len(all_levels)
        band_size = exam_days / n_total
        all_listed = len(listed) == n_total
        bands = {}
        for i, yr in enumerate(listed):
            day_start = int(i * band_size)
            day_end = exam_days if (all_listed and i == len(listed) - 1) else int((i + 1) * band_size)
            bands[yr] = (day_start, day_end)
        return bands
    else:
        levels = sorted(all_levels)
        n = len(levels)
        if n < 2:
            return {}
        band_size = exam_days / n
        bands = {}
        for i, yr in enumerate(levels):
            day_start = int(i * band_size)
            day_end = int((i + 1) * band_size) if i < n - 1 else exam_days
            bands[yr] = (day_start, day_end)
        return bands


_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def _room_allowed_on_day(room: dict, day_index: int, weekday_str: str = None) -> bool:
    """Return True if room has no day restriction or the weekday is in allowed_days."""
    allowed = room.get("allowed_days")
    if not allowed:
        return True
    wd = weekday_str if weekday_str else _WEEKDAYS[day_index % 7]
    return wd in allowed


def _room_allowed_for_unit(room: dict, student_dept_id: str) -> bool:
    """Return True if room has no unit restriction or the dept is in allowed_unit_ids."""
    allowed = room.get("allowed_unit_ids")
    if not allowed:
        return True
    return student_dept_id in allowed


class OptimizerService:
    """
    Scheduling unit: (course × student's department).
    e.g. PHYSICS I for CS students is planned independently from PHYSICS I for SE students.
    Conflicts are computed over courses shared by students in the same department.
    """

    def __init__(self, term_id: str):
        self.term_id = str(term_id)

    def load_rooms(self) -> dict[str, dict]:
        """
        Load active exam rooms for this term's organization from the Resource table.
        Returns dict: room_name → {"capacity": int, "allowed_days": list|None, "allowed_unit_ids": list|None}
        Raises ValueError if no rooms are configured.
        """
        from core.models import Term, Resource
        try:
            term = Term.objects.select_related('organization').get(id=self.term_id)
        except Term.DoesNotExist:
            raise ValueError(f"Term {self.term_id} not found.")

        resources = Resource.objects.filter(
            organization=term.organization,
            type__in=['CLASSROOM', 'AMPHITHEATER'],
            is_active=True,
            exam_capacity__isnull=False
        ).values('name', 'exam_capacity', 'availability')

        rooms = {}
        for r in resources:
            avail = r['availability'] or {}
            rooms[r['name']] = {
                "capacity": r['exam_capacity'],
                "allowed_days": avail.get('allowed_days') or None,
                "allowed_unit_ids": avail.get('allowed_unit_ids') or None,
            }

        if not rooms:
            raise ValueError(
                f"No active exam rooms found for organization '{term.organization.name}'. "
                f"Run: python manage.py seed_rooms --org_id {term.organization.id}"
            )
        return rooms

    def _dictfetchall(self, cursor):
        desc = cursor.description
        return [dict(zip([col[0] for col in desc], row)) for row in cursor.fetchall()]

    def load_courses(self) -> list[dict]:
        """
        Returns one row per (course, student_dept) pair.
        enrolled_count = number of students from that dept enrolled in this course.
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
            for r in rows:
                r["unit_key"] = f"{r['course_id']}|{r['student_dept_id']}"
            return rows

    def load_conflict_matrix(self) -> dict:
        """
        Find course pairs shared by students in the same department.
        Key: (unit_key_a, unit_key_b) where unit_key = course_id|dept_id
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
                conflict_dict[pair] = max(conflict_dict.get(pair, 0), int(r["shared"]))
            return conflict_dict

    def load_exam_calendar(self, exam_period_id: str) -> dict:
        """
        Derive optimizer grid parameters from a saved ExamPeriod.
        Returns dict with: exam_days, slots_per_day, start_hour,
        blocked_slot_indices, day_weekday_map, day_date_labels,
        slot_starts, slot_ends, session_mode.
        """
        from core.models import ExamPeriod, ExamDateSlot

        try:
            period = ExamPeriod.objects.get(id=exam_period_id)
        except ExamPeriod.DoesNotExist:
            raise ValueError(f"ExamPeriod {exam_period_id} not found")

        slots_qs = list(
            ExamDateSlot.objects.filter(exam_period=period).order_by("date", "start_time")
        )
        if not slots_qs:
            raise ValueError(
                f"No slots generated for ExamPeriod {exam_period_id}. "
                "Call POST /api/exam-periods/{id}/generate-slots/ first."
            )

        # Unique, ordered time values that define one day's grid
        all_start_times = sorted(set(s.start_time for s in slots_qs))
        end_time_by_start = {}
        for s in slots_qs:
            end_time_by_start.setdefault(s.start_time, s.end_time)

        slots_per_day = len(all_start_times)
        start_idx_map = {t: i for i, t in enumerate(all_start_times)}
        start_hour = all_start_times[0].hour if all_start_times else 8

        # Active dates = dates with at least one non-blocked slot
        active_dates = sorted(set(s.date for s in slots_qs if not s.is_blocked))
        if not active_dates:
            raise ValueError("All exam slots are blocked. Unblock at least one slot.")

        date_to_day_idx = {d: i for i, d in enumerate(active_dates)}
        exam_days = len(active_dates)

        weekday_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        day_weekday_map = {i: weekday_names[d.weekday()] for i, d in enumerate(active_dates)}
        day_date_labels = [
            f"{weekday_names[d.weekday()]} {d.strftime('%d/%m')}" for d in active_dates
        ]
        slot_starts = [t.strftime("%H:%M") for t in all_start_times]
        slot_ends = [end_time_by_start[t].strftime("%H:%M") for t in all_start_times]

        blocked_slot_indices: set[int] = set()
        for s in slots_qs:
            if s.date not in date_to_day_idx:
                continue  # fully-blocked day not in active set
            if s.is_blocked and s.start_time in start_idx_map:
                day_idx = date_to_day_idx[s.date]
                slot_within = start_idx_map[s.start_time]
                blocked_slot_indices.add(day_idx * slots_per_day + slot_within)

        # session_mode = True means each ExamDateSlot is a full exam session; dur=1 in optimizer
        session_mode = period.config.get("slot_mode") == "session"

        return {
            "exam_days": exam_days,
            "slots_per_day": slots_per_day,
            "start_hour": start_hour,
            "blocked_slot_indices": blocked_slot_indices,
            "day_weekday_map": day_weekday_map,
            "day_date_labels": day_date_labels,
            "slot_starts": slot_starts,
            "slot_ends": slot_ends,
            "session_mode": session_mode,
        }

    def solve(self, hard_threshold: int = 5, time_limit: int = None, mip_gap: float = 0.10,
              no_back_to_back: bool = False, no_back_to_back_depts: list = None,
              exam_days: int = 5, slots_per_day: int = 10,
              start_hour: int = 8, year_order_weight: float = 100.0,
              year_order_sequence: list = None, year_order_weights: dict = None,
              weight_config: dict = None,
              blocked_slot_indices: set = None,
              day_weekday_map: dict = None,
              day_date_labels: list = None,
              slot_starts_override: list = None,
              slot_ends_override: list = None,
              session_mode: bool = False) -> dict:
        try:
            import gurobipy as gp
            from gurobipy import GRB, quicksum
        except ImportError:
            raise Exception("gurobipy not found. Install gurobipy and configure a license.")

        wc = weight_config or {}
        w_mm = wc.get("BASE_W_MM", BASE_W_MM)
        w_me = wc.get("BASE_W_ME", BASE_W_ME)
        w_ee = wc.get("BASE_W_EE", BASE_W_EE)
        raw_ydf = wc.get("YEAR_DIFF_FACTOR", YEAR_DIFF_FACTOR)
        year_diff_factor = {int(k): v for k, v in raw_ydf.items()}

        ROOMS = self.load_rooms()

        rooms = ROOMS
        courses = self.load_courses()
        conflicts = self.load_conflict_matrix()

        n_slots = exam_days * slots_per_day
        def _fmt(minutes: int) -> str:
            return f"{minutes // 60:02d}:{minutes % 60:02d}"
        if slot_starts_override:
            slot_starts = slot_starts_override
            slot_ends = slot_ends_override
        else:
            base_min = start_hour * 60 + 30
            slot_starts = [_fmt(base_min + i * 30) for i in range(slots_per_day)]
            slot_ends   = [_fmt(base_min + (i + 1) * 30) for i in range(slots_per_day)]
        default_days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        day_labels = (
            day_date_labels if day_date_labels
            else [default_days[i % 7] if exam_days <= 7 else f"Day {i+1}" for i in range(exam_days)]
        )

        info = {r["unit_key"]: r for r in courses}
        C = list(info.keys())

        logger.info(f"Optimizer: {len(C)} scheduling units, {len(conflicts)} conflict pairs, {len(ROOMS)} rooms")

        for c in C:
            if session_mode:
                # Each user-defined session holds exactly one exam regardless of course length
                info[c]["duration"] = 1
            else:
                hours = info[c].get("weekly_hours") or 0
                # Exam lengths in minutes: ≤2 weekly hours→60 min, 3→120 min, ≥4→180 min
                # Each slot is 30 min, so multiply slot count by 2
                dur = 6 if hours >= 4 else (4 if hours == 3 else 2)
                info[c]["duration"] = dur

        def valid_starts(c):
            dur = info[c]["duration"]
            blocked = blocked_slot_indices or set()
            result = []
            for s in range(n_slots):
                if (s % slots_per_day) + dur > slots_per_day:
                    continue
                if any((s + k) in blocked for k in range(dur)):
                    continue
                result.append(s)
            return result

        groups = defaultdict(list)
        for c in C:
            groups[(info[c]["student_dept"], info[c]["year_level"])].append(c)

        year_band = {}
        if year_order_sequence:
            all_year_levels = [
                info[c]["year_level"] for c in C
                if info[c].get("year_level") is not None
            ]
            year_band = compute_year_bands(all_year_levels, exam_days, ordered_sequence=year_order_sequence)
            if year_band:
                logger.info(f"Year-band ordering active: {len(year_band)} bands over {exam_days} days, sequence={year_order_sequence}")

        short = {}
        for i, c in enumerate(C):
            short[c] = f"{info[c]['code']}_{info[c]['student_dept'][:6]}_{i}"

        env = gp.Env(empty=True)
        wls_access = os.getenv("GRB_WLSACCESSID")
        wls_secret = os.getenv("GRB_WLSSECRET")
        license_id = os.getenv("GRB_LICENSEID")

        if wls_access and wls_secret and license_id:
            env.setParam("WLSACCESSID", wls_access)
            env.setParam("WLSSECRET", wls_secret)
            env.setParam("LICENSEID", int(license_id))

        env.setParam("OutputFlag", 1)
        env.setParam("LogToConsole", 1)
        env.start()
        m = gp.Model("exam_scheduling", env=env)
        m.setParam("SoftMemLimit", 10)  # stop gracefully at 10 GB instead of being SIGKILL'd
        m.setParam("NodefileStart", 4)  # spill B&B nodes to disk when tree exceeds 4 GB
        t_build_start = time.perf_counter()

        y = {}
        for c in C:
            for s in valid_starts(c):
                y[(c, s)] = m.addVar(vtype=GRB.BINARY, name=f"y[{short[c]},{s}]")

        x_start = {}
        for c in C:
            dept_id = info[c]["student_dept_id"]
            for r in rooms:
                if not _room_allowed_for_unit(rooms[r], dept_id):
                    continue
                for s in valid_starts(c):
                    day_idx = s // slots_per_day
                    wd_str = day_weekday_map.get(day_idx) if day_weekday_map else None
                    if not _room_allowed_on_day(rooms[r], day_idx, wd_str):
                        continue
                    x_start[(c, r, s)] = m.addVar(vtype=GRB.BINARY, name=f"x[{short[c]},{r},{s}]")

        m.update()

        for c in C:
            m.addConstr(quicksum(y[(c, s)] for s in valid_starts(c)) == 1,
                        name=f"one_start[{short[c]}]")

        for c in C:
            enrolled = info[c]["enrolled_count"]
            for s in valid_starts(c):
                m.addConstr(
                    quicksum(x_start[(c, r, s)] * rooms[r]["capacity"]
                             for r in rooms if (c, r, s) in x_start) >= enrolled * y[(c, s)],
                    name=f"cap[{short[c]},{s}]")
                for r in rooms:
                    if (c, r, s) in x_start:
                        m.addConstr(x_start[(c, r, s)] <= y[(c, s)],
                                    name=f"link[{short[c]},{r},{s}]")

        def v_expr(c, t):
            dur = info[c]["duration"]
            return quicksum(y[(c, s)] for s in valid_starts(c) if s <= t < s + dur)

        for r in rooms:
            for t in range(n_slots):
                occupied = quicksum(
                    x_start[(c, r, s)] for c in C
                    for s in valid_starts(c)
                    if s <= t < s + info[c]["duration"] and (c, r, s) in x_start)
                if occupied.size() > 0:
                    m.addConstr(occupied <= 1, name=f"room_busy[{r},{t}]")

        minimize_rooms_used = quicksum(x_start.values()) * 0.01

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

        if no_back_to_back_depts:
            for (dept, year), group_courses in groups.items():
                if dept not in no_back_to_back_depts:
                    continue
                for t in range(1, n_slots):
                    if t % slots_per_day == 0:
                        continue
                    ending = [y[(c, t - info[c]["duration"])]
                              for c in group_courses if (c, t - info[c]["duration"]) in y]
                    starting = [y[(c, t)]
                                for c in group_courses if (c, t) in y]
                    if ending and starting:
                        m.addConstr(quicksum(ending) + quicksum(starting) <= 1,
                                    name=f"no_btb_dept[{dept[:8]},{year},{t}]")

        conflict_vars = []
        # A. Student Overlap Penalty (Same slot overlap)
        for (ua, ub), shared in conflicts.items():
            if shared > hard_threshold or ua not in info or ub not in info:
                continue

            req_a, req_b = info[ua]["requirement"], info[ub]["requirement"]
            yr_a, yr_b = info[ua]["year_level"], info[ub]["year_level"]

            # Base weight for overlap
            base = (w_mm if req_a == req_b == "COMPULSORY"
                    else (w_me if "COMPULSORY" in (req_a, req_b) else w_ee))
            w = base * year_diff_factor.get(abs(yr_a - yr_b), 0.5) * (shared / hard_threshold)

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

        # C. Year-Band Ordering Preference (linear penalty on existing y variables)
        year_order_terms = []
        if year_band:
            effective_weights = {int(k): v for k, v in year_order_weights.items()} if year_order_weights else {}
            for c in C:
                yr = info[c].get("year_level")
                if yr is None or yr not in year_band:
                    continue
                weight = effective_weights.get(yr, year_order_weight)
                preferred_start, preferred_end = year_band[yr]
                for s in valid_starts(c):
                    if (c, s) not in y:  # defensive: y always contains every valid_start
                        continue
                    if not (preferred_start <= s // slots_per_day < preferred_end):
                        year_order_terms.append(weight * y[(c, s)])

        m.setObjective(
            quicksum(cv["weight"] * cv["var"] for cv in conflict_vars) +
            quicksum(dv["weight"] * dv["var"] for dv in daily_spread_vars) +
            (quicksum(year_order_terms) if year_order_terms else 0) +
            minimize_rooms_used,
            GRB.MINIMIZE)
        m.Params.MIPGap = mip_gap
        m.Params.MIPFocus = 1
        m.Params.NoRelHeurTime = 120
        t_build_end = time.perf_counter()
        build_time = round(t_build_end - t_build_start, 2)
        logger.info(f"Model build complete in {build_time}s — {m.NumVars} vars, {m.NumConstrs} constraints")

        if time_limit is not None:
            m.Params.TimeLimit = time_limit

        t_solve_start = time.perf_counter()
        m.optimize()
        t_solve_end = time.perf_counter()
        solve_time = round(t_solve_end - t_solve_start, 2)

        if m.SolCount == 0:
            return self._build_infeasible_result(m, C, info, conflicts, hard_pairs, n_slots, short, ROOMS, build_time, solve_time)

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
                        "room": r, "room_cap": rooms[r]["capacity"],
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
        seen_overlap = set()
        for cv in conflict_vars:
            if cv["var"].X > 0.5:
                pair_key = (min(cv["ua"], cv["ub"]), max(cv["ua"], cv["ub"]))
                if pair_key in seen_overlap:
                    continue
                seen_overlap.add(pair_key)
                total_penalty += cv["weight"] * cv["var"].X
                day, session = cv["t"] // slots_per_day, cv["t"] % slots_per_day
                dept_a = info[cv["ua"]]["student_dept"]
                dept_b = info[cv["ub"]]["student_dept"]
                penalties.append({
                    "desc": cv["desc"],
                    "penalty": round(cv["weight"] * cv["var"].X, 1),
                    "day": day_labels[day],
                    "type": "ÇAKIŞMA",
                    "depts": list({dept_a, dept_b}),
                })

        # Add Daily Spread Penalties
        seen_spread = set()
        for dv in daily_spread_vars:
            if dv["var"].X > 0.5:
                spread_key = (dv["dept"], dv["year"], dv["d"])
                if spread_key in seen_spread:
                    continue
                seen_spread.add(spread_key)
                # Deduplicate course codes for this group/day
                day_courses = list(dict.fromkeys(
                    s["code"] for s in schedule
                    if s["dept"] == dv["dept"] and s["year"] == dv["year"] and s["day"] == day_labels[dv["d"]]
                ))
                val = round(dv["var"].X)
                total_penalty += dv["weight"] * val
                course_str = " ve ".join(day_courses) if day_courses else dv["dept"]
                refined_desc = f"{course_str} dersleri aynı güne ({day_labels[dv['d']]}) planlandı."
                penalties.append({
                    "desc": refined_desc,
                    "penalty": round(dv["weight"] * val, 1),
                    "day": day_labels[dv["d"]],
                    "type": "YAYILIM",
                    "dept": dv["dept"],
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
                "build_time_s": build_time,
                "solve_time_s": solve_time,
                "num_vars": m.NumVars,
                "num_constraints": m.NumConstrs,
            },
            "status": status_map.get(m.Status, f"status_{m.Status}"),
        }

    def _build_infeasible_result(self, m, C, info, conflicts, hard_pairs, n_slots, short, ROOMS, build_time=None, solve_time=None):
        diagnostics = {
            "summary": "Model infeasible. Conflicting constraint analysis below.",
            "model_stats": {
                "total_scheduling_units": len(C),
                "total_conflicts": len(conflicts),
                "hard_conflict_pairs": len(hard_pairs),
                "total_slots": n_slots,
                "total_rooms": len(ROOMS),
                "total_room_capacity_per_slot": sum(v["capacity"] for v in ROOMS.values()),
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
                    f"{len(iis_groups['hard'])} hard conflict constraints conflict. "
                    f"Try increasing 'hard_threshold' (e.g. 10 or 20).")
            if iis_groups["room_busy"]:
                diagnostics["recommendations"].append(
                    f"{len(iis_groups['room_busy'])} room-busy constraints conflict. "
                    f"Try increasing 'exam_days' or 'slots_per_day'.")
            if iis_groups["cap"]:
                diagnostics["recommendations"].append(
                    f"{len(iis_groups['cap'])} capacity constraints conflict. "
                    f"Room capacities may be insufficient for total enrollment.")
            if iis_groups["no_btb"]:
                diagnostics["recommendations"].append(
                    f"{len(iis_groups['no_btb'])} no-back-to-back constraints conflict. "
                    f"Disable 'no_back_to_back' or increase exam days.")
            if not diagnostics["recommendations"]:
                diagnostics["recommendations"].append(
                    "IIS complete but no specific recommendation. Relax parameter combination.")

        except Exception as iis_err:
            diagnostics["iis_error"] = f"IIS failed: {str(iis_err)}"
            diagnostics["recommendations"].append(
                "IIS failed. Increase hard_threshold, exam_days, or disable no_back_to_back.")

        return {
            "schedule": [], "penalties": [],
            "stats": {"scheduling_units": len(info), "conflicts": len(conflicts), "obj_value": None, "total_penalty": 0, "build_time_s": build_time, "solve_time_s": solve_time},
            "diagnostics": diagnostics,
            "status": "infeasible"
        }
import datetime
from collections import defaultdict

from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import GeneratedSolution, Organization, Term
from ..serializers import OptimizeRequestSerializer, SimulateStudentsRequestSerializer
from ..services.simulator import StudentSimulatorService


class SimulateStudentsView(APIView):
    @extend_schema(
        request=SimulateStudentsRequestSerializer,
        description=(
            "**Demo tool** — generates synthetic student enrollments for testing purposes. "
            "For real university data, upload XLSX files via POST /api/students/upload-xlsx/ instead."
        ),
    )
    def post(self, request, *args, **kwargs):
        term_id = request.data.get('term_id')
        if not term_id:
            return Response({"error": "term_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            term = Term.objects.select_related('organization').get(id=term_id)
        except Term.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_400_BAD_REQUEST)

        org = term.organization
        academic_unit_id = request.data.get('academic_unit_id')

        service = StudentSimulatorService(str(org.id), str(term.id), academic_unit_id)
        try:
            csv_content = service.run()
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        response = HttpResponse(csv_content, content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="simulated_enrollments.csv"'
        return response


class OptimizerViewSet(viewsets.ViewSet):

    @extend_schema(request=OptimizeRequestSerializer)
    @action(detail=False, methods=['post'], url_path='run')
    def run_optimizer(self, request):
        serializer = OptimizeRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data
        term_id = data['term_id']

        MAX_CONCURRENT_RUNS = 3
        active_count = GeneratedSolution.objects.filter(
            term_id=term_id,
            status__in=['PENDING', 'PROCESSING']
        ).count()
        if active_count >= MAX_CONCURRENT_RUNS:
            return Response(
                {
                    "error": (
                        f"{active_count} active optimization run(s) already in progress for this term. "
                        f"Wait for them to complete before submitting a new one "
                        f"(max {MAX_CONCURRENT_RUNS} concurrent runs allowed)."
                    )
                },
                status=status.HTTP_429_TOO_MANY_REQUESTS
            )

        proposed_params = data.get('proposed_params') or {}
        weight_config = None
        llm_no_back_to_back_depts = None
        if proposed_params:
            from ..services.constraint_library import build_optimizer_kwargs, build_weight_config
            weight_config = build_weight_config(proposed_params)
            llm_optimizer_kw = build_optimizer_kwargs(proposed_params)
            llm_no_back_to_back_depts = llm_optimizer_kw.get('no_back_to_back_depts') or None

        solution = GeneratedSolution.objects.create(
            term_id=term_id,
            name=data.get('name', f"Gen-{datetime.date.today()}"),
            parameters={
                'hard_threshold': data['hard_threshold'],
                'time_limit': data['time_limit'],
                'mip_gap': data['mip_gap'],
                'no_back_to_back': data['no_back_to_back'],
                'no_back_to_back_depts': llm_no_back_to_back_depts,
                'exam_days': data['exam_days'],
                'slots_per_day': data['slots_per_day'],
                'start_hour': data['start_hour'],
                'year_order_weight': data.get('year_order_weight', 100.0),
                'year_order_sequence': data.get('year_order_sequence', None),
                'year_order_weights': data.get('year_order_weights', None),
                'weight_config': weight_config,
                'llm_proposed_params': proposed_params or None,
                'exam_period_id': str(data['exam_period_id']) if data.get('exam_period_id') else None,
            },
            status='PENDING'
        )

        from ..tasks import run_optimizer_task
        run_optimizer_task.delay(str(solution.id))

        return Response({
            "message": "Optimizasyon Celery üzerinden başlatıldı. Sonuçları DB üzerinden takip edebilirsiniz.",
            "task_id": str(solution.id)
        }, status=status.HTTP_202_ACCEPTED)

    @extend_schema(responses={200: {}})
    @action(detail=False, methods=['get'], url_path='history')
    def history(self, request):
        from ..models import ExamPeriod
        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()
        if term:
            solutions = GeneratedSolution.objects.filter(term=term).order_by('-created_at')[:50]
        else:
            solutions = GeneratedSolution.objects.none()

        ep_ids = {
            s.parameters.get('exam_period_id')
            for s in solutions
            if s.parameters and s.parameters.get('exam_period_id')
        }
        ep_map = {}
        if ep_ids:
            for ep in ExamPeriod.objects.filter(id__in=ep_ids).only('id', 'name', 'start_date', 'end_date'):
                ep_map[str(ep.id)] = {
                    'name': ep.name,
                    'start_date': str(ep.start_date),
                    'end_date': str(ep.end_date),
                }

        res = []
        for s in solutions:
            ep_id = (s.parameters or {}).get('exam_period_id')
            res.append({
                "id": str(s.id),
                "name": s.name,
                "term_id": str(s.term_id) if s.term_id else None,
                "status": s.status,
                "score": s.score,
                "created_at": s.created_at,
                "parameters": s.parameters,
                "stats": s.solver_metadata,
                "exam_period": ep_map.get(str(ep_id)) if ep_id else None,
            })
        return Response(res)

    @extend_schema(responses={200: {}})
    @action(detail=True, methods=['get'], url_path='result')
    def result(self, request, pk=None):
        solution = get_object_or_404(GeneratedSolution, id=pk)
        return Response({
            "id": str(solution.id),
            "name": solution.name,
            "status": solution.status,
            "score": solution.score,
            "error_message": solution.error_message,
            "parameters": solution.parameters,
            "stats": solution.solver_metadata,
            "schedule": solution.detailed_schedule,
            "penalties": solution.detailed_penalties,
        })

    @extend_schema(responses={200: {}})
    @action(detail=True, methods=['get'], url_path='departments')
    def departments(self, request, pk=None):
        solution = get_object_or_404(GeneratedSolution, id=pk)
        schedule = solution.detailed_schedule or []

        dept_stats = {}
        for item in schedule:
            dept = item.get("dept", "Bilinmiyor")
            if dept not in dept_stats:
                dept_stats[dept] = {"dept": dept, "exam_count": 0, "courses": set(), "rooms_used": set()}
            dept_stats[dept]["exam_count"] += 1
            dept_stats[dept]["courses"].add(item.get("course_name", ""))
            dept_stats[dept]["rooms_used"].add(item.get("room", ""))

        result = []
        for dept, stats in sorted(dept_stats.items()):
            result.append({
                "dept": stats["dept"],
                "unique_courses": len(stats["courses"]),
                "total_room_assignments": stats["exam_count"],
                "rooms_used": sorted(stats["rooms_used"]),
            })

        return Response({
            "solution_id": str(solution.id),
            "solution_name": solution.name,
            "status": solution.status,
            "total_departments": len(result),
            "departments": result,
        })

    @extend_schema(responses={200: {}})
    @action(detail=True, methods=['get'], url_path='by-department')
    def by_department(self, request, pk=None):
        solution = get_object_or_404(GeneratedSolution, id=pk)
        dept_filter = request.query_params.get('dept', '').strip()

        if not dept_filter:
            return Response({"error": "'dept' query parametresi zorunludur. Örn: ?dept=BİLGİSAYAR MÜH."},
                            status=status.HTTP_400_BAD_REQUEST)

        schedule = solution.detailed_schedule or []
        penalties = solution.detailed_penalties or []

        dept_schedule = [s for s in schedule if s.get("dept", "").upper() == dept_filter.upper()]
        dept_penalties = [p for p in penalties
                         if p.get("dept_a", "").upper() == dept_filter.upper()
                         or p.get("dept_b", "").upper() == dept_filter.upper()]

        course_groups = defaultdict(lambda: {"rooms": [], "total_cap": 0})
        for item in dept_schedule:
            key = (item["course_name"], item["day"], item["time"])
            course_groups[key]["rooms"].append(item["room"])
            course_groups[key]["total_cap"] += item["room_cap"]
            course_groups[key]["detail"] = item

        grouped_schedule = []
        for (course, day, time), data in sorted(course_groups.items(), key=lambda x: x[1]["detail"]["start_slot"]):
            d = data["detail"]
            grouped_schedule.append({
                "day": day,
                "time": time,
                "course_name": course,
                "code": d["code"],
                "year": d["year"],
                "requirement": d["requirement"],
                "enrolled": d["enrolled"],
                "rooms": data["rooms"],
                "total_room_capacity": data["total_cap"],
            })

        return Response({
            "solution_id": str(solution.id),
            "solution_name": solution.name,
            "department": dept_filter,
            "total_exams": len(grouped_schedule),
            "total_penalties": len(dept_penalties),
            "schedule": grouped_schedule,
            "penalties": dept_penalties,
        })

    def destroy(self, request, pk=None):
        solution = get_object_or_404(GeneratedSolution, id=pk)
        solution.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @extend_schema(responses={200: {}})
    @action(detail=False, methods=['post'], url_path='save-override')
    def save_override(self, request):
        original_id = request.data.get('original_id')
        new_name = request.data.get('name', 'Manuel Takvim')
        schedule = request.data.get('schedule', [])

        if not original_id or not schedule:
            return Response({"error": "original_id and schedule are required"}, status=status.HTTP_400_BAD_REQUEST)

        original = get_object_or_404(GeneratedSolution, id=original_id)

        new_penalties = []
        total_penalty_score = 0.0

        try:
            from ..services.optimizer import OptimizerService
            svc = OptimizerService(str(original.term_id))
            conflict_matrix = svc.load_conflict_matrix()

            # Load courses to build unit_key lookup tables
            courses = svc.load_courses()
            unit_info = {c['unit_key']: c for c in courses}

            # Build lookup: (code, dept_name) -> unit_key
            code_dept_to_unit = {}
            for c in courses:
                code_dept_to_unit[(c['code'], c['student_dept'])] = c['unit_key']

            # ── Map each schedule row to a unit_key ──────────────────────────
            slot_to_unit_keys: dict = {}
            for item in schedule:
                day = item.get('day') or item.get('date') or ''
                time = item.get('time') or item.get('start_time') or ''
                slot_key = (day, time)

                # Priority 1: unit_key already in row
                unit_key = item.get('unit_key')

                # Priority 2: course_id + student_dept_id
                if not unit_key:
                    course_id = str(item.get('course_id', ''))
                    dept_id = str(item.get('student_dept_id', ''))
                    if course_id and dept_id:
                        unit_key = f"{course_id}|{dept_id}"

                # Priority 3: code + dept name
                if not unit_key:
                    code = item.get('code') or item.get('course_code') or ''
                    dept_name = item.get('dept') or item.get('student_dept') or item.get('department') or ''
                    unit_key = code_dept_to_unit.get((code, dept_name))

                # Priority 4: code alone — take first match
                if not unit_key:
                    code = item.get('code') or item.get('course_code') or ''
                    for c in courses:
                        if c['code'] == code:
                            unit_key = c['unit_key']
                            break

                if unit_key:
                    if slot_key not in slot_to_unit_keys:
                        slot_to_unit_keys[slot_key] = []
                    if unit_key not in slot_to_unit_keys[slot_key]:
                        slot_to_unit_keys[slot_key].append(unit_key)

            # ── ÇAKIŞMA: same-slot overlap using conflict_matrix ─────────────
            seen_pairs = set()
            for (day, time), unit_keys in slot_to_unit_keys.items():
                for i in range(len(unit_keys)):
                    for j in range(i + 1, len(unit_keys)):
                        ua, ub = unit_keys[i], unit_keys[j]
                        pair = (min(ua, ub), max(ua, ub))
                        if pair in seen_pairs:
                            continue
                        seen_pairs.add(pair)

                        shared = conflict_matrix.get(pair, 0)
                        if shared > 0:
                            total_penalty_score += shared * 50
                            code_a = unit_info.get(ua, {}).get('code', ua.split('|')[0])
                            code_b = unit_info.get(ub, {}).get('code', ub.split('|')[0])
                            dept_a = unit_info.get(ua, {}).get('student_dept', '')
                            dept_b = unit_info.get(ub, {}).get('student_dept', '')
                            new_penalties.append({
                                "type": "ÇAKIŞMA",
                                "desc": f"Öğrenci Çakışması ({shared} öğrenci): {code_a} & {code_b}",
                                "day": day,
                                "time": time,
                                "students": shared,
                                "course_a": code_a,
                                "course_b": code_b,
                                "depts": list({dept_a, dept_b}),
                            })

            # ── ODA_ÇAKIŞMASI: Same room at the same time slot ───────────────
            # Group schedule items by (day, time, room)
            room_slots = {}
            for item in schedule:
                day = item.get('day') or item.get('date') or ''
                time = item.get('time') or item.get('start_time') or ''
                room = item.get('room') or ''
                if not day or not time or not room:
                    continue
                k = (day, time, room)
                if k not in room_slots:
                    room_slots[k] = []
                room_slots[k].append(item)

            for (day, time, room), items in room_slots.items():
                if len(items) > 1:
                    total_penalty_score += 500 * (len(items) - 1)
                    courses_str = ", ".join(sorted(set(it.get('code', '') for it in items)))
                    new_penalties.append({
                        "type": "ODA_ÇAKIŞMASI",
                        "desc": f"Sınıf Çakışması: {room} odasında aynı saatte birden fazla sınav var ({courses_str})",
                        "day": day,
                        "time": time,
                        "room": room,
                    })

            # ── KAPASİTE: Sum room capacities of all rooms assigned to the same exam at the same slot ──
            # Group schedule items by (day, time, code, dept, year)
            exam_assignments = {}
            for item in schedule:
                day = item.get('day') or item.get('date') or ''
                time = item.get('time') or item.get('start_time') or ''
                code = item.get('code') or ''
                dept = item.get('dept') or item.get('student_dept') or item.get('department') or ''
                year = item.get('year')
                
                if not day or not time or not code:
                    continue
                    
                k = (day, time, code, dept, year)
                if k not in exam_assignments:
                    exam_assignments[k] = {
                        "enrolled": item.get('enrolled') or 0,
                        "rooms": [],
                        "total_cap": 0
                    }
                
                room_name = item.get('room') or ''
                room_cap = item.get('room_cap') or item.get('room_capacity') or 0
                if room_name:
                    exam_assignments[k]["rooms"].append(f"{room_name} ({room_cap})")
                    exam_assignments[k]["total_cap"] += room_cap

            for (day, time, code, dept, year), info in exam_assignments.items():
                enrolled = info["enrolled"]
                total_cap = info["total_cap"]
                rooms_list = info["rooms"]
                
                if total_cap > 0 and enrolled > total_cap:
                    excess = enrolled - total_cap
                    total_penalty_score += excess * 10 + 100
                    rooms_str = ", ".join(rooms_list)
                    new_penalties.append({
                        "type": "KAPASİTE",
                        "desc": f"Kapasite Aşımı: {code} sınavı için atanan odaların toplam kapasitesi ({total_cap}) yetersiz! {enrolled} öğrenci var ({excess} kişi açıkta). Atanan Odalar: {rooms_str}",
                        "day": day,
                        "time": time,
                        "excess": excess
                    })

            # ── YAYILIM: multiple exams on the same day for (dept, year) ─────
            dept_year_day: dict = {}
            for item in schedule:
                day = item.get('day') or item.get('date') or ''
                dept = item.get('dept') or item.get('student_dept') or item.get('department') or ''
                year = item.get('year')
                code = item.get('code') or item.get('course_code') or ''
                if not dept or not day or not code:
                    continue
                k = (dept, year, day)
                if k not in dept_year_day:
                    dept_year_day[k] = set()
                dept_year_day[k].add(code)

            for (dept, year, day), codes_set in dept_year_day.items():
                if len(codes_set) > 1:
                    total_penalty_score += 200 * (len(codes_set) - 1)
                    course_str = " ve ".join(sorted(codes_set))
                    new_penalties.append({
                        "type": "YAYILIM",
                        "desc": f"{course_str} dersleri aynı güne ({day}) planlandı.",
                        "day": day,
                        "dept": dept,
                    })

        except Exception:
            import logging
            logging.getLogger(__name__).exception(
                "Penalty recalculation failed for override of solution %s", original_id
            )
            new_penalties = []
            total_penalty_score = 0

        new_solution = GeneratedSolution.objects.create(
            term=original.term,
            name=new_name,
            parameters=original.parameters,
            status='MANUAL_OVERRIDE',
            score=round(total_penalty_score, 1),
            detailed_schedule=schedule,
            detailed_penalties=new_penalties,
            solver_metadata={
                "manual_override": True,
                "original_solution_id": str(original.id),
                "conflict_count": len([p for p in new_penalties if p.get("type") == "ÇAKIŞMA"]),
                "spread_count": len([p for p in new_penalties if p.get("type") == "YAYILIM"]),
            },
        )

        return Response({"id": str(new_solution.id), "status": new_solution.status})

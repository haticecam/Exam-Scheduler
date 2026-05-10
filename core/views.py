from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny
from drf_spectacular.utils import extend_schema, OpenApiParameter, OpenApiExample, inline_serializer
from rest_framework import serializers
import logging

from django.http import HttpResponse

from .models import Organization, CourseCatalog, AcademicUnit, Term, Student, Resource, TermResource, GeneratedSolution, CourseSection
from .serializers import (
    OrganizationSerializer, CourseCatalogSerializer, AcademicUnitSerializer, TermSerializer,
    StudentSerializer, OptimizeRequestSerializer, SimulateStudentsRequestSerializer, ResourceSerializer,
    TermResourceSerializer, LLMConfigureRequestSerializer, LLMConfirmRequestSerializer, LLMDiagnoseRequestSerializer,
)
from .tasks import dummy_gurobi_task
from .services.simulator import StudentSimulatorService
from .services.course_loader import CourseLoaderService
from .services.enrollment_loader import EnrollmentLoaderService, XlsxEnrollmentLoaderService
from .services.demo_updater import DemoUpdaterService
from .services.optimizer import OptimizerService
import datetime
from django.shortcuts import get_object_or_404
from .models import GeneratedSolution

class DashboardStatsView(APIView):
    """
    Ana sayfa dashboard istatistikleri için verileri döner.
    Aktif döneme ait sayıları hesaplar.
    """
    def get(self, request):
        from .models import CourseSection
        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()

        room_count = Resource.objects.filter(
            type='CLASSROOM', is_active=True, exam_capacity__isnull=False
        ).count()

        if term:
            course_count = CourseSection.objects.filter(term=term).values('course_id').distinct().count()
            student_count = Student.objects.filter(enrollments__term=term).distinct().count()
            DONE_STATUSES = ['COMPLETED', 'OPTIMAL', 'FEASIBLE', 'FEASIBLE (TIME LIMIT)']
            last_sol = GeneratedSolution.objects.filter(term=term, status__in=DONE_STATUSES).order_by('-created_at').first()
            hard_conflicts = last_sol.solver_metadata.get('hard_conflicts', 0) if last_sol and last_sol.solver_metadata else 0
        else:
            course_count = 0
            student_count = 0
            hard_conflicts = 0
            
        return Response({
            "course_count": course_count,
            "student_count": student_count,
            "hard_conflicts": hard_conflicts,
            "room_count": room_count
        })

class SystemStatusView(APIView):
    """
    A simple endpoint to verify that Django is running and to trigger
    a dummy Gurobi background task via Celery.
    """
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({
            "status": "online",
            "message": "Exam Scheduler Backend API is running."
        })

    def post(self, request):
        """
        Triggers the dummy Gurobi test task.
        """
        task = dummy_gurobi_task.delay()
        return Response({
            "status": "task_dispatched",
            "task_id": task.id,
            "message": "Dummy Gurobi task has been pushed to the Celery queue."
        })


class CourseCatalogViewSet(viewsets.ModelViewSet):
    """
    ViewSet for full CRUD operations on the CourseCatalog model.
    Provides GET (list/retrieve), POST (create), PUT (update), PATCH, DELETE.
    """
    serializer_class = CourseCatalogSerializer

    def get_queryset(self):
        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()
        
        # Temel süzgeç: Aktif dönemde şubesi (sections) olan veya genel katalogdan gelen dersler
        if term:
            qs = CourseCatalog.objects.filter(sections__term=term).distinct()
        else:
            qs = CourseCatalog.objects.all()

        # URL PARAMETRELERİNE GÖRE FİLTRELEME
        dept_id = self.request.query_params.get('dept')
        year = self.request.query_params.get('year')
        req_type = self.request.query_params.get('type')
        search = self.request.query_params.get('search')

        if dept_id and dept_id != 'Tümü':
            qs = qs.filter(academic_unit_id=dept_id)
        if year and year != 'Tümü':
            qs = qs.filter(year_level=year)
        if req_type and req_type != 'Tümü':
            qs = qs.filter(requirement=req_type)
        if search:
            from django.db.models import Q
            qs = qs.filter(Q(name__icontains=search) | Q(code__icontains=search))

        return qs.order_by('code')

    @extend_schema(
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'file': {'type': 'string', 'format': 'binary', 'description': 'course_list_english.csv dosyası'},
                    'term_id': {'type': 'string', 'format': 'uuid', 'description': "Önceden oluşturduğunuz Dönem (Term) ID'si"}
                },
                'required': ['file', 'term_id']
            }
        }
    )
    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser], url_path='upload')
    def upload_csv(self, request):
        """
        Custom endpoint to upload a CSV file and batch create courses.
        """
        file = request.FILES.get('file')
        
        # Dosya yoksa Bad Request (400) dön
        if not file:
            return Response(
                {"error": "Lütfen bir CSV dosyası yükleyin (file parametresi eksik)."},
                status=status.HTTP_400_BAD_REQUEST
            )

        term_id = request.data.get('term_id')
        if not term_id:
            return Response(
                {"error": "Lütfen bir Dönem ID'si (term_id) belirtin."},
                status=status.HTTP_400_BAD_REQUEST
            )

        file_content = file.read().decode('utf-8')
        service = CourseLoaderService()
        result = service.process_csv(
            file_content,
            term_id=str(term_id)
        )

        if "error" in result:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            result,
            status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=['delete'], url_path='deleteAll')
    def delete_all(self, request):
        """
        Resets the course-loading hierarchy for a given organization.
        Departments, instructors, courses, sections, and groups are deleted.
        Organization and Term records are preserved.
        Requires ?org_id=<uuid> query parameter.
        """
        from .models import Enrollment, Student, CourseSection, CourseCatalog, StudentGroup, Instructor, AcademicUnit

        org_id = request.query_params.get('org_id')
        if not org_id:
            return Response({"error": "org_id query parameter is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            org = Organization.objects.get(id=org_id)
        except Organization.DoesNotExist:
            return Response({"error": "Organization not found."}, status=status.HTTP_404_NOT_FOUND)

        counts = {}
        counts['Enrollments'], _ = Enrollment.objects.filter(term__organization=org).delete()
        counts['Students'], _ = Student.objects.filter(organization=org).delete()
        counts['CourseSections'], _ = CourseSection.objects.filter(course__organization=org).delete()
        counts['CourseCatalogs'], _ = CourseCatalog.objects.filter(organization=org).delete()
        counts['StudentGroups'], _ = StudentGroup.objects.filter(organization=org).delete()
        counts['Instructors'], _ = Instructor.objects.filter(academic_unit__organization=org).delete()
        counts['AcademicUnits'], _ = AcademicUnit.objects.filter(organization=org).delete()

        total = sum(counts.values())
        return Response(
            {
                "message": f"Cleared {total} records for organization '{org.name}'.",
                "details": counts
            },
            status=status.HTTP_200_OK
        )


class OrganizationViewSet(viewsets.ModelViewSet):
    """
    ViewSet for full CRUD operations on the Organization model.
    Provides list, create, retrieve, update, partial_update, and destroy actions.
    """
    queryset = Organization.objects.all()
    serializer_class = OrganizationSerializer

    @extend_schema(request=None, responses={200: {}})
    @action(detail=True, methods=['post'], url_path='seed-rooms')
    def seed_rooms(self, request, pk=None):
        from .management.commands.seed_rooms import EXAM_ROOMS
        from .models import Resource
        org = self.get_object()
        created = 0
        skipped = 0
        for name, full_cap in EXAM_ROOMS.items():
            _, was_created = Resource.objects.get_or_create(
                organization=org,
                name=name,
                type='CLASSROOM',
                defaults={
                    'full_capacity': full_cap,
                    'exam_capacity': full_cap // 3,
                    'is_active': True,
                },
            )
            if was_created:
                created += 1
            else:
                skipped += 1
        return Response({
            "organization": org.name,
            "created": created,
            "skipped": skipped,
            "total": created + skipped,
        })

class AcademicUnitViewSet(viewsets.ModelViewSet):
    """
    ViewSet for full CRUD operations on the AcademicUnit model.
    Provides get, post, put, patch, delete operations.
    """
    queryset = AcademicUnit.objects.all()
    serializer_class = AcademicUnitSerializer

    @extend_schema(
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'file': {'type': 'string', 'format': 'binary', 'description': 'bütün dersler.csv dosyası'}
                },
                'required': ['file']
            }
        }
    )
    @action(detail=False, methods=['post'], parser_classes=[MultiPartParser, FormParser], url_path='update-estimates')
    def update_estimates(self, request):
        """
        Geçmiş yıl ders kayıtları (bütün dersler.csv) yüklenip bölüm tahmini kontenjanlarını 
        otomatik güncelleyen uç nokta.
        """
        file = request.FILES.get('file')
        if not file:
            return Response({"error": "CSV is required."}, status=status.HTTP_400_BAD_REQUEST)

        file_content = file.read().decode('utf-8')
        service = DemoUpdaterService()
        result = service.process_csv(file_content)

        return Response(result, status=status.HTTP_200_OK if "success" in result else status.HTTP_400_BAD_REQUEST)

class TermViewSet(viewsets.ModelViewSet):
    """
    ViewSet for full CRUD operations on the Term model.
    """
    queryset = Term.objects.all()
    serializer_class = TermSerializer

    def get_queryset(self):
        qs = Term.objects.all()
        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
        return qs.order_by('-status', 'name')

    def perform_create(self, serializer):
        status = serializer.validated_data.get('status')
        instance = serializer.save()
        if status == 'Active':
            # Diğerlerini pasif yap
            Term.objects.filter(organization=instance.organization).exclude(id=instance.id).update(status='Planning')

    def perform_update(self, serializer):
        status = serializer.validated_data.get('status')
        instance = serializer.save()
        if status == 'Active':
            # Diğerlerini pasif yap
            Term.objects.filter(organization=instance.organization).exclude(id=instance.id).update(status='Planning')


class StudentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for GET, GetAll, and a custom POST implementation handling CSV.
    """
    serializer_class = StudentSerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']
    parser_classes = (MultiPartParser, FormParser)

    def get_queryset(self):
        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()
        if term:
            return Student.objects.filter(enrollments__term=term).distinct()
        return Student.objects.all()

    @extend_schema(
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'file': {'type': 'string', 'format': 'binary', 'description': 'simulated_enrollments.csv file'},
                    'term_id': {'type': 'string', 'format': 'uuid', 'description': 'Term ID (required)'},
                },
                'required': ['file', 'term_id']
            }
        }
    )
    def create(self, request, *args, **kwargs):
        """Upload a CSV file to bulk-create student enrollments."""
        file = request.FILES.get('file')
        if not file:
            return Response(
                {"error": "Please upload a CSV file (file parameter missing)."},
                status=status.HTTP_400_BAD_REQUEST
            )

        term_id = request.data.get('term_id')
        if not term_id:
            return Response({"error": "term_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            term = Term.objects.select_related('organization').get(id=term_id)
        except Term.DoesNotExist:
            return Response({"error": "Term not found."}, status=status.HTTP_400_BAD_REQUEST)

        org = term.organization
        file_content = file.read().decode('utf-8')
        service = EnrollmentLoaderService()
        result = service.process_csv(file_content, str(term.id), str(org.id))

        if "error" in result:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['delete'], url_path='deleteAll')
    def delete_all(self, request):
        """Delete all students (and their enrollments) for a given organization.
        Requires ?org_id=<uuid> query parameter.
        """
        org_id = request.query_params.get('org_id')
        if not org_id:
            return Response({"error": "org_id query parameter is required."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            org = Organization.objects.get(id=org_id)
        except Organization.DoesNotExist:
            return Response({"error": "Organization not found."}, status=status.HTTP_404_NOT_FOUND)

        count, _ = Student.objects.filter(organization=org).delete()
        return Response(
            {"message": f"Deleted {count} students for organization '{org.name}'."},
            status=status.HTTP_200_OK
        )

    @extend_schema(
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'term_id': {'type': 'string', 'format': 'uuid', 'description': 'Term ID (required)'},
                    'files': {
                        'type': 'array',
                        'items': {'type': 'string', 'format': 'binary'},
                        'description': 'XLSX files named after the course code (e.g. CENG113.xlsx)',
                    },
                },
                'required': ['term_id', 'files']
            }
        }
    )
    @action(detail=False, methods=['post'], url_path='upload-xlsx',
            parser_classes=[MultiPartParser, FormParser])
    def upload_xlsx(self, request):
        """Upload one or more XLSX files (one per course) to create student enrollments."""
        term_id = request.data.get('term_id')
        if not term_id:
            return Response({"error": "term_id is required."}, status=status.HTTP_400_BAD_REQUEST)

        files = request.FILES.getlist('files')
        if not files:
            return Response({"error": "At least one XLSX file is required."}, status=status.HTTP_400_BAD_REQUEST)

        file_tuples = [(f.name, f.read()) for f in files]
        svc = XlsxEnrollmentLoaderService()
        result = svc.process_files(file_tuples, term_id)

        if 'error' in result:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_201_CREATED)

    @extend_schema(parameters=[
        OpenApiParameter('min_shared', int, description="Minimum shared students to include (default 1)", required=False),
        OpenApiParameter('page', int, description="Page number (default 1)", required=False),
        OpenApiParameter('page_size', int, description="Page size (default 100)", required=False),
        OpenApiParameter('department_id', str, description="Sadece bu bölüm (AcademicUnit) ID'sine ait ders çakışmalarını getirir.", required=False),
    ])
    @action(detail=False, methods=['get'], url_path='getConflicts')
    def get_conflicts(self, request):
        """
        Return the conflict matrix (courses sharing students).
        """
        try:
            min_shared = max(1, int(request.query_params.get('min_shared', 1)))
            page = max(1, int(request.query_params.get('page', 1)))
            page_size = min(500, max(1, int(request.query_params.get('page_size', 100))))
        except ValueError:
            min_shared, page, page_size = 1, 1, 100

        department_id = request.query_params.get('department_id')

        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()
        term_id_str = str(term.id) if term else "no-term"

        try:
            from django.db import connection
            with connection.cursor() as cur:
                query = """
                    SELECT
                        sa.course_id::text AS ca,
                        sb.course_id::text AS cb,
                        COUNT(DISTINCT e1.student_id)                     AS shared,
                        aca.name  AS course_a_name,
                        aca.code  AS course_a_code,
                        aub.name  AS dept_a,
                        acb.name  AS course_b_name,
                        acb.code  AS course_b_code,
                        aua.name  AS dept_b
                    FROM enrollment     e1
                    JOIN enrollment     e2  ON e1.student_id = e2.student_id
                    JOIN course_section sa  ON e1.section_id = sa.id
                    JOIN course_section sb  ON e2.section_id = sb.id
                    JOIN course_catalog  aca ON sa.course_id = aca.id
                    JOIN course_catalog  acb ON sb.course_id = acb.id
                    JOIN academic_unit  aub ON aca.academic_unit_id = aub.id
                    JOIN academic_unit  aua ON acb.academic_unit_id = aua.id
                    WHERE sa.course_id::text < sb.course_id::text
                      AND sa.term_id = %s AND sb.term_id = %s
                """
                
                params = [term_id_str, term_id_str]
                if department_id:
                    query += " AND (aca.academic_unit_id::text = %s OR acb.academic_unit_id::text = %s)"
                    params.extend([department_id, department_id])
                
                query += """
                    GROUP BY sa.course_id::text, sb.course_id::text, aca.name, aca.code, aub.name, acb.name, acb.code, aua.name
                    HAVING COUNT(DISTINCT e1.student_id) >= %s
                    ORDER BY shared DESC
                """
                params.append(min_shared)
                
                cur.execute(query, params)
                
                columns = [col[0] for col in cur.description]
                all_rows = [dict(zip(columns, row)) for row in cur.fetchall()]

            total = len(all_rows)
            start = (page - 1) * page_size
            paged = all_rows[start: start + page_size]

            conflicts = [
                {
                    "course_a_id": r["ca"],
                    "course_a_name": r["course_a_name"],
                    "course_a_code": r["course_a_code"],
                    "dept_a": r["dept_a"],
                    "course_b_id": r["cb"],
                    "course_b_name": r["course_b_name"],
                    "course_b_code": r["course_b_code"],
                    "dept_b": r["dept_b"],
                    "shared_students": r["shared"],
                }
                for r in paged
            ]

            return Response({
                'total': total,
                'page': page,
                'page_size': page_size,
                'total_pages': (total + page_size - 1) // page_size,
                'min_shared': min_shared,
                'conflicts': conflicts,
            })
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class SimulateStudentsView(APIView):
    """
    Demo tool: generates fake student enrollments for testing.
    For real data, use POST /api/students/upload-xlsx/ instead.
    """
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
    """
    Gurobi Optimizasyon Motoru Kontrolcüsü.
    """
    
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
        if proposed_params:
            from .services.constraint_library import build_weight_config
            weight_config = build_weight_config(proposed_params)

        solution = GeneratedSolution.objects.create(
            term_id=term_id,
            name=data.get('name', f"Gen-{datetime.date.today()}"),
            parameters={
                'hard_threshold': data['hard_threshold'],
                'time_limit': data['time_limit'],
                'mip_gap': data['mip_gap'],
                'no_back_to_back': data['no_back_to_back'],
                'exam_days': data['exam_days'],
                'slots_per_day': data['slots_per_day'],
                'start_hour': data['start_hour'],
                'year_order_weight': data.get('year_order_weight', 100.0),
                'year_order_sequence': data.get('year_order_sequence', None),
                'year_order_weights': data.get('year_order_weights', None),
                'weight_config': weight_config,
                'llm_proposed_params': proposed_params or None,
            },
            status='PENDING'
        )
        
        from .tasks import run_optimizer_task
        run_optimizer_task.delay(str(solution.id))
        
        return Response({
            "message": "Optimizasyon Celery üzerinden başlatıldı. Sonuçları DB üzerinden takip edebilirsiniz.",
            "task_id": str(solution.id)
        }, status=status.HTTP_202_ACCEPTED)

    @extend_schema(responses={200: {}})
    @action(detail=False, methods=['get'], url_path='history')
    def history(self, request):
        """Aktif dönemin optimizasyon (çözüm) geçmişinin hafifletilmiş listesi."""
        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()
        if term:
            solutions = GeneratedSolution.objects.filter(term=term).order_by('-created_at')[:50]
        else:
            solutions = GeneratedSolution.objects.none()
        res = []
        for s in solutions:
            res.append({
                "id": str(s.id),
                "name": s.name,
                "term_id": str(s.term_id) if s.term_id else None,
                "status": s.status,
                "score": s.score,
                "created_at": s.created_at,
                "parameters": s.parameters,
                "stats": s.solver_metadata
            })
        return Response(res)

    @extend_schema(responses={200: {}})
    @action(detail=True, methods=['get'], url_path='result')
    def result(self, request, pk=None):
        """Seçili çözümün bütün detaylarını (Çizelge ve Ceza Dökümleri dahil) getirir."""
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
        """Seçili çözümdeki tüm bölümleri ve her bölümün sınav/ders sayısını listeler."""
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
        """
        Seçili çözümün belirli bir bölüme ait sınav çizelgesini ve ceza dökümünü döner.
        Query param: ?dept=BİLGİSAYAR MÜH.
        """
        solution = get_object_or_404(GeneratedSolution, id=pk)
        dept_filter = request.query_params.get('dept', '').strip()

        if not dept_filter:
            return Response({"error": "'dept' query parametresi zorunludur. Örn: ?dept=BİLGİSAYAR MÜH."},
                            status=status.HTTP_400_BAD_REQUEST)

        schedule = solution.detailed_schedule or []
        penalties = solution.detailed_penalties or []

        # Bölüme göre filtrele
        dept_schedule = [s for s in schedule if s.get("dept", "").upper() == dept_filter.upper()]
        dept_penalties = [p for p in penalties
                         if p.get("dept_a", "").upper() == dept_filter.upper()
                         or p.get("dept_b", "").upper() == dept_filter.upper()]

        # Aynı derse ait birden fazla oda atamasını grupla
        from collections import defaultdict
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
        """Çözümü (GeneratedSolution) siler."""
        solution = get_object_or_404(GeneratedSolution, id=pk)
        solution.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)



class ResourceViewSet(viewsets.ModelViewSet):
    serializer_class = ResourceSerializer

    def get_queryset(self):
        return Resource.objects.filter(organization__isnull=False)


class TermResourceViewSet(viewsets.ModelViewSet):
    serializer_class = TermResourceSerializer

    def get_queryset(self):
        qs = TermResource.objects.select_related('resource', 'term').prefetch_related('restricted_to_units')
        term_id = self.request.query_params.get('term')
        if term_id:
            qs = qs.filter(term_id=term_id)
        return qs


# ═══════════════════════════════════════════════════════════════════
#  LLM INTEGRATION VIEWS
# ═══════════════════════════════════════════════════════════════════

logger = logging.getLogger(__name__)


class LLMConfigureView(APIView):
    """
    POST /api/llm/configure/

    Takes a natural language message from an administrator and returns
    proposed scheduling parameter changes. Does NOT trigger optimization.

    The admin reviews the proposed changes and confirms via /api/llm/confirm/.
    """

    @extend_schema(
        tags=['LLM Integration'],
        request=LLMConfigureRequestSerializer,
        responses={
            200: inline_serializer(
                name='LLMConfigureResponse',
                fields={
                    'success': serializers.BooleanField(),
                    'summary': serializers.CharField(),
                    'changes': serializers.ListField(child=serializers.DictField()),
                    'warnings': serializers.ListField(child=serializers.CharField()),
                    'proposed_params': serializers.DictField(),
                    'optimizer_kwargs': serializers.DictField(),
                    'weight_config': serializers.DictField(),
                },
            ),
            422: inline_serializer(
                name='LLMConfigureErrorResponse',
                fields={
                    'success': serializers.BooleanField(default=False),
                    'error': serializers.CharField(),
                    'summary': serializers.CharField(),
                    'warnings': serializers.ListField(child=serializers.CharField()),
                },
            ),
            503: inline_serializer(
                name='LLMServiceUnavailable',
                fields={'error': serializers.CharField()},
            ),
        },
        description=(
            'Send a natural language scheduling preference to GPT-4o.\n\n'
            'The LLM maps the request to validated constraint parameters from the static library. '
            'Returns proposed changes for admin review — does **not** trigger the optimizer.\n\n'
            '**Example messages:**\n'
            '- "Spread exams over 10 days with 3 slots per day"\n'
            '- "Increase the penalty for mandatory course conflicts"\n'
            '- "No back-to-back exams, start at 09:00"'
        ),
        examples=[
            OpenApiExample(
                'Simple scheduling request',
                value={
                    'message': 'Spread exams over 10 days with 3 slots per day, starting at 09:00',
                    'term_id': 'b976d91a-1828-46d5-ab13-c52216f8b030',
                },
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = LLMConfigureRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user_message = data["message"]
        conversation_history = data.get("conversation_history", [])

        from .services.constraint_library import get_optimizer_defaults, get_weight_defaults, get_blueprint_map
        current_params = {}
        defaults = get_optimizer_defaults()
        weight_defaults = get_weight_defaults()
        blueprint_map = get_blueprint_map()

        for code, bp in blueprint_map.items():
            schema = bp["param_schema"]
            if bp["category"] == "SOLVER_PARAM":
                kwarg = schema["optimizer_kwarg"]
                if kwarg in defaults:
                    current_params[code] = defaults[kwarg]
            elif bp["category"] == "SOFT_WEIGHT":
                wkey = schema["weight_key"]
                if wkey in weight_defaults:
                    current_params[code] = weight_defaults[wkey]

        try:
            from .services.llm_mapper import LLMMapperService
            mapper = LLMMapperService()
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        result = mapper.map_preferences(
            user_input=user_message,
            current_params=current_params,
            conversation_history=conversation_history,
        )

        if not result["success"]:
            return Response(
                {
                    "success": False,
                    "error": result["error"],
                    "summary": result.get("summary", ""),
                    "warnings": result.get("warnings", []),
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response({
            "success": True,
            "is_scheduling_request": result.get("is_scheduling_request", True),
            "summary": result["summary"],
            "changes": result["changes"],
            "warnings": result["warnings"],
            "proposed_params": result["proposed_params"],
            "optimizer_kwargs": result["optimizer_kwargs"],
            "weight_config": result["weight_config"],
        })


class LLMConfirmView(APIView):
    """
    POST /api/llm/confirm/

    After the admin reviews the proposed changes from /api/llm/configure/,
    they confirm here to create a GeneratedSolution and trigger the optimizer.
    """

    @extend_schema(
        tags=['LLM Integration'],
        request=LLMConfirmRequestSerializer,
        responses={
            202: inline_serializer(
                name='LLMConfirmResponse',
                fields={
                    'message': serializers.CharField(),
                    'solution_id': serializers.UUIDField(),
                    'parameters_applied': serializers.DictField(),
                    'weight_config_applied': serializers.DictField(),
                },
            ),
            400: inline_serializer(
                name='LLMConfirmErrorResponse',
                fields={
                    'error': serializers.CharField(),
                    'details': serializers.DictField(),
                },
            ),
        },
        description=(
            'Confirm the proposed parameters from /api/llm/configure/ and trigger the optimizer.\n\n'
            'Pass the `proposed_params` dict returned by the configure step. '
            'The system validates them again, creates a GeneratedSolution, '
            'and dispatches a Celery task to run Gurobi.\n\n'
            'Poll /api/optimize/{solution_id}/result/ for completion.'
        ),
    )
    def post(self, request):
        serializer = LLMConfirmRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        term_id = data["term_id"]
        proposed_params = data["proposed_params"]

        from .services.constraint_library import validate_all_parameters, build_optimizer_kwargs, build_weight_config

        is_valid, errors = validate_all_parameters(proposed_params)
        if not is_valid:
            return Response(
                {"error": "Parameter validation failed", "details": errors},
                status=status.HTTP_400_BAD_REQUEST,
            )

        optimizer_kwargs = build_optimizer_kwargs(proposed_params)
        weight_config = build_weight_config(proposed_params)

        solution = GeneratedSolution.objects.create(
            term_id=term_id,
            name=data.get("name", f"LLM-Gen-{datetime.date.today()}"),
            parameters={
                **optimizer_kwargs,
                "weight_config": weight_config,
                "llm_proposed_params": proposed_params,
            },
            status="PENDING",
        )

        from .tasks import run_optimizer_task
        run_optimizer_task.delay(str(solution.id))

        return Response(
            {
                "message": "Optimization started with LLM-configured parameters.",
                "solution_id": str(solution.id),
                "parameters_applied": optimizer_kwargs,
                "weight_config_applied": weight_config,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class LLMLibraryView(APIView):
    """
    GET /api/llm/library/

    Returns the full constraint library for inspection.
    """

    @extend_schema(
        tags=['LLM Integration'],
        responses={
            200: inline_serializer(
                name='LLMLibraryResponse',
                fields={
                    'source': serializers.ChoiceField(choices=['database', 'in_memory']),
                    'count': serializers.IntegerField(),
                    'blueprints': serializers.ListField(child=serializers.DictField()),
                },
            ),
        },
        description=(
            'Returns the full static constraint library.\n\n'
            'Each blueprint includes its code, description, category, and param_schema. '
            'The LLM uses this library to map natural language to valid parameters.'
        ),
    )
    def get(self, request):
        from .models import ConstraintBlueprint
        blueprints = ConstraintBlueprint.objects.all()

        if not blueprints.exists():
            from .services.constraint_library import BLUEPRINT_DEFINITIONS
            return Response({
                "source": "in_memory",
                "count": len(BLUEPRINT_DEFINITIONS),
                "blueprints": BLUEPRINT_DEFINITIONS,
            })

        result = [
            {"code": bp.code, "description": bp.description, "param_schema": bp.param_schema}
            for bp in blueprints
        ]

        return Response({
            "source": "database",
            "count": len(result),
            "blueprints": result,
        })


class LLMDiagnoseView(APIView):
    """
    POST /api/llm/diagnose/

    Takes the ID of an INFEASIBLE solution and uses GPT-4o to analyze
    the Gurobi IIS diagnostics. Returns a plain-English explanation
    and ranked parameter relaxation suggestions.
    """

    @extend_schema(
        tags=['LLM Integration'],
        request=LLMDiagnoseRequestSerializer,
        responses={
            200: inline_serializer(
                name='LLMDiagnoseResponse',
                fields={
                    'success': serializers.BooleanField(),
                    'solution_id': serializers.UUIDField(),
                    'parameters_used': serializers.DictField(),
                    'explanation': serializers.CharField(),
                    'root_causes': serializers.ListField(child=serializers.DictField()),
                    'suggestions': serializers.ListField(child=serializers.DictField()),
                    'combined_recommendation': serializers.CharField(),
                },
            ),
            400: inline_serializer(
                name='LLMDiagnoseNotInfeasible',
                fields={
                    'error': serializers.CharField(),
                    'solution_id': serializers.UUIDField(),
                    'status': serializers.CharField(),
                },
            ),
            422: inline_serializer(
                name='LLMDiagnoseErrorResponse',
                fields={
                    'success': serializers.BooleanField(default=False),
                    'error': serializers.CharField(),
                    'solution_id': serializers.UUIDField(),
                },
            ),
        },
        description=(
            'Diagnose why an optimizer run was INFEASIBLE.\n\n'
            'Pass the `solution_id` of a failed run. GPT-4o analyzes the Gurobi IIS '
            'diagnostics and returns a plain-English explanation, ranked root causes, '
            'actionable suggestions, and a combined recommendation.\n\n'
            'Feed the suggestions back into /api/llm/configure/ or /api/llm/confirm/ to retry.'
        ),
        examples=[
            OpenApiExample(
                'Diagnose an infeasible solution',
                value={'solution_id': 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'},
                request_only=True,
            ),
        ],
    )
    def post(self, request):
        serializer = LLMDiagnoseRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        solution_id = data["solution_id"]
        solution = get_object_or_404(GeneratedSolution, id=solution_id)

        if solution.status.upper() != "INFEASIBLE":
            return Response(
                {
                    "error": f"Solution status is '{solution.status}', not INFEASIBLE. "
                             "Diagnosis is only available for infeasible solutions.",
                    "solution_id": str(solution.id),
                    "status": solution.status,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            from .services.llm_feedback import LLMFeedbackService
            feedback = LLMFeedbackService()
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        result = feedback.diagnose(solution)

        if not result["success"]:
            return Response(
                {
                    "success": False,
                    "error": result["error"],
                    "solution_id": str(solution.id),
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response({
            "success": True,
            "solution_id": str(solution.id),
            "parameters_used": solution.parameters,
            "explanation": result["explanation"],
            "root_causes": result["root_causes"],
            "suggestions": result["suggestions"],
            "combined_recommendation": result["combined_recommendation"],
        })

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from rest_framework.permissions import AllowAny
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework import serializers

from django.http import HttpResponse

from .models import Organization, CourseCatalog, AcademicUnit, Term, Student, Resource, GeneratedSolution, CourseSection
from .serializers import OrganizationSerializer, CourseCatalogSerializer, AcademicUnitSerializer, TermSerializer, \
    StudentSerializer, OptimizeRequestSerializer, SimulateStudentsRequestSerializer, ResourceSerializer
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
        
        # Odaları yükle ve tablo boşsa otomatik seed et
        rooms_dict = OptimizerService.get_dynamic_rooms()
        room_count = len(rooms_dict)

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
        for name, capacity in EXAM_ROOMS.items():
            _, was_created = Resource.objects.get_or_create(
                organization=org,
                name=name,
                type='CLASSROOM',
                defaults={'capacity': capacity, 'is_active': True}
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
            return Student.objects.filter(term=term)
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
                'start_hour': data['start_hour']
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

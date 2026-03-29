from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser, FormParser
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework import serializers

from django.http import HttpResponse

from .models import Organization, CourseCatalog, AcademicUnit, Term, Student
from .serializers import OrganizationSerializer, CourseCatalogSerializer, AcademicUnitSerializer, TermSerializer, StudentSerializer
from .tasks import dummy_gurobi_task
from .services.simulator import StudentSimulatorService
from .services.course_loader import CourseLoaderService
from .services.enrollment_loader import EnrollmentLoaderService
from .services.demo_updater import DemoUpdaterService

class SystemStatusView(APIView):
    """
    A simple endpoint to verify that Django is running and to trigger
    a dummy Gurobi background task via Celery.
    """
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
    queryset = CourseCatalog.objects.all()
    serializer_class = CourseCatalogSerializer

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
        CSV yüklemesiyle oluşan tüm hiyerarşiyi (Bölümler, Eğitmenler, Dersler, Şubeler ve Gruplar) 
        kökten silerek sistemi o adımı hiç yapmamışsınız gibi temizler.
        Oluşturduğunuz Organization ve Term(Dönem) silinmez, korunur.
        """
        from .models import Enrollment, Student, CourseSection, CourseCatalog, StudentGroup, Instructor, AcademicUnit
        
        counts = {}
        counts['Enrollments'], _ = Enrollment.objects.all().delete()
        counts['Students'], _ = Student.objects.all().delete()
        counts['CourseSections'], _ = CourseSection.objects.all().delete()
        counts['CourseCatalogs'], _ = CourseCatalog.objects.all().delete()
        counts['StudentGroups'], _ = StudentGroup.objects.all().delete()
        counts['Instructors'], _ = Instructor.objects.all().delete()
        counts['AcademicUnits'], _ = AcademicUnit.objects.all().delete()
        
        total = sum(counts.values())
        return Response(
            {
                "message": f"Ders yükleme işlemleri geri alındı. Toplam {total} ilişkili kayıt temizlendi.",
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


class StudentViewSet(viewsets.ModelViewSet):
    """
    ViewSet for GET, GetAll, and a custom POST implementation handling CSV.
    """
    queryset = Student.objects.all()
    serializer_class = StudentSerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']
    parser_classes = (MultiPartParser, FormParser)

    @extend_schema(
        request={
            'multipart/form-data': {
                'type': 'object',
                'properties': {
                    'file': {'type': 'string', 'format': 'binary', 'description': 'simulated_enrollments.csv dosyası'}
                },
                'required': ['file']
            }
        }
    )
    def create(self, request, *args, **kwargs):
        """
        POST isteği ile toplu öğrenci verisi almak için CSV dosyası yükleme ucu.
        """
        file = request.FILES.get('file')
        
        if not file:
            return Response(
                {"error": "Lütfen bir CSV dosyası yükleyin (file parametresi eksik)."},
                status=status.HTTP_400_BAD_REQUEST
            )
            
        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()
        if not org or not term:
            return Response({"error": "Active Term or Organization missing."}, status=status.HTTP_400_BAD_REQUEST)

        file_content = file.read().decode('utf-8')
        service = EnrollmentLoaderService()
        result = service.process_csv(file_content, str(term.id), str(org.id))

        if "error" in result:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            result,
            status=status.HTTP_201_CREATED
        )

    @action(detail=False, methods=['delete'], url_path='deleteAll')
    def delete_all(self, request):
        """
        Veritabanındaki tüm öğrencileri (ve onlara bağlı enrollment'ları) siler.
        """
        count, _ = Student.objects.all().delete()
        return Response(
            {"message": f"Toplam {count} öğrenci başarıyla silindi."},
            status=status.HTTP_200_OK
        )

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
                    FROM core_enrollment     e1
                    JOIN core_enrollment     e2  ON e1.student_id = e2.student_id
                    JOIN core_coursesection sa  ON e1.section_id = sa.id
                    JOIN core_coursesection sb  ON e2.section_id = sb.id
                    JOIN core_coursecatalog  aca ON sa.course_id = aca.id
                    JOIN core_coursecatalog  acb ON sb.course_id = acb.id
                    JOIN core_academicunit  aub ON aca.academic_unit_id = aub.id
                    JOIN core_academicunit  aua ON acb.academic_unit_id = aua.id
                    WHERE sa.course_id::text < sb.course_id::text
                """
                
                params = []
                if department_id:
                    query += " AND (aca.academic_unit_id = %s AND acb.academic_unit_id = %s)"
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

class SimulateStudentsRequestSerializer(serializers.Serializer):
    term_id = serializers.UUIDField(required=False, help_text="Zorunlu değil. Belirtilmezse Active olan dönem kullanılır.")
    academic_unit_id = serializers.UUIDField(required=False, help_text="Zorunlu değil. Sadece belirtilen academic unit için simülasyon yapar.")

class SimulateStudentsView(APIView):
    """
    Endpoint to trigger the student enrollment simulation via Celery.
    Accepts customized simulation parameters.
    """
    @extend_schema(request=SimulateStudentsRequestSerializer)
    def post(self, request, *args, **kwargs):
        org = Organization.objects.first()
        if not org:
            return Response({"error": "Sistemde hiç organizasyon bulunamadı."}, status=status.HTTP_400_BAD_REQUEST)
            
        term_id = request.data.get('term_id')
        if term_id:
            term = Term.objects.filter(id=term_id, organization=org).first()
            if not term:
                return Response({"error": "Belirtilen term bulunamadı."}, status=status.HTTP_400_BAD_REQUEST)
        else:
            term = Term.objects.filter(organization=org, status='Active').first()
            if not term:
                return Response({"error": "Organizasyonda 'Active' statüsünde bir Term bulunamadı."}, status=status.HTTP_400_BAD_REQUEST)

        academic_unit_id = request.data.get('academic_unit_id')

        # CSV Çıktısını Senkron Olarak Üret ve Gönder
        service = StudentSimulatorService(str(org.id), str(term.id), academic_unit_id)
        try:
            csv_content = service.run()
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        response = HttpResponse(csv_content, content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="simulated_enrollments.csv"'
        return response


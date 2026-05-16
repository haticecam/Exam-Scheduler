from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from ..models import AcademicUnit, Organization, Student, Term
from ..serializers import AcademicUnitSerializer, OrganizationSerializer, StudentSerializer, TermSerializer
from ..services.demo_updater import DemoUpdaterService
from ..services.enrollment_loader import EnrollmentLoaderService, XlsxEnrollmentLoaderService


class OrganizationViewSet(viewsets.ModelViewSet):
    queryset = Organization.objects.all()
    serializer_class = OrganizationSerializer

    @extend_schema(request=None, responses={200: {}})
    @action(detail=True, methods=['post'], url_path='seed-rooms')
    def seed_rooms(self, request, pk=None):
        from ..management.commands.seed_rooms import EXAM_ROOMS
        from ..models import Resource
        org = self.get_object()
        created = 0
        skipped = 0
        for name, capacity in EXAM_ROOMS.items():
            _, was_created = Resource.objects.get_or_create(
                organization=org,
                name=name,
                type='CLASSROOM',
                defaults={
                    'capacity': capacity,
                    'exam_capacity': capacity // 2,
                    'is_active': True,
                }
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
        file = request.FILES.get('file')
        if not file:
            return Response({"error": "CSV is required."}, status=status.HTTP_400_BAD_REQUEST)

        file_content = file.read().decode('utf-8')
        service = DemoUpdaterService()
        result = service.process_csv(file_content)

        return Response(result, status=status.HTTP_200_OK if "success" in result else status.HTTP_400_BAD_REQUEST)


class TermViewSet(viewsets.ModelViewSet):
    queryset = Term.objects.all()
    serializer_class = TermSerializer

    def get_queryset(self):
        qs = Term.objects.all()
        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)
        return qs.order_by('-status', 'name')

    def perform_create(self, serializer):
        status_val = serializer.validated_data.get('status')
        instance = serializer.save()
        if status_val == 'Active':
            Term.objects.filter(organization=instance.organization).exclude(id=instance.id).update(status='Planning')

    def perform_update(self, serializer):
        status_val = serializer.validated_data.get('status')
        instance = serializer.save()
        if status_val == 'Active':
            Term.objects.filter(organization=instance.organization).exclude(id=instance.id).update(status='Planning')


class StudentViewSet(viewsets.ModelViewSet):
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

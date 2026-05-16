import logging

from django.db.models import Count, Exists, OuterRef, Q, Value, BooleanField
from drf_spectacular.utils import extend_schema
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from ..models import CourseCatalog, CourseSection, ExamPeriodSectionExclusion, Organization, Term
from ..serializers import CourseCatalogSerializer, CourseSectionSerializer
from ..services.course_loader import CourseLoaderService

logger = logging.getLogger(__name__)


class CourseCatalogViewSet(viewsets.ModelViewSet):
    serializer_class = CourseCatalogSerializer

    def get_queryset(self):
        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()

        if term:
            qs = CourseCatalog.objects.filter(sections__term=term).distinct()
        else:
            qs = CourseCatalog.objects.all()

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
        file = request.FILES.get('file')
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

        raw = file.read()
        try:
            result = CourseLoaderService().process_file(raw, file.name, term_id=str(term_id))
        except Exception as e:
            logger.exception("Unexpected error in course upload")
            return Response(
                {"error": f"İşlem sırasında beklenmeyen bir hata oluştu: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        if "error" in result:
            return Response(result, status=status.HTTP_400_BAD_REQUEST)

        return Response(result, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['delete'], url_path='deleteAll')
    def delete_all(self, request):
        from ..models import AcademicUnit, Enrollment, Instructor, Student, StudentGroup

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


class CourseSectionViewSet(viewsets.ModelViewSet):
    serializer_class = CourseSectionSerializer
    http_method_names = ['get', 'head', 'options']

    def get_queryset(self):
        include_empty = self.request.query_params.get('include_empty') == 'true'
        qs = CourseSection.objects.select_related('course', 'course__academic_unit').annotate(
            enrollment_count=Count('enrollments')
        )
        if not include_empty:
            qs = qs.filter(enrollment_count__gt=0)
        term_id = self.request.query_params.get('term_id')
        if term_id:
            qs = qs.filter(term_id=term_id)
        exam_period_id = self.request.query_params.get('exam_period_id')
        if exam_period_id:
            qs = qs.annotate(
                excluded_from_optimization=Exists(
                    ExamPeriodSectionExclusion.objects.filter(
                        exam_period_id=exam_period_id,
                        course_section_id=OuterRef('id'),
                    )
                )
            )
        else:
            qs = qs.annotate(
                excluded_from_optimization=Value(False, output_field=BooleanField())
            )
        return qs.order_by('course__code')

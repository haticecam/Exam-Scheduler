from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ..models import CourseSection, GeneratedSolution, Organization, Resource, Student, Term
from ..tasks import dummy_gurobi_task


class DashboardStatsView(APIView):
    def get(self, request):
        org = Organization.objects.first()
        term = Term.objects.filter(organization=org, status='Active').first()

        room_count = Resource.objects.filter(
            type='CLASSROOM', is_active=True, capacity__isnull=False
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
            "room_count": room_count,
        })


class SystemStatusView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({
            "status": "online",
            "message": "Exam Scheduler Backend API is running."
        })

    def post(self, request):
        task = dummy_gurobi_task.delay()
        return Response({
            "status": "task_dispatched",
            "task_id": task.id,
            "message": "Dummy Gurobi task has been pushed to the Celery queue."
        })

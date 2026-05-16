from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    AcademicUnitViewSet, CourseCatalogViewSet, CourseSectionViewSet, DashboardStatsView,
    ExamDateSlotViewSet, ExamPeriodViewSet, LLMConfirmView, LLMConfigureView,
    LLMDiagnoseView, LLMLibraryView, OptimizerViewSet, OrganizationViewSet,
    ResourceViewSet, SimulateStudentsView, SimultaneousExamGroupViewSet,
    StudentViewSet, SystemStatusView, TermViewSet,
)

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet, basename='organization')
router.register(r'courses', CourseCatalogViewSet, basename='course')
router.register(r'academic-units', AcademicUnitViewSet, basename='academic-unit')
router.register(r'terms', TermViewSet, basename='term')
router.register(r'students', StudentViewSet, basename='student')
router.register(r'resources', ResourceViewSet, basename='resource')
router.register(r'course-sections', CourseSectionViewSet, basename='course-section')
router.register(r'optimize', OptimizerViewSet, basename='optimize')
router.register(r'exam-periods', ExamPeriodViewSet, basename='exam-period')
router.register(r'exam-date-slots', ExamDateSlotViewSet, basename='exam-date-slot')
router.register(r'simultaneous-groups', SimultaneousExamGroupViewSet, basename='simultaneous-group')

urlpatterns = [
    path('status/', SystemStatusView.as_view(), name='system-status'),
    path('dashboard/stats/', DashboardStatsView.as_view(), name='dashboard-stats'),
    path('simulateStudents/', SimulateStudentsView.as_view(), name='simulate-students'),

    # LLM Integration endpoints
    path('llm/configure/', LLMConfigureView.as_view(), name='llm-configure'),
    path('llm/confirm/', LLMConfirmView.as_view(), name='llm-confirm'),
    path('llm/diagnose/', LLMDiagnoseView.as_view(), name='llm-diagnose'),
    path('llm/library/', LLMLibraryView.as_view(), name='llm-library'),

    path('', include(router.urls)),
]

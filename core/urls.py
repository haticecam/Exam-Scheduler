from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import SystemStatusView, OrganizationViewSet, CourseCatalogViewSet, AcademicUnitViewSet, SimulateStudentsView, TermViewSet, StudentViewSet, OptimizerViewSet, DashboardStatsView, ResourceViewSet

router = DefaultRouter()
router.register(r'organizations', OrganizationViewSet, basename='organization')
router.register(r'courses', CourseCatalogViewSet, basename='course')
router.register(r'academic-units', AcademicUnitViewSet, basename='academic-unit')
router.register(r'terms', TermViewSet, basename='term')
router.register(r'students', StudentViewSet, basename='student')
router.register(r'resources', ResourceViewSet, basename='resource')
router.register(r'optimize', OptimizerViewSet, basename='optimize')

urlpatterns = [
    path('status/', SystemStatusView.as_view(), name='system-status'),
    path('dashboard/stats/', DashboardStatsView.as_view(), name='dashboard-stats'),
    path('simulateStudents/', SimulateStudentsView.as_view(), name='simulate-students'),
    path('', include(router.urls)),
]

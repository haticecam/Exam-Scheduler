from django.contrib import admin
from .models import (
    Organization, Term, AcademicUnit, CourseCatalog, CourseSection,
    GeneratedSolution, Student, Enrollment, Instructor, StudentGroup,
    Resource, ExamPeriod
)


@admin.register(Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ['name', 'subscription_plan', 'created_at']
    search_fields = ['name', 'domain']


@admin.register(Term)
class TermAdmin(admin.ModelAdmin):
    list_display = ['name', 'organization', 'status']
    list_filter = ['status']
    search_fields = ['name']


@admin.register(AcademicUnit)
class AcademicUnitAdmin(admin.ModelAdmin):
    list_display = ['name', 'type', 'organization']
    list_filter = ['type']
    search_fields = ['name']


@admin.register(CourseCatalog)
class CourseCatalogAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'year_level', 'requirement', 'academic_unit']
    search_fields = ['code', 'name']
    list_filter = ['year_level', 'requirement']


@admin.register(CourseSection)
class CourseSectionAdmin(admin.ModelAdmin):
    list_display = ['course', 'section_code', 'term', 'instructor', 'max_enrollment']
    search_fields = ['section_code', 'course__name']
    list_filter = ['term']


@admin.register(GeneratedSolution)
class GeneratedSolutionAdmin(admin.ModelAdmin):
    list_display = ['name', 'status', 'score', 'created_at', 'term']
    list_filter = ['status']
    readonly_fields = ['detailed_schedule', 'detailed_penalties', 'solver_metadata', 'celery_task_id']
    search_fields = ['name']


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ['identifier', 'year_level', 'organization', 'student_group']
    search_fields = ['identifier']


@admin.register(Instructor)
class InstructorAdmin(admin.ModelAdmin):
    list_display = ['name', 'title', 'academic_unit', 'contract_type']
    search_fields = ['name']


@admin.register(StudentGroup)
class StudentGroupAdmin(admin.ModelAdmin):
    list_display = ['name', 'academic_unit', 'year_level', 'size_estimate']
    list_filter = ['year_level']


@admin.register(Resource)
class ResourceAdmin(admin.ModelAdmin):
    list_display = ['name', 'type', 'capacity', 'is_active', 'organization']
    list_filter = ['type', 'is_active']
    search_fields = ['name']


@admin.register(ExamPeriod)
class ExamPeriodAdmin(admin.ModelAdmin):
    list_display = ['name', 'term', 'exam_type', 'start_date', 'end_date']
    list_filter = ['exam_type']


admin.site.register(Enrollment)

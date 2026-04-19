from rest_framework import serializers
from .models import Organization, CourseCatalog, AcademicUnit, Term, Student

class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ['id', 'name', 'domain', 'subscription_plan', 'config', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

class CourseCatalogSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseCatalog
        fields = '__all__'
        read_only_fields = ['id', 'created_at', 'updated_at']

class AcademicUnitSerializer(serializers.ModelSerializer):
    class Meta:
        model = AcademicUnit
        fields = '__all__'
        read_only_fields = ['id', 'deleted_at']

class TermSerializer(serializers.ModelSerializer):
    class Meta:
        model = Term
        fields = '__all__'
        read_only_fields = ['id']

class StudentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = ['id', 'organization', 'student_group', 'year_level', 'identifier']
        read_only_fields = ['id']

class OptimizeRequestSerializer(serializers.Serializer):
    term_id = serializers.UUIDField(help_text="Required Term ID")
    name = serializers.CharField(max_length=255, required=False, help_text="Label for this solution run (e.g. 'Fall 2025 Test 1')")
    hard_threshold = serializers.IntegerField(default=5, min_value=1, max_value=10000, help_text="Shared student count above which two courses are hard-conflicted.")
    time_limit = serializers.IntegerField(default=300, min_value=10, max_value=86400, help_text="Gurobi time limit in seconds.")
    mip_gap = serializers.FloatField(default=0.10, min_value=0.0, max_value=1.0, help_text="MIP gap tolerance (0.10 = 10%)")
    no_back_to_back = serializers.BooleanField(default=False, help_text="Prevent consecutive exams for same dept/year (hard constraint).")
    exam_days = serializers.IntegerField(default=5, min_value=1, max_value=60, help_text="Total exam days to spread across.")
    slots_per_day = serializers.IntegerField(default=10, min_value=1, max_value=16, help_text="Number of 1-hour slots per day.")
    start_hour = serializers.IntegerField(default=8, min_value=0, max_value=23, help_text="Exam day start hour (e.g. 8 → exams from 08:30).")

    def validate(self, data):
        if data['start_hour'] + data['slots_per_day'] > 24:
            raise serializers.ValidationError(
                "start_hour + slots_per_day must not exceed 24 (not enough hours in a day)."
            )
        return data

class SimulateStudentsRequestSerializer(serializers.Serializer):
    term_id = serializers.UUIDField(required=True, help_text="Term ID to simulate for.")
    academic_unit_id = serializers.UUIDField(required=False, help_text="Optional: filter to a single department.")

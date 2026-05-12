from rest_framework import serializers
from .models import Organization, CourseCatalog, AcademicUnit, Term, Student, Resource

class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ['id', 'name', 'domain', 'subscription_plan', 'config', 'created_at', 'updated_at']
        read_only_fields = ['id', 'created_at', 'updated_at']

class ResourceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Resource
        fields = '__all__'
        read_only_fields = ['id']

    def create(self, validated_data):
        if validated_data.get('exam_capacity') is None:
            capacity = validated_data.get('capacity')
            room_type = validated_data.get('type', '')
            if capacity is not None:
                if room_type == 'CLASSROOM':
                    validated_data['exam_capacity'] = capacity // 2
                elif room_type == 'AMPHITHEATER':
                    validated_data['exam_capacity'] = capacity // 3
        return super().create(validated_data)

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
    hard_threshold = serializers.IntegerField(default=5, min_value=0, max_value=10000, help_text="Shared student count above which two courses are hard-conflicted.")
    time_limit = serializers.IntegerField(default=None, min_value=10, max_value=86400, allow_null=True, required=False, help_text="Gurobi time limit in seconds. Omit or set null for no limit.")
    mip_gap = serializers.FloatField(default=0.10, min_value=0.0, max_value=1.0, help_text="MIP gap tolerance (0.10 = 10%)")
    no_back_to_back = serializers.BooleanField(default=False, help_text="Prevent consecutive exams for same dept/year (hard constraint).")
    exam_days = serializers.IntegerField(default=5, min_value=1, max_value=60, help_text="Total exam days to spread across.")
    slots_per_day = serializers.IntegerField(default=20, min_value=1, max_value=40, help_text="Number of 30-minute slots per day (20 = 10 hours).")
    start_hour = serializers.IntegerField(default=8, min_value=0, max_value=23, help_text="Exam day start hour (e.g. 8 → exams from 08:30).")
    year_order_weight = serializers.FloatField(default=100.0, min_value=10.0, max_value=500.0, required=False, help_text="Strength of the year-ordering preference (10–500).")
    year_order_sequence = serializers.ListField(child=serializers.IntegerField(min_value=1, max_value=10), required=False, allow_null=True, default=None, help_text="Year levels in desired scheduling order, earliest first (e.g. [4,1] puts 4th year exams first).")
    year_order_weights = serializers.DictField(child=serializers.FloatField(min_value=10.0, max_value=500.0), required=False, allow_null=True, default=None, help_text="Per-year penalty weights as {year_level: weight}. Falls back to year_order_weight for unlisted years.")
    proposed_params = serializers.DictField(required=False, allow_null=True, default=None, help_text="Raw LLM proposed_params (blueprint code → value). Used to derive weight_config and other non-form LLM suggestions.")
    exam_period_id = serializers.UUIDField(
        required=False,
        allow_null=True,
        default=None,
        help_text=(
            "ExamPeriod ID. When set, the optimizer derives exam_days, slots_per_day, "
            "start_hour, and blocked slots from the saved calendar instead of form fields."
        ),
    )

    def validate(self, data):
        # Each slot is 30 min; first slot starts at start_hour:30
        total_minutes = data['start_hour'] * 60 + 30 + data['slots_per_day'] * 30
        if total_minutes > 24 * 60:
            raise serializers.ValidationError(
                "start_hour and slots_per_day exceed 24 hours. Reduce slots_per_day or start_hour."
            )
        return data

class SimulateStudentsRequestSerializer(serializers.Serializer):
    term_id = serializers.UUIDField(required=True, help_text="Term ID to simulate for.")
    academic_unit_id = serializers.UUIDField(required=False, help_text="Optional: filter to a single department.")


# ─────────────────────────────────────────────────────────────────
#  LLM Integration Serializers
# ─────────────────────────────────────────────────────────────────

class LLMConfigureRequestSerializer(serializers.Serializer):
    """Request body for POST /api/llm/configure/"""
    message = serializers.CharField(
        help_text="Natural language scheduling preference from the administrator. "
                  "Example: 'Spread exams over more days and prevent back-to-back exams'"
    )
    term_id = serializers.UUIDField(
        required=False,
        help_text="Optional term ID for context."
    )
    conversation_history = serializers.ListField(
        child=serializers.DictField(),
        required=False,
        default=list,
        help_text="Optional previous messages for multi-turn refinement. "
                  "Each item: {role: 'user'|'assistant', content: '...'}"
    )


class LLMConfirmRequestSerializer(serializers.Serializer):
    """Request body for POST /api/llm/confirm/"""
    term_id = serializers.UUIDField(
        help_text="The term to run the optimization for."
    )
    name = serializers.CharField(
        max_length=255,
        required=False,
        help_text="Label for this solution run."
    )
    proposed_params = serializers.DictField(
        help_text="The proposed_params dict returned by /api/llm/configure/. "
                  "Example: {'PARAM_EXAM_DAYS': 7, 'PARAM_NO_BACK_TO_BACK': true}"
    )


class LLMDiagnoseRequestSerializer(serializers.Serializer):
    """Request body for POST /api/llm/diagnose/"""
    solution_id = serializers.UUIDField(
        help_text="The ID of an INFEASIBLE GeneratedSolution to diagnose."
    )

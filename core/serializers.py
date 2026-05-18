from django.contrib.auth.models import User
from rest_framework import serializers
from .models import (
    Organization, CourseCatalog, AcademicUnit, Term, Student, Resource,
    CourseSection, ExamPeriod, ExamDateSlot,
    SimultaneousExamGroup, SimultaneousExamGroupCourse,
)
from core.services.exam_duration import group_exam_duration_minutes


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

class CourseSectionSerializer(serializers.ModelSerializer):
    course_id = serializers.UUIDField(source='course.id', read_only=True)
    course_code = serializers.CharField(source='course.code', read_only=True)
    course_name = serializers.CharField(source='course.name', read_only=True)
    year_level = serializers.IntegerField(source='course.year_level', read_only=True, allow_null=True)
    academic_unit_name = serializers.SerializerMethodField()
    exam_duration_minutes = serializers.IntegerField(
        source='course.exam_duration_minutes', read_only=True, allow_null=True
    )
    weekly_hours_lecture = serializers.IntegerField(
        source='course.weekly_hours_lecture', read_only=True, allow_null=True
    )
    academic_unit_id = serializers.UUIDField(
        source='course.academic_unit_id', read_only=True, allow_null=True
    )
    requirement = serializers.CharField(
        source='course.requirement', read_only=True, allow_null=True
    )
    excluded_from_optimization = serializers.SerializerMethodField()

    def get_academic_unit_name(self, obj):
        if obj.course.academic_unit:
            return obj.course.academic_unit.name
        return None

    def get_excluded_from_optimization(self, obj):
        return getattr(obj, 'excluded_from_optimization', False)

    class Meta:
        model = CourseSection
        fields = [
            'id', 'section_code', 'course_id', 'course_code', 'course_name',
            'year_level', 'academic_unit_name', 'academic_unit_id',
            'requirement', 'exam_duration_minutes',
            'weekly_hours_lecture', 'excluded_from_optimization',
        ]
        read_only_fields = [
            'id', 'section_code', 'course_id', 'course_code', 'course_name',
            'year_level', 'academic_unit_name', 'academic_unit_id',
            'requirement', 'exam_duration_minutes',
            'weekly_hours_lecture', 'excluded_from_optimization',
        ]


class OptimizeRequestSerializer(serializers.Serializer):
    term_id = serializers.UUIDField(help_text="Required Term ID")
    name = serializers.CharField(max_length=255, required=False, help_text="Label for this solution run (e.g. 'Fall 2025 Test 1')")
    hard_threshold = serializers.IntegerField(default=5, min_value=0, max_value=10000, help_text="Shared student count above which two courses are hard-conflicted.")
    time_limit = serializers.IntegerField(default=300, min_value=1, allow_null=False, required=False, help_text="Gurobi time limit in seconds. Default 300 (5 min).")
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


# ─────────────────────────────────────────────────────────────────
#  Auth Serializers
# ─────────────────────────────────────────────────────────────────

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, min_length=8)
    password2 = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ('username', 'email', 'password', 'password2')

    def validate(self, data):
        if data['password'] != data['password2']:
            raise serializers.ValidationError({'password2': 'Passwords do not match.'})
        return data

    def create(self, validated_data):
        validated_data.pop('password2')
        return User.objects.create_user(**validated_data)


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()


class PasswordResetConfirmSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()
    new_password = serializers.CharField(min_length=8, write_only=True)


# ─────────────────────────────────────────────────────────────────
#  Exam Period Serializers
# ─────────────────────────────────────────────────────────────────

class ExamDateSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamDateSlot
        fields = ["id", "exam_period", "date", "start_time", "end_time", "label", "is_blocked"]
        read_only_fields = ["id"]


class ExamPeriodSerializer(serializers.ModelSerializer):
    slot_count = serializers.SerializerMethodField()
    blocked_count = serializers.SerializerMethodField()

    class Meta:
        model = ExamPeriod
        fields = [
            "id", "term", "name", "exam_type",
            "start_date", "end_date", "config",
            "slot_count", "blocked_count",
        ]
        read_only_fields = ["id"]

    def get_slot_count(self, obj):
        return obj.date_slots.count()

    def get_blocked_count(self, obj):
        return obj.date_slots.filter(is_blocked=True).count()


class GenerateSlotsRequestSerializer(serializers.Serializer):
    day_start = serializers.TimeField(help_text="Day start time, e.g. '08:30'")
    day_end = serializers.TimeField(help_text="Day end time, e.g. '18:00'")
    slot_duration_minutes = serializers.IntegerField(
        required=False,
        default=30,
        min_value=15,
        max_value=480,
        help_text="Slot duration in minutes (default 30). E.g. 90 → 90-minute exam windows.",
    )

    def validate(self, data):
        if data["day_start"] >= data["day_end"]:
            raise serializers.ValidationError("day_start must be before day_end")
        return data


# ─────────────────────────────────────────────────────────────────
#  Simultaneous Exam Serializers
# ─────────────────────────────────────────────────────────────────

class SimultaneousExamGroupCourseSerializer(serializers.ModelSerializer):
    course_id = serializers.UUIDField(source='course.id', read_only=True)
    code = serializers.CharField(source='course.code', read_only=True)
    name = serializers.CharField(source='course.name', read_only=True)
    year_level = serializers.IntegerField(source='course.year_level', read_only=True, allow_null=True)
    exam_duration_minutes = serializers.IntegerField(
        source='course.exam_duration_minutes', read_only=True, allow_null=True
    )
    weekly_hours_lecture = serializers.IntegerField(
        source='course.weekly_hours_lecture', read_only=True, allow_null=True
    )

    class Meta:
        model = SimultaneousExamGroupCourse
        fields = ['course_id', 'code', 'name', 'year_level',
                  'exam_duration_minutes', 'weekly_hours_lecture']


class SimultaneousExamGroupSerializer(serializers.ModelSerializer):
    courses = SimultaneousExamGroupCourseSerializer(source='group_courses', many=True, read_only=True)
    slot_date = serializers.DateField(source='slot.date', read_only=True, default=None)
    slot_start_time = serializers.TimeField(source='slot.start_time', read_only=True, default=None)
    slot_end_time = serializers.TimeField(source='slot.end_time', read_only=True, default=None)
    course_ids = serializers.ListField(child=serializers.UUIDField(), write_only=True)

    class Meta:
        model = SimultaneousExamGroup
        fields = [
            'id', 'exam_period', 'slot', 'label',
            'slot_date', 'slot_start_time', 'slot_end_time',
            'courses', 'course_ids',
        ]
        read_only_fields = ['id', 'label']

    def validate(self, attrs):
        period = attrs.get('exam_period')
        slot = attrs.get('slot')
        course_ids = attrs.get('course_ids') or []

        if slot is None or not course_ids:
            return attrs

        session_mode = (period.config or {}).get('slot_mode') == 'session'
        slot_duration_minutes = (
            self._minutes(slot.end_time) - self._minutes(slot.start_time)
        )

        new_courses = list(CourseCatalog.objects.filter(id__in=course_ids))
        new_dur = group_exam_duration_minutes(
            new_courses,
            slot_duration_minutes=slot_duration_minutes,
            session_mode=session_mode,
        )
        new_start = self._minutes(slot.start_time)
        new_end = new_start + new_dur

        siblings = (
            SimultaneousExamGroup.objects
            .filter(exam_period=period, slot__date=slot.date)
            .exclude(slot__isnull=True)
            .exclude(pk=self.instance.pk if self.instance else None)
            .prefetch_related('group_courses__course', 'slot')
        )

        for g in siblings:
            g_courses = [gc.course for gc in g.group_courses.all()]
            g_dur = group_exam_duration_minutes(
                g_courses,
                slot_duration_minutes=slot_duration_minutes,
                session_mode=session_mode,
            )
            g_start = self._minutes(g.slot.start_time)
            g_end = g_start + g_dur
            if new_start < g_end and g_start < new_end:
                label = g.label or "(eş zamanlı grup)"
                raise serializers.ValidationError({
                    'slot': f"Bu slot '{label}' grubuyla çakışıyor."
                })

        return attrs

    @staticmethod
    def _minutes(t):
        return t.hour * 60 + t.minute

    def create(self, validated_data):
        course_ids = validated_data.pop('course_ids')
        existing_count = SimultaneousExamGroup.objects.filter(
            exam_period=validated_data['exam_period']
        ).count()
        group = SimultaneousExamGroup.objects.create(
            label=f"Grup {existing_count + 1}",
            **validated_data,
        )
        SimultaneousExamGroupCourse.objects.bulk_create([
            SimultaneousExamGroupCourse(group=group, course_id=cid)
            for cid in course_ids
        ])
        return group

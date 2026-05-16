from rest_framework import serializers
from .models import SimultaneousExamGroup, SimultaneousExamGroupCourse, CourseCatalog
from core.services.exam_duration import group_exam_duration_minutes


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

        # Nothing to validate if slot is unset (group will sit unpinned).
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
            # Strict half-open intervals: [start, end). Adjacent (==) does not overlap.
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

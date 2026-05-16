from rest_framework import serializers
from .models import SimultaneousExamGroup, SimultaneousExamGroupCourse, CourseCatalog


class SimultaneousExamGroupCourseSerializer(serializers.ModelSerializer):
    course_id = serializers.UUIDField(source='course.id', read_only=True)
    code = serializers.CharField(source='course.code', read_only=True)
    name = serializers.CharField(source='course.name', read_only=True)
    year_level = serializers.IntegerField(source='course.year_level', read_only=True, allow_null=True)

    class Meta:
        model = SimultaneousExamGroupCourse
        fields = ['course_id', 'code', 'name', 'year_level']


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

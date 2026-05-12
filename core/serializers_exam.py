from rest_framework import serializers
from .models import ExamPeriod, ExamDateSlot


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

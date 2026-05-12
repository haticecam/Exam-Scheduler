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


class SlotDefinitionSerializer(serializers.Serializer):
    start = serializers.TimeField(help_text="Slot start time, e.g. '09:00'")
    end = serializers.TimeField(help_text="Slot end time, e.g. '12:00'")
    label = serializers.CharField(required=False, allow_blank=True, help_text="Optional label, e.g. '1. Oturum'")

    def validate(self, data):
        if data["start"] >= data["end"]:
            raise serializers.ValidationError("start must be before end")
        return data


class GenerateSlotsRequestSerializer(serializers.Serializer):
    # Mode A: auto-generate 30-minute slots between two times
    day_start = serializers.TimeField(required=False, allow_null=True, help_text="Auto mode: day start, e.g. '08:30'")
    day_end = serializers.TimeField(required=False, allow_null=True, help_text="Auto mode: day end, e.g. '18:00'")
    # Mode B: user-defined sessions
    slots = serializers.ListField(
        child=SlotDefinitionSerializer(),
        required=False,
        allow_null=True,
        allow_empty=False,
        help_text='Session mode: [{"start": "09:00", "end": "12:00", "label": "Sabah"}, ...]',
    )

    def validate(self, data):
        has_auto = data.get("day_start") and data.get("day_end")
        has_manual = data.get("slots")
        if not has_auto and not has_manual:
            raise serializers.ValidationError(
                "Provide either day_start+day_end (auto 30-min) or slots list (manual sessions)."
            )
        if has_auto and data["day_start"] >= data["day_end"]:
            raise serializers.ValidationError("day_start must be before day_end")
        return data

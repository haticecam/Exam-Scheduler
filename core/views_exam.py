import datetime
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import ExamPeriod, ExamDateSlot, CourseSection, ExamPeriodSectionExclusion
from .serializers_exam import ExamPeriodSerializer, ExamDateSlotSerializer, GenerateSlotsRequestSerializer


class ExamPeriodViewSet(viewsets.ModelViewSet):
    serializer_class = ExamPeriodSerializer

    def get_queryset(self):
        qs = ExamPeriod.objects.prefetch_related("date_slots").order_by("-start_date")
        term_id = self.request.query_params.get("term_id")
        if term_id:
            qs = qs.filter(term_id=term_id)
        return qs

    @action(detail=True, methods=["post"], url_path="generate-slots")
    def generate_slots(self, request, pk=None):
        period = self.get_object()
        serializer = GenerateSlotsRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        period.date_slots.all().delete()

        slot_duration_minutes = data.get("slot_duration_minutes") or 30
        slot_mode = "30min" if slot_duration_minutes == 30 else "session"
        day_start = data["day_start"]
        day_end = data["day_end"]
        slot_delta = datetime.timedelta(minutes=slot_duration_minutes)

        slots = []
        current_date = period.start_date
        one_day = datetime.timedelta(days=1)

        while current_date <= period.end_date:
            current_dt = datetime.datetime.combine(current_date, day_start)
            end_dt = datetime.datetime.combine(current_date, day_end)
            while current_dt + slot_delta <= end_dt:
                slot_end_dt = current_dt + slot_delta
                slots.append(ExamDateSlot(
                    exam_period=period,
                    date=current_date,
                    start_time=current_dt.time(),
                    end_time=slot_end_dt.time(),
                    label=f"{current_dt.strftime('%H:%M')}-{slot_end_dt.strftime('%H:%M')}",
                    is_blocked=False,
                ))
                current_dt = slot_end_dt
            current_date += one_day

        ExamDateSlot.objects.bulk_create(slots)
        # Store mode in period.config so the optimizer can detect session vs 30-min mode
        period.config = {**period.config, "slot_mode": slot_mode}
        period.save(update_fields=["config"])

        return Response(
            {
                "created": len(slots),
                "days": (period.end_date - period.start_date).days + 1,
                "slot_mode": slot_mode,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="toggle-day")
    def toggle_day(self, request, pk=None):
        period = self.get_object()
        date_str = request.data.get("date")
        blocked = request.data.get("blocked", True)

        if not date_str:
            return Response({"error": "date is required (YYYY-MM-DD)"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            date = datetime.date.fromisoformat(date_str)
        except ValueError:
            return Response({"error": "Invalid date format, use YYYY-MM-DD"}, status=status.HTTP_400_BAD_REQUEST)

        updated = ExamDateSlot.objects.filter(exam_period=period, date=date).update(is_blocked=blocked)
        return Response({"updated": updated, "date": date_str, "blocked": blocked})

    @action(detail=True, methods=["get"], url_path="slots")
    def slots(self, request, pk=None):
        period = self.get_object()
        qs = period.date_slots.order_by("date", "start_time")
        serializer = ExamDateSlotSerializer(qs, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="toggle-exclusion")
    def toggle_exclusion(self, request, pk=None):
        period = self.get_object()
        section_id = request.data.get("section_id")
        if not section_id:
            return Response({"error": "section_id is required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            section = CourseSection.objects.get(id=section_id)
        except CourseSection.DoesNotExist:
            return Response({"error": "Section not found"}, status=status.HTTP_404_NOT_FOUND)
        exclusion = ExamPeriodSectionExclusion.objects.filter(exam_period=period, course_section=section).first()
        if exclusion:
            exclusion.delete()
            excluded = False
        else:
            ExamPeriodSectionExclusion.objects.create(exam_period=period, course_section=section)
            excluded = True
        return Response({"excluded": excluded, "section_id": str(section_id)})


class ExamDateSlotViewSet(viewsets.ModelViewSet):
    serializer_class = ExamDateSlotSerializer
    http_method_names = ["get", "patch", "head", "options"]

    def get_queryset(self):
        return ExamDateSlot.objects.order_by("date", "start_time")

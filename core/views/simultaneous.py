from rest_framework import viewsets, serializers as drf_serializers
from rest_framework.response import Response

from ..models import SimultaneousExamGroup, SimultaneousExamGroupCourse, ExamDateSlot
from ..serializers import SimultaneousExamGroupSerializer
from ..services.exam_duration import group_exam_duration_minutes


class SimultaneousExamGroupViewSet(viewsets.ModelViewSet):
    serializer_class = SimultaneousExamGroupSerializer
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = SimultaneousExamGroup.objects.prefetch_related(
            'group_courses__course', 'slot'
        ).order_by('label')
        exam_period_id = self.request.query_params.get('exam_period_id')
        if exam_period_id:
            qs = qs.filter(exam_period_id=exam_period_id)
        return qs

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()

        # --- Update course_ids first (may affect duration used in slot check) ---
        if 'course_ids' in request.data:
            course_ids = request.data.get('course_ids') or []
            if len(course_ids) < 2:
                raise drf_serializers.ValidationError(
                    {'course_ids': 'En az 2 ders seçmelisiniz.'}
                )
            instance.group_courses.all().delete()
            SimultaneousExamGroupCourse.objects.bulk_create([
                SimultaneousExamGroupCourse(group=instance, course_id=cid)
                for cid in course_ids
            ])

        # --- Update slot (with conflict check) ---
        if 'slot' in request.data:
            slot_id = request.data.get('slot')
            if slot_id is None:
                instance.slot = None
            else:
                try:
                    new_slot = ExamDateSlot.objects.get(
                        pk=slot_id, exam_period=instance.exam_period
                    )
                except ExamDateSlot.DoesNotExist:
                    raise drf_serializers.ValidationError(
                        {'slot': 'Bu sınav dönemine ait geçerli bir slot değil.'}
                    )
                self._check_slot_conflict(instance, new_slot)
                instance.slot = new_slot
            instance.save(update_fields=['slot'])

        instance.refresh_from_db()
        return Response(self.get_serializer(instance).data)

    @staticmethod
    def _check_slot_conflict(instance: SimultaneousExamGroup, new_slot: ExamDateSlot):
        def _min(t):
            return t.hour * 60 + t.minute

        session_mode = (instance.exam_period.config or {}).get('slot_mode') == 'session'
        slot_duration = _min(new_slot.end_time) - _min(new_slot.start_time)

        courses = [gc.course for gc in instance.group_courses.select_related('course').all()]
        new_dur = group_exam_duration_minutes(
            courses, slot_duration_minutes=slot_duration, session_mode=session_mode
        )
        new_start = _min(new_slot.start_time)
        new_end = new_start + new_dur

        siblings = (
            SimultaneousExamGroup.objects
            .filter(exam_period=instance.exam_period, slot__date=new_slot.date)
            .exclude(slot__isnull=True)
            .exclude(pk=instance.pk)
            .prefetch_related('group_courses__course', 'slot')
        )
        for g in siblings:
            g_courses = [gc.course for gc in g.group_courses.all()]
            g_dur = group_exam_duration_minutes(
                g_courses, slot_duration_minutes=slot_duration, session_mode=session_mode
            )
            g_start = _min(g.slot.start_time)
            g_end = g_start + g_dur
            if new_start < g_end and g_start < new_end:
                raise drf_serializers.ValidationError(
                    {'slot': f"Bu slot '{g.label}' grubuyla çakışıyor."}
                )

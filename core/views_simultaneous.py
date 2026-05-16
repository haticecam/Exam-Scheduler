from rest_framework import viewsets
from .models import SimultaneousExamGroup
from .serializers_simultaneous import SimultaneousExamGroupSerializer


class SimultaneousExamGroupViewSet(viewsets.ModelViewSet):
    serializer_class = SimultaneousExamGroupSerializer
    http_method_names = ['get', 'post', 'delete', 'head', 'options']

    def get_queryset(self):
        qs = SimultaneousExamGroup.objects.prefetch_related(
            'group_courses__course', 'slot'
        ).order_by('label')
        exam_period_id = self.request.query_params.get('exam_period_id')
        if exam_period_id:
            qs = qs.filter(exam_period_id=exam_period_id)
        return qs

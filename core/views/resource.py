from rest_framework import viewsets

from ..models import Resource
from ..serializers import ResourceSerializer


class ResourceViewSet(viewsets.ModelViewSet):
    serializer_class = ResourceSerializer

    def get_queryset(self):
        return Resource.objects.filter(organization__isnull=False)

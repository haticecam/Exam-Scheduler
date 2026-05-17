import logging

from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from ..models import Organization, Resource
from ..serializers import ResourceSerializer
from ..services.room_loader import RoomLoaderService, RoomLoadError

logger = logging.getLogger(__name__)


def _auto_exam_capacity(room_type: str, capacity: int):
    if room_type == "CLASSROOM":
        return capacity // 2
    if room_type == "AMPHITHEATER":
        return capacity // 3
    return None


class ResourceViewSet(viewsets.ModelViewSet):
    serializer_class = ResourceSerializer

    def get_queryset(self):
        return Resource.objects.filter(organization__isnull=False)

    @action(
        detail=False,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
        url_path="upload",
    )
    def upload_xlsx(self, request):
        file = request.FILES.get("file")
        if not file:
            return Response(
                {"error": "Lütfen bir Excel dosyası yükleyin."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        org = Organization.objects.first()
        if org is None:
            return Response(
                {"error": "Önce bir organizasyon oluşturulmalı."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            parsed = RoomLoaderService().parse(file.read())
        except RoomLoadError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception("Unexpected error parsing rooms XLSX")
            return Response(
                {"error": "İşlem sırasında beklenmeyen bir hata oluştu."},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        names_in_file = [r.name for r in parsed]
        in_file_dupes = {n for n in names_in_file if names_in_file.count(n) > 1}

        existing_dupes = set(
            Resource.objects.filter(organization=org, name__in=names_in_file)
            .values_list("name", flat=True)
        )

        all_dupes = sorted(in_file_dupes | existing_dupes)
        if all_dupes:
            return Response(
                {
                    "error": (
                        "Aşağıdaki oda adları sistemde zaten mevcut: "
                        f"{', '.join(all_dupes)} — yükleme iptal edildi."
                    ),
                    "duplicate_names": all_dupes,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        new_rooms = [
            Resource(
                organization=org,
                name=r.name,
                type=r.type,
                capacity=r.capacity,
                exam_capacity=(
                    r.exam_capacity
                    if r.exam_capacity is not None
                    else _auto_exam_capacity(r.type, r.capacity)
                ),
                attributes={},
                availability={"allowed_days": None, "allowed_unit_ids": None},
                is_active=True,
            )
            for r in parsed
        ]

        with transaction.atomic():
            Resource.objects.bulk_create(new_rooms)

        return Response(
            {"created": len(new_rooms), "rooms": [r.name for r in new_rooms]},
            status=status.HTTP_200_OK,
        )

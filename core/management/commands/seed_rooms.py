from django.core.management.base import BaseCommand, CommandError
from core.models import Organization, Resource

EXAM_ROOMS: dict[str, int] = {
    "CZ08-09":   132 // 3, "C111-112":  135 // 3, "A222-224":  77 // 3,
    "A218-219":  80 // 3,  "A203-204":  72 // 3,  "A207-208":  72 // 3,
    "A319-320":  72 // 3,  "A315-316":  80 // 3,  "A303-304":  68 // 3,
    "B310":      35 // 3,  "A307-308":  108 // 3, "C406":      48 // 3,
    "B413-414":  108 // 3, "C403-404":  84 // 3,  "A422-423":  96 // 3,
    "A414-415":  100 // 3, "C510":      56 // 3,  "C507":      48 // 3,
    "C506":      48 // 3,  "C501":      56 // 3,  "C502":      56 // 3,
    "C503-504":  84 // 3,  "B515-516":  125 // 3, "DB412":     156 // 3,
}


class Command(BaseCommand):
    help = "Seed the 24 exam rooms into the Resource model for a given organization."

    def add_arguments(self, parser):
        parser.add_argument('--org_id', required=True, help='UUID of the Organization to seed rooms for')

    def handle(self, *args, **options):
        try:
            org = Organization.objects.get(id=options['org_id'])
        except Organization.DoesNotExist:
            raise CommandError(f"Organization with id '{options['org_id']}' not found.")

        created = 0
        skipped = 0
        for name, capacity in EXAM_ROOMS.items():
            _, was_created = Resource.objects.get_or_create(
                organization=org,
                name=name,
                type='EXAM_ROOM',
                defaults={'capacity': capacity, 'is_active': True}
            )
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(self.style.SUCCESS(
            f"Done. Created {created} rooms, skipped {skipped} existing rooms for '{org.name}'."
        ))

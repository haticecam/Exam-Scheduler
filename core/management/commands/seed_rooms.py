from django.core.management.base import BaseCommand, CommandError
from core.models import Organization, Resource

EXAM_ROOMS: dict[str, int] = {
    "CZ08-09":   132, "C111-112":  135, "A222-224":  77,
    "A218-219":  80,  "A203-204":  72,  "A207-208":  72,
    "A319-320":  72,  "A315-316":  80,  "A303-304":  68,
    "B310":      35,  "A307-308":  108, "C406":      48,
    "B413-414":  108, "C403-404":  84,  "A422-423":  96,
    "A414-415":  100, "C510":      56,  "C507":      48,
    "C506":      48,  "C501":      56,  "C502":      56,
    "C503-504":  84,  "B515-516":  125, "DB412":     156,
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
                type='CLASSROOM',
                defaults={'capacity': capacity, 'is_active': True}
            )
            if was_created:
                created += 1
            else:
                skipped += 1

        self.stdout.write(self.style.SUCCESS(
            f"Done. Created {created} rooms, skipped {skipped} existing rooms for '{org.name}'."
        ))

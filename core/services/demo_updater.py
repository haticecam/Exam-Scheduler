import csv
import statistics
from collections import defaultdict
from ..models import AcademicUnit, StudentGroup, CourseCatalog

GRADUATION_KEYWORDS = ["graduation project", "graduation"]
RETAKER_DISCOUNT = 0.82

def is_graduation_course(name: str) -> bool:
    n = name.lower()
    return any(kw in n for kw in GRADUATION_KEYWORDS)

def parse_kon(kon: str):
    try:
        enrolled_s, cap_s = kon.strip().split("/")
        return int(enrolled_s.strip()), int(cap_s.strip())
    except (ValueError, AttributeError):
        return None, None

class DemoUpdaterService:
    def process_csv(self, file_content: str):
        # Decode considering utf-8-sig if there's BOM
        if file_content.startswith('\ufeff'):
            file_content = file_content[1:]
        
        lines = file_content.splitlines()
        if not lines:
            return {"error": "Empty file"}
            
        first = lines[0].strip()
        if first.lower().startswith("table"):
            lines.pop(0)
            
        reader = csv.DictReader(lines, delimiter=";")
        enrollments = defaultdict(list)

        for r in reader:
            name = r.get("Ders Adı_14190", "").strip()
            year_str = r.get("Sınıf_14190", "").strip()
            kon = r.get("Kon_14190", "").strip()
            dept = r.get("Program_14190", "").strip()

            if not name or not dept or is_graduation_course(name):
                continue

            try:
                year = int(year_str)
            except ValueError:
                continue

            enrolled, capacity = parse_kon(kon)
            if enrolled is None or capacity is None or capacity != 999 or enrolled == 0:
                continue

            enrollments[(dept, year)].append(enrolled)

        if not enrollments:
            return {"error": "No valid capacity=999 courses found in the dataset to estimate from."}

        cohort_sizes = {}
        for key, vals in enrollments.items():
            raw = statistics.median(vals)
            size = max(1, round(raw * RETAKER_DISCOUNT))
            cohort_sizes[key] = size

        unit_map = {u.name: u.id for u in AcademicUnit.objects.all()}
        updated = 0
        skipped = 0

        for (dept, year), size in cohort_sizes.items():
            unit_id = unit_map.get(dept)
            if not unit_id:
                for db_name, uid in unit_map.items():
                    if dept.strip().upper() in db_name.strip().upper() or db_name.strip().upper() in dept.strip().upper():
                        unit_id = uid
                        break

            if not unit_id:
                skipped += 1
                continue

            # Update DB
            groups = StudentGroup.objects.filter(academic_unit_id=unit_id, year_level=year)
            for g in groups:
                g.size_estimate = size
                g.save()
                updated += 1

        return {
            "success": True,
            "message": f"Updated cohort sizes for {updated} student groups. Skipped {skipped} unmatched departments.",
            "data_computed": len(cohort_sizes)
        }

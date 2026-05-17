import io
import unicodedata
from dataclasses import dataclass
from typing import Optional

import openpyxl


REQUIRED_HEADERS = ["Oda Adı", "Kapasite", "Tür", "Sınav Kapasitesi"]

TYPE_MAP = {
    "derslik": "CLASSROOM",
    "laboratuvar": "LAB",
    "amfi": "AMPHITHEATER",
}


@dataclass(frozen=True)
class RoomRow:
    name: str
    capacity: int
    type: str
    exam_capacity: Optional[int]


class RoomLoadError(Exception):
    """Raised when the uploaded XLSX is malformed or has row-level errors.

    The first positional arg is the user-facing message (Turkish).
    """


def _norm(s) -> str:
    """Case- and accent-insensitive normalizer (handles Turkish İ correctly)."""
    if s is None:
        return ""
    decomposed = unicodedata.normalize("NFKD", str(s).strip())
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return stripped.casefold()


def _positive_int(v) -> Optional[int]:
    """Return int(v) if v is a positive integer, None if blank, -1 if present-but-invalid."""
    if v is None or (isinstance(v, str) and v.strip() == ""):
        return None
    try:
        n = int(v)
    except (ValueError, TypeError):
        return -1
    return n if n > 0 else -1


class RoomLoaderService:
    """Parse and validate a rooms XLSX file. No DB access."""

    def parse(self, file_bytes: bytes) -> list[RoomRow]:
        try:
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
        except Exception:
            raise RoomLoadError("Geçersiz Excel dosyası.")

        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)

        try:
            header_row = next(rows_iter)
        except StopIteration:
            raise RoomLoadError("Dosyada hiçbir veri satırı bulunamadı.")

        header_lookup = {_norm(h): idx for idx, h in enumerate(header_row) if h is not None}
        missing = [h for h in REQUIRED_HEADERS if _norm(h) not in header_lookup]
        if missing:
            raise RoomLoadError(f"Eksik sütun(lar): {', '.join(missing)}")

        col = {h: header_lookup[_norm(h)] for h in REQUIRED_HEADERS}

        parsed: list[RoomRow] = []
        errors: list[str] = []

        for i, raw in enumerate(rows_iter, start=2):
            if not raw or all(cell is None or str(cell).strip() == "" for cell in raw):
                continue

            def cell(key: str):
                idx = col[key]
                return raw[idx] if idx < len(raw) else None

            name_raw = cell("Oda Adı")
            cap_raw = cell("Kapasite")
            type_raw = cell("Tür")
            exam_raw = cell("Sınav Kapasitesi")

            row_errors: list[str] = []

            name = str(name_raw).strip() if name_raw is not None else ""
            if not name:
                row_errors.append(f"Satır {i}: Oda adı boş olamaz")

            capacity = _positive_int(cap_raw)
            if capacity is None or capacity == -1:
                row_errors.append(f"Satır {i}: Kapasite geçerli bir sayı olmalı")

            type_key = _norm(type_raw)
            mapped_type = TYPE_MAP.get(type_key)
            if mapped_type is None:
                row_errors.append(f"Satır {i}: Geçersiz tür: {type_raw}")

            exam_capacity = _positive_int(exam_raw)
            if exam_capacity == -1:
                row_errors.append(f"Satır {i}: Sınav kapasitesi geçerli bir sayı olmalı")

            if row_errors:
                errors.extend(row_errors)
                continue

            parsed.append(RoomRow(
                name=name,
                capacity=capacity,
                type=mapped_type,
                exam_capacity=exam_capacity,
            ))

        if errors:
            raise RoomLoadError("Dosyada hata bulundu:\n• " + "\n• ".join(errors))

        if not parsed:
            raise RoomLoadError("Dosyada hiçbir veri satırı bulunamadı.")

        return parsed

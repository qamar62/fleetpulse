"""Excel / CSV import wizard.

Pipeline: upload → detect columns → normalise rows → validate → preview → commit.

Design decisions worth knowing:

* A spreadsheet ``TOTAL`` column is never trusted. It is recalculated from the
  platform columns; a mismatch becomes a *warning* on that row, and the
  recalculated value is what gets stored.
* Validation is exhaustive per row, not fail-fast, so the preview step can show
  every problem in the file at once.
* ``analyze`` never writes to the ledger. ``commit`` is a single atomic
  transaction — a file either lands completely or not at all (unless the caller
  explicitly asks to skip invalid rows).
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.conf import settings
from django.db import transaction

from ..models import DailyEarning, Driver, Expense, ImportBatch, ImportRowIssue, Vehicle
from .money import D, ZERO, quantize

PLATFORMS = settings.INCOME_PLATFORMS

# Column aliases, matched case/space/punctuation-insensitively.
COLUMN_ALIASES: dict[str, tuple[str, ...]] = {
    "date": ("date", "day", "trip date", "earning date", "txn date", "transaction date"),
    "driver": ("driver", "driver name", "employee", "captain"),
    "vehicle": ("vehicle", "car", "plate", "plate number", "plate no", "vehicle plate"),
    "careem": ("careem", "kareem"),
    "uber": ("uber",),
    "bolt": ("bolt",),
    "yango": ("yango",),
    "cash": ("cash", "cash income", "cash collection"),
    "total": ("total", "total income", "gross", "gross income", "sum"),
    "fuel": ("fuel", "petrol", "diesel", "fuel cost"),
    "salik": ("salik", "toll", "tolls"),
    "uber_trips": ("uber trips", "uber trip", "uber commission"),
    "washing": ("washing", "wash"),
    "service": ("service", "maintenance", "servicing"),
    "car_wash": ("car wash", "carwash"),
    "other": ("other", "other expense", "misc", "miscellaneous"),
    "notes": ("notes", "note", "remark", "remarks", "comment"),
}

EXPENSE_COLUMNS = ("fuel", "salik", "uber_trips", "washing", "service", "car_wash", "other")

DATE_FORMATS = (
    "%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d.%m.%Y",
    "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%Y/%m/%d", "%d-%b-%Y", "%d-%b-%y",
)


def _normalise(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(label or "").strip().lower()).strip()


class ImportError_(Exception):
    """Raised when a file cannot be read at all."""


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------


def read_table(uploaded_file) -> tuple[list[str], list[list]]:
    """Return (headers, data_rows) from a .csv, .xlsx or .xlsm upload."""
    name = (getattr(uploaded_file, "name", "") or "").lower()
    raw = uploaded_file.read()
    if not raw:
        raise ImportError_("The uploaded file is empty.")
    if len(raw) > settings.MAX_IMPORT_FILE_BYTES:
        raise ImportError_(
            f"File is larger than the {settings.MAX_IMPORT_FILE_BYTES // (1024 * 1024)}MB limit."
        )

    if name.endswith((".xlsx", ".xlsm", ".xltx")):
        return _read_excel(raw)
    if name.endswith((".csv", ".txt", ".tsv")):
        return _read_csv(raw, delimiter="\t" if name.endswith(".tsv") else None)
    # Fall back on content sniffing.
    if raw[:2] == b"PK":
        return _read_excel(raw)
    return _read_csv(raw)


def _read_excel(raw: bytes) -> tuple[list[str], list[list]]:
    try:
        from openpyxl import load_workbook
    except ImportError:  # pragma: no cover
        raise ImportError_("openpyxl is required to read Excel files.")

    try:
        workbook = load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    except Exception as exc:
        raise ImportError_(f"Could not open the workbook: {exc}")

    sheet = workbook[workbook.sheetnames[0]]
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]
    workbook.close()
    return _split_header(rows)


def _read_csv(raw: bytes, delimiter: str | None = None) -> tuple[list[str], list[list]]:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:  # pragma: no cover
        raise ImportError_("Could not decode the file. Save it as UTF-8 CSV and retry.")

    if delimiter is None:
        try:
            delimiter = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|").delimiter
        except csv.Error:
            delimiter = ","

    rows = [row for row in csv.reader(io.StringIO(text), delimiter=delimiter)]
    return _split_header(rows)


def _split_header(rows: list[list]) -> tuple[list[str], list[list]]:
    """Find the real header row — spreadsheets often start with title banners."""
    known = {alias for aliases in COLUMN_ALIASES.values() for alias in aliases}
    best_index, best_score = None, 0

    for index, row in enumerate(rows[:15]):
        cells = [_normalise(cell) for cell in row]
        score = sum(1 for cell in cells if cell and cell in known)
        if score > best_score:
            best_index, best_score = index, score

    if best_index is None or best_score < 2:
        # No recognisable header: treat the first non-empty row as the header.
        best_index = next((i for i, row in enumerate(rows) if any(_clean(c) for c in row)), 0)

    headers = [str(cell).strip() if cell is not None else "" for cell in rows[best_index]]
    body = [row for row in rows[best_index + 1:] if any(_clean(cell) for cell in row)]
    return headers, body


def _clean(value) -> str:
    return "" if value is None else str(value).strip()


# ---------------------------------------------------------------------------
# Column detection
# ---------------------------------------------------------------------------


def detect_columns(headers: list[str]) -> dict:
    mapping: dict[str, int] = {}
    detected = []
    for index, header in enumerate(headers):
        key = _match_column(header)
        detected.append(
            {
                "index": index,
                "header": header,
                "mapped_to": key,
                "confident": key is not None,
            }
        )
        if key and key not in mapping:
            mapping[key] = index
    return {
        "columns": detected,
        "mapping": mapping,
        "unmapped_headers": [c["header"] for c in detected if not c["confident"] and c["header"]],
        "missing_required": [key for key in ("date",) if key not in mapping],
        "recognised_platforms": [name for name in PLATFORMS if name in mapping],
        "recognised_expenses": [name for name in EXPENSE_COLUMNS if name in mapping],
    }


def _match_column(header: str) -> str | None:
    norm = _normalise(header)
    if not norm:
        return None
    for key, aliases in COLUMN_ALIASES.items():
        if norm in aliases:
            return key
    for key, aliases in COLUMN_ALIASES.items():
        if any(norm.startswith(alias) or alias in norm for alias in aliases):
            return key
    return None


# ---------------------------------------------------------------------------
# Value parsing
# ---------------------------------------------------------------------------


def parse_date(value, *, default_year: int | None = None) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value

    text = str(value).strip()
    if not text:
        return None

    # Excel serial date
    if re.fullmatch(r"\d{5}", text):
        try:
            from openpyxl.utils.datetime import from_excel

            converted = from_excel(int(text))
            return converted.date() if isinstance(converted, datetime) else converted
        except Exception:
            pass

    for fmt in DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue

    # "01", "1" — a bare day number inside a monthly sheet
    if default_year and re.fullmatch(r"\d{1,2}", text):
        return None
    return None


def parse_amount(value) -> tuple[Decimal | None, str | None]:
    """Return (amount, error). Blank means zero; garbage means an error."""
    if value is None:
        return ZERO, None
    if isinstance(value, (int, float, Decimal)):
        amount = D(value)
    else:
        raw = str(value).strip()
        # A blank cell, a dash or an explicit "n/a" is a real zero.
        if not raw or raw.lower() in {"-", "--", ".", "n/a", "na", "nil", "none"}:
            return ZERO, None
        text = re.sub(r"[^\d.,\-()]", "", raw)
        if not text or text in {"-", ".", "(", ")", "()"}:
            # There was content, but nothing numeric in it. Zeroing that
            # silently would invent a figure, so report it instead.
            return None, f"'{raw}' is not a valid amount."
        negative = text.startswith("(") and text.endswith(")")
        text = text.strip("()")
        # 1,234.56 vs 1.234,56
        if "," in text and "." in text:
            text = text.replace(",", "") if text.rfind(".") > text.rfind(",") else \
                text.replace(".", "").replace(",", ".")
        elif "," in text:
            text = text.replace(",", "") if len(text.split(",")[-1]) == 3 else text.replace(",", ".")
        try:
            amount = Decimal(text)
        except (InvalidOperation, ValueError):
            return None, f"'{value}' is not a valid amount."
        if negative:
            amount = -amount

    if amount < 0:
        return None, f"Negative amount '{value}' is not allowed."
    return quantize(amount), None


# ---------------------------------------------------------------------------
# Row model
# ---------------------------------------------------------------------------


@dataclass
class ParsedRow:
    row_number: int
    raw: list
    date: date | None = None
    driver_id: int | None = None
    driver_label: str = ""
    vehicle_id: int | None = None
    vehicle_label: str = ""
    platforms: dict = field(default_factory=dict)
    expenses: dict = field(default_factory=dict)
    notes: str = ""
    file_total: Decimal | None = None
    errors: list = field(default_factory=list)
    warnings: list = field(default_factory=list)
    action: str = "create"  # create | update | skip | invalid

    @property
    def computed_total(self) -> Decimal:
        return quantize(sum(self.platforms.values(), ZERO))

    @property
    def total_expenses(self) -> Decimal:
        return quantize(sum(self.expenses.values(), ZERO))

    @property
    def is_valid(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict:
        return {
            "row_number": self.row_number,
            "date": self.date.isoformat() if self.date else None,
            "driver": self.driver_label,
            "driver_id": self.driver_id,
            "vehicle": self.vehicle_label,
            "vehicle_id": self.vehicle_id,
            **{name: self.platforms.get(name, ZERO) for name in PLATFORMS},
            "computed_total": self.computed_total,
            "file_total": self.file_total,
            "expenses": self.expenses,
            "total_expenses": self.total_expenses,
            "notes": self.notes,
            "action": self.action,
            "valid": self.is_valid,
            "errors": self.errors,
            "warnings": self.warnings,
        }


def expense_reference(day: date, driver_id: int, vehicle_id: int, category: str) -> str:
    """Stable identity for an imported expense.

    Imports are re-run: a client edits yesterday's sheet and uploads it again.
    Keying the expense on the row it came from - not on the batch that happened
    to carry it - makes that second upload an update rather than a duplicate.
    Manually entered expenses have a different reference, so they are never
    touched by an import.
    """
    return f"import:{day.isoformat()}:{driver_id}:{vehicle_id}:{category}"


def _issue(column: str, code: str, message: str) -> dict:
    return {"column": column, "code": code, "message": message}


# ---------------------------------------------------------------------------
# Parse + validate
# ---------------------------------------------------------------------------


def parse_rows(
    headers: list[str],
    body: list[list],
    mapping: dict[str, int],
    *,
    default_driver: Driver | None = None,
    default_vehicle: Vehicle | None = None,
) -> list[ParsedRow]:
    drivers = {_normalise(d.name): d for d in Driver.objects.all()}
    vehicles: dict[str, Vehicle] = {}
    for vehicle in Vehicle.objects.all():
        vehicles[_normalise(vehicle.plate_number)] = vehicle
        vehicles[_normalise(str(vehicle))] = vehicle
        vehicles[_normalise(vehicle.display_name)] = vehicle

    existing = {
        (row["date"], row["driver_id"], row["vehicle_id"])
        for row in DailyEarning.objects.values("date", "driver_id", "vehicle_id")
    }
    seen_in_file: set[tuple] = set()
    parsed: list[ParsedRow] = []

    for offset, raw in enumerate(body):
        row = ParsedRow(row_number=offset + 2, raw=[_clean(cell) for cell in raw])

        def cell(key: str):
            index = mapping.get(key)
            return raw[index] if index is not None and index < len(raw) else None

        # --- date
        row.date = parse_date(cell("date"))
        if row.date is None:
            row.errors.append(
                _issue("date", "missing_date",
                       f"Could not read a date from '{_clean(cell('date'))}'.")
            )

        # --- driver
        driver_raw = _clean(cell("driver"))
        if driver_raw:
            driver = drivers.get(_normalise(driver_raw))
            if driver:
                row.driver_id, row.driver_label = driver.id, driver.name
            else:
                row.errors.append(
                    _issue("driver", "unknown_driver", f"No driver named '{driver_raw}'.")
                )
                row.driver_label = driver_raw
        elif default_driver:
            row.driver_id, row.driver_label = default_driver.id, default_driver.name
        else:
            row.errors.append(
                _issue("driver", "missing_driver",
                       "No driver column and no default driver selected.")
            )

        # --- vehicle
        vehicle_raw = _clean(cell("vehicle"))
        if vehicle_raw:
            vehicle = vehicles.get(_normalise(vehicle_raw))
            if vehicle:
                row.vehicle_id, row.vehicle_label = vehicle.id, str(vehicle)
            else:
                row.errors.append(
                    _issue("vehicle", "unknown_vehicle", f"No vehicle matching '{vehicle_raw}'.")
                )
                row.vehicle_label = vehicle_raw
        elif default_vehicle:
            row.vehicle_id, row.vehicle_label = default_vehicle.id, str(default_vehicle)
        else:
            row.errors.append(
                _issue("vehicle", "missing_vehicle",
                       "No vehicle column and no default vehicle selected.")
            )

        # --- platform income
        for name in PLATFORMS:
            amount, error = parse_amount(cell(name))
            if error:
                row.errors.append(_issue(name, "invalid_amount", error))
                amount = ZERO
            row.platforms[name] = amount

        # --- expenses
        for name in EXPENSE_COLUMNS:
            if name not in mapping:
                continue
            amount, error = parse_amount(cell(name))
            if error:
                row.errors.append(_issue(name, "invalid_amount", error))
                continue
            if amount and amount > 0:
                row.expenses[name] = amount

        # --- spreadsheet total is checked, never trusted
        if "total" in mapping:
            file_total, error = parse_amount(cell("total"))
            if error:
                row.warnings.append(_issue("total", "invalid_total", error))
            else:
                row.file_total = file_total
                if file_total != row.computed_total:
                    row.warnings.append(
                        _issue(
                            "total",
                            "total_mismatch",
                            f"File TOTAL {file_total} does not match the platform columns "
                            f"({row.computed_total}). The recalculated value will be stored.",
                        )
                    )

        row.notes = _clean(cell("notes"))

        # --- duplicates
        key = (row.date, row.driver_id, row.vehicle_id)
        if row.date and row.driver_id and row.vehicle_id:
            if key in seen_in_file:
                row.errors.append(
                    _issue("date", "duplicate_in_file",
                           "This date/driver/vehicle appears more than once in the file.")
                )
            seen_in_file.add(key)
            if key in existing:
                row.action = "update"
                row.warnings.append(
                    _issue("date", "already_exists",
                           "An entry already exists for this date, driver and vehicle.")
                )

        # An empty row states nothing. On a new date that is harmless, but
        # letting one overwrite a day that already holds figures would destroy
        # real data every time the client re-uploads a sheet with a gap in it,
        # so the existing entry is left alone instead.
        if row.computed_total == 0 and not row.expenses:
            if row.action == "update":
                row.action = "skip"
                row.warnings.append(
                    _issue("", "empty_row_skipped",
                           "This row is empty and an entry already exists for it. "
                           "The existing entry was left unchanged.")
                )
            else:
                row.warnings.append(
                    _issue("", "empty_row", "This row has no income and no expenses.")
                )

        if not row.is_valid:
            row.action = "invalid"
        parsed.append(row)

    return parsed


def summarise(rows: list[ParsedRow]) -> dict:
    valid = [row for row in rows if row.is_valid]
    return {
        "total_rows": len(rows),
        "valid_rows": len(valid),
        "invalid_rows": len(rows) - len(valid),
        "rows_to_create": sum(1 for row in valid if row.action == "create"),
        "rows_to_update": sum(1 for row in valid if row.action == "update"),
        "rows_to_skip": sum(1 for row in valid if row.action == "skip"),
        "warning_count": sum(len(row.warnings) for row in rows),
        "error_count": sum(len(row.errors) for row in rows),
        "total_income": quantize(sum((row.computed_total for row in valid), ZERO)),
        "total_expenses": quantize(sum((row.total_expenses for row in valid), ZERO)),
        "date_range": _date_range(valid),
    }


def _date_range(rows: list[ParsedRow]) -> dict | None:
    dates = sorted({row.date for row in rows if row.date})
    if not dates:
        return None
    return {"start": dates[0].isoformat(), "end": dates[-1].isoformat()}


# ---------------------------------------------------------------------------
# Analyze (no writes) and commit (atomic)
# ---------------------------------------------------------------------------


def analyze(uploaded_file, *, default_driver=None, default_vehicle=None, preview_limit=50) -> dict:
    headers, body = read_table(uploaded_file)
    detection = detect_columns(headers)
    rows = parse_rows(
        headers, body, detection["mapping"],
        default_driver=default_driver, default_vehicle=default_vehicle,
    )
    return {
        "filename": getattr(uploaded_file, "name", "upload"),
        "headers": headers,
        "detection": detection,
        "summary": summarise(rows),
        "preview": [row.as_dict() for row in rows[:preview_limit]],
        "issues": [
            {"row_number": row.row_number, "level": level, **issue}
            for row in rows
            for level, issues in (("error", row.errors), ("warning", row.warnings))
            for issue in issues
        ],
        "can_commit": bool(rows) and not detection["missing_required"],
    }


@transaction.atomic
def commit(
    uploaded_file,
    *,
    user=None,
    default_driver=None,
    default_vehicle=None,
    skip_invalid: bool = True,
    update_existing: bool = True,
    create_expenses: bool = True,
) -> dict:
    headers, body = read_table(uploaded_file)
    detection = detect_columns(headers)
    rows = parse_rows(
        headers, body, detection["mapping"],
        default_driver=default_driver, default_vehicle=default_vehicle,
    )

    batch = ImportBatch.objects.create(
        filename=getattr(uploaded_file, "name", "upload"),
        total_rows=len(rows),
        column_mapping=detection["mapping"],
        created_by=user if getattr(user, "is_authenticated", False) else None,
    )

    invalid = [row for row in rows if not row.is_valid]
    if invalid and not skip_invalid:
        _record_issues(batch, rows)
        batch.status = ImportBatch.Status.FAILED
        batch.failed_rows = len(invalid)
        batch.error_message = (
            f"{len(invalid)} row(s) failed validation and skip_invalid was not set. "
            "Nothing was imported."
        )
        batch.save()
        transaction.set_rollback(False)
        return _result(batch, rows)

    # Only prune expenses when the sheet actually carried expense columns.
    # A sheet without them says nothing about expenses, so it must not erase any.
    sheet_has_expenses = bool(detection["recognised_expenses"])

    created = updated = skipped = 0
    for row in rows:
        if not row.is_valid:
            continue
        if row.action == "skip":
            skipped += 1
            continue
        if row.action == "update" and not update_existing:
            skipped += 1
            continue

        defaults = {name: row.platforms.get(name, ZERO) for name in PLATFORMS}
        defaults["source_batch"] = batch
        if row.notes:
            defaults["notes"] = row.notes

        _, was_created = DailyEarning.objects.update_or_create(
            date=row.date,
            driver_id=row.driver_id,
            vehicle_id=row.vehicle_id,
            defaults=defaults,
        )
        created += int(was_created)
        updated += int(not was_created)

        if create_expenses and row.expenses:
            for category, amount in row.expenses.items():
                Expense.objects.update_or_create(
                    date=row.date,
                    driver_id=row.driver_id,
                    vehicle_id=row.vehicle_id,
                    category=category,
                    # Keyed on the row, not the batch: re-uploading the same
                    # day must update this expense instead of adding another.
                    reference=expense_reference(
                        row.date, row.driver_id, row.vehicle_id, category
                    ),
                    defaults={
                        "amount": amount,
                        "description": f"Imported from {batch.filename}",
                        "source_batch": batch,
                    },
                )

        if create_expenses and sheet_has_expenses:
            # The sheet is the client's source of truth. Anything this row
            # imported previously - a category they have since cleared, or a
            # duplicate left by an older batch-keyed import - is no longer
            # backed by the file, so it goes. Manually entered expenses carry a
            # different reference and are never touched.
            keep = {
                expense_reference(row.date, row.driver_id, row.vehicle_id, category)
                for category in row.expenses
            }
            Expense.objects.filter(
                date=row.date,
                driver_id=row.driver_id,
                vehicle_id=row.vehicle_id,
                reference__startswith="import:",
            ).exclude(reference__in=keep).delete()

    _record_issues(batch, rows)
    batch.imported_rows = created
    batch.updated_rows = updated
    batch.skipped_rows = skipped
    batch.failed_rows = len(invalid)
    batch.status = (
        ImportBatch.Status.COMPLETED if not invalid else ImportBatch.Status.PARTIAL
    )
    if invalid:
        batch.error_message = f"{len(invalid)} row(s) were skipped because of validation errors."
    batch.save()

    return _result(batch, rows)


def _record_issues(batch: ImportBatch, rows: list[ParsedRow]) -> None:
    ImportRowIssue.objects.bulk_create(
        [
            ImportRowIssue(
                batch=batch,
                row_number=row.row_number,
                column=issue["column"],
                level=level,
                code=issue["code"],
                message=issue["message"],
            )
            for row in rows
            for level, issues in (
                (ImportRowIssue.Level.ERROR, row.errors),
                (ImportRowIssue.Level.WARNING, row.warnings),
            )
            for issue in issues
        ],
        batch_size=500,
    )


def _result(batch: ImportBatch, rows: list[ParsedRow]) -> dict:
    return {
        "batch_id": batch.id,
        "filename": batch.filename,
        "status": batch.status,
        "total_rows": batch.total_rows,
        "created": batch.imported_rows,
        "updated": batch.updated_rows,
        "skipped": batch.skipped_rows,
        "failed": batch.failed_rows,
        "error_message": batch.error_message,
        "summary": summarise(rows),
        "issues": [
            {"row_number": row.row_number, "level": level, **issue}
            for row in rows
            for level, issues in (("error", row.errors), ("warning", row.warnings))
            for issue in issues
        ][:500],
    }


def template_csv() -> str:
    headers = ["Date", "Driver", "Vehicle", *[name.title() for name in PLATFORMS],
               "Fuel", "Salik", "Service", "Car Wash", "Notes"]
    example = ["2025-12-01", "Zeeshan", "D586986", "1180", "1020", "640", "310", "2200",
               "490", "60", "0", "25", "Morning + evening shift"]
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(headers)
    writer.writerow(example)
    return buffer.getvalue()

"""Date range resolution shared by every reporting endpoint.

Supported query parameters:

* ``start`` / ``end``      explicit ISO dates (inclusive)
* ``month=2025-12``        a calendar month
* ``year=2025``            a calendar year
* ``range=7d|30d|90d|month|quarter|year|all``
* ``reference=2025-12-31`` anchor for relative ranges (defaults to today)

Every resolved period also knows its immediately preceding comparison window of
the same length, which is what powers "vs. previous period" on the dashboard.
"""

from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta

from rest_framework.exceptions import ValidationError

RELATIVE_RANGES = {"7d": 7, "30d": 30, "90d": 90}


@dataclass(frozen=True)
class Period:
    start: date | None
    end: date | None
    label: str
    granularity: str = "custom"

    @property
    def is_open(self) -> bool:
        return self.start is None or self.end is None

    @property
    def days(self) -> int | None:
        if self.is_open:
            return None
        return (self.end - self.start).days + 1

    def previous(self) -> "Period | None":
        """The comparable window immediately before this one."""
        if self.is_open:
            return None
        if self.granularity == "month":
            prev_end = self.start - timedelta(days=1)
            prev_start = prev_end.replace(day=1)
            return Period(prev_start, prev_end, f"{prev_start:%B %Y}", "month")
        if self.granularity == "year":
            year = self.start.year - 1
            return Period(date(year, 1, 1), date(year, 12, 31), str(year), "year")
        length = self.days
        prev_end = self.start - timedelta(days=1)
        prev_start = prev_end - timedelta(days=length - 1)
        return Period(prev_start, prev_end, "Previous period", self.granularity)

    def as_dict(self) -> dict:
        return {
            "start": self.start.isoformat() if self.start else None,
            "end": self.end.isoformat() if self.end else None,
            "label": self.label,
            "granularity": self.granularity,
            "days": self.days,
        }


def _parse_date(raw: str, field: str) -> date:
    try:
        return date.fromisoformat(raw.strip())
    except (ValueError, AttributeError):
        raise ValidationError({field: f"Expected an ISO date (YYYY-MM-DD), got '{raw}'."})


def month_bounds(year: int, month: int) -> tuple[date, date]:
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def parse_month(raw: str) -> Period:
    try:
        year_str, month_str = raw.strip().split("-")[:2]
        year, month = int(year_str), int(month_str)
        start, end = month_bounds(year, month)
    except (ValueError, calendar.IllegalMonthError):
        raise ValidationError({"month": f"Expected YYYY-MM, got '{raw}'."})
    return Period(start, end, f"{start:%B %Y}", "month")


def resolve_period(params, *, default: str = "month", reference: date | None = None) -> Period:
    """Build a Period from request query params."""
    today = reference or _reference_from(params) or date.today()

    start_raw = params.get("start") or params.get("date_from")
    end_raw = params.get("end") or params.get("date_to")
    if start_raw and end_raw:
        start = _parse_date(start_raw, "start")
        end = _parse_date(end_raw, "end")
        if start > end:
            raise ValidationError({"start": "start must not be after end."})
        return Period(start, end, f"{start:%d %b %Y} – {end:%d %b %Y}", "custom")

    if params.get("month"):
        return parse_month(params["month"])

    if params.get("year"):
        try:
            year = int(params["year"])
        except ValueError:
            raise ValidationError({"year": "Expected a four digit year."})
        return Period(date(year, 1, 1), date(year, 12, 31), str(year), "year")

    range_key = (params.get("range") or default).strip().lower()

    if range_key in RELATIVE_RANGES:
        days = RELATIVE_RANGES[range_key]
        start = today - timedelta(days=days - 1)
        return Period(start, today, f"Last {days} days", range_key)

    if range_key == "month":
        start, end = month_bounds(today.year, today.month)
        return Period(start, end, f"{start:%B %Y}", "month")

    if range_key == "quarter":
        quarter = (today.month - 1) // 3
        start = date(today.year, quarter * 3 + 1, 1)
        end_month = quarter * 3 + 3
        end = date(today.year, end_month, calendar.monthrange(today.year, end_month)[1])
        return Period(start, end, f"Q{quarter + 1} {today.year}", "quarter")

    if range_key == "year":
        return Period(date(today.year, 1, 1), date(today.year, 12, 31), str(today.year), "year")

    if range_key in {"all", "alltime", "all_time"}:
        return Period(None, None, "All time", "all")

    raise ValidationError(
        {"range": f"Unknown range '{range_key}'. Use one of: "
                  "7d, 30d, 90d, month, quarter, year, all — or start/end dates."}
    )


def _reference_from(params) -> date | None:
    raw = params.get("reference")
    return _parse_date(raw, "reference") if raw else None


def month_starts_between(start: date, end: date) -> list[date]:
    """Every month-start covered by the range, in order."""
    months: list[date] = []
    cursor = start.replace(day=1)
    while cursor <= end:
        months.append(cursor)
        if cursor.month == 12:
            cursor = date(cursor.year + 1, 1, 1)
        else:
            cursor = date(cursor.year, cursor.month + 1, 1)
    return months


def first_of_month(value: date) -> date:
    return value.replace(day=1)

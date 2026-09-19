"""CSV export shared by the reports centre and every list endpoint."""

from __future__ import annotations

import csv
from decimal import Decimal
from io import StringIO

from django.http import HttpResponse


def rows_to_csv(columns: list[dict], rows: list[dict]) -> str:
    buffer = StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([column["label"] for column in columns])
    for row in rows:
        writer.writerow([_cell(row.get(column["key"])) for column in columns])
    return buffer.getvalue()


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, Decimal):
        return f"{value:f}"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (list, dict)):
        return str(value)
    return value


def csv_response(filename: str, columns: list[dict], rows: list[dict]) -> HttpResponse:
    response = HttpResponse(rows_to_csv(columns, rows), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


def report_to_csv_response(report: dict) -> HttpResponse:
    scope = report["scope"]["period"]
    suffix = f"{scope['start'] or 'all'}_{scope['end'] or 'time'}"
    return csv_response(
        f"{report['key']}_{suffix}.csv", report["columns"], report["rows"]
    )

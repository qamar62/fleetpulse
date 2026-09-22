from __future__ import annotations

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.http import HttpResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .audit import AuditedModelMixin
from .filters import (
    DailyEarningFilter,
    DriverFilter,
    ExpenseFilter,
    ImportBatchFilter,
    PayrollSettlementFilter,
    VehicleFilter,
)
from .models import (
    AuditLog,
    DailyEarning,
    Driver,
    Expense,
    ImportBatch,
    PayrollSettlement,
    Vehicle,
)
from .serializers import (
    AuditLogSerializer,
    DailyEarningSerializer,
    DriverSerializer,
    DuplicateDaySerializer,
    ExpenseSerializer,
    ImportBatchListSerializer,
    ImportBatchSerializer,
    ImportUploadSerializer,
    PayrollSettlementSerializer,
    UserSerializer,
    VehicleSerializer,
)
from .services import analytics as analytics_service
from .services import importing as import_service
from .services import reports as reports_service
from .services.aggregation import (
    Scope,
    best_and_worst_days,
    daily_series,
    driver_breakdown,
    financial_summary,
    monthly_series,
    scope_from_request,
    vehicle_breakdown,
)
from .services.exporting import csv_response, report_to_csv_response
from .services.insights import build_insights
from .services.periods import Period, resolve_period

PLATFORMS = settings.INCOME_PLATFORMS


def _wants_csv(request) -> bool:
    """`?format=csv` or `?export=csv` — both read naturally from the frontend."""
    params = request.query_params
    return "csv" in {
        (params.get("format") or "").lower(),
        (params.get("export") or "").lower(),
    }


class ExportableMixin:
    """Adds ``GET /export/`` returning CSV of the current filtered queryset."""

    export_columns: list[dict] = []

    def _export_rows(self, queryset) -> list[dict]:
        serializer = self.get_serializer(queryset, many=True)
        return serializer.data

    @action(detail=False, methods=["get"])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        rows = self._export_rows(queryset)
        name = self.basename or self.queryset.model.__name__.lower()
        return csv_response(f"{name}.csv", self.export_columns, rows)


# ---------------------------------------------------------------------------
# Drivers
# ---------------------------------------------------------------------------


class DriverViewSet(AuditedModelMixin, ExportableMixin, viewsets.ModelViewSet):
    queryset = Driver.objects.prefetch_related("vehicles").all()
    serializer_class = DriverSerializer
    filterset_class = DriverFilter
    search_fields = ["name", "phone", "email", "license_number"]
    ordering_fields = ["name", "status", "joined_at", "created_at"]
    ordering = ["name"]
    export_columns = [
        {"key": "id", "label": "ID"},
        {"key": "name", "label": "Name"},
        {"key": "phone", "label": "Phone"},
        {"key": "email", "label": "Email"},
        {"key": "status", "label": "Status"},
        {"key": "joined_at", "label": "Joined"},
    ]

    @action(detail=False, methods=["get"])
    def performance(self, request):
        """Factual per-driver totals for the requested period."""
        scope = scope_from_request(request.query_params)
        rows = driver_breakdown(scope)
        if _wants_csv(request):
            report = reports_service.driver_performance(scope)
            return report_to_csv_response(report)
        return Response({"scope": scope.as_dict(), "rows": rows})

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        driver = self.get_object()
        scope = scope_from_request(request.query_params)
        scope = Scope(scope.period, driver_id=driver.id, vehicle_id=scope.vehicle_id)

        summary = financial_summary(scope)
        days = best_and_worst_days(scope)
        payroll = PayrollSettlement.objects.filter(driver=driver)
        if scope.period.start:
            payroll = payroll.filter(period__gte=scope.period.start.replace(day=1))
        if scope.period.end:
            payroll = payroll.filter(period__lte=scope.period.end)

        return Response(
            {
                "driver": DriverSerializer(driver).data,
                "scope": scope.as_dict(),
                "summary": summary,
                "best_day": days["best_day"],
                "worst_day": days["worst_day"],
                "series": daily_series(scope),
                "monthly_trend": monthly_series(
                    Scope(Period(None, None, "All time", "all"), driver_id=driver.id)
                ),
                "payroll": PayrollSettlementSerializer(payroll, many=True).data,
                "vehicles": VehicleSerializer(driver.vehicles.all(), many=True).data,
                "insights": build_insights(scope, summary, limit=5),
            }
        )


# ---------------------------------------------------------------------------
# Vehicles
# ---------------------------------------------------------------------------


class VehicleViewSet(AuditedModelMixin, ExportableMixin, viewsets.ModelViewSet):
    queryset = Vehicle.objects.select_related("assigned_driver").all()
    serializer_class = VehicleSerializer
    filterset_class = VehicleFilter
    search_fields = ["make", "model", "plate_number", "assigned_driver__name"]
    ordering_fields = ["make", "model", "plate_number", "status", "created_at"]
    ordering = ["make", "model"]
    export_columns = [
        {"key": "id", "label": "ID"},
        {"key": "make", "label": "Make"},
        {"key": "model", "label": "Model"},
        {"key": "plate_number", "label": "Plate"},
        {"key": "status", "label": "Status"},
    ]

    @action(detail=False, methods=["get"])
    def performance(self, request):
        scope = scope_from_request(request.query_params)
        if _wants_csv(request):
            return report_to_csv_response(reports_service.vehicle_performance(scope))
        return Response({"scope": scope.as_dict(), "rows": vehicle_breakdown(scope)})

    @action(detail=True, methods=["get"])
    def summary(self, request, pk=None):
        vehicle = self.get_object()
        scope = scope_from_request(request.query_params)
        scope = Scope(scope.period, driver_id=scope.driver_id, vehicle_id=vehicle.id)
        rows = vehicle_breakdown(scope)
        return Response(
            {
                "vehicle": VehicleSerializer(vehicle).data,
                "scope": scope.as_dict(),
                "summary": financial_summary(scope),
                "totals": rows[0] if rows else None,
                "series": daily_series(scope),
                "monthly_trend": monthly_series(
                    Scope(Period(None, None, "All time", "all"), vehicle_id=vehicle.id)
                ),
            }
        )


# ---------------------------------------------------------------------------
# Daily earnings
# ---------------------------------------------------------------------------


class DailyEarningViewSet(AuditedModelMixin, ExportableMixin, viewsets.ModelViewSet):
    queryset = DailyEarning.objects.select_related("driver", "vehicle").all()
    serializer_class = DailyEarningSerializer
    filterset_class = DailyEarningFilter
    search_fields = ["driver__name", "vehicle__plate_number", "vehicle__make", "notes"]
    ordering_fields = ["date", "total_income", "driver__name", "created_at", *PLATFORMS]
    ordering = ["-date"]
    export_columns = [
        {"key": "date", "label": "Date"},
        {"key": "driver_name", "label": "Driver"},
        {"key": "vehicle_name", "label": "Vehicle"},
        *[{"key": name, "label": name.title()} for name in PLATFORMS],
        {"key": "total_income", "label": "Total income"},
        {"key": "platform_income", "label": "Platform income (excl. cash)"},
        {"key": "status", "label": "Status"},
        {"key": "notes", "label": "Notes"},
    ]

    @action(detail=False, methods=["get"])
    def summary(self, request):
        scope = scope_from_request(request.query_params)
        return Response({"scope": scope.as_dict(), "summary": financial_summary(scope)})

    @action(detail=False, methods=["post"], url_path="duplicate-day")
    def duplicate_day(self, request):
        """Copy a previous day's entry onto a new date."""
        serializer = DuplicateDaySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        source_date = data.get("source_date")
        base = DailyEarning.objects.filter(driver=data["driver"], vehicle=data["vehicle"])
        source = (
            base.filter(date=source_date).first()
            if source_date
            else base.filter(date__lt=data["target_date"]).order_by("-date").first()
        )
        if source is None:
            raise NotFound("No earlier entry found for this driver and vehicle to copy.")

        existing = base.filter(date=data["target_date"]).first()
        if existing and not data["overwrite"]:
            raise ValidationError(
                {"target_date": "An entry already exists for that date. "
                                "Send overwrite=true to replace it."}
            )

        values = {name: getattr(source, name) for name in PLATFORMS}
        with transaction.atomic():
            earning, created = DailyEarning.objects.update_or_create(
                date=data["target_date"],
                driver=data["driver"],
                vehicle=data["vehicle"],
                defaults={**values, "notes": f"Duplicated from {source.date}."},
            )
        self._log(
            AuditLog.Action.CREATE if created else AuditLog.Action.UPDATE,
            earning,
            {"duplicated_from": source.date},
        )
        return Response(
            self.get_serializer(earning).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


# ---------------------------------------------------------------------------
# Expenses
# ---------------------------------------------------------------------------


class ExpenseViewSet(AuditedModelMixin, ExportableMixin, viewsets.ModelViewSet):
    queryset = Expense.objects.select_related("driver", "vehicle").all()
    serializer_class = ExpenseSerializer
    filterset_class = ExpenseFilter
    search_fields = ["description", "reference", "notes", "driver__name", "vehicle__plate_number"]
    ordering_fields = ["date", "amount", "category", "created_at"]
    ordering = ["-date"]
    export_columns = [
        {"key": "date", "label": "Date"},
        {"key": "driver_name", "label": "Driver"},
        {"key": "vehicle_name", "label": "Vehicle"},
        {"key": "category_label", "label": "Category"},
        {"key": "amount", "label": "Amount"},
        {"key": "payment_method_label", "label": "Payment method"},
        {"key": "description", "label": "Description"},
        {"key": "reference", "label": "Reference"},
        {"key": "notes", "label": "Notes"},
    ]

    @action(detail=False, methods=["get"])
    def summary(self, request):
        scope = scope_from_request(request.query_params)
        if _wants_csv(request):
            return report_to_csv_response(reports_service.expense_report(scope))
        return Response(reports_service.expense_report(scope))


# ---------------------------------------------------------------------------
# Payroll
# ---------------------------------------------------------------------------


class PayrollSettlementViewSet(AuditedModelMixin, ExportableMixin, viewsets.ModelViewSet):
    queryset = PayrollSettlement.objects.select_related("driver").all()
    serializer_class = PayrollSettlementSerializer
    filterset_class = PayrollSettlementFilter
    search_fields = ["driver__name", "notes"]
    ordering_fields = ["period", "salary", "balance", "driver__name"]
    ordering = ["-period"]
    export_columns = [
        {"key": "period", "label": "Period"},
        {"key": "driver_name", "label": "Driver"},
        {"key": "salary", "label": "Salary"},
        {"key": "advance", "label": "Advance"},
        {"key": "other_deductions", "label": "Other deductions"},
        {"key": "rent", "label": "Rent"},
        {"key": "paid_amount", "label": "Paid"},
        {"key": "balance", "label": "Balance"},
        {"key": "notes", "label": "Notes"},
    ]

    @action(detail=False, methods=["get"])
    def summary(self, request):
        scope = scope_from_request(request.query_params)
        if _wants_csv(request):
            return report_to_csv_response(reports_service.payroll_report(scope))
        return Response(reports_service.payroll_report(scope))


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------


class ReportView(APIView):
    """`/api/reports/` lists the catalogue; `/api/reports/<key>/` runs one."""

    def get(self, request, key: str | None = None):
        if key is None:
            return Response({"reports": reports_service.REPORT_CATALOG})

        builder = reports_service.REPORTS.get(key)
        if builder is None:
            raise NotFound(
                f"Unknown report '{key}'. Available: "
                f"{', '.join(sorted(reports_service.REPORTS))}."
            )
        scope = scope_from_request(request.query_params)
        report = builder(scope)
        if _wants_csv(request):
            return report_to_csv_response(report)
        return Response(report)


# ---------------------------------------------------------------------------
# Analytics
# ---------------------------------------------------------------------------


class AnalyticsView(APIView):
    # Every handler takes (scope, request) so dispatch stays uniform.
    HANDLERS = {
        "dashboard": lambda scope, request: analytics_service.dashboard(scope),
        "profitability": lambda scope, request: analytics_service.profitability_waterfall(
            financial_summary(scope)
        ),
        "income-mix": lambda scope, request: analytics_service.income_mix(
            scope, request.query_params.get("granularity", "day")
        ),
        "day-of-week": lambda scope, request: analytics_service.day_of_week(scope),
        "distribution": lambda scope, request: analytics_service.daily_distribution(scope),
        "expense-to-income": lambda scope, request: analytics_service.expense_to_income_trend(
            scope
        ),
        "comparison": lambda scope, request: analytics_service.comparison(scope),
        "monthly-trend": lambda scope, request: analytics_service.monthly_trend(scope),
        "cash-vs-platform": lambda scope, request: analytics_service.cash_vs_platform(scope),
        "cash": lambda scope, request: analytics_service.cash_desk(scope),
        "platform-performance": lambda scope, request: analytics_service.platform_performance(
            scope
        ),
    }

    # Friendlier names for the same handlers, so the frontend can use whichever
    # label reads best on the page without a 404.
    ALIASES = {
        "daily-distribution": "distribution",
        "expense-trend": "expense-to-income",
        "expense-to-income-trend": "expense-to-income",
        "platforms": "platform-performance",
        "waterfall": "profitability",
        "overview": "dashboard",
        "cash-desk": "cash",
    }

    def get(self, request, key: str | None = None):
        if key is None:
            return Response(
                {"available": sorted(self.HANDLERS), "aliases": dict(sorted(self.ALIASES.items()))}
            )

        handler = self.HANDLERS.get(self.ALIASES.get(key, key))
        if handler is None:
            raise NotFound(
                f"Unknown analytics view '{key}'. Available: {', '.join(sorted(self.HANDLERS))}."
            )
        scope = scope_from_request(request.query_params)
        return Response(handler(scope, request))


class InsightsView(APIView):
    def get(self, request):
        scope = scope_from_request(request.query_params)
        limit = request.query_params.get("limit")
        return Response(
            {
                "scope": scope.as_dict(),
                "insights": build_insights(scope, limit=int(limit) if limit else None),
            }
        )


# ---------------------------------------------------------------------------
# Imports
# ---------------------------------------------------------------------------


class ImportBatchViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ImportBatch.objects.prefetch_related("issues").all()
    filterset_class = ImportBatchFilter
    search_fields = ["filename"]
    ordering_fields = ["created_at", "status", "total_rows"]
    ordering = ["-created_at"]

    def get_serializer_class(self):
        return ImportBatchSerializer if self.action == "retrieve" else ImportBatchListSerializer

    @action(detail=False, methods=["get"])
    def template(self, request):
        response = HttpResponse(
            import_service.template_csv(), content_type="text/csv; charset=utf-8"
        )
        response["Content-Disposition"] = 'attachment; filename="fleetpulse_import_template.csv"'
        return response

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def analyze(self, request):
        """Steps 1–5 of the wizard: detect, preview, validate. Writes nothing."""
        serializer = ImportUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = import_service.analyze(
                data["file"],
                default_driver=data.get("driver"),
                default_vehicle=data.get("vehicle"),
                preview_limit=int(request.query_params.get("preview_limit", 50)),
            )
        except import_service.ImportError_ as exc:
            raise ValidationError({"file": str(exc)})
        return Response(result)

    @action(detail=False, methods=["post"], parser_classes=[MultiPartParser, FormParser])
    def commit(self, request):
        """Steps 6–7: write the rows and return a result summary."""
        serializer = ImportUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            result = import_service.commit(
                data["file"],
                user=request.user,
                default_driver=data.get("driver"),
                default_vehicle=data.get("vehicle"),
                skip_invalid=data["skip_invalid"],
                update_existing=data["update_existing"],
                create_expenses=data["create_expenses"],
            )
        except import_service.ImportError_ as exc:
            raise ValidationError({"file": str(exc)})

        AuditLog.objects.create(
            actor=request.user if request.user.is_authenticated else None,
            action=AuditLog.Action.IMPORT,
            model_name="ImportBatch",
            object_id=str(result["batch_id"]),
            object_label=result["filename"],
            changes={
                "created": result["created"],
                "updated": result["updated"],
                "failed": result["failed"],
            },
        )
        http_status = (
            status.HTTP_400_BAD_REQUEST
            if result["status"] == ImportBatch.Status.FAILED
            else status.HTTP_201_CREATED
        )
        return Response(result, status=http_status)


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = AuditLog.objects.select_related("actor").all()
    serializer_class = AuditLogSerializer
    filterset_fields = ["action", "model_name", "object_id", "actor"]
    search_fields = ["object_label", "model_name"]
    ordering_fields = ["created_at"]
    ordering = ["-created_at"]


# ---------------------------------------------------------------------------
# Meta / health / me
# ---------------------------------------------------------------------------


@api_view(["GET"])
@permission_classes([AllowAny])
def health(request):
    from django.db import connection

    try:
        connection.ensure_connection()
        database = "ok"
    except Exception as exc:  # pragma: no cover
        database = f"error: {exc}"
    return Response({"status": "ok", "database": database, "version": "1.0.0"})


@api_view(["GET"])
@permission_classes([AllowAny])
def meta(request):
    """Everything the frontend needs to build dropdowns without hard-coding."""
    return Response(
        {
            "currency": settings.FLEET_CURRENCY,
            "platforms": [
                {"value": name, "label": name.title()} for name in PLATFORMS
            ],
            "expense_categories": [
                {"value": value, "label": label} for value, label in Expense.Category.choices
            ],
            "payment_methods": [
                {"value": value, "label": label}
                for value, label in Expense.PaymentMethod.choices
            ],
            "driver_statuses": [
                {"value": value, "label": label} for value, label in Driver.Status.choices
            ],
            "vehicle_statuses": [
                {"value": value, "label": label} for value, label in Vehicle.Status.choices
            ],
            "ranges": ["7d", "30d", "90d", "month", "quarter", "year", "all"],
            "reports": reports_service.REPORT_CATALOG,
            "analytics": sorted(AnalyticsView.HANDLERS),
            "aliases": AnalyticsView.ALIASES,
            "calculations": {
                "daily_income": "careem + uber + bolt + yango + cash",
                "gross_income": "sum of daily income over the period",
                "operating_expenses": "sum of the expense ledger (payroll excluded)",
                "operating_profit": "gross income - operating expenses",
                "operating_margin": "operating profit / gross income * 100",
                "net_result": "operating profit - driver payroll",
                "average_daily_income": "gross income / active earning days",
                "settlement_balance":
                    "salary - advance - other_deductions - rent - paid_amount",
            },
        }
    )


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)

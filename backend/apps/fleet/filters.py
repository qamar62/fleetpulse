from __future__ import annotations

import django_filters as filters
from django.conf import settings
from django.db.models import Q

from .models import DailyEarning, Driver, Expense, ImportBatch, PayrollSettlement, Vehicle


def _filter_by_period(queryset, field: str, param: str, value: str, reference=None):
    """Resolve a named range exactly the way the analytics endpoints do.

    The list endpoints used to understand only start/end/month, so a table sat
    under a KPI card reading "Last 7 days" while quietly showing every row ever
    recorded. Both now go through resolve_period, so the number and the rows
    beneath it always describe the same window.
    """
    from .services.periods import resolve_period

    # `reference` anchors relative ranges. Forwarding it keeps a list and the
    # summary above it on the same seven days rather than two different ones.
    params = {param: value}
    if reference:
        params["reference"] = reference
    period = resolve_period(params)
    if period.is_open:  # "all time" - no bounds to apply
        return queryset
    return queryset.filter(**{f"{field}__gte": period.start, f"{field}__lte": period.end})


class DriverFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    vehicle = filters.NumberFilter(field_name="vehicles__id")
    joined_after = filters.DateFilter(field_name="joined_at", lookup_expr="gte")

    class Meta:
        model = Driver
        fields = ["status", "vehicle"]


class VehicleFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")
    driver = filters.NumberFilter(field_name="assigned_driver_id")
    unassigned = filters.BooleanFilter(method="filter_unassigned")

    class Meta:
        model = Vehicle
        fields = ["status", "driver", "make"]

    def filter_unassigned(self, queryset, name, value):
        return queryset.filter(assigned_driver__isnull=bool(value))


class DailyEarningFilter(filters.FilterSet):
    start = filters.DateFilter(field_name="date", lookup_expr="gte")
    end = filters.DateFilter(field_name="date", lookup_expr="lte")
    month = filters.CharFilter(method="filter_month")
    driver = filters.NumberFilter(field_name="driver_id")
    vehicle = filters.NumberFilter(field_name="vehicle_id")
    platform = filters.CharFilter(method="filter_platform")
    min_total = filters.NumberFilter(field_name="total_income", lookup_expr="gte")
    max_total = filters.NumberFilter(field_name="total_income", lookup_expr="lte")
    has_income = filters.BooleanFilter(method="filter_has_income")
    has_cash = filters.BooleanFilter(method="filter_has_cash")
    range = filters.CharFilter(method="filter_range")
    year = filters.CharFilter(method="filter_range")

    class Meta:
        model = DailyEarning
        fields = ["driver", "vehicle", "date"]

    def filter_month(self, queryset, name, value):
        from .services.periods import parse_month

        period = parse_month(value)
        return queryset.filter(date__gte=period.start, date__lte=period.end)

    def filter_range(self, queryset, name, value):
        reference = (self.data or {}).get("reference")
        return _filter_by_period(queryset, "date", name, value, reference)

    def filter_platform(self, queryset, name, value):
        """Rows where the named platform actually contributed income."""
        platform = value.strip().lower()
        if platform not in settings.INCOME_PLATFORMS:
            return queryset.none()
        return queryset.filter(**{f"{platform}__gt": 0})

    def filter_has_income(self, queryset, name, value):
        return queryset.filter(total_income__gt=0) if value else queryset.filter(total_income=0)

    def filter_has_cash(self, queryset, name, value):
        """Rows that carry a cash collection - what the Cash page lists."""
        field = settings.CASH_PLATFORM
        return (
            queryset.filter(**{f"{field}__gt": 0})
            if value
            else queryset.filter(**{field: 0})
        )


class ExpenseFilter(filters.FilterSet):
    start = filters.DateFilter(field_name="date", lookup_expr="gte")
    end = filters.DateFilter(field_name="date", lookup_expr="lte")
    month = filters.CharFilter(method="filter_month")
    driver = filters.NumberFilter(field_name="driver_id")
    vehicle = filters.NumberFilter(field_name="vehicle_id")
    category = filters.MultipleChoiceFilter(choices=Expense.Category.choices)
    payment_method = filters.MultipleChoiceFilter(choices=Expense.PaymentMethod.choices)
    min_amount = filters.NumberFilter(field_name="amount", lookup_expr="gte")
    max_amount = filters.NumberFilter(field_name="amount", lookup_expr="lte")
    range = filters.CharFilter(method="filter_range")
    year = filters.CharFilter(method="filter_range")

    class Meta:
        model = Expense
        fields = ["driver", "vehicle", "category", "payment_method", "date"]

    def filter_month(self, queryset, name, value):
        from .services.periods import parse_month

        period = parse_month(value)
        return queryset.filter(date__gte=period.start, date__lte=period.end)

    def filter_range(self, queryset, name, value):
        reference = (self.data or {}).get("reference")
        return _filter_by_period(queryset, "date", name, value, reference)


class PayrollSettlementFilter(filters.FilterSet):
    driver = filters.NumberFilter(field_name="driver_id")
    period = filters.CharFilter(method="filter_period")
    start = filters.DateFilter(field_name="period", lookup_expr="gte")
    end = filters.DateFilter(field_name="period", lookup_expr="lte")
    unsettled = filters.BooleanFilter(method="filter_unsettled")
    range = filters.CharFilter(method="filter_range")
    year = filters.CharFilter(method="filter_range")

    class Meta:
        model = PayrollSettlement
        fields = ["driver"]

    def filter_period(self, queryset, name, value):
        from .services.periods import parse_month

        month = parse_month(value)
        return queryset.filter(period=month.start)

    def filter_range(self, queryset, name, value):
        reference = (self.data or {}).get("reference")
        return _filter_by_period(queryset, "period", name, value, reference)

    def filter_unsettled(self, queryset, name, value):
        return queryset.filter(~Q(balance=0)) if value else queryset.filter(balance=0)


class ImportBatchFilter(filters.FilterSet):
    status = filters.CharFilter(field_name="status", lookup_expr="iexact")

    class Meta:
        model = ImportBatch
        fields = ["status"]

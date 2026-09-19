"""Authoritative financial aggregation.

Nothing in here is cached or stored — every figure is computed from the ledger
with ORM aggregation in Decimal. This module is the single source of truth for
what "income", "expense", "operating profit" and "margin" mean in this system.

Vocabulary, kept deliberately explicit:

* **gross income**       sum of platform income across daily earnings
* **operating expenses** sum of the Expense ledger (payroll is NOT included)
* **operating profit**   gross income - operating expenses
* **payroll**            settlement salary charged for the period
* **net result**         operating profit - payroll
* **active day**         a calendar day where recorded income was above zero
"""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.db.models import Count, DecimalField, F, Q, Sum, Value
from django.db.models.functions import Coalesce, TruncMonth

from ..models import DailyEarning, Driver, Expense, PayrollSettlement, Vehicle
from .money import D, ZERO, change_pct, pct, quantize, safe_div
from .periods import Period

MONEY = DecimalField(max_digits=16, decimal_places=2)
PLATFORMS = settings.INCOME_PLATFORMS


def _zero_sum(field: str):
    return Coalesce(Sum(field), Value(ZERO), output_field=MONEY)


# ---------------------------------------------------------------------------
# Scoping
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Scope:
    """A period plus optional driver / vehicle narrowing."""

    period: Period
    driver_id: int | None = None
    vehicle_id: int | None = None

    def filters(self, date_field: str = "date") -> Q:
        query = Q()
        if self.period.start:
            query &= Q(**{f"{date_field}__gte": self.period.start})
        if self.period.end:
            query &= Q(**{f"{date_field}__lte": self.period.end})
        if self.driver_id:
            query &= Q(driver_id=self.driver_id)
        if self.vehicle_id:
            query &= Q(vehicle_id=self.vehicle_id)
        return query

    def earnings(self):
        return DailyEarning.objects.filter(self.filters())

    def expenses(self):
        return Expense.objects.filter(self.filters())

    def payroll(self):
        query = Q()
        if self.period.start:
            query &= Q(period__gte=self.period.start.replace(day=1))
        if self.period.end:
            query &= Q(period__lte=self.period.end)
        if self.driver_id:
            query &= Q(driver_id=self.driver_id)
        return PayrollSettlement.objects.filter(query)

    def with_period(self, period: Period) -> "Scope":
        return Scope(period, self.driver_id, self.vehicle_id)

    def as_dict(self) -> dict:
        return {
            "period": self.period.as_dict(),
            "driver_id": self.driver_id,
            "vehicle_id": self.vehicle_id,
        }


def scope_from_request(params, *, default_range: str = "month") -> Scope:
    from .periods import resolve_period

    def _int(name: str) -> int | None:
        raw = params.get(name)
        if raw in (None, "", "all"):
            return None
        try:
            return int(raw)
        except (TypeError, ValueError):
            return None

    return Scope(
        period=resolve_period(params, default=default_range),
        driver_id=_int("driver") or _int("driver_id"),
        vehicle_id=_int("vehicle") or _int("vehicle_id"),
    )


# ---------------------------------------------------------------------------
# Primitive totals
# ---------------------------------------------------------------------------


def income_totals(scope: Scope) -> dict:
    """Gross income, per-platform income and day counts."""
    per_platform = {f"sum_{name}": _zero_sum(name) for name in PLATFORMS}
    row = scope.earnings().aggregate(
        gross=_zero_sum("total_income"),
        entries=Count("id"),
        active_days=Count("id", filter=Q(total_income__gt=0), distinct=True),
        **per_platform,
    )

    platform_days = scope.earnings().aggregate(
        **{f"days_{name}": Count("id", filter=Q(**{f"{name}__gt": 0})) for name in PLATFORMS}
    )

    gross = quantize(row["gross"])
    platforms = OrderedDict()
    for name in PLATFORMS:
        amount = quantize(row[f"sum_{name}"])
        days = platform_days[f"days_{name}"]
        platforms[name] = {
            "platform": name,
            "label": name.title(),
            "income": amount,
            "share_pct": pct(amount, gross),
            "active_days": days,
            "average_per_active_day": quantize(safe_div(amount, days) or ZERO) if days else None,
        }

    return {
        "gross_income": gross,
        "entries": row["entries"],
        "active_days": row["active_days"],
        "platforms": platforms,
    }


def expense_totals(scope: Scope) -> dict:
    qs = scope.expenses()
    total = quantize(qs.aggregate(total=_zero_sum("amount"))["total"])

    by_category = OrderedDict()
    rows = {
        item["category"]: item
        for item in qs.values("category").annotate(
            amount=_zero_sum("amount"), count=Count("id")
        )
    }
    for value, label in Expense.Category.choices:
        item = rows.get(value)
        amount = quantize(item["amount"]) if item else ZERO
        by_category[value] = {
            "category": value,
            "label": label,
            "amount": amount,
            "count": item["count"] if item else 0,
            "share_pct": pct(amount, total),
        }

    return {
        "total_expenses": total,
        "count": qs.count(),
        "by_category": by_category,
        "fuel": by_category["fuel"]["amount"],
        "maintenance": quantize(
            sum(
                (by_category[c]["amount"] for c in Expense.MAINTENANCE_CATEGORIES),
                ZERO,
            )
        ),
    }


def payroll_totals(scope: Scope) -> dict:
    row = scope.payroll().aggregate(
        salary=_zero_sum("salary"),
        advance=_zero_sum("advance"),
        other_deductions=_zero_sum("other_deductions"),
        rent=_zero_sum("rent"),
        paid_amount=_zero_sum("paid_amount"),
        balance=_zero_sum("balance"),
        settlements=Count("id"),
    )
    return {key: (quantize(value) if key != "settlements" else value) for key, value in row.items()}


# ---------------------------------------------------------------------------
# Composite summary
# ---------------------------------------------------------------------------


def financial_summary(scope: Scope) -> dict:
    """The full profitability waterfall for a scope."""
    income = income_totals(scope)
    expenses = expense_totals(scope)
    payroll = payroll_totals(scope)

    gross = income["gross_income"]
    total_expenses = expenses["total_expenses"]
    operating_profit = quantize(gross - total_expenses)
    net_result = quantize(operating_profit - payroll["salary"])
    cash_income = income["platforms"]["cash"]["income"] if "cash" in income["platforms"] else ZERO

    return {
        "gross_income": gross,
        "operating_expenses": total_expenses,
        "operating_profit": operating_profit,
        "payroll": payroll["salary"],
        "payroll_paid": payroll["paid_amount"],
        "payroll_balance": payroll["balance"],
        "net_result": net_result,
        "operating_margin_pct": pct(operating_profit, gross),
        "net_margin_pct": pct(net_result, gross),
        "expense_to_income_pct": pct(total_expenses, gross),
        "fuel_to_income_pct": pct(expenses["fuel"], gross),
        "maintenance_to_income_pct": pct(expenses["maintenance"], gross),
        "cash_to_income_pct": pct(cash_income, gross),
        "active_days": income["active_days"],
        "entries": income["entries"],
        "average_daily_income": quantize(
            safe_div(gross, income["active_days"]) or ZERO
        ) if income["active_days"] else None,
        "expense_per_active_day": quantize(
            safe_div(total_expenses, income["active_days"]) or ZERO
        ) if income["active_days"] else None,
        "platforms": list(income["platforms"].values()),
        "expense_categories": list(expenses["by_category"].values()),
        "net_cash_balance": quantize(operating_profit - payroll["paid_amount"]),
    }


def compare(current: dict, previous: dict | None, keys: list[str]) -> dict:
    """Attach previous values and honest percentage changes.

    When there is no previous data the change is ``None`` so the UI can show
    "No comparison data" rather than inventing a number.
    """
    out = {}
    for key in keys:
        current_value = current.get(key)
        previous_value = previous.get(key) if previous else None
        has_base = previous is not None and previous_value is not None and D(previous_value) != 0
        out[key] = {
            "value": current_value,
            "previous": previous_value if previous else None,
            "change_pct": change_pct(current_value, previous_value) if has_base else None,
            "has_comparison": bool(has_base),
        }
    return out


# ---------------------------------------------------------------------------
# Series
# ---------------------------------------------------------------------------


def daily_series(scope: Scope, *, fill_gaps: bool = True) -> list[dict]:
    """Per-day income (with platform split) and expenses."""
    income_rows = {
        row["date"]: row
        for row in scope.earnings()
        .values("date")
        .annotate(
            income=_zero_sum("total_income"),
            **{name: _zero_sum(name) for name in PLATFORMS},
        )
    }
    expense_rows = {
        row["date"]: row["expenses"]
        for row in scope.expenses().values("date").annotate(expenses=_zero_sum("amount"))
    }

    if fill_gaps and scope.period.start and scope.period.end:
        days = _date_range(scope.period.start, scope.period.end)
    else:
        days = sorted(set(income_rows) | set(expense_rows))

    series = []
    for day in days:
        income_row = income_rows.get(day)
        income = quantize(income_row["income"]) if income_row else ZERO
        expenses = quantize(expense_rows.get(day, ZERO))
        series.append(
            {
                "date": day.isoformat(),
                "weekday": day.strftime("%A"),
                "income": income,
                "expenses": expenses,
                "net_operating_result": quantize(income - expenses),
                "platforms": {
                    name: quantize(income_row[name]) if income_row else ZERO
                    for name in PLATFORMS
                },
            }
        )
    return series


def monthly_series(scope: Scope) -> list[dict]:
    income_rows = {
        row["month"].date() if hasattr(row["month"], "date") else row["month"]: row["income"]
        for row in scope.earnings()
        .annotate(month=TruncMonth("date"))
        .values("month")
        .annotate(income=_zero_sum("total_income"))
    }
    expense_rows = {
        row["month"].date() if hasattr(row["month"], "date") else row["month"]: row["expenses"]
        for row in scope.expenses()
        .annotate(month=TruncMonth("date"))
        .values("month")
        .annotate(expenses=_zero_sum("amount"))
    }
    payroll_rows = {
        row["period"]: row["salary"]
        for row in scope.payroll().values("period").annotate(salary=_zero_sum("salary"))
    }

    months = sorted(set(income_rows) | set(expense_rows) | set(payroll_rows))
    series = []
    for month in months:
        income = quantize(income_rows.get(month, ZERO))
        expenses = quantize(expense_rows.get(month, ZERO))
        payroll = quantize(payroll_rows.get(month, ZERO))
        operating_profit = quantize(income - expenses)
        series.append(
            {
                "month": month.isoformat(),
                "label": month.strftime("%b %Y"),
                "gross_income": income,
                "operating_expenses": expenses,
                "operating_profit": operating_profit,
                "payroll": payroll,
                "net_result": quantize(operating_profit - payroll),
                "operating_margin_pct": pct(operating_profit, income),
            }
        )
    return series


def _date_range(start: date, end: date) -> list[date]:
    from datetime import timedelta

    count = (end - start).days + 1
    return [start + timedelta(days=offset) for offset in range(count)]


# ---------------------------------------------------------------------------
# Per-entity breakdowns
# ---------------------------------------------------------------------------


def driver_breakdown(scope: Scope) -> list[dict]:
    """Factual per-driver metrics. No invented scores or ratings."""
    income = {
        row["driver_id"]: row
        for row in scope.earnings()
        .values("driver_id")
        .annotate(
            gross=_zero_sum("total_income"),
            active_days=Count("id", filter=Q(total_income__gt=0)),
            entries=Count("id"),
        )
    }
    expenses = {
        row["driver_id"]: row["total"]
        for row in scope.expenses().values("driver_id").annotate(total=_zero_sum("amount"))
    }
    payroll = {
        row["driver_id"]: row
        for row in scope.payroll()
        .values("driver_id")
        .annotate(salary=_zero_sum("salary"), balance=_zero_sum("balance"))
    }

    driver_ids = set(income) | set(expenses) | set(payroll)
    if scope.driver_id:
        driver_ids &= {scope.driver_id}
    drivers = Driver.objects.filter(id__in=driver_ids).select_related()

    rows = []
    for driver in drivers:
        stats = income.get(driver.id)
        gross = quantize(stats["gross"]) if stats else ZERO
        spend = quantize(expenses.get(driver.id, ZERO))
        active_days = stats["active_days"] if stats else 0
        operating_profit = quantize(gross - spend)
        pay = payroll.get(driver.id)
        vehicle = driver.vehicles.first()
        rows.append(
            {
                "driver_id": driver.id,
                "driver": driver.name,
                "status": driver.status,
                "vehicle": str(vehicle) if vehicle else None,
                "vehicle_id": vehicle.id if vehicle else None,
                "gross_income": gross,
                "operating_expenses": spend,
                "operating_profit": operating_profit,
                "payroll": quantize(pay["salary"]) if pay else ZERO,
                "payroll_balance": quantize(pay["balance"]) if pay else ZERO,
                "active_days": active_days,
                "entries": stats["entries"] if stats else 0,
                "average_per_day": quantize(safe_div(gross, active_days) or ZERO)
                if active_days
                else None,
                "operating_margin_pct": pct(operating_profit, gross),
                "expense_to_income_pct": pct(spend, gross),
            }
        )
    rows.sort(key=lambda item: item["gross_income"], reverse=True)
    return rows


def vehicle_breakdown(scope: Scope) -> list[dict]:
    income = {
        row["vehicle_id"]: row
        for row in scope.earnings()
        .values("vehicle_id")
        .annotate(
            gross=_zero_sum("total_income"),
            active_days=Count("id", filter=Q(total_income__gt=0)),
        )
    }
    expense_rows = (
        scope.expenses()
        .values("vehicle_id")
        .annotate(
            total=_zero_sum("amount"),
            fuel=Coalesce(
                Sum("amount", filter=Q(category="fuel")), Value(ZERO), output_field=MONEY
            ),
            salik=Coalesce(
                Sum("amount", filter=Q(category="salik")), Value(ZERO), output_field=MONEY
            ),
            maintenance=Coalesce(
                Sum("amount", filter=Q(category__in=Expense.MAINTENANCE_CATEGORIES)),
                Value(ZERO),
                output_field=MONEY,
            ),
        )
    )
    expenses = {row["vehicle_id"]: row for row in expense_rows}

    vehicle_ids = set(income) | set(expenses)
    if scope.vehicle_id:
        vehicle_ids &= {scope.vehicle_id}
    vehicles = Vehicle.objects.filter(id__in=vehicle_ids).select_related("assigned_driver")

    rows = []
    for vehicle in vehicles:
        stats = income.get(vehicle.id)
        spend = expenses.get(vehicle.id)
        gross = quantize(stats["gross"]) if stats else ZERO
        total_expenses = quantize(spend["total"]) if spend else ZERO
        active_days = stats["active_days"] if stats else 0
        operating_profit = quantize(gross - total_expenses)
        rows.append(
            {
                "vehicle_id": vehicle.id,
                "vehicle": str(vehicle),
                "make": vehicle.make,
                "model": vehicle.model,
                "plate_number": vehicle.plate_number,
                "status": vehicle.status,
                "assigned_driver": vehicle.assigned_driver.name
                if vehicle.assigned_driver
                else None,
                "assigned_driver_id": vehicle.assigned_driver_id,
                "gross_income": gross,
                "fuel": quantize(spend["fuel"]) if spend else ZERO,
                "salik": quantize(spend["salik"]) if spend else ZERO,
                "maintenance": quantize(spend["maintenance"]) if spend else ZERO,
                "operating_expenses": total_expenses,
                "operating_profit": operating_profit,
                "active_days": active_days,
                "income_per_active_day": quantize(safe_div(gross, active_days) or ZERO)
                if active_days
                else None,
                "expense_to_income_pct": pct(total_expenses, gross),
                "operating_margin_pct": pct(operating_profit, gross),
            }
        )
    rows.sort(key=lambda item: item["gross_income"], reverse=True)
    return rows


# ---------------------------------------------------------------------------
# Notable days
# ---------------------------------------------------------------------------


def best_and_worst_days(scope: Scope) -> dict:
    rows = (
        scope.earnings()
        .values("date")
        .annotate(income=_zero_sum("total_income"))
        .order_by("-income")
    )
    rows = [row for row in rows if D(row["income"]) > 0]
    if not rows:
        return {"best_day": None, "worst_day": None}

    best, worst = rows[0], rows[-1]
    return {
        "best_day": {
            "date": best["date"].isoformat(),
            "weekday": best["date"].strftime("%A"),
            "income": quantize(best["income"]),
        },
        "worst_day": {
            "date": worst["date"].isoformat(),
            "weekday": worst["date"].strftime("%A"),
            "income": quantize(worst["income"]),
        },
    }


def highest_expense_day(scope: Scope) -> dict | None:
    row = (
        scope.expenses()
        .values("date")
        .annotate(amount=_zero_sum("amount"))
        .order_by("-amount")
        .first()
    )
    if not row or D(row["amount"]) == 0:
        return None
    return {"date": row["date"].isoformat(), "amount": quantize(row["amount"])}


def inactive_days(scope: Scope) -> dict:
    """Days in the period with no income recorded at all."""
    if scope.period.is_open:
        return {"calendar_days": None, "active_days": None, "inactive_days": None}
    calendar_days = scope.period.days
    active = (
        scope.earnings().filter(total_income__gt=0).values("date").distinct().count()
    )
    return {
        "calendar_days": calendar_days,
        "active_days": active,
        "inactive_days": max(calendar_days - active, 0),
    }

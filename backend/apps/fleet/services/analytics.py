"""Analytics views over the ledger — all computed, none stored."""

from __future__ import annotations

from collections import OrderedDict
from decimal import Decimal
from statistics import median

from django.conf import settings
from django.db.models import Count, Q

from .aggregation import (
    CASH,
    COUNTED_PLATFORMS,
    Scope,
    _zero_sum,
    cash_breakdown,
    daily_series,
    driver_breakdown,
    financial_summary,
    monthly_series,
    vehicle_breakdown,
)
from .money import D, ZERO, pct, quantize, safe_div

PLATFORMS = settings.INCOME_PLATFORMS


def counted_platforms(scope: Scope) -> list[str]:
    """The platforms that make up counted income for this request."""
    return list(PLATFORMS) if scope.include_cash else list(COUNTED_PLATFORMS)
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def dashboard(scope: Scope) -> dict:
    """Everything the executive dashboard needs, in one round trip."""
    from .aggregation import best_and_worst_days, compare, inactive_days
    from .insights import build_insights

    summary = financial_summary(scope)
    previous_period = scope.period.previous()
    previous = (
        financial_summary(scope.with_period(previous_period)) if previous_period else None
    )

    comparison_keys = [
        "gross_income",
        "operating_expenses",
        "operating_profit",
        "payroll",
        "net_result",
        "net_cash_balance",
        "average_daily_income",
        "operating_margin_pct",
        "expense_to_income_pct",
    ]

    days = best_and_worst_days(scope)
    platforms = sorted(summary["platforms"], key=lambda item: D(item["income"]), reverse=True)
    best_platform = platforms[0] if platforms and D(platforms[0]["income"]) > 0 else None

    return {
        "scope": scope.as_dict(),
        "comparison_period": previous_period.as_dict() if previous_period else None,
        "has_comparison": previous is not None and D(previous["gross_income"]) > 0,
        "currency": settings.FLEET_CURRENCY,
        "kpis": compare(summary, previous, comparison_keys),
        "summary": summary,
        "best_day": days["best_day"],
        "worst_day": days["worst_day"],
        "best_platform": best_platform,
        "cash": summary["cash"],
        "coverage": inactive_days(scope),
        "series": daily_series(scope),
        "platforms": platforms,
        "expense_categories": summary["expense_categories"],
        "profitability": profitability_waterfall(summary),
        "insights": build_insights(scope, summary),
    }


def profitability_waterfall(summary: dict) -> dict:
    """The explicit income → profit chain. Nothing is labelled profit implicitly."""
    return {
        "steps": [
            {"key": "gross_income",
             # The chain is read left to right as a sum, so the first step has
             # to say which money it is or the arithmetic looks wrong.
             "label": "Gross income" if summary["includes_cash"] else "Gross income (excl. cash)",
             "amount": summary["gross_income"], "kind": "total"},
            {"key": "operating_expenses", "label": "Operating expenses",
             "amount": quantize(-D(summary["operating_expenses"])), "kind": "deduction"},
            {"key": "operating_profit", "label": "Operating profit",
             "amount": summary["operating_profit"], "kind": "subtotal"},
            {"key": "payroll", "label": "Driver payroll",
             "amount": quantize(-D(summary["payroll"])), "kind": "deduction"},
            {"key": "net_result", "label": "Net result", "amount": summary["net_result"],
             "kind": "total"},
        ],
        "operating_margin_pct": summary["operating_margin_pct"],
        "net_margin_pct": summary["net_margin_pct"],
    }


def income_mix(scope: Scope, granularity: str = "day") -> dict:
    """Platform mix over time, in both absolute and percentage terms."""
    series = monthly_series(scope) if granularity == "month" else daily_series(scope)
    names = counted_platforms(scope)

    if granularity == "month":
        rows = []
        for bucket in series:
            month_scope = _month_scope(scope, bucket["month"])
            summary = financial_summary(month_scope)
            rows.append(_mix_row(bucket["label"], bucket["month"], summary["platforms"]))
        return {"granularity": "month", "platforms": names, "series": rows}

    rows = []
    for bucket in series:
        total = D(bucket["income"])
        rows.append(
            {
                "bucket": bucket["date"],
                "label": bucket["date"],
                "total": bucket["income"],
                "values": {name: bucket["platforms"][name] for name in names},
                "shares": {name: pct(bucket["platforms"][name], total) for name in names},
            }
        )
    return {"granularity": "day", "platforms": names, "series": rows}


def _mix_row(label, bucket, platforms):
    total = sum((D(p["income"]) for p in platforms), ZERO)
    return {
        "bucket": bucket,
        "label": label,
        "total": quantize(total),
        "values": {p["platform"]: p["income"] for p in platforms},
        "shares": {p["platform"]: pct(p["income"], total) for p in platforms},
    }


def _month_scope(scope: Scope, month_iso: str) -> Scope:
    from datetime import date

    from .periods import Period, month_bounds

    year, month, _ = (int(part) for part in month_iso.split("-"))
    start, end = month_bounds(year, month)
    return scope.with_period(Period(start, end, date(year, month, 1).strftime("%b %Y"), "month"))


def day_of_week(scope: Scope) -> dict:
    """Which weekdays actually earn, based on recorded days only."""
    series = [row for row in daily_series(scope, fill_gaps=False) if D(row["income"]) > 0]
    buckets = OrderedDict((day, []) for day in WEEKDAYS)
    for row in series:
        buckets[row["weekday"]].append(D(row["income"]))

    rows = []
    for day, values in buckets.items():
        total = sum(values, ZERO)
        rows.append(
            {
                "weekday": day,
                "active_days": len(values),
                "total_income": quantize(total),
                "average_income": quantize(safe_div(total, len(values)) or ZERO)
                if values
                else None,
                "best": quantize(max(values)) if values else None,
                "worst": quantize(min(values)) if values else None,
            }
        )
    ranked = [row for row in rows if row["average_income"] is not None]
    ranked.sort(key=lambda item: D(item["average_income"]), reverse=True)
    return {
        "rows": rows,
        "strongest_weekday": ranked[0]["weekday"] if ranked else None,
        "weakest_weekday": ranked[-1]["weekday"] if ranked else None,
    }


def daily_distribution(scope: Scope) -> dict:
    """High / low / average / median of recorded earning days."""
    values = [
        D(row["income"]) for row in daily_series(scope, fill_gaps=False) if D(row["income"]) > 0
    ]
    if not values:
        return {
            "count": 0,
            "high": None,
            "low": None,
            "average": None,
            "median": None,
            "buckets": [],
        }

    values.sort()
    high, low = values[-1], values[0]
    average = quantize(safe_div(sum(values, ZERO), len(values)) or ZERO)

    bucket_count = min(8, max(3, len(values) // 3 or 3))
    width = (high - low) / bucket_count if high > low else Decimal("1")
    buckets = []
    for index in range(bucket_count):
        lower = low + width * index
        upper = high if index == bucket_count - 1 else low + width * (index + 1)
        count = sum(
            1
            for value in values
            if (lower <= value <= upper if index == bucket_count - 1 else lower <= value < upper)
        )
        buckets.append(
            {"from": quantize(lower), "to": quantize(upper), "count": count}
        )

    return {
        "count": len(values),
        "high": quantize(high),
        "low": quantize(low),
        "average": average,
        "median": quantize(median(values)),
        "buckets": buckets,
    }


def expense_to_income_trend(scope: Scope) -> dict:
    rows = []
    for bucket in daily_series(scope):
        income = D(bucket["income"])
        rows.append(
            {
                "date": bucket["date"],
                "income": bucket["income"],
                "expenses": bucket["expenses"],
                "expense_to_income_pct": pct(bucket["expenses"], income),
                "net_operating_result": bucket["net_operating_result"],
            }
        )
    summary = financial_summary(scope)
    return {"series": rows, "period_expense_to_income_pct": summary["expense_to_income_pct"]}


def comparison(scope: Scope) -> dict:
    """Factual side-by-side of drivers and vehicles — no composite scores."""
    return {
        "drivers": driver_breakdown(scope),
        "vehicles": vehicle_breakdown(scope),
        "note": "Figures are factual totals for the selected period. "
                "No weighted or composite performance score is calculated.",
    }


def cash_vs_platform(scope: Scope) -> dict:
    """Cash against everything else.

    Both sides are measured against the all-in total here whatever the toggle
    says, because a split that leaves one side out of its own denominator is
    not a split.
    """
    summary = financial_summary(scope)
    cash_income = D(summary["cash_income"])
    all_in = D(summary["gross_income_with_cash"])
    platform_income = quantize(all_in - cash_income)

    series = []
    for bucket in daily_series(scope):
        day_cash = D(bucket["cash"])
        day_platform = D(bucket["income"]) - (day_cash if scope.include_cash else ZERO)
        day_total = quantize(day_platform + day_cash)
        series.append(
            {
                "date": bucket["date"],
                "cash": quantize(day_cash),
                "platform": quantize(day_platform),
                "total": day_total,
                "cash_share_pct": pct(day_cash, day_total),
            }
        )

    return {
        "cash_income": quantize(cash_income),
        "platform_income": platform_income,
        "gross_income_with_cash": quantize(all_in),
        "includes_cash": summary["includes_cash"],
        "cash_share_pct": pct(cash_income, all_in),
        "platform_share_pct": pct(platform_income, all_in),
        "series": series,
    }


def cash_desk(scope: Scope) -> dict:
    """Everything the Cash page needs, in one round trip.

    This view is deliberately unaffected by the include-cash toggle: its whole
    subject is the cash itself. The toggle only decides whether the rest of the
    application counts these same amounts as income, which is reported here as
    ``includes_cash`` so the page can say so plainly.
    """
    summary = financial_summary(scope)
    breakdown = cash_breakdown(scope)

    cash = summary["cash"]
    all_in = D(summary["gross_income_with_cash"])
    cash_income = D(summary["cash_income"])

    series = []
    running = ZERO
    for bucket in daily_series(scope):
        day_cash = D(bucket["cash"])
        running += day_cash
        day_platform = D(bucket["income"]) - (day_cash if scope.include_cash else ZERO)
        series.append(
            {
                "date": bucket["date"],
                "weekday": bucket["weekday"],
                "cash": quantize(day_cash),
                "platform": quantize(day_platform),
                "cumulative_cash": quantize(running),
                "cash_share_pct": pct(day_cash, quantize(day_platform + day_cash)),
            }
        )

    return {
        "currency": settings.FLEET_CURRENCY,
        "scope": scope.as_dict(),
        "includes_cash": summary["includes_cash"],
        "cash_income": summary["cash_income"],
        "platform_income": quantize(all_in - cash_income),
        "gross_income_with_cash": summary["gross_income_with_cash"],
        "cash_share_pct": summary["cash_to_income_pct"],
        "cash_days": cash["active_days"],
        "average_per_cash_day": cash["average_per_active_day"],
        "largest_cash_day": breakdown["top_days"][0] if breakdown["top_days"] else None,
        "series": series,
        "by_driver": breakdown["by_driver"],
        "by_vehicle": breakdown["by_vehicle"],
        "top_days": breakdown["top_days"],
    }


def monthly_trend(scope: Scope) -> dict:
    return {"series": monthly_series(scope)}


def platform_performance(scope: Scope) -> dict:
    summary = financial_summary(scope)
    rows = sorted(summary["platforms"], key=lambda item: D(item["income"]), reverse=True)
    return {
        "gross_income": summary["gross_income"],
        "includes_cash": summary["includes_cash"],
        "cash_income": summary["cash_income"],
        "rows": rows,
        "leader": rows[0] if rows and D(rows[0]["income"]) > 0 else None,
    }

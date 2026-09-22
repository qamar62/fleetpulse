"""Business insight engine.

Every insight is derived from the ledger at request time. Nothing is hard-coded,
and an insight is simply omitted when the underlying data cannot support it —
the frontend never has to guess whether a number is real.

Each insight carries a machine-readable ``metrics`` dict alongside its sentence,
so the UI can render its own formatting without re-parsing text.
"""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings

from ..models import Expense
from .aggregation import (
    Scope,
    best_and_worst_days,
    financial_summary,
    highest_expense_day,
    inactive_days,
)
from .money import D, ZERO, change_pct, pct, quantize

POSITIVE = "positive"
NEUTRAL = "neutral"
WARNING = "warning"


def _insight(key, title, message, tone=NEUTRAL, metrics=None, priority=50):
    return {
        "key": key,
        "title": title,
        "message": message,
        "tone": tone,
        "priority": priority,
        "metrics": metrics or {},
    }


def _money(value) -> str:
    """Format a figure the way the insight sentences should read it."""
    if value is None:
        return "n/a"
    return f"{settings.FLEET_CURRENCY} {Decimal(str(value)):,.2f}"


def build_insights(scope: Scope, summary: dict | None = None, limit: int | None = None) -> list[dict]:
    summary = summary or financial_summary(scope)
    gross = D(summary["gross_income"])
    insights: list[dict] = []

    if gross == 0:
        return [
            _insight(
                "no_data",
                "No income recorded",
                "There is no income recorded for this period, so no insights can be "
                "calculated yet.",
                NEUTRAL,
                priority=0,
            )
        ]

    insights += _platform_insights(summary, gross)
    insights += _day_insights(scope)
    insights += _expense_insights(scope, summary, gross)
    insights += _profitability_insights(summary, gross)
    insights += _coverage_insights(scope)
    insights += _trend_insights(scope, summary)

    insights.sort(key=lambda item: item["priority"])
    return insights[:limit] if limit else insights


# ---------------------------------------------------------------------------


def _platform_insights(summary: dict, gross: Decimal) -> list[dict]:
    platforms = [p for p in summary["platforms"] if D(p["income"]) > 0]
    if not platforms:
        return []

    top = max(platforms, key=lambda item: D(item["income"]))
    out = [
        _insight(
            "top_platform",
            "Top performer",
            f"{top['label']} leads the platform mix at {top['share_pct']}%, "
            f"contributing {_money(top['income'])} across {top['active_days']} active days.",
            POSITIVE,
            {
                "platform": top["platform"],
                "income": top["income"],
                "share_pct": top["share_pct"],
                "active_days": top["active_days"],
            },
            priority=10,
        )
    ]

    if len(platforms) > 1 and D(top["share_pct"] or ZERO) >= 50:
        out.append(
            _insight(
                "platform_concentration",
                "Concentration risk",
                f"{top['share_pct']}% of gross income comes from a single platform "
                f"({top['label']}). A change to its rates or supply would move the whole "
                "month.",
                WARNING,
                {"platform": top["platform"], "share_pct": top["share_pct"]},
                priority=35,
            )
        )

    cash = summary["cash"]
    if D(cash["income"]) > 0:
        share = cash["share_pct"]
        tone = WARNING if share is not None and D(share) >= 30 else NEUTRAL
        counted = (
            "It is being counted as income."
            if summary["includes_cash"]
            else "It is not counted as income here; the figures above are platform income only."
        )
        out.append(
            _insight(
                "cash_share",
                "Cash exposure",
                f"Cash makes up {share}% of all money taken ({_money(cash['income'])}). "
                f"Cash collections are the hardest to reconcile against platform statements. {counted}",
                tone,
                {
                    "income": cash["income"],
                    "share_pct": share,
                    "counted": summary["includes_cash"],
                },
                priority=40,
            )
        )
    return out


def _day_insights(scope: Scope) -> list[dict]:
    days = best_and_worst_days(scope)
    best = days["best_day"]
    if not best:
        return []
    out = [
        _insight(
            "best_day",
            "Best earning day",
            f"The strongest day was {best['date']} ({best['weekday']}) at {_money(best['income'])}.",
            POSITIVE,
            best,
            priority=20,
        )
    ]
    worst = days["worst_day"]
    if worst and worst["date"] != best["date"]:
        spread = pct(D(best["income"]) - D(worst["income"]), worst["income"])
        if spread is not None and spread > 100:
            out.append(
                _insight(
                    "day_spread",
                    "Wide daily spread",
                    f"The best day earned {spread}% more than the weakest recorded day "
                    f"({worst['date']}, {_money(worst['income'])}). Daily output is uneven.",
                    NEUTRAL,
                    {"best": best, "worst": worst, "spread_pct": spread},
                    priority=55,
                )
            )
    return out


def _expense_insights(scope: Scope, summary: dict, gross: Decimal) -> list[dict]:
    out = []
    expense_ratio = summary["expense_to_income_pct"]
    fuel_ratio = summary["fuel_to_income_pct"]

    if expense_ratio is not None:
        tone = WARNING if D(expense_ratio) >= 35 else POSITIVE if D(expense_ratio) <= 20 else NEUTRAL
        message = (
            f"The expense-to-income ratio is {expense_ratio}%. "
            f"Fuel represents {fuel_ratio}% of gross income."
        )
        out.append(
            _insight(
                "expense_efficiency",
                "Efficiency",
                message,
                tone,
                {"expense_to_income_pct": expense_ratio, "fuel_to_income_pct": fuel_ratio},
                priority=15,
            )
        )

    categories = [c for c in summary["expense_categories"] if D(c["amount"]) > 0]
    if categories:
        top = max(categories, key=lambda item: D(item["amount"]))
        out.append(
            _insight(
                "top_expense_category",
                "Largest cost",
                f"{top['label']} is the largest expense category at {_money(top['amount'])} "
                f"({top['share_pct']}% of operating expenses, across {top['count']} entries).",
                NEUTRAL,
                top,
                priority=30,
            )
        )

    spike = highest_expense_day(scope)
    if spike and D(summary["operating_expenses"]) > 0:
        share = pct(spike["amount"], summary["operating_expenses"])
        if share is not None and D(share) >= 15:
            out.append(
                _insight(
                    "expense_spike",
                    "Watch closely",
                    f"{share}% of the period's operating expenses landed on a single day "
                    f"({spike['date']}, {spike['amount']}). Worth checking that entry.",
                    WARNING,
                    {**spike, "share_pct": share},
                    priority=25,
                )
            )
    return out


def _profitability_insights(summary: dict, gross: Decimal) -> list[dict]:
    margin = summary["operating_margin_pct"]
    if margin is None:
        return []
    tone = POSITIVE if D(margin) > 0 else WARNING
    out = [
        _insight(
            "operating_margin",
            "Operating margin",
            f"Operating profit is {_money(summary['operating_profit'])} on "
            f"{_money(summary['gross_income'])} "
            f"gross income — a {margin}% operating margin.",
            tone,
            {
                "operating_profit": summary["operating_profit"],
                "operating_margin_pct": margin,
            },
            priority=5,
        )
    ]
    if D(summary["payroll"]) > 0:
        out.append(
            _insight(
                "net_result",
                "After payroll",
                f"After {_money(summary['payroll'])} of driver payroll, the net result is "
                f"{_money(summary['net_result'])} ({summary['net_margin_pct']}% net margin).",
                POSITIVE if D(summary["net_result"]) > 0 else WARNING,
                {
                    "payroll": summary["payroll"],
                    "net_result": summary["net_result"],
                    "net_margin_pct": summary["net_margin_pct"],
                },
                priority=18,
            )
        )
    return out


def _coverage_insights(scope: Scope) -> list[dict]:
    coverage = inactive_days(scope)
    idle = coverage.get("inactive_days")
    if not idle:
        return []
    share = pct(idle, coverage["calendar_days"])
    return [
        _insight(
            "inactive_days",
            "Idle days",
            f"{idle} of {coverage['calendar_days']} days in this period have no recorded "
            f"income ({share}%). That is either genuine downtime or missing data entry.",
            WARNING if share is not None and D(share) >= 20 else NEUTRAL,
            coverage,
            priority=45,
        )
    ]


def _trend_insights(scope: Scope, summary: dict) -> list[dict]:
    previous_period = scope.period.previous()
    if previous_period is None:
        return []
    previous = financial_summary(scope.with_period(previous_period))
    if D(previous["gross_income"]) == 0:
        return []

    delta = change_pct(summary["gross_income"], previous["gross_income"])
    direction = "up" if D(delta) >= 0 else "down"
    return [
        _insight(
            "period_change",
            "Versus previous period",
            f"Gross income is {direction} {abs(D(delta))}% against {previous_period.label} "
            f"({_money(previous['gross_income'])} → {_money(summary['gross_income'])}).",
            POSITIVE if D(delta) >= 0 else WARNING,
            {
                "change_pct": delta,
                "previous_label": previous_period.label,
                "previous_gross_income": previous["gross_income"],
            },
            priority=12,
        )
    ]

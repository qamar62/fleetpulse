"""The Reports Centre.

Each report returns the same envelope::

    {
      "key", "title", "description",
      "scope", "currency",
      "kpis":    [{label, value, format}],
      "charts":  [{type, title, data}],
      "columns": [{key, label, format}],
      "rows":    [...],
      "totals":  {...}
    }

That uniform shape means the frontend renders every report — and every CSV
export — with one component.
"""

from __future__ import annotations

from django.conf import settings

from ..models import Expense
from .aggregation import (
    Scope,
    daily_series,
    driver_breakdown,
    financial_summary,
    monthly_series,
    payroll_totals,
    vehicle_breakdown,
)
from .analytics import platform_performance
from .money import D, ZERO, pct, quantize

MONEY = "money"
NUMBER = "number"
PCT = "percent"
TEXT = "text"
DATE = "date"


def _envelope(key, title, description, scope, *, kpis, columns, rows, charts=None, totals=None):
    return {
        "key": key,
        "title": title,
        "description": description,
        "scope": scope.as_dict(),
        "currency": settings.FLEET_CURRENCY,
        "kpis": kpis,
        "charts": charts or [],
        "columns": columns,
        "rows": rows,
        "totals": totals or {},
        "row_count": len(rows),
    }


def _kpi(label, value, fmt=MONEY, note=None):
    return {"label": label, "value": value, "format": fmt, "note": note}


def _col(key, label, fmt=TEXT):
    return {"key": key, "label": label, "format": fmt}


# ---------------------------------------------------------------------------
# 1. Monthly income
# ---------------------------------------------------------------------------


def monthly_income(scope: Scope) -> dict:
    summary = financial_summary(scope)
    rows = monthly_series(scope)
    return _envelope(
        "monthly-income",
        "Monthly income",
        "Gross income, operating expenses and profit for each month in range.",
        scope,
        kpis=[
            _kpi("Gross income", summary["gross_income"]),
            _kpi("Operating expenses", summary["operating_expenses"]),
            _kpi("Operating profit", summary["operating_profit"]),
            _kpi("Operating margin", summary["operating_margin_pct"], PCT),
        ],
        charts=[{"type": "bar", "title": "Income vs expenses by month", "data": rows}],
        columns=[
            _col("label", "Month"),
            _col("gross_income", "Gross income", MONEY),
            _col("operating_expenses", "Operating expenses", MONEY),
            _col("operating_profit", "Operating profit", MONEY),
            _col("payroll", "Payroll", MONEY),
            _col("net_result", "Net result", MONEY),
            _col("operating_margin_pct", "Operating margin", PCT),
        ],
        rows=rows,
        totals={
            "gross_income": summary["gross_income"],
            "operating_expenses": summary["operating_expenses"],
            "operating_profit": summary["operating_profit"],
        },
    )


# ---------------------------------------------------------------------------
# 2. Platform performance
# ---------------------------------------------------------------------------


def platform_report(scope: Scope) -> dict:
    data = platform_performance(scope)
    leader = data["leader"]
    return _envelope(
        "platform-performance",
        "Platform performance",
        "Income contribution, active days and daily average for every channel.",
        scope,
        kpis=[
            _kpi("Gross income", data["gross_income"]),
            _kpi("Leading platform", leader["label"] if leader else None, TEXT),
            _kpi("Leader share", leader["share_pct"] if leader else None, PCT),
            _kpi("Channels with income", sum(1 for r in data["rows"] if D(r["income"]) > 0), NUMBER),
        ],
        charts=[{"type": "donut", "title": "Income by platform", "data": data["rows"]}],
        columns=[
            _col("label", "Platform"),
            _col("income", "Income", MONEY),
            _col("share_pct", "Share", PCT),
            _col("active_days", "Active days", NUMBER),
            _col("average_per_active_day", "Average / active day", MONEY),
        ],
        rows=data["rows"],
        totals={"income": data["gross_income"]},
    )


# ---------------------------------------------------------------------------
# 3 & 4. Driver and vehicle performance
# ---------------------------------------------------------------------------


def driver_performance(scope: Scope) -> dict:
    rows = driver_breakdown(scope)
    summary = financial_summary(scope)
    return _envelope(
        "driver-performance",
        "Driver performance",
        "Factual income, expense and margin totals per driver. No composite scores.",
        scope,
        kpis=[
            _kpi("Drivers with activity", len(rows), NUMBER),
            _kpi("Gross income", summary["gross_income"]),
            _kpi("Operating profit", summary["operating_profit"]),
            _kpi("Average daily income", summary["average_daily_income"]),
        ],
        charts=[{"type": "bar", "title": "Gross income by driver", "data": rows}],
        columns=[
            _col("driver", "Driver"),
            _col("vehicle", "Vehicle"),
            _col("gross_income", "Gross income", MONEY),
            _col("operating_expenses", "Expenses", MONEY),
            _col("operating_profit", "Operating profit", MONEY),
            _col("average_per_day", "Average / day", MONEY),
            _col("active_days", "Active days", NUMBER),
            _col("operating_margin_pct", "Margin", PCT),
        ],
        rows=rows,
        totals={
            "gross_income": summary["gross_income"],
            "operating_expenses": summary["operating_expenses"],
            "operating_profit": summary["operating_profit"],
        },
    )


def vehicle_performance(scope: Scope) -> dict:
    rows = vehicle_breakdown(scope)
    summary = financial_summary(scope)
    return _envelope(
        "vehicle-performance",
        "Vehicle performance",
        "Income and running costs per vehicle, including fuel, Salik and maintenance.",
        scope,
        kpis=[
            _kpi("Vehicles with activity", len(rows), NUMBER),
            _kpi("Gross income", summary["gross_income"]),
            _kpi("Operating expenses", summary["operating_expenses"]),
            _kpi("Expense / income", summary["expense_to_income_pct"], PCT),
        ],
        charts=[{"type": "bar", "title": "Operating profit by vehicle", "data": rows}],
        columns=[
            _col("vehicle", "Vehicle"),
            _col("plate_number", "Plate"),
            _col("assigned_driver", "Driver"),
            _col("gross_income", "Income", MONEY),
            _col("fuel", "Fuel", MONEY),
            _col("salik", "Salik", MONEY),
            _col("maintenance", "Maintenance", MONEY),
            _col("operating_expenses", "Total expenses", MONEY),
            _col("operating_profit", "Operating profit", MONEY),
            _col("income_per_active_day", "Income / day", MONEY),
            _col("expense_to_income_pct", "Expense ratio", PCT),
        ],
        rows=rows,
        totals={
            "gross_income": summary["gross_income"],
            "operating_expenses": summary["operating_expenses"],
        },
    )


# ---------------------------------------------------------------------------
# 5. Expenses
# ---------------------------------------------------------------------------


def expense_report(scope: Scope) -> dict:
    summary = financial_summary(scope)
    rows = summary["expense_categories"]
    active_days = summary["active_days"]
    for row in rows:
        row["per_active_day"] = (
            quantize(D(row["amount"]) / active_days) if active_days else None
        )
        row["share_of_income_pct"] = pct(row["amount"], summary["gross_income"])

    return _envelope(
        "expenses",
        "Expenses",
        "Operating cost breakdown by category, with efficiency against income.",
        scope,
        kpis=[
            _kpi("Total expenses", summary["operating_expenses"]),
            _kpi("Expense / income", summary["expense_to_income_pct"], PCT),
            _kpi("Expense per active day", summary["expense_per_active_day"]),
            _kpi("Fuel / income", summary["fuel_to_income_pct"], PCT),
        ],
        charts=[
            {"type": "bar", "title": "Expenses by category", "data": rows},
            {"type": "line", "title": "Daily expense trend", "data": daily_series(scope)},
        ],
        columns=[
            _col("label", "Category"),
            _col("amount", "Amount", MONEY),
            _col("count", "Entries", NUMBER),
            _col("share_pct", "Share of expenses", PCT),
            _col("share_of_income_pct", "Share of income", PCT),
            _col("per_active_day", "Per active day", MONEY),
        ],
        rows=rows,
        totals={"amount": summary["operating_expenses"]},
    )


# ---------------------------------------------------------------------------
# 6. Profitability
# ---------------------------------------------------------------------------


def profitability(scope: Scope) -> dict:
    from .analytics import profitability_waterfall

    summary = financial_summary(scope)
    waterfall = profitability_waterfall(summary)
    return _envelope(
        "profitability",
        "Profitability",
        "The explicit chain from gross income to net result.",
        scope,
        kpis=[
            _kpi("Gross income", summary["gross_income"]),
            _kpi("Operating profit", summary["operating_profit"]),
            _kpi("Operating margin", summary["operating_margin_pct"], PCT),
            _kpi("Net result", summary["net_result"]),
            _kpi("Net margin", summary["net_margin_pct"], PCT),
        ],
        charts=[{"type": "waterfall", "title": "Income to net result", "data": waterfall["steps"]}],
        columns=[
            _col("label", "Step"),
            _col("amount", "Amount", MONEY),
            _col("kind", "Type"),
        ],
        rows=waterfall["steps"],
        totals={
            "operating_profit": summary["operating_profit"],
            "net_result": summary["net_result"],
        },
    )


# ---------------------------------------------------------------------------
# 7. Payroll / settlement
# ---------------------------------------------------------------------------


def payroll_report(scope: Scope) -> dict:
    totals = payroll_totals(scope)
    rows = [
        {
            "driver": settlement.driver.name,
            "driver_id": settlement.driver_id,
            "period": settlement.period.isoformat(),
            "period_label": settlement.period.strftime("%B %Y"),
            "salary": settlement.salary,
            "advance": settlement.advance,
            "other_deductions": settlement.other_deductions,
            "rent": settlement.rent,
            "paid_amount": settlement.paid_amount,
            "balance": settlement.balance,
            "notes": settlement.notes,
        }
        for settlement in scope.payroll().select_related("driver")
    ]
    return _envelope(
        "payroll",
        "Payroll & settlements",
        "Driver settlements. Balance = salary − advance − other deductions − rent − paid.",
        scope,
        kpis=[
            _kpi("Salary charged", totals["salary"]),
            _kpi("Paid out", totals["paid_amount"]),
            _kpi("Outstanding balance", totals["balance"]),
            _kpi("Settlements", totals["settlements"], NUMBER),
        ],
        charts=[{"type": "bar", "title": "Settlement balance by driver", "data": rows}],
        columns=[
            _col("period_label", "Period"),
            _col("driver", "Driver"),
            _col("salary", "Salary", MONEY),
            _col("advance", "Advance", MONEY),
            _col("other_deductions", "Other deductions", MONEY),
            _col("rent", "Rent", MONEY),
            _col("paid_amount", "Paid", MONEY),
            _col("balance", "Balance", MONEY),
        ],
        rows=rows,
        totals=totals,
    )


# ---------------------------------------------------------------------------
# 8. Daily earnings
# ---------------------------------------------------------------------------


def daily_earnings_report(scope: Scope) -> dict:
    summary = financial_summary(scope)
    platforms = settings.INCOME_PLATFORMS

    rows = []
    expense_index = _expense_index(scope)
    for earning in scope.earnings().select_related("driver", "vehicle"):
        key = (earning.date, earning.driver_id, earning.vehicle_id)
        spend = expense_index.get(key, {"total": ZERO, "fuel": ZERO})
        total = D(earning.total_income)
        rows.append(
            {
                "id": earning.id,
                "date": earning.date.isoformat(),
                "driver": earning.driver.name,
                "vehicle": str(earning.vehicle),
                **{name: getattr(earning, name) for name in platforms},
                "total_income": quantize(total),
                "fuel": quantize(spend["fuel"]),
                "other_expenses": quantize(spend["total"] - spend["fuel"]),
                "net_operating_result": quantize(total - spend["total"]),
                "status": "recorded" if total > 0 else "no_income",
            }
        )

    return _envelope(
        "daily-earnings",
        "Daily earnings",
        "The complete earnings ledger with matched same-day expenses.",
        scope,
        kpis=[
            _kpi("Gross income", summary["gross_income"]),
            _kpi("Entries", summary["entries"], NUMBER),
            _kpi("Active days", summary["active_days"], NUMBER),
            _kpi("Average daily income", summary["average_daily_income"]),
        ],
        charts=[{"type": "area", "title": "Daily income trend", "data": daily_series(scope)}],
        columns=[
            _col("date", "Date", DATE),
            _col("driver", "Driver"),
            _col("vehicle", "Vehicle"),
            *[_col(name, name.title(), MONEY) for name in platforms],
            _col("total_income", "Total income", MONEY),
            _col("fuel", "Fuel", MONEY),
            _col("other_expenses", "Other expenses", MONEY),
            _col("net_operating_result", "Net operating result", MONEY),
            _col("status", "Status"),
        ],
        rows=rows,
        totals={
            "total_income": summary["gross_income"],
            "net_operating_result": summary["operating_profit"],
        },
    )


def _expense_index(scope: Scope) -> dict:
    index: dict[tuple, dict] = {}
    for expense in scope.expenses().values("date", "driver_id", "vehicle_id", "category", "amount"):
        key = (expense["date"], expense["driver_id"], expense["vehicle_id"])
        bucket = index.setdefault(key, {"total": ZERO, "fuel": ZERO})
        amount = D(expense["amount"])
        bucket["total"] += amount
        if expense["category"] == Expense.Category.FUEL:
            bucket["fuel"] += amount
    return index


# ---------------------------------------------------------------------------
# 9. Cash flow
# ---------------------------------------------------------------------------


def cash_flow(scope: Scope) -> dict:
    summary = financial_summary(scope)
    totals = payroll_totals(scope)

    running = ZERO
    rows = []
    for bucket in daily_series(scope):
        inflow = D(bucket["income"])
        outflow = D(bucket["expenses"])
        running += inflow - outflow
        rows.append(
            {
                "date": bucket["date"],
                "inflow": quantize(inflow),
                "outflow": quantize(outflow),
                "net": quantize(inflow - outflow),
                "running_balance": quantize(running),
            }
        )

    cash_platform = next(
        (p for p in summary["platforms"] if p["platform"] == "cash"), None
    )
    return _envelope(
        "cash-flow",
        "Cash flow",
        "Daily inflow, outflow and running operating balance. Payroll payments are "
        "reported separately below the operating flow.",
        scope,
        kpis=[
            _kpi("Total inflow", summary["gross_income"]),
            _kpi("Total outflow", summary["operating_expenses"]),
            _kpi("Net operating flow", summary["operating_profit"]),
            _kpi("Payroll paid", totals["paid_amount"]),
            _kpi(
                "Cash collected",
                cash_platform["income"] if cash_platform else ZERO,
                MONEY,
                "Physical cash portion of income",
            ),
        ],
        charts=[{"type": "line", "title": "Running operating balance", "data": rows}],
        columns=[
            _col("date", "Date", DATE),
            _col("inflow", "Inflow", MONEY),
            _col("outflow", "Outflow", MONEY),
            _col("net", "Net", MONEY),
            _col("running_balance", "Running balance", MONEY),
        ],
        rows=rows,
        totals={
            "inflow": summary["gross_income"],
            "outflow": summary["operating_expenses"],
            "net": summary["operating_profit"],
        },
    )


REPORTS = {
    "monthly-income": monthly_income,
    "platform-performance": platform_report,
    "driver-performance": driver_performance,
    "vehicle-performance": vehicle_performance,
    "expenses": expense_report,
    "profitability": profitability,
    "payroll": payroll_report,
    "daily-earnings": daily_earnings_report,
    "cash-flow": cash_flow,
}

REPORT_CATALOG = [
    {"key": "monthly-income", "title": "Monthly income",
     "description": "Income, expenses and profit month by month."},
    {"key": "platform-performance", "title": "Platform performance",
     "description": "Contribution and consistency of each income channel."},
    {"key": "driver-performance", "title": "Driver performance",
     "description": "Factual per-driver income, cost and margin."},
    {"key": "vehicle-performance", "title": "Vehicle performance",
     "description": "Per-vehicle income against fuel, Salik and maintenance."},
    {"key": "expenses", "title": "Expenses",
     "description": "Cost structure and efficiency by category."},
    {"key": "profitability", "title": "Profitability",
     "description": "Gross income through to net result, step by step."},
    {"key": "payroll", "title": "Payroll & settlements",
     "description": "Driver salary, deductions and outstanding balances."},
    {"key": "daily-earnings", "title": "Daily earnings",
     "description": "The full earnings ledger with matched expenses."},
    {"key": "cash-flow", "title": "Cash flow",
     "description": "Daily inflow, outflow and running balance."},
]

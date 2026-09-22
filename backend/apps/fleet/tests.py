"""Tests for the rules the spec is strict about.

The spec makes a small number of promises that are easy to break silently:

* income is the sum of the five platform columns, nothing else;
* operating profit is gross income minus *operating* expenses (payroll is not
  an operating expense);
* a ratio with a zero denominator is "N/A", never 0%;
* a comparison with no prior period is absent, never invented;
* a spreadsheet TOTAL column is never authoritative.

Each of those gets a test here, plus smoke coverage of every endpoint.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Sum
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from apps.fleet.models import DailyEarning, Driver, Expense, PayrollSettlement, Vehicle
from apps.fleet.services import importing
from apps.fleet.services.aggregation import Scope, compare, financial_summary
from apps.fleet.services.insights import build_insights
from apps.fleet.services.money import ZERO, change_pct, pct, quantize, safe_div
from apps.fleet.services.periods import Period, resolve_period

User = get_user_model()

DEC = Period(date(2025, 12, 1), date(2025, 12, 31), "December 2025", "month")
NOV = Period(date(2025, 11, 1), date(2025, 11, 30), "November 2025", "month")
EMPTY = Period(date(2024, 1, 1), date(2024, 1, 31), "January 2024", "month")


def _seed_minimal():
    """One driver, one vehicle, two earning days, two expenses, one settlement."""
    driver = Driver.objects.create(name="Zeeshan Ahmed", phone="+971 50 482 1902")
    vehicle = Vehicle.objects.create(
        plate_number="D586986", make="BMW", model="7 Series", assigned_driver=driver
    )
    DailyEarning.objects.create(
        date=date(2025, 12, 1), driver=driver, vehicle=vehicle,
        careem=Decimal("1000.00"), uber=Decimal("500.00"), bolt=Decimal("250.00"),
        yango=Decimal("100.00"), cash=Decimal("150.00"),
    )
    DailyEarning.objects.create(
        date=date(2025, 12, 2), driver=driver, vehicle=vehicle,
        careem=Decimal("800.00"), uber=Decimal("400.00"), bolt=Decimal("0.00"),
        yango=Decimal("0.00"), cash=Decimal("800.00"),
    )
    Expense.objects.create(
        date=date(2025, 12, 1), driver=driver, vehicle=vehicle,
        category="fuel", amount=Decimal("100.00"),
    )
    Expense.objects.create(
        date=date(2025, 12, 2), driver=driver, vehicle=vehicle,
        category="salik", amount=Decimal("50.00"),
    )
    PayrollSettlement.objects.create(
        driver=driver, period=date(2025, 12, 1),
        salary=Decimal("3500.00"), advance=Decimal("500.00"),
        other_deductions=Decimal("100.00"), rent=Decimal("400.00"),
        paid_amount=Decimal("1000.00"),
    )
    return driver, vehicle


# ---------------------------------------------------------------------------
# Money primitives
# ---------------------------------------------------------------------------


class MoneyTests(TestCase):
    def test_zero_denominator_is_none_not_zero(self):
        """"N/A" and "0%" mean different things; never conflate them."""
        self.assertIsNone(safe_div(100, 0))
        self.assertIsNone(pct(100, 0))
        self.assertIsNone(change_pct(100, 0))

    def test_real_ratios_still_compute(self):
        self.assertEqual(pct(25, 200), Decimal("12.50"))
        self.assertEqual(change_pct(150, 100), Decimal("50.00"))

    def test_decline_is_negative_not_absolute(self):
        self.assertEqual(change_pct(50, 100), Decimal("-50.00"))

    def test_rounding_is_half_up(self):
        self.assertEqual(quantize(Decimal("2.345")), Decimal("2.35"))
        self.assertEqual(quantize(Decimal("2.344")), Decimal("2.34"))

    def test_floats_never_enter_as_binary_floats(self):
        """D(0.1) must be 0.1, not 0.1000000000000000055511151231257827."""
        from apps.fleet.services.money import D

        self.assertEqual(D(0.1) + D(0.2), Decimal("0.3"))


# ---------------------------------------------------------------------------
# Model-level derived values
# ---------------------------------------------------------------------------


class GeneratedFieldTests(TestCase):
    def test_total_income_is_the_sum_of_the_five_platforms(self):
        driver, vehicle = _seed_minimal()
        row = DailyEarning.objects.get(date=date(2025, 12, 1))
        self.assertEqual(row.total_income, Decimal("2000.00"))

    def test_total_income_follows_edits(self):
        driver, vehicle = _seed_minimal()
        row = DailyEarning.objects.get(date=date(2025, 12, 1))
        row.cash = Decimal("1150.00")
        row.save()
        row.refresh_from_db()
        self.assertEqual(row.total_income, Decimal("3000.00"))

    def test_settlement_balance_formula(self):
        """Balance = salary − advance − other deductions − rent − paid."""
        _seed_minimal()
        settlement = PayrollSettlement.objects.get()
        self.assertEqual(settlement.balance, Decimal("1500.00"))


# ---------------------------------------------------------------------------
# The financial summary
# ---------------------------------------------------------------------------


class FinancialSummaryTests(TestCase):
    """The default basis: cash collected but not counted.

    The seed takes 4000.00 in total, 950.00 of it in cash, so counted income
    is 3050.00 unless a caller explicitly asks for cash.
    """

    def setUp(self):
        _seed_minimal()
        self.summary = financial_summary(Scope(period=DEC))

    def test_gross_income_excludes_cash_by_default(self):
        self.assertEqual(Decimal(str(self.summary["gross_income"])), Decimal("3050.00"))

    def test_cash_is_still_reported_alongside(self):
        self.assertEqual(Decimal(str(self.summary["cash_income"])), Decimal("950.00"))
        self.assertEqual(
            Decimal(str(self.summary["gross_income_with_cash"])), Decimal("4000.00")
        )
        self.assertFalse(self.summary["includes_cash"])

    def test_operating_expenses_exclude_payroll(self):
        self.assertEqual(Decimal(str(self.summary["operating_expenses"])), Decimal("150.00"))

    def test_operating_profit_is_gross_minus_operating_expenses(self):
        self.assertEqual(Decimal(str(self.summary["operating_profit"])), Decimal("2900.00"))

    def test_net_result_subtracts_payroll_separately(self):
        # Payroll cost for the period is the salary line, 3500.
        self.assertEqual(Decimal(str(self.summary["net_result"])), Decimal("-600.00"))

    def test_operating_margin(self):
        # 2900 / 3050 * 100
        self.assertEqual(Decimal(str(self.summary["operating_margin_pct"])), Decimal("95.08"))

    def test_active_days_counts_days_with_counted_income(self):
        self.assertEqual(self.summary["active_days"], 2)

    def test_average_daily_income_divides_by_active_days(self):
        self.assertEqual(Decimal(str(self.summary["average_daily_income"])), Decimal("1525.00"))

    def test_cash_is_not_listed_among_the_counted_platforms(self):
        """Every share_pct in the list must be a share of the same total."""
        names = [p["platform"] for p in self.summary["platforms"]]
        self.assertNotIn("cash", names)
        self.assertEqual(names, ["careem", "uber", "bolt", "yango"])

    def test_empty_period_reports_na_not_zero_percent(self):
        empty = financial_summary(Scope(period=EMPTY))
        self.assertEqual(Decimal(str(empty["gross_income"])), Decimal("0.00"))
        self.assertIsNone(empty["operating_margin_pct"])
        self.assertIsNone(empty["average_daily_income"])
        self.assertIsNone(empty["expense_to_income_pct"])


class CashToggleTests(TestCase):
    """Cash is opt-in, and switching it on must not change anything else.

    The seed is 4000.00 all-in with 950.00 of it cash, so every assertion here
    is really one identity: counted income plus cash equals the money taken.
    """

    def setUp(self):
        _seed_minimal()
        self.off = financial_summary(Scope(period=DEC))
        self.on = financial_summary(Scope(period=DEC, include_cash=True))

    def test_the_two_bases_differ_by_exactly_the_cash(self):
        self.assertEqual(
            Decimal(str(self.off["gross_income"])) + Decimal(str(self.off["cash_income"])),
            Decimal(str(self.on["gross_income"])),
        )

    def test_cash_income_is_the_same_number_either_way(self):
        self.assertEqual(
            Decimal(str(self.off["cash_income"])), Decimal(str(self.on["cash_income"]))
        )

    def test_all_in_total_is_the_same_number_either_way(self):
        self.assertEqual(
            Decimal(str(self.off["gross_income_with_cash"])),
            Decimal(str(self.on["gross_income_with_cash"])),
        )

    def test_cash_share_is_measured_against_the_all_in_total(self):
        """950 / 4000, whatever the toggle says - otherwise the number moves
        for a reason that has nothing to do with how much cash came in."""
        self.assertEqual(Decimal(str(self.off["cash_to_income_pct"])), Decimal("23.75"))
        self.assertEqual(Decimal(str(self.on["cash_to_income_pct"])), Decimal("23.75"))

    def test_expenses_and_payroll_are_untouched(self):
        for key in ("operating_expenses", "payroll", "payroll_paid"):
            self.assertEqual(
                Decimal(str(self.off[key])), Decimal(str(self.on[key])), key
            )

    def test_profit_moves_by_the_cash_too(self):
        self.assertEqual(
            Decimal(str(self.off["operating_profit"])) + Decimal(str(self.off["cash_income"])),
            Decimal(str(self.on["operating_profit"])),
        )

    def test_cash_listed_among_platforms_only_when_counted(self):
        self.assertNotIn("cash", [p["platform"] for p in self.off["platforms"]])
        self.assertIn("cash", [p["platform"] for p in self.on["platforms"]])
        self.assertFalse(self.off["cash"]["counted"])
        self.assertTrue(self.on["cash"]["counted"])

    def test_a_cash_only_day_is_not_an_active_day(self):
        driver = Driver.objects.get()
        vehicle = Vehicle.objects.get()
        DailyEarning.objects.create(
            date=date(2025, 12, 20), driver=driver, vehicle=vehicle,
            cash=Decimal("400.00"),
        )
        self.assertEqual(financial_summary(Scope(period=DEC))["active_days"], 2)
        self.assertEqual(
            financial_summary(Scope(period=DEC, include_cash=True))["active_days"], 3
        )

    def test_per_driver_totals_follow_the_same_basis(self):
        from apps.fleet.services.aggregation import driver_breakdown

        off = driver_breakdown(Scope(period=DEC))[0]
        on = driver_breakdown(Scope(period=DEC, include_cash=True))[0]
        self.assertEqual(Decimal(str(off["gross_income"])), Decimal("3050.00"))
        self.assertEqual(Decimal(str(on["gross_income"])), Decimal("4000.00"))
        self.assertEqual(Decimal(str(off["cash_income"])), Decimal("950.00"))
        self.assertEqual(Decimal(str(on["cash_income"])), Decimal("950.00"))


class CashDeskTests(TestCase):
    """The Cash page reports cash, so the toggle must not move its figures."""

    def setUp(self):
        _seed_minimal()
        from apps.fleet.services.analytics import cash_desk

        self.desk = cash_desk(Scope(period=DEC))
        self.desk_on = cash_desk(Scope(period=DEC, include_cash=True))

    def test_headline_cash_is_the_period_total(self):
        self.assertEqual(Decimal(str(self.desk["cash_income"])), Decimal("950.00"))

    def test_toggle_does_not_move_the_cash_figures(self):
        for key in ("cash_income", "platform_income", "gross_income_with_cash", "cash_days"):
            self.assertEqual(str(self.desk[key]), str(self.desk_on[key]), key)

    def test_it_says_whether_the_rest_of_the_app_counts_this_money(self):
        self.assertFalse(self.desk["includes_cash"])
        self.assertTrue(self.desk_on["includes_cash"])

    def test_driver_rows_add_back_to_the_headline(self):
        self.assertEqual(
            sum(Decimal(str(r["cash_income"])) for r in self.desk["by_driver"]),
            Decimal(str(self.desk["cash_income"])),
        )

    def test_one_row_per_driver_not_one_per_day(self):
        """Guards the grouping: ordering by a column re-splits the groups."""
        self.assertEqual(len(self.desk["by_driver"]), 1)
        self.assertEqual(self.desk["by_driver"][0]["cash_days"], 2)

    def test_daily_series_adds_back_to_the_headline(self):
        self.assertEqual(
            sum(Decimal(str(r["cash"])) for r in self.desk["series"]),
            Decimal(str(self.desk["cash_income"])),
        )

    def test_days_with_no_cash_are_left_out_of_the_breakdown(self):
        driver = Driver.objects.get()
        vehicle = Vehicle.objects.get()
        DailyEarning.objects.create(
            date=date(2025, 12, 21), driver=driver, vehicle=vehicle,
            careem=Decimal("500.00"),
        )
        from apps.fleet.services.analytics import cash_desk

        desk = cash_desk(Scope(period=DEC))
        self.assertEqual(desk["by_driver"][0]["cash_days"], 2)
        self.assertEqual(Decimal(str(desk["cash_income"])), Decimal("950.00"))


class ComparisonTests(TestCase):
    KEYS = ["gross_income", "operating_expenses", "operating_profit"]

    def test_comparison_absent_when_no_prior_data(self):
        """November is empty, so December has nothing honest to compare against."""
        _seed_minimal()
        current = financial_summary(Scope(period=DEC))
        previous = financial_summary(Scope(period=NOV))
        result = compare(current, previous, self.KEYS)
        for key in self.KEYS:
            self.assertFalse(result[key]["has_comparison"], key)
            self.assertIsNone(result[key]["change_pct"], key)

    def test_comparison_is_omitted_entirely_when_previous_is_none(self):
        _seed_minimal()
        result = compare(financial_summary(Scope(period=DEC)), None, self.KEYS)
        self.assertIsNone(result["gross_income"]["previous"])
        self.assertIsNone(result["gross_income"]["change_pct"])

    def test_comparison_present_when_prior_data_exists(self):
        driver, vehicle = _seed_minimal()
        DailyEarning.objects.create(
            date=date(2025, 11, 15), driver=driver, vehicle=vehicle,
            careem=Decimal("2000.00"),
        )
        result = compare(
            financial_summary(Scope(period=DEC)),
            financial_summary(Scope(period=NOV)),
            self.KEYS,
        )
        self.assertTrue(result["gross_income"]["has_comparison"])
        # 3050 counted in December vs 2000 in November.
        self.assertEqual(
            Decimal(str(result["gross_income"]["change_pct"])), Decimal("52.50")
        )

    def test_dashboard_flags_the_absence_of_a_comparison(self):
        _seed_minimal()
        from apps.fleet.services.analytics import dashboard

        data = dashboard(Scope(period=DEC))
        self.assertIn("kpis", data)
        self.assertFalse(data["kpis"]["gross_income"]["has_comparison"])


class InsightTests(TestCase):
    def test_no_data_yields_a_single_honest_insight(self):
        insights = build_insights(Scope(period=EMPTY))
        self.assertEqual(len(insights), 1)
        self.assertEqual(insights[0]["key"], "no_data")

    def test_insights_are_generated_and_prioritised(self):
        _seed_minimal()
        insights = build_insights(Scope(period=DEC))
        self.assertGreater(len(insights), 0)
        priorities = [i["priority"] for i in insights]
        self.assertEqual(priorities, sorted(priorities))
        for insight in insights:
            self.assertIn(insight["tone"], {"positive", "neutral", "warning", "critical"})


# ---------------------------------------------------------------------------
# Period resolution
# ---------------------------------------------------------------------------


class PeriodTests(TestCase):
    def test_month_parameter(self):
        period = resolve_period({"month": "2025-12"})
        self.assertEqual((period.start, period.end), (date(2025, 12, 1), date(2025, 12, 31)))

    def test_explicit_range(self):
        period = resolve_period({"start": "2025-12-05", "end": "2025-12-09"})
        self.assertEqual(period.days, 5)

    def test_reversed_range_is_rejected(self):
        with self.assertRaises(ValidationError):
            resolve_period({"start": "2025-12-09", "end": "2025-12-05"})

    def test_previous_period_is_the_same_length(self):
        period = resolve_period({"month": "2025-12"})
        previous = period.previous()
        self.assertEqual((previous.start, previous.end), (date(2025, 11, 1), date(2025, 11, 30)))

    def test_bad_input_is_a_400_not_a_500(self):
        with self.assertRaises(ValidationError):
            resolve_period({"month": "not-a-month"})

    def test_relative_ranges(self):
        period = resolve_period({"range": "30d", "reference": "2025-12-31"})
        self.assertEqual(period.days, 30)
        self.assertEqual(period.end, date(2025, 12, 31))


# ---------------------------------------------------------------------------
# Import wizard
# ---------------------------------------------------------------------------


class ImportParsingTests(TestCase):
    def test_amount_formats(self):
        """parse_amount returns (value, problem) — the problem is never silent."""
        cases = {
            "1,234.56": Decimal("1234.56"),   # thousands separator
            "1.234,56": Decimal("1234.56"),   # European notation
            "AED 900": Decimal("900.00"),     # currency prefix
            "1 200": Decimal("1200.00"),      # space separator
            "": ZERO,                         # a blank cell is a real zero
            "-": ZERO,
            "n/a": ZERO,
        }
        for raw, expected in cases.items():
            value, problem = importing.parse_amount(raw)
            self.assertEqual(value, expected, raw)
            self.assertIsNone(problem, raw)

    def test_unparseable_amount_is_flagged_not_zeroed(self):
        """"twelve dirhams" must not quietly become 0.00."""
        value, problem = importing.parse_amount("twelve dirhams")
        self.assertIsNone(value)
        self.assertIsNotNone(problem)

    def test_negative_income_is_rejected_with_a_reason(self):
        for raw in ("-250.00", "(250.00)"):
            value, problem = importing.parse_amount(raw)
            self.assertIsNone(value, raw)
            self.assertIn("negative", problem.lower(), raw)

    def test_date_formats(self):
        for raw in ("2025-12-01", "01/12/2025", "1 Dec 2025", "Dec 1, 2025", "01-12-2025"):
            self.assertEqual(importing.parse_date(raw), date(2025, 12, 1), raw)

    def test_excel_serial_date(self):
        self.assertEqual(importing.parse_date("45992"), date(2025, 12, 1))

    def test_unparseable_date_is_none(self):
        self.assertIsNone(importing.parse_date("sometime last week"))

    def test_column_detection_is_alias_tolerant(self):
        detection = importing.detect_columns(
            ["DATE", "Driver Name", "Plate No.", "CAREEM", "UBER ", "Petrol", "Toll"]
        )
        mapping = detection["mapping"]
        self.assertEqual(mapping["date"], 0)
        self.assertEqual(mapping["driver"], 1)
        self.assertEqual(mapping["vehicle"], 2)
        self.assertEqual(mapping["careem"], 3)
        self.assertEqual(mapping["uber"], 4)
        self.assertEqual(mapping["fuel"], 5)
        self.assertEqual(mapping["salik"], 6)
        self.assertEqual(detection["missing_required"], [])

    def test_missing_date_column_blocks_the_import(self):
        detection = importing.detect_columns(["Driver", "Careem"])
        self.assertEqual(detection["missing_required"], ["date"])

    def test_title_banner_above_the_header_is_skipped(self):
        upload = _upload(
            "Driver Income Statement\n"
            "December 2025\n"
            "\n"
            "Date,Driver,Vehicle,Careem\n"
            "2025-12-10,Zeeshan Ahmed,D586986,1000\n"
        )
        result = importing.analyze(upload)
        self.assertEqual(result["detection"]["missing_required"], [])
        self.assertEqual(result["summary"]["total_rows"], 1)


def _upload(body: str, name: str = "earnings.csv") -> SimpleUploadedFile:
    return SimpleUploadedFile(name, body.encode("utf-8"), content_type="text/csv")


class ImportFlowTests(TestCase):
    def setUp(self):
        self.driver, self.vehicle = _seed_minimal()

    def test_analyze_does_not_write(self):
        before = DailyEarning.objects.count()
        result = importing.analyze(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1000,500,300\n"
            )
        )
        self.assertEqual(DailyEarning.objects.count(), before)
        self.assertEqual(result["summary"]["valid_rows"], 1)
        self.assertTrue(result["can_commit"])

    def test_commit_creates_rows(self):
        importing.commit(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash,Fuel\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1000,500,300,90\n"
            )
        )
        row = DailyEarning.objects.get(date=date(2025, 12, 10))
        self.assertEqual(row.total_income, Decimal("1800.00"))
        self.assertTrue(
            Expense.objects.filter(date=date(2025, 12, 10), category="fuel").exists()
        )

    def test_unknown_driver_is_reported_not_guessed(self):
        result = importing.analyze(
            _upload("Date,Driver,Vehicle,Careem\n2025-12-10,Someone Unknown,D586986,1000\n")
        )
        self.assertEqual(result["summary"]["invalid_rows"], 1)
        self.assertTrue(any(i["level"] == "error" for i in result["issues"]))

    def test_spreadsheet_total_is_recalculated_not_trusted(self):
        """A wrong TOTAL column is a warning; the recalculated figure wins."""
        result = importing.analyze(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash,Total\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1000,500,300,9999\n"
            )
        )
        self.assertEqual(result["summary"]["valid_rows"], 1)
        row = result["preview"][0]
        self.assertEqual(row["computed_total"], Decimal("1800.00"))
        self.assertEqual(row["file_total"], Decimal("9999"))
        self.assertTrue(row["warnings"], "a mismatching file total should warn")

    def test_matching_total_produces_no_warning(self):
        result = importing.analyze(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash,Total\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1000,500,300,1800\n"
            )
        )
        self.assertEqual(result["preview"][0]["warnings"], [])

    def test_existing_day_is_an_update_not_a_duplicate(self):
        result = importing.analyze(
            _upload("Date,Driver,Vehicle,Careem\n2025-12-01,Zeeshan Ahmed,D586986,1000\n")
        )
        self.assertEqual(result["summary"]["rows_to_update"], 1)
        self.assertEqual(result["summary"]["rows_to_create"], 0)

    def test_duplicate_rows_inside_one_file_are_caught(self):
        result = importing.analyze(
            _upload(
                "Date,Driver,Vehicle,Careem\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1000\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1200\n"
            )
        )
        self.assertGreaterEqual(result["summary"]["error_count"], 1)

    def test_invalid_rows_are_skipped_and_valid_ones_still_land(self):
        batch = importing.commit(
            _upload(
                "Date,Driver,Vehicle,Careem\n"
                "2025-12-11,Zeeshan Ahmed,D586986,1000\n"
                "not-a-date,Zeeshan Ahmed,D586986,1000\n"
            ),
            skip_invalid=True,
        )
        self.assertEqual(batch["created"], 1)
        self.assertEqual(batch["failed"], 1)
        self.assertTrue(DailyEarning.objects.filter(date=date(2025, 12, 11)).exists())

    def test_strict_mode_imports_nothing_when_a_row_fails(self):
        before = DailyEarning.objects.count()
        batch = importing.commit(
            _upload(
                "Date,Driver,Vehicle,Careem\n"
                "2025-12-11,Zeeshan Ahmed,D586986,1000\n"
                "not-a-date,Zeeshan Ahmed,D586986,1000\n"
            ),
            skip_invalid=False,
        )
        self.assertEqual(batch["status"], "failed")
        self.assertEqual(DailyEarning.objects.count(), before)

    # -- the daily workflow: one sheet, uploaded again every day ------------

    SHEET = (
        "Date,Driver,Vehicle,Careem,Uber,Cash,Fuel,Salik\n"
        "2025-12-10,Zeeshan Ahmed,D586986,1000,500,300,90,5\n"
    )

    def test_reuploading_the_same_sheet_changes_nothing(self):
        """The client uploads the same file twice. Totals must not move."""
        importing.commit(_upload(self.SHEET))
        earnings = DailyEarning.objects.count()
        expenses = Expense.objects.count()
        total = Expense.objects.aggregate(s=Sum("amount"))["s"]

        second = importing.commit(_upload(self.SHEET))

        self.assertEqual(second["created"], 0)
        self.assertEqual(second["updated"], 1)
        self.assertEqual(DailyEarning.objects.count(), earnings)
        self.assertEqual(Expense.objects.count(), expenses)
        self.assertEqual(Expense.objects.aggregate(s=Sum("amount"))["s"], total)

    def test_corrected_sheet_updates_the_existing_rows(self):
        importing.commit(_upload(self.SHEET))
        importing.commit(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash,Fuel,Salik\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1234.56,500,300,222.22,5\n"
            )
        )
        row = DailyEarning.objects.get(date=date(2025, 12, 10))
        self.assertEqual(row.careem, Decimal("1234.56"))
        fuel = Expense.objects.get(date=date(2025, 12, 10), category="fuel")
        self.assertEqual(fuel.amount, Decimal("222.22"))
        self.assertEqual(
            Expense.objects.filter(date=date(2025, 12, 10), category="fuel").count(), 1
        )

    def test_clearing_a_cell_removes_the_expense_it_created(self):
        """The sheet is the source of truth, so a cleared cost must disappear."""
        importing.commit(_upload(self.SHEET))
        self.assertTrue(
            Expense.objects.filter(date=date(2025, 12, 10), category="salik").exists()
        )
        importing.commit(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash,Fuel,Salik\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1000,500,300,90,\n"
            )
        )
        self.assertFalse(
            Expense.objects.filter(date=date(2025, 12, 10), category="salik").exists()
        )

    def test_manually_entered_expenses_survive_an_import(self):
        manual = Expense.objects.create(
            date=date(2025, 12, 10),
            driver=self.driver,
            vehicle=self.vehicle,
            category="other",
            amount=Decimal("99.99"),
            description="entered by hand",
        )
        importing.commit(_upload(self.SHEET))
        importing.commit(_upload(self.SHEET))
        manual.refresh_from_db()
        self.assertEqual(manual.amount, Decimal("99.99"))

    def test_a_sheet_without_expense_columns_erases_no_expenses(self):
        """Silence about expenses is not an instruction to delete them."""
        importing.commit(_upload(self.SHEET))
        before = Expense.objects.count()
        importing.commit(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash\n"
                "2025-12-10,Zeeshan Ahmed,D586986,1000,500,300\n"
            )
        )
        self.assertEqual(Expense.objects.count(), before)

    def test_empty_row_never_zeroes_out_an_existing_day(self):
        """A gap in the sheet must not wipe figures that are already recorded."""
        importing.commit(_upload(self.SHEET))
        before = DailyEarning.objects.get(date=date(2025, 12, 10))
        self.assertEqual(before.careem, Decimal("1000.00"))

        result = importing.commit(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash,Fuel,Salik\n"
                "2025-12-10,Zeeshan Ahmed,D586986,,,,,\n"
            )
        )
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(result["updated"], 0)

        after = DailyEarning.objects.get(date=date(2025, 12, 10))
        self.assertEqual(after.careem, Decimal("1000.00"))
        self.assertTrue(
            Expense.objects.filter(date=date(2025, 12, 10), category="fuel").exists(),
            "an empty row must not delete the expenses it created earlier",
        )

    def test_empty_row_on_a_new_date_is_flagged_as_skip_in_the_preview(self):
        result = importing.analyze(_upload(self.SHEET))
        self.assertEqual(result["preview"][0]["action"], "create")

        importing.commit(_upload(self.SHEET))
        result = importing.analyze(
            _upload(
                "Date,Driver,Vehicle,Careem,Uber,Cash,Fuel,Salik\n"
                "2025-12-10,Zeeshan Ahmed,D586986,,,,,\n"
            )
        )
        row = result["preview"][0]
        self.assertEqual(row["action"], "skip")
        self.assertEqual(result["summary"]["rows_to_skip"], 1)
        self.assertTrue(
            any(w["code"] == "empty_row_skipped" for w in row["warnings"]),
            "the operator should be told why the row was left alone",
        )

    def test_template_is_parseable_by_the_importer(self):
        result = importing.analyze(_upload(importing.template_csv(), "template.csv"))
        self.assertGreaterEqual(result["summary"]["total_rows"], 1)
        self.assertEqual(result["detection"]["missing_required"], [])


# ---------------------------------------------------------------------------
# HTTP surface
# ---------------------------------------------------------------------------


class ApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user("tester", password="pw-for-tests-only")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        _seed_minimal()

    # -- the scope bar: the table must describe the same window as the KPIs --

    def test_custom_start_and_end_narrow_the_earnings_list(self):
        response = self.client.get("/api/earnings/?start=2025-12-01&end=2025-12-01")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["date"], "2025-12-01")

    def test_custom_range_narrows_expenses_too(self):
        response = self.client.get("/api/expenses/?start=2025-12-02&end=2025-12-31")
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["category"], "salik")

    def test_named_range_filters_the_list_not_just_the_kpis(self):
        """A table under a 'Last 7 days' card must not show older rows."""
        recent = self.client.get("/api/earnings/?range=7d&reference=2025-12-02")
        self.assertEqual(recent.data["count"], 2)

        stale = self.client.get("/api/earnings/?range=7d&reference=2026-06-01")
        self.assertEqual(stale.data["count"], 0, "December rows are not in a June window")

    def test_year_filters_the_list(self):
        self.assertEqual(self.client.get("/api/earnings/?year=2025").data["count"], 2)
        self.assertEqual(self.client.get("/api/earnings/?year=2024").data["count"], 0)

    def test_range_all_applies_no_bounds(self):
        self.assertEqual(self.client.get("/api/earnings/?range=all").data["count"], 2)

    def test_named_range_filters_payroll_on_its_period(self):
        self.assertEqual(self.client.get("/api/payroll/?year=2025").data["count"], 1)
        self.assertEqual(self.client.get("/api/payroll/?year=2024").data["count"], 0)

    def test_list_and_summary_agree_on_the_same_custom_range(self):
        query = "start=2025-12-01&end=2025-12-01"
        rows = self.client.get(f"/api/earnings/?{query}").data["results"]
        summary = self.client.get(f"/api/earnings/summary/?{query}").data

        self.assertEqual(summary["scope"]["period"]["start"], "2025-12-01")
        self.assertEqual(summary["scope"]["period"]["end"], "2025-12-01")
        # The list and the summary have to agree on what income means, so the
        # cash-free column is what must match the cash-free total.
        listed = sum(Decimal(str(row["platform_income"])) for row in rows)
        self.assertEqual(listed, Decimal(str(summary["summary"]["gross_income"])))

    def test_list_and_summary_agree_with_cash_switched_on(self):
        query = "start=2025-12-01&end=2025-12-01&include_cash=true"
        rows = self.client.get(f"/api/earnings/?{query}").data["results"]
        summary = self.client.get(f"/api/earnings/summary/?{query}").data

        listed = sum(Decimal(str(row["total_income"])) for row in rows)
        self.assertEqual(listed, Decimal(str(summary["summary"]["gross_income"])))
        self.assertTrue(summary["summary"]["includes_cash"])

    def test_a_backwards_custom_range_is_rejected_with_a_reason(self):
        response = self.client.get("/api/earnings/summary/?start=2025-12-31&end=2025-12-01")
        self.assertEqual(response.status_code, 400)
        self.assertIn("start", response.data)

    def test_unauthenticated_requests_are_rejected(self):
        self.assertEqual(APIClient().get("/api/earnings/").status_code, 401)

    def test_health_is_public(self):
        self.assertEqual(APIClient().get("/api/health/").status_code, 200)

    def test_jwt_round_trip(self):
        response = APIClient().post(
            "/api/auth/token/",
            {"username": "tester", "password": "pw-for-tests-only"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        self.assertEqual(client.get("/api/auth/me/").status_code, 200)

    def test_meta_documents_every_calculation(self):
        data = self.client.get("/api/meta/").data
        self.assertEqual(data["currency"], "AED")
        for key in (
            "daily_income", "gross_income", "operating_expenses", "operating_profit",
            "operating_margin", "net_result", "average_daily_income", "settlement_balance",
        ):
            self.assertIn(key, data["calculations"])

    def test_crud_endpoints(self):
        for path in (
            "/api/drivers/", "/api/vehicles/", "/api/earnings/",
            "/api/expenses/", "/api/payroll/", "/api/imports/", "/api/audit-log/",
        ):
            self.assertEqual(self.client.get(path).status_code, 200, path)

    def test_every_report_renders(self):
        from apps.fleet.services import reports

        for key in reports.REPORTS:
            response = self.client.get(f"/api/reports/{key}/?month=2025-12")
            self.assertEqual(response.status_code, 200, key)
            self.assertIn("scope", response.data)

    def test_every_analytics_view_renders(self):
        from apps.fleet.views import AnalyticsView

        for key in list(AnalyticsView.HANDLERS) + list(AnalyticsView.ALIASES):
            response = self.client.get(f"/api/analytics/{key}/?month=2025-12")
            self.assertEqual(response.status_code, 200, key)

    def test_unknown_report_is_a_clean_404(self):
        response = self.client.get("/api/reports/does-not-exist/")
        self.assertEqual(response.status_code, 404)
        self.assertIn("detail", response.data)

    def test_csv_export_of_a_report(self):
        response = self.client.get("/api/reports/monthly-income/?month=2025-12&format=csv")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["Content-Type"].startswith("text/csv"))

    def test_csv_export_of_a_filtered_queryset(self):
        response = self.client.get("/api/earnings/export/?month=2025-12")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["Content-Type"].startswith("text/csv"))

    def test_writes_are_audited(self):
        from apps.fleet.models import AuditLog

        response = self.client.post(
            "/api/drivers/", {"name": "New Driver", "phone": "+971 50 000 0000"}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(AuditLog.objects.filter(model_name="Driver", action="create").exists())

    def test_duplicate_earning_day_is_rejected(self):
        payload = {
            "date": "2025-12-01",
            "driver": Driver.objects.get().pk,
            "vehicle": Vehicle.objects.get().pk,
            "careem": "100.00",
        }
        self.assertEqual(
            self.client.post("/api/earnings/", payload, format="json").status_code, 400
        )

    def test_negative_income_is_rejected(self):
        payload = {
            "date": "2025-12-20",
            "driver": Driver.objects.get().pk,
            "vehicle": Vehicle.objects.get().pk,
            "careem": "-100.00",
        }
        self.assertEqual(
            self.client.post("/api/earnings/", payload, format="json").status_code, 400
        )

    def test_filtering_by_month_and_driver(self):
        driver = Driver.objects.get()
        response = self.client.get(f"/api/earnings/?month=2025-12&driver={driver.pk}")
        self.assertEqual(response.data["count"], 2)
        self.assertEqual(self.client.get("/api/earnings/?month=2024-01").data["count"], 0)

    def test_import_analyze_endpoint_does_not_write(self):
        before = DailyEarning.objects.count()
        upload = _upload("Date,Driver,Vehicle,Careem\n2025-12-14,Zeeshan Ahmed,D586986,900\n")
        response = self.client.post("/api/imports/analyze/", {"file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(DailyEarning.objects.count(), before)

    def test_import_commit_endpoint_writes(self):
        upload = _upload("Date,Driver,Vehicle,Careem\n2025-12-15,Zeeshan Ahmed,D586986,900\n")
        response = self.client.post("/api/imports/commit/", {"file": upload}, format="multipart")
        self.assertIn(response.status_code, (200, 201))
        self.assertTrue(DailyEarning.objects.filter(date=date(2025, 12, 15)).exists())

    def test_import_template_download(self):
        response = self.client.get("/api/imports/template/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response["Content-Type"].startswith("text/csv"))

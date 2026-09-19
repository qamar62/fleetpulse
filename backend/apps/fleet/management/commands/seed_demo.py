"""Seed realistic demo data modelled on the reference December 2025 statement.

    python manage.py seed_demo               # Nov + Dec 2025, 4 drivers
    python manage.py seed_demo --months 6
    python manage.py seed_demo --reset       # wipe fleet data first

The generator is seeded with a fixed RNG seed, so the same command always
produces the same numbers — useful when screenshotting or writing tests.
"""

from __future__ import annotations

import calendar
import random
from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction

from apps.fleet.models import DailyEarning, Driver, Expense, PayrollSettlement, Vehicle

User = get_user_model()

# The reference statement: Zeeshan / BMW 7 Series / D586986, December 2025.
REFERENCE_END = date(2025, 12, 31)

DRIVER_SPECS = [
    # name, phone, vehicle make/model/plate/year, income scale, salary
    ("Zeeshan Ahmed", "+971 50 482 1902", ("BMW", "7 Series", "D586986", 2022), 1.00, "3500.00"),
    ("Omar Khalid", "+971 55 728 4301", ("Mercedes-Benz", "E-Class", "K19024", 2021), 0.86, "3200.00"),
    ("Sara Malik", "+971 52 119 8820", ("Audi", "A6", "M72810", 2023), 0.72, "3000.00"),
    ("Nadia Ali", "+971 56 330 7745", ("Toyota", "Camry", "A45127", 2022), 0.64, "2800.00"),
]

# Base daily income per platform for the reference driver, in AED.
PLATFORM_BASE = {
    "careem": 1180,
    "uber": 1010,
    "bolt": 620,
    "yango": 300,
    "cash": 1950,
}

# Weekday multipliers — Fri/Sat are the strong nights in the UAE.
WEEKDAY_FACTOR = {0: 0.92, 1: 0.95, 2: 0.98, 3: 1.04, 4: 1.18, 5: 1.14, 6: 0.90}

EXPENSE_PLAN = [
    # category, probability per day, (min, max) amount
    ("fuel", 0.90, (55, 130)),
    ("salik", 0.75, (12, 48)),
    ("uber_trips", 0.35, (20, 70)),
    ("car_wash", 0.22, (15, 35)),
    ("washing", 0.12, (20, 45)),
    ("service", 0.05, (180, 720)),
    ("other", 0.08, (25, 120)),
]

PAYMENT_METHODS = ["cash", "card", "transfer"]


class Command(BaseCommand):
    help = "Populate the database with realistic demo fleet data."

    def add_arguments(self, parser):
        parser.add_argument("--months", type=int, default=2,
                            help="How many months of history to generate (default 2).")
        parser.add_argument("--end", type=str, default=REFERENCE_END.isoformat(),
                            help="Last day to generate, ISO format (default 2025-12-31).")
        parser.add_argument("--reset", action="store_true",
                            help="Delete existing fleet data before seeding.")
        parser.add_argument("--seed", type=int, default=20251231,
                            help="RNG seed for reproducible output.")
        parser.add_argument("--superuser", action="store_true",
                            help="Create admin/admin12345 if no superuser exists.")

    @transaction.atomic
    def handle(self, *args, **options):
        rng = random.Random(options["seed"])
        end = date.fromisoformat(options["end"])
        months = max(1, options["months"])

        if options["reset"]:
            self.stdout.write("Clearing existing fleet data…")
            for model in (Expense, DailyEarning, PayrollSettlement, Vehicle, Driver):
                model.objects.all().delete()

        start = _months_back(end, months - 1).replace(day=1)
        self.stdout.write(f"Seeding {start} → {end}…")

        pairs = self._create_people(rng, start)
        earnings = self._create_earnings(rng, pairs, start, end)
        expenses = self._create_expenses(rng, pairs, start, end)
        settlements = self._create_payroll(pairs, start, end)

        if options["superuser"] and not User.objects.filter(is_superuser=True).exists():
            User.objects.create_superuser("admin", "admin@fleetpulse.local", "admin12345")
            self.stdout.write(self.style.WARNING(
                "Created superuser admin / admin12345 — change this password."
            ))

        self.stdout.write(self.style.SUCCESS(
            f"Done. {len(pairs)} drivers, {earnings} earning entries, "
            f"{expenses} expenses, {settlements} settlements."
        ))

    # ------------------------------------------------------------------

    def _create_people(self, rng, start):
        pairs = []
        for name, phone, (make, model, plate, year), scale, salary in DRIVER_SPECS:
            driver, _ = Driver.objects.get_or_create(
                name=name,
                defaults={
                    "phone": phone,
                    "email": f"{name.split()[0].lower()}@fleetpulse.local",
                    "license_number": f"DXB-{rng.randint(100000, 999999)}",
                    "status": Driver.Status.ACTIVE,
                    "joined_at": start - timedelta(days=rng.randint(60, 900)),
                },
            )
            vehicle, _ = Vehicle.objects.get_or_create(
                plate_number=plate,
                defaults={
                    "make": make,
                    "model": model,
                    "year": year,
                    "status": Vehicle.Status.ACTIVE,
                    "assigned_driver": driver,
                    "monthly_rent": Decimal("2500.00"),
                },
            )
            if vehicle.assigned_driver_id is None:
                vehicle.assigned_driver = driver
                vehicle.save(update_fields=["assigned_driver"])
            pairs.append((driver, vehicle, scale, Decimal(salary)))
        return pairs

    def _create_earnings(self, rng, pairs, start, end):
        created = 0
        for driver, vehicle, scale, _salary in pairs:
            day = start
            # A mild upward trend across the range, like a ramping month.
            total_days = (end - start).days or 1
            while day <= end:
                offset = (day - start).days
                if rng.random() < 0.06:  # genuine day off — leaves inactive days in the data
                    day += timedelta(days=1)
                    continue

                trend = 1 + (offset / total_days) * 0.22
                factor = WEEKDAY_FACTOR[day.weekday()] * trend * scale
                values = {}
                for platform, base in PLATFORM_BASE.items():
                    if rng.random() < _platform_skip_chance(platform):
                        values[platform] = Decimal("0.00")
                        continue
                    noise = rng.uniform(0.78, 1.24)
                    values[platform] = Decimal(round(base * factor * noise, 2)).quantize(
                        Decimal("0.01")
                    )

                DailyEarning.objects.update_or_create(
                    date=day, driver=driver, vehicle=vehicle, defaults=values
                )
                created += 1
                day += timedelta(days=1)
        return created

    def _create_expenses(self, rng, pairs, start, end):
        created = 0
        for driver, vehicle, scale, _salary in pairs:
            day = start
            while day <= end:
                for category, probability, (low, high) in EXPENSE_PLAN:
                    if rng.random() > probability * (0.7 + scale * 0.3):
                        continue
                    amount = Decimal(round(rng.uniform(low, high), 2)).quantize(Decimal("0.01"))
                    Expense.objects.get_or_create(
                        date=day,
                        driver=driver,
                        vehicle=vehicle,
                        category=category,
                        reference=f"seed-{day:%Y%m%d}-{category}",
                        defaults={
                            "amount": amount,
                            "payment_method": rng.choice(PAYMENT_METHODS),
                            "description": _expense_description(category),
                        },
                    )
                    created += 1
                day += timedelta(days=1)
        return created

    def _create_payroll(self, pairs, start, end):
        created = 0
        month = start.replace(day=1)
        while month <= end:
            for driver, _vehicle, scale, salary in pairs:
                advance = (salary * Decimal("0.18")).quantize(Decimal("0.01"))
                rent = Decimal("500.00")
                other = Decimal("120.00") if scale < 0.8 else Decimal("0.00")
                paid = (salary - advance - rent - other).quantize(Decimal("0.01"))
                # Leave the final month partly unpaid so balances are visible.
                if month.month == end.month and month.year == end.year:
                    paid = (paid * Decimal("0.60")).quantize(Decimal("0.01"))

                PayrollSettlement.objects.update_or_create(
                    driver=driver,
                    period=month,
                    defaults={
                        "salary": salary,
                        "advance": advance,
                        "other_deductions": other,
                        "rent": rent,
                        "paid_amount": paid,
                        "notes": f"{month:%B %Y} settlement.",
                    },
                )
                created += 1
            month = _next_month(month)
        return created


def _platform_skip_chance(platform: str) -> float:
    """Smaller platforms are genuinely idle on some days."""
    return {"careem": 0.03, "uber": 0.08, "bolt": 0.22, "yango": 0.34, "cash": 0.18}[platform]


def _expense_description(category: str) -> str:
    return {
        "fuel": "ENOC station top-up",
        "salik": "Salik toll gates",
        "uber_trips": "Uber trip commission",
        "washing": "Interior washing",
        "service": "Scheduled service and filters",
        "car_wash": "Exterior car wash",
        "other": "Miscellaneous operating cost",
    }[category]


def _next_month(value: date) -> date:
    return date(value.year + 1, 1, 1) if value.month == 12 else date(value.year, value.month + 1, 1)


def _months_back(value: date, months: int) -> date:
    year, month = value.year, value.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return date(year, month, day)

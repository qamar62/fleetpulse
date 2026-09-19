# Elite Driver Income & Fleet Analytics Dashboard

## Reference workbook findings

The uploaded workbook has one sheet (`Template`) and contains a monthly driver/vehicle statement. The actual transaction dates are December 2025, despite the filename saying January 2026.

Reference structure:
- Driver: Zeeshan
- Vehicle: BMW 7 Series
- Plate: D586986
- Daily income channels: Careem, Uber, Bolt, Yango, Cash
- Daily total income = Careem + Uber + Bolt + Yango + Cash
- Monthly operating expenses: Fuel, Salik, Uber Trips, Washing, Service, Car Wash
- Separate settlement figures include salary, advance, paid amount, rent, cash balance and balance.

Do not reproduce the spreadsheet literally. Turn it into a proper relational financial/fleet application.

---

# PART A — V0 FRONTEND PROMPT

Build the complete frontend of an **elite internal Driver Income, Fleet & Financial Analytics System**.

## Stack

Use:
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide icons
- Recharts
- Responsive desktop-first design
- Dark/light mode
- Mock data and a clean API service abstraction

Next.js is preferred because v0 is optimized for it, even though this is an internal application. Django will be the separate backend.

Do NOT build Django inside the frontend.

## Design

This must look like a premium enterprise finance/fleet SaaS product, not a generic admin template.

Use:
- sophisticated typography
- dark professional sidebar
- clean light content area
- excellent dark mode
- subtle borders/shadows
- restrained rounded corners
- high information density
- green/red only for positive/negative financial states
- polished tables
- excellent charts
- skeleton loading
- empty/error states
- toast notifications
- tooltips
- responsive layout
- subtle animations only

## Application navigation

Sidebar:
1. Dashboard
2. Daily Earnings
3. Drivers
4. Vehicles
5. Expenses
6. Payroll & Settlements
7. Reports
8. Analytics
9. Import / Export
10. Settings

Top bar:
- global date/month selector
- driver selector
- vehicle selector
- search
- notifications
- theme switcher
- user menu

Filters should persist where appropriate.

---

# Executive Dashboard

Make this the strongest screen.

### KPI cards
Show:
- Total Gross Income
- Total Expenses
- Operating Profit
- Driver Payroll
- Net Cash Balance
- Average Daily Income
- Best Earning Day
- Best Platform

Each card should show:
- exact/current value
- previous-period comparison when data exists
- percentage change when valid
- mini sparkline
- tooltip explaining the calculation

Never invent comparison percentages. If unavailable, say “No comparison data”.

### Insight engine

Add a prominent “Business Insights” panel generated from actual data.

Examples:
- highest-contributing platform
- highest earning day
- fuel as % of expenses
- cash as % of income
- expense-to-income ratio
- operating margin
- number of inactive/no-income days
- unusual expense concentration
- month-over-month change

These must be dynamically calculated, never hard-coded.

### Income chart

Large Daily Income Trend chart:
- total income
- optional platform breakdown
- exact hover values
- 7D / 30D / Month / Quarter / Year / Custom range

### Platform performance

Show Careem, Uber, Bolt, Yango, Cash with:
- total income
- percentage contribution
- active days
- average income/day

Use bar/donut visualization and drill-down.

### Expense analytics

Show:
- total expenses
- expense trend
- category breakdown
- expense per earning day
- expense/income %
- fuel/income %
- maintenance/income %
- highest expense category/day

Categories:
Fuel, Salik, Uber Trips, Washing, Service, Car Wash, Other.

### Profitability

Clearly visualize:

Gross Income
→ Operating Expenses
→ Operating Profit
→ Payroll/other deductions
→ Net Result

Show:
- operating margin
- net margin

Never label something “profit” unless the calculation is explicit.

---

# Daily Earnings

Create a professional table based on the spreadsheet, but much better.

Columns:
- Date
- Driver
- Vehicle
- Careem
- Uber
- Bolt
- Yango
- Cash
- Total Income
- Fuel
- Other Expenses
- Net Operating Result
- Status
- Actions

Total Income must be derived from platform fields.

Actions:
- add
- edit
- delete
- duplicate previous day
- details
- export
- import

Filters:
- date
- driver
- vehicle
- platform

---

# Drivers

Driver table:
- Driver
- Vehicle
- Gross Income
- Expenses
- Operating Profit
- Average/Day
- Active Days
- Margin

Include search, filtering, sorting, pagination.

Driver detail:
- profile
- assigned vehicle
- income history
- platform mix
- expenses
- payroll
- net result
- best/worst days
- monthly trend

Do not create arbitrary “performance scores” or ratings. Use factual metrics.

---

# Vehicles

Vehicle page:
- make/model
- plate
- assigned driver
- income
- fuel
- Salik
- maintenance
- total expenses
- operating profit
- income/day
- expense ratio
- historical performance
- utilization/performance charts

---

# Expenses

Expense ledger fields:
- Date
- Driver
- Vehicle
- Category
- Amount
- Payment Method
- Description
- Reference
- Notes

Categories:
- Fuel
- Salik
- Uber Trips
- Washing
- Service
- Car Wash
- Other

Show category trends and expense efficiency.

---

# Payroll & Settlements

Separate payroll from operating expenses.

Support:
- salary
- advance
- other deductions
- paid amount
- rent/deductions
- balance
- notes

Settlement logic:
Salary
- Advance
- Other deductions
- Paid amount
= Balance

Provide driver/month settlement view.

---

# Reports

Create a Reports Center with:
1. Monthly Income
2. Platform Performance
3. Driver Performance
4. Vehicle Performance
5. Expenses
6. Profitability
7. Payroll/Settlement
8. Daily Earnings
9. Cash Flow

Every report needs:
- date range
- driver filter
- vehicle filter
- platform filter where relevant
- KPI summary
- charts
- table
- CSV export
- print-friendly view

---

# Analytics

Create:
- Income Mix over time
- Day-of-week analysis
- Daily high/low/average distribution
- Expense-to-income trend
- driver/vehicle factual comparison
- monthly income/expense/profit trend
- cash vs platform income

---

# Import / Export

Build a polished Excel/CSV import wizard:

1. Upload
2. Detect columns
3. Preview
4. Validate
5. Show errors/warnings
6. Confirm
7. Result summary

Recognize columns such as:
Date, CAREEM, UBER, BOLT, YANGO, CASH, FUEL, TOTAL.

Do not treat spreadsheet TOTAL as authoritative if it can be recalculated.

Validate:
- missing dates
- invalid amounts
- duplicate records
- unknown driver
- unknown vehicle

---

# Mock data and API architecture

Create realistic mock data based on the reference workbook structure.

Entities:
- Driver
- Vehicle
- DailyEarning
- Expense
- PayrollSettlement

Create `lib/api/` service modules for:
- drivers
- vehicles
- earnings
- expenses
- payroll
- reports
- analytics
- imports

Initially use mock data. Make it easy to replace with Django REST API calls later using an environment-configured backend URL.

Financial calculations must ultimately be authoritative on Django; frontend calculations are display-only.

## Calculation definitions

Daily income:
`careem + uber + bolt + yango + cash`

Gross income:
sum of daily income.

Operating expenses:
sum of operational expenses.

Operating profit:
`gross income - operating expenses`

Operating margin:
`operating profit / gross income * 100`

Platform share:
`platform income / gross income * 100`

Average daily income:
`gross income / active earning days`

If gross income is zero, display N/A.

Use exact Decimal-compatible backend values; never rely on JavaScript floating-point arithmetic for authoritative money calculations.

## Final V0 instruction

Generate the actual complete working application in one generation. Do not merely describe it.

Prioritize:
Dashboard → Daily Earnings → Drivers → Vehicles → Expenses → Payroll → Reports → Analytics → Import/Export → Settings.

Make it feel like a premium financial/fleet management product.

---

# PART B — DJANGO MODELS.PY

Use Django + Django REST Framework. Create only `models.py` for now.

```python
from decimal import Decimal
from django.db import models
from django.core.validators import MinValueValidator


class TimeStampedModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class Driver(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"

    name = models.CharField(max_length=150)
    phone = models.CharField(max_length=30, blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    joined_at = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Vehicle(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        INACTIVE = "inactive", "Inactive"
        MAINTENANCE = "maintenance", "Maintenance"

    make = models.CharField(max_length=80)
    model = models.CharField(max_length=100)
    plate_number = models.CharField(max_length=30, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    assigned_driver = models.ForeignKey(
        Driver,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="vehicles",
    )

    class Meta:
        ordering = ["make", "model", "plate_number"]

    def __str__(self):
        return f"{self.make} {self.model} - {self.plate_number}"


class DailyEarning(TimeStampedModel):
    date = models.DateField()
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="daily_earnings")
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="daily_earnings")

    careem = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"),
                                 validators=[MinValueValidator(Decimal("0.00"))])
    uber = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"),
                               validators=[MinValueValidator(Decimal("0.00"))])
    bolt = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"),
                               validators=[MinValueValidator(Decimal("0.00"))])
    yango = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"),
                                validators=[MinValueValidator(Decimal("0.00"))])
    cash = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"),
                               validators=[MinValueValidator(Decimal("0.00"))])

    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["date", "driver", "vehicle"],
                name="unique_daily_driver_vehicle",
            )
        ]
        indexes = [
            models.Index(fields=["date"]),
            models.Index(fields=["driver", "date"]),
            models.Index(fields=["vehicle", "date"]),
        ]

    @property
    def total_income(self):
        return self.careem + self.uber + self.bolt + self.yango + self.cash

    def __str__(self):
        return f"{self.date} - {self.driver} - {self.vehicle}"


class Expense(TimeStampedModel):
    class Category(models.TextChoices):
        FUEL = "fuel", "Fuel"
        SALIK = "salik", "Salik"
        UBER_TRIPS = "uber_trips", "Uber Trips"
        WASHING = "washing", "Washing"
        SERVICE = "service", "Service"
        CAR_WASH = "car_wash", "Car Wash"
        OTHER = "other", "Other"

    class PaymentMethod(models.TextChoices):
        CASH = "cash", "Cash"
        CARD = "card", "Card"
        TRANSFER = "transfer", "Transfer"
        OTHER = "other", "Other"

    date = models.DateField()
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="expenses")
    vehicle = models.ForeignKey(Vehicle, on_delete=models.CASCADE, related_name="expenses")
    category = models.CharField(max_length=30, choices=Category.choices)
    amount = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.00"))],
    )
    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices, default=PaymentMethod.CASH)
    description = models.CharField(max_length=255, blank=True)
    reference = models.CharField(max_length=100, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-date", "-id"]
        indexes = [
            models.Index(fields=["date"]),
            models.Index(fields=["driver", "date"]),
            models.Index(fields=["vehicle", "date"]),
            models.Index(fields=["category", "date"]),
        ]

    def __str__(self):
        return f"{self.date} - {self.category} - {self.amount}"


class PayrollSettlement(TimeStampedModel):
    driver = models.ForeignKey(Driver, on_delete=models.CASCADE, related_name="payroll_settlements")
    # Store the first day of the settlement month.
    period = models.DateField()

    salary = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    advance = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    other_deductions = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    paid_amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0.00"))
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-period", "driver"]
        constraints = [
            models.UniqueConstraint(
                fields=["driver", "period"],
                name="unique_driver_payroll_period",
            )
        ]
        indexes = [
            models.Index(fields=["period"]),
            models.Index(fields=["driver", "period"]),
        ]

    @property
    def balance(self):
        return self.salary - self.advance - self.other_deductions - self.paid_amount

    def __str__(self):
        return f"{self.driver} - {self.period:%Y-%m}"


class ImportBatch(TimeStampedModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        COMPLETED = "completed", "Completed"
        FAILED = "failed", "Failed"
        PARTIAL = "partial", "Partial"

    filename = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    total_rows = models.PositiveIntegerField(default=0)
    imported_rows = models.PositiveIntegerField(default=0)
    failed_rows = models.PositiveIntegerField(default=0)
    error_message = models.TextField(blank=True)

    def __str__(self):
        return f"{self.filename} - {self.status}"
```

## Backend principles

Do not store every dashboard KPI as a database field. Calculate totals with Django ORM aggregation/query services.

Authoritative calculations should be server-side.

Recommended API groups:
- `/api/drivers/`
- `/api/vehicles/`
- `/api/earnings/`
- `/api/expenses/`
- `/api/payroll/`
- `/api/reports/`
- `/api/analytics/`
- `/api/imports/`

Later add authentication, permissions, pagination, filtering, search, ordering, audit logging and robust Excel/CSV validation.

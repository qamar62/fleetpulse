# FleetPulse — Django backend

The API behind the FleetPulse driver-income dashboard. Django 5.1 + Django REST
Framework, JWT auth, SQLite by default and Postgres-ready through a single
environment variable.

`driver_dashboard_v0_django_prompt.md` supplied only `models.py`. Everything
else here — serializers, filters, aggregation, reports, analytics, the insight
engine, the import wizard, CSV export, the audit trail, admin and seed data —
was built to satisfy the behaviour Part A of that spec describes.


## Running it

```bash
cd backend
python -m venv .venv && .venv\Scripts\activate      # Windows
# python3 -m venv .venv && source .venv/bin/activate  # macOS / Linux

pip install -r requirements.txt
copy .env.example .env                               # cp on macOS / Linux

python manage.py migrate
python manage.py seed_demo --months 2 --end 2025-12-31 --superuser
python manage.py runserver
```

That gives you `http://127.0.0.1:8000/api/`, the Django admin at `/admin/`, a
superuser of `admin` / `admin12345` (change it) and two months of realistic
December-2025 data across four drivers.

The frontend expects the API on port 8000; `CORS_ALLOWED_ORIGINS` in `.env`
already allows `localhost:3000`.

### Switching to Postgres

One line in `.env`, nothing else:

```
DATABASE_URL=postgres://user:password@localhost:5432/fleetpulse
```

### Seed data

`seed_demo` is deterministic — the same flags always produce the same numbers,
which makes screenshots and tests stable.

```bash
python manage.py seed_demo --months 6 --end 2025-12-31 --reset
```

It models the reference statement (Zeeshan Ahmed, BMW 7 Series, plate D586986),
including days off, idle platforms and a partly-unpaid final month, so empty
states and outstanding balances are actually visible in the UI.


## Authentication

JWT via SimpleJWT. Access tokens last 60 minutes, refresh tokens 7 days, and
refresh tokens rotate on use.

```
POST /api/auth/token/          {"username", "password"} -> {"access", "refresh"}
POST /api/auth/token/refresh/  {"refresh"}              -> {"access"}
POST /api/auth/token/verify/   {"token"}
GET  /api/auth/me/
```

Send `Authorization: Bearer <access>` on everything except `/api/health/`.


## The API

### Records

`drivers`, `vehicles`, `earnings`, `expenses`, `payroll` are full CRUD
viewsets. All of them support search (`?search=`), ordering (`?ordering=-date`),
pagination (`?page=2&page_size=100`) and `GET /export/` for CSV of the current
filtered queryset.

Common filters: `?month=2025-12`, `?start=&end=`, `?driver=`, `?vehicle=`,
`?range=7d|30d|90d|month|quarter|year|all`.

Extra actions:

| Endpoint | What it gives you |
| --- | --- |
| `GET /api/drivers/performance/` | Leaderboard of every driver for the period |
| `GET /api/drivers/<id>/summary/` | One driver's financials, series and insights |
| `GET /api/vehicles/performance/` | Same, per vehicle, including fuel and Salik |
| `GET /api/vehicles/<id>/summary/` | One vehicle's running costs against income |
| `GET /api/earnings/summary/` | Financial summary for the scope |
| `POST /api/earnings/duplicate-day/` | Copy one day's figures onto other dates |
| `GET /api/payroll/summary/` | Settlement totals and outstanding balances |

### Reports — `/api/reports/<key>/`

`monthly-income`, `platform-performance`, `driver-performance`,
`vehicle-performance`, `expenses`, `profitability`, `payroll`,
`daily-earnings`, `cash-flow`.

`GET /api/reports/` lists the catalogue. Every report returns the same envelope
(`key`, `title`, `description`, `scope`, `columns`, `rows`, `totals`, `notes`)
which is what makes the generic CSV renderer possible: append `?format=csv` (or
`?export=csv`) to any report to download it.

### Analytics — `/api/analytics/<key>/`

`dashboard`, `profitability`, `income-mix`, `day-of-week`, `distribution`,
`expense-to-income`, `comparison`, `monthly-trend`, `cash-vs-platform`,
`platform-performance`. Friendlier aliases (`overview`, `waterfall`,
`daily-distribution`, `expense-trend`, `platforms`) resolve to the same views.

`dashboard` is the one the main page needs: KPIs with period-over-period
comparison, the daily series, platform split, expense breakdown, the
profitability waterfall and the insights, in a single round trip.

`GET /api/analytics/insights/` returns the insights on their own.

### Meta

`GET /api/meta/` returns the platforms, expense categories, statuses, date
ranges, report catalogue — and a `calculations` block that states every formula
the API uses, so the frontend never has to guess or re-derive one.

`GET /api/health/` is public and checks the database connection.


## How the numbers are calculated

Every figure is computed server-side in `Decimal` with `ROUND_HALF_UP` to two
places. The frontend should format what it receives and never recompute it.

```
daily income        = careem + uber + bolt + yango + cash
gross income        = sum of daily income over the period
operating expenses  = sum of the expense ledger (payroll is NOT included)
operating profit    = gross income - operating expenses
operating margin %  = operating profit / gross income * 100
net result          = operating profit - driver payroll
average daily income= gross income / active earning days
settlement balance  = salary - advance - other deductions - rent - paid amount
```

`total_income` on `DailyEarning` and `balance` on `PayrollSettlement` are
database-generated columns (`models.GeneratedField(db_persist=True)`), so they
cannot drift from their inputs no matter how a row is written — admin, API,
import or raw SQL.

### Where the API says "I don't know"

The spec is explicit that the dashboard must not invent figures, so:

* any ratio with a zero denominator returns `null`, never `0` — render "N/A";
* a period with no prior data returns `change_pct: null` and
  `has_comparison: false` — render "No comparison data", not "0%";
* an empty period returns a single `no_data` insight rather than filler;
* there are no composite "performance scores" anywhere — `comparison` returns
  factual totals and lets the reader rank them;
* a `TOTAL` column in an imported spreadsheet is recalculated from its parts. A
  mismatch is surfaced as a warning on that row; the recalculated figure is
  what gets stored.

Insights carry a `tone` (`positive`, `neutral`, `warning`, `critical`) and a
`priority`, and each one ships the `metrics` it was derived from so a number on
screen can always be traced back.


## Import wizard

Two phases, so nothing is written until the user has seen what will happen.

```
GET  /api/imports/template/   CSV template with the expected headers
POST /api/imports/analyze/    multipart "file" -> detection, preview, issues
POST /api/imports/commit/     multipart "file" -> writes, returns a batch record
GET  /api/imports/            history; GET /api/imports/<id>/ for row-level issues
```

`analyze` performs no writes at all. `commit` runs inside a transaction.

The parser handles `.csv`, `.xlsx` and `.xlsm`; title banners above the real
header row; case- and punctuation-insensitive column names ("Plate No.",
"Driver Name", "Petrol", "Toll"); eleven date formats plus Excel serial dates;
and amounts written as `1,234.56`, `1.234,56`, `AED 900` or `(250.00)`.

Rows are validated individually — unknown driver or vehicle, missing or
unparseable date, negative income, duplicates inside the file and duplicates
against existing records. `skip_invalid=true` (the default) imports the good
rows and records the rest as issues; `skip_invalid=false` imports nothing if any
row fails. A cell containing text that isn't a number is reported rather than
quietly treated as zero.


## Audit trail

Every create, update and delete through the API writes an `AuditLog` row with
the actor, the model, a label for the object and a before/after diff. Imports
are logged as a single `import` action. Read it at `/api/audit-log/`; it is
read-only everywhere, including admin.


## Where the spec was extended

* **`rent` on `PayrollSettlement`.** Part A of the spec shows rent as a
  settlement line, but the `models.py` in Part B omits the field. The field was
  added and the balance formula is
  `salary - advance - other_deductions - rent - paid_amount`. The serializer
  exposes the formula as a `formula` string on every settlement so the UI can
  show the working rather than restate it.
* `Driver`: `email`, `license_number`, `notes`, and an `on_leave` status.
* `Vehicle`: `year`, `monthly_rent`, `notes`.
* `ImportRowIssue` and `AuditLog` are new models; `ImportBatch` gained
  `updated_rows`, `skipped_rows`, `column_mapping` and `created_by`.
* `source_batch` foreign keys on earnings and expenses, so an import can be
  traced or reversed.

Everything the spec did define — the five income platforms, the expense
categories, `unique_daily_driver_vehicle`, `unique_driver_payroll_period` and
the indexes — is kept as written.


## Tests

```bash
python manage.py test apps.fleet
```

64 tests covering the money primitives, the generated columns, the summary
arithmetic, the honesty rules above, period resolution, the import parser and
every HTTP endpoint. The summary figures are also cross-checked against a
row-by-row recomputation that bypasses the ORM's aggregation entirely.


## Layout

```
backend/
  config/            settings, root urls, wsgi/asgi
  apps/fleet/
    models.py        the domain, with DB-generated derived columns
    serializers.py   including cross-field validation
    filters.py       query-string filtering for every list endpoint
    views.py         viewsets, reports, analytics, imports, meta
    audit.py         the mixin that records every write
    admin.py         all models, with inlines and read-only audit
    services/
      money.py       Decimal helpers; None instead of a fake zero
      periods.py     period parsing and honest previous-period logic
      aggregation.py the single source of truth for every total
      insights.py    the insight engine
      analytics.py   chart-shaped views over aggregation
      reports.py     the nine reports
      importing.py   the two-phase import wizard
      exporting.py   CSV rendering
    management/commands/seed_demo.py
    tests.py
```

"""Decimal helpers.

Every monetary figure the API returns passes through ``quantize`` so the
frontend never has to do authoritative arithmetic. Ratios return ``None`` rather
than zero when the denominator is zero, so the UI can honestly render "N/A"
instead of a misleading 0%.
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP

ZERO = Decimal("0.00")
CENTS = Decimal("0.01")
PERCENT = Decimal("0.01")


def D(value) -> Decimal:
    """Coerce anything sane into a Decimal, defaulting to zero."""
    if value is None:
        return ZERO
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    return Decimal(value)


def quantize(value, exp: Decimal = CENTS) -> Decimal:
    return D(value).quantize(exp, rounding=ROUND_HALF_UP)


def safe_div(numerator, denominator) -> Decimal | None:
    """Divide, or return None when the denominator is zero/missing."""
    denom = D(denominator)
    if denom == 0:
        return None
    return D(numerator) / denom


def ratio(numerator, denominator) -> Decimal | None:
    result = safe_div(numerator, denominator)
    return None if result is None else quantize(result, Decimal("0.0001"))


def pct(numerator, denominator) -> Decimal | None:
    """Percentage of numerator over denominator, or None when undefined."""
    result = safe_div(numerator, denominator)
    return None if result is None else quantize(result * 100, PERCENT)


def change_pct(current, previous) -> Decimal | None:
    """Period-over-period change. None when there is no comparable base."""
    prev = D(previous)
    if prev == 0:
        return None
    return quantize((D(current) - prev) / abs(prev) * 100, PERCENT)

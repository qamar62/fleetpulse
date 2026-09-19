from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
    TokenVerifyView,
)

from . import views

router = DefaultRouter()
router.register("drivers", views.DriverViewSet, basename="driver")
router.register("vehicles", views.VehicleViewSet, basename="vehicle")
router.register("earnings", views.DailyEarningViewSet, basename="earning")
router.register("expenses", views.ExpenseViewSet, basename="expense")
router.register("payroll", views.PayrollSettlementViewSet, basename="payroll")
router.register("imports", views.ImportBatchViewSet, basename="import")
router.register("audit-log", views.AuditLogViewSet, basename="audit-log")

urlpatterns = [
    # Auth
    path("auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("auth/token/verify/", TokenVerifyView.as_view(), name="token_verify"),
    path("auth/me/", views.me, name="auth-me"),
    # Meta
    path("health/", views.health, name="health"),
    path("meta/", views.meta, name="meta"),
    # Reports
    path("reports/", views.ReportView.as_view(), name="report-list"),
    path("reports/<slug:key>/", views.ReportView.as_view(), name="report-detail"),
    # Analytics
    path("analytics/", views.AnalyticsView.as_view(), name="analytics-list"),
    path("analytics/insights/", views.InsightsView.as_view(), name="analytics-insights"),
    path("analytics/<slug:key>/", views.AnalyticsView.as_view(), name="analytics-detail"),
    # CRUD
    path("", include(router.urls)),
]

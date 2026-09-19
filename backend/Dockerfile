# syntax=docker/dockerfile:1
#
# FleetPulse API. One stage: the dependency list is small and there is nothing
# to compile, so a builder stage would add complexity without shrinking much.

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Requirements first so a code change does not reinstall Django every build.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Collect static into the image rather than on boot. WhiteNoise's manifest
# storage needs staticfiles.json to exist before the first request serves a
# hashed URL, and baking it in keeps start-up down to a migration.
# The values below are only used by this one command - the real ones arrive
# from the environment at run time.
RUN DJANGO_SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(64))')" \
    DJANGO_DEBUG=False \
    DATABASE_URL=sqlite:////tmp/build.sqlite3 \
    python manage.py collectstatic --noinput --clear \
    && rm -f /tmp/build.sqlite3

# The database lives on a volume mounted here. Creating the directory now, with
# the right owner, means Docker seeds a fresh named volume with that ownership
# instead of handing us a root-owned one the app cannot write to.
# /app stays root-owned and read-only to the app: nothing is written there.
RUN useradd --create-home --uid 10001 fleetpulse \
    && mkdir -p /data \
    && chown fleetpulse:fleetpulse /data

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER fleetpulse
EXPOSE 8000

ENTRYPOINT ["docker-entrypoint.sh"]

# Two workers, four threads each. SQLite serialises writes, so more processes
# would only mean more of them queueing on the same file; threads soak up the
# read-heavy dashboard traffic for far less memory.
CMD ["gunicorn", "config.wsgi:application", \
     "--bind", "0.0.0.0:8000", \
     "--workers", "2", \
     "--threads", "4", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]

#!/bin/sh
# Migrations run on every boot, not at build time: the database is on a volume
# that does not exist yet when the image is built. `migrate` is a no-op once
# everything is applied, so this stays cheap on restarts.
set -e

echo "==> Applying migrations"
python manage.py migrate --noinput

exec "$@"

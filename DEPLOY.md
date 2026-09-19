# Deploying FleetPulse on Proxmox

One host, three containers, one published port. Cloudflare terminates TLS at the
edge and the tunnel delivers plain HTTP to nginx, so there is no certificate to
manage here and nothing to renew.

```
browser ──https──> Cloudflare ──tunnel──> nginx :8090 ─┬─> Django  (/api, /admin, /static)
                                                       └─> Next.js (everything else)
```

Both halves answer on the same origin, `https://fp.qaam.work`. The dashboard
calls `/api` relative to the page it was loaded from, which is why the frontend
image contains no hostname and why there is no CORS to configure.

## First run

```bash
cd /opt/fleet-pulse                       # wherever you cloned it
cp .env.example .env
python3 -c "import secrets; print(secrets.token_urlsafe(64))"   # paste into DJANGO_SECRET_KEY
docker compose up -d --build --wait     # --wait blocks until all three are healthy
docker compose exec backend python manage.py createsuperuser
```

Check it before wiring the tunnel:

```bash
curl -s http://127.0.0.1:8090/api/health/      # {"status":"ok",...}
```

## The tunnel

In the Cloudflare dashboard, add a public hostname to the tunnel you already
run:

| Field | Value |
| --- | --- |
| Subdomain | `fp` |
| Domain | `qaam.work` |
| Service | `HTTP` → `<proxmox-host>:8090` |

Or in `config.yml` if you drive the tunnel from a file:

```yaml
ingress:
  - hostname: fp.qaam.work
    service: http://<proxmox-host>:8090
```

Once that is live, set `DJANGO_SECURE_COOKIES=True` in `.env` and
`docker compose up -d backend`. Leave it off until then: a secure cookie is
never sent over plain http, and an admin login that silently returns you to the
login page is the only symptom you get.

If cloudflared runs on this same host, tighten the published port so nothing on
the LAN can reach it:

```yaml
    ports:
      - "127.0.0.1:8090:80"
```

## Where the data lives

Everything - drivers, earnings, expenses, users - is one SQLite file on the
`fleetpulse_fleetpulse-data` volume, mounted at `/data` inside the backend. It
is deliberately not in the image, so `--build` never touches a record.

Back it up with SQLite's own backup command rather than copying the file, which
can catch a write mid-flight:

```bash
docker compose exec backend python -c "
import sqlite3; s=sqlite3.connect('/data/db.sqlite3'); d=sqlite3.connect('/data/backup.sqlite3')
s.backup(d); d.close(); s.close()"
docker compose cp backend:/data/backup.sqlite3 ./fleetpulse-$(date +%F).sqlite3
```

SQLite runs in WAL mode with a 20-second busy timeout, which is what lets the
two gunicorn workers read and write the same file without tripping over each
other. It is sized for a fleet, not for a crowd - if this ever grows past a few
concurrent writers, `DATABASE_URL` is the single line that moves it to Postgres.

## Day to day

```bash
docker compose logs -f backend          # or frontend, nginx
docker compose up -d --build --wait     # deploy a change
docker compose exec backend python manage.py migrate
docker compose restart backend
```

Migrations also run automatically on every backend start, so a plain
`up -d --build` is usually all a release needs.

## Notes

- `DJANGO_ALLOWED_HOSTS` must list `fp.qaam.work`, or Django answers 400 to
  every request through the tunnel.
- `CSRF_TRUSTED_ORIGINS` must list `https://fp.qaam.work`, or the admin login
  form posts and gets a 403.
- nginx trusts `CF-Connecting-IP` from loopback and the private ranges, which
  covers cloudflared whether it runs on this host or another box. The real
  boundary is the published port: if anything other than the tunnel can reach
  it, a caller can forge that header and the access log will believe it.
- Uploads are capped twice: 25 MB at nginx, 10 MB at Django
  (`MAX_IMPORT_FILE_BYTES`). The gap is deliberate - an oversized file reaches
  Django and comes back with a readable message instead of a bare 413.
- There is no `/media` route because nothing in the app stores uploaded files;
  spreadsheets are parsed in memory and discarded. Add a volume and a location
  block if that ever changes.

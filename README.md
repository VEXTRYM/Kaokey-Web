# Kaokey Community

A public catalog where people **share and discover** kaomoji and lists for [Kaokey Desktop](https://github.com/VEXTRYM/Kaokey). This is **not** a cloud backup or sync service.

## MVP features

- Public search (title, text, tags) and paginated catalog without an account
- Built-in Default list with 353 kaomoji seeded as 354 public publications on first API startup
- Local username/password registration and sign-in
- Publish individual kaomoji or one full Kaokey list
- Download any publication as a Kaokey Desktop-compatible JSON list (accepts `favorite` / `favorite_order` from desktop JSON, strips personal favorite state before publishing)
- Copy individual kaomoji, delete your own publications
- Browser UI in Russian; REST API with OpenAPI documentation

## Quick start

Requirements: Docker and Docker Compose.

```sh
docker compose up --build
```

- Website: http://localhost:5173
- API docs: http://localhost:8000/docs
- Health: http://localhost:8000/api/v1/health

On first startup, the API seeds **353 individual kaomoji and the Default list** from `backend/app/data/kaolist.json`, under the reserved `@Kaokey-Defaults` author. Later restarts skip already-seeded content and do not change user publications. Set `SEED_DEFAULT_CATALOG=false` on the API service to disable seeding.

The frontend's development server proxies `/api` to the backend container. To run the frontend directly on your machine, set `VITE_API_PROXY_TARGET=http://localhost:8000` before `npm run dev`.

## Windows: workaround for Docker Compose Bake failures

If `docker compose up --build` errors with `failed to execute bake`, build separately:

```powershell
git pull
docker build -t kaokey-web-api .\backend
docker build -t kaokey-web-web .\frontend
docker compose up --no-build --force-recreate
```

PostgreSQL data is preserved in the named Docker volume.

## Development

```sh
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
DATABASE_URL=sqlite:///./dev.db uvicorn app.main:app --reload
pytest -q
```

```sh
cd frontend
npm install
VITE_API_PROXY_TARGET=http://localhost:8000 npm run dev
npm run build
```

## API

- `POST /api/v1/auth/register`: sign up
- `POST /api/v1/auth/login`: login and receive HttpOnly session cookie + CSRF token
- `GET /api/v1/auth/me`: restore account + CSRF token
- `POST /api/v1/auth/logout`: revoke session
- `GET /api/v1/publications?q=&kind=&limit=&offset=`: browse
- `GET /api/v1/publications/{id}`: publication details
- `POST /api/v1/publications`: publish a single kaomoji or full library export containing one list
- `DELETE /api/v1/publications/{id}`: delete own publication
- `GET /api/v1/publications/{id}/export`: download compatible JSON

Authenticated writes require an `X-CSRF-Token` header, provided by login / me. Public endpoints work anonymously. The list payload must contain `format_version: 1`, `active_list` and exactly one item in `lists`. Single kaomoji exports are wrapped as one-item lists for desktop compatibility. `favorite` state is never published in a single-item export.

## Architecture

- `backend/`: FastAPI, SQLAlchemy, PostgreSQL; local SQLite fallback for development and tests.
- `frontend/`: React, TypeScript, Vite.
- `docker-compose.yml`: local API, frontend and PostgreSQL.

## Not yet included

- One-click import via `kaokey://` (requires changes in the desktop application)
- Moderation, abuse reporting, account recovery and production rate limiting
- Cloud synchronization or private library storage
- Database migrations (add Alembic before production schema evolution)
- Production deployment / HTTPS / hardened reverse proxy

**Do not expose this development stack publicly as-is.** Set `COOKIE_SECURE=true` behind HTTPS, configure trusted origins, use strong database credentials, add abuse prevention and database backups before launch.

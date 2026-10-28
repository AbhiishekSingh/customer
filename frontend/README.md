# ABG Customer Follow-Up — Frontend

React + Vite production frontend for the ABG Customer Follow-Up Digitization system. Wired to the FastAPI backend (`abg-backend`) over its REST API.

## Stack

- React 19 + react-router-dom v7
- Plain CSS (`src/index.css`), no CSS framework
- Fetch-based API client with JWT access/refresh handling (`src/api/client.js`)
- Vite 8, dev proxy `/api` → backend on `:8000`

## Setup

```bash
npm install
npm run dev       # dev server at http://localhost:5173, proxies /api to http://localhost:8000
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

The backend must be running on `http://localhost:8000` for the dev proxy to work (see `vite.config.js` to change the target, e.g. for a deployed backend URL). In production, either:
- serve `dist/` behind the same origin/reverse-proxy as the backend (so `/api/*` requests reach it), or
- set `VITE_API_BASE` and adjust `src/api/client.js`'s `BASE` constant to point at the backend's absolute URL.

## Structure

- `src/api/` — fetch client (`client.js`) with silent token-refresh-and-retry on 401, and a small `useApi` data-fetching hook.
- `src/context/` — `AuthContext` (login/logout/current user) and `ToastContext` (toast notifications).
- `src/components/` — `Shell` (sidebar nav + top bar, role-gated), `DataTable` (search/sort/paginate/CSV export), `ui.jsx` (shared primitives: Pill, Modal, Field, Panel, etc).
- `src/lib/domain.js` — business-logic constants/helpers ported from the backend (blacklist rule text, mail-state derivation, season logic) so list/detail pages can render correctly without extra API round-trips.
- `src/pages/` — one file per screen, matching the signed-off HTML prototype's screens and the backend's data model (Visit → VisitContact → Mail).
- `src/pages/portal/PortalPage.jsx` — the public, unauthenticated customer response page at `/portal/:token` (no login, no Shell).

## Roles

Four roles mirror the backend's permission model: `design`, `manager`, `admin`, `top`. The sidebar nav and several actions are gated per-role to match the backend's actual authorization (`require_manager_up`, `require_admin`), not just the prototype's original (looser) gating.

## Notes on scope

- A handful of list pages (`Dashboard`, `Visits`, `Register`) compute reply-rate/stage client-side by fetching each visit's mails in parallel, since the backend doesn't expose a flattened aggregate endpoint for non-manager roles. Fine at demo/pilot scale; would want a dedicated aggregate endpoint if data volume grows significantly.
- `Register.jsx` is a single flat table rather than the prototype's three tabbed sub-views (by sort no. / by team / by person) — same underlying data, reduced view scope.
- CSV export is supported from any `DataTable`; the prototype's richer modal filter-builder and XLSX export were dropped as out of scope.

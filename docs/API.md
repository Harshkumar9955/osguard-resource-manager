# API reference

All routes use the local API origin `http://localhost:4000/api`. Successful JSON responses use `{ "success": true, "data": ... }`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/health` | Health, version, uptime |
| GET | `/monitoring/current` | Latest normalized host snapshot |
| GET | `/monitoring/history?limit=120` | Recent chart samples; limit 1–600 |
| GET | `/monitoring/processes?limit=150&q=chrome` | Read-only process list and optional search |
| GET | `/alerts` | Alert records for the current API session |
| PATCH | `/alerts/:id` | Set status to `open`, `acknowledged`, or `resolved` |
| GET | `/settings` | Current thresholds |
| PATCH | `/settings` | Update supported percentage thresholds |
| GET | `/reports/metrics.csv` | Download metric samples |
| GET | `/reports/alerts.csv` | Download alert records |

The API uses HTTP 400 for invalid settings/status, 404 for unknown API routes or alert IDs, and 500 for unexpected server failures. Unsupported metrics are represented as `null` rather than guessed values.

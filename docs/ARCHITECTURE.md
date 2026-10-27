# OSGuard architecture

## Runtime flow

1. The Node.js API calls `systeminformation` on a bounded interval.
2. It normalizes CPU, memory, filesystem, network, disk-operation, OS, and process readings.
3. Counter rates are calculated only when current and previous samples are valid.
4. Measurements are appended to a bounded in-memory chart history and persisted to local SQLite.
5. Deterministic threshold rules create/update alerts and mark cleared conditions resolved.
6. React polls the API, renders current readings and trends, and lets an operator acknowledge/resolve alerts or edit thresholds.

## Components

- `client/src/app.jsx`: dashboard, process explorer, charts, alerts, reports, settings.
- `client/src/style.css`: responsive interface styling.
- `server/src/server.js`: API routes, monitoring loop, diagnosis, CSV export.
- `server/src/metrics.js`: tested helpers for counter deltas and safe percentages.
- `server/src/database.js`: SQLite schema and connection.

## Safety boundary

OSGuard is read-only with respect to real host processes. It does not kill processes, change scheduling priorities, or run shell commands based on an alert. Recommendations are shown for a human operator to review.

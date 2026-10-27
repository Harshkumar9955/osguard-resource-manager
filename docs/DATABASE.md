# Local database

OSGuard uses Node.js `node:sqlite` through `DatabaseSync`, avoiding native npm addons such as `better-sqlite3` that require local C++ compilation on some Windows setups.

The database is created at `server/data/uhrms-os.db` by default, or at the path supplied by `DATABASE_PATH`.

Tables:

- `schema_migrations`: schema version marker.
- `metric_samples`: timestamped JSON snapshots. The collector retains at most 10,000 rows.
- `alerts`: alert records and current status.
- `app_settings`: serialized alert thresholds.

The frontend chart history is a bounded in-memory window for the current API session. CSV exports cover that current session buffer and the in-memory alert records. SQLite metric snapshots are persisted locally for retention, but the UI does not currently expose historical database queries.

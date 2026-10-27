# Integrating the local agent with the hosted OSGuard dashboard

## Why the current deployment shows server metrics

The React frontend calls the Render API. The Render process runs on a Linux host, so `systeminformation` reports the Render host—not the visitor's Windows/macOS/Linux computer.

## Local endpoint contract

- `GET /api/health` — basic health check; contains no machine details.
- `GET /api/metrics` — requires `Authorization: Bearer <local-agent-token>`; returns device, CPU, RAM, storage, network and process summaries.
- The agent binds to `127.0.0.1`, not `0.0.0.0`, so it is not directly exposed to the local network.
- Process output intentionally omits command lines and usernames.

## Production integration checklist

Do not put a permanent device token in the React bundle. Anything compiled into a public Vercel site is visible to visitors. A safe hosted design should:

1. Add user sessions/authentication or an equivalent owner-scoped identity.
2. Create a short-lived, one-time pairing code from the authenticated dashboard.
3. Have the local agent redeem the code over HTTPS and receive a device-specific credential.
4. Store only a hash of device credentials server-side; support revocation and rotation.
5. Accept metric uploads only from authenticated devices and validate payload size/schema.
6. Scope every device, history, alert and settings query to the authenticated owner/device. Never trust a client-supplied device ID alone.
7. Keep per-device snapshots/history separate; do not reuse the current global host metrics as visitor metrics.
8. Add rate limiting, request limits, retention controls, and tests for cross-device access denial.
9. Update the React dashboard to select an authorized device and render that device's data.
10. Use HTTPS for the relay and never upload unnecessary process details.

## Development-only test from PowerShell

Replace `YOUR_TOKEN` with the secret in your local `.env`:

```powershell
Invoke-RestMethod -Headers @{ Authorization = 'Bearer YOUR_TOKEN' } -Uri 'http://127.0.0.1:4179/api/metrics'
```

The token is a local development credential. It is not a substitute for user authentication or secure production pairing.

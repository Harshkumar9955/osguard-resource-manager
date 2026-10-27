# OSGuard — Multi-device local agent starter

This ZIP adds the **local collector foundation** for OSGuard. The existing hosted dashboard currently reads metrics from the Render server, which means it displays the server's Linux metrics rather than each visitor's computer. A web page cannot directly inspect arbitrary CPU/RAM/process information; a local agent is needed on each computer.

## Contents

- `agent/` — Node.js local agent using `systeminformation`.
- `docs/INTEGRATION.md` — setup and the next integration steps.

## Run the agent on Windows

1. Install Node.js 20+ on the computer you want to monitor.
2. Extract this ZIP.
3. Open PowerShell in the `agent` folder.
4. Run:

   ```powershell
   npm.cmd install
   Copy-Item .env.example .env
   notepad .env
   ```

5. In `.env`, replace `OSGUARD_AGENT_TOKEN` with a long random secret (at least 24 characters). Keep it private. Confirm `CLIENT_ORIGIN` is your exact Vercel site origin.
6. Start the agent:

   ```powershell
   npm.cmd start
   ```

7. Check `http://127.0.0.1:4179/api/health` in your browser. It should return `success: true`.

The metrics endpoint is `http://127.0.0.1:4179/api/metrics` and requires `Authorization: Bearer YOUR_TOKEN`. Do not share the token or commit `.env`.

## Important limitation

This ZIP is the **local agent starter**, not a complete production multi-user deployment. It does not yet replace the Render metrics API or modify the Vercel dashboard. Browser-to-local-agent access can also be restricted by browser Private Network Access policies, and exposing a local bearer token in frontend code is not a safe production pairing design. For a production multi-visitor experience, integrate one-time pairing, per-device credentials, user/device ownership checks, and a secure authenticated relay/API in the hosted backend. See `docs/INTEGRATION.md`.

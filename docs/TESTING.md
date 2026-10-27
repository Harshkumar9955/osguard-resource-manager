# Testing

Run from the project root:

```powershell
npm test
npm run build
```

The unit tests cover counter-rate calculations, unavailable first samples, invalid elapsed times, counter resets, and safe percentage calculations.

Manual integration checks:

1. Start the app with `npm run dev`.
2. Open `http://localhost:4000/api/health`; expect `success: true` and `data.status: "ok"`.
3. Open `http://localhost:5173`; confirm CPU/RAM readings refresh and disk capacity appears when exposed by the host.
4. Confirm network rate appears after at least two samples; unsupported disk-operation counters should show `—`.
5. Filter the process table and verify it is read-only.
6. Temporarily lower a warning threshold in Settings to verify alert creation; restore it afterward.
7. Download both CSV reports.

Hardware-specific readings cannot be guaranteed across every operating system and driver. Record the host OS and unavailable fields when evaluating the project.

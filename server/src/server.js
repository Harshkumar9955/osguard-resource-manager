import express from 'express';
import cors from 'cors';
import si from 'systeminformation';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './database.js';
import { buildSystemInsights, calculateRate } from './metrics.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));

const ok = data => ({ success: true, data });
const nowIso = () => new Date().toISOString();
const history = [];
const alerts = new Map();
let current = null;
let collecting = false;
let previous = null;
const defaults = { cpuWarning: 85, cpuCritical: 95, memoryWarning: 85, memoryCritical: 95, swapWarning: 70, diskWarning: 90, sampleIntervalMs: 2000 };

function getSettings() {
  const row = db.prepare("SELECT value FROM app_settings WHERE key='thresholds'").get();
  if (!row) return { ...defaults };
  try { return { ...defaults, ...JSON.parse(row.value) }; } catch { return { ...defaults }; }
}
function numberOrNull(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function safeProcess(p) {
  return { pid: Number(p.pid), name: p.name || 'Unknown', cpu: numberOrNull(p.cpu), memory: numberOrNull(p.mem), memoryBytes: numberOrNull(p.memRss), started: p.started || null, user: p.user || null, state: p.state || null, command: p.command || null };
}

export function evaluateAlerts(m) {
  const t = getSettings();
  const checks = [
    { key: 'cpu', value: m.cpu, warning: t.cpuWarning, critical: t.cpuCritical, label: 'CPU utilization', advice: 'Inspect the top CPU-consuming processes. Confirm whether the workload is expected before closing anything.' },
    { key: 'memory', value: m.memory?.percent, warning: t.memoryWarning, critical: t.memoryCritical, label: 'Memory utilization', advice: 'Inspect memory-heavy processes and available RAM. Save work before closing applications.' },
    { key: 'swap', value: m.memory?.swapPercent, warning: t.swapWarning, critical: 90, label: 'Swap utilization', advice: 'High swap usage may indicate memory pressure. Check RAM availability and workload growth.' },
    ...(m.disks || []).map((d, i) => ({ key: `disk-${d.mount || i}`, value: d.percent, warning: t.diskWarning, critical: 97, label: `Filesystem capacity (${d.mount || d.fs || 'volume'})`, advice: 'Review large files and safely free space. Do not delete system files without checking their purpose.' }))
  ];
  const activeKeys = new Set();
  for (const c of checks) {
    if (c.value == null || !Number.isFinite(c.value) || c.value < c.warning) continue;
    activeKeys.add(c.key);
    const prior = alerts.get(c.key);
    if (prior && prior.status !== 'resolved') {
      prior.value = Number(c.value.toFixed(1)); prior.evidenceAt = m.timestamp;
      prior.severity = c.value >= c.critical ? 'Critical' : 'Warning';
      db.prepare('UPDATE alerts SET value=?,severity=?,status=? WHERE id=?').run(prior.value, prior.severity, prior.status, prior.id);
      continue;
    }
    const a = { id: randomUUID(), key: c.key, metric: c.label, severity: c.value >= c.critical ? 'Critical' : 'Warning', value: Number(c.value.toFixed(1)), threshold: c.warning, message: `${c.label} is elevated`, action: c.advice, evidenceAt: m.timestamp, status: 'open', confidence: 'Measured threshold breach' };
    alerts.set(c.key, a);
    db.prepare('INSERT INTO alerts(id,metric,severity,value,threshold,message,status) VALUES(?,?,?,?,?,?,?)').run(a.id, a.metric, a.severity, a.value, a.threshold, a.message, a.status);
  }
  for (const [key, a] of alerts) {
    if (a.status !== 'resolved' && !activeKeys.has(key)) {
      a.status = 'resolved';
      db.prepare("UPDATE alerts SET status='resolved' WHERE id=?").run(a.id);
    }
  }
}

const diagnose = evaluateAlerts;

async function collect() {
  if (collecting) return;
  collecting = true;
  const at = Date.now();
  try {
    const [load, mem, os, cpu, disks, processes, time, netStats, diskIO, temperature] = await Promise.all([
  si.currentLoad().catch(() => ({ currentLoad: null, cpus: [] })),
  si.mem().catch(() => ({})),
  si.osInfo().catch(() => ({})),
  si.cpu().catch(() => ({})),
  si.fsSize().catch(() => []),
  si.processes().catch(() => ({ list: [], all: null })),
  si.time(),
  si.networkStats().catch(() => []),
  si.disksIO().catch(() => null),
  si.cpuTemperature().catch(() => ({ main: null, cores: [] }))
]);
    const seconds = previous ? (at - previous.at) / 1000 : 0;
    const rx = (netStats || []).reduce((s, n) => s + (Number(n.rx_bytes) || 0), 0);
    const tx = (netStats || []).reduce((s, n) => s + (Number(n.tx_bytes) || 0), 0);
    const readOps = numberOrNull(diskIO?.rIO);
    const writeOps = numberOrNull(diskIO?.wIO);
    const totalOps = numberOrNull(diskIO?.tIO);
    
    current = {
      timestamp: new Date(at).toISOString(), source: 'live',
      cpu: Number.isFinite(load.currentLoad) ? load.currentLoad : null,
      cpuCores: (load.cpus || []).map(c => Number.isFinite(c.load) ? c.load : null),
      cpuInfo: { brand: cpu.brand || null, manufacturer: cpu.manufacturer || null, cores: cpu.cores ?? null, physicalCores: cpu.physicalCores ?? null, speed: numberOrNull(cpu.speed), speedMax: numberOrNull(cpu.speedMax), temperature: Number.isFinite(temperature?.main) ? temperature.main : null },
      memory: { total: numberOrNull(mem.total), used: numberOrNull(mem.used), available: numberOrNull(mem.available), free: numberOrNull(mem.free), active: numberOrNull(mem.active), percent: mem.total ? mem.used / mem.total * 100 : null, swapTotal: numberOrNull(mem.swaptotal), swapUsed: numberOrNull(mem.swapused), swapFree: numberOrNull(mem.swapfree), swapPercent: mem.swaptotal ? mem.swapused / mem.swaptotal * 100 : null },
      os: { platform: os.platform || null, distro: os.distro || null, release: os.release || null, arch: os.arch || null, hostname: os.hostname || null, uptime: numberOrNull(time.uptime) },
      disks: (disks || []).map(d => ({ fs: d.fs || null, mount: d.mount || null, type: d.type || null, size: numberOrNull(d.size), used: numberOrNull(d.used), available: numberOrNull(d.available), percent: d.size ? d.used / d.size * 100 : null })),
      network: { interfaces: (netStats || []).map(n => ({ iface: n.iface || 'Unknown', rxBytes: numberOrNull(n.rx_bytes), txBytes: numberOrNull(n.tx_bytes), rxErrors: numberOrNull(n.rx_errors), txErrors: numberOrNull(n.tx_errors), rxDropped: numberOrNull(n.rx_dropped), txDropped: numberOrNull(n.tx_dropped) })), rxBytesPerSec: calculateRate(rx, previous?.rx, seconds), txBytesPerSec: calculateRate(tx, previous?.tx, seconds) },
      io: { readOperations: readOps, writeOperations: writeOps, totalOperations: totalOps, readOpsPerSec: calculateRate(readOps, previous?.readOps, seconds), writeOpsPerSec: calculateRate(writeOps, previous?.writeOps, seconds), sourceAvailable: diskIO != null },
      processes: (processes.list || []).map(safeProcess).filter(p => Number.isFinite(p.pid)).sort((a, b) => (b.cpu ?? -1) - (a.cpu ?? -1)).slice(0, 300),
      processCount: numberOrNull(processes.all) ?? (processes.list || []).length,
      loadAverage: Array.isArray(time.loadavg) ? time.loadavg : null
    };
    previous = { at, rx, tx, readOps, writeOps };
    history.push({ timestamp: current.timestamp, cpu: current.cpu, memory: current.memory.percent, swap: current.memory.swapPercent, networkRx: current.network.rxBytesPerSec, networkTx: current.network.txBytesPerSec, diskReadOps: current.io.readOpsPerSec, diskWriteOps: current.io.writeOpsPerSec });
    if (history.length > 600) history.shift();
    current.analysis = buildSystemInsights(current, history);
    db.prepare('INSERT INTO metric_samples(sampled_at,data_json) VALUES(?,?)').run(current.timestamp, JSON.stringify(current));
    db.prepare('DELETE FROM metric_samples WHERE id NOT IN (SELECT id FROM metric_samples ORDER BY id DESC LIMIT 10000)').run();
    diagnose(current);
  } catch (e) {
    console.error('Metric collection failed:', e?.stack || e);
    current = { timestamp: nowIso(), source: 'unavailable', error: 'Host metrics could not be collected. Check the server log and operating-system permissions.' };
  } finally { collecting = false; }
}

// Health route is intentionally registered before the not-found handler.
app.get('/api/health', (_req, res) => res.json(ok({ status: 'ok', app: 'OSGuard', version: '3.0.0', database: 'connected', uptimeSeconds: process.uptime(), timestamp: nowIso() })));
app.get('/api', (_req, res) => res.json(ok({ name: 'OSGuard', version: '3.0.0', endpoints: ['/api/health', '/api/monitoring/current', '/api/monitoring/history', '/api/monitoring/processes', '/api/alerts', '/api/settings', '/api/reports/metrics.csv'] })));
app.get('/api/monitoring/current', (_req, res) => res.json(ok(current || { source: 'warming-up', message: 'First sample is being collected' })));
app.get('/api/monitoring/history', (req, res) => {
  const limit = Math.min(600, Math.max(1, Number.parseInt(req.query.limit, 10) || 120));
  res.json(ok(history.slice(-limit)));
});
app.get('/api/monitoring/processes', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const limit = Math.min(300, Math.max(1, Number.parseInt(req.query.limit, 10) || 150));
  const list = current?.processes || [];
  res.json(ok(list.filter(p => !q || `${p.name} ${p.pid} ${p.user || ''}`.toLowerCase().includes(q)).slice(0, limit)));
});
app.get('/api/alerts', (_req, res) => res.json(ok([...alerts.values()].sort((a, b) => b.evidenceAt.localeCompare(a.evidenceAt)))));
app.patch('/api/alerts/:id', (req, res, next) => {
  try {
    const a = [...alerts.values()].find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Alert not found' } });
    if (!['open', 'acknowledged', 'resolved'].includes(req.body?.status)) return res.status(400).json({ success: false, error: { code: 'INVALID_STATUS', message: 'Status must be open, acknowledged, or resolved' } });
    a.status = req.body.status;
    db.prepare('UPDATE alerts SET status=? WHERE id=?').run(a.status, a.id);
    return res.json(ok(a));
  } catch (e) { next(e); }
});
app.get('/api/settings', (_req, res) => res.json(ok(getSettings())));
app.patch('/api/settings', (req, res) => {
  const allowed = ['cpuWarning', 'cpuCritical', 'memoryWarning', 'memoryCritical', 'swapWarning', 'diskWarning'];
  const currentSettings = getSettings();
  for (const key of allowed) {
    if (req.body?.[key] !== undefined) {
      const n = Number(req.body[key]);
      if (!Number.isFinite(n) || n < 1 || n > 100) return res.status(400).json({ success: false, error: { code: 'INVALID_THRESHOLD', message: `${key} must be between 1 and 100` } });
      currentSettings[key] = n;
    }
  }
  if (currentSettings.cpuWarning >= currentSettings.cpuCritical || currentSettings.memoryWarning >= currentSettings.memoryCritical) return res.status(400).json({ success: false, error: { code: 'INVALID_THRESHOLD_ORDER', message: 'Warning thresholds must be lower than critical thresholds' } });
  db.prepare("INSERT INTO app_settings(key,value) VALUES('thresholds',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(currentSettings));
  res.json(ok(currentSettings));
});
app.get('/api/reports/metrics.csv', (_req, res) => {
  const header = 'timestamp,cpu_percent,memory_percent,swap_percent,network_rx_bytes_per_sec,network_tx_bytes_per_sec,disk_read_ops_per_sec,disk_write_ops_per_sec';
  const rows = history.map(x => [x.timestamp, x.cpu, x.memory, x.swap, x.networkRx, x.networkTx, x.diskReadOps, x.diskWriteOps].map(v => v == null ? '' : String(v).replaceAll(',', '')).join(','));
  res.type('text/csv').attachment('osguard-metric-history.csv').send([header, ...rows].join('\r\n'));
});
app.get('/api/reports/alerts.csv', (_req, res) => {
  const header = 'id,metric,severity,value,threshold,status,evidence_at,message';
  const rows = [...alerts.values()].map(a => [a.id, a.metric, a.severity, a.value, a.threshold, a.status, a.evidenceAt, a.message].map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','));
  res.type('text/csv').attachment('osguard-alert-history.csv').send([header, ...rows].join('\r\n'));
});
app.use('/api', (_req, res) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'API route not found' } }));
app.use((err, _req, res, _next) => { console.error(err?.stack || err); res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected server error' } }); });

const port = Number(process.env.PORT) || 4000;
const intervalMs = Math.min(10000, Math.max(1000, Number(process.env.MONITOR_INTERVAL_MS) || 2000));
const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;

if (isMainModule) {
  await collect();
  const timer = setInterval(collect, intervalMs);
  const server = app.listen(port, '127.0.0.1', () => console.log(`OSGuard API listening on http://localhost:${port} (sample interval ${intervalMs} ms)`));
  function shutdown() { clearInterval(timer); server.close(() => { db.close(); process.exit(0); }); }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

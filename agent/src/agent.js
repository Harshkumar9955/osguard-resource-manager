import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import os from 'node:os';
import si from 'systeminformation';

const app = express();
const PORT = Number(process.env.PORT || 4179);
const TOKEN = process.env.OSGUARD_AGENT_TOKEN;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'https://osguard-resource-manager.vercel.app';

if (!TOKEN || TOKEN.length < 24 || TOKEN === 'replace-with-a-long-random-secret') {
  console.error('Set OSGUARD_AGENT_TOKEN in agent/.env to a private random value of at least 24 characters.');
  process.exit(1);
}

app.disable('x-powered-by');
app.use(cors({ origin: [CLIENT_ORIGIN, 'http://localhost:5173', 'http://127.0.0.1:5173'], methods: ['GET'], allowedHeaders: ['Authorization', 'Content-Type'] }));
app.use(express.json({ limit: '32kb' }));

function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Constant-time comparison for equal-length token strings.
  const a = Buffer.from(supplied);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length || !a.length || !a.equals(b)) {
    return res.status(401).json({ success: false, error: 'Unauthorized. Configure the local agent token in your trusted dashboard.' });
  }
  next();
}

app.get('/api/health', (_req, res) => res.json({ success: true, data: { status: 'ok', agent: 'OSGuard Local Agent', version: '1.0.0' } }));

app.get('/api/metrics', authenticate, async (_req, res) => {
  try {
    const [cpu, load, mem, osInfo, fsSize, network, processes, graphics] = await Promise.all([
      si.cpu(), si.currentLoad(), si.mem(), si.osInfo(), si.fsSize(), si.networkStats(), si.processes(), si.graphics().catch(() => ({ controllers: [], displays: [] }))
    ]);
    const safeProcesses = (processes.list || []).slice(0, 100).map(p => ({
      pid: p.pid, name: p.name, cpu: Number.isFinite(p.cpu) ? p.cpu : 0,
      memory: Number.isFinite(p.mem) ? p.mem : 0, state: p.state
    }));
    const data = {
      collectedAt: new Date().toISOString(),
      device: { hostname: os.hostname(), platform: osInfo.platform, distro: osInfo.distro, release: osInfo.release, arch: osInfo.arch },
      cpu: { manufacturer: cpu.manufacturer, brand: cpu.brand, physicalCores: cpu.physicalCores, logicalCores: cpu.cores, usagePercent: Number(load.currentLoad.toFixed(1)), perCore: (load.cpus || []).map(c => Number((c.load || 0).toFixed(1))) },
      memory: { totalBytes: mem.total, usedBytes: mem.used, freeBytes: mem.free, availableBytes: mem.available, usagePercent: mem.total ? Number((mem.used / mem.total * 100).toFixed(1)) : null },
      storage: (fsSize || []).map(d => ({ filesystem: d.fs, mount: d.mount, type: d.type, sizeBytes: d.size, usedBytes: d.used, usagePercent: Number.isFinite(d.use) ? Number(d.use.toFixed(1)) : null })),
      network: (network || []).map(n => ({ interface: n.iface, rxBytes: n.rx_bytes, txBytes: n.tx_bytes, rxErrors: n.rx_errors, txErrors: n.tx_errors })),
      processes: safeProcesses,
      processCount: processes.all,
      graphics: (graphics.controllers || []).map(g => ({ vendor: g.vendor, model: g.model, vram: g.vram }))
    };
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data });
  } catch (error) {
    console.error('Metric collection failed:', error?.message || error);
    res.status(500).json({ success: false, error: 'Could not collect local system metrics.' });
  }
});

// Only bind to loopback: this agent is intended to run on the user's own computer.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`OSGuard Local Agent listening on http://127.0.0.1:${PORT}`);
  console.log(`Allowed dashboard origin: ${CLIENT_ORIGIN}`);
  console.log('Metrics require an Authorization: Bearer <token> header. Keep your token private.');
});

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, Check, CheckCircle2, ChevronRight, Clock3, Cpu, Download, HardDrive, LayoutDashboard, MemoryStick, Monitor, Network, RefreshCw, Search, Settings, ShieldCheck, Thermometer, XCircle } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { notifyAboutNewAlerts } from './alertNotifications';
import { mergeSettingsState } from './settingsState';

const API = 'http://localhost:4000/api';
const NAV = [
  ['Overview', LayoutDashboard], ['Live Monitoring', Activity], ['Processes', Cpu],
  ['Diagnosis & Alerts', ShieldCheck], ['Storage & Network', HardDrive], ['Reports', BarChart3], ['Settings', Settings]
];
const fmt = (n, digits = 1) => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(digits);
const gb = n => n == null ? '—' : `${(n / 1073741824).toFixed(2)} GB`;
const mbps = n => n == null ? '—' : `${(n / 1048576).toFixed(2)} MB/s`;
async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const json = await response.json();
  if (!response.ok || !json.success) throw new Error(json.error?.message || `API request failed (${response.status})`);
  return json.data;
}
function Stat({ title, value, unit = '', detail, icon: Icon, tone = '' }) {
  return <article className="stat-card"><div className="stat-head"><span>{title}</span><span className={`stat-icon ${tone}`}><Icon size={17}/></span></div><div className="stat-number">{value}<small>{unit}</small></div><div className="stat-detail">{detail}</div></article>;
}
function Section({ title, subtitle, action, children, className = '' }) { return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>; }
function Heading({ title, subtitle, action }) { return <div className="page-heading"><div><div className="eyebrow">OSGUARD / RESOURCE INTELLIGENCE</div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>; }
function Table({ columns, rows, empty = 'No data available.' }) { return <div className="table-scroll"><table><thead><tr>{columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell ?? '—'}</td>)}</tr>)}</tbody></table>{!rows.length && <div className="empty-state">{empty}</div>}</div>; }
function Meter({ value, color = '' }) { const v = value == null ? 0 : Math.min(100, Math.max(0, value)); return <div className="meter"><span className={color} style={{ width: `${v}%` }}/></div>; }
function summarizeCoreLoad(cpuCores) {
  if (!Array.isArray(cpuCores) || cpuCores.length === 0) {
    return {
      balanced: true,
      busiest: null,
      idle: null,
      spread: 0,
      score: 0,
      reason: 'No per-core load data is available yet, so there is no evidence of an imbalance.',
      improvement: 'Wait for a few samples and then review the process table for a single workload dominating the system.'
    };
  }
  const valid = cpuCores.map((value, index) => ({ index, value: Number(value) })).filter(entry => Number.isFinite(entry.value));
  if (!valid.length) {
    return {
      balanced: true,
      busiest: null,
      idle: null,
      spread: 0,
      score: 0,
      reason: 'No per-core load data is available yet, so there is no evidence of an imbalance.',
      improvement: 'Wait for a few samples and then review the process table for a single workload dominating the system.'
    };
  }
  const busiest = valid.reduce((winner, current) => current.value > winner.value ? current : winner);
  const idle = valid.reduce((winner, current) => current.value < winner.value ? current : winner);
  const spread = Number((busiest.value - idle.value).toFixed(1));
  const score = Number(Math.min(100, Math.max(0, spread)).toFixed(1));
  const balanced = spread < 10;
  const reason = balanced
    ? 'Core loads are fairly even, so there is no meaningful imbalance across the logical CPUs.'
    : `Core ${busiest.index + 1} is carrying the heaviest workload at ${busiest.value.toFixed(0)}% while Core ${idle.index + 1} is running at ${idle.value.toFixed(0)}%. This uneven load usually means work is being concentrated onto a subset of threads, a single CPU-heavy process is dominating the workload, or scheduling is not spreading tasks evenly.`;
  const improvement = balanced
    ? 'Keep monitoring, but no major redistribution is required right now.'
    : 'Spread compute-heavy tasks across more worker threads or processes, review process affinity for any CPU-intensive service, and check the workload list to see which application is pinning work to the busiest core.';
  return {
    balanced,
    busiest: { index: busiest.index, value: busiest.value, label: `Core ${busiest.index + 1}` },
    idle: { index: idle.index, value: idle.value, label: `Core ${idle.index + 1}` },
    spread,
    score,
    reason,
    improvement
  };
}
function App() {
  const [page, setPage] = useState('Overview');
  const [monitor, setMonitor] = useState(null);
  const [history, setHistory] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [settings, setSettings] = useState(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Connecting');
  const [error, setError] = useState('');
  const [lastUpdate, setLastUpdate] = useState(null);
  const [saving, setSaving] = useState(false);
  const previousAlertsRef = useRef([]);
  const settingsDirtyRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [m, h, a, p, s] = await Promise.all([
        api('/monitoring/current'), api('/monitoring/history?limit=120'), api('/alerts'), api('/monitoring/processes?limit=300'), api('/settings')
      ]);
      setMonitor(m); setHistory(h); setAlerts(a); setProcesses(p); setSettings(prev => mergeSettingsState(prev, s, settingsDirtyRef.current)); setStatus(m?.source === 'live' ? 'Connected' : 'Warming up'); setError(''); setLastUpdate(new Date());
    } catch (e) { setStatus('Disconnected'); setError(`Cannot reach OSGuard API: ${e.message}. Check that npm run dev is still running.`); }
  }, []);
  useEffect(() => { refresh(); const id = setInterval(refresh, 2500); return () => clearInterval(id); }, [refresh]);
  useEffect(() => {
    notifyAboutNewAlerts(previousAlertsRef.current, alerts);
    previousAlertsRef.current = alerts;
  }, [alerts]);

  const filteredProcesses = useMemo(() => processes.filter(p => `${p.name} ${p.pid} ${p.user || ''}`.toLowerCase().includes(search.toLowerCase())), [processes, search]);
  const processSummary = monitor?.analysis?.processSummary || { topCpuProcess: null, topMemoryProcess: null, totalCpu: 0, totalMemory: 0, recommendation: 'No process-level pressure data is available yet.' };
  const trendSummary = monitor?.analysis?.trendSummary || { status: 'Stable', avgCpu: 0, avgMemory: 0, signals: [] };
  const smartRecommendations = monitor?.analysis?.recommendations || [];
  const coreSummary = useMemo(() => summarizeCoreLoad(monitor?.cpuCores), [monitor?.cpuCores]);
  const openAlerts = alerts.filter(a => a.status === 'open');
  const updateSetting = (key, rawValue) => {
    const nextValue = Number(rawValue);
    setSettings(current => ({ ...(current ?? {}), [key]: nextValue }));
    settingsDirtyRef.current = true;
  };
  const resolveAlert = async (alert, nextStatus) => { try { await api(`/alerts/${alert.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }); await refresh(); } catch (e) { setError(e.message); } };
  const saveSettings = async () => { if (!settings) return; setSaving(true); try { const updated = await api('/settings', { method: 'PATCH', body: JSON.stringify(settings) }); setSettings(updated); settingsDirtyRef.current = false; setError(''); } catch (e) { setError(`Settings not saved: ${e.message}`); } finally { setSaving(false); } };

  const chart = <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={history}><CartesianGrid strokeDasharray="3 3" stroke="#23324a"/><XAxis dataKey="timestamp" tickFormatter={v => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} minTickGap={28} stroke="#71819a" tick={{ fontSize: 10 }}/><YAxis domain={[0, 100]} stroke="#71819a" tick={{ fontSize: 10 }} unit="%"/><Tooltip labelFormatter={v => new Date(v).toLocaleString()} contentStyle={{ background: '#101b2d', border: '1px solid #2a3a53', borderRadius: 10 }}/><Line type="monotone" dataKey="cpu" name="CPU" stroke="#65aaff" strokeWidth={2} dot={false} connectNulls={false}/><Line type="monotone" dataKey="memory" name="RAM" stroke="#4bd6bd" strokeWidth={2} dot={false} connectNulls={false}/></LineChart></ResponsiveContainer></div>;

  let content;
  if (page === 'Overview') content = <>
    <Heading title="System command center" subtitle="Live host telemetry, resource pressure, and evidence-based diagnostics." action={<button className="btn secondary" onClick={refresh}><RefreshCw size={15}/> Refresh now</button>}/>
    <div className="stat-grid"><Stat title="CPU utilization" value={fmt(monitor?.cpu)} unit="%" detail={`${monitor?.cpuInfo?.cores ?? '—'} logical cores · ${monitor?.cpuInfo?.brand || 'CPU model unavailable'}`} icon={Cpu}/><Stat title="RAM utilization" value={fmt(monitor?.memory?.percent)} unit="%" detail={`${gb(monitor?.memory?.used)} used of ${gb(monitor?.memory?.total)}`} icon={MemoryStick} tone="teal"/><Stat title="Visible processes" value={monitor?.processCount ?? '—'} detail="Read-only host process snapshot" icon={Activity}/><Stat title="Open alerts" value={openAlerts.length} detail="Measured threshold breaches" icon={AlertTriangle} tone={openAlerts.length ? 'amber' : 'teal'}/></div>
    <div className="two-col"><Section title="Performance trend" subtitle={`Recent ${history.length} samples · refreshes every 2.5 seconds`} action={<span className="live-pill"><i/> LIVE</span>}>{chart}<div className="chart-legend"><span><i className="legend-blue"/> CPU</span><span><i className="legend-teal"/> Memory</span></div></Section><Section title="Diagnosis feed" subtitle="Alerts are based on measured host values" action={<button className="link-btn" onClick={() => setPage('Diagnosis & Alerts')}>View all <ChevronRight size={14}/></button>}>{alerts.filter(a => a.status !== 'resolved').slice(0, 4).map(a => <div className="alert-item" key={a.id}><span className={`alert-badge ${a.severity.toLowerCase()}`}><AlertTriangle size={15}/></span><div className="alert-copy"><b>{a.message}</b><small>{a.metric} · {fmt(a.value)}% · threshold {fmt(a.threshold)}%</small></div><span className={`severity ${a.severity.toLowerCase()}`}>{a.severity}</span></div>)}{!alerts.some(a => a.status !== 'resolved') && <div className="empty-state positive"><CheckCircle2 size={22}/><b>No active alerts</b><span>Current measurements are below configured thresholds.</span></div>}</Section></div>
    <Section title="Trend baseline" subtitle="Recent utilization pattern and directional change"><div className="stat-grid"><Stat title="Recent CPU" value={fmt(trendSummary.avgCpu)} unit="%" detail="Average across newest samples" icon={Cpu}/><Stat title="Recent memory" value={fmt(trendSummary.avgMemory)} unit="%" detail="Average memory pressure" icon={MemoryStick} tone="teal"/><Stat title="Baseline status" value={trendSummary.status} detail={`${trendSummary.lastWindowCpuDelta >= 0 ? '+' : ''}${fmt(trendSummary.lastWindowCpuDelta, 0)}% vs earlier baseline`} icon={Clock3}/><Stat title="Pattern" value={trendSummary.trend === 'elevated' ? 'Rising' : trendSummary.trend === 'watch' ? 'Watch' : 'Stable'} detail="System trend direction" icon={Activity} tone={trendSummary.trend === 'elevated' ? 'amber' : 'teal'}/></div><div className="detail-list compact">{(trendSummary.signals || []).map((signal, idx) => <div key={idx}><span>{signal}</span></div>)}</div></Section>
    <Section title="Storage capacity" subtitle="Filesystem capacity and I/O activity are different measurements."><div className="storage-grid">{(monitor?.disks || []).slice(0, 8).map((d, i) => <div className="storage-card" key={`${d.mount}-${i}`}><div className="storage-title"><b>{d.mount || d.fs || `Volume ${i + 1}`}</b><span>{fmt(d.percent)}%</span></div><Meter value={d.percent} color={d.percent >= 90 ? 'meter-danger' : ''}/><div className="storage-foot"><span>{gb(d.used)} used</span><span>{gb(d.available)} free</span></div><small>{d.type || 'Filesystem'} · {gb(d.size)} total</small></div>)}</div>{!monitor?.disks?.length && <div className="empty-state">Waiting for filesystem measurements.</div>}</Section>
  </>;
  else if (page === 'Live Monitoring') content = <>
    <Heading title="Live monitoring" subtitle="Host metrics reported by the operating system. Unsupported values stay unavailable." action={<span className="updated-at">Updated {lastUpdate ? lastUpdate.toLocaleTimeString() : '—'}</span>}/>
    <div className="stat-grid"><Stat title="CPU load" value={fmt(monitor?.cpu)} unit="%" detail={monitor?.cpuInfo?.brand || 'CPU model unavailable'} icon={Cpu}/><Stat title="RAM available" value={monitor?.memory ? (monitor.memory.available / 1073741824).toFixed(2) : '—'} unit="GB" detail={`${gb(monitor?.memory?.used)} used`} icon={MemoryStick} tone="teal"/><Stat title="Swap usage" value={fmt(monitor?.memory?.swapPercent)} unit="%" detail={`${gb(monitor?.memory?.swapUsed)} used of ${gb(monitor?.memory?.swapTotal)}`} icon={Monitor}/><Stat title="CPU temperature" value={fmt(monitor?.cpuInfo?.temperature)} unit={monitor?.cpuInfo?.temperature == null ? '' : '°C'} detail="Only when exposed by the host" icon={Thermometer}/></div>
    <div className="two-col"><Section title="Per-core utilization" subtitle="Individual logical CPU load">{(monitor?.cpuCores || []).length ? <><div className="core-grid">{monitor.cpuCores.map((v, i) => <div className="core-card" key={i}><div><b>Core {i + 1}</b><span>{fmt(v, 0)}%</span></div><Meter value={v}/></div>)}</div>{coreSummary && <div className="core-balance-card"><div className="core-balance-header"><div><small className="panel-kicker">Core balance</small><div className="core-balance-title">{coreSummary.balanced ? 'Balanced load' : 'Uneven load detected'}</div></div><div className="core-balance-meta"><small className="panel-kicker">Spread</small><div className="core-balance-value">{fmt(coreSummary.spread, 0)}%</div></div></div><div className="mini-metric-grid"><div className="mini-metric"><small className="panel-kicker">Imbalance score</small><strong>{fmt(coreSummary.score, 0)}</strong><span>/ 100</span></div><div className="mini-metric"><small className="panel-kicker">Most active</small><strong>{coreSummary.busiest?.label ?? '—'}</strong><span>{coreSummary.busiest ? `${fmt(coreSummary.busiest.value, 0)}%` : '—'}</span></div></div><p className="core-balance-note">{coreSummary.reason}</p><div className="mini-metric-grid"><div className="mini-metric"><small className="panel-kicker">Least active</small><strong>{coreSummary.idle?.label ?? '—'}</strong><span>{coreSummary.idle ? `${fmt(coreSummary.idle.value, 0)}%` : '—'}</span></div><div className="mini-metric compact"><small className="panel-kicker">Status</small><strong>{coreSummary.balanced ? 'Healthy' : 'Needs attention'}</strong><span>{coreSummary.balanced ? 'Evenly spread' : 'Work concentrated'}</span></div></div><p className="core-balance-note"><b>Improve it:</b> {coreSummary.improvement}</p></div>}</> : <div className="empty-state">Per-core load is not available on this host.</div>}</Section><Section title="Host details" subtitle="Operating-system reported information"><div className="detail-list">{[['Hostname', monitor?.os?.hostname], ['Operating system', [monitor?.os?.distro, monitor?.os?.release].filter(Boolean).join(' ') || monitor?.os?.platform], ['Architecture', monitor?.os?.arch], ['Logical cores', monitor?.cpuInfo?.cores], ['Physical cores', monitor?.cpuInfo?.physicalCores], ['CPU speed', monitor?.cpuInfo?.speed ? `${monitor.cpuInfo.speed} GHz` : null], ['System uptime', monitor?.os?.uptime != null ? `${(monitor.os.uptime / 3600).toFixed(1)} hours` : null]].map(([k, v]) => <div key={k}><span>{k}</span><b>{v ?? 'Unavailable'}</b></div>)}</div></Section></div>
    <Section title="CPU and memory history" subtitle="Recent utilization percentages">{chart}</Section>
  </>;
  else if (page === 'Processes') content = <>
    <Heading title="Process explorer" subtitle="Read-only process inspection. OSGuard does not terminate or reprioritize real host processes."/>
    <div className="stat-grid"><Stat title="Top CPU" value={processSummary.topCpuProcess ? processSummary.topCpuProcess.name : '—'} detail={processSummary.topCpuProcess ? `${fmt(processSummary.topCpuProcess.cpu, 0)}% · PID ${processSummary.topCpuProcess.pid ?? '—'}` : 'No dominant process'} icon={Cpu}/><Stat title="Top memory" value={processSummary.topMemoryProcess ? processSummary.topMemoryProcess.name : '—'} detail={processSummary.topMemoryProcess ? `${fmt(processSummary.topMemoryProcess.memory, 0)}% · PID ${processSummary.topMemoryProcess.pid ?? '—'}` : 'No high-memory process'} icon={MemoryStick} tone="teal"/><Stat title="Total CPU" value={fmt(processSummary.totalCpu, 0)} unit="%" detail="Across all visible processes" icon={Activity}/><Stat title="Summary" value={processSummary.count ? processSummary.count.toString() : '0'} detail={processSummary.recommendation} icon={ShieldCheck}/></div>
    <Section title="Process pressure summary" subtitle="The heaviest active workloads currently driving utilization"><div className="storage-grid">{(processSummary.topOffenders || []).map((p, idx) => <div className="storage-card" key={`${p.name}-${p.pid || idx}`}><div className="storage-title"><b>{p.name}</b><span>{fmt(p.cpu, 0)}% CPU</span></div><Meter value={p.cpu} color="meter-danger"/><div className="storage-foot"><span>{fmt(p.memory, 0)}% RAM</span><span>PID {p.pid ?? '—'}</span></div><small>{p.user || 'unknown'} · {p.state || 'unknown'}</small></div>)}{!(processSummary.topOffenders || []).length && <div className="empty-state">No process data is available yet.</div>}</div></Section>
    <Section title="Running processes" subtitle={`${filteredProcesses.length} matching processes`} action={<div className="search-box"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, PID, or user"/></div>}><Table columns={['PID', 'Process', 'CPU %', 'RAM %', 'Resident memory', 'User', 'State']} rows={filteredProcesses.slice(0, 200).map(p => [p.pid, p.name, fmt(p.cpu), fmt(p.memory), p.memoryBytes == null ? '—' : `${(p.memoryBytes / 1048576).toFixed(1)} MB`, p.user || '—', p.state || '—'])} empty="No processes match your search."/></Section>
  </>;
  else if (page === 'Diagnosis & Alerts') content = <>
    <Heading title="Diagnosis and alerts" subtitle="Rule-based recommendations based on measured resource utilization. These are signals, not guaranteed root-cause diagnoses." action={<a className="btn secondary" href={`${API}/reports/alerts.csv`}><Download size={15}/> Export alerts</a>}/>
    <div className="stat-grid"><Stat title="Open" value={alerts.filter(a => a.status === 'open').length} detail="Requires review" icon={AlertTriangle} tone="amber"/><Stat title="Acknowledged" value={alerts.filter(a => a.status === 'acknowledged').length} detail="Seen by operator" icon={Check}/><Stat title="Resolved" value={alerts.filter(a => a.status === 'resolved').length} detail="Condition no longer active or manually resolved" icon={CheckCircle2} tone="teal"/><Stat title="Current rule set" value="6" detail="CPU, RAM, swap, and filesystem thresholds" icon={ShieldCheck}/></div>
    {smartRecommendations.length > 0 && <Section title="Smart recommendations" subtitle="Actions inferred from live metrics and the current workload mix">{smartRecommendations.map((recommendation, index) => <div className="diagnosis-card" key={index}><div className="diagnosis-main"><div className="diagnosis-top"><span className="severity warning">Recommendation</span><span className="muted">Signal {index + 1}</span></div><h3>{recommendation}</h3></div></div>)}</Section>}
    <Section title="Alert history" subtitle="Newest measured events first">{alerts.map(a => <article className="diagnosis-card" key={a.id}><div className="diagnosis-main"><div className="diagnosis-top"><span className={`severity ${a.severity.toLowerCase()}`}>{a.severity}</span><span className="muted">{new Date(a.evidenceAt).toLocaleString()}</span></div><h3>{a.message}</h3><p>{a.metric}: <b>{fmt(a.value)}%</b> · configured warning threshold {fmt(a.threshold)}%</p><p className="advice"><b>Recommended review:</b> {a.action}</p><small>Status: {a.status} · Evidence: measured threshold breach</small></div><div className="button-stack">{a.status === 'open' && <button className="btn secondary" onClick={() => resolveAlert(a, 'acknowledged')}><Check size={14}/> Acknowledge</button>}{a.status !== 'resolved' && <button className="btn secondary" onClick={() => resolveAlert(a, 'resolved')}><XCircle size={14}/> Resolve</button>}</div></article>)}{!alerts.length && <div className="empty-state positive"><CheckCircle2 size={22}/><b>No alerts recorded</b><span>Threshold breaches will appear here after monitoring samples.</span></div>}</Section>
  </>;
  else if (page === 'Storage & Network') content = <>
    <Heading title="Storage and network" subtitle="Capacity is measured separately from I/O. Rates require usable counters and at least two samples."/>
    <div className="stat-grid"><Stat title="Network received" value={monitor?.network?.rxBytesPerSec == null ? '—' : (monitor.network.rxBytesPerSec / 1048576).toFixed(3)} unit="MB/s" detail="Calculated from successive byte counters" icon={Network}/><Stat title="Network transmitted" value={monitor?.network?.txBytesPerSec == null ? '—' : (monitor.network.txBytesPerSec / 1048576).toFixed(3)} unit="MB/s" detail="Calculated from successive byte counters" icon={Network} tone="teal"/><Stat title="Disk read operations" value={fmt(monitor?.io?.readOpsPerSec, 0)} unit="ops/s" detail={monitor?.io?.sourceAvailable ? 'Host disk I/O counter' : 'Counter unavailable on this host'} icon={HardDrive}/><Stat title="Disk write operations" value={fmt(monitor?.io?.writeOpsPerSec, 0)} unit="ops/s" detail={monitor?.io?.sourceAvailable ? 'Host disk I/O counter' : 'Counter unavailable on this host'} icon={HardDrive} tone="teal"/></div>
    <Section title="Filesystem capacity" subtitle="Mounted volumes reported by the host"><div className="storage-grid">{(monitor?.disks || []).map((d, i) => <div className="storage-card" key={`${d.mount}-${i}`}><div className="storage-title"><b>{d.mount || d.fs || `Volume ${i + 1}`}</b><span>{fmt(d.percent)}% used</span></div><Meter value={d.percent} color={d.percent >= 90 ? 'meter-danger' : ''}/><div className="storage-foot"><span>{gb(d.used)} used</span><span>{gb(d.available)} available</span></div><small>{d.type || 'Filesystem'} · {gb(d.size)} total</small></div>)}</div>{!monitor?.disks?.length && <div className="empty-state">Filesystem capacity is not available.</div>}</Section>
    <Section title="Network interfaces" subtitle="Counters exposed by the operating system"><Table columns={['Interface', 'Received total', 'Sent total', 'RX errors', 'TX errors', 'RX dropped', 'TX dropped']} rows={(monitor?.network?.interfaces || []).map(n => [n.iface, n.rxBytes == null ? '—' : gb(n.rxBytes), n.txBytes == null ? '—' : gb(n.txBytes), n.rxErrors ?? '—', n.txErrors ?? '—', n.rxDropped ?? '—', n.txDropped ?? '—'])}/></Section>
  </>;
  else if (page === 'Reports') content = <>
    <Heading title="Reports and history" subtitle="Export the measurements captured by the running API session." action={<a className="btn primary" href={`${API}/reports/metrics.csv`}><Download size={15}/> Export metrics CSV</a>}/>
    <div className="stat-grid"><Stat title="Samples in session" value={history.length} detail="Recent bounded history buffer" icon={Activity}/><Stat title="Average CPU" value={history.length ? fmt(history.reduce((s, x) => s + (x.cpu ?? 0), 0) / history.filter(x => x.cpu != null).length || 0) : '—'} unit="%" detail="Across collected samples" icon={Cpu}/><Stat title="Average memory" value={history.length ? fmt(history.reduce((s, x) => s + (x.memory ?? 0), 0) / history.filter(x => x.memory != null).length || 0) : '—'} unit="%" detail="Across collected samples" icon={MemoryStick}/><Stat title="Alerts total" value={alerts.length} detail="Current alert records" icon={AlertTriangle}/></div>
    <Section title="Recent samples" subtitle="Newest first"><Table columns={['Time', 'CPU %', 'RAM %', 'Swap %', 'Network RX MB/s', 'Network TX MB/s', 'Disk read ops/s', 'Disk write ops/s']} rows={[...history].reverse().slice(0, 150).map(x => [new Date(x.timestamp).toLocaleString(), fmt(x.cpu), fmt(x.memory), fmt(x.swap), x.networkRx == null ? '—' : (x.networkRx / 1048576).toFixed(3), x.networkTx == null ? '—' : (x.networkTx / 1048576).toFixed(3), fmt(x.diskReadOps, 0), fmt(x.diskWriteOps, 0)])}/></Section>
  </>;
  else content = <>
    <Heading title="Settings" subtitle="Tune warning thresholds for this local monitoring instance."/>
    <div className="two-col"><Section title="Alert thresholds" subtitle="Values are percentages (1–100). Warning must remain below critical for CPU and RAM."><div className="settings-grid">{[['cpuWarning','CPU warning'],['cpuCritical','CPU critical'],['memoryWarning','Memory warning'],['memoryCritical','Memory critical'],['swapWarning','Swap warning'],['diskWarning','Filesystem warning']].map(([key, label]) => <label className="setting-field" key={key}><span>{label}</span><div><input type="number" min="1" max="100" value={settings?.[key] ?? ''} onChange={e => updateSetting(key, e.target.value)}/><b>%</b></div></label>)}</div><button className="btn primary" disabled={!settings || saving} onClick={saveSettings}>{saving ? 'Saving…' : 'Save thresholds'}</button></Section><Section title="System and privacy" subtitle="Local-first monitoring"><div className="detail-list"><div><span>API base</span><b>{API}</b></div><div><span>Sample interval</span><b>{settings?.sampleIntervalMs ?? 2000} ms</b></div><div><span>Process actions</span><b>Read-only; no termination</b></div><div><span>Metrics source</span><b>systeminformation / host OS</b></div><div><span>Temperature</span><b>Only when exposed by the host</b></div></div><p className="privacy-note"><ShieldCheck size={16}/> OSGuard does not upload telemetry to a remote service. The API binds locally by default and stores metric samples in a local SQLite database.</p></Section></div>
  </>;

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-icon"><Activity size={23}/></div><div><b>OSGuard</b><small>INTELLIGENT RESOURCE MANAGER</small></div></div><div className="workspace-label"><span className="status-led"/> LOCAL WORKSPACE <span className="workspace-tag">HOST</span></div><div className="nav-label">WORKSPACE</div><nav>{NAV.map(([label, Icon]) => <button key={label} className={`nav-link ${page === label ? 'active' : ''}`} onClick={() => setPage(label)}><Icon size={17}/><span>{label}</span>{page === label && <i/>}</button>)}</nav><div className="sidebar-bottom"><div className="service-status"><span className={`status-led ${status === 'Connected' ? '' : 'status-warn'}`}/><div><b>Monitoring service</b><small>{status}</small></div></div><div className="version-label">OSGuard 3.0 <span>LIVE</span></div></div></aside><main className="main"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13}/><b>{page}</b></div><div className="top-actions"><span className={`connection ${status === 'Connected' ? 'good' : 'bad'}`}><i/> API {status.toUpperCase()}</span><button className="icon-button" onClick={refresh} title="Refresh data"><RefreshCw size={16}/></button><div className="avatar">OS</div></div></header><div className="content-area">{error && <div className="error-banner"><AlertTriangle size={16}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}{content}<footer>OSGuard 3.0 <span>·</span> Live resource intelligence <span>·</span> Read-only host monitoring</footer></div></main></div>;
}
export default App;

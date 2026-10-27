/** Calculate a rate from two cumulative counter samples. The first sample and counter resets are unavailable. */
export function calculateRate(current, previous, elapsedSeconds) {
  if (current == null || previous == null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || current < previous) return null;
  return (current - previous) / elapsedSeconds;
}

/** Return a percentage only when the source values are valid and the denominator is positive. */
export function safePercent(part, total) {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0 || part < 0) return null;
  return (part / total) * 100;
}

/** Summarize which logical core is carrying the heaviest workload and which is idle. */
export function summarizeCoreLoad(cpuCores) {
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

  const valid = cpuCores
    .map((value, index) => ({ index, value: Number(value) }))
    .filter(entry => Number.isFinite(entry.value));

  if (valid.length === 0) {
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

/** Rank the process list by current pressure and call out the biggest offender. */
export function summarizeProcesses(processes = []) {
  const entries = Array.isArray(processes) ? processes.filter(p => p && typeof p === 'object') : [];
  const valid = entries
    .map(p => ({
      pid: Number(p.pid),
      name: p.name || 'Unknown',
      cpu: Number(p.cpu),
      memory: Number(p.memory),
      memoryBytes: Number(p.memoryBytes),
      user: p.user || 'unknown',
      state: p.state || 'unknown'
    }))
    .filter(p => Number.isFinite(p.cpu) || Number.isFinite(p.memory));

  if (!valid.length) {
    return {
      topCpuProcess: null,
      topMemoryProcess: null,
      topOffenders: [],
      totalCpu: 0,
      totalMemory: 0,
      count: 0,
      recommendation: 'No process-level pressure data is available yet. Continue polling for a few more samples.'
    };
  }

  const topCpuProcess = valid.reduce((best, current) => {
    const currentCpu = Number(current.cpu) || -Infinity;
    const bestCpu = best == null ? -Infinity : (Number(best.cpu) || -Infinity);
    return currentCpu > bestCpu ? current : best;
  }, null);

  const topMemoryProcess = valid.reduce((best, current) => {
    const currentMemory = Number(current.memory) || -Infinity;
    const bestMemory = best == null ? -Infinity : (Number(best.memory) || -Infinity);
    return currentMemory > bestMemory ? current : best;
  }, null);

  const topOffenders = [...valid].sort((a, b) => (Number(b.cpu) || 0) - (Number(a.cpu) || 0) || (Number(b.memory) || 0) - (Number(a.memory) || 0)).slice(0, 3);
  const totalCpu = valid.reduce((sum, p) => sum + (Number.isFinite(p.cpu) ? p.cpu : 0), 0);
  const totalMemory = valid.reduce((sum, p) => sum + (Number.isFinite(p.memory) ? p.memory : 0), 0);

  const headline = topCpuProcess && topCpuProcess.cpu >= 60
    ? `Process ${topCpuProcess.name} is the top CPU consumer at ${topCpuProcess.cpu.toFixed(0)}% and should be reviewed for workload concentration.`
    : topMemoryProcess && topMemoryProcess.memory >= 60
      ? `Process ${topMemoryProcess.name} is also consuming the most RAM at ${topMemoryProcess.memory.toFixed(0)}% and may be causing memory pressure.`
      : 'Process activity is relatively balanced and no single task appears to be dominating the machine.';

  return {
    topCpuProcess: topCpuProcess ? { name: topCpuProcess.name, cpu: Number(topCpuProcess.cpu), pid: topCpuProcess.pid, user: topCpuProcess.user } : null,
    topMemoryProcess: topMemoryProcess ? { name: topMemoryProcess.name, memory: Number(topMemoryProcess.memory), pid: topMemoryProcess.pid, user: topMemoryProcess.user } : null,
    topOffenders,
    totalCpu: Number(totalCpu.toFixed(1)),
    totalMemory: Number(totalMemory.toFixed(1)),
    count: valid.length,
    recommendation: headline
  };
}

/** Calculate an interpretable baseline from a recent history window. */
export function summarizeTrendBaseline(history = []) {
  const samples = Array.isArray(history) ? history.filter(x => x && (Number.isFinite(x.cpu) || Number.isFinite(x.memory))) : [];
  if (!samples.length) {
    return {
      avgCpu: 0,
      avgMemory: 0,
      lastWindowCpuDelta: 0,
      lastWindowMemoryDelta: 0,
      status: 'Stable',
      signals: ['No recent measurements are available yet.'],
      trend: 'stable'
    };
  }

  const window = samples.slice(-8);
  const previousWindow = samples.slice(-16, -8);
  const avgCpu = window.reduce((sum, point) => sum + (Number(point.cpu) || 0), 0) / window.length;
  const avgMemory = window.reduce((sum, point) => sum + (Number(point.memory) || 0), 0) / window.length;
  const baselineCpu = previousWindow.length ? previousWindow.reduce((sum, point) => sum + (Number(point.cpu) || 0), 0) / previousWindow.length : avgCpu;
  const baselineMemory = previousWindow.length ? previousWindow.reduce((sum, point) => sum + (Number(point.memory) || 0), 0) / previousWindow.length : avgMemory;
  const lastWindowCpuDelta = Number((window[window.length - 1].cpu - baselineCpu).toFixed(1));
  const lastWindowMemoryDelta = Number((window[window.length - 1].memory - baselineMemory).toFixed(1));

  let status = 'Stable';
  let trend = 'stable';
  if (avgCpu >= 75 || lastWindowCpuDelta >= 15) {
    status = 'Rising load';
    trend = 'elevated';
  } else if (avgCpu >= 55 || lastWindowCpuDelta >= 5) {
    status = 'Elevated';
    trend = 'watch';
  }

  const signals = [
    `Average CPU over the recent window is ${avgCpu.toFixed(0)}%.`,
    `Average memory pressure is ${avgMemory.toFixed(0)}%.`,
    `The latest sample is ${lastWindowCpuDelta >= 0 ? '+' : ''}${lastWindowCpuDelta.toFixed(0)}% versus the earlier baseline.`
  ];

  return {
    avgCpu: Number(avgCpu.toFixed(1)),
    avgMemory: Number(avgMemory.toFixed(1)),
    lastWindowCpuDelta: Number(lastWindowCpuDelta.toFixed(1)),
    lastWindowMemoryDelta: Number(lastWindowMemoryDelta.toFixed(1)),
    status,
    signals,
    trend
  };
}

/** Produce a small recommendation engine for the current snapshot and workload mix. */
export function buildSmartRecommendations(current, processes = []) {
  const cpu = Number(current?.cpu);
  const memoryPercent = Number(current?.memory?.percent);
  const coreSummary = summarizeCoreLoad(Array.isArray(current?.cpuCores) ? current.cpuCores : []);
  const processSummary = summarizeProcesses(processes);
  const recommendations = [];

  if (Number.isFinite(cpu) && cpu >= 80) {
    recommendations.push(`CPU is running at ${cpu.toFixed(0)}%. Review ${processSummary.topCpuProcess?.name || 'the busiest process'} and consider spreading the workload across additional workers or cores.`);
  }

  if (Number.isFinite(memoryPercent) && memoryPercent >= 75) {
    recommendations.push(`Memory pressure is high at ${memoryPercent.toFixed(0)}%. Close unnecessary apps or investigate memory-heavy processes before capacity is exhausted.`);
  }

  if (coreSummary.spread >= 15) {
    recommendations.push(`Core imbalance is elevated at a ${coreSummary.spread.toFixed(0)}% spread. Move work away from Core ${coreSummary.busiest?.index + 1 || 1} and rebalance workloads.`);
  }

  if (processSummary.topCpuProcess && processSummary.topCpuProcess.cpu >= 50) {
    recommendations.push(`Process ${processSummary.topCpuProcess.name} is consuming ${processSummary.topCpuProcess.cpu.toFixed(0)}% CPU. Check whether it is a legitimate workload or a stuck background task.`);
  }

  if (!recommendations.length) {
    recommendations.push('The system is operating within a healthy range. Continue monitoring and keep the current workload mix stable.');
  }

  return recommendations.slice(0, 4);
}

/** Convenience helper that packages current monitoring insight data for the UI. */
export function buildSystemInsights(current, history = []) {
  return {
    processSummary: summarizeProcesses(current?.processes || []),
    trendSummary: summarizeTrendBaseline(history),
    recommendations: buildSmartRecommendations(current, current?.processes || []),
    coreSummary: summarizeCoreLoad(Array.isArray(current?.cpuCores) ? current.cpuCores : []),
    generatedAt: new Date().toISOString()
  };
}

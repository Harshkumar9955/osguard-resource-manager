import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRate, safePercent, summarizeCoreLoad, summarizeProcesses, summarizeTrendBaseline, buildSmartRecommendations } from '../src/metrics.js';

test('calculateRate calculates units per second from cumulative counters', () => {
  assert.equal(calculateRate(250, 100, 5), 30);
});
test('calculateRate returns null for first sample or unavailable counters', () => {
  assert.equal(calculateRate(250, null, 5), null);
  assert.equal(calculateRate(null, 100, 5), null);
});
test('calculateRate rejects invalid intervals and counter resets', () => {
  assert.equal(calculateRate(250, 100, 0), null);
  assert.equal(calculateRate(90, 100, 2), null);
});
test('safePercent calculates utilization and rejects invalid denominators', () => {
  assert.equal(safePercent(25, 100), 25);
  assert.equal(safePercent(25, 0), null);
  assert.equal(safePercent(-1, 100), null);
});
test('summarizeCoreLoad identifies the busiest and least-busy logical cores', () => {
  const summary = summarizeCoreLoad([18, 74, 27, 91]);
  assert.equal(summary.busiest.index, 3);
  assert.equal(summary.busiest.value, 91);
  assert.equal(summary.idle.index, 0);
  assert.equal(summary.idle.value, 18);
  assert.equal(summary.spread, 73);
  assert.equal(summary.score, 73);
  assert.match(summary.reason, /uneven|load/i);
  assert.match(summary.improvement, /spread|affinity|threads/i);
});
test('summarizeCoreLoad handles balanced or unavailable loads safely', () => {
  assert.equal(summarizeCoreLoad(null).balanced, true);
  assert.equal(summarizeCoreLoad([40, 45, 42, 43]).balanced, true);
  assert.equal(summarizeCoreLoad([40, 45, 42, 43]).spread < 10, true);
});

test('summarizeProcesses ranks CPU and memory pressure by process', () => {
  const summary = summarizeProcesses([
    { name: 'node', cpu: 75, memory: 50 },
    { name: 'chrome', cpu: 90, memory: 80 },
    { name: 'python', cpu: 30, memory: 10 }
  ]);
  assert.equal(summary.topCpuProcess.name, 'chrome');
  assert.equal(summary.topMemoryProcess.name, 'chrome');
  assert.equal(summary.totalCpu, 195);
  assert.equal(summary.recommendation.includes('chrome'), true);
});

test('summarizeTrendBaseline identifies sustained changes in the recent history window', () => {
  const summary = summarizeTrendBaseline([
    { cpu: 35, memory: 45 },
    { cpu: 40, memory: 46 },
    { cpu: 48, memory: 55 },
    { cpu: 60, memory: 70 }
  ]);
  assert.ok(summary.avgCpu > 45);
  assert.ok(summary.lastWindowCpuDelta > 0);
  assert.match(summary.status, /rising|elevated|stable/i);
  assert.ok(Array.isArray(summary.signals));
});

test('buildSmartRecommendations creates actionable advice for high-pressure conditions', () => {
  const recommendations = buildSmartRecommendations({ cpu: 92, memory: { percent: 89 }, cpuCores: [95, 40, 58, 62] }, [
    { name: 'node', cpu: 79, memory: 60 },
    { name: 'chrome', cpu: 12, memory: 25 }
  ]);
  assert.ok(recommendations.length >= 2);
  assert.ok(recommendations.some(r => /cpu|core|process/i.test(r)));
});
